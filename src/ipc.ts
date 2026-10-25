// invoke / event 契约的前端一半（薄封装，契约本体见 src-tauri/src/commands.rs）。
// 所有 command 调用与后端事件订阅经此模块进出：类型来自 src/bindings/（ts-rs 由 Rust
// 单一来源导出），错误统一为 CommandError 信封，调用点不直接碰 invoke 的原始 reject 值，
// 也不在别处直连 listen。M132 收编了两处例外：崩溃备份的 recovery_* 封装（原
// src/save-ipc.ts）与菜单命令事件（原 main.ts 的直连 listen）。

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CommandError } from "./bindings/CommandError";
import type { ReadSnapshot } from "./bindings/ReadSnapshot";
import type { ExternalTextSnapshot } from "./bindings/ExternalTextSnapshot";
import type { FsFileMeta } from "./bindings/FsFileMeta";
import type { ConfigSnapshot } from "./bindings/ConfigSnapshot";
import type { SettingsSnapshot } from "./bindings/SettingsSnapshot";
import type { SettingsPatch } from "./bindings/SettingsPatch";
import type { SettingsApplyOutcome } from "./bindings/SettingsApplyOutcome";
import type { FsChange } from "./bindings/FsChange";
import type { FsEntryChangedEvent } from "./bindings/FsEntryChangedEvent";
import type { ReadingPositions } from "./bindings/ReadingPositions";
import type { VaultInfo } from "./bindings/VaultInfo";
import type { VaultListEntry } from "./bindings/VaultListEntry";
import type { VaultSession } from "./bindings/VaultSession";
import type { PaneSession } from "./bindings/PaneSession";
import type { VaultStatus } from "./bindings/VaultStatus";
import type { LinkResolveResult } from "./bindings/LinkResolveResult";
import type { CreateNoteResult } from "./bindings/CreateNoteResult";
import type { ThinkingEffort } from "./bindings/ThinkingEffort";
import type { DecisionReason } from "./bindings/DecisionReason";
import type { VaultWorkspace } from "./bindings/VaultWorkspace";
import type { RemovedVault } from "./bindings/RemovedVault";
import type { SessionResumeInfo } from "./bindings/SessionResumeInfo";
import type { SessionSummary } from "./bindings/SessionSummary";
import type { HarnessWrittenImage } from "./bindings/HarnessWrittenImage";
import type { WrittenAttachment } from "./bindings/WrittenAttachment";
import type { NamingOutcome } from "./bindings/NamingOutcome";
import type { NamingEcho } from "./bindings/NamingEcho";
import type { TextChangePayload } from "./bindings/TextChangePayload";

/** 批准请求的发起者（change add-harness-subagents design §8.3）：Rust `ApprovalSource` 的
 *  internally tagged 序列化（`{"kind":"interactive"}` / `{"kind":"subrun","agent":…}`）。
 *  子运行透传的卡片渲染在任务面板该 run 的行内（「卡片跟着发起者走」），父会话自己的卡
 *  保持原位不变。前端只按 `kind` 分支，不推导归属。 */
export type ApprovalSource =
  | { kind: "interactive" }
  | { kind: "subrun"; agent: string; run_id: string; description: string };

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

/** 任意配置表的单键合并写（M301 泛化写通道 `config_set_value` 的前端入口——
 *  `configSetUiValue` ≡ section = "ui"，本函数是其任意表形态；写通道不校验取值，
 *  非法值由下次启动的 validate() 兜，与 Rust 侧注释同口径）。M347 消费点起：模型 chip
 *  切 provider 写回 `harness.provider`；M373 起 key 支持**点分嵌套路径**（如
 *  `providers.kimi.model`——合并选择器的 model 维度写回，写通道层逐段下钻、空段拒绝）。
 * 写失败抛 CommandError（`config_write_failed`），调用方负责降级（面板回滚读数 + 错误行）。 */
export function configSetValue(section: string, key: string, value: unknown): Promise<void> {
  return invoke<void>("config_set_value", { section, key, value });
}

/**
 * 读设置面快照（change add-model-automation-settings-oct24 tasks §3）：只含设置面的键——
 * provider 条目 raw / 生效、顶层 `revision`（保存时的 CAS 基准）、引用面布尔、两个命名目标
 * 的解析读数、文件状态与能力矩阵。**完整 API Key 永不回传**，至多末 4 位。
 */
export function settingsGet(): Promise<SettingsSnapshot> {
  return invoke<SettingsSnapshot>("settings_get");
}

