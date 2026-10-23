// frontmatter 光标的纯逻辑层（change cursor-visibility-oct23，合同 docs/specs/editor-caret.md
// 的 C3 / C4）。
//
// 这一层判的是**判定矩阵**，不是 DOM：`firstBodyLineStart` 的口径（含空 fm、`...` 闭合、
// 只有 fm 无正文、末空行）与 `frontmatterCaretSpecs` 的分流（边界 / 块内 / 块外 × 空 /
// 非空选区 × 垂直移动 / 普通事务 / 装载事务）。光标矩形的几何（高度 = 行盒）归
// tests/visual/scenes/m647-caret-geometry.spec.ts，真机手感归验收场景 228——两层不互相替代。
//
// 为什么钉在事务过滤器这一层：边界光标的四个入口（指针 / 键盘 / 装载 / 聚焦）里，
// goto-line 与程序化选区只体现为「一次事务」，过滤器是它们的唯一落点；在这里断言就是在
// 断言真实实现，而不是复述一份同义函数（REVIEW.md「断言等价于子串」条的反面）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, StateEffect } from "@codemirror/state";
import type { TransactionSpec } from "@codemirror/state";
import {
  detectFrontmatter,
  firstBodyLineStart,
  frontmatterBlockField,
  frontmatterCaretSpecs,
} from "../../src/preview/frontmatter.ts";
import { trustedLoad } from "../../src/editor-annotations.ts";

const WITH_BODY = "---\ntitle: T\n---\nbody\n";
const WITH_BLANK_AFTER = "---\ntitle: T\n---\n\n# H\n\nbody\n";
const FM_ONLY_NO_TRAILING = "---\ntitle: T\n---";
const FM_ONLY_TRAILING = "---\ntitle: T\n---\n";
const EMPTY_FM = "---\n---\n";
const DOT_CLOSE = "---\n...\n# H\n";
const NO_FM = "# plain\n\nbody\n";

/** 带 frontmatter 检测场与事务过滤器的 state（与 livePreview 装配的两件同形）。 */
function stateFor(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [frontmatterBlockField, EditorState.transactionFilter.of(frontmatterCaretSpecs)],
  });
}

function headOf(doc: string, spec: TransactionSpec): number {
  return stateFor(doc).update(spec).state.selection.main.head;
}

function rangeOf(doc: string, spec: TransactionSpec): { from: number; to: number } {
  const sel = stateFor(doc).update(spec).state.selection.main;
  return { from: sel.from, to: sel.to };
}

function fmOf(doc: string): { from: number; to: number } {
  const fm = detectFrontmatter(EditorState.create({ doc }).doc);
  assert.ok(fm, "fixture 必须带 frontmatter（检测不到 = 场景装置坏了）");
  return fm;
}

// ---------------------------------------------------------------------------
// firstBodyLineStart
// ---------------------------------------------------------------------------

test("firstBodyLineStart：正文紧邻闭围栏 → 正文首行行首", () => {
  const doc = EditorState.create({ doc: WITH_BODY }).doc;
  const fm = fmOf(WITH_BODY);
  assert.equal(doc.lineAt(fm.to + 1).text, "body");
  assert.equal(firstBodyLineStart(doc, fm), fm.to + 1);
});

test("firstBodyLineStart：闭围栏后是空行 → 空行行首（末空行仍有正常行高，M399）", () => {
  const doc = EditorState.create({ doc: WITH_BLANK_AFTER }).doc;
  const fm = fmOf(WITH_BLANK_AFTER);
  assert.equal(doc.lineAt(fm.to + 1).text, "");
  assert.equal(firstBodyLineStart(doc, fm), fm.to + 1);
});

test("firstBodyLineStart：只有 fm 且无尾换行 → null（没有可承载光标的下一行）", () => {
  const doc = EditorState.create({ doc: FM_ONLY_NO_TRAILING }).doc;
  assert.equal(firstBodyLineStart(doc, fmOf(FM_ONLY_NO_TRAILING)), null);
});

test("firstBodyLineStart：只有 fm 但带尾换行 → 末空行行首（不是 null）", () => {
  const doc = EditorState.create({ doc: FM_ONLY_TRAILING }).doc;
  const fm = fmOf(FM_ONLY_TRAILING);
  assert.equal(fm.to, doc.length - 1, "闭合围栏之后只有一个换行");
  assert.equal(firstBodyLineStart(doc, fm), doc.length);
});

test("firstBodyLineStart：空 fm（---/---）与 `...` 闭合都按同一口径", () => {
  for (const text of [EMPTY_FM, DOT_CLOSE]) {
    const doc = EditorState.create({ doc: text }).doc;
    const fm = fmOf(text);
    assert.equal(firstBodyLineStart(doc, fm), fm.to + 1, `${JSON.stringify(text)} 的正文首行是闭围栏下一行`);
  }
});

