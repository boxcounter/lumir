//! 运行时诊断日志——JSONL 事件落盘（change add-diagnostics-logging）。
//!
//! ## 定位
//!
//! AI-only 开发模式（ADR 0004）下运行时对 agent 是全黑的：本模块把关键运行时事件以
//! JSONL（每行一个 JSON 对象）写进 `<config_dir>/logs/YYYY-MM-DD.jsonl`，agent 会话直接
//! 读文件定位「哪里卡住」（保存冲突、崩溃恢复、渲染失败、性能毛刺）。它**不是**遥测：
//! 只落本地、不经网络外发、绝不写进 vault（ADR 0003 §3），负载里没有文档正文与键入内容
//! （机制化护栏见下面「白名单」）。
//!
//! ## 非阻塞写入（ADR 0002 §6 性能合同）
//!
//! 调用线程只做「白名单校验 + 取时间戳 + 通道发送」，不做任何文件 IO；落盘在专门的
//! `lumir-log` 线程上按批进行（静默期 200ms 内的同批事件一次 open + write_all，单批上限
//! 256 条）。进程退出时 lib.rs 调 [`flush`] 尽力把缓冲刷盘；进程被强杀最多丢一个批次。
//!
//! ## 日期口径：UTC
//!
//! `ts` 是带 `Z` 的 ISO 8601（`2026-09-16T05:12:33.123Z`），文件名取同一 UTC 日期。选
//! UTC 是因为 Rust core 没有本地时区来源（std 不提供偏移），为日志文件名引入 chrono /
//! libc 之类依赖不值当，而单一时区口径无歧义。代价：UTC+8 的 00:00–08:00 事件落在
//! 「昨天的」文件里——读日志按 UTC 日期取文件（`ls logs/` 即可，最多两个候选）。
//!
//! ## 滚动与体积治理
//!
//! - 单文件 5MB：追加会越限时删档重开（保留最近窗口，丢最旧），把「刚发生的事」留给
//!   读日志的人。
//! - 保留最近 7 天 / 最多 10 个文件（先到为准）：按日一文时 7 天先到，10 文件上限是
//!   防御（时钟回拨、手工放进来的文件）。
//! - 清理只在**写入跃迁**时触发（目标文件换了一个：跨日或进程内首次写入），且幂等
//!   ——沿注册表 ghost tmp 的惰性治理口径（见 fs_io），不在事件路径上扫目录。
//!
//! ## 白名单（隐私边界）
//!
//! 事件名与字段名都必须在白名单内（[`LogEventName`] 与 [`LogEventName::allowed_fields`]），
//! 字段值上限 256 字符；白名单外的负载直接拒绝（`log_event` 命令返回 `log_event_rejected`）。
//! 这条边界是机制化的隐私护栏：渲染失败的原始错误文本会带上文档片段（mermaid 解析错误
//! 含图表源码、KaTeX 错误含公式尾部），所以只记分类后的错误码，不记原文。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use ts_rs::TS;

use crate::commands::CommandError;
use crate::config::LogLevel;

/// 单文件上限：追加会越限时删档重开（滚动保留最近窗口）。
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
/// 保留天数（含当日；先到为准）。
const RETAIN_DAYS: i64 = 7;
/// 保留文件数上限（先到为准；按日一文时 7 天规则先到，本项是防御）。
const MAX_FILES: usize = 10;
/// 单批事件上限：稳态高频流下也不让单次写入过大。
const MAX_BATCH: usize = 256;
/// 字段值上限（字符）：白名单之外的第二道护栏——防止把正文当诊断字段塞进来。
const MAX_VALUE_CHARS: usize = 256;
/// 批次静默期：距上一条事件超过此时长即落盘（同时也是单条事件的最大落盘延迟）。
const FLUSH_INTERVAL: Duration = Duration::from_millis(200);
/// flush 等待写线程应答的上限。
const FLUSH_TIMEOUT: Duration = Duration::from_secs(5);

/// v0 事件集：事件名白名单的**唯一来源**。TS 联合类型由 ts-rs 导出（`src/bindings/`），
/// 前端 import 使用——前端不另立一份事件名清单（两份清单必然漂移，M131 的教训）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum LogEventName {
    /// 保存 CAS 冲突（磁盘已被外部修改）。
    SaveConflict,
    /// 外部修改命中打开中的文档（watch 事件流）。
    SaveExternalChange,
    /// 自动保存暂停（冲突 / 外部修改 / 目标被删）。
    AutosavePaused,
    /// 自动保存恢复（暂停态解除）。
    AutosaveResumed,
    /// 崩溃备份写入。
    RecoveryWritten,
    /// 崩溃备份被恢复入口取走。
    RecoveryRestored,
    /// 渲染失败（mermaid / katex）。
    RenderError,
    /// 配置 warning（含 [keys] / [log] 的逐项回退）。
    ConfigWarning,
    /// 后台回调超 16ms 预算的采样。
    SlowCallback,
    /// 链接激活（M144 引入外链打开，M145 扩为按类别记录）：交给系统默认应用的结果
    /// 与前端分类出的其它类别（internal-md / anchor / blocked-scheme）。
    LinkOpen,
}

