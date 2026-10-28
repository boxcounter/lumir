// Harness 面板的活动在场（change add-harness-activity-presence design §3）：纯函数状态机，
// 零 DOM、零定时器，可直接单测。
//
// 三件不许在这里发生的事（design §3 / r1–r3 评审）：
//   1. **不自算相位**：每条相位跃迁都委托既有的 `reduceSendPhase`（`src/harness-panel.ts`），
//      本模块只新增 `unread` 一个字段。否则 stopping 会有两个持有者（旧 reducer 一份、本模块
//      一份），快照恢复也会与本地 stopping 分叉（r1 P2-2）。
//   2. **不保存终态记忆**：r2 P2-1 删掉了 `afterTerminal`——「终态已发、尚未释放」这个窗口由
//      后端的 `in_flight`（`Finishing` 态）承担，前端只读快照，不靠本地推次序。
//   3. **不把 `harness_busy` 当在途证据**：拒绝只触发一次快照重取，因此模型里**没有**
//      「拒绝 ⇒ running」这条转移（删掉的东西不许以别的名字回来）。
//
// 未读不计数（design §3）：流式增量、工具行、通知都不构成可数的「一条消息」，任何数字都是
// 伪造读数——与 harness 既有「回到底部」钮的未读提示同一条纪律。

import { reduceSendPhase } from "./harness-panel";
import type { SendPhase } from "./harness-panel";

/** 未读档位：`null` = 无未读；`reply` = 正常结束的回复；`failure` = 错误终态。 */
export type ActivityUnread = null | "reply" | "failure";

/** 面板外部可见的活动状态。`phase` 与发送钮同源（同一份投影）。 */
export interface ActivityState {
  phase: SendPhase;
  unread: ActivityUnread;
}

/** 终态种类 = 后端的三类终态事件（成功与否由事件种类表达，不由字符串表达）。 */
export type ActivityTerminalKind = "done" | "error" | "aborted";

export type ActivityEvent =
  /** 用户发送（= 新轮开始）。 */
  | { type: "sent" }
  /** 唤醒链的自动回合（= 新轮开始；没有用户发送动作）。 */
  | { type: "auto_turn_started" }
  /** 用户点击停止（r1 P2-2：必须在此显式建模，否则 stopping 两个持有者）。 */
  | { type: "stop_clicked" }
  /** 轮次终态。`mounted` = 面板此刻是否在屏幕上（决定是否产生未读）。 */
  | { type: "terminal"; kind: ActivityTerminalKind; mounted: boolean }
  /** 进入快照（面板装载 / 切回 vault / 恢复会话）：唯一允许回填相位的快照档位。 */
  | { type: "enter_snapshot"; inFlight: boolean; epochAtRequest: number; epoch: number }
  /** 面板挂载（= 已读清算的唯一入口）。 */
  | { type: "opened" }
  /** 视图复位（切 vault / 新会话）：相位收口回 idle、未读清空。 */
  | { type: "vault_changed" }
  /** 本地收口：这一轮没有起来（发送未被受理 / 停止请求被后端拒绝为「没有在途轮次」）。
   *  与终态同一条相位出口，但不产生未读——它不是一轮内容的结束。 */
  | { type: "local_finish" };

export const INITIAL_ACTIVITY: ActivityState = { phase: "idle", unread: null };

/**
 * 进入快照是否应当应用（epoch 一致、且不在 stopping 中）。
 *
 * 单独导出是因为**接线层还要据同一判据决定 `turnOpen` 与「中途接管」标志**——判据写两遍就会
 * 分叉（REVIEW.md「同一语义两处真源」条），因此面板侧必须调这一个函数。
 */
export function enterSnapshotApplies(
  state: ActivityState,
  event: Extract<ActivityEvent, { type: "enter_snapshot" }>,
): boolean {
  if (event.epochAtRequest !== event.epoch) return false;
  // stopping 由终态收口：快照既不能把它改回 running，也不能提前收口（design §10 第 7 行）。
  return state.phase !== "stopping";
}

export function reduceActivity(state: ActivityState, event: ActivityEvent): ActivityState {
  switch (event.type) {
    case "sent":
    case "auto_turn_started":
      // 相位委托既有 reducer（忙时重复 sent 不前移，语义逐字沿用）。
      return { phase: reduceSendPhase(state.phase, { type: "sent" }), unread: state.unread };
    case "stop_clicked":
      return { phase: reduceSendPhase(state.phase, { type: "stop-clicked" }), unread: state.unread };
    case "local_finish":
      return { phase: reduceSendPhase(state.phase, { type: "finished" }), unread: state.unread };
    case "terminal": {
      // 未读只由终态产生、只在面板不在屏幕上期间产生：
      // - 在屏幕上 ⇒ 结果已经铺开，清空既有未读；
      // - 收起且正常结束 / 错误 ⇒ 分档点亮（同一会话只有一枚标记，不累计）；
      // - `aborted` 是用户自己按的，不提醒他刚做的事，既有未读也不由它清。
      let unread = state.unread;
      if (event.mounted) unread = null;
      else if (event.kind === "done") unread = "reply";
      else if (event.kind === "error") unread = "failure";
      return { phase: reduceSendPhase(state.phase, { type: "finished" }), unread };
    }
    case "enter_snapshot": {
      if (!enterSnapshotApplies(state, event)) return state;
      // 映射只产出 running / idle：恢复出的相位永远不会是 stopping。
      return { phase: event.inFlight ? "running" : "idle", unread: state.unread };
    }
    case "opened":
      return { phase: state.phase, unread: null };
    case "vault_changed":
      // 视图复位（spec「跨 vault 的口径」）：相位收口回 idle（旧 vault 那一轮的终态可能被
      // 事件过滤、永远不会到），未读随视图清空——跨 vault 的未读不在本能力范围内（D3）。
      return { phase: reduceSendPhase(state.phase, { type: "finished" }), unread: null };
  }
}
