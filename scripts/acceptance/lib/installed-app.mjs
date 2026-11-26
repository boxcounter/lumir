// 安装版显式暂停通道（change add-acceptance-installed-app-pause）——只在
// `node scripts/acceptance/run.mjs --pause-installed …` 时触达 `/Applications/Lumir.app`。
//
// 为什么需要它：起跑自检（`assertNoForeignLumir`）会把同机任何 Lumir 实例挡住，而用户手头
// 常驻的安装版正是其中一类。此前只能由人先 ⌘Q（README「被挡住的非在途实例」），agent 跑批
// 因此卡在人肉节点上。本通道把「暂停安装版」做成一条可复核的机器流程，并且**只做暂停**：
//
//   1. 默认行为完全不变：没有 `--pause-installed` 时本模块一行都不执行；
//   2. 目标只认唯一、canonical 的 `/Applications/Lumir.app` + 产品 bundle id + 可读 pid /
//      startedAt；dev 实例、验收 bundle、多实例、归属不明一律拒绝（退出码 2、零副作用）；
//   3. 暂停前必须拿到**保存屏障的正向完成信号**（产品侧 `document.save-all` 的 D1035 toast）；
//      任一步失败 / 超时 / 新 dirty / AX 不可读都**不 ⌘Q、不跑批**——不得以「没有错误提示 /
//      AX 空树 / dirty 点消失」冒充成功；
//   4. 只用按 pid 激活 + 正常 ⌘Q，等**原 pid 消失**；禁止 Apple Event quit、SIGTERM / SIGKILL /
//      pkill，禁止绕过 dirty 守卫。保存或退出受阻 → 退出码 2、保留现场；
//   5. 安装版退出后**不重开、不恢复**（Alex 2026-11-26 决定：「退出后就不需要恢复了，如果我
//      需要用安装版我会自己启动」）。本模块没有任何恢复出口——崩溃 / 断电同样没有入口；
//   6. 暂停是**全机独占**的：独立暂停锁（`/tmp/lumir-acceptance-installed-pause.lock`）+
//      活动 runner 登记（`/tmp/lumir-acceptance-runners/`）防第二次暂停与普通跑批并发；
//      自定义 vault 的普通并行保留（普通跑批只在**暂停进行中**被挡）。锁与登记只释放自己的
//      session（pid 不符一律不删）。
//
// 证据口径：只写 pid / app path / bundle id / 阶段 / 计数 / 错误，**不写**真实 vault 名、
// 标签标题或正文；安装版阶段默认不截图（读 AX 一律 `mode: "ax"`，不带图）。
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { findNode, parseNodes } from "./ax.mjs";

/** 安装版的 canonical 位置：只认这一份（其他 `.app` 副本一律视为「归属不明」）。 */
export const INSTALLED_APP_PATH = "/Applications/Lumir.app";

/** 独立暂停锁：与跑批独占锁分开——它守的是「正在动用户的安装版」这一段。 */
export const PAUSE_LOCK = "/tmp/lumir-acceptance-installed-pause.lock";

/** 活动 runner 登记目录：每条真跑批一个 `<pid>.json`，暂停据此判断「同机有没有别人在跑」。 */
export const RUNNER_REGISTRY_DIR = "/tmp/lumir-acceptance-runners";

/** 保存全部的**机器可读状态标记**（产品 `src/save-all.ts` 维护）：`save-all#<代次> <状态>`。
 *
 *  为什么不用 toast 文本当判据（K3 P1-3）：toast 只活 3.5s，且每次成功都发同一句文本——验收
 *  通道若只认文本，会把上一次保存的旧 toast（或并发第二次触发的 toast）当成这一次的完成信号。
 *  标记带**操作代次**：验收通道读取触发前的代次，只接受「代次更大且状态 ok」的标记；旧信号、
 *  并发 busy、失败都不可能让它提前放行。标记是视觉隐藏的机器面（`main.ts` 的 saveAllMarker），
 *  与用户可读 toast 并存但彼此独立。
 */
export const SAVE_ALL_MARKER_RE = /^save-all#(\d+) (idle|running|ok|failed|busy)$/;

/** `etime` 反推的 startedAt 只有秒级精度：两次复核之间允许 2s 的读数漂移，超出即视为
 *  「pid 被复用 / 换了进程」。 */
export const STARTED_AT_TOLERANCE_MS = 2_000;

/** 暂停被拒绝（前置条件不成立、**零副作用**）或暂停失败（碰过安装版 / 已停在半路）。
 *  两者都由 runner 映射成退出码 2——「本次运行的读数不算数」，与产品 FAIL（1）分开。 */
export class PauseRefused extends Error {}
export class PauseFailed extends Error {}

