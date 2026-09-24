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
//!
//! ## ui 表（restyle-ui-tokens-v1）
//!
//! `{"ui": {"theme": "light" | "dark" | "eink"}}`，默认 `light`。取值校验照 `editor.mode`
//! 模板：表内 `theme` 缺失 → 默认；取值不在表内 → warning + 回落默认（ADR 0002 §5：非法
//! 配置不导致启动失败）。它与 `editor` 一样是**结构化表**（`RawUiConfig`），不是 keys / log
//! 那种「整表收成 Value」——因此 `{"ui": "dark"}` 这种表的错形状与表内 `"theme": 2` 同路，
//! 都走**整文件回落**（同族说明见下节）。`theme` 的消费方是前端启动施加处
//! （`documentElement.dataset.theme`，与 `editor.mode` 同口径：装载时读一次、重启生效）；
//! Rust 侧只负责读出来并挡住非法值，本版不做运行期切换、不跟随系统。
//!
//! ## 数值字段的打字代价（typography-and-zoom）
//!
//! `editor.font_size` 是本仓**第一个数值配置字段**，错打成字符串的代价比布尔高（多一对
//! 引号、小数、`1e1` 都容易误写）：`"font_size": "15"` 会在 serde 解析期失败，走
//! **整文件回落**——全部字段回默认（含 `last_vault: None`，下次启动要重新打开 vault）+ 一条
//! warning。这是既有解析模型的性质（`mode` / `line_wrap` 给错类型同路），本 change 如实登记
//! 并用单测钉住，**不发明「逐字段类型容忍」**：那会让 `font_size` 与 `editor.mode` 形成
//! 「同类不同治」，正是 change line-wrap-options 明确拒绝过的事。替代形态（收成
//! `serde_json::Value` 后逐项判定，即 `[keys]` / `[log]` 那条路）如需采纳，改动面是
//! `RawEditorConfig` 的一处类型 + 一条单测。

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
    /// 界面主题（restyle-ui-tokens-v1）：`[ui]` 表，启动装载时施加一次。
    pub ui: UiConfig,
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
            ui: UiConfig::default(),
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
    /// 文件级折行（change line-wrap-options）：`true`（默认）时正文行在阅读栏内折行，
    /// `false` 时长行不折、由编辑区（`.cm-scroller`）横向平移呈现。只管正文行——围栏 /
    /// 缩进代码块行由 `code_block_wrap` 裁决（「一元素一条规则」）。TS 侧出厂默认同值，
    /// 见 `src/editor.ts` 的 `DEFAULT_LINE_WRAP`（两处写值各有单测钉住）。
    pub line_wrap: bool,
    /// 代码块折行：`false`（默认）时 md live preview 里的围栏 / 缩进代码块不折行、由块级
    /// 横滚容器承载；`true` 时在阅读栏内折行（M138 以来的现状）。作用面只有 md 模式——
    /// 非 md 文件没有围栏渲染，对它们无可观测效果（不是漏实现）。
    pub code_block_wrap: bool,
    /// 正文（比例）字体族（change typography-and-zoom）：CSS `font-family` 值，`None` =
    /// 沿用基线观感（`src/style.css` 的 `--font-body`）。只在启动装载时读一次——本能力不做
    /// 热重载，改字体需重启（字号另有运行期步进命令，不落盘）。
    ///
    /// 这里**只挡空串 / 纯空白**（→ `None` + warning）：值是否合法的 CSS 字族由前端判定
    ///（`CSS.supports`），Rust 侧不复制一份 CSS 语法知识——与 `keys` 表「形状在此、语义在
    /// 前端」的既有分层同口径（见模块头）。
    pub font_family: Option<String>,
    /// 等宽字体族：口径同 `font_family`，缺省引用基线的 `--font-mono`。它同时是**列表标记
    /// 宽度测量**与标记渲染共用的那个 token（`src/preview/lists.ts`），两处必须同源。
    pub mono_font_family: Option<String>,
    /// 编辑器内容字号（px）：默认 15，合法区间 `[12, 32]`，区间外回落 15 + warning。
    /// 它是编辑器内容面（md 正文 / 代码块 / code 模式）的字号；shell 的 13px 与阅读栏宽
    /// 都不随之变（作用面由 token 分层结构性保证，见 change 的 design §2.2）。
    ///
    /// **这是本仓第一个数值配置字段**：写成字符串（`"font_size": "15"`）会在 serde 解析期
    /// 失败 → 走**整文件回落**（全部字段回默认 + 一条 warning，连 `last_vault` 一起丢）。
    /// 代价与「为什么不发明逐字段类型容忍」见模块头。
    pub font_size: f64,
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            mode: EditorMode::Md,
            line_wrap: true,
            code_block_wrap: false,
            font_family: None,
            mono_font_family: None,
            font_size: DEFAULT_FONT_SIZE,
        }
    }
}

