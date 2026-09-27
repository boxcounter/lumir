// 显露闸门的不变量单测（M259，真实桌面缺陷：点击 `**粗体**` 后字母被选中）。
//
// 这一层钉的是**判据本身**：显露判定在指针按压期间用哪个选区、解除按压后回到哪个
// 选区，以及两条相接口径（M168 含端点 / M110 严格重叠）的语义。几何那一半（按下与
// 移动之间同一屏幕坐标的文档落点映射恒等、抖动点击不产生选区）需要真实布局，归
// chromium 场景——那一半在这里造不出来（造了就是等价于子串的空断言，REVIEW.md 第 1 条）。
//
// 缺陷的机理回顾：显露一落地就改变布局（隐藏的 `**` 重新占宽 ≈12px）。CM 的鼠标选区
// 在按下时算一次落点、在之后每次 mousemove 又按当时的布局重算一次，布局在两次之间位移
// 就使同一屏幕坐标映射到靠前 1–2 字符的位置——两个落点被当成一次拖拽，选出一个字母。
// 「按压期间判据选区冻结」正是让布局从按下到抬起不动的那一条，因此它必须对**选区怎么
// 落**完全免疫：本文件用「按下时的快照 × 按压期间落下的选区」的矩阵断言这一点。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  pointerPressField,
  pointerPressFrame,
  rangeRevealsSource,
  revealSelection,
  touchesSource,
} from "../../src/preview/reveal-gate.ts";

// `**pnpm**` 在文档里的索引由 indexOf 给出，不心算：FROM 是第一个 `*`，TO 是收尾之后。
const DOC = "前言\n\n点击 **pnpm** 后面\n";
const RAW = "**pnpm**";
const FROM = DOC.indexOf(RAW);
const TO = FROM + RAW.length;

const state = (anchor: number, head = anchor): EditorState =>
  EditorState.create({
    doc: DOC,
    selection: EditorSelection.single(anchor, head),
    extensions: [pointerPressField],
  });

/** 选区的可比形态（不依赖 EditorSelection 的对象身份）。 */
const shape = (selection: EditorSelection): Array<[number, number, number, number]> =>
  selection.ranges.map((r) => [r.from, r.to, r.anchor, r.head]);

const frozenShape = ([anchor, head]: [number, number]): Array<[number, number, number, number]> =>
  [[Math.min(anchor, head), Math.max(anchor, head), anchor, head]];

/** 按下：按下那一刻的选区就是快照（此后它会被鼠标落点改成别的）。 */
const press = ([anchor, head]: [number, number]): EditorState => {
  const before = state(anchor, head);
  return before.update({ effects: pointerPressFrame.of(before.selection) }).state;
};

/** 按压期间指针把选区挪到别处（CM 的鼠标选区就是这么落点的）。 */
const move = (from: EditorState, [anchor, head]: [number, number]): EditorState =>
  from.update({ selection: EditorSelection.single(anchor, head) }).state;

/** 抬起：关窗解冻。 */
const release = (from: EditorState): EditorState =>
  from.update({ effects: pointerPressFrame.of(null) }).state;

/** 按压期间会落下的选区矩阵：范围外两侧、两个端点、内容内部、跨范围选区。 */
const LIVE: Record<string, [number, number]> = {
  范围前一位: [FROM - 1, FROM - 1],
  范围起点: [FROM, FROM],
  内容内部: [FROM + 3, FROM + 3],
  范围终点: [TO, TO],
  范围后一位: [TO + 1, TO + 1],
  跨范围选区: [FROM - 2, TO + 2],
};

/** 按下瞬间的快照矩阵（含空光标与选区两种形态）。 */
const FROZEN: Record<string, [number, number]> = {
  窗口前空光标: [0, 0],
  快照在范围外: [TO + 1, TO + 1],
  快照在范围内: [FROM + 1, FROM + 3],
  快照跨范围: [FROM, TO],
};

test("没有按压窗口时判据选区就是活选区（M168 的既有行为逐字不变）", () => {
  for (const [name, range] of Object.entries(LIVE)) {
    const s = state(range[0], range[1]);
    assert.deepEqual(shape(revealSelection(s)), frozenShape(range), name);
  }
});

