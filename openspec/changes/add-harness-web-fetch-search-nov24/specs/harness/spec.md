## MODIFIED Requirements

### Requirement: Skill 支持

系统 SHALL 自动发现 user-wide（`~/.agents/skills/`）与 vault-wide（`<vault>/.agents/skills/`）两处的 Skill（SKILL.md 约定），vault-wide 同名覆盖 user-wide。Skill 索引（name + description）SHALL 注入系统上下文；`skill_load(name)` 工具 SHALL 按名加载 SKILL.md 全文，路径解析 MUST 限定在两个 Skill 根内（只读、防逃逸）。与网页无关的外部能力 SHALL 以「Skill + 对应 CLI」形态接入；统一 `web_search` / `web_fetch` 是本条明确列入工具集的外部网页阅读合同，首个 provider 为 DeepSeek。后续搜索 / 抓取 provider MUST 并入同一工具合同，MUST NOT 为特定服务另造专用工具名、别名或第二套结果形状。

除模型自主判断外，用户 SHALL 可经输入区显式选择点名 Skill，由后端确定性加载；两条入口的缺省、分控、
权限与留存见「Skill 的混合调用与入口策略」。文本里的 `/名字` 字样 MUST NOT 被当作显式调用依据。
该新增入口 MUST NOT 改变默认 Skill 的索引注入与模型自主 `skill_load` 能力；索引仍是会话建立 / 新会话 /
压缩时装配一次的会话快照。

前端清单 SHALL 只有一个发现来源：`harness_skills_list` 复用 `discover_skills`，不得另写双根遍历或覆盖
逻辑。候选只显示符合 `/` grammar、元数据合法且允许用户调用的条目；该过滤 MUST NOT 移除索引中的禁手动
条目，也 MUST NOT 阻止禁自动条目被用户显式选择。

候选清单 / 回合工具策略（实时发现）与系统提示索引（会话快照）SHALL 允许不同源：会话中途新增或改策略的
Skill 可在当回合按新发现结果执行，但索引不因它重装配；会话中途删除的 Skill 可仍在索引里，新的显式或自动
加载按当回合发现结果返回不存在。系统 MUST NOT 为消除该差异而在会话中途重装配系统提示。

#### Scenario: 索引注入与按需加载

- **WHEN** Skill 根下存在某外部搜索技能且 Alex 提问需要联网搜索
- **THEN** 模型可见技能索引中的该技能条目，经 `skill_load` 取得用法后经 `cli_run` 调用对应 CLI

#### Scenario: 路径逃逸拒绝

- **WHEN** `skill_load` 收到指向 Skill 根外的路径或名称
- **THEN** 拒绝并回送错误，不读取任何根外文件

#### Scenario: 清单命令与索引同源

- **WHEN** vault 内新增一个与 user-wide 同名的 Skill（或新增一个全新 Skill），随后打开候选
- **THEN** 同名条目只出现一条且 `source` 为 `vault`，其 description 与调用策略也整体来自 vault；
  全新技能在允许用户调用时出现在候选里，但系统提示索引在本次会话内不因它改变

#### Scenario: 清单失败不阻断输入

- **WHEN** 清单命令失败、返回坏 JSON 或当前没有打开 vault
- **THEN** 候选按空清单处理，输入区键入、发送与既有错误提示不受影响；已有引用 chip 仍按引用渲染，
  不误标缺失或禁用

#### Scenario: 候选过滤不削弱自动发现

- **WHEN** Skill 根下存在禁手动、禁自动与 grammar 之外的技能
- **THEN** 禁手动不进候选但仍进索引并可自动加载；禁自动不进模型自动执行但仍可显式选择；grammar 之外
  的名字不进候选，其现有索引与 `skill_load` 口径逐条不变

#### Scenario: 统一 Web 工具是明确例外而非服务别名

- **WHEN** `harness.web_access.enabled=true` 且交互主会话需要搜索或读取网页
- **THEN** 模型使用统一的 `web_search` / `web_fetch` 合同，首 provider 为 DeepSeek；系统不得再要求该链路
  必须经 Skill + CLI，也不得提供 DeepSeek 专用搜索别名

### Requirement: 工具循环

对话运行时 SHALL 支持工具循环：模型返回工具调用时，系统执行对应工具并将结果回送，直至模型不再调用工具或达到循环上限（默认 50，`[harness].loop_max` 可调；出厂值 M367 由 8 上调至 50，上界仍为 64）。达到上限 SHALL 终止循环并在面板给出明确提示。运行时 SHALL 维护会话状态于 Rust core，webview 重载 MUST NOT 丢失会话。工具集 SHALL 为 9 件 vault 操作工具：`vault_read`、`vault_search`、`vault_list`、`vault_patch`、`vault_create`、`vault_move`、`vault_delete`、`skill_load`、`cli_run`；另有不操作 vault 的编排工具 `task`、调度工具 `cron_task_create` / `cron_task_list` / `cron_task_remove`，以及交互主会话的 2 件 Web 阅读工具 `web_search` / `web_fetch`。`task` 属编排工具，是模型按名字委派子代理的入口，其入参与结果契约见 `harness-subagents` capability；子运行的运行上下文 MUST NOT 获得 `task`（派生深度恰好 1 层，实现口径为工具白名单）。3 件调度工具是交互会话注册定时任务的入口，其入参、校验与回执契约见 `cron` capability；它们 SHALL 只在**交互发送路径**注册——无人值守运行（cron 交接的工具白名单只含 9 件 vault 操作工具）与子运行（定义白名单的元素必须是 vault 操作工具）MUST NOT 获得它们。2 件 Web 阅读工具 SHALL 只在 `harness.web_access.enabled=true` 时于交互主会话注册，缺省 / false 不注册且幻觉调用回送 `tool_unknown`；cron 与子运行 MUST NOT 获得它们，本 change 不扩大既有 9 件白名单或内建 `general`。清单外能力扩张须经 Alex 裁决（ADR 0007；`vault_move` / `vault_delete` 的扩张、`vault_list` 的加入、`task` 与 3 件调度工具的分类均以该 ADR 的修订为口径）。

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

#### Scenario: Web 工具只在交互主会话注册

- **WHEN** `harness.web_access.enabled=true` 时分别取交互主会话、cron 交接与子运行的模型工具定义
- **THEN** 只有交互主会话含 `web_search` / `web_fetch`；另外两条路径不含它们，既有 9 件 vault 工具
  白名单与内建 `general` 不因此扩权
- **AND** `harness.web_access.enabled` 缺省或为 false 时，三条路径都不含这两件工具，幻觉调用回送
  `tool_unknown`，不解析 provider 且不产生网络请求

### Requirement: 权限机制

系统 SHALL 实现两层权限规则：allow / deny（不存在 `ask` 规则表——需要「必须问」的语义由危险黑名单与模式默认分层承担），判定顺序 deny > allow > 默认分层。规则语法 SHALL 支持 tool 级与 tool+模式级（如 `cli(tavily *)` 的命令前缀匹配）；匹配语义 SHALL 为：模式以 `*` 结尾时按**主体串前缀**匹配，星号前是空格时（生成规则的标准形态，如 `cli(git push *)`）另 SHALL 命中「去掉该尾随空格后逐字相等」的主体串——无参数的 `git push` 与带参数的 `git push origin main` 同样命中，词边界 MUST NOT 因此放宽（`git pushx` 不命中）。allow 规则 SHALL 既可手写于配置，也可由批准卡沉淀（生成、去重与作用域口径见「权限规则的持久化与治理」），并 SHALL 在权限浮层中逐条可见、可删。权限规则之外，系统 SHALL 提供**三档权限模式**作为默认分层的档位：`read_only` / `vault_write`（默认）/ `full_access`，逐档语义如下——读类工具（`vault_read` / `vault_search` / `vault_list` / `skill_load` / `cron_task_list`）三档均直接放行；`vault_patch` / `vault_create` / `vault_move` 在 `read_only` 档 SHALL 逐个问（Always Ask，2026-10-09 Alex 裁决：该档语义为「读自动放行、一切写逐个问」，模式层 MUST NOT 直接拒绝），在 `vault_write` 与 `full_access` 档 SHALL 自动放行；`vault_delete` 在 `read_only` 与 `vault_write` 档 SHALL 逐个问（Vault Write 档的分界以 Alex 裁决点 1 为口径），在 `full_access` 档 SHALL 自动放行；`cli_run` 只读白名单命令三档均直接放行；`cli_run` 写命令在 `read_only` 与 `vault_write` 档 SHALL 逐个问，在 `full_access` 档 SHALL 自动放行（写目标在 vault 内者除外，见「cli_run 命令分类与 vault 写重定向」）；`cron_task_create` / `cron_task_remove` 在 `read_only` 与 `vault_write` 档 SHALL 逐个问、在 `full_access` 档 SHALL 自动放行（定时任务是持续性开销，批准的一刻是用户唯一能看见「它以后会自己跑」的时机）；危险黑名单命令（rm / shutdown·reboot·halt·poweroff / mkfs 系 / dd / git reset --hard / git clean / shell 包装器类，首版清单；shell 包装器中「受限解包」成立的只读形态除外，口径见「cli_run 命令分类与 vault 写重定向」）**任何档都 SHALL 逐个问**，MUST NOT 自动放行。模式层 SHALL 只在「直接放行」与「逐个问」之间切换，SHALL NOT 产出「拒绝」——拒绝只来自用户 deny 规则。

