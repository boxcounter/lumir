//! 会话：一个 vault 的内存态对话状态（design §2「会话边界」）。
//!
//! 一个会话同时维护两份视角：
//! - `input`：OpenAI Responses API 形状的消息项（`session::input_item` 构造），直接喂 LLM；
//! - `panel`：面板渲染模型（role: user/assistant/tool/compact + text/summary/name/status/ts），
//!   是 `harness_state` 快照的消息来源（m303 消费形状）。
//!
//! 两边随同一个动作一起更新，MUST NOT 各自漂移——面板上看到的与模型看到的永远是同一会话。

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::commands::CommandError;

use super::approval::{ApprovalDecision, ApprovalRequest, ApprovalSignal};
use super::jsonl::JsonlWriter;
use super::llm::{normalize_reasoning_item, Usage};
use super::permissions::DecisionReason;
use super::scheduler::AutoWakeSnapshot;
use super::subagents::SubagentHub;
use super::thinking::ThinkingEffort;
use super::title::TitleSchedule;

/// 面板消息（`harness_state` 快照 `messages[]` 的元素；m303 宽容解析，缺字段=空态）。
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct PanelMessage {
    /// user / assistant / tool / compact。
    pub role: String,
    /// 完整文本（user/assistant 的主内容）。
    /// **空时不序列化**（`skip_serializing_if`）——TS 侧按「可能缺席」读。
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// 恢复重建的思考展示文本（M398）：仅当 wire 的 reasoning 回放项里取得到**明文**时带值
    /// （kimi 的 `encrypted_content` 项取不到 → 缺省，不伪造）。活会话的思考块由
    /// `reasoning_chunk` 事件驱动、不进面板记录——本字段只在恢复重建的面板消息上有值。
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    /// 摘要（compact 消息的压缩摘要，面板可展开）。
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// 工具名（tool 消息）。
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 执行状态：tool 消息的工具终态（done / denied / rejected / error）；
    /// assistant 消息的中断标注（"stopped" = 本轮被用户停止，面板 D383 徽标的数据源，M348）。
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// 批准闸决定（tool 消息，M413）：进过批准闸的调用带「approved」/「rejected」——
    /// 「已采纳」可见性与免闸直执行的区分靠它（status 两者都是 done）。allow / deny 规则
    /// 路径没有批准动作，字段缺席。快照恢复路径从 JSONL 的 approval sidecar 回填。
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<String>,
    /// 消息入会话的时刻（UNIX 秒）；面板据它显示时间读数（0 = 无读数，前端不显示、不伪造）。
    // 打戳点是 `Session::push_panel` 的每个构造处，取时用 `super::jsonl::unix_secs_now`——
    // 与留存记录的 `ts` 同一取时点（两处各自取时会漂）。**恢复重建的消息**（M460）的戳不是
    // 当下时刻，而是留存**信封 ts** 沿记录序的归属值（`harness::restored_messages_ts`），
    // 归属不到记 0。
    // ts-rs 默认把 u64 映成 bigint，而 JSON.parse 出来的是 number：与 FsEntry::size 同处理。
    #[ts(type = "number")]
    pub ts: u64,
}

/// 本回合缓存命中率的**成因标注**（M443，design §3.4）：仅针对最近一次往返，由后端一处判定
/// （前端 MUST NOT 自行猜成因）。序列化为 snake_case 字符串（`cold_start` / `block_dilution`），
/// 前端按值取文案（成因句落 hover 气泡，见 design §5.2）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CacheNote {
    /// 本回合 `cached_tokens == 0`：会话首个请求的典型冷启动；中途前缀缓存过期导致的零命中
    /// 落同一句（裁决点 3 的 A 案——用户问的是「为什么没命中」，两者同一解释）。
    ColdStart,
    /// 本回合新增 tokens 超过已缓存前缀的一半：大块新内容把命中率**算术摊薄**，非缓存失效。
    BlockDilution,
}

/// 面板用量读数（常驻控制行 ctx% / cache% 与其 hover 气泡的数据源）。
///
/// 本结构的**序列化**就是两条载体的读数键集合（M534）：`harness_state` 快照的 `usage` 与
/// `harness:event` 的 `usage` 事件同吃这一份 `Serialize`（[`super::events::usage`] 另加一个
/// 判别键 `type`）——加字段即两端同改，MUST NOT 让任一侧另列一份键清单（REVIEW.md 「同一语义两处真源」条；
/// 事件侧曾手列键、漏掉 M526 的绝对值键，live 气泡因此静默回落百分比形态）。
///
/// M443 起口径拆开：`ctx_pct` 仍是最近一次请求的值，cache 侧分**会话累计**（控制行主读数）
/// 与**单回合**（气泡辅读数）两个投影——两者是同一批计数器的两个投影，MUST NOT 各算各的
/// （design §2 的一致性原则）。
///
/// M526 起带绝对值字段（`input_tokens` / `cached_tokens[_session]` / `context_window`）：
/// hover 气泡的 tokens 读数由此出，数据不可得时前端走降级文案、MUST NOT 编造（`context_window`
/// 为 0 = 无上限值，前端不显示百分比与上限）。`has_usage` 是「有没有真读数」的判据——六键零值
/// 是缺省不是读数，从未发过请求的会话据它隐藏读数区（否则即「0% · 0%」虚报）。
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct UsageSnapshot {
    /// 上下文窗口已用 %（最近一次 input tokens ÷ 模型窗口，窗口来自配置 schema）。
    pub ctx_pct: f64,
    /// 会话累计命中率（`Σcached ÷ Σinput`，本逻辑会话内所有带 usage 的往返）——控制行主读数。
    pub cache_pct_session: f64,
    /// 最近一次往返的单回合命中率（`cached ÷ input`）——hover 气泡辅读数。
    pub cache_pct_turn: f64,
    /// 最近一次往返的缓存写入 tokens（provider 不提供时 0）。
    pub cache_write_tokens: u64,
    /// 本逻辑会话累计的缓存写入 tokens。
    pub cache_write_tokens_session: u64,
    /// 本回合的成因标注（无标注 = null）。
    pub cache_note: Option<CacheNote>,
    /// 最近一次往返的 input tokens（M526，气泡「上下文已用」绝对值）。
    pub input_tokens: u64,
    /// 最近一次往返的 cached tokens（M526，气泡「本回合缓存命中」绝对值）。
    pub cached_tokens: u64,
    /// 本逻辑会话累计 cached tokens（M526，气泡「会话累计命中」绝对值）。
    pub cached_tokens_session: u64,
    /// `ctx_pct` 的分母（M526：当时算读数用的模型上下文窗口；0 = 无上限值，前端降级）。
    pub context_window: u64,
    /// 是否已有带 usage 的往返（M526：false = 从未发过请求，读数区整体隐藏）。
    pub has_usage: bool,
}

/// 本逻辑会话的缓存计数累计器（design §3.2）：挂在 [`Session`] 上、只增不减；会话建立 /
/// 「新会话」重置 / 自动压缩开新逻辑会话各起一段（前两者是新建 `Session`，压缩是
/// [`Session::rotate`] 的就地清零）。**从历史恢复不是清零点**（M526）：以源会话留存的读数
/// 重算值为基底继续累计——恢复与压缩因此能把 `(快照, 累计器)` 灌进新会话 / 存进新文件首行。
///
/// M526 起随 `session_open` 落盘（恢复/压缩时作下一文件的读数种子）并可以灌回——`pub` 是
/// 留存重算（[`usage_from_records`]）与恢复路径的需要；累加与读数算法只在
/// [`Self::accumulate`] / [`Self::snapshot`] 两处，MUST NOT 另写一套。
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct CacheTotals {
    /// Σ input_tokens。
    pub input: u64,
    /// Σ cached_tokens。
    pub cached: u64,
    /// Σ cache_write_tokens。
    pub writes: u64,
    /// 带 usage 的往返计数（「有没有样本」的判据；`Σinput` 可能为 0 而样本非 0）。
    pub samples: u64,
}

impl CacheTotals {
    /// 累加一次往返（live 的 `record_usage` 与留存的 [`usage_from_records`] 重算共此一份）。
    fn accumulate(&mut self, usage: &Usage) {
        self.input += usage.input_tokens;
        self.cached += usage.cached_tokens;
        self.writes += usage.cache_write_tokens;
        self.samples += 1;
    }

    /// 由累计器 + 最近一次往返算出全部读数（读数算法的唯一产出点）：
    /// live、留存重算、恢复种子三处吃的是同一个值。
    fn snapshot(&self, usage: &Usage, window: u64) -> UsageSnapshot {
        let ctx_pct = if window == 0 {
            0.0
        } else {
            usage.input_tokens as f64 * 100.0 / window as f64
        };
        let cache_pct_turn = if usage.input_tokens == 0 {
            0.0
        } else {
            usage.cached_tokens as f64 * 100.0 / usage.input_tokens as f64
        };
        let cache_pct_session = if self.samples == 0 || self.input == 0 {
            0.0
        } else {
            self.cached as f64 * 100.0 / self.input as f64
        };
        UsageSnapshot {
            ctx_pct,
            cache_pct_session,
            cache_pct_turn,
            cache_write_tokens: usage.cache_write_tokens,
            cache_write_tokens_session: self.writes,
            cache_note: cache_note(usage),
            input_tokens: usage.input_tokens,
            cached_tokens: usage.cached_tokens,
            cached_tokens_session: self.cached,
            context_window: window,
            has_usage: self.samples > 0,
        }
    }
}

