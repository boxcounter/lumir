// 裸 marker 行（「1. 」/「- 」空标记行不被语法树认作列表）的列表编辑态合同单测
//（M461，change editor-ordered-list-auto-mode-on-marker）。
//
// 为什么这条判据能在本层测：判定只读「行文本 + 真 lezer 解析树」——
// `src/preview/lists.ts` 的 `bareListMarkerLine`（纯函数，与 `listLineInfo` 同一形态），
// Enter 行为跑的是生产键位命令体本体 `src/enter-indent.ts` 的 `enterWithAutoIndent`
//（与 tests/unit/enter-indent.test.ts 同一假 view 手法）。两处都是生产那一份判定，
// 不是复刻（REVIEW.md 「同一语义两处真源」条）。
//
// 缺陷背景（Alex 2026-10-12 dogfood 原话）：「当我输入『1. 』（注意：有空格）……时，
// 没有自动进入列表编辑模式，这不符合预期。」机制：空列表项按 CommonMark 不能打断
// 段落，`para\n1. ` 的行被解析为段落 lazy continuation——渲染层不认列表、Enter 续行
// 不生效。本文件的合同：该行在光标驻留时按列表项渲染（渲染层判定），Enter 分派
// 「空项退出 / 有内容续行」两态（命令层判定）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { bareListMarkerLine, markerTokenAtStart } from "../../src/preview/lists.ts";
import {
  enterWithAutoIndent,
  isDuplicateMarkerInsertion,
  swallowDuplicateMarkerInput,
  swallowNativeListBeforeInput,
} from "../../src/enter-indent.ts";
import type { EditorMode } from "../../src/bindings/EditorMode.ts";
import { completeTree } from "./syntax-tree.ts";

/** 与生产同一份解析配置（src/editor.ts 的 md 模式）。 */
const MD: Extension[] = [markdown({ base: markdownLanguage, extensions: [GFM] })];

/** 对 doc 的第 lineNumber 行跑生产判定；返回可断言的扁平形态（null = 非裸 marker 行）。
 *  先过 `completeTree`：`bareListMarkerLine` 吃的是 `syntaxTree` 快照（见 `syntax-tree.ts`）。 */
function detect(doc: string, lineNumber: number) {
  const state = completeTree(EditorState.create({ doc, extensions: MD }));
  const line = state.doc.line(lineNumber);
  const hit = bareListMarkerLine(syntaxTree(state), state.doc, line);
  if (hit === null) return null;
  return {
    marker: hit.marker,
    ordered: hit.ordered,
    number: hit.number,
    delimiter: hit.delimiter,
    prefix: hit.prefix,
    content: state.doc.sliceString(hit.contentFrom, line.to),
    // marker 的列（行内偏移），渲染层按它算悬挂缩进。
    markerColumn: hit.markerFrom - line.from,
  };
}

/**
 * 生产 Enter 命令体的假 view 驱动（与 tests/unit/enter-indent.test.ts 的 pressEnterAt
 * 同源）：真 EditorState + 真 parser，光标落在 pos；返回命令跑完后的全文与光标。
 * 状态先过 `completeTree`——`enterBareMarkerLine` 读 `syntaxTree` 快照（见 `syntax-tree.ts`）。
 */
function pressEnterAt(doc: string, pos: number, mode: EditorMode = "md") {
  const state = completeTree(EditorState.create({ doc, extensions: MD, selection: EditorSelection.cursor(pos) }));
  let next = state;
  let dispatches = 0;
  const view = {
    state,
    dispatch: (tr: { state: EditorState }) => {
      dispatches += 1;
      next = tr.state;
    },
  } as unknown as EditorView;
  const handled = enterWithAutoIndent(view, mode, true);
  return { handled, doc: next.doc.toString(), cursor: next.selection.main.head, dispatches };
}

function pressEnterAtEnd(doc: string) {
  return pressEnterAt(doc, doc.length);
}

// ---------------------------------------------------------------------------
// A. 判定：bareListMarkerLine 的命中与排除分布
// ---------------------------------------------------------------------------

