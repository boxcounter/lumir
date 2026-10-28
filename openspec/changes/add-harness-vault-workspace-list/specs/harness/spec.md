# harness 增量规格（change add-harness-vault-workspace-list）

> 起草注记（非规格正文）：本 delta 加两件事——**统一工作区合同**（system 绝对根 + `cli_run`
> 独立 cwd/PWD + 权限同一根解释相对写目标）与 **`vault_list`**（目录与路径发现），并把工具清单从
> 8 件 vault 操作工具改成 9 件。机制取舍、判据落点与测试计划见 [design.md](../../design.md)，
> 裁决留痕见 [proposal.md](../../proposal.md)。
>
> **MODIFIED 块的基线**：四条 MODIFIED requirement 按当前 living spec（`openspec/specs/harness/spec.md`）
> 的整块正文复制再改——`openspec archive` 对 MODIFIED 是整块替换，少抄的段落会在归档时静默消失。
> 未改动的段落与 Scenario 逐字保留。

## ADDED Requirements

### Requirement: harness 工作区（vault 绝对根与路径边界）

每个 harness 运行——交互会话、子代理运行、无人值守定时运行——SHALL 绑定一个**当前 vault**，三层语义 SHALL 取同一个 vault 根，MUST NOT 各自推导：上下文层注入绝对根与路径用法边界；执行层让 `cli_run` 子进程以该目录为工作目录；判定层用同一根解释相对写目标。

上下文层：装配系统上下文时 SHALL 注入一段「工作区」，逐字节含该 vault 的**绝对根路径**（`VaultScope.root` 的值，不是占位符、不是 `~` 展开形态），并写明两种路径的用法边界——`vault_*` 工具只接受与返回 vault 相对路径；`cli_run` 子进程从该目录启动，其相对路径因此就是 vault 内路径；vault 之外的目标用绝对路径表达。该段 SHALL 走固定段的既有装配路径：正文来自仓内模板 `src-tauri/src/harness/prompts/workspace-reference.md`，运行期代入根路径；装配清单（`session_open.assembly`）SHALL 记一条来源 `workspace`，`path` 为该模板的仓内相对路径（非 `null`、非绝对路径），`exists` 恒为 `true`，`bytes` 为**代入后**注入文本的字节数（因此与模板文件不逐字节相等）。

该段 SHALL 对主会话、子代理运行、定时运行三条装配路径同时生效——三者走同一个装配函数，MUST NOT 只在交互路径注入。子代理的定义正文替换的是固定身份段，工作区段 MUST NOT 随之消失。

系统 MUST NOT 把 vault 文件清单或目录树整棵注入该段或任何工具结果（有界输出由「目录与路径发现（`vault_list`）」承担）。

#### Scenario: 绝对根注入

- **WHEN** 在路径为 `<vault>` 的 vault 里发起新会话、发起子代理运行或触发一次定时运行
- **THEN** 该次运行的系统上下文含 `<vault>` 的绝对路径（与 `VaultScope.root` 逐字节一致），并含「`vault_*` 用相对路径 / `cli_run` 从该目录启动 / 外部目标用绝对路径」的边界说明
- **AND** `session_open.assembly` 有 `workspace` 条目：仓内模板相对路径、`exists: true`、`bytes` 非零且等于注入文本字节数

#### Scenario: 装配顺序固定

- **WHEN** 发起新会话
- **THEN** 注入顺序为 identity → workspace → quote_reference → path_reference → 定时任务 → AGENTS.md 三层 → Skill 索引；顺序由装配代码决定，MUST NOT 随 `prompts/` 目录内容或文件名排序变化

#### Scenario: 子代理运行替换身份段但保留工作区

- **WHEN** 子代理定义正文非空
- **THEN** 系统上下文以定义正文替换固定身份段，工作区段仍在场（含同一绝对根）；子运行的装配清单同样有 `workspace` 条目

#### Scenario: 多 vault 各落自己的根

- **WHEN** 先后在 vault A 与 vault B 各发起一次新会话
- **THEN** A 的运行只含 A 的绝对根、B 的运行只含 B 的绝对根；两次上下文互不出现对方的路径

### Requirement: 目录与路径发现（`vault_list`）

系统 SHALL 提供只读 vault 工具 `vault_list`，承担 vault 内目录导航与路径 / 文件名发现，是「定位 → 阅读 / 搜索 → 修改 / 综合」任务链的入口。参数：`path`（vault 相对目录，缺省为 vault 根）、`recursive`（缺省 `false`，只列一层；`true` 才下钻）、`path_glob`（可选路径过滤，`*` 匹配任意字符序列含 `/`、`?` 匹配单个字符——与 `vault_search` 同一写法）、`limit`（有界条数）、`cursor`（上一页的 `next_cursor`）。返回 `entries`（每项含 `path`（vault 相对、`/` 分隔）与 `kind`（`file` / `directory`））、`truncated`、`next_cursor`（仅 `truncated: true` 时出现）。

