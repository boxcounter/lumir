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
    /// 应用元信息（产品名 / 版本号）读取失败（M236）：标题栏标识块随之整体隐藏。
    /// 常见成因是 capabilities 漏配 core:app:allow-name / allow-version（ACL 拒绝）。
    AppMetaUnavailable,
    /// 旧注册表目录 `workspaces/` → `vault-registry/` 的启动迁移（M248，backlog #37）。
    /// `outcome` 取 migrated / skipped_target_exists / failed；稳态（无旧目录）不记——
    /// 迁移一辈子只发生一次，每次启动记一条「无事可做」只会把日志刷成噪音。
    VaultRegistryMigrated,
    /// 全量枚举收口处**被 `hidden` 档剪掉**的条目数（change vault-open-ignore-set §3.3）。
    /// 消费方：用户报「我的文件不见了」时的第一诊断依据——`hidden` 档默认名单是启发式的（按名字
    /// 猜「这不是内容」），误伤时唯一能把它与「用户规则命中（惰性可见）」区分的读数。
    /// **只有计数，没有路径或名字原文**（本模块的隐私边界，见模块头）。
    VaultScanIgnored,
    /// 图片语义命名的结局（change add-semantic-image-naming，design §7）：成功不记（有 toast），
    /// 跳过 / 失败各记一条**分类后的错误码** + 图片的 vault 相对路径。**不含图片字节、不含
    /// 笔记正文**（隐私边界：正文与字节只出现在模型请求里）。
    AttachmentNaming,
    /// 定时任务的通知投递成功（change add-cron-runtime-daemon，design §11）。`kind` 取
    /// `trigger`（「到点」）/ `result`（「已完成」）/ `failure`（「运行失败」），`trigger` 取
    /// `timer` / `startup` / `focus` / `vault-open`。**正文不进日志**（通知正文是通用文案，
    /// prompt 与路径属隐私边界之外）。
    CronNotified,
    /// 通知点击的处理完成（含失败）：`action` 取 `run`（发起运行）/ `open-session`（恢复会话），
    /// `ok` 取 `true` / `false`，失败时另带 `error` 错误码。
    CronClick,
    /// 运行交接被前端接受：`session` 取 `new` / `dedicated`，`model` 只有显式覆盖时才在场。
    CronRunStarted,
    /// 运行到达终态（含失败 / 中止）。**成功与失败只在这里产出**——由 `cron_run_result`
    /// 回执驱动，其它事件不重复判定（REVIEW.md「同一语义两处真源」条；单测
    /// `cron_run_finished_has_a_single_production_point` 机制化这条边界）。
    CronRunFinished,
    /// 该次不派发：`reason` 取 `vault_not_current` / `busy` / `not_ready`。
    CronRunSkipped,
    /// 装载期丢弃了任务项：`task` = 任务 id（id 不可读时为空）、`field` = 第一处问题所在
    /// 字段、`reason` = 人话原因。每个被丢弃的任务项一条。
    CronTaskInvalid,
    /// 调度工具注册成功且运行时已确认（`effect = active`，change
    /// add-cron-conversational-registration design §10）：字段只有任务身份与调度要素——
    /// **不含 prompt**（prompt 全文只在批准卡与会话留存里，日志会长期留档、字段有 256 字符上限）。
    /// `pending_restart` 不落这条（避免「注册成功」的假记录）。
    CronTaskRegistered,
    /// 调度工具删除成功且运行时已确认：`task` + `effect`。
    CronTaskRemoved,
    /// 调度工具拒绝（校验失败 / 重名 / 不存在 / 落盘失败）：`task`（可空）、`field`、`code`。
    CronTaskRejected,
    /// 子代理清单容量告警（change add-harness-subagents design §4.4 / tasks §2.6）：所有生效
    /// 定义的描述合计估算超过 15,000 token 时产一条。**只告警、不截断**——清单本体照常完整
    /// 注入（截断会让定义静默消失）。字段只有估算值与定义数。
    SubagentCatalogLarge,
    /// 子运行启动（design §13）：段真正起跑时一条。`tools` 是逗号分隔的工具名清单（日志字段
    /// 恒为字符串，数组不落盘）；不含 prompt。
    SubagentStarted,
    /// 子运行过程读数（design §13）：每轮至多一条（节流在生产侧），只带计数与最近工具名。
    SubagentProgress,
    /// 子运行步骤行（design §13）：工具名 + **人话化参数摘要**（MUST NOT 含文件内容）。
    SubagentStep,
    /// 子运行段收尾（design §13）：**任何终态一条**——completed / partial / failed / aborted
    /// （失败 / 中止 / 后台路径同样产，不静默）。字段与面板事件同源（见
    /// [`subagent_event`]），`status` / `stopped_by` 是闭集合。
    SubagentFinished,
    /// 后台完成通知的最终处理（design §13）：`wake` 是闭集合（`auto_turn` / `user_turn` /
    /// `blocked_chain` / `blocked_stopped` / `none_aborted`），同一批共享 `wake_batch`，
    /// `chain_index` 非自动回合为 0。
    SubagentNotified,
    /// 子运行启动被拒（design §13）：`reason` 是闭集合（见 [`SUBAGENT_REJECT_REASONS`]）。
    SubagentRejected,
}

impl LogEventName {
    /// 面板事件名 → 诊断事件（[`subagent_event`] 的映射面）。面板事件是 `harness:event` 的
    /// 七类 `subagent_*`；本函数与 [`Self::as_str`] 互逆（单测逐值 round-trip）。
    fn from_subagent_event(event: &str) -> Option<Self> {
        match event {
            "subagent_started" => Some(Self::SubagentStarted),
            "subagent_progress" => Some(Self::SubagentProgress),
            "subagent_step" => Some(Self::SubagentStep),
            "subagent_finished" => Some(Self::SubagentFinished),
            "subagent_notified" => Some(Self::SubagentNotified),
            "subagent_rejected" => Some(Self::SubagentRejected),
            "subagent_catalog_large" => Some(Self::SubagentCatalogLarge),
            _ => None,
        }
    }

