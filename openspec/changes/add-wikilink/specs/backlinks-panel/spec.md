# backlinks-panel 增量规格

> 可推迟标注：ADR 0004 §2 挤压预案明确 backlinks 可推迟。若实现期时间受挤压，本 capability 的 requirement 可整体标注放弃原因后随节点 2 评审归档。

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
