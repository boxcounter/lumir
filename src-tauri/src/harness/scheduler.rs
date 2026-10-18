//! 并发与唤醒调度原语（change add-harness-subagents design §12）。
//!
//! 本模块只放**纯调度机制**，不含运行引擎与任务知识：
//! - [`ProviderGate`]：每 provider 一个计数信号量（许可数 = `max_concurrent + 1`），父会话
//!   自己的往返优先取许可、子请求之间 FIFO（design §12.3）。**cron 运行共用同一个闸**——
//!   闸按 provider 进程内单例键控，任何触发源取的都必须是同一份计数（接 cron 的调用点归
//!   change add-cron-runtime-daemon 的后续任务）。
//! - [`ConcurrencyGate`]：会话级并发许可（`max_concurrent`），前台阻塞取、后台非阻塞取
//!   （design §12.1：后台的语义是「现在就跑」，排队会让人以为已经在跑）。
//! - 自动唤醒的两个常量与快照形状（design §12.6.3）：`AUTO_WAKE_CHAIN_MAX = 5`、
//!   `AUTO_WAKE_COALESCE_MS = 2000`。它们是**安全绳不是策略旋钮**，刻意不是配置键。
//!
//! 模块在 `harness.rs` 的 mod 表注册，对外路径是 `harness::scheduler`。

use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex, OnceLock};

use serde::Serialize;

use crate::config::HarnessProvider;

/// 连续自动回合上限（design §12.6.3，Alex 2026-10-18 节点 1 终审定为 5）。代码常量，
/// 不进 `SubagentsConfig`：可调大会直接抬高「不在场烧配额」的上界，需要继续时用户发言即可清零。
pub const AUTO_WAKE_CHAIN_MAX: u32 = 5;
/// 空闲时把同一窗口内收敛的后台结果合并为一个回合的窗口长度（从首条通知起算、不顺延）。
pub const AUTO_WAKE_COALESCE_MS: u64 = 2_000;

/// 自动唤醒状态的快照面（`harness_state` 的 `auto_wake` 字段，design §12.6.3）。
/// 面板据 `blocked` 渲染提示行；`chain` / `max` 给出「已连续几个自动回合」读数。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct AutoWakeSnapshot {
    /// 当前连续自动回合数（用户回合开始 / 「继续」/ 会话重建时清零，不持久化）。
    pub chain: u32,
    /// 链上限（恒 [`AUTO_WAKE_CHAIN_MAX`]，面板提示行的读数来源）。
    pub max: u32,
    /// 触顶原因：`chain_limit` / `stopped`；`None` = 未触顶。
    pub blocked: Option<&'static str>,
}

impl Default for AutoWakeSnapshot {
    fn default() -> Self {
        Self {
            chain: 0,
            max: AUTO_WAKE_CHAIN_MAX,
            blocked: None,
        }
    }
}

/// 取许可的一方（design §12.3：父会话自己的往返优先于子请求）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestPriority {
    /// 父会话自己的往返（交互 / cron 槽位的主请求）。
    Parent,
    /// 子运行（以及 cron 的无人值守运行）的请求。
    Child,
}

/// 一次请求许可（RAII）：drop 即归还。持有它期间才允许发起 provider 请求。
pub struct RequestPermit {
    gate: Arc<ProviderGate>,
}

impl Drop for RequestPermit {
    fn drop(&mut self) {
        self.gate.release();
    }
}

/// 每 provider 一个计数信号量（进程内单例）。许可数 = `max_concurrent + 1`：
/// 并行 N 路子运行时峰值 N+1 个在飞请求（含父自己的往返）。
pub struct ProviderGate {
    state: Mutex<GateState>,
    condvar: Condvar,
}

#[derive(Debug, Default)]
struct GateState {
    /// 允许的在飞请求数。每次 acquire 用调用方配置值刷新（配置改小后自然收紧）。
    permits: usize,
    active: usize,
    waiting_parents: usize,
    /// 子请求的取号 / 叫号（FIFO；父请求可越过队列，这是「父不被自己的子任务饿死」）。
    next_ticket: u64,
    serving_ticket: u64,
}

impl ProviderGate {
    fn new() -> Self {
        Self {
            state: Mutex::new(GateState {
                permits: 1,
                ..GateState::default()
            }),
            condvar: Condvar::new(),
        }
    }

    fn acquire(self: &Arc<Self>, permits: usize, priority: RequestPriority) -> RequestPermit {
        let permits = permits.max(1);
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.permits = permits;
        // 许可数调大时唤醒等待者（配置热读路径不常见，但没有这个通知就会有人白等）。
        self.condvar.notify_all();
        match priority {
            RequestPriority::Parent => {
                state.waiting_parents += 1;
                while state.active >= state.permits {
                    state = self.condvar.wait(state).unwrap_or_else(|e| e.into_inner());
                }
                state.waiting_parents -= 1;
                state.active += 1;
            }
            RequestPriority::Child => {
                let ticket = state.next_ticket;
                state.next_ticket += 1;
                while state.active >= state.permits
                    || state.waiting_parents > 0
                    || ticket != state.serving_ticket
                {
                    state = self.condvar.wait(state).unwrap_or_else(|e| e.into_inner());
                }
                state.serving_ticket += 1;
                state.active += 1;
                // 叫到下一个号时唤醒它的等待者（FIFO 队列靠 ticket 配对，不靠唤醒顺序）。
                self.condvar.notify_all();
            }
        }
        drop(state);
        RequestPermit { gate: self.clone() }
    }

