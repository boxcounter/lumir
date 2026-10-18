//! Lumir Rust core — M0 空壳骨架。
//!
//! 职责分层（ADR 0002 第 3 条）：Rust core 承担文件 IO/监听、索引/搜索、
//! link graph；webview 层只做渲染与交互，保持薄。
//! 架构约束（ADR 0002 第 7 条）：核心数据结构不深度耦合 UI 层，不堵死未来
//! 进程外 extension 隔离的可能性。本 crate 的模块均不依赖 `tauri` 类型，
//! 唯一例外是 `run()` 里与 webview 生命周期的接线。

pub mod attachment_naming;
pub mod commands;
pub mod config;
pub mod cron;
pub mod fs_io;
pub mod harness;
pub mod index;
pub mod link_graph;
pub mod logging;
pub mod reading_position;
pub mod ready;
pub mod recovery;
pub mod vault_registry;
pub mod vault_session;
pub mod window_chrome;
pub mod window_state;

#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItemBuilder, MenuItemKind};
use tauri::{Emitter, Manager};

use serde::Serialize;
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::Instant;

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
    // cron 守护的通道：发送端交给 `CronRuntime`（app state），接收端在 setup 尾部交给
    // `lumir-cron` 线程。通道先建、线程后起——任何一次 poke 在消费端就位前只是排队。
    let (cron_tx, cron_rx) = std::sync::mpsc::channel();
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
        .manage(harness::Runtime::default())
        .manage(CronRuntime::new(cron_tx))
        .invoke_handler(tauri::generate_handler![
            commands::config_get,
            commands::config_set_ui_value,
            // M301 泛化的单键合并写（任意表名；`config_set_ui_value` ≡ section="ui"）。
            commands::config_set_value,
            commands::vault_open,
            commands::vault_open_path,
            commands::vault_current,
            commands::fs_scan_workspace,
            // 按需枚举（change vault-open-ignore-set §4.3）：惰性目录展开时的一层取数。
            commands::fs_scan_dir,
            // 批量存在探测（同 change §4.11）：会话恢复与阅读位置共用。
            commands::fs_paths_exist,
            commands::fs_read_snapshot,
            commands::fs_read_attachment,
            // 剪贴板图片落盘（change paste-clipboard-image，M416）：转码 + 内容寻址命名 +
            // 全 vault 去重 + 原子写（见 fs_io::write_attachment）。
            commands::fs_write_attachment,
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
            // 图片语义命名（change add-semantic-image-naming，M577）：异步改名 + 撤销 +
            // dirty 文档的内存对账（纯函数，不写盘）。
            commands::attachment_semantic_name,
            commands::attachment_semantic_undo,
            commands::wikilink_retarget_text,
            commands::create_file,
            // 文件级操作（M244，change file-tree-context-menu；M530 起含跨目录移动）：删除 /
            // 重命名 / 移动 / 新建 / 在 Finder 中显示——只作用于 vault 内路径，判定与 IO 都在
            // fs_io 的同一套路径边界里（capabilities 零增量：自有 command 不受 ACL 门禁，
            // reveal 走 opener 的 Rust 侧 API，webview 的 opener ACL 保持默认拒绝）。
            commands::fs_trash_entry,
            commands::fs_rename_entry,
            // 跨目录移动（M530，文件树拖拽移入目录）：与上面同一套 vault 内路径边界与
            // 零增量 capabilities（自有 command 不受 ACL 门禁）。
            commands::fs_move_entry,
            commands::fs_create_file,
            commands::fs_create_dir,
            commands::fs_reveal_in_finder,
            vault_registry::vault_register,
            vault_registry::vault_remap,
            // 多 vault（M162）：列表 + 按 vault 的标签会话（前端在 M163 接）
            vault_registry::vault_list,
            vault_session::vault_session_get,
            vault_session::vault_session_put,
            // 文档阅读位置（M194，change remember-reading-position）：与标签会话分开存
            reading_position::reading_position_get,
            reading_position::reading_position_put,
            // Harness 对话运行时（M302，change add-harness-probe）：面板（m303）经
            // 命令 + `harness:event` 事件消费；LLM 调用在 `lumir-harness-llm` 专线程。
            // abort 为 M348 新增（发送钮停止态点击，design §5「不再继续」）。
            // set_thinking_effort 为 M362 新增（思考程度档位，会话内生效、不写回配置）。
            harness::harness_send,
            harness::harness_approve,
            harness::harness_abort,
            harness::harness_new_session,
            harness::harness_state,
            harness::harness_set_thinking_effort,
            harness::harness_resume_session,
            // 历史会话列举（M395，change reshape-harness-session-recording 任务 2.1）：
            // 面板会话选择器的数据源，过滤与恢复命令同一 vault 归属口径。
            harness::harness_list_sessions,
            // 历史会话删除（M406）：选择器行内删除入口的后端，活跃会话拒删。
            harness::harness_delete_session,
            // composer 粘贴图片（change harness-composer-image-paste）：harness 侧内容
            // 寻址附件的写 / 读（落点 attachments/<vault 稳定 id>/，MUST NOT 触碰 vault）。
            harness::harness_write_image,
            harness::harness_read_image,
            // composer 草稿（change composer-draft-persistence）：按 vault 一份的草稿读写
            // （落点 harness/drafts/<vault 稳定 id>.json，MUST NOT 触碰 vault；落点按当前
            // vault scope 解析，前端不传 vault——harness_write_image 同形态）。
            harness::draft::harness_draft_get,
            harness::draft::harness_draft_put,
            // 窗口底色跟随主题（M525，app-window spec）：applyTheme 的运行期同步通道。
            window_chrome::window_set_background_color,
        ])
        .setup(move |app| {
            // 诊断日志先初始化：`[log] level` 在第一条事件之前生效（level = off 时
            // 整条链路都不落盘，见 logging 模块头）。
            logging::init();
            // 注册表目录改名的一次性迁移（M248，backlog #37）：位置钉死在「配置目录已可解析
            // （logging::init 刚解析过）之后、任何注册表读者之前」——两个读者是紧随其后的
            // 启动恢复线程与前端 command（后者要等本回调返回）。同步跑完，读者看到的只有新名。
            vault_registry::migrate_legacy_registry_dir_at_startup();
            ready::emit_ready(started);
            #[cfg(target_os = "macos")]
            install_menu_overrides(app.handle())?;
            // 窗口尺寸：写侧线程先起来（防抖落盘要能收到 set_size 触发的 Resized），
            // 再施加启动尺寸并显示窗口（配置里 `visible: false`，见 apply_startup_size）。
            window_state::init();
            apply_startup_size(app.handle());
            // last_vault 自动恢复移出主线程（M159）：本回调随即返回，事件循环继续跑
            // ——窗口立即可绘制。setup 内 MUST NOT 同步做 config::load / open_vault。
            start_restore(app.handle());
            // cron 守护（change add-cron-runtime-daemon §4.1）：窗口已显示、`LUMIR_READY`
            // 已发出之后才 spawn——线程自己装载配置与去重状态，setup 不等它，冷启动
            // <300ms 合同零接触面。首次评估由紧随其后的 startup poke 触发。
            start_cron(app.handle(), cron_rx);
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
            // 拉取兜底②（change add-cron-runtime-daemon §4.2）：主窗口获得焦点时投一次 poke，
            // 判定与派发都在 `lumir-cron` 线程上跑。回调里只做一次带 200ms 去抖的通道发送
            // ——不读配置、不做 IO，焦点风暴因此不会变成多次判定。
            tauri::RunEvent::WindowEvent {
                event: tauri::WindowEvent::Focused(true),
                ..
            } => {
                app.state::<CronRuntime>().poke_focus();
            }
            // 窗口尺寸变化：只更新内存里的「最近尺寸」缓存（写盘在 `lumir-window-state`
            // 线程上防抖；位置不入档，因此**不监听 `Moved`**）。尺寸以逻辑点落盘，跨
            // Retina / 非 Retina 迁移时不随物理像素漂移。
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Resized(size),
                ..
            } => {
                if let Some(window) = app.get_webview_window(&label) {
                    let scale = window.scale_factor().unwrap_or(1.0);
                    window_state::record_size(
                        window_state::to_logical(size.width, scale),
                        window_state::to_logical(size.height, scale),
                    );
                }
            }
            // 退出：把诊断日志缓冲刷盘（丢掉一个批次的量会把「退出前发生了什么」抹掉，
            // 而那正是最常要查的一段）。正常退出路径都会走到这里。窗口尺寸一并 flush，
            // 兜住「最后一次缩放之后、防抖窗口内就退出」这一条路径（macOS Cmd+Q 经
            // applicationWillTerminate 到达本臂，见 window_state 模块头）。
            tauri::RunEvent::Exit => {
                logging::flush();
                window_state::flush();
            }
            _ => {}
        });
}

