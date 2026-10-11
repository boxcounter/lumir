// M447（change composer-emacs-nav）的模型层单测：停靠点序列与同形位归一等价类、移动 / 扩选、
// 词级 kill / kill-line / 转置的纯函数。零 DOM 环境直接驱动（tests/unit/README.md），
// 判据口径见 change 的 design §4 与 specs/harness 增量。
//
// 导航类命令的**共同不变量**：返回的落点是停靠点序列上的一步（不是编辑），且不触碰输入块序列
// ——生成器在下面的「导航不改块序列」用例里对每个移动函数断言入参逐字节不变（deepFreeze）。

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundaryCaretAt,
  composerCaretStops,
  killLineAtCaret,
  killWordBackward,
  killWordForward,
  moveCharBackward,
  moveCharForward,
  moveLineDown,
  moveLineEnd,
  moveLineStart,
  moveLineUp,
  moveWordBackward,
  moveWordForward,
  normalizeComposerCaret,
  transposeCharsAtCaret,
} from "../../src/harness-panel.ts";
import type { ComposerBlock } from "../../src/quote-card.ts";

type Caret = { block: number; offset: number };

const para = (text: string): ComposerBlock => ({ kind: "paragraph", text });
const card = (name = "c"): ComposerBlock => ({
  kind: "quote",
  card: { file: "synth.md", heading: "", headingPath: "", lines: "1-1", text: name },
});
const at = (block: number, offset: number): Caret => ({ block, offset });

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// 同形位归一等价类
// ---------------------------------------------------------------------------

test("M447 归一：段落非空末缘 → 后块前缘（末段 → 末尾之后）；卡片恒前缘；空段落不归一", () => {
  const blocks = [para("abc"), card(), para("de")];
  assert.deepEqual(normalizeComposerCaret(blocks, at(0, 3)), at(1, 0), "A 末缘 → 卡片前缘");
  assert.deepEqual(normalizeComposerCaret(blocks, at(0, 2)), at(0, 2), "段内偏移原样");
  assert.deepEqual(normalizeComposerCaret(blocks, at(1, 5)), at(1, 0), "卡片偏移恒 0");
  assert.deepEqual(normalizeComposerCaret(blocks, at(2, 2)), at(3, 0), "末段末缘 → 末尾之后");
  assert.deepEqual(normalizeComposerCaret(blocks, at(9, 9)), at(3, 0), "越界钳到末尾之后");
  assert.deepEqual(normalizeComposerCaret([para("")], at(0, 0)), at(0, 0), "空段落只有 offset 0，不归一");
});

test("M447 三个 DOM 形态归一到同一模型值（composer 元素锚 / 卡片锚 / 段落末文本节点）", () => {
  const blocks = [para("abc"), card()];
  // ① 选区锚在 composer 元素自身第 1 个块边界（boundaryCaretAt 的产物）
  const fromElement = boundaryCaretAt(1, blocks.length);
  // ② 选区锚在某张卡片元素内（caretFromDom 的卡片档）
  const fromCard = at(1, 0);
  // ③ 选区锚在段落末文本节点（caretFromDom 的段落档 → (i, len)）
  const fromParaEnd = at(0, 3);
  assert.deepEqual(fromElement, at(1, 0));
  assert.deepEqual(normalizeComposerCaret(blocks, fromElement), at(1, 0));
  assert.deepEqual(normalizeComposerCaret(blocks, fromCard), at(1, 0));
  assert.deepEqual(normalizeComposerCaret(blocks, fromParaEnd), at(1, 0));
});

// ---------------------------------------------------------------------------
// 停靠点序列：线性有序、相邻必不同类
// ---------------------------------------------------------------------------

