import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { EditorSelection, Transaction } from "@codemirror/state";
import type { SelectionRange, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  composerAttachmentsField,
  createComposerState,
  runComposerCommand,
} from "../../src/harness-composer.ts";
import {
  clusterBackward,
  clusterForward,
  currentKillSlot,
  setKillSlot,
} from "../../src/quote-card.ts";
import type { ComposerAttachment } from "../../src/quote-card.ts";
import type { CommandId } from "../../src/keys.ts";

const attachment: ComposerAttachment = {
  kind: "quote",
  card: { file: "synth.md", heading: "", headingPath: "", lines: "1-1", text: "引用" },
};

function viewWith(text: string, caret: number) {
  const view = {
    state: createComposerState({ text, caret, cards: [attachment] }),
    dispatch(spec: TransactionSpec | Transaction) {
      view.state = spec instanceof Transaction ? spec.state : view.state.update(spec).state;
    },
    moveByChar(range: SelectionRange, forward: boolean): SelectionRange {
      const pos = range.head;
      const line = view.state.doc.lineAt(pos);
      const read = (from: number, to: number) => view.state.doc.sliceString(from, to);
      let head: number;
      if (forward) {
        head = pos === line.to
          ? Math.min(view.state.doc.length, pos + 1)
          : clusterForward(read, pos, line.to);
      } else {
        head = pos === line.from
          ? Math.max(0, pos - 1)
          : clusterBackward(read, pos, line.from);
      }
      return EditorSelection.cursor(head, forward ? -1 : 1);
    },
    lineBlockAt(pos: number) {
      const line = view.state.doc.lineAt(pos);
      return { from: line.from, to: line.to, length: line.length };
    },
    moveVertically(range: SelectionRange, forward: boolean): SelectionRange {
      const line = view.state.doc.lineAt(range.head);
      const targetNumber = line.number + (forward ? 1 : -1);
      if (targetNumber < 1 || targetNumber > view.state.doc.lines) return range;
      const target = view.state.doc.line(targetNumber);
      const column = range.head - line.from;
      return EditorSelection.cursor(target.from + Math.min(column, target.length));
    },
    moveToLineBoundary(range: SelectionRange, forward: boolean): SelectionRange {
      const line = view.state.doc.lineAt(range.head);
      return EditorSelection.cursor(forward ? line.to : line.from);
    },
  };
  return view as EditorView;
}

interface CommandCase {
  id: CommandId;
  text: string;
  caret: number;
  expectedText?: string;
  anchor: number;
  head: number;
  killText?: string;
  prepare?(view: EditorView): void;
}

