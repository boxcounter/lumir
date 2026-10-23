# harness 增量规格

> 起草注记（非规格正文）：本 delta 一条 ADDED、一条 MODIFIED，基线是 living spec
> [openspec/specs/harness/spec.md](../../../../specs/harness/spec.md)。
> ① ADDED「transcript 的跟随滚动与回到底部」= 本 change 的主体（两态判据、浮钮、白名单）；
> ② MODIFIED「错误呈现」= 既有「滚到可见」在脱离态下会重新制造「拽到底部」，按同一几何判据收口，
> 去重行为本身逐字不动。
>
> **MODIFIED 是整块替换**：按 living spec 全文抄录后就地改，MUST NOT 只写改动段（`scripts/
> openspec-archive-check.mjs` 会逐段对账）。
>
> 起草期裁决点（D1–D8）见 [proposal.md](../../proposal.md)；本 delta 按「倾向」列写成，若裁决
> 改侧，按 proposal 的影响面同步改本文件。

## ADDED Requirements

### Requirement: transcript 的跟随滚动与回到底部

harness 面板的 transcript SHALL 区分**跟随态**与**脱离态**。跟随态下，新增内容（流式正文、思考块、
工具行、通知、错误行、批准卡等）到达后视口 SHALL 停留在内容末尾，最新一行 MUST 在视口内；脱离态下，
任何新增内容 MUST NOT 写滚动位——`scrollTop` 的变化 SHALL ≤ 1px，用户正在阅读的那一行 MUST 停在
原处。

两态 SHALL 由**几何位置**判定，MUST NOT 由显式开关、模式或超时判定：视口距内容底部不超过**回底容差**
SHALL 视为在底部（跟随）；用户以任何方式把视口带离底部超过**脱离阈值**后 SHALL 立即进入脱离态——
滚轮 / 触控板、拖动滚动条、以及任何把视口带离底部的动作（含「消息摘录卡」跳回旧消息的滚动定位）
MUST 共用这一条判据，MUST NOT 按输入通道各写一份。视口回到距底 ≤ 回底容差时 SHALL 自动恢复跟随，
MUST NOT 要求用户点击或按键。回底容差与脱离阈值之间 SHALL 是滞回区间：跟随态在距底 ≤ 脱离阈值内
MUST NOT 脱离，脱离态在距底 > 回底容差内 MUST NOT 复跟（底部附近 MUST NOT 抖动）；两个值 SHALL 都
小于一行正文的渲染高度。具体取值是实现精度（在 design 层定），场景断言 MUST NOT 写死像素值。

脱离态下 SHALL 在 transcript 视口内浮现「回到底部」钮：钮 MUST NOT 随内容滚动（常驻视口右下角），
点击 SHALL 把视口带回内容末尾、恢复跟随态，钮随之退场。脱离态期间 transcript 有新内容到达时，
钮 SHALL 呈现未读提示；回底或恢复跟随态后提示 SHALL 清除。未读提示 MUST NOT 使用数字计数——流式
增量不构成「消息」这种计数单位，任何数字都是伪造读数。

**强制回底的白名单**：只有用户自己发起的动作 SHALL 强制回到末尾并恢复跟随——发送一条消息、切换 /
恢复会话（含快照重建）、切换 vault、重新打开面板。其余事件（流式增量与轮次终态、工具行更新、通知、
错误行、批准卡、自动回合）MUST NOT 强制改变滚动位，只更新未读提示。

transcript 内容不足一屏（内容高度 ≤ 视口高度）时 MUST NOT 出现脱离态与「回到底部」钮。跟随态下面板
尺寸变化（窗口缩放 / 分栏调整）SHALL 继续贴底；脱离态下尺寸变化 MUST NOT 写滚动位。

「回到底部」钮 SHALL 是可键盘聚焦的按钮：可访问名取文案表（无新内容 / 有新内容两串），随界面语言
重绘；配色 SHALL 只消费 token 层（三主题成立，eink 不引入彩色），`prefers-reduced-motion` 下
MUST NOT 脉冲。面板 MUST NOT 为「回到底部」新增全局键位：composer 聚焦时 Space SHALL 仍然键入空格，
Space / PgDn MUST NOT 被本需求解释为滚动或回底命令。

