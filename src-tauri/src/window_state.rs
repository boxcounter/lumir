//! 主窗口尺寸的持久化与恢复（change startup-window-pane-defaults，design §3）。
//!
//! **只记尺寸**（裁决点 1，Alex 2026-10-10：「窗口只需要记住尺寸，不需要记住位置」）：位置
//! 不落盘、不恢复、启动时也不施加，两次启动之间的位置交给 OS 默认放置。因此本模块没有
//! `x` / `y` 的读写路径，也没有跨显示器的位置校验——**存尺寸、算尺寸**就是全部。
//!
//! **为什么是独立小文件**：窗口尺寸是**应用级单份**的易变界面状态（不按 vault 分区），与
//! `vault-sessions/`（per-vault 布局）、`reading-positions/`（per-vault 阅读位置）同级落在
//! 配置目录根下、单文件 `window-state.json`。MUST NOT 混进 `config.json`——身份 / 配置文件
//! 不承载易变界面状态（`vault_session.rs` 文件头的既有裁决理由），也不为此新增配置键。
//!
//! **写入纪律**照 `reading_position.rs`：tmp + rename 原子替换；写失败降级 warning、不拦停
//! 退出。写侧在独立的 `lumir-window-state` 线程上防抖（[`DEBOUNCE_INTERVAL`]）落盘——窗口
//! 缩放每秒可产生几十个 `Resized` 事件，MUST NOT 在事件回调里同步写盘；进程退出前 [`flush`]
//! 兜住「防抖窗口内就退出」这一条窄路径。
//!
//! **读取纪律**：文件缺失 / 不可读 / 非合法 JSON / `version` 与实现不符 / 尺寸字段缺失 /
//! 尺寸字段类型非法，六类对调用方的语义完全相同——「没有存档，按首启规则算尺寸」，一律不
//! 抛错、不阻断启动。文件缺失是首启常态、不报警；其余五类各记一条 warning（见 [`Rejected`]）。
//! 存档里的未知字段一律忽略：本 change 尚未发布、无存量存档，MUST NOT 引入兼容层。
//!
//! **单位**：存档是**逻辑像素（点）**——跨 Retina / 非 Retina 显示器迁移时逻辑尺寸稳定而
//! 物理像素不稳定。物理 ↔ 逻辑的换算（[`to_logical`] / [`to_physical`]）只在这里实现一份，
//! 调用方（`lib.rs` 的接线）注入 `scale_factor`。

use crate::config;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
        OnceLock,
    },
    time::Duration,
};

/// 存档 schema 版本：与文件不符者按「没有存档」处理（不尝试向后兼容解释）。
pub const WINDOW_STATE_VERSION: u32 = 1;

/// 存档文件名（配置目录根下，与 `vault-sessions/` / `reading-positions/` 同级）。
pub const FILE_NAME: &str = "window-state.json";

/// 尺寸变化后的写盘静默期：这段窗口内没有新的 `Resized` 才落盘一次。
pub const DEBOUNCE_INTERVAL: Duration = Duration::from_millis(500);

/// 退出前 flush 等待写线程应答的上限（超时即返回，不阻塞退出）。
const FLUSH_TIMEOUT: Duration = Duration::from_millis(1000);

/// 存档内容：**只有尺寸**（逻辑点）。位置（`x` / `y`）刻意没有字段——落盘形状即裁决点 1。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WindowState {
    pub version: u32,
    pub width: u32,
    pub height: u32,
}

// ---------------------------------------------------------------------------
// 尺寸算式（纯函数：零窗口 API，工作区矩形与 scale 都由调用方注入，可单测）
// ---------------------------------------------------------------------------

/// 首启尺寸：工作区的 90%，四舍五入取整（design §3.2）。输入输出同为物理像素；调用方传
/// `Monitor::work_area()` 的尺寸，不存在逻辑 / 物理换算误差。
pub fn first_launch_size(work_w: u32, work_h: u32) -> (u32, u32) {
    (
        round_scaled(work_w, 0.9).min(work_w),
        round_scaled(work_h, 0.9).min(work_h),
    )
}

/// 把存档尺寸逐维钳进工作区（design §3.5，两个尺寸必须同单位）。不超过工作区的那一维**原样
/// 保留**——把窗口放大到接近满屏是合法状态，MUST NOT 被无谓收缩。
pub fn clamp_to_work(size: (u32, u32), work: (u32, u32)) -> (u32, u32) {
    (size.0.min(work.0), size.1.min(work.1))
}

