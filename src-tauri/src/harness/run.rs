//! 运行公共层（change add-harness-subagents design §2）：一次运行 = 触发来源 + 会话目标 +
//! 工具策略 + 预算 + 批准策略，由同一个工具循环（[`super::turn`]）执行。
//!
//! **去留口径（tasks §0.3）**：本层按**实际消费者**决定去留——当前消费者是交互回合
//! （[`SessionContext`]）与委托运行（[`subagents::ChildContext`]）；cron 按自己的 change 接入。
//! 不因单一原语（某条事件、
//! 某个字段）的变化删改本层，也**不保留兼容层**：没有消费者、也没有已发布契约的字段直接删，
//! 不写迁移 / 双写 / 过渡路径。cron 与子运行共用本层时，差异只落在契约值上（会话目标、批准
//! 策略、预算），MUST NOT 各自复制一份循环。
//!
//! **纯 Rust**：本模块不依赖 tauri（ADR 0002 §7）。事件经 [`EventSink`] 注入，类型可在单测
//! 与将来的 headless 后端中原样构造；`RunSpec` 是 cron / 委托交接载荷的形状（design §2.4），
//! 因此除 `deadline`（`Instant` 不可序列化，跨进程交接恒为 None）外可序列化。
//!
//! **设计取舍**：`ToolPolicy::allow` 用 `Vec<String>` 而非 `&'static str`——交接载荷要能反
//! 序列化，借用形态做不到；工具集本身仍是闭集合（`tools::TOOL_NAMES`），字符串只是它的线格式。

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::mpsc;
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::commands::CommandError;
use crate::config::HarnessConfig;
use crate::fs_io::IgnorePolicy;

use super::agents;
use super::approval::{ApprovalDecision, ApprovalRequest, ApprovalSignal};
use super::events::{self, EventSink};
use super::jsonl;
use super::llm::{self, Usage};
use super::permission_cache;
use super::permissions;
use super::session::{self, PanelMessage};
use super::title::TitleJob;
use super::tools;
use super::{Runtime, VaultScope};

use super::{scheduler, subagents};

/// 触发来源。仅用于诊断、事件归属与预留策略，**不用于分支循环行为**——三类来源跑同一套循环。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RunOrigin {
    /// 用户输入（交互回合）。
    User,
    /// cron 到点 / 拉取 / 点击发起的无人值守运行。
    Cron { task: String, run_id: String },
    /// 父会话的 `task` 调用委派出来的子运行。
    Delegation {
        parent_session: String,
        call_id: String,
    },
}

/// 会话目标：一次运行把消息写进哪份会话状态，决定事件去向与留存落点。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionTarget {
    /// 用户当前会话（交互槽位）。
    Interactive,
    /// 无人值守运行槽位（cron）：与交互槽位物理分离，事件不进用户 transcript。
    Unattended { key: String },
    /// 子运行：内存态会话，不注册进 `Runtime`。
    Child { run_id: String },
}

/// 工具白名单：运行契约的一部分（change add-harness-subagents design §2.1）。
/// `SessionContext` 构造时按它过滤工具定义——cron 交接声明 8 件 vault 工具，因此无人值守
/// 运行看不见 `task`；交互路径没有交接契约（`None`），暴露完整注册表。子运行另按定义
/// `tools` 字段过滤（`subagents::ChildContext`）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolPolicy {
    /// 允许的工具名闭集合（元素必须是 `tools::TOOL_NAMES` 的成员）。
    pub allow: Vec<String>,
}

/// 三重失控闸（design §7）。子运行的预算来自定义字段，**已按配置上限夹取**；交互路径只有
/// 轮次上限（`loop_max`），`max_tokens` / `deadline` 不参与判定。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunBudget {
    /// 最多 LLM 往返轮次。
    pub max_rounds: u32,
    /// token 预算（单段累计）；0 表示无 token 闸（交互路径）。
    pub max_tokens: u64,
    /// 绝对截止时刻。`Instant` 只在进程内成立，跨进程交接恒为 `None`（cron 只带轮次上限）。
    #[serde(skip)]
    pub deadline: Option<Instant>,
}

/// 批准策略：交互会话与子运行的 ask 透传给同一个人（同一次会话）；cron 的无人值守槽位拒绝。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ApprovalPolicy {
    /// 交互会话：走既有批准闸，卡片进当前会话。
    Interactive,
    /// 子运行：批准卡透传到父会话（`run_id` 用于卡片归属）。
    PassthroughFrom { run_id: String },
    /// 无人值守：遇到需批准的调用即中止本次运行（`approval_required`），不挂起等待。
    RejectUnavailable,
}

/// 预算 / 闸的停止原因（`RunOutcome::Partial.stopped_by` 的闭集合）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    /// 轮次上限。
    Rounds,
    /// token 预算。
    Tokens,
    /// 时间闸。
    Time,
    /// provider 配额 / 限流（不重试、不自动降档）。
    Quota,
    /// API 错误但已有文本（partial）。
    Error,
}

impl StopReason {
    /// 线格式（诊断事件与结果信封共用）。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Rounds => "rounds",
            Self::Tokens => "tokens",
            Self::Time => "time",
            Self::Quota => "quota",
            Self::Error => "error",
        }
    }
}

/// 一次运行的终态。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunOutcome {
    Completed,
    /// 触顶 / 配额 / API 中断但已有产出：如实标停止原因，可 resume。
    Partial {
        stopped_by: StopReason,
    },
    Failed {
        code: String,
        message: String,
    },
    Aborted,
}

