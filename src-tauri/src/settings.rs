//! 设置面的读写通道（change add-model-automation-settings-oct24 tasks §3 / design §5–§9）。
//!
//! 两个入口：
//! - [`snapshot_at`]：只含设置面的读快照——raw 文件值与装载后的生效值分开、顶层 `revision`、
//!   Key 只回末 4 位、引用面布尔、命名目标的解析读数、文件状态与能力矩阵；
//! - [`apply_at`]：一次强类型 patch，在 [`config::update_json_atomic_strict`] 的**同一把锁**
//!   内完成「严格读 → 比对 revision → 应用 Add / Update / Delete / active / automation /
//!   naming → 严格复解析 → 非回归判据 → 引用完整性复核 → 原子写」。
//!
//! 校验的唯一来源是 [`config::validate_value`]（与装载期同一段解析 + 校验）；本模块不复制
//! 窗口区间、枚举表、id 规则或 `configured` 判据——能力矩阵从 [`config`] 的常量与
//! [`ProviderPreset`] 的方法派生（REVIEW.md『同一语义两处真源』条）。
//!
//! **未知字段**：patch 的所有结构都按白名单走一遍（[`parse_patch`]），出现未定义字段即整笔
//! 拒绝（`settings_unknown_field`）；`deny_unknown_fields` 只作为第二道防线（serde 对
//! 内部标签枚举的变体不执行它，白名单是真正生效的那一道）。
//!
//! **Blocked 时文件逐字节不变**：patch 只改 `value` 的克隆，只有全部校验通过才把候选值交回
//! [`config::update_json_atomic_strict`]；Blocked / Conflict 走 `Ok(None)`——「不写」是闭包的
//! 返回值，不靠抛内部错误来中止写。

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::Path;
use ts_rs::TS;

use crate::commands::CommandError;
use crate::config::{
    self, provider_id_valid, AppConfig, ConfigDiagnostic, DiagnosticSeverity, HarnessConfig,
    HarnessModelSpec, HarnessProviderConfig, ProviderPreset, WireApi, FALLBACK_CONTEXT_WINDOW,
    MODEL_WINDOW_MAX, MODEL_WINDOW_MIN, RESERVED_PROVIDER_ID,
};

// ---------------------------------------------------------------------------
// 快照
// ---------------------------------------------------------------------------

/// 配置文件的读取状态（design §5）：`Missing` = 首次接入的主路径（按空对象算 revision）；
/// `Invalid` = JSON 不合法 / 顶层不是对象 / 结构解析会触发整文件回落——此时 `revision` 为
/// `None`、保存禁用，`providers` / `automation` 仍尽力从 raw JSON 读出供只读展示。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "state", rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum SettingsFileState {
    Missing,
    Valid,
    Invalid {
        message: String,
        line: Option<u32>,
        column: Option<u32>,
    },
}

/// 一个可选字段的 raw 状态（design §5「raw vs 生效」）：`Absent` = 键缺席（跟随默认），
/// `Present` = 文件里显式写了值。字段旁的「默认」徽标与「恢复默认」（删键）都靠它。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum FieldState<T> {
    Absent,
    Present(T),
}

/// 文件里的原 JSON 值（`wire_api` 的 raw 面，design §5）：只给前端显示与标注用，不参与任何
/// 解析。`text` 是字符串原值（非字符串时是 JSON 文本，截断到 200 字符）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct RawJsonValue {
    pub kind: RawJsonKind,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum RawJsonKind {
    Null,
    Bool,
    Number,
    String,
    Array,
    Object,
}

/// API Key 的可见状态（design §5 / Q3）：完整 Key 永不回传，`Set` 至多带末 4 位。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "state", rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum ApiKeyState {
    Unset,
    Set { hint: Option<String> },
}

/// provider 的可用状态（design §5 / §11.4 的徽标）。判定顺序固定：
/// `Invalid`（装载期被忽略）→ `MissingApiKey` → `MissingBaseUrl`（generic 无官方地址）→
/// `MissingModels` → `Ok`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum ProviderStatus {
    Ok,
    MissingApiKey,
    MissingModels,
    MissingBaseUrl,
    Invalid,
}

/// 模型清单的一行 raw 草稿（design §5）：含会被装载期丢弃的坏项——坏项 MUST 在编辑面可见，
/// 否则一次保存就会静默清掉文件里的坏值。`valid = false` 只由「该行会被丢弃」的诊断给出，
/// 判定本身仍在 [`config`] 的校验里（这里只按 code 分类，不重做规则）。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ModelDraft {
    pub id: String,
    pub effort: Option<bool>,
    pub vision: Option<bool>,
    pub window: Option<u64>,
    /// false = 该行会被装载期丢弃（`diagnostics` 里有对应的丢弃级诊断）。
    pub valid: bool,
    /// 该行的装载期诊断文案（缺省字段的提示也在这里，如「未声明 effort」）。
    pub diagnostics: Vec<String>,
    /// 保存时按 `id` 原样保留的未知子键（design §6.5）。
    pub unknown_keys: Vec<String>,
}

/// 装载后的读数（design §5 的 `ProviderEffective`）：官方/生效 Base URL、生效方言与有效清单。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ProviderEffective {
    pub official_base_url: Option<String>,
    pub base_url: Option<String>,
    pub wire_api: WireApi,
    pub models: Vec<HarnessModelSpec>,
}

/// 删除保护的引用面（design §5 / §4.2）：三个布尔供删除确认渲染替代目标控件；后端在
/// [`apply_at`] 里**重新计算**，两者不互为真源。`active` 用**生效** active id（含缺省回退），
/// 命名两项只看显式覆盖（`provider` 键等于该 id）——「跟随当前」由删除 active 时的隐式
/// 重算处理，不需要替代目标控件。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ProviderReferences {
    pub active: bool,
    pub session_naming: bool,
    pub attachment_naming: bool,
}

/// 设置面里一个 provider 的完整视图（design §5）。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ProviderSettings {
    pub id: String,
    /// 条目预设：装载成功后取生效值；被忽略的条目取文件里能解析到的值。
    /// `None` = 预设非法 / 未知；`status = Invalid` 的条目仍可能带 `Some`（例如 `mock` 预设
    /// 写在非保留 id 上——预设本身合法，但与 id 规则冲突而被整条忽略）。
    pub preset: Option<ProviderPreset>,
    /// 文件里的预设原文（含非法值与缺席的空串），供「装载期已忽略」行显示。
    pub raw_preset: String,
    pub configured: bool,
    pub status: ProviderStatus,
    pub api_key: ApiKeyState,
    pub models: Vec<ModelDraft>,
    /// 生效模型（显式值 → 清单首项 → 空串，由装载期解析）。
    pub model: String,
    pub base_url: FieldState<String>,
    /// raw 原 JSON 值（含闭集合外的字符串）；生效方言在 `effective.wire_api`。
    pub wire_api: FieldState<RawJsonValue>,
    pub effective: ProviderEffective,
    pub references: ProviderReferences,
    /// 设置面不认识的键（保存时原样保留，design §6.5）。
    pub unknown_keys: Vec<String>,
}

/// 一个开关的读数（design §5）：`explicit = false` 表示键缺席、用默认，前端据此显示
/// 「默认」徽标与「恢复默认」。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AutomationFlag {
    pub value: bool,
    pub explicit: bool,
}

/// 四个自动化开关（全局 `harness.*` 键，不属于任何 provider）。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AutomationSettings {
    pub auto_compact: AutomationFlag,
    pub session_naming: AutomationFlag,
    pub attachment_naming: AutomationFlag,
    pub subagents: AutomationFlag,
}

/// 命名目标 provider 选择器的一项（design §5）。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct NamingProviderOption {
    pub id: String,
    pub is_active: bool,
    pub configured: bool,
}

/// 命名目标模型选择器的一项；`is_effective` = 它是该 provider 的生效模型（「生效模型
/// （默认：…）」选项的目标）。图片命名在前端按 `vision` 标资格。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct NamingModelOption {
    pub id: String,
    pub vision: bool,
    pub is_effective: bool,
}

/// 解析后的命名目标（design §5 / §10.5 那一行生效说明的数据面）。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ResolvedNamingTarget {
    pub provider: Option<String>,
    /// 解析后的模型（空 = 无可用模型 / mock 无模型维度）。
    pub model: String,
    /// 目标是否来自缺省（跟随当前）而非显式覆盖。
    pub follows_active: bool,
    /// raw 覆盖悬空（已回落当前 provider）。
    pub dangling: bool,
    /// 会话命名 = 模型非空；图片命名 = 模型声明 `vision`（mock 档按 fixture 驱动判定）。
    pub eligible: bool,
    /// 不合格的原因码（前端映射文案）：`no_target_provider` / `no_model` / `no_vision` /
    /// `mock_model_override`。
    pub reason: Option<String>,
}

/// 一组命名目标：两个可编辑的覆盖键 + 解析结果 + 两个选择器的选项（design §5 / §10.2）。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct NamingTargetState {
    /// raw `harness.<kind>.provider`；`None` = 跟随当前。
    pub override_provider: Option<String>,
    /// raw `harness.<kind>.model`；`None` = 用目标 provider 的生效模型。
    pub override_model: Option<String>,
    pub provider_options: Vec<NamingProviderOption>,
    pub model_options: Vec<NamingModelOption>,
    pub resolved: ResolvedNamingTarget,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct NamingSettings {
    pub session: NamingTargetState,
    pub attachment: NamingTargetState,
}

/// 一个预设的能力（design §5「capabilities 由后端下发」）：官方 Base URL、支持的 wire、
/// 缺省 wire、是否要求 Key。前端 MUST NOT 复制这些常量。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct PresetCapability {
    pub preset: ProviderPreset,
    pub official_base_url: Option<String>,
    pub supported_wire_apis: Vec<WireApi>,
    pub default_wire_api: WireApi,
    pub requires_api_key: bool,
}

/// 设置面的能力矩阵：预设表、id 正则、保留 id、规范顺序、窗口区间。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SettingsCapabilities {
    pub presets: Vec<PresetCapability>,
    pub provider_id_pattern: String,
    pub reserved_provider_ids: Vec<String>,
    /// 列表展示与 revision 遍历共用的规范顺序（`mock` 在末位，但列表不呈现它）。
    pub provider_order: Vec<ProviderPreset>,
    pub model_window_min: u64,
    pub model_window_max: u64,
}

/// 设置面的默认值（键缺席时的生效值；前端显示「默认」与「生效模型（默认：…）」用它）。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SettingsDefaults {
    pub auto_compact: bool,
    pub session_naming_enabled: bool,
    pub attachment_naming_enabled: bool,
    pub subagents_enabled: bool,
    /// 未声明 `window` 时的保守回落值（tokens）。
    pub model_window: u64,
}

/// 设置面快照（design §5）：只含设置面的键，不把整份 [`AppConfig`] 交给页面。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SettingsSnapshot {
    pub path: String,
    pub file: SettingsFileState,
    /// 非 Invalid 恒有：Missing 按空对象算；Invalid = None。
    pub revision: Option<String>,
    /// 规范顺序（预设顺序 → id 字典序），`mock` 不出现；装载期被忽略的条目以
    /// `status = Invalid` 出现在末尾。
    pub providers: Vec<ProviderSettings>,
    /// 生效 active id；`None` = 无 provider。
    pub active: Option<String>,
    /// `harness.provider` 键是否显式存在且指向有效条目。
    pub active_explicit: bool,
    pub automation: AutomationSettings,
    pub naming: NamingSettings,
    pub capabilities: SettingsCapabilities,
    pub defaults: SettingsDefaults,
    /// 设置面范围内的诊断 + 文件级诊断（范围外的主题 / 编辑器 warning 不进这里）。
    pub diagnostics: Vec<ConfigDiagnostic>,
}

// ---------------------------------------------------------------------------
// patch
// ---------------------------------------------------------------------------

/// 一次字段编辑：`Set` 写入；`Reset` **删键**（恢复默认，不是写入默认值）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum FieldEdit<T> {
    Set(T),
    Reset,
}

/// API Key 的编辑：`Replace` 写入新值（明文存储，Alex 已裁）；`Clear` 删键（回到未配置）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum ApiKeyEdit {
    Replace(String),
    Clear,
}

/// 删除 provider 时命名目标的重定向（design §4.2）：`FollowActive` = 删键跟随当前；
/// `Provider(id)` = 显式指向另一个可替代候选。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum NamingRetarget {
    FollowActive,
    Provider(String),
}

/// 模型清单的一次整表替换项（四项全显式；未知子键按 `id` 从当前 raw 清单保留）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ModelInput {
    pub id: String,
    pub effort: bool,
    pub vision: bool,
    pub window: u64,
}

/// 一类 provider 编辑（design §6）。`preset` 只在 `Add` 出现——创建后不可改；`Update` 里
/// 出现 `preset` 会被拒（`settings_provider_preset_immutable`）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "action", rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum ProviderEdit {
    Add {
        id: String,
        preset: ProviderPreset,
    },
    Update {
        id: String,
        /// `None` = 不动该键。
        #[ts(optional)]
        api_key: Option<ApiKeyEdit>,
        /// `None` = 不动；`Some` = 整表替换（四项全显式）。
        #[ts(optional)]
        models: Option<Vec<ModelInput>>,
        #[ts(optional)]
        base_url: Option<FieldEdit<String>>,
        #[ts(optional)]
        wire_api: Option<FieldEdit<WireApi>>,
    },
    Delete {
        id: String,
        /// 删除的是当前使用项时必填（除非删后没有可替代候选）。
        #[ts(optional)]
        active_after: Option<String>,
        #[ts(optional)]
        session_naming_after: Option<NamingRetarget>,
        #[ts(optional)]
        attachment_naming_after: Option<NamingRetarget>,
    },
}

/// 四个开关的 patch（每个键独立：`None` = 不动）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AutomationPatch {
    #[ts(optional)]
    pub auto_compact: Option<FieldEdit<bool>>,
    #[ts(optional)]
    pub session_naming: Option<FieldEdit<bool>>,
    #[ts(optional)]
    pub attachment_naming: Option<FieldEdit<bool>>,
    #[ts(optional)]
    pub subagents: Option<FieldEdit<bool>>,
}

/// 一组命名目标的覆盖键编辑（design §6 / §10.2）：provider 先应用（换目标清 model），
/// model 后应用（按新目标的清单校验）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct NamingEdit {
    #[ts(optional)]
    pub provider: Option<FieldEdit<String>>,
    #[ts(optional)]
    pub model: Option<FieldEdit<String>>,
}

/// 两个命名目标；`None` = 本笔不动该组。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct NamingPatch {
    #[ts(optional)]
    pub session: Option<NamingEdit>,
    #[ts(optional)]
    pub attachment: Option<NamingEdit>,
}

/// 一次保存的完整 patch（design §6）：只携带本次改动的字段，MUST NOT 携带整份配置。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SettingsPatch {
    /// 设置面 revision（覆盖 provider 条目、active、四个开关、两个命名目标的 provider/model；
    /// **不含** `providers.<id>.model`）。
    pub base_revision: String,
    #[ts(optional)]
    pub active_provider: Option<FieldEdit<String>>,
    #[serde(default)]
    pub providers: Vec<ProviderEdit>,
    #[serde(default)]
    pub automation: AutomationPatch,
    #[ts(optional)]
    pub naming: Option<NamingPatch>,
}

// ---------------------------------------------------------------------------
// 结果
// ---------------------------------------------------------------------------

/// 一条字段级错误（design §6）：`path` 是键路径（patch 输入错误给 patch 相对路径，
/// 文件级为空串）；前端按它回填控件。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SettingsFieldError {
    pub path: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum SettingsApplyStatus {
    Applied,
    Blocked,
    Conflict,
    FileInvalid,
}

/// 一次保存的结果（design §6）：每次返回最新快照；保存成功 MUST NOT 被表述为「已生效」。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SettingsApplyOutcome {
    pub status: SettingsApplyStatus,
    pub snapshot: SettingsSnapshot,
    pub errors: Vec<SettingsFieldError>,
    pub warnings: Vec<ConfigDiagnostic>,
}

// ---------------------------------------------------------------------------
// 内部类型
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NamingKind {
    Session,
    Attachment,
}

