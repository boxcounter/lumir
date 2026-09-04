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
use tauri::Emitter;
use ts_rs::TS;

use crate::config::{self, ConfigSnapshot};
use crate::fs_io::{self, FsChange, FsEntry, FsEntryChangedEvent, VaultWatcher};

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
}

/// 打开 vault 的公共路径（vault_open command 与 lib.rs 启动恢复共用）：
/// 全量枚举成功后才替换当前 vault、停旧 watch、起新 watch（spec：替换语义）。
pub fn open_vault(
    app: &tauri::AppHandle,
    state: &VaultState,
    root: PathBuf,
) -> Result<VaultInfo, CommandError> {
    // 顺序：先 watch（FSEvents 流起点在此刻）再全量枚举，消除 scan→watch 的
    // 事件空窗；枚举结果随后播种进 watcher 的已知路径集（修正重放的误报 Create）。
    let app_for_watch = app.clone();
    let watch_root = root.clone();
    let watcher = fs_io::watch(&watch_root, move |changes: Vec<FsChange>| {
        // webview 尚未就绪时 emit 失败无害：前端启动后经 vault_current 拉全量
        let _ = app_for_watch.emit("fs:entry_changed", FsEntryChangedEvent { changes });
    })?;
    let entries = fs_io::scan_workspace(&root)?;
    watcher.seed(entries.iter().map(|e| e.path.clone()));
    let mut inner = state.inner.lock().expect("vault state poisoned");
    // 先起好新 watcher 再替换；旧 watcher 随字段覆盖被 drop，监听停止
    inner.watcher = Some(watcher);
    inner.root = Some(root.clone());
    inner.notice = None;
    Ok(VaultInfo {
        root: root.display().to_string(),
        entries,
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
    value["version"] = serde_json::json!(config::SCHEMA_VERSION);
    value["last_vault"] = serde_json::json!(root.display().to_string());
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
