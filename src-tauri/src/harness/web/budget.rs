use super::output::{WebEnvelope, WebProviderIdentity, WebSource};

const SEARCH_TITLE_LIMIT: usize = 300;
const SEARCH_SNIPPET_LIMIT: usize = 500;
const SEARCH_SUMMARY_LIMIT: usize = 1_200;
const SEARCH_CONTENT_LIMIT: usize = 4_000;
const AGGREGATE_TEXT_LIMIT: usize = 24_000;
const FETCH_CONTENT_LIMIT: usize = 24_000;
const MESSAGE_LIMIT: usize = 1_000;

pub fn search_success(
    identity: Option<WebProviderIdentity>,
    attempts: u32,
    query: String,
    mut results: Vec<WebSource>,
) -> WebEnvelope {
    let mut truncated_fields = Vec::new();
    for result in &mut results {
        truncate_field(
            &mut result.title,
            SEARCH_TITLE_LIMIT,
            "results[].title",
            &mut truncated_fields,
        );
        truncate_option(
            &mut result.snippet,
            SEARCH_SNIPPET_LIMIT,
            "results[].snippet",
            &mut truncated_fields,
        );
        truncate_option(
            &mut result.summary,
            SEARCH_SUMMARY_LIMIT,
            "results[].summary",
            &mut truncated_fields,
        );
        truncate_option(
            &mut result.content,
            SEARCH_CONTENT_LIMIT,
            "results[].content",
            &mut truncated_fields,
        );
    }

    for (field, path) in [
        (AggregateField::Content, "results[].content"),
        (AggregateField::Summary, "results[].summary"),
        (AggregateField::Snippet, "results[].snippet"),
    ] {
        if aggregate_chars(&results) <= AGGREGATE_TEXT_LIMIT {
            break;
        }
        let mut total = aggregate_chars(&results);
        for result in results.iter_mut().rev() {
            if total <= AGGREGATE_TEXT_LIMIT {
                break;
            }
            let removed = match field {
                AggregateField::Content => result.content.take(),
                AggregateField::Summary => result.summary.take(),
                AggregateField::Snippet => result.snippet.take(),
            };
            if let Some(text) = removed {
                total = total.saturating_sub(text.chars().count());
                mark(&mut truncated_fields, path);
            }
        }
    }
    while aggregate_chars(&results) > AGGREGATE_TEXT_LIMIT && !results.is_empty() {
        results.pop();
        mark(&mut truncated_fields, "results");
    }

    // 结果读数：预算裁剪全部完成后的**单一一次**计算（change
    // compact-web-search-result-summary-nov26）。条数 = 实际回送模型的结果数；字节 = 最终
    // 保留结果的 title / snippet / summary / content 的 UTF-8 字节和（不含 URL / site /
    // date / authority / query 与 JSON 开销）。live 事件与恢复路径消费同一个信封，不重算。
    let result_count = results.len() as u32;
    let result_text_bytes = result_text_bytes_of(&results);

    let mut envelope = WebEnvelope::search_success(identity, attempts, query, results);
    envelope.result_count = Some(result_count);
    envelope.result_text_bytes = Some(result_text_bytes);
    apply_truncation(&mut envelope, truncated_fields);
    envelope
}

pub fn fetch_success(
    identity: Option<WebProviderIdentity>,
    attempts: u32,
    mut source: WebSource,
) -> WebEnvelope {
    let mut truncated_fields = Vec::new();
    if let Some(content) = &mut source.content {
        truncate_field(
            content,
            FETCH_CONTENT_LIMIT,
            "content",
            &mut truncated_fields,
        );
    }
    let mut envelope = WebEnvelope::fetch_success(identity, attempts, source);
    apply_truncation(&mut envelope, truncated_fields);
    envelope
}

pub fn failure_budget(envelope: &mut WebEnvelope) {
    let mut fields = std::mem::take(&mut envelope.truncated_fields);
    if let Some(message) = &mut envelope.message {
        truncate_field(message, MESSAGE_LIMIT, "message", &mut fields);
    }
    if let Some(message) = &mut envelope.provider_message {
        truncate_field(message, MESSAGE_LIMIT, "provider_message", &mut fields);
    }
    // 错误元数据与 message 同口径：provider 可以回显任意长度的 id / code，不能只做脱敏
    // 而不限长（它们会进事件与 JSONL）。
    if let Some(request_id) = &mut envelope.request_id {
        truncate_field(request_id, MESSAGE_LIMIT, "request_id", &mut fields);
    }
    if let Some(provider_code) = &mut envelope.provider_code {
        truncate_field(provider_code, MESSAGE_LIMIT, "provider_code", &mut fields);
    }
    apply_truncation(envelope, fields);
}

pub fn truncate_chars(value: &str, limit: usize) -> (String, bool) {
    if value.chars().count() <= limit {
        return (value.to_string(), false);
    }
    (value.chars().take(limit).collect(), true)
}

fn truncate_field(value: &mut String, limit: usize, path: &str, fields: &mut Vec<String>) {
    let (bounded, truncated) = truncate_chars(value, limit);
    if truncated {
        *value = bounded;
        mark(fields, path);
    }
}

fn truncate_option(value: &mut Option<String>, limit: usize, path: &str, fields: &mut Vec<String>) {
    if let Some(text) = value {
        truncate_field(text, limit, path, fields);
    }
}

