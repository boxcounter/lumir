//! 子代理定义文件（change add-harness-subagents design §4）：扫描两个作用域的 Markdown +
//! YAML frontmatter、逐定义校验、按作用域合并优先级，产出供 `task` 工具描述与委派装配使用的
//! 快照。
//!
//! **热加载口径**：调用方在**每回合开头**调用 [`AgentCatalog::load`] 一次并持有快照，回合内
//! 不再回读磁盘（不做 watcher）。磁盘改动在下一回合生效，无需重启。
//!
//! **正文不在快照里**：扫描只保留元数据（[`AgentDefinition`]）；定义正文按需读取
//! （[`AgentDefinition::body`]，委派装配时调用）。正文 MUST NOT 进入主会话上下文，也 MUST NOT
//! 进入 `task` 工具描述。
//!
//! **内建 `explore` 走同一条路径**：内置定义的 frontmatter 是一段常量文本，与磁盘文件经同一个
//! [`parse_definition`] 解析、同一条合并与清单路径处理——不是装载 / 校验 / 清单上的特殊分支。
//! 用户级 / vault 级同名定义覆盖它（覆盖产 warning，清单只保留生效的一份）。
//!
//! **扫描永不失败**：目录不存在视为空；单个文件不可读 / 解析失败 / 校验不通过都只丢弃该定义并
//! 产一条点名文件与原因的 warning。

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use saphyr::{LoadableYamlNode, YamlOwned};

use crate::config::HarnessConfig;

use super::tools;

/// 清单估算 token 的告警阈值（design §4.4）。
pub const CATALOG_TOKEN_LIMIT: u64 = 15_000;
/// 本仓无本地 tokenizer，按 `ceil(字符数 ÷ 4)` 粗估（design §4.4）。
pub const CHARS_PER_TOKEN_ESTIMATE: u64 = 4;
/// 定义未声明 `tools` 时的缺省工具集（design §4.2「只读三件」）。
pub const DEFAULT_TOOLS: [&str; 3] = ["vault_read", "vault_search", "skill_load"];
/// name 的字符上限（design §4.2）。
pub const MAX_NAME_CHARS: usize = 64;
/// 内建定义的名字（面板清单与覆盖规则都按它判）。
pub const BUILTIN_EXPLORE_NAME: &str = "explore";

/// 内建 `explore` 的定义文本（frontmatter + 正文）：与磁盘定义走同一个解析器，清单 / 校验 /
/// 覆盖路径因此没有任何特殊分支。
const BUILTIN_EXPLORE: &str = r#"---
name: explore
description: "只读探索：在 vault 里搜索、按路径枚举、读取文件与 skill，产出结论与依据；不改文件、不跑命令。"
tools: [vault_read, vault_search, skill_load]
model: inherit
---

你是只读探索子代理：只做探索与综合，不修改文件、不执行命令。

结束时直接给出结果，不寒暄：
1. 结论
2. 依据：vault 相对路径 + 关键片段或行号
3. 不确定项
4. 未覆盖范围
"#;

/// 定义来源（优先级：vault > 用户级 > 内建）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentSource {
    Builtin,
    User,
    Vault,
}

impl AgentSource {
    /// 诊断 / 面板用的字面量。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Builtin => "builtin",
            Self::User => "user",
            Self::Vault => "vault",
        }
    }

    /// 人话标签（warning 文案用）。
    fn label(self) -> &'static str {
        match self {
            Self::Builtin => "内建",
            Self::User => "用户级",
            Self::Vault => "vault 级",
        }
    }
}

/// 一个生效的子代理定义（元数据；正文按需读取）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentDefinition {
    pub name: String,
    pub description: String,
    /// 生效的工具白名单（定义未声明时 = [`DEFAULT_TOOLS`]）。
    pub tools: Vec<String>,
    /// `None` = `inherit`（当前 provider 的会话模型）。
    pub model: Option<String>,
    /// 生效预算：定义未写取配置缺省，定义值超过配置上限时在装载期夹取。
    pub max_turns: u32,
    pub max_tokens: u64,
    pub timeout_secs: u64,
    /// 定义强制后台运行；调用参数只能把前台升为后台，不能把这里降为前台。
    pub background: bool,
    pub source: AgentSource,
    /// 磁盘定义的文件路径；内建定义没有路径。
    pub path: Option<PathBuf>,
    /// 内建定义的内联正文；磁盘定义恒 `None`（正文不进快照）。
    inline_body: Option<String>,
}

impl AgentDefinition {
    /// 读取定义正文（委派装配时调用）。磁盘定义重新读文件并剥离 frontmatter——扫描期不缓存
    /// 正文，正文因此不会进入清单或主会话上下文。
    pub fn body(&self) -> Result<String, String> {
        if let Some(body) = &self.inline_body {
            return Ok(body.clone());
        }
        let path = self
            .path
            .as_ref()
            .ok_or_else(|| format!("子代理定义 {} 没有正文来源", self.name))?;
        let text = fs::read_to_string(path)
            .map_err(|error| format!("读取子代理定义 {} 失败：{error}", path.display()))?;
        let (_, body) = split_frontmatter(&text)
            .map_err(|reason| format!("读取子代理定义 {} 失败：{reason}", path.display()))?;
        Ok(body.to_string())
    }

    /// 定义的后台语义（design §4.2 / tasks §2.9）：调用参数只能把前台**升为**后台，
    /// 不能把定义的后台**降为**前台。
    pub fn effective_background(&self, call_background: bool) -> bool {
        self.background || call_background
    }
}