test("M447 停靠点序列：小块全枚举下线性有序、相邻两点必不相同", () => {
  const cases: ComposerBlock[][] = [
    [para("")],
    [para("abc")],
    [para("ab\ncd")],
    [para("a\u{1F600}b")],
    [para("abc"), card()],
    [card()],
    [card(), card()],
    [card(), card(), card()],
    [para("abc"), card(), card(), para("de")],
    [card(), para(""), card()],
    [para("abc"), para("de")],
    [para("ab\ncd"), card()],
    [card(), para("ab")],
  ];
  for (const blocks of cases) {
    const stops = composerCaretStops(blocks);
    assert.ok(stops.length > 0, `停靠点为空：${JSON.stringify(blocks)}`);
    for (let i = 1; i < stops.length; i += 1) {
      const prev = stops[i - 1];
      const curr = stops[i];
      assert.notDeepEqual(curr, prev, `相邻停靠点同类：${JSON.stringify(blocks)} @${i}`);
      assert.ok(
        curr.block > prev.block || (curr.block === prev.block && curr.offset > prev.offset),
        `停靠点序列非线性有序：${JSON.stringify(blocks)} @${i}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 移动族
// ---------------------------------------------------------------------------

test("M447 ⌃F/⌃B：段内字符步进（代理对整体一步）、卡片一步跨过、两端无动作", () => {
  const emoji = [para("a\u{1F600}b")];
  assert.deepEqual(moveCharForward(emoji, at(0, 1)), at(0, 3), "代理对（emoji）整体一步");
  assert.deepEqual(moveCharBackward(emoji, at(0, 3)), at(0, 1));
  assert.deepEqual(moveCharForward(emoji, at(0, 2)), at(0, 2), "落在代理对中间的病态读数：无动作");

  const blocks = [para("abc"), card(), para("de")];
  assert.deepEqual(moveCharForward(blocks, at(0, 2)), at(1, 0), "段末 → 卡片前缘");
  assert.deepEqual(moveCharForward(blocks, at(1, 0)), at(2, 0), "卡片一步跨过 → 下一段前缘");
  assert.deepEqual(moveCharBackward(blocks, at(2, 0)), at(1, 0), "反向：跨回卡片前缘");
  assert.deepEqual(moveCharBackward(blocks, at(1, 0)), at(0, 2), "卡片前缘 ≡ 段落末缘 → 再退一个字符");
  assert.deepEqual(moveCharBackward(blocks, at(0, 0)), at(0, 0), "块首无动作");
  assert.deepEqual(moveCharForward(blocks, at(2, 2)), at(3, 0), "末尾之后可停靠");
  assert.deepEqual(moveCharForward(blocks, at(3, 0)), at(3, 0), "末尾之后再前进：无动作");
});

test("M447 相邻两张卡片：一步跨过一张、可原路返回", () => {
  const blocks = [card("A"), card("B"), para("x")];
  assert.deepEqual(moveCharBackward(blocks, at(2, 0)), at(1, 0), "回到第二张卡片前缘（两卡之间）");
  assert.deepEqual(moveCharBackward(blocks, at(1, 0)), at(0, 0), "回到第一张卡片前缘");
  assert.deepEqual(moveCharForward(blocks, at(0, 0)), at(1, 0), "两卡之间 = 后一张卡片前缘");
  assert.deepEqual(moveCharForward(blocks, at(1, 0)), at(2, 0));
});

test("M447 ⌃A/⌃E：段落内逻辑行行首 / 行尾；卡片边界位无动作", () => {
  const blocks = [para("ab\ncde\nf")];
  assert.deepEqual(moveLineStart(blocks, at(0, 5)), at(0, 3), "第二行行首");
  assert.deepEqual(moveLineEnd(blocks, at(0, 4)), at(0, 6), "第二行行尾");
  assert.deepEqual(moveLineStart(blocks, at(0, 3)), at(0, 3), "已在行首：不动");
  const withCard = [card(), para("hi")];
  assert.deepEqual(moveLineStart(withCard, at(0, 0)), at(0, 0), "卡片前缘无行语义：不动");
  assert.deepEqual(moveLineEnd(withCard, at(0, 0)), at(0, 0));
});

test("M447 ⌃N/⌃P：逻辑行步进（同列位、超出取行尾）、跨段跳过卡片、无邻块无动作", () => {
  const blocks = [para("ab\ncdef"), card(), para("xy\nz")];
  assert.deepEqual(moveLineDown(blocks, at(0, 1)), at(0, 4), "同列位下移一行（列 1 → 行首 +1）");
  assert.deepEqual(moveLineUp(blocks, at(0, 4)), at(0, 1));
  // 出段落：跨到相邻段落块（中间那张卡片不产生停靠行）。
  assert.deepEqual(moveLineDown(blocks, at(0, 4)), at(2, 1), "跨过卡片落到相邻段落同列位");
  assert.deepEqual(moveLineUp(blocks, at(2, 1)), at(0, 4), "反向跨回");
  assert.deepEqual(moveLineDown(blocks, at(2, 3)), at(2, 3), "末段最后一行再下移：无相邻段落，不动");
  const single = [para("ab"), card()];
  assert.deepEqual(moveLineDown(single, at(0, 1)), at(0, 1), "无相邻段落：下移不动");
  assert.deepEqual(moveLineUp(single, at(0, 1)), at(0, 1), "无相邻段落：上移不动");
});

test("M447 ⌥F/⌥B 扩选 head：按词一步（与编辑器侧共用词边界口径）", () => {
  const blocks = [para("alpha beta  gamma")];
  assert.deepEqual(moveWordForward(blocks, at(0, 0)), at(0, 5), "从词首到词尾");
  assert.deepEqual(moveWordForward(blocks, at(0, 5)), at(0, 10), "跳过空白到下一词尾");
  assert.deepEqual(moveWordBackward(blocks, at(0, 11)), at(0, 6), "回到词首");
  assert.deepEqual(moveWordBackward(blocks, at(0, 0)), at(0, 0), "词首再退：无动作");
});

// ---------------------------------------------------------------------------
// 删除族 / kill-yank / 转置
// ---------------------------------------------------------------------------

test("M447 ⌥D / ⌥⌫：词级 kill 不跨块（段边界处无动作），段内按词边界", () => {
  const blocks = [para("alpha beta"), card("A")];
  const fwd = killWordForward(blocks, at(0, 0));
  assert.ok(fwd !== null);
  assert.equal(fwd.killed, "alpha");
  assert.deepEqual(fwd.blocks[0], para(" beta"));
  assert.deepEqual(fwd.caret, at(0, 0));
  // 段末（末尾之后）：前向词级 kill 无动作——MUST NOT 跨块删到下一块。
  assert.equal(killWordForward(blocks, at(1, 0)), null, "卡片前缘前向 kill：不跨块");
  const bwd = killWordBackward(blocks, at(0, 10));
  assert.ok(bwd !== null);
  assert.equal(bwd.killed, "beta");
  assert.deepEqual(bwd.blocks[0], para("alpha "));
  // 不跨块不变量：段边界处无动作、块序列逐字节不变。
  const before = JSON.stringify(blocks);
  assert.equal(killWordForward(blocks, at(0, 10)), null, "段末前向词级 kill：无动作");
  assert.equal(killWordBackward(blocks, at(0, 0)), null, "段首后向词级 kill：无动作");
  assert.equal(JSON.stringify(blocks), before);
});

test("M447 ⌃K：kill 到逻辑行行尾 / 行尾时杀行界 / 段末行尾无动作（不跨块）", () => {
  const k0 = killLineAtCaret([para("abc")], at(0, 0));
  assert.ok(k0 !== null);
  assert.equal(k0.killed, "abc");
  assert.deepEqual(k0.blocks[0], para(""));
  assert.equal(killLineAtCaret([para("abc")], at(0, 3)), null, "段落末行行尾：不跨块、无动作");
  const merged = killLineAtCaret([para("ab\ncd")], at(0, 2));
  assert.ok(merged !== null);
  assert.equal(merged.killed, "\n");
  assert.deepEqual(merged.blocks[0], para("abcd"), "行尾杀行界 = 段内合并两行");
  const mid = killLineAtCaret([para("ab\ncd")], at(0, 0));
  assert.ok(mid !== null);
  assert.equal(mid.killed, "ab");
  assert.deepEqual(mid.blocks[0], para("\ncd"));
});

test("M447 ⌃T：段内转置（光标落右端）；段首 / 卡片边界无动作；段尾与编辑器侧同形", () => {
  const t = transposeCharsAtCaret([para("abc")], at(0, 1));
  assert.ok(t !== null);
  assert.deepEqual(t.blocks[0], para("bac"));
  assert.deepEqual(t.caret, at(0, 2));
  assert.equal(transposeCharsAtCaret([para("abc")], at(0, 0)), null, "段首无动作");
  assert.equal(transposeCharsAtCaret([card(), para("abc")], at(0, 0)), null, "卡片边界无动作");
  const tail = transposeCharsAtCaret([para("abc")], at(0, 3));
  assert.ok(tail !== null);
  assert.deepEqual(tail.blocks[0], para("acb"), "段尾：转置末两个簇（与编辑器侧同形）");
});

// ---------------------------------------------------------------------------
// 导航不是编辑
// ---------------------------------------------------------------------------

test("M447 导航不改块序列：全部移动函数在冻结入参上返回，且块序列逐字节不变", () => {
  const moves = [
    moveCharForward,
    moveCharBackward,
    moveLineStart,
    moveLineEnd,
    moveLineDown,
    moveLineUp,
    moveWordForward,
    moveWordBackward,
  ];
  const cases: ComposerBlock[][] = [
    [para("ab\ncd")],
    [para("abc"), card(), para("de")],
    [card(), card(), para("x")],
    [para(""), card(), para("y")],
  ];
  for (const blocks of cases) {
    const frozen = deepFreeze(blocks.map((b) => ({ ...b })));
    const before = JSON.stringify(frozen);
    const carets: Caret[] = [at(0, 0), at(0, 1), at(1, 0), at(2, 1), at(3, 0)];
    for (const caret of carets) {
      for (const move of moves) {
        const next = move(frozen, caret);
        assert.ok(Number.isInteger(next.block) && Number.isInteger(next.offset));
      }
    }
    assert.equal(JSON.stringify(frozen), before, "导航函数改动了块序列（MUST NOT）");
  }
});
