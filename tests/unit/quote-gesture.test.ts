// tests/unit/quote-gesture.test.ts — 摘录手势纯逻辑层（M344，change add-harness-quote-cards
// design §3 行范围与标题上下文 / §4 失锚降级链）。零 DOM：文档用真的 @codemirror/state Text
// 承载（tests/unit/README.md 的同一口径），标题输入用轻量结构替身（quoteContextOf 只读
// level/text/from 三样，与 toc 的 TocHeading 同构）。
//
// 断言纪律（REVIEW.md 「断言等价于子串」条反向验证）：每个判据先在脑子里过一次「造什么输入它必须红」——
// 行号漂移 / 开头被改 / 摘录在首个标题前等反例都各有一条反向用例，不是只堆正向命中。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import {
  GESTURE_SETTLE_MS,
  caretButtonAnchor,
  clampGestureButton,
  gestureTimingVisible,
  idleGestureTiming,
  parseQuoteLines,
  quoteContextOf,
  quoteLinesOf,
  quotePrefixMatched,
  quoteTextWithoutImages,
  reduceGestureTiming,
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

// --- 选区里「只有图片」的判据（change add-image-quote-to-chat 的 D4） -----------------------

test("quoteTextWithoutImages：选区恰好覆盖图片源码 ⇒ 剩余为空（D4 不造空卡片）", () => {
  const doc = "前言\n\n![[a.png]]\n\n后记";
  const from = doc.indexOf("![[");
  const text = "![[a.png]]";
  assert.equal(quoteTextWithoutImages(text, from, [{ from, to: from + text.length }]), "");
  // 候选边界的空白（行首缩进 / 行尾换行）同样视为「没有文字」——调用方按 trim 判空。
  const padded = "  ![[a.png]]\n";
  assert.equal(
    quoteTextWithoutImages(padded, 0, [{ from: 2, to: 2 + text.length }]).trim(),
    "",
  );
});

test("quoteTextWithoutImages：图文混选保留文字、剥掉图片源码，且与 span 顺序无关", () => {
  const doc = "首 ![x](a.png) 并 ![[b.png]] 尾";
  const from = 0;
  const text = doc;
  const spans = [
    { from: doc.indexOf("![[b.png]]"), to: doc.indexOf("![[b.png]]") + "![[b.png]]".length },
    { from: doc.indexOf("![x]"), to: doc.indexOf("![x]") + "![x](a.png)".length },
  ];
  // 乱序输入（真实 collectImageRefs 已排序，这里验证函数自身不依赖顺序）。
  assert.equal(quoteTextWithoutImages(text, from, spans), "首  并  尾");
  // 反向验证：不剥 span 时同一段文字里明显有图片源码。
  assert.ok(text.includes("![x](a.png)"));
});


// --- 浮动钮时机门（M541：选区完成后才出现；编辑器手势与 transcript 手势共用的纯状态机） --------

test("时机门：拖拽中不出现（选区变化不排期），mouseup 后立刻出现", () => {
  let s = idleGestureTiming;
  // 鼠标按下进入拖拽；期间的选区变化只记录有效性、不排期——任意时刻都不可见。
  s = reduceGestureTiming(s, { kind: "mouse-down" }, 1000);
  s = reduceGestureTiming(s, { kind: "selection-change", valid: true }, 1010);
  assert.equal(s.revealAt, null);
  assert.equal(gestureTimingVisible(s, 10_000), false);
  assert.equal(gestureTimingVisible(s, 1_000_000), false);
  // 反向验证：松开即出（revealAt=mouseup 时刻，不附加 SETTLE 延迟）。
  s = reduceGestureTiming(s, { kind: "mouse-up" }, 1020);
  assert.equal(gestureTimingVisible(s, 1020), true);
});

