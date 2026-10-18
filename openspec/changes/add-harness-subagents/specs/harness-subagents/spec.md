# harness-subagents 增量规格

> 起草注记（非规格正文）：本 delta 新建 capability `harness-subagents`——子代理定义与委托式 harness
> 运行。形态参照 [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)（2026-10-18 抓取）：
> 定义即 Markdown + YAML frontmatter 文件、按名字委派、按 `description` 自动委派、部分结果可 resume。
> 第二轮按 Alex 节点 1 裁决修订：并行 + 后台运行、批准卡透传、内建 `explore`、用量按模型分桶、
> 任务面板可见面。第三轮按节点 1 终审前的裁决修订：后台完成**自动唤醒**父会话 + 链式失控闸
> （`AUTO_WAKE_CHAIN_MAX`）；节点 1 终审（2026-10-18）通过提案其余部分，该上限定为 5。逐条出处见
> [proposal.md](../../proposal.md)「裁决留痕」。与参照系的
> 逐项对照及刻意偏离见 proposal「参照系」节。运行公共层（`RunSpec` / `RunContext`）属 `harness`
> capability，见 [harness delta](../harness/spec.md)。本 capability 只管「有哪些子代理、一次委派怎么
> 跑、怎么收敛、怎么记账、怎么留档、用户看到什么」。

## ADDED Requirements

### Requirement: 子代理定义文件

系统 SHALL 从两个作用域发现子代理定义，并以 Markdown + YAML frontmatter 为唯一格式：

- vault 级：`<vault>/.lumir/agents/**/*.md`（随 vault 走、可入版本控制）；
- 用户级：`<config_dir>/agents/**/*.md`（跨 vault 复用）。

扫描 SHALL 递归子目录；身份 MUST 只取 frontmatter 的 `name`，子目录不参与身份。frontmatter 的必填
字段 SHALL 为 `name`（非空、无空白、不含 `/`、≤64 字符）与 `description`（非空）；可选字段 SHALL
为 `tools`、`model`、`max_turns`、`max_tokens`、`timeout_secs`、`background`。`background: true` SHALL
表示该定义强制后台运行（调用参数无法把定义的后台降为前台）。frontmatter 之后的 Markdown 正文
SHALL 是该子代理 system prompt 的身份段。定义文件 MUST NOT 需要改代码即可生效：每回合开头扫描一次，
磁盘改动在下一回合的委派中生效，MUST NOT 要求重启应用。

同名定义 SHALL 以 vault 级覆盖用户级；同一作用域内同名时 SHALL 取字典序第一个并产出一条人话
warning（MUST NOT 依赖文件系统读序）。非法定义 SHALL 被逐条丢弃并各产一条点名文件与原因的 warning，
MUST NOT 让扫描整体失败：frontmatter 缺失 / 未闭合 / YAML 解析失败、`name` 或 `description` 缺失、
`tools` 含闭集合外的工具名或 `task`。`tools: []` SHALL 合法（零工具子运行）。`model` 不在当前
provider 清单时 SHALL 保留定义并回落 `inherit` + warning；`max_turns` / `max_tokens` /
`timeout_secs` 类型非法或越界时 SHALL 取配置上限 + warning。未识别的 frontmatter 字段 SHALL 产
warning 并忽略（文案点名该字段在本版本不采纳）。

系统 SHALL 内置一个只读子代理定义 `explore`（Alex 裁决「同意」）：`tools` 为只读三件
`vault_read` / `vault_search` / `skill_load`，`model` = `inherit`，三闸取 `[harness.subagents]`
缺省，描述其用途为「在 vault 里搜索、按路径枚举、读取文件与 skill，产出结论与依据；不改文件、不跑
命令」。内建定义 SHALL 与磁盘定义走同一条装载、校验与清单注入路径，MUST NOT 形成代码里的特殊分支。
同名定义 SHALL 以用户级 / vault 级覆盖内建（覆盖时产一条人话 warning，清单里只出现生效的一份）。

系统 SHALL 把每个生效定义的 `name` 与 `description` 注入 `task` 工具的描述（自动委派的依据）；
描述合计的估算 token 数（`ceil(字符数 ÷ 4)`）超过 15,000 时 SHALL 产出一条 warning 与
`subagent_catalog_large` 诊断事件，MUST NOT 截断清单。定义正文 MUST NOT 进入主会话上下文，只在
委派运行时装配。

#### Scenario: 定义即文件、按名可用

