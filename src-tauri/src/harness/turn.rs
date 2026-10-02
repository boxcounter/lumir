//! 工具循环编排（design §4、§9）：一轮提问 = user 消息入队 → LLM 往返（每轮把
//! tool_calls 逐个执行、结果回送）→ 无调用或达 `loop_max` 终止。加上下文注入、
//! 批准闸挂起、自动压缩与超限重试。
//!
//! 线程模型：本模块的函数都跑在 `lumir-harness-llm` 专线程（command 层 spawn）。
//! 会话锁的持有纪律：**只在读写会话的那一刻持锁**，LLM 调用与批准等待都在锁外
//! （一轮可能流式几分钟，持锁会把 `harness_state` / 批准通道全堵住）。

use std::sync::mpsc;

use serde::Deserialize;

use crate::commands::CommandError;
use crate::config::HarnessConfig;

use super::approval::ApprovalRequest;
use super::events::{self, EventSink};
use super::llm::{self, LlmClient};
use super::permissions::{self, Decision};
use super::session::{self, PanelMessage};
use super::tools::{self, ToolContext, ToolOutput};
use super::{Runtime, VaultScope};

/// TS 侧组装的结构化上下文块（tower 钉死形状，宽容解析）：
/// `{"path":"a/b.md","selection":{"from_line":3,"to_line":7,"text":"…"}}` 或
/// 同款 `viewport_range`。行号 1-based 闭区间；`path` 可缺（= 无编辑器上下文）。
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ContextBlock {
    pub path: Option<String>,
    #[serde(default)]
    pub selection: Option<RangeBlock>,
    #[serde(default)]
    pub viewport_range: Option<RangeBlock>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RangeBlock {
    pub from_line: Option<u64>,
    pub to_line: Option<u64>,
    #[serde(default)]
    pub text: Option<String>,
}

/// 解析 context_json：非法 JSON / 非对象 / path 非字符串 ⇒ CommandError（拒绝本次发送，
/// 不空转线程）。字段宽容：缺省即空块。
pub fn parse_context(context_json: &str) -> Result<ContextBlock, CommandError> {
    if context_json.trim().is_empty() {
        return Ok(ContextBlock::default());
    }
    let value: serde_json::Value = serde_json::from_str(context_json).map_err(|e| {
        CommandError::new(
            "harness_context_invalid",
            format!("上下文块不是合法 JSON：{e}"),
        )
    })?;
    if !value.is_object() {
        return Err(CommandError::new(
            "harness_context_invalid",
            "上下文块必须是 JSON 对象",
        ));
    }
    let block: ContextBlock = serde_json::from_value(value).map_err(|e| {
        CommandError::new("harness_context_invalid", format!("上下文块形状非法：{e}"))
    })?;
    if let Some(path) = &block.path {
        if path.is_empty() {
            return Err(CommandError::new(
                "harness_context_invalid",
                "上下文块的 path 为空",
            ));
        }
    }
    Ok(block)
}

/// 把上下文块格式化成注入 user 消息的「当前编辑器上下文」节（压缩续聊时原样重注入）。
pub fn context_section(block: &ContextBlock) -> Option<String> {
    let path = block.path.as_ref()?;
    let mut out = format!("当前编辑器上下文：\n文件：{path}");
    let (kind, range) = if let Some(selection) = &block.selection {
        ("选区", Some(selection))
    } else if let Some(viewport) = &block.viewport_range {
        ("视口", Some(viewport))
    } else {
        ("", None)
    };
    if let Some(range) = range {
        let lines = match (range.from_line, range.to_line) {
            (Some(from), Some(to)) => format!("（第 {from}-{to} 行）"),
            _ => String::new(),
        };
        out.push_str(&format!("\n{kind}{lines}："));
        match &range.text {
            Some(text) => out.push_str(&format!("\n{text}")),
            None => out.push_str("（无文本）"),
        }
    }
    Some(out)
}

/// user 消息全文 = 提问 + 上下文节。
pub fn assemble_user_message(message: &str, block: &ContextBlock) -> String {
    match context_section(block) {
        Some(section) => format!("{message}\n\n[{section}]"),
        None => message.to_string(),
    }
}

/// run_turn 的 tauri 入口（command 层 spawn 在 `lumir-harness-llm` 专线程上跑）。
///
/// panic 收口（r1 P2-3）：线程中途 panic 若不收口，busy 标志永久残留、
/// `harness_new_session` 又被 busy 挡住——该 vault 的 harness 到 app 重启前全瘫。
/// `catch_unwind` 兜底：panic 路径发 error 事件并照常释放 busy（会话锁已改为
/// poison 容忍，恐慌后仍可取回）。
pub fn run_turn(
    app: tauri::AppHandle,
    runtime: Runtime,
    scope: VaultScope,
    config: HarnessConfig,
    message: String,
) {
    let sink = TauriEventSink(app);
    let mut client = match llm::client(&config) {
        Ok(client) => client,
        Err(e) => {
            // 配置级失败（mock fixture 缺失 / api_key 未配）：错误事件即终态。
            sink.emit(events::error(&e.code, &e.message));
            runtime.release_turn(&scope);
            return;
        }
    };
    let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run_turn_for(&sink, &runtime, &scope, &config, message, client.as_mut());
    }))
    .is_err();
    if panicked {
        sink.emit(events::error(
            "harness_internal_error",
            "对话线程发生内部错误，本轮已终止；请重试，必要时开新会话",
        ));
    }
    runtime.release_turn(&scope);
}

