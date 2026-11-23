//! 会话 JSONL 留存（change reshape-harness-session-recording，spec「会话本地留存」的
//! wire 口径）：留存定位是**完整会话记录**——每会话一个 append-only JSONL，按发给
//! 模型的形态直接记录（参照 Claude Code / Kimi Code 的 session wire.jsonl），
//! 分析与恢复共用同一份事实。留存落在**配置目录**（ADR 0007 双向记录机制的本地一侧），
//! **MUST NOT 写入 vault**。
//!
//! 布局：`<config_dir>/harness/sessions/<vault 稳定 id>/<session_id>.jsonl`。目录名取 vault
//! 注册表 id（与 `vault-sessions/<id>.json`、`reading-positions/<id>.json` 同一份身份；MUST NOT
//! 用 vault 路径派生的消毒名——消毒名有撞名面，M309 现场）。**目录只作组织维度**：会话归属
//! 判据仍是首行 `session_open.vault_root`（`harness::session_belongs_to_scope`），文件被手工
//! 挪动 / 拷贝不改归属结论。首行恒为 `session_open`
//! （完整装配记录：system prompt 全文 + 每来源的路径与存在与否 + provider / 模型 /
//! 思考档位）；其后 `llm_request` / `llm_response` 严格交替成对（工具循环每次迭代与
//! 压缩调用自身都各算一次 LLM 调用）；批准 / 拒绝 / 中断 / 错误等 wire 不可推导的
//! 决策落 sidecar 记录（`approval` / `turn_aborted` / `llm_error` / `loop_max_reached`）。
//!
//! **旧形态孤儿（M309 先例）**：本布局替换了旧的 `<config_dir>/harness/<vault 消毒名>.jsonl`
//! 聚合文件——旧文件不再续写、不做迁移（探针期可接受；留存是审计侧记录，丢弃续写不阻断
//! 对话；REVIEW.md 「变更默认直接切断」条「消费者是谁」：运行时与产品侧零读者）。
//!
//! 写失败不阻断对话——留存是记录侧，IO / 序列化失败只打 stderr（不变量 6），
//! 不反过来弄坏运行时；打开（建文件）失败则走 CommandError（与既有建立纪律同口径）。

use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::commands::CommandError;

/// 当前 UNIX 秒时间戳。JSONL 留存记录的 `ts` 与面板消息的 `ts`（[`super::session::PanelMessage`]）
/// **共用这一个取时点**——两处各自写 `SystemTime::now()` 会漂，而两者同口径正是「面板上的时间
/// 与留存里的时间对得上」的前提（M353）。系统时钟早于 epoch 时记 0（旧写法同口径）。
pub(crate) fn unix_secs_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 生成一个时间序 session id：`s<unix_millis>-<6 位随机 base36>`（如 `s1759912345678-k3x9ab`）。
/// 时间序是为了「按时间列出会话」——未来的第一消费姿势（design §1）；随机段把同一毫秒内的
/// 多次建立区分开（`rand` 已在依赖树内，transitive 零新增）。
pub fn new_session_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut random = rand::random::<u64>();
    let mut suffix = String::with_capacity(6);
    for _ in 0..6 {
        let digit = (random % 36) as u8;
        suffix.push(match digit {
            0..=9 => (b'0' + digit) as char,
            _ => (b'a' + digit - 10) as char,
        });
        random /= 36;
    }
    format!("s{millis}-{suffix}")
}

/// session id 的形态校验（恢复命令的入参防线）：只允许 `[a-z0-9-]`、以 `s` 开头、
/// 长度有界——保证拼进 `sessions/` 目录后不可能穿越出目录（无 `.`、无路径分隔符）。
pub fn is_valid_session_id(id: &str) -> bool {
    id.len() >= 8
        && id.len() <= 64
        && id.starts_with('s')
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// 会话留存根目录的纯路径投影（目录段的**唯一装配点**）：创建与测试断言共用同一份拼接，
/// 不在别处另拼一次。
fn sessions_root(config_dir: &Path) -> PathBuf {
    config_dir.join("harness").join("sessions")
}

/// 会话留存**根**目录：`<config_dir>/harness/sessions`（各 vault 目录的容器；本目录自身
/// MUST NOT 再落 `*.jsonl`——存量平铺文件由一次性脚本归位，见 `scripts/migrate-harness-sessions.mjs`）。
pub fn sessions_dir() -> Result<PathBuf, CommandError> {
    let dir = sessions_root(&crate::config::config_dir()?);
    std::fs::create_dir_all(&dir).map_err(|e| {
        CommandError::new(
            "harness_jsonl_failed",
            format!("无法创建会话留存目录 {}：{e}", dir.display()),
        )
        .param("dir", dir.display().to_string())
        .param("reason", e.to_string())
    })?;
    Ok(dir)
}

/// 保留目录名：一次性归位脚本搬不动的东西落这里（脚本侧同名常量的单一真源在脚本里，
/// 见 `scripts/migrate-harness-sessions.mjs` 的 `ORPHANED_DIR_NAME`）。
pub const ORPHANED_DIR_NAME: &str = "_orphaned";

/// vault 目录名（id → 目录名）的保留名纪律：`valid_id` 通过且 ≠ `_orphaned`，否则 `None`。
/// 不通过是**不可达**分支（id 由 `reconcile_vault` 产出，恒为 `vault-<pid>-<n>`），实现仍显式
/// 判一次——不 panic、不静默（design §2 保留名纪律 / §6 边界矩阵）。
///
/// `pub(crate)`：harness 附件目录（`harness::attachments`）复用同一份目录名纪律
/// （change harness-composer-image-paste design §5.1；附件侧对不合格 id 是**拒绝落盘**，
/// 不是 sessions 的 `_orphaned/` 兜底——两处处置不同，共用的只是「名字合格」判据）。
pub(crate) fn vault_dir_name(vault_id: &str) -> Option<&str> {
    (vault_id != ORPHANED_DIR_NAME && crate::vault_registry::valid_id(vault_id).is_ok())
        .then_some(vault_id)
}

/// 本 vault 的会话留存目录 `<config_dir>/harness/sessions/<vault 稳定 id>/`（按需创建）。
/// id 不合法时记一条 stderr 并按 `_orphaned/` 口径落盘——记录不静默丢、对话不中断。
pub fn vault_sessions_dir(vault_id: &str) -> Result<PathBuf, CommandError> {
    let name = match vault_dir_name(vault_id) {
        Some(name) => name,
        None => {
            eprintln!(
                "lumir: harness 会话目录名非法（{vault_id:?}，须 valid_id 且 ≠ {ORPHANED_DIR_NAME}）\
                 ——按 {ORPHANED_DIR_NAME} 口径落盘"
            );
            ORPHANED_DIR_NAME
        }
    };
    let dir = sessions_dir()?.join(name);
    std::fs::create_dir_all(&dir).map_err(|e| {
        CommandError::new(
            "harness_jsonl_failed",
            format!("无法创建会话留存目录 {}：{e}", dir.display()),
        )
        .param("dir", dir.display().to_string())
        .param("reason", e.to_string())
    })?;
    Ok(dir)
}

/// 子运行审计根目录的纯路径投影（目录段的**唯一装配点**；与会话留存根目录并列，
/// 两个根目录因此不可能互相嵌套）。
fn subruns_root(config_dir: &Path) -> PathBuf {
    config_dir.join("harness").join("subruns")
}

/// 子运行审计流水的根目录：`<config_dir>/harness/subruns`（change add-harness-subagents
/// design §9.2）。MUST NOT 写 `sessions/`、MUST NOT 写 vault——这是审计轨迹，不是可恢复
/// 会话；会话列举 / 恢复 / 删除链路不感知它。
pub fn subruns_dir() -> Result<PathBuf, CommandError> {
    let dir = subruns_root(&crate::config::config_dir()?);
    std::fs::create_dir_all(&dir).map_err(|e| {
        CommandError::new(
            "harness_jsonl_failed",
            format!("无法创建子运行审计目录 {}：{e}", dir.display()),
        )
        .param("dir", dir.display().to_string())
        .param("reason", e.to_string())
    })?;
    Ok(dir)
}

/// 本 vault 的子运行审计目录 `<config_dir>/harness/subruns/<vault 稳定 id>/`（按需创建）。
pub fn vault_subruns_dir(vault_id: &str) -> Result<PathBuf, CommandError> {
    let name = vault_dir_name(vault_id).unwrap_or(ORPHANED_DIR_NAME);
    let dir = subruns_dir()?.join(name);
    std::fs::create_dir_all(&dir).map_err(|e| {
        CommandError::new(
            "harness_jsonl_failed",
            format!("无法创建子运行审计目录 {}：{e}", dir.display()),
        )
        .param("dir", dir.display().to_string())
        .param("reason", e.to_string())
    })?;
    Ok(dir)
}

/// 当前写健康的分类（序列化为 `"ok"` / `"degraded"`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PersistenceState {
    Ok,
    Degraded,
}

/// 本段 `degraded` 的严重度（序列化为 `"history"` / `"annotation"`）。
///
/// `history` = 失败记录属于 `llm_request` / `llm_response`、失败可能已在文件里留下部分字节，
/// 或首行 `session_open` 失败；`annotation` = 仅 sidecar 且没有任何字节落盘。只升不降。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PersistenceSeverity {
    History,
    Annotation,
}

/// 历史缺口（latch）：本逻辑会话是否已经缺失恢复所依赖的记录，或文件是否可能因部分写而损坏。
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct HistoryGap {
    pub present: bool,
    pub since_ts: u64,
    pub detail: String,
}