/// 一段运行自己的用量（不描述父会话；按模型分桶由收尾方决定）。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct UsageDelta {
    pub input_tokens: u64,
    pub cached_tokens: u64,
    pub output_tokens: u64,
    pub cache_write_tokens: u64,
}

impl From<Usage> for UsageDelta {
    fn from(usage: Usage) -> Self {
        Self {
            input_tokens: usage.input_tokens,
            cached_tokens: usage.cached_tokens,
            output_tokens: usage.output_tokens,
            cache_write_tokens: usage.cache_write_tokens,
        }
    }
}

/// 一次运行的报告（子运行引擎与 cron 回执的共用形状）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunReport {
    pub outcome: RunOutcome,
    /// 本段实际使用的模型 id（调用级覆盖生效后的值）。
    pub model: String,
    pub usage: UsageDelta,
    pub rounds: u32,
    /// 被权限 / 批准拒绝的调用数。
    pub denials: u32,
    /// 已产出的助手文本（partial / completed 时可能为空串）。
    pub summary: Option<String>,
    /// 工具调用计数（工具名 → 次数）。
    pub tool_calls: BTreeMap<String, u32>,
}

/// 一次运行的输入契约（design §2.1）。**不含任务知识**：不认路径、不认 vault 约定、不认场景名。
/// `background` 只决定**收尾投递方式**（立即返回 `running` + 完成时通知 vs. 本回合等待结果），
/// 不改变循环本体。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunSpec {
    pub origin: RunOrigin,
    pub session_target: SessionTarget,
    pub tool_policy: ToolPolicy,
    pub budget: RunBudget,
    pub approval_policy: ApprovalPolicy,
    pub background: bool,
}

/// 预算判定（循环每轮开头问一次）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BudgetVerdict {
    /// 继续本轮。
    Continue,
    /// 触顶：按原因收尾（轮次 → `loop_max` 提示；token / 时间 → partial）。
    Exhausted(StopReason),
}

/// 批准闸的结果（[`RunContext::approval`] 的返回面）。
#[derive(Debug)]
pub enum ApprovalOutcome {
    Decided(ApprovalDecision),
    /// 用户停止了本轮：待决项随中断收回，调用未执行。
    Withdrawn,
    /// 批准通道已关闭（会话被重置 / vault 已切换）。
    Stale,
    /// 无人值守槽位不等待批准（`RejectUnavailable`）：原因码 / 文案由上下文给出。
    Unavailable {
        code: String,
        message: String,
    },
    /// 挂起失败（找不到会话等）。
    Failed(CommandError),
}

/// 并行编排调用（`task`）的句柄：**启动即返回**，[`Self::join`] 阻塞到本调用收敛。
///
/// 结果项的形状 = 既有工具调用的 `(调用项, 输出项)` 对，调用侧按调用序号回填（design §12.2）。
pub trait OrchestrationCall: Send {
    fn join(self: Box<Self>) -> (serde_json::Value, serde_json::Value);

    /// 编排结果的值（工具输出信封）：调用侧用它走统一的工具收尾（面板行 / 事件 / 结果项）。
    /// 缺省从 [`Self::join`] 的 `function_call_output.output` 字符串还原——测试替身不需要
    /// 单独实现。
    fn result_value(self: Box<Self>) -> serde_json::Value {
        let (_, output_item) = self.join();
        output_item
            .get("output")
            .and_then(|value| value.as_str())
            .and_then(|text| serde_json::from_str(text).ok())
            .unwrap_or_default()
    }
}

/// 工具循环对运行上下文的唯一依赖面（design §2.1）。实现方：
/// [`SessionContext`]（交互 / cron 槽位）、子运行上下文（change 后续批次）。
///
/// 会话经 [`Self::with_session`] 暴露（而非返回 `&mut Session`）：会话本身由 `Runtime` 的锁
/// 托管，直接交出可变引用会破坏「只在读写会话的那一刻持锁」的纪律（模块头）。
pub trait RunContext {
    /// 在会话锁内执行一段读写。循环中途的调用只会 `Ok`（busy 协议保证会话存在）。
    fn with_session<R>(
        &mut self,
        f: impl FnOnce(&mut session::Session) -> R,
    ) -> Result<R, CommandError>;

    /// 事件出口（调用侧已盖好 vault 信封）。
    fn sink(&self) -> &dyn EventSink;

    /// 本回合的工具定义快照。交互上下文 = 当前注册表（`task` 的注册与清单注入由
    /// §2/§3 的 agents + task 工具提供；`[harness.subagents].enabled=false` 时不得出现第 9 件）；
    /// 有运行契约的槽位再按 `RunSpec.tool_policy` 过滤（cron 的 8 件白名单因此不含 `task`）。
    fn tool_definitions(&self) -> Vec<serde_json::Value>;

    /// 权限判定（含会话内批准缓存命中）。调用侧只给工具名、主体串与参数；判定层序在
    /// `permissions::decide` 里，本方法不复制一份。
    fn decide(&self, tool: &str, subject: &str, args: &serde_json::Value) -> permissions::Verdict;

    /// 批准闸：挂起请求（含事件上屏）并等待决定。
    fn approval(
        &mut self,
        request: ApprovalRequest,
        rx: mpsc::Receiver<ApprovalSignal>,
    ) -> ApprovalOutcome;

    /// 本策略下的批准语义（决定「挂起等待」还是「直接拒绝」）。
    fn approval_policy(&self) -> ApprovalPolicy;

