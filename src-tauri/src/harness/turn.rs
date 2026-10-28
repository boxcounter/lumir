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

use std::collections::BTreeMap;
use std::sync::mpsc;

use serde::Deserialize;

use crate::commands::CommandError;
use crate::config::HarnessConfig;

use super::approval::ApprovalRequest;
use super::events::{self, EventSink, StreamSink};
use super::jsonl;
use super::llm::{self, LlmClient};
use super::permissions::{self, Decision};
use super::run::{ApprovalOutcome, BudgetVerdict, OrchestrationCall, RunContext, SessionContext};
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
/// 都只从这里取，形态不在两处各写一份（REVIEW.md 「同一语义两处真源」条：同一语义两处真源会漂）。
/// 节头同时是节本身的开头（[`context_section`] 产出）。
pub const CONTEXT_SECTION_HEADER: &str = "当前编辑器上下文：";
/// 提问与注入节之间的空行分隔。`pub(crate)`：parts 装配（`attachments::apply_context_section`）
/// 与串装配（`assemble_user_message`）同取这一条，不在两处各写一份（REVIEW.md 「同一语义两处真源」条）。
pub(crate) const CONTEXT_SECTION_SEPARATOR: &str = "\n\n";
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

/// 给上下文节加方括号（`[当前编辑器上下文：…]`）——装配的唯一出口：
/// `assemble_user_message`（串装配）与 `attachments::apply_context_section`（parts 装配）
/// 同取这一条，方括号形态不在两处各写一份（REVIEW.md 「同一语义两处真源」条）。
pub fn bracket_context_section(section: &str) -> String {
    format!("{CONTEXT_SECTION_OPEN}{section}{CONTEXT_SECTION_CLOSE}")
}

/// user 消息装配 = 提问 + 上下文节；节同时作为结构化值返回供会话留存（同一次生成）。
pub fn assemble_user_message(message: &str, block: &ContextBlock) -> AssembledMessage {
    match context_section(block) {
        Some(section) => {
            let bracketed = bracket_context_section(&section);
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

/// run_turn / run_turn_for 的投递入参面（change harness-composer-image-paste design §4.2）：
/// 发送路径（`harness_send`）给前端投影的 parts（有序，承载 text/image 交错）；文本调用方
/// （压缩路径 / 既有单测）经 `From<String>` / `From<&str>` 进**单 text part**——与旧
/// 「单序列化串」语义逐字节等价（纯文本消息投影仍退化为单 text part）。
pub struct DeliveryInput(pub Vec<super::attachments::DeliveryPart>);

impl From<String> for DeliveryInput {
    fn from(text: String) -> Self {
        Self(vec![super::attachments::DeliveryPart {
            kind: "text".to_string(),
            text: Some(text),
            name: None,
            label: None,
        }])
    }
}

impl From<&str> for DeliveryInput {
    fn from(text: &str) -> Self {
        text.to_string().into()
    }
}

impl From<Vec<super::attachments::DeliveryPart>> for DeliveryInput {
    fn from(parts: Vec<super::attachments::DeliveryPart>) -> Self {
        Self(parts)
    }
}

/// 终态发射的唯一出口（change add-harness-activity-presence §4 / design §4）。
///
/// 次序是合同的一半：**先**把会话的轮次状态推进到 `Finishing`（呈现读 `in_flight` 在这一刻
/// 由真转假、协议读 `is_busy` 仍为真），**再**发事件。反过来的话，面板收到终态后回读快照会
/// 看到「在途」，那正是本 change 要收掉的假在途（design §12 第一条风险）。
///
/// 全部终态发射点经本函数或 [`emit_terminal_on`]：`Session::finish_turn` 是唯一的状态写点，
/// 漏一处就是假在途（design §1 F15 的 10 个位点 / 11 条语句）。
fn emit_terminal<C: RunContext>(ctx: &mut C, payload: serde_json::Value) {
    let _ = ctx.with_session(|session| session.finish_turn());
    ctx.sink().emit(payload);
}

/// [`emit_terminal`] 的无上下文形态：这三处在 `SessionContext` 之外收口——交互回合的配置级
/// 失败（ctx 还没建）、交互回合的 panic 收口（ctx 已随 `catch_unwind` 结束）、自动唤醒回合的
/// 两处（同一个理由）。状态写点仍是 `Session::finish_turn`，与上下文路径同源。
fn emit_terminal_on(
    runtime: &Runtime,
    scope: &VaultScope,
    sink: &dyn EventSink,
    payload: serde_json::Value,
) {
    let _ = runtime.with_session(scope, |session| session.finish_turn());
    sink.emit(payload);
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
    parts: impl Into<DeliveryInput>,
    context_section: Option<String>,
) {
    // 事件信封（M312）：每个 harness:event 都带 vault 根路径（= 会话标识），前端据此只渲染
    // 当前 vault 的会话。包装放在本函数——生产路径上唯一的装配点，下面十几处发射点与
    // `run_turn_for` 都不必各带一个 vault 参数。
    //
    // 无人值守运行槽（change add-cron-runtime-daemon §6.2）：`Runtime::isolated()` 的实例
    // **不发 `harness:event`**（其会话与交互槽位物理分离，事件 MUST NOT 渲染进用户当前
    // transcript），只把本轮终态记进 runtime——`cron:run_finished` 据此产出回执。
    let terminal_sink = std::sync::Arc::new(TerminalSink {
        // 弱引用：这个 sink 会被挂进子运行中枢（会话生命周期外），强引用 Runtime 会把
        // `RuntimeInner → sessions → Session → hub → sink` 闭成环（评审 r1 P1-1）。
        runtime: runtime.downgrade(),
        forward: (!runtime.is_isolated()).then(|| TauriEventSink(app.clone())),
    });
    // 本轮生效的权限规则（change harness-permission-rules-oct23 design §4）：从本轮配置快照
    // 播种——规则写回 / 删除成功时后端会再从配置文件重播一次，同一轮的下一条判定因此立即生效。
    runtime.seed_permissions(&config.permissions);
    // 可跨线程持有的同一出口：子运行与自动唤醒回合在父回合结束后仍要发事件，借用的
    // `&sink` 活不到那时。`ScopedSink` 只借用 inner，故这里再包一层 owned 版本。
    let owned: std::sync::Arc<dyn EventSink> = std::sync::Arc::new(OwnedScopedSink {
        inner: terminal_sink.clone(),
        vault: scope.key(),
    });
    let sink = events::ScopedSink::new(terminal_sink.as_ref(), scope.key());
    // 会话级 mock 游标（M456）：mock client 每轮重建，游标存在会话上才能让同一会话的第二轮
    // 接着上一轮往下弹（131/133 的「两轮不同 usage」依赖它）。真 provider 的 client 两方法
    // 返回默认值，下面的回写恒 no-op。
    let mock_start = runtime
        .with_session(&scope, |s| s.mock_cursor())
        .unwrap_or(0);
    // 交互路径没有调用级模型覆盖（覆盖参数供子运行 / cron 使用，design §11）。
    let mut client = match llm::client_at(&config, &scope.vault_id, mock_start, None) {
        Ok(client) => client,
        Err(e) => {
            // 配置级失败（mock fixture 缺失 / api_key 未配）：错误事件即终态。
            emit_terminal_on(&runtime, &scope, &sink, events::error(&e.code, &e.message));
            runtime.release_turn(&scope);
            return;
        }
    };
    let mut title_job = None;
    let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // 调度工具端口（change add-cron-conversational-registration）：交互发送路径注入；
        // 交接契约槽位（cron 定时 / 点击）在 `SessionContext::cron_port` 里仍返回 None。
        let mut ctx =
            SessionContext::new_with_owned_sink(&sink, Some(owned), &runtime, &scope, &config)
                .with_cron_port(Some(std::sync::Arc::new(crate::CronToolPort::new(
                    app.clone(),
                ))));
        title_job = run_turn_core(&mut ctx, &config, parts, context_section, client.as_mut());
    }))
    .is_err();
    if panicked {
        emit_terminal_on(
            &runtime,
            &scope,
            &sink,
            events::error(
                "harness_internal_error",
                "对话线程发生内部错误，本轮已终止；请重试，必要时开新会话",
            ),
        );
    }
    if let Some(len) = client.mock_script_len() {
        // 会话游标 = 本客户端自己弹出的条数 + 子运行经 `skip` 跳过的条数（design §18）：
        // 并行子运行预分配的区间被父跳过，父续写条目落在所有子区间之后。
        //
        // **MUST NOT 再加中枢的预分配计数**（M590 真机场景 188 现场）：`skip` 已由父客户端在
        // 每轮编排收敛后执行（见 `run_turn_core` 的 mock 区间块），`external_consumed()` 就是
        // 它真实跳过的条数；再叠加 `external_mock_consumed()`（中枢 reserved 总量）会把同一段
        // 区间数两遍，下一轮从更后面的条目开始弹（表现为「模型返回了空响应」）。
        let next = llm::wrap_cursor(
            mock_start,
            client.mock_consumed() + client.external_consumed(),
            len,
        );
        let _ = runtime.with_session(&scope, |s| s.set_mock_cursor(next));
    }
    runtime.release_turn(&scope);
    // 会话自动命名（change add-session-auto-naming，design D9）：**release_turn 之后**才起线程
    // ——结果落盘前复核「会话空闲」，先起线程会被自己这轮的 busy 挡掉。线程只做便宜档辅助调用
    // 与落盘，失败静默（用户面零可见错误）。
    //
    // 无人值守运行槽（change add-cron-runtime-daemon §3.1）：其会话不面向用户展示，命名调用
    // 是纯额外 token 开销，且标题事件也无处可渲染——跳过。
    if runtime.is_isolated() {
        return;
    }
    if let Some(job) = title_job {
        let title_runtime = runtime.clone();
        let title_scope = scope.clone();
        let title_app = app.clone();
        if let Err(e) = std::thread::Builder::new()
            .name("lumir-harness-title".into())
            .spawn(move || {
                let app_sink = TauriEventSink(title_app);
                let sink = events::ScopedSink::new(&app_sink, title_scope.key());
                super::title::run_job(&sink, &title_runtime, &title_scope, job);
            })
        {
            eprintln!("lumir: 会话标题线程启动失败：{e}");
        }
    }
}

/// 循环本体的单测入口：与 [`run_turn_core`] 同一实现，返回值（命名任务）丢弃——单测只断言
/// 会话状态与事件，命名调用由单测直接驱动 `title::run_job_with_client`。
pub fn run_turn_for(
    sink: &dyn EventSink,
    runtime: &Runtime,
    scope: &VaultScope,
    config: &HarnessConfig,
    parts: impl Into<DeliveryInput>,
    context_section: Option<String>,
    client: &mut dyn LlmClient,
) {
    // 与生产入口同一份播种（`run_turn` 的注释即契约）：单测 / 子运行驱动的轮次也吃同一份
    // 「本轮生效规则」，不给测试面留一条不同的判定路径。
    runtime.seed_permissions(&config.permissions);
    let mut ctx = SessionContext::new(sink, runtime, scope, config);
    let _ = run_turn_core(&mut ctx, config, parts, context_section, client);
}

/// 循环本体（上下文与 client 注入，单测直接驱动）。
///
/// 事件信封（vault 标识）由**调用侧包装好的 sink** 承担（`run_turn` 用 [`super::events::ScopedSink`]
/// 包了一层，经 `ctx.sink()` 取用）；本函数不自己盖，单测可以直接注入自己的收集器。
///
/// 会话存在性由 busy 协议保证（`acquire_turn` 建会话、busy 期间 `new_session` /
/// 切 vault 都被挡），循环中途的 `ctx.with_session` 只会 Ok，忽略其 Err 不是吞错。
///
/// 返回值 = 本轮正常完成后要交给后台线程的命名任务（change add-session-auto-naming，
/// design D1/D9）：只有走到 `done` 的轮才可能产出它；`aborted` / 错误收尾的轮恒 `None`
/// （标题素材需要真实问答）。触发判定是纯内存的一次运算，HTTP 调用由调用方起线程。
fn run_turn_core<C: RunContext>(
    ctx: &mut C,
    config: &HarnessConfig,
    parts: impl Into<DeliveryInput>,
    context_section: Option<String>,
    client: &mut dyn LlmClient,
) -> Option<super::title::TitleJob> {
    run_turn_core_with_mode(
        ctx,
        config,
        TurnInput::User {
            parts: parts.into(),
            context_section,
        },
        client,
    )
}

/// 回合输入的两种形态（change add-harness-subagents design §12.6）：
/// - `User`：普通用户回合——user 消息在这里入队；
/// - `Preloaded`：自动唤醒回合——完成通知已经由调度器写进会话历史（input + panel），
///   这里**不再**入队（否则同一条通知会在历史里出现两次）。
pub(crate) enum TurnInput {
    User {
        parts: DeliveryInput,
        context_section: Option<String>,
    },
    Preloaded {
        /// 通知文本（标题素材；自动回合不触发自动命名）。
        user_text: String,
    },
}

