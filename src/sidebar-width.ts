// 左栏宽度（change add-sidebar-resize-hide-and-root-create，Alex 2026-10-23 需求原话：
// 「左栏：可以通过拖拽调整宽度；可以隐藏，需要有快捷键」）——宽度 token 的唯一写入通道名、
// TS 侧默认/区间镜像常量、两层钳制纯函数，以及分隔条的拖拽控制器。
//
// 真源与写入点（design §1.1）：唯一运行期真源 = `documentElement` 上的 `--layout-sidebar-w`。
// `.app-shell` 的网格首列（src/style.css）与 `.titlebar-traffic` 的宽读同一 token，标题栏与
// 侧栏因此像素对齐，不存在第二份宽度数值。施加点只有一处：装配层 `main.ts` 的
// `applySidebarWidth`。
//
// 三处出厂默认写值（与 content-width / font_size 同族，REVIEW.md「同一语义两处真源」条）：
// Rust `src-tauri/src/config.rs` 的 `DEFAULT_SIDEBAR_WIDTH` / 本文件 `DEFAULT_SIDEBAR_WIDTH` /
// `src/style.css` 的 `--layout-sidebar-w` 默认值。三处同值、互指注释、各有断言钉住。
//
// 两层钳制（design §1.2 / §8.1）：
//   - 静态区间 `[SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX]` 管**用户意图值**（＝落盘值）；
//   - 运行期再按 `min(480, 窗口宽 × 0.4)` 钳一次，只影响**显示**（不写盘）——窗口很窄时不让
//     左栏吃掉正文；窗口恢复后按意图值重新施加。
//
// 收起态（⌘B）不是本模块的事：状态是 `.app-shell` 上的 class，命令实现与焦点交接在装配层
//（几何口径见 src/style.css，spec 见 ui-design-system「应用骨架布局」）。

import { t } from "./copy";

/** 宽度 token 名（单一来源）：CSS 声明处按字面量写（样式表不是 JS），装配层的写入点引这里。 */
export const SIDEBAR_WIDTH_TOKEN = "--layout-sidebar-w";

/** 左栏宽度出厂默认（px，D1 裁决 236）。与 Rust 侧 `DEFAULT_SIDEBAR_WIDTH`、CSS 的
 *  `--layout-sidebar-w` 默认值同值。默认值刻意保持不动：视觉基线与此处的 token 一致。 */
export const DEFAULT_SIDEBAR_WIDTH = 236;

/** 宽度合法区间（含端点，D1 裁决 [180, 480]）：与 Rust 侧 `SIDEBAR_WIDTH_MIN` /
 *  `SIDEBAR_WIDTH_MAX` 同值。Rust 管**配置值**（越界回落默认 + warning），这里管**运行期
 *  拖拽**的钳制。 */
export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 480;

/** 运行期窗口钳制的比例（design §1.2：窗口过窄时左栏不超过窗口宽度的四成）。 */
export const SIDEBAR_WIDTH_VIEWPORT_RATIO = 0.4;

/** 收起态的 class（`.app-shell` 上；运行期态、不落盘——design 的 D2）。class 名只在这里
 *  出现一次，装配层与 CSS 共用这一份字面量（CSS 侧手写同名，样式表不是 JS）。 */
export const SIDEBAR_HIDDEN_CLASS = "is-sidebar-hidden";

/** 分隔条的读屏名（文案 D549）。**函数**：读屏名是可见文案，语言切换后由装配层重跑写入点
 *  取新值（与 `WIDTH_HANDLE_LABEL` 同款，M282 起文案一律经 `t()`）。 */
export const SIDEBAR_DIVIDER_LABEL = (): string => t("D549");

/** 写盘失败 toast（文案 D550）：`{reason}` 处填后端错误人话。运行期宽度不回滚（与 D121 同
 *  口径：本次调整仍生效，重启后恢复）。 */
export const SIDEBAR_SAVE_FAILED_TEXT = (reason: string): string => t("D550", { reason });