排序 SHALL 按 `path` 的码点升序，MUST NOT 依赖文件系统枚举顺序或大小写折叠。分页 SHALL 稳定且无状态：`next_cursor` SHALL 为本页最后一条的 `path`，传入 `cursor` 时只返回严格大于该值的条目；`limit` 缺省取有界默认值、超过上限按上限、小于 1 按 1；`truncated: true` 表示本次仍有未返回条目，`truncated: false` 时 MUST NOT 出现 `next_cursor`。

可见性与分类 SHALL 与文件树、`vault_search` 同一套规则（复用 fs-io 的枚举与忽略实现，MUST NOT 另建目录语义）：`hidden` 档命中者不出现、也不下钻；`lazy` 档或用户规则命中的**条目**照常出现为一行（与文件树的「惰性可见」同口径——用户规则不隐藏文件，只让它不进索引），其子树 MUST NOT 展开（`recursive: true` 也不展开）。`path` SHALL 经 vault 内解析校验（绝对路径被拒并提示改用 vault 相对路径；`..` 逃逸拒绝）；`path` 不存在或不是目录时 SHALL 回送结构化错误。

结果 MUST NOT 含文件正文、大小、修改时间等元数据；MUST NOT 一次返回整棵 vault 树。该工具是只读工具：三档权限均 SHALL 直接放行，且 MUST NOT 进入任何批准闸。

#### Scenario: 默认只列一层

- **WHEN** 模型调用 `vault_list()`（vault 根有 `a.md`、目录 `notes/`，`notes/` 内有 `b.md`）
- **THEN** `entries` 恰为根下的一层条目（含 `a.md` 与 `notes/`，不含 `notes/b.md`），每项只有 `path` 与 `kind`；`truncated: false` 且无 `next_cursor`

#### Scenario: 递归与路径过滤

- **WHEN** 模型调用 `vault_list(path: "notes", recursive: true)`，同目录下另有 `notes/2026/c.md`
- **THEN** 结果含 `notes/b.md`、`notes/2026` 与 `notes/2026/c.md`（递归下钻）
- **AND** 追加 `path_glob: "*.md"` 时只返回以 `.md` 结尾的条目（目录条目同样按自身路径匹配）

#### Scenario: 稳定排序与分页

- **WHEN** 某目录有 5 个条目，模型以 `limit: 2` 连续调用三次（第二、三次带上一页的 `next_cursor`）
- **THEN** 三页按 `path` 升序拼起来恰为全部 5 条、无重复无遗漏；前两页 `truncated: true` 且带 `next_cursor`，第三页 `truncated: false` 且无 `next_cursor`
- **AND** 直接以 `cursor` 值为起点重跑得到同一后继分页（分页无服务端状态）

#### Scenario: 忽略规则与惰性目录

- **WHEN** vault 根有 `.DS_Store`（hidden 档）、`.gitignore` 排除 `secret.log`（用户规则），且某目录被 `lazy` 档命中（如 `node_modules`）
- **THEN** `.DS_Store` 不出现在任何一页（hidden 档不可见）；`secret.log` 出现为一行（用户规则是「惰性可见」——与文件树同口径，不隐藏文件）；`node_modules` 出现为一行但其子孙不出现——即使 `recursive: true`

#### Scenario: 越界与非法目标

- **WHEN** 模型调用 `vault_list(path: "../outside")`、`vault_list(path: "/etc")`、`vault_list(path: "missing")`，或对一个文件调用 `vault_list(path: "a.md")`
- **THEN** 每次都被拒绝并回送结构化错误（逃逸 / 绝对路径 / 不存在 / 不是目录各自可区分）；MUST NOT 返回 vault 外任何条目

#### Scenario: 只返回路径与类型

- **WHEN** 模型列出一个含大段正文与二进制文件的目录
- **THEN** 任一 `entries` 项只有 `path` 与 `kind` 两个语义字段；结果里 MUST NOT 出现文件正文、大小或修改时间

### Requirement: cli_run 的工作目录（vault 工作区）

系统 SHALL 为**每次** `cli_run` 子进程单独设置工作目录为当前 vault 根，并同步该子进程的环境变量 `PWD` 为同一目录；MUST NOT 用 `set_current_dir` 一类调用改动 Lumir 主进程的全局 cwd。工作目录 MUST 逐次显式设置（不依赖上一次调用或进程启动时的残留状态），因此同一进程内 vault A 与 vault B 的运行各自落在自己的根上。工具参数 MUST NOT 提供可由模型填写的任意 `cwd`；vault 之外的目标仍以绝对路径在 argv 中表达。

