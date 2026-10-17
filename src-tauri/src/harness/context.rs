//! 系统上下文装配（design §5、§12）：固定身份段 + AGENTS.md 三层 + Skill 索引。
//!
//! - 固定身份段：v1 不做 persona 系统（裁决点 7），固定朴素身份 + 工具使用纪律。正文真源是
//!   同目录的 `prompts/identity.md`；摘录回指纪律在同目录 `prompts/quote-reference.md`，路径
//!   引用纪律在同目录 `prompts/path-reference.md`——三段都是编译期嵌入的 Markdown（change
//!   `harness-prompt-files` / `harness-path-link`），改文案直接改文件。
//! - AGENTS.md 三层：user-wide（`~/.agents/AGENTS.md`）、vault 根（`<vault>/AGENTS.md`）、
//!   vault 根本地覆盖层（`<vault>/AGENTS.local.md`，change `harness-agents-local-md`）；
//!   文件不存在**静默跳过**（常态）；嵌套子目录级是 Non-goal。
//! - Skill 索引：双根发现（`~/.agents/skills` + `<vault>/.agents/skills`），vault-wide
//!   同名覆盖 user-wide（就近原则）；只把 name + description 清单注入系统上下文
//!   （progressive disclosure），全文经 `skill_load` 按需加载。
//!
//! 装配时机：会话建立 / 「新会话」重置 / 自动压缩开新逻辑会话——三者走同一个
//! [`assemble_system`]，「重新装配」就是再调一次（运行期新增 Skill 下个会话生效，
//! design §5 变更检测口径）。

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// 固定身份段的正文真源（change `harness-prompt-files`）：仓内 Markdown，编译期嵌入，
/// 运行期无可覆盖入口。文件尾换行由装配处 trim（见 [`assemble_system`]）。
const IDENTITY: &str = include_str!("prompts/identity.md");
/// 装配清单 identity 条目的来源路径（仓内相对路径，供审计反查）。
const IDENTITY_PATH: &str = "src-tauri/src/harness/prompts/identity.md";

/// 摘录引用的回指纪律（change add-harness-quote-cards design §3 prompt 层；change
/// harness-message-excerpt design §4 prompt 层）：用户消息里的 `<quote …>` 是用户从 vault
/// 文档中显式策展的摘录，`<msg-quote …>` 是用户从**会话历史消息**里摘录的片段。agent 按
/// 内容/出处/角色回指（一致性原则：协议与 UI 均无编号，回复也不得发明编号）；两类摘录各用
/// 自己的出处要素消歧（文档 = heading / lines，消息 = role / at），这些要素对人同样可查。
/// 正文真源见 `prompts/quote-reference.md`。
const QUOTE_REFERENCE: &str = include_str!("prompts/quote-reference.md");
/// 装配清单 quote_reference 条目的来源路径（仓内相对路径，供审计反查）。
const QUOTE_REFERENCE_PATH: &str = "src-tauri/src/harness/prompts/quote-reference.md";

/// 路径引用的纪律（change `harness-path-link` design §7）：harness 面板把 agent 输出里的 vault
/// 路径渲染为可点元素（命中文件索引才可点、可带行号），这段固定文案负责让模型的写法**可被
/// 识别**——完整相对路径 + 扩展名、`:行号`、只引用工具结果里真实出现过的路径、不用 Markdown
/// 链接语法包裹 vault 相对路径。遵从度按抽样观察验收，不进机器判据（mock provider 代表不了
/// 真实模型）。正文真源见 `prompts/path-reference.md`。
const PATH_REFERENCE: &str = include_str!("prompts/path-reference.md");
/// 装配清单 path_reference 条目的来源路径（仓内相对路径，供审计反查）。
const PATH_REFERENCE_PATH: &str = "src-tauri/src/harness/prompts/path-reference.md";

/// 装配清单的一个来源项（`session_open.assembly` 的元素，design §2）：每个来源的
/// 路径与**当时是否存在**。「不存在」本身是装配事实的一部分——旧实现静默跳过，
/// 事后无法区分「没配」与「忘了注入」。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AssemblySource {
    /// 来源标识：identity / quote_reference / path_reference / agents_user_wide /
    /// agents_vault_root / agents_vault_root_local / skill_index。
    pub source: &'static str,
    /// 来源路径（固定段为仓内相对路径；Skill 索引无单一文件来源，为 null）。
    pub path: Option<String>,
    /// 装配时该来源是否在场。
    pub exists: bool,
    /// 注入文本的字节数（不存在 = 0）。
    pub bytes: u64,
    /// 仅 skill_index：合并去重后的 Skill 数。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills: Option<usize>,
}

