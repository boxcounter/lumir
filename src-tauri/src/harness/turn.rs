//! 工具循环编排（design §4、§9）：一轮提问 = user 消息入队 → LLM 往返（每轮把
//! tool_calls 逐个执行、结果回送）→ 无调用或达 `loop_max` 终止。加上下文注入、
//! 批准闸挂起、自动压缩与超限重试。
//!
//! 入 input 的项序是 provider 合同的一部分：同一轮的调用项必须**成组**在输出项之前
//! （[`flush_call_items`]，M360 真 API 实测；交错即 400），reasoning 项紧随其 assistant
//! 消息之前（[`session::assistant_item`]，M306）。
//!
//! 线程模型：本模块的函数都跑在 `lumir-harness-llm` 专线程（command 层 spawn）。
//! 会话锁的持有纪律：**只在读写会话的那一刻持锁**，LLM 调用与批准等待都在锁外
//! （一轮可能流式几分钟，持锁会把 `harness_state` / 批准通道全堵住）。
//!
//! 真流式（M369）：分片经 [`TurnStreamSink`] 在解析层收到即转发（前端逐字上屏，不再等整条
//! 响应读完再补发）；在途停止的探测（`aborted()`）挂在同一条通路上——流式期间点停止即收流，
//! 已产出内容保留在 `TurnOutput` 里由 [`abort_turn`] 收口。**事件发射一律在会话锁外**，
//! 转发器只短暂查会话（中断标志）。

use std::sync::mpsc;

use serde::Deserialize;

use crate::commands::CommandError;
use crate::config::HarnessConfig;

use super::approval::{ApprovalRequest, ApprovalSignal};
use super::events::{self, EventSink, StreamSink};
use super::jsonl;
use super::llm::{self, LlmClient};
use super::permissions::{self, permission_cache, Decision};
use super::session::{self, PanelMessage};
use super::thinking;
use super::tools::{self, ToolContext, ToolOutput};
use super::{Runtime, VaultScope};

/// TS 侧组装的结构化上下文块（tower 钉死形状，宽容解析）：
/// `{"path":"a/b.md","viewport_range":{"from_line":3,"to_line":7}}`（M412 起视口块只带行号，
/// 不再带原文）；旧的 `selection`（行号 + `text`，选区注入已于 M343 退役）仍被宽容接受。
/// 行号 1-based 闭区间；`path` 可缺（= 无编辑器上下文）。
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ContextBlock {
    pub path: Option<String>,
    #[serde(default)]
    pub selection: Option<RangeBlock>,
    #[serde(default)]
    pub viewport_range: Option<RangeBlock>,
}

/// 行范围块。`text` 缺席是常态——M412 起视口块不带原文，只有历史 `selection` 可能带上，
/// 留给宽容解析。
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

/// 注入节的形态定义——装配（[`assemble_user_message`]）与剥离（[`strip_context_section`]）
/// 都只从这里取，形态不在两处各写一份（REVIEW.md 第 8 条：同一语义两处真源会漂）。
/// 节头同时是节本身的开头（[`context_section`] 产出）。
pub const CONTEXT_SECTION_HEADER: &str = "当前编辑器上下文：";
/// 提问与注入节之间的空行分隔。
const CONTEXT_SECTION_SEPARATOR: &str = "\n\n";
/// 注入节的方括号（`[当前编辑器上下文：…]`）。
const CONTEXT_SECTION_OPEN: &str = "[";
const CONTEXT_SECTION_CLOSE: &str = "]";

/// 把上下文块格式化成注入 user 消息的「当前编辑器上下文」节（压缩续聊时原样重注入）。
///
/// 视口块（M412 起）只带行号、不带原文——原文随每条消息进上下文太冗余，节里因此只有
/// 路径 + `视口（第 X-Y 行）` 一行。历史 `selection`（M343 已退役的选区注入）若带 `text`
/// 仍按「行号 + 原文」渲染，宽容解析不吃亏。
pub fn context_section(block: &ContextBlock) -> Option<String> {
    let path = block.path.as_ref()?;
    let mut out = format!("{CONTEXT_SECTION_HEADER}\n文件：{path}");
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
        match &range.text {
            Some(text) => out.push_str(&format!("\n{kind}{lines}：\n{text}")),
            None => out.push_str(&format!("\n{kind}{lines}")),
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
            let bracketed = format!("{CONTEXT_SECTION_OPEN}{section}{CONTEXT_SECTION_CLOSE}");
            AssembledMessage {
                text: format!("{message}{CONTEXT_SECTION_SEPARATOR}{bracketed}"),
                context_section: Some(bracketed),
            }
        }
        None => AssembledMessage {
            text: message.to_string(),
            context_section: None,
        },
    }
}

