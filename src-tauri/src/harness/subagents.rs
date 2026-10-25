//! 子运行引擎与调度中枢（change add-harness-subagents design §3 / §4 / §7 / §12）。
//!
//! 一次子运行 = 一段 [`RunSpec`] 意义上的运行：本地 `Session`（不插入 `Runtime.sessions`、
//! 不碰父会话 busy 锁）+ [`ChildContext`]（工具白名单、三重闸、批准透传）+ 唯一的工具循环
//! [`super::turn::run_turn_core_with_mode`]。每条 run 一条线程（`lumir-subagent-<run_id>`）。
//!
//! **中枢的生命周期挂在父会话上**：保留表（resume 前提）、会话级并发许可、自动唤醒调度、
//! 每回合次数闸都在 [`SubagentHub`] 里；中枢由 `Session` 持有（`session.rs`），会话对象被
//! 丢弃（新会话 / 恢复 / 切 vault / 退出）即整块收口——后台 run 在下一检查点读到会话令牌
//! 变化，收敛为 `Aborted`。
//!
//! **上下文隔离**：子运行的过程事件经 [`ChildSink`] 只转成面板可见面事件（`subagent_*`），
//! MUST NOT 进入父会话 transcript 或父会话 LLM 历史；父会话只拿 `task` 工具结果与后台完成
//! 通知（design §10 / §12.2）。
//!
//! 模块在 `harness.rs` 的 mod 表注册，对外路径是 `harness::subagents`。

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::commands::CommandError;
use crate::config::HarnessConfig;
use crate::fs_io::IgnorePolicy;

use super::agents::{AgentCatalog, AgentDefinition};
use super::approval::{ApprovalRequest, ApprovalSignal, ApprovalSource};
use super::events::{self, EventSink};
use super::jsonl::{self, JsonlWriter};
use super::llm::{self, Usage};
use super::permission_cache;
use super::permissions;
use super::run::{ApprovalOutcome, BudgetVerdict, RunContext, StopReason, UsageDelta};
use super::scheduler::{
    self, AutoWakeSnapshot, ConcurrencyGate, ConcurrencyPermit, RequestPriority,
    AUTO_WAKE_CHAIN_MAX, AUTO_WAKE_COALESCE_MS,
};
use super::session::{self, PanelMessage, Session};
use super::thinking::ThinkingEffort;
use super::tools::{self, ToolOutput};
use super::{Runtime, VaultScope};

/// 每父会话最多保留的子运行数（design §5.3；常量，不做配置项）。
pub const MAX_RETAINED_RUNS: usize = 4;

/// 后台完成通知的固定前缀 / 收尾（design §12.6.2 的回合输入形状）。
pub const AUTO_NOTICE_PREFIX: &str = "以下是后台任务的完成通知，不是用户发言。";
pub const AUTO_NOTICE_SUFFIX: &str = "请简要说明结果与建议的下一步。";
/// 通知消息的机器可识别标记（落在 user 消息正文末尾）：恢复时据此判「该批通知是否已被
/// 模型消费」。标记在文本里而不是消息项的额外字段——provider 对 input item 的未知字段
/// 宽容度不保证，文本标记是唯一不会把整条请求打成 400 的载体。
pub const AUTO_NOTICE_MARKER: &str = "[lumir:auto_notice";

/// 子运行中枢（父会话持有；见模块头）。
pub struct SubagentHub {
    inner: Arc<HubInner>,
}

struct HubInner {
    /// **弱引用**（评审 r1 P1-1）：中枢挂在 Session 上、Session 又在 Runtime 里；持强
    /// `Runtime` 会把 `RuntimeInner → sessions → Session → hub → RuntimeInner` 闭成环，
    /// cron 的独立运行实例每次都无法回收。运行实例结束后 upgrade 失败，唤醒与收尾停摆。
    runtime: crate::harness::WeakRuntime,
    scope: VaultScope,
    /// 建中枢时的父会话令牌（诊断用；子运行各自保存自己的启动令牌）。
    parent_token: u64,
    config: Mutex<HarnessConfig>,
    /// 父会话的事件出口（每个回合由 `SessionContext` 刷新）。
    sink: Mutex<Option<Arc<dyn EventSink>>>,
    concurrency: ConcurrencyGate,
    registry: Mutex<Registry>,
    runs: Mutex<HashMap<String, ActiveRun>>,
    wake: Mutex<WakeState>,
    wake_tx: Mutex<Option<Sender<WakeEvent>>>,
    /// 本回合起的 run 的停止标志（父回合停止 = 广播；新回合清空）。
    turn_runs: Mutex<Vec<Arc<AtomicBool>>>,
    /// 本回合已实际执行的段数（`max_subruns_per_turn` 的次数闸）。
    turn_segments: AtomicU32,
    /// mock 脚本区间的分配器（design §18；真 provider 不消费）。
    mock: Mutex<MockArena>,
    approval_seq: AtomicU64,
    run_seq: AtomicU64,
    batch_seq: AtomicU64,

    closed: AtomicBool,
}

/// 保留表 / 活动表（resume 的前提，design §5.3 / §9.3）。
#[derive(Default)]
struct Registry {
    retained: HashMap<String, RetainedRun>,
    /// 最久未用在前（只在已收敛的 run 里淘汰）。
    lru: VecDeque<String>,
    active: HashSet<String>,
}

struct RetainedRun {
    session: Session,
    agent: String,
    model: String,
    segment: u32,
    mock_cursor: usize,
}

struct ActiveRun {
    #[allow(dead_code)]
    agent: String,
    #[allow(dead_code)]
    description: String,
    #[allow(dead_code)]
    model: String,
    #[allow(dead_code)]
    segment: u32,
    abort: Arc<AtomicBool>,
}

/// 自动唤醒状态（design §12.6.2：`pending` 批次 / `running` / `chain`）。
#[derive(Default)]
struct WakeState {
    chain: u32,
    blocked: Option<&'static str>,
    /// 自动回合在飞。
    running: bool,
    /// 已收敛、尚未被某个回合消费的通知。**链触顶 / 停止时不清空**（design §12.6.3
    /// 「`pending` 保留」）——「继续」要据此起回合；只有回合真正起成 / 用户回合并入后才消费。
    pending: Vec<NoticeRun>,
    /// `pending` 里已经写进父会话历史（上屏）的 run id：链触顶时先上屏但保留 pending，
    /// 「继续」或用户回合不得把同一条通知再插一次（「同一语义两处真源」的反面：历史里
    /// 只能有一份）。
    delivered: HashSet<String>,
    /// 当前批次 id（pending 为空时下一次入队重新铸）。
    batch: Option<String>,
    /// 空闲合并窗口的截止时刻（从首条通知起算、不因新通知顺延）。
    deadline: Option<Instant>,
    /// 空闲监视线程是否已在跑。
    idle_watch: bool,
    /// 面板「继续」：跳过合并窗口、立即按 pending 起回合（design §12.6.3）。
    force: bool,
}

#[derive(Clone)]
struct NoticeRun {
    run_id: String,
    agent: String,
    description: String,
    status: String,
    stopped_by: Option<String>,
    summary: String,
}

impl NoticeRun {
    fn status_line(&self) -> String {
        match &self.stopped_by {
            Some(reason) => format!("{}（{reason}）", self.status),
            None => self.status.clone(),
        }
    }
}

/// 投递 / 唤醒事件（调度线程的唯一输入面）。
enum WakeEvent {
    RunFinished,
    ParentIdle,
    AutoTurnEnded,
    Continue,
    Shutdown,
}

/// mock 脚本区间分配器（design §18）：父回合开始时记录基准与已弹条数，每个子运行领一段
/// 连续区间；父会话游标回写 = 父已弹 + 预分配总量。
#[derive(Default)]
struct MockArena {
    base: usize,
    parent_consumed: usize,
    reserved: usize,
}

impl SubagentHub {
    pub fn new(
        runtime: Runtime,
        scope: VaultScope,
        config: HarnessConfig,
        parent_token: u64,
    ) -> Self {
        let limit = config.subagents.max_concurrent;
        Self {
            inner: Arc::new(HubInner {
                runtime: runtime.downgrade(),
                scope,
                parent_token,
                config: Mutex::new(config),
                sink: Mutex::new(None),
                concurrency: ConcurrencyGate::new(limit),
                registry: Mutex::new(Registry::default()),
                runs: Mutex::new(HashMap::new()),
                wake: Mutex::new(WakeState::default()),
                wake_tx: Mutex::new(None),
                turn_runs: Mutex::new(Vec::new()),
                turn_segments: AtomicU32::new(0),
                mock: Mutex::new(MockArena::default()),
                approval_seq: AtomicU64::new(0),
                run_seq: AtomicU64::new(0),
                batch_seq: AtomicU64::new(0),
                closed: AtomicBool::new(false),
            }),
        }
    }

    /// 每回合同步父会话的事件出口与配置快照（`SessionContext::new` 调用）。
    ///
    /// 出口在这里统一包一层 [`DiagnosticSink`]（change add-harness-subagents tasks §7.1/§7.2）：
    /// 中枢自己发的（`hub.emit`）与子运行直发的（`ChildContext::parent_sink`）都取
    /// `inner.sink`，因此在**唯一的装配点**上挂诊断转发，七类 `subagent_*` 事件恰好落一条
    /// 诊断日志——完成 / 失败 / 中止 / 后台路径共用同一出口，业务分支里 MUST NOT 各写一遍。
    ///
    /// **幂等**：自动回合的 owned sink 取的就是本方导出（`turn::run_auto_turn_acquired` 拿
    /// `process_wake` 从 `inner.sink` 克隆的出口再传回来），无条件再包一层会让第 i 个自动回合
    /// 的事件经过 i 层 `DiagnosticSink`、每层各写一条诊断日志（M601 真机 203 现场：run_i 的
    /// 每条 `subagent_*` 行出现 i 次）。同一个出口只包一层；用户回合每轮给的是新构造的裸
    /// sink，指针不同照常替换。
    pub fn set_sink(&self, sink: Option<Arc<dyn EventSink>>) {
        let mut current = self.inner.sink.lock().unwrap_or_else(|e| e.into_inner());
        let unchanged = match (current.as_ref(), sink.as_ref()) {
            (Some(wrapped), Some(next)) => Arc::ptr_eq(wrapped, next),
            (None, None) => true,
            _ => false,
        };
        if unchanged {
            return;
        }
        *current = sink.map(|sink| Arc::new(DiagnosticSink(sink)) as Arc<dyn EventSink>);
    }

    pub fn set_config(&self, config: &HarnessConfig) {
        *self.inner.config.lock().unwrap_or_else(|e| e.into_inner()) = config.clone();
        self.inner
            .concurrency
            .set_limit(config.subagents.max_concurrent);
    }

    fn config(&self) -> HarnessConfig {
        self.inner
            .config
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    fn emit(&self, payload: serde_json::Value) {
        // 先克隆出口、释放锁再 emit：sink 实现若反过来触碰中枢（不排除），持锁 emit 会自锁。
        let sink = self
            .inner
            .sink
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if let Some(sink) = sink {
            sink.emit(payload);
        }
    }

    /// **无段终态**的唯一产出点（tasks §7.2）：线程启动失败与段前失败共用这一条
    /// `subagent_finished`（`status=failed`，没有轮次 / 用量 / 摘要）。段真正跑起来之后
    /// 的终态由 `ChildContext::finish`（段收尾）产出——两处之外 MUST NOT 再构造完成事件，
    /// 单测 `subagent_diagnostics_have_a_single_production_point` 扫源码钉住。
    #[allow(clippy::too_many_arguments)]
    fn emit_failed_terminal(
        &self,
        run_id: &str,
        segment: u32,
        agent: &str,
        model: &str,
        duration_ms: u64,
        audit: Option<&str>,
        audit_error: Option<&str>,
    ) {
        self.emit(events::subagent_finished(
            run_id,
            segment,
            agent,
            "failed",
            None,
            0,
            model,
            0,
            0,
            0,
            0,
            duration_ms,
            0,
            audit,
            audit_error,
        ));
    }

    fn next_approval_id(&self) -> String {
        format!(
            "apr-{}",
            self.inner.approval_seq.fetch_add(1, Ordering::SeqCst)
        )
    }

    /// 自动唤醒状态快照（`harness_state.auto_wake`）。
    pub fn wake_snapshot(&self) -> AutoWakeSnapshot {
        let wake = self.inner.wake.lock().unwrap_or_else(|e| e.into_inner());
        AutoWakeSnapshot {
            chain: wake.chain,
            max: AUTO_WAKE_CHAIN_MAX,
            blocked: wake.blocked,
        }
    }

    /// 会话对象被丢弃时的收口：中止所有在跑的 run、清空保留表与唤醒调度。
    pub fn shutdown(&self) {
        self.inner.closed.store(true, Ordering::SeqCst);
        {
            let runs = self.inner.runs.lock().unwrap_or_else(|e| e.into_inner());
            for run in runs.values() {
                run.abort.store(true, Ordering::SeqCst);
            }
        }
        {
            let mut registry = self
                .inner
                .registry
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            registry.retained.clear();
            registry.lru.clear();
            registry.active.clear();
        }
        let tx = self
            .inner
            .wake_tx
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(tx) = tx {
            let _ = tx.send(WakeEvent::Shutdown);
        }
    }

    /// 父回合停止时广播中止（design §12.4）：只中止**本回合起的** run。
    pub(crate) fn broadcast_abort(&self) {
        for flag in self
            .inner
            .turn_runs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
        {
            flag.store(true, Ordering::SeqCst);
        }
        // 先读会话（会取 sessions 锁）再取唤醒锁：锁序固定为 sessions → wake，反过来会在
        // 「会话重置持 sessions 锁 → Drop → shutdown 取 wake 锁」时与调度线程互相等待。
        let stopped_by_user = walk_stopped_by_user(&self.inner);
        let mut wake = self.inner.wake.lock().unwrap_or_else(|e| e.into_inner());
        // 停止的是自动回合 ⇒ 视同触顶（design §12.6.3），避免下一条通知立刻推翻「停止」。
        if wake.running && stopped_by_user {
            wake.blocked = Some("stopped");
        }
    }

    /// 用户回合开始（`SessionContext::begin_user_turn`）：把排队通知并入本回合输入、
    /// 取消待起唤醒、清零链计数与次数闸。
    pub(crate) fn begin_user_turn(&self) -> Option<NoticeInsert> {
        self.reset_turn_accounting();
        let (notices, delivered, batch) = {
            let mut wake = self.inner.wake.lock().unwrap_or_else(|e| e.into_inner());
            wake.chain = 0;
            wake.blocked = None;
            wake.deadline = None;
            wake.idle_watch = false;
            wake.force = false;
            if wake.pending.is_empty() {
                // 起回合的在飞批次已把 pending 取走（尚未提交）：不动它的 delivered /
                // batch，否则该批判重信息会在提交前被清掉（并发窗口，评审 r2 P1-1 同族）。
                (Vec::new(), HashSet::new(), None)
            } else {
                let notices = std::mem::take(&mut wake.pending);
                // 只取走**本批 pending 对应 run** 的投递标记（评审 r3 P2-1 窗口 B）：
                // 在飞批次（已被 process_wake 取走、尚未提交）的标记留在 wake，等它
                // 成功消费或失败放回。
                let taken: HashSet<String> =
                    notices.iter().map(|notice| notice.run_id.clone()).collect();
                let mut delivered = HashSet::new();
                wake.delivered.retain(|run_id| {
                    if taken.contains(run_id) {
                        delivered.insert(run_id.clone());
                        false
                    } else {
                        true
                    }
                });
                (notices, delivered, wake.batch.take())
            }
        };
        if notices.is_empty() {
            return None;
        }
        // 去重：链触顶时通知已经上屏（`delivered`），用户回合不得把它再插一遍。
        let undelivered: Vec<NoticeRun> = notices
            .into_iter()
            .filter(|notice| !delivered.contains(&notice.run_id))
            .collect();
        if undelivered.is_empty() {
            return None;
        }
        let batch_id = batch.unwrap_or_else(|| self.new_batch_id());
        let text = notice_text(&undelivered, &batch_id);
        emit_notice_event(&self.inner, &undelivered, &batch_id);
        // 通知的「最终处理」事件：并入用户回合（design §12.6.3 的 `user_turn`）。
        for notice in &undelivered {
            self.emit(events::subagent_notified(
                &notice.run_id,
                &notice.agent,
                &notice.status,
                "user_turn",
                &batch_id,
                0,
            ));
        }
        Some(NoticeInsert { text, batch_id })
    }

    fn reset_turn_accounting(&self) {
        self.inner.turn_segments.store(0, Ordering::SeqCst);
        self.inner
            .turn_runs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }

    fn new_batch_id(&self) -> String {
        format!(
            "wb-{}",
            self.inner.batch_seq.fetch_add(1, Ordering::SeqCst) + 1
        )
    }

    /// mock 游标进度（见 [`RunContext::note_mock_progress`] 的语义）。
    pub(crate) fn note_mock_progress(
        &self,
        base: usize,
        parent_consumed: usize,
        _region_span: usize,
        _script_len: Option<usize>,
    ) {
        let mut arena = self.inner.mock.lock().unwrap_or_else(|e| e.into_inner());
        if arena.base != base {
            // 会话游标变了（新一轮）⇒ 新回合重新起算。
            arena.base = base;
            arena.parent_consumed = 0;
            arena.reserved = 0;
        }
        arena.parent_consumed = parent_consumed;
    }

    fn reserve_mock_region(&self, span: usize, resume_cursor: Option<usize>) -> (usize, bool) {
        let mut arena = self.inner.mock.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(cursor) = resume_cursor {
            // resume 段沿用保留 run 的游标（design §18 末段），不新占区间。
            return (cursor, false);
        }
        let start = arena.base + arena.parent_consumed + arena.reserved;
        arena.reserved += span.max(1);
        (start, true)
    }

    pub(crate) fn external_mock_consumed(&self) -> usize {
        self.inner
            .mock
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .reserved
    }

    fn parent_busy(&self) -> bool {
        self.inner
            .runtime
            .with_session(&self.inner.scope, |session| session.is_busy())
            .unwrap_or(false)
    }

    /// 面板停止单个 run（design §12.4；命令层接线归后续批次，本函数是唯一实现体）。
    /// 返回是否找到该 run。
    pub fn stop_run(&self, run_id: &str) -> bool {
        let found = {
            let runs = self.inner.runs.lock().unwrap_or_else(|e| e.into_inner());
            match runs.get(run_id) {
                Some(run) => {
                    run.abort.store(true, Ordering::SeqCst);
                    true
                }
                None => false,
            }
        };
        if found {
            // 该 run 挂起的批准项以 Withdrawn 收回（design §12.4：只影响它自己的卡片）。
            let _ = self
                .inner
                .runtime
                .with_session(&self.inner.scope, |session| {
                    session.withdraw_approvals_of_run(run_id)
                });
        }
        found
    }

    /// 面板「继续」（design §12.6.3）：等价一次用户发言——链清零、blocked 清空；pending
    /// 非空时**立即**按 `TurnInput::Preloaded` 起一个自动回合（触顶期间上屏但保留的 pending
    /// 在这里被消费；已上屏的部分不重复入历史）。
    pub fn continue_wake(&self) {
        let has_pending = {
            let mut wake = self.inner.wake.lock().unwrap_or_else(|e| e.into_inner());
            wake.chain = 0;
            wake.blocked = None;
            wake.force = !wake.pending.is_empty();
            !wake.pending.is_empty()
        };
        if !has_pending {
            // 无待处理通知：只恢复监听。
            return;
        }
        self.ensure_wake_worker();
        if let Some(tx) = self
            .inner
            .wake_tx
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            let _ = tx.send(WakeEvent::Continue);
        }
    }

    /// 保留表里的 run 数（单测与诊断读数）。
    pub fn retained_count(&self) -> usize {
        self.inner
            .registry
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retained
            .len()
    }

    fn ensure_wake_worker(&self) {
        let mut guard = self.inner.wake_tx.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_some() {
            return;
        }
        let (tx, rx) = mpsc::channel();
        *guard = Some(tx);
        drop(guard);
        let hub = self.clone();
        if let Err(error) = std::thread::Builder::new()
            .name("lumir-subagent-wake".into())
            .spawn(move || wake_worker(hub.inner.clone(), rx))
        {
            // 线程起不来：清掉 sender 以便下一次 notify 重试；否则调度永久卡死。
            *self.inner.wake_tx.lock().unwrap_or_else(|e| e.into_inner()) = None;
            crate::logging::config_warning(
                "subagents",
                &format!("唤醒调度线程启动失败（下次事件将重试）：{error}"),
            );
        }
    }

