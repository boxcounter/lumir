// 退出前的保存全部确认弹框（change add-quit-save-all-dialog-nov27）。
//
// 缺陷现场：dirty 时 ⌘Q / 关窗被后端守卫拦下，前端只弹右下角 sticky toast（旧 D232），
// 用户视线在左上角编辑器，看不到提示。本模块把拦截做成**居中模态**：说明 + 「保存全部并退出」
// + 「取消」，两条动作，没有「丢弃修改」。
//
// 分层：保存 / 退出的竞态全部在 `src/quit-flow.ts`（无 DOM 单测）；这里只做 DOM、焦点、键盘与
// 可访问性。保存复用 `save-all.ts` 的既有屏障（装配层注入 `saveAll.run`），退出只走受控的
// `app_quit` 命令（后端复核 dirty 镜像），MUST NOT 合成键盘事件。
//
// 可访问性合同：`role="dialog"` + `aria-modal` + `aria-labelledby` / `aria-describedby`；
// 背景 `#app` 置 inert（记录打开前的值，关闭时还原——设置面板可能已把它置为 inert）；
// 初始焦点主按钮；Tab / Shift+Tab 在弹框内循环；Escape 等同取消；关闭后焦点还原；
// 状态行 `role="status"`（polite），保存中 / 失败 / 退出被拒的文本变化可被读屏读到。
//
// 单例与重复事件：`open()` 幂等，已打开直接返回；保存 / 退出在途时取消路径被忽略（否则
// 用户取消后保存完成仍会退出，与「取消只关闭弹框」的承诺矛盾）。

import { onRelabel, t } from "./copy";
import { escapeDisposition, escapeRouter, registerEscapeLayer, unregisterEscapeLayer } from "./escape-router";
import { createQuitFlow } from "./quit-flow";
import type { QuitFailure, QuitFlowState } from "./quit-flow";

const LAYER_ID = "quit-save-all-dialog";

const C = {
  title: "D1068",
  body: "D1069",
  primary: "D1070",
  cancel: "D136",
  saving: "D1071",
  saveFailed: "D1072",
  dirtyRace: "D1073",
  quitRefused: "D1074",
  quitting: "D1075",
} as const;

export interface QuitDialogDeps {
  /** 遮罩挂载点（`document.body`：必须是 `#app` 的兄弟，才能把 `#app` 整体置为 inert）。 */
  mount: HTMLElement;
  /** 打开期间置 `inert` 的背景根（`#app`）。 */
  inertRoot: HTMLElement;
  /** 既有保存全部屏障（`save-all.ts` 的 `run`）。 */
  saveAll(): Promise<boolean>;
  /** 当前是否还有脏标签（全部 pane 的并集）。 */
  anyDirty(): boolean;
  /** 受控退出命令（`ipc.ts` 的 `appQuit`）。 */
  quit(): Promise<void>;
  /** 关闭后没有可还原的打开前元素时的兜底（交还编辑器）。 */
  restoreFocus(): void;
}

export interface QuitDialogHandle {
  /** 打开弹框；已打开时幂等（连续 quit_blocked 不叠弹）。 */
  open(): void;
  /** 关闭弹框（只给取消 / Escape / 点遮罩用；保存或退出在途时忽略）。 */
  close(): void;
  isOpen(): boolean;
  state(): QuitFlowState;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string): HTMLButtonElement {
  const node = element("button", className);
  node.type = "button";
  return node;
}

