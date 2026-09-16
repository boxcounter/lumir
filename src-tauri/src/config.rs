//! 配置加载 —— M1 基础（ADR 0002 §5，架构复查 P2-6）。
//!
//! - 路径：macOS/Linux 遵循 `$XDG_CONFIG_HOME`（默认 `~/.config/lumir`），
//!   Windows 用 `%APPDATA%\lumir`，不采用 `~/Library/Application Support`
//!   （ADR 0002 §5 已定：配置需人可读可改，遵循 dotfile 生态惯例）。
//! - 校验：逐字段校验，非法值落回该字段默认值并附人话 warning；
//!   整文件不是合法 JSON 时才整体落回默认配置。
//! - 未知字段忽略（向前兼容：新版写入的字段旧版读取不报错）。
//!
//! ## keys 表（M132）：形状校验在此，命令 id 校验在前端
//!
//! `keys` 是键位覆盖表（单键重绑 / 解绑）。本模块只校验**形状**：键位非空且不含空白
//!（含空白即多段 chord，本版不支持）、值是非空字符串（命令 id）或 null（解绑）。命令 id
//! 是否**已知**由前端键位层判定：命令清单的单一来源是 src/keys.ts 的 COMMAND_IDS，在
//! Rust 侧复制一份只会得到两份必然漂移的清单——正是 M131 要消灭的并列来源。
//!
//! ## 格式选型：JSON 而非 TOML
//!
//! 选 JSON：serde_json 已是依赖（零新增，契合本仓低依赖取向）；报错带行列号，
//! 便于生成人话错误；前后端同格式免转换。代价：不支持注释、手写编辑体验逊于
//! TOML。若 dogfood 阶段手改配置成为高频动作，重评 TOML（届时只需换本模块的
//! 解析两行，对外契约不变）。
//!
//! ## log 表（add-diagnostics-logging）
//!
//! `{"log": {"level": "info" | "off"}}`，默认 `info`（dogfood 期需要数据）。
//! 形状校验与 keys 表同口径：整表收成 Value 逐项判定，非法值只回退该字段并附人话
//! warning（`{"log": "info"}` 这种错形状也只丢这一项，不拖垮整文件）。`level` 的
//! 消费方是 src-tauri/src/logging.rs（`off` 时事件丢弃不写盘）。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use ts_rs::TS;

use crate::commands::CommandError;

/// 当前配置 schema 版本。写入配置时携带，读取时高于此版本则 warning 并按当前版本解释。
pub const SCHEMA_VERSION: u32 = 1;

/// 生效配置（唯一类型定义点，TS 类型由 ts-rs 导出）。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AppConfig {
    pub version: u32,
    /// 上次打开的 vault 路径（启动时 `restore_last_vault` 恢复，vault 打开成功时
    /// `write_last_vault` 写回）。
    pub last_vault: Option<String>,
    pub editor: EditorConfig,
    /// 键位覆盖表（M132）：键位写法 → 命令 id；值为 null 表示解绑该键位。
    /// 键位写法与前端键位 token 同源（如 `"Cmd-s"`、`"Ctrl-Alt-Minus"`、`"ArrowUp"`）；
    /// 多段 chord（含空白）本版不支持。命令 id 的合法性由前端键位层判定（见模块头）。
    pub keys: HashMap<String, Option<String>>,
    /// 运行时诊断日志（add-diagnostics-logging）：事件落盘等级。
    pub log: LogConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION,
            last_vault: None,
            editor: EditorConfig::default(),
            keys: HashMap::new(),
            log: LogConfig::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct EditorConfig {
    /// 编辑器模式（ADR 0002 §2 单内核双模式）。
    pub mode: EditorMode,
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            mode: EditorMode::Md,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum EditorMode {
    Md,
    Code,
}

/// 诊断日志配置（`[log]` 表）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct LogConfig {
    pub level: LogLevel,
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            level: LogLevel::Info,
        }
    }
}

