//! 批准闸（design §6-§7）：ask 档工具调用的挂起 / 采纳 / 拒绝。
//!
//! 一次一轮至多一个挂起请求：工具循环线程把请求（含回传通道）park 进会话后
//! 阻塞在 `rx.recv()` 上；`harness_approve` 按 id 找到请求、记录 JSONL、经通道发回决定。
//! **未决批准项不自动超时通过**——通道无超时，线程可以一直等（关 vault / 新会话 /
//! 进程退出才会让它失效）；唯一的主动收口是「停止本轮」（M348）：`request_abort`
//! 收回待决项并经通道发回 [`ApprovalSignal::Withdrawn`]，等待线程据此如实记
//! 「本轮已停止」，而不是混同「批准通道已关闭」。

use std::sync::mpsc::Sender;

/// 面板发回的采纳 / 拒绝决定。
#[derive(Debug, Clone)]
pub struct ApprovalDecision {
    pub approved: bool,
    /// 拒绝原因（可选），随工具结果回送模型。
    pub reason: Option<String>,
    /// 「采纳且本会话不再问」（design §6 次级动作）：true 时 `(工具, 主体串)` 由
    /// gated_execute 写入会话内批准缓存（[`super::permission_cache`]）。点普通采纳是 false
    /// ——显式逐次记忆，不自动记（裁决点 4 落 A）。
    pub remember: bool,
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
    /// 该批准卡支持「采纳且本会话不再问」次级动作（design §6；批准闸挂出的请求恒 true）。
    /// 是面板动作可见性的开关——`PendingApprovalSnapshot` 原样镜像给前端。
    pub remember: bool,
    /// 决定回传通道（harness_approve 发 Decided；停止本轮发 Withdrawn）。
    pub tx: Sender<ApprovalSignal>,
}

impl ApprovalRequest {
    pub fn new(
        tool: String,
        diff: Option<String>,
        argv: Option<Vec<String>>,
        purpose: Option<String>,
        remember: bool,
        tx: Sender<ApprovalSignal>,
    ) -> Self {
        Self {
            id: String::new(),
            tool,
            diff,
            argv,
            purpose,
            remember,
            tx,
        }
    }

    pub fn with_id(mut self, id: String) -> Self {
        self.id = id;
        self
    }
}
