// 阈值比较（spec §5 + 总约定「相对回归门禁」）：对照 tests/perf/thresholds.json 检查 perf-results/*.json。
// mode=absolute：门禁值 < threshold 即过；mode=relative：对照滚动基线（最近 window 次 master 门禁值的
// median），回退超过该指标容忍线拒合。enforce=true 时超阈/回退/结果缺失均 exit 1；
// 基线缺失只 warning 不拒合（否则基线永远无法建立或重建）。
//
// 相对回归的三条口径（2026-09-18 M174 修正，依据与算术见 spec「相对回归门禁」）：
// 0) 先分清主次：M172 的病根是**基线冻结**，不是容忍线太紧。抽样 9 次 master keypress 读数为
//    22.35–53.20ms（median 39.80ms），而冻结基线是**单样本** 28.15ms——比 9 次的 median 低 29%，
//    40% 判红线（28.15×1.4=39.4ms）于是落在实测散布内部。对 9 次读数做「k 条子集的 median」穷举：
//    k=1 时窗口 median 的可能范围就是整条散布（22.35–53.20，2.38 倍），k=5 起才收窄到 33.70–43.55。
//    即单样本「基线」根本不是一个水平值，而是散布里的一次抽样。（基线解冻 = update-baseline.mjs 那条。）
// 1) 容忍线逐指标：容忍线 = max(该指标配置值, 窗口高侧散布 × spreadHeadroom)。
//    keypress-to-paint 的配置值 60% 的来历：minRuns=5 下窗口 median 的最差组合是 33.70ms，与实测最高读数
//    53.20ms 相距 +57.9% → 取大于它的最小整十档 60%（静态 40% 在这个角落必误报）。
//    浮动项（spreadHeadroom）在当前实测数据上是**惰性**的：窗口高侧散布最高 44.4%×1.2=53.3% < 60%，
//    它是对 runner 未来抖动量级的前瞻护栏——抖动变大时容忍线随之抬高，runner 稳定后自动回落到配置值，
//    不会像静态常数那样在两种 runner 状态里必错一边。
// 2) 基线样本下限 minRuns=5：依据同上——k=1..4 的窗口 median 可达 +138%/117%/99%/76% 的假回退，
//    k=5 起收敛到 +57.9%；历史条数不足时判据稀薄 → 降级为 ::warning:: 不拒合（否则基线重建期必误报，
//    且永远走不出重建期）；但量级异常（超基线 median 的 outlierMultiplier 倍）仍拒合且不进基线——
//    稀薄的是精度，不是量级判断力。
// 3) 缺数据即红：enforce 下本次结果文件缺失仍是 exit 1，与上面两条无关。
//
// 判据落盘 perf-results/gate-status.json（逐指标 pass/fail/skip）供 update-baseline.mjs 逐指标裁决
// 基线推进——基线推进与「整个 run 是否全绿」解耦，见 spec「基线更新规则」。
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
const defaultMaxRegressionPct = regression.maxRegressionPct ?? 40;
const minRuns = regression.minRuns ?? 5;
const spreadHeadroom = regression.spreadHeadroom ?? 1.2;
const outlierMultiplier = regression.outlierMultiplier ?? 3;

let baseline = null;
try {
  baseline = JSON.parse(await readFile(baselinePath, "utf8"));
} catch (err) {
  console.log(
    `::warning::[perf] 滚动基线缺失或不可读（${baselinePath}: ${err.code ?? err.message}），` +
      `相对回归指标本次跳过比较（不拒合）；基线由下一次 master run 追加`
  );
}

// 容忍线 = max(配置值, 窗口高侧散布 × headroom)。返回值带 observedPct，供日志与 spec 的算术对齐。
function resolveTolerance(recent, configuredPct) {
  const s = summarize(recent);
  const observedPct = ((s.max - s.median) / s.median) * 100;
  return { pct: Math.max(configuredPct, observedPct * spreadHeadroom), observedPct };
}

// 逐指标判据：pass/fail 是拒合与否的裁决，skip 是「本次弃权但仍可进基线」（薄基线、基线缺失、口径迁移）。
const verdicts = {};
const record = (metric, v) => {
  verdicts[metric] = v;
};

