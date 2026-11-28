// 常驻内存测量（spec §4）：ready 后 idle 10s，每 2s 采样一次 RSS 合计，共 5 个样本。
// 本地与 CI 缺省均使用每次运行独立的合成 HOME/XDG（无 last_vault），不得继承宿主配置/vault。
//
// 归因口径：app 的 ppid 子孙进程 + 基线差集归因的 com.apple.WebKit.* XPC 进程
// （WKWebView 的 WebContent/GPU/Networking 由 launchd 托管，ppid=1，不在 ppid 树里，
// 用启动前的 WebKit pid 基线快照取差集归属本 app）。
//
// 外来 helper 判别（2026-11-28，依据 .local/reports/code-pane-perf-nov27/helper-attribution-investigation.md）：
// 差集归因无法证明归属——测量窗口内别的 WKWebView 客户端拉起 helper 会被整段计入（CI 实测 7 个 /
// 335MB，其中本 app 只有 2 个）。两个证据把「外来客户端」与本 app 的 helper 分开：
//   1) **创建时刻**：helper 的 `lstart` 晚于 app 启动 + earlyWindow（max(3s, ready+1s)）⇒ 不可能是
//      本 app 的 webview（webview 在 setup 内创建，ready 之前）。app-ready 慢的 runner 用 ready+1s
//      抬窗口，避免把慢启动的本 app helper 误判为外来。
//   2) **app 退出后存活**：本 app 的 WebKit helper 随主进程退出（实测 <1s）；kill 后 5s 仍存活的
//      helper 属于另一个仍活着的客户端。两个证据同时成立才排除（late && survived）。
// 排除只影响 RSS 合计与 helper 计数，进程明细（pid/ppid/lstart/comm）照常落进 attributed 与
// foreignHelpers 诊断；early helper 存活（无法判别）仍判污染，不洗绿。
//
// 污染护栏（M723，依据 .local/reports/perf-memory-ci-oct24/report.md）：
//   1) 任一样本**排除外来后**的被归因 WebKit helper 数 > MAX_HELPERS（3 = 单窗口 app 的
//      WebContent/GPU/Networking 上限；CI 干净 run 实测 2、本机实测 3）；
//   2) 首个样本的 helper pid 集合必须与之后每个样本逐一相等（窗口内新增/退出都算污染）。
// 重测前另有一条残留检查：上一轮**本 app 的** helper 若仍未退出，该轮记 stale-helper（外来客户端的
// 残留不进这项检查——它们本来就会跨轮存活，重测的基线快照会把它们排除）。污染轮次的读数整轮丢弃
// （不进 max），整轮最多重测 1 次（合计 ≤ MAX_ATTEMPTS 轮）；两轮都污染则以 reason=contaminated
// 非零退出，且**不写**门禁结果文件——check-thresholds 因此报「结果缺失」而不是「超阈」。
//
// 残余风险：① 本 app 的 helper 若在 app 退出后仍存活 >5s（罕见）会被误排除，读数偏低；
// ② 外来 helper 若在 earlyWindow 内出现（早到），计数/集合判据仍会把它当成本 app 的——存活检查
// 判它「无法判别」⇒ 整轮污染（保守，不洗绿）；③ pid 复用按 pid+lstart 匹配，不会误配。
//
// 口径缺陷（spec 已声明）：RSS 含 shared pages，合计系统性偏高；门禁取 max 而非 p95。
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { repoRoot, resultsDir, sleep, writeResult } from "./lib/stats.mjs";
import { createAppFixture } from "./lib/app-isolation.mjs";

const execFileP = promisify(execFile);
const READY_PREFIX = "LUMIR_READY ";
const READY_TIMEOUT_MS = 15_000;
const SETTLE_MS = Number(process.env.PERF_MEM_SETTLE_MS ?? 10_000);
const SAMPLES = Number(process.env.PERF_MEM_SAMPLES ?? 5);
const INTERVAL_MS = 2_000;
// 重测前的固定间隔：给上一轮 helper 退出的余量，也让触发重测的外部动作（诊断注入）收手。
const RETRY_BACKOFF_MS = 1_000;
// 上一轮本 app 的 helper 必须在新一轮基线快照之前退出；超时仍未退出即判该轮污染（残留在基线里会让读数假低）。
const HELPER_EXIT_TIMEOUT_MS = 15_000;
/**
 * 外来 helper 的「早到」窗口下界（相对 app 启动）。本 app 的 webview 在 setup 内创建、ready 之前，
 * 所以 helper 的正常 lstart 是 app 启动后 0–2s；3s 留足秒级 lstart 的粒度余量。
 */
