use serde::Serialize;
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
}

impl WebEnvelope {
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
        }
    }
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
}
