# Project context

## 项目

Lumir：把 agent 当作可见协作者的文本工作台（定位见 ADR 0001）。技术路线 Tauri（Rust core + 系统 webview）+ CodeMirror 6 单内核编辑器（ADR 0002）。开发模式为 AI-only：AI agent 起草与实现一切制品，Alex 做需求裁决者与 ADR/spec reviewer，不写代码、不 review 代码（ADR 0004）。

## 制品读者

所有 OpenSpec 制品有两类读者：

1. **Alex（评审/裁决）**：不看代码，只凭制品判断"功能做什么、做不做"。proposal 必须让 Alex 不看实现也能裁决。
2. **AI agent（起草/实现）**：按本目录约定与 docs/process/openspec-workflow.md 的流程操作。

## 与 ADR 的边界

- 功能变更（新能力、行为修改）→ OpenSpec change。
- 跨切面架构决策（技术选型、职责分层、架构约束）→ ADR。
- 拿不准归属时：变更只影响一个 capability 的行为，走 OpenSpec；影响多个 capability 的结构关系或推翻既有技术选型，走 ADR。

## 关键约束（起草制品时不得违背）

- 性能合同（ADR 0002 第 6 条）：冷启动 <300ms、keypress-to-paint <16ms、打开 1MB Markdown <100ms、常驻内存 <200MB。任何 spec 不得隐含突破这些阈值的行为。
- Lumir 永不改写源文件格式（ADR 0003 第 3 条铁律）。
- 非目标（ADR 0001 第 3 条）：IDE 能力、团队实时协同、移动端、插件市场。
- 配置即数据，带 schema 校验（ADR 0002 第 5 条）。