/// 本回合成因判定（后端唯一一处，design §3.4）：
///
/// 1. `cached == 0`（且 `input > 0`）→ [`CacheNote::ColdStart`]；
/// 2. 否则 `cached > 0` 且 `input − cached > cached ÷ 2`（等价于单回合命中率 < 66.7%）→
///    [`CacheNote::BlockDilution`]；
/// 3. 否则 `None`。
///
/// 阈值取「新增 > 已缓存前缀的一半」——落在 M438 实测的摊薄现场（input 12786 / cached 6400：
/// 新增 6386 > 3200），稳态（新增仅最后不完整块）不误报。MUST NOT 用「比上一回合低多少」
/// 一类相对判据（无基线、易抖动）。
fn cache_note(usage: &Usage) -> Option<CacheNote> {
    if usage.input_tokens == 0 {
        return None; // 无输入的往返谈不上命中率，不标注（input==0 边界）。
    }
    if usage.cached_tokens == 0 {
        return Some(CacheNote::ColdStart);
    }
    // 新增 > 已缓存的一半（整数口径与实数口径等价：cached 为偶数时 cached÷2 整除，
    // 为奇数时 floor 后 +1 恰是「> 半数」的最小整数）；saturating_sub 防 provider 报出
    // cached > input 的异常读数时下溢。
    if usage.input_tokens.saturating_sub(usage.cached_tokens) * 2 > usage.cached_tokens {
        return Some(CacheNote::BlockDilution);
    }
    None
}

/// 子运行用量桶（change add-harness-subagents design §9.1）：键 = **实际使用的模型 id**，
/// 每段收尾累加一次。父会话自己的 `ctx%` / cache% 只由父自己的往返计算，MUST NOT 掺入这里
/// 的数字——跨模型混算的百分比没有解释力。
///
/// `samples` / `segments`：前者是带 usage 的收尾段数（与 `CacheTotals::samples` 同口径），
/// 后者是子运行段数（resume 的每一段各加一）。live 侧的唯一累加点是
/// [`Session::record_subrun_usage`] / [`Session::mark_subrun_segment`]；恢复侧从父会话留存的
/// `subrun` sidecar 重算（[`subrun_usage_from_records`]），两者吃同一个 [`Self::accumulate`]
/// ——「live 分桶表 == 恢复重算分桶表」是这一处共享换来的，MUST NOT 两套求和。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubrunUsage {
    pub input: u64,
    pub cached: u64,
    pub writes: u64,
    pub output: u64,
    pub samples: u64,
    pub segments: u64,
}

impl SubrunUsage {
    /// 累加一段收尾的用量（live 记账与留存重算共此一份）。
    fn accumulate(&mut self, usage: &Usage) {
        self.input += usage.input_tokens;
        self.cached += usage.cached_tokens;
        self.writes += usage.cache_write_tokens;
        self.output += usage.output_tokens;
        self.samples += 1;
    }
}

/// 从留存记录的 `usage` 块还原 [`Usage`]（恢复路径的重算输入）：`llm_response.usage` 的
/// wire 口径四键——input / cached 必填（缺了就不是一次可计的往返），output / cache_write
/// 缺省 0（`record_llm_response` 恒四键落盘，缺键只可能来自手工改过的文件，宽容不炸）。
fn usage_from_json(value: &serde_json::Value) -> Option<Usage> {
    let number = |key: &str| value[key].as_u64();
    Some(Usage {
        input_tokens: number("input_tokens")?,
        cached_tokens: number("cached_tokens")?,
        output_tokens: number("output_tokens").unwrap_or(0),
        cache_write_tokens: number("cache_write_tokens").unwrap_or(0),
    })
}

/// 从留存记录重算读数（恢复路径，M526）：`llm_request` / `llm_response` 严格交替成对，响应的
/// usage 归属其前一条请求——只有**会话轮次**（请求的 system == 会话 system）计入；压缩调用是
/// 内部汇总调用（system 是压缩指令），与 live 侧 `rotate` 清零累计的口径一致，MUST NOT 计入。
/// **`subrun` sidecar 也不计入这里**（它不是父会话的往返）：子运行用量走
/// [`subrun_usage_from_records`] 按模型分桶，父会话的 ctx% / cache% 因此不被子运行稀释。
///
/// `seed` = 源文件 `session_open` 落账的读数与累计（[`usage_seed`] 的解析产物）——链式恢复
/// （恢复出的会话再被恢复）时它是增量基底；旧文件无种子键 ⇒ 零值缺省。窗口取**当前**配置的
/// 声明值：读数是投影，分母随现配置（与 live 侧每轮现算同口径）。返回的 (快照, 累计器) 同值
/// 同源，由调用侧一并灌进新会话（[`Session::restore_usage`]）并落进新文件的首行。
pub fn usage_from_records(
    records: &[serde_json::Value],
    system: &str,
    window: u64,
    seed: (UsageSnapshot, CacheTotals),
) -> (UsageSnapshot, CacheTotals) {
    let mut totals = seed.1;
    let mut snapshot = seed.0;
    let mut conversation_pending = false;
    for record in records {
        match record["kind"].as_str() {
            Some("llm_request") => {
                conversation_pending = record["request"]["system"].as_str() == Some(system);
            }
            Some("llm_response") => {
                // 任何响应都消耗配对位（错误 / 空响应同样成对落盘）——防御形态不齐的文件。
                let conversation = conversation_pending;
                conversation_pending = false;
                if !conversation {
                    continue;
                }
                let Some(usage) = record.get("usage").and_then(usage_from_json) else {
                    continue;
                };
                totals.accumulate(&usage);
                snapshot = totals.snapshot(&usage, window);
            }
            _ => {}
        }
    }
    (snapshot, totals)
}

/// `session_open` 读数种子的宽容解析（M526）：恢复/压缩开新文件时随首行落账（`usage` +
/// `cache_totals` 两键），链式恢复从这里起算。旧文件无种子键 / 形状不符 ⇒ 零值缺省——重算
/// 只凭记录也能回到正确读数，种子只是让「会话累计」口径跨过文件边界不断档。
pub fn usage_seed(open: &serde_json::Value) -> (UsageSnapshot, CacheTotals) {
    let usage = open
        .get("usage")
        .and_then(|value| serde_json::from_value(value.clone()).ok())
        .unwrap_or_default();
    let totals = open
        .get("cache_totals")
        .and_then(|value| serde_json::from_value(value.clone()).ok())
        .unwrap_or_default();
    (usage, totals)
}

/// 父会话留存的 `subrun` sidecar 重算按模型分桶（change add-harness-subagents design §9.2）：
/// 每条记录归 `model` 桶、累加其 `usage` 块并计一段。与 live 侧共用 [`SubrunUsage::accumulate`]
/// ——求和与记录顺序无关，并行 run 的完成顺序因此不影响结果。
///
/// `seed` = 源文件 `session_open.subrun_usage` 的解析产物（[`subrun_usage_seed`]）：链式恢复
/// （恢复出的会话再被恢复）与压缩边界把此前的桶带过来；全新会话无该键 ⇒ 空表。
///
/// 不可归桶的记录（缺 `model`）**跳过但不炸**：手工改坏的文件不该让恢复失败。父会话自己的
/// `ctx%` / cache% 不经这里——`subrun` 记录不进 [`usage_from_records`] 的往返配对。
pub fn subrun_usage_from_records(
    records: &[serde_json::Value],
    seed: BTreeMap<String, SubrunUsage>,
) -> BTreeMap<String, SubrunUsage> {
    let mut buckets = seed;
    for record in records {
        if record["kind"].as_str() != Some("subrun") {
            continue;
        }
        let Some(model) = record["model"].as_str().filter(|model| !model.is_empty()) else {
            continue;
        };
        let usage = match record.get("usage") {
            Some(value) => usage_from_json(value).unwrap_or_default(),
            // 失败段 / 段前中止：`usage` 缺省按零值计（段的「存在」仍要计进 segments）。
            None => Usage::default(),
        };
        let bucket = buckets.entry(model.to_string()).or_default();
        bucket.accumulate(&usage);
        bucket.segments += 1;
    }
    buckets
}

/// `session_open.subrun_usage` 的宽容解析（链式恢复 / 压缩边界的种子）：键 = 模型 id，
/// 值 = [`SubrunUsage`] 的序列化。缺键 / 形状不符 ⇒ 空表（重算只凭记录也能回到正确读数）。
pub fn subrun_usage_seed(open: &serde_json::Value) -> BTreeMap<String, SubrunUsage> {
    open.get("subrun_usage")
        .and_then(|value| serde_json::from_value(value.clone()).ok())
        .unwrap_or_default()
}

impl StateSnapshot {
    /// 空态快照（无会话 / 未打开 vault）：面板宽容解析下全空即合法。
    /// `vault` 仍是当前 scope 的键——「这个空态属于哪个 vault」是快照准入判据的一半
    ///（M312：切 vault 之后回来的旧快照要按标识丢弃）。
    ///
    /// `thinking_supported` 由调用侧从配置 schema 现算（`HarnessConfig::effort_supported`，
    /// M373：能力表 = `providers.<id>.models` 的逐模型声明）：
    /// 无会话时档位是默认 High，但「这个 provider 能不能调」与有没有会话无关，空态也要给出
    /// 正确的能力标记，否则面板一打开 chip 会先亮后灰（M362）。
    pub fn empty(vault: &str, warn_ctx_pct: f64, thinking_supported: bool) -> Self {
        Self {
            vault: vault.to_string(),
            messages: Vec::new(),
            usage: UsageSnapshot::default(),
            pending_approvals: Vec::new(),
            auto_wake: AutoWakeSnapshot::default(),
            subrun_usage: BTreeMap::new(),
            warn_ctx_pct,
            thinking: ThinkingState {
                level: ThinkingEffort::default(),
                supported: thinking_supported,
            },
            title: None,
        }
    }
}

