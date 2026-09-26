// src/table-fullscreen.ts + src/preview/table.ts 的纯逻辑层：遮罩状态机（M240，change
// table-fullscreen-view 的裁决点 1/2/4）与「可放大的表」命中判据（裁决点 3）。
//
// 为什么这一段落在这层：四条关闭路径（三条用户路径 + 一条焦点兜底）必须回到同一个收尾，
// 「关闭之后焦点归谁」只有一处判据——这类守卫用真 DOM 验就得造 DOM 替身（本层纪律不允许，
// 见 tests/unit/README.md）。实现里把状态机与 DOM 分开：DOM 只经 TableFullscreenSurface
// 进出，这里注入假 surface，断言的是**转换本身**。
//
// 不在这一层（DOM 行为，归 tests/visual/scenes/m240-table-fullscreen.spec.ts 与
// scripts/acceptance/scenarios/40-table-fullscreen-view.md）：遮罩与快照的真实开合、快照
// 几何与计算样式、克隆卫生、触发钮的 hover / 定位、容器持焦命中（DOM 事实）——最后一条在
// 无 DOM 的层里写出来只会是恒真断言（REVIEW.md 第 1 条的假绿形态），故留给视觉与真机层。

import { test } from "node:test";
import assert from "node:assert/strict";
import { createTableFullscreenState } from "../../src/table-fullscreen.ts";
import type { TableFullscreenSurface } from "../../src/table-fullscreen.ts";
import { fullscreenTableAt, tableAt } from "../../src/preview/table.ts";
import type { TableModel } from "../../src/preview/table.ts";

/** 假 surface：记动作序列，供「谁先谁后」「交还了几次焦点」这类断言。 */
function fakeSurface() {
  const calls: string[] = [];
  const surface: TableFullscreenSurface = {
    load: (source, label) => void calls.push(`load:${source === TABLE ? "grid" : "?"}:${label}`),
    show: () => void calls.push("show"),
    hide: () => void calls.push("hide"),
    focus: () => void calls.push("focus"),
    restoreFocus: () => void calls.push("restoreFocus"),
  };
  return { calls, surface };
}

/** 假源元素：状态机只把它原样透传给 surface，不碰它的任何成员。 */
const TABLE = { id: "grid" } as unknown as HTMLElement;
const LABEL = "Markdown 表格 1";

test("打开：装快照 → 显示 → 持焦，状态转为打开", () => {
  const { calls, surface } = fakeSurface();
  const state = createTableFullscreenState(surface);
  assert.equal(state.isOpen(), false);

  state.open(TABLE, LABEL);
  // 持焦在显示之后：aria-modal 的语义要求「遮罩可见时焦点在遮罩上」，顺序反过来会先
  // 焦点进入一个还不可见的层（M184 同款顺序）。
  assert.deepEqual(calls, [`load:grid:${LABEL}`, "show", "focus"]);
  assert.equal(state.isOpen(), true);
});

test("Esc 就地消费并关闭、交还焦点；其余 token 不消费也不关闭", () => {
  const { calls, surface } = fakeSurface();
  const state = createTableFullscreenState(surface);

  // 未打开时按 Esc：消费（避免落到 window 上的分发器）但不产生任何收尾动作——
  // 这条挡的是「遮罩已经关了还补一次 hide / 抢一次焦点」。
  assert.equal(state.handleKeyToken("Escape"), true);
  assert.deepEqual(calls, []);

  state.open(TABLE, LABEL);
  calls.length = 0;
  for (const token of ["Ctrl-D", "Tab", "Shift-Tab", "Enter", null, "a"]) {
    assert.equal(state.handleKeyToken(token), false, `${token} 不该被遮罩消费`);
  }
  assert.equal(state.isOpen(), true);
  assert.deepEqual(calls, [], "未消费的键不得产生任何遮罩动作");

  assert.equal(state.handleKeyToken("Escape"), true);
  assert.deepEqual(calls, ["hide", "restoreFocus"]);
  assert.equal(state.isOpen(), false);
});

test("三条用户关闭路径都交还焦点，焦点兜底（blur）不抢焦点", () => {
  for (const reason of ["escape", "overlay", "toggle"] as const) {
    const { calls, surface } = fakeSurface();
    const state = createTableFullscreenState(surface);
    state.open(TABLE, LABEL);
    calls.length = 0;
    state.close(reason);
    assert.deepEqual(calls, ["hide", "restoreFocus"], `${reason} 路径应交还焦点`);
    assert.equal(state.isOpen(), false);
  }

  const { calls, surface } = fakeSurface();
  const state = createTableFullscreenState(surface);
  state.open(TABLE, LABEL);
  calls.length = 0;
  state.close("blur");
  // 焦点本来就去了别处（在遮罩之上另开面板 / 窗口失活 / 文档代际变化）：拽回编辑器是无礼的
  //（src/toc.ts 的同一口径）。
  assert.deepEqual(calls, ["hide"]);
  assert.equal(state.isOpen(), false);
});

