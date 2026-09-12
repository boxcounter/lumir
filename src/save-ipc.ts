// 保存链路新增 command 的薄封装（崩溃备份 recovery_*，M127）。
//
// 本仓 IPC 唯一入口是 src/ipc.ts（「所有 command 调用经此模块进出」），但 ipc.ts
// 不在本 mission 的 scope 内（并行 worktree 的 scope 隔离），故 recovery_* 的封装
// 暂居于此；折叠回 ipc.ts 的后续项已报 tower。错误信封与 unwrap 纪律与 ipc.ts 一致：
// 调用点只拿 Promise，不碰 invoke 的原始 reject 值。

import { invoke } from "@tauri-apps/api/core";

/** 写崩溃备份（覆盖式；按当前 vault + vault 相对路径定位）。
 *  `baseRevision` = 备份时编辑器已知的磁盘 revision，恢复时作 CAS 基准对账。 */
export function recoveryBackup(path: string, content: string, baseRevision: string): Promise<void> {
  return invoke<void>("recovery_backup", { path, content, base_revision: baseRevision });
}

/** 读崩溃备份内容；无备份 resolve 为 null（不是错误）。 */
export function recoveryLoad(path: string): Promise<string | null> {
  return invoke<string | null>("recovery_load", { path });
}

/** 备份记录的 CAS 基准 revision；无备份 / 老格式备份 resolve 为 null（基准未知）。 */
export function recoveryBaseRevision(path: string): Promise<string | null> {
  return invoke<string | null>("recovery_base_revision", { path });
}

/** 删除崩溃备份（保存成功 / 用户丢弃）；幂等。 */
export function recoveryDiscard(path: string): Promise<void> {
  return invoke<void>("recovery_discard", { path });
}

/** 当前 vault 的残留备份清单（vault 相对路径）。 */
export function recoveryList(): Promise<string[]> {
  return invoke<string[]>("recovery_list");
}