test("判定：段落紧邻的空标记行命中（Alex 现场形态 para\\n1. ）", () => {
  const hit = detect("para\n1. ", 2);
  assert.ok(hit, "para 下一行的「1. 」应判为裸 marker 行");
  assert.equal(hit.marker, "1.");
  assert.equal(hit.ordered, true);
  assert.equal(hit.number, 1);
  assert.equal(hit.delimiter, ".");
  assert.equal(hit.prefix, "");
  assert.equal(hit.content, "");
});

test("判定：有内容但语法树不接管的有序行命中（非 1 起号不能打断段落）", () => {
  const hit = detect("para\n2. abc", 2);
  assert.ok(hit);
  assert.equal(hit.marker, "2.");
  assert.equal(hit.number, 2);
  assert.equal(hit.content, "abc");
});

test("判定：`1)` 分隔符、行首缩进、引用前缀三形态", () => {
  const paren = detect("para\n1) ", 2);
  assert.ok(paren);
  assert.equal(paren.delimiter, ")");
  const indented = detect("para\n  1. ", 2);
  assert.ok(indented);
  assert.equal(indented.prefix, "  ");
  assert.equal(indented.markerColumn, 2);
  const quoted = detect("> para\n> 1. ", 2);
  assert.ok(quoted, "引用内 lazy 形态应命中");
  assert.equal(quoted.prefix, "> ");
});

test("判定：语法树已认作列表项首行的形态 MUST NOT 命中（真源唯一，不许两层抢）", () => {
  // 空行之后 / 文档首行——lezer 把「1. 」解析成 OrderedList 的空项，既有渲染与
  // M399 退出行为已覆盖；裸 marker 判定 MUST NOT 把这些行也判进来（同语义两处真源
  // 会分叉，REVIEW.md 「同一语义两处真源」条）。
  assert.equal(detect("1. ", 1), null, "文档首行的「1. 」已被语法树接管");
  assert.equal(detect("para\n\n1. ", 3), null, "空行后的「1. 」已被语法树接管");
  assert.equal(detect("para\n\n- ", 3), null, "空行后的「- 」已被语法树接管");
  assert.equal(detect("- a\n- ", 2), null, "列表自身的空续项已被语法树接管");
  assert.equal(detect("> 1. ", 1), null, "引用内的「1. 」已被语法树接管");
});

test("判定：`- ` 紧接段落是 setext 标题下线，MUST NOT 命中（与 Obsidian 同口径）", () => {
  assert.equal(detect("para\n- ", 2), null, "「- 」作为 setext 下线被排除");
  assert.equal(detect("> para\n> - ", 2), null, "引用内的同形态同样被排除");
});

test("判定：`+ ` / `* ` 紧接段落命中（非 setext 字符，落到 lazy 段落）", () => {
  const plus = detect("para\n+ ", 2);
  assert.ok(plus);
  assert.equal(plus.ordered, false);
  assert.equal(plus.marker, "+");
  assert.ok(detect("para\n* ", 2), "「* 」同理");
});

test("判定：围栏代码块 / 缩进代码块内的 marker 形态 MUST NOT 命中", () => {
  assert.equal(detect("```\n1. \n```", 2), null, "围栏内是代码文本");
  assert.equal(detect("para\n\n    1. x", 3), null, "4 空格缩进代码块内");
});

test("判定：非 marker 行与病态形态 MUST NOT 命中", () => {
  assert.equal(detect("para\n12", 2), null, "无标记符");
  assert.equal(detect("para\n1.x", 2), null, "marker 后无空白");
  assert.equal(detect("para\n1234567890. ", 2), null, "超过 9 位不是合法有序标记");
  assert.equal(detect("para", 1), null);
});

// ---------------------------------------------------------------------------
// B. Enter 分派：空项退出（Obsidian 惯例）
// ---------------------------------------------------------------------------

test("Enter：裸空标记行退出——删标记留空行、光标在行首、不新增行", () => {
  const result = pressEnterAtEnd("para\n1. ");
  assert.equal(result.handled, true);
  assert.equal(result.doc, "para\n", "「1. 」被删去、行保留为空行");
  assert.equal(result.cursor, 5, "光标落在空行行首");
});

