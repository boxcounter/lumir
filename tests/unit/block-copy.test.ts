// src/preview/block-copy.ts 的纯逻辑单测（M277，change block-copy-affordance 的 tasks 3.1 / 3.2）。
//
// 这一层钉的是**切片口径本身**（哪些字符落在结果里、有没有尾换行），用真 markdown 解析器与真
// EditorState，不碰 DOM、不碰 view。触发钮的 hover 行为、剪贴板落地、文档逐字节不变归
// chromium 视觉场景与真机场景 61（`scripts/acceptance/scenarios/61-block-copy.md`）——
// 那些在无 DOM 的层里写出来只会是恒真断言（REVIEW.md 第 1 条的假绿形态）。
//
// 三条口径对应 delta 的正文：表格 = `Table` 节点源码切片（含表头分隔行与对齐填充）；围栏块 =
// `CodeText` 切片（不含围栏行与语言标记）；缩进块 = 相邻 `CodeText` 拼接（剥语法缩进、保留相对
// 缩进）。CRLF 源文件的结果是 LF（从模型复制，不是从磁盘复制）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { blockCopyText, codeBlockContentAt } from "../../src/preview/block-copy.ts";
import type { BlockCopyRange } from "../../src/preview/block-copy.ts";
import { fullscreenTableAt, findTables } from "../../src/preview/table.ts";
import { ensureSyntaxTree } from "@codemirror/language";

const MD = [markdown({ base: markdownLanguage, extensions: [GFM] })];

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: MD });
}

/** 语法树必须已覆盖整篇（`blockCopyText` 走 `syntaxTree` 快照；测试里显式推进到文档末尾）。 */
function covered(doc: string): EditorState {
  const state = stateOf(doc);
  assert.ok(ensureSyntaxTree(state, state.doc.length, 5000) !== null, "语法树未覆盖整篇");
  return state;
}

/** 文档里唯一一张「可复制」的表（矩形 + 非降级）的范围——判据与装饰层同一份模型。 */
function tableRange(doc: string): BlockCopyRange {
  const state = covered(doc);
  const tree = ensureSyntaxTree(state, state.doc.length, 5000)!;
  const models = findTables((from, to) => state.doc.sliceString(from, to), state.doc.length, tree);
  const table = fullscreenTableAt(models, models[0]?.from ?? 0);
  assert.ok(table !== undefined, "fixture 里没有渲染为 grid 的表");
  return { kind: "table", from: table.from, to: table.to };
}

// ---------------------------------------------------------------------------
// 表格：源码逐字节切片
// ---------------------------------------------------------------------------

test("表格复制 = 文档里的源码：含表头分隔行与源文件里的对齐填充，无尾换行", () => {
  // 对齐填充刻意写成用户手写的短/长形态（不是渲染器算出来的整齐列宽）。
  const table = "| 名称 | 值 |\n| ---   | ---: |\n| a | 1 |\n| 长一点的 | 22 |";
  const doc = `前言\n\n${table}\n\n后记\n`;
  const state = covered(doc);
  assert.equal(blockCopyText(state, tableRange(doc)), table);
});

test("表格复制不含前后空行，也不把相邻段落带进来", () => {
  const doc = "段一\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n段二\n";
  const state = covered(doc);
  const text = blockCopyText(state, tableRange(doc));
  assert.ok(!text.startsWith("\n"), "结果不应以换行开头");
  assert.ok(!text.endsWith("\n"), "结果不应以换行结尾");
  assert.ok(!text.includes("段一") && !text.includes("段二"), "结果不应包含表格以外的文本");
  assert.ok(text.includes("| --- | --- |"), "结果应含表头分隔行");
});

// ---------------------------------------------------------------------------
// 围栏代码块：纯内容
// ---------------------------------------------------------------------------

test("围栏代码块复制 = 纯内容：不含围栏行与语言标记，保留内容自身的相对缩进，无尾换行", () => {
  const doc = "para\n\n```js\nlet a = 1;\n  if (x) {\n    y();\n  }\n```\n";
  const state = covered(doc);
  const caret = doc.indexOf("if (x)") + 3;
  const text = codeBlockContentAt(state, caret) ?? "";
  assert.equal(text, "let a = 1;\n  if (x) {\n    y();\n  }");
  assert.ok(!text.includes("```"), "结果不应含围栏行");
  assert.ok(!text.endsWith("\n"), "结果不应有尾换行");
});

test("空围栏块复制空串（不是 undefined，也不是围栏行）", () => {
  const doc = "```\n```\n";
  const state = covered(doc);
  assert.equal(codeBlockContentAt(state, 1), "");
});

test("围栏块复制走 blockCopyText 与命令入口同一口径（范围内代码块）", () => {
  const doc = "```py\nprint(1)\nprint(2)\n```\n";
  const state = covered(doc);
  const range: BlockCopyRange = { kind: "codeblock", from: 0, to: doc.length - 1 };
  assert.equal(blockCopyText(state, range), "print(1)\nprint(2)");
});

test("波浪号围栏同样只取内容", () => {
  const doc = "~~~text\nraw line\n~~~\n";
  const state = covered(doc);
  assert.equal(codeBlockContentAt(state, 6), "raw line");
});

// ---------------------------------------------------------------------------
// 缩进代码块：剥掉语法缩进，保留相对缩进
// ---------------------------------------------------------------------------

test("缩进代码块复制 = 剥掉 4 空格语法缩进、保留更深那行的相对缩进", () => {
  // 第三行比语法缩进更深（8 空格 ⇒ 结果里保留 4 空格）。
  const doc = "para\n\n    indented 1\n    indented 2\n\n        deeper\n";
  const state = covered(doc);
  const text = codeBlockContentAt(state, doc.indexOf("indented 1") + 2);
  assert.equal(text, "indented 1\nindented 2\n\n    deeper");
});

// ---------------------------------------------------------------------------
// 换行归一与边界
// ---------------------------------------------------------------------------

test("CRLF 源文件的结果是 LF（从模型复制，不是从磁盘复制）", () => {
  // CM 把 CRLF 归一成 LF（`Text.of` 按换行切分后用 lineBreak 拼接），因此文档位置按归一后的
  // 文本算——这也正是「从模型复制」这条口径的落点。
  const doc = "para\r\n\r\n```\r\na\r\nb\r\n```\r\n";
  const state = covered(doc);
  const normalized = state.doc.toString();
  assert.equal(normalized, "para\n\n```\na\nb\n```\n");
  assert.equal(codeBlockContentAt(state, normalized.indexOf("a\nb") + 1), "a\nb");
});

test("caret 不在任何代码块里时返回 null（命令据此不消费事件）", () => {
  const state = covered("普通段落\n\n```\ncode\n```\n");
  assert.equal(codeBlockContentAt(state, 2), null);
});

test("代码块范围切片不因缩进块的多 CodeText 而错位（拼接丢掉节点间隙）", () => {
  // 两个缩进块之间隔一个段落：第二个块的内容不应把第一个块的内容带进来。隔离物不能是空行——
  // CommonMark 里空行不切断缩进代码块（实测：`    first\n\n    second\n` 是一个块，内容是
  // `first\n\nsecond`）。
  const doc = "    first\n\npara\n\n    second\n";
  const state = covered(doc);
  assert.equal(codeBlockContentAt(state, doc.indexOf("second") + 1), "second");
});
