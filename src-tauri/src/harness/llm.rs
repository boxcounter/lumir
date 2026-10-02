//! LLM client（design §3、§9、§13）：OpenAI Responses API + function tools，kimi / deepseek /
//! mock 三 provider，会话状态全部客户端化（显式 `store: false`，不用
//! `previous_response_id` / `conversation`——deepseek 无状态实现，kimi 侧主动不留副本）。
//!
//! # 请求形状（对着两家官方兼容表核对，2026-10-02）
//!
//! 发送体只有：`model` / `instructions` / `input` / `tools` / `tool_choice:"auto"` /
//! `stream:true`，外加 **kimi 专属**的 `store:false`。刻意不发的参数及理由：
//! - `store`：deepseek 不支持（其恒为 false；[兼容表](https://api-docs.deepseek.com/guides/responses_api/)）
//!   ——kimi 侧显式发是「vault 内容不在 provider 侧留副本」的主动声明。
//! - `temperature` / `max_output_tokens` / `reasoning` / `text` 等：探针期用厂商默认，
//!   少一个旋钮少一处方言（deepseek 对不支持参数**静默忽略**，发了也测不出错）。
//! - `previous_response_id` / `conversation`：两家都不支持（deepseek 明说）或我们不依赖（kimi）。
//!
//! # mock provider 与 fixture 格式（验收专用，真机验收不依赖真实外部 API）
//!
//! `provider = "mock"` 时从配置的 fixture 路径读脚本化响应，**每次 LLM 调用按顺序弹一条**：
//!
//! ```jsonc
//! {
//!   "version": 1,
//!   "responses": [
//!     {
//!       "text": "我先读一下文件。",                // 助手脚本文本
//!       "chunks": ["我先", "读一下文件。"],       // 可选：显式分块（流式 text_chunk 按它发）
//!       "tool_calls": [                          // 可选：本轮的函数调用（按序执行）
//!         {"id": "call_1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}
//!       ],
//!       "reasoning": {"type":"reasoning","id":"rs_1","encrypted_content":"…"},  // 可选：回放项
//!       "usage": {"input_tokens": 1200, "cached_tokens": 300, "output_tokens": 40}  // 可选
//!     },
//!     {"text": "读完了。", "usage": {"input_tokens": 1500, "cached_tokens": 900, "output_tokens": 10}},
//!     {"error": {"code": "context_length_exceeded", "message": "…"}}            // 可选：脚本化错误
//!   ]
//! }
//! ```
//!
//! 弹尽后再调用 ⇒ `fixture_exhausted` 错误（测试脚本漏写的即露馅）。`text` 未给 `chunks`
//! 时整体作为一个 chunk。`usage` 缺失则不更新用量（面板保持上一轮读数）。
//!
//! # reasoning 回传纪律（design §3）
//!
//! 流式里的 `reasoning` 项原样留作回放项（kimi 的 `encrypted_content` 因此保真）；
//! deepseek 产出时 reasoning 文本已合并进 assistant 消息（其兼容表口径），天然无项可带。

use std::io::BufRead;

use crate::commands::CommandError;
use crate::config::{HarnessConfig, HarnessProvider};

use super::session::UsageSnapshot;

/// 一次工具调用的解析结果（Responses API function_call 项）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolCall {
    pub call_id: String,
    pub name: String,
    /// JSON 字符串原文（ Responses API 的 arguments 是字符串化的 JSON）。
    pub arguments: String,
}

/// 一次 LLM 响应的用量（两厂统一走 `usage.input_tokens_details.cached_tokens`，
/// 映射表收在预设里防字段方言回潮——design §9）。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Usage {
    pub input_tokens: u64,
    pub cached_tokens: u64,
    pub output_tokens: u64,
}

/// 一次 LLM 调用的结果：流式文本 + 输出项（回放）+ 调用 + 用量，或错误。
#[derive(Debug, Clone, Default)]
pub struct TurnOutput {
    /// 完整助手文本（= 全部 text chunk 拼接）。
    pub text: String,
    /// 流式 chunk（emit text_chunk 用；mock 按 fixture 分块）。
    pub text_deltas: Vec<String>,
    /// 回放项：reasoning 项原文（有则）——assistant message 项由 text 重建，不重复存。
    pub reasoning: Option<serde_json::Value>,
    /// 本轮函数调用（按序执行）。
    pub calls: Vec<ToolCall>,
    pub usage: Option<Usage>,
    pub error: Option<TurnError>,
}