/// 思考程度在快照里的读出面（面板思考 chip 的数据源，M362）。
///
/// 键集合与序列化同在 `harness_state` 的 `thinking` 字段里：`level` = 当前档位（会话内生效，
/// 新会话回到默认 High），`supported` = 当前 provider + model 是否支持程度调节
///（false ⇒ 前端置灰禁用 + hover 说明，Alex 2026-10-06 裁决点 2）。
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ThinkingState {
    pub level: ThinkingEffort,
    pub supported: bool,
}

/// `harness_state` 返回的快照（键集合是 m303 消费形状的超集）。
#[derive(Debug, Clone, Serialize)]
pub struct StateSnapshot {
    /// 会话标识 = vault 根路径（M312）：面板据此丢弃「切走之后才回来的」旧快照
    /// （与 `harness:event` 的信封字段同源：都是 `VaultScope::key()`）。
    pub vault: String,
    pub messages: Vec<PanelMessage>,
    pub usage: UsageSnapshot,
    /// 当前挂起的批准请求，按 ask 时间排序（change add-harness-subagents design §8.3：
    /// 并行时多个子运行可以同时等批准）。空表即「无待批」——单槽 `pending_approval`
    /// 字段已随本次迁移删除（快照字段一次迁净，不留旧键）。
    pub pending_approvals: Vec<PendingApprovalSnapshot>,
    /// 自动唤醒状态（design §12.6.3）：链计数 / 上限 / 触顶原因。面板据它渲染提示行。
    pub auto_wake: AutoWakeSnapshot,
    /// 子运行用量分桶（design §9.1）：键 = 模型 id。父会话读数不掺这些数字。
    pub subrun_usage: BTreeMap<String, SubrunUsage>,
    /// 上下文用量警示阈值（面板警示条用，缺省 85）。
    pub warn_ctx_pct: f64,
    /// 思考程度档位与 provider 能力（面板思考 chip 的数据源，M362）。
    pub thinking: ThinkingState,
    /// 会话有效标题（change add-session-auto-naming，design D11）：无标题时**缺键**（前端按
    /// 「可能缺席」读并回落首条用户消息口径）。取值来自 [`super::jsonl::effective_title`] 的
    /// 同一读取口径（活会话是内存态的有效标题，恢复 / 列举从留存读）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// 面板可见的批准请求摘要（不含通道 sender）。
#[derive(Debug, Clone, Serialize)]
pub struct PendingApprovalSnapshot {
    pub id: String,
    pub tool: String,
    /// 写工具的 unified diff 预览（无则缺省）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<String>,
    /// CLI 的完整 argv（无则缺省）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub argv: Option<Vec<String>>,
    /// 批准卡上展示的用途句（cli_run，design §3.4；无则缺省）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
    /// 判定依据（M459）：这次调用为什么进闸——面板批准卡「判定依据」行的数据源。与
    /// `harness:event` 的 `approval_request.reason` 同源同形（都取自 `ApprovalRequest.reason`）；
    /// 无则缺省（旧载荷 / 自动放行的层）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<DecisionReason>,
    /// 定时任务预览（change add-cron-conversational-registration design §6.3）：与
    /// `approval_request.cron_task` 同源同形（都取自 `ApprovalRequest.cron_task`）。无则缺省。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron_task: Option<serde_json::Value>,
    /// 该卡支持「采纳且本会话不再问（记住 `<粒度>`）」次级动作：`Some(粒度)` = 面板显示该
    /// 按钮，`None` = 不显示（危险黑名单层恒 `None`）。与 `approval_request.remember`
    /// 同源同形（都取自 `ApprovalRequest.remember`）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remember: Option<String>,
    /// 该卡支持「以后都允许 `<规则>`」次级动作：`Some(规则原文)` = 显示，`None` = 不显示。
    /// 与 `approval_request.persist_rule` 同源同形（都取自 `ApprovalRequest.persist_rule`）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persist_rule: Option<String>,
    /// 发起者（change add-harness-subagents design §8.3）：父会话自己的调用恒 `Interactive`，
    /// 子运行透传的请求带 agent / run_id / description。
    pub source: super::approval::ApprovalSource,
}

impl PendingApprovalSnapshot {
    pub fn from_request(r: &ApprovalRequest) -> Self {
        Self {
            id: r.id.clone(),
            tool: r.tool.clone(),
            diff: r.diff.clone(),
            argv: r.argv.clone(),
            purpose: r.purpose.clone(),
            reason: r.reason.clone(),
            cron_task: r.cron_task.clone(),
            remember: r.remember.clone(),
            persist_rule: r.persist_rule.clone(),
            source: r.source.clone(),
        }
    }
}

/// `harness_resume_session` 的返回（ts-rs 导出；前端恢复 UI mission 的消费形状）：
/// 从留存文件恢复出来的会话**续写的新会话**——新 session id 是新 JSONL 留存的文件名，
/// 前端据此知道「当前会话接在了哪份留存上」，面板重渲染走 `harness_state`。
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SessionResumeInfo {
    /// 续写的新会话 id（`sessions/<vault 稳定 id>/<id>.jsonl` 的文件名）。
    pub session_id: String,
    /// 灌回的 LLM 侧历史条数（`input` 项数）：源文件最后一条会话轮次 llm_request 的
    /// messages，加末尾未入请求的 llm_response 折叠项（design §6.2 第 4 步——reasoning
    /// 回放项 + assistant 消息 + 悬空的 function_call 项）；空会话恢复为 0。
    pub restored_items: usize,
    /// 面板重建用的渲染消息（M398，design §6.2「面板（transcript）从灌回的 input 重建」）：
    /// 把灌回的 input 项按序映射成面板视角的 user / assistant / tool 消息（reasoning 明文
    /// 挂在紧随其后的 assistant 消息上），新会话的 `panel` 与之一致（同一份重建结果的副本，
    /// 快照恢复与本次返回因此不会漂）。前端据此一次重放、不必再拉 `harness_state`。
    pub messages: Vec<PanelMessage>,
}

/// `harness_list_sessions` 的元素（ts-rs 导出；前端会话选择器的消费形状）：
/// 一份本 vault 留存会话的摘要。
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SessionSummary {
    /// 留存文件名去 `.jsonl`（`sessions/<vault 稳定 id>/<session_id>.jsonl`）；也是恢复命令的入参。
    pub session_id: String,
    /// 文件内第一条 `llm_request` 的首条 user 消息的**原始提问段**——自动注入的
    /// 「当前编辑器上下文」节已由后端剥除（`turn.rs` 的 `strip_context_section`；注入形态的
    /// 单一真源在那里）；未截断——会话名「约 20 字」的截断规则在前端。该会话还没有用户消息时为 None。
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_user_text: Option<String>,
    /// 首行 `session_open` 信封的 UNIX 秒（会话建立时刻）；缺 ts 的历史文件为 None。
    // ts-rs 默认把 u64 映成 bigint，而 JSON.parse 出来的是 number：与 `PanelMessage::ts`
    // 同处理。
    #[ts(optional)]
    #[ts(type = "number")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ts: Option<u64>,
    /// 会话有效标题（change add-session-auto-naming，design D11）：`jsonl::effective_title`
    /// 的读数；无 `session_title` 记录的旧文件为**缺键**（前端回落首条用户消息口径）。
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// 程序性中止的原因（change add-cron-runtime-daemon §3.5）：`code` 进诊断事件与回执
///（`approval_required`），`message` 是人话说明。
#[derive(Debug, Clone)]
pub struct StopReason {
    pub code: &'static str,
    pub message: String,
}

/// 一个 vault 的会话。
pub struct Session {
    root: PathBuf,
    /// 系统上下文（固定身份段 + AGENTS.md 三层 + Skill 索引 的装配全文），
    /// 会话建立时装配一次；自动压缩开新逻辑会话时重新装配并整体换入。
    system: String,
    /// LLM 侧消息项（Responses API `input` 形状）。**单一事实源**：面板消息由它派生、
    /// 留存里的 `llm_request.messages` 逐字节等于它每次发送时的快照。
    input: Vec<serde_json::Value>,
    /// 面板渲染消息。
    panel: Vec<PanelMessage>,
    usage: UsageSnapshot,
    /// 本逻辑会话的缓存计数累计（M443；随 [`Session::rotate`] 清零，见 [`CacheTotals`]）。
    cache_totals: CacheTotals,
    busy: bool,
    /// 挂起的批准请求列表（change add-harness-subagents design §8.3：父会话自己的调用与
    /// 子运行透传的请求共用一个列表，按 ask 时间排序——并行时可以有多个同时在等）。
    pending: Vec<ApprovalRequest>,
    /// 本轮被请求停止（M348）：`harness_abort` 置位、工具循环在检查点收口；
    /// `acquire_turn` 开新一轮时清零。中断语义是「不再继续」，不回滚已产出内容。
    abort_requested: bool,
    /// 程序性中止的原因（change add-cron-runtime-daemon §3.5）：无人值守运行遇到需批准的
    /// 调用时以 `approval_required` 中止，终态必须如实带错误码，不能伪装成用户主动停止。
    /// `None` = 普通中断（`aborted` 事件）。
    stop_reason: Option<StopReason>,
    /// 最近一次提问注入的「当前编辑器上下文」节（压缩续聊时原样重注入）。
    current_context: Option<String>,
    /// 思考程度档位（M362，Alex 2026-10-06 裁决：Low / High / Max，默认 High）。
    /// **会话内生效、不写回配置**：影响其后发出的消息，新会话（对象被丢弃重造）随之回到默认。
    thinking_effort: ThinkingEffort,
    /// 会话级 mock 游标（M456）：本会话已弹出的 fixture 条数。mock provider 的 client 每轮
    /// 重建，游标存在会话上才能「同一会话的第二轮接着上一轮弹」（见
    /// [`super::turn::run_turn`] 与 [`super::llm::wrap_cursor`]）。真 provider 不消费它。
    /// 新会话（对象被丢弃重造）随之回到 0。
    mock_cursor: usize,
    /// 会话有效标题（change add-session-auto-naming）：**内存态的唯一读数**——由命名调用写入、
    /// 轮换继承时由调用侧灌入；恢复 / 列举从留存经 [`super::jsonl::effective_title`] 读。
    title: Option<String>,
    /// 命名调度的内存态（首轮触发 / 周期 / 漂移 / 单飞行；design D1）。随逻辑会话轮换重置。
    title_schedule: TitleSchedule,
    /// mock 标题队列的会话级游标（本会话已弹过的 `titles` 条数，design D12）：与 `mock_cursor`
    /// 同路——client 每次调用重建，游标存在会话上才能「依次取 initial、keep」。
    title_cursor: usize,
    /// 会话实例令牌（change add-harness-subagents）：每次 `Session::new` 铸一个新值。
    /// 子运行用它判「父会话是否还是当初那一个」——重置 / 恢复 / 切 vault 会丢弃并重建
    /// 会话对象，令牌随之改变，仍在跑的后台 run 在下个检查点收敛为已中止。
    subagent_token: u64,
    /// 子运行中枢（延迟建立在第一次出现子代理场景时）：保留表、并发许可、自动唤醒调度
    /// 都挂在**父会话**的生命周期上——会话对象被丢弃即整块随 `Drop` 收口。
    subagent_hub: Option<Arc<SubagentHub>>,
    /// 子运行用量分桶（design §9.1）：键 = 模型 id，每段收尾累加一次。
    subrun_usage: BTreeMap<String, SubrunUsage>,
    jsonl: JsonlWriter,
}

/// 会话令牌的自增序号（进程内唯一；会话对象重建即换新令牌）。
fn next_subagent_token() -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::SeqCst)
}

