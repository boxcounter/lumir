import assert from "node:assert/strict";
import { test } from "node:test";
import type { EditorView } from "@codemirror/view";
import type { TransactionSpec } from "@codemirror/state";
import {
  composerAttachmentsField,
  createComposerState,
  runComposerCommand,
} from "../../src/harness-composer.ts";
import { currentKillSlot, setKillSlot } from "../../src/quote-card.ts";
import type { ComposerAttachment } from "../../src/quote-card.ts";

const attachment: ComposerAttachment = {
  kind: "quote",
  card: { file: "synth.md", heading: "", headingPath: "", lines: "1-1", text: "引用" },
};

function viewWith(text: string, caret: number) {
  const view = {
    state: createComposerState({ text, caret, cards: [attachment] }),
    dispatch(spec: TransactionSpec) {
      view.state = view.state.update(spec).state;
    },
  };
  return view as EditorView;
}

test("⌘A 只写 0 → doc.length 的 CM selection，附件不变", () => {
  const view = viewWith("ab\ncd", 2);
  runComposerCommand(view, "editor.select-all");
  assert.equal(view.state.selection.main.anchor, 0);
  assert.equal(view.state.selection.main.head, 5);
  assert.deepEqual(view.state.field(composerAttachmentsField), [attachment]);
});

test("⌥D / ⌥⌫ 使用共享词边界并写共享 kill 槽", () => {
  setKillSlot({ text: "", forward: true, anchor: "test-reset" });
  const forward = viewWith("alpha beta", 0);
  runComposerCommand(forward, "editor.delete-word-forward");
  assert.equal(forward.state.doc.toString(), " beta");
  assert.equal(currentKillSlot()?.text, "alpha");
  const backward = viewWith("alpha beta", 10);
  runComposerCommand(backward, "editor.delete-word-backward");
  assert.equal(backward.state.doc.toString(), "alpha ");
  assert.equal(currentKillSlot()?.text, "beta");
  assert.deepEqual(backward.state.field(composerAttachmentsField), [attachment]);
});

test("⌃K 杀逻辑行尾或行界，⌃Y 把同一 kill 槽插回当前选区", () => {
  const view = viewWith("ab\ncd", 2);
  runComposerCommand(view, "editor.kill-line");
  assert.equal(view.state.doc.toString(), "abcd");
  assert.equal(currentKillSlot()?.text, "\n");
  runComposerCommand(view, "editor.yank");
  assert.equal(view.state.doc.toString(), "ab\ncd");
  assert.equal(view.state.selection.main.head, 3);
  assert.deepEqual(view.state.field(composerAttachmentsField), [attachment]);
});

test("⌃T 转置相邻字素簇，不跨逻辑行", () => {
  const view = viewWith("abc", 1);
  runComposerCommand(view, "editor.transpose-chars");
  assert.equal(view.state.doc.toString(), "bac");
  assert.equal(view.state.selection.main.head, 2);
  assert.deepEqual(view.state.field(composerAttachmentsField), [attachment]);
});
