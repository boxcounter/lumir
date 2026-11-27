use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum WebContentFormat {
    Markdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum WebTrust {
    Untrusted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum WebFetchMode {
    Full,
    SelectedChunks,
}

impl WebFetchMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Full => "full",
            Self::SelectedChunks => "selected_chunks",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum WebContentScope {
    Full,
    SelectedChunks,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum WebCoverage {
    Unknown,
    Bounded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum WebFetchedBy {
    Provider,
    Local,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum WebBinding {
    UrlSubmitted,
    AddressPinned,
}

/// 一次 Fetch 的证据形态与抓取归属（change web-evidence-provenance-nov26）。
///
/// 只有 `provider_full()`（生产成功）、`provider_attempted()`（`attempts>0` 的失败，含取消覆盖）
/// 与验收装配的 `scripted(...)` 能构造它；`local` / `address_pinned` / 非空 `final_url` 在阶段 1
/// 没有构造入口。五字段的写入只经 `WebEnvelope::apply_provenance`。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchProvenance {
    content_scope: Option<WebContentScope>,
    coverage: Option<WebCoverage>,
    fetched_by: Option<WebFetchedBy>,
    binding: Option<WebBinding>,
    final_url: Option<String>,
}

impl FetchProvenance {
    pub fn provider_full() -> Self {
        Self {
            content_scope: Some(WebContentScope::Full),
            coverage: Some(WebCoverage::Unknown),
            fetched_by: Some(WebFetchedBy::Provider),
            binding: Some(WebBinding::UrlSubmitted),
            final_url: None,
        }
    }

    pub fn provider_attempted() -> Self {
        Self {
            content_scope: None,
            coverage: None,
            fetched_by: Some(WebFetchedBy::Provider),
            binding: Some(WebBinding::UrlSubmitted),
            final_url: None,
        }
    }

    #[cfg(any(test, feature = "acceptance-web"))]
    pub fn scripted(scope: WebContentScope, coverage: WebCoverage) -> Self {
        Self {
            content_scope: Some(scope),
            coverage: Some(coverage),
            fetched_by: Some(WebFetchedBy::Provider),
            binding: Some(WebBinding::UrlSubmitted),
            final_url: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct WebSource {
    pub url: String,
    pub title: String,
    pub snippet: Option<String>,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub content_format: Option<WebContentFormat>,
    pub site: Option<String>,
    pub date: Option<String>,
    pub authority: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum WebOperation {
    Search,
    Fetch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum WebErrorCode {
    PermissionDenied,
    WebArgsInvalid,
    WebAccessConfigInvalid,
    WebProviderUnconfigured,
    WebModeUnsupported,
    WebUrlBlocked,
    WebDnsFailed,
    WebDnsBlocked,
    WebRedirectLimit,
    WebUnsupportedContent,
    WebContentTypeUnknown,
    WebNetworkFailed,
    WebTimeout,
    WebCancelled,
    WebResponseTooLarge,
    WebProviderProtocolError,
    WebHttpError,
    WebEmptyContent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct WebProviderIdentity {
    pub provider: String,
    pub provider_id: String,
}

/// Web 工具调用的完整输入（change compact-web-search-result-summary-nov26，评审 P1-1）：
/// 面板工具记录随记录持久化，供快照 / 会话恢复的默认行与「查看详情」使用。
///
/// 与 live `started` 事件的参数摘要**同一语义源**（同一份 arguments），但不截断——恢复
/// 失败记录不能只靠 `summary`（失败摘要是 `状态 · code: message`，不是参数）。非 Web 工具 /
/// 旧记录缺省；恢复端按缺省安全降级，MUST NOT 伪造 query / URL。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct PanelWebInput {
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Fetch 请求的 `mode`（change web-evidence-provenance-nov26）：快照 / JSONL 恢复时
    /// 「查看详情」的 `模式` 行与 Ask 后的同形展示从这份持久化输入取，旧记录缺键即 None。
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<WebFetchMode>,
}

impl PanelWebInput {
    /// 从工具名 + arguments JSON 取完整输入；非 Web / 非法 JSON / 空值 → None。
    pub fn from_arguments(name: &str, arguments: &str) -> Option<Self> {
        let operation = super::operation(name)?;
        let parsed: serde_json::Value = serde_json::from_str(arguments).ok()?;
        match operation {
            WebOperation::Search => parsed
                .get("query")
                .and_then(serde_json::Value::as_str)
                .filter(|query| !query.is_empty())
                .map(|query| Self {
                    query: Some(query.to_string()),
                    url: None,
                    mode: None,
                }),
            WebOperation::Fetch => parsed
                .get("url")
                .and_then(serde_json::Value::as_str)
                .filter(|url| !url.is_empty())
                .map(|url| Self {
                    // 选取 query 与 URL 同一份 arguments、同一项持久化：快照 / JSONL 恢复
                    // 只凭它显示「查看详情」的 mode / 选取查询。
                    query: parsed
                        .get("query")
                        .and_then(serde_json::Value::as_str)
                        .filter(|query| !query.is_empty())
                        .map(str::to_string),
                    url: Some(url.to_string()),
                    mode: parsed.get("mode").and_then(parse_fetch_mode),
                }),
        }
    }
}

fn parse_fetch_mode(value: &serde_json::Value) -> Option<WebFetchMode> {
    match value.as_str()? {
        "full" => Some(WebFetchMode::Full),
        "selected_chunks" => Some(WebFetchMode::SelectedChunks),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct WebApprovalPayload {
    pub operation: WebOperation,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub origin: Option<String>,
    /// 仅 Fetch：请求的抓取模式；Search 为 None。
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub mode: Option<WebFetchMode>,
    pub provider: Option<String>,
    pub provider_id: Option<String>,
    pub provider_status: super::config::WebProviderStatus,
    pub trust: WebTrust,
    pub local_precheck: bool,
    pub provider_fetch: bool,
    pub cost_per_1000_success_cny: u16,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct WebEnvelope {
    pub ok: bool,
    pub provider: Option<String>,
    pub provider_id: Option<String>,
    pub operation: WebOperation,
    pub attempts: u32,
    // 本地预检是否**实际执行**（不是「按 operation 应当执行」）。Fetch 在 executor 内被调用
    // 即置 true，包括预检失败 / 取消；未配置、参数非法、权限拒绝等未进入 executor 的路径为 false。
    pub local_precheck: bool,
    pub trust: WebTrust,
    pub truncated: bool,
    pub truncated_fields: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<WebErrorCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub results: Option<Vec<WebSource>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<WebSource>,
    // 结果读数（change compact-web-search-result-summary-nov26）：只在成功 Search 的
    // 预算裁剪完成后由 `budget::search_success` **单一一次**计算。非 Search 成功、失败、
    // 未经过预算路径的信封一律 null——MUST NOT 用 0 冒充空结果（0 是合法读数：真正成功的
    // 空结果）。键恒在场（serde 序列化为 null），旧留存缺键由前端按 null 降级。
    pub result_count: Option<u32>,
    // JSON 是 number（字节数远低于 2^53）；ts-rs 的 u64 默认导出 bigint 与本载荷不符。
    #[ts(type = "number | null")]
    pub result_text_bytes: Option<u64>,
    // 抓取证据形态与归属（change web-evidence-provenance-nov26）：键恒在场、无信息为 null。
    // 取值与置空规则见 living spec「Web 抓取证据形态与归属」条；Search 侧五者恒 null。
    pub content_scope: Option<WebContentScope>,
    pub coverage: Option<WebCoverage>,
    pub fetched_by: Option<WebFetchedBy>,
    pub binding: Option<WebBinding>,
    pub final_url: Option<String>,
}

impl WebEnvelope {
    /// 五个抓取读数是否已由适配器产出（成功路径的 `scripted` 靠它不被收口覆盖）。
    pub fn has_provenance(&self) -> bool {
        self.content_scope.is_some()
            || self.coverage.is_some()
            || self.fetched_by.is_some()
            || self.binding.is_some()
            || self.final_url.is_some()
    }

    /// 五字段的**唯一**写入点：由 `provider::execute_until` 的收口调用。
    pub fn apply_provenance(&mut self, provenance: FetchProvenance) {
        self.content_scope = provenance.content_scope;
        self.coverage = provenance.coverage;
        self.fetched_by = provenance.fetched_by;
        self.binding = provenance.binding;
        self.final_url = provenance.final_url;
    }

    pub fn search_success(
        identity: Option<WebProviderIdentity>,
        attempts: u32,
        query: String,
        results: Vec<WebSource>,
    ) -> Self {
        let mut envelope = Self::base(true, WebOperation::Search, identity, attempts);
        envelope.query = Some(query);
        envelope.results = Some(results);
        envelope
    }

    pub fn fetch_success(
        identity: Option<WebProviderIdentity>,
        attempts: u32,
        source: WebSource,
    ) -> Self {
        let mut envelope = Self::base(true, WebOperation::Fetch, identity, attempts);
        envelope.source = Some(source);
        envelope
    }

    pub fn failure(
        operation: WebOperation,
        code: WebErrorCode,
        message: impl Into<String>,
        identity: Option<WebProviderIdentity>,
        attempts: u32,
    ) -> Self {
        let mut envelope = Self::base(false, operation, identity, attempts);
        envelope.code = Some(code);
        envelope.message = Some(message.into());
        envelope
    }

    fn base(
        ok: bool,
        operation: WebOperation,
        identity: Option<WebProviderIdentity>,
        attempts: u32,
    ) -> Self {
        let (provider, provider_id) = identity
            .map(|identity| (Some(identity.provider), Some(identity.provider_id)))
            .unwrap_or((None, None));
        Self {
            ok,
            provider,
            provider_id,
            operation,
            attempts,
            local_precheck: false,
            trust: WebTrust::Untrusted,
            truncated: false,
            truncated_fields: Vec::new(),
            code: None,
            message: None,
            http_status: None,
            provider_code: None,
            provider_message: None,
            request_id: None,
            query: None,
            results: None,
            source: None,
            result_count: None,
            result_text_bytes: None,
            content_scope: None,
            coverage: None,
            fetched_by: None,
            binding: None,
            final_url: None,
        }
    }
}

pub fn audit_metadata(
    operation: WebOperation,
    output: &serde_json::Value,
    input: &serde_json::Value,
) -> serde_json::Value {
    let query = output
        .get("query")
        .filter(|value| !value.is_null())
        .or_else(|| input.get("query"))
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let url = output
        .get("source")
        .and_then(|source| source.get("url"))
        .filter(|value| !value.is_null())
        .or_else(|| input.get("url"))
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    // 原始调用输入与「实际提交 / 最终 URL」分开：`url` 仍是 source.url（Fetch 重定向后
    // 是最终 B），`input_url` 只取调用 arguments 的原始 A。默认行用 A，详情用 B
    //（评审 P1-2）；两者都由后端一次投影，前端不得自行猜。
    let input_url = input
        .get("url")
        .filter(|value| !value.is_null())
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let attempts = output
        .get("attempts")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    // 审计只写**实际发生**的事实：预检事实由 executor 写进信封；provider 是否被访问过
    // 由 attempts 决定（0 次 = 没有任何 DeepSeek tools 请求）。MUST NOT 按 operation 猜。
    let local_precheck = output
        .get("local_precheck")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    // 请求模式是**调用事实**，只从 arguments 投影；结果五字段只从信封透传（MUST NOT 互推）。
    let mode = input
        .get("mode")
        .and_then(parse_fetch_mode)
        .map(|mode| serde_json::json!(mode));
    serde_json::json!({
        "operation": operation,
        "query": query,
        "url": url,
        "input_url": input_url,
        "provider": output.get("provider").cloned().unwrap_or(serde_json::Value::Null),
        "provider_id": output.get("provider_id").cloned().unwrap_or(serde_json::Value::Null),
        "attempts": attempts,
        "cost_per_1000_success_cny": 5,
        "local_precheck": local_precheck,
        "provider_fetch": attempts > 0,
        "trust": "untrusted",
        "truncated": output.get("truncated").and_then(serde_json::Value::as_bool).unwrap_or(false),
        "truncated_fields": output.get("truncated_fields").cloned().unwrap_or_else(|| serde_json::json!([])),
        "code": output.get("code").cloned().unwrap_or(serde_json::Value::Null),
        // 结果读数只透传信封（预算路径的单一计算点），审计不重算。
        "result_count": output.get("result_count").cloned().unwrap_or(serde_json::Value::Null),
        "result_text_bytes": output.get("result_text_bytes").cloned().unwrap_or(serde_json::Value::Null),
        "mode": mode.unwrap_or(serde_json::Value::Null),
        // 五个抓取读数同样只透传信封：审计 MUST NOT 由 local_precheck / attempts 推导。
        "content_scope": output.get("content_scope").cloned().unwrap_or(serde_json::Value::Null),
        "coverage": output.get("coverage").cloned().unwrap_or(serde_json::Value::Null),
        "fetched_by": output.get("fetched_by").cloned().unwrap_or(serde_json::Value::Null),
        "binding": output.get("binding").cloned().unwrap_or(serde_json::Value::Null),
        "final_url": output.get("final_url").cloned().unwrap_or(serde_json::Value::Null),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> WebProviderIdentity {
        WebProviderIdentity {
            provider: "deepseek".to_string(),
            provider_id: "deepseek-work".to_string(),
        }
    }

    fn source() -> WebSource {
        WebSource {
            url: "https://example.com/a".to_string(),
            title: "".to_string(),
            snippet: None,
            summary: None,
            content: Some("# Markdown".to_string()),
            content_format: Some(WebContentFormat::Markdown),
            site: Some("example.com".to_string()),
            date: None,
            authority: None,
        }
    }

    #[test]
    fn web_source_shape_has_empty_title_nullable_fields_and_no_site_icon() {
        let value = serde_json::to_value(source()).unwrap();
        assert_eq!(value["title"], serde_json::json!(""));
        assert_eq!(value["snippet"], serde_json::Value::Null);
        assert_eq!(value["date"], serde_json::Value::Null);
        assert_eq!(value["authority"], serde_json::Value::Null);
        assert!(value.get("site_icon").is_none());
        assert_eq!(value.as_object().unwrap().len(), 9);
    }

    #[test]
    fn web_search_empty_results_are_success_with_complete_envelope() {
        let envelope = WebEnvelope::search_success(
            Some(identity()),
            1,
            "synthetic query".to_string(),
            Vec::new(),
        );
        let value = serde_json::to_value(envelope).unwrap();
        assert_eq!(value["ok"], serde_json::json!(true));
        assert_eq!(value["provider"], serde_json::json!("deepseek"));
        assert_eq!(value["provider_id"], serde_json::json!("deepseek-work"));
        assert_eq!(value["operation"], serde_json::json!("search"));
        assert_eq!(value["attempts"], serde_json::json!(1));
        assert_eq!(value["trust"], serde_json::json!("untrusted"));
        assert_eq!(value["truncated"], serde_json::json!(false));
        assert_eq!(value["truncated_fields"], serde_json::json!([]));
        assert_eq!(value["query"], serde_json::json!("synthetic query"));
        assert_eq!(value["results"], serde_json::json!([]));
        assert!(value.get("code").is_none());
    }

    #[test]
    fn web_fetch_uses_the_same_source_shape() {
        let envelope = WebEnvelope::fetch_success(Some(identity()), 1, source());
        let value = serde_json::to_value(envelope).unwrap();
        assert_eq!(value["operation"], serde_json::json!("fetch"));
        assert_eq!(value["source"]["title"], serde_json::json!(""));
        assert_eq!(
            value["source"]["content_format"],
            serde_json::json!("markdown")
        );
        assert_eq!(value["source"]["date"], serde_json::Value::Null);
        assert_eq!(value["source"]["authority"], serde_json::Value::Null);
        assert!(value.get("results").is_none());
    }

    #[test]
    fn web_pre_resolution_failures_have_null_provider_and_zero_attempts() {
        for code in [
            WebErrorCode::WebProviderUnconfigured,
            WebErrorCode::WebArgsInvalid,
            WebErrorCode::WebAccessConfigInvalid,
        ] {
            let envelope =
                WebEnvelope::failure(WebOperation::Search, code, "synthetic failure", None, 0);
            let value = serde_json::to_value(envelope).unwrap();
            assert_eq!(value["ok"], serde_json::json!(false));
            assert_eq!(value["provider"], serde_json::Value::Null);
            assert_eq!(value["provider_id"], serde_json::Value::Null);
            assert_eq!(value["attempts"], serde_json::json!(0));
            assert_eq!(value["trust"], serde_json::json!("untrusted"));
            assert_eq!(value["truncated"], serde_json::json!(false));
            assert_eq!(value["truncated_fields"], serde_json::json!([]));
            assert!(value.get("http_status").is_none());
            assert!(value.get("provider_message").is_none());
            assert!(value.get("request_id").is_none());
        }
    }

    #[test]
    fn web_failure_can_carry_real_http_metadata_without_raw_body() {
        let mut envelope = WebEnvelope::failure(
            WebOperation::Fetch,
            WebErrorCode::WebHttpError,
            "synthetic HTTP failure",
            Some(identity()),
            1,
        );
        envelope.http_status = Some(404);
        envelope.provider_code = Some("not_found_error".to_string());
        envelope.provider_message = Some("sanitized".to_string());
        envelope.request_id = Some("req_synthetic".to_string());
        let value = serde_json::to_value(envelope).unwrap();
        assert_eq!(value["code"], serde_json::json!("web_http_error"));
        assert_eq!(value["http_status"], serde_json::json!(404));
        assert_eq!(value["provider_code"], serde_json::json!("not_found_error"));
        assert_eq!(value["provider_message"], serde_json::json!("sanitized"));
        assert_eq!(value["request_id"], serde_json::json!("req_synthetic"));
    }

    #[test]
    fn audit_metadata_records_actual_preflight_and_provider_reach_instead_of_operation() {
        let cases = [
            // (operation, local_precheck, attempts, expected local, expected provider_fetch)
            (WebOperation::Fetch, false, 0, false, false),
            (WebOperation::Fetch, true, 0, true, false),
            (WebOperation::Fetch, true, 2, true, true),
            (WebOperation::Search, false, 1, false, true),
        ];
        for (operation, local_precheck, attempts, expected_local, expected_provider) in cases {
            let value = serde_json::json!({
                "operation": operation,
                "provider": "deepseek",
                "provider_id": "deepseek-work",
                "attempts": attempts,
                "local_precheck": local_precheck,
                "truncated": false,
                "truncated_fields": [],
            });
            let audit = audit_metadata(operation, &value, &serde_json::json!({}));
            assert_eq!(
                audit["local_precheck"],
                serde_json::json!(expected_local),
                "{operation:?} local_precheck={local_precheck} attempts={attempts}"
            );
            assert_eq!(
                audit["provider_fetch"],
                serde_json::json!(expected_provider),
                "{operation:?} attempts={attempts}"
            );
        }
    }

    #[test]
    fn audit_metadata_separates_original_input_url_from_final_source_url() {
        let output = serde_json::json!({
            "operation": "fetch",
            "provider": "deepseek",
            "provider_id": "deepseek-work",
            "attempts": 1,
            "truncated": false,
            "truncated_fields": [],
            "source": {"url": "https://final.example/b", "title": ""},
        });
        let input = serde_json::json!({"url": "https://origin.example/a"});
        let audit = audit_metadata(WebOperation::Fetch, &output, &input);
        assert_eq!(audit["url"], "https://final.example/b");
        assert_eq!(audit["input_url"], "https://origin.example/a");
    }

    #[test]
    fn panel_web_input_reads_full_query_or_url_from_arguments() {
        assert_eq!(
            PanelWebInput::from_arguments(
                "web_search",
                r#"{"query":"synthetic query","count":5,"need_content":false}"#
            ),
            Some(PanelWebInput {
                query: Some("synthetic query".to_string()),
                url: None,
                mode: None,
            })
        );
        assert_eq!(
            PanelWebInput::from_arguments("web_fetch", r#"{"url":"https://example.com/a"}"#),
            Some(PanelWebInput {
                query: None,
                url: Some("https://example.com/a".to_string()),
                mode: None,
            })
        );
        assert_eq!(
            PanelWebInput::from_arguments("web_search", r#"{"query":"","count":5}"#),
            None
        );
        assert_eq!(
            PanelWebInput::from_arguments("cli_run", r#"{"command":"ls"}"#),
            None
        );
        assert_eq!(
            PanelWebInput::from_arguments("web_search", "{bad-json"),
            None
        );
        let value = serde_json::to_value(PanelWebInput {
            query: Some("synthetic query".to_string()),
            url: None,
            mode: None,
        })
        .unwrap();
        assert_eq!(value, serde_json::json!({"query": "synthetic query"}));
    }

    #[test]
    fn audit_metadata_carries_result_metrics_and_failures_stay_null() {
        let success = serde_json::json!({
            "operation": "search",
            "query": "synthetic",
            "provider": "deepseek",
            "provider_id": "deepseek-work",
            "attempts": 1,
            "local_precheck": false,
            "truncated": true,
            "truncated_fields": ["results"],
            "result_count": 2,
            "result_text_bytes": 15,
        });
        let audit = audit_metadata(WebOperation::Search, &success, &serde_json::json!({}));
        assert_eq!(
            audit["result_count"],
            serde_json::json!(2),
            "审计只透传，不重算"
        );
        assert_eq!(audit["result_text_bytes"], serde_json::json!(15));

        let failure = serde_json::json!({
            "operation": "search",
            "attempts": 0,
            "truncated": false,
            "truncated_fields": [],
            "code": "web_provider_unconfigured",
        });
        let audit = audit_metadata(WebOperation::Search, &failure, &serde_json::json!({}));
        assert_eq!(audit["result_count"], serde_json::Value::Null);
        assert_eq!(audit["result_text_bytes"], serde_json::Value::Null);
        assert!(audit.get("result_count").is_some(), "键必须在场，值为 null");
    }

    #[test]
    fn fetch_provenance_keys_are_always_present_and_search_stays_null() {
        let mut fetch = WebEnvelope::fetch_success(Some(identity()), 1, source());
        fetch.apply_provenance(FetchProvenance::provider_full());
        let value = serde_json::to_value(&fetch).unwrap();
        for field in [
            "content_scope",
            "coverage",
            "fetched_by",
            "binding",
            "final_url",
        ] {
            assert!(value.get(field).is_some(), "{field} 键必须恒在场");
        }
        assert_eq!(value["content_scope"], serde_json::json!("full"));
        assert_eq!(value["coverage"], serde_json::json!("unknown"));
        assert_eq!(value["fetched_by"], serde_json::json!("provider"));
        assert_eq!(value["binding"], serde_json::json!("url_submitted"));
        assert_eq!(value["final_url"], serde_json::Value::Null);

        let search = serde_json::to_value(WebEnvelope::search_success(
            Some(identity()),
            1,
            "synthetic".to_string(),
            Vec::new(),
        ))
        .unwrap();
        for field in [
            "content_scope",
            "coverage",
            "fetched_by",
            "binding",
            "final_url",
        ] {
            assert_eq!(
                search[field],
                serde_json::Value::Null,
                "Search 的 {field} 必须为 null"
            );
        }

        let failure = serde_json::to_value(WebEnvelope::failure(
            WebOperation::Fetch,
            WebErrorCode::WebModeUnsupported,
            "synthetic",
            Some(identity()),
            0,
        ))
        .unwrap();
        assert_eq!(failure["code"], serde_json::json!("web_mode_unsupported"));
        for field in [
            "content_scope",
            "coverage",
            "fetched_by",
            "binding",
            "final_url",
        ] {
            assert_eq!(failure[field], serde_json::Value::Null, "{field}");
        }
    }

    #[test]
    fn audit_metadata_passes_provenance_and_mode_through_without_deriving() {
        let output = serde_json::json!({
            "operation": "fetch",
            "provider": "deepseek",
            "provider_id": "deepseek-work",
            "attempts": 1,
            "local_precheck": true,
            "truncated": false,
            "truncated_fields": [],
            "content_scope": "selected_chunks",
            "coverage": "bounded",
            "fetched_by": "provider",
            "binding": "url_submitted",
            "final_url": null,
        });
        let input = serde_json::json!({
            "url": "https://example.com/a",
            "mode": "selected_chunks",
            "query": "synthetic selection",
        });
        let audit = audit_metadata(WebOperation::Fetch, &output, &input);
        assert_eq!(audit["mode"], serde_json::json!("selected_chunks"));
        assert_eq!(audit["content_scope"], serde_json::json!("selected_chunks"));
        assert_eq!(audit["coverage"], serde_json::json!("bounded"));
        assert_eq!(audit["binding"], serde_json::json!("url_submitted"));
        assert_eq!(audit["fetched_by"], serde_json::json!("provider"));
        assert_eq!(audit["final_url"], serde_json::Value::Null);

        // 缺失时只归 null，MUST NOT 由 local_precheck / attempts 反推。
        let bare = serde_json::json!({
            "operation": "fetch",
            "attempts": 2,
            "local_precheck": true,
            "truncated": false,
            "truncated_fields": [],
        });
        let audit = audit_metadata(WebOperation::Fetch, &bare, &serde_json::json!({}));
        assert_eq!(audit["mode"], serde_json::Value::Null);
        for field in [
            "content_scope",
            "coverage",
            "fetched_by",
            "binding",
            "final_url",
        ] {
            assert_eq!(audit[field], serde_json::Value::Null, "{field} 不得推导");
        }
    }

    #[test]
    fn panel_web_input_captures_mode_and_selection_query() {
        let input = PanelWebInput::from_arguments(
            "web_fetch",
            r#"{"url":"https://example.com/a","mode":"selected_chunks","query":"synthetic"}"#,
        )
        .unwrap();
        assert_eq!(input.url.as_deref(), Some("https://example.com/a"));
        assert_eq!(input.mode, Some(WebFetchMode::SelectedChunks));
        assert_eq!(input.query.as_deref(), Some("synthetic"));
        let value = serde_json::to_value(&input).unwrap();
        assert_eq!(value["mode"], serde_json::json!("selected_chunks"));
        assert_eq!(value["query"], serde_json::json!("synthetic"));

        // 缺省 mode 的旧调用：query 不伪造、mode 为 None（序列化省略）。
        let legacy =
            PanelWebInput::from_arguments("web_fetch", r#"{"url":"https://example.com/a"}"#)
                .unwrap();
        assert_eq!(legacy.mode, None);
        assert_eq!(legacy.query, None);
        let value = serde_json::to_value(&legacy).unwrap();
        assert!(value.get("mode").is_none());

        // 未知 mode 归 None，不猜映射。
        let unknown = PanelWebInput::from_arguments(
            "web_fetch",
            r#"{"url":"https://example.com/a","mode":"document"}"#,
        )
        .unwrap();
        assert_eq!(unknown.mode, None);
    }
}
