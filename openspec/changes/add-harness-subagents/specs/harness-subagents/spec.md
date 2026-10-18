# harness-subagents 增量规格

> 起草注记（非规格正文）：本 delta 新建 capability `harness-subagents`——子代理定义与委托式 harness
> 运行。形态参照 [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)（2026-10-18 抓取）：
> 定义即 Markdown + YAML frontmatter 文件、按名字委派、按 `description` 自动委派、部分结果可 resume；
> 与参照系的逐项对照及刻意偏离见 [proposal.md](../../proposal.md)「参照系」节。运行公共层
> （`RunSpec` / `RunContext`）属 `harness` capability，见 [harness delta](../harness/spec.md)。本
> capability 只管「有哪些子代理、一次委派怎么跑、怎么收敛、怎么记账、怎么留档」。

## ADDED Requirements

### Requirement: 子代理定义文件

系统 SHALL 从两个作用域发现子代理定义，并以 Markdown + YAML frontmatter 为唯一格式：

- vault 级：`<vault>/.lumir/agents/**/*.md`（随 vault 走、可入版本控制）；
- 用户级：`<config_dir>/agents/**/*.md`（跨 vault 复用）。

扫描 SHALL 递归子目录；身份 MUST 只取 frontmatter 的 `name`，子目录不参与身份。frontmatter 的必填
字段 SHALL 为 `name`（非空、无空白、不含 `/`、≤64 字符）与 `description`（非空）；可选字段 SHALL
为 `tools`、`model`、`max_turns`、`max_tokens`、`timeout_secs`。frontmatter 之后的 Markdown 正文
SHALL 是该子代理 system prompt 的身份段。定义文件 MUST NOT 需要改代码即可生效：每回合开头扫描一次，
磁盘改动在下一回合的委派中生效，MUST NOT 要求重启应用。

同名定义 SHALL 以 vault 级覆盖用户级；同一作用域内同名时 SHALL 取字典序第一个并产出一条人话
warning（MUST NOT 依赖文件系统读序）。非法定义 SHALL 被逐条丢弃并各产一条点名文件与原因的 warning，
MUST NOT 让扫描整体失败：frontmatter 缺失 / 未闭合 / YAML 解析失败、`name` 或 `description` 缺失、
`tools` 含闭集合外的工具名或 `task`。`tools: []` SHALL 合法（零工具子运行）。`model` 不在当前
provider 清单时 SHALL 保留定义并回落 `inherit` + warning；`max_turns` / `max_tokens` /
`timeout_secs` 类型非法或越界时 SHALL 取配置上限 + warning。未识别的 frontmatter 字段 SHALL 产
warning 并忽略（文案点名该字段在本版本不采纳）。

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
MUST 非空）、`description`（一句话标签，必填）、可选 `model`（调用级覆盖）、可选 `resume`（run id）。
工具集与三项闸值 MUST NOT 作为调用参数——它们只来自定义文件（定义缺省取配置）。任务内容 MUST 只由
`prompt` 表达，机制 MUST NOT 解析 prompt、MUST NOT 内置任何任务类型、场景名或路径知识。

结果 SHALL 走工具集统一信封：完成 `{"ok": true, "status": "completed", "agent": …, "run_id": …,
"resumable": true, "summary": …, "usage": …, "rounds": …, "denied_calls": …}`；部分结果
`{"ok": true, "status": "partial", "stopped_by": "rounds" | "tokens" | "time" | "error", …}`；失败
沿用 `{"ok": false, "code": …, "message": …}`。回送摘要 SHALL 有字符上限，超出 SHALL 显式标
`truncated: true` 并保留头尾，MUST NOT 静默截断。

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

### Requirement: 工具集声明与默认收紧

子运行的工具集 SHALL 来自定义的 `tools` 白名单，闭集合 SHALL 为 8 件 vault 操作工具（`vault_read` /
`vault_search` / `vault_patch` / `vault_create` / `vault_move` / `vault_delete` / `skill_load` /
`cli_run`）。`tools` 缺省时 SHALL 为只读三件 `vault_read` / `vault_search` / `skill_load`；写类工具
与 `cli_run` MUST 由定义显式声明后才可见。未声明的工具 MUST NOT 出现在子运行的工具定义里。

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