impl AssemblySource {
    fn fixed(source: &'static str, path: &'static str, text: &str) -> Self {
        Self {
            source,
            path: Some(path.to_string()),
            exists: true,
            bytes: text.len() as u64,
            skills: None,
        }
    }

    fn file(source: &'static str, path: PathBuf, content: Option<&str>) -> Self {
        Self {
            source,
            path: Some(path.display().to_string()),
            exists: content.is_some(),
            bytes: content.map(|c| c.len() as u64).unwrap_or(0),
            skills: None,
        }
    }
}

/// 装配结果：`text` 是发给模型的 system prompt 全文（逐字节），`manifest` 是
/// 结构化装配清单（每来源路径 + 存在与否 + 字节数）——随 `session_open` 落盘。
pub struct AssembledSystem {
    pub text: String,
    pub manifest: Vec<AssemblySource>,
}

/// 装配完整系统上下文（固定身份段 + AGENTS.md 三层 + Skill 索引 + 摘录回指纪律 + 路径引用纪律）。
pub fn assemble_system(vault_root: &Path) -> AssembledSystem {
    // 固定段正文来自仓内 Markdown（编译期嵌入，change `harness-prompt-files`）：装配处统一
    // trim 掉文件尾换行 / 行尾空白，注入文本与清单 bytes 都用 trim 后的结果，其余不动。
    let identity = IDENTITY.trim_end();
    let quote_reference = QUOTE_REFERENCE.trim_end();
    let path_reference = PATH_REFERENCE.trim_end();
    let mut out = String::from(identity);
    let mut manifest = vec![AssemblySource::fixed("identity", IDENTITY_PATH, identity)];
    push_section(&mut out, "引用摘录的回指纪律", quote_reference);
    manifest.push(AssemblySource::fixed(
        "quote_reference",
        QUOTE_REFERENCE_PATH,
        quote_reference,
    ));
    // 路径引用纪律紧跟在摘录回指之后（change `harness-path-link` design §7）：两段都是「模型
    // 怎么写引用」的固定纪律，排在一起；面板的路径链接识别口径以这一段为准。
    push_section(&mut out, "路径引用的纪律", path_reference);
    manifest.push(AssemblySource::fixed(
        "path_reference",
        PATH_REFERENCE_PATH,
        path_reference,
    ));
    let user_agents_path = user_agents_path();
    let user_agents = read_agents_md(&user_agents_path);
    manifest.push(AssemblySource::file(
        "agents_user_wide",
        user_agents_path,
        user_agents.as_deref(),
    ));
    if let Some(user_agents) = &user_agents {
        push_section(
            &mut out,
            "user-wide AGENTS.md（~/.agents/AGENTS.md）",
            user_agents,
        );
    }
    let vault_agents_path = vault_root.join("AGENTS.md");
    let vault_agents = read_agents_md(&vault_agents_path);
    manifest.push(AssemblySource::file(
        "agents_vault_root",
        vault_agents_path,
        vault_agents.as_deref(),
    ));
    if let Some(vault_agents) = &vault_agents {
        push_section(&mut out, "vault 根 AGENTS.md", vault_agents);
    }
    // 第三层：vault 根本地覆盖层（`<vault>/AGENTS.local.md`，change `harness-agents-local-md`）。
    // 排 vault 根 AGENTS.md 之后注入——「后位为准」的覆盖语义由位置 + 标题共同表达，系统不解析
    // 两层内容（不引入 merge）。
    let vault_local_path = vault_root.join("AGENTS.local.md");
    let vault_local = read_agents_md(&vault_local_path);
    manifest.push(AssemblySource::file(
        "agents_vault_root_local",
        vault_local_path,
        vault_local.as_deref(),
    ));
    if let Some(vault_local) = &vault_local {
        push_section(
            &mut out,
            "vault 根 AGENTS.local.md（本机本地覆盖层，与上文 AGENTS.md 冲突时以此为准）",
            vault_local,
        );
    }
    let skills = discover_skills(vault_root);
    let mut index = String::new();
    for skill in &skills {
        index.push_str(&format!("- {}: {}\n", skill.name, skill.description));
    }
    manifest.push(AssemblySource {
        source: "skill_index",
        path: None,
        exists: !skills.is_empty(),
        bytes: index.trim_end().len() as u64,
        skills: Some(skills.len()),
    });
    if !skills.is_empty() {
        push_section(
            &mut out,
            "可用 Skill 索引（skill_load 按名加载全文）",
            index.trim_end(),
        );
    }
    AssembledSystem {
        text: out,
        manifest,
    }
}