test("关闭之后的迟到关闭是空操作：不重复收尾、不再抢焦点", () => {
  const { calls, surface } = fakeSurface();
  const state = createTableFullscreenState(surface);
  state.open(TABLE, LABEL);

  // 真实顺序：hide() 自身会让遮罩失焦，那条 blur 回调紧跟着到达。
  state.close("overlay");
  assert.deepEqual(calls.slice(-2), ["hide", "restoreFocus"]);
  calls.length = 0;
  state.close("blur");
  state.close("escape");
  state.close("toggle");
  assert.deepEqual(calls, [], "已关闭后不得再产生任何动作");
});

test("toggle 的开-关-开序列：每次都走完整的装快照 / 显示 / 持焦", () => {
  const { calls, surface } = fakeSurface();
  const state = createTableFullscreenState(surface);

  state.open(TABLE, LABEL);
  state.close("toggle");
  state.open(TABLE, "Markdown 表格 2");
  assert.deepEqual(calls, [
    `load:grid:${LABEL}`,
    "show",
    "focus",
    "hide",
    "restoreFocus",
    "load:grid:Markdown 表格 2",
    "show",
    "focus",
  ]);
  assert.equal(state.isOpen(), true);
});

// ---------------------------------------------------------------------------
// 「可放大的表」命中判据（裁决点 3 的命中条件 ②）
// ---------------------------------------------------------------------------

function model(from: number, to: number, over: Partial<TableModel> = {}): TableModel {
  return {
    from,
    to,
    sourceBytes: to - from,
    columns: 2,
    rows: [],
    separator: { from, to: from },
    align: ["left", "left"],
    rectangular: true,
    degraded: false,
    ...over,
  };
}

test("fullscreenTableAt：caret 落在渲染为 grid 的表内 → 命中该表", () => {
  const tables = [model(10, 40), model(100, 160)];
  assert.equal(fullscreenTableAt(tables, 20)?.from, 10);
  assert.equal(fullscreenTableAt(tables, 100)?.from, 100);
  // 表的边界位属于该表（与 tableAt 同口径）。
  assert.equal(fullscreenTableAt(tables, 40)?.from, 10);
});

test("fullscreenTableAt：caret 在表外（段落 / 表间空行 / 表后）→ 不命中", () => {
  const tables = [model(10, 40), model(100, 160)];
  for (const pos of [0, 9, 41, 99, 161, 200]) {
    assert.equal(fullscreenTableAt(tables, pos), undefined, `pos=${pos} 不该命中`);
  }
});

test("fullscreenTableAt：降级表（>64 KiB / 非矩形）→ 不命中，正常表照旧命中", () => {
  const degraded = model(10, 40, { degraded: true, reason: "non-rectangular", rectangular: false });
  const oversize = model(100, 160, { degraded: true, reason: "oversize" });
  const normal = model(200, 260);
  const tables = [degraded, oversize, normal];

  // 降级表没有 grid DOM，也就没有任何打开路径——判据是结构性的，不是一条提示分支。
  assert.equal(fullscreenTableAt(tables, 20), undefined);
  assert.equal(fullscreenTableAt(tables, 120), undefined);
  // 正观测：同一批表里正常表照旧命中（负向断言不恒真）。
  assert.equal(fullscreenTableAt(tables, 220)?.from, 200);
});

test("fullscreenTableAt：非矩形但未标降级的表防御性不命中（两个条件都要）", () => {
  const tables = [model(10, 40, { rectangular: false })];
  assert.equal(fullscreenTableAt(tables, 20), undefined);
  // 同一位置 tableAt 仍能找到它（证明上面的 undefined 来自矩形性判据，不是没找到表）。
  assert.equal(tableAt(tables, 20)?.from, 10);
});

test("fullscreenTableAt：空表集 / 边界位置不抛错", () => {
  assert.equal(fullscreenTableAt([], 0), undefined);
  const tables = [model(0, 5)];
  assert.equal(fullscreenTableAt(tables, 0)?.from, 0);
  assert.equal(fullscreenTableAt(tables, -1), undefined);
});

// ---------------------------------------------------------------------------
// 文案 deck 对账（D124）与遮罩读屏名的来源
// ---------------------------------------------------------------------------

test("触发钮读屏名与文案 deck D124 逐字一致", async () => {
  const { TABLE_TRIGGER_LABEL, TABLE_TRIGGER_CLASS, TABLE_SLOT_CLASS } = await import("../../src/preview/table-trigger.ts");
  // deck（文案-Copy.md）里 D124 的中文列就是这一串；两边漂移即红（与 D120/D122 的同款对账）。
  assert.equal(TABLE_TRIGGER_LABEL, "放大查看表格");
  // 三个常量是样式 / 测试 / 克隆卫生共用的单一来源：改一处即三处一致，故这里也钉住取值。
  assert.equal(TABLE_TRIGGER_CLASS, "lumir-table-fs-trigger");
  assert.equal(TABLE_SLOT_CLASS, "cm-lp-table-slot");
});
