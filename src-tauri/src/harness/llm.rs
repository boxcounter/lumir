//! LLM client（design §3、§9、§13）：OpenAI Responses API + function tools，kimi / deepseek /
//! mock 三 provider，会话状态全部客户端化（显式 `store: false`，不用
//! `previous_response_id` / `conversation`——deepseek 无状态实现，kimi 侧主动不留副本）。
//!
//! # 请求形状（对着两家官方兼容表核对，2026-10-02；思考程度 2026-10-07 补）
//!
//! 发送体只有：`model` / `instructions` / `input` / `tools` / `tool_choice:"auto"` /
//! `stream:true`，外加 **kimi 专属**的 `store:false`，以及 **M362 起按档位发的
//! `reasoning.effort`**（映射表与文档出处见 [`super::thinking`]；provider 不支持档位调节时
//! 不发该字段）。刻意不发的参数及理由：
//! - `store`：deepseek 不支持（其恒为 false；[兼容表](https://api-docs.deepseek.com/guides/responses_api/)）
//!   ——kimi 侧显式发是「vault 内容不在 provider 侧留副本」的主动声明。
//! - `temperature` / `max_output_tokens` / `text` 等：探针期用厂商默认，
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
//!       "reasoning_chunks": ["先想清楚", "再答。"],  // 可选：思考文本分片（M362，给人看，见下）
//!       "usage": {"input_tokens": 1200, "cached_tokens": 300, "output_tokens": 40},  // 可选
//!       "delay_ms": 45000,                        // 可选：返回前先睡这么久（见下「脚本化延迟」）
//!       "chunk_delay_ms": 5000                   // 可选：分片之间的间隔（见下「逐片延迟」）
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
//! **思考文本的两个字段各管一头（M362）**：`reasoning` 是**回放项**（原样回传给模型，M306
//! 纪律，见下节）；`reasoning_chunks` 是**给人看的思考分片**（`turn` 逐片发
//! `reasoning_chunk` 事件），两者互不影响。只给 `reasoning` 而不给 `reasoning_chunks` 时，
//! 展示侧退回「从回放项里提取明文文本、整段作一个分片」（[`super::thinking::reasoning_text`]），
//! 故老 fixture 无需改动也会有思考块。`encrypted_content` 永不进入展示侧。
//!
//! **脚本化延迟**（`delay_ms`，M312 新增）：这条响应先睡这么久（毫秒）再返回，**默认 0**。
//! 验收里需要「回合正在途」这个窗口时用它撑住——M312 的跨 vault 事件过滤要验的正是
//! 「切换发生在回合进行中」：延迟把窗口从毫秒级撑到几十秒，切换动作（AX 读 + 点击，秒级）
//! 才落得进窗口内。睡眠发生在 `lumir-harness-llm` 专线程里（ADR 0002 §6），不碰热路径、
//! 不持有任何会话锁（`MockClient::complete` 期间 `Runtime` 的 sessions 锁是放开的）。
//!
//! **逐片延迟**（`chunk_delay_ms`，M369 新增）：**相邻两片之间**的间隔（毫秒，默认 0 = 无间隔）。
//! 它撑的是「响应**正在逐字到达**」这个窗口——M369 的真流式与在途停止要验的正是它：分片按
//! 间隔一片片产出并即时转发（[`StreamSink`]），观者能在整条回答完成之前看到部分正文。
//! **它是可中断的**：每段间隔睡完先问一次 [`StreamSink::aborted`]，翻真即停产出——已产出的
//! 分片保留（中断语义 = 「不再继续」）。与 `delay_ms` 的分工：后者是「响应尚未开始」的窗口，
//! **不可中断**（一次睡到底；验收场景 88 依赖「停止请求在返回后才被检查点判到、产出照常保留」
//! 这条语义），前者是「流式进行中」的窗口。
//!
//! # 真流式与在途停止（M369）
//!
//! 解析层不再把增量攒起来等整条响应读完再事后补发——收到即经 [`StreamSink`] 转发
//! （真 provider 走 SSE 读循环，mock 走分片产出循环），前端因此逐字上屏。
//! [`TurnOutput::text`] 仍是全文（快照与 JSONL 用它）；分片本身不留档（转发即消费）。
//!
//! `StreamSink::aborted()` 把「用户点了停止」接进读循环：流式期间点停止即收流（真 provider 在
//! 下一个 SSE 事件后收口，mock 在下一片间隔后收口），**已产出的内容保留在 `TurnOutput` 里**，
//! 由 [`super::turn`] 收口（标注「已停止」）。两处边界如实登记：① `delay_ms` 与阻塞式
//! `reader.lines()` 期间的停止仍要等到睡眠 / 下一条数据到达才生效（后者是阻塞 IO 的固有边界，
//! 与改动前一致——真 provider 在流停滞时本就不推数据）；② 流中中断时 reasoning 回放项通常
//! 尚未到达（它随 `response.output_item.done` / `response.completed` 来），该轮 assistant 消息
//! 因此不带 reasoning 项——是否被 provider 拒收**未实测**（M360 的逐项变异显示那条 400 的触发
//! 条件是项序而非缺失 reasoning，且中断轮的 assistant 消息不含 function_call 项），
//! 已作为 finding 报 tower 待裁决。
//!
//! # reasoning 回传纪律（design §3，M306 对真 API 核实；M360 补项序条件）
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
//!
//! **同一轮多条工具的项序也是硬条件（M360，2026-10-07 逐项变异实测）**：那条 400 的
//! 报错文案指向 reasoning，实际触发条件是**项序**——兼容层把 `function_call` 并进相邻的
//! assistant 消息，调用与输出交错（`fc1, fco1, fc2, fco2`）时第二条调用落进一条新的、
//! 没有 reasoning 的 assistant 消息 ⇒ 400。实测对照（同一请求体逐项变异）：交错 400；
//! 成组（`fc1, fc2, fco1, fco2`）200；**把 reasoning 整项删掉、两条调用仍交错，照旧 400**
//! （即报错文案与缺失字段无关，别按文案去补 reasoning）。入 input 的成组压栈落在
//! [`super::turn`]（`flush_call_items`），单测
//! `harness_runtime::multi_call_round_groups_call_items_before_outputs` 钉住项序。
//!
//! # 展示侧思考文本与档位记录（M362，change add-harness-thinking-display-and-effort）
//!
//! 上面那节是**回放**（回传给模型），本节是**展示**（给人看），两者物理隔离、互不借道：
//!
//! - **分片捕获**：[`dispatch_event`] 另收两种流事件——deepseek 的
//!   `response.reasoning_text.delta`、kimi 的 `response.reasoning_summary_text.delta`
//!   （[Responses 事件表](https://api-docs.deepseek.com/guides/responses_api/) /
//!   [Kimi Responses 事件表](https://platform.kimi.ai/docs/api/responses)），只追加到
//!   [`TurnOutput::reasoning_deltas`]（**展示专用**）。`collect_output_item` 的 reasoning
//!   分支一行未动：回放项仍然只有那一条路径产出（M306 红线的判据就是这条）。
//! - **档位记录**：mock 每次 `complete` 记下收到的 [`Request::effort`]（[`MockClient::received_efforts`]），
//!   供验收断言「切档位后下一轮请求携带了映射后的参数」。真 provider 侧由
//!   [`super::thinking::apply_effort`] 把档位写进请求体，两边共用同一张映射表。

