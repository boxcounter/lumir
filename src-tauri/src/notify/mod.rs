//! 通知平台层（change add-cron-notification-relaunch，design §2 / §3）。
//!
//! **macOS 打包实例的通知平台层由本仓自持**：delegate 的安装与保活、投递、投递后自查、
//! 授权查询 / 申请都在这里，`notify-rust` 退回只承担 Linux / Windows。被替换掉的那条路
//! （`mac-usernotifications 0.3.1` 的响应映射是**进程内私有表**、delegate 只在首次投递时
//! **懒装**）机制上做不到「应用退出期间投递的通知被点击后仍有人接收」——那份映射的生命周期
//! 就是进程生命周期，而且外部无法补挂接收者。
//!
//! 本模块分两层：
//!
//! - **平台无关**：无主响应缓冲（`delegate` 可能在 `setup` 之前就回调，此时既没有守护线程也
//!   没有任务集）+ 唤醒回调。缓冲是**进程内**的，不落盘——进程不在了就没有「待处理点击」
//!   （这是运行时机制的定义，不是持久化状态）。
//! - **macOS 实现**（[`macos`]）：`unsafe` objc2 面只在这个子模块里，对外只暴露安全接口。
//!
//! **非法 / 非 tap 动作的处理在平台层就完成**（[`crate::cron::normalize_action`]）：自持之后
//! 原来由依赖库做的「系统默认动作 → 内部动作」转换层不存在了，缺了它所有正文点击都会被当成
//! 非 tap 忽略。

#[cfg(target_os = "macos")]
pub mod macos;

use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

use crate::cron::NoticeAction;

/// 待处理响应缓冲的上限（design §5：有界，超出丢最旧的一条并落 warning）。
///
/// 8 条远大于真实场景（用户连点同一批通知），但足够吸收「启动瞬间被拉起 + 连点」的抖动。
const PENDING_LIMIT: usize = 8;

/// 平台层收到的一条响应：只有 request id 与**已归一化**的动作。
///
/// 刻意不带任务 / 会话：上下文由守护线程按 request id 从进程内上下文表或台账取回，
/// 平台层不做任何业务判定（也不该知道任务是什么）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawResponse {
    pub request_id: String,
    pub action: NoticeAction,
}

struct Pending {
    queue: VecDeque<RawResponse>,
    /// 因缓冲已满被丢弃的 request id：**只记账不落日志**。
    ///
    /// `report_response` 跑在 delegate 回调里（主线程 run loop），而第一次 `config_warning`
    /// 会同步做配置目录解析与文件读取（`logging::global()` 的首次初始化）——在回调里做配置 IO
    /// 违反 design §3 的「回调只入队 + 唤醒」。丢弃记录由守护线程 drain 时补落。
    dropped: Vec<String>,
    waker: Option<std::sync::Arc<dyn Fn() + Send + Sync>>,
}

fn pending() -> &'static Mutex<Pending> {
    static PENDING: OnceLock<Mutex<Pending>> = OnceLock::new();
    PENDING.get_or_init(|| {
        Mutex::new(Pending {
            queue: VecDeque::new(),
            dropped: Vec::new(),
            waker: None,
        })
    })
}

/// 登记唤醒回调（守护线程启动时注册一次）：收到响应后立刻叫醒 `lumir-cron` 线程。
///
/// 唤醒只做一次通道发送（零阻塞）——`didReceive` 回调跑在主线程 run loop 上，
/// MUST NOT 在那里做 IO 或等待。
pub fn set_waker(waker: Box<dyn Fn() + Send + Sync>) {
    let mut state = pending().lock().expect("notify pending poisoned");
    state.waker = Some(std::sync::Arc::from(waker));
}

/// 平台层收到一次响应：入缓冲（有界）并唤醒守护线程。
pub fn report_response(request_id: String, action: NoticeAction) {
    let waker = {
        let mut state = pending().lock().expect("notify pending poisoned");
        while state.queue.len() >= PENDING_LIMIT {
            if let Some(dropped) = state.queue.pop_front() {
                state.dropped.push(dropped.request_id);
            }
        }
        state.queue.push_back(RawResponse { request_id, action });
        // 回调缺席（守护线程未起）只是这一次不唤醒：缓冲里的响应由线程装载完成后 drain 取走
        // ——「先落缓冲」正是为了这个窗口期。
        state.waker.clone()
    };
    if let Some(wake) = waker {
        wake();
    }
}

