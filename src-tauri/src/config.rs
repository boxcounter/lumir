//! 配置加载 —— M1 基础（ADR 0002 §5，架构复查 P2-6）。
//!
//! - 路径：macOS/Linux 遵循 `$XDG_CONFIG_HOME`（默认 `~/.config/lumir`），
//!   Windows 用 `%APPDATA%\lumir`，不采用 `~/Library/Application Support`
//!   （ADR 0002 §5 已定：配置需人可读可改，遵循 dotfile 生态惯例）。
//! - 校验：逐字段校验，非法值落回该字段默认值并附人话 warning；
//!   整文件不是合法 JSON 时才整体落回默认配置。
//! - 未知字段忽略（向前兼容：新版写入的字段旧版读取不报错）。
//! - 退役值迁移（M365）：`harness.providers.kimi.model` 命中 [`RETIRED_KIMI_MODEL`] 时改写为
//!   [`DEFAULT_KIMI_MODEL`] 并落盘——这是本模块唯一的**写**副作用，只改那一个字符串，
//!   其余键（含未知字段）逐键保留。
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
//! ## ui 表（restyle-ui-tokens-v1，M237 起含运行期切换）
//!
//! `{"ui": {"theme": "light" | "dark" | "eink", "content_width": 760,` +
//! `"markdown_line_numbers": "on-demand" | "always" | "off",` +
//! `"language": "en" | "zh"}}`，默认 `light` / `760` / `on-demand` / `en`。取值校验照 `editor.mode`
//! 模板：表内 `theme` 缺失 → 默认；取值不在表内 → warning + 回落默认（ADR 0002 §5：非法
//! 配置不导致启动失败）。它与 `editor` 一样是**结构化表**（`RawUiConfig`），不是 keys / log
//! 那种「整表收成 Value」——因此 `{"ui": "dark"}` 这种表的错形状与表内 `"theme": 2` 同路，
//! 都走**整文件回落**（同族说明见下节）。`theme` 的消费方是前端启动施加处
//! （`documentElement.dataset.theme`，与 `editor.mode` 同口径：装载时读一次并按它施加首帧）；
//! M237（change live-theme-switch）起它还支持**运行期切换**——前端命令与 modeline 主题钮
//! 循环三档，切换即经通用合并写 IPC `config_set_ui_value` 回写本字段（`commands.rs`），让启动
//! 真源跟上运行态。Rust 侧只负责读出来、挡住非法值、以及提供那条写通道；不跟随系统主题。
//! `markdown_line_numbers`（change goto-line-command 的 D4 二次改判，2026-09-28）与 `theme`
//! 的**差别在消费方**：它没有运行期切换的落点，因此是**装载时读一次、运行期 MUST NOT 回写**
//!（与 `editor.mode` / `editor.font_size` 同路）；消费方是前端启动施加处（`src/main.ts` 把它
//! 喂给 `editor.setMarkdownLineNumbers`）。
//!
//! `language`（change ui-language-i18n，M282）是界面语言：默认 **`en`**（Alex 2026-09-27 节点 1
//! 裁决），闭集合 `en` / `zh`。消费方与 `theme` 同形——前端启动施加处 `applyLanguage` 写
//! `documentElement.lang`，运行期由 `view.language-cycle`（⌘⇧L）与 modeline 语言钮切换并
//! 经 `config_set_ui_value` 回写本字段（写通道不校验，非法值由下次启动的 `validate()` 兜，
//! 与 `theme` 同款既有边界）。它**只管界面文案**：文档内容、文件名、日志与配置告警都不随它变。
//!
//! ## harness 表（change add-harness-probe §11，M301）
//!
//! `{"harness": {"provider": "kimi" | "deepseek" | "mock", "providers": {…},` +
//! `"permissions": {"allow": [], "deny": []}, "loop_max": 50, "warn_ctx_pct": 85,` +
//! `"auto_compact": true}}`——对话运行时（harness）的配置面，取值模板与 `editor` / `ui` 同路：
//! 表内字段缺失 → 默认（不告警）；闭集合取值非法 → 回落默认 + 人话 warning（ADR 0002 §5：
//! 非法配置不导致启动失败）；表内字段**类型不符**（`"loop_max": "50"`）与整表错形状
//! （`"harness": "kimi"`）都在 serde 解析期失败 → **整文件回落**（与 `editor.font_size`
//! / `ui.content_width` 同路，不发明逐字段类型容忍）。
//!
//! `permissions.allow` / `deny` 是**逐项**校验的例外（与 `vault.rule_files` 同形）：清单元素
//! 收成 `serde_json::Value` 再逐项判定，非法项丢弃并各给一条 warning，其余项照常生效——一项
//! 笔误不该让整份配置（含 `last_vault`）回退默认。规则**语义**（`tool(模式)` 的匹配）不在
//! 这里判定：那是 harness 运行时的知识（M302），配置层只管形状（「形状在此、语义在外」的既有
//! 分层，与 `keys` 表同口径）。
//!
//! `api_key` 明文（Alex 裁决点 2）：自用探针期威胁模型低（单机、本人），配置即数据要求人可读
//! 可改；Revisit 点（任何对外发布动作前改系统钥匙串）记在 ADR 0007 的出域口径里。
//! 空 `api_key` = 未配置（出厂状态），不是笔误，因此**不告警**；`model` / `base_url` /
//! `mock.fixture` 的空串是显式的空值输入，回落默认 + warning。
//!
//! M373 起 `[harness].providers.<id>` 暴露 **model 维度**：`models` 清单逐项 =
//! `{ "id": "kimi-k3", "effort": true, "window": 1048576 }`（effort = 是否支持思考程度调节、
//! window = 上下文窗口 tokens）。缺省 = 内置 preset（[`KIMI_MODEL_PRESET`] /
//! [`DEEPSEEK_MODEL_PRESET`]），用户显式声明则整体覆盖（含空列表）；逐项校验与 permissions
//! 同形（一项写坏只丢该项 + warning）。当前 model 仍是同级的 `model` 键（单 model 配置形态
//! 不变——Alex 现有的 `"model": "k3-256k"` 配置零迁移生效）。能力的唯一真源从此在
//! schema：llm.rs 的窗口表与 thinking.rs 的 k3 词元判定退役为这里的读取。
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
    /// vault 行为配置（change vault-open-ignore-set 的 r6）：`[vault]` 表。
    pub vault: VaultConfig,
    /// 对话运行时配置（change add-harness-probe §11）：`[harness]` 表。消费方是 harness
    /// 运行时（M302）：会话建立时读一次 provider 参数、权限规则表与循环上限。
    pub harness: HarnessConfig,
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
            vault: VaultConfig::default(),
            harness: HarnessConfig::default(),
        }
    }
}

/// 用户忽略规则的来源清单（`[vault]` 表的默认值，change vault-open-ignore-set §2.9）。
///
/// **两条默认值合起来 = 今日行为**：`<root>/.gitignore`（含递归途中的嵌套 `.gitignore`）与
/// `<root>/.git/info/exclude`（仅当 `.git` 是目录）。顺序即声明顺序；真正的优先级由
/// `fs_io::IgnorePolicy` 按 git 口径定（深层 `.gitignore` > 浅层 > `info/exclude`）。
pub const DEFAULT_RULE_FILES: [&str; 2] = [".gitignore", ".git/info/exclude"];

/// `[vault]` 表（change vault-open-ignore-set 的 r6，Alex 裁决第 7 条）：决定**用户规则**
/// 从哪些文件读——内置规则（`fs_io::BUILTIN_NAMES` 那 16 个名字 + 临时文件模式）恒定生效、
/// **不在**配置面内，也不可被用户规则的取反推翻（§2.6）。
///
/// **唯一消费者**：`commands::prepare_vault_open` 构造 `fs_io::IgnorePolicy` 时的那一步
///（把清单里的 vault 相对路径逐个读成 gitignore 规则）——本字段没有第二个读点，`config_get`
/// 只是把它原样交给前端展示（REVIEW.md 第 9 条：配置项声明即被消费）。因此它的生效时点是
/// **vault 装载时**（每次装载现场读一次配置，MUST NOT 用启动期缓存钉住），改动下次装载生效。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct VaultConfig {
    /// 用户规则的来源清单：每个值是**vault 相对路径**，一律按「vault 根的规则文件」解释
    ///（模式相对 vault 根匹配，MUST NOT 被当成「相对该文件所在目录」的规则）。
    ///
    /// - **空列表 = 没有用户规则来源**：只剩内置规则（= 非 git vault 的等价行为）。这是
    ///   彻底的——列表里不含 `.gitignore` 时，递归途中的嵌套 `.gitignore` 同样不读（嵌套
    ///   逐层读取是「`.gitignore` 这个来源」的固有语义，不是第二个配置面）。
    /// - 文件不存在 / 不是常规文件 ⇒ 静默跳过（`.git/info/exclude` 在非 git vault 里本来就
    ///   不存在，这是常态而不是异常）。
    /// - 非法项（非字符串 / 绝对路径 / 含 `..` / 空串）逐项忽略并各给一条人话 warning，
    ///   其余项照常生效——MUST NOT 因为一项非法而把整份配置（含别的字段）回退默认值。
    pub rule_files: Vec<String>,
}

