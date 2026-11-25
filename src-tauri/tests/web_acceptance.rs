//! Web 阶段5：合成 HTTP 整链验收（`--features acceptance-web`）。
//!
//! 判据不是「mock port 收到过调用」，而是本地真实 socket 上的 HTTP 记录：DeepSeek tools API
//! 的 method / path / JSON body / Bearer、目标站 A/B 的预检请求、代理零请求、响应字节与截断、
//! 取消与同批工具不重放。LLM 由 `MockClient` 驱动，Web HTTP 全部走本文件起的本地服务。
//!
//! 生产装配不经本文件的任何构造器：测试 provider / transport / resolver 的注入面只在
//! `acceptance-web` feature 下编译，普通 dev / release 构建没有读取 `LUMIR_ACCEPTANCE_WEB_ENDPOINTS`
//! 的代码。

#![cfg(feature = "acceptance-web")]

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use lumir_lib::config::{self, HarnessConfig, PermissionMode, ProviderPreset};
use lumir_lib::fs_io::IgnorePolicy;
use lumir_lib::harness::events::EventSink;
use lumir_lib::harness::llm::MockClient;
use lumir_lib::harness::turn::run_turn_for_with_web_port;
use lumir_lib::harness::web::config::WebApproval;
use lumir_lib::harness::web::executor::WebExecutor;
use lumir_lib::harness::web::preflight::{ReqwestWebTransport, WebDnsResolver};
use lumir_lib::harness::web::provider::DeepSeekWebProvider;
use lumir_lib::harness::web::ConfiguredWebToolPort;
use lumir_lib::harness::{Runtime, VaultScope};

/// XDG / HOME 是进程级环境变量：本文件的用例必须串行（即使测试运行器开了并行）。
static TEST_LOCK: Mutex<()> = Mutex::new(());

const CANARY: &str = "lumir-stage5-canary-4f8c2d";
const TARGET: &str = "http://target.test/page";
const TARGET_B: &str = "http://other.test/page";

#[derive(Clone, Default)]
struct Collect(Arc<Mutex<Vec<serde_json::Value>>>);

impl EventSink for Collect {
    fn emit(&self, payload: serde_json::Value) {
        self.0.lock().unwrap().push(payload);
    }
}

impl Collect {
    fn events(&self) -> Vec<serde_json::Value> {
        self.0.lock().unwrap().clone()
    }
}

#[derive(Clone, Debug)]
struct RequestRecord {
    method: String,
    path: String,
    authorization: String,
    content_type: String,
    body: String,
}

#[derive(Clone)]
struct TestResponse {
    status: u16,
    content_type: String,
    body: Vec<u8>,
    headers: Vec<(String, String)>,
    head_delay: Duration,
    body_delay: Duration,
}

impl TestResponse {
    fn new(status: u16, content_type: &str, body: impl Into<Vec<u8>>) -> Self {
        Self {
            status,
            content_type: content_type.to_string(),
            body: body.into(),
            headers: Vec::new(),
            head_delay: Duration::ZERO,
            body_delay: Duration::ZERO,
        }
    }

    fn json(status: u16, body: impl Into<Vec<u8>>) -> Self {
        Self::new(status, "application/json", body)
    }

    fn html(status: u16, body: impl Into<Vec<u8>>) -> Self {
        Self::new(status, "text/html", body)
    }

    fn redirect(status: u16, location: &str) -> Self {
        Self {
            headers: vec![("Location".to_string(), location.to_string())],
            ..Self::new(status, "text/html", "")
        }
    }

    fn delayed(mut self, head: Duration, body: Duration) -> Self {
        self.head_delay = head;
        self.body_delay = body;
        self
    }
}

struct TestServer {
    port: u16,
    records: Arc<Mutex<Vec<RequestRecord>>>,
    stop: Arc<AtomicBool>,
    join: Option<thread::JoinHandle<()>>,
}

