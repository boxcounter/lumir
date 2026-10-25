//! 配置加载 —— M1 基础（ADR 0002 §5，架构复查 P2-6）。
//!
//! - 路径：macOS/Linux 遵循 `$XDG_CONFIG_HOME`（默认 `~/.config/lumir`），
//!   Windows 用 `%APPDATA%\lumir`，不采用 `~/Library/Application Support`
//!   （ADR 0002 §5 已定：配置需人可读可改，遵循 dotfile 生态惯例）。
//! - 校验：逐字段校验，非法值落回该字段默认值并附人话 warning；
//!   整文件不是合法 JSON 时才整体落回默认配置。
//! - 未知字段忽略（向前兼容：新版写入的字段旧版读取不报错）。
//! - 装载期的**写**副作用只有一次性迁移，两条串在同一份 JSON 上、最多写盘一次（都幂等、
//!   都只改自己负责的键、其余键与未知字段逐键保留）：
//!   ① `harness.providers` 的旧条目（`kimi` / `deepseek` / `mock`）缺 `preset` 时补齐
//!   （change add-model-automation-settings-oct24 §3.1，显式值不覆盖、未知 id 不迁移）；
//!   ② `harness.providers.kimi.model` 命中 [`RETIRED_KIMI_MODEL`] 时改写为该条目**已声明
//!   models 清单的首项 id**（M365，M381 改目标；模型名一律来自配置，不内置替补值）。
//!   写失败只多一条 warning、不阻断加载（本次生效值已按改写后的形态给出，下次加载再试）。
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
//! `"sidebar_width": 236, "markdown_line_numbers": "on-demand" | "always" | "off",` +
//! `"language": "en" | "zh"}}`，默认 `light` / `760` / `236` / `on-demand` / `en`。取值校验照 `editor.mode`
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
//! `{"harness": {"provider": "<provider id>", "providers": {…},` +
//! `"permissions": {"allow": [], "deny": []}, "permission_mode": "vault_write",` +
//! `"loop_max": 50, "warn_ctx_pct": 85, "auto_compact": true}}`——对话运行时（harness）的配置面，
//! 取值模板与 `editor` / `ui` 同路：表内字段缺失 → 默认（不告警）；闭集合取值非法 → 回落
//! 默认 + 人话 warning（ADR 0002 §5：非法配置不导致启动失败）；表内字段**类型不符**
//! （`"loop_max": "50"`）与整表错形状（`"harness": "kimi"`）都在 serde 解析期失败 →
//! **整文件回落**（与 `editor.font_size` / `ui.content_width` 同路，不发明逐字段类型容忍）。
//!
//! `provider` 是 **active provider id**，`providers` 是**以稳定 id 为键的映射**（change
//! add-model-automation-settings-oct24 §2.1）：条目的协议行为由自己的 `preset`
//! （`kimi` / `deepseek` / `generic` / `mock`）决定，**不由 id 猜**；id 创建后不可改。
//! 条目级宽容：单个条目形状非法只丢该条 + 点名 warning，MUST NOT 拖垮整份配置（`providers`
//! 整键不是对象才走整文件回落）。active 解析 / 默认回退见 [`resolve_active_provider`]：
//! 显式优先（未配置也不换）→ 第一个 configured → 预设顺序 → 空；`mock` 不参与缺省回退。
//!
//! `permissions.allow` / `deny` 是**逐项**校验的例外（与 `vault.rule_files` 同形）：清单元素
//! 收成 `serde_json::Value` 再逐项判定，非法项丢弃并各给一条 warning，其余项照常生效——一项
//! 笔误不该让整份配置（含 `last_vault`）回退默认。规则**语义**（`tool(模式)` 的匹配）不在
//! 这里判定：那是 harness 运行时的知识（M302），配置层只管形状（「形状在此、语义在外」的既有
//! 分层，与 `keys` 表同口径）。
//!
//! `api_key` 明文（Alex 裁决点 2）：自用探针期威胁模型低（单机、本人），配置即数据要求人可读
//! 可改；Revisit 点（任何对外发布动作前改系统钥匙串）记在 ADR 0007 的出域口径里。
//! 空 `api_key` = 未配置（出厂状态），不是笔误，因此**不告警**（generic 预设还允许它为空 =
//! 不发 `Authorization` 头）；`model` / `base_url` / `fixture` 的空串是显式的空值输入，
//! 回落默认 + warning。
//!
//! M373 起 `[harness].providers.<id>` 暴露 **model 维度**：`models` 清单逐项 =
//! `{ "id": "k3-256k", "effort": true, "vision": true, "window": 262144 }`（effort = 是否支持
//! 思考程度调节、vision = 是否接受图片输入、window = 上下文窗口 tokens）。M381 起（Alex 终裁 2026-10-07「只显示配置里写的模型。
//! 彻底不使用内置表」）模型清单、逐模型 effort 能力、上下文窗口**严格只来自配置声明**——
//! 内置 preset 表（KIMI_MODEL_PRESET / DEEPSEEK_MODEL_PRESET）与出厂模型常量
//! （DEFAULT_KIMI_MODEL / DEFAULT_DEEPSEEK_MODEL）全部退役，缺省不再回落任何内置清单，
//! 配置里没写就是空清单 + 人话 warning + 前端提示态。逐项校验与 permissions 同形
//! （一项写坏只丢该项 + warning）。当前生效 model 的解析（同级的 `model` 键）：显式值照实
//! 生效（不在清单内 → warning，窗口按 [`FALLBACK_CONTEXT_WINDOW`] 保守估算）；缺省 / 空串 →
//! 声明清单首项 id；清单为空 → 空串（不伪造，发送时由运行时给出人话错误）。能力的唯一真源
//! 从此在 schema：llm.rs 的窗口表与 thinking.rs 的 k3 词元判定退役为这里的读取。
//!
//! 会话自动命名（change add-session-auto-naming）的配置面是 `[harness].session_naming` 表：
//! `enabled`（bool，默认 `true`，关闭后不发起任何命名调用）、`provider`（可选 provider id，
//! 缺省 = 会话当前 provider；不在 `providers` 映射内的 id 回落缺省 + 人话 warning）与
//! `model`（可选模型，
//! 须在**选定 provider** 的 `models` 清单内声明，未声明回落该 provider 的生效模型 + warning；
//! mock 是 fixture 驱动档，没有模型清单，该键只能是 null）。**2026-10-18 配置面重塑**：原
//! `auto_title` / `title_provider` / `providers.<id>.title_model` 三处旧键已废除，按未知键口径
//! 静默忽略、无兼容读取；布局判据与 `attachment_naming` 共用（配置跟随资源域，见
//! `docs/specs/config-reference.md` §1.6）。命名调用的五字段（provider / model / wire 方言 /
//! `api_key` / `base_url`）**只由 [`HarnessConfig::title_target`] 一处解析**——设计不变量 8：
//! MUST NOT 混用会话 provider 与 title provider 的字段，也不许调用方各自挑一套。
//!
//! ## cron 表（change add-cron-runtime-daemon）
//!
//! `{"cron": {"tasks": [{…}]}}`：定时任务的配置面（键表与非法口径见
//! `docs/specs/config-reference.md` §1.8；语义真源是该 change 的 design §7）。任务只表达
//! 「调度 + 自然语言 prompt + 会话形态 + 触达策略 + 可选模型覆盖」——本模块**不认识**任务要
//! 做什么：路径、小节标题、完成条件都不在配置面，也不在实现代码里（design §2「机制不知道的事」）。
//!
//! 解析形态照 `harness.permissions` / `vault.rule_files` 的逐项先例：`tasks` 收成
//! `Vec<serde_json::Value>` 再**逐项**校验，坏一项只丢该项 + 一条人话 warning（`delivery` /
//! `session` 回落缺省并保留任务，`model` 只丢该键）；整表错形状（`"cron": "wrong-shape"`）或
//! `tasks` 非数组在 serde 解析期失败 → 整文件回落（既有解析模型，不发明逐字段类型容忍）。
//!
//! 被丢弃的任务项同时产出结构化 [`CronTaskIssue`]（warning 给人读，issue 供调度线程在**启动
//! 装载**那一次落 `cron_task_invalid` 诊断事件）。事件不在本模块发：配置在进程内会被读多次
//! （启动恢复、前端 `config_get`），只有 `lumir-cron` 线程的首次装载是「装载期」。
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
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
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
    /// vault 行为配置（change vault-open-ignore-set 的 r6 + change ignore-tiers-map）：`[vault]` 表。
    pub vault: VaultConfig,
    /// 对话运行时配置（change add-harness-probe §11）：`[harness]` 表。消费方是 harness
    /// 运行时（M302）：会话建立时读一次 provider 参数、权限规则表与循环上限。
    pub harness: HarnessConfig,
    /// 定时任务（change add-cron-runtime-daemon）：`[cron]` 表。消费方是 `lumir-cron`
    /// 守护线程——启动时装载一次；运行期只经**注册通道**（`cron_task_*` 工具写完配置后投递的
    /// 重载工作项，change add-cron-conversational-registration）重载任务集。**文件变化本身不触发
    /// 重读**（不做文件监听）；该次重载读的是文件当下内容，先前未重启生效的手改可能被一并吸收。
    pub cron: CronConfig,
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
            cron: CronConfig::default(),
        }
    }
}

/// 用户忽略规则的来源清单（`[vault]` 表的默认值，change vault-open-ignore-set §2.9）。
///
/// **两条默认值合起来 = 今日行为**：`<root>/.gitignore`（含递归途中的嵌套 `.gitignore`）与
/// `<root>/.git/info/exclude`（仅当 `.git` 是目录）。顺序即声明顺序；真正的优先级由
/// `fs_io::IgnorePolicy` 按 git 口径定（深层 `.gitignore` > 浅层 > `info/exclude`）。
pub const DEFAULT_RULE_FILES: [&str; 2] = [".gitignore", ".git/info/exclude"];

/// 忽略档位（change ignore-tiers-map）：档位是**值**，名字是地图的键。
///
/// 两档的语义与 change ignore-tiers-config 一致：`Hidden` ⇒ 不可见（不进树、不进 watch、
/// 不进索引，子树不枚举）；`Lazy` ⇒ 惰性可见（树里一行、按需展开、不进索引）。`Hidden` 比
/// `Lazy` 更严格（前者具备后者的全部效用）——这条关系由判定链表达，配置面只写名字自己的档位。
///
/// **不实现 `Deserialize`**：配置解析走 `serde_json::Value` 逐项校验（非法档位值落 warning、
/// 只丢该项）；让 serde 直接反序列化会把一个错值升级成整文件回落。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum IgnoreTier {
    /// 不显示档：命中 ⇒ 不进树、不进 watch、不进索引。
    Hidden,
    /// 惰性档：命中 ⇒ 树里一行、按需展开、不进索引。
    Lazy,
}

/// 忽略地图的内置默认（change ignore-tiers-map）：名字 → 档位。
///
/// **14 名全在这张表里，档位写在名字自己身上**——旧的 `hidden` / `lazy` 两个默认常量（把档位
/// 编码进常量名）随单键地图退役，默认值只留这一处（REVIEW.md「同一语义两处真源」条）。
/// 名单与 change ignore-tiers-config 的默认逐名等价：`.git` / `.DS_Store` 不可见，其余 12 名
/// 惰性可见；`build` / `out` / `vendor` 经 Alex 2026-09-28 裁决仍不纳入。
/// `test-results` / `perf-results` 经 Alex 2026-10-18 裁决从默认表移除（change
/// trim-ignore-default-names）：它们是本仓自己的产物目录，不是用户 vault 的通用形态，
/// 留在通用默认里属于替用户猜。
///
/// 这是**配置的缺省值**，不是安装快照：`config.json` 里没写 `[vault].ignore` 时用整张表，
/// 写了（含 `{}`）则整图按配置解释（ADR 0002 §5 / proposal「缺省即默认」）。
pub const DEFAULT_IGNORE: [(&str, IgnoreTier); 14] = [
    (".git", IgnoreTier::Hidden),
    (".DS_Store", IgnoreTier::Hidden),
    ("node_modules", IgnoreTier::Lazy),
    (".venv", IgnoreTier::Lazy),
    ("venv", IgnoreTier::Lazy),
    ("__pycache__", IgnoreTier::Lazy),
    (".next", IgnoreTier::Lazy),
    (".nuxt", IgnoreTier::Lazy),
    (".cache", IgnoreTier::Lazy),
    (".pnpm-store", IgnoreTier::Lazy),
    (".tox", IgnoreTier::Lazy),
    (".gradle", IgnoreTier::Lazy),
    ("target", IgnoreTier::Lazy),
    ("dist", IgnoreTier::Lazy),
];

/// `[vault]` 表：忽略规则表的配置面（change vault-open-ignore-set 的 r6 + change
/// ignore-tiers-map）。
///
/// 两个字段都只在**唯一消费者** `commands::prepare_vault_open` 构造 `fs_io::IgnorePolicy`
/// 时被读取；`config_get` 只是把它们原样交给前端展示（REVIEW.md「声明了却没有消费者」条）。
/// 生效时点是 **vault 装载时**（每次装载现场读一次配置，MUST NOT 用启动期缓存钉住），
/// 改动下次装载生效。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct VaultConfig {
    /// 用户规则的来源清单：每个值是**vault 相对路径**，一律按「vault 根的规则文件」解释
    ///（模式相对 vault 根匹配，MUST NOT 被当成「相对该文件所在目录」的规则）。
    ///
    /// - **空列表 = 没有用户规则来源**：只剩忽略地图的两档（= 非 git vault 的等价行为）。
    ///   这是彻底的——列表里不含 `.gitignore` 时，递归途中的嵌套 `.gitignore` 同样不读（嵌套
    ///   逐层读取是「`.gitignore` 这个来源」的固有语义，不是第二个配置面）。
    /// - 文件不存在 / 不是常规文件 ⇒ 静默跳过（`.git/info/exclude` 在非 git vault 里本来就
    ///   不存在，这是常态而不是异常）。
    /// - 非法项（非字符串 / 绝对路径 / 含 `..` / 空串）逐项忽略并各给一条人话 warning，
    ///   其余项照常生效——MUST NOT 因为一项非法而把整份配置（含别的字段）回退默认值。
    pub rule_files: Vec<String>,
    /// 忽略地图（change ignore-tiers-map）：**名字 → 档位**。
    ///
    /// **缺省即默认（粒度是整图）**：本键缺席 ⇒ [`DEFAULT_IGNORE`]；存在（含 `{}`）⇒ 整图按
    /// 配置解释。名字是**名字**不是模式；档位值是闭集合 `"hidden"` / `"lazy"`（校验见
    /// `validate_ignore_map`）。不在图里的名字 ⇒ 走用户规则 / 完全可见（这就是「第三档」，
    /// 没有第三个键，也没有 `"visible"` 档位值）。
    ///
    /// 一个名字只有一个档位（对象键唯一），因此没有「同名冲突」这个类别。保存临时文件模式
    /// （`.lumir-*` / `.*.lumir-*`）恒定硬编码、不在此图内——那是数据损坏面。
    pub ignore: BTreeMap<String, IgnoreTier>,
}

impl Default for VaultConfig {
    fn default() -> Self {
        Self {
            rule_files: DEFAULT_RULE_FILES.iter().map(|s| s.to_string()).collect(),
            ignore: DEFAULT_IGNORE
                .iter()
                .map(|(name, tier)| ((*name).to_string(), *tier))
                .collect(),
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
/// 默认口径的计算属性断言），改一处必须同步其余两处（REVIEW.md 「同一语义两处真源」条）。
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
/// 各有断言钉住，改一处必须同步其余两处（REVIEW.md 「同一语义两处真源」条）。
pub const DEFAULT_CONTENT_WIDTH: f64 = 760.0;

/// 栏宽合法区间（含端点，D2 落槌 [760, 1200]——**默认值即下限**，拖拽只能往宽调）：
/// 与前端拖拽钳制区间同值（`src/content-width.ts` 的 `CONTENT_WIDTH_MIN` /
/// `CONTENT_WIDTH_MAX`）。区间外一律回落默认值 + warning。
pub const CONTENT_WIDTH_MIN: f64 = 760.0;
pub const CONTENT_WIDTH_MAX: f64 = 1200.0;

/// 侧栏宽度默认（px，change add-sidebar-resize-hide-and-root-create 的 D1 裁决 2026-10-23：
/// 默认 236、合法区间 `[180, 480]`）。默认值刻意不动（视觉基线与标题栏 traffic 区宽都按它
/// 钉住），宽度是用户拉出来的。
///
/// 三处同语义写值：本常量（配置面的真源）、`src/sidebar-width.ts` 的 `DEFAULT_SIDEBAR_WIDTH`、
/// `src/style.css` 的 `--layout-sidebar-w` 默认值。三者必须同值，各有断言钉住，改一处必须同步
/// 其余两处（REVIEW.md 「同一语义两处真源」条）。
pub const DEFAULT_SIDEBAR_WIDTH: f64 = 236.0;

/// 侧栏宽度合法区间（含端点，D1 裁决 [180, 480]）：与前端 `src/sidebar-width.ts` 的
/// `SIDEBAR_WIDTH_MIN` / `SIDEBAR_WIDTH_MAX` 同值。区间外一律回落默认值 + warning。
///
/// 运行期的「窗口过窄按四成再钳」是**显示口径**（前端做、不落盘）：盘上存的是用户意图值，
/// 因此本区间不受窗口尺寸影响。
pub const SIDEBAR_WIDTH_MIN: f64 = 180.0;
pub const SIDEBAR_WIDTH_MAX: f64 = 480.0;

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
    /// 侧栏宽度（px，change add-sidebar-resize-hide-and-root-create 的 D1 裁决 2026-10-23）：
    /// 默认 236、合法区间 `[180, 480]`（越界回落默认 + warning）。启动时装配一次；运行期由
    /// 左栏分隔条拖拽推进并回写（`config_set_ui_value`，与 `content_width` 同一条合并写通道）。
    /// 窗口过窄时的「四成」钳制是显示口径（前端做，不回写到本字段）——盘上存的是用户意图值。
    /// 类型不符（`"sidebar_width": "236"`）与 `content_width` 同路：整文件回落。
    pub sidebar_width: f64,
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
            sidebar_width: DEFAULT_SIDEBAR_WIDTH,
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

// `[harness.subagents]`（change add-harness-subagents design §14）：定义字段是「用户意图」，
// 本表是「用户设定的上限」；冲突时取小（定义值夹取）。数值越界的口径与 `[harness]` 其余键
// **不同**：这里夹取到最近边界 + warning，而不是回落默认——上限类旋钮贴着用户意图走，
// 回落默认会把「想放宽到 100 轮」静默变成 20 轮。合法区间与缺省值逐键见 design §14。

/// 子运行轮次预算的缺省值与合法区间（含端点；同时是定义字段 `max_turns` 的上限）。
pub const DEFAULT_SUBAGENT_MAX_TURNS: u32 = 20;
pub const SUBAGENT_MAX_TURNS_MIN: u32 = 1;
pub const SUBAGENT_MAX_TURNS_MAX: u32 = 64;

/// 子运行 token 预算的缺省值与合法区间（含端点；同时是定义字段 `max_tokens` 的上限）。
pub const DEFAULT_SUBAGENT_MAX_TOKENS: u64 = 200_000;
pub const SUBAGENT_MAX_TOKENS_MIN: u64 = 1;
pub const SUBAGENT_MAX_TOKENS_MAX: u64 = 10_000_000;

/// 子运行时间闸的缺省值与合法区间（秒；含端点；定义字段 `timeout_secs` 的上限）。
pub const DEFAULT_SUBAGENT_TIMEOUT_SECS: u64 = 300;
pub const SUBAGENT_TIMEOUT_SECS_MIN: u64 = 1;
pub const SUBAGENT_TIMEOUT_SECS_MAX: u64 = 3600;

/// 父回合委派段数上限的缺省值与合法区间（含端点）。
pub const DEFAULT_MAX_SUBRUNS_PER_TURN: u32 = 8;
pub const MAX_SUBRUNS_PER_TURN_MIN: u32 = 1;
pub const MAX_SUBRUNS_PER_TURN_MAX: u32 = 64;

/// 会话级并发子运行数的缺省值与合法区间（含端点）。
pub const DEFAULT_MAX_CONCURRENT: u32 = 4;
pub const MAX_CONCURRENT_MIN: u32 = 1;
pub const MAX_CONCURRENT_MAX: u32 = 16;

/// 已退役、需要迁移的 kimi model 值（M365）：加载时命中它即改写（M381 起改写目标 = 该
/// provider 已声明 models 清单的首项 id——模型名一律来自配置，不内置替补值）并落盘。
/// 只列**本仓曾经写出过**的那一个退役值——用户手填的其他型号（含将来仍有效的、
/// 我们不认识的 id）一律不动，改动面因此收敛到「我们自己的旧出厂值」。
pub const RETIRED_KIMI_MODEL: &str = "kimi-k2";

// 模型维度的归属说明：base_url 官方地址 / 超限特征串的真源在 harness 运行时的预设表里
// （M302），配置层不复制一份。模型清单 / 每模型能力声明（effort / 上下文窗口）自 M373 起归
// 本模块，M381 起严格 config-only（Alex 终裁「彻底不使用内置表」）：模型 id、effort 能力、
// 窗口数值一律只从 `[harness].providers.<id>.models` 读取，本模块不再持有任何内置
// 模型清单或出厂模型常量（llm.rs 的窗口表与 thinking.rs 的能力判定已退役为 schema 读取）。

/// provider 预设四档（change add-model-automation-settings-oct24 design §2.2）：**行为由 preset
/// 决定，不由 id 猜**——id 叫 `kimi` 不代表协议是 kimi。
///
/// **闭集合**：取值校验在 Rust 侧完成（与 `UiTheme` / `PermissionMode` 同一形态）；条目声明
/// 闭集合外的预设时整条忽略（猜错协议比丢弃更危险，design §2.1）。
///
/// 变体顺序即规范顺序（`kimi` → `deepseek` → `generic` → `mock`）：列表展示、active 回退与
/// revision 遍历共用它，因此 `Ord` 的派生顺序承载语义，MUST NOT 重排。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum ProviderPreset {
    /// 官方 Kimi 端点：要求 Key；`responses` / `chat_completions` 两档；Responses 发送 `store:false`。
    Kimi,
    /// 官方 DeepSeek 端点：要求 Key；v1 只实现 `responses`。
    Deepseek,
    /// 任意 OpenAI 兼容端点（本地 Ollama / LM Studio、公司网关）：Base URL 必填才可用；
    /// 允许空 Key（空 = 不发 `Authorization` 头）；缺省 wire 是 `chat_completions`。
    Generic,
    /// 验收专用的 fixture 驱动档（保留 id `mock`）：不经过 HTTP，wire 不消费。
    Mock,
}

impl ProviderPreset {
    /// 配置字面量（`harness.providers.<id>.preset` 的取值；也是校验 warning 文案的取值表来源，
    /// 避免第二处真源）。
    pub fn as_str(self) -> &'static str {
        match self {
            ProviderPreset::Kimi => "kimi",
            ProviderPreset::Deepseek => "deepseek",
            ProviderPreset::Generic => "generic",
            ProviderPreset::Mock => "mock",
        }
    }

    /// 闭集合解析：未知取值返回 `None`（由 [`validate_provider_entry`] 整条忽略 + 人话 warning）。
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "kimi" => Some(ProviderPreset::Kimi),
            "deepseek" => Some(ProviderPreset::Deepseek),
            "generic" => Some(ProviderPreset::Generic),
            "mock" => Some(ProviderPreset::Mock),
            _ => None,
        }
    }

    /// 官方 base URL：kimi / deepseek 有官方地址；generic / mock 没有（generic 必须自己写）。
    /// **唯一写值处**——运行时装配（`llm::client_at` / `title_client` / `naming_client`）只读
    /// 这里，不另留一份预设地址表（REVIEW.md『同一语义两处真源』条）。
    pub fn official_base_url(self) -> Option<&'static str> {
        match self {
            ProviderPreset::Kimi => Some("https://api.moonshot.cn/v1"),
            ProviderPreset::Deepseek => Some("https://api.deepseek.com"),
            ProviderPreset::Generic | ProviderPreset::Mock => None,
        }
    }

    /// 缺省 wire 方言（未写 `wire_api` 键时用它，不告警）。
    pub fn default_wire_api(self) -> WireApi {
        match self {
            ProviderPreset::Generic => WireApi::ChatCompletions,
            ProviderPreset::Kimi | ProviderPreset::Deepseek | ProviderPreset::Mock => {
                WireApi::Responses
            }
        }
    }

    /// 该预设支持的 wire 档位（闭集合外 / 不支持的档位在装载期回落缺省 + warning）。
    /// deepseek 的 chat 档在 v1 未实现；mock 不消费 wire（只认缺省的 `responses`）。
    pub fn supports_wire_api(self, wire_api: WireApi) -> bool {
        !matches!(
            (self, wire_api),
            (ProviderPreset::Mock, WireApi::ChatCompletions)
                | (ProviderPreset::Deepseek, WireApi::ChatCompletions)
        )
    }

    /// 是否要求 `api_key`（决定「未配置 Key 是否可用」与命名调用的前置校验）：
    /// generic 允许空 Key（本地模型不发 `Authorization` 头，design Q9）；mock 不经过 HTTP。
    pub fn requires_api_key(self) -> bool {
        matches!(self, ProviderPreset::Kimi | ProviderPreset::Deepseek)
    }

    /// Responses 请求是否显式发送 `store:false`（只有支持 `store` 的 kimi 需要声明；其余不发）。
    pub fn store_false(self) -> bool {
        matches!(self, ProviderPreset::Kimi)
    }
}

/// harness 的 wire 方言两档（change add-harness-chat-completions-dialect，design D1）。
/// **闭集合**：取值校验在 Rust 侧完成（与 [`ProviderPreset`] / [`PermissionMode`] 同一形态），
/// 运行时拿到的必是两档之一。`Responses` 是缺省档——未写该键的既有配置行为逐字节不变。
///
/// v1 仅 kimi 实现 `ChatCompletions`；deepseek 配该档在配置校验期回落 `Responses` 并告警
/// （design D1 的 v1 范围），因此运行时装配点可以只按 kimi 建 chat 客户端。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum WireApi {
    /// OpenAI Responses API（缺省；`{base}/responses`）。
    #[default]
    Responses,
    /// Chat Completions（`{base}/chat/completions`；k3-256k 在 coding 端点上的正路）。
    ChatCompletions,
}

impl WireApi {
    /// 配置字面量（config.json 的 `harness.providers.<id>.wire_api` 取值；也是校验 warning
    /// 文案的取值表来源，避免第二处真源）。
    pub fn as_str(self) -> &'static str {
        match self {
            WireApi::Responses => "responses",
            WireApi::ChatCompletions => "chat_completions",
        }
    }

    /// 闭集合解析：未知取值返回 `None`（由 [`validate_wire_api`] 回落该预设缺省 + 人话 warning）。
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "responses" => Some(WireApi::Responses),
            "chat_completions" => Some(WireApi::ChatCompletions),
            _ => None,
        }
    }
}

/// harness 权限模式三档（change add-harness-permission-modes，design §2）。**闭集合**：取值
/// 校验在 Rust 侧完成（与 [`ProviderPreset`] / `UiTheme` 同一形态），运行时拿到的必是三档之一。
///
/// 档位只替换判定管线**最底层**的「默认分层」（design §1：前四层——deny 规则 / vault 内写
/// 重定向 / 危险黑名单 / allow 规则——与模式无关），不是一道独立闸门。默认档 `vault_write`：
/// 相对既有行为只多两处差分（vault 写工具免闸、cli_run 经分类后只读白名单免闸），
/// 不引入任何迁移或过渡层（REVIEW.md 「变更默认直接切断」条：旧默认分层直接替换）。
///
/// `read_only` 自 2026-10-09 Alex 裁决起是 **Always Ask**（Kimi Code 语义：读自动放行、一切写
/// 逐个问）——**模式层只产出 Allow / Ask，不产出 Deny**。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum PermissionMode {
    /// 只读（**Always Ask**，Alex 2026-10-09 裁决）：读类工具自动放行，一切写逐个问——模式层
    /// 不产出「拒绝」（deny 规则与黑名单仍优先）。
    ReadOnly,
    /// 保险库写入（默认）：vault 写工具放行（vault_delete 仍逐个问）；cli_run 经分类。
    #[default]
    VaultWrite,
    /// 完全访问：cli_run 写命令自动放行（vault 内写仍走 §1 第 2 层重定向）。
    FullAccess,
}

impl PermissionMode {
    /// 配置字面量（config.json 的 `[harness].permission_mode` 取值；也是校验 warning 文案的
    /// 取值表来源，避免第二处真源）。
    pub fn as_str(self) -> &'static str {
        match self {
            PermissionMode::ReadOnly => "read_only",
            PermissionMode::VaultWrite => "vault_write",
            PermissionMode::FullAccess => "full_access",
        }
    }

    /// 闭集合解析：未知取值返回 `None`（由 [`validate_harness`] 回落默认 + 人话 warning）。
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "read_only" => Some(PermissionMode::ReadOnly),
            "vault_write" => Some(PermissionMode::VaultWrite),
            "full_access" => Some(PermissionMode::FullAccess),
            _ => None,
        }
    }
}

/// `[harness].attachment_naming` 表（change add-semantic-image-naming，2026-10-18 配置面重塑
/// 后落在 harness 域）：图片语义命名的开关与模型选择。
///
/// **布局判据**（Alex 2026-10-18 裁决，已沉淀进 `docs/specs/config-reference.md` §1.6）：
/// **配置跟随资源域**——自动 LLM 行为的开关与模型选择归 `[harness]` 域（providers 所在）；
/// 触发位置（粘贴）是 UI 事实，不是配置域。原顶层 `[attachments]` 表因此废除（它只有命名
/// 两个键、没有别的住户），旧键按未知键口径静默忽略，无兼容读取（单用户、未发布）。
///
/// **缺省即默认**：整表缺席 / 单键缺席 = 出厂值；`model: null` 与缺席同义。
/// **生效时点**（两个方向不同，MUST NOT 当成一句「下次粘贴即生效」）：`enabled` 关→开需重启
/// （前端投递闸是启动装载值，关着时前端根本不投递任务）；开→关立即生效（后端命令每次调用
/// 现场 `config::load()`）。`provider` / `model` 由后端在每次命名时现读 ⇒ 下一次粘贴即生效。
///
/// 不在本表内的东西（design §1 末段）：命名形态、slug 字符集、撤销窗口、扫描范围——那些是
/// 行为，不是偏好。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AttachmentNamingConfig {
    /// 图片语义命名开关（出厂 `true`）：false 时后端跳过命名、不发任何模型请求（前端仍可能
    /// 投递任务，后端读到 false 即返回 skipped）。默认开意味着每次粘贴**新图**都会把图片
    /// 字节与粘贴时刻光标前后各至多 500 字的正文发往配置的模型 provider（proposal「隐私面」，
    /// Alex 2026-10-18 显式接受）。
    pub enabled: bool,
    /// 命名调用发往哪个 provider id（`None` = 会话当前 provider）。悬空 id（不在
    /// `providers` 映射内 / 条目被装载期忽略）在校验期回落 `None` + 人话 warning
    /// （与 `session_naming.provider` 同模板）。
    pub provider: Option<String>,
    /// 命名调用使用的模型 id（`None` = 选定 provider 的生效模型）。非空值 MUST 是该 provider
    /// 的 `models` 清单内、声明 `vision: true` 的 id；不满足时**资格不通过**（保留暂存名），
    /// MUST NOT 静默换成清单里的别的模型——那等于替用户选模型。装载期会给一条点名 warning，
    /// 但值原样保留（不回落）。
    pub model: Option<String>,
}

