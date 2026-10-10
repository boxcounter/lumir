//! 会话：一个 vault 的内存态对话状态（design §2「会话边界」）。
//!
//! 一个会话同时维护两份视角：
//! - `input`：OpenAI Responses API 形状的消息项（`session::input_item` 构造），直接喂 LLM；
//! - `panel`：面板渲染模型（role: user/assistant/tool/compact + text/summary/name/status/ts），
//!   是 `harness_state` 快照的消息来源（m303 消费形状）。
//!
//! 两边随同一个动作一起更新，MUST NOT 各自漂移——面板上看到的与模型看到的永远是同一会话。

use std::path::PathBuf;
use std::sync::mpsc::Sender;

use serde::Serialize;
use ts_rs::TS;

use crate::commands::CommandError;

use super::approval::{ApprovalDecision, ApprovalRequest, ApprovalSignal};
use super::jsonl::JsonlWriter;
use super::thinking::ThinkingEffort;

/// 面板消息（`harness_state` 快照 `messages[]` 的元素；m303 宽容解析，缺字段=空态）。
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct PanelMessage {
    /// user / assistant / tool / compact。
    pub role: String,
    /// 完整文本（user/assistant 的主内容）。
    /// **空时不序列化**（`skip_serializing_if`）——TS 侧按「可能缺席」读。
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// 恢复重建的思考展示文本（M398）：仅当 wire 的 reasoning 回放项里取得到**明文**时带值
    /// （kimi 的 `encrypted_content` 项取不到 → 缺省，不伪造）。活会话的思考块由
    /// `reasoning_chunk` 事件驱动、不进面板记录——本字段只在恢复重建的面板消息上有值。
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    /// 摘要（compact 消息的压缩摘要，面板可展开）。
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// 工具名（tool 消息）。
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 执行状态：tool 消息的工具终态（done / denied / rejected / error）；
    /// assistant 消息的中断标注（"stopped" = 本轮被用户停止，面板 D383 徽标的数据源，M348）。
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// 批准闸决定（tool 消息，M413）：进过批准闸的调用带「approved」/「rejected」——
    /// 「已采纳」可见性与免闸直执行的区分靠它（status 两者都是 done）。allow / deny 规则
    /// 路径没有批准动作，字段缺席。快照恢复路径从 JSONL 的 approval sidecar 回填。
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<String>,
    /// 消息入会话的时刻（UNIX 秒）；面板据它显示相对时间（缺该字段的旧快照退化为不显示）。
    // 打戳点是 `Session::push_panel` 的每个构造处，取时用 `super::jsonl::unix_secs_now`——
    // 与留存记录的 `ts` 同一取时点（两处各自取时会漂）。
    // ts-rs 默认把 u64 映成 bigint，而 JSON.parse 出来的是 number：与 FsEntry::size 同处理。
    #[ts(type = "number")]
    pub ts: u64,
}

/// 最近一次请求的用量（面板常驻 ctx% / cache% 的数据源）。
#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct UsageSnapshot {
    /// 上下文窗口已用 %（最近一次 input tokens ÷ 模型窗口，预设表见 [`super::llm`]）。
    pub ctx_pct: f64,
    /// cache hit %（cached tokens ÷ input tokens；无 input 时为 0）。
    pub cache_pct: f64,
}

impl StateSnapshot {
    /// 空态快照（无会话 / 未打开 vault）：面板宽容解析下全空即合法。
    /// `vault` 仍是当前 scope 的键——「这个空态属于哪个 vault」是快照准入判据的一半
    ///（M312：切 vault 之后回来的旧快照要按标识丢弃）。
    ///
    /// `thinking_supported` 由调用侧从配置 schema 现算（`HarnessConfig::effort_supported`，
    /// M373：能力表 = `providers.<id>.models` 的逐模型声明）：
    /// 无会话时档位是默认 High，但「这个 provider 能不能调」与有没有会话无关，空态也要给出
    /// 正确的能力标记，否则面板一打开 chip 会先亮后灰（M362）。
    pub fn empty(vault: &str, warn_ctx_pct: f64, thinking_supported: bool) -> Self {
        Self {
            vault: vault.to_string(),
            messages: Vec::new(),
            usage: UsageSnapshot::default(),
            pending_approval: None,
            warn_ctx_pct,
            thinking: ThinkingState {
                level: ThinkingEffort::default(),
                supported: thinking_supported,
            },
        }
    }
}

