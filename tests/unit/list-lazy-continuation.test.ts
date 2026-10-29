// 列表行渲染归属的判定单测（M421，缺陷修复；合同 docs/specs/lists.md 的 L1 / L2）。
//
// 为什么这条判据能在本层测：判定只读「行文本 + 真 lezer 解析树」（`src/preview/lists.ts` 的
// `listLineInfo`，纯函数，不碰 view / 坐标 / 渲染层，与 tests/unit/list-indent.test.ts 同一形态）。
// 它同时也是 `ListLayout.build()` 的唯一判据来源（REVIEW.md 「同一语义两处真源」条：同语义不得两处写值）——
// 所以这里测的不是复刻出来的条件，而是生产那一份。
//
// **本层测不到**的一半是几何（文本左缘的 x 坐标）：那要 DOM + 布局，归
// `tests/visual/scenes/lists.spec.ts`（chrome 下量字符 rect）与真机场景 120（截图 + 文档终态）。
//
// 缺陷背景（Alex 原话，M408 survey 定位）：在列表末尾 Enter 造出的空项上再 Enter 退出后，
// 该行光标在行首（预期），但一输入字符就落到列表项的缩进位置（缺陷）。根因在渲染层——
// 该行源码无缩进、被 lezer 解析进列表项内段落（CommonMark lazy continuation），旧判定按
// 「项内段落」加 `--lp-list-body` 缩进；Obsidian 1.14.4 live preview 把它渲染在顶层左边距。
// 修法（M408 候选 A）：非首行 + 行首无源码空白 ⇒ 按顶层段落渲染（L1）；带源码缩进的真续行
// 保持项内渲染（L2）——**反向用例必须在场**，否则「无条件关掉续行缩进」也能让 L1 绿。

import { test } from "node:test";
import assert from "node:assert/strict";
import { Text, EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import type { MarkdownParser } from "@lezer/markdown";
import { listHiddenRangeAt, listLineInfo, listLineRender } from "../../src/preview/lists.ts";
import { enterWithAutoIndent } from "../../src/enter-indent.ts";
import { completeTree } from "./syntax-tree.ts";

/** 与生产同一份解析配置（src/editor.ts 的 md 模式：`markdown({ base: markdownLanguage,
 *  extensions: [GFM] })`）——判定必须对着真解析器的同一种配置。 */
const MD = [markdown({ base: markdownLanguage, extensions: [GFM] })];
const parser = (markdownLanguage.parser as MarkdownParser).configure(GFM);

function atLine(doc: string, lineNumber: number) {
  const text = Text.of(doc.split("\n"));
  return listLineInfo(parser.parse(doc), text, text.line(lineNumber));
}

// ---------------------------------------------------------------------------
// 生成器：列表类型 × 嵌套 × 与项之间有无空行 × 行首缩进
// ---------------------------------------------------------------------------

/** 列表标记的输入分布（ul 三种字符 + ol 两种分隔符 + 任务列表）。 */
const MARKERS = ["-", "*", "+", "1.", "2)", "- [ ]"];

test("L1：lazy continuation 行（行首无源码空白、解析进项内段落）按顶层段落渲染", () => {
  for (const marker of MARKERS) {
    const doc = `${marker} alpha\nx`;
    const info = atLine(doc, 2);
    assert.ok(info.item !== null, `${JSON.stringify(doc)} 的第二行应被解析进 ListItem（否则本用例是空转）`);
    assert.equal(info.first, false, `${JSON.stringify(doc)}：第二行不是项首行`);
    assert.equal(info.offset, 0, `${JSON.stringify(doc)}：行首无源码空白`);
    assert.equal(info.rendered, false, `${JSON.stringify(doc)}：L1——lazy 行 MUST NOT 按列表项行渲染`);
  }
});

test("L2：带源码缩进的真续行仍按项内渲染（反向用例——无条件关掉缩进会在这里红）", () => {
  for (const marker of MARKERS) {
    for (const indent of [" ", "  ", "    "]) {
      const doc = `${marker} alpha\n${indent}x`;
      const info = atLine(doc, 2);
      assert.ok(info.item !== null, `${JSON.stringify(doc)} 的第二行应被解析进 ListItem`);
      assert.equal(info.offset, indent.length, `${JSON.stringify(doc)}：行首缩进 = ${indent.length}`);
      assert.equal(
        info.rendered,
        true,
        `${JSON.stringify(doc)}：L2——带源码缩进的项内段落行 MUST 保持项内渲染`,
      );
    }
  }
});

test("L2：项首行（marker 行）保持列表行渲染；隔一个空行则是顶层段落（item 判空）", () => {
  for (const marker of MARKERS) {
    const doc = `${marker} alpha\n\nx`;
    assert.equal(atLine(doc, 1).rendered, true, `${JSON.stringify(doc)}：项首行 MUST 渲染列表行`);
    assert.equal(atLine(doc, 1).first, true, `${JSON.stringify(doc)}：项首行判定`);
    // 空行隔开 ⇒ x 是顶层段落，与列表无关（item 判空即「本行不属于任何列表项」）
    const lone = atLine(doc, 3);
    assert.equal(lone.item, null, `${JSON.stringify(doc)}：隔空行后的行 MUST NOT 归属 ListItem`);
    assert.equal(lone.rendered, false, `${JSON.stringify(doc)}：顶层段落不按列表行渲染`);
  }
});

test("嵌套：子项内的 lazy 行按顶层段落渲染，子项内的真续行保持项内渲染", () => {
  const lazy = atLine("- alpha\n  - bravo\nx", 3);
  assert.ok(lazy.item !== null, "`x` 应被解析进 ListItem（bravo 项的 lazy continuation）");
  assert.equal(lazy.first, false);
  assert.equal(lazy.rendered, false, "嵌套项上的 lazy 行同样按顶层段落渲染（L1 不区分深度）");

  const real = atLine("- alpha\n  - bravo\n  x", 3);
  assert.ok(real.item !== null, "`  x` 应被解析进 ListItem");
  assert.equal(real.offset, 2);
  assert.equal(real.rendered, true, "带缩进的续行保持项内渲染");
});

test("判定与光标位置无关（L3）：同一 doc 在不同选区下归属判定逐字段相同", () => {
  const doc = "- alpha\nx\n- bravo\n";
  const baseline = atLine(doc, 2);
  for (const anchor of [0, doc.indexOf("x"), doc.indexOf("x") + 1, doc.length]) {
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(anchor) });
    // 判定只吃 (tree, doc, line)——选区不在入参里；这里把「换一个选区」写成显式的现场，
    // 防止将来有人把光标条件引进来（那时本用例的红会落在 rendered 上）。
    const info = listLineInfo(parser.parse(state.doc.toString()), state.doc, state.doc.line(2));
    assert.equal(info.rendered, baseline.rendered, `光标在 ${anchor} 时 rendered 应与基线一致`);
    assert.equal(info.first, baseline.first);
    assert.equal(info.offset, baseline.offset);
  }
});

