# editor-live-preview Specification

## Purpose

定义编辑器单内核双模式（ADR 0002 §2）的落地口径：md 模式 = 高亮 + live preview 装饰层、code 模式 = 仅高亮、按文件类型选模式、配置 `editor.mode` 仅作无类型线索时的默认；装饰层视口增量构建以满足打开 1MB <100ms 性能合同（ADR 0002 §6）。M1 只读口径，不含编辑态行为。由 change `add-editor-live-preview` 归档并入（2026-09-05，实现 M19 + M20 接线；真实打开路径 perf 端点的演进义务见 perf-measurement spec）。

## Requirements

### Requirement: 单内核双模式落地

编辑器 SHALL 保持单一 CM6 内核、两种模式（ADR 0002 §2）：md 模式 = 语法高亮 + live preview 装饰层；code 模式 = 仅语法高亮。模式切换 SHALL 经既有 Compartment 热切换完成，MUST NOT 重建 EditorView、MUST NOT 丢失文档状态。打开文件时 SHALL 按扩展名注册表（`src/preview/attachments.ts` 的单一事实源）选择模式：`.md`/`.markdown` 用 md 模式；**其余一切已打开的文件一律用只读 code 模式**（含未收录扩展、dotfile 与 basename 无点的文件）——有语言包则高亮、无则纯文本；只有没有文件上下文（path 缺失）的文档才回落配置 `editor.mode`。md 模式之外编辑器 MUST NOT 可编辑（`editable(false)` + `readOnly(true)` 的视图层只读合同）。初始模式由配置 `editor.mode` 决定（既有接线保留）。

#### Scenario: 按文件类型选模式

- **WHEN** 用户在文件树点击一个 `.rs` 文件后又点击一个 `.md` 文件
- **THEN** 前者以 code 模式（仅高亮）打开，后者以 md 模式（高亮 + 装饰层）打开，切换不重建编辑器视图

#### Scenario: 非 md 文本文件只读打开

- **WHEN** 用户在配置 `editor.mode = md`（出厂值）下点击一个 `.php`、`.svelte`、`.txt`、未知扩展文件，或 `LICENSE`/`Makefile` 这类 basename 无点的文件
- **THEN** 该文件以只读 code 模式打开：视图层不可编辑（`contenteditable` 摘除、`aria-readonly`），输入被拒收，不产生 dirty，后续 Cmd+S 不进入保存链路

### Requirement: live preview 装饰层

md 模式下系统 SHALL 用 CM6 decoration 实现 live preview：标题按级别呈现字号/字重、加粗/斜体/删除线隐藏标记符并渲染字形、列表符号美化、引用块样式、行内代码与代码块背景。装饰层 SHALL 采用视口增量构建（⚠ 裁决点 D，推荐项：只为可见区域构建 decoration，滚动时增量更新），MUST NOT 在打开文档时全量构建——打开 1MB Markdown <100ms 是 CI 绝对阈值（ADR 0002 §6）。该视口增量义务不含 frontmatter properties 区块——跨行 replace 装饰受 CM6 视口插件硬限制，其构建策略见 frontmatter-properties spec（StateField + 文档变更时重算 + 首部扫描有界）。只读口径下 MUST NOT 实现光标所在行 reveal 源码的编辑态逻辑（无编辑即无此概念，推迟到有编辑能力的波次）。装饰 MUST NOT 改变文档源码（ADR 0003 §3 铁律，本 change 只读，天然满足）。

#### Scenario: 标记符隐藏

- **WHEN** md 模式打开含 `**加粗**` 与 `# 标题` 的文档
- **THEN** 加粗文本以粗体呈现且不显示 `**`，标题按级别样式呈现

#### Scenario: 大文件视口增量

- **WHEN** 打开 1MB Markdown 文件
- **THEN** 只为可见区域构建 decoration，打开路径不超性能合同阈值；滚动到任意位置时该区域装饰即时生效

### Requirement: 模式配置来源

初始编辑器模式 SHALL 来自配置 `editor.mode`（config.rs 既有字段，ts-rs 导出）；该配置 SHALL 只作用于没有文件上下文的文档（空态 / 新建 / reset）。打开文件时的模式 SHALL 由扩展名注册表唯一裁决：`.md`/`.markdown` → md 模式；其余一切已打开的文件（含未收录扩展、dotfile 与 basename 无点的文件）→ 只读 code 模式，**MUST NOT 回落 `editor.mode`**。该裁决 MUST NOT 随 `editor.mode` 的取值漂移：把配置在 `md` 与 `code` 之间切换不改变任何已打开文件的模式。

#### Scenario: 配置默认与文件类型优先

- **WHEN** `editor.mode = code` 且用户打开 `.md` 文件
- **THEN** 该文件仍以 md 模式打开（可编辑 + live preview）；配置值只对空态 / 新建文档生效

#### Scenario: 未收录扩展不回落配置默认

- **WHEN** `editor.mode = md` 且用户打开 `.log`、`.csv` 或 `.xyz` 这类未收录扩展的文件
- **THEN** 文件以只读 code 模式打开（无语言包时按纯文本显示原文），MUST NOT 进入可编辑 md 模式，不产生 dirty

#### Scenario: 无扩展名文件一并不回落配置默认

- **WHEN** 用户打开 basename 无点的文件（如 `LICENSE`、`Makefile`）
- **THEN** 文件以只读 code 模式打开，MUST NOT 按 `editor.mode` 进入可编辑模式（M130 评审裁决：D4「非 md 即只读」优先于任务书「ext 缺失保持 fallback」的字面）