impl Default for AttachmentNamingConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            provider: None,
            model: None,
        }
    }
}

/// `[harness].session_naming` 表（change add-session-auto-naming；2026-10-18 配置面重塑后
/// 与会话附件命名同域同形）：会话自动命名的开关与模型选择。
///
/// **布局判据**（Alex 2026-10-18 裁决，已沉淀进 `docs/specs/config-reference.md` §1.6）：
/// **配置跟随资源域**——自动 LLM 行为的开关与模型选择归 `[harness]` 域（providers 所在）；
/// 触发位置（一轮对话结束）是 UI 事实，不是配置域。原 `auto_title` / `title_provider` /
/// `providers.<id>.title_model` 三处旧键因此废除，按未知键口径静默忽略，无兼容读取
/// （单用户、未发布）。
///
/// **缺省即默认**：整表缺席 / 单键缺席 = 出厂值；`model: null` 与缺席同义。
/// **生效时点**：`enabled` 在每次轮完成点触发判定时读一次，并在结果落盘前重读（关掉即丢弃）；
/// `provider` / `model` 由每次评估的配置快照取定 ⇒ 下一次评估生效。
///
/// 不在本表内的东西（design §1）：评估节奏（5 轮 / 漂移 / 3 轮下限）、keep 防抖、素材上限、
/// 留存记录形状——那些是行为，不是偏好。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SessionNamingConfig {
    /// 会话自动命名开关（出厂 `true`）：false 时不发起任何命名调用、不写标题记录；既有标题
    /// 记录照常展示。默认开意味着每轮对话的受限素材（design D2）会发往选定 provider。
    pub enabled: bool,
    /// 命名调用发往哪个 provider id（`None` = 会话当前 provider，即旧行为仍是缺省值）。
    /// 悬空 id（不在 `providers` 映射内 / 条目被装载期忽略）在校验期回落 `None` + 人话 warning。
    pub provider: Option<String>,
    /// 命名调用使用的模型 id（`None` = 选定 provider 的生效模型）。非空值须在选定 provider 的
    /// `models` 清单内声明，未声明时校验期回落 `None`（= 生效模型）+ 人话 warning——不把未声明
    /// 的模型发给 API。mock 是 fixture 驱动档、没有模型清单，该键只能是 null。
    pub model: Option<String>,
}

impl Default for SessionNamingConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            provider: None,
            model: None,
        }
    }
}

/// `[harness.subagents]` 表（change add-harness-subagents design §14）：子代理运行的开关与上限。
///
/// **生效时点**：**每个回合**发送时由命令入口现场重读配置（`harness_send` / `harness_cron_run`
/// 各 `config::load()` 一次，随该回合的配置快照传入中枢）——改动**下一个回合**生效，不需要重启；
/// 子代理**定义文件**另按回合扫描。`enabled=false` 时该回合的 `task` 工具不注册（面板任务区因此
/// 自然不出现），定义与内建 `explore` 保留（关掉可随时打开，不需要删定义）。
/// **语义分层**：`enabled` 是 kill switch；`max_turns` / `max_tokens` / `timeout_secs` 是单次
/// 子运行的预算上限，也是定义字段的上限（冲突取小）；`max_subruns_per_turn` 是父回合的次数闸；
/// `max_concurrent` 是会话级并发许可数（同时是 provider 请求闸的许可数 - 1）——**并发不是预算**，
/// 它不参与任何定义的夹取。
///
/// 两个常量刻意**不是**配置键（design §14 末段）：自动唤醒的合并窗口与链上限是安全绳，
/// 不是策略旋钮（常量在 `harness::scheduler`）。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SubagentsConfig {
    /// 子代理总开关（出厂 `true`）：false 时 `task` 工具不注册、面板任务区不出现，定义与内建
    /// `explore` 保留（关掉可随时打开，不需要删定义）。
    pub enabled: bool,
    /// 定义未写 `max_turns` 时的轮次预算；同时是定义值的上限。
    pub max_turns: u32,
    /// 定义未写 `max_tokens` 时的 token 预算；同时是定义值的上限。
    pub max_tokens: u64,
    /// 定义未写 `timeout_secs` 时的时间闸；同时是定义值的上限。
    pub timeout_secs: u64,
    /// 父回合委派段数上限（前台 + 后台；只计实际执行的段，被拒调用不占额度）。
    pub max_subruns_per_turn: u32,
    /// 会话级同时运行的子运行数上限；也是 provider 请求闸的许可数（`+1` 给父往返）。
    pub max_concurrent: u32,
}

impl Default for SubagentsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_turns: DEFAULT_SUBAGENT_MAX_TURNS,
            max_tokens: DEFAULT_SUBAGENT_MAX_TOKENS,
            timeout_secs: DEFAULT_SUBAGENT_TIMEOUT_SECS,
            max_subruns_per_turn: DEFAULT_MAX_SUBRUNS_PER_TURN,
            max_concurrent: DEFAULT_MAX_CONCURRENT,
        }
    }
}

impl SubagentsConfig {
    /// 定义值夹取到配置上限（design §14「定义字段是用户意图，配置是上限，冲突取小」）。
    /// 返回值第二项 = 是否发生夹取——调用侧据此给一条点名 warning（定义文件里的值原样保留
    /// 在错误信息里，便于用户改定义）。
    pub fn clamp_turns(&self, value: u32) -> (u32, bool) {
        (value.min(self.max_turns), value > self.max_turns)
    }

    /// 见 [`Self::clamp_turns`]。
    pub fn clamp_tokens(&self, value: u64) -> (u64, bool) {
        (value.min(self.max_tokens), value > self.max_tokens)
    }

    /// 见 [`Self::clamp_turns`]。
    pub fn clamp_timeout_secs(&self, value: u64) -> (u64, bool) {
        (value.min(self.timeout_secs), value > self.timeout_secs)
    }
}

/// `[harness]` 表（change add-harness-probe §11）：对话运行时的配置面。
///
/// **生效时点**：会话建立 / 每轮请求时由 harness 运行时读一次（M302），运行期不为它做热重载
/// ——与 `editor` / `ui` 的「装载时施加」同路。`api_key` 明文（Alex 裁决点 2，理由见模块头）。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HarnessConfig {
    /// 当前生效的 provider **id**（`providers` 映射里的键；空串 = 没有可用 provider）。
    /// 显式选中但未配置完整的 provider **不会被自动换掉**——那是用户的选择，发送时给
    /// 「该 provider 未配置完整」的人话错误（design §2.5）。
    pub provider: String,
    /// 以稳定 id 为键的 provider 映射（design §2.1）：`provider` 键切换生效项，其余条目
    /// 照旧保留（切回即恢复）。被装载期判为非法的条目**不在**本映射里（只存在于 raw JSON，
    /// 设置面以「装载期已忽略」行呈现）。
    pub providers: BTreeMap<String, HarnessProviderConfig>,
    /// 权限规则表（design §6）：deny > allow > 默认分层（读 allow / 写与 CLI ask）。
    pub permissions: HarnessPermissions,
    /// 权限模式（change add-harness-permission-modes，design §2/§7）：`read_only` /
    /// `vault_write`（默认）/ `full_access`。切换对下一个判定生效，不打断进行中的轮次。
    pub permission_mode: PermissionMode,
    /// 工具循环上限（默认 50，合法区间见 [`LOOP_MAX_MIN`] / [`LOOP_MAX_MAX`]）。
    pub loop_max: u32,
    /// 上下文用量警示阈值（百分比，默认 85，合法区间见 [`WARN_CTX_PCT_MIN`] / [`WARN_CTX_PCT_MAX`]）。
    pub warn_ctx_pct: f64,
    /// 自动压缩（默认 true）：一轮响应完成后 ctx% 越阈值即自动压缩续聊；false 退化为纯手动。
    pub auto_compact: bool,
    /// 会话自动命名（change add-session-auto-naming，2026-10-18 配置面重塑）：开关 +
    /// provider / model 选择。
    pub session_naming: SessionNamingConfig,
    /// 图片语义命名（change add-semantic-image-naming，2026-10-18 配置面重塑）：开关 +
    /// provider / model 选择。与会话自动命名（`session_naming`）同一资源域、同一解析口径。
    pub attachment_naming: AttachmentNamingConfig,
    /// 子代理运行（change add-harness-subagents design §14）：开关 + 预算上限 + 次数 / 并发闸。
    pub subagents: SubagentsConfig,
}

impl Default for HarnessConfig {
    fn default() -> Self {
        Self {
            // 空映射 + 无 active：provider 由用户增删（design §4.4 允许删到一个不剩）。
            // 出厂不内置任何 provider——首次接入走设置面板，不靠内置替身。
            provider: String::new(),
            providers: BTreeMap::new(),
            permissions: HarnessPermissions::default(),
            permission_mode: PermissionMode::default(),
            loop_max: DEFAULT_LOOP_MAX,
            warn_ctx_pct: DEFAULT_WARN_CTX_PCT,
            auto_compact: true,
            session_naming: SessionNamingConfig::default(),
            attachment_naming: AttachmentNamingConfig::default(),
            subagents: SubagentsConfig::default(),
        }
    }
}

/// 一次命名调用的完整目标（change add-session-auto-naming，design D8 的「唯一解析口」）：
/// 所有字段**同出 `session_naming.provider` 指向的那一个 provider 条目**——模型取 A、key 取 B
/// 的混用形态在设计不变量 8 里被明确禁止，故调用方只该持有本结构、不再回读配置。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TitleTarget {
    /// 实际发往的 provider id（= `session_naming.provider`，缺省 / 悬空回落会话当前 provider）。
    pub provider: String,
    /// 该 provider 的预设（协议行为按 preset 查表，不由 id 猜）。
    pub preset: ProviderPreset,
    /// 本次调用实际使用的模型 id。mock 是 fixture 驱动档、没有模型维度，此处为空串（记录侧
    /// 不伪造一个不存在的模型 id）；`session_naming.model` 未配置时 = 该 provider 的生效模型。
    pub model: String,
    /// wire 方言（与 `api_key` / `base_url` 同出该 provider 条目）。
    pub wire_api: WireApi,
    pub api_key: String,
    /// `None` = 该 provider 的官方地址（与 [`HarnessProviderConfig::base_url`] 同义）。
    pub base_url: Option<String>,
}

/// 单个模型声明（M373，schema 暴露的 model 维度）：思考程度能力 + 上下文窗口。
///
/// 这是**能力/窗口表的唯一真源**——thinking.rs 的 k3 词元判定与 llm.rs 的 KIMI_PRESET
/// 窗口表已退役为本结构的读取。M381 起（Alex 终裁「只显示配置里写的模型。彻底不使用
/// 内置表」）清单严格 config-only：逐项只来自用户配置的
/// `[harness].providers.<id>.models`，本模块不内置任何模型 id / 能力 / 窗口数值。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HarnessModelSpec {
    /// 模型 id（配置值即读数，如 `kimi-k3` / `k3-256k`）。
    pub id: String,
    /// 该模型是否支持思考程度调节（`reasoning.effort`）。未声明 / 未列出 = 不支持
    /// （保守默认：不把无效参数发给不支持的模型）。
    pub effort: bool,
    /// 该模型是否接受图片输入（`input_image`；change harness-composer-image-paste，
    /// 键名 2026-10-10 由 `image` 改名 `vision`）。未声明 / 未列出 = 不支持
    /// （保守默认，与 `effort` 同侧）；发送闸（`harness_image_unsupported`）的判据。
    pub vision: bool,
    /// 上下文窗口（tokens）：ctx% 读数的分母。
    pub window: u64,
}

/// provider id 规则的唯一写值处（design §2.3）：小写 ASCII / 数字 / `-` / `_`，**不含点**
/// （点分写回路径按 `.` 分段，点会在写通道里制造第二级键），1..=32 字符。
/// 装载期命中非法 id 的条目整条忽略（它无法被任何写通道寻址）。
const PROVIDER_ID_MAX: usize = 32;

/// provider id 是否合法（装载体与设置写通道共用同一判据，MUST NOT 各写一份）。
pub fn provider_id_valid(id: &str) -> bool {
    let mut chars = id.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_lowercase() || first.is_ascii_digit()) {
        return false;
    }
    id.chars().count() <= PROVIDER_ID_MAX
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// 保留 id：mock 是验收专用的 fixture 档，设置面不呈现、不可新增 / 不可删除（配置仍可手写）。
pub const RESERVED_PROVIDER_ID: &str = "mock";

/// 测试与验收桩的 provider 构造（`#[doc(hidden)]`；产品代码不使用）：`configured` 按字段
/// 派生，避免每个用例各拼一遍字面量时漏掉派生读数。
#[doc(hidden)]
pub fn test_provider(
    preset: ProviderPreset,
    api_key: &str,
    models: &[(&str, bool, bool, u64)],
) -> HarnessProviderConfig {
    let mut entry = HarnessProviderConfig::empty(preset);
    entry.api_key = api_key.to_string();
    entry.models = models
        .iter()
        .map(|(id, effort, vision, window)| HarnessModelSpec {
            id: (*id).to_string(),
            effort: *effort,
            vision: *vision,
            window: *window,
        })
        .collect();
    entry.model = entry
        .models
        .first()
        .map(|spec| spec.id.clone())
        .unwrap_or_default();
    entry.recompute_configured();
    entry
}

/// 测试与验收桩的 harness 构造（`#[doc(hidden)]`）：把 `entry` 装成唯一 provider 并设为 active。
#[doc(hidden)]
pub fn test_harness(id: &str, entry: HarnessProviderConfig) -> HarnessConfig {
    let mut config = HarnessConfig::default();
    let mut entry = entry;
    entry.recompute_configured();
    config.providers.insert(id.to_string(), entry);
    config.provider = id.to_string();
    config
}

/// 测试与验收桩的 mock 档配置（`#[doc(hidden)]`）：`fixture` 为 `None` = 未配置。
#[doc(hidden)]
pub fn test_mock(fixture: Option<&str>) -> HarnessConfig {
    let mut entry = HarnessProviderConfig::empty(ProviderPreset::Mock);
    entry.fixture = fixture.map(str::to_string);
    test_harness(RESERVED_PROVIDER_ID, entry)
}

/// 上下文窗口的保守回落值（tokens）：生效 model 不在声明清单内（或清单为空）时 ctx%
/// 读数的分母用它（读数宁可偏小偏保守，不猜窗口）。**唯一写值处**，运行时的窗口查表
/// 未命中都回落这里。它不是模型知识——不声明任何模型的能力/身份，只是「未知窗口」的
/// 度量兜底（与「未列出 = 不支持 effort」同一保守侧）。
pub const FALLBACK_CONTEXT_WINDOW: u64 = 131_072;

/// 单个 provider 条目（change add-model-automation-settings-oct24 §2.1）：id 是映射键，条目
/// 自带 `preset`（协议行为由 preset 决定，不由 id 猜）。
///
/// M381 起（config-only）`Default` 的 `model` 是空串、`models` 是空清单：**不内置任何
/// 出厂模型**——模型清单、当前 model、逐模型能力/窗口一律只来自 config.json 的
/// `[harness].providers.<id>` 声明（`model` 缺省/空时由 validate 解析为声明清单首项 id，
/// 清单为空则保持空串，发送时由运行时给出人话错误）。`api_key` 出厂为空串（未配置）、
/// `base_url` 出厂为 `None`（官方地址）。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HarnessProviderConfig {
    /// 协议预设（`kimi` / `deepseek` / `generic` / `mock`）：官方地址、是否发 `store:false`、
    /// 超限特征串、支持的 wire 与是否要求 Key 全由它决定。**创建后不可改**（换协议请新增
    /// provider 再删旧的，design §2.2）。
    pub preset: ProviderPreset,
    /// API key 明文（裁决点 2）。空串 = 未配置：kimi / deepseek 发送时给 `harness_api_key_missing`，
    /// generic 允许空（= 不发 `Authorization` 头，design Q9）。
    pub api_key: String,
    /// 模型 id（配置值即读数）。缺省 / 空串 → 声明清单首项 id；清单为空 → 空串（不伪造）。
    pub model: String,
    /// API base URL；`None` = 用该 preset 的官方地址（[`ProviderPreset::official_base_url`]）。
    /// generic 预设没有官方地址，有 Key 或模型时必填。
    pub base_url: Option<String>,
    /// 可选模型清单 + 每模型能力声明（M373；M381 起 config-only）：**唯一真源是配置
    /// 声明**——不写 `models` 键 = 空清单（provider 节已配置时给一条人话 warning +
    /// 前端提示态），绝不回落内置表。这是浮层模型段与 ctx% 窗口 / effort 能力判定的
    /// 共同数据源。
    pub models: Vec<HarnessModelSpec>,
    /// wire 方言（change add-harness-chat-completions-dialect，design D1）：缺省随 preset
    /// （kimi / deepseek / mock = `responses`，generic = `chat_completions`）；该预设不支持的
    /// 档位（deepseek 的 chat / mock 的 chat）在校验期回落缺省 + warning。
    pub wire_api: WireApi,
    /// mock 专用的 fixture 文件路径（`preset = mock` 之外的条目按未知键保留、运行期忽略）。
    pub fixture: Option<String>,
    /// 派生读数（不落盘）：该条目是否已配置完整（design §2.4）。快照与模型 chip 都消费它，
    /// 前端 MUST NOT 自己拼这个判据（REVIEW.md『同一语义两处真源』条）。
    ///
    /// `mock` = fixture 非空；`generic` = 模型清单非空且 Base URL 非空；`kimi` / `deepseek` =
    /// Key 非空且模型清单非空。
    pub configured: bool,
}

impl HarnessProviderConfig {
    /// 按预设构造一个空条目：`wire_api` 取该预设缺省，其余字段为零值（`configured = false`）。
    /// 装载期之外的自定义构造从这里起步——手写字面量会漏掉 wire 缺省与派生读数。
    pub fn empty(preset: ProviderPreset) -> Self {
        Self {
            preset,
            api_key: String::new(),
            model: String::new(),
            base_url: None,
            models: Vec::new(),
            wire_api: preset.default_wire_api(),
            fixture: None,
            configured: false,
        }
    }

    /// 依当前字段重新派生 `configured`（改过字段后调用；装载期、写通道与测试共用）。
    pub fn recompute_configured(&mut self) {
        self.configured = self.derive_configured();
    }

    /// 可用性判据（design §2.4，**唯一**实现）。派生读数，不落盘。
    fn derive_configured(&self) -> bool {
        match self.preset {
            ProviderPreset::Mock => self
                .fixture
                .as_deref()
                .is_some_and(|fixture| !fixture.trim().is_empty()),
            ProviderPreset::Generic => {
                !self.models.is_empty()
                    && self
                        .base_url
                        .as_deref()
                        .is_some_and(|url| !url.trim().is_empty())
            }
            ProviderPreset::Kimi | ProviderPreset::Deepseek => {
                !self.api_key.trim().is_empty() && !self.models.is_empty()
            }
        }
    }
}

impl Default for HarnessProviderConfig {
    /// 出条目 = generic 预设、其余字段零值（`configured = false`）。**不内置任何出厂 provider**
    /// ——新增条目一律由设置面显式创建。
    fn default() -> Self {
        Self::empty(ProviderPreset::Generic)
    }
}

impl HarnessConfig {
    /// 按 id 查条目（未命中 = `None`：被装载期忽略 / 已删除 / active 为空）。
    pub fn provider_entry(&self, provider: &str) -> Option<&HarnessProviderConfig> {
        self.providers.get(provider)
    }

    /// 该 id 是否为 mock 档（mock 判定**只**看条目预设，不看 id 字面量——`preset = mock`
    /// 只允许 id 恰好是 `mock`，装载期已把其它 id 的 mock 声明整条忽略）。
    /// 未命中（无该条目）= 不是 mock。
    pub fn is_mock(&self, provider: &str) -> bool {
        self.provider_entry(provider)
            .is_some_and(|entry| entry.preset == ProviderPreset::Mock)
    }

    /// 当前生效条目（active id 查表；空串 / 悬空 = `None`）。
    pub fn active_provider(&self) -> Option<(&str, &HarnessProviderConfig)> {
        if self.provider.is_empty() {
            return None;
        }
        self.providers
            .get_key_value(&self.provider)
            .map(|(id, entry)| (id.as_str(), entry))
    }

    /// 指定 provider 的生效模型清单（schema 读取点，M373；M381 起 config-only）：按 id 查
    /// 条目；未命中（无该 id / 被装载期忽略 / 无 active）返回空表，不回落任何内置表。
    pub fn model_specs(&self, provider: &str) -> &[HarnessModelSpec] {
        self.provider_entry(provider)
            .map(|entry| entry.models.as_slice())
            .unwrap_or(&[])
    }

    /// 模型上下文窗口（tokens）：生效清单精确匹配，未列出回落 [`FALLBACK_CONTEXT_WINDOW`]
    /// （保守默认——ctx% 的分母宁可偏小读数偏保守，不猜窗口）。
    pub fn context_window(&self, provider: &str, model: &str) -> u64 {
        self.model_specs(provider)
            .iter()
            .find(|spec| spec.id == model)
            .map(|spec| spec.window)
            .unwrap_or(FALLBACK_CONTEXT_WINDOW)
    }

    /// 该 provider + model 是否支持思考程度调节（前端置灰判据，schema 读取点）：
    /// 生效清单精确匹配取声明值；未列出 = 不支持（保守默认，与 M372 前「kimi 非 k3 系
    /// 置灰」同一安全侧）；mock 恒定支持（fixture 驱动，验收要断言档位到达请求）。
    pub fn effort_supported(&self, provider: &str, model: &str) -> bool {
        if self.is_mock(provider) {
            return true;
        }
        self.model_specs(provider)
            .iter()
            .find(|spec| spec.id == model)
            .is_some_and(|spec| spec.effort)
    }

    /// 当前 provider 的 wire 方言（change add-harness-chat-completions-dialect）：**单一来源**
    /// ——client 装配（`llm::client_at`）与 `session_open.wire_api` 留存都读这一处，MUST NOT
    /// 各写一份 match。无 active / 悬空 = 缺省 `Responses`（留存字段不缺席）；mock 是 fixture
    /// 驱动档，没有 wire 面（装载期已把它的 wire 归一为 `Responses`）。
    pub fn wire_api(&self) -> WireApi {
        self.provider_entry(&self.provider)
            .map(|entry| entry.wire_api)
            .unwrap_or_default()
    }

    /// 该 provider + model 是否接受图片输入（change harness-composer-image-paste，
    /// `harness_send` 发送闸的单一判据，design §6）：生效清单精确匹配取声明值；
    /// 未列出 = 不支持（保守默认，与 `effort` 同侧）；mock 恒定支持（fixture 驱动，
    /// 验收要断言含图消息正常入队）。能力语义只有这一处产出——前端 MUST NOT 另立判定
    /// （REVIEW.md 「同一语义两处真源」条）。
    pub fn vision_supported(&self, provider: &str, model: &str) -> bool {
        if self.is_mock(provider) {
            return true;
        }
        self.model_specs(provider)
            .iter()
            .find(|spec| spec.id == model)
            .is_some_and(|spec| spec.vision)
    }

    /// 命名调用的唯一解析口（change add-session-auto-naming，design D8 / 不变量 8；
    /// change add-model-automation-settings-oct24 §2.6 改为按 provider id）：`provider` =
    /// `session_naming.provider`（缺省 = 会话当前 provider id），其余字段与 `model`
    /// **同出该 provider 条目**——MUST NOT 混用会话 provider 与 title provider 的字段。
    ///
    /// `model` 读 `session_naming.model`（`None` = 用该条目的生效模型）。mock 是 fixture 驱动档：
    /// 没有 `api_key` / `base_url` / 模型维度，`model` 留空串（记录侧不伪造模型 id），命名调用
    /// 走 fixture 的 `titles` 队列。
    ///
    /// 目标 id 查不到条目（无 active provider / active 在装载期被忽略）时返回一个空目标：
    /// `provider` 为空串、各字段为零值，由 `llm::title_client` 给出 `harness_provider_missing`。
    pub fn title_target(&self, session_provider: &str) -> TitleTarget {
        let provider = self
            .session_naming
            .provider
            .as_deref()
            .unwrap_or(session_provider);
        let Some(entry) = self.provider_entry(provider) else {
            return TitleTarget {
                provider: String::new(),
                preset: ProviderPreset::Generic,
                model: String::new(),
                wire_api: WireApi::Responses,
                api_key: String::new(),
                base_url: None,
            };
        };
        if entry.preset == ProviderPreset::Mock {
            return TitleTarget {
                provider: provider.to_string(),
                preset: entry.preset,
                model: String::new(),
                wire_api: WireApi::Responses,
                api_key: String::new(),
                base_url: None,
            };
        }
        TitleTarget {
            provider: provider.to_string(),
            preset: entry.preset,
            model: self
                .session_naming
                .model
                .clone()
                .unwrap_or_else(|| entry.model.clone()),
            wire_api: entry.wire_api,
            api_key: entry.api_key.clone(),
            base_url: entry.base_url.clone(),
        }
    }

    /// 图片语义命名的**唯一解析口**（change add-semantic-image-naming，design §1 / §4.2；
    /// 2026-10-18 配置面重塑后与 [`HarnessConfig::title_target`] 同口径；§2.6 改为按 provider
    /// id）：`None` = 没有满足条件的 vision 模型（或目标 provider 不存在 / 没有模型维度），
    /// 调用方跳过命名、保留暂存名、不发任何请求、不弹失败 toast。
    ///
    /// 全字段**同出 `attachment_naming.provider` 指向的那一个 provider 条目**——模型取 A、
    /// key 取 B 的混用形态与会话自动命名同样被禁止（design 不变量 8），调用方只该持有本结构、
    /// 不再回读配置。
    ///
    /// 判据（按**当时生效**的 provider 现算——运行期切 provider 后重新核对，design §1）：
    /// - `provider` 缺省 = 会话当前 provider（`session_provider`）；
    /// - `model` 非空 ⇒ 必须就是本次使用的模型，且该 provider 的 `models` 清单列出它并声明
    ///   `vision: true`；不满足即 `None`（MUST NOT 降级到清单里的其它模型——那等于替用户选
    ///   模型）。`model` 为空 ⇒ 跟随该 provider 的生效模型。
    ///
    /// mock 是 fixture 驱动档：恒支持 vision，但没有模型维度，`model` 非空对它不成立。
    /// 开关（`enabled`）不在本函数：它是独立的开关语义，诊断码要把它与「无可用模型」分开，
    /// 因此由调用方先判（`attachment_naming::run`）。
    pub fn attachment_naming_target(
        &self,
        session_provider: &str,
    ) -> Option<AttachmentNamingTarget> {
        let provider = self
            .attachment_naming
            .provider
            .as_deref()
            .unwrap_or(session_provider);
        let entry = self.provider_entry(provider)?;
        let requested = self
            .attachment_naming
            .model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if entry.preset == ProviderPreset::Mock {
            return requested.is_none().then(|| AttachmentNamingTarget {
                provider: provider.to_string(),
                preset: entry.preset,
                model: String::new(),
                wire_api: WireApi::Responses,
                api_key: String::new(),
                base_url: None,
            });
        }
        let model = match requested {
            Some(value) => value.to_string(),
            None => entry.model.clone(),
        };
        if model.trim().is_empty() || !self.vision_supported(provider, &model) {
            return None;
        }
        Some(AttachmentNamingTarget {
            provider: provider.to_string(),
            preset: entry.preset,
            model,
            wire_api: entry.wire_api,
            api_key: entry.api_key.clone(),
            base_url: entry.base_url.clone(),
        })
    }
}

/// 一次图片语义命名调用的完整目标（change add-semantic-image-naming，2026-10-18 配置面重塑）：
/// 与会话自动命名的 [`TitleTarget`] 同形同口径——所有字段同出**一个** provider 条目。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentNamingTarget {
    /// 实际发往的 provider id（`attachment_naming.provider`，缺省 = 会话当前 provider）。
    pub provider: String,
    /// 该 provider 的预设（协议行为按 preset 查表，不由 id 猜）。
    pub preset: ProviderPreset,
    /// 本次调用实际使用的模型 id。mock 无模型维度，此处为空串（不伪造模型 id）。
    pub model: String,
    /// wire 方言（与 `api_key` / `base_url` 同出该 provider 条目）。
    pub wire_api: WireApi,
    pub api_key: String,
    /// `None` = 该 provider 的官方地址（与 [`HarnessProviderConfig::base_url`] 同义）。
    pub base_url: Option<String>,
}

/// `[harness].permissions` 表（design §6）：规则语法 `tool` 或 `tool(模式)` 的字符串清单。
///
/// 配置层只保形状（非空字符串、按原顺序去空白），**匹配语义**（前缀 + `*`、deny > allow >
/// 默认分层）归 harness 运行时（M302）——与 `keys` 表「形状在此、语义在外」同一分层，
/// 两边各判一半必然漂移（REVIEW.md 「同一语义两处真源」条）。
#[derive(Debug, Clone, PartialEq, Default, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HarnessPermissions {
    pub allow: Vec<String>,
    pub deny: Vec<String>,
}

/// 触达策略三档（change add-cron-runtime-daemon，design §5）：到点后做什么。
///
/// **闭集合**：取值校验在 Rust 侧完成（与 [`WireApi`] / [`PermissionMode`] 同一形态），
/// 运行时拿到的必是三档之一。闭集合外取值回落缺省档并**保留任务**——向「不花 token」的
/// 保守方向回落（design §7.2）。
///
/// 缺省档 [`DeliveryPolicy::NotifyThenRun`]：到点只投「到点」通知，点击通知才发起运行——
/// 点击即意图，无人点头不花 token。三档共用同一条运行实现，差别只在「何时通知、谁发起
/// 运行、点击落地到哪」。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum DeliveryPolicy {
    /// 到点通知，用户点击后才在交互会话槽位发起运行（缺省档）。
    #[default]
    NotifyThenRun,
    /// 到点静默发起运行（运行槽位），终态后投递结果通知。
    RunThenNotify,
    /// 到点静默发起运行，全程不通知。
    SilentRun,
}