/// 编辑器内容字号的出厂默认（px）：15（restyle-ui-tokens-v1 裁决 D1——Lumir 的编辑器就是
/// 阅读表面，定稿图的密度、行高与间距全按 15px 调）。
///
/// 三处同语义写值：本常量（配置面的真源）、`src/typography.ts` 的 `DEFAULT_FONT_SIZE`、
/// `src/style.css` 的 `--editor-font-size` 默认值。三者必须同值，各有断言钉住（两侧单测 +
/// 默认口径的计算属性断言），改一处必须同步其余两处（REVIEW.md 第 8 条）。
///
/// **M210 只改 Rust 这一处**：TS 常量与 CSS 默认值的 16→15 随 R2a（M211）落地（同一 tasks
/// §3.4 拆成两半）。R2a 之前配置值到达前 style.css 仍是 16px；配置一到即按本常量覆盖。两半
/// 合拢后三处重新同值。
pub const DEFAULT_FONT_SIZE: f64 = 15.0;

/// 字号合法区间（含端点）：与前端步进命令的钳制区间同值（`src/typography.ts` 的
/// `FONT_SIZE_MIN` / `FONT_SIZE_MAX`）。区间外一律回落默认值 + warning。
pub const FONT_SIZE_MIN: f64 = 12.0;
pub const FONT_SIZE_MAX: f64 = 32.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum EditorMode {
    Md,
    Code,
}

/// 界面配置（`[ui]` 表，restyle-ui-tokens-v1）。与 `EditorConfig` 同为结构化表：
/// 逐字段取值校验，缺字段回落默认、取值非法回落默认 + warning。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct UiConfig {
    /// 界面主题，默认 `light`。启动装载时读一次并施加到 `documentElement.dataset.theme`
    /// ——与 `editor.mode` 同口径（重启生效）。本版不做运行期切换、不跟随系统主题。
    pub theme: UiTheme,
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            theme: UiTheme::Light,
        }
    }
}

/// 界面主题三档（restyle-ui-tokens-v1）：同一套 token 名经 `data-theme` 属性切换取值。
/// `light` = 默认浅色；`dark` = 深色；`eink` = 电子纸降级档（色彩退场，靠字重与线宽承担
/// 对比，见 tokens 文档 §eink 规则）。写值是**闭集合**：取值校验在 Rust 侧完成，前端拿到的
/// 一定是三档之一，不再判非法（与 `editor.mode` / `log.level` 同一形态）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum UiTheme {
    Light,
    Dark,
    Eink,
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
    /// `[ui]` 表（restyle-ui-tokens-v1）走结构化镜像，与 `editor` 同路：表内字段类型不符
    /// （`"theme": 2`）或整个表错形状（`"ui": "dark"`）都在解析期失败 → 整文件回落。
    ui: RawUiConfig,
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
    /// 折行两项（change line-wrap-options）：字段缺失 → `None` → `validate()` 回落到
    /// `EditorConfig::default`。**类型不符（如 `"line_wrap": "yes"`）不走逐字段回落**：
    /// `Option<bool>` 在 serde 解析期即失败，整份 `RawConfig` 落回默认（全部默认 + 一条
    /// warning），与 `mode` 给错类型时同路。这是既有解析模型的性质，本 change 如实记录并用
    /// 单测钉住，不发明「逐字段类型容忍」——那会与 `editor.mode` 形成同类不同治。
    line_wrap: Option<bool>,
    code_block_wrap: Option<bool>,
    /// 排版三项（change typography-and-zoom）。前两项与 `mode` 同路：`Option<String>` 遇到
    /// 类型不符（`"font_family": 16`）在解析期失败 → 整文件回落。
    font_family: Option<String>,
    mono_font_family: Option<String>,
    /// **本仓第一个数值字段**：`"font_size": "15"`（带引号）同样在解析期失败 → 整文件回落，
    /// 连 `last_vault` 一起丢（代价与替代形态见模块头「数值字段的打字代价」）。
    font_size: Option<f64>,
}

