//! 批准闸（design §6-§7）：ask 档工具调用的挂起 / 采纳 / 拒绝。
//!
//! 一次一轮至多一个挂起请求：工具循环线程把请求（含回传通道）park 进会话后
//! 阻塞在 `rx.recv()` 上；`harness_approve` 按 id 找到请求、记录 JSONL、经通道发回决定。
//! **未决批准项不自动超时通过**——通道无超时，线程可以一直等（关 vault / 新会话 /
//! 进程退出才会让它失效）；唯一的主动收口是「停止本轮」（M348）：`request_abort`
//! 收回待决项并经通道发回 [`ApprovalSignal::Withdrawn`]，等待线程据此如实记
//! 「本轮已停止」，而不是混同「批准通道已关闭」。

use std::sync::mpsc::Sender;

use serde::Serialize;

use super::permissions::DecisionReason;

/// 批准请求的发起者（change add-harness-subagents design §8.3）：父会话自己的调用是
/// `Interactive`；子运行的调用带 agent / run_id / description，卡片据此点名发起者。
///
/// 形状是 internally tagged（`{"kind":"subrun","agent":…}`）——与 `ApprovalRequest.reason`
/// 同一种线格式，前端按 `kind` 分支。序列化只在事件与快照两条 UI 通道上使用。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ApprovalSource {
    /// 父会话自己的工具调用（既有形态）。
    Interactive,
    /// 子运行透传上来的批准卡。
    Subrun {
        agent: String,
        run_id: String,
        description: String,
    },
}

/// 面板发回的采纳 / 拒绝决定。
#[derive(Debug, Clone)]
pub struct ApprovalDecision {
    pub approved: bool,
    /// 拒绝原因（可选），随工具结果回送模型。
    pub reason: Option<String>,
    /// 「采纳且本会话不再问」（design §6 次级动作）：true 时由 gated_execute 把该调用的
    /// 会话记忆键写入会话内批准缓存（[`super::permission_cache`]）。点普通采纳是 false
    /// ——显式逐次记忆，不自动记（裁决点 4 落 A）。
    pub remember: bool,
    /// 「以后都允许 `<规则>`」（change harness-permission-rules-oct23 A1）：true 且采纳时
    /// 由 `harness_approve` 在 resolve **之前**把规则写回全局配置——写失败则批准保持待决。
    pub persist_rule: bool,
}

/// 批准通道上的一次性信号：采纳 / 拒绝决定，或「本轮被停止」的收回。
#[derive(Debug)]
pub enum ApprovalSignal {
    Decided(ApprovalDecision),
    /// 用户停止了本轮：待决项随中断收回，调用未执行（M348）。
    Withdrawn,
}

/// 挂起中的批准请求（会话内一次一个）。
///
/// diff / argv 按工具给：写类附 diff，cli_run 附 argv。
/// revision 不在此携带：CAS 基准由 `gated_execute` 的闭包变量直通执行入口
/// （`preview.revision` → `execute_with_revision`），请求对象只承载面板可见
/// 的展示字段（diff/argv）与决定通道。
#[derive(Debug)]
pub struct ApprovalRequest {
    pub id: String,
    pub tool: String,
    /// 写工具的 unified diff 预览（vault_patch / vault_create）。
    pub diff: Option<String>,
    /// CLI 的完整 argv（cli_run）。
    pub argv: Option<Vec<String>>,
    /// 批准卡上展示的用途句（cli_run，design §3.4）；来源是
    /// [`super::tools::ApprovalPreview::purpose`]，事件与快照都从这里取（单一真源）。
    pub purpose: Option<String>,
    /// 判定依据（M459，change add-approval-decision-reason）：这次调用**为什么**进闸
    /// （`DecisionReason`，只可能来自产批准卡的两层）。事件与快照两条 UI 通道都从这里取
    /// （单一真源）；`None` = 无依据可讲（旧载荷 / 未来新增的 Ask 层未标依据）。
    pub reason: Option<DecisionReason>,
    /// 定时任务预览（change add-cron-conversational-registration design §6.3）：`cron_task_create` /
    /// `cron_task_remove` 的五要素快照（`prompt` 全文只在这里出现，不进诊断日志）。
    /// 事件载荷键 `cron_task` 与 `PendingApprovalSnapshot.cron_task` 同源（都取自本字段）。
    pub cron_task: Option<serde_json::Value>,
    /// 该批准卡支持「采纳且本会话不再问（记住 `<粒度>`）」次级动作：`Some(粒度)` = 显示，
    /// `None` = 不显示。粒度由 [`super::permissions::permission_prefix`] 从 argv / 路径现算
    /// （单一真源）；危险黑名单层恒 `None`——那一层先于 allow 规则与会话缓存，按钮点了也不
    /// 生效（D3 裁决：死按钮藏起来）。是面板动作可见性的唯一开关——`PendingApprovalSnapshot`
    /// 原样镜像给前端。
    pub remember: Option<String>,
    /// 该批准卡支持「以后都允许 `<规则>`」次级动作：`Some(规则原文)` = 显示，`None` = 不显示。
    /// 规则文本同样由 [`super::permissions::permission_prefix`] 生成（后端单一真源，按钮逐字
    /// 显示）；`vault_delete` / `cron_task_*` 不给（Q7 裁决）。
    pub persist_rule: Option<String>,
    /// 模式匹配的主体串（规则文本的现算输入之一；`harness_approve` 持久化时**不采信前端**
    /// 传入的任何文本，从本字段 + `argv` 重算）。`PendingApprovalSnapshot` 不含它——
    /// 前端没有消费者。
    pub subject: String,
    /// 发起者（design §8.3）：交互调用是 `Interactive`，子运行透传的请求带来源三件。
    pub source: ApprovalSource,
    /// 决定回传通道（harness_approve 发 Decided；停止本轮发 Withdrawn）。
    pub tx: Sender<ApprovalSignal>,
}

impl ApprovalRequest {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        tool: String,
        diff: Option<String>,
        argv: Option<Vec<String>>,
        purpose: Option<String>,
        reason: Option<DecisionReason>,
        subject: String,
        remember: Option<String>,
        persist_rule: Option<String>,
        tx: Sender<ApprovalSignal>,
    ) -> Self {
        Self {
            id: String::new(),
            tool,
            diff,
            argv,
            purpose,
            reason,
            cron_task: None,
            remember,
            persist_rule,
            subject,
            source: ApprovalSource::Interactive,
            tx,
        }
    }

    pub fn with_id(mut self, id: String) -> Self {
        self.id = id;
        self
    }

    /// 附带定时任务预览（`cron_task_create` / `cron_task_remove` 的批准卡载荷）。
    pub fn with_cron_task(mut self, cron_task: Option<serde_json::Value>) -> Self {
        self.cron_task = cron_task;
        self
    }

    /// 子运行透传的请求（design §8.3）：卡片点名发起者。
    pub fn with_source(mut self, source: ApprovalSource) -> Self {
        self.source = source;
        self
    }
}