impl DeliveryPolicy {
    /// 配置字面量（`cron.tasks[].delivery` 的取值；也是校验 warning 文案的取值表来源，
    /// 避免第二处真源）。
    pub fn as_str(self) -> &'static str {
        match self {
            DeliveryPolicy::NotifyThenRun => "notify-then-run",
            DeliveryPolicy::RunThenNotify => "run-then-notify",
            DeliveryPolicy::SilentRun => "silent-run",
        }
    }

    /// 闭集合解析：未知取值返回 `None`（由 [`validate_cron`] 回落缺省 + 人话 warning）。
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "notify-then-run" => Some(DeliveryPolicy::NotifyThenRun),
            "run-then-notify" => Some(DeliveryPolicy::RunThenNotify),
            "silent-run" => Some(DeliveryPolicy::SilentRun),
            _ => None,
        }
    }
}

/// 会话形态两档（design §6.3）：`new` 每次触发新会话；`dedicated` 每任务一个专用会话，
/// 后续触发续写（session id 来自 `cron-state.json`，缺失则新建）。
///
/// **闭集合**：闭集合外取值回落 `new` 并保留任务（design §7.2）。两档共用同一条运行路径，
/// 差别只是 session id 从哪来。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum SessionShape {
    /// 每次触发新建会话（缺省）：上下文互不污染。
    #[default]
    New,
    /// 每任务一个专用会话，后续触发续写。
    Dedicated,
}

impl SessionShape {
    /// 配置字面量（与 [`DeliveryPolicy::as_str`] 同形）。
    pub fn as_str(self) -> &'static str {
        match self {
            SessionShape::New => "new",
            SessionShape::Dedicated => "dedicated",
        }
    }

    /// 闭集合解析：未知取值返回 `None`（由 [`validate_cron`] 回落缺省 + 人话 warning）。
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "new" => Some(SessionShape::New),
            "dedicated" => Some(SessionShape::Dedicated),
            _ => None,
        }
    }
}

/// 星期闭集合（`cron.tasks[].days` 的元素）：`mon` … `sun`。
///
/// 缺省 = **全周**：校验期把缺席的 `days` 展开成 [`CronWeekday::ALL`]，生效类型里因此不保留
/// 「空数组 = 全周」这种二义形态——空数组在校验期就判非法（design §7.2）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum CronWeekday {
    Mon,
    Tue,
    Wed,
    Thu,
    Fri,
    Sat,
    Sun,
}

impl CronWeekday {
    /// 全周（`days` 缺省时的展开值）。
    pub const ALL: [CronWeekday; 7] = [
        CronWeekday::Mon,
        CronWeekday::Tue,
        CronWeekday::Wed,
        CronWeekday::Thu,
        CronWeekday::Fri,
        CronWeekday::Sat,
        CronWeekday::Sun,
    ];

    /// 配置字面量（也是 warning 文案的取值表来源）。
    pub fn as_str(self) -> &'static str {
        match self {
            CronWeekday::Mon => "mon",
            CronWeekday::Tue => "tue",
            CronWeekday::Wed => "wed",
            CronWeekday::Thu => "thu",
            CronWeekday::Fri => "fri",
            CronWeekday::Sat => "sat",
            CronWeekday::Sun => "sun",
        }
    }

    /// 闭集合解析：未知取值返回 `None`（`cron::parse_weekday` 是它在调度侧的薄转发）。
    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|day| day.as_str() == value)
    }

    /// 取值表的人话投影（warning 文案用，避免这七个名字出现第二份清单）。
    pub fn list() -> String {
        Self::ALL.map(Self::as_str).join("、")
    }
}

/// 一条定时任务（design §2 的五要素）：调度（`at` + `days`）、自然语言载荷（`prompt`）、
/// 会话形态（`session`）、触达策略（`delivery`）、可选模型覆盖（`model`）；`id` 是身份，
/// `vault` 是运行坐标。
///
/// **机制不知道任务要做什么**：字段只表达「何时叫醒谁、叫醒后怎么收尾」。任务要写哪个文件、
/// 路径怎么拼、日期怎么进文件名、完成条件是什么，全部由 `prompt` 与目标 vault 的
/// `AGENTS.md` 表达——实现代码里 MUST NOT 出现任何任务 id、样例路径或样例小节标题的字面量。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct CronTask {
    /// 身份：去重状态的键、诊断事件的 `task`、通知标题。校验期保证非空、无空白、唯一。
    pub id: String,
    /// 运行坐标：绝对路径（是否**存在**不在装载期判定——装载期 stat 会拖慢启动，且外置盘
    /// 可能后挂载）。
    pub vault: String,
    /// 本地时间 `HH:MM`（`00:00`–`23:59`）。解析与判定见 `cron::parse_at` / `cron::decide`。
    pub at: String,
    /// 星期闭集合，**缺省 = 全周（七项全在场）**。
    pub days: Vec<CronWeekday>,
    /// 自然语言载荷：原样作为一条用户消息送入既有发送通道（机制不解析、不替换占位符、
    /// 不改写）。
    pub prompt: String,
    pub delivery: DeliveryPolicy,
    pub session: SessionShape,
    /// 可选模型覆盖：按运行时 `[harness].providers.<provider>.models` 解析；未声明时回落该
    /// provider 默认模型 + 一条 `config_warning`，**任务不丢**（此键只存 id 原值，不在此校验
    /// 模型清单——清单本身可在配置里演化）。
    pub model: Option<String>,
}

/// `[cron]` 表的生效形态：任务清单。`tasks: []` ⇒ 守护空转、零报错。
#[derive(Debug, Clone, Default, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct CronConfig {
    pub tasks: Vec<CronTask>,
}

/// 装载期被**丢弃**的任务项（`cron_task_invalid` 诊断事件的载荷来源）：`task` = 任务 id
/// （id 本身不可读时为空）、`field` = 第一处问题所在字段、`reason` = 人话原因。
///
/// **不进配置文件、不序列化给前端**（[`ConfigSnapshot`] 上是 `serde(skip)` / `ts(skip)`）：
/// 它只服务 `lumir-cron` 线程启动装载那一次的诊断事件，warning 文本才是给人的那条。
#[derive(Debug, Clone, PartialEq)]
pub struct CronTaskIssue {
    pub task: String,
    pub field: String,
    pub reason: String,
}

/// 一条结构化配置诊断（change add-model-automation-settings-oct24 §7.1）：`validate()` 的
/// **唯一** warning 生产形态。
///
/// `ConfigSnapshot.warnings` 由 `message` 逐条派生（文案与结构出现之前逐字一致，既有 warning
/// 断言、诊断日志、console 出口零改动）；`code` / `path` / `severity` 供设置面分类、挂字段与
/// 判断「写这笔 patch 会不会引入阻断级问题」——MUST NOT 在前端另写一份判定
/// （REVIEW.md『同一语义两处真源』条）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ConfigDiagnostic {
    /// 稳定 code（前端分类 / 计数 / 阻断表用；同一判定点只有一份）。
    pub code: String,
    /// 键路径（`harness.providers.kimi.models`）；文件级诊断（整文件回落等）为 `None`。
    pub path: Option<String>,
    pub severity: DiagnosticSeverity,
    /// 现有的人话文案（逐字沿用，`ConfigSnapshot.warnings` 由它派生）。
    pub message: String,
}

/// 诊断的严重度（design §6.3）：
/// - `Warning`：只提示，不阻断保存；
/// - `RejectOnWrite`：设置面写入的候选配置里出现、且路径与本笔改动相交时，整笔拒绝。
///
/// 分级由 code 在**构造点**决定（[`diagnostic_severity`] 是唯一分级表），设置面不二次判定。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum DiagnosticSeverity {
    Warning,
    RejectOnWrite,
}

/// 阻断级 code 词表（design §6.3 的显式表；**唯一**分级真源）。
///
/// 只收「写进文件就等于把配置写坏」的判定：模型清单的元素约束、半配置、wire / base_url 的
/// 显式非法输入、provider id 与删除引用完整性。路径相交判据（candidate × changed paths）由
/// 设置写通道用本表 + `ConfigDiagnostic.path` 计算，这里只分级。
const REJECT_ON_WRITE_CODES: [&str; 21] = [
    "harness_model_id_empty",
    "harness_model_id_duplicate",
    "harness_model_window_invalid",
    "harness_model_effort_invalid",
    "harness_model_vision_invalid",
    "harness_models_empty_when_configured",
    "harness_wire_api_invalid",
    "harness_wire_api_unsupported",
    "harness_base_url_empty",
    "harness_base_url_required",
    "harness_provider_preset_invalid",
    "harness_provider_id_invalid",
    "settings_provider_id_invalid",
    "settings_provider_id_duplicate",
    "settings_provider_reserved_id",
    "settings_provider_not_found",
    "settings_provider_preset_immutable",
    "settings_active_provider_missing",
    "settings_provider_delete_active_requires_target",
    "settings_provider_delete_referenced",
    "settings_naming_target_missing",
];

/// `settings_naming_model_missing` / `settings_unknown_field` 同为阻断级（design §6.3 的完整
/// 词表），与上面那张表分开判只为避免数组长度写死在类型里时漏项；两处都只读本函数。
fn diagnostic_severity(code: &str) -> DiagnosticSeverity {
    if REJECT_ON_WRITE_CODES.contains(&code)
        || matches!(
            code,
            "settings_naming_model_missing" | "settings_unknown_field"
        )
    {
        DiagnosticSeverity::RejectOnWrite
    } else {
        DiagnosticSeverity::Warning
    }
}

/// 逐字段校验期间的诊断收集器（`validate()` 内部）：`warn(code, path, message)` 是**唯一**
/// 生产点，`&mut Vec<String>` 的旧形态已整体替换（不存在第二份校验逻辑）。
///
/// `messages()` 保序派生 `ConfigSnapshot.warnings`——顺序与结构出现之前逐条一致。
#[derive(Debug, Default)]
struct DiagnosticSink {
    diagnostics: Vec<ConfigDiagnostic>,
}

impl DiagnosticSink {
    fn warn(&mut self, code: &str, path: Option<String>, message: String) {
        self.diagnostics.push(ConfigDiagnostic {
            code: code.to_string(),
            path,
            severity: diagnostic_severity(code),
            message,
        });
    }

    /// 便捷形态：`path` 为静态键路径时用它（与 [`Self::warn`] 同一出口）。
    fn warn_at(&mut self, code: &str, path: &str, message: String) {
        self.warn(code, Some(path.to_string()), message);
    }

    /// 合并子校验器产出的诊断（保序）。
    fn extend(&mut self, diagnostics: Vec<ConfigDiagnostic>) {
        self.diagnostics.extend(diagnostics);
    }

    fn into_diagnostics(self) -> Vec<ConfigDiagnostic> {
        self.diagnostics
    }
}

/// 一次配置加载的结果：生效配置 + 人话 warning 列表 + 实际读取路径。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ConfigSnapshot {
    pub config: AppConfig,
    /// 逐字段回退时产生的人话提示；为空表示完全干净。**由 `diagnostics` 的 message 派生**
    /// （顺序一致、文案逐字不变）。
    pub warnings: Vec<String>,
    pub path: String,
    /// 结构化诊断（change add-model-automation-settings-oct24 §7.1）：warning 的唯一真源，
    /// `warnings` 是它的投影。不进序列化面——IPC 契约里的 `warnings` 形状保持不变，设置面走
    /// 独立的设置快照（另一个 change 的写通道）。
    #[serde(skip)]
    #[ts(skip)]
    pub diagnostics: Vec<ConfigDiagnostic>,
    /// `[cron].tasks` 里被丢弃的任务项（结构化，供调度线程启动时落 `cron_task_invalid`）。
    /// 不进序列化面：warning 文本已经承载同一事实，前端不需要第二个形状。
    #[serde(skip)]
    #[ts(skip)]
    pub cron_issues: Vec<CronTaskIssue>,
    /// 整文件回落标记：读文件失败 / JSON 不合法 / 结构解析失败时置 `true`（本次用默认配置）。
    ///
    /// 消费者是 `lumir-cron` 线程的**重载**（change add-cron-conversational-registration design
    /// §3.3）：重读失败必须保留既有任务集，不能把一次坏读当成「任务表变空」。不进序列化面
    /// ——前端拿到的一直是「生效配置 + warning」，没有「是否回落」的语义。
    #[serde(skip)]
    #[ts(skip)]
    pub fallback: bool,
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
    /// `[cron]` 表（change add-cron-runtime-daemon）：结构化镜像，整表错形状（`"cron":
    /// "wrong-shape"`）或 `tasks` 非数组在解析期失败 → 整文件回落（design §7.2）。`tasks` 的
    /// 元素收成 `Value` 逐项校验（见 [`RawCronConfig`]）。
    cron: RawCronConfig,
}

/// `[cron]` 表的解析镜像：`tasks` 收成 `Vec<serde_json::Value>` 再**逐项**校验（与
/// `harness.permissions` / `vault.rule_files` 同形）——一项写坏只丢该项 + warning，其余任务
/// 照常生效。整个 `tasks` 键给错类型（`"tasks": "wrong-shape"`）仍走整文件回落（既有模型）。
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawCronConfig {
    tasks: Option<Vec<serde_json::Value>>,
}

/// `[vault]` 表的解析镜像。两个字段都是「缺席 → `None` → 用默认；显式给出 → 逐项校验」。
/// `ignore` 收成 `Map<String, Value>` 是为了**逐项**校验档位值（一个坏档位只丢那一项 + warning，
/// 不拖垮整份配置）；整个键给错类型（`"ignore": "hidden"` / `"ignore": []`）仍走整文件回落
/// （既有模型，代价与 `rule_files` 同族，单测钉住）。
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawVaultConfig {
    rule_files: Option<Vec<serde_json::Value>>,
    ignore: Option<serde_json::Map<String, serde_json::Value>>,
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
    /// 侧栏宽度（change add-sidebar-resize-hide-and-root-create）：数值字段，类型不符
    /// （`"sidebar_width": "236"`）在解析期失败 → 整文件回落（与 `content_width` 同型同路）。
    sidebar_width: Option<f64>,
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
    /// 以 id 为键的映射（change add-model-automation-settings-oct24 §2.1）：值收成 `Value`
    /// 后**逐条**解析（条目级宽容，见 [`validate_provider_entry`]）。`"providers": "kimi"`
    /// 这种错形状仍是整文件回落（design §2.1 沿用 ADR 0002 §5 的既有模板）。
    providers: Option<serde_json::Map<String, serde_json::Value>>,
    permissions: RawHarnessPermissions,
    /// 权限模式（change add-harness-permission-modes，design §7）：闭集合取值，非法值到不了
    /// 这里——在 `validate()` 里回落默认 + warning；类型不符在 serde 解析期失败 → 整文件回落。
    permission_mode: Option<String>,
    loop_max: Option<u32>,
    warn_ctx_pct: Option<f64>,
    auto_compact: Option<bool>,
    /// 会话自动命名（change add-session-auto-naming；2026-10-18 配置面重塑）：开关 +
    /// provider / model 三键。表内类型不符（`"enabled": "yes"`、`"model": 3`）或整表错形状
    /// （`"session_naming": "on"`）在解析期失败 → 整文件回落（与 `[harness]` 其余字段同路）。
    session_naming: RawSessionNamingConfig,
    /// 图片语义命名（change add-semantic-image-naming，2026-10-18 配置面重塑）：开关 +
    /// provider / model 三键。表内类型不符（`"enabled": "yes"`、`"model": 3`）或整表错形状
    /// （`"attachment_naming": "on"`）在解析期失败 → 整文件回落（与 `[harness]` 其余字段同路）。
    attachment_naming: RawAttachmentNamingConfig,
    /// 子代理运行（change add-harness-subagents design §14）：**刻意不做结构化字段**。设计口径是
    /// 「类型不符**整节**回落 + warning」（其余 `[harness]` 节是整文件回落）：整节回退的意义
    /// 是「一个键写坏不拖垮 provider / 权限等其它节的配置」，直接结构化会退回整文件回落。
    /// 形状与字段在 [`validate_subagents`] 里解析。
    subagents: Option<serde_json::Value>,
}

/// `harness.subagents` 的解析镜像：六个字段都是「缺席 → 用默认；显式给出 → 校验 / 夹取」。
/// 未知键按既有口径静默忽略（与 `[harness]` 其余节同路）。
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawSubagentsConfig {
    enabled: Option<bool>,
    max_turns: Option<u32>,
    max_tokens: Option<u64>,
    timeout_secs: Option<u64>,
    max_subruns_per_turn: Option<u32>,
    max_concurrent: Option<u32>,
}

/// `harness.session_naming` 的解析镜像：三个字段都是「缺席 → `None` → 用默认；显式给出 →
/// 校验」。旧键 `auto_title` / `title_provider`（以及 provider 条目上的 `title_model`）不在
/// 本结构内——按未知键口径静默忽略、无兼容读取（2026-10-18 配置面重塑）。
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawSessionNamingConfig {
    enabled: Option<bool>,
    provider: Option<String>,
    model: Option<String>,
}

/// `harness.attachment_naming` 的解析镜像：三个字段都是「缺席 → `None` → 用默认；
/// 显式给出 → 校验」。
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawAttachmentNamingConfig {
    enabled: Option<bool>,
    provider: Option<String>,
    model: Option<String>,
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
/// **一次写副作用**（M365 退役值迁移 + change add-model-automation-settings-oct24 §3 的
/// preset 迁移）：两份迁移串在**同一份** `serde_json::Value` 上，最多写盘一次。
/// - 旧三档条目（`kimi` / `deepseek` / `mock`）缺 `preset` 时补上（已有值不覆盖）；
/// - `harness.providers.kimi.model` 命中 [`RETIRED_KIMI_MODEL`] 时改写为该条目的生效模型。
///
/// 两条都只改自己负责的键、其余键与未知字段逐键保留、判据幂等；本次生效值就是改写后的值。
/// 写失败只多一条 warning，不阻断加载（下次加载会再试一次）。
pub fn load_from(path: &Path) -> ConfigSnapshot {
    let path_str = path.display().to_string();
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return ConfigSnapshot {
                config: AppConfig::default(),
                warnings: vec![],
                path: path_str,
                diagnostics: vec![],
                cron_issues: vec![],
                // 文件不存在不是「读失败」：空配置就是它的有效语义（首次启动常态）。
                fallback: false,
            };
        }
        Err(e) => {
            return ConfigSnapshot {
                config: AppConfig::default(),
                warnings: vec![format!("无法读取配置文件 {path_str}：{e}，已使用默认配置")],
                path: path_str,
                diagnostics: vec![],
                cron_issues: vec![],
                fallback: true,
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
                diagnostics: vec![],
                cron_issues: vec![],
                fallback: true,
            };
        }
    };

    // 迁移先于结构解析：下面解析的就是「改写后」的那份，本次生效值与落盘内容同值。
    let preset_migration = migrate_provider_presets(&mut value);
    let migration = migrate_retired_kimi_model(&mut value);
    let parse_text = if preset_migration.rewritten() || migration.rewritten() {
        serde_json::to_string(&value).expect("serde_json::Value 一定可序列化")
    } else {
        // 未命中走原文解析：类型不符时的报错行号仍是原文件里的行
        text
    };

    match serde_json::from_str::<RawConfig>(&parse_text) {
        Ok(raw) => {
            let (config, mut diagnostics, cron_issues) = validate(raw);
            let mut write_failed = None;
            if preset_migration.rewritten() {
                diagnostics.push(ConfigDiagnostic {
                    code: "harness_provider_preset_migrated".to_string(),
                    path: Some("harness.providers".to_string()),
                    severity: DiagnosticSeverity::Warning,
                    message: format!(
                        "配置项 harness.providers 的旧条目已补齐 preset（{}）",
                        preset_migration.entries.join("、")
                    ),
                });
            }
            let retired_rewritten = migration.rewritten();
            match migration {
                RetiredKimiMigration::Rewritten { replacement } => {
                    diagnostics.push(ConfigDiagnostic {
                        code: "harness_model_retired_migrated".to_string(),
                        path: Some("harness.providers.kimi.model".to_string()),
                        severity: DiagnosticSeverity::Warning,
                        message: format!(
                            "配置项 harness.providers.kimi.model 的 {RETIRED_KIMI_MODEL} 已退役，已自动改写为 {replacement}"
                        ),
                    });
                }
                RetiredKimiMigration::NoReplacement => {
                    // 清单未声明任何模型：不内置替补值，只把话说清楚。
                    diagnostics.push(ConfigDiagnostic {
                        code: "harness_model_retired_unreplaceable".to_string(),
                        path: Some("harness.providers.kimi.model".to_string()),
                        severity: DiagnosticSeverity::Warning,
                        message: format!(
                            "配置项 harness.providers.kimi.model 的 {RETIRED_KIMI_MODEL} 已退役，但 models 清单未声明任何模型，无法自动改写——请在 config.json 中更新该配置"
                        ),
                    });
                }
                RetiredKimiMigration::NoHit => {}
            }
            if preset_migration.rewritten() || retired_rewritten {
                if let Err(e) = write_json_atomic(path, &value) {
                    write_failed = Some(e.message);
                }
            }
            if let Some(message) = write_failed {
                diagnostics.push(ConfigDiagnostic {
                    code: "config_migration_write_failed".to_string(),
                    path: None,
                    severity: DiagnosticSeverity::Warning,
                    message: format!("改写后的配置未能落盘（{message}），下次启动会再试一次"),
                });
            }
            ConfigSnapshot {
                config,
                warnings: diagnostics
                    .iter()
                    .map(|diagnostic| diagnostic.message.clone())
                    .collect(),
                path: path_str,
                diagnostics,
                cron_issues,
                fallback: false,
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
            diagnostics: vec![],
            cron_issues: vec![],
            fallback: true,
        },
    }
}

/// preset 一次性迁移（change add-model-automation-settings-oct24 §3.1，纯函数，可测）：
/// **不搬字段、不改 id、不改值**，只给旧三档条目补 `preset`。
///
/// - `providers` 不是对象 → 不做任何事（留给整文件回落）；
/// - 条目不是对象 → 跳过（校验侧给 warning）；
/// - `preset` 已存在 → 不动（用户显式值优先，含非法值——校验侧按整条忽略处置）；
/// - id 恰好是 `kimi` / `deepseek` / `mock` → 补对应预设；其它 id 不写（校验侧按
///   generic + warning 解释，design §3.1「未知 id 不迁移」）；
/// - **幂等**：第二次加载三个条目都已有 preset，`rewritten = false`，不再写盘。
struct ProviderPresetMigration {
    rewritten: bool,
    /// 本次补齐的 id（告警文案点名用；按映射键顺序）。
    entries: Vec<String>,
}

impl ProviderPresetMigration {
    fn rewritten(&self) -> bool {
        self.rewritten
    }
}

fn migrate_provider_presets(value: &mut serde_json::Value) -> ProviderPresetMigration {
    let mut result = ProviderPresetMigration {
        rewritten: false,
        entries: Vec::new(),
    };
    let Some(providers) = value
        .get_mut("harness")
        .and_then(|harness| harness.get_mut("providers"))
        .and_then(serde_json::Value::as_object_mut)
    else {
        return result;
    };
    for (id, entry) in providers.iter_mut() {
        let Some(entry) = entry.as_object_mut() else {
            continue;
        };
        if entry.contains_key("preset") {
            continue;
        }
        if !matches!(id.as_str(), "kimi" | "deepseek" | "mock") {
            continue;
        }
        entry.insert("preset".to_string(), serde_json::Value::String(id.clone()));
        result.rewritten = true;
        result.entries.push(id.clone());
    }
    result
}

/// 退役值迁移（纯函数，可测）的结果形态。
enum RetiredKimiMigration {
    /// 未命中：model 键不存在 / 不是退役值。
    NoHit,
    /// 命中并已改写：replacement = 改写目标（models 清单首项 id，来自配置，不内置替补值）。
    Rewritten { replacement: String },
    /// 命中但清单未声明任何模型：不改写、不伪造，由调用方给一条人话 warning。
    NoReplacement,
}

impl RetiredKimiMigration {
    fn rewritten(&self) -> bool {
        matches!(self, Self::Rewritten { .. })
    }
}

/// 退役值迁移（纯函数，可测）：`harness.providers.kimi.model` 去空白后等于
/// [`RETIRED_KIMI_MODEL`] 时，改写为该 provider **已声明 models 清单的首项 id**（M381：
/// 模型名一律来自配置，不内置替补值）。改写目标取自 raw JSON 里
/// `harness.providers.kimi.models` 的首个「对象 + 非空字符串 id」项——与 validate 的
/// 逐项校验口径一致（坏的项跳过，取首个可用 id）。
///
/// **只改这一个字符串**：链路上任一层不是对象、或该键不存在 / 不是字符串，一律不命中；
/// 命中也只换掉 model 的值——`kimi` 表里的 `api_key` / `base_url` / `models`、其他 provider、
/// 其他表与未知字段都逐键保留。用户手填的其他型号（含我们不认识的、以及同样已退役但我们
/// 从未写出过的 id）一律不动，改动面因此收敛到「本仓自己的旧出厂值」。
fn migrate_retired_kimi_model(value: &mut serde_json::Value) -> RetiredKimiMigration {
    let kimi = value
        .get_mut("harness")
        .and_then(|h| h.get_mut("providers"))
        .and_then(|p| p.get_mut("kimi"));
    let Some(kimi) = kimi else {
        return RetiredKimiMigration::NoHit;
    };
    let is_retired = matches!(
        kimi.get("model"),
        Some(serde_json::Value::String(model)) if model.trim() == RETIRED_KIMI_MODEL
    );
    if !is_retired {
        return RetiredKimiMigration::NoHit;
    }
    // 改写目标：清单首个可用 id。取不到 → 不伪造，交给调用方 warning。
    let replacement = kimi
        .get("models")
        .and_then(|models| models.as_array())
        .and_then(|items| {
            items.iter().find_map(|item| {
                item.as_object()
                    .and_then(|map| map.get("id"))
                    .and_then(|id| id.as_str())
                    .map(str::trim)
                    .filter(|id| !id.is_empty())
                    .map(str::to_string)
            })
        });
    match replacement {
        Some(replacement) => {
            *kimi.get_mut("model").expect("上面已确认 model 是字符串") =
                serde_json::Value::String(replacement.clone());
            RetiredKimiMigration::Rewritten { replacement }
        }
        None => RetiredKimiMigration::NoReplacement,
    }
}

/// 进程内 config.json 写锁：把「写 tmp + rename」整段串行化。启动期多个线程各自
/// `config::load()`（`restore_outcome` / `cron_loop` / 前端 `config_get`）可能同时命中退役值
/// 迁移，运行期还有前端回写——串行化让同进程内的写者不会互相截断 tmp、也不会让先发起的写
/// 在更晚的写之后再 rename。
static CONFIG_WRITE_LOCK: Mutex<()> = Mutex::new(());

/// 进程内 tmp 序号：与 pid 一起保证同进程内并发写各自拿到不同的 tmp 路径。
static CONFIG_TMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// config.json 的原子落盘：同目录唯一临时文件 + `sync_all` + rename 原子替换，缩进写
/// （配置要人可读可改，ADR 0002 §5）。
///
/// **写 config.json 的唯一落盘实现**：应用侧的写命令（`commands.rs` 的 `config_set_value` /
/// `write_last_vault` 等）与 config 模块自己的退役值迁移都调用这里——同一语义不留两处真源
/// （REVIEW.md「同一语义两处真源」条）。调用方之一是 [`load_from`] 的迁移修补写。
///
/// **并发写（M592）**：旧实现的 tmp 名固定为 `config.json.tmp`，两个写者会截断 / 写同一份
/// tmp，后 rename 的就把交错内容顶成正式配置（finding
/// `20261018-worker-m583-bug-config-load-config-json-tmp`）。现在两层防线：
/// - [`CONFIG_WRITE_LOCK`] 串行化同进程的写者；
/// - tmp 名带 pid + 进程内序号 + 随机段，跨进程（多实例）也不共用路径。
///
/// 每次 rename 落地的都是一份完整 JSON，不存在写坏的中间态；失败即清理 tmp。
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
    let body = serde_json::to_string_pretty(value).expect("配置 Value 一定可序列化");
    // 锁中毒只意味着某个写者 panic 过：tmp 名已唯一化，接手继续写不会碰到它的半成品，
    // 因此取回内部 guard 继续，而不是把配置写永久变成 panic。
    let _serialized = CONFIG_WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    write_file_atomic(path, body.as_bytes()).map_err(|failure| failure.into_command_error(path))
}

/// config.json 的「读—改—写同锁」入口（change add-cron-conversational-registration design §4.1）。
///
/// 旧形态的两条写入口 `commands::write_config_value_to` / `write_last_vault_to` 的读发生在取
/// [`CONFIG_WRITE_LOCK`] **之前**：两个写者可以各自读到旧版本，后写者把前者的改动顶掉（丢键）。
/// 本函数把读、改、原子替换放进同一把锁；**不新增第二套原子写实现**——锁内只做一次读 +
/// 一次 [`write_file_atomic`]。
///
/// - 读是宽容读入（缺失 / 不可解析 / 非对象一律按 `{}`）：与既有写回纪律同口径，未知顶层键在
///   可解析时逐键保留；
/// - 闭包只改它关心的键；返回 `Err` 时**不落盘**（文件逐字节不变）；
/// - `version` 由 [`crate::commands::bump_config_version`] 统一补齐（不降高版本）。
pub(crate) fn update_json_atomic(
    path: &Path,
    f: impl FnOnce(&mut serde_json::Value) -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    update_json_atomic_with(
        path,
        |value| {
            read_config_json_into(value, path);
            Ok(())
        },
        f,
    )
}

/// [`update_json_atomic`] 的**严格读**变体（change add-model-automation-settings-oct24 §2.8）：
/// 文件存在但不可解析 / 不是对象时返回解析错误，MUST NOT 按 `{}` 起——写通道拿宽容读入写作
/// 等于用一份用户没看见的默认状态盖掉坏文件。
///
/// 与宽容版共用同一把锁与同一个 [`write_file_atomic`]（不新增第二套原子写）；文件不存在仍按
/// 空对象处理（首次接入的主路径）。
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn update_json_atomic_strict(
    path: &Path,
    f: impl FnOnce(&mut serde_json::Value) -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    update_json_atomic_with(path, |value| read_config_json_strict_into(value, path), f)
}

/// 两个读入口共用的落盘骨架：建目录 → 取锁 → 读 → 改 → 补 version → 原子写。
fn update_json_atomic_with(
    path: &Path,
    read: impl FnOnce(&mut serde_json::Value) -> Result<(), CommandError>,
    f: impl FnOnce(&mut serde_json::Value) -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| {
            CommandError::new(
                "config_write_failed",
                format!("无法创建配置目录 {}：{e}", dir.display()),
            )
        })?;
    }
    let _serialized = CONFIG_WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut value = serde_json::json!({});
    read(&mut value)?;
    f(&mut value)?;
    crate::commands::bump_config_version(&mut value);
    let body = serde_json::to_string_pretty(&value).expect("配置 Value 一定可序列化");
    write_file_atomic(path, body.as_bytes()).map_err(|failure| failure.into_command_error(path))
}