`web_search` / `web_fetch` SHALL 属于独立的 `web_read` 权限类，MUST NOT 加入上述读类工具白名单。
在本 change 的 D1 默认下，两件工具在 `read_only` / `vault_write` / `full_access` 三档的模式默认均
SHALL 逐个问；显式 allow 规则与会话内批准缓存 SHALL 按「Web 工具批准与规则」条的粒度减少后续批准，
但 MUST NOT 跳过执行期的 URL、DNS、重定向、内容类型、预算或密钥检查。`web_read` 是权限分类，
MUST NOT 被实现成第三件工具或第四档权限模式。

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

#### Scenario: Web 工具不随 full_access 静默外发

- **WHEN** 模式为 `full_access`，模型在未命中 allow 或会话缓存时调用 `web_search` 或 `web_fetch`
- **THEN** 调用仍进入批准闸，完整 query / URL 与 DeepSeek 外发说明可见；它不得因 `vault_read` 或
  `full_access` 的默认放行而直接产生网络请求

### Requirement: 配置节 [harness]

`config.json` SHALL 支持 `[harness]` 节：`provider`（当前使用项的 provider id 字符串；键可省，
缺省 / 空串 / 悬空时按本条的回退规则解析，空串额外给一条 warning）、`providers` 表（**以 provider id 为键的对象映射**，每个值
是 provider 条目：`preset`（`kimi` / `deepseek` / `generic` / `mock`；缺键按 `generic` 处理
并给一条 warning，旧三档由迁移补齐，见「provider 配置迁移」条）、`api_key`、`model`、可选
`base_url`、`models` 模型清单（元素 schema 见本文件「模型清单声明」条）、可选 `wire_api`——
闭集合 `responses` / `chat_completions`，缺省随预设；`mock` 预设为 `fixture` 路径）、
`permissions`（`allow` / `deny` 规则表）、`permission_mode`（闭集合 `read_only` /
`vault_write` / `full_access`，默认 `vault_write`）、`loop_max`、`warn_ctx_pct`、
`auto_compact`（默认 `true`）、`session_naming` 表（会话自动命名，三键都可省：`enabled`——
默认 `true`，关闭后不发起任何命名调用、不写标题记录；`provider`——可选 provider id，缺省
`null` = 命名调用发往当前使用的 provider，非空但不在 `providers` 表内（或对应条目被装载期忽略）时 SHALL 回落当前使用项
并给一条人话 warning；`model`——可选模型 id，缺省 `null` = 选定 provider 的生效模型，非空须在
选定 provider 的 `models` 清单内声明，未声明 SHALL 回落 `null` 并给一条人话 warning；mock
provider 无模型清单，`model` 只能为 `null`）、`attachment_naming` 表（与会话命名同形，另有
`vision` 资格闸，见 change `add-semantic-image-naming`）、`subagents` 表、`web_access` 表
（只含 `enabled`，缺省 `false`；只有显式 `true` 才注册 `web_search` / `web_fetch`，关闭不删除
provider、持久 origin 或历史）。命名调用的 provider / 模型 / wire 方言 / `api_key` / `base_url`
SHALL 同出一个 provider 条目。

`web_access.enabled` 的缺省 / false SHALL 使两件 Web 工具不注册且不解析 Web provider；开启后的
下一回合才按新配置快照注册。设置快照 / patch / revision SHALL 覆盖该键，恢复默认 = 删键；
provider 增删 / 切换 MUST NOT 重置它。持久 origin 仍归 `permissions.allow`，MUST NOT 复制进
`web_access`。该键类型不符时 SHALL 沿用本条既有整文件回落模板，回落后为关闭。

`providers` 表 SHALL 是动态映射：provider id 由用户定义（`mock` 为验收专用保留 id），任何满足
`^[a-z0-9][a-z0-9_-]{0,31}$` 的 id 都可出现；条目数量 MUST NOT 被限制为固定值。每个条目的行为
SHALL 由 `preset` 决定，MUST NOT 由 id 字面量推断（id 叫 `kimi` 不构成任何协议保证）。同一预设
SHALL 可被多个条目复用（例如工作 / 个人两把 Key 各建一条）。

provider 当前使用项的解析 SHALL 按以下顺序：① `provider` 是合法 id、在映射内且该条目未被装载期忽略 → 用它（即使
其 `configured` 为 `false`，MUST NOT 自动替换用户显式选择；显式 `"mock"` 同样生效）；②
`provider` 缺省 → 按预设顺序 `kimi` → `deepseek` → `generic`（同组内按 id 字典序）取第一个
`configured` 为 `true` 的**非 `mock`** 条目；③ 没有 `configured` 条目 → 按同一顺序取第一个
合法**非 `mock`** 条目；④ 映射为空（或只剩 `mock`）→ 无当前使用项；⑤ `provider` 非空但不在
映射内 → 按 ②/③ 回退并给一条人话 warning，点名原值与落点。`mock` 是验收专用保留档，MUST NOT
被缺省回退自动选中——否则一份只剩 mock 的配置会让应用在用户不知情时进入 fixture 驱动模式。
`configured` SHALL 由后端派生（不落盘）：`mock` 预设为 `fixture` 非空；`generic` 预设为模型
清单非空且 Base URL 非空；`kimi` / `deepseek` 预设为 `api_key` 去空白后非空且模型清单非空。
`provider` 写成非字符串时 SHALL 整文件回落（ADR 0002 §5 既有模板）。

单个 provider 条目的校验 SHALL 逐条进行：条目不是对象、`preset` 非法、字段类型不符时 SHALL
只丢弃该条目并给一条点名 id 的 warning，MUST NOT 拖垮整份配置或其它条目（与
`vault.ignore` 地图、`permissions.allow` 清单的逐项口径同族）。条目里设置面不认识的子键
SHALL 在运行期忽略；经设置面板保存时 SHALL 原样保留（见 `settings` 的「设置写通道」条）。
未知字段 MUST NOT 被静默删除。`preset` 决定官方 Base URL、是否发送 `store:false`、超限特征串
与缺省 wire 方言，逐预设口径见本文件「provider 条目与预设」条。

校验 SHALL 沿用既有模板：缺字段回落默认不告警；预设的闭集合取值非法按条目丢弃 + 人话 warning；
类型不符整文件回落（ADR 0002 §5）。运行期写回 SHALL 经泛化的 `config_set_value(section, key,
value)`，`ui` 表既有行为不变；设置面板的 provider / 当前使用项 / 模型 / 命名目标 / 自动化写回
SHALL 走 `settings_apply`（见 `settings` capability 的「设置写通道」条），MUST NOT 复用本命令。
命名目标的两个覆盖键仍是本节的 `session_naming` / `attachment_naming` 表，设置面板只是它们的
编辑面：面板写入的 provider 必须是本节的合法条目、model 必须在目标清单内，解析与回落规则
MUST NOT 因编辑面而改变；开关关闭时这两个键 MUST NOT 被自动删除（关闭表达「不调用」，不表达
「忘掉目标」）。

#### Scenario: 非法 provider 回落

- **WHEN** 配置里 `provider` 为 `providers` 表外的值（如 `"openai"`，而表里只有 `kimi` 与
  `deepseek`）
- **THEN** 启动不失败；按预设顺序回退到第一个 `configured` 的条目（没有则第一个合法条目），
  并产生一条人话 warning，点名原值与实际落点

#### Scenario: 非法 permission_mode 回落

- **WHEN** 配置里 `permission_mode` 为闭集合外的值（或类型不符）
- **THEN** 启动不失败，模式回落 `vault_write` 并产生一条人话 warning（类型不符时整文件回落）

#### Scenario: 非法 wire_api 回落

- **WHEN** 某 provider 的 `wire_api` 为闭集合外的值，或是该预设不支持的档位（`deepseek` 配
  `chat_completions`）
- **THEN** 启动不失败，该 provider 的方言回落该预设的缺省值并产生一条人话 warning

#### Scenario: session_naming.model 未声明回落

- **WHEN** `session_naming.model` 非空、但不在选定 provider 的 `models` 清单内（或 mock
  provider 下非空）
- **THEN** 启动不失败，命名调用回落该 provider 的生效模型并产生一条人话 warning；
  `session_naming.model` 类型不符时整文件回落

#### Scenario: session_naming.provider 指向其他 provider

- **WHEN** `session_naming = { "provider": "deepseek-personal", "model": "deepseek-flash" }`，
  而当前使用项为 `kimi-work`，且 `deepseek-personal` 条目已配置 `api_key` / `base_url` 并
  声明了该模型
- **THEN** 命名调用按 `deepseek-personal` 条目的 `api_key` / `base_url` / wire 方言发出，模型取
  该条目的 `deepseek-flash`；会话本身的请求仍走 `kimi-work`，两类调用的 provider 不混用

#### Scenario: 非法 session_naming.provider 回落

- **WHEN** `session_naming.provider` 为 `providers` 表外的值（如 `"openai"`，表里没有该 id；或指向一个被装载期忽略的条目），
  或该表把 provider 写成非字符串值
- **THEN** 悬空取值时启动不失败，命名调用回落当前使用项并产生一条人话 warning；类型不符时整
  文件回落（ADR 0002 §5 既有模板），回落后的 `session_naming.provider` 缺省（`null` = 当前
  使用项）

#### Scenario: session_naming.enabled 缺省与类型不符

- **WHEN** 配置未写 `session_naming`（或未写其中的 `enabled`），或把 `enabled` 写成非布尔值
- **THEN** 未写时按默认 `true` 生效、不告警；类型不符时整文件回落（ADR 0002 §5 既有模板），
  回落后的 `enabled` 为 `true`

