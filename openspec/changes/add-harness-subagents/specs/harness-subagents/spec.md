# harness-subagents 增量规格

> 起草注记（非规格正文）：本 delta 新建 capability `harness-subagents`——委托式 harness 运行
> （`task` 工具与子运行引擎）。设计见 [design.md](../../design.md)，裁决背景见
> [proposal.md](../../proposal.md)。运行公共层（`RunSpec` / `RunContext`）属 `harness` capability，
> 见同目录 [harness delta](../harness/spec.md)。本 capability 只管「一次委派怎么跑、怎么收敛、怎么
> 记账、怎么留档」；「什么时候该委派、用哪个模型档位」是调用方的策略，机制 MUST NOT 内置。

## ADDED Requirements

### Requirement: 委托运行（`task` 工具）

系统 SHALL 提供 `task` 工具，让调用方把一段自包含任务委派给子运行：子运行有独立的上下文与自己的
工具循环，只把结果摘要回送父会话。入参 SHALL 为 `description`（一句话标签，仅用于进度与诊断）、
`prompt`（自包含任务说明，MUST 非空）、可选 `model`、可选 `tools`（工具白名单）、可选
`max_rounds` / `max_tokens` / `timeout_secs`（三项失控闸的逐次覆盖）。任务内容 MUST 只由 `prompt`
表达，机制 MUST NOT 解析 prompt、MUST NOT 内置任何任务类型、场景名或路径知识。

结果 SHALL 走工具集统一信封：完成 `{"ok": true, "status": "completed", "summary": …, "usage": …,
"rounds": …, "denied_calls": …, "tool_calls": …}`；触顶收敛 `{"ok": true, "status": "partial",
"stopped_by": "rounds" | "tokens" | "time", …}`；失败沿用 `{"ok": false, "code": …, "message": …}`。
回送摘要 SHALL 有字符上限，超出 SHALL 显式标 `truncated: true` 并保留头尾，MUST NOT 静默截断。

派生深度 SHALL 恰好为 1 层：子运行的运行上下文 MUST NOT 获得 `task` 工具；`tools` 声明含 `task` 时
SHALL 拒绝整次委派并回送原因（MUST NOT 静默剔除）。深度不是配置项。

#### Scenario: 调研类任务返回摘要

- **WHEN** 父会话模型调用 `task`，`prompt` 要求读若干文件并给出跨文件结论，`tools` 未声明
- **THEN** 子运行读文件、产出结论摘要；父会话只收到工具结果里的摘要与用量，MUST NOT 收到子运行
  的逐条过程消息

#### Scenario: 触顶返回部分结果

- **WHEN** 子运行在产出完整结论前触及任一失控闸
- **THEN** 工具结果 `ok=true`、`status=partial`、`stopped_by` 点名触顶的闸，`summary` 为已有产出；
  父 agent 可据它决定缩小范围重试

#### Scenario: 拒绝递归派生

- **WHEN** `task` 的 `tools` 含 `task`
- **THEN** 整次委派被拒并回送 `depth_exceeded`，不启动子运行、不消耗预算

#### Scenario: 摘要显式截断

- **WHEN** 子运行的结论摘要超出回送字符上限
- **THEN** 摘要保留头尾、中间标截断标记，工具结果 `truncated=true`；MUST NOT 出现无标记的静默截断

### Requirement: 工具集声明与默认收紧

子运行的工具集 SHALL 由 `tools` 白名单决定，白名单的闭集合 SHALL 为既有 8 件 vault 操作工具
（`vault_read` / `vault_search` / `vault_patch` / `vault_create` / `vault_move` / `vault_delete` /
`skill_load` / `cli_run`）。`tools` 缺省 SHALL 为只读三件 `vault_read` / `vault_search` /
`skill_load`；写类工具与 `cli_run` MUST 由调用方显式声明后才可见。白名单外的工具名 SHALL 被拒并
回送原因，MUST NOT 静默丢弃。

