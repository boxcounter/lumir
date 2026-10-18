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
//! 脚本是**会话级**的——同一会话的后续轮次接着上一轮往下弹（游标存在 `Session` 上，见
//! [`super::turn::run_turn`] 与 [`wrap_cursor`]），弹尽后 wrap 回 `responses[0]`（单条 response
//! 的 fixture 因此每轮都重放同一条）。
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
//!       "usage": {"input_tokens": 1200, "cached_tokens": 300, "output_tokens": 40, "cache_write_tokens": 900},  // 可选（cache_write_tokens 为 M443 新增，缺键即 0）
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
//! **它是可中断的**：片间隔改为小步睡眠（每 25ms 一问 [`StreamSink::aborted`]，M374）——
//! 间隔内点停止亚秒级停产出（旧实现睡满整个间隔才问一次，最长等一个完整的
//! `chunk_delay_ms`）。已产出的分片保留（中断语义 = 「不再继续」）。与 `delay_ms` 的分工：
//! 后者是「响应尚未开始」的窗口，**不可中断**（一次睡到底；验收场景 88 依赖「停止请求
//! 在返回后才被检查点判到、产出照常保留」这条语义），前者是「流式进行中」的窗口。
//!
//! # 真流式与在途停止（M369）
//!
//! 解析层不再把增量攒起来等整条响应读完再事后补发——收到即经 [`StreamSink`] 转发
//! （真 provider 走 SSE 读循环，mock 走分片产出循环），前端因此逐字上屏。
//! [`TurnOutput::text`] 仍是全文（快照与 JSONL 用它）；分片本身不留档（转发即消费）。
//!
//! `StreamSink::aborted()` 把「用户点了停止」接进读循环：流式期间点停止即收流，**已产出的
//! 内容保留在 `TurnOutput` 里**，由 [`super::turn`] 收口（标注「已停止」）。停止的即时性
//!（M374）：SSE 读循环把读端搬到独立线程、消费端按小步超时轮询——流停滞的静默窗口
//!（思考期数秒到十秒零事件）里点停止，亚秒级被问到标志即收流，不再等下一条事件到达；
//! mock 的片间隔同改为可中断小步睡眠。两处边界如实登记：① `delay_ms` 与 HTTP 首字节等待
//!（`.send()`）期间的停止仍要等到睡眠 / 响应头到达才生效（与改动前一致）；② 流中中断时 reasoning 回放项通常
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
//! **回放形状归一（M464，2026-10-12）**：`store:false` 下**剥掉 reasoning 项的 `id`**，改用
//! `{type:"reasoning", summary, [content], encrypted_content}` 回放。`id`（`rs_*`）在
//! store:false 下不可解析，重放它属非标用法。该「id 展开计账」的头号假设经 M464 三发对照
//! 探测**未被支持**——剥 id 不改变判定，**reasoning 项本身的在场**才是端点 400 的膨胀源
//! （机制未完全钉死，等长替换第四发未跑）；结论与证据的 canonical 居所是
//! `openspec/specs/harness/spec.md` 的「已知边界」注与 `test-results/m464-probe/`，此处只留指针。
//! 本次归一按「对齐官方 store:false 回放形状」独立成立——靶子两处：OpenAI 的 store:false
//! 官方回放模式（请求 `include:["reasoning.encrypted_content"]`、重放
//! `{summary, encrypted_content}` 不带 id）与 Kimi Code 内嵌的 responses base
//! （`openai-responses/lower.ts` 的 `{summary, type, encrypted_content}` 无 id；请求侧
//! `normalizeOpenAIResponsesReasoning` 把 `reasoning:{effort,summary:"auto"}` 与
//! `include:["reasoning.encrypted_content"]` 一并写入）。归一落在 [`normalize_reasoning_item`]
//! ——响应捕获（[`collect_output_item`] / mock）与会话 input 入口（[`super::session`]）都经它，
//! 故「任何路径产物」（wire 请求 input、会话 JSONL 留存）中不出现 `id` 字段。`content`
//! （deepseek 的 `reasoning_text` 明文载体）保留：kimi 用 `summary`、deepseek 用 `content`，
//! 删任一都会破坏对应 provider 的重放（M306）。
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
use crate::config::{AttachmentNamingTarget, HarnessConfig, HarnessProvider, TitleTarget, WireApi};

use super::events::StreamSink;
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
    /// 缓存写入 tokens（kimi K3 的缓存写**单独计费**的那部分）。provider 不提供该字段时
    /// 恒 0（deepseek 即此）——**0 是「不提供」与「确实没写」的同一读数**，消费侧因此
    /// 按「为 0 即不展示」处理（面板气泡的缓存写入行，design §5.2）。
    pub cache_write_tokens: u64,
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
///
/// M463 起带**错误路径可观察性**字段：非 2xx 的 HTTP 错误把状态码 / 原始响应 body
/// （截断）/ 服务端 request id 一并带出，供 llm_error 记录落盘（诊断「服务端为什么拒」
/// 时不必再靠猜）。这些字段对网络层失败 / 脚本化错误 / 流内错误恒为空（它们没有 HTTP 面）。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TurnError {
    pub code: String,
    pub message: String,
    /// 命中 provider 预设的上下文超限特征串。
    pub context_overflow: bool,
    /// HTTP 状态码（非 2xx 才有）。
    pub http_status: Option<u16>,
    /// 原始响应 body（已按 [`ERROR_BODY_MAX_CHARS`] 截断）。
    pub raw_body: Option<String>,
    /// body 是否被 [`ERROR_BODY_MAX_CHARS`] 截断（截断时 raw_body 是前缀）。
    pub body_truncated: bool,
    /// 服务端 request id（响应头优先，body 兜底；都没有则 None）。
    pub request_id: Option<String>,
}

impl TurnError {
    /// 无 HTTP 面的错误（网络层 / 脚本化 / 流内）：新字段全空。仅控制流用的三元组。
    pub fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        context_overflow: bool,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            context_overflow,
            ..Default::default()
        }
    }
}

/// 翻译层诊断（change add-harness-chat-completions-dialect）：**wire 不可推导**的翻译期事件
/// ——翻译时丢弃了什么、为什么丢了。由调用侧在本轮 `complete` 之后经
/// [`LlmClient::take_wire_diagnostics`] 取走并落 sidecar 记录（`kind: "wire_diagnostic"`）。
///
/// 首个（也是 v1 唯一）来源是 chat 方言的悬空 `function_call`（恢复边界：有调用无输出，
/// design D4）：丢弃是唯一不必然 400 的处置，但「历史里有一条调用被静默丢掉」必须可审计。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WireDiagnostic {
    /// 机器可读的稳定 code（`dangling_function_call` / `orphan_function_call_output`）。
    pub code: &'static str,
    /// 涉事调用的 call_id（无调用语义的诊断留空串）。
    pub call_id: String,
    /// 人读说明（进 sidecar，不进面板）。
    pub message: String,
}

/// 错误 body 的留存上限（字符，非字节——按字符截断不会切坏 UTF-8）。巨型 body（HTML 网关页 /
/// 大段 JSON）截到该上限，防止一条错误记录把会话 JSONL 撑爆；截断时置 `body_truncated`。
const ERROR_BODY_MAX_CHARS: usize = 4096;

/// 取服务端 request id 的响应头候选名（各家命名不一，按序取第一个在场的；都缺则回 None）。
/// 响应头之外还在错误 body 里找（[`parse_request_id`]）——两条路都要，免得取决于哪家网关。
const REQUEST_ID_HEADERS: &[&str] = &[
    "x-request-id",
    "request-id",
    "x-msh-request-id",
    "x-trace-id",
    "trace-id",
];

/// 按 [`ERROR_BODY_MAX_CHARS`] 截断错误 body，返回 (截断后的文本, 是否截断过)。
fn truncate_error_body(text: &str) -> (String, bool) {
    if text.chars().count() <= ERROR_BODY_MAX_CHARS {
        return (text.to_string(), false);
    }
    (text.chars().take(ERROR_BODY_MAX_CHARS).collect(), true)
}

/// 从响应头取 request id（候选名见 [`REQUEST_ID_HEADERS`]）。
fn request_id_from_headers(headers: &reqwest::header::HeaderMap) -> Option<String> {
    REQUEST_ID_HEADERS.iter().find_map(|name| {
        headers
            .get(*name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    })
}

/// 从错误 body 的 JSON 里取 request id（顶层 `request_id` 或 `error.request_id`，两家常见形态）。
fn parse_request_id(text: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    ["request_id", "request-id"].iter().find_map(|key| {
        value
            .get(*key)
            .or_else(|| value.get("error").and_then(|e| e.get(*key)))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    })
}

/// 非 2xx 响应 → [`TurnError`]（含 wire 面字段）。抽成纯函数，便于单测（不必起 HTTP 服务）。
fn http_error_turn_error(
    preset: &ProviderPreset,
    status: u16,
    header_request_id: Option<String>,
    text: &str,
) -> TurnError {
    // body 先按上限截断（`raw_body` / `body_truncated`）：兜底 message 复用**同一份限长结果**
    // ——巨型 HTML 网关页不得靠 message 绕过限长（message 会进 llm_error 记录与 SSE error
    // 事件）；截断时尾部加省略号，让读者知道被裁过。JSON 解析仍用完整 `text`（截断会切坏 JSON）。
    let (raw_body, body_truncated) = truncate_error_body(text);
    let (code, message) = parse_error_body(text).unwrap_or_else(|| {
        let ellipsis = if body_truncated { "…" } else { "" };
        (
            "harness_http_error".to_string(),
            format!("HTTP {status}: {raw_body}{ellipsis}"),
        )
    });
    TurnError {
        context_overflow: is_overflow(preset, &code, &message),
        code,
        message,
        http_status: Some(status),
        raw_body: Some(raw_body),
        body_truncated,
        request_id: header_request_id.or_else(|| parse_request_id(text)),
    }
}

/// provider 预设表（design §11 双预设）：base_url 默认、超限特征串。
///
/// M373 起窗口表 / 能力表退役：模型清单与每模型 effort / window 声明归配置 schema
/// （`HarnessProviderConfig.models`）。M381 起（Alex 终裁「彻底不使用内置表」）预设表
/// 连出厂 model 字段也移除——模型 id 严格只来自配置，本表只剩网络层参数（base_url）
/// 与协议层参数（store / 超限特征串）。
pub struct ProviderPreset {
    /// base_url 默认值（未核实，验收批对真 API 验证；配置可覆盖）。
    pub base_url: &'static str,
    /// 上下文超限错误特征串（小写子串匹配 code+message）。
    pub overflow_indicators: &'static [&'static str],
}

/// kimi 预设（[官方 Responses schema](https://platform.kimi.ai/docs/api/responses)）：
/// store 支持 ⇒ 显式 `store:false`；usage 含 `cache_write_tokens`（M443 起进留存与面板，
/// 解析路径见 [`collect_final_response`] 的注释）。
const KIMI_PRESET: ProviderPreset = ProviderPreset {
    base_url: "https://api.moonshot.cn/v1", // 未核实（验收批对真 API 验证；config 可覆盖）
    overflow_indicators: &[
        "context_length_exceeded",
        "maximum context length",
        "context window",
        // M463：Kimi coding 端点（`api.kimi.com/coding/v1`）的超限话术与平台端点不同
        // ——实测原文「Your request exceeded k3-256k model token limit: 262144」，
        // 上面三条一条都不命中，`context_overflow` 因此恒 false，spec「超限兜底」的
        // 自动压缩+重试对该端点从不触发（回合直接终态报错）。补 "token limit" 覆盖该形态。
        "token limit",
        // Chat Completions 方言的两条超限话术（change add-harness-chat-completions-dialect，
        // design D7）：`total message size N exceeds limit 2097152`（2 MB 消息体上限——能达到
        // 该体量的上下文早已超出窗口，压缩重试是正确处置）与真超窗的 401 族文案
        // `supports only 256k context`（官方处置就是 compact 或换模型）。
        "total message size",
        "supports only 256k context",
    ],
};

/// deepseek 预设（[官方 Responses 文档](https://api-docs.deepseek.com/guides/responses_api/)）：
/// 无状态（恒 `store:false`）；超窗请求返回 400；不支持参数静默忽略。
const DEEPSEEK_PRESET: ProviderPreset = ProviderPreset {
    base_url: "https://api.deepseek.com",
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

/// 判定错误是否上下文超限（按 provider 特征串）。
fn is_overflow(preset: &ProviderPreset, code: &str, message: &str) -> bool {
    let haystack = format!("{code} {message}").to_lowercase();
    preset
        .overflow_indicators
        .iter()
        .any(|needle| haystack.contains(needle))
}

/// mock 的 overflow 判定：脚本要能写出**任一家 provider** 的方言（fixture 与实现同 PR，
/// 验的就是「认不认这条话术」），故对全部 provider 预设取**并集**。旧实现是一份硬编码的
/// 两串列表（第二事实源，REVIEW.md 「同一语义两处真源」条），且漏掉了 M463 给 kimi 补的 coding 端点话术
/// 「model token limit」——那条形态在 mock 驱动下因此永远判不出 overflow。
fn is_overflow_any(code: &str, message: &str) -> bool {
    [&KIMI_PRESET, &DEEPSEEK_PRESET]
        .iter()
        .any(|preset| is_overflow(preset, code, message))
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

    /// 本 client **实际会发**的请求体字节数（含 wire 展开后的尺寸；M463 发送量计量：
    /// 发送点记录 `llm_request.request_bytes`，让「这次请求多大」不再需要按字节比外推）。
    /// 缺省 None = 该实现没有真实 HTTP body（mock 只弹脚本）——记录侧据此省略该字段。
    fn wire_body_bytes(&self, _request: &Request) -> Option<u64> {
        None
    }

    /// mock provider 的 fixture 路径（留存 `llm_response.mock_fixture` 的因果链字段：
    /// 哪份 fixture 驱动了这一轮）。真 provider 无此概念，缺省 None。
    fn fixture_source(&self) -> Option<&str> {
        None
    }

    /// 本轮请求是否会带 `include:["reasoning.encrypted_content"]`（M464 密文回放模式的
    /// 前提）：留存 `llm_response.reasoning_encrypted.requested` 用——与 `wire_body` 里
    /// 实际写 `include` 的条件同一份布尔（client 构建时冻结），MUST NOT 在记录侧按 config
    /// 重算一套（REVIEW.md 「同一语义两处真源」条）。缺省 false = 该实现不发（mock）。
    fn requests_encrypted_reasoning(&self) -> bool {
        false
    }

    /// mock：脚本原始条数（会话级游标的模；M456）。真 provider 无此概念，缺省 None ⇒
    /// 调用方对游标推进一步不落（[`super::turn`] 的 `run_turn` 据此只对 mock 生效）。
    fn mock_script_len(&self) -> Option<usize> {
        None
    }

    /// mock：本 client 实例累计弹出的脚本条数（会话游标按 `start + consumed` 推进）。
    fn mock_consumed(&self) -> usize {
        0
    }

    /// mock：本会话里由**外部消费者**（子运行）消费掉的脚本条数（design §18）。父客户端的
    /// 会话游标回写 = `mock_consumed() + external_consumed()`；真 provider 恒 0。
    fn external_consumed(&self) -> usize {
        0
    }

    /// mock：把脚本游标前移 `n` 条（父客户端跳过子运行预分配的连续区间，design §18 的
    /// 「并行时按 run 预分配区段」）。真 provider no-op —— 它没有可跳的脚本。
    fn skip(&mut self, _n: usize) {}

    /// 本 client **实际发往 provider** 的模型 id（调用级覆盖生效后的值）：发送点留存
    /// `llm_request.model` 用它，MUST NOT 另按 config 重算一份（REVIEW.md「同一语义两处
    /// 真源」条：覆盖参数与记录值不能各说各的）。mock 没有模型维度，缺省 None ⇒ 记录侧
    /// 沿用 [`active_model`] 的「mock 借壳」口径。
    fn model(&self) -> Option<&str> {
        None
    }

    /// 本轮翻译期诊断（[`WireDiagnostic`]）：翻译层丢弃了什么东西（chat 方言的悬空调用等）。
    /// 调用侧在本轮 `complete` 之后取走并落 sidecar。缺省空表 = 该实现没有翻译层（Responses
    /// 直接发 canonical 项）或本轮无诊断。
    fn take_wire_diagnostics(&mut self) -> Vec<WireDiagnostic> {
        Vec::new()
    }
}

/// 会话级 mock 游标推进（M456）：`start` 是本轮起点、`consumed` 是本轮弹出的条数，
/// 按脚本长度 `len` 取模——耗尽即 wrap 回 0。`len == 0` 退化为 0。
pub fn wrap_cursor(start: usize, consumed: usize, len: usize) -> usize {
    if len == 0 {
        0
    } else {
        (start + consumed) % len
    }
}

/// 会话请求的 HTTP 超时（既有口径：一轮可能流式几分钟）。
const SESSION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);
/// 命名调用的独立超时（change add-session-auto-naming，design D8：便宜档的调用形态之一，
/// **不复用**会话请求的 300 秒——超时即 `harness_title_failed`，失败静默）。
pub const TITLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// reqwest blocking client 的唯一构造口（会话请求与命名调用共用 TLS 口径，只有超时不同）。
fn http_client(timeout: std::time::Duration) -> Result<reqwest::blocking::Client, CommandError> {
    reqwest::blocking::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| {
            CommandError::new("harness_http_failed", format!("{e}")).param("reason", e.to_string())
        })
}

