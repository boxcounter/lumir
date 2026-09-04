//! MCP server —— 模块骨架（空实现）。
//!
//! 职责见 ADR 0002 第 4 条：通过 MCP（Model Context Protocol，现成开放协议，
//! 不自造）反向暴露 app 状态（打开的文件、选区等）给外部 agent。

/// MCP server 句柄（占位类型，M1 起充实）。
pub struct McpServer;

/// 启动 MCP server（空实现）。
pub fn serve() -> Option<McpServer> {
    None
}
