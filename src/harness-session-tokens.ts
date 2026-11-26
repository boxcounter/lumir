// 会话令牌准入（change add-harness-message-withdraw-nov26；K3 复审 P1-1 的分账修正）。
//
// 背景：`harness:event` 与 `harness_state` 都带**逻辑会话令牌**（后端 `Session::subagent_token`，
// 进程内单调递增）。撤回把 A 换成 B 后，旧 A 的迟到事件必须丢弃。但令牌是**进程级**的，不同
// vault 的会话各有各的号——用一个全局水位会让「切到 token 更小的 vault」后的合法事件（text /
// done / 审批 / subrun / notice / title / persistence）全部被误判成旧会话并持续丢弃。
//
// 因此本模块把水位**按 vault 分账**：每个 vault 只跟自己的会话比；退役集合仍是全局的（令牌
// 进程内唯一，退役后不会复用）。切到尚未见过的新 vault 时水位为空 ⇒ 先接纳它的第一条事件 /
// 快照（与「新会话首事件」同一条语义），随后按该 vault 自己的水位收紧。

/** 宽容解析 `session_token`：缺失 / 非数字 / <=0 = 旧后端或无会话（`null`）。 */
export function persistenceSessionTokenOf(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** 事件准入：旧逻辑会话的迟到事件 MUST NOT 复活告警 / 混进新会话。
 *
 *  - 旧后端没有 `session_token`（`null`）⇒ 放行（兼容读取，不误报）；
 *  - 已作废（显式新会话 / 从历史恢复 / 重置 / 撤回）的 token ⇒ 丢弃；
 *  - 该 vault 还没有水位（新会话 / 刚切到的 vault）⇒ 放行并接纳该 token；
 *  - 否则只接纳同一或更新的 token（token 由后端单调分配；压缩轮换沿用同一 token）。
 */
export function persistenceEventAdmitted(
  token: number | null,
  current: number | null,
  retired: ReadonlySet<number>,
): boolean {
  if (token === null) return true;
  if (retired.has(token)) return false;
  if (current === null) return true;
  return token >= current;
}

/** 快照准入：空会话快照（token `null`）只能在该 vault 也没有水位时落地；已退役或更旧的
 *  token 快照不得覆盖已接纳的新 token。快照是该 vault 的地板，但**不能把更新的事件状态盖回
 *  旧值**——必要时由调用方丢弃并重读。 */
export function persistenceSnapshotAdmitted(
  token: number | null,
  current: number | null,
  retired: ReadonlySet<number>,
): boolean {
  if (token === null) return current === null;
  if (retired.has(token)) return false;
  if (current === null) return true;
  return token >= current;
}

/** 每个 vault 的逻辑会话令牌水位 + 全局退役集合。 */
export interface SessionTokenLedger {
  /** 该 vault 的已接纳水位（`null` = 还没有可信会话）。 */
  watermark(vault: string | null): number | null;
  /** 显式新会话 / 恢复 / 撤回：把**动作发起时**捕获的 token（缺省 = 当前水位）记入退役集合；
   *  仅当它仍是该 vault 的水位时才清空水位。 */
  retire(vault: string | null, token?: number | null): void;
  /** 采纳一个 token（只在更大或水位为空时推进；退役 token 与 `null` 都不采纳——
   *  水位只由 `retire` 降低或清空）。 */
  adopt(vault: string | null, token: number | null): void;
  /** 事件准入：按**事件所属 vault** 的水位判定；放行且带 token 时顺带推进该 vault 的水位。
   *  缺 token 的兼容事件只放行、不参与水位（否则会把既有水位清空，让未退役的旧 token 复活）。 */
  eventAdmitted(vault: string | null, token: number | null): boolean;
  /** 快照准入：同一份水位；放行时以快照为权威（并从退役集合移除该 token）。 */
  snapshotAdmitted(vault: string | null, token: number | null): boolean;
  /** 退役集合的只读视图（测试与诊断用）。 */
  retired(): ReadonlySet<number>;
}

/** 无 vault（`null`）的桶键：空态 / 单测走这一格，不与任何真实 vault 混账。 */
function bucketOf(vault: string | null): string {
  return vault ?? "";
}

export function createSessionTokenLedger(): SessionTokenLedger {
  const watermarks = new Map<string, number | null>();
  const retired = new Set<number>();

  const watermark = (vault: string | null): number | null =>
    watermarks.get(bucketOf(vault)) ?? null;

  // 水位只能由 `retire` 清空 / 降低：`adopt(vault, null)` 不做事。否则缺 token 的兼容事件
  // 会把该 vault 的既有水位清掉，未退役的旧 token 随后重新通过（K3 复审反例）。
  const adopt = (vault: string | null, token: number | null): void => {
    if (token === null) return;
    if (retired.has(token)) return;
    const current = watermark(vault);
    if (current === null || token > current) watermarks.set(bucketOf(vault), token);
  };

  return {
    watermark,
    adopt,
    retire(vault, token = watermark(vault)) {
      // 显式给了 token = 动作发起时捕获的旧会话身份。回执 / 迟到的旧回包落地时，水位可能已被
      // **新会话自己的事件**推进到新 token（恢复的写失败事件先于 Promise 回执，见
      // persistence-health-nov23 的 V6）：此时清空水位会把新 token 也挡在「已退役」之外，
      // 新会话自己的快照永远落不了地。只有捕获值仍是水位时才清空。
      if (token === null) return;
      retired.add(token);
      if (watermark(vault) === token) watermarks.set(bucketOf(vault), null);
    },
    eventAdmitted(vault, token) {
      if (!persistenceEventAdmitted(token, watermark(vault), retired)) return false;
      // 兼容事件（旧后端 / 无信封）只放行、不参与水位：清空它会复活未退役的旧 token。
      if (token !== null) adopt(vault, token);
      return true;
    },
    snapshotAdmitted(vault, token) {
      if (!persistenceSnapshotAdmitted(token, watermark(vault), retired)) return false;
      if (token !== null) retired.delete(token);
      watermarks.set(bucketOf(vault), token);
      return true;
    },
    retired() {
      return retired;
    },
  };
}
