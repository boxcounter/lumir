// 真实 app 的起停与运行环境准备。
//
// 三件事在这里被钉死（验收可复现的前提）：
//   1. 配置隔离：app 进程带 XDG_CONFIG_HOME=<results>/env 启动，套件自带 config.json。
//      Rust 侧 config_dir() 优先读 XDG_CONFIG_HOME（src-tauri/src/config.rs），
//      因此用户的 ~/.config/lumir 全程不被读写——[keys] 重绑场景可以随便改。
//   2. vault 重置：验收 vault 是合成 vault，每次运行重置为 fixtures 的精确副本。
//      用户真实 vault（/Users/boxcounter/Downloads/Everything-copy）永不写入。
//   3. 端口隔离：dev server 走独立端口，绝不与 Alex 手头的 `pnpm tauri dev` 抢 1420。
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { cp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CuError } from "./cu.mjs";
import { envHome, exists, log, mkdirp, readText, repoRoot, secondVaultDir, sleep, stripAnsi, vaultDir } from "./util.mjs";

export const BUNDLE_ID = "com.lumir.app";

export function acceptPort() {
  return Number(process.env.LUMIR_ACCEPTANCE_PORT ?? 1430);
}

export function fixturesDir() {
  return path.join(repoRoot(), "scripts/acceptance/fixtures");
}

/** 写隔离 config.json。`keys` 不传时整体不写该字段（默认无覆盖）。
 *  M180（change line-wrap-options）起支持 `lineWrap` / `codeBlockWrap`：**传了才写进 editor 表**
 *  ——两项缺失时应用走 Rust 侧 `Default`（line_wrap = true、code_block_wrap = false），
 *  这正是「默认口径」场景要的形态；显式写 false / true 才构造出另外三条组合。
 *  M195（change typography-and-zoom）起同样支持 `fontFamily` / `monoFontFamily` / `fontSize`：
 *  三个都**传了才写**，缺省即出厂口径（字体族沿用底线、字号 15）——与折行两项同一形态。
 *  M210（change restyle-ui-tokens-v1）起支持 `theme`：同样**传了才写**，且落在 `[ui]` 表上
 *  ——缺省时**整个 ui 表不写**，应用走 Rust 侧 `Default`（theme = light），这正是「未配置
 *  即 light」场景要的形态。 */
export async function writeConfig({
  lastVault = vaultDir(),
  mode = "md",
  lineWrap = undefined,
  codeBlockWrap = undefined,
  fontFamily = undefined,
  monoFontFamily = undefined,
  fontSize = undefined,
  theme = undefined,
  keys = undefined,
} = {}) {
  const dir = path.join(envHome(), "lumir");
  await mkdirp(dir);
  const editor = { mode };
  if (lineWrap !== undefined) editor.line_wrap = lineWrap;
  if (codeBlockWrap !== undefined) editor.code_block_wrap = codeBlockWrap;
  if (fontFamily !== undefined) editor.font_family = fontFamily;
  if (monoFontFamily !== undefined) editor.mono_font_family = monoFontFamily;
  if (fontSize !== undefined) editor.font_size = fontSize;
  const cfg = { version: 1, last_vault: lastVault, editor };
  if (theme !== undefined) cfg.ui = { theme };
  if (keys !== undefined) cfg.keys = keys;
  await writeFile(path.join(dir, "config.json"), `${JSON.stringify(cfg, null, 2)}\n`);
  return path.join(dir, "config.json");
}

export async function readConfig() {
  const file = path.join(envHome(), "lumir", "config.json");
  return JSON.parse(await readText(file));
}

/**
 * 清空崩溃备份目录。
 * 为什么必须做：备份目录在**隔离配置目录**下，不在验收 vault 里——只重置 vault 会让上一场景/上一轮的
 * 备份残留到本场景，使「启动发现残留备份」类场景读到别人的备份（实证：08c 恢复了 keys.md 的内容，
 * 而本场景用的是 plain.md），glob 断言也会因此假绿。每场景开始前必须清干净。
 */
export async function resetRecovery() {
  const dir = path.join(envHome(), "lumir", "recovery");
  await rm(dir, { recursive: true, force: true });
  return dir;
}

/** 把 vault 重置为 fixtures 的精确副本：只清 vault 根下的 .md（合成 vault 的既有内容形态）。 */
export async function resetVault() {
  const vault = vaultDir();
  await mkdirp(vault);
  for (const name of await readdir(vault)) {
    if (name.endsWith(".md")) await rm(path.join(vault, name), { force: true });
  }
  for (const name of await readdir(fixturesDir())) {
    if (!name.endsWith(".md")) continue;
    await cp(path.join(fixturesDir(), name), path.join(vault, name));
  }
  return vault;
}