#### Scenario: 旧命名键静默忽略

- **WHEN** 配置里只写了旧键 `auto_title` / `title_provider` / `providers.<id>.title_model`
  （未写 `session_naming`）
- **THEN** 旧键按未知键口径静默忽略（无 warning、无兼容读取），自动命名按 `session_naming`
  缺省值运行（开、provider 跟随当前使用项、模型取生效模型）

#### Scenario: 切换写回持久化

- **WHEN** 在面板权限 chip 把模式从 `vault_write` 切到 `read_only`
- **THEN** 下一个判定按 `read_only` 执行；`config.json` 的 `[harness].permission_mode` 被写回
  为 `read_only`，重启后保持

#### Scenario: 当前使用项缺省时的默认回退

- **WHEN** `provider` 键缺省，`providers` 表里有 `kimi`（未配置 Key）、`deepseek`（Key 与模型
  齐全）与 `local-lab`（generic，配置齐全）
- **THEN** 当前使用项为 `deepseek`（第一个 `configured` 的条目）；不会因为 `deepseek` 的 id
  字典序在后而选 `kimi`；没有 warning

#### Scenario: mock 不被缺省回退自动选中

- **WHEN** `provider` 键缺省，`providers` 表里只有 `mock`（fixture 齐全）与一个未配置的
  `kimi`
- **THEN** 当前使用项为未配置的 `kimi`（无可用普通 provider 时取第一个合法非 mock 条目），
  MUST NOT 静默切到 `mock`；只有显式 `provider: "mock"` 才走 fixture 驱动

#### Scenario: 非法 provider 条目只丢自己

- **WHEN** `providers` 表里有三个条目：`kimi`（合法）、`broken`（`preset` 为 `"openai-x"`）、
  `local-lab`（合法），且 `last_vault` 已配置
- **THEN** 启动不失败；`kimi` 与 `local-lab` 照常生效；`broken` 被忽略并产生一条点名
  `harness.providers.broken` 的人话 warning；`last_vault` 不丢；文件里 `broken` 条目原样保留

#### Scenario: 悬空命名目标回落到当前使用项

- **WHEN** `attachment_naming.provider = "deleted-one"`，而 `providers` 表里已没有该 id
- **THEN** 启动不失败，图片命名的目标回落当前使用项并给一条人话 warning；自动化设置页显示
  「已回落到当前 provider」；不会因此阻断开机或发送

#### Scenario: 网页访问默认关闭且配置键受 revision 保护

- **WHEN** `harness.web_access.enabled` 缺省，随后经设置面板显式开启、切 provider 并恢复默认
- **THEN** 缺省时两件 Web 工具不注册；开启后的下一回合才注册；切 provider 不重置开关；恢复默认
  删除该键且不复制或清空 `permissions.allow` 中的持久 origin

### Requirement: 批准闸呈现与决策后收敛

批准闸的 diff 预览中，以 `+` / `-` 起首的增删行底色 MUST 覆盖该行文本的完整宽度，与卡片可视宽度
无关：行文本超出可视宽度（容器出现横向滚动）时，底色 MUST 随文本延伸至整行末尾，MUST NOT 在可视
宽度处截断。该不变量对任意行内容长度与任意面板宽度恒成立（渲染缺陷合同先行，条款引用输入分布而非
具体案例）。

批准项被采纳或拒绝后，卡片 MUST 收敛为一行终态记录：工具名 + 决策结果（已采纳 / 已拒绝）+ 决策的
相对时间戳。diff / argv 预览 MUST 默认折叠，可经单一入口展开回看；待决语义副句（写类「批准后才会
落盘」）、判定依据行、决策按钮与次级动作按钮 MUST 随决策退场，MUST NOT 以置灰形态残留在终态记录里
（置灰按钮会被误读为「待处理 / 等待中」）。拒绝时若附了原因，原因文本 MUST 在终态记录中直接可见
（无需展开详情）。`cli_run` 批准卡 SHALL 在命令上方显眼位置展示模型自述的 `purpose` 用途句，命令
原文完整可见、MUST NOT 被用途句替代或截断；purpose 是阅读辅助而非安全判据，权限判定 MUST NOT
参考 purpose。

批准卡 SHALL 在待决问句下方展示一行**判定依据**，说明这次调用**为什么进闸**（人话一行，随卡片
出现）。判定依据 SHALL 由后端判定管线产出并随批准请求事件与 `harness_state` 快照两条通道同源到达
前端，前端 MUST NOT 自行推导层级；依据 SHALL 覆盖产批准卡的两层，并如实区分：**危险黑名单**命中
（shell 包装器类点名包装器命令名并说明其内容不可知；其余危险命令类说明命中安全黑名单）与**模式
默认分层**（带当时判定的档位名与该档释义）。判定依据 MISSING（旧后端 / 旧快照载荷）时该行 SHALL NOT
渲染，MUST NOT 以猜测或默认文案填充。该行 SHALL 随界面语言重取文案，MUST NOT 残留旧语言串。

批准卡的次级动作 SHALL 由后端随批准请求下发（事件与快照两条通道同源），前端 MUST NOT 按判定依据
或其它字段自行推断可见性。模式默认分层进闸的卡 SHALL 显示「采纳且本会话不再问（记住 `<粒度>`）」；
可持久化规则的工具（非危险层进闸的 `cli_run`、`vault_patch` / `vault_create` / `vault_move`，
以及 `web_fetch` 的 origin 级规则）另 SHALL 显示「以后都允许 `<规则原文>`」，规则原文由后端
单一真源生成、按钮逐字显示。`web_search` 只有当前会话的工具级免问，MUST NOT 显示持久 allow
动作，手写持久 Search allow 也不生效。**危险黑名单命中的卡 MUST NOT 显示这两枚次级动作**：
该层先于 allow 规则与会话缓存判定，这两枚按钮在那类卡上是死按钮（点了也不生效），显示即误导。
次级动作字段缺省（旧后端 / 旧快照载荷）时两枚按钮 MUST NOT 渲染。

Web 批准卡的预览载荷 SHALL 与批准请求事件 / `harness_state` 快照同源：Search 显示完整 query、
实际 provider id、query 发往 DeepSeek 的外发与计费说明；Fetch 显示完整 URL、规范化 origin、实际
provider id，以及「Lumir 先做本地 HEAD / Range GET 预检、再把 URL 发给 DeepSeek 抓取」的双路外发
与计费说明。Fetch 的会话 / 持久动作 SHALL 显示具体 origin，Search 的会话动作 SHALL 明确为
「本会话后续网页搜索」，MUST NOT 用「同类操作」含糊代替。provider 尚未解析成功时预览中的
provider / provider id 为 null，不伪造 `"deepseek"` 为配置 id。批准或拒绝后，这些待决字段、说明与
动作 SHALL 按本条统一终态折叠，只保留工具名 + 决策结果 + 相对时间；完整 query / URL 与决策摘要
SHALL 可在展开详情中回看，不以待决按钮或置灰动作残留。

#### Scenario: diff 行高亮覆盖整行文本

- **WHEN** 面板呈现含超出可视宽度的增删行的 diff 预览（任意行长度 × 任意面板宽度）
- **THEN** 每个增删行元素的宽度 ≥ 该行文本的完整宽度，底色铺满整行、横向滚动区外无未高亮文本

#### Scenario: 采纳后收敛为终态记录

- **WHEN** Alex 对带 diff 预览的批准项点击采纳
- **THEN** 卡片收敛为一行记录（工具名 + 已采纳 + 相对时间戳）；diff 默认折叠、展开后可回看；待决标题、判定依据行、决策按钮与次级动作按钮退场，界面不再出现置灰的采纳 / 拒绝钮

#### Scenario: 拒绝附原因可见

- **WHEN** Alex 填写拒绝原因并点击拒绝
- **THEN** 终态记录直接显示原因文本（不依赖展开详情）；diff 默认折叠、可展开回看

#### Scenario: 用途句在命令上方呈现

- **WHEN** 一个带 `purpose` 的 `cli_run` 写命令进入批准闸
- **THEN** 批准卡命令上方显眼位置显示 purpose 用途句，命令原文完整可见；purpose 不参与判定（判定结果与同命令不带 purpose 时一致）

#### Scenario: 危险黑名单进闸时的判定依据

- **WHEN** 模型在任意档（含 `full_access`）调用 shell 包装器命令（如 `cli_run("zsh", ["-lc", "rm -rf /tmp/x"])`，脚本不可解包）
- **THEN** 批准卡的判定依据行说明这是 shell 包装器命令、点出包装器命令名、并说明内容不可知因而任何权限档都需逐个确认

#### Scenario: 模式默认分层进闸时的判定依据

- **WHEN** 默认 `vault_write` 档下模型调用库外写命令（如 `cli_run("npm", ["install"])`）进入批准闸
- **THEN** 批准卡的判定依据行带出当时档位（`保险库写入` / `Vault Write`）与该档释义（库内写自动放行、库外命令先问），使「已是 Write 档为何还问」在卡上自洽可读

#### Scenario: 判定依据随决策退场

- **WHEN** Alex 对带判定依据行的批准项点击采纳或拒绝
- **THEN** 终态记录里不出现判定依据行（与待决副句、决策按钮、次级动作按钮一同退场），界面零残留

#### Scenario: 可持久化的卡显示两枚次级动作

