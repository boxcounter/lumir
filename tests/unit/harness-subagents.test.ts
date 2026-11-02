// 子代理任务区的纯模型层单测（change add-harness-subagents tasks §10，M590）：
//   - 事件 → 任务行状态的归约（started / progress / step / finished；未知 run 与未知终态丢弃）；
//   - 批准关联（挂起 → 等待批准；决策 / 收回 → 回到运行中）；
//   - 标题计数与「全部收敛后的一行摘要」、触顶提示行两种文案、按模型用量读数；
//   - 通知载荷的宽容解析（形状不认识即不显示 / 原文兜底，不伪造）。
// 合同：design §19 的可见面口径 + tasks §10.1–§10.8。
// 这一层是零 DOM 环境（tests/unit/README.md）：只驱动 src/harness-panel.ts 导出的纯函数；
// 行渲染与 AX 判据归真机场景 §8.19 / §8.21。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachRunApproval,
  autoWakeAlertText,
  detachRunApproval,
  formatDuration,
  isLiveSubrun,
  mergeLiveSubruns,
  noticeHeadline,
  noticeLineText,
  noticeRunsOf,
  parseApprovalSource,
  parseLiveSubruns,
  parseNoticeDisplayText,
  reduceSubruns,
  subrunDetailMeta,
  subrunStatusOf,
  subrunStatusWord,
  subrunStoppedByWord,
  subrunUsageLine,
  subrunUsageRows,
  subrunUsageSummary,
  taskAreaRuns,
  taskHeadline,
} from "../../src/harness-panel.ts";
import type { SubrunView } from "../../src/harness-panel.ts";

function started(runId: string, overrides: Record<string, unknown> = {}): SubrunView[] {
  return reduceSubruns([], {
    type: "subagent_started",
    run_id: runId,
    agent: "research",
    description: "梳理变更",
    model: "mock-fast",
    background: false,
    ...overrides,
  } as Parameters<typeof reduceSubruns>[1]);
}

test("subrunStatusOf：后端终态映射到行状态，未知值返回 null（不猜）", () => {
  assert.equal(subrunStatusOf("running"), "running");
  assert.equal(subrunStatusOf("completed"), "done");
  assert.equal(subrunStatusOf("partial"), "partial");
  assert.equal(subrunStatusOf("failed"), "failed");
  assert.equal(subrunStatusOf("aborted"), "stopped");
  assert.equal(subrunStatusOf("unknown-status"), null);
  assert.equal(subrunStatusOf(undefined), null);
});

test("reduceSubruns：started 建行，progress / step 就地更新不改行数", () => {
  let runs = started("r1");
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.status, "running");
  assert.equal(runs[0]?.segments, 1);

  runs = reduceSubruns(runs, {
    type: "subagent_progress",
    run_id: "r1",
    rounds: 3,
    tool_calls: 2,
    last_tool: "vault_read",
    elapsed_ms: 12_000,
  });
  assert.equal(runs[0]?.rounds, 3);
  assert.equal(runs[0]?.toolCalls, 2);
  assert.equal(runs[0]?.elapsedMs, 12_000);

  runs = reduceSubruns(runs, {
    type: "subagent_step",
    run_id: "r1",
    tool: "vault_search",
    summary: "30_规范/** · 18 个文件",
  });
  assert.equal(runs[0]?.lastTool, "vault_search");
  assert.deepEqual(runs[0]?.steps, [{ tool: "vault_search", summary: "30_规范/** · 18 个文件" }]);
  assert.equal(runs.length, 1);
});

