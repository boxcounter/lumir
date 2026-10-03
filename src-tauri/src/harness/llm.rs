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
//!       "usage": {"input_tokens": 1200, "cached_tokens": 300, "output_tokens": 40},  // 可选
//!       "delay_ms": 45000                        // 可选：返回前先睡这么久（见下「脚本化延迟」）
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
//! **脚本化延迟**（`delay_ms`，M312 新增）：这条响应先睡这么久（毫秒）再返回，**默认 0**。
//! 验收里需要「回合正在途」这个窗口时用它撑住——M312 的跨 vault 事件过滤要验的正是
//! 「切换发生在回合进行中」：延迟把窗口从毫秒级撑到几十秒，切换动作（AX 读 + 点击，秒级）
//! 才落得进窗口内。睡眠发生在 `lumir-harness-llm` 专线程里（ADR 0002 §6），不碰热路径、
//! 不持有任何会话锁（`MockClient::complete` 期间 `Runtime` 的 sessions 锁是放开的）。
//!
//! # reasoning 回传纪律（design §3，M306 对真 API 核实）
//!
//! 流式里的 `reasoning` 项原样留作回放项（kimi 的 `encrypted_content` 因此保真）。
//! deepseek thinking 模式**不是**「reasoning 已合并进 assistant 消息」——2026-10-03
//! 对真 API（deepseek-flash）实测：产出独立 reasoning 项，content 为
//! `{"type":"reasoning_text","text":…}` parts（SSE `response.output_item.done` 携带，
//! 另带 `encrypted_content` / `status`）。官方
//! [thinking mode 文档](https://api-docs.deepseek.com/guides/thinking_mode) 明确：
//! 带 `tools` 的请求，后续每一轮都必须把 reasoning **原样回传**，否则 400
//! ``The `reasoning_text` in the thinking mode must be passed back to the API``
//! （Alex 真机二轮实测命中）。回放形状（真 API 实测通过）：reasoning 项紧随其
//! assistant message 之前入 input；[Responses 兼容表](https://api-docs.deepseek.com/guides/responses_api)
//! 称 plain-text content 会并入相邻 assistant 消息、`encrypted_content`/`summary`
//! 不被支持——但原样回传实测不报错，故保留原样（少一次形状重写，多一处方言风险消失）。

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
    /// 回放项：reasoning 项原文（有则；item 级原样或 message part 级合成）——
    /// assistant message 项由 text 重建，不重复存。
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
/// 窗口表 2026-10-03 经 `GET /models` 一手核实（[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)）：
/// 现役仅 `deepseek-flash` / `deepseek-v4-pro`，上下文均 1M（1048576）；`deepseek-chat`
/// 已不在模型清单（回落 fallback_window，仅兜底历史配置）。
const DEEPSEEK_PRESET: ProviderPreset = ProviderPreset {
    base_url: "https://api.deepseek.com",
    default_model: crate::config::DEFAULT_DEEPSEEK_MODEL,
    windows: &[
        ("deepseek-flash", 1_048_576),
        ("deepseek-v4-pro", 1_048_576),
    ],
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
    Ok(parse_sse_reader(std::io::BufReader::new(response), preset))
}

