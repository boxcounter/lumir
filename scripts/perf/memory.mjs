// 常驻内存测量（spec §4）：ready 后 idle 10s，每 2s 采样一次 RSS 合计，共 5 个样本。
//
// 归因口径：app 的 ppid 子孙进程 + 基线差集归因的 com.apple.WebKit.* XPC 进程
// （WKWebView 的 WebContent/GPU/Networking 由 launchd 托管，ppid=1，不在 ppid 树里，
// 用启动前的 WebKit pid 基线快照取差集归属本 app）。
//
// 污染护栏（M723，依据 .local/reports/perf-memory-ci-oct24/report.md）：
// 差集归因不校验 helper 的归属，测量窗口内别的 WKWebView 客户端拉起 helper 会被整段计入
// （2026-09-16 → 10-24 的 122 次 CI run 里 11 次如此，读数虚高到 306–356MB）。因此每轮采样后判两条：
//   1) 任一样本的被归因 WebKit helper 数 > MAX_HELPERS（3 = 单窗口 app 的
//      WebContent/GPU/Networking 上限；CI 干净 run 实测 2、本机实测 3）；
//   2) 首个样本的 helper pid 集合必须与之后每个样本逐一相等（窗口内新增/退出都算污染）。
// 重测前另有一条残留检查：上一轮被归因的 helper 若仍未退出（无法区分是本 app 残留还是跨轮存活的外来
// 客户端），该轮记 stale-helper——排除它会给出可能假低的读数，宁红不假绿。
// 污染轮次的读数整轮丢弃（不进 max），整轮最多重测 1 次（合计 ≤ MAX_ATTEMPTS 轮）；两轮都污染
// 则以 reason=contaminated 非零退出，且**不写**门禁结果文件——check-thresholds 因此报「结果缺失」
// 而不是「超阈」，测量问题不会伪装成产品回归。重测重新取基线快照，上一轮已退出的 helper 不再进差集。
//
// 残余风险：外来 helper 若 ≤3 个且与本 app 的 helper 在首个样本之前同时存在，计数与集合两条判据
// 都无从区分（用户态没有归属信号，report §3.4），读数仍可能虚高（虚高方向保守）。护栏用有界重测
// 压低概率，并把每个被归因 / 被基线排除进程的 pid/ppid/lstart/comm 落进 meta 供事后指名。
//
// 口径缺陷（spec 已声明）：RSS 含 shared pages，合计系统性偏高；门禁取 max 而非 p95。
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { repoRoot, resultsDir, sleep, writeResult } from "./lib/stats.mjs";

const execFileP = promisify(execFile);
const READY_PREFIX = "LUMIR_READY ";
const READY_TIMEOUT_MS = 15_000;
const SETTLE_MS = Number(process.env.PERF_MEM_SETTLE_MS ?? 10_000);
const SAMPLES = Number(process.env.PERF_MEM_SAMPLES ?? 5);
const INTERVAL_MS = 2_000;
// 重测前的固定间隔：给上一轮 helper 退出的余量，也让触发重测的外部动作（诊断注入）收手。
const RETRY_BACKOFF_MS = 1_000;
// 上一轮 helper 必须在新一轮基线快照之前退出；超时仍未退出即判该轮污染（残留在基线里会让读数假低）。
const HELPER_EXIT_TIMEOUT_MS = 15_000;

/** 单窗口 WKWebView app 的 helper 上限：WebContent + GPU + Networking。 */
export const MAX_HELPERS = 3;
/** 污染整轮最多重测 1 次（首测 + 1 次重测），禁止无界重试。 */
export const MAX_ATTEMPTS = 2;
/** 连续污染时的退出原因；与 check-thresholds 的 over-threshold 区分（见 spec §4/§5）。 */
export const CONTAMINATION_REASON = "contaminated";

