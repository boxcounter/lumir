// M222 合同测试：doc-title 块与 block wrapper / 原生选区的共存不变量
//（rendering-defect-contract-first）。
//
// 缺陷背景一（M221 探针实证，证据在 test-results/m221/）：无 fm 时旧实现把 doc-title
// 块级 widget 放在 range(0)/side:-1；文档首行即 block wrapper 覆盖内容（表格 / 围栏代码块）
// 时，CM6 的 DOM 构建把 pos 0 处的 point decoration 收进 wrapper（updateBlockWrappers 的
// `cur.from <= this.pos`），wrapper tile 复用又要求 `wrap.from < this.pos`——widget 落在
// wrapper 内、wrapper 被劈成两段（@codemirror/view 的 addBlockWidget → getBlockPos）。
// 症状：.cm-lp-table-scroll / .cm-lp-codeblock-scroll 各变 2 个（双 tabindex 停靠点、
// 表格 grid 被 title 污染、title 被套代码块底板样式）。
//
// 缺陷背景二（M222 回归 2 探针实证，证据在 test-results/m222/probe-reg2-transient.json）：
// 有 fm 时旧实现把 doc-title 作为第二个块级 widget 钉在 fm.to——contentDOM 开头出现两个
// 相邻 ce=false 块（fm widget + doc-title widget），Chrome 原生 ← 塌缩（⌘A 后按 ←）在这种
// 拓扑下算不出落点而整体 no-op（selectionchange 零触发），CM 选区与 DOM 选区失同步。
// M218 前 fm 文档开头只有 fm widget 一个 ce=false 岛，所以当时绿。
//
// 修复形态（两缺陷共用一个约束：文档开头至多一个 ce=false 岛）：
// - 有 fm：doc-title 折叠进 FrontmatterWidget 的 outer（fm box 之后），不单独出装饰；
// - 无 fm：不走 CM 装饰（pos 0 不可能先于锚定同位的 block wrapper），由 `.cm-scroller`
//   顶部的真实 DOM 节点承担（docTitleTop）。
//
// 本层（Node 无 DOM，见 harness.ts 边界说明）钉装饰级/数据级不变量：
//   I1 落点判定唯一来源 docTitlePlacement：path 未定义 → "none"；有 fm → "after-frontmatter"；
//      无 fm → "document-top"。
//   I2 doc-title 不存在独立的装饰集函数（docTitleSet 已随折叠删除）：after-frontmatter
//      落点的数据由 docTitleForFrontmatter 供给、由 FrontmatterWidget 携带渲染；
//      无 fm / path 未定义一律 null。
//   I3 document-top 落点的数据（docTitleTopData）：无 fm 且 path 定义时齐全（标题/路径段/
//      行数/mtime），其余落点一律 null。
//   I4 FrontmatterWidget 的 title 字段进入 eq 比对（四元组逐位 + null 口径）——漏比对会让
//      CM 复用旧 DOM，mtime/行数段不刷新。
// DOM 层不变量（首行表格/围栏代码块时 .cm-lp-table-scroll / .cm-lp-codeblock-scroll 各恰 1 个；
// fm 文档 ⌘A→← 选区同步）归 chromium 结构层场景断言（tests/visual/scenes，M221 持有），
// 不在本层重复。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, Text } from "@codemirror/state";
import {
  detectFrontmatter,
  FrontmatterWidget,
  FRONTMATTER_HAS_TITLE_CLASS,
} from "../../src/preview/frontmatter.ts";
import * as docTitleModule from "../../src/preview/doc-title.ts";
import {
  DOC_TITLE_TOP_CLASS,
  docTitleForFrontmatter,
  docTitlePlacement,
  docTitleTopData,
} from "../../src/preview/doc-title.ts";
import type { PreviewContext } from "../../src/preview/livePreview.ts";

/** 测试用 PreviewContext：只有 doc-title 读的两个口有值，其余一律未接线。 */
function ctxFor(path: string | undefined, mtimeMs: number | null = null): PreviewContext {
  return {
    currentFilePath: () => path,
    attachmentProvider: () => null,
    wikilinkResolver: () => null,
    lightbox: () => null,
    fileMtime: () => mtimeMs,
  };
}

const FM_DOC = "---\ntitle: x\n---\nbody\n";

// ---------------------------------------------------------------------------
// I1 落点判定（唯一来源）
// ---------------------------------------------------------------------------

test("I1 落点判定：path × fm 网格", () => {
  const fm = detectFrontmatter(Text.of(FM_DOC.split("\n")));
  assert.ok(fm !== null, "fixture 应检出 fm");
  // path 未定义（未命名会话）：无标题可渲染，无落点。
  assert.equal(docTitlePlacement(undefined, fm), "none");
  assert.equal(docTitlePlacement(undefined, null), "none");
  // 有 fm：折叠进 fm widget 的 outer（不再有钉在 fm.to 的独立块级 widget——两个相邻
  // ce=false 块会让 Chrome 原生 ← 塌缩 no-op，回归 2）。
  assert.equal(docTitlePlacement("a/b.md", fm), "after-frontmatter");
  // 无 fm：文档首部——CM6 无法把块级 widget 排在锚定同位的 block wrapper 之前，
  // 落点由 scroller 级节点承担。
  assert.equal(docTitlePlacement("a/b.md", null), "document-top");
});