工具是否可见（白名单）与是否放行（权限管线）SHALL 是两道独立的闸：白名单只决定子运行的工具定义里
出现哪些工具，放行仍走既有五层权限管线与三档权限模式，MUST NOT 因「子 agent」而放松或额外收紧用户
选定的档位。执行层 SHALL 对白名单做二次校验：白名单外的调用 MUST NOT 执行，回送 `tool_not_allowed`。

#### Scenario: 默认只读

- **WHEN** 调用 `task` 未传 `tools`
- **THEN** 子运行请求里的工具定义恰为 `vault_read` / `vault_search` / `skill_load`；写类与 `cli_run`
  对子模型不可见

#### Scenario: 显式声明写工具

- **WHEN** 调用 `task` 传 `tools: ["vault_patch"]`，且权限档为 `vault_write`
- **THEN** 子运行可调用 `vault_patch`，写入仍经既有工具语义与权限管线（该档下写类自动放行），
  MUST NOT 出现第二套写入通道

#### Scenario: 白名单外工具名

- **WHEN** `tools` 含闭集合外的名字
- **THEN** 整次委派被拒并回送 `tool_not_allowed` 与合法清单；不启动子运行

#### Scenario: 模型幻觉未声明工具

- **WHEN** 子运行模型发起一个不在白名单内的工具调用
- **THEN** 执行层拒绝并回送 `tool_not_allowed`，不执行该工具

### Requirement: 三重失控闸与部分结果收敛

子运行 SHALL 同时受三重闸约束：轮次（LLM 往返数）、token（本次运行累计 `input + output`）、
wall-clock 时间。三项的缺省值来自 `[harness.subagents]`，调用方 MAY 逐次收紧；逐次值 MUST NOT 超过
配置缺省（超过即夹取到缺省值并在工具结果里 `note` 说明）——配置是用户设定的上限，调用参数不得推翻。

闸 SHALL 在每次 LLM 往返之前与每个工具调用之前检查；token 闸另在每次往返之后按本次 usage 复查。
任一触顶 SHALL 停止发起新的往返与工具调用，并用已有产出构造部分结果返回（`status=partial` +
`stopped_by`）。触顶收敛 MUST NOT 追加一次「请总结」的模型调用（那等于给闸开一个不受预算约束的
尾巴）。时间闸 MUST NOT 中途打断已在执行的工具调用（`cli_run` 自带 60 秒上限即其最坏粒度），故实际
wall-clock 上界为截止时刻加单次工具最长耗时。

父回合的停止请求 SHALL 在下一检查点生效：子运行收敛为中止，父循环走既有停止路径，MUST NOT 继续
消耗预算。子运行 MUST NOT 让父回合无限挂起：任何路径都 SHALL 在闸或错误边界上返回一个工具结果或
中止信号。

#### Scenario: token 闸触顶

- **WHEN** 子运行累计 token 达到 `max_tokens`
- **THEN** 当前往返结束后不再发起新往返，返回 `status=partial`、`stopped_by=tokens`；不再产生额外
  模型请求

#### Scenario: 轮次闸触顶

- **WHEN** 已发起的 LLM 往返数达到 `max_rounds`
- **THEN** 停止发起新往返并返回部分结果，`stopped_by=rounds`

#### Scenario: 时间闸在工具调用前生效

- **WHEN** 截止时刻已到、下一个工具调用尚未开始
- **THEN** 不执行该工具调用，返回部分结果，`stopped_by=time`

#### Scenario: 已在执行的工具调用跑完

- **WHEN** 时间闸到期时一个工具调用仍在执行（如 `cli_run` 的长命令）
- **THEN** 该调用按自身超时上限跑完（`cli_run` 最坏 60 秒），其后不再发起新往返，返回部分结果；
  实际耗时上界为截止时刻加单次工具最长耗时，不视为闸失效

#### Scenario: 逐次参数不得放宽配置

- **WHEN** 调用 `task` 传的 `max_tokens` 大于 `[harness.subagents].default_max_tokens`
- **THEN** 预算取配置值，工具结果 `note` 说明参数被夹取

#### Scenario: 用户停止父回合

- **WHEN** 子运行期间用户停止父回合
- **THEN** 子运行在下一检查点终止、不再发起请求；父循环走既有停止路径，面板不出现子运行的过程消息