impl TestServer {
    fn start(responses: Vec<TestResponse>) -> Self {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let records = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let accept_records = records.clone();
        let accept_stop = stop.clone();
        let mut queue: VecDeque<TestResponse> = responses.into();
        let join = thread::spawn(move || {
            while !accept_stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let response = queue
                            .pop_front()
                            .unwrap_or_else(|| TestResponse::json(500, "{}"));
                        let records = accept_records.clone();
                        thread::spawn(move || serve(stream, response, &records));
                    }
                    Err(_) => thread::park_timeout(Duration::from_millis(5)),
                }
            }
        });
        Self {
            port,
            records,
            stop,
            join: Some(join),
        }
    }

    fn endpoint(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn records(&self) -> Vec<RequestRecord> {
        self.records.lock().unwrap().clone()
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

fn serve(stream: TcpStream, response: TestResponse, records: &Arc<Mutex<Vec<RequestRecord>>>) {
    let mut stream = stream;
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    let mut content_length = 0usize;
    let mut authorization = String::new();
    let mut content_type = String::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line == "\r\n" || line.is_empty() {
            break;
        }
        let lower = line.to_ascii_lowercase();
        if let Some(value) = lower.strip_prefix("content-length:") {
            content_length = value.trim().parse().unwrap_or(0);
        } else if let Some(value) = lower.strip_prefix("authorization:") {
            authorization = value.trim().to_string();
        } else if let Some(value) = lower.strip_prefix("content-type:") {
            content_type = value.trim().to_string();
        }
    }
    let mut body = vec![0; content_length];
    let _ = reader.read_exact(&mut body);
    records.lock().unwrap().push(RequestRecord {
        method: method.clone(),
        path,
        authorization,
        content_type,
        body: String::from_utf8_lossy(&body).to_string(),
    });
    thread::park_timeout(response.head_delay);
    let reason = match response.status {
        200 => "OK",
        302 => "Found",
        400 => "Bad Request",
        408 => "Request Timeout",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        _ => "Synthetic",
    };
    let mut headers = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n",
        response.status,
        reason,
        response.content_type,
        response.body.len()
    );
    for (name, value) in &response.headers {
        headers.push_str(&format!("{name}: {value}\r\n"));
    }
    headers.push_str("\r\n");
    let _ = stream.write_all(headers.as_bytes());
    let _ = stream.flush();
    thread::park_timeout(response.body_delay);
    if method != "HEAD" {
        let _ = stream.write_all(&response.body);
        let _ = stream.flush();
    }
}

struct TestDns {
    answers: Vec<(String, SocketAddr)>,
}

impl TestDns {
    fn new(entries: impl IntoIterator<Item = (&'static str, u16)>) -> Self {
        Self {
            answers: entries
                .into_iter()
                .map(|(host, port)| {
                    (
                        host.to_string(),
                        SocketAddr::new(IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)), port),
                    )
                })
                .collect(),
        }
    }
}

impl WebDnsResolver for TestDns {
    fn resolve(&self, host: &str) -> Result<Vec<SocketAddr>, String> {
        self.answers
            .iter()
            .find(|(name, _)| name == host)
            .map(|(_, addr)| vec![*addr])
            .ok_or_else(|| "no synthetic answer".to_string())
    }
}

struct Fixture {
    root: PathBuf,
    scope: VaultScope,
    config: HarnessConfig,
    deepseek_endpoint: String,
    previous_xdg: Option<std::ffi::OsString>,
    previous_home: Option<std::ffi::OsString>,
}

