# harness 增量规格

> 起草注记（非规格正文）：本 change 修 Alex 2026-10-12 dogfood 反馈的两条渲染缺陷——面板里的
> 裸 URL 不上屏（表格里最明显，实际任何位置的裸 URL 都隐身）、会话恢复后的消息不显示时间。
> 两条都只动**呈现层**：模型输出照旧、wire 请求体照旧、会话留存结构照旧。判定依据与归属走查
> 见 [design.md](../../design.md)。

## MODIFIED Requirements

### Requirement: 对话面板

系统 SHALL 提供对话面板，位于**旁侧 pane**（pane 容器的内容件，见 `pane-layout` 的「harness pane」；不再位于骨架右栏 dock 列——dock 列随 `move-harness-to-pane-chat-frame` 移除），可经 `harness.toggle` 命令（⌘⇧A）与标题栏 toggle 钮唤起与收起。面板 SHALL 支持多轮对话并以流式增量呈现模型输出；模型输出 SHALL 按 Markdown 渲染（GFM 基本面含代码块高亮），一切模型输出 MUST 经转义后注入（零 HTML 直插）。全部可见文案 SHALL 走文案表（zh/en 双档），样式 SHALL 只消费 token 层取值。流式渲染与网络处理 MUST NOT 进入编辑器 keypress-to-paint 路径（ADR 0002 §6）。

模型输出里的链接 SHALL 上屏为可点锚元素：`[文字](url)` 按显示文本呈现、`<url>` 自动链接按 URL 呈现，**裸 URL**（GFM 直接产 `URL` 节点的三种形态：`https://…`、无 scheme 的 `www.…`、邮箱字面量）SHALL 以 URL 原文为上屏文本渲染为同一形态的锚——**MUST NOT 整段跳过**（跳过 = URL 在面板里隐身；表格 cell 里的裸 URL 同样在列）。锚的 `href` 只作展示与 `title`，一切点击 SHALL 被拦下交给既有的外链打开命令（scheme 白名单在 Rust 侧判定，前端 MUST NOT 自行判定能不能开）；`[文字](url)` 的 URL 部分 MUST NOT 作为可见文本二次上屏。代码块与行内代码里的 URL SHALL 保持代码原文（不产锚）。

composer（输入区）与控制行 SHALL 收进同一个圆角卡片容器（内容底色 + 边框 + focus-within 强调框）；控制行位于容器底部，自左向右为模型 chip、ctx 读数、弹性间隔、发送钮。发送钮 SHALL 为图标钮（↑ / ■ 两态 glyph），配色 SHALL 按原型中性实心取值（浅色深灰近黑 + 白 glyph、深色浅灰 + 深 glyph、eink 纯黑，经组件级变量落账，不改全局 accent 一族）；处理中（busy）态 SHALL 显示脉冲环（box-shadow 呼吸动画，环色为与按钮同族的中性 tint；eink 下环不可见、状态由 glyph 承担；prefers-reduced-motion 下不脉冲）。其可读名称与悬停提示 SHALL 沿用文案表两态文案（发送 / 停止），行为口径（Enter 发送、处理中点击停止、stopping 幂等）不变。

#### Scenario: 唤起与流式对话

- **WHEN** 面板经命令唤起并发送一条提问
- **THEN** 面板出现在旁侧 pane（无第二 pane 时自动分栏，默认宽度比 harness:文档 pane = 1:2）；模型输出以增量方式逐段呈现并按 Markdown 渲染；期间编辑器键入响应不受影响

#### Scenario: composer 容器形态

- **WHEN** 面板打开且输入区获得焦点
- **THEN** 输入区与控制行在同一个圆角卡片容器内，容器呈 focus-within 强调框；发送钮为图标钮且读屏名为「发送」（处理中为「停止」）

#### Scenario: 文案与 token 纪律

- **WHEN** 界面语言切换（zh ↔ en）
- **THEN** 面板全部长驻文案经 `onRelabel` 重绘为对应语言；面板样式全部取值自 token 层

#### Scenario: 裸 URL 上屏为链接