- **WHEN** 默认 `vault_write` 档下 `cli_run("tvly", ["search", "x"])` 进入批准闸
- **THEN** 卡上同时显示「采纳且本会话不再问（记住 `tvly search`）」与「以后都允许 `cli(tvly search *)`」两枚次级动作；两枚文本与后端生成的粒度 / 规则逐字相同

#### Scenario: 危险卡不显示次级动作

- **WHEN** 任意档下 shell 包装器命令（脚本不可解包）或危险黑名单命令进入批准闸
- **THEN** 卡上 MUST NOT 出现「采纳且本会话不再问」与「以后都允许」两枚按钮（MUST NOT 以置灰形态出现）；只保留采纳 / 拒绝

#### Scenario: Fetch 预览与 origin 持久动作

- **WHEN** `web_fetch("https://example.com/a?q=1")` 进入批准闸，provider 已解析成功
- **THEN** 卡片显示完整 URL、origin `https://example.com`、实际 provider id，以及 Lumir 预检 +
  DeepSeek 抓取的双路外发与计费说明；次级动作包含本会话 origin 免问与
  「以后都允许 `web_fetch(https://example.com)`」，规则原文与后端生成值逐字相同

#### Scenario: Search 只有会话动作且 Web 终态折叠

- **WHEN** `web_search` 进入批准闸，用户先看到完整 query 与 provider / 外发说明，随后采纳或拒绝
- **THEN** 待决卡只有「本会话后续网页搜索」记忆而没有持久 allow；决策后预览与按钮退场，
  卡片折叠为工具名 + 决策结果 + 相对时间，展开详情仍可回看完整 query / URL 与决策摘要

### Requirement: Skill 的混合调用与入口策略

系统 SHALL 同时提供两条 Skill 调用入口：**用户显式选择**与**模型自主 `skill_load`**。显式选择 SHALL
由后端确定性加载 SKILL.md 全文；模型自主入口 SHALL 保留既有「索引（name + description）→ 模型按相关性
判断 → `skill_load` → 工具结果」链路。任一入口 MUST NOT 以削弱另一入口的默认能力为实现前提。

**两阶段读取边界**：系统 SHALL 区分发现期元数据读取与调用执行期正文加载。发现期为装配索引与解析策略，
当前实现可能通过 `fs::read_to_string` 把整份 SKILL.md 读入内存，但只把文本用于元数据解析（description
保持现有 frontmatter / 无 frontmatter 首行兜底，另加 invocation 字段），不把正文作为调用结果投递；该读取
发生在权限与入口策略判定之前，属于既有索引行为，MUST NOT 被虚称为零 IO。200KB 上限 SHALL 只约束执行期正文
加载，MUST NOT 被用来暗示发现期只读 frontmatter 或只读前 200KB。调用执行期正文加载 SHALL 在权限与策略
放行后调用共享正文加载器，把正文投递到用户消息 part 或工具结果。某一入口因权限 deny、入口策略或非法
元数据被拒绝时，拒绝保证 SHALL 只约束该入口：其执行期正文加载器未被调用、对应输出面无正文，MUST NOT
被表述为发现期也未读取任何 Skill 文件，也 MUST NOT 扩大到另一放行入口。deny 与非法元数据 SHALL 拒绝
两个入口；禁自动 SHALL 只拒绝自动入口并保留显式正文 marker 正向对照；禁手动 SHALL 只拒绝显式入口并保留
自动工具结果正文 marker 正向对照。发现期只读 frontmatter 的优化不在本 change 内，后续优化 MUST NOT 改变
索引行为。

**默认与分控**：每个 Skill 缺省 SHALL 同时允许用户显式选择与模型自主调用。SKILL.md frontmatter SHALL
支持且只支持以下两个 Lumir 调用策略字段：`disable-model-invocation`（缺省 `false`，为 `true` 时禁止模型
自主调用但保留用户显式调用）与 `user-invocable`（缺省 `true`，为 `false` 时禁止用户显式调用但保留模型
自主调用）。这两个字段借用 Claude Code 的拼写，其语义以本规格为准，MUST NOT 被描述为 Agent Skills
标准字段；系统 MUST NOT 另支持 `allow_implicit_invocation`、字段别名、嵌套调用配置或第二套拼写。目录名
SHALL 仍是 Skill 名字的唯一来源。

字段 SHALL 只接受不带引号的布尔字面量 `true` / `false`；只有字段缺失才使用缺省值。重复字段、带引号、
`yes` / `no`、大小写变体或其他非布尔值 SHALL 被视为非法调用元数据，两个入口均 MUST fail closed，以
`skill_invocation_invalid` 明确报告，MUST NOT 调用执行期正文加载器，且各输出面 MUST 无正文；未知
frontmatter 字段 SHALL 按现状忽略。
vault-wide 同名覆盖 user-wide 时，名字、正文来源与策略 SHALL 作为同一发现项整体覆盖。

**发现面投影**：系统提示索引 SHALL 继续列出所有已发现 Skill；默认项的索引文本 SHALL 保持不变，非默认
策略与非法元数据 SHALL 在对应索引项上明确标注。`harness_skills_list` SHALL 复用 `discover_skills` 的
发现与覆盖结果，返回符合 `/` grammar 的 `{name,description,source,user_invocable,model_invocable,
invocation_valid}` 条目且 MUST NOT 暴露绝对路径；候选 SHALL 只显示元数据合法且 `user_invocable = true`
的条目。禁手动条目 SHALL 保留在索引与模型自动入口；禁自动条目 SHALL 保留在 catalog 与显式入口。
发现、索引与候选 MUST NOT 共用错误的可见性过滤。

**显式语义分界**：只有用户从候选中显式选择的 Skill 才构成一次显式调用。消息文本里的 `/名字` 字样本身
MUST NOT 被当作显式调用依据；`/tmp`、`/usr/local` 等斜杠开头路径与普通文本保持原义。调用关系 SHALL
由发送时随当前新消息提交的显式选择元数据表达，按文本位置排序、同名只取首次。后端 MUST NOT 从消息文本
解析技能名。历史消息里的 token / 选择 MUST NOT 在后续轮次重新触发显式注入；重试 SHALL 原样回放该轮输入。

**候选与被动选择**：键入 `/` 且满足边界与名字前缀匹配时 SHALL 显示候选；候选初始无高亮。被动态下
`Enter` / `Tab` MUST NOT 被候选消费；`↑` / `↓` 或指针悬停 SHALL 进入选择态。选择态下无修饰的
`↑` / `↓` 移动高亮（到端停住、不环绕），无修饰的 `Enter` / `Tab` 选中，`Esc` 关闭，鼠标点击选中
且按下时 MUST NOT 夺走输入区焦点。带修饰键的同名键 MUST NOT 被候选消费。`⌃N` / `⌃P` MUST NOT 被
候选消费，但 SHALL 主动关闭候选，即使光标未移动。`Esc` SHALL 走共享浮层层栈，一次只关最上层，
MUST NOT 收起面板或移动焦点。

输入法组合期 MUST NOT 触发候选、响应候选导航键或吞掉确认候选的 `Enter`；组合开始时已打开的候选 SHALL
立即关闭。

**选择引用与 chip**：选中后 SHALL 把当前 `/前缀` 替换为 `/完整名 `（尾随一个半角空格），一次选中 MUST
是一条可撤销历史步，并创建名字 + 文档范围的引用。引用 SHALL 随文档编辑映射；范围越界、切片不再逐字节
等于 `/名字` 或左边界失效时，该引用 MUST 失效。撤销 / 重做 SHALL 与文本同事务同步。chip MUST 只由引用
派生，MUST NOT 从文本扫描推断，也 MUST NOT 改文档、选区、复制或投递内容。

前端 SHALL 按 vault 缓存最新成功 catalog：新 `/` 强制刷新；关闭候选后保留；草稿装载异步取一次但不打开
候选；切 vault / 会话复位清空并作废在途；失败不阻断输入且 MUST NOT 误标 chip。最新成功 catalog 中名字
不存在时 chip SHALL 呈缺失态；名字存在但禁手动或元数据非法时 SHALL 呈禁用态并给出不同提示。草稿恢复
SHALL 先按引用重现 chip，不依赖 catalog 成功。

**命名 grammar**：`/` 显式入口 SHALL 只支持 `^[A-Za-z0-9][A-Za-z0-9_-]*$`。前端引用、后端元数据与
清单过滤 SHALL 共用同一 grammar。不符合该 grammar 的名字 SHALL 继续由 `discover_skills` 注入索引；
含点（非点开头）/ 空格 / CJK 的名字 SHALL 继续可供模型自主 `skill_load`，点开头的名字 SHALL 仍按现行
`skill_name_invalid` 被拒绝。本功能 MUST NOT 收紧或改写既有自主发现面。

**显式发送与确定性加载**：发送时前端 SHALL 只提交当前新消息引用，作为 `harness_send` 必填参数
`skills_json`。后端 SHALL 在回合开始时按当回合发现结果解析名字，先以 `skill_load` + 技能名 +
`{"name": <name>}` 调现行权限判定，再检查用户入口策略；只有权限 `Allow`、元数据合法且允许用户调用时
才调用执行期正文加载器。对可加载的名字，系统 SHALL 沿用既有根内路径校验与 200KB 上限加载 SKILL.md
全文，作为独立 `input_text` part 追加到该用户消息末尾；part SHALL 带本地标记 `lumir_skill`，正文以
`[已加载 Skill：<名字>]` 开头。显式与自动入口 SHALL 共用同一执行期正文加载器，MUST NOT 复制第二套路径、
大小或读取逻辑。