/// 物理像素 → 逻辑点（`u32` 语义，四舍五入——与 dpi 的 `PhysicalSize::to_logical` 同口径）。
pub fn to_logical(physical: u32, scale: f64) -> u32 {
    round_scaled(physical, 1.0 / positive_scale(scale))
}

/// 逻辑点 → 物理像素（`LogicalSize::to_physical` 同口径）。
pub fn to_physical(logical: u32, scale: f64) -> u32 {
    round_scaled(logical, positive_scale(scale))
}

fn round_scaled(value: u32, factor: f64) -> u32 {
    (value as f64 * factor).round() as u32
}

/// `scale_factor` 理论上恒为正；真出现 0 / 负 / NaN 时按 1.0（等价不缩放），避免算出 0 尺寸。
fn positive_scale(scale: f64) -> f64 {
    if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    }
}

// ---------------------------------------------------------------------------
// 存档读写
// ---------------------------------------------------------------------------

/// 存档路径：配置目录根下的 `window-state.json`。
pub fn state_path() -> Result<PathBuf, crate::commands::CommandError> {
    Ok(config::config_dir()?.join(FILE_NAME))
}

/// 读存档（默认配置目录）。目录不可解析或无存档都返回 `None`——调用方按首启规则算尺寸。
pub fn load() -> Option<WindowState> {
    load_from(&config::config_dir().ok()?)
}

/// 读存档（目录可注入：测试不碰真实配置目录）。
///
/// 返回 `None` = 没有可用的存档：文件缺失 / 不可读 / 非合法 JSON / `version` 不符 / 尺寸
/// 字段缺失或类型非法，六种情况的调用方语义完全相同（[`Rejected`] 记后五类的 warning）。
pub fn load_from(dir: &Path) -> Option<WindowState> {
    let path = dir.join(FILE_NAME);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        // 文件不存在 = 首启常态，静默走首启规则。
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(e) => {
            warn(&path, &Rejected::Unreadable(e.to_string()));
            return None;
        }
    };
    match parse(&text) {
        Ok(state) => Some(state),
        Err(reason) => {
            warn(&path, &reason);
            None
        }
    }
}

/// 落盘（目录可注入）：tmp + rename 原子替换，与 `reading_position::save_to` 同纪律。
/// 返回 `io::Result`——降级语义由调用方给（见写线程 [`write_pending`]）。
fn save_to(dir: &Path, state: &WindowState) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let path = dir.join(FILE_NAME);
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(state)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, &path)
}

/// 读侧拒绝原因（「文件缺失」不在此列：那是首启常态、不报警）。
///
/// 分这么细只为 warning 可读与单测可断言——对调用方的语义全部是「没有存档」。
#[derive(Debug, Clone, PartialEq)]
enum Rejected {
    /// 文件存在但读不出来（权限 / 是目录 / 其它 IO 错误）。
    Unreadable(String),
    /// 不是合法 JSON。
    NotJson(String),
    /// `version` 与实现不符。
    VersionMismatch(u64),
    /// `version` / `width` / `height` 缺失。
    MissingField(&'static str),
    /// 字段类型非法（字符串 / 小数 / 负数 / 0 / 超出 `u32`）。
    WrongType(&'static str),
}

/// 解析存档文本。手工逐字段取数（而非直接 `serde_json::from_str::<WindowState>`）是为了把
/// 「字段缺失」与「类型非法」两类降级分开报，也让未知字段天然被忽略（只读认识的三个键）。
fn parse(text: &str) -> Result<WindowState, Rejected> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| Rejected::NotJson(e.to_string()))?;
    let Some(map) = value.as_object() else {
        return Err(Rejected::WrongType("顶层结构"));
    };
    match map.get("version") {
        None => return Err(Rejected::MissingField("version")),
        Some(v) => match v.as_u64() {
            Some(n) if n == WINDOW_STATE_VERSION as u64 => {}
            Some(n) => return Err(Rejected::VersionMismatch(n)),
            None => return Err(Rejected::WrongType("version")),
        },
    }
    Ok(WindowState {
        version: WINDOW_STATE_VERSION,
        width: dimension(map, "width")?,
        height: dimension(map, "height")?,
    })
}

