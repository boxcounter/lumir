//! ready 信号 —— 性能测量的终点标记。
//!
//! 契约（供 perf mission / M0 性能测量方法学 spec 消费，ADR 0002 第 6 条
//! 将测量方法学委托给 M0 定义）：
//!
//! 1. stdout 打印一行结构化日志，格式固定：
//!    `LUMIR_READY {"event":"ready","elapsed_ms":<f64>,"pid":<u32>,"ts_unix_ms":<u64>}`
//!    `elapsed_ms` 从 `run()` 入口计时到 Tauri setup 完成（即 webview 创建后、
//!    事件循环接管前）。前端首屏挂载时间另由 webview 侧 `performance.now()` 打点
//!    （见 src/main.ts），两者合起来覆盖"冷启动"测量口径。
//! 2. 同时写临时文件 `$TMPDIR/lumir-ready-<pid>`，内容为同一 JSON，便于
//!    无法捕获 stdout 的 harness（如 GUI 方式启动）读取。
//!
//! 该行只打印一次；harness 匹配行首 `LUMIR_READY ` 前缀即可。

use serde::Serialize;
use std::io::Write;

#[derive(Serialize)]
struct ReadyPayload {
    event: &'static str,
    elapsed_ms: f64,
    pid: u32,
    ts_unix_ms: u64,
}

pub fn emit_ready(started: std::time::Instant) {
    let payload = ReadyPayload {
        event: "ready",
        elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
        pid: std::process::id(),
        ts_unix_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    };
    let json = serde_json::to_string(&payload).expect("ready payload serializes");
    println!("LUMIR_READY {json}");

    let path = std::env::temp_dir().join(format!("lumir-ready-{}", payload.pid));
    if let Ok(mut f) = std::fs::File::create(&path) {
        let _ = f.write_all(json.as_bytes());
    }
}