pub(crate) fn run_turn_core_with_mode<C: RunContext>(
    ctx: &mut C,
    config: &HarnessConfig,
    input: TurnInput,
    client: &mut dyn LlmClient,
) -> Option<super::title::TitleJob> {
    // 用户回合开始：排队中的后台通知必须在 user 消息**之前**并入历史（design §12.6.2），
    // 并取消待起唤醒、清零链计数。自动回合的链计数已在调度器起回合时推进。
    let mut preloaded: Option<String> = None;
    let mut parts: Option<DeliveryInput> = None;
    let mut context_section: Option<String> = None;
    match input {
        TurnInput::User {
            parts: user_parts,
            context_section: user_context,
        } => {
            ctx.begin_user_turn();
            parts = Some(user_parts);
            context_section = user_context;
        }
        TurnInput::Preloaded { user_text } => preloaded = Some(user_text),
    }
    // user 消息入队（LLM 侧 + 面板侧 + JSONL + 上下文节记录，压缩重注入用）。
    // 上下文节由调用侧从 ContextBlock **同一次生成**并传入（装配与存储同源，M309）——
    // 不再从拼好的 message 里重解析（正文含 `\n\n[` 时会串味）。投递 parts 与面板文本是
    // 同一块序列的两个投影，由 attachments 模块同一组函数产出（design §4.2，REVIEW.md「同一语义两处真源」条）；会话侧（input 项 / JSONL）恒为引用形态，base64 展开只在 client 发送前。
    //
    // `turn_user_text`：本轮用户提问的**原文段**（剥掉自动注入的编辑器上下文节）——飘移信号的
    // 判据素材（change add-session-auto-naming，design D5：标题词元 vs 用户消息词元）。
    let mut turn_user_text = preloaded.clone().unwrap_or_default();
    if let Some(parts) = parts {
        let context_section_for_session = context_section.clone();
        let enqueue = ctx.with_session(|s| {
            let parts =
                super::attachments::apply_context_section(parts.0, context_section.as_deref());
            let item = super::attachments::user_item_of_parts(&parts);
            let panel_text = item["content"]
                .as_array()
                .and_then(|content| super::attachments::panel_text_of_content(content))
                .unwrap_or_default();
            turn_user_text = strip_context_section(&panel_text).to_string();
            s.push_input(item);
            s.push_panel(PanelMessage {
                role: "user".into(),
                text: Some(panel_text),
                summary: None,
                name: None,
                status: None,
                reasoning: None,
                decision: None,
                ts: jsonl::unix_secs_now(),
            });
            s.set_current_context(context_section_for_session);
            // 留存口径：user 消息不进 sidecar——它逐字节在下一条 llm_request.messages 里。
        });
        if let Err(e) = enqueue {
            emit_terminal(ctx, events::error(&e.code, &e.message));
            return None;
        }
    }
    // 中断标注的 base：本轮起点（user 消息已入队）——`abort_turn` 只在此后的消息里
    // 找 assistant 标注「已停止」，此前轮次的历史消息绝不误标（M348）。
    let panel_base = ctx.with_session(|s| s.panel_len()).unwrap_or(0);

    // 工具执行面在回合开始时取一次快照（vault 根 / 忽略策略都是回合级事实）。
    let root = ctx.vault_root().to_path_buf();
    let policy = ctx.ignore_policy().clone();
    let skills = super::context::discover_skills(&root);
    // 调度工具端口在回合开始时取一次（与工具定义快照同刻）：交互路径有、交接契约槽位与
    // 子运行没有。`Arc` 由这里持有，`ToolContext` 只借它的 trait object。
    let cron_port = ctx.cron_port();
    let tctx = ToolContext {
        root: &root,
        policy: &policy,
        skills: &skills,
        cron: cron_port.as_deref(),
    };

    let mut rounds: usize = 0;
    let mut overflow_retried = false;
    // 思考块序号（M362）：本轮工具循环里第几次产出思考。每次 LLM 往返最多产出一个思考块
    // （一次响应一条 reasoning 通道），多个工具轮因此自然形成多个块，序号从前到后递增。
    let mut reasoning_block: u32 = 0;
    loop {
        // 预算闸（design §2.2）：交互路径 = 轮次上限；子运行另有 token / 时间闸。
        match ctx.budget(rounds as u32) {
            BudgetVerdict::Continue => {}
            BudgetVerdict::Exhausted(reason) => {
                ctx.on_budget_exhausted(reason);
                break;
            }
        }
        rounds += 1;
        ctx.on_round(rounds as u32);
        // mock 游标进度（design §18）：父回合每轮把「已弹条数 + 区间长度」告诉上下文，
        // 子运行启动时据此分配不重叠的脚本区间。真 provider 上下文不消费它。
        let script_len = client.mock_script_len();
        ctx.note_mock_progress(
            client.mock_consumed(),
            client.mock_region_span(),
            script_len,
        );

        let request = build_request(ctx);
        // 发送量（M463）：实际会发的 body 字节数，与发送共用 client 的同一份 body 构造
        //（wire 展开只此一份），紧贴发送点取。
        let request_bytes = client.wire_body_bytes(&request);
        // wire 留存（发送点记录，design §2）：发给 LLM 的同一个结构化请求体原样落
        // llm_request——记录点与发送点同点，无二次序列化，不存在翻译层。
        record_llm_request(ctx, config, client, &request, request_bytes);
        // 真流式（M369）：分片在 `complete` 期间收到即转发（正文逐字上屏），中断探测也在流里
        // （`aborted()`）——流式期间点停止即收流，已产出内容留在 `output` 里。思考块序号在
        // 本轮开始时定下：一次 LLM 往返最多一个思考块，该块的所有分片共用同一序号。
        let aborted = || ctx.aborted();
        let stream = TurnStreamSink {
            sink: ctx.sink(),
            aborted: &aborted,
            reasoning_block,
        };
        // provider 请求闸（design §12.3）：父会话自己的往返优先、子请求 FIFO；cron 与子运行
        // 共用同一个 per-provider 信号量。单测替身没有闸（缺省 None）。
        let request_permit = ctx.request_permit();
        let output = client.complete(&request, &stream);
        drop(request_permit);
        // 翻译层诊断（chat 方言的悬空 function_call 丢弃等）：翻译期事件 wire 不可推导，
        // 按 sidecar 记录入留存（与本轮请求-响应同文件、紧贴发送点）。
        record_wire_diagnostics(ctx, client.take_wire_diagnostics());
        // 响应同样即刻落盘（与上面的 llm_request 严格成对，含失败与在途停止的半截响应——
        // 「模型当时回的是什么」是留存事实的一部分）。放在停止检查点之前：
        // 中断轮产出的半截文本同样如实记录。
        record_llm_response(
            ctx,
            &output,
            client.fixture_source(),
            client.requests_encrypted_reasoning(),
        );
        // 响应已弹出：这一轮若含 `task` 调用，子运行区间必须从**本轮响应之后**开始分
        // （design §18 的按 run 预分配区段）。放在发送前取会少算本轮这条。
        ctx.note_mock_progress(
            client.mock_consumed(),
            client.mock_region_span(),
            script_len,
        );

        // —— 思考兜底（M369）——
        // 流式路径已在解析层即时转发；这里只补「没有流式分片、但回放项可提取明文」的老形态
        // （老 fixture / 只发 `output_item.done` 的 provider），整段作一个分片。放在停止检查点
        // **之前**：只有思考、还没正文时被停止，思考块同样要在场（「已产出内容保留」对思考成立）。
        let fallback_reasoning = reasoning_fallback(&output);
        if let Some(text) = fallback_reasoning.as_deref() {
            ctx.sink()
                .emit(events::reasoning_chunk(text, reasoning_block));
        }
        // 进了块序号就进位（与改动前的口径一致：有思考内容才占一块）。
        if fallback_reasoning.is_some() || !output.reasoning_deltas.is_empty() {
            reasoning_block += 1;
        }

        // —— 停止检查点 ①（M348；M369 起在途停止已在流里收口，这里是「收流后」的那一道）：
        // `complete` 期间被请求停止——产出保留、不再继续。中断优先于错误/空响应判定：
        // 用户已表态「不再继续」，别再追错误行。
        if ctx.aborted() {
            abort_turn(ctx, panel_base, &output);
            return None;
        }

        // —— 错误路径：上下文超限可压缩重试一次，其余错误即终态 ——
        if let Some(error) = output.error.clone() {
            // 子运行引擎据此分 `quota` / `error`（design §7.3）；交互上下文是 no-op。
            ctx.on_llm_error(&error);
            if error.context_overflow && config.auto_compact && !overflow_retried {
                overflow_retried = true;
                rounds -= 1; // 重试同一轮，不占循环额度
                match compact_now(ctx, config, client) {
                    Ok(()) => {
                        // 压缩重试成功：撤销刚才那条「上下文超限」错误，否则子运行引擎会把
                        // 已恢复的请求误判为终态（设计 §7.5 的「沿用一次重试」）。
                        ctx.on_llm_error_recovered();
                        // 停止检查点（M374）：压缩期间点的停止在此收口——否则 `continue`
                        // 会再开一轮 LLM 往返，被取消的请求重新跑起来（迟到完成复活）。
                        if ctx.aborted() {
                            abort_turn(ctx, panel_base, &llm::TurnOutput::default());
                            return None;
                        }
                        continue;
                    }
                    Err(e) => {
                        emit_terminal(ctx, events::error(&e.code, &e.message));
                        return None;
                    }
                }
            }
            let error_payload = llm_error_payload(&error);
            ctx.persist(error_payload);
            // SSE 事件形态**不变**（前端只读 code/message）：wire 面诊断字段只进留存。
            emit_terminal(ctx, events::error(&error.code, &error.message));
            return None;
        }

        // —— 输出项入队（分片不在这里发：M369 起正文 / 思考分片都在流式路径即时转发）——
        let assistant_text = output.text.clone();
        // 本轮 usage 的累计与读数（M443）：入口是 [`session::Session::record_usage`]——先累加
        // 本逻辑会话的计数、再算全部读数并返回快照。返回值同时喂快照（会话状态）与事件两条
        // 通道：同一份算法一处产出，MUST NOT 各算一套（REVIEW.md 「同一语义两处真源」条）。
        let turn_usage = output.usage;
        let mut usage_snapshot = None;
        let _ = ctx.with_session(|s| {
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
                    decision: None,
                    ts: jsonl::unix_secs_now(),
                });
            }
            // 正文 / 思考 / 调用 / 用量已随上面的 llm_response 落盘（wire 口径）——
            // 这里不再各记一份 sidecar（被 wire 覆盖的 kind 全部废弃，防双写）。
            if let Some(usage) = turn_usage {
                // 窗口按配置 schema 读取（M373：`providers.<id>.models` 的逐模型声明，未列出
                // 回落保守默认）——llm.rs 的预设窗口表已退役。
                let window = config.context_window(&config.provider, llm::active_model(config));
                usage_snapshot = Some(s.record_usage(&usage, window));
            }
        });
        if let Some(snapshot) = usage_snapshot {
            ctx.sink().emit(events::usage(&snapshot));
        }
        ctx.on_assistant_text(&assistant_text);
        if let Some(usage) = turn_usage {
            ctx.on_round_usage(&usage.into());
        }
        // token / 时间闸的「往返后复查」（design §7.1）：触顶后不再执行本轮的工具调用，
        // 用已有产出收敛。轮次闸不在此复查——交互路径的 loop_max 语义是「跑完本轮调用、
        // 下一轮不再发请求」，行为逐字节不变。
        if let BudgetVerdict::Exhausted(reason) = ctx.budget(rounds as u32) {
            if reason != super::run::StopReason::Rounds {
                ctx.on_budget_exhausted(reason);
                break;
            }
        }

        if output.is_empty_response() {
            emit_terminal(
                ctx,
                events::error(
                    "harness_empty_response",
                    "模型返回了空响应（无文本也无工具调用），本轮已停止",
                ),
            );
            return None;
        }

        if output.calls.is_empty() {
            // 轮完成：按 design §9 检查自动压缩（越阈值即压缩续聊；失败不阻断）。
            if config.auto_compact {
                if let Some(snapshot) = usage_snapshot {
                    if snapshot.ctx_pct >= config.warn_ctx_pct {
                        let _ = compact_now(ctx, config, client);
                        // 停止检查点（M374）：压缩调用用 DiscardStreamSink（流里不问停止），
                        // 压缩期间点的停止只能在这里收口——不在此检查的话，下面的 `done`
                        // 会把已流式回复当作正常完成带进消息流，已取消的轮次「复活」。
                        if ctx.aborted() {
                            abort_turn(ctx, panel_base, &llm::TurnOutput::default());
                            return None;
                        }
                    }
                }
            }
            break;
        }

        // —— 执行工具调用（allow 直执行 / deny 回送 / ask 走批准闸）——
        // 普通调用逐个串行；并行编排类调用（`task`）**启动后不排队等待**——同一助手消息里
        // 的多个 `task` 因此并行推进（design §12.1）。**入 input 的顺序另算**：先攒下每条的
        // 「调用项 + 输出项」，本轮结束（或中断收口）时一次按调用顺序压栈（见
        // [`flush_call_items`] 与 [`execute_calls`]）。
        let pending = match execute_calls(ctx, &tctx, &output.calls, rounds as u32) {
            Ok(pending) => pending,
            // 中断收口前先把**已执行**调用的项入 input（与逐条压栈的效果一致，只是顺序
            // 改成成组）；未执行的调用不留任何项，会话里不会出现悬空的 function_call。
            Err(()) => {
                abort_turn(ctx, panel_base, &llm::TurnOutput::default());
                return None;
            }
        };
        // mock：父客户端跳过子运行预分配的区间（design §18；M590 补的接线——M588 只落了
        // `LlmClient::skip` 的方向，回合循环里没有调用点，父的下一轮会把子区间里的条目
        // 当成自己的续写）。`external_consumed()` 是本客户端已跳过的条数，与中枢的预分配
        // 总量之差即本轮新增的区间；`mock_script_len()` 守卫保证真 provider 恒不进入。
        if client.mock_script_len().is_some() {
            let reserved = ctx.external_mock_consumed();
            let skipped = client.external_consumed();
            if reserved > skipped {
                client.skip(reserved - skipped);
            }
        }
        flush_call_items(ctx, &pending);
        // 停止检查点 ③：中断落在最后一个调用的执行期间——不在此收口的话循环会
        // 白多跑一轮 LLM 往返才在检查点 ① 被截住（「不再继续」以最早检查点为准）。
        if ctx.aborted() {
            abort_turn(ctx, panel_base, &llm::TurnOutput::default());
            return None;
        }
    }
    emit_terminal(ctx, events::done());
    // 自动唤醒回合不是用户发言：不触发会话自动命名（标题素材需要真实问答）。
    if preloaded.is_some() {
        return None;
    }
    // 会话自动命名（change add-session-auto-naming，design D1/D9）：`done` 之后做一次**纯内存**
    // 的触发判定 + 素材装配，把任务交回调用方起后台线程——轮完成路径不等 HTTP、不持会话锁发
    // 请求（ADR 0002 §6：不进 keypress-to-paint 与轮次完成路径）。
    ctx.after_turn(&turn_user_text)
}

