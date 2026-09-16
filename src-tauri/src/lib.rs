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
pub mod logging;
pub mod ready;
pub mod recovery;
pub mod workspaces;

#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItemBuilder, MenuItemKind};
use tauri::{Emitter, Manager};

/// 自定义退出菜单项 id（M101）：见 install_menu_overrides。
#[cfg(target_os = "macos")]
const QUIT_MENU_ID: &str = "lumir.quit";

/// 自定义撤销 / 重做菜单项 id（M131）：见 install_menu_overrides。
#[cfg(target_os = "macos")]
const UNDO_MENU_ID: &str = "lumir.undo";
#[cfg(target_os = "macos")]
const REDO_MENU_ID: &str = "lumir.redo";

/// 菜单命令事件名（M131）：前端 main.ts 订阅它，把菜单点击交给统一键位层的命令实现。
/// 载荷见 menu_command_of（菜单只说 undo / redo 这类平台术语，映射到前端命令 id 是前端的事）。
#[cfg(target_os = "macos")]
const MENU_COMMAND_EVENT: &str = "app:menu_command";

/// 启动 Tauri app。
pub fn run() {
    let started = std::time::Instant::now();
    tauri::Builder::default()
        // 外链打开（M144）：插件注册后 `app.opener()` 可用（Rust 侧调用不经 ACL）。
        // `open_js_links_on_click(false)`：插件默认会往 webview 注入一段脚本，把
        // `<a target=_blank>` 的点击直接开成浏览器——那是绕开本仓 scheme 校验的第二条
        // 打开路径，且会往页面里装一个全局 click 处理。关掉它，打开只有一条路：
        // `open_external_url` command。
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
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
            commands::log_event,
            commands::open_external_url,
            commands::link_resolve_note,
            commands::link_open_path,
            commands::recovery_backup,
            commands::recovery_load,
            commands::recovery_base_revision,
            commands::recovery_discard,
            commands::recovery_list,
            commands::link_graph_resolve,
            commands::wikilink_create,
            workspaces::vault_register,
            workspaces::vault_remap,
        ])
        .setup(move |app| {
            // 诊断日志先初始化：`[log] level` 在第一条事件之前生效（level = off 时
            // 整条链路都不落盘，见 logging 模块头）。
            logging::init();
            ready::emit_ready(started);
            #[cfg(target_os = "macos")]
            install_menu_overrides(app.handle())?;
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
            // 撤销 / 重做菜单项（M131）：菜单不自带 accelerator（让出 ⌘Z / ⇧⌘Z 给
            // webview），点击经事件交回前端统一命令层，与键盘走同一条命令实现。
            #[cfg(target_os = "macos")]
            if let Some(command) = menu_command_of(event.id().as_ref()) {
                let _ = app.emit(MENU_COMMAND_EVENT, command);
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
            // 退出：把诊断日志缓冲刷盘（丢掉一个批次的量会把「退出前发生了什么」抹掉，
            // 而那正是最常要查的一段）。正常退出路径都会走到这里。
            tauri::RunEvent::Exit => logging::flush(),
            _ => {}
        });
}

