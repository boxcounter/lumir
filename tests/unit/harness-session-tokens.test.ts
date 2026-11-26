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

test("有水位 → 缺 token 兼容事件 → 未退役旧 token 仍拒；合法快照仍可纠偏", () => {
  const tokens = createSessionTokenLedger();
  assert.equal(tokens.snapshotAdmitted("/vault/a", 12), true);
  // 旧后端 / 无信封的事件：放行，但不得清空水位。
  assert.equal(tokens.eventAdmitted("/vault/a", null), true);
  assert.equal(tokens.watermark("/vault/a"), 12, "兼容事件不得清空既有水位");
  // 反例：水位若被兼容事件清掉，这条未退役的旧 token 就会复活。
  assert.equal(tokens.eventAdmitted("/vault/a", 11), false, "未退役的旧 token 仍须拒收");
  // 兼容事件也不耽误快照纠偏：同会话 / 更新的 token 快照照常落地。
  assert.equal(tokens.snapshotAdmitted("/vault/a", 12), true);
  assert.equal(tokens.snapshotAdmitted("/vault/a", 13), true);
  assert.equal(tokens.watermark("/vault/a"), 13);
  assert.equal(tokens.eventAdmitted("/vault/a", 12), false, "快照推进后旧 token 仍拒");
});

test("A/B 交错：A 的兼容事件不动 A 的水位，也不影响 B；无水位 vault 不因子虚水位收紧", () => {
  const tokens = createSessionTokenLedger();
  assert.equal(tokens.eventAdmitted("/vault/a", 12), true);
  assert.equal(tokens.eventAdmitted("/vault/b", 5), true);
  // 交错：A 的兼容事件 → B 的新事件 → A 的旧事件。
  assert.equal(tokens.eventAdmitted("/vault/a", null), true);
  assert.equal(tokens.watermark("/vault/a"), 12);
  assert.equal(tokens.eventAdmitted("/vault/b", 6), true);
  assert.equal(tokens.watermark("/vault/b"), 6);
  assert.equal(tokens.eventAdmitted("/vault/a", 11), false);
  // 从未见过会话的 vault：兼容事件不制造水位，首条带 token 事件照常接纳。
  assert.equal(tokens.eventAdmitted("/vault/c", null), true);
  assert.equal(tokens.watermark("/vault/c"), null);
  assert.equal(tokens.eventAdmitted("/vault/c", 1), true);
  assert.equal(tokens.watermark("/vault/c"), 1);
});

// ── 退役时机：只退役「动作发起时」捕获的旧会话 ──────────────────────────────
//
// 判据来自 persistence-health-nov23 的 V6 / 「迟到的旧 switched 回包」两条 CI 稳定红：
// 恢复 / 撤回的回执落地时，**新会话自己的事件可能已经先到**并把水位推进到新 token。
// 若回执按「当前水位」退役，新 token 会被记入退役集，其快照随后被拒收，告警永久 hidden。
// 反向验证：把这一组里任一条改成 `retire(vault)`（旧实现语义），断言立刻转红。

test("回执前新会话事件先推进水位：只退役发起时捕获的旧 token，新 token 的计数与快照都不受影响", () => {
  const tokens = createSessionTokenLedger();
  assert.equal(tokens.snapshotAdmitted("/vault/a", 41), true);
  // 恢复 / 撤回发起时定格：旧会话身份 = 41。
  const previous = tokens.watermark("/vault/a");
  // 新会话自己的写失败事件先于 Promise 回执到达（V6 现场）。
  assert.equal(tokens.eventAdmitted("/vault/a", 42), true);
  assert.equal(tokens.watermark("/vault/a"), 42);
  // 回执落地：退役只针对发起时捕获的 41。
  tokens.retire("/vault/a", previous);
  assert.equal(tokens.retired().has(42), false, "新会话自己的 token MUST NOT 被退役");
  assert.equal(tokens.watermark("/vault/a"), 42, "水位停在新会话，不被清空");
  assert.equal(tokens.snapshotAdmitted("/vault/a", 42), true, "回执带来的完整快照是地板");
  assert.equal(tokens.eventAdmitted("/vault/a", 41), false, "旧会话的迟到事件仍被拒");
});

test("迟到的旧回包只退役它发起时捕获的 token：新一代已接纳的水位与快照都保留", () => {
  const tokens = createSessionTokenLedger();
  assert.equal(tokens.snapshotAdmitted("/vault/a", 41), true);
  const previous = tokens.watermark("/vault/a"); // 旧回包发起时看到的正是 41
  // 新一代（token 42）先落地：另一个恢复回执 / 它自己的事件把水位推到 42。
  assert.equal(tokens.snapshotAdmitted("/vault/a", 42), true);
  // 旧回包迟到：只退役 41，MUST NOT 清掉 42。
  tokens.retire("/vault/a", previous);
  assert.equal(tokens.watermark("/vault/a"), 42);
  assert.equal(tokens.retired().has(42), false);
  assert.equal(tokens.snapshotAdmitted("/vault/a", 42), true, "新一代的快照仍准落地");
  assert.equal(tokens.eventAdmitted("/vault/a", 41), false);
});

test("发起时尚无水位（捕获 null）：回执不存在的退役不得清掉在途采纳的新 token", () => {
  const tokens = createSessionTokenLedger();
  const previous = tokens.watermark("/vault/a");
  assert.equal(previous, null);
  assert.equal(tokens.eventAdmitted("/vault/a", 7), true);
  tokens.retire("/vault/a", previous);
  assert.equal(tokens.watermark("/vault/a"), 7, "空捕获不是「清空水位」的授权");
  assert.equal(tokens.snapshotAdmitted("/vault/a", 7), true);
  assert.equal(tokens.eventAdmitted("/vault/a", 6), false);
});