/// 思考程度在快照里的读出面（面板思考 chip 的数据源，M362）。
///
/// 键集合与序列化同在 `harness_state` 的 `thinking` 字段里：`level` = 当前档位（会话内生效，
/// 新会话回到默认 High），`supported` = 当前 provider + model 是否支持程度调节
///（false ⇒ 前端置灰禁用 + hover 说明，Alex 2026-10-06 裁决点 2）。
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ThinkingState {
    pub level: ThinkingEffort,
    pub supported: bool,
}

/// `harness_state` 返回的快照（键集合是 m303 消费形状的超集）。
#[derive(Debug, Clone, Serialize)]
pub struct StateSnapshot {
    /// 会话标识 = vault 根路径（M312）：面板据此丢弃「切走之后才回来的」旧快照
    /// （与 `harness:event` 的信封字段同源：都是 `VaultScope::key()`）。
    pub vault: String,
    pub messages: Vec<PanelMessage>,
    pub usage: UsageSnapshot,
    /// 当前挂起的批准请求（无则 null）。
    pub pending_approval: Option<PendingApprovalSnapshot>,
    /// 上下文用量警示阈值（面板警示条用，缺省 85）。
    pub warn_ctx_pct: f64,
    /// 思考程度档位与 provider 能力（面板思考 chip 的数据源，M362）。
    pub thinking: ThinkingState,
}

/// 面板可见的批准请求摘要（不含通道 sender）。
#[derive(Debug, Clone, Serialize)]
pub struct PendingApprovalSnapshot {
    pub id: String,
    pub tool: String,
    /// 写工具的 unified diff 预览（无则缺省）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<String>,
    /// CLI 的完整 argv（无则缺省）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub argv: Option<Vec<String>>,
    /// 批准卡上展示的用途句（cli_run，design §3.4；无则缺省）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
    /// 该卡支持「采纳且本会话不再问」次级动作（design §6；批准闸请求恒 true）——
    /// 面板按钮可见性的数据源。
    pub remember: bool,
}

impl PendingApprovalSnapshot {
    pub fn from_request(r: &ApprovalRequest) -> Self {
        Self {
            id: r.id.clone(),
            tool: r.tool.clone(),
            diff: r.diff.clone(),
            argv: r.argv.clone(),
            purpose: r.purpose.clone(),
            remember: r.remember,
        }
    }
}

/// `harness_resume_session` 的返回（ts-rs 导出；前端恢复 UI mission 的消费形状）：
/// 从留存文件恢复出来的会话**续写的新会话**——新 session id 是新 JSONL 留存的文件名，
/// 前端据此知道「当前会话接在了哪份留存上」，面板重渲染走 `harness_state`。
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SessionResumeInfo {
    /// 续写的新会话 id（`sessions/<vault 稳定 id>/<id>.jsonl` 的文件名）。
    pub session_id: String,
    /// 灌回的 LLM 侧历史条数（`input` 项数）：源文件最后一条会话轮次 llm_request 的
    /// messages，加末尾未入请求的 llm_response 折叠项（design §6.2 第 4 步——reasoning
    /// 回放项 + assistant 消息 + 悬空的 function_call 项）；空会话恢复为 0。
    pub restored_items: usize,
    /// 面板重建用的渲染消息（M398，design §6.2「面板（transcript）从灌回的 input 重建」）：
    /// 把灌回的 input 项按序映射成面板视角的 user / assistant / tool 消息（reasoning 明文
    /// 挂在紧随其后的 assistant 消息上），新会话的 `panel` 与之一致（同一份重建结果的副本，
    /// 快照恢复与本次返回因此不会漂）。前端据此一次重放、不必再拉 `harness_state`。
    pub messages: Vec<PanelMessage>,
}

/// `harness_list_sessions` 的元素（ts-rs 导出；前端会话选择器的消费形状）：
/// 一份本 vault 留存会话的摘要。
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SessionSummary {
    /// 留存文件名去 `.jsonl`（`sessions/<vault 稳定 id>/<session_id>.jsonl`）；也是恢复命令的入参。
    pub session_id: String,
    /// 文件内第一条 `llm_request` 的首条 user 消息的**原始提问段**——自动注入的
    /// 「当前编辑器上下文」节已由后端剥除（`turn.rs` 的 `strip_context_section`；注入形态的
    /// 单一真源在那里）；未截断——会话名「约 20 字」的截断规则在前端。该会话还没有用户消息时为 None。
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_user_text: Option<String>,
    /// 首行 `session_open` 信封的 UNIX 秒（会话建立时刻）；缺 ts 的历史文件为 None。
    // ts-rs 默认把 u64 映成 bigint，而 JSON.parse 出来的是 number：与 `PanelMessage::ts`
    // 同处理。
    #[ts(optional)]
    #[ts(type = "number")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ts: Option<u64>,
}

