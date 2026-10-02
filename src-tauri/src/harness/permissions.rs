//! 权限机制（design §6，裁决点 5）：三层规则表判定，deny > allow > 默认分层。
//!
//! - 默认分层：**读类**（vault_read / vault_search / skill_load）= allow；**写类**
//!   （vault_patch / vault_create）与 **cli_run** = ask（批准闸）。
//! - 规则语法：tool 级（`vault_patch`）或 tool(模式) 级（`cli(tavily *)`）。模式匹配对
//!   **主体串**做前缀 + `*` 通配：模式以 `*` 结尾 ⇒ `subject.starts_with(模式去 *)`；
//!   否则整串相等。主体串的取法：cli_run = `command arg1 arg2 …`（空格拼接）；
//!   vault_* / skill_load = 第一个路径参数原文。
//! - 判定顺序：deny 全表先扫（任一命中即 Deny）→ allow 全表（任一命中即 Allow）→
//!   默认分层。deny 命中**直接拒绝并回送模型**，不进批准闸。
//!
//! 规则的**形状**校验在 config 层（M301，逐项丢弃非字符串）；这里只判语义。
//! 解析不了的规则（如 `cli(` 括号不配对）静默不匹配——配置层已保证基本形状，
//! 不在这里发明第二条报错通道。

use crate::config::HarnessPermissions;

/// 判定结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Ask,
    Deny,
}

/// 读类工具：默认 allow。
const READ_TOOLS: [&str; 3] = ["vault_read", "vault_search", "skill_load"];

/// 判定一次工具调用。
///
/// `subject`：模式匹配的主体串（cli 为拼接 argv，vault 工具为路径参数）。
pub fn decide(permissions: &HarnessPermissions, tool: &str, subject: &str) -> Decision {
    if matches_rule(&permissions.deny, tool, subject) {
        return Decision::Deny;
    }
    if matches_rule(&permissions.allow, tool, subject) {
        return Decision::Allow;
    }
    if READ_TOOLS.contains(&tool) {
        Decision::Allow
    } else {
        Decision::Ask
    }
}

/// 规则清单任一条命中即 true。
fn matches_rule(rules: &[String], tool: &str, subject: &str) -> bool {
    rules.iter().any(|rule| rule_matches(rule, tool, subject))
}

/// 单条规则匹配：tool 级等值，或 `tool(模式)` 的 subject 前缀 / 等值匹配。
fn rule_matches(rule: &str, tool: &str, subject: &str) -> bool {
    match parse_rule(rule) {
        ParsedRule::Tool(name) => canonical_tool(name) == tool,
        ParsedRule::Pattern {
            tool: name,
            pattern,
        } => {
            if canonical_tool(name) != tool {
                return false;
            }
            match pattern.strip_suffix('*') {
                Some(prefix) => subject.starts_with(prefix),
                None => subject == pattern,
            }
        }
        ParsedRule::Unparsable => false,
    }
}

/// 规则语法里的工具名 → 实际工具名。design §6 的规则示例用 `cli(tavily *)` 这种
/// 写法——规则层的工具名是 `cli`，实际工具是 `cli_run`。只收这一个文档化别名，
/// 不发明一般性的前缀匹配（那会让 `vault` 意外命中 `vault_patch` 与 `vault_read`）。
fn canonical_tool(name: &str) -> &str {
    if name == "cli" {
        "cli_run"
    } else {
        name
    }
}

enum ParsedRule<'a> {
    Tool(&'a str),
    Pattern { tool: &'a str, pattern: &'a str },
    Unparsable,
}

/// 规则语法解析：`tool` 或 `tool(模式)`；括号须配对且模式非空，否则 Unparsable。
fn parse_rule(rule: &str) -> ParsedRule<'_> {
    let rule = rule.trim();
    if let Some(open) = rule.find('(') {
        if !rule.ends_with(')') || open == 0 {
            return ParsedRule::Unparsable;
        }
        let pattern = &rule[open + 1..rule.len() - 1];
        if pattern.trim().is_empty() {
            return ParsedRule::Unparsable;
        }
        ParsedRule::Pattern {
            tool: rule[..open].trim(),
            pattern,
        }
    } else if rule.is_empty() {
        ParsedRule::Unparsable
    } else {
        ParsedRule::Tool(rule)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn perms(allow: &[&str], deny: &[&str]) -> HarnessPermissions {
        HarnessPermissions {
            allow: allow.iter().map(|s| s.to_string()).collect(),
            deny: deny.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn default_layering_read_allow_write_ask() {
        let p = HarnessPermissions::default();
        assert_eq!(decide(&p, "vault_read", "a.md"), Decision::Allow);
        assert_eq!(decide(&p, "vault_search", "q"), Decision::Allow);
        assert_eq!(decide(&p, "skill_load", "tavily"), Decision::Allow);
        assert_eq!(decide(&p, "vault_patch", "a.md"), Decision::Ask);
        assert_eq!(decide(&p, "vault_create", "b.md"), Decision::Ask);
        assert_eq!(decide(&p, "cli_run", "ls -la"), Decision::Ask);
    }

    #[test]
    fn deny_beats_allow_and_default() {
        let p = perms(&["cli(tavily *)"], &["cli(tavily *)"]);
        assert_eq!(decide(&p, "cli_run", "tavily search x"), Decision::Deny);
        // deny 命中即拒绝，即使默认分层是 allow 的工具
        let p = perms(&[], &["vault_read"]);
        assert_eq!(decide(&p, "vault_read", "a.md"), Decision::Deny);
    }

    #[test]
    fn allow_rule_skips_gate() {
        let p = perms(&["cli(tavily *)"], &[]);
        assert_eq!(decide(&p, "cli_run", "tavily search x"), Decision::Allow);
        assert_eq!(decide(&p, "cli_run", "rm -rf /"), Decision::Ask);
        let p = perms(&["vault_patch"], &[]);
        assert_eq!(decide(&p, "vault_patch", "a.md"), Decision::Allow);
    }

    #[test]
    fn pattern_prefix_star_matching() {
        let p = perms(&["cli(ls *)"], &[]);
        assert_eq!(decide(&p, "cli_run", "ls -la"), Decision::Allow);
        assert_eq!(decide(&p, "cli_run", "ls"), Decision::Ask); // 模式带空格前缀，"ls" 不命中
        let p = perms(&["cli(npm run *)"], &[]);
        assert_eq!(decide(&p, "cli_run", "npm run test"), Decision::Allow);
        assert_eq!(decide(&p, "cli_run", "npm install"), Decision::Ask);
    }

    #[test]
    fn tool_level_rule_blocks_all_subjects() {
        let p = perms(&[], &["cli_run"]);
        assert_eq!(decide(&p, "cli_run", "anything at all"), Decision::Deny);
    }

    #[test]
    fn unparsable_rules_never_match() {
        let p = perms(&["cli(", "()", "vault_read()"], &["(unbalanced"]);
        assert_eq!(decide(&p, "cli_run", "ls"), Decision::Ask);
        assert_eq!(decide(&p, "vault_read", "a.md"), Decision::Allow);
    }

    #[test]
    fn pattern_applies_to_path_subject_for_vault_tools() {
        // 用写工具测：读工具默认就是 allow，分不出「规则命中」与「默认放行」。
        let p = perms(&["vault_patch(docs/*)"], &[]);
        assert_eq!(decide(&p, "vault_patch", "docs/a.md"), Decision::Allow);
        assert_eq!(decide(&p, "vault_patch", "notes/a.md"), Decision::Ask);
    }
}
