# harness Specification Delta

## ADDED Requirements

### Requirement: Harness 阅读密度、消息节奏与阅读宽

harness transcript SHALL 以 `calc(var(--fs-body) * var(--lumir-hp-scale, 1))` 与 `var(--lh-chat)` 呈现正文，
默认缩放档计算值为 15px/1.58（行高 23.7px）；外侧 padding SHALL 为 `16px 16px 12px`，消息间距 SHALL 为
16px。composer 外侧 padding SHALL 为 `12px 16px 16px`。字号 SHALL 继续受编辑器与 Harness 共享缩放比控制，
MUST NOT 另立 Harness 字号状态。

assistant 正文里的段落、普通列表、代码、引用、表格与块级 slot SHALL 以 8px 纵向间距分隔，首末块相应外边距
归零；`slot > codeblock/table-scroll/table` 的嵌套 margin 链路 SHALL 同步归零，MUST NOT 叠出双倍间距。
列表缩进 SHALL 为 24px，相邻列表项上距 2px，项内段落间距 4px。正文 SHALL 使用
`overflow-wrap:anywhere; word-break:normal`，长 URL MUST NOT 撑宽 transcript；表格内 URL 仍由固有宽与
局部横滚合同承担。

用户气泡 padding SHALL 为 8/12px；底色、边框、圆角与正文档配色不变。角色 meta 行 SHALL 保持 10.5px，
下距 SHALL 为 4px。角色与时间的颜色分层按「消息呈现」执行。

transcript 的直接消息子项 SHALL 以 `max-inline-size:var(--layout-review-measure)` 限制阅读宽，默认 token
值为 720px。该值是**上限而非固定宽**：可用宽不足 720px 时消息仍占满可用宽；达到上限后消息 SHALL 左对齐，
左缘与 transcript 内容左缘一致（±1px），MUST NOT 居中或把用户消息右对齐。该上限 MUST NOT 作用于 pane、
Harness 容器、composer 外侧或 composer 输入区，MUST NOT 引入第二份 720px 配置或字面值真源。

#### Scenario: 默认缩放档的阅读节奏

- **WHEN** 以默认 `--lumir-hp-scale=1` 打开含多段回答、三级列表与用户消息的 Harness
- **THEN** transcript 的计算样式为 15px/23.7px、padding `16px 16px 12px`、gap 16px；普通块间距为 8px
  且首末归零，列表缩进 / 项距 / 项内段落分别为 24px / 2px / 4px；用户气泡 padding 为 8px 12px，
  who 下距为 4px

#### Scenario: 三宽度下的消息上限与左缘

- **WHEN** 同一合成消息分别在 1200×800、1800×900、2400×1000 视口的默认 1:1 Harness pane 中呈现
- **THEN** 三组消息宽分别约为 448.5px、720px、720px（容差 1px）；三组左缘均与 transcript 内容左缘
  一致（±1px）；窄组与无 720 上限候选的宽度差 ≤1px，宽 / 超宽组只收窄消息，不改变 pane 或 composer 宽度

#### Scenario: 共享缩放比仍然生效

- **WHEN** 通过既有字号命令把编辑器与 Harness 同步调到非默认缩放档，再按 ⌘0
- **THEN** transcript 与 composer 字号随 `--lumir-hp-scale` 同步变化且行高比仍为 1.58；间距、控件最小尺寸
  和 720px 上限不二次缩放；⌘0 后两个内容面回各自基线，全程不新增 Harness 独立字号状态

#### Scenario: 长正文不撑宽 transcript

- **WHEN** 三主题 × 三宽度九组中均放入长 URL、长段落与三级嵌套列表
- **THEN** 每组 `.lumir-hp-transcript` 均满足 `scrollWidth === clientWidth`，正文链接文本完整可见，
  列表续行不越出消息；设置 transcript 纵滚到底后 `scrollTop > 0`

### Requirement: Harness 代码块与横线表排版

Harness 代码块 SHALL 保持 12.5px/1.55，padding SHALL 为 10/12px，圆角 SHALL 为 `var(--r8)`。既有局部
横滚、细条档、复制与全屏入口 MUST NOT 改变；MUST NOT 为本次排版新增滚动容器、改变 overflow 轴或重写
滚动行为。