test("时机门：键盘选区静默 GESTURE_SETTLE_MS 后才出现，连续变化把揭示时刻推后", () => {
  let s = idleGestureTiming;
  s = reduceGestureTiming(s, { kind: "selection-change", valid: true }, 5000);
  assert.equal(gestureTimingVisible(s, 5000 + GESTURE_SETTLE_MS - 1), false, "落定窗口内不出现");
  assert.equal(gestureTimingVisible(s, 5000 + GESTURE_SETTLE_MS), true, "静默满窗口即出现");
  // shift+方向键连续扩展：revealAt 被推到最后一次变化 + 窗口。
  s = reduceGestureTiming(s, { kind: "selection-change", valid: true }, 5000 + 100);
  assert.equal(gestureTimingVisible(s, 5000 + GESTURE_SETTLE_MS), false, "变化后旧时刻不再到期");
  assert.equal(gestureTimingVisible(s, 5000 + 100 + GESTURE_SETTLE_MS), true);
});

test("时机门：选区清空 / 移出即消失，且不排期", () => {
  let s = idleGestureTiming;
  s = reduceGestureTiming(s, { kind: "selection-change", valid: true }, 0);
  s = reduceGestureTiming(s, { kind: "selection-change", valid: false }, 100);
  assert.equal(s.revealAt, null);
  assert.equal(s.selectionValid, false);
  assert.equal(gestureTimingVisible(s, 1_000_000), false);
});

test("时机门：鼠标按下会掐掉既有的待浮现；松开时选区已无效则不出", () => {
  // 键盘选区已落定、钮已在场（或排期中）：重新按下拖拽立即隐藏。
  let s = idleGestureTiming;
  s = reduceGestureTiming(s, { kind: "selection-change", valid: true }, 0);
  s = reduceGestureTiming(s, { kind: "mouse-down" }, GESTURE_SETTLE_MS);
  assert.equal(gestureTimingVisible(s, GESTURE_SETTLE_MS), false, "按下瞬间即藏，不等到抬起");
  // 反向验证：拖拽落空（抬起时无有效选区）不出现。
  s = reduceGestureTiming(s, { kind: "selection-change", valid: false }, GESTURE_SETTLE_MS + 50);
  s = reduceGestureTiming(s, { kind: "mouse-up" }, GESTURE_SETTLE_MS + 100);
  assert.equal(s.revealAt, null);
  assert.equal(gestureTimingVisible(s, GESTURE_SETTLE_MS + 100), false);
});

// --- 浮动钮落点（M541：光标侧锚点 + M531 钳制） ------------------------------------------------

test("caretButtonAnchor：光标矩形右下 + 边距为候选落点（就近光标旁边）", () => {
  // 零宽光标矩形（right 即光标 x）。
  assert.deepEqual(caretButtonAnchor({ left: 100, right: 100, top: 40, bottom: 56 }), { left: 104, top: 60 });
  assert.deepEqual(caretButtonAnchor({ left: 30, right: 57, top: 8, bottom: 24 }), { left: 61, top: 28 });
});

test("clampGestureButton：越界钳进可视带、带内不动、容器比钮窄时下界优先", () => {
  const band = { left: 0, top: 0, width: 400, height: 300 };
  const size = { width: 80, height: 20 };
  // 右 / 下越界：钳到 带缘 - 钮宽(高) - 边距。
  assert.deepEqual(clampGestureButton({ left: 390, top: 295 }, size, band), {
    left: 400 - 80 - 4,
    top: 300 - 20 - 4,
  });
  // 左 / 上越界：抬到下界（带缘 + 边距）。
  assert.deepEqual(clampGestureButton({ left: -50, top: -10 }, size, band), { left: 4, top: 4 });
  // 带内不动。
  assert.deepEqual(clampGestureButton({ left: 100, top: 100 }, size, band), { left: 100, top: 100 });
  // 容器比钮窄：maxLeft 塌缩回 minLeft（贴左缘，宁可溢出也不反向越界）。
  const narrow = { left: 0, top: 0, width: 30, height: 300 };
  assert.deepEqual(clampGestureButton({ left: 500, top: 10 }, size, narrow), { left: 4, top: 10 });
});