test("Enter：裸空标记行的无序同族（+ / *）与引用前缀形态同口径退出", () => {
  const plus = pressEnterAtEnd("para\n+ ");
  assert.equal(plus.doc, "para\n");
  const star = pressEnterAtEnd("para\n* ");
  assert.equal(star.doc, "para\n");
  const quoted = pressEnterAtEnd("> para\n> 1. ");
  assert.equal(quoted.doc, "> para\n> ", "引用前缀保留、只删 marker");
  assert.equal(quoted.cursor, 9, "光标落在引用前缀之后");
});

test("Enter：裸空标记行退出是一次撤销步（单事务）", () => {
  const result = pressEnterAtEnd("para\n1. ");
  assert.equal(result.dispatches, 1, "退出 MUST NOT 产生第二步撤销");
});

// ---------------------------------------------------------------------------
// C. Enter 分派：有内容续行（自动续下一序号 / 同标记）
// ---------------------------------------------------------------------------

test("Enter：非 1 起号的 lazy 有序行续行（序号 +1、分隔符沿用、引用/缩进前缀复用）", () => {
  const result = pressEnterAtEnd("para\n2. abc");
  assert.equal(result.handled, true);
  assert.equal(result.doc, "para\n2. abc\n3. ", "续下一序号");
  assert.equal(result.cursor, result.doc.length, "光标落在新 marker 之后");

  const paren = pressEnterAtEnd("para\n2) abc");
  assert.equal(paren.doc, "para\n2) abc\n3) ", "分隔符沿用 )");

  const quoted = pressEnterAtEnd("> para\n> 2. abc");
  assert.equal(quoted.doc, "> para\n> 2. abc\n> 3. ", "引用前缀复用");
});

test("Enter：有内容的裸 bullet 行续同标记（lazy 形态）", () => {
  const result = pressEnterAtEnd("para\n+ abc");
  assert.equal(result.handled, true);
  assert.equal(result.doc, "para\n+ abc\n+ ");
});

test("Enter：续行是一次撤销步（单事务）", () => {
  const result = pressEnterAtEnd("para\n2. abc");
  assert.equal(result.dispatches, 1);
});

// ---------------------------------------------------------------------------
// D. 回归钉：真实列表路径与只读会话逐字节不变
// ---------------------------------------------------------------------------

test("Enter：真实解析的列表项路径行为不被本 change 改动（空项退出 / 续行照旧）", () => {
  const exit = pressEnterAt("1. ", 3);
  assert.equal(exit.doc, "", "语法树接管的空项仍走 M399 退出");
  const cont = pressEnterAtEnd("1. uno\n2. dos");
  assert.equal(cont.doc, "1. uno\n2. dos\n3. ", "真实列表续行照旧");
});

test("Enter：只读会话里裸 marker 行 MUST NOT 产生文档变更", () => {
  const doc = "para\n1. ";
  const state = completeTree(EditorState.create({
    doc,
    extensions: [...MD, EditorState.readOnly.of(true)],
    selection: EditorSelection.cursor(doc.length),
  }));
  let next = state;
  const view = {
    state,
    dispatch: (tr: { state: EditorState }) => {
      next = tr.state;
    },
  } as unknown as EditorView;
  const handled = enterWithAutoIndent(view, "md", true);
  assert.equal(handled, false);
  assert.equal(next.doc.toString(), doc);
});

// ---------------------------------------------------------------------------
// E. IME 组合期不重复（M461②）：DOM 入口拒收 WebKit 原生自动列表
// ---------------------------------------------------------------------------

test("beforeinput 拦截：insertOrderedList / insertUnorderedList 被 preventDefault 且消费", () => {
  for (const inputType of ["insertOrderedList", "insertUnorderedList"]) {
    let prevented = 0;
    const consumed = swallowNativeListBeforeInput({
      inputType,
      preventDefault: () => {
        prevented += 1;
      },
    });
    assert.equal(consumed, true, `${inputType}：应消费事件`);
    assert.equal(prevented, 1, `${inputType}：应 preventDefault`);
  }
});

