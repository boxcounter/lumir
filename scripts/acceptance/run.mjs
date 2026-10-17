#!/usr/bin/env node
// Lumir 真机验收套件 —— runner。
//
// 用法：
//   node scripts/acceptance/run.mjs                 # 跑全部场景
//   node scripts/acceptance/run.mjs 01 08           # 只跑 id 前缀匹配的场景
//   node scripts/acceptance/run.mjs --list          # 列出场景
//   node scripts/acceptance/run.mjs --keep-app      # 跑完保留 app（人工接手看现场）
//   node scripts/acceptance/run.mjs --check         # 静态校验场景（不真机、不建锁）
//
// 真跑批先抢 `/tmp/lumir-acceptance-rmachine.lock`：同机已有跑批时拒绝启动，不再靠人工约定串行
// （显式覆写 `LUMIR_ACCEPTANCE_VAULT` 到别的 vault 则跳过锁，按「各自隔离」并行——见下方 acquireRmachineLock）。
//
// 设计（docs/process/real-machine-acceptance.md）：起真实 app（`pnpm tauri dev`，WKWebView 非
// chromium 近似）→ KimiCU 驱动 → AX/内容断言 + 截图证据 → test-results/acceptance/<日期>/（git 外）。
// 每个场景前重置验收 vault、重置隔离配置、重启 app——场景之间零串扰，代价是每次重启几秒。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { CuClient } from "./lib/cu.mjs";
import {
  acceptPort,
  assertSafeTargets,
  copyFixture,
  launchApp,
  prepareSeed,
  reclaimPort,
  resetPositions,
  resetRecovery,
  resetHarness,
  resetRegistry,
  resetSecondVault,
  resetSessions,
  resetVault,
  resetWindowState,
  SCENARIO_CONFIG_KEYS,
  stopApp,
  writeConfig,
} from "./lib/app.mjs";
import {
  foregroundNote,
  pinWindowSize,
  tryForeground,
  waitAppReady,
  waitStartupRestore,
} from "./lib/drive.mjs";
import { Evidence, appendRunLog, writeSummary } from "./lib/evidence.mjs";
import { checkScenario, loadScenario, runScenario } from "./lib/execute.mjs";
import { envHome, InfraError, log, mkdirp, repoRoot, resultsRoot, sleep, vaultDir } from "./lib/util.mjs";

const args = process.argv.slice(2);
const keepApp = args.includes("--keep-app");
const filters = args.filter((a) => !a.startsWith("--"));
const scenariosDir = path.join(repoRoot(), "scripts/acceptance/scenarios");

/**
 * 套件的**语言面**（M284）：所有场景默认跑在这一档界面语言下，场景可用 front-matter 的
 * `config: { language: … }` 覆盖（场景 60 钉 `en`）。
 *
 * 为什么要由套件自己钉住、而不是跟随产品的出厂默认：`[ui] language` 的出厂值会变（M282 把它
 * 从 `zh` 裁成 `en`），而断言里的 chrome 文案（`关闭 `/`保存并切换`/`vault：…`）只可能是**某一
 * 档**语言的取值——跟随默认值的场景会在默认值改判的那一刻整批静默变红（M284 的 finding：
 * `.tower/comms/findings/20260928-worker-impl-vault-perf-bug-m282-en-27-chrome.md`）。
 * 取值与两侧覆盖边界见套件 README 的「语言面」节（canonical 居所）。
 */
const SUITE_LANGUAGE = "zh";

/**
 * 套件钉尺寸的目标（M491）：从 `src-tauri/tauri.conf.json` 的 `app.windows[0]` 现场读——
 * 与 `launchApp` 的同一份真源（REVIEW.md 「同一语义两处真源」条：窗口配置只有一份真源），不在这里手抄
 * 1200×800；产品侧 apply_startup_size 把该尺寸降级为占位、首启取工作区 90%（lib.rs:242-322，
 * 见 README「窗口几何」），钉尺寸即把窗口恢复成构建配置的占位值。读不到 width/height 抛错，
 * 不回落字面量。
 */
function suiteWindowSize() {
  const conf = JSON.parse(readFileSync(path.join(repoRoot(), "src-tauri", "tauri.conf.json"), "utf8"));
  const w = conf.app?.windows?.[0];
  if (!w?.width || !w?.height) {
    throw new Error("suiteWindowSize：src-tauri/tauri.conf.json 的 app.windows[0] 缺 width/height");
  }
  return { width: w.width, height: w.height };
}

/**
 * 豁免钉尺寸的场景（M491）：126-window-geometry 的判据**本体**就是「首启 = 工作区 90% / 按存档
 * 恢复 / 越界钳制 / 损坏回落」这条产品启动行为（spec: app-window）——钉尺寸会把它每一步的几何
 * 断言全部判红。豁免按场景 id 显式列出：front-matter 级开关要动 execute.mjs 的静态校验面与
 * 场景文件，超出本 mission 的 scope；这份清单是刻意的窄例外（只有这一个场景的 oracle 建立在
 * 「启动尺寸不被套件碰」上），新增豁免必须附同等理由。
 */
const NO_PIN_WINDOW_SCENARIOS = new Set(["126-window-geometry"]);

