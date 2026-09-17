//! invoke / event 契约薄约定 —— M1 接缝（架构复查 P1-2）。
//!
//! M1 起所有 webview ↔ Rust core 通信遵守以下约定：
//! Tauri 默认将参数名映射为 camelCase；本仓含下划线参数的 command 统一使用
//! `#[tauri::command(rename_all = "snake_case")]`，前端 IPC 键与 Rust 保持一致。
//!
//! ## command 命名
//!
//! `<domain>_<verb>`，snake_case，invoke 名即 Rust 函数名（`tauri::generate_handler!`
//! 自动保持一致）。domain 用模块名：`config_get`、`fs_scan_workspace`、
//! `link_graph_resolve`（后两个为后续波次示例，本波不实现）。
//!
//! ## 错误信封
//!
//! 所有 command 返回 `Result<T, CommandError>`。`CommandError` 经 serde 序列化后
//! 作为 invoke 的 reject 值传给前端，结构为 `{ code, message }`：
//! - `code`：机器可判定的稳定标识，snake_case，如 `config_home_unknown`；
//! - `message`：人话（中文），前端可直接展示（ADR 0002 §5 要求非法配置给出人话错误）。
//!
//! 前端统一由 `src/ipc.ts` 的薄封装 unwrap，不把原始 reject 值散落各调用点。
//!
//! ## 事件命名
//!
//! Rust → webview 事件名用 `<domain>:<event>`，如 `config:changed`、
//! `fs:entry_changed`。payload 类型与 command 返回值同一来源（见下）。
//!
//! ## payload 类型单一来源：ts-rs
//!
//! Rust struct/enum 是唯一定义点，`#[derive(TS)]` + `#[ts(export)]` 在
//! `cargo test` 时把 TS 类型导出到 `src/bindings/`（生成物入仓，diff 可见漂移）。
//! 选型 ts-rs 而非 specta/tauri-specta 的理由见 Cargo.toml 注释。

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use ts_rs::TS;

use crate::config::{self, ConfigSnapshot};
use crate::fs_io::{self, FsChange, FsEntry, FsEntryChangedEvent, VaultWatcher};

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ReadSnapshot {
    pub content: String,
    pub revision: String,
}
use crate::link_graph::{self, CreateNoteResult, LinkGraph, LinkResolveResult};

/// command 错误信封（serde 序列化，前端可直接展示 `message`）。
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct CommandError {
    /// 机器可判定的稳定标识，snake_case。
    pub code: String,
    /// 人话错误（中文），前端可直接展示。
    pub message: String,
}

impl CommandError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for CommandError {}

/// 读取当前生效配置 —— 契约链路的示例 command（M1 验证用）。
///
/// 证明：invoke 注册 → serde 序列化 → ts-rs 类型导出 → 前端 ipc.ts 调用 →
/// 错误信封前端可展示。配置加载本身见 [`config`]。
#[tauri::command]
pub fn config_get() -> Result<ConfigSnapshot, CommandError> {
    config::load()
}

// ---------------------------------------------------------------------------
// vault-workspace / fs-io（add-vault-workspace）
// ---------------------------------------------------------------------------

/// 已打开 vault 的快照：根路径 + 全量枚举结果。
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct VaultInfo {
    /// 稳定 vault 身份。
    pub vault_id: String,
    /// vault 根目录绝对路径。
    pub root: String,
    pub entries: Vec<FsEntry>,
    pub remap_candidates: Vec<crate::workspaces::VaultWorkspace>,
}

/// 前端启动时查询的 vault 状态。
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct VaultStatus {
    /// 当前打开的 vault；未打开为 null。
    pub vault: Option<VaultInfo>,
    /// 人话提示（如 last_vault 恢复失败）；无提示为 null。前端可直接展示。
    pub notice: Option<String>,
    /// 启动恢复是否仍在进行（change startup-restore-off-main-thread）：true = 恢复线程仍
    /// 在跑（此时 `vault` 必为 null）；false = 终态（已打开，或未打开 + 可选 notice）。
    pub restore_pending: bool,
}

/// 进程内 vault 状态：同一时刻只有一个打开的 vault（spec：重复打开替换）。
pub struct VaultState {
    inner: Mutex<VaultInner>,
}

#[derive(Default)]
struct VaultInner {
    root: Option<PathBuf>,
    /// drop 即停止监听（见 fs_io::VaultWatcher）。
    watcher: Option<VaultWatcher>,
    /// 启动恢复失败的人话提示，前端经 vault_current 取走后仍保留（幂等）。
    notice: Option<String>,
    /// wikilink 正反链索引（ADR 0002 §3）：vault 打开时建立，随 watch 增量维护。
    graph: LinkGraph,
    /// 打开世代号（M159）：每次**成功**提交 +1（启动为 0）。启动恢复在 `begin_restore`
    /// 记下当时的世代，提交时比对——用户抢先成功打开的 vault 优先，过期恢复结果整包丢弃。
    generation: u64,
    /// 启动恢复进行态（终态口径见 [`VaultStatus::restore_pending`]）。
    restore_pending: bool,
}

impl Default for VaultState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(VaultInner::default()),
        }
    }
}

impl VaultInner {
    /// 提交一次打开：**唯一**写 root/watcher/graph 的入口。先起好新 watcher 再替换，
    /// 旧 watcher 随字段覆盖被 drop、监听停止；成功提交即世代 +1（M159 让位规则）。
    fn commit(&mut self, prepared: PreparedVaultOpen) {
        let PreparedVaultOpen {
            root,
            watcher,
            graph,
            ..
        } = prepared;
        self.watcher = Some(watcher);
        self.root = Some(root);
        self.notice = None;
        self.graph = graph;
        self.generation += 1;
    }
}

impl VaultState {
    /// 进入恢复进行态并记下当前世代（启动恢复线程的起点）。
    pub fn begin_restore(&self) -> u64 {
        let mut inner = self.inner.lock().expect("vault state poisoned");
        inner.restore_pending = true;
        inner.generation
    }