const RESIDUAL_RISK =
  "差集归因无法证明 helper 的归属：外来 helper 若 ≤3 个且与本 app 的 helper 在首个样本之前同时存在，" +
  "helper 计数与集合稳定性两条判据都无法区分（用户态无归属信号），读数可能虚高（保守方向）。" +
  "护栏以有界重测压低概率；meta.attributed / meta.excludedBaselineWebKit 的 pid/ppid/lstart/comm 供事后指名 owner。";

const CONTAMINATION_POLICY = {
  maxHelpers: MAX_HELPERS,
  helperSetStability: "first-sample",
  maxAttempts: MAX_ATTEMPTS,
  onContinuousContamination: CONTAMINATION_REASON,
};

// ps 行：pid ppid rss(kB) lstart(24 字符，DSD MON [d]d HH:MM:SS YYYY) comm（可能是含空格的全路径）。
const PROC_LINE_RE =
  /^(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/;

/**
 * 解析 `ps -axo pid=,ppid=,rss=,lstart=,comm=` 的输出。纯函数：夹具测试直接喂多行文本。
 * lstart 里的列填充空格归一成单空格，便于比较与落盘。
 */
export function parseProcTable(stdout) {
  const procs = [];
  for (const line of stdout.split("\n")) {
    const m = line.trim().match(PROC_LINE_RE);
    if (!m) continue;
    procs.push({
      pid: +m[1],
      ppid: +m[2],
      rssKB: +m[3],
      lstart: m[4].replace(/\s+/g, " "),
      comm: m[5],
    });
  }
  return procs;
}

export const isWebKit = (p) => p.comm.includes("com.apple.WebKit.");

/** 进程诊断字段（meta 用）：只保留 pid/ppid/lstart/comm，按 pid 升序。 */
export function toProcessDetails(procs) {
  return [...procs]
    .sort((a, b) => a.pid - b.pid)
    .map(({ pid, ppid, lstart, comm }) => ({ pid, ppid, lstart, comm }));
}

/**
 * 一轮内所有样本的被归因进程明细，按 pid+lstart 去重后的并集（纯函数）。
 * 为什么不是末样本：窗口中途出现、末样本前已退出的 helper 只存在于中间样本里，取末样本会把它的
 * pid/ppid/lstart/comm 整条丢掉——而「新增后退出」正是集合稳定性判据要抓的现场。
 * 同 pid 不同 lstart（pid 复用）是两个进程，不去重。
 */
export function mergeProcessDetails(samples) {
  const byKey = new Map();
  for (const sample of samples) {
    for (const p of sample.processes ?? []) {
      const key = `${p.pid}\u0000${p.lstart}`;
      if (!byKey.has(key)) byKey.set(key, p);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.pid - b.pid || String(a.lstart).localeCompare(String(b.lstart))
  );
}

/**
 * app 的 ppid 子孙 ∪（当前 WebKit 进程 − 启动前基线）→ RSS 合计与 helper 集合。纯函数。
 * `webkitBaseline` 是基线快照里的 WebKit pid 集合（Set）：这些进程是别人家的 WebKit 客户端，排除。
 */
export function attribute(table, rootPid, webkitBaseline) {
  const byId = new Map(table.map((p) => [p.pid, p]));
  const children = new Map();
  for (const p of table) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p.pid);
  }
  const appPids = new Set();
  const stack = rootPid === undefined ? [] : [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    if (appPids.has(pid)) continue;
    appPids.add(pid);
    for (const c of children.get(pid) ?? []) stack.push(c);
  }
  const helperPids = table
    .filter((p) => isWebKit(p) && !webkitBaseline.has(p.pid))
    .map((p) => p.pid)
    .sort((a, b) => a - b);
  const pids = [...new Set([...appPids, ...helperPids])].sort((a, b) => a - b);
  let totalKB = 0;
  for (const pid of pids) totalKB += byId.get(pid)?.rssKB ?? 0;
  return {
    mb: totalKB / 1024,
    pids,
    appPids: [...appPids].sort((a, b) => a - b),
    helperPids,
    processes: toProcessDetails(pids.map((pid) => byId.get(pid)).filter(Boolean)),
  };
}