/// 一次扫描得到的定义快照（定义按名字升序，确定性）。
#[derive(Debug, Clone, Default)]
pub struct AgentCatalog {
    definitions: Vec<AgentDefinition>,
    warnings: Vec<String>,
}

impl AgentCatalog {
    /// 生产入口：扫描 `<vault>/.lumir/agents/**/*.md` 与 `<config_dir>/agents/**/*.md`。
    ///
    /// 目录不存在视为空；配置目录无法确定时产一条 warning 并只扫 vault 级。扫描本身永不失败
    /// （最坏只剩内建 `explore`）。
    pub fn load(vault_root: &Path, config: &HarnessConfig) -> Self {
        let mut warnings = Vec::new();
        let user_root = match crate::config::config_dir() {
            Ok(dir) => Some(dir.join("agents")),
            Err(error) => {
                warnings.push(format!(
                    "无法确定用户级子代理目录（{}）：只扫描 vault 级定义",
                    error.message
                ));
                None
            }
        };
        Self::load_from_roots_with(vault_root, user_root.as_deref(), config, warnings)
    }

    /// 测试 / 嵌入入口：用户级目录直接给出（生产由 [`Self::load`] 解析）。目录语义：
    /// `user_agents_root` 就是 `<config_dir>/agents`，不再是配置根。
    pub fn load_from_roots(
        vault_root: &Path,
        user_agents_root: Option<&Path>,
        config: &HarnessConfig,
    ) -> Self {
        Self::load_from_roots_with(vault_root, user_agents_root, config, Vec::new())
    }

    fn load_from_roots_with(
        vault_root: &Path,
        user_agents_root: Option<&Path>,
        config: &HarnessConfig,
        mut warnings: Vec<String>,
    ) -> Self {
        let mut by_name: BTreeMap<String, AgentDefinition> = BTreeMap::new();

        // 内建定义：与磁盘定义同一个解析器；解析失败只可能是代码被改坏（常量在本文件内），
        // 仍然按「丢定义 + warning」处理，不 panic。
        match parse_definition(
            BUILTIN_EXPLORE,
            None,
            AgentSource::Builtin,
            config,
            &mut warnings,
        ) {
            Ok(definition) => {
                by_name.insert(definition.name.clone(), definition);
            }
            Err(reason) => {
                warnings.push(format!("内建子代理 {BUILTIN_EXPLORE_NAME} 非法：{reason}"))
            }
        }

        let vault_agents = vault_agents_root(vault_root);
        for (root, source) in [
            (user_agents_root, AgentSource::User),
            (Some(vault_agents.as_path()), AgentSource::Vault),
        ] {
            let layer = collect_layer(root, source, config, &mut warnings);
            for definition in layer {
                if let Some(previous) = by_name.insert(definition.name.clone(), definition.clone())
                {
                    warnings.push(format!(
                        "子代理定义 {} 被 {} 覆盖（原来源：{}）；清单只保留生效的一份",
                        definition.name,
                        definition_location(&definition),
                        definition_location(&previous)
                    ));
                }
            }
        }

        let mut catalog = Self {
            definitions: by_name.into_values().collect(),
            warnings,
        };
        let estimated = catalog.estimated_catalog_tokens();
        if estimated > CATALOG_TOKEN_LIMIT {
            catalog.warnings.push(format!(
                "子代理清单估算 {estimated} token（按字符数 ÷ {CHARS_PER_TOKEN_ESTIMATE} 估算，{} 个定义），超过 {CATALOG_TOKEN_LIMIT} 阈值；清单未截断",
                catalog.definitions.len()
            ));
        }
        catalog
    }

    pub fn definitions(&self) -> &[AgentDefinition] {
        &self.definitions
    }

    pub fn get(&self, name: &str) -> Option<&AgentDefinition> {
        self.definitions
            .iter()
            .find(|definition| definition.name == name)
    }