fn push_section(out: &mut String, title: &str, body: &str) {
    out.push_str(&format!("\n\n===== {title} =====\n{body}"));
}

/// user-wide AGENTS.md 路径（`~/.agents/AGENTS.md`）。HOME 取环境变量，取不到返回不存在路径。
fn user_agents_path() -> PathBuf {
    home_dir().join(".agents").join("AGENTS.md")
}

/// 用户主目录：HOME 环境变量优先（与既有测试的 XDG 隔离口径一致），缺失时退 `~` 展开失败路径。
fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("~"))
}

/// 读 AGENTS.md：不存在 / 非文件 / 读失败 ⇒ None（静默跳过是 spec 口径，不是缺陷）。
fn read_agents_md(path: &Path) -> Option<String> {
    if !path.is_file() {
        return None;
    }
    fs::read_to_string(path).ok()
}

/// 一个已发现的 Skill（双根合并、override 已应用后的清单项）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SkillEntry {
    pub name: String,
    pub description: String,
    /// Skill 目录的绝对路径（skill_load 的根内读取基准）。
    pub dir: PathBuf,
}

/// 双根发现：user-wide 先入表，vault-wide 同名覆盖（HashMap 后写覆盖先写）。
/// 每个 Skill = 含 SKILL.md 的目录；name 取目录名，description 取 SKILL.md
/// frontmatter 的 `description:` 行（无 frontmatter 或无该字段 ⇒ 空描述）。
pub fn discover_skills(vault_root: &Path) -> Vec<SkillEntry> {
    let mut by_name: std::collections::HashMap<String, SkillEntry> =
        std::collections::HashMap::new();
    let roots = [
        home_dir().join(".agents").join("skills"),
        vault_root.join(".agents").join("skills"),
    ];
    for root in roots {
        let Ok(entries) = fs::read_dir(&root) else {
            continue; // 根不存在是常态
        };
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let Some(name) = dir.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let skill_md = dir.join("SKILL.md");
            if !skill_md.is_file() {
                continue;
            }
            let description = fs::read_to_string(&skill_md)
                .map(|text| parse_description(&text))
                .unwrap_or_default();
            by_name.insert(
                name.to_string(),
                SkillEntry {
                    name: name.to_string(),
                    description,
                    dir,
                },
            );
        }
    }
    // 稳定输出：按名字排序（发现顺序随文件系统返回序，不可依赖）。
    let mut skills: Vec<SkillEntry> = by_name.into_values().collect();
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}