/// 日志等级：`info` = 记录 v0 事件集全部事件；`off` = 事件丢弃不写盘。
/// 两档来自裁决点 1（默认 info：dogfood 期需要数据）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum LogLevel {
    Info,
    Off,
}

/// 一次配置加载的结果：生效配置 + 人话 warning 列表 + 实际读取路径。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ConfigSnapshot {
    pub config: AppConfig,
    /// 逐字段回退时产生的人话提示；为空表示完全干净。
    pub warnings: Vec<String>,
    pub path: String,
}

/// 宽容解析的中间结构：字段类型放宽到可选 / Value，使单字段非法不至于拖垮整文件。
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawConfig {
    version: Option<u32>,
    last_vault: Option<serde_json::Value>,
    editor: RawEditorConfig,
    /// [keys] 表整体收成 Value：形状（对象？键位合法？值类型？）逐项判定，非法项只丢
    /// 自己并附 warning，不影响其余键位（与 editor.mode 的逐字段口径一致）。
    keys: serde_json::Value,
    /// [log] 表同理收成 Value：错形状（如 `"log": "info"`）只丢这一项，不拖垮整文件。
    log: serde_json::Value,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawEditorConfig {
    mode: Option<String>,
}

/// 配置目录（ADR 0002 §5 路径规则）。无法确定 home 是唯一的致命错误。
pub fn config_dir() -> Result<PathBuf, CommandError> {
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(not(target_os = "windows"))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")));
    base.map(|b| b.join("lumir")).ok_or_else(|| {
        CommandError::new(
            "config_home_unknown",
            "无法确定配置目录：XDG_CONFIG_HOME 与 HOME 环境变量均未设置",
        )
    })
}

/// 加载配置（默认路径）。供 command 与 CLI 共用。
pub fn load() -> Result<ConfigSnapshot, CommandError> {
    let path = config_dir()?.join("config.json");
    Ok(load_from(&path))
}

/// 从指定路径加载。文件不存在不算错误（首次启动常态），返回默认配置。
pub fn load_from(path: &Path) -> ConfigSnapshot {
    let path_str = path.display().to_string();
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return ConfigSnapshot {
                config: AppConfig::default(),
                warnings: vec![],
                path: path_str,
            };
        }
        Err(e) => {
            return ConfigSnapshot {
                config: AppConfig::default(),
                warnings: vec![format!("无法读取配置文件 {path_str}：{e}，已使用默认配置")],
                path: path_str,
            };
        }
    };

    match serde_json::from_str::<RawConfig>(&text) {
        Ok(raw) => {
            let (config, warnings) = validate(raw);
            ConfigSnapshot {
                config,
                warnings,
                path: path_str,
            }
        }
        Err(e) => ConfigSnapshot {
            config: AppConfig::default(),
            warnings: vec![format!(
                "配置文件 {path_str} 不是合法 JSON（第 {} 行）：{}，已整体使用默认配置",
                e.line(),
                e
            )],
            path: path_str,
        },
    }
}

/// 逐字段校验：非法值落回该字段默认值并附人话 warning。
fn validate(raw: RawConfig) -> (AppConfig, Vec<String>) {
    let defaults = AppConfig::default();
    let mut warnings = Vec::new();

    let version = match raw.version {
        None => defaults.version,
        Some(v) if v > SCHEMA_VERSION => {
            warnings.push(format!(
                "配置文件版本 v{v} 高于本应用支持的 v{SCHEMA_VERSION}，已按 v{SCHEMA_VERSION} 解释；请升级应用"
            ));
            SCHEMA_VERSION
        }
        Some(v) => v,
    };

    let last_vault = match raw.last_vault {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(s)) => Some(s),
        Some(_) => {
            warnings.push("配置项 last_vault 应为字符串或 null，已忽略该值".to_string());
            defaults.last_vault
        }
    };

    let mode = match raw.editor.mode.as_deref() {
        None => defaults.editor.mode,
        Some("md") => EditorMode::Md,
        Some("code") => EditorMode::Code,
        Some(other) => {
            warnings.push(format!(
                "配置项 editor.mode 取值 \"{other}\" 非法（可选：md、code），已回退为 md"
            ));
            defaults.editor.mode
        }
    };

    let (keys, mut key_warnings) = validate_keys(raw.keys);
    warnings.append(&mut key_warnings);

    let (log, mut log_warnings) = validate_log(raw.log);
    warnings.append(&mut log_warnings);

    (
        AppConfig {
            version,
            last_vault,
            editor: EditorConfig { mode },
            keys,
            log,
        },
        warnings,
    )
}

