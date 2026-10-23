// 启动态（change app-splash-screen，design §2）：主窗首个内容帧的呈现面。
//
// 它**不是遮罩层**：壳尚未建出时启动面是整窗唯一可见内容，撤下那一帧把可见面直接交给真实壳
//（单帧 `remove()`，零动画 / 零过渡）。承载点是 `document.body` 下的独立兄弟节点 `#startup`
// ——`createShell` 用 `mount.replaceChildren(root)` 整体替换 `#app` 的子节点（src/shell.ts），
// 挂在 `#app` 里的启动面会在壳建出的一瞬间被抹掉（design §2.1）。
//
// 分层：本模块只做 DOM 与撤下时序；撤下判据的纯函数与安全阀时长在 src/startup-gate.ts；
// 阶段行文案由调用方传入（「恢复进行中」这个真实状态只有装配层知道，启动层在首帧前不读
// vault——spec「不读 vault」）。
//
// 读数（change 的「启动态的可观测性」）：首帧交付与撤下各落一条 `startup_surface` 诊断事件，
// 载荷只有阶段名 / 撤下原因 / 相对页面导航开始的毫秒数 / unix 毫秒时间戳（白名单见
// src-tauri/src/logging.rs）——不含 vault 名、路径、文件名或任何文档内容。

import "./startup-surface.css";
import { onRelabel, t } from "./copy";
import { logEvent } from "./diagnostics";
import { STARTUP_TIMEOUT_MS, startupDismissReason } from "./startup-gate";
import type { StartupDismissReason } from "./startup-gate";

/** 骨架里的树行占位条数。它只表达「结构在长出来」，MUST NOT 冒充真实条目数——
 *  所以是个与 vault 规模无关的固定值，不随任何读数变化（spec「不伪造内容」）。 */
const SKELETON_ROWS = 8;

export interface StartupSurfaceOptions {
  /** 产品名真源（`getName()` 的返回值，来自 `tauri.conf.json` 的 productName）；
   *  null = 读不到，标记整块不建（MUST NOT 显示占位名或硬编码副本）。 */
  productName: string | null;
}

/** 启动面的对外出口（装配层只经它施加状态与撤下信号）。 */
export interface StartupSurface {
  /** 阶段行：`text` 非空时显示（调用方给既有恢复中提示文案），null 时整块移除。
   *  撤下后调用是空操作（幂等）。 */
  setPhase(text: string | null): void;
  /** 启动态内「打开 vault」入口的接线（主模块装载后接到既有 `requestAddVault`）。 */
  setOpenHandler(run: () => void): void;
  /** 当前 vault 的树装载完成（`applyVault` 的 `tree.setVault` 之后）。 */
  notifyTreeReady(): void;
  /** vault 状态落到「未打开」终态（`refreshVaultStatus` 的终态分支）。 */
  notifyNoVault(): void;
  /** 启动层自身 / 主模块装载失败：撤下并让既有启动路径照走（spec 的降级路径）。 */
  degrade(): void;
  /** 首帧已交付（启动层在双 rAF 之后调用）：落首帧读数，一次。 */
  markFirstFrame(): void;
  /** 撤下后的回调（装配层据此在安全阀路径补既有恢复中态）；已撤下时立即回调。 */
  onDismiss(run: (reason: StartupDismissReason) => void): void;
}

/** 当前启动面（单例：一个页面一次启动）。主模块是动态装载的、拿不到启动层的局部变量，
 *  因此经本模块单例交接句柄——两边都只经 `startup-surface` 这一处拿到它。 */
let current: StartupSurface | null = null;

/** 当前启动面句柄；从未挂载时返回 null（调用方一律按可选处理）。 */
export function startupSurface(): StartupSurface | null {
  return current;
}

