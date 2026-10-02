//! 批准闸（design §6-§7）：ask 档工具调用的挂起 / 采纳 / 拒绝。
//!
//! 一次一轮至多一个挂起请求：工具循环线程把请求（含决定回传通道）park 进会话后
//! 阻塞在 `rx.recv()` 上；`harness_approve` 按 id 找到请求、记录 JSONL、经通道发回决定。
//! **未决批准项不自动超时通过**——通道无超时，线程可以一直等（关 vault / 新会话 /
//! 进程退出才会让它失效）。

use std::sync::mpsc::Sender;

/// 面板发回的采纳 / 拒绝决定。
#[derive(Debug, Clone)]
pub struct ApprovalDecision {
    pub approved: bool,
    /// 拒绝原因（可选），随工具结果回送模型。
    pub reason: Option<String>,
}

/// 挂起中的批准请求（会话内一次一个）。
///
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
    /// 决定回传通道（sender 在 harness_approve 侧消费）。
    pub tx: Sender<ApprovalDecision>,
}

impl ApprovalRequest {
    pub fn new(
        tool: String,
        diff: Option<String>,
        argv: Option<Vec<String>>,
        tx: Sender<ApprovalDecision>,
    ) -> Self {
        Self {
            id: String::new(),
            tool,
            diff,
            argv,
            tx,
        }
    }

    pub fn with_id(mut self, id: String) -> Self {
        self.id = id;
        self
    }
}