    /// 落盘用的事件名（= TS 联合类型的字面量）。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SaveConflict => "save_conflict",
            Self::SaveExternalChange => "save_external_change",
            Self::RecoveryWritten => "recovery_written",
            Self::RecoveryRestored => "recovery_restored",
            Self::RenderError => "render_error",
            Self::ConfigWarning => "config_warning",
            Self::SlowCallback => "slow_callback",
            Self::LinkOpen => "link_open",
            Self::AppMetaUnavailable => "app_meta_unavailable",
            Self::VaultRegistryMigrated => "vault_registry_migrated",
            Self::VaultScanIgnored => "vault_scan_ignored",
            Self::AttachmentNaming => "attachment_naming",
            Self::CronNotified => "cron_notified",
            Self::CronClick => "cron_click",
            Self::CronRunStarted => "cron_run_started",
            Self::CronRunFinished => "cron_run_finished",
            Self::CronRunSkipped => "cron_run_skipped",
            Self::CronTaskInvalid => "cron_task_invalid",
            Self::CronTaskRegistered => "cron_task_registered",
            Self::CronTaskRemoved => "cron_task_removed",
            Self::CronTaskRejected => "cron_task_rejected",
            Self::SubagentCatalogLarge => "subagent_catalog_large",
            Self::SubagentStarted => "subagent_started",
            Self::SubagentProgress => "subagent_progress",
            Self::SubagentStep => "subagent_step",
            Self::SubagentFinished => "subagent_finished",
            Self::SubagentNotified => "subagent_notified",
            Self::SubagentRejected => "subagent_rejected",
        }
    }

    /// 写入每行 `level` 字段的事件级别。注意它**不参与过滤**：`[log] level` 只有
    /// info / off 两档（裁决点 1），info 档下落盘全部事件；这里只标注严重度，供读日志的
    /// agent 快速分流（正常事件 / 需要注意 / 失败）。
    fn level(self) -> &'static str {
        match self {
            Self::SaveConflict
            | Self::ConfigWarning
            | Self::AppMetaUnavailable
            | Self::SlowCallback
            | Self::CronRunSkipped
            | Self::CronTaskInvalid
            | Self::CronTaskRejected
            | Self::SubagentCatalogLarge
            | Self::SubagentRejected => "warn",
            Self::RenderError => "error",
            _ => "info",
        }
    }

    /// 字段白名单：该事件允许出现的字段名，其余一律拒绝。
    fn allowed_fields(self) -> &'static [&'static str] {
        match self {
            Self::SaveConflict => &["path", "code"],
            Self::SaveExternalChange => &["path", "change"],
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
            // 只记错误摘要（ACL 拒绝的 message 是权限名，不含用户数据）。
            Self::AppMetaUnavailable => &["message"],
            // 只记终局字面量（migrated / skipped_target_exists / failed）：目录名是常量，
            // 路径本身没有诊断价值，也就不进负载。
            Self::VaultRegistryMigrated => &["outcome"],
            // **只有计数**（十进制字符串）：被剪掉的是哪些条目属于用户内容，落盘即是隐私
            // 边界之外的东西（见模块头）。要的就是「有一批条目被 `hidden` 档剪掉了」这一个事实。
            Self::VaultScanIgnored => &["count"],
            // 图片语义命名：只有分类后的错误码与图片路径（路径与 SaveConflict 同一口径——
            // 不是文档正文）；图片字节 / 笔记正文 / 模型输出原文一律不落。
            Self::AttachmentNaming => &["path", "code"],
            // 通知只记「哪条任务、哪种通知、哪个触发源」——`kind` / `trigger` 都是闭集合的
            // 小词表；通知正文（通用文案）与 prompt / 路径都不进日志。
            Self::CronNotified => &["task", "kind", "trigger"],
            // 点击只记结局（动作 + 成功与否 + 分类后的错误码），不记点击坐标或通知内容。
            Self::CronClick => &["task", "ok", "action", "error"],
            // 运行交接：会话形态与可选的模型覆盖（模型 id 是配置值，不是文档内容）。
            Self::CronRunStarted => &["task", "trigger", "session", "model"],
            // **终态唯一产出点**：`ok` + 可选错误码；不得再加「是否成功」的派生字段，
            // 否则又成两处判定（REVIEW.md「同一语义两处真源」条）。
            Self::CronRunFinished => &["task", "ok", "error"],
            Self::CronRunSkipped => &["task", "reason"],
            // `task` 可能为空（id 本身不可读），`field` / `reason` 是字段名与分类后的原因。
            Self::CronTaskInvalid => &["task", "field", "reason"],
            // 注册 / 删除 / 拒绝（change add-cron-conversational-registration design §10）：
            // 只有任务身份与调度要素，**prompt 不在白名单内**——它的私密内容不该有第二条落点。
            Self::CronTaskRegistered => {
                &["task", "at", "days", "delivery", "session", "skip_today"]
            }
            Self::CronTaskRemoved => &["task", "effect"],
            Self::CronTaskRejected => &["task", "field", "code"],
            // 只有估算值与定义数（都是数字，不含定义名 / 描述正文——清单正文属用户内容）。
            Self::SubagentCatalogLarge => &["estimated_tokens", "definition_count"],
            // 子运行七事件（design §13）：字段与面板事件同名同源，`tools` 落成逗号分隔串。
            // **prompt / 文件内容 / vault 绝对路径都不在白名单内**——这是隐私边界的机制化处
            // （`description` 是用户手写的任务标签，`summary` 是人话化参数摘要，二者按
            // design §13 明确允许）。
            Self::SubagentStarted => &[
                "run_id",
                "segment",
                "parent_session",
                "agent",
                "description",
                "model",
                "tools",
                "max_turns",
                "max_tokens",
                "timeout_secs",
                "background",
            ],
            Self::SubagentProgress => &[
                "run_id",
                "segment",
                "rounds",
                "tool_calls",
                "last_tool",
                "elapsed_ms",
            ],
            Self::SubagentStep => &["run_id", "segment", "tool", "summary"],
            Self::SubagentFinished => &[
                "run_id",
                "segment",
                "agent",
                "status",
                "stopped_by",
                "rounds",
                "model",
                "input_tokens",
                "cached_tokens",
                "output_tokens",
                "denied_calls",
                "duration_ms",
                "summary_chars",
                "audit",
                "audit_error",
            ],
            Self::SubagentNotified => &[
                "run_id",
                "agent",
                "status",
                "wake",
                "wake_batch",
                "chain_index",
            ],
            Self::SubagentRejected => &["reason", "agent", "description"],
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

/// Rust 侧埋点：图片语义命名的跳过 / 失败（change add-semantic-image-naming，design §7）。
/// 成功不记（成功有 toast）；只记分类后的错误码与图片的 vault 相对路径——**不含图片字节、
/// 不含笔记正文、不含模型输出原文**（隐私边界）。
pub fn attachment_naming(path: &str, code: &str) {
    emit(
        global(),
        Event::new(LogEventName::AttachmentNaming)
            .field("path", path)
            .field("code", code),
    );
}

/// Rust 侧埋点：崩溃备份写入成功（`commands::recovery_backup`）。
/// 频率由前端崩溃备份的 debounce 决定（dirty 后停止输入满窗口一次，M278 起备份有自己的触发）。
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

/// Rust 侧埋点：旧注册表目录的一次性迁移（M248，backlog #37；调用点是
/// `vault_registry::migrate_legacy_registry_dir_at_startup`）。`outcome` 取迁移终局
/// （migrated / skipped_target_exists / failed）——迁移只发生一次，但没有这条记录就无法从
/// 日志判断「这台机器上到底迁没迁」。
pub fn vault_registry_migrated(outcome: &str) {
    vault_registry_migrated_to(global(), outcome);
}

fn vault_registry_migrated_to(sink: &Sink, outcome: &str) {
    emit(
        sink,
        Event::new(LogEventName::VaultRegistryMigrated).field("outcome", outcome),
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

/// Rust 侧埋点：全量枚举收口处被 **`hidden` 档**（含恒定临时文件模式）剪掉的条目数
/// （change vault-open-ignore-set §3.3 + change ignore-tiers-config §5.3；调用点是
/// `fs_io::scan_workspace_at` 的收口）。消费者见 [`LogEventName::VaultScanIgnored`]；
/// 负载只有计数，MUST NOT 加路径 / 名字字段。
///
/// 为什么是「一条读数」而不是一个 UI：`hidden` 档误伤一个用户文件时，用户看到的是「我的文件
/// 不见了」，而我们从界面上无法区分「被该档隐藏」与「本来就没有」。这条计数让
/// `grep vault_scan_ignored` 能直接回答是哪一个。**惰性条目不计入**——它们有行、看得见，
/// 不属于「文件不见了」的诊断对象。代价可忽略：vault 打开是低频用户动作。
pub fn vault_scan_ignored(count: usize) {
    vault_scan_ignored_to(global(), count);
}

fn vault_scan_ignored_to(sink: &Sink, count: usize) {
    emit(
        sink,
        Event::new(LogEventName::VaultScanIgnored).field("count", count.to_string()),
    );
}

/// Rust 侧埋点：vault 打开段的**分段读数**（M283，change vault-switch-restore-perf 的 1.2；
/// 调用点是 `commands::prepare_vault_open` 里 `fs_io::watch()` 的前后打点）。
///
/// 与前端 `phaseMs`（`src/main.ts`）共用**同一个事件名与字段**（`slow_callback` /
/// name / ms）：`grep vault_load` 一次拿到前后端各段，读数可比（M252 的三段、M154 的
/// scan / build_graph 都在这条通道上）。字段白名单与事件名都不新造（`allowed_fields`
/// 里 `SlowCallback => ["name", "ms"]`）。
///
/// **刻意不设阈值**（与前端 `phaseMs` 的 250ms 口径不同）：`vault_open_watch` 这一条的
/// 存在理由是回答「FSEvents 建流是否显著」这个是非题，而「日志里没有这一行」与「它很快」
/// 在事后不可区分——阈值会把「没超阈值」写成「没有读数」。开销可忽略：vault 打开是低频的
/// 用户动作，一次打开最多一条。
pub fn slow_callback(name: &str, ms: &str) {
    slow_callback_to(global(), name, ms);
}

fn slow_callback_to(sink: &Sink, name: &str, ms: &str) {
    emit(
        sink,
        Event::new(LogEventName::SlowCallback)
            .field("name", name)
            .field("ms", ms),
    );
}

/// Rust 侧埋点：配置面的人话 warning（`[cron]` 与 `cron-state.json` 的装载降级等）。
/// 与前端 `log_event("config_warning", …)` 共用同一条事件与字段（`source` / `message`）：
/// 读日志的人只用一种形状就能看到配置面出了什么问题。
pub fn config_warning(source: &str, message: &str) {
    config_warning_to(global(), source, message);
}

fn config_warning_to(sink: &Sink, source: &str, message: &str) {
    emit(
        sink,
        Event::new(LogEventName::ConfigWarning)
            .field("source", source)
            .field("message", message),
    );
}

/// Rust 侧埋点：子代理清单容量告警（change add-harness-subagents design §4.4）。估算口径是
/// 「描述字符数 ÷ 4 向上取整」，**清单本身不截断**——这条事件只是让读日志的人知道上下文
/// 前缀可能偏大。
pub fn subagent_catalog_large(estimated_tokens: u64, definition_count: usize) {
    subagent_catalog_large_to(global(), estimated_tokens, definition_count);
}

fn subagent_catalog_large_to(sink: &Sink, estimated_tokens: u64, definition_count: usize) {
    emit(
        sink,
        Event::new(LogEventName::SubagentCatalogLarge)
            .field("estimated_tokens", estimated_tokens.to_string())
            .field("definition_count", definition_count.to_string()),
    );
}

// ---------------------------------------------------------------------------
// 子运行诊断事件（change add-harness-subagents design §13）
// ---------------------------------------------------------------------------

/// `subagent_finished.status` 的闭集合（design §13）。生产者在
/// `harness::subagents::SegmentReport::status()`（`completed` / `partial` / `failed` /
/// `aborted`）；本表是诊断面的值域声明，测试期逐值断言（见 [`assert_subagent_closed_set`]）。
pub const SUBAGENT_STATUSES: &[&str] = &["completed", "partial", "failed", "aborted"];

/// `subagent_finished.stopped_by` 的闭集合。生产者是
/// `harness::run::StopReason::as_str()`——MUST NOT 在日志侧另立第二套停止原因。
pub const SUBAGENT_STOPPED_BY: &[&str] = &["rounds", "tokens", "time", "quota", "error"];

/// `subagent_notified.wake` 的闭集合（design §12.6.3 / §13）。
pub const SUBAGENT_WAKE: &[&str] = &[
    "auto_turn",
    "user_turn",
    "blocked_chain",
    "blocked_stopped",
    "none_aborted",
];

/// `subagent_rejected.reason` 的闭集合（design §13；`disabled` 是 kill switch 的拒绝码）。
/// 参数形状错误（`tool_args_invalid`）走统一工具错误信封，不是子代理语义拒绝码，不在此列。
pub const SUBAGENT_REJECT_REASONS: &[&str] = &[
    "disabled",
    "agent_not_found",
    "run_not_resumable",
    "run_busy",
    "agent_mismatch",
    "subrun_limit",
    "concurrency_limit",
    "model_not_configured",
    "empty_prompt",
];

/// 闭集合字段的值域（`None` = 该字段不是闭集合）。只作用于子运行事件；仅在测试构建里被
/// [`assert_subagent_closed_set`] 消费（release 不做运行时归一，理由见该函数）。
#[cfg(test)]
fn subagent_closed_set(field: &str) -> Option<&'static [&'static str]> {
    match field {
        "status" => Some(SUBAGENT_STATUSES),
        "stopped_by" => Some(SUBAGENT_STOPPED_BY),
        "wake" => Some(SUBAGENT_WAKE),
        "reason" => Some(SUBAGENT_REJECT_REASONS),
        _ => None,
    }
}

/// 测试期的闭集合断言：**只在测试构建里生效**——诊断通道绝不因值域不合而 panic / 改写
/// 生产者的值（release 下原样落盘，读日志的人看到的就是实际发生的事）。
#[cfg(test)]
fn assert_subagent_closed_set(event: &str, field: &str, value: &str) {
    if let Some(allowed) = subagent_closed_set(field) {
        assert!(
            allowed.contains(&value),
            "诊断事件 {event} 的字段 {field} 取值 {value:?} 不在闭集合 {allowed:?}"
        );
    }
}

/// 诊断字段的字符串化：标量原样、数组（`tools`）逗号分隔、对象 / null 跳过（诊断面不承载
/// 结构化负载）。与 `frontend_event` 的字符串口径一致——日志字段恒为字符串。
fn field_text(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Bool(flag) => Some(flag.to_string()),
        serde_json::Value::Number(number) => Some(number.to_string()),
        serde_json::Value::Array(items) => {
            let parts: Vec<String> = items.iter().filter_map(field_text).collect();
            (!parts.is_empty()).then(|| parts.join(","))
        }
        _ => None,
    }
}

/// 超长值剪到 [`MAX_VALUE_CHARS`]（隐私边界的第二道护栏，与前端通道同一上限）。
fn clip_field_text(text: String) -> String {
    if text.chars().count() <= MAX_VALUE_CHARS {
        return text;
    }
    let mut clipped: String = text
        .chars()
        .take(MAX_VALUE_CHARS.saturating_sub(1))
        .collect();
    clipped.push('…');
    clipped
}

/// Rust 侧埋点：把一条**面板事件**（`harness:event` 的 `subagent_*` 七类）转成诊断日志。
///
/// 为什么在面板事件的出口转收：diagnostic 与面板面是同一次段运行的两个投影，字段本就同名
/// 同源（design §13 与 `harness::events` 的构造参数一一对应）。在出口转一道，段收尾就只剩
/// **一个**诊断产出点（`harness::subagents::SubagentHub::set_sink` 的包装），失败 / 中止 /
/// 后台路径天然共用它——MUST NOT 在每条业务路径各写一遍 `logging::subagent_*` 调用
/// （REVIEW.md「同一语义两处真源」条）。
///
/// 白名单外的键（`system` / `prompt` / `messages` / `vault` 等）一律不进日志：本函数只按
/// [`LogEventName::allowed_fields`] 逐键取值。
pub fn subagent_event(payload: &serde_json::Value) {
    subagent_event_to(global(), payload);
}

fn subagent_event_to(sink: &Sink, payload: &serde_json::Value) {
    let Some(event) = payload["type"].as_str() else {
        return;
    };
    let Some(name) = LogEventName::from_subagent_event(event) else {
        return;
    };
    let mut entry = Event::new(name);
    for field in name.allowed_fields() {
        let Some(value) = payload.get(*field) else {
            continue;
        };
        let Some(text) = field_text(value) else {
            continue;
        };
        #[cfg(test)]
        assert_subagent_closed_set(event, field, &text);
        entry = entry.field(field, clip_field_text(text));
    }
    emit(sink, entry);
}

/// Rust 侧埋点：定时任务的通知投递成功（change add-cron-runtime-daemon，design §11）。
/// `kind` = `trigger` / `result` / `failure`，`trigger` = `timer` / `startup` / `focus` /
/// `vault-open`。投递**失败**不落这条（失败口径是「不写 `last_fired`、下一次评估重试」），
/// 也就不存在把失败伪装成已通知的路径。
///
/// **「成功」的口径（M620）**：投递后自查在系统通知中心的已投递列表里查到了这条请求——
/// 即系统确认送达，而不是「请求被本地接受」。冷启动最初约 0.5s 内阻塞投递会被本地拒绝而
/// 请求根本没发出去（插件还把该错误吞成 Ok），旧口径会在这里写出一条假成功。
pub fn cron_notified(task: &str, kind: &str, trigger: &str) {
    cron_notified_to(global(), task, kind, trigger);
}

fn cron_notified_to(sink: &Sink, task: &str, kind: &str, trigger: &str) {
    emit(
        sink,
        Event::new(LogEventName::CronNotified)
            .field("task", task)
            .field("kind", kind)
            .field("trigger", trigger),
    );
}

/// Rust 侧埋点：通知点击的处理完成（含失败）。`action` = `run` / `open-session`，
/// `error` 只在失败时在场（分类后的错误码）。
pub fn cron_click(task: &str, ok: bool, action: &str, error: Option<&str>) {
    cron_click_to(global(), task, ok, action, error);
}

fn cron_click_to(sink: &Sink, task: &str, ok: bool, action: &str, error: Option<&str>) {
    let mut event = Event::new(LogEventName::CronClick)
        .field("task", task)
        .field("ok", ok.to_string())
        .field("action", action);
    if let Some(error) = error {
        event = event.field("error", error);
    }
    emit(sink, event);
}

/// Rust 侧埋点：运行交接被前端接受。`session` = `new` / `dedicated`，`model` 只有显式覆盖
/// 时才在场（缺省模型不伪造 id）。
pub fn cron_run_started(task: &str, trigger: &str, session: &str, model: Option<&str>) {
    cron_run_started_to(global(), task, trigger, session, model);
}

fn cron_run_started_to(sink: &Sink, task: &str, trigger: &str, session: &str, model: Option<&str>) {
    let mut event = Event::new(LogEventName::CronRunStarted)
        .field("task", task)
        .field("trigger", trigger)
        .field("session", session);
    if let Some(model) = model {
        event = event.field("model", model);
    }
    emit(sink, event);
}

/// Rust 侧埋点：运行到达终态。**这是「成功 / 失败」的唯一产出点**——由 `cron_run_result`
/// 回执驱动，调用点只有 `lib.rs` 的回执处理一处（单测
/// `cron_run_finished_has_a_single_production_point` 机制化这条边界：其它源码文件里出现这个
/// 埋点即判红）。
pub fn cron_run_finished(task: &str, ok: bool, error: Option<&str>) {
    cron_run_finished_to(global(), task, ok, error);
}

fn cron_run_finished_to(sink: &Sink, task: &str, ok: bool, error: Option<&str>) {
    let mut event = Event::new(LogEventName::CronRunFinished)
        .field("task", task)
        .field("ok", ok.to_string());
    if let Some(error) = error {
        event = event.field("error", error);
    }
    emit(sink, event);
}

/// Rust 侧埋点：该次不派发（`reason` = `vault_not_current` / `busy` / `not_ready`）。
pub fn cron_run_skipped(task: &str, reason: &str) {
    cron_run_skipped_to(global(), task, reason);
}

fn cron_run_skipped_to(sink: &Sink, task: &str, reason: &str) {
    emit(
        sink,
        Event::new(LogEventName::CronRunSkipped)
            .field("task", task)
            .field("reason", reason),
    );
}

/// Rust 侧埋点：装载期丢弃任务项。`task` 可能为空（id 本身不可读）；`field` 是第一处问题
/// 所在字段，`reason` 是人话原因。
pub fn cron_task_invalid(task: &str, field: &str, reason: &str) {
    cron_task_invalid_to(global(), task, field, reason);
}

fn cron_task_invalid_to(sink: &Sink, task: &str, field: &str, reason: &str) {
    emit(
        sink,
        Event::new(LogEventName::CronTaskInvalid)
            .field("task", task)
            .field("field", field)
            .field("reason", reason),
    );
}

/// Rust 侧埋点：调度工具注册成功**且运行时已确认**（`effect = active`；change
/// add-cron-conversational-registration design §10）。`days` 是规范化串（`mon,tue,…`）。
/// **不含 prompt**：它的私密内容只出现在批准卡与会话留存里。
pub fn cron_task_registered(
    task: &str,
    at: &str,
    days: &str,
    delivery: &str,
    session: &str,
    skip_today: bool,
) {
    cron_task_registered_to(global(), task, at, days, delivery, session, skip_today);
}

fn cron_task_registered_to(
    sink: &Sink,
    task: &str,
    at: &str,
    days: &str,
    delivery: &str,
    session: &str,
    skip_today: bool,
) {
    emit(
        sink,
        Event::new(LogEventName::CronTaskRegistered)
            .field("task", task)
            .field("at", at)
            .field("days", days)
            .field("delivery", delivery)
            .field("session", session)
            .field("skip_today", skip_today.to_string()),
    );
}

/// Rust 侧埋点：调度工具删除成功且运行时已确认（`effect = active`）。
pub fn cron_task_removed(task: &str, effect: &str) {
    cron_task_removed_to(global(), task, effect);
}

fn cron_task_removed_to(sink: &Sink, task: &str, effect: &str) {
    emit(
        sink,
        Event::new(LogEventName::CronTaskRemoved)
            .field("task", task)
            .field("effect", effect),
    );
}

/// Rust 侧埋点：调度工具拒绝（校验失败 / 重名 / 不存在 / 落盘失败）。`task` 可空（id 本身
/// 不可读时），`field` / `code` 是分类后的字段名与错误码——**不记 prompt**。
pub fn cron_task_rejected(task: &str, field: &str, code: &str) {
    cron_task_rejected_to(global(), task, field, code);
}

fn cron_task_rejected_to(sink: &Sink, task: &str, field: &str, code: &str) {
    emit(
        sink,
        Event::new(LogEventName::CronTaskRejected)
            .field("task", task)
            .field("field", field)
            .field("code", code),
    );
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
    .param("reason", reason)
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

    /// 无 tempfile 依赖（低依赖取向）：在 $TMPDIR **独占新建**唯一目录，Drop 时删除。
    /// 与 config.rs / fs_io.rs 的临时路径惯例一致：测试绝不碰真实配置目录。
    /// 目录名带 pid + 序号 + 随机段，且用 `create_dir` 而非 `create_dir_all`：pid 回收后
    /// crash 残留目录会被静默复用；撞名即换随机段重试（同 `link_graph.rs` 的 `TempVaultDir`）。
    struct TempDir(PathBuf);
    static SEQ: AtomicU32 = AtomicU32::new(0);

    impl TempDir {
        fn new() -> Self {
            let base = std::env::temp_dir();
            for _ in 0..16 {
                let path = base.join(format!(
                    "lumir-log-test-{}-{}-{:016x}",
                    std::process::id(),
                    SEQ.fetch_add(1, Ordering::Relaxed),
                    rand::random::<u64>(),
                ));
                match std::fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(err) => panic!("create temp dir {}: {err}", path.display()),
                }
            }
            panic!("create temp dir: 16 次随机目录名全部撞名");
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
            LogEventName::RecoveryWritten,
            LogEventName::RecoveryRestored,
            LogEventName::RenderError,
            LogEventName::ConfigWarning,
            LogEventName::SlowCallback,
            LogEventName::VaultRegistryMigrated,
            LogEventName::CronNotified,
            LogEventName::CronClick,
            LogEventName::CronRunStarted,
            LogEventName::CronRunFinished,
            LogEventName::CronRunSkipped,
            LogEventName::CronTaskInvalid,
            LogEventName::CronTaskRegistered,
            LogEventName::CronTaskRemoved,
            LogEventName::CronTaskRejected,
            LogEventName::SubagentStarted,
            LogEventName::SubagentProgress,
            LogEventName::SubagentStep,
            LogEventName::SubagentFinished,
            LogEventName::SubagentNotified,
            LogEventName::SubagentRejected,
            LogEventName::SubagentCatalogLarge,
        ] {
            let text = name.as_str();
            assert!(
                text.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
                "{text} 应是 snake_case"
            );
            assert!(!name.allowed_fields().is_empty(), "{text} 缺字段白名单");
        }
    }

    /// cron 六个事件的字段面（change add-cron-runtime-daemon §5.1）：每条 Rust 侧埋点各落
    /// 一行，逐字段断言取值与等级——六条事件名与字段白名单都由本模块单一持有。
    #[test]
    fn cron_events_land_with_their_whitelisted_fields() {
        let dir = TempDir::new();
        let sink = sink(dir.path(), LogLevel::Info);
        cron_notified_to(&sink, "task-a", "trigger", "timer");
        cron_click_to(&sink, "task-a", true, "run", None);
        cron_click_to(&sink, "task-a", false, "open-session", Some("session_gone"));
        cron_run_started_to(&sink, "task-a", "focus", "dedicated", Some("model-1"));
        cron_run_finished_to(&sink, "task-a", true, None);
        cron_run_finished_to(&sink, "task-a", false, Some("approval_required"));
        cron_run_skipped_to(&sink, "task-a", "vault_not_current");
        cron_task_invalid_to(&sink, "task-a", "at", "取值非法");
        config_warning_to(&sink, "cron-state", "状态文件损坏");
        sink.flush();

        let lines = read_lines(dir.path());
        assert_eq!(lines.len(), 9);
        assert_eq!(lines[0]["event"], "cron_notified");
        assert_eq!(lines[0]["level"], "info");
        assert_eq!(lines[0]["task"], "task-a");
        assert_eq!(lines[0]["kind"], "trigger");
        assert_eq!(lines[0]["trigger"], "timer");
        assert_eq!(lines[1]["event"], "cron_click");
        assert_eq!(lines[1]["ok"], "true");
        assert_eq!(lines[1]["action"], "run");
        assert!(lines[1].get("error").is_none(), "成功点击不带 error");
        assert_eq!(lines[2]["ok"], "false");
        assert_eq!(lines[2]["action"], "open-session");
        assert_eq!(lines[2]["error"], "session_gone");
        assert_eq!(lines[3]["event"], "cron_run_started");
        assert_eq!(lines[3]["session"], "dedicated");
        assert_eq!(lines[3]["model"], "model-1");
        assert_eq!(lines[4]["event"], "cron_run_finished");
        assert_eq!(lines[4]["ok"], "true");
        assert!(lines[4].get("error").is_none());
        assert_eq!(lines[5]["ok"], "false");
        assert_eq!(lines[5]["error"], "approval_required");
        assert_eq!(lines[6]["event"], "cron_run_skipped");
        assert_eq!(lines[6]["level"], "warn");
        assert_eq!(lines[6]["reason"], "vault_not_current");
        assert_eq!(lines[7]["event"], "cron_task_invalid");
        assert_eq!(lines[7]["level"], "warn");
        assert_eq!(lines[7]["field"], "at");
        assert_eq!(lines[8]["event"], "config_warning");
        assert_eq!(lines[8]["source"], "cron-state");
    }

    /// 反向输入：cron 事件的字段面是机制化的白名单——塞 prompt（任务载荷属隐私边界之外）
    /// 或给终态事件再塞一个派生成功字段都会被拒，且拒绝消息不回显负载。
    #[test]
    fn cron_events_reject_fields_outside_the_whitelist() {
        let dir = TempDir::new();
        let sink = sink(dir.path(), LogLevel::Info);
        let prompt = log_frontend_event_to(
            &sink,
            LogEventName::CronClick,
            fields(&[("task", "task-a"), ("prompt", "private instructions")]),
        )
        .unwrap_err();
        assert_eq!(prompt.code, "log_event_rejected");
        assert!(!prompt.message.contains("private"), "{}", prompt.message);
        let derived = log_frontend_event_to(
            &sink,
            LogEventName::CronRunFinished,
            fields(&[("task", "task-a"), ("ok", "true"), ("summary", "成功")]),
        )
        .unwrap_err();
        assert_eq!(derived.code, "log_event_rejected");
        sink.flush();
        assert!(read_lines(dir.path()).is_empty(), "被拒负载不得落盘");
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

    /// Rust 侧埋点与前端同一条通道、同一种行形（M283 的 `vault_open_watch`）：新增的
    /// `slow_callback` 助手落下的行必须与前端 `phaseMs` 的行逐字段同形——两边的读数靠
    /// 同一个 grep（`vault_load` / `vault_open_watch`）一起读出来。
    #[test]
    fn rust_side_slow_callback_lands_same_shape_as_frontend() {
        let dir = TempDir::new();
        let sink = sink(dir.path(), LogLevel::Info);
        slow_callback_to(&sink, "vault_open_watch", "12.3");
        sink.flush();
        let lines = read_lines(dir.path());
        assert_eq!(lines.len(), 1, "一条读数落一行");
        assert_eq!(lines[0]["event"], "slow_callback");
        assert_eq!(lines[0]["level"], "warn");
        assert_eq!(lines[0]["name"], "vault_open_watch");
        assert_eq!(lines[0]["ms"], "12.3");
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
    /// 调度工具的三个诊断事件（change add-cron-conversational-registration design §10）：
    /// 事件名可 grep、字段只有任务身份与调度要素，**prompt 不在白名单内**（它的私密内容只
    /// 出现在批准卡与会话留存里）。区分度：把 prompt 塞进注册事件会被白名单丢弃。
    #[test]
    fn cron_tool_events_land_identity_only() {
        let dir = TempDir::new();
        let sink = sink(dir.path(), LogLevel::Info);
        cron_task_registered_to(
            &sink,
            "daily-log",
            "21:00",
            "mon,tue,wed,thu,fri,sat,sun",
            "notify-then-run",
            "new",
            true,
        );
        cron_task_removed_to(&sink, "daily-log", "active");
        cron_task_rejected_to(&sink, "daily-log", "at", "cron_task_invalid");
        sink.flush();
        let lines = read_lines(dir.path());
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0]["event"], "cron_task_registered");
        assert_eq!(lines[0]["level"], "info");
        assert_eq!(lines[0]["task"], "daily-log");
        assert_eq!(lines[0]["skip_today"], "true");
        assert_eq!(lines[1]["event"], "cron_task_removed");
        assert_eq!(lines[1]["effect"], "active");
        assert_eq!(lines[2]["event"], "cron_task_rejected");
        assert_eq!(lines[2]["level"], "warn");
        assert_eq!(lines[2]["code"], "cron_task_invalid");

        // prompt 不在白名单：前端转发会被拒（机制化护栏，不靠实现者自觉）。
        let err = log_frontend_event_to(
            &sink,
            LogEventName::CronTaskRegistered,
            fields(&[("task", "daily-log"), ("prompt", "写今日 log 的私密内容")]),
        )
        .unwrap_err();
        assert_eq!(err.code, "log_event_rejected");
    }

    /// 子代理清单容量告警（change add-harness-subagents tasks §2.6）：落一行可 grep 的
    /// `subagent_catalog_large`，负载只有估算值与定义数（清单正文属用户内容，不进日志）。
    #[test]
    fn subagent_catalog_large_lands_estimate_and_count_only() {
        let dir = TempDir::new();
        let sink = sink(dir.path(), LogLevel::Info);
        subagent_catalog_large_to(&sink, 15_001, 12);
        sink.flush();
        let lines = read_lines(dir.path());
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0]["event"], "subagent_catalog_large");
        assert_eq!(lines[0]["level"], "warn");
        assert_eq!(lines[0]["estimated_tokens"], "15001");
        assert_eq!(lines[0]["definition_count"], "12");
        assert_eq!(
            LogEventName::SubagentCatalogLarge.allowed_fields(),
            &["estimated_tokens", "definition_count"]
        );
    }

    /// 忽略计数诊断（change vault-open-ignore-set §3.3，tasks 1.4）：事件名与字段白名单都
    /// 只在代码里（`LogEventName::VaultScanIgnored` / `allowed_fields`），这里钉住三件事——
    /// ① 落盘一行、事件名可 `grep vault_scan_ignored`；② 负载**只有** `count`；
    /// ③ 消费者写在事件名的文档注释里（「用户报文件不见了时的第一诊断依据」）。
    #[test]
    fn vault_scan_ignored_lands_count_only() {
        let dir = TempDir::new();
        let sink = sink(dir.path(), LogLevel::Info);
        vault_scan_ignored_to(&sink, 129_655);
        sink.flush();
        let lines = read_lines(dir.path());
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0]["event"], "vault_scan_ignored");
        assert_eq!(lines[0]["level"], "info");
        assert_eq!(lines[0]["count"], "129655");
        // 字段面就是白名单本身：多一个字段都进不去（白名单是机制化护栏，不是约定）
        assert_eq!(
            LogEventName::VaultScanIgnored.allowed_fields(),
            &["count"],
            "负载只有计数——路径与名字原文属隐私边界之外"
        );
    }

    /// 反向输入：把路径当字段塞进这条事件会被白名单拒绝（前端入口）——「MUST NOT 记路径或
    /// 名字原文」这条边界因此是机制化的，不靠实现者自觉。
    #[test]
    fn vault_scan_ignored_rejects_path_fields() {
        let dir = TempDir::new();
        let sink = sink(dir.path(), LogLevel::Info);
        let err = log_frontend_event_to(
            &sink,
            LogEventName::VaultScanIgnored,
            fields(&[("count", "3"), ("path", "notes/target/plan.md")]),
        )
        .unwrap_err();
        assert_eq!(err.code, "log_event_rejected");
        sink.flush();
        assert!(read_lines(dir.path()).is_empty(), "被拒的负载不得落盘");
    }

    // ---- 子运行七事件（change add-harness-subagents design §13 / tasks §7.1） ----

    fn started_payload() -> serde_json::Value {
        serde_json::json!({
            "type": "subagent_started",
            "run_id": "r-1",
            "segment": 2,
            "parent_session": "s1759912345678-k3x9ab",
            "agent": "research",
            "description": "调研缓存策略",
            "model": "model-a",
            "tools": ["vault_read", "vault_search"],
            "max_turns": 20,
            "max_tokens": 200000,
            "timeout_secs": 300,
            "background": true,
            "vault": "<vault>",
        })
    }

    /// 七个面板事件逐个转成诊断行：事件名可 grep、数组字段逗号分隔、标量字符串化，
    /// 且 `vault`（以及任何白名单外的键）不进日志。
    #[test]
    fn subagent_events_round_trip_from_panel_payloads() {
        let dir = TempDir::new();
        let sink = sink(dir.path(), LogLevel::Info);
        subagent_event_to(&sink, &started_payload());
        subagent_event_to(
            &sink,
            &serde_json::json!({
                "type": "subagent_progress", "run_id": "r-1", "segment": 2,
                "rounds": 3, "tool_calls": 1, "last_tool": "vault_read", "elapsed_ms": 1200,
            }),
        );
        subagent_event_to(
            &sink,
            &serde_json::json!({
                "type": "subagent_step", "run_id": "r-1", "segment": 2,
                "tool": "vault_read", "summary": "读取 notes/plan.md",
            }),
        );
        subagent_event_to(
            &sink,
            &serde_json::json!({
                "type": "subagent_finished", "run_id": "r-1", "segment": 2,
                "agent": "research", "status": "partial", "stopped_by": "tokens",
                "rounds": 8, "model": "model-a", "input_tokens": 81000,
                "cached_tokens": 62000, "output_tokens": 2400, "denied_calls": 0,
                "duration_ms": 9000, "summary_chars": 120,
                "audit": "harness/subruns/vault-1/r-1.jsonl",
            }),
        );
        subagent_event_to(
            &sink,
            &serde_json::json!({
                "type": "subagent_notified", "run_id": "r-1", "agent": "research",
                "status": "completed", "wake": "auto_turn",
                "wake_batch": "b-2", "chain_index": 1,
            }),
        );
        subagent_event_to(
            &sink,
            &serde_json::json!({
                "type": "subagent_rejected", "reason": "concurrency_limit",
                "agent": "research", "description": "调研缓存策略",
            }),
        );
        subagent_event_to(
            &sink,
            &serde_json::json!({
                "type": "subagent_catalog_large",
                "estimated_tokens": 15001, "definition_count": 12,
            }),
        );
        sink.flush();

        let lines = read_lines(dir.path());
        let names: Vec<&str> = lines
            .iter()
            .map(|line| line["event"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            vec![
                "subagent_started",
                "subagent_progress",
                "subagent_step",
                "subagent_finished",
                "subagent_notified",
                "subagent_rejected",
                "subagent_catalog_large",
            ]
        );
        // 数组 → 逗号分隔；数字 / 布尔 → 字符串；`segment` 同。
        assert_eq!(lines[0]["tools"], "vault_read,vault_search");
        assert_eq!(lines[0]["background"], "true");
        assert_eq!(lines[0]["segment"], "2");
        assert_eq!(lines[0]["max_tokens"], "200000");
        assert!(
            lines[0].get("vault").is_none(),
            "信封字段（vault 绝对路径）不进诊断日志"
        );
        assert_eq!(lines[1]["last_tool"], "vault_read");
        assert_eq!(lines[1]["level"], "info");
        assert_eq!(lines[3]["status"], "partial");
        assert_eq!(lines[3]["stopped_by"], "tokens");
        assert_eq!(lines[3]["audit"], "harness/subruns/vault-1/r-1.jsonl");
        assert_eq!(lines[4]["wake"], "auto_turn");
        assert_eq!(lines[4]["wake_batch"], "b-2");
        assert_eq!(lines[4]["chain_index"], "1");
        assert_eq!(lines[5]["level"], "warn");
        assert_eq!(lines[5]["reason"], "concurrency_limit");
        assert_eq!(lines[6]["level"], "warn");
    }

    /// 缺键 / null 的字段不出场（`stopped_by` 只有 partial 段才有、`audit_error` 只在写失败时
    /// 才有）——诊断行不伪造空值。
    #[test]
    fn absent_subagent_fields_are_omitted() {
        let dir = TempDir::new();
        let sink = sink(dir.path(), LogLevel::Info);
        subagent_event_to(
            &sink,
            &serde_json::json!({
                "type": "subagent_finished", "run_id": "r-1", "segment": 1,
                "agent": "explore", "status": "completed", "rounds": 2,
                "model": "model-a", "input_tokens": 10, "cached_tokens": 0,
                "output_tokens": 3, "denied_calls": 0, "duration_ms": 5,
                "summary_chars": 1, "audit": null, "audit_error": null,
            }),
        );
        sink.flush();
        let lines = read_lines(dir.path());
        assert_eq!(lines.len(), 1);
        assert!(lines[0].get("stopped_by").is_none());
        assert!(lines[0].get("audit").is_none());
        assert!(lines[0].get("audit_error").is_none());
    }

    /// 闭集合逐值接受：`status` / `stopped_by` / `wake` / `reason` 的每个文档值都能落盘
    /// （测试期断言见 `assert_subagent_closed_set`，这里正向钉住值域本身）。
    #[test]
    fn subagent_closed_sets_accept_every_documented_value() {
        let dir = TempDir::new();
        let sink = sink(dir.path(), LogLevel::Info);
        for status in SUBAGENT_STATUSES {
            subagent_event_to(
                &sink,
                &serde_json::json!({
                    "type": "subagent_finished", "run_id": "r", "segment": 1,
                    "agent": "explore", "status": status, "rounds": 0, "model": "m",
                    "input_tokens": 0, "cached_tokens": 0, "output_tokens": 0,
                    "denied_calls": 0, "duration_ms": 0, "summary_chars": 0,
                }),
            );
        }
        for reason in SUBAGENT_STOPPED_BY {
            subagent_event_to(
                &sink,
                &serde_json::json!({
                    "type": "subagent_finished", "run_id": "r", "segment": 1,
                    "agent": "explore", "status": "partial", "stopped_by": reason,
                    "rounds": 0, "model": "m", "input_tokens": 0, "cached_tokens": 0,
                    "output_tokens": 0, "denied_calls": 0, "duration_ms": 0,
                    "summary_chars": 0,
                }),
            );
        }
        for wake in SUBAGENT_WAKE {
            subagent_event_to(
                &sink,
                &serde_json::json!({
                    "type": "subagent_notified", "run_id": "r", "agent": "explore",
                    "status": "completed", "wake": wake, "wake_batch": "b", "chain_index": 0,
                }),
            );
        }
        for reason in SUBAGENT_REJECT_REASONS {
            subagent_event_to(
                &sink,
                &serde_json::json!({
                    "type": "subagent_rejected", "reason": reason,
                    "agent": "explore", "description": "d",
                }),
            );
        }
        sink.flush();
        let lines = read_lines(dir.path());
        assert_eq!(
            lines.len(),
            SUBAGENT_STATUSES.len()
                + SUBAGENT_STOPPED_BY.len()
                + SUBAGENT_WAKE.len()
                + SUBAGENT_REJECT_REASONS.len()
        );
    }

    /// 反向输入（区分度）：闭集合外的值在测试构建下必须判红——把断言删掉这条用例会假绿。
    #[test]
    #[should_panic(expected = "不在闭集合")]
    fn subagent_closed_set_violation_is_caught() {
        let dir = TempDir::new();
        let sink = sink(dir.path(), LogLevel::Info);
        subagent_event_to(
            &sink,
            &serde_json::json!({
                "type": "subagent_finished", "run_id": "r", "segment": 1,
                "agent": "explore", "status": "bogus", "rounds": 0, "model": "m",
            }),
        );
    }

    /// 面板事件名 ↔ 诊断事件的映射是双射；非 `subagent_*` 的事件原样放过（不落日志）。
    #[test]
    fn subagent_event_mapping_is_bijective() {
        for name in [
            LogEventName::SubagentStarted,
            LogEventName::SubagentProgress,
            LogEventName::SubagentStep,
            LogEventName::SubagentFinished,
            LogEventName::SubagentNotified,
            LogEventName::SubagentRejected,
            LogEventName::SubagentCatalogLarge,
        ] {
            assert_eq!(
                LogEventName::from_subagent_event(name.as_str()),
                Some(name),
                "{} 的映射不闭合",
                name.as_str()
            );
        }
        assert_eq!(LogEventName::from_subagent_event("tool_call"), None);
        assert_eq!(LogEventName::from_subagent_event("usage"), None);
        let dir = TempDir::new();
        let sink = sink(dir.path(), LogLevel::Info);
        subagent_event_to(&sink, &serde_json::json!({"type": "done"}));
        sink.flush();
        assert!(
            read_lines(dir.path()).is_empty(),
            "非子运行事件不落诊断日志"
        );
    }

    /// 完成事件只有两个构造点（tasks §7.2 机制化）：段收尾（`ChildContext::finish`）与
    /// **无段终态**（线程启动失败 / 段前失败，共用一个 `emit_failed_terminal`）。所有终态都
    /// 显式产出一条、都由 `logging::subagent_event` 这**唯一**诊断出口落盘——
    /// MUST NOT 在业务分支里各写一遍 `logging::subagent_*`。
    #[test]
    fn subagent_diagnostics_have_a_single_production_point() {
        let mut hits = Vec::new();
        collect_source_hits(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
            concat!("logging::", "subagent_event"),
            &mut hits,
        );
        assert_eq!(
            hits.len(),
            1,
            "子运行诊断只允许在出口包装处产出，实际命中：{hits:?}"
        );
        assert!(
            hits[0].contains("harness/subagents.rs"),
            "唯一的诊断产出点应在 subagents.rs 的事件出口：{hits:?}"
        );

        let mut finished = Vec::new();
        collect_source_hits(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
            concat!("events::", "subagent_finished"),
            &mut finished,
        );
        assert_eq!(
            finished.len(),
            2,
            "完成事件只允许「段收尾」与「无段终态」两处，实际：{finished:?}"
        );
        assert!(
            finished
                .iter()
                .all(|hit| hit.contains("harness/subagents.rs")),
            "两处都应在 subagents.rs：{finished:?}"
        );
    }

    /// 递归收集源码命中（`path:line` 形态）；跳过测试代码自身的 needle 靠调用侧的 `concat!`。
    fn collect_source_hits(dir: &Path, needle: &str, hits: &mut Vec<String>) {
        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_source_hits(&path, needle, hits);
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            for (index, line) in text.lines().enumerate() {
                if line.contains(needle) && !line.trim_start().starts_with("//") {
                    hits.push(format!("{}:{}", path.display(), index + 1));
                }
            }
        }
    }
}
