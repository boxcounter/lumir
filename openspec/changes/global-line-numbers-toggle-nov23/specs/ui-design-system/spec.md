# ui-design-system 增量规格

> 起草注记（非规格正文）：本 change 在 modeline 右段补一个行号指示钮。它照主题 / 语言两个
> 指示钮的既有形态（共用 pill 规则、eink 描边、初始 hidden），不引入新色值 / 新尺寸 token；
> 行为侧（命令、键位、持久化）在 `keymap-commands` 的「行号开关命令」条，本文件只管**呈现与
> 布局**。设计依据见 [design.md](../../design.md) §5.5 / §7。

## ADDED Requirements

### Requirement: 行号指示钮

modeline 右段 SHALL 增加一个行号指示钮（`.modeline-line-numbers`），它是**常驻的「当前行号
开关是什么」归因出口**，同时是切换入口：点击 SHALL 与命令 `view.toggle-line-numbers` 走同一条
实现路径（切换、持久化与失败降级的口径见 `keymap-commands` 的「行号开关命令」条，MUST NOT 在
本钮上另写一套切换逻辑）。

钮的可见文本 SHALL 是当前开关的读数 `on` / `off`（与 `[ui] line_numbers` 的取值逐字一致，属
读数、不译文，与 `light` / `dark` / `eink`、`en` / `zh` 同族）。悬停提示与读屏名 SHALL 由文案表
给出（含当前状态），并 SHALL 随界面语言切换重新取值（`onRelabel` 的重绘面）；MUST NOT 使用
裸文本拼接绕过文案表。

钮 SHALL 与既有的主题指示钮同族：复用同一套 pill 规则（micro 字号、semibold、pill 圆角、微底、
`--sp-6` 左外边距、1px 透明边框占位），取色只走 token 层，MUST NOT 引入新色值或组件级主题覆盖。
eink 下 SHALL 走同一套 chip 描边化规则（边框取 `--border`），线宽与内边距不变。钮 SHALL 排在
`.modeline-meta` 与 `.modeline-theme` 之间（版本号退让段之后、主题钮之前），主题 / 语言继续占
右段最右。

钮 SHALL 在初始态隐藏，仅在行号开关已施加后才显示（与主题 / 语言钮同口径：宁可不显示，也不
显示一个尚未生效的状态）。`on` / `off` 两种读数 SHALL 占用**相同宽度**（`min-width` 覆盖较长
的 `off` + 居中），切换时 MUST NOT 让右段的其它元素（meta / 版本号段 / 主题钮 / 语言钮）发生
位移——行号开关是状态切换，不是布局事件。

窄窗 SHALL 不因本钮溢出：在 520px 窗口下，右段的 meta、版本号退让段（若在场）、行号钮、主题钮、
语言钮 SHALL 全部在场且不互相遮挡、不越出窗口右缘；MUST NOT 用隐藏主题 / 语言钮的方式给行号钮
让位。

#### Scenario: 三主题下的形态

- **WHEN** 分别在 light / dark / eink 下检查 modeline 右段的行号钮
- **THEN** 三档的字号 / 字重 / 圆角 / 内边距 / 左外边距逐项一致（同一套 pill 规则）；底色、文字色与
  边框取各自主题的 token 值；eink 下边框显形为 `--border`（#000）、底色透明；不出现新色值，
  也不出现阴影

#### Scenario: 初始隐藏、施加后显示

- **WHEN** 配置尚未施加（启动早期）与施加完成（`applyLineNumbers` 已运行）两个时刻分别检查
- **THEN** 施加前钮带 `hidden`、不占位；施加后钮显示，可见文本与 `<html data-line-numbers>` 一致

#### Scenario: 点击与命令同源、文本同步

- **WHEN** 点击行号钮；随后按 `⌘⇧N`
- **THEN** 两次切换的效果逐项相同：`<html data-line-numbers>`、两种模式的 gutter、钮文本、配置回写
  全部同步；钮文本在 `on` / `off` 之间切换，不出现中间态或空文本

#### Scenario: 切换不产生右段位移

- **WHEN** 在 1200px 与 520px 两个窗口宽度下，把开关从 `off` 切到 `on` 再切回
- **THEN** 右段其它元素（meta、版本号退让段、主题钮、语言钮）的实测 rect 逐值不变；行号钮自身的
  rect 宽度在两种读数下相同；整段不出现横向溢出或换行

#### Scenario: 窄窗不溢出

- **WHEN** 窗口收窄到 520px（版本号退让段在场）
- **THEN** meta、版本号、行号钮、主题钮、语言钮全部可见且不互相遮挡，右缘不越出窗口；主题 / 语言钮
  不被隐藏、不被行号钮挤出

#### Scenario: 语言切换后重取文案

- **WHEN** 界面语言在 `zh` / `en` 之间切换
- **THEN** 钮的悬停提示与读屏名按新语言重取（文案表取值），可见文本仍是 `on` / `off` 读数；
  切换语言不改变开关状态、不重配编辑器、不引起右段布局位移