/** 建立启动面并挂到 `document.body`（`#app` 之外）。返回撤下 / 状态入口。 */
export function mountStartupSurface({ productName }: StartupSurfaceOptions): StartupSurface {
  const mountedAt = performance.now();
  const state = { treeReady: false, noVaultTerminal: false, degraded: false };

  const root = document.createElement("div");
  root.id = "startup";
  root.className = "startup";

  // 标题栏占位带：与真实壳同口径的拖拽区（启动态期间窗口仍可拖动）。容器与整条占位带都
  // MUST NOT 挂 `mousedown` + `preventDefault`——那会静默打断窗口拖拽（REVIEW.md『标题栏
  // mousedown preventDefault 打断拖拽』条）。启动面也不持焦点、不注册键盘监听、不拦事件。
  const titlebar = document.createElement("div");
  titlebar.className = "startup-titlebar";
  titlebar.setAttribute("data-tauri-drag-region", "deep");

  const body = document.createElement("div");
  body.className = "startup-body";

  const sidebar = document.createElement("div");
  sidebar.className = "startup-sidebar";
  for (let i = 0; i < SKELETON_ROWS; i += 1) {
    const row = document.createElement("div");
    row.className = "startup-row";
    const bar = document.createElement("div");
    bar.className = "startup-row-bar";
    row.append(bar);
    sidebar.append(row);
  }

  const content = document.createElement("div");
  content.className = "startup-content";
  if (productName !== null && productName !== "") {
    const mark = document.createElement("div");
    mark.className = "startup-mark";
    mark.textContent = productName;
    content.append(mark);
  }

  // 「打开 vault」入口：与树空态按钮同一形态（`.ft-open-btn` 的既有样式），回调由装配层
  // 接到既有 `requestAddVault`（同一条 dirty 前置门 + 目录选择器链路）。主模块装载之前的
  // 短暂窗口里点击是空操作——入口本身不可用才是缺陷，这里保持「可见即可达」。
  const open = document.createElement("button");
  open.type = "button";
  open.className = "ft-open-btn startup-open";
  open.textContent = t("D6");
  open.addEventListener("click", () => openHandler?.());
  content.append(open);

  const modeline = document.createElement("div");
  modeline.className = "startup-modeline";

  body.append(sidebar, content);
  root.append(titlebar, body, modeline);
  document.body.append(root);

  let phase: HTMLElement | null = null;
  let openHandler: (() => void) | null = null;
  let dismissed: StartupDismissReason | null = null;
  let firstFrameLogged = false;
  let dismissHandler: ((reason: StartupDismissReason) => void) | null = null;

  /** 落一条 `startup_surface` 读数（字段集合见本模块头部：白名单之外的一律被后端拒绝）。 */
  function logReading(phaseName: "first_frame" | "dismissed", reason?: StartupDismissReason): void {
    const fields: Record<string, string> = {
      phase: phaseName,
      ms: performance.now().toFixed(1),
      ts_unix_ms: String(Date.now()),
    };
    if (reason !== undefined) fields.reason = reason;
    logEvent("startup_surface", fields);
  }

  /** 撤下（幂等）。单帧移除，无过渡 / 无动画；先落读数再移除，读数永远先于「看不见了」。 */
  function dismiss(reason: StartupDismissReason): void {
    if (dismissed !== null) return;
    dismissed = reason;
    window.clearTimeout(timer);
    logReading("dismissed", reason);
    root.remove();
    dismissHandler?.(reason);
  }

  /** 按当前信号判一次（信号到达与安全阀到期共用这一处判据）。 */
  function evaluate(): void {
    const reason = startupDismissReason({ ...state, elapsedMs: performance.now() - mountedAt });
    if (reason !== null) dismiss(reason);
  }

  // 安全阀：恢复线程理论上一定会收尾，但网络卷这类路径可能长时间不返回——到点让路
  // （design §6 的「安全阀超时」行）。
  const timer = window.setTimeout(evaluate, STARTUP_TIMEOUT_MS);

  // 语言切换后重写入口与阶段行的文案（design §5.2 的不变量）：启动面可能在配置施加之前
  // 就上屏（启动层不写 `<html lang>`——那是 applyLanguage 的唯一职责），因此必须有一条能在
  // 运行期重跑的写入路径。阶段行由装配层在自己的重绘块里重写（它知道那句文案的来源）。
  onRelabel(() => {
    open.textContent = t("D6");
  });

  const handle: StartupSurface = {
    setPhase(text) {
      if (dismissed !== null) return;
      if (text === null) {
        phase?.remove();
        phase = null;
        return;
      }
      if (phase === null) {
        phase = document.createElement("p");
        phase.className = "startup-phase";
        content.insertBefore(phase, open);
      }
      phase.textContent = text;
    },
    setOpenHandler(run) {
      openHandler = run;
    },
    notifyTreeReady() {
      state.treeReady = true;
      evaluate();
    },
    notifyNoVault() {
      state.noVaultTerminal = true;
      evaluate();
    },
    degrade() {
      state.degraded = true;
      evaluate();
    },
    markFirstFrame() {
      if (firstFrameLogged) return;
      firstFrameLogged = true;
      logReading("first_frame");
    },
    onDismiss(run) {
      if (dismissed !== null) {
        run(dismissed);
        return;
      }
      dismissHandler = run;
    },
  };

  current = handle;
  return handle;
}
