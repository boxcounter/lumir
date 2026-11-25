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

    let mut envelope = WebEnvelope::search_success(identity, attempts, query, results);
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
