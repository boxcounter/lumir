//! cron 通用任务机制——判定、时间换算与触发去重状态（change add-cron-runtime-daemon）。
//!
//! 本模块是机制里**没有 tauri 依赖**的那一半（ADR 0002 第 7 条）：
//!
//! - [`decide`]：唯一的判定函数（design §3）。**纯函数**——不读时钟、不碰磁盘，四个触发源
//!   （定时器 / 启动 / 主窗口获得焦点 / 目标 vault 打开成功）都只走它。定时器 tick 因此是
//!   纯内存比较，冷启动与 keypress-to-paint 合同零接触面。
//! - [`plan`]：判定 + 派发策略的唯一合成点（design §5）。也是纯函数——「到点后该投通知、
//!   该发起运行、还是该落一条 skip」在进副作用之前就已决定，副作用（通知、事件、写盘）全在
//!   `lib.rs` 的接线层。
//! - [`handoff`]：运行交接载荷（`RunSpec` + 任务载荷）的**唯一**合成点（change
//!   add-harness-subagents design §2.4）。同样纯函数——定时派发与点击发起共用它，接线层只把
//!   结果 emit 出去。
//! - [`plan_click`]：点击通知的落点（`Defer` / `Run` / `OpenSession` / `FocusOnly` / `Reject`）
//!   的唯一判定点（M752）。纯函数——接线层只执行，不再自行判「桥是否就绪 / 今日是否点过」。
//! - [`DeliveryRetry`]：投递失败后的重试节奏（M637）。纯状态机——指数退避与当日失败上限都在
//!   这里，时刻由调用方注入；重试动作与日志策略在接线层（`lib.rs`）。
//! - `at` / `days` 解析与本地时间换算（[`chrono::Local`]；判定接受**注入**的 [`LocalNow`]，
//!   单测不依赖系统时区）。
//! - `cron-state.json` 的读写（原子替换、四类读取失败一律视为「无状态」）。
//!
//! ## 机制不知道任务要做什么
//!
//! 本模块认的只有「调度 + 会话形态 + 触达策略」：任务要写哪个文件、路径怎么拼、完成条件是
//! 什么，全都由 `prompt` 与目标 vault 的 `AGENTS.md` 表达（design §2）。因此这里没有、也
//! MUST NOT 出现任何任务 id、样例路径或样例小节标题的字面量。
//!
//! ## 时间口径（design §4.3）
//!
//! - **本地时间**：判据是「本地时钟越过 `at`」而不是「恰好等于 `at`」——tick 抖动、休眠、
//!   晚启动都不影响正确性。
//! - **DST 跳过的小时**：下一次 tick 即为已过点（`now >= at` 成立）。
//! - **DST 重复的小时 / 时钟回拨**：当日去重（`last_fired == today`）挡住第二次；回拨到
//!   昨日时既有记录**保留不删**，最多抑制当天一次触发（保守方向）。
//! - **跨日不补**：00:00 后「今天」变成新日期，昨日错过的任务不补——提醒的意义在当天。

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Datelike, FixedOffset, Local, Timelike};
use serde::{Deserialize, Serialize};

use crate::commands::CommandError;
use crate::config::{
    CronTask, CronTaskIssue, CronWeekday, DeliveryPolicy, SessionShape, UiLanguage,
};
use crate::harness::run::{
    ApprovalPolicy, RunBudget, RunOrigin, RunSpec, SessionTarget, ToolPolicy,
};
use crate::harness::tools::TOOL_NAMES;

/// 定时器 tick 周期：30s 一次纯内存比较（design §4.1）。任务量在几十条以内无感。
pub const TICK: Duration = Duration::from_secs(30);

/// 触发去重状态的 schema 版本。读取时与实现不符即视为「无状态」（design §8）。
pub const STATE_VERSION: u32 = 1;

/// 触发去重状态文件名（配置目录根下，与 `window-state.json` / `vault-sessions/` 同级）。
pub const STATE_FILE_NAME: &str = "cron-state.json";

// ---------------------------------------------------------------------------
// 触发源与时间
// ---------------------------------------------------------------------------

/// 触发源（design §4）：定时器 + 三个拉取兜底时机。四者共用同一个判定函数，差别只在
/// 「何时调用」与「当日跳过的任务要不要再试一次」。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    /// 进程内 30s tick。
    Timer,
    /// 启动就绪后一次。
    Startup,
    /// 主窗口获得焦点（200ms 内合并）。
    Focus,
    /// 目标 vault 打开成功后一次。
    VaultOpen,
    /// 用户点击通知后发起的一次运行（`cron:run` 的 `trigger=click` + `Interactive` 槽位，
    /// design §5.1）。
    Click,
}

impl Trigger {
    /// 诊断事件里的字面量（`cron_notified.trigger` / `cron_run_started.trigger`）。
    pub fn as_str(self) -> &'static str {
        match self {
            Trigger::Timer => "timer",
            Trigger::Startup => "startup",
            Trigger::Focus => "focus",
            Trigger::VaultOpen => "vault-open",
            Trigger::Click => "click",
        }
    }

    /// 拉取兜底（启动 / 焦点 / vault 打开）。当日被跳过的任务允许它们重试；定时器不重试
    /// （design §6.5：避免日志噪音，补跑落在下一次拉取触发）。
    pub fn is_pull(self) -> bool {
        matches!(self, Trigger::Startup | Trigger::Focus | Trigger::VaultOpen)
    }
}

/// 注入的「本地当前时间」：判定的全部时间输入，构造与判定分离，单测因此不读系统时区。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalNow {
    /// 本地日期 `YYYY-MM-DD`——去重状态的键，也是 `last_fired` 的写入值。
    pub date: String,
    pub weekday: CronWeekday,
    /// 本地时钟自午夜起的分钟数（0..=1439）。
    pub minutes_since_midnight: u16,
}

impl LocalNow {
    /// 从带本地偏移的时刻构造（`Local::now().fixed_offset()` 或测试里的固定偏移）。
    pub fn from_datetime(dt: DateTime<FixedOffset>) -> Self {
        let weekday = match dt.weekday() {
            chrono::Weekday::Mon => CronWeekday::Mon,
            chrono::Weekday::Tue => CronWeekday::Tue,
            chrono::Weekday::Wed => CronWeekday::Wed,
            chrono::Weekday::Thu => CronWeekday::Thu,
            chrono::Weekday::Fri => CronWeekday::Fri,
            chrono::Weekday::Sat => CronWeekday::Sat,
            chrono::Weekday::Sun => CronWeekday::Sun,
        };
        Self {
            date: dt.date_naive().to_string(),
            weekday,
            minutes_since_midnight: (dt.hour() * 60 + dt.minute()) as u16,
        }
    }

    /// 本机本地时间（唯一读时钟的地方；判定函数只收注入值）。
    pub fn now() -> Self {
        Self::from_datetime(Local::now().fixed_offset())
    }
}

// ---------------------------------------------------------------------------
// 解析：at / days
// ---------------------------------------------------------------------------

/// `at` 的解析：`HH:MM`（`00:00`–`23:59`）⇒ 自午夜起的分钟数。
///
/// 严格形态——恰好 5 个字符、冒号在第 3 位、四位都是 ASCII 数字，**不接受**首尾空白 / 单
/// 位数小时 / 缺冒号。非法时返回人话原因（校验 warning 与诊断事件共用这一条文案，避免第二
/// 处真源）。
pub fn parse_at(text: &str) -> Result<u16, &'static str> {
    const REASON: &str = "非法（应为 HH:MM 的 24 小时制时间，00:00–23:59）";
    let bytes = text.as_bytes();
    if bytes.len() != 5
        || bytes[2] != b':'
        || !bytes[..2]
            .iter()
            .chain(bytes[3..].iter())
            .all(|byte| byte.is_ascii_digit())
    {
        return Err(REASON);
    }
    let hour = (bytes[0] - b'0') as u16 * 10 + (bytes[1] - b'0') as u16;
    let minute = (bytes[3] - b'0') as u16 * 10 + (bytes[4] - b'0') as u16;
    if hour > 23 || minute > 59 {
        return Err(REASON);
    }
    Ok(hour * 60 + minute)
}

/// `days` 元素的闭集合解析：`mon` … `sun`。未知取值返回 `None`（校验期丢该项 + warning）。
///
/// 取值表只有一份（[`CronWeekday::as_str`]），这里只是它在调度侧的入口——`at` / `days` 的
/// 解析口径归本模块（design §9），名字清单不在这里再抄一遍。
pub fn parse_weekday(text: &str) -> Option<CronWeekday> {
    CronWeekday::parse(text)
}

// ---------------------------------------------------------------------------
// 判定函数
// ---------------------------------------------------------------------------

/// 判定函数的输入（design §3）：`at` 解析值、`days`、注入的本地时间、去重状态。
pub struct CheckInput<'a> {
    pub at_minutes: u16,
    pub days: &'a [CronWeekday],
    pub now: &'a LocalNow,
    pub last_fired: Option<&'a str>,
}

/// 判定结果。**没有「已满足」这一档**——「今天是不是真的需要做事」由 prompt 在运行时判断，
/// 机制只保证「当日至多触发一次」（design §3）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// 未到点或今天不轮到这个任务。
    NotDue,
    /// 已过点且今日已触发过。
    Done,
    /// 已过点且今日尚未触发。
    Fire,
}

/// 「当下是否已过点」的**唯一判据**：今天轮到这个任务，且本地时钟已越过 `at`。
///
/// 两个消费者共用它（同一组输入、同一个时钟口径）：① 判定函数 [`decide`] 的 `due` 分支；
/// ② 运行期注册的**当日种子**（change add-cron-conversational-registration design §8）。
pub fn due_now(days: &[CronWeekday], at_minutes: u16, now: &LocalNow) -> bool {
    days.contains(&now.weekday) && now.minutes_since_midnight >= at_minutes
}

/// **纯函数**：不读时钟、不碰磁盘。四个触发源都只走它。
pub fn decide(input: &CheckInput) -> Decision {
    if !due_now(input.days, input.at_minutes, input.now) {
        return Decision::NotDue;
    }
    if input.last_fired == Some(input.now.date.as_str()) {
        return Decision::Done;
    }
    Decision::Fire
}

// ---------------------------------------------------------------------------
// 派发策略（判定 + 触达策略的唯一合成点）
// ---------------------------------------------------------------------------

/// 一次不派发的原因（`cron_run_skipped.reason` 的闭集合）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    /// 目标 vault 不是当前打开的 vault（无人值守运行不切换用户界面，design §6.5）。
    VaultNotCurrent,
    /// 该任务上一次运行仍在进行中（同一任务同一时刻至多一个在途运行）。
    Busy,
    /// 运行交接通道未就绪（前端处理器不在场 / 事件投递失败）。
    NotReady,
}

impl SkipReason {
    pub fn as_str(self) -> &'static str {
        match self {
            SkipReason::VaultNotCurrent => "vault_not_current",
            SkipReason::Busy => "busy",
            SkipReason::NotReady => "not_ready",
        }
    }
}

/// 到点后该做什么（副作用在执行层）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Plan {
    /// 无需动作：未到点 / 今日已触发 / 定时器遇到当日已跳过的任务。
    Idle,
    /// `notify-then-run`：投「到点」通知；投递成功才写 `last_fired`。
    Notify,
    /// `run-then-notify` / `silent-run`：发起运行交接；交接被接受才写 `last_fired`。
    Handoff,
    /// 不派发，落 `cron_run_skipped(reason)`。
    Skip(SkipReason),
}

/// [`plan`] 的输入：判定输入 + 派发所需的运行时事实（全部注入，不读任何全局状态）。
pub struct PlanInput<'a> {
    pub task: &'a CronTask,
    pub at_minutes: u16,
    pub now: &'a LocalNow,
    pub last_fired: Option<&'a str>,
    /// 当前打开的 vault 根（未打开时为 `None`）。
    pub current_vault: Option<&'a str>,
    /// 任务目标 vault 的**规范化**路径（canonicalize 后的运行坐标，design §6.5）。配置里的
    /// 绝对路径与 vault 根可能只差软链（macOS `/tmp` → `/private/tmp`），比较必须用同一口径。
    pub target_vault: &'a str,
    /// 该任务是否已有在途运行。
    pub inflight: bool,
    /// 该任务今日是否已经落过一条 `cron_run_skipped`（当日去重，避免日志噪音）。
    pub skipped_today: bool,
    /// 前端接线层是否已就绪（`cron:run` 监听器已在场）。启动早期的交接事件会在 webview 的
    /// JS 监听器存在之前丢掉——未就绪时无人值守运行按 `not_ready` 延后，由前端就绪后的
    /// 一次 poke 重试。
    pub frontend_ready: bool,
    pub trigger: Trigger,
}

