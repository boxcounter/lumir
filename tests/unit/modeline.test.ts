// src/modeline.ts 的纯逻辑层：产品标识块的文案组装与显隐决策（M236，change
// product-version-display；M316 起新增 split 维——双栏时标识块整体退 modeline）。
//
// 在这层验的：文案组装只有 identityView() 一处真源（标题栏三段与 modeline 段的文本都由它
// 派生）、降级决策（元信息缺失 = 整体隐藏 + 全空串，MUST NOT 给占位文本）、退让决策
//（宽窄二态下版本号有且只有一个展示位；双栏时标识块整体有且只有一个展示位）。
// 不在这层（DOM 行为）：hidden 属性落到真实元素、钉右端、三主题计算样式、matchMedia 接线——
// 归 tests/visual/scenes/titlebar-identity.spec.ts 与真机场景 39（本层纪律不许造 DOM 替身，
// 见 tests/unit/README.md 与 lightbox.test.ts 的同族说明）。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IDENTITY_NARROW_PX,
  IDENTITY_SEP,
  identityView,
} from "../../src/modeline.ts";

const META = { name: "Lumir", version: "0.0.0" };
const WIDE = { narrow: false, split: false };
const NARROW = { narrow: true, split: false };
const SPLIT = { narrow: false, split: true };
const SPLIT_NARROW = { narrow: true, split: true };

test("宽窗单栏：三段文本齐备，版本号在标题栏（不退让）", () => {
  const view = identityView(META, WIDE);
  assert.equal(view.visible, true);
  assert.equal(view.blockInTitlebar, true);
  assert.equal(view.name, "Lumir");
  assert.equal(view.version, "0.0.0");
  assert.equal(view.versionInModeline, false);
  // modeline 段在宽窗下不携带文本（hidden 时 textContent 一并清空，不留残字）
  assert.equal(view.modelineText, "");
});

test("窄窗：版本号退 modeline 右段尾部，标题栏留产品名", () => {
  const view = identityView(META, NARROW);
  assert.equal(view.visible, true);
  assert.equal(view.blockInTitlebar, true);
  assert.equal(view.versionInModeline, true);
  assert.equal(view.name, "Lumir"); // 产品名仍在标题栏（D2 备选：拆开的只是版本号）
  // modeline 段文本 = 前导空格 + 分隔符 + 版本号，与 meta 段内部「 · 」节奏同形；
  // 分隔符从 IDENTITY_SEP 派生（唯一字面量来源），不是第二份硬编码
  assert.equal(view.modelineText, ` ${IDENTITY_SEP} 0.0.0`);
});

test("双栏（M316）：标识块整体退 modeline，标题栏腾给左右标签槽", () => {
  const view = identityView(META, SPLIT);
  assert.equal(view.visible, true);
  assert.equal(view.blockInTitlebar, false); // 块整体退（不是只退版本号）
  assert.equal(view.versionInModeline, true); // 与窄窗同一落点、同一机制
  // modeline 段 = 前导「 · 」+ 产品名 + 分隔符 + 版本号（整块退，信息不丢）：前导分隔符
  // 隔开在前的 charset（meta 段尾「UTF-8」）与产品名（Alex dogfood 2026-10-05，M330）
  assert.equal(view.modelineText, ` ${IDENTITY_SEP} Lumir ${IDENTITY_SEP} 0.0.0`);
});

test("双栏 + 窄窗同至：仍是整块退 modeline（split 主导），文本不退化", () => {
  const view = identityView(META, SPLIT_NARROW);
  assert.equal(view.blockInTitlebar, false);
  assert.equal(view.versionInModeline, true);
  assert.equal(view.modelineText, ` ${IDENTITY_SEP} Lumir ${IDENTITY_SEP} 0.0.0`);
});

test("版本号展示位互斥：两种宽度下都恰有一个落点", () => {
  // 宽窗：标题栏有版本号、modeline 无文本；窄窗：modeline 有、标题栏段藏（versionInModeline）。
  // 两个展示位 MUST NOT 同时可见、也 MUST NOT 同时消失——这是「一个裁判」的决策不变量。
  const wide = identityView(META, WIDE);
  const narrow = identityView(META, NARROW);
  assert.equal(wide.versionInModeline === false && wide.version === META.version && wide.modelineText === "", true);
  assert.equal(narrow.versionInModeline === true && narrow.modelineText.endsWith(META.version), true);
});

test("降级：元信息读不到 = 整体隐藏 + 全部空串（宽窄单双栏同口径）", () => {
  for (const flags of [WIDE, NARROW, SPLIT, SPLIT_NARROW]) {
    const view = identityView(null, flags);
    assert.equal(view.visible, false);
    assert.equal(view.blockInTitlebar, false);
    assert.equal(view.versionInModeline, false);
    // MUST NOT 渲染假版本号：三处文本全空，不存在「占位串」这种中间态（REVIEW.md 第 2 条）
    assert.equal(view.name, "");
    assert.equal(view.version, "");
    assert.equal(view.modelineText, "");
  }
});

test("文案组装的入参原样透传：组装层不裁不补（真源值是什么就显示什么）", () => {
  const view = identityView({ name: "Lumir", version: "1.2.3-rc.1" }, WIDE);
  assert.equal(view.version, "1.2.3-rc.1");
  assert.equal(identityView({ name: "Lumir", version: "1.2.3-rc.1" }, NARROW).modelineText, ` ${IDENTITY_SEP} 1.2.3-rc.1`);
  assert.equal(identityView({ name: "Lumir", version: "1.2.3-rc.1" }, SPLIT).modelineText, ` ${IDENTITY_SEP} Lumir ${IDENTITY_SEP} 1.2.3-rc.1`);
});

test("退让阈值钉在 640px（D2 裁决采纳的备选量级，design §3.2）", () => {
  assert.equal(IDENTITY_NARROW_PX, 640);
  // 分隔符是「·」且只有这一处字面量（文案 deck 口径：纯排版分隔符不进编号）
  assert.equal(IDENTITY_SEP, "·");
});