/// 会话对象被丢弃（「新会话」重置 / 恢复替换 / 关闭 vault / 应用退出）时的收口：
/// 中止所有仍在跑的子运行、清空保留表与唤醒调度（design §12.4 / §9.3）。
impl Drop for Session {
    fn drop(&mut self) {
        if let Some(hub) = self.subagent_hub.take() {
            hub.shutdown();
        }
    }
}

impl Session {
    pub fn new(
        root: PathBuf,
        system: String,
        input: Vec<serde_json::Value>,
        thinking_effort: ThinkingEffort,
        jsonl: JsonlWriter,
    ) -> Self {
        // 回放形状归一（M464）：恢复旧会话时灌回的 input 里，reasoning 项可能仍是带 `rs_*`
        // id 的旧形状（记录早于本改动）；会话 input 是 wire 请求的**唯一事实源**，在此归一
        // 保证其后每条 llm_request 与 wire body 都不再带 id。新会话 input 为空、非 reasoning
        // 项原样通过，故幂等无副作用（[`normalize_reasoning_item`] 对非 reasoning 项是 no-op）。
        let input: Vec<serde_json::Value> = input
            .into_iter()
            .map(|item| normalize_reasoning_item(&item))
            .collect();
        Self {
            root,
            system,
            input,
            panel: Vec::new(),
            usage: UsageSnapshot::default(),
            cache_totals: CacheTotals::default(),
            busy: false,
            pending: Vec::new(),
            abort_requested: false,
            stop_reason: None,
            current_context: None,
            thinking_effort,
            mock_cursor: 0,
            title: None,
            title_schedule: TitleSchedule::default(),
            title_cursor: 0,
            subagent_token: next_subagent_token(),
            subagent_hub: None,
            subrun_usage: BTreeMap::new(),
            jsonl,
        }
    }

    /// 会话实例令牌（见字段注释）：子运行保存启动时的值，检查点比对。
    pub fn subagent_token(&self) -> u64 {
        self.subagent_token
    }

    /// 子运行中枢（已建立时）。
    pub fn subagent_hub(&self) -> Option<Arc<SubagentHub>> {
        self.subagent_hub.clone()
    }

    /// 取得或建立子运行中枢（`make` 只在首次调用时执行）。中枢随会话对象存亡，
    /// 因此不需要在重置 / 恢复 / 切 vault 各挂一支清理钩子。
    pub fn ensure_subagent_hub(
        &mut self,
        make: impl FnOnce() -> Arc<SubagentHub>,
    ) -> Arc<SubagentHub> {
        self.subagent_hub.get_or_insert_with(make).clone()
    }

    /// 记一段子运行用量到分桶表（design §9.1 的唯一累加口；每段收尾调一次）。
    pub fn record_subrun_usage(&mut self, model: &str, usage: &Usage) {
        self.subrun_usage
            .entry(model.to_string())
            .or_default()
            .accumulate(usage);
    }

    /// 段计数（`segments` 与往返样本分开计：一段可以有零个带 usage 的往返）。
    pub fn mark_subrun_segment(&mut self, model: &str) {
        self.subrun_usage
            .entry(model.to_string())
            .or_default()
            .segments += 1;
    }

    /// 子运行用量分桶表的只读视图。
    pub fn subrun_usage(&self) -> &BTreeMap<String, SubrunUsage> {
        &self.subrun_usage
    }

    /// 恢复路径的分桶落种（design §9.2）：以留存重算值整体换入，其后的段接着它继续累加。
    /// 与 [`Self::restore_usage`] 同一条纪律——快照 / 累计与留存可推导值一致。
    pub fn restore_subrun_usage(&mut self, buckets: BTreeMap<String, SubrunUsage>) {
        self.subrun_usage = buckets;
    }

    pub fn root(&self) -> &PathBuf {
        &self.root
    }

    pub fn system(&self) -> &str {
        &self.system
    }

    /// 当前思考程度档位（请求构造读它，见 [`super::turn`] 的 `build_request`）。
    pub fn thinking_effort(&self) -> ThinkingEffort {
        self.thinking_effort
    }

    /// 设置档位（`harness_set_thinking_effort` 的落点）。档位同时修正留存首行挂起的
    /// `session_open.thinking`（首条记录落盘前仍可改，落盘后历史不改写）。
    pub fn set_thinking_effort(&mut self, effort: ThinkingEffort) {
        self.thinking_effort = effort;
        let value = effort.as_str();
        self.jsonl
            .update_pending_open(|open| open["thinking"] = value.into());
    }

    /// 会话级 mock 游标（M456，见字段注释）。
    pub fn mock_cursor(&self) -> usize {
        self.mock_cursor
    }

    /// 设置会话级 mock 游标（[`super::turn::run_turn`] 一轮结束回写，按脚本长度 wrap）。
    pub fn set_mock_cursor(&mut self, cursor: usize) {
        self.mock_cursor = cursor;
    }

    /// 会话有效标题（内存态；`None` = 尚无标题，展示回落首条用户消息口径）。
    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    /// 写入有效标题（命名调用的落盘点；轮换继承由调用侧灌入同一值）。
    ///
    /// **单写入者不变量**（design D6 的「唯一读取口径」）：每次 `set_title(Some(x))` 都与一条携带
    /// `x` 的 `session_title` 记录**同批发生**（命名落盘 / 恢复 inherit / 压缩 inherit 三处），
    /// 因此内存态恒等于「文件内最后一条带 title 的记录」——快照出口读内存态与读
    /// [`super::jsonl::effective_title`] 同值，不构成第二份 last-wins 逻辑。
    pub fn set_title(&mut self, title: Option<String>) {
        self.title = title;
    }

    /// 命名调度状态机（轮完成点的触发判定与评估结束的释放）。
    pub fn title_schedule(&self) -> &TitleSchedule {
        &self.title_schedule
    }

    pub fn title_schedule_mut(&mut self) -> &mut TitleSchedule {
        &mut self.title_schedule
    }

    /// 本会话已弹过的 mock `titles` 条数（会话级标题游标，design D12）。
    pub fn title_cursor(&self) -> usize {
        self.title_cursor
    }

    pub fn set_title_cursor(&mut self, cursor: usize) {
        self.title_cursor = cursor;
    }

    pub fn is_busy(&self) -> bool {
        self.busy
    }

    pub fn set_busy(&mut self, busy: bool) {
        self.busy = busy;
    }

    pub fn input(&self) -> &[serde_json::Value] {
        &self.input
    }

    pub fn push_input(&mut self, item: serde_json::Value) {
        self.input.push(item);
    }

    pub fn replace_input(&mut self, items: Vec<serde_json::Value>) {
        self.input = items;
    }

