//! `harness:event` 事件载荷（tower 钉死、与 m303 面板共用的七类契约）。
//!
//! 事件名固定 `harness:event`；payload 是 JSON **对象**（m303 宽容解析：若是 string 会
//! JSON.parse 一次——直接发对象即零改动接入）。七类 type：
//! text_chunk / tool_call / approval_request / usage / compact / done / error。

/// 后端 → 面板的事件名（MUST NOT 改名，面板钉死）。
pub const EVENT_NAME: &str = "harness:event";

/// 事件发射通道抽象（ADR 0007 Decision 3 留口的 UI 侧：turn 循环只面向这个 trait，
/// 真 AppHandle 与单测收集器各自实现）。
pub trait EventSink {
    fn emit(&self, payload: serde_json::Value);
}

/// `{"type":"text_chunk","text":"..."}`
pub fn text_chunk(text: &str) -> serde_json::Value {
    serde_json::json!({"type": "text_chunk", "text": text})
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
