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

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Datelike, FixedOffset, Local, Timelike};
use serde::{Deserialize, Serialize};

use crate::config::{CronTask, CronWeekday, DeliveryPolicy};

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
}

impl Trigger {
    /// 诊断事件里的字面量（`cron_notified.trigger` / `cron_run_started.trigger`）。
    pub fn as_str(self) -> &'static str {
        match self {
            Trigger::Timer => "timer",
            Trigger::Startup => "startup",
            Trigger::Focus => "focus",
            Trigger::VaultOpen => "vault-open",
        }
    }

    /// 拉取兜底（启动 / 焦点 / vault 打开）。当日被跳过的任务允许它们重试；定时器不重试
    /// （design §6.5：避免日志噪音，补跑落在下一次拉取触发）。
    pub fn is_pull(self) -> bool {
        !matches!(self, Trigger::Timer)
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

/// **纯函数**：不读时钟、不碰磁盘。四个触发源都只走它。
pub fn decide(input: &CheckInput) -> Decision {
    let due = input.days.contains(&input.now.weekday)
        && input.now.minutes_since_midnight >= input.at_minutes;
    if !due {
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
    /// 该任务是否已有在途运行。
    pub inflight: bool,
    /// 该任务今日是否已经落过一条 `cron_run_skipped`（当日去重，避免日志噪音）。
    pub skipped_today: bool,
    pub trigger: Trigger,
}

/// 判定 + 派发策略的**唯一合成点**：纯函数。
///
/// 规则（design §5 / §5.4 / §6.5）：
/// 1. [`decide`] 不给 `Fire` ⇒ `Idle`；
/// 2. 定时器遇到「今日已跳过」的任务不再尝试（补跑交给下一次拉取触发）；
/// 3. `notify-then-run` 只投通知——点击以前没有任何模型调用；
/// 4. `run-then-notify` / `silent-run` 要发起运行：当前没有打开 vault ⇒ `not_ready`；目标
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
        DeliveryPolicy::RunThenNotify | DeliveryPolicy::SilentRun => match input.current_vault {
            None => Plan::Skip(SkipReason::NotReady),
            Some(current) if current != input.task.vault => Plan::Skip(SkipReason::VaultNotCurrent),
            Some(_) if input.inflight => Plan::Skip(SkipReason::Busy),
            Some(_) => Plan::Handoff,
        },
    }
}

// ---------------------------------------------------------------------------
// 触发去重状态（cron-state.json）
// ---------------------------------------------------------------------------

/// 单个任务的去重记录。两个字段都可缺：`last_fired` 只在派发成功时写，`session_id` 只在
/// 运行终态回执带回时写。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CronTaskRecord {
    /// 最近一次**派发成功**的本地日期（`YYYY-MM-DD`）：当日至多一次的判据。
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
}

impl Default for CronState {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            tasks: BTreeMap::new(),
        }
    }
}

impl CronState {
    /// 该任务今日是否已派发过（判定与派发共用的唯一读数）。
    pub fn last_fired(&self, task: &str) -> Option<&str> {
        self.tasks
            .get(task)
            .and_then(|record| record.last_fired.as_deref())
    }

    /// 派发成功后的唯一写入口（`date` 是本地日期，不是 UTC）。
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
            inflight,
            skipped_today,
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
}
