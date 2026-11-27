//! 独立验收装配（阶段5）：只在 `--features acceptance-web` 的构建里编译。
//!
//! 生产装配（`ConfiguredWebToolPort::new`）在没有本 feature 时只会走 `DeepSeekWebProvider::official`；
//! 本模块把测试 provider / transport / resolver 的注入面收在一个显式 feature 后面。激活还需要
//! `LUMIR_ACCEPTANCE_WEB_ENDPOINTS`（JSON），普通 config / env / dev / release 构建即使设了这个
//! 环境变量也没有读取代码。
//!
//! 注入**不放宽**任何真实校验：目标 URL 仍走 `run_preflight` 的 scheme / host / DNS / 重定向 /
//! 内容类型检查；这里只把 `target.test` 的 DNS 答案换成合成公网 IP，再由测试 transport 映射到
//! 本机监听端口（与阶段3测试同一手法），不增加 loopback / SSRF 例外。

use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;

use crate::config::HarnessConfig;

use super::executor::WebExecutor;
use super::output::{WebContentScope, WebCoverage, WebFetchMode};
use super::preflight::{ReqwestWebTransport, WebDnsResolver};
use super::provider::{DeepSeekWebProvider, SystemWebBackoff};
use super::ConfiguredWebToolPort;

/// 验收装配的端点清单。`targets` 的键是合成主机名（如 `target.test`），值是本机监听端口。
#[derive(Debug, serde::Deserialize)]
struct Endpoints {
    deepseek: String,
    #[serde(default = "default_provider_id")]
    provider_id: String,
    #[serde(default = "default_api_key")]
    api_key: String,
    targets: BTreeMap<String, u16>,
    #[serde(default)]
    ca_pem: Option<String>,
    /// 能力覆盖（change web-evidence-provenance-nov26）：仅验收装配可把测试 provider 的
    /// fetch_modes 设为 `[full, selected_chunks]`。生产构建没有本字段的读取代码。
    #[serde(default)]
    fetch_modes: Option<Vec<WebFetchMode>>,
    /// 脚本化成功形态：与 `fetch_modes` 同批启用，用于证明两种证据形态可表达。
    #[serde(default)]
    scripted_scope: Option<WebContentScope>,
    #[serde(default)]
    scripted_coverage: Option<WebCoverage>,
}

fn default_provider_id() -> String {
    "deepseek-acceptance".to_string()
}

fn default_api_key() -> String {
    "acceptance-only-key".to_string()
}

struct AcceptanceDns {
    answers: BTreeMap<String, SocketAddr>,
}

impl WebDnsResolver for AcceptanceDns {
    fn resolve(&self, host: &str) -> Result<Vec<SocketAddr>, String> {
        self.answers
            .get(host)
            .map(|addr| vec![*addr])
            .ok_or_else(|| format!("验收 resolver 没有 {host} 的合成答案"))
    }
}

/// 从环境装配验收端口；env 未设置 ⇒ None（调用方回落到生产装配）。
pub fn from_env(config: &HarnessConfig) -> Option<ConfiguredWebToolPort> {
    let raw = std::env::var("LUMIR_ACCEPTANCE_WEB_ENDPOINTS").ok()?;
    let endpoints: Endpoints = serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("LUMIR_ACCEPTANCE_WEB_ENDPOINTS 非法：{e}"));
    if endpoints.deepseek.trim().is_empty() {
        panic!("LUMIR_ACCEPTANCE_WEB_ENDPOINTS.deepseek 不能为空");
    }
    let answers = endpoints
        .targets
        .iter()
        .map(|(host, port)| {
            (
                host.to_ascii_lowercase(),
                SocketAddr::new(IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)), *port),
            )
        })
        .collect::<BTreeMap<_, _>>();
    if answers.is_empty() {
        panic!("LUMIR_ACCEPTANCE_WEB_ENDPOINTS.targets 不能为空");
    }
    let scripted = match (endpoints.scripted_scope, endpoints.scripted_coverage) {
        (Some(scope), Some(coverage)) => Some((scope, coverage)),
        (None, None) => None,
        _ => panic!("验收装配的 scripted_scope 与 scripted_coverage 必须同时给出"),
    };
    let mut provider = DeepSeekWebProvider::with_endpoint_for_test(
        &endpoints.deepseek,
        &endpoints.provider_id,
        &endpoints.api_key,
    );
    if endpoints.fetch_modes.is_some() || scripted.is_some() {
        let modes = endpoints
            .fetch_modes
            .unwrap_or_else(|| vec![WebFetchMode::Full]);
        provider = provider.with_modes_and_scripted_for_test(modes, scripted);
    }
    let provider = Arc::new(provider);
    let transport = match endpoints.ca_pem {
        Some(path) => {
            let pem =
                std::fs::read(&path).unwrap_or_else(|e| panic!("验收 CA 不可读（{path}）：{e}"));
            ReqwestWebTransport::with_test_mapping_and_roots(
                |addr| SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), addr.port()),
                vec![pem],
            )
        }
        None => ReqwestWebTransport::with_test_mapping(|addr| {
            SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), addr.port())
        }),
    };
    let executor = WebExecutor::with_dependencies_for_test(
        provider,
        config.permissions.clone(),
        Arc::new(AcceptanceDns { answers }),
        Arc::new(transport),
        Arc::new(SystemWebBackoff),
    );
    Some(ConfiguredWebToolPort::with_executor_for_test(
        config, executor,
    ))
}