/// 主窗口 label：`tauri.conf.json` 的 `app.windows[0]` 未声明 `label`，走 tauri 的默认值
/// `"main"`（`tauri_utils::config` 的 `default_window_label`）。
pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

/// 施加启动尺寸并显示窗口（change startup-window-pane-defaults，design §3.3）。
///
/// 读档 → 存档尺寸（逐维钳进窗口所在显示器的工作区）/ 首启 = 工作区的 90% → `set_size`，
/// 随后 `show()`。`tauri.conf.json` 的 `1200×800` 因此**降级为占位尺寸**（窗口创建时的
/// 初值，用户看不到；也是工作区不可得时的兜底），构建配置另置 `visible: false`——窗口的
/// 显示由本函数负责，`setup` 里少一次 `show()` 就是「屏幕上什么都没有」。
///
/// **不调 `set_position` / `center()`**（裁决点 1，Alex 2026-10-10：只记尺寸）：位置由创建
/// 帧的 OS 默认放置决定，本应用不施加、不持久化、不作判据。
///
/// **自身不返回致命错误**：存档损坏 / 工作区不可得都在内部降级（记 warning），因此 `show()`
/// 一定执行。`set_size` 失败也只降级——窗口按占位尺寸出现，仍强于不出现。`show()` 成功后
/// 紧跟一次 `set_focus()` 把 app 激活到前台（见函数尾注记）。
fn apply_startup_size(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        eprintln!("lumir: 未找到主窗口，启动尺寸未施加");
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let work = work_area_size(&window);
    let size = match (window_state::load(), work) {
        // 非首启：存档尺寸（逻辑点 → 物理像素）逐维钳进工作区；不超过的原样施加。
        (Some(state), Some(work)) => {
            let stored = (
                window_state::to_physical(state.width, scale),
                window_state::to_physical(state.height, scale),
            );
            let (w, h) = window_state::clamp_to_work(stored, work);
            Some(tauri::PhysicalSize::new(w, h))
        }
        // 存档在、工作区取不到：不钳、按存档尺寸施加（spec 的降级路径，记 warning）。
        (Some(state), None) => {
            eprintln!("lumir: 取不到工作区，窗口尺寸按存档原样施加（不钳制）");
            Some(tauri::PhysicalSize::new(
                window_state::to_physical(state.width, scale),
                window_state::to_physical(state.height, scale),
            ))
        }
        // 首启（含存档损坏 / 版本不符）：工作区的 90%。
        (None, Some(work)) => {
            let (w, h) = window_state::first_launch_size(work.0, work.1);
            Some(tauri::PhysicalSize::new(w, h))
        }
        // 首启且工作区不可得：保持构建配置的占位尺寸（不调 set_size）。
        (None, None) => {
            eprintln!("lumir: 取不到工作区，窗口按构建配置的占位尺寸出现");
            None
        }
    };
    if let Some(size) = size {
        if let Err(e) = window.set_size(size) {
            eprintln!("lumir: 施加启动尺寸失败（按占位尺寸出现）：{e}");
        }
    }
    if let Err(e) = window.show() {
        eprintln!("lumir: 显示主窗口失败：{e}");
        return;
    }
    // 首启 show 后无条件激活到前台（Alex 2026-10-13）：show() 只 orderFront、不激活
    // app，命令行直接 exec 的实例（不走 LaunchServices，如验收套件的 dev 实例）启动
    // 后零激活。tao 的 set_focus 在 macOS 上做 makeKeyAndOrderFront +
    // activateIgnoringOtherApps，重复激活无害（Dock/LaunchServices 启动本就会激活）。
    // 只发生在启动落窗这一次；tao 的 set_focus 对已最小化/不可见窗口自行跳过，
    // 后续恢复路径不再调用本函数，不会重复抢前台。
    if let Err(e) = window.set_focus() {
        eprintln!("lumir: 启动激活前台失败：{e}");
    }
}

