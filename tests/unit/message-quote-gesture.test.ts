// tests/unit/message-quote-gesture.test.ts — 消息摘录跳回的定位判定（change harness-message-excerpt
// tasks 3.4）与「全文搜索摘录原文」的命中判定（design §6）。零 DOM：纯逻辑层直接驱动。
//
// 断言纪律（REVIEW.md 第 1 条反向验证）：每个判据都配一条「必须让它红」的反例——同秒双消息、
// 无 at 旧消息、角色不符、空摘录等边界各有一条，不是只堆正向命中。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  messageExcerptMatches,
  resolveMessageQuoteTarget,
  type MessageAnchor,
} from "../../src/message-quote-gesture.ts";
import { formatMessageAt } from "../../src/quote-card.ts";

const T0 = new Date(2026, 9, 10, 21, 40, 33).getTime(); // 2026-10-10T21:40:33 本地
const T1 = T0 + 60_000; // 晚一分钟（格式化后是另一个 ISO 串）

function msg(role: string, at: number | null, text: string): MessageAnchor {
  return { role, at, text };
}

// --- messageExcerptMatches ------------------------------------------------------------------

test("messageExcerptMatches：整串包含即命中；流式前缀（消息比摘录短）也算命中；空摘录恒不命中", () => {
  assert.equal(messageExcerptMatches("先读结论再读论证——倒序阅读", "先读结论再读论证"), true);
  // 流式截断：消息文本尚未长到摘录全长，是摘录的前缀。
  assert.equal(messageExcerptMatches("先读结", "先读结论再读论证"), true);
  assert.equal(messageExcerptMatches("任何文本", ""), false);
  assert.equal(messageExcerptMatches("无关的正文", "先读结论"), false);
});

// --- resolveMessageQuoteTarget：三层里的前两层 -------------------------------------------------

test("第一层 role + at：唯一命中（按格式化后的同一秒串比较）返回该消息下标", () => {
  const messages = [
    msg("user", T0 - 10_000, "问题一"),
    msg("assistant", T0, "先读结论再读论证"),
    msg("user", T0 + 5_000, "追问"),
  ];
  assert.equal(resolveMessageQuoteTarget(messages, { role: "assistant", at: T0, text: "先读结论再读论证" }), 1);
});

test("第一层：同秒双消息（同 role 同秒，命中 ≥2）判歧义 → 落第二层按摘录原文消歧", () => {
  const messages = [
    msg("assistant", T0, "第一条回复：先读结论再读论证"),
    msg("assistant", T0, "第二条回复：把可执行动作捞出来"),
  ];
  // 层一命中两条 ⇒ 不作层一命中；层二按文本找到第二条。
  assert.equal(resolveMessageQuoteTarget(messages, { role: "assistant", at: T0, text: "把可执行动作捞出来" }), 1);
  assert.equal(resolveMessageQuoteTarget(messages, { role: "assistant", at: T0, text: "先读结论" }), 0);
});

test("第一层：无 at 的旧消息（card.at null）直接跳过层一，走第二层全文搜索", () => {
  const messages = [msg("assistant", null, "先读结论再读论证"), msg("user", T0, "追问")];
  assert.equal(resolveMessageQuoteTarget(messages, { role: "assistant", at: null, text: "先读结论" }), 0);
  // 反向：摘录原文哪条都不含 → 失锚（null），不许瞎指。
  assert.equal(resolveMessageQuoteTarget(messages, { role: "assistant", at: null, text: "不存在的原文" }), null);
});

test("第一层：流式消息按 role + at 命中，不依赖消息文本是否已含摘录", () => {
  // 消息文本此刻只是流式开头（甚至为空），但锚是消息元素本身——role+at 唯一即命中。
  const messages = [msg("assistant", T0, ""), msg("user", T1, "别的")];
  assert.equal(resolveMessageQuoteTarget(messages, { role: "assistant", at: T0, text: "稍后才长出来的摘录" }), 0);
});

test("第一层：role 不符不算命中；at 差一秒（格式化后不同串）不算命中", () => {
  const messages = [msg("user", T0, "问题一"), msg("assistant", T1, "先读结论再读论证")];
  // card 是 assistant / T0：层一 role 或 at 都不符 → 层二按文本命中唯一的 assistant 消息（下标 1）。
  assert.equal(resolveMessageQuoteTarget(messages, { role: "assistant", at: T0, text: "先读结论再读论证" }), 1);
});

test("三层都落空 → null（调用方 toast 失锚，MUST NOT 静默跳到别的消息）", () => {
  const messages = [msg("user", T0, "问题一"), msg("assistant", T1, "回复一")];
  assert.equal(resolveMessageQuoteTarget(messages, { role: "assistant", at: T0, text: "找不到的摘录" }), null);
  assert.equal(resolveMessageQuoteTarget([], { role: "assistant", at: T0, text: "x" }), null);
});

test("at 比较走格式化（同一秒的毫秒差异不影响命中）", () => {
  // 上屏戳在同一秒内、毫秒不同：格式化为同一 ISO 串 ⇒ 仍算命中。
  const messages = [msg("assistant", T0 + 400, "先读结论再读论证")];
  assert.equal(resolveMessageQuoteTarget(messages, { role: "assistant", at: T0, text: "先读结论" }), 0);
  assert.equal(formatMessageAt(T0), formatMessageAt(T0 + 400));
});