权限 `Deny`（或任何非 `Allow`）MUST NOT 调用执行期正文加载器或注入正文；禁手动 SHALL 以
`skill_user_invocation_disabled` 非阻断报告，非法元数据 SHALL 以 `skill_invocation_invalid` 非阻断报告，
两者同样 MUST NOT 调用执行期正文加载器或注入。三种拒绝路径的 `input` / `llm_request.messages` /
provider wire MUST 无正文，且 MUST NOT 伪装成未知名字；用户消息 SHALL 照常发送。未知 / 超限 / 读取失败 /
不合 grammar 的名字 SHALL 跳过且不阻断；`skills_json` 结构非法（非数组 / 非字符串元素 / 坏 JSON）SHALL
以明确错误拒绝发送，不建会话、不入队。

**自动入口策略执行**：默认 Skill 的索引、工具定义、`skill_load` 参数、工具结果与循环顺序 SHALL 不变。
模型对 `disable-model-invocation: true` 的条目调用 `skill_load` 时，系统 SHALL 在现行权限判定后返回
`skill_model_invocation_disabled`，MUST NOT 调用执行期正文加载器，且 SKILL.md 与该 Skill 目录内其他文件
均无正文进入工具结果；发现期元数据读取仍按既有索引路径发生。该策略 MUST NOT 阻止用户显式加载。
`user-invocable: false` MUST NOT 改变模型自主加载。索引策略提示 SHALL 由执行层策略闸兜底，MUST NOT 只
依赖模型自觉遵守提示。

**留存与投影**：显式技能 part SHALL 进入会话 `input` 与 `llm_request.messages`，供重试与恢复原样回放；
本地标记 MUST 在 provider wire 前剥离且保留正文，剥离 MUST 发生在无图片早退之前。面板投影与自动命名
素材（`title::item_text` 与 `title::material` 的首轮 / 最近轮）MUST 跳过显式技能 part。重试 / 恢复 MUST NOT
重新执行显式正文注入；自动压缩 SHALL 把该 part 当作普通消息内容参与摘要，不承诺逐字节保留。模型自主
加载 SHALL 沿用既有工具调用 / 工具结果留存，不新增 `lumir_skill` 用户消息 part，其重试、恢复与压缩行为
MUST NOT 被本 change 改写。

调用策略 SHALL 只约束新调用：草稿引用 MUST NOT 保存策略快照，发送时按当前策略判定；历史恢复 SHALL 原样
灌回最后请求，MUST NOT 按当前策略回写、删除或清洗旧显式正文 / 自动工具结果。显式正文与自动工具结果作为
历史上下文随后续请求发送时 MUST NOT 产生新的显式注入。上下文超限 SHALL 沿用既有压缩机制尽力恢复，系统
MUST NOT 承诺任意数量 / 任意大小的 Skill 都能进入模型上下文。

**权限**：两个入口 SHALL 以同一工具名、技能名和参数经过现行权限判定；同一 tool 级或名字模式 deny 对
显式与自动调用同效，任何非 `Allow` 均不调用执行期正文加载器，显式 `input` / `llm_request.messages` /
provider wire 与自动工具结果均无正文。发现期已完成的元数据读取不属于该执行期断言。显式选择 MUST NOT
改变权限档、跳过批准闸或预批准
Skill 内容引发的 `cli_run`；invocation policy MUST NOT 替代或放宽权限规则。`skill_load` 的读类默认放行
不变，后续 `cli_run` SHALL 沿用现行档位、规则、命令分类与缓存。

**系统提示与验收口径**：系统提示 SHALL 说明显式加载段头的含义、斜杠路径不是显式调用、默认 Skill 仍可
自主 `skill_load`，以及禁自动条目应请用户显式选择。提示装配单测 SHALL 断言约定与索引策略标记确实进入
系统提示。mock 场景 SHALL 只用于证明注入、留存、投影、策略执行与发送链路，MUST NOT 被表述为证明真实
模型遵守提示；真实遵守率只作 dogfood 观察，不进入机器门禁。

#### Scenario: 默认 Skill 双入口均可用

- **WHEN** 一个 Skill 未声明两个调用策略字段
- **THEN** 它按现有口径进入系统提示索引并可由模型自主 `skill_load`；同时出现在用户候选中，显式选择后
  由后端确定性加载全文；默认索引条目不增加策略标记

#### Scenario: 显式选择确定性注入

- **WHEN** 用户键入 `/acc-skill-a` 后按 `↓` 进入选择态、按 `Enter` 选中 `acc-skill-abc`，然后发送
- **THEN** 首个 `llm_request.messages` 的该用户消息含一个带 `lumir_skill` 标记的 part，正文含
  `[已加载 Skill：acc-skill-abc]` 与 SKILL.md 正文；无需模型再次调用 `skill_load`；面板 AX 不含正文标记

#### Scenario: 手打名字但不选择不做显式注入

- **WHEN** 用户完整键入 `/acc-skill-abc 问题`（不进入选择态、不点击候选）并发送
- **THEN** 消息照常发出；该用户消息不含 `lumir_skill` 或显式注入正文；模型自主入口是否按既有逻辑调用
  不受该文本 token 强制

#### Scenario: 绝对路径不被误判

- **WHEN** vault 内存在名为 `tmp-acc` 的技能，用户在行首、空格后或列表项里键入 `/tmp` 后直接按 `Enter`
- **THEN** 消息照常发送对应文本；`llm_request.messages` 不含 `lumir_skill`；候选即使出现也不消费该 Enter

#### Scenario: 被动候选不抢 Enter 与 Tab

- **WHEN** 候选已显示且仍处于被动态，用户按 `Enter` 或 `Tab`
- **THEN** Enter 按原语义发送、Tab 按原语义处理；消息不因候选打开而被拦截或改写

#### Scenario: 选择态键位与 IME

- **WHEN** 候选已进入选择态，用户使用方向键 / Enter / Tab / Esc；另一次在中文输入法组合期键入或确认
- **THEN** 选择态只消费相应导航与选中键，Esc 只关候选；组合期不触发、不导航、不吞确认 Enter，
  组合开始关闭已有候选

#### Scenario: `⌃N` / `⌃P` 主动关候选但不消费

- **WHEN** 候选打开时按 `⌃N` 或 `⌃P`（分别覆盖单行末尾、单行开头、多行跨行）
- **THEN** 候选关闭且事件不被候选 `preventDefault`；光标按输入区既有行移动语义处理；消息不发送、文本不变

#### Scenario: 选中后改文本使引用失效

- **WHEN** 用户选中 `acc-skill-abc` 后删掉名字中的一个字符并发送
- **THEN** 该引用失效，不注入、无 chip；消息按修改后的文本正常发送

#### Scenario: 禁自动但允许显式

- **WHEN** 含唯一 body marker 的 `acc-deploy` 声明 `disable-model-invocation: true`，模型调用
  `skill_load("acc-deploy")`；随后用户从候选显式选择该 Skill 并发送
- **THEN** 发现期已取得索引与策略元数据；模型调用返回 `skill_model_invocation_disabled`，仅自动入口的
  执行期正文加载器未被调用，SKILL.md 与目录内其他文件均无正文 marker 进入工具结果；用户显式入口仍调用
  加载器，`input` / `llm_request.messages` / provider wire 均有 body marker

#### Scenario: 禁手动但允许自动

- **WHEN** 含唯一 body marker 的 `acc-background` 声明 `user-invocable: false`，用户打开候选并尝试经旧
  引用显式发送；模型随后自主调用 `skill_load("acc-background")`
- **THEN** 该 Skill 不出现在候选，索引仍列出并标注禁手动；仅显式入口的执行期正文加载器未被调用，
  `input` / `llm_request.messages` / provider wire 无 marker；自动入口仍调用加载器且工具结果有 body marker

#### Scenario: 旧引用不能绕过禁手动

- **WHEN** 一个引用创建后，对应 Skill 改为 `user-invocable: false`，用户恢复草稿并发送
- **THEN** chip 呈禁用态；后端不调用执行期正文加载器、不注入，`input` / `llm_request.messages` /
  provider wire 无正文，并给出 `skill_user_invocation_disabled` 非阻断提示；模型自主入口仍可用

#### Scenario: 非法调用元数据 fail closed

- **WHEN** 一个 Skill 的调用策略字段重复、带引号、写为 `yes` 或其他非 `true` / `false` 值
- **THEN** 发现期已解析出非法状态；两个入口均返回 / 报告 `skill_invocation_invalid`，执行期正文加载器
  未被调用，显式 `input` / `llm_request.messages` / provider wire 与自动工具结果均无正文；系统不得按字段
  缺失的默认开放值处理；未知 frontmatter 字段不产生该错误

#### Scenario: 自动入口默认行为不削弱

- **WHEN** `harness.web_access.enabled=true` 且 Alex 提问需要联网搜索；随后另一个问题明确要求使用某外部
  Skill、访问特殊站点或读取非 HTML 内容
- **THEN** 一般网页搜索默认使用统一 `web_search` / `web_fetch`，不再要求经 `skill_load` 后调用 `cli_run`；
  只有用户显式选择 Skill、特殊站点或非 HTML 场景才经对应 CLI，工具结果与既有留存形态不变；
  `harness.web_access.enabled` 缺省 / false 时 Web 工具不注册，不得以幻觉调用代替显式 CLI 选择

#### Scenario: 权限判定对两个入口一致

