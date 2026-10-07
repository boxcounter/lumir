// harness hint 文案与 pane 字号步进的单测（M378，harness panel hint fix and Cmd zoom）：
//   - hint 两行带值形态的文案插值（D395 第一行 context window usage、D401 第二行
//     cache hit rate，zh/en 双档，{ctx} / {cache} 取当时实际读数——Alex 2026-10-07
//     「比如 context window usage: 12%. cache hit rate: 54%……按照这个『清晰简洁』的思路」）；
//   - harness pane 内容字号步进状态机（nextHarnessFontSize：与内容 pane 的 textScale
//     同语义——up/down 复用 nextFontSize 的 ×1.1 取整、钳 [12,32]，reset 回基线，
//     到界返回原值 = 「无变化、无提示、不报错」）。
// 合同：mission M378 任务 3 / 4 与 src/harness-panel.ts 的对应注释判词。
// 这一层是零 DOM 环境（tests/unit/README.md）：t() 传显式 lang，不触 document。

import { test } from "node:test";
import assert from "node:assert/strict";
import { t } from "../../src/copy.ts";
import { FONT_SIZE_MAX, FONT_SIZE_MIN, nextFontSize } from "../../src/typography.ts";
import { nextHarnessFontSize } from "../../src/harness-panel.ts";

// ── hint 两行带值文案（M378 任务 3：第一行 ctx、第二行 cache，带当时实际值） ──

test("D395：第一行 context window usage 带 {ctx} 当时值（zh/en 双档）", () => {
  assert.equal(t("D395", { ctx: 12 }, "zh"), "上下文窗口占用：12%");
  assert.equal(t("D395", { ctx: 12 }, "en"), "Context window usage: 12%");
  assert.equal(t("D395", { ctx: 0 }, "zh"), "上下文窗口占用：0%");
  assert.equal(t("D395", { ctx: 86 }, "en"), "Context window usage: 86%");
});

test("D401：第二行 cache hit rate 带 {cache} 当时值（zh/en 双档）", () => {
  assert.equal(t("D401", { cache: 54 }, "zh"), "缓存命中率：54%");
  assert.equal(t("D401", { cache: 54 }, "en"), "Cache hit rate: 54%");
  assert.equal(t("D401", { cache: 0 }, "en"), "Cache hit rate: 0%");
});

test("D395 / D401：缺占位参数抛错（插值面不允许裸上屏）", () => {
  assert.throws(() => t("D395", undefined, "zh"), /缺少占位参数 \{ctx\}/);
  assert.throws(() => t("D401", undefined, "en"), /缺少占位参数 \{cache\}/);
});

// ── harness pane 字号步进状态（M378 任务 4：与内容 pane 同语义） ──
// 基线取 13（--fs-ui 现值，即面板创建时的根字号）；档位表与 nextFontSize 逐拍一致
//（×1.1 取整：13→14→15→17→…），reset 回基线，到界返回原值。

const BASE = 13;

test("nextHarnessFontSize：up / down 走 nextFontSize 同款档位（与内容 pane 同语义）", () => {
  let size = BASE;
  const ups: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    size = nextHarnessFontSize(size, "up", BASE);
    ups.push(size);
  }
  const expected: number[] = [];
  let cursor = BASE;
  for (let i = 0; i < 6; i += 1) {
    cursor = nextFontSize(cursor, "up");
    expected.push(cursor);
  }
  assert.deepEqual(ups, expected);
  // 手工核对表头几拍（倍率 1.1 取整）。
  assert.deepEqual(ups.slice(0, 3), [14, 15, 17]);
  // down 可逆回退（不是 up 的简单逆序重放，而是各走 nextFontSize 的 own 档位）。
  assert.equal(nextHarnessFontSize(15, "down", BASE), nextFontSize(15, "down"));
  assert.equal(nextHarnessFontSize(14, "down", BASE), 13);
});

test("nextHarnessFontSize：reset 回基线（对应内容 pane ⌘0 回配置字号）", () => {
  assert.equal(nextHarnessFontSize(20, "reset", BASE), BASE);
  assert.equal(nextHarnessFontSize(BASE, "reset", BASE), BASE); // 基线上 reset 是 no-op
});

test("nextHarnessFontSize：到界返回原值（无变化、无提示、不报错的上游判据）", () => {
  assert.equal(nextHarnessFontSize(FONT_SIZE_MAX, "up", BASE), FONT_SIZE_MAX);
  assert.equal(nextHarnessFontSize(FONT_SIZE_MIN, "down", BASE), FONT_SIZE_MIN);
  // 基线 13 向下两拍到下限 12，再 down 停在 12。
  assert.equal(nextHarnessFontSize(13, "down", BASE), FONT_SIZE_MIN);
  assert.equal(nextHarnessFontSize(FONT_SIZE_MIN, "down", BASE), FONT_SIZE_MIN);
});

test("nextHarnessFontSize：钳制区间与内容 pane 共享 [12,32]（不新造口径）", () => {
  assert.equal(FONT_SIZE_MIN, 12);
  assert.equal(FONT_SIZE_MAX, 32);
  // 从上限上方传入的当前值（异常态）up 不越界、reset 回基线。
  assert.equal(nextHarnessFontSize(40, "up", BASE), FONT_SIZE_MAX);
});