impl LogEventName {
    /// 落盘用的事件名（= TS 联合类型的字面量）。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SaveConflict => "save_conflict",
            Self::SaveExternalChange => "save_external_change",
            Self::AutosavePaused => "autosave_paused",
            Self::AutosaveResumed => "autosave_resumed",
            Self::RecoveryWritten => "recovery_written",
            Self::RecoveryRestored => "recovery_restored",
            Self::RenderError => "render_error",
            Self::ConfigWarning => "config_warning",
            Self::SlowCallback => "slow_callback",
            Self::LinkOpen => "link_open",
        }
    }

    /// 写入每行 `level` 字段的事件级别。注意它**不参与过滤**：`[log] level` 只有
    /// info / off 两档（裁决点 1），info 档下落盘全部事件；这里只标注严重度，供读日志的
    /// agent 快速分流（正常事件 / 需要注意 / 失败）。
    fn level(self) -> &'static str {
        match self {
            Self::SaveConflict
            | Self::AutosavePaused
            | Self::ConfigWarning
            | Self::SlowCallback => "warn",
            Self::RenderError => "error",
            _ => "info",
        }
    }

    /// 字段白名单：该事件允许出现的字段名，其余一律拒绝。
    fn allowed_fields(self) -> &'static [&'static str] {
        match self {
            Self::SaveConflict => &["path", "code"],
            Self::SaveExternalChange => &["path", "change"],
            Self::AutosavePaused | Self::AutosaveResumed => &["path", "reason"],
            Self::RecoveryWritten | Self::RecoveryRestored => &["path"],
            // stage/code 是分类后的结果；原始错误文本（含文档片段）不入日志。
            Self::RenderError => &["kind", "stage", "code"],
            Self::ConfigWarning => &["source", "message"],
            Self::SlowCallback => &["name", "ms"],
            // `category` 是链接类别（M145）：external / internal-md / asset / anchor /
            // blocked-scheme；`scheme` 只有外链路径上有值（http / https / mailto 这类
            // 小词表）。**不记 URL 与目标原文**——那是文档内容，本模块的隐私边界不允许
            // 正文进日志（见模块头）。
            Self::LinkOpen => &["category", "scheme", "outcome"],
        }
    }
}

/// 一条待落盘事件：`at` 是构造时刻（`ts` 取它，不是落盘时刻），字段已按白名单归一
/// （键取白名单里的 `'static str`）。
#[derive(Debug, Clone)]
struct Event {
    name: LogEventName,
    at: SystemTime,
    fields: Vec<(&'static str, String)>,
}

impl Event {
    fn new(name: LogEventName) -> Self {
        Self {
            name,
            at: SystemTime::now(),
            fields: Vec::new(),
        }
    }

    fn field(mut self, key: &'static str, value: impl Into<String>) -> Self {
        self.fields.push((key, value.into()));
        self
    }
}

// ---------------------------------------------------------------------------
// 落盘器：调用侧只发通道，写盘在 lumir-log 线程
// ---------------------------------------------------------------------------

/// 写线程收到的两类消息。
enum Msg {
    Event(Event),
    /// 显式刷盘：写完当前批次后应答（test 用；lib.rs 退出时也用）。
    Flush(Sender<()>),
}

/// 诊断日志落盘器。`enabled = false`（`[log] level = "off"`）时事件在入口即丢弃，
/// 连 `logs/` 目录都不会创建。
struct Sink {
    enabled: AtomicBool,
    tx: Sender<Msg>,
}

impl Sink {
    /// 起一个落盘线程。`flush_interval` 是批次静默期（测试注入长值以获得确定性批次）。
    fn start(dir: PathBuf, level: LogLevel, flush_interval: Duration) -> Sink {
        let (tx, rx) = mpsc::channel();
        let worker_dir = dir.clone();
        let spawned = std::thread::Builder::new()
            .name("lumir-log".to_string())
            .spawn(move || writer_loop(rx, worker_dir, flush_interval));
        if let Err(e) = spawned {
            // 写线程起不来（资源耗尽）：日志降级为丢弃，绝不因此让应用起不来。
            // 起不来时 rx 随闭包被丢，send 立即失败，emit 自然丢弃。
            eprintln!("lumir: 诊断日志写线程启动失败，本次会话日志丢弃：{e}");
        }
        Sink {
            enabled: AtomicBool::new(level == LogLevel::Info),
            tx,
        }
    }

