//! `harness:event` 事件载荷（tower 钉死、与 m303 面板共用的九类契约）。
//!
//! 事件名固定 `harness:event`；payload 是 JSON **对象**（m303 宽容解析：若是 string 会
//! JSON.parse 一次——直接发对象即零改动接入）。十类 type：
//! text_chunk / tool_call / approval_request / usage / compact / done / error / aborted /
//! reasoning_chunk / title
//!（aborted 为 M348 新增的第八类——本轮被用户停止；reasoning_chunk 为 M362 新增的第九类——
//! 思考文本分片，见 [`reasoning_chunk`]；title 为 change add-session-auto-naming 新增的第十类
//! ——会话标题即时更新，见 [`title`]；既有九类的形状与语义一律未动）。
//!
//! 九类载荷之上有**一个公共信封字段**：`vault` = 发送该事件的会话所属 vault 的根路径
//!（M312，[`stamp_vault`] / [`ScopedSink`]）。前端据此只渲染**当前 vault** 的会话——
//! 切换 vault 之后仍在途的旧 vault 事件（工具循环跑在专线程上，切换不打断它）因此被丢弃，
//! 不会串进新 vault 的面板。它是「会话标识」本身：`Runtime` 的 sessions 映射以 vault 根路径
//! 为键（内存态一个 vault 一个活跃会话），故 vault 标识即该活跃会话的标识，不另发一个同值的
//! `session` 字段（那会是「声明了却没有独立消费者」的死字段，REVIEW.md 「声明了却没有消费者」条）。
//!
//! 载荷之上，本模块持有输出侧的两个 trait：[`EventSink`]（事件发射通道）与 [`StreamSink`]
//!（M369 的流式增量转发口——解析层收到增量即转成上面的事件，而不是攒够整条响应再补发）。

use super::session::UsageSnapshot;

/// 后端 → 面板的事件名（MUST NOT 改名，面板钉死）。
pub const EVENT_NAME: &str = "harness:event";

/// 事件信封的字段名：会话所属 vault 的根路径（= 后端 sessions 映射的键）。
pub const VAULT_FIELD: &str = "vault";

/// 把 vault 标识盖进事件载荷的顶层（信封字段的唯一施加点，M312）。
///
/// 非对象载荷原样放过（九类构造函数都产对象，这条只防未来有人发非对象）。
pub fn stamp_vault(payload: &mut serde_json::Value, vault: &str) {
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            VAULT_FIELD.to_string(),
            serde_json::Value::String(vault.to_string()),
        );
    }
}

/// 事件发射通道抽象（ADR 0007 Decision 3 留口的 UI 侧：turn 循环只面向这个 trait，
/// 真 AppHandle 与单测收集器各自实现）。
pub trait EventSink: Send + Sync {
    fn emit(&self, payload: serde_json::Value);
}
/// 流式增量转发口（M369 真流式）：LLM 解析层（[`super::llm`]）每收到一个增量即回调，
/// **不再攒够整条响应再事后补发**——这是「回答逐字出现」而不是「一次性出现」的唯一落点。
///
/// 为什么不是 [`EventSink`]：分片的**事件形状**（`text_chunk` / `reasoning_chunk`）与
/// **思考块序号**是展示侧装配概念（序号计数器在 [`super::turn`]，随会话轮次推进），
/// 解析层不该知道；这样做也避免把展示用的序号塞进 [`super::llm::Request`]。
///
/// `aborted()` 是**在途停止**的判据：读循环（真 provider 的 SSE 解析、mock 的分片产出）
/// 隔一片问一次，翻真即收流——已产出的分片照常保留（中断语义 = 「不再继续」，非回滚）。
/// 解析层因此不必反向依赖 `Runtime`（`llm` 不感知会话层）。
pub trait StreamSink {
    /// 正文增量到达（真 provider 的 `response.output_text.delta` / mock 的 `chunks`）。
    fn text_delta(&self, delta: &str);
    /// 思考文本增量到达（真 provider 的 reasoning delta 事件 / mock 的 `reasoning_chunks`）。
    fn reasoning_delta(&self, delta: &str);
    /// 本轮是否已被请求停止（在途停止）。
    fn aborted(&self) -> bool;
}