test("beforeinput 拦截：普通输入事件（insertText / 无 inputType）一律放行", () => {
  for (const inputType of ["insertText", "insertParagraph", "insertCompositionText", "deleteContentBackward"]) {
    assert.equal(swallowNativeListBeforeInput({ inputType }), false, `${inputType}：放行`);
  }
  assert.equal(swallowNativeListBeforeInput({}), false, "inputType 缺席：放行");
  // 放行事件 MUST NOT preventDefault（preventDefault 被调 = 拦截越界）。
  let prevented = 0;
  assert.equal(swallowNativeListBeforeInput({ inputType: "insertText", preventDefault: () => { prevented += 1; } }), false);
  assert.equal(prevented, 0);
});

// ---------------------------------------------------------------------------
// F. M529②：DOM 读回入口拒收裸 DOM 变更的重复 marker（inputHandler 层）
// ---------------------------------------------------------------------------
//
// 缺陷形态（Alex 2026-10-15 dogfood）：有序列表行末 Enter 后新行出现「2. 3.」——
// CM 键位续出「2. 」后，WebKit smart-list 又把下一序号作为**裸 DOM 文本**插进同一
// 光标位（M461② beforeinput 拒收名单不兜的形态，探针以等价注入复现落点形状，
// 证据 .local/probes/m529-probe/readings.md）。本组是属性测试：不变量 = 读回变更落在
// 该行行首 marker 的区域（marker 起点 → 内容起点）且会让行首多出 / 换掉一个 marker 时
// MUST 被吞掉；其余读回形态 MUST NOT 被误吞。落点与结果口径的来历（M753：marker 被
// widget 整段替换，落点可以是该区域里的任意一处）见下方 G 组。

/** 以「光标在文档末（或显式 pos）」构造真 Text，跑生产判定。 */
function dupInsertion(doc: string, text: string, pos?: number) {
  const state = EditorState.create({ doc, extensions: MD });
  const at = pos ?? doc.length;
  return isDuplicateMarkerInsertion(state.doc, at, at, text);
}

test("读回拦截：空项 marker 之后插入裸 marker MUST 判重复（有序同族）", () => {
  // 空列表项（光标在 marker 之后）+ 插入文本里带 marker token。
  const cases: Array<[label: string, doc: string, text: string]> = [
    ["有序 .（Alex 现场形态）", "1. 甲项\n2. ", "3. "],
    ["任意序号", "1. 甲项\n2. ", "9. "],
    ["多位序号", "8. 甲项\n9. ", "10. "],
    ["有序 ) 分隔符", "1) 甲项\n2) ", "3) "],
    ["无序同标记", "- 甲项\n- ", "- "],
    ["无序跨标记", "- 甲项\n- ", "* "],
    ["引用前缀（插入带前缀）", "> 1. 甲项\n> 2. ", "> 3. "],
    ["引用前缀（插入不带前缀）", "> 1. 甲项\n> 2. ", "3. "],
    ["行首缩进", "  1. 甲项\n  2. ", "3. "],
    ["尾随 tab", "1. 甲项\n2. ", "3.\t"],
    ["单项列表", "1. ", "2. "],
    ["裸 marker 行（lazy 形态，纯文本判定不读语法树，同口径吞）", "甲项\n1. ", "2. "],
  ];
  for (const [label, doc, text] of cases) {
    assert.equal(dupInsertion(doc, text), true, `${label}：应判重复`);
  }
});

test("读回拦截：内容区 / 无 marker 行 / 逐字符键入 MUST NOT 判重复（放行面）", () => {
  const cases: Array<[label: string, doc: string, text: string, pos?: number]> = [
    ["单字符不是 marker token", "1. 甲项\n2. ", "3"],
    ["光标在内容之后（行首至光标含内容）", "1. 甲项\n2. 丙项", "3. "],
    ["换行 + marker（纯 IME 续行形态，不兜）", "1. 甲项", "\n2. "],
    ["普通文本插入", "1. 甲项\n2. ", "x"],
    ["空串", "1. 甲项\n2. ", ""],
    ["段落行尾", "甲项段落", "1. "],
    ["文档首行空行", "", "1. "],
  ];
  for (const [label, doc, text, pos] of cases) {
    assert.equal(dupInsertion(doc, text, pos), false, `${label}：应放行`);
  }
  // 替换（from < to）：落点判据与插入同口径——落在**内容区**才放行。M753 之前这里断言的是
  // 「替换一律放行」，其样例 (8, 9) 替换的正是 marker 的尾随空格，本身就是逃逸形状之一
  // （替换后该行变成「2. 3. 」），因此改成内容区样例。
  const state = EditorState.create({ doc: "1. 甲项\n2. 乙项", extensions: MD });
  assert.equal(isDuplicateMarkerInsertion(state.doc, 10, 11, "3. "), false, "内容区替换成 marker 形文本：放行");
  assert.equal(isDuplicateMarkerInsertion(state.doc, 9, 11, "丙"), false, "内容区普通替换：放行");
});