test("reduceSubruns：finished 落终态与用量；未知 run / 未知终态一律丢弃（不凭空造行）", () => {
  let runs = started("r1");
  runs = reduceSubruns(runs, {
    type: "subagent_finished",
    run_id: "r1",
    agent: "research",
    status: "partial",
    stopped_by: "tokens",
    rounds: 8,
    model: "mock-strong",
    input_tokens: 90_000,
    cached_tokens: 50_000,
    output_tokens: 2_000,
    denied_calls: 1,
    duration_ms: 111_000,
    summary_chars: 240,
  });
  assert.equal(runs[0]?.status, "partial");
  assert.equal(runs[0]?.stoppedBy, "tokens");
  assert.equal(runs[0]?.model, "mock-strong");
  assert.equal(runs[0]?.inputTokens, 90_000);
  assert.equal(runs[0]?.summaryChars, 240);
  assert.equal(runs[0]?.elapsedMs, 111_000);

  const before = runs.length;
  runs = reduceSubruns(runs, {
    type: "subagent_finished",
    run_id: "never-started",
    agent: "research",
    status: "completed",
    rounds: 1,
    model: "mock-fast",
    input_tokens: 1,
    cached_tokens: 0,
    output_tokens: 1,
    denied_calls: 0,
    duration_ms: 1,
    summary_chars: 1,
  });
  assert.equal(runs.length, before, "未知 run 的完成事件不得凭空造出一行");

  const unknown = reduceSubruns(runs, {
    type: "subagent_finished",
    run_id: "r1",
    agent: "research",
    status: "made-up",
    rounds: 1,
    model: "mock-fast",
    input_tokens: 1,
    cached_tokens: 0,
    output_tokens: 1,
    denied_calls: 0,
    duration_ms: 1,
    summary_chars: 1,
  });
  assert.equal(unknown[0]?.status, "partial", "未知终态不得覆盖已落定的状态");
});

test("批准关联：挂起 → 等待批准；最后一个待批项消失 → 回到运行中；终态不被翻面", () => {
  let runs = started("r1");
  runs = attachRunApproval(runs, "r1", "apr-1");
  runs = attachRunApproval(runs, "r1", "apr-2");
  assert.equal(runs[0]?.status, "waiting");
  assert.deepEqual(runs[0]?.approvalIds, ["apr-1", "apr-2"]);

  runs = detachRunApproval(runs, "apr-1");
  assert.equal(runs[0]?.status, "waiting", "还有一张卡挂着，行仍是等待批准");
  runs = detachRunApproval(runs, "apr-2");
  assert.equal(runs[0]?.status, "running", "拒绝 / 批准后行回到运行中");
  assert.deepEqual(runs[0]?.approvalIds, []);

  const finished = reduceSubruns(runs, {
    type: "subagent_finished",
    run_id: "r1",
    agent: "research",
    status: "completed",
    rounds: 2,
    model: "mock-fast",
    input_tokens: 1,
    cached_tokens: 0,
    output_tokens: 1,
    denied_calls: 0,
    duration_ms: 5,
    summary_chars: 0,
  });
  const late = attachRunApproval(finished, "r1", "apr-3");
  assert.equal(late[0]?.status, "done", "迟到的批准事件不得把终态行翻回等待批准");
});

test("taskAreaRuns：单前台 run 不进控制区；≥2 在跑 / 后台 / 待批 / 未确认后台失败才进", () => {
  const running = started("r1");
  assert.deepEqual(taskAreaRuns(running, new Set()), [], "单个前台 run 只住在对话流");

  let two = reduceSubruns(running, {
    type: "subagent_started",
    run_id: "r2",
    agent: "reviewer",
    description: "复核结论",
    model: "mock-strong",
    background: false,
  });
  assert.deepEqual(
    taskAreaRuns(two, new Set()).map((run) => run.runId),
    ["r1", "r2"],
    "两个在跑时才需要合并视图",
  );

  // 后台 run（同一条 started 事件的 background=true）单独在跑也进控制区。
  let background = reduceSubruns([], {
    type: "subagent_started",
    run_id: "r3",
    agent: "scribe",
    description: "落成笔记",
    model: "mock-fast",
    background: true,
  });
  assert.deepEqual(taskAreaRuns(background, new Set()).map((run) => run.runId), ["r3"]);

  // 等待批准 = 打断级，必须进控制区（即使只有一个前台 run）。
  let waiting = attachRunApproval(running, "r1", "apr-1");
  assert.deepEqual(taskAreaRuns(waiting, new Set()).map((run) => run.runId), ["r1"]);

  // 后台失败保留到用户确认；确认后不再出现。
  const failedBackground = reduceSubruns(background, {
    type: "subagent_finished",
    run_id: "r3",
    agent: "scribe",
    status: "failed",
    rounds: 1,
    model: "mock-fast",
    input_tokens: 10,
    cached_tokens: 0,
    output_tokens: 2,
    denied_calls: 0,
    duration_ms: 900,
    summary_chars: 0,
  });
  assert.deepEqual(taskAreaRuns(failedBackground, new Set()).map((run) => run.runId), ["r3"]);
  assert.deepEqual(taskAreaRuns(failedBackground, new Set(["r3"])), [], "点过「知道了」就不再占位");

  // 前台失败不占控制区（用户就在对话流里）；完成的后台行立即消失。
  const failedForeground = { ...failedBackground[0]!, background: false };
  assert.deepEqual(taskAreaRuns([failedForeground], new Set()), []);
  const doneBackground = { ...background[0]!, status: "done" as const };
  assert.deepEqual(taskAreaRuns([doneBackground], new Set()), []);
});

