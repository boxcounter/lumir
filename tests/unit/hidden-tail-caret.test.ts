// src/preview/hidden-tail-caret.ts 的不变量单测（M539，Alex 裁决：点击粗体渲染内容
// 最后一个字形之后（含行末档），光标落在闭合 `**` 之后，而不是之前）。
//
// 这一层钉的是**落点修正的判定本身**：哪些文档位置算「渲染态隐藏尾标内的落点」、
// 修正到哪个位置、哪些输入必须不动（显露态 / 键盘移动 / 非空选区 / 无尾标构造）。
// 坐标那一半（点击 x → posAtCoords 的映射、零宽隐藏段两侧坐标相同）需要真实布局，
// 归 Alex dogfood 手感验收——在无 DOM 的层里造坐标只会是空断言（REVIEW.md 「断言等价于子串」条）。
//
// 机理（被测代码文件头有完整版）：渲染态下 `**` / `](url)` 被隐藏、零占宽，「末字之后」
// 的点击坐标同时对应收尾标记前后两个文档位置，WebKit 只回可见文本内的位置（标记之前）。
// 修正器把这类落点推到整个行内构造的收尾标记之后；显露判定走 M259 按压快照，所以
// 测试里点击前要先按真实 app 的次序开按压窗口（beginPointerPress 先于 CM 落点派发）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  pointerPressField,
  pointerPressFrame,
} from "../../src/preview/reveal-gate.ts";
import {
  adjustHiddenInlineTailCaret,
  hiddenInlineTailCaretFilter,
} from "../../src/preview/hidden-tail-caret.ts";
import { completeTree } from "./syntax-tree.ts";

const MD = [markdown({ base: markdownLanguage, extensions: [GFM] })];

/** 真机点击时序的骨架：解析完整 → 开按压窗口（快照=按下前选区）→ 落下指针选区。 */
function click(doc: string, snapshotPos: number, clickPos: number, userEvent = "select.pointer"): EditorState {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(snapshotPos),
    extensions: [...MD, pointerPressField, hiddenInlineTailCaretFilter],
  });
  state = completeTree(state);
  state = state.update({ effects: pointerPressFrame.of(state.selection) }).state;
  return state.update({
    selection: EditorSelection.cursor(clickPos),
    userEvent,
  }).state;
}

/** 纯函数层的便捷入口（不开按压窗口、不装过滤器，判定的显露口径用活选区=快照外）。 */
function adjust(doc: string, pos: number): number {
  let state = EditorState.create({ doc, selection: EditorSelection.cursor(0), extensions: [...MD, pointerPressField] });
  state = completeTree(state);
  // 显式开一个「快照在范围外」的按压窗口：与真机时序一致，且让 rangeRevealsSource
  // 的判据选区不等于被测落点本身（否则含端点口径会让「隐藏」永远判不中——那正是
  // 按压快照在 M259 之后成为修正前提的原因）。
  state = state.update({ effects: pointerPressFrame.of(state.selection) }).state;
  return adjustHiddenInlineTailCaret(state, pos);
}

// `raw` 在 doc 里的 [from, to]（from=首个定界符起点，to=收尾定界符之后）。
const rangeOf = (doc: string, raw: string): [number, number] => {
  const from = doc.indexOf(raw);
  return [from, from + raw.length];
};

// ---------------------------------------------------------------------------
// 核心判据矩阵（纯函数层）
// ---------------------------------------------------------------------------

test("粗体行末档：末字之后的落点修正到闭合 ** 之后", () => {
  const doc = "标题\n\n本节末尾是 **粗体内容**\n";
  const [from, to] = rangeOf(doc, "**粗体内容**");
  const tailStart = to - 2; // 收尾 `**` 的起点 = 「末字之后」点击会落到的位置
  assert.equal(adjust(doc, tailStart), to);
  // 区分度：行末再往后一位（换行符位）不受修正
  assert.equal(adjust(doc, to), to);
  assert.equal(adjust(doc, from - 1), from - 1);
});

test("粗体非行末档（行中后跟文字）：末字之后的落点同样修正到闭合 ** 之后", () => {
  const doc = "点击 **粗体** 后面的字\n";
  const [, to] = rangeOf(doc, "**粗体**");
  assert.equal(adjust(doc, to - 2), to);
});

test("粗体内部落点不动：内容里、开头标记之后、闭合标记之后都原样返回", () => {
  const doc = "点击 **粗体** 后面\n";
  const [from, to] = rangeOf(doc, "**粗体**");
  for (const pos of [from + 2, from + 3, to - 3, to]) {
    assert.equal(adjust(doc, pos), pos, `pos=${pos}`);
  }
});

test("非粗体行与纯文本完全不受影响", () => {
  const doc = "普通的一行文字，没有任何标记。\n";
  for (const pos of [0, 5, 10, doc.length - 1]) {
    assert.equal(adjust(doc, pos), pos, `pos=${pos}`);
  }
});

