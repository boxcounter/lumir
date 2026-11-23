// 待批信号的**纯判据**（change fix-harness-approval-visibility-nov23 tasks 1.1 / design §3.2）。
//
// 这一层只判两个零 DOM 的选择器：阶段行文案键与标题栏状态文案键。判据只有一处真源——
// 相位 + 待决集合（布尔）；本文件用表驱动把每个状态组合逐条写死，任何「按事件种类 / 按文案 /
// 按计时」推导的实现都会在表里露出。
//
// 反向纪律（REVIEW.md「断言等价于子串」条）：每条期望都点明「不得返回什么」——尤其
// `idle + pending` 必须落到普通档而不是待批档（陈旧数据不伪造在途），`stopping + pending`
// 必须落到 D400（停止优先于待批）。

import assert from "node:assert/strict";
import { test } from "node:test";
import { stageCopyKey } from "../../src/harness-panel.ts";
import { activityStatusKey } from "../../src/harness-activity.ts";
import type { ActivityUnread } from "../../src/harness-activity.ts";
import type { SendPhase } from "../../src/harness-panel.ts";

// ── 1. 阶段行：停止中 > 等待批准 > 等待响应 / 生成中 ─────────────────────────

interface StageCase {
  phase: SendPhase;
  pending: boolean;
  stageWaiting: boolean;
  expected: "D400" | "D976" | "D381" | "D382";
}

const STAGE_CASES: StageCase[] = [
  // running + 待批：两档 stageWaiting 都是待批（首个分片之前到达的批准请求同样阻塞在用户）。
  { phase: "running", pending: true, stageWaiting: true, expected: "D976" },
  { phase: "running", pending: true, stageWaiting: false, expected: "D976" },
  // 无待批的对照组：两档文案照旧，MUST NOT 出现待批档。
  { phase: "running", pending: false, stageWaiting: true, expected: "D381" },
  { phase: "running", pending: false, stageWaiting: false, expected: "D382" },
  // 停止优先：待决项尚未收回时仍读「正在停止…」，不得读「等待批准…」。
  { phase: "stopping", pending: true, stageWaiting: false, expected: "D400" },
  { phase: "stopping", pending: true, stageWaiting: true, expected: "D400" },
  { phase: "stopping", pending: false, stageWaiting: false, expected: "D400" },
  // idle + 待批 = 陈旧数据：没有在途轮次可依附，不得产出待批键。
  { phase: "idle", pending: true, stageWaiting: true, expected: "D381" },
  { phase: "idle", pending: true, stageWaiting: false, expected: "D382" },
];

test("stageCopyKey：待批档只在 running 成立，停止中优先，idle 不伪造", () => {
  for (const item of STAGE_CASES) {
    assert.equal(
      stageCopyKey(item.phase, item.pending, item.stageWaiting),
      item.expected,
      `stageCopyKey(${item.phase}, pending=${item.pending}, waiting=${item.stageWaiting})`,
    );
  }
});

test("stageCopyKey：待批档与「等待响应 / 生成中」是不同键（文案不共用）", () => {
  assert.notEqual(
    stageCopyKey("running", true, false),
    stageCopyKey("running", false, false),
    "有 / 无待批必须是两档不同的键——同键意味着状态词根本不会变",
  );
  assert.notEqual(stageCopyKey("running", true, true), "D400", "待批不得压过停止");
});

// ── 2. 标题栏状态词：同一份判据，待批优先于「处理中」────────────────────────

interface StatusCase {
  phase: SendPhase;
  unread: ActivityUnread;
  pending: boolean;
  expected: "D416" | "D870" | "D871" | "D872" | null;
}

const STATUS_CASES: StatusCase[] = [
  // running + 待批：toggle 与段状态词读「等待批准」（D416，复用工具行尾注的同一串）。
  { phase: "running", unread: null, pending: true, expected: "D416" },
  // 残留未读不压过在途待批：用户此刻要看的是「在等自己批准」。
  { phase: "running", unread: "reply", pending: true, expected: "D416" },
  { phase: "running", unread: null, pending: false, expected: "D870" },
  { phase: "running", unread: "failure", pending: false, expected: "D870" },
  // 停止中：用户已请求停止，读「处理中」而不是「等待批准」。
  { phase: "stopping", unread: null, pending: true, expected: "D870" },
  { phase: "stopping", unread: null, pending: false, expected: "D870" },
  // idle + 待批 = 陈旧：不产生待批状态；未读两档照旧。
  { phase: "idle", unread: null, pending: true, expected: null },
  { phase: "idle", unread: "reply", pending: true, expected: "D871" },
  { phase: "idle", unread: "failure", pending: true, expected: "D872" },
  { phase: "idle", unread: null, pending: false, expected: null },
];

test("activityStatusKey：待批优先于处理中，stopping / idle 不产生待批状态", () => {
  for (const item of STATUS_CASES) {
    assert.equal(
      activityStatusKey({ phase: item.phase, unread: item.unread }, item.pending),
      item.expected,
      `activityStatusKey(${item.phase}, ${String(item.unread)}, pending=${item.pending})`,
    );
  }
});

test("activityStatusKey：未传待批参数时与既有三态逐值一致（切换器行不受影响）", () => {
  assert.equal(activityStatusKey({ phase: "running", unread: null }), "D870");
  assert.equal(activityStatusKey({ phase: "idle", unread: "reply" }), "D871");
  assert.equal(activityStatusKey({ phase: "idle", unread: "failure" }), "D872");
  assert.equal(activityStatusKey({ phase: "idle", unread: null }), null);
});