use std::io::BufRead;

use crate::commands::CommandError;
use crate::config::{HarnessConfig, HarnessProvider};

use super::events::StreamSink;
use super::session::UsageSnapshot;
use super::thinking::{self, ThinkingEffort};

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
    /// 完整助手文本（= 本轮全部流式分片拼接）。分片本身**不在这里留档**——它们在
    /// 解析层收到的那一刻就经 [`StreamSink`] 转发出去（M369）；快照与 JSONL 用这里的全文。
    pub text: String,
    /// 回放项：reasoning 项原文（有则；item 级原样或 message part 级合成）——
    /// assistant message 项由 text 重建，不重复存。
    pub reasoning: Option<serde_json::Value>,
    /// **展示专用**的思考文本分片（M362）：SSE 的 reasoning 文本 delta（真 provider）或
    /// fixture 的 `reasoning_chunks`（mock）。与 [`Self::reasoning`] 物理隔离——这份永不
    /// 参与回放（M306 纪律），`reasoning` 也永不喂给展示侧的分片通道（展示从这里拿不到文本时
    /// 才退回从 `reasoning` 提取，见 [`super::thinking::reasoning_text`]）。
    ///
    /// 与 `text` 不同，这份**留着**：它同时是「本轮思考是否已由解析层即时转发过」的判据
    ///（非空 ⇒ 已转发；`turn` 据此决定要不要补发整段兜底分片，M369）。
    pub reasoning_deltas: Vec<String>,
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
///
/// 窗口表 2026-10-07 一手核实（[中国开放平台 Chat Completions 参数表](https://platform.moonshot.cn/docs/api/chat)
/// 的 `model` 取值表、[全球平台 Model List](https://platform.kimi.ai/docs/models.md)）：开放平台
/// 现役四个 id——`kimi-k3`（本仓出厂默认，1M ctx）/ `kimi-k2.7-code` /
/// `kimi-k2.7-code-highspeed` / `kimi-k2.6`（后三者 256K）。`kimi-k2` 系 2026-05-25 退役，
/// 已不在表内：它回落 `fallback_window`（131_072，与它的历史窗口同值，历史配置的 ctx% 读数
/// 逐值不变）。**Kimi Code 订阅端的 `k3-256k` 不在本表**——那是另一套端点与协议
/// （Anthropic-compatible）的 id，本 provider 发的是 Responses 请求。
const KIMI_PRESET: ProviderPreset = ProviderPreset {
    base_url: "https://api.moonshot.cn/v1", // 未核实（验收批对真 API 验证；config 可覆盖）
    default_model: crate::config::DEFAULT_KIMI_MODEL,
    windows: &[
        ("kimi-k3", 1_048_576),
        ("kimi-k2.7-code", 262_144),
        ("kimi-k2.7-code-highspeed", 262_144),
        ("kimi-k2.6", 262_144),
    ],
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
    /// 本轮的思考程度档位（会话侧读入，M362）：真 provider 由 [`super::thinking::apply_effort`]
    /// 映射成请求参数，mock 记下来供断言。放在请求里而不是 client 字段上——档位随会话可变，
    /// 且这样「会话 → 请求 → provider」这条链在 [`super::turn::run_turn_for`] 层可单测。
    pub effort: ThinkingEffort,
}

