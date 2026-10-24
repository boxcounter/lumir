# harness 增量规格

> 起草注记（非规格正文）：本 delta 只处理**工具清单与权限档**在同一次扩张里的两处口径，工具行为
> 本身见 `cron` capability 的「对话式任务注册」。设计见 [design.md](../../design.md) §2 / §6。
>
> **MODIFIED 块的基线（2026-10-24 重写）**：`openspec archive` 对 MODIFIED 是整块替换，少抄的段
> 会在归档时静默消失，故两块都按**各自前置 change 归档后**的 living 形态撰写：
>
> - 「工具循环」：按 `add-harness-subagents` **已归档**后的 living（8 件 vault 工具 + 1 件编排工具
>   `task`）为基线，本 change 追加 3 件调度工具及其注册面约束。
> - 「权限机制」：按 `harness-permission-rules-oct23` **归档后**的 living（两层权限规则 allow /
>   deny + 受限解包例外 + allow 规则的持久化治理引用）为基线，本 change 追加 3 件调度工具的档位、
>   批准卡要素与缓存主体串口径。旧稿的权限条目已按「两层 + 受限解包」重写，不再保留旧文本。
>
> **归档顺序**：`add-cron-runtime-daemon`（已归档）→ `add-harness-subagents`（已归档）→
> `harness-permission-rules-oct23` → 本 change。permission-rules 未归档前本 change MUST NOT 归档
> （否则归档会把 living 的权限条目回退成三层 / 丢失受限解包段）；`rg-zip-flags-dangerous-oct24`
> 只改 `cli_run` 一条，与本 change 无 requirement 交集，顺序互不影响。

## MODIFIED Requirements

### Requirement: 工具循环

对话运行时 SHALL 支持工具循环：模型返回工具调用时，系统执行对应工具并将结果回送，直至模型不再调用工具或达到循环上限（默认 50，`[harness].loop_max` 可调；出厂值 M367 由 8 上调至 50，上界仍为 64）。达到上限 SHALL 终止循环并在面板给出明确提示。运行时 SHALL 维护会话状态于 Rust core，webview 重载 MUST NOT 丢失会话。工具集 SHALL 为 8 件 vault 操作工具：`vault_read`、`vault_search`、`vault_patch`、`vault_create`、`vault_move`、`vault_delete`、`skill_load`、`cli_run`；另加 2 类不操作 vault 的工具——1 件编排工具 `task`（change `add-harness-subagents`）与 3 件调度工具 `cron_task_create` / `cron_task_list` / `cron_task_remove`（change `add-cron-conversational-registration`）。`task` 属编排工具，是模型按名字委派子代理的入口，其入参与结果契约见 `harness-subagents` capability；子运行的运行上下文 MUST NOT 获得 `task`（派生深度恰好 1 层，实现口径为工具白名单）。3 件调度工具是交互会话注册定时任务的入口，其入参、校验与回执契约见 `cron` capability；它们 SHALL 只在**交互发送路径**注册——无人值守运行（cron 交接的工具白名单只含 8 件 vault 操作工具）与子运行（定义白名单的元素必须是 vault 操作工具）MUST NOT 获得它们。清单外能力扩张须经 Alex 裁决（ADR 0007；`vault_move` / `vault_delete` 的扩张、`task` 与 3 件调度工具的分类均以该 ADR 的修订为口径）。

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

#### Scenario: 调度工具只在交互路径注册

- **WHEN** 同一份配置下分别取交互发送路径、cron 交接的运行路径（工具白名单为 8 件 vault 操作工具）
  与子运行路径的模型工具定义
- **THEN** 只有交互发送路径的请求含 `cron_task_create` / `cron_task_list` / `cron_task_remove`；
  另外两条路径 MUST NOT 含它们（定时运行不能给自己排任务，子代理不能排任务）

### Requirement: 权限机制

