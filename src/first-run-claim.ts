// 首启 tips / 默认 harness 的一次性资格（change add-first-run-onboarding-nov25）。
//
// 纯状态机：首个 `applyVault` 在**入口**调用 `claim(vaultId)` 领取；后续 applyVault 的
// claim 一律被忽略（`claimed` 已为真），不会覆盖首个 vault 的资格。`onEmptyVault` 只认
// `matches(当前 loadedVaultId)` 且未消费的一次；首个 applyVault 的恢复收尾无论是否恢复出
// 标签都 `clear(vaultId)`。这样快速切到第二个空 vault 时，即使它的空态先于第一个 restore
// 收尾到达，也拿不到 tips / 默认 harness。
//
// 纯逻辑、无 DOM / 无 IPC，便于单测把竞态造出来（main.ts 的装配层只调用它）。

export interface FirstRunClaim {
  /** 领取首个 vault 的资格；已有 claim 时返回 false 且不覆盖。 */
  claim(vaultId: string): boolean;
  /** 当前 vault 是否是首个领取者且尚未消费。 */
  matches(vaultId: string): boolean;
  /** 消费本次启动的 tips 资格（打开文档 / 空态出现后不再回来）。 */
  consume(): void;
  /** 首个 applyVault 的恢复收尾：清掉 claim，后续 vault 不继承。 */
  clear(vaultId: string): void;
  /** 是否已经领取过（后续 claim 不再生效）。 */
  readonly claimed: boolean;
}

export function createFirstRunClaim(): FirstRunClaim {
  let claimed = false;
  let current: string | null = null;
  let consumed = false;
  return {
    claim(vaultId) {
      if (claimed) return false;
      claimed = true;
      current = vaultId;
      return true;
    },
    matches(vaultId) {
      return current === vaultId && !consumed;
    },
    consume() {
      consumed = true;
    },
    clear(vaultId) {
      if (current === vaultId) current = null;
    },
    get claimed() {
      return claimed;
    },
  };
}