/// 窗口所在显示器的工作区尺寸（物理像素，macOS 上即 `NSScreen.visibleFrame`——已排除菜单栏
/// 与 Dock）。`current_monitor()` 取不到时回落 `primary_monitor()`；都取不到返回 `None`，
/// 由调用方走降级路径。位置不参与本 change，取工作区只用于尺寸算式与钳制。
fn work_area_size(window: &tauri::WebviewWindow) -> Option<(u32, u32)> {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())?;
    let area = monitor.work_area().size;
    Some((area.width, area.height))
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
            crate::vault_registry::mark_opened(&id);
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
    // M525：启动窗口底色（config theme → 原生窗口底色）先于恢复执行——webview JS
    // 运行前的底色由它负责，运行期由前端 applyTheme 经 window_set_background_color
    // 驱动（见 window_chrome 模块头）。
    window_chrome::apply_startup_window_background(app);
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

// ---------------------------------------------------------------------------
// cron 守护（change add-cron-runtime-daemon §4 / §5）
// ---------------------------------------------------------------------------

/// 运行交接事件名（design §6.1）：前端接线层收到后确保目标 vault 已打开、按会话形态建立 /
/// 恢复会话、经既有发送通道送出 prompt，并在终态调用 [`cron_run_result`] 回执。
const CRON_RUN_EVENT: &str = "cron:run";