工作目录只决定子进程从哪里启动：命令分类、危险黑名单、allow / deny 规则与模式默认分层 MUST NOT 因它改变（判定仍只看 argv 与写目标的 vault 内判定）。子代理运行与无人值守定时运行遵守同一合同——`cli_run` 落在**该次运行的**当前 vault（子运行 = 发起时的父会话 vault；定时运行 = 任务配置的目标 vault），与上一次调用或进程启动目录无关。

#### Scenario: pwd 返回当前 vault

- **WHEN** 模型在 vault `<vault>` 的会话里调用 `cli_run("pwd", [])`
- **THEN** 子进程 stdout 为 `<vault>` 的绝对路径（末尾换行可有），不是 `/`、不是 Lumir 主进程的工作目录

#### Scenario: A/B vault 各落自己的根

- **WHEN** 先在 vault A、再在 vault B 的会话里各调用一次 `cli_run("pwd", [])`
- **THEN** 两次分别返回 A 与 B 的绝对路径；两次调用之间与之后，Lumir 主进程的 `current_dir` 不变

#### Scenario: 子代理运行的 cwd

- **WHEN** 子代理定义声明了 `cli_run`，父会话在 vault A，模型在 A 的会话里发起子运行
- **THEN** 子运行里的 `pwd` 返回 A——子运行继承**发起时的当前 vault**（与父会话同一个根）；跨 vault
  委派不在本契约内（`task` 没有 `vault` 参数），MUST NOT 据此推断存在跨 vault 能力

#### Scenario: 权限判定不因 cwd 改变

- **WHEN** `full_access` 档下模型调用 `cli_run("touch", ["notes/new.md"])`（`notes/` 在 vault 内）
- **THEN** 该调用仍被 vault 内写重定向拦下（不因 `full_access` 或子进程 cwd 放行），回送 `cli_redirected_to_vault_tool` 与 `suggested_tool: vault_create`

## MODIFIED Requirements

### Requirement: 工具循环

对话运行时 SHALL 支持工具循环：模型返回工具调用时，系统执行对应工具并将结果回送，直至模型不再调用工具或达到循环上限（默认 50，`[harness].loop_max` 可调；出厂值 M367 由 8 上调至 50，上界仍为 64）。达到上限 SHALL 终止循环并在面板给出明确提示。运行时 SHALL 维护会话状态于 Rust core，webview 重载 MUST NOT 丢失会话。工具集 SHALL 为 9 件 vault 操作工具：`vault_read`、`vault_search`、`vault_list`、`vault_patch`、`vault_create`、`vault_move`、`vault_delete`、`skill_load`、`cli_run`；另加 2 类不操作 vault 的工具——1 件编排工具 `task`（change `add-harness-subagents`）与 3 件调度工具 `cron_task_create` / `cron_task_list` / `cron_task_remove`（change `add-cron-conversational-registration`）。`task` 属编排工具，是模型按名字委派子代理的入口，其入参与结果契约见 `harness-subagents` capability；子运行的运行上下文 MUST NOT 获得 `task`（派生深度恰好 1 层，实现口径为工具白名单）。3 件调度工具是交互会话注册定时任务的入口，其入参、校验与回执契约见 `cron` capability；它们 SHALL 只在**交互发送路径**注册——无人值守运行（cron 交接的工具白名单只含 9 件 vault 操作工具）与子运行（定义白名单的元素必须是 vault 操作工具）MUST NOT 获得它们。清单外能力扩张须经 Alex 裁决（ADR 0007；`vault_move` / `vault_delete` 的扩张、`vault_list` 的加入、`task` 与 3 件调度工具的分类均以该 ADR 的修订为口径）。

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

- **WHEN** 同一份配置下分别取交互发送路径、cron 交接的运行路径（工具白名单为 9 件 vault 操作工具）
  与子运行路径的模型工具定义
- **THEN** 只有交互发送路径的请求含 `cron_task_create` / `cron_task_list` / `cron_task_remove`；
  另外两条路径 MUST NOT 含它们（定时运行不能给自己排任务，子代理不能排任务）

### Requirement: 权限机制