test("taskHeadline：只数控制区可见行；未确认失败单独计数；无行时为空串", () => {
  assert.equal(taskHeadline([], "zh"), "");

  let runs = started("r1");
  runs = reduceSubruns(runs, {
    type: "subagent_started",
    run_id: "r2",
    agent: "reviewer",
    description: "复核结论",
    model: "mock-strong",
    background: false,
  });
  assert.equal(taskHeadline(runs, "zh"), "任务 2 个运行中");
  assert.equal(taskHeadline(runs, "en"), "Tasks 2 running");

  let background = reduceSubruns([], {
    type: "subagent_started",
    run_id: "r3",
    agent: "scribe",
    description: "落成笔记",
    model: "mock-fast",
    background: true,
  });
  assert.equal(taskHeadline(background, "zh"), "任务 1 个后台运行中");

  let waiting = attachRunApproval(runs, "r1", "apr-1");
  waiting = reduceSubruns(waiting, {
    type: "subagent_started",
    run_id: "r3",
    agent: "scribe",
    description: "落成笔记",
    model: "mock-fast",
    background: true,
  });
  assert.equal(taskHeadline(waiting, "zh"), "任务 1 个运行中 · 1 个后台运行中 · 1 个等待批准");

  const failed = reduceSubruns(background, {
    type: "subagent_finished",
    run_id: "r3",
    agent: "scribe",
    status: "failed",
    rounds: 3,
    model: "mock-fast",
    input_tokens: 10,
    cached_tokens: 0,
    output_tokens: 2,
    denied_calls: 0,
    duration_ms: 900,
    summary_chars: 0,
  });
  assert.equal(taskHeadline(failed, "zh"), "任务 · 1 个需要你查看");
  assert.equal(taskHeadline(failed, "en"), "Tasks · 1 to review");
});

test("reduceSubruns：同一 run_id 的 resume 段合并为一个身份，rounds / steps / 用量跨段累计", () => {
  // 段一：5 轮、12 次工具调用，tokens 触顶后 partial。
  let runs = started("r1");
  runs = reduceSubruns(runs, {
    type: "subagent_progress",
    run_id: "r1",
    rounds: 5,
    tool_calls: 12,
    last_tool: "vault_read",
    elapsed_ms: 93_000,
  });
  runs = reduceSubruns(runs, {
    type: "subagent_step",
    run_id: "r1",
    tool: "vault_read",
    summary: "a.md",
  });
  runs = reduceSubruns(runs, {
    type: "subagent_finished",
    run_id: "r1",
    agent: "research",
    status: "partial",
    stopped_by: "tokens",
    rounds: 5,
    model: "mock-fast",
    input_tokens: 80_000,
    cached_tokens: 60_000,
    output_tokens: 2_000,
    denied_calls: 0,
    duration_ms: 93_000,
    summary_chars: 20,
    summary: "第一段摘要",
  });
  runs = reduceSubruns(runs, {
    type: "subagent_started",
    run_id: "r1",
    agent: "research",
    description: "梳理变更",
    model: "mock-fast",
    background: false,
  });
  assert.equal(runs.length, 1, "同一 run 的第二段不得另立一行");
  assert.equal(runs[0]?.segments, 2);
  assert.equal(runs[0]?.status, "running");
  assert.equal(runs[0]?.rounds, 5, "第二段尚未发进度前保留第一段读数");
  assert.equal(runs[0]?.toolCalls, 12);
  assert.equal(runs[0]?.steps.length, 1);

  // 段二：段内 1 轮、2 次调用 ⇒ 累计 6 轮、14 次。
  runs = reduceSubruns(runs, {
    type: "subagent_progress",
    run_id: "r1",
    rounds: 1,
    tool_calls: 2,
    last_tool: "vault_search",
    elapsed_ms: 9_000,
  });
  assert.equal(runs[0]?.rounds, 6);
  assert.equal(runs[0]?.toolCalls, 14);
  runs = reduceSubruns(runs, {
    type: "subagent_step",
    run_id: "r1",
    tool: "vault_search",
    summary: "30_规范/**",
  });
  assert.equal(runs[0]?.steps.length, 2);
  runs = reduceSubruns(runs, {
    type: "subagent_finished",
    run_id: "r1",
    agent: "research",
    status: "completed",
    rounds: 1,
    model: "mock-fast",
    input_tokens: 20_000,
    cached_tokens: 10_000,
    output_tokens: 1_000,
    denied_calls: 0,
    duration_ms: 9_000,
    summary_chars: 10,
    summary: "第二段摘要",
  });
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.segments, 2);
  assert.equal(runs[0]?.status, "done");
  assert.equal(runs[0]?.rounds, 6, "完成事件带段内轮次，需加到段基线上");
  assert.equal(runs[0]?.inputTokens, 100_000, "用量按 run 累计（两段相加）");
  assert.equal(runs[0]?.cachedTokens, 70_000);
  assert.equal(runs[0]?.outputTokens, 3_000);
  assert.equal(runs[0]?.summary, "第二段摘要");
  assert.equal(runs[0]?.segments, 2);
});

