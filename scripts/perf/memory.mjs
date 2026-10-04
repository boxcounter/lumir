// 常驻内存测量（spec §4）：ready 后 idle 10s，每 2s 采样一次 RSS 合计，共 5 个样本。
// 归因口径：app 的 ppid 子孙进程 + 基线差集归因的 com.apple.WebKit.* XPC 进程
// （WKWebView 的 WebContent/GPU/Networking 由 launchd 托管，ppid=1，不在 ppid 树里，
// 用启动前的 WebKit pid 基线快照取差集归属本 app；CI runner 为独占 VM，无污染源）。
// 口径缺陷（spec 已声明）：RSS 含 shared pages，合计系统性偏高；门禁取 max 而非 p95。
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { repoRoot, sleep, writeResult } from "./lib/stats.mjs";

const execFileP = promisify(execFile);
const BIN = path.join(repoRoot(), "src-tauri/target/release/lumir");
const READY_PREFIX = "LUMIR_READY ";
const READY_TIMEOUT_MS = 15_000;
const SETTLE_MS = Number(process.env.PERF_MEM_SETTLE_MS ?? 10_000);
const SAMPLES = Number(process.env.PERF_MEM_SAMPLES ?? 5);
const INTERVAL_MS = 2_000;

// M320 双 pane 常驻内存变体（pane-system-split-view 的实测任务）：`PERF_MEM_PANES=0|1|2` 时
// 用隔离 XDG_CONFIG_HOME（+ 合成 vault）起 app——0 = 空配置无 vault（与 CI runner 的干净
// 现场同语义；裸跑不设本变量会继承用户真实 ~/.config/lumir，恢复真实 vault 还可能往里写
// 会话/日志，本机实测一律走隔离变体），1/2 = 经启动恢复（M159/M318 的真实路径）落到
// 单 pane / 双 pane 常驻态再采样——1 与 2 只差会话文件的 pane 数，其余 fixture 逐字节
// 相同，差值即「第二 pane 常驻」的内存增量。**缺省（未设）行为与此前逐字节一致**：CI 门禁
// 的 resident-memory 不受影响；变体结果写独立 metric 文件（resident-memory-pane0/1/2），
// 不覆盖门禁读数。
const PANES = process.env.PERF_MEM_PANES === undefined ? null : Number(process.env.PERF_MEM_PANES);
if (PANES !== null && PANES !== 0 && PANES !== 1 && PANES !== 2) {
  console.error(`[perf] PERF_MEM_PANES 只接受 0/1/2（0=无 vault 的 CI 同语义变体），收到 ${JSON.stringify(process.env.PERF_MEM_PANES)}`);
  process.exit(2);
}

/** 变体 fixture：隔离配置目录；panes ≥ 1 时另有合成 vault（两份小文档）+ 注册表 + v2 会话。 */
async function seedPanesEnv(panes) {
  const root = "/tmp/lumir-perf-panes";
  const cfgDir = path.join(root, "xdg", "lumir");
  await mkdir(cfgDir, { recursive: true });
  if (panes === 0) {
    // 空配置：无 last_vault——与 CI runner 的「无历史」现场同语义（SAMPLE 文档常驻态）。
    await writeFile(path.join(cfgDir, "config.json"), `${JSON.stringify({ version: 1, editor: { mode: "md" } }, null, 2)}\n`);
    return path.join(root, "xdg");
  }
  const vault = path.join(root, "vault");
  await mkdir(vault, { recursive: true });
  const alpha = "# Alpha\n\n常驻内存测量的甲文档。\n";
  const beta = "# Beta\n\n常驻内存测量的乙文档。\n";
  await writeFile(path.join(vault, "alpha.md"), alpha);
  await writeFile(path.join(vault, "beta.md"), beta);
  // /tmp 在 macOS 是 /private/tmp 的符号链接：注册表与 last_vault 都用 realpath 后的路径，
  // 与 find_by_path 的归一化对齐（scripts/acceptance 同款纪律）。
  const realVault = realpathSync(vault);
  await mkdir(path.join(cfgDir, "vault-registry"), { recursive: true });
  await mkdir(path.join(cfgDir, "vault-sessions"), { recursive: true });
  await writeFile(
    path.join(cfgDir, "config.json"),
    `${JSON.stringify({ version: 1, last_vault: realVault, editor: { mode: "md" } }, null, 2)}\n`
  );
  const vaultId = "m320perf";
  await writeFile(
    path.join(cfgDir, "vault-registry", `${vaultId}.json`),
    `${JSON.stringify({ id: vaultId, path: realVault, last_opened_at: Date.now() }, null, 2)}\n`
  );
  // v2 会话形状与 src/bindings/VaultSession.ts 对齐（version / panes / harness_pane /
  // pane_split_ratio / updated_at 五字段；Rust 侧 sanitize 兜底见 vault_session.rs）。
  const session = {
    version: 2,
    panes:
      panes === 2
        ? [
            { tabs: ["alpha.md"], active: "alpha.md" },
            { tabs: ["beta.md"], active: "beta.md" },
          ]
        : [{ tabs: ["alpha.md"], active: "alpha.md" }],
    harness_pane: false,
    pane_split_ratio: 0.5,
    updated_at: Date.now(),
  };
  await writeFile(
    path.join(cfgDir, "vault-sessions", `${vaultId}.json`),
    `${JSON.stringify(session, null, 2)}\n`
  );
  return path.join(root, "xdg");
}

const spawnEnv = PANES === null ? process.env : { ...process.env, XDG_CONFIG_HOME: await seedPanesEnv(PANES) };
const METRIC = PANES === null ? "resident-memory" : `resident-memory-pane${PANES}`;

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

const child = spawn(BIN, [], { stdio: ["ignore", "pipe", "inherit"], env: spawnEnv });
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
    metric: METRIC,
    unit: "MB",
    contract: 200,
    samples,
    meta: {
      settleMs: SETTLE_MS,
      intervalMs: INTERVAL_MS,
      attributedPids: lastPids,
      ...(PANES === null ? {} : { panes: PANES, xdgConfigHome: spawnEnv.XDG_CONFIG_HOME }),
      note:
        "RSS 合计（app 子孙 + 基线差集归因的 WebKit XPC），含 shared pages（系统性偏高）；门禁比较值为 max" +
        (PANES === null ? "" : `；PERF_MEM_PANES=${PANES} 变体：隔离 XDG + 合成 vault 经启动恢复落到 ${PANES} pane 常驻态`),
    },
  });
} finally {
  // 杀 app 主进程即可：已验证 WebKit 子进程随主进程退出
  try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
}