- **WHEN** 在 `<vault>/.lumir/agents/` 下新建一个 frontmatter 含 `name` / `description` 的文件
- **THEN** 下一回合起 `task` 工具描述里出现该名字与描述；用该名字委派可启动子运行，无需重启

#### Scenario: vault 级覆盖用户级

- **WHEN** 用户级与 vault 级各有一个 `name: research` 的定义
- **THEN** 委派 `research` 使用 vault 级定义的字段与正文；用户级同名定义不生效

#### Scenario: 内建 explore 可用且可被覆盖

- **WHEN** vault 与用户目录里都没有定义 / 另有一个 `name: explore` 的用户级定义
- **THEN** 前者清单里有内建 `explore`，委派它时工具定义恰为只读三件；后者生效的是用户定义并产出一条
  覆盖 warning，清单里 `explore` 只出现一次

#### Scenario: 非法定义逐条丢弃

- **WHEN** 某定义 `tools` 含 `task`，另一个定义缺 `description`，其余定义合法
- **THEN** 两个非法定义各产一条点名 warning 且不进入清单；合法定义照常可用，扫描不整体失败

#### Scenario: 描述超阈值告警不截断

- **WHEN** 所有定义描述合计的估算 token 数超过 15,000
- **THEN** 产出一条 warning 与 `subagent_catalog_large` 事件；清单仍完整注入，无定义被静默移除

#### Scenario: 未知字段可见

- **WHEN** 定义里写了本版本不采纳的字段（如 `permissionMode`）
- **THEN** 该定义仍生效，但产出一条点名该字段的 warning；MUST NOT 静默忽略

### Requirement: 委托运行（`task` 工具）

系统 SHALL 提供 `task` 工具，让父会话把任务委派给一个已定义子代理：子代理有独立上下文与自己的工具
循环，只把结果摘要回送父会话。入参 SHALL 为 `agent`（定义名，必填）、`prompt`（自包含任务说明，
MUST 非空）、`description`（一句话标签，必填）、可选 `model`（调用级覆盖）、可选 `resume`（run id）、
可选 `background`（bool，`true` = 后台运行）。工具集与三项闸值 MUST NOT 作为调用参数——它们只来自
定义文件（定义缺省取配置）。任务内容 MUST 只由 `prompt` 表达，机制 MUST NOT 解析 prompt、MUST NOT
内置任何任务类型、场景名或路径知识。

结果 SHALL 走工具集统一信封：完成 `{"ok": true, "status": "completed", "agent": …, "run_id": …,
"resumable": true, "model": …, "summary": …, "usage": …, "rounds": …, "denied_calls": …}`；部分结果
`{"ok": true, "status": "partial", "stopped_by": "rounds" | "tokens" | "time" | "quota" | "error",
…}`；后台启动成功 `{"ok": true, "status": "running", "run_id": …, "background": true, …}`；失败沿用
`{"ok": false, "code": …, "message": …}`。回送摘要 SHALL 有字符上限，超出 SHALL 显式标
`truncated: true` 并保留头尾，MUST NOT 静默截断。同一条助手消息里的多个 `task` 调用 SHALL 并行执行，
工具结果 SHALL 按原调用顺序回填（见「并行、后台与调度」）。

派生深度 SHALL 恰好为 1 层，实现口径为工具白名单：子运行的工具定义 MUST NOT 包含 `task`；系统
MUST NOT 维护运行时深度计数，MUST NOT 提供深度配置项。定义把 `task` 写进 `tools` 时 SHALL 在装载期
丢弃该定义（见「子代理定义文件」），MUST NOT 在调用期以深度错误兜底。

#### Scenario: 调研类任务返回摘要

- **WHEN** 父会话模型调用 `task(agent=research, prompt=…)`
- **THEN** 子运行读文件、产出结论摘要；父会话只收到工具结果里的摘要与用量，MUST NOT 收到子运行的
  逐条过程消息

#### Scenario: 部分结果不是失败

- **WHEN** 子运行在产出完整结论前触及任一失控闸
- **THEN** 工具结果 `ok=true`、`status=partial`、`stopped_by` 点名原因、`resumable=true`；父 agent
  可据它决定 resume 或缩小范围

#### Scenario: 未定义的名字

- **WHEN** `agent` 传一个当前清单里不存在的名字
- **THEN** 回送 `agent_not_found` 与当前可用名字清单；不启动子运行、不消耗 token

#### Scenario: 摘要显式截断

- **WHEN** 子运行的结论摘要超出回送字符上限
- **THEN** 摘要保留头尾、中间标截断标记，工具结果 `truncated=true`

#### Scenario: 后台调用立即返回

