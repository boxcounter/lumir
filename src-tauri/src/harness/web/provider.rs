use std::io::Read;
use std::sync::Arc;
use std::time::{Duration, Instant};

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, RETRY_AFTER};
use reqwest::{StatusCode, Url};

use super::budget;
use super::output::{
    WebContentFormat, WebEnvelope, WebErrorCode, WebOperation, WebProviderIdentity, WebSource,
};
use super::preflight::{run_bounded, PreflightError};

const OFFICIAL_ENDPOINT: &str = "https://api.deepseek.com";
const MAX_ATTEMPTS: u32 = 3;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const SEARCH_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(30);
const FETCH_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(45);
const SEARCH_TOTAL_TIMEOUT: Duration = Duration::from_secs(100);
const FETCH_TOTAL_TIMEOUT: Duration = Duration::from_secs(150);
const SEARCH_RESPONSE_LIMIT: usize = 2 * 1024 * 1024;
const FETCH_RESPONSE_LIMIT: usize = 4 * 1024 * 1024;
const CANCEL_POLL: Duration = Duration::from_millis(25);

pub trait WebBackoff: Send + Sync {
    fn wait(&self, duration: Duration, aborted: Arc<dyn Fn() -> bool + Send + Sync>);
}

#[derive(Default)]
pub struct SystemWebBackoff;

impl WebBackoff for SystemWebBackoff {
    fn wait(&self, duration: Duration, aborted: Arc<dyn Fn() -> bool + Send + Sync>) {
        let deadline = Instant::now() + duration;
        while !aborted() {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return;
            }
            std::thread::park_timeout(remaining.min(CANCEL_POLL));
        }
    }
}

#[derive(Debug, Clone)]
pub enum WebProviderRequest {
    Search {
        query: String,
        count: u8,
        need_content: bool,
    },
    Fetch {
        url: String,
    },
}

impl WebProviderRequest {
    pub fn operation(&self) -> WebOperation {
        match self {
            Self::Search { .. } => WebOperation::Search,
            Self::Fetch { .. } => WebOperation::Fetch,
        }
    }
}

pub struct DeepSeekWebProvider {
    provider_id: String,
    api_key: String,
    endpoint: String,
    #[cfg(test)]
    timings: Option<TestTimings>,
    #[cfg(test)]
    resolve: Option<(String, std::net::SocketAddr)>,
}

#[cfg(test)]
#[derive(Clone, Copy)]
struct TestTimings {
    attempt: Duration,
    total: Duration,
}