- **WHEN** 含唯一正文 marker 的 SKILL.md 已在发现期被成功读取并解析出 description / 策略后，配置
  `deny = ["skill_load"]` 或 `deny = ["skill_load(<name>)"]`，在任一权限档分别经显式选择与模型自主调用
  加载同一 Skill
- **THEN** 两个入口的执行期正文加载器均未被调用；显式路径不注入且 `input` / `llm_request.messages` /
  provider wire 无 marker，自动工具结果无 marker；同一命中规则原文按各入口既有错误面报告；
  不得用文件系统零读取作为该拒绝路径的判据

#### Scenario: 显式选择不改变后续命令权限

- **WHEN** 用户在任一权限档显式选择一个 Skill，且技能内容引导模型执行一条写操作命令
- **THEN** `cli_run` 沿用现行档位 / 规则 / 命令分类 / 缓存；该请求批准就请求批准，该自动放行就自动放行；
  显式选择不改变判定输入或结果

#### Scenario: 恢复与策略变更不重写历史

- **WHEN** 会话已含显式技能 part 与自动 `skill_load` 工具结果，随后 Skill 被改为禁自动 / 禁手动并恢复会话
- **THEN** 最后一条 `llm_request.messages` 原样灌回，旧显式正文与自动工具结果仍在历史且不被回写；
  面板仍不显示显式正文；只有恢复后的新调用按当前策略拦截

#### Scenario: 重试与压缩不重新显式注入

- **WHEN** 带显式技能 part 的轮次被重试或自动压缩
- **THEN** 重试原样回放 `input`，显式预加载器不再次执行；压缩把正文作为普通内容参与摘要，新会话只接收
  摘要且不重新显式注入，不承诺正文逐字节保留

#### Scenario: 未知名字与非法发送元数据

- **WHEN** 引用名字在发送时已不存在；或 `skills_json` 不是字符串数组
- **THEN** 前者跳过注入、发送照常且无阻断性错误；后者以明确错误拒绝发送，不建会话、不入队

#### Scenario: grammar 之外的名字仍可自主使用

- **WHEN** Skill 根下存在名字含点 / 空格 / CJK / 点开头的技能
- **THEN** 清单与候选不含它们；系统提示索引仍列出；含点（非点开头）/ 空格 / CJK 的名字仍可被模型自主
  `skill_load`，点开头的名字仍按现行 `skill_name_invalid` 被拒绝

#### Scenario: 无图片消息也剥离本地标记

- **WHEN** 一条只有用户文本 + 显式技能 part、没有任何图片引用的消息被发送
- **THEN** provider wire 的 text part 不含 `lumir_skill` 字段、正文仍在；附件目录不被解析或创建

#### Scenario: 自动命名素材不含显式技能正文

- **WHEN** 首轮或最近轮的用户消息带 `lumir_skill` part，标题生成读取 `title::material`
- **THEN** 命名素材只含用户提问文本与既有问答，不含显式技能正文

#### Scenario: 提示约定与策略标记进入系统提示

- **WHEN** 发起新会话并读取装配后的系统提示，Skill 清单含默认、禁自动、禁手动与非法元数据条目
- **THEN** 身份段含显式段头、斜杠路径与混合调用约定；默认条目不增加策略标记，其他条目分别标注；
  固定段字节指纹与装配清单同步

## ADDED Requirements

### Requirement: 统一 Web 搜索与抓取工具

`harness.web_access.enabled=true` 时，交互主会话 SHALL 提供 `web_search` 与 `web_fetch`，两者
SHALL 使用同一结果信封与 `WebSource` 来源结构；缺省 / false 不注册这两件工具。`web_search` 输入 SHALL 仅含 `query` / `count` / `need_content`：query trim 后为 1–128 个
Unicode 字符且不全为空白；count 缺省 5、本地允许 1–10，越界 SHALL 返回 `web_args_invalid` 而非静默
clamp；`need_content` 缺省 `false`。`web_fetch` 输入 SHALL 仅含 1–8192 字符的 `url`。工具 schema
MUST NOT 暴露 API Key、provider、base URL、超时、重试、响应上限或任意 HTTP header。

统一信封 SHALL 含 `ok` / `provider` / `provider_id` / `operation` / `attempts` / `trust` /
`truncated` / `truncated_fields`。`provider` / `provider_id` SHALL 为 `string | null`：只有 provider
解析成功才填 `"deepseek"` 与实际配置映射键；未配置、配置歧义、自定义 base URL 及解析前的参数 /
权限 / URL 拒绝均填 null 且 `attempts=0`，MUST NOT 伪造 `"deepseek"` 为配置 id 或在多候选时暗选。
成功 Search SHALL 另带完整 query 与 `results: WebSource[]`，成功 Fetch SHALL 另带
`source: WebSource`。`WebSource` SHALL 固定包含 `url` / `title` / `snippet` / `summary` /
`content` / `content_format` / `site` / `date` / `authority`。title SHALL 始终为 string，
Fetch 空标题固定 `""`；其它可空字段的无信息值才用 null，MUST NOT 混用空串与 null。
Search SHALL 原样保留 date 与 -1–4 的 authority（含 -1 = 未知）；Fetch 无这两项信息时填 null。
`site_icon` MUST NOT 进入结果，避免派生未审计的图片请求。

Search 的 `need_content=false` SHALL 作为默认工作流：先返回来源与摘要，再由模型按需调用 Fetch 获取
Markdown。Search 空数组 SHALL 是成功的空结果；Fetch 空 Markdown SHALL 返回 `web_empty_content`，
不得冒充有正文的成功。Fetch 的 `source.url` SHALL 是本地预检后实际提交给 DeepSeek 的 URL，
MUST NOT 伪造 provider 未返回的 final URL。

系统 SHALL 同时限制 API 响应字节与进入模型上下文的字符：Search title / snippet / summary 每项上限
300 / 500 / 1,200 Unicode 字符，Search content 每项 4,000 字符且全部 results 文本合计 24,000 字符，
Fetch Markdown 24,000 字符，Lumir message / provider_message 各 1,000 字符；Search / Fetch API 响应
分别不得超过 2 / 4 MiB。聚合裁剪 SHALL 按 content → summary → snippet 顺序，结果只能整条移除；
URL / date / authority / provider MUST NOT 被裁剪。任何字段或数组被裁剪时 SHALL 同时置
`truncated:true` 并在 `truncated_fields` 列出稳定路径；未截断时该数组为 `[]`。只在文本末尾加省略号
而缺少这些字段 SHALL 视为违约。API 字节超限 SHALL 返回 `web_response_too_large`，不解析半截 JSON。

#### Scenario: 默认搜索后再抓取

- **WHEN** 模型以默认参数调用 `web_search`，随后选择一个来源调用 `web_fetch`
- **THEN** Search 请求携带 `count=5, need_content=false`，返回结构化来源但无需返回正文；Fetch 第二跳
  返回同一 `WebSource` 形状的 Markdown 内容，最终回答可引用 URL / title / date / authority / provider

#### Scenario: 空结果与空正文不同

- **WHEN** DeepSeek Search 返回空 results，或 Fetch 返回空 Markdown
- **THEN** 前者为 `ok:true, results:[]` 且不自动重试；后者为 `web_empty_content`，不得返回伪造正文

#### Scenario: 可空 provider 与空标题形状一致

- **WHEN** 分别发生无配置、配置歧义、解析前参数错误，以及 Fetch 无标题
- **THEN** 前三者的 `provider` / `provider_id` 均为 null 且 `attempts=0`，不暗选或伪造 id；
  最后一者的 `source.title` 为 `""` 而非 null

#### Scenario: 截断显式且 JSON 完整

- **WHEN** 搜索摘要、正文、结果数组或 provider 错误文案超过预算
- **THEN** 输出仍为完整 JSON，顶层 `truncated:true`，`truncated_fields` 精确指出被裁路径；未裁的
  URL / date / authority / provider 保持完整，不出现只加省略号的无标记截断

#### Scenario: 响应字节与上下文预算独立

- **WHEN** DeepSeek 响应超过对应 2 / 4 MiB 上限，或合法响应的正文超过模型字符预算
- **THEN** 前者返回 `web_response_too_large` 且不解析半截 JSON；后者可返回有界结果但必须显式标记截断

### Requirement: Web 工具批准与规则

`web_search` / `web_fetch` SHALL 在本 change 的 D1 默认下，于所有权限模式中默认进入批准闸。
Search 的 permission subject SHALL 为完整 query；Fetch 的 subject SHALL 为规范化 origin
（scheme + host + 有效 port），origin 规范化 SHALL 小写 scheme / host、省略默认 port、保留非默认 port，
且不含 userinfo / path / query / fragment。批准卡 SHALL 完整展示 query / URL、provider id 与数据外发
说明；工具结果 SHALL 同样保留完整 query / URL，使自动放行后的调用仍可审计，MUST NOT 只靠 80 字摘要
满足可见性。

Search 的「采纳且本会话不再问」SHALL 明确授权本会话后续网页搜索；持久 `web_search` allow
MUST NOT 生成，即使用户手写也 MUST NOT 生效，deny 则照常生效。Fetch 的会话记忆与持久 allow
SHALL 只覆盖当前 origin，规则形如 `web_fetch(https://example.com)`。批准卡 SHALL 显示该实际粒度。
普通采纳 MUST NOT 写入缓存，缓存与持久规则 MUST NOT 相互写入。基础参数形状与 URL scheme /
userinfo 校验 SHALL 在批准预览之前完成，非法调用 MUST NOT 先生成携带凭据或无效目标的批准卡。
deny SHALL 永远优先；allow / 缓存只减少批准，不得跳过执行期的 DNS、重定向、内容类型、预算或密钥检查。