/// 一个 vault 的会话。
pub struct Session {
    root: PathBuf,
    /// 系统上下文（固定身份段 + AGENTS.md 三层 + Skill 索引 的装配全文），
    /// 会话建立时装配一次；自动压缩开新逻辑会话时重新装配并整体换入。
    system: String,
    /// LLM 侧消息项（Responses API `input` 形状）。**单一事实源**：面板消息由它派生、
    /// 留存里的 `llm_request.messages` 逐字节等于它每次发送时的快照。
    input: Vec<serde_json::Value>,
    /// 面板渲染消息。
    panel: Vec<PanelMessage>,
    usage: UsageSnapshot,
    busy: bool,
    /// 挂起的批准请求（一次一个：一轮里 ask 档逐个过闸）。
    pending: Option<ApprovalRequest>,
    /// 本轮被请求停止（M348）：`harness_abort` 置位、工具循环在检查点收口；
    /// `acquire_turn` 开新一轮时清零。中断语义是「不再继续」，不回滚已产出内容。
    abort_requested: bool,
    /// 最近一次提问注入的「当前编辑器上下文」节（压缩续聊时原样重注入）。
    current_context: Option<String>,
    /// 思考程度档位（M362，Alex 2026-10-06 裁决：Low / High / Max，默认 High）。
    /// **会话内生效、不写回配置**：影响其后发出的消息，新会话（对象被丢弃重造）随之回到默认。
    thinking_effort: ThinkingEffort,
    jsonl: JsonlWriter,
}

impl Session {
    pub fn new(
        root: PathBuf,
        system: String,
        input: Vec<serde_json::Value>,
        thinking_effort: ThinkingEffort,
        jsonl: JsonlWriter,
    ) -> Self {
        Self {
            root,
            system,
            input,
            panel: Vec::new(),
            usage: UsageSnapshot::default(),
            busy: false,
            pending: None,
            abort_requested: false,
            current_context: None,
            thinking_effort,
            jsonl,
        }
    }

    pub fn root(&self) -> &PathBuf {
        &self.root
    }

    pub fn system(&self) -> &str {
        &self.system
    }

    /// 当前思考程度档位（请求构造读它，见 [`super::turn`] 的 `build_request`）。
    pub fn thinking_effort(&self) -> ThinkingEffort {
        self.thinking_effort
    }

    /// 设置档位（`harness_set_thinking_effort` 的落点）。档位同时修正留存首行挂起的
    /// `session_open.thinking`（首条记录落盘前仍可改，落盘后历史不改写）。
    pub fn set_thinking_effort(&mut self, effort: ThinkingEffort) {
        self.thinking_effort = effort;
        let value = effort.as_str();
        self.jsonl
            .update_pending_open(|open| open["thinking"] = value.into());
    }

    pub fn is_busy(&self) -> bool {
        self.busy
    }

    pub fn set_busy(&mut self, busy: bool) {
        self.busy = busy;
    }

    pub fn input(&self) -> &[serde_json::Value] {
        &self.input
    }

    pub fn push_input(&mut self, item: serde_json::Value) {
        self.input.push(item);
    }

    pub fn replace_input(&mut self, items: Vec<serde_json::Value>) {
        self.input = items;
    }

    /// 面板消息入队（`ts` 由构造点用 [`super::jsonl::unix_secs_now`] 打戳——入会话时刻即构造时刻）。
    pub fn push_panel(&mut self, message: PanelMessage) {
        self.panel.push(message);
    }

    pub fn set_usage(&mut self, usage: UsageSnapshot) {
        self.usage = usage;
    }

    pub fn usage(&self) -> UsageSnapshot {
        self.usage
    }

    pub fn jsonl(&mut self) -> &mut JsonlWriter {
        &mut self.jsonl
    }

    /// 换系统上下文 + 换留存句柄（自动压缩开新逻辑会话的落点）：旧文件封闭不再追加，
    /// 新句柄带自己的 `session_open`（opened_from=compact）。输入历史由调用侧替换。
    pub fn rotate(&mut self, system: String, jsonl: JsonlWriter) {
        self.system = system;
        self.jsonl = jsonl;
    }