/// 一条助手消息里的全部工具调用：普通调用逐个执行，编排类调用（`task`）**先全部启动**，
/// 再按**调用顺序**收敛，结果收进 `BTreeMap<call_index, (调用项, 输出项)>`（design §12.2
/// 第 3 条：完成顺序不影响回填顺序）。
///
/// 中断（`ctx.aborted()`）在任何一次执行前收口：已执行的调用项照常入 input 后返回 `Err`，
/// 调用侧走既有 `abort_turn`。被中断的编排句柄随 drop 收敛（生命周期归子运行引擎）。
fn execute_calls<C: RunContext>(
    ctx: &mut C,
    tctx: &ToolContext,
    calls: &[llm::ToolCall],
    rounds: u32,
) -> Result<Vec<(serde_json::Value, serde_json::Value)>, ()> {
    let mut results: BTreeMap<usize, (serde_json::Value, serde_json::Value)> = BTreeMap::new();
    // 编排调用（`task`）：先全部**启动**，再按调用序收敛（design §12.1 / §12.2）。
    let mut handles: Vec<TaskHandleEntry> = Vec::new();
    for (index, call) in calls.iter().enumerate() {
        if ctx.aborted() {
            let executed: Vec<_> = results.values().cloned().collect();
            flush_call_items(ctx, &executed);
            return Err(());
        }
        // 时间 / token 闸的「工具调用前」检查点（design §7.1 表 + spec scenario
        // 「时间闸在工具调用前生效」）：一批 N 个调用不得整体超支。轮次闸不在此复查
        // （交互 loop_max 的既有语义是「本批跑完、下一轮不再发请求」）。
        if call.name != "task" {
            if let BudgetVerdict::Exhausted(reason) = ctx.budget(rounds) {
                if reason != super::run::StopReason::Rounds {
                    ctx.on_budget_exhausted(reason);
                    let executed: Vec<_> = results.values().cloned().collect();
                    flush_call_items(ctx, &executed);
                    return Err(());
                }
            }
        }
        if call.name == "task" {
            // 工具行按调用序创建：started 事件在启动时发，done 在收敛时发（`finish_call`）。
            let args_summary = summarize_args(&call.arguments);
            ctx.sink()
                .emit(events::tool_call(&call.name, "started", &args_summary));
            let handle = ctx.orchestrate(call).unwrap_or_else(|| {
                // 注册表约定：`task` 恒有句柄（含 disabled / 参数非法）；走到这里的上下文
                // 不认识编排工具（子运行上下文）——按「不可用」如实回送。
                Box::new(RejectedCall::new(serde_json::json!({
                    "ok": false,
                    "code": "disabled",
                    "message": "当前运行不支持子代理委派",
                }))) as Box<dyn OrchestrationCall>
            });
            handles.push(TaskHandleEntry {
                index,
                call: call.clone(),
                args_summary,
                handle,
            });
            continue;
        }
        let (call_item, output_item) = handle_call(ctx, tctx, call);
        results.insert(index, (call_item, output_item));
    }
    // 句柄已全部启动：这里按**调用顺序**逐个收敛，完成先后不改变回填顺序。
    for entry in handles {
        let value = entry.handle.result_value();
        let output = ToolOutput { value };
        let item = finish_call(ctx, &entry.call, output, entry.args_summary, None);
        results.insert(entry.index, item);
    }
    Ok(results.into_values().collect())
}

/// 一个已启动的编排调用（`task`）。
struct TaskHandleEntry {
    index: usize,
    call: llm::ToolCall,
    args_summary: String,
    handle: Box<dyn OrchestrationCall>,
}

/// 立即收敛的编排结果（拒绝 / 不可用）：句柄在创建时就有结果，join 不阻塞。
pub(crate) struct RejectedCall {
    value: serde_json::Value,
}

impl RejectedCall {
    pub(crate) fn new(value: serde_json::Value) -> Self {
        Self { value }
    }
}

impl OrchestrationCall for RejectedCall {
    fn join(self: Box<Self>) -> (serde_json::Value, serde_json::Value) {
        (
            serde_json::json!({}),
            serde_json::json!({
                "type": "function_call_output",
                "output": serde_json::to_string(&self.value).unwrap_or_default(),
            }),
        )
    }

    fn result_value(self: Box<Self>) -> serde_json::Value {
        self.value
    }
}

/// 编排调用的收敛与回填（M586 的纯顺序用例直测）：**键是调用序号**，完成先后不影响
/// 回填顺序（design §12.2 第 3 条）。
#[cfg(test)]
fn join_in_call_order(
    results: &mut BTreeMap<usize, (serde_json::Value, serde_json::Value)>,
    handles: Vec<(usize, Box<dyn OrchestrationCall>)>,
) {
    for (index, handle) in handles {
        results.insert(index, handle.join());
    }
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
fn abort_turn<C: RunContext>(ctx: &mut C, panel_base: usize, output: &llm::TurnOutput) {
    let assistant_text = output.text.clone();
    // 程序性中止（无人值守运行的批准闸，change add-cron-runtime-daemon §3.5）：终态必须带
    // 错误码，回执据此产出 `cron_run_finished(ok=false, error=approval_required)`。
    let stop_reason = ctx.with_session(|s| s.take_stop_reason()).ok().flatten();
    let _ = ctx.with_session(|s| {
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
                decision: None,
                ts: jsonl::unix_secs_now(),
            });
            // 半截正文已在响应点随 llm_response 落盘（wire 口径），这里不再记 sidecar。
        }
        s.mark_last_assistant_stopped(panel_base);
        // 决策类 sidecar：中断是 wire 不可推导的用户决策。程序性中止（批准闸）带上原因，
        // 留存与诊断两侧可区分「用户停止」与「无人值守运行被批准闸中止」。
        let payload = match &stop_reason {
            Some(reason) => serde_json::json!({"kind": "turn_aborted", "reason": reason.code}),
            None => serde_json::json!({"kind": "turn_aborted"}),
        };
        s.jsonl().record(&payload);
    });
    match stop_reason {
        Some(reason) => emit_terminal(ctx, events::error(reason.code, &reason.message)),
        None => emit_terminal(ctx, events::aborted()),
    }
}

/// 流式增量 → 面板事件的转发器（M369 真流式）：`llm` 的解析层在流中调用它。
///
/// 事件形状收在这里（解析层不该知道 `text_chunk` / `reasoning_chunk` 的字段，也不该知道
/// 「思考块序号」这个展示侧概念）；`aborted()` 直接查上下文的停止标志——解析层因此不必反向
/// 依赖运行上下文（`llm` 不感知会话层）。调用发生在解析线程上且**不持有任何会话锁**
///（`complete` 全程在锁外，见模块头），`aborted()` 只短暂取一次锁。
struct TurnStreamSink<'a> {
    /// 已盖 vault 信封的出口（`run_turn` 的 [`super::events::ScopedSink`]）。
    sink: &'a dyn EventSink,
    /// 在途停止的判据（上下文注入；不持有 `&mut ctx`，流式期间只读）。
    aborted: &'a dyn Fn() -> bool,
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
        (self.aborted)()
    }
}

/// 构造 LLM 请求（系统上下文 + 全部历史 + 工具定义 + 本轮思考档位；会话历史每轮整体序列化，
/// 克隆即可）。档位在**会话侧**（M362），这里读一次——本轮内不再变（切档位影响其后发出的消息）。
///
/// 工具定义走 [`RunContext::tool_definitions`]：交互上下文 = 当前注册表；子运行 = 定义白名单。
/// 这是回抽唯一改变交互路径**数据面**的点（其余是调用面），无子代理定义时与既有 9 件清单
/// 深度相等（单测钉死）。
fn build_request<C: RunContext>(ctx: &mut C) -> llm::Request {
    let (system, input, effort) = ctx
        .with_session(|s| {
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
        tools: ctx.tool_definitions(),
        effort,
    }
}

/// 发送点落 `llm_request`：记录体就是传给 client 的同一个结构化 `Request`
/// （provider / model / system / messages / params），发送前落盘。工具循环每次迭代
/// 与压缩调用各自走本函数——每次 LLM 调用恰一条。
///
/// `model` 取 [`LlmClient::model`]（调用级覆盖生效后的实际值），缺省回落 `active_model`：
/// 覆盖参数与留存值只允许一处真源（REVIEW.md「同一语义两处真源」条）。
fn record_llm_request<C: RunContext>(
    ctx: &mut C,
    config: &HarnessConfig,
    client: &dyn LlmClient,
    request: &llm::Request,
    request_bytes: Option<u64>,
) {
    let model = client.model().unwrap_or_else(|| llm::active_model(config));
    let mut payload = serde_json::json!({
        "kind": "llm_request",
        "request": {
            "provider": config.provider,
            "model": model,
            "system": request.system,
            "messages": request.input,
            "params": { "thinking": request.effort.as_str() },
        },
    });
    // 发送量计量（M463）：**实际会发**的 body 字节数（含 wire 展开后的尺寸——附件 data URL
    // 已算进去）。None = 该 client 不发真实 HTTP body（mock 只弹脚本），此时省略该键。
    // 让「这次请求多大」有一个直接读数，不必再按会话字节比外推（M463 探测的教训）。
    if let Some(bytes) = request_bytes {
        payload["request_bytes"] = serde_json::json!(bytes);
    }
    ctx.persist(payload);
}

/// HTTP 面诊断字段的追加（M463 起）：`http_status` / `raw_body`（已截断，见
/// `llm::ERROR_BODY_MAX_CHARS`）/ `body_truncated` / `request_id` 按在场与否追加——
/// `llm_error` sidecar 与 `llm_response` 的错误分支**共用这一处**（记录形状单一真源，
/// REVIEW.md 「同一语义两处真源」条）；网络层失败、mock 脚本化错误、流内错误没有 HTTP 面，什么都不会
/// 追加（新键缺席 = 该错误没有 HTTP 面，**不是**空值）。
fn append_error_diagnostics(payload: &mut serde_json::Value, error: &llm::TurnError) {
    if let Some(status) = error.http_status {
        payload["http_status"] = serde_json::json!(status);
    }
    if let Some(body) = &error.raw_body {
        payload["raw_body"] = serde_json::json!(body);
    }
    if error.body_truncated {
        payload["body_truncated"] = serde_json::json!(true);
    }
    if let Some(id) = &error.request_id {
        payload["request_id"] = serde_json::json!(id);
    }
}

/// `llm_error` sidecar 记录的载荷（M463 起带 wire 面诊断字段）：`code` / `message` 恒在，
/// 其余按在场与否由 [`append_error_diagnostics`] 追加。
///
/// 抽成纯函数：① 单测不必起 HTTP 服务就能钉记录形状；② 记录形状只有这一处产出（免得
/// 记录点与测试各拼一份，REVIEW.md 「同一语义两处真源」条）。
fn llm_error_payload(error: &llm::TurnError) -> serde_json::Value {
    let mut payload = serde_json::json!({
        "kind": "llm_error",
        "code": error.code,
        "message": error.message,
    });
    append_error_diagnostics(&mut payload, error);
    payload
}

/// 翻译层诊断的 sidecar 记录（change add-harness-chat-completions-dialect）：chat 方言翻译时
/// 丢弃的项（悬空 `function_call` 等）是 **wire 不可推导**的事件——不发出去，但会改变模型
/// 看到的历史，必须可审计。与 approval / llm_error 同族：每轮 `complete` 之后紧贴发送点落盘；
/// 空表（Responses / mock / 无诊断）不产生任何记录。
fn record_wire_diagnostics<C: RunContext>(ctx: &mut C, diagnostics: Vec<llm::WireDiagnostic>) {
    for diagnostic in diagnostics {
        let payload = serde_json::json!({
            "kind": "wire_diagnostic",
            "code": diagnostic.code,
            "call_id": diagnostic.call_id,
            "message": diagnostic.message,
        });
        ctx.persist(payload);
    }
}

/// 响应点落 `llm_response`：正文 / reasoning 回放项原文 / thinking 展示文本 / 工具调用 /
/// usage / error（无则缺省）+ mock provider 的 fixture 因果链。与上一条 `llm_request`
/// 严格成对——失败、空响应、在途停止的半截响应都如实记录（`error` 字段在场）。
///
/// reasoning 与 thinking **物理分离**（design §2，M362 纪律）：`reasoning` = 回放项
/// （provider 方言的明文载体——kimi 的 `summary` / deepseek 的 `reasoning_text` content
/// parts 各按真实形状，`encrypted_content` 在场即带），**M464 起已是归一形状**（捕获侧经
/// [`llm::normalize_reasoning_item`] 剥掉 `rs_*` id——`store:false` 下重放 id 属非标用法），
/// 恢复时按同一归一回传（M306 / M360 回放语义保真，无需按 provider 分支重建，design §6.2
/// 的恢复算法从本键取回放项）；`thinking` = **展示文本**（展示通道分片汇总）——分片缺席
/// （老 fixture / 只发 `output_item.done` 的 provider）时退回从回放项提取明文，与面板所见
/// 同源；密文永不进 thinking（`thinking::reasoning_text` 只返明文）。
///
/// `encrypted_reasoning_requested` = client 本轮是否发了 `include:["reasoning.encrypted_content"]`
/// （与 `wire_body` 同一份布尔，经 [`llm::LlmClient::requests_encrypted_reasoning`] 传入）。
/// 为真时落 `reasoning_encrypted: {requested, received}`——M464 密文回放路径是否生效的
/// 留存读数（2026-10-14 真机溢出复盘只能事后从 reasoning 项数出 29/29 缺席，「没请求」与
/// 「请求了没回」分不开；键缺席 = 未请求，与错误诊断键同口径）。
fn record_llm_response<C: RunContext>(
    ctx: &mut C,
    output: &llm::TurnOutput,
    fixture_source: Option<&str>,
    encrypted_reasoning_requested: bool,
) {
    let mut payload = serde_json::json!({
        "kind": "llm_response",
        "text": output.text,
    });
    if let Some(reasoning) = &output.reasoning {
        payload["reasoning"] = reasoning.clone();
    }
    if encrypted_reasoning_requested {
        payload["reasoning_encrypted"] = serde_json::json!({
            "requested": true,
            "received": output
                .reasoning
                .as_ref()
                .is_some_and(reasoning_has_encrypted_content),
        });
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
            "cache_write_tokens": usage.cache_write_tokens,
        });
    }
    if let Some(error) = &output.error {
        payload["error"] = serde_json::json!(format!("{}: {}", error.code, error.message));
        // 超限时压缩重试成功即续跑，永远到不了下面的 `llm_error` sidecar——HTTP 面
        // 诊断字段必须在这里一并落盘（2026-10-14 真机溢出的 kimi request_id 因此
        // 不可考，见 backlog『错误响应落盘丢失』条；与 sidecar 共用同一追加函数）。
        append_error_diagnostics(&mut payload, error);
    }
    if let Some(source) = fixture_source {
        payload["mock_fixture"] = serde_json::json!(source);
    }
    ctx.persist(payload);
}

