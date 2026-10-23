//! 会话内批准缓存（change add-harness-permission-modes，design §6；change
//! harness-permission-rules-oct23 A3 起 `cli_run` 按**命令前缀**记忆）。
//!
//! - **键**：`(工具名, 自描述键)`——**尾随空格 = 前缀键**（`"tvly search "`，词边界前缀
//!   判定），否则是精确键（vault 工具的 `path` 原文，全等判定）。`cli_run` 的键由
//!   [`super::permissions::permission_prefix`] 生成（与持久规则共用同一个生成器）。
//! - **命名空间**：`(vault 根, session id)`。命名空间一变即整表清空——「新会话」/ 切 vault 切
//!   会话 / app 重启清空是同一件事的同一个机制（重启 = 进程内的静态态全新），不需要在每个
//!   重置点各挂一支清理钩子（少一处必然漏挂的联动）。压缩续聊开新逻辑会话时会换留存文件、
//!   因而换 session id，同样自然清空。
//! - **不落盘**：纯内存态，不进 JSONL（JSONL 只记批准 sidecar；本缓存是免问索引）。
//! - **不解锁三层**：缓存只在判定管线第 5 层（模式默认分层）短路——deny 规则 / vault 内写
//!   重定向 / 危险黑名单永远先于它（[`super::permissions::decide`] 里的先后顺序即契约）。
//!   缓存命中把模式层判成 Allow：用户在更宽的档位显式给过授权，其后切到更严的档位不回收
//!   已给的会话内授权（与「turn 停止不回收已批准决定」同侧，design §6 边界条）。
//! - **与持久规则彼此独立**：命中缓存不写配置，持久规则命中不写缓存。
//!
//! 写入 transport（`ApprovalDecision.remember` → `harness_approve` 的 remember 参数 →
//! [`super::turn`] 的 gated_execute 在 approved && remember 时调 [`remember`]）M413 已落地；
//! 本 module 提供 [`remember`] / [`is_remembered`]，由判定层与工具循环接线。
//!
//! 模块声明在 `harness.rs` 的模块表（M413 收编：此前为 `permissions.rs` 的 `#[path]` 临时声明）。

use std::collections::HashSet;
use std::sync::Mutex;

/// 缓存命名空间：vault 根 + 会话 id（留存文件名）。二者任一变化即整表清空。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Namespace {
    pub vault: String,
    pub session: String,
}

impl Namespace {
    pub fn new(vault: impl Into<String>, session: impl Into<String>) -> Self {
        Self {
            vault: vault.into(),
            session: session.into(),
        }
    }
}

#[derive(Debug, Default)]
struct CacheState {
    namespace: Option<Namespace>,
    entries: HashSet<(String, String)>,
}

/// 进程内单例（内存态一个 vault 一个活跃会话是运行时的既有形态，见 `harness.rs` 模块头）。用
/// `Mutex<Option<CacheState>>` 而非多命名空间表：命名空间一变就整表换掉，正是「切会话即清空」
/// 的语义，顺带把内存占用封在一个会话的量级。（`Option` 而非直接 `CacheState`：`static` 里的
/// 初始化表达式必须是 const，`HashSet::new()` 不是。）
static CACHE: Mutex<Option<CacheState>> = Mutex::new(None);

