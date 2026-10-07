# harness Specification Delta

## ADDED Requirements

### Requirement: 消息呈现

transcript 中的用户与 agent 消息 SHALL 带角色 + 相对时间 meta 行（如「你 · 12 秒前 / Agent · 刚刚」）：角色名与相对时间同行，视觉上降档于消息正文（micro 字号、三级文字色）。用户消息 SHALL 以描边气泡呈现（内容底色 + 柔和边框 + 圆角），正文色降一档以区分于 agent 消息；agent 消息 SHALL 平铺排版（无气泡）。相对时间 SHALL 按「刚刚 / N 秒前 / N 分钟前 / N 小时前 / 昨天」分档并随时间低频刷新与随语言切换重绘。快照恢复的历史消息 SHALL 以后端时间戳（`PanelMessage.ts`）显示真实相对时间；无时间戳的旧快照 SHALL 只显示角色、SHALL NOT 伪造相对时间。

#### Scenario: 新消息带 meta 行

- **WHEN** 发送一条提问并收到 agent 回答
- **THEN** 两条消息都带角色 + 相对时间 meta 行（用户消息在描边气泡内，agent 消息平铺）；相对时间初始落在「刚刚 / N 秒前」档

#### Scenario: 恢复消息按后端时间戳显示

- **WHEN** webview 重载或 pane 恢复后从快照重建 transcript
- **THEN** 携带后端 `ts` 的恢复消息按该戳显示相对时间；缺 `ts` 的旧快照消息只显示角色、不显示相对时间（不伪造）

#### Scenario: 语言切换重绘

- **WHEN** 界面语言切换（zh ↔ en）
- **THEN** 角色名与相对时间随 `onRelabel` 重绘为对应语言

### Requirement: 错误呈现

transcript 中的错误行 SHALL 同文案去重：新错误的文案与当前最后一条错误行逐字相同时 SHALL 就地替换该条（更新原行并滚到可见），SHALL NOT 追加堆叠；不同文案的错误照常追加。

#### Scenario: 同一错误不堆叠

- **WHEN** 同一原因的错误连续发生多次（如后端尚未就绪时反复触发同一失败）
- **THEN** transcript 中该文案的错误行始终只有一条，不发生追加堆叠

### Requirement: 浮层可访问性

harness 的浮层（模型 chip 的 provider 浮层、标题栏 harness 段的会话浮层）SHALL 对辅助技术可达：浮层 MUST NOT 嵌在 `<button>` 元素内（WKWebView 将嵌套按钮当叶子、不暴露其内容）；浮层 SHALL 以 `role="menu"` 及菜单项角色（provider 项 `menuitemradio` + `aria-checked`）呈现，触发钮 SHALL 带 `aria-haspopup="menu"` 与随开合翻转的 `aria-expanded`。浮层打开时 Escape SHALL 先收浮层，无浮层打开时 Escape 才收面板。

#### Scenario: 浮层项读屏可达

- **WHEN** 打开模型 chip 的 provider 浮层或会话名浮层
- **THEN** 浮层项在 WKWebView 的 AX 树中逐个暴露（可经辅助技术定位并激活）

#### Scenario: Escape 分层

- **WHEN** 任一浮层打开时按 Escape
- **THEN** 只收起浮层，面板保持打开；浮层全关时再按 Escape 才收起面板

### Requirement: 工具调用呈现

工具调用 SHALL 以步骤清单形态呈现于当前 agent 消息内（hairline 夹区、独立于消息正文）：运行中的调用 SHALL 显示运行中行（脉冲指示 + 调用名），完成的调用 SHALL 翻为完成行（✓ 图标 + 结果摘要）；同一轮次的多次调用 SHALL 累积为有序多行清单。轮次结束后，含两行及以上的清单 SHALL 折叠为一行摘要（「N 个工具调用 · 全部完成」），摘要 SHALL 可点击展开回看全部步骤行；单行清单 SHALL 保持展开。快照恢复的历史轮次 SHALL 按同口径重建清单与折叠态。

#### Scenario: 进行中清单

- **WHEN** agent 轮次中发生工具调用（started → done）
- **THEN** 当前 agent 消息内出现步骤行：started 时为运行中行（脉冲指示），done 时该行翻为完成行（✓ + 结果摘要）；多次调用按到达次序逐行累积

#### Scenario: 完成后折叠与回看

- **WHEN** 一轮含两次及以上工具调用的轮次结束
- **THEN** 清单折叠为一行摘要（含调用数）；点击摘要展开回看全部步骤行，再点收回

#### Scenario: 单行不折叠

- **WHEN** 一轮只含一次工具调用的轮次结束
- **THEN** 该步骤行保持展开可见，不出现摘要行

## MODIFIED Requirements

### Requirement: 对话面板

系统 SHALL 提供对话面板，位于**旁侧 pane**（pane 容器的内容件，见 `pane-layout` 的「harness pane」；不再位于骨架右栏 dock 列——dock 列随 `move-harness-to-pane-chat-frame` 移除），可经 `harness.toggle` 命令（⌘⇧A）与标题栏 toggle 钮唤起与收起。面板 SHALL 支持多轮对话并以流式增量呈现模型输出；模型输出 SHALL 按 Markdown 渲染（GFM 基本面含代码块高亮），一切模型输出 MUST 经转义后注入（零 HTML 直插）。全部可见文案 SHALL 走文案表（zh/en 双档），样式 SHALL 只消费 token 层取值。流式渲染与网络处理 MUST NOT 进入编辑器 keypress-to-paint 路径（ADR 0002 §6）。

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
