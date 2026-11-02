# Spec Delta: harness-subagents

## MODIFIED Requirements

### Requirement: 并行、后台与调度

同一条助手消息里的多个 `task` 调用 SHALL 并行执行（非 `task` 调用维持既有逐个执行口径）；每次调用
SHALL 受会话级并发上限 `max_concurrent` 约束。前台调用 SHALL 阻塞等待本回合结果；后台调用
（`background=true` 或定义 `background: true`）SHALL 跨越回合继续运行，不占用父会话的 busy 状态。
后台启动在并发上限已满时 SHALL 回送 `concurrency_limit` 并 MUST NOT 排队或自动补跑；前台调用等许可。

并行运行的可见与记账语义 SHALL 满足：

- 每条 run 的过程事件与终态事件都带 `run_id` 与 `segment`；同一 run 内有序，跨 run 的相对顺序 MUST
  NOT 被任何消费者依赖；
- 父会话 transcript 的 `task` 工具行 SHALL 按调用顺序创建，状态就地更新，MUST NOT 因完成顺序重排；
- 父请求的工具结果 SHALL 按原调用顺序回填，MUST NOT 按完成顺序；
- 审计流水按 run 隔离（每个 run 一个文件）；
- 用量记账是顺序无关的求和（按模型分桶），并行完成顺序 MUST NOT 改变读数。

所有运行 SHALL 共享同一 provider 配额：请求级并发 SHALL 有独立上限（`max_concurrent + 1`，留一个给
父会话自己的往返），父会话请求优先；provider 返回配额耗尽 / 限流时该段 SHALL 以 `stopped_by=quota`
收敛，MUST NOT 自动重试或自动更换模型。父回合被停止时 SHALL 广播停止到所有在跑的 run（含本回合起的
后台 run）；停止单个后台 run 的入口在任务控制区行与 transcript 的 `task` 行（见「任务面板与子代理
可见面」），只停该 run，不影响其它 run。

#### Scenario: 同回合并行

- **WHEN** 一条助手消息含两个 `task` 调用
- **THEN** 两个 run 同时运行（启动时间区间重叠），父会话按调用顺序收到两条工具结果；transcript 两行
  按调用序排列

#### Scenario: 并发上限已满

- **WHEN** `max_concurrent = 1`，已有一个 run 在跑，父会话再发起一个 `background=true` 的委派
- **THEN** 回送 `concurrency_limit`，该 run 不启动、不排队；正在跑的 run 不受影响

#### Scenario: 后台结果唤醒父会话

- **WHEN** 后台 run 在父回合结束之后收敛，且父会话空闲
- **THEN** 父会话先追加一条自动化通知消息，随后自动起一个父会话回合（通知为该回合的输入），回合
  结束后父会话有该回合的助手回复；通知的 `subagent_notified` 记录 `wake=auto_turn`

#### Scenario: 父会话正忙时合并

- **WHEN** 一个用户回合进行中两个后台 run 相继收敛
- **THEN** 通知排队到当前回合收尾，之后只起**一个**自动回合（输入含两条通知，`wake_batch` 相同）；
  MUST NOT 为每个 run 各起一个回合

#### Scenario: 停止广播

- **WHEN** 用户停止父回合，此时有 2 个前台 run 与 1 个本回合起的后台 run 在跑
- **THEN** 三者都在下一检查点收敛为中止，挂起的批准项全部收回；MUST NOT 留下仍在发请求的 run

#### Scenario: 配额耗尽不重试

- **WHEN** 子运行的模型请求返回配额耗尽 / 限流错误
- **THEN** 该段以 `stopped_by=quota` 返回 partial（已有文本照常回送）；MUST NOT 自动重试或换模型，
  兄弟 run 继续运行

### Requirement: 后台完成的通知投递与自动唤醒

系统 SHALL 把每个后台 run 的自终结态（completed / partial / failed）作为一条完成通知交付给父会话：
通知 SHALL 以一条带自动化标记（`auto_notice`）的 user 角色消息写入父会话历史，该消息的**内容**以其
随后进入的第一条 `llm_request.messages` 为真源，MUST NOT 另写一份并行的完成**内容**记录；transcript
SHALL 按该标记渲染为与用户消息可区分的自动化通知；控制区对应行 SHALL 在收尾后消失（终态与结果由
transcript 的 `task` 行承载，见「任务面板与子代理可见面」）。收敛为 `aborted` 的 run SHALL NOT 触发
自动唤醒（停止是用户在场的主动动作，会话拆除时也没有可唤醒的会话），其终态仍 SHALL 在 transcript
的 `task` 行与事件中如实反映。前台 `task` 的结果在本回合内回填，MUST NOT 产生通知或唤醒。

