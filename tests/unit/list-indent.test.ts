// src/list-indent.ts 的纯判定单测（change rework-list-tab-line-model-nov27）：
// **行模型**的 TAB / SHIFT+TAB 口径——操作对象是选区触及的行，不是列表项 / 子树。
//
// 取代 M239（change list-tab-indent）的项 / 子树用例：旧实现只读 `selection.main.head`，把 head
// 所属 `ListItem` 覆盖的全部行整体平移，并按 D2c 重排有序编号；本 change 起逐行判定、逐行写回，
// 未选中的行逐字节不动，编号一律不改写。
//
// 为什么这条口径能在本层测：判定只读 EditorState（文档 + 解析树），不碰 view、不碰坐标、不碰渲染层
//（与 tests/unit/cell-geometry.test.ts 同一形态）。runner（readOnly 提前返回 + 单次 dispatch）留在
// src/editor.ts，本层测不到——那一半归 chromium 场景（tests/visual/scenes/m239-list-tab-indent.spec.ts）
// 与真机场景 43 / 888。
//
// 六条实现期口径（写在这里，避免下一个人按「整项 / 固定 2 空格」的直觉改回去）：
// 1. **行集 = 选区触及的行**：空选区取 head 行；非空选区取与选区相交的行，终点恰在行首的那行不计
//   （与 CM `changeBySelectedLine` 的选择口径一致）。
// 2. **首行用结构目标、续行用内容列宽**：首行 TAB 的量 = 上一同级项内容列 − 本行 marker 列
//   （`1. a` 之下要 3 空格、`10. b` 之下要 4 空格，固定 2 会嵌不进去）；续行的量 = 所属项的内容列宽。
// 3. **首项 TAB 无操作**：没有上一同级项可嵌套，写入只会留下不可见的空白 diff（M239 的 S1b 理由
//   在行模型下仍成立）；首项的续行照常按内容列宽处理。
// 4. **不带子树**：选中一行只改这一行；同一项未选中的续行 / 子项 MUST NOT 被「顺手」平移。
// 5. **不改编号**（切断 M239 的 D2c）：重排会改动未选中的兄弟项；只排选中行又会制造重复 / 跳号。
//   有序列表的显示编号由渲染层按组序算，不读源码字面数字。
// 6. **单次 dispatch**：多行编辑是一个 changeset，一次 undo 全还原；命令不重设选区。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { history, undo } from "@codemirror/commands";
import { listIndentChange } from "../../src/list-indent.ts";
import type { ListIndentDirection } from "../../src/list-indent.ts";
import { completeTree } from "./syntax-tree.ts";

const MD = [markdown({ base: markdownLanguage, extensions: [GFM] })];

/** 真 EditorState + 真 markdown 解析器，光标落在第 `line` 行第 `column` 列。 */
function caret(doc: string, line: number, column = 0): EditorState {
  const base = completeTree(EditorState.create({ doc, extensions: MD }));
  const target = base.doc.line(line);
  return base.update({ selection: EditorSelection.cursor(Math.min(target.from + column, target.to)) }).state;
}

/** 真 EditorState + 真 markdown 解析器，选区从 `fromLine:fromColumn` 到 `toLine:toColumn`。 */
function selection(doc: string, fromLine: number, fromColumn: number, toLine: number, toColumn: number): EditorState {
  const base = completeTree(EditorState.create({ doc, extensions: MD }));
  const from = base.doc.line(fromLine);
  const to = base.doc.line(toLine);
  return base.update({
    selection: EditorSelection.range(
      Math.min(from.from + fromColumn, from.to),
      Math.min(to.from + toColumn, to.to),
    ),
  }).state;
}

/** 一次按键后的文档全文；无操作（不 dispatch）时返回 null——与「动完正好等于原样」区分开。 */
function shifted(state: EditorState, dir: ListIndentDirection): string | null {
  const edit = listIndentChange(state, dir);
  if (edit === null) return null;
  return state.update({ changes: edit.changes }).state.doc.toString();
}

/** 断言一次按键的产物（`null` 期望写在这里，省得每条用例都判 no-op）。 */
function moved(state: EditorState, dir: ListIndentDirection, expected: string | null, label: string): void {
  assert.equal(shifted(state, dir), expected, `${label} 按 ${dir}`);
}

// ---------------------------------------------------------------------------
// 单行：只动该行，不带子树
// ---------------------------------------------------------------------------