test("读回拦截：命中时吞掉 = 零 dispatch、文档逐字节不变（inputHandler 行为）", () => {
  // 不变量：吞掉路径 MUST NOT 产生任何文档变更 / 撤销步——键位层仍是唯一合法续行来源。
  const doc = "1. 甲项\n2. ";
  const state = completeTree(EditorState.create({ doc, extensions: MD, selection: EditorSelection.cursor(doc.length) }));
  let dispatches = 0;
  const view = {
    state,
    dispatch: () => {
      dispatches += 1;
    },
  } as unknown as EditorView;
  const swallowed = swallowDuplicateMarkerInput(view, doc.length, doc.length, "3. ");
  assert.equal(swallowed, true, "重复 marker 读回应被吞");
  assert.equal(dispatches, 0, "吞掉 MUST NOT dispatch（无文档变更、无撤销步）");
  const passed = swallowDuplicateMarkerInput(view, doc.length, doc.length, "丙");
  assert.equal(passed, false, "普通读回放行走默认插入");
});

test("读回拦截：真实列表续行路径逐字节不回归（CM 自己的续行不被误伤）", () => {
  // 防回归：键位层的合法续行产出「2. 」空项后，若再有 marker 读回才判重复；
  // 键位层本身 MUST NOT 经过 inputHandler（dispatch 不经 DOM 读回）。
  const result = pressEnterAtEnd("1. 甲项");
  assert.equal(result.doc, "1. 甲项\n2. ", "Enter 续行照旧（键位层唯一合法路径）");
  assert.equal(result.handled, true);
  // 续行后的空项上，WebKit 裸插入下一序号 ⇒ 判重复（防御二次叠加）。
  assert.equal(dupInsertion(result.doc, "3. "), true);
});

// ---------------------------------------------------------------------------
// G. M753：判据按**结果行**判，不按读回的编码判（marker 被 widget 替换后，裸 DOM 变更
//    的落点不再恰好是内容起点）
// ---------------------------------------------------------------------------
//
// 缺陷形态（Alex 2026-10-27 dogfood，经 tower 更正的现场）：「1. xxxxxxx」行末 Enter 后，
// 第二行是**「2. 3. 」**——正常续行的「2. 」之外多出「3. 」，M529 的老问题复发。（tower
// 2026-10-27 更正：不是「新行只有 3. 」；「只剩 3. 」那种序号被覆写的形态仍属同一家族，
// 本组一并覆盖，但它不是主现场。）
//
// 为什么 M529 的判据兜不住：它把落点钉死成「纯插入 + 插入点恰在内容起点 + 行首至插入点
// 恰为一个裸 marker」。而列表 marker 在 DOM 里是被 widget **整段替换**的
// （`src/preview/lists.ts` 的 ListLayout：`[行首, 内容起点)` 连尾随空白一起换成
// ListMarker widget，DOM 里已没有「2. 」这串文本）。WebKit 的裸插入落在 widget 邻位时，
// CM 的 DOM 读回按最小 diff 映射出来的落点可以是 marker **区内**、覆盖 marker 区的
// 替换、或夹带一个前排空白——全都不满足「插入点 == 内容起点」，于是从那条缝里逃逸。
//
// 不变量（本组钉住）：读回变更落在该行**行首 marker 的区域**（marker 起点 … 内容起点，
// 含替换形态）且插入文本里带 marker token 时，若把变更套进该行会让行首 marker **变样**
// （不再是 marker、字面被换掉、或 marker 之后紧跟另一个 marker），MUST 丢弃；区域之外
// （内容里、无 marker 的行）与逐字符键入 MUST NOT 被误吞。按结果判而不是按编码判，
// 是为了不再随 WebKit 的具体落点形状漏一种。

