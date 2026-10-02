// invoke / event 契约的前端一半（薄封装，契约本体见 src-tauri/src/commands.rs）。
// 所有 command 调用与后端事件订阅经此模块进出：类型来自 src/bindings/（ts-rs 由 Rust
// 单一来源导出），错误统一为 CommandError 信封，调用点不直接碰 invoke 的原始 reject 值，
// 也不在别处直连 listen。M132 收编了两处例外：崩溃备份的 recovery_* 封装（原
// src/save-ipc.ts）与菜单命令事件（原 main.ts 的直连 listen）。

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CommandError } from "./bindings/CommandError";
import type { ReadSnapshot } from "./bindings/ReadSnapshot";
import type { FsFileMeta } from "./bindings/FsFileMeta";
import type { ConfigSnapshot } from "./bindings/ConfigSnapshot";
import type { FsChange } from "./bindings/FsChange";
import type { FsEntryChangedEvent } from "./bindings/FsEntryChangedEvent";
import type { ReadingPositions } from "./bindings/ReadingPositions";
import type { VaultInfo } from "./bindings/VaultInfo";
import type { VaultListEntry } from "./bindings/VaultListEntry";
import type { VaultSession } from "./bindings/VaultSession";
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

/**
 * 把单个 `[ui]` 键合并写回 config.json（M228，change content-width-drag，D3 裁决：
 * 「命令做成通用键值写入」）。读-改-写、原子替换、保留未知字段，写失败抛 CommandError
 *（`config_write_failed`），调用方负责降级提示。**通用通道**：`ui.content_width`（栏宽拖拽）
 * 是第一个调用方，M226 主题切换的 `ui.theme` 将复用同一通道。
 */
