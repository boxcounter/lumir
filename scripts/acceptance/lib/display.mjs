// 副屏放置（LUMIR_ACCEPTANCE_DISPLAY=secondary）：纯函数层 + AX 读数 / 写通道。
//
// 目标：多显示器时，把**本跑批自己的**验收窗口放到「当前焦点窗口所在屏之外」的那块屏上，
// 让 Alex 可以在另一块屏继续阅读文档。默认关闭——不设 `LUMIR_ACCEPTANCE_DISPLAY` 时本模块
// 一行都不执行，套件行为与之前逐字一致（opt-in，不改其他任务的行为）。
//
// 三条边界（README「副屏放置」节是 canonical 居所）：
//   1. 只动本跑批的验收窗口：pid 来自 `launchApp`，窗口由 `ax-window.swift` 按
//      `AXSubrole == AXStandardWindow` 选主窗；**不遍历、不移动任何其它 app 的窗口**。
//   2. 不改变「抢前台」语义：`tryForeground` 照旧在每个场景就绪后执行；CGEvent / chord 类
//      动作仍然要求窗口在前台 / 是 key window。副屏只解决「人在哪儿读文档」，不等于不抢焦点。
//   3. 失败不静默：单屏 / 写通道耗尽 / 回读不在目标屏可见区内 ⇒ `InfraError`（runner 判
//      INVALID、退出码 2），带屏幕清单、焦点屏、前后 window_bounds 与逐次写入读数。
//
// 坐标系：`ax-display.swift` 已把 `NSScreen.frame` / `visibleFrame` 折算成 Quartz 坐标
// （与 AX `window_bounds` 同一空间：原点在主屏左上、y 向下），本模块因此只做整数几何运算。
import { execFileSync } from "node:child_process";
import { InfraError, sleep } from "./util.mjs";

export const DISPLAY_ENV = "LUMIR_ACCEPTANCE_DISPLAY";
export const DISPLAY_MODES = ["primary", "secondary"];

/** 写位置 / 尺寸的有界重试口径（与 `drive.mjs` 的 AXSize 写通道同族：AX 写会瞬时失败，
 *  成功判据只有「回读等于请求值」）。3 次尝试、间隔 400ms ≥ README 合同下限 300ms。 */
export const PLACE_ATTEMPTS = 3;
export const PLACE_RETRY_DELAY_MS = 400;

/** 位置 / 尺寸回读的容差（逻辑点）：窗口管理器可能收边 1–2pt。超过这个值就判「没落到位」。 */
export const PLACEMENT_TOLERANCE = 2;

/**
 * opt-in 环境变量的唯一解析点（闭集合，写错不静默）：
 *   未设 / 空串 / `primary` → `null`（关闭，行为与之前一致）
 *   `secondary`             → `"secondary"`
 *   其它值                  → 抛 `InfraError`，由 runner 在碰任何机器资源之前退出（退出码 2）
 */
export function displayModeFromEnv(env = process.env) {
  const raw = env[DISPLAY_ENV];
  if (raw === undefined || raw === "" || raw === "primary") return null;
  if (raw === "secondary") return "secondary";
  throw new InfraError(
    `${DISPLAY_ENV} 取值非法：${JSON.stringify(raw)}——合法值：未设 / 空串 / primary（关闭）、secondary（副屏放置）`,
  );
}

function isFiniteInt(n) {
  return Number.isFinite(n) && Number.isInteger(n);
}

/** 一个矩形读数（`frame` / `visible` / `bounds`）的静态校验：缺字段或非正整数即判通道输出坏。 */
function rectOf(raw, label) {
  if (!raw || typeof raw !== "object") throw new InfraError(`ax-display 的 ${label} 不是对象：${JSON.stringify(raw)}`);
  const rect = { x: raw.x, y: raw.y, w: raw.w, h: raw.h };
  if (![rect.x, rect.y, rect.w, rect.h].every(isFiniteInt) || rect.w <= 0 || rect.h <= 0) {
    throw new InfraError(`ax-display 的 ${label} 不是合法矩形：${JSON.stringify(raw)}`);
  }
  return rect;
}

