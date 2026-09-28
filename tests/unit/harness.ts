// tests/unit/harness.ts — 单测的测试替身：只造「平台边界」，其余跑仓里那份真代码。
//
// 替身边界取在 Tauri invoke（`window.__TAURI_INTERNALS__`）与 DOM 的 toast 挂载点上，与
// tests/visual/scenes/tauri-stub.ts 同一思路（假后端、真代码路径）：src/ipc.ts、
// src/diagnostics.ts、src/save-controller.ts 全是真的，只有「机器」那一侧是假的。
// 编辑器用假 EditorHandle（真 EditorView 需要 DOM），但会话内容用真的 EditorState 承载
//（`state.doc.toString()` 就是被测代码读内容的那条路径）。

import { EditorState } from "@codemirror/state";
import type { EditorMode } from "../../src/bindings/EditorMode.ts";
import type { EditorHandle, EditorSession } from "../../src/editor.ts";
import { isEditablePath } from "../../src/preview/attachments.ts";
import type { SaveController, ToastAction, ToastFn } from "../../src/save-controller.ts";
import { createSaveController } from "../../src/save-controller.ts";

/** CommandError 形状的假错误（src/ipc.ts 的 isCommandError 正是按这两个字段判定）。 */
export function commandError(code: string, message = code): { code: string; message: string } {
  return { code, message };
}

// ---------------------------------------------------------------------------
// 假 Tauri 后端
// ---------------------------------------------------------------------------

export interface InvokeCall {
  cmd: string;
  args: Record<string, unknown>;
}

export interface FakeBackend {
  calls: InvokeCall[];
  /** log_event 的转发记录（诊断埋点断言用）。 */
  logEvents: Array<{ event: string; fields: Record<string, string> }>;
  /** 注册一个 command 的应答；抛出的值原样成为 invoke 的 reject 值。 */
  handle(cmd: string, fn: (args: any) => unknown): void;
  argsOf(cmd: string): Array<any>;
  countOf(cmd: string): number;
  reset(): void;
}

/**
 * 装上假后端并把 `window` 指回 globalThis（浏览器里 window 就是全局对象，save-controller
 * 的 `window.setTimeout` 因此照常工作，且 mock.timers 能接管它）。
 * 未注册的 command 直接以 fixture 错误 reject：静默返回 undefined 会把「测试没实现的命令」
 * 变成难归因的怪现象。
 */
export function installBackend(): FakeBackend {
  const calls: InvokeCall[] = [];
  const handlers = new Map<string, (args: any) => unknown>();
  const backend: FakeBackend = {
    calls,
    logEvents: [],
    handle: (cmd, fn) => void handlers.set(cmd, fn),
    argsOf: (cmd) => calls.filter((call) => call.cmd === cmd).map((call) => call.args),
    countOf: (cmd) => calls.filter((call) => call.cmd === cmd).length,
    reset: () => {
      calls.length = 0;
      backend.logEvents.length = 0;
    },
  };
  handlers.set("log_event", (args) => void backend.logEvents.push(args));
  handlers.set("recovery_backup", () => undefined);
  handlers.set("recovery_discard", () => undefined);
  handlers.set("recovery_list", () => []);
  handlers.set("recovery_load", () => null);
  handlers.set("recovery_base_revision", () => null);

  const host = globalThis as unknown as Record<string, unknown>;
  host.window = globalThis;
  host.__TAURI_INTERNALS__ = {
    invoke(cmd: string, args: Record<string, unknown>) {
      calls.push({ cmd, args });
      const handler = handlers.get(cmd);
      if (handler === undefined) throw commandError("fixture_unhandled", `测试替身没有实现 command：${cmd}`);
      return handler(args);
    },
  };
  return backend;
}

// ---------------------------------------------------------------------------
// 假 toast 挂载点
// ---------------------------------------------------------------------------

export interface FakeToast {
  text: string;
  actions: ToastAction[];
  sticky: boolean;
  classes: Set<string>;
  removed: boolean;
  /** toast 的返回值（save-controller 会对它 classList.add / remove）。 */
  element: HTMLElement;
}

export interface ToastHost {
  container: HTMLElement;
  toast: ToastFn;
  toasts: FakeToast[];
  /** 仍挂在界的提示（removed 的不算）。 */
  live(): FakeToast[];
  texts(): string[];
}