由于 user 消息只在下一次 LLM 请求发生时才进入留存，系统 SHALL 在通知**收敛入队时**写一条投递
标记 sidecar（`kind = "notice_delivered"`，字段 `run_ids`、`wake_batch`、`shown_at`），承载「已接纳
投递、尚未被模型消费」的事实。标记**早于上屏**存在：空闲合并窗口内与忙时排队期间通知尚未上屏，
进程此时退出同样要靠它恢复；因此 `shown_at` 记录的是入队时刻，MUST NOT 被读作「已画到屏幕上」的
证据。该标记 MUST NOT 承载完成内容（正文真源仍为 `llm_request.messages`，run 元数据
仍为 `subrun` sidecar）。恢复会话时：若留存里已有任一条 `llm_request.messages` 含同 `wake_batch` 的
`auto_notice` 消息，投递标记 SHALL 被视为陈旧并忽略；否则系统 SHALL 据标记与对应 run 的 `subrun`
sidecar 重建一条自动化通知并上屏（agent / description / 终态 / `stopped_by` / usage；MUST NOT 把摘要
正文复制进标记，重建通知的正文 SHALL 注明摘要见审计流水与 `task` 行）。重建 MUST NOT 触发自动回合
（恢复不是收敛事件，后台 run 在重启时已中止），该通知 SHALL 在用户下一次发言时进入模型上下文。

父会话空闲时，系统 SHALL 在合并窗口（从首条通知算起 `AUTO_WAKE_COALESCE_MS = 2000` 毫秒，不因新
通知顺延）到期后自动起**一个**父会话回合，窗口内收敛的通知 SHALL 合并为该回合的输入；父会话正忙时
通知 SHALL 排队，在当前回合结束后合并为**一个**回合的输入。系统 MUST NOT 为同一批通知起多个回合，
同一时刻 MUST NOT 有多个自动回合在飞。自动回合的输入 SHALL 是合并后的通知消息（固定前缀标明「不是
用户发言」），并 SHALL 是一个普通交互回合——`loop_max`、`max_subruns_per_turn`、`max_concurrent`
照常生效，MUST NOT 获得任何豁免；它 MUST NOT 改写当前正在进行的回合的上下文。

链式失控闸 SHALL 是确定性规则，MUST NOT 依赖模型自行判断何时停止。每个父会话 SHALL 维护「连续自动
回合数」：自动回合开始时加一；任何用户回合开始、对话流提示行的「继续」、会话重置 / 恢复 / 切 vault
时清零（计数不持久化）。计数达到 `AUTO_WAKE_CHAIN_MAX = 5` 时，父会话快照 SHALL 暴露
`auto_wake.blocked = "chain_limit"` 并在对话流追加一条触顶提示行（不必等下一次通知被拒才提示）。起
自动回合前若计数已达上限，系统 SHALL NOT 起回合：通知照常上屏并写投递标记（恢复后据标记重建显示），
仍提供「继续」入口（点击等价一次用户发言——计数清零并按当前待处理通知起一个回合）；用户停止自动
回合 SHALL 视同触顶（`blocked = "stopped"`），后续通知不再唤醒。两个常量（`AUTO_WAKE_CHAIN_MAX`、
`AUTO_WAKE_COALESCE_MS`）SHALL 是代码常量而非配置键。该闸与 `loop_max` SHALL 正交：`loop_max`
限制一个回合内的工具往返数，链上限限制无用户发言的回合数，两者各自停摆、互不替代。无人注视下的
消耗上界 SHALL 为 `AUTO_WAKE_CHAIN_MAX × max_subruns_per_turn × max_tokens` 加自动回合自身的往返
量级，并 SHALL 在配置文档中写明。

`subagent_notified` 诊断事件 SHALL 带 `wake`（`auto_turn` / `user_turn` / `blocked_chain` /
`blocked_stopped` / `none_aborted`）、`wake_batch`（同一批合并的通知共享）与 `chain_index`（本次自动
回合在链中的序号，从 1 起；非自动回合为 0），且在通知**最终处理时**产出一次（被排队 / 合并的 run
不另产 `queued` 事件）；父会话快照 SHALL 暴露 `auto_wake: {chain, max, blocked}` 供面板在对话流渲染
触顶提示行。