test("TAB：只缩进光标所在行，未选中的续行 / 子项逐字节不动", () => {
  const doc = "- a\n- b\n  - b1\n";
  moved(caret(doc, 2, 2), "indent", "- a\n  - b\n  - b1\n", "光标在 b 行（b1 未选中）");
  // 续行也不被「顺手」带走：光标在项首行时只动首行
  moved(caret("- a\n  cont\n- b\n", 3, 0), "indent", "- a\n  cont\n  - b\n", "光标在 b 行（a 的续行未选中）");
  // 续行自身被选中时按内容列宽处理，不碰所属项首行
  moved(caret("- a\n  cont\n- b\n", 2, 3), "indent", "- a\n    cont\n- b\n", "光标在续行");
});

test("SHIFT+TAB：只凸排光标所在行，未选中的子项逐字节不动", () => {
  const doc = "- a\n  - b\n    - c\n";
  moved(caret(doc, 2, 3), "outdent", "- a\n- b\n    - c\n", "光标在 b 行（c 未选中）");
  // 续行按自身内容列宽收缩：`  cont` 再删一层成为顶层 lazy continuation
  moved(caret("- a\n  cont\n", 2, 3), "outdent", "- a\ncont\n", "光标在续行");
});

test("SHIFT+TAB：多缩进的项一次回到祖先层（按结构目标，不是机械减固定值）", () => {
  moved(caret("- a\n    - b\n", 2, 5), "outdent", "- a\n- b\n", "b 多缩了 2 格");
  moved(caret("9. a\n10. b\n   2. c\n", 3, 4), "outdent", "9. a\n10. b\n2. c\n", "3 空格在 `10.` 下不构成嵌套：c 是顶层兄弟项");
});

test("TAB：有序列表按上一同级项的内容列取步长，源码编号不改写", () => {
  moved(caret("1. x\n2. y\n", 2, 0), "indent", "1. x\n   2. y\n", "`1. ` 的内容列 = 3");
  moved(caret("9. a\n10. b\n2. c\n", 3, 0), "indent", "9. a\n10. b\n    2. c\n", "`10. ` 之下要 4 空格");
  // 编号 MUST NOT 按新归属重排：旧 M239 期望是 `   1. y`，行模型下保持字面 `2.`
  moved(caret("1) a\n2) b\n", 2, 0), "indent", "1) a\n   2) b\n", "`)` 分隔符同样只动空白");
  // 续行按所属项的内容列宽（`1. ` = 3），不按 2
  moved(caret("1. a\n   cont\n", 2, 4), "indent", "1. a\n      cont\n", "有序项续行");
  moved(caret("1. a\n      cont\n", 2, 7), "outdent", "1. a\n   cont\n", "有序项续行凸排");
});

// ---------------------------------------------------------------------------
// 首项 / 顶层：无嵌套目标
// ---------------------------------------------------------------------------

test("首项 TAB 无操作；首项续行与多行选区里的其余行照常", () => {
  moved(caret("- a\n- b\n", 1, 2), "indent", null, "第一项无上一同级项");
  moved(caret("1. a\n2. b\n", 1, 3), "indent", null, "有序列表第一项");
  moved(selection("- a\n- b\n", 1, 0, 2, 3), "indent", "- a\n  - b\n", "选中两项：首项不动，b 并入 a");
  // 嵌套层的首项：TAB 无操作；SHIFT+TAB 按祖先层正常凸排
  moved(caret("- a\n  - b\n", 2, 3), "indent", null, "子列表第一项");
  moved(caret("- a\n  - b\n", 2, 3), "outdent", "- a\n- b\n", "子列表第一项凸排");
});

test("顶层 SHIFT+TAB 无操作；多余的行首空白顺带抹平", () => {
  moved(caret("- a\n- b\n", 1, 2), "outdent", null, "顶层项无空白可减");
  moved(caret("  - a\n", 1, 4), "outdent", "- a\n", "解析上仍是顶层项：抹平多余空白");
});

test("无操作：非列表行、空行、代码块内、引用正文", () => {
  moved(caret("para\n\n- a\n", 1, 2), "indent", null, "段落");
  moved(caret("para\n\n- a\n", 1, 2), "outdent", null, "段落");
  moved(caret("# 标题\n\n- a\n", 1, 2), "indent", null, "标题");
  moved(caret("- a\n\n- b\n", 2, 0), "indent", null, "空行");
  moved(caret("```\n- a\n```\n", 2, 2), "indent", null, "围栏代码块内");
  moved(caret("> 引用段落\n", 1, 3), "indent", null, "引用内但不是列表");
  // 列表项内的围栏代码块同样不写（禁区优先于列表归属）
  moved(caret("- a\n  ```\n  code\n  ```\n", 3, 3), "indent", null, "列表项内的代码块");
});