export const EARLY_WINDOW_MS = 3_000;
/** 慢 runner 的补偿：窗口再抬到 ready + 1s，避免把晚就绪机器的本 app helper 误判为外来。 */
export const READY_MARGIN_MS = 1_000;
/** kill app 后等 helper 退出的观察窗：本 app 的 helper 实测 <1s 退出，5s 仍存活即判「跨客户端存活」。 */
export const SURVIVAL_GRACE_MS = 5_000;

/** 单窗口 WKWebView app 的 helper 上限：WebContent + GPU + Networking。 */
export const MAX_HELPERS = 3;
/** 污染整轮最多重测 1 次（首测 + 1 次重测），禁止无界重试。 */
export const MAX_ATTEMPTS = 2;
/** 连续污染时的退出原因；与 check-thresholds 的 over-threshold 区分（见 spec §4/§5）。 */
export const CONTAMINATION_REASON = "contaminated";

const RESIDUAL_RISK =
  "外来 helper 的排除依赖两条证据（lstart 晚于 earlyWindow、app 退出后仍存活），用户态无更强归属信号：" +
  "① 本 app 的 helper 若在 app 退出后存活 >5s（罕见）会被误排除，读数偏低；" +
  "② 外来 helper 若在 earlyWindow 内出现，存活检查判它「无法判别」⇒ 整轮污染（保守，不洗绿）；" +
  "③ 排除的每个 pid 都落在 meta.foreignHelpers / foreignHelperPids，可事后复核是否误伤。" +
  "meta.attributed / meta.excludedBaselineWebKit 的 pid/ppid/lstart/comm 供事后指名 owner。";

