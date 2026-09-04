//! ACP client —— 模块骨架（空实现）。
//!
//! 职责见 ADR 0002 第 4 条：编辑器作为宿主通过 ACP（Agent Client Protocol，
//! 现成开放协议，不自造）接入任意 ACP agent。

/// ACP agent 会话（占位类型，M1 起充实）。
pub struct AcpSession;

/// 连接一个 ACP agent 进程（空实现）。
pub fn connect(_command: &str) -> Option<AcpSession> {
    None
}