跨 origin 重定向 MUST NOT 继承原 origin 的批准。预检发现跨源 Location 时 SHALL 在语法与凭据校验后
返回 `web_redirect_requires_approval` 与完整 `redirect_url`，且 MUST NOT DNS、连接新 origin 或调用
DeepSeek。模型如继续，SHALL 以该 URL 新发 `web_fetch`，由新 origin 的批准闸处理；`redirect_url`
仍是 untrusted data，不是自动执行指令。

#### Scenario: 搜索记忆减少点击但不隐藏外发内容

- **WHEN** Alex 对一次 Search 点「采纳且本会话不再问」，随后模型以不同 query 搜索
- **THEN** 后续 Search 不再进闸，但批准记忆明确是本会话全部网页搜索；每次结果仍保留完整 query、
  provider 与 attempts，新会话后恢复默认 Ask

#### Scenario: 抓取记忆仅覆盖同 origin

- **WHEN** Alex 记住 `https://example.com` 的 Fetch，随后模型抓取该站另一路径与另一 origin
- **THEN** 同站路径可按规则放行，另一 origin 仍进批准闸；规则不得因 path / query 相似而扩大

#### Scenario: 跨 origin 重定向重新批准

- **WHEN** 已批准的 origin 返回指向另一 origin 的 Location
- **THEN** Lumir 返回 `web_redirect_requires_approval` 与完整新 URL，未连接新 origin、未请求 DeepSeek；
  只有新 origin 的批准通过后才能继续

### Requirement: DeepSeek Web provider 与隐私

Web provider SHALL 只从既有 `HarnessConfig` 快照中的 DeepSeek 条目解析。active 条目为 DeepSeek 时，
系统 SHALL 只考察该条目；active 不是 DeepSeek 时，仅在全部条目中**恰好一条**满足「DeepSeek +
非空 Key + 官方 base URL」时复用该完整条目，零条或多条均返回 `web_provider_unconfigured`。
Key 与 base URL MUST 同出一条目，MUST NOT 混用。Web tools 不需要模型清单，因此 MUST NOT 复用要求
`models` 非空的 LLM configured 判据。

官方地址 SHALL 只认 `base_url=None` 或规范化后等于 `https://api.deepseek.com`（允许末尾 `/`）。
自定义 DeepSeek-compatible base URL MUST NOT 被探测或假定支持 tools；不可用时 MUST NOT 拿同一 Key
改投官方地址。active DeepSeek 不可用时 MUST NOT 暗选其它条目。无配置、配置歧义或自定义 base URL
SHALL 返回 `web_provider_unconfigured`，DeepSeek 请求数与 curl 子进程数均为 0。

Search SHALL 只向 `POST https://api.deepseek.com/v1/tools/search` 发送 `query` / `count` /
`need_content`，Fetch SHALL 只向 `POST https://api.deepseek.com/v1/tools/fetch` 发送 `url`；
MUST NOT 发送 `ori_question` / `localization`。API Key SHALL 只进入 `Authorization: Bearer …`，
MUST NOT 进入 URL、请求 JSON、批准卡、日志、panel、会话 JSONL、wire、错误或测试输出。来自 provider /
目标站的错误文本 SHALL 先脱敏再限长；恶意回显 Key 时只能留下 `[REDACTED]`。

Search query 会发给 DeepSeek；Fetch URL 会发给 DeepSeek，并会由 Lumir 预检与 DeepSeek 抓取发往
目标站。该事实 SHALL 在批准卡可见。目标预检与 DeepSeek client SHALL 都显式 `no_proxy`，不得继承
系统或手动代理。tools API 的 3xx MUST NOT 跟随并统一归 `web_provider_protocol_error`；
目标预检 MUST NOT 携带 DeepSeek Key、Cookie、vault 内容或浏览器登录态。

#### Scenario: active 非 DeepSeek 时唯一候选可用

- **WHEN** active 为其它 provider，且现有条目中恰好一条 DeepSeek 具有非空 Key 与官方 base URL
- **THEN** Web 请求复用该完整条目；若候选为零或多条则返回 `web_provider_unconfigured`，不按字典序暗选

#### Scenario: 自定义 base URL fail closed

- **WHEN** active DeepSeek 条目使用自定义 DeepSeek-compatible base URL
- **THEN** 返回 `web_provider_unconfigured`，不探测 tools、不把 Key 改投官方地址、不选择其它条目，
  且不产生 HTTP 或 curl 请求

#### Scenario: 恶意错误回显不泄露 Key

- **WHEN** mock provider 或目标站在错误 body / URL 中回显 canary API Key
- **THEN** 日志、批准卡、panel、JSONL、wire、错误事件与测试输出均无 canary；query / URL 与 provider
  等审计字段仍按合同可见

### Requirement: Web 目标网络安全

每次 Fetch 与每次同源重定向 SHALL 重新执行完整 URL / DNS 校验。URL SHALL 为 1–8192 字符的
HTTP / HTTPS、含 host、无 userinfo；其它 scheme、控制字符、反斜杠混淆与解析失败 SHALL 拒绝，
MUST NOT 修复成另一个 URL。IP 字面量与 DNS 的全部 A / AAAA 结果 SHALL 都是全局可路由单播；
任一结果为 loopback、private、link-local、unspecified、multicast、reserved、documentation、CGNAT、
IPv4-mapped / 兼容映射的非全局地址时整条拒绝，MUST NOT 只挑一个公网地址放行。`localhost`、
`.local` 与 DNS 解析失败 SHALL fail closed。

连接 SHALL 只使用已验证地址集，并保留原 host 的 Host 与 TLS SNI；连接前 MUST NOT 再次由系统 resolver
自由选择地址。目标预检与 DeepSeek client SHALL 都显式 `no_proxy`，每个同源 hop MUST NOT 重新继承
HTTP(S)_PROXY / ALL_PROXY / NO_PROXY 或手动 Proxy。`no_proxy + 已验证地址集 + 原 Host / SNI +
手动逐跳 redirect` SHALL 是同一客户端构造不变量，不能只靠 resolver override 防代理绕路。
校验与连接 SHALL 共用同一地址集，下一跳 SHALL 重新执行全集校验，以防 check-then-connect 与
DNS rebinding 绕过。错误 MUST NOT 回显完整 DNS 答案或内部网络拓扑。

本地预检 SHALL 每个 hop 先发 HEAD，无法判定时用 `Range: bytes=0-4095` GET 复核；即使目标忽略 Range，
读取 SHALL 以响应头和最多 4 KiB 为界并随即关闭，预检正文 MUST NOT 进入模型。单 hop 不得超过 10 秒、
整链不得超过 30 秒、最多 5 次重定向；预检 MUST NOT 自动重试。相对 Location SHALL 按当前 URL 解析并
逐跳重验；同源（scheme + host + 有效 port）才继续，跨源按「Web 工具批准与规则」重新批准。

预检 SHALL 只接受 `text/html` 与 `application/xhtml+xml`（可带参数）。明确非 HTML 返回
`web_unsupported_content`，Content-Type 缺失或冲突且 Range GET 仍无法判定返回
`web_content_type_unknown`；两者只可提示另行选择 curl，MUST NOT 自动调用。预检通过后才可调用
DeepSeek Fetch，且只发送最后一个已验证的同源 URL。Search MUST NOT 主动访问结果 URL。

Lumir SHALL 如实区分本地保证与 provider 信任边界：本地预检可验证自己的 DNS / redirect / 内容类型，
但 DeepSeek 不返回远端 final URL、连接 IP 或 redirect chain，系统 MUST NOT 声称验证 provider 内部
DNS / redirect，也不得把预检 URL 当作远端 final URL。若不能维持「校验地址与连接地址同一」，
实现 MUST NOT 退化为普通 HTTP client 的自动 DNS 解析。

#### Scenario: 公私混合 DNS 与 rebinding 均拒绝

- **WHEN** 目标 DNS 同时返回公网与私网地址，或第一次校验为公网、后续解析出现私网
- **THEN** 整条 Fetch 被拒绝；连接只可使用已验证地址集且 Host / SNI 不变，不得因存在一个公网答案而放行

#### Scenario: 系统代理不得绕过固定 IP

- **WHEN** HTTP(S)_PROXY / ALL_PROXY 指向本地代理，预检目标与 DeepSeek 各自有独立 HTTP 服务
- **THEN** 预检只连接已验证目标地址，代理零请求；DeepSeek 同样不经过代理，且 3xx 不跟随、
  Bearer 不泄漏。恢复系统代理的错误实现必须能被该反例判红

#### Scenario: 有界预检与逐跳重验

- **WHEN** 同源页面先对 HEAD 返回不明确 Content-Type，再对忽略 Range 的 GET 返回超大 HTML，随后同源跳转
- **THEN** GET 最多读取 4 KiB 即关闭，正文不进入模型；下一跳重新做 URL / DNS 校验，整链超过时限或
  5 跳即失败且不调用 DeepSeek

#### Scenario: 非 HTML 不自动回落 curl

- **WHEN** 预检确认目标为 PDF / 二进制，或无法确认其为 HTML
- **THEN** 分别返回 `web_unsupported_content` / `web_content_type_unknown`，DeepSeek attempts=0；
  模型可另行选择 curl，但该调用仍走既有 CLI 权限与批准

