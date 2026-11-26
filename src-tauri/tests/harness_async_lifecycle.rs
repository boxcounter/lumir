//! Harness 异步事件与任务生命周期的对抗测试（M845）。
//!
//! 归属 oracle 取生产既有的三条不变量，测试只证明它们在对抗时序下仍然成立——不为测试放宽任何
//! 判定，也不新增接缝：
//!
//! 1. **轮次 / vault 归属**：`acquire_turn` 的 busy 协议把「同 vault 并发送」与「busy 期间换
//!    会话 / 恢复」挡住（`harness_busy`）；`request_abort` 只作用于**本 vault 在途轮次**
//!    （别处返回 `harness_not_running`）。停止之后再到达的 provider 旧响应不得执行工具、不得
//!    产生第二个终态——终态事件一轮只有一条。
//! 2. **结果归属**：标题任务落盘前复核 `vault_key` + `session_id`（`title::run_job_with_client`），
//!    轮换会话或切 vault 之后，旧任务的结果一个字段都不许碰新会话。
//! 3. **批准归属**：中断收回待决批准项；迟到的决定返回 `approval_not_found`，既不能执行被收回
//!    的调用，也不能作用到下一轮的新请求（请求 id 单调，不复用）。
//!
//! 全部驱动走 `turn::run_turn_for` + 脚本化 client / 手工构造句柄；环境隔离同 abort_turn.rs
//! （XDG_CONFIG_HOME / HOME / SHELL 指临时目录，进程级 env 用静态锁串行）。不发真实外部请求、
//! 不起真机。

use lumir_lib::config::{self, HarnessConfig};
use lumir_lib::fs_io::IgnorePolicy;
use lumir_lib::harness::events::{self, EventSink, StreamSink};
use lumir_lib::harness::llm::{LlmClient, MockClient, Request, ToolCall, TurnError, TurnOutput};
use lumir_lib::harness::title::{self, TitleJob, TitleTrigger};
use lumir_lib::harness::{turn, Runtime, VaultScope};
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

static ENV_LOCK: Mutex<()> = Mutex::new(());

// ---------------------------------------------------------------------------
// 夹具：隔离 env + 两个合成 vault（归属测试的最小对照面）
// ---------------------------------------------------------------------------

struct Fixture {
    root: PathBuf,
    previous_xdg: Option<std::ffi::OsString>,
    previous_home: Option<std::ffi::OsString>,
    previous_shell: Option<std::ffi::OsString>,
    _guard: std::sync::MutexGuard<'static, ()>,
}

impl Fixture {
    fn new(name: &str) -> Self {
        let guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let root =
            std::env::temp_dir().join(format!("lumir-m845-it-{}-{}", name, std::process::id()));
        if root.exists() {
            std::fs::remove_dir_all(&root).unwrap();
        }
        std::fs::create_dir_all(&root).unwrap();
        let previous_xdg = std::env::var_os("XDG_CONFIG_HOME");
        let previous_home = std::env::var_os("HOME");
        let previous_shell = std::env::var_os("SHELL");
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
        std::env::set_var("HOME", root.join("home"));
        // 同 harness_runtime.rs：让 cli_path 的登录 shell 解析失败、回退进程 PATH。
        std::env::set_var("SHELL", root.join("no-login-shell"));
        std::fs::create_dir_all(root.join("xdg")).unwrap();
        std::fs::create_dir_all(root.join("home")).unwrap();
        for which in ["a", "b"] {
            std::fs::create_dir_all(root.join(which)).unwrap();
        }
        Self {
            root,
            previous_xdg,
            previous_home,
            previous_shell,
            _guard: guard,
        }
    }

    fn vault(&self, which: &str) -> PathBuf {
        self.root.join(which)
    }

    fn vault_id(which: &str) -> String {
        format!("vault-test-{which}")
    }

    fn scope(&self, which: &str) -> VaultScope {
        VaultScope {
            root: self.vault(which),
            policy: IgnorePolicy::load(
                &self.vault(which),
                &[".gitignore".to_string()],
                &lumir_lib::config::VaultConfig::default().ignore,
            ),
            vault_id: Self::vault_id(which),
        }
    }

    fn sessions_dir(&self, which: &str) -> PathBuf {
        self.root
            .join("xdg/lumir/harness/sessions")
            .join(Self::vault_id(which))
    }