- **WHEN** 父会话以 `background=true` 委派一个任务
- **THEN** 工具结果立即返回 `status=running` 与 `run_id`，父回合不等待该子运行；父回合结束后用户仍可
  发送新消息（会话不因后台任务保持占用）

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
后台 run）；停止单个后台 run 的入口在任务面板，不影响其它 run。

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
SHALL 按该标记渲染为与用户消息可区分的自动化通知；任务面板对应行 SHALL 转为终态。收敛为 `aborted`
的 run SHALL NOT 触发自动唤醒（停止是用户在场的主动动作，会话拆除时也没有可唤醒的会话），其终态仍
SHALL 在面板与事件中如实反映。前台 `task` 的结果在本回合内回填，MUST NOT 产生通知或唤醒。

由于 user 消息只在下一次 LLM 请求发生时才进入留存，系统 SHALL 在通知**上屏的同一时刻**写一条投递
标记 sidecar（`kind = "notice_delivered"`，字段 `run_ids`、`wake_batch`、`shown_at`），承载「已上屏、
尚未被模型消费」的事实；该标记 MUST NOT 承载完成内容（正文真源仍为 `llm_request.messages`，run 元数据
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
回合数」：自动回合开始时加一；任何用户回合开始、任务面板「继续」、会话重置 / 恢复 / 切 vault 时清零
（计数不持久化）。计数达到 `AUTO_WAKE_CHAIN_MAX = 5` 时，父会话快照 SHALL 暴露
`auto_wake.blocked = "chain_limit"` 并使任务面板出现触顶提示行（不必等下一次通知被拒才提示）。起
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
不另产 `queued` 事件）；父会话快照 SHALL 暴露 `auto_wake: {chain, max, blocked}` 供任务面板渲染提示行。

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
  任务面板出现触顶提示行与「继续」入口；快照 `auto_wake.blocked = "chain_limit"`

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

- **WHEN** 用户在任务面板上停止一个后台 run
- **THEN** 该 run 收敛为 `aborted`，面板行转「已停止」，不产生自动回合（`wake = none_aborted`）

#### Scenario: 上屏后退出、恢复仍可见

- **WHEN** 一条通知已上屏、但尚未进入任何 `llm_request` 时应用退出（含链触顶后不再起回合、以及空闲
  合并窗口内退出两种变体）
- **THEN** 留存里有一条 `notice_delivered` 投递标记；重启恢复后据标记与 `subrun` sidecar 重建该通知
  并上屏；MUST NOT 自动起回合；用户下一次发言的请求里含该通知，此后该标记被视为已消费、不再重复上屏

#### Scenario: 已消费的标记不重复上屏

- **WHEN** 正常收尾（通知已进入某条 `llm_request.messages`）后重启会话
- **THEN** 对应的投递标记被判为陈旧并忽略，通知不重复出现；用户历史中的该通知只出现一次

### Requirement: 工具集声明与默认收紧

子运行的工具集 SHALL 来自定义的 `tools` 白名单，闭集合 SHALL 为 8 件 vault 操作工具（`vault_read` /
`vault_search` / `vault_patch` / `vault_create` / `vault_move` / `vault_delete` / `skill_load` /
`cli_run`）。`tools` 缺省时 SHALL 为只读三件 `vault_read` / `vault_search` / `skill_load`；写类工具
与 `cli_run` MUST 由定义显式声明后才可见。未声明的工具 MUST NOT 出现在子运行的工具定义里。
**缺省收紧只是缺省值，不是能力上限**：`tools` SHALL 接受上述 8 件工具的任意子集（含写类与
`cli_run`），声明后的可见性不受额外限制。工具集里 MUST NOT 包含 web 类工具——这是 harness 本体的
能力边界（主会话同样没有 web 工具），MUST NOT 被表述为「子代理被额外削减」；联网检索的现时方式是
`cli_run` 调用外部 CLI（与主会话同权，受权限管线与批准闸约束）。

工具是否可见（白名单）与是否放行（权限管线）SHALL 是两道独立的闸：白名单只决定子运行的工具定义，
放行仍走既有五层权限管线与三档权限模式，MUST NOT 因「子 agent」而放松或额外收紧用户选定的档位。
执行层 SHALL 对白名单做二次校验：白名单外的调用 MUST NOT 执行，回送 `tool_not_allowed`。

#### Scenario: 缺省只读

- **WHEN** 定义未写 `tools`
- **THEN** 子运行请求里的工具定义恰为 `vault_read` / `vault_search` / `skill_load`；写类与 `cli_run`
  对子模型不可见