impl DeepSeekWebProvider {
    pub fn official(provider_id: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            provider_id: provider_id.into(),
            api_key: api_key.into(),
            endpoint: OFFICIAL_ENDPOINT.to_string(),
            #[cfg(test)]
            timings: None,
            #[cfg(test)]
            resolve: None,
        }
    }

    #[cfg(test)]
    pub fn with_endpoint_for_test(endpoint: &str, provider_id: &str, api_key: &str) -> Self {
        Self {
            provider_id: provider_id.to_string(),
            api_key: api_key.to_string(),
            endpoint: endpoint.trim_end_matches('/').to_string(),
            timings: None,
            resolve: None,
        }
    }

    #[cfg(test)]
    pub fn with_timings_for_test(
        endpoint: &str,
        provider_id: &str,
        api_key: &str,
        attempt: Duration,
        total: Duration,
    ) -> Self {
        Self {
            provider_id: provider_id.to_string(),
            api_key: api_key.to_string(),
            endpoint: endpoint.trim_end_matches('/').to_string(),
            timings: Some(TestTimings { attempt, total }),
            resolve: None,
        }
    }

    #[cfg(test)]
    pub fn with_resolved_endpoint_for_test(
        endpoint: &str,
        host: &str,
        addr: std::net::SocketAddr,
        provider_id: &str,
        api_key: &str,
    ) -> Self {
        Self {
            provider_id: provider_id.to_string(),
            api_key: api_key.to_string(),
            endpoint: endpoint.trim_end_matches('/').to_string(),
            timings: None,
            resolve: Some((host.to_string(), addr)),
        }
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    pub fn identity(&self) -> WebProviderIdentity {
        WebProviderIdentity {
            provider: "deepseek".to_string(),
            provider_id: self.provider_id.clone(),
        }
    }

    pub fn execute(
        self: &Arc<Self>,
        request: WebProviderRequest,
        aborted: Arc<dyn Fn() -> bool + Send + Sync>,
        backoff: Arc<dyn WebBackoff>,
    ) -> WebEnvelope {
        let deadline = Instant::now() + self.total_timeout(request.operation());
        self.execute_until(request, aborted, backoff, deadline)
    }

    /// 整次 provider 阶段的上限（含退避）。executor 用它把本地预检与 DeepSeek 阶段
    /// 放进**同一个** deadline；Search 100 秒、Fetch 150 秒。
    pub fn total_timeout(&self, operation: WebOperation) -> Duration {
        #[cfg(test)]
        if let Some(timings) = self.timings {
            return timings.total;
        }
        match operation {
            WebOperation::Search => SEARCH_TOTAL_TIMEOUT,
            WebOperation::Fetch => FETCH_TOTAL_TIMEOUT,
        }
    }

    /// 以调用方给定的总 deadline 执行（executor 的预检与 provider 共享截止时刻）。
    pub fn execute_until(
        self: &Arc<Self>,
        request: WebProviderRequest,
        aborted: Arc<dyn Fn() -> bool + Send + Sync>,
        backoff: Arc<dyn WebBackoff>,
        total_deadline: Instant,
    ) -> WebEnvelope {
        let operation = request.operation();
        let (query, submitted_url) = match &request {
            WebProviderRequest::Search { query, .. } => (Some(query.clone()), None),
            WebProviderRequest::Fetch { url } => (None, Some(url.clone())),
        };
        let mut envelope = self.execute_inner(request, aborted.clone(), backoff, total_deadline);
        if aborted() {
            envelope = self.failure(
                operation,
                WebErrorCode::WebCancelled,
                "DeepSeek 请求已取消",
                envelope.attempts,
            );
        }
        if let Some(query) = query {
            envelope.query = Some(query);
        }
        if let Some(url) = submitted_url {
            if envelope.source.is_none() {
                envelope.source = Some(fetch_source(&url, String::new(), None));
            }
        }
        if !envelope.ok {
            budget::failure_budget(&mut envelope);
        }
        envelope
    }

    fn execute_inner(
        self: &Arc<Self>,
        request: WebProviderRequest,
        aborted: Arc<dyn Fn() -> bool + Send + Sync>,
        backoff: Arc<dyn WebBackoff>,
        total_deadline: Instant,
    ) -> WebEnvelope {
        let operation = request.operation();
        let (attempt_timeout, response_limit) = match operation {
            WebOperation::Search => (SEARCH_ATTEMPT_TIMEOUT, SEARCH_RESPONSE_LIMIT),
            WebOperation::Fetch => (FETCH_ATTEMPT_TIMEOUT, FETCH_RESPONSE_LIMIT),
        };
        #[cfg(test)]
        let attempt_timeout = self
            .timings
            .map(|timings| timings.attempt)
            .unwrap_or(attempt_timeout);
        let mut attempts = 0;
        loop {
            if aborted() {
                return self.failure(
                    operation,
                    WebErrorCode::WebCancelled,
                    "DeepSeek 请求已取消",
                    attempts,
                );
            }
            let remaining = total_deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return self.failure(
                    operation,
                    WebErrorCode::WebTimeout,
                    "DeepSeek 整次调用超时",
                    attempts,
                );
            }
            let timeout = remaining.min(attempt_timeout);
            attempts += 1;
            let worker_request = request.clone();
            let provider = self.clone();
            let worker_abort = aborted.clone();
            let response = run_bounded(timeout, aborted.clone(), move || {
                provider.attempt(worker_request, response_limit, timeout, worker_abort)
            });
            let response = match response {
                Ok(response) => response,
                Err(error) => {
                    let message = deepseek_error_message(&error);
                    return self.failure(operation, error.code, message, attempts);
                }
            };

            if response.status.is_redirection() {
                return self.http_failure(
                    operation,
                    WebErrorCode::WebProviderProtocolError,
                    "DeepSeek tools API 返回 3xx；未跟随重定向",
                    attempts,
                    response,
                );
            }
            if retryable(response.status) && attempts < MAX_ATTEMPTS {
                let delay = response
                    .retry_after
                    .unwrap_or_else(|| {
                        Duration::from_millis(if attempts == 1 { 250 } else { 1_000 })
                    })
                    .min(Duration::from_secs(2));
                let remaining = total_deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return self.failure(
                        operation,
                        WebErrorCode::WebTimeout,
                        "DeepSeek 整次调用超时",
                        attempts,
                    );
                }
                if aborted() {
                    return self.failure(
                        operation,
                        WebErrorCode::WebCancelled,
                        "DeepSeek 请求已取消",
                        attempts,
                    );
                }
                backoff.wait(delay.min(remaining), aborted.clone());
                continue;
            }
            if response.status != StatusCode::OK {
                let message = if retryable(response.status) && attempts >= MAX_ATTEMPTS {
                    format!(
                        "DeepSeek {} 返回 HTTP {}；已尝试 {} 次（初次 + {} 次重试）仍未成功",
                        operation_name(operation),
                        response.status,
                        attempts,
                        attempts - 1
                    )
                } else {
                    format!(
                        "DeepSeek {} 返回 HTTP {}；未自动重试",
                        operation_name(operation),
                        response.status
                    )
                };
                return self.http_failure(
                    operation,
                    WebErrorCode::WebHttpError,
                    message,
                    attempts,
                    response,
                );
            }
            if !json_content_type(response.content_type.as_deref()) {
                return self.failure_with_status(
                    operation,
                    WebErrorCode::WebProviderProtocolError,
                    "DeepSeek 成功响应不是 JSON",
                    attempts,
                    response.status,
                );
            }
            let value = match serde_json::from_slice(&response.body) {
                Ok(value) => value,
                Err(_) => {
                    return self.failure_with_status(
                        operation,
                        WebErrorCode::WebProviderProtocolError,
                        "DeepSeek 成功响应 JSON 非法",
                        attempts,
                        response.status,
                    );
                }
            };
            return match request {
                WebProviderRequest::Search {
                    query,
                    need_content,
                    ..
                } => match parse_search(value, need_content) {
                    Ok(results) => {
                        budget::search_success(Some(self.identity()), attempts, query, results)
                    }
                    Err(message) => self.failure(
                        operation,
                        WebErrorCode::WebProviderProtocolError,
                        message,
                        attempts,
                    ),
                },
                WebProviderRequest::Fetch { url } => match parse_fetch(value) {
                    Ok((title, content)) => budget::fetch_success(
                        Some(self.identity()),
                        attempts,
                        fetch_source(&url, title, Some(content)),
                    ),
                    Err(ParseFetchError::Empty) => self.failure_with_status(
                        operation,
                        WebErrorCode::WebEmptyContent,
                        "DeepSeek Fetch 没有返回 Markdown 正文",
                        attempts,
                        response.status,
                    ),
                    Err(ParseFetchError::Protocol(message)) => self.failure(
                        operation,
                        WebErrorCode::WebProviderProtocolError,
                        message,
                        attempts,
                    ),
                },
            };
        }
    }

    fn attempt(
        &self,
        request: WebProviderRequest,
        response_limit: usize,
        timeout: Duration,
        aborted: Arc<dyn Fn() -> bool + Send + Sync>,
    ) -> Result<ProviderResponse, PreflightError> {
        let operation = request.operation();
        let path = match operation {
            WebOperation::Search => "search",
            WebOperation::Fetch => "fetch",
        };
        let url = format!("{}/v1/tools/{path}", self.endpoint.trim_end_matches('/'));
        let body = match request {
            WebProviderRequest::Search {
                query,
                count,
                need_content,
            } => serde_json::json!({
                "query": query,
                "count": count,
                "need_content": need_content,
            }),
            WebProviderRequest::Fetch { url } => serde_json::json!({"url": url}),
        };
        let builder = reqwest::blocking::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(CONNECT_TIMEOUT.min(timeout))
            .timeout(timeout);
        #[cfg(test)]
        let builder = if let Some((host, addr)) = &self.resolve {
            builder.resolve(host, *addr)
        } else {
            builder
        };
        let client = builder
            .build()
            .map_err(|error| self.network_error(error.to_string()))?;
        let mut response = client
            .post(url)
            .header(AUTHORIZATION, format!("Bearer {}", self.api_key))
            .header(CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .map_err(|error| {
                if aborted() {
                    PreflightError::new(WebErrorCode::WebCancelled, "DeepSeek 请求已取消")
                } else if error.is_timeout() {
                    PreflightError::new(WebErrorCode::WebTimeout, "DeepSeek 请求超时")
                } else {
                    self.network_error(error.to_string())
                }
            })?;
        let status = response.status();
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let retry_after = response
            .headers()
            .get(RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(retry_after_delay);
        let request_id = response
            .headers()
            .get("x-request-id")
            .or_else(|| response.headers().get("request-id"))
            .and_then(|value| value.to_str().ok())
            .map(|value| self.redact(value));
        // Location 不被读取、也不留存（3xx 在重试判定前单独归协议错误）；这里没有脱敏动作，
        // 因为响应头从未进入任何结构。
        let mut body = Vec::new();
        let mut buffer = [0_u8; 16 * 1024];
        while body.len() <= response_limit {
            if aborted() {
                return Err(PreflightError::new(
                    WebErrorCode::WebCancelled,
                    "DeepSeek 请求已取消",
                ));
            }
            let read = response.read(&mut buffer).map_err(|error| {
                if aborted() {
                    PreflightError::new(WebErrorCode::WebCancelled, "DeepSeek 请求已取消")
                } else if error.kind() == std::io::ErrorKind::TimedOut {
                    PreflightError::new(WebErrorCode::WebTimeout, "DeepSeek 响应读取超时")
                } else {
                    self.network_error(error.to_string())
                }
            })?;
            if read == 0 {
                break;
            }
            body.extend_from_slice(&buffer[..read]);
            if body.len() > response_limit {
                return Err(PreflightError::new(
                    WebErrorCode::WebResponseTooLarge,
                    format!("DeepSeek {operation:?} 响应超过本地上限"),
                ));
            }
        }
        Ok(ProviderResponse {
            status,
            content_type,
            retry_after,
            request_id,
            body,
        })
    }

    fn network_error(&self, error: String) -> PreflightError {
        PreflightError::new(
            WebErrorCode::WebNetworkFailed,
            format!("DeepSeek 网络请求失败：{}", self.redact(&error)),
        )
    }

    fn redact(&self, value: &str) -> String {
        value.replace(&self.api_key, "[REDACTED]")
    }

    fn failure(
        &self,
        operation: WebOperation,
        code: WebErrorCode,
        message: impl Into<String>,
        attempts: u32,
    ) -> WebEnvelope {
        WebEnvelope::failure(operation, code, message, Some(self.identity()), attempts)
    }

    fn failure_with_status(
        &self,
        operation: WebOperation,
        code: WebErrorCode,
        message: impl Into<String>,
        attempts: u32,
        status: StatusCode,
    ) -> WebEnvelope {
        let mut envelope = self.failure(operation, code, message, attempts);
        envelope.http_status = Some(status.as_u16());
        envelope
    }

    fn http_failure(
        &self,
        operation: WebOperation,
        code: WebErrorCode,
        message: impl Into<String>,
        attempts: u32,
        response: ProviderResponse,
    ) -> WebEnvelope {
        let mut envelope = self.failure_with_status(
            operation,
            code,
            self.redact(&message.into()),
            attempts,
            response.status,
        );
        envelope.request_id = response.request_id;
        if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&response.body) {
            let error = value.get("error").unwrap_or(&value);
            envelope.provider_code = error
                .get("code")
                .or_else(|| error.get("type"))
                .and_then(serde_json::Value::as_str)
                .map(|value| self.redact(value));
            envelope.provider_message = error
                .get("message")
                .and_then(serde_json::Value::as_str)
                .map(|value| self.redact(value));
        }
        envelope
    }
}