/// 按配置装配 client：mock ⇒ fixture 驱动；kimi / deepseek ⇒ reqwest blocking。
/// `vault_id` 供 wire 展开（`attachments::expand_image_refs`）解析 harness 附件落点——
/// 会话侧 input 项恒为 `lumir-attachment://` 引用，发送前在 client 内就地展开为
/// data URL（design §4.3：真 client 与 mock 同一条展开函数）。
pub fn client(config: &HarnessConfig, vault_id: &str) -> Result<Box<dyn LlmClient>, CommandError> {
    client_at(config, vault_id, 0, None)
}

/// [`client`] 的会话游标形态（M456）：`mock_start` 是**会话级 mock 游标**的起点，mock 路径
/// 据此接着同一会话的上一轮往下弹（[`MockClient::with_start`]），真 provider 忽略它。
/// 生产装配点只有 [`super::turn::run_turn`]；其余调用方（含真 provider 冒烟测试）走 `client`
/// ——它们没有会话游标，语义即「从脚本头开始」。
///
/// `model_override`（change add-harness-subagents design §11）：调用级模型覆盖，空串 / `None`
/// 等价于不覆盖。覆盖值必须是该 provider `models` 清单里已声明的 id——**声明校验在调用侧**
/// （子运行 / cron），本函数只负责装配；未声明的 id 会照旧发出去并被 provider 拒绝，这是
/// 「调用非法拒绝」与「定义非法回落 inherit」两条上层语义的分界。
pub fn client_at(
    config: &HarnessConfig,
    vault_id: &str,
    mock_start: usize,
    model_override: Option<&str>,
) -> Result<Box<dyn LlmClient>, CommandError> {
    match config.provider {
        HarnessProvider::Mock => {
            let fixture = config.providers.mock.fixture.clone().ok_or_else(|| {
                CommandError::new(
                    "harness_fixture_missing",
                    "provider 为 mock 但 harness.providers.mock.fixture 未配置",
                )
            })?;
            MockClient::from_file(std::path::Path::new(&fixture)).map(|c| {
                Box::new(c.for_vault(vault_id).with_start(mock_start)) as Box<dyn LlmClient>
            })
        }
        HarnessProvider::Kimi | HarnessProvider::Deepseek => {
            let (api_key, configured_model, base_url) = match config.provider {
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
            // 调用级覆盖只接**非空**值：空串是「未覆盖」的等价输入（上层把未配置归一为
            // None，这里再挡一次手写空串，免得把空 model 当成显式选择）。
            let model = model_override
                .map(str::trim)
                .filter(|model| !model.is_empty())
                .unwrap_or(configured_model.as_str());
            if api_key.trim().is_empty() {
                return Err(CommandError::new(
                    "harness_api_key_missing",
                    "当前 provider 的 api_key 未配置（config.json 的 harness.providers 节）",
                ));
            }
            // M381 config-only：模型 id 严格只来自配置——清单为空 / model 解析为空时
            // 在这里挡人话错误，不把空 model 发给 API（配置加载时已有 warning + 前端提示态）。
            if model.trim().is_empty() {
                let name = match config.provider {
                    HarnessProvider::Kimi => "kimi",
                    _ => "deepseek",
                };
                return Err(CommandError::new(
                    "harness_model_missing",
                    format!(
                        "当前 provider（{name}）未配置任何模型：请在 config.json 的 harness.providers.{name}.models 下逐项声明（{{\"id\", \"effort\", \"window\"}}）"
                    ),
                ));
            }
            let preset = preset(&config.provider);
            let base = base_url.unwrap_or(preset.base_url).trim_end_matches('/');
            let http = http_client(SESSION_TIMEOUT)?;
            // 方言选择（change add-harness-chat-completions-dialect，design D1）：配置显式
            // 声明、无嗅探。`config.wire_api()` 是唯一读数（deepseek 的 chat 档在校验期已回落，
            // 因此这里只可能是 kimi 命中 chat 分支）。
            Ok(network_client(
                config,
                config.provider,
                model,
                api_key,
                base,
                config.wire_api(),
                vault_id,
                http,
                preset,
            ))
        }
    }
}

/// 网络 provider 的 client 装配（三个装配口共用一份：会话 [`client_at`] / 会话自动命名的
/// [`title_client`] / 图片语义命名的 [`naming_client`]）：方言、effort 能力、store 口径与
/// client 构造全在这里，MUST NOT 各拼一套（REVIEW.md「同一语义两处真源」条）。
///
/// 调用方负责「api_key / model 非空」的前置校验（各自的错误文案不同），这里只做装配；
/// `http` 由调用方按自己的超时口径构造（会话 300 秒 / 命名调用 20 秒）。
#[allow(clippy::too_many_arguments)]
fn network_client(
    config: &HarnessConfig,
    provider: HarnessProvider,
    model: &str,
    api_key: &str,
    base: &str,
    wire_api: WireApi,
    vault_id: &str,
    http: reqwest::blocking::Client,
    preset: &'static ProviderPreset,
) -> Box<dyn LlmClient> {
    // 思考程度能力按 provider + model 从配置 schema 现算（M373：`models` 的逐模型声明，
    // config-only——M381 起缺省不回落内置表）——client 构建时冻结进 client。
    let effort_supported = config.effort_supported(&provider, model);
    match wire_api {
        WireApi::ChatCompletions => Box::new(ChatCompletionsClient {
            http,
            endpoint: format!("{base}/chat/completions"),
            api_key: api_key.to_string(),
            model: model.to_string(),
            effort_supported,
            vault_id: vault_id.to_string(),
            preset,
            diagnostics: Vec::new(),
        }),
        WireApi::Responses => Box::new(ResponsesClient {
            http,
            endpoint: format!("{base}/responses"),
            api_key: api_key.to_string(),
            model: model.to_string(),
            // store:false 只由**该 provider** 决定（kimi 支持该字段；deepseek 不发）。
            store_false: matches!(provider, HarnessProvider::Kimi),
            effort_supported,
            vault_id: vault_id.to_string(),
            preset,
        }),
    }
}

/// 当前生效的模型名：ctx% 的窗口查表与思考档位能力判定都用它（**单一来源**——两处各写一份
/// match 必然漂移，REVIEW.md 「同一语义两处真源」条）。mock 档没有自己的模型，沿用 kimi 侧读数
///（与 [`preset`] 对 mock 回落 deepseek 预设是同一「mock 只借壳」的口径）。
pub fn active_model(config: &HarnessConfig) -> &str {
    match config.provider {
        HarnessProvider::Kimi => &config.providers.kimi.model,
        HarnessProvider::Deepseek => &config.providers.deepseek.model,
        HarnessProvider::Mock => &config.providers.kimi.model,
    }
}

/// 命名调用的 client（change add-session-auto-naming，design D8 / D12）：**只**消费
/// [`HarnessConfig::title_target`] 解析出的五字段——MUST NOT 回读会话 provider 的
/// `api_key` / `base_url` / 模型 / 方言（设计不变量 8）。
///
/// 两条腿：
/// - mock：独立 `titles` 队列（`mock_start` = 会话级标题游标；缺失 / 空 / 弹尽 → 空正文 →
///   解析为 `harness_title_invalid`）。既有 fixture 没有 `titles` 数组 ⇒ 空队列，行为零改动。
/// - 网络 provider：独立 20 秒超时（[`TITLE_TIMEOUT`]）；思考档能力按该 provider 的 models
///   声明现算。
pub fn title_client(
    config: &HarnessConfig,
    target: &TitleTarget,
    vault_id: &str,
    mock_start: usize,
) -> Result<Box<dyn LlmClient>, CommandError> {
    match target.provider {
        HarnessProvider::Mock => {
            let fixture = config.providers.mock.fixture.clone().ok_or_else(|| {
                CommandError::new(
                    "harness_fixture_missing",
                    "provider 为 mock 但 harness.providers.mock.fixture 未配置",
                )
            })?;
            MockClient::titles_from_file(std::path::Path::new(&fixture)).map(|client| {
                Box::new(client.for_vault(vault_id).with_title_start(mock_start))
                    as Box<dyn LlmClient>
            })
        }
        HarnessProvider::Kimi | HarnessProvider::Deepseek => {
            let name = target.provider.as_str();
            if target.api_key.trim().is_empty() {
                return Err(CommandError::new(
                    "harness_api_key_missing",
                    format!(
                        "命名调用所用 provider（{name}）的 api_key 未配置（config.json 的 harness.providers 节）"
                    ),
                )
                .param("provider", name));
            }
            if target.model.trim().is_empty() {
                return Err(CommandError::new(
                    "harness_model_missing",
                    format!(
                        "命名调用所用 provider（{name}）未配置任何模型：请在 config.json 的 harness.providers.{name}.models 下逐项声明"
                    ),
                )
                .param("provider", name));
            }
            let preset = preset(&target.provider);
            let base = target
                .base_url
                .as_deref()
                .unwrap_or(preset.base_url)
                .trim_end_matches('/');
            let http = http_client(TITLE_TIMEOUT)?;
            Ok(network_client(
                config,
                target.provider,
                &target.model,
                &target.api_key,
                base,
                target.wire_api,
                vault_id,
                http,
                preset,
            ))
        }
    }
}

/// 图片语义命名的 client（change add-semantic-image-naming，design §4；2026-10-18 配置面重塑
/// 后与 [`title_client`] 同形）：**只**消费 [`HarnessConfig::attachment_naming_target`] 解析出的
/// 五字段——MUST NOT 回读会话 provider 的 `api_key` / `base_url` / 模型 / 方言（与会话自动命名
/// 同一不变量：五字段同出一个 provider 条目）。
///
/// 与会话 / 标题调用共用 [`network_client`] 的装配（方言、effort、store 口径），差别只有：
/// - 独立 20 秒超时（[`TITLE_TIMEOUT`] 同一档：一次性后台调用，不与会话请求共用 300 秒）；
/// - mock 走 fixture 顶层独立的 `naming` 队列（与会话 `responses`、标题 `titles` 互不错位）。
pub fn naming_client(
    config: &HarnessConfig,
    target: &AttachmentNamingTarget,
    vault_id: &str,
) -> Result<Box<dyn LlmClient>, CommandError> {
    match target.provider {
        HarnessProvider::Mock => {
            let fixture = config.providers.mock.fixture.clone().ok_or_else(|| {
                CommandError::new(
                    "harness_fixture_missing",
                    "provider 为 mock 但 harness.providers.mock.fixture 未配置",
                )
            })?;
            MockClient::naming_from_file(std::path::Path::new(&fixture))
                .map(|client| Box::new(client.for_vault(vault_id)) as Box<dyn LlmClient>)
        }
        provider @ (HarnessProvider::Kimi | HarnessProvider::Deepseek) => {
            let name = provider.as_str();
            if target.api_key.trim().is_empty() {
                return Err(CommandError::new(
                    "harness_api_key_missing",
                    format!(
                        "语义命名所用 provider（{name}）的 api_key 未配置（config.json 的 harness.providers 节）"
                    ),
                )
                .param("provider", name));
            }
            let preset = preset(&provider);
            let base = target
                .base_url
                .as_deref()
                .unwrap_or(preset.base_url)
                .trim_end_matches('/');
            let http = http_client(TITLE_TIMEOUT)?;
            Ok(network_client(
                config,
                provider,
                &target.model,
                &target.api_key,
                base,
                target.wire_api,
                vault_id,
                http,
                preset,
            ))
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
    /// 当前 provider + model 是否支持思考程度调节（M373）：client 构建时按配置 schema
    /// 现算冻结（`HarnessConfig::effort_supported`），请求构造直接消费这一布尔。
    effort_supported: bool,
    /// kimi 支持 `store` ⇒ 显式 false 声明不留副本；deepseek 不支持（恒 false），不发。
    store_false: bool,
    /// 当前会话作用域的 vault 稳定 id：wire 展开（附件引用 → data URL）的落点解析
    /// （design §4.3——只在发送前展开一次，JSONL 留存恒为引用形态）。
    vault_id: String,
    preset: &'static ProviderPreset,
}

impl LlmClient for ResponsesClient {
    /// 实际发往 provider 的模型 id（含调用级覆盖）：发送点留存 `llm_request.model` 的唯一读数。
    fn model(&self) -> Option<&str> {
        Some(&self.model)
    }

    /// 与 `wire_body` 写 `include:["reasoning.encrypted_content"]` 同一份条件布尔。
    fn requests_encrypted_reasoning(&self) -> bool {
        self.effort_supported
    }

    fn complete(&mut self, request: &Request, sink: &dyn StreamSink) -> TurnOutput {
        match self.complete_inner(request, sink) {
            Ok(output) => output,
            // 网络层失败 / 附件展开失败等**没有 HTTP 面**的错误：wire 面字段全空
            //（`TurnError::new`）。非 2xx 走 complete_inner 的 Ok(error) 分支，那条带
            // http_status / raw_body / request_id（M463）。
            Err(e) => TurnOutput {
                error: Some(TurnError::new(
                    e.code.clone(),
                    e.message.clone(),
                    is_overflow(self.preset, &e.code, &e.message),
                )),
                ..Default::default()
            },
        }
    }

    /// 发送量计量（M463）：构造一次**实际会发**的 body 并回其序列化字节数（含 wire 展开后的
    /// 尺寸）——发送点记录 `llm_request.request_bytes` 用它，省掉「按字节比外推」。
    /// 与 [`Self::complete_inner`] 共用 [`Self::wire_body`]：同一份构造，MUST NOT 各拼一套
    /// （REVIEW.md 「同一语义两处真源」条）。构造失败（附件缺失等）返回 None——那条路径随后以同因报错。
    fn wire_body_bytes(&self, request: &Request) -> Option<u64> {
        let body = self
            .wire_body(request)
            .map_err(|e| eprintln!("lumir: harness 发送量计量跳过（构造失败）：{e}"))
            .ok()?;
        serde_json::to_vec(&body)
            .map_err(|e| eprintln!("lumir: harness 发送量计量跳过（序列化失败）：{e}"))
            .ok()
            .map(|bytes| bytes.len() as u64)
    }
}

impl ResponsesClient {
    /// 构造实际发送体（wire 展开 + 参数），发送与发送量计量**共用这一份**（单一真源）。
    /// wire 展开（design §4.3）：input 数组里的 `lumir-attachment://` 引用就地换成 data URL
    /// ——发送前唯一的展开点，展开失败（附件缺失等）即 Err（调用侧以人话错误收口，
    /// MUST NOT 发出静默缺图的请求）。
    fn wire_body(&self, request: &Request) -> Result<serde_json::Value, CommandError> {
        let input = super::attachments::expand_image_refs(&request.input, &self.vault_id)?;
        let mut body = serde_json::json!({
            "model": self.model,
            "instructions": request.system,
            "input": input,
            "tools": request.tools,
            "tool_choice": "auto",
            "stream": true,
        });
        if self.store_false {
            body["store"] = serde_json::json!(false);
        }
        // 思考程度按档位映射（M362）：schema 声明支持时写顶层 `reasoning.effort`，
        // 不支持时不写该字段——能力判据 client 构建时已从 schema 现算（M373）。
        thinking::apply_effort(&mut body, self.effort_supported, request.effort);
        // M464：请求服务端在 reasoning item 里回传 `encrypted_content`（store:false 官方回放
        // 模式的前提——重放 `{summary, encrypted_content}` 不带 id 才有密文可还）。与
        // `reasoning` 同条件发（Kimi Code 内嵌的 responses base 把 `include` 与 `reasoning`
        // 一并写入；能力判据同 `effort_supported`）。
        if self.effort_supported {
            body["include"] = serde_json::json!(["reasoning.encrypted_content"]);
        }
        Ok(body)
    }

    fn complete_inner(
        &mut self,
        request: &Request,
        sink: &dyn StreamSink,
    ) -> Result<TurnOutput, CommandError> {
        let body = self.wire_body(request)?;
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
            // M463 错误路径可观察性：wire 面三件（状态码 / 原始 body / request id）一并带出，
            // 落 llm_error 记录。头先读——`text()` 会消费 response。
            let header_request_id = request_id_from_headers(response.headers());
            let text = response.text().unwrap_or_default();
            return Ok(TurnOutput {
                error: Some(http_error_turn_error(
                    self.preset,
                    status.as_u16(),
                    header_request_id,
                    &text,
                )),
                ..Default::default()
            });
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

/// SSE 分帧的公共读循环（两种方言共用，M562）：读端搬到独立线程、行经有界 channel，
/// 消费端按 [`ABORT_POLL_INTERVAL`] 小步超时轮询——每次超时都问一次 `sink.aborted()`，
/// 因此流停滞的静默窗口（provider 思考期数秒到十秒零事件）里点停止，亚秒级被读到即收流。
/// 旧实现阻塞在 `reader.lines()` 上，标志只在整条事件派发后才有机会问，停止因此拖到
/// 下一条数据到达（Alex 2026-10-07 现场「等几秒到十秒才停下来」）。收流后消费端丢弃
/// channel，读线程下一次 `send` 失败即退出（连带 drop 掉 reqwest Response、关闭连接）；
/// 不 join 读线程——它可能仍阻塞在下一条数据上，join 会把刚挣到的即时性又还回去
/// （它由请求的总超时兜底回收）。
///
/// 每收到一条完整事件（空行分隔）调一次 `handle(event, data)`，返回 `true` 表示终态
/// （不再读流）。事件名与 payload 的语义归各方言：Responses 用命名事件分流
///（[`parse_sse_reader`]），chat 的帧没有事件名、只有裸 `data:`（[`parse_chat_sse_reader`]）。
fn pump_sse<R: BufRead + Send + 'static>(
    reader: R,
    sink: &dyn StreamSink,
    mut handle: impl FnMut(&str, &str) -> bool,
) {
    /// 停止轮询步长：消费端等不到数据时每隔多久问一次 `aborted()`。100ms ≪ 用户可感，
    /// 同时不给正常流量增加可测的开销（有数据时走快路径，从不轮询）。
    const ABORT_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);

    let mut event = String::new();
    let mut data = String::new();
    let (tx, rx) = std::sync::mpsc::sync_channel::<std::io::Result<String>>(64);
    let reader_thread = std::thread::spawn(move || {
        for line in reader.lines() {
            // 消费端已收流（终止 / 在途停止）：send 失败即退出，Response 随之 drop。
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    loop {
        let line = match rx.recv_timeout(ABORT_POLL_INTERVAL) {
            Ok(line) => match line {
                Ok(line) => line,
                Err(_) => break, // 流中断：用已收内容收尾（不当作致命错误）
            },
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // 静默窗口：没有数据可读，正是停下来问「用户是否点了停止」的时候。
                if sink.aborted() {
                    break;
                }
                continue;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        };
        if line.is_empty() {
            let terminal = handle(&event, &data);
            event.clear();
            data.clear();
            if terminal || sink.aborted() {
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
    drop(rx);
    let _ = reader_thread;
}

/// Responses 方言的 SSE 读循环（与 transport 解耦：真 client 传响应体，单测传合成字节流），
/// 协议层行为因此可用字节流直接钉死。
fn parse_sse_reader<R: BufRead + Send + 'static>(
    reader: R,
    preset: &ProviderPreset,
    sink: &dyn StreamSink,
) -> TurnOutput {
    let mut output = TurnOutput::default();
    pump_sse(reader, sink, |event, data| {
        dispatch_event(event, data, &mut output, preset, sink);
        output.error.is_some() || terminal_state(&output)
    });
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
            let context_overflow = is_overflow(preset, &code, &message);
            output.error = Some(TurnError::new(code, message, context_overflow));
        }
        "error" => {
            let (code, message) = parse_error_value(&value)
                .unwrap_or_else(|| ("harness_stream_error".to_string(), "流式错误".to_string()));
            let context_overflow = is_overflow(preset, &code, &message);
            output.error = Some(TurnError::new(code, message, context_overflow));
        }
        _ => {}
    }
}

/// 把 provider 回传的 reasoning 项归一到**回放形状**（M464，见模块头「回放形状归一」）：
/// `{"type":"reasoning", summary, [content], [encrypted_content]}`——**剥掉 `id`**（`rs_*`
/// 在 store:false 下不可解析；重放它属非标用法）。非 reasoning 项原样返回（幂等、可无差别
/// 作用于整条 input）。
///
/// 保留 `summary`（kimi）与 `content`（deepseek 的 `reasoning_text` parts）两个明文载体——
/// 各厂各用一个，删任一都会破坏对应 provider 的重放（M306：deepseek 不回传 reasoning_text
/// 即 400）。`encrypted_content` 有（字符串）才带：这是 store:false 下让服务端免于按 id
/// 展开完整思考的密文回放体（请求侧 `include:["reasoning.encrypted_content"]` 才回传）。
/// `status` 等非回放字段一并丢弃；旧会话（记录里无 `encrypted_content`）降级为
/// 「摘要无 id」——仍比带 id 更符合官方口径。
pub fn normalize_reasoning_item(item: &serde_json::Value) -> serde_json::Value {
    if item.get("type").and_then(|t| t.as_str()) != Some("reasoning") {
        return item.clone();
    }
    let mut out = serde_json::json!({ "type": "reasoning" });
    for key in ["summary", "content"] {
        if let Some(parts) = item.get(key).filter(|v| v.is_array()) {
            out[key] = parts.clone();
        }
    }
    if let Some(blob) = item.get("encrypted_content").and_then(|v| v.as_str()) {
        out["encrypted_content"] = serde_json::Value::String(blob.to_string());
    }
    out
}

/// 输出项归集：reasoning 项归一回放形状（[`normalize_reasoning_item`]——剥 id、保
/// summary/content/encrypted_content）留作回放；message 里的 `reasoning_text` part 在 item
/// 级缺位时合成 reasoning 回放项；function_call 项记入调用表；message 项的 output_text 与
/// 流式 delta 应一致（以流式为准，这里只补 delta 漏网的文本）。
fn collect_output_item(item: &serde_json::Value, output: &mut TurnOutput) {
    match item.get("type").and_then(|t| t.as_str()) {
        Some("reasoning") => {
            if output.reasoning.is_none() {
                output.reasoning = Some(normalize_reasoning_item(item));
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
                    output.reasoning = Some(normalize_reasoning_item(&serde_json::json!({
                        "type": "reasoning",
                        "content": reasoning_parts,
                    })));
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
        // 缓存写入（M443）：**实测路径 = `usage.input_tokens_details.cache_write_tokens`**
        //（2026-10-11 真机冒烟，model `k3-256k` @ `https://api.kimi.com/coding/v1`：与
        // `cached_tokens` 同层，顶层 `usage.cache_write_tokens` 不存在。现场与形状见
        // `src-tauri/tests/harness_real_kimi_cache.rs` 的模块文档）。顶层回退**保留**为
        // 官方平台端点 / 未来方言的保险（design §6 的两路口径），两路都读不到即 0
        // （= provider 不提供，不是错误——DeepSeek 即此）。
        let cache_write = usage
            .get("input_tokens_details")
            .and_then(|d| d.get("cache_write_tokens"))
            .or_else(|| usage.get("cache_write_tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        output.usage = Some(Usage {
            input_tokens: input,
            cached_tokens: cached,
            output_tokens: out,
            cache_write_tokens: cache_write,
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
// Chat Completions 方言（change add-harness-chat-completions-dialect）
// ---------------------------------------------------------------------------
//
// kimi 的 coding 端点在 Responses 路径上有一道**按请求体字节数**判定的前置闸
//（实测边界 (417,231, 417,512] B；根因与证据见 design.md §1），而同一账号同模型走
// Chat Completions 能服务到 211,055–234,656 input tokens。本客户端消费
// `LlmClient` trait 的留口（ADR 0007 Decision 3）：会话存储形态仍是 Responses item
//（canonical，design D3），**翻译只发生在发送边界的单一构造点**
//（[`ChatCompletionsClient::build_wire_body`]——`wire_body_bytes` 与发送共用它，纪律同
// Responses 侧 M463）。恢复路径因此零改动：Responses 时期留存的会话灌回后可直接以 chat
// 方言续聊，留存项不重写。

struct ChatCompletionsClient {
    http: reqwest::blocking::Client,
    endpoint: String,
    api_key: String,
    model: String,
    /// 当前 provider + model 是否支持思考程度调节（与 [`ResponsesClient`] 同判据）：
    /// chat 侧据此决定是否发 `thinking` 字段（design D5）。
    effort_supported: bool,
    /// 当前会话作用域的 vault 稳定 id：wire 展开（附件引用 → data URL）的落点解析。
    vault_id: String,
    preset: &'static ProviderPreset,
    /// 最近一次发送体的翻译期诊断（[`WireDiagnostic`]），由 `complete` 填充、
    /// [`LlmClient::take_wire_diagnostics`] 取走落 sidecar。
    diagnostics: Vec<WireDiagnostic>,
}

impl LlmClient for ChatCompletionsClient {
    /// 实际发往 provider 的模型 id（含调用级覆盖）：与 [`ResponsesClient`] 同一口径。
    fn model(&self) -> Option<&str> {
        Some(&self.model)
    }

    fn complete(&mut self, request: &Request, sink: &dyn StreamSink) -> TurnOutput {
        match self.complete_inner(request, sink) {
            Ok(output) => output,
            // 网络层失败 / 附件展开失败等**没有 HTTP 面**的错误：wire 面字段全空。
            // 非 2xx 走 complete_inner 的 Ok(error) 分支（复用 http_error_turn_error）。
            Err(e) => TurnOutput {
                error: Some(TurnError::new(
                    e.code.clone(),
                    e.message.clone(),
                    is_overflow(self.preset, &e.code, &e.message),
                )),
                ..Default::default()
            },
        }
    }

    /// 发送量计量：与发送共用 [`Self::build_wire_body`]（同一份构造，MUST NOT 各拼一套）。
    fn wire_body_bytes(&self, request: &Request) -> Option<u64> {
        let (body, _) = self
            .build_wire_body(request)
            .map_err(|e| eprintln!("lumir: harness 发送量计量跳过（构造失败）：{e}"))
            .ok()?;
        serde_json::to_vec(&body)
            .map_err(|e| eprintln!("lumir: harness 发送量计量跳过（序列化失败）：{e}"))
            .ok()
            .map(|bytes| bytes.len() as u64)
    }

    fn take_wire_diagnostics(&mut self) -> Vec<WireDiagnostic> {
        std::mem::take(&mut self.diagnostics)
    }
}

impl ChatCompletionsClient {
    /// 构造实际发送体（wire 展开 + items→messages 翻译 + 参数），发送与发送量计量**共用
    /// 这一份**（单一真源）。返回值第二项是本轮翻译期诊断（悬空调用丢弃等），只由 `complete`
    /// 收进 client、随后落 sidecar；`wire_body_bytes` 忽略它（计量不该产生副作用）。
    fn build_wire_body(
        &self,
        request: &Request,
    ) -> Result<(serde_json::Value, Vec<WireDiagnostic>), CommandError> {
        // wire 展开先于翻译（design D4 的 `input_image` 行）：`input_image` part 的
        // `image_url` 此时已是 data URL。
        let input = super::attachments::expand_image_refs(&request.input, &self.vault_id)?;
        let (messages, diagnostics) = chat_messages(&request.system, &input);
        let mut body = serde_json::json!({
            "model": self.model,
            "messages": messages,
            "tools": request.tools.iter().map(chat_tool_definition).collect::<Vec<_>>(),
            "tool_choice": "auto",
            "stream": true,
            "stream_options": {"include_usage": true},
        });
        // 思考档位（design D5）：Kimi trait 形态 `thinking:{type,effort,keep}`。未声明 effort
        // 能力的模型 MUST NOT 发该字段（与 Responses 侧 `reasoning.effort` 同纪律）。
        if self.effort_supported {
            body["thinking"] = serde_json::json!({
                "type": "enabled",
                "effort": request.effort.as_str(),
                "keep": "all",
            });
        }
        // 刻意不发（design D8 + spec 的 MUST NOT 集）：`include` / `store` / `reasoning` /
        // `max_tokens` / `max_completion_tokens`。chat 端点的思考回放走 `reasoning_content`，
        // 不需要 Responses 的密文回放字段。
        Ok((body, diagnostics))
    }

    fn complete_inner(
        &mut self,
        request: &Request,
        sink: &dyn StreamSink,
    ) -> Result<TurnOutput, CommandError> {
        let (body, diagnostics) = self.build_wire_body(request)?;
        self.diagnostics = diagnostics;
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
            // 错误路径与 Responses 同一份（design D7）：不做方言特判。
            let header_request_id = request_id_from_headers(response.headers());
            let text = response.text().unwrap_or_default();
            return Ok(TurnOutput {
                error: Some(http_error_turn_error(
                    self.preset,
                    status.as_u16(),
                    header_request_id,
                    &text,
                )),
                ..Default::default()
            });
        }
        Ok(parse_chat_sse(response, self.preset, sink))
    }
}

/// Responses 形态的工具定义 `{type:"function", name, description, parameters}` → chat 形态
/// `{type:"function", function:{name, description, parameters}}`；函数级其余字段（`strict`
/// 等）原样保留，不维护第二张字段表。
fn chat_tool_definition(tool: &serde_json::Value) -> serde_json::Value {
    let mut function = tool.clone();
    if let Some(map) = function.as_object_mut() {
        map.remove("type");
    }
    serde_json::json!({ "type": "function", "function": function })
}

fn item_type(item: &serde_json::Value) -> Option<&str> {
    item.get("type").and_then(|t| t.as_str())
}

fn string_field(value: &serde_json::Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

/// 内容数组 → 纯文本（`input_text` / `output_text` / `text` 各形态的 `.text` 逐段拼接）。
/// 字符串形态原样返回（恢复旧记录时可能遇到）。
fn content_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(|t| t.as_str()))
            .collect(),
        _ => String::new(),
    }
}

/// user 消息的 chat content：无图片时压成字符串（文本直出）；有图片时产出 content parts
/// ——文本 part 为 `{type:"text"}`、`input_image` 为 `{type:"image_url",image_url:{url}}`
///（design D4；此时 `image_url` 已是展开后的 data URL）。
fn chat_user_content(content: &serde_json::Value) -> serde_json::Value {
    let serde_json::Value::Array(parts) = content else {
        return content.clone();
    };
    let has_image = parts
        .iter()
        .any(|part| item_type(part) == Some("input_image"));
    if !has_image {
        return serde_json::Value::String(content_text(content));
    }
    serde_json::Value::Array(
        parts
            .iter()
            .map(|part| match item_type(part) {
                Some("input_image") => serde_json::json!({
                    "type": "image_url",
                    "image_url": {
                        "url": part.get("image_url").and_then(|v| v.as_str()).unwrap_or_default(),
                    },
                }),
                _ => serde_json::json!({
                    "type": "text",
                    "text": part.get("text").and_then(|v| v.as_str()).unwrap_or_default(),
                }),
            })
            .collect(),
    )
}

/// 孤立 `function_call_output`（无配对调用）的诊断。
fn orphan_output_diagnostic(call_id: &str) -> WireDiagnostic {
    WireDiagnostic {
        code: "orphan_function_call_output",
        call_id: call_id.to_string(),
        message: format!(
            "历史里的 function_call_output（{call_id}）没有配对的 function_call，chat 方言翻译时已丢弃"
        ),
    }
}

/// items → chat messages（design D4 的**唯一翻译点**；`wire_body` 与 `wire_body_bytes`
/// 共用，MUST NOT 各拼一套）。
///
/// 输入是**展开图片引用之后**的 canonical Responses item 数组。翻译规则：
/// - system（`Request.system`）→ 首条 `{role:"system"}`（空串不发——M372 的空文本 400）。
/// - user 消息 → `{role:"user"}`（文本直出 / 含图时 content parts）。
/// - reasoning 项的**明文**（[`thinking::reasoning_text`]：kimi 的 `summary` / deepseek 的
///   `content`）→ 折叠进**其后第一条可发的 assistant 消息**的 `reasoning_content`（多段以
///   空行拼接）；带 `tool_calls` 的 assistant 消息同样携带（该端点缺 `reasoning_content`
///   的 tool 调用消息会 400）。
/// - 一轮的 N 个 function_call → **单条** `{role:"assistant", tool_calls:[...]}`（同一轮若还有
///   正文，正文并入该条的 `content`——chat 一轮只有一条 assistant 消息；无正文时 `content`
///   为 null），其后紧随 N 条 `{role:"tool", tool_call_id}`、中间不插其它消息（design D4 的
///   硬约束）。
/// - 悬空 function_call（无配对 output）→ 丢弃 + 诊断；孤立 output 同理。
///
/// 空正文 assistant 消息不产出（M372：空文本会被端点 400；canonical 侧
/// [`super::session::assistant_item`] 同样省略），pending reasoning 继续等下一个可发消息。
///
/// `pub` 是为跨方言恢复测试（`src-tauri/tests/session_recording.rs`）：纯函数、不起 HTTP。
pub fn chat_messages(
    system: &str,
    items: &[serde_json::Value],
) -> (Vec<serde_json::Value>, Vec<WireDiagnostic>) {
    let mut messages: Vec<serde_json::Value> = Vec::new();
    let mut diagnostics = Vec::new();
    if !system.is_empty() {
        messages.push(serde_json::json!({"role": "system", "content": system}));
    }
    // 待折叠的 reasoning 明文（design D4）：「其后第一条 assistant 消息」——中途遇到不可发
    // 的项（空正文 assistant / user）时不清空，等真正可发的 assistant 宿主。
    let mut pending_reasoning: Vec<String> = Vec::new();
    // 待定去向的 assistant 正文：canonical 历史把「有正文又有调用的轮次」拆成
    // reasoning + assistant message + function_call 项。chat 侧一轮只能是一条 assistant 消息，
    // 且带 tool_calls 的这条 MUST 携带 reasoning_content（端点硬约束）——因此正文要先缓冲：
    // 紧随其后有调用组就并入 tool_calls 消息（content = 正文），否则按普通 assistant 消息发。
    let mut pending_assistant_text: Option<String> = None;
    let mut index = 0;
    while index < items.len() {
        let item = &items[index];
        match item_type(item) {
            Some("reasoning") => {
                if let Some(text) = thinking::reasoning_text(item) {
                    pending_reasoning.push(text);
                }
                index += 1;
            }
            Some("function_call") => {
                // 一轮的 N 个调用是连续项（canonical：calls 组 → outputs 组，M360）。
                let mut calls: Vec<(String, String, String)> = Vec::new();
                while index < items.len() && item_type(&items[index]) == Some("function_call") {
                    let call = &items[index];
                    calls.push((
                        string_field(call, "call_id"),
                        string_field(call, "name"),
                        string_field(call, "arguments"),
                    ));
                    index += 1;
                }
                // 紧随其后的输出组；可能少于调用组（悬空调用：恢复边界，design D4）。
                let mut outputs: Vec<(String, String)> = Vec::new();
                while index < items.len()
                    && item_type(&items[index]) == Some("function_call_output")
                {
                    let output = &items[index];
                    outputs.push((
                        string_field(output, "call_id"),
                        string_field(output, "output"),
                    ));
                    index += 1;
                }
                let mut tool_calls: Vec<serde_json::Value> = Vec::new();
                for (call_id, name, arguments) in &calls {
                    if !outputs.iter().any(|(output_id, _)| output_id == call_id) {
                        // 悬空调用：chat 端点会以「tool_calls 未配对」400 拒掉整条请求；
                        // 丢弃是唯一不必然失败的处置，留诊断供事后审计。
                        diagnostics.push(WireDiagnostic {
                            code: "dangling_function_call",
                            call_id: call_id.clone(),
                            message: format!(
                                "历史里的 function_call（{name}）没有配对的 function_call_output，chat 方言翻译时已丢弃"
                            ),
                        });
                        continue;
                    }
                    tool_calls.push(serde_json::json!({
                        "id": call_id,
                        "type": "function",
                        "function": {"name": name, "arguments": arguments},
                    }));
                }
                if tool_calls.is_empty() {
                    // 全部调用悬空：没有 assistant 宿主，但此前的正文仍是真实内容——按普通
                    // assistant 消息收口（不能随调用一起丢）。
                    flush_pending_assistant(
                        &mut messages,
                        &mut pending_assistant_text,
                        &mut pending_reasoning,
                    );
                    for (output_id, _) in &outputs {
                        diagnostics.push(orphan_output_diagnostic(output_id));
                    }
                    continue;
                }
                let hosted: Vec<String> = tool_calls
                    .iter()
                    .filter_map(|call| call.get("id").and_then(|v| v.as_str()))
                    .map(str::to_string)
                    .collect();
                // 同轮正文并入本条（chat 一轮一条 assistant 消息）；无正文时 content 为 null。
                let content = match pending_assistant_text.take() {
                    Some(text) => serde_json::Value::String(text),
                    None => serde_json::Value::Null,
                };
                let mut message = serde_json::json!({
                    "role": "assistant",
                    "content": content,
                    "tool_calls": tool_calls,
                });
                if !pending_reasoning.is_empty() {
                    message["reasoning_content"] =
                        serde_json::Value::String(pending_reasoning.join("\n\n"));
                    pending_reasoning.clear();
                }
                messages.push(message);
                for (output_id, output) in &outputs {
                    if hosted.iter().any(|id| id == output_id) {
                        messages.push(serde_json::json!({
                            "role": "tool",
                            "tool_call_id": output_id,
                            "content": output,
                        }));
                    } else {
                        diagnostics.push(orphan_output_diagnostic(output_id));
                    }
                }
            }
            Some("function_call_output") => {
                // 没有前置调用组的孤立输出：chat 侧没有 tool_call 可配对。
                flush_pending_assistant(
                    &mut messages,
                    &mut pending_assistant_text,
                    &mut pending_reasoning,
                );
                diagnostics.push(orphan_output_diagnostic(&string_field(item, "call_id")));
                index += 1;
            }
            _ => {
                match item.get("role").and_then(|r| r.as_str()) {
                    Some("user") => {
                        flush_pending_assistant(
                            &mut messages,
                            &mut pending_assistant_text,
                            &mut pending_reasoning,
                        );
                        messages.push(serde_json::json!({
                            "role": "user",
                            "content": chat_user_content(
                                item.get("content").unwrap_or(&serde_json::Value::Null)
                            ),
                        }));
                    }
                    Some("assistant") => {
                        let text =
                            content_text(item.get("content").unwrap_or(&serde_json::Value::Null));
                        if !text.is_empty() {
                            // 前一条待定正文先收口（非 canonical 的连续 assistant 消息也不丢）。
                            flush_pending_assistant(
                                &mut messages,
                                &mut pending_assistant_text,
                                &mut pending_reasoning,
                            );
                            pending_assistant_text = Some(text);
                        }
                    }
                    Some("system") => {
                        flush_pending_assistant(
                            &mut messages,
                            &mut pending_assistant_text,
                            &mut pending_reasoning,
                        );
                        let text =
                            content_text(item.get("content").unwrap_or(&serde_json::Value::Null));
                        if !text.is_empty() {
                            messages.push(serde_json::json!({"role": "system", "content": text}));
                        }
                    }
                    _ => {}
                }
                index += 1;
            }
        }
    }
    // 末尾悬空的正文按普通 assistant 消息收口；末尾悬空的 reasoning（其后没有 assistant
    // 消息）：无宿主可折叠，静默丢弃——中断轮的自然形态，不是错误（不产诊断，免得每轮
    // 中断都留一条噪音）。
    flush_pending_assistant(
        &mut messages,
        &mut pending_assistant_text,
        &mut pending_reasoning,
    );
    (messages, diagnostics)
}

/// 收口待定的 assistant 正文（可能并入 tool_calls 消息的候选）：作为普通 assistant 消息
/// 发出，并带上待折叠的 reasoning 明文（若有）。无待定正文时为 no-op（pending reasoning
/// 留给下一个宿主）。
fn flush_pending_assistant(
    messages: &mut Vec<serde_json::Value>,
    pending_text: &mut Option<String>,
    pending_reasoning: &mut Vec<String>,
) {
    let Some(text) = pending_text.take() else {
        return;
    };
    let mut message = serde_json::json!({"role": "assistant", "content": text});
    if !pending_reasoning.is_empty() {
        message["reasoning_content"] = serde_json::Value::String(pending_reasoning.join("\n\n"));
        pending_reasoning.clear();
    }
    messages.push(message);
}

/// chat usage → 既有 [`Usage`]（design D6）：`prompt_tokens` → `input_tokens`；
/// cached 两种字段布局都兜（顶层 `cached_tokens` / `prompt_tokens_details.cached_tokens`）；
/// `completion_tokens` → `output_tokens`；`cache_write_tokens` 无 chat 对应 → 0（会话累计
/// 读数口径不变——「provider 不提供按 0 记录」的既有先例）。
fn chat_usage(usage: &serde_json::Value) -> Usage {
    let input = usage
        .get("prompt_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let cached = usage
        .get("cached_tokens")
        .and_then(|v| v.as_u64())
        .or_else(|| {
            usage
                .get("prompt_tokens_details")
                .and_then(|details| details.get("cached_tokens"))
                .and_then(|v| v.as_u64())
        })
        .unwrap_or(0);
    let output = usage
        .get("completion_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    Usage {
        input_tokens: input,
        cached_tokens: cached,
        output_tokens: output,
        cache_write_tokens: 0,
    }
}

/// chat 的 `reasoning_content` 明文 → 会话的 reasoning **回放项**（canonical Responses 形态）。
/// 这是跨方言的桥：chat 回来的思考按 kimi 的 `summary` 载体落盘（`llm_response.reasoning`），
/// 下次无论走 chat（[`chat_messages`] 经 [`thinking::reasoning_text`] 折回
/// `reasoning_content`）还是 Responses，都从同一份 canonical 项回放。
fn reasoning_replay_item(text: &str) -> Option<serde_json::Value> {
    if text.is_empty() {
        return None;
    }
    Some(normalize_reasoning_item(&serde_json::json!({
        "type": "reasoning",
        "summary": [{"type": "summary_text", "text": text}],
    })))
}

/// chat SSE 的流内累积状态（content / reasoning_content 增量、tool_calls 分片、usage 帧）。
#[derive(Default)]
struct ChatStreamState {
    text: String,
    /// `reasoning_content` 全文（回放项来源）。
    reasoning: String,
    /// 展示专用的思考分片（与 Responses 侧的 `reasoning_deltas` 同语义）。
    reasoning_deltas: Vec<String>,
    /// 按 `index` 累积的 tool_calls（分片到达：id/name 一次给、arguments 流式拼接）。
    calls: Vec<ChatCallAccum>,
    usage: Option<Usage>,
    error: Option<TurnError>,
}

#[derive(Default)]
struct ChatCallAccum {
    index: u64,
    id: String,
    name: String,
    arguments: String,
}

impl ChatStreamState {
    /// 处理一帧 `data:`；返回 `true` 表示终态（不再读流）。
    fn handle(&mut self, data: &str, preset: &ProviderPreset, sink: &dyn StreamSink) -> bool {
        let data = data.trim();
        if data.is_empty() {
            return false;
        }
        if data == "[DONE]" {
            return true;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
            return false; // keep-alive / 非 JSON 帧
        };
        if let Some(error) = value.get("error").filter(|e| !e.is_null()) {
            let (code, message) = parse_error_value(error)
                .unwrap_or_else(|| ("harness_stream_error".into(), "流式错误".into()));
            let context_overflow = is_overflow(preset, &code, &message);
            self.error = Some(TurnError::new(code, message, context_overflow));
            return true;
        }
        if let Some(choices) = value.get("choices").and_then(|c| c.as_array()) {
            for choice in choices {
                let Some(delta) = choice.get("delta") else {
                    continue;
                };
                if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                    if !content.is_empty() {
                        self.text.push_str(content);
                        sink.text_delta(content);
                    }
                }
                // 思考增量：进展示分片通道（即时转发），同时累积全文供回放项。
                if let Some(reasoning) = delta.get("reasoning_content").and_then(|r| r.as_str()) {
                    if !reasoning.is_empty() {
                        self.reasoning.push_str(reasoning);
                        self.reasoning_deltas.push(reasoning.to_string());
                        sink.reasoning_delta(reasoning);
                    }
                }
                if let Some(tool_calls) = delta.get("tool_calls").and_then(|c| c.as_array()) {
                    for part in tool_calls {
                        self.accumulate_tool_call(part);
                    }
                }
            }
        }
        // usage 帧（`stream_options.include_usage`）：末帧，拿到即终态。端点不回该帧时
        // 该轮无读数（与既有「无 usage 不更新 meter」同纪律）。
        if let Some(usage) = value.get("usage").filter(|u| !u.is_null()) {
            self.usage = Some(chat_usage(usage));
            return true;
        }
        false
    }

    fn accumulate_tool_call(&mut self, part: &serde_json::Value) {
        let index = part.get("index").and_then(|v| v.as_u64()).unwrap_or(0);
        let at = match self.calls.iter().position(|call| call.index == index) {
            Some(at) => at,
            None => {
                self.calls.push(ChatCallAccum {
                    index,
                    ..Default::default()
                });
                self.calls.len() - 1
            }
        };
        let slot = &mut self.calls[at];
        // id / name 通常只在首个分片整段给出：已有值时不覆盖（防止重复分片把名字拼重），
        // arguments 是流式片段，逐片拼接。
        if slot.id.is_empty() {
            if let Some(id) = part.get("id").and_then(|v| v.as_str()) {
                slot.id = id.to_string();
            }
        }
        if let Some(function) = part.get("function") {
            if slot.name.is_empty() {
                if let Some(name) = function.get("name").and_then(|v| v.as_str()) {
                    slot.name = name.to_string();
                }
            }
            if let Some(arguments) = function.get("arguments").and_then(|v| v.as_str()) {
                slot.arguments.push_str(arguments);
            }
        }
    }

    fn finish(self) -> TurnOutput {
        let mut calls = self.calls;
        calls.sort_by_key(|call| call.index);
        TurnOutput {
            text: self.text,
            reasoning: reasoning_replay_item(&self.reasoning),
            reasoning_deltas: self.reasoning_deltas,
            calls: calls
                .into_iter()
                .map(|call| ToolCall {
                    call_id: call.id,
                    name: call.name,
                    arguments: call.arguments,
                })
                .collect(),
            usage: self.usage,
            error: self.error,
        }
    }
}

fn parse_chat_sse(
    response: reqwest::blocking::Response,
    preset: &ProviderPreset,
    sink: &dyn StreamSink,
) -> TurnOutput {
    parse_chat_sse_reader(std::io::BufReader::new(response), preset, sink)
}

/// chat 方言的 SSE 读循环（与 transport 解耦，单测传合成字节流）：帧没有事件名，每条
/// `data:` 是一条完整 JSON（`[DONE]` 为终止哨兵）。在途停止与 Responses 侧同一语义——
/// `pump_sse` 的轮询收流，**已产出的 text / reasoning 分片保留在返回值里**。
fn parse_chat_sse_reader<R: BufRead + Send + 'static>(
    reader: R,
    preset: &ProviderPreset,
    sink: &dyn StreamSink,
) -> TurnOutput {
    let mut state = ChatStreamState::default();
    pump_sse(reader, sink, |_event, data| {
        state.handle(data, preset, sink)
    });
    state.finish()
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
    /// 可中断：片间隔内小步睡眠、每步问一次 [`StreamSink::aborted`]（M374），翻真即停产出
    /// （已产出分片保留）——停止时延 ≪ 间隔本身，不再等整个间隔睡满。
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
    /// 缓存写入（M443）：fixture 可脚本化该字段（验收无需真 API）；缺键即 0。
    #[serde(default)]
    cache_write_tokens: u64,
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
    /// 脚本原始条数（会话级游标 wrap 的除数）。`script` 会被 [`Self::with_start`] 削去前缀，
    /// 故长度单独记一份（削完仍要回答「会话从哪条续」）。
    script_len: usize,
    /// 本实例已弹出的条数（会话游标按 `start + consumed` 推进，见 [`super::turn`] 的 `run_turn`）。
    consumed: usize,
    /// 由外部消费者（子运行）以 [`LlmClient::skip`] 跳过、未由本实例弹出的条数（design §18
    /// 的按 run 预分配区段）。父会话游标回写 = `consumed + external`，子运行吃掉多少、父就前进多少。
    external: usize,
    /// 可读名字（JSONL 记录用）：fixture 路径。
    source: String,
    /// 每次 `complete` 收到的思考程度档位（按调用序，M362）——验收据此断言「切档位后下一轮
    /// 请求携带了映射后的参数」。mock 不消费它，只**记录**（真 provider 由
    /// [`super::thinking::apply_effort`] 把它写进请求体）。
    received_efforts: Vec<ThinkingEffort>,
    /// 当前会话作用域的 vault 稳定 id：wire 展开（附件引用 → data URL）与真 client
    /// 同一条函数（design §4.3）——验收据此断言「wire 上真的是 input_image」。
    vault_id: String,
    /// 每次 `complete` 展开后的 input（按调用序；`received_inputs` 的断言数据源）。
    received_inputs: Vec<Vec<serde_json::Value>>,
    /// 一次性后台队列模式（标题 / 语义命名，design 的 D12 与 §4）：弹尽时返回**空正文**而不是
    /// `fixture_exhausted`——缺失 / 空 / 弹尽都要落到解析侧判非法，而不是让一次性调用把
    /// 「脚本漏写」伪装成网络错误。
    empty_on_exhaust: bool,
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
            script_len: file.responses.len(),
            script: file.responses.into(),
            consumed: 0,
            external: 0,
            source: source.to_string(),
            received_efforts: Vec::new(),
            vault_id: String::new(),
            received_inputs: Vec::new(),
            empty_on_exhaust: false,
        })
    }

    /// 命名调用的 mock client（change add-session-auto-naming，design D12）：读 fixture 顶层的
    /// **可选 `titles` 数组**（元素形状与 `responses` 相同），与会话 `responses` 队列完全独立
    /// ——共用一条队列会把既有场景的脚本整体错位。缺失 / 空 ⇒ 空队列（每次调用得到空正文）。
    pub fn titles_from_file(path: &std::path::Path) -> Result<Self, CommandError> {
        Self::queue_from_file(path, "titles")
    }

    /// [`Self::titles_from_file`] 的文本形态（单测直接用）。
    pub fn titles_from_str(text: &str, source: &str) -> Result<Self, CommandError> {
        Self::queue_from_str(text, "titles", source)
    }

    /// 图片语义命名的 mock client（change add-semantic-image-naming，design §4 / §9）：读 fixture
    /// 顶层**可选 `naming` 数组**——与会话 `responses`、标题 `titles` 两条队列互不错位。
    /// 缺失 / 空 ⇒ 空队列（每次调用得到空正文 ⇒ 解析侧判「输出不可用」⇒ 保留暂存名）。
    pub fn naming_from_file(path: &std::path::Path) -> Result<Self, CommandError> {
        Self::queue_from_file(path, "naming")
    }

    /// [`Self::naming_from_file`] 的文本形态（单测直接用）。
    pub fn naming_from_str(text: &str, source: &str) -> Result<Self, CommandError> {
        Self::queue_from_str(text, "naming", source)
    }

    /// 一次性后台队列的统一装配（`queue` = `titles` / `naming`）：两条队列的元素形状与
    /// `responses` 相同，只是键不同、各自独立计数。
    fn queue_from_file(path: &std::path::Path, queue: &str) -> Result<Self, CommandError> {
        let text = std::fs::read_to_string(path).map_err(|e| {
            CommandError::new(
                "harness_fixture_unreadable",
                format!("mock fixture 不可读（{}）：{e}", path.display()),
            )
            .param("path", path.display().to_string())
            .param("reason", e.to_string())
        })?;
        Self::queue_from_str(&text, queue, &path.display().to_string())
    }

    fn queue_from_str(text: &str, queue: &str, source: &str) -> Result<Self, CommandError> {
        let value: serde_json::Value = serde_json::from_str(text).map_err(|e| {
            CommandError::new(
                "harness_fixture_invalid",
                format!("mock fixture 不是合法 JSON（{source}）：{e}"),
            )
            .param("path", source)
            .param("reason", e.to_string())
        })?;
        let entries = match value.get(queue) {
            None | Some(serde_json::Value::Null) => Vec::new(),
            Some(list) => {
                serde_json::from_value::<Vec<FixtureResponse>>(list.clone()).map_err(|e| {
                    CommandError::new(
                        "harness_fixture_invalid",
                        format!("mock fixture 的 {queue} 数组不合法（{source}）：{e}"),
                    )
                    .param("path", source)
                    .param("reason", e.to_string())
                })?
            }
        };
        Ok(Self {
            script_len: entries.len(),
            script: entries.into(),
            consumed: 0,
            external: 0,
            source: source.to_string(),
            received_efforts: Vec::new(),
            vault_id: String::new(),
            received_inputs: Vec::new(),
            empty_on_exhaust: true,
        })
    }

    /// 命名调用的会话级标题游标（`start` = 本会话已弹过的 `titles` 条数）：与
    /// [`Self::with_start`] 不同，**不按长度取模**——标题脚本弹尽即空（design D12），不 wrap
    /// 回第一条（否则第 3 次重估会重新写出初始标题）。
    pub fn with_title_start(mut self, start: usize) -> Self {
        for _ in 0..start.min(self.script_len) {
            self.script.pop_front();
        }
        self
    }

    /// 绑定会话作用域的 vault 稳定 id（wire 展开的落点解析；`llm::client` 装配路径）。
    pub fn for_vault(mut self, vault_id: &str) -> Self {
        self.vault_id = vault_id.to_string();
        self
    }

    /// 从会话游标 `start` 处开始弹（M456）：削掉脚本前 `start` 条，使**同一会话的后续轮次**
    /// 接着上一条往下弹而不是每轮重放 `responses[0]`。`start` 按脚本长度取模——会话级游标
    /// 耗尽即 wrap 回 0（单条 response 的 fixture 因此与旧「每轮重放」行为逐字节一致，见场景
    /// 106/108/121/124/82）。`start >= len` 与 `len == 0` 都退化为不削（弹尽仍是 `fixture_exhausted`）。
    pub fn with_start(mut self, start: usize) -> Self {
        if self.script_len > 0 {
            for _ in 0..(start % self.script_len) {
                self.script.pop_front();
            }
        }
        self
    }

    /// 收到的档位序列（按调用序），供验收 / 单测断言。
    pub fn received_efforts(&self) -> &[ThinkingEffort] {
        &self.received_efforts
    }

    /// 每次 `complete` 展开后的 input（按调用序）——「wire 上真的是 input_image / data
    /// URL」的验收断言口（design §4.3：mock 与真 client 同一条展开投影）。
    pub fn received_inputs(&self) -> &[Vec<serde_json::Value>] {
        &self.received_inputs
    }
}

impl LlmClient for MockClient {
    /// fixture 路径（`llm_response.mock_fixture` 的因果链字段）。
    fn fixture_source(&self) -> Option<&str> {
        Some(&self.source)
    }

    /// 脚本原始条数（会话级游标的模；M456）。
    fn mock_script_len(&self) -> Option<usize> {
        Some(self.script_len)
    }

    /// 本实例累计弹出的条数（会话游标推进用）。
    fn mock_consumed(&self) -> usize {
        self.consumed
    }

    /// 子运行经 [`LlmClient::skip`] 吃掉、本实例未亲手弹出的条数（父游标回写用）。
    fn external_consumed(&self) -> usize {
        self.external
    }

    /// 前移脚本 `n` 条且不记进 `consumed`（那部分是子运行的区间，父自己没消费）。弹尽即停，
    /// 不 wrap、不回头——越界由子运行的 `fixture_exhausted` 负责暴露，父侧静默跳过只会更难查。
    fn skip(&mut self, n: usize) {
        for _ in 0..n {
            if self.script.pop_front().is_none() {
                break;
            }
            self.external += 1;
        }
    }

    fn complete(&mut self, request: &Request, sink: &dyn StreamSink) -> TurnOutput {
        // wire 展开与真 client 同一条函数（design §4.3）：附件引用 → data URL。
        // 展开失败（附件缺失等）以 error 终态收口——与真 provider 路径同口径，
        // MUST NOT 静默消费一条缺图的请求。
        let input = match super::attachments::expand_image_refs(&request.input, &self.vault_id) {
            Ok(input) => input,
            Err(e) => {
                self.received_efforts.push(request.effort);
                return TurnOutput {
                    error: Some(TurnError::new(e.code, e.message, false)),
                    ..Default::default()
                };
            }
        };
        self.received_inputs.push(input);
        // 记录收到的档位（M362）：与脚本是否弹尽无关——验收要断言的是「发出去的是什么」，
        // 故放在最前面，耗尽路径也留痕。
        self.received_efforts.push(request.effort);
        let Some(entry) = self.script.pop_front() else {
            if self.empty_on_exhaust {
                // 一次性后台队列弹尽（含缺失 / 空的 `titles` / `naming`）：空正文 → 解析侧
                // 判非法（design D12 与 add-semantic-image-naming §4）。
                return TurnOutput::default();
            }
            return TurnOutput {
                error: Some(TurnError::new(
                    "fixture_exhausted",
                    format!(
                        "mock fixture（{}）脚本已弹尽，测试脚本漏写响应",
                        self.source
                    ),
                    false,
                )),
                ..Default::default()
            };
        };
        // 成功弹出一条即推进本实例的计数（会话游标 `start + consumed` 的加数）。
        self.consumed += 1;
        // 脚本化延迟（默认 0）：撑住「回合在途」的窗口供验收断言用。放在错误分支之前——
        // 「迟到的是错误」同样是跨 vault 拒收的对象（理由见模块文档）。**不可中断**：
        // 一次睡到底（见模块头「逐片延迟」里与 `chunk_delay_ms` 的分工）。
        if entry.delay_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(entry.delay_ms));
        }
        if let Some(error) = entry.error {
            let context_overflow = is_overflow_any(&error.code, &error.message);
            return TurnOutput {
                error: Some(TurnError::new(error.code, error.message, context_overflow)),
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
            // 回放形状归一（M464）：mock fixture 的 reasoning 项与真 provider 的走同一条
            // [`normalize_reasoning_item`]——剥 id 后的形状是「outgoing input / 留存」的
            // 不变量，mock 路径不得是例外（否则验收断言到的回放形状非真）。
            reasoning: entry.reasoning.as_ref().map(normalize_reasoning_item),
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
                cache_write_tokens: u.cache_write_tokens,
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

/// 分片之间的可中断节拍（`chunk_delay_ms`，见模块头「逐片延迟」）：小步睡眠（每
/// [`CHUNK_GAP_POLL`] 一问 [`StreamSink::aborted`]，M374）——间隔内点停止亚秒级生效，
/// 翻真返回 `false`（产出到此为止，已产出的分片保留）。旧实现一次睡满整个间隔才问一次，
/// 停止最坏要等一个完整的 `chunk_delay_ms`。`chunk_delay_ms == 0` 时零延迟且不做中断
/// 探测（没有窗口可停）。
fn chunk_gap(chunk_delay_ms: u64, sink: &dyn StreamSink) -> bool {
    /// 片间隔的停止轮询步长：25ms 一档的睡眠-问询循环。
    const CHUNK_GAP_POLL: std::time::Duration = std::time::Duration::from_millis(25);
    if chunk_delay_ms == 0 {
        return true;
    }
    let total = std::time::Duration::from_millis(chunk_delay_ms);
    let start = std::time::Instant::now();
    while start.elapsed() < total {
        if sink.aborted() {
            return false;
        }
        let remaining = total.saturating_sub(start.elapsed());
        std::thread::sleep(remaining.min(CHUNK_GAP_POLL));
    }
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

    /// M381 config-only：client 装配的负向闸门——api_key 缺失与 model 解析为空各自挡
    /// 人话错误（后者不把空 model 发给 API）。两个用例在修复前形态（model 回落内置
    /// 出厂值）必 FAIL：旧代码 model 永远非空，第一条断言就红——区分度自证。
    #[test]
    fn client_rejects_missing_api_key_and_empty_model() {
        let mut config = crate::config::HarnessConfig {
            provider: HarnessProvider::Kimi,
            ..crate::config::HarnessConfig::default()
        };
        // 空 api_key（出厂态）→ api_key 错误先挡。
        let error = match client(&config, "vault-test-1") {
            Err(error) => error,
            Ok(_) => panic!("空 api_key 必须被拒"),
        };
        assert_eq!(error.code, "harness_api_key_missing");
        // 有 key 无模型（config-only 空清单、model 空串）→ model 错误。
        config.providers.kimi.api_key = "sk-x".into();
        let error = match client(&config, "vault-test-1") {
            Err(error) => error,
            Ok(_) => panic!("空 model 必须被拒"),
        };
        assert_eq!(error.code, "harness_model_missing");
        assert!(
            error.message.contains("models"),
            "错误信息要指出声明路径：{}",
            error.message
        );
        // 声明清单 + model 解析成功 → 装配通过（reqwest client 构建无副作用）。
        config.providers.kimi.model = "k3-256k".into();
        config.providers.kimi.models = vec![crate::config::HarnessModelSpec {
            id: "k3-256k".into(),
            effort: true,
            vision: false,
            window: 262_144,
        }];
        assert!(client(&config, "vault-test-1").is_ok());

        // 调用级模型覆盖（change add-harness-subagents design §11）：覆盖值进 client、也进
        // `model()`（发送点留存的唯一读数）；空串 / None 等价于不覆盖。
        let overridden = client_at(&config, "vault-test-1", 0, Some("k3-256k")).unwrap();
        assert_eq!(overridden.model(), Some("k3-256k"));
        let blank = client_at(&config, "vault-test-1", 0, Some("   ")).unwrap();
        assert_eq!(blank.model(), Some("k3-256k"), "空覆盖必须回落配置模型");
        let missing = client_at(&config, "vault-test-1", 0, None).unwrap();
        assert_eq!(missing.model(), Some("k3-256k"));
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
                output_tokens: 5,
                // fixture 未写该键 ⇒ 0（M443：缺键与「不提供」同一读数）。
                cache_write_tokens: 0
            })
        );
        // reasoning 回放项归一形状（M464）：剥掉 `rs_*` id、encrypted_content 保留。
        let reasoning = first.reasoning.as_ref().expect("reasoning 项应被捕获");
        assert!(
            reasoning.get("id").is_none(),
            "回放项不得带 id：{reasoning}"
        );
        assert_eq!(reasoning["encrypted_content"], "enc");
        let second = client.complete(&request(), &TestStream::default());
        let error = second.error.expect("scripted error");
        assert!(error.context_overflow);
        let third = client.complete(&request(), &TestStream::default());
        assert_eq!(third.error.unwrap().code, "fixture_exhausted");
    }

    /// M456：会话级 mock 游标——同一会话的第二轮接着上一轮往下弹（原本每轮从脚本头重放，
    /// 131/133 因此永远拿不到 `responses[1]`）。反向验证：拿掉 `with_start`（游标恒 0）时
    /// 第二轮会弹回 `第一轮`，本用例即红。
    #[test]
    fn session_cursor_advances_mock_script_across_turns() {
        const TWO: &str = r#"{"responses": [{"text": "第一轮"}, {"text": "第二轮"}]}"#;
        // 第一轮：start=0 弹 responses[0]，推进出会话游标。
        let mut turn1 = MockClient::from_str(TWO, "two").unwrap().with_start(0);
        assert_eq!(
            turn1.complete(&request(), &TestStream::default()).text,
            "第一轮"
        );
        let next = wrap_cursor(0, turn1.mock_consumed(), turn1.mock_script_len().unwrap());
        assert_eq!(next, 1);
        // 第二轮：从会话游标 1 起——弹 responses[1]（旧的每轮重放行为会弹回「第一轮」）。
        let mut turn2 = MockClient::from_str(TWO, "two").unwrap().with_start(next);
        assert_eq!(
            turn2.complete(&request(), &TestStream::default()).text,
            "第二轮"
        );
        // 耗尽即 wrap 回 0：单条 response 的 fixture 第二轮仍弹 responses[0]（场景 106/108/121/
        // 124/82 的既有行为不变）。
        let mut one = MockClient::from_str(r#"{"responses": [{"text": "仅此一条"}]}"#, "one")
            .unwrap()
            .with_start(wrap_cursor(0, 1, 1));
        assert_eq!(
            one.complete(&request(), &TestStream::default()).text,
            "仅此一条"
        );
        // 越界与空脚本都不 panic：退化为不削 / 恒 0。
        assert_eq!(wrap_cursor(5, 3, 0), 0);
        let mut empty = MockClient::from_str(r#"{"responses": []}"#, "empty")
            .unwrap()
            .with_start(3);
        assert_eq!(
            empty
                .complete(&request(), &TestStream::default())
                .error
                .unwrap()
                .code,
            "fixture_exhausted"
        );
    }

    /// design §18：父客户端跳过子运行预分配的区间——`skip(n)` 前移脚本但**不**记成自己的
    /// `consumed`，父会话游标按 `consumed + external_consumed` 推进；真 provider 无此概念。
    /// 区分度：若 `skip` 记进 `consumed`，第一条断言（`mock_consumed == 0`）FAIL；若 `skip`
    /// 没有前移脚本，父紧接着弹出的会是 responses[0]（「父第一条」）而不是 responses[1]。
    #[test]
    fn mock_skip_advances_script_without_counting_as_parent_consumption() {
        let script = r#"{"responses": [
            {"text": "父第一条"}, {"text": "子区间 1"}, {"text": "子区间 2"}, {"text": "父续写"}
        ]}"#;
        let mut parent = MockClient::from_str(script, "skip").unwrap();
        // 父先弹自己的第一条。
        assert_eq!(
            parent.complete(&request(), &TestStream::default()).text,
            "父第一条"
        );
        // 子运行吃掉中间两条（父跳过其区间）：不记成父自己的 consumed。
        parent.skip(2);
        assert_eq!(parent.external_consumed(), 2);
        assert_eq!(parent.mock_consumed(), 1, "跳过的条数不是父自己消费的");
        // 父续写从子区间之后开始弹：证明确实前移了脚本。
        assert_eq!(
            parent.complete(&request(), &TestStream::default()).text,
            "父续写"
        );
        assert_eq!(parent.mock_consumed(), 2);
        let next = wrap_cursor(
            0,
            parent.mock_consumed() + parent.external_consumed(),
            parent.mock_script_len().unwrap(),
        );
        assert_eq!(next, 0, "父会话游标 = 自己弹出 + 跳过，按脚本长度取模");

        // 弹尽即停：skip 不 wrap、不回头，也不 panic。
        let mut short =
            MockClient::from_str(r#"{"responses": [{"text": "唯一"}]}"#, "short").unwrap();
        short.skip(5);
        assert_eq!(short.external_consumed(), 1);
    }

    // ---- M443：usage 的 cache_write_tokens 解析（双路兜底 + 缺键 0） ----
    //
    // 口径：`input_tokens_details.cache_write_tokens` 优先，顶层 `usage.cache_write_tokens`
    // 回退，两路都读不到即 0（provider 不提供 = 0，不是错误）。真 provider 的实测路径见
    // `src-tauri/tests/harness_real_kimi_cache.rs` 与 design §6。

    /// 从一段完整响应 JSON 解析 usage（只走 `collect_final_response`，与真 provider 同一条路径）。
    fn parse_usage(response: &serde_json::Value) -> Usage {
        let mut output = TurnOutput::default();
        collect_final_response(response, &mut output);
        output.usage.expect("usage 在场")
    }

    #[test]
    fn usage_parses_cache_write_from_details_block() {
        let usage = parse_usage(&serde_json::json!({
            "usage": {
                "input_tokens": 12786,
                "input_tokens_details": {"cached_tokens": 6400, "cache_write_tokens": 6174},
                "output_tokens": 210
            }
        }));
        assert_eq!(usage.input_tokens, 12786);
        assert_eq!(usage.cached_tokens, 6400);
        assert_eq!(usage.output_tokens, 210);
        assert_eq!(usage.cache_write_tokens, 6174);
    }

    #[test]
    fn usage_parses_cache_write_from_top_level_fallback() {
        // 顶层回退路（详情块里没有该键时）。
        let usage = parse_usage(&serde_json::json!({
            "usage": {
                "input_tokens": 100,
                "cache_write_tokens": 60,
                "output_tokens": 5
            }
        }));
        assert_eq!(usage.cache_write_tokens, 60);
    }

    #[test]
    fn usage_cache_write_defaults_to_zero_when_absent() {
        // deepseek 形状：无该字段 ⇒ 0（不是错误、不留缺键语义）。
        let usage = parse_usage(&serde_json::json!({
            "usage": {
                "input_tokens": 100,
                "input_tokens_details": {"cached_tokens": 40},
                "output_tokens": 5
            }
        }));
        assert_eq!(usage.cache_write_tokens, 0);
    }

    #[test]
    fn usage_cache_write_prefers_details_block() {
        // 两路都在场时以详情块为准（优先序是合同的一部分，不能靠 serde 的解析顺序碰运气）。
        let usage = parse_usage(&serde_json::json!({
            "usage": {
                "input_tokens": 100,
                "cache_write_tokens": 7,
                "input_tokens_details": {"cached_tokens": 40, "cache_write_tokens": 70},
                "output_tokens": 5
            }
        }));
        assert_eq!(usage.cache_write_tokens, 70);
    }

    #[test]
    fn usage_parses_kimi_real_shape() {
        // M443 §4.1 真机实测的**逐字节形状**（`k3-256k` @ `api.kimi.com/coding/v1`，
        // 2026-10-11；现场 `tests/harness_real_kimi_cache.rs` 的模块文档）：该端点
        // `cache_write_tokens` 恒 0，但路径在 `input_tokens_details` 内、与 `cached_tokens`
        // 同层。这条判据把「真响应形状 → 解析结果」钉在门禁里，不依赖真实 key 也能守住。
        let usage = parse_usage(&serde_json::json!({
            "usage": {
                "input_tokens": 2641,
                "input_tokens_details": {"cache_write_tokens": 0, "cached_tokens": 2641},
                "output_tokens": 59,
                "output_tokens_details": {"reasoning_tokens": 45},
                "total_tokens": 2700
            }
        }));
        assert_eq!(usage.input_tokens, 2641);
        assert_eq!(usage.cached_tokens, 2641);
        assert_eq!(usage.output_tokens, 59);
        assert_eq!(usage.cache_write_tokens, 0);
    }

    #[test]
    fn overflow_indicators_match_provider_dialects() {
        let kimi = preset(&HarnessProvider::Kimi);
        assert!(is_overflow(kimi, "context_length_exceeded", ""));
        // M463：coding 端点的真实超限话术（原文来自真机会话 JSONL 的 llm_error）——
        // 修前三条特征串一条都不命中，这条断言对修前的预设必 FAIL（区分度自证）。
        assert!(is_overflow(
            kimi,
            "harness_http_error",
            "Your request exceeded k3-256k model token limit: 262144"
        ));
        let deepseek = preset(&HarnessProvider::Deepseek);
        assert!(is_overflow(
            deepseek,
            "invalid_request_error",
            "This model's maximum context length is 65536"
        ));
        assert!(!is_overflow(deepseek, "rate_limit", "slow down"));
        // M463：mock 的 overflow 判定对**两家预设取并集**（脚本可写任一家方言）——
        // 修前的硬编码两串列表漏掉 kimi 的 coding 端点话术，这条必 FAIL（区分度自证）。
        assert!(is_overflow_any(
            "harness_http_error",
            "Your request exceeded k3-256k model token limit: 262144"
        ));
        assert!(is_overflow_any(
            "invalid_request_error",
            "maximum context length 65536"
        ));
        assert!(!is_overflow_any("rate_limit", "slow down"));
    }

    // ---- M463：错误路径可观察性（HTTP 状态 / 原始 body / request id） ----

    /// 非 2xx → TurnError 带 wire 面三件；code/message 与超限判定沿用原口径。
    #[test]
    fn http_error_carries_wire_diagnostics() {
        let kimi = preset(&HarnessProvider::Kimi);
        let err = http_error_turn_error(
            kimi,
            400,
            None,
            r#"{"error":{"message":"Your request exceeded k3-256k model token limit: 262144"}}"#,
        );
        assert_eq!(err.http_status, Some(400));
        assert_eq!(err.code, "harness_http_error");
        assert!(err.context_overflow, "coding 端点话术必须判成超限");
        assert!(!err.body_truncated);
        assert_eq!(
            err.raw_body.as_deref(),
            Some(
                r#"{"error":{"message":"Your request exceeded k3-256k model token limit: 262144"}}"#
            )
        );
        // 响应头优先，都没有则 body 兜底——这里两者都无。
        assert_eq!(err.request_id, None);

        // 头里有 request id 时优先取头；body 里的作兜底。
        let err = http_error_turn_error(
            kimi,
            500,
            Some("hdr-1".into()),
            r#"{"request_id":"body-1"}"#,
        );
        assert_eq!(err.request_id.as_deref(), Some("hdr-1"));
        let err = http_error_turn_error(kimi, 500, None, r#"{"error":{"request_id":"body-2"}}"#);
        assert_eq!(err.request_id.as_deref(), Some("body-2"));
    }

    /// 巨型 body 截到 [`ERROR_BODY_MAX_CHARS`]（防撑爆会话日志），并按字符截断不切坏 UTF-8。
    #[test]
    fn error_body_is_capped_at_the_limit() {
        let long = "汉".repeat(ERROR_BODY_MAX_CHARS + 500);
        let (body, truncated) = truncate_error_body(&long);
        assert!(truncated);
        assert_eq!(body.chars().count(), ERROR_BODY_MAX_CHARS);
        let (short, truncated) = truncate_error_body("短");
        assert!(!truncated);
        assert_eq!(short, "短");
    }

    /// P2-2：兜底 message（非 JSON body 如网关 HTML 页）与 `raw_body` **同口径限长**——
    /// 不得靠 message 绕过上限（它会进 llm_error 记录与 SSE error 事件）。修前 message
    /// 内嵌完整 body，本断言必 FAIL（区分度自证）。
    #[test]
    fn http_error_fallback_message_is_capped_too() {
        let kimi = preset(&HarnessProvider::Kimi);
        let huge = "x".repeat(ERROR_BODY_MAX_CHARS * 2);
        let err = http_error_turn_error(kimi, 502, None, &huge);
        assert_eq!(err.code, "harness_http_error");
        assert!(err.body_truncated);
        assert!(err.message.starts_with("HTTP 502: "), "{}", err.message);
        // 前缀 + 截断后的 body + 省略号，逐项钉住，不靠「差不多」。
        let cap = "HTTP 502: ".chars().count() + ERROR_BODY_MAX_CHARS + 1;
        assert_eq!(
            err.message.chars().count(),
            cap,
            "兜底 message 未按同一上限限长：{} 字符",
            err.message.chars().count()
        );
        assert!(err.message.ends_with('…'), "截断须留可见标记");
    }

    /// 响应头取 request id：按候选名序取第一个在场的。
    #[test]
    fn request_id_from_headers_picks_known_names() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("x-request-id", "req-42".parse().unwrap());
        assert_eq!(request_id_from_headers(&headers).as_deref(), Some("req-42"));
        assert_eq!(
            request_id_from_headers(&reqwest::header::HeaderMap::new()),
            None
        );
    }

    /// 发送量计量：`wire_body_bytes` = 实际 wire body 的序列化字节数（单一构造，非第二套）。
    #[test]
    fn wire_body_bytes_matches_the_serialized_body() {
        let client = ResponsesClient {
            http: reqwest::blocking::Client::new(),
            endpoint: "https://example.invalid/responses".into(),
            api_key: "test-key".into(),
            model: "k3-256k".into(),
            effort_supported: true,
            store_false: true,
            vault_id: "vault-test-1".into(),
            preset: &KIMI_PRESET,
        };
        let request = Request {
            system: "sys".into(),
            input: vec![serde_json::json!({
                "type": "message", "role": "user",
                "content": [{"type": "input_text", "text": "你好"}],
            })],
            tools: vec![serde_json::json!({"type": "function", "name": "vault_read"})],
            effort: ThinkingEffort::High,
        };
        let expected = serde_json::to_vec(&client.wire_body(&request).unwrap())
            .unwrap()
            .len() as u64;
        assert_eq!(client.wire_body_bytes(&request), Some(expected));
        assert!(expected > 0);
        // 真 client 发的 body 带 store:false（kimi）与 reasoning.effort（单一构造点）。
        let body = client.wire_body(&request).unwrap();
        assert_eq!(body["store"], serde_json::json!(false));
        assert_eq!(body["reasoning"]["effort"], serde_json::json!("high"));
        // M464：effort 受支持（= 会发 reasoning）时一并请求 encrypted_content——
        // store:false 官方回放模式的前提（重放 `{summary, encrypted_content}` 不带 id）。
        assert_eq!(
            body["include"],
            serde_json::json!(["reasoning.encrypted_content"])
        );
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
            std::io::Cursor::new(bytes.as_bytes().to_vec()),
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
        // 回放项归一见 M464：id 被剥掉、encrypted_content 保留（去重仍只留一份）。
        let reasoning = output.reasoning.as_ref().expect("reasoning 项");
        assert!(
            reasoning.get("id").is_none(),
            "回放项不得带 id：{reasoning}"
        );
        assert_eq!(reasoning["encrypted_content"], "enc");
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
    /// `response.completed` 双投递。断言：reasoning 归一后 content 形状（reasoning_text
    /// parts，与官方 thinking 文档一致）与 encrypted_content 在列、**`id` 被剥掉**（M464）、
    /// 调用去重、回放构造里 reasoning 项紧随 assistant message 之前。
    #[test]
    fn sse_deepseek_thinking_reasoning_normalized_for_replay() {
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

        // 捕获：reasoning 项已归一（M464）——剥掉 provider 的 `id` / `status`，
        // content（reasoning_text parts）与 encrypted_content 保留。
        let reasoning = output.reasoning.clone().expect("reasoning 项应被捕获");
        assert_eq!(reasoning["type"], "reasoning");
        assert!(
            reasoning.get("id").is_none(),
            "回放项不得带 id（store:false 下重放 id 属非标用法）：{reasoning}"
        );
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

        // 回放构造：归一的 reasoning 项在前，assistant message 在后（session 契约）。
        let items =
            crate::harness::session::assistant_item(&output.text, output.reasoning.as_ref());
        assert_eq!(items.len(), 2);
        assert_eq!(items[0], reasoning, "归一的 reasoning 项应入回放 input");
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

    /// M464：reasoning 回放形状归一（[`normalize_reasoning_item`]）——三种形态 + 幂等 + 非
    /// reasoning 项原样。回放项在任何路径产物中都不得带 `id`（store:false 下重放 id 属非标）。
    #[test]
    fn normalize_reasoning_item_three_forms_strip_id() {
        // ① 新会话带 blob（kimi 形状：id + summary + encrypted_content）⇒ 剥 id/status、
        //    保 summary 与 encrypted_content。
        let kimi = serde_json::json!({
            "type": "reasoning", "id": "rs_abc", "status": "completed",
            "summary": [{"type": "summary_text", "text": "摘要"}],
            "encrypted_content": "blob-1"
        });
        let out = normalize_reasoning_item(&kimi);
        assert_eq!(out["type"], "reasoning");
        assert!(out.get("id").is_none(), "id 必须剥掉：{out}");
        assert!(out.get("status").is_none(), "status 非回放字段：{out}");
        assert_eq!(
            out["summary"],
            serde_json::json!([{"type": "summary_text", "text": "摘要"}])
        );
        assert_eq!(out["encrypted_content"], "blob-1");

        // ② 旧会话无 blob（只有 id + summary）⇒ 降级为「摘要无 id」。
        let old = serde_json::json!({
            "type": "reasoning", "id": "rs_old",
            "summary": [{"type": "summary_text", "text": "旧摘要"}]
        });
        let out_old = normalize_reasoning_item(&old);
        assert!(out_old.get("id").is_none());
        assert!(out_old.get("encrypted_content").is_none());
        assert_eq!(
            out_old["summary"],
            serde_json::json!([{"type": "summary_text", "text": "旧摘要"}])
        );

        // deepseek 形状（content 为 reasoning_text parts）：明文载体 content 与
        // encrypted_content 保留、id 剥掉。
        let ds = serde_json::from_str::<serde_json::Value>(DEEPSEEK_REASONING_ITEM).unwrap();
        let out_ds = normalize_reasoning_item(&ds);
        assert!(out_ds.get("id").is_none());
        assert_eq!(out_ds["content"][0]["type"], "reasoning_text");
        assert_eq!(
            out_ds["encrypted_content"],
            "891a103a-5fff-47b2-899d-573104b0d161-0"
        );

        // 幂等（可无差别作用于整条 input）+ 非 reasoning 项原样通过。
        assert_eq!(normalize_reasoning_item(&out_ds), out_ds);
        let message = serde_json::json!({"type": "message", "role": "user"});
        assert_eq!(normalize_reasoning_item(&message), message);
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
        assert_eq!(
            first.reasoning_deltas,
            vec!["先想".to_string(), "再答".to_string()]
        );
        // 思考分片也即时转发（M369），且转发与记录一致。
        assert_eq!(
            stream.reasoning(),
            vec!["先想".to_string(), "再答".to_string()]
        );
        // 回放项归一回放形状（M464）：剥 id、保 content。
        let reasoning = first.reasoning.as_ref().expect("reasoning 项");
        assert!(
            reasoning.get("id").is_none(),
            "回放项不得带 id：{reasoning}"
        );
        assert_eq!(reasoning["content"][0]["text"], "回放用思考");
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
    // 判据的区分度（REVIEW.md 「断言等价于子串」条）：改动前 `complete` 返回时流式 sink 一个分片都收不到
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

    /// 在途停止的**即时性**（M374）：流停滞的静默窗口（provider 思考期零事件）里点停止，
    /// 读循环要在轮询步长内收流，而不是等下一条数据到达。判据的区分度：旧实现阻塞在
    /// `reader.lines()` 上，第一条事件后要等整个 3 秒停滞睡满才能继续，本用例的
    /// `elapsed < 1s` 必红；新实现读端在独立线程、消费端 100ms 一问，亚秒级收口。
    #[test]
    fn sse_abort_during_silence_returns_promptly() {
        /// 吐出第一条完整 SSE 事件后、剩余的流之前， stall 这么久——模拟思考期的静默窗口。
        struct StallAfterFirstEvent {
            first: std::io::Cursor<Vec<u8>>,
            rest: std::io::Cursor<Vec<u8>>,
            stall: std::time::Duration,
            stalled_once: bool,
        }
        impl std::io::Read for StallAfterFirstEvent {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                let n = self.first.read(buf)?;
                if n > 0 {
                    return Ok(n);
                }
                if !self.stalled_once {
                    self.stalled_once = true;
                    std::thread::sleep(self.stall);
                }
                self.rest.read(buf)
            }
        }

        let first_event = "event: response.output_text.delta\ndata: {\"delta\":\"第一片。\"}\n\n";
        let rest = "event: response.output_text.delta\ndata: {\"delta\":\"第二片。\"}\n\n";
        let reader = StallAfterFirstEvent {
            first: std::io::Cursor::new(first_event.as_bytes().to_vec()),
            rest: std::io::Cursor::new(rest.as_bytes().to_vec()),
            stall: std::time::Duration::from_millis(3000),
            stalled_once: false,
        };
        // 收到 1 个正文分片之后报「已停止」：第一片落地、静默窗口内收流。
        let stream = TestStream::abort_after_text(1);
        let started = std::time::Instant::now();
        let output = parse_sse_reader(
            std::io::BufReader::new(reader),
            preset(&HarnessProvider::Kimi),
            &stream,
        );
        let elapsed = started.elapsed();
        assert_eq!(output.text, "第一片。", "已产出的分片保留");
        assert!(
            elapsed < std::time::Duration::from_secs(1),
            "静默窗口内的停止要在轮询步长内收流，实际耗时 {elapsed:?}"
        );
    }

    /// `chunk_gap` 的即时性（M374）：片间隔改为小步睡眠后，间隔内翻真的停止标志在
    /// 下一个轮询步长被问到即返回——不再睡满整个间隔。判据的区分度：旧实现先睡满
    /// 5000ms 才问，`elapsed < 500ms` 必红。
    #[test]
    fn chunk_gap_aborts_promptly_within_interval() {
        /// 第二次被问起时翻真（第一次问代表「间隔刚开始」，此时还不许停）。
        struct FlipOnSecondPoll(std::sync::Mutex<u32>);
        impl StreamSink for FlipOnSecondPoll {
            fn text_delta(&self, _delta: &str) {}
            fn reasoning_delta(&self, _delta: &str) {}
            fn aborted(&self) -> bool {
                let mut n = self.0.lock().unwrap();
                *n += 1;
                *n > 1
            }
        }
        let started = std::time::Instant::now();
        let proceed = chunk_gap(5000, &FlipOnSecondPoll(std::sync::Mutex::new(0)));
        assert!(!proceed, "停止翻真后节拍不得继续");
        assert!(
            started.elapsed() < std::time::Duration::from_millis(500),
            "片间隔内的停止要亚秒级生效，实际耗时 {:?}",
            started.elapsed()
        );
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
        // 分片之外的非流式字段不受影响（尽力带回）。回放项归一回放形状（M464）：剥 id、
        // 保 encrypted_content。
        let reasoning = output.reasoning.as_ref().expect("reasoning 项");
        assert!(
            reasoning.get("id").is_none(),
            "回放项不得带 id：{reasoning}"
        );
        assert_eq!(reasoning["encrypted_content"], "enc");
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

    // ---- M562：Chat Completions 方言（items → messages 翻译 / body / SSE / usage） ----
    //
    // 判定层全在纯函数：翻译（[`chat_messages`]）、请求构造（`build_wire_body`）、SSE
    // 读循环（`parse_chat_sse_reader`，合成字节流）——不起 HTTP。

    fn chat_client(effort_supported: bool) -> ChatCompletionsClient {
        ChatCompletionsClient {
            http: reqwest::blocking::Client::new(),
            endpoint: "https://example.invalid/chat/completions".into(),
            api_key: "test-key".into(),
            model: "k3-256k".into(),
            effort_supported,
            vault_id: "vault-test-1".into(),
            preset: &KIMI_PRESET,
            diagnostics: Vec::new(),
        }
    }

    fn chat_sse_parse_with(bytes: &str, sink: &dyn StreamSink) -> TurnOutput {
        parse_chat_sse_reader(
            std::io::Cursor::new(bytes.as_bytes().to_vec()),
            &KIMI_PRESET,
            sink,
        )
    }

    /// 翻译总表（design D4）：system 居首、user 文本直出、reasoning 折叠进其后第一条
    /// assistant 消息。多段 reasoning 以空行拼接。
    #[test]
    fn chat_messages_translates_system_user_assistant_with_reasoning() {
        let items = vec![
            serde_json::json!({"role":"user","content":[{"type":"input_text","text":"问题"}]}),
            serde_json::json!({"type":"reasoning","summary":[{"type":"summary_text","text":"第一段"}]}),
            serde_json::json!({"type":"reasoning","content":[{"type":"reasoning_text","text":"第二段"}]}),
            serde_json::json!({"role":"assistant","content":[{"type":"output_text","text":"回答"}]}),
        ];
        let (messages, diagnostics) = chat_messages("SYS", &items);
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        assert_eq!(messages.len(), 3);
        assert_eq!(
            messages[0],
            serde_json::json!({"role":"system","content":"SYS"})
        );
        // 文本直出：单文本 part 压成字符串（chat 的标准形态）。
        assert_eq!(
            messages[1],
            serde_json::json!({"role":"user","content":"问题"})
        );
        // reasoning 折叠（summary / content 两个明文载体都认）+ 多段拼接。
        assert_eq!(messages[2]["role"], "assistant");
        assert_eq!(messages[2]["content"], "回答");
        assert_eq!(messages[2]["reasoning_content"], "第一段\n\n第二段");
        // 源 items 不被改写（留存项 MUST NOT 重写，design D3）。
        assert_eq!(items[1]["summary"][0]["text"], "第一段");
    }

    /// 空 system 不发 system 消息（M372 的空文本 400 纪律）；空正文 assistant 不发消息，
    /// pending reasoning 跨过它继续等下一个可发宿主。
    #[test]
    fn chat_messages_skips_empty_system_and_empty_assistant() {
        let items = vec![
            serde_json::json!({"type":"reasoning","summary":[{"type":"summary_text","text":"思考"}]}),
            serde_json::json!({"role":"assistant","content":[]}),
            serde_json::json!({"role":"assistant","content":[{"type":"output_text","text":"正文"}]}),
        ];
        let (messages, _) = chat_messages("", &items);
        assert_eq!(messages.len(), 1, "{messages:?}");
        assert_eq!(messages[0]["content"], "正文");
        assert_eq!(messages[0]["reasoning_content"], "思考");
    }

    /// 一轮 N 个调用 → 单条 assistant(tool_calls) + 紧随 N 条 tool 消息（中间无其它消息）；
    /// 该轮 reasoning 折叠进 tool_calls 消息（该端点缺 reasoning_content 的 tool 调用 400）。
    #[test]
    fn chat_messages_groups_parallel_calls_then_outputs() {
        let items = vec![
            serde_json::json!({"role":"user","content":[{"type":"input_text","text":"读两个文件"}]}),
            serde_json::json!({"type":"reasoning","summary":[{"type":"summary_text","text":"并行读"}]}),
            serde_json::json!({"type":"function_call","call_id":"c1","name":"vault_read","arguments":"{\"path\":\"a.md\"}"}),
            serde_json::json!({"type":"function_call","call_id":"c2","name":"vault_read","arguments":"{\"path\":\"b.md\"}"}),
            serde_json::json!({"type":"function_call_output","call_id":"c1","output":"A"}),
            serde_json::json!({"type":"function_call_output","call_id":"c2","output":"B"}),
            serde_json::json!({"role":"assistant","content":[{"type":"output_text","text":"都读完了"}]}),
        ];
        let (messages, diagnostics) = chat_messages("SYS", &items);
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        assert_eq!(messages.len(), 6, "{messages:?}");
        let calls_message = &messages[2];
        assert_eq!(calls_message["role"], "assistant");
        assert_eq!(calls_message["content"], serde_json::Value::Null);
        assert_eq!(calls_message["reasoning_content"], "并行读");
        let calls = calls_message["tool_calls"].as_array().unwrap();
        assert_eq!(calls.len(), 2, "一轮多个调用必须合进单条消息");
        assert_eq!(calls[0]["id"], "c1");
        assert_eq!(calls[0]["type"], "function");
        assert_eq!(calls[0]["function"]["name"], "vault_read");
        assert_eq!(calls[0]["function"]["arguments"], "{\"path\":\"a.md\"}");
        assert_eq!(calls[1]["id"], "c2");
        // tool 消息紧随、按输出序、中间无其它消息。
        assert_eq!(
            messages[3],
            serde_json::json!({"role":"tool","tool_call_id":"c1","content":"A"})
        );
        assert_eq!(
            messages[4],
            serde_json::json!({"role":"tool","tool_call_id":"c2","content":"B"})
        );
    }

    /// 同一轮既有正文又有调用（canonical 拆成 reasoning + assistant message + function_call）：
    /// chat 侧必须合成**一条** assistant 消息——正文进 content、reasoning 进 reasoning_content
    /// ——否则 tool_calls 消息缺 reasoning_content 会被端点 400（design D4 的硬约束；chat 一轮
    /// 只能一条 assistant 消息）。
    #[test]
    fn chat_messages_merges_round_text_into_tool_calls_message() {
        let items = vec![
            serde_json::json!({"role":"user","content":[{"type":"input_text","text":"读 a.md"}]}),
            serde_json::json!({"type":"reasoning","summary":[{"type":"summary_text","text":"先读"}]}),
            serde_json::json!({"role":"assistant","content":[{"type":"output_text","text":"我先读一下。"}]}),
            serde_json::json!({"type":"function_call","call_id":"c1","name":"vault_read","arguments":"{}"}),
            serde_json::json!({"type":"function_call_output","call_id":"c1","output":"内容"}),
            serde_json::json!({"role":"assistant","content":[{"type":"output_text","text":"读完了。"}]}),
        ];
        let (messages, diagnostics) = chat_messages("SYS", &items);
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        assert_eq!(messages.len(), 5, "{messages:?}");
        let round = &messages[2];
        assert_eq!(round["role"], "assistant");
        assert_eq!(round["content"], "我先读一下。");
        assert_eq!(round["reasoning_content"], "先读");
        assert_eq!(round["tool_calls"][0]["id"], "c1");
        // 没有出现「正文 assistant + 空 tool_calls assistant」两条并存的形状。
        assert!(messages[3]["role"] == "tool");
        assert_eq!(messages[4]["content"], "读完了。");
    }

    /// 悬空 function_call（有调用无输出）：丢弃 + 诊断；配对的那条照常发。孤立 output 同理。
    #[test]
    fn chat_messages_drops_dangling_call_and_orphan_output_with_diagnostics() {
        let items = vec![
            serde_json::json!({"type":"function_call","call_id":"c1","name":"vault_read","arguments":"{}"}),
            serde_json::json!({"type":"function_call","call_id":"c2","name":"vault_search","arguments":"{}"}),
            serde_json::json!({"type":"function_call_output","call_id":"c2","output":"命中"}),
            serde_json::json!({"type":"function_call_output","call_id":"c_orphan","output":"无主"}),
        ];
        let (messages, diagnostics) = chat_messages("SYS", &items);
        // assistant(tool_calls=[c2]) + tool(c2)。
        assert_eq!(messages.len(), 3, "{messages:?}");
        let calls = messages[1]["tool_calls"].as_array().unwrap();
        assert_eq!(calls.len(), 1, "悬空调用必须丢弃：{calls:?}");
        assert_eq!(calls[0]["id"], "c2");
        assert_eq!(messages[2]["tool_call_id"], "c2");
        // 两条诊断：悬空调用 + 孤立输出（恢复边界的可审计性）。
        let codes: Vec<&str> = diagnostics.iter().map(|d| d.code).collect();
        assert_eq!(
            codes,
            vec!["dangling_function_call", "orphan_function_call_output"]
        );
        assert_eq!(diagnostics[0].call_id, "c1");
        assert!(
            diagnostics[0].message.contains("c1") || diagnostics[0].message.contains("没有配对")
        );
        assert_eq!(diagnostics[1].call_id, "c_orphan");
    }

    /// 全组调用都悬空时不产 assistant 消息（没有宿主），也不产 tool 消息。
    #[test]
    fn chat_messages_all_calls_dangling_emits_nothing() {
        let items = vec![serde_json::json!({
            "type":"function_call","call_id":"c1","name":"vault_read","arguments":"{}"
        })];
        let (messages, diagnostics) = chat_messages("", &items);
        assert!(messages.is_empty(), "{messages:?}");
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].code, "dangling_function_call");
    }

    /// `input_image` → `image_url` content part（展开点不变：调用方已把引用换成 data URL）；
    /// 文本 part 在含图消息里写成 `{type:"text"}`。
    #[test]
    fn chat_messages_translates_image_parts() {
        let items = vec![serde_json::json!({
            "role":"user",
            "content":[
                {"type":"input_text","text":"Image 1"},
                {"type":"input_image","image_url":"data:image/webp;base64,AAAA"}
            ]
        })];
        let (messages, diagnostics) = chat_messages("", &items);
        assert!(diagnostics.is_empty());
        let content = messages[0]["content"]
            .as_array()
            .expect("含图消息必须是 parts");
        assert_eq!(content.len(), 2);
        assert_eq!(
            content[0],
            serde_json::json!({"type":"text","text":"Image 1"})
        );
        assert_eq!(
            content[1],
            serde_json::json!({
                "type":"image_url",
                "image_url":{"url":"data:image/webp;base64,AAAA"}
            })
        );
    }

    /// 请求体形状（spec「发送形状」scenario + design D5/D8）：stream_options、工具定义
    /// 嵌套形态、thinking 只在 effort 受支持时发；MUST NOT 发 include / store / reasoning /
    /// max_tokens / max_completion_tokens。
    #[test]
    fn chat_wire_body_matches_design_shape() {
        let client = chat_client(true);
        let request = Request {
            system: "SYS".into(),
            input: vec![
                serde_json::json!({"role":"user","content":[{"type":"input_text","text":"问"}]}),
            ],
            tools: vec![serde_json::json!({
                "type":"function","name":"vault_read",
                "description":"读文件","parameters":{"type":"object"}
            })],
            effort: ThinkingEffort::Max,
        };
        let (body, diagnostics) = client.build_wire_body(&request).unwrap();
        assert!(diagnostics.is_empty());
        assert_eq!(body["model"], "k3-256k");
        assert_eq!(body["stream"], true);
        assert_eq!(
            body["stream_options"],
            serde_json::json!({"include_usage": true})
        );
        assert_eq!(body["tool_choice"], "auto");
        // Responses 形态 → chat 形态（函数级字段包进 `function`）。
        assert_eq!(body["tools"][0]["type"], "function");
        assert!(body["tools"][0].get("name").is_none(), "{body}");
        assert_eq!(body["tools"][0]["function"]["name"], "vault_read");
        assert_eq!(
            body["tools"][0]["function"]["parameters"],
            serde_json::json!({"type":"object"})
        );
        assert_eq!(
            body["thinking"],
            serde_json::json!({"type":"enabled","effort":"max","keep":"all"})
        );
        for key in [
            "include",
            "store",
            "reasoning",
            "max_tokens",
            "max_completion_tokens",
        ] {
            assert!(body.get(key).is_none(), "MUST NOT 发 {key}：{body}");
        }
        assert_eq!(
            body["messages"][0],
            serde_json::json!({"role":"system","content":"SYS"})
        );
    }

    /// 未声明 effort 的模型 MUST NOT 发 `thinking`；压缩调用（tools 为空）照发空工具表 +
    /// `tool_choice:"auto"`——端点接受该形态（6.4 探针 S1b 实测 200），保持 spec 的发送形状。
    #[test]
    fn chat_wire_body_omits_thinking_for_unsupported_model() {
        let client = chat_client(false);
        let request = Request {
            system: "压缩指令".into(),
            input: vec![
                serde_json::json!({"role":"user","content":[{"type":"input_text","text":"历史"}]}),
            ],
            tools: Vec::new(),
            effort: ThinkingEffort::High,
        };
        let (body, _) = client.build_wire_body(&request).unwrap();
        assert!(body.get("thinking").is_none(), "{body}");
        assert_eq!(body["tools"], serde_json::json!([]));
        assert_eq!(body["tool_choice"], "auto");
    }

    /// 发送量计量与发送共用同一份构造（M463 纪律）：字节数 = 该 body 的序列化长度。
    #[test]
    fn chat_wire_body_bytes_matches_the_serialized_body() {
        let client = chat_client(true);
        let request = Request {
            system: "SYS".into(),
            input: vec![
                serde_json::json!({"role":"user","content":[{"type":"input_text","text":"问"}]}),
            ],
            tools: Vec::new(),
            effort: ThinkingEffort::Low,
        };
        let expected = serde_json::to_vec(&client.build_wire_body(&request).unwrap().0)
            .unwrap()
            .len() as u64;
        assert!(expected > 0);
        assert_eq!(client.wire_body_bytes(&request), Some(expected));
    }

    /// chat SSE：content / reasoning_content 增量即时转发，tool_calls 按 index 分片累积，
    /// usage 帧映射（含 `prompt_tokens_details.cached_tokens` 布局）。`[DONE]` 终止。
    #[test]
    fn chat_sse_accumulates_deltas_calls_and_usage() {
        let sse = r#"data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"第一"}}]}

data: {"choices":[{"index":0,"delta":{"reasoning_content":"先想"}}]}

data: {"choices":[{"index":0,"delta":{"reasoning_content":"再答"}}]}

data: {"choices":[{"index":0,"delta":{"content":"片。"}}]}

data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"vault_read","arguments":"{\"path\":"}}]}}]}

data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"a.md\"}"}}]}}]}

