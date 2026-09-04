//! 配置加载 —— M1 基础（ADR 0002 §5，架构复查 P2-6）。
//!
//! - 路径：macOS/Linux 遵循 `$XDG_CONFIG_HOME`（默认 `~/.config/lumir`），
//!   Windows 用 `%APPDATA%\lumir`，不采用 `~/Library/Application Support`
//!   （ADR 0002 §5 已定：配置需人可读可改，遵循 dotfile 生态惯例）。
//! - 校验：逐字段校验，非法值落回该字段默认值并附人话 warning；
//!   整文件不是合法 JSON 时才整体落回默认配置。
//! - 未知字段忽略（向前兼容：新版写入的字段旧版读取不报错）。
//!
//! ## 格式选型：JSON 而非 TOML
//!
//! 选 JSON：serde_json 已是依赖（零新增，契合本仓低依赖取向）；报错带行列号，
//! 便于生成人话错误；前后端同格式免转换。代价：不支持注释、手写编辑体验逊于
//! TOML。若 dogfood 阶段手改配置成为高频动作，重评 TOML（届时只需换本模块的
//! 解析两行，对外契约不变）。

use serde::{Deserialize, Serialize};
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
    /// 上次打开的 vault 路径（mid-M1 "记住上次 vault" 消费；本波只定义不消费）。
    pub last_vault: Option<String>,
    pub editor: EditorConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION,
            last_vault: None,
            editor: EditorConfig::default(),
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

    (
        AppConfig {
            version,
            last_vault,
            editor: EditorConfig { mode },
        },
        warnings,
    )
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
}