/// 焦点 poke 的去抖窗口（design §4.2）：切换前台的连续事件在 200ms 内只投一次。
const FOCUS_POKE_DEBOUNCE: std::time::Duration = std::time::Duration::from_millis(200);

/// 在途运行失去回执的兜底窗口：`cron_run_result` 是终态的唯一来源，回执若丢失（前端重载 /
/// webview 崩溃），该任务会被永远判 `busy`。超过这个时长仍在册的运行视为已丢失，下一次评估
/// 清掉并落一条 warning，让任务恢复可触发——「至少一个在途运行」保护的是并发，不是永久占用。
const INFLIGHT_STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(6 * 60 * 60);

/// `lumir-cron` 守护的进程内通道 + 焦点去抖状态（`run()` 创建、`app.manage` 持有）。
///
/// 投递方（事件循环回调、`cron_run_result` 命令）只做一次通道发送——不读配置、不做 IO、
/// 不判定；判定与派发全部在 `lumir-cron` 线程上，事件循环因此不会被 cron 拖慢。
pub struct CronRuntime {
    inner: Mutex<CronRuntimeInner>,
}

struct CronRuntimeInner {
    tx: Sender<CronMessage>,
    last_focus_poke: Option<Instant>,
}

/// 投给守护线程的两类消息。
enum CronMessage {
    /// 拉取兜底的一次评估（带触发源）。
    Poke(cron::Trigger),
    /// 运行终态回执。
    RunResult(CronRunResult),
}

/// `cron_run_result` 回执载荷（design §6.1）：运行终态的**唯一**来源。成功与否只由前端在终态
/// 时交一次，Rust 不据事件流或字符串猜（REVIEW.md「同一语义两处真源」条）。
struct CronRunResult {
    run_id: String,
    ok: bool,
    session_id: Option<String>,
    error: Option<String>,
}

impl CronRuntime {
    fn new(tx: Sender<CronMessage>) -> Self {
        Self {
            inner: Mutex::new(CronRuntimeInner {
                tx,
                last_focus_poke: None,
            }),
        }
    }

    fn send(&self, message: CronMessage) {
        let inner = self.inner.lock().expect("cron runtime poisoned");
        // 线程未起 / 已退出（连接断开）：投递丢弃，业务结果不受影响。
        let _ = inner.tx.send(message);
    }

