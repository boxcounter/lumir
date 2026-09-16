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
import { appendFileSync, mkdirSync } from "node:fs";
import { cp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CuError } from "./cu.mjs";
import { envHome, exists, log, mkdirp, readText, repoRoot, sleep, stripAnsi, vaultDir } from "./util.mjs";

export const BUNDLE_ID = "com.lumir.app";

export function acceptPort() {
  return Number(process.env.LUMIR_ACCEPTANCE_PORT ?? 1430);
}

export function fixturesDir() {
  return path.join(repoRoot(), "scripts/acceptance/fixtures");
}

/** 写隔离 config.json。keys 为 null 时整体不写该字段（默认无覆盖）。 */
export async function writeConfig({ lastVault = vaultDir(), mode = "md", keys = undefined } = {}) {
  const dir = path.join(envHome(), "lumir");
  await mkdirp(dir);
  const cfg = { version: 1, last_vault: lastVault, editor: { mode } };
  if (keys !== undefined) cfg.keys = keys;
  await writeFile(path.join(dir, "config.json"), `${JSON.stringify(cfg, null, 2)}\n`);
  return path.join(dir, "config.json");
}

export async function readConfig() {
  const file = path.join(envHome(), "lumir", "config.json");
  return JSON.parse(await readText(file));
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
 * 起 `pnpm tauri dev`。端口经 --config 覆写（不落盘、不改仓库 tauri.conf.json）。
 * 解析条件：stdout 出现 `LUMIR_READY`（src-tauri/src/ready.rs）或队列就绪兜底。
 */
export async function launchApp({ port = acceptPort(), timeoutMs = 300_000, logFile } = {}) {
  const root = repoRoot();
  const config = {
    build: {
      devUrl: `http://127.0.0.1:${port}`,
      beforeDevCommand: `pnpm exec vite --port ${port} --strictPort`,
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

/** 护栏：验收 vault 与配置目录都不得指向用户真实资产。 */
export function assertSafeTargets() {
  const v = vaultDir();
  if (v.startsWith("/Users/")) {
    throw new CuError(`拒绝：验收 vault 指向用户目录（${v}）；只允许 /tmp 下的合成 vault`);
  }
  const home = envHome();
  if (!home.includes("test-results/acceptance/")) {
    throw new CuError(`拒绝：隔离配置目录不在 test-results/acceptance 下（${home}）`);
  }
  return { vault: v, envHome: home };
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
