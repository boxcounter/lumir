import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendComposerAttachments,
  applyComposerTransaction,
  composerContentOf,
  composerRedo,
  composerUndo,
  composerAttachmentsField,
  createComposerState,
  projectComposerDelivery,
  removeComposerAttachment,
} from "../../src/harness-composer.ts";
import type { ComposerAttachment, QuoteCard } from "../../src/quote-card.ts";

const quoteCard: QuoteCard = {
  file: "notes/a.md",
  heading: "结论",
  headingPath: "阅读 › 结论",
  lines: "3-4",
  text: "先读结论",
};
const quote: ComposerAttachment = { kind: "quote", card: quoteCard };
const image: ComposerAttachment = {
  kind: "image",
  card: { name: "pasted-0123456789abcdef.webp", sourceMime: "image/png", width: 640, height: 360 },
};
const message: ComposerAttachment = { kind: "msgquote", card: { role: "assistant", at: null, text: "上次回答" } };

function stateWith(text = "问题", caret: number | null = text.length, cards: readonly ComposerAttachment[] = []) {
  return createComposerState({ text, caret, cards });
}

test("附件 append/remove 与文本共享同一个 undo/redo", () => {
  let state = stateWith("", 0);
  state = applyComposerTransaction(state, { changes: { from: 0, insert: "abc" }, selection: { anchor: 3 }, userEvent: "input.type" });
  state = applyComposerTransaction(state, appendComposerAttachments([quote, image]));
  assert.deepEqual(state.field(composerAttachmentsField), [quote, image]);
  assert.equal(state.doc.toString(), "abc");

  state = composerUndo(state);
  assert.deepEqual(state.field(composerAttachmentsField), [], "一次 undo 撤掉整批附件");
  assert.equal(state.doc.toString(), "abc", "附件 undo 不吞前一笔文本");

  state = composerRedo(state);
  assert.deepEqual(state.field(composerAttachmentsField), [quote, image]);
  state = applyComposerTransaction(state, removeComposerAttachment(0));
  assert.deepEqual(state.field(composerAttachmentsField), [image]);
  state = composerUndo(state);
  assert.deepEqual(state.field(composerAttachmentsField), [quote, image], "被删卡逐字段恢复且位置不变");
  state = composerRedo(state);
  assert.deepEqual(state.field(composerAttachmentsField), [image]);
});

test("文本删除、全选替换和 compose 事务均不改变附件 field", () => {
  const initial = stateWith("我s", 2, [quote, image]);
  for (const spec of [
    { changes: { from: 1, to: 2 }, selection: { anchor: 1 }, userEvent: "delete.backward" },
    { changes: { from: 0, to: 2, insert: "x" }, selection: { anchor: 1 }, userEvent: "input.type" },
    { changes: { from: 1, to: 2, insert: "汉语" }, selection: { anchor: 3 }, userEvent: "input.compose" },
  ]) {
    const next = applyComposerTransaction(initial, spec);
    assert.deepEqual(next.field(composerAttachmentsField), [quote, image]);
  }
});

test("添加附件不拆文本、不动 caret；多次添加保持顺序", () => {
  let state = stateWith("前半后半", 2, [message]);
  const before = state.selection.main.head;
  state = applyComposerTransaction(state, appendComposerAttachments([quote]));
  state = applyComposerTransaction(state, appendComposerAttachments([image]));
  assert.equal(state.doc.toString(), "前半后半");
  assert.equal(state.selection.main.head, before);
  assert.deepEqual(state.field(composerAttachmentsField), [message, quote, image]);
});

test("新投递 golden：附件全部前置，完整问题最后，panelText 与 parts 同源", () => {
  const state = stateWith("第一行\n第二行", 7, [quote, message, image]);
  const projected = projectComposerDelivery(state);
  const quoteXml = '<quote file="notes/a.md" heading="结论" lines="3-4">先读结论</quote>';
  const messageXml = '<msg-quote role="assistant">上次回答</msg-quote>';
  assert.deepEqual(projected.parts, [
    { kind: "text", text: `${quoteXml}\n${messageXml}` },
    { kind: "image", name: image.card.name, label: "Image 1" },
    { kind: "text", text: "第一行\n第二行" },
  ]);
  assert.equal(
    projected.panelText,
    `${quoteXml}\n${messageXml}\n<image ref="pasted-0123456789abcdef.webp" type="image/png" width="640" height="360"/>\n第一行\n第二行`,
  );
});

test("createComposerState 恢复 caret 合法并清空 history", () => {
  let state = stateWith("abc", 1, [quote]);
  state = applyComposerTransaction(state, appendComposerAttachments([image]));
  const restored = createComposerState(composerContentOf(state));
  assert.equal(restored.selection.main.head, 1);
  assert.deepEqual(restored.field(composerAttachmentsField), [quote, image]);
  assert.equal(composerUndo(restored), restored, "恢复出的 state 没有旧 undo 史");
  const clamped = createComposerState({ text: "x", caret: 99, cards: [] });
  assert.equal(clamped.selection.main.head, 1);
});
