use std::io::Read;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::Arc;
use std::time::{Duration, Instant};

use reqwest::blocking::Client;
use reqwest::header::{CONTENT_TYPE, LOCATION, RANGE};
use reqwest::{StatusCode, Url};

use crate::config::HarnessPermissions;

use super::output::WebErrorCode;
use super::url::Origin;
use crate::harness::permissions::matching_rule;

const RANGE_BODY_LIMIT: usize = 4096;
const CANCEL_POLL: Duration = Duration::from_millis(25);

#[derive(Debug, Clone, Copy)]
pub struct PreflightLimits {
    pub hop_timeout: Duration,
    pub chain_timeout: Duration,
    pub max_redirects: usize,
}

impl Default for PreflightLimits {
    fn default() -> Self {
        Self {
            hop_timeout: Duration::from_secs(10),
            chain_timeout: Duration::from_secs(30),
            max_redirects: 5,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreflightHop {
    pub url: String,
    pub body_bytes_read: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreflightSuccess {
    pub submitted_url: String,
    pub source_url: String,
    pub hops: Vec<PreflightHop>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreflightError {
    pub code: WebErrorCode,
    pub message: String,
}

impl PreflightError {
    fn new(code: WebErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub trait WebDnsResolver: Send + Sync {
    fn resolve(&self, host: &str) -> Result<Vec<SocketAddr>, String>;
}

#[derive(Debug, Default)]
pub struct SystemDnsResolver;

impl WebDnsResolver for SystemDnsResolver {
    fn resolve(&self, host: &str) -> Result<Vec<SocketAddr>, String> {
        (host, 0)
            .to_socket_addrs()
            .map(|items| items.collect())
            .map_err(|error| error.to_string())
    }
}

pub trait WebTransport: Send + Sync {
    fn send(
        &self,
        method: TransportMethod,
        url: Url,
        addrs: &[SocketAddr],
        timeout: Duration,
        aborted: Arc<dyn Fn() -> bool + Send + Sync>,
    ) -> Result<TransportResponse, PreflightError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportMethod {
    Head,
    GetRange,
}

#[derive(Debug)]
pub struct TransportResponse {
    pub status: StatusCode,
    pub content_type: Option<String>,
    pub location: Option<String>,
    pub body_bytes_read: usize,
}

#[derive(Default)]
pub struct ReqwestWebTransport {
    #[cfg(test)]
    addr_mapper: Option<Arc<dyn Fn(SocketAddr) -> SocketAddr + Send + Sync>>,
    #[cfg(test)]
    root_certificates: Vec<reqwest::Certificate>,
}

impl ReqwestWebTransport {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    pub fn with_test_mapping(
        mapper: impl Fn(SocketAddr) -> SocketAddr + Send + Sync + 'static,
    ) -> Self {
        Self {
            addr_mapper: Some(Arc::new(mapper)),
            root_certificates: Vec::new(),
        }
    }

    #[cfg(test)]
    pub fn with_test_mapping_and_roots(
        mapper: impl Fn(SocketAddr) -> SocketAddr + Send + Sync + 'static,
        root_certificates: Vec<Vec<u8>>,
    ) -> Self {
        Self {
            addr_mapper: Some(Arc::new(mapper)),
            root_certificates: root_certificates
                .into_iter()
                .filter_map(|pem| reqwest::Certificate::from_pem(&pem).ok())
                .collect(),
        }
    }

    fn mapped_addrs(&self, addrs: &[SocketAddr]) -> Vec<SocketAddr> {
        #[cfg(test)]
        if let Some(mapper) = &self.addr_mapper {
            return addrs.iter().copied().map(|addr| mapper(addr)).collect();
        }
        addrs.to_vec()
    }
}

impl WebTransport for ReqwestWebTransport {
    fn send(
        &self,
        method: TransportMethod,
        url: Url,
        addrs: &[SocketAddr],
        timeout: Duration,
        aborted: Arc<dyn Fn() -> bool + Send + Sync>,
    ) -> Result<TransportResponse, PreflightError> {
        let host = resolution_host(&url)?;
        let addrs = self.mapped_addrs(addrs);
        let builder = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(timeout)
            .timeout(timeout)
            .resolve_to_addrs(&host, &addrs);
        #[cfg(test)]
        let mut builder = builder;
        #[cfg(test)]
        if !self.root_certificates.is_empty() {
            builder = builder.tls_built_in_root_certs(false);
        }
        #[cfg(test)]
        for certificate in &self.root_certificates {
            builder = builder.add_root_certificate(certificate.clone());
        }
        let client = builder.build().map_err(|error| {
            PreflightError::new(WebErrorCode::WebNetworkFailed, error.to_string())
        })?;
        let request = match method {
            TransportMethod::Head => client.head(url),
            TransportMethod::GetRange => client.get(url).header(RANGE, "bytes=0-4095"),
        };
        let mut response = request.send().map_err(|error| {
            if aborted() {
                PreflightError::new(WebErrorCode::WebCancelled, "网页预检已取消")
            } else if error.is_timeout() {
                PreflightError::new(WebErrorCode::WebTimeout, "网页预检超时")
            } else {
                PreflightError::new(WebErrorCode::WebNetworkFailed, error.to_string())
            }
        })?;
        let status = response.status();
        let content_type = single_content_type(&response);
        let location = response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let mut body_bytes_read = 0;
        if method == TransportMethod::GetRange {
            let mut buffer = [0_u8; 1024];
            while body_bytes_read < RANGE_BODY_LIMIT {
                if aborted() {
                    return Err(PreflightError::new(
                        WebErrorCode::WebCancelled,
                        "网页预检已取消",
                    ));
                }
                let read = response.read(&mut buffer).map_err(|error| {
                    if aborted() {
                        PreflightError::new(WebErrorCode::WebCancelled, "网页预检已取消")
                    } else if error.kind() == std::io::ErrorKind::TimedOut {
                        PreflightError::new(WebErrorCode::WebTimeout, "网页预检超时")
                    } else {
                        PreflightError::new(WebErrorCode::WebNetworkFailed, error.to_string())
                    }
                })?;
                if read == 0 {
                    break;
                }
                body_bytes_read = (body_bytes_read + read).min(RANGE_BODY_LIMIT);
            }
        }
        Ok(TransportResponse {
            status,
            content_type,
            location,
            body_bytes_read,
        })
    }
}

pub fn run_preflight(
    raw_url: &str,
    permissions: &HarnessPermissions,
    resolver: Arc<dyn WebDnsResolver>,
    transport: Arc<dyn WebTransport>,
    aborted: Arc<dyn Fn() -> bool + Send + Sync>,
    limits: PreflightLimits,
) -> Result<PreflightSuccess, PreflightError> {
    if raw_url.is_empty() || raw_url.chars().count() > 8192 {
        return Err(PreflightError::new(
            WebErrorCode::WebArgsInvalid,
            "Web Fetch url 长度必须为 1–8192 字符",
        ));
    }
    Origin::from_url(raw_url)
        .map_err(|error| PreflightError::new(WebErrorCode::WebUrlBlocked, error))?;
    let mut current = Url::parse(raw_url)
        .map_err(|error| PreflightError::new(WebErrorCode::WebUrlBlocked, error.to_string()))?;
    let chain_deadline = Instant::now() + limits.chain_timeout;
    let mut redirects = 0;
    let mut hops = Vec::new();
    loop {
        let hop_deadline = Instant::now() + limits.hop_timeout;
        if aborted() {
            return Err(cancelled());
        }
        let origin = Origin::from_url(current.as_str())
            .map_err(|error| PreflightError::new(WebErrorCode::WebUrlBlocked, error))?;
        if let Some(rule) = matching_rule(&permissions.deny, "web_fetch", &origin.as_str()) {
            return Err(PreflightError::new(
                WebErrorCode::PermissionDenied,
                format!("命中 deny 规则 {rule}"),
            ));
        }
        let host = resolution_host(&current)?;
        let remaining = remaining_time(chain_deadline, hop_deadline)?;
        let resolver = resolver.clone();
        let addresses = run_bounded(remaining, aborted.clone(), move || {
            resolver
                .resolve(&host)
                .map_err(|_| PreflightError::new(WebErrorCode::WebDnsFailed, "目标 DNS 解析失败"))
        })?;
        if addresses.is_empty() {
            return Err(PreflightError::new(
                WebErrorCode::WebDnsFailed,
                "目标 DNS 没有可用地址",
            ));
        }
        if addresses.iter().any(|addr| !globally_routable(addr.ip())) {
            return Err(PreflightError::new(
                WebErrorCode::WebDnsBlocked,
                "目标包含非全局单播地址",
            ));
        }
        let remaining = remaining_time(chain_deadline, hop_deadline)?;
        let head = execute_bounded(
            transport.clone(),
            TransportMethod::Head,
            current.clone(),
            addresses.clone(),
            remaining,
            aborted.clone(),
        )?;
        if is_redirect(head.status) {
            hops.push(PreflightHop {
                url: current.as_str().to_string(),
                body_bytes_read: head.body_bytes_read,
            });
            current = redirect_target(&current, &head, redirects, limits.max_redirects)?;
            redirects += 1;
            continue;
        }
        let mut hop = head;
        if hop.status != StatusCode::OK
            && !matches!(
                hop.status,
                StatusCode::METHOD_NOT_ALLOWED | StatusCode::NOT_IMPLEMENTED
            )
        {
            return Err(PreflightError::new(
                WebErrorCode::WebNetworkFailed,
                format!("目标 HEAD 返回 HTTP {}", hop.status),
            ));
        }
        let mut classification = content_class(&hop);
        if classification == ContentClass::Unknown {
            let remaining = remaining_time(chain_deadline, hop_deadline)?;
            let get = execute_bounded(
                transport.clone(),
                TransportMethod::GetRange,
                current.clone(),
                addresses,
                remaining,
                aborted.clone(),
            )?;
            if is_redirect(get.status) {
                hops.push(PreflightHop {
                    url: current.as_str().to_string(),
                    body_bytes_read: get.body_bytes_read,
                });
                current = redirect_target(&current, &get, redirects, limits.max_redirects)?;
                redirects += 1;
                continue;
            }
            if !matches!(get.status, StatusCode::OK | StatusCode::PARTIAL_CONTENT) {
                return Err(PreflightError::new(
                    WebErrorCode::WebNetworkFailed,
                    format!("目标 Range GET 返回 HTTP {}", get.status),
                ));
            }
            hop = get;
            classification = content_class(&hop);
        }
        match classification {
            ContentClass::Html => {
                let submitted_url = current.as_str().to_string();
                hops.push(PreflightHop {
                    url: submitted_url.clone(),
                    body_bytes_read: hop.body_bytes_read,
                });
                return Ok(PreflightSuccess {
                    submitted_url: submitted_url.clone(),
                    source_url: submitted_url,
                    hops,
                });
            }
            ContentClass::Unsupported => {
                return Err(PreflightError::new(
                    WebErrorCode::WebUnsupportedContent,
                    "目标不是 HTML / XHTML；可另行选择 curl",
                ));
            }
            ContentClass::Unknown => {
                return Err(PreflightError::new(
                    WebErrorCode::WebContentTypeUnknown,
                    "无法确认目标为 HTML；可另行选择 curl",
                ));
            }
        }
    }
}

fn execute_bounded(
    transport: Arc<dyn WebTransport>,
    method: TransportMethod,
    url: Url,
    addrs: Vec<SocketAddr>,
    timeout: Duration,
    aborted: Arc<dyn Fn() -> bool + Send + Sync>,
) -> Result<TransportResponse, PreflightError> {
    let worker_abort = aborted.clone();
    run_bounded(timeout, aborted, move || {
        transport.send(method, url, &addrs, timeout, worker_abort)
    })
}

fn run_bounded<T: Send + 'static>(
    timeout: Duration,
    aborted: Arc<dyn Fn() -> bool + Send + Sync>,
    work: impl FnOnce() -> Result<T, PreflightError> + Send + 'static,
) -> Result<T, PreflightError> {
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = sender.send(work());
    });
    let deadline = Instant::now() + timeout;
    loop {
        if aborted() {
            return Err(cancelled());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(PreflightError::new(
                WebErrorCode::WebTimeout,
                "网页预检超时",
            ));
        }
        match receiver.recv_timeout(remaining.min(CANCEL_POLL)) {
            Ok(result) => return result,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err(PreflightError::new(
                    WebErrorCode::WebNetworkFailed,
                    "预检工作单元异常结束",
                ));
            }
        }
    }
}

fn remaining_time(chain: Instant, hop: Instant) -> Result<Duration, PreflightError> {
    let remaining = chain.min(hop).saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return Err(PreflightError::new(
            WebErrorCode::WebTimeout,
            "网页预检超时",
        ));
    }
    Ok(remaining)
}

fn cancelled() -> PreflightError {
    PreflightError::new(WebErrorCode::WebCancelled, "网页预检已取消")
}

fn resolution_host(url: &Url) -> Result<String, PreflightError> {
    let host = url
        .host_str()
        .ok_or_else(|| PreflightError::new(WebErrorCode::WebUrlBlocked, "URL 缺少 host"))?;
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".local") {
        return Err(PreflightError::new(
            WebErrorCode::WebUrlBlocked,
            "localhost / .local 目标被禁止",
        ));
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if !globally_routable(ip) {
            return Err(PreflightError::new(
                WebErrorCode::WebUrlBlocked,
                "IP 目标不是全局单播地址",
            ));
        }
    }
    Ok(host.to_string())
}

fn globally_routable(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ipv4_globally_routable(ip),
        IpAddr::V6(ip) => {
            if let Some(mapped) = ip.to_ipv4_mapped() {
                ipv4_globally_routable(mapped)
            } else if let Some(compatible) = ip.to_ipv4() {
                ipv4_globally_routable(compatible)
            } else {
                ipv6_globally_routable(ip)
            }
        }
    }
}

fn ipv4_globally_routable(ip: std::net::Ipv4Addr) -> bool {
    let octets = ip.octets();
    let value = u32::from(ip);
    !(octets[0] == 0
        || octets[0] == 10
        || octets[0] == 127
        || (octets[0] == 172 && (16..=31).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 168)
        || (octets[0] == 169 && octets[1] == 254)
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
        || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
        || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
        || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
        || (octets[0] >= 224)
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        || (octets[0] == 192 && octets[1] == 88 && octets[2] == 99)
        || value == u32::MAX)
}

fn ipv6_globally_routable(ip: std::net::Ipv6Addr) -> bool {
    let segments = ip.segments();
    !(segments[0] == 0
        || (segments[0] & 0xff00) == 0xff00
        || (segments[0] & 0xfe00) == 0xfc00
        || (segments[0] & 0xffc0) == 0xfe80
        || (segments[0] == 0x2001 && segments[1] == 0x0002)
        || (segments[0] == 0x2001 && (segments[1] & 0xfff0) == 0x0010)
        || (segments[0] == 0x2001 && (segments[1] & 0xfff0) == 0x0020)
        || (segments[0] == 0x2001 && segments[1] == 0x0db8)
        || (segments[0] & 0xe000) != 0x2000)
}

fn single_content_type(response: &reqwest::blocking::Response) -> Option<String> {
    let mut values = response.headers().get_all(CONTENT_TYPE).iter();
    let first = values.next()?.to_str().ok()?.to_string();
    if values.any(|value| value.to_str().ok() != Some(first.as_str())) {
        return None;
    }
    Some(first)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContentClass {
    Html,
    Unsupported,
    Unknown,
}

fn content_class(response: &TransportResponse) -> ContentClass {
    let Some(content_type) = &response.content_type else {
        return ContentClass::Unknown;
    };
    let media = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match media.as_str() {
        "text/html" | "application/xhtml+xml" => ContentClass::Html,
        "" => ContentClass::Unknown,
        _ => ContentClass::Unsupported,
    }
}

fn is_redirect(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::MOVED_PERMANENTLY
            | StatusCode::FOUND
            | StatusCode::SEE_OTHER
            | StatusCode::TEMPORARY_REDIRECT
            | StatusCode::PERMANENT_REDIRECT
    )
}

fn redirect_target(
    current: &Url,
    response: &TransportResponse,
    redirects: usize,
    max_redirects: usize,
) -> Result<Url, PreflightError> {
    if redirects >= max_redirects {
        return Err(PreflightError::new(
            WebErrorCode::WebRedirectLimit,
            "重定向超过 5 次",
        ));
    }
    let location = response.location.as_deref().ok_or_else(|| {
        PreflightError::new(
            WebErrorCode::WebProviderProtocolError,
            "重定向缺少 Location",
        )
    })?;
    if location.is_empty() || location.contains('\\') || location.chars().any(char::is_control) {
        return Err(PreflightError::new(
            WebErrorCode::WebUrlBlocked,
            "Location 为空、含控制字符或反斜杠",
        ));
    }
    let next = current
        .join(location)
        .map_err(|error| PreflightError::new(WebErrorCode::WebUrlBlocked, error.to_string()))?;
    if current.scheme() == "https" && next.scheme() == "http" {
        return Err(PreflightError::new(
            WebErrorCode::WebUrlBlocked,
            "HTTPS → HTTP scheme downgrade 被禁止",
        ));
    }
    Origin::from_url(next.as_str())
        .map_err(|error| PreflightError::new(WebErrorCode::WebUrlBlocked, error))?;
    Ok(next)
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn global_ip_rules_cover_reserved_and_mapped_addresses() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.1.1",
            "100.64.0.1",
            "224.0.0.1",
            "240.0.0.1",
            "192.0.2.1",
            "198.51.100.1",
            "203.0.113.1",
            "0.0.0.0",
            "255.255.255.255",
            "::1",
            "::",
            "ff02::1",
            "2001:db8::1",
            "2001:2::1",
            "2001:10::1",
            "2001:20::1",
            "fd00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
        ] {
            let ip: IpAddr = ip.parse().unwrap();
            assert!(!globally_routable(ip), "{ip}");
        }
        for ip in [
            "93.184.216.34",
            "203.0.114.1",
            "2001:4860:4860::8888",
            "::ffff:93.184.216.34",
        ] {
            let ip: IpAddr = ip.parse().unwrap();
            assert!(globally_routable(ip), "{ip}");
        }
    }
}
