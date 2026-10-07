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
//! 为键，一个 vault 一个会话，两者恒等，故不另发一个同值的 `session` 字段（那会是
//! 「声明了却没有独立消费者」的死字段，REVIEW.md 第 9 条）。
//!
//! 载荷之上，本模块持有输出侧的两个 trait：[`EventSink`]（事件发射通道）与 [`StreamSink`]
//!（M369 的流式增量转发口——解析层收到增量即转成上面的事件，而不是攒够整条响应再补发）。

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
    let mut value = serde_json::json!({"type": "approval_request", "id": id, "tool": tool});
    if let Some(diff) = diff {
        value["diff"] = serde_json::json!(diff);
    }
    if let Some(argv) = argv {
        value["argv"] = serde_json::json!(argv);
    }
    value
}

/// `{"type":"usage","ctx_pct":NN,"cache_pct":NN}`（百分比保留一位小数，面板显示用）。
pub fn usage(ctx_pct: f64, cache_pct: f64) -> serde_json::Value {
    serde_json::json!({
        "type": "usage",
        "ctx_pct": round1(ctx_pct),
        "cache_pct": round1(cache_pct),
    })
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
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
        sink.emit(usage(12.34, 5.6));
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
