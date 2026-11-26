import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendComposerAttachments,
  applyComposerTransaction,
  composerAttachmentsField,
  composerContentOf,
  composerRedo,
  composerUndo,
  createComposerState,
  removeComposerAttachment,
} from "../../src/harness-composer.ts";
import type { ComposerAttachment } from "../../src/quote-card.ts";

const a: ComposerAttachment = {
  kind: "quote",
  card: { file: "a.md", heading: "A", headingPath: "A", lines: "1-1", text: "甲" },
};
const b: ComposerAttachment = {
  kind: "image",
  card: { name: "pasted-0123456789abcdef.webp", sourceMime: "image/png" },
};

test("批量附件与文本编辑交错时 undo/redo 逐拍恢复同一状态", () => {
  let state = createComposerState({ text: "", caret: 0, cards: [], skills: [] });
  state = applyComposerTransaction(state, {
    changes: { from: 0, insert: "question" },
    selection: { anchor: 8 },
    userEvent: "input.type",
  });
  state = applyComposerTransaction(state, appendComposerAttachments(state, [a, b]));
  const populated = state;
  const [placedA, placedB] = state.field(composerAttachmentsField);
  state = applyComposerTransaction(state, removeComposerAttachment(placedA.id));
  assert.deepEqual(state.field(composerAttachmentsField), [placedB]);
  state = composerUndo(state);
  assert.deepEqual(state.field(composerAttachmentsField), [placedA, placedB]);
  state = composerUndo(state);
  assert.deepEqual(state.field(composerAttachmentsField), []);
  assert.equal(state.doc.toString(), "question");
  state = composerRedo(state);
  assert.deepEqual(composerContentOf(state), composerContentOf(populated));
  state = composerRedo(state);
  assert.deepEqual(state.field(composerAttachmentsField), [placedB]);
});

test("文本事务不会意外生成附件 history 步，undo 恢复原 anchor", () => {
  const placed = [
    { id: 1, card: a, anchor: 1 },
    { id: 2, card: b, anchor: 1 },
  ];
  let state = createComposerState({ text: "我s", caret: 2, cards: placed, skills: [] });
  state = applyComposerTransaction(state, {
    changes: { from: 1, to: 2 },
    selection: { anchor: 1 },
    userEvent: "delete.backward",
  });
  assert.deepEqual(state.field(composerAttachmentsField), placed);
  state = composerUndo(state);
  assert.equal(state.doc.toString(), "我s");
  assert.deepEqual(state.field(composerAttachmentsField), placed);
});

test("恢复或发送后的新 state 不允许撤销回旧内容", () => {
  let state = createComposerState({ text: "draft", caret: 2, cards: [{ id: 1, card: a, anchor: 1 }], skills: [] });
  state = applyComposerTransaction(state, appendComposerAttachments(state, [b]));
  const restored = createComposerState(composerContentOf(state));
  assert.equal(composerUndo(restored), restored);
  const sent = createComposerState({ text: "", caret: 0, cards: [], skills: [] });
  assert.equal(composerUndo(sent), sent);
});
