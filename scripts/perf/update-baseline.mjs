// 滚动基线更新（spec 总约定「相对回归门禁」）：仅 master push 且测量全绿后由 CI 调用。
// 把相对模式指标当次门禁值追加进 baseline.json，按窗口裁剪到最近 N 次。
// 结果缺失即 exit 1——红了的 run 不得污染基线。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot, resultsDir } from "./lib/stats.mjs";

const thresholdsPath = path.join(repoRoot(), "tests/perf/thresholds.json");
const { regression = {}, metrics } = JSON.parse(
  await readFile(thresholdsPath, "utf8")
);
const windowSize = regression.window ?? 10;
const baselinePath =
  process.env.PERF_BASELINE_FILE ??
  path.join(repoRoot(), regression.baselineFile ?? "perf-results/baseline/baseline.json");
const outDir = resultsDir();

let baseline = { metrics: {} };
try {
  baseline = JSON.parse(await readFile(baselinePath, "utf8"));
} catch {
  console.log(`[perf] 基线不存在，新建：${baselinePath}`);
}

const runId = Number(process.env.GITHUB_RUN_ID ?? 0);
const ts = new Date().toISOString();
let updated = 0;

for (const [metric, cfg] of Object.entries(metrics)) {
  if ((cfg.mode ?? "absolute") !== "relative") continue;
  const statKey = cfg.gate ?? "p95";
  const resultPath = path.join(outDir, `${metric}.json`);
  let result;
  try {
    result = JSON.parse(await readFile(resultPath, "utf8"));
  } catch (err) {
    console.error(
      `[perf] ${metric}: 结果缺失或不可读（${err.code ?? err.message}），拒绝更新基线`
    );
    process.exit(1);
  }
  const entry = (baseline.metrics[metric] ??= {
    unit: cfg.unit,
    gate: statKey,
    history: [],
  });
  entry.history.push({ run_id: runId, ts, value: result[statKey] });
  entry.history = entry.history.slice(-windowSize);
  console.log(
    `[perf] ${metric}: 基线追加 ${result[statKey].toFixed(2)}${cfg.unit}（run ${runId}），窗口现存 ${entry.history.length} 次`
  );
  updated++;
}

if (updated === 0) {
  console.log("[perf] 无相对模式指标，基线不变");
  process.exit(0);
}

await mkdir(path.dirname(baselinePath), { recursive: true });
await writeFile(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
console.log(`[perf] 基线已写回 ${baselinePath}`);