系统 SHALL 实现两层权限规则：allow / deny（不存在 `ask` 规则表——需要「必须问」的语义由危险黑名单与模式默认分层承担），判定顺序 deny > allow > 默认分层。规则语法 SHALL 支持 tool 级与 tool+模式级（如 `cli(tavily *)` 的命令前缀匹配）；匹配语义 SHALL 为：模式以 `*` 结尾时按**主体串前缀**匹配，星号前是空格时（生成规则的标准形态，如 `cli(git push *)`）另 SHALL 命中「去掉该尾随空格后逐字相等」的主体串——无参数的 `git push` 与带参数的 `git push origin main` 同样命中，词边界 MUST NOT 因此放宽（`git pushx` 不命中）。allow 规则 SHALL 既可手写于配置，也可由批准卡沉淀（生成、去重与作用域口径见「权限规则的持久化与治理」），并 SHALL 在权限浮层中逐条可见、可删。权限规则之外，系统 SHALL 提供**三档权限模式**作为默认分层的档位：`read_only` / `vault_write`（默认）/ `full_access`，逐档语义如下——读类工具（`vault_read` / `vault_search` / `vault_list` / `skill_load` / `cron_task_list`）三档均直接放行；`vault_patch` / `vault_create` / `vault_move` 在 `read_only` 档 SHALL 逐个问（Always Ask，2026-10-09 Alex 裁决：该档语义为「读自动放行、一切写逐个问」，模式层 MUST NOT 直接拒绝），在 `vault_write` 与 `full_access` 档 SHALL 自动放行；`vault_delete` 在 `read_only` 与 `vault_write` 档 SHALL 逐个问（Vault Write 档的分界以 Alex 裁决点 1 为口径），在 `full_access` 档 SHALL 自动放行；`cli_run` 只读白名单命令三档均直接放行；`cli_run` 写命令在 `read_only` 与 `vault_write` 档 SHALL 逐个问，在 `full_access` 档 SHALL 自动放行（写目标在 vault 内者除外，见「cli_run 命令分类与 vault 写重定向」）；`cron_task_create` / `cron_task_remove` 在 `read_only` 与 `vault_write` 档 SHALL 逐个问、在 `full_access` 档 SHALL 自动放行（定时任务是持续性开销，批准的一刻是用户唯一能看见「它以后会自己跑」的时机）；危险黑名单命令（rm / shutdown·reboot·halt·poweroff / mkfs 系 / dd / git reset --hard / git clean / shell 包装器类，首版清单；shell 包装器中「受限解包」成立的只读形态除外，口径见「cli_run 命令分类与 vault 写重定向」）**任何档都 SHALL 逐个问**，MUST NOT 自动放行。模式层 SHALL 只在「直接放行」与「逐个问」之间切换，SHALL NOT 产出「拒绝」——拒绝只来自用户 deny 规则。

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

### Requirement: cli_run 命令分类与 vault 写重定向

系统 SHALL 在权限判定前对每次 `cli_run` 调用做命令分类：按命令名白名单与参数形态判定为**只读**（如 `ls` / `cat` / `rg` / `git` 的只读子命令族 / 静态度量后可证明不含写与执行命令的 `sed` / `jq` 等；白名单成员的具体清单与每成员的可接受形态以本条下方「只读分类的能力断言」为准）、**危险**（rm / shutdown·reboot·halt·poweroff / mkfs 系 / dd / `git reset --hard` / `git clean` / shell 包装器类，以及白名单成员的可执行参数形态，见本条下方「只读分类的能力断言」）或**写**（其余一切，含未知命令——保守默认）。shell 包装器命令（`sh` / `bash` / `zsh` / `dash` / `fish` / `csh` / `ksh` / `cmd` / `powershell` / `pwsh` / `osascript` / `eval` / `exec` 等）SHALL 默认归为危险——内容不可知即视同潜在危险，任何档都逐个问（2026-10-23 Alex 裁决 D1 起，下述**受限解包**是唯一例外）。`sh` / `bash` / `zsh` / `dash` 的 `-c` / `-lc` / `-cl` 形态（恰好一个脚本参数、无其它参数）SHALL 做受限解包：脚本只由 `;` / `&&` / `||` / `|` 分隔的线性子命令组成、参数为字面量（单 / 双引号内不发散）、只允许 `2>/dev/null` / `>/dev/null` / `1>/dev/null` / `2>&1` 四种整 token 的无害重定向，且**每一个**子命令经本条既有分类判定为只读时，整条调用 SHALL 按只读处理；否则 MUST 维持危险。以下任一形态 MUST 解包失败并维持危险：脚本含变量 / 反引号 / `$( )` / `${ }` / `<` / `>`（白名单外）/ `&`（后台）/ `( )` / `{ }` / here-doc / 换行 / 反斜杠转义；子命令数超过 16、脚本超过 4096 字节；包装器嵌套超过 2 层；`bash script.sh`（脚本文件）形态、多重 flag 形态、裸包装器。解包失败时 MUST NOT 降为「写」——落点只有「只读」与「危险」两种，否则 `full_access` 会静默放行包装脚本；子命令分类 MUST 复用本条的分类判定，MUST NOT 引入第二套分类语义。解包形态下，下述 shell 元字符保守归写规则 MUST NOT 先行适用（由逐子命令判定取代）；非解包形态下该规则不变。任一参数含 shell 元字符（`|` `;` `&&` `||` `>` `>>` `<` 等）的调用 SHALL 保守归为写。三者均 MUST NOT 按命令名白名单放行。