/** 把任意宽度读数归一进静态区间（越界取端点，取整到整数 px）。非有限值回落默认值。 */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.round(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, width)));
}

/** 当前窗口允许的最大显示宽度：`min(480, floor(窗口宽 × 0.4))`。窗口读数不可用（0 / NaN）
 *  时退回静态上限——不因为一次读不到就把侧栏压到 0。 */
export function sidebarWidthLimit(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return SIDEBAR_WIDTH_MAX;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.floor(viewportWidth * SIDEBAR_WIDTH_VIEWPORT_RATIO));
}

/**
 * 运行期显示钳制（只影响显示，不写盘）：把意图值夹进
 * `[min(180, limit), limit]`。窗口窄到 `limit < 180` 时下限跟着放宽（否则空区间无解），
 * 这是 design §8.1 如实登记的边界。
 */
export function clampSidebarWidthForViewport(width: number, viewportWidth: number): number {
  const limit = sidebarWidthLimit(viewportWidth);
  const lower = Math.min(SIDEBAR_WIDTH_MIN, limit);
  const value = Number.isFinite(width) ? width : DEFAULT_SIDEBAR_WIDTH;
  return Math.round(Math.max(lower, Math.min(limit, value)));
}

/** 拖拽控制器的依赖（DOM 归属在 src/shell.ts，施加与持久化回调由装配层注入）。 */
export interface SidebarDragDeps {
  /** 分隔条元素（`role=separator` 的透明命中带）。 */
  divider: HTMLElement;
  /** 当前**用户意图宽度**（静态区间内的值；真源在装配层）。 */
  getWidth(): number;
  /** 施加新意图宽度（装配层唯一的写入点：存意图值 + 写 token + 更新 aria-valuenow）。 */
  setWidth(width: number): void;
  /** 松手且值有变化时回调一次（持久化入口；拖拽过程零回调、零写盘、零 IPC）。 */
  onCommit(width: number): void;
}

export interface SidebarDrag {
  /** 拆监听（分隔条移除前先摘干净；测试与重建路径用）。 */
  destroy(): void;
}

/**
 * 分隔条拖拽控制器（design §1.2）：`pointerdown` → `setPointerCapture` → 每次 `pointermove`
 * 只记读数，rAF 合并后施加一次（拖拽期零 IPC、零布局读取）；`pointerup` 时若意图值有变化
 * 才回调一次提交。与 `src/content-width.ts` 的 `createContentWidthDrag` 同一条结构——差别只在
 * 方向（右拖变宽）与钳制的第二层（窗口四成）。
 */
export function createSidebarDrag(deps: SidebarDragDeps): SidebarDrag {
  const { divider, getWidth, setWidth, onCommit } = deps;
  let drag: { pointerId: number; startX: number; startWidth: number } | null = null;
  let rafScheduled = false;
  let pendingX = 0;

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    divider.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: getWidth() };
    pendingX = event.clientX;
    divider.classList.add("dragging");
    event.preventDefault(); // 命中区内不触发文本选择
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    pendingX = event.clientX;
    if (rafScheduled) return; // 同帧多次 move 只施加最后一次
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      if (drag === null) return;
      setWidth(clampSidebarWidth(drag.startWidth + (pendingX - drag.startX)));
    });
  };

  const endDrag = (event: PointerEvent): void => {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const { startWidth } = drag;
    drag = null;
    divider.classList.remove("dragging");
    const width = getWidth();
    if (width !== startWidth) onCommit(width);
  };

  divider.addEventListener("pointerdown", onPointerDown);
  divider.addEventListener("pointermove", onPointerMove);
  divider.addEventListener("pointerup", endDrag);
  divider.addEventListener("pointercancel", endDrag);
  return {
    destroy() {
      divider.removeEventListener("pointerdown", onPointerDown);
      divider.removeEventListener("pointermove", onPointerMove);
      divider.removeEventListener("pointerup", endDrag);
      divider.removeEventListener("pointercancel", endDrag);
    },
  };
}