    /// 无人值守策略的**预览前短路**（change add-cron-runtime-daemon §3.5 的既有顺序）：
    /// 策略为 [`ApprovalPolicy::RejectUnavailable`] 时置程序性中止原因并返回
    /// `(code, message)`；其余策略返回 `None`。
    ///
    /// 调用方 MUST 在生成批准预览**之前**问它：预览失败（如 patch 不唯一命中）同样属于
    /// 「无人值守运行遇到需批准的调用」，必须中止运行，不得把预览错误回送模型续跑——那是
    /// 另一种错误口径，换口径须显式裁决，不能随公共层回抽带入。
    fn reject_unavailable(&mut self) -> Option<(String, String)> {
        None
    }

    /// 预算判定（轮次 / token / 时间；交互路径只有轮次）。
    fn budget(&self, rounds: u32) -> BudgetVerdict;

    /// 预算触顶的收尾（交互 = `loop_max` 提示；子运行 = partial 收敛）。
    fn on_budget_exhausted(&mut self, reason: StopReason);

    /// 留存一条 JSONL 记录（交互 = 会话留存；子运行 = 审计流水）。
    fn persist(&mut self, record: serde_json::Value);

    /// 本轮是否已被请求停止。
    fn aborted(&self) -> bool;

    fn vault_root(&self) -> &Path;

    fn ignore_policy(&self) -> &IgnorePolicy;

    /// 写入会话内批准缓存（「采纳且本会话不再问」）。
    fn remember_approval(&mut self, tool: &str, subject: &str);

    /// 回合正常完成后的收尾钩子（交互 = 自动命名任务判定；子运行 = `None`）。
    fn after_turn(&mut self, user_text: &str) -> Option<TitleJob>;

    /// 压缩续聊的会话侧收尾（交互 = 轮换留存文件 + 重装系统上下文；子运行 = 只压内存态输入）。
    fn begin_compacted_session(&mut self, summary: &str) -> Result<(), CommandError>;

    /// 若该调用属于**并行编排**（`task`），启动它并返回句柄；`None` = 按普通工具串行执行。
    /// 交互上下文实现 `task` 的启动；子运行上下文永远 `None`（深度 1）。
    ///
    /// 对 `task` 调用**恒返回句柄**（包括被拒 / disabled 的调用）：拒绝也要产出一条与普通
    /// 工具同形的结果项，调用方不必为编排工具再写一条错误分支。
    fn orchestrate(&mut self, _call: &llm::ToolCall) -> Option<Box<dyn OrchestrationCall>> {
        None
    }

    /// 该运行是否允许执行这个工具（子运行的定义白名单；交互路径恒 true）。
    /// 执行层二次校验（design §8.2）用它挡住模型幻觉出的未声明工具名。
    fn tool_allowed(&self, _name: &str) -> bool {
        true
    }

    /// 调度工具端口（change add-cron-conversational-registration tasks 2.2）：交互上下文返回
    /// `turn::run_turn` 注入的端口；**交接契约槽位与子运行恒 `None`**——那些运行的注册表里
    /// 本来就没有三件调度工具。
    fn cron_port(&self) -> Option<std::sync::Arc<dyn crate::cron::CronPort>> {
        None
    }

    /// 用户回合开始（在 user 消息入队**之前**调用）：交互上下文借此把排队中的后台完成
    /// 通知并入本回合输入、取消待起唤醒并清零链计数（design §12.6.2）。
    fn begin_user_turn(&mut self) {}

    /// 一次 provider 请求的许可（design §12.3）：父会话自己的往返优先、子请求 FIFO。
    /// 返回的 guard 在 `complete` 期间持有，drop 即归还。缺省 None = 不受闸约束（单测替身）。
    fn request_permit(&self) -> Option<scheduler::RequestPermit> {
        None
    }

    /// 一轮 LLM 往返开始（`round` 从 1 起）：子运行据此发进度事件与计轮次。
    fn on_round(&mut self, _round: u32) {}

    /// 一轮往返的用量（`usage` 已累加进会话）：子运行据此累计段预算。
    fn on_round_usage(&mut self, _usage: &UsageDelta) {}

    /// 压缩调用自己的用量：计入段预算，但**不进任何模型桶**（design §7.5）。
    fn on_compact_usage(&mut self, _usage: &UsageDelta) {}

    /// LLM 错误（上下文超限压缩重试前的原始错误也走这里）：子运行据此分 `quota` / `error`。
    fn on_llm_error(&mut self, _error: &llm::TurnError) {}

    /// 上下文超限的压缩重试成功：显式撤销上一条错误（否则子运行会把已恢复的溢出误判为终态）。
    fn on_llm_error_recovered(&mut self) {}

    /// 一次工具调用的结果（执行后）：子运行据此计 `tool_calls` 与 `denied_calls`。
    fn on_tool_result(&mut self, _name: &str, _result: &serde_json::Value) {}

    /// 一轮助手文本（可能为空）：子运行据此保留「最后一条非空助手文本」作摘要。
    fn on_assistant_text(&mut self, _text: &str) {}

    /// mock 游标进度（design §18）：`parent_consumed` = 本回合父客户端已弹条数，
    /// `region_span` = fixture 声明的子运行区间长度，`script_len` = 脚本总条数。
    /// 真 provider 上下文不需要它；实现方只对 mock 生效。
    fn note_mock_progress(
        &mut self,
        _parent_consumed: usize,
        _region_span: usize,
        _script_len: Option<usize>,
    ) {
    }