impl Fixture {
    fn new(name: &str, approval: WebApproval) -> Self {
        let root =
            std::env::temp_dir().join(format!("lumir-stage5-web-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("xdg")).unwrap();
        std::fs::create_dir_all(root.join("vault")).unwrap();
        std::fs::write(root.join("vault/harness-note.md"), "HNL-STAGE5\n").unwrap();
        let previous_xdg = std::env::var_os("XDG_CONFIG_HOME");
        let previous_home = std::env::var_os("HOME");
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
        std::env::set_var("HOME", root.join("home"));
        let policy = IgnorePolicy::load(
            &root.join("vault"),
            &[".gitignore".to_string()],
            &config::VaultConfig::default().ignore,
        );
        let scope = VaultScope {
            root: root.join("vault"),
            policy,
            vault_id: format!("stage5-web-{name}"),
        };
        let mut config = config::test_harness(
            "deepseek-acceptance",
            config::test_provider(ProviderPreset::Deepseek, CANARY, &[]),
        );
        config.permission_mode = PermissionMode::FullAccess;
        config.web_access.approval = approval;
        Self {
            root,
            scope,
            config: config.clone(),
            deepseek_endpoint: String::new(),
            previous_xdg,
            previous_home,
        }
    }

    fn set_deepseek(&mut self, endpoint: &str) {
        self.deepseek_endpoint = endpoint.to_string();
    }

    fn port(&self, dns: &[(&'static str, u16)], ca_pem: Option<PathBuf>) -> ConfiguredWebToolPort {
        let provider = Arc::new(DeepSeekWebProvider::with_endpoint_for_test(
            &self.deepseek_endpoint,
            "deepseek-acceptance",
            CANARY,
        ));
        let transport = match ca_pem {
            Some(path) => ReqwestWebTransport::with_test_mapping_and_roots(
                |addr| SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), addr.port()),
                vec![std::fs::read(path).unwrap()],
            ),
            None => ReqwestWebTransport::with_test_mapping(|addr| {
                SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), addr.port())
            }),
        };
        let executor = WebExecutor::with_dependencies_for_test(
            provider,
            self.config.permissions.clone(),
            Arc::new(TestDns::new(dns.iter().copied())),
            Arc::new(transport),
            Arc::new(lumir_lib::harness::web::provider::SystemWebBackoff),
        );
        ConfiguredWebToolPort::with_executor_for_test(&self.config, executor)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        match &self.previous_xdg {
            Some(value) => std::env::set_var("XDG_CONFIG_HOME", value),
            None => std::env::remove_var("XDG_CONFIG_HOME"),
        }
        match &self.previous_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn search(query: &str) -> String {
    serde_json::json!({
        "tool_calls": [{
            "id": "call_search",
            "name": "web_search",
            "arguments": serde_json::json!({"query": query}).to_string(),
        }]
    })
    .to_string()
}

fn fetch(url: &str) -> String {
    serde_json::json!({
        "tool_calls": [{
            "id": "call_fetch",
            "name": "web_fetch",
            "arguments": serde_json::json!({"url": url}).to_string(),
        }]
    })
    .to_string()
}

fn script_json(responses: &[String]) -> String {
    let values: Vec<serde_json::Value> = responses
        .iter()
        .map(|text| serde_json::from_str(text).unwrap())
        .collect();
    serde_json::json!({"responses": values}).to_string()
}

struct TurnResult {
    sink: Collect,
    runtime: Runtime,
}

fn run_turn(fixture: &mut Fixture, port: ConfiguredWebToolPort, script: &str) -> TurnResult {
    let sink = Collect::default();
    let runtime = Runtime::default();
    runtime
        .acquire_turn(&fixture.scope, &fixture.config)
        .unwrap();
    let mut client = MockClient::from_str(script, "stage5-web").unwrap();
    run_turn_for_with_web_port(
        &sink,
        &runtime,
        &fixture.scope,
        &fixture.config,
        "stage5",
        None,
        &mut client,
        Arc::new(port),
    );
    runtime.release_turn(&fixture.scope);
    TurnResult { sink, runtime }
}

fn tool_done(events: &[serde_json::Value], name: &str) -> serde_json::Value {
    events
        .iter()
        .find(|event| {
            event["type"] == "tool_call" && event["status"] == "done" && event["name"] == name
        })
        .unwrap_or_else(|| panic!("{name} done event missing"))
        .clone()
}

fn output_of(runtime: &Runtime, scope: &VaultScope, call_id: &str) -> serde_json::Value {
    let input = runtime
        .with_session(scope, |session| session.input().to_vec())
        .unwrap();
    let output = input
        .iter()
        .find(|item| item["type"] == "function_call_output" && item["call_id"] == call_id)
        .unwrap_or_else(|| panic!("{call_id} output missing"));
    serde_json::from_str(output["output"].as_str().unwrap()).unwrap()
}

fn jsonl_text(root: &Path) -> String {
    let mut text = String::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    text.push_str(&content);
                }
            }
        }
    }
    text
}

