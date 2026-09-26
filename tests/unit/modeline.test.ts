// src/modeline.ts 的纯逻辑层：产品标识块的文案组装与显隐决策（M236，change
// product-version-display）。
//
// 在这层验的：文案组装只有 identityView() 一处真源（标题栏三段与 modeline 段的文本都由它
// 派生）、降级决策（元信息缺失 = 整体隐藏 + 全空串，MUST NOT 给占位文本）、退让决策
//（宽窄二态下版本号有且只有一个展示位）。
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

test("宽窗：三段文本齐备，版本号在标题栏（不退让）", () => {
  const view = identityView(META, false);
  assert.equal(view.visible, true);
  assert.equal(view.name, "Lumir");
  assert.equal(view.version, "0.0.0");
  assert.equal(view.versionInModeline, false);
  // modeline 段在宽窗下不携带文本（hidden 时 textContent 一并清空，不留残字）
  assert.equal(view.modelineText, "");
});

test("窄窗：版本号退 modeline 右段尾部，标题栏留产品名", () => {
  const view = identityView(META, true);
  assert.equal(view.visible, true);
  assert.equal(view.versionInModeline, true);
  assert.equal(view.name, "Lumir"); // 产品名仍在标题栏（D2 备选：拆开的只是版本号）
  // modeline 段文本 = 前导空格 + 分隔符 + 版本号，与 meta 段内部「 · 」节奏同形；
  // 分隔符从 IDENTITY_SEP 派生（唯一字面量来源），不是第二份硬编码
  assert.equal(view.modelineText, ` ${IDENTITY_SEP} 0.0.0`);
});

test("版本号展示位互斥：两种宽度下都恰有一个落点", () => {
  // 宽窗：标题栏有版本号、modeline 无文本；窄窗：modeline 有、标题栏段藏（versionInModeline）。
  // 两个展示位 MUST NOT 同时可见、也 MUST NOT 同时消失——这是「一个裁判」的决策不变量。
  const wide = identityView(META, false);
  const narrow = identityView(META, true);
  assert.equal(wide.versionInModeline === false && wide.version === META.version && wide.modelineText === "", true);
  assert.equal(narrow.versionInModeline === true && narrow.modelineText.endsWith(META.version), true);
});

test("降级：元信息读不到 = 整体隐藏 + 全部空串（两种宽度同口径）", () => {
  for (const narrow of [false, true]) {
    const view = identityView(null, narrow);
    assert.equal(view.visible, false);
    assert.equal(view.versionInModeline, false);
    // MUST NOT 渲染假版本号：三处文本全空，不存在「占位串」这种中间态（REVIEW.md 第 2 条）
    assert.equal(view.name, "");
    assert.equal(view.version, "");
    assert.equal(view.modelineText, "");
  }
});

test("文案组装的入参原样透传：组装层不裁不补（真源值是什么就显示什么）", () => {
  const view = identityView({ name: "Lumir", version: "1.2.3-rc.1" }, false);
  assert.equal(view.version, "1.2.3-rc.1");
  assert.equal(identityView({ name: "Lumir", version: "1.2.3-rc.1" }, true).modelineText, ` ${IDENTITY_SEP} 1.2.3-rc.1`);
});

test("退让阈值钉在 640px（D2 裁决采纳的备选量级，design §3.2）", () => {
  assert.equal(IDENTITY_NARROW_PX, 640);
  // 分隔符是「·」且只有这一处字面量（文案 deck 口径：纯排版分隔符不进编号）
  assert.equal(IDENTITY_SEP, "·");
});
