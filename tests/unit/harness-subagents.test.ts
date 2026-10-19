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
  noticeHeadline,
  noticeLineText,
  noticeRunsOf,
  parseApprovalSource,
  parseNoticeDisplayText,
  reduceSubruns,
  subrunStatusOf,
  subrunStatusWord,
  subrunStoppedByWord,
  subrunUsageRows,
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

test("taskHeadline：运行中 / 后台 / 待批三种计数；收敛后为本次会话摘要；无任务为空串", () => {
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
  // 后台 run（同一条 started 事件的 background=true）
  runs = reduceSubruns(runs, {
    type: "subagent_started",
    run_id: "r3",
    agent: "scribe",
    description: "落成笔记",
    model: "mock-fast",
    background: true,
  });
  assert.equal(taskHeadline(runs, "zh"), "任务 2 个运行中 · 1 个后台运行中");
  assert.equal(taskHeadline(runs, "en"), "Tasks 2 running · 1 running in background");

  runs = attachRunApproval(runs, "r1", "apr-1");
  assert.equal(taskHeadline(runs, "zh"), "任务 1 个运行中 · 1 个后台运行中 · 1 个等待批准");

  const finished = runs.map((run) => ({ ...run, status: "done" as const, approvalIds: [] }));
  assert.equal(taskHeadline(finished, "zh"), "任务 · 本次会话 3 个已完成");
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