export function createToastHost(): ToastHost {
  const toasts: FakeToast[] = [];
  const container = {
    // save-controller 的 clearGuardToasts 走这条查询 + 逐个 el.remove()：返回真正的元素。
    querySelectorAll(selector: string) {
      const cls = selector.replace(/^\./, "");
      return toasts.filter((toast) => !toast.removed && toast.classes.has(cls)).map((toast) => toast.element);
    },
  } as unknown as HTMLElement;
  const toast: ToastFn = (text, actions = [], sticky = false) => {
    const classes = new Set<string>();
    const record: FakeToast = { text, actions, sticky, classes, removed: false, element: null as unknown as HTMLElement };
    const element = {
      classList: { add: (name: string) => void classes.add(name) },
      remove: () => void (record.removed = true),
    } as unknown as HTMLElement;
    record.element = element;
    toasts.push(record);
    return element;
  };
  return {
    container,
    toast,
    toasts,
    live: () => toasts.filter((toast) => !toast.removed),
    texts: () => toasts.map((toast) => toast.text),
  };
}

// ---------------------------------------------------------------------------
// 假编辑器
// ---------------------------------------------------------------------------

/** save-controller 真正用到的那几个方法（其余以一次显式断言替代，见 handle 处注释）。 */
type ImplementedEditor = Pick<
  EditorHandle,
  | "sessionForPath"
  | "activeSession"
  | "sessions"
  | "isDirty"
  | "markCleanOf"
  | "onDocChanged"
  | "onSessionDirty"
  | "reloadSession"
  | "activateSession"
  | "closeSession"
>;

export interface EditorDouble {
  handle: EditorHandle;
  /** 新建并激活一份文档（从 clean 开始）。`editable` 默认按注册表从 path 推（与真编辑器
   *  同源：跑的是 src/preview/attachments.ts 的 isEditablePath），显式传布尔值可造出
   *  「不可编辑文件类」的会话（image/binary 形态——生产中它们不进编辑器，这里只为覆盖
   *  saveBaseline 的不可保存分支）。 */
  open(path: string | undefined, content: string, options?: { mode?: EditorMode; editable?: boolean }): EditorSession;
  /** 改内容：换 state、按 cleanDoc 重算 dirty，并触发 onDocChanged（崩溃备份排期靠它）。 */
  edit(path: string | undefined, content: string): void;
  /** 造一个**壳态**标签（M283）：有路径、内容为空、`loaded === false`、没有落盘基准。
   *  与 `open(path, "")` 的差别只有 `loaded` 这一个标志——save-controller 的判定不读它
   *  （壳的 `dirty` 恒 false），因此这条替身同时钉住「未装载 ⇒ 不拦切换、不进保存」。 */
  openShell(path: string): EditorSession;
  activate(path: string | undefined): void;
  close(path: string | undefined): void;
  /** 改名（真内核 `remapSessionPaths` 的替身）：**只换路径**——内容、dirty 与基准全不动，
   *  与 M244「改名不改字节」的口径一致。保存链路侧的迁移由 `controller.noteRenamed` 承担。 */
  rename(from: string, to: string): void;
  /** reloadSession 的调用记录（外部修改 / 强制重载链路的断言）。 */
  reloads: Array<{ path: string | undefined; content: string }>;
}