    fn poke(&self, trigger: cron::Trigger) {
        self.send(CronMessage::Poke(trigger));
    }

    /// 主窗口获得焦点：200ms 内的重复到达合并成一次（design §4.2 的焦点风暴口径）。
    fn poke_focus(&self) {
        let mut inner = self.inner.lock().expect("cron runtime poisoned");
        let debounced = inner
            .last_focus_poke
            .map(|last| last.elapsed() < FOCUS_POKE_DEBOUNCE)
            .unwrap_or(false);
        if debounced {
            return;
        }
        inner.last_focus_poke = Some(Instant::now());
        let _ = inner.tx.send(CronMessage::Poke(cron::Trigger::Focus));
    }
}

/// 拉取兜底的一次投递（启动就绪 / 主窗口获得焦点 / 目标 vault 打开成功共用同一个入口）。
pub fn cron_poke(app: &tauri::AppHandle, trigger: cron::Trigger) {
    app.state::<CronRuntime>().poke(trigger);
}

/// 运行终态回执的唯一后端入口：前端接线层的 `cron_run_result` 命令调用它。
///
/// 本函数只投递到 `lumir-cron` 线程——去重状态更新与 `cron_run_finished` 事件都由该线程
/// 唯一产出（design §6.1：终态只由回执一处产出）。
pub fn cron_run_result(
    app: &tauri::AppHandle,
    run_id: &str,
    ok: bool,
    session_id: Option<String>,
    error: Option<String>,
) {
    app.state::<CronRuntime>()
        .send(CronMessage::RunResult(CronRunResult {
            run_id: run_id.to_string(),
            ok,
            session_id,
            error,
        }));
}

/// 守护线程的一条待评估任务：配置里的任务 + 启动时解析一次的 `at` 分钟数。
#[derive(Debug, Clone)]
struct ScheduledTask {
    task: config::CronTask,
    at_minutes: u16,
}

/// 一次在途运行的登记（`run_id` → 任务与触达策略）。
struct InflightRun {
    task: String,
    delivery: config::DeliveryPolicy,
    started: Instant,
}

/// `cron:run` 交接事件的载荷（design §6.1 的逐字段形状）。`origin` 是触发源字面量；
/// 点击发起的运行由前端接线层用 `click`。
#[derive(Debug, Clone, Serialize)]
struct CronRunPayload {
    run_id: String,
    task: String,
    vault: String,
    prompt: String,
    session: String,
    model: Option<String>,
    origin: String,
}

/// 起 `lumir-cron` 线程并投一次启动评估（design §4.1 / §4.2）。
///
/// 线程自己装载配置与去重状态（文件 IO 不在事件循环 / 主线程上）；起线程失败只降级为
/// 「定时任务不启用」，绝不阻断启动。
fn start_cron(app: &tauri::AppHandle, rx: Receiver<CronMessage>) {
    let handle = app.clone();
    match std::thread::Builder::new()
        .name("lumir-cron".to_string())
        .spawn(move || cron_loop(&handle, rx))
    {
        Ok(_) => cron_poke(app, cron::Trigger::Startup),
        Err(error) => {
            eprintln!("lumir: cron 守护线程启动失败，定时任务不启用：{error}");
            logging::config_warning("cron", "守护线程启动失败，定时任务不启用");
        }
    }
}