impl TurnOutput {
    /// 无任何输出（无文本也无调用）的兜底——防脚本化空响应把循环卡死。
    pub fn is_empty_response(&self) -> bool {
        self.error.is_none() && self.text.is_empty() && self.calls.is_empty()
    }
}

/// LLM 调用错误（含上下文超限判定，供自动压缩重试）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnError {
    pub code: String,
    pub message: String,
    /// 命中 provider 预设的上下文超限特征串。
    pub context_overflow: bool,
}

/// provider 预设表（design §11 双预设）：base_url 默认、出厂 model（与 config.rs 的
/// `DEFAULT_KIMI_MODEL` / `DEFAULT_DEEPSEEK_MODEL` **同源引用**，MUST NOT 另写字面量——
/// REVIEW.md 第 8 条）、模型上下文窗口表、超限特征串。
pub struct ProviderPreset {
    /// base_url 默认值（未核实，验收批对真 API 验证；配置可覆盖）。
    pub base_url: &'static str,
    /// 出厂模型 id（引用 config 常量）。
    pub default_model: &'static str,
    /// 已知模型的上下文窗口（tokens）。未列出的模型回落 [`Self::fallback_window`]。
    pub windows: &'static [(&'static str, u64)],
    pub fallback_window: u64,
    /// 上下文超限错误特征串（小写子串匹配 code+message）。
    pub overflow_indicators: &'static [&'static str],
}

/// kimi 预设（[官方 Responses schema](https://platform.kimi.ai/docs/api/responses)）：
/// store 支持 ⇒ 显式 `store:false`；usage 含 `cache_write_tokens`（暂不展示）。
const KIMI_PRESET: ProviderPreset = ProviderPreset {
    base_url: "https://api.moonshot.cn/v1", // 未核实（验收批对真 API 验证；config 可覆盖）
    default_model: crate::config::DEFAULT_KIMI_MODEL,
    windows: &[("kimi-k2", 131_072)],
    fallback_window: 131_072,
    overflow_indicators: &[
        "context_length_exceeded",
        "maximum context length",
        "context window",
    ],
};

/// deepseek 预设（[官方 Responses 文档](https://api-docs.deepseek.com/guides/responses_api/)）：
/// 无状态（恒 `store:false`）；超窗请求返回 400；不支持参数静默忽略。
const DEEPSEEK_PRESET: ProviderPreset = ProviderPreset {
    base_url: "https://api.deepseek.com",
    default_model: crate::config::DEFAULT_DEEPSEEK_MODEL,
    windows: &[("deepseek-chat", 131_072), ("deepseek-flash", 131_072)],
    fallback_window: 131_072,
    overflow_indicators: &[
        "maximum context length",
        "context length",
        "too many tokens",
    ],
};

pub fn preset(provider: &HarnessProvider) -> &'static ProviderPreset {
    match provider {
        HarnessProvider::Kimi => &KIMI_PRESET,
        HarnessProvider::Deepseek => &DEEPSEEK_PRESET,
        HarnessProvider::Mock => &DEEPSEEK_PRESET, // mock 只消费 usage，预设仅作 fallback
    }
}

/// 模型上下文窗口：精确匹配预设表，未列出回落 provider 默认值（未核实数，验收批校准）。
pub fn context_window(preset: &ProviderPreset, model: &str) -> u64 {
    preset
        .windows
        .iter()
        .find(|(name, _)| *name == model)
        .map(|(_, window)| *window)
        .unwrap_or(preset.fallback_window)
}

/// 用量 → 面板快照：ctx% = input ÷ 窗口；cache% = cached ÷ input。
pub fn usage_snapshot(usage: &Usage, window: u64) -> UsageSnapshot {
    let ctx_pct = if window == 0 {
        0.0
    } else {
        usage.input_tokens as f64 * 100.0 / window as f64
    };
    let cache_pct = if usage.input_tokens == 0 {
        0.0
    } else {
        usage.cached_tokens as f64 * 100.0 / usage.input_tokens as f64
    };
    UsageSnapshot { ctx_pct, cache_pct }
}

/// 判定错误是否上下文超限（按 provider 特征串）。
fn is_overflow(preset: &ProviderPreset, code: &str, message: &str) -> bool {
    let haystack = format!("{code} {message}").to_lowercase();
    preset
        .overflow_indicators
        .iter()
        .any(|needle| haystack.contains(needle))
}