/// 宽容读入的就地形态（缺失 / 不可解析 / 非对象一律按 `{}`，未知顶层键原样保留）。
fn read_config_json_into(target: &mut serde_json::Value, path: &Path) {
    let mut value: serde_json::Value = match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    };
    if !value.is_object() {
        value = serde_json::json!({});
    }
    *target = value;
}

/// 严格读入的就地形态：文件不存在 → 空对象；读失败 / JSON 不合法 / 非对象 → 解析错误
/// （错误带行号 / 列号，供设置面横幅显示）。
#[cfg_attr(not(test), allow(dead_code))]
fn read_config_json_strict_into(
    target: &mut serde_json::Value,
    path: &Path,
) -> Result<(), CommandError> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            *target = serde_json::json!({});
            return Ok(());
        }
        Err(e) => {
            return Err(CommandError::new(
                "config_parse_failed",
                format!("无法读取配置文件 {}：{e}", path.display()),
            )
            .param("path", path.display().to_string()))
        }
    };
    let mut value: serde_json::Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(e) => {
            return Err(CommandError::new(
                "config_parse_failed",
                format!(
                    "配置文件 {} 不是合法 JSON（第 {} 行，第 {} 列）：{}",
                    path.display(),
                    e.line(),
                    e.column(),
                    e
                ),
            )
            .param("path", path.display().to_string())
            .param("line", e.line().to_string())
            .param("column", e.column().to_string()))
        }
    };
    if !value.is_object() {
        return Err(CommandError::new(
            "config_parse_failed",
            format!(
                "配置文件 {} 的顶层不是对象（JSON 对象才是一份配置）",
                path.display()
            ),
        )
        .param("path", path.display().to_string()));
    }
    *target = std::mem::take(&mut value);
    Ok(())
}

/// 应用侧写 config.json 的共用读入（ADR 0002 §5 配置即数据）：读整份 JSON 为 `Value`，
/// 解析失败或不是对象按 `{}` 起——与写回纪律配套的宽容读入，未知字段原样保留在 `Value` 里。
///
/// 单一实现：[`update_json_atomic`] 与 `commands::write_last_vault_to` 共用
/// （REVIEW.md「同一语义两处真源」条）。
pub(crate) fn read_config_json(path: &Path) -> serde_json::Value {
    let mut value = serde_json::json!({});
    read_config_json_into(&mut value, path);
    value
}

/// 追加一条持久权限规则到 `[harness].permissions.allow`（change
/// harness-permission-rules-oct23 A1 / design §4）：全局作用域、去重按字符串全等、
/// 读—改—写同锁（与 `[harness].permission_mode` 的写回共用 [`CONFIG_WRITE_LOCK`]，因此
/// 不会被权限档写回顶掉）。
///
/// 规则文本由调用方从待决请求现算（后端单一真源），本函数只做出入形状与去重。
pub(crate) fn append_permission_rule_to(path: &Path, rule: &str) -> Result<(), CommandError> {
    let rule = rule.trim();
    if rule.is_empty() {
        return Err(CommandError::new(
            "permission_rule_invalid",
            "权限规则不能为空".to_string(),
        ));
    }
    update_json_atomic(path, |value| {
        let allow = permission_rules_mut(value);
        if !allow.iter().any(|entry| entry.as_str() == Some(rule)) {
            allow.push(serde_json::json!(rule));
        }
        Ok(())
    })
}

/// 删除一条持久权限规则（第一条全等匹配）。返回是否确实删掉了——不存在即安静成功
/// （幂等，change harness-permission-rules-oct23 design §4）。
pub(crate) fn remove_permission_rule_to(path: &Path, rule: &str) -> Result<bool, CommandError> {
    let rule = rule.trim();
    let mut removed = false;
    update_json_atomic(path, |value| {
        let allow = permission_rules_mut(value);
        if let Some(index) = allow.iter().position(|entry| entry.as_str() == Some(rule)) {
            allow.remove(index);
            removed = true;
        }
        Ok(())
    })?;
    Ok(removed)
}

/// `[harness].permissions.allow` 的可变数组槽：缺失 / 错形状就地重置为空数组（与
/// [`update_json_atomic`] 的宽容口径同路——一份错形状的配置不该让规则写回整条失败）。
fn permission_rules_mut(value: &mut serde_json::Value) -> &mut Vec<serde_json::Value> {
    for section in ["harness", "permissions"] {
        if !value.get(section).is_some_and(serde_json::Value::is_object) {
            value[section] = serde_json::json!({});
        }
    }
    let permissions = &mut value["harness"]["permissions"];
    if !permissions
        .get("allow")
        .is_some_and(serde_json::Value::is_array)
    {
        permissions["allow"] = serde_json::json!([]);
    }
    permissions["allow"].as_array_mut().expect("刚刚填过")
}

/// 原子替换写的失败阶段：只决定错误文案（沿用既有的「写入 / 落盘」两句），错误码不随之变。
enum AtomicWriteFailure {
    /// 写 tmp 或 `sync_all` 失败。
    Write {
        tmp: PathBuf,
        source: std::io::Error,
    },
    /// rename 失败（tmp 已完整写出并被清理）。
    Rename { source: std::io::Error },
    /// 连续 16 次生成的 tmp 名都撞上残留文件（只为把错误说清楚，不删残留）。
    NoUniqueTmp,
}

impl AtomicWriteFailure {
    fn into_command_error(self, path: &Path) -> CommandError {
        match self {
            Self::Write { tmp, source } => CommandError::new(
                "config_write_failed",
                format!("无法写入配置 {}：{source}", tmp.display()),
            ),
            Self::Rename { source } => CommandError::new(
                "config_write_failed",
                format!("无法落盘配置 {}：{source}", path.display()),
            ),
            Self::NoUniqueTmp => CommandError::new(
                "config_write_failed",
                format!(
                    "无法写入配置 {}：连续 16 次生成的临时文件名都撞上了残留文件",
                    path.display()
                ),
            ),
        }
    }
}

/// 同目录唯一 tmp + `sync_all` + rename；任何失败都先清理 tmp，不留半截文件。
///
/// tmp 名形如 `.config.json.lumir-{pid}-{seq}-{rand}.tmp`：同一进程的并发写由序号分开，
/// 多实例由 pid 分开，随机段把「pid 回收后撞上崩溃残留」的概率压到可忽略——真撞上时
/// `create_new` 报 `AlreadyExists`，换名重试（残留文件不删：它不是本次写的半成品）。
fn write_file_atomic(path: &Path, body: &[u8]) -> Result<(), AtomicWriteFailure> {
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("config.json");
    for _ in 0..16 {
        let tmp = parent.join(format!(
            ".{name}.lumir-{}-{}-{:016x}.tmp",
            std::process::id(),
            CONFIG_TMP_SEQ.fetch_add(1, Ordering::Relaxed),
            rand::random::<u64>(),
        ));
        let mut file = match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
        {
            Ok(file) => file,
            Err(source) if source.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(source) => return Err(AtomicWriteFailure::Write { tmp, source }),
        };
        use std::io::Write;
        if let Err(source) = file.write_all(body).and_then(|_| file.sync_all()) {
            drop(file);
            let _ = std::fs::remove_file(&tmp);
            return Err(AtomicWriteFailure::Write { tmp, source });
        }
        drop(file);
        if let Err(source) = std::fs::rename(&tmp, path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(AtomicWriteFailure::Rename { source });
        }
        return Ok(());
    }
    Err(AtomicWriteFailure::NoUniqueTmp)
}

/// 逐字段校验：非法值落回该字段默认值并附人话 warning。
///
/// 第三项 `cron_issues` 是 `[cron].tasks` 里**被丢弃**任务项的结构化记录（供调度线程启动
/// 时落 `cron_task_invalid` 诊断事件）；它不进 `AppConfig`、不序列化给前端。
fn validate(raw: RawConfig) -> (AppConfig, Vec<ConfigDiagnostic>, Vec<CronTaskIssue>) {
    let defaults = AppConfig::default();
    let mut sink = DiagnosticSink::default();

    let version = match raw.version {
        None => defaults.version,
        Some(v) if v > SCHEMA_VERSION => {
            sink.warn_at(
                "config_version_newer",
                "version",
                format!(
                    "配置文件版本 v{v} 高于本应用支持的 v{SCHEMA_VERSION}，已按 v{SCHEMA_VERSION} 解释；请升级应用"
                ),
            );
            SCHEMA_VERSION
        }
        Some(v) => v,
    };

    let last_vault = match raw.last_vault {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(s)) => Some(s),
        Some(_) => {
            sink.warn_at(
                "config_last_vault_invalid",
                "last_vault",
                "配置项 last_vault 应为字符串或 null，已忽略该值".to_string(),
            );
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
            other => sink.warn_at(
                "editor_mode_invalid",
                "editor.mode",
                format!("配置项 editor.mode 取值 \"{other}\" 非法（可选：md、code），已回退为 md"),
            ),
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
            sink.warn_at(
                "editor_font_family_empty",
                "editor.font_family",
                "配置项 editor.font_family 为空（或纯空白），已回退为基线字体".to_string(),
            );
            None
        }
        Some(value) => Some(value.to_string()),
    };
    let mono_font_family = match raw.editor.mono_font_family.as_deref().map(str::trim) {
        None => None,
        Some("") => {
            sink.warn_at(
                "editor_mono_font_family_empty",
                "editor.mono_font_family",
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
            sink.warn_at(
                "editor_font_size_range",
                "editor.font_size",
                format!(
                    "配置项 editor.font_size 取值 {value} 超出合法区间 [{FONT_SIZE_MIN}, {FONT_SIZE_MAX}]，已回退为 {DEFAULT_FONT_SIZE}"
                ),
            );
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
            other => sink.warn_at(
                "ui_theme_invalid",
                "ui.theme",
                format!("配置项 ui.theme 取值 \"{other}\" 非法（可选：light、dark、eink），已回退为 light"),
            ),
        }
    }

    // 栏宽（content-width-drag，M228）：区间判定照 `font_size` 模板——缺字段回落默认不告警、
    // 越界回落默认 + warning；类型不符同样走解析期整文件回落（单测钉住）。
    let mut content_width = defaults.ui.content_width;
    if let Some(value) = raw.ui.content_width {
        if (CONTENT_WIDTH_MIN..=CONTENT_WIDTH_MAX).contains(&value) {
            content_width = value;
        } else {
            sink.warn_at(
                "ui_content_width_range",
                "ui.content_width",
                format!(
                    "配置项 ui.content_width 取值 {value} 超出合法区间 [{CONTENT_WIDTH_MIN}, {CONTENT_WIDTH_MAX}]，已回退为 {DEFAULT_CONTENT_WIDTH}"
                ),
            );
        }
    }

    // 侧栏宽度（change add-sidebar-resize-hide-and-root-create 的 D1 裁决）：区间判定照
    // `content_width` 模板——缺字段回落默认不告警、越界回落默认 + warning；类型不符同样走
    // 解析期整文件回落（单测钉住）。运行期的「窗口四成」钳制在前端、不进本判定。
    let mut sidebar_width = defaults.ui.sidebar_width;
    if let Some(value) = raw.ui.sidebar_width {
        if (SIDEBAR_WIDTH_MIN..=SIDEBAR_WIDTH_MAX).contains(&value) {
            sidebar_width = value;
        } else {
            sink.warn_at(
                "ui_sidebar_width_range",
                "ui.sidebar_width",
                format!(
                    "配置项 ui.sidebar_width 取值 {value} 超出合法区间 [{SIDEBAR_WIDTH_MIN}, {SIDEBAR_WIDTH_MAX}]，已回退为 {DEFAULT_SIDEBAR_WIDTH}"
                ),
            );
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
            other => sink.warn_at(
                "ui_markdown_line_numbers_invalid",
                "ui.markdown_line_numbers",
                format!("配置项 ui.markdown_line_numbers 取值 \"{other}\" 非法（可选：on-demand、always、off），已回退为 on-demand"),
            ),
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
            other => sink.warn_at(
                "ui_language_invalid",
                "ui.language",
                format!("配置项 ui.language 取值 \"{other}\" 非法（可选：en、zh），已回退为 en"),
            ),
        }
    }

    let (keys, key_diagnostics) = validate_keys(raw.keys);
    sink.extend(key_diagnostics);

    let (log, log_diagnostics) = validate_log(raw.log);
    sink.extend(log_diagnostics);

    let (vault, vault_diagnostics) = validate_vault(raw.vault);
    sink.extend(vault_diagnostics);

    let (harness, harness_diagnostics) = validate_harness(raw.harness);
    sink.extend(harness_diagnostics);

    let (cron, cron_issues) = validate_cron(raw.cron, &mut sink);

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
                sidebar_width,
                markdown_line_numbers,
                language,
            },
            keys,
            log,
            vault,
            harness,
            cron,
        },
        sink.into_diagnostics(),
        cron_issues,
    )
}

/// `[cron]` 表的逐项校验（change add-cron-runtime-daemon，design §7.2）。
///
/// 每个任务项单独判定，**一项任务只报第一处问题**（与 `vault.ignore` 先判名字的口径同族）：
/// - 致命（丢该项 + warning + 一条 [`CronTaskIssue`]）：`id` 为空 / 含空白 / 与已生效任务
///   重复（重复 id 保留首项）、`vault` 不是绝对路径、`at` 不是 `HH:MM`、`days` 非法或空数组、
///   `prompt` 缺失或 trim 后为空；
/// - 非致命（保留任务）：`delivery` / `session` 闭集合外取值回落缺省 + warning，`model`
///   形状非法只丢该键 + warning。
///
/// 单条判定归 [`validate_cron_task`]（「一条合法任务」的唯一定义）；本函数只负责逐项循环与
/// 装载期处置（丢弃 + warning + 结构化 issue）。change add-cron-conversational-registration 引入
/// 的调度工具走同一个单条函数，差别只在处置（拒绝写入 + 结构化错误，不回落）。
///
/// 路径**是否存在**不在这里判定（design §7.2：装载期 stat 会拖慢启动，且外置盘可能后挂载）；
/// `model` 是否在 `[harness].providers.<provider>.models` 内也不在这里判定（清单本身可在
/// 配置里演化，运行期解析并给 `config_warning`，任务不丢）。
fn validate_cron(
    raw: RawCronConfig,
    sink: &mut DiagnosticSink,
) -> (CronConfig, Vec<CronTaskIssue>) {
    let Some(items) = raw.tasks else {
        return (CronConfig::default(), Vec::new());
    };
    validate_cron_items(&items, sink)
}

/// 逐项校验的循环体（装载期与只读读取 [`read_cron_tasks_at`] 共用）。
fn validate_cron_items(
    items: &[serde_json::Value],
    sink: &mut DiagnosticSink,
) -> (CronConfig, Vec<CronTaskIssue>) {
    let mut tasks: Vec<CronTask> = Vec::with_capacity(items.len());
    let mut issues: Vec<CronTaskIssue> = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let position_label = format!("cron.tasks 的第 {} 项", index + 1);
        let id_label = |id: &str| format!("cron.tasks 的 \"{id}\"");
        // 重复 id 保留首项：判据是**已生效**清单（前项被别的原因丢掉时，本项不算重复）。
        let existing_ids: Vec<String> = tasks.iter().map(|task| task.id.clone()).collect();
        match validate_cron_task(item, &position_label, &id_label, &existing_ids) {
            Ok(validated) => {
                sink.extend(validated.diagnostics);
                tasks.push(validated.task);
            }
            Err(rejection) => {
                reject_cron_task(sink, &mut issues, &rejection.label, rejection.issue);
            }
        }
    }
    (CronConfig { tasks }, issues)
}

/// 单条任务校验的失败：致命字段问题，或 id 与既有任务重复。
///
/// 两条通道的差别只在处置——装载期一律「丢弃 + warning」，工具侧（`cron_task_create`）
/// 把两者都变成拒绝写入：`Invalid` ⇒ `cron_task_invalid`，`Duplicate` ⇒ `cron_task_exists`
/// （工具查得到既有任务的 `at`，可以给模型一条可执行的方向）。
///
/// `label` 是这条问题应有的定位标签（在 [`validate_cron_task`] 里用两个 label 参数算好）：
/// id 阶段的问题用项定位，其余用任务定位，装载期的 warning 因此与回落前的实现逐字节一致。
pub(crate) struct CronTaskRejection {
    pub duplicate: bool,
    pub label: String,
    pub issue: CronTaskIssue,
}

/// 单条任务校验的结果：生效任务 + 非致命回落。
pub(crate) struct ValidatedCronTask {
    pub task: CronTask,
    /// 非致命回落的诊断（装载期逐条进 `ConfigSnapshot.diagnostics`；文案与回落前的实现
    /// 逐字节一致）。
    pub diagnostics: Vec<ConfigDiagnostic>,
    /// 非致命回落项（工具侧据此拒绝写入：模型可以改对，不像手改配置那样只能保留）。
    pub degraded: Vec<CronTaskIssue>,
}

/// 「什么是一条合法任务」的**唯一定义**（change add-cron-conversational-registration design §5）：
/// 字段顺序、致命 / 非致命的分界、每条 warning 的文案都只在这里。装载期与 `cron_task_create`
/// 共用同一实现与同一套原因文案。
///
/// - `position_label`：id 不可读时用的人话定位（装载期「cron.tasks 的第 N 项」；工具
///   「cron_task_create」）；
/// - `id_label`：id 可读后的人话定位（装载期带任务 id；工具用固定名）；
/// - `existing_ids`：重复 id 的判据（装载期 = 已生效项；工具 = 文件里的全部 id）。
pub(crate) fn validate_cron_task(
    item: &serde_json::Value,
    position_label: &str,
    id_label: &dyn Fn(&str) -> String,
    existing_ids: &[String],
) -> Result<ValidatedCronTask, CronTaskRejection> {
    let invalid = |field: &str, task: &str, reason: String| -> CronTaskRejection {
        let issue = CronTaskIssue {
            task: task.to_string(),
            field: field.to_string(),
            reason,
        };
        // id 阶段的问题（字段 `id` / `tasks`）用项定位，其余用任务定位——装载期 warning 与
        // 回落前的实现逐字节一致。
        let label = if issue.field == "tasks" || issue.field == "id" {
            position_label.to_string()
        } else {
            id_label(&issue.task)
        };
        CronTaskRejection {
            duplicate: false,
            label,
            issue,
        }
    };
    let Some(map) = item.as_object() else {
        return Err(invalid("tasks", "", "不是对象".to_string()));
    };

    // id：身份，先判——后面 warning 的定位也靠它。
    let id = match map.get("id") {
        Some(serde_json::Value::String(text))
            if !text.trim().is_empty() && !text.chars().any(char::is_whitespace) =>
        {
            text.clone()
        }
        Some(serde_json::Value::String(text)) => {
            return Err(invalid("id", text, "为空或含空白".to_string()));
        }
        _ => {
            return Err(invalid("id", "", "缺失或不是字符串".to_string()));
        }
    };
    let label = id_label(&id);
    if existing_ids.iter().any(|existing| existing == &id) {
        return Err(CronTaskRejection {
            duplicate: true,
            label: label.clone(),
            issue: CronTaskIssue {
                task: id,
                field: "id".to_string(),
                reason: "与前面的任务重复（保留首项）".to_string(),
            },
        });
    }

    let vault = match map.get("vault") {
        Some(serde_json::Value::String(text)) if Path::new(text).is_absolute() => text.clone(),
        Some(serde_json::Value::String(text)) => {
            return Err(invalid("vault", &id, format!("\"{text}\" 不是绝对路径")));
        }
        _ => {
            return Err(invalid("vault", &id, "缺失或不是字符串".to_string()));
        }
    };

    let at = match map.get("at").and_then(|value| value.as_str()) {
        Some(text) => match crate::cron::parse_at(text) {
            Ok(_) => text.to_string(),
            Err(reason) => {
                return Err(invalid("at", &id, format!("取值 \"{text}\" {reason}")));
            }
        },
        None => {
            return Err(invalid("at", &id, "缺失或不是字符串".to_string()));
        }
    };

    let days = match map.get("days") {
        None | Some(serde_json::Value::Null) => CronWeekday::ALL.to_vec(),
        Some(serde_json::Value::Array(entries)) => {
            if entries.is_empty() {
                return Err(invalid(
                    "days",
                    &id,
                    "为空数组（缺省即全周，空数组没有意义）".to_string(),
                ));
            }
            let mut days = Vec::with_capacity(entries.len());
            let mut invalid_entry = None;
            for entry in entries {
                match entry.as_str().and_then(crate::cron::parse_weekday) {
                    Some(day) => days.push(day),
                    None => {
                        invalid_entry = Some(entry.to_string());
                        break;
                    }
                }
            }
            if let Some(bad) = invalid_entry {
                return Err(invalid(
                    "days",
                    &id,
                    format!("含非法值 {bad}（可选：{}）", CronWeekday::list()),
                ));
            }
            days
        }
        Some(_) => {
            return Err(invalid("days", &id, "应为数组".to_string()));
        }
    };

    let prompt = match map.get("prompt").and_then(|value| value.as_str()) {
        Some(text) if !text.trim().is_empty() => text.to_string(),
        Some(_) => {
            return Err(invalid(
                "prompt",
                &id,
                "为空白或空串（没有载荷的任务无从运行）".to_string(),
            ));
        }
        None => {
            return Err(invalid(
                "prompt",
                &id,
                "缺失或不是字符串（没有载荷的任务无从运行）".to_string(),
            ));
        }
    };

    // 非致命三项：回落 / 丢键，任务保留。warning 文案与回落前的实现逐字节一致；同时记一条
    // 结构化回落项（工具侧据此拒绝写入——模型可以改对，手改配置的作者只能等下一次 warning）。
    let mut diagnostics = Vec::new();
    let mut degraded: Vec<CronTaskIssue> = Vec::new();
    let mut degrade = |code: &str, field: &str, reason: String, warning: String| {
        diagnostics.push(ConfigDiagnostic {
            code: code.to_string(),
            path: Some(format!("cron.tasks.{id}.{field}")),
            severity: DiagnosticSeverity::Warning,
            message: warning,
        });
        degraded.push(CronTaskIssue {
            task: id.clone(),
            field: field.to_string(),
            reason,
        });
    };
    let delivery = match map.get("delivery") {
        None | Some(serde_json::Value::Null) => DeliveryPolicy::default(),
        Some(serde_json::Value::String(text)) => match DeliveryPolicy::parse(text) {
            Some(policy) => policy,
            None => {
                degrade(
                    "cron_task_delivery_invalid",
                    "delivery",
                    format!(
                        "取值 \"{text}\" 非法（可选：notify-then-run、run-then-notify、silent-run）"
                    ),
                    format!(
                        "配置项 {label} 的 delivery 取值 \"{text}\" 非法（可选：notify-then-run、run-then-notify、silent-run），已回退为 notify-then-run"
                    ),
                );
                DeliveryPolicy::default()
            }
        },
        Some(_) => {
            degrade(
                "cron_task_delivery_invalid",
                "delivery",
                "不是字符串（期望闭集合取值）".to_string(),
                format!("配置项 {label} 的 delivery 不是字符串，已回退为 notify-then-run"),
            );
            DeliveryPolicy::default()
        }
    };
    let session = match map.get("session") {
        None | Some(serde_json::Value::Null) => SessionShape::default(),
        Some(serde_json::Value::String(text)) => match SessionShape::parse(text) {
            Some(shape) => shape,
            None => {
                degrade(
                    "cron_task_session_invalid",
                    "session",
                    format!("取值 \"{text}\" 非法（可选：new、dedicated）"),
                    format!(
                        "配置项 {label} 的 session 取值 \"{text}\" 非法（可选：new、dedicated），已回退为 new"
                    ),
                );
                SessionShape::default()
            }
        },
        Some(_) => {
            degrade(
                "cron_task_session_invalid",
                "session",
                "不是字符串（期望闭集合取值）".to_string(),
                format!("配置项 {label} 的 session 不是字符串，已回退为 new"),
            );
            SessionShape::default()
        }
    };
    let model = match map.get("model") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                degrade(
                    "cron_task_model_invalid",
                    "model",
                    "为空（期望模型 id 字符串）".to_string(),
                    format!("配置项 {label} 的 model 为空，已按未配置处理（该任务保留）"),
                );
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Some(_) => {
            degrade(
                "cron_task_model_invalid",
                "model",
                "应为模型 id 字符串".to_string(),
                format!("配置项 {label} 的 model 应为模型 id 字符串，已忽略该键（该任务保留）"),
            );
            None
        }
    };

    Ok(ValidatedCronTask {
        task: CronTask {
            id,
            vault,
            at,
            days,
            prompt,
            delivery,
            session,
            model,
        },
        diagnostics,
        degraded,
    })
}

/// 丢弃一条任务项：人话 warning 给人读，[`CronTaskIssue`] 供调度线程落诊断事件——两者同源
/// 同刻产生，避免「warning 说丢了一项、事件里没有」这类两处真源。
fn reject_cron_task(
    sink: &mut DiagnosticSink,
    issues: &mut Vec<CronTaskIssue>,
    label: &str,
    issue: CronTaskIssue,
) {
    sink.warn(
        "cron_task_invalid",
        Some(format!("cron.tasks.{}", issue.task)),
        format!("配置项 {label} {}，已丢弃该任务", issue.reason),
    );
    issues.push(issue);
}

/// 只读读取 `[cron].tasks` 的生效任务（`cron_task_list` 用）：**不写任何文件**、不触发退役值
/// 迁移（[`load_from`] 有那一笔写副作用，工具侧不能借用它）。
///
/// 宽容读入与装载期同口径：文件缺失 / 不可解析 / `[cron]` 形状不对一律按空表；逐项判定走
/// [`validate_cron_items`]（与装载期同一套校验与处置——非法项在列表里同样不可见）。
pub(crate) fn read_cron_tasks_at(path: &Path) -> Vec<CronTask> {
    let value = match std::fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(value) => value,
            Err(_) => return Vec::new(),
        },
        Err(_) => return Vec::new(),
    };
    let Some(items) = value
        .get("cron")
        .and_then(|cron| cron.get("tasks"))
        .and_then(serde_json::Value::as_array)
    else {
        return Vec::new();
    };
    let (config, _issues) = validate_cron_items(items, &mut DiagnosticSink::default());
    config.tasks
}

/// `[vault]` 表的校验（change vault-open-ignore-set §2.9 + change ignore-tiers-map）：
/// 两个字段都是「缺席 ⇒ 默认（不告警）；显式给出 ⇒ 逐项校验」。
///
/// `ignore` 的合法项 = 合法名字 + 合法档位值：名字非空、不含 `/`、不是 `.` / `..`、不含
/// gitignore 元字符（`*` `?` `[` `]` `!` `#` `\`）、首尾无空白（写模式的如 `"*.log": "lazy"`
/// 逐项忽略并给人话 warning——本配置只接受名字，不猜用户意图）；档位值是闭集合
/// `"hidden"` / `"lazy"`。同名冲突没有判定代码：名字是 JSON 对象的键，一个名字只能有一个档位。
///
/// 所有非法项都逐项丢弃并各给一条人话 warning，其余项照常生效（ADR 0002 §5：逐字段校验、
/// 非法值人话 warning、不得导致启动失败，也 MUST NOT 因为一项非法把其余字段一起回退）。
fn validate_vault(raw: RawVaultConfig) -> (VaultConfig, Vec<ConfigDiagnostic>) {
    let defaults = VaultConfig::default();
    let mut sink = DiagnosticSink::default();

    let rule_files = match raw.rule_files {
        None => defaults.rule_files,
        Some(items) => validate_rule_files(items, &mut sink),
    };
    let ignore = match raw.ignore {
        None => defaults.ignore,
        Some(map) => validate_ignore_map(map, &mut sink),
    };

    (VaultConfig { rule_files, ignore }, sink.into_diagnostics())
}

/// `rule_files` 的逐项校验（change vault-open-ignore-set §2.9）：合法项 = 非空、相对路径、
/// 不含 `..` 组件的 vault 相对路径。「文件是否存在」不在这里判定——那是装载时按 vault 根
/// 逐个探测的事，且「不存在」是常态（`.git/info/exclude` 在非 git vault 里就没有），
/// MUST NOT 报错、MUST NOT 给 warning。
fn validate_rule_files(items: Vec<serde_json::Value>, sink: &mut DiagnosticSink) -> Vec<String> {
    let mut rule_files = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let Some(text) = item.as_str() else {
            sink.warn_at(
                "vault_rule_file_invalid",
                "vault.rule_files",
                format!(
                    "配置项 vault.rule_files 的第 {} 项不是字符串，已忽略",
                    index + 1
                ),
            );
            continue;
        };
        if text.trim().is_empty() {
            sink.warn_at(
                "vault_rule_file_invalid",
                "vault.rule_files",
                format!("配置项 vault.rule_files 的第 {} 项为空，已忽略", index + 1),
            );
            continue;
        }
        if Path::new(text).is_absolute() {
            sink.warn_at(
                "vault_rule_file_invalid",
                "vault.rule_files",
                format!(
                    "配置项 vault.rule_files 的 \"{text}\" 是绝对路径（规则文件必须是 vault 相对路径），已忽略"
                ),
            );
            continue;
        }
        if Path::new(text)
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            sink.warn_at(
                "vault_rule_file_invalid",
                "vault.rule_files",
                format!(
                    "配置项 vault.rule_files 的 \"{text}\" 含 ..（不允许越出 vault 根），已忽略"
                ),
            );
            continue;
        }
        rule_files.push(text.to_string());
    }
    rule_files
}

/// 忽略地图的逐项校验（change ignore-tiers-map）：非法名字 / 非法档位值 ⇒ 丢该项 + 一条人话
/// warning，其余项照常生效。名字先判——名字非法时只报名字这一条，不再读它的值。
///
/// 档位值用字符串匹配而不是 `IgnoreTier` 反序列化：非法值必须落 warning 通道（只丢该项），
/// 反序列化会把一个错值升级成整文件回落（见 [`IgnoreTier`] 的注释）。
fn validate_ignore_map(
    map: serde_json::Map<String, serde_json::Value>,
    sink: &mut DiagnosticSink,
) -> BTreeMap<String, IgnoreTier> {
    let mut ignore = BTreeMap::new();
    for (name, value) in map {
        if let Err(reason) = validate_ignore_name(&name) {
            sink.warn(
                "vault_ignore_name_invalid",
                Some(format!("vault.ignore.{name}")),
                format!("配置项 vault.ignore 的名字 \"{name}\" {reason}，已忽略"),
            );
            continue;
        }
        let tier = match value.as_str() {
            Some("hidden") => IgnoreTier::Hidden,
            Some("lazy") => IgnoreTier::Lazy,
            Some(other) => {
                sink.warn(
                    "vault_ignore_tier_invalid",
                    Some(format!("vault.ignore.{name}")),
                    format!(
                        "配置项 vault.ignore 的 \"{name}\" 档位取值 \"{other}\" 非法（可选：hidden、lazy），已忽略"
                    ),
                );
                continue;
            }
            None => {
                sink.warn(
                    "vault_ignore_tier_invalid",
                    Some(format!("vault.ignore.{name}")),
                    format!("配置项 vault.ignore 的 \"{name}\" 档位不是字符串，已忽略"),
                );
                continue;
            }
        };
        ignore.insert(name, tier);
    }
    ignore
}