/// `[ui]` 表的解析镜像（restyle-ui-tokens-v1）。缺字段 → `None` → `validate()` 回落到
/// `UiConfig::default`（`light`），不产生 warning；取值非法到不了这里（在 `validate()` 里
/// 回落 + warning）。类型不符（`"theme": 2`）在 serde 解析期即失败 → 整文件回落——与
/// `editor.mode` 给错类型同路，不发明逐字段类型容忍（理由同 `RawEditorConfig` 的注释）。
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawUiConfig {
    theme: Option<String>,
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

    let mut mode = EditorMode::Md;
    let mut line_wrap = defaults.editor.line_wrap;
    let mut code_block_wrap = defaults.editor.code_block_wrap;
    if let Some(raw_mode) = raw.editor.mode.as_deref() {
        match raw_mode {
            "md" => mode = EditorMode::Md,
            "code" => mode = EditorMode::Code,
            other => warnings.push(format!(
                "配置项 editor.mode 取值 \"{other}\" 非法（可选：md、code），已回退为 md"
            )),
        }
    }
    // 折行两项（line-wrap-options）：bool 只有两种取值，缺字段即回落到 Default，不产生
    // warning。**类型不符到不了这里**——`Option<bool>` 在 serde 解析期就失败，整份配置
    // 走整文件回落（见模块头与 `RawEditorConfig` 的注释）；单测
    // `wrong_type_line_wrap_falls_back_entire_file` 钉住这条边界。
    if let Some(value) = raw.editor.line_wrap {
        line_wrap = value;
    }
    if let Some(value) = raw.editor.code_block_wrap {
        code_block_wrap = value;
    }
    // 排版三项（typography-and-zoom）：两项字体族**只挡空串 / 纯空白**（→ None = 沿用基线 +
    // warning），值的 CSS 合法性由前端 `CSS.supports` 判定（形状在此、语义在前端的既有分层）；
    // 字号按区间 [12, 32] 判定，越界回落默认 + warning（照 editor.mode 的模板）。
    let font_family = match raw.editor.font_family.as_deref().map(str::trim) {
        None => None,
        Some("") => {
            warnings
                .push("配置项 editor.font_family 为空（或纯空白），已回退为基线字体".to_string());
            None
        }
        Some(value) => Some(value.to_string()),
    };
    let mono_font_family = match raw.editor.mono_font_family.as_deref().map(str::trim) {
        None => None,
        Some("") => {
            warnings.push(
                "配置项 editor.mono_font_family 为空（或纯空白），已回退为基线等宽字体".to_string(),
            );
            None
        }
        Some(value) => Some(value.to_string()),
    };
    let mut font_size = defaults.editor.font_size;
    if let Some(value) = raw.editor.font_size {
        // 区间判定同时挡 NaN（`contains` 对 NaN 为 false）。类型不符（`"font_size": "15"`）
        // 到不了这里——它在 serde 解析期就已经让整份配置回落，单测钉住那条边界。
        if (FONT_SIZE_MIN..=FONT_SIZE_MAX).contains(&value) {
            font_size = value;
        } else {
            warnings.push(format!(
                "配置项 editor.font_size 取值 {value} 超出合法区间 [{FONT_SIZE_MIN}, {FONT_SIZE_MAX}]，已回退为 {DEFAULT_FONT_SIZE}"
            ));
        }
    }

    // [ui] 表（restyle-ui-tokens-v1）：取值校验照 editor.mode 模板——缺字段回落默认（不告警），
    // 取值不在三档内回落默认 + 人话 warning。类型不符到不了这里（解析期整文件回落，见
    // `RawUiConfig` 的注释）；单测 `wrong_type_ui_theme_falls_back_entire_file` 钉住那条边界。
    let mut theme = defaults.ui.theme;
    if let Some(raw_theme) = raw.ui.theme.as_deref() {
        match raw_theme {
            "light" => theme = UiTheme::Light,
            "dark" => theme = UiTheme::Dark,
            "eink" => theme = UiTheme::Eink,
            other => warnings.push(format!(
                "配置项 ui.theme 取值 \"{other}\" 非法（可选：light、dark、eink），已回退为 light"
            )),
        }
    }

    let (keys, mut key_warnings) = validate_keys(raw.keys);
    warnings.append(&mut key_warnings);

    let (log, mut log_warnings) = validate_log(raw.log);
    warnings.append(&mut log_warnings);

    (
        AppConfig {
            version,
            last_vault,
            editor: EditorConfig {
                mode,
                line_wrap,
                code_block_wrap,
                font_family,
                mono_font_family,
                font_size,
            },
            ui: UiConfig { theme },
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

    #[test]
    fn missing_editor_wrap_fields_take_defaults() {
        // 老配置文件（change line-wrap-options 之前写入）没有这两项：line_wrap = true、
        // code_block_wrap = false、不产生 warning（比照 missing_log_table_defaults_to_info）。
        let f = TempFile::new(r#"{"version":1,"editor":{"mode":"md"}}"#);
        let snap = load_from(&f.0);
        assert!(snap.config.editor.line_wrap);
        assert!(!snap.config.editor.code_block_wrap);
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    #[test]
    fn explicit_editor_wrap_fields_are_loaded() {
        let f = TempFile::new(r#"{"editor":{"line_wrap":false,"code_block_wrap":true}}"#);
        let snap = load_from(&f.0);
        assert!(!snap.config.editor.line_wrap);
        assert!(snap.config.editor.code_block_wrap);
        assert_eq!(
            snap.config.editor.mode,
            EditorMode::Md,
            "缺 mode 时仍回落默认"
        );
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    #[test]
    fn wrong_type_line_wrap_falls_back_entire_file() {
        // 边界如实记录（design §2.1、§4-4）：`Option<bool>` 遇到类型不符会在 serde 解析期失败，
        // 走的是**整文件回落**（全部默认 + 一条 warning），与 editor.mode 给错类型时同路。
        // MUST NOT 出现「一部分字段按配置、一部分按默认」的混合态——同一份文件里的合法字段
        //（这里是最新的一处 last_vault）也一并落回默认。
        let f = TempFile::new(
            r#"{"last_vault":"/tmp/vault","editor":{"line_wrap":"yes","code_block_wrap":true}}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(snap.config, AppConfig::default(), "整份配置应落回默认");
        assert!(snap.config.editor.line_wrap, "line_wrap 回到默认 true");
        assert!(
            !snap.config.editor.code_block_wrap,
            "同一份配置里的 code_block_wrap 也一并落回默认 false（无混合态）"
        );
        assert_eq!(snap.config.editor.mode, EditorMode::Md);
        assert_eq!(
            snap.config.last_vault, None,
            "同一份文件里的合法字段同样落回默认"
        );
        assert_eq!(snap.warnings.len(), 1, "{:?}", snap.warnings);
        assert!(snap.warnings[0].contains("不是合法 JSON"));
    }

    #[test]
    fn missing_editor_typography_fields_take_defaults() {
        // 老配置文件（typography-and-zoom 之前写入）没有这三项：两项字体族 = None（沿用基线）、
        // font_size = 15（出厂默认）、不产生 warning（比照 missing_editor_wrap_fields_take_defaults）。
        let f = TempFile::new(r#"{"version":1,"editor":{"mode":"md"}}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.editor.font_family, None);
        assert_eq!(snap.config.editor.mono_font_family, None);
        assert_eq!(snap.config.editor.font_size, DEFAULT_FONT_SIZE);
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    #[test]
    fn explicit_editor_typography_fields_are_loaded() {
        // 合法值：字体族原样透传给前端（含逗号与引号的字体栈写法；两侧空白被 trim），
        // 字号取区间内的值。无 warning。
        let f = TempFile::new(
            r#"{"editor":{"font_family":"  \"LXGW WenKai\", -apple-system, sans-serif  ","mono_font_family":"\"JetBrains Mono\", ui-monospace, monospace","font_size":20}}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(
            snap.config.editor.font_family.as_deref(),
            Some("\"LXGW WenKai\", -apple-system, sans-serif")
        );
        assert_eq!(
            snap.config.editor.mono_font_family.as_deref(),
            Some("\"JetBrains Mono\", ui-monospace, monospace")
        );
        assert_eq!(snap.config.editor.font_size, 20.0);
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    #[test]
    fn font_size_interval_endpoints_are_accepted() {
        // 区间闭区间（[12, 32]）：端点必须生效，不做「端点外」的误判。
        for value in [FONT_SIZE_MIN, 16.0, FONT_SIZE_MAX] {
            let f = TempFile::new(&format!(r#"{{"editor":{{"font_size":{value}}}}}"#));
            let snap = load_from(&f.0);
            assert_eq!(snap.config.editor.font_size, value);
            assert!(snap.warnings.is_empty(), "{value}: {:?}", snap.warnings);
        }
    }

    #[test]
    fn empty_font_family_falls_back_to_baseline_with_warning() {
        // 空串 / 纯空白 = 「沿用基线」这条正常状态之外的**笔误**：回落 None + warning；
        // 同一份配置里的合法字段（font_size）照常生效（逐字段口径）。
        for raw in ["", "   "] {
            let f = TempFile::new(&format!(
                r#"{{"editor":{{"font_family":"{raw}","mono_font_family":"  \n ","font_size":20}}}}"#
            ));
            let snap = load_from(&f.0);
            assert_eq!(snap.config.editor.font_family, None);
            assert_eq!(snap.config.editor.mono_font_family, None);
            assert_eq!(snap.config.editor.font_size, 20.0, "合法字段不受影响");
            assert_eq!(snap.warnings.len(), 2, "{raw:?}: {:?}", snap.warnings);
            assert!(snap.warnings[0].contains("font_family"));
            assert!(snap.warnings[1].contains("mono_font_family"));
        }
    }

    #[test]
    fn font_size_out_of_range_falls_back_per_field() {
        // 越界只回落该字段（其余字段按配置生效），warning 恰一条且带区间读数。
        for value in [8.0, 64.0, -1.0] {
            let f = TempFile::new(&format!(
                r#"{{"editor":{{"font_size":{value},"line_wrap":false,"font_family":"Inter"}}}}"#
            ));
            let snap = load_from(&f.0);
            assert_eq!(
                snap.config.editor.font_size, DEFAULT_FONT_SIZE,
                "{value} 应回落默认"
            );
            assert!(!snap.config.editor.line_wrap, "其余字段按配置生效");
            assert_eq!(snap.config.editor.font_family.as_deref(), Some("Inter"));
            assert_eq!(snap.warnings.len(), 1, "{value}: {:?}", snap.warnings);
            assert!(snap.warnings[0].contains("font_size"));
            assert!(snap.warnings[0].contains("12"));
            assert!(snap.warnings[0].contains("32"));
        }
    }

    #[test]
    fn wrong_type_font_size_falls_back_entire_file() {
        // 边界如实记录（design §2.1、§4-4，tasks 2.3 ①）：`font_size` 是本仓第一个数值字段，
        // 错打成字符串会在 serde 解析期失败 → **整文件回落**（全部字段回默认，连 last_vault
        // 一起丢），warning 恰一条。MUST NOT 出现「一部分字段按配置、一部分按默认」的混合态。
        let f = TempFile::new(
            r#"{"last_vault":"/tmp/vault","editor":{"font_size":"15","font_family":"Inter","mode":"code","line_wrap":false}}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(snap.config, AppConfig::default(), "整份配置应落回默认");
        assert_eq!(snap.config.editor.font_size, DEFAULT_FONT_SIZE);
        assert_eq!(snap.config.editor.font_family, None);
        assert_eq!(snap.config.editor.mode, EditorMode::Md);
        assert!(snap.config.editor.line_wrap);
        assert_eq!(snap.config.last_vault, None, "合法字段同样落回默认");
        assert_eq!(snap.warnings.len(), 1, "{:?}", snap.warnings);
        assert!(snap.warnings[0].contains("不是合法 JSON"));
    }

    #[test]
    fn wrong_type_font_family_falls_back_entire_file() {
        // 同一族的边界：`"font_family": 16`（值写成数字）也走整文件回落——`Option<String>`
        // 与 `Option<f64>` 的解析失败路径一致（同类同路，不搞逐个字段的特殊处理）。
        let f = TempFile::new(r#"{"editor":{"font_family":16,"font_size":20}}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config, AppConfig::default());
        assert_eq!(snap.config.editor.font_size, DEFAULT_FONT_SIZE);
        assert_eq!(snap.warnings.len(), 1, "{:?}", snap.warnings);
        assert!(snap.warnings[0].contains("不是合法 JSON"));
    }

    #[test]
    fn missing_ui_table_defaults_to_light() {
        // 老配置文件（restyle-ui-tokens-v1 之前写入）没有 ui 字段：默认 light、无 warning
        // （比照 missing_log_table_defaults_to_info）。
        let f = TempFile::new(r#"{"version":1,"editor":{"mode":"md"}}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.ui.theme, UiTheme::Light);
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    #[test]
    fn ui_theme_accepts_dark_and_eink() {
        // 三档闭集合逐个过一遍；显式写 light 与缺省同值，且都不产生 warning。
        for (raw, want) in [
            ("light", UiTheme::Light),
            ("dark", UiTheme::Dark),
            ("eink", UiTheme::Eink),
        ] {
            let f = TempFile::new(&format!(r#"{{"ui":{{"theme":"{raw}"}}}}"#));
            let snap = load_from(&f.0);
            assert_eq!(snap.config.ui.theme, want, "{raw}");
            assert!(snap.warnings.is_empty(), "{raw}: {:?}", snap.warnings);
        }
    }

    #[test]
    fn illegal_ui_theme_warns_and_falls_back_to_light() {
        // ADR 0002 §5：非法值走既有 warning 语义（恰一条）、不得导致启动失败；同一份配置里的
        // 合法字段照常生效（逐字段口径，比照 illegal_log_level_warns_and_falls_back_to_info）。
        let f = TempFile::new(r#"{"ui":{"theme":"solarized"},"last_vault":"/tmp/vault"}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.ui.theme, UiTheme::Light);
        assert_eq!(snap.config.last_vault.as_deref(), Some("/tmp/vault"));
        assert_eq!(snap.warnings.len(), 1, "{:?}", snap.warnings);
        assert!(snap.warnings[0].contains("ui.theme"), "{:?}", snap.warnings);
    }

    #[test]
    fn wrong_type_ui_theme_falls_back_entire_file() {
        // 边界如实记录（与 wrong_type_font_size_falls_back_entire_file 同路）：`[ui]` 表走
        // 结构化镜像（`RawUiConfig`），表内类型不符（`"theme": 2`）与整个表错形状
        //（`"ui": "dark"`）都在 serde 解析期失败 → **整文件回落**，warning 恰一条。
        // MUST NOT 出现「一部分字段按配置、一部分按默认」的混合态。
        for raw in [
            r#"{"last_vault":"/tmp/vault","ui":{"theme":2},"editor":{"mode":"code"}}"#,
            r#"{"last_vault":"/tmp/vault","ui":"dark"}"#,
        ] {
            let snap = load_from(&TempFile::new(raw).0);
            assert_eq!(snap.config, AppConfig::default(), "{raw} 应整份落回默认");
            assert_eq!(snap.config.ui.theme, UiTheme::Light);
            assert_eq!(snap.config.last_vault, None, "合法字段同样落回默认");
            assert_eq!(snap.warnings.len(), 1, "{raw}: {:?}", snap.warnings);
            assert!(
                snap.warnings[0].contains("不是合法 JSON"),
                "{raw}: {:?}",
                snap.warnings
            );
        }
    }
}
