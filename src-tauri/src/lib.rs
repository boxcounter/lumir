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
pub mod notify;
pub mod reading_position;
pub mod ready;
pub mod recovery;
pub mod settings;
pub mod vault_registry;
pub mod vault_session;
pub mod window_chrome;
pub mod window_state;

#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItemBuilder, MenuItemKind};
use tauri::{Emitter, Manager};

use std::path::{Path, PathBuf};
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

/// 自定义「全选」菜单项 id（M627）：见 install_menu_overrides / swap_select_all_item。
#[cfg(target_os = "macos")]
const SELECT_ALL_MENU_ID: &str = "lumir.select_all";

/// 自定义「键位速查」菜单项 id（change improve-keybindings-lookup-oct24）：Help 子菜单的
/// 非自指入口。见 add_keyboard_shortcuts_item。
#[cfg(target_os = "macos")]
const KEYBOARD_SHORTCUTS_MENU_ID: &str = "lumir.keyboard_shortcuts";

/// 自定义「设置…」菜单项 id（change add-model-automation-settings-oct24 tasks §5.1）：应用
/// 菜单（第一个子菜单）里的鼠标入口。见 add_settings_item。
#[cfg(target_os = "macos")]
const SETTINGS_MENU_ID: &str = "lumir.settings";

/// 菜单命令事件名（M131）：前端 main.ts 订阅它，把菜单点击交给统一键位层的命令实现。
/// 载荷见 menu_command_of（菜单只说 undo / redo 这类平台术语，映射到前端命令 id 是前端的事）。
#[cfg(target_os = "macos")]
const MENU_COMMAND_EVENT: &str = "app:menu_command";

