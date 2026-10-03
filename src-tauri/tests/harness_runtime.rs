//! Harness 运行时集成测试（M302）：mock provider 驱动工具循环，覆盖 mission 单测清单——
//! 多轮往返 / loop_max 终止 / 权限判定顺序（deny > allow）/ ask 挂起-采纳-拒绝 /
//! patch 唯一命中错误回送 / O_EXCL 拒绝 / skill_load 根外路径拒绝 / 自动压缩（阈值 + 超限重试）/
//! JSONL 留存与会话边界。
//!
//! 环境隔离：XDG_CONFIG_HOME（JSONL 落点）与 HOME（Skill 发现）都指向临时目录，
//! 不碰真实 `~/.config/lumir` 与 `~/.agents`（REVIEW.md 第 13 条）。多测串行（静态锁），
//! 因为 env 是进程全局。

use lumir_lib::commands::CommandError;
use lumir_lib::config::{HarnessConfig, HarnessPermissions, HarnessProvider};
use lumir_lib::fs_io::IgnorePolicy;
use lumir_lib::harness::events::EventSink;
use lumir_lib::harness::llm::{LlmClient, MockClient};
use lumir_lib::harness::turn;
use lumir_lib::harness::{Runtime, VaultScope};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

static ENV_LOCK: Mutex<()> = Mutex::new(());

/// 隔离环境的测试夹具：临时 XDG_CONFIG_HOME + HOME + 合成 vault。
struct Fixture {
    root: PathBuf,
    previous_xdg: Option<std::ffi::OsString>,
    previous_home: Option<std::ffi::OsString>,
    _guard: std::sync::MutexGuard<'static, ()>,
}

impl Fixture {
    fn new(name: &str) -> Self {
        let guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let root =
            std::env::temp_dir().join(format!("lumir-m302-it-{}-{}", name, std::process::id()));
        if root.exists() {
            std::fs::remove_dir_all(&root).unwrap();
        }
        std::fs::create_dir_all(&root).unwrap();
        let previous_xdg = std::env::var_os("XDG_CONFIG_HOME");
        let previous_home = std::env::var_os("HOME");
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
        std::env::set_var("HOME", root.join("home"));
        std::fs::create_dir_all(root.join("xdg")).unwrap();
        std::fs::create_dir_all(root.join("home")).unwrap();
        std::fs::create_dir_all(root.join("vault")).unwrap();
        Self {
            root,
            previous_xdg,
            previous_home,
            _guard: guard,
        }
    }

    fn vault(&self) -> PathBuf {
        self.root.join("vault")
    }

    fn scope(&self) -> VaultScope {
        VaultScope {
            root: self.vault(),
            policy: IgnorePolicy::load(&self.vault(), &[".gitignore".to_string()]),
        }
    }

    fn write(&self, rel: &str, content: &str) {
        let path = self.vault().join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, content).unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        match &self.previous_xdg {
            Some(v) => std::env::set_var("XDG_CONFIG_HOME", v),
            None => std::env::remove_var("XDG_CONFIG_HOME"),
        }
        match &self.previous_home {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }
        std::fs::remove_dir_all(&self.root).ok();
    }
}

/// 收集事件的 sink。
#[derive(Clone, Default)]
struct CollectSink(Arc<Mutex<Vec<serde_json::Value>>>);

impl EventSink for CollectSink {
    fn emit(&self, payload: serde_json::Value) {
        self.0.lock().unwrap().push(payload);
    }
}

impl CollectSink {
    fn events(&self) -> Vec<serde_json::Value> {
        self.0.lock().unwrap().clone()
    }

    fn types(&self) -> Vec<String> {
        self.events()
            .iter()
            .filter_map(|e| e.get("type").and_then(|t| t.as_str()).map(str::to_string))
            .collect()
    }

