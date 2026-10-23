// harness hint 文案与 pane 字号的单测（M378 起；M627 改「一套字号」驱动）：
//   - hint 带值形态的文案插值（第一行 context window usage = D395、第二行 cache hit rate =
//     D465，zh/en 双档，{ctx} / {cache} 取当时实际读数——Alex 2026-10-07「比如 context window
//     usage: 12%. cache hit rate: 54%……按照这个『清晰简洁』的思路来设计」）；
//   - 面板缩放比与编辑器同一套（M627：textScaleRatio = 当前字号 ÷ 配置基线；面板不自持档位、
//     不认焦点，M378 的焦点路由与 nextHarnessFontSize 已废止）。
// 合同：mission M378 任务 3 / M627 任务 1，与 src/harness-panel.ts 的对应注释判词。
// M533：命中率行只出百分比（D465 精简）、D401 / D452 / D453 / D454 / D455 / D466 六条随行
// 退场——退场条目的串留在 deck 与文案表里（漂移门禁照管），不再有各自的插值用例（同 D376 /
// D389 / D391 的退场口径）；本回合值 / 成因 / 缓存写入三组读数不再是任何上屏串。
// 这一层是零 DOM 环境（tests/unit/README.md）：t() 传显式 lang，不触 document。

import { test } from "node:test";
import assert from "node:assert/strict";
import { t } from "../../src/copy.ts";

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

// ── 面板字号由「一套字号」驱动（M627）──
// M378 的自持档位（nextHarnessFontSize / --fs-ui 基线 / 焦点路由）已废止：面板不再认方向、
// 不读 DOM，只接收装配层算出的缩放比（编辑器当前字号 ÷ 配置基线）。比值本体是
// typography.ts 的 textScaleRatio——纯函数用例与档位表同址（tests/unit/typography.test.ts）；
// 面板侧的施加（--lumir-hp-scale 落到计算字号）是 DOM 行为，判据在视觉场景
// tests/visual/scenes/m347-harness-composer.spec.ts 的「两个 pane 一起变」用例。