/// 规范化主体串（design §6 的键口径）：多空格 / 制表折叠为一个空格 + 首尾 trim。
/// cli_run 的拼接 argv 直接过它；vault 工具传 `path` 原文（通常不变）。
pub fn normalize_subject(subject: &str) -> String {
    subject.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 缓存命中？命中即第 5 层短路（见模块头）。
///
/// 键的形态自描述（A3）：尾随空格 = 词边界前缀键（`cli_run`），其余为精确键（vault 工具）。
/// 前缀判定与持久规则共用 [`crate::harness::permissions::word_prefix_matches`]。
pub fn is_remembered(namespace: &Namespace, tool: &str, subject: &str) -> bool {
    let subject = normalize_subject(subject);
    let mut guard = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let state = state_for(&mut guard, namespace);
    state.entries.iter().any(|(entry_tool, key)| {
        entry_tool == tool
            && if key.ends_with(' ') {
                crate::harness::permissions::word_prefix_matches(key, &subject)
            } else {
                key == &subject
            }
    })
}

/// 记一条会话内免问（用户显式点了「采纳且本会话不再问」才调——点普通采纳 MUST NOT 记）。
///
/// `key` 由 [`crate::harness::permissions::permission_prefix`] 生成：前缀键带尾随空格、
/// 精确键是主体串原文。内容的空白规范化照旧，但**尾随空格的标记必须保留**——它是前缀键与
/// 精确键的唯一区分。
pub fn remember(namespace: &Namespace, tool: &str, key: &str) {
    let key = if key.ends_with(' ') {
        format!("{} ", normalize_subject(key.trim_end()))
    } else {
        normalize_subject(key)
    };
    let mut guard = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    state_for(&mut guard, namespace)
        .entries
        .insert((tool.to_string(), key));
}

/// 清空（显式重置 / 测试用；命名空间切换由 [`state_for`] 自动完成）。
pub fn clear() {
    let mut guard = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    *guard = None;
}

/// 取当前命名空间的状态；命名空间不同即整表换新（切会话 / 切 vault / 重启的同一机制）。
fn state_for<'a>(guard: &'a mut Option<CacheState>, namespace: &Namespace) -> &'a mut CacheState {
    let stale = match guard.as_ref() {
        Some(state) => state.namespace.as_ref() != Some(namespace),
        None => true,
    };
    if stale {
        *guard = Some(CacheState {
            namespace: Some(namespace.clone()),
            entries: HashSet::new(),
        });
    }
    guard.as_mut().expect("刚刚填过")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 缓存是进程内单例，测试并行跑会互相踩——同一把锁把所有缓存用例串起来。
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn prefix_key_covers_same_command_family() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear();
        let ns = Namespace::new("/vault/a", "s1");
        // `cli_run` 的前缀键带尾随空格（permission_prefix 生成）。
        remember(&ns, "cli_run", "tvly search ");
        assert!(is_remembered(&ns, "cli_run", "tvly search 另一个问题"));
        // 等值形态（无参数）同样命中——词边界前缀的等值容差(Q2)。
        assert!(is_remembered(&ns, "cli_run", "tvly search"));
        // 不同前缀不命中。
        assert!(!is_remembered(&ns, "cli_run", "tvly save x"));
        // 词边界不放宽：紧贴前缀（无空格）不算同族。
        assert!(!is_remembered(&ns, "cli_run", "tvly searchx"));
        // 工具名是键的一部分。
        assert!(!is_remembered(&ns, "vault_patch", "tvly search x"));
        clear();
    }

    #[test]
    fn exact_key_stays_exact_for_vault_tools() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear();
        let ns = Namespace::new("/vault/a", "s1");
        remember(&ns, "vault_patch", "notes/a.md");
        assert!(is_remembered(&ns, "vault_patch", "notes/a.md"));
        // 精确键不做前缀泛化（会话内不放宽路径）。
        assert!(!is_remembered(&ns, "vault_patch", "notes/b.md"));
        assert!(!is_remembered(&ns, "vault_patch", "notes/a.md.bak"));
        // 空白规范化照旧（主体串来自 argv 拼接，多空格折叠）。
        assert!(is_remembered(&ns, "vault_patch", "  notes/a.md  "));
        clear();
    }

    #[test]
    fn namespace_change_clears_the_whole_cache() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear();
        let first = Namespace::new("/vault/a", "s1");
        remember(&first, "cli_run", "npm install");
        assert!(is_remembered(&first, "cli_run", "npm install"));

        // 新会话（同 vault、新 session id）⇒ 清空。
        let second = Namespace::new("/vault/a", "s2");
        assert!(!is_remembered(&second, "cli_run", "npm install"));
        // 切 vault 同理。
        remember(&second, "cli_run", "npm install");
        let third = Namespace::new("/vault/b", "s3");
        assert!(!is_remembered(&third, "cli_run", "npm install"));
        // 切回旧命名空间也不复得（表已被后续命名空间换掉）。
        assert!(!is_remembered(&first, "cli_run", "npm install"));
        clear();
    }

    #[test]
    fn normalize_collapses_whitespace() {
        assert_eq!(normalize_subject("  npm   install\n-x "), "npm install -x");
        assert_eq!(normalize_subject(""), "");
        assert_eq!(normalize_subject("a\tb"), "a b");
    }
}