    fn emit(&self, event: Event) {
        if !self.enabled.load(Ordering::Relaxed) {
            return; // off：事件丢弃不写盘（spec「关闭日志」）
        }
        // 写线程已死 / 通道断开：丢弃，日志不反噬调用方。
        let _ = self.tx.send(Msg::Event(event));
    }

    /// 把当前缓冲刷盘并等写线程应答（超时即返回，不阻塞调用方）。
    fn flush(&self) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }
        let (done_tx, done_rx) = mpsc::channel();
        if self.tx.send(Msg::Flush(done_tx)).is_err() {
            return;
        }
        let _ = done_rx.recv_timeout(FLUSH_TIMEOUT);
    }
}

/// 写线程主循环：把静默期内的同批事件聚起来一次写盘。
fn writer_loop(rx: Receiver<Msg>, dir: PathBuf, flush_interval: Duration) {
    let mut target: Option<PathBuf> = None;
    let mut batch: Vec<Event> = Vec::new();
    loop {
        match rx.recv_timeout(flush_interval) {
            Ok(Msg::Event(event)) => {
                batch.push(event);
                if batch.len() >= MAX_BATCH {
                    write_batch(&dir, &mut target, &mut batch);
                }
            }
            Ok(Msg::Flush(done)) => {
                write_batch(&dir, &mut target, &mut batch);
                let _ = done.send(());
            }
            // 静默期到期：批次落盘（批量语义在这里生效）。
            Err(RecvTimeoutError::Timeout) => write_batch(&dir, &mut target, &mut batch),
            // 写侧通道全断：退出前尽力把缓冲写掉。
            Err(RecvTimeoutError::Disconnected) => {
                write_batch(&dir, &mut target, &mut batch);
                return;
            }
        }
    }
}

/// 把一批事件追加到当日 JSONL 文件（一次 open + 一次 write_all）。
/// `target` 是进程内当前打开的目标文件，用于识别「写入跃迁」。
fn write_batch(dir: &Path, target: &mut Option<PathBuf>, batch: &mut Vec<Event>) {
    if batch.is_empty() {
        return;
    }
    let today = Day::of(SystemTime::now());
    let path = dir.join(today.file_name());
    if target.as_deref() != Some(path.as_path()) {
        // 写入跃迁（跨日 / 进程内首次写入）：惰性清理的唯一触发点，幂等。
        sweep(dir, today);
        *target = Some(path.clone());
    }
    let mut bytes: Vec<u8> = Vec::new();
    for event in batch.iter() {
        bytes.extend_from_slice(encode(event).as_bytes());
        bytes.push(b'\n');
    }
    if let Err(e) = std::fs::create_dir_all(dir) {
        eprintln!("lumir: 无法创建日志目录 {}：{e}", dir.display());
        batch.clear();
        return;
    }
    // 越限即删档重开：保留最近窗口，丢最旧。单批不会自己越过上限（256 条 × 256 字符）。
    let existing = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if existing > 0 && existing + bytes.len() as u64 > MAX_FILE_BYTES {
        let _ = std::fs::remove_file(&path);
    }
    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut file) => {
            if let Err(e) = file.write_all(&bytes) {
                eprintln!("lumir: 无法写入日志 {}：{e}", path.display());
            }
        }
        Err(e) => eprintln!("lumir: 无法打开日志 {}：{e}", path.display()),
    }
    batch.clear();
}

