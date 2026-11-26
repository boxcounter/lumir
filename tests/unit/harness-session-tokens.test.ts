// 会话令牌账本（change add-harness-message-withdraw-nov26；K3 复审 P1-1）。
//
// 判据：水位按 vault 分账——A（大 token）切到 B（小 token）后，B 的合法事件与快照必须能落地；
// A 的旧事件仍被拒；退役集合全局生效。造一个必须让它 FAIL 的输入：把两个 vault 合成一个水位
// （旧实现），B 的事件会全红——下面的 A/B/A 用例就是这条反向验证。

import assert from "node:assert/strict";
import { test } from "node:test";
import { createSessionTokenLedger } from "../../src/harness-session-tokens.ts";

test("A/B/A：大 token 的 A 切到小 token 的 B，B 的事件与快照都落地，A 的旧事件仍拒", () => {
  const tokens = createSessionTokenLedger();
  // A：快照 12，事件 12 正常。
  assert.equal(tokens.snapshotAdmitted("/vault/a", 12), true);
  assert.equal(tokens.eventAdmitted("/vault/a", 12), true);
  assert.equal(tokens.watermark("/vault/a"), 12);
  // A 的旧会话事件（11）仍被拒。
  assert.equal(tokens.eventAdmitted("/vault/a", 11), false);

  // 切到 B：快照尚未返回，B 的在途事件（token 5）必须先能落地（旧单例水位会全丢）。
  assert.equal(tokens.watermark("/vault/b"), null);
  assert.equal(tokens.eventAdmitted("/vault/b", 5), true);
  assert.equal(tokens.watermark("/vault/b"), 5);
  // B 的快照（5）是地板，落地且不前移。
  assert.equal(tokens.snapshotAdmitted("/vault/b", 5), true);
  // B 自己的旧事件（4）被拒。
  assert.equal(tokens.eventAdmitted("/vault/b", 4), false);

  // 切回 A：A 的水位仍生效，旧事件（11）不会复活。
  assert.equal(tokens.watermark("/vault/a"), 12);
  assert.equal(tokens.eventAdmitted("/vault/a", 12), true);
  assert.equal(tokens.eventAdmitted("/vault/a", 11), false);
});

test("B 的快照在事件之后到达也能纠偏（不会反向把 B 判成旧会话）", () => {
  const tokens = createSessionTokenLedger();
  assert.equal(tokens.snapshotAdmitted("/vault/a", 12), true);
  // 切到 B，先来事件（5），后来快照（5）：两者都落地。
  assert.equal(tokens.eventAdmitted("/vault/b", 5), true);
  assert.equal(tokens.snapshotAdmitted("/vault/b", 5), true);
});

test("空会话快照（token null）只在该 vault 没有水位时落地", () => {
  const tokens = createSessionTokenLedger();
  assert.equal(tokens.snapshotAdmitted("/vault/a", null), true);
  assert.equal(tokens.eventAdmitted("/vault/a", 5), true);
  assert.equal(tokens.snapshotAdmitted("/vault/a", null), false, "不能清掉已接纳的新会话水位");
});

test("退役按 vault 清空水位；新会话的更大 token 可接手", () => {
  const tokens = createSessionTokenLedger();
  assert.equal(tokens.snapshotAdmitted("/vault/a", 12), true);
  tokens.retire("/vault/a");
  assert.equal(tokens.watermark("/vault/a"), null);
  assert.equal(tokens.eventAdmitted("/vault/a", 12), false, "退役 token 的迟到事件丢弃");
  assert.equal(tokens.eventAdmitted("/vault/a", 13), true, "新会话首事件接纳");
});

test("退役集合全局生效：同一 token 换了 vault 也不复用", () => {
  const tokens = createSessionTokenLedger();
  assert.equal(tokens.snapshotAdmitted("/vault/a", 12), true);
  tokens.retire("/vault/a");
  assert.equal(tokens.retired().has(12), true);
  assert.equal(tokens.eventAdmitted("/vault/b", 12), false);
});

test("快照不能把已接纳的更高水位盖回旧值；退役 token 的快照也不接受", () => {
  const tokens = createSessionTokenLedger();
  assert.equal(tokens.eventAdmitted("/vault/a", 12), true);
  assert.equal(tokens.snapshotAdmitted("/vault/a", 11), false);
  assert.equal(tokens.watermark("/vault/a"), 12);
  tokens.retire("/vault/a");
  assert.equal(tokens.snapshotAdmitted("/vault/a", 12), false, "退役会话的快照是旧事实");
  assert.equal(tokens.watermark("/vault/a"), null);
  assert.equal(tokens.snapshotAdmitted("/vault/a", 13), true, "新会话的快照落地");
  assert.equal(tokens.watermark("/vault/a"), 13);
});