#### Scenario: 显式声明写工具

- **WHEN** 定义声明 `tools: [vault_patch]`，且权限档为 `vault_write`
- **THEN** 子运行可调用 `vault_patch`，写入仍经既有工具语义与权限管线，MUST NOT 出现第二套写入通道

#### Scenario: 模型幻觉未声明工具

- **WHEN** 子运行模型发起一个不在白名单内的工具调用
- **THEN** 执行层拒绝并回送 `tool_not_allowed`，不执行该工具

### Requirement: 三重失控闸与部分结果收敛

每一运行段 SHALL 同时受三重闸约束：轮次（LLM 往返数）、token（本段累计 `input + output`）、
wall-clock 时间。三项的预算 SHALL 来自定义字段；定义未写时取 `[harness.subagents]` 的缺省值；定义
值超过配置上限时 SHALL 夹取到上限并产 warning。闸 SHALL 在每次 LLM 往返之前与每个工具调用之前检查；
token 闸另在每次往返之后按本次 usage 复查。

任一触顶 SHALL 停止发起新的往返与工具调用，并用已有产出构造部分结果（`status=partial` +
`stopped_by` + `resumable=true`）。触顶收敛 MUST NOT 追加一次「请总结」的模型调用。子运行 LLM 报错
时：已有助手文本 SHALL 返回 `partial` + `stopped_by=error`；没有任何产出 SHALL 返回 `failed` +
错误码。机制 MUST NOT 自动重试。

时间闸 MUST NOT 中途打断已在执行的工具调用（`cli_run` 自带 60 秒上限即其最坏粒度）。时间闸 SHALL
按**运行时长**累计，等待用户批准的时间 MUST NOT 计入（等人的延迟不是模型的失控方向）；因此实际
wall-clock 上界为「运行时长预算 + 等待批准时长 + 单次工具最长耗时」。父回合的停止请求 SHALL 在下一
检查点生效：子运行收敛为中止，父循环走既有停止路径；子运行 MUST NOT 让父回合无限挂起。

provider 返回配额耗尽 / 限流 SHALL 视为该段的收敛原因而非内部产出：`status=partial` +
`stopped_by=quota`（无任何产出时 `failed`），MUST NOT 自动重试、MUST NOT 自动更换模型。兄弟 run
SHALL 不受影响、继续各自的运行。

#### Scenario: token 闸触顶

- **WHEN** 本段累计 token 达到 `max_tokens`
- **THEN** 当前往返结束后不再发起新往返，返回 `status=partial`、`stopped_by=tokens`；不产生额外
  模型请求

#### Scenario: 轮次闸触顶

- **WHEN** 本段已发起的 LLM 往返数达到 `max_turns`
- **THEN** 停止发起新往返并返回部分结果，`stopped_by=rounds`

#### Scenario: 时间闸在工具调用前生效

- **WHEN** 截止时刻已到、下一个工具调用尚未开始
- **THEN** 不执行该工具调用，返回部分结果，`stopped_by=time`

#### Scenario: 已在执行的工具调用跑完

- **WHEN** 时间闸到期时一个工具调用仍在执行（如 `cli_run` 的长命令）
- **THEN** 该调用按自身超时上限跑完，其后不再发起新往返；实际耗时上界为截止时刻加单次工具最长耗时，
  不视为闸失效

#### Scenario: API 中断但有部分输出

- **WHEN** 子运行模型请求报错，且子会话里已有非空助手文本
- **THEN** 返回 `status=partial`、`stopped_by=error` 与已有文本；MUST NOT 丢弃部分工作

#### Scenario: 用户停止父回合

- **WHEN** 子运行期间用户停止父回合
- **THEN** 子运行在下一检查点终止、不再发起请求；父循环走既有停止路径，面板不出现子运行过程消息

### Requirement: 中断恢复（resume）

`task` SHALL 支持 `resume` 参数，在同一子代理会话上继续工作。resume 时 `agent` MUST 与保留 run 的
定义名一致（否则回送 `agent_mismatch`），`prompt` SHALL 作为新的 user 消息追加，子会话 SHALL 保留
完整历史（消息、工具结果、思考回放）。resume 的模型解析序 SHALL 为：调用参数 > 该 run 上次使用的
模型 > 定义；预算 SHALL 是独立的新一段（来自定义、夹取配置上限），token 计数按段清零。