Harness **面板内的**表格 SHALL 以 13px/1.5 呈现，th / td padding SHALL 为 6/10px。表格 SHALL 采用**横线表**：
cell 的上 / 左 / 右边框为 0，只保留 1px 底边；表头底边取 `var(--border)`，数据 cell 底边取
`var(--border-soft)`，MUST NOT 恢复全网格。表格固有宽、cell 单行、窄表贴合内容、宽表局部横滚、嵌套收缩、
全屏快照源与关闭路径均沿用「对话表格的固有宽与局部横滚」及既有全屏合同，MUST NOT 改 stacked cards。

全屏快照克隆 `<table>` 后不再位于面板 body 祖先链下，SHALL 继续消费 `.lumir-table-fs-snapshot` 的
`--editor-font-size`（默认 15px）与既有编辑器缩放语义，MUST NOT 套用面板表格的 13px 字号。全屏专属布局、
快照内容与开关行为不变；共享 `.lumir-hp-table th/td` 的横线与 6/10px padding 随克隆保留。面板与全屏的
计算样式断言 MUST 分开，面板证据 MUST NOT 冒充全屏证据。

#### Scenario: 代码块计算样式与局部横滚

- **WHEN** 三主题 × 三宽度九组中均放入超出容器宽的长代码行
- **THEN** 代码块计算字号 / 行高为 12.5px / 19.375px、padding 为 10px 12px、radius 为 8px；
  每组先满足 `code.scrollWidth > code.clientWidth`，写入 `scrollLeft=120` 后读数 >0；
  transcript 仍无横向溢出

#### Scenario: 面板横线表而不是全网格

- **WHEN** 在任一主题下查看 Harness 面板内的表格
- **THEN** 表格计算字号 / 行高为 13px / 19.5px，th / td padding 为 6px 10px；每个 cell 只有 1px 底边，
  表头与数据行分别消费结构 / 层次 hairline token，不出现上 / 左 / 右网格线

#### Scenario: 全屏快照保留编辑器字号与现有布局

- **WHEN** 从 Harness 面板打开表格全屏快照，分别在默认与非默认编辑器字号下读取快照，再关闭全屏
- **THEN** 快照继续消费 `--editor-font-size`（默认计算值 15px，非默认档随既有缩放变化），MUST NOT 为 13px；
  快照内容仍直接来自 table 本身并保持固有宽，共享 cell 只保留横线且 padding 为 6px 10px；全屏专属布局、
  打开与关闭行为不变，不把面板的 body 作用域字号断言套到快照上

#### Scenario: 窄 pane 宽表只在自身容器横滚

- **WHEN** 1200×800 视口的 Harness 中含自然宽超过消息可用宽的表格
- **THEN** 先满足 `.lumir-hp-table-scroll.scrollWidth > clientWidth`，写入 `scrollLeft=120` 后读数 >0；
  表格保持固有宽和 cell 单行，transcript `scrollWidth === clientWidth`

#### Scenario: 宽 pane 不强制制造表格溢出

- **WHEN** 同一合成宽表在 1800×900 与 2400×1000 视口呈现，其固有宽小于消息可用宽
- **THEN** 表格仍按固有宽呈现，横滚容器 `scrollWidth === clientWidth`；不得为通过滚动断言而拉宽表格，
  窄表也不被拉伸到 720px

### Requirement: Harness 工具与批准决策区排版

工具行 SHALL 保持 12px，以 `min-height:28px; height:auto` 取代固定 24px 高。工具名 / 参数 / 终态词的
既有排布、参数省略与终态词保护 MUST NOT 改变。工具尾注 `.lumir-hp-tool-out` SHALL 取 `--text-2`。

批准卡 padding SHALL 为 10/12px；purpose、basis、note、diff、argv、reason 的决策段下距 SHALL 为 8px。
批准动作按钮 SHALL `min-height:32px` 且水平 padding 为 12px。待决副句 `.lumir-hp-approval-sub`、判定依据
`.lumir-hp-approval-basis` 与后果 `.lumir-hp-approval-note` SHALL 取 `--text-2`。长次级动作允许既有换行，
命令原文仍在自己的局部滚动区完整可达；采纳、拒绝、会话内记住与持久规则行为不变。

本 requirement 指定的任务型次级文字及「消息呈现」的角色、composer placeholder、运行提示和空态提示，
在三主题实际承载面上的对比度 SHALL ≥4.5:1。时间读数等刻意退后的装饰性 meta MUST NOT 被一概提色。

#### Scenario: 工具行与批准控件计算值