/// LLM 调用入参（owned：会话历史每轮本就整体序列化，克隆成本已在关键路径上）。
pub struct Request {
    pub system: String,
    /// Responses API input 数组（会话历史 + 本轮 user 消息）。
    pub input: Vec<serde_json::Value>,
    /// function tools 定义。
    pub tools: Vec<serde_json::Value>,
}

/// client 抽象（ADR 0007 Decision 3 留口的底层侧：将来 Chat Completions 适配器
/// 与 Responses 适配器并存于同一循环之下，design §3 fallback）。
pub trait LlmClient: Send {
    fn complete(&mut self, request: &Request) -> TurnOutput;
}

/// 按配置装配 client：mock ⇒ fixture 驱动；kimi / deepseek ⇒ reqwest blocking。
pub fn client(config: &HarnessConfig) -> Result<Box<dyn LlmClient>, CommandError> {
    match config.provider {
        HarnessProvider::Mock => {
            let fixture = config.providers.mock.fixture.clone().ok_or_else(|| {
                CommandError::new(
                    "harness_fixture_missing",
                    "provider 为 mock 但 harness.providers.mock.fixture 未配置",
                )
            })?;
            MockClient::from_file(std::path::Path::new(&fixture))
                .map(|c| Box::new(c) as Box<dyn LlmClient>)
        }
        HarnessProvider::Kimi | HarnessProvider::Deepseek => {
            let (api_key, model, base_url) = match config.provider {
                HarnessProvider::Kimi => (
                    &config.providers.kimi.api_key,
                    &config.providers.kimi.model,
                    config.providers.kimi.base_url.as_deref(),
                ),
                _ => (
                    &config.providers.deepseek.api_key,
                    &config.providers.deepseek.model,
                    config.providers.deepseek.base_url.as_deref(),
                ),
            };
            if api_key.trim().is_empty() {
                return Err(CommandError::new(
                    "harness_api_key_missing",
                    "当前 provider 的 api_key 未配置（config.json 的 harness.providers 节）",
                ));
            }
            let preset = preset(&config.provider);
            let base = base_url.unwrap_or(preset.base_url).trim_end_matches('/');
            Ok(Box::new(ResponsesClient {
                http: reqwest::blocking::Client::builder()
                    .timeout(std::time::Duration::from_secs(300))
                    .build()
                    .map_err(|e| {
                        CommandError::new("harness_http_failed", format!("{e}"))
                            .param("reason", e.to_string())
                    })?,
                endpoint: format!("{base}/responses"),
                api_key: api_key.clone(),
                model: model.clone(),
                store_false: matches!(config.provider, HarnessProvider::Kimi),
                preset,
            }))
        }
    }
}

// ---------------------------------------------------------------------------
// reqwest blocking + SSE（真 provider；真 API 连通性由验收批验证，本 mission mock 钉行为）
// ---------------------------------------------------------------------------

struct ResponsesClient {
    http: reqwest::blocking::Client,
    endpoint: String,
    api_key: String,
    model: String,
    /// kimi 支持 `store` ⇒ 显式 false 声明不留副本；deepseek 不支持（恒 false），不发。
    store_false: bool,
    preset: &'static ProviderPreset,
}

impl LlmClient for ResponsesClient {
    fn complete(&mut self, request: &Request) -> TurnOutput {
        match self.complete_inner(request) {
            Ok(output) => output,
            Err(e) => TurnOutput {
                error: Some(TurnError {
                    code: e.code.clone(),
                    message: e.message.clone(),
                    context_overflow: is_overflow(self.preset, &e.code, &e.message),
                }),
                ..Default::default()
            },
        }
    }
}

impl ResponsesClient {
    fn complete_inner(&mut self, request: &Request) -> Result<TurnOutput, CommandError> {
        let mut body = serde_json::json!({
            "model": self.model,
            "instructions": request.system,
            "input": request.input,
            "tools": request.tools,
            "tool_choice": "auto",
            "stream": true,
        });
        if self.store_false {
            body["store"] = serde_json::json!(false);
        }
        let response = self
            .http
            .post(&self.endpoint)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .map_err(|e| {
                CommandError::new("harness_network_failed", format!("LLM 请求发送失败：{e}"))
                    .param("reason", e.to_string())
            })?;
        let status = response.status();
        if !status.is_success() {
            let text = response.text().unwrap_or_default();
            let (code, message) = parse_error_body(&text).unwrap_or_else(|| {
                (
                    "harness_http_error".to_string(),
                    format!("HTTP {status}: {text}"),
                )
            });
            return Err(CommandError::new(code, message));
        }
        parse_sse(response, self.preset)
    }
}