test("subrunDetailMeta / subrunUsageLine：rounds 只在触顶时出现；用量缺读数不伪造", () => {
  let runs = started("r1");
  runs = reduceSubruns(runs, {
    type: "subagent_progress",
    run_id: "r1",
    rounds: 4,
    tool_calls: 7,
    last_tool: "vault_read",
    elapsed_ms: 61_000,
  });
  const running = runs[0]!;
  assert.deepEqual(subrunDetailMeta(running, "zh"), ["模型 mock-fast", "7 步", "用时 1m01s"]);
  assert.equal(subrunUsageLine(running, "zh"), "", "还没有真读数时不出用量行");

  const done = reduceSubruns(runs, {
    type: "subagent_finished",
    run_id: "r1",
    agent: "research",
    status: "completed",
    rounds: 4,
    model: "mock-fast",
    input_tokens: 82_000,
    cached_tokens: 60_000,
    output_tokens: 2_400,
    denied_calls: 0,
    duration_ms: 61_000,
    summary_chars: 10,
  })[0]!;
  assert.deepEqual(subrunDetailMeta(done, "zh"), ["模型 mock-fast", "7 步", "用时 1m01s"]);
  assert.equal(subrunUsageLine(done, "zh"), "用量：输入 82k（缓存 60k）· 输出 2.4k");

  const stopped = reduceSubruns(runs, {
    type: "subagent_finished",
    run_id: "r1",
    agent: "research",
    status: "partial",
    stopped_by: "rounds",
    rounds: 8,
    model: "mock-fast",
    input_tokens: 10,
    cached_tokens: 0,
    output_tokens: 1,
    denied_calls: 0,
    duration_ms: 61_000,
    summary_chars: 0,
  })[0]!;
  assert.deepEqual(subrunDetailMeta(stopped, "zh"), [
    "模型 mock-fast",
    "7 步",
    "用时 1m01s",
    "用尽轮次预算（8 轮）",
  ]);
});

test("subrunUsageSummary：单模型桶不分桶、只给总量；多桶才按模型分组", () => {
  const single = subrunUsageSummary(
    { "mock-fast": { input: 118_000, cached: 74_000, output: 5_200, samples: 4, segments: 3 } },
    "zh",
  );
  assert.equal(single.grouped, false);
  assert.equal(single.rows.length, 1);
  assert.equal(single.rows[0]?.model, "");
  assert.match(single.rows[0]?.text ?? "", /118k/);
  assert.match(single.rows[0]?.text ?? "", /3 段/);

  const multi = subrunUsageSummary(
    {
      "mock-strong": { input: 44_000, cached: 28_000, output: 2_100, samples: 2, segments: 1 },
      "mock-fast": { input: 118_000, cached: 74_000, output: 5_200, samples: 4, segments: 3 },
      broken: { input: "nope" },
    },
    "zh",
  );
  assert.equal(multi.grouped, true);
  assert.deepEqual(multi.rows.map((row) => row.model), ["mock-fast", "mock-strong"]);

  assert.deepEqual(subrunUsageSummary(null, "zh"), { grouped: false, rows: [] });
});