/// 取一个尺寸字段：必须是 `1..=u32::MAX` 的整数——0 尺寸的窗口对用户不可操作，按非法值回落
/// 首启规则（用户改坏的存档因此仍能自愈）。
fn dimension(
    map: &serde_json::Map<String, serde_json::Value>,
    key: &'static str,
) -> Result<u32, Rejected> {
    match map.get(key) {
        None => Err(Rejected::MissingField(key)),
        Some(v) => match v.as_u64() {
            Some(n) if (1..=u32::MAX as u64).contains(&n) => Ok(n as u32),
            _ => Err(Rejected::WrongType(key)),
        },
    }
}

fn warn(path: &Path, reason: &Rejected) {
    let detail = match reason {
        Rejected::Unreadable(e) => format!("不可读：{e}"),
        Rejected::NotJson(e) => format!("不可解析：{e}"),
        Rejected::VersionMismatch(v) => {
            format!("版本 v{v} 不是本版支持的 v{WINDOW_STATE_VERSION}")
        }
        Rejected::MissingField(key) => format!("缺字段 `{key}`"),
        Rejected::WrongType(key) => format!("字段 `{key}` 类型非法"),
    };
    eprintln!(
        "lumir: 窗口尺寸存档不可用（按首启规则算尺寸）：{}：{detail}",
        path.display()
    );
}

// ---------------------------------------------------------------------------
// 写侧：防抖落盘线程（与 logging 的落盘线程同形）
// ---------------------------------------------------------------------------

/// 写线程收到的两类消息。
enum Msg {
    /// 窗口尺寸变化（逻辑点）——只更新缓存，静默期到期才写盘。
    Size(u32, u32),
    /// 显式刷盘：写完当前缓存后应答（进程退出路径用）。
    Flush(Sender<()>),
}

/// 尺寸落盘器：调用侧只发通道，写盘在 `lumir-window-state` 线程。
struct Writer {
    tx: Sender<Msg>,
}

impl Writer {
    fn start(dir: PathBuf, debounce: Duration) -> Writer {
        let (tx, rx) = mpsc::channel();
        if let Err(e) = std::thread::Builder::new()
            .name("lumir-window-state".to_string())
            .spawn(move || writer_loop(rx, dir, debounce))
        {
            // 线程起不来（资源耗尽）：尺寸不落盘，绝不因此让应用起不来（通道断开后
            // `record` / `flush` 的 send 立即失败，自然降级）。
            eprintln!("lumir: 窗口尺寸写线程启动失败，本次会话不记录窗口尺寸：{e}");
        }
        Writer { tx }
    }

    /// 记一次尺寸变化：写线程已死 / 通道断开时静默丢弃。
    fn record(&self, width: u32, height: u32) {
        let _ = self.tx.send(Msg::Size(width, height));
    }

    /// 把当前缓存落盘并等写线程应答（超时即返回，不阻塞退出）。
    fn flush(&self) {
        let (done_tx, done_rx) = mpsc::channel();
        if self.tx.send(Msg::Flush(done_tx)).is_err() {
            return;
        }
        let _ = done_rx.recv_timeout(FLUSH_TIMEOUT);
    }
}

/// 写线程主循环：静默期内的连续尺寸变化只落盘最后一次。
fn writer_loop(rx: Receiver<Msg>, dir: PathBuf, debounce: Duration) {
    let mut pending: Option<(u32, u32)> = None;
    loop {
        match rx.recv_timeout(debounce) {
            Ok(Msg::Size(width, height)) => pending = Some((width, height)),
            Ok(Msg::Flush(done)) => {
                write_pending(&dir, &mut pending);
                let _ = done.send(());
            }
            // 静默期到期：缓存落盘（防抖语义在这里生效）。
            Err(RecvTimeoutError::Timeout) => write_pending(&dir, &mut pending),
            // 写侧通道全断：退出前尽力把缓存写掉。
            Err(RecvTimeoutError::Disconnected) => {
                write_pending(&dir, &mut pending);
                return;
            }
        }
    }
}

fn write_pending(dir: &Path, pending: &mut Option<(u32, u32)>) {
    let Some((width, height)) = pending.take() else {
        return;
    };
    let state = WindowState {
        version: WINDOW_STATE_VERSION,
        width,
        height,
    };
    if let Err(e) = save_to(dir, &state) {
        eprintln!(
            "lumir: 记录窗口尺寸失败（已忽略，不影响使用）：{}：{e}",
            dir.join(FILE_NAME).display()
        );
    }
}

