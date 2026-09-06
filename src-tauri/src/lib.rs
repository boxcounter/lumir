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
pub mod threads;

use tauri::Manager;

/// 启动 Tauri app。
pub fn run() {
    let started = std::time::Instant::now();
    tauri::Builder::default()
        .manage(commands::VaultState::default())
        .invoke_handler(tauri::generate_handler![
            commands::config_get,
            commands::vault_open,
            commands::vault_current,
            commands::fs_scan_workspace,
            commands::fs_read_file,
            commands::fs_read_attachment,
            commands::link_graph_resolve,
            commands::wikilink_create,
            threads::thread_list,
            threads::thread_create,
            threads::thread_update,
            threads::thread_current,
            threads::thread_switch,
            threads::vault_register,
            threads::vault_remap,
        ])
        .setup(move |app| {
            ready::emit_ready(started);
            restore_last_vault(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running lumir");
}

/// 启动恢复（vault-workspace spec）：last_vault 存在且仍为合法目录则自动打开；
/// 失效则进入未打开状态并留下人话提示（前端经 vault_current 取走展示），不崩溃不卡死。
fn restore_last_vault(app: &tauri::AppHandle) {
    let snapshot = match config::load() {
        Ok(s) => s,
        Err(e) => {
            app.state::<commands::VaultState>()
                .set_notice(format!("配置加载失败：{}", e.message));
            return;
        }
    };
    let state = app.state::<commands::VaultState>();
    let Some(last) = snapshot.config.last_vault else {
        return;
    };
    let path = std::path::PathBuf::from(&last);
    if !path.is_dir() {
        state.set_notice(format!("上次打开的 vault 已不可用：{last}，请重新选择目录"));
        return;
    }
    if let Err(e) = commands::open_vault(app, &state, path) {
        state.set_notice(format!("恢复上次 vault 失败：{}", e.message));
    }
}
