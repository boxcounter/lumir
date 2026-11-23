// Harness 面板的活动在场（change add-harness-activity-presence design §3）：纯函数状态机，
// 零 DOM、零定时器，可直接单测。
//
// change extend-harness-activity-across-vaults-nov23 起，本模块同时承载**按 vault 键控的
// store**（`createVaultActivityStore`）：记录仍是 `{ phase, unread }`，转移规则逐条沿用下方
// 的 `reduceActivity`——store 只把「面板是否在屏幕上」换成「该 vault 的 transcript 是否在
// 屏幕上」，MUST NOT 另立第二套相位状态机（design §2.2 不变量 2）。
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
      // 视图复位（换会话）：相位收口回 idle、未读清空。change
      // extend-harness-activity-across-vaults-nov23 起这条只由「换会话」的发起 vault 触发
      //（store 的 `reset_view`），切换 vault 本身不清任何记录——跨 vault 的未读由显示门
      //（该 vault 是否当前 + pane 是否在场）判定，见 `activityDisplayed`。
      return { phase: reduceSendPhase(state.phase, { type: "finished" }), unread: null };
  }
}

// ── 按 vault 键控的 store（change extend-harness-activity-across-vaults-nov23 design §3.1）──
//
// 单一生产者：`unread` 只由本 store 的终态转移产生；标题栏钮与切换器行都只渲染、不写
//（design §2.2 不变量 1）。键是**后端根路径串**（`event.vault` / 当前 vault 根），不是注册表
// 原值——两者的旧拼写差异按 fail-closed 处理（查不到 = 无记录，见 design §9.2）。

/** 进入快照的判据（单一真源）：store 只接受已判定可应用的快照事件。 */
export type ActivitySnapshotEvent = Extract<ActivityEvent, { type: "enter_snapshot" }>;

/** store 的事件面：跨 vault 的输入（design §3.1）。逐条映射到 `reduceActivity` 的既有转移。 */
export type VaultActivityEvent =
  /** 轮次开始：本地发送的乐观起点（同步拒绝时按发送前的记录回滚）或后端 `auto_turn_started`。 */
  | { type: "turn_started" }
  /** 用户点击停止（只可能发生在当前 vault：停止钮在面板内）。 */
  | { type: "stop_clicked" }
  /** 轮次终态。`displayed` = 该 vault 的 transcript 此刻是否真的在屏幕上（决定是否产生未读）。 */
  | { type: "terminal"; kind: ActivityTerminalKind; displayed: boolean }
  /** 该 vault 的 transcript 在屏幕上（打开面板 / 布局落定）：已读清算的入口之一。 */
  | { type: "displayed" }
  /** 换会话（新会话 / 恢复 / cron 切屏 / cron 回滚）：只清**动作发起时捕获的 vault**。 */
  | { type: "reset_view" }
  | ActivitySnapshotEvent;

/** 乐观发送的撤销令牌：`before` = 发送前的记录，`version` = 应用乐观起点之后的记录版本。 */
export interface ActivityToken {
  before: ActivityState;
  version: number;
}

/**
 * 按 vault 键控的活动记录。
 *
 * 没有通用 `retain` / 周期性清理（design §9）：无行可显示的内存记录 MAY 留到应用重启或
 * webview 重载；显式删除 / 重定位只按**实际后端打开根**`drop`。`of` 对未知键返回
 * `INITIAL_ACTIVITY` 且**不分配**条目（避免事件风暴把无关键写进表）。
 */
export interface VaultActivityStore {
  of(vault: string): ActivityState;
  dispatch(vault: string, event: VaultActivityEvent): void;
  /** 记录乐观起点并返回撤销令牌（含应用之后的记录版本）。 */
  beginSend(vault: string): ActivityToken;
  /** 只在记录版本仍等于令牌版本时撤销乐观起点；返回是否生效（版本已变 = no-op）。 */
  rollbackSend(vault: string, token: ActivityToken): boolean;
  /** 停止请求被拒：只在记录仍为 stopping 时收口；返回是否生效。 */
  finishIfStopping(vault: string): boolean;
  /** 视图复位（换会话）：相位 idle + 未读 null，只作用于该 vault。 */
  reset(vault: string): void;
  /** 显式删除 / 重定位：丢弃该 vault 的记录，不迁移。 */
  drop(vault: string): void;
  /** 只在相位 / 未读跃迁时通知（分片 / 工具行 / `notice` 不触发）。 */
  subscribe(listener: () => void): () => void;
}

/** store 事件 → 既有 reducer 事件。`displayed` 复用 `opened`（已读清算的同一入口），
 *  `reset_view` 复用 `vault_changed`（相位收口 + 未读清空）——store 不新增转移规则。 */
function toActivityEvent(event: VaultActivityEvent): ActivityEvent {
  switch (event.type) {
    case "turn_started":
      return { type: "sent" };
    case "stop_clicked":
      return { type: "stop_clicked" };
    case "terminal":
      return { type: "terminal", kind: event.kind, mounted: event.displayed };
    case "displayed":
      return { type: "opened" };
    case "reset_view":
      return { type: "vault_changed" };
    case "enter_snapshot":
      return event;
  }
}