const commandCases: CommandCase[] = [
  { id: "editor.select-all", text: "ab\ncd", caret: 1, anchor: 0, head: 5 },
  { id: "editor.cursor-forward", text: "ab\ncd", caret: 1, anchor: 2, head: 2 },
  { id: "editor.cursor-backward", text: "ab\ncd", caret: 1, anchor: 0, head: 0 },
  { id: "editor.line-start", text: "ab\ncd", caret: 4, anchor: 3, head: 3 },
  { id: "editor.line-end", text: "ab\ncd", caret: 4, anchor: 5, head: 5 },
  { id: "editor.cursor-down", text: "ab\ncd", caret: 1, anchor: 4, head: 4 },
  { id: "editor.cursor-up", text: "ab\ncd", caret: 4, anchor: 1, head: 1 },
  { id: "editor.extend-char-forward", text: "ab\ncd", caret: 1, anchor: 1, head: 2 },
  { id: "editor.extend-char-backward", text: "ab\ncd", caret: 1, anchor: 1, head: 0 },
  { id: "editor.extend-line-start", text: "ab\ncd", caret: 4, anchor: 4, head: 3 },
  { id: "editor.extend-line-end", text: "ab\ncd", caret: 4, anchor: 4, head: 5 },
  { id: "editor.extend-line-down", text: "ab\ncd", caret: 1, anchor: 1, head: 4 },
  { id: "editor.extend-line-up", text: "ab\ncd", caret: 4, anchor: 4, head: 1 },
  { id: "editor.extend-word-forward", text: "alpha beta", caret: 0, anchor: 0, head: 5 },
  { id: "editor.extend-word-backward", text: "alpha beta", caret: 10, anchor: 10, head: 6 },
  { id: "editor.delete-char-forward", text: "abc", caret: 1, expectedText: "ac", anchor: 1, head: 1 },
  { id: "editor.delete-char-backward", text: "abc", caret: 2, expectedText: "ac", anchor: 1, head: 1 },
  { id: "editor.delete-word-forward", text: "alpha beta", caret: 0, expectedText: " beta", anchor: 0, head: 0 },
  { id: "editor.delete-word-backward", text: "alpha beta", caret: 10, expectedText: "alpha ", anchor: 6, head: 6 },
  { id: "editor.kill-line", text: "ab\ncd", caret: 0, expectedText: "\ncd", anchor: 0, head: 0 },
  { id: "editor.yank", text: "abc", caret: 1, expectedText: "aXYbc", anchor: 3, head: 3, killText: "XY" },
  { id: "editor.transpose-chars", text: "abc", caret: 1, expectedText: "bac", anchor: 2, head: 2 },
  {
    id: "editor.undo", text: "abc", caret: 3, expectedText: "abc", anchor: 3, head: 3,
    prepare(view) {
      view.dispatch({ changes: { from: 3, insert: "X" }, selection: { anchor: 4 }, userEvent: "input.type" });
    },
  },
  {
    id: "editor.redo", text: "abc", caret: 3, expectedText: "abcX", anchor: 4, head: 4,
    prepare(view) {
      view.dispatch({ changes: { from: 3, insert: "X" }, selection: { anchor: 4 }, userEvent: "input.type" });
      runComposerCommand(view, "editor.undo");
    },
  },
];

for (const item of commandCases) {
  test(`runComposerCommand 映射：${item.id}`, () => {
    setKillSlot({ text: item.killText ?? "", forward: true, anchor: "test-reset" });
    const view = viewWith(item.text, item.caret);
    item.prepare?.(view);
    runComposerCommand(view, item.id);
    assert.equal(view.state.doc.toString(), item.expectedText ?? item.text);
    assert.equal(view.state.selection.main.anchor, item.anchor);
    assert.equal(view.state.selection.main.head, item.head);
    assert.deepEqual(view.state.field(composerAttachmentsField), [attachment]);
  });
}

test("命令表与 runComposerCommand 的全部 case 精确对账", () => {
  const source = readFileSync(new URL("../../src/harness-composer.ts", import.meta.url), "utf8");
  const mapped = [...source.matchAll(/case "(editor\.[^"]+)":/g)].map((match) => match[1]).sort();
  const covered = commandCases.map((item) => item.id).sort();
  assert.deepEqual(covered, mapped);
  assert.equal(covered.length, 24);
});

test("⌥D / ⌥⌫ 与 ⌃K 写入跨面共享 kill 槽", () => {
  setKillSlot({ text: "", forward: true, anchor: "test-reset" });
  const forward = viewWith("alpha beta", 0);
  runComposerCommand(forward, "editor.delete-word-forward");
  assert.equal(currentKillSlot()?.text, "alpha");
  const backward = viewWith("alpha beta", 10);
  runComposerCommand(backward, "editor.delete-word-backward");
  assert.equal(currentKillSlot()?.text, "beta");
  const line = viewWith("ab\ncd", 2);
  runComposerCommand(line, "editor.kill-line");
  assert.equal(currentKillSlot()?.text, "\n");
  runComposerCommand(line, "editor.yank");
  assert.equal(line.state.doc.toString(), "ab\ncd");
  assert.equal(line.state.selection.main.head, 3);
});