    fn wait_for<F: Fn(&[serde_json::Value]) -> bool>(&self, predicate: F, what: &str) {
        for _ in 0..500 {
            if predicate(&self.events()) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        panic!("等待超时：{what}；已收到事件 {:?}", self.types());
    }
}

fn mock_config() -> HarnessConfig {
    HarnessConfig {
        provider: HarnessProvider::Mock,
        ..Default::default()
    }
}

/// 给 Fixture 挂一个 Runtime（默认不建，谁用谁挂）。
trait RuntimeExt {
    fn runtime(&self) -> Runtime;
}
impl RuntimeExt for Fixture {
    fn runtime(&self) -> Runtime {
        Runtime::default()
    }
}

/// 某工具的最后一个 tool_call 事件（终态事件 status 必须是契约内的 done——
/// m303 面板按非 done 即 started 归并，细分状态在 summary）。
fn last_tool_call_event(sink: &CollectSink, name: &str) -> serde_json::Value {
    let events = sink.events();
    let mut found: Option<serde_json::Value> = None;
    for event in events {
        if event["type"] == "tool_call" && event["name"] == name {
            found = Some(event);
        }
    }
    found.unwrap_or_else(|| panic!("没有 {name} 的 tool_call 事件"))
}

/// 面板消息 role 序列。
fn panel_roles(fixture: &Fixture, runtime: &Runtime) -> Vec<String> {
    let snapshot = runtime.snapshot(&fixture.scope(), &mock_config());
    snapshot.messages.iter().map(|m| m.role.clone()).collect()
}

#[test]
fn tool_loop_roundtrip_with_fixture_file() {
    let f = Fixture::new("roundtrip");
    f.write("notes/demo.md", "demo content\n");
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    let script = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/harness-fixtures/mock_basic.json"),
    )
    .unwrap();
    let mut client = MockClient::from_str(&script, "mock_basic.json").unwrap();
    turn::run_turn_for(
        &sink,
        &runtime,
        &f.scope(),
        &mock_config(),
        "这段讲了什么".to_string(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    // 事件序列：文本 chunk → 工具 started/done → usage → 文本 → usage → done。
    let types = sink.types();
    assert!(types.contains(&"text_chunk".to_string()), "{types:?}");
    assert!(types.contains(&"tool_call".to_string()), "{types:?}");
    assert!(types.contains(&"usage".to_string()), "{types:?}");
    assert_eq!(types.last().unwrap(), "done", "{types:?}");

    // 面板：user / assistant / tool / assistant 依次入账。
    assert_eq!(
        panel_roles(&f, &runtime),
        vec!["user", "assistant", "tool", "assistant"]
    );

    // 用量：mock 第二轮 input 1400 / 窗口 131072 ≈ 1.1%，cache 1000/1400 ≈ 71.4%。
    let snapshot = runtime.snapshot(&f.scope(), &mock_config());
    assert!((snapshot.usage.ctx_pct - 1400.0 * 100.0 / 131072.0).abs() < 0.2);
    assert!((snapshot.usage.cache_pct - 1000.0 * 100.0 / 1400.0).abs() < 0.2);

    // JSONL 留存：配置目录（不是 vault）有记录，且含工具调用与结果。
    let jsonl = std::fs::read_to_string(f.root.join("xdg/lumir/harness").join(format!(
        "{}.jsonl",
        sanitize_name(&f.vault().display().to_string())
    )))
    .expect("jsonl 存在");
    assert!(jsonl.contains("\"kind\":\"user_message\""), "{jsonl}");
    assert!(jsonl.contains("\"kind\":\"tool_call\""), "{jsonl}");
    assert!(jsonl.contains("\"kind\":\"tool_result\""), "{jsonl}");
    assert!(jsonl.contains("\"kind\":\"usage\""), "{jsonl}");
    assert!(jsonl.contains("demo content"), "{jsonl}"); // 工具读到的原文
}

/// 与 jsonl.rs 内 sanitize 同形（测试侧再实现一份，避免 pub 仅为测试开口）。
fn sanitize_name(raw: &str) -> String {
    raw.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

#[test]
fn loop_max_terminates_with_notice() {
    let f = Fixture::new("loopmax");
    f.write("a.md", "x\n");
    let mut config = mock_config();
    config.loop_max = 2;
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    // 两轮都继续调工具（读类 allow，直执行）→ 第二轮后应触发 loop_max 提示。
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}]},
        {"tool_calls": [{"id": "c2", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}]}
    ]}"#;
    let mut client = MockClient::from_str(script, "loop").unwrap();
    turn::run_turn_for(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "问".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let snapshot = runtime.snapshot(&f.scope(), &config);
    let notice = snapshot
        .messages
        .iter()
        .find(|m| m.text.as_deref().unwrap_or("").contains("工具循环上限"))
        .expect("有 loop_max 提示");
    assert!(notice.text.as_deref().unwrap().contains('2'));
    // 工具恰执行 2 次（第三轮不存在）。
    let tool_msgs = snapshot
        .messages
        .iter()
        .filter(|m| m.role == "tool")
        .count();
    assert_eq!(tool_msgs, 2);
    assert_eq!(sink.types().last().unwrap(), "done");
}