/// 判定 + 派发策略的**唯一合成点**：纯函数。
///
/// 规则（design §5 / §5.4 / §6.5）：
/// 1. [`decide`] 不给 `Fire` ⇒ `Idle`；
/// 2. 定时器遇到「今日已跳过」的任务不再尝试（补跑交给下一次拉取触发）；
/// 3. `notify-then-run` 只投通知——点击以前没有任何模型调用；
/// 4. `run-then-notify` / `silent-run` 要发起运行：前端接线层未就绪（`cron:run` 监听器不在场，
///    发射会被静默丢弃）⇒ `not_ready`；当前没有打开 vault ⇒ `not_ready`；目标
///    vault 不是当前 vault ⇒ `vault_not_current`（不切换用户界面）；已有在途运行 ⇒ `busy`。
pub fn plan(input: &PlanInput) -> Plan {
    let decision = decide(&CheckInput {
        at_minutes: input.at_minutes,
        days: &input.task.days,
        now: input.now,
        last_fired: input.last_fired,
    });
    if decision != Decision::Fire {
        return Plan::Idle;
    }
    if !input.trigger.is_pull() && input.skipped_today {
        return Plan::Idle;
    }
    match input.task.delivery {
        DeliveryPolicy::NotifyThenRun => Plan::Notify,
        DeliveryPolicy::RunThenNotify | DeliveryPolicy::SilentRun => {
            if !input.frontend_ready {
                return Plan::Skip(SkipReason::NotReady);
            }
            match input.current_vault {
                None => Plan::Skip(SkipReason::NotReady),
                Some(current) if current != input.target_vault => {
                    Plan::Skip(SkipReason::VaultNotCurrent)
                }
                Some(_) if input.inflight => Plan::Skip(SkipReason::Busy),
                Some(_) => Plan::Handoff,
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 点击通知的落点（判定与副作用的分离点，M752）
// ---------------------------------------------------------------------------

/// 点击通知后该落到哪（副作用在执行层 `lib.rs::CronRunner`）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClickPlan {
    /// 前端接线层未就绪：**保留**这次点击，就绪后再执行。通知一经点掉，系统不会再给第二次
    /// 点击，这里丢弃等于把「点击即意图」丢掉（M752）。
    ///
    /// planner 只报「未就绪」这个事实；**保留还是退回**由接线层按平台定
    /// （[`NotReadyPolicy`]：macOS 的响应已被 delegate 收走 ⇒ 一律保留；非 macOS 的逐条等待
    /// 通道维持既有的「退回 + 提示」）。
    Defer,
    /// 在交互会话槽位发起运行。
    Run,
    /// 已有该任务的会话：只打开它，不重复运行（重复点击幂等）。
    OpenSession(String),
    /// 首次点击发起的运行还没有回执：只聚焦窗口，不产生第二次运行。
    FocusOnly,
    /// 无法落地（`run-then-notify` 没有可恢复的会话 / `silent-run` 没有通知可点）。
    Reject(&'static str),
}

/// [`plan_click`] 的输入：点击那一刻的全部运行时事实（全部注入，不读全局状态）。
pub struct ClickInput<'a> {
    pub delivery: DeliveryPolicy,
    /// 被点的那条通知的种类（change add-cron-notification-relaunch §5.2）：到点通知按「今天跑
    /// 没跑」判，结果 / 失败通知按 [`Self::session_snapshot`] 判。
    pub kind: NoticeKind,
    /// 该条通知的**上下文快照会话**（结果 / 失败通知在场；到点通知恒 `None`）。
    ///
    /// 这是「点的是哪条通知」的唯一答案：MUST NOT 用任务的 `tasks.<task>.session_id`（最新一次
    /// 运行）顶替——同一任务可以有多条通知，各自持有不同的会话。
    pub session_snapshot: Option<&'a str>,
    /// 该任务是否已有在途运行（同一任务同一时刻至多一个）：并发点击时后到者只聚焦。
    pub inflight: bool,
    /// 前端接线层是否已就绪（`cron:run` 监听器已在场）：未就绪时 `app.emit` 返回 Ok 但事件
    /// 无人接收，任何点击都不能当成已落地。
    pub bridge_ready: bool,
    /// 今日是否已有点击记录；`Some(None)` = 有记录但那次运行的回执还没带回会话 id。
    pub clicked_today: Option<Option<&'a str>>,
    /// 去重状态里的会话 id，且该会话是**今天**开始的：进程重启后 `clicked_today` 会丢，
    /// 用它补「今天已经跑过」这一道判据。
    pub state_session_today: Option<&'a str>,
}

/// 点击的落点判定：纯函数，接线层只执行。
///
/// 规则（design §4.5 / §4.6 / §5.1 / §5.2）：
/// 1. 接线层未就绪 ⇒ `Defer`（保留点击，就绪后重放；不落失败诊断、不插点击去重）；
/// 2. `notify-then-run`：今日已点击过 ⇒ 有会话就打开、回执未到就只聚焦；否则去重状态里
///    今日开始的会话 ⇒ 打开；都没有 ⇒ 发起运行；
/// 3. `run-then-notify`：有会话 ⇒ 打开，没有 ⇒ 拒绝（`session_missing`）；
/// 4. `silent-run`：没有通知可点 ⇒ 拒绝（`no_notification`）。
pub fn plan_click(input: &ClickInput<'_>) -> ClickPlan {
    if !input.bridge_ready {
        return ClickPlan::Defer;
    }
    // `silent-run` 没有通知可点（不会走到这里，防御）。
    if input.delivery == DeliveryPolicy::SilentRun {
        return ClickPlan::Reject("no_notification");
    }
    match input.kind {
        NoticeKind::Trigger => {
            if let Some(clicked) = input.clicked_today {
                return match clicked {
                    Some(session_id) => ClickPlan::OpenSession(session_id.to_string()),
                    // 首次点击的运行还没有回执：只聚焦，不产生第二次运行。
                    None => ClickPlan::FocusOnly,
                };
            }
            // 去重记录丢了（进程重启）但仍有在途运行：并发点击的后到者同样只聚焦。
            if input.inflight {
                return ClickPlan::FocusOnly;
            }
            if let Some(session_id) = input.state_session_today {
                return ClickPlan::OpenSession(session_id.to_string());
            }
            ClickPlan::Run
        }
        // 结果 / 失败通知：**只用上下文快照**（`state_session_today` 回答不了这个问题）。
        NoticeKind::Result | NoticeKind::Failure => match input.session_snapshot {
            Some(session_id) => ClickPlan::OpenSession(session_id.to_string()),
            None => ClickPlan::Reject("session_missing"),
        },
    }
}

/// 接线层未就绪期间被保留的点击：通知点掉后系统不会再给一次点击，丢弃等于把用户意图丢掉
/// （M752）；本 change 起存的是**整份已校验上下文**——重放要恢复「被点那条」的会话，只留任务 id
/// 会让重放退化成「按最新会话重算」（§6）。
///
/// 有界（[`Self::LIMIT`] 条）：同一任务后到者覆盖前者（用户点的永远是最后那条），不同任务各留
/// 一条，超出丢最旧。进程退出即丢弃（进程内，不落盘）。
#[derive(Debug, Default)]
pub struct DeferredClick(Vec<(ClickContext, ClickSource)>);

impl DeferredClick {
    /// 保留上限（design §6）：不同任务各一条。
    pub const LIMIT: usize = 4;

    /// 保留一次点击。被顶掉（同任务覆盖 / 超出上限）的条目**返回**给调用方补
    /// `cron_click(ok=false, error=not_ready)`——那次点击确实没能落地，不该静默消失。
    pub fn defer(
        &mut self,
        context: ClickContext,
        source: ClickSource,
    ) -> Vec<(ClickContext, ClickSource)> {
        let mut dropped = Vec::new();
        if let Some(index) = self
            .0
            .iter()
            .position(|(deferred, _)| deferred.task == context.task)
        {
            dropped.push(self.0.remove(index));
        }
        while self.0.len() >= Self::LIMIT {
            dropped.push(self.0.remove(0));
        }
        self.0.push((context, source));
        dropped
    }

    /// 取走全部待执行的点击（一次性：重放之后不再保留）。
    pub fn take_all(&mut self) -> Vec<(ClickContext, ClickSource)> {
        std::mem::take(&mut self.0)
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

// ---------------------------------------------------------------------------
// 投递失败的重试节奏（M637）
// ---------------------------------------------------------------------------

/// 当日投递失败上限：连续失败达到该次数即放弃当天剩余的重试。
///
/// 为什么要有上限：投递失败最常见的成因是**持续的**身份 / 权限问题（未签名的安装包被通知
/// 守护进程拒收，M636 定论），下一次 tick 重试必然同样失败。没有上限时这类失败每 30s 重试
/// 一整天、把同一条 warning 刷满日志（10-23 一天 123 条），真正的信号反而被埋掉。
pub const DELIVERY_RETRY_LIMIT: u32 = 8;

/// 首次失败后的重试间隔（= 一个 tick）。之后每次失败翻倍，封顶 [`DELIVERY_RETRY_MAX`]。
pub const DELIVERY_RETRY_BASE: Duration = TICK;

/// 退避间隔的上限：覆盖显示睡眠 / 通知守护进程重启这类分钟级的瞬时故障，又不至于把重试
/// 拖到用户早已不需要这条提醒的时刻。
pub const DELIVERY_RETRY_MAX: Duration = Duration::from_secs(15 * 60);

/// 第 `failures` 次失败（1-based）到下一次尝试的间隔：指数退避、封顶 15 分钟。
///
/// 序列（`failures` 1..=7）：30s、1m、2m、4m、8m、15m、15m——累计约 45 分钟的重试窗口，
/// 正好覆盖瞬时故障，又给第 [`DELIVERY_RETRY_LIMIT`] 次失败后的放弃留了明确边界。
/// `failures == 0`（没有失败过）返回零间隔。
pub fn delivery_retry_delay(failures: u32) -> Duration {
    if failures == 0 {
        return Duration::ZERO;
    }
    // 2^(failures-1) 会在 u32 上溢出，先夹到封顶所需的上限（5 次翻倍 = 16 分钟 > 封顶）。
    let doublings = failures.saturating_sub(1).min(5);
    DELIVERY_RETRY_BASE
        .saturating_mul(1 << doublings)
        .min(DELIVERY_RETRY_MAX)
}

/// 一条任务的投递失败重试状态（内存态，不落盘）。
///
/// 不落盘的理由：进程重启本身就是一次彻底的重试（主线程 run loop、通知守护进程连接都重建），
/// 把计数写进 `cron-state.json` 会让「今天已经试过 N 次」跨重启生效，反而挡住重启后真正可能
/// 成功的那次尝试。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeliveryRetry {
    /// 计数所属的本地日期（`LocalNow::date`）：跨日重新计数。
    date: String,
    failures: u32,
    /// 下一次允许尝试的时刻。
    next_attempt: Instant,
}

/// 一次失败后的处置：调用方据此决定落哪条日志（第一次失败与当日放弃各一条，中间静默）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryOutcome {
    /// 继续按退避重试：`failures` 是累计次数，`next_in` 是到下一次尝试的间隔。
    Retry { failures: u32, next_in: Duration },
    /// 已达到当日上限，今天不再重试（次日到点窗口重新开始计数）。
    GivenUp { failures: u32 },
}

impl DeliveryRetry {
    pub fn new(date: &str, now: Instant) -> Self {
        Self {
            date: date.to_string(),
            failures: 0,
            next_attempt: now,
        }
    }

    /// 当前是否该尝试投递：当日已放弃则恒 `false`；跨日则 `true`（新的一天重新计）。
    pub fn ready(&self, date: &str, now: Instant) -> bool {
        if self.date != date {
            return true;
        }
        self.failures < DELIVERY_RETRY_LIMIT && now >= self.next_attempt
    }

    /// 记一次失败并推进退避窗口。跨日时先清空旧计数（那一天的失败不该压住今天的第一次尝试）。
    pub fn record_failure(&mut self, date: &str, now: Instant) -> RetryOutcome {
        if self.date != date {
            *self = Self::new(date, now);
        }
        self.failures += 1;
        if self.failures >= DELIVERY_RETRY_LIMIT {
            return RetryOutcome::GivenUp {
                failures: self.failures,
            };
        }
        let next_in = delivery_retry_delay(self.failures);
        self.next_attempt = now + next_in;
        RetryOutcome::Retry {
            failures: self.failures,
            next_in,
        }
    }

    /// 已累计的失败次数（诊断用；调用方靠 [`RetryOutcome`] 决定日志，不靠这个值再判一次）。
    pub fn failures(&self) -> u32 {
        self.failures
    }
}

// ---------------------------------------------------------------------------
// 运行交接载荷（RunSpec + 任务载荷）
// ---------------------------------------------------------------------------

/// 一次运行交接的载荷：运行契约（[`RunSpec`]）+ 任务载荷。
///
/// `RunSpec` 按 change `add-harness-subagents` design §2.1 刻意**不含任务知识**——目标 vault、
/// prompt、会话形态与模型覆盖不是运行契约的一部分。因此交接载荷 = 契约 + 任务载荷；
/// `#[serde(flatten)]` 让两者在线上是一层平铺字段（前端按 `RunSpec` 反序列化契约，另取任务
/// 字段完成 vault / 会话装配），不存在第二套交接形状。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Handoff {
    #[serde(flatten)]
    pub spec: RunSpec,
    /// 触发源字面量（`timer` / `startup` / `focus` / `vault-open` / `click`）：只服务诊断事件
    /// `cron_run_started.trigger`。行为分支（会话槽位 / 批准策略）只读 `spec` 的枚举值，不读这个
    /// 字符串——同一语义不在两处各判一次（REVIEW.md「同一语义两处真源」条）。
    pub trigger: String,
    /// 目标 vault（配置里的路径原值）：前端拿它与已打开的 vault 比，未打开时走既有打开
    /// 链路；判定侧的规范化比较只发生在 `plan` 的 current / target 比较上。
    pub vault: String,
    pub prompt: String,
    /// 会话形态 `new` / `dedicated`（`RunSpec` 不含任务知识，故留在载荷里）。
    pub session: String,
    /// `dedicated` 档的续写会话 id（来自 `cron-state.json`）；`new` 档为 `None`。
    pub session_id: Option<String>,
    pub model: Option<String>,
}

/// [`handoff`] 的输入：全部注入，函数本身不读时钟、随机数或配置。
pub struct HandoffInput<'a> {
    pub task: &'a CronTask,
    /// 本轮运行 id（由调用方生成：[`new_run_id`]）。
    pub run_id: &'a str,
    pub trigger: Trigger,
    /// 目标 vault（配置里的路径原值）。
    pub vault: &'a str,
    /// 运行时轮次上限（`[harness].loop_max`，与 `SessionContext::budget` 同一读数）。
    pub loop_max: u32,
    /// `cron-state.json` 里该任务的续写会话 id。
    pub session_id: Option<&'a str>,
}

/// 运行契约与任务载荷的**唯一**合成点（change `add-harness-subagents` design §2.4）：纯函数。
///
/// - 定时 / 拉取运行 ⇒ `SessionTarget::Unattended` + `ApprovalPolicy::RejectUnavailable`
///   （无人可批即中止，change `add-cron-runtime-daemon` §6.4 的既有语义）；
/// - 点击发起（[`Trigger::Click`]）⇒ `SessionTarget::Interactive` + `ApprovalPolicy::Interactive`
///   （点击是显式意图，批准卡照既有方式出现，design §6.2）；
/// - `budget` 只填轮次上限（cron 没有 token / 时间闸）；`background = false`（cron 走自己的
///   通知链路，不是委托的后台运行）。
pub fn handoff(input: &HandoffInput<'_>) -> Handoff {
    let click = input.trigger == Trigger::Click;
    Handoff {
        spec: RunSpec {
            origin: RunOrigin::Cron {
                task: input.task.id.clone(),
                run_id: input.run_id.to_string(),
            },
            // 无人值守运行在独立 `Runtime` 实例上跑（§6.2 的「等价形态」），槽位键取本轮
            // run_id：每次运行一个槽位，不与其它任务 / 其它轮次共用会话状态。
            session_target: if click {
                SessionTarget::Interactive
            } else {
                SessionTarget::Unattended {
                    key: input.run_id.to_string(),
                }
            },
            // cron 运行与交互路径同权：全部 9 件 vault 操作工具（编排工具 `task` 不在
            // `TOOL_NAMES` 里，cron 也不是委派的父回合）。这份白名单是**被执行**的契约值：
            // `SessionContext` 构造时按它过滤工具定义（M602），`subagents.enabled` 打开也不会
            // 把 `task` 带进无人值守运行。
            tool_policy: ToolPolicy {
                allow: TOOL_NAMES.iter().map(|name| (*name).to_string()).collect(),
            },
            budget: RunBudget {
                max_rounds: input.loop_max,
                max_tokens: 0,
                deadline: None,
            },
            approval_policy: if click {
                ApprovalPolicy::Interactive
            } else {
                ApprovalPolicy::RejectUnavailable
            },
            background: false,
        },
        trigger: input.trigger.as_str().to_string(),
        vault: input.vault.to_string(),
        prompt: input.task.prompt.clone(),
        session: input.task.session.as_str().to_string(),
        session_id: match input.task.session {
            SessionShape::Dedicated => input.session_id.map(str::to_string),
            SessionShape::New => None,
        },
        model: input.task.model.clone(),
    }
}

// ---------------------------------------------------------------------------
// 运行期任务集：装载与重载共用的形态与纯函数
// ---------------------------------------------------------------------------

/// 守护线程的一条待评估任务：配置里的任务 + 解析一次的 `at` 分钟数 + 规范化的目标 vault 根
/// （`canonicalize`——macOS `/tmp` → `/private/tmp` 软链下，配置路径与 vault 根逐字比较会假判
/// 「不是当前 vault」）。启动装载与运行期重载共用同一个构造点（[`schedule_of`]）。
#[derive(Debug, Clone)]
pub struct ScheduledTask {
    pub task: CronTask,
    pub at_minutes: u16,
    pub vault_root: String,
}

/// 把生效任务清单转成调度形态。**启动装载与运行期重载的唯一共用实现**（change
/// add-cron-conversational-registration tasks 3.3）：`parse_at` 与 vault 路径规范化都只在这里。
///
/// 返回的第二项是「校验期已挡住、运行期仍解析不出 `at`」的漂移项（实现漂移 / 校验后文件被改坏）；
/// 调用方据此落 `cron_task_invalid`，不静默丢。
pub fn schedule_of(tasks: &[CronTask]) -> (Vec<ScheduledTask>, Vec<CronTaskIssue>) {
    let mut scheduled = Vec::with_capacity(tasks.len());
    let mut drift = Vec::new();
    for task in tasks {
        match parse_at(&task.at) {
            Ok(at_minutes) => {
                let vault_root = std::fs::canonicalize(&task.vault)
                    .unwrap_or_else(|_| PathBuf::from(&task.vault))
                    .display()
                    .to_string();
                scheduled.push(ScheduledTask {
                    task: task.clone(),
                    at_minutes,
                    vault_root,
                });
            }
            Err(reason) => drift.push(CronTaskIssue {
                task: task.id.clone(),
                field: "at".to_string(),
                reason: reason.to_string(),
            }),
        }
    }
    (scheduled, drift)
}

/// 重载回执（change add-cron-conversational-registration design §3.1）：守护线程处理完一次
/// 重载后给调用方的一次性答复。`applied` = 替换后的任务数，`seeded` = 写了当日种子的 id，
/// `error` = 本次重载失败的原因（失败时线程保留原任务集）。
#[derive(Debug, Clone)]
pub struct ReloadOutcome {
    pub applied: usize,
    pub seeded: Vec<String>,
    pub error: Option<String>,
    /// 本次重载时线程读到的通知权限快照（M635）：注册回执据此判断要不要告知用户「通知送不
    /// 出去」。它是**同一次申请**的回流，不构成第二处申请。
    pub notify_permission: NotifyPermission,
}

/// 把重载回执投影成工具侧可见的生效状态（design §2.4 / §3.8）：**只有收到回执且没有失败原因**
/// 才算 `Active`；回执超时（`None`，线程不在或 1s 内没处理）或失败回执一律 `pending_restart`。
pub fn effect_of(outcome: Option<&ReloadOutcome>) -> (CronEffect, Vec<String>) {
    match outcome {
        Some(outcome) if outcome.error.is_none() => (CronEffect::Active, outcome.seeded.clone()),
        _ => (CronEffect::PendingRestart, Vec::new()),
    }
}

// ---------------------------------------------------------------------------
// 通知权限（M635：拒权可见性）
// ---------------------------------------------------------------------------

/// 通知权限的判据快照。**判据只有一处**：`lib.rs` 的 `ensure_notification_permission`
/// 在 macOS 打包实例上申请 / 读取一次，结果随重载回执与注册回执回流，注册回执与
/// `config_warning` 读的是同一份快照（MUST NOT 另起一次申请——「未决定」时申请会弹系统
/// 对话框，第二处申请等于让注册动作多弹一次窗）。
///
/// **「被拒」有两种成因，措辞必须分开**（M636 定论，2026-10-23）：macOS 26 的
/// usernotificationsd 按**调用进程的代码签名身份**判定资格。安装包只有 linker ad-hoc 签名
/// （Info.plist 未绑定、TeamIdentifier 为空）时，系统认不到该 bundle id，`requestAuthorization`
/// 与 `addNotificationRequest` 一律被拒；此时系统设置里「Lumir」条目即使开着，也属于**另一个
/// 签过名的身份**（探针 / 验收副本），与本进程无关——让用户「去系统设置打开」是误导。
/// 判据因此读 `authorizationStatus`：`NotDetermined`（系统里没有本客户端的授权记录）⇒
/// [`NotifyPermission::Unrecognized`]，`Denied` ⇒ [`NotifyPermission::Denied`]。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotifyPermission {
    /// 已授权；或该平台 / 运行形态没有可查询的权限模型（dev flavour 走 legacy 投递、非 macOS
    /// 没有查询 API）——这两种情况不阻断任何动作，投递失败仍交给 design §5.4 的下一次评估。
    Granted,
    /// 用户在系统设置里明确拒绝过本应用的通知。
    Denied,
    /// 系统里没有本客户端的授权记录：签名身份没被认可（安装包缺少有效签名）。设置里开着的
    /// 条目属于别的身份，改它没有用。
    Unrecognized,
    /// 申请 / 查询本身失败：**无法判定**。与上面两档分开，不把人话提示建立在猜测上。
    Unknown,
}

impl NotifyPermission {
    /// 通知送不出去（用户拒绝 / 系统不认可身份）：注册回执与可见提示要说话的两种情况。
    pub fn blocks_delivery(self) -> bool {
        matches!(
            self,
            NotifyPermission::Denied | NotifyPermission::Unrecognized
        )
    }
}

/// 注册回执里「通知送不出去」的告知句（文案 deck 的 D551 / D552）。
///
/// **消费者是 Rust 侧**（`lib.rs` 的 `CronToolPort::create` 把它放进注册回执）：模型读到工具
/// 回执后按 `cron-reference.md` 的指令原样转达给用户。取哪一列由注册那一刻的界面语言决定
/// （与 D321 的选择口径同源：注册是一次性动作，早于它 / 晚于它的界面语言切换不回溯改句）。
///
/// 两档措辞对应两种成因（见 [`NotifyPermission`]）：`Denied` 才让用户去系统设置打开；
/// `Unrecognized` 说的是签名身份没被认可——设置里的条目是别的身份，改它不解决问题。
pub fn notify_permission_notice(
    permission: NotifyPermission,
    language: UiLanguage,
) -> Option<&'static str> {
    match (permission, language) {
        (NotifyPermission::Denied, UiLanguage::Zh) => Some(
            "通知权限被拒，通知无法送达。这条任务到点不会有提醒。请到「系统设置 › 通知 › Lumir」里打开通知权限",
        ),
        (NotifyPermission::Denied, UiLanguage::En) => Some(
            "Notification permission is denied, so this task won't alert you when it's due. Allow notifications for Lumir in System Settings › Notifications",
        ),
        (NotifyPermission::Unrecognized, UiLanguage::Zh) => Some(
            "系统未认可当前 Lumir 的通知身份（安装包缺少有效签名），通知无法送达。这条任务到点不会有提醒",
        ),
        (NotifyPermission::Unrecognized, UiLanguage::En) => Some(
            "macOS doesn't recognize this Lumir's notification identity (the installed app lacks a valid signature), so notifications can't be delivered. This task won't alert you when it's due",
        ),
        _ => None,
    }
}