/// 循环本体（client 与 sink 注入，单测直接驱动）。
///
/// 会话存在性由 busy 协议保证（`acquire_turn` 建会话、busy 期间 `new_session` /
/// 切 vault 都被挡），循环中途的 `with_session` 只会 Ok，忽略其 Err 不是吞错。
pub fn run_turn_for(
    sink: &dyn EventSink,
    runtime: &Runtime,
    scope: &VaultScope,
    config: &HarnessConfig,
    message: String,
    client: &mut dyn LlmClient,
) {
    // user 消息入队（LLM 侧 + 面板侧 + JSONL + 上下文节记录，压缩重注入用）。
    let section = extract_section(&message);
    let enqueue = runtime.with_session(scope, |s| {
        s.push_input(session::user_item(&message));
        s.push_panel(PanelMessage {
            role: "user".into(),
            text: Some(message.clone()),
            summary: None,
            name: None,
            status: None,
        });
        s.set_current_context(section);
        s.jsonl().record(&serde_json::json!({
            "kind": "user_message",
            "text": message,
        }));
    });
    if let Err(e) = enqueue {
        sink.emit(events::error(&e.code, &e.message));
        return;
    }

    let skills = super::context::discover_skills(&scope.root);
    let tctx = ToolContext {
        root: &scope.root,
        policy: &scope.policy,
        skills: &skills,
    };

    let mut rounds: usize = 0;
    let mut overflow_retried = false;
    loop {
        if rounds >= config.loop_max as usize {
            loop_max_notice(sink, runtime, scope, config);
            break;
        }
        rounds += 1;

        let request = build_request(runtime, scope);
        let output = client.complete(&request);

        // —— 错误路径：上下文超限可压缩重试一次，其余错误即终态 ——
        if let Some(error) = output.error {
            if error.context_overflow && config.auto_compact && !overflow_retried {
                overflow_retried = true;
                rounds -= 1; // 重试同一轮，不占循环额度
                match compact_now(sink, runtime, scope, client, "overflow") {
                    Ok(()) => continue,
                    Err(e) => {
                        sink.emit(events::error(&e.code, &e.message));
                        return;
                    }
                }
            }
            let _ = runtime.with_session(scope, |s| {
                s.jsonl().record(&serde_json::json!({
                    "kind": "llm_error",
                    "code": error.code,
                    "message": error.message,
                }));
            });
            sink.emit(events::error(&error.code, &error.message));
            return;
        }

        // —— 流式文本与输出项入队 ——
        for delta in &output.text_deltas {
            sink.emit(events::text_chunk(delta));
        }
        let assistant_text = output.text.clone();
        let usage = output.usage.map(|usage| {
            let preset = llm::preset(&config.provider);
            let window = llm::context_window(preset, active_model(config));
            (usage, llm::usage_snapshot(&usage, window))
        });
        let _ = runtime.with_session(scope, |s| {
            for item in session::assistant_item(&assistant_text, output.reasoning.as_ref()) {
                s.push_input(item);
            }
            s.push_panel(PanelMessage {
                role: "assistant".into(),
                text: Some(assistant_text.clone()),
                summary: None,
                name: None,
                status: None,
            });
            s.jsonl().record(&serde_json::json!({
                "kind": "assistant_text",
                "text": assistant_text,
            }));
            if let Some((usage, snapshot)) = usage {
                s.set_usage(snapshot);
                s.jsonl().record(&serde_json::json!({
                    "kind": "usage",
                    "input_tokens": usage.input_tokens,
                    "cached_tokens": usage.cached_tokens,
                    "output_tokens": usage.output_tokens,
                }));
            }
        });
        if let Some((_, snapshot)) = usage {
            sink.emit(events::usage(snapshot.ctx_pct, snapshot.cache_pct));
        }

        if output.is_empty_response() {
            sink.emit(events::error(
                "harness_empty_response",
                "模型返回了空响应（无文本也无工具调用），本轮已停止",
            ));
            return;
        }

        if output.calls.is_empty() {
            // 轮完成：按 design §9 检查自动压缩（越阈值即压缩续聊；失败不阻断）。
            if config.auto_compact {
                if let Some((_, snapshot)) = usage {
                    if snapshot.ctx_pct >= config.warn_ctx_pct {
                        let _ = compact_now(sink, runtime, scope, client, "threshold");
                    }
                }
            }
            break;
        }

        // —— 逐个执行工具调用（allow 直执行 / deny 回送 / ask 走批准闸）——
        for call in &output.calls {
            handle_call(sink, runtime, scope, config, &tctx, call);
        }
    }
    sink.emit(events::done());
}

