// 常驻内存测量（spec §4）：ready 后 idle 10s，每 2s 采样一次 RSS 合计，共 5 个样本。
// 归因口径：app 的 ppid 子孙进程 + 基线差集归因的 com.apple.WebKit.* XPC 进程
// （WKWebView 的 WebContent/GPU/Networking 由 launchd 托管，ppid=1，不在 ppid 树里，
// 用启动前的 WebKit pid 基线快照取差集归属本 app；CI runner 为独占 VM，无污染源）。
// 口径缺陷（spec 已声明）：RSS 含 shared pages，合计系统性偏高；门禁取 max 而非 p95。
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { repoRoot, sleep, writeResult } from "./lib/stats.mjs";

const execFileP = promisify(execFile);
const BIN = path.join(repoRoot(), "src-tauri/target/release/lumir");
const READY_PREFIX = "LUMIR_READY ";
const READY_TIMEOUT_MS = 15_000;
const SETTLE_MS = Number(process.env.PERF_MEM_SETTLE_MS ?? 10_000);
const SAMPLES = Number(process.env.PERF_MEM_SAMPLES ?? 5);
const INTERVAL_MS = 2_000;

async function procTable() {
  const { stdout } = await execFileP("ps", ["-axo", "pid=,ppid=,rss=,comm="]);
  const procs = [];
  for (const line of stdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (m) procs.push({ pid: +m[1], ppid: +m[2], rssKB: +m[3], comm: m[4] });
  }
  return procs;
}

const isWebKit = (p) => p.comm.includes("com.apple.WebKit.");

// app 的 ppid 子孙 + 基线差集归因的 WebKit XPC 进程，RSS 合计（KB -> MB）
function attribute(table, rootPid, webkitBaseline) {
  const children = new Map();
  for (const p of table) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p.pid);
  }
  const byId = new Map(table.map((p) => [p.pid, p]));
  const seen = new Set();
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    for (const c of children.get(pid) ?? []) stack.push(c);
  }
  for (const p of table) {
    if (isWebKit(p) && !webkitBaseline.has(p.pid)) seen.add(p.pid);
  }
  let totalKB = 0;
  for (const pid of seen) totalKB += byId.get(pid)?.rssKB ?? 0;
  return { mb: totalKB / 1024, pids: [...seen] };
}

const webkitBaseline = new Set((await procTable()).filter(isWebKit).map((p) => p.pid));

const child = spawn(BIN, [], { stdio: ["ignore", "pipe", "inherit"] });
const appPid = child.pid;
let buf = "";
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`no LUMIR_READY within ${READY_TIMEOUT_MS}ms`)), READY_TIMEOUT_MS);
  child.on("error", (err) => { clearTimeout(timer); reject(err); });
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    if (buf.includes(READY_PREFIX)) { clearTimeout(timer); resolve(); }
  });
});

try {
  await ready;
  await sleep(SETTLE_MS);
  const samples = [];
  let lastPids = [appPid];
  for (let i = 0; i < SAMPLES; i++) {
    const { mb, pids } = attribute(await procTable(), appPid, webkitBaseline);
    lastPids = pids;
    samples.push(mb);
    console.log(`[perf] memory sample ${i + 1}/${SAMPLES}: ${mb.toFixed(1)}MB (${pids.length} processes attributed)`);
    if (i < SAMPLES - 1) await sleep(INTERVAL_MS);
  }
  await writeResult({
    metric: "resident-memory",
    unit: "MB",
    contract: 200,
    samples,
    meta: {
      settleMs: SETTLE_MS,
      intervalMs: INTERVAL_MS,
      attributedPids: lastPids,
      note: "RSS 合计（app 子孙 + 基线差集归因的 WebKit XPC），含 shared pages（系统性偏高）；门禁比较值为 max",
    },
  });
} finally {
  // 杀 app 主进程即可：已验证 WebKit 子进程随主进程退出
  try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
}