时间闸 MUST NOT 中途打断已在执行的工具调用（`cli_run` 自带 60 秒上限即其最坏粒度），故实际
wall-clock 上界为截止时刻加单次工具最长耗时。父回合的停止请求 SHALL 在下一检查点生效：子运行收敛为
中止，父循环走既有停止路径；子运行 MUST NOT 让父回合无限挂起。

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

子会话 SHALL 在内存中按 run id 保留，每父会话上限 4 个、按最久未用淘汰；保留范围 SHALL 限于父会话
生命周期，跨应用重启 MUST NOT 恢复。对已淘汰、已失败（`failed`）、已中止（`aborted`）或跨重启的
run 调用 resume SHALL 回送 `run_not_resumable`。resume MUST NOT 让子运行出现在会话列表、MUST NOT
把它变成可恢复会话。

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

### Requirement: 子运行的批准策略

子运行 MUST NOT 挂在人工批准上等待。权限管线判定为 ask 的调用 SHALL 被拒绝并回送子模型
（`code: "approval_unavailable"`），计入工具结果的 `denied_calls`；deny 规则、危险黑名单命令与
vault 内写重定向三层 MUST 照常生效，MUST NOT 因无人值守而放松。子运行 MUST NOT 自动批准、MUST NOT
把批准请求透传到父会话，也 MUST NOT 复用父会话的批准缓存。定义文件 MUST NOT 携带权限模式字段来
改变用户选定的档位（本版本不采纳 `permissionMode`）。

#### Scenario: 需批准的删除被拒

- **WHEN** 定义声明 `vault_delete` 且权限档为 `vault_write`（该档删除需批准），子运行调用它
- **THEN** 调用被拒并回送 `approval_unavailable`，文件系统不变，`denied_calls` 加一

#### Scenario: deny 规则照常生效

- **WHEN** 用户配置的 deny 规则命中子运行的一次调用
- **THEN** 调用被拒并回送命中规则原文（与交互会话同文案），不进入任何批准等待

### Requirement: 子运行上下文装配与隔离

子运行的 system 上下文 SHALL 由三部分组成：定义的 Markdown 正文（非空时替换固定身份段；为空时只用
固定身份段）、固定的「委托运行约束」段（只做被交代的任务、不与用户交互、不能请求批准、不能再次
委派、结束时直接给出摘要）、以及既有装配的三层 AGENTS.md 与 Skill 索引。任务内容 MUST 只作为一条
user 消息进入，MUST NOT 写入 system 段。

子运行的输入历史 SHALL 从空开始（resume 除外），MUST NOT 继承父会话的任何消息；父会话 MUST NOT
收到子运行的文本、思考或工具调用过程，只收到 `task` 工具结果。子运行 MUST NOT 注入编辑器上下文；
所需路径 SHALL 由 `prompt` 给出。定义正文 MUST NOT 进入主会话上下文。

#### Scenario: 父历史不进入子运行

- **WHEN** 父会话已有若干轮对话后调用 `task`
- **THEN** 子运行的请求历史只含本次任务的 user 消息；不含父会话的任何既有消息

#### Scenario: 正文替换身份段、AGENTS 保留

- **WHEN** 定义正文非空，vault 根有 AGENTS.md
- **THEN** 子运行 system 含定义正文对应的身份内容与 AGENTS.md 内容；固定身份段被正文替换；
  委托约束段仍在场

#### Scenario: 过程不上屏

- **WHEN** 子运行执行多轮工具调用
- **THEN** 父会话面板只出现 `task` 工具卡的进行中与终态（agent + description + 摘要），MUST NOT
  出现子运行的增量文本、思考块或工具调用行

### Requirement: 用量归属主会话与可重算

子运行的 usage SHALL 归入父会话的累计读数：每一运行段结束（任何终态，含失败与中止）时一次性把
`input` / `cached` / `cache_write` / `output` / 样本数折叠进父会话累计器，MUST NOT 只落在审计流水里。
父会话的 `ctx%` MUST NOT 因折叠改变。折叠后的会话累计 cache% 是父与子的混合读数，该含义 SHALL 在
配置文档中写明。