#### Scenario: 不伪称 provider 侧 SSRF 证据

- **WHEN** DeepSeek 对预检后的 URL 返回 Markdown，但未返回远端 final URL / IP / redirect chain
- **THEN** `source.url` 只表示本地预检并提交的 URL；审计不得写成「已验证 DeepSeek 最终连接地址」

### Requirement: Web 请求可靠性与计费边界

DeepSeek 每次 attempt SHALL 连接超时 5 秒；Search / Fetch attempt 总超时分别 30 / 45 秒，含退避的
整次工具调用分别不超过 100 / 150 秒。响应头与 body 读取 SHALL 计入 deadline。取消 SHALL 复用
`ctx.aborted()` 的同一事实源，在发起前、退避、响应等待与 body 分块读取时检查，且 MUST NOT 持会话锁。
取消后 SHALL 关闭响应、不再发新 attempt、返回 `web_cancelled`，部分 JSON 不得当成功解析；
已在 OS / provider 处理的请求无法撤销，系统 MUST NOT 承诺取消可撤销潜在费用。

自动重试 SHALL 只针对 DeepSeek tools API 的 HTTP 408 / 429 / 5xx，最多初次 + 2 次重试；退避优先使用
上限 2 秒的 `Retry-After`，缺失时使用 250ms、1s。其它 4xx（含 425）、本地 DNS / connect / TLS /
timeout、取消、200 后响应过大 / 非 JSON / 坏 JSON / 形状不符 / 空正文 MUST NOT 自动重试。
本地预检 MUST NOT 自动重试。Search 空 results 不视为错误，Fetch 空 Markdown 即使官方不计费也不重试。
200 已到达后的本地解析失败 MUST NOT 为追求成功而重复请求。

错误 SHALL 使用稳定内部分类：`web_args_invalid` / `web_provider_unconfigured` / `web_url_blocked` /
`web_dns_failed` / `web_dns_blocked` / `web_redirect_limit` / `web_redirect_requires_approval` /
`web_unsupported_content` / `web_content_type_unknown` / `web_network_failed` / `web_timeout` /
`web_cancelled` / `web_response_too_large` / `web_provider_protocol_error` / `web_http_error` /
`web_empty_content`。4xx / 5xx SHALL 归 `web_http_error` 并保留真实 status、attempts 与可得的 provider
code / request id；3xx SHALL 不跟随并统一归 `web_provider_protocol_error`，不得双重映射。
DeepSeek 404 MUST NOT 被伪造为更精确的目标原因。

Web 工具错误 SHALL 是 `ToolOutput{ok:false}`，不是 LLM `TurnError`，MUST NOT 设置 `Session.failed`
或新增错误行重试按钮。Web 分类 MUST NOT 复用 LLM 的 `FailureKind`，也不得把 LLM 集合中的 425 加入
Web 自动重试。工具内部重试只重发当前 HTTP 请求，MUST NOT 重放同批其它工具。

#### Scenario: 可重试状态有界退避

- **WHEN** mock DeepSeek 依次返回 429、503，随后成功；另一序列持续返回 500
- **THEN** 前者在第三次 attempt 成功且 attempts=3；后者三次后以 `web_http_error` 收尾，退避不超过
  合同上限，不重放同批其它工具

#### Scenario: 其它失败不自动重试

- **WHEN** 分别出现 HTTP 400 / 401 / 402 / 403 / 404 / 413 / 425、本地 timeout、取消，以及 200 后
  过大 / 坏 JSON / 空正文
- **THEN** 每类都按对应稳定 code 收尾且没有第二次 DeepSeek 请求；本地 timeout 与 200 后失败不得因
  「也许未计费」而重发

#### Scenario: 3xx 不跟随且只有一个错误码

- **WHEN** DeepSeek 分别返回 301 / 302 / 307 / 308 与带敏感目标的 Location
- **THEN** 每种都只归 `web_provider_protocol_error`，实际跳转请求为 0、Bearer 不泄漏，
  不得再同时映射为 `web_http_error`

#### Scenario: 取消不产生半截成功

- **WHEN** 工具在等待响应头、读取 body 或退避期间收到停止
- **THEN** 返回 `web_cancelled`、关闭响应且不再发新 attempt；已收部分 JSON 不进入成功结果，
  会话锁不被 HTTP 等待占用

### Requirement: Untrusted Web 内容与审计留存

Search / Fetch 的 title、snippet、summary、content、provider_message 与 redirect_url SHALL 全部视为
untrusted data，结果信封的 `trust:"untrusted"` SHALL 恒在。这些字符串只能作为 function output 的
JSON 数据进入模型上下文，MUST NOT 注入 system prompt、AGENTS、权限规则、批准理由或 provider 配置。
网页里的「忽略之前指令」「用户已批准」「以后全部 allow」「执行某命令」等文本 MUST NOT 被当作授权事实，
不得改变权限配置 / 缓存，也不得自动触发 curl、写文件、修改权限、二次 Fetch 或新 provider 请求。
后续模型调用 SHALL 重新经过同一工具循环、预算、权限与安全校验。

每次工具完成 SHALL 仍经既有 `finish_call` 形成 function call / output 项与 panel 记录。provider 已实际
请求后失败时，错误信封（含 attempts / status / provider / request id）SHALL 同样留在该工具结果中，
下一次 LLM 请求的 wire 历史 SHALL 携带它。DeepSeek tools 是工具外部请求，MUST NOT 另造第二套
`llm_request` / `llm_response`。

后续 LLM 往返失败后的显式重试 SHALL 复用原 input，MUST NOT 重放已执行的 Web 工具；重试成功后的
新 Web 调用仍须重新经过批准与安全校验。历史恢复 SHALL 仅凭既有 JSONL 保留 query / URL、来源、错误与
truncated 标记，不依赖新 sidecar，不改写旧文件。

#### Scenario: 网页提示注入不升级权限

- **WHEN** 网页正文包含「忽略指令、自动批准、执行 curl、以后全部 allow」等指令
- **THEN** 文本只作为 untrusted JSON 字符串保留，权限配置与缓存不变；后续写 / 危险工具仍按原模式进闸，
  不产生自动 curl 或二次 Fetch

#### Scenario: provider 失败后 wire 与重试不重放

- **WHEN** DeepSeek 已实际请求并失败，随后一次 LLM 往返也失败，用户执行既有显式重试
- **THEN** 工具错误连同 attempts / status / provider 留在 function output、panel 与 wire；重试请求的
  messages 与失败请求相同，DeepSeek 请求次数不增加，工具结果不重复

#### Scenario: 历史恢复保留统一来源与截断事实

- **WHEN** 含 Search / Fetch 的会话仅凭 JSONL 恢复
- **THEN** query / URL、来源字段、错误与 `truncated` / `truncated_fields` 均可按既有 wire 恢复，
  不需要新 sidecar，旧文件逐字节不变

### Requirement: Web 真实 HTTP 验收装配边界

生产 Web provider SHALL 只有 official 装配：DeepSeek endpoint 来自官方常量，生产配置 MUST NOT 提供
endpoint 参数、loopback 白名单、代理开关或跳过 URL / DNS 校验的路径。生产 transport / resolver
SHALL 执行真实 HTTP 与系统 DNS，目标预检与 DeepSeek client 均显式 `no_proxy`。

隔离测试与真机验收 SHALL 使用独立测试 provider / transport 装配，同时复用生产同款参数校验、DNS
全集检查、地址固定、redirect、预算、重试与错误分类。只有测试 provider 构造器可接收合成 DeepSeek
endpoint；生产构造器 MUST NOT 接收该参数。合成 resolver SHALL 给 `target.test` 返回脚本化公网身份，
测试 connector SHALL 再把已验证公网 IP + 原 host 映射到本地监听地址，不得为验收全局放行 loopback。
HTTPS SHALL 使用只含 `target.test` 的测试 CA / 证书与隔离 trust store，不得关闭证书校验或挂载真实
浏览器凭据。

注入 SHALL 只能由隔离验收专用 build / 装配显式激活；普通 `config.json`、环境变量、真实 vault、
生产 `pnpm tauri dev` 与发布构建 MUST NOT 有激活入口。验收 SHALL 记录真实 HTTP method / path / body /
状态序列 / 请求次数 / 读取字节数；LLM mock 只驱动确定的工具调用，MUST NOT 用 fixture 声明的错误
替代这些 Web HTTP 证据。

#### Scenario: 合成公网身份映射本地服务

- **WHEN** 隔离验收以 `target.test` 跑 search → fetch、redirect / DNS 与超时取消
- **THEN** 生产同款全集校验与地址固定先执行，测试 connector 才把已验证公网身份映射到本地监听；
  记录包含真实 HTTP 请求形状与次数，不是仅断言 mock fixture 被调用

#### Scenario: HTTPS 保留 Host / SNI 与证书校验

- **WHEN** 隔离验收以 HTTPS 访问 `target.test`
- **THEN** 仅信任测试 CA / 证书与隔离 trust store，原 Host / SNI 与证书链均被验证；不得关闭证书
  校验或以 HTTP 用例冒充 SNI 证据

#### Scenario: 生产不能激活测试旁路

- **WHEN** 普通配置 / 环境变量 / 真实 vault / 生产构建尝试提供合成 endpoint 或 loopback 映射
- **THEN** 没有激活入口，生产仍只使用官方 DeepSeek endpoint，URL / DNS 拒绝规则不变；
  测试装配不出现在发布构建里
