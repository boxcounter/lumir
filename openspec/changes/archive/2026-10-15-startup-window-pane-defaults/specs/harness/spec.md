# harness Specification Delta

> 起草注记（非规格正文）：本 requirement 里「默认宽度比 harness:文档 pane = 1:2」是
> `pane-layout` 的「harness pane」之处定义的默认值的复述，随本 change（Alex 2026-10-10 裁决）
> 一并改值并指向 canonical 定义处；其余正文与场景逐字不动。

## MODIFIED Requirements

### Requirement: 对话面板


系统 SHALL 提供对话面板，位于**旁侧 pane**（pane 容器的内容件，见 `pane-layout` 的「harness pane」；不再位于骨架右栏 dock 列——dock 列随 `move-harness-to-pane-chat-frame` 移除），可经 `harness.toggle` 命令（⌘⇧A）与标题栏 toggle 钮唤起与收起。面板 SHALL 支持多轮对话并以流式增量呈现模型输出；模型输出 SHALL 按 Markdown 渲染（GFM 基本面含代码块高亮），一切模型输出 MUST 经转义后注入（零 HTML 直插）。全部可见文案 SHALL 走文案表（zh/en 双档），样式 SHALL 只消费 token 层取值。流式渲染与网络处理 MUST NOT 进入编辑器 keypress-to-paint 路径（ADR 0002 §6）。

模型输出里的链接 SHALL 上屏为可点锚元素：`[文字](url)` 按显示文本呈现、`<url>` 自动链接按 URL 呈现，**裸 URL**（GFM 直接产 `URL` 节点的三种形态：`https://…`、无 scheme 的 `www.…`、邮箱字面量）SHALL 以 URL 原文为上屏文本渲染为同一形态的锚——**MUST NOT 整段跳过**（跳过 = URL 在面板里隐身；表格 cell 里的裸 URL 同样在列）。锚的 `href` 只作展示与 `title`，一切点击 SHALL 被拦下交给既有的外链打开命令（scheme 白名单在 Rust 侧判定，前端 MUST NOT 自行判定能不能开）；`[文字](url)` 的 URL 部分 MUST NOT 作为可见文本二次上屏。代码块与行内代码里的 URL SHALL 保持代码原文（不产锚）。

composer（输入区）与控制行 SHALL 收进同一个圆角卡片容器（内容底色 + 边框 + focus-within 强调框）；控制行位于容器底部，自左向右为模型 chip、ctx 读数、弹性间隔、发送钮。发送钮 SHALL 为图标钮（↑ / ■ 两态 glyph），配色 SHALL 按原型中性实心取值（浅色深灰近黑 + 白 glyph、深色浅灰 + 深 glyph、eink 纯黑，经组件级变量落账，不改全局 accent 一族）；处理中（busy）态 SHALL 显示脉冲环（box-shadow 呼吸动画，环色为与按钮同族的中性 tint；eink 下环不可见、状态由 glyph 承担；prefers-reduced-motion 下不脉冲）。其可读名称与悬停提示 SHALL 沿用文案表两态文案（发送 / 停止），行为口径（Enter 发送、处理中点击停止、stopping 幂等）不变。

#### Scenario: 唤起与流式对话

- **WHEN** 面板经命令唤起并发送一条提问
- **THEN** 面板出现在旁侧 pane（无第二 pane 时自动分栏，默认宽度比 harness:文档 pane = **1:1**，canonical 定义见 `pane-layout` 的「harness pane」）；模型输出以增量方式逐段呈现并按 Markdown 渲染；期间编辑器键入响应不受影响

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