test("parseLiveSubruns / mergeLiveSubruns：快照是在跑行的权威来源，切走期间收尾的不复活", () => {
  const live = parseLiveSubruns([
    {
      run_id: "r1",
      agent: "research",
      description: "梳理变更",
      model: "mock-fast",
      background: true,
      segment: 2,
      rounds: 3,
      tool_calls: 7,
      last_tool: "vault_read",
      elapsed_ms: 12_000,
    },
    { run_id: "", agent: "broken" },
    "not-an-object",
  ]);
  assert.equal(live.length, 1);
  assert.equal(live[0]?.runId, "r1");
  assert.equal(live[0]?.segments, 2);
  assert.equal(live[0]?.rounds, 3);
  assert.equal(live[0]?.toolCalls, 7);
  assert.equal(live[0]?.lastTool, "vault_read");
  assert.equal(live[0]?.elapsedMs, 12_000);
  assert.equal(live[0]?.status, "running");

  // 本地视图已有 steps / 摘要：快照合并保留它们（过程材料不在快照里）。
  let local = started("r1");
  local = reduceSubruns(local, {
    type: "subagent_step",
    run_id: "r1",
    tool: "vault_search",
    summary: "30_规范/**",
  });
  const merged = mergeLiveSubruns(local, live);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0]?.steps, [{ tool: "vault_search", summary: "30_规范/**" }]);
  assert.equal(merged[0]?.rounds, 3);

  // 快照没有它 = 已收尾：移除，不保留假的「运行中」。
  assert.deepEqual(mergeLiveSubruns(local, []), []);

  // 后台异常终态待确认的行不在 live 列表里，原样保留。
  let background = started("r2", { background: true });
  background = reduceSubruns(background, {
    type: "subagent_finished",
    run_id: "r2",
    agent: "research",
    status: "failed",
    rounds: 1,
    model: "mock-fast",
    input_tokens: 10,
    cached_tokens: 0,
    output_tokens: 2,
    denied_calls: 0,
    duration_ms: 900,
    summary_chars: 0,
  });
  const kept = mergeLiveSubruns(background, []);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.status, "failed");

  // 陈旧快照：同一段的迟到回包（segments 不增）不得把已收尾的 run 复活成运行中。
  const stale = mergeLiveSubruns(background, [{ ...live[0]!, runId: "r2", segments: 1 }]);
  assert.equal(stale[0]?.status, "failed", "同一段号的迟到回包 MUST NOT 复活终态行");

  // 上一段已收尾、新段在跑（切走期间发生 resume）：同一身份续上、段数 +1、段基线建立。
  const resumed = mergeLiveSubruns(background, [{ ...live[0]!, runId: "r2", segments: 3 }]);
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0]?.status, "running");
  assert.equal(resumed[0]?.segments, 3, "上一段是第 2 段 ⇒ 新段是第 3 段");
  assert.equal(resumed[0]?.rounds, background[0]!.rounds, "新段读数尚未到达时保留旧累计");
  assert.notEqual(resumed[0]?.segmentBase, null);

  assert.deepEqual(parseLiveSubruns(null), []);
});

test("isLiveSubrun：只有运行中 / 等待批准算在跑", () => {
  const [run] = started("r1");
  assert.equal(isLiveSubrun(run!), true);
  assert.equal(isLiveSubrun({ ...run!, status: "waiting" }), true);
  assert.equal(isLiveSubrun({ ...run!, status: "partial" }), false);
  assert.equal(isLiveSubrun({ ...run!, status: "failed" }), false);
});


test("autoWakeAlertText：chain_limit / stopped 两种文案 + 已继续结果句；未触顶为 null", () => {
  assert.equal(autoWakeAlertText(null, 5, false, "zh"), null);
  assert.equal(
    autoWakeAlertText("chain_limit", 5, false, "zh"),
    "自动回合已达上限（5）：后续后台结果只上屏，等你发言后处理。",
  );
  assert.equal(
    autoWakeAlertText("stopped", 5, false, "zh"),
    "你停止了自动回合：后续后台结果只上屏，不再自动唤醒。",
  );
  assert.equal(
    autoWakeAlertText("stopped", 5, true, "zh"),
    "已继续：链计数清零，已按待处理通知起一个回合",
  );
  assert.match(autoWakeAlertText("chain_limit", 5, false, "en") ?? "", /limit \(5\)/);
});

