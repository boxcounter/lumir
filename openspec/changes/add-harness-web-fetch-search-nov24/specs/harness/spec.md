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

- **WHEN** 交互主会话需要搜索或读取网页
- **THEN** 模型使用统一的 `web_search` / `web_fetch` 合同，首 provider 为 DeepSeek；系统不得再要求该链路
  必须经 Skill + CLI，也不得提供 DeepSeek 专用搜索别名

### Requirement: 工具循环

对话运行时 SHALL 支持工具循环：模型返回工具调用时，系统执行对应工具并将结果回送，直至模型不再调用工具或达到循环上限（默认 50，`[harness].loop_max` 可调；出厂值 M367 由 8 上调至 50，上界仍为 64）。达到上限 SHALL 终止循环并在面板给出明确提示。运行时 SHALL 维护会话状态于 Rust core，webview 重载 MUST NOT 丢失会话。工具集 SHALL 为 9 件 vault 操作工具：`vault_read`、`vault_search`、`vault_list`、`vault_patch`、`vault_create`、`vault_move`、`vault_delete`、`skill_load`、`cli_run`；另有不操作 vault 的编排工具 `task`、调度工具 `cron_task_create` / `cron_task_list` / `cron_task_remove`，以及交互主会话的 2 件 Web 阅读工具 `web_search` / `web_fetch`。`task` 属编排工具，是模型按名字委派子代理的入口，其入参与结果契约见 `harness-subagents` capability；子运行的运行上下文 MUST NOT 获得 `task`（派生深度恰好 1 层，实现口径为工具白名单）。3 件调度工具是交互会话注册定时任务的入口，其入参、校验与回执契约见 `cron` capability；它们 SHALL 只在**交互发送路径**注册——无人值守运行（cron 交接的工具白名单只含 9 件 vault 操作工具）与子运行（定义白名单的元素必须是 vault 操作工具）MUST NOT 获得它们。2 件 Web 阅读工具同样 SHALL 只在交互主会话注册，cron 与子运行 MUST NOT 获得它们；本 change 不扩大既有 9 件白名单或内建 `general`。清单外能力扩张须经 Alex 裁决（ADR 0007；`vault_move` / `vault_delete` 的扩张、`vault_list` 的加入、`task` 与 3 件调度工具的分类均以该 ADR 的修订为口径）。

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

- **WHEN** 分别取交互主会话、cron 交接与子运行的模型工具定义
- **THEN** 只有交互主会话含 `web_search` / `web_fetch`；另外两条路径不含它们，既有 9 件 vault 工具
  白名单与内建 `general` 不因此扩权

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

## ADDED Requirements

### Requirement: 统一 Web 搜索与抓取工具

交互主会话 SHALL 提供 `web_search` 与 `web_fetch`，两者 SHALL 使用同一结果信封与 `WebSource`
来源结构。`web_search` 输入 SHALL 仅含 `query` / `count` / `need_content`：query trim 后为 1–128 个
Unicode 字符且不全为空白；count 缺省 5、本地允许 1–10，越界 SHALL 返回 `web_args_invalid` 而非静默
clamp；`need_content` 缺省 `false`。`web_fetch` 输入 SHALL 仅含 1–8192 字符的 `url`。工具 schema
MUST NOT 暴露 API Key、provider、base URL、超时、重试、响应上限或任意 HTTP header。

统一信封 SHALL 含 `ok` / `provider` / `provider_id` / `operation` / `attempts` / `trust` /
`truncated` / `truncated_fields`；成功 Search SHALL 另带完整 query 与 `results: WebSource[]`，成功
Fetch SHALL 另带 `source: WebSource`。`WebSource` SHALL 固定包含 `url` / `title` / `snippet` /
`summary` / `content` / `content_format` / `site` / `date` / `authority`；无信息字段用 null，
MUST NOT 把读不到伪造成空字符串。Search SHALL 原样保留 date 与 -1–4 的 authority（含 -1 = 未知）；
Fetch 无这两项信息时填 null。`site_icon` MUST NOT 进入结果，避免派生未审计的图片请求。

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

Search 的「采纳且本会话不再问」SHALL 明确授权本会话后续网页搜索，持久 allow SHALL 为工具级
`web_search`；Fetch 的会话记忆与持久 allow SHALL 只覆盖当前 origin，规则形如
`web_fetch(https://example.com)`。批准卡 SHALL 显示该实际粒度。普通采纳 MUST NOT 写入缓存，缓存与
持久规则 MUST NOT 相互写入。基础参数形状与 URL scheme / userinfo 校验 SHALL 在批准预览之前完成，
非法调用 MUST NOT 先生成携带凭据或无效目标的批准卡。deny SHALL 永远优先；allow / 缓存只减少批准，
不得跳过执行期的 DNS、重定向、内容类型、预算或密钥检查。

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
目标站。该事实 SHALL 在批准卡可见。tools API 的 3xx MUST NOT 跟随；目标预检 MUST NOT 携带
DeepSeek Key、Cookie、vault 内容或浏览器登录态。

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
自由选择地址。校验与连接 SHALL 共用同一地址集，下一跳 SHALL 重新执行全集校验，以防
check-then-connect 与 DNS rebinding 绕过。错误 MUST NOT 回显完整 DNS 答案或内部网络拓扑。

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
`web_empty_content`。非 2xx SHALL 归 `web_http_error` 并保留真实 status、attempts 与可得的 provider
code / request id；DeepSeek 404 MUST NOT 被伪造为更精确的目标原因。

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
