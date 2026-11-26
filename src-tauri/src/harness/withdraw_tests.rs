//! 撤回最近一条用户消息的单元测试（change add-harness-message-withdraw-nov26）。
//!
//! 判据口径：这些用例要能在**旧实现**上红——旧实现没有撤回命令，或者只做视觉删除时，
//! 「B 唯一 / A 物理删除 / 种子不带被撤回文本」会直接失败。

use super::jsonl;
use super::session;
use super::turn::TurnOrigin;
use super::xdg_test_lock;
use super::{first_user_text, Runtime, VaultScope};
use crate::config;
use crate::fs_io::IgnorePolicy;
use std::path::PathBuf;

struct XdgGuard(Option<std::ffi::OsString>);
impl Drop for XdgGuard {
    fn drop(&mut self) {
        match &self.0 {
            Some(value) => std::env::set_var("XDG_CONFIG_HOME", value),
            None => std::env::remove_var("XDG_CONFIG_HOME"),
        }
    }
}

struct Fixture {
    root: PathBuf,
    scope: VaultScope,
    config: config::HarnessConfig,
    runtime: Runtime,
    /// `XDG_CONFIG_HOME` 是**进程全局**：本模块的用例必须与其它改 XDG 的用例串行。
    _lock: std::sync::MutexGuard<'static, ()>,
    _env: XdgGuard,
}

fn panel(role: &str, text: &str) -> session::PanelMessage {
    session::PanelMessage {
        role: role.into(),
        text: Some(text.into()),
        reasoning: None,
        summary: None,
        name: None,
        web_input: None,
        status: None,
        decision: None,
        ts: jsonl::unix_secs_now(),
    }
}

impl Fixture {
    fn new(name: &str) -> Self {
        let lock = xdg_test_lock();
        let root = std::env::temp_dir().join(format!(
            "lumir-withdraw-{name}-{}-{:016x}",
            std::process::id(),
            rand::random::<u64>()
        ));
        let vault = root.join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        let previous_env = std::env::var_os("XDG_CONFIG_HOME");
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
        let scope = VaultScope {
            root: vault.clone(),
            policy: {
                let defaults = config::VaultConfig::default();
                IgnorePolicy::load(&vault, &[".gitignore".to_string()], &defaults.ignore)
            },
            vault_id: "vault-withdraw".to_string(),
        };
        Self {
            root,
            scope,
            config: config::test_mock(None),
            runtime: Runtime::default(),
            _lock: lock,
            _env: XdgGuard(previous_env),
        }
    }

    fn sessions_dir(&self) -> PathBuf {
        jsonl::vault_sessions_path(&self.scope.vault_id).unwrap()
    }

    fn session_file(&self, id: &str) -> PathBuf {
        self.sessions_dir().join(format!("{id}.jsonl"))
    }

    fn session_files(&self) -> Vec<PathBuf> {
        let mut files: Vec<PathBuf> = std::fs::read_dir(self.sessions_dir())
            .map(|entries| {
                entries
                    .flatten()
                    .map(|entry| entry.path())
                    .filter(|path| path.extension().and_then(|e| e.to_str()) == Some("jsonl"))
                    .collect()
            })
            .unwrap_or_default();
        files.sort();
        files
    }

    fn current_id(&self) -> String {
        self.runtime.current_session_id(&self.scope).unwrap()
    }

    /// 一轮完整交互：user 入队 + 一条真实 `llm_request` / `llm_response` + assistant 入队。
    /// 文件因此真实落盘（A 的存在性、删除、派生检测都依赖它）。
    fn seed_turn(&self, user: &str) {
        self.seed_turn_with_item(session::user_item(user), user);
    }