/// 注册回执要不要带「通知送不出去」的告知（M635 的判别点，纯函数）。
///
/// 只有 `notify-then-run` 档依赖通知投递：`silent-run` 本来就不发通知；`run-then-notify` 的
/// 运行照常发生，通知发不出去由「投递连续失败」的可见提示收口（[`NotifyFailureStreak`]）
/// ——注册时先报一条会让同一件事说两遍。权限判为 `Unknown` 时不报：没读到结论就不声称坏了。
pub fn registration_notice(
    delivery: DeliveryPolicy,
    permission: NotifyPermission,
    language: UiLanguage,
) -> Option<&'static str> {
    if delivery != DeliveryPolicy::NotifyThenRun || !permission.blocks_delivery() {
        return None;
    }
    notify_permission_notice(permission, language)
}

/// 投递连续失败时可见提示的 `code`（`cron:notice` 载荷的取值，文案在
/// `src/copy-data.ts` 的 `CRON_NOTICE_COPY` 里登记）。
///
/// 身份没被认可是最常见的成因（M636），两档分开是为了不把用户引向「去打开一个开着的开关」；
/// 其它成因（含已授权却投递失败、无法判定）统一走通用档。
pub fn delivery_failed_code(permission: Option<NotifyPermission>) -> &'static str {
    match permission {
        Some(NotifyPermission::Unrecognized) => "cron_notify_delivery_failed_identity",
        _ => "cron_notify_delivery_failed",
    }
}

// ---------------------------------------------------------------------------
// 投递连续失败（M635：app 内可见提示）
// ---------------------------------------------------------------------------

/// 投递连续失败的可见提示阈值：达到即上屏一次，同一段连续失败只上屏一次。
///
/// 3 次的取法：`notify-then-run` 的投递失败按退避重试（首次 30s，见 [`DeliveryRetry`]，M637），
/// 3 次 ≈ 1.5 分钟——足以排除一次抖动，又不至于让用户等到下次交互才发现提醒根本没来。
pub const NOTIFY_FAILURE_NOTICE_AFTER: u32 = 3;

/// 通知投递的连续失败计数：**纯状态**，不含上屏动作（上屏在 `lib.rs` 的接线层）。
///
/// 计数是**全进程**的，不分任务：失败原因是应用级的（权限 / 投递后端），按任务各记一份只会
/// 让同一件事在若干任务上各报一遍。
#[derive(Debug, Default)]
pub struct NotifyFailureStreak {
    consecutive: u32,
    surfaced: bool,
}

impl NotifyFailureStreak {
    /// 记一次成功：清零，并把「本段已上屏」复位——下一段连续失败会重新提示。
    pub fn record_success(&mut self) {
        self.consecutive = 0;
        self.surfaced = false;
    }

    /// 记一次失败。返回 `Some(次数)` = **这一次**该上屏（已达阈值且本段尚未上屏过）；
    /// 其余情况返回 `None`，调用方据此不重复打扰。
    pub fn record_failure(&mut self) -> Option<u32> {
        self.consecutive = self.consecutive.saturating_add(1);
        if self.consecutive >= NOTIFY_FAILURE_NOTICE_AFTER && !self.surfaced {
            self.surfaced = true;
            return Some(self.consecutive);
        }
        None
    }

    /// 当前连续失败次数（诊断事件与上屏文案的 `{count}` 共用这一读数）。
    pub fn consecutive(&self) -> u32 {
        self.consecutive
    }
}

/// 一次重载的计划（纯函数的输出）：新任务集 + 被删除的 id + 写入当日种子的 id + 轮次预算。
#[derive(Debug, Clone)]
pub struct ReloadPlan {
    /// 替换后的任务集。
    pub tasks: Vec<ScheduledTask>,
    /// 本次从任务集消失的 id（调用方据此清理 `skipped_today` / `clicked_today`；
    /// **在途运行不在此列**——它还要收尾并回执）。
    pub removed: Vec<String>,
    /// 本次写入当日种子的任务 id（`ack.seeded`、工具回执的 `skip_today` 都读它）。
    pub seeded: Vec<String>,
    /// 随配置读数更新的轮次预算（`[harness].loop_max`，交接载荷的唯一预算来源）。
    pub loop_max: u32,
}

/// 运行期重载的**纯函数**部分（change add-cron-conversational-registration design §3.3）：
/// 不读时钟、不碰磁盘、不做 IO——时钟由调用方注入，状态只改内存副本。
///
/// 规则：只有**本次新增**的任务可能写当日种子，判据是 [`due_now`]（与判定函数同一组输入）；
/// 启动装载引入的任务不走这里（启动补触发是既有语义，design §8）。
pub fn plan_reload(
    previous: &[ScheduledTask],
    next: Vec<ScheduledTask>,
    loop_max: u32,
    now: &LocalNow,
    state: &mut CronState,
) -> ReloadPlan {
    let previous_ids: BTreeSet<&str> = previous
        .iter()
        .map(|scheduled| scheduled.task.id.as_str())
        .collect();
    let mut seeded = Vec::new();
    for scheduled in &next {
        if previous_ids.contains(scheduled.task.id.as_str()) {
            continue;
        }
        if due_now(&scheduled.task.days, scheduled.at_minutes, now) {
            state.mark_fired(&scheduled.task.id, &now.date);
            seeded.push(scheduled.task.id.clone());
        }
    }
    let next_ids: BTreeSet<&str> = next
        .iter()
        .map(|scheduled| scheduled.task.id.as_str())
        .collect();
    let removed = previous_ids
        .into_iter()
        .filter(|id| !next_ids.contains(*id))
        .map(str::to_string)
        .collect();
    ReloadPlan {
        tasks: next,
        removed,
        seeded,
        loop_max,
    }
}

/// 重载后清理「属于被删任务、且纯内存、无后续消费者」的记录（design §3.3 第 5 步）：
/// `skipped_today` / `clicked_today` 只服务派发与点击去重，任务不再存在即无意义。
///
/// **in-flight 记录不经过这里**（调用方不传它）：被删任务的在途运行还要收尾并回执，
/// MUST NOT 因任务消失而丢弃终态。
pub fn retain_live_tasks<T>(
    entries: &mut std::collections::HashMap<String, T>,
    removed: &[String],
) {
    entries.retain(|task, _| !removed.contains(task));
}

// ---------------------------------------------------------------------------
// 触发去重状态（cron-state.json）
// ---------------------------------------------------------------------------

/// 单个任务的去重记录。两个字段都可缺：`last_fired` 在派发成功或运行期注册写当日种子时写，
/// `session_id` 只在运行终态回执带回时写。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CronTaskRecord {
    /// 该本地日期不再派发的判据（派发成功或注册种子写入；`YYYY-MM-DD`）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_fired: Option<String>,
    /// 最近一次运行落到的会话 id：`dedicated` 的续写与结果通知点击后的会话恢复都靠它。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

/// `cron-state.json` 的形态。任务从配置删掉后其记录**惰性残留**——不为清理做启动期扫描
/// （design §8）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CronState {
    pub version: u32,
    pub tasks: BTreeMap<String, CronTaskRecord>,
    /// 通知台账（change add-cron-notification-relaunch §4）：request id → 派发快照。
    /// 只在 macOS 打包实例写入；`#[serde(default)]` 让旧文件读进来就是空台账（不做迁移）。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub notices: BTreeMap<String, NoticeRecord>,
}

impl Default for CronState {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            tasks: BTreeMap::new(),
            notices: BTreeMap::new(),
        }
    }
}

impl CronState {
    /// 该任务今日是否已不再派发（判定与派发共用的唯一读数：派发成功与注册种子都写它）。
    pub fn last_fired(&self, task: &str) -> Option<&str> {
        self.tasks
            .get(task)
            .and_then(|record| record.last_fired.as_deref())
    }

    /// 写 `last_fired` 的唯一入口（`date` 是本地日期，不是 UTC）：派发成功与运行期注册种子共用。
    pub fn mark_fired(&mut self, task: &str, date: &str) {
        let record = self.tasks.entry(task.to_string()).or_default();
        record.last_fired = Some(date.to_string());
    }

    /// 运行终态回执带回的会话 id（`None` 表示该次运行没有会话，不改写既有值）。
    pub fn set_session(&mut self, task: &str, session_id: Option<&str>) {
        let Some(session_id) = session_id else {
            return;
        };
        let record = self.tasks.entry(task.to_string()).or_default();
        record.session_id = Some(session_id.to_string());
    }

    pub fn session_id(&self, task: &str) -> Option<&str> {
        self.tasks
            .get(task)
            .and_then(|record| record.session_id.as_deref())
    }

    /// 台账条目（跨进程点击的唯一依据）：`None` = 本机没有这条通知的记录。
    pub fn notice(&self, request_id: &str) -> Option<&NoticeRecord> {
        self.notices.get(request_id)
    }

    /// 写一条台账条目（写入即快照）并做有界裁剪。
    ///
    /// **原子性由调用方负责**：两条写入路径都要求这一次 `save_state` 里同时含本条目与该路径的
    /// 去重事实（到点通知 = `last_fired`；结果 / 失败通知 = 当时的完整状态）。因此本函数只改
    /// 内存，落盘一律由调用方紧接着的那次 [`save_state`] 完成。
    pub fn record_notice(&mut self, request_id: &str, record: NoticeRecord, today: &str) {
        self.notices.insert(request_id.to_string(), record);
        self.prune_notices(today);
    }

    /// 台账有界（§4）：先按保留窗口裁，再按条数上限裁；顺序键是「派发日期 + request id」。
    /// MUST NOT 触碰 `tasks` 段。
    fn prune_notices(&mut self, today: &str) {
        if let Ok(today_date) = chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d") {
            let cutoff = (today_date - chrono::Duration::days(NOTICE_LEDGER_KEEP_DAYS)).to_string();
            self.notices.retain(|_, record| record.date >= cutoff);
        }
        while self.notices.len() > NOTICE_LEDGER_MAX {
            let oldest = self
                .notices
                .iter()
                .min_by(|left, right| {
                    (left.1.date.as_str(), left.0.as_str())
                        .cmp(&(right.1.date.as_str(), right.0.as_str()))
                })
                .map(|(request_id, _)| request_id.clone());
            match oldest {
                Some(request_id) => {
                    self.notices.remove(&request_id);
                }
                None => break,
            }
        }
    }
}

/// 状态文件路径（配置目录根下，与 `window-state.json` 同级）。
pub fn state_path(config_dir: &Path) -> PathBuf {
    config_dir.join(STATE_FILE_NAME)
}

/// 读取触发去重状态。四类失败——文件缺失、不可读、非合法 JSON、`version` 不符——对调用方
/// 的语义**完全相同**：「没有去重状态」（最多导致一次重复触发）。一律不抛错、不阻断启动；
/// 缺失是常态不告警，其余三类各返回一条人话 warning。
pub fn load_state(path: &Path) -> (CronState, Vec<String>) {
    let display = path.display();
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return (CronState::default(), Vec::new());
        }
        Err(error) => {
            return (
                CronState::default(),
                vec![format!(
                    "无法读取触发去重状态 {display}：{error}，已按无状态处理（今日可能重复触发一次）"
                )],
            );
        }
    };
    let parsed: serde_json::Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(error) => {
            return (
                CronState::default(),
                vec![format!(
                    "触发去重状态 {display} 不是合法 JSON（{error}），已按无状态处理（今日可能重复触发一次）"
                )],
            );
        }
    };
    let version = parsed.get("version").and_then(|value| value.as_u64());
    if version != Some(STATE_VERSION as u64) {
        return (
            CronState::default(),
            vec![format!(
                "触发去重状态 {display} 的 version 与实现（v{STATE_VERSION}）不符，已按无状态处理（今日可能重复触发一次）"
            )],
        );
    }
    match serde_json::from_value::<CronState>(parsed) {
        Ok(state) => (state, Vec::new()),
        Err(error) => (
            CronState::default(),
            vec![format!(
                "触发去重状态 {display} 的形状不合法（{error}），已按无状态处理（今日可能重复触发一次）"
            )],
        ),
    }
}

/// 写触发去重状态：临时文件 + `rename` 原子替换。失败返回人话原因（调用方降级为 warning，
/// 最多导致一次重复通知 / 重复触发，design §8 接受）。
pub fn save_state(path: &Path, state: &CronState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("无法创建配置目录 {}：{error}", parent.display()))?;
    }
    let body = serde_json::to_string_pretty(state)
        .map_err(|error| format!("触发去重状态无法序列化：{error}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|error| format!("无法写入 {}：{error}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|error| format!("无法落盘 {}：{error}", path.display()))
}

/// 一次通知的时钟读数（毫秒）：**request id 与平台 id 的唯一共同来源**。
///
/// 两个 id 必须同源（tasks 1.4「返回值与系统里的请求标识是同一个」）：分两次取时钟会得到两个
/// 不同的数，非 macOS 上「返回的 request id」就与系统里的通知 id 对不上——点击响应按平台 id
/// 路由，等于把上下文表与系统脱钩。
pub fn notify_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0)
}

/// 台账与上下文用的 request id（macOS / 诊断可读形态）：`lumir-cron-{task}-{kind}-{millis}`。
///
/// 形状只是给人看的线索，**不被解析**（任务 id 允许含 `-`）：识别一律查台账 / 上下文表。
pub fn notification_request_id(task: &str, kind: NoticeKind, millis: u128) -> String {
    format!("lumir-cron-{task}-{}-{millis}", kind.as_str())
}

/// 非 macOS 的平台通知 id（notify-rust 的跨平台 API 是 `u32`），与 [`notification_request_id`]
/// **同一份 `millis`**。低位截断足够区分「不同次投递」，也更贴合平台的 id 语义。
pub fn platform_notification_id(millis: u128) -> u32 {
    (millis % u32::MAX as u128) as u32
}

/// 非 macOS 上对外的 request id：**平台 id 的十进制形态**——返回值与系统里的标识逐字相同
/// （`notify_rust::Notification::id(platform_notification_id(millis))`）。
pub fn platform_request_id(millis: u128) -> String {
    platform_notification_id(millis).to_string()
}

/// 运行交接的 `run_id`：进程内自增序号 + 毫秒时间戳 + 随机段（日志里可读、进程内唯一）。
pub fn new_run_id() -> String {
    static SEQ: AtomicU32 = AtomicU32::new(0);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{millis:x}-{seq:x}-{:04x}", rand::random::<u16>())
}

// ---------------------------------------------------------------------------
// 通知台账 / 点击上下文 / 接收判据（change add-cron-notification-relaunch）
// ---------------------------------------------------------------------------
//
// 本段全部是**纯函数与纯状态**（ADR 0002 第 7 条）：点击「是否被接受、接受后做什么」在进
// 副作用之前就已决定，副作用（聚焦窗口、emit、运行交接、写盘）全在 `lib.rs` 的接线层。
// 两条接收通道（进程内 / 跨进程）只在这里分叉一次，之后共用同一份 [`ClickContext`]。

/// 台账保留窗口（天）：派发日期早于「今天 − 该值」的条目在每次写入时裁掉（§4「有界」）。
pub const NOTICE_LEDGER_KEEP_DAYS: i64 = 7;

/// 台账条数上限：超出按「派发日期 + request id」排序丢最旧。
pub const NOTICE_LEDGER_MAX: usize = 32;

/// 一条已投递通知的种类（与 `cron_notified.kind` 同一词表，也是通知正文的分档依据）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoticeKind {
    /// `notify-then-run` 的「到点」通知：点击 = 发起运行。
    Trigger,
    /// `run-then-notify` 成功终态后的「已完成」通知：点击 = 恢复该次运行的会话。
    Result,
    /// `run-then-notify` 失败终态后的「运行失败」通知：同上（恢复，不重跑）。
    Failure,
}

impl NoticeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            NoticeKind::Trigger => "trigger",
            NoticeKind::Result => "result",
            NoticeKind::Failure => "failure",
        }
    }
}

/// 台账条目：写入即快照，后续运行 MUST NOT 改写既有条目。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoticeRecord {
    /// 任务 id（原样存储，不做切分或解析——任务 id 允许含 `-`）。
    pub task: String,
    pub kind: NoticeKind,
    /// 派发的本地日期（`YYYY-MM-DD`）：跨天点击的判据。
    pub date: String,
    /// 该次运行的会话标识（结果 / 失败通知在场；到点通知没有）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

/// 已校验的点击上下文（§5.2）：两个入口交出**同一形状**，处置层只按它分叉。
///
/// 结构上刻意不持有「任务最新会话」之类可回读的位置：结果 / 失败通知的会话只来自
/// `session_id`（投递点那一次构造的快照），因此「读最新会话」的实现无法从这份结构里取到值。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClickContext {
    /// 台账的键（进程内通道为投递时生成的 id）；诊断与去重都用它。
    pub request_id: String,
    /// 任务 id（已校验仍在当前任务集）。
    pub task: String,
    /// 通知种类——决定「发起运行」还是「恢复会话」。
    pub kind: NoticeKind,
    /// 该条通知的**快照**会话标识（到点通知为 `None`）。
    pub session_id: Option<String>,
    /// 派发本地日期（跨进程通道已校验等于今天）。
    pub date: String,
}

impl ClickContext {
    /// 从台账条目构造上下文（跨进程通道）。
    pub fn from_notice(request_id: &str, notice: &NoticeRecord) -> Self {
        Self {
            request_id: request_id.to_string(),
            task: notice.task.clone(),
            kind: notice.kind,
            session_id: notice.session_id.clone(),
            date: notice.date.clone(),
        }
    }

    /// 从投递点那一次构造直接生成上下文（进程内通道）：与台账条目同源同形——两条通道的差别
    /// 只在「从哪里取回这份上下文」，不在形状。
    pub fn from_delivery(
        request_id: &str,
        task: &str,
        kind: NoticeKind,
        session_id: Option<&str>,
        date: &str,
    ) -> Self {
        Self {
            request_id: request_id.to_string(),
            task: task.to_string(),
            kind,
            session_id: session_id.map(str::to_string),
            date: date.to_string(),
        }
    }