/// 惰性清理（幂等）：删超期（≥7 天）、删超出 10 个文件的最旧者、删超 5MB 的文件。
/// 只认本模块命名规则（`YYYY-MM-DD.jsonl`）的文件，别的文件一律不碰。
fn sweep(dir: &Path, today: Day) {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return, // 目录不存在：还没有日志，无事可做
    };
    let mut found: Vec<(Day, PathBuf, u64)> = Vec::new();
    for entry in entries.flatten() {
        let Some(day) = entry.file_name().to_str().and_then(Day::parse_file_name) else {
            continue;
        };
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        found.push((day, entry.path(), size));
    }
    found.sort_by_key(|entry| std::cmp::Reverse(entry.0)); // 新的在前
    for (index, (day, path, size)) in found.iter().enumerate() {
        let expired = today.since(*day) >= RETAIN_DAYS;
        let beyond_count = index >= MAX_FILES;
        let beyond_size = *size > MAX_FILE_BYTES;
        if expired || beyond_count || beyond_size {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// 一行 JSONL：`ts` / `level` / `event` + 诊断字段。字段键序由 `serde_json::Map`
/// （BTreeMap）排序决定，输出确定（同事件同字段必得同一行）。
fn encode(event: &Event) -> String {
    let mut map = serde_json::Map::new();
    map.insert("ts".into(), serde_json::Value::String(format_ts(event.at)));
    map.insert(
        "level".into(),
        serde_json::Value::String(event.name.level().to_string()),
    );
    map.insert(
        "event".into(),
        serde_json::Value::String(event.name.as_str().to_string()),
    );
    for (key, value) in event.fields.iter() {
        map.insert((*key).to_string(), serde_json::Value::String(value.clone()));
    }
    serde_json::Value::Object(map).to_string()
}

// ---------------------------------------------------------------------------
// 全局落盘器（进程内唯一）+ 埋点入口
// ---------------------------------------------------------------------------

static SINK: OnceLock<Sink> = OnceLock::new();

/// 进程内唯一落盘器：等级来自 `[log] level`（默认 info）。初始化只读一次配置；
/// 配置读不到（配置目录不可确定）时按关闭处理——那种情况下也没有日志目录可写。
fn global() -> &'static Sink {
    SINK.get_or_init(|| {
        // 测试构建下永不落盘：单例一旦被某个测试触达，就会把事件写进**真实**配置目录
        // （~/.config/lumir/logs）——本 change 实现期实测发生过一次（一个测试误用公共
        // 包装而非注入变体，写了 13 行测试事件进真实目录）。测试一律走 `*_to(sink)` 注入
        // 路径（见本模块测试），这里直接关掉，让误用表现为「没有日志」而不是污染环境。
        #[cfg(test)]
        return Sink::start(PathBuf::new(), LogLevel::Off, FLUSH_INTERVAL);
        #[cfg(not(test))]
        {
            use crate::config;
            let dir = match config::config_dir() {
                Ok(dir) => dir,
                Err(e) => {
                    eprintln!("lumir: 诊断日志未启用：{}", e.message);
                    return Sink::start(PathBuf::new(), LogLevel::Off, FLUSH_INTERVAL);
                }
            };
            let level = match config::load() {
                Ok(snapshot) => snapshot.config.log.level,
                Err(e) => {
                    eprintln!("lumir: 诊断日志等级读取失败，按 off 处理：{}", e.message);
                    LogLevel::Off
                }
            };
            Sink::start(dir.join("logs"), level, FLUSH_INTERVAL)
        }
    })
}

/// 启动时显式初始化（lib.rs setup）：让 `[log] level` 在第一条事件之前就生效。
pub fn init() {
    let _ = global();
}

/// 尽力把缓冲刷盘（lib.rs 进程退出路径）。
pub fn flush() {
    if let Some(sink) = SINK.get() {
        sink.flush();
    }
}

/// Rust 侧埋点：保存 CAS 冲突（`commands::document_save` 的冲突检测点）。
pub fn save_conflict(path: &str, code: &str) {
    save_conflict_to(global(), path, code);
}

/// 指定落盘器的埋点入口（可测：进程内单例无法逐测试重指，沿用仓内 `*_to` 惯例）。
fn save_conflict_to(sink: &Sink, path: &str, code: &str) {
    emit(
        sink,
        Event::new(LogEventName::SaveConflict)
            .field("path", path)
            .field("code", code),
    );
}

/// Rust 侧埋点：崩溃备份写入成功（`commands::recovery_backup`）。
/// 频率由前端的自动保存 debounce 与暂停态决定（暂停中每停止输入 2s 一次）。
pub fn recovery_written(path: &str) {
    recovery_written_to(global(), path);
}

fn recovery_written_to(sink: &Sink, path: &str) {
    emit(
        sink,
        Event::new(LogEventName::RecoveryWritten).field("path", path),
    );
}

/// Rust 侧埋点：崩溃备份被恢复入口取走（`commands::recovery_load`——恢复链路在
/// Rust 侧唯一的可观测点，读到备份即表示用户选择「恢复内容」）。
pub fn recovery_restored(path: &str) {
    recovery_restored_to(global(), path);
}

fn recovery_restored_to(sink: &Sink, path: &str) {
    emit(
        sink,
        Event::new(LogEventName::RecoveryRestored).field("path", path),
    );
}

/// Rust 侧埋点：链接激活（`commands::open_external_url` / `commands::link_open_path`）。
/// `category` 取链接类别（external / internal-md / asset / anchor / blocked-scheme，
/// M145 起记录；前端分类结果经 `log_event` 走同一条事件），`outcome` 取 `opened`
///（已交给系统默认应用）或 `rejected` / `failed`；`scheme` 只有外链路径上有值。
/// 只记类别与结果，不记 URL / 目标原文——那是文档内容，落在隐私边界之外。
pub fn link_open(category: &str, outcome: &str, scheme: Option<&str>) {
    link_open_to(global(), category, outcome, scheme);
}

fn link_open_to(sink: &Sink, category: &str, outcome: &str, scheme: Option<&str>) {
    let mut event = Event::new(LogEventName::LinkOpen)
        .field("category", category)
        .field("outcome", outcome);
    if let Some(scheme) = scheme {
        event = event.field("scheme", scheme);
    }
    emit(sink, event);
}

/// 前端经 `log_event` 命令转发的入口：白名单外负载**显式拒绝**（返回错误信封），
/// 不落盘（spec「invoke 入口 SHALL 校验事件名与字段白名单」）。
pub fn log_frontend_event(
    event: LogEventName,
    fields: HashMap<String, String>,
) -> Result<(), CommandError> {
    log_frontend_event_to(global(), event, fields)
}

/// 指定落盘器的转发入口（可测）：校验见 [`frontend_event`]，落盘见 [`emit`]。
fn log_frontend_event_to(
    sink: &Sink,
    event: LogEventName,
    fields: HashMap<String, String>,
) -> Result<(), CommandError> {
    let event = frontend_event(event, fields)?;
    emit(sink, event);
    Ok(())
}

/// 前端负载的白名单校验 + 归一：键映射回白名单里的字面量，值上限见 [`MAX_VALUE_CHARS`]。
/// 拒绝原因不回显负载内容——入口不该成为把任意字符串回显出去的通道。
fn frontend_event(
    event: LogEventName,
    fields: HashMap<String, String>,
) -> Result<Event, CommandError> {
    let allowed = event.allowed_fields();
    let mut normalized: Vec<(&'static str, String)> = Vec::with_capacity(fields.len());
    for (key, value) in fields {
        let Some(slot) = allowed.iter().copied().find(|slot| *slot == key.as_str()) else {
            return Err(rejected(format!(
                "字段 {} 不在事件 {} 的白名单（允许：{}）内",
                key,
                event.as_str(),
                allowed.join("、")
            )));
        };
        if value.chars().count() > MAX_VALUE_CHARS {
            return Err(rejected(format!(
                "字段 {key} 的值超过 {MAX_VALUE_CHARS} 字符上限"
            )));
        }
        normalized.push((slot, value));
    }
    Ok(Event {
        name: event,
        at: SystemTime::now(),
        fields: normalized,
    })
}

fn rejected(reason: String) -> CommandError {
    CommandError::new(
        "log_event_rejected",
        format!("诊断事件被拒（负载不符合白名单）：{reason}"),
    )
}

/// 落盘一条事件；字段不在白名单时打 stderr 并丢弃——埋点是旁路，绝不影响业务结果。
/// （内部埋点的键在编译期可见，这里复查是防未来改错键名把非白名单字段写进日志。）
fn emit(sink: &Sink, event: Event) {
    let allowed = event.name.allowed_fields();
    for (key, value) in event.fields.iter() {
        if !allowed.contains(key) {
            eprintln!(
                "lumir: 诊断事件 {} 的字段 {key} 不在白名单，已丢弃",
                event.name.as_str()
            );
            return;
        }
        if value.chars().count() > MAX_VALUE_CHARS {
            eprintln!(
                "lumir: 诊断事件 {} 的字段 {key} 超过 {MAX_VALUE_CHARS} 字符，已丢弃",
                event.name.as_str()
            );
            return;
        }
    }
    sink.emit(event);
}

// ---------------------------------------------------------------------------
// 日期与时间格式（零依赖，UTC）
// ---------------------------------------------------------------------------

/// UTC 日（unix epoch 起的天数）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Day(i64);

impl Day {
    fn of(time: SystemTime) -> Day {
        Day(unix_seconds(time).div_euclid(86_400))
    }

    fn file_name(self) -> String {
        let (y, m, d) = civil_from_days(self.0);
        format!("{y:04}-{m:02}-{d:02}.jsonl")
    }

    /// 严格解析 `YYYY-MM-DD.jsonl`（本模块自己产出的名字）；别的名字一律 None——
    /// 清理只碰自己写出来的文件。
    fn parse_file_name(name: &str) -> Option<Day> {
        let date = name.strip_suffix(".jsonl")?;
        let bytes = date.as_bytes();
        if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
            return None;
        }
        let digits = |range: std::ops::Range<usize>| -> Option<i64> {
            let text = date.get(range)?;
            if !text.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            text.parse().ok()
        };
        let (year, month, day) = (digits(0..4)?, digits(5..7)?, digits(8..10)?);
        if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
            return None;
        }
        if day > days_in_month(year, month) {
            return None;
        }
        Some(from_civil(year, month, day))
    }

    /// `self - other`（天）。
    fn since(self, other: Day) -> i64 {
        self.0 - other.0
    }
}