/// reasoning 回放项里是否带非空 `encrypted_content`（密文回放路径是否生效的事实判定）：
/// 递归扫键、不按 provider 方言分支——只认「键在场且值为非空字符串」这一事实（kimi 的
/// 密文在 reasoning 项顶层；将来方言变体落在嵌套层也算收到）。
fn reasoning_has_encrypted_content(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(map) => map.iter().any(|(key, v)| {
            (key == "encrypted_content" && v.as_str().is_some_and(|s| !s.is_empty()))
                || reasoning_has_encrypted_content(v)
        }),
        serde_json::Value::Array(items) => items.iter().any(reasoning_has_encrypted_content),
        _ => false,
    }
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

/// 单个工具调用：权限判定 → （ask 档）批准闸 → 执行 → 结果回送（事件 + 面板 + JSONL）。
///
/// **不直接把消息项压进 input**：返回「调用项 + 输出项」由调用侧成组压栈（见
/// [`flush_call_items`]）；面板与 JSONL 的记录仍在本函数内、逐条按时序落，故用户看到的
/// 工具行顺序与执行顺序一致，不受入 input 顺序影响。
fn handle_call<C: RunContext>(
    ctx: &mut C,
    tctx: &ToolContext,
    call: &llm::ToolCall,
) -> (serde_json::Value, serde_json::Value) {
    // 参数摘要：live「started」事件与面板快照（M367 持久化）共用同一份，MUST NOT 各算各的
    // （REVIEW.md 「同一语义两处真源」条：同一语义两处真源）。
    let args_summary = summarize_args(&call.arguments);
    ctx.sink()
        .emit(events::tool_call(&call.name, "started", &args_summary));
    let parsed: Result<serde_json::Value, _> = serde_json::from_str(&call.arguments);
    let args_ok = parsed.is_ok();
    let args = parsed.unwrap_or_default();
    // 未知工具（清单外）：直接回送错误，不进权限判定——它不可执行，走 ask 闸
    // 只会把循环挂死在永远等不到的批准上（工具集是闭集合，MUST NOT 扩张）。
    //
    // 三件调度工具只在交互路径「已知」：判据与定义注册面、`ToolContext::cron` 同源——
    // 无人值守运行 / 子运行里同名调用仍是清单外的工具名（change
    // add-cron-conversational-registration design §2.2）。
    let known = tools::TOOL_NAMES.contains(&call.name.as_str())
        || (tools::CRON_TOOL_NAMES.contains(&call.name.as_str()) && tctx.cron.is_some());
    let subject = tools::permission_subject(&call.name, &args);

    // 批准闸决定（面板 decision 字段的数据源，M413）：只有 ask 档批准闸产出
    // approved / rejected；allow / deny / 重定向路径没有批准动作，字段缺席。
    let mut gate_decision: Option<&'static str> = None;
    let output = if !known {
        ToolOutput::err("tool_unknown", format!("未知工具：{}", call.name))
    } else if !ctx.tool_allowed(&call.name) {
        // 执行层二次校验（design §8.2）：子运行只拿到定义白名单里的工具，未声明的调用
        // 在模型幻觉时也可能出现——拒绝、不执行。
        ToolOutput::err(
            "tool_not_allowed",
            format!(
                "子运行无权调用工具 {}（不在本定义的 tools 白名单里）",
                call.name
            ),
        )
    } else if !args_ok {
        ToolOutput::err("tool_args_invalid", "工具调用的 arguments 不是合法 JSON")
    } else if let Err(output) = tools::check_purpose(&call.name, &args) {
        // purpose 校验在判定管线之前（design §3.4）：ask 档批准卡必须已有用途句可展示。
        output
    } else {
        // 判定与批准缓存命中都经上下文（缓存键 / 层序在实现侧，见 `RunContext::decide`）；
        // 只有「已知 + 参数合法 + purpose 合法」的调用才进判定（回抽前同样不判定前两档）。
        let verdict = ctx.decide(&call.name, &subject, &args);
        match verdict.decision {
            // 模式层不产出 Deny（只读档 = Always Ask），Deny 只来自第 1 层的用户 deny 规则。
            // M459：回送文案带上命中的规则原文（「是哪条规则拦的」不必回配置文件核对）。
            Decision::Deny => ToolOutput::err(
                "permission_denied",
                denied_message(&call.name, &subject, verdict.reason.as_ref()),
            ),
            // deny 的留痕是 wire 口径：带 `permission_denied` 错误码的结果随历史进
            // 下一条 llm_request.messages（tool_denied 事件类已废弃），面板 tool 行
            // 的细分状态照常由 status 承担。
            Decision::Allow => tools::execute(&call.name, &args, tctx),
            Decision::Ask => {
                // 判定依据（M459）随批准请求进批准闸——事件与快照两条通道同取这一个值。
                let (out, decision) = gated_execute(
                    ctx,
                    tctx,
                    subject.as_str(),
                    GatedCall {
                        call,
                        args: &args,
                        reason: verdict.reason,
                    },
                );
                gate_decision = decision;
                out
            }
            // vault 内写硬重定向（design §4）：固定标记 + JSON 载荷，模型据此下一轮改用
            // vault 工具（闸门不做自动翻译，不留第二事实源）。
            Decision::Redirect(redirect) => {
                ToolOutput::err(permissions::REDIRECT_ERROR_CODE, redirect.message())
            }
        }
    };

    // 子运行引擎据此计 `tool_calls` 与 `denied_calls`（交互上下文是 no-op）。
    ctx.on_tool_result(&call.name, &output.value);
    finish_call(ctx, call, output, args_summary, gate_decision)
}