    /// 启动恢复的**唯一**提交点（design §3.2）：单次持锁比对世代与「是否已有 vault」，
    /// 不符即整包丢弃——含失败 notice（用户已成功打开的 vault 不该被上次 vault 的提示
    /// 污染）。无论哪条分支都置 `restore_pending = false`；返回终局是否被应用。
    pub fn finish_restore(&self, generation: u64, outcome: RestoreOutcome) -> bool {
        let mut inner = self.inner.lock().expect("vault state poisoned");
        inner.restore_pending = false;
        if inner.generation != generation || inner.root.is_some() {
            return false;
        }
        match outcome {
            RestoreOutcome::Opened(prepared) => inner.commit(*prepared),
            RestoreOutcome::Notice(notice) => inner.notice = Some(notice),
            RestoreOutcome::Idle => {}
        }
        true
    }

    /// 当前状态快照（`vault_current` command 与测试共用）：vault 非空时按 root 重新对账
    /// 稳定身份并全量枚举。
    pub fn status(&self) -> Result<VaultStatus, CommandError> {
        let inner = self.inner.lock().expect("vault state poisoned");
        let vault = match &inner.root {
            Some(root) => Some(VaultInfo {
                vault_id: crate::workspaces::reconcile_vault(root)?.id,
                root: root.display().to_string(),
                entries: fs_io::scan_workspace(root)?,
                remap_candidates: vec![],
            }),
            None => None,
        };
        Ok(VaultStatus {
            vault,
            notice: inner.notice.clone(),
            restore_pending: inner.restore_pending,
        })
    }

    fn root(&self) -> Result<PathBuf, CommandError> {
        self.inner
            .lock()
            .expect("vault state poisoned")
            .root
            .clone()
            .ok_or_else(|| CommandError::new("vault_not_open", "尚未打开 vault，请先选择目录"))
    }

    /// 全量枚举结果建链接索引（open_vault 与测试共用）。
    fn build_graph(root: &Path, entries: &[FsEntry]) -> LinkGraph {
        let mut graph = LinkGraph::new();
        for e in entries {
            if e.kind != fs_io::FsEntryKind::File {
                continue;
            }
            let content = if link_graph::is_markdown(&e.path) {
                // 单文件读取失败不阻塞建图：索引缺其派生信息，路径仍在候选全集
                fs_io::read_text_file(root, &e.path).ok()
            } else {
                None
            };
            graph.upsert(&e.path, content.as_deref());
        }
        graph
    }

    /// watch 增量 → 链接索引就地更新（tasks 1.4：复用 fs:entry_changed 事件流）。
    pub fn apply_fs_changes(&self, changes: &[FsChange]) {
        let mut inner = self.inner.lock().expect("vault state poisoned");
        let Some(root) = inner.root.clone() else {
            return;
        };
        for c in changes {
            match c.kind {
                fs_io::FsChangeKind::Deleted => inner.graph.remove(&c.path),
                _ => {
                    if c.entry_kind == Some(fs_io::FsEntryKind::Dir) {
                        continue; // 目录本身不进候选全集
                    }
                    if link_graph::is_markdown(&c.path) {
                        let content = fs_io::read_text_file(&root, &c.path).ok();
                        inner.graph.upsert(&c.path, content.as_deref());
                    } else {
                        inner.graph.upsert(&c.path, None);
                    }
                }
            }
        }
    }
}

/// 打开 vault 的第一阶段（M159 两阶段拆分）：全部 IO 与副作用——remap 门、注册表对账、
/// 起 watch、全量枚举、建索引——都在这里完成，**不改写 `VaultState`**。未提交即 drop 的
/// watcher 等于不监听，所以「准备失败 / 被丢弃」都不会留下半个打开态。
pub struct PreparedVaultOpen {
    /// vault 根目录绝对路径。
    pub root: PathBuf,
    /// 稳定 vault 身份（`reconcile_vault` 的结果）。
    pub vault_id: String,
    pub entries: Vec<FsEntry>,
    /// 提交时随 [`VaultInner::commit`] 接管；提前 drop 即停止监听。
    pub watcher: VaultWatcher,
    /// 全量枚举结果建出的链接索引。
    pub graph: LinkGraph,
}

/// [`prepare_vault_open`] 的两种结果：真正备好的打开，或 remap 候选短路（**没有**打开
/// 任何 vault，行为与拆分前逐字一致）。
pub enum PreparedOpen {
    Remap {
        root: PathBuf,
        candidates: Vec<crate::workspaces::VaultWorkspace>,
    },
    /// Boxed：`PreparedVaultOpen` 比 Remap 分支大一个数量级（clippy::large_enum_variant）。
    Ready(Box<PreparedVaultOpen>),
}

/// 打开 vault 的第一阶段实现（见 [`PreparedVaultOpen`]）。
pub fn prepare_vault_open(
    app: &tauri::AppHandle,
    root: PathBuf,
    force_new: bool,
) -> Result<PreparedOpen, CommandError> {
    // 已注册路径直接打开，不受 remap 门影响（M121 修复：幽灵注册项曾拦停
    // 已注册 vault）。门判定只读——reconcile_vault 对未注册路径有注册 side effect，
    // 不能用来探测「目标未注册」。
    if !force_new {
        if let Some(candidates) = crate::workspaces::remap_gate(&root)? {
            return Ok(PreparedOpen::Remap { root, candidates });
        }
    }
    // Register/reconcile stable vault identity before opening.
    let workspace = crate::workspaces::reconcile_vault(&root)?;
    // 顺序：先 watch（FSEvents 流起点在此刻）再全量枚举，消除 scan→watch 的
    // 事件空窗；枚举结果随后播种进 watcher 的已知路径集（修正重放的误报 Create）。
    let app_for_watch = app.clone();
    let watch_root = root.clone();
    let watcher = fs_io::watch(&watch_root, move |changes: Vec<FsChange>| {
        // 链接索引随事件流增量更新（先于 emit：前端收到事件时索引已新）
        app_for_watch
            .state::<VaultState>()
            .apply_fs_changes(&changes);
        // webview 尚未就绪时 emit 失败无害：前端启动后经 vault_current 拉全量
        let _ = app_for_watch.emit("fs:entry_changed", FsEntryChangedEvent { changes });
    })?;
    let entries = fs_io::scan_workspace(&root)?;
    watcher.seed(entries.iter().map(|e| e.path.clone()));
    let graph = VaultState::build_graph(&root, &entries);
    Ok(PreparedOpen::Ready(Box::new(PreparedVaultOpen {
        root,
        vault_id: workspace.id,
        entries,
        watcher,
        graph,
    })))
}