/**
 * 真实默认执行器：返回 **stdout 文本**；spawn 失败或退出码非零一律抛错（带 `status` / `stderr`）。
 *
 * 不能把 `spawnSync` 的返回对象直接当字符串用（那会固定得到 `[object Object]`，K3 P1-2）：
 * 这是激活通道的默认实现，真机上每一次「按 pid 激活」都会走它。测试用真实可执行
 * （`/usr/bin/printf` / 临时 shell 桩）覆盖这条默认通道，不只 mock `exec` 函数。
 */
export function execText(cmd, args, { spawnSync: spawn = spawnSync } = {}) {
  const result = spawn(cmd, args, { encoding: "utf8" });
  if (result?.error) throw result.error;
  if (result?.status !== 0) {
    const stderr = String(result?.stderr ?? "").trim();
    const error = new Error(`${cmd} 退出码 ${result?.status ?? "未知"}${stderr ? `：${stderr}` : ""}`);
    error.status = result?.status;
    error.stderr = result?.stderr;
    throw error;
  }
  return String(result?.stdout ?? "");
}

const defaultExec = execText;

/** `/Applications/Lumir.app` 的 canonical 形态（存在则 realpath，不存在则按字面 resolve）。 */
export function canonicalAppPath(appPath = INSTALLED_APP_PATH, { realpath = realpathSync } = {}) {
  try {
    return realpath(appPath);
  } catch {
    return path.resolve(appPath);
  }
}

/** 从 `ps` 的 command 里截出 `.app` 根（`…/Lumir.app/Contents/MacOS/lumir` → `…/Lumir.app`）。 */
export function appPathOfInstance(cmd) {
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const idx = String(cmd ?? "").lastIndexOf(marker);
  return idx > 0 ? String(cmd).slice(0, idx) : null;
}

function sameAppPath(candidate, canonical, { realpath }) {
  if (candidate === null) return false;
  return canonicalAppPath(candidate, { realpath }) === canonical;
}

const REFUSAL_TEXT = {
  "foreign-instance": "同机存在非 canonical 安装版以外的 Lumir 实例（dev / 验收 bundle / 其他副本）",
  "multiple-instances": "canonical 安装版有不止一个实例",
  "identity-unreadable": "安装版实例的 pid / startedAt 不可读",
  "bundle-id-unreadable": "安装版 Info.plist 的 CFBundleIdentifier 读不到",
  "bundle-id-mismatch": "安装版的 bundle id 与产品 id 不一致",
};

export function refusalText(decision) {
  const base = REFUSAL_TEXT[decision?.reason] ?? `未知拒绝原因（${decision?.reason}）`;
  const details = (decision?.details ?? [])
    .map((i) => `pid ${i?.pid ?? "未知"}（${i?.cmd ?? "路径未知"}）`)
    .join("；");
  return details ? `${base}：${details}` : base;
}

/**
 * 目标发现（纯函数，可注入）：返回
 *   - `{ running: false, refused: false }`：没有安装版在跑（**不是错误**，收尾不得凭空拉起）；
 *   - `{ running: true, target }`：唯一、canonical、产品 bundle id、pid / startedAt 可读；
 *   - `{ refused: true, reason }`：任何不确定的现场（多实例 / 别的副本 / 读不到身份）。
 *
 * 「别的副本」包括 dev 实例：它们同样会与套件实例争前台 / AX 归属，而暂停通道只处理安装版，
 * 遇到了就停手（零副作用）。
 */
export function discoverInstalledApp({
  instances = [],
  appPath = INSTALLED_APP_PATH,
  productId,
  readBundleId,
  realpath = realpathSync,
} = {}) {
  const canonical = canonicalAppPath(appPath, { realpath });
  const others = [];
  const canonicalOnes = [];
  for (const instance of instances) {
    const root = instance?.kind === "bundle" ? appPathOfInstance(instance.cmd) : null;
    if (sameAppPath(root, canonical, { realpath })) canonicalOnes.push(instance);
    else others.push(instance);
  }
  if (others.length > 0) return { running: false, refused: true, reason: "foreign-instance", details: others };
  if (canonicalOnes.length === 0) return { running: false, refused: false, reason: "not-running" };
  if (canonicalOnes.length > 1) {
    return { running: false, refused: true, reason: "multiple-instances", details: canonicalOnes };
  }
  const instance = canonicalOnes[0];
  const pid = Number(instance.pid);
  if (!Number.isInteger(pid) || pid <= 0 || typeof instance.startedAt !== "number") {
    return { running: false, refused: true, reason: "identity-unreadable", details: [instance] };
  }
  let bundleId;
  try {
    bundleId = String(readBundleId(canonical)).trim();
  } catch (e) {
    return {
      running: false,
      refused: true,
      reason: "bundle-id-unreadable",
      details: [instance],
      message: e?.message ?? String(e),
    };
  }
  if (!bundleId) {
    return { running: false, refused: true, reason: "bundle-id-unreadable", details: [instance] };
  }
  if (bundleId !== productId) {
    return { running: false, refused: true, reason: "bundle-id-mismatch", details: [instance], bundleId };
  }
  return {
    running: true,
    refused: false,
    target: { pid, appPath: canonical, bundleId, startedAt: instance.startedAt, cmd: instance.cmd },
  };
}

