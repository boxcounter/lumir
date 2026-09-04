// 阈值比较（spec §5）：对照 tests/perf/thresholds.json 检查 perf-results/*.json。
// 校准前 enforce=false：超阈只发 ::warning::，退出码恒 0；M0 末校准后置 true，超阈即 CI 红。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot, resultsDir } from "./lib/stats.mjs";

const thresholdsPath = path.join(repoRoot(), "tests/perf/thresholds.json");
const { enforce, metrics } = JSON.parse(await readFile(thresholdsPath, "utf8"));
const outDir = resultsDir();

let violations = 0;
for (const [metric, cfg] of Object.entries(metrics)) {
  const resultPath = path.join(outDir, `${metric}.json`);
  let result;
  try {
    result = JSON.parse(await readFile(resultPath, "utf8"));
  } catch (err) {
    // 结果缺失（上游步骤失败或 perf-results/ 不存在）也保持 warn-only，不 ENOENT 崩溃
    console.log(`::warning::[perf] ${metric}: 结果文件缺失或不可读（${resultPath}: ${err.code ?? err.message}），跳过阈值比较`);
    continue;
  }
  const statKey = cfg.gate ?? "p95";
  const value = result[statKey];
  const ok = value < cfg.threshold;
  const line =
    `${metric}: ${statKey}=${value.toFixed(2)}${result.unit} vs 阈值 <${cfg.threshold}${result.unit} ` +
    (ok ? "通过" : "超阈");
  if (ok) {
    console.log(`[perf] ${line}`);
  } else {
    violations++;
    console.log(`::warning::[perf] ${line}${enforce ? "" : "（校准前 warn-only，不拒合）"}`);
  }
}

if (!enforce) {
  console.log("[perf] enforce=false：阈值拒合待 M0 末一次性校准后启用（ADR 0002 revisit / spec §5）");
} else if (violations > 0) {
  console.error(`[perf] ${violations} 项指标超阈，拒合`);
  process.exit(1);
}
