// 统计与结果落盘 —— 四项测量脚本共用的唯一统计实现（spec: docs/specs/perf-measurement.md 总约定）。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function summarize(samples) {
  if (samples.length === 0) throw new Error("no samples");
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const median =
    n % 2 === 1
      ? sorted[(n - 1) / 2]
      : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  // nearest-rank p95
  const p95 = sorted[Math.ceil(0.95 * n) - 1];
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  return { median, p95, max: sorted[n - 1], min: sorted[0], mean };
}

// 产出根：`.local/perf/`（git 外，`.local/` 已在 .gitignore 内；场景分层见 .local/README.md）。
// `PERF_RESULTS_DIR` 覆盖能力保留（本地取数、探针复跑用）。
export function resultsDir() {
  return process.env.PERF_RESULTS_DIR ?? path.join(repoRoot(), ".local/perf");
}

// 滚动基线落点：`PERF_BASELINE_FILE` > thresholds.json 的 `regression.baselineFile` > 默认。
// 单点解析——原本两个脚本各写一份「默认值 + 环境变量」链，改路径时容易只改一处
// （REVIEW.md「同一语义两处真源」条）。
export function baselinePath(baselineFile) {
  return (
    process.env.PERF_BASELINE_FILE ??
    path.join(repoRoot(), baselineFile ?? ".local/perf/baseline/baseline.json")
  );
}

// 结果 schema 见 spec 总约定：metric/unit/contract/samples/统计量/meta。
export async function writeResult({ metric, unit, contract, samples, meta = {} }) {
  const result = {
    metric,
    unit,
    contract,
    samples,
    ...summarize(samples),
    meta: {
      ts: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      ci: !!process.env.CI,
      ...meta,
    },
  };
  const outDir = resultsDir();
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${metric}.json`);
  await writeFile(file, JSON.stringify(result, null, 2) + "\n");
  console.log(
    `[perf] ${metric}: p95=${result.p95.toFixed(2)}${unit} ` +
      `median=${result.median.toFixed(2)} max=${result.max.toFixed(2)} ` +
      `(n=${samples.length}, contract<${contract}${unit}) -> ${file}`
  );
  return result;
}

export function repoRoot() {
  // scripts/perf/lib/stats.mjs -> repo root
  return path.resolve(new URL(".", import.meta.url).pathname, "../../..");
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