/** 第二个合成 vault 的重置：内容取自 `fixtures/second-vault/`（与验收 vault 的文件名不重叠，
 *  切换前后的正文断言因此能互相区分）。同样只清根下的 .md。 */
export async function resetSecondVault() {
  const vault = secondVaultDir();
  const src = path.join(fixturesDir(), "second-vault");
  await mkdirp(vault);
  for (const name of await readdir(vault)) {
    if (name.endsWith(".md")) await rm(path.join(vault, name), { force: true });
  }
  for (const name of await readdir(src)) {
    if (!name.endsWith(".md")) continue;
    await cp(path.join(src, name), path.join(vault, name));
  }
  return vault;
}

/**
 * 清空 vault 注册表（隔离配置目录下的 `workspaces/`）。
 * 为什么必须做：注册表决定列表浮层里有哪些行、以及「按路径命中的 id」。多 vault 场景会预置
 * 注册项，残留到下一场景会让「单 vault」的预期看到两行（跨场景串场，与 recovery 同因）。
 */
export async function resetRegistry() {
  const dir = path.join(envHome(), "lumir", "workspaces");
  await rm(dir, { recursive: true, force: true });
  return dir;
}

/**
 * 清空按 vault 的标签会话（隔离配置目录下的 `vault-sessions/`）。
 * 为什么必须做：会话决定「装载完 vault 后恢复哪些标签」，残留会让本场景的启动恢复出上一场景
 * 的标签（08c 曾因 recovery 残留恢复出 keys.md 的内容——同族）。
 */
export async function resetSessions() {
  const dir = path.join(envHome(), "lumir", "vault-sessions");
  await rm(dir, { recursive: true, force: true });
  return dir;
}

/** 清掉按 vault 的阅读位置（M194，change remember-reading-position）。与 recovery / workspaces /
 *  vault-sessions 同因：它也在隔离配置目录下，残留会让下一个场景（或明天重跑本场景时）一打开文件
 *  就恢复上一轮留下的位置，而「本轮之前不存在」「mtime 已推进」这类断言正是靠这份空目录区分
 *  「本轮写的」与「上轮残留的」。 */
export async function resetPositions() {
  const dir = path.join(envHome(), "lumir", "reading-positions");
  await rm(dir, { recursive: true, force: true });
  return dir;
}

/** 注册项 id 的合法字符（与 Rust 侧 `workspaces::valid_id` 同源：id 同时是文件名，
 *  因此这是路径逃逸防护）。套件里显式校验，让写错 id 在动作处就报错而不是落一个读不回的盘。 */
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** 预置一条 vault 注册项（`<env>/lumir/workspaces/<id>.json`）——「这个目录已经是我的 vault」
 *  这一状态只能由注册表表达，而真机上走到它的唯一通道是系统目录选择器（套件不驱动原生
 *  对话框，见 README「已知边界」），因此多 vault 场景从预置注册表起步。
 *
 *  路径先 realpath：注册表存的是 canonicalize 后的路径（`reconcile_vault`），而 macOS 的
 *  `/tmp` 是 `/private/tmp` 的软链接——不归一的话 app 打开同一目录时会 `find_by_path` 落空、
 *  另生成一个 id，预置的会话（按 id 存放）就对不上了。 */
export async function writeRegistryEntry({ id, path: vaultPath, lastOpenedAt, missingSince, archivedAt }) {
  if (!ID_RE.test(id ?? "")) throw new CuError(`注册项 id 非法：${JSON.stringify(id)}（只允许字母数字与 -_）`);
  const dir = await mkdirp(path.join(envHome(), "lumir", "workspaces"));
  let real = vaultPath;
  try {
    real = realpathSync(vaultPath);
  } catch {
    /* 目录还不存在（如故意预置失效路径）：按原样落盘，可用性判定交给 app */
  }
  const entry = { id, path: real };
  if (lastOpenedAt !== undefined) entry.last_opened_at = lastOpenedAt;
  if (missingSince !== undefined) entry.missing_since = missingSince;
  if (archivedAt !== undefined) entry.archived_at = archivedAt;
  await writeFile(path.join(dir, `${id}.json`), `${JSON.stringify(entry, null, 2)}\n`);
  return entry;
}

/** 预置一个 vault 的标签会话（`<env>/lumir/vault-sessions/<id>.json`）。
 *  tabs 是**vault 相对路径**的有序列表，active 是其中的激活项（缺省/非法值按「退化到第一个
 *  可打开的标签」处理，与 `vault_session::sanitize` 同口径）。 */