data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_b","type":"function","function":{"name":"vault_search","arguments":"{\"query\":\"q\"}"}}]}}]}

data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}

data: {"choices":[],"usage":{"prompt_tokens":1234,"completion_tokens":56,"prompt_tokens_details":{"cached_tokens":1000},"total_tokens":1290}}

data: [DONE]

"#;
        let stream = TestStream::default();
        let output = chat_sse_parse_with(sse, &stream);
        assert_eq!(output.text, "第一片。");
        // 即时转发：正文与思考各走各的通道，且不是读完后补发。
        assert_eq!(stream.text(), vec!["第一".to_string(), "片。".to_string()]);
        assert_eq!(
            stream.reasoning(),
            vec!["先想".to_string(), "再答".to_string()]
        );
        assert_eq!(output.reasoning_deltas, vec!["先想", "再答"]);
        // 回放项：chat 的 reasoning_content 落成 canonical Responses 形状（kimi summary 载体）。
        let reasoning = output.reasoning.expect("reasoning 回放项");
        assert_eq!(reasoning["type"], "reasoning");
        assert_eq!(reasoning["summary"][0]["type"], "summary_text");
        assert_eq!(reasoning["summary"][0]["text"], "先想再答");
        // tool_calls 按 index 排序、分片拼接。
        let ids: Vec<&str> = output.calls.iter().map(|c| c.call_id.as_str()).collect();
        assert_eq!(ids, vec!["call_a", "call_b"]);
        assert_eq!(output.calls[0].name, "vault_read");
        assert_eq!(output.calls[0].arguments, "{\"path\":\"a.md\"}");
        assert_eq!(output.calls[1].arguments, "{\"query\":\"q\"}");
        // usage 映射（design D6）。
        assert_eq!(
            output.usage,
            Some(Usage {
                input_tokens: 1234,
                cached_tokens: 1000,
                output_tokens: 56,
                cache_write_tokens: 0,
            })
        );
        assert!(output.error.is_none());
    }

    /// cached 的另一种字段布局（顶层 `cached_tokens`）同样兜住；两者都在场时顶层优先
    ///（design D6 的 `usage.cached_tokens ?? prompt_tokens_details.cached_tokens` 顺序）。
    #[test]
    fn chat_usage_supports_both_cached_layouts() {
        let top = chat_usage(&serde_json::json!({
            "prompt_tokens": 100, "completion_tokens": 5, "cached_tokens": 40
        }));
        assert_eq!(top.cached_tokens, 40);
        let both = chat_usage(&serde_json::json!({
            "prompt_tokens": 100, "completion_tokens": 5,
            "cached_tokens": 40,
            "prompt_tokens_details": {"cached_tokens": 90}
        }));
        assert_eq!(both.cached_tokens, 40);
        let missing = chat_usage(&serde_json::json!({
            "prompt_tokens": 100, "completion_tokens": 5
        }));
        assert_eq!(missing.cached_tokens, 0);
        assert_eq!(missing.cache_write_tokens, 0);
        assert_eq!(missing.input_tokens, 100);
        assert_eq!(missing.output_tokens, 5);
    }

    /// 在途停止（与 Responses 侧同语义）：sink 翻真后不再读流——已产出的分片保留、
    /// usage 不落地（incomplete 响应语义，不是错误）。区分度：不中断时三片全在、usage 在场。
    #[test]
    fn chat_sse_abort_keeps_produced_content() {
        let sse = r#"data: {"choices":[{"index":0,"delta":{"content":"第一片。"}}]}

data: {"choices":[{"index":0,"delta":{"content":"第二片。"}}]}

data: {"choices":[{"index":0,"delta":{"content":"第三片。"}}]}

data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3}}