    fn seed_turn_with_item(&self, item: serde_json::Value, panel_text: &str) {
        self.runtime
            .acquire_turn(&self.scope, &self.config)
            .unwrap();
        self.runtime
            .with_session(&self.scope, |s| {
                s.set_last_turn_origin(TurnOrigin::Interactive);
                // 与生产入队点同口径：先记下标、再压入（撤回目标只认它）。
                let target = session::WithdrawTarget {
                    input: s.input().len(),
                    panel: s.panel_len(),
                };
                s.push_input(item);
                s.push_panel(panel("user", panel_text));
                s.set_withdraw_target(target);
                let request = serde_json::json!({
                    "kind": "llm_request",
                    "request": {
                        "system": s.system(),
                        "messages": s.input().to_vec(),
                        "params": {"thinking": "high"},
                    },
                });
                s.jsonl().record(&request);
                s.jsonl().record(
                    &serde_json::json!({"kind": "llm_response", "text": "答复", "tool_calls": []}),
                );
                for item in session::assistant_item("答复", None) {
                    s.push_input(item);
                }
                s.push_panel(panel("assistant", "答复"));
            })
            .unwrap();
        self.runtime.release_turn(&self.scope);
    }

    /// 带一次工具调用的一轮（`vault_create`）：用来判「已执行工具」的确认与副作用清单。
    fn seed_tool_turn(&self, user: &str) {
        self.runtime
            .acquire_turn(&self.scope, &self.config)
            .unwrap();
        self.runtime
            .with_session(&self.scope, |s| {
                s.set_last_turn_origin(TurnOrigin::Interactive);
                let target = session::WithdrawTarget {
                    input: s.input().len(),
                    panel: s.panel_len(),
                };
                s.push_input(session::user_item(user));
                s.push_panel(panel("user", user));
                s.set_withdraw_target(target);
                let request = serde_json::json!({
                    "kind": "llm_request",
                    "request": {
                        "system": s.system(),
                        "messages": s.input().to_vec(),
                        "params": {"thinking": "high"},
                    },
                });
                s.jsonl().record(&request);
                s.jsonl().record(&serde_json::json!({
                    "kind": "llm_response",
                    "text": "",
                    "tool_calls": [{"id": "c1", "name": "vault_create", "arguments": "{\"path\":\"a.md\"}"}],
                }));
                s.push_input(session::function_call_item(
                    "c1",
                    "vault_create",
                    "{\"path\":\"a.md\"}",
                ));
                s.push_input(session::function_call_output_item("c1", "{\"ok\":true}"));
                s.push_panel(session::PanelMessage {
                    name: Some("vault_create".into()),
                    summary: Some("a.md".into()),
                    ..panel("tool", "{\"ok\":true}")
                });
            })
            .unwrap();
        self.runtime.release_turn(&self.scope);
    }

    /// 模拟 blocked / 触顶分支：不起新回合，把一条后台通知直接压进 input + 面板。
    fn push_notice(&self, text: &str) {
        self.runtime
            .with_session(&self.scope, |s| {
                super::subagents::insert_notice_message(s, text, Some("wb-test"));
            })
            .unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// 撤回成功后：A 物理删除、B 唯一、B 的前缀不含被撤回消息、B 可被恢复出同一段前缀。
#[test]
fn withdraw_replaces_source_with_published_seed_session() {
    let fixture = Fixture::new("replace");
    fixture.seed_turn("q1-ALPHA");
    fixture.seed_turn("q2-WITHDRAWN");
    let a_id = fixture.current_id();
    let a_path = fixture.session_file(&a_id);
    assert!(a_path.exists(), "A 的留存应已落盘");

    let old_token = fixture
        .runtime
        .snapshot(&fixture.scope, &fixture.config)
        .session_token;
    let outcome = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect("空闲交互轮可以撤回");
    let info = outcome.info.expect("成功回执必须带 info");
    let b_id = info.session_id.clone();
    assert_ne!(
        info.session_token, old_token,
        "B 必须换会话令牌，旧会话迟到事件据此丢弃"
    );
    assert_ne!(b_id, a_id);
    assert_eq!(fixture.current_id(), b_id, "B 必须是当前会话");
    assert!(!a_path.exists(), "A 的 JSONL 必须被删除");
    assert_eq!(fixture.session_files(), vec![fixture.session_file(&b_id)]);

    assert_eq!(info.withdrawn.text, "q2-WITHDRAWN");
    assert_eq!(
        info.messages
            .iter()
            .map(|m| m.text.as_deref().unwrap_or(""))
            .collect::<Vec<_>>(),
        vec!["q1-ALPHA", "答复"],
        "面板只剩撤回点之前的历史"
    );

    let content = std::fs::read_to_string(fixture.session_file(&b_id)).unwrap();
    assert!(content.contains("opened_from\":\"withdraw"));
    assert!(content.contains(&format!("restored_from\":\"{a_id}\"")));
    assert!(
        !content.contains("q2-WITHDRAWN"),
        "被撤回文本不得进入 B 的任何记录"
    );
    assert!(content.contains("q1-ALPHA"), "前缀历史必须随 seed 落盘");

    // 切走（新会话丢弃内存态）再恢复 B：前缀必须从 seed 重建，不能退化成空会话。
    fixture.runtime.new_session(&fixture.scope).unwrap();
    let resumed = fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &b_id)
        .expect("B 可恢复");
    assert_eq!(resumed.restored_items, 2);
    assert_eq!(
        resumed
            .messages
            .iter()
            .map(|m| m.text.as_deref().unwrap_or(""))
            .collect::<Vec<_>>(),
        vec!["q1-ALPHA", "答复"]
    );
}

/// 两段式确认：有工具调用时第一次什么都不做；确认后才执行，并如实带回工具名。
#[test]
fn withdraw_with_tools_requires_confirmation_without_side_effects() {
    let fixture = Fixture::new("confirm");
    fixture.seed_turn("q1-ALPHA");
    fixture.seed_tool_turn("q2-TOOL");
    let a_id = fixture.current_id();
    let a_path = fixture.session_file(&a_id);

    let preview = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, false)
        .expect("预览不是错误");
    assert!(preview.needs_confirmation);
    assert_eq!(preview.tool_names, vec!["vault_create"]);
    assert!(preview.info.is_none());
    assert_eq!(fixture.current_id(), a_id, "预览不得改动会话");
    assert!(a_path.exists(), "预览不得删除 A");
    assert_eq!(fixture.session_files().len(), 1, "预览不得创建 B");

