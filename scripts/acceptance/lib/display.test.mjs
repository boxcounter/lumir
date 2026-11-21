// scripts/acceptance/lib/display.test.mjs —— 副屏放置的选屏 / 几何钳位 / 失败归类自测。
//
// 为什么需要它：`LUMIR_ACCEPTANCE_DISPLAY=secondary` 是 opt-in 的**机器动作**——选错屏会把
// 验收窗口搬到 Alex 正在读文档的屏上，静默落回主屏又会让「副屏生效了」变成假象。选屏判据与
// 钳位因此下沉成纯函数，这里直接构造屏幕清单钉住：
//   - 焦点屏 / 窗口所在屏 / 3 屏 / 单屏的选屏结果；
//   - 保留原尺寸、超尺寸钳到 visibleFrame、负坐标屏（主屏上方的外接屏）的落点；
//   - 写通道的成功只认回读；耗尽 / 回读不在目标屏 / 最终复核失败 ⇒ InfraError（不是假绿）。
// 纪律：全部用假 snapshot / 假 swift（注入 run*），不起真机、不碰 KimiCU / 验收 vault。
//
// 跑法（经 scripts/acceptance/check-suite.sh 接入 quick 与 docs CI）：
//   node --test scripts/acceptance/lib/display.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseTargetScreen,
  clampPlacement,
  DISPLAY_ENV,
  displayModeFromEnv,
  formatBounds,
  formatDisplayNote,
  parseDisplaySnapshot,
  parseWindowFrameLine,
  placeWindowOnDisplay,
  placementFits,
  placementMatches,
  prepareSecondaryDisplay,
  resolveDisplayPlan,
  screenKey,
  screenOfBounds,
} from "./display.mjs";
import { InfraError } from "./util.mjs";

// 现场形状取自 2026-11-21 本机（内置屏 + 一台在上方的外接屏），坐标是 ax-display.swift 折算后的
// Quartz 空间：主屏 1512×982、菜单栏占 32pt；外接屏在主屏上方，y 为负。
const MAIN = {
  index: 0,
  id: 1,
  name: "Built-in Retina Display",
  main: true,
  scale: 2,
  frame: { x: 0, y: 0, w: 1512, h: 982 },
  visible: { x: 0, y: 32, w: 1512, h: 950 },
};
const SIDE = {
  index: 1,
  id: 2,
  name: "Paperlike13K",
  main: false,
  scale: 2,
  frame: { x: 127, y: -960, w: 1280, h: 960 },
  visible: { x: 127, y: -960, w: 1280, h: 960 },
};
const THIRD = {
  index: 2,
  id: 3,
  name: "Side 3",
  main: false,
  scale: 1,
  frame: { x: 1407, y: -960, w: 1024, h: 768 },
  visible: { x: 1407, y: -960, w: 1024, h: 768 },
};

const snapshotRaw = (screens, focus = null, focusError = null) => JSON.stringify({ screens, focus, focusError });
const focusOn = (screen, bounds = screen.frame) => ({ app: "Google Chrome", pid: 4232, bounds });
const windowOnMain = { x: 8, y: 40, w: 1200, h: 800 };

test("parseDisplaySnapshot：屏幕清单与焦点窗口读数原样结构化", () => {
  const snap = parseDisplaySnapshot(snapshotRaw([MAIN, SIDE], focusOn(MAIN)));
  assert.equal(snap.screens.length, 2);
  assert.deepEqual(snap.screens[0], MAIN);
  assert.deepEqual(snap.screens[1], SIDE);
  assert.deepEqual(snap.focus, focusOn(MAIN));
  assert.equal(snap.focusError, null);
});

test("parseDisplaySnapshot：焦点读不到不是失败（focusError 留档），屏幕清单仍可用", () => {
  const snap = parseDisplaySnapshot(snapshotRaw([MAIN], null, "读不到系统焦点应用（AXError -25204）"));
  assert.equal(snap.focus, null);
  assert.match(snap.focusError, /AXError -25204/);
});

