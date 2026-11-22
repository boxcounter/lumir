//! 只在测试构建里存在的命名闸门（批次 1：Harness 图片读写 IPC 响应性）。
//!
//! 用途只有一个：把**重活命令**停在其真实核心的入口，让测试能在同一台 IPC dispatcher 上
//! 观察「轻量命令还能不能回包」。装填 / 释放由 [`crate::ipc_responsiveness_tests`] 驱动；
//! 生产构建里整个模块与所有调用点都被 `#[cfg(test)]` 编掉，不引入运行时分支。
//!
//! 命中判据是 `point` + `key`（key = 命令发起时的 vault 稳定 id）：cargo test 在同一进程里
//! 并行跑，别的测试可能走到同一个闸门点，只有装填时点名的 vault 才拦——否则闸门会被无关
//! 测试消费掉，被测命令反而「没被拦住」，测试以不相干的理由假绿。

use std::sync::{Condvar, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

#[derive(Default)]
struct GateState {
    /// 已装填的闸门点；`None` = 未装填或已被一次命中消费（闸门只拦第一次命中）。
    armed: Option<(&'static str, String)>,
    entered: bool,
    released: bool,
}

#[derive(Default)]
struct Gate {
    state: Mutex<GateState>,
    cv: Condvar,
}

fn gate() -> &'static Gate {
    static GATE: OnceLock<Gate> = OnceLock::new();
    GATE.get_or_init(Gate::default)
}

fn state() -> MutexGuard<'static, GateState> {
    gate().state.lock().unwrap_or_else(|e| e.into_inner())
}

/// 闸门是进程级全局：同一时刻只允许一个测试使用（cargo test 并行跑，互不串场）。
pub fn serial() -> MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// 装填闸门：下一次以 `point` + `key` 调用 [`enter`] 的命令在此阻塞，直到 [`release`]。
pub fn arm(point: &'static str, key: &str) {
    let mut state = state();
    state.armed = Some((point, key.to_string()));
    state.entered = false;
    state.released = false;
}

/// 重活核心的闸门点（命令闭包内、真正耗 CPU / IO 的工作之前）。
///
/// 命中装填点与 key 时置 `entered` 并阻塞，直到 [`release`]；未命中立即返回（零行为变化）。
pub fn enter(point: &'static str, key: &str) {
    let gate = gate();
    let mut state = state();
    let hits = matches!(
        state.armed.as_ref(),
        Some((armed_point, armed_key)) if *armed_point == point && armed_key.as_str() == key
    );
    if !hits {
        return;
    }
    state.armed = None;
    state.entered = true;
    gate.cv.notify_all();
    while !state.released {
        state = gate.cv.wait(state).unwrap_or_else(|e| e.into_inner());
    }
}

/// 等命令到达闸门（超时返回 false；测试据此区分「闸门没被命中」与「响应性不成立」）。
pub fn wait_entered(timeout: Duration) -> bool {
    let gate = gate();
    let mut state = state();
    let deadline = Instant::now() + timeout;
    while !state.entered {
        let now = Instant::now();
        if now >= deadline {
            return false;
        }
        let (next, _) = gate
            .cv
            .wait_timeout(state, deadline - now)
            .unwrap_or_else(|e| e.into_inner());
        state = next;
    }
    true
}

/// 放行闸门（幂等；未装填 / 已放行也安全）。
pub fn release() {
    let gate = gate();
    let mut state = state();
    state.released = true;
    gate.cv.notify_all();
}

/// 清掉未消费的装填，避免残留装填影响后续测试。
pub fn disarm() {
    let mut state = state();
    state.armed = None;
    state.released = true;
    gate().cv.notify_all();
}