**只读分类的能力断言**：一次 `cli_run` 调用被判为只读，SHALL 意味着按该调用的 argv 与其执行环境，这次调用不写文件、也不执行外部程序（不由该命令自行启动任何程序）。这是一条对任意 argv 成立的能力断言，MUST NOT 以「该命令的常见用法是只读」为放行依据；形态判定不明确时 SHALL 归为写，MUST NOT 归为只读。判据的输入 SHALL 是 argv 与执行环境中可由 argv 静态判定的部分；运行环境中既存的、由用户或外部进程写入的配置文件不在此列——`git` 的仓库配置面按本条下方 git 一段处理。白名单成员出现写文件形态时 SHALL 归为写：`base64` 的 `-o` / `--output`，`xxd` 的第二个位置参数（输出文件；`-r` 与普通 dump 形态相同），`file` 的 `-C` / `--compile`，`tree` 的 `-o` / `-R`，`less` 的 `-o` / `-O` / `--log-file`，`find` 的 `-fprint` / `-fprint0` / `-fprintf` / `-fls`，`sed` 脚本的 `w` / `W` 命令与 `s///w` 标志。白名单成员出现执行外部程序的形态时 SHALL 归为危险：`rg` 的 `--pre` / `--pre-glob` / `--hostname-bin` 与 `-z` / `--search-zip`（解压搜索调起外部解压程序；短旗标簇里的 `-z` 同等命中，`-ez` 这类粘连值形态除外），`sed` 脚本的 `e` 命令与 `s///e` 标志——危险层任何权限档都逐个问，MUST NOT 被 allow 规则或会话缓存解锁。`sed` 的脚本源（`-e` / `--expression=` / 无 `-e`·`-f` 时的第一个非 flag 参数）SHALL 经静态扫描判定；`-f` / `--file` 形态（脚本体在分类时不可见）与无法完整解析的脚本 SHALL 归为写。`sed` 的就地写判定 SHALL 按短旗标簇展开（`-i` 与 `-ni` 一类捆绑形态同等命中）。

`git` 的只读子命令族 SHALL 包含 `status` / `diff` / `log` / `show` / `blame` / `rev-parse` / `ls-files` / `describe` / `shortlog` / `stash list` / `branch` 与 `tag` 的纯列表形态 / `remote -v`；这些子命令 SHALL 在三档权限模式下直接放行（2026-10-24 Alex 裁决：拆档会让只读档名存实亡；安全论证与残余风险见 design §2.4 / §8）。其余子命令（`add` / `commit` / `push` / `checkout` / …）SHALL 归为写。本分类不自行消除仓库配置驱动的执行面（`core.fsmonitor` / `diff.external` / textconv 等）：其默认档免闸写入口由隐藏路径写入面的独立处置关闭（`vault_patch` / `vault_move` / `vault_delete` 对隐藏路径拒绝，见 `vault-patch-hidden-deny-oct24` change）；打开不可信仓库为 vault 时的残余风险如实登记，不由本条分类兜。`git` 的全局 flag SHALL 走白名单（`-P` / `--no-pager` / `--no-optional-locks` / `--no-replace-objects`）；表外全局 flag（含 `-c` / `--config-env` / `--exec-path` / `--git-dir` / `--work-tree` / `-C`）SHALL 归为写——argv 明示的配置注入与外部仓库指向不在「vault 自身仓库配置可信」的前提内。只读子命令出现 `--output` / `--output=<file>` 形态时 SHALL 归为写（`log` / `show` / `shortlog` 写文件；`diff` / `blame` 创建或截断目标文件，实测可把既有文件截为 0 字节）；写目标在 vault 内时仍按 vault 内写重定向条款处理。`git --version` 不受本节限制，仍为只读。

间接调用包装器（`sudo` / `xargs` / `find` 的 `-exec` / `-execdir` / `-ok` / `-okdir`，2026-10-10 Alex 裁决「堵」）SHALL 递归提取被包装命令、以其分类为本条调用的分类：`sudo rm` 视同 `rm`（危险），`sudo ls` 视同 `ls`（只读，不得误伤）。被包装命令取不出确定形态（裸 `sudo` / `xargs` 无命令 / `-exec` 子句不完整）SHALL 保守归为危险——任何档都逐个问。递归 MUST NOT 展开到包装器名单之外（不做通用 shell 语义解析），且 MUST 先于 shell 元字符保守规则判定（`sudo bash -c "a;b"` 按被包装命令判，不因外层参数带元字符落「写」被 `full_access` 放行）。

