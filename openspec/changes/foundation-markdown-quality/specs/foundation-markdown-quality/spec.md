# foundation-markdown-quality Specification

## ADDED Requirements

### Requirement: 首帧与资源稳定帧

打开 Markdown 文件时，系统 SHALL 在真实 Tauri/WKWebView 中以正确路径绑定文档，并在可见基础 decoration 与 frontmatter ready 后完成一次 `requestAnimationFrame` paint，形成 F0 首帧。系统 MUST NOT 以新文件朴素源码闪现、错误路径旧文档或仅 IO/解码完成作为 F0。图片、wikilink 等异步资源 SHALL 以独立 F1 端点在成功、失败或明确降级后 settle，MUST NOT 无限 pending 或阻塞 F0。

#### Scenario: 打开文件直接进入最终基础阅读帧

- **WHEN** 用户点击文件树中的 Markdown 文件
- **THEN** F0 记录与点击一致的路径和文档身份，首个可见区域显示基础 Markdown decoration，frontmatter（若存在）已就绪，并在随后一次 `requestAnimationFrame` 完成 paint；用户看不到新文件的朴素源码或旧文档冒充

#### Scenario: 资源失败不阻塞首帧

- **WHEN** 文档含图片或 wikilink 且资源加载失败或目标不存在
- **THEN** F0 仍可完成，F1 在有界时间内显示失败占位、链接或可读源码降级，不保持无限 loading

### Requirement: 常见 Markdown 组合与源码保护

系统 SHALL 完整验收 P0 的 heading、list、quote、code、table、link，以及列表内 strong、em、strike、inline code、link；并按 Foundation 顺序覆盖 P1 wikilink/frontmatter/tags/callout 与 P1.5 embed/image。P2 dataview/canvas/math/mermaid SHALL 标为延后实现或兼容性裁决，不得冒充已支持。阅读、选择、复制和 decoration MUST 保持原始 Markdown 文本、换行、编号、任务标记、表格槽位、对齐冒号、转义 pipe 与链接目标不变。

#### Scenario: 组合语法保持源码语义

- **WHEN** 用户打开含嵌套任务列表、列表内行内样式、引用、代码、矩形表格、链接和 frontmatter 的合成 fixture，并全选复制
- **THEN** 视觉呈现覆盖基础组合，复制结果与 fixture 原始 Markdown 字节语义一致，不输出 HTML、TSV 或重新编号内容

### Requirement: 编辑保存与失败保护

编辑态 SHALL 支持 Markdown 正文输入、中文 IME、undo/redo、dirty 状态、保存与重开内容校验。保存失败 MUST 保留 dirty 内容、提示失败并允许重试或另存。检测到外部版本变化时 MUST 暂停不安全保存，保留本地与外部内容并提供差异查看或手动协调；切换文件或退出 MUST NOT 静默丢弃未保存内容。本 requirement 不包含可视表格单元格编辑、IDE、插件平台或 Agent 写入。

#### Scenario: 保存失败和冲突不丢内容

- **WHEN** 用户修改 Markdown 后保存遇到 IO 失败，或文件在编辑期间被外部修改
- **THEN** dirty 内容仍可见且可重试；冲突路径不静默覆盖任一版本，并提供差异或手动协调入口

### Requirement: 可访问性与性能证据边界

系统 SHALL 让键盘到达文件树、编辑器、链接、宽表横向滚动区和失败状态；宽表滚动区 SHALL 可聚焦、有可访问名称、可用键盘与触控板到达最右列，并表达表头—行—单元格关系。性能 SHALL 分开报告真实 F0/F1、现有 IO 子指标和 headless keypress 近似。IO 子指标与 keypress 近似 MUST NOT 被宣称为真实打开或 WKWebView 按键达标；Foundation MUST NOT 擅自新增绝对阈值，预算须由独立裁决节点确定。

#### Scenario: 宽表与性能证据可达

- **WHEN** 用户用键盘或触控板浏览超出正文宽度的表格，并查看一次性能报告
- **THEN** 用户可聚焦滚动容器并访问最右列；报告同时列出 F0/F1 真实端点与 IO/keypress 辅助读数及其边界，不用旧占位值宣布产品达标

### Requirement: 匿名分层 fixture 与验收矩阵

Foundation fixture SHALL 使用确定性匿名合成内容，分为 tiny（≤4 KiB）、small（>4–16 KiB）、medium（>16–64 KiB）、large（>64–256 KiB），并携带大小、覆盖、资源状态和预期端点 manifest。small SHALL 作为当前计划优先级假设，并须由后续匿名 fixture 验证；M77 完整统计不作为仓库制品。fixture MUST NOT 包含真实 vault 原文、标题、路径、实体、标签、URL 或可逆识别片段。验收矩阵 SHALL 区分必须项、延后项与测量边界，并覆盖真实渲染、源码复制、文件字节/版本、AX 语义和性能端点。

#### Scenario: 分层合成 fixture 可复验

- **WHEN** 验收运行四层 fixture
- **THEN** 每层字节范围和 manifest 可复核，small 覆盖日常组合，medium/large 覆盖滚动和压力，所有内容均为匿名合成且不得引用真实 vault
