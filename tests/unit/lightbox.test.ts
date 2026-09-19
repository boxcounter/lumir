// src/lightbox.ts 的纯逻辑层：遮罩状态机（M184，change open-image-lightbox）。
//
// 为什么这一段落在这层：四条关闭路径（三条用户路径 + 一条焦点兜底）必须回到同一个收尾，
// 「关闭之后焦点归谁」只有一处判据——这类守卫用真 DOM 验就得造 DOM 替身（本层纪律不允许，
// 见 tests/unit/README.md）。因此实现里把状态机与 DOM 分开：DOM 只经 LightboxSurface 进出，
// 这里注入假 surface，断言的是**转换本身**。
//
// 不在这一层（DOM 行为，归 tests/visual/scenes/markdown-combo.spec.ts 的 M184 组与
// scripts/acceptance/scenarios/24-image-lightbox.md）：遮罩与放大图的真实开合、几何口径、
// mousedown 的 preventDefault、以及「占位不可点开」——最后一条是**结构性事实**（双击监听器
// 只挂在终态渲染出的 <img> 上，见 src/preview/attachments.ts），在无 DOM 的层里写出来只会是
// 一条恒真断言（REVIEW.md 第 1 条的假绿形态），故不在这里验。

import { test } from "node:test";
import assert from "node:assert/strict";
import { createLightboxState } from "../../src/lightbox.ts";
import type { LightboxSurface } from "../../src/lightbox.ts";

/** 假 surface：记动作序列，供「谁先谁后」「交还了几次焦点」这类断言。 */
function fakeSurface() {
  const calls: string[] = [];
  const surface: LightboxSurface = {
    load: (src, rawRef) => void calls.push(`load:${src}:${rawRef}`),
    show: () => void calls.push("show"),
    hide: () => void calls.push("hide"),
    focus: () => void calls.push("focus"),
    restoreFocus: () => void calls.push("restoreFocus"),
  };
  return { calls, surface };
}

const SRC = "data:image/svg+xml;base64,AAAA";
const REF = "![a](assets/a.svg)";

test("打开：载入同一图像源 → 显示 → 持焦，状态转为打开", () => {
  const { calls, surface } = fakeSurface();
  const state = createLightboxState(surface);
  assert.equal(state.isOpen(), false);

  state.open(SRC, REF);
  // 持焦在显示之后：aria-modal 的语义要求「遮罩可见时焦点在遮罩上」，顺序反过来会先
  // 焦点进入一个还不可见的层。
  assert.deepEqual(calls, [`load:${SRC}:${REF}`, "show", "focus"]);
  assert.equal(state.isOpen(), true);
});

test("Esc 就地消费并关闭、交还焦点；其余 token 不消费也不关闭", () => {
  const { calls, surface } = fakeSurface();
  const state = createLightboxState(surface);

  // 未打开时按 Esc：消费（避免落到 window 上的分发器）但不产生任何收尾动作——
  // 这条挡的是「遮罩已经关了还补一次 hide / 抢一次焦点」。
  assert.equal(state.handleKeyToken("Escape"), true);
  assert.deepEqual(calls, []);

  state.open(SRC, REF);
  calls.length = 0;
  for (const token of ["Ctrl-D", "Tab", "Enter", null, "a"]) {
    assert.equal(state.handleKeyToken(token), false, `${token} 不该被遮罩消费`);
  }
  assert.equal(state.isOpen(), true);
  assert.deepEqual(calls, [], "未消费的键不得产生任何遮罩动作");

  assert.equal(state.handleKeyToken("Escape"), true);
  assert.deepEqual(calls, ["hide", "restoreFocus"]);
  assert.equal(state.isOpen(), false);
});

test("三条用户关闭路径都交还焦点，焦点兜底（blur）不抢焦点", () => {
  for (const reason of ["escape", "overlay", "image"] as const) {
    const { calls, surface } = fakeSurface();
    const state = createLightboxState(surface);
    state.open(SRC, REF);
    calls.length = 0;
    state.close(reason);
    assert.deepEqual(calls, ["hide", "restoreFocus"], `${reason} 路径应交还焦点`);
    assert.equal(state.isOpen(), false);
  }

  const { calls, surface } = fakeSurface();
  const state = createLightboxState(surface);
  state.open(SRC, REF);
  calls.length = 0;
  state.close("blur");
  // 焦点本来就去了别处（在遮罩之上另开面板 / 窗口失活）：拽回编辑器是无礼的，也是
  // 「关掉了，但键盘回不到编辑器」那个坑的另一半（src/toc.ts 的同一口径）。
  assert.deepEqual(calls, ["hide"]);
  assert.equal(state.isOpen(), false);
});

test("关闭之后的迟到关闭是空操作：不重复收尾、不再抢焦点", () => {
  const { calls, surface } = fakeSurface();
  const state = createLightboxState(surface);
  state.open(SRC, REF);

  // 真实顺序：hide() 自身会让遮罩失焦，那条 blur 回调紧跟着到达。
  state.close("overlay");
  assert.deepEqual(calls.slice(-2), ["hide", "restoreFocus"]);
  calls.length = 0;
  state.close("blur");
  state.close("escape");
  assert.deepEqual(calls, [], "已关闭后不得再产生任何动作");
});

test("失焦先关（不抢焦点）之后，用户路径的关闭不再补一次交还", () => {
  const { calls, surface } = fakeSurface();
  const state = createLightboxState(surface);
  state.open(SRC, REF);
  calls.length = 0;

  state.close("blur"); // 焦点被别的面板 / 别的窗口拿走
  state.close("overlay"); // 同一拍到达的点击关闭路径：无事可做
  assert.deepEqual(calls, ["hide"]);
});

test("打开态再打开即换源（同一层只显示一张图，不叠加）", () => {
  const { calls, surface } = fakeSurface();
  const state = createLightboxState(surface);
  state.open(SRC, REF);
  state.open("data:image/png;base64,BBBB", "![b](assets/b.png)");
  assert.deepEqual(calls, [
    `load:${SRC}:${REF}`,
    "show",
    "focus",
    "load:data:image/png;base64,BBBB:![b](assets/b.png)",
    "show",
    "focus",
  ]);
  assert.equal(state.isOpen(), true);
});