/**
 * `ax-display.swift` 的 JSON 输出 → 结构化读数。任何形态错误都按**通道坏**抛 `InfraError`：
 * 屏幕清单是本模块唯一的几何输入，读坏了不能退回「一块屏」或「0 块屏」继续走。
 */
export function parseDisplaySnapshot(raw, { source = "ax-display.swift" } = {}) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new InfraError(`${source} 输出无法解析为 JSON：${e.message}；原文：${JSON.stringify(String(raw).slice(0, 300))}`);
  }
  if (!Array.isArray(data.screens) || data.screens.length === 0) {
    throw new InfraError(`${source} 没有报告任何显示器：${JSON.stringify(String(raw).slice(0, 300))}`);
  }
  const screens = data.screens.map((s) => {
    if (!s || typeof s !== "object") throw new InfraError(`${source} 的屏幕条目不是对象：${JSON.stringify(s)}`);
    if (!isFiniteInt(s.index) || s.index < 0) throw new InfraError(`${source} 的屏幕 index 非法：${JSON.stringify(s)}`);
    if (!isFiniteInt(s.id) || s.id < 0) throw new InfraError(`${source} 的屏幕 id 非法：${JSON.stringify(s)}`);
    if (typeof s.name !== "string" || s.name === "") throw new InfraError(`${source} 的屏幕 name 非法：${JSON.stringify(s)}`);
    return {
      index: s.index,
      id: s.id,
      name: s.name,
      main: s.main === true,
      scale: Number(s.scale) || 0,
      frame: rectOf(s.frame, `屏幕 #${s.index} frame`),
      visible: rectOf(s.visible, `屏幕 #${s.index} visible`),
    };
  });
  let focus = null;
  let focusParseError = null;
  if (data.focus !== undefined && data.focus !== null) {
    const f = data.focus;
    if (typeof f !== "object") throw new InfraError(`${source} 的 focus 不是对象：${JSON.stringify(f)}`);
    try {
      focus = {
        app: typeof f.app === "string" ? f.app : "?",
        pid: isFiniteInt(f.pid) ? f.pid : null,
        bounds: rectOf(f.bounds, "focus.bounds"),
      };
    } catch (e) {
      // 焦点窗口的 bounds 读坏了（极小窗 / 最小化 / 读不到）不能拖垮整轮：屏幕清单仍可用，
      // 这里降级成「焦点屏不可判定」，由选屏逻辑退到验收窗口所在屏 / 主屏，并把原因留进证据。
      focus = null;
      focusParseError = e.message;
    }
  }
  return {
    screens,
    focus,
    focusError:
      focusParseError ??
      (typeof data.focusError === "string" && data.focusError !== "" ? data.focusError : null),
  };
}

/** 显示器身份键：用 id + name + frame 三样一起认。显示屏拔插后 id / frame 会变，匹配不上就重选。 */
export function screenKey(screen) {
  return `${screen.id}:${screen.name}:${screen.frame.x},${screen.frame.y},${screen.frame.w},${screen.frame.h}`;
}

export function screenByKey(screens, key) {
  if (!key) return null;
  return screens.find((s) => screenKey(s) === key) ?? null;
}