/**
 * 本场景的启动会不会恢复标签条（M516）：`seed.sessions` 里任一会话带非空 `tabs`（含 `panes`
 * 形态的每个 pane）即为真。**只有这种启动才有「恢复窗口」**——没有会话（或会话为空）的场景
 * 不付这个等待，也就不会被启动门拖慢。判据只看 seed 声明，不读盘、不猜产品行为。
 *
 * 为什么按「有没有标签要恢复」分流而不是全场景统一等：门本身要等的是一个**正**观测
 * （见 `drive.mjs` 的 `waitStartupRestore`），没有标签要恢复的启动拿不到这个观测、只能靠
 * 超时收场——那会让每个无会话场景白等一次超时。分流点因此只能落在「本场景有没有恢复段」。
 */
function seedHasRestoredTabs(seed) {
  for (const session of Object.values(seed?.sessions ?? {})) {
    if ((session?.panes ?? []).some((pane) => (pane?.tabs?.length ?? 0) > 0)) return true;
    if ((session?.tabs?.length ?? 0) > 0) return true;
  }
  return false;
}

async function listScenarios() {
  const names = (await readdir(scenariosDir)).filter((n) => n.endsWith(".md")).sort();
  const out = [];
  for (const n of names) out.push(await loadScenario(path.join(scenariosDir, n)));
  return out;
}

const all = await listScenarios();
if (args.includes("--check")) {
  // 静态校验：不真机、秒级，写场景时先用它挡掉 key 拼错、断言形态写错这类低级错。
  const problems = all.flatMap(checkScenario);
  for (const s of all) log(`CHECK ${problems.some((p) => p.startsWith(`${s.id}:`)) ? "FAIL" : "PASS"} ${s.id}`);
  if (problems.length) {
    log("");
    for (const p of problems) log(`  ✗ ${p}`);
    process.exit(1);
  }
  log(`\n场景静态校验通过（${all.length} 个）`);
  process.exit(0);
}
if (args.includes("--list")) {
  for (const s of all) log(`${s.id}\t（backlog 项 ${s.item}）\t${s.title}`);
  process.exit(0);
}
const selected = filters.length ? all.filter((s) => filters.some((f) => s.id.startsWith(f) || String(s.item) === f)) : all;
if (selected.length === 0) {
  log(`没有匹配的场景（可用：${all.map((s) => s.id).join(", ")}）`);
  process.exit(2);
}

/**
 * 验收模式标记（M359）：把 dev 端口的**缺省值显式落进 env**——这是 `vite.config.ts` 判定
 * 「本次 dev server 属于验收实例」的唯一凭据（它据此装上 `server.watch.ignored`，不再因同机别的
 * agent 改写 `.tower/worktrees/**` 里的 `.html` / `tsconfig.json` 而整页重载、把正在跑的场景打断
 * ——现场与判据见该配置文件的注释）。
 *
 * 为什么落点在这里：`launchApp` 起的 `pnpm tauri dev` 原样继承本进程 env，验收实例因此拿到标记；
 * Alex 手头的 `pnpm tauri dev`（1420）不经过 runner、不带该变量，watch 行为因此不受影响。
 * 缺省值仍由 `lib/app.mjs` 的 `acceptPort()` 单点定义（REVIEW.md 「同一语义两处真源」条），这里只把它回写进
 * env，不抄一份字面量；放在 `--check` / `--list` 两个早退出口之后，只有真跑批才会落这一笔。
 */
process.env.LUMIR_ACCEPTANCE_PORT ??= String(acceptPort());

const root = resultsRoot();
const evidence = new Evidence(root);
let handle = null;
let cu = null;

/**
 * 跑批独占锁（M357）：把「同机同一时刻只跑一个 runner」从人工约定升级成套件自 enforce。
 *
 * 为什么必须有：套件的隔离只做到「配置目录 + vault + 端口」这一层，而合成 vault（`$vault` /
 * `$vault2`）与 dev 端口是**全机共享**的。`reclaimPort()` 只在「两个 app 实例同时活着」时拦得住，
 * 于是两个 worktree 的跑批只要先后错开启动就都能过预检，随后互相 `resetVault()`，产出一串与真实
 * 产品缺陷无法区分的假 FAIL（2026-10-07 实证：两条跑批撞同一 vault，约 25 条假 FAIL 作废；
 * finding `.tower/comms/findings/20261007-worker-ftr1-bug-worktree-vault-1430-fail.md`）。
 *
 * 形态沿用既有的**人工 claim 约定**（`/tmp/lumir-acceptance-rmachine.lock`）：`mkdir` 原子建锁
 * （`EEXIST` 即已被占），随后写入 `pid` / `startedAt` / `cwd` 三个文件；读取方容忍 `pid` 缺失的
 * 那一瞬（建锁与写内容之间的窗口，轮询等一拍再判）。处置分三种：锁里 pid 仍存活 → 拒绝启动并在
 * stderr 打印持有人；pid 已死 → 视为崩溃残留回收重建；轮询后仍读不到 pid → 拒绝启动并提示手工确认
 * （宁可挡住，也不冒双跑风险）。（与 `reclaimPort` 同一条 fail-loud 取向。）
 */