    /// 面板消息入队（`ts` 由构造点用 [`super::jsonl::unix_secs_now`] 打戳——入会话时刻即构造时刻）。
    pub fn push_panel(&mut self, message: PanelMessage) {
        self.panel.push(message);
    }

    /// 记录一次带 usage 的 LLM 往返（M443，design §3.2/§3.3）：先把本次计数累加进会话累计器，
    /// 再由此算出全部读数、存下并**返回**快照——turn 侧拿这一个返回值同时喂事件与快照两条通道
    /// （MUST NOT 两套算法，REVIEW.md 「同一语义两处真源」条）。读数算法在 [`CacheTotals::snapshot`]。
    pub fn record_usage(&mut self, usage: &Usage, window: u64) -> UsageSnapshot {
        self.cache_totals.accumulate(usage);
        let snapshot = self.cache_totals.snapshot(usage, window);
        self.usage = snapshot;
        snapshot
    }

    /// 恢复路径的读数落种（M526）：快照与累计器同值、同源自 [`usage_from_records`] 的留存重算
    /// ——恢复后控制行/气泡显示源会话最近一次真实读数，其后的累计接着重算值继续（两条通道
    /// 此后看到的值与留存可推导值一致，REVIEW.md 「同一语义两处真源」条）。
    pub fn restore_usage(&mut self, usage: UsageSnapshot, totals: CacheTotals) {
        self.usage = usage;
        self.cache_totals = totals;
    }

    pub fn usage(&self) -> UsageSnapshot {
        self.usage
    }

    pub fn jsonl(&mut self) -> &mut JsonlWriter {
        &mut self.jsonl
    }

    /// 换系统上下文 + 换留存句柄（自动压缩开新逻辑会话的落点）：旧文件封闭不再追加，
    /// 新句柄带自己的 `session_open`（opened_from=compact）。输入历史由调用侧替换。
    ///
    /// 累计器随逻辑会话边界清零（M443）——压缩后的读数从零重新起算。**读数快照不清零**：
    /// 面板此刻显示的是压缩前那一轮的读数，与既有的 ctx% 行为一致（「压缩后 usage 仍是压缩前
    /// 读数，下轮请求才更新」），且两条通道（事件 / 快照）看到的是同一个值——在这里清快照会让
    /// 「实时面仍是旧值、重载后面变成 0」的错位出现（REVIEW.md 「同一语义两处真源」条同族）。
    ///
    /// 会话自动命名（design D8 的轮换条款）：调度计数与 mock 标题游标随逻辑会话重置（cadence
    /// 不从记录重建——记录不携带轮序号）；**有效标题不清**——继承标题由调用侧随新文件的
    /// `inherit` 记录一起灌入（`set_title`），新会话（对象重造）才从无标题起步。
    pub fn rotate(&mut self, system: String, jsonl: JsonlWriter) {
        self.system = system;
        self.jsonl = jsonl;
        self.cache_totals = CacheTotals::default();
        self.title_schedule.reset();
        self.title_cursor = 0;
    }

    pub fn set_current_context(&mut self, section: Option<String>) {
        self.current_context = section;
    }

    pub fn current_context(&self) -> Option<&str> {
        self.current_context.as_deref()
    }

    /// 面板快照。`thinking_supported` 由调用侧从配置 schema 现算
    ///（`HarnessConfig::effort_supported`，M373——会话不知道 provider，能力标记不在这里
    /// 判定）。
    pub fn snapshot(&self, warn_ctx_pct: f64, thinking_supported: bool) -> StateSnapshot {
        StateSnapshot {
            vault: self.root.display().to_string(),
            messages: self.panel.clone(),
            usage: self.usage,
            pending_approvals: self
                .pending
                .iter()
                .map(PendingApprovalSnapshot::from_request)
                .collect(),
            auto_wake: self
                .subagent_hub
                .as_ref()
                .map(|hub| hub.wake_snapshot())
                .unwrap_or_default(),
            subrun_usage: self.subrun_usage.clone(),
            warn_ctx_pct,
            thinking: ThinkingState {
                level: self.thinking_effort,
                supported: thinking_supported,
            },
            title: self.title.clone(),
        }
    }

    /// 挂起批准请求（工具循环线程 park 前调用）。列表按 ask 时间排序（push 即时间序）：
    /// 父会话自己的调用与多个子运行透传的请求可以同时在等，决策只回给发起者。
    pub fn park_approval(&mut self, request: ApprovalRequest) {
        self.pending.push(request);
    }

    /// 按 id 取挂起请求（只读）：`harness_approve` 持久化规则时从这里取 argv / 主体串现算
    /// 规则文本——**MUST NOT** 采信前端传入的文本（change harness-permission-rules-oct23
    /// Q5 裁决）。找不到返回 `None`（调用方随后按既有 `approval_not_found` 报错）。
    pub fn pending_request(&self, request_id: &str) -> Option<&ApprovalRequest> {
        self.pending.iter().find(|pending| pending.id == request_id)
    }

    /// `harness_approve` 的落点：按 id 找到挂起请求并把决定（含「采纳且本会话不再问」
    /// 标志与「以后都允许」标志，change harness-permission-rules-oct23 A1）发回工具循环线程。
    /// remember 随决定走通道，由 turn.rs 的 gated_execute 在 approved && remember 时写会话内
    /// 批准缓存——缓存写入只在那一处；持久规则由 `harness_approve` 在调用本函数**之前**写回
    /// （写失败则本函数不被调用，批准保持待决）。
    pub fn resolve_approval(
        &mut self,
        request_id: &str,
        approved: bool,
        reason: Option<String>,
        remember: bool,
        persist_rule: bool,
    ) -> Result<(), CommandError> {
        let index = self
            .pending
            .iter()
            .position(|pending| pending.id == request_id)
            .ok_or_else(|| {
                CommandError::new(
                    "approval_not_found",
                    format!("批准请求 {request_id} 不存在或已被处理"),
                )
            })?;
        let pending = self.pending.remove(index);
        let tx: Sender<ApprovalSignal> = pending.tx;
        // `remember` 现在是按钮的粒度标签（Option<String>）；留存口径仍记布尔语义
        // （「这次决定是否带会话记忆」），不把粒度文本写进 JSONL（那是 UI 面）。
        self.jsonl.record(&serde_json::json!({
            "kind": "approval",
            "id": pending.id,
            "tool": pending.tool,
            "decision": if approved { "approved" } else { "rejected" },
            "remember": remember,
            "persist_rule": persist_rule,
            "reason": reason,
        }));
        // 发送失败 = 等待线程已不在（会话被重置等），人话报错即可，不 panic。
        tx.send(ApprovalSignal::Decided(ApprovalDecision {
            approved,
            reason,
            remember,
            persist_rule,
        }))
        .map_err(|_| {
            CommandError::new(
                "approval_stale",
                "批准请求已失效（对话线程已结束），请重试本轮提问",
            )
        })
    }

    /// 本轮被请求停止（M348）：置位标志、收回待决批准项（通道发 Withdrawn）。
    /// 返回是否确实有在途的待决批准项被收回（测试与如实记录用）。中断的留存痕迹
    /// 由工具循环收口时的 `turn_aborted` sidecar 承担（`turn_abort_requested` /
    /// `approval_withdrawn` 是 wire 可推导的，已废弃——批准项的收回结果就是
    /// 「该调用未执行」，随历史进下一条 `llm_request.messages`）。
    pub fn request_abort(&mut self) -> bool {
        self.abort_requested = true;
        let withdrawn = std::mem::take(&mut self.pending);
        for request in &withdrawn {
            // 发失败 = 等待线程已不在，与 resolve_approval 同口径，不 panic。
            let _ = request.tx.send(ApprovalSignal::Withdrawn);
        }
        !withdrawn.is_empty()
    }

    /// 只收回某一个 run 的待批项（面板停止单个子运行，design §12.4）：其它 run 与父会话
    /// 自己的待批项不受影响。返回是否确实收回了。
    pub fn withdraw_approvals_of_run(&mut self, run_id: &str) -> bool {
        let mut kept = Vec::with_capacity(self.pending.len());
        let mut withdrawn = Vec::new();
        for request in std::mem::take(&mut self.pending) {
            let belongs = matches!(
                &request.source,
                super::approval::ApprovalSource::Subrun { run_id: owner, .. } if owner == run_id
            );
            if belongs {
                withdrawn.push(request);
            } else {
                kept.push(request);
            }
        }
        self.pending = kept;
        for request in &withdrawn {
            let _ = request.tx.send(ApprovalSignal::Withdrawn);
        }
        !withdrawn.is_empty()
    }

    pub fn abort_requested(&self) -> bool {
        self.abort_requested
    }

    /// 程序性中止（change add-cron-runtime-daemon §3.5）：置中断标志并记录原因。与用户主动
    /// 停止走同一条收口路径，区别只在终态事件：有原因时发 `error(code, message)`，不是
    /// `aborted`——回执因此能带 `approval_required` 而不是笼统的「被停止」。
    pub fn stop_with(&mut self, code: &'static str, message: &str) {
        self.abort_requested = true;
        self.stop_reason = Some(StopReason {
            code,
            message: message.to_string(),
        });
    }

    /// 取走程序性中止原因（收口时调用一次）。
    pub fn take_stop_reason(&mut self) -> Option<StopReason> {
        self.stop_reason.take()
    }