function pointInRect(x, y, r) {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

function intersectionArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * window_bounds 落在哪块屏：先按**窗口中心点**判（跨屏窗口按中心归属，符合直觉），中心点都
 * 不在任何屏上时（窗口大部分在屏外）退回「交集面积最大」的屏；都没有则 `null`。
 */
export function screenOfBounds(bounds, screens) {
  if (!bounds) return null;
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const byCenter = screens.find((s) => pointInRect(cx, cy, s.frame));
  if (byCenter) return byCenter.index;
  let best = null;
  for (const s of screens) {
    const area = intersectionArea(bounds, s.frame);
    if (area > 0 && (best === null || area > best.area)) best = { index: s.index, area };
  }
  return best ? best.index : null;
}

/** 焦点窗口所在屏的身份键（启动时抓一次作 hint：之后哪怕验收 app 被激活，也能回到用户原来的屏）。 */
export function focusScreenKey(snapshot) {
  if (!snapshot.focus?.bounds) return null;
  const index = screenOfBounds(snapshot.focus.bounds, snapshot.screens);
  const screen = snapshot.screens.find((s) => s.index === index);
  return screen ? screenKey(screen) : null;
}

/**
 * 单屏 fail-closed 的唯一判据：所有选屏路径的**共同入口**，包括 `previousTarget` 快路径。
 *
 * 为什么抽出来：首启选定副屏后，跑批中拔屏退化成单屏时，固定的目标屏仍可能留在清单里——
 * 早期实现在 `resolveDisplayPlan` 里先查 `previousTarget`、命中即返回，于是绕过了单屏检查，
 * 后续 restart 会「成功」返回放置计划（review-r1 P2-1）。返回错误文本，由
 * `chooseTargetScreen`（返回 `{ error }`）与 `resolveDisplayPlan`（抛 `InfraError`）分别消费。
 */
function screenCountError(screens) {
  if (screens.length >= 2) return null;
  return (
    `只检测到 ${screens.length} 块显示器（${describeScreens(screens)}）——副屏放置需要至少 2 块；` +
    `去掉 ${DISPLAY_ENV}=secondary 可在单屏上照常跑`
  );
}

/**
 * 选目标屏的纯判据：
 *   - 少于 2 块屏 ⇒ 返回 error（调用方抛 `InfraError`；单屏不静默落回主屏）；
 *   - 「用户的屏」= 焦点屏；焦点屏不可判定时退到验收窗口当前所在屏，再退到主屏；
 *   - 验收窗口已经在某块**非**用户屏上 ⇒ 保持在那块（不在两块屏之间来回搬：重启时焦点可能
 *     已经是验收 app 自己，若按「窗口所在屏」反选会把窗口搬回用户屏）；
 *   - 否则取屏幕清单里第一条非用户屏（`NSScreen.screens` 顺序：主屏在前）。
 */
export function chooseTargetScreen({ screens, focusScreenIndex = null, windowScreenIndex = null }) {
  const countError = screenCountError(screens);
  if (countError) return { error: countError };
  const valid = (i) => screens.some((s) => s.index === i);
  const fallback = screens.find((s) => s.main) ?? screens[0];
  const userIndex = valid(focusScreenIndex)
    ? focusScreenIndex
    : valid(windowScreenIndex)
      ? windowScreenIndex
      : fallback.index;
  const userScreen = screens.find((s) => s.index === userIndex);
  const others = screens.filter((s) => s.index !== userIndex);
  if (others.length === 0) {
    return {
      error: `除用户所在屏外没有其它显示器（${describeScreens(screens)}）——副屏放置不可执行`,
    };
  }
  const windowOnOther = valid(windowScreenIndex) && windowScreenIndex !== userIndex;
  const target = windowOnOther ? screens.find((s) => s.index === windowScreenIndex) : others[0];
  return {
    target,
    userScreen,
    reason: windowOnOther ? "验收窗口已在非焦点屏，保持在该屏" : "取屏幕清单里第一条非焦点屏",
  };
}

/** 把窗口尺寸钳到目标屏可见区，并把左上角放在可见区左上角（不越过菜单栏 / Dock）。 */
export function clampPlacement({ size, visible }) {
  if (!size || !(size.w > 0) || !(size.h > 0)) {
    throw new InfraError(`窗口尺寸非法：${JSON.stringify(size)}——无法计算副屏放置`);
  }
  return {
    x: visible.x,
    y: visible.y,
    w: Math.max(1, Math.min(Math.round(size.w), visible.w)),
    h: Math.max(1, Math.min(Math.round(size.h), visible.h)),
  };
}

/** 窗口矩形是否完整落在目标屏可见区内（容差内）。 */
export function placementFits(bounds, visible, tolerance = PLACEMENT_TOLERANCE) {
  return (
    bounds.x >= visible.x - tolerance &&
    bounds.y >= visible.y - tolerance &&
    bounds.x + bounds.w <= visible.x + visible.w + tolerance &&
    bounds.y + bounds.h <= visible.y + visible.h + tolerance
  );
}

/** 回读与请求值是否一致（位置与尺寸都看，容差内）。 */
export function placementMatches(bounds, want, tolerance = PLACEMENT_TOLERANCE) {
  return (
    Math.abs(bounds.x - want.x) <= tolerance &&
    Math.abs(bounds.y - want.y) <= tolerance &&
    Math.abs(bounds.w - want.w) <= tolerance &&
    Math.abs(bounds.h - want.h) <= tolerance
  );
}

/**
 * 解析「目标屏 + 放置矩形」：
 *   - **单屏检查是共同入口**：任何路径（含 `previousTarget` 快路径）先过它。跑批中拔屏退化成
 *     单屏时，固定的目标屏可能仍在清单里，但已经不存在「另一块屏」——必须抛 `InfraError`，
 *     不能因为 previousTarget 命中就返回成功（review-r1 P2-1）；
 *   - `previousTarget`（本次跑批已选定的目标屏 key）仍存在 ⇒ 沿用。重启 / 后续场景不因焦点
 *     变化而换屏（否则第一场之后焦点是验收 app 自己，会把窗口搬回用户屏）；
 *   - 否则按 `chooseTargetScreen` 重选；无其它屏 ⇒ 抛 `InfraError`（带完整读数）。
 * 纯函数：屏幕清单、焦点屏下标、窗口 bounds 都由调用方传入，单测直接构造。
 */
export function resolveDisplayPlan({ screens, focusScreenIndex, windowBounds, previousTarget }) {
  const countError = screenCountError(screens);
  if (countError) {
    throw new InfraError(
      `${countError}；验收窗口当前 ${formatBounds(windowBounds)}；检测到：${describeScreens(screens)}`,
    );
  }
  let target = screenByKey(screens, previousTarget);
  let reason = "沿用本次跑批已选定的目标显示器";
  if (!target) {
    const pick = chooseTargetScreen({ screens, focusScreenIndex, windowScreenIndex: screenOfBounds(windowBounds, screens) });
    if (pick.error) {
      throw new InfraError(
        `${pick.error}；验收窗口当前 ${formatBounds(windowBounds)}；检测到：${describeScreens(screens)}`,
      );
    }
    target = pick.target;
    reason = pick.reason;
  }
  return {
    target,
    targetKey: screenKey(target),
    placement: clampPlacement({ size: { w: windowBounds.w, h: windowBounds.h }, visible: target.visible }),
    reason,
  };
}

/** 一块屏的可读描述：身份、位置、可见区、是否主屏。 */
export function describeScreen(screen) {
  return (
    `#${screen.index} "${screen.name}" ${screen.frame.w}×${screen.frame.h} @${screen.frame.x},${screen.frame.y}` +
    `（可见 ${screen.visible.w}×${screen.visible.h} @${screen.visible.x},${screen.visible.y}${screen.main ? "，主屏" : ""}）`
  );
}

export function describeScreens(screens) {
  return screens.map(describeScreen).join(" / ");
}

export function formatBounds(bounds) {
  return `x=${bounds.x} y=${bounds.y} ${bounds.w}×${bounds.h}`;
}

function formatAttempts(history) {
  return history
    .map((a) => {
      const readback = a.readback ? `回读 ${formatBounds(a.readback)}` : "回读 无";
      return a.ok ? `#${a.attempt} 已写入（${readback}）` : `#${a.attempt} 失败（${oneLine(a.error)}）${readback}`;
    })
    .join("；");
}

function oneLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

/**
 * 写进 steps.md「前台焦点」证据行的那一行（与 `drive.mjs` 的 foregroundNote 同一落点）。
 * 必含：目标显示器身份 / frame / visibleFrame、焦点屏、窗口前后 bounds、写入次数、最终校验。
 */
export function formatDisplayNote({
  pid,
  before,
  after,
  target,
  placement,
  reason,
  focus,
  focusScreen,
  focusError,
  history,
  already,
}) {
  const focusIsSelf = Boolean(focus && focus.pid === pid);
  const focusText =
    focus?.bounds && !focusIsSelf
      ? `焦点屏 ${focusScreen ? describeScreen(focusScreen) : "不可判定"}（${focus.app} pid=${focus.pid}，窗口 ${formatBounds(focus.bounds)}）`
      : focusScreen
        ? `启动时焦点屏 ${describeScreen(focusScreen)}（当前焦点是验收 app 自己，按启动时读到的屏判）`
        : `焦点屏不可判定${focusError ? `（${focusError}）` : ""}`;
  const motion = already
    ? `${formatBounds(before)}（已在目标屏可见区内，未写入）`
    : `${formatBounds(before)} → ${formatBounds(after)}（请求位置 ${placement.x},${placement.y}，尺寸 ${placement.w}×${placement.h}）`;
  const writes = history?.length ? `，写入 ${history.length} 次${history.length > 1 ? `：${formatAttempts(history)}` : ""}` : "";
  return (
    `副屏放置：目标 ${describeScreen(target)}（${reason}）；${focusText}；窗口 ${motion}${writes}；` +
    "校验：回读在目标屏可见区内"
  );
}

// ---- Swift 通道（全部可注入，单测用假输出覆盖，不碰真机） --------------------------------------

function swiftPath(script, args, { timeout = 30_000 } = {}) {
  return execFileSync("/usr/bin/swift", [new URL(script, import.meta.url).pathname, ...args], {
    encoding: "utf8",
    timeout,
  }).trim();
}

function missingSwiftHint() {
  return "这条通道要 /usr/bin/swift（Xcode Command Line Tools）且调用进程有辅助功能权限";
}

/** 读屏幕清单 + 系统焦点窗口（`lib/ax-display.swift`）。读失败按通道项抛 `InfraError`。 */
export function readDisplaySnapshot({ run = runDisplaySwift } = {}) {
  let raw;
  try {
    raw = run();
  } catch (e) {
    throw new InfraError(`读显示器 / 系统焦点窗口失败（ax-display.swift）：${e.message}。${missingSwiftHint()}`);
  }
  return parseDisplaySnapshot(raw);
}

function runDisplaySwift() {
  return swiftPath("./ax-display.swift", []);
}

/** `ax-window.swift` 的 `--read`：返回 `{ ok, stdout, error }`（与 drive.mjs 的假 swift 注入同形）。 */
export function runWindowRead(pid) {
  try {
    return { ok: true, stdout: swiftPath("./ax-window.swift", [String(pid), "--read"]), error: null };
  } catch (e) {
    return { ok: false, stdout: "", error: String(e.message ?? e) };
  }
}

/** `ax-window.swift <pid> <w> <h> <x> <y>`：写位置 + 尺寸，返回 `{ ok, stdout, error }`。 */
export function runWindowPlace(pid, { x, y, w, h }) {
  try {
    return {
      ok: true,
      stdout: swiftPath("./ax-window.swift", [String(pid), String(w), String(h), String(x), String(y)]),
      error: null,
    };
  } catch (e) {
    return { ok: false, stdout: "", error: String(e.message ?? e) };
  }
}

/** `ax-window.swift --read` 的回读行 → bounds；读不到 / 解析不出回 null（调用方判通道失败）。 */
export function parseWindowFrameLine(out) {
  const pos = /(?:^|\s)pos=(-?\d+),(-?\d+)(?:\s|$)/.exec(String(out));
  const size = /(?:^|\s)size=(\d+)x(\d+)(?:\s|$)/.exec(String(out));
  if (!pos || !size) return null;
  return { x: Number(pos[1]), y: Number(pos[2]), w: Number(size[1]), h: Number(size[2]) };
}

function readBounds(pid, run) {
  const r = run(pid);
  if (!r?.ok) throw new InfraError(`读验收窗口 bounds 失败（ax-window.swift --read）：${oneLine(r?.error ?? "无输出")}`);
  const bounds = parseWindowFrameLine(r.stdout);
  if (!bounds) throw new InfraError(`读验收窗口 bounds 的回读行无法解析：${JSON.stringify(String(r.stdout).slice(0, 300))}`);
  return bounds;
}

/**
 * 启动预检（每个跑批一次）：读屏幕清单，少于 2 块直接抛 `InfraError`（不静默落回主屏），
 * 并返回启动时的焦点屏身份键——之后即使验收 app 被激活，也能回到用户原来的屏。
 * 这一步不移动任何窗口。
 */
export function prepareSecondaryDisplay({ run = runDisplaySwift } = {}) {
  const snapshot = readDisplaySnapshot({ run });
  if (snapshot.screens.length < 2) {
    throw new InfraError(
      `${DISPLAY_ENV}=secondary 需要至少 2 块显示器，当前只检测到 ${snapshot.screens.length} 块：` +
        `${describeScreens(snapshot.screens)}——不静默落回主屏；单屏机器请去掉该变量`,
    );
  }
  return { snapshot, focusHintKey: focusScreenKey(snapshot) };
}

/**
 * 把一个验收窗口放到副屏（只动 `pid` 这一扇主窗）：
 *   1. 读前后读数与屏幕清单；
 *   2. 解析目标屏（沿用本次跑批已选定的目标；否则按焦点屏选另一块）；
 *   3. 保留原窗口尺寸、钳到目标屏可见区，写位置 + 尺寸（有界重试，成功只认回读）；
 *   4. 重新读一次 bounds 做最终校验；不在目标屏可见区内 ⇒ `InfraError`（带完整证据）。
 * 已在该屏可见区且位置正确时不写入（重启后的幂等路径）。
 *
 * 注入点：`runRead(pid)` / `runPlace(pid, placement)` / `runSnapshot()` / `sleepFn(ms)`——单测用
 * 假输出覆盖「首次成功 / 重试后成功 / 通道耗尽 / 单屏」四类分支，不起真机、不碰 KimiCU。
 */
export async function placeWindowOnDisplay({
  pid,
  previousTarget = null,
  focusHintKey: focusHintKeyValue = null,
  runRead = runWindowRead,
  runPlace = runWindowPlace,
  runSnapshot = runDisplaySwift,
  sleepFn = sleep,
} = {}) {
  if (!pid) throw new InfraError("副屏放置缺少验收实例 pid（runner 未完成启动就绪判断）");
  const before = readBounds(pid, runRead);
  const snapshot = readDisplaySnapshot({ run: runSnapshot });
  const { screens, focus, focusError } = snapshot;

  // 焦点屏：当前焦点应用不是验收 app 时按它的窗口判；是验收 app 自己（被激活 / 重启）时用
  // 启动时抓的 hint，仍不可判定就交给 chooseTargetScreen 退回窗口所在屏 / 主屏。
  let focusScreenIndex = null;
  if (focus?.bounds && focus.pid !== pid) {
    focusScreenIndex = screenOfBounds(focus.bounds, screens);
  } else if (focusHintKeyValue) {
    focusScreenIndex = screenByKey(screens, focusHintKeyValue)?.index ?? null;
  }

  const plan = resolveDisplayPlan({ screens, focusScreenIndex, windowBounds: before, previousTarget });
  const targetIndex = plan.target.index;
  const focusScreen = screens.find((s) => s.index === focusScreenIndex) ?? null;

  const already =
    screenOfBounds(before, screens) === targetIndex &&
    placementMatches(before, plan.placement) &&
    placementFits(before, plan.target.visible);

  const history = [];
  let after = before;
  if (!already) {
    for (let attempt = 1; attempt <= PLACE_ATTEMPTS; attempt++) {
      const res = runPlace(pid, plan.placement);
      const readback = res?.ok ? parseWindowFrameLine(res.stdout) : null;
      const landed =
        readback !== null &&
        placementMatches(readback, plan.placement) &&
        placementFits(readback, plan.target.visible) &&
        screenOfBounds(readback, screens) === targetIndex;
      history.push({
        attempt,
        ok: Boolean(landed),
        error: res?.ok ? (readback ? "回读未落在目标屏可见区内" : "回读行无法解析") : oneLine(res?.error ?? "无输出"),
        readback,
        stdout: res?.stdout ?? "",
      });
      if (landed) break;
      if (attempt < PLACE_ATTEMPTS) await sleepFn(PLACE_RETRY_DELAY_MS);
    }
    if (!history.some((h) => h.ok)) {
      let final = null;
      try {
        final = readBounds(pid, runRead);
      } catch {
        /* 回读失败只进证据，不掩盖主错误 */
      }
      const focusIsSelf = Boolean(focus && focus.pid === pid);
      const focusScreenForDesc = focusScreen ?? screens.find((s) => s.index === focusScreenIndex) ?? null;
      const focusDesc =
        focus?.bounds && !focusIsSelf
          ? `${focusScreenForDesc ? describeScreen(focusScreenForDesc) : "不可判定"}（${focus.app} pid=${focus.pid}，窗口 ${formatBounds(focus.bounds)}）`
          : focusScreen
            ? `${describeScreen(focusScreen)}（启动时读取；当前焦点是验收 app 自己）`
            : `不可判定${focusError ? `（${focusError}）` : ""}`;
      throw new InfraError(
        `副屏放置失败：窗口没落到目标屏可见区内（pid ${pid}）。目标 ${describeScreen(plan.target)}；` +
          `选屏理由：${plan.reason}；焦点屏 ${focusDesc}；` +
          `窗口前 ${formatBounds(before)}；逐次写入：${formatAttempts(history)}；` +
          `最终回读 ${final ? formatBounds(final) : "读不到"}。` +
          `这是通道 / 环境项，不是场景断言失败（见 README「副屏放置」）`,
      );
    }
    after = readBounds(pid, runRead);
    const landedAfter =
      screenOfBounds(after, screens) === targetIndex &&
      placementFits(after, plan.target.visible) &&
      placementMatches(after, plan.placement);
    if (!landedAfter) {
      throw new InfraError(
        `副屏放置后复核失败：写入的回读在目标屏上，但最终回读不在（pid ${pid}）。目标 ${describeScreen(plan.target)}；` +
          `请求 ${formatBounds(plan.placement)}；最终 ${formatBounds(after)}；逐次写入：${formatAttempts(history)}。` +
          "不把「写入成功」当成「已落到位」（见 README「副屏放置」）",
      );
    }
  }

  return {
    note: formatDisplayNote({
      pid,
      before,
      after,
      target: plan.target,
      placement: plan.placement,
      reason: plan.reason,
      focus,
      focusScreen,
      focusError,
      history,
      already,
    }),
    target: plan.target,
    targetKey: plan.targetKey,
    before,
    after,
    placement: plan.placement,
    focusScreenIndex,
    screens,
    already,
  };
}