/// [`assemble_user_message`] 的逆：剥掉文末自动注入的上下文节，只留用户原始提问段
/// （会话名与标题栏同口径，design §6.1）。
///
/// 判据 = 文末的注入形态（空行 + `[` + 节头 … 收尾 `]`），取**最后一次**出现：正文里
/// 引用了同名字样时，剥掉的仍是最后那个真注入节。形态常量与装配侧共用（见上方三个
/// `CONTEXT_SECTION_*`），不在这里另写一份字面量。
///
/// 留在正文里的近似：正文以该字面量原样收尾（用户把注入节原文粘进提问）时会被一并剥掉，
/// 代价只是名字变短——与 M309 的「按 `\n\n[` 切分」不是同一类（那里任意方括号段落都会
/// 命中切分点前移）。线里没有第二处可判别「这是注入」的信息，故形态判据到此为止。
pub fn strip_context_section(text: &str) -> &str {
    let open = format!("{CONTEXT_SECTION_SEPARATOR}{CONTEXT_SECTION_OPEN}{CONTEXT_SECTION_HEADER}");
    match text.rfind(&open) {
        Some(idx) if text.ends_with(CONTEXT_SECTION_CLOSE) => &text[..idx],
        _ => text,
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
            reasoning: None,
            ts: jsonl::unix_secs_now(),
        });
        s.set_current_context(context_section);
        // 留存口径：user 消息不进 sidecar——它逐字节在下一条 llm_request.messages 里。
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
    // 思考块序号（M362）：本轮工具循环里第几次产出思考。每次 LLM 往返最多产出一个思考块
    // （一次响应一条 reasoning 通道），多个工具轮因此自然形成多个块，序号从前到后递增。
    let mut reasoning_block: u32 = 0;
    loop {
        if rounds >= config.loop_max as usize {
            loop_max_notice(sink, runtime, scope, config);
            break;
        }
        rounds += 1;

        let request = build_request(runtime, scope);
        // wire 留存（发送点记录，design §2）：发给 LLM 的同一个结构化请求体原样落
        // llm_request——记录点与发送点同点，无二次序列化，不存在翻译层。
        record_llm_request(runtime, scope, config, &request);
        // 真流式（M369）：分片在 `complete` 期间收到即转发（正文逐字上屏），中断探测也在流里
        // （`aborted()`）——流式期间点停止即收流，已产出内容留在 `output` 里。思考块序号在
        // 本轮开始时定下：一次 LLM 往返最多一个思考块，该块的所有分片共用同一序号。
        let stream = TurnStreamSink {
            sink,
            runtime,
            scope,
            reasoning_block,
        };
        let output = client.complete(&request, &stream);
        // 响应同样即刻落盘（与上面的 llm_request 严格成对，含失败与在途停止的半截响应——
        // 「模型当时回的是什么」是留存事实的一部分）。放在停止检查点之前：
        // 中断轮产出的半截文本同样如实记录。
        record_llm_response(runtime, scope, &output, client.fixture_source());

        // —— 思考兜底（M369）——
        // 流式路径已在解析层即时转发；这里只补「没有流式分片、但回放项可提取明文」的老形态
        // （老 fixture / 只发 `output_item.done` 的 provider），整段作一个分片。放在停止检查点
        // **之前**：只有思考、还没正文时被停止，思考块同样要在场（「已产出内容保留」对思考成立）。
        let fallback_reasoning = reasoning_fallback(&output);
        if let Some(text) = fallback_reasoning.as_deref() {
            sink.emit(events::reasoning_chunk(text, reasoning_block));
        }
        // 进了块序号就进位（与改动前的口径一致：有思考内容才占一块）。
        if fallback_reasoning.is_some() || !output.reasoning_deltas.is_empty() {
            reasoning_block += 1;
        }

        // —— 停止检查点 ①（M348；M369 起在途停止已在流里收口，这里是「收流后」的那一道）：
        // `complete` 期间被请求停止——产出保留、不再继续。中断优先于错误/空响应判定：
        // 用户已表态「不再继续」，别再追错误行。
        if turn_aborted(runtime, scope) {
            abort_turn(sink, runtime, scope, panel_base, &output);
            return;
        }

        // —— 错误路径：上下文超限可压缩重试一次，其余错误即终态 ——
        if let Some(error) = output.error {
            if error.context_overflow && config.auto_compact && !overflow_retried {
                overflow_retried = true;
                rounds -= 1; // 重试同一轮，不占循环额度
                match compact_now(sink, runtime, scope, config, client) {
                    Ok(()) => {
                        // 停止检查点（M374）：压缩期间点的停止在此收口——否则 `continue`
                        // 会再开一轮 LLM 往返，被取消的请求重新跑起来（迟到完成复活）。
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
                        continue;
                    }
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

        // —— 输出项入队（分片不在这里发：M369 起正文 / 思考分片都在流式路径即时转发）——
        let assistant_text = output.text.clone();
        let usage = output.usage.map(|usage| {
            // 窗口按配置 schema 读取（M373：`providers.<id>.models` 的逐模型声明，未列出回落
            // 保守默认）——llm.rs 的预设窗口表已退役。
            let window = config.context_window(&config.provider, llm::active_model(config));
            (usage, llm::usage_snapshot(&usage, window))
        });
        let _ = runtime.with_session(scope, |s| {
            for item in session::assistant_item(&assistant_text, output.reasoning.as_ref()) {
                s.push_input(item);
            }
            // 工具轮（模型只发工具调用、无正文文本）不落空正文面板消息：落一条 `text: Some("")`
            // 的话，快照恢复路径会渲染出一排只有「Agent · Xm ago」头、body 为空的记录（M367
            // 根因）。空正文 assistant 项同样不进 input（M372：空 output_text 进下一次请求会被
            // Kimi Code 订阅端以 `text content is empty` 400 拒掉）——reasoning 项由
            // [`session::assistant_item`] 原样回传，M306 纪律不变。
            if !assistant_text.is_empty() {
                s.push_panel(PanelMessage {
                    role: "assistant".into(),
                    text: Some(assistant_text.clone()),
                    summary: None,
                    name: None,
                    status: None,
                    reasoning: None,
                    ts: jsonl::unix_secs_now(),
                });
            }
            // 正文 / 思考 / 调用 / 用量已随上面的 llm_response 落盘（wire 口径）——
            // 这里不再各记一份 sidecar（被 wire 覆盖的 kind 全部废弃，防双写）。
            if let Some((_, snapshot)) = usage {
                s.set_usage(snapshot);
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
                        let _ = compact_now(sink, runtime, scope, config, client);
                        // 停止检查点（M374）：压缩调用用 DiscardStreamSink（流里不问停止），
                        // 压缩期间点的停止只能在这里收口——不在此检查的话，下面的 `done`
                        // 会把已流式回复当作正常完成带进消息流，已取消的轮次「复活」。
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
                }
            }
            break;
        }

        // —— 逐个执行工具调用（allow 直执行 / deny 回送 / ask 走批准闸）——
        // 执行照旧逐个串行；**入 input 的顺序另算**：先攒下每条的「调用项 + 输出项」，本轮
        // 结束（或中断收口）时一次按「全部调用项在前、全部输出项在后」压栈。理由见
        // [`flush_call_items`]——调用与输出交错会让 provider 把第二条调用并进一条没有
        // reasoning 的 assistant 消息，thinking 模式即 400（M360 真 API 实测）。
        let mut pending: Vec<(serde_json::Value, serde_json::Value)> = Vec::new();
        for call in &output.calls {
            if turn_aborted(runtime, scope) {
                // 中断收口前先把**已执行**调用的项入 input（与本改动前逐条压栈的效果一致，
                // 只是顺序改成成组）；未执行的调用不留任何项，会话里不会出现悬空的
                // function_call（provider 会以 "No tool output found for tool call" 拒下一轮）。
                flush_call_items(runtime, scope, &pending);
                abort_turn(
                    sink,
                    runtime,
                    scope,
                    panel_base,
                    &llm::TurnOutput::default(),
                );
                return;
            }
            pending.push(handle_call(sink, runtime, scope, config, &tctx, call));
        }
        flush_call_items(runtime, scope, &pending);
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
/// - 已产出内容保留：`output` 里本轮拿到的文本照常入队（LLM 侧 + 面板侧 + JSONL），
///   面板消息标 `status = "stopped"`（标注「已停止」）；`output` 为空（中断落在工具执行段）时
///   标注落在既有的本轮 assistant 消息上；
/// - **分片不在这里补发**（M369）：正文与思考分片都在流式期间由 [`TurnStreamSink`] 即时转发过，
///   这里再发一遍就是双发；思考兜底（未流式产出时的整段分片）也已在本轮返回后、检查点之前发完；
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
            for item in session::assistant_item(&assistant_text, output.reasoning.as_ref()) {
                s.push_input(item);
            }
            s.push_panel(PanelMessage {
                role: "assistant".into(),
                text: Some(assistant_text.clone()),
                summary: None,
                name: None,
                status: Some("stopped".into()),
                reasoning: None,
                ts: jsonl::unix_secs_now(),
            });
            // 半截正文已在响应点随 llm_response 落盘（wire 口径），这里不再记 sidecar。
        }
        s.mark_last_assistant_stopped(panel_base);
        // 决策类 sidecar：中断是 wire 不可推导的用户决策。
        s.jsonl()
            .record(&serde_json::json!({"kind": "turn_aborted"}));
    });
    sink.emit(events::aborted());
}