fn aggregate_chars(results: &[WebSource]) -> usize {
    results
        .iter()
        .map(|result| {
            result.title.chars().count()
                + result
                    .snippet
                    .as_ref()
                    .map_or(0, |text| text.chars().count())
                + result
                    .summary
                    .as_ref()
                    .map_or(0, |text| text.chars().count())
                + result
                    .content
                    .as_ref()
                    .map_or(0, |text| text.chars().count())
        })
        .sum()
}

/// 结果文本的 UTF-8 字节和（只含 title / snippet / summary / content；中文按 UTF-8 计）。
fn result_text_bytes_of(results: &[WebSource]) -> u64 {
    results
        .iter()
        .map(|result| {
            result.title.len() as u64
                + result.snippet.as_ref().map_or(0, |text| text.len() as u64)
                + result.summary.as_ref().map_or(0, |text| text.len() as u64)
                + result.content.as_ref().map_or(0, |text| text.len() as u64)
        })
        .sum()
}

fn apply_truncation(envelope: &mut WebEnvelope, fields: Vec<String>) {
    envelope.truncated = !fields.is_empty();
    envelope.truncated_fields = fields;
}

fn mark(fields: &mut Vec<String>, path: &str) {
    if !fields.iter().any(|field| field == path) {
        fields.push(path.to_string());
    }
}

#[derive(Clone, Copy)]
enum AggregateField {
    Content,
    Summary,
    Snippet,
}

#[cfg(test)]
mod tests {
    use super::super::output::{WebEnvelope, WebErrorCode, WebOperation, WebSource};
    use super::*;

    fn source(
        title: &str,
        snippet: Option<&str>,
        summary: Option<&str>,
        content: Option<&str>,
    ) -> WebSource {
        WebSource {
            url: "https://example.com/synthetic".to_string(),
            title: title.to_string(),
            snippet: snippet.map(str::to_string),
            summary: summary.map(str::to_string),
            content: content.map(str::to_string),
            content_format: None,
            site: Some("example.com".to_string()),
            date: None,
            authority: None,
        }
    }

    fn counted(envelope: &WebEnvelope) -> serde_json::Value {
        let value = serde_json::to_value(envelope).unwrap();
        serde_json::json!({
            "count": value.get("result_count").cloned().unwrap_or(serde_json::Value::Null),
            "bytes": value.get("result_text_bytes").cloned().unwrap_or(serde_json::Value::Null),
        })
    }

    /// 读数是「预算裁剪后实际回送模型」的那一份：条数 = results.len()，字节 = 四个文本字段的
    /// UTF-8 字节和（中文 3 字节/字）。URL / site 不计。
    #[test]
    fn result_metrics_count_results_and_sum_utf8_text_bytes() {
        let envelope = search_success(
            None,
            1,
            "synthetic query".to_string(),
            vec![
                source("甲", Some("乙乙"), None, Some("abc")),
                source("", None, Some("中"), None),
            ],
        );
        assert_eq!(
            counted(&envelope),
            serde_json::json!({"count": 2, "bytes": 15}),
            "甲=3 + 乙乙=6 + abc=3 + 中=3 = 15；URL / site 不计"
        );
    }

    #[test]
    fn result_metrics_reflect_field_truncation() {
        let long = "中".repeat(SEARCH_TITLE_LIMIT + 1);
        let envelope = search_success(
            None,
            1,
            "q".to_string(),
            vec![source(&long, None, None, None)],
        );
        assert!(envelope
            .truncated_fields
            .iter()
            .any(|field| field == "results[].title"));
        assert_eq!(
            counted(&envelope),
            serde_json::json!({"count": 1, "bytes": SEARCH_TITLE_LIMIT * 3}),
            "按裁剪后的 300 字 × 3 字节计算"
        );
    }

    #[test]
    fn result_metrics_reflect_whole_result_removal() {
        let results = (0..120)
            .map(|_| source(&"t".repeat(SEARCH_TITLE_LIMIT), None, None, None))
            .collect();
        let envelope = search_success(None, 1, "q".to_string(), results);
        assert_eq!(envelope.truncated_fields, vec!["results".to_string()]);
        assert_eq!(
            counted(&envelope),
            serde_json::json!({"count": 80, "bytes": 24_000}),
            "整条移除后的实际回送条数与字节"
        );
    }

    #[test]
    fn truly_empty_search_is_zero_not_null() {
        let envelope = search_success(None, 1, "q".to_string(), Vec::new());
        assert_eq!(
            counted(&envelope),
            serde_json::json!({"count": 0, "bytes": 0})
        );
        assert!(!envelope.truncated);
    }

    #[test]
    fn failures_and_unbudgeted_envelopes_leave_metrics_null() {
        let mut failure = WebEnvelope::failure(
            WebOperation::Search,
            WebErrorCode::WebProviderUnconfigured,
            "synthetic failure",
            None,
            0,
        );
        failure_budget(&mut failure);
        assert_eq!(
            counted(&failure),
            serde_json::json!({"count": null, "bytes": null})
        );
        let value = serde_json::to_value(&failure).unwrap();
        assert!(value.get("result_count").is_some(), "键必须在场，值为 null");
        assert!(value.get("result_text_bytes").is_some());

        let direct = WebEnvelope::search_success(None, 1, "q".to_string(), Vec::new());
        assert_eq!(
            counted(&direct),
            serde_json::json!({"count": null, "bytes": null}),
            "只有预算路径产出读数"
        );
    }
}
