# editor-live-preview Specification

## Purpose

定义编辑器单内核双模式（ADR 0002 §2）的落地口径：md 模式 = 高亮 + live preview 装饰层、code 模式 = 仅高亮、按文件类型选模式、配置 `editor.mode` 仅作无类型线索时的默认；装饰层视口增量构建以满足打开 1MB <100ms 性能合同（ADR 0002 §6）。M1 只读口径，不含编辑态行为。由 change `add-editor-live-preview` 归档并入（2026-09-05，实现 M19 + M20 接线；真实打开路径 perf 端点的演进义务见 perf-measurement spec）。

## Requirements

### Requirement: 单内核双模式落地

编辑器 SHALL 保持单一 CM6 内核、两种模式（ADR 0002 §2）：md 模式 = 语法高亮 + live preview 装饰层；code 模式 = 仅语法高亮。模式切换 SHALL 经既有 Compartment 热切换完成，MUST NOT 重建 EditorView、MUST NOT 丢失文档状态。打开文件时 SHALL 按文件类型选择模式：Markdown 文件用 md 模式，代码文件用 code 模式；初始模式由配置 `editor.mode` 决定（既有接线保留）。M1 编辑器为只读（M1 出口为只读浏览），本 change MUST NOT 引入编辑能力。

#### Scenario: 按文件类型选模式

- **WHEN** 用户在文件树点击一个 `.rs` 文件后又点击一个 `.md` 文件
- **THEN** 前者以 code 模式（仅高亮）打开，后者以 md 模式（高亮 + 装饰层）打开，切换不重建编辑器视图

### Requirement: live preview 装饰层

md 模式下系统 SHALL 用 CM6 decoration 实现 live preview：标题按级别呈现字号/字重、加粗/斜体/删除线隐藏标记符并渲染字形、列表符号美化、引用块样式、行内代码与代码块背景。装饰层 SHALL 采用视口增量构建（⚠ 裁决点 D，推荐项：只为可见区域构建 decoration，滚动时增量更新），MUST NOT 在打开文档时全量构建——打开 1MB Markdown <100ms 是 CI 绝对阈值（ADR 0002 §6）。该视口增量义务不含 frontmatter properties 区块——跨行 replace 装饰受 CM6 视口插件硬限制，其构建策略见 frontmatter-properties spec（StateField + 文档变更时重算 + 首部扫描有界）。只读口径下 MUST NOT 实现光标所在行 reveal 源码的编辑态逻辑（无编辑即无此概念，推迟到有编辑能力的波次）。装饰 MUST NOT 改变文档源码（ADR 0003 §3 铁律，本 change 只读，天然满足）。

#### Scenario: 标记符隐藏

- **WHEN** md 模式打开含 `**加粗**` 与 `# 标题` 的文档
- **THEN** 加粗文本以粗体呈现且不显示 `**`，标题按级别样式呈现

#### Scenario: 大文件视口增量

- **WHEN** 打开 1MB Markdown 文件
- **THEN** 只为可见区域构建 decoration，打开路径不超性能合同阈值；滚动到任意位置时该区域装饰即时生效

### Requirement: 模式配置来源

初始编辑器模式 SHALL 来自配置 `editor.mode`（config.rs 既有字段，ts-rs 导出）；文件类型对模式的选择 SHALL 优先于配置默认值作用于每次打开（配置决定无文件类型线索时的默认，如新建/空态）。

#### Scenario: 配置默认与文件类型优先

- **WHEN** `editor.mode = code` 且用户打开 `.md` 文件
- **THEN** 该文件仍以 md 模式打开；配置值仅作为无类型线索时的默认
