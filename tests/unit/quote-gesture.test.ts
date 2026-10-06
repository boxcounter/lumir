// tests/unit/quote-gesture.test.ts — 摘录手势纯逻辑层（M344，change add-harness-quote-cards
// design §3 行范围与标题上下文 / §4 失锚降级链）。零 DOM：文档用真的 @codemirror/state Text
// 承载（tests/unit/README.md 的同一口径），标题输入用轻量结构替身（quoteContextOf 只读
// level/text/from 三样，与 toc 的 TocHeading 同构）。
//
// 断言纪律（REVIEW.md 第 1 条反向验证）：每个判据先在脑子里过一次「造什么输入它必须红」——
// 行号漂移 / 开头被改 / 摘录在首个标题前等反例都各有一条反向用例，不是只堆正向命中。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import {
  parseQuoteLines,
  quoteContextOf,
  quoteLinesOf,
  quotePrefixMatched,
  resolveQuoteAnchor,
} from "../../src/quote-gesture.ts";

/** doc（Text）工厂：state 只是拿 Text 的容器。 */
function docOf(content: string) {
  return EditorState.create({ doc: content }).doc;
}

test("quoteLinesOf：跨行选区产出 A-B，单行产出 A-A，越界返回 null", () => {
  const doc = docOf("zero\none\ntwo\nthree");
  // "one\ntwo"：line 2 行首到 line 3 行内。
  assert.equal(quoteLinesOf(doc, doc.line(2).from, doc.line(3).from + 1), "2-3");
  assert.equal(quoteLinesOf(doc, doc.line(2).from, doc.line(2).to), "2-2");
  // 反向验证：越界与空选区必须 null（取不到行范围不产出卡片）。
  assert.equal(quoteLinesOf(doc, -1, 3), null);
  assert.equal(quoteLinesOf(doc, 2, doc.length + 1), null);
  assert.equal(quoteLinesOf(doc, 5, 2), null);
});

test("parseQuoteLines：A-B / 单写 A / 非法形态", () => {
  assert.deepEqual(parseQuoteLines("9-10"), { start: 9, end: 10 });
  assert.deepEqual(parseQuoteLines(" 7 "), { start: 7, end: 7 });
  assert.equal(parseQuoteLines("b-2"), null);
  assert.equal(parseQuoteLines("3-1"), null); // end < start
  assert.equal(parseQuoteLines(""), null);
});

test("quotePrefixMatched：行尾追加与行截短都算命中，开头被改才失配，空摘录恒不命中", () => {
  assert.equal(quotePrefixMatched("先读结论再读论证——倒序阅读", "先读结论再读论证"), true); // 行尾追加
  assert.equal(quotePrefixMatched("先读结论", "先读结论再读论证"), true); // 行被截短
  assert.equal(quotePrefixMatched("先读结别的", "先读结论再读论证"), false); // 开头被改
  assert.equal(quotePrefixMatched("任何文本", ""), false);
});

test("quoteContextOf：完整标题链 + 最近一级标题，同级替换弹出更深的旧条目", () => {
  const headings = [
    { level: 1, text: "阅读工作流", from: 0 },
    { level: 2, text: "筛选", from: 10 },
    { level: 3, text: "倒序阅读", from: 20 },
    { level: 2, text: "复盘", from: 30 },
  ];
  // 第三个标题之下：完整链。
  assert.deepEqual(quoteContextOf(headings, 25), {
    heading: "倒序阅读",
    headingPath: "阅读工作流 › 筛选 › 倒序阅读",
  });
  // 「复盘」（H2）把「倒序阅读」（H3）弹出链——H3 不是其后摘录的祖先。
  assert.deepEqual(quoteContextOf(headings, 35), {
    heading: "复盘",
    headingPath: "阅读工作流 › 复盘",
  });
});

test("quoteContextOf：摘录在首个标题之前 → heading 与 headingPath 都是空串", () => {
  const headings = [{ level: 1, text: "第一章", from: 10 }];
  assert.deepEqual(quoteContextOf(headings, 5), { heading: "", headingPath: "" });
  // 反向验证：标题行自身之内（from 等于标题起点）不算「上方」。
  assert.deepEqual(quoteContextOf(headings, 10), { heading: "", headingPath: "" });
});

test("resolveQuoteAnchor 第一层：行号命中 + 原文前缀校验，返回行范围", () => {
  const doc = docOf("# 标题\nalpha\nbeta");
  const anchor = resolveQuoteAnchor(doc, { lines: "2-2", text: "alpha" });
  assert.deepEqual(anchor, { from: doc.line(2).from, to: doc.line(2).to });
});

test("resolveQuoteAnchor 第二层：行号漂移（行内容已改）→ 全文搜索原文字符串命中", () => {
  // 摘录后文档被编辑：第 2 行从 alpha 改成 gamma（行号校验失配），alpha 漂到第 4 行。
  const doc = docOf("# 标题\ngamma\nbeta\nalpha tail");
  const anchor = resolveQuoteAnchor(doc, { lines: "2-2", text: "alpha" });
  assert.deepEqual(anchor, { from: doc.line(4).from, to: doc.line(4).from + "alpha".length });
});

test("resolveQuoteAnchor 第二层：行号越界（文档改短）→ 全文搜索命中", () => {
  const doc = docOf("alpha");
  const anchor = resolveQuoteAnchor(doc, { lines: "8-9", text: "alpha" });
  assert.deepEqual(anchor, { from: 0, to: 5 });
});

test("resolveQuoteAnchor 第三层：行号失配且全文搜索不到 → null（调用方 toast 失锚）", () => {
  const doc = docOf("# 标题\ngamma\nbeta");
  assert.equal(resolveQuoteAnchor(doc, { lines: "2-2", text: "alpha" }), null);
  // 反向验证：空原文不命中任何位置（空串 indexOf 恒 0 的假命中被挡）。
  assert.equal(resolveQuoteAnchor(doc, { lines: "2-2", text: "" }), null);
});

test("resolveQuoteAnchor：摘录原文可含换行，整串命中（层一截短前缀 / 层二整串）", () => {
  const doc = docOf("head\nalpha\nbeta\ntail");
  const start = doc.line(2).from;
  const end = doc.line(3).to;
  const anchor = resolveQuoteAnchor(doc, { lines: "2-3", text: "alpha\nbeta" });
  assert.deepEqual(anchor, { from: start, to: end });
  // 层一的前缀校验对跨行原文同样成立：摘录被截短（层一仍按行号命中，不走层二）。
  assert.deepEqual(resolveQuoteAnchor(doc, { lines: "2-3", text: "alpha\nbe" }), { from: start, to: end });
});
