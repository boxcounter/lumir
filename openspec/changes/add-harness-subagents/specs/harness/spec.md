# harness 增量规格（change add-harness-subagents）

> 起草注记（非规格正文）：本 delta 对既有 capability `harness` 做两处改动——ADDED「运行公共层」
> （把「触发 → 装配 → 运行 → 留存」的契约显式化，兑现 change `add-cron-runtime-daemon` design §14
> 声明的回抽承诺）；MODIFIED「工具循环」（工具清单加入编排工具 `task`，并写明子运行不持有它）。
> 委托运行的完整契约见 `harness-subagents` capability。ADR 0007 的工具集边界原则按「vault 操作工具 /
> 编排工具」分类修订后，本条的清单才成立（实现前置，见 proposal Impact）。

## ADDED Requirements

### Requirement: 运行公共层

系统 SHALL 以一份运行契约描述每一次 harness 运行：触发来源（用户输入 / cron / 委托运行）、目标 vault、
会话目标（交互会话 / 无人值守槽位 / 子运行）、投递内容、模型覆盖、工具白名单、预算、批准策略、
用量归属与事件接收端。三类触发源 SHALL 各自只产出这一份契约（`RunSpec`），MUST NOT 定义第二套运行
交接载荷或第二套预算语义。

运行循环 SHALL 只有一份实现：其依赖面 SHALL 收敛为可替换的运行上下文（会话状态、事件接收端、工具
定义、权限判定、批准等待、预算检查、留存写入），交互会话、无人值守槽位与子运行各提供一个实现。
触发源之间的差异 SHALL 以契约中的枚举值（会话目标、批准策略）表达，MUST NOT 以「触发来源」在循环
内部做行为分支。

上下文装配（固定身份段 + AGENTS.md 三层 + Skill 索引）与会话 wire 留存 SHALL 沿用既有实现，MUST NOT
为任一触发源另写一套装配或留存。交互会话路径的既有行为（事件形状、JSONL 形状、批准闸语义、循环
上限提示）MUST 保持不变——回抽是参数化，不是语义改动。

后台完成通知触发的自动回合 SHALL 走交互会话的既有入口，是一个普通交互回合：系统 MUST NOT 为此新增
触发源，MUST NOT 在循环内新增按来源分叉的执行路径；唤醒的合并与链上限语义属 `harness-subagents`
capability，不进入本契约。

#### Scenario: 三类触发源共用一份契约

- **WHEN** 分别由用户输入、cron 到点、委托运行发起一次 harness 运行
- **THEN** 三者都构造同一份运行契约并进入同一个循环入口；MUST NOT 存在第二处工具循环实现，也 MUST
  NOT 存在只服务于某一触发源的交接载荷格式

#### Scenario: 交互路径行为不变

- **WHEN** 回抽落地后跑既有单测与真机验收场景（含恢复充分性、批准闸、循环上限提示、图片投递）
- **THEN** 全部通过且无需改写期望；交互会话的 JSONL 记录形状与会话读数口径不变

#### Scenario: cron 接入后载荷形状统一

- **WHEN** cron 的实现按本契约落地
- **THEN** 其运行交接载荷是运行契约的序列化（触发来源 = cron、会话目标 = 无人值守槽位、批准策略 =
  无人可批时中止），MUST NOT 保留自列的字段集

#### Scenario: 差异以契约值表达

- **WHEN** 审查循环实现
- **THEN** 触发来源只用于诊断与事件归属；会话目标、批准策略、工具白名单、预算的差异全部来自契约值，
  循环内部没有按触发来源分叉的执行路径

#### Scenario: 工具白名单被执行

- **WHEN** 一次运行的契约声明 `tool_policy.allow` 为 8 件 vault 操作工具（cron 交接的形状），且
  `[harness.subagents].enabled = true`
- **THEN** 该运行的模型请求只包含白名单内的工具定义，`task` MUST NOT 出现；同一配置下的交互发送
  （没有交接契约）仍注册 `task`

## MODIFIED Requirements

### Requirement: 工具循环

对话运行时 SHALL 支持工具循环：模型返回工具调用时，系统执行对应工具并将结果回送，直至模型不再调用工具或达到循环上限（默认 50，`[harness].loop_max` 可调；出厂值 M367 由 8 上调至 50，上界仍为 64）。达到上限 SHALL 终止循环并在面板给出明确提示。运行时 SHALL 维护会话状态于 Rust core，webview 重载 MUST NOT 丢失会话。工具集 SHALL 恰好为 8 件 vault 操作工具：`vault_read`、`vault_search`、`vault_patch`、`vault_create`、`vault_move`、`vault_delete`、`skill_load`、`cli_run`，另加 1 件编排工具 `task`（change `add-harness-subagents`）。`task` 属编排工具、不操作 vault，是模型按名字委派子代理的入口，其入参与结果契约见 `harness-subagents` capability；子运行的运行上下文 MUST NOT 获得 `task`（派生深度恰好 1 层，实现口径为工具白名单）。清单外能力扩张须经 Alex 裁决（ADR 0007；`vault_move` / `vault_delete` 的扩张即该裁决的既有落地，`task` 的分类见该 ADR 的修订）。

同一条助手消息里的多个 `task` 调用 SHALL 并行执行，非 `task` 调用 SHALL 维持既有逐个执行口径；
工具结果 SHALL 按原调用顺序回填（并行只影响执行时刻，不改变结果的排列），父请求的 `tool_calls`
顺序 MUST NOT 因完成顺序变化。并行调用的并发上限、事件交错与配额语义见 `harness-subagents`
capability。

#### Scenario: 多轮工具往返

- **WHEN** 模型的回答需要先读文件（返回 `vault_read` 调用）
- **THEN** 系统执行读取、把内容回送模型、继续生成最终回答；面板可见「调用了什么工具」

#### Scenario: 移动与删除工具在册

- **WHEN** 模型调用 `vault_move` 或 `vault_delete`（参数为 vault 相对路径）
- **THEN** 系统执行移动/移入废纸篓并按统一结果信封回送；参数逃逸 vault 根时拒绝且文件系统不变

#### Scenario: 循环上限

- **WHEN** 模型连续调用工具达到 `loop_max`
- **THEN** 循环终止，面板显示达到上限的提示，不产生进一步工具执行

#### Scenario: 编排工具在册

- **WHEN** 交互会话模型发起 `task` 调用
- **THEN** 系统按 `harness-subagents` 的契约启动子运行；子运行的请求里 MUST NOT 出现 `task` 工具

#### Scenario: 同回合并行与按序回填

- **WHEN** 一条助手消息里模型连续发起两个 `task` 调用
- **THEN** 两次子运行并行执行；两条工具结果按调用的原始顺序回填，与各自的完成先后无关