/// 从已装配的 user 消息里拆出上下文节（存入会话，压缩重注入用）。
fn extract_section(message: &str) -> Option<String> {
    message.split("\n\n[").nth(1).map(|rest| format!("[{rest}"))
}

/// 当前生效模型名（ctx% 的窗口查表用）。
fn active_model(config: &HarnessConfig) -> &str {
    match config.provider {
        crate::config::HarnessProvider::Kimi => &config.providers.kimi.model,
        crate::config::HarnessProvider::Deepseek => &config.providers.deepseek.model,
        crate::config::HarnessProvider::Mock => &config.providers.kimi.model,
    }
}

/// 构造 LLM 请求（系统上下文 + 全部历史 + 工具定义；会话历史每轮整体序列化，克隆即可）。
fn build_request(runtime: &Runtime, scope: &VaultScope) -> llm::Request {
    let (system, input) = runtime
        .with_session(scope, |s| (s.system().to_string(), s.input().to_vec()))
        .unwrap_or_default();
    llm::Request {
        system,
        input,
        tools: tools::definitions(),
    }
}

/// loop_max 终止提示（面板可见：assistant 消息 + 事件 + JSONL 记录）。
fn loop_max_notice(
    sink: &dyn EventSink,
    runtime: &Runtime,
    scope: &VaultScope,
    config: &HarnessConfig,
) {
    let text = format!(
        "已达到工具循环上限（{} 轮），本轮已停止。问题可能过大，建议开新会话后拆小提问。",
        config.loop_max
    );
    let _ = runtime.with_session(scope, |s| {
        for item in session::assistant_item(&text, None) {
            s.push_input(item);
        }
        s.push_panel(PanelMessage {
            role: "assistant".into(),
            text: Some(text.clone()),
            summary: None,
            name: None,
            status: None,
        });
        s.jsonl().record(&serde_json::json!({
            "kind": "loop_max_reached",
            "loop_max": config.loop_max,
        }));
    });
    sink.emit(events::text_chunk(&text));
}