    /// 开新一轮时复位中断标志（`acquire_turn` 调用）：上一轮的停止请求不带进新轮。
    pub fn clear_abort(&mut self) {
        self.abort_requested = false;
        self.stop_reason = None;
    }

    /// 中断收口（M348）：把**本轮**最后一条 assistant 面板消息标注为「已停止」
    /// （status = "stopped"，面板 D383 徽标的数据源）。`base` 是一轮开始时面板消息的
    /// 条数（`run_turn_for` 在 user 消息入队后记录）——只在 base 之后的消息里找，
    /// 此前轮次的历史消息绝不误标。返回是否标到了消息——中断发生在任何文本产出之前时
    /// 没有 assistant 消息可标，如实返回 false。
    pub fn mark_last_assistant_stopped(&mut self, base: usize) -> bool {
        let Some(message) = self
            .panel
            .iter_mut()
            .enumerate()
            .rev()
            .find(|(index, m)| *index >= base && m.role == "assistant")
            .map(|(_, m)| m)
        else {
            return false;
        };
        message.status = Some("stopped".to_string());
        true
    }

    /// 面板消息条数（中断标注的 base 计数用）。
    pub fn panel_len(&self) -> usize {
        self.panel.len()
    }
}

// ---------------------------------------------------------------------------
// Responses API 消息项构造（input 数组的三种角色）
// ---------------------------------------------------------------------------

/// user 消息项：`{"role":"user","content":[{"type":"input_text","text":...}]}`。
pub fn user_item(text: &str) -> serde_json::Value {
    serde_json::json!({
        "role": "user",
        "content": [{"type": "input_text", "text": text}],
    })
}

/// assistant 消息项（文本 + 可选 reasoning 项，reasoning 按各厂规则归一回放形状）。
///
/// Responses API 的回放口径：assistant 输出以 message 项承载（content 用 `output_text`），
/// reasoning 项作为独立项**紧随其前**——kimi 的 `summary` 项、deepseek thinking 的
/// `content` reasoning_text parts 项同此位置（deepseek 带 tools 时不回传即 400，M306 真机
/// 实测；协议依据见 [`super::llm`] 模块文档）。reasoning 项经
/// [`super::llm::normalize_reasoning_item`] 归一（M464：**剥掉 `id`**、保
/// summary/content/encrypted_content）——恢复旧会话时记录里的 reasoning 可能仍是带 `rs_*`
/// id 的旧形状，这道归一是**回放构造**上的兜底（新会话在捕获侧已归一，此处幂等）。
///
/// **空正文不发消息项**（M372，真 API 实测）：`text` 为空时（工具轮只发调用、无正文）
/// 返回里只有 reasoning 项、没有 assistant 消息项——空 `output_text` 会原样进下一次
/// 请求的 input，Kimi Code 订阅端（`k3-256k` 等，兼容层）即以
/// `Invalid request: text content is empty` 400 拒掉整条请求。reasoning 项仍照上述形状回传
/// （M306 纪律一行不改）。
pub fn assistant_item(text: &str, reasoning: Option<&serde_json::Value>) -> Vec<serde_json::Value> {
    let mut items = Vec::new();
    if let Some(r) = reasoning {
        items.push(normalize_reasoning_item(r));
    }
    if !text.is_empty() {
        items.push(serde_json::json!({
            "role": "assistant",
            "content": [{"type": "output_text", "text": text}],
        }));
    }
    items
}

/// 工具调用与结果对：function_call 项（回放模型自己的调用）+ function_call_output 项。
///
/// 入 input 的**顺序**是 provider 合同：同一轮的调用项须成组在输出项之前（交错即 400，
/// M360 真 API 实测；成组压栈的唯一落点是 [`super::turn`] 的 `flush_call_items`）。
pub fn function_call_item(call_id: &str, name: &str, arguments: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "function_call",
        "call_id": call_id,
        "name": name,
        "arguments": arguments,
    })
}