let violations = 0;
for (const [metric, cfg] of Object.entries(metrics)) {
  const mode = cfg.mode ?? "absolute";
  const resultPath = path.join(outDir, `${metric}.json`);
  let result;
  try {
    result = JSON.parse(await readFile(resultPath, "utf8"));
  } catch (err) {
    // enforce 后缺数据即红（reviewer finding 20260905）：缺失不得静默跳过
    record(metric, { status: "fail", reason: "result-missing", mode });
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
  const unit = result.unit;

  if (mode === "relative") {
    const entry = baseline?.metrics?.[metric];
    const history = entry?.history ?? [];
    if (history.length === 0) {
      record(metric, { status: "skip", reason: "baseline-missing", mode, gate: statKey, value, unit });
      console.log(
        `::warning::[perf] ${metric}: ${statKey}=${value.toFixed(2)}${unit}，` +
          `基线无历史，跳过相对回归比较（不拒合）`
      );
      continue;
    }
    if (entry.gate && entry.gate !== statKey) {
      record(metric, { status: "skip", reason: "gate-mismatch", mode, gate: statKey, value, unit });
      console.log(
        `::warning::[perf] ${metric}: ${statKey}=${value.toFixed(2)}${unit}，` +
          `基线历史的统计口径（${entry.gate}）与当前门禁口径（${statKey}）不一致，` +
          `混用统计量的比较必然系统性误报，跳过相对回归比较（不拒合）；` +
          `基线由下一次 master 成功 run 以新口径重建`
      );
      continue;
    }
    const recent = history.slice(-windowSize).map((h) => h.value);
    const baselineValue = summarize(recent).median;
    const configuredPct = cfg.maxRegressionPct ?? defaultMaxRegressionPct;
    const { pct: tolerance, observedPct } = resolveTolerance(recent, configuredPct);
    const regressionPct = ((value - baselineValue) / baselineValue) * 100;
    const line =
      `${metric}: ${statKey}=${value.toFixed(2)}${unit} vs 基线 median-of-${statKey}s=${baselineValue.toFixed(2)}${unit} ` +
      `（最近 ${recent.length} 次 master），回退 ${regressionPct.toFixed(1)}% vs 容忍 ≤${tolerance.toFixed(1)}%` +
      `（配置 ${configuredPct}%、窗口高侧散布 ${observedPct.toFixed(1)}%×${spreadHeadroom}）`;
    const base = {
      mode,
      gate: statKey,
      value,
      unit,
      historyRuns: recent.length,
      baselineValue,
      regressionPct,
      tolerancePct: tolerance,
      configuredPct,
      observedSpreadPct: observedPct,
    };

    if (recent.length < minRuns) {
      // 薄基线：判据稀薄，降级为 warning；仅量级异常（超 outlierMultiplier 倍）仍然拒合。
      if (regressionPct > (outlierMultiplier - 1) * 100) {
        violations++;
        record(metric, { ...base, status: "fail", reason: "outlier-on-thin-baseline" });
        console.log(
          `::${enforce ? "error" : "warning"}::[perf] ${line}；基线仅 ${recent.length} 条（<minRuns ${minRuns}）` +
            `但本次读数超基线 ${outlierMultiplier} 倍，量级异常${enforce ? "，拒合" : "（enforce=false，warn-only）"}`
        );
      } else {
        record(metric, { ...base, status: "skip", reason: "baseline-thin" });
        const level = regressionPct > tolerance ? "::warning::" : "";
        console.log(
          `${level}[perf] ${line}；基线仅 ${recent.length} 条（<minRuns ${minRuns}），` +
            `判据稀薄、本次降级为不拒合（读数照常进基线以走出重建期）` +
            (level ? `（若按容忍线判本应拒合，此处不拒合）` : "")
        );
      }
      continue;
    }

    const ok = regressionPct <= tolerance;
    if (ok) {
      record(metric, { ...base, status: "pass" });
      console.log(`[perf] ${line}`);
    } else {
      violations++;
      record(metric, { ...base, status: "fail", reason: "regression-over-tolerance" });
      console.log(
        `::${enforce ? "error" : "warning"}::[perf] ${line}${enforce ? "，拒合" : "（enforce=false，warn-only）"}`
      );
    }
    continue;
  }

  const ok = value < cfg.threshold;
  const line =
    `${metric}: ${statKey}=${value.toFixed(2)}${unit} vs 阈值 <${cfg.threshold}${unit} ` +
    (ok ? "通过" : "超阈");
  const base = {
    mode,
    gate: statKey,
    value,
    unit,
    threshold: cfg.threshold,
  };
  if (ok) {
    record(metric, { ...base, status: "pass" });
    console.log(`[perf] ${line}`);
  } else {
    violations++;
    record(metric, { ...base, status: "fail", reason: "over-threshold" });
    console.log(
      `::${enforce ? "error" : "warning"}::[perf] ${line}${enforce ? "，拒合" : "（enforce=false，warn-only）"}`
    );
  }
}

// 判据落盘：update-baseline.mjs 据此逐指标推进基线（写入失败即拒合——没有判据就无从判断哪些读数可进基线）。
const statusPath = path.join(outDir, "gate-status.json");
try {
  await mkdir(outDir, { recursive: true });
  await writeFile(
    statusPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        runId: Number(process.env.GITHUB_RUN_ID ?? 0),
        enforce,
        baselinePath,
        baselinePresent: baseline !== null,
        metrics: verdicts,
      },
      null,
      2
    ) + "\n"
  );
  console.log(`[perf] 判据已落盘 ${statusPath}`);
} catch (err) {
  violations++;
  console.log(
    `::${enforce ? "error" : "warning"}::[perf] 判据落盘失败（${statusPath}: ${err.code ?? err.message}）` +
      `${enforce ? "，拒合（缺判据时基线推进无从裁决）" : ""}`
  );
}

if (!enforce) {
  console.log("[perf] enforce=false：warn-only 模式，不拒合");
} else if (violations > 0) {
  console.error(`[perf] ${violations} 项违规（超阈/回退超阈/结果缺失），拒合`);
  process.exit(1);
} else {
  console.log("[perf] 全部门禁通过");
}