    /// 扫描 / 校验产生的 warning（按发生顺序，确定性）。
    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }

    /// 注入 `task` 工具描述的清单：每行 `- <name>：<description>`（design §4.4 的固定格式）。
    /// 描述内的换行折成空格，保证一行一个定义；MUST NOT 截断。
    pub fn listing(&self) -> String {
        self.definitions
            .iter()
            .map(|definition| {
                format!(
                    "- {}：{}",
                    definition.name,
                    one_line(&definition.description)
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// 清单容量的估算 token 数：所有生效定义的描述字符数合计的 `ceil(÷ 4)`（design §4.4）。
    pub fn estimated_catalog_tokens(&self) -> u64 {
        let chars: u64 = self
            .definitions
            .iter()
            .map(|definition| definition.description.chars().count() as u64)
            .sum();
        chars.div_ceil(CHARS_PER_TOKEN_ESTIMATE)
    }

    /// 是否超过清单容量阈值（只告警，不截断）。
    pub fn catalog_too_large(&self) -> bool {
        self.estimated_catalog_tokens() > CATALOG_TOKEN_LIMIT
    }

    /// 把装载期 warning 与容量事件写进诊断日志。按消息去重：扫描每回合发生一次，重复的
    /// 同一条 warning 不应每回合刷一行日志。
    pub fn log_diagnostics(&self) {
        let mut seen = logged_diagnostics()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        for warning in &self.warnings {
            if seen.insert(warning.clone()) {
                crate::logging::config_warning("subagents", warning);
            }
        }
        if self.catalog_too_large() {
            let estimated = self.estimated_catalog_tokens();
            let key = format!("catalog_large:{estimated}:{}", self.definitions.len());
            if seen.insert(key) {
                crate::logging::subagent_catalog_large(estimated, self.definitions.len());
            }
        }
    }
}

/// 进程内已落过日志的 warning 集合（见 [`AgentCatalog::log_diagnostics`]）。
fn logged_diagnostics() -> &'static Mutex<HashSet<String>> {
    static SEEN: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SEEN.get_or_init(|| Mutex::new(HashSet::new()))
}

fn vault_agents_root(vault_root: &Path) -> PathBuf {
    vault_root.join(".lumir").join("agents")
}

/// 扫描一个作用域：先按路径字典序收集 `.md`，再按字典序解析——同层同名时「字典序第一个」
/// 因此不依赖文件系统读序。
fn collect_layer(
    root: Option<&Path>,
    source: AgentSource,
    config: &HarnessConfig,
    warnings: &mut Vec<String>,
) -> Vec<AgentDefinition> {
    let Some(root) = root else {
        return Vec::new();
    };
    let mut files = Vec::new();
    collect_markdown(root, &mut files, warnings);
    files.sort();

    let mut by_name: BTreeMap<String, AgentDefinition> = BTreeMap::new();
    for path in files {
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) => {
                warnings.push(format!(
                    "子代理定义 {} 读取失败（{error}），已跳过",
                    path.display()
                ));
                continue;
            }
        };
        match parse_definition(&text, Some(&path), source, config, warnings) {
            Ok(definition) => {
                // 同层同名：字典序第一个生效（`files` 已排序），后来的只产 warning。
                if let Some(previous) = by_name.get(&definition.name) {
                    warnings.push(format!(
                        "子代理定义同名冲突（{}）：{} 与 {}；按字典序取前者，后者已忽略",
                        source.label(),
                        definition_location(previous),
                        definition_location(&definition)
                    ));
                    continue;
                }
                by_name.insert(definition.name.clone(), definition);
            }
            Err(reason) => warnings.push(format!(
                "子代理定义 {} 非法：{reason}；已丢弃",
                path.display()
            )),
        }
    }
    by_name.into_values().collect()
}

/// 递归收集目录下的 `.md` 文件。目录不存在视为空；读取失败产 warning 并跳过该目录。
/// 不跟随符号链接（避免环）。
fn collect_markdown(dir: &Path, out: &mut Vec<PathBuf>, warnings: &mut Vec<String>) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            warnings.push(format!(
                "子代理目录 {} 读取失败（{error}），已跳过",
                dir.display()
            ));
            return;
        }
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .collect();
    paths.sort();
    for path in paths {
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            warnings.push(format!(
                "子代理条目 {} 元信息读取失败，已跳过",
                path.display()
            ));
            continue;
        };
        if metadata.is_dir() {
            collect_markdown(&path, out, warnings);
        } else if metadata.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("md")
        {
            out.push(path);
        }
    }
}

/// 解析一份定义文本（内建与磁盘共用）。warning 先收集在局部，定义被丢弃时不把半截
/// 字段级 warning 混进日志。
fn parse_definition(
    text: &str,
    path: Option<&Path>,
    source: AgentSource,
    config: &HarnessConfig,
    warnings: &mut Vec<String>,
) -> Result<AgentDefinition, String> {
    let (yaml, body) = split_frontmatter(text)?;
    let documents =
        YamlOwned::load_from_str(yaml).map_err(|error| format!("frontmatter 解析失败：{error}"))?;
    if documents.len() > 1 {
        return Err("frontmatter 不支持多文档".to_string());
    }
    let Some(document) = documents.first() else {
        return Err("frontmatter 为空".to_string());
    };
    let Some(mapping) = document.as_mapping() else {
        return Err("frontmatter 必须是映射".to_string());
    };

    let mut local_warnings = Vec::new();
    let mut unknown = Vec::new();
    for key in mapping.iter().map(|(key, _)| key) {
        let Some(field) = key.as_str() else {
            local_warnings.push("frontmatter 的字段名必须是字符串，已忽略该字段".to_string());
            continue;
        };
        if !KNOWN_FIELDS.contains(&field) {
            unknown.push(field.to_string());
        }
    }
    for field in unknown {
        local_warnings.push(format!("未识别字段 {field}（本版本不采纳），已忽略"));
    }

    let name = match mapping_get(mapping, "name").and_then(YamlOwned::as_str) {
        Some(name) => name.to_string(),
        None => return Err("缺少必填字段 name（或类型不是字符串）".to_string()),
    };
    validate_name(&name)?;

    let description = match mapping_get(mapping, "description").and_then(YamlOwned::as_str) {
        Some(description) if !description.trim().is_empty() => description.trim().to_string(),
        Some(_) => return Err("字段 description 为空".to_string()),
        None => return Err("缺少必填字段 description（或类型不是字符串）".to_string()),
    };

    let tools = resolve_tools(mapping_get(mapping, "tools"))?;
    let model = resolve_model(mapping_get(mapping, "model"), config, &mut local_warnings);
    let max_turns = resolve_max_turns(
        mapping_get(mapping, "max_turns"),
        config,
        &mut local_warnings,
    );
    let max_tokens = resolve_max_tokens(
        mapping_get(mapping, "max_tokens"),
        config,
        &mut local_warnings,
    );
    let timeout_secs = resolve_timeout_secs(
        mapping_get(mapping, "timeout_secs"),
        config,
        &mut local_warnings,
    );
    let background = match mapping_get(mapping, "background") {
        None => false,
        Some(value) => match value.as_bool() {
            Some(background) => background,
            None => {
                local_warnings.push("字段 background 必须是布尔值，已取 false".to_string());
                false
            }
        },
    };

    warnings.extend(local_warnings);
    Ok(AgentDefinition {
        name,
        description,
        tools,
        model,
        max_turns,
        max_tokens,
        timeout_secs,
        background,
        source,
        path: path.map(Path::to_path_buf),
        inline_body: (source == AgentSource::Builtin).then(|| body.to_string()),
    })
}