/// 留存健康（spec「留存健康状态」）：两个相互独立的维度 + `history_written` 辅助事实。
///
/// 键集合是快照 `persistence` 与事件 `persistence` 的共同来源——两者 MUST 共用这一份
/// `Serialize`（同键同值不变量），MUST NOT 各列一份键清单（REVIEW.md「同一语义两处真源」条）。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PersistenceHealth {
    pub state: PersistenceState,
    pub since_ts: u64,
    pub severity: Option<PersistenceSeverity>,
    pub detail: String,
    pub history_written: bool,
    pub history_gap: HistoryGap,
    /// 逻辑会话身份（后端 `Session::subagent_token`）：MUST NOT 序列化进 health 载荷——
    /// 事件以信封字段、快照以顶层 `session_token` 呈现，六键 + gap 三键的合同不变。
    /// 前端据此丢弃旧逻辑会话的迟到事件（新会话 / 恢复 / 重置后）。
    #[serde(skip)]
    pub session_token: u64,
}

impl Default for PersistenceHealth {
    fn default() -> Self {
        Self {
            state: PersistenceState::Ok,
            since_ts: 0,
            severity: None,
            detail: String::new(),
            history_written: false,
            history_gap: HistoryGap::default(),
            session_token: 0,
        }
    }
}

/// 健康跃迁的上报口（由 `Runtime` 装配并盖 vault 信封；`jsonl.rs` MUST NOT 依赖 tauri）。
pub type PersistenceReporter = Arc<dyn Fn(&PersistenceHealth) + Send + Sync>;

/// 健康跃迁的**延迟发送队列**（design §4.5：发送 MUST NOT 在持有 Session / Writer 锁时进行）。
///
/// 写点只把完整快照推进队列（health 锁内只做状态更新，不调用任何 sink）；`Runtime::with_session`
/// 在释放 sessions 锁之后 `flush()`，把快照交给 reporter。`jsonl.rs` 因此仍然不依赖 tauri。
#[derive(Clone, Default)]
pub(crate) struct PersistenceTransitions(Arc<Mutex<TransitionState>>);

/// 单条跃迁的 reporter 连续 panic 上限：达到后丢弃该条并记 stderr，继续后续项。
/// 目的是「永久 panic 不无限重试 / 不递归崩溃」，同时不让毒项堵住队列。
const MAX_REPORTER_PANICS: usize = 3;

#[derive(Default)]
struct TransitionState {
    reporter: Option<PersistenceReporter>,
    pending: VecDeque<PersistenceHealth>,
    /// 是否已有 drainer 在发送：同一队列只允许一个发送者（复审 P1：并发 drain 会乱序）。
    draining: bool,
}

impl PersistenceTransitions {
    fn with(reporter: Option<PersistenceReporter>) -> Self {
        Self(Arc::new(Mutex::new(TransitionState {
            reporter,
            pending: VecDeque::new(),
            draining: false,
        })))
    }

    /// 记录一次跃迁（只入队，不发送）。
    fn push(&self, health: &PersistenceHealth) {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .pending
            .push_back(health.clone());
    }

    /// 在锁域外发出全部待发跃迁（调用方保证不持有 Session / Writer 锁）。
    ///
    /// **同一队列只有一个 drainer**，且它持续 drain 到队列为空：两个线程并发 flush 时，
    /// 第二个直接返回，第一个在每次发送后重新取队列，因此事件发送顺序严格等于入队顺序。
    ///
    /// **panic 恢复**：一次只取一条（不整批 take）；锁只用于入队 / 取件 / `draining` 标记，
    /// reporter 调用始终在锁外，并用 `catch_unwind` 包住：
    /// - reporter 瞬时 panic：该条放回**队首**，同一次 flush 内重试，顺序不变；
    /// - panic 期间新入队的项：仍由当前 drainer 在恢复后继续取，不依赖新的 flush；
    /// - reporter 永久 panic：同一条连续失败达到 [`MAX_REPORTER_PANICS`] 后丢弃并记 stderr，
    ///   继续后续项；不会无限重试或把 panic 递归抛出。
    pub(crate) fn flush(&self) {
        {
            let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
            if state.draining || state.pending.is_empty() {
                return;
            }
            state.draining = true;
        }
        let mut consecutive_panics = 0usize;
        loop {
            let health = {
                let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
                match state.pending.pop_front() {
                    Some(health) => health,
                    None => {
                        // 与「取空」同一把锁落标记：producer 不可能在空检查与标记之间入队。
                        state.draining = false;
                        return;
                    }
                }
            };
            let reporter = {
                let state = self.0.lock().unwrap_or_else(|e| e.into_inner());
                state.reporter.clone()
            };
            let Some(reporter) = reporter else {
                continue;
            };
            match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| reporter(&health))) {
                Ok(()) => consecutive_panics = 0,
                Err(_) => {
                    consecutive_panics += 1;
                    eprintln!(
                        "lumir: persistence 事件发送 panic（{}，连续第 {} 次）",
                        health.detail, consecutive_panics
                    );
                    if consecutive_panics < MAX_REPORTER_PANICS {
                        // 未成功交付：放回队首，保持顺序在同一次 flush 内重试。
                        self.0
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .pending
                            .push_front(health);
                    } else {
                        eprintln!(
                            "lumir: persistence 事件连续 panic {} 次，丢弃该跃迁（{}）",
                            MAX_REPORTER_PANICS, health.detail
                        );
                        consecutive_panics = 0;
                    }
                }
            }
        }
    }
}

/// 一条 JSONL 行的写入失败。`partial` = 报错前是否已有字节落盘（无法区分时 MUST 按 true 处理）。
pub(crate) struct LineWriteError {
    pub error: std::io::Error,
    /// 是否可能已写入部分字节（JSONL 完整性可能受损）。
    pub partial: bool,
}

/// 行写入的可注入出口（design §4.6 的测试 seam）：生产写 `File`，测试写 N 字节后返回 Err。
pub(crate) trait LineSink: Send {
    fn write_line(&mut self, line: &str) -> Result<(), LineWriteError>;
}

/// 生产实现：追加写一个整行（行 + `\n`），逐次 `write` 累计已写字节数——报错时据此区分
/// 「干净失败」（0 字节）与「可能部分写」（>0 字节）。
struct FileSink(File);

impl LineSink for FileSink {
    fn write_line(&mut self, line: &str) -> Result<(), LineWriteError> {
        let mut buffer = Vec::with_capacity(line.len() + 1);
        buffer.extend_from_slice(line.as_bytes());
        buffer.push(b'\n');
        let mut written = 0usize;
        while written < buffer.len() {
            match self.0.write(&buffer[written..]) {
                Ok(0) => {
                    return Err(LineWriteError {
                        error: std::io::Error::new(std::io::ErrorKind::WriteZero, "写入 0 字节"),
                        partial: written > 0,
                    })
                }
                Ok(n) => written += n,
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) => {
                    return Err(LineWriteError {
                        error: e,
                        partial: written > 0,
                    })
                }
            }
        }
        Ok(())
    }
}

/// `llm_request` / `llm_response` 是恢复所依赖的 history 记录（其余 kind 都是 annotation）。
fn is_history_kind(kind: &str) -> bool {
    matches!(kind, "llm_request" | "llm_response")
}

/// 一个逻辑会话的留存句柄。append-only；首行恒为 `session_open`（构造时给定，
/// **惰性**落到第一条记录时写入——从未记录的会话不落文件）。
pub struct JsonlWriter {
    path: PathBuf,
    /// 已打开的行写入出口；测试可注入替身（注入时跳过按路径打开）。
    sink: Option<Box<dyn LineSink>>,
    /// 尚未写出的 `session_open` 行（序列化后的 envelope）。第一条 `record` 时
    /// 随文件创建一并写盘，**写成功后才 `None`**——首行不变量由这个挂起行保证；
    /// 写失败时保留原行，下一条记录仍先重试它（design §4.6 / 评审阻塞 3）。
    pending_open: Option<String>,
    /// 首次打开是否要求**新建**文件（`create_new`）。会话留存恒 true（防 session id 碰撞
    /// 静默踩别人的文件）；子运行审计的后续段是同一文件追加，此时为 false（create +
    /// append）。
    fresh: bool,
    /// 会话留存健康（子运行审计流水不挂健康：`create_at` / `append_at` 为 `None`）。
    health: Option<Arc<Mutex<PersistenceHealth>>>,
    /// 跃迁队列（`Runtime` 在锁域外 flush；子运行审计无 reporter，队列只进不出）。
    transitions: PersistenceTransitions,
}

impl JsonlWriter {
    /// 建一个新会话的留存文件句柄：`sessions/<vault 稳定 id>/<session_id>.jsonl`，首行挂起
    /// `session_open` 行。文件本身惰性创建（与旧口径一致：句柄可建，文件随首条记录）。
    /// 目录按需创建（`vault_sessions_dir`；创建失败沿用 `harness_jsonl_failed` 口径）。
    /// `session_open` 形状契约见 design §2（kind / session_id / vault_root / opened_from /
    /// provider / model / thinking / system / assembly / compact_summary?）。
    ///
    /// `reporter` 是健康跃迁的上报口（`Runtime::persistence_reporter` 的产物）：
    /// 会话留存每条新句柄都带同一份健康与同一个上报口；子运行审计不传。
    pub fn create(
        session_id: &str,
        vault_id: &str,
        session_open: &serde_json::Value,
        reporter: Option<PersistenceReporter>,
    ) -> Result<Self, CommandError> {
        let dir = vault_sessions_dir(vault_id)?;
        let path = dir.join(format!("{session_id}.jsonl"));
        let line = serde_json::to_string(&serde_json::json!({
            "ts": unix_secs_now(),
            "payload": session_open,
        }))
        .map_err(|e| {
            CommandError::new(
                "harness_jsonl_failed",
                format!("session_open 序列化失败：{e}"),
            )
            .param("dir", dir.display().to_string())
            .param("reason", e.to_string())
        })?;
        Ok(Self {
            path,
            sink: None,
            pending_open: Some(line),
            fresh: true,
            health: Some(Arc::new(Mutex::new(PersistenceHealth::default()))),
            transitions: PersistenceTransitions::with(reporter),
        })
    }