/// 打开 vault 的第二阶段：单次持锁提交，返回是否提交（prepare 的产物被 `commit` 接管后
/// 其 watch 随之生效）。`expect_generation` 为 `Some` 时先比对世代——启动恢复用它让位给
/// 用户抢先成功打开的 vault；不符即返回 `false` 且零副作用（prepared 被 drop = 不起监听）。
pub fn commit_vault_open(
    state: &VaultState,
    prepared: PreparedVaultOpen,
    expect_generation: Option<u64>,
) -> bool {
    let mut inner = state.inner.lock().expect("vault state poisoned");
    if let Some(expected) = expect_generation {
        if inner.generation != expected {
            return false;
        }
    }
    inner.commit(prepared);
    true
}

/// 启动恢复的终局（design §3.2/§5）：由恢复线程在提交前算出，交
/// [`VaultState::finish_restore`] 单次持锁裁决应用或整体丢弃。
pub enum RestoreOutcome {
    /// 恢复成功：提交已备好的打开结果。
    Opened(Box<PreparedVaultOpen>),
    /// 以人话提示结束（路径失效 / 配置加载失败 / 打开失败 / remap 候选）。
    Notice(String),
    /// 无 `last_vault`：终态是「未打开且无提示」，不写任何状态。
    Idle,
}

/// 打开 vault 的公共路径（`vault_open` / `vault_open_path` 两个 command 共用）：
/// 「prepare + 无条件 commit」等价于 M159 之前的单函数实现——全量枚举成功后才替换当前
/// vault、停旧 watch、起新 watch（spec：替换语义），remap 候选短路返回行为不变。
pub fn open_vault(
    app: &tauri::AppHandle,
    state: &VaultState,
    root: PathBuf,
    force_new: bool,
) -> Result<VaultInfo, CommandError> {
    match prepare_vault_open(app, root, force_new)? {
        PreparedOpen::Remap { root, candidates } => Ok(VaultInfo {
            vault_id: candidates[0].id.clone(),
            root: root.display().to_string(),
            entries: vec![],
            remap_candidates: candidates,
        }),
        PreparedOpen::Ready(prepared) => {
            let prepared = *prepared;
            let info = VaultInfo {
                vault_id: prepared.vault_id.clone(),
                root: prepared.root.display().to_string(),
                entries: prepared.entries.clone(),
                remap_candidates: vec![],
            };
            // expect_generation 为 None：用户主动打开无条件提交（与拆分前等价）。
            commit_vault_open(state, prepared, None);
            Ok(info)
        }
    }
}

/// last_vault 写回（配置即数据纪律，ADR 0002 §5）：
/// 在既有配置 JSON 上逐字段改写（未知字段原样保留），tmp + rename 原子写入。
pub fn write_last_vault(root: &Path) -> Result<(), CommandError> {
    write_last_vault_to(&config::config_dir()?.join("config.json"), root)
}

/// 指定配置文件路径的写回（可测：不依赖真实配置目录）。
pub(crate) fn write_last_vault_to(path: &Path, root: &Path) -> Result<(), CommandError> {
    let mut value: serde_json::Value = match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    };
    if !value.is_object() {
        value = serde_json::json!({});
    }
    merge_last_vault(&mut value, root);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| {
            CommandError::new(
                "config_write_failed",
                format!("无法创建配置目录 {}：{e}", dir.display()),
            )
        })?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(
        &tmp,
        serde_json::to_string_pretty(&value).expect("config serializes"),
    )
    .map_err(|e| {
        CommandError::new(
            "config_write_failed",
            format!("无法写入配置 {}：{e}", tmp.display()),
        )
    })?;
    std::fs::rename(&tmp, path).map_err(|e| {
        CommandError::new(
            "config_write_failed",
            format!("无法落盘配置 {}：{e}", path.display()),
        )
    })
}

/// 逐字段改写 last_vault 的纯函数部分（可测）。version 仅在缺失或不高于
/// 当前 schema 时写入：更高版本说明配置由更新版本的应用写入，盲写会把
/// 版本标记降回当前值（失真），保留原值让 config::load 继续按高版本 warning。
fn merge_last_vault(value: &mut serde_json::Value, root: &Path) {
    let version = value.get("version").and_then(|v| v.as_u64());
    if version.is_none_or(|v| v <= u64::from(config::SCHEMA_VERSION)) {
        value["version"] = serde_json::json!(config::SCHEMA_VERSION);
    }
    value["last_vault"] = serde_json::json!(root.display().to_string());
}

/// 打开成功后的记忆写回：失败降级为 warning，MUST NOT 让整条打开失败（M127
/// 修复 M121 reviewer 记录的既有分歧——打开成功却因记忆写失败返回 Err，前端
/// 不装载已打开的 vault）。打开是主结果，记忆只影响下次启动的自动恢复。
pub fn remember_last_vault(root: &Path) {
    match config::config_dir() {
        Ok(dir) => {
            remember_last_vault_to(&dir.join("config.json"), root);
        }
        Err(e) => warn_last_vault_failed(&e),
    }
}

/// 指定路径的记忆写回（可测）：写失败打 warning 并返回 false，不传播错误。
pub(crate) fn remember_last_vault_to(path: &Path, root: &Path) -> bool {
    match write_last_vault_to(path, root) {
        Ok(()) => true,
        Err(e) => {
            warn_last_vault_failed(&e);
            false
        }
    }
}

fn warn_last_vault_failed(e: &CommandError) {
    eprintln!("lumir: 记录 last_vault 失败（vault 已打开，本次忽略）：{e}");
}

/// 调系统目录选择器打开 vault；用户取消返回 Ok(None)，不产生错误状态。
/// 成功后写入 last_vault。
#[tauri::command(rename_all = "snake_case")]
pub async fn vault_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    force_new: bool,
) -> Result<Option<VaultInfo>, CommandError> {
    let picked = rfd::AsyncFileDialog::new()
        .set_title("选择 vault 目录")
        .pick_folder()
        .await;
    let Some(handle) = picked else {
        return Ok(None);
    };
    let root = handle.path().to_path_buf();
    let info = open_vault(&app, &state, root, force_new)?;
    // remap 候选短路返回（未实际打开）不写 last_vault：仅打开成功才记忆。
    // 记忆写失败降级为 warning（M127）：不把已成功的打开报成失败。
    if info.remap_candidates.is_empty() {
        remember_last_vault(Path::new(&info.root));
    }
    Ok(Some(info))
}