    /// 该上下文的台账条目形态（写入点与进程内表登记共用这一份构造）。
    pub fn notice(&self) -> NoticeRecord {
        NoticeRecord {
            task: self.task.clone(),
            kind: self.kind,
            date: self.date.clone(),
            session_id: self.session_id.clone(),
        }
    }
}

/// 点击的来源（`cron_click.source` 的闭集合）：只影响诊断，不影响处置。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClickSource {
    /// 投递它的进程内被点击（所有平台；上下文来自进程内上下文表）。
    InProcess,
    /// 投递它的进程已退出，系统拉起新进程后点击（仅 macOS 打包实例；上下文来自台账）。
    Relaunch,
}

impl ClickSource {
    pub fn as_str(self) -> &'static str {
        match self {
            ClickSource::InProcess => "in-process",
            ClickSource::Relaunch => "relaunch",
        }
    }
}

/// 已校验点击被拒的分类原因（`cron_click.error` 的闭集合，三条互不合并）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClickRejection {
    /// 台账里没有该 request id（旧版本遗留 / 已被裁剪 / 台账写失败）：不上屏提示。
    NoticeUnknown,
    /// 台账里的任务已被删除。
    TaskUnknown,
    /// 派发日期不是今天（跨天点击）。
    NoticeStale,
}

impl ClickRejection {
    pub fn as_str(self) -> &'static str {
        match self {
            ClickRejection::NoticeUnknown => "notice_unknown",
            ClickRejection::TaskUnknown => "task_unknown",
            ClickRejection::NoticeStale => "notice_stale",
        }
    }

    /// 用户可见提示的文案 code（`CRON_NOTICE_COPY` 的键）。
    ///
    /// `notice_unknown` 刻意没有提示：旧版本遗留 / 被裁剪的通知被点属正常噪声，弹一条
    /// 「这条提醒不认识」只会吵人。
    pub fn notice_code(self) -> Option<&'static str> {
        match self {
            ClickRejection::NoticeUnknown => None,
            ClickRejection::TaskUnknown => Some("cron_click_task_deleted"),
            ClickRejection::NoticeStale => Some("cron_click_notice_stale"),
        }
    }
}

/// [`accept_click`] 的输入：两条通道各自的上下文来源 + 两条共用判据的运行时事实。
pub struct AcceptInput<'a> {
    pub request_id: &'a str,
    /// **进程内上下文表**命中项（所有平台；`None` = 本进程没有投递过这条通知）。
    /// 命中即证明来源成立，因此进程内通道**不读** `state`（台账写失败不影响它）。
    pub in_process: Option<&'a ClickContext>,
    /// **通知台账**（仅 macOS 打包实例有内容；其它平台恒空）。
    pub state: &'a CronState,
    /// 当前任务集的 id 集合。
    pub live_tasks: &'a [String],
    /// 今天的本地日期（`YYYY-MM-DD`）。
    pub today: &'a str,
}

/// 接收判据（§5.1）：四条全过才算「被接受的点击」，否则按分类原因拒绝。
///
/// 判据 1（动作归一化为 `tap`）由平台层在进入本函数之前完成（[`normalize_action`]）：
/// 非 `tap` 的响应根本不进处置，也就不会走到这里。
pub fn accept_click(
    input: &AcceptInput<'_>,
) -> Result<(ClickContext, ClickSource), ClickRejection> {
    let (context, source) = resolve_context(input).ok_or(ClickRejection::NoticeUnknown)?;
    if !input.live_tasks.iter().any(|id| id == &context.task) {
        return Err(ClickRejection::TaskUnknown);
    }
    if context.date != input.today {
        return Err(ClickRejection::NoticeStale);
    }
    Ok((context, source))
}

/// 判据 2（上下文来源）单独一步：命中即给出上下文与来源，判据 3 / 4 由 [`accept_click`] 接着判。
///
/// 拆出来的唯一用途是**诊断**：被拒绝时调用方仍想知道「这条通知是发给哪个任务、什么种类」——
/// `notice_unknown` 连上下文都没有，那条日志的 task 只能是空串。
pub fn resolve_context(input: &AcceptInput<'_>) -> Option<(ClickContext, ClickSource)> {
    match input.in_process {
        // 进程内通道：命中即证明这条通知是本进程投递的——**不读台账**。
        Some(context) => Some((context.clone(), ClickSource::InProcess)),
        // 跨进程通道：按 request id 反查台账。
        None => input.state.notice(input.request_id).map(|notice| {
            (
                ClickContext::from_notice(input.request_id, notice),
                ClickSource::Relaunch,
            )
        }),
    }
}

/// 通知动作（§3 第 3 条）：平台层把系统的动作标识归一化到这份内部词表。
///
/// 补这一层的原因是自持平台层删掉了 `mac-usernotifications` + `notify-rust` 的转换层：
/// 若把系统原始字符串直接交给 `Tap` 判据，**所有正文点击都会被当成非 tap 忽略**（本 change
/// 要修的跨进程点击首当其冲）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NoticeAction {
    /// 点通知本体（系统默认动作）。
    Tap,
    /// 用户关掉通知（系统 dismiss 动作）。
    Dismiss,
    /// 自定义动作按钮（本仓没有动作按钮，属防御）。
    Custom(String),
}

/// 系统默认动作标识（Apple 的常量值）：点通知正文时报上来的就是它。
pub const UN_DEFAULT_ACTION_IDENTIFIER: &str = "com.apple.UNNotificationDefaultActionIdentifier";

/// 系统 dismiss 动作标识。
pub const UN_DISMISS_ACTION_IDENTIFIER: &str = "com.apple.UNNotificationDismissActionIdentifier";

/// 动作标识 → 内部词表（**唯一**归一化点）。
pub fn normalize_action(identifier: &str) -> NoticeAction {
    if identifier == UN_DEFAULT_ACTION_IDENTIFIER {
        return NoticeAction::Tap;
    }
    if identifier == UN_DISMISS_ACTION_IDENTIFIER {
        return NoticeAction::Dismiss;
    }
    NoticeAction::Custom(identifier.to_string())
}

/// 界面未就绪时的策略（`handle_click` 的附加参数，§5.1 的「未就绪时保留还是退回」）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotReadyPolicy {
    /// 保留整份上下文，接线层就绪后重放（macOS：用户手里没有第二次点击的机会）。
    Defer,
    /// 立即退回 `not_ready` 并提示（非 macOS 的逐条等待通道，既有语义）。
    Reject,
}

/// 同日点击记录（`clicked_today` 的值）：日期 + 该次运行回执带回的会话。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClickedNotice {
    pub date: String,
    pub session_id: Option<String>,
}

/// 会话 id 是否属于今天（`s<unix_millis>-<suffix>` 的格式由 `jsonl::new_session_id` 唯一产出）：
/// 进程重启后 `clicked_today` 丢了，靠它把「今天已经跑过」与「昨天留下的 session_id」分开。
pub fn session_started_today(session_id: &str, now: &LocalNow) -> bool {
    use chrono::TimeZone;
    let millis = session_id
        .strip_prefix('s')
        .and_then(|rest| rest.split('-').next())
        .and_then(|value| value.parse::<i64>().ok());
    let Some(millis) = millis else {
        return false;
    };
    chrono::Local
        .timestamp_millis_opt(millis)
        .single()
        .map(|moment| moment.date_naive().to_string() == now.date)
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// 调度工具（cron_task_create / list / remove）的领域面
// ---------------------------------------------------------------------------
//
// 本段是**没有 tauri 依赖**的那一半（ADR 0002 第 7 条）：参数草稿 → 校验 → 读—改—写同一把锁
// （`config::update_json_atomic`）→ 生效任务。运行期重载通道（`CronMessage::Reload`）在
// `lib.rs` 的接线层，经 [`CronPort`] 注入；工具执行侧（`harness::tools`）只经端口取结果。

/// `cron_task_create` 的参数草稿：**只保模型实际给出的字段**（值为 `None` 的键不写进配置——
/// 缺省值跟随出厂默认，写死会把「跟随默认」钉成写入当天的取值，design §4.2）。
///
/// 字段保留原始 JSON 值而不是先反序列化成强类型：形状错误（`"at": 21`）要走与装载期**同一句**
/// 原因文案（`cron_task_invalid(field=at)`），先 serde 解析会把它变成另一种错误口径。
#[derive(Debug, Clone, Default)]
pub struct CronTaskDraft {
    pub id: Option<serde_json::Value>,
    pub at: Option<serde_json::Value>,
    pub prompt: Option<serde_json::Value>,
    pub vault: Option<serde_json::Value>,
    pub days: Option<serde_json::Value>,
    pub delivery: Option<serde_json::Value>,
    pub session: Option<serde_json::Value>,
    pub model: Option<serde_json::Value>,
}

impl CronTaskDraft {
    /// 从工具参数取已知键（未知键忽略；`null` 视同缺席）。
    ///
    /// `default_vault` 是会话当前 vault 根：`vault` 缺席时**必须落成绝对路径**（运行坐标不能在
    /// 运行期重新推导，design §4.2 的唯一例外）。
    pub fn from_args(args: &serde_json::Value, default_vault: &str) -> Self {
        let value = |key: &str| args.get(key).filter(|value| !value.is_null()).cloned();
        Self {
            id: value("id"),
            at: value("at"),
            prompt: value("prompt"),
            vault: value("vault").or_else(|| Some(serde_json::Value::String(default_vault.into()))),
            days: value("days"),
            delivery: value("delivery"),
            session: value("session"),
            model: value("model"),
        }
    }

    /// 待校验 / 待写入的任务项：**只含给出的键**（`id` / `at` / `prompt` / `vault` 恒在）。
    fn item(&self) -> serde_json::Map<String, serde_json::Value> {
        let mut item = serde_json::Map::new();
        let mut put = |key: &str, value: &Option<serde_json::Value>| {
            if let Some(value) = value {
                item.insert(key.to_string(), value.clone());
            }
        };
        put("id", &self.id);
        put("at", &self.at);
        put("prompt", &self.prompt);
        put("vault", &self.vault);
        put("days", &self.days);
        put("delivery", &self.delivery);
        put("session", &self.session);
        put("model", &self.model);
        item
    }
}

/// 调度工具的结构化失败（工具信封 `{"ok":false,"code","message"}` 的来源）。
///
/// `reason` 保留与装载期**逐字相同**的那句原因（`message` 已把 `field` 与它拼在一起）——两条
/// 通道共用 [`crate::config::validate_cron_task`]，文案不在这里另写一份。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CronToolError {
    pub code: String,
    pub message: String,
    /// 第一处问题所在字段（`cron_task_rejected` 的 `field`；无字段时为 `None`）。
    pub field: Option<String>,
    /// 与装载期同一句原因（`message` 的组成部分）。
    pub reason: Option<String>,
    /// 相关任务 id（可能为空：id 本身不可读时）。
    pub task: Option<String>,
}

impl CronToolError {
    fn invalid(issue: CronTaskIssue) -> Self {
        Self {
            code: "cron_task_invalid".to_string(),
            message: format!("{}：{}", issue.field, issue.reason),
            field: Some(issue.field),
            reason: Some(issue.reason),
            task: Some(issue.task),
        }
    }

    fn exists(id: &str, existing_at: &str) -> Self {
        Self {
            code: "cron_task_exists".to_string(),
            message: format!(
                "任务 id \"{id}\" 已存在（at = {existing_at}）：请先用 cron_task_remove 删除，或换一个 id"
            ),
            field: Some("id".to_string()),
            reason: Some("与既有任务重名".to_string()),
            task: Some(id.to_string()),
        }
    }

    fn not_found(id: &str) -> Self {
        Self {
            code: "cron_task_not_found".to_string(),
            message: format!("任务 id \"{id}\" 不存在"),
            field: Some("id".to_string()),
            reason: Some("不存在该任务".to_string()),
            task: Some(id.to_string()),
        }
    }

    /// `cron_task_remove` 的 `id` 缺失 / 不是字符串（该工具没有装载期对照，原因文案在此定义）。
    pub fn missing_id() -> Self {
        Self {
            code: "cron_task_invalid".to_string(),
            message: "id：缺失或不是字符串".to_string(),
            field: Some("id".to_string()),
            reason: Some("缺失或不是字符串".to_string()),
            task: None,
        }
    }

    /// 落盘失败的映射：沿用 `config.rs` 既有错误码（不新增同义码，design §2.4）。
    pub fn from_command_error(error: CommandError) -> Self {
        Self {
            code: error.code,
            message: error.message,
            field: None,
            reason: None,
            task: None,
        }
    }
}

/// 注册 / 删除的生效状态：只有线程回执确认过才算 `Active`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CronEffect {
    /// 运行时已确认重载（新任务已进入派发）。
    Active,
    /// 配置已写入但运行时未确认（ack 超时 / 通道断 / 线程回执失败）：下次启动生效。
    PendingRestart,
}

impl CronEffect {
    pub fn as_str(self) -> &'static str {
        match self {
            CronEffect::Active => "active",
            CronEffect::PendingRestart => "pending_restart",
        }
    }

    pub fn is_active(self) -> bool {
        matches!(self, CronEffect::Active)
    }
}

/// `cron_task_create` 的回执载荷（工具侧只加 `ok`）。
#[derive(Debug, Clone)]
pub struct CronCreateOutcome {
    pub task: CronTask,
    pub effect: CronEffect,
    /// 注册时刻已过点 ⇒ 线程写了当日种子，今天不会再触发（design §8）。
    pub skip_today: bool,
    /// 注册回执里「通知送不出去」的告知句（[`notify_permission_notice`] 的取值，M635）。
    ///
    /// 只在 `notify-then-run` 档且权限被判为 `Denied` 时在场：`silent-run` 本来就不发通知；
    /// `run-then-notify` 的运行照常发生，通知发不出去由「投递连续失败」的可见提示收口
    /// （[`NotifyFailureStreak`]）——注册时先报一条会让同一件事说两遍。
    pub notice: Option<&'static str>,
}

/// `cron_task_remove` 的回执载荷。
#[derive(Debug, Clone)]
pub struct CronRemoveOutcome {
    pub id: String,
    pub effect: CronEffect,
}

/// `cron_task_list` 的一行：任务要素 + 最近触发日（`cron-state.json` 只读）。
#[derive(Debug, Clone)]
pub struct CronTaskSummary {
    pub id: String,
    pub vault: String,
    pub at: String,
    pub days: Vec<CronWeekday>,
    pub delivery: DeliveryPolicy,
    pub session: SessionShape,
    /// `last_fired` 的语义是「该本地日期不再派发」；状态文件缺失 / 损坏时为 `None`（不报错）。
    pub last_fired: Option<String>,
}

/// 工具执行侧的端口（change add-cron-conversational-registration tasks 2.2）：`cron.rs` 只定
/// 义契约、`lib.rs` 落实现（那里才有重载通道与 tauri 状态）。单测用替身注入。
///
/// `Send + Sync`：交互上下文会被 scoped 线程借用（`harness.rs` 的并发用例），端口是实现方
/// 持有的 `tauri::AppHandle` / 测试替身，天然满足。
pub trait CronPort: Send + Sync {
    fn create(&self, draft: CronTaskDraft) -> Result<CronCreateOutcome, CronToolError>;
    fn list(&self) -> Result<Vec<CronTaskSummary>, CronToolError>;
    fn remove(&self, id: &str) -> Result<CronRemoveOutcome, CronToolError>;
}

/// `days` 的规范化串（`mon,tue,…`）：诊断事件与成功回执共用的唯一写法。
pub fn days_label(days: &[CronWeekday]) -> String {
    days.iter()
        .map(|day| day.as_str())
        .collect::<Vec<_>>()
        .join(",")
}

/// 批准卡上的 `days`（数组形态；design §6.3 的载荷形状）。
pub fn days_json(days: &[CronWeekday]) -> Vec<&'static str> {
    days.iter().map(|day| day.as_str()).collect()
}

/// 写入一条任务（读—改—写同一把锁，design §4.1）：校验走 [`crate::config::validate_cron_task`]
/// （「一条合法任务」的唯一定义，design §5），只写模型给出的键。
///
/// 唯一性判据是**文件里出现的全部 id**（含装载期因非法而被丢弃的项）：否则文件里会有两条同 id
/// 的项，下次启动的「保留首项」会把刚写进去的那条丢掉（design §5 的唯一加严）。
pub fn create_task_at(path: &Path, draft: &CronTaskDraft) -> Result<CronTask, CronToolError> {
    let item = serde_json::Value::Object(draft.item());
    let mut created: Option<CronTask> = None;
    let mut deferred: Option<CronToolError> = None;
    let write = crate::config::update_json_atomic(path, |root| {
        match apply_create(root, &item) {
            Ok(task) => {
                created = Some(task);
                Ok(())
            }
            Err(error) => {
                deferred = Some(error);
                // 闭包签名是 `Result<(), CommandError>`：哨兵错误只用来中止写入，真实失败经
                // `deferred` 原样带出（错误码与字段不丢）。哨兵复用既有 code——它永远不会
                // 到达用户面（`deferred` 有值即直接返回），不新增一个前端没有文案的错误码。
                Err(CommandError::new("config_write_failed", "任务未写入"))
            }
        }
    });
    if let Some(error) = deferred {
        return Err(error);
    }
    write.map_err(CronToolError::from_command_error)?;
    created.ok_or_else(|| {
        CronToolError::from_command_error(CommandError::new(
            "config_write_failed",
            "配置已写入但未能读出刚注册的任务",
        ))
    })
}