    let done = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect("确认后执行");
    assert!(!done.needs_confirmation);
    assert_eq!(
        done.tool_names,
        vec!["vault_create"],
        "回执仍列出已执行工具"
    );
    assert!(!a_path.exists());
    let info = done.info.unwrap();
    assert!(!info
        .messages
        .iter()
        .any(|m| m.text.as_deref() == Some("q2-TOOL")));
}

/// 在途（busy）不可撤回：停止是另一个动作，撤回不替用户做决定。
#[test]
fn withdraw_refuses_while_busy() {
    let fixture = Fixture::new("busy");
    fixture.seed_turn("q1-ALPHA");
    let a_id = fixture.current_id();
    fixture
        .runtime
        .acquire_turn(&fixture.scope, &fixture.config)
        .unwrap();
    let error = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect_err("busy 必须拒绝");
    assert_eq!(error.code, "harness_busy");
    assert_eq!(fixture.current_id(), a_id);
    fixture.runtime.release_turn(&fixture.scope);
}

/// 待批（批准闸等待）同样是在途：撤回不越过停止去替用户做决定。
#[test]
fn withdraw_refuses_while_waiting_for_approval() {
    let fixture = Fixture::new("approval");
    fixture.seed_turn("q1-ALPHA");
    let a_id = fixture.current_id();
    fixture
        .runtime
        .acquire_turn(&fixture.scope, &fixture.config)
        .unwrap();
    let (tx, _rx) = std::sync::mpsc::channel();
    let request = super::approval::ApprovalRequest::new(
        "vault_patch".into(),
        None,
        None,
        None,
        None,
        "a.md".into(),
        None,
        None,
        tx,
    );
    fixture
        .runtime
        .park_approval(&fixture.scope, request)
        .expect("待批项入会话");
    let error = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect_err("待批期间必须拒绝");
    assert_eq!(error.code, "harness_busy");
    assert_eq!(fixture.current_id(), a_id);
    fixture.runtime.release_turn(&fixture.scope);
}

/// 来源闸：cron / 自动唤醒推入的用户项不是「用户发出去又后悔的那一句」。
#[test]
fn withdraw_refuses_non_interactive_origin() {
    let fixture = Fixture::new("origin");
    fixture.seed_turn("q1-ALPHA");
    let a_id = fixture.current_id();
    fixture
        .runtime
        .with_session(&fixture.scope, |s| s.set_last_turn_origin(TurnOrigin::Cron))
        .unwrap();
    let error = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect_err("cron 轮必须拒绝");
    assert_eq!(error.code, "harness_withdraw_not_applicable");
    assert!(fixture.session_file(&a_id).exists());
}