/// 给任意 [`EventSink`] 盖上 vault 标识的装饰器（生产路径的装配点：`turn::run_turn`）。
///
/// 为什么做成装饰器而不是塞进 `TauriEventSink`：信封字段是**载荷契约**的一部分，与传输通道
/// 无关（将来接 headless CLI 后端照样成立）；也正因为只有这一个装配点，`run_turn_for` 里
/// 十几处发射点都不必各带一个 vault 参数——少十几处漏标的可能。
pub struct ScopedSink<'a> {
    inner: &'a dyn EventSink,
    vault: String,
}

impl<'a> ScopedSink<'a> {
    pub fn new(inner: &'a dyn EventSink, vault: impl Into<String>) -> Self {
        Self {
            inner,
            vault: vault.into(),
        }
    }
}

impl EventSink for ScopedSink<'_> {
    fn emit(&self, mut payload: serde_json::Value) {
        stamp_vault(&mut payload, &self.vault);
        self.inner.emit(payload);
    }
}

/// `{"type":"text_chunk","text":"..."}`
pub fn text_chunk(text: &str) -> serde_json::Value {
    serde_json::json!({"type": "text_chunk", "text": text})
}

/// `{"type":"reasoning_chunk","text":"...","index":N}`——思考文本分片（M362 新增的第九类）。
///
/// `text` 是 provider 的**明文**思考文本（[`super::thinking::reasoning_text`] 的产物，
/// `encrypted_content` 永不出现在这里）；`index` 是**块序号** = 本轮（一次提问的整个工具循环）
/// 里第几个思考块，同一块的多个分片共用同一个 `index`。
///
/// 前端按 `index` 聚合、按序号排列在 agent 正文之前，时长取同块首末分片的墙钟差（计时在前端，
/// core 不引入新计时状态）。本事件是纯**输出侧增量**——它不改 reasoning 的捕获 / 合成 / 回传
/// 路径（M306 纪律，[`super::llm`] 模块头），只把「已捕获的思考文本」转发给人。
pub fn reasoning_chunk(text: &str, index: u32) -> serde_json::Value {
    serde_json::json!({"type": "reasoning_chunk", "text": text, "index": index})
}

/// `{"type":"tool_call","name":"...","status":"started"|"done","summary":"..."}`
pub fn tool_call(name: &str, status: &str, summary: &str) -> serde_json::Value {
    serde_json::json!({"type": "tool_call", "name": name, "status": status, "summary": summary})
}

/// `{"type":"approval_request","id":"...","tool":"...","diff":"...","argv":[...]}`
///（diff / argv 按工具给：写类附 diff，cli_run 附 argv。）
pub fn approval_request(
    id: &str,
    tool: &str,
    diff: Option<&str>,
    argv: Option<&[String]>,
) -> serde_json::Value {
    approval_request_with_purpose(id, tool, diff, argv, None, None)
}

/// 带 purpose 的批准请求事件（M406/M407 契约，M413 起 turn.rs 的调用点收编到本函数）：
/// purpose = 模型自述的用途句（cli_run 的批准预览载荷，阅读辅助——面板在命令上方展示，
/// 命令原文永远完整可见）。`approval_request` 保持原签名作无 purpose 的包装。
///
/// M459：`reason` = 判定依据（[`super::permissions::DecisionReason`]，哪一层让这次调用进闸）——
/// 面板批准卡的「判定依据」行据此渲染，前端 MUST NOT 自行推导层级。缺席 = 无依据可讲（旧载荷 /
/// 自动放行的层）。与 `PendingApprovalSnapshot.reason` **同源同形**：两者都取
/// `gated_execute` 手上的同一个 `Verdict`（REVIEW.md 「同一语义两处真源」条）。
pub fn approval_request_with_purpose(
    id: &str,
    tool: &str,
    diff: Option<&str>,
    argv: Option<&[String]>,
    purpose: Option<&str>,
    reason: Option<&super::permissions::DecisionReason>,
) -> serde_json::Value {
    approval_request_full(
        id, tool, diff, argv, purpose, reason, None, None, None, None,
    )
}