export function createQuitDialog(deps: QuitDialogDeps): QuitDialogHandle {
  const overlay = element("div", "lumir-quit-overlay");
  overlay.hidden = true;

  const card = element("section", "lumir-quit-card");
  card.tabIndex = -1;
  card.id = "lumir-quit-dialog";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");

  const title = element("h2", "lumir-quit-title");
  title.id = "lumir-quit-title";
  card.setAttribute("aria-labelledby", title.id);

  const body = element("p", "lumir-quit-body");
  body.id = "lumir-quit-body";
  card.setAttribute("aria-describedby", body.id);

  const status = element("p", "lumir-quit-status");
  status.setAttribute("role", "status");

  const actions = element("div", "lumir-quit-actions");
  const cancelButton = button("lumir-quit-btn lumir-quit-btn-secondary");
  const primaryButton = button("lumir-quit-btn lumir-quit-btn-primary");
  actions.append(cancelButton, primaryButton);

  card.append(title, body, status, actions);
  overlay.append(card);
  deps.mount.append(overlay);

  let returnFocus: HTMLElement | null = null;
  let previousInert = false;

  const flow = createQuitFlow({
    saveAll: deps.saveAll,
    anyDirty: deps.anyDirty,
    quit: deps.quit,
    onState: (state, failure) => render(state, failure),
  });

  function render(state: QuitFlowState, failure?: QuitFailure): void {
    const busy = state === "saving" || state === "quitting";
    primaryButton.disabled = busy;
    cancelButton.disabled = busy;
    card.setAttribute("aria-busy", busy ? "true" : "false");
    if (state === "saving") {
      status.textContent = t(C.saving);
      status.dataset.tone = "muted";
    } else if (state === "quitting") {
      status.textContent = t(C.quitting);
      status.dataset.tone = "muted";
    } else if (state === "failed") {
      status.textContent =
        failure === "dirty"
          ? t(C.dirtyRace)
          : failure === "quit"
            ? t(C.quitRefused)
            : t(C.saveFailed);
      status.dataset.tone = "error";
      // 禁用按钮会把焦点送回 body（浏览器行为）：失败后把焦点放回主按钮，键盘用户不必重新 Tab。
      if (!card.contains(document.activeElement)) primaryButton.focus();
    } else {
      status.textContent = "";
      delete status.dataset.tone;
    }
  }

  function relabel(): void {
    title.textContent = t(C.title);
    body.textContent = t(C.body);
    primaryButton.textContent = t(C.primary);
    cancelButton.textContent = t(C.cancel);
    render(flow.state(), flow.failure() ?? undefined);
  }

  function focusables(): HTMLElement[] {
    return [...card.querySelectorAll<HTMLElement>("button, [tabindex]")].filter(
      (node) =>
        !node.hasAttribute("disabled") &&
        node.tabIndex >= 0 &&
        node.getClientRects().length > 0,
    );
  }

  function moveFocus(backward: boolean): void {
    const stops = focusables();
    if (stops.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const index = active === null ? -1 : stops.indexOf(active);
    const next =
      index < 0 ? (backward ? stops.length - 1 : 0) : (index + (backward ? -1 : 1) + stops.length) % stops.length;
    stops[next]?.focus();
  }

  function requestCancel(): void {
    // 保存 / 退出在途：取消意图被消费但不关层（否则保存完成后仍会退出）。
    const state = flow.state();
    if (state === "saving" || state === "quitting") return;
    close();
  }

  function open(): void {
    if (!overlay.hidden) {
      // 已在退出中又收到拦截 = 后端没有放行（如 ExitRequested 再次看到 dirty）：回到失败态、
      // 重新启用两条动作，让用户手动重试；不叠弹、不自动重试。其余状态下的重复拦截是 no-op。
      flow.noteQuitBlocked();
      return;
    }
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousInert = deps.inertRoot.inert;
    overlay.hidden = false;
    deps.inertRoot.inert = true;
    registerEscapeLayer(LAYER_ID, requestCancel);
    flow.reset();
    render(flow.state(), flow.failure() ?? undefined);
    primaryButton.focus();
  }

  function close(): void {
    if (overlay.hidden) return;
    overlay.hidden = true;
    deps.inertRoot.inert = previousInert;
    unregisterEscapeLayer(LAYER_ID);
    flow.reset();
    const target = returnFocus;
    returnFocus = null;
    if (target !== null && target.isConnected) target.focus();
    else deps.restoreFocus();
  }

  primaryButton.addEventListener("click", () => {
    void flow.saveAndQuit();
  });
  cancelButton.addEventListener("click", () => requestCancel());

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) requestCancel();
  });

  overlay.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.defaultPrevented) return;
    const topLayer = escapeRouter.top();
    if (topLayer !== null && topLayer.id !== LAYER_ID) {
      if (escapeRouter.handle(event)) return;
    }
    const disposition = escapeDisposition(event);
    if (disposition === "close") {
      event.preventDefault();
      requestCancel();
      return;
    }
    if (disposition === "swallow") {
      event.preventDefault();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      moveFocus(event.shiftKey);
    }
  });

  relabel();
  onRelabel(relabel);

  return {
    open,
    close: requestCancel,
    isOpen: () => !overlay.hidden,
    state: () => flow.state(),
  };
}