// ---------------------------------------------------------------------------
// 引用前缀
// ---------------------------------------------------------------------------

test("引用内列表：插入 / 删除点在最内层 `>` 与其分隔空白之后", () => {
  moved(caret("> - a\n> - b\n", 2, 4), "indent", "> - a\n>   - b\n", "单层引用");
  moved(caret("> - a\n>   - b\n", 2, 6), "outdent", "> - a\n> - b\n", "单层引用凸排");
  moved(caret("> > - a\n> > - b\n", 2, 6), "indent", "> > - a\n> >   - b\n", "嵌套引用");
  moved(caret("> > - a\n> >   - b\n", 2, 8), "outdent", "> > - a\n> > - b\n", "嵌套引用凸排");
  // 引用行本身（`>` 与其后一个分隔空格）不可删
  moved(caret("> - a\n", 1, 4), "outdent", null, "该层已是顶层");
  // 单个 `> - a` 是该列表的首项：TAB 无操作（与正文首项同判，P1 的钉子）
  moved(caret("> - a\n", 1, 4), "indent", null, "引用内单首项");
});

// ---------------------------------------------------------------------------
// 多行选区：逐行处理，未选行不动
// ---------------------------------------------------------------------------

test("多行选区 SHIFT+TAB：正向逐行凸排，未选中的首行与子项不动", () => {
  const doc = "- a\n  - b\n    - c\n  - d\n";
  moved(selection(doc, 2, 0, 4, 5), "outdent", "- a\n- b\n  - c\n- d\n", "第 2–4 行正向");
});

test("多行选区 SHIFT+TAB：反向选区得到同一结果", () => {
  const doc = "- a\n  - b\n    - c\n  - d\n";
  moved(selection(doc, 4, 5, 2, 0), "outdent", "- a\n- b\n  - c\n- d\n", "第 4→2 行反向");
});

test("选区尾落在行首不计入：终点那一行不动", () => {
  const doc = "- a\n  - b\n    - c\n  - d\n";
  moved(selection(doc, 2, 0, 4, 0), "outdent", "- a\n- b\n  - c\n  - d\n", "到第 4 行行首为止");
});

test("多行选区 TAB：块内各行按各自结构步长缩进", () => {
  moved(selection("- a\n- b\n- c\n", 2, 0, 3, 3), "indent", "- a\n  - b\n  - c\n", "b / c 并入 a");
  moved(selection("1. a\n2. b\n3. c\n", 2, 0, 3, 3), "indent", "1. a\n   2. b\n   3. c\n", "有序列表各自 3 空格");
  // 有序块 TAB 后 SHIFT+TAB 逐字节回到原样（编号全程未动）
  const indented = "1. a\n   2. b\n   3. c\n";
  moved(selection(indented, 2, 0, 3, 3), "outdent", "1. a\n2. b\n3. c\n", "有序块往返");
});

test("用户截图形态：6 行嵌套选区逐行凸排，首行与未选中的子项不受牵连", () => {
  const doc = [
    "- alpha",
    "  - bravo",
    "    - charlie",
    "    - delta",
    "  - echo",
    "  - foxtrot",
    "    - golf",
    "  - hotel",
    "- india",
    "",
  ].join("\n");
  // 选第 3–8 行（charlie … hotel，共 6 行）；第 1 / 2 / 9 行未选中
  const expected = [
    "- alpha",
    "  - bravo",
    "  - charlie",
    "  - delta",
    "- echo",
    "- foxtrot",
    "  - golf",
    "- hotel",
    "- india",
    "",
  ].join("\n");
  moved(selection(doc, 3, 0, 8, 8), "outdent", expected, "6 行选区");
});

test("混合列表 / 非列表选区：只处理列表行", () => {
  moved(selection("para\n- a\n- b\n", 1, 0, 3, 3), "indent", "para\n- a\n  - b\n", "段落不写、首项不动");
  // 区分度：head 在段落行（反向选区）。旧 head 模型会因「head 不在列表项内」整体 no-op。
  moved(selection("para\n- a\n- b\n", 3, 3, 1, 0), "indent", "para\n- a\n  - b\n", "head 在段落行也处理列表行");
  // 选区把代码块行也包进来：代码块行跳过，列表行照常
  const doc = "- a\n- b\n\n```\ncode\n```\n- c\n";
  moved(selection(doc, 2, 0, 5, 4), "indent", "- a\n  - b\n\n```\ncode\n```\n- c\n", "代码块行跳过");
});