/// 启动 Tauri app。
pub fn run() {
    let started = std::time::Instant::now();
    let _ = PROCESS_STARTED.set(started);
    // cron 守护的通道：发送端交给 `CronRuntime`（app state），接收端在 setup 尾部交给
    // `lumir-cron` 线程。通道先建、线程后起——任何一次 poke 在消费端就位前只是排队。
    let (cron_tx, cron_rx) = std::sync::mpsc::channel();
    // 通知平台层（change add-cron-notification-relaunch §3）：delegate 必须在这个入口装，
    // 也就是**应用完成启动之前**（Apple 合同：否则「导致应用被启动的通知」响应会丢）。
    // 安装路径零 IO、零跨进程查询（ADR 0002 第 6 条）；失败只降级为 warning——MUST NOT 阻断
    // 启动与投递。macOS 上点击接收只有 delegate 一条通道，装不上时点击（进程内与跨进程）
    // 一起不可用，不声称存在第二条路。
    if let Err(error) = notify::install_delegate() {
        // **不能在这里落日志**：`logging::global()` 的首次初始化会同步解析配置目录并读配置
        // 文件，而这一段是 design §3 的「安装路径零 IO」区间（ADR 0002 第 6 条冷启动）。
        // 先把话存起来，由 `lumir-cron` 线程在 `logging::init()` 之后补落。
        defer_startup_warning(format!("通知 delegate 未能安装，点击接收不可用：{error}"));
    }
    // 平台层收到响应后的唤醒通道：只做一次 mpsc 发送（`didReceive` 跑在主线程 run loop 上，
    // 那里不能做 IO 或等待）。注册在这里而不是线程里，覆盖「响应早于守护线程启动」的窗口。
    {
        let wake_tx = cron_tx.clone();
        notify::set_waker(Box::new(move || {
            let _ = wake_tx.send(CronMessage::DrainClicks);
        }));
    }
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
            // 设置面板的窄接口读写（change add-model-automation-settings-oct24 tasks §3）：
            // 读只回设置面快照（Key 只带末 4 位），写走强类型 patch + 锁内 CAS（revision）。
            commands::settings_get,
            commands::settings_apply,
            commands::vault_open,
            commands::vault_open_path,
            commands::vault_current,
            commands::fs_scan_workspace,
            // 按需枚举（change vault-open-ignore-set §4.3）：惰性目录展开时的一层取数。
            commands::fs_scan_dir,
            // 批量存在探测（同 change §4.11）：会话恢复与阅读位置共用。
            commands::fs_paths_exist,
            commands::fs_read_snapshot,
            // vault 外只读读取通道（change quick-open-file-oct23 的 fs-io ADDED）：只服务
            // quick-open 的 vault 外只读会话，绝对路径 + 常规文件 + 50MB 上限全部在 Rust 侧。
            commands::fs_read_external,
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
            // 列表移除与撤销（M646，change vault-and-session-removal）：只删注册表项，
            // 盘上的 vault 内容与 per-id 数据一概不动；撤销按原值写回。
            vault_registry::vault_remove,
            vault_registry::vault_restore,
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
            // 权限浮层的「已记住的规则」删除钮（change harness-permission-rules-oct23 A1）：
            // 规则写回走后端单写者（Q5 裁决），前端不做数组读改写。
            harness::harness_permission_rule_remove,
            harness::harness_abort,
            harness::harness_new_session,
            harness::harness_state,
            // 子代理任务面板的接线面（change add-harness-subagents tasks §10.2 / §10.8）：
            // 单 run 停止、自动回合触顶后的「继续」。实现体在 subagents 中枢，命令只
            // 解析 scope——面板是这些动作的唯一消费者。
            harness::harness_subagent_stop,
            harness::harness_subagent_continue,
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
            // cron 运行交接（change add-cron-runtime-daemon §3.3）：前端接线层的唯一发送入口，
            // 与 harness_send 共用运行实现；`cron_run_result` 是运行终态的唯一回执入口。
            harness::harness_cron_run,
            commands::cron_run_result,
            // 前端 cron 接线层就绪（`cron:run` 监听器已装好）：置位后补一次启动触发，
            // 补跑启动早期因监听器不在场而被 `not_ready` 延后的无人值守运行。
            commands::cron_bridge_ready,
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
                // 仍保留的点击（界面未就绪）在退出前按 `not_ready` 收尾：保留只活在进程内，
                // 进程走了就再没有重放的机会（§6「进程退出即丢弃」）。
                app.state::<CronRuntime>().send(CronMessage::FlushNotReady);
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
/// （M131）、关闭项让位（M149）、全选让位（M627）与键位速查入口
/// （change improve-keybindings-lookup-oct24）五处手术，改完统一 set_menu。
///
/// 为什么合成一个入口：改造都要基于 tauri 默认菜单做增删，各自 `Menu::default()`
/// 再 set_menu 会让后装的那次覆盖掉前一次（退出守卫会静默失效）。返回值语义沿旧例——
/// 只要有一处真改动了就 set_menu，全部因结构假设不成立而放弃时保留默认菜单。
#[cfg(target_os = "macos")]
fn install_menu_overrides(app: &tauri::AppHandle) -> tauri::Result<()> {
    let menu = Menu::default(app)?;
    let quit_guarded = guard_quit_item(&menu, app)?;
    let undo_redo_swapped = swap_undo_redo_items(&menu, app)?;
    let close_swapped = swap_close_window_items(&menu, app)?;
    let select_all_swapped = swap_select_all_item(&menu, app)?;
    let shortcuts_added = add_keyboard_shortcuts_item(&menu, app)?;
    let settings_added = add_settings_item(&menu, app)?;
    if quit_guarded
        || undo_redo_swapped
        || close_swapped
        || select_all_swapped
        || shortcuts_added
        || settings_added
    {
        app.set_menu(menu)?;
    }
    Ok(())
}

/// Help → **Keyboard Shortcuts**（change improve-keybindings-lookup-oct24）：键位面板的
/// 非自指入口——面板自己的 `⌘/` 只写在面板里面，要找到「告诉你快捷键是什么」的面板不能
/// 先知道它的快捷键。
///
/// **不带 accelerator**：任何菜单键等价都会在 NSApplication 分发阶段截获物理键——既会让
/// `⌘/` 的 `[keys]` 重绑变成假开关（菜单仍按旧键触发），也会形成「一个 token 两条分发
/// 映射」（M131 / M149 / M627 是同一机制的三次实证）。键位仍只由 `src/keys.ts` 的
/// `app.describe-bindings` 一条绑定承担；菜单点击经 MENU_COMMAND_EVENT 回到前端同一条
/// 命令层（`app.describe-bindings` 的 toggle），MUST NOT 另开分发路径或第二个面板实例。
///
/// 文案锁 en（与原生 File / Edit / Help 一致，先例 D149–D151）。结构性假设（tauri 2.12.4
/// `Menu::default`）：Help 子菜单文案为 "Help"；校验失败即保持默认菜单并打 stderr。
/// 返回是否追加了菜单项。
#[cfg(target_os = "macos")]
fn add_keyboard_shortcuts_item<R: tauri::Runtime>(
    menu: &Menu<R>,
    app: &tauri::AppHandle<R>,
) -> tauri::Result<bool> {
    let help = menu.items()?.into_iter().find_map(|item| match item {
        MenuItemKind::Submenu(submenu)
            if submenu.text().map(|text| text == "Help").unwrap_or(false) =>
        {
            Some(submenu)
        }
        _ => None,
    });
    let Some(help) = help else {
        eprintln!(
            "lumir: keyboard shortcuts menu not installed: Menu::default() has no Help submenu (tauri menu structure changed)"
        );
        return Ok(false);
    };
    let item =
        MenuItemBuilder::with_id(KEYBOARD_SHORTCUTS_MENU_ID, "Keyboard Shortcuts").build(app)?;
    help.append(&item)?;
    Ok(true)
}

/// App 菜单 → **Settings…**（change add-model-automation-settings-oct24 tasks §5.1）：设置面板的
/// 鼠标入口。**不带 accelerator**——菜单键等价会在 NSApplication 分发阶段截获物理键，`⌘,` 的
/// `[keys]` 重绑会因此变成假开关（M131 / M149 / M627 同一机制的三次实证）；键位仍只由
/// `src/keys.ts` 的 `app.settings-open` 一条绑定承担。点击经 MENU_COMMAND_EVENT 回到前端同一条
/// 命令层（`app.settings-open` 的 toggle），MUST NOT 另开分发路径或第二个面板实例。
///
/// 文案锁 en（与原生菜单 File / Edit / Help 及 "Keyboard Shortcuts" 一致，先例 D149–D151）。
/// 结构性假设（tauri 2.12.4 `Menu::default`）：macOS 上第一个菜单项是应用子菜单，其前两项是
/// About 与分隔符（`menu.rs:182-196`）——本项插在 About 之后的 macOS 惯例位置（index 2）；
/// 结构不符即保持默认菜单并打 stderr，`⌘,` 与命令仍可用。
#[cfg(target_os = "macos")]
fn add_settings_item<R: tauri::Runtime>(
    menu: &Menu<R>,
    app: &tauri::AppHandle<R>,
) -> tauri::Result<bool> {
    let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() else {
        eprintln!(
            "lumir: settings menu not installed: Menu::default() has no app submenu (tauri menu structure changed)"
        );
        return Ok(false);
    };
    let items = app_menu.items()?;
    if items.len() < 2 {
        eprintln!(
            "lumir: settings menu not installed: app submenu has {} items (tauri menu structure changed)",
            items.len()
        );
        return Ok(false);
    }
    let item = MenuItemBuilder::with_id(SETTINGS_MENU_ID, "Settings…").build(app)?;
    app_menu.insert(&item, 2)?;
    Ok(true)
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

/// 全选菜单项让位（M627）：把 **Edit** 子菜单的**预置** Select All 换成不带加速键的自定义项，
/// 点击经 MENU_COMMAND_EVENT 交回前端统一命令层。
///
/// 为什么必须换：预置 SelectAll 在 macOS 上自带 key equivalent ⌘A（muda 的
/// `PredefinedMenuItemType::SelectAll => Accelerator::new(Some(CMD_OR_CTRL), Code::KeyA)`，
/// 见 items/predefined.rs 的 accelerator()，经 platform_impl/macos 落到 NSMenuItem）。菜单键
/// 等价在 NSApplication 分发阶段就被截获，webview 的 keydown 收不到 ⌘A——与 M131 的
/// ⌘Z / ⇧⌘Z、M149 的 ⌘W 完全同一机制。M627 之前 ⌘A 全靠引擎原生 selectAll 兜底：编辑器
/// 内容恰好对，harness composer（混排 contenteditable，含原子卡片）选不到全文
///（Alex 2026-10-23 报告）。让出该键后 ⌘A 回到统一键位层的 `text` 作用域命令，按事件目标
/// 分派（编辑器 → CM 全选；composer → composer 全选），菜单点击走同一条命令。
///
/// 结构性假设（tauri 2.11.5 `menu::Menu::default` 源码）：Edit 子菜单为
/// [Undo, Redo, 分隔符, Cut, Copy, Paste, SelectAll]，SelectAll 在末位；预置项文案为
/// "Select All"（muda 对 macOS 不带助记符 `&`）。校验失败即跳过并打 stderr 警告，绝不在
/// 结构变化时盲目删项。返回是否做了替换。
#[cfg(target_os = "macos")]
fn swap_select_all_item<R: tauri::Runtime>(
    menu: &Menu<R>,
    app: &tauri::AppHandle<R>,
) -> tauri::Result<bool> {
    let submenu = menu.items()?.into_iter().find_map(|item| match item {
        MenuItemKind::Submenu(submenu)
            if submenu.text().map(|text| text == "Edit").unwrap_or(false) =>
        {
            Some(submenu)
        }
        _ => None,
    });
    let Some(submenu) = submenu else {
        eprintln!(
            "lumir: select all menu not installed: Menu::default() has no Edit submenu (tauri menu structure changed)"
        );
        return Ok(false);
    };
    let items = submenu.items()?;
    let Some(MenuItemKind::Predefined(select_all)) = items.last() else {
        eprintln!(
            "lumir: select all menu not installed: Edit submenu last item is not a predefined item (tauri menu structure changed)"
        );
        return Ok(false);
    };
    let text = select_all.text().unwrap_or_default();
    if !is_select_all_item_text(&text) {
        eprintln!(
            "lumir: select all menu not installed: Edit submenu last item text {text:?} is not Select All (tauri menu structure changed)"
        );
        return Ok(false);
    }
    // 文案沿用原生（"Select All"），加速键刻意不设——设了就等于把 ⌘A 又截走。
    let item = MenuItemBuilder::with_id(SELECT_ALL_MENU_ID, text).build(app)?;
    submenu.remove_at(items.len() - 1)?;
    submenu.append(&item)?;
    Ok(true)
}

/// 判断菜单项文案是否为原生 Select All 项：muda 对 macOS 给出 "Select All"（Windows/Linux
/// 为 "Select &All"，一并接受，便于将来跨平台时不静默退化）。纯函数，供
/// swap_select_all_item 删项前校验。
#[cfg(target_os = "macos")]
fn is_select_all_item_text(text: &str) -> bool {
    text == "Select All" || text == "Select &All"
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
/// undo / redo / close / describe-bindings，映射到前端命令 id 是前端的事——Rust 侧不持有
/// 前端的命令命名。
#[cfg(target_os = "macos")]
fn menu_command_of(id: &str) -> Option<&'static str> {
    match id {
        UNDO_MENU_ID => Some("undo"),
        REDO_MENU_ID => Some("redo"),
        // File 与 Window 两个子菜单的关闭项做同一个动作（关当前标签），因此同一个载荷。
        CLOSE_MENU_ID | CLOSE_WINDOW_MENU_ID => Some("close"),
        // M627：全选（原预置 SelectAll 让出 ⌘A 后，菜单点击仍要能全选；落哪个面由前端按
        // 当前焦点决定）。
        SELECT_ALL_MENU_ID => Some("selectAll"),
        // change improve-keybindings-lookup-oct24：Help 菜单的键位速查入口。载荷刻意用
        // 前端命令 id 本身（`describe-bindings` 是 app.describe-bindings 的后半段）——
        // 前端 MENU_COMMANDS 把它接到同一条 toggle 上。
        KEYBOARD_SHORTCUTS_MENU_ID => Some("describe-bindings"),
        // change add-model-automation-settings-oct24：Settings… 与 ⌘, 走同一条命令实现
        // （前端 MENU_COMMANDS 把它接到 app.settings-open 的 toggle 上）。
        SETTINGS_MENU_ID => Some("settings"),
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
            // 启动恢复也是「目标 vault 打开成功」的一次（design §4.2 第三行），与用户打开
            // 同一条触发源：提交成功后直接 poke。恢复线程与 `lumir-cron` 线程的启动先后不
            // 确定，启动 poke 可能早于这次提交；缺这一次，启动那一刻被 `not_ready` 延后的
            // 无人值守任务要等到下一次焦点切换才补跑（当日已落过 skip 的任务在定时器触发下
            // 不重试）。
            crate::cron_poke(&self.app, crate::cron::Trigger::VaultOpen);
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

/// 运行终态事件名（change add-cron-runtime-daemon §3.3）：前端收到后以 `cron_run_result`
/// 回执。终态由运行线程在 `turn::run_turn` 返回时投递，事件只承载读数、不判定。
pub(crate) const CRON_RUN_FINISHED_EVENT: &str = "cron:run_finished";

/// 点击结果通知后「恢复该次运行的会话」（design §5.2）。
const CRON_OPEN_SESSION_EVENT: &str = "cron:open_session";

/// 人话提示事件（点击链路任一步失败时给用户一条可见反馈，design §4.5「MUST NOT 静默」）。
const CRON_NOTICE_EVENT: &str = "cron:notice";

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
    /// 前端接线层已就绪（main.ts 的 `cron:run` 监听器已在场）：未就绪时无人值守运行按
    /// `not_ready` 延后——启动早期的交接事件会在 webview JS 订阅之前被静默丢弃。
    bridge_ready: std::sync::atomic::AtomicBool,
}

struct CronRuntimeInner {
    tx: Sender<CronMessage>,
    last_focus_poke: Option<Instant>,
}

/// 投给守护线程的四类消息。
enum CronMessage {
    /// 拉取兜底的一次评估（带触发源）。
    Poke(cron::Trigger),
    /// 运行终态回执。
    RunResult(CronRunResult),
    /// 平台层收到了通知响应（只有 request id）：取走进程内缓冲里的响应并按接收判据处置。
    ///
    /// 载荷刻意只有 id——任务 / 种类 / 快照会话由守护线程按 request id 从**进程内上下文表**或
    /// **台账**取回（§5.2：两条通道交出同一形状，MUST NOT 把入口简化成「只传任务 id」）。
    DrainClicks,
    /// 前端接线层已就绪：重放「界面未就绪时保留」的点击，并补一次启动触发。
    BridgeReady,
    /// 进程即将退出：把仍保留的点击按 `not_ready` 收尾（尽力而为，见 `flush_pending_click`）。
    FlushNotReady,
    /// 任务表可能变了：重读配置并替换任务集（change add-cron-conversational-registration
    /// design §3.1）。**载荷为空**——配置是唯一真源，带任务载荷等于在进程里放第二份任务表。
    /// `ack` 是一次性回执：工具侧 `recv_timeout` 等它，把「已生效 / 未确认」如实写进回执。
    Reload { ack: Sender<cron::ReloadOutcome> },
}

/// 工具侧等待重载回执的上限（design §3.1）：工具跑在 LLM 线程上，不阻塞 UI；线程处理一次
/// 重载只是一次小文件读。超时即 `pending_restart`（配置已写入是事实，不回滚）。
const RELOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(1);

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
            bridge_ready: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// 前端接线层就绪（`cron_bridge_ready` 命令）：置位并投一次 `BridgeReady`（重放保留的点击
    /// + 补跑启动早期因「监听器不在场」被延后的无人值守运行）。
    fn mark_bridge_ready(&self) {
        use std::sync::atomic::Ordering;
        if self.bridge_ready.swap(true, Ordering::SeqCst) {
            return;
        }
        self.send(CronMessage::BridgeReady);
    }

    fn is_bridge_ready(&self) -> bool {
        self.bridge_ready.load(std::sync::atomic::Ordering::SeqCst)
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

    /// 投一次重载并等回执（design §3.1）：`None` = 线程不在 / 超时（配置已写入，运行时未确认）。
    fn reload(&self) -> Option<cron::ReloadOutcome> {
        let (ack, reply) = std::sync::mpsc::channel();
        self.send(CronMessage::Reload { ack });
        reply.recv_timeout(RELOAD_TIMEOUT).ok()
    }
}

/// 调度工具端口的 tauri 实现（change add-cron-conversational-registration tasks 2.2）：
/// 落盘逻辑与「什么是一条合法任务」都在 `cron.rs`（无 tauri 依赖），本结构只补两件接线层才有
/// 的东西——配置目录解析与重载通道。
pub struct CronToolPort {
    app: tauri::AppHandle,
}

impl CronToolPort {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }

    fn config_path() -> Result<PathBuf, cron::CronToolError> {
        config::config_dir()
            .map(|dir| dir.join("config.json"))
            .map_err(cron::CronToolError::from_command_error)
    }

    /// 写后投重载：只有线程回执确认（且没有失败原因）才算 `active`（design §2.4 / §3.8）。
    ///
    /// 第三项是线程在本次重载里读到的通知权限快照（M635）：注册回执据它判断要不要在回复里
    /// 明说「通知送不出去」。回执丢了（超时 / 线程不在）⇒ `Unknown`——注册不声称一个没读到的
    /// 结论。
    fn reload_effect(&self) -> (cron::CronEffect, Vec<String>, cron::NotifyPermission) {
        let outcome = self.app.state::<CronRuntime>().reload();
        if outcome.is_none() {
            // ack 超时 / 线程不在：配置已写入是事实（不回滚），但运行时未确认要留痕。
            logging::config_warning(
                "cron",
                "任务集重载未在 1s 内得到确认：配置已写入，运行时未确认（下次启动生效）",
            );
        }
        // 刚写完配置却重载出空任务集：文件可能在写入后被外部改掉。回执仍是 active
        //（线程确实按文件当下内容重载了），但留一条可诊断的 warning。
        if let Some(outcome) = &outcome {
            if outcome.error.is_none() && outcome.applied == 0 {
                logging::config_warning("cron", "任务集重载后为空（配置可能在写入后被外部修改）");
            }
        }
        let (effect, seeded) = cron::effect_of(outcome.as_ref());
        let permission = outcome
            .as_ref()
            .map(|outcome| outcome.notify_permission)
            .unwrap_or(cron::NotifyPermission::Unknown);
        (effect, seeded, permission)
    }
}

impl cron::CronPort for CronToolPort {
    fn create(
        &self,
        draft: cron::CronTaskDraft,
    ) -> Result<cron::CronCreateOutcome, cron::CronToolError> {
        let task = cron::create_task_at(&Self::config_path()?, &draft)?;
        let (effect, seeded, notify_permission) = self.reload_effect();
        let notice = cron::registration_notice(
            task.delivery,
            notify_permission,
            crate::commands::current_ui_language(),
        );
        Ok(cron::CronCreateOutcome {
            skip_today: seeded.iter().any(|id| id == &task.id),
            task,
            effect,
            notice,
        })
    }

    fn list(&self) -> Result<Vec<cron::CronTaskSummary>, cron::CronToolError> {
        let config_path = Self::config_path()?;
        let config_dir = config_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        Ok(cron::list_tasks_at(
            &config_path,
            &cron::state_path(&config_dir),
        ))
    }

    fn remove(&self, id: &str) -> Result<cron::CronRemoveOutcome, cron::CronToolError> {
        cron::remove_task_at(&Self::config_path()?, id)?;
        let (effect, _seeded, _permission) = self.reload_effect();
        Ok(cron::CronRemoveOutcome {
            id: id.to_string(),
            effect,
        })
    }
}

/// 拉取兜底的一次投递（启动就绪 / 主窗口获得焦点 / 目标 vault 打开成功共用同一个入口）。
pub fn cron_poke(app: &tauri::AppHandle, trigger: cron::Trigger) {
    app.state::<CronRuntime>().poke(trigger);
}

/// 前端接线层就绪（main.ts 装好 `cron:run` 监听器之后调用一次）：置位并补一次启动触发。
/// 未就绪期间的无人值守派发被 `cron::plan` 以 `not_ready` 延后，这一步是补跑入口。
pub fn cron_bridge_ready(app: &tauri::AppHandle) {
    app.state::<CronRuntime>().mark_bridge_ready();
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

/// 守护线程的一条待评估任务（形态与构造点归 `cron::ScheduledTask` / `cron::schedule_of`：
/// 启动装载与运行期重载共用同一段 `parse_at` + vault 路径规范化）。
type ScheduledTask = cron::ScheduledTask;

/// 一次在途运行的登记（`run_id` → 任务与触达策略）。
struct InflightRun {
    task: String,
    delivery: config::DeliveryPolicy,
    trigger: cron::Trigger,
    started: Instant,
}

// `cron:run` 的载荷形状是 `cron::Handoff`（RunSpec + 任务载荷，change add-harness-subagents
// design §2.4）：合成点在 `cron::handoff` 纯函数，本接线层只做 emit。

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
///
/// **空任务表不再退出线程**（change add-cron-conversational-registration design §3.2）：
/// 空表只是空转（零派发、零报错），否则运行期注册的任务没有消费者。
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
    let (tasks, drift) = cron::schedule_of(&snapshot.config.cron.tasks);
    for issue in &drift {
        // 校验期已挡过一次；这里只防实现漂移（校验后 at 又被改坏），不静默丢。
        logging::cron_task_invalid(&issue.task, &issue.field, &issue.reason);
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
    let loop_max = snapshot.config.harness.loop_max;
    let mut runner = CronRunner {
        app: app.clone(),
        tasks,
        state,
        state_path,
        loop_max,
        inflight: std::collections::HashMap::new(),
        skipped_today: std::collections::HashMap::new(),
        clicked_today: std::collections::HashMap::new(),
        delivery_retry: std::collections::HashMap::new(),
        cached_vault: None,
        notify_failures: cron::NotifyFailureStreak::default(),
        in_process: std::collections::VecDeque::new(),
        pending_click: cron::DeferredClick::default(),
    };
    // 通知权限（design §4.3）：**有有效任务时**检查一次；未决定申请一次；被拒落一条 warning
    // 且不反复申请。空表不检查——运行期注册引入的任务由重载补检（design §3.3 第 6 步）。
    if !runner.tasks.is_empty() {
        ensure_notification_permission();
    }
    // 启动期攒下的告警（装 delegate 失败这类）：**在这里**落，不在 `run()` 入口落——
    // 那时 logging 还没初始化，落一条 warning 会带进配置 IO（r1 P2-3）。
    flush_startup_warnings();
    // 启动期缓冲的响应（delegate 可能在 setup / 线程启动之前就回调）：装载完成后按到达顺序
    // 取走处理。这是「无主响应落点」的唯一消费者（§5「为什么先缓冲」）。
    runner.drain_platform_responses();
    loop {
        match rx.recv_timeout(cron::TICK) {
            Ok(CronMessage::Poke(trigger)) => runner.evaluate(trigger),
            Ok(CronMessage::RunResult(result)) => runner.finish(result),
            Ok(CronMessage::DrainClicks) => runner.drain_platform_responses(),
            Ok(CronMessage::BridgeReady) => {
                runner.replay_pending_click();
                runner.evaluate(cron::Trigger::Startup);
            }
            Ok(CronMessage::FlushNotReady) => runner.flush_pending_click(),
            Ok(CronMessage::Reload { ack }) => runner.reload(ack),
            Err(RecvTimeoutError::Timeout) => runner.evaluate(cron::Trigger::Timer),
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

/// 一次通知点击的去重状态（repeat-click 幂等）：日期 + 该次运行回执带回的会话 id。
type ClickState = cron::ClickedNotice;

/// 进程内上下文表的上限：投递点登记的「这条通知是发给谁的」。
///
/// 点击只可能落在最近几条通知上（更早的要么被系统清掉，要么走跨进程台账），因此表必须有界——
/// 无界就等于给每一条历史通知留一份内存。
const IN_PROCESS_CLICKS: usize = 64;

/// 守护线程的执行侧：判定（`cron::plan`）之外的全部副作用都在这里——投通知、发交接事件、
/// 写去重状态、落诊断事件。
struct CronRunner {
    app: tauri::AppHandle,
    tasks: Vec<ScheduledTask>,
    state: cron::CronState,
    state_path: PathBuf,
    /// 运行交接契约里的轮次预算（`[harness].loop_max`）：启动装载时取一次，**随运行期重载
    /// 更新**（change add-cron-conversational-registration tasks 3.7——重载读的是文件当下内容，
    /// 与配置读数绑定的运行参数一起换）。交接载荷是这次运行的唯一预算来源。
    loop_max: u32,
    /// 在途运行：`run_id` → 任务。同一任务同一时刻至多一个（design §6.6）。
    inflight: std::collections::HashMap<String, InflightRun>,
    /// 今日已落过 skip 的任务 → 日期（每任务每日最多一条 `cron_run_skipped`）。
    skipped_today: std::collections::HashMap<String, String>,
    /// 今日点击过的通知（repeat-click 幂等，design §5.1 / §4.6）：记录本次点击的日期与该次
    /// 运行的会话 id（回执带回才写）。同日第二次点击只聚焦 / 打开已有会话，不重复运行。
    clicked_today: std::collections::HashMap<String, ClickState>,
    /// 投递失败的重试节奏（M637）：任务 → 退避状态。失败仍不写 `last_fired`（design §5.4 的
    /// 语义不变），变的是重试间隔与日志量——指数退避、当日上限、只在第一次失败与当日放弃时
    /// 各落一条 warning。成功投递即删除条目。
    delivery_retry: std::collections::HashMap<String, cron::DeliveryRetry>,
    /// 当前 vault 规范化比较键的缓存：`(原始根, 规范化键)`。`canonicalize` 只在原始根变化时
    /// 做一次（macOS `/tmp` → `/private/tmp` 软链下，配置路径与 vault 根可能只差这一层），
    /// 定时器 tick 的常规路径因此仍是纯内存比较（tasks.md 2.4「30s tick 零文件 IO」）。
    ///
    /// 它只是比较键的缓存，**不是**触发源：第三个拉取触发（目标 vault 打开成功）由打开路径
    /// 直接 poke（`commands::open_vault` / `RestoreGuard::finish`），不在 tick 上观察。
    cached_vault: Option<(PathBuf, PathBuf)>,
    /// 通知投递的连续失败计数（M635）：达阈值那一次在 app 内给一条可见提示。判据与上屏文案
    /// 的阈值都在 `cron.rs`（[`cron::NotifyFailureStreak`]），这里只做记账与派发。
    notify_failures: cron::NotifyFailureStreak,
    /// **进程内上下文表**（§5.2）：投递成功那一刻构造的整份点击上下文，按 request id 可取。
    ///
    /// 所有平台的进程内通道都从这里取上下文，**不读台账**——因此台账写失败不影响同进程点击。
    /// 有界（[`IN_PROCESS_CLICKS`]）：点击只可能落在最近几条通知上。
    in_process: std::collections::VecDeque<cron::ClickContext>,
    /// 接线层未就绪期间被保留的点击（M752 的 `DeferredClick`；`cron:run` 监听器不在场时发出去的
    /// 交接会被静默丢弃，而通知一经点掉系统不会再给第二次点击——所以点击必须先保留、就绪后重放）。
    ///
    /// 本 change 起存**整份已校验上下文**（§6）：重放要恢复「被点那条」的会话，只留任务 id 会让
    /// 重放退化成「按最新会话重算」。同任务后到者覆盖前者、总数有上限（[`cron::DeferredClick`]）。
    pending_click: cron::DeferredClick,
}

impl CronRunner {
    /// 一次评估（触发源由投递方给出：定时器 / 启动 / 焦点 / 目标 vault 打开成功）。
    fn evaluate(&mut self, trigger: cron::Trigger) {
        // 比较键用**规范化**路径（macOS `/tmp` → `/private/tmp` 软链下，配置路径与 vault
        // 根可能只差这一层）；canonicalize 只在 vault 变化时做一次，tick 常规路径纯内存。
        let raw = current_vault_root(&self.app);
        let key = match (&raw, &self.cached_vault) {
            (Some(path), Some((cached_raw, cached_key))) if path == cached_raw => {
                Some(cached_key.clone())
            }
            (Some(path), _) => Some(std::fs::canonicalize(path).unwrap_or_else(|_| path.clone())),
            (None, _) => None,
        };
        self.cached_vault = match (raw, key) {
            (Some(raw), Some(key)) => Some((raw, key)),
            _ => None,
        };
        let current_vault = self
            .cached_vault
            .as_ref()
            .and_then(|(_, key)| key.to_str())
            .map(str::to_string);
        let now = cron::LocalNow::now();
        self.prune_stale_inflight();
        for index in 0..self.tasks.len() {
            let scheduled = self.tasks[index].clone();
            self.dispatch(&scheduled, &now, trigger, current_vault.as_deref());
        }
    }

    /// 运行期重载（change add-cron-conversational-registration design §3.3）：重读配置 → 重建
    /// 任务集 → 新增且已过点的任务写当日种子 → 替换任务集与轮次预算 → 清理被删任务的内存记录
    /// （在途运行保留，它还要收尾回执）→ 任务集非空时补检通知权限 → 回执。
    ///
    /// 读失败（不可读 / 非法 JSON / 整文件回落）**保留原任务集**：清空会让「配置文件被外部
    /// 编辑器写坏一瞬间」变成「今天所有提醒消失」。
    fn reload(&mut self, ack: Sender<cron::ReloadOutcome>) {
        let outcome = self.apply_reload();
        let _ = ack.send(outcome);
    }

    fn apply_reload(&mut self) -> cron::ReloadOutcome {
        let snapshot = match config::load() {
            Ok(snapshot) if !snapshot.fallback => snapshot,
            Ok(snapshot) => {
                let message = snapshot
                    .warnings
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "配置重读失败".to_string());
                logging::config_warning(
                    "cron",
                    &format!("任务集重载失败，保留原任务集：{message}"),
                );
                return cron::ReloadOutcome {
                    applied: self.tasks.len(),
                    seeded: Vec::new(),
                    error: Some(message),
                    // 读配置失败时没有做权限补检：如实报「无法判定」，注册回执据此不声称被拒。
                    notify_permission: cron::NotifyPermission::Unknown,
                };
            }
            Err(error) => {
                logging::config_warning(
                    "cron",
                    &format!("任务集重载失败，保留原任务集：{}", error.message),
                );
                return cron::ReloadOutcome {
                    applied: self.tasks.len(),
                    seeded: Vec::new(),
                    error: Some(error.message),
                    notify_permission: cron::NotifyPermission::Unknown,
                };
            }
        };
        for issue in &snapshot.cron_issues {
            logging::cron_task_invalid(&issue.task, &issue.field, &issue.reason);
        }
        let (next, drift) = cron::schedule_of(&snapshot.config.cron.tasks);
        for issue in &drift {
            logging::cron_task_invalid(&issue.task, &issue.field, &issue.reason);
        }
        let now = cron::LocalNow::now();
        let plan = cron::plan_reload(
            &self.tasks,
            next,
            snapshot.config.harness.loop_max,
            &now,
            &mut self.state,
        );
        if !plan.seeded.is_empty() {
            self.persist_state();
        }
        self.tasks = plan.tasks;
        self.loop_max = plan.loop_max;
        cron::retain_live_tasks(&mut self.skipped_today, &plan.removed);
        cron::retain_live_tasks(&mut self.clicked_today, &plan.removed);
        cron::retain_live_tasks(&mut self.delivery_retry, &plan.removed);
        // 在途运行（`self.inflight`）**不清理**：被删任务的运行还要收尾并回执（design §3.3 第 5 步）。
        // 通知权限的判据同一次补检回流给注册回执（M635）：空任务集不补检（不为了没人用的通道
        // 弹系统对话框），此时如实报「无法判定」。
        let notify_permission = if self.tasks.is_empty() {
            cron::NotifyPermission::Unknown
        } else {
            ensure_notification_permission()
        };
        cron::ReloadOutcome {
            applied: self.tasks.len(),
            seeded: plan.seeded,
            error: None,
            notify_permission,
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
                // 回执丢失的点击运行可能从未真正发起（webview 监听器不在场时 emit 返回 Ok
                // 但事件被丢弃）——它的 clicked_today 条目 session_id 仍是 None，不撤掉的话
                // 当日再点只会落进「只聚焦、不运行」分支。保留有 session_id 的条目（那次运行
                // 确实建过会话，重复运行不应发生）。
                if self
                    .clicked_today
                    .get(&run.task)
                    .is_some_and(|clicked| clicked.session_id.is_none())
                {
                    self.clicked_today.remove(&run.task);
                }
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
            target_vault: &scheduled.vault_root,
            inflight,
            skipped_today,
            frontend_ready: self.app.state::<CronRuntime>().is_bridge_ready(),
            trigger,
        });
        match plan {
            cron::Plan::Idle => {}
            cron::Plan::Notify => {
                // 投递失败（权限 / 投递后端错误）：不写 last_fired，下一次评估重试
                // （design §5.4）。重试**节奏与日志量**由 `cron::DeliveryRetry` 管（M637）：
                // 失败按指数退避，连续失败到当日上限即停——不这样做的现场是每 30s 重试一整天、
                // 同一条 warning 刷 123 条。退避窗口内的评估直接跳过，不投递也不落日志。
                // 可见提示（M635）与重试节奏（M637）各记各的账：前者按连续失败阈值在 app 内
                // 上屏一次，后者管调度与日志量；成功时两条账都清。
                if !self.delivery_ready(&task.id, &now.date) {
                    return;
                }
                match deliver_notification(&self.app, &task.id, cron::NoticeKind::Trigger) {
                    Ok(request_id) => {
                        self.delivery_retry.remove(&task.id);
                        self.notify_failures.record_success();
                        logging::cron_notified(&task.id, "trigger", trigger.as_str());
                        // 台账条目与 `last_fired` 在**同一次**原子替换里落盘（§4）：登记只改内存，
                        // 落盘由紧随其后的 `mark_fired` 完成。
                        self.register_notice(
                            &request_id,
                            &task.id,
                            cron::NoticeKind::Trigger,
                            None,
                            &now.date,
                        );
                        self.mark_fired(&task.id, &now.date);
                    }
                    Err(error) => {
                        self.note_notify_failure(&task.id, &error);
                        self.record_delivery_failure(&task.id, &now.date, &error);
                    }
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
        // 载荷由 `cron::handoff` 纯函数合成（RunSpec + 任务载荷）：本接线层不字段自列。
        // `vault` 用配置里的目标路径原值（既有线格式口径）：前端拿它与已打开的 vault 比，
        // 未打开时走既有打开链路；判定侧的规范化比较只发生在 `plan` 的 current/target 比较上。
        let payload = cron::handoff(&cron::HandoffInput {
            task,
            run_id: &run_id,
            trigger,
            vault: &task.vault,
            loop_max: self.loop_max,
            session_id: match task.session {
                config::SessionShape::Dedicated => self.state.session_id(&task.id),
                config::SessionShape::New => None,
            },
        });
        match self.app.emit(CRON_RUN_EVENT, payload) {
            Ok(()) => {
                self.inflight.insert(
                    run_id,
                    InflightRun {
                        task: task.id.clone(),
                        delivery: task.delivery,
                        trigger,
                        started: Instant::now(),
                    },
                );
                self.mark_fired(&task.id, &now.date);
                // `cron_run_started` 的产出点在 `harness_cron_run`（运行交接被前端接受的那一刻
                // ——design §11 的语义），这里只投事件与写去重状态，不重复落事件。
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
        let session_id = result
            .session_id
            .clone()
            .or_else(|| self.state.session_id(&run.task).map(str::to_string));
        if let Some(clicked) = self.clicked_today.get_mut(&run.task) {
            clicked.session_id = session_id.clone();
        }
        // 交接就没成功（如点击时交互会话正忙 → `harness_busy`，没有会话 id）：清掉点击去重，
        // 让用户能再点一次；启动成功的运行保留（重复点击只打开已有会话，不重跑）。
        if session_id.is_none() {
            self.clicked_today.remove(&run.task);
        }
        if result.session_id.is_some() {
            self.state
                .set_session(&run.task, result.session_id.as_deref());
        }
        // 终态的唯一产出点（design §6.1 / §11）：成功与否只来自这次回执。
        logging::cron_run_finished(&run.task, result.ok, result.error.as_deref());
        // `run-then-notify` 的结果通知在终态之后（design §5.2）；通知通道未就绪时这次投递
        // 失败，但不改变终态判定，也不触发重跑（当日已写 last_fired）。
        let mut persisted = false;
        if run.delivery == config::DeliveryPolicy::RunThenNotify {
            let kind = if result.ok {
                cron::NoticeKind::Result
            } else {
                cron::NoticeKind::Failure
            };
            match deliver_notification(&self.app, &run.task, kind) {
                Ok(request_id) => {
                    self.notify_failures.record_success();
                    logging::cron_notified(&run.task, kind.as_str(), run.trigger.as_str());
                    // 结果 / 失败通知的原子性判据不同（§4）：这条路径不写 `last_fired`，因此
                    // 台账条目与**当时的完整状态**在同一次原子替换里落盘——条目的会话快照来自
                    // 本次回执（与同次落盘里 `tasks.<task>.session_id` 同一个值）。
                    let now = cron::LocalNow::now();
                    self.register_notice(
                        &request_id,
                        &run.task,
                        kind,
                        result.session_id.as_deref(),
                        &now.date,
                    );
                    self.persist_state();
                    persisted = true;
                }
                // 单次失败不进 cron 日志（M637：`deliver_notification` 不再逐次打 warning，
                // 底层 NSError 经 `log` 桥落 `dependency_log`）；这里只记账，达阈值那一次
                // 由 `note_notify_failure` 落一条 warning + app 内可见提示。
                Err(error) => self.note_notify_failure(&run.task, &error),
            }
        }
        // 会话标识仍要落盘（消费者的另一半是 `dedicated` 的续写）：通知没投出去时单写它，
        // 投出去时已随台账那次完整状态一起写过了。
        if !persisted && result.session_id.is_some() {
            self.persist_state();
        }
    }

    /// 投递点登记的**唯一**构造函数（§5.2）：一份上下文同时进进程内上下文表与台账。
    ///
    /// 两处 MUST NOT 各自重新推导——两处不一致就等于两个真源。台账只在 macOS 打包实例写入
    /// （唯一消费者是跨进程点击，其它平台没有消费者）。
    fn register_notice(
        &mut self,
        request_id: &str,
        task: &str,
        kind: cron::NoticeKind,
        session_id: Option<&str>,
        date: &str,
    ) {
        let context = cron::ClickContext::from_delivery(request_id, task, kind, session_id, date);
        while self.in_process.len() >= IN_PROCESS_CLICKS {
            self.in_process.pop_front();
        }
        if notice_ledger_enabled() {
            self.state.record_notice(request_id, context.notice(), date);
        }
        self.in_process.push_back(context);
    }

    /// 取走平台层的待处理响应并按接收判据处置（§5 的恢复流水线）。
    ///
    /// 平台层只交 request id 与**已归一化**的动作：非 `tap` 的响应在这里按防御口径落一条
    /// warning 后丢弃（不进处置，也就不会有 `cron_click`）。
    fn drain_platform_responses(&mut self) {
        let (responses, dropped) = notify::take_responses();
        // 缓冲溢出在回调里只记账（那里做配置 IO 会破坏「回调只入队 + 唤醒」），在这里补落。
        for request_id in dropped {
            logging::config_warning(
                "cron",
                &format!("通知响应的待处理缓冲已满，已丢弃最早的一条：{request_id}"),
            );
        }
        for response in responses {
            if response.action != cron::NoticeAction::Tap {
                logging::config_warning(
                    "cron",
                    &format!(
                        "忽略非 tap 的通知动作（{}）：{}",
                        action_label(&response.action),
                        response.request_id
                    ),
                );
                continue;
            }
            self.handle_click_request(&response.request_id);
        }
    }

    /// 一条响应 → 已校验点击上下文 → 处置。两条通道只在这里分叉一次。
    fn handle_click_request(&mut self, request_id: &str) {
        let now = cron::LocalNow::now();
        let live: Vec<String> = self
            .tasks
            .iter()
            .map(|scheduled| scheduled.task.id.clone())
            .collect();
        let in_process = self
            .in_process
            .iter()
            .rev()
            .find(|context| context.request_id == request_id)
            .cloned();
        let input = cron::AcceptInput {
            request_id,
            in_process: in_process.as_ref(),
            state: &self.state,
            live_tasks: &live,
            today: &now.date,
        };
        // 诊断需要「拒绝时能拿到什么」：命中来源时的任务与种类，缺失时只有 request id。
        let resolved = cron::resolve_context(&input);
        match cron::accept_click(&input) {
            Ok((context, source)) => self.handle_click(&context, source, not_ready_policy()),
            Err(rejection) => {
                let (task, action, source) = match &resolved {
                    Some((context, source)) => {
                        (context.task.clone(), action_label_of(context.kind), *source)
                    }
                    None => (String::new(), "none", cron::ClickSource::Relaunch),
                };
                logging::cron_click(&task, false, action, source, Some(rejection.as_str()));
                // `notice_unknown` 不上屏（旧版本遗留 / 被裁剪的通知属正常噪声）。
                if let Some(code) = rejection.notice_code() {
                    notice_code(&self.app, code, serde_json::json!({}));
                }
            }
        }
    }

    /// 通知点击处置（design §4.5 / §5.1 / §5.2）：两个入口（进程内 / 跨进程恢复）交出**同一份**
    /// 已校验上下文，来源与「未就绪时保留还是退回」只是附加参数。
    ///
    /// `notify-then-run` 点击发起运行（同日重复点击只打开已有会话）；`run-then-notify` 点击恢复
    /// **上下文快照里那条**运行的会话、不重跑。任一步失败落 `cron_click(ok=false)` 并给人话提示
    /// （MUST NOT 静默）。
    fn handle_click(
        &mut self,
        context: &cron::ClickContext,
        source: cron::ClickSource,
        policy: cron::NotReadyPolicy,
    ) {
        let action = action_label_of(context.kind);
        let Some(scheduled) = self
            .tasks
            .iter()
            .find(|scheduled| scheduled.task.id == context.task)
            .cloned()
        else {
            // 判据 3 已在接收时挡过一次；这里防的是「接受之后任务被删」（重放 / 重载竞态）。
            logging::cron_click(&context.task, false, action, source, Some("task_unknown"));
            notice_code(&self.app, "cron_click_task_deleted", serde_json::json!({}));
            return;
        };
        let task = scheduled.task;
        // 前端接线层未就绪（webview 的监听器不在场）：`app.emit` 会返回 Ok 但无人接收，运行会
        // 空挂到 stale 回收、点击去重也永远等不到回执。按通道策略处置——macOS 上用户手里没有
        // 第二次点击的机会（响应已被 delegate 收走），所以保留整份上下文等接线层就绪后重放。
        //
        // **这一步排在聚焦之前**：系统拉起应用后的第一轮 drain 可能早于窗口就绪，先聚焦会把
        // 「还没有窗口」误判成 `focus_failed`，把这次点击（用户只有一次）丢掉。
        if !self.app.state::<CronRuntime>().is_bridge_ready() {
            match policy {
                cron::NotReadyPolicy::Defer => {
                    self.defer_click(context.clone(), source);
                }
                cron::NotReadyPolicy::Reject => {
                    logging::cron_click(&task.id, false, action, source, Some("not_ready"));
                    notice(&self.app, "界面尚未就绪，请稍后重试");
                }
            }
            return;
        }
        if !focus_main_window(&self.app) {
            logging::cron_click(&task.id, false, action, source, Some("focus_failed"));
            notice(&self.app, "无法唤起 Lumir 窗口，请从程序坞打开后重试");
            return;
        }
        let now = cron::LocalNow::now();
        // 判据的输入全部是这一刻的运行时事实；点击去重按**本地日期**过滤（跨日重新允许）。
        // 通知种类决定「按今天跑没跑判」还是「按上下文快照恢复」（§5.2）：快照来自被点的那条
        // 通知，MUST NOT 换成任务的 `session_id`（最新一次运行）。
        let clicked_today = self
            .clicked_today
            .get(&task.id)
            .filter(|clicked| clicked.date == now.date)
            .map(|clicked| clicked.session_id.clone());
        let state_session_today = self
            .state
            .session_id(&task.id)
            .filter(|session_id| cron::session_started_today(session_id, &now))
            .map(str::to_string);
        let plan = cron::plan_click(&cron::ClickInput {
            delivery: task.delivery,
            kind: context.kind,
            session_snapshot: context.session_id.as_deref(),
            inflight: self.inflight.values().any(|run| run.task == task.id),
            bridge_ready: self.app.state::<CronRuntime>().is_bridge_ready(),
            clicked_today: clicked_today
                .as_ref()
                .map(|session_id| session_id.as_deref()),
            state_session_today: state_session_today.as_deref(),
        });
        match plan {
            // 理论上不可达：未就绪已在上面按平台策略处置过。留一条兜底，宁可保留也不丢。
            cron::ClickPlan::Defer => self.defer_click(context.clone(), source),
            cron::ClickPlan::FocusOnly => {
                // 首次点击的运行还没有回执 / 并发点击的后到者：只聚焦，不产生第二次运行。
                logging::cron_click(&task.id, true, action, source, None);
            }
            cron::ClickPlan::OpenSession(session_id) => {
                // 同日再点只打开已有会话（design §4.6）。到点通知顺手把点击去重记成「今日已点击
                // 且已有会话」——进程重启后靠的就是这条判据；结果 / 失败通知不写它（它们回答的是
                // 「打开哪条会话」，与「今天跑没跑」无关）。
                if context.kind == cron::NoticeKind::Trigger {
                    self.clicked_today.insert(
                        task.id.clone(),
                        ClickState {
                            date: now.date.clone(),
                            session_id: Some(session_id.clone()),
                        },
                    );
                }
                self.open_session(&task, &session_id, source, action);
            }
            cron::ClickPlan::Reject(reason) => {
                logging::cron_click(&task.id, false, action, source, Some(reason));
                if reason == "session_missing" {
                    notice(&self.app, &format!("任务 {} 还没有可恢复的会话", task.id));
                }
            }
            cron::ClickPlan::Run => self.start_click_run(&task, source),
        }
    }

    /// 到点通知的点击：在交互会话槽位发起一次运行（同日幂等已由 [`cron::plan_click`] 判过）。
    fn start_click_run(&mut self, task: &config::CronTask, source: cron::ClickSource) {
        let now = cron::LocalNow::now();
        self.clicked_today.insert(
            task.id.clone(),
            ClickState {
                date: now.date.clone(),
                session_id: None,
            },
        );
        let run_id = cron::new_run_id();
        // 与定时派发同一个纯函数合成点：点击运行的差异只落在契约值上
        // （`Interactive` 槽位 + 交互批准），不在载荷形状或接线层分叉。
        let payload = cron::handoff(&cron::HandoffInput {
            task,
            run_id: &run_id,
            trigger: cron::Trigger::Click,
            vault: &task.vault,
            loop_max: self.loop_max,
            session_id: match task.session {
                config::SessionShape::Dedicated => self.state.session_id(&task.id),
                config::SessionShape::New => None,
            },
        });
        match self.app.emit(CRON_RUN_EVENT, payload) {
            Ok(()) => {
                // 点击运行也登记在途：回执（含失败）因此走同一条 finish 路径更新会话 id
                // 与 cron_run_finished，不会变成「未知 run_id」被丢弃。
                self.inflight.insert(
                    run_id,
                    InflightRun {
                        task: task.id.clone(),
                        delivery: task.delivery,
                        trigger: cron::Trigger::Click,
                        started: Instant::now(),
                    },
                );
                logging::cron_click(&task.id, true, "run", source, None);
            }
            Err(error) => {
                // emit 本身失败（窗口 / 事件系统不可用）：刚插入的点击去重必须撤回，
                // 否则当日再点会命中「session_id = None ⇒ 只聚焦」分支，永远无法重试。
                self.clicked_today.remove(&task.id);
                logging::cron_click(&task.id, false, "run", source, Some("emit_failed"));
                notice(
                    &self.app,
                    &format!("任务 {} 的运行未能发起（{error}），请手动打开会话", task.id),
                );
            }
        }
    }

    /// 界面未就绪时保留整份上下文（§6）：同任务后到者覆盖前者、总数有上限
    /// （[`cron::DeferredClick`]）；被覆盖 / 被顶出的那条补一条
    /// `cron_click(ok=false, error=not_ready)`（它的点击确实没能落地，不该静默消失）。
    fn defer_click(&mut self, context: cron::ClickContext, source: cron::ClickSource) {
        logging::cron_click_deferred(
            &context.task,
            &context.request_id,
            source.as_str(),
            "not_ready",
        );
        for (dropped, dropped_source) in self.pending_click.defer(context, source) {
            logging::cron_click(
                &dropped.task,
                false,
                action_label_of(dropped.kind),
                dropped_source,
                Some("not_ready"),
            );
        }
    }

    /// 重放接线层未就绪期间保留的点击（M752）：`cron_bridge_ready` 之后调用一次。
    ///
    /// 保留的是**整份已校验上下文**，因此重放不需要（也不允许）按最新会话重算。就绪之后仍然
    /// 不能落地时按失败落地并提示，不留一条永远不执行的保留态。
    fn replay_pending_click(&mut self) {
        let pending = self.pending_click.take_all();
        if pending.is_empty() {
            return;
        }
        if !self.app.state::<CronRuntime>().is_bridge_ready() {
            for (context, source) in pending {
                logging::cron_click(
                    &context.task,
                    false,
                    action_label_of(context.kind),
                    source,
                    Some("not_ready"),
                );
            }
            notice(&self.app, "界面尚未就绪，请稍后重试");
            return;
        }
        for (context, source) in pending {
            self.handle_click(&context, source, cron::NotReadyPolicy::Reject);
        }
    }

    /// 进程退出时仍保留的点击：补 `not_ready` 收尾（尽力而为——退出路径上日志可能来不及落盘，
    /// 但那是「进程已经退出」的必然边界，不是遗漏）。
    fn flush_pending_click(&mut self) {
        for (context, source) in self.pending_click.take_all() {
            logging::cron_click(
                &context.task,
                false,
                action_label_of(context.kind),
                source,
                Some("not_ready"),
            );
        }
    }

    /// 「恢复该次运行的会话」：前端确保目标 vault 已打开后经既有恢复链路打开它。
    ///
    /// `session_id` 来自**点击上下文的快照**（`run-then-notify` 的结果 / 失败通知）——MUST NOT
    /// 换成任务的最新会话：同一任务可以有多条通知，各自持有不同的会话。
    fn open_session(
        &self,
        task: &config::CronTask,
        session_id: &str,
        source: cron::ClickSource,
        action: &str,
    ) {
        let payload = serde_json::json!({
            "task": task.id,
            "vault": task.vault,
            "session_id": session_id,
        });
        match self.app.emit(CRON_OPEN_SESSION_EVENT, payload) {
            Ok(()) => logging::cron_click(&task.id, true, action, source, None),
            Err(error) => {
                logging::cron_click(&task.id, false, action, source, Some("emit_failed"));
                notice(
                    &self.app,
                    &format!("无法打开任务 {} 的会话（{error}）", task.id),
                );
            }
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

    /// 一次投递失败的记账（M635）：连续次数由 [`cron::NotifyFailureStreak`] 判，只有达到
    /// 阈值的那一次才在 app 内上屏（同一段连续失败只提示一次，不拿重复提示吵人）。
    ///
    /// 日志口径归 M637：单次失败的诊断由 [`Self::record_delivery_failure`] 落（一段退避里第一
    /// 次失败一条）；`deliver_notification` 本身不再逐次打 warning。这里只在「已给出可见提示」
    /// 那一次记一条。
    fn note_notify_failure(&mut self, task: &str, error: &str) {
        let Some(count) = self.notify_failures.record_failure() else {
            return;
        };
        logging::config_warning(
            "cron",
            &format!("任务 {task} 的通知已连续 {count} 次投递失败，已给出可见提示：{error}"),
        );
        // 措辞按**已探测的**权限快照分档（M636）：身份未被认可时说签名，别的成因走通用档
        // ——通用档不把「去系统设置打开」说成唯一出路（那里开着也送不出去时它不解决问题）。
        notice_code(
            &self.app,
            cron::delivery_failed_code(cached_notification_permission()),
            serde_json::json!({ "count": count }),
        );
    }

    /// 该任务现在是否允许再试一次投递（退避窗口 / 当日上限，M637）。没有失败记录即允许。
    fn delivery_ready(&self, task: &str, date: &str) -> bool {
        match self.delivery_retry.get(task) {
            Some(state) => state.ready(date, Instant::now()),
            None => true,
        }
    }

    /// 记一次投递失败：**只**在第一次失败与当日放弃时各落一条 warning，中间的退避重试静默
    /// （M637）。静默的是日志而不是行为——失败仍不写 `last_fired`，退避窗口结束后照常重试。
    fn record_delivery_failure(&mut self, task: &str, date: &str, error: &str) {
        let state = self
            .delivery_retry
            .entry(task.to_string())
            .or_insert_with(|| cron::DeliveryRetry::new(date, Instant::now()));
        match state.record_failure(date, Instant::now()) {
            cron::RetryOutcome::Retry {
                failures: 1,
                next_in,
            } => logging::config_warning(
                "cron",
                &format!(
                    "任务 {task} 的通知投递失败，按退避重试（第 1 次；约 {}s 后）：{error}",
                    next_in.as_secs()
                ),
            ),
            cron::RetryOutcome::Retry { .. } => {}
            cron::RetryOutcome::GivenUp { failures } => logging::config_warning(
                "cron",
                &format!(
                    "任务 {task} 的通知已连续 {failures} 次投递失败，今日不再重试（次日到点窗口重新开始）：{error}"
                ),
            ),
        }
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

/// 通知投递端口（design §4.4 / §9）：标题 = 任务 id，正文只用通用文案（到点 / 已完成 /
/// 运行失败）。文案 MUST NOT 含 prompt、文档内容或绝对路径——通知会出现在锁屏与通知中心。
///
/// **返回该条通知的 request id**（§4「投递端口契约」）：台账与进程内上下文表都以它为键，
/// 因此 id 必须在这里定下、由调用方拿到——id 只活在函数内部的话，台账无从落键。
///
/// **macOS 打包实例**走本仓自持的 UN 平台层（[`notify`]）：启动窗口内按短间隔重试到被接受，
/// 投递后按请求 id 自查系统是否真的放进了通知中心。**dev flavour** 走 mac-notification-sys 的
/// legacy 投递——UN 在无 bundle 的裸二进制里会 abort，而 dev 的通知点击回调本就是已知失效的
/// 通道边界（套件按 `requires: bundle` 标 INVALID），只要投递可用即可。
///
/// **非 macOS** 由 notify-rust 自身的平台后端投递（Linux XDG / Windows WinRT），错误同样原样
/// 上抛；点击等待由投递点登记的逐条闭包接收（[`spawn_notification_click_waiter`]）——那里的
/// 平台 id 是 `u32`，因此本仓同时给出一个自己的 request id（进程内上下文表的键就是它）。
///
/// **成功判据 = 系统确认（M620，macOS）**：投递请求被接受只说明请求发出去了，本函数随后用
/// [`notify::macos::delivered_ids`] 查通知中心的已投递列表；查不到就同 id 重投一次，两次都查
/// 不到即返回 Err（不写 `cron_notified` / `last_fired`）。`cron_notified` 因此代表「系统确认已
/// 送达」，而不是「我方以为发了」。
///
/// **本函数不落日志**（M637）：失败的重试节奏与日志量归调用方——`Plan::Notify` 有退避与当日
/// 上限，只落第一次失败与当日放弃两条 warning；在这里逐次打 warning 会让那个上限失效。
fn deliver_notification(
    app: &tauri::AppHandle,
    task: &str,
    kind: cron::NoticeKind,
) -> Result<String, String> {
    let body = match kind {
        cron::NoticeKind::Result => "已完成",
        cron::NoticeKind::Failure => "运行失败",
        cron::NoticeKind::Trigger => "到点",
    };
    // 请求 id 在整次投递（含自查失败后的重投）内保持不变：macOS 按请求 id 替换同一条通知，
    // 重投不会在通知中心留下第二条（usernoted 日志：`Adding new request, remove notifications
    // similar to: <同一 req>`）。时间戳只用来让不同次投递彼此区分。
    //
    // **一次时钟读数派生两个 id**（r1 P2-4）：macOS 用可读形态的 request id；非 macOS 的
    // 平台标识是 `u32`，对外返回的就是它的十进制形态——返回值与系统里的标识逐字相同。
    let millis = cron::notify_millis();
    #[cfg(target_os = "macos")]
    let request_id = cron::notification_request_id(task, kind, millis);
    #[cfg(not(target_os = "macos"))]
    let request_id = cron::platform_request_id(millis);
    #[cfg(target_os = "macos")]
    {
        // macOS 上点击接收只有 delegate 一条通道（没有逐条等待），这个句柄只在非 macOS 的
        // 分支里被用到。
        let _ = app;
        if tauri::is_dev() {
            deliver_notification_dev(task, body)?;
            return Ok(request_id);
        }
        let mut last_error = String::new();
        for _attempt in 0..NOTIFY_DELIVERY_ATTEMPTS {
            match deliver_with_startup_retry(&request_id, task, body) {
                Ok(()) => {
                    if notification_is_delivered(&request_id, NOTIFY_DELIVERY_VERIFY) {
                        return Ok(request_id);
                    }
                    // 自查没查到：这次不算投递成立。同 id 重投（系统按 id 替换，不留第二条）。
                    last_error = "投递后自查：通知中心里查不到该请求".to_string();
                }
                Err(error) => last_error = error,
            }
        }
        // 调用方决定日志（M637）：`Plan::Notify` 的失败重试有退避与当日上限，在这里逐次打
        // warning 会让「只落一条」失效（0.9.2 一天 123 条的现场）。错误文本带回尝试次数，
        // 详情由调用方同那条唯一的 warning 一起落。
        Err(format!(
            "{} 次尝试均未被系统确认送达：{last_error}",
            NOTIFY_DELIVERY_ATTEMPTS
        ))
    }
    #[cfg(not(target_os = "macos"))]
    {
        // 平台 id 与上面那个 request id **同源**（同一份 `millis`）：`request_id` 就是它的
        // 十进制形态，因此「返回的 id」与「系统里的通知 id」是同一个值。
        let platform_id = cron::platform_notification_id(millis);
        let handle = notify_rust::Notification::new()
            .id(platform_id)
            .summary(task)
            .body(body)
            .show()
            .map_err(|error| error.to_string())?;
        spawn_notification_click_waiter(app, &request_id, handle);
        Ok(request_id)
    }
}

/// 台账开关（§4 / tasks 2.1）：唯一消费者是**跨进程点击**——只有 macOS 打包实例有这条通道，
/// 其它环境写台账就是写没有消费者的数据。
fn notice_ledger_enabled() -> bool {
    cfg!(target_os = "macos") && !tauri::is_dev()
}

/// 进程启动时刻：冷启动窗口的判据（见 [`NOTIFY_STARTUP_RETRY`]）。`run()` 在入口处记录。
static PROCESS_STARTED: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

/// 启动早期不能落日志的告警（change add-cron-notification-relaunch r1 P2-3）。
///
/// `logging::global()` 的首次初始化会同步解析配置目录并读配置文件；在 `run()` 入口的
/// 「装 delegate、零 IO」区间里落 warning 等于把配置 IO 带进冷启动路径（design §3 / ADR 0002
/// 第 6 条）。因此这类话先存这里，由 `lumir-cron` 线程在 `logging::init()` 之后补落。
static STARTUP_WARNINGS: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn defer_startup_warning(message: String) {
    STARTUP_WARNINGS
        .lock()
        .expect("startup warnings poisoned")
        .push(message);
}

/// 补落启动期攒下的告警（守护线程装载完成后调用一次；logging 此时已初始化）。
fn flush_startup_warnings() {
    let pending: Vec<String> = {
        let mut warnings = STARTUP_WARNINGS.lock().expect("startup warnings poisoned");
        std::mem::take(&mut *warnings)
    };
    for message in pending {
        logging::config_warning("cron", &message);
    }
}

/// 冷启动窗口的重试预算（M620）：启动最初约 0.5s 内投递可能被本地拒绝，窗口比实测值留足
/// 余量（慢盘 / 冷启动更慢的机器）；只在窗口内重试，之后的失败原样上抛。
const NOTIFY_STARTUP_RETRY: std::time::Duration = std::time::Duration::from_secs(5);

/// 冷启动窗口内的重试间隔：投递失败是本地早退（请求没发出去），20ms 足够密、又不会烧 CPU。
const NOTIFY_STARTUP_RETRY_INTERVAL: std::time::Duration = std::time::Duration::from_millis(20);

/// 投递后自查的重投上限（M620）：一次投递 = 首次 + 至多一次同 id 重投。重投用同一请求 id，
/// 系统按 id 替换而不是新增条目（不会出现两条同样的通知）。
#[cfg(target_os = "macos")]
const NOTIFY_DELIVERY_ATTEMPTS: usize = 2;

/// 每次投递后等「通知中心里查得到」的预算：探针实测请求被接受后 ~100ms 内可见；1200ms 留足
/// 系统繁忙时的余量，同时把 cron 线程的阻塞压在可接受范围内。
#[cfg(target_os = "macos")]
const NOTIFY_DELIVERY_VERIFY: std::time::Duration = std::time::Duration::from_millis(1200);

/// 自查轮询间隔：查一次通知中心是一次 XPC 往返，100ms 粒度足够又不吵。
#[cfg(target_os = "macos")]
const NOTIFY_DELIVERY_VERIFY_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);

/// 投递一条 UN 通知，冷启动窗口内失败即重试（M620）。
///
/// M620 的现场是启动最初约 0.5s 内投递被本地拒绝（请求根本没发出去），重试到主线程事件循环
/// 进入等待即被接受。窗口之外的失败（权限被拒 / 投递后端错误）不再重试——按 design §5.4 交给
/// 下一次评估。
#[cfg(target_os = "macos")]
fn deliver_with_startup_retry(request_id: &str, title: &str, body: &str) -> Result<(), String> {
    let started = *PROCESS_STARTED.get_or_init(Instant::now);
    let deadline = started + NOTIFY_STARTUP_RETRY;
    loop {
        match notify::macos::deliver(request_id, title, body) {
            Ok(()) => return Ok(()),
            Err(error) => {
                if Instant::now() >= deadline {
                    return Err(error);
                }
                std::thread::sleep(NOTIFY_STARTUP_RETRY_INTERVAL);
            }
        }
    }
}

/// 投递后自查（M620）：系统确认这条请求**已经在通知中心里**才算这次投递成立。
///
/// 为什么「请求被接受」不够：它只证明请求发出去了。只有已投递列表能回答「系统真的把它放进了
/// 通知中心」——`getDeliveredNotifications` 的读数就是它（[`notify::macos::delivered_ids`]）。
///
/// 带宽：`budget` 内每 [`NOTIFY_DELIVERY_VERIFY_INTERVAL`] 查一次；超时返回 false，由调用方
/// 决定重投（同请求 id）还是判失败。调用点只在 `lumir-cron` 线程上、且投递是低频动作。
#[cfg(target_os = "macos")]
fn notification_is_delivered(request_id: &str, budget: std::time::Duration) -> bool {
    let deadline = Instant::now() + budget;
    loop {
        let delivered = notify::macos::delivered_ids();
        if delivered.iter().any(|id| id == request_id) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(NOTIFY_DELIVERY_VERIFY_INTERVAL);
    }
}

/// 点击等待（非 macOS）：**每条通知在投递成功后**注册一个响应等待线程，`tap`（点通知本体）
/// 投一个 `CronMessage::DrainClicks` 给 `lumir-cron` 线程——判定与副作用仍在`lumir-cron` 上，
/// 平台层只负责把「哪条通知被点了」送进来。
///
/// **为什么逐条登记**：点击响应与具体的投递请求绑定（平台按请求 id 路由），不存在一条全局
/// 监听能覆盖所有通知。macOS 打包实例不再走这条路——它的接收只有常驻 delegate 一条通道
/// （`notify::macos`），本函数只服务 Linux / Windows。
///
/// 非 `tap` 动作（当前无动作按钮，属防御）落 warning，不静默吞掉；关闭 / 过期不产生事件。
///
/// **订阅线程起不来不影响这次投递的成败**（通知已经在系统通知中心）：只落一条 warning——
/// 把「点击订阅失败」当投递失败会让 cron 重投一条已经在场的通知。
#[cfg(not(target_os = "macos"))]
fn spawn_notification_click_waiter(
    app: &tauri::AppHandle,
    request_id: &str,
    handle: notify_rust::NotificationHandle,
) {
    let app = app.clone();
    let request_id = request_id.to_string();
    let spawned = std::thread::Builder::new()
        .name("lumir-notify-click".to_string())
        .spawn(move || {
            let _ =
                handle.wait_for_response(move |response: &notify_rust::NotificationResponse| {
                    match response {
                        notify_rust::NotificationResponse::Default => {
                            notify::report_response(request_id.clone(), cron::NoticeAction::Tap);
                        }
                        notify_rust::NotificationResponse::Action(action) => {
                            notify::report_response(
                                request_id.clone(),
                                cron::NoticeAction::Custom(action.clone()),
                            );
                        }
                        _ => {}
                    }
                });
            // 等待线程在 `wait_for_response` 返回后立刻结束；`app` 只用来保活到这一刻
            // （事件循环退出时 `AppHandle` 已不可用，这里不发任何东西）。
            let _ = &app;
        });
    if let Err(error) = spawned {
        logging::config_warning("cron", &format!("通知点击等待线程启动失败：{error}"));
    }
}
fn not_ready_policy() -> cron::NotReadyPolicy {
    #[cfg(target_os = "macos")]
    {
        cron::NotReadyPolicy::Defer
    }
    #[cfg(not(target_os = "macos"))]
    {
        cron::NotReadyPolicy::Reject
    }
}

/// 点击动作的诊断标签（`cron_click.action` 的闭集合）。
fn action_label_of(kind: cron::NoticeKind) -> &'static str {
    match kind {
        cron::NoticeKind::Trigger => "run",
        cron::NoticeKind::Result | cron::NoticeKind::Failure => "open-session",
    }
}

/// 非 `tap` 动作的诊断标签（只进 warning，不进 `cron_click`）。
fn action_label(action: &cron::NoticeAction) -> &str {
    match action {
        cron::NoticeAction::Tap => "tap",
        cron::NoticeAction::Dismiss => "dismiss",
        cron::NoticeAction::Custom(identifier) => identifier,
    }
}

/// dev flavour 的 legacy 投递（M608）：dev 的裸二进制没有自己的 bundle 身份，legacy 投递要借
/// 一个已注册的 bundle id 才能上屏，因此归属写成 `com.apple.Terminal`（M608 探针期的既有口径）。
/// 异步投递、不等待响应——点击响应会路由给 Terminal 的 bundle 身份，dev 下没有可用的点击回调，
/// 等待只会白挂一个线程。
#[cfg(target_os = "macos")]
fn deliver_notification_dev(task: &str, body: &str) -> Result<(), String> {
    let _ = mac_notification_sys::set_application("com.apple.Terminal");
    let mut notification = mac_notification_sys::Notification::default();
    notification.title(task).message(body).asynchronous(true);
    notification
        .send()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// 通知权限快照（macOS 打包实例；dev flavour / 非 macOS 从不写入）。
///
/// 单独一个静态而不是函数内 `static`：投递失败时要用**已探测的**快照选措辞，而那条路径
/// MUST NOT 触发一次新的申请（见 [`cached_notification_permission`]）。
#[cfg(target_os = "macos")]
static NOTIFY_PERMISSION: std::sync::OnceLock<cron::NotifyPermission> = std::sync::OnceLock::new();

/// 已经探测过的通知权限快照（不发起申请）：投递失败时按它选可见提示的措辞（M635）。
/// 从未探测过（进程内还没有任何任务）⇒ `None`，调用方按「无法判定」处理。
fn cached_notification_permission() -> Option<cron::NotifyPermission> {
    #[cfg(target_os = "macos")]
    {
        NOTIFY_PERMISSION.get().copied()
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// 通知权限检查（design §4.3）：有有效任务时检查一次；未决定申请一次；被拒落一条人话
/// warning 且不反复申请。查询 / 申请失败都只降级为 warning——MUST NOT 阻断启动。
///
/// 只有 macOS 提供可查询的通知授权：打包实例投递走 UNUserNotificationCenter（M608），这里直接
/// 请求一次——已决定（Allow / Deny）时 `requestAuthorization` 不弹窗、按现状返回，未决定时才弹
/// 一次。dev flavour 走 legacy 投递，UN 授权在无 bundle 进程里没有意义，直接跳过。非 macOS
/// （Linux 无权限模型、Windows 无查询 API）同样无需检查：投递失败由调用侧按 design §5.4 交给
/// 下一次评估。
///
/// **返回值是判据快照，不是新的判断**（M635）：申请只发生在这里一次，结果缓存在
/// [`NOTIFY_PERMISSION`]；重载回执把它带回去（[`cron::ReloadOutcome::notify_permission`]），
/// 注册回执与下面的 warning 读的是同一份快照。注册路径 MUST NOT 自己再申请一次——「未决定」
/// 时申请会弹系统对话框，第二处申请等于让注册动作多弹一次窗。
///
/// **`Ok(false)` 不是「用户拒绝」的同义词**（M636 定论）：macOS 26 的 usernotificationsd 按调用
/// 进程的代码签名身份判定资格，安装包只有 linker ad-hoc 签名时系统认不到该 bundle id，申请
/// 一律返回 false，而系统设置里「Lumir」的条目属于另一个签过名的身份。因此再读一次
/// `authorizationStatus` 把成因分开：`NotDetermined`（系统里没有本客户端的授权记录）⇒
/// [`cron::NotifyPermission::Unrecognized`]，`Denied` ⇒ [`cron::NotifyPermission::Denied`]。
fn ensure_notification_permission() -> cron::NotifyPermission {
    #[cfg(target_os = "macos")]
    {
        if tauri::is_dev() {
            return cron::NotifyPermission::Granted;
        }
        // 诊断文案在探测里落（那里才有 crate 的错误详情），这里只做「一次」与「缓存」。
        *NOTIFY_PERMISSION.get_or_init(probe_notification_permission)
    }
    #[cfg(not(target_os = "macos"))]
    {
        cron::NotifyPermission::Granted
    }
}

/// 申请一次通知授权，并用 `authorizationStatus` 把「用户拒绝」与「系统不认这个身份」分开
/// （M636）：`requestAuthorization` 只在「未决定」时弹窗，已决定时按现状返回。诊断 warning 也
/// 只在这里落一次（`get_or_init` 保证）。
///
/// 读设置失败时按 `Denied` 处理——两条措辞都说明「通知送不出去」，只有「要不要让用户去系统
/// 设置」这条引导不同；读不到状态时不排除用户拒绝的可能，因此走 `Denied` 档。
#[cfg(target_os = "macos")]
fn probe_notification_permission() -> cron::NotifyPermission {
    use notify::macos::Authorization;
    let permission = match notify::macos::request_authorization() {
        Ok(true) => cron::NotifyPermission::Granted,
        Ok(false) => match notify::macos::authorization() {
            Ok(Authorization::NotDetermined) => cron::NotifyPermission::Unrecognized,
            // 申请说没授权、设置说已授权（Provisional / Ephemeral / Authorized）：两头矛盾，
            // 按「送不出去」的一般档处理，不编原因。
            Ok(_) => cron::NotifyPermission::Denied,
            Err(error) => {
                logging::config_warning(
                    "cron",
                    &format!("读取通知授权状态失败，按「被拒」处理：{error}"),
                );
                cron::NotifyPermission::Denied
            }
        },
        Err(error) => {
            logging::config_warning(
                "cron",
                &format!("通知权限申请失败（不影响启动与任务判定）：{error}"),
            );
            cron::NotifyPermission::Unknown
        }
    };
    match permission {
        cron::NotifyPermission::Granted => {}
        cron::NotifyPermission::Denied => logging::config_warning(
            "cron",
            "通知权限被拒绝：notify-then-run 任务无法投递，可改用 run-then-notify / silent-run",
        ),
        cron::NotifyPermission::Unrecognized => logging::config_warning(
            "cron",
            "系统未认可当前 Lumir 的通知身份（安装包缺少有效签名，系统设置里的 Lumir 条目属于其它身份）：\
             notify-then-run 任务无法投递，可改用 run-then-notify / silent-run",
        ),
        // `Err` 分支已经落过带错误详情的 warning，这里不再重复。
        cron::NotifyPermission::Unknown => {}
    }
    permission
}

/// 把主窗口唤起并置前（通知点击的第一步，design §4.5）。返回是否成功——失败由调用方落
/// `cron_click(ok=false)` 并给人话提示，不静默。
fn focus_main_window(app: &tauri::AppHandle) -> bool {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return false;
    };
    if window.show().is_err() {
        return false;
    }
    // 未最小化时 unminimize 可能报错（平台差异）：它只是尽力而为，成败判据落在 set_focus。
    let _ = window.unminimize();
    window.set_focus().is_ok()
}

/// 人话提示（点击链路失败时的可见反馈）：前端监听 `cron:notice` 并上屏。
///
/// 载荷是**直传的中文串**——既有调用点沿用（它们的文案还没迁进 deck，属独立的 i18n 收尾
/// 治理，不在 M635 范围）。新调用点一律走 [`notice_code`]：文案只在 deck 一处，前端按当前
/// 界面语言取值（ui-language 的「Rust 侧错误只带 code + params」口径）。
fn notice(app: &tauri::AppHandle, message: &str) {
    let _ = app.emit(CRON_NOTICE_EVENT, serde_json::json!({ "message": message }));
}

/// 按**文案 code** 上屏的人话提示（M635）：前端把 `code` 映射成 deck 条目、按当前界面语言
/// 渲染并插 `params`。code 只在 `src/copy-data.ts` 的 `CRON_NOTICE_COPY` 里登记一次，Rust 侧
/// MUST NOT 持有可见文案（D321 是唯一例外：OS 绘制的原生对话框）。
fn notice_code(app: &tauri::AppHandle, code: &str, params: serde_json::Value) {
    let _ = app.emit(
        CRON_NOTICE_EVENT,
        serde_json::json!({ "code": code, "params": params }),
    );
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{
        edit_items_are_predefined_undo_redo, is_close_item_text, is_quit_item_text,
        is_select_all_item_text, menu_command_of,
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

    /// 全选项文案校验（M627）：只认 muda 的 Select All 两种形态，别把邻近的编辑项误删。
    #[test]
    fn select_all_item_text_rejects_other_predefined_items() {
        assert!(is_select_all_item_text("Select All"));
        assert!(is_select_all_item_text("Select &All")); // Windows/Linux 的助记符形态
        assert!(!is_select_all_item_text(""));
        assert!(!is_select_all_item_text("select all")); // 大小写敏感，非 muda 默认文案
        assert!(!is_select_all_item_text("Select All Tabs"));
        assert!(!is_select_all_item_text("Paste"));
        assert!(!is_select_all_item_text("Cut"));
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

    /// 菜单事件载荷（M131 + M149 + M627）：只认自己的菜单项 id，其余（含 Quit、预置项
    /// 文案本身）不产生命令事件。
    ///
    /// M149 新增的两个关闭项 id 各断言一次：它们是**两次独立的菜单手术**（File 子菜单与
    /// Window 子菜单各一处），只测一个会漏掉另一条转发路径。
    ///
    /// 真实菜单手术（remove_at / append）需要一份 AppHandle，纯单测覆盖不到——与 M131
    /// 同一深度：可判定的部分是「文案校验 + id → 载荷映射」，手术本身由真机验收覆盖
    /// （14-tabs 的菜单点击步骤；M627 的全选菜单项 id → 载荷在这里判，按键链路由 chromium 的
    /// m627 场景覆盖，菜单点击的真机路径登记在场景 215 的覆盖边界里）。
    #[test]
    fn menu_command_only_covers_our_menu_items() {
        assert_eq!(menu_command_of("lumir.undo"), Some("undo"));
        assert_eq!(menu_command_of("lumir.redo"), Some("redo"));
        assert_eq!(menu_command_of("lumir.close"), Some("close"));
        assert_eq!(menu_command_of("lumir.close_window"), Some("close"));
        assert_eq!(menu_command_of("lumir.select_all"), Some("selectAll"));
        // change improve-keybindings-lookup-oct24：Help 菜单的键位速查入口映射到前端
        // 命令 id 的后半段；菜单项本身不带 accelerator（结构上没有调用 `.accelerator()`）。
        assert_eq!(
            menu_command_of("lumir.keyboard_shortcuts"),
            Some("describe-bindings")
        );
        assert_eq!(menu_command_of("lumir.quit"), None);
        assert_eq!(menu_command_of("Undo"), None);
        assert_eq!(menu_command_of("Close"), None);
        assert_eq!(menu_command_of("Select All"), None);
        assert_eq!(menu_command_of("Keyboard Shortcuts"), None);
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

    /// 第三个拉取触发（目标 vault 打开成功）只由**打开成功点**产出：用户打开两条命令共用的
    /// `open_vault` 提交点 + 启动恢复提交点，各一处。定时器路径 MUST NOT 再用「观察 vault 变更」
    /// 判一次（那是本 change 实现期的临时形态，同一语义两处判定会漂）——这条断言把它钉住：
    /// `lib.rs` / `commands.rs` 里各只允许一处 `Trigger` 的 `VaultOpen` 变体。
    #[test]
    fn vault_open_trigger_has_one_production_point_per_open_path() {
        let needle = concat!("Trigger::", "VaultOpen");
        let mut hits = Vec::new();
        collect_source_hits(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
            needle,
            &mut hits,
        );
        let in_file =
            |file: &str| -> Vec<&String> { hits.iter().filter(|hit| hit.contains(file)).collect() };
        assert_eq!(
            in_file("/lib.rs:").len(),
            1,
            "lib.rs 只允许启动恢复提交点产出 vault-open 触发（定时器 MUST NOT 观察 vault 变更）：{hits:?}"
        );
        assert_eq!(
            in_file("/commands.rs:").len(),
            1,
            "commands.rs 只允许 open_vault 提交点产出 vault-open 触发：{hits:?}"
        );
    }

    /// delegate 安装点在 `run()` 入口、**先于** Builder 与窗口创建（change
    /// add-cron-notification-relaunch tasks 1.2 / 1.7）：Apple 合同要求 delegate 在应用完成启动
    /// 之前装好，否则「导致应用被启动的通知」响应会丢。装在 `.setup` 里也不够稳（这里按「越早
    /// 越好」取 `run()` 入口）——位置一挪，跨进程点击就静默失效，所以用结构断言钉住顺序。
    #[test]
    fn delegate_is_installed_before_the_app_is_built() {
        let text = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src")
                .join("lib.rs"),
        )
        .expect("lib.rs 可读");
        let run_start = text.find("pub fn run()").expect("run() 在场");
        let install = text[run_start..]
            .find("notify::install_delegate()")
            .expect("run() 里必须装 delegate");
        let builder = text[run_start..]
            .find("tauri::Builder::default()")
            .expect("run() 里必然构建 Builder");
        assert!(
            install < builder,
            "delegate 必须在应用构建（窗口创建）之前安装：install@{install} vs builder@{builder}"
        );
    }

    /// 安装段零配置 IO（r1 P2-3）：`run()` 在 Builder（窗口创建）之前 MUST NOT 落任何日志——
    /// `logging::global()` 首次初始化会同步解析配置目录并读 `config.json`，那是冷启动合同里的
    /// 「安装路径零 IO」区间。delegate 安装失败因此只 `defer_startup_warning`，由守护线程补落。
    #[test]
    fn the_install_segment_logs_nothing_before_the_app_is_built() {
        let text = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src")
                .join("lib.rs"),
        )
        .expect("lib.rs 可读");
        let run_start = text.find("pub fn run()").expect("run() 在场");
        let builder = text[run_start..]
            .find("tauri::Builder::default()")
            .expect("run() 里必然构建 Builder");
        let segment = &text[run_start..run_start + builder];
        let logging_calls: Vec<&str> = segment
            .lines()
            .map(str::trim)
            .filter(|line| !line.starts_with("//"))
            .filter(|line| line.contains("logging::"))
            .collect();
        assert!(
            logging_calls.is_empty(),
            "安装段不允许落日志（会把配置 IO 带进冷启动路径）：{logging_calls:?}"
        );
    }

    /// 自持平台层的投递只有一个生产点（change add-cron-notification-relaunch tasks 1.4 / 1.7）：
    /// 台账要以 request id 落键，因此投递必须经 `deliver_notification`（它返回 id）。绕过它直接
    /// 调平台层就等于投递了一条「没有台账、也没进进程内上下文表」的通知——点击链路直接断。
    #[test]
    fn platform_delivery_has_a_single_production_point() {
        if !cfg!(target_os = "macos") {
            return;
        }
        let needle = concat!("notify::macos::", "deliver(");
        let mut hits = Vec::new();
        collect_source_hits(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
            needle,
            &mut hits,
        );
        assert_eq!(
            hits.len(),
            1,
            "平台层投递只允许在 deliver_with_startup_retry 一处发生，实际命中：{hits:?}"
        );
        assert!(
            hits[0].contains("/lib.rs:"),
            "唯一的投递点应在 lib.rs 的启动重试包装里：{hits:?}"
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
