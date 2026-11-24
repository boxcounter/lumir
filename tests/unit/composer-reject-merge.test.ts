// 发送拒绝回包的输入区合并（P1-2，reviewer agent-276）：纯函数合同——零 DOM、零 store。
//
// 现场：`harnessSend` 的拒绝回包晚于用户的下一条输入（用户已经在新空出来的 composer 里
// 打字 / 贴卡）。回滚若整份 `resetComposer(restored)` 就会把这段新输入静默删掉。合并口径是
// **typeahead**：原文在前、当前输入在后；caret 按原文长度偏移；卡片原在前、当前在后。
// 输入区仍是发送后的空态时原样返回 restored（逐字段还原，含 caret）。
//
// 判据都在 `mergeRejectedComposerContent` 的返回值上，不经过 CodeMirror：接线层只负责把
// 返回值交给 `resetComposer` + `markDraft`（后者由浏览器场景的草稿载荷断言覆盖）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeRejectedComposerContent } from "../../src/harness-composer.ts";
import type { ComposerContent } from "../../src/harness-composer.ts";
import type { ComposerAttachment } from "../../src/quote-card.ts";

const quoteCard = (text: string): { id: number; card: ComposerAttachment; anchor: number } => ({
  id: 1,
  card: { kind: "quote", card: { file: "note.md", heading: "", headingPath: "", lines: "1-1", text } },
  anchor: 0,
});

const imageCard = (name: string): { id: number; card: ComposerAttachment; anchor: number } => ({
  id: 2,
  card: { kind: "image", card: { name, sourceMime: "image/png" } },
  anchor: 0,
});

const restoredContent = (over: Partial<ComposerContent> = {}): ComposerContent => ({
  text: "原文问题",
  caret: 2,
  cards: [quoteCard("原文摘录")],
  skills: [],
  ...over,
});

test("空 composer（无新文本、无新卡片）：原样返回 restored，caret 逐字段不变", () => {
  const restored = restoredContent();
  const merged = mergeRejectedComposerContent(restored, { text: "", caret: 0, cards: [], skills: [] });
  assert.equal(merged, restored); // 同一对象：常见路径不做无意义的拷贝
  assert.deepEqual(merged, { text: "原文问题", caret: 2, cards: [quoteCard("原文摘录")], skills: [] });
});

test("等待期间打了新文本：原文在前、新输入在后，caret 按原文长度偏移", () => {
  const merged = mergeRejectedComposerContent(restoredContent(), {
    text: "新输入",
    caret: 1,
    cards: [],
    skills: [],
  });
  assert.equal(merged.text, "原文问题新输入");
  assert.equal(merged.caret, "原文问题".length + 1);
  assert.deepEqual(merged.cards, [quoteCard("原文摘录")]);
});

test("当前 caret 在末尾（null）⇒ 合并后的 caret 仍是末尾（null）", () => {
  const merged = mergeRejectedComposerContent(restoredContent({ text: "ab" }), {
    text: "cd",
    caret: null,
    cards: [],
    skills: [],
  });
  assert.equal(merged.text, "abcd");
  assert.equal(merged.caret, null);
});

test("卡片两边都保留：原在前、当前在后，顺序确定", () => {
  const merged = mergeRejectedComposerContent(
    restoredContent({ text: "", caret: 0, cards: [quoteCard("原")] }),
    { text: "", caret: 0, cards: [imageCard("pasted-0f9a8b7c6d5e4f.webp")], skills: [] },
  );
  assert.deepEqual(
    merged.cards.map((attachment) => attachment.card.kind),
    ["quote", "image"],
  );
});

test("同名的图片卡也不去重（不静默删除任何内容）", () => {
  const attachment = imageCard("pasted-0f9a8b7c6d5e4f.webp");
  const merged = mergeRejectedComposerContent(
    restoredContent({ text: "", caret: 0, cards: [attachment], skills: [] }),
    { text: "", caret: 0, cards: [attachment], skills: [] },
  );
  assert.equal(merged.cards.length, 2);
});

test("文本与卡片同时有新输入：两段文本与两类卡片都在，不丢任何一边", () => {
  const merged = mergeRejectedComposerContent(restoredContent(), {
    text: "继续",
    caret: 2,
    cards: [imageCard("pasted-0f9a8b7c6d5e4f.webp")],
    skills: [],
  });
  assert.equal(merged.text, "原文问题继续");
  assert.equal(merged.caret, "原文问题".length + 2);
  assert.deepEqual(
    merged.cards.map((attachment) => attachment.card.kind),
    ["quote", "image"],
  );
  // 双方内容都在（正向判据）：原文与新输入都是子串。
  assert.ok(merged.text.includes("原文问题"));
  assert.ok(merged.text.includes("继续"));
});

test("caret 边界：0 与当前文本末尾都是确定值", () => {
  assert.equal(
    mergeRejectedComposerContent(restoredContent({ text: "abcd", caret: 4 }), {
      text: "XY",
      caret: 0,
      cards: [],
      skills: [],
    }).caret,
    4,
  );
  assert.equal(
    mergeRejectedComposerContent(restoredContent({ text: "abcd", caret: 0 }), {
      text: "XY",
      caret: 2,
      cards: [],
      skills: [],
    }).caret,
    6,
  );
});