/// 派生会话：A 有恢复出来的子会话时拒绝，不级联删除、不静默保留。
#[test]
fn withdraw_refuses_when_a_derived_session_exists() {
    let fixture = Fixture::new("derived");
    fixture.seed_turn("q1-ALPHA");
    fixture.seed_turn("q2-WITHDRAWN");
    let a_id = fixture.current_id();
    let child = fixture.session_file("s1700000000000-child01");
    std::fs::write(
        &child,
        format!(
            "{{\"ts\":1,\"payload\":{{\"kind\":\"session_open\",\"session_id\":\"s1700000000000-child01\",\"vault_root\":{:?},\"opened_from\":\"restore\",\"restored_from\":\"{a_id}\",\"system\":\"S\"}}}}\n",
            fixture.scope.key()
        ),
    )
    .unwrap();

    let error = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect_err("有派生会话必须拒绝");
    assert_eq!(error.code, "harness_withdraw_derived_exists");
    assert_eq!(
        error.params.get("sessions").map(String::as_str),
        Some("s1700000000000-child01")
    );
    assert!(
        fixture.session_file(&a_id).exists(),
        "拒绝时 A 必须原样保留"
    );
    assert_eq!(fixture.session_files().len(), 2, "拒绝时不得创建 B");
}

/// 删除 A 失败：就地回滚 B，A 仍是当前会话——任何失败都不先丢 A。
#[test]
fn withdraw_rolls_back_new_session_when_source_delete_fails() {
    let fixture = Fixture::new("rollback");
    fixture.seed_turn("q1-ALPHA");
    let a_id = fixture.current_id();
    let a_path = fixture.session_file(&a_id);
    // 注入「删 A 失败」：A 的文件与装配记录保持可读，只让 unlink 这一步失败（生产代码里
    // 对应权限 / IO 错误；注入点 `FAIL_NEXT_SOURCE_UNLINK` 是 `#[cfg(test)]` 的）。
    super::FAIL_NEXT_SOURCE_UNLINK.store(true, std::sync::atomic::Ordering::SeqCst);

    let error = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect_err("删除 A 失败必须报错");
    assert_eq!(error.code, "harness_withdraw_delete_failed");
    assert_eq!(fixture.current_id(), a_id, "失败后 A 仍是当前会话");
    assert!(a_path.exists(), "A 的留存保留（只有 unlink 注入失败）");
    let b_files: Vec<PathBuf> = fixture
        .session_files()
        .into_iter()
        .filter(|path| path.file_name().and_then(|n| n.to_str()) != Some(&format!("{a_id}.jsonl")))
        .collect();
    assert!(b_files.is_empty(), "回滚必须清掉 B 的发布文件：{b_files:?}");
    assert_eq!(
        fixture
            .runtime
            .with_session(&fixture.scope, |s| s.input().len())
            .unwrap(),
        2,
        "A 的 input 不得被改动"
    );
}

/// composer 素材：文本 / 图片引用 / Skill 名齐全，自动注入的上下文节已剥掉。
#[test]
fn withdraw_returns_composer_payload_without_context_section() {
    let fixture = Fixture::new("composer");
    let item = serde_json::json!({
        "role": "user",
        "content": [
            {"type": "input_text", "text": "看图"},
            {"type": "input_image", "image_url": "lumir-attachment://pasted-a0123456789bc.webp"},
            {"type": "input_text", "text": "这里哪里不对？\n\n[当前编辑器上下文：\n文件：a.md\n视口（第 1-3 行）]"},
            {"type": "input_text", "text": "[已加载 Skill：demo]\nSKILL-BODY", "lumir_skill": "demo"},
        ],
    });
    fixture.seed_turn_with_item(
        item,
        "看图\n<image ref=\"pasted-a0123456789bc.webp\" type=\"image/webp\"/>\n这里哪里不对？",
    );
    let info = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect("应成功")
        .info
        .unwrap();
    assert!(info.withdrawn.text.contains("这里哪里不对？"));
    assert!(!info.withdrawn.text.contains("当前编辑器上下文"));
    assert!(
        !info.withdrawn.text.contains("SKILL-BODY"),
        "Skill 正文不得回到 composer"
    );
    assert!(info
        .withdrawn
        .text
        .contains("<image ref=\"pasted-a0123456789bc.webp\""));
    assert_eq!(info.withdrawn.skills, vec!["demo"]);
}