fn retryable(status: StatusCode) -> bool {
    status == StatusCode::REQUEST_TIMEOUT
        || status == StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
}

/// `Retry-After` 的两种合法形态：delta-seconds 与本仓已依赖的 chrono 可解析的
/// RFC 2822 / IMF-fixdate。**精确边界**：只认这一种日期形态；RFC 9110 允许的 obsolete
/// RFC 850（`Sunday, 06-Nov-94 08:49:37 GMT`）与 asctime（`Sun Nov  6 08:49:37 1994`）
/// 不解析，按「缺失」回落到 250ms / 1s 默认退避。过去时刻按 0 处理（立即可重试），
/// 结果仍受 2 秒上限与整次 deadline 双重封顶。
fn retry_after_delay(value: &str) -> Option<Duration> {
    let value = value.trim();
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }
    let at = chrono::DateTime::parse_from_rfc2822(value).ok()?;
    let delta = at.with_timezone(&chrono::Utc) - chrono::Utc::now();
    Some(delta.to_std().unwrap_or(Duration::ZERO))
}

fn json_content_type(value: Option<&str>) -> bool {
    value
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"))
}

fn operation_name(operation: WebOperation) -> &'static str {
    match operation {
        WebOperation::Search => "Search",
        WebOperation::Fetch => "Fetch",
    }
}