    fn notify_wake(&self, event: WakeEvent) {
        if let Some(tx) = self
            .inner
            .wake_tx
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            let _ = tx.send(event);
        }
    }

    /// 后台 run 收敛后的投递入口（design §12.5）：终态 completed / partial / failed 才投递；
    /// aborted 不投递、不唤醒。
    fn on_background_finished(&self, notice: NoticeRun) {
        if self.inner.closed.load(Ordering::SeqCst) {
            return;
        }
        // design §12.6.1：cron 的无人值守槽位**不参与唤醒与链计数**。这是全路径约束，
        // 不是只在 `begin_user_turn` 一处——否则 cron 回合起的后台 run 会在僵尸 Runtime
        // 上自动起回合、烧真实配额（评审 r1 P1-1 的第二层后果）。
        if self.inner.runtime.is_isolated() {
            return;
        }
        // 批次 id 在**同一把锁里**记下并直接传给投递标记（评审 r3 P2-2）：放锁后二次
        // 加锁重读会被 `begin_user_turn` 抢成孤儿 id——标记的 wake_batch 永远匹配不上
        // 通知最终进入的 llm_request，重启恢复会把已上屏通知当未消费而重建。
        let batch = {
            let mut wake = self.inner.wake.lock().unwrap_or_else(|e| e.into_inner());
            // 没有开放批次时铸新：起回合的取走窗口里 `pending` 为空但批次仍在飞——窗口内
            // 新到的通知必须沿用同一 id（标记与最终 `wake_batch` 一致）。
            if wake.batch.is_none() {
                wake.batch = Some(self.new_batch_id());
            }
            let batch = wake.batch.clone().expect("刚填过");
            wake.pending.push(notice.clone());
            batch
        };
        run_after_notice_push_hook();
        // 投递标记在**收敛入队时**写、早于上屏（design §12.6.4）：通知还在排队 / 合并窗口内、
        // 尚未画到屏幕上时进程退出，也要能据标记 + subrun sidecar 重建显示——标记表达的是
        // 「已接纳投递、尚未被模型消费」，不是「已经上屏」。
        self.write_notice_marker(&notice.run_id, batch);
        self.ensure_wake_worker();
        self.notify_wake(WakeEvent::RunFinished);
    }

    /// 保留一段可续跑的子会话（LRU：上限 [`MAX_RETAINED_RUNS`]，只淘汰已收敛的 run）。
    fn retain_run(&self, run_id: String, run: RetainedRun) {
        let mut registry = self
            .inner
            .registry
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        registry.lru.retain(|id| id != &run_id);
        registry.retained.insert(run_id.clone(), run);
        registry.lru.push_back(run_id);
        while registry.retained.len() > MAX_RETAINED_RUNS {
            let Some(oldest) = registry.lru.pop_front() else {
                break;
            };
            registry.retained.remove(&oldest);
        }
    }

    /// 段收尾的父会话侧记账（design §9.1 / §9.2 的唯一累加点）：按模型分桶 + 一条
    /// `subrun` sidecar。父会话已重建（令牌不符）时静默放弃——旧 run 的读数不属于新会话。
    #[allow(clippy::too_many_arguments)]
    fn record_segment_sidecar(
        &self,
        run_id: &str,
        segment: u32,
        agent: &str,
        description: &str,
        model: &str,
        status: &str,
        stopped_by: Option<&str>,
        rounds: u32,
        denials: u32,
        usage: Usage,
        audit: Option<&str>,
    ) {
        let _ = self
            .inner
            .runtime
            .with_session(&self.inner.scope, |parent| {
                if parent.subagent_token() != self.inner.parent_token {
                    return;
                }
                parent.record_subrun_usage(model, &usage);
                parent.mark_subrun_segment(model);
                parent.jsonl().record(&serde_json::json!({
                    "kind": "subrun",
                    "run_id": run_id,
                    "segment": segment,
                    "agent": agent,
                    "description": description,
                    "model": model,
                    "status": status,
                    "stopped_by": stopped_by,
                    "rounds": rounds,
                    "denied_calls": denials,
                    // 四键与 `llm_response.usage` 同形：`cache_write_tokens` 是恢复重算
                    // `writes` 的唯一来源，缺了它 live 分桶表与恢复重算就不可能相等。
                    "usage": {
                        "input_tokens": usage.input_tokens,
                        "cached_tokens": usage.cached_tokens,
                        "output_tokens": usage.output_tokens,
                        "cache_write_tokens": usage.cache_write_tokens,
                    },
                    "audit": audit,
                }));
            });
    }

    fn write_notice_marker(&self, run_id: &str, batch: String) {
        let _ = self
            .inner
            .runtime
            .with_session(&self.inner.scope, |session| {
                session.jsonl().record(&serde_json::json!({
                    "kind": "notice_delivered",
                    "run_ids": [run_id],
                    "wake_batch": batch,
                    "shown_at": jsonl::unix_secs_now(),
                }));
            });
    }
}