/// 标题与用量种子沿用恢复机制；快照的 `withdrawable` 在撤回后归零。
#[test]
fn withdraw_inherits_title_and_usage_and_resets_withdrawable() {
    let fixture = Fixture::new("title");
    fixture.seed_turn("q1-ALPHA");
    fixture.seed_turn("q2-WITHDRAWN");
    fixture
        .runtime
        .with_session(&fixture.scope, |s| s.set_title(Some("既有标题".into())))
        .unwrap();
    assert!(
        fixture
            .runtime
            .snapshot(&fixture.scope, &fixture.config)
            .withdrawable,
        "交互轮之后快照应报告可撤回"
    );
    let info = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect("应成功")
        .info
        .unwrap();
    assert_eq!(info.title.as_deref(), Some("既有标题"));
    assert_eq!(info.first_user_text.as_deref(), Some("q1-ALPHA"));
    assert!(
        !fixture
            .runtime
            .snapshot(&fixture.scope, &fixture.config)
            .withdrawable,
        "撤回之后没有可撤回的轮次"
    );
    let file = jsonl::read_session_file(&fixture.session_file(&info.session_id)).unwrap();
    assert_eq!(
        jsonl::effective_title(&file.records).as_deref(),
        Some("既有标题")
    );
    assert!(file.session_open.get("usage").is_some(), "用量种子必须在场");
    assert_eq!(first_user_text(&file).as_deref(), Some("q1-ALPHA"));
}

/// 重复点击幂等：第二次调用不产生第二份 B，也不误删任何东西。
#[test]
fn withdraw_is_idempotent_on_repeat_click() {
    let fixture = Fixture::new("repeat");
    fixture.seed_turn("q1-ALPHA");
    let first = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect("首次成功")
        .info
        .unwrap();
    let files_after_first = fixture.session_files();
    let second = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect_err("第二次必须被拒");
    assert_eq!(second.code, "harness_withdraw_not_applicable");
    assert_eq!(fixture.current_id(), first.session_id);
    assert_eq!(fixture.session_files(), files_after_first);
}

/// K3 P1-1：交互轮之后到达后台通知（blocked / 触顶分支，不起新回合、输入里也是 user 项）
/// 时，撤回必须拒绝——否则会把通知当目标、错删真实用户轮次并绕过工具确认。零文件变化、
/// 零 composer 变化、会话原样。
#[test]
fn withdraw_refuses_when_a_background_notice_follows_the_turn() {
    let fixture = Fixture::new("tail-notice");
    fixture.seed_tool_turn("q1-TOOL");
    let a_id = fixture.current_id();
    let a_path = fixture.session_file(&a_id);
    fixture.push_notice("后台完成：某任务结束");

    let error = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect_err("尾部有后台通知必须拒绝");
    assert_eq!(error.code, "harness_withdraw_tail_notice");
    assert_eq!(fixture.current_id(), a_id, "拒绝后会话不变");
    assert!(a_path.exists(), "拒绝后 A 的文件不动");
    assert_eq!(fixture.session_files().len(), 1, "拒绝时不得创建 B");
    let input_len = fixture
        .runtime
        .with_session(&fixture.scope, |s| s.input().len())
        .unwrap();
    assert_eq!(input_len, 4, "通知仍在 input 里（没有被吞掉）");
    // 预览也不得把通知当成目标给出工具清单（先拒绝，不进入确认流程）。
    let preview = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, false)
        .expect_err("预览同样拒绝");
    assert_eq!(preview.code, "harness_withdraw_tail_notice");
}

