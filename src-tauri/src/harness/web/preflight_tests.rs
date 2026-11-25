use super::output::WebErrorCode;
use super::preflight::*;
use crate::config::HarnessPermissions;
use std::collections::{BTreeMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const PUBLIC: IpAddr = IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34));
const OTHER_PUBLIC: IpAddr = IpAddr::V4(Ipv4Addr::new(203, 0, 114, 1));

#[derive(Clone, Default)]
struct ScriptedDns {
    answers: BTreeMap<String, VecDeque<Result<Vec<SocketAddr>, String>>>,
    calls: Arc<Mutex<Vec<String>>>,
}

impl ScriptedDns {
    fn with(host: &str, answers: Vec<Result<Vec<SocketAddr>, String>>) -> Self {
        Self {
            answers: [(host.to_string(), answers.into_iter().collect())]
                .into_iter()
                .collect(),
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn public(host: &str, port: u16) -> Self {
        Self::with(host, vec![Ok(vec![SocketAddr::new(PUBLIC, port)])])
    }
}

impl WebDnsResolver for ScriptedDns {
    fn resolve(&self, host: &str) -> Result<Vec<SocketAddr>, String> {
        self.calls.lock().unwrap().push(host.to_string());
        self.answers
            .get(host)
            .cloned()
            .and_then(|mut queue| queue.pop_front())
            .unwrap_or_else(|| Err("no scripted answer".to_string()))
    }
}

fn transport() -> ReqwestWebTransport {
    ReqwestWebTransport::with_test_mapping(|addr| {
        SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), addr.port())
    })
}

fn tls_transport() -> ReqwestWebTransport {
    ReqwestWebTransport::with_test_mapping_and_roots(
        |addr| SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), addr.port()),
        vec![include_bytes!("testdata/target.test/ca.pem").to_vec()],
    )
}

fn html() -> TestResponse {
    TestResponse::html()
}

fn permissions(deny: &[&str]) -> HarnessPermissions {
    HarnessPermissions {
        allow: Vec::new(),
        deny: deny.iter().map(|rule| rule.to_string()).collect(),
    }
}

fn check(
    raw_url: &str,
    permissions: &HarnessPermissions,
    resolver: impl WebDnsResolver + 'static,
    transport: impl WebTransport + 'static,
    aborted: impl Fn() -> bool + Send + Sync + 'static,
    limits: PreflightLimits,
) -> Result<PreflightSuccess, PreflightError> {
    run_preflight(
        raw_url,
        permissions,
        Arc::new(resolver),
        Arc::new(transport),
        Arc::new(aborted),
        limits,
    )
}

