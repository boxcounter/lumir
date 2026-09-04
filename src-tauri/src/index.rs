//! 索引 / 搜索 —— 模块骨架（空实现）。
//!
//! 职责见 ADR 0002 第 3 条：全文索引与搜索在 Rust core 完成。
//! 架构约束见 ADR 0002 第 7 条：索引数据结构不耦合 UI 层，
//! 不堵死未来进程外 extension 隔离。

/// 文档索引（占位类型，M1 起充实）。
pub struct DocumentIndex;

impl DocumentIndex {
    /// 建空索引（空实现）。
    pub fn new() -> Self {
        Self
    }
}

impl Default for DocumentIndex {
    fn default() -> Self {
        Self::new()
    }
}