    pub fn set_current_context(&mut self, section: Option<String>) {
        self.current_context = section;
    }

    pub fn current_context(&self) -> Option<&str> {
        self.current_context.as_deref()
    }

    /// 面板快照。`thinking_supported` 由调用侧从配置 schema 现算
    ///（`HarnessConfig::effort_supported`，M373——会话不知道 provider，能力标记不在这里
    /// 判定）。
    pub fn snapshot(&self, warn_ctx_pct: f64, thinking_supported: bool) -> StateSnapshot {
        StateSnapshot {
            vault: self.root.display().to_string(),
            messages: self.panel.clone(),
            usage: self.usage,
            pending_approval: self
                .pending
                .as_ref()
                .map(PendingApprovalSnapshot::from_request),
            warn_ctx_pct,
            thinking: ThinkingState {
                level: self.thinking_effort,
                supported: thinking_supported,
            },
        }
    }

    /// 挂起批准请求（工具循环线程 park 前调用）。重复挂起即覆盖：旧请求的发送端
    /// 随对象 drop 失效，等待线程走 `approval_stale` 过期路径（不再单独留
    /// `approval_overwritten` 事件——决策类 sidecar 只留 wire 不可推导者）。
    pub fn park_approval(&mut self, request: ApprovalRequest) {
        if self.pending.is_some() {
            eprintln!("lumir: harness 批准请求被覆盖（旧请求按 approval_stale 失效）");
        }
        self.pending = Some(request);
    }

    /// `harness_approve` 的落点：按 id 找到挂起请求并把决定（含「采纳且本会话不再问」
    /// 标志，design §6）发回工具循环线程。remember 随决定走通道，由 turn.rs 的
    /// gated_execute 在 approved && remember 时写会话内批准缓存——缓存写入只在那一处。
    pub fn resolve_approval(
        &mut self,
        request_id: &str,
        approved: bool,
        reason: Option<String>,
        remember: bool,
    ) -> Result<(), CommandError> {
        let pending = self
            .pending
            .take()
            .ok_or_else(|| CommandError::new("approval_not_found", "当前没有待批准的请求"))?;
        if pending.id != request_id {
            // id 不匹配也视为未找到（不消费请求本身）。
            self.pending = Some(pending);
            return Err(CommandError::new(
                "approval_not_found",
                format!("批准请求 {request_id} 不存在或已被处理"),
            ));
        }
        let tx: Sender<ApprovalSignal> = pending.tx;
        self.jsonl.record(&serde_json::json!({
            "kind": "approval",
            "id": pending.id,
            "tool": pending.tool,
            "decision": if approved { "approved" } else { "rejected" },
            "remember": remember,
            "reason": reason,
        }));
        // 发送失败 = 等待线程已不在（会话被重置等），人话报错即可，不 panic。
        tx.send(ApprovalSignal::Decided(ApprovalDecision {
            approved,
            reason,
            remember,
        }))
        .map_err(|_| {
            CommandError::new(
                "approval_stale",
                "批准请求已失效（对话线程已结束），请重试本轮提问",
            )
        })
    }

    /// 本轮被请求停止（M348）：置位标志、收回待决批准项（通道发 Withdrawn）。
    /// 返回是否确实有在途的待决批准项被收回（测试与如实记录用）。中断的留存痕迹
    /// 由工具循环收口时的 `turn_aborted` sidecar 承担（`turn_abort_requested` /
    /// `approval_withdrawn` 是 wire 可推导的，已废弃——批准项的收回结果就是
    /// 「该调用未执行」，随历史进下一条 `llm_request.messages`）。
    pub fn request_abort(&mut self) -> bool {
        self.abort_requested = true;
        let withdrawn = self.pending.take();
        if let Some(request) = &withdrawn {
            // 发失败 = 等待线程已不在，与 resolve_approval 同口径，不 panic。
            let _ = request.tx.send(ApprovalSignal::Withdrawn);
        }
        withdrawn.is_some()
    }

    pub fn abort_requested(&self) -> bool {
        self.abort_requested
    }

    /// 开新一轮时复位中断标志（`acquire_turn` 调用）：上一轮的停止请求不带进新轮。
    pub fn clear_abort(&mut self) {
        self.abort_requested = false;
    }