/// [keys] 表的形状校验（M132）：逐项判定，非法项丢弃并附人话 warning，其余项照常生效。
/// 只判形状——键位非空且不含空白（含空白即多段 chord，本版不支持）、值是非空字符串或
/// null；命令 id 是否已知由前端键位层判定（模块头有理由）。
fn validate_keys(raw: serde_json::Value) -> (HashMap<String, Option<String>>, Vec<String>) {
    let mut keys = HashMap::new();
    let mut warnings = Vec::new();
    let map = match raw {
        serde_json::Value::Null => return (keys, warnings),
        serde_json::Value::Object(map) => map,
        _ => {
            warnings
                .push("配置项 keys 应为对象（键位 → 命令 id，或 null 解绑），已忽略".to_string());
            return (keys, warnings);
        }
    };
    for (key, value) in map {
        if key.trim().is_empty() || key.chars().any(char::is_whitespace) {
            warnings.push(format!(
                "配置项 keys 的键位 \"{key}\" 非法（空或含空白；多段 chord 暂不支持），已忽略"
            ));
            continue;
        }
        match value {
            serde_json::Value::Null => {
                keys.insert(key, None);
            }
            serde_json::Value::String(command) if !command.trim().is_empty() => {
                keys.insert(key, Some(command));
            }
            serde_json::Value::String(_) => warnings.push(format!(
                "配置项 keys.{key} 的命令为空，已忽略（解绑请写 null）"
            )),
            _ => warnings.push(format!(
                "配置项 keys.{key} 的值应为命令 id 字符串或 null（解绑），已忽略"
            )),
        }
    }
    (keys, warnings)
}