test("斜体与删除线同族同判：末字之后修正到收尾标记之后", () => {
  const em = "前文 *斜体字* 后文\n";
  const [, emTo] = rangeOf(em, "*斜体字*");
  assert.equal(adjust(em, emTo - 1), emTo);
  const strike = "前文 ~~删除线~~ 后文\n";
  const [, stTo] = rangeOf(strike, "~~删除线~~");
  assert.equal(adjust(strike, stTo - 2), stTo);
});

test("嵌套强调：落点在 `***` 的收尾 run 内时逐轮外推到最外层之后", () => {
  const doc = "嵌套 ***深粗*** 后文\n";
  // 可见内容 `深粗` 之后、内层 `**` 之前——点击会落到的位置
  const innerTail = doc.indexOf("深粗") + 2;
  const [, outerTo] = rangeOf(doc, "***深粗***");
  assert.equal(adjust(doc, innerTail), outerTo);
});

test("链接同根同修：显示文本末字之后的落点修正到整条链接之后", () => {
  const doc = "请看 [标签文字](https://example.com) 谢谢\n";
  const labelTo = doc.indexOf("](");
  const [, to] = rangeOf(doc, "[标签文字](https://example.com)");
  assert.equal(adjust(doc, labelTo), to);
});

test("blocked 链接不装饰（保持原文）：落点不当作链接尾标修正", () => {
  const doc = "看 [点我](javascript:alert(1)) 谢谢\n";
  const labelTo = doc.indexOf("](");
  assert.equal(adjust(doc, labelTo), labelTo);
});

test("标签内的粗体：落点归粗体自己的收尾标记管（闭合 ** 之后、仍在标签内），不跳到链接尾", () => {
  const doc = "看 [**粗体字**](https://example.com) 谢谢\n";
  const boldTail = doc.indexOf("粗体字") + 3; // `**粗体字**` 收尾 `**` 的起点
  const boldTo = boldTail + 2;
  assert.equal(adjust(doc, boldTail), boldTo);
  assert.equal(boldTo, doc.indexOf("]", 4), "修正点是闭合 ** 之后、] 之前（仍在标签内）");
  assert.ok(boldTo < doc.indexOf("(https"), "绝不跳到链接尾标之外");
});

test("行内 code 无本形态问题：反引号渲染态可见，落点原样返回", () => {
  const doc = "前文 `code` 后文\n";
  const tick = doc.indexOf("`", 4); // 收尾反引号位
  assert.equal(adjust(doc, tick), tick);
  assert.equal(adjust(doc, tick - 1), tick - 1);
});

// ---------------------------------------------------------------------------
// 事务过滤器集成层：消费面（哪些 transaction 会被修正）
// ---------------------------------------------------------------------------

test("指针点击（select.pointer + 按压窗口）落下隐藏尾标内：过滤器把光标推到 ** 之后", () => {
  const doc = "点击 **粗体** 后面\n";
  const [, to] = rangeOf(doc, "**粗体**");
  const state = click(doc, 0, to - 2);
  assert.equal(state.selection.main.head, to, "光标应落在闭合 ** 之后");
  assert.ok(state.selection.main.empty);
});

test("显露态（按下前快照已在粗体内）不修正：落点是合法精确位", () => {
  const doc = "点击 **粗体** 后面\n";
  const [from, to] = rangeOf(doc, "**粗体**");
  const state = click(doc, from + 3, to - 2);
  assert.equal(state.selection.main.head, to - 2, "显露态点击必须保持落点不动");
});

test("键盘移动不经过滤器：光标可以停在闭合 ** 之前（方向键不会在尾标边界被顶死）", () => {
  const doc = "点击 **粗体** 后面\n";
  const [, to] = rangeOf(doc, "**粗体**");
  const state = click(doc, 0, to - 2, "select.keyboard");
  assert.equal(state.selection.main.head, to - 2);
});

test("非空选区（拖拽 / 双击 / 三击）不修正", () => {
  const doc = "点击 **粗体** 后面\n";
  const [from, to] = rangeOf(doc, "**粗体**");
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(0),
    extensions: [...MD, pointerPressField, hiddenInlineTailCaretFilter],
  });
  state = completeTree(state);
  state = state.update({ effects: pointerPressFrame.of(state.selection) }).state;
  const dragged = state.update({
    selection: EditorSelection.range(from - 2, to - 2),
    userEvent: "select.pointer",
  }).state;
  assert.equal(dragged.selection.main.head, to - 2, "拖拽选区必须原样落地");
  assert.ok(!dragged.selection.main.empty);
});

test("文档逐字节不变：修正只动选区", () => {
  const doc = "点击 **粗体** 后面\n";
  const [, to] = rangeOf(doc, "**粗体**");
  const state = click(doc, 0, to - 2);
  assert.equal(state.doc.toString(), doc);
});