- **WHEN** Harness 同屏呈现完成工具行与待决批准卡
- **THEN** 工具行字号为 12px、min-height 为 28px、height 为 auto 且实际高度 ≥28px；批准卡 padding 为
  10px 12px，指定决策段下距为 8px；批准按钮 min-height 为 32px、padding-inline 为 12px

#### Scenario: 三主题任务文字对比度

- **WHEN** 在 light / dark / eink 下分别读取角色、批准副句 / 依据 / 后果、工具尾注、运行提示、placeholder
  与空态提示的前景 token 和实际合成背景
- **THEN** 这些元素均消费 `--text-2`，逐元素对比度 ≥4.5:1；用户气泡正文仍 ≥7:1，时间仍消费 `--text-3`；
  缺元素、缺背景或颜色不可解析时判 FAIL，不得按空值跳过

#### Scenario: 窄 pane 决策动作完整可达

- **WHEN** 1200×800 视口下批准卡含长次级动作、长命令与采纳 / 拒绝按钮
- **THEN** 所有动作均在批准卡与 Harness 可视范围内，不被固定高度裁切；长次级动作按既有口径换行，
  长命令可在局部滚动区完整到达；点击采纳或拒绝仍走既有行为路径

### Requirement: Harness composer、空态与运行提示排版

composer 输入 SHALL 以 `calc(var(--fs-body) * var(--lumir-hp-scale, 1))` 与 `var(--lh-chat)` 呈现，默认
计算值为 15px/1.58；min-height SHALL 为 48px，padding SHALL 为 10/12/4px。placeholder SHALL 取
`--text-2`，top / left 分别为 10/12px，与首行输入位置一致。既有 max-height、纵滚、控制行、焦点、CodeMirror
文本 / 选区 / IME 与发送行为 MUST NOT 改变。composer 与其外侧 MUST NOT 获得 720px 固定宽或阅读宽上限。

空态提示 SHALL 为 13px/1.58、`--text-2`、24px padding；现有 margin auto 与 text-align 等布局不变，
MUST NOT 重做空态信息架构。运行阶段提示 `.lumir-hp-stage` SHALL 取 `--text-2`；其位置、既有不定态进度、
动画与交互不变，进度区移动明确不属于本 requirement。

有序承接 SHALL 固定为 `fix-harness-approval-visibility-nov23` → 本 change →
`move-harness-progress-to-output-tail-nov23`。前置审批可见性 change 未归档且 `--archived` 审计未 PASS 时，
本 change MUST NOT 施工；前置阶段色 `--text-3` 由本 change 改为 `--text-2`。本 change 未归档、审计未 PASS
且新 idle 基线未经 Alex 批准落盘时，后续尾行 change MUST NOT 施工。后续 change SHALL 继承本 change 的
阶段 `--text-2`、16px gap、`16px 16px 12px` transcript padding 与空态排版，不得恢复旧值。

后续尾行 change 若仍取 2px 净间距，SHALL 把旧 `calc(var(--sp-2) - var(--sp-4))` 重算为
`calc(var(--sp-2) - var(--sp-8))`；仅在后续 change 把空态改为绝对定位时，四边 SHALL 按新 transcript
padding 取 `top/right/left:var(--sp-8); bottom:var(--sp-6)`，并继承 13px/1.58、`--text-2`、24px padding。
其“idle 零漂移”SHALL 只相对本 change 后的新 idle 基线判定。

#### Scenario: composer 默认计算值与 placeholder 对齐

- **WHEN** composer 为空并随后输入首行文字
- **THEN** 输入计算字号 / 行高为 15px / 23.7px、min-height 为 48px、padding 为 10px 12px 4px；
  placeholder top/left 为 10px/12px、颜色为 `--text-2`，与首行行位一致；输入后 placeholder 退场，
  空态与首行输入态不出现异常高度跳变

#### Scenario: composer 不被 720px 封顶

- **WHEN** 分别在 1200×800、1800×900、2400×1000 视口打开 Harness
- **THEN** composer 外侧 padding 为 12px 16px 16px，composer 随 pane 可用宽伸缩；超宽组 composer 实际宽
  >720px，且输入、模型 chip、ctx 读数与发送钮均在 Harness 内，无横向控制行溢出或遮挡

#### Scenario: 空态与运行提示只改指定排版

- **WHEN** 分别查看空会话与工具循环进行中的 Harness
- **THEN** 空态为 13px/20.54px、`--text-2`、24px padding，现有居中方式不变；阶段提示为 `--text-2`，
  不定态进度与阶段位置、动画和运行行为保持原样

