# harness Specification Delta

> 起草注记（非规格正文）：本 delta 只改「进度呈现」一条 requirement，MODIFIED 块按 living spec
> 的整条正文复制再改（`openspec archive` 对 MODIFIED 是整块替换，少抄的段落会在归档时静默消失）。
> 机制与取舍见 [design.md](../../design.md)，裁决留痕见 [proposal.md](../../proposal.md)。
>
> **硬前置与基线（有序链）**：`fix-harness-approval-visibility-nov23` →
> `refine-harness-typography-nov23` → 本 change。本 delta 必须在**两个前序都归档且 `--archived`
> PASS**、排版新视觉基线经 Alex 批准落盘之后，以两者归档后的 living「进度呈现」**整块重抄**再定稿。
> 在此之前本 change 不得实现 / 归档；当前文本是**承接草案**，只并入尾行直接相关的待批状态 /
> 标题栏信号条款，以及排版 change 的承接值（阶段行 `--text-2`、16px gap、空态 13px/1.58 /
> `--text-2` / 24px padding），**未逐字包含两个前序 living 的全部条款**（前置的终态统一撤回、
> idle stale、enter 前置、清算矩阵、发送最终几何，排版的阅读密度 / token 条款，都必须实现期整块
> 重抄）。MUST NOT 以本草案直接归档；本草案未出现的条款不是删除意图；本 change 活跃期 MUST NOT
> 提前改写 living spec。

## MODIFIED Requirements

### Requirement: 进度呈现

工具循环进行中，面板 SHALL 呈现**不定态**进度指示与阶段指示（当前动作一行，如正在读取哪些文件 / 调用哪个工具）；SHALL NOT 呈现百分比进度（总时长运行前不可知，百分比在技术上是伪造）。工具调用完成 SHALL 即折叠为一行摘要（既有口径不变）。eink 主题下进度指示 SHALL 以明度 / 线宽表达，不引入彩色。

本条的进度指示 SHALL 覆盖一轮对话的**全部处理中相位**（等待响应 / 生成 / 工具循环 / **等待批准** / 停止中），不只工具循环。进度指示 SHALL 是 transcript 滚动区内的**输出尾行**：在文档流中占位、作为滚动内容的最后一个可见子项；MUST NOT 挂在 transcript 之外（composer 上方的固定块），MUST NOT 以浮层覆盖正文。尾行 SHALL 是单一元素：跨相位复用同一节点，文案原地切换；相位跃迁 MUST NOT 重建、替换或重新插入该节点。相位从空闲进入处理中时 SHALL 把它挂到 transcript 尾位；transcript 因快照 / 恢复重建后若仍在途 SHALL 重新挂到尾位。运行中任何 transcript 顶层子节点新增之后，尾行 SHALL 仍是最后可见项（视觉序与 DOM 序一致）。

尾行的状态矩阵 SHALL 逐档成立：空闲 / 历史恢复（不在途）不显示、零像素占位；已发送、首个**有效助手产出**前显示「等待响应…」（D381）；生成中（含工具循环）显示「正在生成回复…」（D382）并原地换字；**运行中待批（当前会话 `pendingApprovals` 非空）显示「等待批准…」**；停止中显示「正在停止…」（D400）；中途接管（进入快照报在途、**无待批**）在重建后显示「正在继续本轮…」，MUST NOT 先显示「等待响应…」；**中途接管 + 待批显示「等待批准…」，MUST NOT 读「正在继续本轮…」**；正常完成 / 出错 / 用户停止在追加终态内容之前隐藏。

文案优先级 SHALL 为 `stopping > approval > midTakeover > waiting/generating`。`approval` 是前置 change 的 `pendingApprovals` 派生信号，不是新相位；它 MUST NOT 由事件种类、计时或并行布尔推断。待批优先于接管与等待 / 生成：轮次实际阻塞在用户决策，不是模型产出。自动回合与点击发起的 cron 运行 SHALL 与「已发送」同口径。首个有效助手产出 SHALL 是 `reasoning_chunk` / `tool_call` / `text_chunk` 任一到达；三者的推进 MUST 共用同一处逻辑，MUST NOT 只由正文分片推进。

滚动区外的审批信号 SHALL 由前置 change 的标题栏承载继续提供：尾行移入 transcript 后，待批期间标题栏 harness 段（面板开）或 toggle 活动状态（面板收）SHALL 读「等待批准」，且 MUST NOT 随 transcript 滚动；脱离态下待批到达时该信号 MUST 仍在、`scrollTop` 变化 MUST ≤ 1px。本 change MUST NOT 削弱、隐藏或另写一份该信号。