/// 按已知路径直接打开 vault（无目录选择器）：仅用于重映射确认后的重开——
/// 路径来自用户刚刚在选择器里选中的 VaultInfo.root，确认动作（作为新 vault /
/// 确认映射）不应再弹一次选择器让用户重选同一目录。
#[tauri::command(rename_all = "snake_case")]
pub fn vault_open_path(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    path: &str,
    force_new: bool,
) -> Result<VaultInfo, CommandError> {
    let info = open_vault(&app, &state, PathBuf::from(path), force_new)?;
    // remap 候选短路返回（未实际打开）不写 last_vault：仅打开成功才记忆。
    // 记忆写失败降级为 warning（M127），同 vault_open。
    if info.remap_candidates.is_empty() {
        remember_last_vault(Path::new(&info.root));
    }
    Ok(info)
}

/// 启动后查询当前 vault 状态（含恢复进行态与恢复失败的人话提示）。
#[tauri::command]
pub fn vault_current(state: tauri::State<'_, VaultState>) -> Result<VaultStatus, CommandError> {
    state.status()
}

/// 全量重扫当前 vault（前端按需调用；watch 期间常规刷新走增量事件）。
#[tauri::command]
pub fn fs_scan_workspace(
    state: tauri::State<'_, VaultState>,
) -> Result<Vec<FsEntry>, CommandError> {
    fs_io::scan_workspace(&state.root()?)
}

/// 读 vault 内文本文件与绑定 revision 快照（UTF-8）。
#[tauri::command(rename_all = "snake_case")]
pub fn fs_read_snapshot(
    state: tauri::State<'_, VaultState>,
    path: &str,
) -> Result<ReadSnapshot, CommandError> {
    let root = state.root()?;
    let (content, revision) = fs_io::read_text_snapshot(&root, path)?;
    Ok(ReadSnapshot { content, revision })
}

/// 读 vault 内二进制附件，返回 base64（裁决点 A：invoke + base64）。
#[tauri::command]
pub fn fs_read_attachment(
    state: tauri::State<'_, VaultState>,
    path: &str,
) -> Result<String, CommandError> {
    fs_io::read_attachment(&state.root()?, path)
}

#[tauri::command(rename_all = "snake_case")]
pub fn fs_file_revision(
    state: tauri::State<'_, VaultState>,
    path: &str,
) -> Result<String, CommandError> {
    fs_io::file_revision(&state.root()?, path)
}

#[tauri::command(rename_all = "snake_case")]
pub fn document_save(
    state: tauri::State<'_, VaultState>,
    path: &str,
    expected_revision: &str,
    content: &str,
) -> Result<String, CommandError> {
    let root = state.root()?;
    match fs_io::save_markdown(&root, path, expected_revision, content) {
        Ok(revision) => Ok(revision),
        Err(e) => {
            // 诊断埋点：CAS 冲突是本族里最要紧的摩擦信号（kind 冲突检测点就在这）。
            if e.code == "document_conflict" {
                crate::logging::save_conflict(path, &e.code);
            }
            Err(e)
        }
    }
}

/// 编辑器未保存修改（dirty）的后端镜像（M101 退出守卫）：前端 onDirty 每次变化
/// 经 document_set_dirty 同步；lib.rs 的退出/关窗守卫据此拦截。前端是唯一事实源，
/// 后端只保存最近一次上报值，不做独立推导。
/// 防滞留（M107）：镜像可能滞留 stale true——webview 重载后前端 dirty 复位为
/// false，而后端仍保留重载前的 true，退出将被永久拦截。因此前端初始化后主动
/// 推送一次当前 dirty 值（启动时必为 false，即复位镜像），见 src/main.ts。
#[derive(Default)]
pub struct DirtyState(AtomicBool);

impl DirtyState {
    pub fn set(&self, dirty: bool) {
        self.0.store(dirty, Ordering::SeqCst);
    }

    pub fn is_dirty(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

#[tauri::command]
pub fn document_set_dirty(
    state: tauri::State<'_, DirtyState>,
    dirty: bool,
) -> Result<(), CommandError> {
    state.set(dirty);
    Ok(())
}

/// 前端诊断事件统一入口（change add-diagnostics-logging）：前端不自行写日志文件，
/// 关键事件（渲染失败、autosave 跃迁、config warning、慢回调采样、外部修改命中）
/// 全部经这一条命令交给 Rust 侧落盘。
///
/// 事件名是 [`crate::logging::LogEventName`] 枚举——事件集与字段白名单的唯一来源在
/// Rust（TS 联合类型由 ts-rs 导出给前端 import），前端不另立清单；枚举反序列化失败
/// 即白名单外事件名，被 invoke 层拒绝。字段白名单校验在 logging 侧，拒绝时返回
/// `log_event_rejected` 错误信封（调用方按 best-effort 处理，日志不打断业务）。
#[tauri::command(rename_all = "snake_case")]
pub fn log_event(
    event: crate::logging::LogEventName,
    fields: HashMap<String, String>,
) -> Result<(), CommandError> {
    crate::logging::log_frontend_event(event, fields)
}

// ---------------------------------------------------------------------------
// 外链打开（M144，change add-external-link-open）
// ---------------------------------------------------------------------------

/// 外链 scheme 白名单——**唯一来源**。只有这三类能交给系统默认应用；其余 scheme
/// 一律拒绝（`file:` / `javascript:` / 应用自定义协议…）：文档内容不该能指挥操作
/// 系统去打开任意东西。前端不复制这份清单，它只把编辑器里读到的 URL 原文递过来。
const EXTERNAL_URL_SCHEMES: [&str; 3] = ["http", "https", "mailto"];

/// 去 CommonMark 的尖括号包裹形式（`[a](<https://x>)`）与首尾空白。
fn target_text(raw: &str) -> &str {
    let text = raw.trim();
    text.strip_prefix('<')
        .and_then(|inner| inner.strip_suffix('>'))
        .unwrap_or(text)
        .trim()
}

/// 归一 URL 的 scheme：命中白名单返回规范小写写法（`HTTP://x` 与 `http://x` 同归一），
/// 其余情况（白名单外的 scheme、没有 scheme）一律返回 `other`——诊断日志只记分类，
/// 不记原文。
fn scheme_label(target: &str) -> &'static str {
    let Some((scheme, _)) = target.split_once(':') else {
        return "other";
    };
    EXTERNAL_URL_SCHEMES
        .iter()
        .copied()
        .find(|allowed| allowed.eq_ignore_ascii_case(scheme))
        .unwrap_or("other")
}

/// 能否交给系统打开：scheme 在白名单内，且目标里没有空白 / 控制字符。
/// 后者是「还原不可信」的护栏——目标里混进空白或控制字符说明我们对这条 URL 的
/// 还原不可靠，宁可拒绝也不要把半截字符串递给系统。返回 (scheme 标签, 目标)。
fn openable_external_url(raw: &str) -> Option<(&'static str, &str)> {
    let target = target_text(raw);
    let scheme = scheme_label(target);
    if scheme == "other" || target.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }
    Some((scheme, target))
}

