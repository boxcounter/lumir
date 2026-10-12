//! `harness:event` 事件载荷（tower 钉死、与 m303 面板共用的九类契约）。
//!
//! 事件名固定 `harness:event`；payload 是 JSON **对象**（m303 宽容解析：若是 string 会
//! JSON.parse 一次——直接发对象即零改动接入）。九类 type：
//! text_chunk / tool_call / approval_request / usage / compact / done / error / aborted /
//! reasoning_chunk
//!（aborted 为 M348 新增的第八类——本轮被用户停止；reasoning_chunk 为 M362 新增的第九类——
//! 思考文本分片，见 [`reasoning_chunk`]；既有七类的形状与语义一律未动）。
//!
//! 九类载荷之上有**一个公共信封字段**：`vault` = 发送该事件的会话所属 vault 的根路径
//!（M312，[`stamp_vault`] / [`ScopedSink`]）。前端据此只渲染**当前 vault** 的会话——
//! 切换 vault 之后仍在途的旧 vault 事件（工具循环跑在专线程上，切换不打断它）因此被丢弃，
//! 不会串进新 vault 的面板。它是「会话标识」本身：`Runtime` 的 sessions 映射以 vault 根路径
//! 为键（内存态一个 vault 一个活跃会话），故 vault 标识即该活跃会话的标识，不另发一个同值的
//! `session` 字段（那会是「声明了却没有独立消费者」的死字段，REVIEW.md 第 9 条）。
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
pub trait EventSink {
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
/// `gated_execute` 手上的同一个 `Verdict`（REVIEW.md 第 8 条）。
pub fn approval_request_with_purpose(
    id: &str,
    tool: &str,
    diff: Option<&str>,
    argv: Option<&[String]>,
    purpose: Option<&str>,
    reason: Option<&super::permissions::DecisionReason>,
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
    value
}

/// `{"type":"usage","ctx_pct":NN,"cache_pct_session":NN,"cache_pct_turn":NN,
/// "cache_write_tokens":NN,"cache_write_tokens_session":NN,"cache_note":null|"cold_start"|
/// "block_dilution"}`（三个百分比为**原始 f64**，取整由前端一次性 `Math.round`）。
///
/// M443：载荷**整体收一个 [`UsageSnapshot`]**——事件与 `harness_state` 快照同吃一个来源，
/// MUST NOT 各算一套（REVIEW.md 第 8 条）。键名与快照字段同名同义：`cache_pct_session` =
/// 会话累计命中率（控制行主读数）、`cache_pct_turn` = 最近一次往返的单回合值（气泡辅读数）、
/// `cache_write_tokens[_session]` = 本回合 / 本逻辑会话累计的缓存写入、`cache_note` = 本回合
/// 成因标注（无则 null）。旧 `cache_pct` 键**退役**——复用旧键会留一个「读到 cache_pct 的人
/// 以为还是单回合」的静默陷阱（design §4.1）。
///
/// **M456 修正**：三个百分比原先在此**先 [`round1`] 到一位小数**，前端拿到 95.5 再
/// `Math.round` ⇒ 把 95.45% 显示成 96%（双舍入）；而**同一条读数**经 `harness_state` 快照
/// （原始 f64、前端只舍一次）出来是 95% —— 事件面与快照面因此在 `.x5` 边界上不一致
/// （场景 133 的次轮单回合即此）。载荷改为原样带 f64，取整只在消费端做一次。
pub fn usage(snapshot: &UsageSnapshot) -> serde_json::Value {
    serde_json::json!({
        "type": "usage",
        "ctx_pct": snapshot.ctx_pct,
        "cache_pct_session": snapshot.cache_pct_session,
        "cache_pct_turn": snapshot.cache_pct_turn,
        "cache_write_tokens": snapshot.cache_write_tokens,
        "cache_write_tokens_session": snapshot.cache_write_tokens_session,
        "cache_note": snapshot.cache_note,
    })
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

    /// 九类载荷**每一类**都盖上 vault 标识——漏一类就是一条跨 vault 泄漏路径（M312）。
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

        let events = seen.lock().unwrap();
        assert_eq!(events.len(), 9);
        for event in events.iter() {
            assert_eq!(
                event[VAULT_FIELD],
                serde_json::json!("/tmp/vault-a"),
                "事件缺 vault 标识：{event}"
            );
        }
        // 区分度自证（REVIEW.md 第 1 条）：未经包装的载荷**没有**这个字段——上面的断言因此
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