#### Scenario: 空闲时自动起回合

- **WHEN** 父会话空闲、无待处理通知，一个后台 run 收敛为 completed
- **THEN** 合并窗口到期后自动起一个父会话回合，请求里含一条带 `auto_notice` 标记的 user 消息（内容为
  完成通知）；该回合结束后父会话有助手回复；`subagent_notified.wake = auto_turn`、`chain_index = 1`

#### Scenario: 忙时合并不叠回合

- **WHEN** 一个用户回合进行中，两个后台 run 在同一个回合内相继收敛
- **THEN** 两个通知排队；当前回合结束后只起一个自动回合，其输入含两条通知且 `wake_batch` 相同；
  自动回合数恰为 1

#### Scenario: 链上限触顶停摆

- **WHEN** 连续五个自动回合已经跑完，第 6 条后台结果收敛
- **THEN** 不再起自动回合；通知仍作为自动化通知上屏并写投递标记；`subagent_notified.wake = blocked_chain`；
  对话流出现触顶提示行与「继续」入口；快照 `auto_wake.blocked = "chain_limit"`

#### Scenario: 用户发言清零链计数

- **WHEN** 链已触顶后用户发送一条消息
- **THEN** 待处理通知作为一条通知消息追加在该用户消息之前，用户回合照常执行，链计数清零；此后新的
  后台结果收敛恢复自动唤醒

#### Scenario: 停止自动回合不再唤醒

- **WHEN** 用户在自动回合进行中按下停止
- **THEN** 该回合按既有停止路径结束；快照 `auto_wake.blocked = "stopped"`，后续后台结果只上屏（并写
  投递标记）、不再起自动回合；用户下一次发言恢复

#### Scenario: 与 loop_max 正交

- **WHEN** 一个自动回合内模型连续调用工具达到 `loop_max`
- **THEN** 该回合按既有「达到循环上限」提示结束，链计数不变（链数的是回合数，不是工具往返数）；
  下一条后台结果仍受链上限约束

#### Scenario: 中止不唤醒

- **WHEN** 用户在控制区行或 transcript 的 `task` 行上停止一个后台 run
- **THEN** 该 run 收敛为 `aborted`，行转「已停止」，不产生自动回合（`wake = none_aborted`）

#### Scenario: 上屏后退出、恢复仍可见

- **WHEN** 一条通知已上屏、但尚未进入任何 `llm_request` 时应用退出（含链触顶后不再起回合、以及空闲
  合并窗口内退出两种变体）
- **THEN** 留存里有一条 `notice_delivered` 投递标记；重启恢复后据标记与 `subrun` sidecar 重建该通知
  并上屏；MUST NOT 自动起回合；用户下一次发言的请求里含该通知，此后该标记被视为已消费、不再重复上屏

#### Scenario: 已消费的标记不重复上屏

- **WHEN** 正常收尾（通知已进入某条 `llm_request.messages`）后重启会话
- **THEN** 对应的投递标记被判为陈旧并忽略，通知不重复出现；用户历史中的该通知只出现一次

### Requirement: 子运行上下文装配与隔离

子运行的 system 上下文 SHALL 由三部分组成：定义的 Markdown 正文（非空时替换固定身份段；为空时只用
固定身份段）、固定的「委托运行约束」段（只做被交代的任务、不与用户交互、不能再次委派；需要用户
决定的调用由批准闸透传给用户，不能自行假设答案；结束时直接给出摘要）、以及既有装配的三层 AGENTS.md
与 Skill 索引。任务内容 MUST 只作为一条 user 消息进入，MUST NOT 写入 system 段。

子运行的输入历史 SHALL 从空开始（resume 除外），MUST NOT 继承父会话的任何消息；父会话的 LLM 上下文
MUST NOT 包含子运行的文本、思考或工具调用过程，只包含 `task` 工具结果与后台完成通知。子运行的过程
SHALL 只进入 transcript `task` 行的展开详情与诊断事件——**用户可见，但不进上下文**。子运行 MUST NOT
注入编辑器上下文；所需路径 SHALL 由 `prompt` 给出。定义正文 MUST NOT 进入主会话上下文。

#### Scenario: 父历史不进入子运行

- **WHEN** 父会话已有若干轮对话后调用 `task`
- **THEN** 子运行的请求历史只含本次任务的 user 消息；不含父会话的任何既有消息

