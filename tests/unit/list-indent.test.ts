// src/list-indent.ts 的纯判定单测（M239，change list-tab-indent）：列表项 TAB / SHIFT+TAB 的
// 平移口径（design §2 状态机 + §3 写回规则 + Alex 裁决 D1a/D2c/D3a/D4a/D5a）。
//
// 为什么这条口径能在本层测：判定只读 EditorState（文档 + 解析树），不碰 view、不碰坐标、不碰渲染层
//（与 tests/unit/cell-geometry.test.ts 同一形态，先例说明见那边的文件头）。runner（readOnly 提前
// 返回 + 单次 dispatch）留在 src/editor.ts，本层测不到——那一半归 chromium 场景与真机套件
//（scripts/acceptance/scenarios/43-list-tab-indent.md）。
//
// 三条实现期实测口径（写在这里，避免下一个人按「固定 2 空格」的直觉改回去）：
// 1. **步长按语法树取**（上一同级项的内容列 − 本项 marker 列）：固定 2 空格对有序列表不构成嵌套
//   （真 lezer 实测：`1. a` + `\n  2. b` 仍是同层兄弟项，要 3 空格；`10. b` 之下要 4 空格）——
//    照固定 2 实现，TAB 在有序列表上只留下不可见的空白 diff，D2c 的「按新归属重排」也就没有对象。
// 2. **缩进侧无可嵌套的父项**（本项是所在列表的第一项）时无操作：没有父项可嵌，写入只会留下
//    不可见空白（与 D4c 被否决的同一理由，对称于 D3a 的顶层凸排无操作）。
// 3. **有序编号按新归属重排**（D2c）：受影响的两个分组（被平移项的原分组、它落入的新分组）内
//    的有序项一律改写为 1 起递增的规范序号。代价如实记录：源文件里本来不规范的编号会被顺带
//    规范化，因此「TAB 再 SHIFT+TAB」对这类源文件不逐字节回到原样（见最后一组用例）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { history, undo } from "@codemirror/commands";
import { listIndentChange } from "../../src/list-indent.ts";
import type { ListIndentDirection } from "../../src/list-indent.ts";

const MD = [markdown({ base: markdownLanguage, extensions: [GFM] })];

/** 真 EditorState + 真 markdown 解析器，光标落在 `needle` 首次出现处（+ offset）。 */
function stateAt(doc: string, needle: string, offset = 0): EditorState {
  const at = doc.indexOf(needle);
  assert.ok(at >= 0, `fixture 里找不到 ${JSON.stringify(needle)}`);
  return EditorState.create({ doc, extensions: MD }).update({ selection: { anchor: at + offset } }).state;
}

/** 一次平移后的文档全文；命令无操作（不 dispatch）时返回 null——与「动完正好等于原样」区分开。 */
function shifted(doc: string, needle: string, dir: ListIndentDirection, offset = 0): string | null {
  const state = stateAt(doc, needle, offset);
  const edit = listIndentChange(state, dir);
  if (edit === null) return null;
  return state.update({ changes: edit.changes }).state.doc.toString();
}

/** 断言一次平移的产物（`null` 期望写在这里，省得每条用例都判 no-op）。 */
function moved(doc: string, needle: string, dir: ListIndentDirection, expected: string | null, offset = 0): void {
  assert.equal(
    shifted(doc, needle, dir, offset),
    expected,
    `${JSON.stringify(doc)} 光标在 ${JSON.stringify(needle)} 上按 ${dir}`,
  );
}

// ---------------------------------------------------------------------------
// S1：归属项整体平移（首行 + 续行 + 子树）
// ---------------------------------------------------------------------------

test("TAB：无序项连同续行与子树整体平移一层（`- ` 的步长 = 2）", () => {
  moved("- a\n- b\n", "- b", "indent", "- a\n  - b\n");
  // 续行与子列表按同一 delta 平移：相对结构逐字节保持
  moved("- a\n  cont\n- b\n  cont2\n", "- b", "indent", "- a\n  cont\n  - b\n    cont2\n");
  moved("- a\n- b\n  - b1\n", "- b", "indent", "- a\n  - b\n    - b1\n");
  // 光标落在续行上同样归属本项（归属判定走语法树，不看光标是否在标记之后）
  moved("- a\n- b\n  cont2\n", "cont2", "indent", "- a\n  - b\n    cont2\n");
});

test("TAB：嵌套列表只动归属项（父项与前面的兄弟项逐字节不变）", () => {
  moved("- a\n  - b\n  - c\n", "- c", "indent", "- a\n  - b\n    - c\n");
  // 归属子项：父项那一行不动（缩进只落在 c 自己那一行）
  moved("- a\n  - b\n    - c\n", "- b", "indent", null); // b 是子列表第一项 ⇒ 无可嵌套父项
});

