//! 系统上下文装配（design §5、§12）：固定身份段 + AGENTS.md 双层 + Skill 索引。
//!
//! - 固定身份段：v1 不做 persona 系统（裁决点 7），固定朴素身份 + 工具使用纪律。
//! - AGENTS.md 双层：user-wide（`~/.agents/AGENTS.md`）+ vault 根（`<vault>/AGENTS.md`），
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

/// 固定身份段（裁决点 7：v1 无 persona 系统，行为定制走 AGENTS.md + Skill）。
const IDENTITY: &str = "\
你是 Lumir 的内置助手，工作在当前打开的 vault 里。你可以读取 vault 内文件、搜索内容、\
经局部 patch 修改既有文档、新建文档、加载 Skill、并在批准后执行命令行工具。

工具使用纪律：
- 修改既有文档只有 vault_patch 一种方式：old_string 必须在目标文件里恰好命中一次，\
失败会拿到错误，按错误信息调整后重试。
- 新建文档用 vault_create：父目录必须已存在，不会覆盖同名文件。
- vault_read / vault_search 是只读工具，可直接使用；vault_search 的 query 是普通子串（非正则）。
- skill_load 按技能名加载 Skill 全文；外部能力（如联网搜索）= 对应 Skill + cli_run。
- 写入类工具与 cli_run 默认需要用户批准，被拒绝时按拒绝原因调整方案。

回答使用与提问相同的语言；技术名词保留原文。";

/// 装配完整系统上下文（identity + AGENTS.md 双层 + Skill 索引）。
pub fn assemble_system(vault_root: &Path) -> String {
    let mut out = String::from(IDENTITY);
    if let Some(user_agents) = read_agents_md(&user_agents_path()) {
        push_section(
            &mut out,
            "user-wide AGENTS.md（~/.agents/AGENTS.md）",
            &user_agents,
        );
    }
    if let Some(vault_agents) = read_agents_md(&vault_root.join("AGENTS.md")) {
        push_section(&mut out, "vault 根 AGENTS.md", &vault_agents);
    }
    let skills = discover_skills(vault_root);
    if !skills.is_empty() {
        let mut index = String::new();
        for skill in &skills {
            index.push_str(&format!("- {}: {}\n", skill.name, skill.description));
        }
        push_section(
            &mut out,
            "可用 Skill 索引（skill_load 按名加载全文）",
            index.trim_end(),
        );
    }
    out
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
        fs::create_dir_all(home.join(".agents/skills/tavily")).unwrap();
        fs::write(
            home.join(".agents/skills/tavily/SKILL.md"),
            "---\ndescription: user tavily\n---\nbody",
        )
        .unwrap();
        fs::create_dir_all(vault.join(".agents/skills/tavily")).unwrap();
        fs::write(
            vault.join(".agents/skills/tavily/SKILL.md"),
            "---\ndescription: vault tavily\n---\nbody",
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
        let tavily = skills.iter().find(|s| s.name == "tavily").unwrap();
        assert_eq!(tavily.description, "vault tavily");
        assert!(tavily.dir.starts_with(&vault));
        let notes = skills.iter().find(|s| s.name == "notes").unwrap();
        assert_eq!(notes.description, "no frontmatter");
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

        let system = assemble_system(&vault);
        assert!(system.contains("user rules"), "{system}");
        assert!(system.contains("vault rules"), "{system}");
        assert!(system.contains("- x: xd"), "{system}");
        assert!(system.contains("Lumir 的内置助手"), "{system}");

        // 换到「空 HOME」+ 无 AGENTS.md / 无 skills 的 vault：全部静默跳过，不报错。
        let home3 = tmpdir("home3");
        std::env::set_var("HOME", &home3);
        let vault3 = tmpdir("vault3");
        let system = assemble_system(&vault3);
        assert!(!system.contains("====="), "{system}");
    }
}