/// 进程内唯一落盘器。只有 `lib.rs` 的 `setup` 调用 [`init`] 才会建立——测试因此天然走注入
/// 路径（`load_from` / `save_to`），不会把尺寸写进**真实**配置目录（`logging` 的同类教训）。
static WRITER: OnceLock<Writer> = OnceLock::new();

/// 启动时初始化写线程（`lib.rs` 的 `setup`，早于任何 `Resized` 事件）。
pub fn init() {
    let dir = match config::config_dir() {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("lumir: 窗口尺寸不记录：{}", e.message);
            return;
        }
    };
    let _ = WRITER.set(Writer::start(dir, DEBOUNCE_INTERVAL));
}

/// 记一次窗口尺寸变化（逻辑点）。`init` 未调用时无操作。
pub fn record_size(width: u32, height: u32) {
    if let Some(writer) = WRITER.get() {
        writer.record(width, height);
    }
}

/// 退出前把防抖窗口内的尺寸落盘（`lib.rs` 的 `RunEvent::Exit`）。
pub fn flush() {
    if let Some(writer) = WRITER.get() {
        writer.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// 无 tempfile 依赖（低依赖取向）：pid + 序号造唯一目录，Drop 时删除。
    struct TempDir(PathBuf);
    static SEQ: AtomicU32 = AtomicU32::new(0);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "lumir-window-state-test-{}-{}",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).expect("create temp dir");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn state(width: u32, height: u32) -> WindowState {
        WindowState {
            version: WINDOW_STATE_VERSION,
            width,
            height,
        }
    }

    #[test]
    fn round_trip_keeps_size_and_leaves_no_partial_file() {
        let dir = TempDir::new();
        let written = state(1512, 945);
        save_to(dir.path(), &written).expect("write window state");
        assert_eq!(load_from(dir.path()), Some(written));
        // 原子替换：临时文件不得留在盘上（否则下次读到的可能是半个 JSON）
        assert!(!dir.path().join("window-state.json.tmp").exists());
        let names: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec![FILE_NAME.to_string()]);
    }

    /// 存档形状即裁决点 1：**只有** `version` / `width` / `height`，位置字段一个都不写。
    #[test]
    fn archive_carries_size_only() {
        let json = serde_json::to_value(state(1512, 945)).expect("serialize");
        let mut keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort();
        assert_eq!(keys, vec!["height", "version", "width"]);
    }

    #[test]
    fn missing_file_is_no_archive() {
        let dir = TempDir::new();
        assert_eq!(load_from(dir.path()), None);
    }

    #[test]
    fn unreadable_file_is_no_archive() {
        let dir = TempDir::new();
        // 目标是目录：read_to_string 报 IsADirectory（非 NotFound）——归「不可读」一类
        fs::create_dir_all(dir.path().join(FILE_NAME)).unwrap();
        assert_eq!(load_from(dir.path()), None);
    }

    #[test]
    fn corrupt_json_is_no_archive() {
        let dir = TempDir::new();
        fs::write(dir.path().join(FILE_NAME), "{not json").unwrap();
        assert_eq!(load_from(dir.path()), None);
        assert!(matches!(parse("{not json"), Err(Rejected::NotJson(_))));
    }

    /// 顶层是合法 JSON 但不是对象（仓库级类型非法的一支）。
    #[test]
    fn non_object_root_is_no_archive() {
        assert_eq!(parse("[1,2]"), Err(Rejected::WrongType("顶层结构")));
    }

    #[test]
    fn version_mismatch_is_no_archive() {
        let dir = TempDir::new();
        fs::write(
            dir.path().join(FILE_NAME),
            r#"{"version":99,"width":1200,"height":800}"#,
        )
        .unwrap();
        assert_eq!(load_from(dir.path()), None);
        assert_eq!(
            parse(r#"{"version":99,"width":1200,"height":800}"#),
            Err(Rejected::VersionMismatch(99))
        );
    }

    #[test]
    fn missing_fields_are_no_archive() {
        assert_eq!(
            parse(r#"{"width":1200,"height":800}"#),
            Err(Rejected::MissingField("version"))
        );
        assert_eq!(
            parse(r#"{"version":1,"height":800}"#),
            Err(Rejected::MissingField("width"))
        );
        assert_eq!(
            parse(r#"{"version":1,"width":1200}"#),
            Err(Rejected::MissingField("height"))
        );
    }

    #[test]
    fn wrong_typed_fields_are_no_archive() {
        assert_eq!(
            parse(r#"{"version":"1","width":1200,"height":800}"#),
            Err(Rejected::WrongType("version"))
        );
        assert_eq!(
            parse(r#"{"version":1,"width":"1200","height":800}"#),
            Err(Rejected::WrongType("width"))
        );
        assert_eq!(
            parse(r#"{"version":1,"width":1200.5,"height":800}"#),
            Err(Rejected::WrongType("width"))
        );
        assert_eq!(
            parse(r#"{"version":1,"width":-1200,"height":800}"#),
            Err(Rejected::WrongType("width"))
        );
        // 0 尺寸的窗口不可操作：按非法值回落首启规则
        assert_eq!(
            parse(r#"{"version":1,"width":0,"height":800}"#),
            Err(Rejected::WrongType("width"))
        );
    }

    /// 未知字段忽略：不引入兼容层（无存量存档、无消费者），也不把位置字段读进来。
    #[test]
    fn unknown_fields_are_ignored() {
        let parsed = parse(r#"{"version":1,"width":1512,"height":945,"x":100,"y":50}"#);
        assert_eq!(parsed, Ok(state(1512, 945)));
    }

    #[test]
    fn write_failure_is_reported_and_leaves_archive_intact() {
        let dir = TempDir::new();
        let first = state(1000, 700);
        save_to(dir.path(), &first).expect("write first");

        // 目标目录的父路径是一个普通文件 → create_dir_all 必失败
        let blocker = dir.path().join("blocker");
        fs::write(&blocker, "x").unwrap();
        assert!(save_to(&blocker.join("nested"), &state(1200, 800)).is_err());

        // 失败不 panic（上面那行不炸即证），也不动已有存档
        assert_eq!(load_from(dir.path()), Some(first));
    }

    #[test]
    fn first_launch_size_is_ninety_percent_rounded() {
        // 1512 * 0.9 = 1360.8 → 1361；982 * 0.9 = 883.8 → 884
        assert_eq!(first_launch_size(1512, 982), (1361, 884));
        assert_eq!(first_launch_size(1920, 1080), (1728, 972));
        // 极窄：0.9 取整后仍至少 1 像素
        assert_eq!(first_launch_size(1, 1), (1, 1));
    }

    #[test]
    fn first_launch_size_never_exceeds_work_area() {
        for (w, h) in [(1u32, 2u32), (100, 100), (4000, 3000), (u32::MAX, 1)] {
            let (tw, th) = first_launch_size(w, h);
            assert!(tw <= w && th <= h, "{w}x{h} 的 90% 越出工作区");
        }
    }

    /// 钳制只落在超出工作区的那一维；小于工作区的尺寸原样保留（不无谓收缩）。
    #[test]
    fn clamp_shrinks_only_the_oversized_dimension() {
        assert_eq!(clamp_to_work((2000, 1000), (1920, 1080)), (1920, 1000));
        assert_eq!(clamp_to_work((1000, 2000), (1920, 1080)), (1000, 1080));
        assert_eq!(clamp_to_work((2000, 2000), (1920, 1080)), (1920, 1080));
        assert_eq!(clamp_to_work((800, 600), (1920, 1080)), (800, 600));
        assert_eq!(clamp_to_work((1920, 1080), (1920, 1080)), (1920, 1080));
    }

    #[test]
    fn logical_physical_round_trip() {
        // Retina（scale 2）：3024 物理 = 1512 点
        assert_eq!(to_logical(3024, 2.0), 1512);
        assert_eq!(to_physical(1512, 2.0), 3024);
        // 非整数缩放（scale 1.5）：1200 → 800 → 1200
        assert_eq!(to_logical(1200, 1.5), 800);
        assert_eq!(to_physical(800, 1.5), 1200);
        // scale 非法（0 / NaN）：按 1.0 处理，不产生 0 尺寸
        assert_eq!(to_logical(1200, 0.0), 1200);
        assert_eq!(to_physical(1200, f64::NAN), 1200);
    }
}