#[test]
fn dns_mixed_public_private_is_rejected_before_any_connection() {
    let server = TestServer::start("/first", html(), false);
    let resolver = ScriptedDns::with(
        "target.test",
        vec![Ok(vec![
            SocketAddr::new(PUBLIC, server.port()),
            SocketAddr::new(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)), server.port()),
        ])],
    );
    let error = check(
        &format!("http://target.test:{}/first", server.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("公私混合必须拒绝");
    assert_eq!(error.code, WebErrorCode::WebDnsBlocked);
    assert_eq!(server.request_count(), 0);
}

#[test]
fn dns_failure_and_mixed_a_aaaa_answers_are_checked_directly() {
    let server = TestServer::start("/html", html(), false);
    let error = check(
        &format!("http://target.test:{}/html", server.port()),
        &permissions(&[]),
        ScriptedDns::with(
            "target.test",
            vec![Err("synthetic DNS failure".to_string())],
        ),
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("DNS 失败必须 fail closed");
    assert_eq!(error.code, WebErrorCode::WebDnsFailed);
    assert_eq!(server.request_count(), 0);

    let resolver = ScriptedDns::with(
        "target.test",
        vec![Ok(vec![
            SocketAddr::new(PUBLIC, server.port()),
            SocketAddr::new("2606:4700:4700::1111".parse().unwrap(), server.port()),
        ])],
    );
    check(
        &format!("http://target.test:{}/html", server.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect("全公网 A / AAAA 混合答案应通过");

    let resolver = ScriptedDns::with(
        "target.test",
        vec![Ok(vec![
            SocketAddr::new(PUBLIC, server.port()),
            SocketAddr::new("3fff::1".parse().unwrap(), server.port()),
        ])],
    );
    let error = check(
        &format!("http://target.test:{}/html", server.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("任一非全局 AAAA 都应拒绝整组答案");
    assert_eq!(error.code, WebErrorCode::WebDnsBlocked);
    assert_eq!(server.request_count(), 1);
}

#[test]
fn rebinding_second_hop_is_rejected_without_connecting_new_origin() {
    let a = TestServer::start(
        "/a",
        TestResponse::redirect(302, "http://other.test/b"),
        false,
    );
    let b = TestServer::start("/b", html(), false);
    let resolver = ScriptedDns::with(
        "target.test",
        vec![Ok(vec![SocketAddr::new(PUBLIC, a.port())])],
    );
    let resolver = ChainedDns::new(resolver).then(
        "other.test",
        Ok(vec![SocketAddr::new(
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            b.port(),
        )]),
    );
    let error = check(
        &format!("http://target.test:{}/a", a.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("公网到私网 rebinding 必须拒绝");
    assert_eq!(error.code, WebErrorCode::WebDnsBlocked);
    assert_eq!(a.request_count(), 1);
    assert_eq!(b.request_count(), 0);
}

#[test]
fn relative_redirect_submits_last_validated_url() {
    let server =
        TestServer::start_with_followup(TestResponse::redirect(302, "/next"), html(), false);
    let resolver = ScriptedDns::with(
        "target.test",
        vec![
            Ok(vec![SocketAddr::new(PUBLIC, server.port())]),
            Ok(vec![SocketAddr::new(PUBLIC, server.port())]),
        ],
    );
    let output = check(
        &format!("http://target.test:{}/a", server.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect("relative redirect 必须按当前 URL 解析");
    assert_eq!(
        output.submitted_url,
        format!("http://target.test:{}/next", server.port())
    );
    assert_eq!(output.source_url, output.submitted_url);
    assert_eq!(output.hops.len(), 2);
    assert_eq!(server.last_request().path, "/next");
}

#[test]
fn cross_origin_redirect_submits_only_last_validated_url() {
    let b = TestServer::start("/next", html(), false);
    let a = TestServer::start(
        "/a",
        TestResponse::redirect(302, &format!("http://other.test:{}/next", b.port())),
        false,
    );
    let resolver = ChainedDns::new(ScriptedDns::public("target.test", a.port())).then(
        "other.test",
        Ok(vec![SocketAddr::new(OTHER_PUBLIC, b.port())]),
    );
    let output = check(
        &format!("http://target.test:{}/a", a.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect("未封禁的跨 origin redirect 可继续");
    assert_eq!(
        output.submitted_url,
        format!("http://other.test:{}/next", b.port())
    );
    assert_eq!(output.source_url, output.submitted_url);
    assert_eq!(output.hops.len(), 2);
    assert_eq!(b.last_request().path, "/next");
    assert_eq!(b.last_request().host, format!("other.test:{}", b.port()));
    assert!(!b.last_request().has_authorization);
    assert!(!b.last_request().has_cookie);
}

#[test]
fn redirect_origin_deny_stops_before_dns_or_connection() {
    let a = TestServer::start(
        "/a",
        TestResponse::redirect(302, "http://other.test/b"),
        false,
    );
    let b = TestServer::start("/b", html(), false);
    let resolver = ChainedDns::new(ScriptedDns::public("target.test", a.port())).then(
        "other.test",
        Ok(vec![SocketAddr::new(OTHER_PUBLIC, b.port())]),
    );
    let error = check(
        &format!("http://target.test:{}/a", a.port()),
        &permissions(&["web_fetch(http://other.test)"]),
        resolver.clone(),
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("redirect deny 必须短路");
    assert_eq!(error.code, WebErrorCode::PermissionDenied);
    assert_eq!(a.request_count(), 1);
    assert_eq!(b.request_count(), 0);
    assert_eq!(resolver.calls(), vec!["target.test"]);
}

#[test]
fn https_preserves_original_host_and_sni_with_isolated_test_ca() {
    let server = TestServer::start("/tls", html(), true);
    let resolver = ScriptedDns::public("target.test", server.port());
    let output = check(
        &format!("https://target.test:{}/tls", server.port()),
        &permissions(&[]),
        resolver,
        tls_transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect("target.test 测试 CA 与原 SNI 必须成功");
    assert_eq!(output.hops.len(), 1);
    assert_eq!(
        server.last_request().host,
        format!("target.test:{}", server.port())
    );
    assert_eq!(server.last_request().path, "/tls");
    assert_eq!(server.last_request().sni.as_deref(), Some("target.test"));
}

#[test]
fn preflight_failure_maps_to_fetch_envelope_without_provider_attempts() {
    let envelope = PreflightError {
        code: WebErrorCode::WebDnsBlocked,
        message: "synthetic preflight failure".to_string(),
    }
    .into_envelope();
    let value = serde_json::to_value(envelope).unwrap();
    assert_eq!(value["ok"], serde_json::json!(false));
    assert_eq!(value["operation"], serde_json::json!("fetch"));
    assert_eq!(value["code"], serde_json::json!("web_dns_blocked"));
    assert_eq!(
        value["message"],
        serde_json::json!("synthetic preflight failure")
    );
    assert_eq!(value["provider"], serde_json::Value::Null);
    assert_eq!(value["provider_id"], serde_json::Value::Null);
    assert_eq!(value["attempts"], serde_json::json!(0));
}

static PROXY_ENV_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn system_and_manual_proxies_are_bypassed() {
    let _guard = PROXY_ENV_LOCK.lock().unwrap();
    let target = TestServer::start("/html", html(), false);
    let proxy = TestServer::start("/proxy", TestResponse::status(502), false);
    let _env = ProxyEnv::set(&proxy);
    let resolver = ScriptedDns::public("target.test", target.port());
    let output = check(
        &format!("http://target.test:{}/html", target.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect("no_proxy 必须直达已验证目标");
    assert_eq!(output.hops.len(), 1);
    assert_eq!(target.request_count(), 1);
    assert_eq!(proxy.request_count(), 0, "no_proxy 不应触达代理");

    let baseline = reqwest::blocking::Client::new()
        .head(format!("http://target.test:{}/html", target.port()))
        .send();
    assert!(
        baseline.is_ok(),
        "反例：系统代理配置下普通 client 应触达代理"
    );
    assert!(proxy.request_count() >= 1, "反例必须证明环境代理确实生效");
}

#[test]
fn https_target_bypasses_proxy_and_negative_switch_proves_the_counterexample() {
    let _guard = PROXY_ENV_LOCK.lock().unwrap();
    let target = TestServer::start("/tls", html(), true);
    let proxy = TestServer::start("/proxy", TestResponse::status(502), false);
    let _env = ProxyEnv::set(&proxy);
    let url = format!("https://target.test:{}/tls", target.port());
    let output = check(
        &url,
        &permissions(&[]),
        ScriptedDns::public("target.test", target.port()),
        tls_transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect("HTTPS no_proxy 必须直达已验证目标");
    assert_eq!(output.hops.len(), 1);
    assert_eq!(target.request_count(), 1);
    assert_eq!(proxy.request_count(), 0);
    assert_eq!(target.last_request().sni.as_deref(), Some("target.test"));

    let error = check(
        &url,
        &permissions(&[]),
        ScriptedDns::public("target.test", target.port()),
        tls_transport().with_system_proxy_for_negative_test(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("错误实现恢复系统代理后必须被 HTTPS 反例判红");
    assert_eq!(error.code, WebErrorCode::WebNetworkFailed);
    assert_eq!(target.request_count(), 1, "代理路径不得触达 HTTPS 目标");
    assert!(proxy.request_count() >= 1, "负向开关必须真实触达代理");
    assert_eq!(proxy.last_request().method, "CONNECT");
}

#[test]
fn content_type_and_range_limit_are_enforced() {
    let large = TestServer::start_with_get(
        "/large",
        TestResponse::unknown_with_body(Vec::new()),
        TestResponse::html_with_body(vec![b'x'; 128 * 1024]),
        false,
    );
    let resolver = ScriptedDns::public("target.test", large.port());
    let output = check(
        &format!("http://target.test:{}/large", large.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect("Range GET 后 HTML 可判定");
    assert_eq!(output.hops[0].body_bytes_read, 4096);
    assert_eq!(large.last_request().method, "GET");
    assert_eq!(large.last_request().range.as_deref(), Some("bytes=0-4095"));

    let pdf = TestServer::start("/pdf", TestResponse::content_type("application/pdf"), false);
    let resolver = ScriptedDns::public("target.test", pdf.port());
    let error = check(
        &format!("http://target.test:{}/pdf", pdf.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("PDF 不是 HTML");
    assert_eq!(error.code, WebErrorCode::WebUnsupportedContent);

    let unknown = TestServer::start(
        "/unknown",
        TestResponse::unknown_with_body(Vec::new()),
        false,
    );
    let resolver = ScriptedDns::public("target.test", unknown.port());
    let error = check(
        &format!("http://target.test:{}/unknown", unknown.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("两次都无法判定 Content-Type");
    assert_eq!(error.code, WebErrorCode::WebContentTypeUnknown);
}

#[test]
fn range_partial_content_is_accepted_and_conflicting_content_types_fail_closed() {
    let partial = TestServer::start_with_get(
        "/partial",
        TestResponse::status(405),
        TestResponse {
            status: 206,
            ..TestResponse::html_with_body(b"<html>partial</html>".to_vec())
        },
        false,
    );
    let resolver = ScriptedDns::public("target.test", partial.port());
    let output = check(
        &format!("http://target.test:{}/partial", partial.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect("服务器以 206 响应 Range 时必须接受");
    assert_eq!(output.hops.len(), 1);
    assert_eq!(
        partial.last_request().range.as_deref(),
        Some("bytes=0-4095")
    );

    let conflicting = TestServer::start(
        "/conflicting",
        TestResponse {
            content_types: vec!["text/html".to_string(), "application/pdf".to_string()],
            ..TestResponse::unknown_with_body(Vec::new())
        },
        false,
    );
    let resolver = ScriptedDns::public("target.test", conflicting.port());
    let error = check(
        &format!("http://target.test:{}/conflicting", conflicting.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("冲突 Content-Type 不得取首个值放行");
    assert_eq!(error.code, WebErrorCode::WebContentTypeUnknown);
}

#[test]
fn downgrade_userinfo_location_and_redirect_limit_fail_closed() {
    let downgrade = TestServer::start(
        "/downgrade",
        TestResponse::redirect(302, "http://other.test/b"),
        true,
    );
    let resolver = ScriptedDns::public("target.test", downgrade.port());
    let error = check(
        &format!("https://target.test:{}/downgrade", downgrade.port()),
        &permissions(&[]),
        resolver,
        tls_transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("HTTPS → HTTP downgrade 必须拒绝");
    assert_eq!(error.code, WebErrorCode::WebUrlBlocked);

    let userinfo = TestServer::start(
        "/userinfo",
        TestResponse::redirect(302, "http://user:pass@other.test/b"),
        false,
    );
    let resolver = ScriptedDns::public("target.test", userinfo.port());
    let error = check(
        &format!("http://target.test:{}/userinfo", userinfo.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("带凭据 Location 必须拒绝");
    assert_eq!(error.code, WebErrorCode::WebUrlBlocked);

    let loop_server = TestServer::start("/loop", TestResponse::redirect(302, "/loop"), false);
    let resolver = ScriptedDns::public("target.test", loop_server.port());
    let error = check(
        &format!("http://target.test:{}/loop", loop_server.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("超过 5 跳必须失败");
    assert_eq!(error.code, WebErrorCode::WebRedirectLimit);
    assert_eq!(loop_server.request_count(), 6);
}

#[test]
fn backslash_location_is_rejected_before_url_normalization_or_connection() {
    let b = TestServer::start("/b", html(), false);
    let location = format!(r"http:\\other.test:{}\b", b.port());
    let a = TestServer::start("/a", TestResponse::redirect(302, &location), false);
    let resolver = ChainedDns::new(ScriptedDns::public("target.test", a.port())).then(
        "other.test",
        Ok(vec![SocketAddr::new(OTHER_PUBLIC, b.port())]),
    );
    let error = check(
        &format!("http://target.test:{}/a", a.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("反斜杠 Location 不得先规范化再放行");
    assert_eq!(error.code, WebErrorCode::WebUrlBlocked);
    assert_eq!(b.request_count(), 0);
}

#[test]
fn redirect_rechecks_length_and_target_errors_do_not_use_provider_classifications() {
    let overlength = TestServer::start(
        "/a",
        TestResponse::redirect(302, &format!("/{}", "a".repeat(8192))),
        false,
    );
    let resolver = ScriptedDns::public("target.test", overlength.port());
    let error = check(
        &format!("http://target.test:{}/a", overlength.port()),
        &permissions(&[]),
        resolver.clone(),
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("redirect 后 URL 仍不得超过 8192 字符");
    assert_eq!(error.code, WebErrorCode::WebArgsInvalid);
    assert_eq!(overlength.request_count(), 1);
    assert_eq!(resolver.calls.lock().unwrap().as_slice(), ["target.test"]);

    let missing_location = TestServer::start("/a", TestResponse::status(302), false);
    let resolver = ScriptedDns::public("target.test", missing_location.port());
    let error = check(
        &format!("http://target.test:{}/a", missing_location.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("目标 3xx 缺 Location 必须拒绝");
    assert_eq!(error.code, WebErrorCode::WebUrlBlocked);

    let head_status = TestServer::start("/missing", TestResponse::status(404), false);
    let resolver = ScriptedDns::public("target.test", head_status.port());
    let error = check(
        &format!("http://target.test:{}/missing", head_status.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("目标 HEAD HTTP 状态必须失败");
    assert_eq!(error.code, WebErrorCode::WebHttpError);
}

#[test]
fn trailing_dot_origins_cannot_bypass_initial_or_redirect_deny() {
    let resolver = ScriptedDns::default();
    let error = check(
        "http://example.com./a",
        &permissions(&["web_fetch(http://example.com)"]),
        resolver.clone(),
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("初始 URL 的 DNS 尾点不得绕过规范 deny");
    assert_eq!(error.code, WebErrorCode::PermissionDenied);
    assert!(resolver.calls.lock().unwrap().is_empty());

    let b = TestServer::start("/b", html(), false);
    let a = TestServer::start(
        "/a",
        TestResponse::redirect(302, "http://other.test./b"),
        false,
    );
    let resolver = ChainedDns::new(ScriptedDns::public("target.test", a.port())).then(
        "other.test.",
        Ok(vec![SocketAddr::new(OTHER_PUBLIC, b.port())]),
    );
    let error = check(
        &format!("http://target.test:{}/a", a.port()),
        &permissions(&["web_fetch(http://other.test)"]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("redirect 的 DNS 尾点不得绕过规范 deny");
    assert_eq!(error.code, WebErrorCode::PermissionDenied);
    assert_eq!(a.request_count(), 1);
    assert_eq!(b.request_count(), 0);
}

#[test]
fn cancel_and_deadline_return_without_joining_blocked_work() {
    let server = TestServer::start(
        "/slow",
        TestResponse::html_with_delay(Duration::from_millis(500)),
        false,
    );
    let resolver = ScriptedDns::public("target.test", server.port());
    let aborted = Arc::new(AtomicBool::new(false));
    let flag = aborted.clone();
    let cancel = thread::spawn(move || {
        thread::park_timeout(Duration::from_millis(50));
        flag.store(true, Ordering::SeqCst);
    });
    let started = Instant::now();
    let error = check(
        &format!("http://target.test:{}/slow", server.port()),
        &permissions(&[]),
        resolver.clone(),
        transport(),
        move || aborted.load(Ordering::SeqCst),
        PreflightLimits::default(),
    )
    .expect_err("等待响应头时取消");
    assert_eq!(error.code, WebErrorCode::WebCancelled);
    assert!(
        started.elapsed() < Duration::from_millis(400),
        "取消不得 join 慢请求"
    );
    cancel.join().unwrap();

    let resolver = ScriptedDns::public("target.test", server.port());
    let error = check(
        &format!("http://target.test:{}/slow", server.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits {
            hop_timeout: Duration::from_millis(40),
            chain_timeout: Duration::from_millis(200),
            max_redirects: 5,
        },
    )
    .expect_err("单 hop deadline 必须生效");
    assert_eq!(error.code, WebErrorCode::WebTimeout);
}

#[test]
fn range_body_read_cancellation_closes_wait_without_another_request() {
    let server = TestServer::start_with_get(
        "/body",
        TestResponse::unknown_with_body(Vec::new()),
        TestResponse {
            body_delay: Duration::from_millis(500),
            ..TestResponse::html_with_body(vec![b'x'; 128 * 1024])
        },
        false,
    );
    let resolver = ScriptedDns::public("target.test", server.port());
    let aborted = Arc::new(AtomicBool::new(false));
    let flag = aborted.clone();
    let cancel = thread::spawn(move || {
        thread::park_timeout(Duration::from_millis(50));
        flag.store(true, Ordering::SeqCst);
    });
    let started = Instant::now();
    let error = check(
        &format!("http://target.test:{}/body", server.port()),
        &permissions(&[]),
        resolver,
        transport(),
        move || aborted.load(Ordering::SeqCst),
        PreflightLimits::default(),
    )
    .expect_err("Range body 读取必须可取消");
    assert_eq!(error.code, WebErrorCode::WebCancelled);
    assert!(started.elapsed() < Duration::from_millis(400));
    assert_eq!(server.last_request().method, "GET");
    assert_eq!(server.request_count(), 2);
    cancel.join().unwrap();
}

#[test]
fn blocked_dns_honors_cancellation_and_hop_deadline_without_joining() {
    let aborted = Arc::new(AtomicBool::new(false));
    let flag = aborted.clone();
    let cancel = thread::spawn(move || {
        thread::park_timeout(Duration::from_millis(50));
        flag.store(true, Ordering::SeqCst);
    });
    let started = Instant::now();
    let error = check(
        "http://target.test/a",
        &permissions(&[]),
        BlockingDns,
        transport(),
        move || aborted.load(Ordering::SeqCst),
        PreflightLimits::default(),
    )
    .expect_err("阻塞 DNS 必须可取消");
    assert_eq!(error.code, WebErrorCode::WebCancelled);
    assert!(started.elapsed() < Duration::from_millis(400));
    cancel.join().unwrap();

    let started = Instant::now();
    let error = check(
        "http://target.test/a",
        &permissions(&[]),
        BlockingDns,
        transport(),
        &|| false,
        PreflightLimits {
            hop_timeout: Duration::from_millis(40),
            chain_timeout: Duration::from_millis(200),
            max_redirects: 5,
        },
    )
    .expect_err("阻塞 DNS 必须受 hop deadline 限制");
    assert_eq!(error.code, WebErrorCode::WebTimeout);
    assert!(started.elapsed() < Duration::from_millis(400));
}

#[test]
fn hop_deadline_spans_dns_and_http_instead_of_resetting_per_operation() {
    let server = TestServer::start(
        "/slow",
        TestResponse::html_with_delay(Duration::from_millis(100)),
        false,
    );
    let resolver = DelayedDns {
        delay: Duration::from_millis(100),
        answer: SocketAddr::new(PUBLIC, server.port()),
    };
    let started = Instant::now();
    let error = check(
        &format!("http://target.test:{}/slow", server.port()),
        &permissions(&[]),
        resolver,
        transport(),
        &|| false,
        PreflightLimits {
            hop_timeout: Duration::from_millis(150),
            chain_timeout: Duration::from_millis(500),
            max_redirects: 5,
        },
    )
    .expect_err("DNS 与 HTTP 必须共享同一个 hop deadline");
    assert_eq!(error.code, WebErrorCode::WebTimeout);
    assert!(started.elapsed() < Duration::from_millis(300));
}

#[test]
fn invalid_url_shapes_and_overlength_input_fail_before_dns_or_network() {
    for url in [
        "file:///tmp/a",
        "http://user:pass@target.test/a",
        r"http://target.test\@127.0.0.1/a",
        "https:///missing-host",
        "http://target.test/\n",
    ] {
        let resolver = ScriptedDns::default();
        let error = check(
            url,
            &permissions(&[]),
            resolver.clone(),
            transport(),
            &|| false,
            PreflightLimits::default(),
        )
        .expect_err(url);
        assert_eq!(error.code, WebErrorCode::WebUrlBlocked, "{url}");
        assert!(resolver.calls.lock().unwrap().is_empty(), "{url}");
    }

    let overlength = format!("http://target.test/{}", "a".repeat(8192));
    let resolver = ScriptedDns::default();
    let error = check(
        &overlength,
        &permissions(&[]),
        resolver.clone(),
        transport(),
        &|| false,
        PreflightLimits::default(),
    )
    .expect_err("超过 8192 字符必须拒绝");
    assert_eq!(error.code, WebErrorCode::WebArgsInvalid);
    assert!(resolver.calls.lock().unwrap().is_empty());
}

#[test]
fn localhost_local_dns_failure_and_ip_variants_fail_before_network() {
    for url in [
        "http://localhost/a",
        "http://printer.local/a",
        "http://127.0.0.1/a",
        "http://[::1]/a",
        "http://[::ffff:127.0.0.1]/a",
        "http://[2001:db8::1]/a",
    ] {
        let error = check(
            url,
            &permissions(&[]),
            ScriptedDns::default(),
            transport(),
            &|| false,
            PreflightLimits::default(),
        )
        .expect_err(url);
        assert!(matches!(
            error.code,
            WebErrorCode::WebUrlBlocked | WebErrorCode::WebDnsBlocked | WebErrorCode::WebDnsFailed
        ));
    }
}

struct DelayedDns {
    delay: Duration,
    answer: SocketAddr,
}

impl WebDnsResolver for DelayedDns {
    fn resolve(&self, _host: &str) -> Result<Vec<SocketAddr>, String> {
        thread::park_timeout(self.delay);
        Ok(vec![self.answer])
    }
}

struct BlockingDns;

impl WebDnsResolver for BlockingDns {
    fn resolve(&self, _host: &str) -> Result<Vec<SocketAddr>, String> {
        thread::park_timeout(Duration::from_millis(500));
        Err("synthetic blocked DNS".to_string())
    }
}

#[derive(Clone)]
struct ChainedDns {
    current: ScriptedDns,
    next_host: String,
    next: Result<Vec<SocketAddr>, String>,
}

impl ChainedDns {
    fn new(current: ScriptedDns) -> Self {
        Self {
            current,
            next_host: String::new(),
            next: Ok(Vec::new()),
        }
    }

    fn then(mut self, host: &str, answer: Result<Vec<SocketAddr>, String>) -> Self {
        self.next_host = host.to_string();
        self.next = answer;
        self
    }

    fn calls(&self) -> Vec<String> {
        self.current.calls.lock().unwrap().clone()
    }
}

impl WebDnsResolver for ChainedDns {
    fn resolve(&self, host: &str) -> Result<Vec<SocketAddr>, String> {
        if host == self.next_host {
            return self.next.clone();
        }
        self.current.resolve(host)
    }
}

#[derive(Clone)]
struct TestResponse {
    status: u16,
    content_types: Vec<String>,
    location: Option<String>,
    body: Vec<u8>,
    delay: Duration,
    body_delay: Duration,
}

impl TestResponse {
    fn html() -> Self {
        Self::content_type("text/html")
    }

    fn html_with_delay(delay: Duration) -> Self {
        Self {
            delay,
            ..Self::html()
        }
    }

    fn html_with_body(body: Vec<u8>) -> Self {
        Self {
            content_types: vec!["text/html".to_string()],
            ..Self::unknown_with_body(body)
        }
    }

    fn content_type(value: &str) -> Self {
        Self {
            status: 200,
            content_types: vec![value.to_string()],
            location: None,
            body: b"<html>ok</html>".to_vec(),
            delay: Duration::ZERO,
            body_delay: Duration::ZERO,
        }
    }

    fn unknown_with_body(body: Vec<u8>) -> Self {
        Self {
            status: 200,
            content_types: Vec::new(),
            location: None,
            body,
            delay: Duration::ZERO,
            body_delay: Duration::ZERO,
        }
    }

    fn redirect(status: u16, location: &str) -> Self {
        Self {
            status,
            content_types: Vec::new(),
            location: Some(location.to_string()),
            body: Vec::new(),
            delay: Duration::ZERO,
            body_delay: Duration::ZERO,
        }
    }

    fn status(status: u16) -> Self {
        Self {
            status,
            content_types: Vec::new(),
            location: None,
            body: Vec::new(),
            delay: Duration::ZERO,
            body_delay: Duration::ZERO,
        }
    }
}

#[derive(Clone, Debug)]
struct RequestRecord {
    method: String,
    path: String,
    host: String,
    sni: Option<String>,
    range: Option<String>,
    has_authorization: bool,
    has_cookie: bool,
}

struct TestServer {
    port: u16,
    response: TestResponse,
    records: Arc<Mutex<Vec<RequestRecord>>>,
    stop: Arc<AtomicBool>,
    accept: Option<thread::JoinHandle<()>>,
}

impl TestServer {
    fn start(path: &str, response: TestResponse, tls: bool) -> Self {
        Self::start_inner(path, response, None, None, tls)
    }

    fn start_with_get(
        path: &str,
        head_response: TestResponse,
        get_response: TestResponse,
        tls: bool,
    ) -> Self {
        Self::start_inner(path, head_response, Some(get_response), None, tls)
    }

    fn start_with_followup(
        first_response: TestResponse,
        followup_response: TestResponse,
        tls: bool,
    ) -> Self {
        Self::start_inner("", first_response, None, Some(followup_response), tls)
    }

    fn start_inner(
        path: &str,
        response: TestResponse,
        get_response: Option<TestResponse>,
        followup_response: Option<TestResponse>,
        tls: bool,
    ) -> Self {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let path = path.to_string();
        let records = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let accept_records = records.clone();
        let accept_stop = stop.clone();
        let accept_response = response.clone();
        let accept = thread::spawn(move || {
            while !accept_stop.load(Ordering::SeqCst) {
                let Ok((stream, _)) = listener.accept() else {
                    thread::park_timeout(Duration::from_millis(5));
                    continue;
                };
                if tls {
                    serve_tls(
                        stream,
                        &path,
                        &accept_response,
                        get_response.as_ref(),
                        followup_response.as_ref(),
                        &accept_records,
                    );
                } else {
                    serve_http(
                        stream,
                        &path,
                        &accept_response,
                        get_response.as_ref(),
                        followup_response.as_ref(),
                        &accept_records,
                    );
                }
            }
        });
        Self {
            port,
            response,
            records,
            stop,
            accept: Some(accept),
        }
    }

    fn port(&self) -> u16 {
        self.port
    }

    fn request_count(&self) -> usize {
        self.records.lock().unwrap().len()
    }

    fn last_request(&self) -> RequestRecord {
        self.records.lock().unwrap().last().cloned().unwrap()
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(accept) = self.accept.take() {
            accept.join().unwrap();
        }
        let _ = &self.response;
    }
}

fn serve_http(
    stream: TcpStream,
    path: &str,
    response: &TestResponse,
    get_response: Option<&TestResponse>,
    followup_response: Option<&TestResponse>,
    records: &Arc<Mutex<Vec<RequestRecord>>>,
) {
    stream.set_nonblocking(false).unwrap();
    let mut stream = stream;
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let request = read_request(&mut reader);
    let response = if !records.lock().unwrap().is_empty() && followup_response.is_some() {
        followup_response.unwrap_or(response)
    } else if request.method == "GET" {
        get_response.unwrap_or(response)
    } else {
        response
    };
    records.lock().unwrap().push(request);
    write_response(&mut stream, path, response);
}

fn serve_tls(
    stream: TcpStream,
    path: &str,
    response: &TestResponse,
    get_response: Option<&TestResponse>,
    followup_response: Option<&TestResponse>,
    records: &Arc<Mutex<Vec<RequestRecord>>>,
) {
    stream.set_nonblocking(false).unwrap();
    let config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            rustls_pemfile::certs(&mut include_bytes!("testdata/target.test/cert.pem").as_slice())
                .map(|item| item.expect("test certificate"))
                .collect::<Vec<_>>(),
            rustls_pemfile::private_key(
                &mut include_bytes!("testdata/target.test/key.pem").as_slice(),
            )
            .map(|item| item.expect("test private key"))
            .unwrap(),
        )
        .unwrap();
    let connection = rustls::ServerConnection::new(Arc::new(config)).unwrap();
    let mut stream = rustls::StreamOwned::new(connection, stream);
    let mut request = read_request(&mut stream);
    request.sni = stream.conn.server_name().map(str::to_string);
    let response = if !records.lock().unwrap().is_empty() && followup_response.is_some() {
        followup_response.unwrap_or(response)
    } else if request.method == "GET" {
        get_response.unwrap_or(response)
    } else {
        response
    };
    records.lock().unwrap().push(request);
    write_response(&mut stream, path, response);
}

fn read_request(reader: &mut impl BufRead) -> RequestRecord {
    let mut request_line = String::new();
    reader.read_line(&mut request_line).unwrap();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    let mut host = String::new();
    let mut range = None;
    let mut has_authorization = false;
    let mut has_cookie = false;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        if line == "\r\n" || line.is_empty() {
            break;
        }
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("host:") {
            host = line[5..].trim().to_string();
        } else if lower.starts_with("range:") {
            range = Some(line[6..].trim().to_string());
        } else if lower.starts_with("authorization:") {
            has_authorization = true;
        } else if lower.starts_with("cookie:") {
            has_cookie = true;
        }
    }
    RequestRecord {
        method,
        path,
        host,
        sni: None,
        range,
        has_authorization,
        has_cookie,
    }
}

fn write_response(stream: &mut impl Write, path: &str, response: &TestResponse) {
    thread::park_timeout(response.delay);
    let status_text = match response.status {
        200 => "OK",
        301 | 302 | 303 | 307 | 308 => "Found",
        _ => "Error",
    };
    let mut headers = format!("HTTP/1.1 {} {}\r\n", response.status, status_text);
    for content_type in &response.content_types {
        headers.push_str(&format!("Content-Type: {content_type}\r\n"));
    }
    if let Some(location) = &response.location {
        headers.push_str(&format!("Location: {location}\r\n"));
    }
    headers.push_str(&format!(
        "Content-Length: {}\r\nConnection: close\r\n\r\n",
        response.body.len()
    ));
    let _ = stream.write_all(headers.as_bytes());
    let _ = stream.flush();
    if !response.body.is_empty() {
        thread::park_timeout(response.body_delay);
        let _ = stream.write_all(&response.body);
    }
    let _ = stream.flush();
    let _ = path;
}

struct ProxyEnv {
    old: Vec<(String, Option<std::ffi::OsString>)>,
}

impl ProxyEnv {
    fn set(proxy: &TestServer) -> Self {
        let names = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"];
        let old = names
            .iter()
            .map(|name| (name.to_string(), std::env::var_os(name)))
            .collect();
        let url = format!("http://127.0.0.1:{}", proxy.port());
        for name in &names[..3] {
            std::env::set_var(name, &url);
        }
        std::env::remove_var("NO_PROXY");
        Self { old }
    }
}

impl Drop for ProxyEnv {
    fn drop(&mut self) {
        for (name, value) in &self.old {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
        }
    }
}
