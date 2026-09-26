// 内容区域宽度（change content-width-drag，节点 1 裁决 2026-09-25 → **2026-09-26 Alex 修订**：
// D1 默认 760、D2 上下限 [760, 1200]、D4 live 拖拽、D5 手柄进 code 模式）——栏宽 token 的**唯一
// 写入通道名**、TS 侧默认/上下限镜像常量、对称换算与钳制纯函数，以及双侧手柄的拖拽控制器。
//
// 栏宽 = `.cm-scroller` grid 中列轨道 `minmax(0, var(--layout-doc-measure))`（src/editor.ts），
// 语义是**上限**：窗口不够宽时中列收缩到可用宽度。token 写在 `documentElement` 上
//（与 typography 的 `--editor-font-size` 同一条路），天然覆盖全部会话与 md/code 两种模式。
//
// 三处出厂默认写值的处置（与 font_size 同族，REVIEW.md 第 8 条）：Rust
// `src-tauri/src/config.rs` 的 `DEFAULT_CONTENT_WIDTH` / 本文件的 `DEFAULT_CONTENT_WIDTH` /
// `src/style.css` 的 `--layout-doc-measure` 默认值。三处同值、互指注释、各有断言钉住，
// 改一处必须同步其余两处。

/** 栏宽 token 名（单一来源）：CSS 声明处按字面量写（样式表不是 JS），JS 的写入点引这里。 */
export const CONTENT_WIDTH_TOKEN = "--layout-doc-measure";

/** 阅读栏宽出厂默认（框宽 px，D1 落槌值 → 2026-09-26 Alex 修订为 760）。
 *  与 Rust 侧 `DEFAULT_CONTENT_WIDTH` 同值。 */
export const DEFAULT_CONTENT_WIDTH = 760;

/** 栏宽钳制区间（含端点，D2 落槌值 → 2026-09-26 修订为 [760, 1200]——**默认值即下限**，
 *  拖拽只能往宽调）。与 Rust 侧的
 *  `CONTENT_WIDTH_MIN` / `CONTENT_WIDTH_MAX` 同值：Rust 侧管**配置值**的合法区间
 * （越界回落默认 + warning），这里管**运行期拖拽**的钳制。 */
export const CONTENT_WIDTH_MIN = 760;
export const CONTENT_WIDTH_MAX = 1200;

/** 手柄读屏名（文案 D120）。产品命名以提案为准：内容区域宽度拖拽调整。 */
export const WIDTH_HANDLE_LABEL = "调整内容宽度";

/** 写盘失败 toast（文案 D121）：`{原因}` 处填后端错误人话。运行期宽度不回滚。 */
export const WIDTH_SAVE_FAILED_TEXT = (reason: string): string =>
  `内容宽度没能存进配置：${reason}（本次调整仍生效，重启后恢复）`;

/** 把任意栏宽读数归一进合法区间（越界时取端点）。 */
export function clampContentWidth(width: number): number {
  return Math.min(CONTENT_WIDTH_MAX, Math.max(CONTENT_WIDTH_MIN, width));
}

/**
 * 对称拖拽换算（纯函数）：`deltaX` 是**已带方向**的指针位移（向右/向外为正）——右缘手柄传
 * `x - x0`，左缘手柄传 `-(x - x0)`（向左拖是放宽）。栏宽变化 = 2 × 位移（两侧对称），
 * 取整到整数 px（读数可逐值比对，与 `nextFontSize` 的取整理由同），再钳到上下限。
 */
export function nextContentWidth(startWidth: number, deltaX: number): number {
  return clampContentWidth(Math.round(startWidth + 2 * deltaX));
}

/** 拖拽控制器的依赖（DOM 归属在 src/shell.ts，宽度的施加与持久化回调由装配层注入）。 */
export interface ContentWidthDragDeps {
  /** 编辑器 pane（手柄的坐标参照系：定位换算到 pane 内坐标）。 */
  pane: HTMLElement;
  /** 手柄覆盖层容器与两条手柄条（左/右缘），由 shell 建好交进来。 */
  overlay: HTMLElement;
  leftHandle: HTMLElement;
  rightHandle: HTMLElement;
  /** `.cm-content`（列缘矩形的读取对象）与 `.cm-scroller`（横向滚动会移动列缘）。 */
  content: HTMLElement;
  scroller: HTMLElement;
  /** 当前生效栏宽（运行期真源在 editor 闭包里）。 */
  getWidth(): number;
  /** 施加新栏宽（写 token + 显式重测量，editor.setContentWidth 那条唯一路径）。 */
  setWidth(width: number): void;
  /** 松手且值有变化时回调一次（持久化入口；拖拽过程零回调、零写盘）。 */
  onCommit(width: number): void;
}

