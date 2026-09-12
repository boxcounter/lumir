//! Lumir Rust core — M0 空壳骨架。
//!
//! 职责分层（ADR 0002 第 3 条）：Rust core 承担文件 IO/监听、索引/搜索、
//! link graph；webview 层只做渲染与交互，保持薄。
//! 架构约束（ADR 0002 第 7 条）：核心数据结构不深度耦合 UI 层，不堵死未来
//! 进程外 extension 隔离的可能性。本 crate 的模块均不依赖 `tauri` 类型，
//! 唯一例外是 `run()` 里与 webview 生命周期的接线。

pub mod commands;
pub mod config;
pub mod fs_io;
pub mod index;
pub mod link_graph;
pub mod ready;
pub mod recovery;
pub mod workspaces;

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
            commands::vault_open_path,
            commands::vault_current,
            commands::fs_scan_workspace,
            commands::fs_read_snapshot,
            commands::fs_read_attachment,
            commands::fs_file_revision,
            commands::document_save,
            commands::document_set_dirty,
            commands::recovery_backup,
            commands::recovery_load,
            commands::recovery_discard,
            commands::recovery_list,
            commands::link_graph_resolve,
            commands::wikilink_create,
            workspaces::vault_register,
            workspaces::vault_remap,
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
            // 已接受限制：Dock 右键退出 / 系统关机同样走 applicationWillTerminate、
            // 不产生 ExitRequested，dirty 守卫在这些 OS 级退出路径下不生效。
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
            } if app.state::<commands::DirtyState>().is_dirty() => {
                api.prevent_close();
                let _ = app.emit("app:quit_blocked", ());
            }
            _ => {}
        });
}

/// macOS 退出守卫菜单（M101）：Cocoa 默认 Quit 项直连 NSApp terminate:，不经
/// tauri 事件（连 RunEvent::ExitRequested 都不产生），dirty 守卫拦不住。把默认
/// 菜单 app 子菜单末尾的原生 Quit 换成自定义菜单项（同一 Cmd+Q 键等价），退出
/// 决策回到 on_menu_event。菜单其余部分与 tauri 默认完全一致（Menu::default）。
///
/// 结构性假设（tauri menu::Menu::default 源码）：首项为 app 子菜单、其末位为
/// 原生 Quit 项。tauri 升级若改动该结构，守卫会静默失效（默认菜单直连
/// terminate:，dirty 拦截不生效）——因此每个早退路径都打 stderr 警告，且移除
/// 末位项之前先校验其文案确为 Quit；校验失败保留默认菜单不改动，守卫退化到
/// ExitRequested / CloseRequested 兜底路径。
#[cfg(target_os = "macos")]
fn install_quit_guard_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItemBuilder, MenuItemKind};
    let menu = Menu::default(app)?;
    let Some(MenuItemKind::Submenu(app_submenu)) = menu.items()?.into_iter().next() else {
        eprintln!(
            "lumir: quit guard not installed: Menu::default() first item is not the app submenu (tauri menu structure changed)"
        );
        return Ok(());
    };
    let items = app_submenu.items()?;
    let Some(MenuItemKind::Predefined(quit)) = items.last() else {
        eprintln!(
            "lumir: quit guard not installed: app submenu last item is not a predefined item (tauri menu structure changed)"
        );
        return Ok(());
    };
    // tauri/muda 不暴露 predefined 项的种类枚举，只能按文案校验末位确为 Quit
    //（muda macOS 默认文案为 "Quit <app name>"，见 muda platform_impl）。
    let text = quit.text().unwrap_or_default();
    if !is_quit_item_text(&text) {
        eprintln!(
            "lumir: quit guard not installed: app submenu last item text {text:?} is not Quit (tauri menu structure changed)"
        );
        return Ok(());
    }
    let guarded = MenuItemBuilder::with_id(QUIT_MENU_ID, text)
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    app_submenu.remove_at(items.len() - 1)?;
    app_submenu.append(&guarded)?;
    app.set_menu(menu)?;
    Ok(())
}

/// 判断菜单项文案是否为原生 Quit 项：muda 默认文案 "Quit <app name>"（trim 后
/// 退化为 "Quit"）。纯函数，供 install_quit_guard_menu 移除末位项前校验。
#[cfg(target_os = "macos")]
fn is_quit_item_text(text: &str) -> bool {
    text == "Quit" || text.starts_with("Quit ")
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

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::is_quit_item_text;

    #[test]
    fn quit_item_text_matches_muda_default_forms() {
        // muda macOS 默认文案：trim 后的 "Quit" 与 "Quit <app name>"。
        assert!(is_quit_item_text("Quit"));
        assert!(is_quit_item_text("Quit lumir"));
        assert!(is_quit_item_text("Quit Lumir"));
    }

    #[test]
    fn quit_item_text_rejects_other_predefined_items() {
        assert!(!is_quit_item_text(""));
        assert!(!is_quit_item_text("Hide lumir"));
        assert!(!is_quit_item_text("About lumir"));
        assert!(!is_quit_item_text("Quitters")); // 必须带空格边界
        assert!(!is_quit_item_text("quit lumir")); // 大小写敏感，非 muda 默认文案
    }
}
