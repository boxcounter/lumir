## ADDED Requirements

### Requirement: 标题栏 toggle 钮的悬停提示与可访问名

标题栏 harness toggle 钮的悬停提示（`title`）与可访问名（`aria-label`）、以及 harness 面板容器
的可访问名 SHALL 取同一条文案真源（`src/copy-data.ts` 的 D327，规范文本见 `文案-Copy.md` 同行）。
英文档 SHALL 逐字为 `Harness pane`，中文档 SHALL 逐字为 `Harness 面板`；MUST NOT 再出现
`Chat pane` / `Chat panel` / 「对话面板」这类把 harness 能力读成普通聊天框的措辞。

两档语言 MUST 同步成立：切换界面语言后，三处可读身份 SHALL 经既有的 `onRelabel` 路径重绘为
对应语言，MUST NOT 只改一档或停在构造期取值。

有活动状态时沿用既有口径：悬停提示在**同一句**之后追加状态词（分隔符与状态词文案见
`harness-activity` 的既有条目），MUST NOT 为有态另写一句、也 MUST NOT 让状态重绘把悬停提示
覆盖成无状态的纯文案；空闲态悬停提示 SHALL 逐字等于该文案真源。

#### Scenario: 英文档的悬停提示与可访问名

- **WHEN** 界面语言为 en，harness pane 收起（空闲态）
- **THEN** toggle 钮的 `title` 与 `aria-label` 均为 `Harness pane`，面板容器（打开后）的
  `aria-label` 同为 `Harness pane`；三处 MUST NOT 出现 `Chat pane`

#### Scenario: 中文档的悬停提示与可访问名

- **WHEN** 界面语言为 zh，harness pane 收起（空闲态）
- **THEN** toggle 钮的 `title` 与 `aria-label` 均为 `Harness 面板`，面板容器的 `aria-label`
  同为 `Harness 面板`；三处 MUST NOT 出现「对话面板」或 `Chat panel`

#### Scenario: 有活动状态时追加状态词

- **WHEN** harness 处于处理中 / 有未读回复 / 有失败结果 / 等待批准，且界面语言为 en 或 zh
- **THEN** 悬停提示为「`Harness pane` · 状态词」/「`Harness 面板` · 状态词」的既有格式，
  状态词取 `harness-activity` 的既有文案条目；状态结束回到空闲后，悬停提示回到纯文案真源

#### Scenario: 语言切换后重绘

- **WHEN** 运行期在 zh 与 en 之间切换界面语言
- **THEN** toggle 钮与面板的可访问名立即变为新语言档的同一句话，MUST NOT 需要重启或重新打开面板