test("TAB：步长按 marker 的内容列取（`1.` / `9.` → 3 空格，`10.` → 4 空格）", () => {
  moved("1. x\n2. y\n", "2. y", "indent", "1. x\n   1. y\n");
  moved("9. a\n8. b\n", "8. b", "indent", "1. a\n   1. b\n"); // 3 空格；原分组与目标分组各自规范化
  moved("10. a\n2. b\n", "2. b", "indent", "1. a\n    1. b\n"); // `10. ` 内容列 4 ⇒ 4 空格
  // `10. ` 之下 3 空格嵌不进去（实测那是同层兄弟项）——上面那条因此必须是 4 空格
  moved("9. a\n10. b\n2. c\n", "2. c", "indent", "1. a\n2. b\n    1. c\n");
});

// ---------------------------------------------------------------------------
// S2 / D3a：凸排与到顶
// ---------------------------------------------------------------------------

test("SHIFT+TAB：凸排回祖先列表项所处的缩进层", () => {
  moved("- a\n  - b\n", "  - b", "outdent", "- a\n- b\n");
  // x 凸到 a 之后成为第 2 项、b 顺延为第 3 项（原分组位置变化的兄弟项一并重排）
  moved("1. a\n   1. x\n2. b\n", "   1. x", "outdent", "1. a\n2. x\n3. b\n");
  // 多缩了 2 个空格的子项一次回到顶层（不是机械减 2）
  moved("- a\n    - b\n", "    - b", "outdent", "- a\n- b\n");
  // 顶层项多余的行首空白（解析上仍是顶层项）顺带抹平，但分组没变 ⇒ 不改编号
  moved("9. a\n10. b\n   1. c\n", "   1. c", "outdent", "9. a\n10. b\n1. c\n");
});

test("无操作（D3a / D4a）：顶层凸排、无可嵌套父项、非列表行、代码块内、只读", () => {
  moved("- a\n- b\n", "- a", "outdent", null); // 已在顶层
  moved("- a\n- b\n", "- a", "indent", null); // 列表第一项：没有可嵌套的父项
  moved("1. a\n2. b\n", "1. a", "indent", null);
  moved("para\n\n- a\n", "para", "indent", null); // 段落
  moved("# 标题\n\n- a\n", "标题", "indent", null); // 标题
  moved("```\n1. a\n```\n", "1. a", "indent", null); // 围栏代码块内
  moved("> 引用段落\n", "引用", "indent", null); // 引用内但不是列表
  // 只读 state（非 md 文件的视图层口径）由 runner 提前返回（纯函数不管 readOnly）——
  // 那一半在 src/editor.ts 的 applyListIndent，本层测不到，归真机场景 43 与 chromium 场景。
});

// ---------------------------------------------------------------------------
// S5：引用内列表（插入 / 删除点在最内层 `>` 之后）
// ---------------------------------------------------------------------------

test("引用内列表：插入点在最内层 `>` 之后，步长同口径", () => {
  moved("> - a\n> - b\n", "> - b", "indent", "> - a\n>   - b\n");
  moved("> 1. a\n> 2. b\n", "> 2. b", "indent", "> 1. a\n>    1. b\n");
  moved("> > - a\n> > - b\n", "> > - b", "indent", "> > - a\n> >   - b\n");
  moved("> - a\n>   - b\n", ">   - b", "outdent", "> - a\n> - b\n");
  moved("> - a\n> - b\n", "> - a", "outdent", null); // 该层顶层：无空白可减
  moved("> - a\n> - b\n", "> - a", "indent", null); // 该层第一项：没有可嵌套的父项
  // 引用内嵌套列表（M138 口径：引用内列表与正文列表同一套装饰，编辑口径也同一套）
  moved("> - a\n>   - b\n>   - c\n", ">   - c", "indent", "> - a\n>   - b\n>     - c\n");
});

// ---------------------------------------------------------------------------
// D2c：有序列表编号按新归属重排
// ---------------------------------------------------------------------------

test("D2c：有序列表缩进后按新归属重排（含原分组位置前移的兄弟项）", () => {
  moved("1. a\n2. b\n3. c\n4. d\n", "3. c", "indent", "1. a\n2. b\n   1. c\n3. d\n");
  // 并入既有同型子列表（内层本来不规范的 `3.` 一并规范化）
  moved("1. a\n   3. x\n2. b\n", "2. b", "indent", "1. a\n   1. x\n   2. b\n");
  // 上一同级项的末子列表是异型列表：另起新列表（内层 `- x` 不动）
  moved("1. a\n   - x\n2. b\n", "2. b", "indent", "1. a\n   - x\n   1. b\n");
  // 父项 marker 更宽（`10. `）时，原分组与目标分组各自规范化
  moved("9. a\n10. b\n2. c\n", "2. c", "indent", "1. a\n2. b\n    1. c\n");
});