#[test]
fn deny_beats_allow_and_default_layering() {
    let f = Fixture::new("deny");
    f.write("a.md", "old\n");
    let mut config = mock_config();
    // deny 一条同时命中 allow 的规则：deny 赢，不进展批准闸。
    config.permissions = HarnessPermissions {
        allow: vec!["vault_patch".into()],
        deny: vec!["vault_patch".into()],
    };
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_patch",
            "arguments": "{\"path\":\"a.md\",\"edits\":[{\"old_string\":\"old\",\"new_string\":\"new\"}]}"}]},
        {"text": "好的，那我不改了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "deny").unwrap();
    turn::run_turn_for(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "改一下".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    // 无 approval_request 事件；工具消息 status=denied；磁盘未变。
    assert!(!sink.types().contains(&"approval_request".to_string()));
    let snapshot = runtime.snapshot(&f.scope(), &config);
    let tool = snapshot.messages.iter().find(|m| m.role == "tool").unwrap();
    assert_eq!(tool.status.as_deref(), Some("denied"));
    // 事件终态 status 必须是契约内的 "done"（细分状态放 summary，r1 P1-1）。
    let event = last_tool_call_event(&sink, "vault_patch");
    assert_eq!(event["status"], "done", "{event}");
    assert!(
        event["summary"].as_str().unwrap().contains("denied"),
        "{event}"
    );
    assert_eq!(
        std::fs::read_to_string(f.vault().join("a.md")).unwrap(),
        "old\n"
    );
}

#[test]
fn ask_gate_approve_executes_and_reject_leaves_disk() {
    for (approve, expected_disk, expected_status) in
        [(true, "patched\n", "done"), (false, "old\n", "rejected")]
    {
        let f = Fixture::new(if approve { "approve" } else { "reject" });
        f.write("a.md", "old\n");
        let config = mock_config();
        let runtime = f.runtime();
        runtime.acquire_turn(&f.scope()).unwrap();
        let sink = CollectSink::default();
        let script = r#"{"responses": [
            {"tool_calls": [{"id": "c1", "name": "vault_patch",
                "arguments": "{\"path\":\"a.md\",\"edits\":[{\"old_string\":\"old\",\"new_string\":\"patched\"}]}"}]},
            {"text": "收到。"}
        ]}"#;
        let mut client = MockClient::from_str(script, "gate").unwrap();
        let worker = {
            let sink = sink.clone();
            let runtime = runtime.clone();
            let scope = f.scope();
            let config = config.clone();
            std::thread::spawn(move || {
                turn::run_turn_for(
                    &sink,
                    &runtime,
                    &scope,
                    &config,
                    "改成 patched".into(),
                    &mut client,
                );
            })
        };
        // 等批准请求挂出，diff 预览附在事件上。
        sink.wait_for(
            |events| {
                events
                    .iter()
                    .any(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
            },
            "approval_request 事件",
        );
        let request = sink
            .events()
            .into_iter()
            .find(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
            .unwrap();
        assert_eq!(request["tool"], "vault_patch");
        let diff = request["diff"].as_str().expect("patch 附 diff 预览");
        assert!(diff.contains("-old"), "{diff}");
        assert!(diff.contains("+patched"), "{diff}");
        let id = request["id"].as_str().unwrap().to_string();
        // 面板状态里 pending_approval 可见（harness_state 形状）。
        let pending = runtime.snapshot(&f.scope(), &config).pending_approval;
        assert_eq!(pending.map(|p| p.id), Some(id.clone()));
        // 采纳 / 拒绝（拒绝带原因，随结果回送模型）。
        runtime
            .with_session(&f.scope(), |s| {
                s.resolve_approval(&id, approve, (!approve).then(|| "先别改".to_string()))
            })
            .expect("resolve ok")
            .expect("resolve ok");
        worker.join().unwrap();

        assert_eq!(
            std::fs::read_to_string(f.vault().join("a.md")).unwrap(),
            expected_disk
        );
        let snapshot = runtime.snapshot(&f.scope(), &config);
        let tool = snapshot.messages.iter().find(|m| m.role == "tool").unwrap();
        assert_eq!(tool.status.as_deref(), Some(expected_status));
        // 事件终态一律 "done"（r1 P1-1）：采纳/拒绝都不发细分值，细分只在 summary。
        let event = last_tool_call_event(&sink, "vault_patch");
        assert_eq!(event["status"], "done", "{event}");
        if approve {
            assert_eq!(event["summary"], "成功", "{event}");
        } else {
            assert!(
                event["summary"].as_str().unwrap().contains("rejected"),
                "{event}"
            );
        }
        if !approve {
            // 拒绝原因随工具结果回送模型（JSONL 里 tool_result 带 approval_rejected + 原因）。
            assert!(tool.text.as_deref().unwrap().contains("approval_rejected"));
            assert!(tool.text.as_deref().unwrap().contains("先别改"));
        }
        assert!(snapshot.pending_approval.is_none(), "批准后 pending 清空");
    }
}

#[test]
fn patch_not_unique_error_feeds_back_without_gate() {
    let f = Fixture::new("notunique");
    f.write("a.md", "dup\nfoo\ndup\n");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    // old_string "dup" 命中 2 次：预览阶段失败 → 错误直接回送模型，不进批准闸。
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_patch",
            "arguments": "{\"path\":\"a.md\",\"edits\":[{\"old_string\":\"dup\",\"new_string\":\"x\"}]}"}]},
        {"text": "我换一处试试。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "notunique").unwrap();
    turn::run_turn_for(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "改".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    assert!(!sink.types().contains(&"approval_request".to_string()));
    let snapshot = runtime.snapshot(&f.scope(), &config);
    let tool = snapshot.messages.iter().find(|m| m.role == "tool").unwrap();
    assert_eq!(tool.status.as_deref(), Some("error"));
    assert!(tool.text.as_deref().unwrap().contains("patch_not_unique"));
    // 事件终态 status=done，细分 error 在 summary（r1 P1-1）。
    let event = last_tool_call_event(&sink, "vault_patch");
    assert_eq!(event["status"], "done", "{event}");
    assert!(
        event["summary"].as_str().unwrap().contains("error"),
        "{event}"
    );
    assert_eq!(
        std::fs::read_to_string(f.vault().join("a.md")).unwrap(),
        "dup\nfoo\ndup\n"
    );
}

#[test]
fn create_o_excl_refuses_overwrite() {
    let f = Fixture::new("oexcl");
    f.write("a.md", "old\n");
    let mut config = mock_config();
    // allow 命中免闸，直接撞 O_EXCL。
    config.permissions = HarnessPermissions {
        allow: vec!["vault_create".into()],
        deny: vec![],
    };
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_create",
            "arguments": "{\"path\":\"a.md\",\"content\":\"new\"}"}]},
        {"text": "那我换个名字。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "oexcl").unwrap();
    turn::run_turn_for(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "建 a.md".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let snapshot = runtime.snapshot(&f.scope(), &config);
    let tool = snapshot.messages.iter().find(|m| m.role == "tool").unwrap();
    assert_eq!(tool.status.as_deref(), Some("error"));
    assert!(tool.text.as_deref().unwrap().contains("fs_already_exists"));
    assert_eq!(
        std::fs::read_to_string(f.vault().join("a.md")).unwrap(),
        "old\n"
    );
}

#[test]
fn skill_load_rejects_escape_and_unknown() {
    let f = Fixture::new("skill");
    f.write(".agents/skills/demo/SKILL.md", "demo body");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [
            {"id": "c1", "name": "skill_load", "arguments": "{\"name\":\"../outside\"}"},
            {"id": "c2", "name": "skill_load", "arguments": "{\"name\":\"missing\"}"}
        ]},
        {"text": "两个都失败了，符合预期。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "skill").unwrap();
    turn::run_turn_for(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "加载技能".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let snapshot = runtime.snapshot(&f.scope(), &config);
    let tools: Vec<_> = snapshot
        .messages
        .iter()
        .filter(|m| m.role == "tool")
        .collect();
    assert_eq!(tools.len(), 2);
    assert!(tools[0]
        .text
        .as_deref()
        .unwrap()
        .contains("skill_name_invalid"));
    assert!(tools[1]
        .text
        .as_deref()
        .unwrap()
        .contains("skill_not_found"));
}

#[test]
fn auto_compact_triggers_over_threshold() {
    let f = Fixture::new("compact");
    let mut config = mock_config();
    config.warn_ctx_pct = 50.0;
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    // 第一轮：usage 越阈值（120000/131072 ≈ 91.6%）→ 自动压缩（摘要消耗一条脚本）。
    let script = r#"{"responses": [
        {"text": "长回答。", "usage": {"input_tokens": 120000, "cached_tokens": 60000, "output_tokens": 500}},
        {"text": "会话摘要：用户问了_threshold 压缩。"},
        {"text": "压缩后继续。"}
    ]}"#;
    // 注意：阈值压缩发生在轮完成时（calls 为空），压缩后直接 break——
    // 第三条脚本是「压缩后的下一轮提问」才会用到；本轮只弹两条。
    let mut client = MockClient::from_str(script, "compact").unwrap();
    turn::run_turn_for(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "问个大的".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let types = sink.types();
    assert!(types.contains(&"compact".to_string()), "{types:?}");
    let compact = sink
        .events()
        .into_iter()
        .find(|e| e.get("type").and_then(|t| t.as_str()) == Some("compact"))
        .unwrap();
    assert!(compact["summary"].as_str().unwrap().contains("会话摘要"));

    // 面板有 compact 消息；LLM 历史已换成摘要 + 上下文注入（不静默截断）。
    let snapshot = runtime.snapshot(&f.scope(), &config);
    assert!(snapshot.messages.iter().any(|m| m.role == "compact"));
    // 压缩后 usage 仍是压缩前读数（下轮请求才更新）——但历史已被替换。
    // 用第二轮验证新历史生效：
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink2 = CollectSink::default();
    let mut client2 = MockClient::from_str(script, "compact2").unwrap();
    // 弹掉前两条（它们是为上一轮写的）——直接快进：本轮脚本只用第三条。
    client2.complete(&lumir_lib::harness::llm::Request {
        system: "x".into(),
        input: vec![],
        tools: vec![],
    });
    client2.complete(&lumir_lib::harness::llm::Request {
        system: "x".into(),
        input: vec![],
        tools: vec![],
    });
    turn::run_turn_for(
        &sink2,
        &runtime,
        &f.scope(),
        &config,
        "接着问".into(),
        &mut client2,
    );
    runtime.release_turn(&f.scope());
    let snapshot = runtime.snapshot(&f.scope(), &config);
    // user 消息 = 压缩摘要注入 + 上下文节 + 两条真实提问。
    let users: Vec<&str> = snapshot
        .messages
        .iter()
        .filter(|m| m.role == "user")
        .filter_map(|m| m.text.as_deref())
        .collect();
    assert!(users.iter().any(|t| t.contains("接着问")), "{users:?}");
}

#[test]
fn context_overflow_retries_once_after_compact() {
    let f = Fixture::new("overflow");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    // 第一条：上下文超限错误 → 自动压缩（弹第二条作摘要）→ 重试（弹第三条）成功。
    let script = r#"{"responses": [
        {"error": {"code": "context_length_exceeded", "message": "input too long"}},
        {"text": "摘要：前面在聊溢出重试。"},
        {"text": "重试成功。", "usage": {"input_tokens": 100, "cached_tokens": 50, "output_tokens": 5}}
    ]}"#;
    let mut client = MockClient::from_str(script, "overflow").unwrap();
    turn::run_turn_for(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "问".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let types = sink.types();
    // 有 compact 事件 + 最终 done（重试成功，无 error 终态）。
    assert!(types.contains(&"compact".to_string()), "{types:?}");
    assert!(!types.contains(&"error".to_string()), "{types:?}");
    assert_eq!(types.last().unwrap(), "done");
    let snapshot = runtime.snapshot(&f.scope(), &config);
    assert!(snapshot
        .messages
        .iter()
        .any(|m| m.text.as_deref() == Some("重试成功。")));
}