子会话 SHALL 在内存中按 run id 保留，每父会话上限 4 个、按最久未用淘汰；**运行中的 run MUST NOT
被淘汰**，淘汰只作用于已收敛的 run。保留范围 SHALL 限于父会话生命周期，跨应用重启 MUST NOT 恢复。
对已淘汰、已失败（`failed`）、已中止（`aborted`）或跨重启的 run 调用 resume SHALL 回送
`run_not_resumable`；对仍在运行的 run（后台未收敛）调用 resume SHALL 回送 `run_busy`。后台 run 收敛
后与前台 run 适用同一保留与 resume 规则。resume MUST NOT 让子运行出现在会话列表、MUST NOT 把它变成
可恢复会话。

#### Scenario: 触顶后续跑

- **WHEN** 一次 `task` 返回 `status=partial` 且 `resumable=true`，父 agent 以同一 `run_id` 调用
  `task(resume=…)`
- **THEN** 子会话从保留历史继续，结果 `segment` 递增、审计流水追加同一文件；子运行可再次触顶或完成

#### Scenario: 保留上限淘汰

- **WHEN** 同一父会话已有 4 个保留 run，第 5 个 run 淘汰最久未用者后对后者 resume
- **THEN** 回送 `run_not_resumable`，消息说明保留上限；不启动子运行

#### Scenario: 重启后不可续跑

- **WHEN** 应用重启后对上一次会话的 run 调用 resume
- **THEN** 回送 `run_not_resumable`

#### Scenario: 定义不匹配

- **WHEN** `resume` 指向一个由 `agent=research` 创建的 run，但本次传 `agent=reviewer`
- **THEN** 回送 `agent_mismatch`，不继续该子会话

#### Scenario: 运行中的 run 不可续跑

- **WHEN** 一个后台 run 仍在运行时对它调用 `task(resume=run_id)`
- **THEN** 回送 `run_busy`，不并发写同一子会话；等它收敛后再 resume 可以继续

### Requirement: 子运行的批准策略（透传父会话）

子运行 SHALL 继承用户选定的权限档与同一条权限判定管线，MUST NOT 拥有独立权限档。判定为 ask 的调用
SHALL 进入批准闸并把请求透传到父会话：请求 SHALL 携带来源（`kind=subrun`、`agent`、`run_id`、
`description`），面板 SHALL 点名是哪个子代理在请求批准。批准后该次调用 SHALL 执行；拒绝（可附原因）
SHALL 回送子模型 `approval_denied`、不执行该调用、计入 `denied_calls`，且子运行 SHALL 继续——MUST NOT
因一次拒绝终止整个运行。

会话级「本会话不再问」SHALL 写入同一份会话批准缓存（命名空间 = vault 根 + 父会话 id），对父会话与
所有子运行同时生效；子运行 MUST NOT 拥有独立缓存或独立命名空间。多个子运行同时等待批准时，待批请求
SHALL 并存并按 ask 时间排序，一个未决请求 MUST NOT 阻塞其它 run 的其它工作。停止回合 SHALL 收回全部
待决请求（含子运行挂起的），等待方如实记「已停止」而非「被拒绝」。

deny 规则、危险黑名单命令与 vault 内写重定向三层 MUST 照常生效并先于批准闸，MUST NOT 因透传而放松。
定义文件 MUST NOT 携带权限模式字段来改变用户选定的档位（本版本不采纳 `permissionMode`）；子运行
MUST NOT 自动批准。

#### Scenario: 需批准的删除透传并批准

- **WHEN** 定义声明 `vault_delete` 且权限档为 `vault_write`（该档删除需批准），子运行调用它
- **THEN** 父会话出现批准卡且带 `source.agent` / `source.run_id`；批准后文件按既有语义删除

#### Scenario: 拒绝只废掉这一次调用

- **WHEN** 同上场景中用户拒绝并附原因
- **THEN** 回送子模型 `approval_denied` 与原因，文件系统不变，`denied_calls=1`；子运行继续运行并可
  在后续轮次继续使用其它工具，最终仍可 `completed`

#### Scenario: 会话记忆跨父与子生效

- **WHEN** 用户在子运行的批准卡上勾「本会话不再问」并批准一次
- **THEN** 同一会话内父会话与其它子运行的同类调用都不再弹卡（同一份会话批准缓存）

#### Scenario: 多个待批并存

- **WHEN** 两个并行子运行各自触发一个 ask 级调用
- **THEN** 两张卡同时存在并按 ask 时间排序；先决定一张不影响另一张的呈现与等待

#### Scenario: deny 规则照常生效

- **WHEN** 用户配置的 deny 规则命中子运行的一次调用
- **THEN** 调用被拒并回送命中规则原文（与交互会话同文案），不进入任何批准等待