/// 流式增量 → 面板事件的转发器（M369 真流式）：`llm` 的解析层在流中调用它。
///
/// 事件形状收在这里（解析层不该知道 `text_chunk` / `reasoning_chunk` 的字段，也不该知道
/// 「思考块序号」这个展示侧概念）；`aborted()` 直接查会话的停止标志——解析层因此不必反向
/// 依赖 `Runtime`（`llm` 不感知会话层）。调用发生在解析线程上且**不持有任何会话锁**
///（`complete` 全程在锁外，见模块头），`aborted()` 只短暂取一次锁。
struct TurnStreamSink<'a> {
    /// 已盖 vault 信封的出口（`run_turn` 的 [`super::events::ScopedSink`]）。
    sink: &'a dyn EventSink,
    runtime: &'a Runtime,
    scope: &'a VaultScope,
    /// 本轮思考块序号：一次 LLM 往返最多一块，该块的全部思考分片共用它。
    reasoning_block: u32,
}

impl StreamSink for TurnStreamSink<'_> {
    fn text_delta(&self, delta: &str) {
        self.sink.emit(events::text_chunk(delta));
    }

    fn reasoning_delta(&self, delta: &str) {
        self.sink
            .emit(events::reasoning_chunk(delta, self.reasoning_block));
    }

    fn aborted(&self) -> bool {
        turn_aborted(self.runtime, self.scope)
    }
}

/// 构造 LLM 请求（系统上下文 + 全部历史 + 工具定义 + 本轮思考档位；会话历史每轮整体序列化，
/// 克隆即可）。档位在**会话侧**（M362），这里读一次——本轮内不再变（切档位影响其后发出的消息）。
fn build_request(runtime: &Runtime, scope: &VaultScope) -> llm::Request {
    let (system, input, effort) = runtime
        .with_session(scope, |s| {
            (
                s.system().to_string(),
                s.input().to_vec(),
                s.thinking_effort(),
            )
        })
        .unwrap_or_default();
    llm::Request {
        system,
        input,
        tools: tools::definitions(),
        effort,
    }
}

/// 发送点落 `llm_request`：记录体就是传给 client 的同一个结构化 `Request`
/// （provider / model / system / messages / params），发送前落盘。工具循环每次迭代
/// 与压缩调用各自走本函数——每次 LLM 调用恰一条。
fn record_llm_request(
    runtime: &Runtime,
    scope: &VaultScope,
    config: &HarnessConfig,
    request: &llm::Request,
) {
    let payload = serde_json::json!({
        "kind": "llm_request",
        "request": {
            "provider": config.provider,
            "model": llm::active_model(config),
            "system": request.system,
            "messages": request.input,
            "params": { "thinking": request.effort.as_str() },
        },
    });
    let _ = runtime.with_session(scope, |s| s.jsonl().record(&payload));
}