    fn release(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.active = state.active.saturating_sub(1);
        self.condvar.notify_all();
    }
}

/// 进程内 provider → 闸的映射（`OnceLock` 单例；键 = provider 的稳定字面量）。
fn provider_gates() -> &'static Mutex<HashMap<&'static str, Arc<ProviderGate>>> {
    static GATES: OnceLock<Mutex<HashMap<&'static str, Arc<ProviderGate>>>> = OnceLock::new();
    GATES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 取 provider 请求许可（阻塞）。`max_concurrent` 是配置值；许可数由调用点按
/// `max_concurrent + 1` 传入——闸内部只认这个数，不反向读配置（cron 与交互读的是同一份
/// 配置，接入点各自传同一口径即可）。
pub fn acquire_provider_request(
    provider: HarnessProvider,
    max_concurrent: u32,
    priority: RequestPriority,
) -> RequestPermit {
    let key = provider.as_str();
    let gate = {
        let mut gates = provider_gates().lock().unwrap_or_else(|e| e.into_inner());
        gates
            .entry(key)
            .or_insert_with(|| Arc::new(ProviderGate::new()))
            .clone()
    };
    gate.acquire(max_concurrent as usize + 1, priority)
}

/// 单测 introspection：`(active, waiting_parents, waiting_children)`。生产路径不读它。
#[cfg(test)]
pub fn provider_gate_state(provider: HarnessProvider) -> (usize, usize, usize) {
    let gates = provider_gates().lock().unwrap_or_else(|e| e.into_inner());
    let Some(gate) = gates.get(provider.as_str()) else {
        return (0, 0, 0);
    };
    let state = gate.state.lock().unwrap_or_else(|e| e.into_inner());
    (
        state.active,
        state.waiting_parents,
        (state.next_ticket - state.serving_ticket) as usize,
    )
}

/// 会话级并发许可（`max_concurrent`）。前台调用阻塞取；后台调用非阻塞取，取不到即
/// `concurrency_limit`（design §12.1）。
pub struct ConcurrencyGate {
    inner: Arc<ConcurrencyInner>,
}

struct ConcurrencyInner {
    active: Mutex<usize>,
    condvar: Condvar,
    /// 许可上限（配置值；每次 acquire 前刷新，改配置后自然收紧 / 放宽）。
    limit: std::sync::atomic::AtomicUsize,
}

impl ConcurrencyGate {
    pub fn new(limit: u32) -> Self {
        Self {
            inner: Arc::new(ConcurrencyInner {
                active: Mutex::new(0),
                condvar: Condvar::new(),
                limit: std::sync::atomic::AtomicUsize::new(limit.max(1) as usize),
            }),
        }
    }

    /// 配置刷新（`max_concurrent` 改变时调用；已在跑的许可不受影响）。
    pub fn set_limit(&self, limit: u32) {
        self.inner
            .limit
            .store(limit.max(1) as usize, std::sync::atomic::Ordering::SeqCst);
        self.inner.condvar.notify_all();
    }

    fn limit(&self) -> usize {
        self.inner.limit.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// 前台：阻塞到拿到许可（父回合本来就在等它）。
    pub fn acquire(&self) -> ConcurrencyPermit {
        let mut active = self.inner.active.lock().unwrap_or_else(|e| e.into_inner());
        while *active >= self.limit() {
            active = self
                .inner
                .condvar
                .wait(active)
                .unwrap_or_else(|e| e.into_inner());
        }
        *active += 1;
        ConcurrencyPermit {
            inner: self.inner.clone(),
        }
    }

    /// 后台：非阻塞取，取不到返回 `None`（不排队、不自动补跑）。
    pub fn try_acquire(&self) -> Option<ConcurrencyPermit> {
        let mut active = self.inner.active.lock().unwrap_or_else(|e| e.into_inner());
        if *active >= self.limit() {
            return None;
        }
        *active += 1;
        Some(ConcurrencyPermit {
            inner: self.inner.clone(),
        })
    }
}

/// 一次会话级并发许可（RAII）：由子运行线程持有到段收尾。
pub struct ConcurrencyPermit {
    inner: Arc<ConcurrencyInner>,
}

impl Drop for ConcurrencyPermit {
    fn drop(&mut self) {
        let mut active = self.inner.active.lock().unwrap_or_else(|e| e.into_inner());
        *active = active.saturating_sub(1);
        self.inner.condvar.notify_all();
    }
}