### Requirement: 子运行上下文装配与隔离

子运行的 system 上下文 SHALL 由三部分组成：定义的 Markdown 正文（非空时替换固定身份段；为空时只用
固定身份段）、固定的「委托运行约束」段（只做被交代的任务、不与用户交互、不能再次委派；需要用户
决定的调用由批准闸透传给用户，不能自行假设答案；结束时直接给出摘要）、以及既有装配的三层 AGENTS.md
与 Skill 索引。任务内容 MUST 只作为一条 user 消息进入，MUST NOT 写入 system 段。

子运行的输入历史 SHALL 从空开始（resume 除外），MUST NOT 继承父会话的任何消息；父会话的 LLM 上下文
MUST NOT 包含子运行的文本、思考或工具调用过程，只包含 `task` 工具结果与后台完成通知。子运行的过程
SHALL 只进入任务面板的详情视图与诊断事件——**用户可见，但不进上下文**。子运行 MUST NOT 注入编辑器
上下文；所需路径 SHALL 由 `prompt` 给出。定义正文 MUST NOT 进入主会话上下文。

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
  的步骤与工具行只在任务面板的展开详情里，MUST NOT 出现在 transcript 正文，MUST NOT 进入父会话的
  LLM 历史

### Requirement: 子运行用量按模型分桶记账与可重算

子运行的 usage SHALL **按模型分桶**记账，MUST NOT 折叠进父会话的单一累计读数。每一运行段结束（任何
终态，含失败与中止）时，系统 SHALL 把该段 usage（`input` / `cached` / `cache_write` / `output` /
往返样本数 / 段数）累加到父会话读数面「子运行用量表」中**该段实际使用模型**的桶里，MUST NOT 只落在
审计流水里，MUST NOT 记到别的模型的桶里。

父会话的 `ctx%` 与 cache% SHALL 只由父会话自己的往返计算，MUST NOT 掺入子运行数字（跨模型混算的
百分比没有解释力）；该口径 SHALL 在配置文档中写明。**配额口径不分桶**：所有桶都计入同一 provider
配额，分桶只影响读数与呈现。

父会话的 wire 留存 SHALL 每段落一条 `subrun` sidecar 记录（run id、segment、agent、模型、终态、
usage、审计文件指针）；「从历史恢复以留存重算读数」的既有口径不变，重算输入 SHALL 包含该类记录并按
模型归桶累加，live 分桶表与恢复重算的分桶表 MUST 逐字段相等（求和与记录顺序无关，并行的完成顺序
MUST NOT 改变读数）。子运行内部的压缩调用 SHALL 计入该段 token 预算，但 MUST NOT 进入任何模型的桶
（沿用「压缩是内部汇总调用，不计入会话读数」的既有口径）。

#### Scenario: 按模型分桶

- **WHEN** 同一会话里两个子运行分别使用模型 A 与模型 B（同一模型的 run 可多段）
- **THEN** 子运行用量表出现 A / B 两个桶，各自累加自己的 input / output / 样本数；父会话的 `ctx%`
  与 cache% 不变（只反映父会话自己的往返）

#### Scenario: 恢复与 live 读数一致

- **WHEN** 完成一次含子运行（含 partial、resume、并行）的回合后关闭并恢复该会话
- **THEN** 由留存重算的分桶表与 live 分桶表逐字段相等（`subrun` sidecar 是重算输入之一）

#### Scenario: 失败与中止也记账

- **WHEN** 子运行以失败或被用户停止告终
- **THEN** 已发生的 usage 照常进入该模型的桶，并落 `subrun` sidecar（终态如实记录）

### Requirement: 子运行留存与诊断

子运行的审计流水 SHALL 落 `<config_dir>/harness/subruns/<vault 稳定 id>/<run_id>.jsonl`，同一 run 的
多个 segment 追加同一文件，与会话留存同 wire 形态、append-only；MUST NOT 写入
`<config_dir>/harness/sessions/`、MUST NOT 写入 vault。子运行 MUST NOT 出现在会话列举 / 恢复 / 删除
三条链路里，MUST NOT 作为可恢复会话存在。审计写失败 MUST NOT 阻断运行，但 SHALL 在完成事件里带出
失败标记。