    /// 该 vault 全部留存文件的内容（按文件名序拼接）：断言「某一类记录在不在」的读口。
    fn session_files_text(&self, which: &str) -> String {
        let dir = self.sessions_dir(which);
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return String::new();
        };
        let mut files: Vec<PathBuf> = entries
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().map(|x| x == "jsonl").unwrap_or(false))
            .collect();
        files.sort();
        files
            .iter()
            .map(|path| std::fs::read_to_string(path).unwrap())
            .collect::<Vec<_>>()
            .join("\n")
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
        match &self.previous_shell {
            Some(v) => std::env::set_var("SHELL", v),
            None => std::env::remove_var("SHELL"),
        }
        std::fs::remove_dir_all(&self.root).ok();
    }
}

fn mock_config() -> HarnessConfig {
    config::test_mock(None)
}

/// 事件收集器（与 abort_turn.rs 同形制：真实事件序列就是判定归属的读口）。
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

    fn count_type(&self, wanted: &str) -> usize {
        self.types().iter().filter(|t| t.as_str() == wanted).count()
    }

    fn wait_for<F: Fn(&[serde_json::Value]) -> bool>(&self, predicate: F, what: &str) {
        for _ in 0..500 {
            if predicate(&self.events()) {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("等待超时：{what}；已收到事件 {:?}", self.types());
    }
}

fn drive_turn(
    sink: &dyn EventSink,
    runtime: &Runtime,
    scope: &VaultScope,
    config: &HarnessConfig,
    message: &str,
    client: &mut dyn LlmClient,
) {
    turn::run_turn_for(
        sink,
        runtime,
        scope,
        config,
        message.to_string(),
        None,
        client,
    );
}

/// 一轮正常完成的短回合（给「新会话落成」这类前置状态用）。
fn complete_text_turn(runtime: &Runtime, scope: &VaultScope, config: &HarnessConfig, text: &str) {
    runtime.acquire_turn(scope, config).unwrap();
    let sink = CollectSink::default();
    let scoped = events::ScopedSink::new(&sink, scope.key(), 0);
    let mut client = ScriptedClient::new(vec![ScriptStep::Text(text.to_string())]);
    drive_turn(&scoped, runtime, scope, config, "前置回合", &mut client);
    runtime.release_turn(scope);
    assert_eq!(sink.types().last().map(String::as_str), Some("done"));
}

// ---------------------------------------------------------------------------
// 脚本化 client（无网络：错误 / 文本按序弹出）
// ---------------------------------------------------------------------------

enum ScriptStep {
    Text(String),
    /// 流中断：已有半截正文 + 错误（provider 在流中途断开）。
    Interrupted(String, String, String),
}

struct ScriptedClient {
    steps: std::collections::VecDeque<ScriptStep>,
}

impl ScriptedClient {
    fn new(steps: Vec<ScriptStep>) -> Self {
        Self {
            steps: steps.into(),
        }
    }
}

impl LlmClient for ScriptedClient {
    fn complete(&mut self, _request: &Request, sink: &dyn StreamSink) -> TurnOutput {
        match self.steps.pop_front() {
            Some(ScriptStep::Text(text)) => {
                sink.text_delta(&text);
                TurnOutput {
                    text,
                    ..TurnOutput::default()
                }
            }
            Some(ScriptStep::Interrupted(text, code, message)) => {
                sink.text_delta(&text);
                TurnOutput {
                    text,
                    error: Some(TurnError::new(code, message, false)),
                    ..TurnOutput::default()
                }
            }
            None => TurnOutput {
                error: Some(TurnError::new("fixture_exhausted", "脚本已弹尽", false)),
                ..TurnOutput::default()
            },
        }
    }
}

/// 「provider 旧响应晚到」的替身：先流出一段正文，然后阻塞到主线程放行（放行时用户已点停止），
/// 放行后返回**完整**响应（正文 + 工具调用）——停止之后旧响应才到齐。
struct LateResponseClient {
    first_chunk: String,
    late_tail: String,
    late_call: ToolCall,
    gate: mpsc::Receiver<()>,
}

impl LlmClient for LateResponseClient {
    fn complete(&mut self, _request: &Request, sink: &dyn StreamSink) -> TurnOutput {
        sink.text_delta(&self.first_chunk);
        let _ = self.gate.recv_timeout(Duration::from_secs(10));
        TurnOutput {
            text: format!("{}{}", self.first_chunk, self.late_tail),
            calls: vec![self.late_call.clone()],
            ..TurnOutput::default()
        }
    }
}

fn late_response_client(gate: mpsc::Receiver<()>) -> LateResponseClient {
    LateResponseClient {
        first_chunk: "已流出的半句。".to_string(),
        late_tail: "迟到才到的下半句。".to_string(),
        late_call: ToolCall {
            call_id: "call_late".to_string(),
            name: "vault_read".to_string(),
            arguments: "{\"path\":\"a.md\"}".to_string(),
        },
        gate,
    }
}

fn scoped_worker(
    sink: &CollectSink,
    runtime: &Runtime,
    scope: &VaultScope,
    config: &HarnessConfig,
    client: LateResponseClient,
) -> std::thread::JoinHandle<()> {
    let sink = sink.clone();
    let runtime = runtime.clone();
    let scope = scope.clone();
    let config = config.clone();
    std::thread::spawn(move || {
        let scoped = events::ScopedSink::new(&sink, scope.key(), 0);
        let mut client = client;
        drive_turn(&scoped, &runtime, &scope, &config, "问题", &mut client);
    })
}

// ---------------------------------------------------------------------------
// 轮次 / vault 归属
// ---------------------------------------------------------------------------

/// 停止请求只作用于在途 vault：B 的停止被拒（`harness_not_running`）、B 可开新会话；A 在 bus y
/// 期间的新会话 / 恢复一律 `harness_busy`。停止之后 provider 旧响应才到：工具不执行、内容只
/// 保留一份、终态只有一条 `aborted`，且所有事件都盖着 A 的 vault 信封。
#[test]
fn stop_targets_only_the_inflight_vault_turn() {
    let f = Fixture::new("vault-ownership");
    std::fs::write(f.vault("a").join("a.md"), "甲\n").unwrap();
    let config = mock_config();
    let runtime = Runtime::default();
    let scope_a = f.scope("a");
    let scope_b = f.scope("b");
    // B 先有一份空闲会话（有会话但不在途）：停止请求走 harness_not_running 分支，而不是
    // harness_no_session（后者只说明「这个 vault 还没会话」，作用域判据另算）。
    complete_text_turn(&runtime, &scope_b, &config, "B 的基线回答。");
    runtime.acquire_turn(&scope_a, &config).unwrap();

    // 停止 / 换会话的作用域判据：B 没有在途轮次，一切照常；A 的 busy 挡住换会话。
    assert_eq!(
        runtime.request_abort(&scope_b).unwrap_err().code,
        "harness_not_running"
    );
    runtime
        .new_session(&scope_b)
        .expect("B 无在途轮次，开新会话应成功");
    assert_eq!(
        runtime.new_session(&scope_a).unwrap_err().code,
        "harness_busy"
    );
    assert_eq!(
        runtime
            .resume_session(&scope_a, &config, "s20260101-abcdef")
            .unwrap_err()
            .code,
        "harness_busy"
    );

    let sink = CollectSink::default();
    let (release, gate) = mpsc::channel();
    let worker = scoped_worker(
        &sink,
        &runtime,
        &scope_a,
        &config,
        late_response_client(gate),
    );
    sink.wait_for(
        |events| {
            events
                .iter()
                .any(|e| e.get("type").and_then(|t| t.as_str()) == Some("text_chunk"))
        },
        "首个流式分片",
    );
    // 用户点停止；随后才放行 provider 的旧响应。
    runtime.request_abort(&scope_a).expect("abort ok");
    release.send(()).unwrap();
    worker.join().unwrap();
    runtime.release_turn(&scope_a);

    // 终态唯一：只有一条 aborted，没有 done / tool_call（旧响应的工具调用不得执行）。
    let types = sink.types();
    assert_eq!(sink.count_type("aborted"), 1, "{types:?}");
    assert_eq!(
        types.last().map(String::as_str),
        Some("aborted"),
        "{types:?}"
    );
    assert_eq!(sink.count_type("done"), 0, "{types:?}");
    assert_eq!(sink.count_type("tool_call"), 0, "{types:?}");
    // 旧响应只保留一份：流式分片只发过首段，消息正文 = 首段 + 迟到尾段，没有重复推送。
    assert_eq!(sink.count_type("text_chunk"), 1, "{types:?}");
    let snapshot = runtime.snapshot(&scope_a, &config);
    let assistant = snapshot
        .messages
        .iter()
        .find(|m| m.role == "assistant")
        .expect("已产出内容保留");
    assert_eq!(
        assistant.text.as_deref(),
        Some("已流出的半句。迟到才到的下半句。")
    );
    assert_eq!(assistant.status.as_deref(), Some("stopped"));
    assert!(
        !snapshot.messages.iter().any(|m| m.role == "tool"),
        "旧响应的工具调用不得执行"
    );
    let calls = runtime
        .with_session(&scope_a, |s| {
            s.input()
                .iter()
                .filter(|it| it.get("type").and_then(|t| t.as_str()) == Some("function_call"))
                .count()
        })
        .unwrap();
    assert_eq!(calls, 0, "中断后不得留下悬空的 function_call");
    // 所有事件盖的是 A 的 vault 信封（B 没有收到任何事件）。
    for event in sink.events() {
        assert_eq!(
            event.get("vault").and_then(|v| v.as_str()),
            Some(scope_a.key().as_str()),
            "{event}"
        );
    }
    // B 从未沾上 A 的轮次：快照为空态（B 的会话已被上面那次 new_session 重置），且 B 的留存
    // 只有基线那一对请求-响应——A 的轮次一条都不得落进 B 的文件。
    let snapshot_b = runtime.snapshot(&scope_b, &config);
    assert!(snapshot_b.messages.is_empty(), "{:?}", snapshot_b.messages);
    let jsonl_b = f.session_files_text("b");
    assert_eq!(
        jsonl_b.matches("\"kind\":\"llm_request\"").count(),
        1,
        "{jsonl_b}"
    );
    // 收口后 A 可以立即开新一轮（busy 已释放）。
    runtime.acquire_turn(&scope_a, &config).unwrap();
    runtime.release_turn(&scope_a);
}

/// 重复停止请求不制造重复终态：在途期间连点两次停止都成功，事件与留存各只有一条
/// `aborted` / `turn_aborted`；收口之后第三次停止按「没有在途轮次」拒绝，终态不变。
#[test]
fn duplicate_stop_requests_emit_a_single_terminal() {
    let f = Fixture::new("duplicate-stop");
    std::fs::write(f.vault("a").join("a.md"), "甲\n").unwrap();
    let config = mock_config();
    let runtime = Runtime::default();
    let scope = f.scope("a");
    runtime.acquire_turn(&scope, &config).unwrap();

    let sink = CollectSink::default();
    let (release, gate) = mpsc::channel();
    let worker = scoped_worker(&sink, &runtime, &scope, &config, late_response_client(gate));
    sink.wait_for(
        |events| {
            events
                .iter()
                .any(|e| e.get("type").and_then(|t| t.as_str()) == Some("text_chunk"))
        },
        "首个流式分片",
    );
    runtime.request_abort(&scope).expect("第一次停止");
    // 循环尚未走完：第二次停止仍落在同一在途轮次上（幂等，不得排队出第二个终态）。
    runtime.request_abort(&scope).expect("第二次停止");
    release.send(()).unwrap();
    worker.join().unwrap();
    runtime.release_turn(&scope);

    assert_eq!(sink.count_type("aborted"), 1, "{:?}", sink.types());
    let jsonl = f.session_files_text("a");
    assert_eq!(
        jsonl.matches("\"kind\":\"turn_aborted\"").count(),
        1,
        "{jsonl}"
    );
    // 收口后再停止：没有在途轮次，拒绝而不是再发一条终态。
    assert_eq!(
        runtime.request_abort(&scope).unwrap_err().code,
        "harness_not_running"
    );
    assert_eq!(sink.count_type("aborted"), 1, "{:?}", sink.types());
}

// ---------------------------------------------------------------------------
// 结果归属：标题任务的陈旧句柄
// ---------------------------------------------------------------------------

/// 构造一份合法的标题任务句柄（身份取当前会话）。生产路径由 `turn` 的 `after_turn` 装配，
/// 这里只冻结同一形状，便于把句柄「带过」轮换 / 切 vault 的边界做对抗。
fn title_job_for(runtime: &Runtime, scope: &VaultScope, config: &HarnessConfig) -> TitleJob {
    TitleJob {
        session_token: 0,
        trigger: TitleTrigger::FirstTurn,
        vault_key: scope.key(),
        session_id: runtime
            .current_session_id(scope)
            .expect("前置回合之后应有留存会话 id"),
        material: "用户：问题".to_string(),
        current_title: None,
        config: config.clone(),
        target: config.title_target(&config.provider),
        naming_enabled: true,
        mock_start: 0,
    }
}

fn title_client(title: &str) -> MockClient {
    let text = format!("{{\"decision\":\"rename\",\"title\":\"{title}\"}}");
    let script = serde_json::json!({ "titles": [{ "text": text }] }).to_string();
    MockClient::titles_from_str(&script, "m845-title").unwrap()
}

/// 对照面：同一份句柄在**同一会话**上落盘成功——证明下面两条「陈旧句柄」的断言不是恒真。
#[test]
fn title_job_lands_on_the_session_it_was_created_for() {
    let f = Fixture::new("title-positive");
    let config = mock_config();
    let runtime = Runtime::default();
    let scope = f.scope("a");
    complete_text_turn(&runtime, &scope, &config, "第一轮回答。");
    let job = title_job_for(&runtime, &scope, &config);

    let sink = CollectSink::default();
    let scoped = events::ScopedSink::new(&sink, scope.key(), 0);
    title::run_job_with_client(
        &scoped,
        &runtime,
        &scope,
        job,
        &mut title_client("合成标题甲"),
    );
    assert_eq!(
        runtime.snapshot(&scope, &config).title.as_deref(),
        Some("合成标题甲")
    );
    assert_eq!(sink.count_type("title"), 1, "{:?}", sink.types());
}

/// 旧任务不得写入新会话：会话轮换之后，旧句柄一个字段都不许碰（标题不落、事件不发、
/// 留存无 title 记录）。
#[test]
fn stale_title_job_cannot_rename_a_rotated_session() {
    let f = Fixture::new("title-stale-session");
    let config = mock_config();
    let runtime = Runtime::default();
    let scope = f.scope("a");
    complete_text_turn(&runtime, &scope, &config, "第一轮回答。");
    let job = title_job_for(&runtime, &scope, &config);
    let stale_id = job.session_id.clone();

    runtime.new_session(&scope).unwrap();
    // 新会话已落成（有留存 id）——陈旧判定必须走身份复核，而不是「没有会话」这条弱路径。
    complete_text_turn(&runtime, &scope, &config, "新会话第一轮。");
    let current = runtime.current_session_id(&scope).unwrap();
    assert_ne!(current, stale_id, "轮换之后会话 id 必须变化");

    let sink = CollectSink::default();
    let scoped = events::ScopedSink::new(&sink, scope.key(), 0);
    title::run_job_with_client(
        &scoped,
        &runtime,
        &scope,
        job,
        &mut title_client("不该出现"),
    );
    assert_eq!(
        runtime.snapshot(&scope, &config).title,
        None,
        "旧任务不得给新会话起名"
    );
    assert_eq!(sink.count_type("title"), 0, "{:?}", sink.types());
    assert!(
        !f.session_files_text("a").contains("\"kind\":\"title\""),
        "轮换后的留存里不得出现旧任务的 title 记录"
    );
}

/// 旧任务不得写入另一个 vault：A 的句柄在 B 上执行时被身份复核丢弃，B 的会话零变化。
#[test]
fn stale_title_job_cannot_rename_a_foreign_vault() {
    let f = Fixture::new("title-stale-vault");
    let config = mock_config();
    let runtime = Runtime::default();
    let scope_a = f.scope("a");
    let scope_b = f.scope("b");
    complete_text_turn(&runtime, &scope_a, &config, "A 的回答。");
    let job = title_job_for(&runtime, &scope_a, &config);
    complete_text_turn(&runtime, &scope_b, &config, "B 的回答。");

    let sink = CollectSink::default();
    let scoped = events::ScopedSink::new(&sink, scope_b.key(), 0);
    title::run_job_with_client(
        &scoped,
        &runtime,
        &scope_b,
        job,
        &mut title_client("串台标题"),
    );
    assert_eq!(
        runtime.snapshot(&scope_b, &config).title,
        None,
        "不得串到 B"
    );
    assert_eq!(
        runtime.snapshot(&scope_a, &config).title,
        None,
        "A 也未起名"
    );
    assert_eq!(sink.count_type("title"), 0, "{:?}", sink.types());
    assert!(!f.session_files_text("b").contains("\"kind\":\"title\""));
}

// ---------------------------------------------------------------------------
// 批准归属：迟到的决定
// ---------------------------------------------------------------------------

fn gated_delete_client() -> MockClient {
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_delete",
            "arguments": "{\"path\":\"a.md\"}"}]},
        {"text": "收到。"}
    ]}"#;
    MockClient::from_str(script, "m845-gate").unwrap()
}