/**
 * 保存一笔设置 patch（强类型：未知字段整笔拒绝）。返回最新快照 + 状态
 * （`applied` / `blocked` / `conflict` / `file_invalid`）与字段级错误；
 * 只有写盘失败这类命令级失败才 reject（CommandError `config_write_failed`）。
 */
export function settingsApply(patch: SettingsPatch): Promise<SettingsApplyOutcome> {
  return invoke<SettingsApplyOutcome>("settings_apply", { patch });
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

/**
 * 按**绝对路径**读一个 vault 外文本文件（change quick-open-file-oct23 的 `fs-io` ADDED
 * 「vault 外只读读取通道」）。唯一消费方是 `quick-open` 的 vault 外只读会话——MUST NOT 用在
 * 任何自动扫描 / 批量 / 后台任务上（spec 写成约束，代码里也没有第二个调用点）。
 *
 * 形状校验、常规文件判定、50MB 上限与 UTF-8 解码全在 Rust 侧（`fs_read_external`）；失败
 * reject 人话 `CommandError`（`fs_path_invalid` / `fs_not_found` / `fs_not_a_file` /
 * `fs_too_large` / `fs_invalid_utf8` / `fs_read_failed`，与 vault 内读取同一组错误码）。
 * 返回的 payload **只有内容**（外部会话不保存、不参与监听，revision 与 mtime 没有消费者）。
 */
export function fsReadExternal(path: string): Promise<ExternalTextSnapshot> {
  return invoke<ExternalTextSnapshot>("fs_read_external", { path });
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

/**
 * 把剪贴板图片字节落盘为 vault 内附件（change paste-clipboard-image 的写原语，M416）。
 *
 * 后端负责转码（png → WebP 无损；jpeg / webp 原样）、内容寻址命名（转码后字节 SHA-256 前
 * 16 位）与全 vault 去重，返回 `{ path, name }`；前端据此拼 `![[name]]` 引用，**不自己算
 * hash、不调 `fs_paths_exist`**（命名与去重的唯一事实源在 Rust 侧，一次粘贴恰好一次 invoke）。
 * 落盘目录 `dirRel` 是**已存在**的 vault 相对目录（空串 = vault 根），后端不隐式建目录。
 */
export function fsWriteAttachment(
  dirRel: string,
  dataBase64: string,
  sourceMime: string,
): Promise<WrittenAttachment> {
  return invoke<WrittenAttachment>("fs_write_attachment", {
    dir_rel: dirRel,
    data_base64: dataBase64,
    source_mime: sourceMime,
  });
}

/** 订阅 watch 增量事件流；返回退订函数。 */
export function onFsEntryChanged(
  handler: (changes: FsChange[]) => void,
): Promise<() => void> {
  return listen<FsEntryChangedEvent>("fs:entry_changed", (e) => handler(e.payload.changes));
}

/**
 * 投递一次图片语义命名（change add-semantic-image-naming）：后端异步改名 + 全 vault 引用
 * 改写。**不要 await 在粘贴链路上**——调用方在插入事务之后投递即返回；结果用于对账打开中
 * 的会话与弹 toast。失败一律以 `status: "skipped"` 返回（静默降级），不抛业务错误。
 */
export function attachmentSemanticName(task: {
  path: string;
  notePath?: string;
  before: string;
  after: string;
}): Promise<NamingOutcome> {
  return invoke<NamingOutcome>("attachment_semantic_name", {
    path: task.path,
    note_path: task.notePath ?? null,
    before: task.before,
    after: task.after,
  });
}

/** 撤销一次语义改名（令牌来自命名结果；过期 / 放弃条件命中时 reject 结构化错误）。 */
export function attachmentSemanticUndo(token: string): Promise<NamingOutcome> {
  return invoke<NamingOutcome>("attachment_semantic_undo", { token });
}

/**
 * 纯函数命令：对给定文本重算 wikilink 末段改写点（dirty 文档的内存对账，不写盘）。
 * 偏移单位 = UTF-16 code unit（JS 字符串下标）；匹配语义全在 Rust 的 link_graph。
 */
export function wikilinkRetargetText(
  text: string,
  fromRel: string,
  toRel: string,
): Promise<TextChangePayload[]> {
  return invoke<TextChangePayload[]>("wikilink_retarget_text", {
    text,
    from_rel: fromRel,
    to_rel: toRel,
  });
}

/** 订阅语义命名的回声抑制事件（后端开始写盘之前发出；见 NamingEcho 的载荷注释）。 */
export function onAttachmentNaming(
  handler: (echo: NamingEcho) => void,
): Promise<() => void> {
  return listen<NamingEcho>("attachment:naming", (e) => handler(e.payload));
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

/** 跨目录移动（M530，文件树拖拽移入目录的后端命令）：源与目标都是 vault 相对路径
 *  （目标 = 目标目录 + 末段名，由树侧的 `moveTargetPath` 一处拼接）。撞名 reject
 *  `fs_already_exists`（MUST NOT 覆盖）；目录移入自身/后代 reject `fs_move_into_self`；
 *  目标父目录不存在 reject `fs_not_found`。返回移动后的 vault 相对路径，供打开中
 *  session 的路径 remap 使用（与改名同一装配口径）。 */
export function fsMoveEntry(fromRel: string, toRel: string): Promise<string> {
  return invoke<string>("fs_move_entry", { from_rel: fromRel, to_rel: toRel });
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

/** 从列表移除一个注册项（M646，spec「vault 移除」）：唯一写操作是删注册表项文件，
 *  盘上的 vault 目录 / 文件与 per-id 数据一概不动。resolve 为 null = 该项已不存在
 *  （重复删除 / 竞态删除，幂等成功）；当前 vault 与 IO 失败走错误信封。 */
export function vaultRemove(id: string): Promise<RemovedVault | null> {
  return invoke<RemovedVault | null>("vault_remove", { id });
}

/** 撤销一次移除：按移除前的原值把注册项写回（稳定 id / 路径 / 上次打开时间 / 失效治理
 *  标记）。目标已存在时不覆盖（幂等成功）；不打开、不切换。 */
export function vaultRestore(entry: RemovedVault): Promise<void> {
  return invoke<void>("vault_restore", { entry });
}

/** 读某 vault 的标签会话。无历史（首次打开 / 文件损坏 / 版本不匹配）resolve 为 null，
 *  不是错误——后端把这三条都归成「没有标签历史」。 */
export function vaultSessionGet(vaultId: string): Promise<VaultSession | null> {
  return invoke<VaultSession | null>("vault_session_get", { vault_id: vaultId });
}

/** 写某 vault 的 pane 布局会话（M318：各 pane 的标签集合 / 顺序 / 激活项 + 分隔条比例，任一
 *  变化后防抖写，切换前与退出前 flush）。`harnessPane` 记 harness pane 是否在场（ADR 0008
 *  Decision 6 的 Phase 2 消费位，change move-harness-to-pane-chat-frame；会话内容不持久化）。
 *  写失败在后端降级为 warning 并照常 resolve：会话只影响「下次打开这个 vault 恢复什么」，不值得
 *  拦停用户的一次切换或退出。只有 vault_id 非法才 reject（路径逃逸防护）。 */
export function vaultSessionPut(
  vaultId: string,
  panes: PaneSession[],
  paneSplitRatio: number,
  harnessPane: boolean,
): Promise<void> {
  return invoke<void>("vault_session_put", {
    vault_id: vaultId,
    panes,
    pane_split_ratio: paneSplitRatio,
    harness_pane: harnessPane,
  });
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
// context_json / state 的 JSON 形状见各函数注释；事件 payload 的 type 集合见 HarnessEvent
// （成员只在那里列一次——历史的「N 类」计数已随新增事件类型漂过，不再复述）。
// 运行时（M302）与面板并行开发：解析一律宽容——缺字段按空态处理、不认识的字段忽略，
// 形状是「我消费的键」而不是「对方发的全部键」，超集演进零改动。
// ---------------------------------------------------------------------------

/** 事件信封的公共字段（M312）：`vault` = 发送该事件的会话所属 vault 的根路径
 *（Rust 侧 `VaultScope::key()`，也是后端 sessions 映射的键——vault 与会话是同一个键）。
 * **宽容解析**：缺字段的事件按「归属未知」放行（纯浏览器桩 / 本 change 之前的载荷形态）。 */
interface HarnessEventEnvelope {
  vault?: string;
}

/** harness:event 的事件载荷（`type` 判别；每类都带信封字段 `vault`）。
 *  aborted 为 M348 新增（本轮被用户停止）；reasoning_chunk 为 M362 新增（思考文本分片，
 *  index 0 起、同块多个分片共用同一 index，在该轮 text_chunk 之前发出）；title 为
 *  change add-session-auto-naming 新增（会话标题即时更新，M595 补上 IPC 白名单分支）；
 *  较早成员的形状一律未动——**usage 除外**（M443 起换键，见下条注）。 */
export type HarnessEvent = HarnessEventEnvelope &
  (
    | { type: "text_chunk"; text: string }
    | { type: "reasoning_chunk"; text: string; index: number }
    | { type: "tool_call"; name: string; status: "started" | "done"; summary: string }
    // approval_request 的 argv 是**数组**（后端 events.rs 发完整 argv 的 JSON 数组；
    // M406 修类型错配——此前这里声明 string，live 渲染成逗号拼接、快照恢复整段丢弃）。
    // purpose 是 M407 契约的可选字段（模型自述的用途句，阅读辅助——卡片展示用，
    // 命令原文永远完整可见）；缺字段 = 旧后端，不展示。
    // remember / persist_rule 是 change harness-permission-rules-oct23 的可选字段（两枚次级
    // 动作的开关与文案素材）：`remember` = 会话记忆粒度（`tvly search` 这类前缀 / 路径原文），
    // `persist_rule` = 持久规则原文（`cli(tvly search *)`）。**缺键 = 不渲染该按钮**（M413 的
    // 「缺键按可见处理」契约已按 D3 裁决翻转——危险卡经快照恢复不得复活死按钮）。
    // reason 是 M459 契约的可选字段（判定依据：哪一层让这次调用进闸，面板「判定依据」行据它渲染）；
    // 类型取 Rust 侧的 ts-rs 导出（`src/bindings/DecisionReason.ts`，单一来源）。注意该联合里的
    // `deny_rule` 变体**不会到达前端**（deny 不产批准卡，规则原文走工具行的错误文案）——
    // 前端只处理三个可上卡的 kind（见 harness-panel.ts 的 parseDecisionReason）。
    // cron_task 是 change add-cron-conversational-registration 的可选字段（定时任务要素预览；
    // 形状由 Rust `ApprovalPreview.cron_task` 给出，前端按宽容解析消费——此处只声明键在场，
    // 不复制第二份形状定义，见 harness-panel.ts 的 `parseCronTaskPreview`）。
    | { type: "approval_request"; id: string; tool: string; diff?: string; argv?: string[]; purpose?: string; reason?: DecisionReason; cron_task?: Record<string, unknown>; remember?: string; persist_rule?: string; source?: ApprovalSource }
    // usage（M443，change harness-cache-metrics §4.1）：cache 侧口径拆成会话累计与单回合两个
    // 投影——`cache_pct_session` = 控制行主读数（本逻辑会话 Σcached÷Σinput）、`cache_pct_turn`
    // = hover 气泡里的单回合值、`cache_write_tokens[_session]` = 本回合 / 本会话累计的缓存写入、
    // `cache_note` = 本回合成因标注（无则 null）。旧键 `cache_pct`（单回合值复用旧名）随本
    // change **退役**，事件与快照两条通道一并换键。
    // M526 的绝对值键（`input_tokens` / `cached_tokens` / `cached_tokens_session` /
    // `context_window` / `has_usage`——`context_window` 为 0 = 无上限值、`has_usage` 为
    // 「有没有真读数」）是同一份载荷的另一半：**事件/快照同键同值不变量（M534）**——本成员与
    // `harness_state` 快照的 `usage` SHALL 携带同一组读数键（两者同吃 Rust `UsageSnapshot`
    // 的一份序列化），加字段即两端同改、MUST NOT 各列一份键清单（REVIEW.md 「同一语义两处真源」条）。
    // 合同条款见 openspec/specs/harness/spec.md 的「usage 事件与状态快照同键同值」scenario。
    | { type: "usage"; ctx_pct: number; cache_pct_session: number; cache_pct_turn: number; cache_write_tokens: number; cache_write_tokens_session: number; cache_note: "cold_start" | "block_dilution" | null; input_tokens: number; cached_tokens: number; cached_tokens_session: number; context_window: number; has_usage: boolean }
    | { type: "compact"; summary: string }
    // title（change add-session-auto-naming，design D11）：会话标题即时更新。载荷只有标题
    // 字符串；前端只改会话名文本与 tooltip（不重渲染 transcript、不动滚动 / 焦点 / 清单
    // 顺序），压缩 / 恢复的继承标题也发一次。
    | { type: "title"; title: string }
    // ── 子代理可见面（change add-harness-subagents design §13 / §19）───────────────
    // 七类 `subagent_*` 是面板任务区的数据源：started / progress / step / finished 只更新
    // 任务行（MUST NOT 进 transcript）；notified 表达「通知最终被如何处理」（wake 值）；
    // rejected 是委派被闸拒的可见面；catalog_large 是清单容量告警。
    // **状态 / 终态词以 `subagent_finished` 的 status 为准**（completed / partial / failed /
    // aborted），前端只做词映射，不自行推导成功与否（REVIEW.md「同一语义两处真源」条）。
    | { type: "subagent_started"; run_id: string; segment: number; agent: string; description: string; model: string; tools: string[]; max_turns: number; max_tokens: number; timeout_secs: number; background: boolean }
    | { type: "subagent_progress"; run_id: string; segment: number; rounds: number; tool_calls: number; last_tool: string | null; elapsed_ms: number }
    | { type: "subagent_step"; run_id: string; segment: number; tool: string; summary: string }
    | { type: "subagent_finished"; run_id: string; segment: number; agent: string; status: string; stopped_by?: string; rounds: number; model: string; input_tokens: number; cached_tokens: number; output_tokens: number; denied_calls: number; duration_ms: number; summary_chars: number; summary?: string; audit?: string; audit_error?: string }
    | { type: "subagent_notified"; run_id: string; agent: string; status: string; wake: string; wake_batch: string; chain_index: number }
    | { type: "subagent_rejected"; reason: string; agent: string; description: string }
    | { type: "subagent_catalog_large"; estimated_tokens: number; definition_count: number }
    // `notice`（tasks §10.4）：后台完成通知上屏到 transcript 的那一刻。正文不进本事件——
    // 它是会话里那条带 `auto_notice` 标记的 user 消息（内容真源一处）；本事件只带渲染元数据。
    | { type: "notice"; wake_batch: string; runs: Array<{ run_id: string; agent: string; description: string; status: string; stopped_by?: string | null; summary: string }> }
    // `auto_turn_started`（tasks §10.4）：自动回合开始。面板据此打开轮次闸门 / 处理中相位——
    // 自动回合没有用户发送动作，`done` 之前的所有内容事件否则会被轮次闸门丢弃。
    | { type: "auto_turn_started"; chain_index: number }
    | { type: "done" }
    | { type: "error"; code: string; message: string }
    | { type: "aborted" }
  );

/** 发送一条消息。`parts_json` 是投递投影的序列化（src/quote-card.ts 的 `serializeDelivery`
 *  是唯一构造点）：有序 `[{kind:"text",text} | {kind:"image",name}]` 数组（change
 *  harness-composer-image-paste design §4.2）——字符串承载不了 text/image 交错，故投影
 *  整体走 JSON；纯文本消息投影为单 text part，与历史串形态逐字节一致。含图片 part 且
 *  当前模型未声明 vision 能力时 reject `harness_image_unsupported`（不建会话、不入队；
 *  前端据 code toast + 标出图片卡片）。context_json 是序列化后的上下文块
 *  （src/harness-context.ts 的 `serializeHarnessContext` 是唯一构造点）：
 *  `{"path", "viewport_range":{from_line,to_line}}`（M412 起视口块只带行号、不带原文）或
 *  历史形态 `{"path", "selection":{…,text}}`；无上下文时传**空串**（面板在无路径文档上就
 *  这么发——后端 `turn::parse_context` 对空串返回默认块，参数类型恒为 string；传 null 会
 *  触发 `invalid type: null, expected a string`，M398）。 */
export function harnessSend(parts_json: string, context_json: string): Promise<void> {
  return invoke<void>("harness_send", { parts_json, context_json });
}

/** 落盘一张 composer 粘贴的剪贴板图片（change harness-composer-image-paste design §5）：
 *  harness 侧内容寻址存储 `attachments/<vault 稳定 id>/`（MUST NOT 触碰 vault），
 *  返回 `{name, width, height}`——前端据此插图片卡片。失败（格式不支持 / 超限 / 转码
 *  或落盘失败 / 无有效 vault）reject 人话错误（code 族与 vault 附件同：`attachment_*` /
 *  `harness_attachment_no_vault`），前端 toast、不插卡片。 */
export function harnessWriteImage(
  data_base64: string,
  source_mime: string,
): Promise<HarnessWrittenImage> {
  return invoke<HarnessWrittenImage>("harness_write_image", { data_base64, source_mime });
}

/** 读回一张 harness 图片附件的 base64（缩略图渲染用；design §5.4）：落点 =
 *  `attachments/<当前 vault 稳定 id>/`，限 `pasted-<hash16>.<ext>` 形态、路径逃逸防护，
 *  跨 vault 不可见。 */
export function harnessReadImage(name: string): Promise<string> {
  return invoke<string>("harness_read_image", { name });
}

/** 读当前 vault 的 composer 草稿（change composer-draft-persistence）：块模型 JSON **原文**
 *  （`{"version":1,"blocks":[…],"caret":…}`），无草稿 / 无 vault → `null`。落点由后端按当前
 *  vault scope 解析（前端不传 vault——`harness_write_image` 同形态）。**本层不解析内容**：
 *  (反)序列化的唯一实现点在 `src/quote-card.ts`（`parseComposerDraft`）。读取失败（不可读 /
 *  损坏）与「无草稿」在界面上同一处置：安静回落到空输入区。 */
export function harnessDraftGet(): Promise<string | null> {
  return invoke<string | null>("harness_draft_get");
}

/** 写当前 vault 的 composer 草稿：`draft_json` 是块模型 JSON 原文；**空串 = 清除**（发送成功
 *  后删掉草稿文件）。前端经防抖写控制器（`src/harness-draft.ts`）调用。无 vault 时后端静默
 *  no-op（不落盘、不报错）；写失败 reject `harness_draft_write_failed`——调用方降级为一条
 *  人话 warning，**MUST NOT** 阻断输入。 */
export function harnessDraftPut(draft_json: string): Promise<void> {
  return invoke<void>("harness_draft_put", { draft_json });
}

/** 对一条待批准项给出采纳 / 拒绝（reason 可选，拒绝原因回送模型）。`remember` = 「采纳且
 *  本会话不再问」（可选，缺省 false；M413 落 transport、M414 落按钮）：true 且采纳时后端把
 *  该次调用的会话记忆键（`cli_run` 是命令前缀、vault 工具是路径）记入**会话内**批准缓存，
 *  同会话同前缀后续免闸——缓存不落盘、新会话 / 切 vault / 重启即清，且不解锁 deny /
 *  vault 内写重定向 / 危险黑名单三层。
 *
 *  `persist_rule` = 「以后都允许 <规则>」（change harness-permission-rules-oct23 A1，可选，
 *  缺省 false）：true 且采纳时后端**从待决请求现算**规则文本并写回全局配置（前端不传文本）；
 *  写失败则调用保持待决。未决项不自动超时。 */
export function harnessApprove(
  request_id: string,
  approved: boolean,
  reason?: string,
  remember?: boolean,
  persist_rule?: boolean,
): Promise<void> {
  return invoke<void>("harness_approve", {
    request_id,
    approved,
    reason: reason ?? null,
    remember: remember ?? null,
    persist_rule: persist_rule ?? null,
  });
}

/** 删除一条已记住的持久权限规则（权限浮层的删除钮，change harness-permission-rules-oct23
 *  A1）：幂等——规则不存在时安静成功（返回 false）。删除下一次权限判定即生效。 */
export function harnessPermissionRuleRemove(rule: string): Promise<boolean> {
  return invoke<boolean>("harness_permission_rule_remove", { rule });
}

/** 停止当前在途轮次（M348，发送钮停止态点击；design §5：中断 = 「不再继续」，非回滚）。
 *  中断收口（已产出内容标注「已停止」、待决批准收回、`aborted` 终态事件）由后端在
 *  停止检查点完成，本调用立即返回；无在途轮次 reject `harness_not_running`
 *  （竞态：轮次刚好结束——终态事件随后就到，调用方按「等事件」降级）。 */
export function harnessAbort(): Promise<void> {
  return invoke<void>("harness_abort");
}

/** 「新会话」：清空当前 vault 会话的消息历史并重新装配系统上下文。 */
export function harnessNewSession(): Promise<void> {
  return invoke<void>("harness_new_session");
}

/** 面板停止单个子运行（tasks §10.2「停止」；design §12.4：只停该 run，它的待批项收回、
 *  收敛为 `aborted`、不触发唤醒）。返回是否找到该 run——与收敛事件赛跑（run 刚好结束）是
 *  常态，false 不当作错误。 */
export function harnessSubagentStop(run_id: string): Promise<boolean> {
  return invoke<boolean>("harness_subagent_stop", { run_id });
}

/** 任务区触顶提示行的「继续」（tasks §10.8；design §12.6.3）：等价一次用户发言——链清零、
 *  `blocked` 清空，并按待处理通知起一个回合。 */
export function harnessSubagentContinue(): Promise<void> {
  return invoke<void>("harness_subagent_continue");
}

/**
 * 设置当前会话的思考程度档位（M362 对接面，change add-harness-thinking-display-and-effort）：
 * 三档闭集合 `low` / `high` / `max`（`src/bindings/ThinkingEffort.ts`，默认 high），**会话内
 * 生效、不写回配置**——新会话随会话对象丢弃回到默认。会话内即时生效（下一轮请求带上）；
 * 无会话时后端即时建立会话再落档（面板一打开就可能点思考 chip，前端无需先发消息）。
 * 当前 provider + model 是否支持程度调节不在本命令的回路里——前端置灰判据读
 * `harness_state` 快照的 `thinking.supported` 字段。
 */
export function harnessSetThinkingEffort(effort: ThinkingEffort): Promise<void> {
  return invoke<void>("harness_set_thinking_effort", { effort });
}

/**
 * 会话快照（JSON String）：webview 重载后面板据此恢复渲染。面板消费的键（宽容解析，
 * 缺省 = 空态）：`vault`（会话标识 = vault 根路径，M312——与事件信封同源，据此丢弃
 * 「切走之后才回来的」旧快照）、`messages[]`（role: "user" | "assistant" | "tool" |
 * "compact"；text / summary / name / status 字段按 role 取用；tool 消息另有 decision
 * 字段 = 批准闸决定 approved / rejected，M413——恢复后「已采纳」与「已拒绝」同样可见）、
 * `usage{ctx_pct,cache_pct_session,cache_pct_turn,cache_write_tokens,cache_write_tokens_session,cache_note,input_tokens,cached_tokens,cached_tokens_session,context_window,has_usage}`（M443 起换键：cache 侧 = 会话累计主读数 + 单回合辅读数 +
 * 缓存写入两值 + 成因标注；旧 `cache_pct` 单回合键退役。M526 的五个绝对值键与事件侧同属一份
 * 载荷——同键同值不变量见 HarnessEvent 的 usage 成员注：两侧键集合由同一份 `UsageSnapshot`
 * 序列化产出，改一侧即须同改另一侧）、
 * `pending_approvals[]{id,tool,diff?,argv?,purpose?,reason?,cron_task?,remember?,persist_rule?,source}`（列表，change
 * add-harness-subagents §8.3 起替代单槽 `pending_approval`：并行时多个子运行可以同时等批准；
 * `source` 是发起者，`kind: "subrun"` 的卡渲染在任务面板该 run 的行内。argv 是**字符串数组**，
 * M406 起与事件侧同型——此前前端按 string 读，快照恢复把数组整段丢弃；purpose 是 M413 契约
 * 字段（批准卡展示用途句）；`remember` / `persist_rule` 是 change harness-permission-rules-oct23
 * 起的两个次级动作开关（会话记忆粒度 / 持久规则原文，**缺键 = 不渲染该按钮**——M413 的「缺键按
 * 可见处理」已按 D3 裁决翻转）；cron_task 是 change add-cron-conversational-registration 的可选
 * 字段，与事件侧同源同形）、
 * `auto_wake{chain,max,blocked}` / `subrun_usage{<model>:{…}}`（change add-harness-subagents：
 * 自动唤醒链读数与子运行按模型分桶）、`warn_ctx_pct`（缺省 85）、`thinking{level,supported}`
 * （M362：思考程度档位读数 + 当前 provider/model 是否支持程度调节；缺键 = 旧后端 / 桩，
 * 思考 chip 按「不伪造读数」口径隐藏）、`title`（change add-session-auto-naming：会话有效
 * 标题；**缺键 = 无标题**——面板回落首条用户消息截断，不伪造）。
 * 后端不可用（纯浏览器预览 / 命令未注册）时 reject，调用方按「空会话」降级。
 */
export function harnessState(): Promise<string> {
  return invoke<string>("harness_state");
}

/**
 * 本 vault 的历史会话清单（M392 + M395）：`Vec<SessionSummary>`（ts-rs 导出，真实载荷是
 * JS 数组——与 harness_state 的 JSON String 惯例不同，M395 起平齐类型声明）。
 * 每项含 `session_id`（`sessions/<vault 稳定 id>/<id>.jsonl` 的文件名，恢复命令的入参）、
 * `first_user_text`（该会话首条用户消息的原始提问段——注入的上下文节已由后端剥除，无则缺省；
 * 截断约 20 字是前端展示规则）、
 * `ts`（首行 `session_open` 信封的 unix 秒，缺则缺省）。服务端已按 vault 过滤、按时间
 * 倒序；宽容解析见 src/harness-panel.ts 的 sessionEntriesOf（同收字符串与数组，防御
 * 桩 / 旧后端）。命令未注册 / 后端不可用时 reject，调用方按「空清单」降级——选择器不
 * 因此报错。
 */
export function harnessListSessions(): Promise<SessionSummary[]> {
  return invoke<SessionSummary[]>("harness_list_sessions");
}

/**
 * 从留存文件恢复历史会话并续聊（M392，change reshape-harness-session-recording design §6.2）：
 * `session_id` 是 `sessions/<vault 稳定 id>/<id>.jsonl` 的文件名。后端读源文件最后一条会话轮次
 * `llm_request` 的完整请求体（折叠其后未入请求的末尾响应），system + input 原样灌进
 * **新**会话并续写新留存文件（`opened_from=restore`）。返回的 `SessionResumeInfo.messages`
 * 是后端把灌回的 input 映射成的**面板重建消息**（M398）——调用方（src/harness-panel.ts 的
 * resumeSession）据此一次重放历史 transcript，不必再拉 `harness_state`。busy 态 reject
 * `harness_busy`；源文件不属于当前 vault reject
 * `harness_session_vault_mismatch`；留存不可读 / 格式非法 reject `harness_session_unreadable` /
 * `harness_session_invalid`（D409–D411 经 src/copy.ts 的 errorText 按 code 渲染）。
 */
export function harnessResumeSession(session_id: string): Promise<SessionResumeInfo> {
  return invoke<SessionResumeInfo>("harness_resume_session", { session_id });
}

/**
 * 删除一份历史会话留存（M406）：`session_id` 是 `sessions/<vault 稳定 id>/<id>.jsonl` 的文件名。
 * 后端校验 vault 归属（与列举 / 恢复同一口径），当前活跃会话的留存拒绝删除
 * （`harness_session_active`）；文件已不存在按幂等成功处理。错误码经 src/copy.ts 的
 * errorText 渲染。
 */
export function harnessDeleteSession(session_id: string): Promise<void> {
  return invoke<void>("harness_delete_session", { session_id });
}

/** harness:event 的 type 白名单（**单一真源**：`parseHarnessEvent` 不再各列一份）。
 *
 *  `const known: HarnessEvent["type"]` + default 里的 `uncoveredEventType(known)` 是**类型层的
 *  穷尽性闸门**：`HarnessEvent` 联合每新增一个 type 而这里漏补 case，`known` 在 default 里就
 *  不是 `never`，tsc 直接报错——「联合已声明、白名单漏分支」不再是一次静默丢弃（M576 引入
 *  title 事件漏接、M590 扩白名单仍未补，同族第二次；REVIEW.md「同一语义两处真源」条）。
 *  新增事件类型 = 联合加一行 + 这里加一行，两处由编译器对账，不靠人读。 */
function isHarnessEventType(type: string): boolean {
  const known = type as HarnessEvent["type"];
  switch (known) {
    case "text_chunk":
    case "reasoning_chunk":
    case "tool_call":
    case "approval_request":
    case "usage":
    case "compact":
    case "title":
    case "subagent_started":
    case "subagent_progress":
    case "subagent_step":
    case "subagent_finished":
    case "subagent_notified":
    case "subagent_rejected":
    case "subagent_catalog_large":
    case "notice":
    case "auto_turn_started":
    case "done":
    case "error":
    case "aborted":
      return true;
    default:
      return uncoveredEventType(known);
  }
}

/** 类型层穷尽性断言：形参是 `never`，所以联合里还有没被 case 覆盖的成员时调用处不成立
 *  （tsc 报错，TS2345）；运行期恒返回 false——运行时来的未知 type 照旧按「不认识」丢弃。
 *  两处消费同一机制：本文件的准入白名单（`isHarnessEventType`），以及 harness-panel.ts
 *  的 `handleEvent` switch default（判别联合收窄后直接把 `event` 传进来；漏 case 时收窄
 *  不到 `never`，同样编译失败）。 */
export function uncoveredEventType(_uncovered: never): false {
  return false;
}

/** 解析 harness:event 的载荷：宽容入口——载荷是 string 时先 JSON.parse；type 不在白名单里
 *  （或形状不认识）返回 null（调用方丢弃），绝不抛错打断后续事件。 */
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
  if (typeof type !== "string" || !isHarnessEventType(type)) return null;
  return value as HarnessEvent;
}

/** 订阅 harness 事件流；返回退订函数。 */
export function onHarnessEvent(handler: (event: HarnessEvent) => void): Promise<() => void> {
  return listen<unknown>("harness:event", (e) => {
    const parsed = parseHarnessEvent(e.payload);
    if (parsed !== null) handler(parsed);
  });
}