系统 SHALL 产出七个诊断事件：`subagent_started`、`subagent_progress`、`subagent_step`、
`subagent_finished`、`subagent_notified`、`subagent_rejected`、`subagent_catalog_large`；完成事件 SHALL
带 run id、segment、agent、终态、触顶原因、轮次、模型、三项 token 读数、被拒调用数、耗时、摘要字符数
与审计路径。`subagent_notified` SHALL 带 `wake` / `wake_batch` / `chain_index`（取值与语义见「后台完成
的通知投递与自动唤醒」）。`subagent_progress` / `subagent_step` 是可见面事件，SHALL 节流产出、只带
读数与人话化参数摘要。事件 MUST NOT 含任务 prompt 内容、文件内容与 vault 绝对路径。

#### Scenario: 审计可定位

- **WHEN** 一次子运行（含 resume）结束
- **THEN** `subagent_finished` 事件带审计文件路径，该文件可按 run id 读到本次运行全部段的请求与响应

#### Scenario: 不进会话列表

- **WHEN** 完成一次子运行后打开会话历史列表
- **THEN** 列表里没有该子运行；`sessions/` 目录下不新增子运行文件

#### Scenario: 写失败不阻断

- **WHEN** 审计流水写入失败（如磁盘满）
- **THEN** 子运行照常返回结果，完成事件带 `audit_error`，MUST NOT 中断父回合

### Requirement: 子运行的模型选择

模型解析序 SHALL 为：调用参数 `model` > 定义 `model` > `inherit`（当前 provider 的会话模型）；
resume 时调用参数 > 该 run 上次使用的模型 > 定义。调用参数里的模型 id 不在当前 provider `models`
清单时 SHALL 整次委派被拒并回送 `model_not_configured` 与可用清单；定义里的模型 id 非法时 SHALL
保留定义、回落 `inherit` 并产 warning。系统 MUST NOT 读取环境变量层的模型覆盖。思考档位 SHALL 继承
父会话，本版本 MUST NOT 作为定义字段或调用参数开放。

#### Scenario: 定义模型生效

- **WHEN** 定义写 `model: <provider 清单内 id>` 且调用未传 `model`
- **THEN** 子运行请求使用该模型，审计与完成事件如实体现在场

#### Scenario: 调用覆盖优先

- **WHEN** 定义写模型 A，调用传模型 B（均在清单内）
- **THEN** 子运行使用 B；resume 时如未再传，仍使用 B

#### Scenario: 调用级非法模型被拒

- **WHEN** 调用 `model` 传一个不在清单里的 id
- **THEN** 委派被拒、回送 `model_not_configured` 与可用清单；不启动子运行、不消耗 token

### Requirement: 子运行配置节

`config.json` SHALL 支持 `[harness.subagents]` 节：`enabled`（bool，缺省 **true**）、`max_turns`
（缺省 20）、`max_tokens`（缺省 200000）、`timeout_secs`（缺省 300）、`max_subruns_per_turn`
（缺省 8）、`max_concurrent`（缺省 4，合法域 1–16，会话级同时运行的子运行数上限，前台与后台合计）。
`max_turns` / `max_tokens` / `timeout_secs` 同时是定义缺省值与定义值的上限：定义未写时取配置值，
定义值超过配置值时夹取到配置值并产 warning。`enabled = false` 是全局 kill switch：`task` MUST NOT
注册、任务面板任务区 MUST NOT 出现，定义文件与内建 `explore` SHALL 原样保留（重新启用即恢复）。校验
SHALL 沿用既有模板：类型不符整节回落 + 人话 warning；数值越界夹取到合法域 + warning，MUST NOT 因此
丢弃整节或让应用启动失败。

`enabled=false` 时 `task` MUST NOT 注册进工具定义（模型看不见），对该工具的调用 SHALL 回送
`disabled` 且不启动子运行。内建 `explore` 恒存在于清单中，因此「有生效定义」在 `enabled=true` 时恒
成立（用户可以用同名自定义定义覆盖内建）。`max_subruns_per_turn` SHALL 按父回合计数并拒绝超出的
委派段（`subrun_limit`），只计实际进入执行的段（前台 + 后台），MUST NOT 静默跳过。`max_concurrent`
SHALL 限制会话级同时运行的 run 数；超出时后台委派回 `concurrency_limit`，前台委派等待许可。

自动唤醒的链上限（`AUTO_WAKE_CHAIN_MAX = 5`）与合并窗口（`AUTO_WAKE_COALESCE_MS = 2000`）MUST NOT
是本节的配置键，SHALL 由代码常量表达（安全绳不是策略旋钮，见 harness-subagents「后台完成的通知投递
与自动唤醒」）。配置文档 SHALL 写明无人注视下的消耗上界（链上限 × 单回合委派上限 × 单 run token
预算 + 自动回合自身往返）。