/** 保存前 / ⌘Q 前的身份复核：必须还是**同一个进程**（pid + startedAt 容差）、同一个 app 根、
 *  同一个 bundle id。任何一项不成立都抛 `PauseFailed`（现场不动）。 */
export function verifyInstalledTarget(
  target,
  { instances = [], productId, readBundleId, realpath = realpathSync, toleranceMs = STARTED_AT_TOLERANCE_MS } = {},
) {
  const decision = discoverInstalledApp({
    instances,
    appPath: target.appPath,
    productId,
    readBundleId,
    realpath,
  });
  if (decision.refused) throw new PauseFailed(`身份复核失败：${refusalText(decision)}`);
  if (!decision.running) throw new PauseFailed("身份复核失败：安装版实例在暂停过程中消失");
  const next = decision.target;
  if (next.pid !== target.pid) {
    throw new PauseFailed(`身份复核失败：pid 已从 ${target.pid} 变为 ${next.pid}`);
  }
  if (Math.abs(next.startedAt - target.startedAt) > toleranceMs) {
    throw new PauseFailed(
      `身份复核失败：pid ${target.pid} 的启动时刻与保存前不一致（${target.startedAt} vs ${next.startedAt}）——pid 可能已被复用`,
    );
  }
  if (next.bundleId !== target.bundleId) {
    throw new PauseFailed(`身份复核失败：bundle id 已从 ${target.bundleId} 变为 ${next.bundleId}`);
  }
  return next;
}

// ---------------------------------------------------------------------------
// 暂停锁与活动 runner 登记
// ---------------------------------------------------------------------------

const defaultFs = { readFileSync, readdirSync, rmSync };