/// macOS 菜单改造入口：一次 `Menu::default()` 内完成退出守卫（M101）与撤销/重做让位
/// （M131）两处手术，改完统一 set_menu。
///
/// 为什么合成一个入口：两个改造都要基于 tauri 默认菜单做增删，各自 `Menu::default()`
/// 再 set_menu 会让后装的那次覆盖掉前一次（退出守卫会静默失效）。返回值语义沿旧例——
/// 只有真改动了才 set_menu，结构假设不成立时保留默认菜单。
#[cfg(target_os = "macos")]
fn install_menu_overrides(app: &tauri::AppHandle) -> tauri::Result<()> {
    let menu = Menu::default(app)?;
    let quit_guarded = guard_quit_item(&menu, app)?;
    let undo_redo_swapped = swap_undo_redo_items(&menu, app)?;
    if quit_guarded || undo_redo_swapped {
        app.set_menu(menu)?;
    }
    Ok(())
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
/// ExitRequested / CloseRequested 兜底路径。返回是否做了替换。
#[cfg(target_os = "macos")]
fn guard_quit_item<R: tauri::Runtime>(
    menu: &Menu<R>,
    app: &tauri::AppHandle<R>,
) -> tauri::Result<bool> {
    let Some(MenuItemKind::Submenu(app_submenu)) = menu.items()?.into_iter().next() else {
        eprintln!(
            "lumir: quit guard not installed: Menu::default() first item is not the app submenu (tauri menu structure changed)"
        );
        return Ok(false);
    };
    let items = app_submenu.items()?;
    let Some(MenuItemKind::Predefined(quit)) = items.last() else {
        eprintln!(
            "lumir: quit guard not installed: app submenu last item is not a predefined item (tauri menu structure changed)"
        );
        return Ok(false);
    };
    // tauri/muda 不暴露 predefined 项的种类枚举，只能按文案校验末位确为 Quit
    //（muda macOS 默认文案为 "Quit <app name>"，见 muda platform_impl）。
    let text = quit.text().unwrap_or_default();
    if !is_quit_item_text(&text) {
        eprintln!(
            "lumir: quit guard not installed: app submenu last item text {text:?} is not Quit (tauri menu structure changed)"
        );
        return Ok(false);
    }
    let guarded = MenuItemBuilder::with_id(QUIT_MENU_ID, text)
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    app_submenu.remove_at(items.len() - 1)?;
    app_submenu.append(&guarded)?;
    Ok(true)
}

/// 撤销 / 重做菜单项让位（M131）：把 Edit 子菜单的**预置** Undo / Redo 换成自定义项。
///
/// 为什么必须换掉预置项：预置项在 macOS 上是 `undo:` / `redo:` selector 直连原生
/// responder chain 的撤销栈，而 Lumir 的文档由 CodeMirror 管理、撤销栈在 CM 的 history
/// 里——预置项等于第二套撤销，与 CM 的栈各记各的（M103 同族教训：文档状态只允许一个
/// 持有者）。换成自定义项后点击经 MENU_COMMAND_EVENT 交回前端统一命令层，与 ⌘Z 走同
/// 一个命令实现。
///
/// **加速键刻意不设**：预置项在 macOS 上自带 key equivalent——muda 的
/// `PredefinedMenuItemType::Undo => Accelerator::new(Some(CMD_OR_CTRL), Code::KeyZ)`
///（Redo 为 ⇧⌘Z，见 muda items/predefined.rs 的 accelerator()，经
/// platform_impl/macos/mod.rs 的 `item_type.accelerator()` 落到 NSMenuItem），所以
/// `Menu::default()` 里的 Undo / Redo 确实占着 ⌘Z / ⇧⌘Z，JS 收不到——这是 M129 survey
/// 轨道 F 的实证。自定义项不再带加速键，键回到 webview 的 keydown 路径，由统一键位层
/// 的 ⌘Z / ⇧⌘Z 绑定接管；菜单点击另有事件通道，两条路进同一个命令层。
///
/// 结构性假设（tauri 2.11 Menu::default 源码）：Edit 子菜单前三项依次为预置
/// Undo / Redo / 分隔符，预置项文案固定为 "Undo" / "Redo"（muda 对 macOS 不带助记符
/// `&`）。校验失败即保持默认菜单不改动并打 stderr 警告。返回是否做了替换。
#[cfg(target_os = "macos")]
fn swap_undo_redo_items<R: tauri::Runtime>(
    menu: &Menu<R>,
    app: &tauri::AppHandle<R>,
) -> tauri::Result<bool> {
    let edit = menu.items()?.into_iter().find_map(|item| match item {
        MenuItemKind::Submenu(submenu)
            if submenu.text().map(|text| text == "Edit").unwrap_or(false) =>
        {
            Some(submenu)
        }
        _ => None,
    });
    let Some(edit) = edit else {
        eprintln!(
            "lumir: undo/redo menu not installed: Menu::default() has no Edit submenu (tauri menu structure changed)"
        );
        return Ok(false);
    };
    let head: Vec<String> = edit
        .items()?
        .iter()
        .take(2)
        .map(|item| match item {
            MenuItemKind::Predefined(predefined) => predefined.text().unwrap_or_default(),
            _ => String::new(),
        })
        .collect();
    if !edit_items_are_predefined_undo_redo(&head) {
        eprintln!(
            "lumir: undo/redo menu not installed: Edit submenu head is not the predefined Undo/Redo items (tauri menu structure changed)"
        );
        return Ok(false);
    }
    // 文案沿用原生（"Undo" / "Redo"，与菜单其余项的英文一致），加速键不设（见上）。
    let undo = MenuItemBuilder::with_id(UNDO_MENU_ID, head[0].clone()).build(app)?;
    let redo = MenuItemBuilder::with_id(REDO_MENU_ID, head[1].clone()).build(app)?;
    edit.remove_at(1)?;
    edit.remove_at(0)?;
    edit.insert(&undo, 0)?;
    edit.insert(&redo, 1)?;
    Ok(true)
}

/// Edit 子菜单前两项是否为预置 Undo / Redo（按文案判定，见 swap_undo_redo_items 的
/// 结构假设）。纯函数，供替换前校验：不成立就不动菜单。
#[cfg(target_os = "macos")]
fn edit_items_are_predefined_undo_redo(texts: &[String]) -> bool {
    matches!(texts, [undo, redo, ..] if undo == "Undo" && redo == "Redo")
}

/// 菜单命令事件载荷（前端 main.ts 的 MENU_COMMANDS 键）。菜单只说平台术语
/// undo / redo，映射到前端命令 id 是前端的事——Rust 侧不持有前端的命令命名。
#[cfg(target_os = "macos")]
fn menu_command_of(id: &str) -> Option<&'static str> {
    match id {
        UNDO_MENU_ID => Some("undo"),
        REDO_MENU_ID => Some("redo"),
        _ => None,
    }
}