/// [log] 表的形状校验（add-diagnostics-logging）：与 keys 表同口径——整表非法只丢这一项
/// 并附人话 warning，`level` 取值非法只回退该字段到默认 `info`（ADR 0002 §5：非法配置不
/// 导致启动失败）。未知键忽略（向前兼容）。
fn validate_log(raw: serde_json::Value) -> (LogConfig, Vec<String>) {
    let defaults = LogConfig::default();
    let mut warnings = Vec::new();
    let map = match raw {
        serde_json::Value::Null => return (defaults, warnings),
        serde_json::Value::Object(map) => map,
        _ => {
            warnings.push(
                "配置项 log 应为对象（如 {\"log\": {\"level\": \"info\"}}），已忽略".to_string(),
            );
            return (defaults, warnings);
        }
    };
    let level = match map.get("level") {
        None | Some(serde_json::Value::Null) => defaults.level,
        Some(serde_json::Value::String(text)) => match text.as_str() {
            "info" => LogLevel::Info,
            "off" => LogLevel::Off,
            other => {
                warnings.push(format!(
                    "配置项 log.level 取值 \"{other}\" 非法（可选：info、off），已回退为 info"
                ));
                defaults.level
            }
        },
        Some(_) => {
            warnings.push("配置项 log.level 应为字符串（info / off），已回退为 info".to_string());
            defaults.level
        }
    };
    (LogConfig { level }, warnings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// 无 tempfile 依赖（低依赖取向）：用 pid + 序号在 $TMPDIR 造唯一路径，用完即删。
    struct TempFile(PathBuf);
    static SEQ: AtomicU32 = AtomicU32::new(0);

    impl TempFile {
        fn new(content: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "lumir-config-test-{}-{}.json",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::write(&path, content).expect("write temp config");
            Self(path)
        }
        fn missing() -> Self {
            Self(std::env::temp_dir().join(format!(
                "lumir-config-test-missing-{}-{}.json",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::Relaxed)
            )))
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    #[test]
    fn missing_file_yields_defaults_without_warning() {
        let f = TempFile::missing();
        let snap = load_from(&f.0);
        assert_eq!(snap.config, AppConfig::default());
        assert!(snap.warnings.is_empty());
    }

    #[test]
    fn valid_file_is_loaded() {
        let f = TempFile::new(
            r#"{"version":1,"last_vault":"/tmp/vault","editor":{"mode":"code"},"future_field":true}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(snap.config.last_vault.as_deref(), Some("/tmp/vault"));
        assert_eq!(snap.config.editor.mode, EditorMode::Code);
        assert!(snap.warnings.is_empty(), "未知字段应被静默忽略");
    }

    #[test]
    fn invalid_json_falls_back_entirely_with_warning() {
        let f = TempFile::new("{not json");
        let snap = load_from(&f.0);
        assert_eq!(snap.config, AppConfig::default());
        assert_eq!(snap.warnings.len(), 1);
        assert!(snap.warnings[0].contains("不是合法 JSON"));
    }

    #[test]
    fn invalid_field_falls_back_per_field() {
        // editor.mode 非法只回退该字段，last_vault 等合法字段不受影响。
        let f = TempFile::new(r#"{"last_vault":"/tmp/vault","editor":{"mode":"weird"}}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.editor.mode, EditorMode::Md);
        assert_eq!(snap.config.last_vault.as_deref(), Some("/tmp/vault"));
        assert_eq!(snap.warnings.len(), 1);
        assert!(snap.warnings[0].contains("editor.mode"));
    }

    #[test]
    fn wrong_type_field_falls_back_with_warning() {
        let f = TempFile::new(r#"{"last_vault":42}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.last_vault, None);
        assert_eq!(snap.warnings.len(), 1);
    }

    #[test]
    fn newer_version_warns() {
        let f = TempFile::new(r#"{"version":99}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.version, SCHEMA_VERSION);
        assert!(snap.warnings[0].contains("v99"));
    }

    #[test]
    fn missing_keys_field_yields_empty_overrides() {
        // 老配置文件（M132 之前写入）没有 keys 字段：空表、无 warning（向前兼容）。
        let f = TempFile::new(r#"{"version":1,"editor":{"mode":"md"}}"#);
        let snap = load_from(&f.0);
        assert!(snap.config.keys.is_empty());
        assert!(snap.warnings.is_empty());
    }

    #[test]
    fn keys_table_supports_rebind_and_unbind() {
        let f = TempFile::new(
            r#"{"keys":{"Ctrl-s":"document.save","Cmd-s":null,"Ctrl-Alt-Minus":"editor.redo"}}"#,
        );
        let snap = load_from(&f.0);
        assert!(
            snap.warnings.is_empty(),
            "合法 keys 表不应产生 warning：{:?}",
            snap.warnings
        );
        assert_eq!(
            snap.config.keys.get("Ctrl-s").and_then(|v| v.as_deref()),
            Some("document.save")
        );
        assert_eq!(snap.config.keys.get("Cmd-s"), Some(&None), "null = 解绑");
        assert_eq!(
            snap.config
                .keys
                .get("Ctrl-Alt-Minus")
                .and_then(|v| v.as_deref()),
            Some("editor.redo")
        );
    }

    #[test]
    fn keys_not_an_object_falls_back_with_warning() {
        let f = TempFile::new(r#"{"keys":["Cmd-s"]}"#);
        let snap = load_from(&f.0);
        assert!(snap.config.keys.is_empty());
        assert_eq!(snap.warnings.len(), 1);
        assert!(snap.warnings[0].contains("keys"));
        // 其余字段不受影响（逐字段口径）
        assert_eq!(snap.config.editor.mode, EditorMode::Md);
    }

    #[test]
    fn keys_invalid_entries_are_dropped_per_item() {
        // 键位含空白（多段 chord）/ 值类型非法 / 命令为空：逐项丢弃并各自 warning，
        // 合法项与解绑项照常生效。
        let f = TempFile::new(
            r#"{"keys":{"Cmd-s":"document.save","Ctrl-x u":"editor.undo","Ctrl-j":42,"Ctrl-k":"","Ctrl-y":null}}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(
            snap.config.keys.len(),
            2,
            "合法项应保留：{:?}",
            snap.config.keys
        );
        assert_eq!(
            snap.config.keys.get("Cmd-s").and_then(|v| v.as_deref()),
            Some("document.save")
        );
        assert_eq!(snap.config.keys.get("Ctrl-y"), Some(&None));
        assert_eq!(snap.warnings.len(), 3, "{:?}", snap.warnings);
        for needle in ["Ctrl-x u", "Ctrl-j", "Ctrl-k"] {
            assert!(
                snap.warnings.iter().any(|w| w.contains(needle)),
                "缺少 {needle} 的 warning：{:?}",
                snap.warnings
            );
        }
    }

    #[test]
    fn keys_unknown_command_is_passed_through_for_frontend_validation() {
        // 命令 id 是否已知不在 Rust 侧判定（命令清单的唯一来源是前端键位层）：形状合法
        // 即透传，前端在装配期给 warning 并忽略该条。
        let f = TempFile::new(r#"{"keys":{"Ctrl-j":"editor.not-a-command"}}"#);
        let snap = load_from(&f.0);
        assert!(snap.warnings.is_empty());
        assert_eq!(
            snap.config.keys.get("Ctrl-j").and_then(|v| v.as_deref()),
            Some("editor.not-a-command")
        );
    }

    #[test]
    fn missing_log_table_defaults_to_info() {
        // 老配置文件（本 change 之前写入）没有 log 字段：默认 info、无 warning。
        let f = TempFile::new(r#"{"version":1}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.log.level, LogLevel::Info);
        assert!(snap.warnings.is_empty());
    }

    #[test]
    fn log_level_accepts_info_and_off() {
        let off = load_from(&TempFile::new(r#"{"log":{"level":"off"}}"#).0);
        assert_eq!(off.config.log.level, LogLevel::Off);
        assert!(off.warnings.is_empty(), "{:?}", off.warnings);

        let info = load_from(&TempFile::new(r#"{"log":{"level":"info"}}"#).0);
        assert_eq!(info.config.log.level, LogLevel::Info);
        assert!(info.warnings.is_empty());
    }

    #[test]
    fn illegal_log_level_warns_and_falls_back_to_info() {
        // ADR 0002 §5：非法值走既有 warning 语义，不得导致启动失败。
        let f = TempFile::new(r#"{"log":{"level":"verbose"},"last_vault":"/tmp/vault"}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.log.level, LogLevel::Info);
        assert_eq!(snap.config.last_vault.as_deref(), Some("/tmp/vault"));
        assert_eq!(snap.warnings.len(), 1);
        assert!(
            snap.warnings[0].contains("log.level"),
            "{:?}",
            snap.warnings
        );
    }

    #[test]
    fn malformed_log_table_is_dropped_without_killing_the_file() {
        // 错形状（字符串而非对象）只丢这一项；level 类型错同样只回退该字段。
        let f = TempFile::new(r#"{"log":"info","editor":{"mode":"code"}}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.log.level, LogLevel::Info);
        assert_eq!(snap.config.editor.mode, EditorMode::Code);
        assert_eq!(snap.warnings.len(), 1);
        assert!(snap.warnings[0].contains("log"));

        let f = TempFile::new(r#"{"log":{"level":2}}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.log.level, LogLevel::Info);
        assert_eq!(snap.warnings.len(), 1);
        assert!(snap.warnings[0].contains("log.level"));
    }
}