/// 错误响应体取 `{error:{code,message}}`（OpenAI 形状，两家同构）。
fn parse_error_body(text: &str) -> Option<(String, String)> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let error = value.get("error")?;
    let code = error
        .get("code")
        .and_then(|c| c.as_str())
        .unwrap_or("harness_http_error")
        .to_string();
    let message = error
        .get("message")
        .and_then(|m| m.as_str())
        .unwrap_or("未知错误")
        .to_string();
    Some((code, message))
}

/// 语义化 SSE 解析（design §3）：按事件名分流，文本增量即时产出，输出项 / 用量
/// 从 `response.completed` 的完整 response 对象取（优于逐 delta 拼装 function_call）。
///
/// 流终止：`response.completed` / `response.incomplete` / `response.failed`（deepseek 明说
/// 无 `[DONE]`；kimi/OpenAI 形态会发 `[DONE]`，作为兜底终止）。非 JSON 的数据行忽略
///（厂商 keep-alive 注释行）。
fn parse_sse(
    response: reqwest::blocking::Response,
    preset: &ProviderPreset,
) -> Result<TurnOutput, CommandError> {
    let mut output = TurnOutput::default();
    let reader = std::io::BufReader::new(response);
    let mut event = String::new();
    let mut data = String::new();
    for line in reader.lines() {
        let Ok(line) = line else {
            break; // 流中断：用已收内容收尾（不当作致命错误）
        };
        if line.is_empty() {
            dispatch_event(&event, &data, &mut output, preset);
            event.clear();
            data.clear();
            if output.error.is_some() || terminal_state(&output) {
                break;
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("event:") {
            event = value.trim().to_string();
        } else if let Some(value) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(value.trim_start());
        }
        // 其余行（注释 / 未知字段）忽略
    }
    // 流结束而无终态事件：不报错，用已收内容（部分厂商截断时无 failed 事件）。
    Ok(output)
}

/// completed/incomplete/failed 已处理标记（用 usage/error 的有无近似终态）。
fn terminal_state(output: &TurnOutput) -> bool {
    output.usage.is_some() || output.error.is_some()
}

fn dispatch_event(event: &str, data: &str, output: &mut TurnOutput, preset: &ProviderPreset) {
    if data == "[DONE]" {
        return;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
        return;
    };
    match event {
        "response.output_text.delta" => {
            if let Some(delta) = value.get("delta").and_then(|d| d.as_str()) {
                output.text.push_str(delta);
                output.text_deltas.push(delta.to_string());
            }
        }
        "response.output_item.done" => {
            if let Some(item) = value.get("item") {
                collect_output_item(item, output);
            }
        }
        "response.completed" | "response.incomplete" => {
            if let Some(response) = value.get("response") {
                collect_final_response(response, output);
            }
        }
        "response.failed" => {
            let (code, message) = value
                .get("response")
                .and_then(|r| r.get("error"))
                .and_then(parse_error_value)
                .unwrap_or_else(|| {
                    (
                        "harness_response_failed".to_string(),
                        "响应失败".to_string(),
                    )
                });
            output.error = Some(TurnError {
                context_overflow: is_overflow(preset, &code, &message),
                code,
                message,
            });
        }
        "error" => {
            let (code, message) = parse_error_value(&value)
                .unwrap_or_else(|| ("harness_stream_error".to_string(), "流式错误".to_string()));
            output.error = Some(TurnError {
                context_overflow: is_overflow(preset, &code, &message),
                code,
                message,
            });
        }
        _ => {}
    }
}

/// 输出项归集：reasoning 项留作回放；function_call 项记入调用表；message 项的
/// output_text 与流式 delta 应一致（以流式为准，这里只补 delta 漏网的文本）。
fn collect_output_item(item: &serde_json::Value, output: &mut TurnOutput) {
    match item.get("type").and_then(|t| t.as_str()) {
        Some("reasoning") => {
            if output.reasoning.is_none() {
                output.reasoning = Some(item.clone());
            }
        }
        Some("function_call") => {
            output.calls.push(ToolCall {
                call_id: item
                    .get("call_id")
                    .and_then(|c| c.as_str())
                    .unwrap_or_default()
                    .to_string(),
                name: item
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or_default()
                    .to_string(),
                arguments: item
                    .get("arguments")
                    .and_then(|a| a.as_str())
                    .unwrap_or_default()
                    .to_string(),
            });
        }
        Some("message") => {
            if let Some(parts) = item.get("content").and_then(|c| c.as_array()) {
                for part in parts {
                    if part.get("type").and_then(|t| t.as_str()) == Some("output_text") {
                        if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                            if output.text.is_empty() {
                                output.text.push_str(text);
                            }
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

/// completed/incomplete 终态：output 数组补漏 + usage 归一化（两厂统一字段）。
fn collect_final_response(response: &serde_json::Value, output: &mut TurnOutput) {
    if let Some(items) = response.get("output").and_then(|o| o.as_array()) {
        for item in items {
            collect_output_item(item, output);
        }
    }
    if let Some(usage) = response.get("usage") {
        let input = usage
            .get("input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let cached = usage
            .get("input_tokens_details")
            .and_then(|d| d.get("cached_tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let out = usage
            .get("output_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        output.usage = Some(Usage {
            input_tokens: input,
            cached_tokens: cached,
            output_tokens: out,
        });
    }
    // incomplete（如 max_output_tokens 截断）带 incomplete_details，但非错误——
    // 已收文本照常可用，不置 error。
}

fn parse_error_value(error: &serde_json::Value) -> Option<(String, String)> {
    let code = error.get("code").and_then(|c| c.as_str())?.to_string();
    let message = error
        .get("message")
        .and_then(|m| m.as_str())
        .unwrap_or("未知错误")
        .to_string();
    Some((code, message))
}

// ---------------------------------------------------------------------------
// mock provider（验收专用）：fixture 脚本化响应
// ---------------------------------------------------------------------------

/// fixture 文件的一个脚本化响应（见模块文档的格式说明）。
#[derive(Debug, Clone, serde::Deserialize)]
struct FixtureResponse {
    #[serde(default)]
    text: String,
    #[serde(default)]
    chunks: Vec<String>,
    #[serde(default)]
    tool_calls: Vec<FixtureToolCall>,
    #[serde(default)]
    reasoning: Option<serde_json::Value>,
    #[serde(default)]
    usage: Option<FixtureUsage>,
    #[serde(default)]
    error: Option<FixtureError>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct FixtureToolCall {
    id: String,
    name: String,
    #[serde(default)]
    arguments: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct FixtureUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    cached_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct FixtureError {
    code: String,
    #[serde(default)]
    message: String,
}

/// fixture 驱动的确定性 client：每次 `complete` 按序弹一条脚本。
pub struct MockClient {
    script: std::collections::VecDeque<FixtureResponse>,
    /// 可读名字（JSONL 记录用）：fixture 路径。
    source: String,
}

impl MockClient {
    /// 从文件装配。文件缺失 / JSON 非法 ⇒ CommandError（验收配置错误的即时报错）。
    pub fn from_file(path: &std::path::Path) -> Result<Self, CommandError> {
        let text = std::fs::read_to_string(path).map_err(|e| {
            CommandError::new(
                "harness_fixture_unreadable",
                format!("mock fixture 不可读（{}）：{e}", path.display()),
            )
            .param("path", path.display().to_string())
            .param("reason", e.to_string())
        })?;
        Self::from_str(&text, &path.display().to_string())
    }

    /// 从 JSON 文本装配（单测直接用）。
    pub fn from_str(text: &str, source: &str) -> Result<Self, CommandError> {
        #[derive(serde::Deserialize)]
        struct FixtureFile {
            #[serde(default)]
            responses: Vec<FixtureResponse>,
        }
        let file: FixtureFile = serde_json::from_str(text).map_err(|e| {
            CommandError::new(
                "harness_fixture_invalid",
                format!("mock fixture 不是合法 JSON（{source}）：{e}"),
            )
            .param("path", source)
            .param("reason", e.to_string())
        })?;
        Ok(Self {
            script: file.responses.into(),
            source: source.to_string(),
        })
    }
}

impl LlmClient for MockClient {
    fn complete(&mut self, _request: &Request) -> TurnOutput {
        let Some(entry) = self.script.pop_front() else {
            return TurnOutput {
                error: Some(TurnError {
                    code: "fixture_exhausted".to_string(),
                    message: format!(
                        "mock fixture（{}）脚本已弹尽，测试脚本漏写响应",
                        self.source
                    ),
                    context_overflow: false,
                }),
                ..Default::default()
            };
        };
        if let Some(error) = entry.error {
            return TurnOutput {
                error: Some(TurnError {
                    code: error.code.clone(),
                    message: error.message.clone(),
                    // 脚本能写出各家特征串；overflow 判定用特征串本身（与真 client 同口径）。
                    context_overflow: ["context_length_exceeded", "maximum context length"]
                        .iter()
                        .any(|needle| {
                            format!("{} {}", error.code, error.message)
                                .to_lowercase()
                                .contains(needle)
                        }),
                }),
                ..Default::default()
            };
        }
        let text = entry.text.clone();
        let text_deltas = if entry.chunks.is_empty() {
            if text.is_empty() {
                Vec::new()
            } else {
                vec![text.clone()]
            }
        } else {
            entry.chunks.clone()
        };
        TurnOutput {
            text,
            text_deltas,
            reasoning: entry.reasoning,
            calls: entry
                .tool_calls
                .into_iter()
                .map(|c| ToolCall {
                    call_id: c.id,
                    name: c.name,
                    arguments: c.arguments,
                })
                .collect(),
            usage: entry.usage.map(|u| Usage {
                input_tokens: u.input_tokens,
                cached_tokens: u.cached_tokens,
                output_tokens: u.output_tokens,
            }),
            error: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"{
      "version": 1,
      "responses": [
        {"text": "先读", "chunks": ["先", "读"],
         "tool_calls": [{"id": "c1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}],
         "usage": {"input_tokens": 100, "cached_tokens": 40, "output_tokens": 5}},
        {"error": {"code": "context_length_exceeded", "message": "too long"}}
      ]
    }"#;

    fn request() -> Request {
        Request {
            system: "sys".into(),
            input: Vec::new(),
            tools: Vec::new(),
        }
    }

    #[test]
    fn mock_pops_script_in_order() {
        let mut client = MockClient::from_str(FIXTURE, "test").unwrap();
        let first = client.complete(&request());
        assert_eq!(first.text, "先读");
        assert_eq!(first.text_deltas, vec!["先", "读"]);
        assert_eq!(first.calls.len(), 1);
        assert_eq!(first.calls[0].name, "vault_read");
        assert_eq!(
            first.usage,
            Some(Usage {
                input_tokens: 100,
                cached_tokens: 40,
                output_tokens: 5
            })
        );
        let second = client.complete(&request());
        let error = second.error.expect("scripted error");
        assert!(error.context_overflow);
        let third = client.complete(&request());
        assert_eq!(third.error.unwrap().code, "fixture_exhausted");
    }

    #[test]
    fn usage_snapshot_percentages() {
        let usage = Usage {
            input_tokens: 65536,
            cached_tokens: 32768,
            output_tokens: 10,
        };
        let snap = usage_snapshot(&usage, 131_072);
        assert!((snap.ctx_pct - 50.0).abs() < f64::EPSILON);
        assert!((snap.cache_pct - 50.0).abs() < f64::EPSILON);
    }

    #[test]
    fn context_window_table_and_fallback() {
        let kimi = preset(&HarnessProvider::Kimi);
        assert_eq!(
            context_window(kimi, crate::config::DEFAULT_KIMI_MODEL),
            131_072
        );
        assert_eq!(context_window(kimi, "unknown-model"), kimi.fallback_window);
        // 出厂 model 与 config.rs 常量同源（REVIEW.md 第 8 条）
        assert_eq!(kimi.default_model, crate::config::DEFAULT_KIMI_MODEL);
        assert_eq!(
            preset(&HarnessProvider::Deepseek).default_model,
            crate::config::DEFAULT_DEEPSEEK_MODEL
        );
    }

    #[test]
    fn overflow_indicators_match_provider_dialects() {
        let kimi = preset(&HarnessProvider::Kimi);
        assert!(is_overflow(kimi, "context_length_exceeded", ""));
        let deepseek = preset(&HarnessProvider::Deepseek);
        assert!(is_overflow(
            deepseek,
            "invalid_request_error",
            "This model's maximum context length is 65536"
        ));
        assert!(!is_overflow(deepseek, "rate_limit", "slow down"));
    }
}