test("按压期间判据选区冻结在快照上：活选区怎么落都不改变显露判定（M259 的核心）", () => {
  for (const [frozenName, frozenRange] of Object.entries(FROZEN)) {
    const pressed = press(frozenRange);
    // 快照就是按下那一刻的选区（不是按下之后落下的那个）
    assert.deepEqual(shape(revealSelection(pressed)), frozenShape(frozenRange), frozenName);
    const before = { range: rangeRevealsSource(pressed, FROM, TO), line: touchesSource(pressed, FROM, TO) };
    for (const [liveName, liveRange] of Object.entries(LIVE)) {
      const moved = move(pressed, liveRange);
      // 正向锚点：活选区确实落到了矩阵给的位置（否则下面的「不变」是在常量上打转）
      assert.deepEqual(shape(moved.selection), frozenShape(liveRange), `${frozenName}/${liveName}`);
      assert.deepEqual(shape(revealSelection(moved)), frozenShape(frozenRange), `${frozenName}/${liveName} 判据选区应冻结`);
      assert.deepEqual(
        { range: rangeRevealsSource(moved, FROM, TO), line: touchesSource(moved, FROM, TO) },
        before,
        `${frozenName}/${liveName} 显露判定不应随活选区变化`,
      );
    }
  }
});

test("反向对照：同样的活选区序列在没有按压窗口时**会**改变显露判定", () => {
  // 缺了这条，「判定不随选区变化」可能只是因为这个矩阵本来就判不出差别（假绿）。
  const free = state(0);
  const seen = new Set(
    Object.values(LIVE).map((range) => rangeRevealsSource(move(free, range), FROM, TO)),
  );
  assert.deepEqual([...seen].sort(), [false, true], "无窗口时显露判定应既有真也有假");
});

test("抬起（解冻）后判据选区回到活选区——M168 的显露照常跟随", () => {
  for (const [name, frozenRange] of Object.entries(FROZEN)) {
    const pressed = press(frozenRange);
    // 按下那一刻的显露判定 = 用户瞄准时看到的那一帧，按压期间必须逐值保持
    const atPress = rangeRevealsSource(pressed, FROM, TO);
    const moved = move(pressed, LIVE.内容内部);
    assert.equal(rangeRevealsSource(moved, FROM, TO), atPress, `${name} 按压期间应保持按下那一刻的判定`);
    const released = release(moved);
    assert.deepEqual(shape(revealSelection(released)), shape(released.selection), `${name} 解冻后判据选区应是活选区`);
    assert.equal(rangeRevealsSource(released, FROM, TO), true, `${name} 解冻后光标在范围内应显露`);
  }
});

test("文档变化兜底解冻：快照不跟随文档映射，一变即失效（窗口永不卡死）", () => {
  const pressed = press(FROZEN.快照在范围内);
  assert.deepEqual(shape(revealSelection(pressed)), frozenShape(FROZEN.快照在范围内));
  const edited = pressed.update({ changes: { from: 0, insert: "改" }, selection: { anchor: 0 } }).state;
  assert.deepEqual(shape(revealSelection(edited)), shape(edited.selection), "docChanged 后应回到活选区");
});

test("窗口是每个 EditorState 各自的：一个 state 的按压不影响另一个", () => {
  const a = press(FROZEN.快照跨范围);
  const b = state(0);
  assert.deepEqual(shape(revealSelection(b)), shape(b.selection));
  assert.equal(rangeRevealsSource(b, FROM, TO), false);
  assert.equal(rangeRevealsSource(a, FROM, TO), true);
});

test("相接口径：强调范围含端点相接（M168），行级口径严格重叠（M110）", () => {
  // 强调范围：范围前一字符位不相接，两端端点与内容内部都相接（含端点）
  assert.equal(rangeRevealsSource(state(FROM - 1), FROM, TO), false);
  for (const pos of [FROM, FROM + 1, TO - 1, TO]) {
    assert.equal(rangeRevealsSource(state(pos), FROM, TO), true, `pos=${pos}`);
  }
  assert.equal(rangeRevealsSource(state(TO + 1), FROM, TO), false);
  // 行级口径：空光标落在行首不触发（严格重叠），行内位置才触发
  const lineFrom = DOC.lastIndexOf("\n", FROM - 1) + 1;
  assert.equal(touchesSource(state(lineFrom), FROM, TO), false);
  assert.equal(touchesSource(state(FROM + 2), FROM, TO), true);
});