/// 单个工具调用：权限判定 → （ask 档）批准闸 → 执行 → 结果回送（入队 + 事件 + JSONL）。
fn handle_call(
    sink: &dyn EventSink,
    runtime: &Runtime,
    scope: &VaultScope,
    config: &HarnessConfig,
    tctx: &ToolContext,
    call: &llm::ToolCall,
) {
    sink.emit(events::tool_call(
        &call.name,
        "started",
        &summarize_args(&call.arguments),
    ));
    let parsed: Result<serde_json::Value, _> = serde_json::from_str(&call.arguments);
    let args_ok = parsed.is_ok();
    let args = parsed.unwrap_or_default();
    // 未知工具（清单外）：直接回送错误，不进权限判定——它不可执行，走 ask 闸
    // 只会把循环挂死在永远等不到的批准上（工具集是闭集合，MUST NOT 扩张）。
    let known = tools::TOOL_NAMES.contains(&call.name.as_str());
    let subject = tools::permission_subject(&call.name, &args);
    let decision = permissions::decide(&config.permissions, &call.name, &subject);

    let output = if !known {
        ToolOutput::err("tool_unknown", format!("未知工具：{}", call.name))
    } else if !args_ok {
        ToolOutput::err("tool_args_invalid", "工具调用的 arguments 不是合法 JSON")
    } else {
        match decision {
            Decision::Deny => {
                let out = ToolOutput::err(
                    "permission_denied",
                    format!("权限规则拒绝了 {}（{subject}）", call.name),
                );
                let _ = runtime.with_session(scope, |s| {
                    s.jsonl().record(&serde_json::json!({
                        "kind": "tool_denied",
                        "name": call.name,
                        "subject": subject,
                    }));
                });
                out
            }
            Decision::Allow => tools::execute(&call.name, &args, tctx),
            Decision::Ask => gated_execute(sink, runtime, scope, tctx, call, &args),
        }
    };

    // 细分终态（面板快照 PanelMessage.status 用）：done / denied / rejected / error。
    let status = if output.succeeded() {
        "done"
    } else {
        match output.value["code"].as_str() {
            Some("permission_denied") => "denied",
            Some("approval_rejected") => "rejected",
            _ => "error",
        }
    };
    // 事件 status 只发契约内的 started|done（m303 面板按非 done 即 started 归并——
    // 发细分值会产生永不完结的「正在执行」幻影行）；细分状态放 summary（D344 展示）。
    sink.emit(events::tool_call(
        &call.name,
        "done",
        &summarize_result(status, &output),
    ));
    let output_text = serde_json::to_string(&output.value).unwrap_or_default();
    let _ = runtime.with_session(scope, |s| {
        s.push_input(session::function_call_item(
            &call.call_id,
            &call.name,
            &call.arguments,
        ));
        s.push_input(session::function_call_output_item(
            &call.call_id,
            &output_text,
        ));
        s.push_panel(PanelMessage {
            role: "tool".into(),
            text: Some(output_text.clone()),
            summary: None,
            name: Some(call.name.clone()),
            status: Some(status.to_string()),
        });
        s.jsonl().record(&serde_json::json!({
            "kind": "tool_call",
            "id": call.call_id,
            "name": call.name,
            "arguments": call.arguments,
            "decision": match decision {
                Decision::Allow => "allow",
                Decision::Ask => "ask",
                Decision::Deny => "deny",
            },
        }));
        s.jsonl().record(&serde_json::json!({
            "kind": "tool_result",
            "id": call.call_id,
            "ok": output.succeeded(),
            "output": output.value,
        }));
    });
}

/// ask 档：生成预览 → 挂起批准 → 等决定 → 采纳执行 / 拒绝回送。
fn gated_execute(
    sink: &dyn EventSink,
    runtime: &Runtime,
    scope: &VaultScope,
    tctx: &ToolContext,
    call: &llm::ToolCall,
    args: &serde_json::Value,
) -> ToolOutput {
    let preview = match tools::approval_preview(&call.name, args, tctx) {
        Ok(preview) => preview,
        // 预览失败（如 patch 不唯一命中）：错误直接回送模型，不进批准闸。
        Err(output) => return output,
    };
    let (tx, rx) = mpsc::channel();
    let request = ApprovalRequest::new(
        call.name.clone(),
        preview.diff.clone(),
        preview.argv.clone(),
        tx,
    );
    let id = match runtime.park_approval(scope, request) {
        Ok(id) => id,
        Err(e) => return ToolOutput::from_command_error(&e),
    };
    sink.emit(events::approval_request(
        &id,
        &call.name,
        preview.diff.as_deref(),
        preview.argv.as_deref(),
    ));
    // 未决批准项不自动超时通过：无超时地等决定（会话被重置 / vault 切换使发送端
    // 失效时 recv 报错 → 判过期，不执行）。
    let decision = match rx.recv() {
        Ok(decision) => decision,
        Err(_) => {
            return ToolOutput::err(
                "approval_stale",
                "批准通道已关闭（会话被重置或 vault 已切换），本次调用未执行",
            )
        }
    };
    if decision.approved {
        // 写工具带预览基准 revision 执行：批准窗内文件被改 ⇒ fs_patch_file CAS
        // 拒掉（document_conflict 回送模型），落盘不与已批准 diff 分叉。
        tools::execute_with_revision(&call.name, args, tctx, preview.revision.as_deref())
    } else {
        let reason = decision
            .reason
            .clone()
            .unwrap_or_else(|| "用户拒绝了该操作".to_string());
        ToolOutput::err("approval_rejected", reason)
    }
}