const KNOWN_FIELDS: [&str; 8] = [
    "name",
    "description",
    "tools",
    "model",
    "max_turns",
    "max_tokens",
    "timeout_secs",
    "background",
];

fn mapping_get<'a>(mapping: &'a saphyr::MappingOwned, field: &str) -> Option<&'a YamlOwned> {
    mapping
        .iter()
        .find(|(key, _)| key.as_str() == Some(field))
        .map(|(_, value)| value)
}

/// name 的字段规则（design §4.2）：非空、无空白、不含 `/`、≤64 字符。
fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("字段 name 不能为空".to_string());
    }
    if name.chars().any(char::is_whitespace) {
        return Err("字段 name 不能含空白".to_string());
    }
    if name.contains('/') {
        return Err("字段 name 不能含 `/`".to_string());
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(format!("字段 name 超过 {MAX_NAME_CHARS} 字符"));
    }
    Ok(())
}

/// `tools` 的闭集合校验：缺省只读三件；`[]` 合法；未知工具与 `task` 整条丢弃（fail loud）。
fn resolve_tools(value: Option<&YamlOwned>) -> Result<Vec<String>, String> {
    let Some(value) = value else {
        return Ok(DEFAULT_TOOLS
            .iter()
            .map(|tool| (*tool).to_string())
            .collect());
    };
    let Some(items) = value.as_sequence() else {
        return Err("字段 tools 必须是字符串列表".to_string());
    };
    let mut tools = Vec::new();
    for item in items {
        let Some(tool) = item.as_str() else {
            return Err("字段 tools 的条目必须是字符串".to_string());
        };
        if tool == "task" {
            return Err("字段 tools 不能包含 task（子代理不能再次委派）".to_string());
        }
        if !tools::TOOL_NAMES.contains(&tool) {
            return Err(format!("字段 tools 含未知工具 {tool}"));
        }
        tools.push(tool.to_string());
    }
    Ok(tools)
}

/// `model`：`inherit` / 缺省 = 继承；显式 id 必须在当前 provider 的模型清单里，否则保留定义、
/// 回落 `inherit` + warning（配置约定，design §4.3）。
fn resolve_model(
    value: Option<&YamlOwned>,
    config: &HarnessConfig,
    warnings: &mut Vec<String>,
) -> Option<String> {
    let value = value?;
    let Some(model) = value.as_str() else {
        warnings.push("字段 model 必须是字符串，已回落 inherit".to_string());
        return None;
    };
    if model == "inherit" {
        return None;
    }
    // 与调用级解析同口径（`subagents::resolve_model`）：mock 的模型清单开放，任意 id 视为
    // 已声明——否则 mock provider 下定义里的 model 永远被回落 inherit（M590 真机场景 186
    // 现场：两轮 `subagent_started.model` 都是 "mock"）。生产 provider 的判定不变。
    let declared = config.provider == crate::config::HarnessProvider::Mock
        || config
            .model_specs(&config.provider)
            .iter()
            .any(|spec| spec.id == model);
    if declared {
        Some(model.to_string())
    } else {
        warnings.push(format!(
            "字段 model 的取值 {model} 不在当前 provider 的模型清单里，已回落 inherit"
        ));
        None
    }
}

/// 正整数字段：类型非法 / 非正数 ⇒ 取配置值 + warning（design §4.3）。
fn positive_integer(value: &YamlOwned) -> Option<u64> {
    value
        .as_integer()
        .filter(|number| *number > 0)
        .map(|number| number as u64)
}

fn resolve_max_turns(
    value: Option<&YamlOwned>,
    config: &HarnessConfig,
    warnings: &mut Vec<String>,
) -> u32 {
    let Some(value) = value else {
        return config.subagents.max_turns;
    };
    let Some(raw) = positive_integer(value) else {
        warnings.push(format!(
            "字段 max_turns 取值非法（需要正整数），已取配置值 {}",
            config.subagents.max_turns
        ));
        return config.subagents.max_turns;
    };
    let (clamped, was_clamped) = config
        .subagents
        .clamp_turns(raw.min(u64::from(u32::MAX)) as u32);
    if was_clamped || raw > u64::from(u32::MAX) {
        warnings.push(format!(
            "字段 max_turns 取值 {raw} 超过配置上限 {}，已夹取为 {clamped}",
            config.subagents.max_turns
        ));
    }
    clamped
}