#[test]
fn search_then_fetch_allow_all_uses_real_local_http_and_records_audit() {
    let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _ = CANARY;
    let deepseek = TestServer::start(vec![
        TestResponse::json(
            200,
            serde_json::json!({"results": [
                {"title": "Synthetic", "url": TARGET, "snippet": "s", "summary": "m"}
            ]})
            .to_string(),
        ),
        TestResponse::json(
            200,
            serde_json::json!({"title": "Target", "content": "# Stage5 body"}).to_string(),
        ),
    ]);
    let target = TestServer::start(vec![TestResponse::html(200, "")]);
    let mut fixture = Fixture::new("allow", WebApproval::AllowAll);
    fixture.set_deepseek(&deepseek.endpoint());
    let port = fixture.port(&[("target.test", target.port)], None);
    let script = script_json(&[
        search("stage5 query"),
        fetch(TARGET),
        serde_json::json!({"text": "STAGE5-DONE"}).to_string(),
    ]);
    let turn = run_turn(&mut fixture, port, &script);
    let events = turn.sink.events();
    let search_done = tool_done(&events, "web_search");
    assert_eq!(search_done["web"]["query"], "stage5 query");
    assert_eq!(search_done["web"]["provider"], "deepseek");
    assert_eq!(search_done["web"]["provider_id"], "deepseek-acceptance");
    assert_eq!(search_done["web"]["attempts"], 1);
    assert_eq!(search_done["web"]["local_precheck"], false);
    assert_eq!(search_done["web"]["provider_fetch"], true);
    let fetch_done = tool_done(&events, "web_fetch");
    assert_eq!(fetch_done["web"]["url"], TARGET);
    assert_eq!(fetch_done["web"]["attempts"], 1);
    assert_eq!(fetch_done["web"]["local_precheck"], true);
    assert_eq!(fetch_done["web"]["provider_fetch"], true);
    let api = deepseek.records();
    assert_eq!(api.len(), 2);
    assert_eq!(api[0].method, "POST");
    assert_eq!(api[0].path, "/v1/tools/search");
    assert_eq!(api[0].content_type, "application/json");
    assert!(api[0]
        .authorization
        .eq_ignore_ascii_case(&format!("Bearer {CANARY}")));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&api[0].body).unwrap(),
        serde_json::json!({"query": "stage5 query", "count": 5, "need_content": false})
    );
    assert_eq!(api[1].path, "/v1/tools/fetch");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&api[1].body).unwrap(),
        serde_json::json!({"url": TARGET})
    );
    let target_records = target.records();
    assert_eq!(target_records.len(), 1);
    assert_eq!(target_records[0].method, "HEAD");
    assert_eq!(target_records[0].path, "/page");
    assert!(target_records[0].authorization.is_empty());
    assert!(events.iter().any(|event| event["type"] == "text_chunk"
        && event["text"]
            .as_str()
            .is_some_and(|text| text.contains("STAGE5-DONE"))));
}

#[test]
fn ask_approved_and_deny_matrix_keep_http_counts_and_facts() {
    let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let deepseek = TestServer::start(vec![TestResponse::json(
        200,
        serde_json::json!({"results": [
            {"title": "Synthetic", "url": TARGET}
        ]})
        .to_string(),
    )]);
    let target = TestServer::start(vec![TestResponse::html(200, "")]);
    let mut fixture = Fixture::new("ask", WebApproval::Ask);
    fixture.set_deepseek(&deepseek.endpoint());
    let port = fixture.port(&[("target.test", target.port)], None);
    let script = script_json(&[
        search("ask query"),
        serde_json::json!({"text": "ASK-DONE"}).to_string(),
    ]);
    let sink = Collect::default();
    let runtime = Runtime::default();
    runtime
        .acquire_turn(&fixture.scope, &fixture.config)
        .unwrap();
    let mut client = MockClient::from_str(&script, "stage5-ask").unwrap();
    let runtime_worker = runtime.clone();
    let scope_worker = fixture.scope.clone();
    let config_worker = fixture.config.clone();
    let sink_worker = sink.clone();
    let worker = thread::spawn(move || {
        run_turn_for_with_web_port(
            &sink_worker,
            &runtime_worker,
            &scope_worker,
            &config_worker,
            "stage5",
            None,
            &mut client,
            Arc::new(port),
        );
    });
    let pending = loop {
        let snapshot = runtime.snapshot(&fixture.scope, &fixture.config);
        if let Some(pending) = snapshot.pending_approvals.first() {
            break pending.clone();
        }
        thread::park_timeout(Duration::from_millis(1));
    };
    assert_eq!(
        pending.web.as_ref().unwrap().operation,
        lumir_lib::harness::web::output::WebOperation::Search
    );
    runtime
        .with_session(&fixture.scope, |session| {
            session.resolve_approval(&pending.id, true, None, false, false)
        })
        .unwrap()
        .unwrap();
    worker.join().unwrap();
    runtime.release_turn(&fixture.scope);
    let events = sink.events();
    let done = tool_done(&events, "web_search");
    assert_eq!(done["web"]["attempts"], 1);
    assert_eq!(done["web"]["local_precheck"], false);
    assert_eq!(deepseek.records().len(), 1);
    assert_eq!(target.records().len(), 0);
    let canary_text = serde_json::to_string(&events).unwrap();
    assert!(!canary_text.contains(CANARY));
    let _ = fixture;

    // deny：web_fetch 在工具级 deny 规则下不预检、不请求 provider。
    let deepseek = TestServer::start(Vec::new());
    let target = TestServer::start(Vec::new());
    let mut fixture = Fixture::new("deny", WebApproval::AllowAll);
    fixture.set_deepseek(&deepseek.endpoint());
    fixture.config.permissions.deny = vec!["web_fetch(http://target.test)".to_string()];
    let port = fixture.port(&[("target.test", target.port)], None);
    let script = script_json(&[
        fetch(TARGET),
        serde_json::json!({"text": "DENY-DONE"}).to_string(),
    ]);
    let turn = run_turn(&mut fixture, port, &script);
    let done = tool_done(&turn.sink.events(), "web_fetch");
    assert_eq!(done["web"]["local_precheck"], false);
    assert_eq!(done["web"]["provider_fetch"], false);
    assert_eq!(done["web"]["attempts"], 0);
    assert_eq!(done["web"]["code"], "permission_denied");
    assert!(deepseek.records().is_empty());
    assert!(target.records().is_empty());
}