/// 忽略地图里**名字**的校验（change ignore-tiers-map，口径同 change ignore-tiers-config §2.2）：
/// 合法名字 = 非空、首尾无空白、不含 `/`、不是 `.` / `..`、不含 gitignore 元字符。
/// 非法 ⇒ 返回人话原因（由调用方拼进 warning）。
fn validate_ignore_name(name: &str) -> Result<(), &'static str> {
    if name.trim().is_empty() {
        return Err("为空");
    }
    if name != name.trim() {
        return Err("首尾有空白");
    }
    if name.contains('/') {
        return Err("含斜杠（只接受单个名字）");
    }
    if name == "." || name == ".." {
        return Err("不是有效名字");
    }
    if name.contains(['*', '?', '[', ']', '!', '#', '\\']) {
        return Err("含通配符（本配置只接受名字，不支持模式）");
    }
    Ok(())
}

/// `[harness]` 表的校验（change add-harness-probe §11）：照 `editor` / `ui` 的模板——缺字段
/// 回落默认（不告警），闭集合取值非法回落默认 + 人话 warning，数值越界回落默认 + warning；
/// 类型不符到不了这里（解析期整文件回落，见 [`RawHarnessConfig`]）。
///
/// 两处**逐项**校验的例外（与 `vault.rule_files` 同形）：`permissions.allow` / `deny` 的
/// 非法项逐项丢弃并各给一条 warning，其余项照常生效。空 `api_key` 是「未配置」的出厂状态，
/// **不告警**（理由见模块头）。
///
/// `attachment_naming`（图片语义命名）与 `session_naming`（会话自动命名）都在 2026-10-18
/// 配置面重塑后落进 harness 域，校验各走一个函数，形态对称：
/// [`validate_session_naming`] / [`validate_attachment_naming`]。
fn validate_harness(raw: RawHarnessConfig) -> (HarnessConfig, Vec<ConfigDiagnostic>) {
    let defaults = HarnessConfig::default();
    let mut sink = DiagnosticSink::default();

    // provider 映射：**逐条**解析——一个手写条目的笔误只丢它自己 + warning，MUST NOT 拖垮
    // 整份配置（design §2.1 的「条目级宽容」，与 `vault.ignore` 地图、`permissions.allow`
    // 清单的逐项口径同族）。被丢弃的条目只存在于 raw JSON，不参与 active / 命名 / wire 解析。
    let mut providers: BTreeMap<String, HarnessProviderConfig> = BTreeMap::new();
    for (id, value) in raw.providers.unwrap_or_default() {
        if let Some(entry) = validate_provider_entry(&id, &value, &mut sink) {
            providers.insert(id, entry);
        }
    }

    // 生效 provider：按「显式 → configured 优先 → 预设顺序 → 空」解析（design §2.5）。
    let provider = resolve_active_provider(&providers, raw.provider.as_deref(), &mut sink);

    let permissions = HarnessPermissions {
        allow: validate_harness_rules(raw.permissions.allow, "allow", &mut sink),
        deny: validate_harness_rules(raw.permissions.deny, "deny", &mut sink),
    };

    // 权限模式（change add-harness-permission-modes）：闭集合，缺字段 ⇒ 默认 `vault_write`
    // （不告警）；闭集合外取值 ⇒ 回落默认 + 人话 warning（与 `harness.provider` 同模板）。
    let mut permission_mode = defaults.permission_mode;
    if let Some(raw_mode) = raw.permission_mode.as_deref() {
        match PermissionMode::parse(raw_mode) {
            Some(mode) => permission_mode = mode,
            None => sink.warn_at(
                "harness_permission_mode_invalid",
                "harness.permission_mode",
                format!("配置项 harness.permission_mode 取值 \"{raw_mode}\" 非法（可选：read_only、vault_write、full_access），已回退为 vault_write"),
            ),
        }
    }

    let mut loop_max = defaults.loop_max;
    if let Some(value) = raw.loop_max {
        if (LOOP_MAX_MIN..=LOOP_MAX_MAX).contains(&value) {
            loop_max = value;
        } else {
            sink.warn_at(
                "harness_loop_max_range",
                "harness.loop_max",
                format!(
                    "配置项 harness.loop_max 取值 {value} 超出合法区间 [{LOOP_MAX_MIN}, {LOOP_MAX_MAX}]，已回退为 {DEFAULT_LOOP_MAX}"
                ),
            );
        }
    }

    // 区间判定同时挡 NaN（`contains` 对 NaN 为 false），与 `ui.content_width` 同口径。
    let mut warn_ctx_pct = defaults.warn_ctx_pct;
    if let Some(value) = raw.warn_ctx_pct {
        if (WARN_CTX_PCT_MIN..=WARN_CTX_PCT_MAX).contains(&value) {
            warn_ctx_pct = value;
        } else {
            sink.warn_at(
                "harness_warn_ctx_pct_range",
                "harness.warn_ctx_pct",
                format!(
                    "配置项 harness.warn_ctx_pct 取值 {value} 超出合法区间 [{WARN_CTX_PCT_MIN}, {WARN_CTX_PCT_MAX}]，已回退为 {DEFAULT_WARN_CTX_PCT}"
                ),
            );
        }
    }

    // bool 只有两种取值，缺字段即回落默认、不告警（与 `editor.line_wrap` 同路）；
    // 类型不符到不了这里（解析期整文件回落，单测钉住）。
    let auto_compact = raw.auto_compact.unwrap_or(defaults.auto_compact);

    // 两个命名配置面（会话自动命名 / 图片语义命名，2026-10-18 配置面重塑）：校验要对照
    // **选定 provider** 的模型清单，因此排在 providers 校验之后。
    let session_naming =
        validate_session_naming(raw.session_naming, &provider, &providers, &mut sink);
    let attachment_naming =
        validate_attachment_naming(raw.attachment_naming, &provider, &providers, &mut sink);

    // 子代理运行（change add-harness-subagents design §14）：独立解析 —— 类型不符只回落本节，
    // 不拖垮其余 `[harness]` 配置（理由见 `RawHarnessConfig::subagents` 的注释）。
    let subagents = validate_subagents(raw.subagents, &mut sink);

    (
        HarnessConfig {
            provider,
            providers,
            permissions,
            permission_mode,
            loop_max,
            warn_ctx_pct,
            auto_compact,
            session_naming,
            attachment_naming,
            subagents,
        },
        sink.into_diagnostics(),
    )
}

/// 生效 provider 的解析（design §2.5，**唯一**实现）：
///
/// 1. 显式 id 是有效条目 → 用它（**不因未配置而换**——那是用户的选择）；
/// 2. 缺省 → 按 `kimi → deepseek → generic`（组内 id 字典序）取第一个 **configured** 的条目；
/// 3. 没有 configured 条目 → 按同一顺序取第一个合法非 mock 条目；
/// 4. 映射为空（或只剩 mock）→ 空串（= 没有可用 provider）；
/// 5. 显式 id 悬空（不在有效映射内）→ 按 2/3 回退 + warning（点名原值与落点）。
///
/// **mock 不参与缺省回退**：它只在显式写 `provider: "mock"` 时生效——否则一份只剩 mock 的
/// 配置会在用户不知情时让整个应用进入 fixture 驱动模式。
fn resolve_active_provider(
    providers: &BTreeMap<String, HarnessProviderConfig>,
    raw: Option<&str>,
    sink: &mut DiagnosticSink,
) -> String {
    let requested = raw.map(str::trim).unwrap_or("");
    if requested.is_empty() {
        // 空字符串按「未写」处理 + warning（显式写空没有额外语义，design §2.5）。
        if raw.is_some() {
            sink.warn_at(
                "harness_provider_empty",
                "harness.provider",
                "配置项 harness.provider 为空，已按未写处理（按已配置的 provider 回退）"
                    .to_string(),
            );
        }
        return default_active_provider(providers);
    }
    if providers.contains_key(requested) {
        return requested.to_string();
    }
    let fallback = default_active_provider(providers);
    let landing = if fallback.is_empty() {
        "无可用 provider".to_string()
    } else {
        fallback.clone()
    };
    sink.warn_at(
        "harness_provider_unknown",
        "harness.provider",
        format!(
            "配置项 harness.provider 取值 \"{requested}\" 不在 harness.providers 表内，已回退为 {landing}"
        ),
    );
    fallback
}

/// 缺省回退的落点（design §2.5 的 2/3/4 步）：非 mock、按预设顺序 → configured 优先。
fn default_active_provider(providers: &BTreeMap<String, HarnessProviderConfig>) -> String {
    let ordered: Vec<(&String, &HarnessProviderConfig)> = providers
        .iter()
        .filter(|(_, entry)| entry.preset != ProviderPreset::Mock)
        .collect();
    // BTreeMap 已按 id 升序；再按 (preset, id) 稳定排序即规范顺序（kimi → deepseek → generic，
    // 组内 id 字典序）。
    let mut ordered = ordered;
    ordered.sort_by(|a, b| (a.1.preset, a.0.as_str()).cmp(&(b.1.preset, b.0.as_str())));
    ordered
        .iter()
        .find(|(_, entry)| entry.configured)
        .or_else(|| ordered.first())
        .map(|(id, _)| (*id).clone())
        .unwrap_or_default()
}

/// 单个 provider 条目的解析（design §2.1 / §2.2 的「非法处置」表）：任何一处形状非法都
/// **只丢该条 + 点名 warning**，返回 `None`；合法条目返回派生好的生效形态。
fn validate_provider_entry(
    id: &str,
    value: &serde_json::Value,
    sink: &mut DiagnosticSink,
) -> Option<HarnessProviderConfig> {
    let path = format!("harness.providers.{id}");
    let Some(map) = value.as_object() else {
        sink.warn(
            "harness_provider_invalid",
            Some(path.clone()),
            format!("配置项 {path} 不是对象，已忽略该 provider"),
        );
        return None;
    };
    if !provider_id_valid(id) {
        sink.warn(
            "harness_provider_id_invalid",
            Some(path.clone()),
            format!(
                "配置项 {path} 的 id 非法（小写字母 / 数字 / - / _，至多 {PROVIDER_ID_MAX} 字符、不含点），已忽略该 provider"
            ),
        );
        return None;
    }
    // preset：缺键 ⇒ generic + warning（迁移会补上旧三档）；闭集合外 / 非字符串 ⇒ 整条忽略。
    let preset = match map.get("preset") {
        None => {
            sink.warn(
                "harness_provider_preset_missing",
                Some(format!("{path}.preset")),
                format!(
                    "配置项 {path}.preset 缺失，按 generic 处理；请显式声明 kimi、deepseek、generic 或 mock"
                ),
            );
            ProviderPreset::Generic
        }
        Some(serde_json::Value::String(text)) => match ProviderPreset::parse(text.trim()) {
            Some(preset) => preset,
            None => {
                sink.warn(
                    "harness_provider_preset_invalid",
                    Some(format!("{path}.preset")),
                    format!(
                        "配置项 {path}.preset 取值 \"{text}\" 非法（可选：kimi、deepseek、generic、mock），已忽略该 provider"
                    ),
                );
                return None;
            }
        },
        Some(_) => {
            sink.warn(
                "harness_provider_preset_invalid",
                Some(format!("{path}.preset")),
                format!(
                    "配置项 {path}.preset 应为字符串（可选：kimi、deepseek、generic、mock），已忽略该 provider"
                ),
            );
            return None;
        }
    };
    // 保留 id：mock 预设只允许 id 恰好是 mock（design §2.2）。
    if preset == ProviderPreset::Mock && id != RESERVED_PROVIDER_ID {
        sink.warn(
            "harness_provider_preset_invalid",
            Some(format!("{path}.preset")),
            format!(
                "配置项 {path}.preset 为 mock，但 mock 是保留 id（只有 id 为 \"mock\" 的条目可使用该预设），已忽略该 provider"
            ),
        );
        return None;
    }

    let api_key = match provider_string_field(map, "api_key", &path, sink) {
        Ok(value) => value.unwrap_or_default(),
        Err(()) => return None,
    };
    let explicit_model = match provider_string_field(map, "model", &path, sink) {
        Ok(value) => value,
        Err(()) => return None,
    };
    let base_url = match provider_string_field(map, "base_url", &path, sink) {
        Ok(None) => None,
        Ok(Some(value)) => {
            if value.is_empty() {
                sink.warn(
                    "harness_base_url_empty",
                    Some(format!("{path}.base_url")),
                    format!(
                        "配置项 {path}.base_url 为空，已回退为{}",
                        preset
                            .official_base_url()
                            .map(|url| format!("官方地址 {url}"))
                            .unwrap_or_else(|| "未配置（该预设没有官方地址）".to_string())
                    ),
                );
                None
            } else {
                Some(value)
            }
        }
        Err(()) => return None,
    };
    let models = match map.get("models") {
        None | Some(serde_json::Value::Null) => Vec::new(),
        Some(serde_json::Value::Array(items)) => validate_harness_model_specs(items, &path, sink),
        Some(_) => {
            sink.warn(
                "harness_provider_invalid",
                Some(format!("{path}.models")),
                format!("配置项 {path}.models 应为数组，已忽略该 provider"),
            );
            return None;
        }
    };
    let wire_api = match map.get("wire_api") {
        None | Some(serde_json::Value::Null) => preset.default_wire_api(),
        Some(serde_json::Value::String(text)) => validate_wire_api(preset, text, &path, sink),
        Some(_) => {
            sink.warn(
                "harness_wire_api_invalid",
                Some(format!("{path}.wire_api")),
                format!("配置项 {path}.wire_api 应为字符串（可选：responses、chat_completions），已忽略该 provider"),
            );
            return None;
        }
    };
    let fixture = match provider_string_field(map, "fixture", &path, sink) {
        Ok(value) => value.filter(|value| !value.is_empty()),
        Err(()) => return None,
    };

    // generic 的 Base URL 是构造请求的唯一依据（该预设没有官方地址）：条目已填 Key 或模型
    // 却没写 Base URL 即阻断级（design §6.4）。完全空的条目例外——那是「刚点添加、还没填」
    // 的合法半成品，`configured = false`。
    if preset == ProviderPreset::Generic
        && base_url.is_none()
        && (!api_key.trim().is_empty() || !models.is_empty())
    {
        sink.warn(
            "harness_base_url_required",
            Some(format!("{path}.base_url")),
            format!(
                "配置项 {path} 是 OpenAI 兼容预设且已填写 api_key 或模型：请填写 base_url（该预设没有官方地址）"
            ),
        );
    }

    // 半配置（有 Key、无模型）是阻断级：保存进去就是一个用不了的 provider。
    if !api_key.trim().is_empty() && models.is_empty() {
        sink.warn(
            "harness_models_empty_when_configured",
            Some(path.clone()),
            format!(
                "配置项 {path} 已配置 api_key 但没有声明任何模型：请至少声明一个模型，或清除 api_key"
            ),
        );
    }

    // 生效模型（design §2.1 的 `model` 行）：显式值优先（不在清单内也保留 + warning；清单为空
    // 也保留）→ 缺省取清单首项 → 两者皆无为空串。
    let model = match explicit_model {
        Some(value) if !value.is_empty() => {
            if !models.is_empty() && !models.iter().any(|spec| spec.id == value) {
                sink.warn(
                    "harness_model_not_declared",
                    Some(format!("{path}.model")),
                    format!(
                        "配置项 {path}.model 的值 \"{value}\" 不在 models 清单内：上下文窗口按 {FALLBACK_CONTEXT_WINDOW} 保守估算，思考程度与图片能力按不支持处理；请在 models 中声明该模型或修正 model 值"
                    ),
                );
            }
            value
        }
        Some(_) => {
            match models.first() {
                Some(spec) => {
                    sink.warn(
                        "harness_model_empty",
                        Some(format!("{path}.model")),
                        format!(
                            "配置项 {path}.model 为空，已按 models 清单首项解析为 {}",
                            spec.id
                        ),
                    );
                    spec.id.clone()
                }
                None => {
                    sink.warn(
                    "harness_model_empty",
                    Some(format!("{path}.model")),
                    format!("配置项 {path}.model 为空，且 models 清单未声明任何模型，当前无可用模型"),
                );
                    String::new()
                }
            }
        }
        None => models
            .first()
            .map(|spec| spec.id.clone())
            .unwrap_or_default(),
    };

    let mut entry = HarnessProviderConfig {
        preset,
        api_key,
        model,
        base_url,
        models,
        wire_api,
        fixture,
        configured: false,
    };
    entry.configured = entry.derive_configured();
    Some(entry)
}

/// 条目内一个可选字符串字段的读取：缺键 / null ⇒ `Ok(None)`；字符串 ⇒ `Ok(Some(trim))`；
/// 其它类型 ⇒ 记一条诊断 + `Err(())`（调用方整条忽略该 provider，design §2.1 的条目级宽容）。
fn provider_string_field(
    map: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    path: &str,
    sink: &mut DiagnosticSink,
) -> Result<Option<String>, ()> {
    match map.get(field) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(text)) => Ok(Some(text.trim().to_string())),
        Some(_) => {
            sink.warn(
                "harness_provider_invalid",
                Some(format!("{path}.{field}")),
                format!("配置项 {path}.{field} 应为字符串，已忽略该 provider"),
            );
            Err(())
        }
    }
}

/// `harness.subagents` 的校验（change add-harness-subagents design §14）：缺节 / 空节 ⇒ 出厂值
/// 且不告警；**类型不符 ⇒ 整节回落 + 一条 warning**（不拖垮其余 `[harness]` 节）；
/// 数值越界 ⇒ **夹取到最近边界 + warning**（与 `[harness]` 其余数值键的「回落默认」不同：
/// 上限类旋钮贴着用户意图走，理由见模块内常量注释）。合法边界值原样接受。
fn validate_subagents(
    raw: Option<serde_json::Value>,
    sink: &mut DiagnosticSink,
) -> SubagentsConfig {
    let defaults = SubagentsConfig::default();
    let Some(raw) = raw else {
        return defaults;
    };
    // 非对象（字符串 / 数组 / 数字）一律整节回落：serde 允许「空序列 → 全默认结构体」，
    // 不先挡的话 `"subagents": []` 会静默变成缺省值而不是「形状非法」。
    if !raw.is_object() {
        sink.warn_at(
            "harness_subagents_invalid",
            "harness.subagents",
            "配置项 harness.subagents 不是对象，已整节回退为缺省值".to_string(),
        );
        return defaults;
    }
    let parsed: RawSubagentsConfig = match serde_json::from_value(raw) {
        Ok(parsed) => parsed,
        Err(error) => {
            sink.warn_at(
                "harness_subagents_invalid",
                "harness.subagents",
                format!("配置项 harness.subagents 形状非法（{error}），已整节回退为缺省值"),
            );
            return defaults;
        }
    };
    SubagentsConfig {
        enabled: parsed.enabled.unwrap_or(defaults.enabled),
        max_turns: clamp_subagent_value(
            "max_turns",
            parsed.max_turns,
            DEFAULT_SUBAGENT_MAX_TURNS,
            SUBAGENT_MAX_TURNS_MIN,
            SUBAGENT_MAX_TURNS_MAX,
            sink,
        ),
        max_tokens: clamp_subagent_value(
            "max_tokens",
            parsed.max_tokens,
            DEFAULT_SUBAGENT_MAX_TOKENS,
            SUBAGENT_MAX_TOKENS_MIN,
            SUBAGENT_MAX_TOKENS_MAX,
            sink,
        ),
        timeout_secs: clamp_subagent_value(
            "timeout_secs",
            parsed.timeout_secs,
            DEFAULT_SUBAGENT_TIMEOUT_SECS,
            SUBAGENT_TIMEOUT_SECS_MIN,
            SUBAGENT_TIMEOUT_SECS_MAX,
            sink,
        ),
        max_subruns_per_turn: clamp_subagent_value(
            "max_subruns_per_turn",
            parsed.max_subruns_per_turn,
            DEFAULT_MAX_SUBRUNS_PER_TURN,
            MAX_SUBRUNS_PER_TURN_MIN,
            MAX_SUBRUNS_PER_TURN_MAX,
            sink,
        ),
        max_concurrent: clamp_subagent_value(
            "max_concurrent",
            parsed.max_concurrent,
            DEFAULT_MAX_CONCURRENT,
            MAX_CONCURRENT_MIN,
            MAX_CONCURRENT_MAX,
            sink,
        ),
    }
}

/// 单个 `[harness.subagents]` 数值键的区间处理：缺席 ⇒ 缺省（不告警）；越界 ⇒ 夹取到最近
/// 边界 + 点名 warning；合法值原样。泛型只为 u32 / u64 两个宽度共用一份口径。
fn clamp_subagent_value<T: Copy + PartialOrd + std::fmt::Display>(
    key: &str,
    value: Option<T>,
    default: T,
    min: T,
    max: T,
    sink: &mut DiagnosticSink,
) -> T {
    let Some(value) = value else {
        return default;
    };
    if value < min {
        sink.warn_at(
            "harness_subagents_clamped",
            "harness.subagents",
            format!(
                "配置项 harness.subagents.{key} 取值 {value} 小于合法下限 {min}，已夹取为 {min}"
            ),
        );
        min
    } else if value > max {
        sink.warn_at(
            "harness_subagents_clamped",
            "harness.subagents",
            format!(
                "配置项 harness.subagents.{key} 取值 {value} 大于合法上限 {max}，已夹取为 {max}"
            ),
        );
        max
    } else {
        value
    }
}

/// `harness.session_naming` 的校验（change add-session-auto-naming，2026-10-18 配置面重塑；
/// 与 [`validate_attachment_naming`] 同形对称）：照 `[harness]` 的模板——缺键回落默认
/// （不告警）；`provider` 闭集合外取值回落 `None` + 一条人话 warning；类型不符到不了这里
/// （解析期整文件回落，见 [`RawSessionNamingConfig`]）。
///
/// `model`：非空值须在**选定 provider** 的 `models` 清单内声明，未声明时回落 `None`（= 该
/// provider 的生效模型）+ 人话 warning——不把未声明的模型发给 API。这一点与
/// `attachment_naming.model` 的「只点名不回落」**不同且有理由**：附件命名有资格闸（vision
/// 能力不满足就不发起、保留暂存名），回落等于替用户选模型；会话命名没有资格闸，选错模型
/// 只会让调用失败，回落生效模型是唯一诚实的可执行解。空串按「未配置」归一为 `None` + warning。
fn validate_session_naming(
    raw: RawSessionNamingConfig,
    session_provider: &str,
    providers: &BTreeMap<String, HarnessProviderConfig>,
    sink: &mut DiagnosticSink,
) -> SessionNamingConfig {
    let defaults = SessionNamingConfig::default();
    // bool 只有两种取值，缺键即回落默认、不告警（与 `auto_compact` 同路）；
    // 类型不符到不了这里（解析期整文件回落，单测钉住）。
    let enabled = raw.enabled.unwrap_or(defaults.enabled);

    let provider = validate_naming_provider(
        raw.provider.as_deref(),
        "harness.session_naming.provider",
        "会话命名",
        providers,
        sink,
    );

    let model = match raw.model.as_deref().map(str::trim) {
        None => None,
        Some("") => {
            sink.warn_at(
                "harness_naming_model_empty",
                "harness.session_naming.model",
                "配置项 harness.session_naming.model 为空，已按 null（跟随该 provider 的生效模型）处理"
                    .to_string(),
            );
            None
        }
        Some(value) => {
            let target = provider.as_deref().unwrap_or(session_provider);
            match providers.get(target) {
                Some(entry) if entry.preset == ProviderPreset::Mock => {
                    sink.warn_at(
                        "harness_naming_model_invalid",
                        "harness.session_naming.model",
                        format!(
                            "配置项 harness.session_naming.model 的值 \"{value}\" 无效：mock provider 没有模型清单，该键只能是 null；已按 null（跟随该 provider 的生效模型）处理"
                        ),
                    );
                    None
                }
                Some(entry) if entry.models.iter().any(|spec| spec.id == value) => {
                    Some(value.to_string())
                }
                Some(_) => {
                    sink.warn_at(
                        "harness_naming_model_invalid",
                        "harness.session_naming.model",
                        format!(
                            "配置项 harness.session_naming.model 的值 \"{value}\" 不在 provider（{target}）的 models 清单内：命名调用已回落为 {target} 的生效模型；请在 harness.providers.{target}.models 中声明该模型"
                        ),
                    );
                    None
                }
                // 目标 provider 不存在（无 active provider）：值保留不了，按 null 处理 + 点名。
                None => {
                    sink.warn_at(
                        "harness_naming_model_invalid",
                        "harness.session_naming.model",
                        format!(
                            "配置项 harness.session_naming.model 的值 \"{value}\" 没有可用的目标 provider（会话当前 provider 为空），已按 null 处理"
                        ),
                    );
                    None
                }
            }
        }
    };

    SessionNamingConfig {
        enabled,
        provider,
        model,
    }
}

/// 命名目标 `provider` 键的解析（两组命名表共用一份，MUST NOT 各写一遍）：
/// 缺键 / 空串 ⇒ `None`（跟随会话当前 provider，不告警）；有效条目 id ⇒ `Some(id)`
/// （**显式 `mock` 也算有效**——loader 层只认条目是否存在；设置面板另行禁止把 mock 设为
/// 目标）；悬空 id（不在映射内 / 被装载期忽略）⇒ `None` + 点名 warning（不阻断启动）。
fn validate_naming_provider(
    raw: Option<&str>,
    key: &str,
    label: &str,
    providers: &BTreeMap<String, HarnessProviderConfig>,
    sink: &mut DiagnosticSink,
) -> Option<String> {
    let value = raw.map(str::trim).filter(|value| !value.is_empty())?;
    if providers.contains_key(value) {
        return Some(value.to_string());
    }
    sink.warn(
        "harness_naming_provider_unknown",
        Some(key.to_string()),
        format!(
            "配置项 {key} 取值 \"{value}\" 不在 harness.providers 表内，{label}已回退为会话当前 provider"
        ),
    );
    None
}

/// `harness.attachment_naming` 的校验（change add-semantic-image-naming，2026-10-18 配置面
/// 重塑）：照 `[harness]` 的模板——缺键回落默认（不告警）；`provider` 闭集合外取值回落
/// `None` + 一条人话 warning；类型不符到不了这里（解析期整文件回落，见
/// [`RawAttachmentNamingConfig`]）。
///
/// `model` 的处置与旧 `naming_model` 不同（评审重塑口径「不静默降级」）：非空值**原样保留**，
/// 装载期只点名「当前不可用」（未在所选 provider 的清单内 / 未声明 `vision` / mock 下非空），
/// **不回落**成别的模型——回落到生效模型等于替用户选模型。真正的资格判定在每次发起命名时由
/// [`HarnessConfig::attachment_naming_target`] 按当时生效的 provider 现算（运行期切 provider
/// 后重新核对）；不满足即保留暂存名、不发请求。空串按「未配置」归一为 `None` + warning。
fn validate_attachment_naming(
    raw: RawAttachmentNamingConfig,
    session_provider: &str,
    providers: &BTreeMap<String, HarnessProviderConfig>,
    sink: &mut DiagnosticSink,
) -> AttachmentNamingConfig {
    let defaults = AttachmentNamingConfig::default();
    // bool 只有两种取值，缺键即回落默认、不告警（与 `auto_compact` 同路）；
    // 类型不符到不了这里（解析期整文件回落，单测钉住）。
    let enabled = raw.enabled.unwrap_or(defaults.enabled);

    let provider = validate_naming_provider(
        raw.provider.as_deref(),
        "harness.attachment_naming.provider",
        "图片语义命名",
        providers,
        sink,
    );

    let model = match raw.model.as_deref().map(str::trim) {
        None => None,
        Some("") => {
            sink.warn_at(
                "harness_naming_model_empty",
                "harness.attachment_naming.model",
                "配置项 harness.attachment_naming.model 为空，已按 null（跟随该 provider 的生效模型）处理"
                    .to_string(),
            );
            None
        }
        Some(value) => {
            let target = provider.as_deref().unwrap_or(session_provider);
            match providers.get(target) {
                Some(entry) if entry.preset == ProviderPreset::Mock => sink.warn_at(
                    "harness_naming_model_invalid",
                    "harness.attachment_naming.model",
                    format!(
                        "配置项 harness.attachment_naming.model 的值 \"{value}\" 无效：mock provider 没有模型清单，该键只能是 null；语义命名将不会发起"
                    ),
                ),
                Some(entry) => match entry.models.iter().find(|spec| spec.id == value) {
                    None => sink.warn_at(
                        "harness_naming_model_invalid",
                        "harness.attachment_naming.model",
                        format!(
                            "配置项 harness.attachment_naming.model 的值 \"{value}\" 不在 provider（{target}）的 models 清单内；语义命名将不会发起——请在 harness.providers.{target}.models 中声明该模型"
                        ),
                    ),
                    Some(spec) if !spec.vision => sink.warn_at(
                        "harness_naming_model_invalid",
                        "harness.attachment_naming.model",
                        format!(
                            "配置项 harness.attachment_naming.model 的值 \"{value}\" 未声明 vision 能力；语义命名将不会发起"
                        ),
                    ),
                    Some(_) => {}
                },
                // 目标 provider 不存在（无 active provider）：值原样保留（不静默换模型），
                // 运行期资格闸会跳过——装载期只点名一次。
                None => sink.warn_at(
                    "harness_naming_model_invalid",
                    "harness.attachment_naming.model",
                    format!(
                        "配置项 harness.attachment_naming.model 的值 \"{value}\" 没有可用的目标 provider（会话当前 provider 为空）；语义命名将不会发起"
                    ),
                ),
            }
            // 值原样保留（不静默换成别的模型）。
            Some(value.to_string())
        }
    };

    AttachmentNamingConfig {
        enabled,
        provider,
        model,
    }
}