/// 完整形态：在既有展示字段之外带**发起者**（change add-harness-subagents design §8.3）、
/// **定时任务预览**（change add-cron-conversational-registration design §6.3）与**两枚次级
/// 动作**（change harness-permission-rules-oct23 design §5：`remember` = 会话记忆粒度，
/// `persist_rule` = 持久规则原文；缺省 = 不显示该按钮）。交互调用传 `None` 的 source
/// （键缺席 = 父会话自己的卡，旧前端零改动）；`cron_task` 只在调度工具的批准卡上出现，
/// 形状见 `cron::create_preview` / 删除载荷。
#[allow(clippy::too_many_arguments)]
pub fn approval_request_full(
    id: &str,
    tool: &str,
    diff: Option<&str>,
    argv: Option<&[String]>,
    purpose: Option<&str>,
    reason: Option<&super::permissions::DecisionReason>,
    source: Option<&super::approval::ApprovalSource>,
    cron_task: Option<&serde_json::Value>,
    remember: Option<&str>,
    persist_rule: Option<&str>,
) -> serde_json::Value {
    let mut value = serde_json::json!({"type": "approval_request", "id": id, "tool": tool});
    if let Some(diff) = diff {
        value["diff"] = serde_json::json!(diff);
    }
    if let Some(argv) = argv {
        value["argv"] = serde_json::json!(argv);
    }
    if let Some(purpose) = purpose {
        value["purpose"] = serde_json::json!(purpose);
    }
    if let Some(reason) = reason {
        if let Ok(encoded) = serde_json::to_value(reason) {
            value["reason"] = encoded;
        }
    }
    if let Some(source) = source {
        if let Ok(encoded) = serde_json::to_value(source) {
            value["source"] = encoded;
        }
    }
    if let Some(cron_task) = cron_task {
        value["cron_task"] = cron_task.clone();
    }
    if let Some(remember) = remember {
        value["remember"] = serde_json::json!(remember);
    }
    if let Some(persist_rule) = persist_rule {
        value["persist_rule"] = serde_json::json!(persist_rule);
    }
    value
}

// ---------------------------------------------------------------------------
// 子运行可见面事件（change add-harness-subagents design §13 / §19）
//
// 这些载荷经同一个 `harness:event` 通道到达面板；事件名不在既有十类契约里，属于本 change
// 的新增类。过程事件 MUST NOT 含 prompt、文件内容与 vault 绝对路径（design §13 末条）。
// 诊断日志白名单（`logging.rs`）归后续 §7 批次，本批次只保证面板可见面。
// ---------------------------------------------------------------------------

/// `{"type":"subagent_started","run_id":…,"segment":…,"agent":…,"description":…,"model":…,
///   "tools":[…],"max_turns":…,"max_tokens":…,"timeout_secs":…,"background":…}`
#[allow(clippy::too_many_arguments)]
pub fn subagent_started(
    run_id: &str,
    segment: u32,
    parent_session: &str,
    agent: &str,
    description: &str,
    model: &str,
    tools: &[String],
    max_turns: u32,
    max_tokens: u64,
    timeout_secs: u64,
    background: bool,
) -> serde_json::Value {
    serde_json::json!({
        "type": "subagent_started",
        "run_id": run_id,
        "segment": segment,
        "parent_session": parent_session,
        "agent": agent,
        "description": description,
        "model": model,
        "tools": tools,
        "max_turns": max_turns,
        "max_tokens": max_tokens,
        "timeout_secs": timeout_secs,
        "background": background,
    })
}

/// `{"type":"subagent_progress","run_id":…,"segment":…,"rounds":…,"tool_calls":…,
///   "last_tool":…,"elapsed_ms":…}`（每轮最多一条，只给面板读数）。
pub fn subagent_progress(
    run_id: &str,
    segment: u32,
    rounds: u32,
    tool_calls: u32,
    last_tool: Option<&str>,
    elapsed_ms: u64,
) -> serde_json::Value {
    serde_json::json!({
        "type": "subagent_progress",
        "run_id": run_id,
        "segment": segment,
        "rounds": rounds,
        "tool_calls": tool_calls,
        "last_tool": last_tool,
        "elapsed_ms": elapsed_ms,
    })
}

/// `{"type":"subagent_step","run_id":…,"segment":…,"tool":…,"summary":…}`（参数摘要已人话化）。
pub fn subagent_step(run_id: &str, segment: u32, tool: &str, summary: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "subagent_step",
        "run_id": run_id,
        "segment": segment,
        "tool": tool,
        "summary": summary,
    })
}