尾行 SHALL 在文档流内占位，MUST NOT 与正文重叠。尾行 SHALL 为单行（不换行、超长以省略号截断），其高度 SHALL 与文案、界面语言无关恒定；条形高度 SHALL 恒定。相位切换 MUST NOT 改变尾行高度、MUST NOT 改变尾行与上方内容的间距、MUST NOT 移动它上方的任何内容。尾行出现或消失 MUST NOT 把脱离态下的阅读位置拽走——`scrollTop` 变化 MUST ≤ 1px。

空态提示的在场判定 MUST 排除尾行（尾行不是内容）：没有消息时提示仍在，有消息时提示不在。空态提示的几何位置 MUST NOT 随尾行显隐变化：MUST NOT 依赖 flex 剩余空间（auto margin）居中；提示中心 MUST 取 transcript 内容盒的中心（排版后上 padding `--sp-8` 与下 padding `--sp-6` 之间），MUST NOT 取 padding box 的几何中心；与本 change 施工前（即排版归档后）的 idle 中心差 MUST ≤ 1px，MUST NOT 以排版前旧基线为对账起点。空态的 13px/1.58、`--text-2`、24px padding SHALL 继承排版 change，本 change MUST NOT 改动。尾行出现 / 消失前后提示位置位移 MUST ≤ 1px，且尾行自身 MUST 真实在场（矩形高度 > 0、落在 transcript 视口内；空态下 `scrollHeight` 有 `clientHeight` 下限，不能单独作为正控制）。

尾行的阶段行颜色 SHALL 取 `--text-2`（排版 change 已升档，MUST NOT 恢复排版前阶段色）；尾行与上方末条内容的净间距 SHALL 为 2px，按排版后的 16px transcript gap 以 `calc(var(--sp-2) - var(--sp-8))` 实现。空态改为绝对定位时，四边 SHALL 取 `top/right/left: var(--sp-8); bottom: var(--sp-6)`。

尾行的显隐 SHALL 被当作**布局变化**而不是新内容：脱离态下 MUST NOT 因此点亮未读提示；未读判据的基线 SHALL 只补偿尾行自身的布局增量，MUST NOT 把同一批中真实内容增长的高度一起吞掉——同一批中真实内容增长 MUST 照常点亮未读，且 `scrollTop` 变化 MUST ≤ 1px。跟随态下照常贴底。

停止相位的条形 SHALL 冻结（无位移动画、无脉冲）：停止没有推进，运动暗示与语义相反；eink 主题下同样冻结。其余相位的条形保持不定态，动画只作用于 `transform` / `opacity`，MUST NOT 触发布局。

尾行的显隐、文案与条形形态 SHALL 由面板的相位施加函数一处落 DOM；流式分片的「等待 → 生成」推进 MUST NOT 另写一份可见性或位置逻辑。transcript 的顶层追加 SHALL 经唯一入口维持尾行末位，并 SHALL 有运行时兜底覆盖任何绕过入口的追加路径（含自动压缩标记、孤儿工具记录、快照重建等），MUST NOT 依赖逐个调用点人工置尾。

#### Scenario: 进行中呈现不定态与阶段

- **WHEN** 一轮对话进入工具循环（如先读文件再搜索）
- **THEN** 面板显示不定态进度条与当前阶段行；任何时刻不出现百分比读数

#### Scenario: 完成即折叠

- **WHEN** 某个工具调用完成
- **THEN** 该调用在 transcript 中折叠为一行摘要（工具名 + 结果概要），过程细节不再占位

#### Scenario: 尾行在滚动区内且恒为最后一项

- **WHEN** 一轮对话处于处理中，流式正文、工具行或通知继续到达
- **THEN** 进度尾行始终是 transcript 滚动区内最后一个可见内容；它不覆盖任何正文，新内容出现在它上方

#### Scenario: 首个有效产出即离开等待

- **WHEN** 已发送，首个到达的助手产出是正文分片、思考分片或工具调用中的任一种
- **THEN** 同一进度节点从「等待响应…」换成「正在生成回复…」；节点不重建，尾行高度与它和上方内容的间距不变

#### Scenario: 首个产出是工具调用

- **WHEN** 模型先调用工具、全程没有正文分片
- **THEN** 首个工具调用到达后阶段行即为「正在生成回复…」，不继续显示「等待响应…」；工具细节由工具行承担

#### Scenario: 首个产出是思考

- **WHEN** 模型先输出思考、正文尚未到达
- **THEN** 首个思考分片到达后阶段行即为「正在生成回复…」，不继续显示「等待响应…」

#### Scenario: 停止态冻结

- **WHEN** 用户点击停止、相位进入 stopping
- **THEN** 尾行读「正在停止…」，条形不滑动、不脉冲（计算样式无动画）；eink 主题同样静止

