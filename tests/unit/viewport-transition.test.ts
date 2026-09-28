// src/viewport-transition.ts 的单测（M286）：窗口是**嵌套安全**的计数器——装载路径的窗口里嵌着
// 一次交还焦点的窗口，任一方提前关窗都会让另一半的中间态漏进捕获（`reading-position.test.ts` 的
// 「转场窗口」一组测的是消费侧，这里测的是标记本身）。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beginViewportTransition,
  endViewportTransition,
  viewportTransitionInFlight,
} from "../../src/viewport-transition.ts";

test("窗口：开窗即 in-flight，关窗即结束", () => {
  assert.equal(viewportTransitionInFlight(), false, "初始没有窗口");
  beginViewportTransition();
  assert.equal(viewportTransitionInFlight(), true);
  endViewportTransition();
  assert.equal(viewportTransitionInFlight(), false);
});

test("窗口嵌套：内层先关不结束外层（外部重载：装载复位窗口里嵌一次交还焦点）", () => {
  beginViewportTransition(); // 装载复位（editor.reloadSession）
  beginViewportTransition(); // 关浮层交还焦点（嵌在里面）
  endViewportTransition(); // 交还焦点那一半先落地
  assert.equal(viewportTransitionInFlight(), true, "装载窗口仍在：中间态还没被写回覆盖");
  endViewportTransition();
  assert.equal(viewportTransitionInFlight(), false);
});

test("多余的 end 不把计数压到负数（迟到的关窗不会顺手关掉后来的窗口）", () => {
  endViewportTransition();
  beginViewportTransition();
  assert.equal(viewportTransitionInFlight(), true, "一次多余的 end 之后，新窗口照常有效");
  endViewportTransition();
  endViewportTransition();
  beginViewportTransition();
  assert.equal(viewportTransitionInFlight(), true, "同上：两次多余的 end 也不影响");
  endViewportTransition();
  assert.equal(viewportTransitionInFlight(), false);
});