/**
 * 污染判定（纯函数）。samples = [{ mb, helperPids }]，按采样顺序。
 * - `maxHelpers`：任一样本 helper 数超过即污染（helper-count）；
 * - `checkSetStability`：第 2 个样本起，helper pid 集合与首样本不等即污染（helper-set-changed）；
 * - `staleHelperPids`：重测前上一轮 helper 仍未退出（它们会进新基线、让读数假低）⇒ stale-helper。
 * 三个开关分开暴露，夹具测试可单独关掉某条来证明信号来自哪条判据（反向验证）。
 */
export function evaluateRound(
  samples,
  { maxHelpers = MAX_HELPERS, checkSetStability = true, staleHelperPids = [] } = {}
) {
  if (samples.length === 0) throw new Error("evaluateRound: no samples");
  const firstHelperPids = [...samples[0].helperPids].sort((a, b) => a - b);
  const firstSet = new Set(firstHelperPids);
  const reasons = [];
  if (staleHelperPids.length > 0) {
    reasons.push({
      sample: null,
      kind: "stale-helper",
      detail: { helperPids: [...staleHelperPids].sort((a, b) => a - b) },
    });
  }
  samples.forEach((sample, i) => {
    const helperPids = [...sample.helperPids].sort((a, b) => a - b);
    if (helperPids.length > maxHelpers) {
      reasons.push({
        sample: i + 1,
        kind: "helper-count",
        detail: { helperCount: helperPids.length, maxHelpers, helperPids },
      });
    }
    if (checkSetStability && i > 0) {
      const current = new Set(helperPids);
      const added = helperPids.filter((pid) => !firstSet.has(pid));
      const removed = firstHelperPids.filter((pid) => !current.has(pid));
      if (added.length > 0 || removed.length > 0) {
        reasons.push({
          sample: i + 1,
          kind: "helper-set-changed",
          detail: { added, removed, firstHelperPids, helperPids },
        });
      }
    }
  });
  return { contaminated: reasons.length > 0, reasons, firstHelperPids, maxHelpers, samplesChecked: samples.length };
}

/**
 * 有界重测状态机（纯函数）：先测 → 干净即收 → 污染则重测一次 → 仍污染即 failed(contaminated)。
 * `attempts` 是已完成的轮次（每项至少含 contaminated 字段）。
 */
export function nextStep(attempts, { maxAttempts = MAX_ATTEMPTS } = {}) {
  if (attempts.length === 0) return { action: "measure", attempt: 1 };
  const last = attempts[attempts.length - 1];
  if (!last.contaminated) return { action: "accept", attempt: attempts.length };
  if (attempts.length < maxAttempts) return { action: "measure", attempt: attempts.length + 1 };
  return { action: "fail", reason: CONTAMINATION_REASON, attempts: attempts.length };
}

/**
 * 最终读数裁决（纯函数）：只有被接受那一轮的样本能进统计。
 * 污染轮的样本在这里被彻底丢弃——这正是「污染读数不进 max」的唯一实现点。
 */
export function resolveRun(attempts, opts) {
  const step = nextStep(attempts, opts);
  if (step.action === "accept") {
    const accepted = attempts[step.attempt - 1];
    return {
      status: "ok",
      acceptedAttempt: step.attempt,
      samples: accepted.samples.map((s) => s.mb),
    };
  }
  if (step.action === "fail") {
    return { status: "contaminated", acceptedAttempt: null, reason: step.reason, samples: [] };
  }
  return { status: "pending", acceptedAttempt: null, samples: [] };
}

