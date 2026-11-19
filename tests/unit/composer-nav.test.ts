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

// 假 view 的度量按**比例字体**建模：CM 的竖直移动把 goal column 当像素 x（coordsAtPos 测左缘、
// posAtCoords 取最近字符边界），而 composer 实际字体是 --font-sans。若这里用字符列当像素，
// 「⌃P 同列位」的断言在修前也是绿的（假绿）。宽度表取 SF Pro 13px 的近似值，'m' / 'n' 明显偏宽。
const CHAR_WIDTHS: Record<string, number> = {
  a: 7.1, b: 7.7, c: 6.75, d: 7.2, e: 7.1, f: 4.4, g: 7.2, h: 7.3, i: 3.3, j: 3.3,
  k: 6.6, l: 3.3, m: 11.2, n: 7.5, o: 7.2, p: 7.3, q: 7.3, r: 4.9, s: 6.4, t: 4.6,
  u: 7.2, v: 6.7, w: 7.9, x: 6.6, y: 6.7, z: 7.0,
};
const DEFAULT_WIDTH = 6.9;

function pixelX(text: string, offset: number): number {
  let x = 0;
  for (let i = 0; i < offset; i += 1) x += CHAR_WIDTHS[text[i] ?? ""] ?? DEFAULT_WIDTH;
  return x;
}

function nearestColumn(text: string, goal: number): number {
  let best = 0;
  let bestDistance = Math.abs(pixelX(text, 0) - goal);
  for (let i = 1; i <= text.length; i += 1) {
    const distance = Math.abs(pixelX(text, i) - goal);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

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
    /** 与真 CM 同口径：goal column 是**像素 x**，落点取目标行最近的字符边界。 */
    moveVertically(range: SelectionRange, forward: boolean): SelectionRange {
      const line = view.state.doc.lineAt(range.head);
      const targetNumber = line.number + (forward ? 1 : -1);
      if (targetNumber < 1 || targetNumber > view.state.doc.lines) return range;
      const target = view.state.doc.line(targetNumber);
      const goal = range.goalColumn ?? pixelX(line.text, range.head - line.from);
      const column = nearestColumn(target.text, goal);
      return EditorSelection.cursor(target.from + column, 0, undefined, goal);
    },
    // includeWrap 在本假 view 里无几何可测（单测不造假软折行）：渲染行 = 逻辑行。
    moveToLineBoundary(range: SelectionRange, forward: boolean, _includeWrap?: boolean): SelectionRange {
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

// ── 竖直移动的列位口径（M834）──────────────────────────────────────────────────────────
// 列位 = **行内字符列**（Emacs previous-line/next-line 的 goal column）。假 view 的竖直移动按
// 像素 goal column 建模（比例字体），因此修复前这些用例会落到右边一列。
function readSelection(view: EditorView) {
  const main = view.state.selection.main;
  return { anchor: main.anchor, head: main.head, goal: main.goalColumn ?? null };
}

test("⌃P 从短行行尾回长行取字符列，不取像素最近的边界", () => {
  const view = viewWith("yabzcdw\nmn", 10);
  runComposerCommand(view, "editor.cursor-up");
  assert.deepEqual(readSelection(view), { anchor: 2, head: 2, goal: 2 });
});

test("⌃N 到短行钳到行尾并保留目标列，回长行恢复原列", () => {
  const view = viewWith("abcdefghij\nxy", 10);
  runComposerCommand(view, "editor.cursor-down");
  assert.deepEqual(readSelection(view), { anchor: 13, head: 13, goal: 10 });
  runComposerCommand(view, "editor.cursor-up");
  assert.deepEqual(readSelection(view), { anchor: 10, head: 10, goal: 10 });
});

test("连续 ⌃P/⌃N 穿过短行仍按目标列往返", () => {
  const view = viewWith("0123456789\nxy\nABCDEFGHIJ", 24);
  for (const [command, head] of [
    ["editor.cursor-up", 13],
    ["editor.cursor-up", 10],
    ["editor.cursor-down", 13],
    ["editor.cursor-down", 24],
  ] as const) {
    runComposerCommand(view, command);
    assert.equal(view.state.selection.main.head, head);
    assert.equal(view.state.selection.main.goalColumn, 10);
  }
});

test("键入后的 ⌃P 以当前行的字符列为准（目标列随编辑重置）", () => {
  const view = viewWith("abcdefghij\nxy", 13);
  view.dispatch({ changes: { from: 13, insert: "Q" }, selection: { anchor: 14 }, userEvent: "input.type" });
  assert.equal(view.state.selection.main.goalColumn ?? null, null);
  runComposerCommand(view, "editor.cursor-up");
  assert.deepEqual(readSelection(view), { anchor: 3, head: 3, goal: 3 });
});

test("⇧Enter 换行后键入再从行尾 ⌃P 取字符列", () => {
  const view = viewWith("yabzcdw\nmn", 10);
  view.dispatch({ changes: { from: 10, insert: "\n" }, selection: { anchor: 11 }, userEvent: "input" });
  view.dispatch({ changes: { from: 11, insert: "mn" }, selection: { anchor: 13 }, userEvent: "input.type" });
  // 新行键入后停在行尾（列 2）：⌃P 先回上一段同列，再回第一段同列
  runComposerCommand(view, "editor.cursor-up");
  assert.deepEqual(readSelection(view), { anchor: 10, head: 10, goal: 2 });
  runComposerCommand(view, "editor.cursor-up");
  assert.deepEqual(readSelection(view), { anchor: 2, head: 2, goal: 2 });
});

test("空行不吃列位：穿过空行仍回原字符列", () => {
  const view = viewWith("abcd\n\nxy", 8);
  runComposerCommand(view, "editor.cursor-up");
  assert.deepEqual(readSelection(view), { anchor: 5, head: 5, goal: 2 });
  runComposerCommand(view, "editor.cursor-up");
  assert.deepEqual(readSelection(view), { anchor: 2, head: 2, goal: 2 });
});

test("首行 ⌃P / 末行 ⌃N 回落行首 / 行尾（与 CM cursorByLine 同序）", () => {
  const top = viewWith("abcd\nef", 2);
  runComposerCommand(top, "editor.cursor-up");
  assert.equal(top.state.selection.main.head, 0);
  const bottom = viewWith("abcd\nef", 6);
  runComposerCommand(bottom, "editor.cursor-down");
  assert.equal(bottom.state.selection.main.head, 7);
});

test("非空选区的 ⌃P 只折叠不移动", () => {
  const view = viewWith("ab\ncd", 1);
  view.dispatch({ selection: EditorSelection.range(1, 4) });
  runComposerCommand(view, "editor.cursor-up");
  assert.deepEqual(readSelection(view), { anchor: 1, head: 1, goal: null });
});

test("⇧⌃P / ⇧⌃N 扩选同列位且 anchor 不动", () => {
  const view = viewWith("yabzcdw\nmn", 10);
  runComposerCommand(view, "editor.extend-line-up");
  assert.deepEqual(readSelection(view), { anchor: 10, head: 2, goal: 2 });
  runComposerCommand(view, "editor.extend-line-down");
  assert.deepEqual(readSelection(view), { anchor: 10, head: 10, goal: 2 });
});