export async function writeSession({ id, tabs, active = null }) {
  if (!ID_RE.test(id ?? "")) throw new CuError(`会话 id 非法：${JSON.stringify(id)}（只允许字母数字与 -_）`);
  const dir = await mkdirp(path.join(envHome(), "lumir", "vault-sessions"));
  const payload = { version: 1, tabs, active, updated_at: Date.now() };
  await writeFile(path.join(dir, `${id}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

/** `seed` 块里的路径记号：`$vault` / `$vault2` 指套件的两个合成 vault（不写死 /tmp 路径，
 *  这样 `LUMIR_ACCEPTANCE_VAULT` 覆写时场景跟着走）；其余按绝对路径原样用。 */
function resolveSeedPath(p) {
  if (p === "$vault") return vaultDir();
  if (p === "$vault2") return secondVaultDir();
  return p;
}

/** 应用场景 frontmatter 的 `seed` 块（注册表 + 会话预置）。
 *
 *  **必须在起 app 之前跑**（run.mjs 在每个场景的 launchApp 之前调用）：app 打开一个未注册
 *  目录时会立刻给它分配一个自动 id 并落盘，事后再预置同路径的注册项会让列表里出现两行指向
 *  同一目录（一行自动 id、一行预置 id），`find_by_path` 命中哪一行还不确定。 */
export async function prepareSeed(seed) {
  const written = { registry: [], sessions: [] };
  if (!seed) return written;
  for (const e of seed.registry ?? []) {
    written.registry.push(
      await writeRegistryEntry({
        id: e.id,
        path: resolveSeedPath(e.path),
        lastOpenedAt: e.lastOpenedAt,
        missingSince: e.missingSince,
        archivedAt: e.archivedAt,
      }),
    );
  }
  for (const [id, s] of Object.entries(seed.sessions ?? {})) {
    written.sessions.push(await writeSession({ id, tabs: s?.tabs ?? [], active: s?.active ?? null }));
  }
  return written;
}

export async function copyFixture(name) {
  await cp(path.join(fixturesDir(), name), path.join(vaultDir(), name));
  return path.join(vaultDir(), name);
}

/**
 * 找本 worktree 构建出的 app 进程。
 * Tauri CLI 以相对路径 `target/debug/lumir` 起进程（cwd = src-tauri/），命令行里没有 worktree
 * 路径，因此不能按路径区分。改用**进程组**：launchApp 以 detached 起 `pnpm tauri dev`，子进程
 * 自成进程组（pgid == child.pid），vite / cargo / app 全在同一组内；Alex 手头那份实例在别的组，
 * 结构上不可能被误抓、误杀。
 */
export function findAppPid(pgid) {
  const rows = spawnSyncText("/bin/ps", ["-axo", "pid=,pgid=,command="]).split("\n");
  const hits = rows
    .map((l) => l.trim().split(/\s+/, 3))
    .filter(([, g, cmd]) => cmd && cmd.endsWith("target/debug/lumir"))
    .filter(([, g]) => pgid === undefined || Number(g) === Number(pgid));
  if (hits.length === 0) return null;
  return Math.max(...hits.map(([pid]) => Number(pid)));
}

function spawnSyncText(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" });
}

/**
 * 起 `pnpm tauri dev`。端口与**窗口位置**经 --config 覆写（不落盘、不改仓库 tauri.conf.json）。
 * 解析条件：stdout 出现 `LUMIR_READY`（src-tauri/src/ready.rs）或队列就绪兜底。
 *
 * 为什么要覆写窗口位置（M164 实测）：无人值守的批次里，macOS 会把新窗口放到主屏之外的
 * 区域（实测 `window_bounds x=193 y=1076`，而内置屏只有 ~982pt 高），窗口一旦落在屏幕外，
 * WKWebView 就**拿不到键盘焦点**——`type_text` 直接报
 * 「target WebArea did not acquire stable keyboard focus; no keys were sent」，整步的注入
 * 全部不落地，表现为一堆与产品无关的 FAIL（同一场景、同一提交，窗口在屏内时全 PASS）。
 * tauri 的 --config 是整根替换 `app.windows` 数组，因此这里必须把 title/width/height 一并
 * 重述（与 `src-tauri/tauri.conf.json` 的窗口对象逐字段一致——改那边的窗口尺寸要同步这里）。
 */
export async function launchApp({ port = acceptPort(), timeoutMs = 300_000, logFile } = {}) {
  const root = repoRoot();
  const config = {
    build: {
      devUrl: `http://127.0.0.1:${port}`,
      beforeDevCommand: `pnpm exec vite --port ${port} --strictPort`,
    },
    app: {
      windows: [{ title: "Lumir", width: 1200, height: 800, x: 120, y: 80, focus: true }],
    },
  };
  const child = spawn(
    "pnpm",
    ["tauri", "dev", "--config", JSON.stringify(config)],
    {
      cwd: root,
      detached: true, // 自成进程组：vite/cargo/app 一并收尸
      env: { ...process.env, XDG_CONFIG_HOME: envHome() },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let out = "";
  const chunks = [];
  const onChunk = (d) => {
    const s = stripAnsi(d.toString());
    chunks.push(s);
    out += s;
    if (logFile) {
      mkdirSync(path.dirname(logFile), { recursive: true });
      appendFileSync(logFile, s);
    }
  };
  child.stdout.on("data", onChunk);
  child.stderr.on("data", onChunk);

  const ready = (async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (/^LUMIR_READY /m.test(out)) return true;
      if (child.exitCode !== null) throw new CuError(`pnpm tauri dev 提前退出（code=${child.exitCode}）：\n${out.slice(-2000)}`);
      await sleep(500);
    }
    throw new CuError(`等待 LUMIR_READY 超时（${timeoutMs}ms）：\n${out.slice(-2000)}`);
  })();

  await ready;
  const pid = await waitForPid(child.pid, 30_000);
  return { child, pid, output: () => chunks.join("") };
}