跟随 / 脱离的判定与写滚动位的编排 SHALL 只有一份实现（纯模型层）：面板 DOM 接线、单测与验收场景
MUST NOT 各自复制阈值或比较逻辑。

#### Scenario: 流式期间上滚后阅读位置保持

- **WHEN** 一轮回复正在流式增长，用户把 transcript 视口上滚离开底部（距底 > 脱离阈值）
- **THEN** 后续增量到达时视口不移动（`scrollTop` 变化 ≤ 1px），阅读中的那一行仍在原处；「回到底部」
  钮浮现

#### Scenario: 回到底部恢复跟随

- **WHEN** 脱离态下点击「回到底部」钮，或用户手动把视口滚回距底 ≤ 回底容差
- **THEN** 视口到达内容末尾、「回到底部」钮退场；下一个增量到达后视口仍贴底（距底 ≤ 回底容差）

#### Scenario: 跟随时增量贴底

- **WHEN** 视口在底部（距底 ≤ 回底容差）且流式增量到达
- **THEN** 每次增量落地后视口距底 ≤ 回底容差、最新一行在视口内，同一轮内不发生「越写越落后」

#### Scenario: 脱离态的新内容提示

- **WHEN** 脱离态期间 transcript 有新内容到达（流式正文 / 工具行 / 通知 / 错误行 / 批准卡任一）
- **THEN** 「回到底部」钮呈现未读提示，且提示不是数字计数；回到跟随态后未读提示消失

#### Scenario: 强制回底白名单

- **WHEN** 脱离态下用户发送一条消息、切换 / 恢复会话、切换 vault 或重新打开面板
- **THEN** 视口回到内容末尾并恢复跟随态（新消息 / 恢复内容可见），「回到底部」钮退场

#### Scenario: 非用户事件不拽走视口

- **WHEN** 脱离态下到达工具行更新、通知、错误行、批准卡或自动回合的增量
- **THEN** `scrollTop` 不变（≤ 1px），只有未读提示可能变化；视口不回到末尾

#### Scenario: 内容不足一屏

- **WHEN** transcript 的内容高度不超过视口高度
- **THEN** 不出现脱离态与「回到底部」钮，任何滚动调用都不产生可见位移

#### Scenario: composer 键位不被劫持

- **WHEN** composer 聚焦时按 Space 与 PgDn
- **THEN** Space 正常落进 composer 文本、PgDn 只按既有归属处理，transcript 的滚动位不变，MUST NOT
  触发回底动作

#### Scenario: 钮的主题与语言纪律

- **WHEN** 三主题（light / dark / eink）下钮可见，或界面语言为 zh / en
- **THEN** 钮的配色与描边逐值来自 token 层（eink 无彩色、以描边区分层次），可访问名取对应语言的
  文案（无新内容 / 有新内容两串）

## MODIFIED Requirements

### Requirement: 错误呈现

transcript 中的错误行 SHALL 同文案去重：新错误的文案与当前最后一条错误行逐字相同时 SHALL 就地替换
该条（跟随态下滚到可见；用户已离开底部时 MUST NOT 改变滚动位，改由「回到底部」钮的未读提示承担），
SHALL NOT 追加堆叠；不同文案的错误照常追加。

#### Scenario: 同一错误不堆叠

- **WHEN** 同一原因的错误连续发生多次（如后端尚未就绪时反复触发同一失败）
- **THEN** transcript 中该文案的错误行始终只有一条，不发生追加堆叠

#### Scenario: 脱离态下重复错误不拽走视口

- **WHEN** 用户已上滚阅读、处于脱离态，transcript 中同一文案的错误再次发生
- **THEN** 错误行仍只有一条（就地替换），`scrollTop` 变化 ≤ 1px（视口不回到末尾），「回到底部」钮的
  未读提示在场
