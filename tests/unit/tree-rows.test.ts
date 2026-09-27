// 行带命中判定的单测（M251，「右键目标行 = 菜单作用行」的纯函数那一半）。
//
// 为什么在这一层：判据本身是几何，但**不含 DOM**——`rowBandHit`（`src/tree.ts`）只吃「四条边 +
// 指针坐标」，因此形状与边界可以在零 DOM 的单测层扫（tests/unit 无 DOM 环境，见
// tests/unit/README.md）。真实布局下的接线（事件目标落在行元素内、`.filetree` 的右内边距那条带、
// 编辑中的行不参与）在 chromium 层：`tests/visual/scenes/tree-menu.spec.ts` 的
// 「M251：右键落在行右侧的空白带也作用于该行」。
//
// 这条判据的前身是「监听挂在每行的行元素上」——那一版在**行元素右缘之外**命中不到任何行
//（Alex 2026-09-27 真机报告：右键那一行但不在文件名上时那一行不被选中/不响应）。下面的用例把
// 行带右侧那条带钉成**命中**，并把左缘之外、行带之间的缝、空列表钉成**不命中**。

import { test } from "node:test";
import assert from "node:assert/strict";
import { rowBandHit } from "../../src/tree.ts";

/** 三行示例：行高 25，左缘 8（缩进 8），右缘 211（面板宽 236 减去右内边距）。 */
const BANDS = [
  { left: 8, right: 211, top: 0, bottom: 25 },
  { left: 8, right: 211, top: 25, bottom: 50 },
  { left: 22, right: 211, top: 50, bottom: 75 }, // 嵌套一行：左缘随缩进内移
];

test("行带内任意横向位置都命中该行（含名字右侧的空白与行右缘之外那条带）", () => {
  // 行带纵向中点：从左缘、名字之后、右缘、右缘之外（面板右内边距那条带）逐点扫
  for (const x of [8, 60, 210.9, 211, 220, 235.9]) {
    assert.equal(rowBandHit(BANDS, x, 12), 0, `x=${x} 应命中第一行`);
  }
  // 纵向边界含端点（行带上下缘本身也算该行）——CM 之外的行盒没有亚像素缝，端点归谁都一致
  assert.equal(rowBandHit(BANDS, 100, 0), 0);
  assert.equal(rowBandHit(BANDS, 100, 25), 0, "下缘与下一行上缘重合时按先出现的行（行带不重叠）");
  assert.equal(rowBandHit(BANDS, 100, 26), 1);
});

test("每一行各自独立：纵向位置决定行，横向位置不越界到别的行", () => {
  assert.equal(rowBandHit(BANDS, 235, 74.9), 2);
  // 嵌套行的缩进区（左缘 22 之外）不属于任何一行——与「右键落在缩进空白上」的真实行为一致
  assert.equal(rowBandHit(BANDS, 10, 60), -1);
  assert.equal(rowBandHit(BANDS, 10, 55), -1);
});

test("不命中：行带之间的缝、所有行带之外、空列表", () => {
  // 行带之间的缝（真实布局里行高固定、无缝隙，但插入空隙或半行偏移时会走到这条）
  assert.equal(rowBandHit([BANDS[0], { ...BANDS[1], top: 30, bottom: 55 }], 100, 27), -1);
  // 最后一行之下（面板底部空白）
  assert.equal(rowBandHit(BANDS, 100, 75.1), -1);
  assert.equal(rowBandHit(BANDS, 100, 400), -1);
  // 空列表（空态 / 树头部区域）：不得退化成「命中第 0 行」这种恒真
  assert.equal(rowBandHit([], 100, 12), -1);
});