async function waitForPid(pgid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = findAppPid(pgid);
    if (pid) return pid;
    await sleep(300);
  }
  throw new CuError("app 进程未找到（本进程组内的 target/debug/lumir）");
}

/** 停 app：先整组 SIGTERM，再兜底 SIGKILL 残留（只在本次运行的进程组内）。 */
export async function stopApp(handle) {
  const pgid = handle?.child?.pid;
  if (pgid) {
    try {
      process.kill(-pgid, "SIGTERM");
    } catch {
      /* 组已不在 */
    }
  }
  await sleep(2000);
  const pid = findAppPid(pgid);
  if (pid) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* 已退出 */
    }
  }
  await sleep(500);
}

export async function cuSeesApp(cu, pid, { retries = 20 } = {}) {
  for (let i = 0; i < retries; i++) {
    const apps = await cu.listApps();
    if (apps.some((a) => a.pid === pid && a.bundle_id === BUNDLE_ID)) return true;
    await sleep(500);
  }
  return false;
}

/** 护栏：验收 vault（含第二个）与配置目录都不得指向用户真实资产。 */
export function assertSafeTargets() {
  const v = vaultDir();
  if (v.startsWith("/Users/")) {
    throw new CuError(`拒绝：验收 vault 指向用户目录（${v}）；只允许 /tmp 下的合成 vault`);
  }
  const v2 = secondVaultDir();
  if (v2.startsWith("/Users/")) {
    throw new CuError(`拒绝：第二个验收 vault 指向用户目录（${v2}）；只允许 /tmp 下的合成 vault`);
  }
  const home = envHome();
  if (!home.includes("test-results/acceptance/")) {
    throw new CuError(`拒绝：隔离配置目录不在 test-results/acceptance 下（${home}）`);
  }
  return { vault: v, secondVault: v2, envHome: home };
}

/**
 * 回收端口：上一次运行崩溃留下的 vite/app 会占住 dev 端口，使本次启动直接失败。
 * 只回收**本 worktree** 的残留（命令行含 worktree 路径）；他人的服务一律报错不碰。
 */
export async function reclaimPort(port) {
  let pids = [];
  try {
    pids = spawnSyncText("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])
      .split("\n")
      .map((s) => Number(s.trim()))
      .filter(Boolean);
  } catch {
    return []; // lsof 无匹配时退出码非 0
  }
  const root = repoRoot();
  const killed = [];
  for (const pid of pids) {
    // 命令行可能是相对路径（vite/cargo 常这样起），按**工作目录**判定归属更可靠。
    let cwd = "";
    try {
      cwd = spawnSyncText("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).trim();
    } catch {
      /* 进程可能已退出 */
    }
    if (!cwd.includes(root)) {
      const row = spawnSyncText("/bin/ps", ["-o", "pgid=,command=", "-p", String(pid)]).trim();
      throw new CuError(
        `端口 ${port} 被非本 worktree 的进程占用（pid ${pid}，cwd=${cwd.replace(/^n/, "") || "未知"}）：${row}\n` +
          "请用 LUMIR_ACCEPTANCE_PORT 指定别的端口，或自行处理该进程。",
      );
    }
    const pgid = Number(spawnSyncText("/bin/ps", ["-o", "pgid=", "-p", String(pid)]).trim().split("\n")[0]);
    try {
      process.kill(-pgid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* 已退出 */
      }
    }
    killed.push(pid);
  }
  if (killed.length) await sleep(2000);
  return killed;
}