/// SSE 分词与事件分流的读循环，与 transport 解耦（真 client 传响应体，单测传合成字节流），
/// 协议层行为因此可用字节流直接钉死。
fn parse_sse_reader<R: BufRead>(reader: R, preset: &ProviderPreset) -> TurnOutput {
    let mut output = TurnOutput::default();
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
    output
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

/// 输出项归集：reasoning 项留作回放（item 级原样；message 里的 `reasoning_text`
/// part 在 item 级缺位时合成 reasoning 回放项）；function_call 项记入调用表；
/// message 项的 output_text 与流式 delta 应一致（以流式为准，这里只补 delta 漏网的文本）。
fn collect_output_item(item: &serde_json::Value, output: &mut TurnOutput) {
    match item.get("type").and_then(|t| t.as_str()) {
        Some("reasoning") => {
            if output.reasoning.is_none() {
                output.reasoning = Some(item.clone());
            }
        }
        Some("function_call") => {
            let call_id = item
                .get("call_id")
                .and_then(|c| c.as_str())
                .unwrap_or_default()
                .to_string();
            // 同一个 function_call 会先经 `response.output_item.done`、再随
            // `response.completed`/`incomplete` 的 `output` 数组各到一次（两处携带同一
            // call_id）。按 call_id 去重保证每条调用恰好入表一次——否则下游会重复执行工具、
            // 并把同一 call_id 的 function_call 项重复压入 input，被 provider 以
            // "Duplicate 'call_id'" 拒绝。
            if output.calls.iter().any(|c| c.call_id == call_id) {
                return;
            }
            output.calls.push(ToolCall {
                call_id,
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
                // message part 级 reasoning（`reasoning_text` content part）：deepseek 报错
                // 文案暗示的形状，item 级 reasoning 缺位时按 parts 合成回放项（parts 原样）。
                let mut reasoning_parts: Vec<serde_json::Value> = Vec::new();
                for part in parts {
                    match part.get("type").and_then(|t| t.as_str()) {
                        Some("output_text") => {
                            if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                                if output.text.is_empty() {
                                    output.text.push_str(text);
                                }
                            }
                        }
                        Some("reasoning_text") => reasoning_parts.push(part.clone()),
                        _ => {}
                    }
                }
                if !reasoning_parts.is_empty() && output.reasoning.is_none() {
                    output.reasoning = Some(serde_json::json!({
                        "type": "reasoning",
                        "content": reasoning_parts,
                    }));
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
    /// 返回前先睡的毫秒数（见模块文档的「脚本化延迟」；默认 0 = 立刻返回）。
    #[serde(default)]
    delay_ms: u64,
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
        // 脚本化延迟（默认 0）：撑住「回合在途」的窗口供验收断言用。放在错误分支之前——
        // 「迟到的是错误」同样是跨 vault 拒收的对象（理由见模块文档）。
        if entry.delay_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(entry.delay_ms));
        }
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
         "reasoning": {"type":"reasoning","id":"rs_1","encrypted_content":"enc"},
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
        // reasoning 回放项原样透传（M306：mock 路径零行为变化即指此）。
        assert_eq!(first.reasoning.as_ref().unwrap()["id"], "rs_1");
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

    // ---- M305：SSE 输出项收集去重 ----
    //
    // 真 provider 会先发 `response.output_item.done`（携带完整 function_call 项），
    // 再发 `response.completed`（`response.output` 是全量数组，含同一个项）。两处都调
    // collect_output_item，function_call 无守卫曾导致每条调用入表两次 ⇒ 工具执行两遍、
    // 同一 call_id 的 function_call 重复入 input ⇒ provider 以 "Duplicate 'call_id'" 拒绝。
    // 以下用合成字节流钉死协议层行为（与 transport 解耦的 parse_sse_reader）。

    /// 合成 SSE 字节流喂协议层读循环。
    fn sse_parse(bytes: &str) -> TurnOutput {
        parse_sse_reader(
            std::io::Cursor::new(bytes.as_bytes()),
            preset(&HarnessProvider::Deepseek),
        )
    }

    #[test]
    fn sse_collects_function_call_once_across_done_and_completed() {
        let sse = r#"event: response.output_item.done
data: {"item":{"type":"function_call","call_id":"call_00_abc","name":"vault_read","arguments":"{\"path\":\"a.md\"}"}}

event: response.completed
data: {"response":{"output":[{"type":"function_call","call_id":"call_00_abc","name":"vault_read","arguments":"{\"path\":\"a.md\"}"}],"usage":{"input_tokens":10,"output_tokens":2}}}

"#;
        let output = sse_parse(sse);
        assert_eq!(
            output.calls.len(),
            1,
            "同一 call_id 只应收集一次：{:?}",
            output.calls
        );
        assert_eq!(output.calls[0].call_id, "call_00_abc");
        assert_eq!(output.calls[0].name, "vault_read");
        assert_eq!(output.calls[0].arguments, r#"{"path":"a.md"}"#);
    }

    #[test]
    fn sse_collects_each_of_multiple_distinct_calls_once_in_order() {
        let sse = r#"event: response.output_item.done
data: {"item":{"type":"function_call","call_id":"call_1","name":"vault_read","arguments":"{\"path\":\"a.md\"}"}}

event: response.output_item.done
data: {"item":{"type":"function_call","call_id":"call_2","name":"vault_search","arguments":"{\"query\":\"needle\"}"}}

event: response.completed
data: {"response":{"output":[{"type":"function_call","call_id":"call_1","name":"vault_read","arguments":"{\"path\":\"a.md\"}"},{"type":"function_call","call_id":"call_2","name":"vault_search","arguments":"{\"query\":\"needle\"}"}],"usage":{"input_tokens":10,"output_tokens":2}}}

"#;
        let output = sse_parse(sse);
        let ids: Vec<&str> = output.calls.iter().map(|c| c.call_id.as_str()).collect();
        assert_eq!(ids, vec!["call_1", "call_2"], "{:?}", output.calls);
    }

    /// done + incomplete + completed 三连（incomplete 无 usage 不终止，completed 才终止）
    /// 也不得让同一条调用重复入表。
    #[test]
    fn sse_dedupes_across_done_incomplete_and_completed() {
        let sse = r#"event: response.output_item.done
data: {"item":{"type":"function_call","call_id":"call_9","name":"vault_read","arguments":"{\"path\":\"a.md\"}"}}

event: response.incomplete
data: {"response":{"output":[{"type":"function_call","call_id":"call_9","name":"vault_read","arguments":"{\"path\":\"a.md\"}"}]}}

event: response.completed
data: {"response":{"output":[{"type":"function_call","call_id":"call_9","name":"vault_read","arguments":"{\"path\":\"a.md\"}"}],"usage":{"input_tokens":10,"output_tokens":2}}}

"#;
        let output = sse_parse(sse);
        assert_eq!(output.calls.len(), 1, "{:?}", output.calls);
    }

    /// 只发 completed（不发 output_item.done）的形态行为不变——kimi 路径若如此，
    /// 本次改动对它是零行为变化。
    #[test]
    fn sse_collects_call_from_completed_only() {
        let sse = r#"event: response.completed
data: {"response":{"output":[{"type":"function_call","call_id":"call_x","name":"vault_read","arguments":"{\"path\":\"a.md\"}"}],"usage":{"input_tokens":10,"output_tokens":2}}}

"#;
        let output = sse_parse(sse);
        assert_eq!(output.calls.len(), 1);
        assert_eq!(output.calls[0].call_id, "call_x");
    }

    /// response.output 数组内同名 call_id 的重复项（协议异常）也只保留一条，
    /// 避免重复执行与重复入 input。
    #[test]
    fn sse_dedupes_repeated_call_id_within_completed_output() {
        let sse = r#"event: response.completed
data: {"response":{"output":[{"type":"function_call","call_id":"dup","name":"vault_read","arguments":"{}"},{"type":"function_call","call_id":"dup","name":"vault_read","arguments":"{}"}],"usage":{"input_tokens":10,"output_tokens":2}}}

"#;
        let output = sse_parse(sse);
        assert_eq!(output.calls.len(), 1, "{:?}", output.calls);
    }

    /// reasoning（is_none 守卫）与文本（is_empty 守卫）的幂等性在去重逻辑下仍成立：
    /// 两个事件都携带时，reasoning 只留一份、message 文本不重复拼接。
    #[test]
    fn sse_reasoning_and_text_guards_still_hold() {
        let sse = r#"event: response.output_item.done
data: {"item":{"type":"reasoning","id":"rs_1","encrypted_content":"enc"}}

event: response.output_item.done
data: {"item":{"type":"message","content":[{"type":"output_text","text":"你好"}]}}

event: response.completed
data: {"response":{"output":[{"type":"reasoning","id":"rs_1","encrypted_content":"enc"},{"type":"message","content":[{"type":"output_text","text":"你好"}]}],"usage":{"input_tokens":10,"output_tokens":2}}}

"#;
        let output = sse_parse(sse);
        assert_eq!(output.text, "你好", "message 文本不应因两个事件重复拼接");
        assert_eq!(output.reasoning.as_ref().unwrap()["id"], "rs_1");
    }

    /// 流式 text delta 在文本收集里优先于 message 项：message 文本因 text 已非空被跳过，
    /// 两个事件各带一份也不翻倍。
    #[test]
    fn sse_stream_deltas_win_over_duplicated_message_items() {
        let sse = r#"event: response.output_text.delta
data: {"delta":"流式"}

event: response.output_item.done
data: {"item":{"type":"message","content":[{"type":"output_text","text":"流式"}]}}

event: response.completed
data: {"response":{"output":[{"type":"message","content":[{"type":"output_text","text":"流式"}]}],"usage":{"input_tokens":10,"output_tokens":2}}}

"#;
        let output = sse_parse(sse);
        assert_eq!(output.text, "流式");
    }

    // ---- M306：deepseek thinking reasoning 捕获与回放 ----
    //
    // 背景（真机二轮 400）：deepseek thinking 模式（默认开）产出独立 reasoning 项，
    // content 为 reasoning_text parts；带 tools 的请求后续每轮必须原样回传，否则
    // `The `reasoning_text` in the thinking mode must be passed back to the API`。
    // 以下流的 reasoning 项形状抄自 2026-10-03 对真 API（deepseek-flash）的 SSE 实测。

    /// deepseek-flash 实测的 reasoning 项（item 级形状：content reasoning_text parts
    /// + encrypted_content + status + summary）。
    const DEEPSEEK_REASONING_ITEM: &str = r#"{"type":"reasoning","id":"3088ae32-3f16-41a0-ad8d-3cbd8b7e4176","status":"completed","content":[{"type":"reasoning_text","text":"用户问的是 2+2。不需要工具。"}],"summary":[],"encrypted_content":"891a103a-5fff-47b2-899d-573104b0d161-0"}"#;

    /// 完整 thinking 工具流（done + completed 双事件，与 M305 去重测试同骨架）：
    /// reasoning 项 + function_call 项各经 `response.output_item.done` 与
    /// `response.completed` 双投递。断言：reasoning content 形状（reasoning_text
    /// parts，与官方 thinking 文档一致）原样在列、调用去重、回放构造里 reasoning
    /// 项紧随 assistant message 之前。
    #[test]
    fn sse_deepseek_thinking_reasoning_replayed_verbatim() {
        let sse = format!(
            r#"event: response.output_text.delta
data: {{"delta":"我先"}}

event: response.output_text.delta
data: {{"delta":"读一下。"}}

event: response.output_item.done
data: {{"item":{DEEPSEEK_REASONING_ITEM}}}

event: response.output_item.done
data: {{"item":{{"type":"function_call","call_id":"call_00_abc","name":"vault_read","arguments":"{{\"path\":\"a.md\"}}"}}}}

event: response.completed
data: {{"response":{{"output":[{DEEPSEEK_REASONING_ITEM},{{"type":"function_call","call_id":"call_00_abc","name":"vault_read","arguments":"{{\"path\":\"a.md\"}}"}}],"usage":{{"input_tokens":10,"output_tokens":2}}}}}}

"#
        );
        let output = sse_parse(&sse);

        // 捕获：reasoning 项原样（含 encrypted_content 等全字段）。
        let reasoning = output.reasoning.clone().expect("reasoning 项应被捕获");
        assert_eq!(reasoning["type"], "reasoning");
        assert_eq!(
            reasoning["encrypted_content"],
            "891a103a-5fff-47b2-899d-573104b0d161-0"
        );
        // 形状与官方文档一致：content 是 reasoning_text parts。
        let parts = reasoning["content"].as_array().expect("content 数组");
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0]["type"], "reasoning_text");
        assert_eq!(parts[0]["text"], "用户问的是 2+2。不需要工具。");

        // 其余收集不受影响：文本来自流式 delta，调用跨双事件去重。
        assert_eq!(output.text, "我先读一下。");
        assert_eq!(output.calls.len(), 1, "{:?}", output.calls);

        // 回放构造：reasoning 项原样在前，assistant message 在后（session 契约）。
        let items =
            crate::harness::session::assistant_item(&output.text, output.reasoning.as_ref());
        assert_eq!(items.len(), 2);
        assert_eq!(items[0], reasoning, "reasoning 项应原样入回放 input");
        assert_eq!(items[1]["role"], "assistant");
        assert_eq!(items[1]["content"][0]["type"], "output_text");
    }

    /// message part 级形状（deepseek 报错文案 `reasoning_text` 暗示的另一种产出形态）：
    /// reasoning 不进独立 item，而是 assistant message content 里的 reasoning_text
    /// part。当前实现须把它合成 reasoning 回放项（parts 原样），且不得混入正文文本。
    #[test]
    fn sse_message_part_reasoning_text_synthesizes_replay_item() {
        let sse = r#"event: response.output_item.done
data: {"item":{"type":"message","content":[{"type":"reasoning_text","text":"先想清楚再答。"},{"type":"output_text","text":"答案是 4。"}]}}

event: response.completed
data: {"response":{"output":[{"type":"message","content":[{"type":"reasoning_text","text":"先想清楚再答。"},{"type":"output_text","text":"答案是 4。"}]}],"usage":{"input_tokens":10,"output_tokens":2}}}

"#;
        let output = sse_parse(sse);
        assert_eq!(output.text, "答案是 4。", "reasoning_text 不得混入正文");
        let reasoning = output.reasoning.expect("part 级 reasoning 应合成回放项");
        assert_eq!(reasoning["type"], "reasoning");
        assert_eq!(
            reasoning["content"],
            serde_json::json!([{"type":"reasoning_text","text":"先想清楚再答。"}]),
            "parts 原样保留"
        );
    }

    /// item 级与 part 级同现一轮时，item 级优先（is_none 守卫），part 级不覆盖。
    #[test]
    fn sse_item_level_reasoning_wins_over_message_part() {
        let sse = format!(
            r#"event: response.output_item.done
data: {{"item":{DEEPSEEK_REASONING_ITEM}}}

event: response.output_item.done
data: {{"item":{{"type":"message","content":[{{"type":"reasoning_text","text":"part 级思考"}}]}}}}

event: response.completed
data: {{"response":{{"output":[{DEEPSEEK_REASONING_ITEM}],"usage":{{"input_tokens":10,"output_tokens":2}}}}}}

"#
        );
        let output = sse_parse(&sse);
        let reasoning = output.reasoning.expect("reasoning 项应被捕获");
        assert_eq!(
            reasoning["content"][0]["text"],
            "用户问的是 2+2。不需要工具。"
        );
    }
}