impl NamingKind {
    fn table(self) -> &'static str {
        match self {
            NamingKind::Session => "session_naming",
            NamingKind::Attachment => "attachment_naming",
        }
    }

    fn label(self) -> &'static str {
        match self {
            NamingKind::Session => "会话命名",
            NamingKind::Attachment => "图片命名",
        }
    }

    fn provider_path(self) -> String {
        format!("harness.{}.provider", self.table())
    }

    fn model_path(self) -> String {
        format!("harness.{}.model", self.table())
    }
}

/// 内部停机原因（不序列化）：Blocked = 本笔被拒；Conflict = revision 不符；FileInvalid =
/// 锁内读到的文件结构不可解析。
#[derive(Debug)]
enum ApplyStop {
    Blocked(Vec<SettingsFieldError>),
    Conflict,
    FileInvalid(String),
}

/// 本笔 patch 里一条删除项的三个引用参数（借用 patch；避免把四元组散在循环里）。
struct ProviderDeleteRef<'a> {
    /// patch 内的位置（错误路径回填用）。
    index: usize,
    id: &'a str,
    active_after: Option<&'a String>,
    session_naming_after: Option<&'a NamingRetarget>,
    attachment_naming_after: Option<&'a NamingRetarget>,
}

/// 本笔 patch 改过的路径集合（design §6.3 的 `changed_paths`）。
#[derive(Debug, Default)]
struct AppliedChanges {
    changed_paths: Vec<String>,
    /// 被改过字段的条目根路径：只给「条目级」诊断（半配置 / generic 缺 base_url）判相交用——
    /// 它们描述的是字段之间的关系，单独按字段路径比较会漏判。
    touched_entries: Vec<String>,
}

impl AppliedChanges {
    /// 改了一个字段（或其整条路径）。
    fn field(&mut self, path: impl Into<String>) {
        self.changed_paths.push(path.into());
    }

    /// 整条 provider 条目被添加 / 删除（其全部后代都算改动）。
    fn entry(&mut self, path: impl Into<String>) {
        let path = path.into();
        self.changed_paths.push(path.clone());
        self.touched_entries.push(path);
    }

    /// 只登记条目根（供条目级诊断使用），不把整条条目算作改动。
    fn note_entry(&mut self, path: impl Into<String>) {
        self.touched_entries.push(path.into());
    }

    fn touched(&self, path: &str) -> bool {
        self.changed_paths
            .iter()
            .any(|changed| paths_intersect(changed, path))
    }

    /// 诊断路径是否与本笔改动相交（design §6.3）：相等 / 诊断在改动之下 / 诊断是改动的祖先；
    /// 两个条目级 code 另外按「同一条目」判相交。
    fn intersects(&self, diagnostic: &ConfigDiagnostic) -> bool {
        let Some(path) = diagnostic.path.as_deref() else {
            return false;
        };
        if self
            .changed_paths
            .iter()
            .any(|changed| paths_intersect(changed, path))
        {
            return true;
        }
        matches!(
            diagnostic.code.as_str(),
            "harness_models_empty_when_configured" | "harness_base_url_required"
        ) && self
            .touched_entries
            .iter()
            .any(|entry| path_is_under(path, entry))
    }
}

// ---------------------------------------------------------------------------
// 读：快照
// ---------------------------------------------------------------------------

/// 读设置面快照（design §5）。只读、不取写锁；调用方传配置文件路径。
pub fn snapshot_at(path: &Path) -> SettingsSnapshot {
    let path_str = path.display().to_string();
    let mut file = SettingsFileState::Missing;
    let mut value = Value::Object(Map::new());
    let mut effective: Option<AppConfig> = None;
    let mut diagnostics: Vec<ConfigDiagnostic> = Vec::new();
    let mut revision: Option<String> = None;

    match std::fs::read_to_string(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // 文件不存在是 Valid 语义里的「空配置」：按空对象算 revision，首次接入也能保存。
            effective = Some(AppConfig::default());
            revision = Some(revision_of(&value));
        }
        Err(error) => {
            file = SettingsFileState::Invalid {
                message: format!("无法读取配置文件：{error}"),
                line: None,
                column: None,
            };
        }
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Err(error) => {
                file = SettingsFileState::Invalid {
                    message: format!("配置文件不是合法 JSON：{error}"),
                    line: Some(error.line() as u32),
                    column: Some(error.column() as u32),
                };
            }
            Ok(parsed) if !parsed.is_object() => {
                value = parsed;
                file = SettingsFileState::Invalid {
                    message: "配置文件顶层不是 JSON 对象".to_string(),
                    line: None,
                    column: None,
                };
            }
            Ok(parsed) => {
                value = parsed;
                match config::validate_value(&value) {
                    Ok((config, diags)) => {
                        effective = Some(config);
                        diagnostics = diags;
                        revision = Some(revision_of(&value));
                        file = SettingsFileState::Valid;
                    }
                    Err(message) => {
                        // 整文件回落（结构不符）：仍尽力从 harness 子树读出只读展示面。
                        let harness_only = serde_json::json!({
                            "harness": value.get("harness").cloned().unwrap_or(Value::Object(Map::new())),
                        });
                        if let Ok((config, diags)) = config::validate_value(&harness_only) {
                            effective = Some(config);
                            diagnostics = diags;
                        }
                        file = SettingsFileState::Invalid {
                            message,
                            line: None,
                            column: None,
                        };
                    }
                }
            }
        },
    }

    let harness = effective.as_ref().map(|config| &config.harness);
    let raw = raw_harness(&value);
    let active = harness
        .and_then(|h| (!h.provider.is_empty()).then(|| h.provider.clone()))
        .or_else(|| raw_trimmed(raw, "provider"));
    let providers = build_providers(raw, harness, active.as_deref(), &diagnostics);
    let active_explicit = raw_trimmed(raw, "provider")
        .is_some_and(|id| harness.is_some_and(|h| h.providers.contains_key(&id)));
    let diagnostics = diagnostics
        .into_iter()
        .filter(|diagnostic| diagnostic.path.as_deref().is_none_or(in_settings_scope))
        .collect();
    let naming = NamingSettings {
        session: build_naming_target(NamingKind::Session, raw, harness, active.as_deref()),
        attachment: build_naming_target(NamingKind::Attachment, raw, harness, active.as_deref()),
    };

    SettingsSnapshot {
        path: path_str,
        file,
        revision,
        providers,
        active,
        active_explicit,
        automation: build_automation(raw, harness),
        naming,
        capabilities: capabilities(),
        defaults: settings_defaults(),
        diagnostics,
    }
}

fn raw_harness(value: &Value) -> Option<&Map<String, Value>> {
    value.get("harness").and_then(Value::as_object)
}

