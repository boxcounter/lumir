// 子运行 `subagent_started` 的段号幂等（finding 20261119-worker-harness-async 的收口）：
//   - 判据是 `(run_id, segment)`：只有段号**更大**的 started 构成 resume 新段；
//   - 同段重复 / 旧段重放 MUST NOT 复活已收尾的 run、MUST NOT 加段、MUST NOT 清读数与待批关联；
//   - 合法新段按既有 resume 口径续上（同一身份、读数进段基线、清上一段待批）。
// 合同：living spec `harness-subagents` 的「子运行启动事件的段号幂等」条。
// 这一层是零 DOM 环境（tests/unit/README.md）：只驱动 src/harness-panel.ts 导出的纯函数；
// 行渲染与「重复事件不收 task 行」归真机 / 视觉场景。

import { test } from "node:test";
import assert from "node:assert/strict";
import { attachRunApproval, reduceSubruns } from "../../src/harness-panel.ts";
import type { SubrunEvent } from "../../src/harness-panel.ts";

function start(segment: number, runId = "r1"): SubrunEvent {
  return {
    type: "subagent_started",
    run_id: runId,
    segment,
    agent: "research",
    description: "梳理变更",
    model: "mock-fast",
    background: false,
  };
}

function progress(rounds: number, toolCalls: number, runId = "r1"): SubrunEvent {
  return {
    type: "subagent_progress",
    run_id: runId,
    rounds,
    tool_calls: toolCalls,
    last_tool: "vault_read",
    elapsed_ms: 12_000,
  };
}

function finish(
  overrides: Partial<Extract<SubrunEvent, { type: "subagent_finished" }>> = {},
): SubrunEvent {
  return {
    type: "subagent_finished",
    run_id: "r1",
    agent: "research",
    status: "completed",
    rounds: 2,
    model: "mock-fast",
    input_tokens: 100,
    cached_tokens: 10,
    output_tokens: 20,
    denied_calls: 0,
    duration_ms: 900,
    summary_chars: 2,
    summary: "完成",
    ...overrides,
  };
}

test("同段重复的 started：运行中的 run 不加段、不清待批关联、读数不变", () => {
  let runs = reduceSubruns([], start(1));
  runs = reduceSubruns(runs, progress(3, 5));
  runs = attachRunApproval(runs, "r1", "ap-1");
  const before = runs[0]!;

  const after = reduceSubruns(runs, start(1));

  assert.equal(after.length, 1);
  assert.deepEqual(after[0], before);
  assert.equal(after[0]?.segments, 1);
  assert.equal(after[0]?.status, "waiting");
  assert.deepEqual(after[0]?.approvalIds, ["ap-1"]);
  assert.equal(after[0]?.rounds, 3);
});

test("finished 后重复同段 started：仍为终态、不加段、读数与摘要原样保留", () => {
  let runs = reduceSubruns([], start(1));
  runs = reduceSubruns(runs, progress(2, 3));
  runs = reduceSubruns(runs, finish());
  const before = runs[0]!;
  assert.equal(before.status, "done");

  const after = reduceSubruns(runs, start(1));

  assert.equal(after.length, 1);
  assert.deepEqual(after[0], before, "已收尾的 run 不得被重复 started 复活");
  assert.equal(after[0]?.status, "done");
  assert.equal(after[0]?.segments, 1);
  assert.equal(after[0]?.rounds, 2);
  assert.equal(after[0]?.inputTokens, 100);
  assert.equal(after[0]?.summary, "完成");
});

test("旧段重放：段 2 在跑时重放段 1 的 started 不改变任何读数", () => {
  let runs = reduceSubruns([], start(1));
  runs = reduceSubruns(runs, progress(5, 12));
  runs = reduceSubruns(runs, finish({ rounds: 5 }));
  runs = reduceSubruns(runs, start(2));
  assert.equal(runs[0]?.segments, 2);
  assert.equal(runs[0]?.status, "running");
  const before = runs[0]!;

  const after = reduceSubruns(runs, start(1));

  assert.equal(after.length, 1);
  assert.deepEqual(after[0], before);
  assert.equal(after[0]?.segments, 2);
  assert.equal(after[0]?.status, "running");
  assert.equal(after[0]?.rounds, 5);
});

test("合法新段：段号更大的 started 才构成 resume（同身份、累加段数、读数进段基线、清待批）", () => {
  let runs = reduceSubruns([], start(1));
  runs = reduceSubruns(runs, progress(5, 12));
  runs = attachRunApproval(runs, "r1", "ap-seg1");

  runs = reduceSubruns(runs, start(2));

  assert.equal(runs.length, 1, "同一 run 的 resume 段不得另立一行");
  assert.equal(runs[0]?.segments, 2);
  assert.equal(runs[0]?.status, "running");
  assert.deepEqual(runs[0]?.approvalIds, [], "上一段的待批关联不得延续到新段");
  assert.equal(runs[0]?.rounds, 5, "新段尚未发进度前保留上一段读数");
  assert.equal(runs[0]?.toolCalls, 12);
  assert.deepEqual(runs[0]?.segmentBase, {
    rounds: 5,
    toolCalls: 12,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
  });
});

test("合法新段：resume 后用量按段基线累加，finished 落终态仍只有一行", () => {
  let runs = reduceSubruns([], start(1));
  runs = reduceSubruns(runs, progress(5, 12));
  runs = reduceSubruns(
    runs,
    finish({ status: "partial", stopped_by: "tokens", rounds: 5, input_tokens: 80_000, cached_tokens: 60_000, output_tokens: 2_000 }),
  );
  runs = reduceSubruns(runs, start(2));
  assert.equal(runs[0]?.status, "running");
  assert.equal(runs[0]?.stoppedBy, null, "上一段的触顶原因不得延续到新段");
  assert.equal(runs[0]?.inputTokens, 80_000, "上一段用量原样保留到新段基线");

  runs = reduceSubruns(runs, progress(1, 2));
  assert.equal(runs[0]?.rounds, 6);
  assert.equal(runs[0]?.toolCalls, 14);

  runs = reduceSubruns(
    runs,
    finish({ rounds: 1, input_tokens: 20_000, cached_tokens: 10_000, output_tokens: 1_000 }),
  );
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.segments, 2);
  assert.equal(runs[0]?.status, "done");
  assert.equal(runs[0]?.inputTokens, 100_000);
  assert.equal(runs[0]?.cachedTokens, 70_000);
  assert.equal(runs[0]?.outputTokens, 3_000);
});

test("首见即段 N：首条 started 以事件段号建档，其后同段重复不再加段", () => {
  // 重连 / 重放形态：段 1 的事件在前端缺失，先到的是段 3 的 started。
  let runs = reduceSubruns([], start(3));
  assert.equal(runs[0]?.segments, 3, "段号以事件为准，不得把第 3 段谎报成 1 段");

  const before = runs[0]!;
  runs = reduceSubruns(runs, start(3));
  assert.deepEqual(runs[0], before);
  assert.equal(runs[0]?.segments, 3);
});
