// 滚动基线更新（spec 总约定「相对回归门禁」）：仅 master push 调用，调用条件为 always()
// ——基线推进与「整个 run 是否全绿」解耦（M174）。原口径 `if: success()` 的死锁：任一指标确定性
// 超阈（M172：resident-memory 9/9 超阈）⇒ 整个 run 永不 success ⇒ 全部相对基线永久冻结，
// 于是 keypress-to-paint 长期对着单样本基线比较、越比越红（日志「最近 1 次 master」即为证）。
//
// 是否推进逐指标裁决，判据取 check-thresholds.mjs 落盘的 perf-results/gate-status.json：
// - status=pass：本次读数经门禁裁决合格 → 追加；
// - status=skip：本次弃权（基线缺失/窗口未满 minRuns/统计口径迁移），读数本身可读 → 追加
//   （否则窗口永远攒不满，薄基线降级会把自己锁死）；
// - status=fail：本次读数被拒合 → 不追加（拒合的 run 不污染基线）；enforce=false 的 warn-only 档不拒合
//   任何读数，故该档下 fail 照常追加（判据与 check-thresholds.mjs 的拒合判据是同一个，此处不另判一次）；
// - 缺判据 / 无该指标判据 / 读数不可读：fail-closed，不追加。
// 缺读数不再 exit 1：缺数据本身已由 check-thresholds.mjs 按 enforce 拒合，这里多红一次只会掩盖真红点。
//
// 统计口径迁移：entry.gate 与当前门禁 gate 不一致时（如 p95 口径遗留的 cache），丢弃旧口径
// 历史以新口径重建——旧条目存的是另一种统计量，混用会让窗口 median 系统性偏离（M37）。
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

let gateStatus = null;
const statusPath = path.join(outDir, "gate-status.json");
try {
  gateStatus = JSON.parse(await readFile(statusPath, "utf8"));
} catch (err) {
  console.log(
    `::warning::[perf] 判据文件缺失或不可读（${statusPath}: ${err.code ?? err.message}），` +
      `无法裁决任何指标，本次不推进基线（fail-closed；判据由 check-thresholds.mjs 落盘）`
  );
}

const runId = Number(process.env.GITHUB_RUN_ID ?? 0);
const ts = new Date().toISOString();
let updated = 0;

for (const [metric, cfg] of Object.entries(metrics)) {
  if ((cfg.mode ?? "absolute") !== "relative") continue;
  const statKey = cfg.gate ?? "p95";

  const verdict = gateStatus?.metrics?.[metric];
  if (!verdict) {
    console.log(
      `::warning::[perf] ${metric}: 判据缺失（${statusPath} 无该指标条目），本次不推进该指标基线`
    );
    continue;
  }
  // enforce=false 是校准/观察档，此时门禁不拒合任何读数（只 warning），故 fail 也照常进基线；
  // enforce=true（现网配置）下 fail 一律不进——「异常读数不污染基线」的判据与 check-thresholds.mjs 的
  // 拒合判据是同一个，避免两处各判一次导致口径分叉。
  const enforcing = gateStatus?.enforce !== false;
  if (verdict.status === "fail" && enforcing) {
    console.log(
      `[perf] ${metric}: 本次判据 ${verdict.reason ?? "fail"}，读数不进基线（拒合的 run 不污染基线）`
    );
    continue;
  }

  const resultPath = path.join(outDir, `${metric}.json`);
  let result;
  try {
    result = JSON.parse(await readFile(resultPath, "utf8"));
  } catch (err) {
    console.log(
      `::warning::[perf] ${metric}: 结果缺失或不可读（${err.code ?? err.message}），本次不推进该指标基线`
    );
    continue;
  }

  let entry = baseline.metrics[metric];
  if (entry && entry.gate && entry.gate !== statKey) {
    console.log(
      `[perf] ${metric}: 基线统计口径变更（${entry.gate}→${statKey}），` +
        `丢弃旧口径历史 ${entry.history?.length ?? 0} 条，以新口径重建`
    );
    entry = undefined;
  }
  entry = baseline.metrics[metric] = entry ?? {
    unit: cfg.unit,
    gate: statKey,
    history: [],
  };
  entry.gate = statKey;
  entry.history.push({ run_id: runId, ts, value: result[statKey] });
  entry.history = entry.history.slice(-windowSize);
  console.log(
    `[perf] ${metric}: 判据 ${verdict.status}${verdict.reason ? `/${verdict.reason}` : ""}，` +
      `基线追加 ${result[statKey].toFixed(2)}${cfg.unit}（run ${runId}），窗口现存 ${entry.history.length} 次`
  );
  updated++;
}

// 无论是否推进都写回文件：cache/save 步骤因此总有路径可取，不必再依赖上一步的 success 状态。
await mkdir(path.dirname(baselinePath), { recursive: true });
await writeFile(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
console.log(
  updated === 0
    ? `[perf] 无指标推进（相对模式指标判据均不可用或未通过），基线保持原值并已写回 ${baselinePath}`
    : `[perf] 基线已写回 ${baselinePath}（本次推进 ${updated} 项）`
);
