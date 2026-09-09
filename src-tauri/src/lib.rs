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

use tauri::{Emitter, Manager};

/// 自定义退出菜单项 id（M101）：见 install_quit_guard_menu。
#[cfg(target_os = "macos")]
const QUIT_MENU_ID: &str = "lumir.quit";

/// 启动 Tauri app。
pub fn run() {
    let started = std::time::Instant::now();
    tauri::Builder::default()
        .manage(commands::VaultState::default())
        .manage(commands::DirtyState::default())
        .invoke_handler(tauri::generate_handler![
            commands::config_get,
            commands::vault_open,
            commands::vault_current,
            commands::fs_scan_workspace,
            commands::fs_read_snapshot,
            commands::fs_read_attachment,
            commands::fs_file_revision,
            commands::document_save,
            commands::document_set_dirty,
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
            #[cfg(target_os = "macos")]
            install_quit_guard_menu(app.handle())?;
            restore_last_vault(app.handle());
            Ok(())
        })
        .on_menu_event(|app, event| {
            // dirty 退出守卫（M101 验收修复）：macOS Cmd+Q 命中菜单键等价后走到这里。
            // dirty 时不退出、通知前端弹提示；干净时显式退出（app.exit 会再经
            // ExitRequested，此时守卫放行）。
            #[cfg(target_os = "macos")]
            if event.id().as_ref() == QUIT_MENU_ID {
                if app.state::<commands::DirtyState>().is_dirty() {
                    let _ = app.emit("app:quit_blocked", ());
                } else {
                    app.exit(0);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building lumir")
        .run(|app, event| match event {
            // 兜底：beforeunload 拦不住 Tauri 原生退出（macOS Cmd+Q 在 tao 层走
            // applicationWillTerminate 直接结束事件循环，不产生 ExitRequested——
            // 所以主守卫在上面的菜单拦截；此处覆盖 AppHandle::exit / 末窗销毁路径）。
            // dirty 时阻止退出并通知前端弹提示；emit 失败（webview 已毁）无害。
            tauri::RunEvent::ExitRequested { api, .. } => {
                if app.state::<commands::DirtyState>().is_dirty() {
                    api.prevent_exit();
                    let _ = app.emit("app:quit_blocked", ());
                }
            }
            // 关窗（红灯按钮 / Cmd+W）同理：单窗口应用关窗即丢 webview 内存文档。
            tauri::RunEvent::WindowEvent {
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                if app.state::<commands::DirtyState>().is_dirty() {
                    api.prevent_close();
                    let _ = app.emit("app:quit_blocked", ());
                }
            }
            _ => {}
        });
}

/// macOS 退出守卫菜单（M101）：Cocoa 默认 Quit 项直连 NSApp terminate:，不经
/// tauri 事件（连 RunEvent::ExitRequested 都不产生），dirty 守卫拦不住。把默认
/// 菜单 app 子菜单末尾的原生 Quit 换成自定义菜单项（同一 Cmd+Q 键等价），退出
/// 决策回到 on_menu_event。菜单其余部分与 tauri 默认完全一致（Menu::default）。
#[cfg(target_os = "macos")]
fn install_quit_guard_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItemBuilder, MenuItemKind};
    let menu = Menu::default(app)?;
    let Some(MenuItemKind::Submenu(app_submenu)) = menu.items()?.into_iter().next() else {
        return Ok(());
    };
    let items = app_submenu.items()?;
    // Menu::default 的 app 子菜单末位即原生 Quit（见 tauri menu::Menu::default 源码）。
    let Some(MenuItemKind::Predefined(quit)) = items.last() else {
        return Ok(());
    };
    let text = quit.text().unwrap_or_else(|_| "Quit".to_string());
    let guarded = MenuItemBuilder::with_id(QUIT_MENU_ID, text)
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    app_submenu.remove_at(items.len() - 1)?;
    app_submenu.append(&guarded)?;
    app.set_menu(menu)?;
    Ok(())
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
    match commands::open_vault(app, &state, path, false) {
        Ok(info) if !info.remap_candidates.is_empty() => {
            state.set_notice("发现可能已移动的 vault，请确认重映射".into())
        }
        Ok(_) => {}
        Err(e) => state.set_notice(format!("恢复上次 vault 失败：{}", e.message)),
    }
}