### Requirement: 子运行的批准策略

子运行 MUST NOT 挂在人工批准上等待。权限管线判定为 ask 的调用 SHALL 被拒绝并回送子模型
（`code: "approval_unavailable"`），计入工具结果的 `denied_calls`；deny 规则、危险黑名单命令与
vault 内写重定向三层 MUST 照常生效，MUST NOT 因无人值守而放松。子运行 MUST NOT 自动批准、MUST NOT
把批准请求透传到父会话，也 MUST NOT 复用父会话的批准缓存（缓存免除的是人工批准动作，共享等于从侧门
恢复「自动批准」）。

#### Scenario: 需批准的删除被拒

- **WHEN** 子运行在 `vault_write` 档声明 `vault_delete` 并调用它（该档下删除需批准）
- **THEN** 调用被拒并回送 `approval_unavailable`，文件系统不变，`denied_calls` 加一

#### Scenario: deny 规则照常生效

- **WHEN** 用户配置的 deny 规则命中子运行的一次调用
- **THEN** 调用被拒并回送命中规则原文（与交互会话同文案），不进入任何批准等待

### Requirement: 子运行上下文装配与隔离

子运行的 system 上下文 SHALL 由既有装配产出一份完整内容（固定身份段 + AGENTS.md 三层 + Skill 索引），
并叠加一段固定的委托角色段（只做被交代的任务、不与用户交互、不能请求批准、不能再次委派、结束时
直接给出摘要）。任务内容 MUST 只作为一条 user 消息进入，MUST NOT 写入 system 段。

子运行的输入历史 SHALL 从空开始，MUST NOT 继承父会话的任何消息；父会话 MUST NOT 收到子运行的文本、
思考或工具调用过程，只收到 `task` 工具结果。子运行 MUST NOT 注入编辑器上下文（子运行没有「当前
编辑器」语义）；所需路径 SHALL 由 `prompt` 给出。

#### Scenario: 父历史不进入子运行

- **WHEN** 父会话已有若干轮对话后调用 `task`
- **THEN** 子运行的请求历史只含本次任务的 user 消息；不含父会话的任何既有消息

#### Scenario: 过程不上屏

- **WHEN** 子运行执行多轮工具调用
- **THEN** 父会话面板只出现 `task` 工具卡的进行中与终态（含摘要），MUST NOT 出现子运行的增量文本、
  思考块或工具调用行

### Requirement: 用量归属主会话与可重算

子运行的 usage SHALL 归入父会话的累计读数：运行结束（任何终态，含失败与中止）时一次性把
`input` / `cached` / `cache_write` / `output` / 样本数折叠进父会话的累计器，MUST NOT 只落在子运行的
审计流水里。父会话的 `ctx%`（最近一次请求 input ÷ 模型窗口）MUST NOT 因折叠改变——它只描述父会话
自己的请求。折叠后的会话累计 cache% 是父与子的混合读数，该含义 SHALL 在配置文档中写明。

父会话的 wire 留存 SHALL 落一条 `subrun` sidecar 记录（run id、模型、终态、usage、审计文件指针）；
「从历史恢复以留存重算读数」的既有口径不变，重算输入 SHALL 包含该类记录，live 读数与恢复重算读数
MUST 逐字段相等。子运行内部的压缩调用 SHALL 计入子运行的 token 闸，但 MUST NOT 折叠进父会话读数
（沿用「压缩是内部汇总调用，不计入会话读数」的既有口径）。

#### Scenario: 子运行用量进父读数

- **WHEN** 一次 `task` 运行完成
- **THEN** 父会话的累计 input / cached / output 读数增加了该次子运行的对应值；控制行读数随之变化

#### Scenario: 恢复与 live 读数一致

- **WHEN** 完成一次含子运行的回合后关闭并恢复该会话
- **THEN** 由留存重算的读数与 live 读数逐字段相等（`subrun` sidecar 是重算输入之一）

#### Scenario: 失败与中止也记账