/// 取走全部待处理响应（按到达顺序）以及因缓冲已满被丢弃的 request id。
///
/// 丢弃记录一并交回而不是在回调里落日志：守护线程在装载完成后与每次被唤醒时调用它，
/// 那条线程上做配置 IO 是安全的（见 [`Pending::dropped`]）。
pub fn take_responses() -> (Vec<RawResponse>, Vec<String>) {
    let mut state = pending().lock().expect("notify pending poisoned");
    (
        state.queue.drain(..).collect(),
        std::mem::take(&mut state.dropped),
    )
}

/// delegate 安装（macOS 打包实例；其余环境是恒成功的空操作）。
///
/// **必须在应用完成启动之前调用**（Apple 合同：否则「导致应用被启动的通知」响应会丢），
/// 安装路径零 IO、零跨进程查询（ADR 0002 第 6 条冷启动 <300ms）。
#[cfg(target_os = "macos")]
pub fn install_delegate() -> Result<(), String> {
    macos::install_delegate()
}

#[cfg(not(target_os = "macos"))]
pub fn install_delegate() -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 缓冲的三条性质一起验（单测共享同一份进程内缓冲，拆开会互相 drain）：
    /// 先进先出、取走后为空、超出上限丢最旧、每次响应唤醒一次。
    #[test]
    fn pending_buffer_is_fifo_bounded_and_wakes() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let calls = Arc::new(AtomicUsize::new(0));
        let counter = calls.clone();
        set_waker(Box::new(move || {
            counter.fetch_add(1, Ordering::SeqCst);
        }));

        // 取走任何残留（其它测试留下的），保证下面的计数只覆盖本测试的投放。
        let _ = take_responses();

        report_response("req-a".to_string(), NoticeAction::Tap);
        report_response("req-b".to_string(), NoticeAction::Dismiss);
        assert_eq!(calls.load(Ordering::SeqCst), 2, "每次响应唤醒一次");
        let (taken, dropped) = take_responses();
        assert!(dropped.is_empty(), "没有溢出时不报告丢弃");
        assert_eq!(
            taken,
            vec![
                RawResponse {
                    request_id: "req-a".to_string(),
                    action: NoticeAction::Tap
                },
                RawResponse {
                    request_id: "req-b".to_string(),
                    action: NoticeAction::Dismiss
                },
            ],
            "按到达顺序交出"
        );
        assert!(take_responses().0.is_empty(), "取走后缓冲为空");

        for index in 0..(PENDING_LIMIT + 2) {
            report_response(format!("req-{index}"), NoticeAction::Tap);
        }
        let (taken, dropped) = take_responses();
        assert_eq!(taken.len(), PENDING_LIMIT, "缓冲有界");
        assert_eq!(
            dropped,
            vec!["req-0".to_string(), "req-1".to_string()],
            "被顶出缓冲的 id 交给守护线程补落（回调里不落日志）"
        );
        assert_eq!(
            taken.first().map(|entry| entry.request_id.as_str()),
            Some("req-2"),
            "超出上限时丢最旧的一条"
        );
        assert_eq!(
            taken.last().map(|entry| entry.request_id.as_str()),
            Some(format!("req-{}", PENDING_LIMIT + 1).as_str())
        );
    }

    /// 回调里只入队 + 唤醒（r1 P2-3）：`report_response` 在 delegate 线程上跑，MUST NOT 落日志
    /// ——第一次 `config_warning` 会同步做配置目录解析与读文件。
    #[test]
    fn report_response_does_not_log() {
        let source = include_str!("mod.rs");
        let start = source
            .find("pub fn report_response(")
            .expect("report_response 在场");
        let end = source[start..]
            .find("\n}\n")
            .map(|offset| start + offset)
            .expect("函数体有收尾");
        let body: String = source[start..end]
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            !body.contains("logging::"),
            "缓冲回调里不允许落日志（配置 IO）：\n{body}"
        );
        assert!(
            body.contains("state.dropped.push"),
            "溢出只记账，交给守护线程补落"
        );
    }

    /// 非 macOS 上安装是恒成功的空操作：其它平台 MUST NOT 因本 change 而声称或要求 delegate。
    #[cfg(not(target_os = "macos"))]
    #[test]
    fn install_is_a_noop_off_macos() {
        assert!(install_delegate().is_ok());
    }
}