/// 在系统默认应用打开外链（http / https / mailto）。
///
/// 为什么用插件而不是自己拼 `open` 命令：跨平台语义由插件持有（macOS 走 NSWorkspace
/// 等价路径），本仓不维护一套平台分支。为什么走 Rust 侧而不是前端 JS API：webview 对
/// opener 命令的 ACL 保持默认拒绝（capabilities 不加任何 `opener:*` 权限），唯一入口
/// 是这条 command——scheme 校验、诊断埋点、错误信封都只在一个地方，webview 里没有第二
/// 条能绕开校验去开 URL 的路径。
///
/// 校验落在 Rust：前端可能被文档内容影响（URL 来自 Markdown 正文），信任边界在这一侧。
/// 拒绝时返回 `open_url_rejected`（前端 toast 人话），失败时返回 `open_url_failed`。
#[tauri::command(rename_all = "snake_case")]
pub fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), CommandError> {
    use tauri_plugin_opener::OpenerExt;

    let Some((scheme, target)) = openable_external_url(&url) else {
        crate::logging::link_open(
            "blocked-scheme",
            "rejected",
            Some(scheme_label(target_text(&url))),
        );
        return Err(CommandError::new(
            "open_url_rejected",
            format!("打不开这类链接：{url}——只支持 http、https、mailto"),
        ));
    };
    match app.opener().open_url(target, None::<&str>) {
        Ok(()) => {
            crate::logging::link_open("external", "opened", Some(scheme));
            Ok(())
        }
        Err(e) => {
            crate::logging::link_open("external", "failed", Some(scheme));
            Err(CommandError::new(
                "open_url_failed",
                format!("打开链接失败：{e}"),
            ))
        }
    }
}

// ---------------------------------------------------------------------------
// 相对路径链接（M145，change add-external-link-open 的形态矩阵补全）
// ---------------------------------------------------------------------------

/// 解析相对路径 md 链接 `[x](note.md)`：以 `from` 所在目录为基准（`./` `..` 归一，
/// 允许 `..` 只要不越出 vault 根），命中的 vault 相对路径经 link_graph 的文件全集
/// 判定——语义与 wikilink 的名称匹配不同源，见 `LinkGraph::resolve_relative`。
///
/// 返回 `None` = 解析不到（目标不存在 / 越出 vault 根 / 空路径）。**这不是错误**：
/// 前端只给「链接目标不存在」toast，MUST NOT 创建文件（一键创建是 wikilink 的显式
/// 动作，相对路径链接不继承它）。`#fragment` 部分按 M145 口径忽略。
#[tauri::command(rename_all = "snake_case")]
pub fn link_resolve_note(
    state: tauri::State<'_, VaultState>,
    from: String,
    target: String,
) -> Result<Option<String>, CommandError> {
    let inner = state.inner.lock().expect("vault state poisoned");
    if inner.root.is_none() {
        return Err(CommandError::new(
            "vault_not_open",
            "尚未打开 vault，请先选择目录",
        ));
    }
    Ok(inner.graph.resolve_relative(&from, &target))
}

/// 在系统默认应用打开 vault 内的非 md 文件 `[x](./doc.pdf)` / 目录 `[x](docs/)`。
///
/// 与 `open_external_url` 同一分层与同一条最小权限路径（opener 插件的 IPC 对 webview
/// 保持默认拒绝，唯一入口是本仓 command）。区别在信任边界：外链校验的是 scheme，
/// 这里校验的是**目标必须落在 vault 内**——路径归一后交给 `fs_io::resolve_in_vault`
/// （拒绝绝对路径 / `..` / 符号链接逃逸，且目标必须存在），前缀校验与读取链路同源。
/// 越界 → `link_path_rejected`，不存在 / 不可访问 → 透传 fs 侧的人话错误。
#[tauri::command(rename_all = "snake_case")]
pub fn link_open_path(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    from: String,
    target: String,
) -> Result<(), CommandError> {
    use tauri_plugin_opener::OpenerExt;

    let root = state.root()?;
    let Some(rel) = link_graph::relative_vault_path(&from, &target) else {
        crate::logging::link_open("asset", "rejected", None);
        return Err(CommandError::new(
            "link_path_rejected",
            format!("打不开这个目标：{target}——它不在 vault 内"),
        ));
    };
    let abs = match fs_io::resolve_in_vault(&root, &rel) {
        Ok(abs) => abs,
        Err(e) => {
            crate::logging::link_open("asset", "rejected", None);
            return Err(e);
        }
    };
    let Some(abs) = abs.to_str() else {
        crate::logging::link_open("asset", "rejected", None);
        return Err(CommandError::new(
            "link_path_rejected",
            format!("打不开这个目标：{rel}——路径含非 UTF-8 字符"),
        ));
    };
    match app.opener().open_path(abs, None::<&str>) {
        Ok(()) => {
            crate::logging::link_open("asset", "opened", None);
            Ok(())
        }
        Err(e) => {
            crate::logging::link_open("asset", "failed", None);
            Err(CommandError::new(
                "link_path_failed",
                format!("打开文件失败：{e}"),
            ))
        }
    }
}

// ---------------------------------------------------------------------------
// 崩溃备份（M127，change save-hardening）
// ---------------------------------------------------------------------------