/// 一次工具调用的收尾（普通工具与编排工具共用）：细分终态、事件、面板行、结果项。
///
/// 编排工具（`task`）走同一条收尾路径，区别只在结果来自子运行句柄——因此工具行顺序
/// 永远按调用序创建、只就地更新状态（design §12.2 第 2 条）。
fn finish_call<C: RunContext>(
    ctx: &mut C,
    call: &llm::ToolCall,
    output: ToolOutput,
    args_summary: String,
    gate_decision: Option<&'static str>,
) -> (serde_json::Value, serde_json::Value) {
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
    ctx.sink()
        .emit(events::tool_call(&call.name, "done", &result_summary));
    // 面板快照持久化 summary（M367）：成功 = 参数摘要（恢复后工具行显示「调用了什么工具、
    // 带了什么参数」）；失败 = 结果摘要（含细分状态与错误码）。修前 summary 恒 None，面板
    // 重载（快照恢复路径）后工具行摘要全丢。
    let panel_summary = if output.succeeded() {
        args_summary
    } else {
        result_summary
    };
    let output_text = serde_json::to_string(&output.value).unwrap_or_default();
    let _ = ctx.with_session(|s| {
        s.push_panel(PanelMessage {
            role: "tool".into(),
            text: Some(output_text.clone()),
            summary: Some(panel_summary),
            name: Some(call.name.clone()),
            status: Some(status.to_string()),
            reasoning: None,
            decision: gate_decision.map(str::to_string),
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
fn flush_call_items<C: RunContext>(
    ctx: &mut C,
    pending: &[(serde_json::Value, serde_json::Value)],
) {
    if pending.is_empty() {
        return;
    }
    let _ = ctx.with_session(|s| {
        for (call_item, _) in pending {
            s.push_input(call_item.clone());
        }
        for (_, output_item) in pending {
            s.push_input(output_item.clone());
        }
    });
}

/// 进批准闸的一次调用（[`gated_execute`] 的输入面）：工具调用本体 + 判定依据。
/// 主体串单独传（批准缓存键，与判定同源）；这里只收「被闸住的这次调用」自己的两件。
struct GatedCall<'a> {
    call: &'a llm::ToolCall,
    args: &'a serde_json::Value,
    /// 判定依据（M459）：随批准请求进 `ApprovalRequest`，事件与快照两条 UI 通道都从这里取。
    reason: Option<permissions::DecisionReason>,
}

/// 批准卡两枚次级动作的派生（change harness-permission-rules-oct23 design §5）：**唯一产出点**。
///
/// 危险黑名单层（`DangerousWrapper` / `DangerousCommand`，判定第 3 层）两项皆 `None`——那一层
/// 先于 allow 规则与会话缓存，按钮点了也不生效（D3 裁决：死按钮藏起来）。其余进闸的卡按
/// [`permissions::permission_prefix`] 给粒度 / 规则文本（`vault_delete` / `cron_task_*` 的规则
/// 为 `None`，Q7 裁决）。`reason` 缺席（未来新增的 Ask 层未标依据）按模式层处理——那是保守侧
/// 唯一可用的读法，且与「字段缺省 = 不渲染」的按钮开关不冲突。
fn gated_actions(
    tool: &str,
    argv: Option<&[String]>,
    subject: &str,
    reason: Option<&permissions::DecisionReason>,
) -> Option<permissions::PermissionActions> {
    match reason {
        Some(permissions::DecisionReason::DangerousWrapper { .. })
        | Some(permissions::DecisionReason::DangerousCommand) => None,
        _ => permissions::permission_prefix(tool, argv, subject),
    }
}

/// ask 档：无人值守短路 → 生成预览 → 挂起批准 → 等决定 → 采纳执行 / 拒绝回送。
///
/// 返回值带批准闸决定（`Some("approved")` / `Some("rejected")`）——面板工具行的
/// decision 字段数据源；通道失效 / 本轮被停止没有决定，返回 None。
///
/// 挂起、事件上屏与等待都在 [`RunContext::approval`] 内完成（交互上下文 = 既有批准闸；
/// 子运行 = 透传到父会话）。无人值守策略在**预览之前**由
/// [`RunContext::reject_unavailable`] 短路。本函数只保留与工具语义相关的三件事：
/// 预览、执行、拒绝文案。
fn gated_execute<C: RunContext>(
    ctx: &mut C,
    tctx: &ToolContext,
    subject: &str,
    gated: GatedCall<'_>,
) -> (ToolOutput, Option<&'static str>) {
    // 无人值守槽位（change add-cron-runtime-daemon §3.5，master 的既有顺序）：在生成预览
    // **之前**短路——预览失败（如 patch 目标缺失 / 不唯一命中）同样中止本次运行，不得把
    // 预览错误回送模型续跑。这是 cron 已合并的语义，公共层回抽 MUST NOT 改变它。
    if let Some((code, message)) = ctx.reject_unavailable() {
        return (ToolOutput::err(&code, &message), None);
    }
    let GatedCall { call, args, reason } = gated;
    let preview = match tools::approval_preview(&call.name, args, tctx) {
        Ok(preview) => preview,
        // 预览失败（如 patch 不唯一命中）：错误直接回送模型，不进批准闸。
        Err(output) => return (output, None),
    };
    let (tx, rx) = mpsc::channel();
    // 两枚次级动作（change harness-permission-rules-oct23 design §5）：唯一产出点在这里。
    let actions = gated_actions(
        &call.name,
        preview.argv.as_deref(),
        subject,
        reason.as_ref(),
    );
    let request = ApprovalRequest::new(
        call.name.clone(),
        preview.diff.clone(),
        preview.argv.clone(),
        preview.purpose.clone(),
        reason.clone(),
        subject.to_string(),
        actions.as_ref().map(|a| a.remember_label.clone()),
        actions.as_ref().and_then(|a| a.rule.clone()),
        tx,
    )
    .with_cron_task(preview.cron_task.clone());
    // 事件载荷（purpose / 判定依据与批准卡同源）由上下文在挂起成功后发行；无人值守槽位
    // 在这里得到 `approval_required`（程序性中止原因已由上下文置进会话）。
    let decision = match ctx.approval(request, rx) {
        ApprovalOutcome::Decided(decision) => decision,
        ApprovalOutcome::Withdrawn => {
            // 本轮被用户停止（M348），待决项已收回——如实记 turn_aborted，循环里的停止
            // 检查点随即收口，不继续执行也不回送模型。
            return (
                ToolOutput::err("turn_aborted", "本轮已停止，待批准的调用未执行"),
                None,
            );
        }
        ApprovalOutcome::Stale => {
            return (
                ToolOutput::err(
                    "approval_stale",
                    "批准通道已关闭（会话被重置或 vault 已切换），本次调用未执行",
                ),
                None,
            );
        }
        ApprovalOutcome::Unavailable { code, message } => {
            return (ToolOutput::err(&code, &message), None);
        }
        ApprovalOutcome::Failed(error) => {
            return (ToolOutput::from_command_error(&error), None);
        }
    };
    if decision.approved {
        // 「采纳且本会话不再问」（design §6）：写会话内批准缓存——唯一写入点。
        // 缓存键与判定时的取法同源（同一份 `permission_prefix` 派生量；A3 起 cli_run 是
        // 带尾随空格的命令前缀键）。
        if decision.remember {
            if let Some(actions) = &actions {
                ctx.remember_approval(&call.name, &actions.remember_key);
            }
        }
        // 写工具带预览基准 revision 执行：批准窗内文件被改 ⇒ fs_patch_file CAS
        // 拒掉（document_conflict 回送模型），落盘不与已批准 diff 分叉。
        (
            tools::execute_with_revision(&call.name, args, tctx, preview.revision.as_deref()),
            Some("approved"),
        )
    } else {
        let reason = decision
            .reason
            .clone()
            .unwrap_or_else(|| "用户拒绝了该操作".to_string());
        (
            ToolOutput::err("approval_rejected", reason),
            Some("rejected"),
        )
    }
}

/// 压缩续聊（design §9，裁决点 6）：会话历史压成摘要 → **开新逻辑会话**（新留存文件 +
/// 重新装配系统上下文——三处装配点之一），注入摘要 + 当前编辑器上下文。压缩调用自身
/// 也走 wire 留存（llm_request / llm_response 各一条，落在**旧**文件里：摘要的产出
/// 过程是「模型当时看到了什么」的一部分）；旧文件封闭不再追加，摘要随新文件首行
/// `session_open.compact_summary` 留存。失败不阻断对话，由调用点决定是否终态。
fn compact_now<C: RunContext>(
    ctx: &mut C,
    config: &HarnessConfig,
    client: &mut dyn LlmClient,
) -> Result<(), CommandError> {
    const COMPACT_INSTRUCTION: &str = "\
把以下对话历史压缩成一份续聊摘要，供新会话接着工作：保留用户的目标与关键诉求、\
已经确认的决策、工具调用的关键结果（读了什么、改了什么、批准与否）、尚未完成的动作。\
丢掉逐字过程与重复内容。用与用户相同的语言写摘要。";

    let input = ctx.with_session(|s| s.input().to_vec())?;
    let history = render_history(&input);
    // 压缩是一次汇总调用，不产思考块给人看；档位照会话现值传（不另造一个默认值，
    // 否则「同一个会话里两种档位」会多一处隐式状态——M362）。
    let effort = ctx
        .with_session(|s| s.thinking_effort())
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
    // 发送量同 llm_request 一起记（M463，与发送共用 client 的 body 构造）。
    let compact_bytes = client.wire_body_bytes(&compact_request);
    record_llm_request(ctx, config, client, &compact_request, compact_bytes);
    // 压缩也是一次 provider 请求：走同一个请求闸（design §12.3）。
    let compact_permit = ctx.request_permit();
    let output = client.complete(&compact_request, &llm::DiscardStreamSink);
    drop(compact_permit);
    // 压缩 usage 计入本段预算、但不进任何模型桶（design §7.5）。
    if let Some(usage) = output.usage {
        ctx.on_compact_usage(&usage.into());
    }
    if let Some(error) = &output.error {
        ctx.on_llm_error(error);
    }
    record_wire_diagnostics(ctx, client.take_wire_diagnostics());
    record_llm_response(
        ctx,
        &output,
        client.fixture_source(),
        client.requests_encrypted_reasoning(),
    );
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
    // 会话侧收尾由上下文决定（交互 = 新留存文件 + 重装系统上下文；子运行 = 只压内存态输入）：
    // 压缩请求本身是共享的，轮换策略是上下文事实。
    ctx.begin_compacted_session(&summary)
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

/// 参数摘要：live `started` 事件、面板持久化（M367）与恢复重建（M398，从 wire 的
/// function_call 项取参数）共用同一份——MUST NOT 各算各的（REVIEW.md 「同一语义两处真源」条）。
///
/// **命令本体恒在最前**（M528）：cli_run 的 arguments 是模型现写的 JSON，键序不定。原样按
/// [`SUMMARY_LIMIT`] 截断时，`args` 排在 `command` 前面就会把命令本体切掉，面板上
/// 只剩一串参数——Alex 2026-10-16 dogfood 现场：「harness 里的 cli_run 的看不到命令是什么，
/// 只看到参数」。故先解析 JSON，用 [`tools::cli_argv`]（argv 从参数里取出的**单一真源**，
/// 与权限判定同一份）拼成人话摘要，再对**拼接后的整串**截断：命令永远落在可见头部。
///
/// 回落口径：解析不出 JSON、或不是 cli 形态（argv 为空）→ 原文截断。非 cli 工具的参数
/// schema 各有各的键（vault_* 的 path、skill_load 的 name……），这一层不猜关键参数，
/// 由前端 [`humanizeToolArgs`] 承担（前端拿不到完整 JSON 时同样原样上屏，两侧同构）。
pub(crate) fn summarize_args(arguments: &str) -> String {
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(arguments) {
        let argv = tools::cli_argv(&parsed);
        if !argv.is_empty() {
            return truncate_summary(&format_argv(&argv));
        }
    }
    truncate_summary(arguments)
}

/// 摘要按 [`SUMMARY_LIMIT`] 字符截断（超限补省略号）。
fn truncate_summary(text: &str) -> String {
    if text.chars().count() > SUMMARY_LIMIT {
        format!("{}…", text.chars().take(SUMMARY_LIMIT).collect::<String>())
    } else {
        text.to_string()
    }
}

/// argv → 单行展示串：含空白或引号的参数加双引号，内部的 `\` 与 `"` 转义（否则参数边界
/// 无从分辨——`sh -c echo a b` 与 `sh -c "echo a b"` 是两条命令）。
///
/// 与前端 `formatArgv`（src/harness-panel.ts）**同一形态**，这是刻意的跨层重复：新 core 的
/// 成品摘要（本函数）与旧快照的 JSON 摘要（前端 [`humanizeToolArgs`] 人话化）都上屏到同一个
/// 参数格，两条路径产出必须逐字一致——改这一处就要同时改 `src/harness-panel.ts` 的那处。
fn format_argv(argv: &[String]) -> String {
    argv.iter()
        .map(|arg| {
            if arg
                .chars()
                .any(|c| c.is_whitespace() || c == '"' || c == '\'')
            {
                format!("\"{}\"", arg.replace('\\', "\\\\").replace('"', "\\\""))
            } else {
                arg.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
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
                .take(SUMMARY_LIMIT)
                .collect::<String>()
        )
    }
}

/// 工具行摘要的字符上限（参数摘要 [`summarize_args`] 与终态摘要 [`summarize_result`] 的
/// message 各截一刀，同一个长度预算）。M459 起也是 deny 文案「带不带规则原文」的判据——
/// 同一个长度预算只能有一处声明（本常量）。
const SUMMARY_LIMIT: usize = 80;

/// deny 规则命中的回送文案（M459，change add-approval-decision-reason）：拼上命中的**规则原文**，
/// 让「是哪条规则拦的」不必回配置文件核对。
///
/// **规则原文放在最前**：工具行是**单行省略号**行（`.lumir-hp-tool-text` 的 `nowrap +
/// text-overflow: ellipsis`，CSS 注释明写「截断只落这一格」），拼在末尾时窄面板下整段规则名会被
/// 省略号吞掉——Alex 看到的世界与改造前一样（M459 实测：482px 宽的面板里末尾的规则名完全不可见）。
/// 领读位置保证「规则原文」落在可见头部，被省略的是它后面的从属信息。与 tower 裁决文里给的例句
/// 顺序（规则原文在句末）不同，属实现期口径修正，理由见 change 的评审记录。
///
/// 上限口径：工具行摘要按 [`SUMMARY_LIMIT`] 截断 message——拼接后超限就**退回**既有文案，
/// MUST NOT 呈现被截断的半截规则名（那比不说更坏，见 change design §4.3）。
fn denied_message(
    tool: &str,
    subject: &str,
    reason: Option<&permissions::DecisionReason>,
) -> String {
    let plain = format!("权限规则拒绝了 {tool}（{subject}）");
    let Some(permissions::DecisionReason::DenyRule { rule }) = reason else {
        return plain;
    };
    let detailed = format!("命中 deny 规则 {rule}：{plain}");
    if detailed.chars().count() <= SUMMARY_LIMIT {
        detailed
    } else {
        plain
    }
}

/// 可跨线程持有的作用域事件出口（与 [`super::events::ScopedSink`] 同一信封语义，但内部
/// 持有 `Arc<dyn EventSink>`）：子运行与自动唤醒回合在父回合结束后仍要发事件。
struct OwnedScopedSink {
    inner: std::sync::Arc<dyn EventSink>,
    vault: String,
}

impl EventSink for OwnedScopedSink {
    fn emit(&self, mut payload: serde_json::Value) {
        events::stamp_vault(&mut payload, &self.vault);
        self.inner.emit(payload);
    }
}

/// 自动唤醒回合（change add-harness-subagents design §12.6）：通知已由调度器写进父会话
/// 历史（input + panel），这里只起回合——因此用 `TurnInput::Preloaded`，不再入队 user 消息。
///
/// 返回 `false` = 父会话忙（用户恰好发了消息），调用方把这一批通知留到下一次机会；
/// 此时**不**推进链计数（计数由调用方在真正起回合时加）。
/// 已占用父会话后的自动回合本体（调度器在「插入通知」之前就 acquire，保证通知与回合
/// 之间不会插进一个用户回合）。**不在这里 acquire**：重复 acquire 会把自动回合变成
/// 「父会话忙」的失败路径。
pub(crate) fn run_auto_turn_acquired(
    runtime: Runtime,
    scope: VaultScope,
    config: HarnessConfig,
    sink: std::sync::Arc<dyn EventSink>,
    user_text: String,
) -> bool {
    let mock_start = runtime
        .with_session(&scope, |session| session.mock_cursor())
        .unwrap_or(0);
    let mut client = match llm::client_at(&config, &scope.vault_id, mock_start, None) {
        Ok(client) => client,
        Err(error) => {
            emit_terminal_on(
                &runtime,
                &scope,
                sink.as_ref(),
                events::error(&error.code, &error.message),
            );
            runtime.release_turn(&scope);
            return false;
        }
    };
    let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut ctx = SessionContext::new_with_owned_sink(
            sink.as_ref(),
            Some(sink.clone()),
            &runtime,
            &scope,
            &config,
        );
        run_turn_core_with_mode(
            &mut ctx,
            &config,
            TurnInput::Preloaded { user_text },
            client.as_mut(),
        );
    }))
    .is_err();
    if panicked {
        emit_terminal_on(
            &runtime,
            &scope,
            sink.as_ref(),
            events::error("harness_internal_error", "自动回合发生内部错误，本轮已终止"),
        );
    }
    if let Some(len) = client.mock_script_len() {
        // 与交互回合同一条游标算法（见 `run_turn` 同段注释）：`skip` 已记进 external_consumed，
        // MUST NOT 再叠加中枢的 reserved 计数。
        let next = llm::wrap_cursor(
            mock_start,
            client.mock_consumed() + client.external_consumed(),
            len,
        );
        let _ = runtime.with_session(&scope, |session| session.set_mock_cursor(next));
    }
    runtime.release_turn(&scope);
    true
}

/// AppHandle 事件发射（真机路径；payload 是 JSON 对象，m303 零改动接入）。
struct TauriEventSink(tauri::AppHandle);

impl EventSink for TauriEventSink {
    fn emit(&self, payload: serde_json::Value) {
        use tauri::Emitter;
        let _ = self.0.emit(events::EVENT_NAME, payload);
    }
}

/// 终态记录 sink（change add-cron-runtime-daemon §3.3 / §5.2）：把一轮的终态事件
/// （`done` / `error` / `aborted`）记进 runtime，供运行槽位的 `cron:run_finished` 回执取用。
///
/// `forward` 为 `None` = 无人值守运行槽：事件**不**发往面板（其 transcript 不属于用户当前
/// 会话）；为 `Some` 时照旧转发（交互槽位行为一字不变）。
struct TerminalSink {
    /// 弱引用（见 `run_turn` 构造点）：运行实例结束后终态无处可记，静默跳过即可
    /// （此时也没有回执消费者）。
    runtime: super::WeakRuntime,
    forward: Option<TauriEventSink>,
}

impl EventSink for TerminalSink {
    fn emit(&self, payload: serde_json::Value) {
        if let Some(runtime) = self.runtime.upgrade() {
            match payload["type"].as_str() {
                Some("done") => runtime.record_terminal(super::TurnTerminal {
                    ok: true,
                    error: None,
                }),
                Some("error") => runtime.record_terminal(super::TurnTerminal {
                    ok: false,
                    error: Some(payload["code"].as_str().unwrap_or("error").to_string()),
                }),
                Some("aborted") => runtime.record_terminal(super::TurnTerminal {
                    ok: false,
                    error: Some("aborted".to_string()),
                }),
                _ => {}
            }
        }
        if let Some(forward) = &self.forward {
            forward.emit(payload);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// 次级动作派生（change harness-permission-rules-oct23 tasks 3.7）：危险层两项皆 `None`，
    /// 模式层两项皆 `Some`，`vault_delete` 只有会话记忆。
    #[test]
    fn gated_actions_are_derived_from_the_reason_layer() {
        let cli = vec!["tvly".to_string(), "search".to_string(), "x".to_string()];
        // 危险层：两枚都不给（死按钮藏起来）。
        for reason in [
            permissions::DecisionReason::DangerousWrapper {
                command: "bash".into(),
            },
            permissions::DecisionReason::DangerousCommand,
        ] {
            assert_eq!(
                gated_actions("cli_run", Some(&cli), "tvly search x", Some(&reason)),
                None,
                "{reason:?}"
            );
        }
        // 模式层：粒度 + 规则都给。
        let actions = gated_actions(
            "cli_run",
            Some(&cli),
            "tvly search x",
            Some(&permissions::DecisionReason::ModeDefault {
                mode: crate::config::PermissionMode::VaultWrite,
            }),
        )
        .expect("模式层的卡必须有次级动作");
        assert_eq!(actions.remember_label, "tvly search");
        assert_eq!(actions.rule.as_deref(), Some("cli(tvly search *)"));
        // vault_delete：有会话记忆、无持久规则（Q7）。
        let actions = gated_actions(
            "vault_delete",
            None,
            "notes/a.md",
            Some(&permissions::DecisionReason::ModeDefault {
                mode: crate::config::PermissionMode::VaultWrite,
            }),
        )
        .expect("vault_delete 仍保留会话记忆");
        assert_eq!(actions.remember_key, "notes/a.md");
        assert_eq!(actions.rule, None);
    }

    /// 丢弃事件的 sink（本模块只关心入队后的会话状态）。
    struct NullSink;

    impl EventSink for NullSink {
        fn emit(&self, _payload: serde_json::Value) {}
    }

    /// 收集事件的 sink（live 事件载荷的断言数据源；照 `events.rs` 测试里的同名收集器）。
    #[derive(Default)]
    struct Collect(std::sync::Arc<std::sync::Mutex<Vec<serde_json::Value>>>);

    impl EventSink for Collect {
        fn emit(&self, payload: serde_json::Value) {
            self.0.lock().unwrap().push(payload);
        }
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
    /// 判据的区分度（REVIEW.md 「断言等价于子串」条）：`0` 占位、缺字段、写死常量、毫秒口径、跨天
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
        // JSONL 落点走 XDG_CONFIG_HOME（REVIEW.md 「测试污染真实环境」条：测试绝不写真实的 ~/.config/lumir）。
        // 先取进程级 XDG 锁、再改环境（drop 逆序：XDG 复原时仍持锁，见 `xdg_test_lock`）。
        let _xdg = crate::harness::xdg_test_lock();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));

        let vault = root.join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::write(vault.join("a.md"), "正文\n").unwrap();
        let scope = VaultScope {
            root: vault.clone(),
            policy: {
                let defaults = crate::config::VaultConfig::default();
                IgnorePolicy::load(&vault, &[".gitignore".to_string()], &defaults.ignore)
            },
            vault_id: "vault-test-1".to_string(),
        };
        let config = crate::config::test_mock(Some("/tmp/fixture.json"));

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

    /// M534 回归：live 路径（真 turn 循环发出的 `usage` 事件）与 `harness_state` 快照携带
    /// **同一组读数键与同一个值**——含 M526 的绝对值键。
    ///
    /// 区分度（REVIEW.md 「断言等价于子串」条）：修前 `events::usage` 手列七个键（`type` + M443 的六个），
    /// 绝对值键整体缺席；前端 `usageReadings` 读不到 `input_tokens` / `context_window`，live
    /// 会话的 tokens 气泡按 D395 回落百分比形态（M534 现场：同一会话切 vault 回来走快照路径
    /// 却显示「已用 65.5k / 131k tokens」）。把 `events::usage` 换回手列清单时本用例即红。
    #[test]
    fn live_usage_event_carries_snapshot_readings() {
        let root = std::env::temp_dir().join(format!("lumir-harness-usage-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        // JSONL 落点走 XDG_CONFIG_HOME（REVIEW.md 「测试污染真实环境」条：测试绝不写真实的 ~/.config/lumir）。
        // 先取进程级 XDG 锁、再改环境（drop 逆序：XDG 复原时仍持锁，见 `xdg_test_lock`）。
        let _xdg = crate::harness::xdg_test_lock();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));

        let vault = root.join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::write(vault.join("a.md"), "正文\n").unwrap();
        let scope = VaultScope {
            root: vault.clone(),
            policy: {
                let defaults = crate::config::VaultConfig::default();
                IgnorePolicy::load(&vault, &[".gitignore".to_string()], &defaults.ignore)
            },
            vault_id: "vault-test-1".to_string(),
        };
        let config = crate::config::test_mock(Some("/tmp/fixture.json"));

        let runtime = Runtime::default();
        runtime.acquire_turn(&scope, &config).unwrap();
        let sink = Collect::default();
        let seen = sink.0.clone();
        // usage 不是整千数：取整 / 换序 / 读错键都会露馅（判定值与本轮 mock 回包逐字对应）。
        let script = r#"{"responses": [
            {"text": "读完了。",
             "usage": {"input_tokens": 1399, "cached_tokens": 1000, "output_tokens": 25}}
        ]}"#;
        let mut client = llm::MockClient::from_str(script, "live-usage").unwrap();
        run_turn_for(
            &sink,
            &runtime,
            &scope,
            &config,
            "这段讲了什么".to_string(),
            None,
            &mut client,
        );
        runtime.release_turn(&scope);

        // 事件取自 live 路径（turn 循环 emit 的那一条），不是直接调 `events::usage`。
        let events = seen.lock().unwrap();
        let event = events
            .iter()
            .rfind(|e| e.get("type").and_then(|t| t.as_str()) == Some("usage"))
            .expect("live 会话应发出 usage 事件");
        // 快照路径：面板重载 / 切 vault 回来重渲染读的就是这份 JSON。
        let snapshot = runtime.snapshot(&scope, &config);
        let snapshot_json = serde_json::to_value(snapshot.usage).unwrap();

        // ① 绝对值键在事件里在场、且是本次往返的真读数（缺键即 M534 现场：气泡回落百分比形态）。
        assert_eq!(event["input_tokens"], serde_json::json!(1399), "{event}");
        assert_eq!(event["cached_tokens"], serde_json::json!(1000), "{event}");
        assert_eq!(
            event["cached_tokens_session"],
            serde_json::json!(1000),
            "{event}"
        );
        assert_eq!(
            event["context_window"],
            serde_json::json!(crate::config::FALLBACK_CONTEXT_WINDOW),
            "{event}"
        );
        assert_eq!(event["has_usage"], serde_json::json!(true), "{event}");

        // ② 同键同值：事件读数键集合 = 快照键集合 + 判别键 `type`（事件/快照一致性不变量）。
        let readings = event.as_object().unwrap();
        let expected = snapshot_json.as_object().unwrap();
        assert_eq!(readings.len(), expected.len() + 1, "键集合不等：{event}");
        for (key, value) in expected {
            assert_eq!(
                readings.get(key),
                Some(value),
                "事件与快照不一致（缺键或异值）：{key}：{event}"
            );
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
        // 区分度自证（REVIEW.md 「断言等价于子串」条）：旧实现按 `split("\n\n[")` 从拼好的串重解析，
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
        // 断言在没有节时恒真（REVIEW.md 「断言等价于子串」条）。
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
        // 区分度（REVIEW.md 「断言等价于子串」条）：旧实现在无 text 时落「（无文本）」占位——本断言挡它。
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
        // JSONL 落点走 XDG_CONFIG_HOME（REVIEW.md 「测试污染真实环境」条：不写真实 ~/.config/lumir）。
        // 先取进程级 XDG 锁、再改环境（drop 逆序：XDG 复原时仍持锁，见 `xdg_test_lock`）。
        let _xdg = crate::harness::xdg_test_lock();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));

        let vault = root.join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::write(vault.join("a.md"), "正文\n").unwrap();
        let scope = VaultScope {
            root: vault.clone(),
            policy: {
                let defaults = crate::config::VaultConfig::default();
                IgnorePolicy::load(&vault, &[".gitignore".to_string()], &defaults.ignore)
            },
            vault_id: "vault-test-1".to_string(),
        };
        let config = crate::config::test_mock(Some("/tmp/fixture.json"));

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
        // 本条对那条空正文项必 FAIL（区分度自证，REVIEW.md 「断言等价于子串」条）。
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

    // -----------------------------------------------------------------------
    // deny 回送文案（M459，change add-approval-decision-reason）
    // -----------------------------------------------------------------------

    /// 规则原文**领读**（design §4.3）：工具行是单行省略号行，句末的规则名会被整段吞掉——
    /// 领读位置保证「是哪条规则拦的」落在可见头部。
    #[test]
    fn denied_message_leads_with_the_rule() {
        let reason = permissions::DecisionReason::DenyRule {
            rule: "cli(npm run deploy*)".into(),
        };
        assert_eq!(
            denied_message("cli_run", "npm run deploy", Some(&reason)),
            "命中 deny 规则 cli(npm run deploy*)：权限规则拒绝了 cli_run（npm run deploy）"
        );
    }

    /// 无规则原文（`None` / 非 `DenyRule` 的依据）：退回既有文案，不凭空多一句「命中」。
    #[test]
    fn denied_message_without_a_rule_keeps_the_plain_text() {
        assert_eq!(
            denied_message("vault_patch", "a.md", None),
            "权限规则拒绝了 vault_patch（a.md）"
        );
        assert_eq!(
            denied_message(
                "cli_run",
                "rm -rf /tmp/x",
                Some(&permissions::DecisionReason::DangerousCommand)
            ),
            "权限规则拒绝了 cli_run（rm -rf /tmp/x）"
        );
    }

    /// 超限退回（REVIEW.md 「覆盖声明超出真实验证」条：覆盖声明要与真实验证一致）：拼接后超过工具行摘要的字符预算即
    /// 退回 plain，MUST NOT 呈现被截断的半截规则名。边界两侧都判——恰好等于上限仍带规则原文，
    /// 多一个字符即退回。
    #[test]
    fn denied_message_falls_back_when_over_the_summary_limit() {
        let reason = permissions::DecisionReason::DenyRule {
            rule: "cli(x*)".into(),
        };
        // 骨架（subject 留空）＝「命中 deny 规则 cli(x*)：权限规则拒绝了 cli_run（）」。
        let skeleton = "命中 deny 规则 cli(x*)：权限规则拒绝了 cli_run（）";
        let subject = "s".repeat(SUMMARY_LIMIT - skeleton.chars().count());
        let detailed = format!("命中 deny 规则 cli(x*)：权限规则拒绝了 cli_run（{subject}）");
        assert_eq!(detailed.chars().count(), SUMMARY_LIMIT);
        assert_eq!(
            denied_message("cli_run", &subject, Some(&reason)),
            detailed,
            "恰好等于上限时仍带规则原文（判据是 <=）"
        );
        // 再长一个字符即超限 ⇒ 退回 plain。
        let subject = format!("{subject}s");
        assert_eq!(
            denied_message("cli_run", &subject, Some(&reason)),
            format!("权限规则拒绝了 cli_run（{subject}）"),
            "超限退回既有文案"
        );
    }

    /// M528：参数摘要的命令本体恒在最前（Alex 2026-10-16 dogfood：「cli_run 的看不到命令
    /// 是什么，只看到参数」）。四条判据覆盖三种形态 + 与权限判定共用 argv 真源：
    ///   ① `command` 排在 `args` 之后（模型现写的键序，真触发条件）：摘要仍以命令领读；
    ///   ② 拼出的整串超限：截断落在**拼接后**的串上，命令在头部故一定活下来；
    ///   ③ 非法 JSON：回落原文截断（不伪造人话摘要）；
    ///   ④ 非 cli 形态（无 `command`）：同样回落原文（vault_* 的键这一层不猜）。
    #[test]
    fn summarize_args_leads_with_the_command_and_falls_back_to_raw_text() {
        // ① 键序 args 在前——原实现按 80 字截断时命令正好被切掉。
        assert_eq!(
            summarize_args(
                r#"{"args":["--flag","value","--another","more"],"command":"kubectl","purpose":"列举"}"#
            ),
            "kubectl --flag value --another more",
            "命令必须在最前（键序不影响领读位置）"
        );
        // 顺序变了、内容不变 ⇒ 摘要逐字不变（键序无关性是①的更强形态）。
        assert_eq!(
            summarize_args(r#"{"command":"kubectl","args":["--flag","value","--another","more"]}"#),
            "kubectl --flag value --another more"
        );
        // 含空白 / 引号的参数加引号并与前端 formatArgv 同形态（否则参数边界无从分辨）。
        assert_eq!(
            summarize_args(r#"{"command":"sh","args":["-c","echo a b","q\"x"]}"#),
            r#"sh -c "echo a b" "q\"x""#
        );
        // 场景 75（`scripts/acceptance/scenarios/75-harness-permissions.md`）的断言钉在这里：
        // 它期望工具行文本匹配 `/cli_run\s*echo HNE-ALLOWED/`，命令本体必须逐字领读。
        assert_eq!(
            summarize_args(
                r#"{"command":"echo","args":["HNE-ALLOWED"],"purpose":"回显一个验收标记"}"#
            ),
            "echo HNE-ALLOWED"
        );
        // 无 args（只有命令）：摘要就是命令本体，不是空串。
        assert_eq!(summarize_args(r#"{"command":"pwd"}"#), "pwd");

        // ② 超限：命令领读且完整，截断的是它后面的参数。
        let many_args = (0..40).map(|i| format!("--flag-{i}")).collect::<Vec<_>>();
        let long = serde_json::json!({ "args": many_args, "command": "rg" }).to_string();
        let summary = summarize_args(&long);
        assert!(
            summary.starts_with("rg --flag-0"),
            "截断后命令仍领读：{summary}"
        );
        assert_eq!(summary.chars().count(), SUMMARY_LIMIT + 1, "80 字 + 省略号");
        assert!(summary.ends_with('…'));
        // 判据的区分度：按**原文**截断时，这串 80 字前缀里只有 args（`command` 被切掉）。
        assert!(
            !summary.starts_with(r#"{"args":["--flag-0""#),
            "摘要 MUST NOT 退回原文截断（那正是现场看到的「只有参数、没有命令」）"
        );

        // ③ 非法 JSON：回落原文截断。
        let broken = format!(r#"{{"path":"{}"#, "a".repeat(120));
        let summary = summarize_args(&broken);
        assert!(summary.starts_with(r#"{"path":"aaaa"#));
        assert_eq!(summary.chars().count(), SUMMARY_LIMIT + 1);
        assert!(summary.ends_with('…'));

        // ④ 非 cli 形态（合法 JSON、无 command 键）：不猜关键参数，原文截断（与既有恢复
        //    路径的 `restored_tool_summary_reuses_summarize_args` 同口径）。
        let path_only = format!(r#"{{"path":"{}"}}"#, "a".repeat(200));
        assert_eq!(summarize_args(&path_only), truncate_summary(&path_only));
        assert!(summarize_args(&path_only).ends_with('…'));
        assert_eq!(summarize_args(r#"{"path":"a.md"}"#), r#"{"path":"a.md"}"#);
    }

    /// M463：`llm_error` 记录的载荷——HTTP 面三件按在场与否追加；没有 HTTP 面的错误
    /// （网络层 / 脚本化 / 流内）只落 code+message，新键缺席（不是空值）。
    #[test]
    fn llm_error_payload_carries_wire_fields_only_when_present() {
        let bare = llm::TurnError::new("harness_network_failed", "连不上", false);
        let payload = llm_error_payload(&bare);
        assert_eq!(payload["kind"], serde_json::json!("llm_error"));
        assert_eq!(payload["code"], serde_json::json!("harness_network_failed"));
        assert_eq!(payload["message"], serde_json::json!("连不上"));
        for key in ["http_status", "raw_body", "request_id", "body_truncated"] {
            assert!(payload.get(key).is_none(), "无 HTTP 面时不该出现 {key}");
        }

        let http = llm::TurnError {
            code: "harness_http_error".into(),
            message: "Your request exceeded k3-256k model token limit: 262144".into(),
            context_overflow: true,
            http_status: Some(400),
            raw_body: Some(r#"{"error":{"message":"…"}}"#.into()),
            body_truncated: false,
            request_id: Some("req-9".into()),
        };
        let payload = llm_error_payload(&http);
        assert_eq!(payload["http_status"], serde_json::json!(400));
        assert_eq!(payload["request_id"], serde_json::json!("req-9"));
        assert!(payload["raw_body"].is_string());
        // 未截断时不留 body_truncated 键（缺席 = 未截断）。
        assert!(payload.get("body_truncated").is_none());
    }

    /// `reasoning_encrypted.received` 的事实判定：只认「键在场且值为非空字符串」，
    /// 空串 / 非字符串 / 嵌套缺席一律 false；嵌套层在场也算收到（方言变体不分支）。
    #[test]
    fn reasoning_encrypted_content_detection() {
        let kimi_with = serde_json::json!({
            "type": "reasoning",
            "summary": [{"type": "summary_text", "text": "…"}],
            "encrypted_content": "enc-abc",
        });
        assert!(reasoning_has_encrypted_content(&kimi_with));

        let kimi_without = serde_json::json!({
            "type": "reasoning",
            "summary": [{"type": "summary_text", "text": "…"}],
        });
        assert!(!reasoning_has_encrypted_content(&kimi_without));

        // 空串不算收到（键在场但无密文可还）。
        let empty = serde_json::json!({"type": "reasoning", "encrypted_content": ""});
        assert!(!reasoning_has_encrypted_content(&empty));

        // 嵌套层在场也算（将来方言变体落嵌套不漏判）。
        let nested = serde_json::json!({
            "type": "reasoning",
            "content": [{"encrypted_content": "enc-deep"}],
        });
        assert!(reasoning_has_encrypted_content(&nested));
    }

    /// 无人值守槽 + ask 档调用 + **预览失败**：master 的顺序是在生成预览**之前**按槽位短路
    /// （`stop_with("approval_required")` 中止），预览错误不得回送模型续跑。
    ///
    /// 这是 M586 回抽必须保住的既有语义：cron（M583/M584）是已合并的消费者，预览失败时
    /// 「中止运行」与「让模型纠错续跑」是两种不同的错误口径，换口径须另立 change 显式裁决。
    ///
    /// 区分度（REVIEW.md「断言等价于子串」条）：断言 ① 终态是 `approval_required` 错误而不是
    /// `done`；② mock 脚本只被弹了第一条（旧顺序下预览错误回送模型，循环会继续弹第二条并正常
    /// 收尾）。恢复「预览前短路」之前本用例两条断言都红（已实测）。
    #[test]
    fn isolated_ask_call_with_failed_preview_still_aborts_the_run() {
        let root =
            std::env::temp_dir().join(format!("lumir-harness-isolated-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        // JSONL 落点走 XDG_CONFIG_HOME（REVIEW.md「测试污染真实环境」条：不写真实 ~/.config/lumir）。
        // 先取进程级 XDG 锁、再改环境（drop 逆序：XDG 复原时仍持锁）。
        let _xdg = crate::harness::xdg_test_lock();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));

        let vault = root.join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        let scope = VaultScope {
            root: vault.clone(),
            policy: {
                let defaults = crate::config::VaultConfig::default();
                IgnorePolicy::load(&vault, &[".gitignore".to_string()], &defaults.ignore)
            },
            vault_id: "vault-test-1".to_string(),
        };
        let config = HarnessConfig {
            // 只读档：vault_patch 进 Ask 档（默认 vault_write 会直接放行写工具，到不了批准闸）。
            permission_mode: crate::config::PermissionMode::ReadOnly,
            ..crate::config::test_mock(Some("/tmp/fixture.json"))
        };

        // 无人值守槽（cron）：ask 档调用 + 预览失败（目标文件不存在 ⇒ fs_not_found）。
        let runtime = Runtime::isolated();
        assert!(runtime.is_isolated(), "测试前提：无人值守运行时实例");
        runtime.acquire_turn(&scope, &config).unwrap();
        let sink = Collect::default();
        let seen = sink.0.clone();
        let script = r#"{"responses": [
            {"text": "先改文件。",
             "tool_calls": [{"id": "c1", "name": "vault_patch",
               "arguments": "{\"path\":\"missing.md\",\"edits\":[{\"old_string\":\"a\",\"new_string\":\"b\"}]}"}]},
            {"text": "预览错误后继续。"}
        ]}"#;
        let mut client = llm::MockClient::from_str(script, "isolated-approval").unwrap();
        run_turn_for(
            &sink,
            &runtime,
            &scope,
            &config,
            "改一下".to_string(),
            None,
            &mut client,
        );
        runtime.release_turn(&scope);

        let events = seen.lock().unwrap();
        // ① 终态：approval_required 错误，不是 done。
        assert!(
            events.iter().all(|event| event["type"] != "done"),
            "无人值守的批准闸中止不得以 done 收尾：{events:?}"
        );
        let error = events
            .iter()
            .rfind(|event| event["type"] == "error")
            .expect("应有错误终态");
        assert_eq!(error["code"], "approval_required", "{error}");
        // ② 预览失败不得回送模型续跑：脚本只弹了第一条。
        assert_eq!(
            client.mock_consumed(),
            1,
            "无人值守必须在预览之前短路，不应再发下一次请求"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 同回合并行编排的回填顺序（tasks §1.7）：第二个调用**先完成**，回填仍是 0,1。
    ///
    /// 区分度（REVIEW.md「断言等价于子串」条）：句柄在线程里各自完成并记录完成顺序；
    /// 断言同时钉住「完成顺序 = [1, 0]」（证明本输入确实让第二个先完成）与「回填 = [0 的结果,
    /// 1 的结果]」（证明顺序由调用序号决定，而不是完成先后）。若把 `BTreeMap` 换成按完成
    /// 顺序 push 的 `Vec`，第二条断言必 FAIL。
    #[test]
    fn parallel_orchestration_backfills_in_call_order() {
        struct ThreadedCall {
            handle: std::thread::JoinHandle<(serde_json::Value, serde_json::Value)>,
        }

        impl OrchestrationCall for ThreadedCall {
            fn join(self: Box<Self>) -> (serde_json::Value, serde_json::Value) {
                self.handle.join().expect("编排线程不得 panic")
            }
        }

        let completion = std::sync::Arc::new(std::sync::Mutex::new(Vec::<usize>::new()));
        let start = |index: usize, delay_ms: u64| -> (usize, Box<dyn OrchestrationCall>) {
            let completion = completion.clone();
            let handle = std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                completion.lock().unwrap().push(index);
                (
                    serde_json::json!({"type": "function_call", "call_index": index}),
                    serde_json::json!({"type": "function_call_output", "call_index": index}),
                )
            });
            (
                index,
                Box::new(ThreadedCall { handle }) as Box<dyn OrchestrationCall>,
            )
        };

        // 调用 1 的延迟更短 ⇒ 它先完成；两个句柄在 join 之前都已启动。
        let handles = vec![start(0, 80), start(1, 10)];
        let mut results = BTreeMap::new();
        join_in_call_order(&mut results, handles);

        assert_eq!(
            *completion.lock().unwrap(),
            vec![1, 0],
            "本用例的前提是第二个调用先完成"
        );
        let ordered: Vec<_> = results.into_values().collect();
        assert_eq!(ordered.len(), 2);
        assert_eq!(ordered[0].1["call_index"], serde_json::json!(0));
        assert_eq!(ordered[1].1["call_index"], serde_json::json!(1));
    }

    // ── 终态窗口：三态轮次状态机的第一类回归（change add-harness-activity-presence
    // tasks 1.4 / 1.5）────────────────────────────────────────────────────────────
    //
    // 判据是**「终态已发、尚未释放」这一刻**的两个读口：协议读 `is_busy()` 仍为真（在途
    // 拒绝语义不变），呈现读 `in_flight()` 已为假（面板就地收口）。`PhaseProbe` 在事件发射
    // 的**当场**读会话状态，因此不需要定时等待，也不受 `release_turn` 时机影响。
    //
    // 覆盖边界（不是漏项）：交互回合的**配置级 error**（`run_turn` 的 `llm::client_at` 失败）
    // 与**两条 panic 收口**（交互 `run_turn` / 自动回合 `run_auto_turn_acquired`）在现有测试面
    // 上不可驱动——前者要 `tauri::AppHandle`，后者要给生产入口注入一个会 panic 的 `LlmClient`
    // （那等于为测试在生产代码开缝）。这三处与已驱动路径共用**同一对发射入口**
    // （`emit_terminal_on` / `emit_terminal`），因此由「自动回合配置级 error 走真实入口」＋
    // `terminal_emit_helper_marks_finishing`（同一入口的行为用例）＋
    // `terminal_events_only_go_through_helpers`（源码断言，tasks 1.5）三者拼成覆盖。

    /// 事件发射当场读会话两个读口的探针（判据不需要等待、与 release 时机无关）。
    struct PhaseProbe {
        runtime: Runtime,
        scope: VaultScope,
        seen: std::sync::Mutex<Vec<(String, bool, bool)>>,
    }

    impl PhaseProbe {
        fn new(runtime: &Runtime, scope: &VaultScope) -> Self {
            Self {
                runtime: runtime.clone(),
                scope: scope.clone(),
                seen: std::sync::Mutex::new(Vec::new()),
            }
        }

        /// 本 sink 观察到的终态读数（事件种类 + `is_busy` + `in_flight`）。
        fn terminals(&self) -> Vec<(String, bool, bool)> {
            self.seen.lock().unwrap().clone()
        }
    }

    impl EventSink for PhaseProbe {
        fn emit(&self, payload: serde_json::Value) {
            let kind = payload["type"].as_str().unwrap_or("?");
            if !matches!(kind, "done" | "error" | "aborted") {
                return;
            }
            let (busy, in_flight) = self
                .runtime
                .with_session(&self.scope, |session| {
                    (session.is_busy(), session.in_flight())
                })
                .expect("终态发射时会话仍在（释放发生在之后）");
            self.seen
                .lock()
                .unwrap()
                .push((kind.to_string(), busy, in_flight));
        }
    }

    /// 临时 vault + 独立 XDG 的测试台（与上方 M353 用例同一条纪律：绝不写真实 `~/.config`）。
    struct TurnBench {
        root: std::path::PathBuf,
        scope: VaultScope,
        config: crate::config::HarnessConfig,
        runtime: Runtime,
        prev_xdg: Option<std::ffi::OsString>,
        _lock: std::sync::MutexGuard<'static, ()>,
    }

    impl TurnBench {
        /// `fixture` 写进临时目录；`None` = 不给 mock 指 fixture（配置级失败路径）。
        fn new(tag: &str, fixture: Option<&str>) -> Self {
            let lock = crate::harness::xdg_test_lock();
            let root = std::env::temp_dir().join(format!(
                "lumir-activity-{tag}-{}-{:016x}",
                std::process::id(),
                rand::random::<u64>()
            ));
            let _ = std::fs::remove_dir_all(&root);
            let vault = root.join("vault");
            std::fs::create_dir_all(&vault).unwrap();
            let prev_xdg = std::env::var_os("XDG_CONFIG_HOME");
            std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
            let scope = VaultScope {
                root: vault.clone(),
                policy: {
                    let defaults = crate::config::VaultConfig::default();
                    IgnorePolicy::load(&vault, &[".gitignore".to_string()], &defaults.ignore)
                },
                vault_id: format!("vault-activity-{tag}"),
            };
            let config = match fixture {
                Some(script) => {
                    let path = root.join("fixture.json");
                    std::fs::write(&path, script).unwrap();
                    crate::config::test_mock(Some(path.to_str().unwrap()))
                }
                None => crate::config::test_mock(Some("/tmp/lumir-activity-absent.json")),
            };
            Self {
                root,
                scope,
                config,
                runtime: Runtime::default(),
                prev_xdg,
                _lock: lock,
            }
        }
    }

    impl Drop for TurnBench {
        fn drop(&mut self) {
            match &self.prev_xdg {
                Some(value) => std::env::set_var("XDG_CONFIG_HOME", value),
                None => std::env::remove_var("XDG_CONFIG_HOME"),
            }
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    /// 断言探针只看到一个终态，且那一刻是 `Finishing`：协议读仍为真、呈现读已为假。
    fn assert_single_finishing_terminal(probe: &PhaseProbe, kind: &str) {
        let seen = probe.terminals();
        assert_eq!(
            seen.iter()
                .map(|(kind, ..)| kind.as_str())
                .collect::<Vec<_>>(),
            vec![kind],
            "本轮应恰好发一条 {kind} 终态"
        );
        let (_, busy, in_flight) = seen[0].clone();
        assert!(
            busy,
            "{kind} 发射当场协议读必须仍为占用（在途拒绝语义不变）"
        );
        assert!(
            !in_flight,
            "{kind} 发射当场呈现读必须已是「不在途」——这正是「终态已发、尚未释放」窗口"
        );
    }

    /// 普通回合正常 `done`：终态当场的窗口 + 释放前后的两个读口。
    #[test]
    fn terminal_window_normal_done() {
        let bench = TurnBench::new("done", Some(r#"{"responses": [{"text": "好了。"}]}"#));
        let probe = PhaseProbe::new(&bench.runtime, &bench.scope);
        bench
            .runtime
            .acquire_turn(&bench.scope, &bench.config)
            .unwrap();
        assert!(
            bench
                .runtime
                .with_session(&bench.scope, |s| (s.is_busy(), s.in_flight()))
                .unwrap()
                == (true, true),
            "acquire 后必须是在途"
        );
        let mut client =
            llm::MockClient::from_str(r#"{"responses": [{"text": "好了。"}]}"#, "activity-done")
                .unwrap();
        run_turn_for(
            &probe,
            &bench.runtime,
            &bench.scope,
            &bench.config,
            "问".to_string(),
            None,
            &mut client,
        );
        assert_single_finishing_terminal(&probe, "done");
        // 尚未 release：协议读仍占用、呈现读已不在途，快照与面板看到的一致。
        assert!(bench
            .runtime
            .with_session(&bench.scope, |s| s.is_busy())
            .unwrap());
        assert!(
            !bench
                .runtime
                .snapshot(&bench.scope, &bench.config)
                .in_flight
        );
        bench.runtime.release_turn(&bench.scope);
        assert!(!bench
            .runtime
            .with_session(&bench.scope, |s| s.is_busy())
            .unwrap());
        // 新轮：Finishing → Idle → Running 之后呈现读回到真（三态不是单向的闸门）。
        bench
            .runtime
            .acquire_turn(&bench.scope, &bench.config)
            .unwrap();
        assert!(
            bench
                .runtime
                .snapshot(&bench.scope, &bench.config)
                .in_flight
        );
    }

    /// 空响应：错误终态同样经同一出口（`harness_empty_response`）。
    #[test]
    fn terminal_window_empty_response() {
        let script = r#"{"responses": [{}]}"#;
        let bench = TurnBench::new("empty", Some(script));
        let probe = PhaseProbe::new(&bench.runtime, &bench.scope);
        bench
            .runtime
            .acquire_turn(&bench.scope, &bench.config)
            .unwrap();
        let mut client = llm::MockClient::from_str(script, "activity-empty").unwrap();
        run_turn_for(
            &probe,
            &bench.runtime,
            &bench.scope,
            &bench.config,
            "问".to_string(),
            None,
            &mut client,
        );
        assert_single_finishing_terminal(&probe, "error");
    }

    /// LLM 错误：错误终态同样经同一出口。
    #[test]
    fn terminal_window_llm_error() {
        let script =
            r#"{"responses": [{"error": {"code": "llm_upstream", "message": "上游炸了"}}]}"#;
        let bench = TurnBench::new("llm-error", Some(script));
        let probe = PhaseProbe::new(&bench.runtime, &bench.scope);
        bench
            .runtime
            .acquire_turn(&bench.scope, &bench.config)
            .unwrap();
        let mut client = llm::MockClient::from_str(script, "activity-llm-error").unwrap();
        run_turn_for(
            &probe,
            &bench.runtime,
            &bench.scope,
            &bench.config,
            "问".to_string(),
            None,
            &mut client,
        );
        assert_single_finishing_terminal(&probe, "error");
    }

    /// 用户停止：`aborted` 终态（`abort_turn` 的两个分支里无程序性原因的那一支）。
    #[test]
    fn terminal_window_aborted() {
        let script = r#"{"responses": [{"text": "写到一半。"}]}"#;
        let bench = TurnBench::new("aborted", Some(script));
        let probe = PhaseProbe::new(&bench.runtime, &bench.scope);
        bench
            .runtime
            .acquire_turn(&bench.scope, &bench.config)
            .unwrap();
        // acquire 会清中断标志（新一轮不继承上一轮的停止请求），因此停止请求打在 acquire 之后。
        bench
            .runtime
            .with_session(&bench.scope, |s| s.request_abort())
            .unwrap();
        let mut client = llm::MockClient::from_str(script, "activity-aborted").unwrap();
        run_turn_for(
            &probe,
            &bench.runtime,
            &bench.scope,
            &bench.config,
            "问".to_string(),
            None,
            &mut client,
        );
        assert_single_finishing_terminal(&probe, "aborted");
    }

    /// 自动唤醒回合的**配置级失败**：走真实入口 `run_auto_turn_acquired`（r3 现场：静态清单
    /// 声称覆盖全部，实际漏了自动回合的两条路径）。
    ///
    /// 这里 `client_at` 会失败（mock provider 的 fixture 路径不存在），因此不进 `run_turn_core`
    /// ——这正是 `turn.rs:1692` 那条发射语句的现场：面板已在 `auto_turn_started` 置 running，
    /// 而 `:1729` 才释放，窗口与普通回合同形。
    #[test]
    fn terminal_window_auto_turn_config_error() {
        let bench = TurnBench::new("auto-config", None);
        bench
            .runtime
            .acquire_turn(&bench.scope, &bench.config)
            .unwrap();
        // 探针既是本回合的事件出口，又负责在发射当场读会话状态。
        let probe_arc = std::sync::Arc::new(PhaseProbe::new(&bench.runtime, &bench.scope));
        let ok = run_auto_turn_acquired(
            bench.runtime.clone(),
            bench.scope.clone(),
            bench.config.clone(),
            probe_arc.clone(),
            "通知文本".to_string(),
        );
        assert!(!ok, "配置级失败返回 false");
        let seen = probe_arc.terminals();
        assert_eq!(
            seen.iter()
                .map(|(kind, ..)| kind.as_str())
                .collect::<Vec<_>>(),
            vec!["error"],
            "自动回合的配置级失败也要发错误终态"
        );
        assert!(seen[0].1, "窗口内协议读仍为占用");
        assert!(!seen[0].2, "窗口内呈现读必须已不在途（不该停在处理中）");
    }

    /// 同一对发射入口的行为用例（补上不可驱动的三条 panic / 配置级路径的语义覆盖）：
    /// `emit_terminal_on` 先置 `Finishing` 再发事件，因此探针读到的是「不在途 + 仍占用」。
    /// `emit_terminal`（上下文形态）由上面四条真实回合路径覆盖。
    #[test]
    fn terminal_emit_helper_marks_finishing() {
        let bench = TurnBench::new("helper", None);
        let probe = PhaseProbe::new(&bench.runtime, &bench.scope);
        bench
            .runtime
            .acquire_turn(&bench.scope, &bench.config)
            .unwrap();
        emit_terminal_on(
            &bench.runtime,
            &bench.scope,
            &probe,
            events::error("harness_internal_error", "模拟 panic 收口"),
        );
        assert_single_finishing_terminal(&probe, "error");
    }

    /// 源码级静态兜底（tasks 1.5）：`turn.rs` 里的终态事件**只**经两个 helper 发出——别处出现
    /// 裸 `emit(events::done()/error(/aborted()` 即红。
    ///
    /// **只作静态兜底，不能替代上面的逐路径行为用例**（r3 现场：清单声称完整、实际漏掉两条
    /// 自动回合路径，静态断言抓不到漏项——它只抓「绕过 helper」这一种写法）。
    #[test]
    fn terminal_events_only_go_through_helpers() {
        let source = include_str!("turn.rs");
        // 判据是**裸发射的调用形态** `.emit(events::<终态>(`：本用例里的字符串字面量不含前导点，
        // 因此不会被自己的夹具命中（REVIEW.md「断言等价于子串」条：先确认判据有区分度）。
        for (line_no, line) in source.lines().enumerate() {
            let raw = line.find(".emit(events::").is_some()
                && ["events::done(", "events::aborted(", "events::error("]
                    .iter()
                    .any(|kind| line.contains(kind));
            if !raw {
                continue;
            }
            assert!(
                line.contains("emit_terminal"),
                "终态事件必须经 emit_terminal / emit_terminal_on 发出，第 {} 行是裸发射：{line}",
                line_no + 1
            );
        }
        // 发射点总数（F15 的 10 个位点 / 11 条语句）：上面的循环只抓「绕过 helper」，抓不到
        // 「整条语句被误删」，因此把两类调用的条数分别钉住——交互回合 7 条走
        // `emit_terminal`，配置级 / panic / 自动回合 4 条走 `emit_terminal_on`。
        fn calls_of(source: &str, name: &str) -> usize {
            let needle = format!("{name}(");
            source
                .lines()
                .filter(|line| !line.trim_start().starts_with("//") && !line.contains("fn "))
                .map(|line| line.matches(&needle).count())
                .sum()
        }
        // 只数生产代码：本测试模块里也有一次 helper 调用（不得算进发射点口径）。
        let production = source
            .split("\n#[cfg(test)]\nmod tests {")
            .next()
            .unwrap_or(source);
        assert_eq!(
            calls_of(production, "emit_terminal"),
            7,
            "交互回合的终态发射语句数变了（预期 7：入队失败 / 压缩重试 / LLM / 空响应 / done / 中止两条）"
        );
        assert_eq!(
            calls_of(production, "emit_terminal_on"),
            4,
            "无上下文的终态发射语句数变了（预期 4：交互的配置级与 panic、自动回合的配置级与 panic）"
        );
    }
}