impl Clone for SubagentHub {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

/// 并入用户回合 / 自动回合的通知文本（含机器标记）。
pub(crate) struct NoticeInsert {
    pub(crate) text: String,
    pub(crate) batch_id: String,
}

/// 自动唤醒调度线程（design §12.6）：单一不变量——同一时刻至多一个自动回合在飞、至多
/// 一个待起批次。
fn wake_worker(hub: Arc<HubInner>, rx: Receiver<WakeEvent>) {
    loop {
        let timeout = {
            let wake = hub.wake.lock().unwrap_or_else(|e| e.into_inner());
            if wake.running {
                Duration::from_millis(100)
            } else if let Some(deadline) = wake.deadline {
                deadline
                    .saturating_duration_since(Instant::now())
                    .max(Duration::from_millis(10))
            } else {
                Duration::from_secs(600)
            }
        };
        match rx.recv_timeout(timeout) {
            Ok(WakeEvent::Shutdown) => break,
            Ok(WakeEvent::Continue) => {}
            Ok(WakeEvent::RunFinished)
            | Ok(WakeEvent::ParentIdle)
            | Ok(WakeEvent::AutoTurnEnded) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if hub.closed.load(Ordering::SeqCst) {
            break;
        }
        process_wake(&hub);
    }
}

/// 调度状态机的一步（可重入：事件与超时都走这里）。
fn process_wake(hub: &Arc<HubInner>) {
    let hub_view = SubagentHub { inner: hub.clone() };
    // 会话已拆除（hub 已 shutdown）：不再起回合。
    if hub.closed.load(Ordering::SeqCst) {
        return;
    }
    // design §12.6.1：无人值守槽位不参与唤醒与链计数（全路径短路；见
    // `on_background_finished` 的同一条注释）。
    if hub.runtime.is_isolated() {
        return;
    }
    // 先读会话（sessions 锁）再取唤醒锁：与 `Session::drop → shutdown` 的锁序一致
    // （sessions → wake），不在这条路径上制造反向等待。
    let busy = hub_view.parent_busy();
    let mut wake = hub.wake.lock().unwrap_or_else(|e| e.into_inner());
    if wake.pending.is_empty() {
        wake.deadline = None;
        wake.force = false;
        return;
    }
    // 自动回合在飞：通知排队等该回合结束（这就是链的一环）。
    if wake.running {
        return;
    }
    if busy {
        // 用户回合进行中：等回合结束再合并（设计 §12.6.2）。空闲监视只起一个。
        if !wake.idle_watch {
            wake.idle_watch = true;
            drop(wake);
            spawn_idle_watcher(hub.clone());
        }
        return;
    }
    // 空闲：先等合并窗口（从首条通知起算、不因新通知顺延）；面板「继续」跳过窗口。
    if !wake.force {
        match wake.deadline {
            None => {
                wake.deadline = Some(Instant::now() + Duration::from_millis(AUTO_WAKE_COALESCE_MS));
                return;
            }
            Some(deadline) if Instant::now() < deadline => return,
            Some(_) => {}
        }
    }
    wake.deadline = None;
    wake.force = false;
    // 链闸：触顶不起回合，但通知照常上屏 + 投递标记（标记在收敛时已写）；`pending` 保留
    // （design §12.6.3），`delivered` 只在真实写进历史后标。
    let blocked = wake.blocked;
    if blocked.is_some() || wake.chain >= AUTO_WAKE_CHAIN_MAX {
        let reason = match blocked {
            Some("stopped") => "blocked_stopped",
            Some(_) => "blocked_chain",
            None => {
                wake.blocked = Some("chain_limit");
                "blocked_chain"
            }
        };
        let mut newly: Vec<NoticeRun> = Vec::new();
        for notice in &wake.pending {
            if !wake.delivered.contains(&notice.run_id) {
                newly.push(notice.clone());
            }
        }
        // 先标 delivered 再放锁（评审 r3 P2-1 窗口 A）：insert 期间用户恰好发言时，
        // `begin_user_turn` 会看到这些通知已上屏，不再重复并入用户回合。插入失败（会话
        // 消失）时重新加锁摘除标记——丢失侧仍由「失败即未标」兜住。
        for notice in &newly {
            wake.delivered.insert(notice.run_id.clone());
        }
        let batch = wake.batch.clone().unwrap_or_else(|| {
            let batch = hub_view.new_batch_id();
            wake.batch = Some(batch.clone());
            batch
        });
        drop(wake);
        if newly.is_empty() {
            return;
        }
        run_after_blocked_mark_hook();
        if insert_notices_into_session(hub, &notice_text(&newly, &batch), &batch) {
            emit_notice_event(hub, &newly, &batch);
            for notice in &newly {
                hub_view.emit(events::subagent_notified(
                    &notice.run_id,
                    &notice.agent,
                    &notice.status,
                    reason,
                    &batch,
                    0,
                ));
            }
        } else {
            let mut wake = hub.wake.lock().unwrap_or_else(|e| e.into_inner());
            for notice in &newly {
                wake.delivered.remove(&notice.run_id);
            }
        }
        return;
    }
    // 起回合分支回到 r1 的**原子语义**（评审 r2 P1-1）：锁内把本批通知从 `pending`
    // **取出**，acquire / spawn 失败原样放回；成功即已消费。窗口内新到的通知留在
    // `pending`（不在成功分支清场），等 `AutoTurnEnded` 再驱动。`delivered` 只在真实
    // `insert_notices_into_session` 之后写，不在 acquire 前预标。
    let notices = std::mem::take(&mut wake.pending);
    let batch = wake.batch.clone().unwrap_or_else(|| {
        let batch = hub_view.new_batch_id();
        wake.batch = Some(batch.clone());
        batch
    });
    let undelivered: Vec<NoticeRun> = notices
        .iter()
        .filter(|notice| !wake.delivered.contains(&notice.run_id))
        .cloned()
        .collect();
    drop(wake);

    let Some(runtime) = wake_acquire(hub) else {
        // 抢不到父会话（用户恰好发言）：本批原样放回 pending，未标 delivered，等用户
        // 回合并入或空闲监视再驱动。窗口内新到的通知排在后面，一并保留。
        let mut wake = hub.wake.lock().unwrap_or_else(|e| e.into_inner());
        let mut restored = notices;
        restored.append(&mut wake.pending);
        wake.pending = restored;
        wake.deadline = None;
        let spawn_watcher = !wake.idle_watch;
        if spawn_watcher {
            wake.idle_watch = true;
        }
        drop(wake);
        if spawn_watcher {
            spawn_idle_watcher(hub.clone());
        }
        return;
    };
    let config = hub_view.config();
    let sink = hub_view
        .inner
        .sink
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    // 自动回合也是一次父回合：次数闸按回合复位；停止广播只覆盖本回合起的 run。
    hub_view.reset_turn_accounting();
    let (chain_index, previous_blocked) = {
        let mut wake = hub.wake.lock().unwrap_or_else(|e| e.into_inner());
        let previous_blocked = wake.blocked;
        wake.chain = wake.chain.saturating_add(1);
        wake.running = true;
        if wake.chain >= AUTO_WAKE_CHAIN_MAX {
            wake.blocked = Some("chain_limit");
        }
        (wake.chain, previous_blocked)
    };
    // 自动回合本身就是一个普通交互回合（design §12.6.2 末段），没有豁免。
    // `Preloaded`：通知已在历史里（无论本轮新插入还是触顶期间已上屏），不再入队。
    let turn_text = if undelivered.is_empty() {
        String::new()
    } else {
        notice_text(&undelivered, &batch)
    };
    let inserted = if undelivered.is_empty() {
        true
    } else {
        insert_notices_into_session(hub, &turn_text, &batch)
    };
    if inserted && !undelivered.is_empty() {
        emit_notice_event(hub, &undelivered, &batch);
    }
    if !inserted {
        // 会话在 acquire 之后消失：回滚并原样放回（未标 delivered）。
        runtime.release_turn(&hub.scope);
        let mut wake = hub.wake.lock().unwrap_or_else(|e| e.into_inner());
        wake.running = false;
        wake.chain = wake.chain.saturating_sub(1);
        wake.blocked = previous_blocked;
        wake.deadline = None;
        let mut restored = notices;
        restored.append(&mut wake.pending);
        wake.pending = restored;
        return;
    }
    if !undelivered.is_empty() {
        let mut wake = hub.wake.lock().unwrap_or_else(|e| e.into_inner());
        for notice in &undelivered {
            wake.delivered.insert(notice.run_id.clone());
        }
    }
    // 单测注入点：钩住「插入历史之后、起线程之前」的窗口（评审 r2 P1-1 路径 B）。
    run_after_wake_insert_hook();
    let release_runtime = runtime.clone();
    let release_scope = hub.scope.clone();
    let scope = hub.scope.clone();
    let sink = sink.unwrap_or_else(|| Arc::new(NullSink));
    let worker_hub = hub.clone();
    match spawn_auto_turn_thread(
        runtime,
        scope,
        config,
        sink,
        turn_text,
        chain_index,
        worker_hub,
    ) {
        Ok(_) => {
            if !undelivered.is_empty() {
                for notice in &undelivered {
                    hub_view.emit(events::subagent_notified(
                        &notice.run_id,
                        &notice.agent,
                        &notice.status,
                        "auto_turn",
                        &batch,
                        chain_index,
                    ));
                }
            }
            // 本批（含触顶期间已上屏的）已被本回合消费：只清**本批 run** 的投递标记，
            // 窗口内新到的通知及其状态一律不动。
            let consumed: HashSet<&str> = notices
                .iter()
                .map(|notice| notice.run_id.as_str())
                .collect();
            let mut wake = hub.wake.lock().unwrap_or_else(|e| e.into_inner());
            wake.delivered
                .retain(|run_id| !consumed.contains(run_id.as_str()));
            if wake.pending.is_empty() {
                wake.batch = None;
            }
        }
        Err(error) => {
            // 线程都起不来：释放 acquire 占住的 busy（否则会话永久 busy）、回滚链计数，
            // 本批原样放回 pending（已上屏的靠 delivered 去重），等下一轮重试。
            release_runtime.release_turn(&release_scope);
            let mut wake = hub.wake.lock().unwrap_or_else(|e| e.into_inner());
            wake.running = false;
            wake.chain = wake.chain.saturating_sub(1);
            wake.blocked = previous_blocked;
            wake.deadline = None;
            let mut restored = notices;
            restored.append(&mut wake.pending);
            wake.pending = restored;
            drop(wake);
            crate::logging::config_warning(
                "subagents",
                &format!("自动唤醒回合线程启动失败（将重试）：{error}"),
            );
            hub_view.notify_wake(WakeEvent::AutoTurnEnded);
        }
    }
}

/// 起自动回合前的父会话抢占。`None` = 抢不到（用户恰好发言 / 运行实例已结束）。
/// 单测可用 `FAIL_NEXT_WAKE_ACQUIRE` 注入失败。
fn wake_acquire(hub: &Arc<HubInner>) -> Option<Runtime> {
    #[cfg(test)]
    if FAIL_NEXT_WAKE_ACQUIRE.swap(false, Ordering::SeqCst) {
        return None;
    }
    let runtime = hub.runtime.upgrade()?;
    let config = hub.config.lock().unwrap_or_else(|e| e.into_inner()).clone();
    runtime.acquire_turn(&hub.scope, &config).ok()?;
    Some(runtime)
}

/// 自动回合线程的构造点（单测可注入 spawn 失败）。
fn spawn_auto_turn_thread(
    runtime: Runtime,
    scope: VaultScope,
    config: HarnessConfig,
    sink: Arc<dyn EventSink>,
    text: String,
    chain_index: u32,
    worker_hub: Arc<HubInner>,
) -> std::io::Result<std::thread::JoinHandle<()>> {
    #[cfg(test)]
    if FAIL_NEXT_AUTO_TURN_SPAWN.swap(false, Ordering::SeqCst) {
        return Err(std::io::Error::other("injected auto-turn spawn failure"));
    }
    std::thread::Builder::new()
        .name("lumir-subagent-auto-turn".into())
        .spawn(move || {
            // 自动回合开始（面板事件）：面板据此打开轮次闸门——自动回合的 `text_chunk` 没有
            // 对应的用户发送，不打开闸门就会被「轮次已关」丢弃（M590 真机 199 现场：自动回合
            // 的回复写进了留存、界面却没有）。事件由本线程在循环前发，早于任何分片。
            sink.emit(serde_json::json!({
                "type": "auto_turn_started",
                "chain_index": chain_index,
            }));
            let _ = super::turn::run_auto_turn_acquired(runtime, scope, config, sink, text);
            let mut wake = worker_hub.wake.lock().unwrap_or_else(|e| e.into_inner());
            wake.running = false;
            drop(wake);
            let hub_view = SubagentHub {
                inner: worker_hub.clone(),
            };
            hub_view.notify_wake(WakeEvent::AutoTurnEnded);
        })
}

/// 单测注入点：起线程窗口里模拟「新通知到达」（只有 `#[cfg(test)]` 会真的做事）。
fn run_after_wake_insert_hook() {
    #[cfg(test)]
    {
        let hook = AFTER_WAKE_INSERT_HOOK
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(hook) = hook {
            hook();
        }
    }
}

/// 单测注入点：触顶分支「已标 delivered、尚未 insert」的窗口（评审 r3 P2-1 窗口 A）。
fn run_after_blocked_mark_hook() {
    #[cfg(test)]
    {
        let hook = AFTER_BLOCKED_MARK_HOOK
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(hook) = hook {
            hook();
        }
    }
}

/// 单测注入点：`on_background_finished` push 之后、写投递标记之前的窗口（评审 r3 P2-2）。
fn run_after_notice_push_hook() {
    #[cfg(test)]
    {
        let hook = AFTER_NOTICE_PUSH_HOOK
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(hook) = hook {
            hook();
        }
    }
}

#[cfg(test)]
static FAIL_NEXT_WAKE_ACQUIRE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
#[cfg(test)]
static FAIL_NEXT_AUTO_TURN_SPAWN: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
#[cfg(test)]
static AFTER_WAKE_INSERT_HOOK: Mutex<Option<Box<dyn FnOnce() + Send>>> = Mutex::new(None);
#[cfg(test)]
static AFTER_BLOCKED_MARK_HOOK: Mutex<Option<Box<dyn FnOnce() + Send>>> = Mutex::new(None);
#[cfg(test)]
static AFTER_NOTICE_PUSH_HOOK: Mutex<Option<Box<dyn FnOnce() + Send>>> = Mutex::new(None);

/// 用户回合进行中时的空闲监视（轮次结束没有事件源；100ms 采样，单实例）。
fn spawn_idle_watcher(hub: Arc<HubInner>) {
    let for_error = hub.clone();
    let spawned = std::thread::Builder::new()
        .name("lumir-subagent-idle".into())
        .spawn(move || loop {
            if hub.closed.load(Ordering::SeqCst) {
                return;
            }
            let busy = hub
                .runtime
                .with_session(&hub.scope, |session| session.is_busy())
                .unwrap_or(false);
            if !busy {
                let mut wake = hub.wake.lock().unwrap_or_else(|e| e.into_inner());
                wake.idle_watch = false;
                drop(wake);
                SubagentHub { inner: hub.clone() }.notify_wake(WakeEvent::ParentIdle);
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        });
    if let Err(error) = spawned {
        // `idle_watch` 已置位；线程起不来必须复位，否则后续「父回合结束」的驱动永久丢失。
        let mut wake = for_error.wake.lock().unwrap_or_else(|e| e.into_inner());
        wake.idle_watch = false;
        drop(wake);
        crate::logging::config_warning(
            "subagents",
            &format!("空闲监视线程启动失败（下次事件将重试）：{error}"),
        );
    }
}

/// 把合并后的通知写进父会话（LLM input + 面板行）。父会话已被重建 / 不存在时静默放弃
/// （会话令牌由 `with_session` 的当前会话间接校验：不存在即 `harness_no_session`）。
fn insert_notices_into_session(hub: &Arc<HubInner>, text: &str, batch: &str) -> bool {
    hub.runtime
        .with_session(&hub.scope, |session| {
            insert_notice_message(session, text, Some(batch));
        })
        .is_ok()
}

/// `harness:event` 的 `notice` 事件（change add-harness-subagents tasks §10.4）：面板
/// transcript 的「后台任务完成」通知行由此上屏。**正文不是本事件的载荷**——它已经作为
/// 一条带 `auto_notice` 标记的 user 消息进了会话（内容真源只有一处，design §12.5）；
/// 本事件只带渲染所需的元数据（每个 run 的 agent / description / 终态 / 摘要首行）。
///
/// 上屏时刻与 `insert_notices_into_session` / `begin_user_turn` 的插入同点：通知在
/// LLM 上下文里出现的那一刻，面板也要看到同一行（两条可见面同源，MUST NOT 各判一次）。
fn emit_notice_event(hub: &HubInner, notices: &[NoticeRun], batch: &str) {
    let sink = hub.sink.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let Some(sink) = sink else {
        return;
    };
    let runs: Vec<serde_json::Value> = notices
        .iter()
        .map(|notice| {
            serde_json::json!({
                "run_id": notice.run_id,
                "agent": notice.agent,
                "description": notice.description,
                "status": notice.status,
                "stopped_by": notice.stopped_by,
                "summary": first_line(&notice.summary),
            })
        })
        .collect();
    sink.emit(serde_json::json!({
        "type": "notice",
        "wake_batch": batch,
        "runs": runs,
    }));
}

/// 通知消息入会话（`SessionContext::begin_user_turn` 与调度器共用同一装配点）：
/// LLM 侧是一条带机器标记的 user 消息；面板侧是 `notice` 角色的展示行（MUST NOT 冒充用户消息）。
pub(crate) fn insert_notice_message(session: &mut Session, text: &str, batch: Option<&str>) {
    session.push_input(session::user_item(text));
    session.push_panel(PanelMessage {
        role: "notice".into(),
        text: Some(strip_notice_marker(text)),
        summary: batch.map(str::to_string),
        name: None,
        status: None,
        reasoning: None,
        decision: None,
        ts: jsonl::unix_secs_now(),
    });
}

/// 面板展示文本：剥掉末尾的机器标记块（模型上下文里保留，界面不显示）。
fn strip_notice_marker(text: &str) -> String {
    match text.rfind(AUTO_NOTICE_MARKER) {
        Some(index) => text[..index].trim_end().to_string(),
        None => text.to_string(),
    }
}

/// 合并通知文本（design §12.6.2 的固定形状）。
fn notice_text(notices: &[NoticeRun], batch: &str) -> String {
    let mut text = String::from(AUTO_NOTICE_PREFIX);
    text.push('\n');
    for notice in notices {
        text.push_str(&format!(
            "- {}（{}）：{}",
            notice.agent,
            notice.description,
            notice.status_line()
        ));
        let summary = first_line(&notice.summary);
        if !summary.is_empty() {
            text.push_str(&format!(" — {summary}"));
        }
        text.push('\n');
    }
    text.push_str(AUTO_NOTICE_SUFFIX);
    text.push_str(&format!("\n\n{AUTO_NOTICE_MARKER} wake_batch={batch}]"));
    text
}

/// 一条 `notice_delivered` 侧车记录（design §12.6.4）：`run_ids` + `wake_batch`。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoticeMarker {
    pub run_ids: Vec<String>,
    pub wake_batch: String,
}

/// 从会话留存记录里收集投递标记（按文件序）。
pub fn notice_markers(records: &[serde_json::Value]) -> Vec<NoticeMarker> {
    records
        .iter()
        .filter(|record| record["kind"].as_str() == Some("notice_delivered"))
        .map(|record| NoticeMarker {
            run_ids: record["run_ids"]
                .as_array()
                .map(|ids| {
                    ids.iter()
                        .filter_map(|id| id.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default(),
            wake_batch: record["wake_batch"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
        })
        .collect()
}

/// 该批通知是否已被模型消费（design §12.6.4 的陈旧判定）：任一条 `llm_request.messages`
/// 里的 user 消息带同一 `wake_batch` 的机器标记 ⇒ 已进过请求，标记陈旧、不重复上屏。
pub fn notice_batch_consumed(records: &[serde_json::Value], wake_batch: &str) -> bool {
    records.iter().any(|record| {
        record["kind"].as_str() == Some("llm_request")
            && record["request"]["messages"]
                .as_array()
                .is_some_and(|messages| {
                    messages.iter().any(|message| {
                        message["role"].as_str() == Some("user")
                            && message["content"].as_array().is_some_and(|parts| {
                                parts.iter().any(|part| {
                                    part["text"].as_str().is_some_and(|text| {
                                        text.contains(&format!(
                                            "{AUTO_NOTICE_MARKER} wake_batch={wake_batch}]"
                                        ))
                                    })
                                })
                            })
                    })
                })
    })
}

/// 恢复时重建「已上屏、未消费」的通知文本（design §12.6.4）：标记未陈旧 ⇒ 据标记 +
/// 对应 run 的 `subrun` sidecar 重建一条通知；摘要正文不进标记，重建文案注明「摘要见审计
/// 流水与 task 行」。MUST NOT 因此起自动回合（恢复不是收敛事件）。
pub fn restored_notice_texts(records: &[serde_json::Value]) -> Vec<String> {
    restored_notices(records)
        .into_iter()
        .map(|notice| notice.text)
        .collect()
}

/// 恢复通知的完整形态（正文 + 批次 + run 列表）：显示路径要把同一批标记复制进新文件，
/// 保证「重建后再次退出」仍可恢复。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoredNotice {
    pub text: String,
    pub wake_batch: String,
    pub run_ids: Vec<String>,
}

pub fn restored_notices(records: &[serde_json::Value]) -> Vec<RestoredNotice> {
    let subruns: HashMap<&str, &serde_json::Value> = records
        .iter()
        .filter(|record| record["kind"].as_str() == Some("subrun"))
        .filter_map(|record| record["run_id"].as_str().map(|id| (id, record)))
        .collect();
    // 每段收尾各写一条标记（run_ids 只有一个元素）；同一 wake_batch 的多条标记合并为
    // **一条**通知（设计 §12.6.4「重建一条自动化通知」）。
    let mut batches: Vec<(String, Vec<String>)> = Vec::new();
    for marker in notice_markers(records) {
        if let Some((_, ids)) = batches
            .iter_mut()
            .find(|(batch, _)| batch == &marker.wake_batch)
        {
            for id in marker.run_ids {
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
        } else {
            batches.push((marker.wake_batch, marker.run_ids));
        }
    }
    let mut restored = Vec::new();
    for (batch, run_ids) in batches {
        if notice_batch_consumed(records, &batch) {
            continue;
        }
        let notices: Vec<NoticeRun> = run_ids
            .iter()
            .filter_map(|run_id| {
                let sidecar = subruns.get(run_id.as_str())?;
                Some(NoticeRun {
                    run_id: run_id.clone(),
                    agent: sidecar["agent"].as_str().unwrap_or("").to_string(),
                    description: sidecar["description"].as_str().unwrap_or("").to_string(),
                    status: sidecar["status"].as_str().unwrap_or("unknown").to_string(),
                    stopped_by: sidecar["stopped_by"].as_str().map(str::to_string),
                    summary: "摘要见审计流水与 task 行".to_string(),
                })
            })
            .collect();
        if notices.is_empty() {
            continue;
        }
        restored.push(RestoredNotice {
            text: notice_text(&notices, &batch),
            wake_batch: batch,
            run_ids,
        });
    }
    restored
}

/// 面板展示文本（剥掉机器标记）——恢复路径与实时路径共用同一个展示口径。
pub(crate) fn notice_display_text(text: &str) -> String {
    strip_notice_marker(text)
}

fn first_line(text: &str) -> String {
    text.lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().chars().take(200).collect())
        .unwrap_or_default()
}

/// `AutoWakeSnapshot` 的判定辅助：用户是否主动停止了当前自动回合。停止标志与「自动回合
/// 在飞」同时成立即视同触顶（design §12.6.3）。
fn walk_stopped_by_user(hub: &HubInner) -> bool {
    hub.runtime
        .with_session(&hub.scope, |session| session.abort_requested())
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// task 工具入口（§3）
// ---------------------------------------------------------------------------

/// `task` 调用的一个句柄：前台 join 子运行线程；后台在启动时就把 `running` 信封交回。
pub(crate) struct TaskHandle {
    immediate: Option<serde_json::Value>,
    handle: Option<std::thread::JoinHandle<serde_json::Value>>,
}

impl TaskHandle {
    /// 等待并取回结果信封（单测直接驱动句柄的便捷形态；生产中句柄以 trait 对象流转）。
    #[cfg(test)]
    pub(crate) fn result_value(mut self) -> serde_json::Value {
        self.take_value()
    }

    fn take_value(&mut self) -> serde_json::Value {
        if let Some(value) = self.immediate.take() {
            return value;
        }
        if let Some(handle) = self.handle.take() {
            return handle.join().unwrap_or_else(|_| internal_error());
        }
        internal_error()
    }
}

fn internal_error() -> serde_json::Value {
    serde_json::json!({
        "ok": false,
        "code": "harness_internal_error",
        "message": "子运行线程异常结束",
    })
}

impl super::run::OrchestrationCall for TaskHandle {
    fn join(mut self: Box<Self>) -> (serde_json::Value, serde_json::Value) {
        let value = self.take_value();
        (
            serde_json::json!({}),
            serde_json::json!({
                "type": "function_call_output",
                "output": serde_json::to_string(&value).unwrap_or_default(),
            }),
        )
    }

    fn result_value(mut self: Box<Self>) -> serde_json::Value {
        self.take_value()
    }
}

/// 解析后的 `task` 参数（§3.3 的校验面）。
struct TaskArgs {
    agent: String,
    prompt: String,
    description: String,
    model: Option<String>,
    resume: Option<String>,
    background: bool,
}

fn parse_task_args(arguments: &str) -> Result<TaskArgs, ToolOutput> {
    let value: serde_json::Value = serde_json::from_str(arguments).map_err(|e| {
        ToolOutput::err("tool_args_invalid", format!("task 参数不是合法 JSON：{e}"))
    })?;
    let agent = value
        .get("agent")
        .and_then(|agent| agent.as_str())
        .unwrap_or("")
        .to_string();
    let prompt = value
        .get("prompt")
        .and_then(|prompt| prompt.as_str())
        .unwrap_or("")
        .to_string();
    let description = value
        .get("description")
        .and_then(|description| description.as_str())
        .unwrap_or("")
        .to_string();
    let model = match value.get("model") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(model)) if !model.trim().is_empty() => {
            Some(model.trim().to_string())
        }
        Some(serde_json::Value::String(_)) => None,
        Some(_) => {
            return Err(ToolOutput::err(
                "model_not_configured",
                "task 的 model 参数必须是模型 id 字符串",
            ))
        }
    };
    let resume = match value.get("resume") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(resume)) if !resume.trim().is_empty() => {
            Some(resume.trim().to_string())
        }
        Some(_) => {
            return Err(ToolOutput::err(
                "run_not_resumable",
                "task 的 resume 参数必须是 run_id 字符串",
            ))
        }
    };
    let background = match value.get("background") {
        None | Some(serde_json::Value::Null) => false,
        Some(serde_json::Value::Bool(background)) => *background,
        Some(_) => {
            return Err(ToolOutput::err(
                "tool_args_invalid",
                "task 的 background 参数必须是布尔值",
            ))
        }
    };
    Ok(TaskArgs {
        agent,
        prompt,
        description,
        model,
        resume,
        background,
    })
}

/// `SessionContext::orchestrate` 的启动实现：校验 → 网关 → 起线程 → 句柄。
/// 对 `task` 调用恒返回句柄（拒绝也回一条与普通工具同形的结果）。
pub(crate) fn start_task(
    hub: &SubagentHub,
    config: &HarnessConfig,
    catalog: &AgentCatalog,
    call: &llm::ToolCall,
    _owned_sink: Option<Arc<dyn EventSink>>,
) -> TaskHandle {
    match start_task_inner(hub, config, catalog, call) {
        Ok(handle) => handle,
        Err(output) => TaskHandle {
            immediate: Some(output.value),
            handle: None,
        },
    }
}

#[allow(clippy::too_many_arguments)]
fn start_task_inner(
    hub: &SubagentHub,
    config: &HarnessConfig,
    catalog: &AgentCatalog,
    call: &llm::ToolCall,
) -> Result<TaskHandle, ToolOutput> {
    // kill switch：`enabled=false` 时工具不注册；调用仍可能从历史 / 幻觉到达，回 `disabled`。
    if !config.subagents.enabled {
        // 参数还没解析（拒绝码优先于参数形状校验）：agent / description 只能留空——
        // 宁可少两个字段，也不把「参数解析失败」伪装成「开关关闭」。
        hub.emit(events::subagent_rejected("disabled", "", ""));
        return Err(ToolOutput::err(
            "disabled",
            "子代理功能已关闭（config.json 的 [harness.subagents].enabled=false）",
        ));
    }
    let args = parse_task_args(&call.arguments)?;
    if args.prompt.trim().is_empty() {
        hub.emit(events::subagent_rejected(
            "empty_prompt",
            &args.agent,
            &args.description,
        ));
        return Err(ToolOutput::err("empty_prompt", "task 的 prompt 不能为空"));
    }
    let Some(definition) = catalog.get(&args.agent) else {
        let available: Vec<&str> = catalog
            .definitions()
            .iter()
            .map(|definition| definition.name.as_str())
            .collect();
        hub.emit(events::subagent_rejected(
            "agent_not_found",
            &args.agent,
            &args.description,
        ));
        return Err(ToolOutput::err(
            "agent_not_found",
            format!(
                "没有名为 {} 的子代理（可用：{}）",
                args.agent,
                available.join(", ")
            ),
        ));
    };
    let definition = definition.clone();
    let background = definition.effective_background(args.background);

    // resume：活动 / 保留表的拒绝路径先判（**不取走**保留的会话——后面的次数闸 /
    // 并发闸可能拒绝本次调用，被拒调用不能把 resume 目标消耗掉）。
    let mut retained_model: Option<String> = None;
    if let Some(run_id) = &args.resume {
        if hub
            .inner
            .runs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(run_id)
        {
            hub.emit(events::subagent_rejected(
                "run_busy",
                &args.agent,
                &args.description,
            ));
            return Err(ToolOutput::err(
                "run_busy",
                format!("子运行 {run_id} 仍在运行，不能并发续跑"),
            ));
        }
        let registry = hub.inner.registry.lock().unwrap_or_else(|e| e.into_inner());
        let Some(retained) = registry.retained.get(run_id) else {
            hub.emit(events::subagent_rejected(
                "run_not_resumable",
                &args.agent,
                &args.description,
            ));
            return Err(ToolOutput::err(
                "run_not_resumable",
                format!(
                    "子运行 {run_id} 不可恢复（已收敛的 run 最多保留 {MAX_RETAINED_RUNS} 个，重启后清空）"
                ),
            ));
        };
        if retained.agent != definition.name {
            hub.emit(events::subagent_rejected(
                "agent_mismatch",
                &args.agent,
                &args.description,
            ));
            return Err(ToolOutput::err(
                "agent_mismatch",
                format!(
                    "子运行 {run_id} 属于 {}，不能用 {} 续跑",
                    retained.agent, definition.name
                ),
            ));
        }
        retained_model = Some(retained.model.clone());
    }

    // 模型解析序（design §11）：调用参数 > 保留 run 上次模型 > 定义字段 > inherit。
    let model = resolve_model(
        config,
        args.model.as_deref(),
        retained_model.as_deref(),
        definition.model.as_deref(),
    )
    .map_err(|message| {
        hub.emit(events::subagent_rejected(
            "model_not_configured",
            &args.agent,
            &args.description,
        ));
        ToolOutput::err("model_not_configured", message)
    })?;

    // 次数闸（§4.8）：只计实际执行的段；被拒调用不占额度。
    let limit = config.subagents.max_subruns_per_turn;
    if hub.inner.turn_segments.load(Ordering::SeqCst) >= limit {
        hub.emit(events::subagent_rejected(
            "subrun_limit",
            &args.agent,
            &args.description,
        ));
        return Err(ToolOutput::err(
            "subrun_limit",
            format!(
                "本回合已发起 {limit} 个子运行，达到 [harness.subagents].max_subruns_per_turn 上限"
            ),
        ));
    }

    // 并发许可：前台阻塞取；后台非阻塞取，取不到即 `concurrency_limit`（不排队）。
    let permit = if background {
        match hub.inner.concurrency.try_acquire() {
            Some(permit) => permit,
            None => {
                hub.emit(events::subagent_rejected(
                    "concurrency_limit",
                    &args.agent,
                    &args.description,
                ));
                return Err(ToolOutput::err(
                    "concurrency_limit",
                    "同时运行的子任务已达上限，后台启动被拒（不会自动排队补跑）",
                ));
            }
        }
    } else {
        hub.inner.concurrency.acquire()
    };
    hub.inner.turn_segments.fetch_add(1, Ordering::SeqCst);

    // 所有闸都过了：才把保留的会话从 LRU 里取走（被拒调用不消耗 resume 目标）。
    let retained = match &args.resume {
        None => None,
        Some(run_id) => {
            let mut registry = hub.inner.registry.lock().unwrap_or_else(|e| e.into_inner());
            let taken = registry.retained.remove(run_id);
            registry.lru.retain(|id| id != run_id);
            taken
        }
    };

    // resume 沿用同一 `run_id`（run 标识整段对话，`segment` 才标第几次调用，design §5.3）。
    let run_id = args.resume.clone().unwrap_or_else(|| new_run_id(hub));
    let segment = retained.as_ref().map(|run| run.segment + 1).unwrap_or(1);
    let mock_span = if config.is_mock(&config.provider) {
        llm::mock_region_span(config)
    } else {
        1
    };
    let (mock_start, _) =
        hub.reserve_mock_region(mock_span, retained.as_ref().map(|run| run.mock_cursor));
    let abort = Arc::new(AtomicBool::new(false));
    hub.inner
        .turn_runs
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(abort.clone());
    hub.inner
        .registry
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .active
        .insert(run_id.clone());
    hub.inner
        .runs
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(
            run_id.clone(),
            ActiveRun {
                agent: definition.name.clone(),
                description: args.description.clone(),
                model: model.clone(),
                segment,
                abort: abort.clone(),
            },
        );
    let parent_session = hub
        .inner
        .runtime
        .with_session(&hub.inner.scope, |session| {
            jsonl::JsonlWriter::session_id_from_path(session.jsonl().path())
        })
        .ok()
        .flatten()
        .unwrap_or_else(|| hub.inner.scope.key());
    hub.emit(events::subagent_started(
        &run_id,
        segment,
        &parent_session,
        &definition.name,
        &args.description,
        &model,
        &definition.tools,
        definition.max_turns,
        definition.max_tokens,
        definition.timeout_secs,
        background,
    ));

    // 子运行线程**自己持有**一份强 Runtime：后台 run 可能比父回合活得久（cron 的父线程
    // 结束后仍要收尾 / 写 sidecar）。这不是引用环——中枢只持弱引用，这份强引用随线程结束。
    let Some(segment_runtime) = hub.inner.runtime.upgrade() else {
        return Err(spawn_failed_cleanup(
            hub,
            &run_id,
            segment,
            &definition.name,
            &model,
            "父运行实例已结束",
        ));
    };
    let seed = SegmentSeed {
        hub: hub.clone(),
        runtime: segment_runtime,
        run_id: run_id.clone(),
        segment,
        definition,
        description: args.description.clone(),
        prompt: args.prompt,
        model: model.clone(),
        background,
        retained,
        mock_start,
        abort,
        permit: Some(permit),
        thinking_effort: hub
            .inner
            .runtime
            .with_session(&hub.inner.scope, |session| session.thinking_effort())
            .unwrap_or_default(),
    };

    // spawn 失败时 `seed`（连同并发许可 / 保留会话）随闭包被 drop；活动表与 runs 的残留
    // 必须显式清掉，否则该 run 永久是「运行中」的僵尸（后台分支尤其：父已拿到 running）。
    let cleanup_agent = args.agent.clone();
    if background {
        let envelope = running_envelope(&args.agent, &run_id, segment, &model, true);
        match std::thread::Builder::new()
            .name(format!("lumir-subagent-{run_id}"))
            .spawn(move || {
                run_segment(seed);
            }) {
            Ok(_) => Ok(TaskHandle {
                immediate: Some(envelope),
                handle: None,
            }),
            Err(error) => Err(spawn_failed_cleanup(
                hub,
                &run_id,
                segment,
                &cleanup_agent,
                &model,
                &error.to_string(),
            )),
        }
    } else {
        match std::thread::Builder::new()
            .name(format!("lumir-subagent-{run_id}"))
            .spawn(move || run_segment(seed))
        {
            // 前台结果由线程返回信封；`TaskHandle::join` 读取。
            Ok(handle) => Ok(TaskHandle {
                immediate: None,
                handle: Some(handle),
            }),
            Err(error) => Err(spawn_failed_cleanup(
                hub,
                &run_id,
                segment,
                &cleanup_agent,
                &model,
                &error.to_string(),
            )),
        }
    }
}

/// 子运行线程启动失败的统一收口：清活动表 / runs 残留 + 一条 failed 完成事件。
/// （`seed` 已随失败的闭包 drop——并发许可与保留会话随之释放。）返回父模型看到的错误信封。
fn spawn_failed_cleanup(
    hub: &SubagentHub,
    run_id: &str,
    segment: u32,
    agent: &str,
    model: &str,
    reason: &str,
) -> ToolOutput {
    hub.inner
        .runs
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(run_id);
    hub.inner
        .registry
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .active
        .remove(run_id);
    hub.emit_failed_terminal(
        run_id,
        segment,
        agent,
        model,
        0,
        None,
        Some(&format!("子运行线程启动失败：{reason}")),
    );
    ToolOutput::err(
        "harness_internal_error",
        format!("无法启动子运行线程：{reason}"),
    )
}

fn new_run_id(hub: &SubagentHub) -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!(
        "r-{millis}-{}",
        hub.inner.run_seq.fetch_add(1, Ordering::SeqCst) + 1
    )
}

/// 模型解析（design §11）。返回错误文案（调用方转 `model_not_configured`）。
fn resolve_model(
    config: &HarnessConfig,
    call_model: Option<&str>,
    retained_model: Option<&str>,
    definition_model: Option<&str>,
) -> Result<String, String> {
    // mock 判定按条目 `preset == Mock`（design §4.5）：fixture 驱动档的清单开放，任意 id 视为
    // 已声明；其余预设按该条目的模型清单精确匹配。
    let declared = |model: &str| {
        config.is_mock(&config.provider)
            || config
                .model_specs(&config.provider)
                .iter()
                .any(|spec| spec.id == model)
    };
    if let Some(model) = call_model {
        if !declared(model) {
            return Err(format!(
                "调用的 model {model} 不在当前 provider 的模型清单里"
            ));
        }
        return Ok(model.to_string());
    }
    if let Some(model) = retained_model {
        return Ok(model.to_string());
    }
    if let Some(model) = definition_model {
        return Ok(model.to_string());
    }
    let active = llm::active_model(config);
    if active.trim().is_empty() {
        Ok("mock".to_string())
    } else {
        Ok(active.to_string())
    }
}

// ---------------------------------------------------------------------------
// 段执行（§4.1–§4.8）
// ---------------------------------------------------------------------------

struct SegmentSeed {
    hub: SubagentHub,
    /// 本段线程自己的强 Runtime（见 `start_task_inner` 的注释；不参与引用环）。
    runtime: Runtime,
    run_id: String,
    segment: u32,
    definition: AgentDefinition,
    description: String,
    prompt: String,
    model: String,
    background: bool,
    retained: Option<RetainedRun>,
    mock_start: usize,
    abort: Arc<AtomicBool>,
    permit: Option<ConcurrencyPermit>,
    thinking_effort: ThinkingEffort,
}

/// 段收尾的完整读数（`subagent_finished` / sidecar / 结果信封的唯一素材面）。
struct SegmentReport {
    outcome: super::run::RunOutcome,
    model: String,
    usage: UsageDelta,
    rounds: u32,
    denials: u32,
    summary: String,
    summary_truncated: bool,
    tool_calls: BTreeMap<String, u32>,
    audit_path: Option<PathBuf>,
    /// 审计不可用 / 写入失败的人话原因（不阻断运行；`subagent_finished` 带这个字段）。
    audit_error: Option<String>,
    duration_ms: u64,
}

impl SegmentReport {
    fn status(&self) -> &'static str {
        match &self.outcome {
            super::run::RunOutcome::Completed => "completed",
            super::run::RunOutcome::Partial { .. } => "partial",
            super::run::RunOutcome::Failed { .. } => "failed",
            super::run::RunOutcome::Aborted => "aborted",
        }
    }