test("parseDisplaySnapshot：坏 JSON / 空屏幕 / 非法矩形一律 InfraError（不退回一块屏或 0 块屏）", () => {
  assert.throws(() => parseDisplaySnapshot("not json"), (e) => e instanceof InfraError && /无法解析为 JSON/.test(e.message));
  assert.throws(
    () => parseDisplaySnapshot(snapshotRaw([])),
    (e) => e instanceof InfraError && /没有报告任何显示器/.test(e.message),
  );
  assert.throws(
    () => parseDisplaySnapshot(snapshotRaw([{ ...MAIN, frame: { x: 0, y: 0, w: 0, h: 982 } }])),
    (e) => e instanceof InfraError && /frame 不是合法矩形/.test(e.message),
  );
});

test("parseDisplaySnapshot：焦点窗口 bounds 非法 ⇒ 降级为「焦点屏不可判定」，屏幕清单不受影响", () => {
  const snap = parseDisplaySnapshot(snapshotRaw([MAIN], { app: "X", pid: 1, bounds: { x: 0, y: 0, w: 0, h: 0 } }));
  assert.equal(snap.screens.length, 1);
  assert.equal(snap.focus, null);
  assert.match(snap.focusError, /focus\.bounds/);
});

test("screenOfBounds：按窗口中心点归属，跨屏按中心，完全在屏外回 null", () => {
  assert.equal(screenOfBounds(windowOnMain, [MAIN, SIDE]), 0);
  assert.equal(screenOfBounds({ x: 300, y: -800, w: 1200, h: 800 }, [MAIN, SIDE]), 1);
  // 窗口横跨两块屏：中心落在主屏，仍归主屏（不按交集面积猜，避免 1px 抖动换义）。
  assert.equal(screenOfBounds({ x: 100, y: -300, w: 1200, h: 800 }, [MAIN, SIDE]), 0);
  assert.equal(screenOfBounds({ x: -5000, y: -5000, w: 100, h: 100 }, [MAIN, SIDE]), null);
});

test("chooseTargetScreen：焦点在主屏 ⇒ 外接屏；焦点在外接屏 ⇒ 主屏（不是「永远选非主屏」）", () => {
  const fromMain = chooseTargetScreen({
    screens: [MAIN, SIDE],
    focusScreenIndex: 0,
    windowScreenIndex: 0,
  });
  assert.equal(fromMain.target.index, 1);
  assert.equal(fromMain.userScreen.index, 0);
  const fromSide = chooseTargetScreen({
    screens: [MAIN, SIDE],
    focusScreenIndex: 1,
    windowScreenIndex: 0,
  });
  assert.equal(fromSide.target.index, 0, "用户在外接屏读文档时，验收窗口应落在主屏");
  assert.equal(fromSide.userScreen.index, 1);
});

test("chooseTargetScreen：窗口已在非焦点屏 ⇒ 保持该屏（重启不来回搬）", () => {
  const pick = chooseTargetScreen({ screens: [MAIN, SIDE, THIRD], focusScreenIndex: 0, windowScreenIndex: 2 });
  assert.equal(pick.target.index, 2);
  assert.match(pick.reason, /已在非焦点屏/);
});

test("chooseTargetScreen：焦点不可判定 ⇒ 退到窗口所在屏；三屏取第一条非用户屏", () => {
  const fallback = chooseTargetScreen({ screens: [MAIN, SIDE, THIRD], focusScreenIndex: null, windowScreenIndex: 1 });
  assert.equal(fallback.userScreen.index, 1);
  assert.equal(fallback.target.index, 0, "窗口在 #1、焦点不可判定时，用户屏按窗口屏算，目标取 #0");
  const three = chooseTargetScreen({ screens: [MAIN, SIDE, THIRD], focusScreenIndex: 0, windowScreenIndex: 0 });
  assert.equal(three.target.index, 1, "三屏时取清单里第一条非焦点屏（主屏之后的 #1）");
});

test("chooseTargetScreen：单屏 ⇒ error（不静默落回主屏），消息带屏幕清单", () => {
  const pick = chooseTargetScreen({ screens: [MAIN], focusScreenIndex: 0, windowScreenIndex: 0 });
  assert.match(pick.error, /至少 2 块/);
  assert.match(pick.error, /Built-in Retina Display/);
  assert.match(pick.error, new RegExp(DISPLAY_ENV));
});