function formatReasons(reasons) {
  return reasons
    .map((r) => `${r.kind}${r.sample ? `@sample ${r.sample}` : ""}`)
    .join(", ");
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

async function procTable() {
  // LC_ALL=C 固定 lstart 的月份/星期为英文，解析不随宿主 locale 漂移。
  const { stdout } = await execFileP("ps", ["-axo", "pid=,ppid=,rss=,lstart=,comm="], {
    env: { ...process.env, LC_ALL: "C" },
  });
  return parseProcTable(stdout);
}

/** 等一组 pid 全部退出；返回超时后仍存活的 pid（空数组 = 已清干净）。 */
async function waitForPidsGone(pids, timeoutMs) {
  const target = new Set(pids);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const table = await procTable();
    const alive = table.filter((p) => target.has(p.pid)).map((p) => p.pid);
    if (alive.length === 0 || Date.now() >= deadline) return alive;
    await sleep(250);
  }
}

/** 跑一轮：基线快照 → spawn → ready → settle → N 次采样 → kill，并给出污染判定。 */
async function measureRound({ attempt, bin, spawnEnv, previousHelperPids }) {
  // 上一轮的 helper 若还活着，会被新一轮基线当成「预先存在」排除，读数假低——先等它们退出。
  const leftoverHelperPids = previousHelperPids.length
    ? await waitForPidsGone(previousHelperPids, HELPER_EXIT_TIMEOUT_MS)
    : [];
  const baselineWebKit = (await procTable()).filter(isWebKit);
  const baselinePids = new Set(baselineWebKit.map((p) => p.pid));
  console.log(
    `[perf] memory attempt ${attempt} baseline: ${baselineWebKit.length} webkit pids before spawn` +
      (leftoverHelperPids.length ? `（上一轮 helper 未退出：${leftoverHelperPids.join(",")}）` : "")
  );
  const child = spawn(bin, [], { stdio: ["ignore", "pipe", "inherit"], env: spawnEnv });
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
  const samples = [];
  let lastAttribution = null;
  try {
    await ready;
    await sleep(SETTLE_MS);
    for (let i = 0; i < SAMPLES; i++) {
      const attribution = attribute(await procTable(), appPid, baselinePids);
      lastAttribution = attribution;
      // processes 是逐样本明细：整轮并集（mergeProcessDetails）靠它保留中途出现后又退出的 helper。
      samples.push({
        mb: attribution.mb,
        helperPids: attribution.helperPids,
        processes: attribution.processes,
      });
      // 这一行的形状是 CI 日志解析的历史口径（report §2 的 dataset 抓取），保持逐字节不变。
      console.log(
        `[perf] memory sample ${i + 1}/${SAMPLES}: ${attribution.mb.toFixed(1)}MB ` +
          `(${attribution.pids.length} processes attributed)`
      );
      console.log(
        `[perf] memory helpers ${i + 1}/${SAMPLES} (attempt ${attempt}): ` +
          `${attribution.helperPids.length} webkit [${attribution.helperPids.join(",")}]`
      );
      if (i < SAMPLES - 1) await sleep(INTERVAL_MS);
    }
  } finally {
    // 杀 app 主进程即可：已验证 WebKit 子进程随主进程退出
    try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const done = () => resolve();
      child.once("exit", done);
      child.once("error", done);
      setTimeout(done, 5_000);
    });
  }
  const evaluation = evaluateRound(samples, { staleHelperPids: leftoverHelperPids });
  // 全轮并集：末样本之前退出的 helper 只存在于中间样本，必须从并集里保留其 pid/ppid/lstart/comm。
  const attributed = mergeProcessDetails(samples);
  return {
    attempt,
    contaminated: evaluation.contaminated,
    reasons: evaluation.reasons,
    helperCounts: samples.map((s) => s.helperPids.length),
    sampleHelperPids: samples.map((s) => s.helperPids),
    helperPidsAtExit: lastAttribution ? lastAttribution.helperPids : [],
    leftoverHelperPids,
    samples,
    attributedPids: [...new Set(attributed.map((p) => p.pid))].sort((a, b) => a - b),
    attributed,
    excludedBaselineWebKit: toProcessDetails(baselineWebKit),
  };
}

/**
 * 单轮完整诊断摘要（纯函数）。meta.attempts[] 与连续污染诊断件共用这一份：
 * 被丢弃的轮次也必须带齐 attributed（全轮并集）与该轮的 excludedBaselineWebKit。
 */