fn wait_pending(runtime: &Runtime, scope: &VaultScope, config: &HarnessConfig) -> String {
    for _ in 0..500 {
        let pending = runtime.snapshot(scope, config).pending_approvals;
        if let Some(first) = pending.first() {
            return first.id.clone();
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("等待批准请求超时");
}

/// 停止收回的批准项不接受迟到决定；旧请求 id 也绝不能作用到下一轮的新请求上。
#[test]
fn withdrawn_approval_rejects_late_decisions_and_never_touches_the_next_turn() {
    let f = Fixture::new("late-approval");
    std::fs::write(f.vault("a").join("a.md"), "old\n").unwrap();
    let config = mock_config();
    let runtime = Runtime::default();
    let scope = f.scope("a");

    // 第一轮：工具在批准闸上挂起 → 用户停止 → 待决项收回。
    runtime.acquire_turn(&scope, &config).unwrap();
    let sink = CollectSink::default();
    let worker = {
        let sink = sink.clone();
        let runtime = runtime.clone();
        let scope = scope.clone();
        let config = config.clone();
        std::thread::spawn(move || {
            let scoped = events::ScopedSink::new(&sink, scope.key(), 0);
            drive_turn(
                &scoped,
                &runtime,
                &scope,
                &config,
                "删掉 a.md",
                &mut gated_delete_client(),
            );
        })
    };
    let old_id = wait_pending(&runtime, &scope, &config);
    // 权限询问期间 = 在途轮次：换会话 / 恢复必须被 busy 协议挡住（不与待批项抢会话）。
    assert_eq!(
        runtime.new_session(&scope).unwrap_err().code,
        "harness_busy"
    );
    runtime.request_abort(&scope).expect("abort ok");
    worker.join().unwrap();
    runtime.release_turn(&scope);
    assert!(
        runtime
            .snapshot(&scope, &config)
            .pending_approvals
            .is_empty(),
        "待决项应随中断收回"
    );

    // 迟到的采纳：请求已不存在，错误码不是「已批准」，磁盘不动。
    let late = runtime
        .with_session(&scope, |s| {
            s.resolve_approval(&old_id, true, None, false, false)
        })
        .unwrap()
        .unwrap_err();
    assert_eq!(late.code, "approval_not_found");
    assert_eq!(
        std::fs::read_to_string(f.vault("a").join("a.md")).unwrap(),
        "old\n",
        "被收回的调用不得执行"
    );

    // 第二轮：新请求 id 单调、不与旧 id 复用；旧 id 迟到的决定不得作用到新请求上。
    runtime.acquire_turn(&scope, &config).unwrap();
    let worker = {
        let sink = sink.clone();
        let runtime = runtime.clone();
        let scope = scope.clone();
        let config = config.clone();
        std::thread::spawn(move || {
            let scoped = events::ScopedSink::new(&sink, scope.key(), 0);
            drive_turn(
                &scoped,
                &runtime,
                &scope,
                &config,
                "再删一次 a.md",
                &mut gated_delete_client(),
            );
        })
    };
    let new_id = wait_pending(&runtime, &scope, &config);
    assert_ne!(new_id, old_id, "批准请求 id 不得复用");
    let stale = runtime
        .with_session(&scope, |s| {
            s.resolve_approval(&old_id, true, None, false, false)
        })
        .unwrap()
        .unwrap_err();
    assert_eq!(stale.code, "approval_not_found");
    assert_eq!(
        runtime.snapshot(&scope, &config).pending_approvals.len(),
        1,
        "旧决定不得消耗新请求"
    );
    assert_eq!(
        runtime.snapshot(&scope, &config).pending_approvals[0].id,
        new_id
    );
    // 收口：拒绝新请求 → 模型收到拒绝结果、第二轮文本收尾为 done；磁盘不动。
    runtime
        .with_session(&scope, |s| {
            s.resolve_approval(&new_id, false, Some("本轮不删".into()), false, false)
        })
        .unwrap()
        .unwrap();
    worker.join().unwrap();
    runtime.release_turn(&scope);
    assert_eq!(sink.count_type("aborted"), 1, "{:?}", sink.types());
    assert_eq!(sink.types().last().map(String::as_str), Some("done"));
    assert_eq!(
        std::fs::read_to_string(f.vault("a").join("a.md")).unwrap(),
        "old\n"
    );
    // 两轮各挂一次批准，旧轮的那次不产生决定记录（kind=approval 只有新轮的拒绝一条）。
    let jsonl = f.session_files_text("a");
    assert_eq!(jsonl.matches("\"kind\":\"approval\"").count(), 1, "{jsonl}");
    assert!(jsonl.contains("\"decision\":\"rejected\""), "{jsonl}");
}

// ---------------------------------------------------------------------------
// 流中断 → 用户重试
// ---------------------------------------------------------------------------

/// 流中断是错误终态，不是半成品；用户重试从干净的一轮开始——不含中断轮的半截正文 /
/// 悬空调用，留存如实记录两条请求与一条错误。
#[test]
fn interrupted_stream_then_retry_starts_from_a_clean_turn() {
    let f = Fixture::new("stream-retry");
    let config = mock_config();
    let runtime = Runtime::default();
    let scope = f.scope("a");
    let sink = CollectSink::default();

    // 第一轮：流中途断开（半截正文 + 错误）。
    runtime.acquire_turn(&scope, &config).unwrap();
    {
        let scoped = events::ScopedSink::new(&sink, scope.key(), 0);
        let mut client = ScriptedClient::new(vec![ScriptStep::Interrupted(
            "只流到一半的句子。".to_string(),
            "harness_stream_interrupted".to_string(),
            "连接中断".to_string(),
        )]);
        drive_turn(&scoped, &runtime, &scope, &config, "问题", &mut client);
    }
    runtime.release_turn(&scope);
    assert_eq!(
        sink.types().last().map(String::as_str),
        Some("error"),
        "{:?}",
        sink.types()
    );
    assert_eq!(sink.count_type("done"), 0, "{:?}", sink.types());

    // 第二轮（用户重试）：干净完成。
    runtime.acquire_turn(&scope, &config).unwrap();
    {
        let scoped = events::ScopedSink::new(&sink, scope.key(), 0);
        let mut client = ScriptedClient::new(vec![ScriptStep::Text("重试成功。".to_string())]);
        drive_turn(&scoped, &runtime, &scope, &config, "重试", &mut client);
    }
    runtime.release_turn(&scope);
    assert_eq!(sink.types().last().map(String::as_str), Some("done"));
    assert_eq!(sink.count_type("error"), 1, "{:?}", sink.types());

    // 消息面：中断轮不得留下半截 assistant 消息；重试轮的回答恰好一条。
    let snapshot = runtime.snapshot(&scope, &config);
    let assistants: Vec<_> = snapshot
        .messages
        .iter()
        .filter(|m| m.role == "assistant")
        .collect();
    assert_eq!(assistants.len(), 1, "{:?}", snapshot.messages);
    assert_eq!(assistants[0].text.as_deref(), Some("重试成功。"));
    // 历史面：中断的调用项不得悬空进下一轮请求。
    let dangling = runtime
        .with_session(&scope, |s| {
            s.input()
                .iter()
                .filter(|it| it.get("type").and_then(|t| t.as_str()) == Some("function_call"))
                .count()
        })
        .unwrap();
    assert_eq!(dangling, 0);
    // 留存面：两次请求成对、错误如实记录（中断轮有 llm_response + llm_error）。
    let jsonl = f.session_files_text("a");
    assert_eq!(
        jsonl.matches("\"kind\":\"llm_request\"").count(),
        2,
        "{jsonl}"
    );
    assert_eq!(
        jsonl.matches("\"kind\":\"llm_response\"").count(),
        2,
        "{jsonl}"
    );
    assert_eq!(
        jsonl.matches("\"kind\":\"llm_error\"").count(),
        1,
        "{jsonl}"
    );
}