test("detectFrontmatter：无 fm 的文档不产生块（过滤器因此整体放行的前置）", () => {
  assert.equal(detectFrontmatter(EditorState.create({ doc: NO_FM }).doc), null);
});

// ---------------------------------------------------------------------------
// frontmatterCaretSpecs：边界 / 块内 / 块外 × 空 / 非空 × 来源
// ---------------------------------------------------------------------------

test("边界空光标 + 普通事务（goto-line / 程序化选区）→ 正文首行（有正文时）", () => {
  const { from, to } = fmOf(WITH_BODY);
  const body = from + "---\ntitle: T\n---\n".length;
  assert.equal(headOf(WITH_BODY, { selection: { anchor: from } }), body, "fm.from → 正文首行");
  assert.equal(headOf(WITH_BODY, { selection: { anchor: to } }), body, "fm.to → 正文首行");
});

test("边界空光标 + 垂直移动事务 → 块内一个字符（显露源码，C4）", () => {
  const { from, to } = fmOf(WITH_BODY);
  assert.equal(headOf(WITH_BODY, { selection: { anchor: from }, userEvent: "move.line.up" }), from + 1);
  assert.equal(headOf(WITH_BODY, { selection: { anchor: to }, userEvent: "move.line.down" }), to - 1);
});

test("没有正文行时：普通事务与垂直移动都推进块内（显露源码；只有末空行的档归 firstBodyLineStart）", () => {
  const { from, to } = fmOf(FM_ONLY_NO_TRAILING);
  assert.equal(headOf(FM_ONLY_NO_TRAILING, { selection: { anchor: from } }), from + 1);
  assert.equal(headOf(FM_ONLY_NO_TRAILING, { selection: { anchor: to } }), to - 1);
  assert.equal(headOf(FM_ONLY_NO_TRAILING, { selection: { anchor: to }, userEvent: "move.line.down" }), to - 1);
});

test("块内 / 块外的空光标一律原样放行（不把正常阅读位置顶走）", () => {
  const { from, to } = fmOf(WITH_BODY);
  assert.equal(headOf(WITH_BODY, { selection: { anchor: from + 2 } }), from + 2, "块内");
  assert.equal(headOf(WITH_BODY, { selection: { anchor: to + 3 } }), to + 3, "块外（正文）");
});

test("非空选区原样放行：显露由严格重叠负责，head 落在可见源码行", () => {
  const { from, to } = fmOf(WITH_BODY);
  const sel = rangeOf(WITH_BODY, { selection: { anchor: from, head: to } });
  assert.deepEqual(sel, { from, to }, "覆盖整块的选区不被过滤器改写");
  const partial = rangeOf(WITH_BODY, { selection: { anchor: from + 1, head: to - 2 } });
  assert.deepEqual(partial, { from: from + 1, to: to - 2 }, "块内部分选区同样不改写");
});

test("装载事务（trustedLoad）不被改写：装载路径自己放初始光标", () => {
  const { from } = fmOf(WITH_BODY);
  assert.equal(
    headOf(WITH_BODY, { selection: { anchor: from }, annotations: trustedLoad.of(true) }),
    from,
    "装载事务必须原样通过（否则「打开只有 fm 的文档」会立刻变成源码）",
  );
});

test("没有设置选区的事务（effects-only：滚动快照 / previewRefresh / 装饰刷新）原样放行", () => {
  // 现场（m647 场景实测）：装载事务把光标停在块起点之后，紧接着一条 effects-only 事务
  // （`tr.newSelection` 等于当前选区 = 块边界）曾被过滤器误判成「把光标放到边界」，
  // 于是打开只有 frontmatter 的文档会**自动**变成源码——不是 C3 要的行为。
  const ping = StateEffect.define<null>();
  const loaded = stateFor(FM_ONLY_NO_TRAILING).update({
    selection: { anchor: 0 },
    annotations: trustedLoad.of(true),
  }).state;
  assert.equal(loaded.selection.main.head, 0, "装载后停在块起点（未聚焦，不显露）");
  const afterEffects = loaded.update({ effects: ping.of(null) }).state;
  assert.equal(afterEffects.selection.main.head, 0, "effects-only 事务不得改写选区");
});

test("无 frontmatter 的文档：过滤器整体放行", () => {
  assert.equal(headOf(NO_FM, { selection: { anchor: 0 } }), 0);
});

test("过滤器不自我循环：规范化之后的落点再过一次事务不再移动", () => {
  const { from } = fmOf(WITH_BODY);
  const state = stateFor(WITH_BODY).update({ selection: { anchor: from } }).state;
  const body = state.selection.main.head;
  assert.notEqual(body, from, "第一次事务已把光标规范化到正文首行");
  assert.equal(state.update({ selection: { anchor: body } }).state.selection.main.head, body);
});