- **WHEN** 子运行以失败或被用户停止告终
- **THEN** 已发生的 usage 照常折叠进父会话，并落 `subrun` sidecar（终态如实记录）

### Requirement: 子运行留存与诊断

子运行的审计流水 SHALL 落 `<config_dir>/harness/subruns/<vault 稳定 id>/<run_id>.jsonl`，与会话留存
同 wire 形态、append-only；MUST NOT 写入 `<config_dir>/harness/sessions/`、MUST NOT 写入 vault。子运行
MUST NOT 出现在会话列举 / 恢复 / 删除三条链路里，MUST NOT 作为可恢复会话存在。审计写失败 MUST NOT
阻断运行（沿用既有纪律），但 SHALL 在完成事件里带出失败标记。

系统 SHALL 产出三个诊断事件：`subagent_started`、`subagent_finished`、`subagent_rejected`；完成事件
SHALL 带来 run id、终态、触顶原因、轮次、三项 token 读数、被拒调用数、耗时、摘要字符数与审计路径。
事件 MUST NOT 含任务 prompt 内容与 vault 绝对路径。

#### Scenario: 审计可定位

- **WHEN** 一次子运行结束
- **THEN** `subagent_finished` 事件带审计文件路径，该文件可按 run id 直接打开并读到本次运行的请求与
  响应记录

#### Scenario: 不进会话列表

- **WHEN** 完成一次子运行后打开会话历史列表
- **THEN** 列表里没有该子运行；`sessions/` 目录下不新增子运行文件

#### Scenario: 写失败不阻断

- **WHEN** 审计流水写入失败（如磁盘满）
- **THEN** 子运行照常返回结果，完成事件带写失败标记，MUST NOT 抛错中断父回合

### Requirement: 子运行的模型选择

`model` 缺省时子运行 SHALL 使用当前 provider 的会话模型；显式 `model` SHALL 命中当前 provider
`models` 清单里声明的模型 id，否则整次委派 SHALL 被拒并回送 `model_not_configured` 与当前可用模型
清单——MUST NOT 静默回落到默认模型。思考档位 SHALL 继承父会话，v1 MUST NOT 作为 `task` 参数开放。

#### Scenario: 缺省继承模型

- **WHEN** 调用 `task` 未传 `model`
- **THEN** 子运行的请求模型与父会话当前模型相同，审计与完成事件如实体现在场

#### Scenario: 未声明的模型被拒

- **WHEN** `model` 传一个不在 `[harness].providers.<provider>.models` 里的 id
- **THEN** 委派被拒、回送 `model_not_configured` 与可用清单；不启动子运行、不消耗 token

### Requirement: 子运行配置节

`config.json` SHALL 支持 `[harness.subagents]` 节：`enabled`（bool，缺省 true）、
`default_max_rounds`（缺省 20）、`default_max_tokens`（缺省 200000）、`default_timeout_secs`
（缺省 300）、`max_subruns_per_turn`（缺省 8）。校验 SHALL 沿用既有模板：类型不符整节回落 + 人话
warning；数值越界夹取到合法域 + 人话 warning，MUST NOT 因此丢弃整节或让应用启动失败。
`enabled=false` 时 `task` MUST NOT 注册进工具定义（模型看不见），对该工具的调用 SHALL 回送
`disabled`。`max_subruns_per_turn` SHALL 按父回合计数并拒绝超出的委派（`subrun_limit`），MUST NOT
静默跳过。

#### Scenario: 非法值夹取

- **WHEN** `default_timeout_secs` 配为 `0` 或超出合法域
- **THEN** 取合法边界值并产生一条人话 warning，其余键照常生效

#### Scenario: 关停后工具不注册

- **WHEN** `[harness.subagents].enabled = false` 后重启应用
- **THEN** 请求里的工具定义不含 `task`；若模型仍发起该调用，回送 `disabled` 且不启动子运行

#### Scenario: 单回合委派次数上限

- **WHEN** `max_subruns_per_turn = 1` 且同一条助手消息含两个 `task` 调用
- **THEN** 第一个正常执行，第二个被拒并回送 `subrun_limit`，`subagent_rejected` 记录原因
