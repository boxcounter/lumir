// invoke / event 契约的前端一半（薄封装，契约本体见 src-tauri/src/commands.rs）。
// 所有 command 调用经此模块进出：类型来自 src/bindings/（ts-rs 由 Rust 单一来源导出），
// 错误统一为 CommandError 信封，调用点不直接碰 invoke 的原始 reject 值。

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CommandError } from "./bindings/CommandError";
import type { ConfigSnapshot } from "./bindings/ConfigSnapshot";
import type { FsChange } from "./bindings/FsChange";
import type { FsEntry } from "./bindings/FsEntry";
import type { FsEntryChangedEvent } from "./bindings/FsEntryChangedEvent";
import type { VaultInfo } from "./bindings/VaultInfo";
import type { VaultStatus } from "./bindings/VaultStatus";
import type { LinkResolveResult } from "./bindings/LinkResolveResult";
import type { CreateNoteResult } from "./bindings/CreateNoteResult";
import type { BacklinkItem } from "./bindings/BacklinkItem";

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
export function vaultOpen(): Promise<VaultInfo | null> {
  return invoke<VaultInfo | null>("vault_open");
}

/** 启动后查询当前 vault 状态（含 last_vault 恢复失败的人话提示）。 */
export function vaultCurrent(): Promise<VaultStatus> {
  return invoke<VaultStatus>("vault_current");
}

/** 全量重扫当前 vault（watch 期间的常规刷新走 fs:entry_changed 增量）。 */
export function fsScanWorkspace(): Promise<FsEntry[]> {
  return invoke<FsEntry[]>("fs_scan_workspace");
}

/** 读 vault 内文本文件（UTF-8；非法编码 reject 人话 CommandError）。 */
export function fsReadFile(path: string): Promise<string> {
  return invoke<string>("fs_read_file", { path });
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

/** 当前文件的反链列表（来源文件 + 行号 + 行级上下文），只读。 */
export function linkGraphBacklinks(path: string): Promise<BacklinkItem[]> {
  return invoke<BacklinkItem[]>("link_graph_backlinks", { path });
}