"#;
        let stream = TestStream::abort_after_text(1);
        let output = chat_sse_parse_with(sse, &stream);
        assert_eq!(output.text, "第一片。", "已产出的分片保留");
        assert_eq!(stream.text(), vec!["第一片。".to_string()]);
        assert!(output.usage.is_none(), "收流后不再处理后续事件");
        assert!(output.error.is_none());
    }

    /// 流内 error 帧 → TurnError；chat 的超限文案命中 `context_overflow`（design D7）。
    #[test]
    fn chat_sse_error_frame_maps_overflow() {
        let sse = r#"data: {"error":{"code":"invalid_request_error","message":"Your request exceeded model token limit: 262144 (requested: 300000)"}}

"#;
        let output = chat_sse_parse_with(sse, &TestStream::default());
        let error = output.error.expect("流内错误");
        assert_eq!(error.code, "invalid_request_error");
        assert!(error.context_overflow);
        assert_eq!(error.http_status, None, "流内错误没有 HTTP 面");
    }

    /// 三条 chat 方言超限文案都判 context_overflow（`total message size` / `supports only
    /// 256k context` 是 M562 新增）；Responses 既有文案回归不破。
    #[test]
    fn chat_overflow_indicators_cover_three_dialect_messages() {
        let kimi = preset(&HarnessProvider::Kimi);
        assert!(is_overflow(
            kimi,
            "invalid_request_error",
            "Your request exceeded model token limit: 262144 (requested: 300000)"
        ));
        assert!(is_overflow(
            kimi,
            "invalid_request_error",
            "total message size 2097153 exceeds limit 2097152"
        ));
        assert!(is_overflow(
            kimi,
            "invalid_authentication_error",
            "This model supports only 256k context"
        ));
        // 既有 Responses 文案（M463 回归）。
        assert!(is_overflow(
            kimi,
            "harness_http_error",
            "Your request exceeded k3-256k model token limit: 262144"
        ));
        assert!(!is_overflow(kimi, "rate_limit", "slow down"));
    }

    /// 跨方言恢复（design D3，任务 4.2/4.3）：Responses 时期留存的 `llm_request.request`
    /// 灌回后，chat 翻译逐字段正确；同一输入翻译两次逐字节一致（仅凭 JSONL 可重建
    /// wire 体——无隐藏状态）。
    #[test]
    fn chat_translates_restored_responses_history_field_by_field() {
        // 形状取自会话留存的 llm_request（首轮 → 工具轮 → 答复轮）。
        let recorded: serde_json::Value = serde_json::from_str(
            r#"{
              "kind": "llm_request",
              "request": {
                "provider": "kimi",
                "model": "k3-256k",
                "system": "SYS",
                "messages": [
                  {"role":"user","content":[{"type":"input_text","text":"读 a.md"}]},
                  {"type":"reasoning","summary":[{"type":"summary_text","text":"先读文件"}]},
                  {"type":"function_call","call_id":"call_1","name":"vault_read","arguments":"{\"path\":\"a.md\"}"},
                  {"type":"function_call_output","call_id":"call_1","output":"内容"},
                  {"type":"reasoning","summary":[{"type":"summary_text","text":"再总结"}]},
                  {"role":"assistant","content":[{"type":"output_text","text":"读完了"}]}
                ],
                "params": {"thinking": "high"}
              }
            }"#,
        )
        .unwrap();
        let request = &recorded["request"];
        let system = request["system"].as_str().unwrap();
        let items = request["messages"].as_array().unwrap();
        let (messages, diagnostics) = chat_messages(system, items);
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        assert_eq!(messages.len(), 5, "{messages:?}");
        assert_eq!(
            messages[0],
            serde_json::json!({"role":"system","content":"SYS"})
        );
        assert_eq!(
            messages[1],
            serde_json::json!({"role":"user","content":"读 a.md"})
        );
        // 工具轮：reasoning 折叠进 tool_calls 消息。
        assert_eq!(messages[2]["role"], "assistant");
        assert_eq!(messages[2]["content"], serde_json::Value::Null);
        assert_eq!(messages[2]["reasoning_content"], "先读文件");
        assert_eq!(messages[2]["tool_calls"][0]["id"], "call_1");
        assert_eq!(
            messages[3],
            serde_json::json!({"role":"tool","tool_call_id":"call_1","content":"内容"})
        );
        // 答复轮：reasoning 折叠进 assistant 消息。
        assert_eq!(messages[4]["role"], "assistant");
        assert_eq!(messages[4]["content"], "读完了");
        assert_eq!(messages[4]["reasoning_content"], "再总结");
        // 确定性（逐字节）：同一份 JSONL 输入重建两次结果一致。
        let first = serde_json::to_vec(&messages).unwrap();
        let second = serde_json::to_vec(&chat_messages(system, items).0).unwrap();
        assert_eq!(first, second);
        // 翻译不改写留存项（design D3）：源 items 仍是 Responses 形态。
        assert_eq!(items[1]["type"], "reasoning");
        assert_eq!(items[2]["type"], "function_call");
    }
}