    /// 本回合由子运行预分配 / 消费的 mock 条数（父会话游标回写时叠加，design §18）。
    fn external_mock_consumed(&self) -> usize {
        0
    }
}

/// 交互 / cron 槽位的上下文实现（design §2.2）：会话与事件都走既有 `Runtime` 协议，语义与
/// 回抽前逐字节一致。
pub struct SessionContext<'a> {
    sink: &'a dyn EventSink,
    /// 可跨线程持有的同一事件出口（子运行 / 自动唤醒回合在父回合结束后仍要发事件）。
    owned_sink: Option<std::sync::Arc<dyn EventSink>>,
    runtime: &'a Runtime,
    scope: &'a VaultScope,
    config: &'a HarnessConfig,
    /// 本回合的子代理定义快照（change add-harness-subagents design §4.1：每回合开头扫描一次，
    /// 回合内不回读磁盘，不做 watcher）。
    catalog: agents::AgentCatalog,
    /// 本会话的子运行中枢（父会话对象持有；本回合开始时把事件出口与配置快照同步进去）。
    hub: Option<std::sync::Arc<subagents::SubagentHub>>,
    /// 本回合运行契约的工具白名单（`RunSpec.tool_policy`）：构造时从 runtime 取一次。
    /// `None` = 交互路径（没有交接契约，暴露完整注册表）。
    tool_policy: Option<ToolPolicy>,
    /// 调度工具端口（change add-cron-conversational-registration）：由 `turn::run_turn` 注入，
    /// **只在交互路径**（`tool_policy = None`）对模型可见 / 可执行（[`Self::cron_port`] 的判据）。
    /// 单测直接构造上下文时缺省 `None`。
    cron: Option<std::sync::Arc<dyn crate::cron::CronPort>>,
}

impl<'a> SessionContext<'a> {
    pub fn new(
        sink: &'a dyn EventSink,
        runtime: &'a Runtime,
        scope: &'a VaultScope,
        config: &'a HarnessConfig,
    ) -> Self {
        Self::new_with_owned_sink(sink, None, runtime, scope, config)
    }

    /// 生产入口（`turn::run_turn`）：除借用的 sink 外，再给一份可跨线程持有的同一出口。
    pub fn new_with_owned_sink(
        sink: &'a dyn EventSink,
        owned_sink: Option<std::sync::Arc<dyn EventSink>>,
        runtime: &'a Runtime,
        scope: &'a VaultScope,
        config: &'a HarnessConfig,
    ) -> Self {
        // 定义快照在回合开头取一次：磁盘改动下一回合生效；同一回合内的请求共用同一份清单，
        // 不会出现「同一回合前后定义不一致」。装载期 warning / 容量事件在扫描后落诊断日志。
        let catalog = agents::AgentCatalog::load(&scope.root, config);
        catalog.log_diagnostics();
        // 运行契约的工具白名单（change add-harness-subagents design §2.1）：`start_turn` 在
        // 拿到 busy 后把 `RunSpec.tool_policy` 挂到 runtime 上，本构造点读取一次。回合内
        // 工具集因此不随运行期状态变化漂移；交互路径没有契约 ⇒ `None`。
        let tool_policy = runtime.tool_policy(scope);
        // 中枢随父会话对象存亡：这里只做「取或建」并把本回合的事件出口 / 配置同步进去。
        let hub = runtime
            .with_session(scope, |session| {
                let token = session.subagent_token();
                session.ensure_subagent_hub(|| {
                    std::sync::Arc::new(subagents::SubagentHub::new(
                        runtime.clone(),
                        scope.clone(),
                        config.clone(),
                        token,
                    ))
                })
            })
            .ok();
        if let Some(hub) = &hub {
            hub.set_sink(owned_sink.clone());
            hub.set_config(config);
        }
        Self {
            sink,
            owned_sink,
            runtime,
            scope,
            config,
            catalog,
            hub,
            tool_policy,
            cron: None,
        }
    }

    /// 注入调度工具端口（`turn::run_turn` 的接线点）：交互路径持有一个，
    /// [`Self::cron_port`] 在交接契约槽位仍返回 `None`——可见面与可执行面共用一个判据。
    pub fn with_cron_port(
        mut self,
        port: Option<std::sync::Arc<dyn crate::cron::CronPort>>,
    ) -> Self {
        self.cron = port;
        self
    }

    /// 本回合是否**交互发送路径**（没有交接契约）：三件调度工具的唯一注册面。
    fn is_interactive(&self) -> bool {
        self.tool_policy.is_none()
    }

    /// 会话内批准缓存的命名空间：`(vault 根, 会话 id)`（design §6）。会话 id 取自留存文件名
    /// ——新会话 / 切 vault / 压缩开新逻辑会话都会换命名空间，缓存随之清空。
    fn cache_namespace(&self) -> Option<permission_cache::Namespace> {
        self.runtime
            .with_session(self.scope, |session| {
                let session_id = jsonl::JsonlWriter::session_id_from_path(session.jsonl().path());
                permission_cache::Namespace::new(self.scope.key(), session_id.unwrap_or_default())
            })
            .ok()
    }
}