/** 用例里显式写死落点，不用生产判定算位置：断言与被测判定互为独立证据
 *  （REVIEW.md「假绿」条——用被测实现推导期望值等于自己证明自己）。 */
test("读回拦截：marker 区内的各种读回编码只要造出重复序号 MUST 判重复（M753 逃逸形状）", () => {
  const cases: Array<[label: string, doc: string, from: number, to: number, text: string]> = [
    // doc = "1. 甲项\n2. "：第二行行首 6、marker 区 6..8、内容起点 9（widget 替换 6..9）
    ["内容起点纯插入（M529 现场形态，结果「2. 3. 」）", "1. 甲项\n2. ", 9, 9, "3. "],
    ["marker 区内插入（序号与分隔符之间，结果「2.3. 」）", "1. 甲项\n2. ", 7, 7, "3. "],
    ["marker 区内插入（分隔符与尾随空格之间，结果「2.3. 」）", "1. 甲项\n2. ", 8, 8, "3. "],
    ["覆盖 marker 区的替换（结果「2. 3. 」：widget 文本参与 diff 的形状）", "1. 甲项\n2. ", 6, 9, "2. 3. "],
    ["覆盖 marker 区的替换（序号被覆写，结果「3. 」）", "1. 甲项\n2. ", 6, 9, "3. "],
    ["只替换尾随空格（结果「2. 3. 」）", "1. 甲项\n2. ", 8, 9, " 3. "],
    ["行首插入（结果「3. 2. 」：marker 之前又来一个）", "1. 甲项\n2. ", 6, 6, "3. "],
    ["带内容的 marker 形批量插入（结果「2. 3. 乙项」）", "1. 甲项\n2. ", 9, 9, "3. 乙项"],
    // 引用前缀 / 行首缩进 / 嵌套引用：同一区域口径（行首 8、marker 区 10..12、内容起点 13）
    ["> 行：marker 区内插入", "> 1. 甲项\n> 2. ", 12, 12, "3. "],
    ["> 行：覆盖 marker 区的替换", "> 1. 甲项\n> 2. ", 8, 13, "> 3. "],
    ["缩进行：marker 区内插入", "  1. 甲项\n  2. ", 12, 12, "3. "],
    ["缩进行：覆盖 marker 区的替换", "  1. 甲项\n  2. ", 8, 13, "3. "],
    ["嵌套引用行：marker 区内插入", "1. 甲项\n> > 2. ", 12, 12, "3. "],
    ["无序 marker 区内插入", "- 甲项\n- ", 6, 6, "- "],
  ];
  for (const [label, doc, from, to, text] of cases) {
    const state = EditorState.create({ doc, extensions: MD });
    assert.equal(isDuplicateMarkerInsertion(state.doc, from, to, text), true, `${label}：应判重复`);
  }
});

test("读回拦截（属性）：任意序号 / 分隔符 / 前缀的续行行上，marker 区内插入与区域替换恒判重复", () => {
  // 不变量对 marker 的字面形态与前缀无关：判定只读「该行行首已有 marker」「变更是否落在
  // 它的区域」「套进去之后行首是否多出 / 换掉 marker」，不读具体序号 / 分隔符 / 前缀。
  const variants: Array<[label: string, marker: string, prefix: string]> = [
    ["单项续行「2. 」", "2.", ""],
    ["多位序号「10. 」", "10.", ""],
    ["分隔符「)」", "2)", ""],
    ["两空格缩进", "2.", "  "],
    ["引用前缀", "2.", "> "],
    ["嵌套引用前缀", "2.", "> > "],
  ];
  for (const [label, marker, prefix] of variants) {
    const doc = `1. 甲项\n${prefix}${marker} `;
    const markerFrom = 6 + prefix.length;
    const markerTo = markerFrom + marker.length;
    const contentFrom = doc.length;
    const state = EditorState.create({ doc, extensions: MD });
    const shapes: Array<[label: string, from: number, to: number, text: string]> = [
      ["marker 区内插入", markerTo, markerTo, "9. "],
      ["内容起点插入", contentFrom, contentFrom, "9. "],
      ["覆盖 marker 区的替换", 6, contentFrom, `${prefix}9. `],
    ];
    for (const [shape, from, to, text] of shapes) {
      assert.equal(
        isDuplicateMarkerInsertion(state.doc, from, to, text),
        true,
        `${label} × ${shape}：应判重复`,
      );
    }
  }
});

