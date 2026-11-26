import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection } from "@codemirror/state";
import {
  applyComposerTransaction,
  composerAttachmentsField,
  composerUndo,
  createComposerState,
} from "../../src/harness-composer.ts";
import type { ComposerAttachment } from "../../src/quote-card.ts";

const attachments: ComposerAttachment[] = [
  { kind: "quote", card: { file: "synthetic.md", heading: "合成", headingPath: "合成", lines: "1-1", text: "引用" } },
  { kind: "msgquote", card: { role: "assistant", at: null, text: "消息摘录" } },
  { kind: "image", card: { name: "pasted-0123456789abcdef.png", sourceMime: "image/png" } },
];
const cards = attachments.map((card, index) => ({ id: index + 1, card, anchor: 0 }));

test("全选与反向选区只改变文本 selection，不产生附件选区模型", () => {
  let state = createComposerState({ text: "ab\ncd", caret: 0, cards, skills: [] });
  for (const selection of [EditorSelection.range(0, 5), EditorSelection.range(5, 0)]) {
    const selected = applyComposerTransaction(state, { selection, userEvent: "select" });
    assert.deepEqual(selected.field(composerAttachmentsField), cards);
    state = applyComposerTransaction(selected, {
      changes: { from: 0, to: 5, insert: "X" },
      selection: { anchor: 1 },
      userEvent: "input.type",
    });
    assert.equal(state.doc.toString(), "X");
    assert.deepEqual(state.field(composerAttachmentsField), cards);
    state = composerUndo(state);
    assert.equal(state.doc.toString(), "ab\ncd");
    assert.deepEqual(state.field(composerAttachmentsField), cards);
  }
});

test("任意文本选区替换的属性：附件字段逐字段守恒", () => {
  const initial = createComposerState({ text: "abcdef", caret: 0, cards, skills: [] });
  for (let from = 0; from <= 6; from += 1) {
    for (let to = from; to <= 6; to += 1) {
      const next = applyComposerTransaction(initial, {
        changes: { from, to, insert: "Q" },
        selection: { anchor: from + 1 },
        userEvent: "input.type",
      });
      assert.equal(next.doc.toString(), "abcdef".slice(0, from) + "Q" + "abcdef".slice(to));
      assert.deepEqual(next.field(composerAttachmentsField), cards);
    }
  }
});