impl Default for VaultConfig {
    fn default() -> Self {
        Self {
            rule_files: DEFAULT_RULE_FILES.iter().map(|s| s.to_string()).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct EditorConfig {
    /// 编辑器模式（ADR 0002 §2 单内核双模式）。
    pub mode: EditorMode,
    /// md 模式的文件级折行（change line-wrap-options）：`true`（默认）时正文行在阅读栏内
    /// 折行，`false` 时长行不折、由编辑区（`.cm-scroller`）横向平移呈现。只管 md 模式的正文
    /// 行——围栏 / 缩进代码块行由 `code_block_wrap` 裁决（「一元素一条规则」），code 模式的
    /// 正文行由 `code_mode_line_wrap` 裁决（M247 起两模式分叉，本键不再管 code 模式）。
    /// TS 侧出厂默认同值，见 `src/preview/theme.ts` 的 `DEFAULT_LINE_WRAP`（两处写值各有
    /// 单测钉住）。
    pub line_wrap: bool,
    /// 代码块折行：`false`（默认）时 md live preview 里的围栏 / 缩进代码块不折行、由块级
    /// 横滚容器承载；`true` 时在阅读栏内折行（M138 以来的现状）。作用面只有 md 模式——
    /// 非 md 文件没有围栏渲染，对它们无可观测效果（不是漏实现）。
    pub code_block_wrap: bool,
    /// code 模式正文行的折行（M247，change code-mode-line-wrap）：`false`（默认）时长行不折、
    /// 由编辑区横向平移呈现，`true` 时在阅读栏内折行。
    ///
    /// **键缺席 = 出厂 `false`（即 code 模式不折行）**，与 md 模式的出厂 `line_wrap = true`
    /// 构成「md 折 / code 不折」的出厂分叉（VS Code / JetBrains 同口径）；显式写 `true` 则听
    /// 用户（把 code 模式也折起来）。本键**不跟随** `line_wrap`——跟随会让缺省值随全局取值
    /// 漂移，出厂分叉随之失效。
    ///
    /// 作用面只有 code 模式：md 模式的正文行仍由 `line_wrap` 裁决，本键对 md 无可观测效果
    /// （不是漏实现）。TS 侧出厂默认同值，见 `src/preview/theme.ts` 的
    /// `DEFAULT_CODE_MODE_LINE_WRAP`（两处写值各有单测钉住）。
    pub code_mode_line_wrap: bool,
    /// `Enter` 换行的自动缩进（change enter-auto-indent）：`true`（默认）时 code 模式与 md 的
    /// 围栏 / 缩进代码块内按 `Enter` 会按语法缩进（无缩进规则的语言沿用当前行行首空白）；
    /// `false` 时这两处回到本 change 之前的行为（裸换行）。
    ///
    /// **键缺席 = 出厂 `true`**，且本键**不跟随**任何别的键（与 `code_mode_line_wrap` 同一条
    /// 口径：缺省值只由本键自己的出厂值决定）。
    ///
    /// 作用面只有本 change 新增的两处：md 的列表项 / 引用续行是编辑器内核自带语言包的行为，
    /// **本键对它无可观测效果**（`false` 时列表里按 Enter 仍会续写标记）——这是 D5a 的显式
    /// 口径，不是漏实现。TS 侧出厂默认同值，见 `src/enter-indent.ts` 的 `DEFAULT_AUTO_INDENT`
    /// （两处写值各有单测钉住）。
    pub auto_indent: bool,
    /// 正文（比例）字体族（change typography-and-zoom）：CSS `font-family` 值，`None` =
    /// 沿用基线观感（`src/style.css` 的 `--font-sans`）。只在启动装载时读一次——本能力不做
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
            code_mode_line_wrap: false,
            auto_indent: true,
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

/// 阅读栏宽默认（框宽 px，content-width-drag 节点 1 裁决 D1 → **2026-09-26 Alex 修订为 760**；
/// 664 → 680 → 760 是同一轮裁决序列的历史档，只有 760 是现役值）。
///
/// 三处同语义写值：本常量（配置面的真源）、`src/content-width.ts` 的
/// `DEFAULT_CONTENT_WIDTH`、`src/style.css` 的 `--layout-doc-measure` 默认值。三者必须同值，
/// 各有断言钉住，改一处必须同步其余两处（REVIEW.md 第 8 条）。
pub const DEFAULT_CONTENT_WIDTH: f64 = 760.0;

/// 栏宽合法区间（含端点，D2 落槌 [760, 1200]——**默认值即下限**，拖拽只能往宽调）：
/// 与前端拖拽钳制区间同值（`src/content-width.ts` 的 `CONTENT_WIDTH_MIN` /
/// `CONTENT_WIDTH_MAX`）。区间外一律回落默认值 + warning。
pub const CONTENT_WIDTH_MIN: f64 = 760.0;
pub const CONTENT_WIDTH_MAX: f64 = 1200.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum EditorMode {
    Md,
    Code,
}

/// 界面配置（`[ui]` 表，restyle-ui-tokens-v1）。与 `EditorConfig` 同为结构化表：
/// 逐字段取值校验，缺字段回落默认、取值非法回落默认 + warning。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct UiConfig {
    /// 界面主题，默认 `light`。**启动真源**：启动装载时读一次并施加到
    /// `documentElement.dataset.theme`（首帧主题）；运行期由 `view.theme-cycle`（⌘⇧T）与
    /// modeline 主题钮循环三档，**切换即经 `config_set_ui_value` 回写本字段**，让真源跟上运行态
    ///（M237，change live-theme-switch；与 `editor.font_size` 的「运行期 MUST NOT 回写」不同
    /// ——主题是设备 / 场景级的持久偏好）。取值由 `UiTheme` 闭集合校验；不跟随系统主题。
    pub theme: UiTheme,
    /// 阅读栏宽上限（框宽 px，content-width-drag，M228）：默认 760（D1，2026-09-26 Alex 修订），
    /// 合法区间 `[760, 1200]`（D2——默认值即下限）。启动时装配一次；运行期由栏宽拖拽推进并回写
    ///（`config_set_ui_value`，与 `editor.font_size` 的「运行期 MUST NOT 回写」不同——
    /// 宽度是用户显式调整的**持久偏好**，回写即本能力的核心语义）。
    /// 类型不符（`"content_width": "760"`）与 `font_size` 同路：serde 解析期失败 →
    /// 整文件回落。
    pub content_width: f64,
    /// md 模式行号 gutter 的在场档位（change goto-line-command 的 D4 二次改判，2026-09-28），
    /// 默认 `on-demand`。**只管 md**：只读 code 模式的行号 gutter 恒常显、不读本键。
    /// 与 `editor.mode` / `editor.font_size` 同路：**装载时读一次、运行期 MUST NOT 回写**
    ///（本 change 不提供切换它的命令 / 键位 / UI，因此没有 live 切换的触发源——与 `theme`
    /// 的差别正在这里，`theme` 有 modeline 主题钮那个落点）。
    pub markdown_line_numbers: MarkdownLineNumbers,
    /// 界面语言（change ui-language-i18n，M282）：默认 **`en`**（Alex 2026-09-27 节点 1 裁决
    /// 「我希望产品的默认语言是英文」）。**启动真源**：启动装载时读一次并由前端
    /// `applyLanguage` 施加到 `documentElement.lang`；运行期由 `view.language-cycle`（⌘⇧L）与
    /// modeline 语言钮切换，**切换即经 `config_set_ui_value` 回写本字段**（与 `theme` 同路）。
    /// 取值由 `UiLanguage` 闭集合校验；**只管界面文案**——文档内容、文件名、日志与配置告警
    /// 都 MUST NOT 随它变。
    pub language: UiLanguage,
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            theme: UiTheme::Light,
            content_width: DEFAULT_CONTENT_WIDTH,
            markdown_line_numbers: MarkdownLineNumbers::OnDemand,
            language: UiLanguage::En,
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

/// 界面语言（change ui-language-i18n，M282）：**闭集合**两档，取值校验在 Rust 侧完成，
/// 前端拿到的必是这两档之一，不再判非法（与 `UiTheme` / `EditorMode` / `LogLevel` 同一形态）。
/// 默认 `en`（Alex 2026-09-27 节点 1 裁决）。它**只管界面文案的取值列**：文档内容、文件名、
/// 日志与配置告警不随它变（日志面固定语言，见 change 的 Non-goals）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum UiLanguage {
    En,
    Zh,
}

/// md 模式行号 gutter 的在场档位（change goto-line-command 的 D4 二次改判，2026-09-28）。
/// 它不切换任何 token，只决定 `lineNumbers()` 在 md 模式何时在场：
/// `on-demand` = 默认档，md 文档打开时无行号，跳转输入条（`⌥G`）在场时显示、收起后隐藏；
/// `always` = md 常驻显示行号；
/// `off` = md 恒不显示行号。
/// **闭集合**：取值校验在 Rust 侧完成，前端拿到的必是这三档之一，不再判非法（与 `UiTheme`
/// / `EditorMode` / `LogLevel` 同一形态）。**只管 md**：code 模式的行号恒常显，不读本键。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub enum MarkdownLineNumbers {
    #[serde(rename = "on-demand")]
    OnDemand,
    #[serde(rename = "always")]
    Always,
    #[serde(rename = "off")]
    Off,
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

// ---------------------------------------------------------------------------
// `[harness]` 表（change add-harness-probe §11；M301）
// ---------------------------------------------------------------------------

/// 工具循环上限的出厂默认（design §4）：一次提问里模型最多连续执行几轮工具调用，防失控循环。
///
/// 出厂值由 M367 从 8 改为 50（Alex 2026-10-07 裁决「默认工具循环上限调整为 50 次」）：8 轮在
/// 多步任务（连读多个文件、边读边改）上过早触顶，用户看到的是「还没做完就停了」。上界仍是
/// [`LOOP_MAX_MAX`]（64）——防失控循环是这个键存在的理由，50 仍落在护栏内。
pub const DEFAULT_LOOP_MAX: u32 = 50;

/// 循环上限的合法区间（含端点）：下限 1（0 轮等于没有工具循环）；上限是本探针期的防失控
/// 护栏——放得过大等于没有上限，而「防失控循环」正是这个键存在的理由。区间外回落默认 + warning。
pub const LOOP_MAX_MIN: u32 = 1;
pub const LOOP_MAX_MAX: u32 = 64;

/// 上下文用量警示阈值的出厂默认（design §9）：ctx% 越过它即显示警示条，也是自动压缩的触发点。
pub const DEFAULT_WARN_CTX_PCT: f64 = 85.0;

/// 警示阈值的合法区间（含端点）：0 会让每一轮都触发压缩，>100 永不触发——两种都让这个键失去意义。
pub const WARN_CTX_PCT_MIN: f64 = 1.0;
pub const WARN_CTX_PCT_MAX: f64 = 100.0;

/// 两家 provider 的出厂 model 值（M302 的 provider 预设表以它们为出厂默认——**同一语义两处
/// 写值**，改一处必须同步另一处，REVIEW.md 第 8 条）。本模块只把它们当作「model 为空时回落
/// 的对象」；base_url 官方地址 / 超限特征串的真源在 harness 运行时的预设表里（M302），
/// 配置层不复制一份。模型清单 / 每模型能力声明（effort / 上下文窗口）自 M373 起也归本模块
/// （[`KIMI_MODEL_PRESET`] / [`DEEPSEEK_MODEL_PRESET`] + `HarnessProviderConfig.models`），
/// llm.rs 的窗口表与 thinking.rs 的能力判定已退役为 schema 读取。
///
/// deepseek 出厂值由 M309 从 design §11 的示例值 `deepseek-chat` 改为现役 `deepseek-flash`
/// （M306 一手核实 deepseek 现役仅 `deepseek-flash` / `deepseek-v4-pro`）。
///
/// kimi 出厂值由 M365 从 `kimi-k2` 改为现役 `kimi-k3`：k2 系 2026-05-25 官方退役（调用 404）。
/// 本仓预设端点（`https://api.moonshot.cn/v1`，中国开放平台）的 `model` 取值表为
/// `kimi-k3`（默认值，1M ctx）/ `kimi-k2.7-code` / `kimi-k2.6`（后两者 256K），2026-10-07
/// 一手核实（[Chat Completions 参数表](https://platform.moonshot.cn/docs/api/chat)、
/// [全球平台 Model List](https://platform.kimi.ai/docs/models.md)）。
///
/// **Kimi Code 订阅端的 `k3-256k` 不是开放平台的模型 id**：那是另一套端点与协议（它的 base URL
/// 官方口径是 Anthropic-compatible），Lumir harness 发 OpenAI Responses，写进去只会 404。
/// 详见 [`RETIRED_KIMI_MODEL`] 的说明。
pub const DEFAULT_KIMI_MODEL: &str = "kimi-k3";
pub const DEFAULT_DEEPSEEK_MODEL: &str = "deepseek-flash";

/// 已退役、需要迁移的 kimi model 值（M365）：加载时命中它即改写为 [`DEFAULT_KIMI_MODEL`]
/// 并落盘。只列**本仓曾经写出过**的那一个退役值——用户手填的其他型号（含将来仍有效的、
/// 我们不认识的 id）一律不动，改动面因此收敛到「我们自己的旧默认值」。
pub const RETIRED_KIMI_MODEL: &str = "kimi-k2";

/// 对话 provider 三档（change add-harness-probe §11）：`kimi` / `deepseek` 均 OpenAI 兼容契约，
/// `mock` 是验收专用的 fixture 驱动档（真机验收不依赖真实外部 API）。**闭集合**：取值校验在
/// Rust 侧完成，运行时拿到的必是三档之一（与 `UiTheme` / `EditorMode` / `LogLevel` 同一形态）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum HarnessProvider {
    Kimi,
    Deepseek,
    Mock,
}

/// `[harness]` 表（change add-harness-probe §11）：对话运行时的配置面。
///
/// **生效时点**：会话建立 / 每轮请求时由 harness 运行时读一次（M302），不热重载——与
/// `editor` / `ui` 的「装载时施加」同路。`api_key` 明文（Alex 裁决点 2，理由见模块头）。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HarnessConfig {
    /// 当前生效的 provider；其余两档的参数照旧保留在 `providers` 里（切回即恢复）。
    pub provider: HarnessProvider,
    /// 三家 provider 各自的参数表：`provider` 键切换生效项。
    pub providers: HarnessProviders,
    /// 权限规则表（design §6）：deny > allow > 默认分层（读 allow / 写与 CLI ask）。
    pub permissions: HarnessPermissions,
    /// 工具循环上限（默认 50，合法区间见 [`LOOP_MAX_MIN`] / [`LOOP_MAX_MAX`]）。
    pub loop_max: u32,
    /// 上下文用量警示阈值（百分比，默认 85，合法区间见 [`WARN_CTX_PCT_MIN`] / [`WARN_CTX_PCT_MAX`]）。
    pub warn_ctx_pct: f64,
    /// 自动压缩（默认 true）：一轮响应完成后 ctx% 越阈值即自动压缩续聊；false 退化为纯手动。
    pub auto_compact: bool,
}

impl Default for HarnessConfig {
    fn default() -> Self {
        Self {
            provider: HarnessProvider::Kimi,
            providers: HarnessProviders::default(),
            permissions: HarnessPermissions::default(),
            loop_max: DEFAULT_LOOP_MAX,
            warn_ctx_pct: DEFAULT_WARN_CTX_PCT,
            auto_compact: true,
        }
    }
}

/// `[harness].providers` 表：三家 provider 各一段参数，**都保留**（切 provider 不丢配置）。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HarnessProviders {
    pub kimi: HarnessProviderConfig,
    pub deepseek: HarnessProviderConfig,
    /// mock 是 fixture 驱动档，没有网络参数（验收专用）。
    pub mock: HarnessMockConfig,
}

/// 单个模型声明（M373，schema 暴露的 model 维度）：思考程度能力 + 上下文窗口。
///
/// 这是**能力/窗口表的唯一真源**——thinking.rs 的 k3 词元判定与 llm.rs 的 KIMI_PRESET
/// 窗口表已退役为本结构的读取（内置 preset 见 [`KIMI_MODEL_PRESET`] /
/// [`DEEPSEEK_MODEL_PRESET`]，用户配置 `[harness].providers.<id>.models` 可整体覆盖）。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HarnessModelSpec {
    /// 模型 id（配置值即读数，如 `kimi-k3` / `k3-256k`）。
    pub id: String,
    /// 该模型是否支持思考程度调节（`reasoning.effort`）。未声明 / 未列出 = 不支持
    /// （保守默认：不把无效参数发给不支持的模型）。
    pub effort: bool,
    /// 上下文窗口（tokens）：ctx% 读数的分母。
    pub window: u64,
}