export function summarizeAttempt(a) {
  return {
    attempt: a.attempt,
    contaminated: a.contaminated,
    reasons: a.reasons,
    samples: a.samples.map((s) => s.mb),
    helperCounts: a.helperCounts,
    sampleHelperPids: a.sampleHelperPids,
    helperPidsAtExit: a.helperPidsAtExit,
    leftoverHelperPids: a.leftoverHelperPids,
    attributedPids: a.attributedPids,
    attributed: a.attributed,
    excludedBaselineWebKit: a.excludedBaselineWebKit,
  };
}

/** 成功结果的 meta（纯函数，便于夹具测试与连续污染诊断共用的摘要形状）。 */
export function buildMeta({ attempts, acceptedAttempt, panes, xdgConfigHome }) {
  const accepted = attempts[acceptedAttempt - 1];
  return {
    settleMs: SETTLE_MS,
    intervalMs: INTERVAL_MS,
    attributedPids: accepted.attributedPids,
    attributed: accepted.attributed,
    excludedBaselineWebKit: accepted.excludedBaselineWebKit,
    contaminationPolicy: CONTAMINATION_POLICY,
    attemptsUsed: attempts.length,
    acceptedAttempt,
    attempts: attempts.map(summarizeAttempt),
    residualRisk: RESIDUAL_RISK,
    ...(panes === null ? {} : { panes, xdgConfigHome }),
    note:
      "RSS 合计（app 子孙 + 基线差集归因的 WebKit XPC），含 shared pages（系统性偏高）；门禁比较值为 max" +
      "；污染轮读数整轮丢弃、不进统计（诊断见 meta.attempts）" +
      (panes === null ? "" : `；PERF_MEM_PANES=${panes} 变体：隔离 XDG + 合成 vault 经启动恢复落到 ${panes} pane 常驻态`),
  };
}

/**
 * 连续污染诊断件的内容（纯函数，便于夹具测试形状）。与成功结果的 meta 共用 summarizeAttempt，
 * 因此被丢弃的每一轮都带齐 attributed（全轮并集）与该轮 excludedBaselineWebKit。
 */
export function buildContaminatedPayload({ metric, attempts, panes, xdgConfigHome, reason, now = new Date() }) {
  return {
    metric,
    status: "contaminated",
    reason,
    gateEligible: false,
    attemptsUsed: attempts.length,
    attempts: attempts.map(summarizeAttempt),
    meta: {
      ts: now.toISOString(),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      ci: !!process.env.CI,
      settleMs: SETTLE_MS,
      intervalMs: INTERVAL_MS,
      contaminationPolicy: CONTAMINATION_POLICY,
      residualRisk: RESIDUAL_RISK,
      ...(panes === null ? {} : { panes, xdgConfigHome }),
    },
  };
}