#[test]
fn vault_scoping_switch_restore_and_reset() {
    let f = Fixture::new("scoping");
    let runtime = f.runtime();
    let config = mock_config();

    // vault A 提问一轮。
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink_a = CollectSink::default();
    let mut client = MockClient::from_str(r#"{"responses": [{"text": "A 的回答"}]}"#, "a").unwrap();
    turn::run_turn_for(
        &sink_a,
        &runtime,
        &f.scope(),
        &config,
        "A 的问题".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    // 切到 vault B（另一个根目录）：空会话、独立状态。
    let vault_b = f.root.join("vault-b");
    std::fs::create_dir_all(&vault_b).unwrap();
    let scope_b = VaultScope {
        root: vault_b.clone(),
        policy: IgnorePolicy::load(&vault_b, &[".gitignore".to_string()]),
    };
    let snap_b = runtime.snapshot(&scope_b, &config);
    assert!(snap_b.messages.is_empty(), "B 是空会话");

    // 切回 A：会话原样恢复。
    let snap_a = runtime.snapshot(&f.scope(), &config);
    assert_eq!(snap_a.messages.len(), 2, "A 的会话还在");

    // 新会话重置：消息清空、JSONL 文件不受影响（继续追加而不是截断）。
    let jsonl_path = f.root.join("xdg/lumir/harness").join(format!(
        "{}.jsonl",
        sanitize_name(&f.vault().display().to_string())
    ));
    let before = std::fs::read_to_string(&jsonl_path)
        .unwrap()
        .lines()
        .count();
    runtime.reset_session(&f.scope());
    let snap = runtime.snapshot(&f.scope(), &config);
    assert!(snap.messages.is_empty(), "重置后空态");
    // r1 P2-1：重置动作本身留一条 session_reset（JSONL 可辨识「新会话」）。
    let jsonl_now = std::fs::read_to_string(&jsonl_path).unwrap();
    assert!(
        jsonl_now.contains("\"kind\":\"session_reset\""),
        "{jsonl_now}"
    );
    // 重置后再问一轮：jsonl 追加（行数增长），文件没被动过。
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink2 = CollectSink::default();
    let mut client2 = MockClient::from_str(r#"{"responses": [{"text": "新话题"}]}"#, "b").unwrap();
    turn::run_turn_for(
        &sink2,
        &runtime,
        &f.scope(),
        &config,
        "新话题问题".into(),
        &mut client2,
    );
    runtime.release_turn(&f.scope());
    let after = std::fs::read_to_string(&jsonl_path)
        .unwrap()
        .lines()
        .count();
    assert!(after > before, "jsonl append-only：{before} -> {after}");
    // 系统上下文重新装配（新会话对象）。
    let snap = runtime.snapshot(&f.scope(), &config);
    assert_eq!(snap.messages.len(), 2);
}

#[test]
fn busy_turn_rejects_second_send() {
    let f = Fixture::new("busy");
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let err: CommandError = runtime.acquire_turn(&f.scope()).unwrap_err();
    assert_eq!(err.code, "harness_busy");
    runtime.release_turn(&f.scope());
}

#[test]
fn unknown_tool_error_feeds_back() {
    let f = Fixture::new("unknowntool");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "fs_delete", "arguments": "{}"}]},
        {"text": "没有这个工具，算了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "unknown").unwrap();
    turn::run_turn_for(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "删文件".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());
    let snapshot = runtime.snapshot(&f.scope(), &config);
    let tool = snapshot.messages.iter().find(|m| m.role == "tool").unwrap();
    assert!(tool.text.as_deref().unwrap().contains("tool_unknown"));
}

#[test]
fn patch_conflict_when_file_changes_during_approval() {
    // r1 P2-2：批准窗内用户改了文件（旧内容落盘）——采纳执行必须以预览基准 revision
    // 走 CAS，变了就 document_conflict 回送模型，落盘不与已批准 diff 静默分叉。
    let f = Fixture::new("approval-cas");
    f.write("a.md", "old\n");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_patch",
            "arguments": "{\"path\":\"a.md\",\"edits\":[{\"old_string\":\"old\",\"new_string\":\"patched\"}]}"}]},
        {"text": "文件被改了，我需要重新生成 diff。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "cas").unwrap();
    let worker = {
        let sink = sink.clone();
        let runtime = runtime.clone();
        let scope = f.scope();
        let config = config.clone();
        std::thread::spawn(move || {
            turn::run_turn_for(
                &sink,
                &runtime,
                &scope,
                &config,
                "改成 patched".into(),
                &mut client,
            );
        })
    };
    sink.wait_for(
        |events| {
            events
                .iter()
                .any(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        },
        "approval_request 事件",
    );
    // 批准窗内：文件被外部修改（old_string 在新内容里仍唯一命中——
    // 若无 CAS 基准，patch 会静默应用到新内容上）。
    std::fs::write(f.vault().join("a.md"), "old\n用户手改的一行\n").unwrap();
    let id = sink
        .events()
        .into_iter()
        .find(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    runtime
        .with_session(&f.scope(), |s| s.resolve_approval(&id, true, None))
        .expect("resolve ok")
        .expect("resolve ok");
    worker.join().unwrap();

    // 结果：document_conflict 回送模型；磁盘保持用户改后的内容（无分叉、无覆盖）。
    let snapshot = runtime.snapshot(&f.scope(), &config);
    let tool = snapshot.messages.iter().find(|m| m.role == "tool").unwrap();
    assert_eq!(tool.status.as_deref(), Some("error"));
    assert!(
        tool.text.as_deref().unwrap().contains("document_conflict"),
        "{}",
        tool.text.as_deref().unwrap()
    );
    assert_eq!(
        std::fs::read_to_string(f.vault().join("a.md")).unwrap(),
        "old\n用户手改的一行\n"
    );
}

#[test]
fn cli_run_gated_and_allow_rule_executes() {
    // allow 规则：cli(echo *) 免闸直执行。
    let f = Fixture::new("cliallow");
    let mut config = mock_config();
    config.permissions = HarnessPermissions {
        allow: vec!["cli(echo *)".into()],
        deny: vec![],
    };
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "cli_run",
            "arguments": "{\"command\":\"echo\",\"args\":[\"hello\"]}"}]},
        {"text": "执行完了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "cli").unwrap();
    turn::run_turn_for(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "跑 echo".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());
    let snapshot = runtime.snapshot(&f.scope(), &config);
    let tool = snapshot.messages.iter().find(|m| m.role == "tool").unwrap();
    assert_eq!(tool.status.as_deref(), Some("done"));
    assert!(tool.text.as_deref().unwrap().contains("hello"));
    // approval_request 未出现（allow 免闸）。
    assert!(!sink.types().contains(&"approval_request".to_string()));
}