    /// 指定路径建一个**新**留存文件句柄（子运行审计首段：`run_open` 作首行）。
    /// 子运行审计流水不挂健康（design §4.1）——其失败不进用户可见的健康状态。
    pub fn create_at(path: PathBuf, open: &serde_json::Value) -> Result<Self, CommandError> {
        let line = serde_json::to_string(&serde_json::json!({
            "ts": unix_secs_now(),
            "payload": open,
        }))
        .map_err(|e| {
            CommandError::new("harness_jsonl_failed", format!("run_open 序列化失败：{e}"))
                .param("dir", path.display().to_string())
                .param("reason", e.to_string())
        })?;
        Ok(Self {
            path,
            sink: None,
            pending_open: Some(line),
            fresh: true,
            health: None,
            transitions: PersistenceTransitions::default(),
        })
    }

    /// 指定路径**追加**到既有文件（子运行审计的后续段：同一文件追加 `run_segment` 等记录）。
    /// 文件不存在时创建；首行不变量由首段保证，这里不写 `session_open`。
    pub fn append_at(path: PathBuf) -> Self {
        Self {
            path,
            sink: None,
            pending_open: None,
            fresh: false,
            health: None,
            transitions: PersistenceTransitions::default(),
        }
    }

    /// 当前留存健康（只读投影）。子运行审计句柄返回 `None`。
    pub fn persistence(&self) -> Option<PersistenceHealth> {
        self.health
            .as_ref()
            .map(|health| health.lock().unwrap_or_else(|e| e.into_inner()).clone())
    }

    /// 把另一份会话留存句柄的健康与上报口接到自己身上（自动压缩换文件：两维 + `history_written`
    /// 沿用，直到新文件首次成功追加；该成功只把当前写健康转 `ok`，MUST NOT 清除缺口）。
    pub fn adopt_health_from(&mut self, other: &JsonlWriter) {
        self.health = other.health.clone();
        self.transitions = other.transitions.clone();
    }

    /// 跃迁队列（`Runtime` 在释放 sessions 锁后 flush）。
    pub(crate) fn transitions(&self) -> PersistenceTransitions {
        self.transitions.clone()
    }

    /// 绑定逻辑会话身份（`Session::new` 在首条记录之前调用；rotate 沿用同一 health）。
    pub(crate) fn set_session_token(&self, token: u64) {
        if let Some(health) = &self.health {
            health
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .session_token = token;
        }
    }

    /// 追加一条记录。首条记录先把挂起的 `session_open` 写出（**写成功后才丢弃挂起行**）。
    /// 写失败只打 stderr + 诊断日志（留存不可反过来弄坏对话），并如实更新健康。
    pub fn record(&mut self, payload: &serde_json::Value) {
        let kind = payload
            .get("kind")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown")
            .to_string();
        let history_payload = is_history_kind(&kind);
        let line = match serde_json::to_string(&serde_json::json!({
            "ts": unix_secs_now(),
            "payload": payload,
        })) {
            Ok(line) => line,
            Err(e) => {
                self.fail(
                    &kind,
                    "serialize",
                    if history_payload {
                        PersistenceSeverity::History
                    } else {
                        PersistenceSeverity::Annotation
                    },
                    history_payload,
                    false,
                    &e.to_string(),
                );
                return;
            }
        };
        if self.sink.is_none() {
            if let Err(e) = self.open_file() {
                self.fail(
                    &kind,
                    "open",
                    if history_payload {
                        PersistenceSeverity::History
                    } else {
                        PersistenceSeverity::Annotation
                    },
                    history_payload,
                    false,
                    &e.to_string(),
                );
                return;
            }
        }
        if let Some(open) = self.pending_open.clone() {
            match self.write_line(&open) {
                // 写成功后才丢弃挂起行：首行写失败时它必须留在内存里等下一条记录重试。
                Ok(()) => self.pending_open = None,
                Err(e) => {
                    // 首行失败一律 severity=history；本次 payload 也随调用丢弃——它是不是
                    // history 由 `history_payload` 决定（annotation 不 latch）。
                    self.fail(
                        &kind,
                        "first_line",
                        PersistenceSeverity::History,
                        history_payload,
                        e.partial,
                        &e.error.to_string(),
                    );
                    return;
                }
            }
        }
        match self.write_line(&line) {
            Ok(()) => self.succeed(history_payload),
            Err(e) => {
                let severity = if history_payload || e.partial {
                    PersistenceSeverity::History
                } else {
                    PersistenceSeverity::Annotation
                };
                self.fail(
                    &kind,
                    "write",
                    severity,
                    history_payload,
                    e.partial,
                    &e.error.to_string(),
                );
            }
        }
    }

    fn write_line(&mut self, line: &str) -> Result<(), LineWriteError> {
        match self.sink.as_mut() {
            Some(sink) => sink.write_line(line),
            None => Ok(()),
        }
    }

    /// 打开（创建）留存文件。`create_new` 防 session id 碰撞时静默踩别人的文件。
    fn open_file(&mut self) -> Result<(), std::io::Error> {
        let mut options = OpenOptions::new();
        if self.fresh {
            options.create_new(true);
        } else {
            options.create(true);
        }
        let file = options.append(true).open(&self.path)?;
        self.sink = Some(Box::new(FileSink(file)));
        Ok(())
    }

    /// 记录一次写失败：更新两维健康、落结构化诊断日志、按跃迁上报。
    ///
    /// `partial` = 报错前是否可能已有字节落盘（无法区分时调用侧传 true）。
    fn fail(
        &self,
        kind: &str,
        code: &str,
        severity: PersistenceSeverity,
        history_payload: bool,
        partial: bool,
        reason: &str,
    ) {
        eprintln!(
            "lumir: harness jsonl 写入失败（{}，{kind}/{code}，partial={partial}）：{reason}",
            self.path.display()
        );
        crate::logging::persistence_write_failed(
            kind,
            code,
            partial,
            &self.path.display().to_string(),
        );
        let Some(health) = &self.health else {
            return;
        };
        let now = unix_secs_now();
        let transition = {
            let mut health = health.lock().unwrap_or_else(|e| e.into_inner());
            let mut changed = false;
            if health.state == PersistenceState::Ok {
                health.state = PersistenceState::Degraded;
                health.since_ts = now;
                health.severity = Some(severity);
                health.detail = format!("{kind}:{code}");
                changed = true;
            } else if severity == PersistenceSeverity::History
                && health.severity != Some(PersistenceSeverity::History)
            {
                // severity 只升不降；detail / since_ts 冻结在本段 degraded 的首次失败。
                health.severity = Some(PersistenceSeverity::History);
                changed = true;
            }
            // 缺口 latch：history 记录失败、或任何可能部分写的失败（文件完整性可能受损）。
            // annotation 干净失败不置缺口。
            if (history_payload || partial) && !health.history_gap.present {
                health.history_gap.present = true;
                health.history_gap.since_ts = now;
                health.history_gap.detail = format!("{kind}:{code}");
                changed = true;
            }
            changed.then(|| health.clone())
        };
        if let Some(snapshot) = transition {
            self.transitions.push(&snapshot);
        }
    }

    /// 记录一次成功追加：当前写健康回 `ok`（缺口 MUST NOT 被清除），history 记录成功时把
    /// `history_written` 置 true。
    fn succeed(&self, history_payload: bool) {
        let Some(health) = &self.health else {
            return;
        };
        let transition = {
            let mut health = health.lock().unwrap_or_else(|e| e.into_inner());
            let mut changed = false;
            if health.state != PersistenceState::Ok {
                health.state = PersistenceState::Ok;
                health.since_ts = 0;
                health.severity = None;
                health.detail.clear();
                changed = true;
            }
            if history_payload && !health.history_written {
                health.history_written = true;
                changed = true;
            }
            changed.then(|| health.clone())
        };
        if let Some(snapshot) = transition {
            self.transitions.push(&snapshot);
        }
    }

    /// 在 `session_open` 尚未落盘时更新它的一个字段（ thinking 档位的滞后修正：
    /// 会话建立与首条记录之间用户可能切过档位，首行要反映实际发出请求时的档位）。
    /// 已落盘则为 no-op（历史不改写）。
    pub fn update_pending_open<F: FnOnce(&mut serde_json::Value)>(&mut self, update: F) {
        if self.pending_open.is_none() {
            return;
        }
        let Ok(mut envelope) =
            serde_json::from_str::<serde_json::Value>(self.pending_open.as_deref().unwrap_or(""))
        else {
            return;
        };
        if let Some(payload) = envelope.get_mut("payload") {
            update(payload);
            if let Ok(line) = serde_json::to_string(&envelope) {
                self.pending_open = Some(line);
            }
        }
    }

