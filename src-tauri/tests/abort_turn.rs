//! Harness 轮次中断测试（M348，change move-harness-to-pane-chat-frame design §5）：
//! 中断语义是「不再继续」，不是回滚——
//! - 已流式产出内容保留在 transcript 并标注「已停止」（面板消息 status = "stopped"）；
//! - 待决批准项随中断收回（通道 Withdrawn，工具结果如实记 turn_aborted）；
//! - 工具循环停止执行余下调用；JSONL 如实记录中断事件（turn_abort_requested /
//!   turn_aborted / approval_withdrawn）；中断后可立即开新一轮。
//!
//! 环境隔离与串行纪律同 harness_runtime.rs（XDG_CONFIG_HOME / HOME 指临时目录，
//! env 进程全局故静态锁串行）。

use lumir_lib::commands::CommandError;
use lumir_lib::config::{HarnessConfig, HarnessProvider};
use lumir_lib::fs_io::IgnorePolicy;
use lumir_lib::harness::events::EventSink;
use lumir_lib::harness::llm::{LlmClient, MockClient};
use lumir_lib::harness::turn;
use lumir_lib::harness::{Runtime, VaultScope};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

static ENV_LOCK: Mutex<()> = Mutex::new(());

/// 隔离环境的测试夹具（与 harness_runtime.rs 同形制：临时 XDG_CONFIG_HOME + HOME + 合成 vault）。
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
            std::env::temp_dir().join(format!("lumir-m348-it-{}-{}", name, std::process::id()));
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

/// 夹具的唯一一份 JSONL 留存（文件名是 `jsonl::sanitize` 的产物，测试侧不复刻该算法）。
fn harness_jsonl_path(fixture: &Fixture) -> PathBuf {
    let dir = fixture.root.join("xdg/lumir/harness");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("读留存目录 {} 失败：{e}", dir.display()))
        .map(|entry| entry.unwrap().path())
        .filter(|p| p.extension().map(|x| x == "jsonl").unwrap_or(false))
        .collect();
    files.sort();
    assert_eq!(files.len(), 1, "应恰有一份 JSONL 留存：{files:?}");
    files.pop().unwrap()
}

