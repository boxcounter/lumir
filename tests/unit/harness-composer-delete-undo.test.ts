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
  let state = createComposerState({ text: "", caret: 0, cards: [] });
  state = applyComposerTransaction(state, {
    changes: { from: 0, insert: "question" },
    selection: { anchor: 8 },
    userEvent: "input.type",
  });
  state = applyComposerTransaction(state, appendComposerAttachments([a, b]));
  const populated = state;
  state = applyComposerTransaction(state, removeComposerAttachment(0));
  assert.deepEqual(state.field(composerAttachmentsField), [b]);
  state = composerUndo(state);
  assert.deepEqual(state.field(composerAttachmentsField), [a, b]);
  state = composerUndo(state);
  assert.deepEqual(state.field(composerAttachmentsField), []);
  assert.equal(state.doc.toString(), "question");
  state = composerRedo(state);
  assert.deepEqual(composerContentOf(state), composerContentOf(populated));
  state = composerRedo(state);
  assert.deepEqual(state.field(composerAttachmentsField), [b]);
});

test("文本事务不会意外生成附件 history 步", () => {
  let state = createComposerState({ text: "我s", caret: 2, cards: [a, b] });
  state = applyComposerTransaction(state, {
    changes: { from: 1, to: 2 },
    selection: { anchor: 1 },
    userEvent: "delete.backward",
  });
  assert.deepEqual(state.field(composerAttachmentsField), [a, b]);
  state = composerUndo(state);
  assert.equal(state.doc.toString(), "我s");
  assert.deepEqual(state.field(composerAttachmentsField), [a, b]);
});

test("恢复或发送后的新 state 不允许撤销回旧内容", () => {
  let state = createComposerState({ text: "draft", caret: 2, cards: [a] });
  state = applyComposerTransaction(state, appendComposerAttachments([b]));
  const restored = createComposerState({ text: "draft", caret: 2, cards: [a, b] });
  assert.equal(composerUndo(restored), restored);
  const sent = createComposerState({ text: "", caret: 0, cards: [] });
  assert.equal(composerUndo(sent), sent);
});
