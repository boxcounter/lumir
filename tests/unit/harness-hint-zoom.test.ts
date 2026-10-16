// harness hint 文案与 pane 字号步进的单测（M378，harness panel hint fix and Cmd zoom）：
//   - hint 带值形态的文案插值（第一行 context window usage = D395、第二行 cache hit rate =
//     D465，zh/en 双档，{ctx} / {cache} 取当时实际读数——Alex 2026-10-07「比如 context window
//     usage: 12%. cache hit rate: 54%……按照这个『清晰简洁』的思路来设计」）；
//   - harness pane 内容字号步进状态机（nextHarnessFontSize：与内容 pane 的 textScale
//     同语义——up/down 复用 nextFontSize 的 ×1.1 取整、钳 [12,32]，reset 回基线，
//     到界返回原值 = 「无变化、无提示、不报错」）。
// 合同：mission M378 任务 3 / 4 与 src/harness-panel.ts 的对应注释判词。
// M533：命中率行只出百分比（D465 精简）、D401 / D452 / D453 / D454 / D455 / D466 六条随行
// 退场——退场条目的串留在 deck 与文案表里（漂移门禁照管），不再有各自的插值用例（同 D376 /
// D389 / D391 的退场口径）；本回合值 / 成因 / 缓存写入三组读数不再是任何上屏串。
// 这一层是零 DOM 环境（tests/unit/README.md）：t() 传显式 lang，不触 document。

import { test } from "node:test";
import assert from "node:assert/strict";
import { t } from "../../src/copy.ts";
import { FONT_SIZE_MAX, FONT_SIZE_MIN, nextFontSize } from "../../src/typography.ts";
import { nextHarnessFontSize } from "../../src/harness-panel.ts";

// ── hint 带值文案（M378 任务 3：第一行 ctx、第二行 cache，带当时实际值） ──

test("D395：第一行 context window usage 带 {ctx} 当时值（zh/en 双档）", () => {
  assert.equal(t("D395", { ctx: 12 }, "zh"), "上下文窗口占用：12%");
  assert.equal(t("D395", { ctx: 12 }, "en"), "Context window usage: 12%");
  assert.equal(t("D395", { ctx: 0 }, "zh"), "上下文窗口占用：0%");
  assert.equal(t("D395", { ctx: 86 }, "en"), "Context window usage: 86%");
});

test("D465：第二行会话缓存命中率只带 {cache} 百分比（zh/en 双档）", () => {
  assert.equal(t("D465", { cache: 54 }, "zh"), "缓存命中率（会话）：54%");
  assert.equal(t("D465", { cache: 54 }, "en"), "Cache hit rate (session): 54%");
  assert.equal(t("D465", { cache: 0 }, "en"), "Cache hit rate (session): 0%");
});

test("D335：越线警示句只带 {warn}（M533 起不再复述 {ctx}，zh/en 双档）", () => {
  assert.equal(t("D335", { warn: 85 }, "zh"), "越过 85% 警示线——下一轮对话将自动压缩");
  assert.equal(
    t("D335", { warn: 85 }, "en"),
    "Context usage is past the 85% warning line — the next turn will be auto-compacted",
  );
  // 缺占位参数抛错（插值面不允许裸上屏）；旧口径的 {ctx} 已不在占位符表里——多传不报错、
  // 也不再上屏（区分度：旧模板会把 90 插进句首，本模板两处都不出现它）。
  assert.throws(() => t("D335", undefined, "zh"), /缺少占位参数 \{warn\}/);
  const withStaleCtx = t("D335", { warn: 85, ctx: 90 }, "zh");
  assert.equal(withStaleCtx, "越过 85% 警示线——下一轮对话将自动压缩");
  assert.equal(withStaleCtx.includes("上下文已用"), false);
});

test("D395 / D465：缺占位参数抛错（插值面不允许裸上屏）", () => {
  assert.throws(() => t("D395", undefined, "zh"), /缺少占位参数 \{ctx\}/);
  assert.throws(() => t("D465", undefined, "en"), /缺少占位参数 \{cache\}/);
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