fn raw_text(map: Option<&Map<String, Value>>, key: &str) -> Option<String> {
    map.and_then(|object| object.get(key))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn raw_trimmed(map: Option<&Map<String, Value>>, key: &str) -> Option<String> {
    raw_text(map, key)
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn raw_naming_table(value: &Value, kind: NamingKind) -> Option<&Map<String, Value>> {
    raw_harness(value)
        .and_then(|harness| harness.get(kind.table()))
        .and_then(Value::as_object)
}

fn raw_naming_provider(value: &Value, kind: NamingKind) -> Option<String> {
    raw_trimmed(raw_naming_table(value, kind), "provider")
}

/// 设置面范围内的诊断：provider 条目 / active / 四个开关 / 两个命名表 + 文件级。
fn in_settings_scope(path: &str) -> bool {
    path == "harness.provider"
        || path == "harness.auto_compact"
        || under(path, "harness.providers")
        || under(path, "harness.session_naming")
        || under(path, "harness.attachment_naming")
        || path == "harness.subagents.enabled"
}

fn build_providers(
    raw: Option<&Map<String, Value>>,
    harness: Option<&HarnessConfig>,
    active: Option<&str>,
    diagnostics: &[ConfigDiagnostic],
) -> Vec<ProviderSettings> {
    let Some(raw_providers) = raw
        .and_then(|object| object.get("providers"))
        .and_then(Value::as_object)
    else {
        return Vec::new();
    };
    let mut providers: Vec<ProviderSettings> = raw_providers
        .iter()
        .map(|(id, entry)| {
            build_provider(
                id,
                entry,
                raw,
                harness.and_then(|config| config.providers.get(id)),
                active,
                diagnostics,
            )
        })
        // 只过滤**保留 id `mock` 的验收档**（design §2.2：它不上面板、不可新增 / 删除）。
        // 别的 id 上写了 `preset: mock` 是装载期被忽略的坏条目——必须保留展示（status=Invalid），
        // 否则用户既看不见也删不掉（design §6.6 的「坏条目 MUST 可见」）。
        .filter(|provider| provider.id != RESERVED_PROVIDER_ID)
        .collect();
    providers.sort_by(|a, b| {
        (preset_rank(a.preset), a.id.as_str()).cmp(&(preset_rank(b.preset), b.id.as_str()))
    });
    providers
}

fn build_provider(
    id: &str,
    raw_entry: &Value,
    raw_harness: Option<&Map<String, Value>>,
    effective: Option<&HarnessProviderConfig>,
    active: Option<&str>,
    diagnostics: &[ConfigDiagnostic],
) -> ProviderSettings {
    let raw = raw_entry.as_object();
    let raw_preset = raw
        .and_then(|object| object.get("preset"))
        .map(|value| match value {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        })
        .unwrap_or_default();
    let preset = effective
        .map(|entry| entry.preset)
        .or_else(|| ProviderPreset::parse(raw_preset.trim()));

    let raw_api_key = raw_text(raw, "api_key").unwrap_or_default();
    let api_key_text = effective
        .map(|entry| entry.api_key.clone())
        .unwrap_or(raw_api_key)
        .trim()
        .to_string();
    let api_key = if api_key_text.is_empty() {
        ApiKeyState::Unset
    } else {
        ApiKeyState::Set {
            hint: api_key_hint(&api_key_text),
        }
    };

    let models = model_drafts(id, raw, diagnostics);
    let model = effective
        .map(|entry| entry.model.clone())
        .or_else(|| raw_text(raw, "model"))
        .unwrap_or_default();
    let base_url = match raw.and_then(|object| object.get("base_url")) {
        None | Some(Value::Null) => FieldState::Absent,
        Some(Value::String(text)) => FieldState::Present(text.clone()),
        // 非字符串条目已在装载期整条忽略，raw 面不再伪装成字符串。
        Some(_) => FieldState::Absent,
    };
    let wire_api = match raw.and_then(|object| object.get("wire_api")) {
        None => FieldState::Absent,
        Some(value) => FieldState::Present(raw_json_value(value)),
    };

    let effective_wire_api = effective
        .map(|entry| entry.wire_api)
        .or_else(|| preset.map(ProviderPreset::default_wire_api))
        .unwrap_or_default();
    let status = provider_status(effective);
    let configured = effective.is_some_and(|entry| entry.configured);
    let active = active == Some(id);

    ProviderSettings {
        id: id.to_string(),
        preset,
        raw_preset,
        configured,
        status,
        api_key,
        models,
        model,
        base_url,
        wire_api,
        effective: ProviderEffective {
            official_base_url: preset
                .and_then(ProviderPreset::official_base_url)
                .map(str::to_string),
            base_url: effective.and_then(|entry| entry.base_url.clone()),
            wire_api: effective_wire_api,
            models: effective
                .map(|entry| entry.models.clone())
                .unwrap_or_default(),
        },
        references: ProviderReferences {
            active,
            session_naming: raw_naming_provider_from(raw_harness, "session_naming").as_deref()
                == Some(id),
            attachment_naming: raw_naming_provider_from(raw_harness, "attachment_naming")
                .as_deref()
                == Some(id),
        },
        unknown_keys: raw.map(unknown_provider_keys).unwrap_or_default(),
    }
}

fn raw_naming_provider_from(raw: Option<&Map<String, Value>>, table: &str) -> Option<String> {
    raw_trimmed(
        raw.and_then(|object| object.get(table))
            .and_then(Value::as_object),
        "provider",
    )
}

/// Key 只回末 4 位（design §5 / Q3）：短于 5 个字符时连末 4 位都不给（否则等于回传整个 Key）。
fn api_key_hint(api_key: &str) -> Option<String> {
    let chars: Vec<char> = api_key.chars().collect();
    (chars.len() > 4).then(|| chars[chars.len() - 4..].iter().collect())
}

fn provider_status(effective: Option<&HarnessProviderConfig>) -> ProviderStatus {
    let Some(entry) = effective else {
        return ProviderStatus::Invalid;
    };
    if entry.preset.requires_api_key() && entry.api_key.trim().is_empty() {
        return ProviderStatus::MissingApiKey;
    }
    if entry.preset == ProviderPreset::Generic
        && entry
            .base_url
            .as_deref()
            .is_none_or(|url| url.trim().is_empty())
    {
        return ProviderStatus::MissingBaseUrl;
    }
    if entry.models.is_empty() {
        return ProviderStatus::MissingModels;
    }
    ProviderStatus::Ok
}

const KNOWN_PROVIDER_KEYS: [&str; 7] = [
    "preset", "api_key", "model", "models", "base_url", "wire_api", "fixture",
];

fn unknown_provider_keys(raw: &Map<String, Value>) -> Vec<String> {
    let mut keys: Vec<String> = raw
        .keys()
        .filter(|key| !KNOWN_PROVIDER_KEYS.contains(&key.as_str()))
        .cloned()
        .collect();
    keys.sort();
    keys
}

/// 模型行的「会被丢弃」诊断码（与 [`config`] 的 `validate_harness_model_specs` 的 `continue`
/// 分支一一对应）。只用于编辑面的展示分类，判定本身仍在校验里。
const MODEL_DROP_CODES: [&str; 6] = [
    "harness_model_invalid",
    "harness_model_id_empty",
    "harness_model_id_duplicate",
    "harness_model_effort_invalid",
    "harness_model_vision_invalid",
    "harness_model_window_invalid",
];

fn model_drafts(
    id: &str,
    raw: Option<&Map<String, Value>>,
    diagnostics: &[ConfigDiagnostic],
) -> Vec<ModelDraft> {
    let Some(items) = raw
        .and_then(|object| object.get("models"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    let prefix = format!("harness.providers.{id}.models[");
    items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let map = item.as_object();
            let item_prefix = format!("{prefix}{index}]");
            let mut problems = Vec::new();
            let mut valid = true;
            for diagnostic in diagnostics {
                let Some(path) = diagnostic.path.as_deref() else {
                    continue;
                };
                if path == item_prefix || path_is_under(path, &item_prefix) {
                    problems.push(diagnostic.message.clone());
                    if MODEL_DROP_CODES.contains(&diagnostic.code.as_str()) {
                        valid = false;
                    }
                }
            }
            ModelDraft {
                id: map
                    .and_then(|object| object.get("id"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                effort: map
                    .and_then(|object| object.get("effort"))
                    .and_then(Value::as_bool),
                vision: map
                    .and_then(|object| object.get("vision"))
                    .and_then(Value::as_bool),
                window: map
                    .and_then(|object| object.get("window"))
                    .and_then(Value::as_u64),
                valid,
                diagnostics: problems,
                unknown_keys: map
                    .map(|object| {
                        let mut keys: Vec<String> = object
                            .keys()
                            .filter(|key| {
                                !matches!(key.as_str(), "id" | "effort" | "vision" | "window")
                            })
                            .cloned()
                            .collect();
                        keys.sort();
                        keys
                    })
                    .unwrap_or_default(),
            }
        })
        .collect()
}

fn raw_json_value(value: &Value) -> RawJsonValue {
    let kind = match value {
        Value::Null => RawJsonKind::Null,
        Value::Bool(_) => RawJsonKind::Bool,
        Value::Number(_) => RawJsonKind::Number,
        Value::String(_) => RawJsonKind::String,
        Value::Array(_) => RawJsonKind::Array,
        Value::Object(_) => RawJsonKind::Object,
    };
    let text = match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    };
    RawJsonValue {
        kind,
        text: text.chars().take(200).collect(),
    }
}

fn build_automation(
    raw: Option<&Map<String, Value>>,
    harness: Option<&HarnessConfig>,
) -> AutomationSettings {
    let defaults = HarnessConfig::default();
    let harness = harness.unwrap_or(&defaults);
    AutomationSettings {
        auto_compact: automation_flag(
            raw.and_then(|object| object.get("auto_compact")),
            harness.auto_compact,
        ),
        session_naming: automation_flag(
            raw_naming_enabled(raw, "session_naming"),
            harness.session_naming.enabled,
        ),
        attachment_naming: automation_flag(
            raw_naming_enabled(raw, "attachment_naming"),
            harness.attachment_naming.enabled,
        ),
        subagents: automation_flag(
            raw.and_then(|object| object.get("subagents"))
                .and_then(Value::as_object)
                .and_then(|table| table.get("enabled")),
            harness.subagents.enabled,
        ),
    }
}

fn raw_naming_enabled<'a>(raw: Option<&'a Map<String, Value>>, table: &str) -> Option<&'a Value> {
    raw.and_then(|object| object.get(table))
        .and_then(Value::as_object)
        .and_then(|object| object.get("enabled"))
}

fn automation_flag(raw: Option<&Value>, effective: bool) -> AutomationFlag {
    AutomationFlag {
        value: raw.and_then(Value::as_bool).unwrap_or(effective),
        explicit: raw.is_some(),
    }
}

fn build_naming_target(
    kind: NamingKind,
    raw: Option<&Map<String, Value>>,
    harness: Option<&HarnessConfig>,
    active: Option<&str>,
) -> NamingTargetState {
    let table = raw
        .and_then(|object| object.get(kind.table()))
        .and_then(Value::as_object);
    let override_provider = raw_trimmed(table, "provider");
    let override_model = raw_trimmed(table, "model");

    let provider_options: Vec<NamingProviderOption> = match harness {
        Some(config) => canonical_provider_ids(&config.providers, false)
            .into_iter()
            .filter_map(|id| config.providers.get(&id).map(|entry| (id, entry)))
            .map(|(id, entry)| NamingProviderOption {
                is_active: active == Some(id.as_str()),
                configured: entry.configured,
                id,
            })
            .collect(),
        None => Vec::new(),
    };

    // 解析：覆盖是有效条目 id 就用它；否则（缺省 / 悬空）用当前 active。
    let target = override_provider
        .as_deref()
        .filter(|id| harness.is_some_and(|config| config.providers.contains_key(*id)))
        .map(str::to_string)
        .or_else(|| active.map(str::to_string));
    let dangling = override_provider.is_some() && target.as_deref() != override_provider.as_deref();
    let entry = target
        .as_deref()
        .and_then(|id| harness.and_then(|config| config.providers.get(id)));
    let target_is_mock = entry.is_some_and(|entry| entry.preset == ProviderPreset::Mock);
    let fallback_model = entry.map(|entry| entry.model.clone()).unwrap_or_default();
    // 会话命名：覆盖不在目标清单时由装载期回落生效模型（`session_naming.model` 已是回落后的
    // 值）；图片命名：覆盖值原样保留、由 vision 资格决定是否跳过（design §2.6 / §10.2）。
    let model = match kind {
        NamingKind::Session => harness
            .and_then(|config| config.session_naming.model.clone())
            .unwrap_or(fallback_model),
        NamingKind::Attachment => override_model.clone().unwrap_or(fallback_model),
    };
    let model_options: Vec<NamingModelOption> = entry
        .map(|entry| {
            entry
                .models
                .iter()
                .map(|spec| NamingModelOption {
                    id: spec.id.clone(),
                    vision: spec.vision,
                    is_effective: spec.id == entry.model,
                })
                .collect()
        })
        .unwrap_or_default();

    let eligible = if target.is_none() {
        false
    } else if target_is_mock {
        override_model.is_none()
    } else if model.trim().is_empty() {
        false
    } else if kind == NamingKind::Attachment {
        harness.is_some_and(|config| {
            config.vision_supported(target.as_deref().unwrap_or_default(), &model)
        })
    } else {
        true
    };
    let reason = if eligible {
        None
    } else if target.is_none() {
        Some("no_target_provider".to_string())
    } else if target_is_mock {
        Some("mock_model_override".to_string())
    } else if model.trim().is_empty() {
        Some("no_model".to_string())
    } else {
        Some("no_vision".to_string())
    };

    NamingTargetState {
        override_provider,
        override_model,
        provider_options,
        model_options,
        resolved: ResolvedNamingTarget {
            provider: target,
            model,
            follows_active: table
                .is_none_or(|table| raw_trimmed(Some(table), "provider").is_none()),
            dangling,
            eligible,
            reason,
        },
    }
}

fn preset_rank(preset: Option<ProviderPreset>) -> u8 {
    match preset {
        Some(ProviderPreset::Kimi) => 0,
        Some(ProviderPreset::Deepseek) => 1,
        Some(ProviderPreset::Generic) => 2,
        Some(ProviderPreset::Mock) => 3,
        None => 4,
    }
}

fn canonical_provider_ids(
    providers: &BTreeMap<String, HarnessProviderConfig>,
    include_mock: bool,
) -> Vec<String> {
    let mut ids: Vec<&String> = providers
        .iter()
        .filter(|(_, entry)| include_mock || entry.preset != ProviderPreset::Mock)
        .map(|(id, _)| id)
        .collect();
    ids.sort_by(|a, b| {
        let left = (
            preset_rank(providers.get(*a).map(|entry| entry.preset)),
            a.as_str(),
        );
        let right = (
            preset_rank(providers.get(*b).map(|entry| entry.preset)),
            b.as_str(),
        );
        left.cmp(&right)
    });
    ids.into_iter().cloned().collect()
}

fn capabilities() -> SettingsCapabilities {
    let presets = [
        ProviderPreset::Kimi,
        ProviderPreset::Deepseek,
        ProviderPreset::Generic,
        ProviderPreset::Mock,
    ]
    .into_iter()
    .map(|preset| PresetCapability {
        preset,
        official_base_url: preset.official_base_url().map(str::to_string),
        supported_wire_apis: [WireApi::Responses, WireApi::ChatCompletions]
            .into_iter()
            .filter(|wire| preset.supports_wire_api(*wire))
            .collect(),
        default_wire_api: preset.default_wire_api(),
        requires_api_key: preset.requires_api_key(),
    })
    .collect();
    SettingsCapabilities {
        presets,
        provider_id_pattern: config::provider_id_pattern(),
        reserved_provider_ids: vec![RESERVED_PROVIDER_ID.to_string()],
        provider_order: vec![
            ProviderPreset::Kimi,
            ProviderPreset::Deepseek,
            ProviderPreset::Generic,
            ProviderPreset::Mock,
        ],
        model_window_min: MODEL_WINDOW_MIN,
        model_window_max: MODEL_WINDOW_MAX,
    }
}

fn settings_defaults() -> SettingsDefaults {
    let harness = HarnessConfig::default();
    SettingsDefaults {
        auto_compact: harness.auto_compact,
        session_naming_enabled: harness.session_naming.enabled,
        attachment_naming_enabled: harness.attachment_naming.enabled,
        subagents_enabled: harness.subagents.enabled,
        model_window: FALLBACK_CONTEXT_WINDOW,
    }
}

// ---------------------------------------------------------------------------
// revision
// ---------------------------------------------------------------------------

/// provider 条目进入 revision 的键（design §6.2）：**不含** `providers.<id>.model`——它由
/// composer 的模型 chip 写回，纳进来会让「面板打开时切一次模型」变成无意义的冲突。
const PROVIDER_REVISION_KEYS: [&str; 6] = [
    "preset", "api_key", "models", "base_url", "wire_api", "fixture",
];

/// 设置面 revision（design §6.2）：sha256 over 规范化后的设置面键集合。覆盖 provider 条目、
/// active、四个开关、两个命名目标的 provider **与** model（面板可编辑、删除也会清它们）；
/// `Missing` 按空对象算、`Invalid` 不给 revision（调用方不计算）。
fn revision_of(value: &Value) -> String {
    let harness = raw_harness(value);
    let mut canonical = Map::new();
    canonical.insert(
        "provider".to_string(),
        harness
            .and_then(|object| object.get("provider"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    let mut providers = Map::new();
    if let Some(entries) = harness
        .and_then(|object| object.get("providers"))
        .and_then(Value::as_object)
    {
        for (id, entry) in entries {
            let mut normalized = Map::new();
            for key in PROVIDER_REVISION_KEYS {
                normalized.insert(
                    key.to_string(),
                    entry.get(key).cloned().unwrap_or(Value::Null),
                );
            }
            if let Some(object) = entry.as_object() {
                for (key, field) in object {
                    if key == "model" || PROVIDER_REVISION_KEYS.contains(&key.as_str()) {
                        continue;
                    }
                    normalized.insert(key.clone(), field.clone());
                }
            }
            providers.insert(id.clone(), Value::Object(normalized));
        }
    }
    canonical.insert("providers".to_string(), Value::Object(providers));
    canonical.insert(
        "auto_compact".to_string(),
        harness
            .and_then(|object| object.get("auto_compact"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    for table in ["session_naming", "attachment_naming"] {
        canonical.insert(table.to_string(), revision_naming_section(harness, table));
    }
    canonical.insert("subagents".to_string(), revision_subagents_section(harness));
    let serialized =
        serde_json::to_string(&Value::Object(canonical)).expect("规范化 patch 一定可序列化");
    format!("{:x}", Sha256::digest(serialized.as_bytes()))
}

fn revision_naming_section(harness: Option<&Map<String, Value>>, table: &str) -> Value {
    let raw = harness
        .and_then(|object| object.get(table))
        .and_then(Value::as_object);
    let mut section = Map::new();
    for key in ["enabled", "provider", "model"] {
        section.insert(
            key.to_string(),
            raw.and_then(|object| object.get(key))
                .cloned()
                .unwrap_or(Value::Null),
        );
    }
    Value::Object(section)
}

fn revision_subagents_section(harness: Option<&Map<String, Value>>) -> Value {
    let raw = harness
        .and_then(|object| object.get("subagents"))
        .and_then(Value::as_object);
    let mut section = Map::new();
    section.insert(
        "enabled".to_string(),
        raw.and_then(|object| object.get("enabled"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    Value::Object(section)
}

// ---------------------------------------------------------------------------
// 路径工具
// ---------------------------------------------------------------------------

/// 点分路径 → 段（`harness.providers.kimi.models[2].window` →
/// `["harness","providers","kimi","models","2","window"]`）：数组下标也是段，`models` 因此是
/// `models[2]` 的祖先（design §6.3 的相交判据）。
fn path_tokens(path: &str) -> Vec<&str> {
    path.split(['.', '[', ']'])
        .filter(|part| !part.is_empty())
        .collect()
}

fn paths_intersect(left: &str, right: &str) -> bool {
    let left = path_tokens(left);
    let right = path_tokens(right);
    let shared = left.len().min(right.len());
    left[..shared] == right[..shared]
}

fn path_is_under(path: &str, prefix: &str) -> bool {
    let path = path_tokens(path);
    let prefix = path_tokens(prefix);
    prefix.len() <= path.len() && path[..prefix.len()] == prefix[..]
}

fn under(path: &str, prefix: &str) -> bool {
    path_is_under(path, prefix)
}

fn field_error(
    path: impl Into<String>,
    code: impl Into<String>,
    message: impl Into<String>,
) -> SettingsFieldError {
    SettingsFieldError {
        path: path.into(),
        code: code.into(),
        message: message.into(),
    }
}

// ---------------------------------------------------------------------------
// patch 严格解析
// ---------------------------------------------------------------------------

/// 按白名单检查 patch 的每个对象（内部标签枚举的变体不执行 `deny_unknown_fields`，这一层
/// 才是真正生效的那道）。返回第一条到全部错误——前端按 `path` 逐条回填。
fn parse_patch(value: Value) -> Result<SettingsPatch, Vec<SettingsFieldError>> {
    let Some(object) = value.as_object() else {
        return Err(vec![field_error(
            "",
            "settings_patch_invalid",
            "patch 必须是 JSON 对象",
        )]);
    };
    let mut errors = Vec::new();
    unknown_keys(
        object,
        &[
            "base_revision",
            "active_provider",
            "providers",
            "automation",
            "naming",
        ],
        "",
        &mut errors,
    );
    if let Some(active) = object.get("active_provider") {
        check_field_edit(active, "active_provider", EditShape::Text, &mut errors);
    }
    match object.get("providers") {
        Some(Value::Array(items)) => {
            for (index, item) in items.iter().enumerate() {
                check_provider_edit(item, index, &mut errors);
            }
        }
        Some(_) => errors.push(field_error(
            "providers",
            "settings_patch_invalid",
            "providers 必须是数组",
        )),
        None => {}
    }
    if let Some(automation) = object.get("automation") {
        check_automation(automation, &mut errors);
    }
    if let Some(naming) = object.get("naming") {
        check_naming(naming, &mut errors);
    }
    if !errors.is_empty() {
        return Err(errors);
    }
    serde_json::from_value(value).map_err(|error| {
        vec![field_error(
            "",
            "settings_patch_invalid",
            format!("patch 形状非法：{error}"),
        )]
    })
}

fn unknown_keys(
    object: &Map<String, Value>,
    allowed: &[&str],
    path: &str,
    errors: &mut Vec<SettingsFieldError>,
) {
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) {
            let at = join_path(path, key);
            errors.push(field_error(
                at.clone(),
                "settings_unknown_field",
                format!("patch 里出现设置通道未定义的字段 {at}"),
            ));
        }
    }
}

fn join_path(path: &str, key: &str) -> String {
    if path.is_empty() {
        key.to_string()
    } else {
        format!("{path}.{key}")
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum EditShape {
    Text,
    Bool,
}

fn check_field_edit(
    value: &Value,
    path: &str,
    shape: EditShape,
    errors: &mut Vec<SettingsFieldError>,
) {
    let Some(object) = value.as_object() else {
        errors.push(field_error(
            path,
            "settings_patch_invalid",
            format!("{path} 必须是 {{kind, value}} 对象"),
        ));
        return;
    };
    match object.get("kind").and_then(Value::as_str) {
        Some("set") => {
            unknown_keys(object, &["kind", "value"], path, errors);
            match object.get("value") {
                None => errors.push(field_error(
                    path,
                    "settings_patch_invalid",
                    format!("{path} 的 set 缺少 value"),
                )),
                Some(Value::String(_)) if shape == EditShape::Text => {}
                Some(Value::Bool(_)) if shape == EditShape::Bool => {}
                Some(_) => errors.push(field_error(
                    path,
                    "settings_patch_invalid",
                    format!("{path}.value 类型不符"),
                )),
            }
        }
        Some("reset") => unknown_keys(object, &["kind"], path, errors),
        Some(other) => errors.push(field_error(
            path,
            "settings_patch_invalid",
            format!("{path}.kind 取值 \"{other}\" 非法（可选：set、reset）"),
        )),
        None => errors.push(field_error(
            path,
            "settings_patch_invalid",
            format!("{path} 缺少 kind"),
        )),
    }
}

fn check_provider_edit(item: &Value, index: usize, errors: &mut Vec<SettingsFieldError>) {
    let path = format!("providers[{index}]");
    let Some(object) = item.as_object() else {
        errors.push(field_error(
            path,
            "settings_patch_invalid",
            "provider 编辑项必须是对象",
        ));
        return;
    };
    match object.get("action").and_then(Value::as_str) {
        Some("add") => unknown_keys(object, &["action", "id", "preset"], &path, errors),
        Some("update") => {
            // `preset` 走专门的分支：它是「创建后不可改」的语义错误，不是拼写错误。
            unknown_keys(
                object,
                &[
                    "action", "id", "api_key", "models", "base_url", "wire_api", "preset",
                ],
                &path,
                errors,
            );
            if object.contains_key("preset") {
                errors.push(field_error(
                    format!("{path}.preset"),
                    "settings_provider_preset_immutable",
                    "预设创建后不可修改；换协议请新增一个 provider 再删除旧的",
                ));
            }
            if let Some(api_key) = object.get("api_key") {
                check_api_key_edit(api_key, &format!("{path}.api_key"), errors);
            }
            if let Some(models) = object.get("models") {
                check_models(models, &format!("{path}.models"), errors);
            }
            if let Some(base_url) = object.get("base_url") {
                check_field_edit(
                    base_url,
                    &format!("{path}.base_url"),
                    EditShape::Text,
                    errors,
                );
            }
            if let Some(wire_api) = object.get("wire_api") {
                check_field_edit(
                    wire_api,
                    &format!("{path}.wire_api"),
                    EditShape::Text,
                    errors,
                );
            }
        }
        Some("delete") => {
            unknown_keys(
                object,
                &[
                    "action",
                    "id",
                    "active_after",
                    "session_naming_after",
                    "attachment_naming_after",
                ],
                &path,
                errors,
            );
            for key in ["session_naming_after", "attachment_naming_after"] {
                if let Some(retarget) = object.get(key) {
                    check_retarget(retarget, &format!("{path}.{key}"), errors);
                }
            }
        }
        Some(other) => errors.push(field_error(
            format!("{path}.action"),
            "settings_patch_invalid",
            format!("未知的 provider 编辑动作 \"{other}\"（可选：add、update、delete）"),
        )),
        None => errors.push(field_error(
            format!("{path}.action"),
            "settings_patch_invalid",
            "provider 编辑项缺少 action",
        )),
    }
}

fn check_api_key_edit(value: &Value, path: &str, errors: &mut Vec<SettingsFieldError>) {
    let Some(object) = value.as_object() else {
        errors.push(field_error(
            path,
            "settings_patch_invalid",
            format!("{path} 必须是 {{kind, value}} 对象"),
        ));
        return;
    };
    match object.get("kind").and_then(Value::as_str) {
        Some("replace") => {
            unknown_keys(object, &["kind", "value"], path, errors);
            if !object.get("value").is_some_and(Value::is_string) {
                errors.push(field_error(
                    path,
                    "settings_patch_invalid",
                    format!("{path}.value 必须是字符串"),
                ));
            }
        }
        Some("clear") => unknown_keys(object, &["kind"], path, errors),
        Some(other) => errors.push(field_error(
            path,
            "settings_patch_invalid",
            format!("{path}.kind 取值 \"{other}\" 非法（可选：replace、clear）"),
        )),
        None => errors.push(field_error(
            path,
            "settings_patch_invalid",
            format!("{path} 缺少 kind"),
        )),
    }
}

fn check_retarget(value: &Value, path: &str, errors: &mut Vec<SettingsFieldError>) {
    let Some(object) = value.as_object() else {
        errors.push(field_error(
            path,
            "settings_patch_invalid",
            format!("{path} 必须是 {{kind, value}} 对象"),
        ));
        return;
    };
    match object.get("kind").and_then(Value::as_str) {
        Some("follow_active") => unknown_keys(object, &["kind"], path, errors),
        Some("provider") => {
            unknown_keys(object, &["kind", "value"], path, errors);
            if !object.get("value").is_some_and(Value::is_string) {
                errors.push(field_error(
                    path,
                    "settings_patch_invalid",
                    format!("{path}.value 必须是字符串"),
                ));
            }
        }
        Some(other) => errors.push(field_error(
            path,
            "settings_patch_invalid",
            format!("{path}.kind 取值 \"{other}\" 非法（可选：follow_active、provider）"),
        )),
        None => errors.push(field_error(
            path,
            "settings_patch_invalid",
            format!("{path} 缺少 kind"),
        )),
    }
}

fn check_models(value: &Value, path: &str, errors: &mut Vec<SettingsFieldError>) {
    let Some(items) = value.as_array() else {
        errors.push(field_error(
            path,
            "settings_patch_invalid",
            format!("{path} 必须是数组"),
        ));
        return;
    };
    for (index, item) in items.iter().enumerate() {
        let item_path = format!("{path}[{index}]");
        let Some(object) = item.as_object() else {
            errors.push(field_error(
                item_path,
                "settings_patch_invalid",
                "模型项必须是对象",
            ));
            continue;
        };
        unknown_keys(
            object,
            &["id", "effort", "vision", "window"],
            &item_path,
            errors,
        );
    }
}

fn check_automation(value: &Value, errors: &mut Vec<SettingsFieldError>) {
    let Some(object) = value.as_object() else {
        errors.push(field_error(
            "automation",
            "settings_patch_invalid",
            "automation 必须是对象",
        ));
        return;
    };
    unknown_keys(
        object,
        &[
            "auto_compact",
            "session_naming",
            "attachment_naming",
            "subagents",
        ],
        "automation",
        errors,
    );
    for key in [
        "auto_compact",
        "session_naming",
        "attachment_naming",
        "subagents",
    ] {
        if let Some(edit) = object.get(key) {
            check_field_edit(edit, &format!("automation.{key}"), EditShape::Bool, errors);
        }
    }
}

fn check_naming(value: &Value, errors: &mut Vec<SettingsFieldError>) {
    let Some(object) = value.as_object() else {
        errors.push(field_error(
            "naming",
            "settings_patch_invalid",
            "naming 必须是对象",
        ));
        return;
    };
    unknown_keys(object, &["session", "attachment"], "naming", errors);
    for group in ["session", "attachment"] {
        let Some(edit) = object.get(group) else {
            continue;
        };
        let group_path = format!("naming.{group}");
        let Some(edit) = edit.as_object() else {
            errors.push(field_error(
                group_path,
                "settings_patch_invalid",
                "命名目标编辑必须是对象",
            ));
            continue;
        };
        unknown_keys(edit, &["provider", "model"], &group_path, errors);
        if let Some(provider) = edit.get("provider") {
            check_field_edit(
                provider,
                &format!("{group_path}.provider"),
                EditShape::Text,
                errors,
            );
        }
        if let Some(model) = edit.get("model") {
            check_field_edit(
                model,
                &format!("{group_path}.model"),
                EditShape::Text,
                errors,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// 写：apply
// ---------------------------------------------------------------------------

/// 保存一笔 patch（design §6 / §6.1）。返回值里 `Err` 只用于真正的命令级失败（写盘失败等）；
/// Blocked / Conflict / FileInvalid 都是 `Ok(outcome)`，并附最新快照。
///
/// **不写是闭包的返回值**（`Ok(None)`）：Blocked / Conflict 靠「不返回候选值」保证文件逐字节
/// 不变，而不是靠抛一个内部错误来中止写（[`config::update_json_atomic_strict`] 的契约）。
pub fn apply_at(path: &Path, raw_patch: Value) -> Result<SettingsApplyOutcome, CommandError> {
    let patch = match parse_patch(raw_patch) {
        Ok(patch) => patch,
        Err(errors) => return Ok(outcome_at(path, SettingsApplyStatus::Blocked, errors)),
    };

    let mut stop: Option<ApplyStop> = None;
    let result =
        config::update_json_atomic_strict(path, |value| match plan_and_apply(value, &patch) {
            Ok(()) => Ok(Some(std::mem::take(value))),
            Err(reason) => {
                stop = Some(reason);
                Ok(None)
            }
        });

    match result {
        Ok(Some(_)) => Ok(outcome_at(path, SettingsApplyStatus::Applied, Vec::new())),
        Ok(None) => match stop {
            Some(ApplyStop::Blocked(errors)) => {
                Ok(outcome_at(path, SettingsApplyStatus::Blocked, errors))
            }
            Some(ApplyStop::Conflict) => Ok(outcome_at(
                path,
                SettingsApplyStatus::Conflict,
                vec![field_error(
                    "base_revision",
                    "settings_revision_conflict",
                    "配置文件已在外部修改：请重新载入后再保存，或以本页为准重新应用",
                )],
            )),
            Some(ApplyStop::FileInvalid(message)) => Ok(outcome_at(
                path,
                SettingsApplyStatus::FileInvalid,
                vec![field_error("", "config_parse_failed", message)],
            )),
            None => unreachable!("闭包返回 None 时必然写入了停机原因"),
        },
        Err(error) if error.code == "config_parse_failed" => Ok(outcome_at(
            path,
            SettingsApplyStatus::FileInvalid,
            vec![field_error("", error.code.clone(), error.message.clone())],
        )),
        // 写通道自身失败（建目录 / 写 tmp / rename）：原样上抛，没有可回填的字段。
        Err(error) => Err(error),
    }
}

fn outcome_at(
    path: &Path,
    status: SettingsApplyStatus,
    errors: Vec<SettingsFieldError>,
) -> SettingsApplyOutcome {
    let snapshot = snapshot_at(path);
    SettingsApplyOutcome {
        status,
        warnings: snapshot.diagnostics.clone(),
        snapshot,
        errors,
    }
}

fn plan_and_apply(value: &mut Value, patch: &SettingsPatch) -> Result<(), ApplyStop> {
    // 1–3. 严格读已在锁内完成；这里按装载同一路径解析（结构不符 = 整文件回落 → FileInvalid）。
    config::validate_value(value).map_err(ApplyStop::FileInvalid)?;
    // 4–5. 锁内比对 revision（读、比、写同一把锁，没有 check-then-write 窗口）。
    if revision_of(value) != patch.base_revision {
        return Err(ApplyStop::Conflict);
    }

    let mut candidate = value.clone();
    let mut changes = AppliedChanges::default();
    apply_provider_edits(&mut candidate, patch, &mut changes)?;
    apply_active_provider(&mut candidate, patch, &mut changes)?;
    apply_automation(&mut candidate, patch, &mut changes)?;
    apply_naming(&mut candidate, patch, &mut changes)?;

    // 7–9. 严格复解析 + 非回归判据（candidate × changed paths；不看 baseline 是否已有同一条）。
    let (effective, diagnostics) = config::validate_value(&candidate).map_err(|message| {
        ApplyStop::Blocked(vec![field_error(
            "",
            "settings_patch_invalid",
            format!("保存后的配置无法解析：{message}"),
        )])
    })?;
    let violations: Vec<SettingsFieldError> = diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.severity == DiagnosticSeverity::RejectOnWrite)
        .filter(|diagnostic| changes.intersects(diagnostic))
        .map(|diagnostic| {
            field_error(
                diagnostic.path.clone().unwrap_or_default(),
                diagnostic.code.clone(),
                diagnostic.message.clone(),
            )
        })
        .collect();
    if !violations.is_empty() {
        return Err(ApplyStop::Blocked(violations));
    }

    // 10. 引用完整性复核（只查本笔触碰的引用面：未改路径上的悬空是手改文件的兜底）。
    check_references(&candidate, &effective, &changes)?;

    // 11. 写回候选值；锁与原子写在 update_json_atomic_strict 里。
    *value = candidate;
    Ok(())
}

fn harness_object_mut(value: &mut Value) -> &mut Map<String, Value> {
    if !value.get("harness").is_some_and(Value::is_object) {
        value["harness"] = Value::Object(Map::new());
    }
    value["harness"]
        .as_object_mut()
        .expect("上面刚填过 harness 对象")
}

/// 已存在的表（只用于 `Reset` 删键）：表缺席时不创建空对象——「恢复默认」的语义是
/// 「保持没有这个键」，不是往文件里塞一句 `{}`。
fn existing_table_mut<'a>(
    value: &'a mut Value,
    table: Option<&str>,
) -> Option<&'a mut Map<String, Value>> {
    let harness = value.get_mut("harness").and_then(Value::as_object_mut)?;
    match table {
        None => Some(harness),
        Some(table) => harness.get_mut(table).and_then(Value::as_object_mut),
    }
}

fn providers_mut(value: &mut Value) -> Result<&mut Map<String, Value>, ApplyStop> {
    let harness = harness_object_mut(value);
    if !harness.get("providers").is_some_and(Value::is_object) {
        harness.insert("providers".to_string(), Value::Object(Map::new()));
    }
    harness
        .get_mut("providers")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            ApplyStop::Blocked(vec![field_error(
                "harness.providers",
                "settings_patch_invalid",
                "harness.providers 不是对象，无法应用 provider 编辑",
            )])
        })
}

fn effective_harness(value: &Value) -> Result<HarnessConfig, ApplyStop> {
    config::validate_value(value)
        .map(|(config, _)| config.harness)
        .map_err(|message| {
            ApplyStop::Blocked(vec![field_error(
                "",
                "settings_patch_invalid",
                format!("配置无法解析：{message}"),
            )])
        })
}

fn apply_provider_edits(
    value: &mut Value,
    patch: &SettingsPatch,
    changes: &mut AppliedChanges,
) -> Result<(), ApplyStop> {
    let deleted_ids: Vec<&str> = patch
        .providers
        .iter()
        .filter_map(|edit| match edit {
            ProviderEdit::Delete { id, .. } => Some(id.as_str()),
            _ => None,
        })
        .collect();

    // 6.1 Add（先于 Update / Delete）：id 规则、保留 id、已存在（**含本笔要删的条目**）。
    for (index, edit) in patch.providers.iter().enumerate() {
        let ProviderEdit::Add { id, preset } = edit else {
            continue;
        };
        if !provider_id_valid(id) {
            return Err(ApplyStop::Blocked(vec![field_error(
                format!("providers[{index}].id"),
                "settings_provider_id_invalid",
                format!(
                    "provider id \"{id}\" 非法：只能用小写字母 / 数字 / - / _，首字符必须是字母或数字，至多 32 字符、不含点"
                ),
            )]));
        }
        if id == RESERVED_PROVIDER_ID {
            return Err(ApplyStop::Blocked(vec![field_error(
                format!("providers[{index}].id"),
                "settings_provider_reserved_id",
                format!("{RESERVED_PROVIDER_ID} 是验收专用的保留 id，不能新增"),
            )]));
        }
        let exists = providers_mut(value)?.contains_key(id);
        if exists || deleted_ids.contains(&id.as_str()) {
            return Err(ApplyStop::Blocked(vec![field_error(
                format!("providers[{index}].id"),
                "settings_provider_id_duplicate",
                format!(
                    "provider id \"{id}\" 已存在（或被本笔删除）：新增 MUST NOT 复用同一笔里删掉的 id，请拆成两次保存"
                ),
            )]));
        }
        let mut entry = Map::new();
        entry.insert(
            "preset".to_string(),
            Value::String(preset.as_str().to_string()),
        );
        providers_mut(value)?.insert(id.clone(), Value::Object(entry));
        changes.entry(format!("harness.providers.{id}"));
    }

    // 6.2 Update：id 必须仍是**有效条目**（装载期被忽略的条目不可经设置面编辑）。
    for edit in &patch.providers {
        let ProviderEdit::Update {
            id,
            api_key,
            models,
            base_url,
            wire_api,
        } = edit
        else {
            continue;
        };
        let effective = effective_harness(value)?;
        if !effective.providers.contains_key(id) {
            return Err(ApplyStop::Blocked(vec![field_error(
                format!("harness.providers.{id}"),
                "settings_provider_not_found",
                format!("provider \"{id}\" 不存在或已被装载期忽略，无法编辑"),
            )]));
        }
        let entry = providers_mut(value)?
            .get_mut(id)
            .and_then(Value::as_object_mut)
            .ok_or_else(|| {
                ApplyStop::Blocked(vec![field_error(
                    format!("harness.providers.{id}"),
                    "settings_provider_not_found",
                    format!("provider \"{id}\" 不是对象，无法编辑"),
                )])
            })?;
        let mut touched = false;
        if let Some(edit) = api_key {
            match edit {
                ApiKeyEdit::Replace(api_key) => {
                    entry.insert("api_key".to_string(), Value::String(api_key.clone()));
                }
                ApiKeyEdit::Clear => {
                    entry.remove("api_key");
                }
            }
            changes.field(format!("harness.providers.{id}.api_key"));
            touched = true;
        }
        if let Some(models) = models {
            let current = entry
                .get("models")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            entry.insert(
                "models".to_string(),
                Value::Array(merge_model_inputs(models, &current)),
            );
            changes.field(format!("harness.providers.{id}.models"));
            touched = true;
        }
        if let Some(edit) = base_url {
            match edit {
                FieldEdit::Set(base_url) => {
                    entry.insert("base_url".to_string(), Value::String(base_url.clone()));
                }
                FieldEdit::Reset => {
                    entry.remove("base_url");
                }
            }
            changes.field(format!("harness.providers.{id}.base_url"));
            touched = true;
        }
        if let Some(edit) = wire_api {
            match edit {
                FieldEdit::Set(wire_api) => {
                    entry.insert(
                        "wire_api".to_string(),
                        Value::String(wire_api.as_str().to_string()),
                    );
                }
                FieldEdit::Reset => {
                    entry.remove("wire_api");
                }
            }
            changes.field(format!("harness.providers.{id}.wire_api"));
            touched = true;
        }
        if touched {
            changes.note_entry(format!("harness.providers.{id}"));
        }
    }

    // 6.3 Delete：按锁内构造的 candidate 计算引用与替代目标（不信前端草稿）。
    let deletes: Vec<ProviderDeleteRef<'_>> = patch
        .providers
        .iter()
        .enumerate()
        .filter_map(|(index, edit)| match edit {
            ProviderEdit::Delete {
                id,
                active_after,
                session_naming_after,
                attachment_naming_after,
            } => Some(ProviderDeleteRef {
                index,
                id: id.as_str(),
                active_after: active_after.as_ref(),
                session_naming_after: session_naming_after.as_ref(),
                attachment_naming_after: attachment_naming_after.as_ref(),
            }),
            _ => None,
        })
        .collect();
    for ProviderDeleteRef {
        index,
        id,
        active_after,
        session_naming_after: session_after,
        attachment_naming_after: attachment_after,
    } in deletes
    {
        // mock 是验收专用的保留 id：设置面不呈现、不可新增、也不可删除（design §2.2/§2.3，
        // settings spec「mock 不可经面板新增或删除」）。与 Add 分支用同一条 code。
        if id == RESERVED_PROVIDER_ID {
            return Err(ApplyStop::Blocked(vec![field_error(
                format!("providers[{index}].id"),
                "settings_provider_reserved_id",
                format!("{RESERVED_PROVIDER_ID} 是验收专用的保留 id，不能删除"),
            )]));
        }
        let effective = effective_harness(value)?;
        // 删除的对象是**文件里的条目**，不是「有效条目」：装载期被忽略的坏条目也必须能删
        // （设置面只能删它或去配置文件修，design §6.6）。Update 相反，只接受有效条目。
        let exists = raw_harness(value)
            .and_then(|harness| harness.get("providers"))
            .and_then(Value::as_object)
            .is_some_and(|providers| providers.contains_key(id));
        if !exists {
            return Err(ApplyStop::Blocked(vec![field_error(
                format!("harness.providers.{id}"),
                "settings_provider_not_found",
                format!("provider \"{id}\" 不存在，无法删除"),
            )]));
        }
        // 可替代候选 = 其余合法条目，排除 mock 与装载期被忽略的条目，也排除本笔要删的其它 id。
        let candidates: Vec<String> = effective
            .providers
            .iter()
            .filter(|(other, entry)| {
                other.as_str() != id
                    && !deleted_ids.contains(&other.as_str())
                    && entry.preset != ProviderPreset::Mock
            })
            .map(|(other, _)| other.clone())
            .collect();
        let deleting_active = effective.provider == id;
        // raw `harness.provider` 也参与判断：它可能指向一个被装载期忽略的条目（此时 effective
        // active 已回退到别的 provider）。删除该条目时不清 raw 值就会留下悬空硬引用
        // （design §4.1「删除后 MUST NOT 留下任何硬引用」）。
        let deleting_raw_active =
            raw_trimmed(raw_harness(value), "provider").as_deref() == Some(id);

        if let Some(after) = active_after {
            if !candidates.contains(after) {
                return Err(ApplyStop::Blocked(vec![field_error(
                    "harness.provider",
                    "settings_active_provider_missing",
                    format!("替代的当前使用项 \"{after}\" 不是可用的 provider"),
                )]));
            }
        }
        if deleting_active {
            match active_after {
                Some(after) => {
                    harness_object_mut(value)
                        .insert("provider".to_string(), Value::String(after.clone()));
                    changes.field("harness.provider");
                }
                None if candidates.is_empty() => {
                    harness_object_mut(value).remove("provider");
                    changes.field("harness.provider");
                }
                None => {
                    return Err(ApplyStop::Blocked(vec![field_error(
                        "harness.provider",
                        "settings_provider_delete_active_requires_target",
                        format!(
                            "provider \"{id}\" 是当前使用项：删除前必须选择替代 provider（可选：{}）",
                            candidates.join("、")
                        ),
                    )]));
                }
            }
        } else if deleting_raw_active {
            // raw active 指向被删条目、但它已不是生效 active（装载期把悬空值回退了）：必须清除
            // 或重定向这个 raw 值，否则 Applied 之后 `harness.provider` 仍指向刚删掉的 id。
            match active_after {
                Some(after) => {
                    harness_object_mut(value)
                        .insert("provider".to_string(), Value::String(after.clone()));
                }
                None => {
                    harness_object_mut(value).remove("provider");
                }
            }
            changes.field("harness.provider");
        } else if let Some(after) = active_after {
            // 非当前使用项的删除不必带替代目标；带了就按显式意图切换 active。
            harness_object_mut(value).insert("provider".to_string(), Value::String(after.clone()));
            changes.field("harness.provider");
        }

        for (kind, after) in [
            (NamingKind::Session, session_after),
            (NamingKind::Attachment, attachment_after),
        ] {
            apply_naming_delete(
                value,
                kind,
                id,
                after,
                &candidates,
                deleting_active,
                changes,
            )?;
        }

        providers_mut(value)?.remove(id);
        changes.entry(format!("harness.providers.{id}"));
    }

    Ok(())
}

fn apply_naming_delete(
    value: &mut Value,
    kind: NamingKind,
    deleted_id: &str,
    after: Option<&NamingRetarget>,
    candidates: &[String],
    deleting_active: bool,
    changes: &mut AppliedChanges,
) -> Result<(), ApplyStop> {
    // 替代目标本身的合法性先于「当前是否引用」判定：给了一个不存在的 / 等于被删 id / mock 的
    // 目标属于无效输入，MUST NOT 因为该组当前恰好没有显式引用就被静默吞掉（design §4.2）。
    if let Some(NamingRetarget::Provider(target)) = after {
        if target == deleted_id || !candidates.contains(target) {
            return Err(ApplyStop::Blocked(vec![field_error(
                kind.provider_path(),
                "settings_naming_target_missing",
                format!(
                    "{}的新目标 \"{target}\" 不是可用的 provider（可选：{}）",
                    kind.label(),
                    candidates.join("、")
                ),
            )]));
        }
    }
    let current = raw_naming_provider(value, kind);
    if current.as_deref() == Some(deleted_id) {
        match after {
            Some(NamingRetarget::FollowActive) => {
                let table = naming_table_mut(value, kind)?;
                table.remove("provider");
                table.remove("model");
                changes.field(kind.provider_path());
                changes.field(kind.model_path());
            }
            Some(NamingRetarget::Provider(target)) => {
                let table = naming_table_mut(value, kind)?;
                table.insert("provider".to_string(), Value::String(target.clone()));
                // model 覆盖属于旧 provider 的清单：目标变化即清除（design §4.1）。
                table.remove("model");
                changes.field(kind.provider_path());
                changes.field(kind.model_path());
            }
            None => {
                return Err(ApplyStop::Blocked(vec![field_error(
                    kind.provider_path(),
                    "settings_provider_delete_referenced",
                    format!(
                        "provider \"{deleted_id}\" 正被{}使用：删除前必须选择「跟随当前 provider」或另一个替代目标",
                        kind.label()
                    ),
                )]));
            }
        }
    } else if deleting_active && current.is_none() {
        // 目标是「跟随当前」，删除 active 会让目标隐式变化：清除属于旧 provider 的 model 覆盖。
        // 只在该键确实存在时动表——否则会往一份没有命名节的文件里塞一句空对象。
        let has_model =
            raw_naming_table(value, kind).is_some_and(|table| table.contains_key("model"));
        if has_model {
            if let Some(table) = existing_table_mut(value, Some(kind.table())) {
                table.remove("model");
            }
            changes.field(kind.model_path());
        }
    }
    Ok(())
}

fn naming_table_mut(
    value: &mut Value,
    kind: NamingKind,
) -> Result<&mut Map<String, Value>, ApplyStop> {
    let harness = harness_object_mut(value);
    let key = kind.table();
    if !harness.get(key).is_some_and(Value::is_object) {
        // 两张命名表是结构化字段：非对象在装载期就是整文件回落，这里只会是缺席。
        harness.insert(key.to_string(), Value::Object(Map::new()));
    }
    harness
        .get_mut(key)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            ApplyStop::Blocked(vec![field_error(
                format!("harness.{key}"),
                "settings_patch_invalid",
                format!("harness.{key} 不是对象，无法编辑命名目标"),
            )])
        })
}

fn merge_model_inputs(inputs: &[ModelInput], current: &[Value]) -> Vec<Value> {
    inputs
        .iter()
        .map(|input| {
            let mut merged = Map::new();
            merged.insert("id".to_string(), Value::String(input.id.clone()));
            merged.insert("effort".to_string(), Value::Bool(input.effort));
            merged.insert("vision".to_string(), Value::Bool(input.vision));
            merged.insert("window".to_string(), Value::Number(input.window.into()));
            // 未知子键：按 id 在**当前 raw 清单**里找第一条全等项，把四个已知字段之外的键
            // 原样并入（design §6.5）；新增 id / 重命名 = 新条目，不复制旧键。
            if let Some(previous) = current.iter().find_map(|item| {
                let object = item.as_object()?;
                (object.get("id").and_then(Value::as_str) == Some(input.id.as_str()))
                    .then_some(object)
            }) {
                for (key, field) in previous {
                    if matches!(key.as_str(), "id" | "effort" | "vision" | "window") {
                        continue;
                    }
                    merged.insert(key.clone(), field.clone());
                }
            }
            Value::Object(merged)
        })
        .collect()
}

fn apply_active_provider(
    value: &mut Value,
    patch: &SettingsPatch,
    changes: &mut AppliedChanges,
) -> Result<(), ApplyStop> {
    let Some(edit) = &patch.active_provider else {
        return Ok(());
    };
    match edit {
        FieldEdit::Set(id) => {
            let effective = effective_harness(value)?;
            if !effective.providers.contains_key(id) {
                return Err(ApplyStop::Blocked(vec![field_error(
                    "harness.provider",
                    "settings_active_provider_missing",
                    format!("provider \"{id}\" 不是有效条目，不能设为当前使用"),
                )]));
            }
            harness_object_mut(value).insert("provider".to_string(), Value::String(id.clone()));
        }
        FieldEdit::Reset => {
            if let Some(harness) = value.get_mut("harness").and_then(Value::as_object_mut) {
                harness.remove("provider");
            }
        }
    }
    changes.field("harness.provider");
    Ok(())
}

fn apply_automation(
    value: &mut Value,
    patch: &SettingsPatch,
    changes: &mut AppliedChanges,
) -> Result<(), ApplyStop> {
    let automation = &patch.automation;
    if let Some(edit) = &automation.auto_compact {
        apply_harness_flag(value, None, "auto_compact", edit)?;
        changes.field("harness.auto_compact");
    }
    for (table, edit) in [
        ("session_naming", &automation.session_naming),
        ("attachment_naming", &automation.attachment_naming),
    ] {
        if let Some(edit) = edit {
            apply_harness_flag(value, Some(table), "enabled", edit)?;
            changes.field(format!("harness.{table}.enabled"));
        }
    }
    if let Some(edit) = &automation.subagents {
        let harness = harness_object_mut(value);
        match edit {
            FieldEdit::Set(enabled) => {
                if !harness.get("subagents").is_some_and(Value::is_object) {
                    if harness.contains_key("subagents") {
                        // 错形状的整节：不静默覆盖用户的（坏）数据，让用户先去文件里修。
                        return Err(ApplyStop::Blocked(vec![field_error(
                            "harness.subagents",
                            "settings_patch_invalid",
                            "harness.subagents 不是对象，无法只改 enabled；请先在配置文件中修正该节",
                        )]));
                    }
                    harness.insert("subagents".to_string(), Value::Object(Map::new()));
                }
                harness
                    .get_mut("subagents")
                    .and_then(Value::as_object_mut)
                    .expect("上面刚填过")
                    .insert("enabled".to_string(), Value::Bool(*enabled));
            }
            FieldEdit::Reset => {
                if let Some(table) = harness.get_mut("subagents").and_then(Value::as_object_mut) {
                    table.remove("enabled");
                }
            }
        }
        changes.field("harness.subagents.enabled");
    }
    Ok(())
}

fn apply_harness_flag(
    value: &mut Value,
    table: Option<&str>,
    key: &str,
    edit: &FieldEdit<bool>,
) -> Result<(), ApplyStop> {
    match edit {
        FieldEdit::Set(enabled) => {
            let harness = harness_object_mut(value);
            let target = match table {
                None => harness,
                Some(table) => {
                    if !harness.get(table).is_some_and(Value::is_object) {
                        harness.insert(table.to_string(), Value::Object(Map::new()));
                    }
                    harness
                        .get_mut(table)
                        .and_then(Value::as_object_mut)
                        .expect("上面刚填过")
                }
            };
            target.insert(key.to_string(), Value::Bool(*enabled));
        }
        FieldEdit::Reset => {
            if let Some(target) = existing_table_mut(value, table) {
                target.remove(key);
            }
        }
    }
    Ok(())
}

fn apply_naming(
    value: &mut Value,
    patch: &SettingsPatch,
    changes: &mut AppliedChanges,
) -> Result<(), ApplyStop> {
    let Some(naming) = &patch.naming else {
        return Ok(());
    };
    if let Some(edit) = &naming.session {
        apply_naming_edit(value, NamingKind::Session, edit, changes)?;
    }
    if let Some(edit) = &naming.attachment {
        apply_naming_edit(value, NamingKind::Attachment, edit, changes)?;
    }
    Ok(())
}

fn apply_naming_edit(
    value: &mut Value,
    kind: NamingKind,
    edit: &NamingEdit,
    changes: &mut AppliedChanges,
) -> Result<(), ApplyStop> {
    // provider 先：换目标会清除旧的 model 覆盖。
    if let Some(provider_edit) = &edit.provider {
        match provider_edit {
            FieldEdit::Set(id) => {
                let effective = effective_harness(value)?;
                let Some(entry) = effective.providers.get(id) else {
                    return Err(ApplyStop::Blocked(vec![field_error(
                        kind.provider_path(),
                        "settings_naming_target_missing",
                        format!("{}的目标 provider \"{id}\" 不是有效条目", kind.label()),
                    )]));
                };
                if entry.preset == ProviderPreset::Mock {
                    return Err(ApplyStop::Blocked(vec![field_error(
                        kind.provider_path(),
                        "settings_naming_target_missing",
                        format!("{}的目标不能是 mock（验收专用保留 id）", kind.label()),
                    )]));
                }
                let changed_target =
                    raw_naming_provider(value, kind).as_deref() != Some(id.as_str());
                let table = naming_table_mut(value, kind)?;
                table.insert("provider".to_string(), Value::String(id.clone()));
                if changed_target {
                    table.remove("model");
                    changes.field(kind.model_path());
                }
                changes.field(kind.provider_path());
            }
            FieldEdit::Reset => {
                if let Some(table) = existing_table_mut(value, Some(kind.table())) {
                    table.remove("provider");
                    table.remove("model");
                }
                changes.field(kind.provider_path());
                changes.field(kind.model_path());
            }
        }
    }
    // model 后：按**应用后的**目标 provider 的清单校验。
    if let Some(model_edit) = &edit.model {
        match model_edit {
            FieldEdit::Set(model) => {
                let effective = effective_harness(value)?;
                let target = raw_naming_provider(value, kind).or_else(|| {
                    (!effective.provider.is_empty()).then(|| effective.provider.clone())
                });
                let Some(target) = target else {
                    return Err(ApplyStop::Blocked(vec![field_error(
                        kind.model_path(),
                        "settings_naming_model_missing",
                        format!(
                            "{}没有目标 provider（当前没有可用的 provider），无法指定模型",
                            kind.label()
                        ),
                    )]));
                };
                let Some(entry) = effective.providers.get(&target) else {
                    return Err(ApplyStop::Blocked(vec![field_error(
                        kind.model_path(),
                        "settings_naming_target_missing",
                        format!("{}的目标 provider \"{target}\" 不是有效条目", kind.label()),
                    )]));
                };
                if entry.preset == ProviderPreset::Mock
                    || !entry.models.iter().any(|spec| spec.id == *model)
                {
                    return Err(ApplyStop::Blocked(vec![field_error(
                        kind.model_path(),
                        "settings_naming_model_missing",
                        format!(
                            "模型 \"{model}\" 不在 provider \"{target}\" 的 models 清单内；请先在该 provider 的清单里声明它"
                        ),
                    )]));
                }
                naming_table_mut(value, kind)?
                    .insert("model".to_string(), Value::String(model.clone()));
                changes.field(kind.model_path());
            }
            FieldEdit::Reset => {
                if let Some(table) = existing_table_mut(value, Some(kind.table())) {
                    table.remove("model");
                }
                changes.field(kind.model_path());
            }
        }
    }
    Ok(())
}

fn check_references(
    value: &Value,
    effective: &AppConfig,
    changes: &AppliedChanges,
) -> Result<(), ApplyStop> {
    if changes.touched("harness.provider") {
        if let Some(active) = raw_trimmed(raw_harness(value), "provider") {
            if !effective.harness.providers.contains_key(&active) {
                return Err(ApplyStop::Blocked(vec![field_error(
                    "harness.provider",
                    "settings_active_provider_missing",
                    format!("harness.provider 指向的 \"{active}\" 不是有效条目"),
                )]));
            }
        }
    }
    for kind in [NamingKind::Session, NamingKind::Attachment] {
        if !changes.touched(&kind.provider_path()) {
            continue;
        }
        if let Some(target) = raw_naming_provider(value, kind) {
            if !effective.harness.providers.contains_key(&target) {
                return Err(ApplyStop::Blocked(vec![field_error(
                    kind.provider_path(),
                    "settings_naming_target_missing",
                    format!("{}的目标 \"{target}\" 不是有效条目", kind.label()),
                )]));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicU32, Ordering};

    static SEQ: AtomicU32 = AtomicU32::new(0);

    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir();
            for _ in 0..16 {
                let dir = base.join(format!(
                    "lumir-settings-{tag}-{}-{}-{:016x}",
                    std::process::id(),
                    SEQ.fetch_add(1, Ordering::Relaxed),
                    rand::random::<u64>(),
                ));
                match std::fs::create_dir(&dir) {
                    Ok(()) => return Self(dir),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("create temp dir {}: {error}", dir.display()),
                }
            }
            panic!("create temp dir: 16 次随机目录名全部撞名");
        }

        fn path(&self) -> std::path::PathBuf {
            self.0.join("config.json")
        }

        fn write(&self, body: &str) {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(self.path())
                .expect("open config");
            file.write_all(body.as_bytes()).expect("write config");
        }

        fn read(&self) -> String {
            std::fs::read_to_string(self.path()).expect("read config")
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn snapshot(dir: &TempDir) -> SettingsSnapshot {
        snapshot_at(&dir.path())
    }

    fn apply(dir: &TempDir, patch: Value) -> SettingsApplyOutcome {
        apply_at(&dir.path(), patch).expect("apply 不应返回命令级错误")
    }

    fn revision(dir: &TempDir) -> String {
        snapshot(dir).revision.expect("有效快照必有 revision")
    }

    fn patch_with(dir: &TempDir, mut body: Value) -> Value {
        let object = body.as_object_mut().expect("patch 是对象");
        object.insert("base_revision".to_string(), Value::String(revision(dir)));
        body
    }

    fn provider_ids(snapshot: &SettingsSnapshot) -> Vec<String> {
        snapshot.providers.iter().map(|p| p.id.clone()).collect()
    }

    fn only_provider<'a>(snapshot: &'a SettingsSnapshot, id: &str) -> &'a ProviderSettings {
        snapshot
            .providers
            .iter()
            .find(|provider| provider.id == id)
            .unwrap_or_else(|| panic!("缺少 provider {id}"))
    }

    fn file_json(dir: &TempDir) -> Value {
        serde_json::from_str(&dir.read()).expect("落盘内容是合法 JSON")
    }

    const BASE: &str = r#"{
        "harness": {
            "provider": "kimi-work",
            "providers": {
                "kimi-work": {
                    "preset": "kimi",
                    "api_key": "test-key-1111",
                    "models": [{"id": "k3-256k", "effort": true, "vision": true, "window": 262144}]
                },
                "deepseek": {
                    "preset": "deepseek",
                    "api_key": "test-key-2222",
                    "models": [{"id": "ds-chat", "effort": true, "vision": false, "window": 131072}]
                },
                "local-lab": {
                    "preset": "generic",
                    "base_url": "http://127.0.0.1:8080/v1",
                    "models": [{"id": "local-chat", "effort": false, "vision": false, "window": 32768}]
                },
                "mock": {"preset": "mock", "fixture": "/tmp/fixture.json"}
            },
            "session_naming": {"enabled": true},
            "attachment_naming": {"enabled": true},
            "auto_compact": true,
            "subagents": {"enabled": true}
        }
    }"#;

    // -----------------------------------------------------------------
    // 快照
    // -----------------------------------------------------------------

    #[test]
    fn missing_file_has_empty_object_revision_and_defaults() {
        let dir = TempDir::new("missing");
        let snapshot = snapshot(&dir);
        assert_eq!(snapshot.file, SettingsFileState::Missing);
        assert!(snapshot.revision.is_some(), "首次接入也必须能拿到 revision");
        assert!(snapshot.providers.is_empty());
        assert_eq!(snapshot.active, None);
        assert!(snapshot.automation.auto_compact.value);
        assert!(!snapshot.automation.auto_compact.explicit);
        assert!(snapshot.diagnostics.is_empty());
        // 空对象的 revision 与「文件里只有 {}」一致。
        dir.write("{}");
        assert_eq!(snapshot_at(&dir.path()).revision, snapshot.revision);
    }

    #[test]
    fn invalid_json_has_no_revision_and_reports_position() {
        let dir = TempDir::new("invalid");
        dir.write("{not json");
        let snapshot = snapshot(&dir);
        match snapshot.file {
            SettingsFileState::Invalid { line, column, .. } => {
                assert!(line.is_some(), "JSON 语法错误要带上行号");
                assert!(column.is_some());
            }
            other => panic!("期望 Invalid，实际 {other:?}"),
        }
        assert_eq!(snapshot.revision, None);
        assert!(snapshot.providers.is_empty());
    }

    #[test]
    fn structural_invalid_file_is_readonly_but_shows_harness_best_effort() {
        let dir = TempDir::new("structural");
        dir.write(
            r#"{"editor":{"font_size":"15"},"harness":{"provider":"kimi-work","providers":{"kimi-work":{"preset":"kimi","api_key":"test-key-1111","models":[{"id":"k3-256k","effort":true,"vision":true,"window":262144}]}}}}"#,
        );
        let snapshot = snapshot(&dir);
        assert!(matches!(snapshot.file, SettingsFileState::Invalid { .. }));
        assert_eq!(snapshot.revision, None);
        assert_eq!(provider_ids(&snapshot), vec!["kimi-work".to_string()]);
        assert_eq!(snapshot.active.as_deref(), Some("kimi-work"));
    }

    #[test]
    fn snapshot_separates_raw_and_effective_wire_api() {
        let dir = TempDir::new("wire");
        dir.write(
            r#"{"harness":{"providers":{"kimi-work":{"preset":"kimi","api_key":"test-key-1111","models":[{"id":"k3-256k","effort":true,"vision":true,"window":262144}],"wire_api":"chat"}}}}"#,
        );
        let snapshot = snapshot(&dir);
        let provider = only_provider(&snapshot, "kimi-work");
        match &provider.wire_api {
            FieldState::Present(raw) => {
                assert_eq!(raw.kind, RawJsonKind::String);
                assert_eq!(raw.text, "chat");
            }
            other => panic!("raw wire_api 应保留原值，实际 {other:?}"),
        }
        assert_eq!(provider.effective.wire_api, WireApi::Responses);
    }

    #[test]
    fn snapshot_returns_only_key_hint_and_absent_vs_explicit() {
        let dir = TempDir::new("keys");
        dir.write(
            r#"{"harness":{"providers":{"kimi-work":{"preset":"kimi","api_key":"test-key-1234","base_url":"https://example.invalid/v1","models":[{"id":"k3-256k","effort":true,"vision":true,"window":262144}]},"deepseek":{"preset":"deepseek","models":[{"id":"ds-chat","effort":false,"vision":false,"window":131072}]}}}}"#,
        );
        let snapshot = snapshot(&dir);
        let kimi = only_provider(&snapshot, "kimi-work");
        assert_eq!(
            kimi.api_key,
            ApiKeyState::Set {
                hint: Some("1234".to_string())
            }
        );
        assert_eq!(
            kimi.base_url,
            FieldState::Present("https://example.invalid/v1".to_string())
        );
        let deepseek = only_provider(&snapshot, "deepseek");
        assert_eq!(deepseek.api_key, ApiKeyState::Unset);
        assert_eq!(deepseek.base_url, FieldState::Absent);
        assert_eq!(deepseek.wire_api, FieldState::Absent);
        assert_eq!(deepseek.status, ProviderStatus::MissingApiKey);
    }

    #[test]
    fn snapshot_keeps_ignored_entries_visible_and_sorts_canonically() {
        let dir = TempDir::new("ignored");
        dir.write(
            r#"{"harness":{"providers":{
                "zeta":{"preset":"generic","base_url":"http://127.0.0.1:1/v1","models":[{"id":"m","effort":false,"vision":false,"window":1024}]},
                "alpha":{"preset":"kimi","api_key":"test-key-3333","models":[{"id":"k3-256k","effort":false,"vision":false,"window":1024}]},
                "broken":{"preset":"nope"},
                "mock":{"preset":"mock","fixture":"/tmp/f"}
            }}}"#,
        );
        let snapshot = snapshot(&dir);
        assert_eq!(
            provider_ids(&snapshot),
            vec![
                "alpha".to_string(),
                "zeta".to_string(),
                "broken".to_string()
            ]
        );
        let broken = only_provider(&snapshot, "broken");
        assert_eq!(broken.status, ProviderStatus::Invalid);
        assert_eq!(broken.preset, None);
        assert_eq!(broken.raw_preset, "nope");
        assert!(snapshot.diagnostics.iter().any(|diagnostic| diagnostic.code
            == "harness_provider_preset_invalid"
            && diagnostic.path.as_deref() == Some("harness.providers.broken.preset")));
    }

    #[test]
    fn snapshot_shows_mock_preset_on_other_ids_as_invalid_and_deletable() {
        let dir = TempDir::new("mock-wrong-id");
        dir.write(
            r#"{"harness":{"provider":"kimi-work","providers":{
                "kimi-work":{"preset":"kimi","api_key":"test-key-1111","models":[{"id":"k3-256k","effort":false,"vision":false,"window":1024}]},
                "broken":{"preset":"mock"},
                "mock":{"preset":"mock","fixture":"/tmp/fixture.json"}
            }}}"#,
        );
        let snapshot = snapshot(&dir);
        assert!(
            snapshot
                .providers
                .iter()
                .all(|provider| provider.id != "mock"),
            "保留 id mock 的验收档不上面板"
        );
        let broken = only_provider(&snapshot, "broken");
        assert_eq!(broken.status, ProviderStatus::Invalid);
        assert_eq!(broken.raw_preset, "mock");
        assert_eq!(broken.preset, Some(ProviderPreset::Mock));

        // 坏条目必须可删除（用户只能删它或去配置文件修）。
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"providers": [{"action": "delete", "id": "broken"}]}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let value = file_json(&dir);
        assert!(value["harness"]["providers"].get("broken").is_none());
        assert!(
            value["harness"]["providers"]["mock"].is_object(),
            "删别的坏条目 MUST NOT 动保留 mock 档"
        );
    }

    #[test]
    fn snapshot_references_follow_effective_active_and_raw_overrides() {
        let dir = TempDir::new("refs");
        dir.write(
            r#"{"harness":{"provider":"deepseek","providers":{"kimi-work":{"preset":"kimi","api_key":"test-key-1111","models":[{"id":"k3-256k","effort":false,"vision":false,"window":1024}]},"deepseek":{"preset":"deepseek","api_key":"test-key-2222","models":[{"id":"ds-chat","effort":false,"vision":false,"window":1024}]}},"session_naming":{"provider":"kimi-work"},"attachment_naming":{"provider":"deepseek"}}}"#,
        );
        let snapshot = snapshot(&dir);
        let kimi = only_provider(&snapshot, "kimi-work");
        assert!(!kimi.references.active);
        assert!(kimi.references.session_naming);
        assert!(!kimi.references.attachment_naming);
        let deepseek = only_provider(&snapshot, "deepseek");
        assert!(deepseek.references.active);
        assert!(deepseek.references.attachment_naming);
    }

    #[test]
    fn snapshot_naming_target_states_resolve_follow_dangle_and_vision() {
        let dir = TempDir::new("naming-state");
        dir.write(
            r#"{"harness":{"provider":"kimi-work","providers":{
                "kimi-work":{"preset":"kimi","api_key":"test-key-1111","models":[{"id":"k3-256k","effort":true,"vision":true,"window":262144}]},
                "local-lab":{"preset":"generic","base_url":"http://127.0.0.1:8080/v1","models":[{"id":"local-chat","effort":false,"vision":false,"window":32768}]}
            },"attachment_naming":{"provider":"local-lab","model":"local-chat"}}}"#,
        );
        let snapshot = snapshot(&dir);
        let session = &snapshot.naming.session;
        assert!(session.override_provider.is_none());
        assert_eq!(session.resolved.provider.as_deref(), Some("kimi-work"));
        assert_eq!(session.resolved.model, "k3-256k");
        assert!(session.resolved.follows_active);
        assert!(session.resolved.eligible);
        assert_eq!(
            session
                .model_options
                .iter()
                .find(|option| option.is_effective)
                .map(|option| option.id.as_str()),
            Some("k3-256k")
        );
        let attachment = &snapshot.naming.attachment;
        assert_eq!(attachment.override_provider.as_deref(), Some("local-lab"));
        assert_eq!(attachment.override_model.as_deref(), Some("local-chat"));
        assert_eq!(attachment.resolved.model, "local-chat");
        assert!(!attachment.resolved.eligible, "未声明 vision 的模型不可用");
        assert_eq!(attachment.resolved.reason.as_deref(), Some("no_vision"));
        assert!(!attachment.resolved.follows_active);
    }

    #[test]
    fn snapshot_dangling_naming_override_falls_back_to_active() {
        let dir = TempDir::new("naming-dangle");
        dir.write(
            r#"{"harness":{"provider":"deepseek","providers":{"deepseek":{"preset":"deepseek","api_key":"test-key-2222","models":[{"id":"ds-chat","effort":false,"vision":false,"window":1024}]}},"session_naming":{"provider":"gone"}}}"#,
        );
        let snapshot = snapshot(&dir);
        let session = &snapshot.naming.session;
        assert_eq!(session.override_provider.as_deref(), Some("gone"));
        assert_eq!(session.resolved.provider.as_deref(), Some("deepseek"));
        assert!(session.resolved.dangling);
        assert!(!session.resolved.follows_active);
    }

    #[test]
    fn snapshot_capabilities_come_from_config_constants() {
        let dir = TempDir::new("caps");
        let snapshot = snapshot(&dir);
        assert_eq!(
            snapshot.capabilities.provider_id_pattern,
            "^[a-z0-9][a-z0-9_-]{0,31}$"
        );
        assert_eq!(
            snapshot.capabilities.reserved_provider_ids,
            vec![RESERVED_PROVIDER_ID.to_string()]
        );
        assert_eq!(snapshot.capabilities.model_window_min, 1);
        assert_eq!(snapshot.capabilities.model_window_max, 10_000_000);
        let deepseek = snapshot
            .capabilities
            .presets
            .iter()
            .find(|preset| preset.preset == ProviderPreset::Deepseek)
            .expect("deepseek 预设");
        assert_eq!(deepseek.supported_wire_apis, vec![WireApi::Responses]);
        let generic = snapshot
            .capabilities
            .presets
            .iter()
            .find(|preset| preset.preset == ProviderPreset::Generic)
            .expect("generic 预设");
        assert_eq!(generic.default_wire_api, WireApi::ChatCompletions);
        assert!(!generic.requires_api_key);
    }

    // -----------------------------------------------------------------
    // revision
    // -----------------------------------------------------------------

    #[test]
    fn revision_ignores_chip_written_model_but_covers_naming_models() {
        let dir = TempDir::new("revision");
        dir.write(BASE);
        let before = revision(&dir);

        // chip 写回 providers.<id>.model → 不算冲突。
        let mut value = file_json(&dir);
        value["harness"]["providers"]["kimi-work"]["model"] = Value::String("k3-256k".into());
        dir.write(&value.to_string());
        assert_eq!(revision(&dir), before);

        // 外部改 session_naming.model → 必须触发冲突。
        let mut value = file_json(&dir);
        value["harness"]["session_naming"]["model"] = Value::String("ds-chat".into());
        dir.write(&value.to_string());
        assert_ne!(revision(&dir), before);
    }

    #[test]
    fn external_change_of_naming_model_makes_delete_conflict() {
        let dir = TempDir::new("conflict");
        dir.write(BASE);
        let patch = patch_with(
            &dir,
            serde_json::json!({
                "providers": [
                    {"action": "delete", "id": "kimi-work", "active_after": "deepseek",
                     "session_naming_after": {"kind": "follow_active"},
                     "attachment_naming_after": {"kind": "follow_active"}}
                ]
            }),
        );
        // 面板打开后外部改了 session_naming.model。
        let mut value = file_json(&dir);
        value["harness"]["session_naming"]["model"] = Value::String("ds-chat".into());
        dir.write(&serde_json::to_string_pretty(&value).unwrap());

        let outcome = apply(&dir, patch);
        assert_eq!(outcome.status, SettingsApplyStatus::Conflict);
        assert_eq!(outcome.errors[0].code, "settings_revision_conflict");
        // 文件未动（仍是外部改过的那份）。
        let value = file_json(&dir);
        assert_eq!(
            value["harness"]["session_naming"]["model"],
            Value::String("ds-chat".into())
        );
        assert!(value["harness"]["providers"]["kimi-work"].is_object());
    }

    // -----------------------------------------------------------------
    // Add / Update / Delete
    // -----------------------------------------------------------------

    #[test]
    fn add_first_provider_and_set_active_in_one_patch() {
        let dir = TempDir::new("add-first");
        let patch = patch_with(
            &dir,
            serde_json::json!({
                "active_provider": {"kind": "set", "value": "kimi-work"},
                "providers": [{"action": "add", "id": "kimi-work", "preset": "kimi"}]
            }),
        );
        let outcome = apply(&dir, patch);
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let value = file_json(&dir);
        assert_eq!(
            value["harness"]["providers"]["kimi-work"],
            serde_json::json!({"preset": "kimi"})
        );
        assert_eq!(
            value["harness"]["provider"],
            Value::String("kimi-work".into())
        );
        assert_eq!(outcome.snapshot.active.as_deref(), Some("kimi-work"));
        assert_eq!(
            only_provider(&outcome.snapshot, "kimi-work").status,
            ProviderStatus::MissingApiKey
        );
    }

    #[test]
    fn add_rejects_duplicate_invalid_reserved_and_same_patch_reuse() {
        let dir = TempDir::new("add-reject");
        dir.write(BASE);

        for (body, code) in [
            (
                serde_json::json!({"providers": [{"action": "add", "id": "deepseek", "preset": "kimi"}]}),
                "settings_provider_id_duplicate",
            ),
            (
                serde_json::json!({"providers": [{"action": "add", "id": "Kimi Work", "preset": "kimi"}]}),
                "settings_provider_id_invalid",
            ),
            (
                serde_json::json!({"providers": [{"action": "add", "id": "mock", "preset": "generic"}]}),
                "settings_provider_reserved_id",
            ),
            (
                serde_json::json!({"providers": [
                    {"action": "delete", "id": "kimi-work", "active_after": "deepseek",
                     "session_naming_after": {"kind": "follow_active"},
                     "attachment_naming_after": {"kind": "follow_active"}},
                    {"action": "add", "id": "kimi-work", "preset": "generic"}
                ]}),
                "settings_provider_id_duplicate",
            ),
        ] {
            let before = dir.read();
            let outcome = apply(&dir, patch_with(&dir, body));
            assert_eq!(outcome.status, SettingsApplyStatus::Blocked, "{code}");
            assert_eq!(outcome.errors[0].code, code);
            assert_eq!(dir.read(), before, "Blocked 时文件逐字节不变");
        }
    }

    #[test]
    fn update_touches_only_submitted_fields_and_keeps_unknown_subkeys() {
        let dir = TempDir::new("update");
        dir.write(
            r#"{"harness":{"providers":{"kimi-work":{
                "preset":"kimi","api_key":"test-key-1111","future_flag":{"keep":true},
                "models":[{"id":"k3-256k","effort":true,"vision":true,"window":262144,"note":"keep me"}]
            }}},"theme":{"mode":"dark"}}"#,
        );
        let patch = patch_with(
            &dir,
            serde_json::json!({
                "providers": [{"action": "update", "id": "kimi-work",
                    "models": [{"id": "k3-256k", "effort": true, "vision": false, "window": 262144}],
                    "base_url": {"kind": "reset"}}]
            }),
        );
        let outcome = apply(&dir, patch);
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let value = file_json(&dir);
        let entry = &value["harness"]["providers"]["kimi-work"];
        assert_eq!(entry["api_key"], Value::String("test-key-1111".into()));
        assert_eq!(entry["future_flag"], serde_json::json!({"keep": true}));
        assert_eq!(entry["models"][0]["note"], Value::String("keep me".into()));
        assert_eq!(entry["models"][0]["vision"], Value::Bool(false));
        assert!(entry.get("base_url").is_none());
        assert_eq!(
            value["theme"]["mode"],
            Value::String("dark".into()),
            "其它节不受影响"
        );
    }

    #[test]
    fn update_clear_and_reset_delete_keys() {
        let dir = TempDir::new("clear");
        dir.write(
            r#"{"harness":{"providers":{"kimi-work":{"preset":"kimi","api_key":"test-key-1111","base_url":"https://x.invalid/v1","wire_api":"chat_completions","models":[{"id":"k3-256k","effort":true,"vision":false,"window":1024}]}}}}"#,
        );
        let patch = patch_with(
            &dir,
            serde_json::json!({
                "providers": [{"action": "update", "id": "kimi-work",
                    "api_key": {"kind": "clear"},
                    "base_url": {"kind": "reset"},
                    "wire_api": {"kind": "reset"}}]
            }),
        );
        let outcome = apply(&dir, patch);
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let entry = &file_json(&dir)["harness"]["providers"]["kimi-work"];
        for key in ["api_key", "base_url", "wire_api"] {
            assert!(entry.get(key).is_none(), "{key} 应被删键");
        }
        assert_eq!(
            entry["models"][0]["id"],
            Value::String("k3-256k".into()),
            "models 不在 patch 路径上，原样保留"
        );
    }

    #[test]
    fn update_rejects_ignored_provider_and_immutable_preset() {
        let dir = TempDir::new("update-reject");
        dir.write(r#"{"harness":{"providers":{"broken":{"preset":"nope"}}}}"#);
        let before = dir.read();
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"providers": [{"action": "update", "id": "broken", "api_key": {"kind": "clear"}}]}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Blocked);
        assert_eq!(outcome.errors[0].code, "settings_provider_not_found");
        assert_eq!(dir.read(), before);

        let dir = TempDir::new("update-preset");
        dir.write(BASE);
        let before_preset = dir.read();
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"providers": [{"action": "update", "id": "kimi-work", "preset": "generic"}]}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Blocked);
        assert_eq!(outcome.errors[0].code, "settings_provider_preset_immutable");
        assert_eq!(dir.read(), before_preset);
    }

    #[test]
    fn unknown_patch_fields_are_rejected_without_touching_the_file() {
        let dir = TempDir::new("unknown");
        dir.write(BASE);
        let before = dir.read();
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"providers": [{"action": "add", "id": "x", "preset": "kimi", "oops": 1}]}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Blocked);
        assert_eq!(outcome.errors[0].code, "settings_unknown_field");
        assert_eq!(dir.read(), before);

        let outcome = apply(
            &dir,
            patch_with(&dir, serde_json::json!({"unknown_top": true})),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Blocked);
        assert_eq!(outcome.errors[0].path, "unknown_top");
        assert_eq!(dir.read(), before);
    }

    // -----------------------------------------------------------------
    // 删除保护
    // -----------------------------------------------------------------

    #[test]
    fn deleting_active_requires_replacement_target() {
        let dir = TempDir::new("delete-active");
        dir.write(BASE);
        let before = dir.read();
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"providers": [{"action": "delete", "id": "kimi-work"}]}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Blocked);
        assert_eq!(
            outcome.errors[0].code,
            "settings_provider_delete_active_requires_target"
        );
        assert_eq!(outcome.errors[0].path, "harness.provider");
        assert_eq!(dir.read(), before, "缺替代目标时文件逐字节不变");
    }

    #[test]
    fn deleting_active_with_target_rewrites_active_and_clears_following_model() {
        let dir = TempDir::new("delete-active-ok");
        dir.write(
            r#"{"harness":{"provider":"kimi-work","providers":{
                "kimi-work":{"preset":"kimi","api_key":"test-key-1111","models":[{"id":"k3-256k","effort":false,"vision":false,"window":1024}]},
                "deepseek":{"preset":"deepseek","api_key":"test-key-2222","models":[{"id":"ds-chat","effort":false,"vision":false,"window":1024}]}
            },"session_naming":{"enabled":true,"model":"k3-256k"},"attachment_naming":{"enabled":true,"model":"k3-256k"}}}"#,
        );
        let patch = patch_with(
            &dir,
            serde_json::json!({"providers": [{"action": "delete", "id": "kimi-work", "active_after": "deepseek"}]}),
        );
        let outcome = apply(&dir, patch);
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let value = file_json(&dir);
        assert_eq!(
            value["harness"]["provider"],
            Value::String("deepseek".into())
        );
        assert!(value["harness"]["providers"].get("kimi-work").is_none());
        // 跟随当前的两组目标隐性变化：model 覆盖必须被清除。
        assert!(value["harness"]["session_naming"].get("model").is_none());
        assert!(value["harness"]["attachment_naming"].get("model").is_none());
    }

    #[test]
    fn deleting_naming_referenced_provider_requires_retarget() {
        let dir = TempDir::new("delete-naming");
        dir.write(
            r#"{"harness":{"provider":"deepseek","providers":{
                "kimi-work":{"preset":"kimi","api_key":"test-key-1111","models":[{"id":"k3-256k","effort":false,"vision":false,"window":1024}]},
                "deepseek":{"preset":"deepseek","api_key":"test-key-2222","models":[{"id":"ds-chat","effort":false,"vision":false,"window":1024}]}
            },"session_naming":{"provider":"kimi-work","model":"k3-256k"},
               "attachment_naming":{"provider":"kimi-work","model":"k3-256k"}}}"#,
        );
        let before = dir.read();
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"providers": [{"action": "delete", "id": "kimi-work"}]}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Blocked);
        let codes: Vec<&str> = outcome
            .errors
            .iter()
            .map(|error| error.code.as_str())
            .collect();
        assert!(codes.contains(&"settings_provider_delete_referenced"));
        assert_eq!(dir.read(), before);

        // 指定另一个 provider：改写 provider 键、清除 model 覆盖。
        let patch = patch_with(
            &dir,
            serde_json::json!({"providers": [{"action": "delete", "id": "kimi-work",
                "session_naming_after": {"kind": "provider", "value": "deepseek"},
                "attachment_naming_after": {"kind": "follow_active"}}]}),
        );
        let outcome = apply(&dir, patch);
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let value = file_json(&dir);
        assert_eq!(
            value["harness"]["session_naming"]["provider"],
            Value::String("deepseek".into())
        );
        assert!(value["harness"]["session_naming"].get("model").is_none());
        assert!(value["harness"]["attachment_naming"]
            .get("provider")
            .is_none());
        assert!(value["harness"]["attachment_naming"].get("model").is_none());
    }

    #[test]
    fn delete_retarget_must_be_a_valid_non_mock_candidate() {
        let dir = TempDir::new("delete-retarget-bad");
        dir.write(BASE);
        for retarget in [
            serde_json::json!({"kind": "provider", "value": "mock"}),
            serde_json::json!({"kind": "provider", "value": "kimi-work"}),
            serde_json::json!({"kind": "provider", "value": "gone"}),
        ] {
            let before = dir.read();
            let outcome = apply(
                &dir,
                patch_with(
                    &dir,
                    serde_json::json!({"providers": [{"action": "delete", "id": "kimi-work",
                        "active_after": "deepseek",
                        "session_naming_after": retarget}]}),
                ),
            );
            assert_eq!(outcome.status, SettingsApplyStatus::Blocked, "{outcome:?}");
            assert_eq!(outcome.errors[0].code, "settings_naming_target_missing");
            assert_eq!(dir.read(), before);
        }
    }

    #[test]
    fn deleting_last_provider_removes_active_and_naming_keys_but_keeps_mock() {
        let dir = TempDir::new("delete-last");
        dir.write(
            r#"{"harness":{"provider":"kimi-work","providers":{
                "kimi-work":{"preset":"kimi","api_key":"test-key-1111","models":[{"id":"k3-256k","effort":false,"vision":false,"window":1024}]},
                "mock":{"preset":"mock","fixture":"/tmp/fixture.json"}
            },"session_naming":{"provider":"kimi-work","model":"k3-256k"},
               "attachment_naming":{"provider":"kimi-work","model":"k3-256k"}}}"#,
        );
        let patch = patch_with(
            &dir,
            serde_json::json!({"providers": [{"action": "delete", "id": "kimi-work",
                "session_naming_after": {"kind": "follow_active"},
                "attachment_naming_after": {"kind": "follow_active"}}]}),
        );
        let outcome = apply(&dir, patch);
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let value = file_json(&dir);
        assert!(value["harness"].get("provider").is_none());
        assert!(value["harness"]["providers"].get("kimi-work").is_none());
        assert!(
            value["harness"]["providers"]["mock"].is_object(),
            "mock 原样保留"
        );
        assert!(value["harness"]["session_naming"].get("provider").is_none());
        assert!(value["harness"]["session_naming"].get("model").is_none());
        assert_eq!(outcome.snapshot.active, None);
        assert!(outcome.snapshot.providers.is_empty(), "mock 不上面板");
    }

    #[test]
    fn deleting_an_ignored_entry_is_allowed() {
        let dir = TempDir::new("delete-ignored");
        dir.write(
            r#"{"harness":{"provider":"deepseek","providers":{
                "broken":{"preset":"nope","future":"keep"},
                "deepseek":{"preset":"deepseek","api_key":"test-key-2222","models":[{"id":"ds-chat","effort":false,"vision":false,"window":1024}]}
            }}}"#,
        );
        let patch = patch_with(
            &dir,
            serde_json::json!({"providers": [{"action": "delete", "id": "broken"}]}),
        );
        let outcome = apply(&dir, patch);
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let value = file_json(&dir);
        assert!(value["harness"]["providers"].get("broken").is_none());
        assert_eq!(
            value["harness"]["providers"]["deepseek"]["preset"],
            Value::String("deepseek".into())
        );
        assert_eq!(outcome.snapshot.providers.len(), 1);
    }

    #[test]
    fn ignored_entries_are_not_rewritten_by_other_saves() {
        let dir = TempDir::new("ignored-untouched");
        dir.write(
            r#"{"harness":{"provider":"kimi-work","providers":{
                "kimi-work":{"preset":"kimi","api_key":"test-key-1111","models":[{"id":"k3-256k","effort":true,"vision":false,"window":1024}]},
                "broken":{"preset":"nope","future":{"keep":true}}
            },"auto_compact":true}}"#,
        );
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"automation": {"auto_compact": {"kind": "set", "value": false}}}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let value = file_json(&dir);
        assert_eq!(
            value["harness"]["providers"]["broken"],
            serde_json::json!({"preset": "nope", "future": {"keep": true}}),
            "装载期被忽略的条目只存在于 raw，保存其它路径 MUST NOT 改写它"
        );
    }

    #[test]
    fn add_delete_and_retarget_land_in_one_atomic_patch() {
        let dir = TempDir::new("atomic");
        dir.write(
            r#"{"harness":{"provider":"kimi-work","providers":{
                "kimi-work":{"preset":"kimi","api_key":"test-key-1111","models":[{"id":"k3-256k","effort":true,"vision":false,"window":1024}]}
            },"session_naming":{"provider":"kimi-work","model":"k3-256k"}}}"#,
        );
        let patch = patch_with(
            &dir,
            serde_json::json!({
                "providers": [
                    {"action": "add", "id": "kimi-personal", "preset": "kimi"},
                    {"action": "update", "id": "kimi-personal",
                     "api_key": {"kind": "replace", "value": "test-key-7777"},
                     "models": [{"id": "k3-256k", "effort": true, "vision": false, "window": 1024}]},
                    {"action": "delete", "id": "kimi-work",
                     "active_after": "kimi-personal",
                     "session_naming_after": {"kind": "follow_active"}}
                ]
            }),
        );
        let outcome = apply(&dir, patch);
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let value = file_json(&dir);
        assert!(value["harness"]["providers"].get("kimi-work").is_none());
        assert_eq!(
            value["harness"]["providers"]["kimi-personal"]["api_key"],
            Value::String("test-key-7777".into())
        );
        assert_eq!(
            value["harness"]["provider"],
            Value::String("kimi-personal".into())
        );
        assert!(value["harness"]["session_naming"].get("provider").is_none());
        assert!(value["harness"]["session_naming"].get("model").is_none());
    }

    #[test]
    fn deleting_the_reserved_mock_provider_is_rejected() {
        let dir = TempDir::new("delete-mock");
        dir.write(BASE);
        let before = dir.read();
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"providers": [{"action": "delete", "id": "mock"}]}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Blocked);
        assert_eq!(outcome.errors[0].code, "settings_provider_reserved_id");
        assert_eq!(outcome.errors[0].path, "providers[0].id");
        assert_eq!(dir.read(), before, "Blocked 时文件逐字节不变");
        // 保留条目仍在，且快照里不呈现 mock。
        assert!(file_json(&dir)["harness"]["providers"]["mock"].is_object());
        assert!(outcome.snapshot.providers.iter().all(|p| p.id != "mock"));
    }

    #[test]
    fn deleting_raw_active_ignored_entry_leaves_no_dangling_reference() {
        let dir = TempDir::new("delete-raw-active");
        dir.write(
            r#"{"harness":{"provider":"broken","providers":{
                "broken":{"preset":"nope"},
                "deepseek":{"preset":"deepseek","api_key":"test-key-2222","models":[{"id":"ds-chat","effort":false,"vision":false,"window":1024}]}
            }}}"#,
        );
        // 前置：raw active 悬空，生效 active 已回退到 deepseek。
        let before = snapshot(&dir);
        assert_eq!(before.active.as_deref(), Some("deepseek"));

        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"providers": [{"action": "delete", "id": "broken"}]}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let value = file_json(&dir);
        assert!(value["harness"]["providers"].get("broken").is_none());
        assert!(
            value["harness"].get("provider").is_none(),
            "raw active 指向被删条目时必须清除，MUST NOT 留下悬空硬引用"
        );
        assert_eq!(outcome.snapshot.active.as_deref(), Some("deepseek"));
        assert!(outcome
            .snapshot
            .diagnostics
            .iter()
            .all(|diagnostic| { diagnostic.code != "harness_provider_unknown" }));
    }

    #[test]
    fn deleting_raw_active_ignored_entry_can_redirect_instead_of_clearing() {
        let dir = TempDir::new("delete-raw-active-redirect");
        dir.write(
            r#"{"harness":{"provider":"broken","providers":{
                "broken":{"preset":"nope"},
                "deepseek":{"preset":"deepseek","api_key":"test-key-2222","models":[{"id":"ds-chat","effort":false,"vision":false,"window":1024}]}
            }}}"#,
        );
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"providers": [{"action": "delete", "id": "broken",
                    "active_after": "deepseek"}]}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let value = file_json(&dir);
        assert!(value["harness"]["providers"].get("broken").is_none());
        assert_eq!(
            value["harness"]["provider"],
            Value::String("deepseek".into())
        );
    }

    // -----------------------------------------------------------------
    // 命名目标编辑
    // -----------------------------------------------------------------

    #[test]
    fn naming_provider_change_clears_model_and_accepts_same_patch_model() {
        let dir = TempDir::new("naming-edit");
        dir.write(BASE);
        // 换 provider 且同一笔选新目标的模型：合法。
        let patch = patch_with(
            &dir,
            serde_json::json!({"naming": {"session": {
                "provider": {"kind": "set", "value": "deepseek"},
                "model": {"kind": "set", "value": "ds-chat"}
            }}}),
        );
        let outcome = apply(&dir, patch);
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let value = file_json(&dir);
        assert_eq!(
            value["harness"]["session_naming"]["provider"],
            Value::String("deepseek".into())
        );
        assert_eq!(
            value["harness"]["session_naming"]["model"],
            Value::String("ds-chat".into())
        );

        // 换 provider 不带 model → 清除 model 覆盖。
        let patch = patch_with(
            &dir,
            serde_json::json!({"naming": {"session": {"provider": {"kind": "set", "value": "kimi-work"}}}}),
        );
        let outcome = apply(&dir, patch);
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        assert!(file_json(&dir)["harness"]["session_naming"]
            .get("model")
            .is_none());
    }

    #[test]
    fn naming_model_must_be_in_target_list_and_reset_deletes_keys() {
        let dir = TempDir::new("naming-model");
        dir.write(BASE);
        let before = dir.read();
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"naming": {"session": {
                    "provider": {"kind": "set", "value": "deepseek"},
                    "model": {"kind": "set", "value": "k3-256k"}
                }}}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Blocked);
        assert_eq!(outcome.errors[0].code, "settings_naming_model_missing");
        assert_eq!(dir.read(), before);

        let patch = patch_with(
            &dir,
            serde_json::json!({"naming": {"attachment": {
                "provider": {"kind": "reset"},
                "model": {"kind": "reset"}
            }}}),
        );
        let outcome = apply(&dir, patch);
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let value = file_json(&dir);
        assert!(value["harness"]["attachment_naming"]
            .get("provider")
            .is_none());
        assert!(value["harness"]["attachment_naming"].get("model").is_none());
    }

    #[test]
    fn switching_off_naming_keeps_the_target_keys() {
        let dir = TempDir::new("naming-off");
        dir.write(
            r#"{"harness":{"provider":"deepseek","providers":{"deepseek":{"preset":"deepseek","api_key":"test-key-2222","models":[{"id":"ds-chat","effort":false,"vision":false,"window":1024}]}},"session_naming":{"enabled":true,"provider":"deepseek","model":"ds-chat"}}}"#,
        );
        let patch = patch_with(
            &dir,
            serde_json::json!({"automation": {"session_naming": {"kind": "set", "value": false}}}),
        );
        let outcome = apply(&dir, patch);
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let naming = &file_json(&dir)["harness"]["session_naming"];
        assert_eq!(naming["enabled"], Value::Bool(false));
        assert_eq!(naming["provider"], Value::String("deepseek".into()));
        assert_eq!(naming["model"], Value::String("ds-chat".into()));
        assert!(!outcome.snapshot.automation.session_naming.value);
        assert!(outcome.snapshot.automation.session_naming.explicit);
        // 快照仍然回传选择与选项（关闭只禁用控件，不抹值）。
        let session = &outcome.snapshot.naming.session;
        assert_eq!(session.override_provider.as_deref(), Some("deepseek"));
        assert_eq!(session.override_model.as_deref(), Some("ds-chat"));
        assert!(!session.provider_options.is_empty());
    }

    #[test]
    fn resets_do_not_create_empty_tables() {
        let dir = TempDir::new("reset-no-empty");
        dir.write(
            r#"{"harness":{"provider":"kimi-work","providers":{"kimi-work":{"preset":"kimi","api_key":"test-key-1111","models":[{"id":"k3-256k","effort":true,"vision":false,"window":1024}]}}}}"#,
        );
        let patch = patch_with(
            &dir,
            serde_json::json!({
                "active_provider": {"kind": "reset"},
                "automation": {
                    "session_naming": {"kind": "reset"},
                    "attachment_naming": {"kind": "reset"},
                    "subagents": {"kind": "reset"}
                },
                "naming": {
                    "session": {"provider": {"kind": "reset"}, "model": {"kind": "reset"}},
                    "attachment": {"provider": {"kind": "reset"}, "model": {"kind": "reset"}}
                }
            }),
        );
        let outcome = apply(&dir, patch);
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let value = file_json(&dir);
        assert!(value["harness"].get("provider").is_none());
        for table in ["session_naming", "attachment_naming"] {
            assert!(
                value["harness"].get(table).is_none(),
                "Reset 不应凭空造出 {table} 空表"
            );
        }
    }

    #[test]
    fn active_provider_set_requires_an_effective_entry() {
        let dir = TempDir::new("active-set");
        dir.write(BASE);
        let before = dir.read();
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"active_provider": {"kind": "set", "value": "gone"}}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Blocked);
        assert_eq!(outcome.errors[0].code, "settings_active_provider_missing");
        assert_eq!(dir.read(), before);

        // 显式切到另一个有效条目。
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"active_provider": {"kind": "set", "value": "local-lab"}}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let snapshot = outcome.snapshot;
        assert_eq!(snapshot.active.as_deref(), Some("local-lab"));
        assert!(snapshot.active_explicit);
    }

    #[test]
    fn snapshot_active_explicit_is_false_when_key_absent() {
        let dir = TempDir::new("active-explicit");
        dir.write(
            r#"{"harness":{"providers":{"kimi-work":{"preset":"kimi","api_key":"test-key-1111","models":[{"id":"k3-256k","effort":true,"vision":false,"window":1024}]}}}}"#,
        );
        let snapshot = snapshot(&dir);
        assert_eq!(snapshot.active.as_deref(), Some("kimi-work"), "缺省回退");
        assert!(!snapshot.active_explicit);
    }

    #[test]
    fn naming_target_rejects_mock_and_unknown_provider() {
        let dir = TempDir::new("naming-mock");
        dir.write(BASE);
        for target in ["mock", "gone"] {
            let before = dir.read();
            let outcome = apply(
                &dir,
                patch_with(
                    &dir,
                    serde_json::json!({"naming": {"session": {
                        "provider": {"kind": "set", "value": target}
                    }}}),
                ),
            );
            assert_eq!(outcome.status, SettingsApplyStatus::Blocked, "{target}");
            assert_eq!(outcome.errors[0].code, "settings_naming_target_missing");
            assert_eq!(dir.read(), before);
        }
    }

    #[test]
    fn renamed_model_does_not_inherit_unknown_subkeys() {
        let dir = TempDir::new("model-rename");
        dir.write(
            r#"{"harness":{"providers":{"kimi-work":{"preset":"kimi","api_key":"test-key-1111","models":[{"id":"old","effort":true,"vision":true,"window":1024,"note":"keep"}]}}}}"#,
        );
        let patch = patch_with(
            &dir,
            serde_json::json!({"providers": [{"action": "update", "id": "kimi-work",
                "models": [{"id": "new", "effort": true, "vision": true, "window": 1024}]}]}),
        );
        let outcome = apply(&dir, patch);
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let model = &file_json(&dir)["harness"]["providers"]["kimi-work"]["models"][0];
        assert_eq!(model["id"], Value::String("new".into()));
        assert!(model.get("note").is_none(), "重命名 = 新条目，不复制旧键");
    }

    // -----------------------------------------------------------------
    // 非回归
    // -----------------------------------------------------------------

    #[test]
    fn non_regression_blocks_illegal_to_illegal_and_allows_unrelated_fix() {
        let dir = TempDir::new("non-regression");
        dir.write(
            r#"{"harness":{"provider":"kimi-work","providers":{"kimi-work":{"preset":"kimi","api_key":"test-key-1111","models":[{"id":"k3-256k","effort":true,"vision":false,"window":0}]}}}}"#,
        );
        // 0 → 10000001：同一诊断码 / 路径 / 文案，但仍在改动路径上 → 必须拒绝。
        let before = dir.read();
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"providers": [{"action": "update", "id": "kimi-work",
                    "models": [{"id": "k3-256k", "effort": true, "vision": false, "window": 10_000_001}]}]}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Blocked);
        assert!(outcome
            .errors
            .iter()
            .any(|error| error.code == "harness_model_window_invalid"));
        assert_eq!(dir.read(), before);

        // 0 → 262144：合法化 → 允许。
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"providers": [{"action": "update", "id": "kimi-work",
                    "models": [{"id": "k3-256k", "effort": true, "vision": false, "window": 262144}]}]}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
    }

    #[test]
    fn unrelated_invalid_entry_does_not_block_other_paths() {
        let dir = TempDir::new("non-regression-unrelated");
        dir.write(
            r#"{"harness":{"provider":"kimi-work","providers":{
                "kimi-work":{"preset":"kimi","api_key":"test-key-1111","models":[{"id":"k3-256k","effort":true,"vision":false,"window":0}]},
                "deepseek":{"preset":"deepseek","api_key":"test-key-2222","models":[{"id":"ds-chat","effort":false,"vision":false,"window":1024}]}
            },"auto_compact":true}}"#,
        );
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"automation": {"auto_compact": {"kind": "set", "value": false}}}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let value = file_json(&dir);
        assert_eq!(
            value["harness"]["providers"]["kimi-work"]["models"][0]["window"],
            0
        );
        assert_eq!(value["harness"]["auto_compact"], Value::Bool(false));
    }

    #[test]
    fn half_configured_and_generic_missing_base_url_are_blocked() {
        let dir = TempDir::new("half-config");
        let patch = patch_with(
            &dir,
            serde_json::json!({"providers": [{"action": "add", "id": "kimi-work", "preset": "kimi"},
            ]}),
        );
        assert_eq!(apply(&dir, patch).status, SettingsApplyStatus::Applied);

        // Key 非空 + models 空 → Blocked。
        let before = dir.read();
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"providers": [{"action": "update", "id": "kimi-work",
                    "api_key": {"kind": "replace", "value": "test-key-9999"}}]}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Blocked);
        assert!(outcome
            .errors
            .iter()
            .any(|error| error.code == "harness_models_empty_when_configured"));
        assert_eq!(dir.read(), before);

        // generic 有 Key 或模型但缺 base_url → Blocked（哪怕诊断路径是 base_url）。
        let dir = TempDir::new("generic-base");
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"providers": [
                    {"action": "add", "id": "local-lab", "preset": "generic"},
                    {"action": "add", "id": "unused", "preset": "kimi"}
                ]}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let before = dir.read();
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"providers": [{"action": "update", "id": "local-lab",
                    "api_key": {"kind": "replace", "value": "test-key-8888"}}]}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Blocked);
        assert!(outcome
            .errors
            .iter()
            .any(|error| error.code == "harness_base_url_required"));
        assert_eq!(dir.read(), before);
    }

    #[test]
    fn empty_generic_entry_can_be_saved() {
        let dir = TempDir::new("empty-generic");
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"providers": [{"action": "add", "id": "local-lab", "preset": "generic"}]}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let provider = only_provider(&outcome.snapshot, "local-lab");
        assert!(!provider.configured);
        assert_eq!(provider.status, ProviderStatus::MissingBaseUrl);
    }

    #[test]
    fn file_invalid_blocks_saving_and_reports_reason() {
        let dir = TempDir::new("file-invalid");
        dir.write(r#"{"editor":{"font_size":"15"}}"#);
        let before = dir.read();
        let outcome = apply(
            &dir,
            serde_json::json!({"base_revision": "whatever",
                "providers": [{"action": "add", "id": "x", "preset": "kimi"}]}),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::FileInvalid);
        assert_eq!(dir.read(), before);
        assert!(matches!(
            outcome.snapshot.file,
            SettingsFileState::Invalid { .. }
        ));
        assert_eq!(outcome.snapshot.revision, None);
    }

    #[test]
    fn concurrent_saves_with_same_revision_have_one_winner() {
        let dir = TempDir::new("concurrent");
        dir.write(BASE);
        let revision = revision(&dir);
        let first = serde_json::json!({
            "base_revision": revision,
            "automation": {"auto_compact": {"kind": "set", "value": false}}
        });
        let second = serde_json::json!({
            "base_revision": revision,
            "automation": {"auto_compact": {"kind": "set", "value": true}}
        });
        let outcome = apply(&dir, first);
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        let outcome = apply(&dir, second);
        assert_eq!(outcome.status, SettingsApplyStatus::Conflict);
        assert_eq!(
            file_json(&dir)["harness"]["auto_compact"],
            Value::Bool(false)
        );
    }

    #[test]
    fn apply_result_returns_fresh_snapshot_and_warnings() {
        let dir = TempDir::new("fresh");
        dir.write(
            r#"{"harness":{"provider":"kimi-work","providers":{"kimi-work":{"preset":"kimi","api_key":"test-key-1111","models":[{"id":"k3-256k","effort":true,"vision":false,"window":1024}]}},"auto_compact":true}}"#,
        );
        let outcome = apply(
            &dir,
            patch_with(
                &dir,
                serde_json::json!({"automation": {"auto_compact": {"kind": "reset"}}}),
            ),
        );
        assert_eq!(outcome.status, SettingsApplyStatus::Applied);
        assert!(outcome.snapshot.automation.auto_compact.value);
        assert!(!outcome.snapshot.automation.auto_compact.explicit);
        assert_eq!(outcome.warnings, outcome.snapshot.diagnostics);
    }
}