/// K3 P1-3：不可读的派生候选必须 fail closed——无法排除派生就不允许删 A。
#[test]
fn withdraw_fails_closed_when_a_derived_candidate_is_unreadable() {
    let fixture = Fixture::new("bad-candidate");
    fixture.seed_turn("q1-ALPHA");
    let a_id = fixture.current_id();
    let a_path = fixture.session_file(&a_id);
    std::fs::write(
        fixture.session_file("s1700000000000-broken"),
        "{ not json\n",
    )
    .unwrap();

    let error = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect_err("不可读候选必须拒绝");
    assert_eq!(error.code, "harness_withdraw_scan_failed");
    assert_eq!(
        error.params.get("path").map(String::as_str),
        Some(
            fixture
                .session_file("s1700000000000-broken")
                .to_str()
                .unwrap()
        )
    );
    assert!(a_path.exists(), "拒绝后 A 的文件不动");
    assert_eq!(fixture.session_files().len(), 2, "拒绝时不得创建 B");
}

/// K3 P1-3：独立 Runtime（cron 专用会话）的惰性恢复先登记占用——撤回在它结束前必须拒绝；
/// 恢复会话被丢弃后占用释放，撤回恢复可用。
#[test]
fn withdraw_refuses_while_another_runtime_resumes_the_source() {
    let fixture = Fixture::new("resume-claim");
    fixture.seed_turn("q1-ALPHA");
    let a_id = fixture.current_id();
    let isolated = Runtime::isolated();
    let resumed = isolated
        .resume_session(&fixture.scope, &fixture.config, &a_id)
        .expect("独立 Runtime 可以恢复（惰性发布）");
    assert!(resumed.switched);

    let error = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect_err("恢复占用期间必须拒绝");
    assert_eq!(error.code, "harness_withdraw_resume_in_flight");
    assert!(fixture.session_file(&a_id).exists(), "A 不动");

    drop(isolated);
    let done = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect("恢复会话丢弃后撤回可用");
    assert!(done.info.is_some());
    assert!(!fixture.session_file(&a_id).exists());
}

/// K3 P2-1：A 删除失败且 B 清理也失败——必须如实报「回滚未完成」，不得用干净失败收口，
/// 也不得声称清单唯一。
#[test]
fn withdraw_reports_incomplete_rollback_when_cleanup_also_fails() {
    let fixture = Fixture::new("double-fault");
    fixture.seed_turn("q1-ALPHA");
    let a_id = fixture.current_id();
    let a_path = fixture.session_file(&a_id);
    super::FAIL_NEXT_SOURCE_UNLINK.store(true, std::sync::atomic::Ordering::SeqCst);
    super::FAIL_NEXT_CLEANUP.store(true, std::sync::atomic::Ordering::SeqCst);

    let error = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect_err("双故障必须报错");
    assert_eq!(error.code, "harness_withdraw_rollback_incomplete");
    assert_eq!(
        error.params.get("cause").map(String::as_str),
        Some("harness_withdraw_delete_failed")
    );
    assert!(error.params.contains_key("session_id"), "回执点名残留的 B");
    assert_eq!(fixture.current_id(), a_id, "A 仍是当前会话");
    assert!(a_path.exists(), "A 的文件保留");
    assert_eq!(
        fixture.session_files().len(),
        2,
        "B 的发布文件残留（诚实暴露，不假装唯一）"
    );
}

/// K3 P2-2：失败 / 被拒的显式 Skill 也要恢复成显式引用；成功与失败按原顺序去重，
/// trace 正文不外带。
#[test]
fn withdraw_restores_failed_explicit_skills_from_the_trace() {
    let fixture = Fixture::new("skills");
    let item = serde_json::json!({
        "role": "user",
        "content": [
            {"type": "input_text", "text": "用 /demo 和 /ghost 看看"},
            {"type": "input_text", "text": "[已加载 Skill：demo]\nSKILL-BODY", "lumir_skill": "demo"},
        ],
        "lumir_skill_trace": [
            {"name": "demo", "status": "done", "ts": 1},
            {"name": "ghost", "status": "error", "ts": 1, "code": "skill_not_found"},
            {"name": "demo", "status": "done", "ts": 1},
        ],
    });
    fixture.seed_turn_with_item(item, "用 /demo 和 /ghost 看看");
    let info = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect("应成功")
        .info
        .unwrap();
    assert_eq!(
        info.withdrawn.skills,
        vec!["demo", "ghost"],
        "成功与被拒的显式选择都保留、按 trace 原顺序去重"
    );
    assert!(
        !info.withdrawn.text.contains("SKILL-BODY"),
        "trace / part 正文不回填"
    );
}