// ---------------------------------------------------------------------------
// Alex 现场（报告原话的 doc 演化）+ L4：渲染归属不改写文档
// ---------------------------------------------------------------------------

/** 在 `pos` 处按 Enter（真键位命令体），返回新状态。状态先过 `completeTree`——命令体读
 *  `syntaxTree` 快照（见 `syntax-tree.ts` 的文件头）。 */
function pressEnterAt(doc: string, pos: number): EditorState {
  const state = completeTree(EditorState.create({ doc, extensions: MD, selection: EditorSelection.cursor(pos) }));
  let next = state;
  const view = {
    state,
    dispatch: (tr: { state: EditorState }) => {
      next = tr.state;
    },
  } as unknown as EditorView;
  assert.equal(enterWithAutoIndent(view, "md", true), true, "Enter 应由命令体接管");
  return next;
}

test("Alex 现场：列表末尾 Enter 造空项 → 再 Enter 退出 → 键入字符，该行按顶层段落渲染", () => {
  // 起点 = 列表最后一项末尾（`- bravo` 有内容，与 Alex 的操作现场一致）
  const start = "- alpha\n- bravo";
  // 第一次 Enter：续出空 item（命令层既有行为）
  const continued = pressEnterAt(start, start.length);
  assert.equal(continued.doc.toString(), "- alpha\n- bravo\n- ", "续行：空 item 已创建（marker 续写）");
  // 第二次 Enter：M399 的退出路径——去标记、行保留、光标在行首
  const exited = pressEnterAt(continued.doc.toString(), continued.doc.length);
  assert.equal(exited.doc.toString(), "- alpha\n- bravo\n", "退出：marker 已删去、行保留、不新增行");
  assert.equal(exited.selection.main.head, exited.doc.length, "光标在该行行首");
  // 键入一个字符（编辑器里就是 doc 插入，选区随输入后移）
  const after = exited.doc.toString() + "x";
  assert.equal(after, "- alpha\n- bravo\nx", "键入后文档为 `- alpha\\n- bravo\\nx`（MUST NOT 补分隔空行——候选 B 被否决）");
  const info = atLine(after, 3);
  assert.ok(info.item !== null, "该行语法树归属仍是列表项内段落（CommonMark lazy continuation）");
  assert.equal(info.offset, 0, "行首无源码空白（候选 A 的判据前提）");
  assert.equal(info.rendered, false, "L1：渲染按顶层段落——字符与光标出现在行首");
});

