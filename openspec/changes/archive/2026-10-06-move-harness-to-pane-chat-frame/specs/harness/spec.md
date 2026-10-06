# harness Specification Delta

## ADDED Requirements

### Requirement: 模型选择

composer 控制行 SHALL 提供模型选择 chip：列出 `[harness].providers` 已配置的 provider（闭集合 `kimi` / `deepseek` / `mock`），选择即切换当前 provider 并经运行期写回通道持久化（`config_set_value` 泛化口径，与 `[ui]` 写回同路）；切换对下一轮生效，MUST NOT 打断进行中的轮次。chip 文本过长 SHALL 截断（ellipsis），完整名称在 hover 呈现。配置缺失或非法时 chip SHALL 回落到默认 provider 且不报错（沿用 `[harness]` 配置节的回落纪律）。

#### Scenario: 切换 provider 并写回

- **WHEN** 配置里 `kimi` 与 `deepseek` 两个 provider 均已配置，在控制行模型 chip 里从 `kimi` 切到 `deepseek`
- **THEN** 下一轮对话走 `deepseek`；`config.json` 的 `[harness].provider` 被写回为新值，重启后保持

#### Scenario: 进行中的轮次不受影响

- **WHEN** 一轮对话正在流式输出时切换模型 chip
- **THEN** 当前轮次按原 provider 跑完；切换自下一轮生效

### Requirement: 发送与停止

发送钮 SHALL 有两态：空闲态（可发送）与处理中态（模型生成或工具循环进行中）。处理中态下发送钮 SHALL 呈现为停止钮，点击 SHALL 中断本轮：停止流式输出与工具循环，已产出的内容保留在 transcript 并标注「已停止」，待决批准项 SHALL 随中断收回，JSONL SHALL 如实记录中断事件。停止后输入区 SHALL 立即可继续提问（新消息开启新一轮）。

#### Scenario: 停止中断工具循环

- **WHEN** 一轮对话处于工具循环进行中（已流式产出部分内容），点击停止钮
- **THEN** 不再产生后续工具调用与生成；已产出内容保留并标注「已停止」；JSONL 记录一条中断事件

#### Scenario: 停止后继续提问

- **WHEN** 一轮被停止后，立即输入新消息并发送
- **THEN** 新消息作为新一轮正常处理，会话上下文保留（含被停止轮的已产出部分）

### Requirement: 复制消息

transcript 中的消息（用户 / agent）SHALL 在 hover 时浮现复制钮，点击 SHALL 把该消息的 Markdown 源文本写入系统剪贴板（agent 消息 = 模型原始输出，用户消息 = 发送前的原始输入，MUST NOT 复制渲染后 HTML）；复制成功 SHALL 就地给出短时反馈（已复制态，自动消退）。

#### Scenario: 复制 agent 消息

- **WHEN** hover 一条 agent 消息并点击复制钮
- **THEN** 系统剪贴板内容为该消息的 Markdown 源文本；复制钮就地呈已复制反馈并短时消退

### Requirement: 进度呈现

工具循环进行中，面板 SHALL 呈现**不定态**进度指示与阶段指示（当前动作一行，如正在读取哪些文件 / 调用哪个工具）；SHALL NOT 呈现百分比进度（总时长运行前不可知，百分比在技术上是伪造）。工具调用完成 SHALL 即折叠为一行摘要（既有口径不变）。eink 主题下进度指示 SHALL 以明度 / 线宽表达，不引入彩色。

#### Scenario: 进行中呈现不定态与阶段

- **WHEN** 一轮对话进入工具循环（如先读文件再搜索）
- **THEN** 面板显示不定态进度条与当前阶段行；任何时刻不出现百分比读数

#### Scenario: 完成即折叠

- **WHEN** 某个工具调用完成
- **THEN** 该调用在 transcript 中折叠为一行摘要（工具名 + 结果概要），过程细节不再占位

## MODIFIED Requirements

### Requirement: 对话面板

