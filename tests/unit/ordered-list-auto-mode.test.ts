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
import { bareListMarkerLine } from "../../src/preview/lists.ts";
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
// 证据 test-results/m529-probe/readings.md）。本组是属性测试：不变量 = 读回变更为
// 「纯插入 + 插入文本恰为裸 marker + 行首至光标恰为裸 marker（空项 marker 之后）」
// 时 MUST 被吞掉；其余读回形态 MUST NOT 被误吞。

/** 以「光标在文档末（或显式 pos）」构造真 Text，跑生产判定。 */
function dupInsertion(doc: string, text: string, pos?: number) {
  const state = EditorState.create({ doc, extensions: MD });
  const at = pos ?? doc.length;
  return isDuplicateMarkerInsertion(state.doc, at, at, text);
}

test("读回拦截：空项 marker 之后插入裸 marker MUST 判重复（有序同族）", () => {
  // 行首至光标恰为裸 marker（空列表项、光标在 marker 之后）+ 插入文本恰为裸 marker。
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

test("读回拦截：有内容行 / 行首 / 非纯插入 / 非 marker 文本 MUST NOT 判重复（放行面）", () => {
  const cases: Array<[label: string, doc: string, text: string, pos?: number]> = [
    ["插入文本带内容", "1. 甲项\n2. ", "3. 乙项"],
    ["单字符不是整串 marker", "1. 甲项\n2. ", "3"],
    ["光标在内容之后（行首至光标含内容）", "1. 甲项\n2. 丙项", "3. "],
    ["行首（行首至光标为空串）", "1. 甲项\n2. ", "3. ", 6],
    ["换行 + marker（纯 IME 续行形态，不兜）", "1. 甲项", "\n2. "],
    ["普通文本插入", "1. 甲项\n2. ", "x"],
    ["空串", "1. 甲项\n2. ", ""],
    ["段落行尾", "甲项段落", "1. "],
    ["文档首行空行", "", "1. "],
  ];
  for (const [label, doc, text, pos] of cases) {
    assert.equal(dupInsertion(doc, text, pos), false, `${label}：应放行`);
  }
  // 替换（from < to）不是纯插入，MUST 放行。
  const state = EditorState.create({ doc: "1. 甲项\n2. ", extensions: MD });
  assert.equal(isDuplicateMarkerInsertion(state.doc, 8, 9, "3. "), false, "替换变更：放行");
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