pub fn function_call_output_item(call_id: &str, output: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "function_call_output",
        "call_id": call_id,
        "output": output,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::jsonl::JsonlWriter;
    use crate::harness::llm::Usage;

    /// M372：空正文的 assistant 消息项不进回放 input（Kimi Code 订阅端对空 `output_text`
    /// 整条 400：`Invalid request: text content is empty`）。reasoning 项不受文本空否影响，
    /// 按 M306 纪律回传（M464 起先归一回放形状——剥 id）。
    #[test]
    fn assistant_item_omits_empty_text_message() {
        // 空正文且无 reasoning：什么都不产出（工具轮的常态——调用项另走
        // function_call_item，不经本函数）。
        assert!(assistant_item("", None).is_empty());
        // 空正文但有 reasoning：只有 reasoning 项（归一后 id 被剥，其余字段照旧）。
        let reasoning = serde_json::json!({"type": "reasoning", "id": "rs_1"});
        let items = assistant_item("", Some(&reasoning));
        assert_eq!(items, vec![serde_json::json!({"type": "reasoning"})]);
        // 非空正文：reasoning 在前、消息项在后（M306 形状不变）。
        let items = assistant_item("答案", Some(&reasoning));
        assert_eq!(items.len(), 2);
        assert_eq!(items[0], serde_json::json!({"type": "reasoning"}));
        assert!(items[0].get("id").is_none(), "回放项不得带 id");
        assert_eq!(items[1]["role"], "assistant");
        assert_eq!(items[1]["content"][0]["type"], "output_text");
        assert_eq!(items[1]["content"][0]["text"], "答案");
        // 无 reasoning 的非空正文：单消息项。
        let items = assistant_item("只有正文", None);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["role"], "assistant");
    }

    /// M464：回放构造对 reasoning 项归一（剥 id、保 summary/encrypted_content）——覆盖
    /// 「任何路径产物中不出现 id」里的回放 input 半边。三形态：新会话带 blob / 旧会话无 blob
    /// 降级为「摘要无 id」/ 非 reasoning 项原样。
    #[test]
    fn assistant_item_normalizes_reasoning_replay_shape() {
        let with_blob = serde_json::json!({
            "type": "reasoning", "id": "rs_new", "status": "completed",
            "summary": [{"type": "summary_text", "text": "新摘要"}],
            "encrypted_content": "blob-9"
        });
        let items = assistant_item("答", Some(&with_blob));
        assert!(items[0].get("id").is_none(), "id 必须剥掉：{}", items[0]);
        assert_eq!(items[0]["encrypted_content"], "blob-9");
        assert_eq!(
            items[0]["summary"],
            serde_json::json!([{"type": "summary_text", "text": "新摘要"}])
        );

        // 旧会话（无 blob）：降级为「摘要无 id」——仍是合法回放项，比带 id 更合官方口径。
        let old = serde_json::json!({
            "type": "reasoning", "id": "rs_old",
            "summary": [{"type": "summary_text", "text": "旧摘要"}]
        });
        let items = assistant_item("", Some(&old));
        assert_eq!(
            items,
            vec![serde_json::json!({
                "type": "reasoning",
                "summary": [{"type": "summary_text", "text": "旧摘要"}]
            })]
        );
    }

    /// M464：恢复旧会话时灌回的 input 在 [`Session::new`] 处归一回放形状——记录早于本改动、
    /// reasoning 项仍带 `rs_*` id，会话 input 是 wire 请求的唯一事实源，归一后其后每条请求都
    /// 不带 id。非 reasoning 项（user / assistant 消息）逐字节不变。
    #[test]
    fn session_input_normalizes_legacy_reasoning_items() {
        let restored = vec![
            serde_json::json!({"role": "user", "content": [{"type": "input_text", "text": "问"}]}),
            serde_json::json!({"type": "reasoning", "id": "rs_legacy",
                "summary": [{"type": "summary_text", "text": "旧思考"}]}),
            serde_json::json!({"role": "assistant", "content": [{"type": "output_text", "text": "答"}]}),
        ];
        let session = Session::new(
            std::path::PathBuf::from("/tmp/lumir-m464-session-test"),
            "sys".into(),
            restored,
            ThinkingEffort::default(),
            JsonlWriter::at_path(
                std::path::PathBuf::from("/tmp/lumir-m464-session-test/x.jsonl"),
                &serde_json::json!({}),
            ),
        );
        let input = session.input();
        assert_eq!(input.len(), 3);
        assert!(
            input[1].get("id").is_none(),
            "恢复的 reasoning 项不得带 id：{}",
            input[1]
        );
        assert_eq!(input[1]["type"], "reasoning");
        assert_eq!(input[1]["summary"][0]["text"], "旧思考");
        // 非 reasoning 项逐字节不变。
        assert_eq!(input[0]["role"], "user");
        assert_eq!(input[2]["role"], "assistant");
    }

    // ---- M443：缓存读数（会话累计 / 单回合 / 成因标注 / 序列化键集合） ----

    /// 测试用会话：留存句柄指向一个不会写盘的临时路径（`JsonlWriter::at_path` 惰性建文件，
    /// 本组用例只碰读数内存态，零磁盘副作用、零环境变量扰动——REVIEW.md 「测试污染真实环境」条）。
    fn test_session() -> Session {
        Session::new(
            std::path::PathBuf::from("/tmp/lumir-m443-session-test"),
            "sys".into(),
            Vec::new(),
            ThinkingEffort::default(),
            JsonlWriter::at_path(
                std::path::PathBuf::from("/tmp/lumir-m443-session-test/x.jsonl"),
                &serde_json::json!({}),
            ),
        )
    }

    fn usage(input: u64, cached: u64, writes: u64) -> Usage {
        Usage {
            input_tokens: input,
            cached_tokens: cached,
            output_tokens: 0,
            cache_write_tokens: writes,
        }
    }

    const WINDOW: u64 = 131_072;

    #[test]
    fn record_usage_splits_session_and_turn_readings() {
        let mut session = test_session();
        // 首轮：cached == 0 ⇒ 会话累计与单回合都是 0%（M438 的「50%」读数就是这么来的）。
        let first = session.record_usage(&usage(65536, 0, 1000), WINDOW);
        assert!((first.ctx_pct - 50.0).abs() < 1e-9);
        assert!((first.cache_pct_session - 0.0).abs() < 1e-9);
        assert!((first.cache_pct_turn - 0.0).abs() < 1e-9);
        assert_eq!(first.cache_write_tokens, 1000);
        assert_eq!(first.cache_write_tokens_session, 1000);
        assert_eq!(first.cache_note, Some(CacheNote::ColdStart));

        // 次轮高命中：会话累计 = Σcached ÷ Σinput = (0 + 9272) ÷ (65536 + 10146)。
        let second = session.record_usage(&usage(10146, 9272, 874), WINDOW);
        assert!((second.cache_pct_turn - 9272.0 * 100.0 / 10146.0).abs() < 1e-9);
        assert!((second.cache_pct_session - 9272.0 * 100.0 / 75682.0).abs() < 1e-9);
        // 单回合值与累计值确实不同（否则这条判据没有区分度）。
        assert!((second.cache_pct_turn - second.cache_pct_session).abs() > 1.0);
        assert_eq!(second.cache_write_tokens, 874);
        assert_eq!(second.cache_write_tokens_session, 1874);
        assert_eq!(second.cache_note, None);
        // 会话快照与返回值同源（事件与快照两条通道吃同一个值）。
        assert_eq!(session.usage().cache_pct_session, second.cache_pct_session);
    }

    #[test]
    fn record_usage_accumulates_across_three_turns() {
        let mut session = test_session();
        session.record_usage(&usage(1000, 200, 0), WINDOW);
        session.record_usage(&usage(2000, 1800, 0), WINDOW);
        let third = session.record_usage(&usage(4000, 3900, 0), WINDOW);
        // Σcached ÷ Σinput = (200 + 1800 + 3900) ÷ (1000 + 2000 + 4000)。
        assert!((third.cache_pct_session - 5900.0 * 100.0 / 7000.0).abs() < 1e-9);
    }

    #[test]
    fn new_logic_session_restarts_accumulation() {
        let mut session = test_session();
        session.record_usage(&usage(1000, 200, 0), WINDOW);
        session.record_usage(&usage(1000, 200, 0), WINDOW);
        assert!((session.usage().cache_pct_session - 20.0).abs() < 1e-9);
        // 自动压缩开新逻辑会话（就地轮换）：累计器清零、下一条读数只算新会话这一轮。
        session.rotate(
            "sys2".into(),
            JsonlWriter::at_path(
                std::path::PathBuf::from("/tmp/lumir-m443-session-test/y.jsonl"),
                &serde_json::json!({}),
            ),
        );
        let after = session.record_usage(&usage(1000, 500, 0), WINDOW);
        assert!((after.cache_pct_session - 50.0).abs() < 1e-9);
        assert_eq!(after.cache_write_tokens_session, 0);
    }

    #[test]
    fn cache_note_truth_table() {
        // 1. 冷启动：cached == 0 且 input > 0（会话首个请求的典型；TTL 过期落同一句）。
        assert_eq!(cache_note(&usage(1000, 0, 0)), Some(CacheNote::ColdStart));
        // 2. 大块摊薄：M438 实测现场 input 12786 / cached 6400 ⇒ 新增 6386 > 3200。
        assert_eq!(
            cache_note(&usage(12786, 6400, 0)),
            Some(CacheNote::BlockDilution)
        );
        // 3. 稳态（新增仅最后的不完整块）：新增 = 已缓存的一半整 —— 不大于，不标注。
        assert_eq!(cache_note(&usage(1500, 1000, 0)), None);
        // 4. 边界：恰好超过一半即标注。
        assert_eq!(
            cache_note(&usage(1501, 1000, 0)),
            Some(CacheNote::BlockDilution)
        );
        // 5. 命中率高的常态：无标注。
        assert_eq!(cache_note(&usage(10000, 9500, 0)), None);
        // 6. input == 0：谈不上命中率，不标注（也不落 ColdStart）。
        assert_eq!(cache_note(&usage(0, 0, 0)), None);
        // 7. cached == input（全命中）：无标注。
        assert_eq!(cache_note(&usage(1000, 1000, 0)), None);
        // 8. 异常读数（provider 报 cached > input）不下溢、不标注。
        assert_eq!(cache_note(&usage(100, 200, 0)), None);
    }

    #[test]
    fn usage_snapshot_serializes_new_key_set_only() {
        let snapshot = UsageSnapshot {
            ctx_pct: 67.2,
            cache_pct_session: 88.5,
            cache_pct_turn: 50.1,
            cache_write_tokens: 6174,
            cache_write_tokens_session: 12044,
            cache_note: Some(CacheNote::BlockDilution),
            input_tokens: 12786,
            cached_tokens: 6400,
            cached_tokens_session: 10300,
            context_window: 131_072,
            has_usage: true,
        };
        let value = serde_json::to_value(snapshot).unwrap();
        let mut keys: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "cache_note",
                "cache_pct_session",
                "cache_pct_turn",
                "cache_write_tokens",
                "cache_write_tokens_session",
                "cached_tokens",
                "cached_tokens_session",
                "context_window",
                "ctx_pct",
                "has_usage",
                "input_tokens",
            ]
        );
        // 旧键退役：`cache_pct` 不再出现（复用旧键会留下「以为还是单回合」的静默陷阱）。
        assert!(value.get("cache_pct").is_none());
        // 成因标注按 snake_case 序列化（前端按值取文案）。
        assert_eq!(value["cache_note"], "block_dilution");
        assert_eq!(
            serde_json::to_value(CacheNote::ColdStart).unwrap(),
            "cold_start"
        );
        // 无标注时是 null（不是缺键）。
        let clean = serde_json::to_value(UsageSnapshot {
            cache_note: None,
            ..Default::default()
        })
        .unwrap();
        assert!(clean["cache_note"].is_null());
    }

    // ---- M526：恢复路径的读数重算（留存 → 种子 + 记录扫描 → 新会话） ----

    fn request_record(system: &str) -> serde_json::Value {
        serde_json::json!({
            "kind": "llm_request",
            "request": { "system": system, "messages": [] },
        })
    }

    fn response_record(input: u64, cached: u64, writes: u64) -> serde_json::Value {
        serde_json::json!({
            "kind": "llm_response",
            "text": "答",
            "usage": {
                "input_tokens": input,
                "cached_tokens": cached,
                "output_tokens": 1,
                "cache_write_tokens": writes,
            },
        })
    }

    #[test]
    fn usage_from_records_recomputes_session_cumulative() {
        // 两轮会话 + 一次压缩（内部调用，system 不同）+ 压缩后又一轮：压缩 usage 不计入。
        let compact_system = "压缩指令";
        let records = vec![
            request_record("sys"),
            response_record(1000, 200, 0),
            request_record("sys"),
            response_record(2000, 1800, 50),
            request_record(compact_system),
            response_record(99_999, 99_999, 99_999), // 压缩调用：MUST NOT 计入
            request_record("sys"),
            response_record(4000, 3900, 0),
        ];
        let (snapshot, totals) = usage_from_records(&records, "sys", WINDOW, Default::default());
        // Σcached ÷ Σinput = (200 + 1800 + 3900) ÷ (1000 + 2000 + 4000)（压缩轮排除）。
        assert!((snapshot.cache_pct_session - 5900.0 * 100.0 / 7000.0).abs() < 1e-9);
        assert!((snapshot.cache_pct_turn - 3900.0 * 100.0 / 4000.0).abs() < 1e-9);
        assert_eq!(snapshot.input_tokens, 4000);
        assert_eq!(snapshot.cached_tokens, 3900);
        assert_eq!(snapshot.cached_tokens_session, 5900);
        assert_eq!(snapshot.cache_write_tokens_session, 50);
        assert_eq!(snapshot.context_window, WINDOW);
        assert!(snapshot.has_usage);
        assert_eq!(totals.samples, 3);
        // 与 live 侧同一算法对拍：同输入灌进会话，读数逐字段相等。
        let mut session = test_session();
        for u in [
            usage(1000, 200, 0),
            usage(2000, 1800, 50),
            usage(4000, 3900, 0),
        ] {
            session.record_usage(&u, WINDOW);
        }
        assert_eq!(session.usage(), snapshot);
    }

    #[test]
    fn usage_from_records_ignores_responses_without_usage() {
        // 错误 / 空响应的 llm_response 不带 usage 块：不是一次可计的往返，跳过且消耗配对位。
        let records = vec![
            request_record("sys"),
            serde_json::json!({"kind": "llm_response", "text": "", "error": "harness_empty_response"}),
            request_record("sys"),
            response_record(1000, 500, 0),
        ];
        let (snapshot, totals) = usage_from_records(&records, "sys", WINDOW, Default::default());
        assert!(snapshot.has_usage);
        assert_eq!(totals.samples, 1);
        assert!((snapshot.cache_pct_session - 50.0).abs() < 1e-9);
    }

    #[test]
    fn usage_seed_parses_and_defaults() {
        // 落账 → 解析 round-trip：链式恢复的种子原样回来。
        let (snapshot, totals) = {
            let mut session = test_session();
            session.record_usage(&usage(1000, 200, 7), WINDOW);
            let snapshot = session.usage();
            let totals = CacheTotals {
                input: 1000,
                cached: 200,
                writes: 7,
                samples: 1,
            };
            (snapshot, totals)
        };
        let open = serde_json::json!({
            "kind": "session_open",
            "usage": serde_json::to_value(snapshot).unwrap(),
            "cache_totals": serde_json::to_value(totals).unwrap(),
        });
        let (usage, totals) = usage_seed(&open);
        assert_eq!(usage, snapshot);
        assert_eq!(totals.samples, 1);
        // 旧文件无种子键 ⇒ 零值缺省（has_usage false：从未发过请求的会话不假读数）。
        let (usage, totals) = usage_seed(&serde_json::json!({"kind": "session_open"}));
        assert!(!usage.has_usage);
        assert_eq!(totals.samples, 0);
        // 形状不符（手工改坏的文件）同样回落缺省，不炸。
        let (usage, _) = usage_seed(&serde_json::json!({"usage": "坏", "cache_totals": 42}));
        assert!(!usage.has_usage);
    }

    #[test]
    fn restore_usage_seeds_snapshot_and_totals() {
        // 恢复落种：快照即源会话最近一次真实读数；其后的累计从种子接着算（会话累计口径跨恢复不断档）。
        let records = vec![request_record("sys"), response_record(1000, 200, 0)];
        let (snapshot, totals) = usage_from_records(&records, "sys", WINDOW, Default::default());
        let mut session = test_session();
        session.restore_usage(snapshot, totals);
        assert_eq!(session.usage(), snapshot);
        assert!(session.usage().has_usage);
        let next = session.record_usage(&usage(3000, 2700, 0), WINDOW);
        // Σ = (200 + 2700) ÷ (1000 + 3000) —— 不是只从恢复后的新回合起算。
        assert!((next.cache_pct_session - 2900.0 * 100.0 / 4000.0).abs() < 1e-9);
    }

    // ---- 子运行用量分桶（change add-harness-subagents §5.1–5.3） ----

    fn subrun_record(
        model: &str,
        input: u64,
        cached: u64,
        writes: u64,
        output: u64,
        status: &str,
    ) -> serde_json::Value {
        serde_json::json!({
            "kind": "subrun",
            "run_id": "r-1",
            "segment": 1,
            "agent": "research",
            "description": "调研",
            "model": model,
            "status": status,
            "stopped_by": null,
            "rounds": 1,
            "denied_calls": 0,
            "usage": {
                "input_tokens": input,
                "cached_tokens": cached,
                "output_tokens": output,
                "cache_write_tokens": writes,
            },
        })
    }

    /// live 分桶表 == 恢复重算分桶表（tasks §5.3 的判据）：两个模型、partial、resume 的第二段、
    /// 零用量的失败段、并行乱序完成——逐字段相等。求和与记录顺序无关因此完成顺序不影响读数。
    #[test]
    fn subrun_usage_from_records_matches_live_buckets() {
        let records = vec![
            // model-b 先完成（并行乱序），model-a 的两段是 resume 的前后两段。
            subrun_record("model-b", 300, 100, 10, 20, "completed"),
            subrun_record("model-a", 1000, 200, 0, 50, "partial"),
            subrun_record("model-a", 400, 350, 5, 30, "completed"),
            subrun_record("model-b", 0, 0, 0, 0, "failed"),
        ];
        let recomputed = subrun_usage_from_records(&records, Default::default());

        let mut live = test_session();
        live.record_subrun_usage(
            "model-a",
            &Usage {
                input_tokens: 1000,
                cached_tokens: 200,
                output_tokens: 50,
                cache_write_tokens: 0,
            },
        );
        live.mark_subrun_segment("model-a");
        live.record_subrun_usage(
            "model-a",
            &Usage {
                input_tokens: 400,
                cached_tokens: 350,
                output_tokens: 30,
                cache_write_tokens: 5,
            },
        );
        live.mark_subrun_segment("model-a");
        live.record_subrun_usage(
            "model-b",
            &Usage {
                input_tokens: 300,
                cached_tokens: 100,
                output_tokens: 20,
                cache_write_tokens: 10,
            },
        );
        live.mark_subrun_segment("model-b");
        live.record_subrun_usage("model-b", &Usage::default());
        live.mark_subrun_segment("model-b");

        assert_eq!(live.subrun_usage(), &recomputed);
        let a = &recomputed["model-a"];
        assert_eq!(a.input, 1400);
        assert_eq!(a.cached, 550);
        assert_eq!(a.writes, 5);
        assert_eq!(a.output, 80);
        assert_eq!(a.samples, 2);
        assert_eq!(a.segments, 2);
        // 零用量段仍计 segments（「这一段发生过」是事实），samples 同进一。
        let b = &recomputed["model-b"];
        assert_eq!(b.input, 300);
        assert_eq!(b.samples, 2);
        assert_eq!(b.segments, 2);

        // 乱序：换一个完成顺序重算，结果逐字段相等。
        let mut reordered: Vec<serde_json::Value> = records.clone();
        reordered.reverse();
        assert_eq!(
            subrun_usage_from_records(&reordered, Default::default()),
            recomputed
        );
    }

    /// `subrun` 记录不影响父会话自己的读数（ctx% / cache% 只由父的往返算）。
    #[test]
    fn subrun_records_do_not_change_parent_readings() {
        let mut records = vec![request_record("sys"), response_record(1000, 200, 0)];
        records.push(subrun_record(
            "model-a",
            999_999,
            999_999,
            7,
            999,
            "completed",
        ));
        records.push(request_record("sys"));
        records.push(response_record(2000, 1800, 5));
        let with_subruns = usage_from_records(&records, "sys", WINDOW, Default::default());
        // 与不含 subrun 记录的同一序列重算一致。
        let without_subruns: Vec<serde_json::Value> = records
            .iter()
            .filter(|record| record["kind"] != "subrun")
            .cloned()
            .collect();
        let expected = usage_from_records(&without_subruns, "sys", WINDOW, Default::default());
        assert_eq!(with_subruns, expected);
        // subrun 记录不会吃掉紧随请求的配对位：父会话的最近一次读数仍是自己的往返。
        assert_eq!(with_subruns.0.input_tokens, 2000);
        assert_eq!(with_subruns.1.samples, 2);
    }

    /// 链式恢复的种子：`session_open.subrun_usage` 落账 → 解析 round-trip；重算 = 种子 +
    /// 新记录（压缩 / 恢复开的新文件没有旧 `subrun` sidecar，桶不能从零起算）。
    #[test]
    fn subrun_usage_seed_round_trips_and_chains() {
        let mut session = test_session();
        session.record_subrun_usage("model-a", &usage(1000, 200, 0));
        session.mark_subrun_segment("model-a");
        let open = serde_json::json!({
            "kind": "session_open",
            "subrun_usage": serde_json::to_value(session.subrun_usage()).unwrap(),
        });
        let seed = subrun_usage_seed(&open);
        assert_eq!(&seed, session.subrun_usage());

        // 新文件里只有压缩 / 恢复之后的新段：重算 = 种子 + 记录。
        let records = vec![subrun_record("model-a", 500, 400, 3, 10, "completed")];
        let recomputed = subrun_usage_from_records(&records, seed.clone());
        assert_eq!(recomputed["model-a"].input, 1500);
        assert_eq!(recomputed["model-a"].writes, 3);
        assert_eq!(recomputed["model-a"].segments, 2);

        // 旧文件无种子键 / 形状不符 ⇒ 空表（不炸）。
        assert!(subrun_usage_seed(&serde_json::json!({"kind": "session_open"})).is_empty());
        assert!(subrun_usage_seed(&serde_json::json!({"subrun_usage": "坏"})).is_empty());
        // 手工改坏的单条记录（缺 model / usage 形状不符）跳过但不炸。
        let broken = vec![
            serde_json::json!({"kind": "subrun", "usage": {"input_tokens": 1}}),
            serde_json::json!({"kind": "subrun", "model": "model-a", "usage": "坏"}),
        ];
        let recovered = subrun_usage_from_records(&broken, Default::default());
        assert_eq!(recovered["model-a"].segments, 1);
        assert_eq!(recovered["model-a"].input, 0);
    }

    /// 恢复落种：分桶表整体换入后，后续段接着累加（与 live 同一条路径）。
    #[test]
    fn restore_subrun_usage_seeds_buckets() {
        let mut session = test_session();
        let mut seed = std::collections::BTreeMap::new();
        seed.insert(
            "model-a".to_string(),
            SubrunUsage {
                input: 1000,
                cached: 200,
                writes: 0,
                output: 50,
                samples: 1,
                segments: 1,
            },
        );
        session.restore_subrun_usage(seed);
        session.record_subrun_usage("model-a", &usage(500, 400, 3));
        session.mark_subrun_segment("model-a");
        let bucket = &session.subrun_usage()["model-a"];
        assert_eq!(bucket.input, 1500);
        assert_eq!(bucket.cached, 600);
        assert_eq!(bucket.writes, 3);
        assert_eq!(bucket.samples, 2);
        assert_eq!(bucket.segments, 2);
    }
}