function readPidField(dir, fs) {
  try {
    const pid = Number(String(fs.readFileSync(path.join(dir, "pid"), "utf8")).trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function readTextOrEmpty(file, fs) {
  try {
    return String(fs.readFileSync(file, "utf8")).trim();
  } catch {
    return "";
  }
}

/** pid 是否存活（`EPERM` 也算活着：进程在、只是不归本用户）。 */
export function pidAlive(pid, { kill = process.kill } = {}) {
  try {
    kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}

/** 暂停锁的持有人读数：`{ pid, startedAt, cwd, owned }`。`pid` 读不到时为 null。 */
export function readPauseLockHolder({ dir = PAUSE_LOCK, fs = defaultFs } = {}) {
  const pid = readPidField(dir, fs);
  return {
    pid,
    startedAt: readTextOrEmpty(path.join(dir, "startedAt"), fs),
    cwd: readTextOrEmpty(path.join(dir, "cwd"), fs),
    owned: pid !== null && pid === process.pid,
  };
}

function holderLine(holder) {
  return [
    holder.pid !== null ? `pid ${holder.pid}` : "pid 未知",
    holder.startedAt ? `起于 ${holder.startedAt}` : "启动时间未知",
    holder.cwd ? `cwd ${holder.cwd}` : "cwd 未知",
  ].join("，");
}

/**
 * 拿暂停锁：`mkdir` 原子抢锁（EEXIST = 已被占）。持有人存活 → `PauseRefused`；pid 已死 →
 * 视为崩溃残留回收重建（与跑批独占锁同口径）；读不到 pid → 拒绝（宁可挡住，不冒双动风险）。
 */
export async function acquirePauseLock({
  dir = PAUSE_LOCK,
  pid = process.pid,
  now = Date.now,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
  mkdirSync: makeDir = mkdirSync,
  writeFileSync: writeFile = writeFileSync,
  rmSync: remove = rmSync,
  readFileSync: readFile = readFileSync,
  kill = process.kill,
} = {}) {
  const fs = { readFileSync: readFile, readdirSync, rmSync: remove };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      makeDir(dir);
    } catch (e) {
      if (e?.code !== "EEXIST") throw new PauseFailed(`建暂停锁失败（${dir}）：${e.message}`);
      let holder = readPauseLockHolder({ dir, fs });
      for (let i = 0; i < 20 && holder.pid === null; i++) {
        await sleepFn(50); // 对方可能刚 mkdir、pid 还没落盘
        holder = readPauseLockHolder({ dir, fs });
      }
      if (holder.pid !== null && pidAlive(holder.pid, { kill })) {
        throw new PauseRefused(
          [
            `✗ 已有安装版暂停在进行，拒绝第二次暂停（独立暂停锁 ${dir}）`,
            `  持有人：${holderLine(holder)}`,
            "  暂停会动用户正在运行的安装版，必须全机独占；等它结束再重试。",
          ].join("\n"),
        );
      }
      if (holder.pid === null) {
        throw new PauseRefused(
          [
            `✗ 暂停锁存在但读不到 pid（${dir}）：不排除是崩溃残留，也可能有人正在建锁`,
            `  确认没有暂停在跑之后手工删除它：rm -rf ${dir}`,
          ].join("\n"),
        );
      }
      // 持有人已死：崩溃残留，回收重建（与跑批独占锁同口径；不删任何**活**会话的锁）。
      remove(dir, { recursive: true, force: true });
      continue;
    }
    try {
      writeFile(path.join(dir, "pid"), `${pid}\n`);
      writeFile(path.join(dir, "startedAt"), `${new Date(now()).toISOString()}\n`);
      writeFile(path.join(dir, "cwd"), `${process.cwd()}\n`);
    } catch (e) {
      try {
        remove(dir, { recursive: true, force: true });
      } catch {
        /* 尽力而为 */
      }
      throw new PauseFailed(`写暂停锁内容失败（${dir}）：${e.message}`);
    }
    return { dir, pid };
  }
  throw new PauseFailed(`建暂停锁反复失败（${dir}）`);
}

/** 释放暂停锁：**只在锁里记的还是自己 pid 时删**（不释放别人的 session）。返回是否真的删了。 */
export function releasePauseLock({ dir = PAUSE_LOCK, pid = process.pid, fs = defaultFs } = {}) {
  const holder = readPauseLockHolder({ dir, fs });
  if (holder.pid !== pid) return false;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** 读活动 runner 登记：返回 `{ entries, unknown }`——`entries` 是 pid 可读的条目，`unknown`
 *  是登记文件存在但读不出 pid 的（调用方把 unknown 也当成「有人可能在跑」）。 */
export function listActiveRunners({ dir = RUNNER_REGISTRY_DIR, fs = defaultFs, kill = process.kill } = {}) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return { entries: [], unknown: [] };
  }
  const entries = [];
  const unknown = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let parsed = null;
    try {
      parsed = JSON.parse(String(fs.readFileSync(file, "utf8")));
    } catch {
      unknown.push({ file, pid: null });
      continue;
    }
    const pid = Number(parsed?.pid);
    if (!Number.isInteger(pid) || pid <= 0) {
      unknown.push({ file, pid: null });
      continue;
    }
    if (!pidAlive(pid, { kill })) continue; // 崩溃残留：不当成「有人在跑」，也不删别人的文件
    entries.push({
      file,
      pid,
      mode: typeof parsed?.mode === "string" ? parsed.mode : "run",
      startedAt: typeof parsed?.startedAt === "string" ? parsed.startedAt : "",
      cwd: typeof parsed?.cwd === "string" ? parsed.cwd : "",
      vault: typeof parsed?.vault === "string" ? parsed.vault : "",
    });
  }
  return { entries, unknown };
}

/** 登记本进程为活动 runner（真跑批启动时一次；退出时移除）。 */
export function registerActiveRunner({
  dir = RUNNER_REGISTRY_DIR,
  pid = process.pid,
  mode = "run",
  vault = "",
  now = Date.now,
  mkdirSync: makeDir = mkdirSync,
  writeFileSync: writeFile = writeFileSync,
} = {}) {
  makeDir(dir, { recursive: true });
  const file = path.join(dir, `${pid}.json`);
  writeFile(
    file,
    `${JSON.stringify({ pid, mode, vault, startedAt: new Date(now()).toISOString(), cwd: process.cwd() })}\n`,
  );
  return file;
}