系统 SHALL 提供对话面板，位于**旁侧 pane**（pane 容器的内容件，见 `pane-layout` 的「harness pane」；不再位于骨架右栏 dock 列——dock 列随本 change 移除），可经 `harness.toggle` 命令（⌘⇧A）与标题栏 toggle 钮唤起与收起。面板 SHALL 支持多轮对话并以流式增量呈现模型输出；模型输出 SHALL 按 Markdown 渲染（GFM 基本面含代码块高亮），一切模型输出 MUST 经转义后注入（零 HTML 直插）。全部可见文案 SHALL 走文案表（zh/en 双档），样式 SHALL 只消费 token 层取值。流式渲染与网络处理 MUST NOT 进入编辑器 keypress-to-paint 路径（ADR 0002 §6）。

#### Scenario: 唤起与流式对话

- **WHEN** 面板经命令唤起并发送一条提问
- **THEN** 面板出现在旁侧 pane（无第二 pane 时自动分栏，默认宽度比 harness:文档 pane = 1:2）；模型输出以增量方式逐段呈现并按 Markdown 渲染；期间编辑器键入响应不受影响

#### Scenario: 文案与 token 纪律

- **WHEN** 界面语言切换（zh ↔ en）
- **THEN** 面板全部长驻文案经 `onRelabel` 重绘为对应语言；面板样式全部取值自 token 层

### Requirement: 上下文用量显示与触顶处理

composer 控制行 SHALL 常驻显示上下文用量读数（位于模型 chip 之后、发送钮之前）：context window 已用 %（最近一次请求的 input tokens ÷ 模型上下文窗口）与 cache hit %（Responses 形态下两 provider 统一走 `usage.input_tokens_details.cached_tokens`；映射表留在 provider 预设内防字段方言）。用量超过警示阈值（默认 85%，可配）时读数 SHALL 高亮并附带 ⓘ 钮，点击 ⓘ SHALL 展开说明气泡（向上展开、右缘对齐读数右缘）；SHALL NOT 常驻显示警示句。系统 SHALL 默认自动压缩（`auto_compact = true`）：每轮响应完成后检查，越阈值即自动把会话历史压缩为摘要、开新逻辑会话并注入摘要 + 当前编辑器上下文 + 系统上下文；自动压缩 MUST NOT 静默——面板插入可见压缩标记（摘要可展开），JSONL 完整留存压缩前历史。API 返回上下文超限错误时 SHALL 自动压缩后重试该轮一次。系统 MUST NOT 静默截断会话历史。

#### Scenario: 用量显示

- **WHEN** 完成一轮对话（含 mock provider 给出的 usage 数值）
- **THEN** 控制行读数显示与 usage 字段一致的 ctx% 与 cache hit%；读数位于模型 chip 与发送钮之间

#### Scenario: 超阈值警示收敛为 ⓘ 气泡

- **WHEN** ctx% 越过警示阈值
- **THEN** 读数高亮并出现 ⓘ 钮；点击 ⓘ 展开说明气泡；无气泡展开时界面不出现任何警示句

#### Scenario: 自动压缩

- **WHEN** 一轮响应完成后 ctx% 越过警示阈值
- **THEN** 系统自动生成会话摘要并开新逻辑会话；面板出现可见的压缩标记，摘要可展开查看；后续对话在新会话上继续

#### Scenario: 超限兜底

- **WHEN** API 返回上下文超限错误
- **THEN** 系统自动压缩并重试该轮一次；仍失败才向面板报错

### Requirement: 会话边界

会话 SHALL 绑定 vault：一个 vault 一个会话（内存态）。切 vault SHALL 切到该 vault 的会话，切回时恢复；关闭 vault 丢弃其会话；app 重启清空全部会话。标题栏 harness 段 SHALL 提供「新会话」动作（面板在场时）：清空当前 vault 会话的消息历史并重新装配系统上下文（AGENTS.md / Skill 索引不变），JSONL 留存不受影响。harness 段 SHALL 显示会话名——取首条用户消息截断（约 20 字），未发消息时显示「新会话」。探针期 SHALL NOT 提供多会话管理与历史回看（会话浮层不列历史会话）。

#### Scenario: 切 vault 切会话

- **WHEN** 在 vault A 有进行中的会话，切到 vault B 再切回
- **THEN** B 呈现其自身会话（或空会话），工具与上下文注入均解析到 B；切回 A 时 A 的会话原样恢复

#### Scenario: 新会话重置

- **WHEN** 在一段关于旧话题的对话后点击标题栏 harness 段的「新会话」
- **THEN** 消息历史清空、系统上下文重新装配，随后提问不受旧话题影响；配置目录 JSONL 中旧会话记录完整保留