/// 判断菜单项文案是否为原生 Quit 项：muda 默认文案 "Quit <app name>"（trim 后
/// 退化为 "Quit"）。纯函数，供 guard_quit_item 移除末位项前校验。
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
    use super::{edit_items_are_predefined_undo_redo, is_quit_item_text, menu_command_of};

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

    /// Edit 子菜单前两项校验：只认 muda 对 macOS 的默认文案（不带助记符 `&`）。
    #[test]
    fn edit_head_requires_predefined_undo_redo() {
        let texts = |items: &[&str]| items.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(edit_items_are_predefined_undo_redo(&texts(&[
            "Undo", "Redo", ""
        ])));
        assert!(edit_items_are_predefined_undo_redo(&texts(&[
            "Undo", "Redo"
        ])));

        // Windows/Linux 的助记符文案、错位、缺项都必须判否（宁可不改菜单）
        assert!(!edit_items_are_predefined_undo_redo(&texts(&[
            "&Undo", "Redo"
        ])));
        assert!(!edit_items_are_predefined_undo_redo(&texts(&[
            "Redo", "Undo"
        ])));
        assert!(!edit_items_are_predefined_undo_redo(&texts(&["Cut"])));
        assert!(!edit_items_are_predefined_undo_redo(&texts(&[])));
        // 只看前两项：Edit 子菜单本就有 7 项（Undo/Redo/分隔/Cut/Copy/Paste/SelectAll）
        assert!(edit_items_are_predefined_undo_redo(&texts(&[
            "Undo",
            "Redo",
            "",
            "Cut",
            "Copy",
            "Paste",
            "Select All"
        ])));
    }

    /// 菜单命令事件载荷：只认自己的两个菜单项 id，其余（含 Quit）不产生命令事件。
    #[test]
    fn menu_command_only_covers_undo_redo_items() {
        assert_eq!(menu_command_of("lumir.undo"), Some("undo"));
        assert_eq!(menu_command_of("lumir.redo"), Some("redo"));
        assert_eq!(menu_command_of("lumir.quit"), None);
        assert_eq!(menu_command_of("Undo"), None);
        assert_eq!(menu_command_of(""), None);
    }
}