/// wire 方言校验（change add-harness-chat-completions-dialect，design D1；change
/// add-model-automation-settings-oct24 §2.2 起按 preset 判支持面）：缺键由调用方取
/// [`ProviderPreset::default_wire_api`]（不告警）；闭集合外取值 / 该预设不支持的档位 ⇒
/// 回落预设缺省 + 人话 warning。
fn validate_wire_api(
    preset: ProviderPreset,
    raw: &str,
    path: &str,
    sink: &mut DiagnosticSink,
) -> WireApi {
    let value = raw.trim();
    let fallback = preset.default_wire_api();
    match WireApi::parse(value) {
        Some(api) if preset.supports_wire_api(api) => api,
        // 该预设不支持这一档：照实告警并回落——静默忽略会让用户以为请求已走该路径。
        Some(_) => {
            sink.warn(
                "harness_wire_api_unsupported",
                Some(format!("{path}.wire_api")),
                format!(
                    "配置项 {path}.wire_api 取值 \"{value}\" 当前不受 {} 预设支持，已回退为 {}",
                    preset.as_str(),
                    fallback.as_str()
                ),
            );
            fallback
        }
        None => {
            sink.warn(
                "harness_wire_api_invalid",
                Some(format!("{path}.wire_api")),
                format!(
                    "配置项 {path}.wire_api 取值 \"{value}\" 非法（可选：responses、chat_completions），已回退为 {}",
                    fallback.as_str()
                ),
            );
            fallback
        }
    }
}

/// 模型清单的**逐项**校验（M373，与 permissions 清单同形）：每项必须是对象，含非空
/// `id` 字符串；`effort` / `vision` 缺省 → false（保守默认）+ warning，类型不符 → 丢该项 +
/// warning；`window` 缺省 → [`FALLBACK_CONTEXT_WINDOW`] + warning，非正整数 / 超上限 → 丢该项 +
/// warning；重复 `id` → 保留先出现的，丢重项 + warning。合法项按原顺序生效，
/// 一项写坏不拖垮清单的其余项。
fn validate_harness_model_specs(
    items: &[serde_json::Value],
    path: &str,
    sink: &mut DiagnosticSink,
) -> Vec<HarnessModelSpec> {
    /// 窗口合法上限（tokens）：现役最大 1M，放宽一个数量级容纳未来大窗模型；
    /// 超出视为笔误（多写一个 0 就是 10 倍）。
    const WINDOW_MAX: u64 = 10_000_000;
    let mut specs = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let at = format!("{path}.models 的第 {} 项", index + 1);
        let item_path = format!("{path}.models[{index}]");
        let Some(map) = item.as_object() else {
            sink.warn(
                "harness_model_invalid",
                Some(item_path),
                format!("配置项 {at} 不是对象，已忽略"),
            );
            continue;
        };
        let Some(id) = map.get("id").and_then(|v| v.as_str()).map(str::trim) else {
            sink.warn(
                "harness_model_id_empty",
                Some(item_path),
                format!("配置项 {at} 缺少 id（或 id 不是字符串），已忽略"),
            );
            continue;
        };
        if id.is_empty() {
            sink.warn(
                "harness_model_id_empty",
                Some(item_path),
                format!("配置项 {at} 的 id 为空，已忽略"),
            );
            continue;
        }
        if specs.iter().any(|spec: &HarnessModelSpec| spec.id == id) {
            sink.warn(
                "harness_model_id_duplicate",
                Some(item_path),
                format!("配置项 {at} 的 id \"{id}\" 重复，已忽略"),
            );
            continue;
        }
        let effort = match map.get("effort") {
            None => {
                sink.warn(
                    "harness_model_effort_missing",
                    Some(item_path.clone()),
                    format!("配置项 {at}（id \"{id}\"）未声明 effort 能力，已按不支持处理"),
                );
                false
            }
            Some(serde_json::Value::Bool(value)) => *value,
            Some(_) => {
                sink.warn(
                    "harness_model_effort_invalid",
                    Some(item_path.clone()),
                    format!("配置项 {at}（id \"{id}\"）的 effort 应为布尔值，已忽略该项"),
                );
                continue;
            }
        };
        let vision = match map.get("vision") {
            None => {
                sink.warn(
                    "harness_model_vision_missing",
                    Some(item_path.clone()),
                    format!("配置项 {at}（id \"{id}\"）未声明 vision 能力，已按不支持处理"),
                );
                false
            }
            Some(serde_json::Value::Bool(value)) => *value,
            Some(_) => {
                sink.warn(
                    "harness_model_vision_invalid",
                    Some(item_path.clone()),
                    format!("配置项 {at}（id \"{id}\"）的 vision 应为布尔值，已忽略该项"),
                );
                continue;
            }
        };
        let window = match map.get("window") {
            None => {
                sink.warn(
                    "harness_model_window_missing",
                    Some(item_path.clone()),
                    format!("配置项 {at}（id \"{id}\"）未声明 window，已回退为 {FALLBACK_CONTEXT_WINDOW}"),
                );
                FALLBACK_CONTEXT_WINDOW
            }
            Some(value) => {
                let parsed = value
                    .as_u64()
                    .filter(|window| *window > 0 && *window <= WINDOW_MAX);
                match parsed {
                    Some(window) => window,
                    None => {
                        sink.warn(
                            "harness_model_window_invalid",
                            Some(item_path.clone()),
                            format!("配置项 {at}（id \"{id}\"）的 window 应为 1..={WINDOW_MAX} 的整数，已忽略该项"),
                        );
                        continue;
                    }
                }
            }
        };
        specs.push(HarnessModelSpec {
            id: id.to_string(),
            effort,
            vision,
            window,
        });
    }
    specs
}

/// 权限规则清单的**逐项**校验（与 `vault.rule_files` 同形）：非字符串 / 空串逐项丢弃并各给一条
/// warning，其余项按原顺序保留。规则的**匹配语义**不在这里判定（见 [`HarnessPermissions`]）。
fn validate_harness_rules(
    items: Option<Vec<serde_json::Value>>,
    key: &str,
    sink: &mut DiagnosticSink,
) -> Vec<String> {
    let Some(items) = items else {
        return Vec::new(); // 缺键 ⇒ 空规则表（= 只有默认分层），不告警
    };
    let mut rules = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let Some(text) = item.as_str() else {
            sink.warn_at(
                "harness_permission_rule_invalid",
                "harness.permissions",
                format!(
                    "配置项 harness.permissions.{key} 的第 {} 项不是字符串，已忽略",
                    index + 1
                ),
            );
            continue;
        };
        let trimmed = text.trim();
        if trimmed.is_empty() {
            sink.warn_at(
                "harness_permission_rule_invalid",
                "harness.permissions",
                format!(
                    "配置项 harness.permissions.{key} 的第 {} 项为空，已忽略",
                    index + 1
                ),
            );
            continue;
        }
        rules.push(trimmed.to_string());
    }
    rules
}

/// [keys] 表的形状校验（M132）：逐项判定，非法项丢弃并附人话 warning，其余项照常生效。
/// 只判形状——键位非空且不含空白（含空白即多段 chord，本版不支持）、值是非空字符串或
/// null；命令 id 是否已知由前端键位层判定（模块头有理由）。
fn validate_keys(
    raw: serde_json::Value,
) -> (HashMap<String, Option<String>>, Vec<ConfigDiagnostic>) {
    let mut keys = HashMap::new();
    let mut sink = DiagnosticSink::default();
    let map = match raw {
        serde_json::Value::Null => return (keys, sink.into_diagnostics()),
        serde_json::Value::Object(map) => map,
        _ => {
            sink.warn_at(
                "keys_invalid",
                "keys",
                "配置项 keys 应为对象（键位 → 命令 id，或 null 解绑），已忽略".to_string(),
            );
            return (keys, sink.into_diagnostics());
        }
    };
    for (key, value) in map {
        if key.trim().is_empty() || key.chars().any(char::is_whitespace) {
            sink.warn_at(
                "keys_invalid",
                "keys",
                format!(
                    "配置项 keys 的键位 \"{key}\" 非法（空或含空白；多段 chord 暂不支持），已忽略"
                ),
            );
            continue;
        }
        match value {
            serde_json::Value::Null => {
                keys.insert(key, None);
            }
            serde_json::Value::String(command) if !command.trim().is_empty() => {
                keys.insert(key, Some(command));
            }
            serde_json::Value::String(_) => sink.warn(
                "keys_invalid",
                Some(format!("keys.{key}")),
                format!("配置项 keys.{key} 的命令为空，已忽略（解绑请写 null）"),
            ),
            _ => sink.warn(
                "keys_invalid",
                Some(format!("keys.{key}")),
                format!("配置项 keys.{key} 的值应为命令 id 字符串或 null（解绑），已忽略"),
            ),
        }
    }
    (keys, sink.into_diagnostics())
}

