//! invoke / event 契约薄约定 —— M1 接缝（架构复查 P1-2）。
//!
//! M1 起所有 webview ↔ Rust core 通信遵守以下约定：
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
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use ts_rs::TS;

use crate::config::{self, ConfigSnapshot};
use crate::fs_io::{self, FsChange, FsEntry, FsEntryChangedEvent, VaultWatcher};
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
    /// vault 根目录绝对路径。
    pub root: String,
    pub entries: Vec<FsEntry>,
    pub remap_candidates: Vec<crate::threads::VaultWorkspace>,
}

/// 前端启动时查询的 vault 状态。
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct VaultStatus {
    /// 当前打开的 vault；未打开为 null。
    pub vault: Option<VaultInfo>,
    /// 人话提示（如 last_vault 恢复失败）；无提示为 null。前端可直接展示。
    pub notice: Option<String>,
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
}

impl Default for VaultState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(VaultInner::default()),
        }
    }
}

impl VaultState {
    /// 供 lib.rs 启动恢复写入提示。
    pub fn set_notice(&self, notice: String) {
        self.inner.lock().expect("vault state poisoned").notice = Some(notice);
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

/// 打开 vault 的公共路径（vault_open command 与 lib.rs 启动恢复共用）：
/// 全量枚举成功后才替换当前 vault、停旧 watch、起新 watch（spec：替换语义）。
pub fn open_vault(
    app: &tauri::AppHandle,
    state: &VaultState,
    root: PathBuf,
) -> Result<VaultInfo, CommandError> {
    // Unknown paths with stale registrations require explicit remap confirmation.
    let candidates = crate::threads::remap_candidates(&root)?;
    if !candidates.is_empty() {
        return Ok(VaultInfo {
            root: root.display().to_string(),
            entries: vec![],
            remap_candidates: candidates,
        });
    }
    // Register/reconcile stable vault identity before opening.
    crate::threads::reconcile_vault(&root)?;
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
    let mut inner = state.inner.lock().expect("vault state poisoned");
    // 先起好新 watcher 再替换；旧 watcher 随字段覆盖被 drop，监听停止
    inner.watcher = Some(watcher);
    inner.root = Some(root.clone());
    inner.notice = None;
    inner.graph = graph;
    Ok(VaultInfo {
        root: root.display().to_string(),
        entries,
        remap_candidates: vec![],
    })
}

/// last_vault 写回（配置即数据纪律，ADR 0002 §5）：
/// 在既有配置 JSON 上逐字段改写（未知字段原样保留），tmp + rename 原子写入。
pub fn write_last_vault(root: &Path) -> Result<(), CommandError> {
    let path = config::config_dir()?.join("config.json");
    let mut value: serde_json::Value = match std::fs::read_to_string(&path) {
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
    std::fs::rename(&tmp, &path).map_err(|e| {
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

/// 调系统目录选择器打开 vault；用户取消返回 Ok(None)，不产生错误状态。
/// 成功后写入 last_vault。
#[tauri::command]
pub async fn vault_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
) -> Result<Option<VaultInfo>, CommandError> {
    let picked = rfd::AsyncFileDialog::new()
        .set_title("选择 vault 目录")
        .pick_folder()
        .await;
    let Some(handle) = picked else {
        return Ok(None);
    };
    let root = handle.path().to_path_buf();
    let info = open_vault(&app, &state, root)?;
    write_last_vault(Path::new(&info.root))?;
    Ok(Some(info))
}

/// 启动后查询当前 vault 状态（含恢复失败的人话提示）。
#[tauri::command]
pub fn vault_current(state: tauri::State<'_, VaultState>) -> Result<VaultStatus, CommandError> {
    let inner = state.inner.lock().expect("vault state poisoned");
    let vault = match &inner.root {
        Some(root) => Some(VaultInfo {
            root: root.display().to_string(),
            entries: fs_io::scan_workspace(root)?,
            remap_candidates: vec![],
        }),
        None => None,
    };
    Ok(VaultStatus {
        vault,
        notice: inner.notice.clone(),
    })
}

/// 全量重扫当前 vault（前端按需调用；watch 期间常规刷新走增量事件）。
#[tauri::command]
pub fn fs_scan_workspace(
    state: tauri::State<'_, VaultState>,
) -> Result<Vec<FsEntry>, CommandError> {
    fs_io::scan_workspace(&state.root()?)
}

/// 读 vault 内文本文件（UTF-8）。
#[tauri::command]
pub fn fs_read_file(
    state: tauri::State<'_, VaultState>,
    path: &str,
) -> Result<String, CommandError> {
    fs_io::read_text_file(&state.root()?, path)
}

/// 读 vault 内二进制附件，返回 base64（裁决点 A：invoke + base64）。
#[tauri::command]
pub fn fs_read_attachment(
    state: tauri::State<'_, VaultState>,
    path: &str,
) -> Result<String, CommandError> {
    fs_io::read_attachment(&state.root()?, path)
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
}
