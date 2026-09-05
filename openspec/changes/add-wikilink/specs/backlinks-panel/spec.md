# backlinks-panel 增量规格

> **已推迟（2026-09-05 Alex 裁决）**：按 ADR 0004 §2 挤压预案，本 capability 整体推迟。原因：Alex 不用反链面板，且前端对 `link_graph_backlinks` 的调用是大 vault 冻结的根因调用方。已落地的面板实现（`src/backlinks.ts`、IPC 封装、视觉场景与基线）已随本标注一并移除；Rust 侧 `link_graph_backlinks` command 由后续 link_graph 波次删除。以下 requirement 留档不生效，v1+ 重建意向与 Alex 背书见 finding `20260905-tower-idea-v1-agent.md`。

## ADDED Requirements

### Requirement: 反链只读面板

系统 SHALL 提供当前文件的反链面板：列出链接到当前文件的来源文件与行级上下文，数据来自 `link_graph_backlinks`。面板为只读派生视图（ADR 0003 §1：link graph 是只读派生物），MUST NOT 提供任何改写来源文件的入口。

#### Scenario: 反链列表

- **WHEN** 当前文件为 `folder/Gamma.md` 且 `Alpha.md` 含 `[[Gamma]]`
- **THEN** 反链面板列出 `Alpha.md` 及该链接所在行的上下文

### Requirement: 反链跳转

用户点击反链条目时，系统 SHALL 打开来源文件并定位到该链接所在行。

#### Scenario: 点击跳转来源

- **WHEN** 用户点击 `Alpha.md` 的反链条目
- **THEN** 打开 `Alpha.md` 并定位到含该 wikilink 的行
