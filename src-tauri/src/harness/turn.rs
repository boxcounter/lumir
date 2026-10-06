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

use super::approval::{ApprovalRequest, ApprovalSignal};
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

/// 装配结果：`text` 是发给模型的 user 消息全文，`context_section` 是**同一次生成**的
/// 上下文节（带方括号）——会话存下它、压缩续聊时原样重注入。两者同源：调用侧直接把
/// 这个节交给会话，不再从拼好的串里重解析（`extract_section` 已删，见 M309——正文含
/// `\n\n[` 时按分隔符切分会前移切分点、把正文误当上下文节）。
pub struct AssembledMessage {
    pub text: String,
    pub context_section: Option<String>,
}

/// user 消息装配 = 提问 + 上下文节；节同时作为结构化值返回供会话留存（同一次生成）。
pub fn assemble_user_message(message: &str, block: &ContextBlock) -> AssembledMessage {
    match context_section(block) {
        Some(section) => {
            let bracketed = format!("[{section}]");
            AssembledMessage {
                text: format!("{message}\n\n{bracketed}"),
                context_section: Some(bracketed),
            }
        }
        None => AssembledMessage {
            text: message.to_string(),
            context_section: None,
        },
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
    context_section: Option<String>,
) {
    // 事件信封（M312）：每个 harness:event 都带 vault 根路径（= 会话标识），前端据此只渲染
    // 当前 vault 的会话。包装放在本函数——生产路径上唯一的装配点，下面十几处发射点与
    // `run_turn_for` 都不必各带一个 vault 参数。
    let app_sink = TauriEventSink(app);
    let sink = events::ScopedSink::new(&app_sink, scope.key());
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
        run_turn_for(
            &sink,
            &runtime,
            &scope,
            &config,
            message,
            context_section,
            client.as_mut(),
        );
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
/// 事件信封（vault 标识）由**调用侧包装好的 sink** 承担（`run_turn` 用 [`super::events::ScopedSink`]
/// 包了一层）；本函数不自己盖，单测可以直接注入自己的收集器。
///
/// 会话存在性由 busy 协议保证（`acquire_turn` 建会话、busy 期间 `new_session` /
/// 切 vault 都被挡），循环中途的 `with_session` 只会 Ok，忽略其 Err 不是吞错。
pub fn run_turn_for(
    sink: &dyn EventSink,
    runtime: &Runtime,
    scope: &VaultScope,
    config: &HarnessConfig,
    message: String,
    context_section: Option<String>,
    client: &mut dyn LlmClient,
) {
    // user 消息入队（LLM 侧 + 面板侧 + JSONL + 上下文节记录，压缩重注入用）。
    // 上下文节由调用侧从 ContextBlock **同一次生成**并传入（装配与存储同源，M309）——
    // 不再从拼好的 message 里重解析（正文含 `\n\n[` 时会串味）。
    let enqueue = runtime.with_session(scope, |s| {
        s.push_input(session::user_item(&message));
        s.push_panel(PanelMessage {
            role: "user".into(),
            text: Some(message.clone()),
            summary: None,
            name: None,
            status: None,
        });
        s.set_current_context(context_section);
        s.jsonl().record(&serde_json::json!({
            "kind": "user_message",
            "text": message,
        }));
    });
    if let Err(e) = enqueue {
        sink.emit(events::error(&e.code, &e.message));
        return;
    }
    // 中断标注的 base：本轮起点（user 消息已入队）——`abort_turn` 只在此后的消息里
    // 找 assistant 标注「已停止」，此前轮次的历史消息绝不误标（M348）。
    let panel_base = runtime.with_session(scope, |s| s.panel_len()).unwrap_or(0);

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

        // —— 停止检查点 ①（M348）：complete 在途期间被请求停止——产出保留、不再继续。
        // 中断优先于错误/空响应判定：用户已表态「不再继续」，别再追错误行。
        if turn_aborted(runtime, scope) {
            abort_turn(sink, runtime, scope, panel_base, &output);
            return;
        }

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
        // 停止检查点 ②（M348）：本轮文本已入队后、逐调用执行前查标志——
        // 中断时不再执行余下调用（含批准闸等待中的待决项，已由 request_abort 收回）。
        for call in &output.calls {
            if turn_aborted(runtime, scope) {
                abort_turn(
                    sink,
                    runtime,
                    scope,
                    panel_base,
                    &llm::TurnOutput::default(),
                );
                return;
            }
            handle_call(sink, runtime, scope, config, &tctx, call);
        }
        // 停止检查点 ③：中断落在最后一个调用的执行期间——不在此收口的话循环会
        // 白多跑一轮 LLM 往返才在检查点 ① 被截住（「不再继续」以最早检查点为准）。
        if turn_aborted(runtime, scope) {
            abort_turn(
                sink,
                runtime,
                scope,
                panel_base,
                &llm::TurnOutput::default(),
            );
            return;
        }
    }
    sink.emit(events::done());
}

/// 本轮是否已被请求停止（会话在 busy 协议下必然存在；Err 按未停止处理——
/// 该路径只在会话被并发重置时出现，重置后循环的后续 with_session 同样会 Err，
/// 收口由错误事件路径承担）。
fn turn_aborted(runtime: &Runtime, scope: &VaultScope) -> bool {
    runtime
        .with_session(scope, |s| s.abort_requested())
        .unwrap_or(false)
}

/// 中断收口（M348，design §5「不再继续」语义）：
/// - 已产出内容保留：`output` 里本轮拿到的文本照常入队（LLM 侧 + 面板侧 + JSONL +
///   text_chunk 事件），面板消息标 `status = "stopped"`（标注「已停止」）；`output`
///   为空（中断落在工具执行段）时标注落在既有的本轮 assistant 消息上；
/// - 不再继续：调用 / 用量 / 自动压缩一律不处理；
/// - 如实留痕：JSONL 记 `turn_aborted`，事件发 `aborted`（面板经与 done 同一出口回
///   idle，composer 立即可开新一轮）。
fn abort_turn(
    sink: &dyn EventSink,
    runtime: &Runtime,
    scope: &VaultScope,
    panel_base: usize,
    output: &llm::TurnOutput,
) {
    let assistant_text = output.text.clone();
    let _ = runtime.with_session(scope, |s| {
        if !assistant_text.is_empty() {
            for delta in &output.text_deltas {
                sink.emit(events::text_chunk(delta));
            }
            for item in session::assistant_item(&assistant_text, output.reasoning.as_ref()) {
                s.push_input(item);
            }
            s.push_panel(PanelMessage {
                role: "assistant".into(),
                text: Some(assistant_text.clone()),
                summary: None,
                name: None,
                status: Some("stopped".into()),
            });
            s.jsonl().record(&serde_json::json!({
                "kind": "assistant_text",
                "text": assistant_text,
            }));
        }
        s.mark_last_assistant_stopped(panel_base);
        s.jsonl()
            .record(&serde_json::json!({"kind": "turn_aborted"}));
    });
    sink.emit(events::aborted());
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
    let signal = match rx.recv() {
        Ok(signal) => signal,
        Err(_) => {
            return ToolOutput::err(
                "approval_stale",
                "批准通道已关闭（会话被重置或 vault 已切换），本次调用未执行",
            )
        }
    };
    // Withdrawn：本轮被用户停止（M348），待决项已收回——如实记 turn_aborted，
    // 循环里的停止检查点随即收口，不继续执行也不回送模型。
    let decision = match signal {
        ApprovalSignal::Decided(decision) => decision,
        ApprovalSignal::Withdrawn => {
            return ToolOutput::err("turn_aborted", "本轮已停止，待批准的调用未执行");
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

#[cfg(test)]
mod tests {
    use super::*;

    fn block_with_selection(text: &str) -> ContextBlock {
        ContextBlock {
            path: Some("a/b.md".to_string()),
            selection: Some(RangeBlock {
                from_line: Some(3),
                to_line: Some(7),
                text: Some(text.to_string()),
            }),
            viewport_range: None,
        }
    }

    /// 回归（M309）：用户正文含 `\n\n[` 时，装配返回的上下文节必须是块生成的节本身，
    /// 不得被正文的方括号段落污染——旧实现从拼好的串里 `split("\n\n[")` 重解析，切分点
    /// 前移后存下的「节」其实是正文。
    #[test]
    fn assembled_section_ignores_bracket_in_message_body() {
        let block = block_with_selection("选中文本");
        let body = "看这段\n\n[正文里的方括号段落，不是上下文]";
        let assembled = assemble_user_message(body, &block);

        let expected_bracketed = format!("[{}]", context_section(&block).unwrap());
        assert_eq!(
            assembled.context_section.as_deref(),
            Some(expected_bracketed.as_str())
        );
        // 区分度自证（REVIEW.md 第 1 条）：旧实现按 `split("\n\n[")` 从拼好的串重解析，
        // 切出的是正文里的方括号段落——与新实现返回的节不同，证明这个输入确能判出旧 bug。
        let naive_old = body.split("\n\n[").nth(1).map(|rest| format!("[{rest}"));
        assert_ne!(naive_old.as_deref(), Some(expected_bracketed.as_str()));
        // 全文仍是 提问 + 节，一字不差。
        assert_eq!(assembled.text, format!("{body}\n\n{expected_bracketed}"));
        // 反例：节里不得出现正文的方括号段落。
        assert!(!assembled
            .context_section
            .unwrap()
            .contains("正文里的方括号段落"));
    }

    /// 无编辑器上下文（path 缺）时：全文即提问原文，不发节。
    #[test]
    fn assembled_section_is_none_without_context() {
        let assembled = assemble_user_message("纯提问", &ContextBlock::default());
        assert_eq!(assembled.text, "纯提问");
        assert!(assembled.context_section.is_none());
    }
}
