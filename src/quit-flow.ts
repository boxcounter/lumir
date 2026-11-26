// 退出弹框的**纯逻辑层**（change add-quit-save-all-dialog-nov27）。
//
// 为什么与 DOM 分开：退出是唯一会结束进程的动作，保存与退出之间的竞态（保存期间新 dirty、
// 弹框关闭后保存才完成、重复触发、退出被后端拒绝）必须能在无 DOM、无 Tauri 的单测里驱动。
// 视图层（`src/quit-dialog.ts`）只负责渲染状态、焦点与键盘；本模块不碰 DOM、不取文案。
//
// 两层防线（与 `src/save-all.ts` 同一口径）：
//   1. 保存全部屏障自己的最后复查（同步后 `anyDirty()`）；
//   2. 本模块在屏障返回成功之后、请求退出之前**再同步查一次**本地 dirty——两道都通过才退出。
// 后端 `app_quit` 另有第三道：命令内复核 dirty 镜像为 false（`src-tauri/src/commands.rs`）。
//
// 代次（generation）只服务一件事：弹框关闭 / 复位之后，**在途**的保存完成不得补发一次退出。
// 没有它，用户在保存期间关掉弹框（防御性分支，正常 UI 已禁用），保存完成时会静默退出。

/** 退出流程的状态。`closed` 是视图的显隐，不属于本状态机。 */
export type QuitFlowState = "idle" | "saving" | "quitting" | "failed";

/** 失败原因：保存未闭环 / 保存后又出现新 dirty / 退出请求未被受理。 */
export type QuitFailure = "save" | "dirty" | "quit";

export interface QuitFlowDeps {
  /** 既有保存全部屏障（`save-all.ts` 的 `run`）：只有全部成功才返回 true。 */
  saveAll(): Promise<boolean>;
  /** 当前是否还有脏标签（全部 pane 的并集）；在屏障成功之后同步复查。 */
  anyDirty(): boolean;
  /** 受控退出命令；reject = 后端拒绝（dirty 镜像仍为 true）或通道失败。 */
  quit(): Promise<void>;
  /** 状态变化（视图据此渲染；失败原因只在 `failed` 时给出）。 */
  onState(state: QuitFlowState, failure?: QuitFailure): void;
}

export interface QuitFlow {
  /** 执行一次「保存全部并退出」；返回本次是否真的发出了退出请求（失败 / 并发 / 代次失效都是 false）。 */
  saveAndQuit(): Promise<boolean>;
  /** 复位：推进代次并回到 idle。在途保存的完成结果随之作废（不补退出）。 */
  reset(): void;
  /** 退出在途时后端又拦下了一次（例如 ExitRequested 再次看到 dirty）：回到 failed(quit)，
   *  让用户手动重试。不是 quitting 时是 no-op（重复拦截不改变当前状态）。 */
  noteQuitBlocked(): void;
  state(): QuitFlowState;
  failure(): QuitFailure | null;
}

export function createQuitFlow(deps: QuitFlowDeps): QuitFlow {
  let state: QuitFlowState = "idle";
  let failure: QuitFailure | null = null;
  let generation = 0;

  const set = (next: QuitFlowState, why: QuitFailure | null = null): void => {
    state = next;
    failure = why;
    deps.onState(next, why ?? undefined);
  };

  async function saveAndQuit(): Promise<boolean> {
    // 单飞：保存 / 退出在途时重复触发一律拒绝（视图也禁用按钮，这里是第二道，不靠 UI 单独承担）。
    if (state === "saving" || state === "quitting") return false;
    const gen = ++generation;
    set("saving");
    let saved: boolean;
    try {
      saved = await deps.saveAll();
    } catch {
      saved = false;
    }
    // 弹框已关闭 / 已复位：本次保存的完成结果不得补发退出。
    if (gen !== generation) return false;
    if (!saved) {
      set("failed", "save");
      return false;
    }
    // 屏障成功之后、退出之前的最后一道本地复查（后端命令还会复核 dirty 镜像）。
    if (deps.anyDirty()) {
      set("failed", "dirty");
      return false;
    }
    set("quitting");
    try {
      await deps.quit();
    } catch {
      if (gen !== generation) return false;
      set("failed", "quit");
      return false;
    }
    // 退出命令受理后进程即将结束；即使 invoke 提前 resolve，也不回退状态、不重试。
    if (gen !== generation) return false;
    return true;
  }

  function reset(): void {
    generation += 1;
    if (state !== "idle" || failure !== null) set("idle");
  }

  function noteQuitBlocked(): void {
    if (state !== "quitting") return;
    // 在途退出请求的代次作废：它此后无论 resolve 还是 reject 都不得再改状态 / 报成功。
    generation += 1;
    set("failed", "quit");
  }

  return {
    saveAndQuit,
    reset,
    noteQuitBlocked,
    state: () => state,
    failure: () => failure,
  };
}