/// kimi 内置模型清单（出厂默认；用户配置 `harness.providers.kimi.models` 覆盖）。
///
/// 2026-10-07 一手核实（[中国开放平台 Chat Completions 参数表](https://platform.moonshot.cn/docs/api/chat)
/// 的 `model` 取值表、[全球平台 Model List](https://platform.kimi.ai/docs/models.md)）：
/// 开放平台现役 `kimi-k3`（出厂默认，1M ctx）/ `kimi-k2.7-code` / `kimi-k2.7-code-highspeed` /
/// `kimi-k2.6`（后三者 256K）；`k3-256k`（Kimi Code 订阅端 id，M372 实测 Alex 配置的就是它，
/// 支持 effort、窗口 256K）不在开放平台的取值表里，但用户可配，一并列入出厂清单。
/// `kimi-k2` 系 2026-05-25 退役（调用 404），不在清单内：它回落 [`FALLBACK_CONTEXT_WINDOW`]
/// （与它的历史窗口同值，历史配置的 ctx% 读数逐值不变）。
///
/// effort 能力边界（[Thinking Models](https://platform.kimi.ai/docs/guide/use-thinking-models)
/// 请求字段对照表）：仅 k3 系（`kimi-k3` / `k3-256k`）支持 `reasoning.effort`，
/// k2.x 各档「Not supported」。
pub const KIMI_MODEL_PRESET: &[(&str, bool, u64)] = &[
    ("kimi-k3", true, 1_048_576),
    ("kimi-k2.7-code", false, 262_144),
    ("kimi-k2.7-code-highspeed", false, 262_144),
    ("kimi-k2.6", false, 262_144),
    ("k3-256k", true, 262_144),
];

/// deepseek 内置模型清单（出厂默认；用户配置 `harness.providers.deepseek.models` 覆盖）。
///
/// 2026-10-03 经 `GET /models` 一手核实（[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)）：
/// 现役仅 `deepseek-flash` / `deepseek-v4-pro`，上下文均 1M（1048576），都支持
/// `reasoning.effort`（[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)）。
/// `deepseek-chat` 已不在模型清单（回落 [`FALLBACK_CONTEXT_WINDOW`]，仅兜底历史配置）。
pub const DEEPSEEK_MODEL_PRESET: &[(&str, bool, u64)] = &[
    ("deepseek-flash", true, 1_048_576),
    ("deepseek-v4-pro", true, 1_048_576),
];

/// 上下文窗口的保守回落值（tokens）：模型不在生效清单内时使用（历史值 131_072 = 128K，
/// 与 kimi-k2 / deepseek-chat 的历史窗口同值——读数不飘）。**唯一写值处**，
/// 运行时的窗口查表未命中都回落这里。
pub const FALLBACK_CONTEXT_WINDOW: u64 = 131_072;

/// 单个网络 provider 的参数。
///
/// **`Default` 的 `model` 是空串，不是出厂模型名**：出厂模型名按 provider 分档
/// （[`DEFAULT_KIMI_MODEL`] / [`DEFAULT_DEEPSEEK_MODEL`]），由 [`HarnessProviders::default`]
/// 分派——这样「kimi 的默认 model」只有一处写值，两个 provider 不会互相串默认。
/// `api_key` 出厂为空串（未配置）、`base_url` 出厂为 `None`（官方地址）。
#[derive(Debug, Clone, PartialEq, Default, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HarnessProviderConfig {
    /// API key 明文（裁决点 2）。空串 = 未配置（出厂状态）——发送时由运行时给出人话错误。
    pub api_key: String,
    /// 模型 id。空串 / 缺失时按 provider 回落出厂模型名（见 `Default` 的说明）。
    pub model: String,
    /// API base URL；`None` = 用该 provider 的官方地址（官方值在运行时的预设表里，M302）。
    pub base_url: Option<String>,
    /// 可选模型清单 + 每模型能力声明（M373）。**缺省 = 内置 preset**（kimi /
    /// deepseek 各一份，见上）；用户显式声明（含空列表）则整体覆盖。这是浮层模型段
    /// 与 ctx% 窗口 / effort 能力判定的共同数据源。
    pub models: Vec<HarnessModelSpec>,
}

impl Default for HarnessProviders {
    fn default() -> Self {
        Self {
            kimi: HarnessProviderConfig {
                model: DEFAULT_KIMI_MODEL.to_string(),
                models: model_preset(KIMI_MODEL_PRESET),
                ..HarnessProviderConfig::default()
            },
            deepseek: HarnessProviderConfig {
                model: DEFAULT_DEEPSEEK_MODEL.to_string(),
                models: model_preset(DEEPSEEK_MODEL_PRESET),
                ..HarnessProviderConfig::default()
            },
            mock: HarnessMockConfig::default(),
        }
    }
}

/// 内置模型清单常量 → 生效结构（`Default` 与校验回落共用这一条路径，不留两份转换）。
fn model_preset(preset: &[(&str, bool, u64)]) -> Vec<HarnessModelSpec> {
    preset
        .iter()
        .map(|(id, effort, window)| HarnessModelSpec {
            id: id.to_string(),
            effort: *effort,
            window: *window,
        })
        .collect()
}

impl HarnessConfig {
    /// 指定 provider 的生效模型清单（schema 读取点，M373）：kimi / deepseek 各读各的
    /// `models`（缺省时 validate 已填内置 preset）；mock 是 fixture 驱动档，没有模型维度
    /// （UI 层隐藏、ctx% 借壳 kimi 读数），返回空表。
    pub fn model_specs(&self, provider: &HarnessProvider) -> &[HarnessModelSpec] {
        match provider {
            HarnessProvider::Kimi => &self.providers.kimi.models,
            HarnessProvider::Deepseek => &self.providers.deepseek.models,
            HarnessProvider::Mock => &[],
        }
    }

    /// 模型上下文窗口（tokens）：生效清单精确匹配，未列出回落 [`FALLBACK_CONTEXT_WINDOW`]
    /// （保守默认——ctx% 的分母宁可偏小读数偏保守，不猜窗口）。
    pub fn context_window(&self, provider: &HarnessProvider, model: &str) -> u64 {
        self.model_specs(provider)
            .iter()
            .find(|spec| spec.id == model)
            .map(|spec| spec.window)
            .unwrap_or(FALLBACK_CONTEXT_WINDOW)
    }

    /// 该 provider + model 是否支持思考程度调节（前端置灰判据，schema 读取点）：
    /// 生效清单精确匹配取声明值；未列出 = 不支持（保守默认，与 M372 前「kimi 非 k3 系
    /// 置灰」同一安全侧）；mock 恒定支持（fixture 驱动，验收要断言档位到达请求）。
    pub fn effort_supported(&self, provider: &HarnessProvider, model: &str) -> bool {
        match provider {
            HarnessProvider::Mock => true,
            HarnessProvider::Kimi | HarnessProvider::Deepseek => self
                .model_specs(provider)
                .iter()
                .find(|spec| spec.id == model)
                .is_some_and(|spec| spec.effort),
        }
    }
}

/// mock provider 的参数（验收专用，design §13）：脚本化响应的 fixture 文件路径。
/// `None` = 未配置（用 mock 档而未配 fixture 时由运行时给出人话错误）。
#[derive(Debug, Clone, PartialEq, Default, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HarnessMockConfig {
    pub fixture: Option<String>,
}

/// `[harness].permissions` 表（design §6）：规则语法 `tool` 或 `tool(模式)` 的字符串清单。
///
/// 配置层只保形状（非空字符串、按原顺序去空白），**匹配语义**（前缀 + `*`、deny > allow >
/// 默认分层）归 harness 运行时（M302）——与 `keys` 表「形状在此、语义在外」同一分层，
/// 两边各判一半必然漂移（REVIEW.md 第 8 条）。
#[derive(Debug, Clone, PartialEq, Default, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HarnessPermissions {
    pub allow: Vec<String>,
    pub deny: Vec<String>,
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
    /// `[vault]` 表（change vault-open-ignore-set §2.9）：`rule_files` 收成
    /// `Vec<serde_json::Value>` 再**逐项**校验——直接写成 `Vec<String>` 会让一个非法元素
    ///（例如误写了一个数字）在 serde 解析期失败，把整份配置（含 `last_vault`）打回默认。
    /// 代价（如实记，与 `editor.font_size` 给错类型同族）：**整个字段给错类型**（`"rule_files":
    /// ".gitignore"`）仍走解析期失败 → 整文件回落，这条由单测钉住。
    vault: RawVaultConfig,
    /// `[harness]` 表（change add-harness-probe §11）：结构化镜像，与 `editor` / `ui` 同路——
    /// 表内字段**类型不符**（`"loop_max": "50"`、`"auto_compact": "yes"`）或整表错形状
    /// （`"harness": "kimi"`）都在解析期失败 → 整文件回落。`permissions.allow` / `deny`
    /// 是逐项校验的例外（收成 `Vec<Value>` 逐项判定，见 [`RawHarnessPermissions`]）。
    harness: RawHarnessConfig,
}

/// `[vault]` 表的解析镜像。`rule_files` 缺席（缺节 / 缺键）→ `None` → 用默认清单；
/// 显式 `[]` → `Some(vec![])` → 没有用户规则来源。两者语义不同，不能混为一谈。
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawVaultConfig {
    rule_files: Option<Vec<serde_json::Value>>,
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
    /// 两项都只管 md 模式（M247 起 code 模式的正文行归下一项）。
    line_wrap: Option<bool>,
    code_block_wrap: Option<bool>,
    /// code 模式正文行的折行覆盖键（M247，change code-mode-line-wrap）：与折行两项同路——
    /// 字段缺失 → `None` → `validate()` 回落到 `EditorConfig::default()`（那里是 `false`，
    /// 即出厂分叉「code 不折」），**不是**跟随 `line_wrap`。类型不符（`"code_mode_line_wrap":
    /// "yes"`）在解析期失败 → 整文件回落，与 `line_wrap` 给错类型同路。
    code_mode_line_wrap: Option<bool>,
    /// `Enter` 自动缩进的覆盖键（M272，change enter-auto-indent）：口径与折行三项**同形**——
    /// 字段缺失 → `None` → `validate()` 回落到 `EditorConfig::default()`（那里是 `true`），
    /// **不跟随任何别的键**。类型不符（`"auto_indent": "yes"`）在解析期失败 → 整文件回落，
    /// 与 `line_wrap` 给错类型同路。
    auto_indent: Option<bool>,
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
    /// 栏宽（content-width-drag，M228）：数值字段，类型不符（`"content_width": "760"`）
    /// 在解析期失败 → 整文件回落（与 `font_size` 先例同型同路，不发明逐字段容忍）。
    content_width: Option<f64>,
    /// md 行号 gutter 档位（change goto-line-command 的 D4 二次改判）：取值是闭集合
    /// （`on-demand` / `always` / `off`），非法值到不了这里——在 `validate()` 里回落 + warning
    ///（与 `theme` 同路）。类型不符（`"markdown_line_numbers": 2`）在 serde 解析期失败 →
    /// 整文件回落。
    markdown_line_numbers: Option<String>,
    /// 界面语言（change ui-language-i18n，M282）：取值是闭集合（`en` / `zh`），非法值到不了
    /// 这里——在 `validate()` 里回落 + warning（与 `theme` 同路）。类型不符（`"language": 2`）
    /// 在 serde 解析期失败 → 整文件回落。
    language: Option<String>,
}