const RMACHINE_LOCK = "/tmp/lumir-acceptance-rmachine.lock";
let rmachineLock = null; // 本进程持有时为 `{ dir, pid }`

class LockBusyError extends Error {}

/** 锁里记录的持有人；`pid` 读不到时回 null（容忍建锁与写内容之间的窗口）。 */
function readLockHolder(dir) {
  const field = (name) => {
    try {
      return readFileSync(path.join(dir, name), "utf8").trim();
    } catch {
      return "";
    }
  };
  const pid = Number(field("pid"));
  return {
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    startedAt: field("startedAt"),
    cwd: field("cwd"),
  };
}

/** 存活判定：`kill(pid, 0)` 不抛即存在；`EPERM` 说明进程在、只是不归本用户（照样算存活）。 */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function holderLine(holder) {
  return [
    holder.pid ? `pid ${holder.pid}` : "pid 未知",
    holder.startedAt ? `起于 ${holder.startedAt}` : "启动时间未知",
    holder.cwd ? `cwd ${holder.cwd}` : "cwd 未知",
  ].join("，");
}

function busyMessage(holder) {
  return [
    `✗ 已有真机跑批在跑，拒绝启动（跑批独占锁 ${RMACHINE_LOCK}）`,
    `  持有人：${holderLine(holder)}`,
    "  同一时刻只允许一个 runner 真跑：两个 runner 共享合成 vault 与 dev 端口，会互相 resetVault，",
    "  产出与产品缺陷无法区分的假 FAIL（2026-10-07 实证）。",
    "  等它跑完再重试；确需并行就让两条跑批各自隔离——显式覆写 LUMIR_ACCEPTANCE_VAULT（vault）",
    "  与 LUMIR_ACCEPTANCE_PORT（端口），锁即按「各自隔离」放行。",
  ].join("\n");
}

function orphanMessage() {
  return [
    `✗ 跑批锁存在但读不到 pid（${RMACHINE_LOCK}）：不排除是崩溃残留，也可能有人正在建锁`,
    `  确认没有 runner 在跑之后手工删除它：rm -rf ${RMACHINE_LOCK}`,
  ].join("\n");
}

/** 申请跑批锁；拿不到抛 `LockBusyError`（调用方按「运行失败」退出，持有人信息走 stderr）。 */
async function acquireRmachineLock() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      mkdirSync(RMACHINE_LOCK);
    } catch (e) {
      if (e.code !== "EEXIST") throw new Error(`建锁失败（${RMACHINE_LOCK}）：${e.message}`);
      let holder = readLockHolder(RMACHINE_LOCK);
      for (let i = 0; i < 20 && holder.pid === null; i++) {
        await sleep(50); // 对方可能刚 mkdir、pid 还没落盘
        holder = readLockHolder(RMACHINE_LOCK);
      }
      if (holder.pid !== null && pidAlive(holder.pid)) throw new LockBusyError(busyMessage(holder));
      if (holder.pid === null) throw new LockBusyError(orphanMessage());
      log(`回收上次跑批残留的锁（${holderLine(holder)}，进程已退出）`);
      rmSync(RMACHINE_LOCK, { recursive: true, force: true });
      continue;
    }
    try {
      // pid 先写：读取方靠它判存活。后两个文件读不到时按「未知」呈现，不阻塞任何人。
      writeFileSync(path.join(RMACHINE_LOCK, "pid"), `${process.pid}\n`);
      writeFileSync(path.join(RMACHINE_LOCK, "startedAt"), `${new Date().toISOString()}\n`);
      writeFileSync(path.join(RMACHINE_LOCK, "cwd"), `${process.cwd()}\n`);
    } catch (e) {
      try {
        rmSync(RMACHINE_LOCK, { recursive: true, force: true });
      } catch {
        /* 尽力而为 */
      }
      throw new Error(`写锁内容失败（${RMACHINE_LOCK}）：${e.message}`);
    }
    rmachineLock = { dir: RMACHINE_LOCK, pid: process.pid };
    return;
  }
  throw new Error(`建锁反复失败（${RMACHINE_LOCK}）：锁被反复抢占或回收不干净，请手工检查`);
}

/**
 * 删锁；返回是否真的删了。只在锁里记的还是本进程 pid 时删——锁被别人接管（不该发生）时宁可留残留
 * 也不删别人的：残留锁会被下一次跑批按「pid 已死」回收，而误删活锁会直接造出两条并发跑批。
 */
function releaseRmachineLock() {
  const held = rmachineLock;
  rmachineLock = null;
  if (!held) return false;
  try {
    if (readLockHolder(held.dir).pid !== held.pid) return false;
    rmSync(held.dir, { recursive: true, force: true });
    return true;
  } catch {
    return false; // 退出路径尽力而为：删锁失败不改退出码（残留锁由下次跑批判死回收）
  }
}

/**
 * 本次跑批是否需要持锁：只有**共享同一套机器资源**的跑批才需要串行。`LUMIR_ACCEPTANCE_VAULT` 被
 * 显式覆写成别的 vault 时，跑批声明了自己那套 vault，按并行放行（端口是另一份共享资源，要真并行
 * 还得同时覆写 `LUMIR_ACCEPTANCE_PORT`——README 已写明）。
 */