分类为写、且写目标解析进 vault 内的 `cli_run` 调用，**任何权限档都 SHALL 直接拒绝**并回送结构化重定向提示：固定错误码（`cli_redirected_to_vault_tool`）+ 固定标记文本包裹的 JSON 载荷（`reason` / `targets` / `suggested_tool` 字段固定），指明应改用哪个 vault 工具（`vault_patch` / `vault_create` / `vault_move` / `vault_delete`）。`suggested_tool` SHALL 按写动词形态映射（`mv`/`cp`→`vault_move`、`rm`→`vault_delete`、`sed -i`/重定向→`vault_patch`、`touch`/新文件→`vault_create`、`mkdir`→`vault_create`）——`mkdir` 的落点是 `vault_create`：建目录不另立工具，`vault_create` SHALL 自动创建缺失的父目录（`mkdir -p` 语义）。写目标是否「在 vault 内」的判定 SHALL 与工作区根一致（`cli_run` 子进程的工作目录即当前 vault，见「cli_run 的工作目录（vault 工作区）」）：不含 `..` 的相对写目标一律视为 vault 内目标——**包括根目录下尚不存在的新文件**，MUST NOT 再以「目标或父目录是否存在」作为 vault 归属的佐证（`cli_run` 不再继承主进程 cwd，存在性不再携带归属信息）；绝对路径须词法规范化后落在 vault 根之下才重定向；含 `..` 的路径、以及沿路径上已存在祖先解析到 vault 根之外的符号链接 SHALL NOT 重定向（逃逸防护保持，落回正常写分类）。该判定 SHALL 在**任何**权限档生效，`full_access` 档的 vault 内写同样被重定向。闸门 MUST NOT 自动把 cli_run 改写成 vault 工具调用——重定向只经回送文本由模型自行改道。

#### Scenario: vault 内写被重定向

- **WHEN** 任意模式下模型调用 `cli_run("mv", ["notes/a.md", "notes/b.md"])`
- **THEN** 调用被拒绝（不执行），tool result 含固定标记文本与 JSON 载荷（targets 含 `notes/a.md` / `notes/b.md`，suggested_tool 为 `vault_move`）

#### Scenario: mkdir 写被重定向到 vault_create

- **WHEN** 任意模式下模型调用 `cli_run("mkdir", ["notes/2026"])`（写目标 `notes/2026` 解析进 vault 内）
- **THEN** 调用被拒绝（不执行），tool result 的 `suggested_tool` 为 `vault_create`；下一轮模型经 `vault_create` 在该目录下落文件即连带建出父目录（`mkdir -p` 语义，不另立目录工具）

#### Scenario: 模型改道 vault 工具完成写

- **WHEN** 模型收到上述重定向结果后，下一轮改调 `vault_move(path: "notes/a.md", new_path: "notes/b.md")`
- **THEN** `vault_move` 按模式语义表执行（默认档直接放行），文件完成移动，工具循环继续

#### Scenario: vault 外写不被重定向

- **WHEN** 模型调用 `cli_run("npm", ["install"])`（写目标不在 vault 内）
- **THEN** 调用按模式语义表处理（默认档逐个问），回送中 MUST NOT 出现重定向标记

#### Scenario: 元字符参数保守归类

- **WHEN** 模型调用 `cli_run("ls", ["-la;", "rm", "-rf", "/tmp/x"])`（参数含元字符）
- **THEN** 调用 MUST NOT 因 `ls` 在白名单而放行——整调用按写分类（`read_only` / `vault_write` 档逐个问，`full_access` 档放行）

#### Scenario: shell 包装器任何档都问

- **WHEN** 模式为 `full_access`，模型调用 `cli_run("bash", ["-c", "rm -rf /tmp/x"])`
- **THEN** 调用进入批准闸（批准卡显示完整命令），MUST NOT 自动放行——shell 包装器内容不可知，视同潜在危险；MUST NOT 走进 vault 写重定向层

#### Scenario: 间接调用包装器递归（sudo / xargs / find -exec）

- **WHEN** 模式为 `full_access`，模型调用 `cli_run("sudo", ["rm", "-rf", "/tmp/x"])`（或 `xargs rm` / `find . -exec rm {} \;` 形态）
- **THEN** 调用进入批准闸，MUST NOT 自动放行——被包装命令是黑名单成员，视同直接调用；用户 allow 规则与「本会话不再问」缓存 MUST NOT 解锁本层
- **AND** 同模式下调用 `cli_run("sudo", ["ls", "-la"])` 直接放行（被包装命令是只读白名单，不得误伤）
- **AND** 调用 `cli_run("sudo", [])`（取不出被包装命令）进入批准闸——保守归危险，宁多问勿漏拦

#### Scenario: 只读脚本解包放行

- **WHEN** 默认 `vault_write` 档下模型调用 `cli_run("bash", ["-lc", "ls -la 2>/dev/null; echo ---; ls docs | tail -5"])`
- **THEN** 调用直接执行、不进批准闸——全部子命令（`ls` / `echo` / `ls` / `tail`）都在只读白名单、分隔符与重定向都在安全集内

#### Scenario: 混合脚本仍按危险处理

- **WHEN** 模式为 `full_access`，模型调用 `cli_run("bash", ["-lc", "ls; rm -rf /tmp/x"])` 或 `cli_run("bash", ["-lc", "mkdir docs/new"])`
- **THEN** 调用进入批准闸，MUST NOT 自动放行——存在非只读子命令时整条维持危险（MUST NOT 降为「写」）