export interface ContentWidthDrag {
  /** 空态（无前台文档 / 覆盖层在）时隐藏手柄；恢复可见时重新定位。判定复用装配层
   *  `showEditor` / `showNotice` 的状态分叉，不另造「有无文档」的布尔。 */
  setVisible(visible: boolean): void;
  /** 重新读取 `.cm-content` 矩形并贴合手柄（pane 缩放、模式切换、会话切换后由装配层调用；
   *  pane/内容的 ResizeObserver 与 scroller 的 scroll 由控制器自己监听）。 */
  reposition(): void;
  /** 拆监听（测试与重建路径用）。 */
  destroy(): void;
}

/**
 * 双侧栏宽拖拽手柄（D5：md 与 code 模式同一条轨道，手柄按 `.cm-content` 实测矩形定位——
 * code 模式列不居中，纯 CSS 百分比定位在两种模式间不一致）。
 *
 * 交互口径（提案「手柄交互面」表）：常态不可见（2px 视觉线 opacity 0），hover 命中区
 *（10px，列缘两侧各 5px）或拖拽全程显现；`setPointerCapture` 锁定指针，拖出命中区不中断；
 * 拖拽每帧经 rAF 合并后 live 施加（D4）；持久化只在松手且值有变化时发生一次（onCommit）。
 */
export function createContentWidthDrag(deps: ContentWidthDragDeps): ContentWidthDrag {
  const { pane, overlay, leftHandle, rightHandle, content, scroller, getWidth, setWidth, onCommit } = deps;

  function position(): void {
    if (overlay.hidden) return;
    const rect = content.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    // 命中区 10px：视觉线贴列缘，命中区向两侧各伸 5px。
    leftHandle.style.left = `${rect.left - paneRect.left - 5}px`;
    rightHandle.style.left = `${rect.right - paneRect.left - 5}px`;
  }

  // 列缘矩形的移动来源：pane 缩放（md 居中 / code 等分都随之动）、内容自身尺寸变化
  //（栏宽施加后）、横向滚动（line_wrap = false 时）。三条都在控制器内自闭环；
  // 模式 / 会话切换不改变尺寸但可能改位置（gutter 进出），由装配层显式调 reposition()。
  const paneObserver = new ResizeObserver(position);
  paneObserver.observe(pane);
  const contentObserver = new ResizeObserver(position);
  contentObserver.observe(content);
  scroller.addEventListener("scroll", position, { passive: true });

  // 拖拽状态：指针捕获期间所有 move/up 都落到按下的那条手柄上。
  let drag: { pointerId: number; startX: number; startWidth: number; sign: 1 | -1; handle: HTMLElement } | null = null;
  let rafScheduled = false;
  let pendingX = 0;

  function onPointerDown(side: 1 | -1) {
    return (event: PointerEvent) => {
      if (event.button !== 0) return;
      const handle = side === 1 ? rightHandle : leftHandle;
      handle.setPointerCapture(event.pointerId);
      drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: getWidth(), sign: side, handle };
      pendingX = event.clientX;
      overlay.classList.add("dragging");
      event.preventDefault(); // 命中区内不触发文本选择
    };
  }

  function onPointerMove(event: PointerEvent): void {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    pendingX = event.clientX;
    if (rafScheduled) return; // 同帧多次 move 只施加最后一次
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      if (drag === null) return;
      setWidth(nextContentWidth(drag.startWidth, drag.sign * (pendingX - drag.startX)));
    });
  }

  function endDrag(event: PointerEvent): void {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const { startWidth } = drag;
    drag = null;
    overlay.classList.remove("dragging");
    const width = getWidth();
    if (width !== startWidth) onCommit(width);
  }

  const downLeft = onPointerDown(-1);
  const downRight = onPointerDown(1);
  leftHandle.addEventListener("pointerdown", downLeft);
  rightHandle.addEventListener("pointerdown", downRight);
  for (const handle of [leftHandle, rightHandle]) {
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
  }

  overlay.hidden = true; // 装配层 showEditor 之前是空态，手柄不出现
  return {
    setVisible(visible: boolean) {
      overlay.hidden = !visible;
      if (visible) position();
    },
    reposition: position,
    destroy() {
      paneObserver.disconnect();
      contentObserver.disconnect();
      scroller.removeEventListener("scroll", position);
      leftHandle.removeEventListener("pointerdown", downLeft);
      rightHandle.removeEventListener("pointerdown", downRight);
      for (const handle of [leftHandle, rightHandle]) {
        handle.removeEventListener("pointermove", onPointerMove);
        handle.removeEventListener("pointerup", endDrag);
        handle.removeEventListener("pointercancel", endDrag);
      }
    },
  };
}