    /// 留存文件路径（测试与恢复用）。
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// 测试专用：直接指定留存路径（绕开 config_dir，零环境变量扰动——env 是进程全局，
    /// cargo test 并行跑，改 XDG_CONFIG_HOME 会踩到别的用例；REVIEW.md 「测试污染真实环境」条）。
    /// `pub(crate)`：`session::tests` 也要构造带句柄的 `Session`（M443 的累计边界用例）。
    #[cfg(test)]
    pub(crate) fn at_path(path: PathBuf, session_open: &serde_json::Value) -> Self {
        let line = serde_json::to_string(&serde_json::json!({
            "ts": unix_secs_now(),
            "payload": session_open,
        }))
        .unwrap();
        Self {
            path,
            sink: None,
            pending_open: Some(line),
            fresh: true,
            health: Some(Arc::new(Mutex::new(PersistenceHealth::default()))),
            transitions: PersistenceTransitions::default(),
        }
    }

    /// 测试专用：注入行写入替身（`LineSink` 故障注入，R6 / R7）——不走按路径打开。
    #[cfg(test)]
    pub(crate) fn at_path_with_sink(
        path: PathBuf,
        session_open: &serde_json::Value,
        sink: Box<dyn LineSink>,
        reporter: Option<PersistenceReporter>,
    ) -> Self {
        let mut writer = Self::at_path(path, session_open);
        writer.sink = Some(sink);
        writer.transitions = PersistenceTransitions::with(reporter);
        writer
    }

    /// 从留存文件路径取 session id（`sessions/<vault 稳定 id>/<session_id>.jsonl` 的文件名部分；
    /// 测试与恢复命令的解析共用）。
    pub fn session_id_from_path(path: &Path) -> Option<String> {
        path.file_stem()
            .and_then(|s| s.to_str())
            .map(str::to_string)
    }
}

// ---------------------------------------------------------------------------
// 读取侧（恢复逻辑的消费者）：从留存文件重建会话状态
// ---------------------------------------------------------------------------

/// 一份解析后的会话留存：首行 `session_open` + 全部 payload（按文件序）。
#[derive(Debug)]
pub struct SessionFile {
    /// 首行信封的 `ts`（UNIX 秒，会话建立时刻）——会话列举的展示 / 排序素材。
    /// 历史文件缺该字段时为 `None`（宽容读，不因此判整份文件非法）。
    pub first_ts: Option<u64>,
    /// 首行 `session_open` payload（含 system 全文 / assembly / provider / model / thinking）。
    pub session_open: serde_json::Value,
    /// 全部记录的 payload（含 `session_open` 自身，按文件序）。
    pub records: Vec<serde_json::Value>,
    /// 每条记录**信封**的 `ts`（UNIX 秒），与 [`SessionFile::records`] 逐位对齐；历史行缺该
    /// 字段时记 `None`（宽容读，不因此判整份文件非法）。会话恢复的时间读数数据源（M460）：
    /// wire 项自身不带时间戳，重建面板消息时按它所在的记录时刻归属
    /// （[`crate::harness::restored_messages_ts`]）。
    pub record_ts: Vec<Option<u64>>,
}

/// 读取并解析一份会话留存文件。每行 envelope（`{ts, payload}`）逐条解析；首行必须是
/// `session_open`。整文件读取——会话文件是 append-only 的封闭事实，恢复一次性消费。
pub fn read_session_file(path: &Path) -> Result<SessionFile, CommandError> {
    let content = std::fs::read_to_string(path).map_err(|e| {
        CommandError::new(
            "harness_session_unreadable",
            format!("会话留存不可读（{}）：{e}", path.display()),
        )
        .param("path", path.display().to_string())
        .param("reason", e.to_string())
    })?;
    let mut records = Vec::new();
    let mut record_ts = Vec::new();
    let mut first_ts = None;
    for (index, line) in content.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let envelope: serde_json::Value = serde_json::from_str(line).map_err(|e| {
            CommandError::new(
                "harness_session_invalid",
                format!("会话留存第 {} 行不是合法 JSON：{e}", index + 1),
            )
            .param("path", path.display().to_string())
        })?;
        if records.is_empty() {
            first_ts = envelope["ts"].as_u64();
        }
        record_ts.push(envelope["ts"].as_u64());
        records.push(envelope["payload"].clone());
    }
    let Some(session_open) = records.first().filter(|r| r["kind"] == "session_open") else {
        return Err(CommandError::new(
            "harness_session_invalid",
            format!("会话留存首行不是 session_open（{}）", path.display()),
        ));
    };
    Ok(SessionFile {
        first_ts,
        session_open: session_open.clone(),
        records,
        record_ts,
    })
}

