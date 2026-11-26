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
                s.push_input(item);
                s.push_panel(panel("user", panel_text));
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
                s.push_input(session::user_item(user));
                s.push_panel(panel("user", user));
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
    // 把 A 的路径换成非空目录：unlink 必然失败（EISDIR / ENOTEMPTY），而 B 仍能正常发布。
    std::fs::remove_file(&a_path).unwrap();
    std::fs::create_dir(&a_path).unwrap();
    std::fs::write(a_path.join("keep"), "x").unwrap();

    let error = fixture
        .runtime
        .withdraw_last_turn(&fixture.scope, &fixture.config, true)
        .expect_err("删除 A 失败必须报错");
    assert_eq!(error.code, "harness_withdraw_delete_failed");
    assert_eq!(fixture.current_id(), a_id, "失败后 A 仍是当前会话");
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
