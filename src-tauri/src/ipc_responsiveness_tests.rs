//! 批次 1（Harness 图片读写 IPC 响应性）的机器判据。
//!
//! 判据不是「命令跑得快不快」，而是**同一台 IPC dispatcher 上，轻量命令在重命令还没完成时
//! 能否回包**：
//!
//! 1. 用 `tauri::test::mock_builder` 注册真实命令（`harness_write_image` /
//!    `harness_read_image` / `document_set_dirty`），挂真实 `VaultState` / `DirtyState`；
//! 2. 一条专用线程串行调用 `Webview::on_message`，模拟单线程 IPC dispatcher——同步命令在
//!    调用线程内联执行，异步命令由宏投到 async 运行时后立刻返回，这正是真机 IPC 的分布；
//! 3. 在重活核心装填 [`crate::command_test_gate`]，投递重命令并等它到达闸门；
//! 4. 闸门**仍关闭**时投递轻量命令 `document_set_dirty`（只写一个 AtomicBool，
//!    `commands.rs` 的既有实现），要求它在闸门关闭期间回包；
//! 5. 无论断言结果如何都先放行闸门、收齐两个响应并 join dispatcher，再判 PASS/FAIL——
//!    避免旧同步实现把测试线程卡死；
//! 6. 最后校验重命令返回、磁盘字节与轻命令的真实副作用，防止「为响应性跳过工作」。
//!
//! 这里置 `#[cfg(test)]` 而不是 `src-tauri/tests/`：闸门钩子是库内 `#[cfg(test)]` 项，
//! 集成测试编译的库不带同样的 test 配置，拿不到它。

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use tauri::Manager;

use crate::commands::{commit_vault_open, DirtyState, PreparedVaultOpen, VaultState};
use crate::fs_io;

/// 写 / 读两条用例各用一个稳定的合成 vault id（`valid_id` 允许字母数字与 `-` / `_`）。
const VAULT_ID: &str = "vault-ipc-response-9001";

// ---------------------------------------------------------------------------
// 临时设施（无 tempfile 依赖，同 commands 单测的既有纪律）
// ---------------------------------------------------------------------------

struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("lumir-ipc-response-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }

    fn path(&self) -> PathBuf {
        self.0.clone()
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// 复原进程级 `XDG_CONFIG_HOME`（断言失败 panic 时也经 Drop 执行）。
struct XdgGuard(Option<std::ffi::OsString>);

impl Drop for XdgGuard {
    fn drop(&mut self) {
        match &self.0 {
            Some(value) => std::env::set_var("XDG_CONFIG_HOME", value),
            None => std::env::remove_var("XDG_CONFIG_HOME"),
        }
    }
}

/// 一次可提交的打开结果（真目录 + 真 watcher；命令只消费 vault 稳定 id）。
fn prepared_vault(root: &Path, vault_id: &str) -> PreparedVaultOpen {
    let policy =
        fs_io::IgnorePolicy::load(root, &[], &crate::config::VaultConfig::default().ignore);
    PreparedVaultOpen {
        root: root.to_path_buf(),
        vault_id: vault_id.to_string(),
        entries: vec![],
        watcher: fs_io::watch(root, &policy, |_| {}).expect("watch temp vault"),
        graph: crate::link_graph::LinkGraph::new(),
        policy,
    }
}

/// 已提交的 vault（与 `commit_vault_open` 的生产路径同一入口）。
fn committed_state(root: &Path, vault_id: &str) -> VaultState {
    let state = VaultState::default();
    assert!(
        commit_vault_open(&state, prepared_vault(root, vault_id)),
        "fresh state commits"
    );
    state
}

/// 合成 1×1 红色 png（与 `harness::attachments` 单测同一份夹具）。
fn tiny_png() -> Vec<u8> {
    let img = image::RgbImage::from_pixel(1, 1, image::Rgb([255, 0, 0]));
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img)
        .write_to(&mut buf, image::ImageFormat::Png)
        .expect("encode png");
    buf.into_inner()
}

// ---------------------------------------------------------------------------
// 单线程 IPC dispatcher（真实 `Webview::on_message`）
// ---------------------------------------------------------------------------

type Response = Result<tauri::ipc::InvokeResponseBody, serde_json::Value>;

struct Job {
    request: tauri::webview::InvokeRequest,
    respond: mpsc::SyncSender<Response>,
}

struct Dispatcher {
    jobs: Option<mpsc::Sender<Job>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Dispatcher {
    fn start(webview: tauri::Webview<tauri::test::MockRuntime>) -> Self {
        let (jobs, receiver) = mpsc::channel::<Job>();
        let thread = std::thread::spawn(move || {
            while let Ok(Job { request, respond }) = receiver.recv() {
                webview.clone().on_message(
                    request,
                    Box::new(move |_webview, _cmd, response, _callback, _error| {
                        let _ = respond.send(match response {
                            tauri::ipc::InvokeResponse::Ok(body) => Ok(body),
                            tauri::ipc::InvokeResponse::Err(error) => Err(error.0),
                        });
                    }),
                );
            }
        });
        Self {
            jobs: Some(jobs),
            thread: Some(thread),
        }
    }

    /// 投递一条 IPC 消息，返回它的回包通道（不阻塞；dispatcher 忙时排队）。
    fn dispatch(&self, cmd: &str, body: serde_json::Value) -> mpsc::Receiver<Response> {
        let (respond, response) = mpsc::sync_channel(1);
        self.jobs
            .as_ref()
            .expect("dispatcher not finished")
            .send(Job {
                request: invoke_request(cmd, body),
                respond,
            })
            .expect("dispatcher thread alive");
        response
    }

    fn finish(mut self) {
        drop(self.jobs.take());
        if let Some(thread) = self.thread.take() {
            thread.join().expect("dispatcher thread");
        }
    }
}

impl Drop for Dispatcher {
    fn drop(&mut self) {
        // 只断开会话，不 join：panic 路径上线程可能仍停在闸门，join 会把测试进程挂住。
        drop(self.jobs.take());
    }
}

fn invoke_request(cmd: &str, body: serde_json::Value) -> tauri::webview::InvokeRequest {
    tauri::webview::InvokeRequest {
        cmd: cmd.to_string(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        url: "tauri://localhost".parse().expect("invoke url"),
        body: tauri::ipc::InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: tauri::test::INVOKE_KEY.to_string(),
    }
}

/// 无论断言成败都清掉未消费的装填（panic 路径不让后续测试或 dispatcher 线程卡死）。
struct GateGuard;

impl Drop for GateGuard {
    fn drop(&mut self) {
        crate::command_test_gate::disarm();
    }
}

/// 测试的公共装配：XDG 指向临时目录、mock app + webview、已提交的 vault 状态。
fn mock_backend(
    vault_root: &Path,
    vault_id: &str,
) -> (
    tauri::App<tauri::test::MockRuntime>,
    tauri::WebviewWindow<tauri::test::MockRuntime>,
) {
    let app = tauri::test::mock_builder()
        .invoke_handler(tauri::generate_handler![
            crate::harness::harness_write_image,
            crate::harness::harness_read_image,
            crate::commands::document_set_dirty,
        ])
        .manage(committed_state(vault_root, vault_id))
        .manage(DirtyState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app");
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("mock webview");
    (app, webview)
}

// ---------------------------------------------------------------------------
// 判据
// ---------------------------------------------------------------------------

/// 写命令不得占住 IPC dispatcher：慢转码 / 落盘期间 `document_set_dirty` 必须回包。
///
/// 旧同步实现下 dispatcher 内联执行写命令，轻命令在闸门放行前不可能回包——本用例因此
/// 先红后绿（修前日志见 `.local/missions/harness-image-ipc/`）。
#[test]
fn harness_write_image_keeps_ipc_dispatcher_responsive() {
    let _serial = crate::command_test_gate::serial();
    let _xdg_lock = crate::harness::xdg_test_lock();
    let config_root = TempDir::new("write-config");
    let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
    std::env::set_var("XDG_CONFIG_HOME", config_root.path().join("xdg"));
    let vault_root = TempDir::new("write-vault");

    let (app, webview) = mock_backend(&vault_root.path(), VAULT_ID);
    let dispatcher = Dispatcher::start(webview.as_ref().clone());
    let _gate = GateGuard;

    let png = tiny_png();
    crate::command_test_gate::arm("harness_write_image", VAULT_ID);
    let heavy = dispatcher.dispatch(
        "harness_write_image",
        serde_json::json!({
            "data_base64": fs_io::base64_encode(&png),
            "source_mime": "image/png",
        }),
    );
    let entered = crate::command_test_gate::wait_entered(Duration::from_secs(5));

    // 闸门仍关闭：轻量命令必须能在同一台 dispatcher 上回包（这一条就是本用例的判据）。
    let light = dispatcher.dispatch("document_set_dirty", serde_json::json!({ "dirty": true }));
    // 先到的回包在这里收下（async 实现）；同步实现收不到，放行后再收。
    let light_while_blocked = light.recv_timeout(Duration::from_secs(2)).ok();

    // 无论上面结果如何：先放行、收齐两个响应、join，再判。
    crate::command_test_gate::release();
    let heavy_response = heavy
        .recv_timeout(Duration::from_secs(10))
        .expect("重命令无论实现如何都必须回包");
    let responded_while_blocked = light_while_blocked.is_some();
    let light_response = match light_while_blocked {
        Some(response) => response,
        None => light
            .recv_timeout(Duration::from_secs(10))
            .expect("轻命令无论实现如何都必须回包"),
    };
    dispatcher.finish();

    assert!(
        entered,
        "重命令必须到达闸门（否则本用例没有构造出被测现场）"
    );
    assert!(
        responded_while_blocked,
        "写命令占住了 IPC dispatcher：闸门关闭期间 document_set_dirty 没有回包——\
         重活必须在 blocking pool 上执行（async fn + spawn_blocking）"
    );
    assert!(light_response.is_ok(), "轻命令必须成功：{light_response:?}");
    assert!(
        app.state::<DirtyState>().is_dirty(),
        "轻命令必须真的执行了（dirty 镜像置位），不能只是被跳过"
    );

    // 「为了响应性跳过工作」的反向判据：返回、磁盘字节、像素尺寸都要成立。
    let written: serde_json::Value = heavy_response
        .expect("写命令必须成功")
        .deserialize()
        .expect("写命令返回 {name,width,height}");
    let name = written["name"].as_str().expect("name").to_string();
    assert!(
        name.starts_with("pasted-") && name.ends_with(".webp"),
        "{name}"
    );
    assert_eq!(written["width"], 1);
    assert_eq!(written["height"], 1);
    let path = crate::config::config_dir()
        .expect("config dir")
        .join("harness/attachments")
        .join(VAULT_ID)
        .join(&name);
    let bytes = std::fs::read(&path).expect("附件必须落盘");
    let decoded = image::load_from_memory(&bytes).expect("落盘字节必须可解码");
    assert_eq!((decoded.width(), decoded.height()), (1, 1));
}

/// 读命令不得占住 IPC dispatcher：读盘期间 `document_set_dirty` 必须回包；返回的 base64
/// 与被读文件逐字节一致。
#[test]
fn harness_read_image_keeps_ipc_dispatcher_responsive() {
    let _serial = crate::command_test_gate::serial();
    let _xdg_lock = crate::harness::xdg_test_lock();
    let config_root = TempDir::new("read-config");
    let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
    std::env::set_var("XDG_CONFIG_HOME", config_root.path().join("xdg"));
    let vault_root = TempDir::new("read-vault");

    // 先经生产写原语落一张附件（闸门未装填，不阻塞）。
    let png = tiny_png();
    let written = crate::harness::attachments::write_image(
        VAULT_ID,
        &fs_io::base64_encode(&png),
        "image/png",
    )
    .expect("准备附件");

    let (app, webview) = mock_backend(&vault_root.path(), VAULT_ID);
    let dispatcher = Dispatcher::start(webview.as_ref().clone());
    let _gate = GateGuard;

    crate::command_test_gate::arm("harness_read_image", VAULT_ID);
    let heavy = dispatcher.dispatch(
        "harness_read_image",
        serde_json::json!({ "name": written.name }),
    );
    let entered = crate::command_test_gate::wait_entered(Duration::from_secs(5));

    let light = dispatcher.dispatch("document_set_dirty", serde_json::json!({ "dirty": true }));
    let light_while_blocked = light.recv_timeout(Duration::from_secs(2)).ok();

    crate::command_test_gate::release();
    let heavy_response = heavy
        .recv_timeout(Duration::from_secs(10))
        .expect("重命令无论实现如何都必须回包");
    let responded_while_blocked = light_while_blocked.is_some();
    let light_response = match light_while_blocked {
        Some(response) => response,
        None => light
            .recv_timeout(Duration::from_secs(10))
            .expect("轻命令无论实现如何都必须回包"),
    };
    dispatcher.finish();

    assert!(
        entered,
        "重命令必须到达闸门（否则本用例没有构造出被测现场）"
    );
    assert!(
        responded_while_blocked,
        "读命令占住了 IPC dispatcher：闸门关闭期间 document_set_dirty 没有回包——\
         读盘必须在 blocking pool 上执行（async fn + spawn_blocking）"
    );
    assert!(light_response.is_ok(), "轻命令必须成功：{light_response:?}");
    assert!(
        app.state::<DirtyState>().is_dirty(),
        "轻命令必须真的执行了（dirty 镜像置位），不能只是被跳过"
    );

    let base64: String = heavy_response
        .expect("读命令必须成功")
        .deserialize()
        .expect("读命令返回 base64 字符串");
    let path = crate::config::config_dir()
        .expect("config dir")
        .join("harness/attachments")
        .join(VAULT_ID)
        .join(&written.name);
    let bytes = std::fs::read(&path).expect("附件文件必须在");
    assert_eq!(
        base64,
        fs_io::base64_encode(&bytes),
        "读命令返回的 base64 必须与被读文件逐字节一致"
    );
}

/// 写操作按**发起时**的 vault 完成：命令在 A 发起、调度期间切到 B，放行后附件仍落 A 的目录，
/// B 的附件目录零新增——闭包 MUST NOT 重新读「当前 vault」，也 MUST NOT 把旧写重投新 vault。
#[test]
fn harness_write_image_lands_in_the_vault_that_started_it() {
    let _serial = crate::command_test_gate::serial();
    let _xdg_lock = crate::harness::xdg_test_lock();
    let config_root = TempDir::new("switch-config");
    let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
    std::env::set_var("XDG_CONFIG_HOME", config_root.path().join("xdg"));
    let vault_a = TempDir::new("switch-vault-a");
    let vault_b = TempDir::new("switch-vault-b");
    let id_a = "vault-ipc-switch-a";
    let id_b = "vault-ipc-switch-b";

    let (app, webview) = mock_backend(&vault_a.path(), id_a);
    let dispatcher = Dispatcher::start(webview.as_ref().clone());
    let _gate = GateGuard;

    let png = tiny_png();
    crate::command_test_gate::arm("harness_write_image", id_a);
    let heavy = dispatcher.dispatch(
        "harness_write_image",
        serde_json::json!({
            "data_base64": fs_io::base64_encode(&png),
            "source_mime": "image/png",
        }),
    );
    assert!(
        crate::command_test_gate::wait_entered(Duration::from_secs(5)),
        "重命令必须到达闸门（否则切 vault 的时序没有构造出来）"
    );

    // 调度期间切到 B：真实 VaultState 提交（与 vault_open 同一条入口）。
    assert!(commit_vault_open(
        &app.state::<VaultState>(),
        prepared_vault(&vault_b.path(), id_b),
    ));

    crate::command_test_gate::release();
    let response = heavy
        .recv_timeout(Duration::from_secs(10))
        .expect("重命令必须回包");
    dispatcher.finish();

    let written: serde_json::Value = response
        .expect("写命令必须成功")
        .deserialize()
        .expect("写命令返回 {name,width,height}");
    let name = written["name"].as_str().expect("name");
    let attachments = crate::config::config_dir()
        .expect("config dir")
        .join("harness/attachments");
    assert!(
        attachments.join(id_a).join(name).is_file(),
        "附件必须落在发起时的 vault A"
    );
    assert!(
        !attachments.join(id_b).exists(),
        "切到 B 之后 MUST NOT 新建 / 改写 B 的附件目录"
    );
}

#[test]
fn harness_send_rejects_invalid_skill_json_without_changing_session() {
    let _serial = crate::command_test_gate::serial();
    let _xdg_lock = crate::harness::xdg_test_lock();
    let config_root = TempDir::new("invalid-skill-json-config");
    let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
    std::env::set_var("XDG_CONFIG_HOME", config_root.path().join("xdg"));
    let vault_root = TempDir::new("invalid-skill-json-vault");
    let fixture = config_root.path().join("fixture.json");
    std::fs::write(
        &fixture,
        r#"{"version":1,"responses":[{"text":"baseline"}]}"#,
    )
    .expect("write mock fixture");
    std::fs::create_dir_all(config_root.path().join("xdg/lumir")).expect("create config dir");
    std::fs::write(
        config_root.path().join("xdg/lumir/config.json"),
        serde_json::json!({
            "harness": {
                "provider": "mock",
                "providers": {"mock": {"preset": "mock", "fixture": fixture}},
            }
        })
        .to_string(),
    )
    .expect("write mock config");

    let state = committed_state(&vault_root.path(), VAULT_ID);
    let (root, policy, vault_id) = state.root_policy_and_id().expect("scope");
    let scope = crate::harness::VaultScope {
        root,
        policy,
        vault_id,
    };
    let runtime = crate::harness::Runtime::default();
    let config = crate::config::test_mock(None);
    runtime.acquire_turn(&scope, &config).expect("seed session");
    let baseline_input = runtime
        .with_session(&scope, |session| {
            session.push_input(crate::harness::session::user_item("BASELINE-INPUT"));
            session.input().to_vec()
        })
        .expect("seed baseline input");
    runtime.release_turn(&scope);
    let baseline_session = runtime
        .current_session_id(&scope)
        .expect("baseline session");

    let app = tauri::test::mock_builder()
        .invoke_handler(tauri::generate_handler![crate::harness::harness_send])
        .manage(state)
        .manage(runtime.clone())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app");
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("mock webview");
    let dispatcher = Dispatcher::start(webview.as_ref().clone());

    for skills_json in ["not-json", "{}", r#"[1]"#] {
        let response = dispatcher
            .dispatch(
                "harness_send",
                serde_json::json!({
                    "parts_json": "[]",
                    "context_json": "",
                    "skills_json": skills_json,
                }),
            )
            .recv_timeout(Duration::from_secs(5))
            .expect("invalid send must settle");
        let error = response.expect_err("invalid skills_json must reject");
        assert_eq!(error["code"], "harness_skills_invalid", "{error}");
        let current_input = runtime
            .with_session(&scope, |session| session.input().to_vec())
            .expect("read session input");
        assert_eq!(current_input, baseline_input, "非法输入不得改变既有 input");
        assert_eq!(
            runtime.current_session_id(&scope),
            Some(baseline_session.clone())
        );
    }
    dispatcher.finish();
}