/// 段收尾事件（任何终态只产出一次）。字段与 design §13 的 `subagent_finished` 对齐；
/// `stopped_by` / `audit_error` 按在场与否输出。
#[allow(clippy::too_many_arguments)]
pub fn subagent_finished(
    run_id: &str,
    segment: u32,
    agent: &str,
    status: &str,
    stopped_by: Option<&str>,
    rounds: u32,
    model: &str,
    input_tokens: u64,
    cached_tokens: u64,
    output_tokens: u64,
    denied_calls: u32,
    duration_ms: u64,
    summary_chars: usize,
    audit: Option<&str>,
    audit_error: Option<&str>,
) -> serde_json::Value {
    let mut value = serde_json::json!({
        "type": "subagent_finished",
        "run_id": run_id,
        "segment": segment,
        "agent": agent,
        "status": status,
        "rounds": rounds,
        "model": model,
        "input_tokens": input_tokens,
        "cached_tokens": cached_tokens,
        "output_tokens": output_tokens,
        "denied_calls": denied_calls,
        "duration_ms": duration_ms,
        "summary_chars": summary_chars,
    });
    if let Some(stopped_by) = stopped_by {
        value["stopped_by"] = serde_json::json!(stopped_by);
    }
    if let Some(audit) = audit {
        value["audit"] = serde_json::json!(audit);
    }
    if let Some(error) = audit_error {
        value["audit_error"] = serde_json::json!(error);
    }
    value
}

/// 通知最终处理事件（design §12.6.3）：`wake ∈ auto_turn / user_turn / blocked_chain /
/// blocked_stopped / none_aborted`，同一批用同一 `wake_batch`，`chain_index` 非自动回合为 0。
pub fn subagent_notified(
    run_id: &str,
    agent: &str,
    status: &str,
    wake: &str,
    wake_batch: &str,
    chain_index: u32,
) -> serde_json::Value {
    serde_json::json!({
        "type": "subagent_notified",
        "run_id": run_id,
        "agent": agent,
        "status": status,
        "wake": wake,
        "wake_batch": wake_batch,
        "chain_index": chain_index,
    })
}

/// 启动被拒（`reason` 闭集合：concurrency_limit / run_busy / subrun_limit / …）。
pub fn subagent_rejected(reason: &str, agent: &str, description: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "subagent_rejected",
        "reason": reason,
        "agent": agent,
        "description": description,
    })
}

/// `{"type":"usage", ...}`——载荷的**读数键 = [`UsageSnapshot`] 的序列化本身**（M534）。
///
/// 键集合：M443 的六键 `ctx_pct` / `cache_pct_session` / `cache_pct_turn` /
/// `cache_write_tokens` / `cache_write_tokens_session` / `cache_note`，加 M526 的绝对值键
/// `input_tokens` / `cached_tokens` / `cached_tokens_session` / `context_window` /
/// `has_usage`（三个百分比为**原始 f64**，取整由前端一次性 `Math.round`）。
///
/// **事件/快照一致性不变量（M534，合同条款见 `openspec/specs/harness`）**：本事件与
/// `harness_state` 快照的 `usage` SHALL 携带**同一组读数键**。两者本已同吃一个
/// [`UsageSnapshot`]（M443：MUST NOT 各算一套，REVIEW.md 「同一语义两处真源」条），M534 起**键集合也由它
/// 的一份 `Serialize` 产出**——加字段即两端同改，MUST NOT 再各维护一份键清单。现场即此：
/// 事件曾手列七键、漏掉 M526 的绝对值键，live 会话的 tokens 气泡因缺键静默回落百分比形态，
/// 而快照路径（切 vault 回来 / 恢复）带全，同一会话两种形态。
///
/// 键名与快照字段同名同义：`cache_pct_session` = 会话累计命中率（控制行主读数）、
/// `cache_pct_turn` = 最近一次往返的单回合值（气泡辅读数）、`cache_write_tokens[_session]` =
/// 本回合 / 本逻辑会话累计的缓存写入、`cache_note` = 本回合成因标注（无则 null）。旧
/// `cache_pct` 键**退役**——复用旧键会留一个「读到 cache_pct 的人以为还是单回合」的静默陷阱
/// （design §4.1）。
///
/// **M456 修正**：三个百分比原先在此**先 `round1` 到一位小数**，前端拿到 95.5 再
/// `Math.round` ⇒ 把 95.45% 显示成 96%（双舍入）；而**同一条读数**经 `harness_state` 快照
/// （原始 f64、前端只舍一次）出来是 95% —— 事件面与快照面因此在 `.x5` 边界上不一致
/// （场景 133 的次轮单回合即此）。载荷改为原样带 f64，取整只在消费端做一次。
pub fn usage(snapshot: &UsageSnapshot) -> serde_json::Value {
    let mut readings = match serde_json::to_value(snapshot) {
        Ok(serde_json::Value::Object(readings)) => readings,
        // 不可达（全字段是标量与 Option，序列化不会失败、也不会成非对象）；落空对象不 panic。
        _ => serde_json::Map::new(),
    };
    readings.insert("type".to_string(), serde_json::json!("usage"));
    serde_json::Value::Object(readings)
}