fn deepseek_error_message(error: &PreflightError) -> String {
    if error.code == WebErrorCode::WebTimeout {
        return "DeepSeek 请求超时".to_string();
    }
    if error.code == WebErrorCode::WebNetworkFailed && error.message.contains("工作单元") {
        return "DeepSeek 请求异常结束".to_string();
    }
    error.message.clone()
}

struct ProviderResponse {
    status: StatusCode,
    content_type: Option<String>,
    retry_after: Option<Duration>,
    request_id: Option<String>,
    body: Vec<u8>,
}

fn parse_search(value: serde_json::Value, need_content: bool) -> Result<Vec<WebSource>, String> {
    let results = value
        .get("results")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "DeepSeek Search 缺少 results 数组".to_string())?;
    results
        .iter()
        .map(|item| {
            let title = required_string(item, "title")?;
            let url = required_string(item, "url")?;
            let content = need_content
                .then(|| optional_string(item, "content"))
                .flatten()
                .filter(|value| !value.is_empty());
            let authority = match item.get("authority") {
                None | Some(serde_json::Value::Null) => None,
                Some(value) => {
                    let value = value.as_i64().filter(|value| (-1..=4).contains(value));
                    match value {
                        Some(value) => Some(value as i32),
                        None => return Err("DeepSeek Search authority 形状非法".to_string()),
                    }
                }
            };
            Ok(WebSource {
                url,
                title,
                snippet: optional_string(item, "snippet"),
                summary: optional_string(item, "summary"),
                content,
                content_format: None,
                site: optional_string(item, "site_name"),
                date: optional_string(item, "date"),
                authority,
            })
        })
        .collect()
}

