//! Lumir Rust core — M0 空壳骨架。
//!
//! 职责分层（ADR 0002 第 3 条）：Rust core 承担文件 IO/监听、索引/搜索、
//! link graph、ACP client、MCP server、CLI；webview 层只做渲染与交互，保持薄。
//! 架构约束（ADR 0002 第 7 条）：核心数据结构不深度耦合 UI 层，不堵死未来
//! 进程外 extension 隔离的可能性。本 crate 的模块均不依赖 `tauri` 类型，
//! 唯一例外是 `run()` 里与 webview 生命周期的接线。

pub mod acp_client;
pub mod cli;
pub mod commands;
pub mod config;
pub mod fs_io;
pub mod index;
pub mod link_graph;
pub mod mcp_server;
pub mod ready;

/// 启动 Tauri app。
pub fn run() {
    let started = std::time::Instant::now();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::config_get])
        .setup(move |_app| {
            ready::emit_ready(started);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running lumir");
}