/// 锁内的新增逻辑：取 `[cron].tasks`、全部 id 查重、单条校验、只推入给出的键。
fn apply_create(
    root: &mut serde_json::Value,
    item: &serde_json::Value,
) -> Result<CronTask, CronToolError> {
    let tasks = cron_tasks_mut(root)?;
    let all_ids: Vec<String> = tasks
        .iter()
        .filter_map(|task| task.get("id").and_then(serde_json::Value::as_str))
        .map(str::to_string)
        .collect();
    let id_label = |_id: &str| "cron_task_create".to_string();
    let validated =
        match crate::config::validate_cron_task(item, "cron_task_create", &id_label, &all_ids) {
            Ok(validated) => validated,
            Err(rejection) if rejection.duplicate => {
                let existing_at = tasks
                    .iter()
                    .find(|task| {
                        task.get("id").and_then(serde_json::Value::as_str)
                            == Some(rejection.issue.task.as_str())
                    })
                    .and_then(|task| task.get("at"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("未知");
                return Err(CronToolError::exists(&rejection.issue.task, existing_at));
            }
            Err(rejection) => return Err(CronToolError::invalid(rejection.issue)),
        };
    // 非致命回落（非法 delivery / session / model）在工具侧同样是拒绝：模型可以改对，
    // 而在配置里写一个下次装载要 warning 的值只会制造双份口径。
    if let Some(degraded) = validated.degraded.into_iter().next() {
        return Err(CronToolError::invalid(degraded));
    }
    tasks.push(item.clone());
    Ok(validated.task)
}

/// 删除一条任务（读—改—写同一把锁）：目标不存在报 `cron_task_not_found`，配置逐字节不变。
pub fn remove_task_at(path: &Path, id: &str) -> Result<(), CronToolError> {
    let mut deferred: Option<CronToolError> = None;
    let write = crate::config::update_json_atomic(path, |root| match apply_remove(root, id) {
        Ok(()) => Ok(()),
        Err(error) => {
            deferred = Some(error);
            // 哨兵只用来中止写入；真实失败经 deferred 带出（见 create_task_at 同处注释）。
            Err(CommandError::new("config_write_failed", "任务未删除"))
        }
    });
    if let Some(error) = deferred {
        return Err(error);
    }
    write.map_err(CronToolError::from_command_error)
}

fn apply_remove(root: &mut serde_json::Value, id: &str) -> Result<(), CronToolError> {
    let tasks = cron_tasks_mut(root)?;
    let index = tasks
        .iter()
        .position(|task| task.get("id").and_then(serde_json::Value::as_str) == Some(id));
    match index {
        Some(index) => {
            tasks.remove(index);
            Ok(())
        }
        None => Err(CronToolError::not_found(id)),
    }
}

/// `[cron].tasks` 的可变槽位（缺失则创建；**形状非法时报错、不覆盖**——那是一份用户手写的
/// 内容，工具无权按「空表」把它抹掉）。
fn cron_tasks_mut(
    root: &mut serde_json::Value,
) -> Result<&mut Vec<serde_json::Value>, CronToolError> {
    let Some(root) = root.as_object_mut() else {
        return Err(CronToolError::from_command_error(CommandError::new(
            "config_write_failed",
            "配置文件的顶层不是对象，未写入",
        )));
    };
    let cron = root.entry("cron").or_insert_with(|| serde_json::json!({}));
    let Some(cron) = cron.as_object_mut() else {
        return Err(CronToolError::from_command_error(CommandError::new(
            "config_write_failed",
            "[cron] 不是对象，未写入（请先修好配置文件）",
        )));
    };
    let tasks = cron
        .entry("tasks")
        .or_insert_with(|| serde_json::Value::Array(Vec::new()));
    tasks.as_array_mut().ok_or_else(|| {
        CronToolError::from_command_error(CommandError::new(
            "config_write_failed",
            "cron.tasks 不是数组，未写入（请先修好配置文件）",
        ))
    })
}

/// 只读列出任务（`cron_task_list`）：配置宽读（失败按空表）+ 状态文件只读（缺失 / 损坏 →
/// `last_fired = null`）。**不写任何文件**（含退役值迁移那笔写副作用——不走 `config::load`）。
pub fn list_tasks_at(config_path: &Path, state_path: &Path) -> Vec<CronTaskSummary> {
    let (state, _warnings) = load_state(state_path);
    crate::config::read_cron_tasks_at(config_path)
        .into_iter()
        .map(|task| CronTaskSummary {
            last_fired: state.last_fired(&task.id).map(str::to_string),
            id: task.id,
            vault: task.vault,
            at: task.at,
            days: task.days,
            delivery: task.delivery,
            session: task.session,
        })
        .collect()
}

/// 批准卡预览的只读查询：既有任务的 `at`（`cron_task_remove` 的卡片要展示它）。
pub fn find_task_at(config_path: &Path, id: &str) -> Option<String> {
    let value = crate::config::read_config_json(config_path);
    value
        .get("cron")
        .and_then(|cron| cron.get("tasks"))
        .and_then(serde_json::Value::as_array)?
        .iter()
        .find(|task| task.get("id").and_then(serde_json::Value::as_str) == Some(id))?
        .get("at")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

/// `cron_task_create` 的批准卡载荷（design §6.3）。`skip_today` 与线程用**同一个**纯判据
/// （[`due_now`]）算一次：卡片上「今天还会不会触发」是用户批准前最需要知道的一条。
pub fn create_preview(draft: &CronTaskDraft, now: &LocalNow) -> serde_json::Value {
    let days = draft_days(draft);
    let at = draft
        .at
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let skip_today = parse_at(at).is_ok_and(|at_minutes| due_now(&days, at_minutes, now));
    let delivery = draft
        .delivery
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .and_then(DeliveryPolicy::parse)
        .unwrap_or_default();
    let session = draft
        .session
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .and_then(SessionShape::parse)
        .unwrap_or_default();
    serde_json::json!({
        "op": "create",
        "id": draft.id.as_ref().and_then(serde_json::Value::as_str).unwrap_or(""),
        "at": at,
        "days": days_json(&days),
        "delivery": delivery.as_str(),
        "session": session.as_str(),
        "vault": draft.vault.as_ref().and_then(serde_json::Value::as_str).unwrap_or(""),
        "prompt": draft.prompt.as_ref().and_then(serde_json::Value::as_str).unwrap_or(""),
        "skip_today": skip_today,
    })
}

/// 预览用的 `days`：给出且可解析时用给出的（忽略非法项），否则全周（缺省口径）。
fn draft_days(draft: &CronTaskDraft) -> Vec<CronWeekday> {
    if let Some(serde_json::Value::Array(items)) = &draft.days {
        let days: Vec<CronWeekday> = items
            .iter()
            .filter_map(|item| item.as_str().and_then(parse_weekday))
            .collect();
        if !days.is_empty() {
            return days;
        }
    }
    CronWeekday::ALL.to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use std::sync::atomic::AtomicU32;

    /// 固定偏移（+08:00）构造时刻：单测因此**完全不读系统时区**（design §12）。
    fn at(date: (i32, u32, u32), hour: u32, minute: u32) -> DateTime<FixedOffset> {
        let offset = FixedOffset::east_opt(8 * 3600).expect("固定偏移合法");
        offset
            .with_ymd_and_hms(date.0, date.1, date.2, hour, minute, 0)
            .single()
            .expect("单一时区下的时刻唯一")
    }

    fn now(date: (i32, u32, u32), hour: u32, minute: u32) -> LocalNow {
        LocalNow::from_datetime(at(date, hour, minute))
    }

    /// 2026-10-18 是周日。
    const SUNDAY: (i32, u32, u32) = (2026, 10, 18);
    /// 2026-10-17 是周六。
    const SATURDAY: (i32, u32, u32) = (2026, 10, 17);

    fn input<'a>(
        at_minutes: u16,
        days: &'a [CronWeekday],
        now: &'a LocalNow,
        last_fired: Option<&'a str>,
    ) -> CheckInput<'a> {
        CheckInput {
            at_minutes,
            days,
            now,
            last_fired,
        }
    }

    #[test]
    fn local_now_reads_local_date_weekday_and_minutes() {
        let moment = now(SUNDAY, 21, 5);
        assert_eq!(moment.date, "2026-10-18");
        assert_eq!(moment.weekday, CronWeekday::Sun);
        assert_eq!(moment.minutes_since_midnight, 21 * 60 + 5);
    }

    #[test]
    fn parse_at_accepts_every_valid_minute_of_the_day() {
        assert_eq!(parse_at("00:00"), Ok(0));
        assert_eq!(parse_at("09:05"), Ok(9 * 60 + 5));
        assert_eq!(parse_at("23:59"), Ok(23 * 60 + 59));
    }

    /// 非法形态逐条：越界、单位数、缺冒号、空格、空串、非 ASCII 数字。
    #[test]
    fn parse_at_rejects_every_invalid_form() {
        for text in ["24:00", "21:60", "9:5", "21-00", " 21:00", "21:00 ", ""] {
            assert!(parse_at(text).is_err(), "{text:?} 应判非法");
        }
        assert!(parse_at("2１:00").is_err(), "全角数字应判非法");
    }

    /// 真值表四格：due × fired。
    #[test]
    fn decide_truth_table() {
        let moment = now(SUNDAY, 21, 0);
        let all = CronWeekday::ALL;
        // 已过点 + 今日未触发 ⇒ Fire
        assert_eq!(decide(&input(21 * 60, &all, &moment, None)), Decision::Fire);
        // 已过点 + 今日已触发 ⇒ Done
        assert_eq!(
            decide(&input(21 * 60, &all, &moment, Some("2026-10-18"))),
            Decision::Done
        );
        // 未到点 ⇒ NotDue（无论是否已触发）
        assert_eq!(
            decide(&input(21 * 60 + 1, &all, &moment, None)),
            Decision::NotDue
        );
        assert_eq!(
            decide(&input(21 * 60 + 1, &all, &moment, Some("2026-10-18"))),
            Decision::NotDue
        );
    }

    /// 「越过 at」而不是「恰好等于 at」：晚一分钟、晚一小时都算到点。
    #[test]
    fn decide_treats_any_later_minute_as_due() {
        let moment = now(SUNDAY, 22, 30);
        assert_eq!(
            decide(&input(21 * 60, &CronWeekday::ALL, &moment, None)),
            Decision::Fire
        );
    }

    #[test]
    fn decide_filters_by_weekday() {
        let saturday = now(SATURDAY, 21, 5);
        let sunday = now(SUNDAY, 21, 5);
        let days = [CronWeekday::Wed];
        assert_eq!(
            decide(&input(21 * 60, &days, &saturday, None)),
            Decision::NotDue
        );
        assert_eq!(
            decide(&input(21 * 60, &days, &sunday, None)),
            Decision::NotDue
        );
        let wednesday = now((2026, 10, 21), 21, 0);
        assert_eq!(
            decide(&input(21 * 60, &days, &wednesday, None)),
            Decision::Fire
        );
    }

    /// 跨日边界：昨日 23:59 已触发 ⇒ 当日 Done；今日 00:01 已是新日期 ⇒ 重新允许。
    #[test]
    fn decide_handles_the_midnight_boundary() {
        let late_night = now(SATURDAY, 23, 59);
        assert_eq!(
            decide(&input(
                23 * 60 + 59,
                &CronWeekday::ALL,
                &late_night,
                Some("2026-10-17")
            )),
            Decision::Done
        );
        let just_after_midnight = now(SUNDAY, 0, 1);
        assert_eq!(
            decide(&input(
                1,
                &CronWeekday::ALL,
                &just_after_midnight,
                Some("2026-10-17")
            )),
            Decision::Fire
        );
        // 跨日不补：今日 00:01 对 21:00 的任务仍未到点。
        assert_eq!(
            decide(&input(
                21 * 60,
                &CronWeekday::ALL,
                &just_after_midnight,
                Some("2026-10-17")
            )),
            Decision::NotDue
        );
    }

    /// DST 跳过的小时：02:30 被跳过时，03:00 的 tick 即为已过点。
    #[test]
    fn decide_covers_a_skipped_dst_hour() {
        let moment = now(SUNDAY, 3, 0);
        assert_eq!(
            decide(&input(2 * 60 + 30, &CronWeekday::ALL, &moment, None)),
            Decision::Fire
        );
    }

    /// DST 重复的小时：同一本地时刻第二次出现时，当日去重挡住第二次触发。
    #[test]
    fn decide_covers_a_repeated_dst_hour() {
        let moment = now(SUNDAY, 1, 30);
        assert_eq!(
            decide(&input(90, &CronWeekday::ALL, &moment, None)),
            Decision::Fire
        );
        assert_eq!(
            decide(&input(90, &CronWeekday::ALL, &moment, Some("2026-10-18"))),
            Decision::Done
        );
    }

    /// 时钟回拨：日期倒退时既有 last_fired 保留，最多抑制当天一次触发（不删记录）。
    #[test]
    fn clock_rollback_keeps_the_existing_record() {
        let mut state = CronState::default();
        state.mark_fired("task", "2026-10-18");
        let rolled_back = now(SATURDAY, 21, 0);
        assert_eq!(
            decide(&input(
                21 * 60,
                &CronWeekday::ALL,
                &rolled_back,
                state.last_fired("task")
            )),
            Decision::Fire
        );
        assert_eq!(
            state.last_fired("task"),
            Some("2026-10-18"),
            "回拨不删既有记录"
        );
    }

    // -----------------------------------------------------------------------
    // 派发策略
    // -----------------------------------------------------------------------

    fn task_with(delivery: DeliveryPolicy, days: Vec<CronWeekday>) -> CronTask {
        CronTask {
            id: "task-a".to_string(),
            vault: "/tmp/vault-a".to_string(),
            at: "21:00".to_string(),
            days,
            prompt: "synthetic prompt".to_string(),
            delivery,
            session: crate::config::SessionShape::New,
            model: None,
        }
    }

    fn plan_for<'a>(
        task: &'a CronTask,
        now: &'a LocalNow,
        last_fired: Option<&'a str>,
        current_vault: Option<&'a str>,
        inflight: bool,
        skipped_today: bool,
        trigger: Trigger,
    ) -> Plan {
        plan(&PlanInput {
            task,
            at_minutes: 21 * 60,
            now,
            last_fired,
            current_vault,
            target_vault: task.vault.as_str(),
            inflight,
            skipped_today,
            frontend_ready: true,
            trigger,
        })
    }

    #[test]
    fn plan_keeps_notify_then_run_at_a_notification_only() {
        let task = task_with(DeliveryPolicy::NotifyThenRun, CronWeekday::ALL.to_vec());
        let moment = now(SUNDAY, 21, 0);
        assert_eq!(
            plan_for(&task, &moment, None, None, false, false, Trigger::Timer),
            Plan::Notify,
            "缺省档只投通知：当前没有 vault 也不影响"
        );
    }

    #[test]
    fn plan_runs_only_when_the_target_vault_is_current() {
        let task = task_with(DeliveryPolicy::RunThenNotify, CronWeekday::ALL.to_vec());
        let moment = now(SUNDAY, 21, 0);
        assert_eq!(
            plan_for(
                &task,
                &moment,
                None,
                Some("/tmp/vault-a"),
                false,
                false,
                Trigger::Timer
            ),
            Plan::Handoff
        );
        assert_eq!(
            plan_for(
                &task,
                &moment,
                None,
                Some("/tmp/vault-b"),
                false,
                false,
                Trigger::Timer
            ),
            Plan::Skip(SkipReason::VaultNotCurrent)
        );
        assert_eq!(
            plan_for(&task, &moment, None, None, false, false, Trigger::Timer),
            Plan::Skip(SkipReason::NotReady)
        );
    }

    #[test]
    fn plan_waits_for_the_frontend_bridge_before_handoff() {
        let task = task_with(DeliveryPolicy::SilentRun, CronWeekday::ALL.to_vec());
        let moment = now(SUNDAY, 21, 0);
        let plan = plan(&PlanInput {
            task: &task,
            at_minutes: 21 * 60,
            now: &moment,
            last_fired: None,
            current_vault: Some("/tmp/vault-a"),
            target_vault: "/tmp/vault-a",
            inflight: false,
            skipped_today: false,
            // webview 的 `cron:run` 监听器还没装好：交接事件会被静默丢弃，因此不能派发。
            frontend_ready: false,
            trigger: Trigger::Startup,
        });
        assert_eq!(plan, Plan::Skip(SkipReason::NotReady));
    }

    #[test]
    fn plan_skips_a_task_that_already_has_a_run_in_flight() {
        let task = task_with(DeliveryPolicy::SilentRun, CronWeekday::ALL.to_vec());
        let moment = now(SUNDAY, 21, 0);
        assert_eq!(
            plan_for(
                &task,
                &moment,
                None,
                Some("/tmp/vault-a"),
                true,
                false,
                Trigger::Focus
            ),
            Plan::Skip(SkipReason::Busy)
        );
    }

    /// 定时器不重试当日已跳过的任务；拉取兜底照旧重试（design §6.5）。
    #[test]
    fn plan_retries_only_on_pull_triggers() {
        let task = task_with(DeliveryPolicy::SilentRun, CronWeekday::ALL.to_vec());
        let moment = now(SUNDAY, 21, 0);
        assert_eq!(
            plan_for(
                &task,
                &moment,
                None,
                Some("/tmp/vault-b"),
                false,
                true,
                Trigger::Timer
            ),
            Plan::Idle
        );
        assert_eq!(
            plan_for(
                &task,
                &moment,
                None,
                Some("/tmp/vault-b"),
                false,
                true,
                Trigger::VaultOpen
            ),
            Plan::Skip(SkipReason::VaultNotCurrent)
        );
    }

    #[test]
    fn plan_is_idle_when_not_due_or_already_fired() {
        let task = task_with(DeliveryPolicy::NotifyThenRun, CronWeekday::ALL.to_vec());
        let early = now(SUNDAY, 9, 0);
        assert_eq!(
            plan_for(&task, &early, None, None, false, false, Trigger::Timer),
            Plan::Idle
        );
        let fired = now(SUNDAY, 21, 30);
        assert_eq!(
            plan_for(
                &task,
                &fired,
                Some("2026-10-18"),
                None,
                false,
                false,
                Trigger::Timer
            ),
            Plan::Idle
        );
        let weekend_only = task_with(DeliveryPolicy::SilentRun, vec![CronWeekday::Wed]);
        assert_eq!(
            plan_for(
                &weekend_only,
                &fired,
                None,
                Some("/tmp/vault-a"),
                false,
                false,
                Trigger::Timer
            ),
            Plan::Idle
        );
    }

    // -----------------------------------------------------------------------
    // 运行交接载荷（RunSpec + 任务载荷）
    // -----------------------------------------------------------------------

    fn handoff_for<'a>(
        task: &'a CronTask,
        trigger: Trigger,
        session_id: Option<&'a str>,
    ) -> Handoff {
        handoff(&HandoffInput {
            task,
            run_id: "run-1",
            trigger,
            vault: "/tmp/vault-a",
            loop_max: 42,
            session_id,
        })
    }

    /// 定时 / 拉取运行：无人值守槽位 + 无人可批即拒；预算只填轮次上限。
    #[test]
    fn handoff_for_scheduled_runs_is_unattended_and_rejects_approvals() {
        let task = task_with(DeliveryPolicy::RunThenNotify, CronWeekday::ALL.to_vec());
        let payload = handoff_for(&task, Trigger::Timer, None);

        assert_eq!(
            payload.spec.origin,
            RunOrigin::Cron {
                task: "task-a".to_string(),
                run_id: "run-1".to_string(),
            }
        );
        assert_eq!(
            payload.spec.session_target,
            SessionTarget::Unattended {
                key: "run-1".to_string()
            }
        );
        assert_eq!(
            payload.spec.approval_policy,
            ApprovalPolicy::RejectUnavailable
        );
        assert_eq!(
            payload.spec.budget,
            RunBudget {
                max_rounds: 42,
                max_tokens: 0,
                deadline: None,
            }
        );
        assert!(!payload.spec.background);
        assert_eq!(payload.trigger, "timer");
        assert_eq!(payload.vault, "/tmp/vault-a");
        assert_eq!(payload.prompt, "synthetic prompt");
        assert_eq!(payload.session, "new");
        assert_eq!(payload.session_id, None);
        assert_eq!(payload.model, None);
    }

    /// 点击发起：交互槽位 + 交互批准；会话槽位与批准策略都由契约值表达，不另带字符串判据。
    #[test]
    fn handoff_for_clicked_runs_uses_the_interactive_slot() {
        let task = task_with(DeliveryPolicy::NotifyThenRun, CronWeekday::ALL.to_vec());
        let payload = handoff_for(&task, Trigger::Click, None);

        assert_eq!(payload.spec.session_target, SessionTarget::Interactive);
        assert_eq!(payload.spec.approval_policy, ApprovalPolicy::Interactive);
        assert_eq!(payload.trigger, "click");
    }

    /// `dedicated` 只在其态下携带续写会话 id；`new` 档即使收到 id 也不带（避免下游误续写）。
    #[test]
    fn handoff_carries_session_id_only_for_dedicated_tasks() {
        let mut task = task_with(DeliveryPolicy::SilentRun, CronWeekday::ALL.to_vec());
        assert_eq!(
            handoff_for(&task, Trigger::Timer, Some("session-9")).session_id,
            None
        );

        task.session = crate::config::SessionShape::Dedicated;
        assert_eq!(
            handoff_for(&task, Trigger::Timer, Some("session-9")).session_id,
            Some("session-9".to_string())
        );
    }

    /// 线格式钉死：RunSpec 字段平铺（不嵌套 `spec`），任务载荷是 sibling 字段。
    /// 区分度：把 `#[serde(flatten)]` 换成嵌套对象、或漏掉任务字段，本用例必 FAIL。
    #[test]
    fn handoff_serializes_as_a_flat_run_spec_plus_task_payload() {
        let task = task_with(DeliveryPolicy::RunThenNotify, CronWeekday::ALL.to_vec());
        let value = serde_json::to_value(handoff_for(&task, Trigger::Timer, None)).unwrap();

        assert!(value.get("spec").is_none(), "契约字段必须平铺：{value}");
        assert_eq!(value["origin"]["kind"], "cron");
        assert_eq!(value["origin"]["task"], "task-a");
        assert_eq!(value["origin"]["run_id"], "run-1");
        assert_eq!(value["session_target"]["kind"], "unattended");
        assert_eq!(
            value["approval_policy"]["kind"], "reject_unavailable",
            "无人值守运行不得把批准策略写成交互：{value}"
        );
        // 9 件 vault 操作工具（change add-harness-vault-workspace-list 起含 `vault_list`）：
        // 交接契约把整套 vault 工具授予 cron 运行，且 MUST NOT 含 `task`。
        assert_eq!(value["tool_policy"]["allow"].as_array().unwrap().len(), 9);
        assert!(
            !value["tool_policy"]["allow"]
                .as_array()
                .unwrap()
                .iter()
                .any(|name| name == "task"),
            "契约不得把委派工具 task 授予 cron 运行：{value}"
        );
        assert_eq!(value["budget"]["max_rounds"], 42);
        assert_eq!(value["budget"]["max_tokens"], 0);
        assert_eq!(value["background"], false);
        assert_eq!(value["trigger"], "timer");
        assert_eq!(value["vault"], "/tmp/vault-a");
        assert_eq!(value["prompt"], "synthetic prompt");
        assert_eq!(value["session"], "new");
        assert_eq!(value["session_id"], serde_json::Value::Null);
        assert_eq!(value["model"], serde_json::Value::Null);
    }

    // -----------------------------------------------------------------------
    // 状态文件
    // -----------------------------------------------------------------------

    /// 独占新建的临时目录（无 tempfile 依赖，与 config.rs / logging.rs 的测试惯例一致）。
    struct TempDir(PathBuf);
    static SEQ: AtomicU32 = AtomicU32::new(0);

    impl TempDir {
        fn new() -> Self {
            let base = std::env::temp_dir();
            for _ in 0..16 {
                let path = base.join(format!(
                    "lumir-cron-test-{}-{}-{:016x}",
                    std::process::id(),
                    SEQ.fetch_add(1, Ordering::Relaxed),
                    rand::random::<u64>(),
                ));
                match std::fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("create temp dir {}: {error}", path.display()),
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

    #[test]
    fn missing_state_file_is_silently_empty() {
        let dir = TempDir::new();
        let (state, warnings) = load_state(&state_path(dir.path()));
        assert_eq!(state, CronState::default());
        assert!(warnings.is_empty(), "缺失是常态，不告警：{warnings:?}");
    }

    #[test]
    fn corrupt_state_file_falls_back_with_warning() {
        for body in ["{not json", "{\"version\":1,\"tasks\":[]}"] {
            let dir = TempDir::new();
            let path = state_path(dir.path());
            std::fs::write(&path, body).unwrap();
            let (state, warnings) = load_state(&path);
            assert_eq!(state, CronState::default());
            assert_eq!(warnings.len(), 1, "body={body:?}");
        }
    }

    #[test]
    fn version_mismatch_falls_back_with_warning() {
        let dir = TempDir::new();
        let path = state_path(dir.path());
        std::fs::write(&path, r#"{"version":2,"tasks":{}}"#).unwrap();
        let (state, warnings) = load_state(&path);
        assert_eq!(state, CronState::default());
        assert!(warnings[0].contains("version"), "{warnings:?}");
    }

    #[test]
    fn state_round_trips_through_atomic_replace() {
        let dir = TempDir::new();
        let path = state_path(dir.path());
        let mut state = CronState::default();
        state.mark_fired("task-a", "2026-10-18");
        state.set_session("task-a", Some("session-1"));
        save_state(&path, &state).expect("写状态");

        let (loaded, warnings) = load_state(&path);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(loaded, state);
        assert_eq!(loaded.last_fired("task-a"), Some("2026-10-18"));
        assert_eq!(loaded.session_id("task-a"), Some("session-1"));
        assert!(
            !path.with_extension("json.tmp").exists(),
            "原子写不应留下临时文件"
        );
    }

    /// `session_id` 缺省不写进磁盘（状态文件只记在场字段），读回仍是 `None`。
    #[test]
    fn session_id_is_optional_on_the_record() {
        let dir = TempDir::new();
        let path = state_path(dir.path());
        let mut state = CronState::default();
        state.mark_fired("task-a", "2026-10-18");
        save_state(&path, &state).expect("写状态");
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("session_id"), "{text}");
        let (loaded, _) = load_state(&path);
        assert_eq!(loaded.session_id("task-a"), None);
        // set_session(None) 不改写既有值
        loaded.clone().set_session("task-a", None);
        assert_eq!(loaded.session_id("task-a"), None);
    }

    #[test]
    fn run_ids_are_unique_within_the_process() {
        let first = new_run_id();
        let second = new_run_id();
        assert_ne!(first, second);
        assert!(!first.is_empty());
    }

    // -----------------------------------------------------------------------
    // 运行期任务集重载（change add-cron-conversational-registration design §3.3 / tasks 3.6）
    // -----------------------------------------------------------------------

    fn scheduled(id: &str, at: &str, days: Vec<CronWeekday>) -> ScheduledTask {
        let task = CronTask {
            id: id.to_string(),
            vault: "/tmp/vault-a".to_string(),
            at: at.to_string(),
            days,
            prompt: "synthetic prompt".to_string(),
            delivery: DeliveryPolicy::NotifyThenRun,
            session: SessionShape::New,
            model: None,
        };
        let at_minutes = parse_at(at).expect("测试里的 at 合法");
        ScheduledTask {
            task,
            at_minutes,
            vault_root: "/tmp/vault-a".to_string(),
        }
    }

    /// 新增 / 移除 / 改 `at` 三种变化一次覆盖：任务集整体替换、被删 id 上报、`loop_max` 随重载更新。
    #[test]
    fn plan_reload_replaces_the_set_and_reports_removed_ids() {
        let previous = vec![
            scheduled("kept", "21:00", CronWeekday::ALL.to_vec()),
            scheduled("gone", "22:00", CronWeekday::ALL.to_vec()),
        ];
        let next = vec![
            // 同 id 改 at：算「替换」，不算新增，因此不写种子。
            scheduled("kept", "23:00", CronWeekday::ALL.to_vec()),
            scheduled("fresh", "23:30", CronWeekday::ALL.to_vec()),
        ];
        let moment = now((2026, 10, 18), 21, 30);
        let mut state = CronState::default();
        state.set_session("gone", Some("session-9"));
        let plan = plan_reload(&previous, next, 50, &moment, &mut state);

        assert_eq!(plan.tasks.len(), 2);
        assert_eq!(plan.tasks[0].task.at, "23:00", "任务集按文件当下内容替换");
        assert_eq!(plan.removed, vec!["gone".to_string()]);
        assert_eq!(plan.loop_max, 50);
        assert!(plan.seeded.is_empty(), "改 at 不是新增：{plan:?}");
        // 被删任务的状态记录惰性残留（不为清理做扫描）。
        assert_eq!(state.session_id("gone"), Some("session-9"));
    }

    /// 只有**本次新增且注册时刻已过点**的任务写当日种子；未到点的照常派发。
    #[test]
    fn plan_reload_seeds_only_new_tasks_that_are_already_due() {
        let previous = vec![scheduled("old", "21:00", CronWeekday::ALL.to_vec())];
        let next = vec![
            scheduled("old", "21:00", CronWeekday::ALL.to_vec()),
            scheduled("due", "20:00", CronWeekday::ALL.to_vec()),
            scheduled("later", "22:00", CronWeekday::ALL.to_vec()),
        ];
        let moment = now((2026, 10, 18), 21, 30);
        let mut state = CronState::default();
        let plan = plan_reload(&previous, next, 50, &moment, &mut state);

        assert_eq!(plan.seeded, vec!["due".to_string()]);
        assert_eq!(state.last_fired("due"), Some("2026-10-18"));
        assert_eq!(state.last_fired("later"), None, "未到点不写种子");
        assert_eq!(state.last_fired("old"), None, "既有任务不走种子");
    }

    /// 新增任务的 `days` 不含今天 ⇒ 不写种子（判据与 `decide` 同一组输入）。
    #[test]
    fn plan_reload_does_not_seed_when_today_is_not_in_days() {
        let moment = now((2026, 10, 18), 21, 30); // 周日
        let next = vec![scheduled("weekday-only", "20:00", vec![CronWeekday::Mon])];
        let mut state = CronState::default();
        let plan = plan_reload(&[], next, 50, &moment, &mut state);

        assert!(plan.seeded.is_empty());
        assert_eq!(state.last_fired("weekday-only"), None);
    }

    /// 重载回执投影（design §3.8）：只有「收到回执且没有失败原因」才是 active；超时 / 失败回执
    /// 一律 pending_restart。区分度：把 `None` 当 active（「写了文件就说生效」）本用例必 FAIL。
    #[test]
    fn effect_of_ack_distinguishes_active_from_pending_restart() {
        let ok = ReloadOutcome {
            applied: 2,
            seeded: vec!["daily-log".to_string()],
            error: None,
            notify_permission: NotifyPermission::Granted,
        };
        let (effect, seeded) = effect_of(Some(&ok));
        assert_eq!(effect, CronEffect::Active);
        assert_eq!(seeded, vec!["daily-log".to_string()]);

        let failed = ReloadOutcome {
            applied: 1,
            seeded: Vec::new(),
            error: Some("配置文件不是合法 JSON".to_string()),
            notify_permission: NotifyPermission::Granted,
        };
        assert_eq!(effect_of(Some(&failed)).0, CronEffect::PendingRestart);
        assert_eq!(effect_of(None).0, CronEffect::PendingRestart);
        assert!(effect_of(None).1.is_empty());
    }

    /// 投递连续失败的可见提示（M635）：达到阈值那一次上屏一次，同一段连续失败不重复提示；
    /// 成功清零后，下一段连续失败重新提示。
    ///
    /// 区分度（REVIEW.md「断言等价于子串」条）：把「只提示一次」写成「每次达阈值都提示」或
    /// 「首次失败就提示」，下面 `assert_eq!(None)` / `assert_eq!(Some(3))` 都会红。
    #[test]
    fn notify_failure_streak_surfaces_once_per_streak() {
        let mut streak = NotifyFailureStreak::default();
        assert_eq!(streak.record_failure(), None);
        assert_eq!(streak.record_failure(), None);
        assert_eq!(streak.consecutive(), 2);
        assert_eq!(
            streak.record_failure(),
            Some(NOTIFY_FAILURE_NOTICE_AFTER),
            "达到阈值那一次必须返回次数（调用方据此上屏）"
        );
        assert_eq!(streak.record_failure(), None, "同一段连续失败不重复上屏");
        assert_eq!(streak.consecutive(), 4);

        streak.record_success();
        assert_eq!(streak.consecutive(), 0);
        assert_eq!(streak.record_failure(), None);
        assert_eq!(streak.record_failure(), None);
        assert_eq!(
            streak.record_failure(),
            Some(NOTIFY_FAILURE_NOTICE_AFTER),
            "清零后的下一段连续失败要重新提示"
        );
    }

    /// 注册告知句的两档措辞（D551 / D552，M636 定论）：拒绝与「身份未被认可」必须分开——
    /// 后者让用户「去系统设置打开」是误导（设置里的条目属于别的签名身份）。区分度：两档写成
    /// 同一句、或身份档里出现「系统设置」的引导，本用例必 FAIL。
    #[test]
    fn notify_permission_notice_splits_denied_from_unrecognized() {
        let denied_zh = notify_permission_notice(NotifyPermission::Denied, UiLanguage::Zh).unwrap();
        let denied_en = notify_permission_notice(NotifyPermission::Denied, UiLanguage::En).unwrap();
        let identity_zh =
            notify_permission_notice(NotifyPermission::Unrecognized, UiLanguage::Zh).unwrap();
        let identity_en =
            notify_permission_notice(NotifyPermission::Unrecognized, UiLanguage::En).unwrap();

        assert_ne!(denied_zh, identity_zh, "两档成因不能共用一句");
        assert_ne!(denied_en, identity_en);
        assert!(denied_zh.contains("系统设置"), "{denied_zh}");
        assert!(denied_en.contains("System Settings"), "{denied_en}");
        assert!(identity_zh.contains("签名") && identity_en.contains("signature"));
        assert!(
            !identity_zh.contains("系统设置") && !identity_en.contains("System Settings"),
            "身份档 MUST NOT 把用户引向系统设置：{identity_zh} / {identity_en}"
        );
        assert_eq!(
            notify_permission_notice(NotifyPermission::Granted, UiLanguage::Zh),
            None
        );
        assert_eq!(
            notify_permission_notice(NotifyPermission::Unknown, UiLanguage::Zh),
            None
        );
    }

    /// 注册告知的判别点（M635）：只有 `notify-then-run` × 「送不出去」才出句；已授权 /
    /// 无法判定 / 其它两档一律不出句。区分度：把判据写成「只要被拒就出句」（漏掉档位）本用例必 FAIL。
    #[test]
    fn registration_notice_only_for_notify_then_run_when_blocked() {
        for permission in [NotifyPermission::Denied, NotifyPermission::Unrecognized] {
            assert_eq!(
                registration_notice(DeliveryPolicy::NotifyThenRun, permission, UiLanguage::Zh),
                notify_permission_notice(permission, UiLanguage::Zh),
                "notify-then-run 且送不出去：出句"
            );
        }
        for permission in [NotifyPermission::Granted, NotifyPermission::Unknown] {
            assert_eq!(
                registration_notice(DeliveryPolicy::NotifyThenRun, permission, UiLanguage::Zh),
                None,
                "没读到「送不出去」就不出句：{permission:?}"
            );
        }
        for delivery in [DeliveryPolicy::RunThenNotify, DeliveryPolicy::SilentRun] {
            assert_eq!(
                registration_notice(delivery, NotifyPermission::Denied, UiLanguage::Zh),
                None,
                "只有 notify-then-run 依赖通知投递：{delivery:?}"
            );
        }
    }

    /// 连续失败提示的措辞分档（M635 / M636）：身份未被认可时点名签名成因，其余走通用档
    /// ——通用档不能把「系统设置」说成唯一出路（已授权仍失败时它不解决问题）。
    #[test]
    fn delivery_failed_code_splits_identity_cause() {
        assert_eq!(
            delivery_failed_code(Some(NotifyPermission::Unrecognized)),
            "cron_notify_delivery_failed_identity"
        );
        for permission in [
            None,
            Some(NotifyPermission::Denied),
            Some(NotifyPermission::Granted),
            Some(NotifyPermission::Unknown),
        ] {
            assert_eq!(
                delivery_failed_code(permission),
                "cron_notify_delivery_failed",
                "{permission:?}"
            );
        }
    }

    /// 空表替换不 panic：任务全删是合法状态（守护空转）。
    #[test]
    fn plan_reload_to_an_empty_set_is_silent() {
        let previous = vec![scheduled("only", "21:00", CronWeekday::ALL.to_vec())];
        let moment = now((2026, 10, 18), 21, 30);
        let mut state = CronState::default();
        let plan = plan_reload(&previous, Vec::new(), 12, &moment, &mut state);

        assert!(plan.tasks.is_empty());
        assert_eq!(plan.removed, vec!["only".to_string()]);
        assert!(plan.seeded.is_empty());
        assert_eq!(plan.loop_max, 12);
    }

    /// 被删任务的内存记录清理边界（design §3.3 第 5 步）：`skipped_today` / `clicked_today`
    /// 清掉，**在途运行记录保留**（它还要收尾并回执）。区分度：把 inflight 也传进
    /// `retain_live_tasks` 的实现在下列断言里必 FAIL。
    #[test]
    fn reload_pruning_clears_memory_marks_but_keeps_inflight() {
        let removed = vec!["gone".to_string()];
        let mut skipped: std::collections::HashMap<String, String> = [
            ("gone".to_string(), "2026-10-18".to_string()),
            ("kept".to_string(), "2026-10-18".to_string()),
        ]
        .into_iter()
        .collect();
        let mut clicked: std::collections::HashMap<String, String> =
            [("gone".to_string(), "2026-10-18".to_string())]
                .into_iter()
                .collect();
        let mut inflight: std::collections::HashMap<String, String> =
            [("run-1".to_string(), "gone".to_string())]
                .into_iter()
                .collect();

        retain_live_tasks(&mut skipped, &removed);
        retain_live_tasks(&mut clicked, &removed);
        // in-flight 明确不经过 prune。
        assert!(!skipped.contains_key("gone"));
        assert!(skipped.contains_key("kept"));
        assert!(clicked.is_empty());
        assert_eq!(
            inflight.remove("run-1").as_deref(),
            Some("gone"),
            "被删任务的在途运行必须保留到终态回执"
        );
    }

    // -----------------------------------------------------------------------
    // 调度工具的落盘语义（change add-cron-conversational-registration tasks 2.8 / 2.9）
    // -----------------------------------------------------------------------

    fn task_args() -> serde_json::Value {
        serde_json::json!({
            "id": "daily-log",
            "at": "21:00",
            "prompt": "写今日 log",
            "vault": "/tmp/vault-a",
        })
    }

    /// 成功 create：① 新项在场 ② 模型没给的键缺席 ③ 其它表与未知顶层键保留 ④ `version` 未降
    /// ⑤ 工具侧零写 `cron-state.json`。
    #[test]
    fn create_task_writes_only_the_given_keys_and_keeps_the_rest() {
        let dir = TempDir::new();
        let config = dir.path().join("config.json");
        let state = state_path(dir.path());
        std::fs::write(
            &config,
            r#"{"version":7,"unknown_top":{"keep":[1,2]},"ui":{"theme":"dark"},"cron":{"tasks":[]}}"#,
        )
        .unwrap();
        std::fs::write(&state, r#"{"version":1,"tasks":{}}"#).unwrap();
        let state_meta = std::fs::metadata(&state).unwrap();
        let state_body = std::fs::read(&state).unwrap();

        let draft = CronTaskDraft::from_args(&task_args(), "/tmp/vault-a");
        let task = create_task_at(&config, &draft).expect("合法任务应写入");
        assert_eq!(task.id, "daily-log");

        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&config).unwrap()).unwrap();
        let tasks = value["cron"]["tasks"].as_array().unwrap();
        assert_eq!(tasks.len(), 1);
        let item = &tasks[0];
        assert_eq!(item["id"], "daily-log");
        assert_eq!(item["at"], "21:00");
        assert_eq!(item["prompt"], "写今日 log");
        assert_eq!(item["vault"], "/tmp/vault-a");
        for absent in ["days", "delivery", "session", "model"] {
            assert!(
                item.get(absent).is_none(),
                "缺省键不得写死：{absent}：{item}"
            );
        }
        assert_eq!(value["unknown_top"], serde_json::json!({"keep": [1,2]}));
        assert_eq!(value["ui"], serde_json::json!({"theme": "dark"}));
        assert_eq!(value["version"], serde_json::json!(7), "高版本不降回");

        // 工具不写状态文件：内容与 mtime 都不变。
        assert_eq!(
            std::fs::read(&state).unwrap(),
            state_body,
            "状态文件内容被改"
        );
        assert_eq!(
            std::fs::metadata(&state).unwrap().modified().unwrap(),
            state_meta.modified().unwrap(),
            "状态文件 mtime 被改（工具侧零写）"
        );
    }

    /// 失败路径（非法 / 重名 / 落盘失败）配置逐字节不变。
    ///
    /// 区分度：同组用例先做一次**成功写**（同一个文件、同一个入口），证明文件可写；否则「失败
    /// 也没改」可能只是「根本写不进去」。
    #[test]
    fn create_task_failures_leave_the_config_byte_identical() {
        let dir = TempDir::new();
        let config = dir.path().join("config.json");
        std::fs::write(
            &config,
            r#"{"version":1,"cron":{"tasks":[{"id":"taken","vault":"/tmp/v","at":"22:00","prompt":"p"}]}}"#,
        )
        .unwrap();

        // 先证明可写：成功写一条，再回到原内容做失败断言。
        let ok = CronTaskDraft::from_args(
            &serde_json::json!({"id":"fresh","at":"09:00","prompt":"p","vault":"/tmp/v"}),
            "/tmp/v",
        );
        create_task_at(&config, &ok).expect("同文件必须先可写");
        std::fs::write(
            &config,
            r#"{"version":1,"cron":{"tasks":[{"id":"taken","vault":"/tmp/v","at":"22:00","prompt":"p"}]}}"#,
        )
        .unwrap();
        let before = std::fs::read(&config).unwrap();

        for (args, code) in [
            (
                serde_json::json!({"id":"bad","at":"25:00","prompt":"p","vault":"/tmp/v"}),
                "cron_task_invalid",
            ),
            (
                serde_json::json!({"id":"taken","at":"09:00","prompt":"p","vault":"/tmp/v"}),
                "cron_task_exists",
            ),
        ] {
            let draft = CronTaskDraft::from_args(&args, "/tmp/v");
            let error = create_task_at(&config, &draft).expect_err("应拒绝");
            assert_eq!(error.code, code, "{error:?}");
            assert_eq!(
                std::fs::read(&config).unwrap(),
                before,
                "失败不得改动配置：{args}"
            );
        }

        // 落盘失败：父路径是普通文件，连目录都建不出来。
        let blocker = dir.path().join("blocker");
        std::fs::write(&blocker, b"not a dir").unwrap();
        let draft = CronTaskDraft::from_args(&task_args(), "/tmp/vault-a");
        let error = create_task_at(&blocker.join("config.json"), &draft).expect_err("应拒绝");
        assert_eq!(error.code, "config_write_failed", "{error:?}");
    }

    /// 重名的唯一性判据是**文件里的全部 id**（含装载期因非法而被丢弃的项）：否则下次启动的
    /// 「保留首项」会把刚写进去的那条丢掉。
    #[test]
    fn create_task_rejects_ids_that_only_appear_in_dropped_items() {
        let dir = TempDir::new();
        let config = dir.path().join("config.json");
        std::fs::write(
            &config,
            r#"{"cron":{"tasks":[{"id":"ghost","vault":"/tmp/v","at":"25:00","prompt":"p"}]}}"#,
        )
        .unwrap();
        let draft = CronTaskDraft::from_args(
            &serde_json::json!({"id":"ghost","at":"09:00","prompt":"p","vault":"/tmp/v"}),
            "/tmp/v",
        );
        let error = create_task_at(&config, &draft).expect_err("装载期丢弃的 id 也算重名");
        assert_eq!(error.code, "cron_task_exists", "{error:?}");
        assert!(
            error.message.contains("25:00"),
            "应指出既有任务的 at：{error:?}"
        );
    }

    /// 装载期与工具侧**同一句原因**（design §5 / tasks 1.2）：同一组非法形态经两条入口各跑一次，
    /// `field` 与原因文案逐字相等。区分度：任何一处文案被改写，本用例必 FAIL。
    #[test]
    fn load_and_tool_report_the_same_field_and_reason() {
        for item in [
            serde_json::json!({"id":"x","vault":"/tmp/v","at":"25:00","prompt":"p"}),
            serde_json::json!({"id":"","vault":"/tmp/v","at":"21:00","prompt":"p"}),
            serde_json::json!({"id":"x","vault":"relative/path","at":"21:00","prompt":"p"}),
            serde_json::json!({"id":"x","vault":"/tmp/v","at":"21:00","prompt":"   "}),
            serde_json::json!({"id":"x","vault":"/tmp/v","at":"21:00","prompt":"p","days":[]}),
            serde_json::json!({"id":"x","vault":"/tmp/v","at":21,"prompt":"p"}),
        ] {
            let dir = TempDir::new();
            let config = dir.path().join("config.json");
            let body = serde_json::json!({"cron":{"tasks":[item]}});
            std::fs::write(&config, serde_json::to_string(&body).unwrap()).unwrap();

            let snapshot = crate::config::load_from(&config);
            let load_issue = snapshot
                .cron_issues
                .first()
                .unwrap_or_else(|| panic!("装载期应丢弃：{item}"));
            // 工具侧换一个 id：重名检查先于字段检查，同 id 会掩盖本用例要比的字段文案。
            let mut tool_args = item.clone();
            if tool_args["id"] == serde_json::json!("x") {
                tool_args["id"] = serde_json::json!("tool-side");
            }
            let draft = CronTaskDraft::from_args(&tool_args, "/tmp/v");
            let error = create_task_at(&config, &draft).expect_err("工具侧应拒绝");

            assert_eq!(error.code, "cron_task_invalid", "{item}");
            assert_eq!(
                error.field.as_deref(),
                Some(load_issue.field.as_str()),
                "字段定位不一致：{item}"
            );
            assert_eq!(
                error.reason.as_deref(),
                Some(load_issue.reason.as_str()),
                "原因文案不一致：{item}"
            );
        }
    }

    /// `remove`：目标存在则删除并回执；不存在报 `cron_task_not_found` 且配置逐字节不变。
    #[test]
    fn remove_task_deletes_only_the_named_entry() {
        let dir = TempDir::new();
        let config = dir.path().join("config.json");
        std::fs::write(
            &config,
            r#"{"cron":{"tasks":[{"id":"a","vault":"/tmp/v","at":"21:00","prompt":"p"},{"id":"b","vault":"/tmp/v","at":"22:00","prompt":"p"}]}}"#,
        )
        .unwrap();
        remove_task_at(&config, "a").expect("应删除");
        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&config).unwrap()).unwrap();
        let tasks = value["cron"]["tasks"].as_array().unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["id"], "b");

        let before = std::fs::read(&config).unwrap();
        let error = remove_task_at(&config, "missing").expect_err("不存在应报错");
        assert_eq!(error.code, "cron_task_not_found", "{error:?}");
        assert_eq!(std::fs::read(&config).unwrap(), before, "失败不得改配置");
    }

    /// `list`：读配置有效任务 + 只读状态文件；状态缺失时 `last_fired = None`，存在时取当日值。
    #[test]
    fn list_tasks_reads_config_and_state_without_writing() {
        let dir = TempDir::new();
        let config = dir.path().join("config.json");
        let state = state_path(dir.path());
        std::fs::write(
            &config,
            r#"{"cron":{"tasks":[{"id":"a","vault":"/tmp/v","at":"21:00","prompt":"p"},{"id":"broken","vault":"/tmp/v","at":"25:00","prompt":"p"}]}}"#,
        )
        .unwrap();

        let tasks = list_tasks_at(&config, &state);
        assert_eq!(tasks.len(), 1, "非法项在列表里不可见（与装载期同一套校验）");
        assert_eq!(tasks[0].id, "a");
        assert_eq!(tasks[0].last_fired, None);

        let mut cron_state = CronState::default();
        cron_state.mark_fired("a", "2026-10-18");
        save_state(&state, &cron_state).unwrap();
        let before = std::fs::read(&config).unwrap();
        let tasks = list_tasks_at(&config, &state);
        assert_eq!(tasks[0].last_fired.as_deref(), Some("2026-10-18"));
        assert_eq!(std::fs::read(&config).unwrap(), before, "list 不写配置文件");

        // 配置不可解析 ⇒ 空表（宽读，不报错）。
        std::fs::write(&config, "{not json").unwrap();
        assert!(list_tasks_at(&config, &state).is_empty());
    }

    /// 批准卡预览：`skip_today` 与线程用同一个判据；缺省字段按缺省档展示。
    #[test]
    fn create_preview_reports_due_state_and_defaults() {
        let draft = CronTaskDraft::from_args(
            &serde_json::json!({"id":"a","at":"21:00","prompt":"p"}),
            "/abs/vault",
        );
        let before = create_preview(&draft, &now((2026, 10, 18), 20, 0));
        assert_eq!(before["skip_today"], serde_json::json!(false));
        assert_eq!(before["vault"], "/abs/vault");
        assert_eq!(before["delivery"], "notify-then-run");
        assert_eq!(before["session"], "new");
        assert_eq!(
            before["days"],
            serde_json::json!(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])
        );
        assert_eq!(before["prompt"], "p");

        let after = create_preview(&draft, &now((2026, 10, 18), 21, 30));
        assert_eq!(after["skip_today"], serde_json::json!(true));
    }

    /// 退避序列：30s 起、逐次翻倍、封顶 15 分钟；没有失败就没有退避。
    #[test]
    fn delivery_retry_delay_doubles_and_caps() {
        use super::{delivery_retry_delay, DELIVERY_RETRY_MAX};
        assert_eq!(delivery_retry_delay(0), std::time::Duration::ZERO);
        assert_eq!(delivery_retry_delay(1), std::time::Duration::from_secs(30));
        assert_eq!(delivery_retry_delay(2), std::time::Duration::from_secs(60));
        assert_eq!(delivery_retry_delay(3), std::time::Duration::from_secs(120));
        assert_eq!(delivery_retry_delay(4), std::time::Duration::from_secs(240));
        assert_eq!(delivery_retry_delay(5), std::time::Duration::from_secs(480));
        assert_eq!(delivery_retry_delay(6), DELIVERY_RETRY_MAX);
        assert_eq!(delivery_retry_delay(7), DELIVERY_RETRY_MAX);
        // 极端输入不 panic、不溢出。
        assert_eq!(delivery_retry_delay(u32::MAX), DELIVERY_RETRY_MAX);
    }

    /// 退避窗口内的评估不重试、窗口过后重试；达到当日上限后当天恒不重试，次日重新开始。
    #[test]
    fn delivery_retry_backs_off_then_gives_up_for_the_day() {
        use super::{DeliveryRetry, RetryOutcome, DELIVERY_RETRY_LIMIT};
        use std::time::{Duration, Instant};

        let t0 = Instant::now();
        let mut retry = DeliveryRetry::new("2026-10-23", t0);
        assert!(retry.ready("2026-10-23", t0), "首次尝试立即允许");

        // 第 1 次失败：30s 内不重试。
        let outcome = retry.record_failure("2026-10-23", t0);
        assert_eq!(
            outcome,
            RetryOutcome::Retry {
                failures: 1,
                next_in: Duration::from_secs(30)
            }
        );
        assert!(!retry.ready("2026-10-23", t0));
        assert!(!retry.ready("2026-10-23", t0 + Duration::from_secs(29)));
        assert!(retry.ready("2026-10-23", t0 + Duration::from_secs(30)));

        // 连续失败到上限：最后一次返回 GivenUp，此后当天不再允许尝试。
        let mut at = t0 + Duration::from_secs(30);
        let mut last = None;
        while retry.failures() + 1 < DELIVERY_RETRY_LIMIT {
            last = Some(retry.record_failure("2026-10-23", at));
            at += Duration::from_secs(60 * 60);
        }
        let outcome = retry.record_failure("2026-10-23", at);
        assert_eq!(
            outcome,
            RetryOutcome::GivenUp {
                failures: DELIVERY_RETRY_LIMIT
            },
            "第 {DELIVERY_RETRY_LIMIT} 次失败即当日放弃（中间结果：{last:?}）"
        );
        assert!(!retry.ready("2026-10-23", at + Duration::from_secs(24 * 60 * 60)));

        // 跨日：重新计数，立即允许。
        assert!(retry.ready("2026-10-24", at));
        assert_eq!(
            retry.record_failure("2026-10-24", at),
            RetryOutcome::Retry {
                failures: 1,
                next_in: Duration::from_secs(30)
            },
            "跨日后的第一次失败按新的一天重新计数"
        );
    }

    // ── 点击通知的落点（M752） ─────────────────────────────────────────────
    //
    // 这四条形状是真实的现场来源：①冷启动期点掉通知（接线层还没装好）、②同一通知点两次、
    // ③进程重启后点昨天的通知、④`run-then-notify` / `silent-run` 的点击落点。

    fn click_input<'a>(delivery: DeliveryPolicy) -> ClickInput<'a> {
        ClickInput {
            delivery,
            kind: match delivery {
                DeliveryPolicy::RunThenNotify => NoticeKind::Result,
                _ => NoticeKind::Trigger,
            },
            session_snapshot: None,
            inflight: false,
            bridge_ready: true,
            clicked_today: None,
            state_session_today: None,
        }
    }

    #[test]
    fn click_defers_while_the_bridge_is_not_ready() {
        for delivery in [
            DeliveryPolicy::NotifyThenRun,
            DeliveryPolicy::RunThenNotify,
            DeliveryPolicy::SilentRun,
        ] {
            let input = ClickInput {
                bridge_ready: false,
                ..click_input(delivery)
            };
            assert_eq!(
                plan_click(&input),
                ClickPlan::Defer,
                "{delivery:?}：接线层未就绪时点击必须保留（通知点掉就没有第二次机会），不得按失败落地"
            );
        }
    }

    #[test]
    fn first_click_runs_and_repeat_click_only_opens() {
        let input = click_input(DeliveryPolicy::NotifyThenRun);
        assert_eq!(plan_click(&input), ClickPlan::Run, "首次点击 = 发起运行");

        let running = ClickInput {
            clicked_today: Some(None),
            ..click_input(DeliveryPolicy::NotifyThenRun)
        };
        assert_eq!(
            plan_click(&running),
            ClickPlan::FocusOnly,
            "首次运行还没回执：只聚焦，不得起第二次运行"
        );

        let done = ClickInput {
            clicked_today: Some(Some("s-today")),
            ..click_input(DeliveryPolicy::NotifyThenRun)
        };
        assert_eq!(
            plan_click(&done),
            ClickPlan::OpenSession("s-today".to_string()),
            "今日已跑过：只打开那次会话"
        );
    }

    #[test]
    fn yesterday_session_does_not_suppress_todays_run() {
        // 进程重启丢了 `clicked_today`：今日开始的会话才作「今天已跑过」的判据。
        let input = ClickInput {
            state_session_today: None,
            ..click_input(DeliveryPolicy::NotifyThenRun)
        };
        assert_eq!(
            plan_click(&input),
            ClickPlan::Run,
            "去重状态里的会话属于昨天 ⇒ 今天照常发起运行（跨日重新允许）"
        );

        let today = ClickInput {
            state_session_today: Some("s-today"),
            ..click_input(DeliveryPolicy::NotifyThenRun)
        };
        assert_eq!(
            plan_click(&today),
            ClickPlan::OpenSession("s-today".to_string()),
            "今日已跑过（进程重启后靠去重状态补判）：只打开，不重复运行"
        );
    }

    #[test]
    fn result_and_silent_notifications_land_on_their_own_actions() {
        // 结果通知的会话来自**点击上下文的快照**（change add-cron-notification-relaunch
        // §5.2）：tasks 段里的最新会话在这条路径上不参与判定。
        let result = ClickInput {
            session_snapshot: Some("s-run"),
            ..click_input(DeliveryPolicy::RunThenNotify)
        };
        assert_eq!(
            plan_click(&result),
            ClickPlan::OpenSession("s-run".to_string()),
            "结果通知点击：恢复该次运行的会话，不重新运行"
        );

        let missing = click_input(DeliveryPolicy::RunThenNotify);
        assert_eq!(
            plan_click(&missing),
            ClickPlan::Reject("session_missing"),
            "没有可恢复的会话 ⇒ 拒绝并给人话反馈"
        );

        let silent = click_input(DeliveryPolicy::SilentRun);
        assert_eq!(
            plan_click(&silent),
            ClickPlan::Reject("no_notification"),
            "silent-run 没有通知可点"
        );
    }

    #[test]
    fn deferred_click_keeps_only_the_latest_and_is_one_shot() {
        let mut deferred = DeferredClick::default();
        assert!(deferred.is_empty());
        let first = crate::cron::ClickContext {
            request_id: "req-1".to_string(),
            task: "task-a".to_string(),
            kind: NoticeKind::Trigger,
            session_id: None,
            date: "2026-10-28".to_string(),
        };
        let second = crate::cron::ClickContext {
            request_id: "req-2".to_string(),
            ..first.clone()
        };
        assert!(deferred.defer(first, ClickSource::Relaunch).is_empty());
        let replaced = deferred.defer(second, ClickSource::Relaunch);
        assert_eq!(
            replaced
                .iter()
                .map(|(context, _)| context.request_id.as_str())
                .collect::<Vec<_>>(),
            vec!["req-1"],
            "同任务后到者覆盖先到者，被顶掉的那条交回调用方补 not_ready"
        );
        let taken = deferred.take_all();
        assert_eq!(taken.len(), 1);
        assert_eq!(
            taken[0].0.request_id, "req-2",
            "后到的点击覆盖先到的：用户点的永远是最后那条"
        );
        assert!(
            deferred.take_all().is_empty(),
            "重放是一次性的，不得重复执行"
        );
    }

    /// 保留是**整份上下文**（r1 合同）：重放要恢复被点那条通知的会话，只留任务 id 会让重放
    /// 退化成「按最新会话重算」。
    #[test]
    fn deferred_click_keeps_the_whole_context() {
        let mut deferred = DeferredClick::default();
        let context = crate::cron::ClickContext {
            request_id: "req-9".to_string(),
            task: "task-a".to_string(),
            kind: NoticeKind::Result,
            session_id: Some("sess-snapshot".to_string()),
            date: "2026-10-28".to_string(),
        };
        deferred.defer(context.clone(), ClickSource::Relaunch);
        let taken = deferred.take_all();
        assert_eq!(taken[0].0, context, "整份上下文逐字段保留");
        assert_eq!(
            taken[0].1,
            ClickSource::Relaunch,
            "来源也一起保留（诊断用）"
        );
    }
}

