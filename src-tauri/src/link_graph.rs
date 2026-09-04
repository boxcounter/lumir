//! link graph —— 模块骨架（空实现）。
//!
//! 职责见 ADR 0002 第 3 条：wikilink 正反链图在 Rust core 维护
//! （wikilink 兼容范围见 ADR 0003）。
//! 架构约束见 ADR 0002 第 7 条：图结构不耦合 UI 层。

/// 笔记链接图（占位类型，M1 起充实）。
pub struct LinkGraph;

impl LinkGraph {
    /// 建空图（空实现）。
    pub fn new() -> Self {
        Self
    }
}

impl Default for LinkGraph {
    fn default() -> Self {
        Self::new()
    }
}
