// L6 组合输入闸门的内容起点判定单测（change fix-ime-list-composition-nov20；评审 P2-1）。
//
// 为什么要这条：组合中删空 marked text 的显式事务此前作用于**全部** Markdown 正文
// （普通段落 / 表格 / 代码块），超出 L6 的列表内容起点合同。收窄判据必须复用渲染那一份
// 列表识别（`listLineRender` / `markerTextAt`），不能在别处再写一套；本层用真 EditorState
// + 真 lezer 解析器逐形态钉住「接管 / 不接管」两侧，负向用例是核心——只测正向的话
// 「无条件接管」也能全绿。
//
// 本层测不到的是 IME 事件本身与 DOM 几何：那两半归 `tests/visual/scenes/editing-oracle.spec.ts`
// 的真引擎组合矩阵与命令行构造器用例。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { listContentStartAt } from "../../src/preview/lists.ts";
import { completeTree } from "./syntax-tree.ts";

/** 与生产同一份解析配置（src/editor.ts 的 md 模式：`markdown({ base: markdownLanguage,
 *  extensions: [GFM] })`）。 */
const MD = [markdown({ base: markdownLanguage, extensions: [GFM] })];

function stateAt(doc: string, pos: number): EditorState {
  return completeTree(EditorState.create({ doc, selection: { anchor: pos }, extensions: MD }));
}

const contentStart = (doc: string, lineNumber: number, marker: string): number => {
  const line = stateAt(doc, 0).doc.line(lineNumber);
  assert.equal(line.text.slice(0, marker.length), marker, `fixture 行 ${lineNumber} 的 marker 不符：${line.text}`);
  return line.from + marker.length;
};

test("L6 正向：真列表 / 嵌套 / 有序的内容起点接管", () => {
  for (const [doc, lineNumber, marker] of [
    ["- alpha", 1, "- "],
    ["* alpha", 1, "* "],
    ["+ alpha", 1, "+ "],
    ["1. alpha", 1, "1. "],
    ["2) alpha", 1, "2) "],
    ["- parent\n  - child", 2, "  - "],
    ["1. parent\n   1. child", 2, "   1. "],
    ["> - quoted", 1, "> - "],
  ] as const) {
    const pos = contentStart(doc, lineNumber, marker);
    assert.equal(listContentStartAt(stateAt(doc, pos), pos), true, `${JSON.stringify(doc)} 行 ${lineNumber} 应属于 L6`);
  }
});

test("L6 正向：裸 marker 行编辑态与段落后 `- ` 的 setext 候选接管", () => {
  // 非 setext 裸 marker（`+` 不能作 setext 下线）：编辑态由 listLineRender 的 bare 分支判定。
  let doc = "para\n+ ";
  assert.equal(listContentStartAt(stateAt(doc, doc.length), doc.length), true);
  // 语法树已接管的真空项（`- ` 独占文档）走 hidden.to 分支。
  doc = "- ";
  assert.equal(listContentStartAt(stateAt(doc, doc.length), doc.length), true);
  // 段落后 `- `：树里是 SetextHeading2，渲染按标题语义不建 widget，但 L6 明确覆盖这一格。
  doc = "词汇\n- ";
  assert.equal(listContentStartAt(stateAt(doc, doc.length), doc.length), true);
  doc = "para\n- ";
  assert.equal(listContentStartAt(stateAt(doc, doc.length), doc.length), true);
});

test("L6 反向：普通段落 / 行内非起点 / 表格 / 代码块 MUST NOT 接管", () => {
  const cases: [string, string, number][] = [
    ["普通段落中间", "alpha beta", 5],
    ["普通段落行首", "alpha beta", 0],
    ["列表项内容中间（非内容起点）", "- alpha", 4],
    ["代码块内的 marker 形文本", "```\n- alpha\n```", 6],
    ["缩进代码块内的 marker 形文本", "    - alpha", 6],
    ["表格 cell 内", "| a | b |\n|---|---|\n| c | d |", 22],
    ["ATX 标题内", "# - alpha", 4],
    ["setext 标题正文行", "Title\n---", 3],
    ["lazy continuation 行（渲染在顶层）", "- alpha\nbeta", 8],
  ];
  for (const [name, doc, pos] of cases) {
    assert.equal(listContentStartAt(stateAt(doc, pos), pos), false, `${name} MUST NOT 被 L6 闸门接管`);
  }
});

test("L6 裸 marker 行的编辑态门控：选区不在该行时不接管", () => {
  const doc = "para\n+ ";
  const id = (text: string, selection: number) => completeTree(EditorState.create({ doc: text, selection: { anchor: selection }, extensions: MD }));
  assert.equal(listContentStartAt(id(doc, doc.length), doc.length), true, "光标驻留时裸 marker 行属 L6");
  assert.equal(listContentStartAt(id(doc, 2), doc.length), false, "光标在上一行时裸 marker 行尚未进入编辑态");
});
