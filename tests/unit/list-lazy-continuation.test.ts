// 列表行渲染归属的判定单测（M421，缺陷修复；合同 docs/specs/lists.md 的 L1 / L2）。
//
// 为什么这条判据能在本层测：判定只读「行文本 + 真 lezer 解析树」（`src/preview/lists.ts` 的
// `listLineInfo`，纯函数，不碰 view / 坐标 / 渲染层，与 tests/unit/list-indent.test.ts 同一形态）。
// 它同时也是 `ListLayout.build()` 的唯一判据来源（REVIEW.md 第 8 条：同语义不得两处写值）——
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
import { listLineInfo } from "../../src/preview/lists.ts";
import { enterWithAutoIndent } from "../../src/enter-indent.ts";

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

/** 在 `pos` 处按 Enter（真键位命令体），返回新状态。 */
function pressEnterAt(doc: string, pos: number): EditorState {
  const state = EditorState.create({ doc, extensions: MD, selection: EditorSelection.cursor(pos) });
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