function needsRmachineLock() {
  return path.resolve(vaultDir()) === defaultVaultDir();
}

/**
 * 套件缺省的合成 vault（= `lib/util.mjs` 的 `vaultDir()` 在无覆写时的取值）。这里靠临时清空 env
 * 取值，不抄一份路径字面量——默认 vault 的真源只有一个（REVIEW.md 「同一语义两处真源」条）。
 */
function defaultVaultDir() {
  const saved = process.env.LUMIR_ACCEPTANCE_VAULT;
  if (saved === undefined) return path.resolve(vaultDir());
  delete process.env.LUMIR_ACCEPTANCE_VAULT;
  try {
    return path.resolve(vaultDir());
  } finally {
    process.env.LUMIR_ACCEPTANCE_VAULT = saved;
  }
}

/**
 * 起实例前的环境预检（tower 纪律，2026-09-16）：
 * - KimiCU 不存在 → 直接说清安装命令，不要跑到一半才发现；
 * - 磁盘水位 < 2G 不起真机实例（cargo/vite 会 ENOSPC 硬失败，批次四实证）；
 * - **同机已有 Lumir 实例在场**（安装版 / 残留的开发实例）→ 拒跑并给出 pid 与清除方法（M478）；
 * - 报告 1420 端口占用情况（套件自身走 1430，但仍先看一眼：1420 被占说明同机有别的
 *   `pnpm tauri dev` 在跑，机器负载与 AX 稳定性都会受影响）。
 */