    fn stopped_by(&self) -> Option<&'static str> {
        match &self.outcome {
            super::run::RunOutcome::Partial { stopped_by } => Some(stopped_by.as_str()),
            _ => None,
        }
    }

    fn resumable(&self) -> bool {
        matches!(
            self.outcome,
            super::run::RunOutcome::Completed | super::run::RunOutcome::Partial { .. }
        )
    }
}

/// 一条 run 的一条段：装配 → 循环 → 收尾（任何终态恰一次）→ 保留 / 投递 → 返回信封。
fn run_segment(mut seed: SegmentSeed) -> serde_json::Value {
    let hub = seed.hub.clone();
    let run_id = seed.run_id.clone();
    let started = Instant::now();
    // 审计流水：首段 `run_open`，后续段追加 `run_segment`（同一 run 同一文件）。
    // 写失败不阻断运行（`JsonlWriter` 的既有纪律），目录不可用则退到临时文件。
    let audit_path = jsonl::vault_subruns_dir(&hub.inner.scope.vault_id)
        .ok()
        .map(|dir| dir.join(format!("{run_id}.jsonl")));
    let writer = audit_path.as_ref().and_then(|path| {
        if seed.retained.is_some() {
            Some(JsonlWriter::append_at(path.clone()))
        } else {
            let open = serde_json::json!({
                "kind": "run_open",
                "run_id": run_id,
                "agent": seed.definition.name,
                "model": seed.model,
                "tools": seed.definition.tools,
                "budget": {
                    "max_turns": seed.definition.max_turns,
                    "max_tokens": seed.definition.max_tokens,
                    "timeout_secs": seed.definition.timeout_secs,
                },
                "prompt": seed.prompt,
            });
            JsonlWriter::create_at(path.clone(), &open).ok()
        }
    });
    let mut session = match seed.retained.take() {
        Some(retained) => retained.session,
        None => {
            // 新段才装配 system（resume 段沿用保留会话自带的 system——定义文件事后被删
            // 不应让已有子会话无法续跑）。
            let system = match seed.definition.body() {
                Ok(body) => {
                    super::context::assemble_system_for_subagent(&hub.inner.scope.root, &body)
                }
                Err(message) => {
                    return finish_failed(
                        &seed,
                        started,
                        audit_path,
                        "agent_definition_unreadable",
                        &message,
                    )
                }
            };
            let writer = writer.unwrap_or_else(|| {
                JsonlWriter::append_at(
                    std::env::temp_dir().join(format!("lumir-subrun-{run_id}.jsonl")),
                )
            });
            Session::new(
                hub.inner.scope.root.clone(),
                system.text,
                Vec::new(),
                seed.thinking_effort,
                writer,
            )
        }
    };
    if seed.segment > 1 {
        session.jsonl().record(&serde_json::json!({
            "kind": "run_segment",
            "run_id": run_id,
            "segment": seed.segment,
            "budget": {
                "max_turns": seed.definition.max_turns,
                "max_tokens": seed.definition.max_tokens,
                "timeout_secs": seed.definition.timeout_secs,
            },
        }));
    }

    let config = hub.config();
    let mut client = match llm::client_at(
        &config,
        &hub.inner.scope.vault_id,
        seed.mock_start,
        Some(&seed.model),
    ) {
        Ok(client) => client,
        Err(error) => {
            return finish_failed(&seed, started, audit_path, &error.code, &error.message);
        }
    };
    let prompt = seed.prompt.clone();
    let mut ctx = ChildContext::new(&seed, &hub, session);
    let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        super::turn::run_turn_core_with_mode(
            &mut ctx,
            &config,
            super::turn::TurnInput::User {
                parts: super::turn::DeliveryInput::from(prompt),
                context_section: None,
            },
            client.as_mut(),
        );
    }))
    .is_err();
    if panicked {
        ctx.mark_internal_error();
    }
    let outcome = ctx.derive_outcome();
    let report = ctx.finish(outcome, audit_path, started.elapsed());
    let child_session = ctx.into_session();

    // 保留（resume 前提）：只有 completed / partial 可续跑。
    if report.resumable() {
        let mock_cursor = match client.mock_script_len() {
            Some(len) => llm::wrap_cursor(seed.mock_start, client.mock_consumed(), len),
            None => seed.mock_start + client.mock_consumed(),
        };
        hub.retain_run(
            seed.run_id.clone(),
            RetainedRun {
                session: child_session,
                agent: seed.definition.name.clone(),
                model: seed.model.clone(),
                segment: seed.segment,
                mock_cursor,
            },
        );
    }
    let envelope = report_envelope(
        &report,
        &seed.run_id,
        seed.segment,
        &seed.definition.name,
        seed.background,
    );
    // 活动表移除；后台结果的投递与唤醒只对后台 run 发生。
    hub.inner
        .runs
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&seed.run_id);
    hub.inner
        .registry
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .active
        .remove(&seed.run_id);
    // resume 段没有新占区间：它消费的是**上一回合已经跳过**的旧区间条目，父游标早已在其后
    // （M590：父客户端现在自己跳过新区间，这里再补 reserved 会让下一轮多跳一格——真机场景
    // 189 现场：续跑后父回合弹到空条目 / fixture_exhausted）。
    if seed.background && matches!(report.outcome, super::run::RunOutcome::Aborted) {
        // 中止不投递、不唤醒，但事件如实反映（`wake = none_aborted`）。
        hub.emit(events::subagent_notified(
            &seed.run_id,
            &seed.definition.name,
            "aborted",
            "none_aborted",
            "",
            0,
        ));
    }
    if seed.background && !matches!(report.outcome, super::run::RunOutcome::Aborted) {
        hub.on_background_finished(NoticeRun {
            run_id: seed.run_id.clone(),
            agent: seed.definition.name.clone(),
            description: seed.description.clone(),
            status: report.status().to_string(),
            stopped_by: report.stopped_by().map(str::to_string),
            summary: report.summary.clone(),
        });
    }
    drop(seed.permit);
    envelope
}

fn report_envelope(
    report: &SegmentReport,
    run_id: &str,
    segment: u32,
    agent: &str,
    background: bool,
) -> serde_json::Value {
    match &report.outcome {
        super::run::RunOutcome::Completed => serde_json::json!({
            "ok": true,
            "status": "completed",
            "agent": agent,
            "run_id": run_id,
            "segment": segment,
            "resumable": true,
            "background": background,
            "model": report.model,
            "summary": report.summary,
            "truncated": report.summary_truncated,
            "usage": usage_json(report.usage),
            "rounds": report.rounds,
            "denied_calls": report.denials,
            "tool_calls": report.tool_calls,
        }),
        super::run::RunOutcome::Partial { stopped_by } => serde_json::json!({
            "ok": true,
            "status": "partial",
            "agent": agent,
            "run_id": run_id,
            "segment": segment,
            "resumable": true,
            "background": background,
            "stopped_by": stopped_by.as_str(),
            "note": partial_note(*stopped_by, report.rounds),
            "model": report.model,
            "summary": report.summary,
            "truncated": report.summary_truncated,
            "usage": usage_json(report.usage),
            "rounds": report.rounds,
            "denied_calls": report.denials,
            "tool_calls": report.tool_calls,
        }),
        super::run::RunOutcome::Failed { code, message } => serde_json::json!({
            "ok": false,
            "code": code,
            "message": message,
        }),
        super::run::RunOutcome::Aborted => serde_json::json!({
            "ok": false,
            "code": "turn_aborted",
            "message": "子运行已停止",
        }),
    }
}

/// 部分结果的说明文案（design §5.2「summary 为空串时 note 说明已完成多少轮工具调用」）：
/// 轮数从信封的 `rounds` 同源读出，不另算一份。
fn partial_note(reason: StopReason, rounds: u32) -> String {
    match reason {
        StopReason::Rounds => {
            format!("子运行触及轮次预算（已完成 {rounds} 轮）；可用 resume 续跑")
        }
        StopReason::Tokens => {
            format!("子运行触及 token 预算（已完成 {rounds} 轮）；可用 resume 续跑")
        }
        StopReason::Time => {
            format!("子运行触及时间预算（已完成 {rounds} 轮）；可用 resume 续跑")
        }
        StopReason::Quota => format!("provider 配额或限流（已完成 {rounds} 轮）；不自动重试"),
        StopReason::Error => {
            format!("子运行被 API 错误中断（已完成 {rounds} 轮）；以下为已产出部分")
        }
    }
}

fn usage_json(usage: UsageDelta) -> serde_json::Value {
    serde_json::json!({
        "input_tokens": usage.input_tokens,
        "cached_tokens": usage.cached_tokens,
        "output_tokens": usage.output_tokens,
    })
}

fn running_envelope(
    agent: &str,
    run_id: &str,
    segment: u32,
    model: &str,
    background: bool,
) -> serde_json::Value {
    serde_json::json!({
        "ok": true,
        "status": "running",
        "agent": agent,
        "run_id": run_id,
        "segment": segment,
        "background": background,
        "model": model,
        "note": "后台运行中；完成后结果以自动化通知进入本会话",
    })
}

fn finish_failed(
    seed: &SegmentSeed,
    started: Instant,
    audit_path: Option<PathBuf>,
    code: &str,
    message: &str,
) -> serde_json::Value {
    let report = SegmentReport {
        outcome: super::run::RunOutcome::Failed {
            code: code.to_string(),
            message: message.to_string(),
        },
        model: seed.model.clone(),
        usage: UsageDelta::default(),
        rounds: 0,
        denials: 0,
        summary: String::new(),
        summary_truncated: false,
        tool_calls: BTreeMap::new(),
        audit_error: audit_path
            .is_none()
            .then(|| "子运行审计目录不可用".to_string()),
        audit_path,
        duration_ms: started.elapsed().as_millis() as u64,
    };
    seed.hub
        .inner
        .runs
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&seed.run_id);
    seed.hub
        .inner
        .registry
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .active
        .remove(&seed.run_id);
    let audit = report
        .audit_path
        .as_ref()
        .map(|path| path.display().to_string());
    seed.hub.record_segment_sidecar(
        &seed.run_id,
        seed.segment,
        &seed.definition.name,
        &seed.description,
        &seed.model,
        "failed",
        None,
        0,
        0,
        Usage::default(),
        audit.as_deref(),
    );
    seed.hub.emit_failed_terminal(
        &seed.run_id,
        seed.segment,
        &seed.definition.name,
        &seed.model,
        report.duration_ms,
        audit.as_deref(),
        report.audit_error.as_deref(),
    );
    if seed.background {
        // 后台启动后段前失败：父会话只收到过 `running`，失败同样要给一条完成通知。
        seed.hub.on_background_finished(NoticeRun {
            run_id: seed.run_id.clone(),
            agent: seed.definition.name.clone(),
            description: seed.description.clone(),
            status: "failed".to_string(),
            stopped_by: None,
            summary: String::new(),
        });
    }
    report_envelope(
        &report,
        &seed.run_id,
        seed.segment,
        &seed.definition.name,
        seed.background,
    )
}

// ---------------------------------------------------------------------------
// ChildContext（§4.1）
// ---------------------------------------------------------------------------

/// 父会话事件出口的诊断包装（tasks §7.1/§7.2）：七类 `subagent_*` 面板事件在这里转一条
/// 诊断日志，随后原样转发。包装只发生在 [`SubagentHub::set_sink`]（唯一装配点），因此
/// 中枢自发的与子运行直发的事件共用同一个诊断产出点——完成 / 失败 / 中止 / 后台路径不各写
/// 一遍 `logging::subagent_*`（REVIEW.md「同一语义两处真源」条）。
struct DiagnosticSink(Arc<dyn EventSink>);

impl EventSink for DiagnosticSink {
    fn emit(&self, payload: serde_json::Value) {
        crate::logging::subagent_event(&payload);
        self.0.emit(payload);
    }
}

/// 子运行的过程事件转发器：把子会话的事件**转成面板可见面**，并吞掉会污染父会话的事件
/// （text / reasoning / usage / done / error / compact / title）。
struct ChildSink {
    parent: Option<Arc<dyn EventSink>>,
    run_id: String,
    segment: u32,
    capture: Arc<Mutex<SinkCapture>>,
}

#[derive(Default)]
struct SinkCapture {
    last_error: Option<(String, String)>,
}

impl EventSink for ChildSink {
    fn emit(&self, payload: serde_json::Value) {
        match payload["type"].as_str() {
            Some("tool_call") => {
                let tool = payload["name"].as_str().unwrap_or("");
                let summary = payload["summary"].as_str().unwrap_or("");
                if let Some(parent) = &self.parent {
                    parent.emit(events::subagent_step(
                        &self.run_id,
                        self.segment,
                        tool,
                        summary,
                    ));
                }
            }
            Some("error") => {
                // 捕获错误供收尾判定；MUST NOT 转发到父会话（子运行的过程错误不冒充
                // 父回合的终态事件）。
                let mut capture = self.capture.lock().unwrap_or_else(|e| e.into_inner());
                capture.last_error = Some((
                    payload["code"].as_str().unwrap_or("").to_string(),
                    payload["message"].as_str().unwrap_or("").to_string(),
                ));
            }
            _ => {}
        }
    }
}

struct NullSink;

impl EventSink for NullSink {
    fn emit(&self, _payload: serde_json::Value) {}
}

/// 子运行上下文（design §2.3 / §4.1）：本地会话、工具白名单、三重闸、批准透传。
pub(crate) struct ChildContext {
    session: Session,
    sink: ChildSink,
    parent_sink: Option<Arc<dyn EventSink>>,
    hub: SubagentHub,
    runtime: Runtime,
    scope: VaultScope,
    parent_token: u64,
    namespace: Option<permission_cache::Namespace>,
    config: HarnessConfig,
    run_id: String,
    segment: u32,
    agent_name: String,
    description: String,
    /// 本段实际使用的模型 id（模型解析后的值；分桶 / 事件 / 信封共用这一份）。
    model: String,
    tool_policy: Vec<String>,
    max_turns: u32,
    max_tokens: u64,
    timeout: Duration,
    started: Instant,
    approval_wait: Duration,
    spent_tokens: u64,
    usage: UsageDelta,
    rounds: u32,
    denials: u32,
    tool_calls: BTreeMap<String, u32>,
    exhausted: Option<StopReason>,
    last_error: Option<llm::TurnError>,
    last_text: Option<String>,
    internal_error: bool,
    finished: bool,
    abort: Arc<AtomicBool>,
}

impl ChildContext {
    fn new(seed: &SegmentSeed, hub: &SubagentHub, session: Session) -> Self {
        let parent_token = hub.inner.parent_token;
        let namespace = hub
            .inner
            .runtime
            .with_session(&hub.inner.scope, |parent| {
                jsonl::JsonlWriter::session_id_from_path(parent.jsonl().path()).map(|session_id| {
                    permission_cache::Namespace::new(hub.inner.scope.key(), session_id)
                })
            })
            .ok()
            .flatten();
        // 只取一次事件出口：同一把锁在同一个结构体字面量里取两次会自锁（临时 guard 活到
        // 语句结束）。
        let parent_sink = hub
            .inner
            .sink
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        Self {
            session,
            sink: ChildSink {
                parent: parent_sink.clone(),
                run_id: seed.run_id.clone(),
                segment: seed.segment,
                capture: Arc::new(Mutex::new(SinkCapture::default())),
            },
            parent_sink,
            hub: hub.clone(),
            runtime: seed.runtime.clone(),
            scope: hub.inner.scope.clone(),
            parent_token,
            namespace,
            config: hub.config(),
            run_id: seed.run_id.clone(),
            segment: seed.segment,
            agent_name: seed.definition.name.clone(),
            description: seed.description.clone(),
            model: seed.model.clone(),
            tool_policy: seed.definition.tools.clone(),
            max_turns: seed.definition.max_turns,
            max_tokens: seed.definition.max_tokens,
            timeout: Duration::from_secs(seed.definition.timeout_secs.max(1)),
            started: Instant::now(),
            approval_wait: Duration::ZERO,
            spent_tokens: 0,
            usage: UsageDelta::default(),
            rounds: 0,
            denials: 0,
            tool_calls: BTreeMap::new(),
            exhausted: None,
            last_error: None,
            last_text: None,
            internal_error: false,
            finished: false,
            abort: seed.abort.clone(),
        }
    }

    fn mark_internal_error(&mut self) {
        self.internal_error = true;
    }

