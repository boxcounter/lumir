// invoke / event 契约的前端一半（薄封装，契约本体见 src-tauri/src/commands.rs）。
// 所有 command 调用与后端事件订阅经此模块进出：类型来自 src/bindings/（ts-rs 由 Rust
// 单一来源导出），错误统一为 CommandError 信封，调用点不直接碰 invoke 的原始 reject 值，
// 也不在别处直连 listen。M132 收编了两处例外：崩溃备份的 recovery_* 封装（原
// src/save-ipc.ts）与菜单命令事件（原 main.ts 的直连 listen）。

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CommandError } from "./bindings/CommandError";
import type { ReadSnapshot } from "./bindings/ReadSnapshot";
import type { ConfigSnapshot } from "./bindings/ConfigSnapshot";
import type { FsChange } from "./bindings/FsChange";
import type { FsEntryChangedEvent } from "./bindings/FsEntryChangedEvent";
import type { VaultInfo } from "./bindings/VaultInfo";
import type { VaultStatus } from "./bindings/VaultStatus";
import type { LinkResolveResult } from "./bindings/LinkResolveResult";
import type { CreateNoteResult } from "./bindings/CreateNoteResult";
import type { VaultWorkspace } from "./bindings/VaultWorkspace";

/** 判断 invoke 的 reject 值是否为 CommandError 信封。 */
export function isCommandError(e: unknown): e is CommandError {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as CommandError).code === "string" &&
    typeof (e as CommandError).message === "string"
  );
}

/** 把未知错误转成人话（CommandError 的 message 已是人话，直接展示）。 */
export function errorMessage(e: unknown): string {
  return isCommandError(e) ? e.message : String(e);
}

/** 读取当前生效配置（示例 command，见 src-tauri/src/commands.rs）。 */
export function configGet(): Promise<ConfigSnapshot> {
  return invoke<ConfigSnapshot>("config_get");
}

/** 调系统目录选择器打开 vault；用户取消 resolve 为 null（非错误）。 */
export function vaultOpen(force_new = false): Promise<VaultInfo | null> {
  return invoke<VaultInfo | null>("vault_open", { force_new });
}

/** 按已知路径直接打开 vault（无选择器）：仅用于重映射确认后的重开。 */
export function vaultOpenPath(path: string, force_new = false): Promise<VaultInfo> {
  return invoke<VaultInfo>("vault_open_path", { path, force_new });
}

/** 启动后查询当前 vault 状态（含 last_vault 恢复失败的人话提示）。 */
export function vaultCurrent(): Promise<VaultStatus> {
  return invoke<VaultStatus>("vault_current");
}

/** 读 vault 内文本文件与绑定 revision 快照。 */
export function fsReadSnapshot(path: string): Promise<ReadSnapshot> {
  return invoke<ReadSnapshot>("fs_read_snapshot", { path });
}

export function documentSave(path: string, expected_revision: string, content: string): Promise<string> {
  return invoke<string>("document_save", { path, expected_revision, content });
}

/** 同步编辑器 dirty 状态到后端（退出/关窗守卫据此拦截）。前端启动时也会主动推送一次当前值，复位 webview 重载后可能滞留的 stale 镜像（M107）。 */
export function documentSetDirty(dirty: boolean): Promise<void> {
  return invoke<void>("document_set_dirty", { dirty });
}

/** 订阅退出/关窗被 dirty 守卫拦截的通知；返回退订函数。 */
export function onQuitBlocked(handler: () => void): Promise<() => void> {
  return listen("app:quit_blocked", () => handler());
}

/** 读 vault 内二进制附件，返回 base64（裁决点 A：invoke + base64）。 */
export function fsReadAttachment(path: string): Promise<string> {
  return invoke<string>("fs_read_attachment", { path });
}

/** 订阅 watch 增量事件流；返回退订函数。 */
export function onFsEntryChanged(
  handler: (changes: FsChange[]) => void,
): Promise<() => void> {
  return listen<FsEntryChangedEvent>("fs:entry_changed", (e) => handler(e.payload.changes));
}

/**
 * 解析单条 wikilink（from = 链接所在文件的 vault 相对路径，link = 链接原文）。
 * 语义唯一来源是 Rust link_graph（双解析器纪律）。
 */
export function linkGraphResolve(from: string, link: string): Promise<LinkResolveResult> {
  return invoke<LinkResolveResult>("link_graph_resolve", { from, link });
}

/** 未创建链接一键创建（spec §4.4：空内容、只建新文件、不覆盖既有文件）。 */
export function wikilinkCreate(from: string, link: string): Promise<CreateNoteResult> {
  return invoke<CreateNoteResult>("wikilink_create", { from, link });
}
export const vaultRemap = (id: string, path: string): Promise<VaultWorkspace> => invoke<VaultWorkspace>("vault_remap", { id, path });

// ---------------------------------------------------------------------------
// 崩溃备份恢复链路（M127 引入；M132 从 src/save-ipc.ts 折回）
//
// 「所有 command 调用经此模块进出」此前对这五条不成立：M127 的 scope 不含 ipc.ts，
// 封装暂居 save-ipc.ts 并在文件头记了待收编。M132 把 ipc.ts 纳入 scope，收回本模块
//（错误信封与 unwrap 纪律与上面各条一致：调用点只拿 Promise，不碰 invoke 原始 reject）。
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 后端事件 → 前端订阅（listen 通道；与 invoke 通道同属本模块的对外契约）
// ---------------------------------------------------------------------------

/** 订阅原生菜单命令事件（lib.rs 的自定义项经 app:menu_command 交回前端；M132 从装配层
 *  的直连 listen 收编）。返回退订函数。 */
export function onMenuCommand(handler: (command: string) => void): Promise<() => void> {
  return listen<string>("app:menu_command", (event) => handler(event.payload));
}