#### Scenario: 后续尾行 change 按本 change 的新几何承接

- **WHEN** 前置审批可见性 change 和本 change 已依次归档且审计 PASS，本 change 的新 idle 基线已获 Alex
  批准并落盘，随后 `move-harness-progress-to-output-tail-nov23` 开始施工
- **THEN** 尾行阶段提示继承 `--text-2`，不恢复 `--text-3`；2px 净间距按 16px gap 使用
  `calc(var(--sp-2) - var(--sp-8))`；空态绝对定位四边使用 `sp-8/sp-8/sp-6/sp-8`，并继承本 change 的
  13px/1.58、`--text-2`、24px padding；其 idle 对拍使用本 change 后的新基线，不使用旧 8px gap、
  `8/8/4px` transcript padding 或旧空态配方

## MODIFIED Requirements

### Requirement: 消息呈现

transcript 中的用户与 agent 消息 SHALL 带角色 + 时间读数 meta 行（如「你 · 12 秒前 / Agent · 刚刚」）：角色名与时间读数同行，视觉上降档于消息正文（micro 字号；角色取二级文字色 `--text-2`，时间读数取三级文字色 `--text-3`）。用户消息 SHALL 以气泡呈现，与 agent 消息的平铺正文一眼可分：light / dark 档取内容底色一族、柔和边框、圆角的气泡面，eink 档取正文纸面 + 结构档 1px 描边（MUST NOT 铺大片灰实底——e-ink 的中间调靠抖动呈现，压在灰底上的正文发糊）；气泡正文 SHALL 取正文档（与 agent 正文同档），MUST NOT 为「降一档」而压暗正文——正文可读性由气泡面与描边承担区分，气泡正文与其承载面的对比度 SHALL ≥ 7:1（WCAG AAA 正文档），三主题各自成立；agent 消息 SHALL 平铺排版（无气泡）。读数形态 SHALL 按数据来源分两档：**live**（本轮上屏打戳的消息）按「刚刚 / N 秒前 / N 分钟前 / N 小时前 / 昨天」分档；**restored**（快照恢复与会话恢复重放的消息，时间读数来自留存）按「同日窄相对 / 跨天短日期」呈现——留存在盘上，读数可以跨天甚至跨周，「昨天」对更老的消息是错读数。两档 SHALL 随时间低频刷新与随语言切换重绘（形态随消息携带、重绘不重算）。快照 / 恢复重建的消息 SHALL 以后端时间戳（`PanelMessage.ts`）显示真实读数；**会话恢复的 ts SHALL 来自留存记录的信封**（wire 项自身不带时间戳，按项在记录序里的产出时刻归属，见 design §3）；无时间戳可归的消息 SHALL 只显示角色、SHALL NOT 伪造读数。快照消息面 SHALL 保真：正文为空的 assistant 轮（模型只发工具调用、无正文）MUST NOT 落成面板记录——快照恢复 MUST NOT 出现只有角色 meta 行、正文为空的「空气泡」；工具记录（`role: tool`）SHALL 持久化摘要（`PanelMessage.summary`），成功为调用参数摘要、失败含细分状态与错误码，使 webview 重载后工具行仍有信息；成功侧的参数摘要是**单行**人话文本，`cli_run` 为「命令 + 参数」拼接且**命令本体恒在最前**（参数 JSON 原样截断时，排在命令之前的 `args` 会把它挤出可见头部，工具行只剩一串参数），含空白或引号的参数 SHALL 加引号使参数边界可辨。同一份摘要 SHALL 是 live 事件、面板持久化与恢复重建三条路径的同一份（MUST NOT 各算各的）；恢复路径读到旧快照的参数 JSON 时 SHALL 按同一形态人话化呈现。

#### Scenario: 新消息带 meta 行

- **WHEN** 发送一条提问并收到 agent 回答
- **THEN** 两条消息都带角色 + 时间读数 meta 行（用户消息在气泡内、正文与 agent 正文同档，agent 消息平铺）；读数初始落在「刚刚 / N 秒前」档

#### Scenario: 角色与时间的颜色分层

- **WHEN** 在 light / dark / eink 下读取任一用户或 agent 消息的 who 行
- **THEN** 角色节点消费 `--text-2`，相邻时间节点消费 `--text-3`，二者均保持 10.5px；角色在实际面板背景上的
  对比度 ≥4.5:1，时间继续作为刻意退后的 meta，不改变其文本、数据时间戳或刷新行为

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