/// 轮次入队标志：user 消息入队（循环开始前）即认为线程已进入 complete() 窗口——
/// 配合脚本化 `delay_ms` 保证中断落在 LLM 调用在途期间（而不是之前/之后）。
fn wait_turn_started(runtime: &Runtime, scope: &VaultScope) {
    for _ in 0..500 {
        if runtime
            .with_session(scope, |s| !s.input().is_empty())
            .unwrap_or(false)
        {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    panic!("轮次未在预期窗口内开始");
}

fn drive_turn(
    sink: &CollectSink,
    runtime: &Runtime,
    scope: &VaultScope,
    config: &HarnessConfig,
    message: String,
    client: &mut dyn LlmClient,
) {
    turn::run_turn_for(sink, runtime, scope, config, message, None, client);
}

/// 中断落点 ①：LLM 调用在途（delay_ms 撑住窗口）——产出保留、标注「已停止」、
/// 工具调用不再执行、JSONL 如实记录、面板经 aborted 事件收口。
#[test]
fn abort_during_llm_call_preserves_text_marks_stopped() {
    let f = Fixture::new("abort-inflight");
    f.write("a.md", "内容\n");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    // 第一条：delay 300ms 撑窗口，文本 + 工具调用（中断后不得执行）；第二条不该被弹到。
    let script = r#"{"responses": [
        {"text": "前半段回答。", "chunks": ["前半段", "回答。"], "delay_ms": 300,
         "tool_calls": [{"id": "c1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}]},
        {"text": "第二轮的话。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "abort-inflight").unwrap();
    let worker = {
        let sink = sink.clone();
        let runtime = runtime.clone();
        let scope = f.scope();
        let config = config.clone();
        std::thread::spawn(move || {
            drive_turn(&sink, &runtime, &scope, &config, "问题".into(), &mut client);
        })
    };
    wait_turn_started(&runtime, &f.scope());
    runtime.request_abort(&f.scope()).expect("abort ok");
    worker.join().unwrap();
    runtime.release_turn(&f.scope());

    // 产出保留：assistant 消息原文在场、标注 stopped。
    let snapshot = runtime.snapshot(&f.scope(), &config);
    let assistant = snapshot
        .messages
        .iter()
        .find(|m| m.role == "assistant")
        .expect("已产出内容保留在 transcript");
    assert_eq!(assistant.text.as_deref(), Some("前半段回答。"));
    assert_eq!(
        assistant.status.as_deref(),
        Some("stopped"),
        "{assistant:?}"
    );
    // 不再继续：工具调用未执行（无 tool 消息、无 function_call 入历史）。
    assert!(
        !snapshot.messages.iter().any(|m| m.role == "tool"),
        "{:?}",
        snapshot
            .messages
            .iter()
            .map(|m| &m.role)
            .collect::<Vec<_>>()
    );
    let call_count = runtime
        .with_session(&f.scope(), |s| {
            s.input()
                .iter()
                .filter(|it| it.get("type").and_then(|t| t.as_str()) == Some("function_call"))
                .count()
        })
        .unwrap();
    assert_eq!(call_count, 0, "中断后不得执行工具调用");
    // 已产出文本照常入 LLM 侧历史（不回滚）。
    let input = runtime
        .with_session(&f.scope(), |s| s.input().to_vec())
        .unwrap();
    assert!(
        input.iter().any(|it| {
            it["role"] == "assistant" && it["content"][0]["text"].as_str() == Some("前半段回答。")
        }),
        "{input:#?}"
    );

    // 事件：文本 chunk 照常发（面板实时渲染保留内容），终态是 aborted。
    let types = sink.types();
    assert!(types.contains(&"text_chunk".to_string()), "{types:?}");
    assert!(!types.contains(&"tool_call".to_string()), "{types:?}");
    assert!(!types.contains(&"done".to_string()), "{types:?}");
    assert_eq!(types.last().unwrap(), "aborted", "{types:?}");

    // JSONL 如实记录中断事件（请求 + 收口两条都有）。
    let jsonl = std::fs::read_to_string(harness_jsonl_path(&f)).unwrap();
    assert!(
        jsonl.contains("\"kind\":\"turn_abort_requested\""),
        "{jsonl}"
    );
    assert!(jsonl.contains("\"kind\":\"turn_aborted\""), "{jsonl}");
    assert!(jsonl.contains("\"kind\":\"assistant_text\""), "{jsonl}");
    // 中断优先于一切：本轮的错误/空响应判定不再追加错误行（jsonl 无 llm_error）。
    assert!(!jsonl.contains("\"kind\":\"llm_error\""), "{jsonl}");
}

/// 中断落点 ②：批准闸等待中——待决批准项随中断收回（快照 pending 清空、
/// 工具结果如实记 turn_aborted），磁盘未变，循环随即收口。
#[test]
fn abort_withdraws_pending_approval() {
    let f = Fixture::new("abort-gate");
    f.write("a.md", "old\n");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    // patch 默认 ask 档：挂起等批准；中断收回待决项。
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_patch",
            "arguments": "{\"path\":\"a.md\",\"edits\":[{\"old_string\":\"old\",\"new_string\":\"patched\"}]}"}]},
        {"text": "收到。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "abort-gate").unwrap();
    let worker = {
        let sink = sink.clone();
        let runtime = runtime.clone();
        let scope = f.scope();
        let config = config.clone();
        std::thread::spawn(move || {
            drive_turn(
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
    // 中断前：待决项在快照里。
    let pending = runtime.snapshot(&f.scope(), &config).pending_approval;
    assert!(pending.is_some(), "中断前应有待决批准项");
    runtime.request_abort(&f.scope()).expect("abort ok");
    worker.join().unwrap();
    runtime.release_turn(&f.scope());

    // 待决批准项随中断收回：快照清空，approval 卡片数据源消失。
    let snapshot = runtime.snapshot(&f.scope(), &config);
    assert!(snapshot.pending_approval.is_none(), "待决项应随中断收回");
    // 工具结果如实记 turn_aborted（不混同 approval_rejected / approval_stale）。
    let tool = snapshot.messages.iter().find(|m| m.role == "tool").unwrap();
    assert_eq!(tool.status.as_deref(), Some("error"));
    assert!(
        tool.text.as_deref().unwrap().contains("turn_aborted"),
        "{}",
        tool.text.as_deref().unwrap()
    );
    // 调用未执行：磁盘未变。
    assert_eq!(
        std::fs::read_to_string(f.vault().join("a.md")).unwrap(),
        "old\n"
    );
    // 终态事件是 aborted；JSONL 有 approval_withdrawn + turn_aborted。
    assert_eq!(sink.types().last().unwrap(), "aborted");
    let jsonl = std::fs::read_to_string(harness_jsonl_path(&f)).unwrap();
    assert!(jsonl.contains("\"kind\":\"approval_withdrawn\""), "{jsonl}");
    assert!(jsonl.contains("\"kind\":\"turn_aborted\""), "{jsonl}");
    // 决定记录（kind=approval）不存在——该项是被收回的，不是被决定的。
    assert!(!jsonl.contains("\"kind\":\"approval\""), "{jsonl}");
}

/// 中断落点 ③：多调用列表执行中——余下调用不再执行，本轮已产出文本保留并标注。
#[test]
fn abort_between_tool_calls_stops_remaining() {
    let f = Fixture::new("abort-between");
    f.write("a.md", "内容\n");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    // 第一条响应：文本 + [patch(ask，挂起等批准), vault_read(allow)]。
    // 中断收回 patch 的待决项 → handle_call 返回 → 循环顶部停止检查点截住第二个调用。
    let script = r#"{"responses": [
        {"text": "我先改再看。",
         "tool_calls": [
            {"id": "c1", "name": "vault_patch",
             "arguments": "{\"path\":\"a.md\",\"edits\":[{\"old_string\":\"内容\",\"new_string\":\"改后\"}]}"},
            {"id": "c2", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}
         ]},
        {"text": "不该到这。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "abort-between").unwrap();
    let worker = {
        let sink = sink.clone();
        let runtime = runtime.clone();
        let scope = f.scope();
        let config = config.clone();
        std::thread::spawn(move || {
            drive_turn(
                &sink,
                &runtime,
                &scope,
                &config,
                "改并读".into(),
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
    runtime.request_abort(&f.scope()).expect("abort ok");
    worker.join().unwrap();
    runtime.release_turn(&f.scope());

    let snapshot = runtime.snapshot(&f.scope(), &config);
    // 已产出文本保留并标注 stopped（中断前已入队的本轮 assistant 消息）。
    let assistant = snapshot
        .messages
        .iter()
        .find(|m| m.role == "assistant")
        .expect("本轮文本应保留");
    assert_eq!(assistant.text.as_deref(), Some("我先改再看。"));
    assert_eq!(assistant.status.as_deref(), Some("stopped"));
    // 余下调用不再执行：恰好一个 tool 消息（patch，turn_aborted），vault_read 未跑。
    let tools: Vec<_> = snapshot
        .messages
        .iter()
        .filter(|m| m.role == "tool")
        .collect();
    assert_eq!(tools.len(), 1, "{snapshot:?}");
    assert!(tools[0].text.as_deref().unwrap().contains("turn_aborted"));
    let call_names: Vec<String> = runtime
        .with_session(&f.scope(), |s| {
            s.input()
                .iter()
                .filter(|it| it.get("type").and_then(|t| t.as_str()) == Some("function_call"))
                .map(|it| it["name"].as_str().unwrap_or("?").to_string())
                .collect()
        })
        .unwrap();
    assert_eq!(call_names, vec!["vault_patch"], "vault_read 不得执行");
    // 成组压栈的另一半保证（M360）：已入 input 的调用项必须与输出项成对——悬空的
    // function_call 会让**下一轮**请求被 provider 以 "No tool output found for tool call"
    // 拒掉（未执行的调用则必须两项都不入，上面 call_names 已钉）。
    let (call_ids, output_ids) = runtime
        .with_session(&f.scope(), |s| {
            let ids = |kind: &str| -> Vec<String> {
                s.input()
                    .iter()
                    .filter(|it| it.get("type").and_then(|t| t.as_str()) == Some(kind))
                    .map(|it| {
                        it.get("call_id")
                            .and_then(|c| c.as_str())
                            .unwrap_or_default()
                            .to_string()
                    })
                    .collect()
            };
            (ids("function_call"), ids("function_call_output"))
        })
        .unwrap();
    assert_eq!(
        call_ids, output_ids,
        "每条入 input 的调用项都要有同 call_id 的输出项"
    );
    // 磁盘未变（patch 未执行）。
    assert_eq!(
        std::fs::read_to_string(f.vault().join("a.md")).unwrap(),
        "内容\n"
    );
    assert_eq!(sink.types().last().unwrap(), "aborted");
}

/// 中断落点 ④：轮次已结束（busy 已释放）——abort 返回 harness_not_running，
/// 会话内容不受影响。
#[test]
fn abort_after_turn_finished_is_rejected() {
    let f = Fixture::new("abort-idle");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    let mut client = MockClient::from_str(r#"{"responses": [{"text": "答"}]}"#, "idle").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "问".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let err: CommandError = runtime.request_abort(&f.scope()).unwrap_err();
    assert_eq!(err.code, "harness_not_running");
    // 正常完成的轮次无中断痕迹。
    let snapshot = runtime.snapshot(&f.scope(), &config);
    let assistant = snapshot
        .messages
        .iter()
        .find(|m| m.role == "assistant")
        .unwrap();
    assert_eq!(assistant.status, None, "正常完成不标 stopped");
    assert_eq!(sink.types().last().unwrap(), "done");
    let jsonl = std::fs::read_to_string(harness_jsonl_path(&f)).unwrap();
    assert!(!jsonl.contains("turn_aborted"), "{jsonl}");
}

/// 回归：中断只标注**本轮**的 assistant 消息——上一轮正常完成的消息绝不误标
/// （base 计数：一轮开始时面板已有上一轮的历史）。
#[test]
fn abort_never_marks_previous_turn_messages() {
    let f = Fixture::new("abort-prevturn");
    let config = mock_config();
    let runtime = f.runtime();

    // 上一轮：正常完成，assistant 消息不带 stopped。
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink1 = CollectSink::default();
    let mut client1 =
        MockClient::from_str(r#"{"responses": [{"text": "上一轮的完整回答。"}]}"#, "prev").unwrap();
    drive_turn(
        &sink1,
        &runtime,
        &f.scope(),
        &config,
        "上一轮问题".into(),
        &mut client1,
    );
    runtime.release_turn(&f.scope());
    assert_eq!(sink1.types().last().unwrap(), "done");

    // 本轮：中断在首个 complete 在途（delay 撑窗口），该轮无文本产出——
    // 旧实现（无 base 的全局倒找）会把上一轮的 assistant 误标 stopped。
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink2 = CollectSink::default();
    let script = r#"{"responses": [
        {"delay_ms": 300, "tool_calls": [{"id": "c1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}]},
        {"text": "不该到这。"}
    ]}"#;
    let mut client2 = MockClient::from_str(script, "cur").unwrap();
    let worker = {
        let sink = sink2.clone();
        let runtime = runtime.clone();
        let scope = f.scope();
        let config = config.clone();
        std::thread::spawn(move || {
            drive_turn(
                &sink,
                &runtime,
                &scope,
                &config,
                "本轮问题".into(),
                &mut client2,
            );
        })
    };
    wait_turn_started(&runtime, &f.scope());
    runtime.request_abort(&f.scope()).expect("abort ok");
    worker.join().unwrap();
    runtime.release_turn(&f.scope());

    let snapshot = runtime.snapshot(&f.scope(), &config);
    let stopped: Vec<&str> = snapshot
        .messages
        .iter()
        .filter(|m| m.status.as_deref() == Some("stopped"))
        .filter_map(|m| m.text.as_deref())
        .collect();
    assert_eq!(stopped, Vec::<&str>::new(), "本轮无产出时不得误标任何消息");
    let prev = snapshot
        .messages
        .iter()
        .find(|m| m.text.as_deref() == Some("上一轮的完整回答。"))
        .unwrap();
    assert_eq!(prev.status, None, "上一轮消息保持正常完成态");
    // 本轮的 user 消息入账、无 assistant 产出、无工具执行。
    assert_eq!(sink2.types().last().unwrap(), "aborted");
    assert!(!sink2.types().contains(&"tool_call".to_string()));
}

/// 中断后 composer 立即可继续提问：新一轮不受上一轮的停止请求污染（标志已复位），
/// 正常跑到 done。
#[test]
fn new_turn_after_abort_runs_clean() {
    let f = Fixture::new("abort-rethen");
    let config = mock_config();
    let runtime = f.runtime();
    // 第一轮：中断在 LLM 在途（delay 撑窗口）。
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"text": "被打断的话。", "delay_ms": 300},
        {"text": "新一轮的回答。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "re").unwrap();
    let worker = {
        let sink = sink.clone();
        let runtime = runtime.clone();
        let scope = f.scope();
        let config = config.clone();
        std::thread::spawn(move || {
            drive_turn(
                &sink,
                &runtime,
                &scope,
                &config,
                "第一个问题".into(),
                &mut client,
            );
        })
    };
    wait_turn_started(&runtime, &f.scope());
    runtime.request_abort(&f.scope()).expect("abort ok");
    worker.join().unwrap();
    runtime.release_turn(&f.scope());
    assert_eq!(sink.types().last().unwrap(), "aborted");

    // 停止后可立即再发问（新消息开新一轮）：标志不复位的话这里会立刻被 abort 截断。
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink2 = CollectSink::default();
    let mut client2 = MockClient::from_str(script, "re2").unwrap();
    // 快进到第二条脚本（第一条是上一轮的）。
    client2.complete(
        &lumir_lib::harness::llm::Request {
            system: "x".into(),
            input: vec![],
            tools: vec![],
            effort: Default::default(),
        },
        &lumir_lib::harness::llm::DiscardStreamSink,
    );
    drive_turn(
        &sink2,
        &runtime,
        &f.scope(),
        &config,
        "第二个问题".into(),
        &mut client2,
    );
    runtime.release_turn(&f.scope());

    assert_eq!(sink2.types().last().unwrap(), "done", "{:?}", sink2.types());
    let snapshot = runtime.snapshot(&f.scope(), &config);
    let last_assistant = snapshot
        .messages
        .iter()
        .rev()
        .find(|m| m.role == "assistant")
        .unwrap();
    assert_eq!(last_assistant.text.as_deref(), Some("新一轮的回答。"));
    assert_eq!(last_assistant.status, None, "新一轮正常完成不标 stopped");
    // 历史里两条 assistant 消息：第一条标 stopped（中断轮），第二条不标。
    let stopped_count = snapshot
        .messages
        .iter()
        .filter(|m| m.status.as_deref() == Some("stopped"))
        .count();
    assert_eq!(stopped_count, 1, "{snapshot:?}");
}

/// 在途停止（M369）：分片按 `chunk_delay_ms` **逐片到达**——第一片上屏后、后续分片还隔着片间隔，
/// 此刻点停止 ⇒ 产出循环在流中问到停止标志即收流（不再等整条响应跑完），**已产出的分片保留**
/// 并标注「已停止」；末片从未上屏。
///
/// 判据的区分度：改动前 `complete` 一次返回整条（三片全在），不可能出现「有第一片、无末片」
/// 的中间态，末片断言必红；本测试因此真的在判「流中收口」。
#[test]
fn abort_midstream_keeps_produced_chunks() {
    let f = Fixture::new("abort-midstream");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope()).unwrap();
    let sink = CollectSink::default();
    // 三片、片间隔 500ms：第一片立刻转发，末片要等两个间隔（1s 之后）。停止落在第一段的间隔里。
    let script = r#"{"responses": [
        {"text": "STREAM-A 第一片。STREAM-B 第二片。STREAM-C 第三片。",
         "chunks": ["STREAM-A 第一片。", "STREAM-B 第二片。", "STREAM-C 第三片。"],
         "chunk_delay_ms": 500}
    ]}"#;
    let mut client = MockClient::from_str(script, "abort-midstream").unwrap();
    let worker = {
        let sink = sink.clone();
        let runtime = runtime.clone();
        let scope = f.scope();
        let config = config.clone();
        std::thread::spawn(move || {
            drive_turn(&sink, &runtime, &scope, &config, "问题".into(), &mut client);
        })
    };
    // 第一片到达 = 流式已经开始（`complete` 尚未返回），就在这个窗口里点停止。
    sink.wait_for(
        |events| {
            events
                .iter()
                .any(|e| e["type"] == "text_chunk" && e["text"] == "STREAM-A 第一片。")
        },
        "第一片 text_chunk 事件",
    );
    runtime.request_abort(&f.scope()).expect("abort ok");
    worker.join().unwrap();
    runtime.release_turn(&f.scope());

    // 已产出内容保留并标注；末片从未产出（流中收口，不是等它跑完再在检查点截住）。
    let snapshot = runtime.snapshot(&f.scope(), &config);
    let assistant = snapshot
        .messages
        .iter()
        .find(|m| m.role == "assistant")
        .expect("已产出内容保留在 transcript");
    let text = assistant.text.as_deref().unwrap_or("");
    assert!(text.starts_with("STREAM-A 第一片。"), "{text}");
    assert!(!text.contains("STREAM-C"), "末片不该产出：{text}");
    assert_eq!(assistant.status.as_deref(), Some("stopped"));
    // 事件序：文本分片在流中转发了（面板实时渲染保留内容），终态是 aborted；末片无 text_chunk。
    let texts: Vec<String> = sink
        .events()
        .iter()
        .filter(|e| e["type"] == "text_chunk")
        .filter_map(|e| e["text"].as_str().map(str::to_string))
        .collect();
    assert!(
        texts.contains(&"STREAM-A 第一片。".to_string()),
        "{texts:?}"
    );
    assert!(
        !texts.iter().any(|t| t.contains("STREAM-C")),
        "末片不得有 text_chunk 事件：{texts:?}"
    );
    assert_eq!(sink.types().last().unwrap(), "aborted");
    let jsonl = std::fs::read_to_string(harness_jsonl_path(&f)).unwrap();
    assert!(jsonl.contains("\"kind\":\"turn_aborted\""), "{jsonl}");
    assert!(jsonl.contains("STREAM-A 第一片。"), "{jsonl}");
}