const CONTAMINATION_POLICY = {
  maxHelpers: MAX_HELPERS,
  helperSetStability: "first-sample",
  foreignHelperRule: "lstart > appStart + max(3s, ready+1s) AND alive 5s after app exit",
  earlyWindowMs: EARLY_WINDOW_MS,
  readyMarginMs: READY_MARGIN_MS,
  survivalGraceMs: SURVIVAL_GRACE_MS,
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

const MONTH_INDEX = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/**
 * `ps lstart`（`Sat Nov 28 11:45:43 2026`，本地时区、1 秒精度）→ epoch ms。
 * 解析失败返回 null：调用方按「无法判别」处理（当作早到、不排除），不猜。
 */
export function parseLstartEpochMs(lstart) {
  const m = String(lstart ?? "").trim().match(/^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTH_INDEX[m[1]];
  if (month === undefined) return null;
  return new Date(+m[6], month, +m[2], +m[3], +m[4], +m[5]).getTime();
}

const helperKey = (p) => `${p.pid}\u0000${p.lstart}`;

/**
 * 外来 helper 判别（纯函数）。
 * 输入：
 *   - helpers：本轮并集里的 WebKit helper 明细（含 pid/lstart/comm）；
 *   - appStartMs：app 进程的启动时刻（由 app 的 lstart 解析，失败时退化到 spawn 时刻）；
 *   - earlyWindowMs：早到晚界（max(EARLY_WINDOW_MS, ready + READY_MARGIN_MS)）；
 *   - survivors：kill 后 SURVIVAL_GRACE_MS 仍存活的进程明细（pid+lstart 匹配）。
 * 规则：late（lstart − appStart > earlyWindow）且 survived ⇒ 外来；
 *       early 且 survived ⇒ 无法判别（unexplainedSurvivors，调用方判污染，不排除）；
 *       late 且已退出 ⇒ 本 app 的晚建 helper（保留计数，不排除）。
 */
export function classifyForeignHelpers({ helpers, appStartMs, earlyWindowMs, survivors = [] }) {
  const survivedKeys = new Set(survivors.map(helperKey));
  const foreign = [];
  const lateHelpers = [];
  const unexplainedSurvivors = [];
  for (const h of [...helpers].sort((a, b) => a.pid - b.pid)) {
    const startedAtMs = parseLstartEpochMs(h.lstart);
    const startedAfterAppMs = startedAtMs === null ? null : startedAtMs - appStartMs;
    const late = startedAfterAppMs !== null && startedAfterAppMs > earlyWindowMs;
    const survivedAfterAppExit = survivedKeys.has(helperKey(h));
    const detail = { pid: h.pid, lstart: h.lstart, comm: h.comm, startedAfterAppMs, survivedAfterAppExit };
    if (late) lateHelpers.push(detail);
    if (late && survivedAfterAppExit) foreign.push(detail);
    else if (!late && survivedAfterAppExit) unexplainedSurvivors.push(detail);
  }
  return { foreign, lateHelpers, unexplainedSurvivors };
}

/**
 * 从单个样本里剔除外来 helper 的 RSS 与 pid（纯函数）。
 * `mb` 是 KB/1024 的合计，所以按 helperRssKB 逐 pid 扣减；样本里没有该 pid 时扣 0（幂等）。
 * processes 明细不删：attributed 仍要保留外来进程供事后复核。
 */
export function excludeForeignHelpers(sample, foreignPids = []) {
  const drop = new Set(foreignPids);
  if (drop.size === 0) return sample;
  const removed = sample.helperPids.filter((pid) => drop.has(pid));
  if (removed.length === 0) return sample;
  const removedKB = removed.reduce((sum, pid) => sum + (sample.helperRssKB?.[pid] ?? 0), 0);
  return {
    ...sample,
    mb: sample.mb - removedKB / 1024,
    helperPids: sample.helperPids.filter((pid) => !drop.has(pid)),
  };
}

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
  const helperRows = table.filter((p) => isWebKit(p) && !webkitBaseline.has(p.pid));
  const helperPids = helperRows.map((p) => p.pid).sort((a, b) => a - b);
  const helperRssKB = Object.fromEntries(helperRows.map((p) => [p.pid, p.rssKB]));
  const pids = [...new Set([...appPids, ...helperPids])].sort((a, b) => a - b);
  let totalKB = 0;
  for (const pid of pids) totalKB += byId.get(pid)?.rssKB ?? 0;
  return {
    mb: totalKB / 1024,
    pids,
    appPids: [...appPids].sort((a, b) => a - b),
    helperPids,
    helperRssKB,
    processes: toProcessDetails(pids.map((pid) => byId.get(pid)).filter(Boolean)),
  };
}

/**
 * 污染判定（纯函数）。samples = [{ mb, helperPids }]，按采样顺序。
 * - `maxHelpers`：任一样本 helper 数超过即污染（helper-count）；调用方传入的是**已剔除外来**的样本；
 * - `checkSetStability`：第 2 个样本起，helper pid 集合与首样本不等即污染（helper-set-changed）；
 * - `staleHelperPids`：重测前上一轮**本 app 的** helper 仍未退出（会进新基线、让读数假低）⇒ stale-helper；
 * - `extraReasons`：轮级判定（如 early helper 在 app 退出后存活、无法判别归属）由调用方注入。
 * 开关分开暴露，夹具测试可单独关掉某条来证明信号来自哪条判据（反向验证）。
 */
export function evaluateRound(
  samples,
  { maxHelpers = MAX_HELPERS, checkSetStability = true, staleHelperPids = [], extraReasons = [] } = {}
) {
  if (samples.length === 0) throw new Error("evaluateRound: no samples");
  const firstHelperPids = [...samples[0].helperPids].sort((a, b) => a - b);
  const firstSet = new Set(firstHelperPids);
  const reasons = [...extraReasons];
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
async function measureRound({ attempt, bin, spawnEnv, previousAppHelperPids }) {
  // 上一轮**本 app 的** helper 若还活着，会被新一轮基线当成「预先存在」排除，读数假低——先等它们退出。
  // 外来客户端的残留不进这项检查：它们本来就会跨轮存活，新一轮的基线快照会把它们排除。
  const leftoverHelperPids = previousAppHelperPids.length
    ? await waitForPidsGone(previousAppHelperPids, HELPER_EXIT_TIMEOUT_MS)
    : [];
  const baselineWebKit = (await procTable()).filter(isWebKit);
  const baselinePids = new Set(baselineWebKit.map((p) => p.pid));
  console.log(
    `[perf] memory attempt ${attempt} baseline: ${baselineWebKit.length} webkit pids before spawn` +
      (leftoverHelperPids.length ? `（上一轮 helper 未退出：${leftoverHelperPids.join(",")}）` : "")
  );
  const spawnedAtMs = Date.now();
  const child = spawn(bin, [], { stdio: ["ignore", "pipe", "inherit"], env: spawnEnv });
  const appPid = child.pid;
  let buf = "";
  let readyElapsedMs = null;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no LUMIR_READY within ${READY_TIMEOUT_MS}ms`)), READY_TIMEOUT_MS);
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      if (readyElapsedMs === null && buf.includes(READY_PREFIX)) {
        readyElapsedMs = Date.now() - spawnedAtMs;
        clearTimeout(timer);
        resolve();
      }
    });
  });
  const samples = [];
  let lastAttribution = null;
  let appStartMs = spawnedAtMs;
  try {
    await ready;
    await sleep(SETTLE_MS);
    for (let i = 0; i < SAMPLES; i++) {
      const attribution = attribute(await procTable(), appPid, baselinePids);
      lastAttribution = attribution;
      if (i === 0) {
        const appRow = attribution.processes.find((p) => p.pid === appPid);
        appStartMs = parseLstartEpochMs(appRow?.lstart) ?? spawnedAtMs;
      }
      // processes 是逐样本明细：整轮并集（mergeProcessDetails）靠它保留中途出现后又退出的 helper。
      samples.push({
        mb: attribution.mb,
        helperPids: attribution.helperPids,
        helperRssKB: attribution.helperRssKB,
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
  // 全轮并集：末样本之前退出的 helper 只存在于中间样本，必须从并集里保留其 pid/ppid/lstart/comm。
  const attributed = mergeProcessDetails(samples);
  const unionHelpers = attributed.filter(isWebKit);
  // app 退出后仍存活的 helper：本 app 的 helper 随主进程退出，活下来的属于别的客户端。
  const survivors = await waitForHelperSurvivors(unionHelpers, SURVIVAL_GRACE_MS);
  const earlyWindowMs = Math.max(EARLY_WINDOW_MS, (readyElapsedMs ?? 0) + READY_MARGIN_MS);
  const classified = classifyForeignHelpers({ helpers: unionHelpers, appStartMs, earlyWindowMs, survivors });
  const foreignPids = classified.foreign.map((p) => p.pid);
  const adjusted = samples.map((s) => excludeForeignHelpers(s, foreignPids));
  for (let i = 0; i < adjusted.length; i++) {
    if (adjusted[i] === samples[i]) continue;
    const dropped = samples[i].helperPids.filter((pid) => foreignPids.includes(pid));
    console.log(
      `[perf] memory foreign ${i + 1}/${SAMPLES} (attempt ${attempt}): ` +
        `${dropped.length} webkit [${dropped.join(",")}] 已剔除（late+survived）`
    );
  }
  if (foreignPids.length > 0) {
    console.log(
      `[perf] memory foreign helpers (attempt ${attempt}): ${foreignPids.length} [${foreignPids.join(",")}] ` +
        `（earlyWindow=${earlyWindowMs}ms；app 退出后仍存活 ${survivors.length} 个）`
    );
  }
  if (classified.unexplainedSurvivors.length > 0) {
    console.log(
      `[perf] memory unexplained survivors (attempt ${attempt}): ` +
        `${classified.unexplainedSurvivors.length} [${classified.unexplainedSurvivors.map((p) => p.pid).join(",")}]` +
        `（早到但存活：无法判别归属，判污染）`
    );
  }
  const extraReasons = classified.unexplainedSurvivors.length
    ? [
        {
          sample: null,
          kind: "helper-survived-app",
          detail: { helperPids: classified.unexplainedSurvivors.map((p) => p.pid).sort((a, b) => a - b) },
        },
      ]
    : [];
  const evaluation = evaluateRound(adjusted, { staleHelperPids: leftoverHelperPids, extraReasons });
  return {
    attempt,
    contaminated: evaluation.contaminated,
    reasons: evaluation.reasons,
    helperCounts: adjusted.map((s) => s.helperPids.length),
    sampleHelperPids: adjusted.map((s) => s.helperPids),
    // stale 检查只看本 app 的 helper：外来客户端的残留不阻挠重测。
    appHelperPidsAtExit: lastAttribution ? lastAttribution.helperPids.filter((pid) => !foreignPids.includes(pid)) : [],
    helperPidsAtExit: lastAttribution ? lastAttribution.helperPids : [],
    foreignHelperPids: foreignPids,
    foreignHelpers: classified.foreign,
    survivedAfterAppExit: survivors.map((p) => ({ pid: p.pid, lstart: p.lstart, comm: p.comm })),
    earlyWindowMs,
    leftoverHelperPids,
    samples: adjusted,
    attributedPids: [...new Set(attributed.map((p) => p.pid))].sort((a, b) => a - b),
    attributed,
    excludedBaselineWebKit: toProcessDetails(baselineWebKit),
  };
}

/** kill 后等 helper 消失；返回观察窗结束时仍存活的并集成员（pid+lstart 匹配，防 pid 复用）。 */
async function waitForHelperSurvivors(helpers, timeoutMs) {
  if (helpers.length === 0) return [];
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const aliveKeys = new Set((await procTable()).filter(isWebKit).map(helperKey));
    const alive = helpers.filter((h) => aliveKeys.has(helperKey(h)));
    if (alive.length === 0 || Date.now() >= deadline) return alive;
    await sleep(250);
  }
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
    appHelperPidsAtExit: a.appHelperPidsAtExit ?? [],
    foreignHelperPids: a.foreignHelperPids ?? [],
    foreignHelpers: a.foreignHelpers ?? [],
    survivedAfterAppExit: a.survivedAfterAppExit ?? [],
    earlyWindowMs: a.earlyWindowMs ?? null,
    leftoverHelperPids: a.leftoverHelperPids,
    attributedPids: a.attributedPids,
    attributed: a.attributed,
    excludedBaselineWebKit: a.excludedBaselineWebKit,
  };
}

/** 成功结果的 meta（纯函数，便于夹具测试与连续污染诊断共用的摘要形状）。 */
export function buildMeta({ attempts, acceptedAttempt, panes, xdgConfigHome, home }) {
  const accepted = attempts[acceptedAttempt - 1];
  return {
    settleMs: SETTLE_MS,
    intervalMs: INTERVAL_MS,
    attributedPids: accepted.attributedPids,
    attributed: accepted.attributed,
    excludedBaselineWebKit: accepted.excludedBaselineWebKit,
    foreignHelperPids: accepted.foreignHelperPids ?? [],
    foreignHelpers: accepted.foreignHelpers ?? [],
    survivedAfterAppExit: accepted.survivedAfterAppExit ?? [],
    earlyWindowMs: accepted.earlyWindowMs ?? null,
    contaminationPolicy: CONTAMINATION_POLICY,
    attemptsUsed: attempts.length,
    acceptedAttempt,
    attempts: attempts.map(summarizeAttempt),
    residualRisk: RESIDUAL_RISK,
    panes,
    xdgConfigHome,
    home,
    note:
      "RSS 合计（app 子孙 + 基线差集归因的 WebKit XPC），含 shared pages（系统性偏高）；门禁比较值为 max" +
      "；late+survived 的外来 helper 已从 RSS 与 helper 计数中剔除（明细见 foreignHelpers），" +
      "早到但存活、无法判别归属的 helper 仍判污染；污染轮读数整轮丢弃、不进统计（诊断见 meta.attempts）" +
      `；合成隔离 fixture：独立 HOME/XDG，panes=${panes}（0=无 vault，1/2=合成 vault 启动恢复）`,
  };
}

/**
 * 连续污染诊断件的内容（纯函数，便于夹具测试形状）。与成功结果的 meta 共用 summarizeAttempt，
 * 因此被丢弃的每一轮都带齐 attributed（全轮并集）与该轮 excludedBaselineWebKit。
 */
export function buildContaminatedPayload({ metric, attempts, panes, xdgConfigHome, home, reason, now = new Date() }) {
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
      panes,
      xdgConfigHome,
      home,
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
  // 缺省与 CI 同口径：独立 HOME/XDG + 无 last_vault 的合成空配置，不继承宿主 vault。
  // 显式 PERF_MEM_PANES=0|1|2 保留原变体及独立结果文件；1/2 使用合成 vault 与启动恢复会话。
  const explicitPanes = process.env.PERF_MEM_PANES;
  const panes = explicitPanes === undefined ? 0 : Number(explicitPanes);
  if (![0, 1, 2].includes(panes)) {
    console.error(`[perf] PERF_MEM_PANES 只接受 0/1/2（缺省=0，无 vault），收到 ${JSON.stringify(explicitPanes)}`);
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
  const fixture = await createAppFixture({ panes });
  const spawnEnv = fixture.env;
  const metric = explicitPanes === undefined ? "resident-memory" : `resident-memory-pane${panes}`;
  try {
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
        previousAppHelperPids: previous ? previous.appHelperPidsAtExit ?? [] : [],
      });
      attempts.push(round);
      const foreignNote = (round.foreignHelperPids?.length ?? 0) > 0
        ? `（剔除外来 helper ${round.foreignHelperPids.length} 个）`
        : "";
      console.log(
        `[perf] memory attempt ${round.attempt}: ` +
          (round.contaminated ? `${CONTAMINATION_REASON}（${formatReasons(round.reasons)}）` : `clean${foreignNote}`)
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
        meta: buildMeta({
          attempts,
          acceptedAttempt: resolved.acceptedAttempt,
          panes,
          xdgConfigHome: spawnEnv.XDG_CONFIG_HOME,
          home: spawnEnv.HOME,
        }),
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
      home: spawnEnv.HOME,
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
  } finally {
    await fixture.cleanup();
  }
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