系统 SHALL 实现两层权限规则：allow / deny（不存在 `ask` 规则表——需要「必须问」的语义由危险黑名单与模式默认分层承担），判定顺序 deny > allow > 默认分层。规则语法 SHALL 支持 tool 级与 tool+模式级（如 `cli(tavily *)` 的命令前缀匹配）；匹配语义 SHALL 为：模式以 `*` 结尾时按**主体串前缀**匹配，星号前是空格时（生成规则的标准形态，如 `cli(git push *)`）另 SHALL 命中「去掉该尾随空格后逐字相等」的主体串——无参数的 `git push` 与带参数的 `git push origin main` 同样命中，词边界 MUST NOT 因此放宽（`git pushx` 不命中）。allow 规则 SHALL 既可手写于配置，也可由批准卡沉淀（生成、去重与作用域口径见「权限规则的持久化与治理」），并 SHALL 在权限浮层中逐条可见、可删。权限规则之外，系统 SHALL 提供**三档权限模式**作为默认分层的档位：`read_only` / `vault_write`（默认）/ `full_access`，逐档语义如下——读类工具（`vault_read` / `vault_search` / `skill_load` / `cron_task_list`）三档均直接放行；`vault_patch` / `vault_create` / `vault_move` 在 `read_only` 档 SHALL 逐个问（Always Ask，2026-10-09 Alex 裁决：该档语义为「读自动放行、一切写逐个问」，模式层 MUST NOT 直接拒绝），在 `vault_write` 与 `full_access` 档 SHALL 自动放行；`vault_delete` 在 `read_only` 与 `vault_write` 档 SHALL 逐个问（Vault Write 档的分界以 Alex 裁决点 1 为口径），在 `full_access` 档 SHALL 自动放行；`cli_run` 只读白名单命令三档均直接放行；`cli_run` 写命令在 `read_only` 与 `vault_write` 档 SHALL 逐个问，在 `full_access` 档 SHALL 自动放行（写目标在 vault 内者除外，见「cli_run 命令分类与 vault 写重定向」）；`cron_task_create` / `cron_task_remove` 在 `read_only` 与 `vault_write` 档 SHALL 逐个问、在 `full_access` 档 SHALL 自动放行（定时任务是持续性开销，批准的一刻是用户唯一能看见「它以后会自己跑」的时机）；危险黑名单命令（rm / shutdown·reboot·halt·poweroff / mkfs 系 / dd / git reset --hard / git clean / shell 包装器类，首版清单；shell 包装器中「受限解包」成立的只读形态除外，口径见「cli_run 命令分类与 vault 写重定向」）**任何档都 SHALL 逐个问**，MUST NOT 自动放行。模式层 SHALL 只在「直接放行」与「逐个问」之间切换，SHALL NOT 产出「拒绝」——拒绝只来自用户 deny 规则。

判定总序 SHALL 为：deny 规则 > vault 内写重定向 > 危险黑名单 > allow 规则 > 模式默认分层——前四层模式无关，allow 规则 SHALL 在任何档生效（含 `read_only` 档），模式只替换最底层默认分层。deny 命中 SHALL 直接拒绝并回送模型：拒绝对话 MUST NOT 进入批准闸（不产批准卡、不等待用户决定），且回送的错误 SHALL 带上**命中的规则原文**（如「命中 deny 规则 cli(npm run deploy*)」），使「是哪条规则拦的」不必回配置文件核对；规则原文拼入后若超出工具行摘要的展示长度上限，SHALL 退回不带规则原文的既有文案，MUST NOT 呈现被截断的规则名。ask 档 SHALL 以批准闸呈现：执行前挂起循环，面板显示待批准项（写文档显示 diff 预览，CLI 显示完整命令），Alex 采纳后才执行，拒绝（及可选原因）回送模型；未决批准项 MUST NOT 自动超时通过。`cron_task_create` / `cron_task_remove` 的批准卡 SHALL 呈现该次动作的任务要素——`create`：`at`、`days`、`delivery`、`session`、目标 vault、`prompt` 全文，以及「注册当日是否补触发」；`remove`：任务 `id` 与 `at`。会话内批准缓存（「采纳且本会话不再问」）对这两件工具的主体串 SHALL 由 `id` / `at` / `days` 组成，MUST NOT 包含 `prompt`（主体串会进缓存键与诊断，`prompt` 的私密内容只出现在批准卡与会话留存里）。

#### Scenario: 默认档放行矩阵

- **WHEN** 模式为默认 `vault_write`，模型先后调用 `vault_read`、`vault_patch`、`cli_run("ls", ["-la"])`、`cli_run("npm", ["install"])`
- **THEN** `vault_read` / `vault_patch` / 白名单 `ls` 直接执行；`npm install` 挂起等待面板批准

#### Scenario: 只读档逐个问 vault 写（Always Ask）