impl RunContext for SessionContext<'_> {
    fn with_session<R>(
        &mut self,
        f: impl FnOnce(&mut session::Session) -> R,
    ) -> Result<R, CommandError> {
        self.runtime.with_session(self.scope, f)
    }

    fn sink(&self) -> &dyn EventSink {
        self.sink
    }

    fn tool_definitions(&self) -> Vec<serde_json::Value> {
        let mut definitions = gate_tool_definitions(
            tools::definitions_with_subagents(&self.catalog),
            self.config.subagents.enabled,
        );
        // 三件调度工具只在**交互发送路径**追加（change add-cron-conversational-registration
        // design §2.2）：交接契约槽位（cron 定时 / 点击）与子运行拿到的定义里没有它们。
        if self.is_interactive() {
            definitions.extend(tools::cron_definitions());
        }
        filter_tool_definitions(definitions, self.tool_policy.as_ref())
    }

    fn cron_port(&self) -> Option<std::sync::Arc<dyn crate::cron::CronPort>> {
        if !self.is_interactive() {
            return None;
        }
        self.cron.clone()
    }

    fn decide(&self, tool: &str, subject: &str, args: &serde_json::Value) -> permissions::Verdict {
        let cached = self
            .cache_namespace()
            .is_some_and(|namespace| permission_cache::is_remembered(&namespace, tool, subject));
        let judge = permissions::Judge {
            mode: self.config.permission_mode,
            root: &self.scope.root,
            argv: (tool == "cli_run").then(|| tools::cli_argv(args)),
            cached,
        };
        // 规则取**本轮生效值**（change harness-permission-rules-oct23 design §4）：批准卡上
        // 沉淀 / 浮层里删掉的规则，对本轮的下一条判定立即生效；未播种时回落配置快照。
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
        // 无人值守策略的短路与代码 / 文案同出一处（`reject_unavailable`）：正常调用方已在
        // 预览前短路（`gated_execute` 顶部），这里保留同一道判断作防御，语义与 master 等价。
        if let Some((code, message)) = self.reject_unavailable() {
            return ApprovalOutcome::Unavailable { code, message };
        }
        // 事件载荷的展示字段在请求被 park 前取出（park 取走所有权）；批准卡与事件同源。
        let tool = request.tool.clone();
        let diff = request.diff.clone();
        let argv = request.argv.clone();
        let purpose = request.purpose.clone();
        let reason = request.reason.clone();
        let cron_task = request.cron_task.clone();
        let remember = request.remember.clone();
        let persist_rule = request.persist_rule.clone();
        let id = match self.runtime.park_approval(self.scope, request) {
            Ok(id) => id,
            Err(error) => return ApprovalOutcome::Failed(error),
        };
        self.sink.emit(events::approval_request_full(
            &id,
            &tool,
            diff.as_deref(),
            argv.as_deref(),
            purpose.as_deref(),
            reason.as_ref(),
            None,
            cron_task.as_ref(),
            remember.as_deref(),
            persist_rule.as_deref(),
        ));
        // 未决批准项不自动超时通过：通道失效（会话重置 / vault 切换）⇒ 判过期，不执行。
        match rx.recv() {
            Ok(ApprovalSignal::Decided(decision)) => ApprovalOutcome::Decided(decision),
            Ok(ApprovalSignal::Withdrawn) => ApprovalOutcome::Withdrawn,
            Err(_) => ApprovalOutcome::Stale,
        }
    }

    fn approval_policy(&self) -> ApprovalPolicy {
        if self.runtime.is_isolated() {
            ApprovalPolicy::RejectUnavailable
        } else {
            ApprovalPolicy::Interactive
        }
    }

    fn reject_unavailable(&mut self) -> Option<(String, String)> {
        if self.approval_policy() != ApprovalPolicy::RejectUnavailable {
            return None;
        }
        // 程序性中止原因（`approval_required`）由会话承载：工具循环在下一个检查点收口，
        // 终态事件带错误码，cron 回执据此产出 `run_finished(ok=false)`。
        let code = "approval_required";
        let message = "无人值守运行遇到需要批准的调用，已中止本次运行";
        let _ = self.with_session(|session| session.stop_with(code, message));
        Some((code.to_string(), message.to_string()))
    }

    fn budget(&self, rounds: u32) -> BudgetVerdict {
        if rounds >= self.config.loop_max {
            BudgetVerdict::Exhausted(StopReason::Rounds)
        } else {
            BudgetVerdict::Continue
        }
    }

    fn on_budget_exhausted(&mut self, reason: StopReason) {
        // 交互路径只可能因轮次触顶；token / 时间是子运行的闸，由子上下文自己收尾。
        if reason != StopReason::Rounds {
            return;
        }
        let loop_max = self.config.loop_max;
        let text = format!(
            "已达到工具循环上限（{loop_max} 轮），本轮已停止。问题可能过大，建议开新会话后拆小提问。"
        );
        let _ = self.with_session(|session| {
            for item in session::assistant_item(&text, None) {
                session.push_input(item);
            }
            session.push_panel(PanelMessage {
                role: "assistant".into(),
                text: Some(text.clone()),
                summary: None,
                name: None,
                status: None,
                reasoning: None,
                decision: None,
                ts: jsonl::unix_secs_now(),
            });
            session.jsonl().record(&serde_json::json!({
                "kind": "loop_max_reached",
                "loop_max": loop_max,
            }));
        });
        self.sink.emit(events::text_chunk(&text));
    }

    fn persist(&mut self, record: serde_json::Value) {
        let _ = self.with_session(|session| session.jsonl().record(&record));
    }

    fn aborted(&self) -> bool {
        let aborted = self
            .runtime
            .with_session(self.scope, |session| session.abort_requested())
            .unwrap_or(false);
        // 父回合停止是**广播**的（design §12.4）：本回合起的子运行在下一检查点收敛
        // `Aborted`。只在读到停止时同步一次，正常路径零开销。
        if aborted {
            if let Some(hub) = &self.hub {
                hub.broadcast_abort();
            }
        }
        aborted
    }

    fn vault_root(&self) -> &Path {
        &self.scope.root
    }

    fn ignore_policy(&self) -> &IgnorePolicy {
        &self.scope.policy
    }

    fn remember_approval(&mut self, tool: &str, subject: &str) {
        if let Some(namespace) = self.cache_namespace() {
            permission_cache::remember(&namespace, tool, subject);
        }
    }

    fn after_turn(&mut self, user_text: &str) -> Option<TitleJob> {
        super::title::job_after_turn(self.runtime, self.scope, self.config, user_text)
    }

    fn orchestrate(&mut self, call: &llm::ToolCall) -> Option<Box<dyn OrchestrationCall>> {
        if call.name != "task" {
            return None;
        }
        let hub = self.hub.clone()?;
        Some(Box::new(subagents::start_task(
            &hub,
            self.config,
            &self.catalog,
            call,
            self.owned_sink.clone(),
        )))
    }

    fn begin_user_turn(&mut self) {
        // 无人值守槽位（cron）不参与自动唤醒与链计数（design §12.6.1）。
        if self.runtime.is_isolated() {
            return;
        }
        let Some(hub) = self.hub.clone() else {
            return;
        };
        if let Some(notice) = hub.begin_user_turn() {
            let _ = self.with_session(|session| {
                subagents::insert_notice_message(session, &notice.text, Some(&notice.batch_id))
            });
        }
    }

    fn request_permit(&self) -> Option<scheduler::RequestPermit> {
        let priority = if self.runtime.is_isolated() {
            scheduler::RequestPriority::Child
        } else {
            scheduler::RequestPriority::Parent
        };
        Some(scheduler::acquire_provider_request(
            &self.config.provider,
            self.config.subagents.max_concurrent,
            priority,
        ))
    }

    fn note_mock_progress(
        &mut self,
        parent_consumed: usize,
        region_span: usize,
        script_len: Option<usize>,
    ) {
        if let Some(hub) = &self.hub {
            let base = self
                .runtime
                .with_session(self.scope, |session| session.mock_cursor())
                .unwrap_or(0);
            hub.note_mock_progress(base, parent_consumed, region_span, script_len);
        }
    }

    fn external_mock_consumed(&self) -> usize {
        self.hub
            .as_ref()
            .map(|hub| hub.external_mock_consumed())
            .unwrap_or(0)
    }

    fn begin_compacted_session(&mut self, summary: &str) -> Result<(), CommandError> {
        let context_section =
            self.with_session(|session| session.current_context().map(str::to_string))?;
        // 压缩是一次汇总调用，档位照会话现值；读数种子带压缩前的快照 + **清零**的累计器。
        let session_effort = self
            .with_session(|session| session.thinking_effort())
            .unwrap_or_default();
        let usage_snapshot = self
            .with_session(|session| session.usage())
            .unwrap_or_default();
        // 压缩前源会话的有效标题：新文件在 `session_open` 之后追加一条 `decision=inherit`
        // ——不继承的话新文件的首条用户消息是压缩模板文字，回落口径会把模板当会话名。
        let inherited_title = self
            .with_session(|session| session.title().map(str::to_string))
            .unwrap_or(None);
        let assembled = super::context::assemble_system(self.vault_root());
        let session_id = jsonl::new_session_id();
        let open = super::session_open_payload(
            self.scope,
            self.config,
            &assembled,
            &session_id,
            "compact",
            session_effort,
            super::OpenExtras {
                compact_summary: Some(summary),
                usage_seed: Some((usage_snapshot, session::CacheTotals::default())),
            },
        );
        let writer = jsonl::JsonlWriter::create(&session_id, &self.scope.vault_id, &open)?;
        let _ = self.with_session(|session| {
            let mut items = vec![session::user_item(&format!(
                "（此前会话已压缩为摘要，接着摘要继续）\n{summary}"
            ))];
            if let Some(section) = &context_section {
                items.push(session::user_item(section));
            }
            session.replace_input(items);
            session.push_panel(PanelMessage {
                role: "compact".into(),
                text: None,
                summary: Some(summary.to_string()),
                name: None,
                status: None,
                reasoning: None,
                decision: None,
                ts: jsonl::unix_secs_now(),
            });
            // 文件边界即压缩留痕：压缩事件类（旧 compact kind）已废弃。
            session.rotate(assembled.text, writer);
            // 子运行分桶跨过压缩边界（change add-harness-subagents design §9.2）：新文件没有
            // 压缩前的 `subrun` sidecar，桶必须随 `session_open` 落种，否则这份会话再被恢复
            // 时分桶会归零（live 表挂在 Session 对象上不清零，留存不可推导即两套读数）。
            // 取值与 rotate 在同一把锁内完成——后台段收尾的 sidecar 不会插进种子与文件切换之间。
            let buckets = serde_json::to_value(session.subrun_usage()).unwrap_or_default();
            session
                .jsonl()
                .update_pending_open(|open| open["subrun_usage"] = buckets);
            // 继承标题（design D7）：新文件 `session_open` 之后紧接 `inherit` 记录。
            if let Some(title) = &inherited_title {
                session
                    .jsonl()
                    .record(&super::title::inherit_payload(title));
                session.set_title(Some(title.clone()));
            }
        });
        self.sink.emit(events::compact(summary));
        // 继承标题也发一次 title 事件：面板先按 compact 重置视图，再应用续用的标题。
        if let Some(title) = &inherited_title {
            self.sink.emit(events::title(title));
        }
        Ok(())
    }
}

