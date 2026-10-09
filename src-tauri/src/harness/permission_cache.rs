//! 会话内批准缓存（change add-harness-permission-modes，design §6）：用户逐次显式给出的
//! 「采纳且本会话不再问」的运行时索引。
//!
//! - **键**：`(工具名, 规范化主体串)`——cli_run 主体串 = 拼接 argv（多空格折叠 + 首尾 trim），
//!   vault 工具 = `path` 原文。精确串匹配，**不做前缀泛化**（前缀泛化等于悄悄放大授权面）。
//! - **命名空间**：`(vault 根, session id)`。命名空间一变即整表清空——「新会话」/ 切 vault 切
//!   会话 / app 重启清空是同一件事的同一个机制（重启 = 进程内的静态态全新），不需要在每个
//!   重置点各挂一支清理钩子（少一处必然漏挂的联动）。压缩续聊开新逻辑会话时会换留存文件、
//!   因而换 session id，同样自然清空。
//! - **不落盘**：纯内存态，不进 JSONL（JSONL 只记批准 sidecar；本缓存是免问索引）。
//! - **不解锁三层**：缓存只在判定管线第 5 层（模式默认分层）短路——deny 规则 / vault 内写
//!   重定向 / 危险黑名单永远先于它（[`super::permissions::decide`] 里的先后顺序即契约）。
//!   缓存命中把模式层判成 Allow：用户在更宽的档位显式给过授权，其后切到更严的档位不回收
//!   已给的会话内授权（与「turn 停止不回收已批准决定」同侧，design §6 边界条）。
//!
//! 写入点（前端次级动作的 transport）**不在本批**：`ApprovalDecision` / `harness_approve`
//! 的参数表在别的落点，本 module 只提供 [`remember`] / [`is_remembered`]，由接线方调用。
//!
//! 模块声明**临时**挂在 `permissions.rs` 的 `#[path]` 形式下（本批不写 `harness.rs`，它归
//! 面板批次 mission）；后续批次收编时应迁回 `harness.rs` 的模块表。

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

/// 进程内单例（一个 vault 一个会话是运行时的既有形态，见 `harness.rs` 模块头）。用
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
pub fn is_remembered(namespace: &Namespace, tool: &str, subject: &str) -> bool {
    let key = (tool.to_string(), normalize_subject(subject));
    let mut guard = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let state = state_for(&mut guard, namespace);
    state.entries.contains(&key)
}

/// 记一条会话内免问（用户显式点了「采纳且本会话不再问」才调——点普通采纳 MUST NOT 记）。
pub fn remember(namespace: &Namespace, tool: &str, subject: &str) {
    let key = (tool.to_string(), normalize_subject(subject));
    let mut guard = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    state_for(&mut guard, namespace).entries.insert(key);
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
    fn same_subject_is_remembered_once_and_exact_only() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear();
        let ns = Namespace::new("/vault/a", "s1");
        assert!(!is_remembered(&ns, "cli_run", "npm install"));
        remember(&ns, "cli_run", "npm install");
        assert!(is_remembered(&ns, "cli_run", "npm install"));
        // 规范化：多空格 / 首尾空白命中同一条。
        assert!(is_remembered(&ns, "cli_run", "  npm   install  "));
        // 精确匹配，不做前缀泛化：更宽的串不命中。
        assert!(!is_remembered(&ns, "cli_run", "npm install --save"));
        assert!(!is_remembered(&ns, "cli_run", "npm"));
        // 工具名是键的一部分。
        assert!(!is_remembered(&ns, "vault_patch", "npm install"));
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