#### Scenario: 非白名单重定向与变量使解包失败

- **WHEN** 模型调用 `cli_run("bash", ["-lc", "ls > docs/a.md"])`、`cli_run("bash", ["-lc", "cat < /etc/passwd"])` 或 `cli_run("bash", ["-lc", "echo $HOME"])`
- **THEN** 调用进入批准闸（危险），MUST NOT 因含只读命令 `ls` / `cat` / `echo` 而放行

#### Scenario: 包装器形态不满足或嵌套过深时维持在危险

- **WHEN** 模型调用 `cli_run("bash", ["script.sh"])`、`cli_run("bash", ["-x", "-c", "ls"])` 或三层嵌套的 `bash -lc "bash -lc \"bash -c 'ls'\""`
- **THEN** 调用进入批准闸，MUST NOT 解包放行

#### Scenario: 白名单成员的写形态归写

- **WHEN** 默认 `vault_write` 档下模型调用 `cli_run("base64", ["-i", "a.txt", "-o", "/tmp/out.b64"])`，或调用 `cli_run("xxd", ["in.bin", "/tmp/out.hex"])`（普通 dump 形态）、`cli_run("xxd", ["-ps", "in.bin", "/tmp/out.hex"])`（原子簇选项 + 两个位置参数）、`cli_run("xxd", ["-r", "in.hex", "/tmp/out.bin"])`、`cli_run("file", ["-C", "-m", "magic"])`、`cli_run("find", [".", "-name", "*.md", "-fprint", "/tmp/list.txt"])`
- **THEN** 每次调用都按写分类、进入批准闸（MUST NOT 因命令名在白名单而放行）
- **AND** 同档下 `cli_run("base64", ["-d", "a.txt"])`、`cli_run("xxd", ["a.bin"])`（只有一个位置参数，输出到 stdout）、`cli_run("xxd", ["-ps", "a.bin"])`（原子簇选项、单位置参数，输出到 stdout）、`cli_run("xxd", ["-c", "16", "a.bin"])`（取值旗标的值不计位置参数）、`cli_run("find", [".", "-name", "*.md"])` 仍直接执行（不含写形态）

#### Scenario: sed 脚本的写命令、脚本文件与解析失败

- **WHEN** 默认档模型调用 `cli_run("sed", ["-n", "w /tmp/out.txt", "a.md"])` 或 `cli_run("sed", ["-f", "script.sed", "a.md"])`
- **THEN** 调用按写分类、进入批准闸——前者脚本含 `w` 命令，后者脚本体在分类时不可见
- **AND** 同档下 `cli_run("sed", ["s/a/b/", "a.md"])` 直接执行（脚本可完整解析且不含写 / 执行命令）
- **AND** 无法解析的脚本（如未闭合分隔符）同样按写分类，MUST NOT 按只读放行

#### Scenario: 白名单成员的可执行形态归危险

- **WHEN** 模式为 `full_access`，模型调用 `cli_run("rg", ["--pre", "/tmp/pre.sh", "needle", "."])`、`cli_run("rg", ["--hostname-bin=/tmp/bin", "needle", "."])` 或 `cli_run("rg", ["-z", "needle", "a.md.gz"])`（或 `--search-zip`、簇形态 `-zH`）
- **THEN** 调用进入批准闸，MUST NOT 自动放行——这些形态会执行外部程序（对每个待搜文件执行前置命令 / 为取主机名执行程序 / 调起外部解压程序）
- **AND** 同模式下 `cli_run("rg", ["needle", "."])`、`cli_run("rg", ["--no-search-zip", "needle", "."])`（否定形态，关闭解压、不执行程序）与 `cli_run("rg", ["-ez", "needle", "."])`（`z` 是 `-e` 的粘连值）直接执行
- **AND** `sed` 脚本含 `e` 或 `s///e` 时同样按危险分类（任何档都问）

#### Scenario: git 常用只读子命令保持只读

- **WHEN** 默认档模型调用 `cli_run("git", ["status"])`、`cli_run("git", ["diff"])`、`cli_run("git", ["log", "-1"])` 或 `cli_run("git", ["show", "HEAD"])`
- **THEN** 调用直接执行、不进入批准闸（2026-10-24 Alex 裁决：git 只读子命令族保持只读、不拆档）
- **AND** 同档下 `cli_run("git", ["rev-parse", "HEAD"])`、`cli_run("git", ["ls-files"])`、`cli_run("git", ["branch", "-a"])` 同样直接执行
- **AND** 只读子命令带 `--output` 时改判写：`cli_run("git", ["log", "--output=/tmp/x"])`、`cli_run("git", ["diff", "--output", "/tmp/x"])` 进入批准闸
- **AND** 写子命令仍按写分类：`cli_run("git", ["commit", "-m", "x"])`、`cli_run("git", ["push"])` 进入批准闸

