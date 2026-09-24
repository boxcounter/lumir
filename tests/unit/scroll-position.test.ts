// src/scroll-position.ts 的单测（M194，change remember-reading-position 的 task 3.5 / 6.1）：
// 值形态的往返分解。这一条是本 change 最容易写错的地方（design §2.3 / §7 第 1、2 条），纯代数，
// 因此落在这里而不是靠浏览器场景间接兜底。

import { test } from "node:test";
import assert from "node:assert/strict";
import { positionFromReadings, restoreScrollTop } from "../../src/scroll-position.ts";
import type { ScrollReadings } from "../../src/scroll-position.ts";

/** 同一份布局下的读数模型：文档原点（height 0）在滚动容器的页首内边距之下。
 *  `charTop` 是锚的字符盒顶（client 坐标），随 scrollTop 平移——这正是捕获到的那个量。 */
function readingsAt(scrollTop: number): ScrollReadings {
  const BOX_TOP = 100; // 滚动容器顶（client 坐标）
  const PADDING = 44; // `.cm-content` 的 paddingBlock（baseTheme）
  const ANCHOR_IN_DOC = 1004; // 锚的字符盒相对文档原点的位置
  return {
    charTop: BOX_TOP + PADDING + ANCHOR_IN_DOC - scrollTop,
    charLeft: 0,
    boxTop: BOX_TOP,
    boxLeft: 0,
  };
}

test("值形态：捕获口径与恢复口径互为逆（同一份布局下，装载后恢复到捕获时的 scrollTop）", () => {
  const captured = positionFromReadings(readingsAt(1000));
  // y 是「字符盒相对滚动容器顶」的偏移，不是相对文档顶的那个数
  assert.equal(captured.y, 48);
  // 装载后 scrollTop = 0：restoreScrollTop 给出的落点必须回到捕获时的 1000
  assert.equal(restoreScrollTop(readingsAt(0), captured), 1000);
  // 任意位置都成立（不是某一个值的巧合）
  for (const scrollTop of [0, 1, 37, 640, 4096, 123456]) {
    const position = positionFromReadings(readingsAt(scrollTop));
    assert.equal(restoreScrollTop(readingsAt(0), position), scrollTop, `scrollTop=${scrollTop}`);
  }
});

test("值形态：篇首位置解出 0，调用方据此不施加效果（M110 的页首内边距）", () => {
  const captured = positionFromReadings(readingsAt(0));
  assert.equal(restoreScrollTop(readingsAt(0), captured), 0);
});

test("口径反例：按「相对文档顶」捕获时往返不成立（落点恒为 44px，与离开时的位置无关）", () => {
  // design §2.3 的字面形式：y = 字符盒顶 − 文档顶。CM 的 `documentTop` 是**随滚动平移**的文档
  // 原点（`contentDOM.getBoundingClientRect().top + paddingTop`），所以这个差值与 scrollTop
  // 完全无关——它是一个常量，恢复侧拿它当 yMargin 等于把「锚在文档里的位置」当成了「锚在视口
  // 里的偏移」。
  const docTopOf = (scrollTop: number) => readingsAt(scrollTop).boxTop - scrollTop + 44;
  const wrongY = (scrollTop: number) => readingsAt(scrollTop).charTop - docTopOf(scrollTop);
  assert.equal(wrongY(1000), 1004);
  assert.equal(wrongY(99999), 1004);
  // 按公开恢复通道施加它，落点恒等于页首内边距（44px，页首附近），与捕获时的位置无关
  const landing = (scrollTop: number) =>
    readingsAt(0).charTop - readingsAt(0).boxTop - wrongY(scrollTop);
  assert.equal(landing(1000), 44);
  assert.equal(landing(99999), 44);
  // 取「相对滚动容器」的口径解出的才是真正的落点（本模块采用的那一版）
  assert.equal(restoreScrollTop(readingsAt(0), positionFromReadings(readingsAt(1000))), 1000);
});