/// 压缩续聊（design §9，裁决点 6）：会话历史压成摘要 → 开新逻辑会话注入
/// 摘要 + 当前编辑器上下文（系统上下文是请求的 instructions 段，不在历史里，
/// 天然原样保留——AGENTS.md / Skill 索引不随压缩丢）。压缩前历史 JSONL 已逐条
/// 留存（append-only）。失败不阻断对话，由调用点决定是否终态。
fn compact_now(
    sink: &dyn EventSink,
    runtime: &Runtime,
    scope: &VaultScope,
    client: &mut dyn LlmClient,
    reason: &str,
) -> Result<(), CommandError> {
    const COMPACT_INSTRUCTION: &str = "\
把以下对话历史压缩成一份续聊摘要，供新会话接着工作：保留用户的目标与关键诉求、\
已经确认的决策、工具调用的关键结果（读了什么、改了什么、批准与否）、尚未完成的动作。\
丢掉逐字过程与重复内容。用与用户相同的语言写摘要。";

    let input = runtime.with_session(scope, |s| s.input().to_vec())?;
    let history = render_history(&input);
    let output = client.complete(&llm::Request {
        system: COMPACT_INSTRUCTION.to_string(),
        input: vec![session::user_item(&format!(
            "{COMPACT_INSTRUCTION}\n\n===== 对话历史 =====\n{history}"
        ))],
        tools: Vec::new(),
    });
    let summary = match output {
        llm::TurnOutput { error: Some(e), .. } => {
            return Err(CommandError::new(
                "harness_compact_failed",
                format!("压缩摘要生成失败（{}）：{}", e.code, e.message),
            )
            .param("code", e.code.clone())
            .param("reason", e.message.clone()))
        }
        llm::TurnOutput { ref text, .. } if text.trim().is_empty() => {
            return Err(CommandError::new(
                "harness_compact_empty",
                "压缩摘要生成为空，无法开新逻辑会话",
            ))
        }
        llm::TurnOutput { text, .. } => text,
    };
    let context_section =
        runtime.with_session(scope, |s| s.current_context().map(str::to_string))?;
    let _ = runtime.with_session(scope, |s| {
        let mut items = vec![session::user_item(&format!(
            "（此前会话已压缩为摘要，接着摘要继续）\n{summary}"
        ))];
        if let Some(section) = &context_section {
            items.push(session::user_item(section));
        }
        s.replace_input(items);
        s.push_panel(PanelMessage {
            role: "compact".into(),
            text: None,
            summary: Some(summary.clone()),
            name: None,
            status: None,
        });
        s.jsonl().record(&serde_json::json!({
            "kind": "compact",
            "reason": reason,
            "summary": summary,
        }));
    });
    sink.emit(events::compact(&summary));
    Ok(())
}

/// 历史渲染成压缩输入文本（user/assistant message + function_call/output 项）。
fn render_history(input: &[serde_json::Value]) -> String {
    let mut out = String::new();
    for item in input {
        match item.get("role").and_then(|r| r.as_str()) {
            Some(role @ ("user" | "assistant")) => {
                out.push_str(&format!("[{role}] {}\n", content_text(item)));
            }
            _ => match item.get("type").and_then(|t| t.as_str()) {
                Some("function_call") => out.push_str(&format!(
                    "[tool_call {}] {}\n",
                    item.get("name").and_then(|n| n.as_str()).unwrap_or(""),
                    item.get("arguments").and_then(|a| a.as_str()).unwrap_or("")
                )),
                Some("function_call_output") => {
                    let text = item
                        .get("output")
                        .and_then(|o| o.as_str())
                        .map(truncate_history_line)
                        .unwrap_or_default();
                    out.push_str(&format!("[tool_result] {text}\n"));
                }
                _ => {}
            },
        }
    }
    out
}

fn content_text(item: &serde_json::Value) -> String {
    item.get("content")
        .and_then(|c| c.as_array())
        .map(|parts| {
            parts
                .iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

fn truncate_history_line(text: &str) -> String {
    const MAX: usize = 500;
    if text.chars().count() > MAX {
        format!("{}…", text.chars().take(MAX).collect::<String>())
    } else {
        text.to_string()
    }
}

fn summarize_args(arguments: &str) -> String {
    const MAX: usize = 80;
    if arguments.chars().count() > MAX {
        format!("{}…", arguments.chars().take(MAX).collect::<String>())
    } else {
        arguments.to_string()
    }
}

/// 工具终态摘要（事件 summary 字段）：细分状态 + 结果代码/消息，面板 D344 展示。
/// `status` 是面板快照层的细分值（done/denied/rejected/error）。
fn summarize_result(status: &str, output: &ToolOutput) -> String {
    if output.succeeded() {
        "成功".to_string()
    } else {
        format!(
            "{status} · {}: {}",
            output.value["code"].as_str().unwrap_or("error"),
            output.value["message"]
                .as_str()
                .unwrap_or("")
                .chars()
                .take(80)
                .collect::<String>()
        )
    }
}

/// AppHandle 事件发射（真机路径；payload 是 JSON 对象，m303 零改动接入）。
struct TauriEventSink(tauri::AppHandle);

impl EventSink for TauriEventSink {
    fn emit(&self, payload: serde_json::Value) {
        use tauri::Emitter;
        let _ = self.0.emit(events::EVENT_NAME, payload);
    }
}