- **WHEN** 模型输出的正文（含表格 cell 内）出现裸 URL（`https://…`、`www.…`、邮箱字面量）
- **THEN** 该 URL 以原文为上屏文本渲染为可点锚元素（与 `[文字](url)` 同一个样式与同一个打开入口），MUST NOT 在面板里缺席；点击把 URL 原文交给外链打开命令（能不能开由后端 scheme 白名单判定），导航被拦下

#### Scenario: 标准链接的 URL 不二次上屏

- **WHEN** 模型输出的正文出现 `[文字](https://…)`
- **THEN** 面板显示的链接文本是「文字」，URL 部分只作为锚的 `href` 与悬停提示，MUST NOT 作为可见文本再上屏一次

### Requirement: 消息呈现

transcript 中的用户与 agent 消息 SHALL 带角色 + 时间读数 meta 行（如「你 · 12 秒前 / Agent · 刚刚」）：角色名与时间读数同行，视觉上降档于消息正文（micro 字号、三级文字色）。用户消息 SHALL 以描边气泡呈现（内容底色 + 柔和边框 + 圆角），正文色降一档以区分于 agent 消息；agent 消息 SHALL 平铺排版（无气泡）。读数形态 SHALL 按数据来源分两档：**live**（本轮上屏打戳的消息）按「刚刚 / N 秒前 / N 分钟前 / N 小时前 / 昨天」分档；**restored**（快照恢复与会话恢复重放的消息，时间读数来自留存）按「同日窄相对 / 跨天短日期」呈现——留存在盘上，读数可以跨天甚至跨周，「昨天」对更老的消息是错读数。两档 SHALL 随时间低频刷新与随语言切换重绘（形态随消息携带、重绘不重算）。快照 / 恢复重建的消息 SHALL 以后端时间戳（`PanelMessage.ts`）显示真实读数；**会话恢复的 ts SHALL 来自留存记录的信封**（wire 项自身不带时间戳，按项在记录序里的产出时刻归属，见 design §3）；无时间戳可归的消息 SHALL 只显示角色、SHALL NOT 伪造读数。快照消息面 SHALL 保真：正文为空的 assistant 轮（模型只发工具调用、无正文）MUST NOT 落成面板记录——快照恢复 MUST NOT 出现只有角色 meta 行、正文为空的「空气泡」；工具记录（`role: tool`）SHALL 持久化摘要（`PanelMessage.summary`），成功为调用参数摘要、失败含细分状态与错误码，使 webview 重载后工具行仍有信息。

#### Scenario: 新消息带 meta 行

- **WHEN** 发送一条提问并收到 agent 回答
- **THEN** 两条消息都带角色 + 时间读数 meta 行（用户消息在描边气泡内，agent 消息平铺）；读数初始落在「刚刚 / N 秒前」档

#### Scenario: 恢复消息按后端时间戳显示

- **WHEN** webview 重载或 pane 恢复后从快照重建 transcript，或从会话浮层恢复历史会话后重放 transcript
- **THEN** 携带 `ts` 的恢复消息按该戳显示时间读数（同日给窄相对、跨天给短日期）；缺 `ts` 的消息只显示角色、不显示时间读数（不伪造）

#### Scenario: 工具轮快照保真

- **WHEN** 模型某轮只返回工具调用、无正文文本，随后 webview 重载从快照恢复
- **THEN** transcript 不出现只有角色 meta 行、正文为空的 agent 消息；工具行仍显示调用参数摘要（调用失败时显示细分状态与错误码）

#### Scenario: 语言切换重绘

- **WHEN** 界面语言切换（zh ↔ en）
- **THEN** 角色名与时间读数随 `onRelabel` 重绘为对应语言；恢复消息的读数形态保持 restored（不因重绘回落到 live 档）

#### Scenario: 会话恢复的消息带留存时间

- **WHEN** 从会话浮层选择一个历史会话恢复（源会话留存在盘上，可能已跨天）
- **THEN** 重放出的每条消息的 meta 行都带该消息在源会话里的时间读数（用户消息 = 它所属请求的发送时刻，助手回复 = 产出它的那次响应时刻）；跨天的消息显示短日期而不是「昨天」；源记录缺 `ts` 时该消息不显示时间读数