#### Scenario: 非法值夹取

- **WHEN** `timeout_secs` 配为 `0` 或超出合法域
- **THEN** 取合法边界值并产生一条人话 warning，其余键照常生效

#### Scenario: 定义值被配置上限夹取

- **WHEN** 定义写 `max_tokens: 900000`，配置 `max_tokens: 200000`
- **THEN** 子运行按 200000 执行，并产出一条夹取 warning

#### Scenario: 关停后工具不注册

- **WHEN** `[harness.subagents].enabled = false` 后重启应用
- **THEN** 请求里的工具定义不含 `task`、任务面板任务区不出现；若模型仍发起该调用，回送 `disabled`
  且不启动子运行；定义文件与内建 `explore` 仍在盘上 / 内存里

#### Scenario: 单回合委派次数上限

- **WHEN** `max_subruns_per_turn = 1` 且同一条助手消息含两个 `task` 调用
- **THEN** 第一个正常执行，第二个被拒并回送 `subrun_limit`，`subagent_rejected` 记录原因

#### Scenario: 并发上限

- **WHEN** `max_concurrent = 1`，一个 run 在跑时再发起 `background=true` 的委派
- **THEN** 回送 `concurrency_limit`，第二个 run 不启动、不排队；运行中的 run 不受影响

### Requirement: 任务面板与子代理可见面

系统 SHALL 在 agent 面板内提供任务区（composer 上方），让用户看见本会话的子运行：

- 运行中 / 等待批准 / 后台运行的 run SHALL 各占一行，行内 SHALL 至少包含 agent 名、description、
  状态、轮次与该 run 的模型与 tokens 读数；description 是唯一可截断字段，状态词 MUST NOT 被截断。
- 行 SHALL 可展开为详情：模型、工具步数与最近一步、用时；运行中的行 SHALL 提供「停止」动作（只停
  该 run，不影响其它 run）。
- 任务区 SHALL 只列运行中 / 等待批准的 run。历史任务 MUST NOT 逐行常驻任务区（会与 transcript 的
  `task` 工具行形成双读数）；全部任务收敛后任务区 SHALL 收敛为一行摘要（本次会话完成 / 部分结果数）
  与按模型用量入口。每个 run 的详情（步骤、摘要、用量）SHALL 可从 transcript 的 `task` 工具行展开。
- `auto_wake.blocked` 非空时，任务区 SHALL 出现自动回合触顶提示行（`chain_limit` 与 `stopped` 两种
  文案），并提供「继续」入口；提示行 SHALL 与 run 行视觉区分，MUST NOT 冒充一个任务。
- `enabled = false` 或没有任何子运行任务时，任务区 MUST NOT 出现（空态不占位）。

前端 SHALL 提供只读的子代理清单（名字、description、工具数、模型、来源：内建 / vault / 用户），
MUST NOT 提供定义编辑界面。

子运行的批准请求 SHALL 在任务面板中对应 run 的行内呈现，卡片 SHALL 点名发起者（agent 与
description）；待批时该行 SHALL 自动展开，面板标题 SHALL 显示待批数量。拒绝后卡片 SHALL 收敛为终态
记录，子运行继续。父会话自己的批准卡 SHALL 保持既有位置（transcript 工具行下，形态不变）。

子运行过程 SHALL 只出现在任务面板详情与诊断事件，MUST NOT 出现在父会话 transcript 正文，MUST NOT
进入父会话 LLM 历史。

#### Scenario: 并行运行可见

- **WHEN** 两个 `task` 并行运行
- **THEN** 任务区出现两行，各自显示 agent、状态与轮次读数；展开任一可见其步骤流水与模型

#### Scenario: 待批准自动展开

- **WHEN** 一个子运行触发 ask 级调用
- **THEN** 该行自动展开并显示批准卡（点名 agent 与 description），面板标题显示待批数量

#### Scenario: 后台任务常驻

- **WHEN** 父回合结束而一个后台 run 仍在跑
- **THEN** 任务区仍显示该行（带后台标记）；它收敛后行转终态并在 transcript 追加一条自动化通知

#### Scenario: 关停后不出现任务区

- **WHEN** `[harness.subagents].enabled = false`
- **THEN** 任务区整体不出现，`task` 不在工具定义里

#### Scenario: 历史任务不逐行留在面板

- **WHEN** 一个子运行完成后用户继续对话
- **THEN** 任务区不再列出该 run（收敛为一行完成数摘要）；它仍可在 transcript 的 `task` 工具行里
  点开看步骤与摘要
