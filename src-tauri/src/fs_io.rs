//! 文件 IO / 监听 —— 模块骨架（空实现）。
//!
//! 职责见 ADR 0002 第 3 条：workspace 内 Markdown 文件的读写与变更监听
//! 全部在 Rust core 完成，webview 层不直接触文件系统。
//! 架构约束见 ADR 0002 第 7 条：本模块的数据结构不得依赖 UI 层类型。

/// workspace 根目录的一次读取结果（占位类型，M1 起充实）。
pub struct WorkspaceSnapshot;

/// 扫描 workspace（空实现）。
pub fn scan_workspace(_root: &std::path::Path) -> Option<WorkspaceSnapshot> {
    None
}