export function configSetUiValue(key: string, value: unknown): Promise<void> {
  return invoke<void>("config_set_ui_value", { key, value });
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

/** 读 vault 内单文件元数据（M218 doc-meta「修改于」的 mtime 数据源）。 */
export function fsFileMtime(path: string): Promise<FsFileMeta> {
  return invoke<FsFileMeta>("fs_file_mtime", { path });
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

/**
 * 订阅「启动恢复已结束」事件（M159，change startup-restore-off-main-thread）；
 * 返回退订函数。**无载荷**：它只是唤醒信号，让前端去拉一次权威状态（`vaultCurrent`）
 * ——把结果塞进载荷会在「恢复读状态」与「用户提交」之间产生竞态（design §3.4）。
 * 恢复在 webview 挂载前就完成时事件会丢失，因此启动序列必须「先订阅、再拉取」。
 */
export function onVaultRestoreFinished(handler: () => void): Promise<() => void> {
  return listen("vault:restore_finished", () => handler());
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

/**
 * 通用文件创建（editable-non-md-files §3.8「另存为新文件」泛化）：按**显式 vault 相对
 * 路径**建空文件，扩展名原样保留（`note.txt` → `note-恢复.txt`，无扩展名文件同样无扩展名）。
 *
 * 与 `wikilinkCreate` 的分工：那条链路服务「从 wikilink 建笔记」（解析链接、拼 `.md`、
 * 更新链接图），本命令只按给定路径建文件——非 md 文本的恢复副本 MUST NOT 被恢复成 `.md`。
 * 写纪律与前者共用同一实现（O_EXCL 不覆盖既有文件、补齐中间目录、vault 内路径校验）。
 * 目标已存在返回 `create_file_exists`，调用方据此改名重试（-2..-5）。
 * 返回创建后的 vault 相对路径。
 */
export function createFile(path: string): Promise<string> {
  return invoke<string>("create_file", { path });
}

/**
 * 在系统默认应用打开外链（http / https / mailto）。
 *
 * scheme 白名单的判定在 Rust 侧（`open_external_url` 的校验是唯一来源）——前端
 * 只负责把编辑器里读到的 URL 原文交给它，不自行判定能不能开；非法 scheme 返回
 * `open_url_rejected` 错误信封，前端按人话提示（toast）。
 */
export function openExternalUrl(url: string): Promise<void> {
  return invoke<void>("open_external_url", { url });
}

/**
 * 解析相对路径 md 链接（`[x](note.md)`，M145）：目标是**相对当前文件所在目录**的
 * 路径（`./` `..` 归一的语义在 Rust `link_graph`，前端不复制），命中返回 vault
 * 相对路径，解析不到 resolve 为 null——那不是错误，前端只提示、不创建文件。
 * `#fragment` 部分按 M145 口径忽略。
 */
export function linkResolveNote(from: string, target: string): Promise<string | null> {
  return invoke<string | null>("link_resolve_note", { from, target });
}

/**
 * 在系统默认应用打开 vault 内的非 md 文件 / 目录（`[x](./doc.pdf)`、`[x](docs/)`，
 * M145）。与外链同一分层（`open_external_url`）：信任边界在 Rust 侧，这里校验的是
 * 目标必须落在 vault 内且存在——越界 / 不存在 / 打不开都返回错误信封，前端 toast 人话。
 */
export function linkOpenPath(from: string, target: string): Promise<void> {
  return invoke<void>("link_open_path", { from, target });
}

// ---------------------------------------------------------------------------
// 文件级操作（M244，change file-tree-context-menu）：右键菜单的五个动作
//
// 全部只作用于 vault 内路径（判定与 IO 在 Rust 侧的同一套边界里）；错误信封与上面各条
// 同形，调用点只拿 Promise。命名空间按后端命令名（`fs_*`）——与 `createFile`（另存为链路
// 的通用建文件）是两件事，MUST NOT 互相调用。
// ---------------------------------------------------------------------------

/** 删除 = **移到系统废纸篓**（裁决点 2，无永久删除入口）。失败时后端保证未删除任何内容
 *  （`fs_trash_failed` 的人话里明说）。 */
export function fsTrashEntry(rel: string): Promise<void> {
  return invoke<void>("fs_trash_entry", { rel });
}

/** 同目录改末段名（裁决点 3 的内联编辑提交）。撞名 reject `fs_already_exists`，MUST NOT
 *  覆盖；返回改名后的 vault 相对路径，供打开中 session 的路径 remap（裁决点 5）使用。 */
export function fsRenameEntry(rel: string, newName: string): Promise<string> {
  return invoke<string>("fs_rename_entry", { rel, new_name: newName });
}

/** 目录下新建空文件（§3.5）：`create_new` 原子语义，撞名 reject `fs_already_exists`。
 *  返回新建条目的 vault 相对路径（自动打开用它，不等 watcher 回响）。 */
export function fsCreateFile(parentRel: string, name: string): Promise<string> {
  return invoke<string>("fs_create_file", { parent_rel: parentRel, name });
}

/** 目录下新建子目录（§3.6）：语义同上；新建目录不自动展开父目录。 */
export function fsCreateDir(parentRel: string, name: string): Promise<string> {
  return invoke<string>("fs_create_dir", { parent_rel: parentRel, name });
}

/** 在系统文件管理器里定位并选中该条目（§3.4；macOS = Finder）。不产生任何文件系统变更。 */
export function fsRevealInFinder(rel: string): Promise<void> {
  return invoke<void>("fs_reveal_in_finder", { rel });
}
export const vaultRemap = (id: string, path: string): Promise<VaultWorkspace> => invoke<VaultWorkspace>("vault_remap", { id, path });

// ---------------------------------------------------------------------------
// 多 vault 切换器（M163，change multi-vault-workspaces 的 1.x / 2.x 契约的前端一半）
// ---------------------------------------------------------------------------

/** vault 注册表摘要列表。前端**每次打开切换器重新拉取**、MUST NOT 维护常驻镜像——
 *  注册表是唯一真源（spec「vault 列表与可见性」）。可用性探测在后端的非主线程上做。 */
export function vaultList(): Promise<VaultListEntry[]> {
  return invoke<VaultListEntry[]>("vault_list");
}

/** 读某 vault 的标签会话。无历史（首次打开 / 文件损坏 / 版本不匹配）resolve 为 null，
 *  不是错误——后端把这三条都归成「没有标签历史」。 */
export function vaultSessionGet(vaultId: string): Promise<VaultSession | null> {
  return invoke<VaultSession | null>("vault_session_get", { vault_id: vaultId });
}

/** 写某 vault 的标签会话（标签集合 / 顺序 / 激活项变化后防抖写，切换前与退出前 flush）。
 *  写失败在后端降级为 warning 并照常 resolve：会话只影响「下次打开这个 vault 恢复什么」，
 *  不值得拦停用户的一次切换或退出。只有 vault_id 非法才 reject（路径逃逸防护）。 */
export function vaultSessionPut(vaultId: string, tabs: string[], active: string | null): Promise<void> {
  return invoke<void>("vault_session_put", { vault_id: vaultId, tabs, active });
}

// ---------------------------------------------------------------------------
// 文档阅读位置（M194，change remember-reading-position 的持久化契约的前端一半）
// ---------------------------------------------------------------------------

/** 读某 vault 的文档阅读位置表。无历史（首次读到 / 文件损坏 / 版本不符 / 读不到）resolve 为
 *  null，不是错误——后端把这四种情况都归成「没有阅读位置历史」。 */
export function readingPositionGet(vaultId: string): Promise<ReadingPositions | null> {
  return invoke<ReadingPositions | null>("reading_position_get", { vault_id: vaultId });
}

/** 写某 vault 的阅读位置表（整份内存镜像；滚动停止后防抖写、切换文件 / 标签 / vault 前与退出
 *  前 flush）。写失败在后端降级为 warning 并照常 resolve：位置只影响「下次打开从哪里开始」，
 *  不值得拦停用户的一次切换或退出。只有 vault_id 非法才 reject（路径逃逸防护）。 */
export function readingPositionPut(
  vaultId: string,
  entries: ReadingPositions["entries"],
): Promise<void> {
  return invoke<void>("reading_position_put", { vault_id: vaultId, entries });
}

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

// ---------------------------------------------------------------------------
// Harness 对话面板（M303，change add-harness-probe）
//
// 命令与事件名是 tower 2026-10-02 钉死的契约（M302 运行时与 M303 面板共用，MUST NOT 改名）。
// context_json / state 的 JSON 形状见各函数注释；事件 payload 的七类 type 见 HarnessEvent。
// 运行时（M302）与面板并行开发：解析一律宽容——缺字段按空态处理、不认识的字段忽略，
// 形状是「我消费的键」而不是「对方发的全部键」，超集演进零改动。
// ---------------------------------------------------------------------------

/** harness:event 的事件载荷（七类，type 字段判别）。 */
export type HarnessEvent =
  | { type: "text_chunk"; text: string }
  | { type: "tool_call"; name: string; status: "started" | "done"; summary: string }
  | { type: "approval_request"; id: string; tool: string; diff?: string; argv?: string }
  | { type: "usage"; ctx_pct: number; cache_pct: number }
  | { type: "compact"; summary: string }
  | { type: "done" }
  | { type: "error"; code: string; message: string };

/** 发送一条消息。context_json 是序列化后的上下文块（src/harness-context.ts 的
 *  `serializeHarnessContext` 是唯一构造点）：`{"path", "selection":{from_line,to_line,text}}`
 *  或 `{"path", "viewport_range":{from_line,to_line,text}}`；调用方决定有无上下文（无上下文
 *  传 null，面板在无路径文档上就这么发）。 */
export function harnessSend(message: string, context_json: string | null): Promise<void> {
  return invoke<void>("harness_send", { message, context_json });
}

/** 对一条待批准项给出采纳 / 拒绝（reason 可选，拒绝原因回送模型）。未决项不自动超时。 */
export function harnessApprove(request_id: string, approved: boolean, reason?: string): Promise<void> {
  return invoke<void>("harness_approve", { request_id, approved, reason: reason ?? null });
}

/** 「新会话」：清空当前 vault 会话的消息历史并重新装配系统上下文。 */
export function harnessNewSession(): Promise<void> {
  return invoke<void>("harness_new_session");
}

/**
 * 会话快照（JSON String）：webview 重载后面板据此恢复渲染。面板消费的键（宽容解析，
 * 缺省 = 空态）：`messages[]`（role: "user" | "assistant" | "tool" | "compact"；text /
 * summary / name / status 字段按 role 取用）、`usage{ctx_pct,cache_pct}`、
 * `pending_approval{id,tool,diff?,argv?}`、`warn_ctx_pct`（缺省 85）。
 * 后端不可用（纯浏览器预览 / 命令未注册）时 reject，调用方按「空会话」降级。
 */
export function harnessState(): Promise<string> {
  return invoke<string>("harness_state");
}

/** 解析 harness:event 的载荷：宽容入口——载荷是 string 时先 JSON.parse；形状不认识的
 *  事件返回 null（调用方丢弃），绝不抛错打断后续事件。 */
export function parseHarnessEvent(payload: unknown): HarnessEvent | null {
  let value: unknown = payload;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const type = (value as { type?: unknown }).type;
  switch (type) {
    case "text_chunk":
    case "tool_call":
    case "approval_request":
    case "usage":
    case "compact":
    case "done":
    case "error":
      return value as HarnessEvent;
    default:
      return null;
  }
}

/** 订阅 harness 事件流；返回退订函数。 */
export function onHarnessEvent(handler: (event: HarnessEvent) => void): Promise<() => void> {
  return listen<unknown>("harness:event", (e) => {
    const parsed = parseHarnessEvent(e.payload);
    if (parsed !== null) handler(parsed);
  });
}