#[cfg(test)]
mod click_tests {
    use super::*;

    fn task_ids(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| id.to_string()).collect()
    }

    fn click_input(delivery: DeliveryPolicy) -> ClickInput<'static> {
        ClickInput {
            delivery,
            kind: match delivery {
                DeliveryPolicy::RunThenNotify => NoticeKind::Result,
                _ => NoticeKind::Trigger,
            },
            session_snapshot: None,
            inflight: false,
            bridge_ready: true,
            clicked_today: None,
            state_session_today: None,
        }
    }

    fn notice(task: &str, kind: NoticeKind, date: &str, session: Option<&str>) -> NoticeRecord {
        NoticeRecord {
            task: task.to_string(),
            kind,
            date: date.to_string(),
            session_id: session.map(str::to_string),
        }
    }

    fn context(
        request_id: &str,
        task: &str,
        kind: NoticeKind,
        session: Option<&str>,
    ) -> ClickContext {
        ClickContext::from_delivery(request_id, task, kind, session, "2026-10-28")
    }

    // ---- 台账 ----

    /// 台账条目写入即快照；旧文件（无 `notices` 段）读进来是空台账，不做迁移。
    #[test]
    fn notice_ledger_reads_old_state_as_empty_and_round_trips() {
        let old = r#"{"version":1,"tasks":{"a":{"last_fired":"2026-10-27"}}}"#;
        let state: CronState = serde_json::from_str(old).expect("旧存档仍可读");
        assert!(state.notices.is_empty(), "旧文件不迁移，读成空台账");
        assert_eq!(state.last_fired("a"), Some("2026-10-27"));

        let mut state = state;
        state.record_notice(
            "req-1",
            notice("a", NoticeKind::Result, "2026-10-28", Some("s1-x")),
            "2026-10-28",
        );
        let text = serde_json::to_string(&state).expect("可序列化");
        let parsed: CronState = serde_json::from_str(&text).expect("往返可读");
        assert_eq!(parsed, state);
        assert_eq!(
            parsed.notice("req-1").map(|record| record.kind),
            Some(NoticeKind::Result)
        );
    }

    /// 有界裁剪：先按保留窗口，再按条数上限；`tasks` 段逐字不变。
    #[test]
    fn notice_ledger_prunes_without_touching_tasks() {
        let mut state = CronState::default();
        state.mark_fired("a", "2026-10-28");
        state.set_session("a", Some("s9-x"));
        state.record_notice(
            "old",
            notice("a", NoticeKind::Trigger, "2026-10-20", None),
            "2026-10-20",
        );
        state.record_notice(
            "keep",
            notice("a", NoticeKind::Trigger, "2026-10-22", None),
            "2026-10-28",
        );
        assert!(state.notice("old").is_none(), "早于今天 − 7 天的条目被裁掉");
        assert!(state.notice("keep").is_some());
        assert_eq!(state.last_fired("a"), Some("2026-10-28"));
        assert_eq!(state.session_id("a"), Some("s9-x"));

        // 条数上限：塞满后最旧的先走。
        let mut state = CronState::default();
        for index in 0..(NOTICE_LEDGER_MAX + 5) {
            state.record_notice(
                &format!("req-{index:02}"),
                notice("a", NoticeKind::Trigger, "2026-10-28", None),
                "2026-10-28",
            );
        }
        assert_eq!(state.notices.len(), NOTICE_LEDGER_MAX);
        assert!(state.notice("req-00").is_none());
        assert!(state
            .notice(&format!("req-{:02}", NOTICE_LEDGER_MAX + 4))
            .is_some());
    }

    /// 同一任务的多条条目各自独立：后写的不改写既有条目的快照会话。
    #[test]
    fn ledger_entries_are_snapshots() {
        let mut state = CronState::default();
        state.record_notice(
            "req-a",
            notice("a", NoticeKind::Result, "2026-10-28", Some("sess-a")),
            "2026-10-28",
        );
        state.record_notice(
            "req-b",
            notice("a", NoticeKind::Result, "2026-10-28", Some("sess-b")),
            "2026-10-28",
        );
        assert_eq!(
            state
                .notice("req-a")
                .and_then(|record| record.session_id.as_deref()),
            Some("sess-a")
        );
        assert_eq!(
            state
                .notice("req-b")
                .and_then(|record| record.session_id.as_deref()),
            Some("sess-b")
        );
    }

    // ---- 通知 id 的同源性（r1 P2-4） ----

    /// 非 macOS 的 request id 必须就是系统里的通知 id（平台 id 的十进制形态），且两者由**同一次**
    /// 时钟读数派生。分两次取时钟的实现（一个字符串 id + 另一个 u32）在这里必红。
    #[test]
    fn platform_request_id_is_the_platform_id() {
        let millis = 1_790_000_000_123_u128;
        // 十进制形态：小数值原样，大数值按平台 id 的低位截断——判据是「与平台 id 同一个值」，
        // 不是某个写死的字面量。
        assert_eq!(platform_request_id(12_345), "12345");
        assert_eq!(
            platform_request_id(millis),
            platform_notification_id(millis).to_string(),
            "返回值必须与系统里的请求标识逐字相同"
        );
        assert_eq!(
            platform_request_id(millis).parse::<u32>(),
            Ok(platform_notification_id(millis)),
            "返回的 id 反过来解析出来仍是系统里那个 id"
        );
        assert_ne!(
            platform_notification_id(millis),
            platform_notification_id(millis + 1),
            "不同次投递要拿到不同 id（否则系统会按 id 替换掉上一条）"
        );
        // macOS 的 request id 形状仍带任务 / 种类 / 毫秒，供诊断阅读；它不被解析。
        assert_eq!(
            notification_request_id("task-a", NoticeKind::Trigger, millis),
            "lumir-cron-task-a-trigger-1790000000123"
        );
        assert_eq!(
            notification_request_id("acc-cron-click-run", NoticeKind::Result, millis),
            "lumir-cron-acc-cron-click-run-result-1790000000123",
            "任务 id 含 `-` 时形状仍只是线索"
        );
    }

    // ---- 动作归一化 ----

    /// 系统默认动作标识必须归一为 `Tap`：把原始字符串直接交给 `Tap` 判据的实现（只认内部字面量
    /// 的实现）在这条上必红——本 change 要修的正文点击就走在它上面。
    #[test]
    fn system_default_action_normalizes_to_tap() {
        assert_eq!(
            normalize_action(UN_DEFAULT_ACTION_IDENTIFIER),
            NoticeAction::Tap
        );
        assert_eq!(
            normalize_action(UN_DISMISS_ACTION_IDENTIFIER),
            NoticeAction::Dismiss
        );
        assert_eq!(
            normalize_action("com.lumir.custom"),
            NoticeAction::Custom("com.lumir.custom".to_string())
        );
        // 原始系统标识不能直接当内部动作：它既不是 `"tap"`，也不该被当成 Tap 之外的处置路径。
        assert_ne!(UN_DEFAULT_ACTION_IDENTIFIER, "tap");
    }

    // ---- 接收判据真值表 ----

    #[test]
    fn accept_click_in_process_channel_ignores_the_ledger() {
        let state = CronState::default(); // 台账为空 / 写失败的同形
        let in_process = context("req-1", "task-a", NoticeKind::Result, Some("sess-a"));
        let live = task_ids(&["task-a"]);
        let (accepted, source) = accept_click(&AcceptInput {
            request_id: "req-1",
            in_process: Some(&in_process),
            state: &state,
            live_tasks: &live,
            today: "2026-10-28",
        })
        .expect("进程内命中即接受：台账为空不构成拒绝理由");
        assert_eq!(source, ClickSource::InProcess);
        assert_eq!(accepted.session_id.as_deref(), Some("sess-a"));
    }

    #[test]
    fn accept_click_relaunch_channel_uses_the_ledger() {
        let mut state = CronState::default();
        state.record_notice(
            "req-2",
            notice("task-a", NoticeKind::Trigger, "2026-10-28", None),
            "2026-10-28",
        );
        let live = task_ids(&["task-a"]);
        let (accepted, source) = accept_click(&AcceptInput {
            request_id: "req-2",
            in_process: None,
            state: &state,
            live_tasks: &live,
            today: "2026-10-28",
        })
        .expect("台账命中即接受");
        assert_eq!(source, ClickSource::Relaunch);
        assert_eq!(accepted.kind, NoticeKind::Trigger);
        assert_eq!(accepted.session_id, None);

        // 台账外 request id：拒绝，且不上屏提示。
        let rejected = accept_click(&AcceptInput {
            request_id: "req-2",
            in_process: None,
            state: &CronState::default(),
            live_tasks: &live,
            today: "2026-10-28",
        })
        .expect_err("台账里没有该 request id");
        assert_eq!(rejected, ClickRejection::NoticeUnknown);
        assert_eq!(rejected.notice_code(), None);
    }

    #[test]
    fn accept_click_rejects_deleted_task_and_stale_notice() {
        let mut state = CronState::default();
        state.record_notice(
            "req-3",
            notice("task-a", NoticeKind::Trigger, "2026-10-28", None),
            "2026-10-28",
        );
        let live = task_ids(&["task-b"]);
        assert_eq!(
            accept_click(&AcceptInput {
                request_id: "req-3",
                in_process: None,
                state: &state,
                live_tasks: &live,
                today: "2026-10-28",
            })
            .expect_err("任务已被删除"),
            ClickRejection::TaskUnknown
        );

        // 任务在、日期不是今天：跨天点击拒绝（两条通道同一判据）。
        let in_process = context("req-4", "task-b", NoticeKind::Trigger, None);
        let live = task_ids(&["task-b"]);
        assert_eq!(
            accept_click(&AcceptInput {
                request_id: "req-4",
                in_process: Some(&in_process),
                state: &state,
                live_tasks: &live,
                today: "2026-10-29",
            })
            .expect_err("派发日期不是今天"),
            ClickRejection::NoticeStale
        );

        // 三条拒绝码各有各的用户提示，不合并。
        assert_eq!(
            ClickRejection::TaskUnknown.notice_code(),
            Some("cron_click_task_deleted")
        );
        assert_eq!(
            ClickRejection::NoticeStale.notice_code(),
            Some("cron_click_notice_stale")
        );
        assert_eq!(ClickRejection::NoticeUnknown.as_str(), "notice_unknown");
    }

    /// 任务 id 允许含 `-`：识别全靠台账 / 上下文，不解析 request id 的字符串形状。
    #[test]
    fn accept_click_does_not_parse_the_request_id() {
        let mut state = CronState::default();
        let request_id = "lumir-cron-acc-cron-click-run-trigger-1700000000000";
        state.record_notice(
            request_id,
            notice(
                "acc-cron-click-run",
                NoticeKind::Trigger,
                "2026-10-28",
                None,
            ),
            "2026-10-28",
        );
        let live = task_ids(&["acc-cron-click-run"]);
        let (accepted, _) = accept_click(&AcceptInput {
            request_id,
            in_process: None,
            state: &state,
            live_tasks: &live,
            today: "2026-10-28",
        })
        .expect("含 `-` 的任务 id 照样识别");
        assert_eq!(accepted.task, "acc-cron-click-run");
    }

    // ---- 上下文与处置计划 ----

    #[test]
    fn click_context_round_trips_through_the_ledger_shape() {
        let ctx = ClickContext::from_delivery(
            "req-5",
            "task-a",
            NoticeKind::Failure,
            Some("sess-5"),
            "2026-10-28",
        );
        let from_ledger = ClickContext::from_notice("req-5", &ctx.notice());
        assert_eq!(from_ledger, ctx, "两条通道交出同一形状");
    }

    /// **区分度用例**（design §5.2 可达性说明）：处置层必须用上下文快照，而不是任务的最新会话。
    #[test]
    fn click_plan_opens_the_snapshot_session_not_the_latest_one() {
        // **区分度用例**（design §5.2）：结果 / 失败通知的会话只来自点击上下文的快照。
        // 判据是「给处置层的输入里根本没有『任务最新会话』这个位置」——`ClickInput` 没有
        // 那个字段，`state_session_today` 只服务到点通知的重启后判据。把实现改成读最新会话，
        // 这条用例就没有任何输入能让它返回 `sess-latest`，因此必然判红。
        let snapshot = ClickInput {
            kind: NoticeKind::Result,
            session_snapshot: Some("sess-snapshot"),
            ..click_input(DeliveryPolicy::RunThenNotify)
        };
        assert_eq!(
            plan_click(&snapshot),
            ClickPlan::OpenSession("sess-snapshot".to_string())
        );

        // 同一任务两条条目各持不同快照：点哪条开哪条。
        for (request_id, expected) in [("req-6", "sess-first"), ("req-7", "sess-second")] {
            let _ = request_id;
            let entry = ClickInput {
                kind: NoticeKind::Failure,
                session_snapshot: Some(expected),
                ..click_input(DeliveryPolicy::RunThenNotify)
            };
            assert_eq!(
                plan_click(&entry),
                ClickPlan::OpenSession(expected.to_string()),
                "每次恢复的都是被点那条条目快照里的会话"
            );
        }

        // 到点通知没有快照会话：这条路径上 `session_snapshot` 不参与判定（由「今天跑没跑」判）。
        let trigger = ClickInput {
            kind: NoticeKind::Trigger,
            session_snapshot: None,
            ..click_input(DeliveryPolicy::NotifyThenRun)
        };
        assert_eq!(plan_click(&trigger), ClickPlan::Run);
    }

    #[test]
    fn click_plan_covers_trigger_idempotency() {
        // 到点通知按「今天跑没跑」判：`clicked_today` 的两种形态（有 / 无会话）+ 在途 + 昨日记录。
        let running = ClickInput {
            clicked_today: Some(None),
            ..click_input(DeliveryPolicy::NotifyThenRun)
        };
        assert_eq!(
            plan_click(&running),
            ClickPlan::FocusOnly,
            "回执未到：只聚焦"
        );

        let done = ClickInput {
            clicked_today: Some(Some("sess-today")),
            ..click_input(DeliveryPolicy::NotifyThenRun)
        };
        assert_eq!(
            plan_click(&done),
            ClickPlan::OpenSession("sess-today".to_string()),
            "当日已跑过：只打开那条会话，不重跑"
        );

        let inflight = ClickInput {
            inflight: true,
            ..click_input(DeliveryPolicy::NotifyThenRun)
        };
        assert_eq!(
            plan_click(&inflight),
            ClickPlan::FocusOnly,
            "进程重启丢了去重记录但有在途运行：并发点击的后到者只聚焦"
        );

        assert_eq!(
            plan_click(&click_input(DeliveryPolicy::NotifyThenRun)),
            ClickPlan::Run,
            "全新点击：发起运行"
        );

        // 结果 / 失败通知没有快照会话 ⇒ 拒绝（不是「读最新会话」再试一次）。
        let missing = ClickInput {
            kind: NoticeKind::Failure,
            session_snapshot: None,
            ..click_input(DeliveryPolicy::RunThenNotify)
        };
        assert_eq!(plan_click(&missing), ClickPlan::Reject("session_missing"));

        // silent-run 没有通知可点。
        assert_eq!(
            plan_click(&click_input(DeliveryPolicy::SilentRun)),
            ClickPlan::Reject("no_notification")
        );
    }
}