#### Scenario: git 全局 flag 归写

- **WHEN** 模型调用 `cli_run("git", ["--git-dir", "/tmp/other/.git", "diff"])` 或 `cli_run("git", ["-C", "/tmp/other", "status"])` 或 `cli_run("git", ["-c", "diff.external=/tmp/x", "diff"])` 或 `cli_run("git", ["-cdiff.external=/tmp/x", "diff"])`
- **THEN** 调用按写分类、进入批准闸——全局 flag 不在白名单内（`-c` / `--config-env` / `--exec-path` / `--git-dir` / `--work-tree` / `-C` 可注入或指向 vault 之外的仓库配置）
- **AND** `cli_run("git", ["--no-pager", "rev-parse", "HEAD"])` 与 `cli_run("git", ["--no-pager", "status"])` 仍直接执行（白名单内全局 flag + 只读子命令）

### Requirement: 系统提示词固定段来源

系统提示词的固定段正文——身份段（装配清单来源 id `identity`）、摘录回指纪律（来源 id `quote_reference`）与工作区段（来源 id `workspace`）——SHALL 以仓内 Markdown 文件为**唯一**真源：`src-tauri/src/harness/prompts/identity.md`、`src-tauri/src/harness/prompts/quote-reference.md` 与 `src-tauri/src/harness/prompts/workspace-reference.md`，经编译期嵌入进入程序。文件名与来源 id SHALL 一一对应（`identity` ↔ `identity.md`、`quote_reference` ↔ `quote-reference.md`，仅 `_` ↔ `-` 的命名转换不同），使「id → 文件」与「文件 → id」双向可检索；代码侧 SHALL 同时保留指向来源文件的仓内路径常量。系统 MUST NOT 在运行期从配置目录、vault 或任何外部路径读取这两段正文的覆盖内容，也 MUST NOT 在代码里保留第二份正文副本。

固定段的注入顺序 SHALL 仍由装配代码决定（identity → workspace → quote_reference → path_reference → 定时任务 → AGENTS.md 三层 → Skill 索引），MUST NOT 改为目录枚举顺序或文件名字典序——`prompts/` 目录内新增或重命名其他文件 MUST NOT 改变装配结果。装配处 SHALL 消化来源文件的末尾空白（每段统一 trim 一次，消化文件尾换行与既有字面量的差异），注入文本其余字节 SHALL 与来源文件正文逐字节一致（MUST NOT 重排、重折行、转义改写）；文件尾换行 / 行尾空白 MUST NOT 进入注入文本，固定段与相邻节的拼接格式（`\n\n===== 标题 =====\n` + 正文）SHALL 与改造前逐字节一致。

工作区段的正文是**模板**：运行期代入当前 vault 的绝对根路径，注入文本因此 MUST NOT 被断言为与模板文件逐字节相等（其余固定段照旧逐字节相等），它的清单条目 `bytes` 取代入后的注入文本字节数。装配清单（`session_open.assembly`，形态见「会话本地留存」）中各固定段的条目 SHALL 记录来源文件的**仓内相对路径**（`src-tauri/src/harness/prompts/identity.md` / `src-tauri/src/harness/prompts/quote-reference.md`）：`path` MUST NOT 为 `null`，MUST NOT 为构建机绝对路径（绝对路径会把本机用户名写进会话留存）；`exists` SHALL 恒为 `true`，`bytes` SHALL 为注入（trim 后）文本的字节数。

#### Scenario: 固定段正文来自仓内文件

- **WHEN** 修改 `src-tauri/src/harness/prompts/identity.md` 或 `quote-reference.md` 的正文，重新构建并发起新会话
- **THEN** 系统提示词中对应固定段逐字节等于文件正文（去掉末尾空白），不残留旧的硬编码文案

#### Scenario: 尾空白不进入注入文本

- **WHEN** 来源文件以换行（或行尾空白）结尾
- **THEN** 注入文本不以该换行 / 空白结尾，且固定段的拼接格式与改造前的装配输出逐字节一致

#### Scenario: 装配清单记录固定段来源路径

- **WHEN** 发起新会话
- **THEN** `session_open.assembly` 的 `identity` / `quote_reference` 条目 `source` 与文件名一一对应，`path` 为上述仓内相对路径（非 `null`、非绝对路径），`exists` 为 `true`，`bytes` 等于注入文本的字节数

#### Scenario: 装配顺序不随目录内容变化

- **WHEN** `prompts/` 目录内新增或重命名其他文件
- **THEN** 固定段的注入顺序仍为 identity → workspace → quote_reference（其后是 path_reference、定时任务、AGENTS.md 三层与 Skill 索引），装配结果不随目录枚举顺序或文件名字典序变化