test("subrunStatusWord / subrunStoppedByWord：词表唯一，未知原因原样返回", () => {
  assert.equal(subrunStatusWord("waiting", "zh"), "等待批准");
  assert.equal(subrunStatusWord("done", "en"), "Completed");
  assert.equal(subrunStoppedByWord("tokens", "zh"), "token 预算");
  assert.equal(subrunStoppedByWord("quota", "en"), "quota exhausted");
  assert.equal(subrunStoppedByWord("mystery", "zh"), "mystery", "未知原因不吞信息");
});

test("subrunUsageRows：按模型分桶成读数行，坏桶跳过、键序确定", () => {
  const rows = subrunUsageRows(
    {
      "mock-strong": { input: 44_000, cached: 28_000, output: 2_100, samples: 2, segments: 1 },
      "mock-fast": { input: 118_000, cached: 74_000, output: 5_200, samples: 4, segments: 3 },
      broken: { input: "nope" },
    },
    "zh",
  );
  assert.deepEqual(rows.map((row) => row.model), ["mock-fast", "mock-strong"]);
  assert.match(rows[0]?.text ?? "", /118k/);
  assert.match(rows[0]?.text ?? "", /3 段/);
  assert.deepEqual(subrunUsageRows(null), []);
});

test("formatDuration：秒 / 分秒 / 时分的短串", () => {
  assert.equal(formatDuration(21_000), "21s");
  assert.equal(formatDuration(72_000), "1m12s");
  assert.equal(formatDuration(3_900_000), "1h05m");
  assert.equal(formatDuration(-5), "0s");
});

test("通知：单条点名 agent / 多条说合并；正文行带状态与摘要；展示串可还原", () => {
  const single = noticeRunsOf([
    { run_id: "r1", agent: "research", description: "梳理变更", status: "completed", stopped_by: null, summary: "结论一行" },
  ]);
  assert.equal(noticeHeadline(single, "zh"), "后台任务完成 · research");
  assert.equal(noticeLineText(single[0]!, "zh"), "research · 梳理变更 — 已完成 — 结论一行");

  const merged = noticeRunsOf([
    { run_id: "r1", agent: "research", description: "梳理变更", status: "partial", stopped_by: "tokens", summary: "部分" },
    { run_id: "r2", agent: "scribe", description: "落成笔记", status: "completed", stopped_by: null, summary: "" },
  ]);
  assert.equal(noticeHeadline(merged, "zh"), "2 个后台任务完成 · 已合并为一条通知");
  assert.equal(noticeLineText(merged[0]!, "zh"), "research · 梳理变更 — 部分结果（token 预算） — 部分");

  // 快照恢复路径：后端展示串 → 结构（解析失败时调用方回落原文，不丢内容）。
  const restored = parseNoticeDisplayText(
    [
      "以下是后台任务的完成通知，不是用户发言。",
      "- research（梳理变更）：partial（tokens） — 结论一行",
      "- scribe（落成笔记）：completed",
      "请简要说明结果与建议的下一步。",
      "",
      "[lumir:auto_notice wake_batch=wb-1]",
    ].join("\n"),
  );
  assert.equal(restored.length, 2);
  assert.equal(restored[0]?.agent, "research");
  assert.equal(restored[0]?.description, "梳理变更");
  assert.equal(restored[0]?.status, "partial");
  assert.equal(restored[0]?.stoppedBy, "tokens");
  assert.equal(restored[0]?.summary, "结论一行");
  assert.equal(restored[1]?.status, "completed");
  assert.deepEqual(parseNoticeDisplayText("没有结构的一段话"), []);
});

test("parseApprovalSource：interactive / subrun 两态，缺 run_id 的 subrun 丢弃", () => {
  assert.deepEqual(parseApprovalSource({ kind: "interactive" }), { kind: "interactive" });
  assert.deepEqual(parseApprovalSource({ kind: "subrun", agent: "research", run_id: "r1", description: "任务" }), {
    kind: "subrun",
    agent: "research",
    run_id: "r1",
    description: "任务",
  });
  assert.equal(parseApprovalSource({ kind: "subrun", agent: "research" }), null);
  assert.equal(parseApprovalSource(undefined), null);
});