/// K3 P2-3：装配记录不可读 / 缺 assembly 时拒绝撤回，不造出「assembly 缺失的 B」。
#[test]
fn withdraw_fails_closed_when_the_assembly_record_is_unreadable() {
    let fixture = Fixture::new("assembly");
    fixture.seed_turn("q1-ALPHA");
    let a_id = fixture.current_id();
    let a_path = fixture.session_file(&a_id);
    // 把 A 的路径换成目录：首行不可读（装配记录读失败），A 不能因此被当成「无 assembly」。
    std::fs::remove_file(&a_path).unwrap();
    std::fs::create_dir(&a_path).unwrap();

    let error = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect_err("装配记录不可读必须拒绝");
    assert_eq!(error.code, "harness_withdraw_read_failed");
    assert!(a_path.is_dir(), "A 的路径未被当成可读文件悄悄替换");
    assert_eq!(fixture.current_id(), a_id, "A 仍是当前会话");
    assert_eq!(
        fixture.session_files().len(),
        1,
        "拒绝时不得创建 B（目录项不是 .jsonl 文件的常规路径，按 1 份文件计）"
    );
}

/// K3 P2-1：超过 80 字符的显式 Skill 名——成功与被拒都从 trace 的 `raw_name` 取**完整原名**；
/// 展示名（截断 + `…`）只用于面板行，不兼任恢复协议。
#[test]
fn withdraw_restores_long_skill_names_from_trace_raw_name() {
    let fixture = Fixture::new("long-skills");
    let long_ok = format!("skill{}", "a".repeat(100));
    let long_failed = format!("ghost{}", "b".repeat(100));
    let display_ok = format!("{}…", long_ok.chars().take(80).collect::<String>());
    let display_failed = format!("{}…", long_failed.chars().take(80).collect::<String>());
    let item = serde_json::json!({
        "role": "user",
        "content": [
            {"type": "input_text", "text": format!("用 /{long_ok} 和 /{long_failed} 看看")},
            {"type": "input_text", "text": format!("[已加载 Skill：{long_ok}]\nBODY"), "lumir_skill": long_ok},
        ],
        "lumir_skill_trace": [
            {"name": display_ok, "raw_name": long_ok, "status": "done", "ts": 1},
            {"name": display_failed, "raw_name": long_failed, "status": "error", "ts": 1, "code": "skill_not_found"},
        ],
    });
    fixture.seed_turn_with_item(item, "用长名 Skill 看看");
    let info = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect("应成功")
        .info
        .unwrap();
    assert_eq!(
        info.withdrawn.skills,
        vec![long_ok.clone(), long_failed.clone()],
        "成功与被拒的长名都必须以完整原名回到 composer（展示名不能冒充）"
    );
    assert!(!info.withdrawn.skills.iter().any(|name| name.ends_with('…')));
}

/// K3 P2-1：旧记录缺 `raw_name` ⇒ 回落展示名（安全降级）；不从 `…` 猜全名，也不伪造。
#[test]
fn withdraw_degrades_old_skill_trace_without_raw_name() {
    let fixture = Fixture::new("old-skills");
    let item = serde_json::json!({
        "role": "user",
        "content": [
            {"type": "input_text", "text": "用 /ghost-name 看看"},
        ],
        "lumir_skill_trace": [
            {"name": "ghost…", "status": "error", "ts": 1, "code": "skill_not_found"},
        ],
    });
    fixture.seed_turn_with_item(item, "用 /ghost-name 看看");
    let info = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect("应成功")
        .info
        .unwrap();
    assert_eq!(
        info.withdrawn.skills,
        vec!["ghost…"],
        "旧记录只给展示名，原样回落"
    );
    assert_ne!(
        info.withdrawn.skills,
        vec!["ghost-name"],
        "不得从省略号猜全名"
    );
}