#### Scenario: 正文替换身份段、AGENTS 保留

- **WHEN** 定义正文非空，vault 根有 AGENTS.md
- **THEN** 子运行 system 含定义正文对应的身份内容与 AGENTS.md 内容；固定身份段被正文替换；
  委托约束段仍在场

#### Scenario: 过程不进主对话

- **WHEN** 子运行执行多轮工具调用
- **THEN** 父会话 transcript 只出现 `task` 工具行的进行中与终态（agent + description + 摘要）；子运行
  的步骤与工具行只在 transcript `task` 行的展开详情里，MUST NOT 出现在 transcript 正文，MUST NOT
  进入父会话的 LLM 历史

### Requirement: 任务面板与子代理可见面

系统 SHALL 把委派的可见面组织为**对话流 + 任务控制区**两处，主对象是一次交办（description +
agent + 状态 + 结果 + 代价 + 可介入动作），MUST NOT 把运行时记账字段（`rounds`、`segment`、
`tool_calls`）当作行内主读数：

- transcript 的 `task` 工具行 SHALL 是所有相位的主载体：运行中 SHALL 显示状态词、description、
  agent、已用时与「停止」动作，完成后 SHALL 就地翻终态（状态词、description、agent、用时），MUST NOT
  因完成而另起一行或重建行身份。
- 运行中的 `task` 行 MUST NOT 被工具块折叠隐藏：工具块内 ≥2 行时折叠其余行，运行中的 `task` 行
  保持可见。
- composer 上方的任务控制区 SHALL 只在以下情形出现：至少两个 run 同时在跑、存在后台 run、存在
  等待批准的 run、或存在尚未被用户确认的后台异常终态（partial / failed / stopped）。单个前台 run
  运行时控制区 MUST NOT 出现。控制区每行 SHALL 含状态词、description、agent、已用时与可执行动作；
  description 是唯一可截断字段，状态词 MUST NOT 被截断。
- 控制区行 SHALL 可展开为详情：模型、工具步数与最近一步、用时、该 run 的用量读数与段数；等待批准的
  行 SHALL 自动展开并显示批准卡（点名发起者 agent 与 description），控制区标题 SHALL 显示待批数量。
  拒绝后卡片收敛为终态记录，子运行继续。
- 后台 run 收敛为 partial / failed / stopped 时，控制区 SHALL 保留一行直到用户显式确认（「知道了」），
  MUST NOT 自动消失；确认后该行移除，同一 run MUST NOT 再次出现。
- 全部 run 收敛且无待批 / 待确认项时，控制区 MUST NOT 出现；MUST NOT 常驻「本次会话完成数」汇总，
  MUST NOT 常驻按模型用量表。
- `rounds` MUST NOT 作为进度读数出现在行内或详情；它只在 `stopped_by = rounds` 时作为触顶原因出现。
- `auto_wake.blocked` 非空时，系统 SHALL 在对话流追加一条自动化触顶提示（`chain_limit` 与 `stopped`
  两种文案）并提供「继续」入口；该提示 MUST NOT 出现在任务控制区，MUST NOT 冒充一件交办。
- 会话级子任务用量 SHALL 只经按需入口（会话浮层里的「本会话子任务用量」段）呈现：只有一个模型桶时
  SHALL 只显示总量、MUST NOT 出现「按模型」分组；两个及以上桶时才按模型分组。没有用量读数时整段
  MUST NOT 出现。
- 切 vault 后，控制区 MUST NOT 残留上一会话的行；切回时仍在跑的 run SHALL 依据父会话快照的 live run
  列表重建行（含「停止」能力），切走期间已收尾的 run MUST NOT 以运行中形态复活。父会话快照 SHALL
  暴露该 vault 的在跑 run 列表（`run_id`、agent、description、模型、后台标记、段内轮次与工具调用数、
  最近工具、已用时）。
- 同一 `run_id` 的 resume 段 SHALL 合并为同一任务身份：`segments` 逐段累加，`rounds` / `steps` 跨段
  累计，行 MUST NOT 因新段开始而清空读数或另立一行。
- 后台完成通知 SHALL 只承载索引信息（agent、description、终态与触顶原因、摘要首行），MUST NOT 指向
  一个已不存在的面板位置。
- `enabled = false` 或无任何子运行任务时，控制区 MUST NOT 出现（空态不占位）。

前端 MUST NOT 提供子代理清单区（名字 / description / 工具数 / 模型 / 来源）：该区已按 Alex
2026-10-19 裁决「彻底去掉，只留任务区」撤销。MUST NOT 提供定义编辑界面。

