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
//
// M538 追加同族的一条判据：**vault 根落点**（`rootDropBandHit`）与 rowBandHit 吃同一份行带，
// 只是回答「指针在不在列表之外」——两段的边界扫在这里（接了 DOM 的那一半在
// tests/unit/tree-root-drop.test.ts，真机那一半在场景 159）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { rootDropBandHit, rowBandHit } from "../../src/tree.ts";

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

// ---------------------------------------------------------------------------
// vault 根落点的纵带判定（M538）：上面那三处「rowBandHit 不命中」的位置里，只有列表**外**的
// 两段是 root 落点——行带之内（哪怕横向落在缩进区）与行带之间的缝都不是。两处落点共用一条判据，
// 因此下面逐段扫边界，而不是只给一条「头部命中」的样例断言。
// ---------------------------------------------------------------------------

test("根落点：列表头部之上（vault 名行那一带）与列表尾部之下都命中", () => {
  // 头部：第一行行带上缘（y=0）之上全部算——含 vault 名字那一行、也含容器顶部那几像素内边距
  for (const y of [-100, -1, -0.001]) {
    assert.equal(rootDropBandHit(BANDS, y), true, `y=${y} 在第一行之上应命中根部`);
  }
  // 尾部：最后一行行带下缘（y=75）之下全部算（列表下方那片空白）
  for (const y of [75.001, 76, 400, 5000]) {
    assert.equal(rootDropBandHit(BANDS, y), true, `y=${y} 在最后一行之下应命中根部`);
  }
});

test("根落点：行带之内与行带之间的缝都不是（普通行不受影响）", () => {
  // 每一行的行带之内：命中该行（rowBandHit），MUST NOT 同时被当成根落点
  for (const y of [0, 12, 25, 26, 49, 50, 74, 75]) {
    assert.equal(rootDropBandHit(BANDS, y), false, `y=${y} 落在某行行带里，不是根落点`);
  }
  // 行带之间的缝：既不是任何一行、也不在列表之外——保守地按「不命中」处理
  const gap = [BANDS[0], { ...BANDS[1], top: 30, bottom: 55 }, BANDS[2]];
  assert.equal(rootDropBandHit(gap, 27), false, "缝不构成根落点");
  assert.equal(rootDropBandHit(gap, 29.9), false, "缝不构成根落点");
  // 边界值取行带本身的上下缘（含端点归行，与 rowBandHit 的含端点判据同口径）
  assert.equal(rootDropBandHit(BANDS, 0), false);
  assert.equal(rootDropBandHit(BANDS, 75), false);
});

test("根落点：空列表恒为真（没有行可指时整个容器都在列表之外）", () => {
  // 空列表（空 vault）没有拖拽源，判定根本走不到落点上；这里钉住它不退化成「恒假」——
  // 恒假会让「列表空着时拖不动任何东西」这类回归无从察觉。
  assert.equal(rootDropBandHit([], 0), true);
  assert.equal(rootDropBandHit([], 500), true);
});