/// `{"type":"title","title":"..."}`——会话标题即时更新（change add-session-auto-naming，
/// design D11 的第十类）。
///
/// 载荷取后端 `effective_title` 的唯一读取结果（前端 MUST NOT 自行生成或猜测标题）。只改会话
/// 身份展示（标题栏会话名 + 已打开的历史浮层行名），MUST NOT 触发 transcript 重渲染、滚动 /
/// 焦点变化或历史清单重排。压缩 / 恢复的 `inherit` 标题也发一次（轮换后名字保持连续）。
pub fn title(title: &str) -> serde_json::Value {
    serde_json::json!({"type": "title", "title": title})
}

/// `{"type":"compact","summary":"..."}`（摘要可供面板展开）。
pub fn compact(summary: &str) -> serde_json::Value {
    serde_json::json!({"type": "compact", "summary": summary})
}

/// `{"type":"done"}`
pub fn done() -> serde_json::Value {
    serde_json::json!({"type": "done"})
}

/// `{"type":"error","code":"...","message":"..."}`
pub fn error(code: &str, message: &str) -> serde_json::Value {
    serde_json::json!({"type": "error", "code": code, "message": message})
}

/// `{"type":"aborted"}`——本轮被用户停止（design §5：中断是「不再继续」，不是回滚；
/// 已流式产出内容保留在 transcript 并标注「已停止」）。终态事件：面板收到后经
/// 与 done/error 同一出口回 idle，composer 立即可开新一轮。
pub fn aborted() -> serde_json::Value {
    serde_json::json!({"type": "aborted"})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct Collect(Arc<Mutex<Vec<serde_json::Value>>>);

    impl EventSink for Collect {
        fn emit(&self, payload: serde_json::Value) {
            self.0.lock().unwrap().push(payload);
        }
    }

    /// 十类载荷**每一类**都盖上 vault 标识——漏一类就是一条跨 vault 泄漏路径（M312）。
    /// `ScopedSink` 是生产中唯一的装配点（`turn::run_turn`），这里驱动的是同一个装饰器。
    #[test]
    fn scoped_sink_stamps_vault_on_every_event_kind() {
        let inner = Collect::default();
        let seen = inner.0.clone();
        let sink = ScopedSink::new(&inner, "/tmp/vault-a");
        sink.emit(text_chunk("你好"));
        sink.emit(tool_call("vault_read", "started", "读 a.md"));
        sink.emit(approval_request("ap-1", "vault_patch", Some("@@"), None));
        sink.emit(usage(&UsageSnapshot::default()));
        sink.emit(compact("摘要"));
        sink.emit(done());
        sink.emit(error("harness_busy", "忙"));
        sink.emit(aborted());
        sink.emit(reasoning_chunk("先读 a.md。", 0));
        sink.emit(title("Rust 生命周期排查"));

        let events = seen.lock().unwrap();
        assert_eq!(events.len(), 10);
        for event in events.iter() {
            assert_eq!(
                event[VAULT_FIELD],
                serde_json::json!("/tmp/vault-a"),
                "事件缺 vault 标识：{event}"
            );
        }
        // 区分度自证（REVIEW.md 「断言等价于子串」条）：未经包装的载荷**没有**这个字段——上面的断言因此
        // 真的在判「包装生效」，而不是「字段本来就存在」。
        assert!(text_chunk("你好").get(VAULT_FIELD).is_none());
        // 信封字段是**加**上去的，原有字段一个不少（形状仍是九类契约本身）。
        assert_eq!(events[0]["text"], serde_json::json!("你好"));
        assert_eq!(events[2]["tool"], serde_json::json!("vault_patch"));
        assert_eq!(
            events[5],
            serde_json::json!({"type": "done", "vault": "/tmp/vault-a"})
        );
        // 第九类：信封加上了，业务字段（文本 + 块序号）原样在列。
        assert_eq!(
            events[8],
            serde_json::json!({"type": "reasoning_chunk", "text": "先读 a.md。", "index": 0, "vault": "/tmp/vault-a"})
        );
        // 第十类（change add-session-auto-naming）：标题随信封到达面板。
        assert_eq!(
            events[9],
            serde_json::json!({"type": "title", "title": "Rust 生命周期排查", "vault": "/tmp/vault-a"})
        );
    }

    /// usage 载荷的三个百分比**原样带 f64**（M456）：事件面与 `harness_state` 快照面必须同精度，
    /// 否则同一读数在 `.x5` 边界上两端各舍一次、显示值不一致（场景 133 次轮单回合：
    /// 事件面曾把 95.4545 先舍成 95.5、前端再 `Math.round` 得 96%，而快照面的原值舍一次是 95%）。
    /// 反向验证：把 `usage()` 改回 `round1(...)` 时 95.4545→95.5，本用例即红。
    #[test]
    fn usage_payload_carries_raw_percentages() {
        let snapshot = UsageSnapshot {
            cache_pct_turn: 95.45454545454545,
            cache_pct_session: 59.52380952380952,
            ctx_pct: 16.784423828125,
            ..UsageSnapshot::default()
        };
        let payload = usage(&snapshot);
        let turn = payload["cache_pct_turn"].as_f64().unwrap();
        assert!(
            (turn - 95.45454545454545).abs() < 1e-9,
            "单回合值被提前舍入：{turn}"
        );
        // 前端一次性 Math.round ⇒ 95（真值 95.45% 的舍入结果），不是双舍入的 96。
        assert_eq!(turn.round() as i64, 95);
    }

    /// M534：`usage` 事件的读数键集合 = [`UsageSnapshot`] 的序列化键集合（**事件/快照一致性
    /// 不变量**）——事件与 `harness_state` 快照的 `usage` 携带同一组键，加字段即两端同改。
    ///
    /// 区分度（REVIEW.md 「断言等价于子串」条）：修前实现手列七键（`type` + M443 的六个读数键），
    /// `input_tokens` / `cached_tokens` / `cached_tokens_session` / `context_window` /
    /// `has_usage` 五键整体缺席；把 `usage()` 换回那份手列清单时本用例即红。现场后果：前端
    /// `usageReadings` 读不到 `input_tokens` / `context_window`，live 会话的 tokens 气泡按 D395
    /// 静默回落百分比形态，而同一会话走快照路径却显示绝对值。
    #[test]
    fn usage_payload_key_set_matches_snapshot_serialization() {
        use crate::harness::session::CacheNote;

        let snapshot = UsageSnapshot {
            ctx_pct: 16.784423828125,
            cache_pct_session: 59.52380952380952,
            cache_pct_turn: 95.45454545454545,
            cache_write_tokens: 900,
            cache_write_tokens_session: 1900,
            cache_note: Some(CacheNote::ColdStart),
            input_tokens: 12786,
            cached_tokens: 6400,
            cached_tokens_session: 9272,
            context_window: 131_072,
            has_usage: true,
        };
        let payload = usage(&snapshot);
        let readings = payload.as_object().unwrap();
        let expected = serde_json::to_value(snapshot).unwrap();
        let expected = expected.as_object().unwrap();

        // ① 键集合逐一相同：快照每键都在事件里，且事件不多出第二份读数键（只有判别键 `type`）。
        assert_eq!(
            readings.len(),
            expected.len() + 1,
            "事件读数键集合与快照不等：{payload}"
        );
        for (key, value) in expected {
            assert_eq!(
                readings.get(key),
                Some(value),
                "事件与快照不一致（缺键或异值）：{key}：{payload}"
            );
        }
        assert_eq!(payload["type"], serde_json::json!("usage"));

        // ② 绝对值键在事件里是**真读数**（不是缺省零值）——live 气泡据此走 tokens 形态。
        assert_eq!(readings["input_tokens"], serde_json::json!(12786));
        assert_eq!(readings["cached_tokens"], serde_json::json!(6400));
        assert_eq!(readings["cached_tokens_session"], serde_json::json!(9272));
        assert_eq!(readings["context_window"], serde_json::json!(131_072));
        assert_eq!(readings["has_usage"], serde_json::json!(true));
    }

    /// approval_request 的 argv 形状钉死为 JSON **数组**（M406 类型钉桩：前端曾按 string
    /// 读，live 渲染成逗号拼接、快照恢复整段丢弃）；purpose 缺省不出现在载荷里
    /// （None → 字段缺席，旧前端宽容解析不受影响）。M459：`reason`（判定依据）同口径——
    /// 有值时是 internally tagged 的对象，缺省时键整体缺席。
    #[test]
    fn approval_request_argv_is_array_and_purpose_optional() {
        use crate::config::PermissionMode;
        use crate::harness::permissions::DecisionReason;

        let argv = vec!["git".to_string(), "commit".to_string()];
        let plain = approval_request("ap-1", "cli_run", None, Some(&argv));
        assert_eq!(plain["argv"], serde_json::json!(["git", "commit"]));
        assert!(plain.get("purpose").is_none());
        assert!(plain.get("diff").is_none());
        assert!(plain.get("reason").is_none());

        let with_purpose = approval_request_with_purpose(
            "ap-2",
            "cli_run",
            None,
            Some(&argv),
            Some("提交周报改动"),
            None,
        );
        assert_eq!(with_purpose["purpose"], serde_json::json!("提交周报改动"));
        assert_eq!(with_purpose["argv"], serde_json::json!(["git", "commit"]));
        assert!(with_purpose.get("reason").is_none());

        // 判定依据随载荷到达前端（面板按 `kind` 取文案；形状与 permissions.rs 的单测同源）。
        let reason = DecisionReason::ModeDefault {
            mode: PermissionMode::VaultWrite,
        };
        let with_reason = approval_request_with_purpose(
            "ap-3",
            "cli_run",
            None,
            Some(&argv),
            Some("安装依赖"),
            Some(&reason),
        );
        assert_eq!(
            with_reason["reason"],
            serde_json::json!({"kind": "mode_default", "mode": "vault_write"})
        );

        // 定时任务预览（change add-cron-conversational-registration design §6.3）：有值时
        // 原样进载荷；缺省时键整体缺席（旧前端宽容解析不受影响）。
        assert!(plain.get("cron_task").is_none());
        let cron_task = serde_json::json!({
            "op": "create", "id": "daily-log", "at": "21:00", "days": ["mon"],
            "delivery": "notify-then-run", "session": "new", "vault": "/abs/vault",
            "prompt": "写今日 log", "skip_today": false,
        });
        let with_cron = approval_request_full(
            "ap-4",
            "cron_task_create",
            None,
            None,
            None,
            None,
            None,
            Some(&cron_task),
            None,
            None,
        );
        assert_eq!(with_cron["cron_task"], cron_task);
        assert!(with_cron.get("diff").is_none());

        // 两枚次级动作（change harness-permission-rules-oct23 design §5）：有值即进载荷，
        // 缺省时键整体缺席（前端按「缺键 = 不渲染」的翻转后的语义处理）。
        assert!(plain.get("remember").is_none());
        assert!(plain.get("persist_rule").is_none());
        let with_actions = approval_request_full(
            "ap-5",
            "cli_run",
            None,
            None,
            Some("查资料"),
            None,
            None,
            None,
            Some("tvly search"),
            Some("cli(tvly search *)"),
        );
        assert_eq!(with_actions["remember"], "tvly search");
        assert_eq!(with_actions["persist_rule"], "cli(tvly search *)");
    }

    /// 标识来自**包装时的作用域**，不是全局态：两个 sink 各盖各的，互不串。
    #[test]
    fn scoped_sink_keeps_scopes_apart() {
        let a = Collect::default();
        let b = Collect::default();
        let seen_a = a.0.clone();
        let seen_b = b.0.clone();
        ScopedSink::new(&a, "/tmp/vault-a").emit(done());
        ScopedSink::new(&b, "/tmp/vault-b").emit(done());
        assert_eq!(
            seen_a.lock().unwrap()[0][VAULT_FIELD],
            serde_json::json!("/tmp/vault-a")
        );
        assert_eq!(
            seen_b.lock().unwrap()[0][VAULT_FIELD],
            serde_json::json!("/tmp/vault-b")
        );
    }
}