#[test]
fn redirect_and_dns_block_keep_real_http_records_and_zero_provider_requests() {
    let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let deepseek = TestServer::start(vec![TestResponse::json(
        200,
        serde_json::json!({"title": "B", "content": "# B"}).to_string(),
    )]);
    let b = TestServer::start(vec![TestResponse::html(200, "")]);
    let a = TestServer::start(vec![TestResponse::redirect(302, TARGET_B)]);
    let mut fixture = Fixture::new("redirect", WebApproval::AllowAll);
    fixture.set_deepseek(&deepseek.endpoint());
    let port = fixture.port(&[("target.test", a.port), ("other.test", b.port)], None);
    let script = script_json(&[
        fetch(TARGET),
        serde_json::json!({"text": "REDIRECT-DONE"}).to_string(),
    ]);
    let turn = run_turn(&mut fixture, port, &script);
    let done = tool_done(&turn.sink.events(), "web_fetch");
    assert_eq!(
        done["web"]["url"],
        TARGET_B,
        "a={:?} b={:?}",
        a.records(),
        b.records()
    );
    assert_eq!(a.records().len(), 1);
    assert_eq!(b.records().len(), 1);
    let api = deepseek.records();
    assert_eq!(api.len(), 1);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&api[0].body).unwrap(),
        serde_json::json!({"url": TARGET_B})
    );
    let _ = fixture;

    let deepseek = TestServer::start(Vec::new());
    let mut fixture = Fixture::new("dns-block", WebApproval::AllowAll);
    fixture.set_deepseek(&deepseek.endpoint());
    let port = fixture.port(&[], None);
    let dns_script = script_json(&[
        fetch("http://blocked.test/page"),
        serde_json::json!({"text": "DNS-DONE"}).to_string(),
    ]);
    let turn = run_turn(&mut fixture, port, &dns_script);
    let done = tool_done(&turn.sink.events(), "web_fetch");
    assert_eq!(done["web"]["code"], "web_dns_failed");
    assert_eq!(done["web"]["attempts"], 0);
    assert_eq!(done["web"]["local_precheck"], true);
    assert_eq!(done["web"]["provider_fetch"], false);
    assert!(deepseek.records().is_empty());
}