async function preflight() {
  const bin = process.env.KIMICU_BIN ?? "/Applications/KimiCU.app/Contents/MacOS/kimi-cu";
  if (!existsSync(bin)) {
    throw new Error(
      `KimiCU 未安装（${bin}）。安装：curl -fsSL https://cdn.kimi.com/kimi-computer-use/latest/setup_macos.sh | bash`,
    );
  }
  const { statfsSync } = await import("node:fs");
  const fs = statfsSync(repoRoot());
  const freeGb = (fs.bavail * fs.bsize) / 1e9;
  if (freeGb < 2) {
    // 阈值来自 tower 纪律（<2G 不起真机实例）。唯一可绕过的方式是显式授权：目标 target 是热的、
    // 本次不会触发 Rust 重编时，实际磁盘需求只有几 MB。绕过会留痕（run.log + 报告），不静默。
    if (process.env.LUMIR_ACCEPTANCE_ALLOW_LOW_DISK !== "1") {
      throw new Error(
        `磁盘可用 ${freeGb.toFixed(2)}G < 2G：真机实例会 ENOSPC 硬失败，请先清理或上报（tower 纪律）。` +
          `若 target 已热、本次不重编，可显式设 LUMIR_ACCEPTANCE_ALLOW_LOW_DISK=1 绕过（会留痕）。`,
      );
    }
    log(`⚠ 磁盘可用仅 ${freeGb.toFixed(2)}G，已按显式授权（LUMIR_ACCEPTANCE_ALLOW_LOW_DISK=1）越过 2G 阈值`);
    await appendRunLog(root, `${new Date().toISOString()} OVERRIDE low-disk free=${freeGb.toFixed(2)}G`);
  } else {
    log(`磁盘可用 ${freeGb.toFixed(1)}G`);
  }
  const { execFileSync } = await import("node:child_process");
  assertNoForeignLumir(execFileSync);
  let on1420 = "";
  try {
    on1420 = execFileSync("/usr/sbin/lsof", ["-nP", "-iTCP:1420", "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
  } catch {
    /* 未被占用 */
  }
  log(
    on1420
      ? `注意：1420 端口被占用（同机有别的 tauri dev 在跑）；套件自身走 ${acceptPort()} 不受影响\n`
      : `1420 端口空闲；套件自身走 ${acceptPort()}\n`,
  );
}

/**
 * 起跑自检：同机已有 Lumir 实例在场即**拒跑**（M478）。
 *
 * 检出两类目标（都按「这个进程自己就是要跑的那个二进制」判定，不做宽松的子串匹配）：
 *   - **安装版实例**：命令行以 `<某个>.app/Contents/MacOS/lumir` 结尾（打包产物，通常来自
 *     /Applications）。它与套件实例同 bundle 身份（`com.lumir.app`）、共用同一份 AX / 前台归属，
 *     窗口还可能盖在套件实例上（键盘注入 `occluded` 的成因之一）；
 *   - **残留的开发实例**：命令行以 `target/debug/lumir` 结尾。上一次跑批没清干净、或**另一个
 *     worktree** 的实例——`reclaimPort` 只回收**本 worktree** 的残留，别的 worktree 的会与本次
 *     跑批争夺同一个前台归属。
 *
 * 为什么升成门禁而不是提醒：在场的第二个实例会**静默**改变「前台焦点归谁」这个所有键盘 / 鼠标
 * 动作的前提，产出一串与产品缺陷无法区分的假 FAIL（REVIEW.md 「键盘注入丢键」条：同机第二个实例显著加剧
 * 丢键）。2026-10-13 的复跑整轮前台焦点未取得（前台始终是别的 app），当时无从归因的干扰源之一
 * 就是场上的其他实例（M478）。
 *
 * 两条判据都是**路径行尾锚定**，且再叠一条「**可执行文件名必须是 `lumir`**」：命令行里「提到」
 * 这个路径的进程不算实例——按模式查进程的 watchdog shell 与 `pkill -f target/debug/lumir` 这类命令
 * 都会以该路径结尾（前者是 M478 现场的干扰源之一，后者正是下面明确禁止的清除方式）。
 *
 * 清除方法只给**逐个 kill**，不给 `pkill -f` 这类模式匹配——那条误伤过用户手头的实例
 * （README「已知边界」的清理条，M164 实证）。
 */
function assertNoForeignLumir(execFileSync) {
  const rows = execFileSync("/bin/ps", ["-axo", "pid=,command="], { encoding: "utf8" }).split("\n");
  const installed = [];
  const dev = [];
  for (const row of rows) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(row);
    if (!m) continue;
    const pid = Number(m[1]);
    const cmd = m[2].trim();
    const isInstalled = /\.app\/Contents\/MacOS\/lumir$/.test(cmd);
    const isDev = /(?:^|[\s/])target\/debug\/lumir$/.test(cmd);
    if (!isInstalled && !isDev) continue;
    let comm = "";
    try {
      comm = execFileSync("/bin/ps", ["-o", "comm=", "-p", String(pid)], { encoding: "utf8" }).trim();
    } catch {
      continue; // 进程在这一瞬退出了
    }
    if (comm.split("/").pop() !== "lumir") continue;
    (isInstalled ? installed : dev).push({ pid, cmd });
  }
  if (installed.length === 0 && dev.length === 0) return;
  const found = [...installed, ...dev];
  throw new Error(
    [
      "✗ 起跑自检不过：同机已有 Lumir 实例在场，拒绝启动（M478）",
      ...installed.map((p) => `  安装版实例：pid ${p.pid}（${p.cmd}）`),
      ...dev.map((p) => `  开发实例：pid ${p.pid}（${p.cmd}）`),
      "  为什么挡：套件实例与它们同 bundle 身份（com.lumir.app），共用同一份 AX / 前台归属——在场的",
      "  第二个实例会静默改变「前台焦点归谁」这个所有键盘 / 鼠标动作的前提，产出一串与产品缺陷无法",
      "  区分的假 FAIL（REVIEW.md 「键盘注入丢键」条：同机第二个实例显著加剧丢键）。",
      "  清除方法：安装版退出（⌘Q 或它的「退出」菜单）；开发实例逐个退出：",
      `    kill ${found.map((p) => p.pid).join(" ")}`,
      '  MUST NOT 用 pkill -f "target/debug/lumir" 这类模式匹配——它会连别人手头的实例一起打掉',
      "  （README「已知边界」的清理条，M164 实证误伤过用户的实例）。",
      "  清完重跑。`--keep-app` 留下的实例同样会被这条挡住：留现场请自己在下次跑批前先退出它。",
    ].join("\n"),
  );
}

async function main() {
  const targets = assertSafeTargets();
  // 锁要在任何动共享资源的动作之前拿（reclaimPort 会杀进程、resetVault 会删文件）。
  if (needsRmachineLock()) {
    await acquireRmachineLock();
    log(`跑批锁：${RMACHINE_LOCK}（持有者 pid ${process.pid}，同一时刻只允许一个真跑）`);
  } else {
    log(`跳过跑批锁：LUMIR_ACCEPTANCE_VAULT 显式指向独立 vault（${targets.vault}），按隔离并行放行`);
    log("  注意：端口仍可能与别的跑批相撞，真并行请同时覆写 LUMIR_ACCEPTANCE_PORT\n");
  }
  await preflight();
  log(`验收 vault：${targets.vault}`);
  log(`隔离配置：${targets.envHome}（用户的 ~/.config/lumir 全程不读写）`);
  log(`证据目录：${root}（git 外）`);
  const reclaimed = await reclaimPort(acceptPort());
  if (reclaimed.length) log(`回收上次残留进程：${reclaimed.join(", ")}`);
  await mkdirp(root);
  // 索引与日志都是**跨 run 增量**的（M379：同一天多次跑、多 mission 共用同一日期目录是常态）：
  // `run.log` / `app.log` 都是追加写，补一条 run 头把两次 run 的段落分开（summary.md /
  // results.json 的合并口径见 evidence.mjs 的 writeSummary）。
  const appLogFile = path.join(root, "app.log");
  const runHeader =
    `===== run ${new Date().toISOString()} pid=${process.pid} 场景 ${selected.length} 个：` +
    `${selected.map((s) => s.id).join(" ")} =====`;
  await appendRunLog(root, runHeader);
  appendFileSync(appLogFile, `${runHeader}\n`);

  cu = await CuClient.start();
  log("KimiCU MCP 已连接\n");

  const results = [];
  let invalidCount = 0;
  for (const scenario of selected) {
    const t0 = Date.now();
    log(`▶ ${scenario.id}（backlog 项 ${scenario.item}）${scenario.title}`);
    let fgNote = "";
    let out;
    // 本场景启动是否有会话恢复段（M516）：决定两次启动（首启 / `restart`）要不要先等恢复跑完
    // 再钉窗。判据是**静态 seed**，因此 `restart` 那一段只覆盖 seed 带标签的场景——边界与理由
    // 写在 restartApp 内的注释里。见 seedHasRestoredTabs 与 drive.mjs 的 waitStartupRestore。
    const restoreTabsAtStartup = seedHasRestoredTabs(scenario.seed);
    // 基建阶段标记：这一段里任何异常都说明「实例没起来 / 环境不可用」——整场判 INVALID（退出码
    // 2），不按产品判红记（退出码 1）。越过 `runScenario` 之后，异常才是场景自己的事。
    let setupPhase = true;
    try {
      await resetVault();
      // 场景 front-matter 声明的 vault fixture 必须在**起 app 之前**落进 vault（M516）。
      // `fixtures:` 是场景的**初始状态**声明：`.md` 由 `resetVault` 铺，非 `.md`
      // （`x.jsonc` / `var-highlight.js` / `.gitignore` / `notes.txt` …）只由这一句铺。产品在
      // **打开 vault 时**做首次枚举与会话恢复，晚于它的拷贝会让「以初始状态为判据」的场景拿到
      // 缺文件的 vault——M516 实测：场景 49 的会话种子里 3 个非 md 标签（x.jsonc /
      // var-highlight.js / var-highlight.lua）在装载时文件还不存在，恢复段的「在不在 vault 内」
      // 探测如实判它们不在场并丢弃，runner 启动恒出 43/46。
      //
      // 此前这句在 `execute.mjs` 的 `runScenario` 开头（= 起 app **之后**），与 `app.mjs` 的
      // `resetVault` 注释里写着的「copyFixture 在本函数之后重拷」漂了位置（REVIEW.md 「同一语义两处真源」条
      // 同族：同一件事两处实现、口径不一致）；挪回声明的位置后，场景的首帧就是它声明的起点
      // ——与 `config:` 折叠进 `launchApp`（M284）同一取向。
      if (scenario.fixtures) for (const f of scenario.fixtures) await copyFixture(f);
      await resetSecondVault(); // 第二个合成 vault：多 vault 场景的切换目标
      await resetRecovery(); // 备份目录在隔离配置下，不清会让上一场景的备份串场
      await resetHarness(); // 对话面板 JSONL 同因：在隔离配置下，不清会跨场景串记录（M304 实证）
      // 注册表与会话也在隔离配置下：前者决定列表浮层有几行、后被哪些 id 命中，后者决定装载后
      // 恢复哪些标签——两者残留都会让本场景看到上一场景的状态（与 recovery 同因）。
      await resetRegistry();
      await resetSessions();
      await resetPositions(); // 阅读位置（M194）：同上，残留会让下一场景一打开文件就换位置
      // 窗口尺寸存档（M437）：与 recovery / vault-sessions 同因——它在隔离配置目录根下，
      // 残留会让本场景的「首启」读到上一场景的窗口尺寸（M434 起首启 = 工作区 90%、
      // 其后按存档恢复，窗口几何断言正对着这个量判）。
      await resetWindowState();
      // 场景自己的注册表 / 会话预置：**必须在 launchApp 之前**（见 prepareSeed 的说明）。
      await prepareSeed(scenario.seed);
      const scenarioConfig = Object.fromEntries(
        SCENARIO_CONFIG_KEYS.filter((k) => scenario.config?.[k] !== undefined).map((k) => [k, scenario.config[k]]),
      );
      // 场景 front-matter 的 `config:`：**在起 app 之前**写进隔离 config.json（M284）。
      // 早先这里是裸 `writeConfig({mode:"md"})`，场景配置靠 runScenario 里的第二次写 + 一次重启
      // 生效。折叠到这里之后 app 的**首帧**就是场景声明的起点（与「窗口配置只有一份
      // 真源」同一取向，见 REVIEW.md 「同一语义两处真源」条），也省掉每次约 6–8s 的重启。
      // 键的白名单是 `SCENARIO_CONFIG_KEYS`（单点真源，`--check` 用同一份挡拼错）；缺省值在场
      // 时不传（传 `undefined` 会被 writeConfig 忽略，故先滤掉）。
      await writeConfig({
        mode: "md",
        language: SUITE_LANGUAGE,
        ...scenarioConfig,
      });
      if (handle) await stopApp(handle);
      handle = await launchApp({ logFile: appLogFile });
      await sleep(1200);
      await waitAppReady(cu, handle.pid); // 前端就绪门：左栏文件树 + 编辑器节点就位再开跑
      // M516：钉窗口之前先等**启动会话恢复**跑完（只有会恢复标签的场景才有这一段，见
      // seedHasRestoredTabs）。就绪门判的是「树 + 编辑器就位」，而产品在树渲染**之后**才起
      // 恢复段——就绪门一过立刻钉窗，AXSize 写就落在恢复段里。这是排序隐患不是本次丢标签的
      // 成因（成因见上面 fixtures 那一句；10s 零 AX 的对照实验同样丢成 43），详见 drive.mjs
      // 的 waitStartupRestore。
      let restoreNote = "";
      if (restoreTabsAtStartup) {
        const restore = await waitStartupRestore(cu, handle.pid);
        restoreNote = restore.settled
          ? `启动恢复：标签条已建壳 ${restore.tabs} 个标签（等 ${restore.ms}ms）`
          : `⚠ 启动恢复：${restore.ms}ms 内标签条一直没出现标签（最后读数 ${restore.tabs}）——` +
            "本次钉窗仍落在恢复窗口内，恢复为空或恢复段异常时都会是这个形态，交由场景断言判";
        log(`  ${restoreNote}`);
      }
      // M491：就绪后把窗口钉到构建配置的占位尺寸（产品侧 apply_startup_size 的首启 90% /
      // 存档恢复会盖过它，坐标/像素敏感场景需要确定几何）。豁免场景（目前是 126，其判据本体
      // 就是启动行为）走原始几何。钉尺寸的结果（回读生效宽高）经 fgNote 一并落进证据行。
      const pinWindow = !NO_PIN_WINDOW_SCENARIOS.has(scenario.id);
      let pinNote = "";
      if (pinWindow) {
        pinNote = await pinWindowSize(cu, handle.pid, suiteWindowSize());
        log(`  ${pinNote}`);
      }
      // tower 纪律：键盘场景先尽力拿前台并如实记录（拿不到不中止——行为断言才是注入是否落地的证据）。
      // 手段与失败原因由 `drive.mjs` 的 foregroundNote 统一成一行（M478）：用了 AXRaise 还是
      // System Events、失败时的 osascript stderr 全落进证据——此前只有「已取得 / 未取得」两个词，
      // 复盘时分不出「激活没投出去」与「投出去了没生效」。
      const fg = await tryForeground(cu, handle.pid);
      fgNote = [restoreNote, pinNote, foregroundNote(fg)].filter(Boolean).join("\n");
      log(`  ${foregroundNote(fg)}`);
      const ctx = {
        cu,
        foregroundNote: fgNote,
        pid: handle.pid,
        evidence,
        repoRoot: repoRoot(),
        restartApp: async ({ requireVault = true, beforeLaunch } = {}) => {
          await stopApp(handle);
          // 停止之后、启动之前这个空窗（M437）：写 `window-state.json` 这类「只该在一次启动
          // 开始时在场的」现场必须落在这里——app 退出时会 flush 窗口尺寸存档，在它还活着时
          // 预置会被那次 flush 覆盖（`do: restart` 的 `windowState:` 参数走这条钩子）。
          if (beforeLaunch) await beforeLaunch();
          handle = await launchApp({ logFile: appLogFile });
          await sleep(1200);
          // requireVault: false = 本步期待「未打开空态」（如 last_vault 失效），就绪门放宽为
          // 「树 pane 任一形态 + 编辑器在位」。默认仍是严格门（树里有 .md 行）。
          await waitAppReady(cu, handle.pid, { requireVault });
          // M516：这一段的路由判据是 `restoreTabsAtStartup`（见上，**静态 seed**），所以门只覆盖
          // **seed 带会话标签**的场景。首启那一段语义完整；重启这一段有已知边界：前半程自己写
          // 出会话、再 `do: restart` 的场景（10 个带 `restart` 的场景里 9 个属此类，如
          // `28-remember-reading-position`）seed 里没有 tabs，门不触发 ⇒ 这些场景重启后**仍可能
          // 把钉窗落进恢复窗口**。按「不做动态分流」收口：这是排序纪律不是任何已知失败的成因
          // （见 drive.mjs 的 waitStartupRestore），观测无影响；要覆盖它得在重启前回读当前会话
          // （动态判据），属后续候选，不在本 mission。
          let restoreNote2 = "";
          if (restoreTabsAtStartup) {
            const restore2 = await waitStartupRestore(cu, handle.pid);
            restoreNote2 = restore2.settled
              ? `重启恢复：标签条已建壳 ${restore2.tabs} 个标签（等 ${restore2.ms}ms）`
              : `⚠ 重启恢复：${restore2.ms}ms 内标签条一直没出现标签（最后读数 ${restore2.tabs}）——` +
                "重启后本就没有恢复标签时是这个形态，交由场景断言判";
          }
          let pinNote2 = "";
          if (pinWindow) {
            pinNote2 = await pinWindowSize(cu, handle.pid, suiteWindowSize(), { prefix: "重启" });
          }
          const fg2 = await tryForeground(cu, handle.pid);
          ctx.foregroundNote = [restoreNote2, pinNote2, foregroundNote(fg2, { prefix: "重启前台焦点" })]
            .filter(Boolean)
            .join("\n");
          ctx.pid = handle.pid;
        },
      };
      setupPhase = false; // 越过这一行，异常才是场景自己的事（产品面）
      out = await runScenario(ctx, scenario);
    } catch (e) {
      // 基建错误（app 起不来 / 前端未就绪 / KimiCU AX 服务退化 / 动作内部的重启起不来）与产品
      // 判红分开表达：前者整场标 INVALID、整轮退出码升到 2（本次读数不可用于判产品缺陷，请复跑），
      // 后者照旧 FAIL（退出码 1）。混在一起时复盘只能靠人读步骤形态区分——M281 实证（finding
      // `.tower/comms/findings/20260928-worker-impl-goto-line-c-improve-0-1-pass-1.md`，本批
      // 的退出码分档见 backlog「批次报告索引」的 M282 遗留条）。
      if (setupPhase || e instanceof InfraError) {
        invalidCount += 1;
        log(`  ⚠ 运行环境无效（非产品判红，请复跑）：${e.message}`);
        out = await recordInvalid(scenario, e);
      } else {
        log(`  ✗ 场景异常：${e.message}`);
        out = { status: "FAIL", records: [{ kind: "assert", ok: false, label: "[场景异常]", detail: e.message }] };
      }
    }
    setupPhase = false;
    const seconds = (Date.now() - t0) / 1000;
    results.push({
      id: scenario.id,
      item: scenario.item,
      title: scenario.title,
      status: out.status,
      asserts: out.records.filter((r) => r.kind === "assert").length,
      failed: out.records.filter((r) => r.kind === "assert" && !r.ok).length,
      seconds,
      at: new Date().toISOString(),
    });
    log(`  ${out.status}  ${seconds.toFixed(1)}s  ${path.join(root, scenario.id)}`);
    for (const f of out.records.filter((r) => r.kind === "assert" && !r.ok)) log(`    ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ""}`);
    await appendRunLog(root, `${new Date().toISOString()} ${scenario.id} ${out.status}`);
  }

  const summary = await writeSummary(root, results);
  log(`\n结论：${summary.pass}/${summary.total} PASS。报告：${summary.summaryPath}`);
  if (invalidCount) {
    log(
      `⚠ 本次运行有 ${invalidCount} 个场景属「运行环境无效」（status.txt = INVALID）：这些读数**不能**\n` +
        "  用于判产品缺陷，也不计入产品失败；请复跑这几个场景后再下结论。",
    );
  }
  return { ...summary, invalidCount };
}

/**
 * 场景级基建错误的收尾（M379）：保证该场景仍有证据目录，且 `status.txt` 写成 `INVALID`
 * ——与产品判红的 `FAIL` 在目录里就能分开 grep（backlog M281 条要求两者可区分）。
 *
 * 两种到达路径：① 基建阶段就抛（这时场景目录还没建，由这里补建）；② 场景跑了一半抛
 * InfraError（runScenario 已建目录、已记过一条 `[运行环境无效]`，这里只补终态，**不重开目录**
 * ——重开会把已经落盘的现场清掉）。
 */
async function recordInvalid(scenario, e) {
  if (evidence.scenarioId !== scenario.id) {
    await evidence.startScenario(scenario.id, {
      id: scenario.id,
      item: scenario.item,
      title: scenario.title,
      file: path.relative(repoRoot(), scenario.file),
      startedAt: new Date().toISOString(),
    });
    evidence.record({ kind: "assert", ok: false, label: "[运行环境无效]", detail: e.message });
  }
  evidence.statusOverride = "INVALID";
  const { status } = await evidence.finish();
  return { status, records: evidence.records };
}

/**
 * 退出路径全覆盖：正常结束 / 断言失败 / 异常走 `finally`，SIGINT / SIGTERM 走 signal 钩子，
 * 另有 `exit` 兜底（`process.exit` 那条路径也不漏）。删锁本身幂等，重复调用无副作用。
 * 信号路径只释放锁、不回收已起的 app 实例——残留实例由下次跑批的 `reclaimPort` 处理（本 worktree 的
 * 被回收，别的 worktree 的按「非本 worktree 进程」报错，不静默）。
 */
for (const [sig, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.on(sig, () => {
    log(`\n收到 ${sig}：释放跑批锁后退出（已起的 app 实例按残留处理）`);
    releaseRmachineLock();
    process.exit(code);
  });
}
process.on("exit", () => {
  releaseRmachineLock();
});

let exitCode = 0;
try {
  const summary = await main();
  // 退出码分档（M379）：0 = 全 PASS、1 = 有场景判红（产品面）、2 = 基建错误（app 起不来 /
  // 前端未就绪 / 被跑批锁挡住 / 环境无效运行）。分档的用途是让调用方一眼分开「产品有问题」
  // 与「这次运行本身不算数」——M281 的三次无效运行与真判红都报 0/1 PASS + 退出码 1，
  // 只能靠人读步骤形态区分。
  exitCode = summary.invalidCount ? 2 : summary.pass === summary.total ? 0 : 1;
} catch (e) {
  // 锁被占：持有人信息是给人看的，原样走 stderr；退出码并入「运行失败」（2）。
  if (e instanceof LockBusyError) process.stderr.write(`${e.message}\n`);
  else log(`运行失败：${e.message}`);
  exitCode = 2;
} finally {
  if (!keepApp && handle) await stopApp(handle);
  if (keepApp && handle) log(`app 保留运行中：pid ${handle.pid}（vault ${vaultDir()}，配置 ${envHome()}）`);
  await cu?.stop();
  if (releaseRmachineLock()) log(`跑批锁已释放：${RMACHINE_LOCK}`);
}
process.exit(exitCode);