/// 工具定义的 kill switch（`[harness.subagents].enabled`）：关闭时第 9 件 `task` 不注册。
///
/// 第 9 件由 [`tools::definitions_with_subagents`] 按定义快照注册（`gate_tool_definitions`
/// 是**唯一**的关闭点——交互上下文与将来的子运行上下文都从这里取快照）。定义名是跨层契约
/// （`task` 工具名），MUST NOT 在别处再写一份过滤。
fn gate_tool_definitions(
    mut definitions: Vec<serde_json::Value>,
    enabled: bool,
) -> Vec<serde_json::Value> {
    if !enabled {
        definitions.retain(|definition| definition["name"] != "task");
    }
    definitions
}

/// 运行契约的工具白名单闸（`RunSpec.tool_policy.allow`，change add-harness-subagents
/// design §2.1）：白名单是闭集合，模型只看得见其中声明的工具。
///
/// `None` = 交互路径没有交接契约（完整注册表）；`Some` = 契约唯一真源——成员之外的注册表
/// 条目（包括按 `[harness.subagents].enabled` 刚注册的 `task`）一律不暴露。放行仍归权限管线，
/// 本函数只决定「可见」。
fn filter_tool_definitions(
    definitions: Vec<serde_json::Value>,
    policy: Option<&ToolPolicy>,
) -> Vec<serde_json::Value> {
    let Some(policy) = policy else {
        return definitions;
    };
    definitions
        .into_iter()
        .filter(|definition| {
            definition["name"]
                .as_str()
                .is_some_and(|name| policy.allow.iter().any(|allowed| allowed == name))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct NullSink;

    impl EventSink for NullSink {
        fn emit(&self, _payload: serde_json::Value) {}
    }

    /// 恢复 `XDG_CONFIG_HOME`（断言失败 panic 也要复原，别污染同进程的别的用例）。
    struct XdgGuard(Option<std::ffi::OsString>);

    impl Drop for XdgGuard {
        fn drop(&mut self) {
            match &self.0 {
                Some(value) => std::env::set_var("XDG_CONFIG_HOME", value),
                None => std::env::remove_var("XDG_CONFIG_HOME"),
            }
        }
    }

    /// `enabled=false` 时工具清单与既有 8 件基线**深度相等**（change design §2.2 的回归锚）：
    /// 回抽改变的唯一数据面是「工具定义来自上下文」，关闭子代理时必须逐字节回到旧清单。
    /// 区分度：`gate_tool_definitions` 不删除 `task` 时本用例在合成定义上必 FAIL（见下一条）。
    #[test]
    fn disabled_subagents_keep_the_eight_tool_baseline() {
        let root = std::env::temp_dir().join(format!("lumir-run-tools-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        // JSONL 落点走 XDG_CONFIG_HOME（REVIEW.md「测试污染真实环境」条：不写真实 ~/.config/lumir）。
        // 先取进程级 XDG 锁、再改环境（drop 逆序：XDG 复原时仍持锁）。
        let _xdg = crate::harness::xdg_test_lock();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));

        let vault = root.join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        let scope = VaultScope {
            root: vault.clone(),
            policy: {
                let defaults = crate::config::VaultConfig::default();
                IgnorePolicy::load(&vault, &[".gitignore".to_string()], &defaults.ignore)
            },
            vault_id: "vault-test-1".to_string(),
        };
        let mut config = crate::config::test_mock(Some("/tmp/fixture.json"));
        config.subagents.enabled = false;

        let runtime = Runtime::default();
        runtime.acquire_turn(&scope, &config).unwrap();
        let sink = NullSink;
        let ctx = SessionContext::new(&sink, &runtime, &scope, &config);
        // 交互路径 = 8 件 vault 工具（逐字节不变）+ 3 件调度工具（子代理关闭时 `task` 缺席）。
        let definitions = ctx.tool_definitions();
        assert_eq!(
            definitions[..tools::definitions().len()],
            tools::definitions()[..],
            "enabled=false 时 8 件 vault 清单必须逐字节不变"
        );
        assert_eq!(
            definitions.len(),
            tools::TOOL_NAMES.len() + tools::CRON_TOOL_NAMES.len()
        );
        let names: Vec<&str> = definitions
            .iter()
            .map(|definition| definition["name"].as_str().unwrap())
            .collect();
        for cron_tool in tools::CRON_TOOL_NAMES {
            assert!(
                names.contains(&cron_tool),
                "交互路径应注册 {cron_tool}：{names:?}"
            );
        }
        assert!(
            !names.contains(&"task"),
            "子代理关闭时 task 必须缺席：{names:?}"
        );
        runtime.release_turn(&scope);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// enabled=true 时第 9 件 `task` 注册，描述里带定义快照的清单（内建 `explore` 恒在场，
    /// vault 级定义同回合可见）。
    #[test]
    fn enabled_subagents_register_task_with_the_catalog() {
        let root = std::env::temp_dir().join(format!("lumir-run-task-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let _xdg = crate::harness::xdg_test_lock();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));

        let vault = root.join("vault");
        let agents = vault.join(".lumir").join("agents");
        std::fs::create_dir_all(&agents).unwrap();
        std::fs::write(
            agents.join("research.md"),
            "---\nname: research\ndescription: 调研任务\n---\n正文\n",
        )
        .unwrap();
        let scope = VaultScope {
            root: vault.clone(),
            policy: {
                let defaults = crate::config::VaultConfig::default();
                IgnorePolicy::load(&vault, &[".gitignore".to_string()], &defaults.ignore)
            },
            vault_id: "vault-test-2".to_string(),
        };
        let config = crate::config::test_mock(Some("/tmp/fixture.json"));
        assert!(config.subagents.enabled);

        let runtime = Runtime::default();
        runtime.acquire_turn(&scope, &config).unwrap();
        let sink = NullSink;
        let ctx = SessionContext::new(&sink, &runtime, &scope, &config);
        let definitions = ctx.tool_definitions();
        assert_eq!(
            definitions.len(),
            tools::definitions().len() + 1 + tools::CRON_TOOL_NAMES.len()
        );
        let task = definitions
            .iter()
            .find(|definition| definition["name"] == "task")
            .expect("enabled=true 时 task 必须注册");
        let description = task["description"].as_str().unwrap();
        assert!(description.contains("可用子代理"), "{description}");
        assert!(description.contains("- explore："), "{description}");
        assert!(
            description.contains("- research：调研任务"),
            "{description}"
        );
        runtime.release_turn(&scope);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 运行契约的工具白名单是**唯一真源**（change add-harness-subagents design §2.1）：
    /// cron 交接声明 `tool_policy.allow` = 8 件 vault 工具（不含 `task`），即使
    /// `[harness.subagents].enabled=true`，`SessionContext::tool_definitions` 也不得暴露 `task`。
    ///
    /// 区分度：同配置下交互路径（无契约，见上一条用例）会注册第 9 件——去掉白名单过滤后本
    /// 用例必 FAIL。断言直接取 `cron::handoff` 产出的契约值，而不是在测试里另抄一份 8 件表。
    #[test]
    fn cron_tool_policy_hides_task_even_when_subagents_enabled() {
        let root = std::env::temp_dir().join(format!("lumir-run-policy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let _xdg = crate::harness::xdg_test_lock();
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));

        let vault = root.join("vault");
        std::fs::create_dir_all(vault.join(".lumir").join("agents")).unwrap();
        let scope = VaultScope {
            root: vault.clone(),
            policy: {
                let defaults = crate::config::VaultConfig::default();
                IgnorePolicy::load(&vault, &[".gitignore".to_string()], &defaults.ignore)
            },
            vault_id: "vault-test-3".to_string(),
        };
        let config = crate::config::test_mock(Some("/tmp/fixture.json"));
        assert!(config.subagents.enabled);

        let task = crate::config::CronTask {
            id: "task-a".to_string(),
            vault: vault.display().to_string(),
            at: "21:00".to_string(),
            days: crate::config::CronWeekday::ALL.to_vec(),
            prompt: "synthetic prompt".to_string(),
            delivery: crate::config::DeliveryPolicy::RunThenNotify,
            session: crate::config::SessionShape::New,
            model: None,
        };
        let handoff = crate::cron::handoff(&crate::cron::HandoffInput {
            task: &task,
            run_id: "run-1",
            trigger: crate::cron::Trigger::Timer,
            vault: &task.vault,
            loop_max: 42,
            session_id: None,
        });

        let runtime = Runtime::default();
        runtime.acquire_turn(&scope, &config).unwrap();
        runtime.set_tool_policy(&scope, handoff.spec.tool_policy);
        let sink = NullSink;
        let ctx = SessionContext::new(&sink, &runtime, &scope, &config);
        let definitions = ctx.tool_definitions();
        assert_eq!(
            definitions,
            tools::definitions(),
            "cron 契约的 8 件白名单必须与既有 vault 工具清单深度相等"
        );
        assert!(
            !definitions.iter().any(|defined| defined["name"] == "task"),
            "契约未声明 task，无人值守运行不得看见委派工具"
        );
        assert!(
            !definitions.iter().any(|defined| tools::CRON_TOOL_NAMES
                .contains(&defined["name"].as_str().unwrap_or_default())),
            "交接契约槽位不得看见三件调度工具：{definitions:?}"
        );

        // 白名单随 busy 一起撤销：下一轮交互发送回到完整注册表（task 与三件调度工具重新可见）。
        runtime.release_turn(&scope);
        assert!(runtime.tool_policy(&scope).is_none());
        let ctx = SessionContext::new(&sink, &runtime, &scope, &config);
        assert_eq!(
            ctx.tool_definitions().len(),
            tools::definitions().len() + 1 + tools::CRON_TOOL_NAMES.len()
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 契约也承载「子集」：白名单之外的注册表条目一律不暴露（模型看不见未声明的工具）。
    #[test]
    fn tool_policy_filters_arbitrary_subsets() {
        let policy = ToolPolicy {
            allow: vec!["vault_read".to_string()],
        };
        let filtered = filter_tool_definitions(tools::definitions(), Some(&policy));
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0]["name"], "vault_read");
    }

    /// kill switch 对第 9 件真的生效：合成的 `task` 定义在关闭时被移除、打开时保留。
    #[test]
    fn disabled_subagents_drop_the_task_definition() {
        let task = serde_json::json!({"type": "function", "name": "task"});
        let mut definitions = tools::definitions();
        definitions.push(task.clone());

        let closed = gate_tool_definitions(definitions.clone(), false);
        assert_eq!(closed, tools::definitions(), "关闭时 task 必须缺席");
        assert!(!closed.iter().any(|defined| defined["name"] == "task"));

        let open = gate_tool_definitions(definitions, true);
        assert_eq!(open.len(), tools::definitions().len() + 1);
        assert_eq!(open.last(), Some(&task));
    }
}