// ---------------------------------------------------------------------------
// L5 / C6（M795，Alex 2026-10-29 报告）：列表 marker 的隐藏源码区间
// ---------------------------------------------------------------------------
//
// 同一份判定（`listLineRender`）驱动三处：渲染怎么藏（build）、水平移动的一步跨过
// （`listHiddenRangeAt`，合同 docs/specs/editor-caret.md 的 C6）、以及真机几何场景的预期。
// 这里测的是**生产那一份**：区间端点必须与渲染层藏的源码逐位一致——多藏或少藏都会让
// 光标落在「看不见的源码」上（本 mission 的缺陷形态）。
//
// 本层测不到的一半是几何（光标矩形的像素高度）：归 tests/visual/scenes/m647-caret-geometry.spec.ts；
// 按键层的落点归 tests/visual/scenes/cursor-motion.spec.ts。

/** 列表 marker 的输入分布（与渲染层同一组：ul 三种字符 + ol 两种分隔符 + 任务项 + 多级编号）。
 *  `from` / `to` 是**相对行首**的列号（绝对位由 `line.from` 加上去）。 */
const HIDDEN_CASES: { doc: string; line: number; from: number; to: number; why: string }[] = [
  { doc: "- a", line: 1, from: 0, to: 2, why: "ul 单字符 marker + 一个空格" },
  { doc: "* a", line: 1, from: 0, to: 2, why: "ul `*`" },
  { doc: "+ a", line: 1, from: 0, to: 2, why: "ul `+`" },
  { doc: "1. a", line: 1, from: 0, to: 3, why: "ol 一位编号 + 尾点" },
  { doc: "10. a", line: 1, from: 0, to: 4, why: "ol 两位编号（marker 更宽）" },
  { doc: "100000. a", line: 1, from: 0, to: 8, why: "ol 六位编号（marker 宽度上限档）" },
  { doc: "2) a", line: 1, from: 0, to: 3, why: "ol 括号分隔符" },
  { doc: "- [ ] a", line: 1, from: 0, to: 6, why: "任务项：marker + 任务框 + 空格一起藏" },
  { doc: "- [x] a", line: 1, from: 0, to: 6, why: "已勾选任务项同形" },
  { doc: "1.   a", line: 1, from: 0, to: 5, why: "marker 后多个空格一并藏（否则光标会落到不可见空白里）" },
  { doc: "- a\n  - b", line: 2, from: 0, to: 4, why: "嵌套项：缩进 + 子项 marker 一起藏" },
  { doc: "- a\n  b", line: 2, from: 0, to: 2, why: "真续行：行首源码缩进整段藏（L2）" },
  { doc: "> - a", line: 1, from: 0, to: 4, why: "引用内列表：引用前缀 + marker 一起藏" },
];

test("L5：列表 marker 隐藏区间的端点 = 渲染层实际 replace 掉的源码（列表类型 × marker 宽度 × 嵌套）", () => {
  for (const c of HIDDEN_CASES) {
    const text = Text.of(c.doc.split("\n"));
    const line = text.line(c.line);
    const render = listLineRender(parser.parse(c.doc), text, line, false);
    assert.ok(render.hidden !== null, `${JSON.stringify(c.doc)} 第 ${c.line} 行应隐藏源码（${c.why}）`);
    assert.deepEqual(
      render.hidden,
      { from: line.from + c.from, to: line.from + c.to },
      `${JSON.stringify(c.doc)} 第 ${c.line} 行：${c.why}`,
    );
  }
});

test("L5 反向用例：lazy continuation 行不隐藏任何源码（L1 的渲染在行首，无从藏起）", () => {
  for (const marker of MARKERS) {
    const doc = `${marker} alpha\nx`;
    const text = Text.of(doc.split("\n"));
    const render = listLineRender(parser.parse(doc), text, text.line(2), false);
    assert.equal(render.hidden, null, `${JSON.stringify(doc)}：lazy 行按顶层段落渲染，MUST NOT 隐藏行首字符`);
    assert.equal(render.bare, null, "语法树已接管的项内段落不是裸 marker 行");
  }
});

