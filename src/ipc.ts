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
import type { PaneSession } from "./bindings/PaneSession";
import type { VaultStatus } from "./bindings/VaultStatus";
import type { LinkResolveResult } from "./bindings/LinkResolveResult";
import type { CreateNoteResult } from "./bindings/CreateNoteResult";
import type { ThinkingEffort } from "./bindings/ThinkingEffort";
import type { VaultWorkspace } from "./bindings/VaultWorkspace";
import type { SessionResumeInfo } from "./bindings/SessionResumeInfo";
import type { SessionSummary } from "./bindings/SessionSummary";
import type { WrittenAttachment } from "./bindings/WrittenAttachment";

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
// context_json / state 的 JSON 形状见各函数注释；事件 payload 的九类 type 见 HarnessEvent
// （reasoning_chunk 为 M362 新增的第九类——思考文本分片）。
// 运行时（M302）与面板并行开发：解析一律宽容——缺字段按空态处理、不认识的字段忽略，
// 形状是「我消费的键」而不是「对方发的全部键」，超集演进零改动。
// ---------------------------------------------------------------------------

/** 事件信封的公共字段（M312）：`vault` = 发送该事件的会话所属 vault 的根路径
 *（Rust 侧 `VaultScope::key()`，也是后端 sessions 映射的键——vault 与会话是同一个键）。
 * **宽容解析**：缺字段的事件按「归属未知」放行（纯浏览器桩 / 本 change 之前的载荷形态）。 */
interface HarnessEventEnvelope {
  vault?: string;
}

/** harness:event 的事件载荷（九类，type 字段判别；每类都带信封字段 `vault`）。
 *  aborted 为 M348 新增的第八类（本轮被用户停止）；reasoning_chunk 为 M362 新增的
 *  第九类（思考文本分片，index 0 起、同块多个分片共用同一 index，在该轮 text_chunk
 *  之前发出）；既有七类的形状一律未动。 */
export type HarnessEvent = HarnessEventEnvelope &
  (
    | { type: "text_chunk"; text: string }
    | { type: "reasoning_chunk"; text: string; index: number }
    | { type: "tool_call"; name: string; status: "started" | "done"; summary: string }
    // approval_request 的 argv 是**数组**（后端 events.rs 发完整 argv 的 JSON 数组；
    // M406 修类型错配——此前这里声明 string，live 渲染成逗号拼接、快照恢复整段丢弃）。
    // purpose 是 M407 契约的可选字段（模型自述的用途句，阅读辅助——卡片展示用，
    // 命令原文永远完整可见）；缺字段 = 旧后端，不展示。
    // remember 是 M413 契约的可选字段（该批准卡支持「采纳且本会话不再问」次级动作）——
    // 当前后端的事件载荷不带本键，缺键 = 批准闸挂出的请求 = 恒可见（前端按可见处理）。
    | { type: "approval_request"; id: string; tool: string; diff?: string; argv?: string[]; purpose?: string; remember?: boolean }
    | { type: "usage"; ctx_pct: number; cache_pct: number }
    | { type: "compact"; summary: string }
    | { type: "done" }
    | { type: "error"; code: string; message: string }
    | { type: "aborted" }
  );

/** 发送一条消息。context_json 是序列化后的上下文块（src/harness-context.ts 的
 *  `serializeHarnessContext` 是唯一构造点）：`{"path", "viewport_range":{from_line,to_line}}`
 *  （M412 起视口块只带行号、不带原文）或历史形态 `{"path", "selection":{…,text}}`；无上下文时
 *  传**空串**（面板在无路径文档上就这么发——后端 `turn::parse_context` 对空串返回默认块，
 *  参数类型恒为 string；传 null 会触发 `invalid type: null, expected a string`，M398）。 */
export function harnessSend(message: string, context_json: string): Promise<void> {
  return invoke<void>("harness_send", { message, context_json });
}

/** 对一条待批准项给出采纳 / 拒绝（reason 可选，拒绝原因回送模型）。`remember` = 「采纳且
 *  本会话不再问」（可选，缺省 false；M413 落 transport、M414 落按钮）：true 且采纳时后端把
 *  该次调用的 (工具, 规范化主体串) 记入**会话内**批准缓存，同会话同主体串后续免闸——
 *  缓存不落盘、新会话 / 切 vault / 重启即清，且不解锁 deny / vault 内写重定向 / 危险黑名单
 *  三层。未决项不自动超时。 */
export function harnessApprove(
  request_id: string,
  approved: boolean,
  reason?: string,
  remember?: boolean,
): Promise<void> {
  return invoke<void>("harness_approve", {
    request_id,
    approved,
    reason: reason ?? null,
    remember: remember ?? null,
  });
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
 * `usage{ctx_pct,cache_pct}`、
 * `pending_approval{id,tool,diff?,argv?,purpose?,remember?}`（argv 是**字符串数组**，M406 起与事件侧同型——
 * 此前前端按 string 读，快照恢复把数组整段丢弃；purpose / remember 是 M413 契约字段，前者
 * 供批准卡展示用途句、后者是「采纳且本会话不再问」次级动作的可见性开关）、`warn_ctx_pct`（缺省 85）、`thinking{level,supported}`
 * （M362：思考程度档位读数 + 当前 provider/model 是否支持程度调节；缺键 = 旧后端 / 桩，
 * 思考 chip 按「不伪造读数」口径隐藏）。
 * 后端不可用（纯浏览器预览 / 命令未注册）时 reject，调用方按「空会话」降级。
 */
export function harnessState(): Promise<string> {
  return invoke<string>("harness_state");
}

/**
 * 本 vault 的历史会话清单（M392 + M395）：`Vec<SessionSummary>`（ts-rs 导出，真实载荷是
 * JS 数组——与 harness_state 的 JSON String 惯例不同，M395 起平齐类型声明）。
 * 每项含 `session_id`（`sessions/<id>.jsonl` 的文件名，恢复命令的入参）、
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
 * `session_id` 是 `sessions/<id>.jsonl` 的文件名。后端读源文件最后一条会话轮次
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
 * 删除一份历史会话留存（M406）：`session_id` 是 `sessions/<id>.jsonl` 的文件名。
 * 后端校验 vault 归属（与列举 / 恢复同一口径），当前活跃会话的留存拒绝删除
 * （`harness_session_active`）；文件已不存在按幂等成功处理。错误码经 src/copy.ts 的
 * errorText 渲染。
 */
export function harnessDeleteSession(session_id: string): Promise<void> {
  return invoke<void>("harness_delete_session", { session_id });
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
    case "reasoning_chunk":
    case "tool_call":
    case "approval_request":
    case "usage":
    case "compact":
    case "done":
    case "error":
    case "aborted":
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
