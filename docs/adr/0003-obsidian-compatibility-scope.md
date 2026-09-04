# ADR 0003: Obsidian 兼容范围

- 状态: accepted
- 日期: 2026-09-04
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Context

- wikilink `[[...]]` 语法是 wiki 时代的公共遗产（MediaWiki 等使用十余年），无知识产权问题；但它不属于 CommonMark，无任何正式规范。解析语义（短路径解析、大小写处理、标题引用格式）是 Obsidian 方言——其标题引用格式为 Obsidian 自创、无公开的 slug 规则，与 GFM（GitHub Flavored Markdown）锚点互不兼容（[官方论坛有记录](https://forum.obsidian.md/t/heading-link-compatibility/46988)），且行为随版本漂移。
- frontmatter 是 Jekyll 时代普及的 YAML 惯例，开放无争议；Obsidian Properties 的类型系统是其 UI 层方言。
- 作者拥有大量存量 Obsidian vault；项目承诺"零迁移成本"，但不继承 Obsidian 的哲学。

含义：兼容对象不是"公开协议"而是"事实方言"。兼容性本体必须是一份自己冻结的 spec + fixture 测试集，而不是边写边猜。

## Decision

1. **兼容范围 = "阅读与导航"语义**：
   - wikilink 解析与跳转：`[[note]]`、`[[note|alias]]`、`[[note#heading]]`；
   - 未创建链接的显示与一键创建；
   - link graph 作为只读派生物，产出 backlinks 面板；
   - frontmatter 解析为 YAML，渲染为 properties 区块；tags 可用于过滤；
   - 附件引用显示：`![[image.png]]` 与标准 `![alt](path)` 的图片渲染。`![[...]]` 指向附件文件时只是文件引用解析，不涉及递归渲染，与内容嵌入（见第 2 条）成本等级完全不同。
2. **明确不做，并公开声明不兼容**：`![[note]]` / `![[note#heading]]` 内容嵌入（transclusion）、`[[note#^block]]` 块引用、Dataview 查询、Canvas、一切插件语义。这些不是"以后再做"，是声明不做（内容嵌入要求递归渲染管线，会把渲染架构拖进嵌套复杂度）。注意 `![[...]]` 语法在 Obsidian 中是复用的：指向附件文件（在范围内）与指向笔记内容（不在范围内）必须按解析结果区分处理。
3. **铁律：Lumir 永不改写源文件格式**。兼容是读取侧的义务，不是写入侧的权利。
4. **兼容性本体 = 冻结的 spec 文档 + fixture 测试集**。fixture 取自作者真实 vault 的子集；该 spec 同时作为 AI agent 的开发指令。
5. **对外措辞**：使用"兼容 Obsidian 方言的阅读与导航语义"，不使用"兼容 Obsidian"（前者可验证，后者是无限责任）。
6. 开源后，这份链接语义 spec 作为独立公共件发布——Obsidian 社区自 2021 年呼吁至今无人提供，它也是本项目方法论实验的第一个展品。

## Consequences

### 正面

- 存量 vault 零迁移即可读、可导航。
- spec + fixture 使兼容性可测试、可归因，且天然适配 AI-only 开发流程。
- "不继承 Obsidian 哲学"的承诺有了可检查的边界。

### 代价与风险

- 需持续跟踪 Obsidian 行为漂移并更新 spec/fixture（低频但长期）。
- 不兼容声明会拒绝依赖 embed/Dataview 的 Obsidian 重度用户——自觉接受。

## Revisit 条件

- Obsidian 官方发布正式链接语义规范 → 重估 spec 对齐策略。
- dogfood 期间发现内容嵌入 / 块引用在作者真实 vault 中高频且刚需 → 仅就此两项重评"不做清单"，其余项不因用户请求开放。