// ---------------------------------------------------------------------------
// I2 after-frontmatter 落点：无独立装饰集，数据由 fm widget 携带
// ---------------------------------------------------------------------------

test("I2 doc-title 不再有独立装饰集函数（折叠进 fm widget 后 docTitleSet 删除）", () => {
  assert.equal("docTitleSet" in docTitleModule, false);
  assert.equal("DocTitleWidget" in docTitleModule, false);
});

test("I2 有 fm + path：数据齐全且与输入一一对应", () => {
  const state = EditorState.create({ doc: FM_DOC });
  const fm = detectFrontmatter(state.doc);
  assert.ok(fm !== null);
  const data = docTitleForFrontmatter(state, ctxFor("Work/Sub/note.md", 1700000000000), fm);
  assert.ok(data !== null);
  assert.equal(data.title, "note");
  assert.equal(data.dir, "Work / Sub");
  assert.equal(data.lines, 5);
  assert.equal(data.mtimeMs, 1700000000000);
});

test("I2 path 未定义：不出数据（fm widget 不携带 title）", () => {
  const state = EditorState.create({ doc: FM_DOC });
  const fm = detectFrontmatter(state.doc);
  assert.ok(fm !== null);
  assert.equal(docTitleForFrontmatter(state, ctxFor(undefined), fm), null);
});

test("I2 mtime 未到达（pending）/取不到：mtimeMs 为 null", () => {
  const state = EditorState.create({ doc: FM_DOC });
  const fm = detectFrontmatter(state.doc);
  assert.ok(fm !== null);
  const data = docTitleForFrontmatter(state, ctxFor("a.md", null), fm);
  assert.ok(data !== null);
  assert.equal(data.mtimeMs, null);
});

// ---------------------------------------------------------------------------
// I3 document-top 落点的数据供给（scroller 级节点的内容源）
// ---------------------------------------------------------------------------

test("I3 无 fm + path：数据齐全且与输入一一对应", () => {
  const data = docTitleTopData(EditorState.create({ doc: "plain\nsecond" }), ctxFor("Work/Sub/note.md", 1700000000000));
  assert.ok(data !== null);
  assert.equal(data.title, "note");
  assert.equal(data.dir, "Work / Sub");
  assert.equal(data.lines, 2);
  assert.equal(data.mtimeMs, 1700000000000);
});

test("I3 其余落点一律 null：有 fm / path 未定义", () => {
  assert.equal(docTitleTopData(EditorState.create({ doc: FM_DOC }), ctxFor("a.md")), null);
  assert.equal(docTitleTopData(EditorState.create({ doc: "plain\n" }), ctxFor(undefined)), null);
});

test("I3 mtime 未到达（pending）/取不到：mtimeMs 为 null", () => {
  const data = docTitleTopData(EditorState.create({ doc: "plain\n" }), ctxFor("a.md", null));
  assert.ok(data !== null);
  assert.equal(data.mtimeMs, null);
});

// ---------------------------------------------------------------------------
// I4 FrontmatterWidget 的 title 携带与 eq 比对（数据级）
// ---------------------------------------------------------------------------

const TITLE_A = { title: "note", dir: "Work", lines: 3, mtimeMs: 1700000000000 };
const TITLE_B = { title: "note", dir: "Work", lines: 4, mtimeMs: 1700000000000 };

test("I4 title 进入 eq：null/null 相等，null/data 不等，数据逐位比对", () => {
  assert.ok(new FrontmatterWidget("x", false, null).eq(new FrontmatterWidget("x", false, null)));
  assert.ok(!new FrontmatterWidget("x", false, null).eq(new FrontmatterWidget("x", false, TITLE_A)));
  assert.ok(!new FrontmatterWidget("x", false, TITLE_A).eq(new FrontmatterWidget("x", false, null)));
  assert.ok(new FrontmatterWidget("x", false, TITLE_A).eq(new FrontmatterWidget("x", false, TITLE_A)));
  assert.ok(!new FrontmatterWidget("x", false, TITLE_A).eq(new FrontmatterWidget("x", false, TITLE_B)));
});

test("I4 title 字段原样保留（toDOM 的数据源，DOM 断言在场景层）", () => {
  assert.equal(new FrontmatterWidget("x", false, TITLE_A).title, TITLE_A);
  assert.equal(new FrontmatterWidget("x").title, null);
});

// class 取值固定（theme.ts 的选择器与它们逐一对应）。
test("scroller 在场态 class 与 fm 携带态 class 名固定", () => {
  assert.equal(DOC_TITLE_TOP_CLASS, "cm-lp-doc-title-top");
  assert.equal(FRONTMATTER_HAS_TITLE_CLASS, "cm-lp-frontmatter-has-title");
});