    /// 由循环留下的状态推导终态（design §7.2 / §7.3）。
    fn derive_outcome(&mut self) -> super::run::RunOutcome {
        if self.internal_error {
            return super::run::RunOutcome::Failed {
                code: "harness_internal_error".into(),
                message: "子运行线程发生内部错误".into(),
            };
        }
        if self.is_aborted_now() {
            return super::run::RunOutcome::Aborted;
        }
        if let Some(reason) = self.exhausted {
            return super::run::RunOutcome::Partial { stopped_by: reason };
        }
        if let Some(error) = self.last_error.clone().or_else(|| {
            self.sink
                .capture
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .last_error
                .clone()
                .map(|(code, message)| llm::TurnError::new(code, message, false))
        }) {
            if error.context_overflow {
                return super::run::RunOutcome::Failed {
                    code: "harness_context_overflow".into(),
                    message: error.message,
                };
            }
            if llm::is_quota_error(&error) {
                // 无任何产出时按失败收口（spec「quota：无任何产出时 failed」）；有产出才是 partial。
                if self.last_text.as_deref().is_none_or(|text| text.is_empty()) {
                    return super::run::RunOutcome::Failed {
                        code: error.code,
                        message: error.message,
                    };
                }
                return super::run::RunOutcome::Partial {
                    stopped_by: StopReason::Quota,
                };
            }
            if self
                .last_text
                .as_deref()
                .is_some_and(|text| !text.is_empty())
            {
                return super::run::RunOutcome::Partial {
                    stopped_by: StopReason::Error,
                };
            }
            return super::run::RunOutcome::Failed {
                code: error.code,
                message: error.message,
            };
        }
        super::run::RunOutcome::Completed
    }

    fn is_aborted_now(&self) -> bool {
        self.abort.load(Ordering::SeqCst)
            || self.hub.inner.closed.load(Ordering::SeqCst)
            || !self.parent_alive()
    }

    fn parent_alive(&self) -> bool {
        self.runtime
            .with_session(&self.scope, |session| {
                session.subagent_token() == self.parent_token
            })
            .unwrap_or(false)
    }

    fn elapsed_running(&self) -> Duration {
        self.started.elapsed().saturating_sub(self.approval_wait)
    }

    /// 段收尾（恰一次）：按模型记账、写父会话 `subrun` sidecar、产 `subagent_finished`、
    /// 记录段身份。`finished` 标志保证任何终态只收尾一次（含 panic 路径）。
    fn finish(
        &mut self,
        outcome: super::run::RunOutcome,
        audit_path: Option<PathBuf>,
        duration: Duration,
    ) -> SegmentReport {
        let (summary, summary_truncated) =
            tools::truncate_task_summary(self.last_text.as_deref().unwrap_or(""));
        let report = SegmentReport {
            outcome,
            model: self.model.clone(),
            usage: self.usage,
            rounds: self.rounds,
            denials: self.denials,
            summary,
            summary_truncated,
            tool_calls: self.tool_calls.clone(),
            audit_error: audit_path
                .is_none()
                .then(|| "子运行审计目录不可用".to_string()),
            audit_path,
            duration_ms: duration.as_millis() as u64,
        };
        if self.finished {
            return report;
        }
        self.finished = true;
        // 审计流水的段尾（append-only；写失败不阻断）。
        self.session.jsonl().record(&serde_json::json!({
            "kind": "run_finished",
            "run_id": self.run_id,
            "segment": self.segment,
            "status": report.status(),
            "stopped_by": report.stopped_by(),
        }));
        // 父会话侧：按模型分桶 + 每段一条 `subrun` sidecar。
        let usage = Usage {
            input_tokens: report.usage.input_tokens,
            cached_tokens: report.usage.cached_tokens,
            output_tokens: report.usage.output_tokens,
            cache_write_tokens: report.usage.cache_write_tokens,
        };
        let audit = report
            .audit_path
            .as_ref()
            .map(|path| path.display().to_string());
        self.hub.record_segment_sidecar(
            &self.run_id,
            self.segment,
            &self.agent_name,
            &self.description,
            &report.model,
            report.status(),
            report.stopped_by(),
            report.rounds,
            report.denials,
            usage,
            audit.as_deref(),
        );
        if let Some(sink) = &self.parent_sink {
            // 摘要正文（tasks §10.2 的行详情数据源）：设计 §13 的事件表只列 `summary_chars`，
            // 但面板/历史 task 行的「摘要（完成后）」需要正文——事件级带上（诊断日志的
            // 白名单不含 summary，因此不进日志、只上面板）。来源与信封同一份 `report.summary`。
            let mut payload = events::subagent_finished(
                &self.run_id,
                self.segment,
                &self.agent_name,
                report.status(),
                report.stopped_by(),
                report.rounds,
                &report.model,
                report.usage.input_tokens,
                report.usage.cached_tokens,
                report.usage.output_tokens,
                report.denials,
                report.duration_ms,
                report.summary.chars().count(),
                report
                    .audit_path
                    .as_ref()
                    .map(|path| path.display().to_string())
                    .as_deref(),
                report.audit_error.as_deref(),
            );
            payload["summary"] = serde_json::json!(report.summary);
            sink.emit(payload);
        }
        report
    }

    fn into_session(self) -> Session {
        self.session
    }
}

impl RunContext for ChildContext {
    fn with_session<R>(&mut self, f: impl FnOnce(&mut Session) -> R) -> Result<R, CommandError> {
        Ok(f(&mut self.session))
    }

    fn sink(&self) -> &dyn EventSink {
        &self.sink
    }

    fn tool_definitions(&self) -> Vec<serde_json::Value> {
        tools::definitions()
            .into_iter()
            .filter(|definition| {
                definition["name"]
                    .as_str()
                    .is_some_and(|name| self.tool_policy.iter().any(|tool| tool == name))
            })
            .collect()
    }

    fn decide(&self, tool: &str, subject: &str, args: &serde_json::Value) -> permissions::Verdict {
        let cached = self
            .namespace
            .as_ref()
            .is_some_and(|namespace| permission_cache::is_remembered(namespace, tool, subject));
        let judge = permissions::Judge {
            mode: self.config.permission_mode,
            root: &self.scope.root,
            argv: (tool == "cli_run").then(|| tools::cli_argv(args)),
            cached,
        };
        // 与父会话同一份「本轮生效规则」（change harness-permission-rules-oct23 design §4）：
        // 父会话批准卡上沉淀的规则对子运行的后续判定同样立即生效。
        permissions::decide(
            &self.runtime.live_permissions(&self.config.permissions),
            tool,
            subject,
            &judge,
        )
    }

    fn approval(
        &mut self,
        request: ApprovalRequest,
        rx: mpsc::Receiver<ApprovalSignal>,
    ) -> ApprovalOutcome {
        if self.approval_policy() == super::run::ApprovalPolicy::RejectUnavailable {
            let code = "approval_required";
            let message = "无人值守运行遇到需要批准的调用，已中止本次运行";
            self.session.stop_with(code, message);
            return ApprovalOutcome::Unavailable {
                code: code.to_string(),
                message: message.to_string(),
            };
        }
        let id = self.hub.next_approval_id();
        let source = ApprovalSource::Subrun {
            agent: self.agent_name.clone(),
            run_id: self.run_id.clone(),
            description: self.description.clone(),
        };
        let tool = request.tool.clone();
        let diff = request.diff.clone();
        let argv = request.argv.clone();
        let purpose = request.purpose.clone();
        let reason = request.reason.clone();
        let remember = request.remember.clone();
        let persist_rule = request.persist_rule.clone();
        let request = request.with_id(id.clone()).with_source(source.clone());
        let parked = self.runtime.with_session(&self.scope, |parent| {
            if parent.subagent_token() != self.parent_token {
                return Err(CommandError::new(
                    "approval_stale",
                    "父会话已重建，批准请求失效",
                ));
            }
            parent.park_approval(request);
            Ok(())
        });
        match parked {
            Ok(Ok(())) => {}
            Ok(Err(error)) | Err(error) => return ApprovalOutcome::Failed(error),
        }
        if let Some(sink) = &self.parent_sink {
            sink.emit(events::approval_request_full(
                &id,
                &tool,
                diff.as_deref(),
                argv.as_deref(),
                purpose.as_deref(),
                reason.as_ref(),
                Some(&source),
                // 调度工具不在子运行的注册表里，子运行透传的卡永远没有定时任务预览。
                None,
                remember.as_deref(),
                persist_rule.as_deref(),
            ));
        }
        let wait_start = Instant::now();
        let outcome = match rx.recv() {
            Ok(ApprovalSignal::Decided(decision)) => ApprovalOutcome::Decided(decision),
            Ok(ApprovalSignal::Withdrawn) => ApprovalOutcome::Withdrawn,
            Err(_) => ApprovalOutcome::Stale,
        };
        // 等人工批准的时间不计入时间闸（design §7.1）。
        self.approval_wait += wait_start.elapsed();
        outcome
    }

    fn approval_policy(&self) -> super::run::ApprovalPolicy {
        // 父会话是无人值守槽位（cron）时，子运行同样无人可问。
        if self.runtime.is_isolated() {
            super::run::ApprovalPolicy::RejectUnavailable
        } else {
            super::run::ApprovalPolicy::PassthroughFrom {
                run_id: self.run_id.clone(),
            }
        }
    }

    fn reject_unavailable(&mut self) -> Option<(String, String)> {
        if self.approval_policy() != super::run::ApprovalPolicy::RejectUnavailable {
            return None;
        }
        let code = "approval_required";
        let message = "无人值守运行遇到需要批准的调用，已中止本次运行";
        self.session.stop_with(code, message);
        Some((code.to_string(), message.to_string()))
    }

    fn budget(&self, rounds: u32) -> BudgetVerdict {
        if rounds >= self.max_turns {
            return BudgetVerdict::Exhausted(StopReason::Rounds);
        }
        if self.max_tokens > 0 && self.spent_tokens >= self.max_tokens {
            return BudgetVerdict::Exhausted(StopReason::Tokens);
        }
        if self.elapsed_running() >= self.timeout {
            return BudgetVerdict::Exhausted(StopReason::Time);
        }
        BudgetVerdict::Continue
    }

    fn on_budget_exhausted(&mut self, reason: StopReason) {
        self.exhausted = Some(reason);
    }

    fn persist(&mut self, record: serde_json::Value) {
        self.session.jsonl().record(&record);
    }

    fn aborted(&self) -> bool {
        self.is_aborted_now()
    }

    fn vault_root(&self) -> &std::path::Path {
        &self.scope.root
    }

    fn ignore_policy(&self) -> &IgnorePolicy {
        &self.scope.policy
    }

    fn remember_approval(&mut self, tool: &str, subject: &str) {
        if self.namespace.is_none() {
            self.namespace = self
                .runtime
                .with_session(&self.scope, |parent| {
                    jsonl::JsonlWriter::session_id_from_path(parent.jsonl().path()).map(
                        |session_id| permission_cache::Namespace::new(self.scope.key(), session_id),
                    )
                })
                .ok()
                .flatten();
        }
        if let Some(namespace) = &self.namespace {
            permission_cache::remember(namespace, tool, subject);
        }
    }

    fn after_turn(&mut self, _user_text: &str) -> Option<super::title::TitleJob> {
        None
    }

    fn begin_compacted_session(&mut self, summary: &str) -> Result<(), CommandError> {
        // 子运行的压缩只压**内存态输入**：审计是一次运行的完整轨迹，不轮转文件
        // （design §7.5）。压缩调用自己的 usage 已在 `on_compact_usage` 计入段预算。
        self.session.jsonl().record(&serde_json::json!({
            "kind": "compact",
            "summary": summary,
        }));
        self.session.replace_input(vec![session::user_item(&format!(
            "（此前子运行上下文已压缩为摘要，接着摘要继续）\n{summary}"
        ))]);
        Ok(())
    }

    fn tool_allowed(&self, name: &str) -> bool {
        self.tool_policy.iter().any(|tool| tool == name)
    }

    fn request_permit(&self) -> Option<scheduler::RequestPermit> {
        Some(scheduler::acquire_provider_request(
            &self.config.provider,
            self.config.subagents.max_concurrent,
            RequestPriority::Child,
        ))
    }

    fn on_round(&mut self, round: u32) {
        self.rounds = round;
        let tool_calls: u32 = self.tool_calls.values().sum();
        if let Some(sink) = &self.parent_sink {
            sink.emit(events::subagent_progress(
                &self.run_id,
                self.segment,
                round,
                tool_calls,
                self.tool_calls.keys().next().map(String::as_str),
                self.elapsed_running().as_millis() as u64,
            ));
        }
    }

    fn on_round_usage(&mut self, usage: &UsageDelta) {
        self.spent_tokens = self
            .spent_tokens
            .saturating_add(usage.input_tokens)
            .saturating_add(usage.output_tokens);
        self.usage.input_tokens += usage.input_tokens;
        self.usage.cached_tokens += usage.cached_tokens;
        self.usage.output_tokens += usage.output_tokens;
        self.usage.cache_write_tokens += usage.cache_write_tokens;
    }

    fn on_compact_usage(&mut self, usage: &UsageDelta) {
        // 压缩 usage 计入段预算、但不进分桶（design §7.5）。
        self.spent_tokens = self
            .spent_tokens
            .saturating_add(usage.input_tokens)
            .saturating_add(usage.output_tokens);
    }

    fn on_llm_error(&mut self, error: &llm::TurnError) {
        self.last_error = Some(error.clone());
    }

    fn on_llm_error_recovered(&mut self) {
        self.last_error = None;
    }

    fn on_tool_result(&mut self, name: &str, result: &serde_json::Value) {
        *self.tool_calls.entry(name.to_string()).or_insert(0) += 1;
        match result["code"].as_str() {
            Some("permission_denied") | Some("approval_rejected") => {
                self.denials = self.denials.saturating_add(1)
            }
            _ => {}
        }
    }