/// `[harness]` 表的解析镜像（change add-harness-probe §11）：与 `[ui]` 同路的**结构化表**，
/// 字段全部 `Option<...>`——缺失 → `None` → `validate()` 回落默认（不告警）；取值非法到不了
/// 这里（在 `validate()` 里回落 + warning）；类型不符在 serde 解析期失败 → 整文件回落。
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawHarnessConfig {
    provider: Option<String>,
    /// 嵌套表也是结构化的：`"providers": "kimi"` 这种错形状 → 整文件回落；
    /// `api_key` / `model` / `base_url` 给错类型（如 `"api_key": 1`）同路。
    providers: RawHarnessProviders,
    permissions: RawHarnessPermissions,
    loop_max: Option<u32>,
    warn_ctx_pct: Option<f64>,
    auto_compact: Option<bool>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawHarnessProviders {
    kimi: RawHarnessProviderConfig,
    deepseek: RawHarnessProviderConfig,
    mock: RawHarnessMockConfig,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawHarnessProviderConfig {
    api_key: Option<String>,
    model: Option<String>,
    base_url: Option<String>,
    /// 可选模型清单（M373）：逐项校验（与 permissions 清单同形的逐项容忍——一项写坏
    /// 只丢该项 + warning，不拖垮整份配置）。字段收成 Value 逐项判定：直接结构化会让
    /// 一项类型不符在 serde 解析期失败，走整文件回落。
    models: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawHarnessMockConfig {
    fixture: Option<String>,
}

/// `[harness].permissions` 表的解析镜像：`allow` / `deny` 收成 `Vec<serde_json::Value>` 再
/// **逐项**校验——直接写成 `Vec<String>` 会让一个非字符串元素在解析期失败，把整份配置（含
/// `last_vault`）打回默认。与 `[vault].rule_files` 完全同形（含「整个字段给错类型
/// （`"allow": "cli(ls)"`）仍走整文件回落」这条边界，单测钉住）。
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawHarnessPermissions {
    allow: Option<Vec<serde_json::Value>>,
    deny: Option<Vec<serde_json::Value>>,
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
///
/// **一次写副作用（M365）**：JSON 里 `harness.providers.kimi.model` 命中
/// [`RETIRED_KIMI_MODEL`] 时改写为 [`DEFAULT_KIMI_MODEL`] 并落盘（只改这一个键，其余键与未知
/// 字段逐键保留，见 [`migrate_retired_kimi_model`]）；本次生效值就是改写后的值。写失败只多一条
/// warning，不阻断加载（下次加载会再试一次，改写本身的判据是幂等的）。
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

    let mut value: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => {
            return ConfigSnapshot {
                config: AppConfig::default(),
                warnings: vec![format!(
                    "配置文件 {path_str} 不是合法 JSON（第 {} 行）：{}，已整体使用默认配置",
                    e.line(),
                    e
                )],
                path: path_str,
            };
        }
    };

    // 迁移先于结构解析：下面解析的就是「改写后」的那份，本次生效值与落盘内容同值。
    let migrated = migrate_retired_kimi_model(&mut value);
    let parse_text = if migrated {
        serde_json::to_string(&value).expect("serde_json::Value 一定可序列化")
    } else {
        // 未命中走原文解析：类型不符时的报错行号仍是原文件里的行
        text
    };

    match serde_json::from_str::<RawConfig>(&parse_text) {
        Ok(raw) => {
            let (config, mut warnings) = validate(raw);
            if migrated {
                warnings.push(format!(
                    "配置项 harness.providers.kimi.model 的 {RETIRED_KIMI_MODEL} 已退役，已自动改写为 {DEFAULT_KIMI_MODEL}"
                ));
                if let Err(e) = write_json_atomic(path, &value) {
                    warnings.push(format!(
                        "改写后的配置未能落盘（{}），下次启动会再试一次",
                        e.message
                    ));
                }
            }
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

/// 退役值迁移（纯函数，可测）：`harness.providers.kimi.model` 去空白后等于
/// [`RETIRED_KIMI_MODEL`] 时改写为 [`DEFAULT_KIMI_MODEL`]，返回是否命中。
///
/// **只改这一个字符串**：链路上任一层不是对象、或该键不存在 / 不是字符串，一律不命中；
/// 命中也只换掉 model 的值——`kimi` 表里的 `api_key` / `base_url`、其他 provider、其他表
/// 与未知字段都逐键保留。用户手填的其他型号（含我们不认识的、以及同样已退役但我们从未写出过
/// 的 id）一律不动，改动面因此收敛到「本仓自己的旧出厂值」。
fn migrate_retired_kimi_model(value: &mut serde_json::Value) -> bool {
    let slot = value
        .get_mut("harness")
        .and_then(|h| h.get_mut("providers"))
        .and_then(|p| p.get_mut("kimi"))
        .and_then(|k| k.get_mut("model"));
    match slot {
        Some(serde_json::Value::String(model)) if model.trim() == RETIRED_KIMI_MODEL => {
            *model = DEFAULT_KIMI_MODEL.to_string();
            true
        }
        _ => false,
    }
}

/// config.json 的原子落盘：tmp 文件 + rename 原子替换，缩进写（配置要人可读可改，ADR 0002 §5）。
///
/// **写 config.json 的唯一落盘实现**：应用侧的写命令（`commands.rs` 的 `config_set_value` /
/// `write_last_vault` 等）与 config 模块自己的退役值迁移都调用这里——同一语义不留两处真源
/// （REVIEW.md 第 8 条）。调用方之一是 [`load_from`] 的迁移修补写。
pub(crate) fn write_json_atomic(
    path: &Path,
    value: &serde_json::Value,
) -> Result<(), CommandError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| {
            CommandError::new(
                "config_write_failed",
                format!("无法创建配置目录 {}：{e}", dir.display()),
            )
        })?;
    }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(value).expect("配置 Value 一定可序列化");
    std::fs::write(&tmp, body).map_err(|e| {
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
    let mut code_mode_line_wrap = defaults.editor.code_mode_line_wrap;
    let mut auto_indent = defaults.editor.auto_indent;
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
    // code 模式正文行的折行覆盖键（M247）：口径与上两项**完全同形**（缺字段回落默认、不告警），
    // 差别只在默认值——`EditorConfig::default()` 给的是 `false`（出厂分叉「code 不折」），
    // 因此这里**不读** `line_wrap`，两个模式各取各的默认。
    if let Some(value) = raw.editor.code_mode_line_wrap {
        code_mode_line_wrap = value;
    }
    // `Enter` 自动缩进（M272，change enter-auto-indent）：与上三项**完全同形**（缺字段回落
    // 默认、不告警），默认值由 `EditorConfig::default()` 给（`true`），因此这里同样**不读**
    // 任何别的键。类型不符到不了这里——解析期整份配置就回落了（单测钉住）。
    if let Some(value) = raw.editor.auto_indent {
        auto_indent = value;
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

    // 栏宽（content-width-drag，M228）：区间判定照 `font_size` 模板——缺字段回落默认不告警、
    // 越界回落默认 + warning；类型不符同样走解析期整文件回落（单测钉住）。
    let mut content_width = defaults.ui.content_width;
    if let Some(value) = raw.ui.content_width {
        if (CONTENT_WIDTH_MIN..=CONTENT_WIDTH_MAX).contains(&value) {
            content_width = value;
        } else {
            warnings.push(format!(
                "配置项 ui.content_width 取值 {value} 超出合法区间 [{CONTENT_WIDTH_MIN}, {CONTENT_WIDTH_MAX}]，已回退为 {DEFAULT_CONTENT_WIDTH}"
            ));
        }
    }

    // md 行号 gutter 档位（change goto-line-command 的 D4 二次改判，2026-09-28）：取值校验照
    // `theme` 模板——缺字段回落默认（不告警）、取值不在三档内回落默认 + 人话 warning；
    // 类型不符到不了这里（解析期整文件回落，见 `RawUiConfig` 的注释）。
    let mut markdown_line_numbers = defaults.ui.markdown_line_numbers;
    if let Some(raw_tier) = raw.ui.markdown_line_numbers.as_deref() {
        match raw_tier {
            "on-demand" => markdown_line_numbers = MarkdownLineNumbers::OnDemand,
            "always" => markdown_line_numbers = MarkdownLineNumbers::Always,
            "off" => markdown_line_numbers = MarkdownLineNumbers::Off,
            other => warnings.push(format!(
                "配置项 ui.markdown_line_numbers 取值 \"{other}\" 非法（可选：on-demand、always、off），已回退为 on-demand"
            )),
        }
    }

    // 界面语言（change ui-language-i18n，M282）：取值校验照 `theme` 模板——缺字段回落默认
    // （不告警，默认 `en`）、取值不在两档内回落默认 + 人话 warning；类型不符到不了这里
    // （解析期整文件回落，见 `RawUiConfig` 的注释）。
    let mut language = defaults.ui.language;
    if let Some(raw_language) = raw.ui.language.as_deref() {
        match raw_language {
            "en" => language = UiLanguage::En,
            "zh" => language = UiLanguage::Zh,
            other => warnings.push(format!(
                "配置项 ui.language 取值 \"{other}\" 非法（可选：en、zh），已回退为 en"
            )),
        }
    }

    let (keys, mut key_warnings) = validate_keys(raw.keys);
    warnings.append(&mut key_warnings);

    let (log, mut log_warnings) = validate_log(raw.log);
    warnings.append(&mut log_warnings);

    let (vault, mut vault_warnings) = validate_vault(raw.vault);
    warnings.append(&mut vault_warnings);

    let (harness, mut harness_warnings) = validate_harness(raw.harness);
    warnings.append(&mut harness_warnings);

    (
        AppConfig {
            version,
            last_vault,
            editor: EditorConfig {
                mode,
                line_wrap,
                code_block_wrap,
                code_mode_line_wrap,
                auto_indent,
                font_family,
                mono_font_family,
                font_size,
            },
            ui: UiConfig {
                theme,
                content_width,
                markdown_line_numbers,
                language,
            },
            keys,
            log,
            vault,
            harness,
        },
        warnings,
    )
}

/// `[vault]` 表的校验（change vault-open-ignore-set §2.9）：`rule_files` 缺席 ⇒ 默认清单
/// （不告警）；显式给出 ⇒ **逐项**校验，非法项丢弃并各给一条人话 warning，其余项照常生效
///（ADR 0002 §5：逐字段校验、非法值人话 warning、不得导致启动失败，也 MUST NOT 因为一项
/// 非法把其余字段一起回退）。
///
/// 合法项 = 非空、相对路径、不含 `..` 组件的 vault 相对路径。「文件是否存在」不在这里判定
/// ——那是装载时按 vault 根逐个探测的事，且「不存在」是常态（`.git/info/exclude` 在非 git
/// vault 里就没有），MUST NOT 报错、MUST NOT 给 warning。
fn validate_vault(raw: RawVaultConfig) -> (VaultConfig, Vec<String>) {
    let defaults = VaultConfig::default();
    let mut warnings = Vec::new();
    let Some(items) = raw.rule_files else {
        return (defaults, warnings); // 缺节 / 缺键：与今日行为逐条一致
    };
    let mut rule_files = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let Some(text) = item.as_str() else {
            warnings.push(format!(
                "配置项 vault.rule_files 的第 {} 项不是字符串，已忽略",
                index + 1
            ));
            continue;
        };
        if text.trim().is_empty() {
            warnings.push(format!(
                "配置项 vault.rule_files 的第 {} 项为空，已忽略",
                index + 1
            ));
            continue;
        }
        if Path::new(text).is_absolute() {
            warnings.push(format!(
                "配置项 vault.rule_files 的 \"{text}\" 是绝对路径（规则文件必须是 vault 相对路径），已忽略"
            ));
            continue;
        }
        if Path::new(text)
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            warnings.push(format!(
                "配置项 vault.rule_files 的 \"{text}\" 含 ..（不允许越出 vault 根），已忽略"
            ));
            continue;
        }
        rule_files.push(text.to_string());
    }
    (VaultConfig { rule_files }, warnings)
}

/// `[harness]` 表的校验（change add-harness-probe §11）：照 `editor` / `ui` 的模板——缺字段
/// 回落默认（不告警），闭集合取值非法回落默认 + 人话 warning，数值越界回落默认 + warning；
/// 类型不符到不了这里（解析期整文件回落，见 [`RawHarnessConfig`]）。
///
/// 两处**逐项**校验的例外（与 `vault.rule_files` 同形）：`permissions.allow` / `deny` 的
/// 非法项逐项丢弃并各给一条 warning，其余项照常生效。空 `api_key` 是「未配置」的出厂状态，
/// **不告警**（理由见模块头）。
fn validate_harness(raw: RawHarnessConfig) -> (HarnessConfig, Vec<String>) {
    let defaults = HarnessConfig::default();
    let mut warnings = Vec::new();

    let mut provider = defaults.provider;
    if let Some(raw_provider) = raw.provider.as_deref() {
        match raw_provider {
            "kimi" => provider = HarnessProvider::Kimi,
            "deepseek" => provider = HarnessProvider::Deepseek,
            "mock" => provider = HarnessProvider::Mock,
            other => warnings.push(format!(
                "配置项 harness.provider 取值 \"{other}\" 非法（可选：kimi、deepseek、mock），已回退为 kimi"
            )),
        }
    }

    let kimi = validate_harness_provider(
        raw.providers.kimi,
        "kimi",
        DEFAULT_KIMI_MODEL,
        KIMI_MODEL_PRESET,
        &mut warnings,
    );
    let deepseek = validate_harness_provider(
        raw.providers.deepseek,
        "deepseek",
        DEFAULT_DEEPSEEK_MODEL,
        DEEPSEEK_MODEL_PRESET,
        &mut warnings,
    );
    let mock = validate_harness_mock(raw.providers.mock, &mut warnings);

    let permissions = HarnessPermissions {
        allow: validate_harness_rules(raw.permissions.allow, "allow", &mut warnings),
        deny: validate_harness_rules(raw.permissions.deny, "deny", &mut warnings),
    };

    let mut loop_max = defaults.loop_max;
    if let Some(value) = raw.loop_max {
        if (LOOP_MAX_MIN..=LOOP_MAX_MAX).contains(&value) {
            loop_max = value;
        } else {
            warnings.push(format!(
                "配置项 harness.loop_max 取值 {value} 超出合法区间 [{LOOP_MAX_MIN}, {LOOP_MAX_MAX}]，已回退为 {DEFAULT_LOOP_MAX}"
            ));
        }
    }

    // 区间判定同时挡 NaN（`contains` 对 NaN 为 false），与 `ui.content_width` 同口径。
    let mut warn_ctx_pct = defaults.warn_ctx_pct;
    if let Some(value) = raw.warn_ctx_pct {
        if (WARN_CTX_PCT_MIN..=WARN_CTX_PCT_MAX).contains(&value) {
            warn_ctx_pct = value;
        } else {
            warnings.push(format!(
                "配置项 harness.warn_ctx_pct 取值 {value} 超出合法区间 [{WARN_CTX_PCT_MIN}, {WARN_CTX_PCT_MAX}]，已回退为 {DEFAULT_WARN_CTX_PCT}"
            ));
        }
    }

    // bool 只有两种取值，缺字段即回落默认、不告警（与 `editor.line_wrap` 同路）；
    // 类型不符到不了这里（解析期整文件回落，单测钉住）。
    let auto_compact = raw.auto_compact.unwrap_or(defaults.auto_compact);

    (
        HarnessConfig {
            provider,
            providers: HarnessProviders {
                kimi,
                deepseek,
                mock,
            },
            permissions,
            loop_max,
            warn_ctx_pct,
            auto_compact,
        },
        warnings,
    )
}

/// 单个 provider 参数的校验：`api_key` 去空白后原样保留（空 = 未配置，不告警）；
/// `model` 空 → 该 provider 的出厂模型名 + warning；`base_url` 空 → `None`（官方地址）+ warning。
/// `models` 缺省 → 内置 preset（不告警）；显式声明（含空列表）→ 逐项校验生效。
/// URL 是否可用不在这里判定——那是网络层的事（reqwest 的报错更准），与「形状在此、语义在外」同路。
fn validate_harness_provider(
    raw: RawHarnessProviderConfig,
    provider: &str,
    default_model: &str,
    preset: &[(&str, bool, u64)],
    warnings: &mut Vec<String>,
) -> HarnessProviderConfig {
    let api_key = raw
        .api_key
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    let model = match raw.model.as_deref().map(str::trim) {
        None => default_model.to_string(),
        Some("") => {
            warnings.push(format!(
                "配置项 harness.providers.{provider}.model 为空，已回退为 {default_model}"
            ));
            default_model.to_string()
        }
        Some(value) => value.to_string(),
    };
    let base_url = match raw.base_url.as_deref().map(str::trim) {
        None => None,
        Some("") => {
            warnings.push(format!(
                "配置项 harness.providers.{provider}.base_url 为空，已回退为 {provider} 官方地址"
            ));
            None
        }
        Some(value) => Some(value.to_string()),
    };
    let models = match raw.models {
        None => model_preset(preset),
        Some(items) => validate_harness_model_specs(&items, provider, warnings),
    };
    HarnessProviderConfig {
        api_key,
        model,
        base_url,
        models,
    }
}

/// 模型清单的**逐项**校验（M373，与 permissions 清单同形）：每项必须是对象，含非空
/// `id` 字符串；`effort` 缺省 → false（保守默认）+ warning，类型不符 → 丢该项 + warning；
/// `window` 缺省 → [`FALLBACK_CONTEXT_WINDOW`] + warning，非正整数 / 超上限 → 丢该项 +
/// warning；重复 `id` → 保留先出现的，丢重项 + warning。合法项按原顺序生效，
/// 一项写坏不拖垮清单的其余项。
fn validate_harness_model_specs(
    items: &[serde_json::Value],
    provider: &str,
    warnings: &mut Vec<String>,
) -> Vec<HarnessModelSpec> {
    /// 窗口合法上限（tokens）：现役最大 1M，放宽一个数量级容纳未来大窗模型；
    /// 超出视为笔误（多写一个 0 就是 10 倍）。
    const WINDOW_MAX: u64 = 10_000_000;
    let mut specs = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let at = format!("harness.providers.{provider}.models 的第 {} 项", index + 1);
        let Some(map) = item.as_object() else {
            warnings.push(format!("配置项 {at} 不是对象，已忽略"));
            continue;
        };
        let Some(id) = map.get("id").and_then(|v| v.as_str()).map(str::trim) else {
            warnings.push(format!("配置项 {at} 缺少 id（或 id 不是字符串），已忽略"));
            continue;
        };
        if id.is_empty() {
            warnings.push(format!("配置项 {at} 的 id 为空，已忽略"));
            continue;
        }
        if specs.iter().any(|spec: &HarnessModelSpec| spec.id == id) {
            warnings.push(format!("配置项 {at} 的 id \"{id}\" 重复，已忽略"));
            continue;
        }
        let effort = match map.get("effort") {
            None => {
                warnings.push(format!(
                    "配置项 {at}（id \"{id}\"）未声明 effort 能力，已按不支持处理"
                ));
                false
            }
            Some(serde_json::Value::Bool(value)) => *value,
            Some(_) => {
                warnings.push(format!(
                    "配置项 {at}（id \"{id}\"）的 effort 应为布尔值，已忽略该项"
                ));
                continue;
            }
        };
        let window = match map.get("window") {
            None => {
                warnings.push(format!(
                    "配置项 {at}（id \"{id}\"）未声明 window，已回退为 {FALLBACK_CONTEXT_WINDOW}"
                ));
                FALLBACK_CONTEXT_WINDOW
            }
            Some(value) => {
                let parsed = value
                    .as_u64()
                    .filter(|window| *window > 0 && *window <= WINDOW_MAX);
                match parsed {
                    Some(window) => window,
                    None => {
                        warnings.push(format!(
                            "配置项 {at}（id \"{id}\"）的 window 应为 1..={WINDOW_MAX} 的整数，已忽略该项"
                        ));
                        continue;
                    }
                }
            }
        };
        specs.push(HarnessModelSpec {
            id: id.to_string(),
            effort,
            window,
        });
    }
    specs
}

/// mock 档参数：`fixture` 空 → `None`（未配置）+ warning，与 `base_url` 同口径。
fn validate_harness_mock(
    raw: RawHarnessMockConfig,
    warnings: &mut Vec<String>,
) -> HarnessMockConfig {
    let fixture = match raw.fixture.as_deref().map(str::trim) {
        None => None,
        Some("") => {
            warnings.push("配置项 harness.providers.mock.fixture 为空，已按未配置处理".to_string());
            None
        }
        Some(value) => Some(value.to_string()),
    };
    HarnessMockConfig { fixture }
}

/// 权限规则清单的**逐项**校验（与 `vault.rule_files` 同形）：非字符串 / 空串逐项丢弃并各给一条
/// warning，其余项按原顺序保留。规则的**匹配语义**不在这里判定（见 [`HarnessPermissions`]）。
fn validate_harness_rules(
    items: Option<Vec<serde_json::Value>>,
    key: &str,
    warnings: &mut Vec<String>,
) -> Vec<String> {
    let Some(items) = items else {
        return Vec::new(); // 缺键 ⇒ 空规则表（= 只有默认分层），不告警
    };
    let mut rules = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let Some(text) = item.as_str() else {
            warnings.push(format!(
                "配置项 harness.permissions.{key} 的第 {} 项不是字符串，已忽略",
                index + 1
            ));
            continue;
        };
        let trimmed = text.trim();
        if trimmed.is_empty() {
            warnings.push(format!(
                "配置项 harness.permissions.{key} 的第 {} 项为空，已忽略",
                index + 1
            ));
            continue;
        }
        rules.push(trimmed.to_string());
    }
    rules
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
    fn missing_ui_content_width_takes_default() {
        // 老配置文件（content-width-drag 之前写入）没有这一项：回落默认 760（D1 落槌值，
        // 2026-09-26 修订）、不产生 warning（比照 missing_editor_wrap_fields_take_defaults）。
        let f = TempFile::new(r#"{"version":1,"ui":{"theme":"dark"}}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.ui.content_width, DEFAULT_CONTENT_WIDTH);
        assert_eq!(snap.config.ui.theme, UiTheme::Dark, "同表其它字段不受影响");
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
        // 整个 [ui] 表缺失同样回落默认。
        let f = TempFile::new(r#"{"version":1}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.ui.content_width, DEFAULT_CONTENT_WIDTH);
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    #[test]
    fn explicit_ui_content_width_is_loaded() {
        let f = TempFile::new(r#"{"ui":{"content_width":800}}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.ui.content_width, 800.0);
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    #[test]
    fn out_of_range_ui_content_width_falls_back_with_warning() {
        // 区间 [760, 1200]（D2 落槌值，2026-09-26 修订）：两端之外都回落默认 + 恰一条 warning。
        for raw in [
            r#"{"ui":{"content_width":200}}"#,
            r#"{"ui":{"content_width":2000}}"#,
        ] {
            let snap = load_from(&TempFile::new(raw).0);
            assert_eq!(snap.config.ui.content_width, DEFAULT_CONTENT_WIDTH, "{raw}");
            assert_eq!(snap.warnings.len(), 1, "{raw}: {:?}", snap.warnings);
            assert!(
                snap.warnings[0].contains("ui.content_width"),
                "{raw}: {:?}",
                snap.warnings
            );
        }
        // 端点值合法（含端点）。
        for edge in [760, 1200] {
            let f = TempFile::new(&format!(r#"{{"ui":{{"content_width":{edge}}}}}"#));
            let snap = load_from(&f.0);
            assert_eq!(snap.config.ui.content_width, f64::from(edge));
            assert!(snap.warnings.is_empty(), "{edge}: {:?}", snap.warnings);
        }
    }

    #[test]
    fn wrong_type_ui_content_width_falls_back_entire_file() {
        // 边界如实记录（与 wrong_type_ui_theme_falls_back_entire_file 同路）：数值字段写成
        // 字符串（`"content_width": "760"`）在 serde 解析期失败 → **整文件回落**，warning 恰一条。
        // MUST NOT 出现「一部分字段按配置、一部分按默认」的混合态（本 change 不引入逐字段类型容忍）。
        let f = TempFile::new(
            r#"{"last_vault":"/tmp/vault","ui":{"content_width":"760","theme":"dark"},"editor":{"mode":"code"}}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(snap.config, AppConfig::default(), "应整份落回默认");
        assert_eq!(snap.config.ui.theme, UiTheme::Light);
        assert_eq!(snap.config.editor.mode, EditorMode::Md);
        assert_eq!(snap.config.last_vault, None, "合法字段同样落回默认");
        assert_eq!(snap.warnings.len(), 1, "{:?}", snap.warnings);
        assert!(
            snap.warnings[0].contains("不是合法 JSON"),
            "{:?}",
            snap.warnings
        );
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
    fn missing_code_mode_line_wrap_takes_factory_false() {
        // M247（change code-mode-line-wrap）：键缺席 = 出厂 `false`（code 模式不折行）——这是
        // 「md 折 / code 不折」出厂分叉的配置面形态，不产生 warning。
        // **判别性在第二组**：显式 `line_wrap: true` 在场时它仍必须是 `false`——口径是
        // 「code 模式的缺省是本键自己的出厂值」，MUST NOT 跟随全局 `line_wrap`（跟随会让
        // 出厂分叉随用户改全局折行而失效）。只测第一组的话，把实现写成 `line_wrap` 的副本
        // 也能绿（REVIEW.md 第 1 条）。
        for raw in [
            r#"{"version":1,"editor":{"mode":"code"}}"#,
            r#"{"version":1,"editor":{"mode":"code","line_wrap":true}}"#,
        ] {
            let snap = load_from(&TempFile::new(raw).0);
            assert!(
                !snap.config.editor.code_mode_line_wrap,
                "{raw}：缺省应为出厂 false"
            );
            assert!(snap.config.editor.line_wrap, "{raw}：md 侧口径不受影响");
            assert!(snap.warnings.is_empty(), "{raw}: {:?}", snap.warnings);
        }
    }

    #[test]
    fn explicit_code_mode_line_wrap_is_loaded() {
        // 显式设置则听用户：`true` 把 code 模式也折起来，`false` 与缺省同效（三态里的后两态）。
        let on =
            load_from(&TempFile::new(r#"{"editor":{"mode":"code","code_mode_line_wrap":true}}"#).0);
        assert!(on.config.editor.code_mode_line_wrap);
        assert!(on.warnings.is_empty(), "{:?}", on.warnings);

        let off = load_from(
            &TempFile::new(
                r#"{"editor":{"mode":"code","line_wrap":true,"code_mode_line_wrap":false}}"#,
            )
            .0,
        );
        assert!(!off.config.editor.code_mode_line_wrap);
        assert!(off.config.editor.line_wrap, "两键互不改写（各管各的模式）");
        assert!(off.warnings.is_empty(), "{:?}", off.warnings);
    }

    #[test]
    fn wrong_type_code_mode_line_wrap_falls_back_entire_file() {
        // 边界如实记录（与 wrong_type_line_wrap_falls_back_entire_file 同路）：
        // `Option<bool>` 遇到类型不符在 serde 解析期失败 → **整文件回落**（全部默认 + 一条
        // warning），MUST NOT 出现「一部分字段按配置、一部分按默认」的混合态。
        let f = TempFile::new(
            r#"{"last_vault":"/tmp/vault","editor":{"mode":"code","code_mode_line_wrap":"yes"}}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(snap.config, AppConfig::default(), "整份配置应落回默认");
        assert!(!snap.config.editor.code_mode_line_wrap, "回到出厂 false");
        assert_eq!(snap.config.editor.mode, EditorMode::Md);
        assert_eq!(snap.config.last_vault, None, "合法字段同样落回默认");
        assert_eq!(snap.warnings.len(), 1, "{:?}", snap.warnings);
        assert!(snap.warnings[0].contains("不是合法 JSON"));
    }

    #[test]
    fn missing_auto_indent_takes_factory_true() {
        // M272（change enter-auto-indent）：键缺席 = 出厂 `true`，不产生 warning。
        // **判别性在第二组**：显式把两个折行键都写成 `false` 时它仍必须是 `true`——口径是
        // 「缺省值只由本键自己的出厂值决定、不跟随任何别的键」（跟随会让出厂口径随用户改折行
        // 而漂移）。只测第一组的话，把实现写成别的键的副本也能绿（REVIEW.md 第 1 条）。
        for raw in [
            r#"{"version":1,"editor":{"mode":"code"}}"#,
            r#"{"version":1,"editor":{"mode":"code","line_wrap":false,"code_mode_line_wrap":false}}"#,
        ] {
            let snap = load_from(&TempFile::new(raw).0);
            assert!(snap.config.editor.auto_indent, "{raw}：缺省应为出厂 true");
            assert!(snap.warnings.is_empty(), "{raw}: {:?}", snap.warnings);
        }
    }

    #[test]
    fn explicit_auto_indent_is_loaded() {
        // 显式 `false` 关掉自动缩进（三态里的第三态）；显式 `true` 与缺省同效但必须被读出。
        let off = load_from(&TempFile::new(r#"{"editor":{"mode":"code","auto_indent":false}}"#).0);
        assert!(!off.config.editor.auto_indent);
        assert!(off.warnings.is_empty(), "{:?}", off.warnings);

        let on = load_from(
            &TempFile::new(
                r#"{"editor":{"mode":"code","auto_indent":true,"code_mode_line_wrap":true}}"#,
            )
            .0,
        );
        assert!(on.config.editor.auto_indent);
        assert!(
            on.config.editor.code_mode_line_wrap,
            "两键互不改写（同一条装配链上的独立字段）"
        );
        assert!(on.warnings.is_empty(), "{:?}", on.warnings);
    }

    #[test]
    fn wrong_type_auto_indent_falls_back_entire_file() {
        // 边界如实记录（与 wrong_type_line_wrap_falls_back_entire_file 同路）：`Option<bool>`
        // 遇到类型不符在 serde 解析期失败 → **整文件回落**（全部默认 + 一条 warning），
        // MUST NOT 出现「一部分字段按配置、一部分按默认」的混合态；本 change MUST NOT 引入
        // 逐字段类型容忍。
        let f = TempFile::new(
            r#"{"last_vault":"/tmp/vault","editor":{"mode":"code","auto_indent":"yes"}}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(snap.config, AppConfig::default(), "整份配置应落回默认");
        assert!(snap.config.editor.auto_indent, "回到出厂 true");
        assert_eq!(snap.config.editor.mode, EditorMode::Md);
        assert_eq!(snap.config.last_vault, None, "合法字段同样落回默认");
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
    fn missing_markdown_line_numbers_defaults_to_on_demand() {
        // change goto-line-command 的 D4 二次改判：`ui.markdown_line_numbers` 是**新增**键，
        // 老配置没有它 ⇒ 默认 `on-demand` 且**不告警**（比照 missing_ui_table_defaults_to_light
        // 的缺字段口径）。同表其它字段照常解析。
        let f = TempFile::new(r#"{"ui":{"theme":"dark"}}"#);
        let snap = load_from(&f.0);
        assert_eq!(
            snap.config.ui.markdown_line_numbers,
            MarkdownLineNumbers::OnDemand
        );
        assert_eq!(snap.config.ui.theme, UiTheme::Dark);
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    #[test]
    fn ui_markdown_line_numbers_accepts_three_tiers() {
        // 三档闭集合逐个过一遍（含显式写默认档）；都不产生 warning。
        for (raw, want) in [
            ("on-demand", MarkdownLineNumbers::OnDemand),
            ("always", MarkdownLineNumbers::Always),
            ("off", MarkdownLineNumbers::Off),
        ] {
            let f = TempFile::new(&format!(r#"{{"ui":{{"markdown_line_numbers":"{raw}"}}}}"#));
            let snap = load_from(&f.0);
            assert_eq!(snap.config.ui.markdown_line_numbers, want, "{raw}");
            assert!(snap.warnings.is_empty(), "{raw}: {:?}", snap.warnings);
        }
    }

    #[test]
    fn illegal_ui_markdown_line_numbers_warns_and_falls_back_to_on_demand() {
        // 档外值走 warning + 回落默认（比照 illegal_ui_theme_warns_and_falls_back_to_light）；
        // 同一份配置里的合法字段照常生效。
        let f =
            TempFile::new(r#"{"ui":{"markdown_line_numbers":"toggle"},"last_vault":"/tmp/vault"}"#);
        let snap = load_from(&f.0);
        assert_eq!(
            snap.config.ui.markdown_line_numbers,
            MarkdownLineNumbers::OnDemand
        );
        assert_eq!(snap.config.last_vault.as_deref(), Some("/tmp/vault"));
        assert_eq!(snap.warnings.len(), 1, "{:?}", snap.warnings);
        assert!(
            snap.warnings[0].contains("ui.markdown_line_numbers"),
            "{:?}",
            snap.warnings
        );
    }

    #[test]
    fn wrong_type_ui_markdown_line_numbers_falls_back_entire_file() {
        // 表内类型不符（`"markdown_line_numbers": 2`）与 `ui.theme` 同路：`RawUiConfig` 是结构化
        // 镜像，serde 解析期失败 ⇒ **整文件回落**（含同表的 theme、以及 last_vault）——不发明
        // 逐字段类型容忍。
        let f = TempFile::new(
            r#"{"last_vault":"/tmp/vault","ui":{"markdown_line_numbers":2,"theme":"dark"}}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(snap.config, AppConfig::default());
        assert_eq!(snap.config.ui.theme, UiTheme::Light);
        assert_eq!(snap.config.last_vault, None);
        assert_eq!(snap.warnings.len(), 1, "{:?}", snap.warnings);
        assert!(snap.warnings[0].contains("不是合法 JSON"));
    }

    #[test]
    fn missing_ui_language_defaults_to_en() {
        // change ui-language-i18n（M282）：`ui.language` 是**新增**键，老配置没有它 ⇒ 默认
        // `en`（Alex 2026-09-27 节点 1 裁决的判据落点）且**不告警**。同表其它字段照常解析。
        let f = TempFile::new(r#"{"ui":{"theme":"dark"}}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.ui.language, UiLanguage::En);
        assert_eq!(snap.config.ui.theme, UiTheme::Dark);
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    #[test]
    fn ui_language_accepts_closed_set() {
        // 两档闭集合逐个过一遍（含显式写默认档 `en`）；都不产生 warning。
        for (raw, want) in [("en", UiLanguage::En), ("zh", UiLanguage::Zh)] {
            let f = TempFile::new(&format!(r#"{{"ui":{{"language":"{raw}"}}}}"#));
            let snap = load_from(&f.0);
            assert_eq!(snap.config.ui.language, want, "{raw}");
            assert!(snap.warnings.is_empty(), "{raw}: {:?}", snap.warnings);
        }
    }

    #[test]
    fn illegal_ui_language_warns_and_falls_back_to_en() {
        // 闭集合外的值走 warning + 回落默认（比照 illegal_ui_theme_warns_and_falls_back_to_light）；
        // 同一份配置里的合法字段照常生效。
        let f = TempFile::new(r#"{"ui":{"language":"ja"},"last_vault":"/tmp/vault"}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.ui.language, UiLanguage::En);
        assert_eq!(snap.config.last_vault.as_deref(), Some("/tmp/vault"));
        assert_eq!(snap.warnings.len(), 1, "{:?}", snap.warnings);
        assert!(
            snap.warnings[0].contains("ui.language"),
            "{:?}",
            snap.warnings
        );
    }

    #[test]
    fn wrong_type_ui_language_falls_back_entire_file() {
        // 表内类型不符（`"language": 2`）与 `ui.theme` 同路：`RawUiConfig` 是结构化镜像，
        // serde 解析期失败 ⇒ **整文件回落**（含同表的 theme 与 last_vault）——不发明逐字段
        // 类型容忍。
        let f = TempFile::new(r#"{"last_vault":"/tmp/vault","ui":{"language":2,"theme":"dark"}}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config, AppConfig::default());
        assert_eq!(snap.config.ui.language, UiLanguage::En);
        assert_eq!(snap.config.last_vault, None);
        assert_eq!(snap.warnings.len(), 1, "{:?}", snap.warnings);
        assert!(snap.warnings[0].contains("不是合法 JSON"));
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
    // -----------------------------------------------------------------------
    // `[vault]` 表（change vault-open-ignore-set §2.9，Alex 定案第 7 条）
    // -----------------------------------------------------------------------

    /// 语义①：缺节 / 缺键 ⇒ 出厂默认清单（与今日行为逐条一致），不产生 warning。
    #[test]
    fn vault_rule_files_defaults_when_section_or_key_is_missing() {
        for raw in [
            r#"{"version":1,"last_vault":"/tmp/vault"}"#,
            r#"{"version":1,"last_vault":"/tmp/vault","vault":{}}"#,
            r#"{"version":1,"last_vault":"/tmp/vault","vault":{"future":1}}"#,
        ] {
            let snap = load_from(&TempFile::new(raw).0);
            assert_eq!(
                snap.config.vault.rule_files,
                vec![".gitignore".to_string(), ".git/info/exclude".to_string()],
                "{raw}"
            );
            assert!(snap.warnings.is_empty(), "{raw}: {:?}", snap.warnings);
            assert_eq!(snap.config.last_vault.as_deref(), Some("/tmp/vault"));
        }
    }

    /// 语义②：显式 `[]` ⇒ 没有用户规则来源（只剩内置规则）——与「缺键」是**两种不同的配置**，
    /// 不能混为一谈（前者是用户的显式选择，后者是没写过）。
    #[test]
    fn vault_rule_files_empty_list_means_no_user_rule_source() {
        let snap = load_from(&TempFile::new(r#"{"vault":{"rule_files":[]}}"#).0);
        assert!(snap.config.vault.rule_files.is_empty());
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
        assert_ne!(
            snap.config.vault.rule_files,
            AppConfig::default().vault.rule_files,
            "空列表必须与出厂默认区分开"
        );
    }

    /// 语义④：非法项**逐项**忽略并各给一条人话 warning，其余项照常生效，其余字段 MUST NOT
    /// 被回退默认值（ADR 0002 §5：一项笔误不该改掉别的设置）。
    #[test]
    fn vault_rule_files_invalid_items_are_dropped_one_by_one_with_warnings() {
        let raw = r#"{"last_vault":"/tmp/vault","vault":{"rule_files":["/etc/hosts","../outside","",42,".gitignore","sub/.rules"]}}"#;
        let snap = load_from(&TempFile::new(raw).0);
        assert_eq!(
            snap.config.vault.rule_files,
            vec![".gitignore".to_string(), "sub/.rules".to_string()],
            "非法项丢掉、合法项按原顺序保留"
        );
        assert_eq!(snap.warnings.len(), 4, "{:?}", snap.warnings);
        for (index, needle) in [
            (0, "绝对路径"),
            (1, "含 .."),
            (2, "为空"),
            (3, "不是字符串"),
        ] {
            assert!(
                snap.warnings[index].contains(needle),
                "第 {index} 条 warning 应点名 {needle}：{:?}",
                snap.warnings
            );
            assert!(
                snap.warnings[index].contains("vault.rule_files"),
                "{:?}",
                snap.warnings
            );
        }
        // 其余字段不回退
        assert_eq!(snap.config.last_vault.as_deref(), Some("/tmp/vault"));
        assert_eq!(snap.config.editor, EditorConfig::default());
    }

    /// 语义③的**磁盘面**在 fs_io 一侧（文件不存在 / 不是常规文件 ⇒ 静默跳过）；这里钉住
    /// 「配置层不因为一个不存在的路径而报错或告警」——路径存在性不是配置校验的事。
    #[test]
    fn vault_rule_files_nonexistent_paths_are_not_a_config_error() {
        let snap = load_from(&TempFile::new(r#"{"vault":{"rule_files":[".git/info/exclude"]}}"#).0);
        assert_eq!(
            snap.config.vault.rule_files,
            vec![".git/info/exclude".to_string()]
        );
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    /// 边界如实记录（与 `wrong_type_font_size_falls_back_entire_file` / `wrong_type_ui_theme_*`
    /// 同路）：`rule_files` **整体给错类型**（不是数组）在 serde 解析期失败 → 整文件回落。
    /// 逐项校验解决的是「一个元素非法」，不是「字段本身形状错」——后者是既有解析模型的性质，
    /// 本 change 不发明逐字段类型容忍（那会与 `editor.mode` 形成同类不同治）。
    #[test]
    fn wrong_type_vault_rule_files_falls_back_entire_file() {
        for raw in [
            r#"{"last_vault":"/tmp/vault","vault":{"rule_files":".gitignore"}}"#,
            r#"{"last_vault":"/tmp/vault","vault":{"rule_files":{"a":1}}}"#,
            r#"{"last_vault":"/tmp/vault","vault":"x"}"#,
        ] {
            let snap = load_from(&TempFile::new(raw).0);
            assert_eq!(snap.config, AppConfig::default(), "{raw} 应整份落回默认");
            assert_eq!(snap.config.last_vault, None, "{raw}");
            assert_eq!(snap.warnings.len(), 1, "{raw}: {:?}", snap.warnings);
            assert!(snap.warnings[0].contains("不是合法 JSON"), "{raw}");
        }
    }

    /// 合法配置不产生任何 warning：`[vault]` 与其它结构表同口径（写回产物必须是干净配置）。
    #[test]
    fn valid_vault_section_is_clean() {
        let snap = load_from(
            &TempFile::new(r#"{"vault":{"rule_files":[".gitignore","docs/.gitignore"]}}"#).0,
        );
        assert_eq!(
            snap.config.vault.rule_files,
            vec![".gitignore".to_string(), "docs/.gitignore".to_string()]
        );
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    // -----------------------------------------------------------------------
    // `[harness]` 表（change add-harness-probe §11，M301）
    // -----------------------------------------------------------------------

    /// 语义①：缺节 / 缺键 ⇒ 出厂默认（provider = kimi、loop_max = 50、warn_ctx_pct = 85、
    /// auto_compact = true、空规则表），且不产生任何 warning（与 `editor` / `ui` 同口径）。
    #[test]
    fn harness_missing_section_takes_factory_defaults() {
        for raw in [
            r#"{"version":1,"last_vault":"/tmp/vault"}"#,
            r#"{"version":1,"last_vault":"/tmp/vault","harness":{}}"#,
            r#"{"version":1,"last_vault":"/tmp/vault","harness":{"future":1}}"#,
        ] {
            let snap = load_from(&TempFile::new(raw).0);
            assert_eq!(snap.config.harness, HarnessConfig::default(), "{raw}");
            assert_eq!(snap.config.harness.provider, HarnessProvider::Kimi, "{raw}");
            assert_eq!(snap.config.harness.loop_max, 50, "{raw}");
            assert_eq!(snap.config.harness.warn_ctx_pct, 85.0, "{raw}");
            assert!(snap.config.harness.auto_compact, "{raw}");
            assert_eq!(
                snap.config.harness.providers.kimi.model, DEFAULT_KIMI_MODEL,
                "{raw}"
            );
            assert_eq!(
                snap.config.harness.providers.deepseek.model, DEFAULT_DEEPSEEK_MODEL,
                "{raw}"
            );
            assert!(
                snap.config.harness.providers.kimi.api_key.is_empty(),
                "{raw}"
            );
            assert!(
                snap.config.harness.providers.mock.fixture.is_none(),
                "{raw}"
            );
            assert!(snap.warnings.is_empty(), "{raw}: {:?}", snap.warnings);
        }
    }

    /// 退役值迁移（M365）：存 `kimi-k2` ⇒ 改写为现役默认 + 落盘，其余键（含未知字段、同一表
    /// 内别的键、其他 provider）逐键保留；再启动不重复触发（幂等）。
    #[test]
    fn harness_retired_kimi_model_is_migrated_and_persisted() {
        let f = TempFile::new(
            r#"{"version":1,"last_vault":"/tmp/vault","harness":{"providers":{"kimi":{"api_key":"sk-x","model":" kimi-k2 ","base_url":"https://k.example/v1"},"deepseek":{"model":"deepseek-v4-pro"}},"loop_max":4},"future_table":{"keep":true}}"#,
        );
        let snap = load_from(&f.0);
        // 本次生效值就是改写后的值
        assert_eq!(snap.config.harness.providers.kimi.model, DEFAULT_KIMI_MODEL);
        assert_eq!(snap.config.harness.loop_max, 4);
        assert!(
            snap.warnings
                .iter()
                .any(|w| w.contains(RETIRED_KIMI_MODEL) && w.contains(DEFAULT_KIMI_MODEL)),
            "{:?}",
            snap.warnings
        );

        // 落盘：只有 model 变了，其余键逐键保留（含未知字段）
        let persisted: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&f.0).expect("读回配置"))
                .expect("配置仍是合法 JSON");
        assert_eq!(
            persisted["harness"]["providers"]["kimi"]["model"],
            DEFAULT_KIMI_MODEL
        );
        assert_eq!(persisted["harness"]["providers"]["kimi"]["api_key"], "sk-x");
        assert_eq!(
            persisted["harness"]["providers"]["kimi"]["base_url"],
            "https://k.example/v1"
        );
        assert_eq!(
            persisted["harness"]["providers"]["deepseek"]["model"],
            "deepseek-v4-pro"
        );
        assert_eq!(persisted["harness"]["loop_max"], 4);
        assert_eq!(persisted["future_table"]["keep"], true);
        assert_eq!(persisted["last_vault"], "/tmp/vault");

        // 幂等：把文件改成「改写后 + 一点格式差异」，再加载应逐字节未动（判据是「没有第二次写」，
        // 不是「内容碰巧一样」）
        let rewritten = format!("{}\n", std::fs::read_to_string(&f.0).expect("读回配置"));
        std::fs::write(&f.0, &rewritten).expect("写入探针配置");
        let again = load_from(&f.0);
        assert_eq!(
            again.config.harness.providers.kimi.model,
            DEFAULT_KIMI_MODEL
        );
        assert_eq!(
            std::fs::read_to_string(&f.0).expect("读回配置"),
            rewritten,
            "第二次加载不应再写文件"
        );
        assert!(
            !again
                .warnings
                .iter()
                .any(|w| w.contains(RETIRED_KIMI_MODEL)),
            "{:?}",
            again.warnings
        );
    }

    /// 迁移的边界（M365）：只认 `kimi-k2` 这一个本仓写出过的退役值——现役 id、同样已退役但
    /// 我们从没写出过的 id（如 `kimi-k2.5`）、用户手填的任意 id 都原样保留、不写文件、不告警。
    #[test]
    fn harness_other_kimi_model_values_are_left_alone() {
        assert_ne!(DEFAULT_KIMI_MODEL, RETIRED_KIMI_MODEL);
        for stored in [
            "kimi-k2.6",
            "kimi-k2.7-code",
            "kimi-k2.5",
            "my-router/model-x",
        ] {
            let raw = format!(r#"{{"harness":{{"providers":{{"kimi":{{"model":"{stored}"}}}}}}}}"#);
            let f = TempFile::new(&raw);
            let snap = load_from(&f.0);
            assert_eq!(snap.config.harness.providers.kimi.model, stored);
            assert_eq!(
                std::fs::read_to_string(&f.0).expect("读回配置"),
                raw,
                "{stored} 不应被改写"
            );
            assert!(
                snap.warnings
                    .iter()
                    .all(|w| !w.contains(RETIRED_KIMI_MODEL)),
                "{stored}: {:?}",
                snap.warnings
            );
        }
    }

    /// 闭集合取值非法 ⇒ 只回退该字段 + 人话 warning，其余字段（含 last_vault）不受影响。
    #[test]
    fn harness_illegal_provider_warns_and_falls_back() {
        let f = TempFile::new(
            r#"{"last_vault":"/tmp/vault","harness":{"provider":"openai","loop_max":3}}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(snap.config.harness.provider, HarnessProvider::Kimi);
        assert_eq!(snap.config.harness.loop_max, 3, "合法字段不回退");
        assert_eq!(snap.config.last_vault.as_deref(), Some("/tmp/vault"));
        assert_eq!(snap.warnings.len(), 1, "{:?}", snap.warnings);
        assert!(
            snap.warnings[0].contains("harness.provider"),
            "{:?}",
            snap.warnings
        );
        assert!(snap.warnings[0].contains("openai"), "{:?}", snap.warnings);
    }

    /// 闭集合三档都能被读到（写回产物必须是干净配置）。
    #[test]
    fn harness_provider_accepts_closed_set() {
        for (raw, expected) in [
            ("kimi", HarnessProvider::Kimi),
            ("deepseek", HarnessProvider::Deepseek),
            ("mock", HarnessProvider::Mock),
        ] {
            let f = TempFile::new(&format!(r#"{{"harness":{{"provider":"{raw}"}}}}"#));
            let snap = load_from(&f.0);
            assert_eq!(snap.config.harness.provider, expected, "{raw}");
            assert!(snap.warnings.is_empty(), "{raw}: {:?}", snap.warnings);
        }
    }

    /// 完整合法配置：三档 provider 参数、规则表、三个标量都按写值读到，零 warning。
    #[test]
    fn harness_full_section_round_trips() {
        let raw = r#"{
            "last_vault": "/tmp/vault",
            "harness": {
                "provider": "deepseek",
                "providers": {
                    "kimi": {"api_key": "sk-kimi", "model": "kimi-custom", "base_url": "https://k.example/v1"},
                    "deepseek": {"api_key": "sk-deep"},
                    "mock": {"fixture": "/tmp/fixture.json"}
                },
                "permissions": {"allow": ["cli(ls *)", "vault_patch"], "deny": ["cli(rm *)"]},
                "loop_max": 4,
                "warn_ctx_pct": 70,
                "auto_compact": false
            }
        }"#;
        let snap = load_from(&TempFile::new(raw).0);
        let harness = &snap.config.harness;
        assert_eq!(harness.provider, HarnessProvider::Deepseek);
        assert_eq!(harness.providers.kimi.api_key, "sk-kimi");
        assert_eq!(harness.providers.kimi.model, "kimi-custom");
        assert_eq!(
            harness.providers.kimi.base_url.as_deref(),
            Some("https://k.example/v1")
        );
        assert_eq!(harness.providers.deepseek.api_key, "sk-deep");
        assert_eq!(harness.providers.deepseek.model, DEFAULT_DEEPSEEK_MODEL);
        assert!(harness.providers.deepseek.base_url.is_none());
        assert_eq!(
            harness.providers.mock.fixture.as_deref(),
            Some("/tmp/fixture.json")
        );
        assert_eq!(harness.permissions.allow, vec!["cli(ls *)", "vault_patch"]);
        assert_eq!(harness.permissions.deny, vec!["cli(rm *)"]);
        assert_eq!(harness.loop_max, 4);
        assert_eq!(harness.warn_ctx_pct, 70.0);
        assert!(!harness.auto_compact);
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    /// 数值字段越界 ⇒ 回落默认 + warning；区间端点在界内（照 `font_size` / `content_width` 模板）。
    #[test]
    fn harness_numeric_ranges_fall_back_and_endpoints_hold() {
        for (raw, loop_max) in [
            (r#"{"harness":{"loop_max":0}}"#, 50),
            (r#"{"harness":{"loop_max":999}}"#, 50),
            (r#"{"harness":{"loop_max":1}}"#, 1),
            (r#"{"harness":{"loop_max":64}}"#, 64),
        ] {
            let snap = load_from(&TempFile::new(raw).0);
            assert_eq!(snap.config.harness.loop_max, loop_max, "{raw}");
            let expect_warning = loop_max == 50 && raw.contains("loop_max");
            assert_eq!(
                snap.warnings.len(),
                usize::from(expect_warning),
                "{raw}: {:?}",
                snap.warnings
            );
        }
        for (raw, pct, warn) in [
            (r#"{"harness":{"warn_ctx_pct":0}}"#, 85.0, true),
            (r#"{"harness":{"warn_ctx_pct":101}}"#, 85.0, true),
            (r#"{"harness":{"warn_ctx_pct":1}}"#, 1.0, false),
            (r#"{"harness":{"warn_ctx_pct":100}}"#, 100.0, false),
            (r#"{"harness":{"warn_ctx_pct":42.5}}"#, 42.5, false),
        ] {
            let snap = load_from(&TempFile::new(raw).0);
            assert_eq!(snap.config.harness.warn_ctx_pct, pct, "{raw}");
            assert_eq!(
                snap.warnings.len(),
                usize::from(warn),
                "{raw}: {:?}",
                snap.warnings
            );
        }
    }

    /// 空串的三种口径：`api_key` 空 = 未配置（不告警）；`model` / `base_url` / `mock.fixture`
    /// 空 = 显式的空值输入，回落 + warning（见模块头）。
    #[test]
    fn harness_blank_strings_fall_back_with_documented_warnings() {
        let raw = r#"{"harness":{"providers":{
            "kimi":{"api_key":"  ","model":"","base_url":""},
            "mock":{"fixture":"   "}}}}"#;
        let snap = load_from(&TempFile::new(raw).0);
        assert!(snap.config.harness.providers.kimi.api_key.is_empty());
        assert_eq!(snap.config.harness.providers.kimi.model, DEFAULT_KIMI_MODEL);
        assert!(snap.config.harness.providers.kimi.base_url.is_none());
        assert!(snap.config.harness.providers.mock.fixture.is_none());
        // 三条 warning（model / base_url / fixture），api_key 不产生 warning
        assert_eq!(snap.warnings.len(), 3, "{:?}", snap.warnings);
        for needle in [
            "harness.providers.kimi.model",
            "harness.providers.kimi.base_url",
            "harness.providers.mock.fixture",
        ] {
            assert!(
                snap.warnings.iter().any(|w| w.contains(needle)),
                "缺少 {needle} 的 warning：{:?}",
                snap.warnings
            );
        }
    }

    /// 规则清单**逐项**校验：非字符串 / 空串（含纯空白）逐项丢弃并各给一条 warning，其余项
    /// 按原顺序保留（前后空白去掉）；`deny` 与其余字段不受影响。
    #[test]
    fn harness_permission_rules_drop_invalid_items_one_by_one() {
        let raw = r#"{"last_vault":"/tmp/vault","harness":{"permissions":{
            "allow":["cli(ls *)","",42,"   ","vault_patch","  cli(demo *)  "],
            "deny":[null,"cli(rm *)"]}}}"#;
        let snap = load_from(&TempFile::new(raw).0);
        assert_eq!(
            snap.config.harness.permissions.allow,
            vec!["cli(ls *)", "vault_patch", "cli(demo *)"]
        );
        assert_eq!(snap.config.harness.permissions.deny, vec!["cli(rm *)"]);
        // 4 条 warning：allow 的第 2 / 3 / 4 项 + deny 的第 1 项
        assert_eq!(snap.warnings.len(), 4, "{:?}", snap.warnings);
        assert!(
            snap.warnings
                .iter()
                .all(|w| w.contains("harness.permissions")),
            "{:?}",
            snap.warnings
        );
        // 其余字段不回退
        assert_eq!(snap.config.last_vault.as_deref(), Some("/tmp/vault"));
        assert_eq!(snap.config.editor, EditorConfig::default());
    }

    /// 边界如实记录（与 `wrong_type_vault_rule_files_*` / `wrong_type_font_size_*` 同路）：
    /// `[harness]` 表**整体**给错类型、或表内标量给错类型（`"loop_max": "50"`），都在 serde
    /// 解析期失败 → 整文件回落（连 `last_vault` 一起丢）。逐项校验解决的是「一个元素非法」，
    /// 不是「字段本身形状错」——后者是既有解析模型的性质，不发明逐字段类型容忍。
    #[test]
    fn harness_wrong_types_fall_back_entire_file() {
        for raw in [
            r#"{"last_vault":"/tmp/vault","harness":"kimi"}"#,
            r#"{"last_vault":"/tmp/vault","harness":42}"#,
            r#"{"last_vault":"/tmp/vault","harness":{"provider":2}}"#,
            r#"{"last_vault":"/tmp/vault","harness":{"loop_max":"50"}}"#,
            r#"{"last_vault":"/tmp/vault","harness":{"warn_ctx_pct":"85"}}"#,
            r#"{"last_vault":"/tmp/vault","harness":{"auto_compact":"yes"}}"#,
            r#"{"last_vault":"/tmp/vault","harness":{"providers":"kimi"}}"#,
            r#"{"last_vault":"/tmp/vault","harness":{"providers":{"kimi":{"api_key":1}}}}"#,
            r#"{"last_vault":"/tmp/vault","harness":{"permissions":{"allow":"cli(ls)"}}}"#,
        ] {
            let snap = load_from(&TempFile::new(raw).0);
            assert_eq!(snap.config, AppConfig::default(), "{raw} 应整份落回默认");
            assert_eq!(snap.config.last_vault, None, "{raw}");
            assert_eq!(snap.warnings.len(), 1, "{raw}: {:?}", snap.warnings);
            assert!(snap.warnings[0].contains("不是合法 JSON"), "{raw}");
        }
    }

    /// 显式 `false` / 缺键两种配置的差别要能被分辨：`auto_compact` 缺键 = 出厂 `true`，
    /// 显式 `false` 必须原样读到（否则用户关不掉自动压缩）。
    #[test]
    fn harness_auto_compact_explicit_false_is_kept() {
        let snap = load_from(&TempFile::new(r#"{"harness":{"auto_compact":false}}"#).0);
        assert!(!snap.config.harness.auto_compact);
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    // -----------------------------------------------------------------------
    // `[harness].providers.<id>.models` 模型维度（M373）：preset 缺省、用户覆盖、
    // 逐项校验、窗口 / 能力读取（替代 llm.rs 窗口表与 thinking.rs 词元判定）。
    // -----------------------------------------------------------------------

    /// 缺省 = 内置 preset，不告警；单 model 配置形态（无 models 键）逐字生效——
    /// Alex 现有的 `"model": "k3-256k"` 配置零迁移。
    #[test]
    fn harness_models_default_to_builtin_presets() {
        // 完全缺省。
        let snap = load_from(&TempFile::new(r#"{"harness":{}}"#).0);
        let harness = &snap.config.harness;
        assert_eq!(
            harness.providers.kimi.models,
            vec![
                HarnessModelSpec {
                    id: "kimi-k3".into(),
                    effort: true,
                    window: 1_048_576
                },
                HarnessModelSpec {
                    id: "kimi-k2.7-code".into(),
                    effort: false,
                    window: 262_144
                },
                HarnessModelSpec {
                    id: "kimi-k2.7-code-highspeed".into(),
                    effort: false,
                    window: 262_144
                },
                HarnessModelSpec {
                    id: "kimi-k2.6".into(),
                    effort: false,
                    window: 262_144
                },
                HarnessModelSpec {
                    id: "k3-256k".into(),
                    effort: true,
                    window: 262_144
                },
            ]
        );
        assert_eq!(
            harness.providers.deepseek.models,
            vec![
                HarnessModelSpec {
                    id: "deepseek-flash".into(),
                    effort: true,
                    window: 1_048_576
                },
                HarnessModelSpec {
                    id: "deepseek-v4-pro".into(),
                    effort: true,
                    window: 1_048_576
                },
            ]
        );
        assert!(harness.model_specs(&HarnessProvider::Mock).is_empty());
        // 单 model 配置形态：model 键照旧，models 缺省 → preset 兜底。
        let snap = load_from(
            &TempFile::new(
                r#"{"harness":{"providers":{"kimi":{"model":"k3-256k","api_key":"sk-x"}}}}"#,
            )
            .0,
        );
        assert_eq!(snap.config.harness.providers.kimi.model, "k3-256k");
        assert_eq!(snap.config.harness.providers.kimi.models.len(), 5);
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    /// 用户显式声明 models → 整体覆盖 preset（含空列表——显式清空是用户的合法选择）；
    /// 窗口与 effort 从声明值读取。
    #[test]
    fn harness_models_user_override_replaces_preset() {
        let snap = load_from(
            &TempFile::new(
                r#"{"harness":{"providers":{"kimi":{"models":[{"id":"my-model","effort":false,"window":32768}]}}}}"#,
            )
            .0,
        );
        let kimi = &snap.config.harness.providers.kimi;
        assert_eq!(
            kimi.models,
            vec![HarnessModelSpec {
                id: "my-model".into(),
                effort: false,
                window: 32_768
            }]
        );
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
        // 显式空列表 = 没有可选模型（与缺键的 preset 兜底是两种配置）。
        let snap =
            load_from(&TempFile::new(r#"{"harness":{"providers":{"kimi":{"models":[]}}}}"#).0);
        assert!(snap.config.harness.providers.kimi.models.is_empty());
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    /// 逐项校验（与 permissions 同形）：坏项只丢自己 + warning，合法项照常生效；
    /// 缺 effort / window 的子键回落保守默认 + warning。
    #[test]
    fn harness_models_invalid_items_dropped_one_by_one() {
        let raw = r#"{"harness":{"providers":{"kimi":{"models":[
            {"id":"ok","effort":true,"window":262144},
            "not-an-object",
            {"effort":true,"window":100},
            {"id":"","effort":true,"window":100},
            {"id":"bad-effort","effort":"yes","window":100},
            {"id":"bad-window","effort":true,"window":"262144"},
            {"id":"zero-window","effort":true,"window":0},
            {"id":"huge-window","effort":true,"window":99999999},
            {"id":"ok","effort":false,"window":1000},
            {"id":"defaults-missing"}
        ]}}}}"#;
        let snap = load_from(&TempFile::new(raw).0);
        let models = &snap.config.harness.providers.kimi.models;
        assert_eq!(
            models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            vec!["ok", "defaults-missing"],
            "合法项（首个 ok + defaults-missing）保留，重复 id 的重项丢弃"
        );
        assert!(models[0].effort && models[0].window == 262_144);
        // defaults-missing：effort 回落 false、window 回落保守默认。
        assert!(!models[1].effort);
        assert_eq!(models[1].window, FALLBACK_CONTEXT_WINDOW);
        // warning 逐条点名（不是对象 / 缺 id / 空 id / effort 类型 / window 类型 / 0 窗 / 超大窗 / 重复）。
        for needle in [
            "不是对象",
            "缺少 id",
            "id 为空",
            "effort 应为布尔值",
            "window 应为",
            "重复",
        ] {
            assert!(
                snap.warnings.iter().any(|w| w.contains(needle)),
                "缺少点名 {needle} 的 warning：{:?}",
                snap.warnings
            );
        }
        // 清单整体错形状（不是数组）仍走 serde 解析期失败 → 整文件回落（逐项容忍的边界，
        // 与 vault.rule_files  precedent 同）。
        let snap = load_from(
            &TempFile::new(r#"{"harness":{"providers":{"kimi":{"models":"kimi-k3"}}}}"#).0,
        );
        assert_eq!(snap.config, AppConfig::default());
        assert_eq!(snap.warnings.len(), 1);
    }

    /// schema 读取点：窗口查表（未列出回落保守默认）与 effort 能力判定
    /// （未列出 = 不支持；mock 恒定支持）。
    #[test]
    fn harness_context_window_and_effort_read_from_schema() {
        let snap = load_from(&TempFile::new(r#"{"harness":{}}"#).0);
        let harness = &snap.config.harness;
        // 窗口：表内精确匹配。
        assert_eq!(
            harness.context_window(&HarnessProvider::Kimi, "kimi-k3"),
            1_048_576
        );
        assert_eq!(
            harness.context_window(&HarnessProvider::Kimi, "k3-256k"),
            262_144
        );
        assert_eq!(
            harness.context_window(&HarnessProvider::Deepseek, "deepseek-flash"),
            1_048_576
        );
        // 未列出（退役 id / 用户自填未知模型）→ 保守默认 131_072。
        assert_eq!(
            harness.context_window(&HarnessProvider::Kimi, "kimi-k2"),
            FALLBACK_CONTEXT_WINDOW
        );
        assert_eq!(
            harness.context_window(&HarnessProvider::Kimi, "whatever"),
            FALLBACK_CONTEXT_WINDOW
        );
        // effort：声明值。
        assert!(harness.effort_supported(&HarnessProvider::Kimi, "kimi-k3"));
        assert!(harness.effort_supported(&HarnessProvider::Kimi, "k3-256k"));
        assert!(!harness.effort_supported(&HarnessProvider::Kimi, "kimi-k2.6"));
        assert!(!harness.effort_supported(&HarnessProvider::Kimi, "kimi-k2"));
        // 前缀不宽容：kimi-k30 不在清单内 ⇒ 不支持（与 M372 词元判定退役后的口径一致）。
        assert!(!harness.effort_supported(&HarnessProvider::Kimi, "kimi-k30"));
        assert!(harness.effort_supported(&HarnessProvider::Deepseek, "deepseek-v4-pro"));
        // 出厂默认模型必须可用——它是 harness 的首次会话形态，灰了就没人能动档位。
        assert!(harness.effort_supported(&HarnessProvider::Kimi, DEFAULT_KIMI_MODEL));
        assert!(harness.effort_supported(&HarnessProvider::Deepseek, DEFAULT_DEEPSEEK_MODEL));
        // mock：恒定支持（fixture 驱动，验收断言档位到达请求）；模型维度空表。
        assert!(harness.effort_supported(&HarnessProvider::Mock, "whatever"));
        assert_eq!(
            harness.context_window(&HarnessProvider::Mock, "whatever"),
            FALLBACK_CONTEXT_WINDOW
        );
        // 用户覆盖后读取点跟着覆盖走。
        let snap = load_from(
            &TempFile::new(
                r#"{"harness":{"providers":{"deepseek":{"models":[{"id":"deepseek-x","effort":false,"window":131072}]}}}}"#,
            )
            .0,
        );
        let harness = &snap.config.harness;
        assert_eq!(
            harness.context_window(&HarnessProvider::Deepseek, "deepseek-x"),
            131_072
        );
        assert!(!harness.effort_supported(&HarnessProvider::Deepseek, "deepseek-x"));
        assert!(!harness.effort_supported(&HarnessProvider::Deepseek, "deepseek-flash"));
    }
}