#### Scenario: 中途接管不闪等待（无待批）

- **WHEN** 面板从进入快照得知本轮在途（中途接管），快照不带待批项，并按快照重建 transcript
- **THEN** 重建完成后尾行挂在末尾并读「正在继续本轮…」，不先显示「等待响应…」；随后到达的分片仍进同一轮

#### Scenario: 待批优先于接管

- **WHEN** 进入快照报在途（中途接管）且快照带非空待决批准列表
- **THEN** 重建后阶段行读「等待批准…」，MUST NOT 读「正在继续本轮…」；批准卡在 transcript 内可见，标题栏审批信号在场

#### Scenario: 尾行移入滚动区后标题栏信号仍在

- **WHEN** 待批期间用户把 transcript 上滚进入脱离态，尾行在视口之外
- **THEN** 标题栏 harness 段（面板开）或 toggle 活动状态（面板收）仍读「等待批准」；`scrollTop` 变化 ≤ 1px；视口不回到末尾；「回到底部」钮的未读提示按前置 change 的既有口径呈现

#### Scenario: 终态先离场

- **WHEN** 一轮以正常完成、用户停止或错误收尾
- **THEN** 尾行在「已停止」标记或错误行落地之前隐藏；transcript 末尾是终态内容，不出现「进度还在跑、下面已有结果」

#### Scenario: 历史恢复不在途

- **WHEN** 从会话浮层恢复一个不在途的历史会话
- **THEN** transcript 重建后尾行不出现（零像素）；直到用户发送新一轮才显示

#### Scenario: 空态不被尾行误撤

- **WHEN** 会话尚无任何消息，处理中尾行在场或刚离场
- **THEN** 空态提示的在场判定忽略尾行：没有消息时提示仍在，有消息时提示不在

#### Scenario: 空态几何不随尾行移动

- **WHEN** 会话尚无任何消息，尾行从隐藏变为显示、再变回隐藏
- **THEN** 空态提示的 `top` 位移 ≤ 1px；尾行自身矩形高度 > 0 且落在 transcript 视口内（证明尾行确实渲染；空态下 `scrollHeight` 有 `clientHeight` 下限，不单独作为正控制）

#### Scenario: 承接排版后的阶段色与间距

- **WHEN** 排版 change 归档后，处理中的尾行显示在 transcript 末尾
- **THEN** 阶段行颜色为 `--text-2`（不恢复排版前阶段色）；尾行与上方末条内容的净间距为 2px（16px gap
  下以 `calc(var(--sp-2) - var(--sp-8))` 实现）；空态绝对定位四边为 `sp-8/sp-8/sp-6/sp-8`，并继承
  13px/1.58、`--text-2`、24px padding

#### Scenario: 空态中心不因改造移动

- **WHEN** 对比本 change 施工前（排版归档后）的 idle 空态与改造后的 idle 空态
- **THEN** 提示中心差 ≤ 1px；改造后的中心取内容盒中心，不得以 padding box 的 50% 直接居中（排版后
  flex 内容盒居中的中心含 `(var(--sp-8) - var(--sp-6))/2` 的偏移）；不得以排版前旧基线为对账起点

#### Scenario: 脱离态不假未读

- **WHEN** 用户把 transcript 上滚进入脱离态，随后一轮开始（尾行出现）并结束（尾行隐藏）
- **THEN** 阅读位置不动（scrollTop 变化 ≤ 1px）；尾行显隐本身不点亮未读提示；期间若有真实新内容到达，未读提示照常点亮

#### Scenario: 真实内容增长不被尾行显隐吞掉

- **WHEN** 脱离态下同一批里先有真实内容增长，随后尾行隐藏、布局补偿、再执行内容增长判定
- **THEN** 未读提示点亮（真实增长未被布局补偿吞掉）；阅读位置不动（scrollTop 变化 ≤ 1px）

#### Scenario: 顶层追加路径不越过尾行

- **WHEN** 处理中触发自动压缩标记、出现无 assistant 宿主的工具记录，或快照重建追加 assistant 消息
- **THEN** 这些追加完成后尾行仍是 transcript 的最后一个子项；任何绕过唯一入口的追加也被运行时兜底移回末位

#### Scenario: 工具循环期维持生成档

- **WHEN** 首个有效产出已到达（可能是工具调用）且工具循环仍在进行
- **THEN** 尾行维持「正在生成回复…」，不新增第三档；工具细节由 transcript 中的工具行承担

#### Scenario: 语言与主题切换

- **WHEN** 处理中切换界面语言（zh ↔ en）或主题（light / dark / eink）
- **THEN** 尾行文案随语言重绘、高度不变；配色与条形形态按主题 token 成立，eink 不引入彩色