export function createEditorDouble(): EditorDouble {
  const list: EditorSession[] = [];
  const reloads: EditorDouble["reloads"] = [];
  let active: EditorSession | undefined;
  let nextId = 1;
  const listeners = new Set<() => void>();
  /** 逐会话的 dirty 跃迁订阅者（真编辑器 onSessionDirty 的替身）：只在值真的变化时通知。 */
  const sessionDirtyListeners = new Set<(session: EditorSession, dirty: boolean) => void>();

  const find = (path: string | undefined) => list.find((session) => session.path === path);
  const stateOf = (content: string) => EditorState.create({ doc: content });

  /** 与真编辑器同口径：值真变才广播（早返回），保存链路据此对齐备份生命周期。 */
  function setDirty(session: EditorSession, next: boolean): void {
    if (session.dirty === next) return;
    session.dirty = next;
    for (const listener of sessionDirtyListeners) listener(session, next);
  }

  const implemented: ImplementedEditor = {
    sessionForPath: (path) => find(path),
    activeSession: () => active as EditorSession,
    sessions: () => list,
    isDirty: () => active?.dirty ?? false,
    markCleanOf: (path, content) => {
      const session = find(path);
      if (session === undefined) return;
      session.cleanDoc = content;
      setDirty(session, session.state.doc.toString() !== content);
    },
    onDocChanged: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    onSessionDirty: (listener) => {
      sessionDirtyListeners.add(listener);
      return () => void sessionDirtyListeners.delete(listener);
    },
    reloadSession: (session, doc, path) => {
      session.path = path;
      // 与真编辑器同口径：可编辑性随路径一起换（唯一判据 isEditablePath）。
      session.editable = isEditablePath(path);
      session.state = stateOf(doc);
      session.cleanDoc = doc;
      setDirty(session, false);
      reloads.push({ path, content: doc });
    },
    activateSession: (session) => void (active = session),
    closeSession: (session) => {
      const index = list.indexOf(session);
      if (index >= 0) list.splice(index, 1);
      if (active === session) active = list[list.length - 1];
    },
  };

  // view 与其余 EditorHandle 方法本层用不到（唯一用 view 的 restoreBackup 不在覆盖范围内）：
  // 一次显式断言，比堆十几个空实现更容易看出「这里是有意省略的」。
  const handle = implemented as unknown as EditorHandle;

  return {
    handle,
    reloads,
    open(path, content, options = {}) {
      const existing = find(path);
      const session: EditorSession = {
        id: nextId++,
        path,
        // 假编辑器的会话一律是「内容已装载」（M283 的壳态在真编辑器里由 createShellSession 造，
        // 本替身不给它建模——save-controller 的判定只读 dirty 与 path，壳态的语义等价于
        // 「有 path、dirty=false、无 basis」）。
        loaded: true,
        state: stateOf(content),
        cleanDoc: content,
        dirty: false,
        mode: options.mode ?? "md",
        editable: options.editable ?? isEditablePath(path),
        scroll: undefined,
      };
      if (existing !== undefined) list[list.indexOf(existing)] = session;
      else list.push(session);
      active = session;
      return session;
    },
    edit(path, content) {
      const session = find(path);
      if (session === undefined) throw new Error(`edit: 没有打开 ${path}`);
      session.state = stateOf(content);
      setDirty(session, content !== session.cleanDoc);
      for (const listener of listeners) listener();
    },
    openShell(path) {
      const session = this.open(path, "");
      session.loaded = false;
      return session;
    },
    activate(path) {
      const session = find(path);
      if (session === undefined) throw new Error(`activate: 没有打开 ${path}`);
      active = session;
    },
    close(path) {
      const session = find(path);
      if (session !== undefined) implemented.closeSession(session);
    },
    rename(from, to) {
      const session = find(from);
      if (session === undefined) throw new Error(`rename: 没有打开 ${from}`);
      session.path = to;
      session.editable = isEditablePath(to);
    },
  };
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

export interface Rig {
  backend: FakeBackend;
  editor: EditorDouble;
  toasts: ToastHost;
  controller: SaveController;
  /** deps 侧可断言的记录（openFile / invalidateResolve / showEditor 的调用）。 */
  deps: {
    opened: Array<{ path: string; intent: string | undefined }>;
    invalidateResolveCalls: number;
    showEditorCalls: number;
    /** 重载后的装载后对齐（M286）：恢复阅读位置的逐次路径、遮罩收口的次数。 */
    restoreReadingPositionCalls: string[];
    documentReplacedCalls: number;
  };
  /** 覆盖 deps.isNoticeHidden（覆盖层在场时 reloudDocument 会自我放弃）。 */
  noticeHidden(hidden: boolean): void;
}

export function createRig(): Rig {
  const backend = installBackend();
  const editor = createEditorDouble();
  const toasts = createToastHost();
  let hidden = true;
  const deps: Rig["deps"] = {
    opened: [],
    invalidateResolveCalls: 0,
    showEditorCalls: 0,
    restoreReadingPositionCalls: [],
    documentReplacedCalls: 0,
  };
  const controller = createSaveController({
    editor: editor.handle,
    container: toasts.container,
    toast: toasts.toast,
    openFile: async (path, intent) => {
      deps.opened.push({ path, intent });
      editor.open(path, "");
    },
    invalidateResolve: () => void (deps.invalidateResolveCalls += 1),
    showEditor: () => void (deps.showEditorCalls += 1),
    isNoticeHidden: () => hidden,
    restoreReadingPosition: (path) => void deps.restoreReadingPositionCalls.push(path),
    documentReplaced: () => void (deps.documentReplacedCalls += 1),
  });
  return {
    backend,
    editor,
    toasts,
    controller,
    deps,
    noticeHidden: (value) => void (hidden = value),
  };
}