父会话的 wire 留存 SHALL 每段落一条 `subrun` sidecar 记录（run id、segment、agent、模型、终态、
usage、审计文件指针）；「从历史恢复以留存重算读数」的既有口径不变，重算输入 SHALL 包含该类记录，
live 读数与恢复重算读数 MUST 逐字段相等。子运行内部的压缩调用 SHALL 计入该段 token 预算，但 MUST
NOT 折叠进父会话读数（沿用「压缩是内部汇总调用，不计入会话读数」的既有口径）。

#### Scenario: 子运行用量进父读数

- **WHEN** 一次 `task` 运行（含 resume 段）结束
- **THEN** 父会话累计 input / cached / output 读数增加该段的对应值

#### Scenario: 恢复与 live 读数一致

- **WHEN** 完成一次含子运行（含 partial 与 resume）的回合后关闭并恢复该会话
- **THEN** 由留存重算的读数与 live 读数逐字段相等（`subrun` sidecar 是重算输入之一）

#### Scenario: 失败与中止也记账

- **WHEN** 子运行以失败或被用户停止告终
- **THEN** 已发生的 usage 照常折叠进父会话，并落 `subrun` sidecar（终态如实记录）

### Requirement: 子运行留存与诊断

子运行的审计流水 SHALL 落 `<config_dir>/harness/subruns/<vault 稳定 id>/<run_id>.jsonl`，同一 run 的
多个 segment 追加同一文件，与会话留存同 wire 形态、append-only；MUST NOT 写入
`<config_dir>/harness/sessions/`、MUST NOT 写入 vault。子运行 MUST NOT 出现在会话列举 / 恢复 / 删除
三条链路里，MUST NOT 作为可恢复会话存在。审计写失败 MUST NOT 阻断运行，但 SHALL 在完成事件里带出
失败标记。

系统 SHALL 产出四个诊断事件：`subagent_started`、`subagent_finished`、`subagent_rejected`、
`subagent_catalog_large`；完成事件 SHALL 带 run id、segment、agent、终态、触顶原因、轮次、三项 token
读数、被拒调用数、耗时、摘要字符数与审计路径。事件 MUST NOT 含任务 prompt 内容与 vault 绝对路径。

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

`config.json` SHALL 支持 `[harness.subagents]` 节：`enabled`（bool，缺省 true）、`max_turns`
（缺省 20）、`max_tokens`（缺省 200000）、`timeout_secs`（缺省 300）、`max_subruns_per_turn`
（缺省 8）。前四项同时是定义缺省值与定义值的上限：定义未写时取配置值，定义值超过配置值时夹取到
配置值并产 warning。校验 SHALL 沿用既有模板：类型不符整节回落 + 人话 warning；数值越界夹取到合法域
+ warning，MUST NOT 因此丢弃整节或让应用启动失败。

`enabled=false` 或没有任何生效定义时，`task` MUST NOT 注册进工具定义（模型看不见）；对该工具的调用
SHALL 回送 `disabled` 或 `agent_not_found`。`max_subruns_per_turn` SHALL 按父回合计数并拒绝超出的
委派段（`subrun_limit`），只计实际进入执行的段，MUST NOT 静默跳过。

#### Scenario: 非法值夹取

- **WHEN** `timeout_secs` 配为 `0` 或超出合法域
- **THEN** 取合法边界值并产生一条人话 warning，其余键照常生效

#### Scenario: 定义值被配置上限夹取

- **WHEN** 定义写 `max_tokens: 900000`，配置 `max_tokens: 200000`
- **THEN** 子运行按 200000 执行，并产出一条夹取 warning

#### Scenario: 关停后工具不注册

- **WHEN** `[harness.subagents].enabled = false` 后重启应用
- **THEN** 请求里的工具定义不含 `task`；若模型仍发起该调用，回送 `disabled` 且不启动子运行

#### Scenario: 单回合委派次数上限

- **WHEN** `max_subruns_per_turn = 1` 且同一条助手消息含两个 `task` 调用
- **THEN** 第一个正常执行，第二个被拒并回送 `subrun_limit`，`subagent_rejected` 记录原因