test("读回拦截：marker 区域之外与逐字符键入的读回 MUST 放行（不误吞正常编辑）", () => {
  const cases: Array<[label: string, doc: string, from: number, to: number, text: string]> = [
    ["内容中间的插入", "1. 甲项\n2. 乙项", 10, 10, "3. "],
    ["内容行行末的插入", "1. 甲项\n2. 乙项", 11, 11, "3. "],
    ["无 marker 的行上插入（段落）", "甲项\n乙项", 5, 5, "3. "],
    ["无 marker 的行上插入（文档首行）", "", 0, 0, "1. "],
    ["marker 区内单字符键入", "1. 甲项\n2. ", 8, 8, "9"],
    ["marker 区内中文组合提交", "1. 甲项\n2. ", 8, 8, "九"],
    ["内容起点插入一个字符", "1. 甲项\n2. ", 9, 9, "3"],
    ["内容起点插入的整串文本里 marker token 不在行首", "1. 甲项\n2. ", 9, 9, "见 3. 上文"],
    ["换行 + marker（整段续行，落在内容行尾不算重复）", "1. 甲项\n2. ", 9, 9, "\n3. "],
    ["marker 区替换成普通文本", "1. 甲项\n2. ", 6, 9, "乙项"],
  ];
  for (const [label, doc, from, to, text] of cases) {
    const state = EditorState.create({ doc, extensions: MD });
    assert.equal(isDuplicateMarkerInsertion(state.doc, from, to, text), false, `${label}：应放行`);
  }
});

test("读回拦截：M753 形状被吞时零 dispatch、文档逐字节不变（inputHandler 行为）", () => {
  const doc = "1. 甲项\n2. ";
  const state = completeTree(EditorState.create({ doc, extensions: MD, selection: EditorSelection.cursor(doc.length) }));
  let dispatches = 0;
  const view = {
    state,
    dispatch: () => {
      dispatches += 1;
    },
  } as unknown as EditorView;
  // marker 区内的插入（M753 新判据的形状）与覆盖 marker 区的替换都必须零变更。
  assert.equal(swallowDuplicateMarkerInput(view, 8, 8, "3. "), true, "marker 区内插入应被吞");
  assert.equal(swallowDuplicateMarkerInput(view, 6, 9, "3. "), true, "覆盖 marker 区的替换应被吞");
  assert.equal(dispatches, 0, "吞掉 MUST NOT dispatch（无文档变更、无撤销步）");
});

test("M753 回归：单项有序列表行末 Enter + 各形状重复 marker 读回，文档只留字面下一序号", () => {
  // 用户现场（tower 转达 Alex 的更正）：第一行「1. xxxxxxx」行末 Enter。期望第二行只有
  // 「2. 」，任何形状的重复 marker 读回都不得把它变成「2. 3. 」/「3. 」/「2.3. 」。
  const continued = pressEnterAtEnd("1. xxxxxxx");
  assert.equal(continued.doc, "1. xxxxxxx\n2. ", "续行只出一个新序号");
  const state = EditorState.create({ doc: continued.doc, extensions: MD });
  const markerFrom = continued.doc.indexOf("2. ");
  const at = continued.doc.length;
  // 一正：先证明「放行这条读回」确实产生 Alex 现场的「2. 3. 」——否则下面「吞掉了」
  // 是在一个造不出缺陷的输入上空转（REVIEW.md「假绿」条）。
  const leaked = state.update({ changes: { from: at, to: at, insert: "3. " } }).state.doc.toString();
  assert.equal(leaked, "1. xxxxxxx\n2. 3. ", "读回若放行 = 现场形态「2. 3. 」");
  // 一反：各形状都必须被判重复（inputHandler 吞掉 ⇒ 文档停在续行后的形态）。
  const shapes: Array<[label: string, from: number, to: number, text: string]> = [
    ["内容起点纯插入（产生「2. 3. 」）", at, at, "3. "],
    ["marker 区内插入（产生「2.3. 」）", markerFrom + 2, markerFrom + 2, "3. "],
    ["覆盖 marker 区的替换（产生「2. 3. 」）", markerFrom, at, "2. 3. "],
    ["覆盖 marker 区的替换（产生「3. 」）", markerFrom, at, "3. "],
  ];
  for (const [label, from, to, text] of shapes) {
    assert.equal(isDuplicateMarkerInsertion(state.doc, from, to, text), true, `${label}：应判重复`);
  }
});