fn resolve_max_tokens(
    value: Option<&YamlOwned>,
    config: &HarnessConfig,
    warnings: &mut Vec<String>,
) -> u64 {
    let Some(value) = value else {
        return config.subagents.max_tokens;
    };
    let Some(raw) = positive_integer(value) else {
        warnings.push(format!(
            "字段 max_tokens 取值非法（需要正整数），已取配置值 {}",
            config.subagents.max_tokens
        ));
        return config.subagents.max_tokens;
    };
    let (clamped, was_clamped) = config.subagents.clamp_tokens(raw);
    if was_clamped {
        warnings.push(format!(
            "字段 max_tokens 取值 {raw} 超过配置上限 {}，已夹取为 {clamped}",
            config.subagents.max_tokens
        ));
    }
    clamped
}

fn resolve_timeout_secs(
    value: Option<&YamlOwned>,
    config: &HarnessConfig,
    warnings: &mut Vec<String>,
) -> u64 {
    let Some(value) = value else {
        return config.subagents.timeout_secs;
    };
    let Some(raw) = positive_integer(value) else {
        warnings.push(format!(
            "字段 timeout_secs 取值非法（需要正整数），已取配置值 {}",
            config.subagents.timeout_secs
        ));
        return config.subagents.timeout_secs;
    };
    let (clamped, was_clamped) = config.subagents.clamp_timeout_secs(raw);
    if was_clamped {
        warnings.push(format!(
            "字段 timeout_secs 取值 {raw} 超过配置上限 {}，已夹取为 {clamped}",
            config.subagents.timeout_secs
        ));
    }
    clamped
}

/// 切出 frontmatter：文件必须以 `---` 行开头，并以下一行 `---` 收尾。
/// 返回 `(yaml 文本, 正文)`；正文从收尾行之后开始。
fn split_frontmatter(text: &str) -> Result<(&str, &str), String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = text.split_inclusive('\n');
    let first = lines
        .next()
        .ok_or_else(|| "文件为空，缺少 frontmatter".to_string())?;
    if !is_frontmatter_delimiter(first) {
        return Err("缺少 frontmatter（文件必须以 `---` 行开头）".to_string());
    }
    let yaml_start = first.len();
    let mut offset = yaml_start;
    for line in lines {
        if is_frontmatter_delimiter(line) {
            let yaml = &text[yaml_start..offset];
            let body = &text[offset + line.len()..];
            return Ok((yaml, body));
        }
        offset += line.len();
    }
    Err("frontmatter 未闭合（缺少收尾的 `---` 行）".to_string())
}

fn is_frontmatter_delimiter(line: &str) -> bool {
    line.trim_end().eq("---")
}

