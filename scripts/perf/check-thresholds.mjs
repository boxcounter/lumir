// 阈值比较（spec §5 + 总约定「相对回归门禁」）：对照 tests/perf/thresholds.json 检查 perf-results/*.json。
// mode=absolute：门禁值 < threshold 即过；mode=relative：对照滚动基线（最近 window 次 master 门禁值
// 的 median），回退 > maxRegressionPct% 拒合。enforce=true 时超阈/回退/结果缺失均 exit 1；
// 基线缺失只 warning 不拒合（否则基线永远无法建立或重建）。
// 基线历史条目的统计口径（entry.gate）与当前门禁 gate 不一致时（如 p95 口径遗留的 cache），
// 跳过相对比较、warning 不拒合——混用统计量的比较必然系统性误报（M37），基线由下一次 master
// 成功 run 以新口径重建（见 update-baseline.mjs 的口径迁移逻辑）。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot, resultsDir, summarize } from "./lib/stats.mjs";

const thresholdsPath = path.join(repoRoot(), "tests/perf/thresholds.json");
const { enforce, regression = {}, metrics } = JSON.parse(
  await readFile(thresholdsPath, "utf8")
);
const outDir = resultsDir();
const baselinePath =
  process.env.PERF_BASELINE_FILE ??
  path.join(repoRoot(), regression.baselineFile ?? "perf-results/baseline/baseline.json");
const windowSize = regression.window ?? 10;
const maxRegressionPct = regression.maxRegressionPct ?? 20;

let baseline = null;
try {
  baseline = JSON.parse(await readFile(baselinePath, "utf8"));
} catch (err) {
  console.log(
    `::warning::[perf] 滚动基线缺失或不可读（${baselinePath}: ${err.code ?? err.message}），` +
      `相对回归指标本次跳过比较（不拒合）；基线由下一次 master 成功 run 重建`
  );
}

let violations = 0;
for (const [metric, cfg] of Object.entries(metrics)) {
  const resultPath = path.join(outDir, `${metric}.json`);
  let result;
  try {
    result = JSON.parse(await readFile(resultPath, "utf8"));
  } catch (err) {
    // enforce 后缺数据即红（reviewer finding 20260905）：缺失不得静默跳过
    if (enforce) {
      violations++;
      console.log(
        `::error::[perf] ${metric}: 结果文件缺失或不可读（${resultPath}: ${err.code ?? err.message}），拒合`
      );
    } else {
      console.log(
        `::warning::[perf] ${metric}: 结果文件缺失或不可读（${resultPath}: ${err.code ?? err.message}），跳过阈值比较`
      );
    }
    continue;
  }

  const statKey = cfg.gate ?? "p95";
  const value = result[statKey];

  if ((cfg.mode ?? "absolute") === "relative") {
    const entry = baseline?.metrics?.[metric];
    const history = entry?.history ?? [];
    if (history.length === 0) {
      console.log(
        `::warning::[perf] ${metric}: ${statKey}=${value.toFixed(2)}${result.unit}，` +
          `基线无历史，跳过相对回归比较（不拒合）`
      );
      continue;
    }
    if (entry.gate && entry.gate !== statKey) {
      console.log(
        `::warning::[perf] ${metric}: ${statKey}=${value.toFixed(2)}${result.unit}，` +
          `基线历史的统计口径（${entry.gate}）与当前门禁口径（${statKey}）不一致，` +
          `混用统计量的比较必然系统性误报，跳过相对回归比较（不拒合）；` +
          `基线由下一次 master 成功 run 以新口径重建`
      );
      continue;
    }
    const recent = history.slice(-windowSize).map((h) => h.value);
    const baselineValue = summarize(recent).median;
    const regressionPct = ((value - baselineValue) / baselineValue) * 100;
    const ok = regressionPct <= maxRegressionPct;
    const line =
      `${metric}: ${statKey}=${value.toFixed(2)}${result.unit} vs 基线 median-of-${statKey}s=${baselineValue.toFixed(2)}${result.unit} ` +
      `（最近 ${recent.length} 次 master），回退 ${regressionPct.toFixed(1)}% vs 容忍 ≤${maxRegressionPct}% ` +
      (ok ? "通过" : "回退超阈");
    if (ok) {
      console.log(`[perf] ${line}`);
    } else {
      violations++;
      console.log(
        `::${enforce ? "error" : "warning"}::[perf] ${line}${enforce ? "，拒合" : "（enforce=false，warn-only）"}`
      );
    }
    continue;
  }

  const ok = value < cfg.threshold;
  const line =
    `${metric}: ${statKey}=${value.toFixed(2)}${result.unit} vs 阈值 <${cfg.threshold}${result.unit} ` +
    (ok ? "通过" : "超阈");
  if (ok) {
    console.log(`[perf] ${line}`);
  } else {
    violations++;
    console.log(
      `::${enforce ? "error" : "warning"}::[perf] ${line}${enforce ? "，拒合" : "（enforce=false，warn-only）"}`
    );
  }
}

if (!enforce) {
  console.log("[perf] enforce=false：warn-only 模式，不拒合");
} else if (violations > 0) {
  console.error(`[perf] ${violations} 项违规（超阈/回退超阈/结果缺失），拒合`);
  process.exit(1);
} else {
  console.log("[perf] 全部门禁通过");
}