/// 编辑器 dirty 内容写崩溃备份（按当前 vault + vault 相对路径定位，见 recovery 模块）。
/// `base_revision` = 备份时编辑器已知的磁盘 revision，恢复侧据此对账（评审 round 1
/// P2-1）：备份之后磁盘若被外部修改，恢复后的保存按 CAS 报冲突，不静默覆盖较新版本。
/// 保存成功后前端调用 recovery_discard 清除；进程崩溃时残留项由前端启动时枚举并
/// 给用户恢复入口。写失败返回人话错误，前端只当 warning（不打断编辑）。
#[tauri::command(rename_all = "snake_case")]
pub fn recovery_backup(
    state: tauri::State<'_, VaultState>,
    path: &str,
    content: &str,
    base_revision: &str,
) -> Result<(), CommandError> {
    crate::recovery::backup(&state.root()?, path, content, base_revision)?;
    // 诊断埋点：备份写入成功（recovery 的既有事件点）。
    crate::logging::recovery_written(path);
    Ok(())
}

/// 读崩溃备份内容；无备份返回 null（不是错误）。
#[tauri::command(rename_all = "snake_case")]
pub fn recovery_load(
    state: tauri::State<'_, VaultState>,
    path: &str,
) -> Result<Option<String>, CommandError> {
    let entry = crate::recovery::load(&state.root()?, path)?;
    if entry.is_some() {
        // 诊断埋点：读到备份 = 用户选择了「恢复内容」（恢复链路在 Rust 侧唯一的可观测点；
        // 随后的编辑器装载在前端，Rust 不可见）。
        crate::logging::recovery_restored(path);
    }
    Ok(entry.map(|entry| entry.content))
}

/// 备份记录的 CAS 基准 revision（恢复时作保存基准用）；无备份 / 老格式备份返回 null
/// （null = 基准未知，恢复侧按必定冲突处理，不静默覆盖磁盘）。
#[tauri::command(rename_all = "snake_case")]
pub fn recovery_base_revision(
    state: tauri::State<'_, VaultState>,
    path: &str,
) -> Result<Option<String>, CommandError> {
    Ok(crate::recovery::load(&state.root()?, path)?.and_then(|entry| entry.base_revision))
}

/// 删除崩溃备份（保存成功 / 用户丢弃）；幂等。
#[tauri::command(rename_all = "snake_case")]
pub fn recovery_discard(
    state: tauri::State<'_, VaultState>,
    path: &str,
) -> Result<(), CommandError> {
    crate::recovery::discard(&state.root()?, path)
}

/// 当前 vault 的残留备份清单（vault 相对路径）：前端装载 vault 后据此决定是否
/// 给恢复提示。无残留返回空表。
#[tauri::command]
pub fn recovery_list(state: tauri::State<'_, VaultState>) -> Result<Vec<String>, CommandError> {
    crate::recovery::list(&state.root()?)
}

// ---------------------------------------------------------------------------
// link graph / wikilink（add-wikilink）
// ---------------------------------------------------------------------------

/// 解析单条 wikilink（装饰三态与跳转共用）。`from` = 链接所在文件的 vault 相对路径，
/// `link` = 链接原文（含 `[[`/`]]`，embed 含 `!` 前缀）。语义唯一实现见 link_graph。
#[tauri::command]
pub fn link_graph_resolve(
    state: tauri::State<'_, VaultState>,
    from: &str,
    link: &str,
) -> Result<LinkResolveResult, CommandError> {
    let inner = state.inner.lock().expect("vault state poisoned");
    if inner.root.is_none() {
        return Err(CommandError::new(
            "vault_not_open",
            "尚未打开 vault，请先选择目录",
        ));
    }
    inner.graph.resolve_link(from, link)
}