- **WHEN** 模式为 `read_only`，模型调用 `vault_patch`
- **THEN** 调用进入批准闸等待用户决定（MUST NOT 直接拒绝、MUST NOT 自动执行）；用户拒绝后调用不执行、磁盘不变
- **AND** 同模式下模型调用 `vault_read` 则直接执行（读类自动放行）

#### Scenario: 危险黑名单任何档都问

- **WHEN** 模式为 `full_access`，模型调用 `cli_run("rm", ["-rf", "/tmp/x"])`
- **THEN** 调用进入批准闸等待用户决定，MUST NOT 自动放行

#### Scenario: deny 与 allow 规则跨模式优先序

- **WHEN** 模式为 `read_only`，配置 allow 规则含 `cli(npm run *)`，deny 规则含 `cli(npm run deploy*)`；模型调用 `cli_run("npm", ["run", "test"])`
- **THEN** `npm run test` 直接执行（allow 规则在只读档生效）；同模式下调 `npm run deploy` 则被 deny 规则拒绝

#### Scenario: deny 规则原文随拒绝回送

- **WHEN** 配置 deny 规则含 `cli(npm run deploy*)`，模型在任意档调用 `cli_run("npm", ["run", "deploy"])`
- **THEN** 调用被拒（不进批准闸、面板不出现批准卡），回送模型的错误里出现命中的规则原文 `cli(npm run deploy*)`，工具行显示该错误摘要

#### Scenario: 会话内同类不再问

- **WHEN** `vault_write` 档下 Alex 对某 `cli_run` 写命令点「采纳且本会话不再问」，同一会话内模型再次以相同规范化主体串（或同一命令前缀）调用同一命令
- **THEN** 第二次调用直接执行不进批准闸；「新会话」后同命令恢复逐个问

#### Scenario: 默认分层生效

- **WHEN** 模型先调用 `vault_read` 再调用 `vault_patch`（默认 `vault_write` 档，均无规则命中）
- **THEN** `vault_read` 直接执行；`vault_patch` 直接执行（默认档写工具自动放行）

#### Scenario: deny 优先

- **WHEN** 一条 `cli_run` 同时匹配 allow 与 deny 规则
- **THEN** 该调用被拒绝并把原因回送模型，不进入批准闸

#### Scenario: 采纳与拒绝

- **WHEN** 面板收到 ask 档批准项的预览（写文档显示 diff、CLI 显示完整命令），Alex 点击采纳（或拒绝）
- **THEN** 采纳则执行（写工具落盘口径不变）；拒绝则副作用不发生，模型收到对应结果

#### Scenario: 持久 allow 规则在任意档生效

- **WHEN** Alex 经批准卡持久化 `cli(tvly search *)`（或手写于配置），随后在 `read_only` 档模型调用 `cli_run("tvly", ["search", "x"])`
- **THEN** 调用直接执行、不进批准闸——allow 规则在任何档生效；规则原文在同一浮层的「已记住的规则」段可见

#### Scenario: 前缀规则的词边界与等值匹配

- **WHEN** 配置 allow 规则含 `cli(git push *)`，模型分别调用 `cli_run("git", ["push"])`、`cli_run("git", ["push", "origin", "main"])` 与 `cli_run("git", ["pushx"])`
- **THEN** 无参数的 `git push` 与带参数的 `git push origin main` 都直接执行、不进批准闸（星号前的空格是词边界，等值形态一并命中）；`git pushx` 不命中该规则——词边界 MUST NOT 因等值容差而放宽

#### Scenario: 定时任务工具的档位

- **WHEN** 模式为默认 `vault_write`，模型调用 `cron_task_list` 与 `cron_task_create`
- **THEN** `cron_task_list` 直接执行（读类，无副作用）；`cron_task_create` 进入批准闸
- **AND** 模式为 `read_only` 时两者行为不变（`list` 直接执行、`create` 仍进闸）；模式为
  `full_access` 时 `create` 直接执行

#### Scenario: 任务批准卡呈现要素

- **WHEN** `cron_task_create` 进入批准闸
- **THEN** 卡片呈现 `at` / `days` / `delivery` / `session` / 目标 vault / `prompt` 全文与「注册当日
  是否补触发」；`prompt` 的全文不出现在诊断日志里
- **AND** 用户对本条点「采纳且本会话不再问」后，同一 `id` + `at` + `days` 的再次创建不再进闸，
  改 `prompt` 但时间不变的创建同样不再进闸（主体串不含 `prompt`）