/// [log] 表的形状校验（add-diagnostics-logging）：与 keys 表同口径——整表非法只丢这一项
/// 并附人话 warning，`level` 取值非法只回退该字段到默认 `info`（ADR 0002 §5：非法配置不
/// 导致启动失败）。未知键忽略（向前兼容）。
fn validate_log(raw: serde_json::Value) -> (LogConfig, Vec<ConfigDiagnostic>) {
    let defaults = LogConfig::default();
    let mut sink = DiagnosticSink::default();
    let map = match raw {
        serde_json::Value::Null => return (defaults, sink.into_diagnostics()),
        serde_json::Value::Object(map) => map,
        _ => {
            sink.warn_at(
                "log_invalid",
                "log",
                "配置项 log 应为对象（如 {\"log\": {\"level\": \"info\"}}），已忽略".to_string(),
            );
            return (defaults, sink.into_diagnostics());
        }
    };
    let level = match map.get("level") {
        None | Some(serde_json::Value::Null) => defaults.level,
        Some(serde_json::Value::String(text)) => {
            match text.as_str() {
                "info" => LogLevel::Info,
                "off" => LogLevel::Off,
                other => {
                    sink.warn_at(
                    "log_level_invalid",
                    "log.level",
                    format!("配置项 log.level 取值 \"{other}\" 非法（可选：info、off），已回退为 info"),
                );
                    defaults.level
                }
            }
        }
        Some(_) => {
            sink.warn_at(
                "log_level_invalid",
                "log.level",
                "配置项 log.level 应为字符串（info / off），已回退为 info".to_string(),
            );
            defaults.level
        }
    };
    (LogConfig { level }, sink.into_diagnostics())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// 无 tempfile 依赖（低依赖取向）：文件名带 pid + 序号 + 随机段，`create_new` 独占新建，
    /// 用完即删。不用 `fs::write`：pid 回收后 crash 残留的同名文件会被静默覆盖 / 复用。
    struct TempFile(PathBuf);
    static SEQ: AtomicU32 = AtomicU32::new(0);

    impl TempFile {
        fn new(content: &str) -> Self {
            let base = std::env::temp_dir();
            for _ in 0..16 {
                let path = base.join(format!(
                    "lumir-config-test-{}-{}-{:016x}.json",
                    std::process::id(),
                    SEQ.fetch_add(1, Ordering::Relaxed),
                    rand::random::<u64>(),
                ));
                let mut file = match std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&path)
                {
                    Ok(file) => file,
                    Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(err) => panic!("create temp config {}: {err}", path.display()),
                };
                file.write_all(content.as_bytes())
                    .expect("write temp config");
                return Self(path);
            }
            panic!("create temp config: 16 次随机文件名全部撞名");
        }
        fn missing() -> Self {
            // 「文件不存在」是被测前提，无法独占新建；16 位十六进制随机段把与 crash 残留
            // 撞名的概率压到可忽略。
            Self(std::env::temp_dir().join(format!(
                "lumir-config-test-missing-{}-{}-{:016x}.json",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::Relaxed),
                rand::random::<u64>(),
            )))
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    /// 独占的临时目录（M592 并发写测试要能检查目录里有没有 tmp 残留）：名字同样是
    /// pid + 序号 + 随机段，`create_dir` 撞名重试，Drop 时整目录删除。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir();
            for _ in 0..16 {
                let dir = base.join(format!(
                    "lumir-config-{tag}-{}-{}-{:016x}",
                    std::process::id(),
                    SEQ.fetch_add(1, Ordering::Relaxed),
                    rand::random::<u64>(),
                ));
                match std::fs::create_dir(&dir) {
                    Ok(()) => return Self(dir),
                    Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(err) => panic!("create temp dir {}: {err}", dir.display()),
                }
            }
            panic!("create temp dir: 16 次随机目录名全部撞名");
        }

        fn config_path(&self) -> PathBuf {
            self.0.join("config.json")
        }

        /// 目录里的文件名（用于断言「不留 tmp 残留」）。
        fn entries(&self) -> Vec<String> {
            let mut names: Vec<String> = std::fs::read_dir(&self.0)
                .expect("读临时目录")
                .map(|entry| entry.expect("目录项").file_name().to_string_lossy().into())
                .collect();
            names.sort();
            names
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
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
    fn missing_ui_sidebar_width_takes_default() {
        // 老配置文件（change add-sidebar-resize-hide-and-root-create 之前写入）没有这一项：
        // 回落默认 236（D1 裁决）、不产生 warning。
        let f = TempFile::new(r#"{"version":1,"ui":{"theme":"dark"}}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.ui.sidebar_width, DEFAULT_SIDEBAR_WIDTH);
        assert_eq!(snap.config.ui.theme, UiTheme::Dark, "同表其它字段不受影响");
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
        // 整个 [ui] 表缺失同样回落默认。
        let f = TempFile::new(r#"{"version":1}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.ui.sidebar_width, DEFAULT_SIDEBAR_WIDTH);
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    #[test]
    fn explicit_ui_sidebar_width_is_loaded() {
        let f = TempFile::new(r#"{"ui":{"sidebar_width":320}}"#);
        let snap = load_from(&f.0);
        assert_eq!(snap.config.ui.sidebar_width, 320.0);
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    #[test]
    fn out_of_range_ui_sidebar_width_falls_back_with_warning() {
        // 区间 [180, 480]（D1 裁决）：两端之外都回落默认 + 恰一条 warning。
        for raw in [
            r#"{"ui":{"sidebar_width":100}}"#,
            r#"{"ui":{"sidebar_width":600}}"#,
        ] {
            let snap = load_from(&TempFile::new(raw).0);
            assert_eq!(snap.config.ui.sidebar_width, DEFAULT_SIDEBAR_WIDTH, "{raw}");
            assert_eq!(snap.warnings.len(), 1, "{raw}: {:?}", snap.warnings);
            assert!(
                snap.warnings[0].contains("ui.sidebar_width"),
                "{raw}: {:?}",
                snap.warnings
            );
        }
        // 端点值合法（含端点）。
        for edge in [180, 480] {
            let f = TempFile::new(&format!(r#"{{"ui":{{"sidebar_width":{edge}}}}}"#));
            let snap = load_from(&f.0);
            assert_eq!(snap.config.ui.sidebar_width, f64::from(edge));
            assert!(snap.warnings.is_empty(), "{edge}: {:?}", snap.warnings);
        }
    }

    #[test]
    fn wrong_type_ui_sidebar_width_falls_back_entire_file() {
        // 与 `wrong_type_ui_content_width_falls_back_entire_file` 同路：数值字段写成字符串在
        // serde 解析期失败 → 整文件回落，不出现逐字段类型容忍。
        let f = TempFile::new(
            r#"{"last_vault":"/tmp/vault","ui":{"sidebar_width":"236","theme":"dark"}}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(snap.config, AppConfig::default(), "应整份落回默认");
        assert_eq!(snap.config.ui.sidebar_width, DEFAULT_SIDEBAR_WIDTH);
        assert_eq!(snap.config.ui.theme, UiTheme::Light);
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
        // 也能绿（REVIEW.md 「断言等价于子串」条）。
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
        // 而漂移）。只测第一组的话，把实现写成别的键的副本也能绿（REVIEW.md 「断言等价于子串」条）。
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

    /// 语义②：显式 `[]` ⇒ 没有用户规则来源（只剩两档默认名字）——与「缺键」是**两种不同的配置**，
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
    // `[vault]` 的忽略地图（change ignore-tiers-map，口径承接 ignore-tiers-config §2.2）
    // -----------------------------------------------------------------------

    /// 默认地图的不变量：14 名逐项等于今天的名单、档位划分仍是 2 hidden + 12 lazy——
    /// 名单从代码常量变配置默认时**不漏一个名字**（行为的唯一有意变化是惰性名从不可见变惰性可见）。
    #[test]
    fn default_ignore_map_partitions_the_legacy_names() {
        let map = VaultConfig::default().ignore;
        let mut names: Vec<&str> = map.keys().map(String::as_str).collect();
        names.sort_unstable();
        let mut legacy = vec![
            ".git",
            ".DS_Store",
            "node_modules",
            ".venv",
            "venv",
            "__pycache__",
            ".next",
            ".nuxt",
            ".cache",
            ".pnpm-store",
            ".tox",
            ".gradle",
            "target",
            "dist",
        ];
        legacy.sort_unstable();
        assert_eq!(names, legacy, "默认地图的键必须逐项等于既有 14 名");
        assert_eq!(map.len(), 14);
        assert_eq!(DEFAULT_IGNORE.len(), 14);
        let hidden: Vec<&str> = map
            .iter()
            .filter(|(_, tier)| **tier == IgnoreTier::Hidden)
            .map(|(name, _)| name.as_str())
            .collect();
        assert_eq!(
            hidden,
            [".DS_Store", ".git"],
            "BTreeMap 迭代按键序；档位划分仍是 2 hidden"
        );
        assert_eq!(
            map.values()
                .filter(|tier| **tier == IgnoreTier::Lazy)
                .count(),
            12
        );
        // A3 档仍不纳入（Alex 2026-09-28 裁决）；本仓产物目录 2026-10-18 起也不纳入
        for not_included in ["build", "out", "vendor", "test-results", "perf-results"] {
            assert!(
                !map.contains_key(not_included),
                "{not_included} 不该在内置默认里"
            );
        }
    }

    /// 缺键 / 缺节 / 显式 `null` ⇒ 整图取代码内置默认，且不告警。
    #[test]
    fn ignore_map_defaults_when_missing() {
        for raw in [
            r#"{"version":1}"#,
            r#"{"version":1,"vault":{}}"#,
            r#"{"version":1,"vault":{"rule_files":[]}}"#,
            r#"{"version":1,"vault":{"ignore":null}}"#,
        ] {
            let snap = load_from(&TempFile::new(raw).0);
            assert_eq!(
                snap.config.vault.ignore,
                AppConfig::default().vault.ignore,
                "{raw}"
            );
            assert!(snap.warnings.is_empty(), "{raw}: {:?}", snap.warnings);
        }
    }

    /// 写了就是**整图替换**（不是「只覆盖写到的名字」）：只写一个名字 ⇒ 其余 15 名全不在图里。
    #[test]
    fn ignore_map_replaces_the_whole_default() {
        let snap = load_from(&TempFile::new(r#"{"vault":{"ignore":{"scratch":"hidden"}}}"#).0);
        assert_eq!(
            snap.config.vault.ignore.len(),
            1,
            "{:?}",
            snap.config.vault.ignore
        );
        assert_eq!(
            snap.config.vault.ignore.get("scratch"),
            Some(&IgnoreTier::Hidden)
        );
        assert!(
            !snap.config.vault.ignore.contains_key("node_modules"),
            "默认地图必须被整图替换（不是逐名合并）"
        );
        assert!(!snap.config.vault.ignore.contains_key(".git"));
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    /// 显式 `{}` 是「两档都没有名字」——与缺键是两种不同的配置。
    #[test]
    fn ignore_map_empty_object_means_empty_tiers() {
        let snap = load_from(&TempFile::new(r#"{"vault":{"ignore":{}}}"#).0);
        assert!(snap.config.vault.ignore.is_empty());
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    /// 名字非法：五类形态逐项丢弃 + 各自一条人话 warning，合法项照常生效。
    #[test]
    fn ignore_map_rejects_non_names_one_by_one_and_keeps_the_rest() {
        let raw = r#"{"vault":{"ignore":{"*.log":"lazy","a/b":"hidden",".":"lazy","..":"hidden","  pad  ":"hidden","":"lazy",".git":"hidden",".DS_Store":"hidden"}}}"#;
        let snap = load_from(&TempFile::new(raw).0);
        let mut keys: Vec<&str> = snap
            .config
            .vault
            .ignore
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [".DS_Store", ".git"],
            "非法名字全丢、合法名字保留：{:?}",
            snap.config.vault.ignore
        );
        assert_eq!(snap.warnings.len(), 6, "{:?}", snap.warnings);
        for needle in ["含通配符", "含斜杠", "不是有效名字", "首尾有空白", "为空"]
        {
            assert!(
                snap.warnings.iter().any(|w| w.contains(needle)),
                "应有警告点名 {needle}：{:?}",
                snap.warnings
            );
        }
        assert!(
            snap.warnings.iter().all(|w| w.contains("vault.ignore")),
            "{:?}",
            snap.warnings
        );
    }

    /// 档位值非法：非字符串与闭集合外的字符串各丢该项 + 一条 warning，同图其余项生效。
    #[test]
    fn ignore_map_rejects_bad_tier_values_one_by_one() {
        let raw = r#"{"vault":{"ignore":{".git":"hidden","node_modules":"invisible","target":3}}}"#;
        let snap = load_from(&TempFile::new(raw).0);
        assert_eq!(
            snap.config.vault.ignore.len(),
            1,
            "{:?}",
            snap.config.vault.ignore
        );
        assert_eq!(
            snap.config.vault.ignore.get(".git"),
            Some(&IgnoreTier::Hidden)
        );
        assert_eq!(snap.warnings.len(), 2, "{:?}", snap.warnings);
        assert!(
            snap.warnings
                .iter()
                .any(|w| w.contains("\"node_modules\"") && w.contains("非法（可选：hidden、lazy）")),
            "{:?}",
            snap.warnings
        );
        assert!(
            snap.warnings
                .iter()
                .any(|w| w.contains("\"target\"") && w.contains("不是字符串")),
            "{:?}",
            snap.warnings
        );
    }

    /// 单键地图里同名冲突结构上不存在：JSON 重复键按解析库口径后者覆盖，不产生 warning
    /// （「两键都有 ⇒ 按 hidden 生效 + warning」的旧规则已随两键形态删除，MUST NOT 请回来）。
    #[test]
    fn duplicate_json_key_keeps_last_value_without_warning() {
        let snap = load_from(
            &TempFile::new(r#"{"vault":{"ignore":{"target":"lazy","target":"hidden"}}}"#).0,
        );
        assert_eq!(
            snap.config.vault.ignore.get("target"),
            Some(&IgnoreTier::Hidden)
        );
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    /// 整个 `ignore` 键给错类型 ⇒ 整文件回落（既有解析模型的性质，与 `editor.font_size` 同族）。
    #[test]
    fn wrong_type_ignore_map_falls_back_entire_file() {
        for raw in [
            r#"{"last_vault":"/tmp/vault","vault":{"ignore":"hidden"}}"#,
            r#"{"last_vault":"/tmp/vault","vault":{"ignore":[]}}"#,
            r#"{"last_vault":"/tmp/vault","vault":{"ignore":["hidden"]}}"#,
        ] {
            let snap = load_from(&TempFile::new(raw).0);
            assert_eq!(snap.config, AppConfig::default(), "{raw} 应整份落回默认");
            assert_eq!(snap.config.last_vault, None, "{raw}");
            assert_eq!(snap.warnings.len(), 1, "{raw}: {:?}", snap.warnings);
        }
    }

    /// 合法地图不产生任何 warning；档位值一名字一档、逐项落进地图。
    #[test]
    fn valid_ignore_map_is_clean() {
        let snap = load_from(
            &TempFile::new(
                r#"{"vault":{"ignore":{".git":"hidden","node_modules":"lazy","target":"hidden"}}}"#,
            )
            .0,
        );
        assert_eq!(
            snap.config.vault.ignore.get(".git"),
            Some(&IgnoreTier::Hidden)
        );
        assert_eq!(
            snap.config.vault.ignore.get("node_modules"),
            Some(&IgnoreTier::Lazy)
        );
        assert_eq!(
            snap.config.vault.ignore.get("target"),
            Some(&IgnoreTier::Hidden),
            "档位由名字自己的值决定"
        );
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
    }

    // -----------------------------------------------------------------------
    // `[harness]` 表（change add-harness-probe §11，M301；
    // change add-model-automation-settings-oct24 起 provider 是动态映射）
    // -----------------------------------------------------------------------

    /// 旧实现的固定 tmp 名（`config.json.tmp`）不再被踩（M592）：崩溃残留的同名文件既不是
    /// 本次写的半成品，也不该被截断复用——落盘后它原样保留，正式配置照常更新。
    ///
    /// 这是能确定红 / 绿的回归判据：旧实现 `path.with_extension("json.tmp")` 会截断并重写它。
    #[test]
    fn write_does_not_reuse_the_legacy_fixed_tmp_name() {
        let dir = TempDir::new("legacy-tmp");
        let path = dir.config_path();
        let legacy = path.with_extension("json.tmp");
        std::fs::write(&legacy, b"stale half-written config").expect("写旧 tmp 残留");
        let value = serde_json::json!({"version": 1, "ui": {"theme": "eink"}});
        write_json_atomic(&path, &value).expect("落盘");
        assert_eq!(
            std::fs::read(&legacy).expect("读旧 tmp 残留"),
            b"stale half-written config",
            "旧固定 tmp 名的残留不应被复用 / 截断"
        );
        let stored: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).expect("读回配置"))
                .expect("落盘后必须是合法 JSON");
        assert_eq!(stored, value);
    }

    /// 并发写同一份 config.json（迁移线程与前端回写重叠的形态）：每次 rename 落地的都必须
    /// 是某一次写入的**完整内容**，不允许两份内容交错成非法 JSON；目录里不留 tmp 残留。
    #[test]
    fn concurrent_writes_never_leave_a_mixed_config() {
        let dir = TempDir::new("write-race");
        let path = dir.config_path();
        // 48KB 的填充字段让单次 `write_all` 跨多个系统调用——旧实现的固定 tmp 名在这条路径上
        // 会被并发写者交错写入，落盘内容因此不再是任何一次写入的原文。
        let payloads: Vec<serde_json::Value> = (0..8)
            .map(|i| {
                serde_json::json!({
                    "version": 1,
                    "ui": {"content_width": 600 + i},
                    "padding": format!("{i}{}", "x".repeat(48 * 1024)),
                })
            })
            .collect();
        let path = path.as_path();
        std::thread::scope(|scope| {
            for value in &payloads {
                scope.spawn(move || {
                    for _ in 0..20 {
                        write_json_atomic(path, value).expect("并发写必须成功");
                    }
                });
            }
        });
        let stored: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).expect("读回配置"))
                .expect("并发写后落盘的必须是完整合法 JSON");
        assert!(
            payloads.iter().any(|payload| payload == &stored),
            "落盘内容必须是某一次写入的完整内容"
        );
        assert_eq!(
            dir.entries(),
            vec!["config.json".to_string()],
            "并发写不留 tmp 残留"
        );
    }

    /// 多线程同时命中迁移（M592 的现场：`restore_outcome` / `cron_loop` / 前端 `config_get`
    /// 的 load 时间窗重叠），同时还有一个运行期回写在跑：配置不许被写坏，落盘内容必须是
    /// 「迁移后的配置」或「回写内容」之一的完整版本，且不留 tmp 残留。
    #[test]
    fn concurrent_load_migrations_do_not_corrupt_config() {
        let dir = TempDir::new("migrate-race");
        let path = dir.config_path();
        let padding = "x".repeat(48 * 1024);
        let retired = format!(
            r#"{{"version":1,"last_vault":"/tmp/vault","harness":{{"providers":{{"kimi":{{"model":"{RETIRED_KIMI_MODEL}","models":[{{"id":"my-model"}}]}}}}}},"padding":"{padding}"}}"#
        );
        let migrated: serde_json::Value = {
            let mut value: serde_json::Value =
                serde_json::from_str(&retired).expect("播种内容必须是合法 JSON");
            value["harness"]["providers"]["kimi"]["model"] = serde_json::json!("my-model");
            value["harness"]["providers"]["kimi"]["preset"] = serde_json::json!("kimi");
            value
        };
        let other = serde_json::json!({
            "version": 1,
            "ui": {"theme": "eink"},
            "padding": format!("y{}", "y".repeat(48 * 1024)),
        });
        for round in 0..20 {
            // 播种在单线程里做：本轮所有写者都已在上轮 scope 里 join。
            std::fs::write(&path, &retired).expect("播种退役值配置");
            std::thread::scope(|scope| {
                for _ in 0..4 {
                    let path = path.as_path();
                    scope.spawn(move || {
                        // 读到的要么是播种原文（命中迁移并写回），要么是别人已落盘的版本；
                        // 两种都是合法配置，模型读数只可能是迁移值或默认空串。
                        let snap = load_from(path);
                        let model = snap
                            .config
                            .harness
                            .providers
                            .get("kimi")
                            .map(|entry| entry.model.as_str())
                            .unwrap_or("");
                        assert!(
                            model == "my-model" || model.is_empty(),
                            "第 {round} 轮读到的模型读数异常：{model:?}"
                        );
                    });
                }
                let path = path.as_path();
                let other = &other;
                scope.spawn(move || {
                    // 回写线程持续 20 次、与迁移写者长期重叠（旧实现的固定 tmp 名在这条
                    // 路径上会被截断 / 抢删，`expect` 或末尾的完整性断言因此判红）。
                    for _ in 0..20 {
                        write_json_atomic(path, other).expect("并发回写必须成功");
                    }
                });
            });
            let stored_text = std::fs::read_to_string(&path).expect("读回配置");
            let stored: serde_json::Value =
                serde_json::from_str(&stored_text).unwrap_or_else(|e| {
                    panic!("第 {round} 轮并发迁移与回写后配置不是合法 JSON：{e}\n{stored_text}")
                });
            assert!(
                stored == migrated || stored == other,
                "第 {round} 轮落盘内容必须是迁移版或回写版的完整内容"
            );
            assert_eq!(
                dir.entries(),
                vec!["config.json".to_string()],
                "第 {round} 轮不留 tmp 残留"
            );
        }
    }

    // ── 装载期的映射解析（design §2.1 / §2.2） ─────────────────────────────

    /// 缺节 / 缺键 ⇒ 出厂默认（**空映射 + 无 active**：出厂不内置任何 provider），且不告警。
    #[test]
    fn harness_missing_section_takes_factory_defaults() {
        for raw in [
            r#"{"version":1,"last_vault":"/tmp/vault"}"#,
            r#"{"version":1,"last_vault":"/tmp/vault","harness":{}}"#,
            r#"{"version":1,"last_vault":"/tmp/vault","harness":{"future":1}}"#,
        ] {
            let snap = load_from(&TempFile::new(raw).0);
            assert_eq!(snap.config.harness, HarnessConfig::default(), "{raw}");
            assert_eq!(snap.config.harness.provider, "", "{raw}");
            assert!(snap.config.harness.providers.is_empty(), "{raw}");
            assert_eq!(snap.config.harness.loop_max, 50, "{raw}");
            assert_eq!(snap.config.harness.warn_ctx_pct, 85.0, "{raw}");
            assert!(snap.config.harness.auto_compact, "{raw}");
            assert!(snap.warnings.is_empty(), "{raw}: {:?}", snap.warnings);
        }
    }

    /// 条目级宽容（design §2.1）：一个手写条目的笔误只丢它自己 + 点名 warning，
    /// MUST NOT 拖垮整份配置（`last_vault` 与其他条目照常生效）。
    #[test]
    fn harness_bad_entry_only_drops_itself() {
        let raw = r#"{"last_vault":"/tmp/vault","harness":{"provider":"kimi","providers":{
            "kimi":{"preset":"kimi","api_key":"sk-a","models":[{"id":"k3","effort":true,"vision":true,"window":1000}]},
            "broken":"not-an-object",
            "bad-preset":{"preset":"openai","api_key":"sk-b"},
            "bad-key":{"preset":"kimi","api_key":42},
            "bad-models":{"preset":"kimi","models":{"id":"x"}}
        }}}"#;
        let snap = load_from(&TempFile::new(raw).0);
        assert_eq!(snap.config.last_vault.as_deref(), Some("/tmp/vault"));
        let providers = &snap.config.harness.providers;
        assert_eq!(
            providers.keys().map(String::as_str).collect::<Vec<_>>(),
            vec!["kimi"],
            "非法条目逐条丢弃：{providers:?}"
        );
        assert_eq!(snap.config.harness.provider, "kimi", "显式 active 仍有效");
        for needle in [
            "harness.providers.broken 不是对象",
            "harness.providers.bad-preset.preset 取值 \"openai\" 非法",
            "harness.providers.bad-key.api_key 应为字符串",
            "harness.providers.bad-models.models 应为数组",
        ] {
            assert!(
                snap.warnings.iter().any(|warning| warning.contains(needle)),
                "缺少 {needle}：{:?}",
                snap.warnings
            );
        }
    }

    /// `providers` 不是对象 ⇒ 整文件回落（design §2.1 沿用 ADR 0002 §5 的既有模板）。
    #[test]
    fn harness_providers_wrong_shape_falls_back_entire_file() {
        let snap = load_from(
            &TempFile::new(r#"{"last_vault":"/tmp/vault","harness":{"providers":"kimi"}}"#).0,
        );
        assert!(snap.fallback, "整文件回落");
        assert!(snap.config.last_vault.is_none(), "回落连 last_vault 一起丢");
        assert_eq!(snap.warnings.len(), 1);
    }

    /// 缺 preset ⇒ generic + warning（迁移会补上旧三档）；显式非法 preset ⇒ 整条忽略。
    #[test]
    fn harness_missing_preset_is_generic_and_invalid_preset_drops_entry() {
        let snap = load_from(
            &TempFile::new(
                r#"{"harness":{"providers":{
                    "local":{"api_key":"sk-x","models":[{"id":"m","effort":false,"vision":false,"window":1024}]},
                    "weird":{"preset":"ollama"}
                }}}"#,
            )
            .0,
        );
        let local = snap
            .config
            .harness
            .providers
            .get("local")
            .expect("缺 preset 的条目按 generic 保留");
        assert_eq!(local.preset, ProviderPreset::Generic);
        assert_eq!(
            local.wire_api,
            WireApi::ChatCompletions,
            "generic 缺省 wire"
        );
        assert!(
            !local.configured,
            "generic 缺 base_url ⇒ 不可用（design §2.4）"
        );
        assert!(!snap.config.harness.providers.contains_key("weird"));
        assert!(
            snap.warnings
                .iter()
                .any(|warning| warning.contains("local.preset 缺失")),
            "{:?}",
            snap.warnings
        );
        assert!(
            snap.warnings
                .iter()
                .any(|warning| warning.contains("weird.preset 取值 \"ollama\" 非法")),
            "{:?}",
            snap.warnings
        );
    }

    /// mock 是保留 id：`preset = mock` 只允许 id 恰好是 `mock`，其它 id 声明 mock 整条忽略。
    #[test]
    fn harness_mock_preset_requires_reserved_id() {
        let snap = load_from(
            &TempFile::new(
                r#"{"harness":{"providers":{
                    "mock":{"preset":"mock","fixture":"/tmp/fixture.json"},
                    "local-mock":{"preset":"mock","fixture":"/tmp/fixture.json"}
                }}}"#,
            )
            .0,
        );
        assert!(snap.config.harness.providers.contains_key("mock"));
        assert!(
            !snap.config.harness.providers.contains_key("local-mock"),
            "非保留 id 的 mock 声明必须整条忽略"
        );
        assert!(
            snap.warnings
                .iter()
                .any(|warning| warning.contains("mock 是保留 id")),
            "{:?}",
            snap.warnings
        );
    }

    /// provider id 规则（design §2.3）：小写字母 / 数字 / `-` / `_`，1..=32 字符、不含点；
    /// 装载期命中非法 id 的条目整条忽略（它无法被任何写通道寻址）。
    #[test]
    fn harness_provider_id_rules() {
        assert!(provider_id_valid("kimi-work"));
        assert!(provider_id_valid("kimi_personal_2"));
        assert!(provider_id_valid("a"));
        assert!(provider_id_valid(&"a".repeat(PROVIDER_ID_MAX)));
        assert!(!provider_id_valid(""));
        assert!(!provider_id_valid("Kimi Work"));
        assert!(!provider_id_valid("kimi.work"), "点会制造第二级写回路径");
        assert!(!provider_id_valid("kimi/work"));
        assert!(!provider_id_valid("-kimi"), "首字符必须是字母或数字");
        assert!(!provider_id_valid(&"a".repeat(PROVIDER_ID_MAX + 1)));

        let snap = load_from(
            &TempFile::new(
                r#"{"harness":{"providers":{
                    "Kimi":{"preset":"kimi","api_key":"sk"},
                    "kimi.work":{"preset":"kimi","api_key":"sk"}
                }}}"#,
            )
            .0,
        );
        assert!(
            snap.config.harness.providers.is_empty(),
            "非法 id 的条目整条忽略"
        );
        assert_eq!(
            snap.diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.code == "harness_provider_id_invalid")
                .count(),
            2
        );
    }

    /// 可用性判据（design §2.4，R6）：按预设分叉，是派生读数而不是「键是否存在」。
    #[test]
    fn harness_configured_follows_preset() {
        let configured = |id: &str, json: &str| {
            let mut providers = serde_json::Map::new();
            providers.insert(
                id.to_string(),
                serde_json::from_str::<serde_json::Value>(json).unwrap(),
            );
            let (harness, _diagnostics) = validate_harness(RawHarnessConfig {
                providers: Some(providers),
                ..Default::default()
            });
            harness
                .providers
                .get(id)
                .map(|entry| entry.configured)
                .unwrap_or(false)
        };
        assert!(configured(
            "probe",
            r#"{"preset":"kimi","api_key":"sk","models":[{"id":"m","effort":false,"vision":false,"window":1024}]}"#
        ));
        assert!(!configured(
            "probe",
            r#"{"preset":"kimi","api_key":"sk","models":[]}"#
        ));
        assert!(!configured(
            "probe",
            r#"{"preset":"kimi","api_key":"","models":[{"id":"m","effort":false,"vision":false,"window":1024}]}"#
        ));
        assert!(configured(
            "probe",
            r#"{"preset":"deepseek","api_key":"sk","models":[{"id":"m","effort":false,"vision":false,"window":1024}]}"#
        ));
        assert!(configured(
            "probe",
            r#"{"preset":"generic","base_url":"http://x/v1","models":[{"id":"m","effort":false,"vision":false,"window":1024}]}"#
        ));
        assert!(!configured(
            "probe",
            r#"{"preset":"generic","base_url":"","models":[{"id":"m","effort":false,"vision":false,"window":1024}]}"#
        ));
        assert!(!configured(
            "probe",
            r#"{"preset":"generic","base_url":"http://x/v1","models":[]}"#
        ));
        assert!(configured(
            "mock",
            r#"{"preset":"mock","fixture":"/tmp/f"}"#
        ));
        assert!(!configured("mock", r#"{"preset":"mock","fixture":""}"#));
    }

    /// 半配置（有 Key、无模型）是阻断级诊断；完全空的 generic 条目允许存在（可保存）。
    #[test]
    fn harness_half_configured_entry_is_reject_on_write() {
        let snap = load_from(
            &TempFile::new(
                r#"{"harness":{"providers":{
                    "kimi":{"preset":"kimi","api_key":"sk-only"},
                    "empty":{"preset":"generic"}
                }}}"#,
            )
            .0,
        );
        let diagnostic = snap
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.path.as_deref() == Some("harness.providers.kimi"))
            .expect("半配置必须有一条诊断");
        assert_eq!(diagnostic.code, "harness_models_empty_when_configured");
        assert_eq!(diagnostic.severity, DiagnosticSeverity::RejectOnWrite);
        assert!(!snap.config.harness.providers["kimi"].configured);
        // 完全空的条目：没有诊断、可保存（configured = false）。
        assert!(
            snap.config.harness.providers.contains_key("empty"),
            "空条目保留"
        );
        assert!(!snap
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.path.as_deref() == Some("harness.providers.empty")));
    }

    /// generic 的 Base URL：已填 Key 或模型时缺失是**阻断级**；完全空的条目是合法半成品。
    #[test]
    fn harness_generic_requires_base_url_when_partially_filled() {
        let (harness, diagnostics) = validate_harness(RawHarnessConfig {
            providers: Some(
                serde_json::from_value(serde_json::json!({
                    "with-key": {"preset":"generic","api_key":"sk-x"},
                    "with-models": {"preset":"generic","models":[{"id":"m"}]},
                    "empty": {"preset":"generic"},
                }))
                .unwrap(),
            ),
            ..Default::default()
        });
        assert_eq!(harness.providers.len(), 3, "三条都保留（条目级宽容）");
        let required: Vec<&str> = diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.code == "harness_base_url_required")
            .filter_map(|diagnostic| diagnostic.path.as_deref())
            .collect();
        assert_eq!(
            required,
            vec![
                "harness.providers.with-key.base_url",
                "harness.providers.with-models.base_url"
            ]
        );
        assert!(diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.code == "harness_base_url_required")
            .all(|diagnostic| diagnostic.severity == DiagnosticSeverity::RejectOnWrite));
        assert!(!harness.providers["with-key"].configured);
        assert!(!harness.providers["with-models"].configured);
        assert!(
            !diagnostics
                .iter()
                .any(|diagnostic| diagnostic.path.as_deref()
                    == Some("harness.providers.empty.base_url")),
            "完全空的 generic 条目不该被阻断（可保存的半成品）"
        );
    }

    /// active 解析（design §2.5 / R7–R10b）：显式优先（未配置也不换）、缺省取第一个
    /// configured、全未配置按预设顺序、空映射无 active、悬空回落 + warning、mock 不参与回退。
    #[test]
    fn harness_active_provider_resolution() {
        let load = |raw_provider: Option<&str>, providers: serde_json::Value| {
            validate_harness(RawHarnessConfig {
                provider: raw_provider.map(str::to_string),
                providers: Some(
                    serde_json::from_value::<serde_json::Map<String, serde_json::Value>>(providers)
                        .unwrap(),
                ),
                ..Default::default()
            })
        };

        // ① 显式合法（即使未配置）保持不变。
        let (harness, diagnostics) = load(
            Some("deepseek"),
            serde_json::json!({
                "kimi": {"preset":"kimi","api_key":"sk","models":[{"id":"m","effort":false,"vision":false,"window":1024}]},
                "deepseek": {"preset":"deepseek","api_key":"","models":[]},
            }),
        );
        assert_eq!(harness.provider, "deepseek", "显式选中不因未配置而换");
        assert!(diagnostics.is_empty(), "{diagnostics:?}");

        // ② 缺省：第一个 **configured**（不是字典序第一个）。
        let (harness, _) = load(
            None,
            serde_json::json!({
                "kimi": {"preset":"kimi","api_key":"","models":[]},
                "deepseek": {"preset":"deepseek","api_key":"sk","models":[{"id":"m","effort":false,"vision":false,"window":1024}]},
                "local-lab": {"preset":"generic","base_url":"http://x/v1","models":[{"id":"m","effort":false,"vision":false,"window":1024}]},
            }),
        );
        assert_eq!(harness.provider, "deepseek");

        // ③ 全未配置：按预设顺序（kimi 优先于 generic，与 id 字典序无关）。
        let (harness, _) = load(
            None,
            serde_json::json!({
                "aaa-generic": {"preset":"generic","base_url":"","models":[]},
                "kimi": {"preset":"kimi","api_key":"","models":[]},
            }),
        );
        assert_eq!(harness.provider, "kimi");

        // ④ 空映射 / 只剩 mock ⇒ 无 active。
        assert_eq!(load(None, serde_json::json!({})).0.provider, "");
        assert_eq!(
            load(
                None,
                serde_json::json!({"mock": {"preset":"mock","fixture":"/tmp/f"}})
            )
            .0
            .provider,
            ""
        );

        // ⑤ mock 不被缺省回退选中，但显式写它仍生效。
        let (harness, _) = load(
            None,
            serde_json::json!({
                "mock": {"preset":"mock","fixture":"/tmp/f"},
                "kimi": {"preset":"kimi","api_key":"","models":[]},
            }),
        );
        assert_eq!(harness.provider, "kimi");
        let (harness, _) = load(
            Some("mock"),
            serde_json::json!({"mock": {"preset":"mock","fixture":"/tmp/f"}}),
        );
        assert_eq!(harness.provider, "mock");

        // ⑥ 悬空 ⇒ 回退 + 点名 warning。
        let (harness, diagnostics) = load(
            Some("deleted-one"),
            serde_json::json!({
                "kimi": {"preset":"kimi","api_key":"sk","models":[{"id":"m","effort":false,"vision":false,"window":1024}]},
            }),
        );
        assert_eq!(harness.provider, "kimi");
        assert!(
            diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "harness_provider_unknown"
                    && diagnostic.path.as_deref() == Some("harness.provider")),
            "{diagnostics:?}"
        );

        // ⑦ 显式空串：按未写处理 + warning。
        let (harness, diagnostics) = load(
            Some(""),
            serde_json::json!({
                "kimi": {"preset":"kimi","api_key":"sk","models":[{"id":"m","effort":false,"vision":false,"window":1024}]},
            }),
        );
        assert_eq!(harness.provider, "kimi");
        assert!(
            diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "harness_provider_empty"),
            "{diagnostics:?}"
        );
    }

    /// 生效模型的解析顺序固定为「显式 → 清单首项 → 空串」（design §2.1 / R12h）：
    /// 显式值不在清单内也保留 + warning，**清单为空也不抹掉显式值**。
    #[test]
    fn harness_effective_model_resolution() {
        let parse = |json: &str| {
            let mut providers = serde_json::Map::new();
            providers.insert(
                "kimi".to_string(),
                serde_json::from_str::<serde_json::Value>(json).unwrap(),
            );
            validate_harness(RawHarnessConfig {
                providers: Some(providers),
                ..Default::default()
            })
        };

        // 显式值优先（非首项）。
        let (harness, diagnostics) = parse(
            r#"{"preset":"kimi","api_key":"sk","model":"k3-128k","models":[{"id":"k3-256k","effort":false,"vision":false,"window":1000},{"id":"k3-128k","effort":false,"vision":false,"window":1000}]}"#,
        );
        assert_eq!(harness.providers["kimi"].model, "k3-128k");
        assert!(diagnostics.is_empty(), "{diagnostics:?}");

        // 显式值不在清单内：保留 + warning（窗口 / 能力按保守默认）。
        let (harness, diagnostics) = parse(
            r#"{"preset":"kimi","api_key":"sk","model":"k3-legacy","models":[{"id":"k3-256k","effort":false,"vision":false,"window":1000}]}"#,
        );
        assert_eq!(harness.providers["kimi"].model, "k3-legacy");
        assert!(diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "harness_model_not_declared"));

        // 显式模型 + 空清单：保留显式值（空清单只影响缺省回落）。
        let (harness, _) =
            parse(r#"{"preset":"generic","base_url":"http://x/v1","model":"k3-legacy"}"#);
        assert_eq!(harness.providers["kimi"].model, "k3-legacy");

        // 缺省 ⇒ 清单首项。
        let (harness, diagnostics) = parse(
            r#"{"preset":"kimi","api_key":"sk","models":[{"id":"first","effort":false,"vision":false,"window":1000},{"id":"second","effort":false,"vision":false,"window":1000}]}"#,
        );
        assert_eq!(harness.providers["kimi"].model, "first");
        assert!(diagnostics.is_empty(), "{diagnostics:?}");

        // 两者皆无 ⇒ 空串。
        let (harness, _) = parse(r#"{"preset":"kimi","api_key":"sk"}"#);
        assert_eq!(harness.providers["kimi"].model, "");
    }

    /// 能力读取按 id 查条目（task 2.6）：未命中走既有保守默认（空清单 / FALLBACK_CONTEXT_WINDOW /
    /// 不支持）；mock 恒定支持 effort 与 vision。
    #[test]
    fn harness_capabilities_read_by_id() {
        let (harness, _) = validate_harness(RawHarnessConfig {
            provider: Some("kimi".to_string()),
            providers: Some(
                serde_json::from_value(serde_json::json!({
                    "kimi": {"preset":"kimi","api_key":"sk","models":[
                        {"id":"k3-256k","effort":true,"vision":true,"window":262144},
                        {"id":"k3-128k","effort":false,"vision":false,"window":131072}
                    ]}
                }))
                .unwrap(),
            ),
            ..Default::default()
        });
        assert_eq!(harness.model_specs("kimi").len(), 2);
        assert!(harness.model_specs("unknown").is_empty());
        assert_eq!(harness.context_window("kimi", "k3-256k"), 262_144);
        assert_eq!(
            harness.context_window("kimi", "missing"),
            FALLBACK_CONTEXT_WINDOW
        );
        assert_eq!(
            harness.context_window("unknown", "k3-256k"),
            FALLBACK_CONTEXT_WINDOW
        );
        assert!(harness.effort_supported("kimi", "k3-256k"));
        assert!(!harness.effort_supported("kimi", "k3-128k"));
        assert!(!harness.effort_supported("kimi", "missing"));
        assert!(!harness.effort_supported("unknown", "k3-256k"));
        assert!(harness.vision_supported("kimi", "k3-256k"));
        assert!(!harness.vision_supported("kimi", "missing"));
        assert_eq!(harness.wire_api(), WireApi::Responses);

        // 无 active provider：wire 走缺省，能力读取全保守。
        let empty = HarnessConfig::default();
        assert_eq!(empty.wire_api(), WireApi::Responses);
        assert!(empty.model_specs("").is_empty());
        assert_eq!(empty.context_window("", ""), FALLBACK_CONTEXT_WINDOW);
        assert!(!empty.effort_supported("", ""));
        assert!(!empty.vision_supported("", ""));
        assert!(!empty.is_mock(""));
    }

    /// mock 档：effort / vision 恒定支持，wire 归一为 `responses`，`configured` 看 fixture。
    #[test]
    fn harness_mock_capability_and_wire() {
        let (harness, _) = validate_harness(RawHarnessConfig {
            provider: Some("mock".to_string()),
            providers: Some(
                serde_json::from_value(serde_json::json!({
                    "mock": {"preset":"mock","fixture":"/tmp/fixture.json","wire_api":"chat_completions"}
                }))
                .unwrap(),
            ),
            ..Default::default()
        });
        assert!(harness.is_mock("mock"));
        assert!(harness.effort_supported("mock", "whatever"));
        assert!(harness.vision_supported("mock", "whatever"));
        assert_eq!(
            harness.wire_api(),
            WireApi::Responses,
            "mock 不消费 wire，装载期归一为缺省"
        );
        assert!(harness.providers["mock"].configured);
    }

    /// wire 方言（design §2.2）：缺键取**预设**缺省；闭集合外 / 该预设不支持 ⇒ 回落缺省 + warning。
    #[test]
    fn harness_wire_api_by_preset() {
        let harness = |json: &str| {
            let mut providers = serde_json::Map::new();
            providers.insert(
                "probe".to_string(),
                serde_json::from_str::<serde_json::Value>(json).unwrap(),
            );
            validate_harness(RawHarnessConfig {
                providers: Some(providers),
                ..Default::default()
            })
        };
        // generic 缺省 chat_completions；显式 responses 也支持。
        assert_eq!(
            harness(r#"{"preset":"generic","base_url":"http://x/v1"}"#)
                .0
                .providers["probe"]
                .wire_api,
            WireApi::ChatCompletions
        );
        assert_eq!(
            harness(r#"{"preset":"generic","base_url":"http://x/v1","wire_api":"responses"}"#)
                .0
                .providers["probe"]
                .wire_api,
            WireApi::Responses
        );
        // kimi / deepseek 缺省 responses；kimi 支持 chat。
        assert_eq!(
            harness(r#"{"preset":"kimi","api_key":"sk"}"#).0.providers["probe"].wire_api,
            WireApi::Responses
        );
        assert_eq!(
            harness(r#"{"preset":"kimi","api_key":"sk","wire_api":"chat_completions"}"#)
                .0
                .providers["probe"]
                .wire_api,
            WireApi::ChatCompletions
        );
        // deepseek 的 chat 档 v1 未实现 ⇒ 回落 + warning。
        let (deepseek, diagnostics) =
            harness(r#"{"preset":"deepseek","api_key":"sk","wire_api":"chat_completions"}"#);
        assert_eq!(deepseek.providers["probe"].wire_api, WireApi::Responses);
        assert!(diagnostics.iter().any(|diagnostic| diagnostic.code
            == "harness_wire_api_unsupported"
            && diagnostic.severity == DiagnosticSeverity::RejectOnWrite));
        // 闭集合外 ⇒ 回落缺省 + warning。
        let (generic, diagnostics) =
            harness(r#"{"preset":"generic","base_url":"http://x/v1","wire_api":"grpc"}"#);
        assert_eq!(
            generic.providers["probe"].wire_api,
            WireApi::ChatCompletions
        );
        assert!(diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "harness_wire_api_invalid"));
    }

    /// base_url：空串视为缺省 + warning（可保存的显式输入非法值，阻断级）。
    #[test]
    fn harness_blank_base_url_falls_back_with_reject_on_write() {
        let snap = load_from(
            &TempFile::new(
                r#"{"harness":{"providers":{"kimi":{"preset":"kimi","api_key":"sk","base_url":"   ","models":[{"id":"m","effort":false,"vision":false,"window":1024}]}}}}"#,
            )
            .0,
        );
        assert_eq!(snap.config.harness.providers["kimi"].base_url, None);
        let diagnostic = snap
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.code == "harness_base_url_empty")
            .expect("空 base_url 必须点名");
        assert_eq!(
            diagnostic.severity,
            DiagnosticSeverity::RejectOnWrite,
            "显式空串是错误输入（要用官方地址应删键）"
        );
        assert_eq!(
            ProviderPreset::Kimi.official_base_url(),
            Some("https://api.moonshot.cn/v1")
        );
        assert_eq!(ProviderPreset::Generic.official_base_url(), None);
    }

    /// 预设语义表（design §2.2）：官方地址 / 缺省 wire / 支持的 wire / 是否要求 Key / store。
    #[test]
    fn preset_semantics_table() {
        assert_eq!(
            ProviderPreset::Deepseek.official_base_url(),
            Some("https://api.deepseek.com")
        );
        assert!(ProviderPreset::Mock.official_base_url().is_none());
        assert_eq!(ProviderPreset::Kimi.default_wire_api(), WireApi::Responses);
        assert_eq!(
            ProviderPreset::Deepseek.default_wire_api(),
            WireApi::Responses
        );
        assert_eq!(
            ProviderPreset::Generic.default_wire_api(),
            WireApi::ChatCompletions
        );
        assert_eq!(ProviderPreset::Mock.default_wire_api(), WireApi::Responses);
        assert!(ProviderPreset::Kimi.supports_wire_api(WireApi::ChatCompletions));
        assert!(!ProviderPreset::Deepseek.supports_wire_api(WireApi::ChatCompletions));
        assert!(ProviderPreset::Generic.supports_wire_api(WireApi::Responses));
        assert!(!ProviderPreset::Mock.supports_wire_api(WireApi::ChatCompletions));
        assert!(ProviderPreset::Kimi.requires_api_key());
        assert!(ProviderPreset::Deepseek.requires_api_key());
        assert!(!ProviderPreset::Generic.requires_api_key());
        assert!(!ProviderPreset::Mock.requires_api_key());
        assert!(ProviderPreset::Kimi.store_false());
        assert!(!ProviderPreset::Deepseek.store_false());
        assert!(!ProviderPreset::Generic.store_false());
        assert!(!ProviderPreset::Mock.store_false());
        for preset in [
            ProviderPreset::Kimi,
            ProviderPreset::Deepseek,
            ProviderPreset::Generic,
            ProviderPreset::Mock,
        ] {
            assert_eq!(ProviderPreset::parse(preset.as_str()), Some(preset));
        }
        assert_eq!(ProviderPreset::parse("openai"), None);
        // 规范顺序 = 变体顺序（列表展示与 active 回退共用）。
        let mut presets = vec![
            ProviderPreset::Mock,
            ProviderPreset::Generic,
            ProviderPreset::Deepseek,
            ProviderPreset::Kimi,
        ];
        presets.sort();
        assert_eq!(
            presets,
            vec![
                ProviderPreset::Kimi,
                ProviderPreset::Deepseek,
                ProviderPreset::Generic,
                ProviderPreset::Mock
            ]
        );
    }

    // ── 一次性迁移（design §3） ────────────────────────────────────────────

    /// R1 / R5：旧三档补齐 preset，其余键（含条目与模型项上的未知子键）逐字不变。
    #[test]
    fn harness_preset_migration_adds_only_preset() {
        let raw = r#"{"version":1,"last_vault":"/tmp/vault","harness":{"providers":{
            "kimi":{"api_key":"sk-a","models":[{"id":"k3","effort":true,"vision":true,"window":1000,"future":1}],"extra":{"keep":true}},
            "deepseek":{"api_key":"sk-b","models":[{"id":"ds"}]},
            "mock":{"fixture":"/tmp/fixture.json"}
        },"loop_max":4},"future_table":{"keep":true}}"#;
        let f = TempFile::new(raw);
        let snap = load_from(&f.0);
        for (id, preset) in [("kimi", "kimi"), ("deepseek", "deepseek"), ("mock", "mock")] {
            assert_eq!(
                snap.config.harness.providers[id].preset.as_str(),
                preset,
                "{id}"
            );
        }
        // 其余键逐键保留（未知字段、模型项未知子键、其他表）。
        let persisted: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&f.0).expect("读回配置"))
                .expect("配置仍是合法 JSON");
        assert_eq!(persisted["harness"]["providers"]["kimi"]["api_key"], "sk-a");
        assert_eq!(
            persisted["harness"]["providers"]["kimi"]["extra"]["keep"],
            true
        );
        assert_eq!(
            persisted["harness"]["providers"]["kimi"]["models"][0]["future"],
            1
        );
        assert_eq!(persisted["harness"]["loop_max"], 4);
        assert_eq!(persisted["future_table"]["keep"], true);
        assert_eq!(persisted["last_vault"], "/tmp/vault");
        assert!(
            snap.warnings
                .iter()
                .any(|warning| warning.contains("已补齐 preset")),
            "{:?}",
            snap.warnings
        );
    }

    /// R2：迁移幂等——第二次加载不再写文件。
    #[test]
    fn harness_preset_migration_is_idempotent() {
        let f = TempFile::new(
            r#"{"harness":{"providers":{"kimi":{"api_key":"sk-a"},"deepseek":{},"mock":{}}}}"#,
        );
        let _ = load_from(&f.0);
        let rewritten = format!("{}\n", std::fs::read_to_string(&f.0).expect("读回配置"));
        std::fs::write(&f.0, &rewritten).expect("写入探针配置");
        let again = load_from(&f.0);
        assert_eq!(
            std::fs::read_to_string(&f.0).expect("读回配置"),
            rewritten,
            "第二次加载不应再写文件"
        );
        assert!(
            !again
                .warnings
                .iter()
                .any(|warning| warning.contains("已补齐 preset")),
            "{:?}",
            again.warnings
        );
    }

    /// R3：显式 preset 是用户值，迁移不覆盖。
    #[test]
    fn harness_preset_migration_keeps_explicit_preset() {
        let f = TempFile::new(
            r#"{"harness":{"providers":{"kimi":{"preset":"generic","base_url":"http://127.0.0.1:8080/v1"}}}}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(
            snap.config.harness.providers["kimi"].preset,
            ProviderPreset::Generic
        );
        let persisted: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&f.0).expect("读回配置")).unwrap();
        assert_eq!(
            persisted["harness"]["providers"]["kimi"]["preset"],
            "generic"
        );
        assert!(
            !snap
                .warnings
                .iter()
                .any(|warning| warning.contains("已补齐 preset")),
            "没有改写就不该有迁移 warning"
        );
    }

    /// R4：未知 id 不迁移，按 generic + warning 解释，且不可用（缺 base_url）。
    #[test]
    fn harness_preset_migration_skips_unknown_ids() {
        let f = TempFile::new(
            r#"{"harness":{"providers":{"openai":{"api_key":"sk-x","models":[{"id":"m","effort":false,"vision":false,"window":1024}]}}}}"#,
        );
        let snap = load_from(&f.0);
        let persisted: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&f.0).expect("读回配置")).unwrap();
        assert!(
            persisted["harness"]["providers"]["openai"]
                .get("preset")
                .is_none(),
            "未知 id 不补 preset"
        );
        let entry = &snap.config.harness.providers["openai"];
        assert_eq!(entry.preset, ProviderPreset::Generic);
        assert!(!entry.configured, "generic 缺 base_url ⇒ 不可用");
        assert!(snap
            .warnings
            .iter()
            .any(|warning| warning.contains("openai.preset 缺失")));
    }

    /// 退役 model 迁移与 preset 迁移**同一次原子写**（design §3.2）：两条 warning 都出现，
    /// 文件里两个改写同时可见；读回不再写盘。
    #[test]
    fn harness_retired_model_and_preset_migrate_in_one_write() {
        let f = TempFile::new(&format!(
            r#"{{"harness":{{"providers":{{"kimi":{{"model":"{RETIRED_KIMI_MODEL}","models":[{{"id":"my-model"}}]}}}}}}}}"#
        ));
        let snap = load_from(&f.0);
        assert_eq!(snap.config.harness.providers["kimi"].model, "my-model");
        assert_eq!(
            snap.config.harness.providers["kimi"].preset,
            ProviderPreset::Kimi
        );
        assert!(
            snap.warnings
                .iter()
                .any(|warning| warning.contains(RETIRED_KIMI_MODEL)
                    && warning.contains("my-model")),
            "{:?}",
            snap.warnings
        );
        assert!(
            snap.warnings
                .iter()
                .any(|warning| warning.contains("已补齐 preset")),
            "{:?}",
            snap.warnings
        );
        let persisted: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&f.0).expect("读回配置")).unwrap();
        assert_eq!(
            persisted["harness"]["providers"]["kimi"]["model"],
            "my-model"
        );
        assert_eq!(persisted["harness"]["providers"]["kimi"]["preset"], "kimi");
        let rewritten = format!("{}\n", std::fs::read_to_string(&f.0).expect("读回配置"));
        std::fs::write(&f.0, &rewritten).expect("写入探针配置");
        let _ = load_from(&f.0);
        assert_eq!(
            std::fs::read_to_string(&f.0).expect("读回配置"),
            rewritten,
            "第二次加载不再写盘"
        );
    }

    /// 迁移写失败只 warning、内存值仍生效（design §3.1）：父目录只读 ⇒ tmp 建不出来，
    /// 本次生效值已是补齐后的形态，下次加载再试。
    #[test]
    fn harness_preset_migration_write_failure_only_warns() {
        let dir = TempDir::new("migration-write-failed");
        let path = dir.config_path();
        std::fs::write(
            &path,
            r#"{"harness":{"providers":{"kimi":{"api_key":"sk-a"}}}}"#,
        )
        .expect("播种旧格式配置");
        let original = std::fs::metadata(&dir.0)
            .expect("读目录元数据")
            .permissions();
        let mut readonly = original.clone();
        readonly.set_readonly(true);
        std::fs::set_permissions(&dir.0, readonly).expect("目录设为只读");
        let snap = load_from(&path);
        // 立刻复原权限（TempDir 的 Drop 要能删目录；断言失败时也不留只读残留）。
        std::fs::set_permissions(&dir.0, original).expect("复原目录权限");

        assert_eq!(
            snap.config.harness.providers["kimi"].preset,
            ProviderPreset::Kimi,
            "落盘失败不影响本次生效值"
        );
        assert!(
            snap.warnings
                .iter()
                .any(|warning| warning.contains("未能落盘")),
            "{:?}",
            snap.warnings
        );
        let persisted = std::fs::read_to_string(&path).expect("读回配置");
        assert!(
            !persisted.contains("preset"),
            "落盘失败时文件不该被改写：{persisted}"
        );
    }

    /// 退役值迁移的两条负向（M381 config-only）保持不变：
    /// 无清单 ⇒ 不改写、不落盘、只 warning；非退役值 ⇒ 一律不动。
    #[test]
    fn harness_retired_kimi_model_negatives() {
        let raw = r#"{"harness":{"providers":{"kimi":{"preset":"kimi","api_key":"sk-x","model":"kimi-k2"}}}}"#;
        let f = TempFile::new(raw);
        let snap = load_from(&f.0);
        assert_eq!(
            snap.config.harness.providers["kimi"].model,
            RETIRED_KIMI_MODEL
        );
        assert!(snap.warnings.iter().any(
            |warning| warning.contains(RETIRED_KIMI_MODEL) && warning.contains("无法自动改写")
        ));
        let persisted = std::fs::read_to_string(&f.0).expect("读回配置");
        assert!(
            persisted.contains(RETIRED_KIMI_MODEL),
            "未声明清单时不应改写"
        );

        for stored in ["kimi-k2.6", "kimi-k2.7-code", "my-router/model-x"] {
            let raw = format!(
                r#"{{"harness":{{"providers":{{"kimi":{{"preset":"kimi","model":"{stored}"}}}}}}}}"#
            );
            let f = TempFile::new(&raw);
            let snap = load_from(&f.0);
            assert_eq!(snap.config.harness.providers["kimi"].model, stored);
            assert_eq!(
                std::fs::read_to_string(&f.0).expect("读回配置"),
                raw,
                "{stored} 不应被改写"
            );
        }
    }

    // ── 两张命名表（design §2.6 / §10.2） ─────────────────────────────────

    /// 命名目标解析：覆盖合法 ⇒ 用它；悬空 ⇒ 回落 active + warning；缺省 ⇒ active。
    #[test]
    fn naming_target_resolution() {
        let (harness, diagnostics) = validate_harness(RawHarnessConfig {
            provider: Some("kimi".to_string()),
            session_naming: RawSessionNamingConfig {
                provider: Some("deepseek".to_string()),
                ..Default::default()
            },
            attachment_naming: RawAttachmentNamingConfig {
                provider: Some("deleted-one".to_string()),
                ..Default::default()
            },
            providers: Some(
                serde_json::from_value(serde_json::json!({
                    "kimi": {"preset":"kimi","api_key":"sk","models":[{"id":"k3-256k"}]},
                    "deepseek": {"preset":"deepseek","api_key":"sk","models":[{"id":"ds-chat"}]},
                }))
                .unwrap(),
            ),
            ..Default::default()
        });
        assert_eq!(harness.session_naming.provider.as_deref(), Some("deepseek"));
        assert_eq!(harness.attachment_naming.provider, None, "悬空回落 active");
        assert!(
            diagnostics.iter().any(|diagnostic| diagnostic.code
                == "harness_naming_provider_unknown"
                && diagnostic.path.as_deref() == Some("harness.attachment_naming.provider")),
            "{diagnostics:?}"
        );
        let target = harness.title_target(&harness.provider);
        assert_eq!(target.provider, "deepseek");
        assert_eq!(target.model, "ds-chat", "缺省 = 目标条目的生效模型");
        assert_eq!(target.api_key, "sk");
        assert_eq!(target.preset, ProviderPreset::Deepseek);
    }

    /// 会话命名：覆盖模型不在清单 ⇒ 回落生效模型 + warning（**不**保留原值）。
    #[test]
    fn session_naming_model_falls_back_when_undeclared() {
        let f = TempFile::new(
            r#"{"harness":{"provider":"kimi","providers":{"kimi":{"preset":"kimi","api_key":"sk","models":[{"id":"k3-256k"}]}},"session_naming":{"model":"other-provider-model"}}}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(snap.config.harness.session_naming.model, None);
        assert!(snap
            .warnings
            .iter()
            .any(|warning| warning.contains("不在 provider（kimi）的 models 清单内")));
        let target = snap.config.harness.title_target("kimi");
        assert_eq!(target.model, "k3-256k", "回落该 provider 的生效模型");
    }

    /// 会话命名：mock 目标下 `model` 只能是 null（mock 没有模型清单）。
    #[test]
    fn session_naming_rejects_non_null_model_for_mock() {
        let f = TempFile::new(
            r#"{"harness":{"provider":"mock","providers":{"mock":{"preset":"mock","fixture":"/tmp/f"}},"session_naming":{"model":"anything"}}}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(snap.config.harness.session_naming.model, None);
        assert!(snap
            .warnings
            .iter()
            .any(|warning| warning.contains("mock provider 没有模型清单")));
        let target = snap.config.harness.title_target("mock");
        assert_eq!(target.provider, "mock");
        assert_eq!(target.model, "", "mock 不伪造模型 id");
        assert_eq!(target.api_key, "");
        assert_eq!(target.preset, ProviderPreset::Mock);
    }

    /// 图片命名：覆盖模型不在清单 / 未声明 vision ⇒ **原样保留** + 只点名（不回落）。
    #[test]
    fn attachment_naming_keeps_undeclared_model_and_names_the_gate() {
        let snap = load_from(
            &TempFile::new(
                r#"{"harness":{"provider":"kimi","providers":{"kimi":{"preset":"kimi","api_key":"sk","model":"k3-text","models":[{"id":"k3-text","vision":false},{"id":"k3-vision","vision":true}]}},"attachment_naming":{"model":"not-declared"}}}"#,
            )
            .0,
        );
        assert_eq!(
            snap.config.harness.attachment_naming.model.as_deref(),
            Some("not-declared"),
            "值原样保留（不静默换成别的模型）"
        );
        assert!(snap
            .warnings
            .iter()
            .any(|warning| warning.contains("不在 provider（kimi）的 models 清单内")));
        assert!(
            snap.config
                .harness
                .attachment_naming_target("kimi")
                .is_none(),
            "资格不通过 ⇒ 不发起"
        );

        let snap = load_from(
            &TempFile::new(
                r#"{"harness":{"provider":"kimi","providers":{"kimi":{"preset":"kimi","api_key":"sk","model":"k3-text","models":[{"id":"k3-text","vision":false},{"id":"k3-vision","vision":true}]}},"attachment_naming":{"model":"k3-text"}}}"#,
            )
            .0,
        );
        assert!(snap
            .warnings
            .iter()
            .any(|warning| warning.contains("未声明 vision 能力")));
        assert!(snap
            .config
            .harness
            .attachment_naming_target("kimi")
            .is_none());
        // 缺省（无覆盖）= 该条目的生效模型；生效模型有 vision 才通过。
        let snap = load_from(
            &TempFile::new(
                r#"{"harness":{"provider":"kimi","providers":{"kimi":{"preset":"kimi","api_key":"sk","model":"k3-vision","models":[{"id":"k3-text","vision":false},{"id":"k3-vision","vision":true}]}}}}"#,
            )
            .0,
        );
        let target = snap
            .config
            .harness
            .attachment_naming_target("kimi")
            .expect("生效模型声明了 vision");
        assert_eq!(target.model, "k3-vision");
        assert_eq!(target.preset, ProviderPreset::Kimi);
    }

    /// 会话命名用**显式** `providers.<id>.model`（非首项）作为回落与缺省，图片命名同理——
    /// 两条链都读同一个生效模型读数（R12h）。
    #[test]
    fn naming_defaults_use_explicit_entry_model() {
        let snap = load_from(
            &TempFile::new(
                r#"{"harness":{"provider":"kimi","providers":{"kimi":{"preset":"kimi","api_key":"sk","model":"k3-vision","models":[{"id":"k3-text","vision":false},{"id":"k3-vision","vision":true}]}},"session_naming":{"model":"stale"}}}"#,
            )
            .0,
        );
        let target = snap.config.harness.title_target("kimi");
        assert_eq!(
            target.model, "k3-vision",
            "会话命名的失效覆盖回落显式生效模型"
        );
        let target = snap
            .config
            .harness
            .attachment_naming_target("kimi")
            .expect("显式生效模型有 vision");
        assert_eq!(target.model, "k3-vision");
    }

    /// 已有 provider 被删除后，命名覆盖悬空 ⇒ 回落到当前 provider + 点名 warning（装载期兜底）。
    #[test]
    fn naming_override_dangling_falls_back_to_active() {
        let snap = load_from(
            &TempFile::new(
                r#"{"harness":{"provider":"deepseek","providers":{"deepseek":{"preset":"deepseek","api_key":"sk","models":[{"id":"ds-chat"}]}},"session_naming":{"provider":"kimi"},"attachment_naming":{"provider":"kimi"}}}"#,
            )
            .0,
        );
        assert_eq!(snap.config.harness.session_naming.provider, None);
        assert_eq!(snap.config.harness.attachment_naming.provider, None);
        assert_eq!(
            snap.warnings
                .iter()
                .filter(|warning| warning.contains("不在 harness.providers 表内"))
                .count(),
            2
        );
        assert_eq!(
            snap.config.harness.title_target("deepseek").provider,
            "deepseek"
        );
    }

    // ── 结构化诊断（design §7.1） ──────────────────────────────────────────

    /// `ConfigSnapshot.warnings` 是 `diagnostics` 的 message 投影（保序、逐字一致），
    /// 每条诊断带 code / path / severity；阻断级词表只由 Rust 一处分级。
    #[test]
    fn diagnostics_project_to_warnings_and_carry_severity() {
        let snap = load_from(
            &TempFile::new(
                r#"{"version":99,"harness":{"providers":{"kimi":{"preset":"kimi","api_key":"sk","models":[{"id":"m","effort":true,"vision":true,"window":0}]}}}}"#,
            )
            .0,
        );
        assert_eq!(
            snap.warnings,
            snap.diagnostics
                .iter()
                .map(|diagnostic| diagnostic.message.clone())
                .collect::<Vec<_>>(),
            "warnings 必须是 diagnostics 的保序投影"
        );
        let window = snap
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.code == "harness_model_window_invalid")
            .expect("window 越界必须有一条结构化诊断");
        assert_eq!(
            window.path.as_deref(),
            Some("harness.providers.kimi.models[0]")
        );
        assert_eq!(window.severity, DiagnosticSeverity::RejectOnWrite);
        let version = snap
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.code == "config_version_newer")
            .expect("版本告警");
        assert_eq!(version.path.as_deref(), Some("version"));
        assert_eq!(
            version.severity,
            DiagnosticSeverity::Warning,
            "版本告警不阻断保存"
        );
        assert_eq!(
            diagnostic_severity("settings_naming_model_missing"),
            DiagnosticSeverity::RejectOnWrite
        );
        assert_eq!(
            diagnostic_severity("settings_unknown_field"),
            DiagnosticSeverity::RejectOnWrite
        );
        assert_eq!(
            diagnostic_severity("harness_model_not_declared"),
            DiagnosticSeverity::Warning
        );
    }

    // ── 严格读 + 原子写（design §6.1 / task 2.8） ─────────────────────────

    /// 严格读：文件不存在 ⇒ 空对象可写；JSON 非法 / 顶层非对象 ⇒ 解析错误且**文件逐字节不变**。
    #[test]
    fn strict_read_rejects_invalid_json_without_touching_the_file() {
        let dir = TempDir::new("strict-read");
        let path = dir.config_path();
        // 不存在 ⇒ 正常写入。
        update_json_atomic_strict(&path, |value| {
            value["ui"] = serde_json::json!({"theme": "dark"});
            Ok(())
        })
        .expect("首次接入应可写");
        let stored: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(stored["ui"]["theme"], "dark");

        // JSON 非法 ⇒ Err，文件不变。
        std::fs::write(&path, b"{not json").expect("播种坏文件");
        let error = update_json_atomic_strict(&path, |value| {
            value["ui"] = serde_json::json!({"theme": "eink"});
            Ok(())
        })
        .expect_err("坏文件必须拒绝写入");
        assert_eq!(error.code, "config_parse_failed");
        assert!(error.message.contains("不是合法 JSON"), "{error}");
        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"{not json",
            "拒绝时文件逐字节不变"
        );

        // 顶层不是对象 ⇒ Err。
        std::fs::write(&path, b"[1,2,3]").expect("播种数组文件");
        let error = update_json_atomic_strict(&path, |_| Ok(())).expect_err("非对象必须拒绝");
        assert_eq!(error.code, "config_parse_failed");
        assert_eq!(std::fs::read(&path).unwrap(), b"[1,2,3]");
    }

    /// 宽容读仍然是既有的宽容口径（坏文件按 `{}` 起）：两条读入口的分工不许互相污染。
    #[test]
    fn lenient_read_still_starts_from_empty_object() {
        let dir = TempDir::new("lenient-read");
        let path = dir.config_path();
        std::fs::write(&path, b"{not json").expect("播种坏文件");
        update_json_atomic(&path, |value| {
            value["ui"] = serde_json::json!({"theme": "dark"});
            Ok(())
        })
        .expect("宽容读按空对象起");
        let stored: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(stored["ui"]["theme"], "dark");
    }

    /// 锁内读—改—写：并发的两个写者各写自己的键，不丢更新（task 2.9 的判据）。
    #[test]
    fn locked_read_modify_write_keeps_both_writers() {
        let dir = TempDir::new("rmw");
        let path = dir.config_path();
        std::fs::write(&path, br#"{"version":1}"#).expect("播种");
        std::thread::scope(|scope| {
            let path = path.as_path();
            scope.spawn(move || {
                for _ in 0..50 {
                    update_json_atomic(path, |value| {
                        value["ui"] = serde_json::json!({"theme": "dark"});
                        Ok(())
                    })
                    .expect("写者 A");
                }
            });
            scope.spawn(move || {
                for _ in 0..50 {
                    update_json_atomic(path, |value| {
                        value["last_vault"] = serde_json::json!("/tmp/vault");
                        Ok(())
                    })
                    .expect("写者 B");
                }
            });
        });
        let stored: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(stored["ui"]["theme"], "dark");
        assert_eq!(stored["last_vault"], "/tmp/vault");
    }

    #[test]
    fn cron_valid_task_takes_the_declared_defaults() {
        let f = TempFile::new(
            r#"{"cron":{"tasks":[{"id":"task-a","vault":"/tmp/vault-a","at":"21:00","prompt":"synthetic prompt"}]}}"#,
        );
        let snap = load_from(&f.0);
        assert!(snap.warnings.is_empty(), "{:?}", snap.warnings);
        assert!(snap.cron_issues.is_empty());
        assert_eq!(snap.config.cron.tasks.len(), 1);
        let task = &snap.config.cron.tasks[0];
        assert_eq!(task.id, "task-a");
        assert_eq!(task.at, "21:00");
        assert_eq!(task.days, CronWeekday::ALL.to_vec(), "缺省 = 全周");
        assert_eq!(task.delivery, DeliveryPolicy::NotifyThenRun);
        assert_eq!(task.session, SessionShape::New);
        assert_eq!(task.model, None);
    }

    #[test]
    fn cron_optional_fields_are_parsed() {
        let f = TempFile::new(
            r#"{"cron":{"tasks":[{"id":"task-a","vault":"/tmp/vault-a","at":"10:00","days":["mon","wed"],"prompt":"p","delivery":"run-then-notify","session":"dedicated","model":"model-1","unknown_key":true}]}}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(
            snap.config.cron.tasks[0].days,
            vec![CronWeekday::Mon, CronWeekday::Wed]
        );
        assert_eq!(
            snap.config.cron.tasks[0].delivery,
            DeliveryPolicy::RunThenNotify
        );
        assert_eq!(snap.config.cron.tasks[0].session, SessionShape::Dedicated);
        assert_eq!(snap.config.cron.tasks[0].model.as_deref(), Some("model-1"));
        assert!(
            snap.warnings.is_empty(),
            "未知字段静默忽略：{:?}",
            snap.warnings
        );
    }

    /// 坏一项只丢该项：合法任务照常生效，warning 与结构化 issue 同源。
    #[test]
    fn cron_invalid_at_drops_only_that_task() {
        let f = TempFile::new(
            r#"{"cron":{"tasks":[
                {"id":"task-a","vault":"/tmp/vault-a","at":"21:00","prompt":"p"},
                {"id":"task-b","vault":"/tmp/vault-b","at":"25:00","prompt":"p"}
            ]}}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(snap.config.cron.tasks.len(), 1);
        assert_eq!(snap.config.cron.tasks[0].id, "task-a");
        assert_eq!(snap.warnings.len(), 1);
        assert!(
            snap.warnings[0].contains("\"task-b\""),
            "{:?}",
            snap.warnings
        );
        assert!(snap.warnings[0].contains("25:00"), "{:?}", snap.warnings);
        assert_eq!(snap.cron_issues.len(), 1);
        assert_eq!(snap.cron_issues[0].task, "task-b");
        assert_eq!(snap.cron_issues[0].field, "at");
    }

    #[test]
    fn cron_missing_or_blank_prompt_drops_the_task() {
        for prompt in [
            r#"{"id":"task-a","vault":"/tmp/vault-a","at":"21:00"}"#,
            r#"{"id":"task-a","vault":"/tmp/vault-a","at":"21:00","prompt":"   "}"#,
        ] {
            let f = TempFile::new(&format!(r#"{{"cron":{{"tasks":[{prompt}]}}}}"#));
            let snap = load_from(&f.0);
            assert!(snap.config.cron.tasks.is_empty(), "{prompt}");
            assert_eq!(snap.cron_issues.len(), 1, "{prompt}");
            assert_eq!(snap.cron_issues[0].field, "prompt");
        }
    }

    #[test]
    fn cron_duplicate_id_keeps_the_first_task() {
        let f = TempFile::new(
            r#"{"cron":{"tasks":[
                {"id":"task-a","vault":"/tmp/vault-a","at":"21:00","prompt":"first"},
                {"id":"task-a","vault":"/tmp/vault-b","at":"22:00","prompt":"second"}
            ]}}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(snap.config.cron.tasks.len(), 1);
        assert_eq!(snap.config.cron.tasks[0].prompt, "first");
        assert_eq!(snap.cron_issues[0].field, "id");
        assert_eq!(snap.cron_issues[0].task, "task-a");
    }

    #[test]
    fn cron_non_absolute_vault_drops_the_task() {
        let f = TempFile::new(
            r#"{"cron":{"tasks":[{"id":"task-a","vault":"relative/path","at":"21:00","prompt":"p"}]}}"#,
        );
        let snap = load_from(&f.0);
        assert!(snap.config.cron.tasks.is_empty());
        assert_eq!(snap.cron_issues[0].field, "vault");
    }

    #[test]
    fn cron_invalid_or_empty_days_drops_the_task() {
        for days in [r#"[]"#, r#"["mon","funday"]"#, r#""mon""#, r#"[7]"#] {
            let f = TempFile::new(&format!(
                r#"{{"cron":{{"tasks":[{{"id":"task-a","vault":"/tmp/vault-a","at":"21:00","days":{days},"prompt":"p"}}]}}}}"#
            ));
            let snap = load_from(&f.0);
            assert!(snap.config.cron.tasks.is_empty(), "days={days}");
            assert_eq!(snap.cron_issues[0].field, "days", "days={days}");
        }
    }

    /// delivery / session 非法**保留任务**并回落缺省（向保守方向：不花 token）。
    #[test]
    fn cron_invalid_delivery_and_session_fall_back_without_dropping() {
        let f = TempFile::new(
            r#"{"cron":{"tasks":[{"id":"task-a","vault":"/tmp/vault-a","at":"21:00","prompt":"p","delivery":"notify-me","session":"shared"}]}}"#,
        );
        let snap = load_from(&f.0);
        assert_eq!(snap.config.cron.tasks.len(), 1, "任务必须保留");
        assert_eq!(
            snap.config.cron.tasks[0].delivery,
            DeliveryPolicy::NotifyThenRun
        );
        assert_eq!(snap.config.cron.tasks[0].session, SessionShape::New);
        assert_eq!(snap.warnings.len(), 2, "{:?}", snap.warnings);
        assert!(snap.cron_issues.is_empty(), "非致命项不进丢弃记录");
    }

    #[test]
    fn cron_invalid_model_drops_only_the_key() {
        for model in [r#""""#, r#"42"#] {
            let f = TempFile::new(&format!(
                r#"{{"cron":{{"tasks":[{{"id":"task-a","vault":"/tmp/vault-a","at":"21:00","prompt":"p","model":{model}}}]}}}}"#
            ));
            let snap = load_from(&f.0);
            assert_eq!(snap.config.cron.tasks.len(), 1, "model={model}");
            assert_eq!(snap.config.cron.tasks[0].model, None);
            assert_eq!(snap.warnings.len(), 1, "model={model}");
        }
    }

    #[test]
    fn cron_empty_tasks_and_missing_section_are_silent() {
        for body in [r#"{}"#, r#"{"cron":{}}"#, r#"{"cron":{"tasks":[]}}"#] {
            let f = TempFile::new(body);
            let snap = load_from(&f.0);
            assert!(snap.config.cron.tasks.is_empty(), "{body}");
            assert!(snap.warnings.is_empty(), "{body}: {:?}", snap.warnings);
            assert!(snap.cron_issues.is_empty(), "{body}");
        }
    }

    #[test]
    fn cron_non_object_task_item_is_dropped() {
        let f = TempFile::new(r#"{"cron":{"tasks":[42]}}"#);
        let snap = load_from(&f.0);
        assert!(snap.config.cron.tasks.is_empty());
        assert_eq!(snap.cron_issues[0].field, "tasks");
        assert_eq!(snap.cron_issues[0].task, "");
    }

    /// 整节错形状 / `tasks` 非数组 → 整文件回落（既有解析模型，不发明逐字段容忍）。
    #[test]
    fn cron_wrong_section_shape_falls_back_the_entire_file() {
        for body in [
            r#"{"last_vault":"/tmp/vault","cron":"wrong-shape"}"#,
            r#"{"last_vault":"/tmp/vault","cron":{"tasks":"wrong-shape"}}"#,
        ] {
            let f = TempFile::new(body);
            let snap = load_from(&f.0);
            assert_eq!(snap.config, AppConfig::default(), "{body}");
            assert_eq!(snap.warnings.len(), 1, "{body}");
            assert!(
                snap.warnings[0].contains("不是合法 JSON"),
                "{:?}",
                snap.warnings
            );
            assert!(snap.fallback, "整文件回落必须如实标记：{body}");
        }
    }

    /// 回落标记只在「本次没能按文件解释」时置位（change add-cron-conversational-registration
    /// design §3.3 的判据）：正常解析与文件缺失都不算失败。
    #[test]
    fn fallback_flag_marks_only_real_failures() {
        let normal = TempFile::new(r#"{"last_vault":"/tmp/vault"}"#);
        assert!(!load_from(&normal.0).fallback);
        assert!(!load_from(&TempFile::missing().0).fallback, "缺失是常态");
        let broken = TempFile::new("{not json");
        assert!(load_from(&broken.0).fallback);
    }

    // -----------------------------------------------------------------------
    // 读—改—写同锁（change add-cron-conversational-registration tasks 1.3 / 1.4）
    // -----------------------------------------------------------------------

    /// 并发写者各改一个键：两个键都在、无 tmp 残留、未知顶层键保留。
    ///
    /// 区分度：去掉 `update_json_atomic` 里的锁（或把读移到锁外）后，两个线程会读到同一份旧
    /// 版本、后写者顶掉前者的键——本用例必 FAIL。
    #[test]
    fn update_json_atomic_serializes_concurrent_writers() {
        let dir = TempDir::new("update-json");
        let path = dir.config_path();
        std::fs::write(&path, r#"{"unknown_top":{"keep":true}}"#).unwrap();

        let first = path.clone();
        let second = path.clone();
        let one = std::thread::spawn(move || {
            update_json_atomic(&first, |value| {
                value["ui"]["theme"] = serde_json::json!("dark");
                Ok(())
            })
            .expect("写 ui.theme")
        });
        let two = std::thread::spawn(move || {
            update_json_atomic(&second, |value| {
                value["cron"]["tasks"] = serde_json::json!([]);
                Ok(())
            })
            .expect("写 cron.tasks")
        });
        one.join().unwrap();
        two.join().unwrap();

        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["ui"]["theme"], serde_json::json!("dark"));
        assert_eq!(value["cron"]["tasks"], serde_json::json!([]));
        assert_eq!(value["unknown_top"], serde_json::json!({"keep": true}));
        assert_eq!(value["version"], serde_json::json!(SCHEMA_VERSION));

        // 没有 tmp 残留（原子写成功即 rename 走，失败也清理）。
        let leftovers: Vec<String> = std::fs::read_dir(dir.0.clone())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "tmp 残留：{leftovers:?}");
    }

    /// 闭包返回 `Err` 时不落盘：文件逐字节不变（失败路径的区分度由前一条并发用例提供——
    /// 同一入口能成功写）。
    #[test]
    fn update_json_atomic_does_not_write_when_the_closure_fails() {
        let dir = TempDir::new("update-json-abort");
        let path = dir.config_path();
        std::fs::write(&path, r#"{"ui":{"theme":"light"}}"#).unwrap();
        let before = std::fs::read(&path).unwrap();

        let error = update_json_atomic(&path, |value| {
            value["ui"]["theme"] = serde_json::json!("dark");
            Err(CommandError::new("config_write_failed", "拒绝写入"))
        })
        .expect_err("闭包失败必须冒泡");
        assert_eq!(error.code, "config_write_failed");
        assert_eq!(std::fs::read(&path).unwrap(), before, "失败不得落盘");

        // 同路径能成功写（证明「没写」不是因为写不进去）。
        update_json_atomic(&path, |value| {
            value["ui"]["theme"] = serde_json::json!("dark");
            Ok(())
        })
        .expect("同一路径应可写");
        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["ui"]["theme"], serde_json::json!("dark"));
    }

    // -----------------------------------------------------------------------
    // 持久权限规则的追加 / 删除（change harness-permission-rules-oct23 tasks 2.3 / 2.6）
    // -----------------------------------------------------------------------

    /// 追加去重：同一条规则写两次仍只有一条；其它键逐键保留。
    #[test]
    fn append_permission_rule_dedupes_and_keeps_other_keys() {
        let dir = TempDir::new("perm-rules-append");
        let path = dir.config_path();
        std::fs::write(
            &path,
            r#"{"harness":{"permission_mode":"read_only"},"unknown_top":{"keep":true}}"#,
        )
        .unwrap();

        append_permission_rule_to(&path, "cli(tvly search *)").expect("第一次追加");
        append_permission_rule_to(&path, "cli(tvly search *)").expect("重复追加");
        append_permission_rule_to(&path, "vault_patch(notes/*)").expect("第二条");

        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            value["harness"]["permissions"]["allow"],
            serde_json::json!(["cli(tvly search *)", "vault_patch(notes/*)"]),
            "去重按字符串全等，顺序按追加"
        );
        assert_eq!(
            value["harness"]["permission_mode"],
            serde_json::json!("read_only"),
            "同一张 [harness] 表的其它键逐键保留"
        );
        assert_eq!(value["unknown_top"], serde_json::json!({"keep": true}));
    }

    /// 空规则拒绝（后端单写者的入参校验）：文件不落盘。
    #[test]
    fn append_permission_rule_rejects_empty_rule() {
        let dir = TempDir::new("perm-rules-empty");
        let path = dir.config_path();
        let before = std::fs::read(&path).ok();
        let error = append_permission_rule_to(&path, "   ").expect_err("空规则必须报错");
        assert_eq!(error.code, "permission_rule_invalid");
        assert_eq!(std::fs::read(&path).ok(), before);
    }

    /// 删除幂等：第一条全等匹配被移除；不存在时安静成功（`false`）且不落盘改内容。
    #[test]
    fn remove_permission_rule_is_idempotent() {
        let dir = TempDir::new("perm-rules-remove");
        let path = dir.config_path();
        std::fs::write(
            &path,
            r#"{"harness":{"permissions":{"allow":["cli(a *)","cli(b *)"]}}}"#,
        )
        .unwrap();

        assert!(
            remove_permission_rule_to(&path, "cli(a *)").expect("删除"),
            "存在即 true"
        );
        assert!(
            !remove_permission_rule_to(&path, "cli(a *)").expect("重复删除"),
            "不存在即 false（幂等）"
        );
        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            value["harness"]["permissions"]["allow"],
            serde_json::json!(["cli(b *)"])
        );
    }

    /// 错形状宽容：缺 `[harness].permissions` 时追加会建出结构；`allow` 不是数组时重置为空数组。
    #[test]
    fn append_permission_rule_tolerates_bad_shapes() {
        let dir = TempDir::new("perm-rules-shape");
        let path = dir.config_path();
        std::fs::write(&path, r#"{"harness":{"permissions":{"allow":"nope"}}}"#).unwrap();
        append_permission_rule_to(&path, "cli(x *)").expect("错形状也要能写");
        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            value["harness"]["permissions"]["allow"],
            serde_json::json!(["cli(x *)"])
        );
    }
}