/// 守护线程主循环：30s tick 或被 poke 唤醒后评估全部任务（design §4.1）。
fn cron_loop(app: &tauri::AppHandle, rx: Receiver<CronMessage>) {
    let snapshot = match config::load() {
        Ok(snapshot) => snapshot,
        Err(error) => {
            logging::config_warning(
                "cron",
                &format!("配置加载失败，定时任务不启用：{}", error.message),
            );
            return;
        }
    };
    // 装载期：被丢弃的任务项落结构化诊断（人话 warning 已随 ConfigSnapshot 交给前端）。
    for issue in &snapshot.cron_issues {
        logging::cron_task_invalid(&issue.task, &issue.field, &issue.reason);
    }
    let tasks: Vec<ScheduledTask> = snapshot
        .config
        .cron
        .tasks
        .iter()
        .filter_map(|task| match cron::parse_at(&task.at) {
            Ok(at_minutes) => Some(ScheduledTask {
                task: task.clone(),
                at_minutes,
            }),
            // 校验期已挡过一次；这里只防实现漂移（校验后 at 又被改坏），不静默丢。
            Err(reason) => {
                logging::cron_task_invalid(&task.id, "at", reason);
                None
            }
        })
        .collect();
    // `tasks: []` ⇒ 守护空转：不触发任何任务、不报错（spec「空任务表」）。
    if tasks.is_empty() {
        return;
    }
    let state_path = match config::config_dir() {
        Ok(dir) => cron::state_path(&dir),
        Err(error) => {
            logging::config_warning(
                "cron",
                &format!("无法确定配置目录，定时任务不启用：{}", error.message),
            );
            return;
        }
    };
    let (state, warnings) = cron::load_state(&state_path);
    for warning in warnings {
        logging::config_warning("cron-state", &warning);
    }
    let mut runner = CronRunner {
        app: app.clone(),
        tasks,
        state,
        state_path,
        inflight: std::collections::HashMap::new(),
        skipped_today: std::collections::HashMap::new(),
        last_vault: None,
    };
    loop {
        match rx.recv_timeout(cron::TICK) {
            Ok(CronMessage::Poke(trigger)) => runner.evaluate(trigger),
            Ok(CronMessage::RunResult(result)) => runner.finish(result),
            Err(RecvTimeoutError::Timeout) => runner.evaluate_tick(),
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

/// 守护线程的执行侧：判定（`cron::plan`）之外的全部副作用都在这里——投通知、发交接事件、
/// 写去重状态、落诊断事件。
struct CronRunner {
    app: tauri::AppHandle,
    tasks: Vec<ScheduledTask>,
    state: cron::CronState,
    state_path: PathBuf,
    /// 在途运行：`run_id` → 任务。同一任务同一时刻至多一个（design §6.6）。
    inflight: std::collections::HashMap<String, InflightRun>,
    /// 今日已落过 skip 的任务 → 日期（每任务每日最多一条 `cron_run_skipped`）。
    skipped_today: std::collections::HashMap<String, String>,
    /// 上一轮观察到的当前 vault 根：变化即视为「目标 vault 打开成功」的一次触发源
    /// （下面 `evaluate_tick` 的口径）。
    last_vault: Option<PathBuf>,
}

impl CronRunner {
    /// 拉取兜底 / 启动的评估（触发源由投递方给出）。
    fn evaluate(&mut self, trigger: cron::Trigger) {
        let current_vault = current_vault_root(&self.app);
        self.evaluate_with(trigger, current_vault);
    }

    /// 定时器评估：顺带把「当前 vault 变了」识别成一次 vault-open 拉取触发。
    ///
    /// **为什么这样接第三个触发源**：`vault_open` / `vault_open_path` 命令的成功点在
    /// `commands.rs`（不在本次改动的文件面内），本层没有可直接挂的回调；而目标 vault 变更是
    /// 「打开成功」的唯一可观察结果。代价：补判最多晚一个 tick（30s，与定时器自身粒度同量级），
    /// 且该轮按拉取触发处理（允许重试当日被跳过的任务）。命令层直接 poke 的接线属后续改动。
    fn evaluate_tick(&mut self) {
        let current_vault = current_vault_root(&self.app);
        let trigger = if current_vault != self.last_vault {
            cron::Trigger::VaultOpen
        } else {
            cron::Trigger::Timer
        };
        self.evaluate_with(trigger, current_vault);
    }

    fn evaluate_with(&mut self, trigger: cron::Trigger, current_vault: Option<PathBuf>) {
        self.last_vault = current_vault.clone();
        let current_vault = current_vault.and_then(|path| path.to_str().map(str::to_string));
        let now = cron::LocalNow::now();
        self.prune_stale_inflight();
        for index in 0..self.tasks.len() {
            let scheduled = self.tasks[index].clone();
            self.dispatch(&scheduled, &now, trigger, current_vault.as_deref());
        }
    }

    /// 清掉失去回执的在途运行（[`INFLIGHT_STALE_AFTER`]）：否则一次丢失的回执会让该任务
    /// 永久落在 `busy` 上——`busy` 保护的是并发，不该变成永久占用。
    fn prune_stale_inflight(&mut self) {
        let stale: Vec<String> = self
            .inflight
            .iter()
            .filter(|(_, run)| run.started.elapsed() > INFLIGHT_STALE_AFTER)
            .map(|(run_id, _)| run_id.clone())
            .collect();
        for run_id in stale {
            if let Some(run) = self.inflight.remove(&run_id) {
                logging::config_warning(
                    "cron",
                    &format!("任务 {} 的运行回执超时未到，已按运行丢失处理", run.task),
                );
            }
        }
    }

    /// 单任务的派发：`cron::plan` 决定做什么，这里只执行。
    fn dispatch(
        &mut self,
        scheduled: &ScheduledTask,
        now: &cron::LocalNow,
        trigger: cron::Trigger,
        current_vault: Option<&str>,
    ) {
        let task = &scheduled.task;
        let inflight = self.inflight.values().any(|run| run.task == task.id);
        let skipped_today =
            self.skipped_today.get(&task.id).map(String::as_str) == Some(now.date.as_str());
        let plan = cron::plan(&cron::PlanInput {
            task,
            at_minutes: scheduled.at_minutes,
            now,
            last_fired: self.state.last_fired(&task.id),
            current_vault,
            inflight,
            skipped_today,
            trigger,
        });
        match plan {
            cron::Plan::Idle => {}
            cron::Plan::Notify => {
                // 投递失败（通道未就绪 / 权限 / 插件错误）：不写 last_fired，下一次评估重试
                // （design §5.4）。通道未就绪时不落事件——否则每个 tick 一条噪音。
                if deliver_notification(&self.app, &task.id, "trigger").is_ok() {
                    logging::cron_notified(&task.id, "trigger", trigger.as_str());
                    self.mark_fired(&task.id, &now.date);
                }
            }
            cron::Plan::Handoff => self.handoff(scheduled, trigger, now),
            cron::Plan::Skip(reason) => self.record_skip(&task.id, &now.date, reason),
        }
    }

    /// 发起运行交接：`cron:run` 投递成功即视为「交接被接受」，随后写 `last_fired`。
    fn handoff(&mut self, scheduled: &ScheduledTask, trigger: cron::Trigger, now: &cron::LocalNow) {
        let task = &scheduled.task;
        if self.app.get_webview_window(MAIN_WINDOW_LABEL).is_none() {
            self.record_skip(&task.id, &now.date, cron::SkipReason::NotReady);
            return;
        }
        let run_id = cron::new_run_id();
        let payload = CronRunPayload {
            run_id: run_id.clone(),
            task: task.id.clone(),
            vault: task.vault.clone(),
            prompt: task.prompt.clone(),
            session: task.session.as_str().to_string(),
            model: task.model.clone(),
            origin: trigger.as_str().to_string(),
        };
        match self.app.emit(CRON_RUN_EVENT, payload) {
            Ok(()) => {
                self.inflight.insert(
                    run_id,
                    InflightRun {
                        task: task.id.clone(),
                        delivery: task.delivery,
                        started: Instant::now(),
                    },
                );
                self.mark_fired(&task.id, &now.date);
                logging::cron_run_started(
                    &task.id,
                    trigger.as_str(),
                    task.session.as_str(),
                    task.model.as_deref(),
                );
            }
            Err(_) => self.record_skip(&task.id, &now.date, cron::SkipReason::NotReady),
        }
    }

    /// 运行终态回执：更新会话 id 并落**唯一**一条 `cron_run_finished`。
    fn finish(&mut self, result: CronRunResult) {
        let Some(run) = self.inflight.remove(&result.run_id) else {
            logging::config_warning(
                "cron",
                &format!("收到未知 run_id（{}）的运行回执，已忽略", result.run_id),
            );
            return;
        };
        if result.session_id.is_some() {
            self.state
                .set_session(&run.task, result.session_id.as_deref());
            self.persist_state();
        }
        // 终态的唯一产出点（design §6.1 / §11）：成功与否只来自这次回执。
        logging::cron_run_finished(&run.task, result.ok, result.error.as_deref());
        // `run-then-notify` 的结果通知在终态之后（design §5.2）；通知通道未就绪时这次投递
        // 失败，但不改变终态判定，也不触发重跑（当日已写 last_fired）。
        if run.delivery == config::DeliveryPolicy::RunThenNotify {
            let _ = deliver_notification(&self.app, &run.task, "result");
        }
    }

    /// 派发成功后的唯一写入口：内存先改、随后原子落盘；写失败降级为 warning（最多导致一次
    /// 重复触发，design §8 接受）。
    fn mark_fired(&mut self, task: &str, date: &str) {
        self.state.mark_fired(task, date);
        self.persist_state();
    }

    fn persist_state(&mut self) {
        if let Err(reason) = cron::save_state(&self.state_path, &self.state) {
            logging::config_warning(
                "cron-state",
                &format!("{reason}，本次触发状态未落盘（最多导致一次重复触发）"),
            );
        }
    }

    /// 当次不派发的诊断：每任务每日最多一条（多个拉取触发反复重试时不再重复写日志）。
    fn record_skip(&mut self, task: &str, date: &str, reason: cron::SkipReason) {
        if self.skipped_today.get(task).map(String::as_str) == Some(date) {
            return;
        }
        self.skipped_today
            .insert(task.to_string(), date.to_string());
        logging::cron_run_skipped(task, reason.as_str());
    }
}

/// 当前打开的 vault 根（未打开 / 状态不可读时为 `None`）。读的是 `VaultState` 的内存快照，
/// 不碰磁盘；每轮评估至多一次。
fn current_vault_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.state::<commands::VaultState>()
        .root_and_policy()
        .ok()
        .map(|(root, _policy)| root)
}

/// 通知投递端口（design §9：副作用以回调形式注入，判定层不知道通知存在）。
///
/// 系统通知中心的投递与常驻点击监听依赖 `tauri-plugin-notification`，由 change 的通知链路
/// 任务接入；在本层它返回「通道未就绪」——`notify-then-run` 因此不写 `last_fired`、下一次
/// 评估重试（design §5.4 的投递失败口径），`run-then-notify` 的结果通知落空但终态照常记录。
///
/// 文案口径（design §5 / §6）：标题 = 任务 id，正文只用通用文案（到点 / 已完成 / 运行失败），
/// MUST NOT 含 prompt、文档内容或绝对路径——通知会出现在锁屏与通知中心。
fn deliver_notification(
    _app: &tauri::AppHandle,
    _task: &str,
    _kind: &str,
) -> Result<(), &'static str> {
    Err("notification_channel_unavailable")
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

#[cfg(test)]
mod cron_runtime_tests {
    use std::path::Path;

    /// 终态唯一产出点（change add-cron-runtime-daemon §5.2）：`cron_run_finished` 只允许在
    /// 回执处理一处调用。扫 `src-tauri/src` 下的全部 `.rs` 源码（运行期读盘、不枚举清单），
    /// 新增第二个产出点即判红——不靠人读代码，也不把「单点」钉在某个函数的形状上。
    ///
    /// needle 用 `concat!` 拼出：本测试自身的源码不含完整字面量，因此不会自我命中。
    #[test]
    fn cron_run_finished_has_a_single_production_point() {
        let needle = concat!("logging::", "cron_run_finished");
        let mut hits = Vec::new();
        collect_source_hits(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
            needle,
            &mut hits,
        );
        assert_eq!(
            hits.len(),
            1,
            "终态只能由 cron_run_result 回执一处产出，实际命中：{hits:?}"
        );
        assert!(
            hits[0].contains("/lib.rs:"),
            "唯一的产出点应在 lib.rs 的回执处理里：{hits:?}"
        );
    }

    fn collect_source_hits(dir: &Path, needle: &str, hits: &mut Vec<String>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_source_hits(&path, needle, hits);
                continue;
            }
            if path.extension().and_then(|extension| extension.to_str()) != Some("rs") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            for (index, line) in text.lines().enumerate() {
                if line.contains(needle) {
                    hits.push(format!("{}:{}", path.display(), index + 1));
                }
            }
        }
    }
}