    fn on_assistant_text(&mut self, text: &str) {
        if !text.is_empty() {
            self.last_text = Some(text.to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::Ordering;

    use serde_json::json;

    use super::*;
    use crate::config::{self, PermissionMode};

    /// 事件收集器（与 `event_sink` 的测试替身同形）。
    #[derive(Default)]
    struct CollectSink(Arc<Mutex<Vec<serde_json::Value>>>);

    impl EventSink for CollectSink {
        fn emit(&self, payload: serde_json::Value) {
            self.0
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(payload);
        }
    }

    impl CollectSink {
        fn events(&self) -> Vec<serde_json::Value> {
            self.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
        }
    }

    /// XDG 复原（断言失败 panic 也要复原，别污染同进程的别的用例）。
    struct XdgGuard(Option<std::ffi::OsString>);

    impl Drop for XdgGuard {
        fn drop(&mut self) {
            match &self.0 {
                Some(value) => std::env::set_var("XDG_CONFIG_HOME", value),
                None => std::env::remove_var("XDG_CONFIG_HOME"),
            }
        }
    }

    struct Fixture {
        root: PathBuf,
        scope: VaultScope,
        config: HarnessConfig,
        runtime: Runtime,
        sink: Arc<CollectSink>,
        /// 每个夹具**一个**中枢（与生产「一个父会话一个中枢」同构）：resume / 保留表
        /// 跨多次 `run_task` 才有意义；同时挂进 Session（停止广播经会话拿 hub）。
        hub: Arc<SubagentHub>,
        _xdg: XdgGuard,
        _lock: std::sync::MutexGuard<'static, ()>,
    }

    impl Fixture {
        fn new(tag: &str, script: &str, tweak: impl FnOnce(&mut HarnessConfig)) -> Self {
            // 先取进程级 XDG 锁、再改环境（drop 逆序：XDG 复原时仍持锁）。
            let lock = crate::harness::xdg_test_lock();
            let xdg_guard = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
            let root =
                std::env::temp_dir().join(format!("lumir-subagents-{}-{tag}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(&root).unwrap();
            std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));

            let vault = root.join("vault");
            std::fs::create_dir_all(&vault).unwrap();
            std::fs::write(vault.join("a.md"), "正文 A\n").unwrap();
            let fixture = root.join("mock.json");
            std::fs::write(&fixture, script).unwrap();

            let mut config = config::test_mock(Some(&fixture.display().to_string()));
            tweak(&mut config);

            let defaults = crate::config::VaultConfig::default();
            let scope = VaultScope {
                root: vault.clone(),
                policy: IgnorePolicy::load(&vault, &[".gitignore".to_string()], &defaults.ignore),
                vault_id: format!("vault-test-subagents-{tag}"),
            };
            let runtime = Runtime::default();
            runtime.acquire_turn(&scope, &config).unwrap();
            runtime.release_turn(&scope);
            let token = runtime
                .with_session(&scope, |session| session.subagent_token())
                .unwrap();
            let sink = Arc::new(CollectSink::default());
            let hub = Arc::new(SubagentHub::new(
                runtime.clone(),
                scope.clone(),
                config.clone(),
                token,
            ));
            hub.set_sink(Some(sink.clone()));
            // 与生产一致：中枢挂在父会话上（`Runtime::request_abort` 经会话直接广播停止）。
            let _ = runtime.with_session(&scope, |session| {
                session.ensure_subagent_hub(|| hub.clone())
            });

            Self {
                root,
                scope,
                config,
                runtime,
                sink,
                hub,
                _xdg: xdg_guard,
                _lock: lock,
            }
        }

        fn write_agent(&self, file: &str, body: &str) {
            let dir = self.scope.root.join(".lumir").join("agents");
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(file), body).unwrap();
        }

        fn research(&self, extra: &str) {
            self.write_agent(
                "research.md",
                &format!(
                    "---\nname: research\ndescription: 调研任务\ntools: [vault_read]\n{extra}---\n\n你是研究子代理。\n"
                ),
            );
        }

        fn catalog(&self) -> AgentCatalog {
            AgentCatalog::load(&self.scope.root, &self.config)
        }

        fn hub(&self) -> SubagentHub {
            (*self.hub).clone()
        }

        /// 模拟「应用重启」：同一父会话上的全新中枢（保留表为空）。
        fn fresh_hub(&self) -> SubagentHub {
            let token = self
                .runtime
                .with_session(&self.scope, |session| session.subagent_token())
                .unwrap();
            let hub = SubagentHub::new(
                self.runtime.clone(),
                self.scope.clone(),
                self.config.clone(),
                token,
            );
            hub.set_sink(Some(self.sink.clone()));
            hub
        }

        fn task_call(&self, args: serde_json::Value) -> llm::ToolCall {
            llm::ToolCall {
                call_id: "call-task".to_string(),
                name: "task".to_string(),
                arguments: args.to_string(),
            }
        }

        fn run_task(&self, args: serde_json::Value) -> serde_json::Value {
            let hub = self.hub();
            let handle = start_task(
                &hub,
                &self.config,
                &self.catalog(),
                &self.task_call(args),
                None,
            );
            handle.result_value()
        }

        fn run_task_with(&self, hub: &SubagentHub, args: serde_json::Value) -> serde_json::Value {
            start_task(
                hub,
                &self.config,
                &self.catalog(),
                &self.task_call(args),
                None,
            )
            .result_value()
        }

        fn events(&self, kind: &str) -> Vec<serde_json::Value> {
            self.sink
                .events()
                .into_iter()
                .filter(|event| event["type"].as_str() == Some(kind))
                .collect()
        }

        fn notice_inputs(&self) -> Vec<String> {
            self.runtime
                .with_session(&self.scope, |session| {
                    session
                        .input()
                        .iter()
                        .filter(|item| item["role"].as_str() == Some("user"))
                        .filter_map(|item| {
                            item["content"].as_array().and_then(|parts| {
                                parts.iter().find_map(|part| part["text"].as_str())
                            })
                        })
                        .filter(|text| text.contains(AUTO_NOTICE_MARKER))
                        .map(str::to_string)
                        .collect()
                })
                .unwrap()
        }

        fn audit_path(&self, run_id: &str) -> PathBuf {
            jsonl::vault_subruns_dir(&self.scope.vault_id)
                .unwrap()
                .join(format!("{run_id}.jsonl"))
        }

        fn wait(&self, timeout: Duration, mut f: impl FnMut() -> bool) -> bool {
            let start = Instant::now();
            while start.elapsed() < timeout {
                if f() {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            f()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn args(agent: &str, prompt: &str) -> serde_json::Value {
        json!({"agent": agent, "prompt": prompt, "description": "一句话任务"})
    }

    /// `enabled=false`：调用回 `disabled`（工具本不该注册，历史 / 幻觉仍可能到达）。
    #[test]
    fn disabled_subagents_reject_the_call() {
        let f = Fixture::new("disabled", r#"{"responses":[{"text":"x"}]}"#, |config| {
            config.subagents.enabled = false;
        });
        f.research("");
        let out = f.run_task(args("research", "做点什么"));
        assert_eq!(out["ok"], json!(false));
        assert_eq!(out["code"], "disabled");
    }

    /// 参数校验的闭集合错误码：agent_not_found / empty_prompt / model_not_configured。
    #[test]
    fn task_argument_validation_uses_the_closed_error_set() {
        let f = Fixture::new("validation", r#"{"responses":[]}"#, |_| {});
        f.research("");
        let out = f.run_task(args("missing", "做点什么"));
        assert_eq!(out["code"], "agent_not_found");
        assert!(out["message"].as_str().unwrap().contains("research"));
        let out = f.run_task(args("research", "   "));
        assert_eq!(out["code"], "empty_prompt");
        drop(f);

        // 调用级模型非法 ⇒ model_not_configured（真实 provider 才有模型清单）。
        let f = Fixture::new("validation-model", r#"{"responses":[]}"#, |config| {
            *config = config::test_harness(
                "kimi",
                config::test_provider(
                    config::ProviderPreset::Kimi,
                    "test-key",
                    &[("model-a", false, false, 100_000)],
                ),
            );
        });
        f.research("");
        let mut call = args("research", "做点什么");
        call["model"] = json!("not-configured");
        let out = f.run_task(call);
        assert_eq!(out["code"], "model_not_configured");

        let mut call = args("research", "做点什么");
        call["background"] = json!("yes");
        let out = f.run_task(call);
        assert_eq!(out["code"], "tool_args_invalid");
    }

    /// 完成信封：status / agent / run_id / resumable / model / summary / usage / rounds。
    #[test]
    fn foreground_completed_envelope_and_summary() {
        let f = Fixture::new(
            "completed",
            r#"{"responses":[{"text":"结论 A","usage":{"input_tokens":10,"cached_tokens":2,"output_tokens":3}}]}"#,
            |_| {},
        );
        f.research("");
        let out = f.run_task(args("research", "做点什么"));
        assert_eq!(out["ok"], json!(true), "{out}");
        assert_eq!(out["status"], "completed");
        assert_eq!(out["agent"], "research");
        assert_eq!(out["resumable"], json!(true));
        assert_eq!(out["segment"], 1);
        assert_eq!(out["summary"], "结论 A");
        assert_eq!(out["usage"]["input_tokens"], 10);
        assert_eq!(out["usage"]["cached_tokens"], 2);
        assert_eq!(out["usage"]["output_tokens"], 3);
        assert_eq!(out["rounds"], 1);
        assert!(out["run_id"].as_str().unwrap().starts_with("r-"));
        assert_eq!(f.events("subagent_finished").len(), 1);
        assert_eq!(f.events("subagent_finished")[0]["status"], "completed");
        // 父会话侧记账：按模型分桶 + subrun sidecar（M589 会在此基础上补恢复重算）。
        let sidecar = f
            .runtime
            .with_session(&f.scope, |session| session.jsonl().path().to_path_buf())
            .unwrap();
        let _ = sidecar;
        let usage = f
            .runtime
            .with_session(&f.scope, |session| session.subrun_usage().clone())
            .unwrap();
        assert_eq!(usage.values().map(|bucket| bucket.segments).sum::<u64>(), 1);
    }

    /// 摘要 8,000 字符上限：头尾保留 + 显式 `…[截断]` + `truncated: true`。
    #[test]
    fn long_summary_is_truncated_with_a_marker() {
        let long = "长".repeat(9_000);
        let script = serde_json::json!({
            "responses": [{"text": long}],
        })
        .to_string();
        let f = Fixture::new("truncate", &script, |_| {});
        f.research("");
        let out = f.run_task(args("research", "做点什么"));
        assert_eq!(out["truncated"], json!(true));
        let summary = out["summary"].as_str().unwrap();
        let preview: String = summary.chars().take(20).collect();
        assert!(summary.contains("…[截断]…"), "{preview}");
        assert!(summary.starts_with('长') && summary.ends_with('长'));
        assert!(summary.chars().count() < 9_000);
    }

    /// 后台启动：立即返回 `status=running`，父线程不等待；拿到并发许可。
    #[test]
    fn background_start_returns_running_without_waiting() {
        let f = Fixture::new(
            "background",
            r#"{"responses":[{"text":"后台完成","delay_ms":400}]}"#,
            |_| {},
        );
        f.research("");
        let hub = f.hub();
        let started = Instant::now();
        let out = f.run_task_with(&hub, {
            let mut call = args("research", "做点什么");
            call["background"] = json!(true);
            call
        });
        assert!(
            started.elapsed() < Duration::from_millis(250),
            "后台启动不得等待运行结束：{:?}",
            started.elapsed()
        );
        assert_eq!(out["status"], "running", "{out}");
        assert_eq!(out["background"], json!(true));
        assert_eq!(out["segment"], 1);
        let run_id = out["run_id"].as_str().unwrap().to_string();
        assert!(f.wait(Duration::from_secs(3), || {
            !hub.inner
                .runs
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .contains_key(&run_id)
        }));
        // 收敛后进入保留表（后台 completed 可 resume），并投递一条通知。
        assert_eq!(hub.retained_count(), 1);
        assert!(f.wait(Duration::from_secs(2), || {
            !hub.inner
                .wake
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .pending
                .is_empty()
                || !f.notice_inputs().is_empty()
        }));
    }

    /// 并发闸：`max_concurrent=1` 时第二个后台调用 `concurrency_limit`（不排队）。
    #[test]
    fn background_concurrency_limit_is_reported() {
        let f = Fixture::new(
            "concurrency",
            r#"{"responses":[{"text":"慢","delay_ms":400}]}"#,
            |config| config.subagents.max_concurrent = 1,
        );
        f.research("");
        let hub = f.hub();
        let mut call = args("research", "第一个");
        call["background"] = json!(true);
        let first = f.run_task_with(&hub, call);
        assert_eq!(first["status"], "running");
        let mut second = args("research", "第二个");
        second["background"] = json!(true);
        let rejected = f.run_task_with(&hub, second);
        assert_eq!(rejected["code"], "concurrency_limit", "{rejected}");
    }

    /// 次数闸：只计实际执行的段——被拒（agent_not_found）不占额度。
    #[test]
    fn subrun_limit_counts_only_executed_segments() {
        let f = Fixture::new(
            "subrun-limit",
            r#"{"responses":[{"text":"好"}]}"#,
            |config| config.subagents.max_subruns_per_turn = 1,
        );
        f.research("");
        let hub = f.hub();
        let rejected = f.run_task_with(&hub, args("missing", "被拒"));
        assert_eq!(rejected["code"], "agent_not_found");
        let out = f.run_task_with(&hub, args("research", "第一个"));
        assert_eq!(out["status"], "completed", "{out}");
        let out = f.run_task_with(&hub, args("research", "第二个"));
        assert_eq!(out["code"], "subrun_limit", "{out}");
    }

    /// 三重闸：max_turns / max_tokens / timeout_secs 分别触顶 ⇒ partial + 正确 stopped_by。
    #[test]
    fn three_budgets_stop_with_the_right_reason() {
        // 轮次：max_turns=1，且本轮仍有工具调用（否则「一轮就答完」是正常完成，不是触顶）。
        let f = Fixture::new(
            "gate-rounds",
            r#"{"responses":[{"text":"只有一轮","usage":{"input_tokens":1,"output_tokens":1},
                "tool_calls":[{"id":"c1","name":"vault_read","arguments":"{\"path\":\"a.md\"}"}]}]}"#,
            |config| config.subagents.max_turns = 1,
        );
        f.research("max_turns: 1\n");
        let out = f.run_task(args("research", "做点什么"));
        assert_eq!(out["status"], "partial", "{out}");
        assert_eq!(out["stopped_by"], "rounds");
        drop(f);

        // token：预算 100，单次 response 报 200 input。
        let f = Fixture::new(
            "gate-tokens",
            r#"{"responses":[{"text":"花了太多","usage":{"input_tokens":200,"output_tokens":10}}]}"#,
            |config| config.subagents.max_tokens = 100,
        );
        f.research("max_tokens: 100\n");
        let out = f.run_task(args("research", "做点什么"));
        assert_eq!(out["status"], "partial", "{out}");
        assert_eq!(out["stopped_by"], "tokens");
        drop(f);

        // 时间：timeout 1 秒，响应延迟 1.1 秒。
        let f = Fixture::new(
            "gate-time",
            r#"{"responses":[{"text":"太慢","delay_ms":1100,"usage":{"input_tokens":1,"output_tokens":1}}]}"#,
            |config| config.subagents.timeout_secs = 1,
        );
        f.research("timeout_secs: 1\n");
        let out = f.run_task(args("research", "做点什么"));
        assert_eq!(out["status"], "partial", "{out}");
        assert_eq!(out["stopped_by"], "time");
        assert_eq!(out["summary"], "太慢", "已有产出不丢");
    }

    /// 上下文溢出与压缩边界（design §7.5）：沿用「压缩后重试一次」；压缩只压子会话的
    /// 内存态输入、不轮转审计文件；压缩 usage 计入段预算但不进模型桶。
    #[test]
    fn context_overflow_compacts_and_retries_once() {
        let f = Fixture::new(
            "context-overflow",
            r#"{"responses":[
                {"error":{"code":"context_length_exceeded","message":"maximum context length exceeded"}},
                {"text":"压缩摘要","usage":{"input_tokens":50,"output_tokens":5}},
                {"text":"压缩后完成","usage":{"input_tokens":10,"output_tokens":3}}
            ]}"#,
            |config| {
                config.auto_compact = true;
                config.subagents.max_tokens = 100_000;
            },
        );
        f.research("");
        let out = f.run_task(args("research", "做点什么"));
        assert_eq!(out["status"], "completed", "{out}");
        assert_eq!(out["summary"], "压缩后完成");
        assert_eq!(
            out["usage"]["input_tokens"], 10,
            "压缩调用的 usage 不进模型桶：{out}"
        );
        let run_id = out["run_id"].as_str().unwrap();
        let audit = std::fs::read_to_string(f.audit_path(run_id)).unwrap();
        assert!(audit.contains("\"kind\":\"compact\""), "{audit}");
        // 审计不轮转：整条运行仍在一个文件里（run_open 只出现一次）。
        assert_eq!(audit.matches("run_open").count(), 1, "{audit}");
    }