test("禁区优先于列表归属：列表项内的表格行 / 缩进代码块行不写", () => {
  // 表格在列表项内（真 lezer：TableDelimiter < Table < ListItem）
  const table = "- a\n- b\n  | h1 | h2 |\n  | -- | -- |\n  | v1 | v2 |\n";
  moved(caret(table, 4, 4), "indent", null, "表格行单独");
  moved(selection(table, 2, 0, 4, 3), "indent", "- a\n  - b\n  | h1 | h2 |\n  | -- | -- |\n  | v1 | v2 |\n", "选区含表格行：只缩 b");
  // 缩进代码块在列表项内（CodeText < CodeBlock < ListItem）
  const code = "- a\n- b\n\n      code line\n";
  moved(caret(code, 4, 7), "indent", null, "缩进代码块行单独");
  moved(selection(code, 2, 0, 4, 7), "indent", "- a\n  - b\n\n      code line\n", "选区含代码块行：只缩 b");
  // HTML 形态：当前 markdown 配置把块级 HTML 解析成 Document 级 Element / Comment（不是 HTMLBlock），
  // 因此它同样不属于任何 ListItem ⇒ 不写；HTMLBlock 仍留在禁区集合里，与 lists.ts / block-geometry.ts 同口径。
  const html = "- a\n- b\n  <!-- c -->\n";
  moved(caret(html, 3, 4), "indent", null, "列表项内的 HTML 注释行");
});

test("纯空白行不写：空行不产生行尾空格", () => {
  const doc = "- a\n- b\n\n- c\n";
  moved(selection(doc, 2, 0, 4, 3), "indent", "- a\n  - b\n\n  - c\n", "空行保持空");
  assert.ok(!listIndentChange(caret("- a\n  \n- b\n", 2, 0), "indent"), "纯空白行本身不产生编辑");
});

test("单行内的部分选区：只处理该行", () => {
  const doc = "- a\n- b\n  - b1\n";
  moved(selection(doc, 2, 1, 2, 3), "indent", "- a\n  - b\n  - b1\n", "只选了 b");
});

// ---------------------------------------------------------------------------
// 多 range / 单次 dispatch / 选区映射
// ---------------------------------------------------------------------------

test("多 range：并集去重，两个光标所在行都处理", () => {
  const doc = "- a\n- b\n- c\n- d\n";
  // 多选在 CM 里默认被折叠成 main range（`allowMultipleSelections` 未开）；本用例显式打开它，
  // 钉住「命令按全部 range 展开行集」这一实现口径（当前产品入口只有单 range，属防御性覆盖）。
  const base = completeTree(
    EditorState.create({ doc, extensions: [...MD, EditorState.allowMultipleSelections.of(true)] }),
  );
  const b = base.doc.line(2);
  const d = base.doc.line(4);
  const state = base.update({
    selection: EditorSelection.create([EditorSelection.cursor(b.from + 2), EditorSelection.cursor(d.from + 2)]),
  }).state;
  assert.equal(shifted(state, "indent"), "- a\n  - b\n- c\n  - d\n");
});

test("单次 dispatch：一次 undo 还原整次多行编辑（含所有被触及行）", () => {
  const doc = "- a\n- b\n- c\n- d\n";
  const base = completeTree(EditorState.create({ doc, extensions: [...MD, history()] }));
  let state = base.update({
    selection: EditorSelection.range(base.doc.line(2).from, base.doc.line(4).to),
  }).state;
  const edit = listIndentChange(state, "indent");
  assert.ok(edit !== null);
  state = state.update({ changes: edit.changes, userEvent: "input.indent" }).state;
  assert.equal(state.doc.toString(), "- a\n  - b\n  - c\n  - d\n");
  const target = { state, dispatch: (tr: { state: EditorState }) => { state = tr.state; } };
  undo(target);
  assert.equal(state.doc.toString(), doc, "一次 undo 应还原整次编辑");
});

test("选区与 caret 按 change mapping 平移，命令不重设选区", () => {
  const doc = "- a\n- b\n- c\n";
  const base = completeTree(EditorState.create({ doc, extensions: MD }));
  const line2 = base.doc.line(2);
  const state = base.update({ selection: EditorSelection.cursor(line2.from + 2) }).state;
  const edit = listIndentChange(state, "indent");
  assert.ok(edit !== null);
  const next = state.update({ changes: edit.changes }).state;
  // 插入发生在光标之前：光标随映射右移，仍在 b 行内
  assert.equal(next.doc.lineAt(next.selection.main.head).number, 2);
  assert.equal(next.selection.main.head, line2.from + 4, "光标应随行首插入的 2 空格右移");
});