/// 清单渲染用：把描述折成一行（换行 / 连续空白折成单个空格）。
fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// warning 文案里的定义定位：磁盘定义给路径，内建定义给名字。
fn definition_location(definition: &AgentDefinition) -> String {
    match &definition.path {
        Some(path) => path.display().to_string(),
        None => format!("内建 {}", definition.name),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use crate::config::{HarnessModelSpec, HarnessProvider};

    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let unique = NEXT.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "lumir-agents-{}-{}-{tag}",
            std::process::id(),
            unique
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn config_with_models(models: &[&str]) -> HarnessConfig {
        let mut config = HarnessConfig {
            provider: HarnessProvider::Kimi,
            ..Default::default()
        };
        config.providers.kimi.models = models
            .iter()
            .map(|id| HarnessModelSpec {
                id: (*id).to_string(),
                effort: false,
                vision: false,
                window: 100_000,
            })
            .collect();
        config
    }

    fn write_agent(root: &Path, relative: &str, content: &str) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    /// 定义字段 `model` 的声明判定与调用级解析同口径（M590）：mock provider 的模型清单开放，
    /// 任意 id 视为已声明（不回落 inherit、不产 warning）；生产 provider 仍按声明清单判。
    #[test]
    fn definition_model_accepts_any_id_under_mock() {
        fn model_field(yaml: &str) -> YamlOwned {
            let documents = YamlOwned::load_from_str(yaml).unwrap();
            let mapping = documents[0].as_mapping().expect("映射");
            mapping_get(mapping, "model").expect("model 字段").clone()
        }

        let mock_config = HarnessConfig {
            provider: HarnessProvider::Mock,
            ..Default::default()
        };
        let mut warnings = Vec::new();
        let resolved = resolve_model(
            Some(&model_field("model: mock-fast")),
            &mock_config,
            &mut warnings,
        );
        assert_eq!(resolved.as_deref(), Some("mock-fast"));
        assert!(warnings.is_empty(), "mock 下不应告警：{warnings:?}");

        // 生产 provider：未声明的 id 仍回落 inherit + warning（行为不变）。
        let config = config_with_models(&["model-a"]);
        let mut warnings = Vec::new();
        let resolved = resolve_model(
            Some(&model_field("model: undeclared")),
            &config,
            &mut warnings,
        );
        assert_eq!(resolved, None);
        assert_eq!(warnings.len(), 1);
    }

    /// 标准测试布局：`root/vault`（vault 级）与 `root/user/agents`（用户级）。
    struct Fixture {
        root: PathBuf,
        config: HarnessConfig,
    }

    impl Fixture {
        fn new(tag: &str) -> Self {
            Self {
                root: temp_root(tag),
                config: config_with_models(&["model-a", "model-b"]),
            }
        }

        fn vault_agents(&self) -> PathBuf {
            self.root.join("vault").join(".lumir").join("agents")
        }

        fn user_agents(&self) -> PathBuf {
            self.root.join("user").join("agents")
        }

        fn write_vault(&self, relative: &str, content: &str) {
            write_agent(&self.vault_agents(), relative, content);
        }

        fn write_user(&self, relative: &str, content: &str) {
            write_agent(&self.user_agents(), relative, content);
        }

        fn load(&self) -> AgentCatalog {
            AgentCatalog::load_from_roots(
                &self.root.join("vault"),
                Some(&self.user_agents()),
                &self.config,
            )
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn definition(name: &str, description: &str) -> String {
        format!("---\nname: {name}\ndescription: {description}\n---\n\n正文 {name}\n")
    }

    fn explore(catalog: &AgentCatalog) -> &AgentDefinition {
        catalog
            .get(BUILTIN_EXPLORE_NAME)
            .expect("内建 explore 应恒在场")
    }

    #[test]
    fn missing_directories_leave_only_the_builtin_explore() {
        let fixture = Fixture::new("missing");
        let catalog = fixture.load();
        assert_eq!(catalog.definitions().len(), 1);
        let builtin = explore(&catalog);
        assert_eq!(builtin.source, AgentSource::Builtin);
        assert_eq!(
            builtin.tools,
            vec!["vault_read", "vault_search", "skill_load"]
        );
        assert_eq!(builtin.model, None);
        assert_eq!(builtin.max_turns, fixture.config.subagents.max_turns);
        assert_eq!(builtin.max_tokens, fixture.config.subagents.max_tokens);
        assert_eq!(builtin.timeout_secs, fixture.config.subagents.timeout_secs);
        assert!(!builtin.background);
        assert!(
            catalog.warnings().is_empty(),
            "空目录不应产 warning：{:?}",
            catalog.warnings()
        );
        assert!(!builtin.body().unwrap().trim().is_empty());
    }

    #[test]
    fn valid_definition_is_loaded_with_its_fields_and_body_on_demand() {
        let fixture = Fixture::new("valid");
        fixture.write_vault(
            "research.md",
            "---\n\
             name: research\n\
             description: 调研任务\n\
             tools: [vault_read, vault_search]\n\
             model: model-a\n\
             max_turns: 5\n\
             max_tokens: 1000\n\
             timeout_secs: 30\n\
             background: true\n\
             ---\n\
             \n\
             你是研究子代理。\n",
        );
        let catalog = fixture.load();
        let research = catalog.get("research").expect("合法定义应生效");
        assert_eq!(research.source, AgentSource::Vault);
        assert_eq!(research.description, "调研任务");
        assert_eq!(research.tools, vec!["vault_read", "vault_search"]);
        assert_eq!(research.model.as_deref(), Some("model-a"));
        assert_eq!(research.max_turns, 5);
        assert_eq!(research.max_tokens, 1000);
        assert_eq!(research.timeout_secs, 30);
        assert!(research.background);
        assert_eq!(research.body().unwrap().trim(), "你是研究子代理。");
        assert!(research.path.is_some());
        assert!(catalog.warnings().is_empty(), "{:?}", catalog.warnings());
    }

    #[test]
    fn missing_required_fields_drop_the_definition() {
        let fixture = Fixture::new("required");
        fixture.write_vault("no-name.md", "---\ndescription: 有描述\n---\n正文\n");
        fixture.write_vault("no-description.md", "---\nname: lonely\n---\n正文\n");
        fixture.write_vault(
            "empty-description.md",
            "---\nname: empty\ndescription: \"  \"\n---\n正文\n",
        );
        let catalog = fixture.load();
        assert!(catalog.get("lonely").is_none());
        assert!(catalog.get("empty").is_none());
        assert_eq!(catalog.definitions().len(), 1, "只剩内建 explore");
        let joined = catalog.warnings().join("\n");
        assert!(joined.contains("no-name.md"), "{joined}");
        assert!(joined.contains("no-description.md"), "{joined}");
        assert!(joined.contains("empty-description.md"), "{joined}");
    }

    #[test]
    fn invalid_names_are_dropped() {
        let fixture = Fixture::new("names");
        for (file, name) in [
            ("blank.md", "\"\""),
            ("space.md", "\"two words\""),
            ("slash.md", "\"a/b\""),
            (
                "long.md",
                "\"012345678901234567890123456789012345678901234567890123456789012345\"",
            ),
        ] {
            fixture.write_vault(file, &definition(name, "描述"));
        }
        let catalog = fixture.load();
        assert_eq!(catalog.definitions().len(), 1, "非法 name 全部丢弃");
        for file in ["blank.md", "space.md", "slash.md", "long.md"] {
            assert!(
                catalog
                    .warnings()
                    .iter()
                    .any(|warning| warning.contains(file)),
                "{file} 应被点名：{:?}",
                catalog.warnings()
            );
        }
    }

    #[test]
    fn unknown_or_task_tools_drop_the_definition() {
        let fixture = Fixture::new("tools");
        fixture.write_vault(
            "unknown.md",
            "---\nname: unknown\ndescription: 描述\ntools: [vault_read, web_search]\n---\n",
        );
        fixture.write_vault(
            "nested.md",
            "---\nname: nested\ndescription: 描述\ntools: [task]\n---\n",
        );
        // 三件调度工具不在 `TOOL_NAMES` 里，子运行定义因此拿不到它们
        // （change add-cron-conversational-registration tasks 4.2 的第三条）。
        fixture.write_vault(
            "scheduler.md",
            "---\nname: scheduler\ndescription: 描述\ntools: [cron_task_create]\n---\n",
        );
        let catalog = fixture.load();
        assert!(catalog.get("unknown").is_none());
        assert!(catalog.get("nested").is_none());
        assert!(catalog.get("scheduler").is_none());
        let joined = catalog.warnings().join("\n");
        assert!(joined.contains("web_search"), "{joined}");
        assert!(joined.contains("不能包含 task"), "{joined}");
        assert!(joined.contains("cron_task_create"), "{joined}");
    }

    #[test]
    fn empty_tools_is_legal() {
        let fixture = Fixture::new("empty-tools");
        fixture.write_vault(
            "judge.md",
            "---\nname: judge\ndescription: 纯推理\ntools: []\n---\n正文\n",
        );
        let judge = fixture.load().get("judge").cloned().expect("空 tools 合法");
        assert!(judge.tools.is_empty());
    }

    #[test]
    fn unknown_fields_warn_but_keep_the_definition() {
        let fixture = Fixture::new("unknown-field");
        fixture.write_vault(
            "research.md",
            "---\n\
             name: research\n\
             description: 描述\n\
             permissionMode: acceptEdits\n\
             effort: high\n\
             ---\n",
        );
        let catalog = fixture.load();
        assert!(catalog.get("research").is_some());
        let joined = catalog.warnings().join("\n");
        assert!(joined.contains("permissionMode"), "{joined}");
        assert!(joined.contains("effort"), "{joined}");
        assert!(joined.contains("本版本不采纳"), "{joined}");
    }

    #[test]
    fn invalid_model_falls_back_to_inherit_with_a_warning() {
        let fixture = Fixture::new("model");
        fixture.write_vault(
            "bad.md",
            "---\nname: bad\ndescription: 描述\nmodel: not-configured\n---\n",
        );
        fixture.write_vault(
            "good.md",
            "---\nname: good\ndescription: 描述\nmodel: model-b\n---\n",
        );
        fixture.write_vault(
            "inherit.md",
            "---\nname: inherited\ndescription: 描述\nmodel: inherit\n---\n",
        );
        fixture.write_vault(
            "wrong-type.md",
            "---\nname: wrong\ndescription: 描述\nmodel: 42\n---\n",
        );
        let catalog = fixture.load();
        assert_eq!(catalog.get("bad").unwrap().model, None);
        assert_eq!(
            catalog.get("good").unwrap().model.as_deref(),
            Some("model-b")
        );
        assert_eq!(catalog.get("inherited").unwrap().model, None);
        assert_eq!(catalog.get("wrong").unwrap().model, None);
        let joined = catalog.warnings().join("\n");
        assert!(joined.contains("not-configured"), "{joined}");
        assert!(joined.contains("必须是字符串"), "{joined}");
    }

    #[test]
    fn numeric_budgets_are_clamped_or_fall_back_to_config() {
        let fixture = Fixture::new("budgets");
        fixture.write_vault(
            "over.md",
            "---\n\
             name: over\n\
             description: 描述\n\
             max_turns: 999\n\
             max_tokens: 999999999\n\
             timeout_secs: 99999\n\
             ---\n",
        );
        fixture.write_vault(
            "wrong.md",
            "---\n\
             name: wrong\n\
             description: 描述\n\
             max_turns: \"many\"\n\
             max_tokens: -1\n\
             timeout_secs: 0\n\
             ---\n",
        );
        let config = &fixture.config;
        let catalog = fixture.load();
        let over = catalog.get("over").unwrap();
        assert_eq!(over.max_turns, config.subagents.max_turns);
        assert_eq!(over.max_tokens, config.subagents.max_tokens);
        assert_eq!(over.timeout_secs, config.subagents.timeout_secs);
        let wrong = catalog.get("wrong").unwrap();
        assert_eq!(wrong.max_turns, config.subagents.max_turns);
        assert_eq!(wrong.max_tokens, config.subagents.max_tokens);
        assert_eq!(wrong.timeout_secs, config.subagents.timeout_secs);
        let joined = catalog.warnings().join("\n");
        assert_eq!(joined.matches("超过配置上限").count(), 3, "{joined}");
        assert_eq!(joined.matches("取值非法").count(), 3, "{joined}");
    }

    #[test]
    fn same_layer_duplicates_take_the_lexicographically_first_path() {
        let fixture = Fixture::new("same-layer");
        fixture.write_vault("b.md", &definition("dup", "后一个"));
        fixture.write_vault("a.md", &definition("dup", "前一个"));
        let catalog = fixture.load();
        let dup = catalog.get("dup").unwrap();
        assert_eq!(dup.description, "前一个");
        assert!(dup.path.as_ref().unwrap().ends_with("a.md"));
        assert!(
            catalog
                .warnings()
                .iter()
                .any(|warning| warning.contains("同名冲突")),
            "{:?}",
            catalog.warnings()
        );
    }

    #[test]
    fn vault_level_overrides_user_level() {
        let fixture = Fixture::new("priority");
        fixture.write_user("research.md", &definition("research", "用户级"));
        fixture.write_vault("nested/research.md", &definition("research", "vault 级"));
        let catalog = fixture.load();
        assert_eq!(catalog.get("research").unwrap().description, "vault 级");
        assert_eq!(catalog.get("research").unwrap().source, AgentSource::Vault);
        assert!(
            catalog
                .warnings()
                .iter()
                .any(|warning| warning.contains("覆盖")),
            "{:?}",
            catalog.warnings()
        );
    }

    #[test]
    fn builtin_explore_is_overridden_by_a_same_name_definition() {
        let fixture = Fixture::new("builtin");
        fixture.write_user("explore.md", &definition("explore", "自定义探索"));
        let catalog = fixture.load();
        let effective: Vec<_> = catalog
            .definitions()
            .iter()
            .filter(|definition| definition.name == "explore")
            .collect();
        assert_eq!(effective.len(), 1, "清单里只出现生效的一份");
        assert_eq!(effective[0].description, "自定义探索");
        assert_eq!(effective[0].source, AgentSource::User);
        assert!(
            catalog
                .warnings()
                .iter()
                .any(|warning| warning.contains("内建 explore")),
            "{:?}",
            catalog.warnings()
        );
    }

    #[test]
    fn malformed_or_missing_frontmatter_drops_only_that_definition() {
        let fixture = Fixture::new("malformed");
        fixture.write_vault("no-frontmatter.md", "只有正文，没有 frontmatter\n");
        fixture.write_vault("unclosed.md", "---\nname: unclosed\n");
        fixture.write_vault("bad-yaml.md", "---\nname: [unclosed\n---\n");
        fixture.write_vault("good.md", &definition("good", "好定义"));
        let catalog = fixture.load();
        assert!(catalog.get("good").is_some(), "坏文件不阻断扫描");
        assert!(catalog.get("unclosed").is_none());
        let joined = catalog.warnings().join("\n");
        assert!(joined.contains("no-frontmatter.md"), "{joined}");
        assert!(joined.contains("unclosed.md"), "{joined}");
        assert!(joined.contains("bad-yaml.md"), "{joined}");
    }

    #[test]
    fn background_type_error_keeps_the_definition_and_defaults_to_false() {
        let fixture = Fixture::new("background");
        fixture.write_vault(
            "typed.md",
            "---\nname: typed\ndescription: 描述\nbackground: \"yes\"\n---\n",
        );
        let catalog = fixture.load();
        let typed = catalog.get("typed").expect("定义保留");
        assert!(!typed.background);
        assert!(
            catalog
                .warnings()
                .iter()
                .any(|warning| warning.contains("background 必须是布尔值")),
            "{:?}",
            catalog.warnings()
        );
    }

    #[test]
    fn definition_background_cannot_be_downgraded_by_the_call() {
        let fixture = Fixture::new("force-background");
        fixture.write_vault(
            "fixed.md",
            "---\nname: fixed\ndescription: 描述\nbackground: true\n---\n",
        );
        let catalog = fixture.load();
        let fixed = catalog.get("fixed").unwrap();
        assert!(fixed.effective_background(false));
        assert!(fixed.effective_background(true));

        let plain = catalog.get("explore").unwrap();
        assert!(!plain.effective_background(false));
        assert!(plain.effective_background(true));
    }

    #[test]
    fn catalog_listing_contains_names_and_descriptions_but_not_bodies() {
        let fixture = Fixture::new("listing");
        fixture.write_vault(
            "research.md",
            "---\nname: research\ndescription: 调研任务\n---\n\n正文里不该出现的标记 SECRET-BODY\n",
        );
        let catalog = fixture.load();
        let listing = catalog.listing();
        assert!(listing.contains("- explore："), "{listing}");
        assert!(listing.contains("- research：调研任务"), "{listing}");
        assert!(
            !listing.contains("SECRET-BODY"),
            "正文 MUST NOT 进入清单：{listing}"
        );
        assert_eq!(listing.lines().count(), 2);
    }

    #[test]
    fn catalog_token_estimate_uses_description_chars_and_warns_without_truncating() {
        let fixture = Fixture::new("catalog-large");
        let description = "长".repeat(60_004);
        fixture.write_vault(
            "huge.md",
            &format!("---\nname: huge\ndescription: {description}\n---\n"),
        );
        let catalog = fixture.load();
        let huge = catalog.get("huge").unwrap();
        assert_eq!(huge.description.chars().count(), 60_004);
        // 60,004 ÷ 4 = 15,001（内建 explore 的描述也计入，故只会更大）。
        assert!(catalog.catalog_too_large());
        assert!(
            catalog
                .warnings()
                .iter()
                .any(|warning| warning.contains("清单未截断")),
            "容量告警应落进 warning"
        );
        assert!(
            catalog.listing().contains(&description),
            "清单 MUST NOT 截断"
        );
    }

    #[test]
    fn estimate_is_ceil_of_description_chars_over_four() {
        let catalog = AgentCatalog {
            definitions: vec![AgentDefinition {
                name: "a".to_string(),
                description: "12345".to_string(),
                tools: Vec::new(),
                model: None,
                max_turns: 1,
                max_tokens: 1,
                timeout_secs: 1,
                background: false,
                source: AgentSource::Builtin,
                path: None,
                inline_body: None,
            }],
            warnings: Vec::new(),
        };
        assert_eq!(catalog.estimated_catalog_tokens(), 2, "ceil(5 / 4) = 2");
    }

    #[test]
    fn multi_line_descriptions_render_on_one_catalog_line() {
        let fixture = Fixture::new("multiline");
        fixture.write_vault(
            "multi.md",
            "---\nname: multi\ndescription: |\n  第一行\n  第二行\n---\n",
        );
        let catalog = fixture.load();
        let line = catalog
            .listing()
            .lines()
            .find(|line| line.contains("multi"))
            .unwrap()
            .to_string();
        assert!(line.contains("第一行 第二行"), "{line}");
    }
}