// ---------------------------------------------------------------------------
// H. M753 r1 P2：marker token 识别与 markerTextAt 同一份语法 + 明确左边界
// ---------------------------------------------------------------------------
//
// 回归现场（reviewer r1 P2）：判据的粗筛曾用一条独立正则 `MARKER_TOKEN_IN_TEXT`
// （`/(?:\d{1,9}[.)]|[-+*])[ \t]/`）——既复制了 marker 语法（违反 living spec 的
// 「marker 语法与 markerTextAt 同一份，MUST NOT 另写一套」），又没有左边界：十位数字
// `1234567890. ` 会从第二位起命中「九位子串 + `.` + 空格」，于是把它当成合法 token，
// 接着在结果行判据里因「行首不再是 marker」被吞——非法序号因此能静默吃掉用户变更。
// 修法：token 识别下沉到 `src/preview/lists.ts` 的 `markerTokenAtStart`，直接复用
// `markerTextAt`（同一份 BARE_MARKER_RE），左边界取文本起点（DOM 读回里认的 token 只能
// 是浏览器塞进去那一段的开头）。`\d{1,9}` 后必须紧跟 `.` / `)`，十位数字因此不成 token。

test("marker token 识别：与 markerTextAt 同源、左边界为文本起点（十位数字不是 token）", () => {
  const tokens: string[] = ["3. ", "3)\t", "- ", "* ", "+ ", " 3. ", "> 3. ", "123456789. ", "0. "];
  for (const text of tokens) {
    assert.equal(markerTokenAtStart(text), true, `${JSON.stringify(text)}：应认作 token`);
  }
  const notTokens: string[] = [
    "1234567890. ", // 十位：\d{1,9} 后不是 . / ) ⇒ 非法，且右移一位的九位子串也不算
    "1234567890123. ",
    "\n3. ", // 换行开头不是本行的 marker（整段续行形态）
    "见 3. ", // token 不在文本起点 ⇒ 没有左边界内
    "3.乙", // marker 后没有空白
    "乙项",
    "",
  ];
  for (const text of notTokens) {
    assert.equal(markerTokenAtStart(text), false, `${JSON.stringify(text)}：MUST NOT 认作 token`);
  }
});

test("读回拦截：非法长序号的九位子串 MUST NOT 触发拦截（marker 区替换的误吞回归）", () => {
  const doc = "1. 甲项\n2. "; // 第二行行首 6、marker 区 6..8、内容起点 9
  const state = EditorState.create({ doc, extensions: MD });
  // 合法九位 marker：仍是「换掉序号」⇒ 按重复丢弃（一正）。
  const swallow: Array<[label: string, from: number, to: number, text: string]> = [
    ["合法九位序号替换 marker 区", 6, 9, "123456789. "],
    ["合法九位序号插在内容起点", 9, 9, "123456789. "],
  ];
  for (const [label, from, to, text] of swallow) {
    assert.equal(isDuplicateMarkerInsertion(state.doc, from, to, text), true, `${label}：应判重复`);
  }
  // 十位 / 更长数字不是合法 marker（CommonMark 上限 9 位）：MUST 放行（一反）。
  const pass: Array<[label: string, from: number, to: number, text: string]> = [
    ["十位数字替换 marker 区", 6, 9, "1234567890. "],
    ["十位数字插在内容起点", 9, 9, "1234567890. "],
    ["更长数字串替换 marker 区", 6, 9, "1234567890123. "],
    ["十位数字带内容替换 marker 区", 6, 9, "1234567890. 乙项"],
  ];
  for (const [label, from, to, text] of pass) {
    assert.equal(isDuplicateMarkerInsertion(state.doc, from, to, text), false, `${label}：应放行`);
  }
});
