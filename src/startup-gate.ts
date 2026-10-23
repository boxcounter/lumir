// 启动态的撤下判据（change app-splash-screen，design §2.2）：纯函数，三选一先到 + 降级显式。
//
// 为什么单独一个模块：判据的输入是「已收到的信号 + 已过时长」，输出是撤下原因或「继续」——
// 四种结局（树就绪 / 未打开终态 / 安全阀超时 / 降级）都要能脱离 DOM 断言，因此不进启动面
// 模块（tests/unit/startup-gate.test.ts 在这一层跑）。
//
// 分层：本模块只有判据与常量；DOM 与撤下时序在 src/startup-surface.ts；两个撤下信号由
// src/main.ts 挂在既有收口上（`applyVault` 的树装载完成、`refreshVaultStatus` 的未打开
// 终态），不新造状态机（design §2.2）。

/** 撤下原因（spec 的闭集合；同时也是诊断读数 `reason` 字段的取值集合）。 */
export type StartupDismissReason = "tree_ready" | "no_vault" | "timeout" | "degraded";

/** 判据的输入状态：启动面在收到信号时更新自己的副本，判据只读它。 */
export interface StartupDismissState {
  /** 当前 vault 的树装载完成（`applyVault` 的 `tree.setVault` 之后）。 */
  treeReady: boolean;
  /** vault 状态落到「未打开」终态（无 last_vault / 路径失效 / 打开失败 / 配置读失败）。 */
  noVaultTerminal: boolean;
  /** 启动面自身降级（启动层脚本异常 / 主模块装载失败）。 */
  degraded: boolean;
  /** 自启动面挂载起的经过时间（ms）。 */
  elapsedMs: number;
}

/** 安全阀时长（spec：MUST NOT 长于 10s）。恢复线程理论上一定会走 `RestoreGuard` 的收尾，
 *  但「打开网络卷上的 vault」这类路径可能长时间不返回——启动面 MUST NOT 变成困住用户的
 *  盖子，超时后让路给既有恢复中态（用户可继续等或另选 vault）。 */
export const STARTUP_TIMEOUT_MS = 10_000;

/**
 * 判据：返回要撤下时的原因，`null` = 继续在场。
 *
 * 优先级是有序的——降级（自身坏了，最先让路）> 树就绪（真话的最好结局）> 未打开终态 >
 * 安全阀。树就绪与未打开终态在真实链路上互斥（同一个 vault 状态不可能既已装载又未打开），
 * 这里的顺序只决定「两个信号同时到达」这种构造输入的确定性。
 */
export function startupDismissReason(state: StartupDismissState): StartupDismissReason | null {
  if (state.degraded) return "degraded";
  if (state.treeReady) return "tree_ready";
  if (state.noVaultTerminal) return "no_vault";
  if (state.elapsedMs >= STARTUP_TIMEOUT_MS) return "timeout";
  return null;
}