/// 响应点落 `llm_response`：正文 / reasoning 回放项原文 / thinking 展示文本 / 工具调用 /
/// usage / error（无则缺省）+ mock provider 的 fixture 因果链。与上一条 `llm_request`
/// 严格成对——失败、空响应、在途停止的半截响应都如实记录（`error` 字段在场）。
///
/// reasoning 与 thinking **物理分离**（design §2，M362 纪律）：`reasoning` = 回放项
/// 原文（provider 方言——kimi 的 encrypted_content 项 / deepseek 的 reasoning_text
/// parts 项各按真实形状），恢复时原样回传（M306 / M360 回放语义逐字节保真，无需按
/// provider 分支重建，design §6.2 的恢复算法从本键取回放项）；`thinking` = **展示
/// 文本**（展示通道分片汇总）——分片缺席（老 fixture / 只发 `output_item.done` 的
/// provider）时退回从回放项提取明文，与面板所见同源；密文永不进 thinking
/// （`thinking::reasoning_text` 只返明文）。
fn record_llm_response(
    runtime: &Runtime,
    scope: &VaultScope,
    output: &llm::TurnOutput,
    fixture_source: Option<&str>,
) {
    let mut payload = serde_json::json!({
        "kind": "llm_response",
        "text": output.text,
    });
    if let Some(reasoning) = &output.reasoning {
        payload["reasoning"] = reasoning.clone();
    }
    // thinking = 展示文本（裁决点 1 的展示半边落盘）：分片非空即拼接；缺席时退回
    // 从回放项提取明文（与 turn 的 reasoning_fallback 展示兜底同源）。
    let thinking_text = if output.reasoning_deltas.is_empty() {
        output.reasoning.as_ref().and_then(thinking::reasoning_text)
    } else {
        Some(output.reasoning_deltas.join(""))
    };
    if let Some(text) = thinking_text.filter(|text| !text.is_empty()) {
        payload["thinking"] = text.into();
    }
    if !output.calls.is_empty() {
        payload["tool_calls"] = serde_json::Value::Array(
            output
                .calls
                .iter()
                .map(|call| {
                    serde_json::json!({
                        "id": call.call_id,
                        "name": call.name,
                        "arguments": call.arguments,
                    })
                })
                .collect(),
        );
    }
    if let Some(usage) = output.usage {
        payload["usage"] = serde_json::json!({
            "input_tokens": usage.input_tokens,
            "cached_tokens": usage.cached_tokens,
            "output_tokens": usage.output_tokens,
        });
    }
    if let Some(error) = &output.error {
        payload["error"] = serde_json::json!(format!("{}: {}", error.code, error.message));
    }
    if let Some(source) = fixture_source {
        payload["mock_fixture"] = serde_json::json!(source);
    }
    let _ = runtime.with_session(scope, |s| s.jsonl().record(&payload));
}

/// 未流式产出时的思考兜底分片（M369，输出侧只读）：`reasoning_deltas` 非空 = 解析层已即时
/// 转发过，返回 `None`；否则从回放项提取明文、整段作一个分片（老 fixture / 只发
/// `output_item.done` 的 provider 落这条），保证不丢思考内容。**只读**：不触碰 reasoning 项的
/// 捕获 / 合成 / 回传（M306 纪律），密文也永不进入返回值（[`thinking::reasoning_text`]）。
fn reasoning_fallback(output: &llm::TurnOutput) -> Option<String> {
    if !output.reasoning_deltas.is_empty() {
        return None;
    }
    output.reasoning.as_ref().and_then(thinking::reasoning_text)
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
            reasoning: None,
            ts: jsonl::unix_secs_now(),
        });
        s.jsonl().record(&serde_json::json!({
            "kind": "loop_max_reached",
            "loop_max": config.loop_max,
        }));
    });
    sink.emit(events::text_chunk(&text));
}

/// 会话内批准缓存的命名空间：`(vault 根, 会话 id)`（design §6）。会话 id 取自留存文件名——
/// 新会话 / 切 vault / 压缩开新逻辑会话都会换命名空间，缓存随之清空；同一命名空间内才谈命中。
/// 无会话（理论上到不了这里）返回 `None`，命中判定按「没缓存」处理。
fn cache_namespace(runtime: &Runtime, scope: &VaultScope) -> Option<permission_cache::Namespace> {
    runtime
        .with_session(scope, |session| {
            let session_id = jsonl::JsonlWriter::session_id_from_path(session.jsonl().path());
            permission_cache::Namespace::new(scope.key(), session_id.unwrap_or_default())
        })
        .ok()
}