async function writeContaminatedDiagnostic(args) {
  const outDir = resultsDir();
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${args.metric}-contaminated.json`);
  await writeFile(file, JSON.stringify(buildContaminatedPayload(args), null, 2) + "\n");
  return file;
}

async function main() {
  // M320 双 pane 常驻内存变体（pane-system-split-view 的实测任务）：`PERF_MEM_PANES=0|1|2` 时
  // 用隔离 XDG_CONFIG_HOME（+ 合成 vault）起 app——0 = 空配置无 vault（与 CI runner 的干净
  // 现场同语义；裸跑不设本变量会继承用户真实 ~/.config/lumir，恢复真实 vault 还可能往里写
  // 会话/日志，本机实测一律走隔离变体），1/2 = 经启动恢复（M159/M318 的真实路径）落到
  // 单 pane / 双 pane 常驻态再采样——1 与 2 只差会话文件的 pane 数，其余 fixture 逐字节
  // 相同，差值即「第二 pane 常驻」的内存增量。**缺省（未设）行为与此前逐字节一致**：CI 门禁
  // 的 resident-memory 不受影响；变体结果写独立 metric 文件（resident-memory-pane0/1/2），
  // 不覆盖门禁读数。
  const panes = process.env.PERF_MEM_PANES === undefined ? null : Number(process.env.PERF_MEM_PANES);
  if (panes !== null && panes !== 0 && panes !== 1 && panes !== 2) {
    console.error(`[perf] PERF_MEM_PANES 只接受 0/1/2（0=无 vault 的 CI 同语义变体），收到 ${JSON.stringify(process.env.PERF_MEM_PANES)}`);
    process.exit(2);
  }
  if (!Number.isInteger(SAMPLES) || SAMPLES < 1) {
    console.error(`[perf] PERF_MEM_SAMPLES 只接受正整数，收到 ${JSON.stringify(process.env.PERF_MEM_SAMPLES)}`);
    process.exit(2);
  }
  if (!Number.isFinite(SETTLE_MS) || SETTLE_MS < 0) {
    console.error(`[perf] PERF_MEM_SETTLE_MS 只接受非负数，收到 ${JSON.stringify(process.env.PERF_MEM_SETTLE_MS)}`);
    process.exit(2);
  }
  const bin = path.join(repoRoot(), "src-tauri/target/release/lumir");
  const spawnEnv = panes === null ? process.env : { ...process.env, XDG_CONFIG_HOME: await seedPanesEnv(panes) };
  const metric = panes === null ? "resident-memory" : `resident-memory-pane${panes}`;
  // 先删上一轮遗留的门禁结果：本轮若两轮都污染（不写结果），陈旧读数不得让 check-thresholds 假绿。
  await rm(path.join(resultsDir(), `${metric}.json`), { force: true });

  const attempts = [];
  let step = nextStep(attempts);
  while (step.action === "measure") {
    const previous = attempts[attempts.length - 1];
    const round = await measureRound({
      attempt: step.attempt,
      bin,
      spawnEnv,
      previousHelperPids: previous ? previous.helperPidsAtExit : [],
    });
    attempts.push(round);
    console.log(
      `[perf] memory attempt ${round.attempt}: ` +
        (round.contaminated ? `${CONTAMINATION_REASON}（${formatReasons(round.reasons)}）` : "clean")
    );
    step = nextStep(attempts);
    if (step.action === "measure") await sleep(RETRY_BACKOFF_MS);
  }

  const resolved = resolveRun(attempts);
  if (resolved.status === "ok") {
    await writeResult({
      metric,
      unit: "MB",
      contract: 200,
      samples: resolved.samples,
      meta: buildMeta({ attempts, acceptedAttempt: resolved.acceptedAttempt, panes, xdgConfigHome: spawnEnv.XDG_CONFIG_HOME }),
    });
    if (attempts.length > 1) {
      console.log(
        `::warning::[perf] ${metric}: 首轮污染已整轮丢弃（${formatReasons(attempts[0].reasons)}），` +
          `采用第 ${resolved.acceptedAttempt} 轮读数`
      );
    }
    return;
  }

  const diagnostic = await writeContaminatedDiagnostic({
    metric,
    attempts,
    panes,
    xdgConfigHome: spawnEnv.XDG_CONFIG_HOME,
    reason: resolved.reason,
  });
  console.error(
    `::error::[perf] ${metric}: ${resolved.reason}——连续 ${attempts.length} 轮污染，已达 ${MAX_ATTEMPTS} 轮上限，不再重试；` +
      `本轮读数全部丢弃，不写 ${metric}.json（check-thresholds 将报「结果缺失」而非「超阈」）。诊断：${diagnostic}`
  );
  for (const a of attempts) {
    console.error(`[perf] ${metric} attempt ${a.attempt} reasons: ${JSON.stringify(a.reasons)}`);
  }
  process.exitCode = 1;
}

function isDirectRun() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// 只有直接执行才跑测量；被夹具测试 import 时只暴露上面的纯函数（无副作用）。
if (isDirectRun()) await main();