/// 从 SKILL.md 文本解析描述：frontmatter（`---` 包裹）里的 `description:` 值；
/// 无 frontmatter 时取第一个非空行作为兜底描述。
fn parse_description(text: &str) -> String {
    let trimmed = text.trim_start();
    if let Some(rest) = trimmed.strip_prefix("---") {
        // frontmatter 内逐行找 `description:`（简单键值，不引 YAML 依赖）。
        for line in rest.lines() {
            let line = line.trim();
            if line == "---" {
                break;
            }
            if let Some(value) = line.strip_prefix("description:") {
                return value
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string();
            }
        }
        String::new()
    } else {
        text.lines()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("")
            .trim()
            .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// HOME 是进程全局，两个用例串行（cargo test 默认并行，不设锁会互相踩）。
    static HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// 隔离 HOME 与配置环境的临时夹具（多测串行：env 是进程全局）。
    struct EnvGuard {
        previous_home: Option<std::ffi::OsString>,
    }
    impl EnvGuard {
        fn new(home: &Path) -> Self {
            let previous_home = std::env::var_os("HOME");
            std::env::set_var("HOME", home);
            Self { previous_home }
        }
    }
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.previous_home {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }
    }

    fn tmpdir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lumir-harness-ctx-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn skills_vault_wide_overrides_user_wide() {
        let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = tmpdir("home");
        let vault = tmpdir("vault");
        let _guard = EnvGuard::new(&home);
        fs::create_dir_all(home.join(".agents/skills/demo-skill")).unwrap();
        fs::write(
            home.join(".agents/skills/demo-skill/SKILL.md"),
            "---\ndescription: user demo-skill\n---\nbody",
        )
        .unwrap();
        fs::create_dir_all(vault.join(".agents/skills/demo-skill")).unwrap();
        fs::write(
            vault.join(".agents/skills/demo-skill/SKILL.md"),
            "---\ndescription: vault demo-skill\n---\nbody",
        )
        .unwrap();
        fs::create_dir_all(vault.join(".agents/skills/notes")).unwrap();
        fs::write(
            vault.join(".agents/skills/notes/SKILL.md"),
            "no frontmatter\nbody",
        )
        .unwrap();

        let skills = discover_skills(&vault);
        assert_eq!(skills.len(), 2);
        let demo = skills.iter().find(|s| s.name == "demo-skill").unwrap();
        assert_eq!(demo.description, "vault demo-skill");
        assert!(demo.dir.starts_with(&vault));
        let notes = skills.iter().find(|s| s.name == "notes").unwrap();
        assert_eq!(notes.description, "no frontmatter");
    }

    #[test]
    fn quote_reference_covers_both_excerpt_forms() {
        // 两种摘录元素的回指纪律同属一段固定文案（change harness-message-excerpt design §4
        // prompt 层）：文档摘录按 heading/lines 消歧、消息摘录按 role/at 消歧，两者都无编号。
        // 直接对常量断言（不经 assemble_system）——避免与 HOME 全局的环境锁纠缠。
        assert!(
            QUOTE_REFERENCE.contains("<quote file=\"…\""),
            "{QUOTE_REFERENCE}"
        );
        assert!(
            QUOTE_REFERENCE.contains("<msg-quote role=\"…\""),
            "{QUOTE_REFERENCE}"
        );
        assert!(QUOTE_REFERENCE.contains("at=\"…\""), "{QUOTE_REFERENCE}");
        // role 的两档语义与 at 的取值口径要写清（agent 才知道怎么回指与消歧）。
        assert!(
            QUOTE_REFERENCE.contains("user = 用户自己的消息"),
            "{QUOTE_REFERENCE}"
        );
        assert!(
            QUOTE_REFERENCE.contains("assistant = 你此前的回复"),
            "{QUOTE_REFERENCE}"
        );
        assert!(QUOTE_REFERENCE.contains("ISO 8601"), "{QUOTE_REFERENCE}");
        assert!(
            QUOTE_REFERENCE.contains("会话历史消息"),
            "{QUOTE_REFERENCE}"
        );
        // 回指纪律：按角色与时间消歧 + 不用编号。
        assert!(
            QUOTE_REFERENCE.contains("用角色与时间消歧"),
            "{QUOTE_REFERENCE}"
        );
        assert!(
            QUOTE_REFERENCE.contains("不要使用编号"),
            "{QUOTE_REFERENCE}"
        );
    }

    #[test]
    fn path_reference_covers_reference_discipline() {
        // 路径引用纪律（change harness-path-link design §7）：让模型的写法可被面板识别——
        // 完整相对路径 + 扩展名、`:行号`、只引用工具结果里出现过的路径、不用 Markdown 链接语法。
        // 直接对常量断言（不经 assemble_system）——避免与 HOME 全局的环境锁纠缠。
        assert!(
            PATH_REFERENCE.contains("完整的 vault 相对路径"),
            "{PATH_REFERENCE}"
        );
        assert!(PATH_REFERENCE.contains("扩展名"), "{PATH_REFERENCE}");
        assert!(PATH_REFERENCE.contains(":行号"), "{PATH_REFERENCE}");
        assert!(
            PATH_REFERENCE.contains("只引用工具结果里真实出现过的路径"),
            "{PATH_REFERENCE}"
        );
        assert!(
            PATH_REFERENCE.contains("不要用 Markdown 链接语法"),
            "{PATH_REFERENCE}"
        );
        // 目录的写法要单独说清（目录不链接化，写清是目录才不误导读者）。
        assert!(
            PATH_REFERENCE.contains("引用目录时说清它是目录"),
            "{PATH_REFERENCE}"
        );
    }

    #[test]
    fn assemble_system_skips_missing_agents_and_includes_index() {
        let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = tmpdir("home2");
        let vault = tmpdir("vault2");
        let _guard = EnvGuard::new(&home);
        fs::create_dir_all(home.join(".agents")).unwrap();
        fs::write(home.join(".agents/AGENTS.md"), "user rules").unwrap();
        fs::write(vault.join("AGENTS.md"), "vault rules").unwrap();
        fs::create_dir_all(vault.join(".agents/skills/x")).unwrap();
        fs::write(
            vault.join(".agents/skills/x/SKILL.md"),
            "---\ndescription: xd\n---\n",
        )
        .unwrap();

        let assembled = assemble_system(&vault);
        let system = assembled.text;
        assert!(system.contains("user rules"), "{system}");
        assert!(system.contains("vault rules"), "{system}");
        assert!(system.contains("- x: xd"), "{system}");
        assert!(system.contains("Lumir 的内置助手"), "{system}");
        // 摘录回指纪律是固定段（不依赖 vault 内容，M343）：协议无编号、按内容/出处回指。
        assert!(system.contains("<quote file=\"…\""), "{system}");
        assert!(system.contains("不要使用编号"), "{system}");
        // 消息摘录同属这一固定段（M423，change harness-message-excerpt）：两种元素一处注入，
        // 两个 provider 因此同时拿到。
        assert!(system.contains("<msg-quote role=\"…\""), "{system}");
        // 路径引用纪律是第三个固定段（change harness-path-link）：注入文本里可读，
        // 判据取纪律的核心句而不是整段（文案可迭代，口径不变）。
        assert!(system.contains("路径引用的纪律"), "{system}");
        assert!(system.contains("完整的 vault 相对路径"), "{system}");
        assert!(system.contains("不要用 Markdown 链接语法"), "{system}");
        // 装配清单：七个来源全在场，三层 AGENTS 指令文件各记路径与存在与否，skill_index 记数量。
        let manifest = &assembled.manifest;
        assert_eq!(manifest.len(), 7, "{manifest:?}");
        let by_source = |s: &str| manifest.iter().find(|m| m.source == s).unwrap();
        // 固定段（change `harness-prompt-files`）：path 指向仓内来源文件，bytes 为注入
        // （trim 后）文本的字节数。
        let identity = by_source("identity");
        assert!(identity.exists, "{identity:?}");
        assert_eq!(
            identity.path.as_deref(),
            Some(IDENTITY_PATH),
            "{identity:?}"
        );
        assert_eq!(identity.bytes, IDENTITY.trim_end().len() as u64);
        let quote = by_source("quote_reference");
        assert!(quote.exists, "{quote:?}");
        assert_eq!(
            quote.path.as_deref(),
            Some(QUOTE_REFERENCE_PATH),
            "{quote:?}"
        );
        assert_eq!(quote.bytes, QUOTE_REFERENCE.trim_end().len() as u64);
        // 路径引用纪律（change harness-path-link）：与摘录回指同口径——仓内来源路径 + trim 后字节数。
        let path_ref = by_source("path_reference");
        assert!(path_ref.exists, "{path_ref:?}");
        assert_eq!(
            path_ref.path.as_deref(),
            Some(PATH_REFERENCE_PATH),
            "{path_ref:?}"
        );
        assert_eq!(path_ref.bytes, PATH_REFERENCE.trim_end().len() as u64);
        let user = by_source("agents_user_wide");
        assert!(user.path.as_deref().unwrap().ends_with(".agents/AGENTS.md"));
        assert!(user.exists && user.bytes == 10, "{user:?}"); // "user rules"
        let vault_src = by_source("agents_vault_root");
        assert!(vault_src.path.as_deref().unwrap().ends_with("AGENTS.md"));
        assert!(vault_src.exists && vault_src.bytes == 11, "{vault_src:?}"); // "vault rules"
                                                                             // 本地覆盖层缺失（vault 根无 AGENTS.local.md）同样在场：exists:false、bytes 0。
        let vault_local = by_source("agents_vault_root_local");
        assert!(vault_local
            .path
            .as_deref()
            .unwrap()
            .ends_with("AGENTS.local.md"));
        assert!(
            !vault_local.exists && vault_local.bytes == 0,
            "{vault_local:?}"
        );
        let skills = by_source("skill_index");
        assert_eq!(skills.skills, Some(1));
        assert!(skills.exists && skills.bytes > 0, "{skills:?}");

        // 换到「空 HOME」+ 无 AGENTS.md / 无 skills 的 vault：三层与索引静默跳过，
        // 只剩 identity + 摘录回指纪律 + 路径引用纪律三个固定段；清单如实记 exists:false。
        let home3 = tmpdir("home3");
        std::env::set_var("HOME", &home3);
        let vault3 = tmpdir("vault3");
        let assembled = assemble_system(&vault3);
        let system = assembled.text;
        assert!(!system.contains("user rules"), "{system}");
        assert!(!system.contains("vault rules"), "{system}");
        assert!(system.contains("引用摘录的纪律"), "{system}");
        assert!(system.contains("路径引用的纪律"), "{system}");
        assert_eq!(assembled.manifest.len(), 7);
        assert!(
            !assembled.manifest[3].exists,
            "user-wide 缺失须记 exists:false"
        );
        assert!(
            !assembled.manifest[4].exists,
            "vault 根缺失须记 exists:false"
        );
        assert!(
            !assembled.manifest[5].exists,
            "本地覆盖层缺失须记 exists:false"
        );
        assert_eq!(assembled.manifest[6].skills, Some(0));
        assert!(!assembled.manifest[6].exists);
    }

    /// 三层齐备（change `harness-agents-local-md` design §4-1）：三份文件内容都在文本中、
    /// 本地层内容下标晚于 vault 根 AGENTS.md 内容（顺序不变量）、清单第六项 path/exists/bytes 正确。
    #[test]
    fn assemble_system_injects_agents_local_after_vault_root() {
        let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = tmpdir("home-local");
        let vault = tmpdir("vault-local");
        let _guard = EnvGuard::new(&home);
        fs::create_dir_all(home.join(".agents")).unwrap();
        fs::write(home.join(".agents/AGENTS.md"), "user rules").unwrap();
        fs::write(vault.join("AGENTS.md"), "vault rules").unwrap();
        fs::write(vault.join("AGENTS.local.md"), "local override rules").unwrap();

        let assembled = assemble_system(&vault);
        let system = assembled.text;
        assert!(system.contains("user rules"), "{system}");
        assert!(system.contains("vault rules"), "{system}");
        assert!(system.contains("local override rules"), "{system}");
        // 覆盖语义的可读载体：本地层节标题显式声明「冲突时以此为准」。
        assert!(
            system.contains("本机本地覆盖层，与上文 AGENTS.md 冲突时以此为准"),
            "{system}"
        );
        // 顺序不变量：本地层内容排在 vault 根 AGENTS.md 内容之后。
        let root_at = system.find("vault rules").unwrap();
        let local_at = system.find("local override rules").unwrap();
        assert!(root_at < local_at, "{system}");

        assert_eq!(assembled.manifest.len(), 7, "{:?}", assembled.manifest);
        let local = assembled
            .manifest
            .iter()
            .find(|m| m.source == "agents_vault_root_local")
            .unwrap();
        assert!(local.path.as_deref().unwrap().ends_with("AGENTS.local.md"));
        assert!(local.exists, "{local:?}");
        assert_eq!(
            local.bytes,
            "local override rules".len() as u64,
            "{local:?}"
        );
    }

    /// 本地层缺失静默跳过（change `harness-agents-local-md` design §4-2）：其余两层照常注入，
    /// 文本不含本地层内容；清单条目仍在场且记 exists:false / bytes 0。
    #[test]
    fn assemble_system_skips_missing_agents_local_silently() {
        let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = tmpdir("home-no-local");
        let vault = tmpdir("vault-no-local");
        let _guard = EnvGuard::new(&home);
        fs::create_dir_all(home.join(".agents")).unwrap();
        fs::write(home.join(".agents/AGENTS.md"), "user rules").unwrap();
        fs::write(vault.join("AGENTS.md"), "vault rules").unwrap();

        let assembled = assemble_system(&vault);
        let system = assembled.text;
        assert!(system.contains("user rules"), "{system}");
        assert!(system.contains("vault rules"), "{system}");
        assert!(!system.contains("本机本地覆盖层"), "{system}");
        assert_eq!(assembled.manifest.len(), 7);
        let local = assembled
            .manifest
            .iter()
            .find(|m| m.source == "agents_vault_root_local")
            .unwrap();
        assert!(!local.exists, "{local:?}");
        assert_eq!(local.bytes, 0, "{local:?}");
    }

    /// FNV-1a 64（迁移基线指纹用）。
    fn fnv1a64(bytes: &[u8]) -> u64 {
        let mut hash: u64 = 0xcbf29ce484222325;
        for byte in bytes {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash
    }

    /// 固定段字节指纹（change `harness-prompt-files`）：常量取自迁移前（master `81e4db01`）
    /// `IDENTITY` / `QUOTE_REFERENCE` 字面量 trim 后的字节。**有意改 `prompts/*.md` 就是改注入
    /// 文本**——失败信息给出实测 (hash, len)，确认是预期改动后用实测值更新此处常量；不要绕过。
    #[test]
    fn fixed_segments_keep_migrated_bytes() {
        let identity = IDENTITY.trim_end();
        let quote = QUOTE_REFERENCE.trim_end();
        assert_eq!(
            (
                fnv1a64(identity.as_bytes()),
                identity.len(),
                fnv1a64(quote.as_bytes()),
                quote.len(),
            ),
            (0xb92eb692300af983, 1345, 0x05cba54b785b843b, 1170),
        );
    }

    /// 清单里的仓内相对路径必须真的指到嵌入的源文件（双向 grep 可达的机器判据）：
    /// 路径常量非绝对、按 `CARGO_MANIFEST_DIR` 解析后在盘上存在，且 `trim_end()` 后与
    /// 嵌入文本一致。文件被改名 / 挪位时 `include_str!` 会先编译失败，这里钉住路径常量不漂。
    #[test]
    fn fixed_segments_are_sourced_from_prompt_files() {
        for (path, embedded) in [
            (IDENTITY_PATH, IDENTITY),
            (QUOTE_REFERENCE_PATH, QUOTE_REFERENCE),
            (PATH_REFERENCE_PATH, PATH_REFERENCE),
        ] {
            assert!(
                !path.starts_with('/') && !path.starts_with(".."),
                "清单路径须为仓内相对路径：{path}"
            );
            let crate_relative = path.strip_prefix("src-tauri/").unwrap_or(path);
            let on_disk = Path::new(env!("CARGO_MANIFEST_DIR")).join(crate_relative);
            let file = fs::read_to_string(&on_disk).unwrap_or_else(|e| panic!("{on_disk:?}: {e}"));
            assert_eq!(file.trim_end(), embedded.trim_end(), "{path}");
        }
    }

    /// 固定段顺序与拼接格式（顺序是代码逻辑，change `harness-prompt-files`）：空环境里装配
    /// 结果恰好是 identity + 摘录回指纪律 + 路径引用纪律三节（change `harness-path-link` 把
    /// 路径段追加在摘录段之后）——不随 `prompts/` 目录内容 / 枚举顺序变化，且文件尾换行不进入
    /// 注入文本（输出不以换行结尾）。
    #[test]
    fn assemble_system_fixed_prefix_is_identity_then_quote_reference() {
        let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = tmpdir("home-fixed-prefix");
        let vault = tmpdir("vault-fixed-prefix");
        let _guard = EnvGuard::new(&home);
        let assembled = assemble_system(&vault);
        let expected = format!(
            "{}\n\n===== 引用摘录的回指纪律 =====\n{}\n\n===== 路径引用的纪律 =====\n{}",
            IDENTITY.trim_end(),
            QUOTE_REFERENCE.trim_end(),
            PATH_REFERENCE.trim_end()
        );
        assert_eq!(assembled.text, expected);
    }
}
