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
pub mod reading_position;
pub mod ready;
pub mod recovery;
pub mod vault_session;
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

/// 自定义关闭菜单项 id（M149）：见 install_menu_overrides。
///
/// 原生 `Menu::default()` 在 macOS 上往 **File** 与 **Window** 两个子菜单各放了一个预置
/// Close（都带 ⌘W 加速键）。两处都要换掉，但给两个不同的 id：同一 id 在菜单里出现两次
/// 在 tauri/muda 里语义不明（按 id 查找只返回第一个），而两者在做同一个动作这件事由
/// menu_command_of 统一映射表达，不靠 id 相同。
#[cfg(target_os = "macos")]
const CLOSE_MENU_ID: &str = "lumir.close";
#[cfg(target_os = "macos")]
const CLOSE_WINDOW_MENU_ID: &str = "lumir.close_window";

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
            commands::fs_file_mtime,
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
            // 多 vault（M162）：列表 + 按 vault 的标签会话（前端在 M163 接）
            workspaces::vault_list,
            vault_session::vault_session_get,
            vault_session::vault_session_put,
            // 文档阅读位置（M194，change remember-reading-position）：与标签会话分开存
            reading_position::reading_position_get,
            reading_position::reading_position_put,
        ])
        .setup(move |app| {
            // 诊断日志先初始化：`[log] level` 在第一条事件之前生效（level = off 时
            // 整条链路都不落盘，见 logging 模块头）。
            logging::init();
            ready::emit_ready(started);
            #[cfg(target_os = "macos")]
            install_menu_overrides(app.handle())?;
            // last_vault 自动恢复移出主线程（M159）：本回调随即返回，事件循环继续跑
            // ——窗口立即可绘制。setup 内 MUST NOT 同步做 config::load / open_vault。
            start_restore(app.handle());
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

/// macOS 菜单改造入口：一次 `Menu::default()` 内完成退出守卫（M101）、撤销/重做让位
/// （M131）与关闭项让位（M149）三处手术，改完统一 set_menu。
///
/// 为什么合成一个入口：三处改造都要基于 tauri 默认菜单做增删，各自 `Menu::default()`
/// 再 set_menu 会让后装的那次覆盖掉前一次（退出守卫会静默失效）。返回值语义沿旧例——
/// 只要有一处真改动了就 set_menu，三处都因结构假设不成立而放弃时保留默认菜单。
#[cfg(target_os = "macos")]
fn install_menu_overrides(app: &tauri::AppHandle) -> tauri::Result<()> {
    let menu = Menu::default(app)?;
    let quit_guarded = guard_quit_item(&menu, app)?;
    let undo_redo_swapped = swap_undo_redo_items(&menu, app)?;
    let close_swapped = swap_close_window_items(&menu, app)?;
    if quit_guarded || undo_redo_swapped || close_swapped {
        app.set_menu(menu)?;
    }
    Ok(())
}

/// 关闭菜单项让位（M149 多标签）：把 **File** 与 **Window** 两个子菜单里的**预置** Close
/// 换成不带加速键的自定义项，点击经 MENU_COMMAND_EVENT 交回前端统一命令层。
///
/// 为什么必须换：预置 CloseWindow 在 macOS 上自带 key equivalent ⌘W（muda 的
/// `PredefinedMenuItemType::CloseWindow => Accelerator::new(Some(CMD_OR_CTRL), Code::KeyW)`，
/// 见 items/predefined.rs 的 accelerator()，经 platform_impl/macos 的
/// `item_type.accelerator()` 落到 NSMenuItem）。菜单键等价在 NSApplication 分发阶段就被菜单
/// 截获，webview 的 keydown 永远收不到 ⌘W——与 M131 的 ⌘Z / ⇧⌘Z 完全同一机制（那边是
/// M129 survey 的实证）。台账里 ⌘W 归 `tab.close`，因此必须让出这个键。
///
/// 语义变化（mission 裁决，tower 2026-09-17）：⌘W 从「关窗」变成「关当前标签」；菜单里的
/// 关闭项仍在，只是不再带加速键。单窗口应用里「关窗≈关应用」，而关标签是更高频动作
/// （Obsidian / VS Code 同口径）；退出仍走 ⌘Q（有 dirty 守卫）与红灯按钮。
///
/// 结构性假设（tauri 2.11.5 `menu::Menu::default` 源码）：File 子菜单在 macOS 上只有一项
/// 预置 Close（非 macOS 还多一个 Quit），Window 子菜单为 [Minimize, Maximize, 分隔符,
/// Close] 且 Close 在末位；预置项文案为 "Close"（muda 对 macOS 不带助记符 `&`）。校验失败即
/// 跳过该子菜单并打 stderr 警告，绝不在结构变化时盲目删项。返回是否做了替换。
#[cfg(target_os = "macos")]
fn swap_close_window_items<R: tauri::Runtime>(
    menu: &Menu<R>,
    app: &tauri::AppHandle<R>,
) -> tauri::Result<bool> {
    let mut swapped = false;
    for (submenu_title, id) in [("File", CLOSE_MENU_ID), ("Window", CLOSE_WINDOW_MENU_ID)] {
        let submenu = menu.items()?.into_iter().find_map(|item| match item {
            MenuItemKind::Submenu(submenu)
                if submenu
                    .text()
                    .map(|text| text == submenu_title)
                    .unwrap_or(false) =>
            {
                Some(submenu)
            }
            _ => None,
        });
        let Some(submenu) = submenu else {
            eprintln!(
                "lumir: close menu not installed: Menu::default() has no {submenu_title} submenu (tauri menu structure changed)"
            );
            continue;
        };
        let items = submenu.items()?;
        let Some(MenuItemKind::Predefined(close)) = items.last() else {
            eprintln!(
                "lumir: close menu not installed: {submenu_title} submenu last item is not a predefined item (tauri menu structure changed)"
            );
            continue;
        };
        let text = close.text().unwrap_or_default();
        if !is_close_item_text(&text) {
            eprintln!(
                "lumir: close menu not installed: {submenu_title} submenu last item text {text:?} is not Close (tauri menu structure changed)"
            );
            continue;
        }
        // 文案沿用原生（"Close"），加速键刻意不设——见函数头：设了就等于把 ⌘W 又截走。
        let item = MenuItemBuilder::with_id(id, text).build(app)?;
        submenu.remove_at(items.len() - 1)?;
        submenu.append(&item)?;
        swapped = true;
    }
    Ok(swapped)
}

/// 判断菜单项文案是否为原生 Close 项：muda 对 macOS 给出 "Close"（Windows/Linux 为
/// "C&lose Window"，本函数一并接受，便于将来跨平台时不静默退化）。纯函数，供
/// swap_close_window_items 删项前校验。
#[cfg(target_os = "macos")]
fn is_close_item_text(text: &str) -> bool {
    text == "Close" || text == "C&lose Window" || text == "Close Window"
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
/// undo / redo / close，映射到前端命令 id 是前端的事——Rust 侧不持有前端的命令命名。
#[cfg(target_os = "macos")]
fn menu_command_of(id: &str) -> Option<&'static str> {
    match id {
        UNDO_MENU_ID => Some("undo"),
        REDO_MENU_ID => Some("redo"),
        // File 与 Window 两个子菜单的关闭项做同一个动作（关当前标签），因此同一个载荷。
        CLOSE_MENU_ID | CLOSE_WINDOW_MENU_ID => Some("close"),
        _ => None,
    }
}

/// 判断菜单项文案是否为原生 Quit 项：muda 默认文案 "Quit <app name>"（trim 后
/// 退化为 "Quit"）。纯函数，供 guard_quit_item 移除末位项前校验。
#[cfg(target_os = "macos")]
fn is_quit_item_text(text: &str) -> bool {
    text == "Quit" || text.starts_with("Quit ")
}

/// 启动恢复（vault-workspace spec「启动恢复的时序与可见性」）：setup 只起命名线程后立即返回，
/// 恢复的全部耗时（配置读取、`last_vault` 校验、全量枚举与索引建立）都在主线程之外完成。
///
/// 线程选型（design §3.3）：`std::thread::Builder` 命名线程，与仓内既有的 `lumir-log` /
/// `lumir-fs-debounce` 同形；任务是纯阻塞 IO，没有 async 组合需求，不需要 tokio blocking
/// worker。`emit_ready` 的发射位置不动——它仍是「事件循环可接管」的标记，不含恢复耗时。
///
/// 起线程失败（资源耗尽）时**不做主线程兜底**：setup 内同步跑恢复正是本 change 要消掉的
/// 行为（spec：setup MUST NOT 同步执行 `config::load` 与 `open_vault`）。此时恢复从未开始，
/// `restore_pending` 保持 false，前端启动时拉一次 `vault_current` 直接得到「未打开 + 打开
/// 入口」这个合法终态，用户可手动打开。
fn start_restore(app: &tauri::AppHandle) {
    let handle = app.clone();
    if let Err(e) = std::thread::Builder::new()
        .name("lumir-vault-restore".into())
        .spawn(move || restore_last_vault(&handle))
    {
        eprintln!("lumir: 恢复线程启动失败（未开始恢复，界面按未打开空态启动）：{e}");
    }
}

/// 恢复线程内的收尾保证（design §3.4）：正常提交、提前 `return` 与 debug profile 下的
/// unwind 都必须「清 `restore_pending` + 发完成信号」。release 的 `panic = "abort"` 直接
/// 终止进程，不存在卡在恢复中的状态，因此不依赖本结构。
struct RestoreGuard {
    app: tauri::AppHandle,
    generation: u64,
    signaled: bool,
}

impl RestoreGuard {
    fn new(app: &tauri::AppHandle, generation: u64) -> Self {
        Self {
            app: app.clone(),
            generation,
            signaled: false,
        }
    }

    /// 正常结束：把终局交给 [`commands::VaultState::finish_restore`] 单次持锁裁决，再发完成信号。
    ///
    /// 裁决为「已应用」且终局是一次成功打开时，顺带记该注册项的 `last_opened_at`
    /// （M162；spec：启动恢复也是「打开成功」的一种）——被让位丢弃的恢复不记：那次打开没有
    /// 发生，不该改动列表排序与「上次打开时间」。写在本线程（`lumir-vault-restore`）上，
    /// 不占主线程。
    fn finish(mut self, outcome: commands::RestoreOutcome) {
        let opened_id = match &outcome {
            commands::RestoreOutcome::Opened(prepared) => Some(prepared.vault_id.clone()),
            _ => None,
        };
        let applied = self
            .app
            .state::<commands::VaultState>()
            .finish_restore(self.generation, outcome);
        if let Some(id) = opened_id.filter(|_| applied) {
            crate::workspaces::mark_opened(&id);
        }
        self.signal();
    }

    /// 完成信号的唯一发射点。载荷为 `()`（无载荷）：载荷会在「恢复读状态」与「用户提交」
    /// 之间产生竞态，而前端本来就以 `vault_current` 为权威状态，事件只是唤醒信号。
    fn signal(&mut self) {
        if self.signaled {
            return;
        }
        self.signaled = true;
        let _ = self.app.emit(RESTORE_FINISHED_EVENT, ());
    }
}

impl Drop for RestoreGuard {
    fn drop(&mut self) {
        if self.signaled {
            return;
        }
        // 提前 return / panic unwind：不把界面永远留在「恢复中」——清掉进行态（不应用任何
        // 终局，恢复本来也没算出终局）再发信号，前端据此拉一次权威状态落到终态。
        self.app
            .state::<commands::VaultState>()
            .finish_restore(self.generation, commands::RestoreOutcome::Idle);
        self.signal();
    }
}

/// 后端 → 前端的「启动恢复已结束」唤醒信号（无载荷）。与前端 `lumir:vault-ready`
/// 的分工见 `src/main.ts` 两个发射点：前者面向启动状态机，后者面向前端就绪管线/测试。
const RESTORE_FINISHED_EVENT: &str = "vault:restore_finished";

/// 启动恢复任务体（在 `lumir-vault-restore` 线程上跑）：进入进行态 → 算终局 → 单次持锁提交。
fn restore_last_vault(app: &tauri::AppHandle) {
    let generation = app.state::<commands::VaultState>().begin_restore();
    let guard = RestoreGuard::new(app, generation);
    guard.finish(restore_outcome(app));
}

/// 恢复任务的终局计算：全部 IO 都在锁外、且不改写任何状态；四条结束路径（成功 / 无
/// `last_vault` / 路径失效 / 配置加载失败或打开失败）各自映射成一个显式终局，文案与
/// M159 之前的 `restore_last_vault` 逐字一致。是否真正应用由 `finish_restore` 裁决
/// ——用户抢先成功打开的 vault 优先，过期结果整包丢弃（含失败提示）。
fn restore_outcome(app: &tauri::AppHandle) -> commands::RestoreOutcome {
    let snapshot = match config::load() {
        Ok(s) => s,
        Err(e) => return commands::RestoreOutcome::Notice(format!("配置加载失败：{}", e.message)),
    };
    let Some(last) = snapshot.config.last_vault else {
        return commands::RestoreOutcome::Idle;
    };
    let path = std::path::PathBuf::from(&last);
    if !path.is_dir() {
        return commands::RestoreOutcome::Notice(format!(
            "上次打开的 vault 已不可用：{last}，请重新选择目录"
        ));
    }
    match commands::prepare_vault_open(app, path, false) {
        Ok(commands::PreparedOpen::Remap { .. }) => {
            commands::RestoreOutcome::Notice("发现可能已移动的 vault，请确认重映射".into())
        }
        Ok(commands::PreparedOpen::Ready(prepared)) => commands::RestoreOutcome::Opened(prepared),
        Err(e) => commands::RestoreOutcome::Notice(format!("恢复上次 vault 失败：{}", e.message)),
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{
        edit_items_are_predefined_undo_redo, is_close_item_text, is_quit_item_text, menu_command_of,
    };

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

    /// 关闭项文案校验（M149）：只认 muda 的默认文案，错项一律判否（宁可不改菜单）。
    #[test]
    fn close_item_text_matches_muda_default_forms() {
        assert!(is_close_item_text("Close")); // macOS
        assert!(is_close_item_text("C&lose Window")); // Windows/Linux
        assert!(is_close_item_text("Close Window"));
    }

    #[test]
    fn close_item_text_rejects_other_predefined_items() {
        assert!(!is_close_item_text(""));
        assert!(!is_close_item_text("close")); // 大小写敏感，非 muda 默认文案
        assert!(!is_close_item_text("Close All"));
        assert!(!is_close_item_text("Minimize"));
        assert!(!is_close_item_text("Quit lumir"));
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

    /// 菜单事件载荷（M131 + M149）：只认自己的菜单项 id，其余（含 Quit、预置项文案本身）
    /// 不产生命令事件。
    ///
    /// M149 新增的两个关闭项 id 各断言一次：它们是**两次独立的菜单手术**（File 子菜单与
    /// Window 子菜单各一处），只测一个会漏掉另一条转发路径。
    ///
    /// 真实菜单手术（remove_at / append）需要一份 AppHandle，纯单测覆盖不到——与 M131
    /// 同一深度：可判定的部分是「文案校验 + id → 载荷映射」，手术本身由真机验收覆盖
    /// （14-tabs 的菜单点击步骤）。
    #[test]
    fn menu_command_only_covers_our_menu_items() {
        assert_eq!(menu_command_of("lumir.undo"), Some("undo"));
        assert_eq!(menu_command_of("lumir.redo"), Some("redo"));
        assert_eq!(menu_command_of("lumir.close"), Some("close"));
        assert_eq!(menu_command_of("lumir.close_window"), Some("close"));
        assert_eq!(menu_command_of("lumir.quit"), None);
        assert_eq!(menu_command_of("Undo"), None);
        assert_eq!(menu_command_of("Close"), None);
        assert_eq!(menu_command_of(""), None);
    }
}
