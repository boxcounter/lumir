//! CLI —— 模块骨架（空实现）。
//!
//! 职责见 ADR 0002 第 3、4 条：同仓同二进制家族；terminal 中的 agent
//! 不启动 GUI 即可操作同一 workspace。

/// CLI 子命令（占位，M1 起充实）。
pub enum Command {
    /// 占位：打开 workspace。
    Open(std::path::PathBuf),
}

/// 解析 argv（空实现：目前一律视为打开当前目录）。
pub fn parse(_args: &[String]) -> Option<Command> {
    None
}