/** 注销本进程的登记：只删**自己 pid 的那一份**（内容不符即不删，返回 false）。 */
export function unregisterActiveRunner({ dir = RUNNER_REGISTRY_DIR, pid = process.pid, fs = defaultFs } = {}) {
  const file = path.join(dir, `${pid}.json`);
  let parsed = null;
  try {
    parsed = JSON.parse(String(fs.readFileSync(file, "utf8")));
  } catch {
    return false;
  }
  if (Number(parsed?.pid) !== pid) return false;
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 暂停的全机独占判据（在**碰安装版之前**调用）：
 *   1. 暂停锁已被别人持有 → 拒绝第二次暂停；
 *   2. 有任何**别的**活动 runner（含别的 worktree 的普通跑批）→ 拒绝（暂停必须全机独占）；
 *   3. 登记目录里有读不出 pid 的条目 → 拒绝（归属不明）。
 * `ownPid` 是本次跑批自己的登记（在检查之前写入），检查时排除。
 */
export function assertPauseExclusive({
  pauseLockDir = PAUSE_LOCK,
  registryDir = RUNNER_REGISTRY_DIR,
  ownPid = process.pid,
  fs = defaultFs,
  kill = process.kill,
} = {}) {
  const holder = readPauseLockHolder({ dir: pauseLockDir, fs });
  if (holder.pid !== null && holder.pid !== ownPid && pidAlive(holder.pid, { kill })) {
    throw new PauseRefused(
      `✗ 已有安装版暂停在进行（暂停锁 ${pauseLockDir}，持有人 ${holderLine(holder)}）——拒绝第二次暂停`,
    );
  }
  const { entries, unknown } = listActiveRunners({ dir: registryDir, fs, kill });
  const others = entries.filter((entry) => entry.pid !== ownPid);
  if (others.length > 0) {
    throw new PauseRefused(
      [
        "✗ 同机有别的验收跑批在跑，拒绝暂停安装版（暂停必须全机独占）",
        ...others.map(
          (entry) =>
            `  活动 runner：pid ${entry.pid}（${entry.mode}${entry.vault ? `，vault ${entry.vault}` : ""}${
              entry.startedAt ? `，起于 ${entry.startedAt}` : ""
            }）`,
        ),
        "  等它跑完再重试；暂停会动用户正在运行的安装版，不能与别的跑批并行。",
      ].join("\n"),
    );
  }
  if (unknown.length > 0) {
    throw new PauseRefused(
      [
        "✗ 活动 runner 登记里有读不出 pid 的条目（归属不明），拒绝暂停安装版",
        ...unknown.map((entry) => `  ${entry.file}`),
        "  确认没有别的跑批在跑之后清理该登记目录再重试。",
      ].join("\n"),
    );
  }
}

/** 普通跑批启动时的判据：**暂停进行中**就拒绝启动（暂停全机独占）。已死的暂停锁是崩溃残留，
 *  由这里回收（不删任何活会话的锁）。 */
export function assertNoActivePause({ pauseLockDir = PAUSE_LOCK, fs = defaultFs, kill = process.kill } = {}) {
  const holder = readPauseLockHolder({ dir: pauseLockDir, fs });
  if (holder.pid === null) {
    // 锁不存在 / 读不到 pid：不存在时 readPidField 也回 null，两者不可区分——只有目录真的
    // 存在时才按「读不到」拒绝；不存在直接放行。
    let exists = false;
    try {
      fs.readdirSync(pauseLockDir);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) return { reclaimed: false };
    throw new PauseRefused(
      [
        `✗ 暂停锁存在但读不到 pid（${pauseLockDir}）：不排除有人正在暂停安装版`,
        `  确认没有暂停在跑之后手工删除：rm -rf ${pauseLockDir}`,
      ].join("\n"),
    );
  }
  if (pidAlive(holder.pid, { kill })) {
    throw new PauseRefused(
      `✗ 安装版暂停正在进行（暂停锁 ${pauseLockDir}，持有人 ${holderLine(holder)}）——暂停期间暂停全机独占，拒绝启动跑批`,
    );
  }
  // 持有人已死：崩溃残留，回收后放行。
  try {
    fs.rmSync(pauseLockDir, { recursive: true, force: true });
    return { reclaimed: true, holder };
  } catch {
    throw new PauseRefused(
      `✗ 暂停锁的持有人已死但回收失败（${pauseLockDir}）——确认无人在跑后手工删除它`,
    );
  }
}

// ---------------------------------------------------------------------------
// 与安装版交互（按 pid 激活 / 菜单触发 / 完成信号 / ⌘Q）
// ---------------------------------------------------------------------------

/**
 * 按 **pid** 把安装版提到前台（唯一允许的激活通道）。**按名字**的 Apple Event 一律禁止：
 *  `tell application "Lumir"` 会解析到别的副本，而且 Apple Event 直连 `terminate:`、不经过
 *  ⌘Q 的菜单守卫（dirty 时照样退出）——那正是丢数据的那条路。
 */
export async function activateByPid({
  pid,
  exec = defaultExec,
  osascriptPath = "/usr/bin/osascript",
  attempts = 3,
  everyMs = 300,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const script = [
    'tell application "System Events"',
    `  set p to first process whose unix id is ${Number(pid)}`,
    "  set frontmost of p to true",
    "  return frontmost of p",
    "end tell",
  ].join("\n");
  let last = "";
  for (let i = 0; i < attempts; i++) {
    try {
      last = String(exec(osascriptPath, ["-e", script]) ?? "").trim();
    } catch (e) {
      last = `osascript 失败：${e?.stderr ? String(e.stderr).trim() : e?.message ?? String(e)}`;
    }
    if (last === "true") return { attempts: i + 1 };
    await sleepFn(everyMs);
  }
  throw new PauseFailed(
    `按 pid 激活安装版失败（pid ${pid}）：${last || "System Events 没有返回 frontmost 读数"}——` +
      "不退回按名字激活（那会解析到别的副本，也可能绕开 ⌘Q 守卫）",
  );
}

function readAxOrFail(readState, pid, phase) {
  return Promise.resolve()
    .then(() => readState(pid))
    .catch((e) => {
      throw new PauseFailed(`读安装版 AX 失败（${phase}）：${e?.message ?? String(e)}`);
    });
}

function axNodesOrFail(text, phase) {
  const nodes = parseNodes(String(text ?? ""));
  if (nodes.length === 0) {
    throw new PauseFailed(`安装版 AX 树为空（${phase}）——不可读即判失败，不⌘Q、不跑批`);
  }
  return nodes;
}

async function pollNode({
  readState,
  pid,
  phase,
  role,
  name,
  timeoutMs,
  everyMs,
  sleepFn,
  now,
}) {
  const deadline = now() + timeoutMs;
  let reads = 0;
  for (;;) {
    const text = await readAxOrFail(readState, pid, phase);
    reads += 1;
    const nodes = axNodesOrFail(text, phase);
    const node = findNode(nodes, { role, name });
    if (node) return { node, reads };
    if (now() >= deadline) {
      throw new PauseFailed(`安装版 AX 里等不到 ${role} ${name}（${phase}，${reads} 次读取，${timeoutMs}ms）`);
    }
    await sleepFn(everyMs);
  }
}

/**
 * 经原生菜单触发保存全部：`File → Save All`。这是安装版**唯一**可由外部触发的保存屏障入口
 *  （菜单项不带 accelerator，见 lib.rs 的 add_save_all_item），因此必须真的走菜单。
 *
 * 判据全部是 AX 节点：`AXMenuBarItem` 名 `File`（裸正则源）、`AXMenuItem` 名 `Save All`；
 * 点击走 AXPress（KimiCU 的 index 通道）。任何一步读不到都抛 `PauseFailed`——不退回键盘
 * 快捷键（那条不存在）、不把「菜单没找到」当成「已经保存」。
 */
export async function triggerSaveAllMenuItem({
  pid,
  readState,
  click,
  timeoutMs = 8_000,
  everyMs = 250,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
} = {}) {
  const menuBar = await pollNode({
    readState,
    pid,
    phase: "menu-bar",
    role: "AXMenuBarItem",
    name: "^File$",
    timeoutMs,
    everyMs,
    sleepFn,
    now,
  });
  await click(pid, menuBar.node.index);
  const item = await pollNode({
    readState,
    pid,
    phase: "save-all-item",
    role: "AXMenuItem",
    name: "^Save All$",
    timeoutMs,
    everyMs,
    sleepFn,
    now,
  });
  await click(pid, item.node.index);
  return { reads: menuBar.reads + item.reads };
}

/** 从 AX 节点里解析保存全部状态标记；找不到 / 形态不符回 null（不猜）。 */
export function parseSaveAllMarker(nodes) {
  // 标记是视觉隐藏的 span：WKWebView 可能把它暴露成 AXStaticText，也可能挂在 AXGroup 的
  // label 上——两种都收；正文（AXTextArea）里恰好写着同形文本**不算**（它不是标记节点）。
  const candidate =
    findNode(nodes, { role: "AXStaticText", name: SAVE_ALL_MARKER_RE }) ??
    nodes.find((node) => {
      if (node.role !== "AXGroup") return false;
      const text = String(node.label ?? node.title ?? "").trim();
      return SAVE_ALL_MARKER_RE.test(text);
    });
  if (!candidate) return null;
  const text = String(candidate.title ?? candidate.label ?? candidate.value ?? "").trim();
  const match = SAVE_ALL_MARKER_RE.exec(text);
  return match ? { generation: Number(match[1]), state: match[2] } : null;
}

/** 读一次当前标记；读不到 / 形态不符即 `PauseFailed`（没有标记就没法把完成信号绑定到本次操作）。 */
export async function readSaveAllMarker({ pid, readState } = {}) {
  const text = await readAxOrFail(readState, pid, "save-all-marker");
  const nodes = axNodesOrFail(text, "save-all-marker");
  const marker = parseSaveAllMarker(nodes);
  if (!marker) {
    throw new PauseFailed(
      "安装版 AX 里找不到保存全部状态标记（save-all#N …）——无法把完成信号绑定到本次操作，不⌘Q、不跑批",
    );
  }
  return marker;
}

/**
 * 等**本次操作**的保存全部完成（K3 P1-3）：只接受代次大于 `baselineGeneration` 的标记。
 *
 * 判据：
 *   - 触发前代次（baseline）由调用方在**点菜单之前**读取；同一代次的旧 `ok` / `failed` 一律
 *     不算数（继续等到超时），因此上一次保存留下的旧信号不可能放行。
 *   - 代次更大且 `ok` → 成功；代次更大且 `failed` → 失败；代次更大且 `running` → 继续等。
 *   - `busy`（并发 / 重复触发被单飞拒绝）→ 立即失败，不等待、不把别人的成功当自己的。
 *   - 空树 / 读失败 / 缺标记 / 超时 → 失败（不可读 ≠ 成功）。
 */
export async function waitSaveAllCompletion({
  pid,
  readState,
  baselineGeneration,
  timeoutMs = 20_000,
  everyMs = 300,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
} = {}) {
  const deadline = now() + timeoutMs;
  let reads = 0;
  let last = null;
  for (;;) {
    const text = await readAxOrFail(readState, pid, "save-all-completion");
    reads += 1;
    const nodes = axNodesOrFail(text, `save-all-completion（第 ${reads} 次读取）`);
    const marker = parseSaveAllMarker(nodes);
    if (!marker) {
      throw new PauseFailed(
        "安装版 AX 里找不到保存全部状态标记（save-all#N …）——无法把完成信号绑定到本次操作，不⌘Q、不跑批",
      );
    }
    last = marker;
    if (marker.state === "busy") {
      throw new PauseFailed(
        `保存全部被并发触发拒绝（busy#${marker.generation}，触发前代次 ${baselineGeneration}）——` +
          "单飞不开新代次，本次没有属于它的完成信号；不⌘Q、不跑批",
      );
    }
    if (marker.generation > baselineGeneration) {
      if (marker.state === "ok") return { generation: marker.generation, reads };
      if (marker.state === "failed") {
        throw new PauseFailed(
          `保存屏障报告失败（save-all#${marker.generation} failed，触发前代次 ${baselineGeneration}）——不⌘Q、不跑批`,
        );
      }
    }
    if (now() >= deadline) {
      throw new PauseFailed(
        `等本次保存全部完成超时（${timeoutMs}ms，${reads} 次读取；触发前代次 ${baselineGeneration}，` +
          `最后标记 ${last ? `save-all#${last.generation} ${last.state}` : "无"}）——` +
          "同一代次的旧信号不算数，不⌘Q、不跑批",
      );
    }
    await sleepFn(everyMs);
  }
}

/**
 * 正常退出：按 pid 激活 → 发真实 **⌘Q**（走菜单守卫）→ 等**原 pid 消失**。
 * **不**用 Apple Event quit、**不**用 SIGTERM / SIGKILL / pkill；退出被挡住即 `PauseFailed`，
 * 现场原样保留（不清 dirty、不代点「放弃修改」）。
 */
export async function quitInstalledByCmdQ({
  pid,
  pressKey,
  findInstances,
  activate = (targetPid) => activateByPid({ pid: targetPid }),
  timeoutMs = 30_000,
  everyMs = 250,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
} = {}) {
  await activate(pid);
  await pressKey(pid, "cmd+q");
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  for (;;) {
    const alive = findInstances().some((instance) => Number(instance?.pid) === Number(pid));
    if (!alive) return { ms: now() - startedAt };
    if (now() >= deadline) {
      throw new PauseFailed(
        `⌘Q 后 ${timeoutMs}ms 内原 pid ${pid} 仍在场——保存 / 退出受阻（可能被未保存修改的退出守卫挡住，` +
          "或应用无响应）。按异常边界保留现场：不代为丢弃更改、不升级为 SIGTERM / SIGKILL。",
      );
    }
    await sleepFn(everyMs);
  }
}

// ---------------------------------------------------------------------------
// 编排：发现 → 身份 → 激活 → 菜单屏障 → 身份 → ⌘Q → 等 pid 消失
// ---------------------------------------------------------------------------

function evidenceLine(fields) {
  return `INSTALLED-PAUSE ${fields}`;
}

/**
 * 暂停安装版（只在 `requested` 为真时执行）。返回 `{ requested, touched, state, target }`：
 *   - `state: "not-running"`：安装版没在跑——**不拉起**，直接返回，跑批照常；
 *   - `state: "closed"`：安装版已保存并退出（**不重开、不恢复**，需要时由用户自己启动）；
 *   - 抛 `PauseRefused`：目标不成立（零副作用）；抛 `PauseFailed`：停在半路（现场保留）。
 *
 * 所有平台副作用（找进程 / 读 Info.plist / 激活 / 点菜单 / 读 AX / 发 ⌘Q）都由调用方注入，
 * 本函数只负责**顺序、判据与证据**——顺序错了（例如先 ⌘Q 再保存）在单测里就是红的。
 */
export async function runInstalledPause({
  requested,
  listInstances,
  productId,
  readBundleId,
  realpath = realpathSync,
  verifyTarget = verifyInstalledTarget,
  activate,
  readMarker,
  triggerSaveAll,
  waitSaveAll,
  quit,
  evidence = async () => {},
  state = {},
} = {}) {
  // 状态对象由调用方持有并就地更新：退出路径 / 信号路径据此如实声明「安装版现在是什么状态」
  //（closed = 已退出；stopped = 停在前面的阶段；not-running = 本来就没跑）。返回同一个对象。
  state.requested = Boolean(requested);
  state.touched = false;
  state.state = "skipped";
  state.target = null;
  if (!requested) return state;

  const phase = async (name, fields) => evidence(evidenceLine(`phase=${name} ${fields}`));

  const decision = discoverInstalledApp({
    instances: listInstances(),
    appPath: INSTALLED_APP_PATH,
    productId,
    readBundleId,
    realpath,
  });
  if (decision.refused) {
    await phase("discover", `result=refused reason=${decision.reason}`);
    throw new PauseRefused(`拒绝暂停安装版：${refusalText(decision)}`);
  }
  if (!decision.running) {
    await phase("discover", "result=not-running（本次不拉起安装版）");
    state.state = "not-running";
    return state;
  }

  const target = decision.target;
  state.target = target;
  const safe = `pid=${target.pid} app=${target.appPath} bundle=${target.bundleId} startedAt=${new Date(
    target.startedAt,
  ).toISOString()}`;
  await phase("discover", `result=ok ${safe}`);

  const reverify = (checkpoint) => {
    verifyTarget(target, { instances: listInstances(), productId, readBundleId, realpath });
    return phase("identity", `checkpoint=${checkpoint} result=ok pid=${target.pid}`);
  };

  try {
    await reverify("before-save");
    await activate(target.pid);
    state.touched = true;
    await phase("activate", `result=ok pid=${target.pid}`);

    // 触发前读取代次基线：只接受比它更大的完成标记（K3 P1-3）。基线本身正在跑（running）
    // 说明另一次保存全部在途——不并发触发，直接停手。
    const baseline = await readMarker(target.pid);
    await phase(
      "save-all-baseline",
      `result=ok pid=${target.pid} generation=${baseline.generation} state=${baseline.state}`,
    );
    if (baseline.state === "running") {
      throw new PauseFailed(
        `触发前已有保存全部在跑（save-all#${baseline.generation} running）——不并发触发，不⌘Q、不跑批`,
      );
    }
    await triggerSaveAll(target.pid);
    const signal = await waitSaveAll(target.pid, baseline.generation);
    await phase(
      "save-all",
      `result=ok pid=${target.pid} generation=${signal?.generation ?? "?"} baseline=${baseline.generation} reads=${signal?.reads ?? 0}`,
    );

    await reverify("before-quit");
    const quitInfo = await quit(target.pid);
    state.state = "closed";
    await phase("quit", `result=exited pid=${target.pid} ms=${quitInfo?.ms ?? 0}`);
  } catch (e) {
    await phase("failed", `pid=${target.pid} error=${JSON.stringify(String(e?.message ?? e).slice(0, 400))}`);
    throw e;
  }
  return state;
}

/**
 * 「先暂停、后 preflight」的顺序外壳（可单测）：暂停失败时 **不执行 preflight**（不跑批），
 * 暂停成功后 preflight **原样执行**——它是安装版退出之后的最终判据（同机仍应有零实例）。
 * 不做任何「暂停成功后跳过 preflight」的捷径：跳过就等于放弃了最终核对。
 */
export async function runPauseThenPreflight({ requested, pause, preflight } = {}) {
  if (requested) await pause();
  return preflight();
}

/**
 * 暂停控制错误 → runner 退出码：`PauseRefused` / `PauseFailed` 都是「本次运行的读数不算数」，
 * 与跑批三档退出码的第三档（2）对齐；其它错误返回 null，由 runner 的既有兜底处理。
 * 单测钉住这条映射——暂停失败不得被记成产品 FAIL（1），也不得被静默吞成 0。
 */
export function pauseFailureExitCode(error) {
  return error instanceof PauseRefused || error instanceof PauseFailed ? 2 : null;
}

/** 收尾声明（逐次跑批都要写进结果）：本通道**从不**重开 / 恢复安装版。 */
export function pauseClosingNote(outcome) {
  if (!outcome?.requested) return null;
  if (outcome.state === "closed") {
    return "安装版已按请求保持关闭，需时由用户自行启动（本通道不会自动重开或恢复）";
  }
  if (outcome.state === "not-running") {
    return "安装版当时未运行，本次未拉起（本通道不会自动启动安装版）";
  }
  return "安装版未由本通道关闭（暂停前已停手），现场保持原样；本通道不会自动重开或恢复";
}