fn required_string(item: &serde_json::Value, field: &str) -> Result<String, String> {
    item.get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("DeepSeek 响应字段 {field} 缺失或不是字符串"))
}

fn optional_string(item: &serde_json::Value, field: &str) -> Option<String> {
    item.get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

enum ParseFetchError {
    Empty,
    Protocol(String),
}

fn parse_fetch(value: serde_json::Value) -> Result<(String, String), ParseFetchError> {
    let title = match value.get("title") {
        None | Some(serde_json::Value::Null) => String::new(),
        Some(serde_json::Value::String(title)) => title.clone(),
        Some(_) => {
            return Err(ParseFetchError::Protocol(
                "DeepSeek Fetch title 形状非法".to_string(),
            ))
        }
    };
    let content = required_string(&value, "content").map_err(ParseFetchError::Protocol)?;
    if content.trim().is_empty() {
        return Err(ParseFetchError::Empty);
    }
    Ok((title, content))
}

pub(crate) fn fetch_source(url: &str, title: String, content: Option<String>) -> WebSource {
    let site = Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string));
    WebSource {
        url: url.to_string(),
        title,
        snippet: None,
        summary: None,
        content_format: content.as_ref().map(|_| WebContentFormat::Markdown),
        content,
        site,
        date: None,
        authority: None,
    }
}