/// client 抽象（ADR 0007 Decision 3 留口的底层侧：将来 Chat Completions 适配器
/// 与 Responses 适配器并存于同一循环之下，design §3 fallback）。
pub trait LlmClient: Send {
    /// 发起一次 LLM 往返。`sink` 是**流式增量转发口**（M369）：正文 / 思考增量到达即转发
    /// （前端逐字上屏，不再等价整条响应读完后补发）；`sink.aborted()` 翻真时读循环提前收流，
    /// **已产出的内容保留在返回值里**（在途停止，见模块头的「真流式与在途停止」）。
    ///
    /// 调用方 MUST NOT 持有会话锁调用本方法（一轮可能流式几分钟，持锁会把
    /// `harness_state` / 批准通道全堵住）——`sink` 的回调里可能反过来短暂查会话（中断探测）。
    fn complete(&mut self, request: &Request, sink: &dyn StreamSink) -> TurnOutput;
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
                provider: config.provider,
                store_false: matches!(config.provider, HarnessProvider::Kimi),
                preset,
            }))
        }
    }
}

/// 当前生效的模型名：ctx% 的窗口查表与思考档位能力判定都用它（**单一来源**——两处各写一份
/// match 必然漂移，REVIEW.md 第 8 条）。mock 档没有自己的模型，沿用 kimi 侧读数
///（与 [`preset`] 对 mock 回落 deepseek 预设是同一「mock 只借壳」的口径）。
pub fn active_model(config: &HarnessConfig) -> &str {
    match config.provider {
        HarnessProvider::Kimi => &config.providers.kimi.model,
        HarnessProvider::Deepseek => &config.providers.deepseek.model,
        HarnessProvider::Mock => &config.providers.kimi.model,
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
    /// 本 client 服务的 provider（M362）：思考程度映射要按 provider 分支
    ///（[`super::thinking::apply_effort`]），与 `model` 一起构成能力判据。
    provider: HarnessProvider,
    /// kimi 支持 `store` ⇒ 显式 false 声明不留副本；deepseek 不支持（恒 false），不发。
    store_false: bool,
    preset: &'static ProviderPreset,
}

impl LlmClient for ResponsesClient {
    fn complete(&mut self, request: &Request, sink: &dyn StreamSink) -> TurnOutput {
        match self.complete_inner(request, sink) {
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
    fn complete_inner(
        &mut self,
        request: &Request,
        sink: &dyn StreamSink,
    ) -> Result<TurnOutput, CommandError> {
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
        // 思考程度按档位映射（M362）：provider 支持时写顶层 `reasoning.effort`，
        // 不支持（如非 k3 系的 kimi 模型）时不写该字段——映射表与文档出处见 `super::thinking`。
        thinking::apply_effort(&mut body, &self.provider, &self.model, request.effort);
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
        parse_sse(response, self.preset, sink)
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

/// 语义化 SSE 解析（design §3）：按事件名分流，文本增量**收到即转发**（`sink`，M369 真流式），
/// 输出项 / 用量从 `response.completed` 的完整 response 对象取（优于逐 delta 拼装 function_call）。
///
/// 流终止：`response.completed` / `response.incomplete` / `response.failed`（deepseek 明说
/// 无 `[DONE]`；kimi/OpenAI 形态会发 `[DONE]`，作为兜底终止）、以及 `sink.aborted()`
///（在途停止：用户点了停止，不再等后续事件）。非 JSON 的数据行忽略（厂商 keep-alive 注释行）。
fn parse_sse(
    response: reqwest::blocking::Response,
    preset: &ProviderPreset,
    sink: &dyn StreamSink,
) -> Result<TurnOutput, CommandError> {
    Ok(parse_sse_reader(
        std::io::BufReader::new(response),
        preset,
        sink,
    ))
}

/// SSE 分词与事件分流的读循环，与 transport 解耦（真 client 传响应体，单测传合成字节流），
/// 协议层行为因此可用字节流直接钉死。
///
/// 每个事件处理完问一次 `sink.aborted()`：翻真即收流，已收内容照常返回（在途停止）。
/// 阻塞在 `reader.lines()` 期间无法被中断——这是阻塞 IO 的固有边界（流停滞时本就没有数据
/// 可读；改动前停止也要等整条响应读完才生效，故非回归）。
fn parse_sse_reader<R: BufRead>(
    reader: R,
    preset: &ProviderPreset,
    sink: &dyn StreamSink,
) -> TurnOutput {
    let mut output = TurnOutput::default();
    let mut event = String::new();
    let mut data = String::new();
    for line in reader.lines() {
        let Ok(line) = line else {
            break; // 流中断：用已收内容收尾（不当作致命错误）
        };
        if line.is_empty() {
            dispatch_event(&event, &data, &mut output, preset, sink);
            event.clear();
            data.clear();
            if output.error.is_some() || terminal_state(&output) || sink.aborted() {
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

fn dispatch_event(
    event: &str,
    data: &str,
    output: &mut TurnOutput,
    preset: &ProviderPreset,
    sink: &dyn StreamSink,
) {
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
                // 即时转发（M369）：不再攒起来等整条响应读完再补发。
                sink.text_delta(delta);
            }
        }
        // 展示侧思考分片（M362）：deepseek 的 chain-of-thought 增量、kimi 的思考摘要增量
        //（两家事件名不同，见模块头「展示侧思考文本与档位记录」）。**只追加到展示专用的
        // `reasoning_deltas`**——回放项仍只由 `collect_output_item` 产出，这条支路碰不到它。
        // 同样即时转发（M369；分片的事件形状与思考块序号由 `turn` 的转发器决定）。
        "response.reasoning_text.delta" | "response.reasoning_summary_text.delta" => {
            if let Some(delta) = value.get("delta").and_then(|d| d.as_str()) {
                output.reasoning_deltas.push(delta.to_string());
                sink.reasoning_delta(delta);
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
    /// 展示侧的思考文本分片（M362，见模块文档）：`turn` 逐片发 `reasoning_chunk` 事件。
    /// 与 `reasoning`（回放项）互不影响；只给 `reasoning` 时展示退回「从回放项提取、整段一片」。
    #[serde(default)]
    reasoning_chunks: Vec<String>,
    #[serde(default)]
    usage: Option<FixtureUsage>,
    #[serde(default)]
    error: Option<FixtureError>,
    /// 返回前先睡的毫秒数（见模块文档的「脚本化延迟」；默认 0 = 立刻返回）。**不可中断**：
    /// 这是「响应尚未开始」的窗口，停止请求要等它睡满后由 `turn` 的检查点判到。
    #[serde(default)]
    delay_ms: u64,
    /// **相邻两片之间**的间隔毫秒数（见模块文档的「逐片延迟」；默认 0 = 无间隔）。
    /// 可中断：每段间隔睡完问一次 [`StreamSink::aborted`]，翻真即停产出（已产出分片保留）。
    #[serde(default)]
    chunk_delay_ms: u64,
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
    /// 每次 `complete` 收到的思考程度档位（按调用序，M362）——验收据此断言「切档位后下一轮
    /// 请求携带了映射后的参数」。mock 不消费它，只**记录**（真 provider 由
    /// [`super::thinking::apply_effort`] 把它写进请求体）。
    received_efforts: Vec<ThinkingEffort>,
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
            received_efforts: Vec::new(),
        })
    }

    /// 收到的档位序列（按调用序），供验收 / 单测断言。
    pub fn received_efforts(&self) -> &[ThinkingEffort] {
        &self.received_efforts
    }
}

impl LlmClient for MockClient {
    fn complete(&mut self, request: &Request, sink: &dyn StreamSink) -> TurnOutput {
        // 记录收到的档位（M362）：与脚本是否弹尽无关——验收要断言的是「发出去的是什么」，
        // 故放在最前面，耗尽路径也留痕。
        self.received_efforts.push(request.effort);
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
        // 「迟到的是错误」同样是跨 vault 拒收的对象（理由见模块文档）。**不可中断**：
        // 一次睡到底（见模块头「逐片延迟」里与 `chunk_delay_ms` 的分工）。
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
        // 本轮的正文分片序列：给了 `chunks` 按它分片，否则整段文本作一片（空文本则零片）。
        let chunks = if entry.chunks.is_empty() {
            if entry.text.is_empty() {
                Vec::new()
            } else {
                vec![entry.text.clone()]
            }
        } else {
            entry.chunks.clone()
        };
        // 非分片字段先落到 output：分片产出可能被在途停止提前中断，回放项 / 调用 / 用量
        // 仍应尽力带回（尤其 reasoning 回放项——中断轮之后入 input 的 assistant 消息带上它，
        // 下一轮 provider 才不会因为缺项而报错，M306）。
        let mut output = TurnOutput {
            text: String::new(),
            reasoning: entry.reasoning,
            reasoning_deltas: Vec::new(),
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
        };
        // 分片产出：思考分片先于正文（与真 provider 的事件序一致，design §3），逐片即时转发
        // （M369 真流式）。`chunk_delay_ms` 给每段间隔加上可中断的节拍——停止请求在间隔里被
        // 问到即收流，**已产出的分片保留**（在途停止）。默认 0 时无间隔、也无中断探测
        // （没有窗口可停），整脚本一次产出——场景 88 的 `delay_ms` 形态即靠这条保持原状。
        let reasoning_chunks = entry.reasoning_chunks.clone();
        for (index, chunk) in reasoning_chunks.iter().enumerate() {
            output.reasoning_deltas.push(chunk.clone());
            sink.reasoning_delta(chunk);
            if index + 1 < reasoning_chunks.len() && !chunk_gap(entry.chunk_delay_ms, sink) {
                return output;
            }
        }
        for (index, chunk) in chunks.iter().enumerate() {
            output.text.push_str(chunk);
            sink.text_delta(chunk);
            if index + 1 < chunks.len() && !chunk_gap(entry.chunk_delay_ms, sink) {
                return output;
            }
        }
        output
    }
}

/// 分片之间的可中断节拍（`chunk_delay_ms`，见模块头「逐片延迟」）：睡满间隔后问一次
/// [`StreamSink::aborted`]，翻真返回 `false`（产出到此为止，已产出的分片保留）。
/// `chunk_delay_ms == 0` 时零延迟且不做中断探测（没有窗口可停）。
fn chunk_gap(chunk_delay_ms: u64, sink: &dyn StreamSink) -> bool {
    if chunk_delay_ms == 0 {
        return true;
    }
    std::thread::sleep(std::time::Duration::from_millis(chunk_delay_ms));
    !sink.aborted()
}

/// 丢弃流式增量的 sink：**压缩调用**用（[`super::turn::compact_now`]）——摘要不逐片进面板
/// （它只在整个压缩完成后作为 `compact` 事件与面板消息整段落盘），也不需要参与在途停止
/// （压缩是一次汇总调用，中断语义不覆盖它）。
pub struct DiscardStreamSink;

impl StreamSink for DiscardStreamSink {
    fn text_delta(&self, _delta: &str) {}
    fn reasoning_delta(&self, _delta: &str) {}
    fn aborted(&self) -> bool {
        false
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
            effort: ThinkingEffort::default(),
        }
    }

    /// 单测用的流式 sink（M369）：记录收到的分片，并可按「已收到多少正文分片」翻真
    /// `aborted()`——在途停止的**确定性**驱动口，不靠 sleep 抢时序。
    #[derive(Default)]
    struct TestStream {
        text: std::sync::Mutex<Vec<String>>,
        reasoning: std::sync::Mutex<Vec<String>>,
        /// 收到这么多正文分片之后 `aborted()` 翻真（0 = 永不）。
        abort_after_text: usize,
    }

    impl TestStream {
        fn abort_after_text(n: usize) -> Self {
            Self {
                abort_after_text: n,
                ..Default::default()
            }
        }

        fn text(&self) -> Vec<String> {
            self.text.lock().unwrap().clone()
        }

        fn reasoning(&self) -> Vec<String> {
            self.reasoning.lock().unwrap().clone()
        }
    }

    impl StreamSink for TestStream {
        fn text_delta(&self, delta: &str) {
            self.text.lock().unwrap().push(delta.to_string());
        }

        fn reasoning_delta(&self, delta: &str) {
            self.reasoning.lock().unwrap().push(delta.to_string());
        }

        fn aborted(&self) -> bool {
            self.abort_after_text > 0 && self.text.lock().unwrap().len() >= self.abort_after_text
        }
    }

    #[test]
    fn mock_pops_script_in_order() {
        let mut client = MockClient::from_str(FIXTURE, "test").unwrap();
        let stream = TestStream::default();
        let first = client.complete(&request(), &stream);
        assert_eq!(first.text, "先读");
        // 真流式（M369）：分片在 `complete` 期间就转发了，不是返回后补发。
        assert_eq!(stream.text(), vec!["先".to_string(), "读".to_string()]);
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
        let second = client.complete(&request(), &TestStream::default());
        let error = second.error.expect("scripted error");
        assert!(error.context_overflow);
        let third = client.complete(&request(), &TestStream::default());
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
        // 出厂 model 必须在窗口表里，且读数是 1M（M365：默认与窗口表同源，REVIEW.md 第 8 条）
        assert_eq!(
            context_window(kimi, crate::config::DEFAULT_KIMI_MODEL),
            1_048_576
        );
        // 表内其余现役 id（256K 档）
        for model in ["kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2.6"] {
            assert_eq!(context_window(kimi, model), 262_144, "{model}");
        }
        // 退役的 kimi-k2 不在表里 ⇒ 回落 fallback（131_072，与它的历史窗口同值）
        assert_eq!(context_window(kimi, "kimi-k2"), kimi.fallback_window);
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

    /// 合成 SSE 字节流喂协议层读循环（要断言流式转发的，见 [`sse_parse_with`]）。
    fn sse_parse(bytes: &str) -> TurnOutput {
        sse_parse_with(bytes, &TestStream::default())
    }

    /// 同上，但注入指定的流式 sink——断「收到即转发」与在途停止用（M369）。
    fn sse_parse_with(bytes: &str, sink: &dyn StreamSink) -> TurnOutput {
        parse_sse_reader(
            std::io::Cursor::new(bytes.as_bytes()),
            preset(&HarnessProvider::Deepseek),
            sink,
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

    // ---- M362：展示侧思考分片（不改回放路径）----

    /// 展示侧分片来自两种流事件（deepseek `reasoning_text.delta` / kimi
    /// `reasoning_summary_text.delta`），**只进 `reasoning_deltas`**；同一轮里回放项仍只由
    /// `collect_output_item` 产出、原文不动。判据落在两条通道各归各位：分片拼出的文本在
    /// `reasoning_deltas`，回放项在 `reasoning` 且带 `encrypted_content`。
    #[test]
    fn sse_collects_reasoning_deltas_without_touching_replay_item() {
        let sse = format!(
            r#"event: response.reasoning_text.delta
data: {{"delta":"先看"}}

event: response.reasoning_text.delta
data: {{"delta":"再答。"}}

event: response.output_item.done
data: {{"item":{DEEPSEEK_REASONING_ITEM}}}

event: response.completed
data: {{"response":{{"output":[{DEEPSEEK_REASONING_ITEM}],"usage":{{"input_tokens":10,"output_tokens":2}}}}}}

"#
        );
        let output = sse_parse(&sse);
        assert_eq!(output.reasoning_deltas, vec!["先看", "再答。"]);
        // 回放项照旧：分片通道与 item 通道互不借道。
        let reasoning = output.reasoning.expect("回放项仍应被捕获");
        assert_eq!(
            reasoning["encrypted_content"],
            "891a103a-5fff-47b2-899d-573104b0d161-0"
        );
        assert_eq!(
            reasoning["content"][0]["text"],
            "用户问的是 2+2。不需要工具。"
        );
        // 分片不进正文、不进回放项内容。
        assert_eq!(output.text, "");
    }

    /// kimi 侧事件名（`response.reasoning_summary_text.delta`）同样收进展示分片通道。
    #[test]
    fn sse_collects_kimi_reasoning_summary_deltas() {
        let sse = r#"event: response.reasoning_summary_text.delta
data: {"delta":"第一步。"}

event: response.reasoning_summary_text.delta
data: {"delta":"第二步。"}

"#;
        let output = sse_parse(sse);
        assert_eq!(output.reasoning_deltas, vec!["第一步。", "第二步。"]);
        assert!(output.reasoning.is_none(), "摘要分片不是回放项");
    }

    /// mock：fixture 的 `reasoning_chunks` 进展示分片通道，`reasoning` 进回放通道；
    /// 收到的档位逐次记录（M362 档位断言的机读口）。
    #[test]
    fn mock_records_effort_and_passes_reasoning_chunks() {
        let script = r#"{"responses": [
            {"text": "答。",
             "reasoning": {"type":"reasoning","id":"rs_1","content":[{"type":"reasoning_text","text":"回放用思考"}]},
             "reasoning_chunks": ["先想", "再答"],
             "usage": {"input_tokens": 10, "output_tokens": 2}},
            {"text": "又答。"}
        ]}"#;
        let mut client = MockClient::from_str(script, "reasoning-chunks").unwrap();
        let mut req = request();
        req.effort = ThinkingEffort::Max;
        let stream = TestStream::default();
        let first = client.complete(&req, &stream);
        assert_eq!(first.reasoning_deltas, vec!["先想", "再答"]);
        // 思考分片也即时转发（M369），且转发与记录一致。
        assert_eq!(
            stream.reasoning(),
            vec!["先想".to_string(), "再答".to_string()]
        );
        assert_eq!(first.reasoning.as_ref().unwrap()["id"], "rs_1");
        req.effort = ThinkingEffort::Low;
        let _ = client.complete(&req, &TestStream::default());
        // 逐次记录（含耗尽那一次也无妨——这里两次都在脚本内）。
        assert_eq!(
            client.received_efforts(),
            &[ThinkingEffort::Max, ThinkingEffort::Low]
        );
    }

    /// 只给 `reasoning`（老 fixture 形态）时 `reasoning_deltas` 为空——展示侧整段提取由
    /// `turn` 负责（[`super::thinking::reasoning_text`]），mock 不越权改写成单分片。
    #[test]
    fn mock_without_reasoning_chunks_leaves_deltas_empty() {
        let mut client = MockClient::from_str(FIXTURE, "no-chunks").unwrap();
        let first = client.complete(&request(), &TestStream::default());
        assert!(first.reasoning_deltas.is_empty());
        assert!(first.reasoning.is_some());
    }

    // ---- M369：真流式（收到即转发）与在途停止 ----
    //
    // 判据的区分度（REVIEW.md 第 1 条）：改动前 `complete` 返回时流式 sink 一个分片都收不到
    //（增量被攒进 `TurnOutput` 的 Vec，返回后由 `turn` 一次性补发）——下面「sink 收到的分片」
    // 类断言在旧实现上必然是空表，因此它们真的在判「即时转发」而不是「分片最终都在」。

    /// SSE 读循环收到正文 delta 即经 sink 转发（不是攒到读完再发）；`TurnOutput` 仍是全文。
    #[test]
    fn sse_forwards_text_deltas_as_they_arrive() {
        let sse = r#"event: response.output_text.delta
data: {"delta":"第一片。"}

event: response.output_text.delta
data: {"delta":"第二片。"}

event: response.output_text.delta
data: {"delta":"第三片。"}

event: response.completed
data: {"response":{"output":[{"type":"message","content":[{"type":"output_text","text":"第一片。第二片。第三片。"}]}],"usage":{"input_tokens":10,"output_tokens":3}}}

"#;
        let stream = TestStream::default();
        let output = sse_parse_with(sse, &stream);
        let expected = vec![
            "第一片。".to_string(),
            "第二片。".to_string(),
            "第三片。".to_string(),
        ];
        // 逐片转发（不是一次性）+ 全文仍是拼接结果（快照 / JSONL 用全文）。
        assert_eq!(stream.text(), expected);
        assert_eq!(output.text, "第一片。第二片。第三片。");
    }

    /// 思考分片（两家事件名）同样即时转发，且不进正文通道。
    #[test]
    fn sse_forwards_reasoning_deltas_as_they_arrive() {
        let sse = r#"event: response.reasoning_text.delta
data: {"delta":"先看"}

event: response.reasoning_summary_text.delta
data: {"delta":"再答。"}

"#;
        let stream = TestStream::default();
        let output = sse_parse_with(sse, &stream);
        assert_eq!(
            stream.reasoning(),
            vec!["先看".to_string(), "再答。".to_string()]
        );
        assert!(stream.text().is_empty(), "思考分片不得进正文通道");
        assert_eq!(output.text, "");
    }

    /// 在途停止（M369）：sink 翻真后读循环收流——**已产出的分片保留**、未到达的不再等。
    /// 判据的区分度：旧实现会读完整个流（三片全在、usage 也在），本用例断言它们不在。
    #[test]
    fn sse_stops_midstream_on_abort_and_keeps_produced_text() {
        let sse = r#"event: response.output_text.delta
data: {"delta":"第一片。"}

event: response.output_text.delta
data: {"delta":"第二片。"}

event: response.output_text.delta
data: {"delta":"第三片。"}

event: response.completed
data: {"response":{"output":[],"usage":{"input_tokens":10,"output_tokens":3}}}

"#;
        // 收到 1 个正文分片之后报「已停止」：读循环在第一片后收口。
        let stream = TestStream::abort_after_text(1);
        let output = sse_parse_with(sse, &stream);
        assert_eq!(output.text, "第一片。", "已产出的分片保留");
        assert_eq!(stream.text(), vec!["第一片。".to_string()]);
        // 收流后不再处理后续事件：终态的 usage 不落地（incomplete 响应语义——不是错误）。
        assert!(output.usage.is_none());
        assert!(output.error.is_none());
    }

    /// mock 的逐片延迟与在途停止：`chunk_delay_ms` 给分片之间加上可中断的节拍，停止请求在
    /// 间隔里被问到即收流，已产出分片保留；回放项 / 调用 / 用量仍随返回值带回（M306：中断轮
    /// 之后入 input 的 assistant 消息仍带 reasoning 项）。
    #[test]
    fn mock_chunk_delay_streams_partially_and_abort_keeps_produced() {
        let script = r#"{"responses": [
            {"text": "第一片。第二片。第三片。",
             "chunks": ["第一片。", "第二片。", "第三片。"],
             "reasoning": {"type":"reasoning","id":"rs_1","encrypted_content":"enc"},
             "tool_calls": [{"id": "c1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}],
             "usage": {"input_tokens": 10, "output_tokens": 3},
             "chunk_delay_ms": 1}
        ]}"#;
        let mut client = MockClient::from_str(script, "stream-abort").unwrap();
        let stream = TestStream::abort_after_text(1);
        let output = client.complete(&request(), &stream);
        assert_eq!(output.text, "第一片。", "已产出的分片保留");
        assert_eq!(stream.text(), vec!["第一片。".to_string()]);
        // 分片之外的非流式字段不受影响（尽力带回）。
        assert_eq!(output.reasoning.as_ref().unwrap()["id"], "rs_1");
        assert_eq!(output.calls.len(), 1);
        assert!(output.usage.is_some());
        assert!(output.error.is_none());
    }

    /// 回归（场景 88 的形态）：没有 `chunk_delay_ms` 时**不做**在途中断探测——整脚本一次产出，
    /// 停止请求留给 `turn` 在 `complete` 返回后的检查点判（`delay_ms` 窗口就是这么用的）。
    /// 若哪天把「无间隔也探测」改回来，这条会红。
    #[test]
    fn mock_without_chunk_delay_produces_all_chunks_despite_abort_flag() {
        let script = r#"{"responses": [
            {"text": "第一片。第二片。第三片。",
             "chunks": ["第一片。", "第二片。", "第三片。"],
             "usage": {"input_tokens": 10, "output_tokens": 3}}
        ]}"#;
        let mut client = MockClient::from_str(script, "no-gap").unwrap();
        // sink 一直报「已停止」——但没有间隔就无从探测，产出照常走完。
        let stream = TestStream::abort_after_text(1);
        let output = client.complete(&request(), &stream);
        assert_eq!(output.text, "第一片。第二片。第三片。");
        assert_eq!(stream.text().len(), 3);
    }
}
