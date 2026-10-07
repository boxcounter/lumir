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
  SCENARIO_CONFIG_KEYS,
  stopApp,
  writeConfig,
} from "./lib/app.mjs";
import { tryForeground, waitAppReady } from "./lib/drive.mjs";
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
 * 缺省值仍由 `lib/app.mjs` 的 `acceptPort()` 单点定义（REVIEW.md 第 8 条），这里只把它回写进
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
 * 取值，不抄一份路径字面量——默认 vault 的真源只有一个（REVIEW.md 第 8 条）。
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
    // 基建阶段标记：这一段里任何异常都说明「实例没起来 / 环境不可用」——整场判 INVALID（退出码
    // 2），不按产品判红记（退出码 1）。越过 `runScenario` 之后，异常才是场景自己的事。
    let setupPhase = true;
    try {
      await resetVault();
      await resetSecondVault(); // 第二个合成 vault：多 vault 场景的切换目标
      await resetRecovery(); // 备份目录在隔离配置下，不清会让上一场景的备份串场
      await resetHarness(); // 对话面板 JSONL 同因：在隔离配置下，不清会跨场景串记录（M304 实证）
      // 注册表与会话也在隔离配置下：前者决定列表浮层有几行、后被哪些 id 命中，后者决定装载后
      // 恢复哪些标签——两者残留都会让本场景看到上一场景的状态（与 recovery 同因）。
      await resetRegistry();
      await resetSessions();
      await resetPositions(); // 阅读位置（M194）：同上，残留会让下一场景一打开文件就换位置
      // 场景自己的注册表 / 会话预置：**必须在 launchApp 之前**（见 prepareSeed 的说明）。
      await prepareSeed(scenario.seed);
      const scenarioConfig = Object.fromEntries(
        SCENARIO_CONFIG_KEYS.filter((k) => scenario.config?.[k] !== undefined).map((k) => [k, scenario.config[k]]),
      );
      // 场景 front-matter 的 `config:`：**在起 app 之前**写进隔离 config.json（M284）。
      // 早先这里是裸 `writeConfig({mode:"md"})`，场景配置靠 runScenario 里的第二次写 + 一次重启
      // 生效。折叠到这里之后 app 的**首帧**就是场景声明的起点（与 backlog:366「窗口配置只有一份
      // 真源」同一取向），也省掉每次约 6–8s 的重启。
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
      // tower 纪律：键盘场景先尽力拿前台并如实记录（拿不到不中止——行为断言才是注入是否落地的证据）。
      const fg = await tryForeground(cu, handle.pid);
      fgNote = fg.frontmost
        ? "前台焦点：已取得"
        : `前台焦点：未取得（前台 pid=${fg.frontPid ?? "未知"}）——键盘走 KimiCU 后台注入路径`;
      log(`  ${fgNote}`);
      const ctx = {
        cu,
        foregroundNote: fgNote,
        pid: handle.pid,
        evidence,
        repoRoot: repoRoot(),
        restartApp: async ({ requireVault = true } = {}) => {
          await stopApp(handle);
          handle = await launchApp({ logFile: appLogFile });
          await sleep(1200);
          // requireVault: false = 本步期待「未打开空态」（如 last_vault 失效），就绪门放宽为
          // 「树 pane 任一形态 + 编辑器在位」。默认仍是严格门（树里有 .md 行）。
          await waitAppReady(cu, handle.pid, { requireVault });
          const fg2 = await tryForeground(cu, handle.pid);
          ctx.foregroundNote = `重启前台焦点：${fg2.frontmost ? "已取得" : `未取得（pid=${fg2.frontPid ?? "?"}）`}`;
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
      // 的退出码分档见 backlog「M282 遗留」节）。
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