/// 未创建链接一键创建（spec §4.4，裁决点 I）：当前文件所在目录建空文件
/// （from 在 vault 根时建于根；target 含 `/` 时按 vault 根相对并补中间目录）。
/// MUST NOT 覆盖或改写任何既有文件（ADR 0003 §3 铁律）：目标已存在 = 索引过期，
/// 报 wikilink_target_exists，前端重新解析。
#[tauri::command]
pub fn wikilink_create(
    state: tauri::State<'_, VaultState>,
    from: &str,
    link: &str,
) -> Result<CreateNoteResult, CommandError> {
    let mut inner = state.inner.lock().expect("vault state poisoned");
    let root = inner
        .root
        .clone()
        .ok_or_else(|| CommandError::new("vault_not_open", "尚未打开 vault，请先选择目录"))?;
    let created = inner.graph.create_note(&root, from, link)?;
    Ok(CreateNoteResult { created })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dirty_state_mirrors_latest_report() {
        let state = DirtyState::default();
        assert!(!state.is_dirty());
        state.set(true);
        assert!(state.is_dirty());
        state.set(false);
        assert!(!state.is_dirty());
    }

    /// 外链 scheme 白名单（M144）：白名单内的 scheme 大小写不敏感归一到规范写法，
    /// 其余（含没有 scheme、相对路径、应用自定义协议）一律归 `other`。
    #[test]
    fn external_url_scheme_whitelist() {
        assert_eq!(scheme_label("https://example.invalid/x"), "https");
        assert_eq!(scheme_label("HTTPS://example.invalid/x"), "https");
        assert_eq!(scheme_label("http://example.invalid"), "http");
        assert_eq!(scheme_label("mailto:a@b.invalid"), "mailto");
        assert_eq!(scheme_label("MaIlTo:a@b.invalid"), "mailto");

        assert_eq!(scheme_label("javascript:alert(1)"), "other");
        assert_eq!(scheme_label("file:///etc/hosts"), "other");
        assert_eq!(scheme_label("obsidian://open?vault=x"), "other");
        assert_eq!(scheme_label("note.md"), "other");
        assert_eq!(scheme_label("/abs/path.md"), "other");
        assert_eq!(scheme_label("#heading"), "other");
        assert_eq!(scheme_label(""), "other");
    }

    /// 尖括号包裹形式与首尾空白：`[a](<https://x>)` 是 CommonMark 的写法，取出的是
    /// 里面的目标；只有成对时才剥（落单的 `<` 是目标内容的一部分）。
    #[test]
    fn external_url_target_text_strips_angle_wrapper() {
        assert_eq!(
            target_text("  https://x.invalid/y  "),
            "https://x.invalid/y"
        );
        assert_eq!(target_text("<https://x.invalid/y>"), "https://x.invalid/y");
        assert_eq!(target_text(" <mailto:a@b.invalid> "), "mailto:a@b.invalid");
        assert_eq!(target_text("<https://x.invalid"), "<https://x.invalid");
        assert_eq!(target_text("https://x.invalid>"), "https://x.invalid>");
    }

    /// 白名单内的 scheme 也可能因目标不可信被拒：解析出的目标含空白或控制字符时
    /// 不打开（还原不出用户真正想开的东西，宁可拒绝）。
    #[test]
    fn external_url_openable_requires_scheme_and_clean_target() {
        assert_eq!(
            openable_external_url("https://x.invalid/a"),
            Some(("https", "https://x.invalid/a"))
        );
        assert_eq!(
            openable_external_url("  <mailto:a@b.invalid> "),
            Some(("mailto", "mailto:a@b.invalid"))
        );
        assert_eq!(
            openable_external_url("https://x.invalid/a%20b"),
            Some(("https", "https://x.invalid/a%20b"))
        );

        assert_eq!(openable_external_url("https://x.invalid/a b"), None);
        assert_eq!(openable_external_url("https://x.invalid/a\nb"), None);
        assert_eq!(openable_external_url("https://x.invalid/\u{7}"), None);
        assert_eq!(openable_external_url("javascript:alert(1)"), None);
        assert_eq!(openable_external_url("note.md"), None);
    }

    #[test]
    fn merge_last_vault_sets_fields_and_preserves_unknown() {
        let mut value = serde_json::json!({"version": 1, "future_field": true});
        merge_last_vault(&mut value, Path::new("/tmp/vault"));
        assert_eq!(value["version"], serde_json::json!(config::SCHEMA_VERSION));
        assert_eq!(value["last_vault"], serde_json::json!("/tmp/vault"));
        assert_eq!(value["future_field"], serde_json::json!(true));
    }

    #[test]
    fn merge_last_vault_writes_version_when_missing_or_older() {
        let mut missing = serde_json::json!({});
        merge_last_vault(&mut missing, Path::new("/tmp/vault"));
        assert_eq!(
            missing["version"],
            serde_json::json!(config::SCHEMA_VERSION)
        );

        let mut older = serde_json::json!({"version": 0});
        merge_last_vault(&mut older, Path::new("/tmp/vault"));
        assert_eq!(older["version"], serde_json::json!(config::SCHEMA_VERSION));
    }

    #[test]
    fn merge_last_vault_preserves_newer_version() {
        let mut value = serde_json::json!({"version": 99});
        merge_last_vault(&mut value, Path::new("/tmp/vault"));
        // 高版本配置由更新版本应用写入，不把 version 降回当前值
        assert_eq!(value["version"], serde_json::json!(99));
        assert_eq!(value["last_vault"], serde_json::json!("/tmp/vault"));
    }

    /// M127：last_vault 写失败必须降级为 warning（返回 false、不 panic、不传播），
    /// 打开成功不被记忆失败抹成失败。写成功路径同时验证字段落盘。
    #[test]
    fn remember_last_vault_degrades_write_failure_to_warning() {
        let dir =
            std::env::temp_dir().join(format!("lumir-last-vault-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let good = dir.join("config.json");
        assert!(remember_last_vault_to(&good, Path::new("/tmp/vault")));
        let saved: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&good).unwrap()).unwrap();
        assert_eq!(saved["last_vault"], serde_json::json!("/tmp/vault"));

        // 父路径是一个普通文件 → create_dir_all 必失败
        let blocker = dir.join("not-a-dir");
        std::fs::write(&blocker, "x").unwrap();
        let bad = blocker.join("config.json");
        assert!(!remember_last_vault_to(&bad, Path::new("/tmp/vault")));

        let _ = std::fs::remove_dir_all(&dir);
    }

    // -----------------------------------------------------------------------
    // M159：启动恢复的两阶段状态机（begin/finish_restore + commit_vault_open）
    //
    // 这些测试不需要 AppHandle：`fs_io::watch` 只依赖目录与回调，因此 prepared 可以直接
    // 造出来，世代让位规则无线程即可覆盖（tasks 3.1/3.2 的判定面）。
    // -----------------------------------------------------------------------

    /// 恢复状态机测试用的临时 vault（Drop 时删除；沿用「无 tempfile 依赖」的既有纪律）。
    struct TempVault(PathBuf);

    impl TempVault {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "lumir-vault-restore-test-{}-{tag}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).expect("create temp vault");
            Self(path)
        }

        fn path(&self) -> PathBuf {
            self.0.clone()
        }
    }

    impl Drop for TempVault {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// 已备好的打开结果（prepare 的产物）。状态机测试不关心 entries/graph——提交只是搬移
    /// 它们，因此取空。
    fn prepared(vault: &TempVault) -> PreparedVaultOpen {
        let root = vault.path();
        PreparedVaultOpen {
            root: root.clone(),
            vault_id: "test-vault".into(),
            entries: vec![],
            watcher: fs_io::watch(&root, |_| {}).expect("watch temp vault"),
            graph: LinkGraph::new(),
        }
    }

    fn root_of(state: &VaultState) -> Option<PathBuf> {
        state
            .inner
            .lock()
            .expect("vault state poisoned")
            .root
            .clone()
    }

    fn notice_of(state: &VaultState) -> Option<String> {
        state
            .inner
            .lock()
            .expect("vault state poisoned")
            .notice
            .clone()
    }

    fn pending_of(state: &VaultState) -> bool {
        state
            .inner
            .lock()
            .expect("vault state poisoned")
            .restore_pending
    }

    fn generation_of(state: &VaultState) -> u64 {
        state.inner.lock().expect("vault state poisoned").generation
    }

    /// M159 3.1：`begin_restore` 置进行态，并把「此刻的世代」交给恢复任务作提交比对基准。
    #[test]
    fn begin_restore_marks_pending_and_reports_current_generation() {
        let state = VaultState::default();
        assert!(!pending_of(&state));
        assert_eq!(state.begin_restore(), 0);
        assert!(pending_of(&state));

        // 用户先打开过 vault：恢复记下的是跃迁之后的世代
        let a = TempVault::new("begin-a");
        assert!(commit_vault_open(&state, prepared(&a), None));
        assert_eq!(state.begin_restore(), 1);
        assert!(pending_of(&state));
    }

    /// M159 3.1：世代一致时提交：写 root、清 notice、世代 +1、进行态清零。
    #[test]
    fn finish_restore_commits_and_bumps_generation_on_matching_generation() {
        let state = VaultState::default();
        let a = TempVault::new("finish-ok");
        let generation = state.begin_restore();
        assert!(state.finish_restore(generation, RestoreOutcome::Opened(Box::new(prepared(&a)))));
        assert_eq!(root_of(&state), Some(a.path()));
        assert_eq!(notice_of(&state), None);
        assert_eq!(generation_of(&state), 1);
        assert!(!pending_of(&state));
    }

    /// M159 3.1/3.2：用户抢先成功打开 B 后到达的**成功**恢复结果被整体丢弃，
    /// 当前 vault 仍是用户那个（spec「恢复结果不覆盖用户已打开的 vault」）。
    #[test]
    fn finish_restore_discards_stale_success_and_keeps_user_vault() {
        let state = VaultState::default();
        let a = TempVault::new("stale-a");
        let b = TempVault::new("stale-b");
        let generation = state.begin_restore();
        assert!(commit_vault_open(&state, prepared(&b), None)); // 用户抢先成功打开 B
        assert!(!state.finish_restore(generation, RestoreOutcome::Opened(Box::new(prepared(&a)))));
        assert_eq!(root_of(&state), Some(b.path())); // 不是恢复给的 A
        assert_eq!(generation_of(&state), 1); // 丢弃不产生世代跃迁
        assert!(!pending_of(&state));
    }

    /// M159 3.1：过期**失败**路径的提示同样被丢弃——用户已打开的 vault 不该被上次 vault
    /// 的失败提示污染（让位是整包的，不是只让 vault）。
    #[test]
    fn finish_restore_discards_stale_notice() {
        let state = VaultState::default();
        let b = TempVault::new("stale-notice");
        let generation = state.begin_restore();
        assert!(commit_vault_open(&state, prepared(&b), None));
        assert!(!state.finish_restore(
            generation,
            RestoreOutcome::Notice("上次打开的 vault 已不可用：/gone".into())
        ));
        assert_eq!(notice_of(&state), None);
        assert_eq!(root_of(&state), Some(b.path()));
        assert!(!pending_of(&state));
    }

    /// M159 3.1：世代一致时提示路径写入 notice，且不碰 root 与世代（未打开任何 vault 的终态）。
    #[test]
    fn finish_restore_applies_notice_without_touching_vault() {
        let state = VaultState::default();
        let generation = state.begin_restore();
        assert!(state.finish_restore(
            generation,
            RestoreOutcome::Notice("配置加载失败：坏配置".into())
        ));
        assert_eq!(notice_of(&state), Some("配置加载失败：坏配置".into()));
        assert_eq!(root_of(&state), None);
        assert_eq!(generation_of(&state), 0);
        assert!(!pending_of(&state));
    }

    /// M159 3.1：四条结束路径（成功 / 无 last_vault / 提示 / 过期丢弃）走完，`restore_pending`
    /// 必为 false——否则界面会永远停在「恢复中」。
    #[test]
    fn restore_pending_clears_on_every_end_path() {
        // 成功
        let opened = VaultState::default();
        let a = TempVault::new("paths-opened");
        let generation = opened.begin_restore();
        opened.finish_restore(generation, RestoreOutcome::Opened(Box::new(prepared(&a))));
        assert!(!pending_of(&opened));

        // 无 last_vault（Idle：不写任何状态）
        let idle = VaultState::default();
        let generation = idle.begin_restore();
        assert!(idle.finish_restore(generation, RestoreOutcome::Idle));
        assert!(!pending_of(&idle));
        assert_eq!(root_of(&idle), None);
        assert_eq!(notice_of(&idle), None);

        // 提示（路径失效 / 配置加载失败 / 打开失败）
        let noticed = VaultState::default();
        let generation = noticed.begin_restore();
        noticed.finish_restore(
            generation,
            RestoreOutcome::Notice("恢复上次 vault 失败：坏了".into()),
        );
        assert!(!pending_of(&noticed));

        // 过期丢弃（用户抢先成功打开）
        let stale = VaultState::default();
        let b = TempVault::new("paths-stale");
        let generation = stale.begin_restore();
        assert!(commit_vault_open(&stale, prepared(&b), None));
        assert!(!stale.finish_restore(generation, RestoreOutcome::Idle));
        assert!(!pending_of(&stale));
    }

    /// M159 3.1：`commit_vault_open` 的世代比对不符即拒绝，零副作用（prepared 被丢弃、
    /// 世代不跃迁、当前 vault 不动）。
    #[test]
    fn commit_vault_open_rejects_mismatched_generation() {
        let state = VaultState::default();
        let a = TempVault::new("commit-a");
        let b = TempVault::new("commit-b");
        let generation = state.begin_restore();
        assert!(commit_vault_open(&state, prepared(&b), None));
        assert!(!commit_vault_open(&state, prepared(&a), Some(generation)));
        assert_eq!(root_of(&state), Some(b.path()));
        assert_eq!(generation_of(&state), 1);
    }

    /// M159 3.1：用户 picker 取消 / 打开失败都不提交，世代不变——恢复结果因此照常生效。
    /// 前端「只有成功装载才让位」与后端「失败不产生世代跃迁」在这一条上对称。
    #[test]
    fn restore_still_applies_when_user_open_did_not_commit() {
        let state = VaultState::default();
        let a = TempVault::new("no-commit-a");
        let generation = state.begin_restore();
        // 取消 / 打开异常：没有任何提交，世代仍是恢复记下的那个
        assert!(state.finish_restore(generation, RestoreOutcome::Opened(Box::new(prepared(&a)))));
        assert_eq!(root_of(&state), Some(a.path()));
    }

    /// M159：`vault_current` 的取值口（[`VaultState::status`]）如实报出进行态与终态。
    #[test]
    fn status_reports_restore_pending_then_terminal() {
        let state = VaultState::default();
        assert!(!state.status().unwrap().restore_pending);

        let generation = state.begin_restore();
        let pending = state.status().unwrap();
        assert!(pending.restore_pending);
        assert!(pending.vault.is_none());

        state.finish_restore(
            generation,
            RestoreOutcome::Notice("上次打开的 vault 已不可用：/gone".into()),
        );
        let terminal = state.status().unwrap();
        assert!(!terminal.restore_pending);
        assert_eq!(
            terminal.notice.as_deref(),
            Some("上次打开的 vault 已不可用：/gone")
        );
    }
}