    /// API 错误语义：有文本 ⇒ partial + stopped_by=error；无文本 ⇒ failed；
    /// 配额 ⇒ partial + stopped_by=quota（不自动重试）。
    #[test]
    fn api_error_and_quota_semantics() {
        let tool_then_error = |code: &str, message: &str| {
            serde_json::json!({
                "responses": [
                    {"text": "部分产出", "tool_calls": [
                        {"id": "c1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}
                    ]},
                    {"error": {"code": code, "message": message}},
                ]
            })
            .to_string()
        };

        let f = Fixture::new(
            "error-partial",
            &tool_then_error("server_error", "boom"),
            |_| {},
        );
        f.research("");
        let out = f.run_task(args("research", "做点什么"));
        assert_eq!(out["status"], "partial", "{out}");
        assert_eq!(out["stopped_by"], "error");
        assert_eq!(out["summary"], "部分产出");
        drop(f);

        let f = Fixture::new(
            "quota",
            &tool_then_error("rate_limit_exceeded", "quota exhausted"),
            |_| {},
        );
        f.research("");
        let out = f.run_task(args("research", "做点什么"));
        assert_eq!(out["status"], "partial", "{out}");
        assert_eq!(out["stopped_by"], "quota");
        // 不自动重试：只弹了两条脚本（工具轮 + 错误轮）。
        assert_eq!(out["rounds"], 2, "配额错误后不得追加请求：{out}");
        drop(f);

        let f = Fixture::new(
            "failed",
            r#"{"responses":[{"error":{"code":"server_error","message":"boom"}}]}"#,
            |_| {},
        );
        f.research("");
        let out = f.run_task(args("research", "做点什么"));
        assert_eq!(out["ok"], json!(false), "{out}");
        assert_eq!(out["code"], "server_error");
    }

    /// 执行层白名单二次校验：定义只授予 vault_read 时，模型幻觉出的 vault_delete 被拒、
    /// 文件不动，子运行继续跑完。
    #[test]
    fn undeclared_tool_is_rejected_at_execution() {
        let f = Fixture::new(
            "whitelist",
            r#"{"responses":[
                {"tool_calls": [{"id":"c1","name":"vault_delete","arguments":"{\"path\":\"a.md\"}"}]},
                {"text":"不用删"}
            ]}"#,
            |_| {},
        );
        f.research("");
        let out = f.run_task(args("research", "试试删文件"));
        assert_eq!(out["status"], "completed", "{out}");
        assert!(f.scope.root.join("a.md").exists(), "未声明工具不得执行");
        let run_id = out["run_id"].as_str().unwrap();
        let audit = std::fs::read_to_string(f.audit_path(run_id)).unwrap();
        assert!(audit.contains("tool_not_allowed"), "{audit}");
    }

    /// resume：同 run / segment=2 / 审计同文件追加 / 可完成；agent 不匹配与运行中被拒。
    #[test]
    fn resume_continues_the_same_subrun() {
        let f = Fixture::new(
            "resume",
            r#"{"responses":[
                {"text":"第一段","tool_calls":[{"id":"c1","name":"vault_read","arguments":"{\"path\":\"a.md\"}"}]},
                {"text":"第二段"}
            ]}"#,
            |config| config.subagents.max_turns = 1,
        );
        f.research("max_turns: 1\n");
        let first = f.run_task(args("research", "做点什么"));
        assert_eq!(first["status"], "partial");
        let run_id = first["run_id"].as_str().unwrap().to_string();
        let mut resume = args("research", "继续");
        resume["resume"] = json!(run_id.clone());
        let second = f.run_task(resume.clone());
        assert_eq!(second["status"], "completed", "{second}");
        assert_eq!(second["run_id"], json!(run_id));
        assert_eq!(second["segment"], 2, "resume 段号递增：{second}");
        let audit = f.audit_path(&run_id);
        let lines = std::fs::read_to_string(&audit).unwrap();
        assert!(lines.contains("run_open"), "首段写 run_open");
        assert!(lines.contains("run_segment"), "resume 段写 run_segment");
        assert!(lines.contains("\"segment\":2"), "审计里应有 segment=2");

        // agent 不匹配。
        f.write_agent(
            "reviewer.md",
            "---\nname: reviewer\ndescription: 复核\ntools: [vault_read]\n---\n正文\n",
        );
        let mut mismatch = args("reviewer", "换个身份");
        mismatch["resume"] = json!(run_id.clone());
        let out = f.run_task(mismatch);
        assert_eq!(out["code"], "agent_mismatch", "{out}");

        // 重启等价：保留表是内存态；新的中枢（模拟应用重启）里同一 run_id 不可恢复。
        let restarted = f.fresh_hub();
        let mut after_restart = args("research", "重启后续跑");
        after_restart["resume"] = json!(run_id);
        let out = f.run_task_with(&restarted, after_restart);
        assert_eq!(out["code"], "run_not_resumable", "{out}");
    }

    /// 运行中的 run 不能 resume（`run_busy`）；保留表 LRU 淘汰后 `run_not_resumable`。
    #[test]
    fn resume_busy_and_eviction_boundaries() {
        let f = Fixture::new(
            "resume-boundaries",
            r#"{"responses":[
                {"text":"后台","delay_ms":500},
                {"text":"一"},{"text":"二"},{"text":"三"},{"text":"四"}
            ]}"#,
            |_| {},
        );
        f.research("");
        let hub = f.hub();
        let mut call = args("research", "后台跑");
        call["background"] = json!(true);
        let running = f.run_task_with(&hub, call);
        let run_id = running["run_id"].as_str().unwrap().to_string();
        let mut resume = args("research", "续跑");
        resume["resume"] = json!(run_id.clone());
        let out = f.run_task_with(&hub, resume);
        assert_eq!(out["code"], "run_busy", "{out}");
        assert!(f.wait(Duration::from_secs(3), || hub.retained_count() == 1));

        // 再跑四个 completed：LRU 上限 4，最早收敛的后台 run 被淘汰。
        for _ in 0..4 {
            let out = f.run_task_with(&hub, args("research", "填充"));
            assert_eq!(out["status"], "completed", "{out}");
        }
        assert_eq!(hub.retained_count(), MAX_RETAINED_RUNS);
        let mut evicted = args("research", "续跑");
        evicted["resume"] = json!(run_id);
        let out = f.run_task_with(&hub, evicted);
        assert_eq!(out["code"], "run_not_resumable", "{out}");
    }

    /// 批准透传：卡带 `source.agent`；批准 ⇒ 文件删除；拒绝 ⇒ approval_rejected、
    /// denied_calls=1、文件未删、子运行继续完成。
    #[test]
    fn approval_is_passed_through_and_denial_keeps_the_run_going() {
        let f = Fixture::new(
            "approval",
            r#"{"responses":[
                {"tool_calls":[{"id":"c1","name":"vault_delete","arguments":"{\"path\":\"a.md\"}"}]},
                {"text":"处理完毕"}
            ]}"#,
            |config| config.permission_mode = PermissionMode::VaultWrite,
        );
        f.write_agent(
            "deleter.md",
            "---\nname: deleter\ndescription: 删文件\ntools: [vault_delete]\n---\n正文\n",
        );
        let hub = f.hub();
        let call = f.task_call(args("deleter", "删掉 a.md"));
        let handle = start_task(&hub, &f.config, &f.catalog(), &call, None);
        let request = f
            .wait(Duration::from_secs(3), || {
                !f.runtime
                    .snapshot(&f.scope, &f.config)
                    .pending_approvals
                    .is_empty()
            })
            .then(|| f.runtime.snapshot(&f.scope, &f.config).pending_approvals[0].clone())
            .expect("子运行的批准请求应透传到父会话");
        assert_eq!(request.tool, "vault_delete");
        match &request.source {
            ApprovalSource::Subrun { agent, run_id, .. } => {
                assert_eq!(agent, "deleter");
                assert!(run_id.starts_with("r-"));
            }
            ApprovalSource::Interactive => panic!("子运行的卡不得标成交互来源"),
        }
        let event = f
            .events("approval_request")
            .into_iter()
            .next()
            .expect("批准卡事件");
        assert_eq!(event["source"]["kind"], "subrun");
        assert_eq!(event["source"]["agent"], "deleter");

        // 拒绝：文件保留、子运行继续完成。
        f.runtime
            .with_session(&f.scope, |session| {
                session.resolve_approval(&request.id, false, Some("先别删".into()), false, false)
            })
            .unwrap()
            .unwrap();
        let out = handle.result_value();
        assert_eq!(out["status"], "completed", "{out}");
        assert_eq!(out["denied_calls"], 1);
        assert!(f.scope.root.join("a.md").exists(), "拒绝后文件不得删除");
        let finished = f.events("subagent_finished");
        assert_eq!(finished[0]["denied_calls"], 1);
    }

    /// 审批等待不计入时间闸：timeout 1 秒、等批准 1.3 秒，子运行仍能完成（不判 time）。
    #[test]
    fn approval_wait_does_not_count_against_the_time_budget() {
        let f = Fixture::new(
            "approval-time",
            r#"{"responses":[
                {"tool_calls":[{"id":"c1","name":"vault_delete","arguments":"{\"path\":\"a.md\"}"}]},
                {"text":"删除完成"}
            ]}"#,
            |config| {
                config.permission_mode = PermissionMode::VaultWrite;
                config.subagents.timeout_secs = 1;
            },
        );
        f.write_agent(
            "deleter.md",
            "---\nname: deleter\ndescription: 删文件\ntools: [vault_delete]\ntimeout_secs: 1\n---\n正文\n",
        );
        let hub = f.hub();
        let handle = start_task(
            &hub,
            &f.config,
            &f.catalog(),
            &f.task_call(args("deleter", "删掉 a.md")),
            None,
        );
        let id = f
            .wait(Duration::from_secs(3), || {
                !f.runtime
                    .snapshot(&f.scope, &f.config)
                    .pending_approvals
                    .is_empty()
            })
            .then(|| {
                f.runtime.snapshot(&f.scope, &f.config).pending_approvals[0]
                    .id
                    .clone()
            })
            .expect("应有待批项");
        std::thread::sleep(Duration::from_millis(1300));
        f.runtime
            .with_session(&f.scope, |session| {
                session.resolve_approval(&id, true, None, false, false)
            })
            .unwrap()
            .unwrap();
        let out = handle.result_value();
        assert_eq!(out["status"], "completed", "{out}");
        assert!(!f.scope.root.join("a.md").exists());
    }

    /// 自动唤醒：空闲时一条后台结果 ⇒ 一个自动回合（`wake=auto_turn`、chain_index=1），
    /// 回合输入是带 `auto_notice` 标记的 user 消息。
    #[test]
    fn idle_background_result_wakes_one_parent_turn() {
        let f = Fixture::new(
            "wake-idle",
            r#"{"responses":[{"text":"收到通知"}]}"#,
            |_| {},
        );
        f.research("");
        let hub = f.hub();
        hub.on_background_finished(NoticeRun {
            run_id: "r-test-1".into(),
            agent: "research".into(),
            description: "调研任务".into(),
            status: "completed".into(),
            stopped_by: None,
            summary: "结论".into(),
        });
        // 合并窗口不真等 2 秒：直接把截止时刻拨到过去（状态机逻辑与窗口时长解耦）。
        hub.inner.wake.lock().unwrap().deadline = Some(Instant::now() - Duration::from_millis(1));
        process_wake(&hub.inner);

        assert!(f.wait(Duration::from_secs(3), || {
            f.runtime
                .with_session(&f.scope, |session| {
                    session.input().iter().any(|item| {
                        item["role"].as_str() == Some("assistant")
                            && item["content"].as_array().is_some_and(|parts| {
                                parts
                                    .iter()
                                    .any(|part| part["text"].as_str() == Some("收到通知"))
                            })
                    })
                })
                .unwrap_or(false)
        }));
        assert_eq!(hub.wake_snapshot().chain, 1);
        assert_eq!(f.notice_inputs().len(), 1, "通知是回合输入");
        let notified = f.events("subagent_notified");
        assert_eq!(notified.len(), 1);
        assert_eq!(notified[0]["wake"], "auto_turn");
        assert_eq!(notified[0]["chain_index"], 1);
    }

    /// 正忙时两个后台结果合并为**一个**自动回合（输入只有一条通知，含两个 run）。
    #[test]
    fn busy_background_results_merge_into_one_turn() {
        let f = Fixture::new(
            "wake-merge",
            r#"{"responses":[{"text":"合并回合"}]}"#,
            |_| {},
        );
        f.research("");
        let hub = f.hub();
        // 用户回合在飞。
        f.runtime.acquire_turn(&f.scope, &f.config).unwrap();
        for run in ["r-merge-1", "r-merge-2"] {
            hub.on_background_finished(NoticeRun {
                run_id: run.into(),
                agent: "research".into(),
                description: format!("任务 {run}"),
                status: "completed".into(),
                stopped_by: None,
                summary: "结论".into(),
            });
        }
        hub.inner.wake.lock().unwrap().deadline = Some(Instant::now() - Duration::from_millis(1));
        process_wake(&hub.inner);
        assert!(f.notice_inputs().is_empty(), "用户回合进行中不得改写上下文");
        f.runtime.release_turn(&f.scope);
        // 空闲监视线程会送 ParentIdle；稍等它把回合跑完。
        assert!(f.wait(Duration::from_secs(4), || {
            hub.wake_snapshot().chain == 1
                && !f
                    .runtime
                    .with_session(&f.scope, |session| session.is_busy())
                    .unwrap()
        }));
        let notices = f.notice_inputs();
        assert_eq!(notices.len(), 1, "两条通知合并为一条消息：{notices:?}");
        assert!(notices[0].contains("r-merge-1") || notices[0].contains("任务 r-merge-1"));
        assert!(notices[0].contains("任务 r-merge-2"));
        assert_eq!(
            f.events("subagent_notified")
                .iter()
                .filter(|event| event["wake"] == "auto_turn")
                .count(),
            2,
            "同一批的两个 run 各出一条 notified，但只起一个回合"
        );
    }

    /// 五个连续自动回合：每个 run 的 `subagent_notified` 恰一条、`chain_index` 是它进入的
    /// 回合序号，且中枢的诊断出口**不随回合**再套一层。
    ///
    /// 后者是 M601 的回归锚：真机 203（`.local/acceptance/2026-10-18-m590/observability/
    /// 203.jsonl`）里 run_i 的每条 `subagent_*` 诊断行都出现 i 次（started / progress /
    /// finished / notified 同样重复、同 ts 相邻），原因是自动回合把中枢自己的导出（已包一层
    /// [`DiagnosticSink`]）原样传回 [`SubagentHub::set_sink`]，无条件再包一层——第 i 个回合的
    /// 事件经过 i 层包装，每层各写一条诊断日志。面板不受影响（每层只转发一次），所以只断言
    /// 面板事件的用例看不见这个回归；这里同时钉住出口指针。
    #[test]
    fn five_chained_auto_turns_emit_one_notified_per_run() {
        let f = Fixture::new(
            "wake-five",
            r#"{"responses":[
                {"text":"回合 1"},
                {"text":"回合 2"},
                {"text":"回合 3"},
                {"text":"回合 4"},
                {"text":"回合 5"}
            ]}"#,
            |_| {},
        );
        f.research("");
        let hub = f.hub();
        let export = hub
            .inner
            .sink
            .lock()
            .unwrap()
            .clone()
            .expect("夹具已装配出口");
        for round in 1..=5u32 {
            hub.on_background_finished(NoticeRun {
                run_id: format!("r-chain-{round}"),
                agent: "research".into(),
                description: format!("链 {round}"),
                status: "completed".into(),
                stopped_by: None,
                summary: "结论".into(),
            });
            hub.inner.wake.lock().unwrap().deadline =
                Some(Instant::now() - Duration::from_millis(1));
            process_wake(&hub.inner);
            assert!(
                f.wait(Duration::from_secs(4), || {
                    hub.wake_snapshot().chain == round && !hub.inner.wake.lock().unwrap().running
                }),
                "第 {round} 个自动回合没跑完"
            );
            assert!(
                Arc::ptr_eq(
                    &export,
                    &hub.inner
                        .sink
                        .lock()
                        .unwrap()
                        .clone()
                        .expect("出口不得被清空")
                ),
                "自动回合给诊断出口又套了一层（第 {round} 回合），诊断日志会按回合数重复"
            );
        }
        let notified = f.events("subagent_notified");
        for round in 1..=5u32 {
            let run_id = format!("r-chain-{round}");
            let mine: Vec<&serde_json::Value> = notified
                .iter()
                .filter(|event| event["run_id"] == run_id.as_str())
                .collect();
            assert_eq!(mine.len(), 1, "{run_id} 的 notified 应恰一条：{mine:?}");
            assert_eq!(mine[0]["wake"], "auto_turn");
            assert_eq!(mine[0]["chain_index"], json!(round));
        }
    }

    /// 出口装配的幂等只针对同一个 Arc：重复装配本方导出不再套层，换一个 sink 照常替换
    /// （防止把「幂等」做成「首次装配后不再更新」——用户回合每轮给的是新 sink）。
    #[test]
    fn set_sink_is_idempotent_only_for_the_same_export() {
        let f = Fixture::new("set-sink", r#"{"responses":[]}"#, |_| {});
        let hub = f.hub();
        let export = hub
            .inner
            .sink
            .lock()
            .unwrap()
            .clone()
            .expect("夹具已装配出口");
        hub.set_sink(Some(export.clone()));
        assert!(
            Arc::ptr_eq(
                &export,
                &hub.inner
                    .sink
                    .lock()
                    .unwrap()
                    .clone()
                    .expect("出口不得被清空")
            ),
            "同一导出重复装配必须保持原样（不得再包一层）"
        );
        hub.set_sink(Some(Arc::new(CollectSink::default())));
        assert!(
            !Arc::ptr_eq(
                &export,
                &hub.inner
                    .sink
                    .lock()
                    .unwrap()
                    .clone()
                    .expect("新 sink 已被装配")
            ),
            "换一个 sink 必须替换出口"
        );
        hub.set_sink(None);
        assert!(
            hub.inner.sink.lock().unwrap().is_none(),
            "None 必须清空出口"
        );
    }

    /// 链闸：5 个连续自动回合后第 6 条通知不起回合（blocked_chain），通知照常上屏；
    /// 用户回合开始清空链计数。
    #[test]
    fn chain_limit_blocks_the_sixth_wake() {
        let f = Fixture::new(
            "wake-chain",
            r#"{"responses":[{"text":"不应被请求"}]}"#,
            |_| {},
        );
        f.research("");
        let hub = f.hub();
        hub.inner.wake.lock().unwrap().chain = AUTO_WAKE_CHAIN_MAX;
        hub.on_background_finished(NoticeRun {
            run_id: "r-six".into(),
            agent: "research".into(),
            description: "第六条".into(),
            status: "completed".into(),
            stopped_by: None,
            summary: "结论".into(),
        });
        hub.inner.wake.lock().unwrap().deadline = Some(Instant::now() - Duration::from_millis(1));
        process_wake(&hub.inner);
        let snapshot = hub.wake_snapshot();
        assert_eq!(snapshot.blocked, Some("chain_limit"));
        assert_eq!(snapshot.chain, AUTO_WAKE_CHAIN_MAX);
        assert_eq!(f.notice_inputs().len(), 1, "触顶时通知照常上屏");
        assert_eq!(f.events("subagent_notified")[0]["wake"], "blocked_chain");
        assert!(
            !f.runtime
                .with_session(&f.scope, |session| session.is_busy())
                .unwrap(),
            "触顶不得起回合"
        );
        assert_eq!(
            hub.inner.wake.lock().unwrap().pending.len(),
            1,
            "触顶时 pending 保留（「继续」要据此起回合）"
        );

        // 用户发言 = 一次用户回合开始：链清零、blocked 清空；已上屏的通知不重复入历史。
        assert!(hub.begin_user_turn().is_none(), "已上屏的通知不得再插一遍");
        let snapshot = hub.wake_snapshot();
        assert_eq!(snapshot.chain, 0);
        assert_eq!(snapshot.blocked, None);
        assert_eq!(f.notice_inputs().len(), 1);
        assert!(hub.inner.wake.lock().unwrap().pending.is_empty());
    }

    /// 链触顶 → 面板「继续」：立即按保留的 pending 起一个回合，通知不重复入历史。
    #[test]
    fn continue_after_chain_limit_starts_a_turn_without_duplicating_the_notice() {
        let f = Fixture::new(
            "wake-continue",
            r#"{"responses":[{"text":"继续后的回复"}]}"#,
            |_| {},
        );
        f.research("");
        let hub = f.hub();
        hub.inner.wake.lock().unwrap().chain = AUTO_WAKE_CHAIN_MAX;
        hub.on_background_finished(NoticeRun {
            run_id: "r-continue".into(),
            agent: "research".into(),
            description: "触顶后继续".into(),
            status: "completed".into(),
            stopped_by: None,
            summary: "结论".into(),
        });
        hub.inner.wake.lock().unwrap().deadline = Some(Instant::now() - Duration::from_millis(1));
        process_wake(&hub.inner);
        assert_eq!(hub.wake_snapshot().blocked, Some("chain_limit"));
        assert_eq!(f.notice_inputs().len(), 1);

        hub.continue_wake();
        assert!(f.wait(Duration::from_secs(3), || {
            f.runtime
                .with_session(&f.scope, |session| {
                    !session.is_busy()
                        && session.input().iter().any(|item| {
                            item["role"].as_str() == Some("assistant")
                                && item["content"].as_array().is_some_and(|parts| {
                                    parts
                                        .iter()
                                        .any(|part| part["text"].as_str() == Some("继续后的回复"))
                                })
                        })
                })
                .unwrap_or(false)
        }));
        assert_eq!(
            hub.wake_snapshot().chain,
            1,
            "继续起的是一个新链的第 1 回合"
        );
        assert_eq!(hub.wake_snapshot().blocked, None);
        assert_eq!(f.notice_inputs().len(), 1, "通知不得重复入历史");
        assert!(hub.inner.wake.lock().unwrap().pending.is_empty());
    }

    /// design §12.6.1：无人值守槽位不参与唤醒与链计数；且中枢不持强 Runtime 引用——
    /// isolated Runtime 结束后整个 hub 可回收（评审 r1 P1-1）。
    #[test]
    fn isolated_slot_does_not_wake_and_the_hub_is_reclaimable() {
        let f = Fixture::new("isolated", r#"{"responses":[]}"#, |_| {});
        let runtime = Runtime::isolated();
        runtime.acquire_turn(&f.scope, &f.config).unwrap();
        let ctx =
            super::super::run::SessionContext::new(&super::NullSink, &runtime, &f.scope, &f.config);
        let hub = runtime
            .with_session(&f.scope, |session| session.subagent_hub())
            .unwrap()
            .expect("SessionContext 应建立 hub");
        let weak = Arc::downgrade(&hub);
        hub.on_background_finished(NoticeRun {
            run_id: "r-cron".into(),
            agent: "research".into(),
            description: "cron 的后台任务".into(),
            status: "completed".into(),
            stopped_by: None,
            summary: "结论".into(),
        });
        let wake = hub.inner.wake.lock().unwrap();
        assert!(wake.pending.is_empty(), "cron 槽位不排通知");
        assert!(!wake.running, "cron 槽位不起自动回合");
        drop(wake);
        assert!(f.notice_inputs().is_empty());

        // isolated 运行实例结束后：没有引用环，hub 随会话一起回收。
        drop(hub);
        drop(ctx);
        runtime.release_turn(&f.scope);
        drop(runtime);
        assert!(
            f.wait(Duration::from_secs(2), || weak.upgrade().is_none()),
            "hub 应可回收（Runtime ↔ Session ↔ Hub 引用环已断）"
        );
    }

    /// 起回合分支的原子语义（评审 r2 P1-1 路径 A）：acquire 失败时本批通知原样放回
    /// pending、**不预标 delivered**，后续自动回合仍能把它投递出去。
    #[test]
    fn acquire_failure_keeps_the_notice_for_a_later_turn() {
        let f = Fixture::new(
            "wake-acquire-fail",
            r#"{"responses":[{"text":"补上的自动回合"}]}"#,
            |_| {},
        );
        f.research("");
        let hub = f.hub();
        {
            let mut wake = hub.inner.wake.lock().unwrap();
            wake.pending.push(NoticeRun {
                run_id: "r-acq".into(),
                agent: "research".into(),
                description: "acquire 失败的通知".into(),
                status: "completed".into(),
                stopped_by: None,
                summary: "结论".into(),
            });
            wake.batch = Some("wb-acq".into());
            wake.deadline = Some(Instant::now() - Duration::from_millis(1));
        }
        FAIL_NEXT_WAKE_ACQUIRE.store(true, Ordering::SeqCst);
        process_wake(&hub.inner);
        {
            let wake = hub.inner.wake.lock().unwrap();
            assert_eq!(wake.pending.len(), 1, "失败必须原样放回");
            assert!(wake.delivered.is_empty(), "未插入历史不得预标 delivered");
            assert!(!wake.running);
            assert_eq!(wake.chain, 0, "未起回合不得推进链");
        }
        assert!(f.notice_inputs().is_empty(), "失败路径不得写历史");
        assert!(
            !f.runtime
                .with_session(&f.scope, |session| session.is_busy())
                .unwrap(),
            "acquire 失败不得留下 busy"
        );

        // 之后的一轮唤醒照常投递（force 跳过合并窗口）。
        hub.inner.wake.lock().unwrap().force = true;
        process_wake(&hub.inner);
        assert!(f.wait(Duration::from_secs(3), || {
            f.runtime
                .with_session(&f.scope, |session| {
                    !session.is_busy()
                        && session.input().iter().any(|item| {
                            item["role"].as_str() == Some("assistant")
                                && item["content"].as_array().is_some_and(|parts| {
                                    parts
                                        .iter()
                                        .any(|part| part["text"].as_str() == Some("补上的自动回合"))
                                })
                        })
                })
                .unwrap_or(false)
        }));
        assert_eq!(hub.wake_snapshot().chain, 1);
        assert_eq!(f.notice_inputs().len(), 1, "通知最终只有一条");
        assert!(hub.inner.wake.lock().unwrap().pending.is_empty());
    }

    /// 起回合窗口内新到的后台完成不得被清场（评审 r2 P1-1 路径 B）：钩住「插入之后、
    /// 起线程之前」注入第二条通知，断言它留在 pending 并能在下一回合被投递。
    #[test]
    fn a_notice_arriving_while_the_turn_starts_is_not_lost() {
        let f = Fixture::new(
            "wake-window",
            r#"{"responses":[{"text":"第一回合"},{"text":"第二回合"}]}"#,
            |_| {},
        );
        f.research("");
        let hub = f.hub();
        {
            let mut wake = hub.inner.wake.lock().unwrap();
            wake.pending.push(NoticeRun {
                run_id: "r-first".into(),
                agent: "research".into(),
                description: "先到的通知".into(),
                status: "completed".into(),
                stopped_by: None,
                summary: "结论".into(),
            });
            wake.batch = Some("wb-window".into());
            wake.deadline = Some(Instant::now() - Duration::from_millis(1));
        }
        let hook_hub = hub.clone();
        *AFTER_WAKE_INSERT_HOOK
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(Box::new(move || {
            // 模拟 `on_background_finished` 在窗口内到达：pending 当前为空（本批已取走），
            // 但批次 id 仍在飞，新通知沿用同一 id。
            hook_hub
                .inner
                .wake
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .pending
                .push(NoticeRun {
                    run_id: "r-second".into(),
                    agent: "research".into(),
                    description: "窗口内到达的通知".into(),
                    status: "completed".into(),
                    stopped_by: None,
                    summary: "结论".into(),
                });
        }));
        process_wake(&hub.inner);
        assert!(f.wait(Duration::from_secs(3), || {
            f.runtime
                .with_session(&f.scope, |session| {
                    !session.is_busy()
                        && session.input().iter().any(|item| {
                            item["role"].as_str() == Some("assistant")
                                && item["content"].as_array().is_some_and(|parts| {
                                    parts
                                        .iter()
                                        .any(|part| part["text"].as_str() == Some("第一回合"))
                                })
                        })
                })
                .unwrap_or(false)
        }));
        assert!(
            hub.inner
                .wake
                .lock()
                .unwrap()
                .pending
                .iter()
                .any(|notice| notice.run_id == "r-second"),
            "窗口内到达的通知不得被清场"
        );
        // 再驱动一次：第二条通知被第二回合投递。
        {
            let mut wake = hub.inner.wake.lock().unwrap();
            wake.force = true;
            wake.deadline = Some(Instant::now() - Duration::from_millis(1));
        }
        process_wake(&hub.inner);
        assert!(f.wait(Duration::from_secs(3), || {
            f.runtime
                .with_session(&f.scope, |session| {
                    !session.is_busy()
                        && session.input().iter().any(|item| {
                            item["role"].as_str() == Some("assistant")
                                && item["content"].as_array().is_some_and(|parts| {
                                    parts
                                        .iter()
                                        .any(|part| part["text"].as_str() == Some("第二回合"))
                                })
                        })
                })
                .unwrap_or(false)
        }));
        assert_eq!(f.notice_inputs().len(), 2, "两条通知各上屏一次");
        assert!(hub.inner.wake.lock().unwrap().pending.is_empty());
    }

    /// 触顶分支「已标 delivered、尚未 insert」的窗口里用户发言：通知不得重复上屏
    /// （评审 r3 P2-1 窗口 A）。
    #[test]
    fn user_turn_during_blocked_insert_does_not_duplicate_the_notice() {
        let f = Fixture::new("wake-blocked-race", r#"{"responses":[]}"#, |_| {});
        f.research("");
        let hub = f.hub();
        {
            let mut wake = hub.inner.wake.lock().unwrap();
            wake.chain = AUTO_WAKE_CHAIN_MAX;
            wake.pending.push(NoticeRun {
                run_id: "r-a".into(),
                agent: "research".into(),
                description: "触顶分支的通知".into(),
                status: "completed".into(),
                stopped_by: None,
                summary: "结论".into(),
            });
            wake.batch = Some("wb-a".into());
            wake.deadline = Some(Instant::now() - Duration::from_millis(1));
        }
        // 钩住「已标 delivered、尚未 insert」：模拟用户此刻发言——SessionContext 会把
        // `begin_user_turn` 返回的文本插入历史。
        let hook_hub = hub.clone();
        *AFTER_BLOCKED_MARK_HOOK
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(Box::new(move || {
            if let Some(insert) = hook_hub.begin_user_turn() {
                insert_notices_into_session(&hook_hub.inner, &insert.text, &insert.batch_id);
            }
        }));
        process_wake(&hub.inner);
        assert_eq!(
            f.notice_inputs().len(),
            1,
            "同一通知不得被触顶分支与用户回合各插一遍"
        );
        // 用户回合把 pending 与标记一并消费（通知已在历史里，无需再投递）。
        assert!(hub.inner.wake.lock().unwrap().pending.is_empty());
    }

    /// 起回合在飞期间：窗口内新到一条通知 + 用户发言 + 在飞失败——用户回合只能取走
    /// 自己并入的那条的标记，在飞批次的触顶标记必须留在 wake（评审 r3 P2-1 窗口 B）。
    #[test]
    fn user_turn_during_an_in_flight_turn_keeps_blocked_delivery_marks() {
        let f = Fixture::new(
            "wake-inflight-race",
            r#"{"responses":[{"text":"无重复"}]}"#,
            |_| {},
        );
        f.research("");
        let hub = f.hub();
        // ① 触顶上屏：P 进历史并标 delivered，pending 保留。
        {
            let mut wake = hub.inner.wake.lock().unwrap();
            wake.chain = AUTO_WAKE_CHAIN_MAX;
            wake.pending.push(NoticeRun {
                run_id: "r-p".into(),
                agent: "research".into(),
                description: "触顶通知P".into(),
                status: "completed".into(),
                stopped_by: None,
                summary: "结论".into(),
            });
            wake.batch = Some("wb-b".into());
            wake.deadline = Some(Instant::now() - Duration::from_millis(1));
        }
        process_wake(&hub.inner);
        assert_eq!(f.notice_inputs().len(), 1);
        // ② 模拟「继续」：清 blocked / chain，下一次起回合会失败。
        {
            let mut wake = hub.inner.wake.lock().unwrap();
            wake.blocked = None;
            wake.chain = 0;
            wake.force = true;
            wake.deadline = Some(Instant::now() - Duration::from_millis(1));
        }
        FAIL_NEXT_AUTO_TURN_SPAWN.store(true, Ordering::SeqCst);
        let hook_hub = hub.clone();
        *AFTER_WAKE_INSERT_HOOK
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(Box::new(move || {
            // 窗口内新到 C（pending 非空），随后用户发言。
            hook_hub
                .inner
                .wake
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .pending
                .push(NoticeRun {
                    run_id: "r-c".into(),
                    agent: "research".into(),
                    description: "窗口通知C".into(),
                    status: "completed".into(),
                    stopped_by: None,
                    summary: "结论".into(),
                });
            if let Some(insert) = hook_hub.begin_user_turn() {
                insert_notices_into_session(&hook_hub.inner, &insert.text, &insert.batch_id);
            }
        }));
        process_wake(&hub.inner);
        {
            let wake = hub.inner.wake.lock().unwrap();
            assert!(
                wake.delivered.contains("r-p"),
                "在飞批次的 delivered 标记不得被用户回合取走"
            );
            assert!(wake.pending.iter().any(|notice| notice.run_id == "r-p"));
            assert!(!wake.pending.iter().any(|notice| notice.run_id == "r-c"));
        }
        assert!(!f
            .runtime
            .with_session(&f.scope, |session| session.is_busy())
            .unwrap());
        // ③ 再驱动：P 已上屏，不得重复插入。
        {
            let mut wake = hub.inner.wake.lock().unwrap();
            wake.force = true;
            wake.deadline = Some(Instant::now() - Duration::from_millis(1));
        }
        process_wake(&hub.inner);
        assert!(f.wait(Duration::from_secs(3), || {
            f.runtime
                .with_session(&f.scope, |session| {
                    !session.is_busy()
                        && session.input().iter().any(|item| {
                            item["role"].as_str() == Some("assistant")
                                && item["content"].as_array().is_some_and(|parts| {
                                    parts
                                        .iter()
                                        .any(|part| part["text"].as_str() == Some("无重复"))
                                })
                        })
                })
                .unwrap_or(false)
        }));
        let notices = f.notice_inputs();
        assert_eq!(
            notices
                .iter()
                .filter(|text| text.contains("触顶通知P"))
                .count(),
            1,
            "P 不得重复上屏：{notices:?}"
        );
        assert_eq!(
            notices
                .iter()
                .filter(|text| text.contains("窗口通知C"))
                .count(),
            1,
            "C 只进用户回合一次：{notices:?}"
        );
    }

    /// 投递标记的批次 id 与通知最终进入的回合一致（评审 r3 P2-2）：push 与标记之间被
    /// `begin_user_turn` 取走批次的窗口里，不得铸出孤儿 id。
    #[test]
    fn notice_marker_batch_matches_the_turn_that_consumes_it() {
        let f = Fixture::new("wake-marker-batch", r#"{"responses":[]}"#, |_| {});
        f.research("");
        let hub = f.hub();
        let consumed = Arc::new(Mutex::new(None::<String>));
        let record = consumed.clone();
        let hook_hub = hub.clone();
        *AFTER_NOTICE_PUSH_HOOK
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(Box::new(move || {
            // 间隙里用户发言：取走 pending + 批次。
            if let Some(insert) = hook_hub.begin_user_turn() {
                *record.lock().unwrap_or_else(|e| e.into_inner()) = Some(insert.batch_id);
            }
        }));
        hub.on_background_finished(NoticeRun {
            run_id: "r-m".into(),
            agent: "research".into(),
            description: "标记批次".into(),
            status: "completed".into(),
            stopped_by: None,
            summary: "结论".into(),
        });
        let message_batch = consumed
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .expect("用户回合应取走通知");
        let path = f
            .runtime
            .with_session(&f.scope, |session| session.jsonl().path().to_path_buf())
            .unwrap();
        let content = std::fs::read_to_string(&path).expect("投递标记应已落盘");
        let marker = content
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .find(|record| record["payload"]["kind"] == "notice_delivered")
            .expect("应有投递标记");
        assert_eq!(
            marker["payload"]["wake_batch"],
            json!(message_batch),
            "标记的 wake_batch 必须与通知最终进入的回合一致（不得铸孤儿批次）"
        );
    }

    /// 自动回合线程 spawn 失败必须释放 acquire 占住的 busy（评审 r2 P2-1）：否则会话
    /// 永久 `harness_busy`，后续唤醒也不会再发生。
    #[test]
    fn auto_turn_spawn_failure_releases_the_parent_session() {
        let f = Fixture::new(
            "wake-spawn-fail",
            r#"{"responses":[{"text":"稍后重试"}]}"#,
            |_| {},
        );
        f.research("");
        let hub = f.hub();
        {
            let mut wake = hub.inner.wake.lock().unwrap();
            wake.pending.push(NoticeRun {
                run_id: "r-spawn".into(),
                agent: "research".into(),
                description: "spawn 失败的通知".into(),
                status: "completed".into(),
                stopped_by: None,
                summary: "结论".into(),
            });
            wake.batch = Some("wb-spawn".into());
            wake.deadline = Some(Instant::now() - Duration::from_millis(1));
        }
        FAIL_NEXT_AUTO_TURN_SPAWN.store(true, Ordering::SeqCst);
        process_wake(&hub.inner);
        assert!(
            !f.runtime
                .with_session(&f.scope, |session| session.is_busy())
                .unwrap(),
            "spawn 失败必须释放 busy（会话不得永久 busy）"
        );
        let wake = hub.inner.wake.lock().unwrap();
        assert!(!wake.running);
        assert_eq!(wake.chain, 0, "未起成的回合不推进链");
        assert_eq!(wake.pending.len(), 1, "本批原样放回");
        assert!(
            wake.delivered.contains("r-spawn"),
            "已上屏的部分重试不重复插入"
        );
        drop(wake);
        assert_eq!(f.notice_inputs().len(), 1);
    }

    /// 时间闸的「工具调用前」检查点（design §7.1 / spec scenario「时间闸在工具调用前生效」）：
    /// 第一个调用跑过 deadline 后，第二个调用不得执行。
    #[test]
    fn time_budget_is_checked_before_each_tool_call() {
        let f = Fixture::new(
            "time-between-tools",
            r#"{"responses":[{"tool_calls":[
                {"id":"c1","name":"cli_run","arguments":"{\"command\":\"sleep\",\"args\":[\"1.1\"],\"purpose\":\"等一下\"}"},
                {"id":"c2","name":"vault_read","arguments":"{\"path\":\"a.md\"}"}
            ]}]}"#,
            |config| {
                config.permission_mode = PermissionMode::FullAccess;
                config.subagents.timeout_secs = 1;
            },
        );
        f.write_agent(
            "runner.md",
            "---\nname: runner\ndescription: 跑工具\ntools: [cli_run, vault_read]\ntimeout_secs: 1\n---\n正文\n",
        );
        let out = f.run_task(args("runner", "先等一下再读"));
        assert_eq!(out["status"], "partial", "{out}");
        assert_eq!(out["stopped_by"], "time");
        assert_eq!(
            out["tool_calls"],
            json!({"cli_run": 1}),
            "deadline 之后不得执行第二个调用：{out}"
        );
        assert_eq!(out["rounds"], 1);
    }

    /// 前台 `task` 在父循环同步 join 期间按停止：停止必须直接广播到子运行，不等父线程轮询
    /// （design §12.4「前台 + 本回合起的后台」）。
    #[test]
    fn stopping_the_parent_aborts_a_foreground_task_immediately() {
        let f = Fixture::new(
            "fg-abort",
            r#"{"responses":[{"text":"慢结果","delay_ms":600}]}"#,
            |_| {},
        );
        f.research("");
        let hub = f.hub();
        // 父回合在飞（前台 task 的前置）。
        f.runtime.acquire_turn(&f.scope, &f.config).unwrap();
        let handle = start_task(
            &hub,
            &f.config,
            &f.catalog(),
            &f.task_call(args("research", "前台跑")),
            None,
        );
        std::thread::sleep(Duration::from_millis(100));
        f.runtime.request_abort(&f.scope).expect("abort ok");
        let out = handle.result_value();
        assert_eq!(out["ok"], json!(false), "{out}");
        assert_eq!(out["code"], "turn_aborted", "{out}");
        assert_eq!(hub.retained_count(), 0, "aborted 的 run 不保留");
        f.runtime.release_turn(&f.scope);
    }

    /// 用户停止自动回合 ⇒ blocked=stopped，后续通知不再唤醒。
    #[test]
    fn stopping_the_auto_turn_blocks_further_wakes() {
        let f = Fixture::new("wake-stop", r#"{"responses":[{"text":"x"}]}"#, |_| {});
        f.research("");
        let hub = f.hub();
        f.runtime.acquire_turn(&f.scope, &f.config).unwrap();
        hub.inner.wake.lock().unwrap().running = true;
        f.runtime.request_abort(&f.scope).unwrap();
        hub.broadcast_abort();
        assert_eq!(hub.wake_snapshot().blocked, Some("stopped"));
        f.runtime.release_turn(&f.scope);
        hub.inner.wake.lock().unwrap().running = false;

        hub.on_background_finished(NoticeRun {
            run_id: "r-stopped".into(),
            agent: "research".into(),
            description: "停止后的结果".into(),
            status: "completed".into(),
            stopped_by: None,
            summary: "结论".into(),
        });
        hub.inner.wake.lock().unwrap().deadline = Some(Instant::now() - Duration::from_millis(1));
        process_wake(&hub.inner);
        assert_eq!(f.notice_inputs().len(), 1);
        assert_eq!(f.events("subagent_notified")[0]["wake"], "blocked_stopped");
        assert_eq!(hub.wake_snapshot().chain, 0, "停止不推进链");
    }

    /// aborted 的 run 不投递、不唤醒。
    #[test]
    fn aborted_background_run_does_not_wake() {
        let f = Fixture::new(
            "wake-aborted",
            r#"{"responses":[{"text":"慢","delay_ms":500}]}"#,
            |_| {},
        );
        f.research("");
        let hub = f.hub();
        let mut call = args("research", "后台跑");
        call["background"] = json!(true);
        let out = f.run_task_with(&hub, call);
        let run_id = out["run_id"].as_str().unwrap().to_string();
        assert!(hub.stop_run(&run_id));
        // 收尾顺序是「活动表移除 → 发事件」：等事件到达，而不是只等活动表清空。
        assert!(f.wait(Duration::from_secs(3), || {
            hub.inner
                .runs
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .is_empty()
                && !f.events("subagent_notified").is_empty()
        }));
        assert_eq!(hub.wake_snapshot().chain, 0);
        assert!(f.notice_inputs().is_empty(), "aborted 不投递通知");
        let notified = f.events("subagent_notified");
        assert_eq!(notified.len(), 1);
        assert_eq!(notified[0]["wake"], "none_aborted");
    }

    /// 投递标记恢复：未消费 ⇒ 据标记 + subrun sidecar 重建；已进过 llm_request ⇒ 判陈旧。
    #[test]
    fn notice_markers_rebuild_only_unconsumed_batches() {
        let records = vec![
            json!({"kind": "subrun", "run_id": "r-1", "agent": "research",
                   "description": "调研", "status": "partial", "stopped_by": "tokens"}),
            json!({"kind": "notice_delivered", "run_ids": ["r-1"], "wake_batch": "wb-1",
                   "shown_at": 1}),
        ];
        let texts = restored_notice_texts(&records);
        assert_eq!(texts.len(), 1);
        assert!(texts[0].contains("research"));
        assert!(texts[0].contains("摘要见审计流水与 task 行"));
        assert!(texts[0].contains("wake_batch=wb-1"));

        // 通知已进过 llm_request（模型消费过）⇒ 标记陈旧，不重复上屏。
        let mut consumed = records.clone();
        consumed.push(json!({
            "kind": "llm_request",
            "request": {"messages": [{
                "role": "user",
                "content": [{"type": "input_text",
                    "text": format!("通知\n\n{AUTO_NOTICE_MARKER} wake_batch=wb-1]")}]
            }]}
        }));
        assert!(notice_batch_consumed(&consumed, "wb-1"));
        assert!(restored_notice_texts(&consumed).is_empty());
    }

    /// 自动回合内部触顶 `loop_max` 不改变链计数（两者正交）。
    #[test]
    fn auto_turn_loop_max_does_not_touch_the_chain() {
        let f = Fixture::new(
            "wake-loopmax",
            r#"{"responses":[
                {"tool_calls":[{"id":"c1","name":"vault_read","arguments":"{\"path\":\"a.md\"}"}]},
                {"text":"不应被请求"}
            ]}"#,
            |config| config.loop_max = 1,
        );
        f.research("");
        let hub = f.hub();
        hub.on_background_finished(NoticeRun {
            run_id: "r-loop".into(),
            agent: "research".into(),
            description: "触发自动回合".into(),
            status: "completed".into(),
            stopped_by: None,
            summary: "结论".into(),
        });
        hub.inner.wake.lock().unwrap().deadline = Some(Instant::now() - Duration::from_millis(1));
        process_wake(&hub.inner);
        assert!(f.wait(Duration::from_secs(3), || {
            !f.runtime
                .with_session(&f.scope, |session| session.is_busy())
                .unwrap()
        }));
        assert_eq!(hub.wake_snapshot().chain, 1, "loop_max 不推进/回退链计数");
        assert_eq!(hub.wake_snapshot().blocked, None);
        let text = f
            .runtime
            .with_session(&f.scope, |session| {
                session
                    .input()
                    .iter()
                    .filter_map(|item| item["content"].as_array())
                    .flatten()
                    .filter_map(|part| part["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap();
        assert!(text.contains("已达到工具循环上限"), "{text}");
    }

    /// 持 `Runtime.sessions` 锁时不等待用户或子运行（design §8.3）：子运行挂起在批准上时，
    /// 快照 / 批准命令仍能立刻拿到会话锁。
    #[test]
    fn session_lock_is_never_held_while_waiting_for_approval() {
        let f = Fixture::new(
            "approval-lock",
            r#"{"responses":[
                {"tool_calls":[{"id":"c1","name":"vault_delete","arguments":"{\"path\":\"a.md\"}"}]},
                {"text":"完成"}
            ]}"#,
            |config| config.permission_mode = PermissionMode::VaultWrite,
        );
        f.write_agent(
            "deleter.md",
            "---\nname: deleter\ndescription: 删文件\ntools: [vault_delete]\n---\n正文\n",
        );
        let hub = f.hub();
        let handle = start_task(
            &hub,
            &f.config,
            &f.catalog(),
            &f.task_call(args("deleter", "删掉 a.md")),
            None,
        );
        assert!(f.wait(Duration::from_secs(3), || {
            !f.runtime
                .snapshot(&f.scope, &f.config)
                .pending_approvals
                .is_empty()
        }));
        // 子运行线程挂在通道上；这里对会话做一次快照 + 一次 abort 探测，必须立即返回。
        let started = Instant::now();
        let _ = f.runtime.snapshot(&f.scope, &f.config);
        let _ = f
            .runtime
            .with_session(&f.scope, |session| session.abort_requested());
        assert!(
            started.elapsed() < Duration::from_millis(200),
            "会话锁被等待中的子运行占住：{:?}",
            started.elapsed()
        );
        let id = f.runtime.snapshot(&f.scope, &f.config).pending_approvals[0]
            .id
            .clone();
        f.runtime
            .with_session(&f.scope, |session| {
                session.resolve_approval(&id, true, None, false, false)
            })
            .unwrap()
            .unwrap();
        assert_eq!(handle.result_value()["status"], "completed");
    }

    /// 子运行上下文装配（design §10）：定义正文替换身份段 + 委托约束段；输入是空历史 +
    /// 一条 user 消息；不注入编辑器上下文。
    #[test]
    fn subagent_system_and_messages_are_isolated() {
        let f = Fixture::new("assembly", r#"{"responses":[{"text":"x"}]}"#, |_| {});
        f.research("");
        let definition = f.catalog().get("research").cloned().unwrap();
        let body = definition.body().unwrap();
        let system = super::super::context::assemble_system_for_subagent(&f.scope.root, &body);
        assert!(
            system.text.contains("你是研究子代理。"),
            "定义正文进 system"
        );
        assert!(!system.text.contains("Lumir"), "身份段被定义正文替换");
        assert!(system.text.contains("委托运行约束"), "机制级约束段恒在");
        assert!(!system.text.contains("当前编辑器上下文"));

        // 实际运行后：子会话 input 只有 prompt 一条 user 消息（父历史不继承）。
        let hub = f.hub();
        let out = f.run_task_with(&hub, args("research", "查一下 a.md"));
        assert_eq!(out["status"], "completed");
        // 子会话在保留表里：第一条 input 就是 prompt。
        let registry = hub.inner.registry.lock().unwrap();
        let retained = registry.retained.values().next().expect("应保留子会话");
        let inputs = retained.session.input();
        assert!(inputs.len() >= 2, "{inputs:?}");
        assert_eq!(inputs[0]["role"], "user");
        assert!(inputs[0]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("查一下 a.md"));
        // 父会话 transcript 不含子运行过程消息（只有 task 工具行由父循环记账）。
        let parent_roles = f
            .runtime
            .with_session(&f.scope, |session| {
                session
                    .input()
                    .iter()
                    .map(|item| item["role"].as_str().unwrap_or("").to_string())
                    .collect::<Vec<_>>()
            })
            .unwrap();
        assert!(
            !parent_roles.contains(&"assistant".to_string()),
            "{parent_roles:?}"
        );
    }

    /// mock 游标：每个 run 领到互不重叠的区间（design §18）；父续写条目落在所有区间之后。
    #[test]
    fn mock_regions_are_reserved_per_run() {
        let f = Fixture::new(
            "mock-regions",
            r#"{"responses":[
                {"text":"一"},{"text":"二"},{"text":"三"}
            ],"subrun_span":1}"#,
            |_| {},
        );
        f.research("");
        let hub = f.hub();
        hub.note_mock_progress(0, 1, 1, Some(3));
        let (first, _) = hub.reserve_mock_region(1, None);
        let (second, _) = hub.reserve_mock_region(1, None);
        assert_eq!(first, 1);
        assert_eq!(second, 2);
        assert_eq!(hub.external_mock_consumed(), 2);
    }

    /// 收尾幂等：同一段只写一条 `subagent_finished` / 一条 subrun sidecar。
    #[test]
    fn finish_is_idempotent() {
        let f = Fixture::new(
            "finish-once",
            r#"{"responses":[{"text":"只收尾一次","usage":{"input_tokens":4,"output_tokens":2}}]}"#,
            |_| {},
        );
        f.research("");
        let out = f.run_task(args("research", "做点什么"));
        assert_eq!(out["status"], "completed");
        assert_eq!(f.events("subagent_finished").len(), 1);
        let usage = f
            .runtime
            .with_session(&f.scope, |session| session.subrun_usage().clone())
            .unwrap();
        assert_eq!(usage.values().map(|bucket| bucket.segments).sum::<u64>(), 1);
        assert_eq!(usage.values().map(|bucket| bucket.samples).sum::<u64>(), 1);
    }

    /// 调度原语：子请求 FIFO、父请求优先；在飞请求数不超过许可数。
    #[test]
    fn provider_gate_prioritises_parent_requests() {
        // 用 Deepseek 键：本模块其它用例都走 Mock，避免共享闸互相干扰。
        // 接口语义：`max_concurrent` 传入 0 ⇒ 许可数 = 0 + 1 = 1。
        let provider = "deepseek";
        let permits = 0u32;
        // 占住唯一许可。
        let held = scheduler::acquire_provider_request(provider, permits, RequestPriority::Parent);
        let order = Arc::new(Mutex::new(Vec::<&'static str>::new()));
        let mut children = Vec::new();
        for index in 0..2 {
            let order = order.clone();
            children.push(std::thread::spawn(move || {
                let _permit =
                    scheduler::acquire_provider_request(provider, permits, RequestPriority::Child);
                let _ = index;
                order.lock().unwrap().push("child");
            }));
        }
        std::thread::sleep(Duration::from_millis(80));
        let parent_order = order.clone();
        let parent = std::thread::spawn(move || {
            let _permit =
                scheduler::acquire_provider_request(provider, permits, RequestPriority::Parent);
            parent_order.lock().unwrap().push("parent");
        });
        // 等父请求真正进入等待队列再放闸（否则线程调度可能让子请求先拿到许可）。
        let deadline = Instant::now() + Duration::from_secs(2);
        while scheduler::provider_gate_state(provider).1 == 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            scheduler::provider_gate_state(provider).1,
            1,
            "父请求应已排队"
        );
        drop(held);
        parent.join().unwrap();
        for child in children {
            child.join().unwrap();
        }
        assert_eq!(
            *order.lock().unwrap(),
            vec!["parent", "child", "child"],
            "父请求必须越过排队的子请求"
        );
    }
}