interface ActivityEntry {
  state: ActivityState;
  /** 记录版本：每次**生命周期输入**递增（即使该输入没改变状态）；只用于作废过期的乐观起点。
   *  为什么「没改状态也算」：乐观发送之后后端真的发了 `auto_turn_started`（相位 already
   *  running）是「这一轮确实起来了」的证据——迟到的拒绝 MUST NOT 再把它撤销成空闲
   *  （design §6.2 的目的，不是只有状态跃迁才算）。 */
  version: number;
}

export function createVaultActivityStore(): VaultActivityStore {
  const entries = new Map<string, ActivityEntry>();
  const listeners = new Set<() => void>();

  function current(vault: string): ActivityEntry | undefined {
    return entries.get(vault);
  }

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  /** 写入一次归约结果。`touch` = 这是记录的生命周期输入（即使没改变状态也推进版本）；
   *  `displayed` 只在真的清掉未读时算一次跃迁。返回状态是否有变化。 */
  function apply(vault: string, event: ActivityEvent, touch = true): boolean {
    const prev = current(vault)?.state ?? INITIAL_ACTIVITY;
    // 被世代 / stopping 判据拒绝的进入快照**不是记录输入**：整条不应用，也不推进版本。
    // 否则「进入快照在途 → 本地发送 → 旧快照返回 → 发送拒绝」会因版本被无谓推进而回滚失效，
    // 乐观 running 与轮次闸门永久留在那里（独立评审 P1-2 的现场）。
    if (event.type === "enter_snapshot" && !enterSnapshotApplies(prev, event)) return false;
    const next = reduceActivity(prev, event);
    const changed = next.phase !== prev.phase || next.unread !== prev.unread;
    if (!changed && !touch) return false;
    entries.set(vault, { state: next, version: (current(vault)?.version ?? 0) + 1 });
    if (changed) notify();
    return changed;
  }

  function of(vault: string): ActivityState {
    return current(vault)?.state ?? INITIAL_ACTIVITY;
  }

  return {
    of,
    dispatch(vault: string, event: VaultActivityEvent): void {
      // `displayed` 是「已读清算」而不是轮次生命周期：它只在真的清掉未读时推进版本。
      apply(vault, toActivityEvent(event), event.type !== "displayed");
    },
    beginSend(vault: string): ActivityToken {
      const before = of(vault);
      apply(vault, { type: "sent" });
      return { before, version: current(vault)?.version ?? 0 };
    },
    rollbackSend(vault: string, token: ActivityToken): boolean {
      const version = current(vault)?.version ?? 0;
      // 发送后已有真实事件推进了记录（例如后端已发 `auto_turn_started` / 终态）：拒绝只撤销
      // 自己那一步，MUST NOT 用陈旧的 `before` 覆盖别人的转移（design §6.2）。版本在每条
      // 生命周期输入上都推进，因此「同相位的 `auto_turn_started`」同样会挡下回滚。
      if (version !== token.version) return false;
      const prev = of(vault);
      const reverted = prev.phase !== token.before.phase || prev.unread !== token.before.unread;
      entries.set(vault, { state: token.before, version: version + 1 });
      if (reverted) notify();
      return true;
    },
    finishIfStopping(vault: string): boolean {
      if (of(vault).phase !== "stopping") return false;
      apply(vault, { type: "local_finish" });
      return true;
    },
    reset(vault: string): void {
      apply(vault, { type: "vault_changed" });
    },
    drop(vault: string): void {
      if (entries.delete(vault)) notify();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * 「该 vault 的 transcript 是否真的在屏幕上」——已读判据的**单一辅助**（design §4.1）。
 *
 * 已读 = 该 vault 是当前 vault，且 harness pane 对它在场（布局已落定）。不看窗口焦点、
 * 不看应用是否前台。面板与测试共用这一条，MUST NOT 在别处再写一遍（REVIEW.md「同一语义
 * 两处真源」条）。
 */
export function activityDisplayed(
  vault: string,
  currentVault: string | null,
  panePresent: boolean,
): boolean {
  return vault === currentVault && panePresent;
}

/** 三态的取值（标题栏钮与切换器行**共用**的形状输入）：相位优先，未读再分两档。 */
export type ActivityKind = "idle" | "inflight" | "reply" | "failure";

export function activityKind(state: ActivityState): ActivityKind {
  if (state.phase !== "idle") return "inflight";
  if (state.unread === "reply") return "reply";
  if (state.unread === "failure") return "failure";
  return "idle";
}

/**
 * 三态的状态词（文案表 D870–D872；空闲不占条目）。标题栏钮与行标记共用同一份取值。
 *
 * `pendingApproval`（change fix-harness-approval-visibility-nov23 design §3.2）：**运行中**且有
 * 待决批准项时改读 D416「等待批准」——与工具行待决尾注同一串，MUST NOT 为标题栏另立同文重复键。
 * 只有 `running` 成立：`stopping` 已请求中断（先读「处理中」），`idle` 的待批是陈旧数据。
 * 调用方传的必须是面板的待批判据（`hasPendingApprovals()`），本模块不持有集合。
 */
export function activityStatusKey(
  state: ActivityState,
  pendingApproval = false,
): "D870" | "D871" | "D872" | "D416" | null {
  if (state.phase === "running" && pendingApproval) return "D416";
  switch (activityKind(state)) {
    case "inflight":
      return "D870";
    case "reply":
      return "D871";
    case "failure":
      return "D872";
    default:
      return null;
  }
}