/// **有效标题的唯一读取口径**（change add-session-auto-naming，design D6 / D7）：文件内最后一条
/// 带 `title` 的 `session_title` 记录的 `title`；没有则 `None`（调用侧回落首条用户消息口径，
/// 旧文件安静回落——不告警、不补写）。
///
/// 列举 / 恢复 / 快照 / 事件四条出口都从这一处取值——MUST NOT 各写一份 last-wins 逻辑
/// （REVIEW.md 「同一语义两处真源」条）。`error` 记录不带 `title`，因此天然被跳过；`keep` /
/// `inherit` 记录带 `title`，参与 last-wins。
pub fn effective_title(records: &[serde_json::Value]) -> Option<String> {
    records
        .iter()
        .rev()
        .filter(|record| record["kind"] == "session_title")
        .filter_map(|record| record["title"].as_str())
        .find(|title| !title.trim().is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "lumir-harness-jsonl-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 合成一份最小 session_open（形状同 design §2）。
    fn session_open(id: &str) -> serde_json::Value {
        serde_json::json!({
            "kind": "session_open",
            "session_id": id,
            "vault_root": "/tmp/demo-vault",
            "opened_from": "new",
            "provider": "mock",
            "model": "mock-model",
            "thinking": "high",
            "system": "完整 system prompt 全文",
            "assembly": [
                {"source": "identity", "path": null, "exists": true, "bytes": 412},
                {"source": "agents_vault_root", "path": "/tmp/demo-vault/AGENTS.md",
                 "exists": false, "bytes": 0},
            ],
        })
    }

    #[test]
    fn session_id_is_time_ordered_randomized_and_validated() {
        let id = new_session_id();
        assert!(id.starts_with('s'), "{id}");
        assert!(is_valid_session_id(&id), "{id}");
        // 时间序：两个连续生成的 id 毫秒段单调不减。
        let other = new_session_id();
        let millis = |s: &str| s[1..s.find('-').unwrap()].parse::<u128>().unwrap();
        assert!(millis(&other) >= millis(&id));
        // 目录穿越与畸形入参一律拒。
        for bad in [
            "../etc/passwd",
            "s12345/x",
            "sABC-123456",
            "..",
            "s",
            "s.xxx-yyyyyy",
        ] {
            assert!(!is_valid_session_id(bad), "{bad}");
        }
    }

    /// 保留名纪律（design §2 / §6）：目录名 = vault 稳定 id，`valid_id` 与 ≠ `_orphaned`
    /// 双判；不通过即调用侧记日志并按 `_orphaned/` 口径落盘（不可达分支的显式判——
    /// 不 panic、不静默）。
    #[test]
    fn vault_dir_name_rejects_reserved_and_invalid_ids() {
        assert_eq!(vault_dir_name("vault-1000-1"), Some("vault-1000-1"));
        assert_eq!(
            vault_dir_name(ORPHANED_DIR_NAME),
            None,
            "保留名不可作 vault 目录名"
        );
        for bad in ["", "..", "a/b", "a b", "s.xxx", "a\\b"] {
            assert_eq!(vault_dir_name(bad), None, "{bad}");
        }
    }

    /// 首行不变量：无论第一条记录是什么 kind，`session_open` 恒在第一行；
    /// 且 `update_pending_open` 能在落盘前修正字段、落盘后不再改写。
    #[test]
    fn first_line_is_always_session_open_and_pending_update_works() {
        let dir = tmpdir("pending-open");
        let mut writer =
            JsonlWriter::at_path(dir.join("s-testaa.jsonl"), &session_open("s-testaa"));
        // 句柄创建即挂起首行，但文件惰性——record 之前不落盘。
        assert!(!writer.path().exists(), "首条记录前文件不应创建");
        writer.update_pending_open(|open| open["thinking"] = "max".into());
        writer.record(&serde_json::json!({"kind": "llm_request", "request": {"messages": []}}));
        let content = std::fs::read_to_string(writer.path()).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2, "{content}");
        let first: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["payload"]["kind"], "session_open");
        assert_eq!(first["payload"]["thinking"], "max", "挂起行修正必须生效");
        // 已落盘后再改 = no-op。
        writer.update_pending_open(|open| open["thinking"] = "low".into());
        let content = std::fs::read_to_string(writer.path()).unwrap();
        assert!(content.contains("\"thinking\":\"max\""), "{content}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 引用消息序列化协议的 wire 口径（change add-harness-quote-cards 的留存条款迁移）：
    /// 序列化后的完整消息（含 `<quote>` 块）在 `llm_request.messages` 数组中逐字节在场——
    /// 含标签、三属性、转义字符与交错的问题文字。一行一条、append-only、首行 session_open。
    #[test]
    fn llm_request_preserves_serialized_quote_message_verbatim() {
        let dir = tmpdir("quote-wire");
        let id = "s1759912345678-quote1";
        let mut writer = JsonlWriter::at_path(dir.join("quote.jsonl"), &session_open(id));
        // 与 M342 单测同形的合成 fixture（serializeQuoteMessage 的产物）：两张卡片 +
        // 两段问题，属性值与文本含 XML 保留字符（& < "）。
        let message = "<quote file=\"reading-workflow.md\" heading=\"筛选 &amp; 排序\" lines=\"9-10\">先读结论 &lt;再读论证&gt;</quote>\n这段是什么意思？\n<quote file=\"reading-workflow.md\" heading=\"复盘\" lines=\"16-17\">每周捞出「可执行动作\"</quote>\n这里指什么？";
        writer.record(&serde_json::json!({
            "kind": "llm_request",
            "request": {
                "provider": "mock",
                "model": "mock-model",
                "system": "完整 system prompt 全文",
                "messages": [
                    {"role": "user", "content": [{"type": "input_text", "text": message}]},
                ],
                "params": {"thinking": "high"},
            },
        }));
        let content = std::fs::read_to_string(writer.path()).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2, "{content}");
        let first: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["payload"]["kind"], "session_open");
        let second: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(
            second["payload"]["request"]["messages"][0]["content"][0]["text"]
                .as_str()
                .unwrap(),
            message,
            "留存必须逐字节保序列化消息"
        );
        assert!(second["ts"].is_u64(), "{lines:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// M460：读取侧保留每条记录**信封**的 `ts`（与 payload 逐位对齐）——会话恢复的时间读数
    /// 数据源。缺该字段的历史行记 `None`（宽容读，不伪造读数）。
    #[test]
    fn read_session_file_keeps_per_record_envelope_ts() {
        let dir = tmpdir("record-ts");
        let path = dir.join("s1759912345678-tsread.jsonl");
        let lines = [
            r#"{"ts":100,"payload":{"kind":"session_open","session_id":"s1759912345678-tsread"}}"#,
            r#"{"ts":105,"payload":{"kind":"llm_request","request":{"messages":[]}}}"#,
            r#"{"payload":{"kind":"llm_response","text":"旧行缺 ts"}}"#,
        ];
        std::fs::write(&path, lines.join("\n")).unwrap();
        let file = read_session_file(&path).unwrap();
        assert_eq!(file.record_ts, vec![Some(100), Some(105), None]);
        assert_eq!(file.first_ts, Some(100));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_session_file_roundtrip_and_validation() {
        let dir = tmpdir("read-back");
        let id = "s1759912345678-readb1";
        let mut writer = JsonlWriter::at_path(dir.join("readback.jsonl"), &session_open(id));
        writer.record(&serde_json::json!({"kind": "llm_response", "text": "答。"}));
        let file = read_session_file(writer.path()).unwrap();
        assert_eq!(file.session_open["session_id"], id);
        assert_eq!(file.records.len(), 2);
        assert_eq!(file.records[1]["kind"], "llm_response");

        // 首行不是 session_open ⇒ 拒。
        let bad = dir.join("bad.jsonl");
        std::fs::write(&bad, "{\"ts\":1,\"payload\":{\"kind\":\"llm_request\"}}\n").unwrap();
        let err = read_session_file(&bad).unwrap_err();
        assert_eq!(err.code, "harness_session_invalid");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ---- change add-session-auto-naming：session_title sidecar 与有效标题 ----

    /// `session_title` 记录 round-trip（design D6 的字段表）：写入后读回逐字段在场；
    /// `error` 记录不带 `title`、带 `code`；`inherit` 记录不带 `model`。
    #[test]
    fn session_title_records_roundtrip() {
        use crate::harness::title;
        let dir = tmpdir("session-title");
        let mut writer = JsonlWriter::at_path(dir.join("s-title.jsonl"), &session_open("s-title"));
        writer.record(&title::record_payload(
            "initial",
            title::REASON_FIRST_TURN,
            Some("Rust 生命周期排查"),
            Some("k3-256k"),
            None,
        ));
        writer.record(&title::record_payload(
            "error",
            title::REASON_CADENCE,
            None,
            Some("k3-256k"),
            Some(title::CODE_INVALID),
        ));
        writer.record(&title::inherit_payload("Rust 生命周期排查"));
        let file = read_session_file(writer.path()).unwrap();
        let titles: Vec<&serde_json::Value> = file
            .records
            .iter()
            .filter(|r| r["kind"] == "session_title")
            .collect();
        assert_eq!(titles.len(), 3);
        assert_eq!(titles[0]["decision"], "initial");
        assert_eq!(titles[0]["reason"], "first-turn");
        assert_eq!(titles[0]["title"], "Rust 生命周期排查");
        assert_eq!(titles[0]["model"], "k3-256k");
        // error：无 title、有 code（错误码是唯一诊断字段）。
        assert_eq!(titles[1]["decision"], "error");
        assert_eq!(titles[1]["reason"], "cadence");
        assert!(titles[1].get("title").is_none(), "{}", titles[1]);
        assert_eq!(titles[1]["code"], title::CODE_INVALID);
        // inherit：没有发起调用 ⇒ 不带 model。
        assert_eq!(titles[2]["decision"], "inherit");
        assert_eq!(titles[2]["reason"], "inherit");
        assert!(titles[2].get("model").is_none(), "{}", titles[2]);
        // 信封 ts 与既有记录同取时点（一条都不缺）。
        assert!(file.record_ts.iter().all(|ts| ts.is_some()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 有效标题 = 最后一条带 `title` 的记录（last-wins）：keep 携带同一标题不改变读数；
    /// error 记录被跳过；无记录 / 只有 error 记录 ⇒ None（回落首条用户消息口径）。
    #[test]
    fn effective_title_last_wins() {
        let title = |decision: &str, value: Option<&str>| {
            let mut record = serde_json::json!({"kind": "session_title", "decision": decision});
            if let Some(value) = value {
                record["title"] = serde_json::json!(value);
            }
            record
        };
        assert_eq!(effective_title(&[]), None);
        // error-only：没有可读标题（不伪造、不回落成空串）。
        assert_eq!(
            effective_title(&[title("error", None), title("error", None)]),
            None
        );
        assert_eq!(
            effective_title(&[
                title("initial", Some("A")),
                title("keep", Some("A")),
                title("error", None),
                title("rename", Some("B")),
                // 空串标题（防御形态）不作为读数。
                title("rename", Some("  ")),
            ])
            .as_deref(),
            Some("B")
        );
        // 非标题记录不参与（kind 判据）。
        assert_eq!(
            effective_title(&[
                serde_json::json!({"kind": "llm_response", "title": "不该被读"}),
                title("inherit", Some("C")),
            ])
            .as_deref(),
            Some("C")
        );
    }

    /// 恢复充分性（design 不变量 5 / D17）：`session_title` 是 wire 外 sidecar——它在场与否
    /// 不改变 wire 记录序列，也不改变「最后一条会话请求」的锚点。这里用同一份请求 / 响应序列
    /// 造两份文件（一份夹标题记录、一份不夹），断言 sidecar 过滤后的记录序列逐字节相等。
    #[test]
    fn restore_sufficiency_ignores_title_sidecars() {
        let request = serde_json::json!({
            "kind": "llm_request",
            "request": {"system": "S", "messages": [
                {"role": "user", "content": [{"type": "input_text", "text": "问"}]}
            ]},
        });
        let response = serde_json::json!({"kind": "llm_response", "text": "答。"});
        let wire = |records: &[serde_json::Value]| -> Vec<serde_json::Value> {
            records
                .iter()
                .filter(|record| {
                    record["kind"] == "llm_request" || record["kind"] == "llm_response"
                })
                .cloned()
                .collect()
        };
        use crate::harness::title;
        let plain = vec![
            request.clone(),
            response.clone(),
            request.clone(),
            response.clone(),
        ];
        let with_titles = vec![
            title::inherit_payload("标题"),
            plain[0].clone(),
            plain[1].clone(),
            title::record_payload("keep", title::REASON_CADENCE, Some("标题"), Some("m"), None),
            plain[2].clone(),
            // 记录不在请求 / 响应之间（空闲才追加），但仍要证明它不改变过滤结果。
            plain[3].clone(),
            title::record_payload(
                "rename",
                title::REASON_DRIFT,
                Some("新标题"),
                Some("m"),
                None,
            ),
        ];
        assert_eq!(wire(&plain), wire(&with_titles));
        // 请求 / 响应严格成对且相邻（折叠末尾响应的判据）——标题记录不插进这对之间。
        let pairs: Vec<&str> = with_titles
            .iter()
            .filter(|r| r["kind"] == "llm_request" || r["kind"] == "llm_response")
            .map(|r| r["kind"].as_str().unwrap_or(""))
            .collect();
        assert_eq!(
            pairs,
            vec!["llm_request", "llm_response", "llm_request", "llm_response"]
        );
        // 有效标题只改变展示读数，不改变上面的重建材料。
        assert_eq!(effective_title(&with_titles).as_deref(), Some("新标题"));
        assert_eq!(effective_title(&plain), None);
    }

    /// 审计流水与会话留存是两个并列的根目录（change add-harness-subagents design §9.2）：
    /// 同一 config_dir 下互不嵌套，会话列举 / 恢复 / 删除链路因此不可能读到子运行审计文件。
    /// 目录段断言只用 `file_name` / `parent`，不另拼一次完整路径（否则会命中下一条用例的 needle）。
    #[test]
    fn audit_and_session_roots_are_disjoint() {
        let base = Path::new("/tmp/lumir-config-probe");
        let sessions = sessions_root(base);
        let subruns = subruns_root(base);
        assert_eq!(sessions.parent(), Some(base.join("harness").as_path()));
        assert_eq!(subruns.parent(), Some(base.join("harness").as_path()));
        assert_eq!(
            sessions.file_name().and_then(|n| n.to_str()),
            Some("sessions")
        );
        assert_eq!(
            subruns.file_name().and_then(|n| n.to_str()),
            Some("subruns")
        );
        assert_ne!(sessions, subruns);
        assert!(!subruns.starts_with(&sessions));
        assert!(!sessions.starts_with(&subruns));
    }

    /// 目录段常量只有一处装配点（tasks §5.4 的 `rg` 断言机制化）：源码里 `join("sessions")`
    /// 与 `join("subruns")` 各恰好一次。needle 用 `concat!` 拼接，本测试自身不自我命中。
    #[test]
    fn directory_segments_have_one_assembly_point_each() {
        let source = include_str!("jsonl.rs");
        let sessions_needle = concat!(".join(", "\"sessions\")");
        let subruns_needle = concat!(".join(", "\"subruns\")");
        assert_eq!(
            source.matches(sessions_needle).count(),
            1,
            "sessions 目录段应只在 sessions_root 一处装配"
        );
        assert_eq!(
            source.matches(subruns_needle).count(),
            1,
            "subruns 目录段应只在 subruns_root 一处装配"
        );
    }

    // ---- change add-persistence-health-status-nov23：留存健康（R1–R10） ----
    //
    // 判据都读两个可观测面：`Session::snapshot` 的 `persistence` 键（快照面）与 reporter
    // 收到的载荷（事件面）。两处同吃一份 `PersistenceHealth` 序列化——MUST NOT 各判一套
    // （REVIEW.md「同一语义两处真源」条）。

    /// 可编排的行写入替身：`fail` 控制下一次（及之后）写入的行为，`lines` 记录成功落盘的整行。
    /// `Partial(n)` 表示「先写 n 字节、再返回错误」——生产侧据此把失败归为「可能部分写」。
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum ScriptMode {
        CleanFail,
        /// 先写入 N 字节、再返回错误——真实保留前缀字节（评审：不能只返回 partial 布尔）。
        PartialFail(usize),
    }

    #[derive(Default)]
    struct ScriptState {
        mode: Option<ScriptMode>,
        /// 实际写入的字节（成功整行 / 部分写的前缀）。测试据此断言文件形态。
        buffer: Vec<u8>,
    }

    #[derive(Clone, Default)]
    struct ScriptedSink {
        state: Arc<Mutex<ScriptState>>,
    }

    impl ScriptedSink {
        fn fail_clean(&self) {
            self.state.lock().unwrap().mode = Some(ScriptMode::CleanFail);
        }
        fn fail_partial(&self, bytes: usize) {
            self.state.lock().unwrap().mode = Some(ScriptMode::PartialFail(bytes));
        }
        fn heal(&self) {
            self.state.lock().unwrap().mode = None;
        }
        fn raw(&self) -> Vec<u8> {
            self.state.lock().unwrap().buffer.clone()
        }
        fn lines(&self) -> Vec<String> {
            let text = String::from_utf8_lossy(&self.state.lock().unwrap().buffer).to_string();
            if text.is_empty() {
                return Vec::new();
            }
            let mut lines: Vec<String> = text.split('\n').map(str::to_string).collect();
            // 成功写入以换行收尾：末尾空元素不算一行；部分写没有换行，保留为一行。
            if text.ends_with('\n') {
                lines.pop();
            }
            lines
        }
    }

    impl LineSink for ScriptedSink {
        fn write_line(&mut self, line: &str) -> Result<(), LineWriteError> {
            let mut state = self.state.lock().unwrap();
            match state.mode {
                None => {
                    state.buffer.extend_from_slice(line.as_bytes());
                    state.buffer.push(b'\n');
                    Ok(())
                }
                Some(ScriptMode::CleanFail) => Err(LineWriteError {
                    error: std::io::Error::other("scripted clean failure"),
                    partial: false,
                }),
                Some(ScriptMode::PartialFail(bytes)) => {
                    // 真实写入前缀字节（与生产 FileSink 的「已写 N 字节」同形），再报错。
                    let end = bytes.min(line.len());
                    state.buffer.extend_from_slice(&line.as_bytes()[..end]);
                    Err(LineWriteError {
                        error: std::io::Error::other("scripted partial failure"),
                        partial: end > 0,
                    })
                }
            }
        }
    }

    /// 测试走 writer 直写（不经过 Runtime::with_session）：显式 flush 延迟发送队列。
    fn flush_transitions(session: &mut crate::harness::session::Session) {
        session.jsonl().transitions().flush();
    }

    fn test_session(writer: JsonlWriter) -> crate::harness::session::Session {
        crate::harness::session::Session::new(
            PathBuf::from("/tmp/lumir-persistence-health"),
            "sys".into(),
            Vec::new(),
            crate::harness::thinking::ThinkingEffort::default(),
            writer,
        )
    }

    /// 快照的 `persistence` 读数（`serde_json::Value`：键集合与事件面逐键可比）。
    fn persistence_of(session: &crate::harness::session::Session) -> serde_json::Value {
        serde_json::to_value(session.snapshot(85.0, true)).unwrap()["persistence"].clone()
    }

    fn writer_with(
        dir: &Path,
        name: &str,
        sink: &ScriptedSink,
        reporter: Option<PersistenceReporter>,
    ) -> JsonlWriter {
        JsonlWriter::at_path_with_sink(
            dir.join(format!("{name}.jsonl")),
            &session_open("s-health"),
            Box::new(sink.clone()),
            reporter,
        )
    }

    fn collect_reporter() -> (
        Arc<Mutex<Vec<PersistenceHealth>>>,
        Option<PersistenceReporter>,
    ) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let target = seen.clone();
        let reporter: PersistenceReporter = Arc::new(move |health: &PersistenceHealth| {
            target.lock().unwrap().push(health.clone());
        });
        (seen, Some(reporter))
    }

    /// R1：annotation 干净失败 → `degraded(annotation)` 且无缺口；随后成功 → `ok`、无缺口。
    /// 区分度：把 annotation 失败误判成 history / 置 gap，都会让本用例红。
    #[test]
    fn r1_annotation_failure_degrades_without_gap_then_recovers() {
        let dir = tmpdir("health-r1");
        let sink = ScriptedSink::default();
        let mut session = test_session(writer_with(&dir, "r1", &sink, None));
        // 首行先成功落盘（首行失败一律 severity=history，不在本用例的判定面内）。
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "session_title", "title": "基线"}));
        assert_eq!(persistence_of(&session)["state"], serde_json::json!("ok"));

        sink.fail_clean();
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "session_title", "title": "失败"}));
        let failed = persistence_of(&session);
        assert_eq!(failed["state"], serde_json::json!("degraded"));
        assert_eq!(failed["severity"], serde_json::json!("annotation"));
        assert_eq!(
            failed["history_gap"]["present"],
            serde_json::json!(false),
            "annotation 干净失败 MUST NOT 置历史缺口：{failed}"
        );
        assert_eq!(failed["history_written"], serde_json::json!(false));
        assert!(failed["since_ts"].as_u64().unwrap() > 0);

        sink.heal();
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "approval", "decision": "approved"}));
        let recovered = persistence_of(&session);
        assert_eq!(recovered["state"], serde_json::json!("ok"));
        assert_eq!(recovered["severity"], serde_json::Value::Null);
        assert_eq!(recovered["since_ts"], serde_json::json!(0));
        assert_eq!(recovered["detail"], serde_json::json!(""));
        assert_eq!(
            recovered["history_gap"]["present"],
            serde_json::json!(false)
        );
        assert_eq!(recovered["history_written"], serde_json::json!(false));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// R2：`llm_request` 失败 → `degraded(history)` + gap；成功 → `state=ok` 但 gap 仍在；
    /// 恢复事件（state=ok + gap true）必须发出。
    #[test]
    fn r2_history_failure_latches_gap_across_recovery() {
        let dir = tmpdir("health-r2");
        let sink = ScriptedSink::default();
        let (seen, reporter) = collect_reporter();
        let mut session = test_session(writer_with(&dir, "r2", &sink, reporter));
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "session_title", "title": "基线"}));
        seen.lock().unwrap().clear();

        sink.fail_clean();
        session.jsonl().record(&serde_json::json!({
            "kind": "llm_request",
            "request": {"messages": [{"role": "user", "content": "心跳"}]},
        }));
        flush_transitions(&mut session);
        let failed = persistence_of(&session);
        assert_eq!(failed["state"], serde_json::json!("degraded"));
        assert_eq!(failed["severity"], serde_json::json!("history"));
        assert_eq!(failed["history_gap"]["present"], serde_json::json!(true));
        assert!(failed["history_gap"]["since_ts"].as_u64().unwrap() > 0);
        assert_eq!(failed["history_written"], serde_json::json!(false));

        sink.heal();
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "llm_request", "request": {"messages": []}}));
        flush_transitions(&mut session);
        let recovered = persistence_of(&session);
        assert_eq!(recovered["state"], serde_json::json!("ok"));
        assert_eq!(recovered["severity"], serde_json::Value::Null);
        assert_eq!(
            recovered["history_gap"]["present"],
            serde_json::json!(true),
            "成功追加 MUST NOT 清除历史缺口：{recovered}"
        );
        assert_eq!(recovered["history_written"], serde_json::json!(true));

        // 事件面：最后一次跃迁必须是「写入恢复、缺口仍在」的完整载荷。
        let events = seen.lock().unwrap();
        let last = events.last().expect("恢复跃迁必须发事件").clone();
        assert_eq!(last.state, PersistenceState::Ok);
        assert!(last.history_gap.present);
        assert!(last.history_written);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// R5：severity / gap 触发表——annotation 不降级 history；部分写一律 history + gap。
    #[test]
    fn r5_severity_table_and_partial_write_latch() {
        let dir = tmpdir("health-r5");
        let sink = ScriptedSink::default();
        let mut session = test_session(writer_with(&dir, "r5", &sink, None));
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "session_title", "title": "基线"}));

        // ① session_title 干净失败 = annotation / 无缺口。
        sink.fail_clean();
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "session_title", "title": "x"}));
        let step1 = persistence_of(&session);
        assert_eq!(step1["severity"], serde_json::json!("annotation"));
        assert_eq!(step1["history_gap"]["present"], serde_json::json!(false));

        // ② llm_request 干净失败 = history / 缺口。
        sink.heal();
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "session_title", "title": "恢复"}));
        sink.fail_clean();
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "llm_request", "request": {}}));
        let step2 = persistence_of(&session);
        assert_eq!(step2["severity"], serde_json::json!("history"));
        assert_eq!(step2["history_gap"]["present"], serde_json::json!(true));

        // ③ approval 部分写 = history（severity 不降）/ 缺口保持。
        sink.heal();
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "llm_response", "text": "恢复"}));
        sink.fail_partial(8);
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "approval", "decision": "approved"}));
        let step3 = persistence_of(&session);
        assert_eq!(step3["state"], serde_json::json!("degraded"));
        assert_eq!(step3["severity"], serde_json::json!("history"));
        assert_eq!(step3["history_gap"]["present"], serde_json::json!(true));

        // ④ 仍在 degraded(history) 段内时，annotation 干净失败不降级 severity。
        //（成功会把 state 收回 ok——那是新的一段 degraded，不属于本条判据。）
        sink.fail_clean();
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "session_title", "title": "y"}));
        let step4 = persistence_of(&session);
        assert_eq!(
            step4["severity"],
            serde_json::json!("history"),
            "annotation 失败 MUST NOT 降低已有的 history：{step4}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// R6a：首行干净失败 + `llm_request` payload——挂起行保留、重试成功后首行是 `session_open`，
    /// 但本次请求永久缺失（MUST NOT 被后续成功补回），gap=true、history_written 仍为 false。
    #[test]
    fn r6a_first_line_failure_with_history_payload_keeps_pending_and_latches_gap() {
        let dir = tmpdir("health-r6a");
        let sink = ScriptedSink::default();
        let mut session = test_session(writer_with(&dir, "r6a", &sink, None));
        sink.fail_clean();
        session.jsonl().record(&serde_json::json!({
            "kind": "llm_request",
            "request": {"messages": [{"role": "user", "content": "R6A-LOST-REQUEST"}]},
        }));
        assert!(
            sink.lines().is_empty(),
            "首次调用应干净失败（未写入任何字节）"
        );
        let failed = persistence_of(&session);
        assert_eq!(failed["state"], serde_json::json!("degraded"));
        assert_eq!(failed["severity"], serde_json::json!("history"));
        assert_eq!(failed["history_gap"]["present"], serde_json::json!(true));
        assert_eq!(failed["history_written"], serde_json::json!(false));

        // 恢复可写后写下一条记录：首行必须仍是 session_open（挂起行没丢）。
        sink.heal();
        session.jsonl().record(&serde_json::json!({
            "kind": "llm_response",
            "text": "R6A-RESPONSE",
        }));
        let lines = sink.lines();
        assert_eq!(lines.len(), 2, "应只有 session_open + 本次响应：{lines:?}");
        let first: serde_json::Value = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(
            first["payload"]["kind"], "session_open",
            "首行必须是 session_open（挂起行 MUST NOT 丢失）：{lines:?}"
        );
        assert!(
            !lines.iter().any(|line| line.contains("R6A-LOST-REQUEST")),
            "失败的那条请求 MUST NOT 被后续成功补回：{lines:?}"
        );
        let recovered = persistence_of(&session);
        assert_eq!(recovered["state"], serde_json::json!("ok"));
        assert_eq!(recovered["history_gap"]["present"], serde_json::json!(true));
        assert_eq!(recovered["history_written"], serde_json::json!(true));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// R6b：首行干净失败 + annotation payload——挂起行保留，但 annotation 丢失不 latch；
    /// 重试成功后 `state=ok`、gap=false。
    #[test]
    fn r6b_first_line_failure_with_annotation_payload_does_not_latch_gap() {
        let dir = tmpdir("health-r6b");
        let sink = ScriptedSink::default();
        let mut session = test_session(writer_with(&dir, "r6b", &sink, None));
        sink.fail_clean();
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "session_title", "title": "R6B-LOST-TITLE"}));
        let failed = persistence_of(&session);
        assert_eq!(failed["state"], serde_json::json!("degraded"));
        assert_eq!(
            failed["severity"],
            serde_json::json!("history"),
            "首行失败一律 severity=history"
        );
        assert_eq!(
            failed["history_gap"]["present"],
            serde_json::json!(false),
            "annotation 丢失不 latch"
        );

        sink.heal();
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "session_title", "title": "R6B-NEXT"}));
        let lines = sink.lines();
        assert_eq!(lines.len(), 2);
        let first: serde_json::Value = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(first["payload"]["kind"], "session_open");
        assert!(!lines.iter().any(|line| line.contains("R6B-LOST-TITLE")));
        let recovered = persistence_of(&session);
        assert_eq!(recovered["state"], serde_json::json!("ok"));
        assert_eq!(
            recovered["history_gap"]["present"],
            serde_json::json!(false)
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// R7：前缀写入后报错——`degraded(history)` + gap；后续成功 MUST NOT 清缺口，
    /// 系统 MUST NOT 声称文件可恢复（健康读数只有「可能损坏」这一档，没有恢复承诺字段）。
    #[test]
    fn r7_partial_write_latches_gap_and_never_clears_it() {
        let dir = tmpdir("health-r7");
        let sink = ScriptedSink::default();
        let mut session = test_session(writer_with(&dir, "r7", &sink, None));
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "session_title", "title": "基线"}));

        sink.fail_partial(8);
        session.jsonl().record(&serde_json::json!({
            "kind": "llm_request",
            "request": {"messages": [{"role": "user", "content": "部分写"}]},
        }));
        let failed = persistence_of(&session);
        assert_eq!(failed["state"], serde_json::json!("degraded"));
        assert_eq!(failed["severity"], serde_json::json!("history"));
        assert_eq!(failed["history_gap"]["present"], serde_json::json!(true));

        sink.heal();
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "llm_request", "request": {}}));
        let recovered = persistence_of(&session);
        assert_eq!(recovered["state"], serde_json::json!("ok"));
        assert_eq!(
            recovered["history_gap"]["present"],
            serde_json::json!(true),
            "部分写之后的任何成功都不得清缺口：{recovered}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// R3（session 层）：缺口随 `Session::rotate` 沿用；新文件首次成功只把当前写健康转 ok。
    #[test]
    fn r3_rotate_carries_gap_and_history_written() {
        let dir = tmpdir("health-r3");
        let sink = ScriptedSink::default();
        let mut session = test_session(writer_with(&dir, "r3-old", &sink, None));
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "session_title", "title": "基线"}));
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "llm_response", "text": "基线响应"}));
        assert_eq!(
            persistence_of(&session)["history_written"],
            serde_json::json!(true)
        );

        sink.fail_clean();
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "llm_request", "request": {}}));
        assert_eq!(
            persistence_of(&session)["history_gap"]["present"],
            serde_json::json!(true)
        );

        let token_before = session.subagent_token();
        assert!(token_before > 0);
        let new_sink = ScriptedSink::default();
        let new_writer = writer_with(&dir, "r3-new", &new_sink, None);
        session.rotate("sys2".into(), new_writer);
        // 自动压缩是同一逻辑会话换文件：逻辑会话 token（事件准入身份）沿用。
        assert_eq!(
            serde_json::to_value(session.snapshot(85.0, true)).unwrap()["session_token"],
            serde_json::json!(token_before)
        );
        let carried = persistence_of(&session);
        assert_eq!(
            carried["state"],
            serde_json::json!("degraded"),
            "换文件前当前写健康应沿用：{carried}"
        );
        assert_eq!(carried["history_gap"]["present"], serde_json::json!(true));
        assert_eq!(carried["history_written"], serde_json::json!(true));

        session
            .jsonl()
            .record(&serde_json::json!({"kind": "llm_request", "request": {}}));
        let after = persistence_of(&session);
        assert_eq!(after["state"], serde_json::json!("ok"));
        assert_eq!(
            after["history_gap"]["present"],
            serde_json::json!(true),
            "新文件首次成功 MUST NOT 洗白缺口：{after}"
        );
        assert_eq!(after["history_written"], serde_json::json!(true));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// R10：`history_written` 只在首条 history 记录成功时转 true；annotation 成功不算；
    /// 同一逻辑会话内不回落；新逻辑会话（新句柄）从 false 起算。
    #[test]
    fn r10_history_written_transitions() {
        let dir = tmpdir("health-r10");
        let sink = ScriptedSink::default();
        let (seen, reporter) = collect_reporter();
        let mut session = test_session(writer_with(&dir, "r10", &sink, reporter));
        assert_eq!(
            persistence_of(&session)["history_written"],
            serde_json::json!(false)
        );
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "session_title", "title": "不算"}));
        assert_eq!(
            persistence_of(&session)["history_written"],
            serde_json::json!(false),
            "annotation 成功不得把 history_written 置 true"
        );
        assert!(seen.lock().unwrap().is_empty(), "无跃迁不发事件");

        session
            .jsonl()
            .record(&serde_json::json!({"kind": "llm_response", "text": "算"}));
        flush_transitions(&mut session);
        assert_eq!(
            persistence_of(&session)["history_written"],
            serde_json::json!(true)
        );
        assert!(
            seen.lock()
                .unwrap()
                .iter()
                .any(|health| health.history_written),
            "history_written false→true 必须发事件"
        );

        session
            .jsonl()
            .record(&serde_json::json!({"kind": "llm_response", "text": "再来"}));
        assert_eq!(
            persistence_of(&session)["history_written"],
            serde_json::json!(true),
            "同一逻辑会话内不回落"
        );

        // 新逻辑会话 = 新句柄（新健康）：从 false 起算。
        let fresh = test_session(writer_with(
            &dir,
            "r10-fresh",
            &ScriptedSink::default(),
            None,
        ));
        assert_eq!(
            persistence_of(&fresh)["history_written"],
            serde_json::json!(false)
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// R7b（评审「测试真实性」）：首行部分写——故障 sink **真实保留前缀字节**，随后重试挂起行
    /// 会接在前缀之后，产出一行两个 JSON 对象的坏行；系统 MUST NOT 声称文件可恢复，gap latch。
    #[test]
    fn r7b_partial_first_line_preserves_prefix_and_retries_pending_open() {
        let dir = tmpdir("health-r7b");
        let sink = ScriptedSink::default();
        let mut session = test_session(writer_with(&dir, "r7b", &sink, None));
        sink.fail_partial(10);
        session.jsonl().record(&serde_json::json!({
            "kind": "llm_request",
            "request": {"messages": [{"role": "user", "content": "R7B-LOST-REQUEST"}]},
        }));
        let prefix = sink.raw();
        assert!(!prefix.is_empty(), "故障 sink 必须真实写入前缀字节");
        assert!(
            !prefix.contains(&b'\n'),
            "部分写不应包含行尾（首行尚未写完）：{prefix:?}"
        );
        assert_eq!(
            persistence_of(&session)["history_gap"]["present"],
            serde_json::json!(true)
        );

        sink.heal();
        session
            .jsonl()
            .record(&serde_json::json!({"kind": "llm_response", "text": "R7B-NEXT"}));
        let raw = sink.raw();
        assert!(raw.starts_with(&prefix), "重试必须接在已写前缀之后");
        let text = String::from_utf8_lossy(&raw);
        let first_line = text.split('\n').next().unwrap_or("");
        assert!(
            first_line.matches("\"payload\"").count() >= 2,
            "前缀 + 重试的 session_open 必须在同一行（坏行形态）：{first_line}"
        );
        assert!(
            serde_json::from_str::<serde_json::Value>(first_line).is_err(),
            "部分写之后的首行不是合法 JSON（MUST NOT 声称可恢复）：{first_line}"
        );
        assert!(
            text.contains("session_open"),
            "挂起行仍必须被重试写出：{text}"
        );
        assert!(
            !text.contains("R7B-LOST-REQUEST"),
            "首行失败连带丢弃的 history payload MUST NOT 被补回：{text}"
        );
        let recovered = persistence_of(&session);
        assert_eq!(recovered["state"], serde_json::json!("ok"));
        assert_eq!(recovered["history_gap"]["present"], serde_json::json!(true));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 复审 P1：同一队列只能有一个 drain 发送者，且必须持续 drain 到空——否则旧快照可能
    /// 在两个线程的 take/emit 交错中最后到达。阻塞 reporter 让「A 已取出、尚未发送」的窗口
    /// 确定出现；B 的 flush 必须不抢先发送，A 恢复后按队列顺序发 A、B。
    #[test]
    fn transition_flush_is_single_drainer_and_preserves_order() {
        use std::sync::Barrier;

        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let reporter_seen = seen.clone();
        let reporter_entered = entered.clone();
        let reporter_release = release.clone();
        let reporter: PersistenceReporter = Arc::new(move |health: &PersistenceHealth| {
            if health.detail == "A" {
                reporter_entered.wait();
                reporter_release.wait();
            }
            reporter_seen.lock().unwrap().push(health.detail.clone());
        });
        let transitions = PersistenceTransitions::with(Some(reporter));
        let a = PersistenceHealth {
            detail: "A".into(),
            ..Default::default()
        };
        let b = PersistenceHealth {
            detail: "B".into(),
            ..Default::default()
        };

        transitions.push(&a);
        let first = {
            let queue = transitions.clone();
            std::thread::spawn(move || queue.flush())
        };
        entered.wait(); // A 已进入 reporter，但尚未记录 / 返回
        transitions.push(&b);
        let second = {
            let queue = transitions.clone();
            std::thread::spawn(move || queue.flush())
        };
        second.join().unwrap(); // 第二个 flush 不得成为第二个 drainer
        release.wait(); // 放行 A
        first.join().unwrap();

        assert_eq!(
            *seen.lock().unwrap(),
            vec!["A".to_string(), "B".to_string()],
            "事件发送顺序必须与跃迁入队顺序一致（旧 A 不得晚于新 B 发出）"
        );
    }

    /// 复审终审 P1：reporter 瞬时 panic 后，已取出的跃迁不能丢；同一次 flush 必须重试并按
    /// 原顺序交付，无需新的自然写触发。
    #[test]
    fn transition_flush_recovers_transient_reporter_panic_without_new_flush() {
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let attempts = Arc::new(Mutex::new(0usize));
        let reporter_seen = seen.clone();
        let reporter_attempts = attempts.clone();
        let reporter: PersistenceReporter = Arc::new(move |health: &PersistenceHealth| {
            if health.detail == "A" {
                let first = {
                    let mut count = reporter_attempts.lock().unwrap_or_else(|e| e.into_inner());
                    *count += 1;
                    *count == 1
                };
                if first {
                    panic!("transient reporter panic");
                }
            }
            reporter_seen
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(health.detail.clone());
        });
        let transitions = PersistenceTransitions::with(Some(reporter));
        let a = PersistenceHealth {
            detail: "A".into(),
            ..Default::default()
        };
        let b = PersistenceHealth {
            detail: "B".into(),
            ..Default::default()
        };
        transitions.push(&a);
        transitions.push(&b);

        transitions.flush();
        assert_eq!(
            *seen.lock().unwrap(),
            vec!["A".to_string(), "B".to_string()],
            "瞬时 panic 后必须在同一次 flush 内重试并保持顺序"
        );
        assert_eq!(*attempts.lock().unwrap(), 2, "A 应被重试一次");

        // 后续正常写入继续按序交付。
        let c = PersistenceHealth {
            detail: "C".into(),
            ..Default::default()
        };
        transitions.push(&c);
        transitions.flush();
        assert_eq!(
            *seen.lock().unwrap(),
            vec!["A".to_string(), "B".to_string(), "C".to_string()]
        );
    }

    /// 复审终审 P1：panic 期间新入队、且其 flush 因已有 drainer 而返回的项，必须由当前
    /// drainer 在 panic 恢复后接管，不得滞留。
    #[test]
    fn transition_flush_recovers_items_enqueued_during_panic() {
        use std::sync::Barrier;

        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let attempts = Arc::new(Mutex::new(0usize));
        let reporter_seen = seen.clone();
        let reporter_entered = entered.clone();
        let reporter_release = release.clone();
        let reporter_attempts = attempts.clone();
        let reporter: PersistenceReporter = Arc::new(move |health: &PersistenceHealth| {
            if health.detail == "A" {
                let first = {
                    let mut count = reporter_attempts.lock().unwrap_or_else(|e| e.into_inner());
                    *count += 1;
                    *count == 1
                };
                if first {
                    reporter_entered.wait();
                    reporter_release.wait();
                    panic!("panic while a newer item is enqueued");
                }
            }
            reporter_seen
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(health.detail.clone());
        });
        let transitions = PersistenceTransitions::with(Some(reporter));
        let a = PersistenceHealth {
            detail: "A".into(),
            ..Default::default()
        };
        let b = PersistenceHealth {
            detail: "B".into(),
            ..Default::default()
        };
        transitions.push(&a);
        let first = {
            let queue = transitions.clone();
            std::thread::spawn(move || queue.flush())
        };
        entered.wait(); // A 在 reporter 中阻塞（尚未 panic）
        transitions.push(&b);
        transitions.flush(); // 已有 drainer：本次调用立即返回
        release.wait(); // 让 A panic，进入恢复路径
        first.join().unwrap();

        assert_eq!(
            *seen.lock().unwrap(),
            vec!["A".to_string(), "B".to_string()],
            "panic 期间入队且 flush 已返回的 B 必须由恢复路径接管"
        );
    }

    /// 复审终审 P1：永久 panic 不得无限重试或递归崩溃；连续失败达到上限后丢弃该条并继续
    /// 后续项，错误留 stderr；之后正常写入仍可交付。
    #[test]
    fn transition_flush_bounds_permanent_reporter_panic_and_keeps_following_items() {
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let attempts = Arc::new(Mutex::new(0usize));
        let reporter_seen = seen.clone();
        let reporter_attempts = attempts.clone();
        let reporter: PersistenceReporter = Arc::new(move |health: &PersistenceHealth| {
            if health.detail == "A" {
                *reporter_attempts.lock().unwrap_or_else(|e| e.into_inner()) += 1;
                panic!("permanent reporter panic");
            }
            reporter_seen
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(health.detail.clone());
        });
        let transitions = PersistenceTransitions::with(Some(reporter));
        let a = PersistenceHealth {
            detail: "A".into(),
            ..Default::default()
        };
        let b = PersistenceHealth {
            detail: "B".into(),
            ..Default::default()
        };
        transitions.push(&a);
        transitions.push(&b);

        transitions.flush();
        let tries = *attempts.lock().unwrap();
        assert!(
            (1..=3).contains(&tries),
            "永久 panic 必须有界重试（实际 {tries} 次）"
        );
        assert_eq!(
            *seen.lock().unwrap(),
            vec!["B".to_string()],
            "毒项丢弃后，后续项必须继续交付"
        );

        let c = PersistenceHealth {
            detail: "C".into(),
            ..Default::default()
        };
        transitions.push(&c);
        transitions.flush();
        assert_eq!(
            *seen.lock().unwrap(),
            vec!["B".to_string(), "C".to_string()]
        );
    }
}