/// M305 回归（下游一侧）：一轮里 output.calls 的每条调用恰好执行一次、恰好压入一对
/// function_call / function_call_output，不出现同一 call_id 重复入 input。
///
/// 重复入表的根因在 SSE 解析层（output_item.done 与 completed 双收集），已由 llm.rs 的
/// 单测钉死；MockClient 直接合成 TurnOutput 不走 SSE，所以这里钉的是 handle_call 这一侧：
/// 只要上游每条调用只给一次，input 里就不会有重复项。两条独立断言合起来覆盖整条链路。
#[test]
fn each_call_enters_input_exactly_once() {
    let f = Fixture::new("dedupe-input");
    f.write("a.md", "content\n");
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [
            {"id": "call_1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"},
            {"id": "call_2", "name": "vault_search", "arguments": "{\"query\":\"content\"}"}
        ]},
        {"text": "读完了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "dedupe").unwrap();
    turn::run_turn_for(
        &sink,
        &runtime,
        &f.scope(),
        &mock_config(),
        "读".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let call_ids: Vec<String> = runtime
        .with_session(&f.scope(), |s| {
            s.input()
                .iter()
                .filter(|item| item.get("type").and_then(|t| t.as_str()) == Some("function_call"))
                .map(|item| {
                    item.get("call_id")
                        .and_then(|c| c.as_str())
                        .unwrap_or_default()
                        .to_string()
                })
                .collect()
        })
        .unwrap();
    assert_eq!(
        call_ids,
        vec!["call_1", "call_2"],
        "每条调用恰好入一次 input（无重复 call_id）"
    );

    // 工具恰好执行 2 次（面板 tool 消息数）。
    let tool_msgs = runtime
        .snapshot(&f.scope(), &mock_config())
        .messages
        .iter()
        .filter(|m| m.role == "tool")
        .count();
    assert_eq!(tool_msgs, 2);
}