#[test]
fn cancellation_during_headers_returns_web_cancelled_without_a_second_request() {
    let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let deepseek = TestServer::start(vec![TestResponse::json(
        200,
        serde_json::json!({"results": []}).to_string(),
    )
    .delayed(Duration::from_millis(800), Duration::ZERO)]);
    let mut fixture = Fixture::new("cancel", WebApproval::AllowAll);
    fixture.set_deepseek(&deepseek.endpoint());
    let port = fixture.port(&[], None);
    let script = script_json(&[
        search("cancel query"),
        serde_json::json!({"text": "CANCEL-DONE"}).to_string(),
    ]);
    let sink = Collect::default();
    let runtime = Runtime::default();
    runtime
        .acquire_turn(&fixture.scope, &fixture.config)
        .unwrap();
    let mut client = MockClient::from_str(&script, "stage5-cancel").unwrap();
    let runtime_worker = runtime.clone();
    let scope_worker = fixture.scope.clone();
    let config_worker = fixture.config.clone();
    let sink_worker = sink.clone();
    let worker = thread::spawn(move || {
        run_turn_for_with_web_port(
            &sink_worker,
            &runtime_worker,
            &scope_worker,
            &config_worker,
            "stage5",
            None,
            &mut client,
            Arc::new(port),
        );
    });
    for _ in 0..2_000 {
        if sink
            .events()
            .iter()
            .any(|event| event["type"] == "tool_call" && event["status"] == "started")
        {
            break;
        }
        thread::park_timeout(Duration::from_millis(1));
    }
    runtime
        .with_session(&fixture.scope, |session| session.request_abort())
        .unwrap();
    worker.join().unwrap();
    runtime.release_turn(&fixture.scope);
    let done = tool_done(&sink.events(), "web_search");
    assert_eq!(done["web"]["code"], "web_cancelled");
    assert_eq!(done["web"]["attempts"], 1);
    assert_eq!(deepseek.records().len(), 1, "取消不得再发新 attempt");
}

#[test]
fn same_batch_tools_are_not_replayed_and_truncated_content_survives_jsonl() {
    let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let deepseek = TestServer::start(vec![
        TestResponse::json(429, "{}"),
        TestResponse::json(
            200,
            serde_json::json!({"results": [{"title": "A", "url": TARGET}]}).to_string(),
        ),
        TestResponse::json(
            200,
            serde_json::json!({"results": [{"title": "B", "url": TARGET_B}]}).to_string(),
        ),
        TestResponse::json(
            200,
            serde_json::json!({"title": "T", "content": "x".repeat(30_000)}).to_string(),
        ),
    ]);
    let target = TestServer::start(vec![TestResponse::html(200, "")]);
    let mut fixture = Fixture::new("batch", WebApproval::AllowAll);
    fixture.set_deepseek(&deepseek.endpoint());
    let port = fixture.port(&[("target.test", target.port)], None);
    let two_searches = serde_json::json!({
        "tool_calls": [
            {"id": "call_a", "name": "web_search", "arguments": serde_json::json!({"query": "first"}).to_string()},
            {"id": "call_b", "name": "web_search", "arguments": serde_json::json!({"query": "second"}).to_string()}
        ]
    })
    .to_string();
    let script = script_json(&[
        two_searches,
        fetch(TARGET),
        serde_json::json!({"text": "BATCH-DONE"}).to_string(),
    ]);
    let turn = run_turn(&mut fixture, port, &script);
    let events = turn.sink.events();
    let first = tool_done(&events, "web_search");
    assert_eq!(first["web"]["attempts"], 2, "first search retries once");
    let api = deepseek.records();
    assert_eq!(
        api.len(),
        4,
        "429 + retry + second search + fetch: {api:#?}"
    );
    let search_bodies: Vec<serde_json::Value> = api
        .iter()
        .filter(|record| record.path == "/v1/tools/search")
        .map(|record| serde_json::from_str(&record.body).unwrap())
        .collect();
    assert_eq!(search_bodies.len(), 3);
    assert_eq!(
        search_bodies[0], search_bodies[1],
        "retry resends the same request"
    );
    assert_eq!(search_bodies[2]["query"], "second");
    let fetch_output = output_of(&turn.runtime, &fixture.scope, "call_fetch");
    assert!(fetch_output["ok"].as_bool().unwrap());
    assert_eq!(
        fetch_output["source"]["content"]
            .as_str()
            .unwrap()
            .chars()
            .count(),
        24_000
    );
    assert_eq!(fetch_output["truncated"], true);
    assert!(fetch_output["truncated_fields"]
        .as_array()
        .unwrap()
        .iter()
        .any(|field| field == "content"));
    let text = jsonl_text(&fixture.root.join("xdg"));
    assert!(text.contains("\"type\":\"function_call_output\""));
    assert!(!text.contains(CANARY));
}