test("L5 门控：裸 marker 行只在判据选区与该行相接时隐藏源码（B1 的编辑态）", () => {
  const doc = "para\n1. ";
  const text = Text.of(doc.split("\n"));
  const line = text.line(2);
  const off = listLineRender(parser.parse(doc), text, line, false);
  assert.equal(off.hidden, null, "光标不在该行：仍是字面文本，没有隐藏区间（否则水平移动会跳过看得见的字符）");
  assert.equal(off.bare, null, "非编辑态不给裸行判定");
  const on = listLineRender(parser.parse(doc), text, line, true);
  assert.ok(on.bare !== null, "编辑态给出裸行判定（M461）");
  assert.deepEqual(on.hidden, { from: line.from, to: line.from + 3 }, "编辑态藏 marker + 空格");
});

/** 与生产同一份语言配置的 state（`listHiddenRangeAt` 读 `syntaxTree(state)`，必须先过 completeTree）。 */
function stateAt(doc: string, pos: number): EditorState {
  return completeTree(EditorState.create({ doc, extensions: MD, selection: EditorSelection.cursor(pos) }));
}

test("C6：隐藏区间内部的位置钳到可见一侧边界；边界位本身不移动", () => {
  const doc = "1. aaaaa";
  const state = stateAt(doc, 0);
  // 区间 [0, 3)：1 / 2 是「看不见的源码内部」，前进钳到 3（正文起点）、后退钳到 0（可见行首）。
  for (const pos of [1, 2]) {
    assert.equal(listHiddenRangeAt(state, pos, true), 3, `前进：${pos} MUST 钳到正文起点`);
    assert.equal(listHiddenRangeAt(state, pos, false), 0, `后退：${pos} MUST 钳到可见行首`);
  }
  // 边界位是可见停靠点：0（可见行首）与 3（正文起点）都在区间外，不钳制。
  for (const pos of [0, 3, 4]) {
    assert.equal(listHiddenRangeAt(state, pos, true), null, `边界位 ${pos} 不钳制（前进）`);
    assert.equal(listHiddenRangeAt(state, pos, false), null, `边界位 ${pos} 不钳制（后退）`);
  }
});

test("C6：真续行的行首缩进同为一个原子步；正文首字符起的逐字素移动不受影响", () => {
  const doc = "- a\n  bcd";
  const line = Text.of(doc.split("\n")).line(2);
  const state = stateAt(doc, line.from);
  assert.equal(listHiddenRangeAt(state, line.from + 1, true), line.from + 2, "缩进内部前进 → 正文起点");
  assert.equal(listHiddenRangeAt(state, line.from + 1, false), line.from, "缩进内部后退 → 可见行首");
  for (const pos of [line.from + 2, line.from + 3, line.from + 4]) {
    assert.equal(listHiddenRangeAt(state, pos, true), null, `正文位置 ${pos - line.from} 不钳制`);
    assert.equal(listHiddenRangeAt(state, pos, false), null, `正文位置 ${pos - line.from} 不钳制（后退）`);
  }
});

test("C6：裸 marker 行的原子步跟随编辑态门控（光标不在该行时逐字符通行）", () => {
  // `2. ` 起号的空列表项按 CommonMark 不能打断段落（能打断的只有 `1. `）——这才是裸行形态；
  // `1. abc` 会被解析成真列表，门控不参与。
  const doc = "para\n2. abc";
  const line = Text.of(doc.split("\n")).line(2);
  // 光标在段落行：该行是字面文本（`1. ` 可见），区间内部的位置没有隐藏语义。
  const away = stateAt(doc, 0);
  assert.equal(listHiddenRangeAt(away, line.from + 1, true), null, "非编辑态：看不见的源码不存在，不钳制");
  // 光标在该行行首（B1：行首算驻留）：进入编辑态，marker 藏起来，内部位置一步跨过。
  const on = stateAt(doc, line.from);
  assert.equal(listHiddenRangeAt(on, line.from + 1, true), line.from + 3, "编辑态：钳到正文起点");
  assert.equal(listHiddenRangeAt(on, line.from + 2, false), line.from, "编辑态：钳到可见行首");
});