/// 公历闰年。
fn is_leap(year: i64) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(year) => 29,
        2 => 28,
        _ => 0,
    }
}

/// Howard Hinnant 的 days-from-civil（公历 ↔ 天数互转，零依赖）。
fn from_civil(year: i64, month: i64, day: i64) -> Day {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let mp = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Day(era * 146_097 + doe - 719_468)
}

/// 逆变换：unix 天数 → (年, 月, 日)。
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// 从 unix epoch 起的秒（时钟早于 epoch 时按 0 处理——本进程只用 SystemTime::now()）。
fn unix_seconds(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// ISO 8601（UTC，毫秒精度）：`2026-09-16T05:12:33.123Z`。
fn format_ts(time: SystemTime) -> String {
    let elapsed = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = elapsed.as_secs() as i64;
    let (year, month, day) = civil_from_days(seconds.div_euclid(86_400));
    let rem = seconds.rem_euclid(86_400);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        elapsed.subsec_millis()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU32;

    /// 无 tempfile 依赖（低依赖取向）：pid + 序号在 $TMPDIR 造唯一目录，Drop 时删除。
    /// 与 config.rs / fs_io.rs 的临时路径惯例一致：测试绝不碰真实配置目录。
    struct TempDir(PathBuf);
    static SEQ: AtomicU32 = AtomicU32::new(0);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "lumir-log-test-{}-{}",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).expect("create temp dir");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// 测试用落盘器：静默期取长值，使「emit 后未 flush 不落盘」成为确定性行为。
    fn sink(dir: &Path, level: LogLevel) -> Sink {
        Sink::start(dir.to_path_buf(), level, Duration::from_secs(3600))
    }

    fn today_file(dir: &Path) -> PathBuf {
        dir.join(Day::of(SystemTime::now()).file_name())
    }

    fn read_lines(dir: &Path) -> Vec<serde_json::Value> {
        let Ok(text) = std::fs::read_to_string(today_file(dir)) else {
            return Vec::new();
        };
        text.lines()
            .map(|line| serde_json::from_str(line).expect("每行应是合法 JSON"))
            .collect()
    }

    fn fields(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn timestamp_is_iso8601_utc_with_millis() {
        // 1700000000s = 2023-11-14T22:13:20Z（公开的换算基准值）。
        let t = UNIX_EPOCH + Duration::from_millis(1_700_000_000_123);
        assert_eq!(format_ts(t), "2023-11-14T22:13:20.123Z");
        assert_eq!(Day::of(t).file_name(), "2023-11-14.jsonl");
        // 跨日边界（1699920000 = 2023-11-14T00:00:00Z）：前一毫秒仍属 13 日
        assert_eq!(
            format_ts(UNIX_EPOCH + Duration::from_millis(1_699_919_999_999)),
            "2023-11-13T23:59:59.999Z"
        );
        assert_eq!(
            Day::of(UNIX_EPOCH + Duration::from_millis(1_699_919_999_999)).file_name(),
            "2023-11-13.jsonl"
        );
        assert_eq!(
            Day::of(UNIX_EPOCH + Duration::from_secs(1_699_920_000)).file_name(),
            "2023-11-14.jsonl"
        );
    }

    /// ISO 8601 的输出格式（定长日期段 + Z 后缀）；不做正则依赖，直接按列断言。
    #[test]
    fn event_line_has_ts_level_event_and_fields() {
        let dir = TempDir::new();
        let sink = sink(dir.path(), LogLevel::Info);
        log_frontend_event_to(
            &sink,
            LogEventName::SaveConflict,
            fields(&[("path", "docs/a.md"), ("code", "document_conflict")]),
        )
        .unwrap();
        assert!(
            read_lines(dir.path()).is_empty(),
            "未 flush 前不应落盘（缓冲批量语义）"
        );
        sink.flush();
        let lines = read_lines(dir.path());
        assert_eq!(lines.len(), 1);
        let line = &lines[0];
        assert_eq!(line["event"], "save_conflict");
        assert_eq!(line["level"], "warn");
        assert_eq!(line["path"], "docs/a.md");
        assert_eq!(line["code"], "document_conflict");
        let ts = line["ts"].as_str().unwrap();
        assert_eq!(
            ts.len(),
            24,
            "ts 应是 2026-09-16T05:12:33.123Z 这种定长格式：{ts}"
        );
        assert_eq!(&ts[4..5], "-");
        assert_eq!(&ts[10..11], "T");
        assert!(ts.ends_with('Z'), "{ts}");
        // 落盘文件名 = 当日（UTC）日期
        assert!(today_file(dir.path()).is_file());
    }

    /// 事件集与白名单由 Rust 单一持有：TS 联合类型的字面量必须与 as_str 一致。
    #[test]
    fn event_names_are_snake_case_and_whitelisted() {
        for name in [
            LogEventName::SaveConflict,
            LogEventName::SaveExternalChange,
            LogEventName::AutosavePaused,
            LogEventName::AutosaveResumed,
            LogEventName::RecoveryWritten,
            LogEventName::RecoveryRestored,
            LogEventName::RenderError,
            LogEventName::ConfigWarning,
            LogEventName::SlowCallback,
        ] {
            let text = name.as_str();
            assert!(
                text.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
                "{text} 应是 snake_case"
            );
            assert!(!name.allowed_fields().is_empty(), "{text} 缺字段白名单");
        }
    }

    /// 白名单拒绝：未知字段（含把正文当负载的 content / 正文级 message）、超长值。
    /// 拒绝即不落盘，且错误信封是 log_event_rejected。
    #[test]
    fn whitelist_rejects_payloads_outside_the_list() {
        let dir = TempDir::new();
        let sink = sink(dir.path(), LogLevel::Info);

        let content = log_frontend_event_to(
            &sink,
            LogEventName::RenderError,
            fields(&[
                ("kind", "mermaid"),
                ("content", "```mermaid\ngraph TD\n```"),
            ]),
        )
        .unwrap_err();
        assert_eq!(content.code, "log_event_rejected");

        // render_error 只认分类后的 code，原始错误文本（message）不在白名单里。
        let raw = log_frontend_event_to(
            &sink,
            LogEventName::RenderError,
            fields(&[
                ("kind", "katex"),
                ("message", "KaTeX parse error: ... x^{2}}"),
            ]),
        )
        .unwrap_err();
        assert_eq!(raw.code, "log_event_rejected");
        assert!(
            !raw.message.contains("x^{2}"),
            "拒绝消息不得回显负载内容：{}",
            raw.message
        );

        // ts / level / event 由日志层自己填，负载提供即拒。
        let reserved = log_frontend_event_to(
            &sink,
            LogEventName::ConfigWarning,
            fields(&[("ts", "1970-01-01T00:00:00.000Z")]),
        )
        .unwrap_err();
        assert_eq!(reserved.code, "log_event_rejected");

        let oversized = log_frontend_event_to(
            &sink,
            LogEventName::ConfigWarning,
            fields(&[("message", &"x".repeat(MAX_VALUE_CHARS + 1))]),
        )
        .unwrap_err();
        assert_eq!(oversized.code, "log_event_rejected");

        sink.flush();
        assert!(
            read_lines(dir.path()).is_empty(),
            "被拒负载不得落盘：{:?}",
            read_lines(dir.path())
        );
    }

    /// 缓冲批量落盘：静默期内的多条事件不逐条落盘（flush 前盘上什么都没有），
    /// flush 时一次写掉整批。静默期取 1h，故「flush 前无文件」是确定性断言。
    #[test]
    fn buffered_events_land_in_one_append() {
        let dir = TempDir::new();
        let sink = sink(dir.path(), LogLevel::Info);
        for index in 0..3 {
            log_frontend_event_to(
                &sink,
                LogEventName::SlowCallback,
                fields(&[("name", "fs_entry_changed"), ("ms", &format!("{index}1.5"))]),
            )
            .unwrap();
        }
        assert!(
            !today_file(dir.path()).exists(),
            "静默期内不应落盘（缓冲语义：落盘由写线程按批做）"
        );
        sink.flush();
        let lines = read_lines(dir.path());
        assert_eq!(lines.len(), 3, "flush 应把整批写掉");
        assert_eq!(lines[0]["event"], "slow_callback");
        assert_eq!(lines[0]["level"], "warn");
        assert_eq!(lines[0]["name"], "fs_entry_changed");
        assert_eq!(lines[2]["ms"], "21.5");
    }

    /// `[log] level = "off"`：事件丢弃不写盘，连 logs 目录都不创建。
    #[test]
    fn off_level_discards_events_without_touching_disk() {
        let dir = TempDir::new();
        let logs = dir.path().join("logs");
        let sink = sink(&logs, LogLevel::Off);
        log_frontend_event_to(
            &sink,
            LogEventName::SaveConflict,
            fields(&[("path", "docs/a.md"), ("code", "document_conflict")]),
        )
        .unwrap();
        sink.flush();
        assert!(!logs.exists(), "off 时不应创建日志目录");
    }

    /// 超期清理（spec 场景）：8 天前的文件在下一次写入时被删除，当日文件不受影响。
    #[test]
    fn next_write_sweeps_expired_days() {
        let dir = TempDir::new();
        let today = Day::of(SystemTime::now());
        let stale = dir.path().join(Day(today.0 - 8).file_name());
        let recent = dir.path().join(Day(today.0 - 2).file_name());
        std::fs::write(&stale, "{\"event\":\"slow_callback\"}\n").unwrap();
        std::fs::write(&recent, "{\"event\":\"save_conflict\"}\n").unwrap();

        let sink = sink(dir.path(), LogLevel::Info);
        log_frontend_event_to(
            &sink,
            LogEventName::RecoveryWritten,
            fields(&[("path", "docs/a.md")]),
        )
        .unwrap();
        sink.flush();

        assert!(!stale.exists(), "8 天前的日志应被惰性清理");
        assert!(recent.exists(), "保留期内的文件不受影响");
        assert_eq!(read_lines(dir.path()).len(), 1, "当日文件只含本次事件");
    }

    /// 边界：恰好 7 天前保留（7 天含当日），8 天前删；非本模块命名的文件一律不碰。
    #[test]
    fn sweep_keeps_the_retention_window_and_ignores_foreign_files() {
        let dir = TempDir::new();
        let today = Day::of(SystemTime::now());
        let keep_edge = dir.path().join(Day(today.0 - 6).file_name());
        let drop_edge = dir.path().join(Day(today.0 - 7).file_name());
        let foreign = dir.path().join("notes.txt");
        for path in [&keep_edge, &drop_edge, &foreign] {
            std::fs::write(path, "x").unwrap();
        }
        sweep(dir.path(), today);
        assert!(keep_edge.exists(), "6 天前仍在保留窗口内");
        assert!(!drop_edge.exists(), "7 天前（第 8 天）应被删除");
        assert!(foreign.exists(), "非日志命名文件不得被清理");

        // 幂等：重复清理不改变结果
        sweep(dir.path(), today);
        assert!(keep_edge.exists());
        assert!(!drop_edge.exists());
    }

    /// 文件数上限（防御项：按日一文时 7 天规则先到）。
    #[test]
    fn sweep_enforces_file_count_cap() {
        let dir = TempDir::new();
        let today = Day::of(SystemTime::now());
        // 未来日期不在保留期之外，只有文件数上限能限制它们
        for offset in 1..=11 {
            std::fs::write(dir.path().join(Day(today.0 + offset).file_name()), "x").unwrap();
        }
        sweep(dir.path(), today);
        let remaining = std::fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(remaining, MAX_FILES, "最多保留 {MAX_FILES} 个文件");
    }

    /// 单文件 5MB 上限：追加会越限时删档重开，只留最近窗口（本例走「追加前判越限」
    /// 这条路——文件恰好在上限之内，追加一笔就超）。
    #[test]
    fn oversized_day_file_is_rolled_over() {
        let dir = TempDir::new();
        let path = today_file(dir.path());
        std::fs::write(&path, vec![b'x'; MAX_FILE_BYTES as usize - 10]).unwrap();

        let sink = sink(dir.path(), LogLevel::Info);
        log_frontend_event_to(
            &sink,
            LogEventName::RecoveryRestored,
            fields(&[("path", "docs/a.md")]),
        )
        .unwrap();
        sink.flush();

        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(text.lines().count(), 1, "越限文件应被删档重开");
        assert!(text.contains("recovery_restored"));
        assert!((text.len() as u64) < MAX_FILE_BYTES);
    }

    /// 已超限的文件在清理时也被删（保留期内的旧文件若因外部原因超限）。
    #[test]
    fn sweep_drops_oversized_files() {
        let dir = TempDir::new();
        let today = Day::of(SystemTime::now());
        let fat = dir.path().join(Day(today.0 - 1).file_name());
        std::fs::write(&fat, vec![b'x'; MAX_FILE_BYTES as usize + 1]).unwrap();
        sweep(dir.path(), today);
        assert!(!fat.exists(), "超 5MB 的文件应被惰性删除");
    }

    /// Rust 侧埋点走的是同一条落盘链路（等级/白名单都在 emit 里复查）。
    #[test]
    fn rust_side_instrumentation_shares_the_sink() {
        let dir = TempDir::new();
        let sink = sink(dir.path(), LogLevel::Info);
        save_conflict_to(&sink, "docs/conflict.md", "document_conflict");
        recovery_written_to(&sink, "docs/backup.md");
        recovery_restored_to(&sink, "docs/backup.md");
        sink.flush();

        let lines = read_lines(dir.path());
        let names: Vec<&str> = lines
            .iter()
            .map(|line| line["event"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            vec!["save_conflict", "recovery_written", "recovery_restored"]
        );
        assert_eq!(lines[0]["level"], "warn");
        assert_eq!(lines[1]["level"], "info");
    }

    /// 测试构建下单例一律关闭：任何测试经公共包装触达单例，都不该把事件写进真实配置
    /// 目录（实现期实测污染过一次，见 global() 的注释）。
    #[test]
    fn global_sink_is_disabled_in_test_builds() {
        assert!(!global().enabled.load(Ordering::Relaxed));
        // 公共包装在测试构建下同样只是丢弃，不产生文件
        save_conflict("docs/a.md", "document_conflict");
        flush();
    }
}