子运行过程 SHALL 只出现在 transcript `task` 行的展开详情与诊断事件，MUST NOT 出现在父会话 transcript
正文，MUST NOT 进入父会话 LLM 历史。

#### Scenario: 单个前台 run 只出现在对话流

- **WHEN** 一个前台 `task` 正在运行，且没有其它在跑 / 待批 / 待确认的 run
- **THEN** 任务控制区不出现；其 `task` 行显示状态词、description、agent、已用时与「停止」，且工具块
  折叠不隐藏该行

#### Scenario: 并行运行可见

- **WHEN** 两个 `task` 并行运行
- **THEN** 控制区出现两行，各自显示状态词、description、agent 与用时；展开任一可见模型、步数、
  最近一步与该 run 的用量

#### Scenario: 待批准自动展开

- **WHEN** 一个子运行触发 ask 级调用
- **THEN** 该行自动展开并显示批准卡（点名 agent 与 description），控制区标题显示待批数量

#### Scenario: 后台任务常驻

- **WHEN** 父回合结束而一个后台 run 仍在跑
- **THEN** 控制区仍显示该行（带后台标记）；它收敛为 completed 后行消失，并在 transcript 追加一条
  自动化通知与终态 `task` 行

#### Scenario: 后台失败保留到用户确认

- **WHEN** 一个后台 run 收敛为 failed / partial / stopped
- **THEN** 控制区保留该行（状态词 + 触顶原因 + 摘要首行 + 「知道了」），直到用户点击「知道了」，
  行才移除，且同一 run 不再出现

#### Scenario: 空闲不占位

- **WHEN** 没有在跑、待批或待确认的 run（包括刚完成一次委派、以及重载恢复后的会话）
- **THEN** 任务控制区不出现；不出现本次会话完成数汇总，也不出现常驻按模型用量表

#### Scenario: resume 段保持同一身份

- **WHEN** 同一 `run_id` 以 `resume` 起第二段
- **THEN** 任务区仍只有一行；`segments` 为 2，`rounds` / `steps` 为两段累计，详情包含两段摘要与用量；
  行 MUST NOT 被清空读数或被替换为第二个身份

#### Scenario: 轮次只在触顶时出现

- **WHEN** 一个 run 正常完成（未触顶）
- **THEN** 行与详情都不显示轮次读数；当 `stopped_by = rounds` 时，详情的原因行显示轮次预算与已完成轮数

#### Scenario: 切 vault 不残留、切回可停止

- **WHEN** 一个 run 在 vault A 运行，用户切到 vault B 再切回 A
- **THEN** 切到 B 时控制区不含 A 的行；切回 A 时仍在跑的 run 重建为一行并带「停止」；若它在切走
  期间已收尾，切回后 MUST NOT 显示为运行中（终态由 transcript 的 `task` 行承载）

#### Scenario: 触顶提示在对话流

- **WHEN** `auto_wake.blocked` 非空
- **THEN** 对话流出现触顶提示行与「继续」按钮，任务控制区不出现该提示；点「继续」后提示就地收敛为
  结果句

#### Scenario: 会话用量按需查看

- **WHEN** 本会话有子运行用量，用户打开会话浮层
- **THEN** 浮层顶部出现「本会话子任务用量」段；只有一个模型桶时只显示一行总量（无模型名分组），
  两个及以上桶时按模型分行

#### Scenario: 后台通知不指向消失的面板

- **WHEN** 一个后台 run 收尾并上屏完成通知
- **THEN** 通知只含 agent、description、终态（含触顶原因）与摘要首行，不出现「详情见任务面板」；
  结果与用量从 transcript 的 `task` 行展开

#### Scenario: 历史任务不逐行留在面板

- **WHEN** 一个子运行完成后用户继续对话
- **THEN** 控制区不再列出该 run（不出现完成数汇总），它仍可在 transcript 的 `task` 工具行里点开看
  步骤、摘要与用量

#### Scenario: 关停后不出现任务区

- **WHEN** `[harness.subagents].enabled = false`
- **THEN** 控制区整体不出现，`task` 不在工具定义里

#### Scenario: 多待批不挤压 composer

- **WHEN** 三个及以上子运行行同时存在（含待批）
- **THEN** 控制区列表自身滚动（最大高度不超过视口 40% 或 320px 中较小者），composer 始终可见