    /// 中断收口（M348）：把**本轮**最后一条 assistant 面板消息标注为「已停止」
    /// （status = "stopped"，面板 D383 徽标的数据源）。`base` 是一轮开始时面板消息的
    /// 条数（`run_turn_for` 在 user 消息入队后记录）——只在 base 之后的消息里找，
    /// 此前轮次的历史消息绝不误标。返回是否标到了消息——中断发生在任何文本产出之前时
    /// 没有 assistant 消息可标，如实返回 false。
    pub fn mark_last_assistant_stopped(&mut self, base: usize) -> bool {
        let Some(message) = self
            .panel
            .iter_mut()
            .enumerate()
            .rev()
            .find(|(index, m)| *index >= base && m.role == "assistant")
            .map(|(_, m)| m)
        else {
            return false;
        };
        message.status = Some("stopped".to_string());
        true
    }

    /// 面板消息条数（中断标注的 base 计数用）。
    pub fn panel_len(&self) -> usize {
        self.panel.len()
    }
}

// ---------------------------------------------------------------------------
// Responses API 消息项构造（input 数组的三种角色）
// ---------------------------------------------------------------------------

/// user 消息项：`{"role":"user","content":[{"type":"input_text","text":...}]}`。
pub fn user_item(text: &str) -> serde_json::Value {
    serde_json::json!({
        "role": "user",
        "content": [{"type": "input_text", "text": text}],
    })
}

/// assistant 消息项（文本 + 可选 reasoning 项原文，reasoning 按各厂规则原样回传）。
///
/// Responses API 的回放口径：assistant 输出以 message 项承载（content 用 `output_text`），
/// reasoning 项作为独立项**紧随其前**——kimi 的 `encrypted_content` 项、deepseek
/// thinking 的 `reasoning_text` content parts 项同此位置（deepseek 带 tools 时
/// 不回传即 400，M306 真机实测；协议依据见 [`super::llm`] 模块文档）。
///
/// **空正文不发消息项**（M372，真 API 实测）：`text` 为空时（工具轮只发调用、无正文）
/// 返回里只有 reasoning 项、没有 assistant 消息项——空 `output_text` 会原样进下一次
/// 请求的 input，Kimi Code 订阅端（`k3-256k` 等，兼容层）即以
/// `Invalid request: text content is empty` 400 拒掉整条请求。reasoning 项仍原样回传
/// （M306 纪律一行不改）。
pub fn assistant_item(text: &str, reasoning: Option<&serde_json::Value>) -> Vec<serde_json::Value> {
    let mut items = Vec::new();
    if let Some(r) = reasoning {
        items.push(r.clone());
    }
    if !text.is_empty() {
        items.push(serde_json::json!({
            "role": "assistant",
            "content": [{"type": "output_text", "text": text}],
        }));
    }
    items
}

/// 工具调用与结果对：function_call 项（回放模型自己的调用）+ function_call_output 项。
///
/// 入 input 的**顺序**是 provider 合同：同一轮的调用项须成组在输出项之前（交错即 400，
/// M360 真 API 实测；成组压栈的唯一落点是 [`super::turn`] 的 `flush_call_items`）。
pub fn function_call_item(call_id: &str, name: &str, arguments: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "function_call",
        "call_id": call_id,
        "name": name,
        "arguments": arguments,
    })
}

pub fn function_call_output_item(call_id: &str, output: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "function_call_output",
        "call_id": call_id,
        "output": output,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// M372：空正文的 assistant 消息项不进回放 input（Kimi Code 订阅端对空 `output_text`
    /// 整条 400：`Invalid request: text content is empty`）。reasoning 项不受文本空否影响，
    /// 按 M306 纪律原样回传。
    #[test]
    fn assistant_item_omits_empty_text_message() {
        // 空正文且无 reasoning：什么都不产出（工具轮的常态——调用项另走
        // function_call_item，不经本函数）。
        assert!(assistant_item("", None).is_empty());
        // 空正文但有 reasoning：只有 reasoning 项。
        let reasoning = serde_json::json!({"type": "reasoning", "id": "rs_1"});
        let items = assistant_item("", Some(&reasoning));
        assert_eq!(items, vec![reasoning.clone()]);
        // 非空正文：reasoning 在前、消息项在后（M306 形状不变）。
        let items = assistant_item("答案", Some(&reasoning));
        assert_eq!(items.len(), 2);
        assert_eq!(items[0], reasoning);
        assert_eq!(items[1]["role"], "assistant");
        assert_eq!(items[1]["content"][0]["type"], "output_text");
        assert_eq!(items[1]["content"][0]["text"], "答案");
        // 无 reasoning 的非空正文：单消息项。
        let items = assistant_item("只有正文", None);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["role"], "assistant");
    }
}