test("clampPlacement：保留原尺寸；超尺寸钳到 visibleFrame；负坐标屏按 visible 原点落", () => {
  assert.deepEqual(clampPlacement({ size: { w: 1200, h: 800 }, visible: SIDE.visible }), {
    x: 127,
    y: -960,
    w: 1200,
    h: 800,
  });
  assert.deepEqual(clampPlacement({ size: { w: 1600, h: 1200 }, visible: SIDE.visible }), {
    x: 127,
    y: -960,
    w: 1280,
    h: 960,
  });
  assert.throws(
    () => clampPlacement({ size: { w: 0, h: 800 }, visible: SIDE.visible }),
    (e) => e instanceof InfraError && /窗口尺寸非法/.test(e.message),
  );
});

test("placementFits / placementMatches：容差内算落到位，越界与错位置都判否", () => {
  assert.equal(placementFits({ x: 127, y: -960, w: 1280, h: 960 }, SIDE.visible), true);
  assert.equal(placementFits({ x: 126, y: -961, w: 1280, h: 960 }, SIDE.visible), true, "1pt 收边在容差内");
  assert.equal(placementFits({ x: 127, y: -1000, w: 1200, h: 800 }, SIDE.visible), false, "顶边越界");
  assert.equal(placementMatches({ x: 129, y: -958, w: 1200, h: 800 }, { x: 127, y: -960, w: 1200, h: 800 }), true);
  assert.equal(placementMatches({ x: 200, y: -960, w: 1200, h: 800 }, { x: 127, y: -960, w: 1200, h: 800 }), false);
});

test("resolveDisplayPlan：previousTarget 仍存在 ⇒ 沿用（焦点变化不换屏）", () => {
  const plan = resolveDisplayPlan({
    screens: [MAIN, SIDE],
    focusScreenIndex: 1,
    windowBounds: windowOnMain,
    previousTarget: screenKey(SIDE),
  });
  assert.equal(plan.target.index, 1);
  assert.match(plan.reason, /沿用/);
  assert.deepEqual(plan.placement, { x: 127, y: -960, w: 1200, h: 800 });
});

test("resolveDisplayPlan：previousTarget 失效（拔屏 / 换布局）⇒ 按当前焦点重选", () => {
  const plan = resolveDisplayPlan({
    screens: [MAIN, SIDE],
    focusScreenIndex: 0,
    windowBounds: windowOnMain,
    previousTarget: "999:Unplugged:0,0,1,1",
  });
  assert.equal(plan.target.index, 1);
  assert.match(plan.reason, /第一条非焦点屏/);
});

test("resolveDisplayPlan：单屏抛 InfraError，消息带窗口前后语境与屏幕清单", () => {
  assert.throws(
    () => resolveDisplayPlan({ screens: [MAIN], focusScreenIndex: 0, windowBounds: windowOnMain, previousTarget: null }),
    (e) =>
      e instanceof InfraError &&
      /至少 2 块/.test(e.message) &&
      /x=8 y=40 1200×800/.test(e.message) &&
      /Built-in Retina Display/.test(e.message),
  );
});

test("displayModeFromEnv：闭集合；拼错不静默退回默认", () => {
  assert.equal(displayModeFromEnv({}), null);
  assert.equal(displayModeFromEnv({ [DISPLAY_ENV]: "" }), null);
  assert.equal(displayModeFromEnv({ [DISPLAY_ENV]: "primary" }), null);
  assert.equal(displayModeFromEnv({ [DISPLAY_ENV]: "secondary" }), "secondary");
  assert.throws(
    () => displayModeFromEnv({ [DISPLAY_ENV]: "Secondary" }),
    (e) => e instanceof InfraError && /取值非法/.test(e.message),
  );
});

test("prepareSecondaryDisplay：两屏返回启动焦点 hint；单屏 InfraError（不发起任何移动）", () => {
  const two = prepareSecondaryDisplay({ run: () => snapshotRaw([MAIN, SIDE], focusOn(MAIN)) });
  assert.equal(two.snapshot.screens.length, 2);
  assert.equal(two.focusHintKey, screenKey(MAIN));
  assert.throws(
    () => prepareSecondaryDisplay({ run: () => snapshotRaw([MAIN], focusOn(MAIN)) }),
    (e) => e instanceof InfraError && /至少 2 块/.test(e.message),
  );
});

// ---- placeWindowOnDisplay：假 swift 注入，覆盖成功 / 重试 / 耗尽 / 复核 --------------------------