test("D2c：有序列表凸排后按新归属重排（原分组与祖先分组双向）", () => {
  moved("1. a\n   1. x\n   2. y\n2. b\n", "   1. x", "outdent", "1. a\n2. x\n   1. y\n3. b\n");
  moved("1. a\n   2. y\n2. b\n", "   2. y", "outdent", "1. a\n2. y\n3. b\n");
  // 分隔符沿用原标题（`)` 形态不被改写）
  moved("1) a\n2) b\n", "2) b", "indent", "1) a\n   1) b\n");
});

test("D2c 不越界：任务标记、标记字符、列表之外的行逐字节不变", () => {
  moved("- [ ] a\n- [x] b\n", "- [x] b", "indent", "- [ ] a\n  - [x] b\n");
  // 标记字符不换写（`*` 仍是 `*`，不因缩进被改写）
  moved("* a\n* b\n", "* b", "indent", "* a\n  * b\n");
  // 有序列表的编号重排只落在受影响的分组：子树内部的分组不动
  moved("1. a\n2. b\n", "2. b", "indent", "1. a\n   1. b\n");
  // 并入既有同型子列表：整组一起规范化（x/y 本来不规范，随并入一并改写）
  moved("1. a\n   5. x\n   6. y\n2. b\n", "2. b", "indent", "1. a\n   1. x\n   2. y\n   3. b\n");
});

// ---------------------------------------------------------------------------
// 单次 dispatch 的落点、往返与撤销
// ---------------------------------------------------------------------------

test("平移是单次 dispatch：一次 undo 还原整次平移（含子树与编号重排）", () => {
  const doc = "1. a\n2. b\n3. c\n4. d\n";
  let state = EditorState.create({ doc, extensions: [...MD, history()] }).update({
    selection: { anchor: doc.indexOf("3. c") + 2 },
  }).state;
  const edit = listIndentChange(state, "indent");
  assert.ok(edit !== null);
  state = state.update({ changes: edit.changes, userEvent: "input.indent" }).state;
  assert.equal(state.doc.toString(), "1. a\n2. b\n   1. c\n3. d\n");
  // 选区随 change mapping 平移（命令不显式重设）——光标仍在被平移项那一行内
  assert.equal(state.doc.lineAt(state.selection.main.head).number, 3, "光标应随行首插入右移、留在本项行内");
  const target = { state, dispatch: (tr: { state: EditorState }) => { state = tr.state; } };
  undo(target);
  assert.equal(state.doc.toString(), doc, "一次 undo 应还原整次平移（含子树与编号重排）");
});

test("往返：TAB 后 SHIFT+TAB 回到原源码（源文件编号本已规范时逐字节相同）", () => {
  for (const [doc, needle] of [
    ["- a\n- b\n  - b1\n", "- b"],
    ["1. a\n2. b\n3. c\n4. d\n", "3. c"],
    ["1. a\n   1. x\n2. b\n", "2. b"],
    ["> - a\n> - b\n", "> - b"],
    ["> 1. a\n> 2. b\n", "> 2. b"],
    ["- a\n  cont\n- b\n  cont2\n", "cont2"],
  ]) {
    const first = stateAt(doc, needle);
    const up = listIndentChange(first, "indent");
    assert.ok(up !== null, `${JSON.stringify(doc)}：TAB 应有产物`);
    const afterUp = first.update({ changes: up.changes }).state;
    const down = listIndentChange(afterUp, "outdent");
    assert.ok(down !== null, `${JSON.stringify(doc)}：SHIFT+TAB 应有产物`);
    assert.equal(afterUp.update({ changes: down.changes }).state.doc.toString(), doc);
  }
});

test("已知代价（D2c）：源文件编号本来不规范时，往返会停在规范化后的形态", () => {
  // 原稿 `1. a` / `   3. x` / `2. b`：TAB 让 b 并入内层分组，内层的 `3.` 被规范化为 `1.`
  const doc = "1. a\n   3. x\n2. b\n";
  const first = stateAt(doc, "2. b");
  const up = listIndentChange(first, "indent");
  assert.ok(up !== null);
  const afterUp = first.update({ changes: up.changes }).state;
  assert.equal(afterUp.doc.toString(), "1. a\n   1. x\n   2. b\n");
  const down = listIndentChange(afterUp, "outdent");
  assert.ok(down !== null);
  assert.equal(
    afterUp.update({ changes: down.changes }).state.doc.toString(),
    "1. a\n   1. x\n2. b\n",
    "凸排把 b 退回顶层后，内层已被规范化的 `1. x` 不回退成 `3. x`——规范化不可逆是 D2c 的既定代价",
  );
});
