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
const placed = (id: number, card: ComposerAttachment, anchor = 0) => ({ id, card, anchor });

function stateWith(text = "问题", caret: number | null = text.length, cards: Array<ReturnType<typeof placed>> = []) {
  return createComposerState({ text, caret, cards, skills: [] });
}

test("附件 insert/remove 与文本共享同一个 undo/redo", () => {
  let state = stateWith("", 0);
  state = applyComposerTransaction(state, { changes: { from: 0, insert: "abc" }, selection: { anchor: 3 }, userEvent: "input.type" });
  state = applyComposerTransaction(state, appendComposerAttachments(state, [quote, image]));
  const populated = state.field(composerAttachmentsField);
  assert.deepEqual(populated.map((card) => [card.card.kind, card.anchor]), [["quote", 4], ["image", 4]]);
  assert.equal(state.doc.toString(), "abc\n");

  state = composerUndo(state);
  assert.deepEqual(state.field(composerAttachmentsField), []);
  assert.equal(state.doc.toString(), "abc");
  state = composerRedo(state);
  assert.deepEqual(state.field(composerAttachmentsField), populated);
  state = applyComposerTransaction(state, removeComposerAttachment(populated[0].id));
  assert.deepEqual(state.field(composerAttachmentsField), [populated[1]]);
  state = composerUndo(state);
  assert.deepEqual(state.field(composerAttachmentsField), populated);
});

test("文本删除、全选替换和 compose 事务保留卡片身份并按精确偏移映射 anchor", () => {
  const initial = stateWith("我s", 2, [placed(1, quote, 1), placed(2, image, 1)]);
  for (const spec of [
    { changes: { from: 1, to: 2 }, selection: { anchor: 1 }, userEvent: "delete.backward" },
    { changes: { from: 0, to: 2, insert: "x" }, selection: { anchor: 1 }, userEvent: "input.type" },
    { changes: { from: 1, to: 2, insert: "汉语" }, selection: { anchor: 3 }, userEvent: "input.compose" },
  ]) {
    const next = applyComposerTransaction(initial, spec);
    assert.deepEqual(next.field(composerAttachmentsField).map((card) => card.card), [quote, image]);
    assert.ok(next.field(composerAttachmentsField).every((card) => card.anchor >= 0 && card.anchor <= next.doc.length));
  }
});

test("行中插卡拆行并把 caret 落到卡下方，同锚点后续卡堆叠在底部", () => {
  let state = stateWith("前半后半", 2, [placed(1, message, 0)]);
  state = applyComposerTransaction(state, appendComposerAttachments(state, [quote]));
  state = applyComposerTransaction(state, appendComposerAttachments(state, [image]));
  assert.equal(state.doc.toString(), "前半\n后半");
  assert.equal(state.selection.main.head, 3);
  assert.deepEqual(state.field(composerAttachmentsField).map((card) => [card.card.kind, card.anchor]), [
    ["msgquote", 0],
    ["quote", 3],
    ["image", 3],
  ]);
});

test("新投递 golden：按精确锚点交错，panelText 与 parts 同源", () => {
  const state = stateWith("第一行\n第二行", 7, [placed(1, quote, 0), placed(2, message, 0), placed(3, image, 4)]);
  const projected = projectComposerDelivery(state);
  const quoteXml = '<quote file="notes/a.md" heading="结论" lines="3-4">先读结论</quote>';
  const messageXml = '<msg-quote role="assistant">上次回答</msg-quote>';
  assert.deepEqual(projected.parts, [
    { kind: "text", text: `${quoteXml}\n${messageXml}\n第一行` },
    { kind: "image", name: image.card.name, label: "Image 1" },
    { kind: "text", text: "第二行" },
  ]);
  assert.equal(
    projected.panelText,
    `${quoteXml}\n${messageXml}\n第一行\n<image ref="pasted-0123456789abcdef.webp" type="image/png" width="640" height="360"/>\n第二行`,
  );
});

test("createComposerState 恢复 caret 与 placed cards，并清空 history", () => {
  let state = stateWith("abc", 1, [placed(1, quote, 1)]);
  state = applyComposerTransaction(state, appendComposerAttachments(state, [image]));
  const restored = createComposerState(composerContentOf(state));
  assert.equal(restored.selection.main.head, 2);
  assert.deepEqual(restored.field(composerAttachmentsField), state.field(composerAttachmentsField));
  assert.equal(composerUndo(restored), restored);
  const clamped = createComposerState({ text: "x", caret: 99, cards: [], skills: [] });
  assert.equal(clamped.selection.main.head, 1);
});