const readLine = (b) => `pos=${b.x},${b.y} size=${b.w}x${b.h} window=AXStandardWindow "Lumir" windows=1`;
const placeLine = (b) => `size=${b.w}x${b.h} pos=${b.x},${b.y} window=AXStandardWindow "Lumir" windows=1`;

function harness({ screens = [MAIN, SIDE], focus = focusOn(MAIN), before = windowOnMain, reads, places }) {
  const readQueue = reads ?? [before];
  const placeQueue = places ?? [];
  const readCalls = [];
  const placeCalls = [];
  const sleeps = [];
  return {
    readCalls,
    placeCalls,
    sleeps,
    runRead: () => {
      readCalls.push(true);
      const next = readQueue[Math.min(readCalls.length - 1, readQueue.length - 1)];
      return { ok: true, stdout: readLine(next), error: null };
    },
    runPlace: (pid, placement) => {
      placeCalls.push({ pid, placement });
      const next = placeQueue[Math.min(placeCalls.length - 1, placeQueue.length - 1)];
      return next;
    },
    runSnapshot: () => snapshotRaw(screens, focus),
    sleepFn: async (ms) => {
      sleeps.push(ms);
    },
  };
}

test("placeWindowOnDisplay：成功路径保留尺寸、落到外接屏，证据含前后 bounds / 目标屏 / 焦点屏", async () => {
  const after = { x: 127, y: -960, w: 1200, h: 800 };
  const h = harness({ reads: [windowOnMain, after], places: [{ ok: true, stdout: placeLine(after) }] });
  const r = await placeWindowOnDisplay({ pid: 42, ...h });
  assert.equal(r.target.index, 1);
  assert.equal(r.targetKey, screenKey(SIDE));
  assert.deepEqual(r.before, windowOnMain);
  assert.deepEqual(r.after, after);
  assert.equal(r.already, false);
  assert.equal(h.placeCalls.length, 1);
  assert.deepEqual(h.placeCalls[0].placement, { x: 127, y: -960, w: 1200, h: 800 });
  assert.match(r.note, /副屏放置：目标 #1 "Paperlike13K" 1280×960 @127,-960/);
  assert.match(r.note, /焦点屏 #0 "Built-in Retina Display"/);
  assert.match(r.note, /x=8 y=40 1200×800 → x=127 y=-960 1200×800/);
  assert.match(r.note, /写入 1 次/);
});

test("placeWindowOnDisplay：首次写入失败、第二次成功 ⇒ 重试一次（400ms），逐次读数进证据", async () => {
  const after = { x: 127, y: -960, w: 1200, h: 800 };
  const h = harness({
    reads: [windowOnMain, after],
    places: [
      { ok: false, error: "Command failed: ax-window … 设 AXPosition 失败（AXError -25200）" },
      { ok: true, stdout: placeLine(after) },
    ],
  });
  const r = await placeWindowOnDisplay({ pid: 42, ...h });
  assert.equal(h.placeCalls.length, 2);
  assert.deepEqual(h.sleeps, [400]);
  assert.match(r.note, /写入 2 次/);
  assert.match(r.note, /#1 失败（.*AXError -25200.*）回读 无/);
  assert.match(r.note, /#2 已写入（回读 x=127 y=-960 1200×800）/);
});

test("placeWindowOnDisplay：3 次都落在错误屏 ⇒ InfraError（不把「写入成功」当成功）", async () => {
  const h = harness({
    reads: [windowOnMain, windowOnMain],
    places: [{ ok: true, stdout: placeLine(windowOnMain) }],
  });
  await assert.rejects(
    () => placeWindowOnDisplay({ pid: 42, ...h }),
    (e) =>
      e instanceof InfraError &&
      /没落到目标屏可见区内/.test(e.message) &&
      /Paperlike13K/.test(e.message) &&
      /逐次写入/.test(e.message) &&
      /最终回读/.test(e.message),
  );
  assert.equal(h.placeCalls.length, 3, "有界重试：至多 3 次");
  assert.deepEqual(h.sleeps, [400, 400]);
});

test("placeWindowOnDisplay：单屏 ⇒ 任何写入之前就 InfraError，消息带屏幕数与变量名", async () => {
  const h = harness({ screens: [MAIN], focus: focusOn(MAIN), reads: [windowOnMain], places: [] });
  await assert.rejects(
    () => placeWindowOnDisplay({ pid: 42, ...h }),
    (e) => e instanceof InfraError && /至少 2 块/.test(e.message) && new RegExp(DISPLAY_ENV).test(e.message),
  );
  assert.equal(h.placeCalls.length, 0, "单屏不得先试写一次再报错");
});

test("placeWindowOnDisplay：已在目标屏可见区内 ⇒ 不写入（幂等路径）", async () => {
  const already = { x: 127, y: -960, w: 1200, h: 800 };
  const h = harness({ reads: [already, already], places: [] });
  const r = await placeWindowOnDisplay({ pid: 42, ...h });
  assert.equal(r.already, true);
  assert.equal(h.placeCalls.length, 0);
  assert.match(r.note, /已在目标屏可见区内，未写入/);
});

test("placeWindowOnDisplay：焦点是验收 app 自己时用启动 hint（不被自己激活带偏）", async () => {
  const selfFocus = { app: "Lumir", pid: 42, bounds: { x: -5000, y: -5000, w: 100, h: 100 } };
  const after = { x: 127, y: -960, w: 1200, h: 800 };
  const h = harness({
    screens: [MAIN, SIDE],
    focus: selfFocus,
    reads: [windowOnMain, after],
    places: [{ ok: true, stdout: placeLine(after) }],
  });
  const r = await placeWindowOnDisplay({ pid: 42, focusHintKey: screenKey(MAIN), ...h });
  assert.equal(r.target.index, 1, "hint 说用户在 #0，目标应是 #1");
  assert.match(r.note, /启动时焦点屏 #0/);
});

test("placeWindowOnDisplay：写入回读正确但最终复核换了屏 ⇒ InfraError（不静默假绿）", async () => {
  const after = { x: 127, y: -960, w: 1200, h: 800 };
  const h = harness({
    reads: [windowOnMain, windowOnMain], // 第一次 before；写入后复核读到窗口仍在主屏
    places: [{ ok: true, stdout: placeLine(after) }],
  });
  await assert.rejects(
    () => placeWindowOnDisplay({ pid: 42, ...h }),
    (e) => e instanceof InfraError && /复核失败/.test(e.message) && /最终/.test(e.message),
  );
});

test("parseWindowFrameLine：兼容 --read（pos 在前）与写入回读（size 在前），缺一即 null", () => {
  assert.deepEqual(parseWindowFrameLine(readLine({ x: -12, y: 40, w: 1200, h: 800 })), {
    x: -12,
    y: 40,
    w: 1200,
    h: 800,
  });
  assert.deepEqual(parseWindowFrameLine(placeLine({ x: 127, y: -960, w: 1200, h: 800 })), {
    x: 127,
    y: -960,
    w: 1200,
    h: 800,
  });
  assert.equal(parseWindowFrameLine("size=1200x800 window=…"), null);
  assert.equal(parseWindowFrameLine("pos=1,2 window=…"), null);
});

test("formatDisplayNote：目标屏身份 / 位置、焦点屏、前后 bounds 都在一行里", () => {
  const note = formatDisplayNote({
    pid: 42,
    before: windowOnMain,
    after: { x: 127, y: -960, w: 1200, h: 800 },
    target: SIDE,
    placement: { x: 127, y: -960, w: 1200, h: 800 },
    reason: "取屏幕清单里第一条非焦点屏",
    focus: focusOn(MAIN),
    focusScreen: MAIN,
    focusError: null,
    history: [{ attempt: 1, ok: true, error: null, readback: { x: 127, y: -960, w: 1200, h: 800 } }],
    already: false,
  });
  assert.match(note, /目标 #1 "Paperlike13K" 1280×960 @127,-960（可见 1280×960 @127,-960）/);
  assert.match(note, /焦点屏 #0 "Built-in Retina Display"/);
  assert.match(note, new RegExp(`窗口 x=8 y=40 1200×800 → x=127 y=-960 1200×800`));
  assert.match(note, /校验：回读在目标屏可见区内/);
  assert.equal(formatBounds({ x: 1, y: -2, w: 3, h: 4 }), "x=1 y=-2 3×4");
});