struct ProxyEnvGuard {
    old: Vec<(&'static str, Option<std::ffi::OsString>)>,
}

impl ProxyEnvGuard {
    fn set(proxy: &str) -> Self {
        let names = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"];
        let old = names
            .into_iter()
            .map(|name| (name, std::env::var_os(name)))
            .collect::<Vec<_>>();
        for name in &names[..3] {
            std::env::set_var(name, proxy);
        }
        std::env::remove_var("NO_PROXY");
        Self { old }
    }
}

impl Drop for ProxyEnvGuard {
    fn drop(&mut self) {
        for (name, value) in &self.old {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
        }
    }
}

#[test]
fn full_chain_bypasses_system_proxy_with_positive_baseline() {
    let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let deepseek = TestServer::start(vec![
        TestResponse::json(
            200,
            serde_json::json!({"results": [{"title": "A", "url": TARGET}]}).to_string(),
        ),
        TestResponse::json(
            200,
            serde_json::json!({"title": "A", "content": "# A"}).to_string(),
        ),
    ]);
    let target = TestServer::start(vec![TestResponse::html(200, "")]);
    let proxy = TestServer::start(vec![TestResponse::json(502, "{}")]);
    let _env = ProxyEnvGuard::set(&proxy.endpoint());
    let mut fixture = Fixture::new("proxy", WebApproval::AllowAll);
    fixture.set_deepseek(&deepseek.endpoint());
    let port = fixture.port(&[("target.test", target.port)], None);
    let script = script_json(&[
        search("proxy chain"),
        fetch(TARGET),
        serde_json::json!({"text": "PROXY-DONE"}).to_string(),
    ]);
    let turn = run_turn(&mut fixture, port, &script);
    let done = tool_done(&turn.sink.events(), "web_search");
    assert_eq!(done["web"]["attempts"], 1);
    assert_eq!(done["web"]["provider_fetch"], true);
    assert_eq!(
        deepseek.records().len(),
        2,
        "synthetic DeepSeek receives search + fetch"
    );
    assert_eq!(
        target.records().len(),
        1,
        "preflight reaches the synthetic target"
    );
    assert_eq!(
        proxy.records().len(),
        0,
        "no_proxy bypasses the system proxy"
    );
    let baseline = reqwest::blocking::Client::new()
        .get("http://proxy-baseline.invalid/probe")
        .send();
    assert!(baseline.is_ok(), "positive baseline must reach the proxy");
    assert!(
        !proxy.records().is_empty(),
        "positive baseline must prove env proxy is active"
    );
}

struct AcceptanceEnvGuard {
    old: Option<std::ffi::OsString>,
}

impl AcceptanceEnvGuard {
    fn set(value: &str) -> Self {
        let old = std::env::var_os("LUMIR_ACCEPTANCE_WEB_ENDPOINTS");
        std::env::set_var("LUMIR_ACCEPTANCE_WEB_ENDPOINTS", value);
        Self { old }
    }
}

impl Drop for AcceptanceEnvGuard {
    fn drop(&mut self) {
        match &self.old {
            Some(value) => std::env::set_var("LUMIR_ACCEPTANCE_WEB_ENDPOINTS", value),
            None => std::env::remove_var("LUMIR_ACCEPTANCE_WEB_ENDPOINTS"),
        }
    }
}

#[test]
fn acceptance_env_assembly_builds_a_working_web_port() {
    let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let deepseek = TestServer::start(vec![
        TestResponse::json(
            200,
            serde_json::json!({"results": [{"title": "A", "url": TARGET}]}).to_string(),
        ),
        TestResponse::json(
            200,
            serde_json::json!({"title": "A", "content": "# A"}).to_string(),
        ),
    ]);
    let target = TestServer::start(vec![TestResponse::html(200, "")]);
    let mut fixture = Fixture::new("env-assembly", WebApproval::AllowAll);
    fixture.set_deepseek(&deepseek.endpoint());
    let endpoints = serde_json::json!({
        "deepseek": deepseek.endpoint(),
        "targets": {"target.test": target.port},
    })
    .to_string();
    let _env = AcceptanceEnvGuard::set(&endpoints);
    let port = ConfiguredWebToolPort::new(&fixture.config);
    let script = script_json(&[
        search("env assembly"),
        fetch(TARGET),
        serde_json::json!({"text": "ENV-ASSEMBLY-DONE"}).to_string(),
    ]);
    let turn = run_turn(&mut fixture, port, &script);
    let events = turn.sink.events();
    assert_eq!(tool_done(&events, "web_search")["web"]["attempts"], 1);
    assert_eq!(
        tool_done(&events, "web_fetch")["web"]["local_precheck"],
        true
    );
    assert_eq!(deepseek.records().len(), 2);
    assert_eq!(target.records().len(), 1);
}