/// 单个工具调用：权限判定 → （ask 档）批准闸 → 执行 → 结果回送（事件 + 面板 + JSONL）。
///
/// **不直接把消息项压进 input**：返回「调用项 + 输出项」由调用侧成组压栈（见
/// [`flush_call_items`]）；面板与 JSONL 的记录仍在本函数内、逐条按时序落，故用户看到的
/// 工具行顺序与执行顺序一致，不受入 input 顺序影响。
fn handle_call(
    sink: &dyn EventSink,
    runtime: &Runtime,
    scope: &VaultScope,
    config: &HarnessConfig,
    tctx: &ToolContext,
    call: &llm::ToolCall,
) -> (serde_json::Value, serde_json::Value) {
    // 参数摘要：live「started」事件与面板快照（M367 持久化）共用同一份，MUST NOT 各算各的
    // （REVIEW.md 第 8 条：同一语义两处真源）。
    let args_summary = summarize_args(&call.arguments);
    sink.emit(events::tool_call(&call.name, "started", &args_summary));
    let parsed: Result<serde_json::Value, _> = serde_json::from_str(&call.arguments);
    let args_ok = parsed.is_ok();
    let args = parsed.unwrap_or_default();
    // 未知工具（清单外）：直接回送错误，不进权限判定——它不可执行，走 ask 闸
    // 只会把循环挂死在永远等不到的批准上（工具集是闭集合，MUST NOT 扩张）。
    let known = tools::TOOL_NAMES.contains(&call.name.as_str());
    let subject = tools::permission_subject(&call.name, &args);
    // cli_run 的分类与写目标提取以 argv 数组为输入（比主体串信息全）；非 cli_run 传 None。
    let cli_argv = (call.name == "cli_run").then(|| tools::cli_argv(&args));
    // 会话内批准缓存（design §6）：只在第 5 层（模式默认分层）短路——不解锁 deny / 重定向 /
    // 黑名单三层（层序在 `permissions::decide` 里，这里只提供命中布尔）。
    let cached = known
        && args_ok
        && cache_namespace(runtime, scope)
            .is_some_and(|ns| permission_cache::is_remembered(&ns, &call.name, &subject));
    let judge = permissions::Judge {
        mode: config.permission_mode,
        root: tctx.root,
        argv: cli_argv,
        cached,
    };
    let decision = permissions::decide(&config.permissions, &call.name, &subject, &judge);

    let output = if !known {
        ToolOutput::err("tool_unknown", format!("未知工具：{}", call.name))
    } else if !args_ok {
        ToolOutput::err("tool_args_invalid", "工具调用的 arguments 不是合法 JSON")
    } else if let Err(output) = tools::check_purpose(&call.name, &args) {
        // purpose 校验在判定管线之前（design §3.4）：ask 档批准卡必须已有用途句可展示。
        output
    } else {
        match decision {
            // 模式层不产出 Deny（只读档 = Always Ask），Deny 只来自第 1 层的用户 deny 规则。
            Decision::Deny => ToolOutput::err(
                "permission_denied",
                format!("权限规则拒绝了 {}（{subject}）", call.name),
            ),
            // deny 的留痕是 wire 口径：带 `permission_denied` 错误码的结果随历史进
            // 下一条 llm_request.messages（tool_denied 事件类已废弃），面板 tool 行
            // 的细分状态照常由 status 承担。
            Decision::Allow => tools::execute(&call.name, &args, tctx),
            Decision::Ask => gated_execute(sink, runtime, scope, tctx, call, &args),
            // vault 内写硬重定向（design §4）：固定标记 + JSON 载荷，模型据此下一轮改用
            // vault 工具（闸门不做自动翻译，不留第二事实源）。
            Decision::Redirect(redirect) => {
                ToolOutput::err(permissions::REDIRECT_ERROR_CODE, redirect.message())
            }
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
    let result_summary = summarize_result(status, &output);
    sink.emit(events::tool_call(&call.name, "done", &result_summary));
    // 面板快照持久化 summary（M367）：成功 = 参数摘要（恢复后工具行显示「调用了什么工具、
    // 带了什么参数」）；失败 = 结果摘要（含细分状态与错误码）。修前 summary 恒 None，面板
    // 重载（快照恢复路径）后工具行摘要全丢。
    let panel_summary = if output.succeeded() {
        args_summary
    } else {
        result_summary
    };
    let output_text = serde_json::to_string(&output.value).unwrap_or_default();
    let _ = runtime.with_session(scope, |s| {
        s.push_panel(PanelMessage {
            role: "tool".into(),
            text: Some(output_text.clone()),
            summary: Some(panel_summary),
            name: Some(call.name.clone()),
            status: Some(status.to_string()),
            reasoning: None,
            ts: jsonl::unix_secs_now(),
        });
        // 调用与结果的留存是 wire 口径：function_call / function_call_output 项
        // 逐字节在下一条 llm_request.messages 里（tool_call / tool_result 事件类已废弃）。
    });
    (
        session::function_call_item(&call.call_id, &call.name, &call.arguments),
        session::function_call_output_item(&call.call_id, &output_text),
    )
}

/// 本轮调用项 / 输出项成组入 input：**全部调用项在前、全部输出项在后**，同序配对。
///
/// 这是 provider 合同，不是排版偏好（M360，2026-10-07 对真 API 逐项变异实测）：
/// 兼容层把 `function_call` 并进**相邻的** assistant 消息，调用与输出交错
/// （`fc1, fco1, fc2, fco2`）时第二条调用会落进一条新的、没有 reasoning 的 assistant
/// 消息，deepseek thinking 模式即 400
/// ``The `reasoning_text` in the thinking mode must be passed back to the API``——
/// 报错文案指向 reasoning，真触发条件是项序（同两条调用、reasoning 整项删掉也照旧 400；
/// 只把两组调用对改成 `fc1, fc2, fco1, fco2` 就 200）。故入 input 的顺序由本函数独占，
/// 调用点 MUST NOT 再逐条压栈。
fn flush_call_items(
    runtime: &Runtime,
    scope: &VaultScope,
    pending: &[(serde_json::Value, serde_json::Value)],
) {
    if pending.is_empty() {
        return;
    }
    let _ = runtime.with_session(scope, |s| {
        for (call_item, _) in pending {
            s.push_input(call_item.clone());
        }
        for (_, output_item) in pending {
            s.push_input(output_item.clone());
        }
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
    // purpose（design §3.4）：cli_run 批准卡载荷里的可选键——前端有则显示在命令上方、
    // 无则回落现状。事件函数的参数表归 M406 批次；这里按约定的**载荷键名**注入同一个键，
    // 线上形状即契约形状（合并期 events.rs 加参数时对齐到同一处）。
    let mut payload = events::approval_request(
        &id,
        &call.name,
        preview.diff.as_deref(),
        preview.argv.as_deref(),
    );
    if let Some(purpose) = &preview.purpose {
        payload["purpose"] = serde_json::json!(purpose);
    }
    sink.emit(payload);
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

/// 压缩续聊（design §9，裁决点 6）：会话历史压成摘要 → **开新逻辑会话**（新留存文件 +
/// 重新装配系统上下文——三处装配点之一），注入摘要 + 当前编辑器上下文。压缩调用自身
/// 也走 wire 留存（llm_request / llm_response 各一条，落在**旧**文件里：摘要的产出
/// 过程是「模型当时看到了什么」的一部分）；旧文件封闭不再追加，摘要随新文件首行
/// `session_open.compact_summary` 留存。失败不阻断对话，由调用点决定是否终态。
fn compact_now(
    sink: &dyn EventSink,
    runtime: &Runtime,
    scope: &VaultScope,
    config: &HarnessConfig,
    client: &mut dyn LlmClient,
) -> Result<(), CommandError> {
    const COMPACT_INSTRUCTION: &str = "\
把以下对话历史压缩成一份续聊摘要，供新会话接着工作：保留用户的目标与关键诉求、\
已经确认的决策、工具调用的关键结果（读了什么、改了什么、批准与否）、尚未完成的动作。\
丢掉逐字过程与重复内容。用与用户相同的语言写摘要。";

    let input = runtime.with_session(scope, |s| s.input().to_vec())?;
    let history = render_history(&input);
    // 压缩是一次汇总调用，不产思考块给人看；档位照会话现值传（不另造一个默认值，
    // 否则「同一个会话里两种档位」会多一处隐式状态——M362）。
    let effort = runtime
        .with_session(scope, |s| s.thinking_effort())
        .unwrap_or_default();
    // 流式 sink 用丢弃口（M369）：摘要不逐片进面板——它只在整个压缩完成后作为 `compact`
    // 事件与面板消息整段落盘；也不参与在途停止（压缩是一次汇总调用）。
    let compact_request = llm::Request {
        system: COMPACT_INSTRUCTION.to_string(),
        input: vec![session::user_item(&format!(
            "{COMPACT_INSTRUCTION}\n\n===== 对话历史 =====\n{history}"
        ))],
        tools: Vec::new(),
        effort,
    };
    // 压缩调用的逐请求留存（wire 口径；落在旧文件，先于下面的文件轮换）。
    record_llm_request(runtime, scope, config, &compact_request);
    let output = client.complete(&compact_request, &llm::DiscardStreamSink);
    record_llm_response(runtime, scope, &output, client.fixture_source());
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
    // 新逻辑会话：重新装配系统上下文（三处装配点之一）+ 新留存文件（首行挂起
    // session_open，opened_from=compact、compact_summary 在场）。旧文件封闭不再追加。
    let session_effort = runtime
        .with_session(scope, |s| s.thinking_effort())
        .unwrap_or_default();
    let assembled = super::context::assemble_system(&scope.root);
    let session_id = jsonl::new_session_id();
    let open = super::session_open_payload(
        scope,
        config,
        &assembled,
        &session_id,
        "compact",
        session_effort,
        Some(&summary),
    );
    let writer = jsonl::JsonlWriter::create(&session_id, &open)?;
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
            reasoning: None,
            ts: jsonl::unix_secs_now(),
        });
        // 文件边界即压缩留痕：压缩事件类（旧 compact kind）已废弃。
        s.rotate(assembled.text, writer);
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

/// 参数摘要（截断 80 字）：live `started` 事件、面板持久化（M367）与恢复重建（M398，从
/// wire 的 function_call 项取参数）共用同一份——MUST NOT 各算各的（REVIEW.md 第 8 条）。
pub(crate) fn summarize_args(arguments: &str) -> String {
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

    use crate::config::HarnessProvider;
    use crate::fs_io::IgnorePolicy;

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

    /// 丢弃事件的 sink（本模块只关心入队后的会话状态）。
    struct NullSink;

    impl EventSink for NullSink {
        fn emit(&self, _payload: serde_json::Value) {}
    }

    /// 恢复 `XDG_CONFIG_HOME`（断言失败 panic 也要复原，别把临时目录留给同进程的别的用例）。
    struct XdgGuard(Option<std::ffi::OsString>);

    impl Drop for XdgGuard {
        fn drop(&mut self) {
            match &self.0 {
                Some(v) => std::env::set_var("XDG_CONFIG_HOME", v),
                None => std::env::remove_var("XDG_CONFIG_HOME"),
            }
        }
    }

    /// M353：一轮对话（含工具调用）之后，`harness_state` 快照的每条消息都带 `ts`
    /// （UNIX 秒，与 JSONL 留存同口径），随消息顺序单调不减，取值落在本轮的真实时窗内。
    ///
    /// 判据的区分度（REVIEW.md 第 1 条）：`0` 占位、缺字段、写死常量、毫秒口径、跨天
    /// 复用的旧戳一律落在 `[before, after]` 之外。时窗两端由本测试用 std **独立**取时，
    /// 不复用被测的 `jsonl::unix_secs_now`——复用的话取时本身坏掉两边会一起错。
    #[test]
    fn snapshot_messages_carry_monotonic_unix_timestamps() {
        fn unix_secs() -> u64 {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
        }

        let root = std::env::temp_dir().join(format!("lumir-harness-ts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        // JSONL 落点走 XDG_CONFIG_HOME（REVIEW.md 第 13 条：测试绝不写真实的 ~/.config/lumir）。
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));

        let vault = root.join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::write(vault.join("a.md"), "正文\n").unwrap();
        let scope = VaultScope {
            root: vault.clone(),
            policy: IgnorePolicy::load(&vault, &[".gitignore".to_string()]),
        };
        let config = HarnessConfig {
            provider: HarnessProvider::Mock,
            ..Default::default()
        };

        let runtime = Runtime::default();
        runtime.acquire_turn(&scope, &config).unwrap();
        // 一轮里含一次工具调用 ⇒ 面板覆盖 user / assistant / tool / assistant 四类消息。
        let script = r#"{"responses": [
            {"text": "先读文件。",
             "tool_calls": [{"id": "c1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}]},
            {"text": "读完了。"}
        ]}"#;
        let mut client = llm::MockClient::from_str(script, "timestamps").unwrap();
        let before = unix_secs();
        run_turn_for(
            &NullSink,
            &runtime,
            &scope,
            &config,
            "这段讲了什么".to_string(),
            None,
            &mut client,
        );
        let after = unix_secs();
        runtime.release_turn(&scope);

        let snapshot = runtime.snapshot(&scope, &config);
        let roles: Vec<&str> = snapshot
            .messages
            .iter()
            .map(|message| message.role.as_str())
            .collect();
        // 先证明这一轮真的跑到了工具调用——否则下面的打戳断言在「只有 1 条 user 消息」上
        // 照样能过，等于没覆盖 tool 消息。
        assert_eq!(roles, vec!["user", "assistant", "tool", "assistant"]);

        // 判据落在线上形状（面板恢复渲染读的就是 StateSnapshot 的 JSON）。
        let json = serde_json::to_value(&snapshot).unwrap();
        let messages = json["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 4);
        let mut previous = 0u64;
        for message in messages {
            let ts = message["ts"]
                .as_u64()
                .unwrap_or_else(|| panic!("快照消息缺 ts 字段：{message}"));
            assert!(
                ts >= before && ts <= after,
                "ts={ts} 不在本轮时窗 [{before}, {after}] 内：{message}"
            );
            assert!(
                ts >= previous,
                "ts 必须单调不减：{ts} < {previous}：{message}"
            );
            previous = ts;
        }

        let _ = std::fs::remove_dir_all(&root);
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

    /// 会话名剥离（M396，design §6.1「与标题栏同口径」）：注入形态 = 提问 + 空行 +
    /// `[节头…]`，剥掉节只留提问段。断言里的节头取共享常量，不另抄一份字面量。
    #[test]
    fn strip_context_section_keeps_question_only() {
        let assembled =
            assemble_user_message("这句话是什么意思？", &block_with_selection("选中文本"));
        // 现场先自证是真注入（装配确实加了节），再断言剥离结果——否则「剥完 = 原样」的
        // 断言在没有节时恒真（REVIEW.md 第 1 条）。
        assert!(assembled.text.contains(CONTEXT_SECTION_HEADER));
        assert_eq!(strip_context_section(&assembled.text), "这句话是什么意思？");
        // 无注入：原样返回，不吞任何字符。
        assert_eq!(strip_context_section("纯提问"), "纯提问");
        assert_eq!(
            strip_context_section("含方括号的问题 [1]"),
            "含方括号的问题 [1]"
        );
    }

    /// 剥离只认**文末**的注入节：正文里的同名字样（不以 `]` 收尾）不动；正文引用了同名字样
    /// 而末尾另有真注入节时，剥掉的是最后那个（`rfind`——取首个会把真注入节留在名字里）。
    #[test]
    fn strip_context_section_only_takes_the_trailing_section() {
        let inline = format!("我在讨论\n\n{CONTEXT_SECTION_HEADER}样例，不是注入节");
        assert_eq!(strip_context_section(&inline), inline);
        let pasted = format!("看这段\n\n[{CONTEXT_SECTION_HEADER}示例]");
        let assembled = assemble_user_message(&pasted, &block_with_selection("选中文本"));
        assert_eq!(strip_context_section(&assembled.text), pasted);
    }

    /// M412：视口块只带行号、不带原文——`parse_context` 宽容接受缺席的 `text`，
    /// `context_section` 渲染成「视口（第 X-Y 行）」一行，不再有「（无文本）」占位。
    #[test]
    fn viewport_block_renders_line_range_without_text() {
        let block =
            parse_context(r#"{"path":"a/b.md","viewport_range":{"from_line":3,"to_line":7}}"#)
                .unwrap();
        assert!(block.viewport_range.as_ref().unwrap().text.is_none());
        let section = context_section(&block).unwrap();
        assert_eq!(
            section,
            format!("{CONTEXT_SECTION_HEADER}\n文件：a/b.md\n视口（第 3-7 行）")
        );
        // 区分度（REVIEW.md 第 1 条）：旧实现在无 text 时落「（无文本）」占位——本断言挡它。
        assert!(!section.contains("（无文本）"));
        // 全文装配：提问 + 空行 + 方括号节，节里只有路径与行号。
        let assembled = assemble_user_message("看这里", &block);
        assert_eq!(
            assembled.text,
            format!("看这里\n\n[{CONTEXT_SECTION_HEADER}\n文件：a/b.md\n视口（第 3-7 行）]")
        );
    }

    /// 宽容解析不吃亏：历史 `selection`（选区注入 M343 已退役）仍带 `text`，照旧按
    /// 「行号 + 原文」渲染——M412 只改视口的产出形状，不收窄对旧载荷的接受面。
    #[test]
    fn legacy_selection_with_text_still_renders_source_text() {
        let block = parse_context(
            r#"{"path":"a.md","selection":{"from_line":3,"to_line":7,"text":"选中文本"}}"#,
        )
        .unwrap();
        assert_eq!(
            context_section(&block).unwrap(),
            format!("{CONTEXT_SECTION_HEADER}\n文件：a.md\n选区（第 3-7 行）：\n选中文本")
        );
    }

    /// M367：模型某轮只发工具调用、无正文文本时——
    /// ① 不落空正文 assistant 面板消息（修前落 `text: Some("")`，快照恢复渲染出只有角色
    ///    meta 行、body 为空的「空气泡」）；
    /// ② tool 面板消息持久化摘要（成功 = 参数摘要，失败 = 细分状态 + 错误码），
    ///    面板重载后工具行仍有信息（修前 summary 恒 None）；
    /// ③ M372：空正文 assistant 项同样不进 input（修前进下一次请求，被 k3-256k 端点以
    ///    `text content is empty` 400 拒掉）。
    ///
    /// 判据落在线上形状（面板恢复读的就是 `StateSnapshot` 的 JSON；input 断言读会话的
    /// `input()`），不是内部字段。
    #[test]
    fn tool_only_round_skips_empty_assistant_and_persists_tool_summary() {
        let root =
            std::env::temp_dir().join(format!("lumir-harness-toolsum-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        // JSONL 落点走 XDG_CONFIG_HOME（REVIEW.md 第 13 条：不写真实 ~/.config/lumir）。
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));

        let vault = root.join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::write(vault.join("a.md"), "正文\n").unwrap();
        let scope = VaultScope {
            root: vault.clone(),
            policy: IgnorePolicy::load(&vault, &[".gitignore".to_string()]),
        };
        let config = HarnessConfig {
            provider: HarnessProvider::Mock,
            ..Default::default()
        };

        let runtime = Runtime::default();
        runtime.acquire_turn(&scope, &config).unwrap();
        // 第 1 轮：只有工具调用、无正文（`text` 缺省即空串）——复现真实 LLM 的工具轮形状。
        // 两条调用各钉一面：`vault_read` 成功（摘要取参数）；未知工具失败（摘要含状态与错误码）。
        let script = r#"{"responses": [
            {"tool_calls": [
                {"id": "c1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"},
                {"id": "c2", "name": "vault_bogus", "arguments": "{}"}
            ]},
            {"text": "读完了。"}
        ]}"#;
        let mut client = llm::MockClient::from_str(script, "tool-summary").unwrap();
        run_turn_for(
            &NullSink,
            &runtime,
            &scope,
            &config,
            "这段讲了什么".to_string(),
            None,
            &mut client,
        );
        runtime.release_turn(&scope);

        let snapshot = runtime.snapshot(&scope, &config);
        let json = serde_json::to_value(&snapshot).unwrap();
        let messages = json["messages"].as_array().unwrap();

        // ① 工具轮不落面板消息：修前 roles 是 ["user", "assistant", "tool", "tool", "assistant"]。
        let roles: Vec<&str> = messages
            .iter()
            .map(|m| m["role"].as_str().unwrap_or(""))
            .collect();
        assert_eq!(roles, vec!["user", "tool", "tool", "assistant"]);
        // 且任一 assistant 面板消息都不得为空正文（空正文记录一律缺席）。
        for message in messages {
            if message["role"] == "assistant" {
                let text = message["text"].as_str().unwrap_or("");
                assert!(
                    !text.is_empty(),
                    "assistant 面板消息不得为空正文：{message}"
                );
            }
        }

        // ② 工具行摘要持久化：成功 = 参数摘要；失败 = 细分状态 + 错误码。
        let tools: Vec<&serde_json::Value> =
            messages.iter().filter(|m| m["role"] == "tool").collect();
        assert_eq!(tools.len(), 2, "{json}");
        assert_eq!(tools[0]["name"], serde_json::json!("vault_read"));
        assert_eq!(tools[0]["status"], serde_json::json!("done"));
        assert_eq!(
            tools[0]["summary"],
            serde_json::json!("{\"path\":\"a.md\"}")
        );
        assert_eq!(tools[1]["name"], serde_json::json!("vault_bogus"));
        assert_eq!(tools[1]["status"], serde_json::json!("error"));
        let failed = tools[1]["summary"].as_str().unwrap_or("");
        assert!(
            failed.contains("error") && failed.contains("tool_unknown"),
            "失败工具行摘要须含状态与错误码，实际：{failed}"
        );

        // ③ M372（k3-256k `text content is empty` 的根因面）：工具轮的空正文 assistant 项
        // 不得留在 input 里——它原样进下一次请求，Kimi Code 订阅端即整条 400。修复前
        // input 的形状是 [user, assistant(""), fc1, fc2, fco1, fco2, assistant("读完了。")]，
        // 本条对那条空正文项必 FAIL（区分度自证，REVIEW.md 第 1 条）。
        let input = runtime
            .with_session(&scope, |s| s.input().to_vec())
            .expect("会话在释放后仍在");
        for item in &input {
            if item["role"] == "assistant" {
                let text = item["content"][0]["text"].as_str().unwrap_or("");
                assert!(
                    !text.is_empty(),
                    "input 里的 assistant 项不得为空正文：{item}"
                );
            }
        }
        // 非空正文项不受影响：两轮的正文与两对调用项全在。
        assert_eq!(
            input.iter().filter(|i| i["role"] == "assistant").count(),
            1,
            "只有「读完了。」一条 assistant 消息项：{input:?}"
        );
        assert_eq!(
            input
                .iter()
                .filter(|i| i["type"] == "function_call")
                .count(),
            2
        );

        let _ = std::fs::remove_dir_all(&root);
    }
}
