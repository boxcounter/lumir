# harness Specification

## Purpose
定义 AI 探针（harness）的落地口径——ADR 0007 授权的探索期能力：旁侧 pane 的对话面板（pane 容器的
内容件，见 `pane-layout` 的「harness pane」；唤起 / 收起、流式 Markdown 呈现、上下文用量常驻显示）；
唤起时的编辑器上下文注入（当前路径 +
视口行范围，发送前可核对）；AGENTS.md 三层（user-wide `~/.agents/AGENTS.md` + vault 根 +
vault 根 `AGENTS.local.md` 本地覆盖层）与 Skill
双根（user-wide + vault-wide）的自动装配；Rust core 的工具循环与固定工具集（9 件 vault 操作工具：
`vault_read` / `vault_search` / `vault_list` / `vault_patch` / `vault_create` / `vault_move` /
`vault_delete` / `skill_load` / `cli_run`，另加 2 类不操作 vault 的工具：1 件编排工具 `task` 与
3 件调度工具 `cron_task_create` / `cron_task_list` / `cron_task_remove`）；
两层权限规则（allow / deny）之上的**三档权限模式**（`read_only` /
`vault_write` / `full_access`）与五层判定管线（deny 规则 > vault 内写重定向 > 危险黑名单 > allow
规则 > 模式默认分层），以及写类 / CLI 的批准闸（含 cli_run 用途句与会话内「采纳且本会话不再问」
缓存）；上下文触顶的自动压缩（可见压缩标记 + wire 完整留存）；`[harness]` 配置节；会话边界
（绑 vault、内存态、每个逻辑会话一个 `sessions/<vault 稳定 id>/<session_id>.jsonl` 的 wire 形态留存、以及从历史
会话最小恢复的入口）；composer 粘贴剪贴板图片（图片落 harness 侧内容寻址存储、随消息以 content
parts 交错的形态进上下文，逐模型 `vision` 能力声明把关）；以及不依赖外部 API 的 mock provider。能力
边界以 ADR 0007 Decision 2 为准，清单外工具扩张须经 Alex 裁决。由 change `add-harness-probe` 归档并
入（2026-10-03，实现 M301–M306）；change `add-harness-permission-modes` 与
`reshape-harness-session-recording` 归档并入（2026-10-10）叠加上述权限模式、vault 移动 / 删除工具与
wire 留存 / 最小恢复口径；change `harness-composer-image-paste` 与 `harness-sessions-per-vault`
归档并入（2026-10-11）叠加 composer 图片粘贴 / 投递协议与按 vault 分目录的会话留存；change
`add-harness-subagents` 归档并入（2026-10-24）叠加 `task` 编排工具与子代理委托能力（见
`harness-subagents` capability）。

## Requirements

### Requirement: 对话面板

系统 SHALL 提供对话面板，位于**旁侧 pane**（pane 容器的内容件，见 `pane-layout` 的「harness pane」；不再位于骨架右栏 dock 列——dock 列随 `move-harness-to-pane-chat-frame` 移除），可经 `harness.toggle` 命令（⌘⇧A）与标题栏 toggle 钮唤起与收起。面板 SHALL 支持多轮对话并以流式增量呈现模型输出；模型输出 SHALL 按 Markdown 渲染（GFM 基本面含代码块高亮），一切模型输出 MUST 经转义后注入（零 HTML 直插）。全部可见文案 SHALL 走文案表（zh/en 双档），样式 SHALL 只消费 token 层取值。流式渲染与网络处理 MUST NOT 进入编辑器 keypress-to-paint 路径（ADR 0002 §6）。

模型输出里的链接 SHALL 上屏为可点锚元素：`[文字](url)` 按显示文本呈现、`<url>` 自动链接按 URL 呈现，**裸 URL**（GFM 直接产 `URL` 节点的三种形态：`https://…`、无 scheme 的 `www.…`、邮箱字面量）SHALL 以 URL 原文为上屏文本渲染为同一形态的锚——**MUST NOT 整段跳过**（跳过 = URL 在面板里隐身；表格 cell 里的裸 URL 同样在列）。锚的 `href` 只作展示与 `title`，一切点击 SHALL 被拦下交给既有的外链打开命令（scheme 白名单在 Rust 侧判定，前端 MUST NOT 自行判定能不能开）；`[文字](url)` 的 URL 部分 MUST NOT 作为可见文本二次上屏。代码块与行内代码里的 URL SHALL 保持代码原文（不产锚）。

composer（输入区）与控制行 SHALL 收进同一个圆角卡片容器（内容底色 + 边框 + focus-within 强调框）；控制行位于容器底部，自左向右为模型 chip、ctx 读数、弹性间隔、发送钮。发送钮 SHALL 为图标钮（↑ / ■ 两态 glyph），配色 SHALL 按原型中性实心取值（浅色深灰近黑 + 白 glyph、深色浅灰 + 深 glyph、eink 纯黑，经组件级变量落账，不改全局 accent 一族）；处理中（busy）态 SHALL 显示脉冲环（box-shadow 呼吸动画，环色为与按钮同族的中性 tint；eink 下环不可见、状态由 glyph 承担；prefers-reduced-motion 下不脉冲）。其可读名称与悬停提示 SHALL 沿用文案表两态文案（发送 / 停止），行为口径（Enter 发送、处理中点击停止、stopping 幂等）不变。

模型输出里的 GFM 表格 SHALL 按**源码槽位矩形呈现**：每格的列位由它落在第几个与第几个分隔符之间决定，空槽占住自己的列位（补一个空 `th`/`td`），MUST NOT 让后续格子左移；格数少于 delimiter 行的行在尾部补空 cell；整表每行的格数相同，且以 delimiter 行的列数为下界。**MUST NOT 以「语法树里有没有 cell 节点」判空槽**——解析器对空单元格不产 cell 节点、只产相邻的两个分隔符，按节点缺失判空槽会把空格吃掉并把后续格子整体左移（三列渲染成两列）。某行的格数多于 delimiter 行时整表按更宽的那个列数呈现，MUST NOT 静默丢格。矩形性口径与编辑器侧 [Foundation Table Reading 质量合同](../../../docs/specs/table-reading.md) §2 同源，差异只在「多于 delimiter 行」这一侧：编辑器整块降级为源码，面板是无源码可降的只读呈现，故取「不丢格」。

#### Scenario: 唤起与流式对话

- **WHEN** 面板经命令唤起并发送一条提问
- **THEN** 面板出现在旁侧 pane（无第二 pane 时自动分栏，默认宽度比 harness:文档 pane = **1:1**，canonical 定义见 `pane-layout` 的「harness pane」）；模型输出以增量方式逐段呈现并按 Markdown 渲染；期间编辑器键入响应不受影响

#### Scenario: composer 容器形态

- **WHEN** 面板打开且输入区获得焦点
- **THEN** 输入区与控制行在同一个圆角卡片容器内，容器呈 focus-within 强调框；发送钮为图标钮且读屏名为「发送」（处理中为「停止」）

#### Scenario: 文案与 token 纪律

- **WHEN** 界面语言切换（zh ↔ en）
- **THEN** 面板全部长驻文案经 `onRelabel` 重绘为对应语言；面板样式全部取值自 token 层

#### Scenario: 裸 URL 上屏为链接

- **WHEN** 模型输出的正文（含表格 cell 内）出现裸 URL（`https://…`、`www.…`、邮箱字面量）
- **THEN** 该 URL 以原文为上屏文本渲染为可点锚元素（与 `[文字](url)` 同一个样式与同一个打开入口），MUST NOT 在面板里缺席；点击把 URL 原文交给外链打开命令（能不能开由后端 scheme 白名单判定），导航被拦下

#### Scenario: 标准链接的 URL 不二次上屏

- **WHEN** 模型输出的正文出现 `[文字](https://…)`
- **THEN** 面板显示的链接文本是「文字」，URL 部分只作为锚的 `href` 与悬停提示，MUST NOT 作为可见文本再上屏一次

#### Scenario: 表格列数守恒（空单元格占列位）

- **WHEN** 模型输出的 GFM 表格里有空单元格（`| a |  | c |`、`| a || c |`，或表头首列 / 末列为空），或某一行的格数少于 delimiter 行的列数
- **THEN** 空槽占住自己的列位（渲染为一个空 `th`/`td`）、后续格子不左移，短行在尾部补空 cell；整表每行格数相同且不低于 delimiter 行的列数，MUST NOT 出现「源码三列渲染成两列」

### Requirement: 上下文注入与可见性

唤起对话时，系统 SHALL 自动组装当前编辑器上下文随对话注入：当前 TAB 的 vault 相对路径 SHALL 始终注入；消息未携带引用卡片时 SHALL 注入活跃编辑器 pane 的视口**行范围**（起止行号，chip 标明注入的是视口），且 MUST NOT 注入该范围的原文（原文随每条消息进上下文太冗余）；消息携带引用卡片时 SHALL 跳过视口注入（用户已显式策展，避免重复与噪声）。选区 SHALL NOT 被自动注入——选中片段一律经「摘录引用卡片」手势显式策展后进入上下文。待注入的自动上下文 SHALL 在面板输入区上方以可核对的形式呈现（文件路径 + 视口行范围），Alex 发送前可见。

#### Scenario: 选区注入

- **WHEN** 在编辑器中选中一段文字后唤起面板并直接提问（未使用摘录手势）
- **THEN** 模型收到的消息不包含该选区内容（选区不再自动注入，需经「摘录到对话」手势显式策展为引用卡片）；输入区上方 chip 只显示文件路径与视口行范围

#### Scenario: 无选区时注入视口

- **WHEN** 无选区唤起面板，且消息不含引用卡片
- **THEN** 注入内容为当前视口的**行范围**（起止行号），不含该范围的原文；且 chip 标明注入的是视口而非选区

#### Scenario: 携带卡片时跳过视口

- **WHEN** 消息携带至少一张引用卡片
- **THEN** 该条消息不附加视口行范围注入；引用卡片对应的 `<quote>` 块即该消息的编辑器上下文

### Requirement: AGENTS.md 自动加载

会话建立时，系统 SHALL 自动装配系统上下文，包含三层 AGENTS 指令文件内容，注入顺序为：user-wide（`~/.agents/AGENTS.md`）→ vault 根（`<vault>/AGENTS.md`）→ vault 根本地覆盖层（`<vault>/AGENTS.local.md`）。第三层 SHALL 排在 vault 根 `AGENTS.md` 之后注入，承担「本机本地覆盖层」语义——当两层对同一事项给出相互冲突的指示时，以后注入的 `AGENTS.local.md` 为准；该优先级口径 SHALL 在系统上下文中由 `AGENTS.local.md` 所在节的标题显式表达（模型读得到），MUST NOT 依赖模型从注入先后自行推断。三层文件各自不存在、非文件或读取失败时 SHALL 静默跳过（不注入、不告警、不阻断会话），与既有两层同口径；系统 SHALL NOT 为文件缺失或读取失败产出 config warning 或任何界面提示。装配清单（`session_open.assembly`，形态见「会话本地留存」）SHALL 为本层记一条来源条目，记录路径与存在与否（不存在的来源同样在场、`exists:false`）。嵌套子目录级 AGENTS 指令文件不在本期。requirement 名保留「AGENTS.md 自动加载」——`AGENTS.local.md` 属同一 AGENTS 指令文件族，本 change 的语义扩围以本条正文为准。

#### Scenario: 双层注入

- **WHEN** 两处 AGENTS.md（user-wide 与 vault 根）均存在并发起新会话
- **THEN** 系统上下文包含两份文件的内容；仅一处存在时注入存在的一份，不报错

#### Scenario: 本地层注入与顺序

- **WHEN** user-wide `~/.agents/AGENTS.md`、vault 根 `AGENTS.md`、vault 根 `AGENTS.local.md` 三处均存在并发起新会话
- **THEN** 系统上下文依次包含三份文件的内容；`AGENTS.local.md` 的内容在文本次序上晚于 vault 根 `AGENTS.md` 的内容

#### Scenario: 本地层缺失静默跳过

- **WHEN** vault 根 `AGENTS.local.md` 不存在（或非文件 / 读取失败），其余层照常存在，发起新会话
- **THEN** 系统上下文不包含本地层内容，会话正常建立，不产生告警或界面提示；其余各层的注入不受影响

#### Scenario: 装配清单记录本地层

- **WHEN** vault 根 `AGENTS.local.md` 不存在（或存在）并发起新会话
- **THEN** `session_open` 的装配清单含本地层来源条目：路径为 vault 根 `AGENTS.local.md`；不存在时 `exists:false` 且字节数为 0，存在时 `exists:true` 且字节数为该层注入文本的长度

#### Scenario: 覆盖语义随装配表达

- **WHEN** vault 根 `AGENTS.md` 与 vault 根 `AGENTS.local.md` 均存在且对同一事项给出相互冲突的指示
- **THEN** 系统上下文中 `AGENTS.local.md` 一节排在其后，且该节标题标明其为本地覆盖层、冲突时以该层为准；系统 MUST NOT 自行解析或合并两层的内容语义

### Requirement: Skill 支持

系统 SHALL 自动发现 user-wide（`~/.agents/skills/`）与 vault-wide（`<vault>/.agents/skills/`）两处的 Skill（SKILL.md 约定），vault-wide 同名覆盖 user-wide。Skill 索引（name + description）SHALL 注入系统上下文；`skill_load(name)` 工具 SHALL 按名加载 SKILL.md 全文，路径解析 MUST 限定在两个 Skill 根内（只读、防逃逸）。与网页无关的外部能力 SHALL 以「Skill + 对应 CLI」形态接入；统一 `web_search` / `web_fetch` 是本条明确列入工具集的外部网页阅读合同，首个 provider 为 DeepSeek。后续搜索 / 抓取 provider MUST 并入同一工具合同，MUST NOT 为特定服务另造专用工具名、别名或第二套结果形状。

除模型自主判断外，用户 SHALL 可经输入区显式选择点名 Skill，由后端确定性加载；两条入口的缺省、分控、
权限与留存见「Skill 的混合调用、入口策略与候选接受」。文本里的 `/名字` 字样 MUST NOT 被当作显式调用依据。
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

对话运行时 SHALL 支持工具循环：模型返回工具调用时，系统执行对应工具并将结果回送，直至模型不再调用工具或达到循环上限（默认 50，`[harness].loop_max` 可调；出厂值 M367 由 8 上调至 50，上界仍为 64）。达到上限 SHALL 终止循环并在面板给出明确提示。运行时 SHALL 维护会话状态于 Rust core，webview 重载 MUST NOT 丢失会话。工具集 SHALL 为 9 件 vault 操作工具：`vault_read`、`vault_search`、`vault_list`、`vault_patch`、`vault_create`、`vault_move`、`vault_delete`、`skill_load`、`cli_run`；另有不操作 vault 的编排工具 `task`、调度工具 `cron_task_create` / `cron_task_list` / `cron_task_remove`，以及交互主会话的 2 件 Web 阅读工具 `web_search` / `web_fetch`。`task` 属编排工具，是模型按名字委派子代理的入口，其入参与结果契约见 `harness-subagents` capability；子运行的运行上下文 MUST NOT 获得 `task`（派生深度恰好 1 层，实现口径为工具白名单）。3 件调度工具是交互会话注册定时任务的入口，其入参、校验与回执契约见 `cron` capability；它们 SHALL 只在**交互发送路径**注册——无人值守运行（cron 交接的工具白名单只含 9 件 vault 操作工具）与子运行（定义白名单的元素必须是 vault 操作工具）MUST NOT 获得它们。2 件 Web 阅读工具 SHALL 只在 `harness.web_access.enabled=true` 时于交互主会话注册，该键缺省为 `true`，因此默认注册；显式 false 不注册且幻觉调用回送 `tool_unknown`。cron 与子运行 MUST NOT 获得它们，本 change 不扩大既有 9 件白名单或内建 `general`。清单外能力扩张须经 Alex 裁决（ADR 0007；`vault_move` / `vault_delete` 的扩张、`vault_list` 的加入、`task` 与 3 件调度工具的分类均以该 ADR 的修订为口径）。

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
- **AND** `harness.web_access.enabled` 缺省为 true 时交互主会话默认注册；显式 false 时三条路径都不含
  这两件工具，幻觉调用回送 `tool_unknown`，不解析 provider 且不产生网络请求

### Requirement: 权限机制

系统 SHALL 实现两层权限规则：allow / deny（不存在 `ask` 规则表——需要「必须问」的语义由危险黑名单与模式默认分层承担），判定顺序 deny > allow > 默认分层。规则语法 SHALL 支持 tool 级与 tool+模式级（如 `cli(tavily *)` 的命令前缀匹配）；匹配语义 SHALL 为：模式以 `*` 结尾时按**主体串前缀**匹配，星号前是空格时（生成规则的标准形态，如 `cli(git push *)`）另 SHALL 命中「去掉该尾随空格后逐字相等」的主体串——无参数的 `git push` 与带参数的 `git push origin main` 同样命中，词边界 MUST NOT 因此放宽（`git pushx` 不命中）。allow 规则 SHALL 既可手写于配置，也可由批准卡沉淀（生成、去重与作用域口径见「权限规则的持久化与治理」），并 SHALL 在权限浮层中逐条可见、可删。权限规则之外，系统 SHALL 提供**三档权限模式**作为默认分层的档位：`read_only` / `vault_write`（默认）/ `full_access`，逐档语义如下——读类工具（`vault_read` / `vault_search` / `vault_list` / `skill_load` / `cron_task_list`）三档均直接放行；`vault_patch` / `vault_create` / `vault_move` 在 `read_only` 档 SHALL 逐个问（Always Ask，2026-10-09 Alex 裁决：该档语义为「读自动放行、一切写逐个问」，模式层 MUST NOT 直接拒绝），在 `vault_write` 与 `full_access` 档 SHALL 自动放行；`vault_delete` 在 `read_only` 与 `vault_write` 档 SHALL 逐个问（Vault Write 档的分界以 Alex 裁决点 1 为口径），在 `full_access` 档 SHALL 自动放行；`cli_run` 只读白名单命令三档均直接放行；`cli_run` 写命令在 `read_only` 与 `vault_write` 档 SHALL 逐个问，在 `full_access` 档 SHALL 自动放行（写目标在 vault 内者除外，见「cli_run 命令分类与 vault 写重定向」）；`cron_task_create` / `cron_task_remove` 在 `read_only` 与 `vault_write` 档 SHALL 逐个问、在 `full_access` 档 SHALL 自动放行（定时任务是持续性开销，批准的一刻是用户唯一能看见「它以后会自己跑」的时机）；危险黑名单命令（rm / shutdown·reboot·halt·poweroff / mkfs 系 / dd / git reset --hard / git clean / shell 包装器类，首版清单；shell 包装器中「受限解包」成立的只读形态除外，口径见「cli_run 命令分类与 vault 写重定向」）**任何档都 SHALL 逐个问**，MUST NOT 自动放行。模式层 SHALL 只在「直接放行」与「逐个问」之间切换，SHALL NOT 产出「拒绝」——拒绝只来自用户 deny 规则。

`web_search` / `web_fetch` SHALL 属于独立的 `web_read` 权限类，MUST NOT 加入上述读类工具白名单。
`harness.web_access.approval` 缺省为 `allow_all`，两件工具在 `read_only` / `vault_write` /
`full_access` 三档均 SHALL 默认直接执行；只有用户显式改为 `ask` 才进入批准闸。Web 判定顺序为
deny > 既有硬层 > `web_access.approval`，deny 永远优先；Web 不使用 allow 规则或会话缓存派生授权。
任何 approval 值都 MUST NOT 跳过执行期的 URL、DNS、重定向、内容类型、预算或密钥检查。
`web_read` 是权限分类，MUST NOT 被实现成第三件工具或第四档权限模式。

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

#### Scenario: Web 默认 Allow 与 deny 硬边界

- **WHEN** `harness.web_access.approval` 缺省为 `allow_all`，模型在三种权限模式中的任一种调用
  `web_search` 或 `web_fetch`
- **THEN** 调用不进入批准闸而直接执行，工具行保留 query / URL；provider、费用与 untrusted 审计
  保留在默认关闭的「查看详情」中（呈现口径见「Web 访问策略与 origin 例外」条）；若目标命中
  `web_fetch(origin)` deny 或其它硬边界，仍按对应错误拒绝且不产生请求

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
默认分层**（带当时判定的档位名与该档释义），以及 **Web access 策略**（独立
`DecisionReason::WebAccessPolicy { approval: "ask" }`，明确实际 `harness.web_access.approval=ask`）。
Web access 依据 MUST NOT 使用 `ModeDefault`，也 MUST NOT 显示 `read_only` / `vault_write` /
`full_access` 的档释义作为进闸原因；`allow_all` 自动放行不产依据，origin deny 沿用 `DenyRule`
且不产批准卡。判定依据 MISSING（旧后端 / 旧快照载荷）时该行 SHALL NOT 渲染，MUST NOT 以猜测或
默认文案填充。该行 SHALL 随界面语言重取文案，MUST NOT 残留旧语言串。

批准卡的次级动作 SHALL 由后端随批准请求下发（事件与快照两条通道同源），前端 MUST NOT 按判定依据
或其它字段自行推断可见性。非 Web 工具因模式默认分层进闸的卡 SHALL 显示
「采纳且本会话不再问（记住 `<粒度>`）」；
可持久化规则的工具（非危险层进闸的 `cli_run`、`vault_patch` / `vault_create` / `vault_move`）另
SHALL 显示「以后都允许 `<规则原文>`」，规则原文由后端单一真源生成、按钮逐字显示。**危险黑名单
命中的卡 MUST NOT 显示这两枚次级动作**：该层先于 allow 规则与会话缓存判定，这两枚按钮在那类卡上
是死按钮（点了也不生效），显示即误导。次级动作字段缺省（旧后端 / 旧快照载荷）时两枚按钮 MUST NOT
渲染。

`harness.web_access.approval` 缺省为 `allow_all`，Web 工具 SHALL NOT 默认产生批准卡；只有显式
`approval=ask` 时，Web 批准卡的预览载荷才 SHALL 与批准请求事件 / `harness_state` 快照同源：
Search 显示完整 query、实际 provider id、query 发往 DeepSeek 的外发与计费说明；Fetch 显示完整 URL、
规范化 origin、实际 provider id，以及「Lumir 先做本地 HEAD / Range GET 预检、再把 URL 发给
DeepSeek 抓取」的双路外发与计费说明。provider 尚未解析成功时预览中的 provider / provider id 为 null，
不伪造 `"deepseek"` 为配置 id。Web 卡不生成专用持久 allow / 免问动作；origin deny 只在设置与
权限规则中管理。批准或拒绝后，待决字段、说明与动作 SHALL 按本条统一终态折叠，只保留工具名 +
决策结果 + 相对时间；完整 query / URL 与决策摘要 SHALL 可在展开详情中回看，不以待决按钮或置灰
动作残留。默认 Allow 的工具行 / 结果 SHALL 与决策后同形：紧凑行 + 默认关闭的「查看详情」；
输入、provider、费用与 untrusted 审计 SHALL 保留在该详情中，MUST NOT 以「常驻显示」为默认态。

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

#### Scenario: full_access 下 Web Ask 依据独立于权限模式

- **WHEN** 权限模式为 `full_access` 且 `harness.web_access.approval=ask`，模型调用 Web 工具
- **THEN** 判定依据为 `WebAccessPolicy{approval:"ask"}`，明确网页访问策略是 Ask，不出现
  `ModeDefault` 或 full_access 档释义；approval=allow_all 时不产卡，origin deny 时不产卡

#### Scenario: 判定依据随决策退场

- **WHEN** Alex 对带判定依据行的批准项点击采纳或拒绝
- **THEN** 终态记录里不出现判定依据行（与待决副句、决策按钮、次级动作按钮一同退场），界面零残留

#### Scenario: 可持久化的卡显示两枚次级动作

- **WHEN** 默认 `vault_write` 档下 `cli_run("tvly", ["search", "x"])` 进入批准闸
- **THEN** 卡上同时显示「采纳且本会话不再问（记住 `tvly search`）」与「以后都允许 `cli(tvly search *)`」两枚次级动作；两枚文本与后端生成的粒度 / 规则逐字相同

#### Scenario: 危险卡不显示次级动作

- **WHEN** 任意档下 shell 包装器命令（脚本不可解包）或危险黑名单命令进入批准闸
- **THEN** 卡上 MUST NOT 出现「采纳且本会话不再问」与「以后都允许」两枚按钮（MUST NOT 以置灰形态出现）；只保留采纳 / 拒绝

#### Scenario: 可选 Ask 的 Fetch 预览与终态折叠

- **WHEN** `harness.web_access.approval=ask`，`web_fetch("https://example.com/a?q=1")` 进入批准闸且
  provider 已解析成功，随后用户采纳或拒绝
- **THEN** 卡片显示完整 URL、origin `https://example.com`、实际 provider id，以及 Lumir 预检 +
  DeepSeek 抓取的双路外发与计费说明；不出现 Web 专用持久 allow / 免问动作。决策后预览与按钮退场，
  卡片折叠为工具名 + 决策结果 + 相对时间，展开详情仍可回看完整 URL 与决策摘要

#### Scenario: 默认 Allow 不产生批准卡且审计仍在

- **WHEN** `harness.web_access.approval` 缺省为 `allow_all`，模型连续调用 Search / Fetch
- **THEN** 不产生逐次批准卡或 Web 专用持久 allow 动作，调用直接执行；工具行保留 query / URL，
  provider、费用与 `trust:"untrusted"` 保留在默认关闭的「查看详情」中

### Requirement: 上下文用量显示与触顶处理

composer 控制行 SHALL 常驻显示上下文用量读数（位于模型 chip 之后、发送钮之前）：context window 已用 %（最近一次请求的 input tokens ÷ 模型上下文窗口）与 cache hit %（Responses 形态下两 provider 统一走 `usage.input_tokens_details.cached_tokens`；映射表留在 provider 预设内防字段方言）。cache hit % SHALL 以**本逻辑会话累计命中率**（`Σcached_tokens ÷ Σinput_tokens`；会话建立、「新会话」重置、自动压缩开新逻辑会话各起一段、累计随之归零；**从历史恢复 SHALL 以源会话留存的读数为基底继续累计**——恢复时由留存重算：`session_open` 读数种子 + 其后会话轮次 usage 扫描，压缩调用是内部汇总调用、不计入）作为控制行**主读数**，MUST NOT 以最近一次请求的单回合命中率作为控制行主读数。**hover 气泡 SHALL 只呈现两项读数**（M533，Alex 2026-10-16：「气泡内容太冗余了。只需要这些信息：1. 当前上下文使用量和百分比。如果 ≥85 使用率，提示下一轮对话将自动压缩。2. 会话的缓存命中率」）：①上下文用量行——百分比 + 绝对 tokens 用量（M526；上下文已用 tokens / 模型窗口上限 tokens 与百分比同句），数据不可得时 SHALL 降级（绝对值缺键回落百分比形态、窗口上限值为零时不显示上限与百分比），MUST NOT 编造读数；②会话缓存命中率行——**只呈现百分比**（M533 是对 M526 需求 2 里 cache tokens 读数的显式 supersede，写法取 Alex 原话「缓存命中率（会话）：60%」；该行的百分比口径 SHALL 是会话累计，与控制行同一份读数）。**最近一次请求的单回合命中率、成因说明（冷启动 / 大块摊薄）与缓存写入 tokens SHALL NOT 出现在气泡里**（M533 移除这三项的上屏面）——三者 SHALL 仍随 `llm_response.usage` 进会话留存（见「会话本地留存」条），只是不再有上屏面。**气泡内的 tokens 数字 SHALL 以 k / m 为单位呈现**（M532，Alex 2026-10-16：「token 的最小单位是 k，如果超过 1000k，就升级成 m。让数字更加人可读 好理解」）：≥1,000,000 → `m` 档、≥1,000 → `k` 档、不足 1,000 原值直出（不带单位）；小数 SHALL 截断到 0.1 档（MUST NOT 四舍五入）、末尾 `.0` SHALL 省略（`1k` 而非 `1.0k`）。格式化 SHALL 由单一纯函数（`formatTokenCount`，`src/harness-panel.ts`）产出——M533 起气泡里只剩上下文用量行含 tokens 数字（D463 已用/上限、D464 降级行的已用）共此一份，MUST NOT 自行拼装；数字形态 MUST NOT 改变各行的在场 / 降级判定（绝对值缺键回落百分比形态、窗口上限为零时降级两条判定与单位无关）。控制行的百分比读数（ctx% / cache%）不是 tokens 数字，不受本规则约束。**从未发过请求的会话（快照 `has_usage=false`）读数区 SHALL NOT 渲染**（六键零值是缺省不是读数，渲染即成「0% · 0%」虚报）。**读数的两条载体 SHALL 携带同一组键**（M534，事件/快照一致性不变量）：`harness:event` 的 `usage` 事件与 `harness_state` 快照的 `usage` SHALL 携带同一组读数键（由同一份 `UsageSnapshot` 的序列化产出，含绝对值键 `input_tokens` / `cached_tokens` / `cached_tokens_session` / `context_window` / `has_usage`），MUST NOT 各维护一份键清单——新增读数键时两类载体 SHALL 同改。live 会话与快照 / 恢复路径因此渲染同一形态的读数（事件缺键会让 live 气泡静默回落百分比形态，而切 vault 回来走快照路径却带绝对值——M534 现场）；前端 MUST NOT 为任一载体另行推算读数。用量超过警示阈值（默认 85%，可配）时读数 SHALL 高亮，指针悬停读数 SHALL 浮出说明气泡（向上展开、右缘对齐读数右缘）、移开即收起；越线时气泡 SHALL 追加一行警示说明、点明**下一轮对话将自动压缩**（M533 措辞改准；该行恒在含义句之后）且 MUST NOT 复述同一行的百分比——用量行已显示过它，MUST NOT 常驻显示警示句，也 SHALL NOT 另挂 ⓘ 类可点入口（2026-10-07 去感叹号改 hover 形态，读数高亮已承担警示语义）。系统 SHALL 默认自动压缩（`auto_compact = true`）：每轮响应完成后检查，越阈值即自动把会话历史压缩为摘要、开新逻辑会话并注入摘要 + 当前编辑器上下文 + 系统上下文；自动压缩 MUST NOT 静默——面板插入可见压缩标记（摘要可展开），压缩前历史 SHALL 完整留存在旧会话 JSONL 文件（封闭不再追加），压缩摘要 SHALL 随新会话 `session_open` 留存。API 返回上下文超限错误时 SHALL 自动压缩后重试该轮一次。系统 MUST NOT 静默截断会话历史。

> **已知边界收口（2026-10-17 根因调查结论，替代 2026-10-12 起的「调查进行中」注）**：k3-256k 在 coding 端点（`api.kimi.com/coding/v1`）Responses 方言下「回报 `input_tokens` 不足名义窗口一半即被 400」的现象，根因已钉死为该端点 Responses 路径前置的**请求体字节闸**——按请求体 UTF-8 字节数判定，边界实测 `(417,231, 417,512]` 字节；报错文案 `Your request exceeded k3-256k model token limit: 262144` 的 262144 是名义窗口、不是闸的计数单位（决定性证据：417,985 B 纯英文合成请求外推仅 ~8.1 万 tokens 仍被 400，而 104,571 tokens / 417,231 B 的请求通过）。同账号同模型 **Chat Completions 方言**实证可正常服务到 211,055（普通轮）/ 234,656（压缩轮）input tokens、请求体 0.83–1.1 MB 放行——41.7 万字节是 Responses 方言专属，非账号/模型上限。证据 `test-results/ctxdiag-2026-10-17/`（git 外）。
>
> 对 meter 的含义：chat 方言下 `input_tokens ÷ 262,144` 的分母恢复诚实，`warn_ctx_pct`（默认 85%）重新可达，主动压缩路径恢复有效；Responses 方言下 85% 预警结构性不可达（触发需 ~89 万字节请求体，远超 41.7 万字节闸），只剩 400 错误路径兜底。「超限时 meter 是否同步读数」（错误路径 return 早于 `record_usage`，读数停在旧值）仍待裁（`docs/backlog.md`）。

#### Scenario: 用量显示

- **WHEN** 完成一轮对话（含 mock provider 给出的 usage 数值）
- **THEN** 控制行读数显示与 usage 字段一致的 ctx% 与会话累计 cache hit%；读数位于模型 chip 与发送钮之间

#### Scenario: 会话累计读数跨回合

- **WHEN** 同一逻辑会话内先后完成多个带 usage 的回合
- **THEN** 控制行 cache 读数 SHALL 等于该会话至今的 `Σcached_tokens ÷ Σinput_tokens`（MUST NOT 只反映
  最近一回合的单回合值）；开启新逻辑会话（「新会话」重置 / 自动压缩）后累计 SHALL 重新起算

#### Scenario: 气泡的行集（用量 + 命中率）

- **WHEN** 完成一轮带 usage 的对话后悬停读数
- **THEN** 气泡只呈现两行含义句：上下文用量行（百分比 + 绝对 tokens 用量）与会话缓存命中率行；
  该回合的单回合命中率、成因说明、缓存写入 tokens 三行 SHALL NOT 出现（M533 行集精简，三者在
  留存里仍可查）；越线时在其后追加警示行

#### Scenario: 气泡呈现绝对 tokens 用量

- **WHEN** 完成一轮对话后悬停读数（usage 读数带绝对值字段：input tokens 与模型窗口——事件与快照同一组键，见下条 scenario）
- **THEN** 气泡的上下文用量行 SHALL 同句呈现上下文已用 tokens、模型窗口上限 tokens 与百分比；
  绝对值缺键（旧后端载荷）时该行回落百分比形态；窗口上限值为零（无上限值）时该行 SHALL NOT 显示
  上限与百分比、走降级文案（MUST NOT 编造读数）。命中率行 SHALL 只呈现百分比，MUST NOT 带 tokens 计数
  （M533 的显式 supersede），其口径 SHALL 与控制行同为会话累计

#### Scenario: usage 事件与状态快照同键同值

- **WHEN** 完成一轮带 usage 的对话（live 路径）
- **THEN** `harness:event` 的 `usage` 事件与 `harness_state` 快照的 `usage` SHALL 携带同一组读数键与
  同一个值（含绝对值键 `input_tokens` / `cached_tokens` / `cached_tokens_session` / `context_window` /
  `has_usage`），两者 SHALL 由同一份 `UsageSnapshot` 的序列化产出；任一侧 MUST NOT 出现对侧没有的
  读数键（判别键 `type` 除外），live 会话与切 vault 回来 / 恢复的读数形态 SHALL 一致

#### Scenario: 单个回合的命中低谷不产生气泡行

- **WHEN** 某一回合 `cached_tokens` 为零（会话首个请求的典型冷启动，或前缀缓存过期），或该回合新增
  tokens 超过已缓存前缀的一半（大块内容摊薄）
- **THEN** 控制行主读数仍显示会话累计值；气泡里 MUST NOT 出现该回合的单回合值，也 MUST NOT 出现
  任何成因说明句（两种情形仍随 `llm_response.usage` 落留存，供事后排查）

#### Scenario: 气泡 tokens 数字走 k / m 单位

- **WHEN** 气泡的上下文用量行呈现 tokens 数字（上下文已用 / 模型窗口上限，含无上限降级行的已用值）
- **THEN** ≥1,000,000 的读数 SHALL 以 `m` 为单位、≥1,000 的读数 SHALL 以 `k` 为单位、不足 1,000 的读数
  SHALL 以原值直出（`0` 呈 `0`、不呈 `0k`）；小数 SHALL 截断到 0.1 档（MUST NOT 四舍五入）且末尾 `.0`
  省略。边界以四条定档：`999` → `999`、`1000` → `1k`、`999999` → `999.9k`（k 档 MUST NOT 出现 `1000k`）、
  `1000000` → `1m`；同一规则 SHALL 同时适用于无上限降级行

#### Scenario: 空会话不假读数

- **WHEN** 会话尚未发出过任何请求（快照 `has_usage=false`，如「新会话」后或恢复了一个空会话）
- **THEN** 控制行读数区 SHALL NOT 渲染（不出现「0% · 0%」）；首次带 usage 的回合完成后读数 SHALL 出现真值

#### Scenario: 恢复后读数接续源会话

- **WHEN** 从历史会话恢复续聊（源会话留存的记录里含带 usage 的回合）
- **THEN** 恢复后控制行与气泡 SHALL 显示源会话最近一次真实读数（留存重算：首行读数种子 + 其后会话轮次
  usage 扫描，压缩调用不计入）；其后的会话累计 SHALL 从源会话的累计接着算（链式恢复从各文件首行的种子
  起算，不断档）；源会话从未发过请求时读数区保持隐藏

#### Scenario: 超阈值警示收敛为悬停气泡

- **WHEN** ctx% 越过警示阈值
- **THEN** 读数高亮；指针悬停读数时浮出说明气泡、移开即收起；越线时气泡在含义句之后追加一行警示说明，
  点明下一轮对话将自动压缩（M533 措辞），且 MUST NOT 复述用量行刚显示过的百分比；界面不出现常驻警示句、
  无 ⓘ 入口

#### Scenario: 自动压缩

- **WHEN** 一轮响应完成后 ctx% 越过警示阈值
- **THEN** 系统自动生成会话摘要并开新逻辑会话；面板出现可见的压缩标记，摘要可展开查看；后续对话在新会话上继续；压缩前历史完整留存在旧 JSONL 文件、摘要随新文件 `session_open` 留存

#### Scenario: 超限兜底

- **WHEN** API 返回上下文超限错误
- **THEN** 系统自动压缩并重试该轮一次；仍失败才向面板报错

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
（`enabled` 缺省 `true`，显式 `false` 才不注册 Web 工具；`approval` 缺省 `allow_all`，可选 `ask`；
关闭不删除 provider、origin deny 或历史）。命名调用的 provider / 模型 / wire 方言 / `api_key` /
`base_url` SHALL 同出一个 provider 条目。

`web_access.enabled` 缺省为 `true`，因此两件 Web 工具默认注册；显式 false 时不注册且不解析 Web
provider。`web_access.approval` 缺省为 `allow_all`，因此默认直接执行；`ask` 才进入批准闸。
设置快照 / patch / revision SHALL 覆盖两键，恢复默认 = 删键；provider 增删 / 切换 MUST NOT 重置它们。
origin deny 仍归 `permissions.deny`，MUST NOT 复制进 `web_access`。

只有 `web_access` 表 / 键缺失才使用上述批准默认值。整表错形状、`enabled` 非布尔、`approval`
非字符串或未知枚举 SHALL 进入局部 Invalid 状态：安全读数为 `enabled=false, approval=ask`，并产生
稳定 `web_access_config_invalid`。Invalid SHALL NOT 注册工具，直接调用也返回该错误且不解析 provider、
零网络请求。该校验 MUST NOT 触发整文件回落，provider、permissions.allow / deny 与其它配置原样保留；
设置修复写不得顺手清空 origin deny。

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

#### Scenario: 网页访问默认启用且配置键受 revision 保护

- **WHEN** `harness.web_access.enabled` 与 `.approval` 缺省，随后用户关闭 Web、改为 Ask、切 provider
  并恢复默认
- **THEN** 缺省为 `enabled=true, approval=allow_all`，两件工具默认注册并直接执行；关闭后不注册，
  Ask 时进批准闸；切 provider 不重置两键；恢复默认删除两键且不复制或清空 `permissions.deny`
  中的 origin 例外

#### Scenario: 显式非法 Web 配置 fail closed 且不清 deny

- **WHEN** 文件已有合法 provider 与 `web_fetch(https://example.com)` deny，随后分别出现
  `web_access: "on"`、`enabled: "yes"`、`approval: true`、`approval: "always"`
- **THEN** 每种都产生 `web_access_config_invalid`，安全读数为 enabled=false / ask，不注册、零网络请求；
  不得变成 enabled=true / allow_all，provider、origin deny 与其它配置保持不变；用显式合法值修复后
  才按新配置恢复

### Requirement: 会话边界

会话 SHALL 绑定 vault：内存态一个 vault 一个活跃会话（`RuntimeInner.sessions` 按 vault 键控；resume 在真正切换时铸新 id 替换槽位，同一份未发布的 pending 恢复复用已铸身份）；盘上按 vault 分目录并存多份历史会话 JSONL 留存，浮层可切换 / 新建 / 恢复（M433）。切 vault SHALL 切到该 vault 的会话，切回时恢复；关闭 vault 丢弃其会话；app 重启清空全部会话。每个逻辑会话 SHALL 有稳定 session id（`s<unix_millis>-<6 位随机>`，落 JSONL 文件名与 `session_open`）；会话建立、「新会话」重置、自动压缩、从历史会话恢复，四者 SHALL 各开一个 JSONL 文件（从历史恢复在首次真实请求时开），旧文件封闭不再追加（压缩前历史完整留存在旧文件，压缩摘要随新文件 `session_open` 留存；恢复新文件以 `opened_from=restore` + `restored_from` 标记源会话）。标题栏 harness 段 SHALL 提供「新会话」动作（面板在场时）：清空当前 vault 会话的消息历史并重新装配系统上下文（AGENTS.md / Skill 索引不变），旧会话 JSONL 文件不受影响。harness 段 SHALL 显示会话名——取**有效标题**（「会话本地留存」条的 last-wins 口径：最后一条带 `title` 的 `session_title` 记录），无标题记录时回落首条用户消息截断（约 20 字），两者皆无时显示「新会话」；生成标题的硬上限（20 码点）与显示截断长度相同，故标题显示不带省略号。会话标题变化 SHALL 即时反映到标题栏会话名与已打开的历史浮层行名，MUST NOT 要求 webview 重载；标题变化 MUST NOT 改变 transcript、session id、历史清单顺序或会话内容。自动压缩与从历史会话恢复开新逻辑会话时，源会话的有效标题 SHALL 随新文件继承（见「会话本地留存」条），使会话名在轮换后保持连续；「新会话」显式开始新对话，MUST NOT 继承。探针期 SHALL 提供**最小恢复入口**：标题栏 harness 段的会话浮层 SHALL 列出本 vault 的历史会话（极简选择器，按最后活动时间倒序、会话名取该会话的有效标题、无标题记录时回落该会话首条用户消息截断约 20 字；仅本 vault，只列不管理），选中一项 SHALL 只读该会话 JSONL、把恢复结果重建到内存（**查看零写盘**：MUST NOT 创建目录 / 临时文件 / JSONL / sidecar，MUST NOT 改动源文件字节与 mtime），首次真实 `llm_request` 才原子发布一份新的恢复文件——恢复 = 读文件最后一条 `llm_request` 的完整请求体，并折叠其后未入请求的末尾响应（算法见 change `reshape-harness-session-recording` 的 design §6.2「恢复算法（重建 Session）」），system 与 input 原样灌回（**不重新装配**系统上下文）、不跨 provider 重写回放项。探针期 SHALL NOT 提供完整多会话管理 UI（会话重命名 / 搜索 / 分组等）与历史回看列表的完整形态；自动命名不属本禁令的「完整多会话管理 UI」——仍无手动重命名入口、无搜索、无分组。会话浮层每行已提供**单条删除**入口（行内两步确认、活跃会话拒删，M406 面板批次落地），它不属上述「完整管理 UI」。

会话清单 SHALL 以一份 JSONL 文件为一行（行身份 = `session_id`）；MUST NOT 折叠、合并、隐藏或去重源文件——恢复 / 压缩产生的多份文件各占一行。每行的最后活动时间 SHALL 是：该文件及其 `session_open.restored_from` 祖先链上 `llm_request` / `llm_response` 记录信封 `ts` 的最大值；链上没有任何轮次时，回落链上最早的首行 `session_open` 信封 ts；都没有时为无值——无值者排在有值者之后、按 session id 倒序，且行时间格不显示读数（MUST NOT 用 id 前缀或其它派生值伪造）。`session_title`（含 `inherit`）、`notice_delivered`、`approval`、`turn_aborted`、`error`、`loop_limit`、`subrun` 等 sidecar MUST NOT 计入活动时间。被拒的发送（没有 `llm_request`）与无人值守 cron（不写交互会话文件）MUST NOT 改变排序。

会话清单的顺序 SHALL 只由后端列举产生：`last_activity_ts` 倒序 → 同值按 session id 倒序 → 无值者最后。前端 MUST NOT 重排、MUST NOT 维护第二份排序口径；行时间格 SHALL 显示最后活动时间（该时间本身取真实信封 ts；链上与文件自身都没有可信 ts 时不显示读数）。标题变化 MUST NOT 改变顺序（沿用既有条款）。

从历史会话恢复 SHALL 只在首次真实 `llm_request` 时开新文件并因此新增一行（查看阶段零新增、清单行数不变）；源文件行 MUST 保留，MUST NOT 被折叠或隐藏。新行的活动时间 SHALL 沿 `restored_from` 链继承：没有自己的轮次时不得越过任何活动更晚的会话；与源行同值时按 session id 倒序相邻。源行与恢复行 SHALL 各自可恢复、可删除（活跃会话拒删不变）；用户 MAY 从源行再次恢复形成分支。

当前活跃会话 SHALL 按同一条排序自然落位，MUST NOT 钉顶、MUST NOT 单独加「当前」标记；待发布恢复（`activated=false`，或 `activated=true` 而尚未发布）SHALL NOT 出现在清单里——清单行身份是一份文件，没有文件就没有行，MUST NOT 为它伪造行或读数；首次真实请求发布文件后，它沿用链上的活动时间落位，行位置 MUST NOT 因恢复动作而越过活动更晚的会话。

会话浮层 SHALL 在每次打开时现拉现建；打开期间 MUST NOT 实时重排、MUST NOT 轮询或订阅活动变化。改名仍 SHALL 原地更新已打开行的行名，MUST NOT 触发重排。

列举 MUST NOT 写 JSONL、MUST NOT 创建文件、MUST NOT 迁移、MUST NOT 改变文件 mtime。同名但无谱系关系的会话 MUST NOT 合并，各占一行，行时间格承担区分。自动压缩文件只标 `opened_from=compact`、没有 `restored_from`，MUST NOT 被当作任何文件的续写链：它按自身活动时间 / 创建时刻独立落位，MUST NOT 继承源文件的活动时间。

查看历史会话 SHALL 与列举同一纪律：MUST NOT 创建目录、临时文件、JSONL 或任何 sidecar，MUST NOT 改动源文件字节与 mtime；查看 MAY 在内存中分配恢复身份（session id / token），但该身份 MUST NOT 产生任何持久化副作用。所点文件就是当前活跃会话的已发布文件时，系统 SHALL 直接返回 `switched=false`（不 fork、不新增文件、不重放 transcript；busy 下也成功）。同一份未发布的 pending 恢复被重复点击时（无论 `activated=false` 还是 `activated=true`），系统 SHALL 复用查看阶段已分配的 session id 与持久化 token，MUST NOT 重新铸 id、MUST NOT 重新读源、MUST NOT 重复重建 transcript 或通知。

查看另一份历史会话（A→B→A）SHALL 只替换内存投影，零新增文件；未发送即退出不留下任何新文件，重启后 MUST NOT 自动复活空恢复文件。待发布恢复（无论是否已激活）MUST NOT 出现在会话清单里：清单行身份是一份文件，没有发布就没有行。

跨 vault、非法 id、不可读或缺 `system` 的损坏源，以及需要真正切换时的 busy，SHALL 在替换当前会话之前失败：当前的会话、pending、token 与目录内容都不变；目录不存在时 MUST NOT 被创建。空源 SHALL 允许查看为空 transcript，零新增；其首次真实请求同样只发布一份恢复文件。查看成功后源被外部删除时，发送 SHALL 使用查看阶段捕获的内存快照，MUST NOT 重读或改用别的历史。

替换 pending 恢复时：若其尚未激活（`activated=false`，从未发生首次真实 `llm_request`），SHALL 直接丢弃、零写盘、不触碰临时文件；若已激活（`activated=true`）且仍未发布，任何丢弃或轮换它的操作（查看另一历史、显式「新会话」及走同一入口的 cron 会话新建 / 恢复回落新建）SHALL 先以完整缓冲批次尝试一次发布，仍失败则拒绝该操作并返回可见错误，保留当前会话、input、writer、缓冲、token 与健康，MUST NOT 静默丢弃已产生的对话。自动压缩走同一发布尝试，但其失败是内部「跳过压缩」结果，不返回用户可见的持久化错误（两个调用点的收尾见「会话本地留存」条）。判据 MUST NOT 用「批次空 / 非空」——`session_open` 恒在，唯一判据是「是否已激活」。

#### Scenario: 切 vault 切会话

- **WHEN** 在 vault A 有进行中的会话，切到 vault B 再切回
- **THEN** B 呈现其自身会话（或空会话），工具与上下文注入均解析到 B；切回 A 时 A 的会话原样恢复

#### Scenario: 新会话重置

- **WHEN** 在一段关于旧话题的对话后点击标题栏 harness 段的「新会话」
- **THEN** 消息历史清空、系统上下文重新装配，随后提问不受旧话题影响；旧会话 JSONL 文件完整保留且不再追加

#### Scenario: 新会话动作的幂等性

- **WHEN** 在任意会话状态（含尚无会话——首条提问未发出）下触发「新会话」，或连续触发多次
- **THEN** 除「pending 恢复已 `activated=true` 且仍有未发布 history、发布仍失败」这一态返回可见的持久化错误（当前会话与健康不变）外，每次调用均成功，结果恒为新空会话；尚无会话时为平凡成功（不报错——「没有会话」正是目标状态）

#### Scenario: 处理中触发新会话

- **WHEN** 一轮对话正在处理中（busy）时触发「新会话」
- **THEN** 返回「对话正在处理中」错误信封，在途会话不丢失、不产生副作用；待本轮结束或停止后可再次触发

#### Scenario: 压缩开新文件

- **WHEN** 自动压缩触发、开新逻辑会话
- **THEN** 新逻辑会话落新 session id 的新 JSONL 文件，其 `session_open` 携带压缩摘要；压缩前历史在旧 JSONL 文件中完整留存且不再追加

#### Scenario: 历史会话列举

- **WHEN** 打开标题栏 harness 段的会话浮层
- **THEN** 列出本 vault 的历史会话（极简选择器，按最后活动时间倒序、会话名取该会话的有效标题、无标题记录时回落该会话首条用户消息截断约 20 字），不列其他 vault 的会话；「新建会话」动作是 harness 段段首的 ＋ 钮、不在浮层内（浮层只剩历史行，M406 起；空清单时浮层整层不开）

#### Scenario: 从历史会话恢复续聊

- **WHEN** 在会话浮层选择一个历史会话
- **THEN** 该会话的 system 与 input（最后一条 `llm_request` 的完整请求体，并折叠其后未入请求的末尾响应，算法见 change `reshape-harness-session-recording` 的 design §6.2「恢复算法（重建 Session）」）原样灌回内存态、不重新装配系统上下文；查看阶段零新增文件、源文件字节与 mtime 不变，清单行数与顺序不变；首次真实发送才发布一份新 JSONL 文件（首行 `session_open` 标 `opened_from=restore`、`restored_from`=源会话 id），旧文件封闭；源会话有有效标题时新文件的初始批次随之继承，会话名保持连续；其后提问按恢复的历史续写；读数随留存重算灌回新会话（控制行显示源会话最近一次真实读数），并以读数种子（`usage` + `cache_totals`）落进新文件首行，供链式恢复起算；清单新增一行（新文件），源会话行仍保留；新行按链上活动时间落位、不越过活动更晚的会话，并与源行同值时按 session id 倒序相邻

#### Scenario: 标题优先于首条消息

- **WHEN** 某会话已有有效标题，另一会话没有标题记录但已有首条用户消息
- **THEN** 前者在标题栏与历史浮层中显示标题（不带省略号）；后者显示首条用户消息截断约 20 字；两者均无时显示「新会话」

#### Scenario: 标题更新不重排历史

- **WHEN** 会话空闲时一次 rename 生效，历史浮层正打开
- **THEN** 标题栏会话名与该行行名原地更新，浮层不重开、不跳位置、清单顺序不变；transcript 不变

#### Scenario: 按最后活动排序

- **WHEN** 本 vault 有两份历史会话，A 创建更早但最后活动更晚，B 创建更晚但最后活动更早
- **THEN** 浮层把 A 排在 B 前；顺序按最后活动时间，不按文件创建时刻

#### Scenario: sidecar 不计入活动时间

- **WHEN** 一份会话只追加了 `session_title` / `notice_delivered` / `approval` 等 sidecar，没有新的 `llm_request` / `llm_response`
- **THEN** 它的最后活动时间不变、清单位置不变；改名仍只改行名

#### Scenario: 恢复新增一行且不置顶

- **WHEN** 查看一份最后活动早于其它会话的历史会话，并在其恢复上下文里发出首次真实请求
- **THEN** 发布时才新增一行（恢复文件），查看阶段与发送前清单行数不变；源会话行仍保留；新行按链上活动时间落位，不越过活动更晚的会话，并与源行同值时按 session id 倒序相邻

#### Scenario: 源行与恢复行独立操作

- **WHEN** 源会话与恢复文件同时存在于清单
- **THEN** 两行各自可恢复、可删除；从源行再次恢复并真实发送会新增一个分支行（仅查看不新增）；删除其中一行只影响该文件，不联动隐藏或删除其它行

#### Scenario: 缺时间安静回落

- **WHEN** 列举一份 `llm_request` / `llm_response` / `session_open` 信封全部缺 ts 的旧会话文件
- **THEN** 它排在有时间值的会话之后、按 session id 兜底；行时间格不显示读数；不告警、不改写文件

#### Scenario: 同名但无谱系关系各占一行

- **WHEN** 两份无谱系关系的会话拥有相同的有效标题或回落名
- **THEN** 两行都出现、不合并，按最后活动时间排序；行时间格可区分

#### Scenario: 当前会话自然排序

- **WHEN** 当前活跃会话不是最近活动的那一条
- **THEN** 它在清单中按最后活动时间落位，不被钉顶、不显示「当前」标记；清单顺序与打开浮层的动作无关

#### Scenario: 打开期间不重排

- **WHEN** 浮层打开期间后台完成一轮对话或产生新的会话活动
- **THEN** 已打开的行不移动、不重排；关闭后重开才按新读数排序

#### Scenario: 列举只读

- **WHEN** 打开会话浮层并列出一份历史会话
- **THEN** 该 JSONL 的字节与 mtime 不变，目录不新增文件

#### Scenario: 被拒的发送不改变排序

- **WHEN** 一次发送被 `harness_busy` / 缺 provider / 图片能力闸拒绝
- **THEN** 没有 `llm_request` 落盘，该会话的最后活动时间与清单位置不变；若这是 pending 恢复的首次发送，MUST NOT 发布恢复文件（零新增）

#### Scenario: compact 文件不沿链继承

- **WHEN** 自动压缩开出一份 `opened_from=compact` 的新文件，源文件仍在
- **THEN** 两份文件各占一行；compact 文件没有 `restored_from`，不继承源文件的活动时间；同名或压缩模板名不合并

#### Scenario: 纯环谱系不挂起

- **WHEN** 两个文件的 `restored_from` 互相指向
- **THEN** 列举正常返回，两份文件各一行（精确 session id 集），链遍历终止；不丢行、不重复

#### Scenario: 查看历史零写盘

- **WHEN** 查看一份带有效标题、且带未消费通知的历史会话
- **THEN** 会话目录的 `.jsonl` 文件数不变、无临时文件；源文件 sha256 与 mtime 不变；transcript 与通知照常重建

#### Scenario: 重复查看复用同一身份

- **WHEN** 连续点击同一历史项三次，期间未发送
- **THEN** 首次返回 `switched=true`，其后每次 `switched=false`；session id 与持久化 token 不变；transcript 与通知各只重建一份；目录零新增

#### Scenario: A 与 B 来回查看零新增

- **WHEN** 依次查看历史会话 A、B、A，期间未发送
- **THEN** 三次都零新增文件；每次 transcript 内容属于所选源；退出并重启后目录仍零新增

#### Scenario: 当前项直切

- **WHEN** 当前活跃会话的已发布文件正是所点行
- **THEN** 返回 `switched=false`；不 fork、不新增、不重放 transcript、不改持久化 token

#### Scenario: busy 下只允许当前项直切

- **WHEN** 一轮对话处理中（busy），分别点击当前会话行与另一历史会话行
- **THEN** 前者返回 `switched=false` 且零副作用；后者返回 `harness_busy`，当前会话、文件与 pending 都不动

#### Scenario: 未发布的 pending 恢复不占清单行

- **WHEN** 查看一份历史会话但尚未发送
- **THEN** 清单行数与顺序不变，不出现指向未发布文件的伪行；重复打开浮层仍只列既有文件

#### Scenario: 空源查看零新增

- **WHEN** 查看一份没有任何会话轮次的历史会话
- **THEN** 面板为空、零新增文件；发出首次真实消息后才恰好多出一份恢复文件

#### Scenario: 首次真实发送唯一文件

- **WHEN** 查看一份有标题、有未消费通知的历史会话并发出首条真实消息
- **THEN** 目录 `.jsonl` 文件数恰好 +1；新文件 `opened_from=restore`、`restored_from`=所选源 id；`inherit` 与 `notice_delivered` 各恰好一条且在首条 `llm_request` 之前；源文件字节与 mtime 不变；清单此时新增一行

#### Scenario: 查看后退出不复活

- **WHEN** 查看 A 再查看 B，未发送即退出并重启
- **THEN** 重启后目录文件数与退出前相同，MUST NOT 出现空恢复文件或自动复活的清单行

#### Scenario: 查看失败零副作用

- **WHEN** 查看跨 vault / 非法 id / 缺 `system` 的损坏源，或 busy 下查看另一历史会话
- **THEN** 返回明确错误；当前会话、pending、token、目录文件数都不变；不创建目录或临时文件

#### Scenario: 未发布批次阻止静默丢弃

- **WHEN** 一份恢复已激活（发生过首次真实 `llm_request`）且因发布失败仍未发布（该轮已结束），用户点击另一历史会话
- **THEN** 系统先尝试一次发布；仍失败则拒绝切换，旧会话、input、writer、缓冲、token 与健康不变，返回可见的持久化错误；MUST NOT 丢弃缓冲记录

#### Scenario: 纯查看 A 与 B 来回零发布

- **WHEN** 查看一份带有效标题、且带未消费通知的历史会话 A，再查看另一份同样带标题 / 通知的 B，期间从未发送
- **THEN** 两次查看都零新增、无临时文件；MUST NOT 因 A 的 view 元数据非空而尝试发布 A；每次 transcript 属于所选源

#### Scenario: 未发布批次阻止显式新会话

- **WHEN** 一份恢复已激活且发布失败，用户点击「新会话」
- **THEN** 系统先尝试一次发布；仍失败则返回可见的持久化错误，当前会话、transcript、缓冲与健康不变；MUST NOT 重置会话、MUST NOT 清缺口 / `history_written`

#### Scenario: 阈值触发的压缩被跳过

- **WHEN** 一份恢复已激活且发布失败，一轮回答完成时达到自动压缩阈值，压缩请求 / 响应已产生
- **THEN** 轮换前先以完整批次尝试发布；仍失败则跳过轮换：不创建 compact 文件、不替换 input / system / writer、不采用摘要；本轮回答照常完成、对话继续；既有 persistence 告警可见，MUST NOT 产生新的持久化错误

#### Scenario: context overflow 的压缩被跳过

- **WHEN** 一份恢复已激活且发布失败，provider 返回 context overflow，压缩请求 / 响应已产生
- **THEN** 轮换前先尝试发布；仍失败则 MUST NOT 在未压缩上下文上重试，MUST NOT 新增持久化错误，按本轮既有 overflow 错误落回终态；原 pending、未压缩 input 与完整批次保留

### Requirement: 会话本地留存

会话 SHALL 以 wire/input 形态落配置目录（MUST NOT 写入 vault），作为 ADR 0007 双向记录机制的一侧：每会话一个 append-only JSONL 文件（`<config_dir>/harness/sessions/<vault 稳定 id>/<session_id>.jsonl`），文件首行 SHALL 为 `session_open` 记录——含 session id、vault 根路径、provider / 模型 / 思考档位 / **wire 方言（`wire_api`，缺省值同样在场）**、**完整装配后 system prompt 全文**与装配清单（每个来源的路径、存在与否、字节数；不存在的来源 SHALL 同样在场）、**读数种子**（M526：恢复 / 压缩开文件时在场——`usage` 读数快照 + `cache_totals` 累计四元组；链式恢复从这里起算，全新会话不落这两键）。`<vault 稳定 id>` SHALL 是 vault 注册表 id（与 `vault-sessions/<id>.json`、`reading-positions/<id>.json` 同一份身份），MUST NOT 用 vault 路径派生的消毒名（消毒名有撞名面且无长度 / 字符集保证，M309 现场）。每次发给模型的**会话请求**（含工具循环的每次迭代与压缩调用）SHALL 落一条 `llm_request` 记录（完整请求体：system + messages + 参数，**另带本次实际发送体的字节数 `request_bytes`**——按 wire 展开后的尺寸算，省掉「按字节比外推请求多大」；不具备真实 HTTP body 的 mock 档省略该键），**另带本次暴露给模型的工具名清单 `tool_names`**（按请求中工具定义的顺序、只记名字，MUST NOT 记录工具 schema / 描述 / 参数——`task` 的描述里含用户写的定义描述，属用户内容；该键恒在场，无工具的请求记空数组 `[]`——`[]` 表示「这一请求不带任何工具」，与「没有记录」区分；本 change 之前的文件缺该键，读取方 MUST NOT 把它当作空数组），每次响应 SHALL 落一条 `llm_response` 记录（正文 / 思考归一回放项与展示文本 / 工具调用 / usage（SHALL 含 input / cached / output 与**缓存写入 `cache_write_tokens`**——provider 不提供时按 0 记录）/ 错误；思考 MUST 落盘——**回放项归一回放形状**（`{"type":"reasoning", summary, [content], [encrypted_content]}`：kimi 的明文载体是 `summary`、deepseek 的是 `content`，各按在场项保留；`encrypted_content` 有则在场），`id` 字段 MUST NOT 进入回放项（`store:false` 下重放 `rs_*` id 属非标用法），展示文本另存）；请求侧在 **Responses 方言**且模型声明支持思考档位时（判据 `HarnessConfig::effort_supported`，读配置 schema 的 per-model `effort` 声明）SHALL 带 `include:["reasoning.encrypted_content"]`（store:false 官方回放模式的前提——让服务端在 reasoning item 里回传密文，重放时无需 id 即可还原）；未声明 effort 的模型（含 deepseek 现役形态）MUST NOT 发该字段；**Chat Completions 方言 MUST NOT 发 `include` / `store`**，其 wire 形态与思考回放字段见「Chat Completions 方言」条；wire 不可推导的决策与事件（批准 / 拒绝、停止中断、LLM 错误、循环上限）SHALL 以 sidecar 记录留存——其中 **LLM 错误的 sidecar 记录 SHALL 另带 HTTP 面诊断**（非 2xx 时的 HTTP 状态码、原始响应 body——按固定上限截断防巨型 body 撑爆留存、服务端 request id 若响应头或 body 提供；不具备 HTTP 面的错误省略这些键），且**错误事件的既有形态（`type`/`code`/`message`）不变**（新诊断只进留存，不破坏既有消费方），被 wire 覆盖或失去意义的 11 类事件 kind（`user_message` / `assistant_text` / `tool_call` / `tool_result` / `usage` / `tool_denied` / `compact` / `session_reset` / `approval_overwritten` / `approval_withdrawn` / `turn_abort_requested`）SHALL NOT 再记（重复记录即第二事实源）。记录点 SHALL 与发送点同点，MUST NOT 经二次序列化产生第二事实源。验收口径 SHALL 为恢复充分性：仅凭 JSONL 能逐字节重建任意一轮发给模型的请求——wire 体由留存 + 代码版本 + `wire_api` 方言共同推导，`session_open` 的方言键是推导依据之一；重建 MUST 忽略全部 sidecar 记录（含 `session_title`），旧文件缺失标题记录不改变重建结果。

从历史会话恢复的查看阶段 SHALL 零写盘：MUST NOT 创建会话目录（查看路径 MUST NOT 调用会 `create_dir_all` 的写路径）、MUST NOT 创建临时文件、MUST NOT 写 `session_open` / `inherit` / `notice_delivered` 或任何 sidecar；源文件 MUST NOT 被改写，其字节与 mtime MUST NOT 变化。

恢复文件的**初始激活批次** SHALL 由首次真实 `llm_request` 触发发布。查看阶段 MUST NOT 构造批次——`session_open` / `inherit` / `notice_delivered` 在查看时只是内存中的 view 元数据，未序列化、不可发布。记录顺序固定为：`session_open` → `inherit?`（源会话有有效标题时）→ `notice_delivered*`（按查看时重建的通知次序）→ 首条 `llm_request`。批次内每条记录恰好一次。发布 SHALL 是原子的：先把整个初始批次写入**与最终文件同目录**的临时文件（文件名 MUST NOT 以 `.jsonl` 结尾，MUST NOT 被会话列举识别），完整写入并关闭后，以不覆盖既有文件的方式原子发布最终 `sessions/<vault 稳定 id>/<session_id>.jsonl`；最终路径已存在时 MUST NOT 覆盖、MUST NOT 静默换 id，SHALL 按写失败处理。发布成功是唯一的提交点：此后该文件恢复普通 append-only 行为，临时名清理失败只留不可列举残留，MUST NOT 回滚最终文件或再次发布。发布 MUST NOT 创建会话目录；目录不存在按发布失败处理。

发布失败时（权限 / 磁盘 / 撞名 / 目录缺失），**本次发布 MUST NOT 创建最终文件**：目标此前不存在则失败后仍不存在；因撞名失败时既有目标 MUST 逐字节保留、不覆盖、不改 id；MUST NOT 留下空文件或半截的本次最终文件。已激活但未发布的初始批次 SHALL 完整保留在内存中，后续记录继续加入该批次，重试 SHALL 使用**同一个 session id、同一个持久化 token、同一份缓冲批次**，每次写动作至多尝试一次发布。发布成功后缓冲的每条记录在文件里恰好出现一次，触发发布的那条记录 MUST NOT 再经 append 写一次。发布成功前进程退出，则这段对话随内存消失，MUST NOT 在重启后留下或复活该恢复文件。

自动压缩 SHALL 走同一未发布批次守卫，但结果是内部「跳过压缩」，不是用户可见的持久化错误：

- **阈值触发**（一轮完成后的自动压缩）：发布失败 ⇒ MUST NOT 轮换、MUST NOT 采用摘要；保留未压缩 input / system / writer 与完整批次，本轮回答照常完成；既有 persistence 健康告警（degraded + 退出风险句）即用户可见反馈，MUST NOT 静默、MUST NOT 把本轮判失败。
- **context overflow 恢复**：发布失败 ⇒ MUST NOT 在未压缩上下文上重试（该轮 overflow 重试机会已消费，重试必然再次 overflow），MUST NOT 新增持久化用户错误，SHALL 落回既有 overflow 终态（沿用本轮 provider 的 overflow 错误事件 / 终态），同时保留原 pending、未压缩 input 与完整批次。

两种情形都 MUST NOT 创建 compact 文件、MUST NOT 替换 input / system / writer、MUST NOT 采用摘要；压缩请求 / 响应记录仍留在原批次。显式「新会话」在同一态下先尝试发布，失败则拒绝并保留会话与健康（见「会话边界」条）。

恢复文件的 `opened_from` 恒为 `restore`、`restored_from` 恒为所选源 id；即使源文件本身是 `opened_from=compact`，新文件也 MUST NOT 继承 compact 身份。`restored_from` 指向的源文件在查看后被外部删除时，发送 SHALL 使用查看阶段捕获的内存快照，MUST NOT 重读源文件或改用别的历史；悬空父 id 沿用既有列举算法。

会话文件的 vault 归属 SHALL 仍以首行 `session_open.vault_root` 为**唯一**判据：列举、恢复、删除三处的归属过滤口径不变，目录只作组织维度，MUST NOT 成为归属判据的第二真源（文件被手工挪动 / 拷贝不改变其归属结论）。目录名 SHALL NOT 与保留目录名 `_orphaned` 相同。`sessions/<vault 稳定 id>/<session_id>.jsonl` SHALL 是**唯一布局**：新建会话 SHALL 只落其 vault 的目录，列举 / 恢复 / 删除 SHALL 只读该目录；产品运行时 MUST NOT 含任何迁移逻辑（无启动迁移入口、无旧布局读取路径），也 MUST NOT 读平铺在 `sessions/` 根下的 `*.jsonl`——MUST NOT 保留平铺布局的双读 / 双写过渡层（本仓无外部消费者，兼容层保护对象的举证责任在建层一方；REVIEW.md「消费者是谁」）。存量平铺文件（升级前遗留）的归位 SHALL 由**仓内一次性脚本**（`scripts/` 下，手动执行一次即弃，不进产品运行时）完成：脚本按各文件首行 `session_open.vault_root`（先规范化再查注册表）移入对应 vault 目录，`vault_root` 不可解析 / 在注册表里找不到 / 目标位置已有同名文件的 SHALL 移入保留目录 `sessions/_orphaned/`，MUST NOT 删除或改写任何文件，且 MUST be 幂等（重复执行零搬运）；脚本遇单文件失败时留原地并自报，重跑脚本收敛。上一代「按 vault 聚合的业务事件流水」形态（`<config_dir>/harness/<消毒名>.jsonl`）照旧不再续写、不做迁移（运行时 / 产品侧零读者，验收套件的 JSONL 断言随实现迁移至 wire 口径；M309 孤儿先例）。写失败不阻断对话的既有纪律不变；写失败的结果 SHALL 反映在「留存健康状态」条定义的**当前写健康与历史缺口**两个维度上，MUST NOT 只留在 stderr 与诊断日志里。

会话标题 SHALL 以 sidecar 记录 `session_title` 追加留存：`{"kind":"session_title","title":"…","decision":"initial|rename|keep|inherit|error","reason":"first-turn|cadence|drift|inherit","model":"…","ts":…}`。每次命名评估结束（含 keep 与失败）SHALL 追加一条——`initial` / `rename` 记录携带新标题，`keep` 记录携带当时生效的标题，`error` 记录不带 `title` 并带错误码 `code`（`harness_title_failed` / `harness_title_invalid`）；`inherit` 记录不是评估产物，在建新文件时写入（恢复文件的这一条属初始激活批次，见下段）。`model` SHALL 记录本次调用实际使用的模型 id（`inherit` 记录不带该键——它没有发起调用，`reason=inherit`）。**有效标题** SHALL 是文件内最后一条带 `title` 的 `session_title` 记录的 `title`；没有该记录时回落首条用户消息（见「会话边界」条）。有效标题的解析 MUST 只有一处实现，列举 / 恢复 / 快照 / 事件四条出口 MUST NOT 各写一份 last-wins 逻辑。标题记录 SHALL 只在会话空闲（无在途轮次）时追加，MUST NOT 插在一条 `llm_request` 与它配对的 `llm_response` 之间——恢复的「折叠末尾未入请求的响应」判据依赖这对记录的相邻性。

自动压缩与从历史会话恢复开新文件时，源会话的有效标题 SHALL 以一条 `decision=inherit` 的 `session_title` 记录写入新文件（源会话无标题记录时不写，回落口径自然成立）；恢复的这条记录属初始激活批次，查看阶段 MUST NOT 写入。「新会话」显式开始新对话，MUST NOT 继承。本 change 之前的会话文件不含 `session_title` 记录：列举、恢复、展示 SHALL 安静回落到首条用户消息口径，MUST NOT 告警、MUST NOT 回填或改写既有文件。

自动命名调用是 **wire 外的辅助调用**：它 MUST NOT 落 `llm_request` / `llm_response`（它不属会话历史——落进去会使「最后一条会话 `llm_request`」判据指错请求、并打破请求 / 响应的配对口径），其 usage MUST NOT 进入会话读数（`UsageSnapshot` / `cache_totals` / ctx% / cache%）。`session_title` 记录是 wire 外的 sidecar，恢复充分性判据 MUST NOT 因它的在场或缺失而变化。

#### Scenario: 留存落盘

- **WHEN** 完成一轮含工具调用的对话
- **THEN** 配置目录下 `sessions/<vault 稳定 id>/<session_id>.jsonl` 追加完整 wire 记录（`session_open` / 成对的 `llm_request` / `llm_response` / sidecar 决策记录），vault 目录无任何新增或修改，`sessions/` 根下不新建任何文件

#### Scenario: 按 vault 分置与列举范围

- **WHEN** vault A 与 vault B 各有历史会话，随后在 vault A 打开 harness 段的会话浮层
- **THEN** 两边的会话文件各自落在 `sessions/<A 的 vault 稳定 id>/` 与 `sessions/<B 的 vault 稳定 id>/` 下；浮层只列 A 目录里的会话，且仍按 `session_open.vault_root` 过滤（目录内容不构成归属判据）

#### Scenario: 平铺文件一次性归位

- **WHEN** 在仓内手动执行一次性迁移脚本，`sessions/` 根下存在平铺的 `<session_id>.jsonl`（首行 `session_open` 带 `vault_root`）
- **THEN** 每个文件被移入其 vault 的目录（逐字节不变，只换位置），脚本跑完后根下不再有 `*.jsonl`；再跑一次脚本不产生任何搬运（幂等）

#### Scenario: 不可归属者进孤儿桶

- **WHEN** 一次性迁移脚本遇到平铺文件不可读 / 首行不是 `session_open` / 其 `vault_root` 在注册表里找不到 / 目标位置已有同名文件
- **THEN** 该文件被移入保留目录 `sessions/_orphaned/`，不删除、不改写；它不出现在任何 vault 的会话列举里，也不被任何恢复入口读到

#### Scenario: 旧文件孤儿化

- **WHEN** 本 change 落地后进行首次对话
- **THEN** 上一代「按 vault 聚合的业务事件流水」文件（`<config_dir>/harness/<消毒名>.jsonl`）不被续写、不被改写、不做迁移（M309 孤儿先例不变）

#### Scenario: 废弃 kind 不再记

- **WHEN** 完成一轮含工具调用与用量的对话
- **THEN** JSONL 中不出现 `user_message` / `assistant_text` / `tool_call` / `tool_result` / `usage` 等 11 类废弃 kind；同样的信息仅由 `llm_request` / `llm_response` 承载

#### Scenario: 装配记录落盘

- **WHEN** 发起新会话（或「新会话」重置、自动压缩开新逻辑会话）
- **THEN** 新 JSONL 文件首行为 `session_open`：system prompt 全文逐字节在场；装配清单含每个来源的路径与存在与否（user-wide AGENTS.md 不存在时 `exists:false` 同样记录）；provider / 模型 / 思考档位 / wire 方言在场

#### Scenario: 恢复充分性（属性级）

- **WHEN** mock provider 跑完一轮含工具循环的对话（消息含 `<quote>` 块、响应含思考文本），期间会话已产生 `session_title` 记录
- **THEN** 仅凭 JSONL 独立重建的每个请求与落盘 `llm_request` 深度相等（逐字节重建判据，重建忽略 `session_title` 等全部 sidecar 记录）；第 i 条响应的正文 / 思考 / 工具调用与第 i+1 条请求的历史对应项逐字节一致

#### Scenario: 思考落盘与回放

- **WHEN** 一轮响应含 reasoning 文本，其后一轮把上一轮响应的 reasoning 项带回历史
- **THEN** `llm_response` 记录思考——回放项（**归一形状**：剥掉 `id`、`MUST NOT` 含 `id`；保 `summary` / `content` / `encrypted_content`）与展示文本（给人看）分别在 `reasoning` / `thinking` 字段；后续请求的历史中该归一后的 reasoning 回放项逐字节在场，且 Responses 方言请求体在模型声明支持思考档位时带 `include:["reasoning.encrypted_content"]`（chat 方言不带该字段，其回放形态见「Chat Completions 方言」条）；恢复旧会话（记录早于本改动、reasoning 项仍带 `rs_*` id）时，重建的 input 同样不含 `id`

#### Scenario: 缓存写入随 usage 落盘

- **WHEN** provider 的响应 usage 带回 `cache_write_tokens`，完成一轮对话
- **THEN** 对应 `llm_response` 记录的 `usage` 块含 `cache_write_tokens` 原值；provider 不提供该字段时记为 0

#### Scenario: 标题记录落盘与读取

- **WHEN** 一次评估以 rename 结束，其后另一次评估以 keep 结束
- **THEN** 文件追加两条 `session_title` 记录（各带 `decision` / `reason` / `model` / `ts`）；有效标题取最后一条带 `title` 的记录，与 rename 结果一致；keep 记录携带同一标题，不改变展示名

#### Scenario: 标题调用不入 wire 留存

- **WHEN** 完成若干轮对话并伴随一次成功的命名调用
- **THEN** 文件内没有属于命名调用的 `llm_request` / `llm_response`（不存在 system 为命名指令的请求记录）；`llm_request` 与 `llm_response` 仍成对相邻，末尾响应的折叠判据不受影响

#### Scenario: 压缩与恢复继承标题

- **WHEN** 已有有效标题的会话触发自动压缩，或从历史会话恢复续聊
- **THEN** 压缩的新 JSONL 文件在 `session_open` 之后追加一条 `decision=inherit` 的 `session_title` 记录；恢复文件则在首次发布的初始批次里、紧跟 `session_open` 写入同一条记录（查看阶段零写盘、不写 inherit）；标题栏与历史浮层继续显示该标题；源会话无标题记录时不写 inherit，展示回落首条用户消息口径

#### Scenario: 旧文件安静回落

- **WHEN** 列举、恢复或展示本 change 之前落盘的会话文件（无 `session_title` 记录）
- **THEN** 会话名回落该会话首条用户消息截断约 20 字；不产生 warning、不写任何回填记录、文件逐字节不变；恢复后的请求重建结果与不含标题记录时一致

#### Scenario: 请求暴露面可核对

- **WHEN** 同一个 vault 里先以 `[harness.subagents].enabled = true` 发出一条请求，再以 `enabled = false` 开新会话发出一条请求，期间还发生过一次子运行
- **THEN** 前者对应 `llm_request.tool_names` 按请求顺序列出工具名、含 `task`；后者不含 `task`；两次都是数组且只有名字（无 schema / 描述）；该子运行的审计流水里同字段只含其定义声明的白名单、`task` 恒缺席

#### Scenario: 旧文件缺键不判空

- **WHEN** 读取一份本 change 之前落盘的会话文件（`llm_request` 无 `tool_names` 键）
- **THEN** 该缺失被当作「没有记录」，MUST NOT 被当作空数组；恢复、读数重算与请求重建都不受影响，文件也不因读取而被改写

#### Scenario: 查看恢复不写任何记录

- **WHEN** 查看一份带有效标题、带未消费通知的历史会话
- **THEN** 目录内 `.jsonl` 文件集合不变、无 `.jsonl.tmp` 残留；每个既有文件的 sha256 与 mtime 不变；恢复结果只存在于内存

#### Scenario: 初始批次顺序

- **WHEN** 恢复一份有有效标题、有未消费通知的历史会话，并发出首条真实消息（mock provider）
- **THEN** 新文件记录序为 `session_open` → `session_title`（`decision=inherit`）→ `notice_delivered`（按重建次序）→ `llm_request`；每条恰好一次；`llm_request` 的请求体含恢复历史与本条用户消息

#### Scenario: 发布是原子的

- **WHEN** 首次发布进行中与完成后分别列举会话目录
- **THEN** 最终 `.jsonl` 从不以空文件或半截文件出现在清单里——它要么不可见，要么可完整解析且首行是 `session_open`；临时名从不被列举识别

#### Scenario: 发布失败不留最终文件

- **WHEN** 会话目录为可读不可写（真实 OS 权限），恢复会话后发出首条真实消息
- **THEN** 对话照常完成、消息照常上屏；本次不创建最终 `.jsonl`、无空 / 半截 `.jsonl`，目录里既有文件的字节与 mtime 不变；`state=degraded`、`severity=history`、`history_written=false`、`history_gap=false`；警示块含「对话暂未保存」与「现在退出，这段对话将无法恢复」

#### Scenario: 同身份重试不双写

- **WHEN** 上一场景后恢复目录写权限，用户再发一条消息
- **THEN** 同一 session id 发布恰好一份文件；缓冲的 `session_open` / `inherit` / `notice_delivered` / 首条 `llm_request` 与首条 `llm_response`、首条失败 sidecar（若有）与新消息各恰好一次；`history_written` 转 true、`history_gap` 仍 false；不出现第二份恢复文件

#### Scenario: 显式重试后的批次精确计数

- **WHEN** pending 恢复的首次发布因权限失败；首条真实请求已发出且 provider 返回错误；用户恢复权限并点显式重试，重试成功且发布成功
- **THEN** 恰好一份恢复文件；kind 计数为 `session_open` 1、`inherit` ≤1、`notice_delivered` 按重建条数、`llm_request` 2、`llm_response` 2、失败 sidecar 1；面板与 input 里用户消息各 1 条（两条请求的历史中都含该消息）；两条请求与两条响应各自对应；同一 session id；MUST NOT 出现第三条请求、重复记录或第二份文件

#### Scenario: 目标撞名不覆盖

- **WHEN** 首次发布前，目标 `<session_id>.jsonl` 已被外部创建
- **THEN** 不覆盖该文件、不改用别的 id；按发布失败处理（健康与告警同上）；原文件字节不变

#### Scenario: 未发布即退出

- **WHEN** 发布始终失败，用户在未发布状态下退出并重启
- **THEN** 重启后不出现该恢复文件，这段对话随内存消失；源文件不变，MUST NOT 自动复活空恢复文件

#### Scenario: 双击发送只受理一轮

- **WHEN** pending 恢复的首次发送被快速双击 / 重复触发
- **THEN** 只受理一轮；恰好一份恢复文件、一条用户消息、一条首个 `llm_request`；第二击得到 busy 或等价拒绝，零新增

#### Scenario: provider 前置拒绝不激活

- **WHEN** pending 恢复的首次发送被缺 provider / 图片能力闸拒绝
- **THEN** 零新文件、零临时文件；错误可见；未发布状态保留，修好后首次成功的真实请求才发布

#### Scenario: provider 请求后失败（首次发布已成功）

- **WHEN** 恢复文件已发布成功，首条真实请求发出后 provider 返回错误
- **THEN** 该 `llm_request`、失败的 `llm_response` 与失败 sidecar 追加到同一文件；显式重试追加同一文件，不新增文件

#### Scenario: provider 请求后失败（首次发布未成功）

- **WHEN** 首次发布因权限失败，首条真实请求仍发出且 provider 返回错误
- **THEN** 该 `llm_request`、失败的 `llm_response` 与失败 sidecar 进入同一内存批次；最终文件仍不存在（本次未创建，无空 / 半截）；后续写动作或显式重试按 D1 同身份发布；MUST NOT 声称该失败轮次无记录或已丢失

### Requirement: mock provider

`provider = "mock"` 时 SHALL 从配置指向的 fixture 文件读取脚本化响应（含工具调用序列与 usage 数值），确定性驱动工具循环——真机验收 MUST NOT 依赖真实外部 API。

#### Scenario: 确定性验收

- **WHEN** 验收场景以 mock provider 配置启动 app 并发送提问
- **THEN** 工具循环严格按 fixture 脚本推进，断言可复现

### Requirement: 摘录引用卡片

系统 SHALL 提供摘录创建手势：在编辑器 pane 中选中片段后出现浮动「摘录到对话」钮，点击把该片段作为引用附件按「CM 对话输入区与区外附件」的落位规则加入对话输入区；harness 面板未打开时 SHALL 先打开面板再入卡片。**钮的出现时机 SHALL 是「选区完成后」**：鼠标拖拽选区在松开（mouseup）前 MUST NOT 出现，键盘建立的选区在选区稳定（停止变化约 350ms）后才出现，选区清空或移出编辑器即消失。**落点 SHALL 就近取选区末端（光标侧）附近**，且钮整体 MUST 钳制在触发面板可视区内（M531 不变量）。每张卡片 SHALL 呈现：引号竖条、摘录原文截断（至多两行）、出处行（文档名 · 最近一级标题；摘录在文档首个标题之前时仅显示文档名）、（输入区内）移除钮；hover SHALL 显示完整摘录与完整标题链。卡片数据 SHALL 携带：vault 相对路径 file、最近一级标题 heading、行范围 lines（从选区捕获，MUST 非空，取不到行范围时 MUST NOT 生成卡片）、摘录原文。点击卡片 SHALL 跳回原文位置并瞬态高亮，MUST NOT 删除问题文字或改变卡片数量。编辑器侧 SHALL NOT 出现任何常驻的摘录相关装饰——只存在两种瞬态：存在的选区（含浮动钮）、跳回高亮。摘录来源 SHALL 为「最近活跃编辑器 pane」的选区（ADR 0008 Decision 3 语义），harness 面板持焦 MUST NOT 改变该归属。

#### Scenario: 选区创建卡片

- **WHEN** 在编辑器 pane 中选中一段文字并点击浮动「摘录到对话」钮
- **THEN** 对话输入区出现一张引用卡片（竖条 + 至多两行摘录 + 出处行），落在 caret 处（caret 在行中则拆行）；卡片数据含该文件的相对路径、最近一级标题、选区行范围与摘录原文；编辑器侧无任何常驻装饰残留

#### Scenario: 点击卡片跳回高亮

- **WHEN** 点击输入区或已发送消息中的引用卡片
- **THEN** 对应编辑器 pane 定位到摘录原文位置并瞬态高亮（约 1.4s 消退）；输入区的问题文字与卡片数量不变

### Requirement: 摘录失锚降级

点击卡片跳回时 SHALL 按三层降级定位：① 按 lines 行号定位，并校验命中文本与摘录原文匹配（前缀匹配即可）；② 失配则在文档内搜索摘录原文字符串，命中即定位到命中处；③ 仍找不到则告知用户该摘录已失锚（toast），MUST NOT 静默跳到其他位置。目标文档未打开时 SHALL 先打开该文档再走降级链；文档已不存在 SHALL 直接进入第三层。

#### Scenario: 行号命中

- **WHEN** 摘录原文仍在 lines 记录的行范围内
- **THEN** 按行号定位并高亮，不触发搜索

#### Scenario: 行号漂移后搜索命中

- **WHEN** 文档经编辑导致 lines 指向的文本与摘录原文失配，但原文仍存在于文档其他位置
- **THEN** 经全文搜索定位到原文实际位置并高亮

#### Scenario: 失锚告知

- **WHEN** 摘录原文在文档中已不存在（或文档已删除）
- **THEN** 面板出现 toast 告知该摘录已失锚，编辑器不发生任何跳转

### Requirement: 模型选择

composer 控制行 SHALL 提供模型选择 chip：列出**已配置**的 provider ∪ 当前使用项（`configured`
的判据见「配置节 [harness]」条；`mock` 恒被过滤、不上可选列表）。「已配置」SHALL 由后端派生
读数 `harness.providers.<id>.configured` 判定，前端 MUST NOT 用「provider 节是否存在」或条目
数量推断。当前使用项即使未配置 SHALL 保留在列表里（否则 chip 会从一个已知的坏配置上消失）。
provider 选项 SHALL 按「配置节 [harness]」的稳定顺序排列。选择即切换当前 provider 并经运行期
写回通道持久化（`config_set_value` 泛化口径，写入 `harness.provider`）；切换对下一轮生效，
MUST NOT 打断进行中的轮次。chip 文本过长 SHALL 截断（ellipsis），完整名称在 hover 呈现。
配置缺失或非法时 chip SHALL 按「配置节 [harness]」的回退规则落到默认 provider 且不报错。

没有任何 provider（或没有任何 `configured` 条目且无当前使用项）时，chip SHALL 显示空态
「未配置模型」；打开选择器 SHALL 显示「还没有可用的 provider」并提供「去设置」动作（打开
设置面板）。发送消息 SHALL 返回 `harness_provider_missing` 人话错误并保留输入区内容。

composer 的 chip 与设置面板的「设为当前使用」SHALL 是同一语义（都写 `harness.provider`）：
chip 是日常切换入口，设置面板在管理 provider 时也可设置（删除当前 provider 时必须选替代项）。
两者 MUST NOT 产生两套持久化路径。

#### Scenario: 切换 provider 并写回

- **WHEN** 配置里 `kimi-work` 与 `deepseek` 两个 provider 均已配置，在控制行模型 chip 里从
  `kimi-work` 切到 `deepseek`
- **THEN** 下一轮对话走 `deepseek`；`config.json` 的 `[harness].provider` 被写回为新值，
  重启后保持

#### Scenario: 进行中的轮次不受影响

- **WHEN** 一轮对话正在流式输出时切换模型 chip
- **THEN** 当前轮次按原 provider 跑完；切换自下一轮生效

#### Scenario: 只列可用的 provider

- **WHEN** `kimi-work` 的 `api_key` 与 `models` 都就位、`deepseek` 只有 `api_key` 没有模型，
  当前使用项为 `kimi-work`
- **THEN** chip 的 provider 选项只有 `kimi-work`（`deepseek` 的 `configured` 为 `false`，
  不列）；给 `deepseek` 补一个模型并重新取数后它才出现

#### Scenario: 当前 provider 即使未配置也保留

- **WHEN** 当前使用项为 `deepseek`，但它的 `api_key` 为空
- **THEN** chip 仍显示 `deepseek` 作为当前读数（不因未配置而消失）；其余未配置的 provider
  不出现在选项里

#### Scenario: 没有任何 provider 时的空态

- **WHEN** `harness.providers` 为空对象，且没有当前使用项
- **THEN** chip 显示「未配置模型」；打开选择器显示「还没有可用的 provider」与「去设置」；
  点击「去设置」打开设置面板；发送消息返回指向设置面板的 `harness_provider_missing`

### Requirement: 发送与停止

发送钮 SHALL 有两态：空闲态（可发送）与处理中态（模型生成或工具循环进行中）。处理中态下发送钮 SHALL 呈现为停止钮，点击 SHALL 中断本轮：停止流式输出与工具循环，已产出的内容保留在 transcript 并标注「已停止」，待决批准项 SHALL 随中断收回，JSONL SHALL 如实记录中断事件。停止后输入区 SHALL 立即可继续提问（新消息开启新一轮）。

#### Scenario: 停止中断工具循环

- **WHEN** 一轮对话处于工具循环进行中（已流式产出部分内容），点击停止钮
- **THEN** 不再产生后续工具调用与生成；已产出内容保留并标注「已停止」；JSONL 记录一条中断事件

#### Scenario: 停止后继续提问

- **WHEN** 一轮被停止后，立即输入新消息并发送
- **THEN** 新消息作为新一轮正常处理，会话上下文保留（含被停止轮的已产出部分）

### Requirement: 复制消息

transcript 中的消息（用户 / agent）SHALL 在 hover 时浮现复制钮，点击 SHALL 把该消息的 Markdown 源文本写入系统剪贴板（agent 消息 = 模型原始输出，用户消息 = 发送前的原始输入，MUST NOT 复制渲染后 HTML）；复制成功 SHALL 就地给出短时反馈（已复制态，自动消退）。

#### Scenario: 复制 agent 消息

- **WHEN** hover 一条 agent 消息并点击复制钮
- **THEN** 系统剪贴板内容为该消息的 Markdown 源文本；复制钮就地呈已复制反馈并短时消退

### Requirement: 进度呈现

工具循环进行中，面板 SHALL 呈现**不定态**进度指示与阶段指示（当前动作一行，如正在读取哪些文件 / 调用哪个工具）；SHALL NOT 呈现百分比进度（总时长运行前不可知，百分比在技术上是伪造）。工具调用完成 SHALL 即折叠为一行摘要（既有口径不变）。eink 主题下进度指示 SHALL 以明度 / 线宽表达，不引入彩色。

进度指示 SHALL 是 transcript 滚动区内的**输出尾行**：在文档流中占位、作为滚动内容的最后一个可见子项；MUST NOT 挂在 transcript 之外（composer 上方的固定块），MUST NOT 以浮层覆盖正文。尾行 SHALL 是单一元素：跨相位复用同一节点，文案原地切换；相位跃迁 MUST NOT 重建、替换或重新插入该节点。相位从空闲进入处理中时 SHALL 把它挂到 transcript 尾位；transcript 因快照 / 恢复重建后若仍在途 SHALL 重新挂到尾位。运行中任何 transcript 顶层子节点新增之后，尾行 SHALL 仍是最后可见项（视觉序与 DOM 序一致）。transcript 的顶层追加 SHALL 经唯一入口维持尾行末位，并 SHALL 有运行时兜底覆盖任何绕过入口的追加路径（含自动压缩标记、孤儿工具记录、快照重建等），MUST NOT 依赖逐个调用点人工置尾。

本条的状态矩阵 SHALL 覆盖一轮对话的**全部处理中相位**：等待响应、生成（含工具循环）、**等待批准**、停止中；空闲 / 历史恢复（不在途）SHALL 不显示尾行、零像素占位。阶段指示 SHALL 有独立的「等待批准…」档：当且仅当相位为 `running` 且**当前会话**的待决批准集合非空时显示。待决集合 SHALL 是面板的待决批准项集合本身（`pendingApprovals`）；判据 MUST NOT 由事件种类、相位、计时、文案或与集合并行的本地标志推断。待决集合为空时 MUST NOT 出现该档——等待响应 / 生成中 / 停止中照旧。

尾行的逐档呈现 SHALL 为：已发送、首个**有效助手产出**前显示「等待响应…」（D381）；生成中（含工具循环）显示「正在生成回复…」（D382）并原地换字；运行中待批（当前会话 `pendingApprovals` 非空）显示「等待批准…」；停止中显示「正在停止…」（D400）；中途接管（进入快照报在途、**无待批**）在重建后显示「正在继续本轮…」，MUST NOT 先显示「等待响应…」；**中途接管 + 待批显示「等待批准…」，MUST NOT 读「正在继续本轮…」**；正常完成 / 出错 / 用户停止在追加终态内容之前隐藏。自动回合与点击发起的 cron 运行 SHALL 与「已发送」同口径。首个有效助手产出 SHALL 是 `reasoning_chunk` / `tool_call` / `text_chunk` 任一到达；三者的推进 MUST 共用同一处逻辑，MUST NOT 只由正文分片推进。

阶段文案的优先级 SHALL 为：**停止中 > 等待批准 > 中途接管 > 等待响应 / 生成中**。停止中 SHALL 最高：用户已请求中断，此刻读「正在停止…」，MUST NOT 因待决项尚未收回而误读成「等待批准」。等待批准 SHALL 高于中途接管与等待响应 / 生成中：轮次虽仍在途，实际阻塞在用户决策，不是模型产出；接管期有 pending 时 MUST NOT 读「正在继续本轮…」。中途接管 SHALL 高于等待响应 / 生成中：接管期已经有过输出，不能读「等待响应」。

标题栏 SHALL 提供**滚动区之外**的审批信号，且不随 transcript 滚动：面板打开时，标题栏的 harness 段 SHALL 在待批期间显示「等待批准」；面板收起时，harness toggle 的活动状态文本与悬停提示 SHALL 读「等待批准」。两个承载 SHALL 同源、同文案、**互斥可见**——面板打开时 toggle 按既有退让条款隐藏，面板收起时段隐藏——同一时刻只有一个可见承载、只有一个 `aria-live` 区域在场，MUST NOT 双显或双播报。待批期间切换界面语言 SHALL 重取两处文案；eink 下 MUST NOT 引入彩色。toggle 的状态点 SHALL 维持既有「在途」档的形状与配色，MUST NOT 为待批新增第四种形状或颜色。标题栏段的状态词 SHALL 在段内完整可见：窄段 + 长会话名时，会话名 SHALL 先收缩 / 省略，状态词与新建会话钮 MUST NOT 被段的溢出裁切；会话名链路（wrapper / 按钮 / 名称文本）SHALL 允许收缩并设最小宽度 0，状态词与新建钮 SHALL 不参与收缩。尾行移入 transcript 后，本信号 MUST NOT 被削弱、隐藏或另写一份；脱离态下待批到达时该信号 MUST 仍在、`scrollTop` 变化 MUST ≤ 1px。

阶段行文案与标题栏状态 SHALL 分别由 `applyStage` 与活动状态施加函数一处落 DOM；尾行的按钮态、显隐、挂载 / 置尾、`data-phase` 与对应布局测量 SHALL 由相位施加函数 `applySendPhase` 一处落 DOM。待决集合的每次变化（批准项到达、采纳 / 拒绝、停止撤回、清面、快照重建）SHALL 经同一份派生判据重施一次（`applyStage` 写阶段文案、活动状态施加函数写标题栏），MUST NOT 在批准事件处理器里另写一份文案或可见性逻辑，MUST NOT 引入与待决集合并行的布尔标志。同一待批集合期间状态词 MUST NOT 闪烁或重复播报（文本值不变即不重播）。

阶段文案的重施路径（首个有效产出、待决集合变化、语言切换）MUST NOT 另写显隐、位置或条形形态，也 MUST NOT 为更新文案触发额外置尾、贴底或布局测量；`applyStage` 只写阶段行文本。

待决集合的清算 SHALL 覆盖全部出口：批准项被采纳或拒绝后 SHALL 在同一同步批次内退出待批状态（回落到生成中 / 等待响应，或随终态落到空闲）；停止 / 轮次中断收回待决项后 SHALL 退场；**done / error / aborted 任一终态收尾时，仍挂在待决集合里的批准项 SHALL 在同一同步批次内撤回**——撤下批准卡、恢复工具行并标注未执行（done / error）/ 已停止（aborted）、清空待决集合、使该卡的决策闭包失效，随后才施加终态；MUST NOT 只隐藏状态词而留下可点 / 可决策的卡。切会话 / 切 vault / 新会话清空渲染面后 SHALL 退场；进入快照 / 中途接管 SHALL 在在途时以快照的待决批准列表为唯一重建依据，MUST NOT 把上一视图的待决项计入当前视图。上述任一出口之后 MUST NOT 残留「等待批准」幻影——阶段行、段状态词、toggle 状态文本、悬停提示 / `aria-live` 同源文本四处都不得残留。

相位为空闲时 MUST NOT 存在可见待批状态或可决策卡：快照中的待决列表在空闲相位 SHALL 按陈旧项丢弃（不落卡、不入集合），live 批准请求在空闲相位到达 SHALL 同样按陈旧处理；旧快照缺在途读数而带待决列表时，MUST NOT 渲染可决策卡，MUST NOT 伪造在途。新一轮开始（`sent` / `auto_turn_started`）前，若上一相位为空闲，SHALL 再清一次上一视图遗留的待决项，使新一轮 MUST NOT 继承旧待批；已处于处理中的轮次不清合法待批。

进入快照（`enter`）MUST NOT 自身清空渲染面或待决集合：其全部调用点 SHALL 保证在此前已完成视图构造（空面）或 `resetView`（清面 + 清待决集合）。这是前置不变量；`restoreSnapshot` 只按快照列表重建，不能替代清面。终态对账（`content`）SHALL 先清面（含清空待决集合）再按快照重放；快照列表为空时，旧待决集合 MUST NOT 残留。

子运行（subagent）透传的批准项 MUST NOT 计入本条判据：它们由任务区承载、本就在 transcript 滚动区之外可见，且当前会话未必在等该决策。父会话的阶段行与标题栏 MUST NOT 因子运行的待批项翻成「等待批准」。

待批状态的出现、退场与文案切换 SHALL NOT 改变跟随 / 脱离语义：MUST NOT 写滚动位（`scrollTop` 变化 ≤ 1px）、MUST NOT 强制回底、MUST NOT 点亮未读（批准卡本身到达仍按既有「新内容」口径处理）。跟滚阈值（回底容差 / 脱离阈值）、两态判据与输入通道判据 MUST NOT 因本条改动；MUST NOT 在内容增长或尺寸变化时自动复跟；MUST NOT 用强制回底掩盖脱离态合同。

发送仍是既有「强制回底白名单」动作。输入区清空（卡片移除）与尾行显隐都会改变 transcript 的几何；发送路径的强制回底 SHALL 以这些布局全部落定后的**最终几何**为准：发送处理 SHALL 在输入区清空与尾行显隐落定之后再执行一次回底（幂等），使写底值、回声基准与最终滚动上限一致，MUST NOT 在卡片移除与尾行出现之间留下未贴底窗口。该第二次回底 MUST NOT 扩散到非白名单事件（批准卡、流式增量、工具行、通知、错误行、终态）。

尾行 SHALL 在文档流内占位，MUST NOT 与正文重叠。尾行 SHALL 为单行（不换行、超长以省略号截断），其高度 SHALL 与文案、界面语言无关恒定；条形高度 SHALL 恒定。相位切换 MUST NOT 改变尾行高度、MUST NOT 改变尾行与上方内容的间距、MUST NOT 移动它上方的任何内容。尾行与上方末条内容的净间距 SHALL 为 4px（16px gap 与 `calc(var(--sp-2) - var(--sp-8))` 的 -12px 叠加）；阶段行颜色 SHALL 取 `--text-2`（排版 change 已升档，MUST NOT 恢复排版前阶段色）。尾行出现或消失 MUST NOT 把脱离态下的阅读位置拽走——`scrollTop` 变化 MUST ≤ 1px。

空态提示的在场判定 MUST 排除尾行（尾行不是内容）：没有消息时提示仍在，有消息时提示不在。空态提示的几何位置 MUST NOT 随尾行显隐变化：MUST NOT 依赖 flex 剩余空间（auto margin）居中；提示中心 MUST 取 transcript 内容盒的中心（排版后上 padding `--sp-8` 与下 padding `--sp-6` 之间），MUST NOT 取 padding box 的几何中心；与本 change 施工前（即排版归档后）的 idle 中心差 MUST ≤ 1px，MUST NOT 以排版前旧基线为对账起点。空态的 13px/1.58、`--text-2`、24px padding SHALL 继承排版 change，本 change MUST NOT 改动。尾行出现 / 消失前后提示位置位移 MUST ≤ 1px，且尾行自身 MUST 真实在场（矩形高度 > 0、落在 transcript 视口内；空态下 `scrollHeight` 有 `clientHeight` 下限，不能单独作为正控制）。空态改为绝对定位时，四边 SHALL 取 `top/right/left: var(--sp-8); bottom: var(--sp-6)`。

尾行的显隐 SHALL 被当作**布局变化**而不是新内容：脱离态下 MUST NOT 因此点亮未读提示；未读判据的基线 SHALL 只补偿尾行自身的布局增量，MUST NOT 把同一批中真实内容增长的高度一起吞掉——同一批中真实内容增长 MUST 照常点亮未读，且 `scrollTop` 变化 MUST ≤ 1px。跟随态下照常贴底。

停止相位的条形 SHALL 冻结（无位移动画、无脉冲）：停止没有推进，运动暗示与语义相反；eink 主题下同样冻结。其余相位的条形保持不定态，动画只作用于 `transform` / `opacity`，MUST NOT 触发布局。

#### Scenario: 进行中呈现不定态与阶段

- **WHEN** 一轮对话进入工具循环（如先读文件再搜索）
- **THEN** 面板显示不定态进度条与当前阶段行；任何时刻不出现百分比读数

#### Scenario: 完成即折叠

- **WHEN** 某个工具调用完成
- **THEN** 该调用在 transcript 中折叠为一行摘要（工具名 + 结果概要），过程细节不再占位

#### Scenario: 待批时阶段行独立成档

- **WHEN** 一轮处于生成中（已有正文分片或工具行），一个需要批准的调用到达
- **THEN** 阶段行读「等待批准…」；不出现百分比读数；该工具行的待决尾注仍读「等待批准」

#### Scenario: 无待批不误报

- **WHEN** 一轮在生成中、有工具调用但没有任何待决批准项
- **THEN** 阶段行维持「正在生成回复…」（首个正文分片前为「等待响应…」）；标题栏 MUST NOT 出现「等待批准」

#### Scenario: 脱离态下批准卡到达仍有滚动区外信号

- **WHEN** 用户先把 transcript 上滚进入脱离态（此时没有待批项），随后批准卡到达并在视口之外落地
- **THEN** 标题栏的 harness 段读「等待批准」（面板打开；若面板收起，由 toggle 活动状态承担同一状态）；「回到底部」钮的未读提示在场（批准卡是新内容）；`scrollTop` 变化 ≤ 1px；视口 MUST NOT 回到末尾

#### Scenario: 待批已存在后上滚不强制未读

- **WHEN** 待批项已存在（批准卡已在 transcript 内），用户上滚进入脱离态，期间没有新内容到达
- **THEN** 未读提示 MUST NOT 因待批状态本身点亮（上滚进入脱离态时按既有跟滚模型处理未读，本 change 不改）；视口 MUST NOT 被强制回底；`scrollTop` 变化 ≤ 1px

#### Scenario: 面板收起仍有审批信号

- **WHEN** 待批期间收起 harness 面板
- **THEN** toggle 的活动状态文本与悬停提示读「等待批准」；重新打开面板后批准卡可见，阶段行仍读「等待批准…」（重开不拉快照，保留的是本地状态）

#### Scenario: 回到底部后仍待批

- **WHEN** 脱离态待批时点击「回到底部」
- **THEN** 批准卡进入视口；阶段行与标题栏仍读「等待批准」，直到采纳 / 拒绝 / 停止撤回

#### Scenario: 采纳后清算

- **WHEN** 待批时点击采纳
- **THEN** 阶段行、段状态词、toggle 状态文本与悬停提示 / `aria-live` 同源文本在同一同步批次内退出待批（回落到生成中 / 等待响应，或随终态落到空闲）；卡片收敛为终态记录；四处均无「等待批准」残留

#### Scenario: 拒绝后清算

- **WHEN** 待批时点击拒绝（可附原因）
- **THEN** 与采纳同口径退场；终态记录显示拒绝结果，附原因时原因文本直接可见；MUST NOT 残留待批状态

#### Scenario: 多个待批项逐个清算

- **WHEN** 同一轮有两个待决批准项，逐个采纳 / 拒绝
- **THEN** 每决策一项后状态仍为「等待批准」；最后一项决策后同一同步批次内退场；MUST NOT 在第一项决策后就回落生成档

#### Scenario: 停止撤回清算

- **WHEN** 待批时点击停止，或轮次被中断收回待决项
- **THEN** 待决卡撤下；阶段行读「正在停止…」并随后隐藏；标题栏 MUST NOT 再读「等待批准」；MUST NOT 出现永恒的「等待批准」幻影

#### Scenario: done / error 收尾撤回未决批准

- **WHEN** 一轮以 done 或 error 收尾时仍有待决批准项
- **THEN** 同一同步批次内撤下批准卡、恢复工具行并标注未执行、清空待决集合、使决策闭包失效；阶段行隐藏，标题栏按空闲 / 未读档呈现；MUST NOT 留下可点的卡或可被决策的项；随后发送新一轮时旧待批 MUST NOT 复活

#### Scenario: 空闲遗留待批不随新一轮复活

- **WHEN** 旧快照缺在途读数而带待决列表（相位为空闲），用户直接发送下一轮
- **THEN** 旧待批卡 MUST NOT 渲染为可决策卡；新一轮开始时旧待决集合已被清空；新一轮的阶段行与标题栏 MUST NOT 出现「等待批准」

#### Scenario: 终态对账快照不复活待批

- **WHEN** done / error 后的终态对账（content）快照返回非空或空的待决列表，且面板处于打开或收起状态
- **THEN** 相位保持终态（空闲），阶段行隐藏，标题栏按空闲 / 未读档呈现；非空列表 MUST NOT 复活批准卡或待批状态，空列表也 MUST NOT 残留旧状态

#### Scenario: 中途接管按快照重建待批

- **WHEN** 面板进入快照报在途，且快照带非空的待决批准列表
- **THEN** 重建后阶段行读「等待批准…」、标题栏读「等待批准」；MUST NOT 先闪「等待响应…」；批准卡在 transcript 中可见

#### Scenario: 快照不带待批

- **WHEN** 进入快照报在途，但待决批准列表为空
- **THEN** 阶段行读「正在继续本轮…」，MUST NOT 先闪「等待响应…」；标题栏读「处理中」；MUST NOT 出现待批状态

#### Scenario: 视图复位不串会话

- **WHEN** 会话 A 有待批项时切到会话 B（或切 vault / 新会话）
- **THEN** B 的阶段行与标题栏 MUST NOT 出现「等待批准」；A 的待决项 MUST NOT 计入 B

#### Scenario: 子运行待批不误报父会话

- **WHEN** 子运行透传的批准卡在任务区等待决策，父会话自身没有待决项
- **THEN** 父会话的阶段行与标题栏 MUST NOT 出现「等待批准」；子运行卡仍在任务区可见

#### Scenario: 待批不拽视口

- **WHEN** 脱离态下待批状态出现并随后退场（期间没有其他新内容）
- **THEN** `scrollTop` 变化 ≤ 1px；未读提示 MUST NOT 因状态切换点亮；跟滚阈值与两态判据不变

#### Scenario: 发送后按最终几何贴底

- **WHEN** 输入区带一张引用卡（quote card）时发送一条消息（跟随态或刚脱离）
- **THEN** 发送处理完成时 `scrollTop` 等于最终滚动上限（±1px）；「回到底部」钮不在场；卡片移除与尾行出现 MUST NOT 留下未贴底窗口

#### Scenario: 语言与主题切换

- **WHEN** 处理中（含待批期间）切换界面语言（zh ↔ en）或主题（light / dark / eink）
- **THEN** 阶段行与标题栏状态随语言重绘；尾行文案随语言重绘、高度不变；配色与条形形态按主题 token 成立；eink 不引入彩色；状态点形状不变

#### Scenario: 窄段下状态词不被裁切

- **WHEN** 标题栏 harness 段处于窄宽度且会话名很长，待批状态词出现
- **THEN** 状态词与新建会话钮都在段矩形内完整可见；会话名宽度较无待批时确实缩小并以省略号截断；MUST NOT 出现状态词或加号钮被段溢出裁掉的形态

#### Scenario: 同一待批集合不重复播报

- **WHEN** 待批期间收到同一批准请求的重复投递、工具行更新或流式分片
- **THEN** 状态词保持不变、`aria-live` 不重复播报；待批集合只按集合变化重施一次

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
- **THEN** 标题栏 harness 段（面板开）或 toggle 活动状态（面板收）仍读「等待批准」；`scrollTop` 变化 ≤ 1px；视口不回到末尾；「回到底部」钮的未读提示按既有口径呈现

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
- **THEN** 阶段行颜色为 `--text-2`（不恢复排版前阶段色）；尾行与上方末条内容的净间距为 4px（16px
  gap 与 `calc(var(--sp-2) - var(--sp-8))` 的 -12px 叠加；容差 ±1px）；空态绝对定位四边为
  `sp-8/sp-8/sp-6/sp-8`，并继承 13px/1.58、`--text-2`、24px padding

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

#### Scenario: 文案重施不触发布局副作用

- **WHEN** 首个有效产出、待决集合变化或语言切换触发阶段文案重施
- **THEN** 只更新阶段行文本；尾行显隐、位置、`data-phase`、条形形态与 `scrollTop` 不变；不触发置尾、贴底或布局测量

### Requirement: 消息呈现

transcript 中的用户与 agent 消息 SHALL 带角色 + 时间读数 meta 行（如「你 · 12 秒前 / Agent · 刚刚」）：角色名与时间读数同行，视觉上降档于消息正文（micro 字号；角色取二级文字色 `--text-2`，时间读数取三级文字色 `--text-3`）。用户消息 SHALL 以气泡呈现，与 agent 消息的平铺正文一眼可分：light / dark 档取内容底色一族、柔和边框、圆角的气泡面，eink 档取正文纸面 + 结构档 1px 描边（MUST NOT 铺大片灰实底——e-ink 的中间调靠抖动呈现，压在灰底上的正文发糊）；气泡正文 SHALL 取正文档（与 agent 正文同档），MUST NOT 为「降一档」而压暗正文——正文可读性由气泡面与描边承担区分，气泡正文与其承载面的对比度 SHALL ≥ 7:1（WCAG AAA 正文档），三主题各自成立；agent 消息 SHALL 平铺排版（无气泡）。读数形态 SHALL 按数据来源分两档：**live**（本轮上屏打戳的消息）按「刚刚 / N 秒前 / N 分钟前 / N 小时前 / 昨天」分档；**restored**（快照恢复与会话恢复重放的消息，时间读数来自留存）按「同日窄相对 / 跨天短日期」呈现——留存在盘上，读数可以跨天甚至跨周，「昨天」对更老的消息是错读数。两档 SHALL 随时间低频刷新与随语言切换重绘（形态随消息携带、重绘不重算）。快照 / 恢复重建的消息 SHALL 以后端时间戳（`PanelMessage.ts`）显示真实读数；**会话恢复的 ts SHALL 来自留存记录的信封**（wire 项自身不带时间戳，按项在记录序里的产出时刻归属，见 design §3）；无时间戳可归的消息 SHALL 只显示角色、SHALL NOT 伪造读数。快照消息面 SHALL 保真：正文为空的 assistant 轮（模型只发工具调用、无正文）MUST NOT 落成面板记录——快照恢复 MUST NOT 出现只有角色 meta 行、正文为空的「空气泡」；工具记录（`role: tool`）SHALL 持久化摘要（`PanelMessage.summary`），成功为调用参数摘要、失败含细分状态与错误码，使 webview 重载后工具行仍有信息；成功侧的参数摘要是**单行**人话文本，`cli_run` 为「命令 + 参数」拼接且**命令本体恒在最前**（参数 JSON 原样截断时，排在命令之前的 `args` 会把它挤出可见头部，工具行只剩一串参数），含空白或引号的参数 SHALL 加引号使参数边界可辨。同一份摘要 SHALL 是 live 事件、面板持久化与恢复重建三条路径的同一份（MUST NOT 各算各的）；恢复路径读到旧快照的参数 JSON 时 SHALL 按同一形态人话化呈现。

#### Scenario: 新消息带 meta 行

- **WHEN** 发送一条提问并收到 agent 回答
- **THEN** 两条消息都带角色 + 时间读数 meta 行（用户消息在气泡内、正文与 agent 正文同档，agent 消息平铺）；读数初始落在「刚刚 / N 秒前」档

#### Scenario: 角色与时间的颜色分层

- **WHEN** 在 light / dark / eink 下读取任一用户或 agent 消息的 who 行
- **THEN** 角色节点消费 `--text-2`，相邻时间节点消费 `--text-3`，二者均保持 10.5px；角色在实际面板背景上的
  对比度 ≥4.5:1，时间继续作为刻意退后的 meta，不改变其文本、数据时间戳或刷新行为

#### Scenario: 恢复消息按后端时间戳显示

- **WHEN** webview 重载或 pane 恢复后从快照重建 transcript，或从会话浮层恢复历史会话后重放 transcript
- **THEN** 携带 `ts` 的恢复消息按该戳显示时间读数（同日给窄相对、跨天给短日期）；缺 `ts` 的消息只显示角色、不显示时间读数（不伪造）

#### Scenario: 工具轮快照保真

- **WHEN** 模型某轮只返回工具调用、无正文文本，随后 webview 重载从快照恢复
- **THEN** transcript 不出现只有角色 meta 行、正文为空的 agent 消息；工具行仍显示调用参数摘要（调用失败时显示细分状态与错误码）

#### Scenario: 语言切换重绘

- **WHEN** 界面语言切换（zh ↔ en）
- **THEN** 角色名与时间读数随 `onRelabel` 重绘为对应语言；恢复消息的读数形态保持 restored（不因重绘回落到 live 档）

#### Scenario: 会话恢复的消息带留存时间

- **WHEN** 从会话浮层选择一个历史会话恢复（源会话留存在盘上，可能已跨天）
- **THEN** 重放出的每条消息的 meta 行都带该消息在源会话里的时间读数（用户消息 = 它所属请求的发送时刻，助手回复 = 产出它的那次响应时刻）；跨天的消息显示短日期而不是「昨天」；源记录缺 `ts` 时该消息不显示时间读数

### Requirement: 错误呈现

transcript 中的错误行 SHALL 同文案去重：新错误的文案与当前最后一条错误行逐字相同时 SHALL 就地替换
该条（跟随态下滚到可见；用户已离开底部时 MUST NOT 改变滚动位，改由「回到底部」钮的未读提示承担），
SHALL NOT 追加堆叠；不同文案的错误照常追加。

#### Scenario: 同一错误不堆叠

- **WHEN** 同一原因的错误连续发生多次（如后端尚未就绪时反复触发同一失败）
- **THEN** transcript 中该文案的错误行始终只有一条，不发生追加堆叠

#### Scenario: 脱离态下重复错误不拽走视口

- **WHEN** 用户已上滚阅读、处于脱离态，transcript 中同一文案的错误再次发生
- **THEN** 错误行仍只有一条（就地替换），`scrollTop` 变化 ≤ 1px（视口不回到末尾），「回到底部」钮的
  未读提示在场

### Requirement: 浮层可访问性

harness 的浮层（模型 chip 的 provider 浮层、标题栏 harness 段的会话浮层）SHALL 对辅助技术可达：浮层 MUST NOT 嵌在 `<button>` 元素内（WKWebView 将嵌套按钮当叶子、不暴露其内容）；浮层 SHALL 以 `role="menu"` 及菜单项角色（provider 项 `menuitemradio` + `aria-checked`）呈现，触发钮 SHALL 带 `aria-haspopup="menu"` 与随开合翻转的 `aria-expanded`。浮层打开时 Escape SHALL 先收浮层，无浮层打开时 Escape 才收面板。

#### Scenario: 浮层项读屏可达

- **WHEN** 打开模型 chip 的 provider 浮层或会话名浮层
- **THEN** 浮层项在 WKWebView 的 AX 树中逐个暴露（可经辅助技术定位并激活）

#### Scenario: Escape 分层

- **WHEN** 任一浮层打开时按 Escape
- **THEN** 只收起浮层，面板保持打开；浮层全关时再按 Escape 才收起面板

### Requirement: 工具调用呈现

工具调用 SHALL 以步骤清单形态呈现于当前 agent 消息内（hairline 夹区、独立于消息正文）：运行中的调用 SHALL 显示运行中行（脉冲指示 + 调用名），完成的调用 SHALL 翻为完成行（✓ 图标 + 结果摘要）；同一轮次的多次调用 SHALL 累积为有序多行清单。轮次结束后，含两行及以上的清单 SHALL 折叠为一行摘要（「N 个工具调用 · 全部完成」），摘要 SHALL 可点击展开回看全部步骤行；单行清单 SHALL 保持展开。快照恢复的历史轮次 SHALL 按同口径重建清单与折叠态。组摘要的计数 SHALL 只计真实工具调用行；
Web 调用的结果健康摘要与默认关闭的审计详情 SHALL 作为该调用的附属内容，MUST NOT 计为另一次
调用、MUST NOT 影响单行 / 多行判定。点击摘要展开回看时，各调用的审计详情 SHALL 保持默认关闭
（组开合 MUST NOT 改写各详情自身的展开态）。

#### Scenario: 进行中清单

- **WHEN** agent 轮次中发生工具调用（started → done）
- **THEN** 当前 agent 消息内出现步骤行：started 时为运行中行（脉冲指示），done 时该行翻为完成行（✓ + 结果摘要）；多次调用按到达次序逐行累积

#### Scenario: 完成后折叠与回看

- **WHEN** 一轮含两次及以上工具调用的轮次结束
- **THEN** 清单折叠为一行摘要（含调用数）；点击摘要展开回看全部步骤行，再点收回

#### Scenario: 单行不折叠

- **WHEN** 一轮只含一次工具调用的轮次结束
- **THEN** 该步骤行保持展开可见，不出现摘要行

#### Scenario: Web 审计不计入调用数

- **WHEN** 一轮内只有一次 Web 工具调用，或先后发生两次真实工具调用且每次各带一个审计详情
- **THEN** 单调用不出现组摘要；两次调用仍折叠为「2 个工具调用」；展开组后各审计详情仍默认关闭

### Requirement: 思考过程呈现

agent 消息的思考内容（provider 返回的 reasoning 文本）SHALL 在 transcript 中渲染为可折叠块。
思考块 / 工具块 / 正文段在**同一条 agent 消息内 MUST 严格按事件到达序排列**：不论事件如何交错
（think→tool→think、think→think→tool、tool→think→tool、text↔think↔tool 等任意组合），
后到达的块 MUST NOT 呈现在先到达的块之前；思考块插在两段正文之间时正文 SHALL 切分为两个
文本段，插在两个工具行之间时在途工具块 SHALL 封板（前后工具行各成一块）。一轮里多个思考块
的到达序 SHALL 与块序号序一致（后端按序发出）；消息无思考内容时 MUST NOT 渲染思考块
（不渲染空块）。思考块 SHALL 默认折叠（含流式进行期间），折叠态为单行：chevron + 「思考过程 · N 秒」，
展开态为左边线 + 次级灰正文；样式 SHALL 只取 token 层现行值，MUST NOT 引入新色值或字号。
时长 SHALL 为该思考块从首个文本片段到末个文本片段的实际耗时，轮次结束时定格。
**恢复重建的思考块**（快照恢复 / 会话恢复重放，`PanelMessage.reasoning` 有明文时）SHALL 走同一条
折叠默认口径：默认折叠、点折叠行展开原文，MUST NOT 默认展开（M542，Alex 2026-10-16 现场）；其折叠行
SHALL 取**无时长变体**「思考过程」（D468）——wire 只带 reasoning 明文、不带思考时长读数，写一个数字
即伪造读数（与「无 ts 不显示时间读数」同口径），语言切换重渲时 SHALL 同样重取本串、MUST NOT 回落成
带时长的 D388 形态。
复制消息 SHALL 只含 agent 回答正文，MUST NOT 含思考内容。
Rust core SHALL 经事件流把 reasoning 文本实时转发前端；reasoning 的跨轮回放路径
（M306 纪律）MUST NOT 因此改动。

#### Scenario: 折叠默认与展开原文

- **WHEN** mock provider 的 fixture 产出含 reasoning 项的响应，一轮对话完成
- **THEN** agent 消息出现折叠态思考块（单行标题 + 时长）；点击展开后可见思考原文；
  再次点击回到折叠

#### Scenario: 流式期间保持折叠且内容实时流入

- **WHEN** fixture 的 reasoning 以多个片段流式产出，轮次进行中
- **THEN** 思考块保持折叠态，时长随流入增长；用户手动展开后可看到实时流入的思考文本

#### Scenario: 无思考不渲染块（反向验证）

- **WHEN** mock fixture 的响应不含 reasoning 项，一轮对话完成
- **THEN** agent 消息的思考块数量为零（防恒真空转：正观测由前两个 scenario 提供）

#### Scenario: 到达序排列与复制边界

- **WHEN** fixture 在一轮里产出两个 reasoning 项（工具调用前后各一，中间夹正文）
- **THEN** 思考块 / 工具块 / 正文段按事件到达序交错排列（先到的思考在工具与前段正文之前，
  后到的思考在工具与后段正文之间，MUST NOT 全部挤在正文之前）；对该消息执行复制消息，
  剪贴板只含回答正文、不含任何思考内容

#### Scenario: 到达序排列的交错矩阵（属性级）

- **WHEN** 事件序列以 think→tool→think、think→think→tool、tool→think→tool、
  text↔think 交错等组合到达（含相邻工具行不被拆开、思考落在工具行之间时封板等边界）
- **THEN** 任意组合下消息 DOM 子节点序恒等于事件到达序（不变量级断言，
  由 tests/visual/scenes/m383-harness-thinking-order.spec.ts 的序列矩阵钉死）

### Requirement: 恢复渲染与默认渲染一致

恢复路径（webview 重载 / 切 vault 回来的**快照恢复**、会话浮层选历史会话的**会话恢复**）
重放出的 transcript SHALL 与默认渲染（同一份会话走 live 事件的路径）在**每一类块的默认展开 /
收起态**上一致（M542，Alex 2026-10-16 原话：「我希望重建后的会话在 harness pane 的默认显示
保持一致 —— 默认展开的内容（比如 AI 回复的正文）在重建后也展开，而默认不展开的内容（比如
thinking 过程）在重建后也不展开」）：默认展开的内容（agent 回答正文、单行工具清单）恢复后同样
展开，默认不展开的内容（思考块、两行及以上的工具清单、压缩摘要折叠件）恢复后同样不展开。
两条恢复入口 SHALL 与快照路径共用同一份项映射与渲染件，MUST NOT 为恢复另建一套默认态。
恢复路径与 live 路径的差异 SHALL 只落在**读数有无**（思考时长、消息时间戳），MUST NOT 落在
展开态。**边界**：后端错误行是 live 面（面板记录只有 user / assistant / tool / compact 四类角色，
恢复路径无对应留存记录可重建）——它不在本不变量内，也不是可折叠块。

#### Scenario: 逐类块默认态与默认渲染一致

- **WHEN** 从会话浮层选一份历史会话恢复（或 webview 重载后从快照重建 transcript）
- **THEN** 恢复出的思考块默认折叠（正文不可见、折叠行 `aria-expanded=false`，点折叠行可展开
  原文）；agent 回答正文默认可见；两行及以上的工具清单折叠为一行摘要、单行清单保持展开——
  逐类块的默认态与同一条会话在 live 路径下相同

#### Scenario: 恢复路径不伪造读数

- **WHEN** 恢复路径缺某类读数（wire 不带思考时长、留存的旧记录不带消息时间戳）
- **THEN** 该读数 SHALL 缺席而不是补零（思考折叠行取无时长变体 D468「思考过程」、无 ts 的消息
  只显示角色）；语言切换重绘 SHALL 重取同一形态，MUST NOT 回落成带时长的模板

### Requirement: 思考程度选择

composer 控制行 SHALL 提供思考程度 chip（位于模型 chip 之后、ctx 读数之前），显示当前档位
「思考：Low/High/Max」；点击 SHALL 弹出浮层，浮层为三个裸档位、当前档位带勾选，
MUST NOT 出现每档释义文案。档位命名与默认值 SHALL 沿用 Kimi / DeepSeek 的 Low/High/Max 与默认
High（Alex 2026-10-06 裁决），档位名作为专有名词在 zh/en 两档界面均保持英文原文；core SHALL 按当前
provider 映射到各家实际 reasoning 参数。档位 SHALL 会话内生效：影响其后发出的消息，新建会话重置为
默认。provider 不支持程度调节时 chip SHALL 置灰禁用并给出 hover 说明
（「当前模型不支持思考程度调节」），MUST NOT 呈现为可点但无效果。

#### Scenario: 三裸档浮层

- **WHEN** 点击思考程度 chip
- **THEN** 浮层列出 Low/High/Max 三项、无释义文案，当前档位带勾选；选择另一档后 chip 文案更新、
  浮层关闭

#### Scenario: 档位生效于下一轮请求

- **WHEN** 把档位从 High 切到 Max 后发送一条消息（mock provider）
- **THEN** 该轮 LLM 请求携带映射后的程度参数（mock 侧断言），此前各轮参数不变

#### Scenario: 新会话重置默认

- **WHEN** 档位已切到非默认值，随后新建会话
- **THEN** 新会话的 chip 显示「思考：High」，且下一轮请求按默认档位构造参数

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

### Requirement: vault 移动与删除工具

系统 SHALL 提供 `vault_move` 工具：参数 `path`（vault 相对路径，源）与 `new_path`（vault 相对路径，目标，含新末段名），实现 vault 内移动/重命名（可跨目录）；源与目标 SHALL 经 vault 根路径解析的全部逃逸防护，目标撞名 MUST NOT 覆盖既有条目，目标父目录 MUST 已存在，跨卷失败 SHALL 如实报错且 MUST NOT 留半移动状态（不做静默 copy+delete）。系统 SHALL 提供 `vault_delete` 工具：参数 `path`（vault 相对路径），删除 SHALL 为移入系统废纸篓（用户可经系统通道恢复），MUST NOT 提供永久删除路径。两工具 ask 档的批准预览 SHALL 分别为「源 → 目标」路径对与「路径 + 将移入废纸篓可恢复」。

#### Scenario: 跨目录移动

- **WHEN** 模型调用 `vault_move(path: "drafts/a.md", new_path: "notes/2026/a.md")`（目标父目录存在、目标不存在）
- **THEN** 条目移动到目标路径，源路径消失，返回成功信封

#### Scenario: 移动撞名不覆盖

- **WHEN** 模型调用 `vault_move` 且目标路径已有同名条目
- **THEN** 返回 `fs_already_exists`，源与目标均逐字节不变

#### Scenario: 删除进废纸篓

- **WHEN** 模型调用 `vault_delete(path: "notes/a.md")` 且批准被采纳
- **THEN** `notes/a.md` 进入系统废纸篓（可恢复），vault 内消失；废纸篓调用失败时文件保持原样

### Requirement: 会话内批准缓存

批准闸 SHALL 提供次级动作「采纳且本会话不再问」：点击后该次调用执行，并把缓存键记入当前会话的
批准缓存。`cli_run` 的缓存键 SHALL 为**命令前缀**（命令名 + 首个非 flag 参数；取不到第二词时退化为
命令名），命中按词边界前缀判定（规范化主体串等于前缀，或以前缀加一个空格开头）；vault 工具与调度
工具的缓存键 SHALL 为规范化主体串全等。同一会话内后续命中缓存键的调用 SHALL 直接执行，MUST NOT
重复弹批准闸。批准卡 SHALL 写明本次会话将记住的粒度（`cli_run` 显示前缀原文、其余工具显示主体串
原文），使授权面在按下前可见。危险黑名单调用的缓存键 MUST NOT 被写入（该层先于缓存判定，写进去
也永远不会被读到），其批准卡 MUST NOT 提供该次级动作。点「采纳」本身 MUST NOT 记入缓存。缓存 SHALL
为会话内存态：「新会话」、切 vault 切会话、app 重启即清空；MUST NOT 落盘、MUST NOT 进 JSONL 留存。
缓存命中只在模式默认分层生效——deny 规则、vault 内写重定向、危险黑名单三层 MUST 先于缓存判定
（缓存不解锁这三层）。缓存 SHALL 与持久规则彼此独立：命中缓存 MUST NOT 写配置，持久规则命中 MUST
NOT 写缓存。

#### Scenario: 显式记忆与精确匹配

- **WHEN** Alex 对 `vault_patch(path: "notes/a.md")` 点「采纳且本会话不再问」，随后模型调用 `vault_patch(path: "notes/a.md")` 与 `vault_patch(path: "notes/b.md")`
- **THEN** 第二次同一路径直接执行（vault 工具按规范化主体串全等匹配）；`notes/b.md` 仍弹批准闸（不做前缀泛化）

#### Scenario: 前缀记忆覆盖同命令族的其它实参

- **WHEN** 默认档下 Alex 对 `cli_run("tvly", ["search", "prompt caching"])` 点「采纳且本会话不再问（记住 `tvly search`）」，随后模型调用 `cli_run("tvly", ["search", "另一个问题"])` 与 `cli_run("tvly", ["save", "x"])`
- **THEN** 第二个 `search` 直接执行、不进批准闸；`save` 仍弹批准闸（不同前缀）

#### Scenario: 黑名单不受缓存影响

- **WHEN** 缓存中已有某前缀，模型以命中该前缀的主体串调用危险黑名单命令；或 Alex 在危险黑名单卡上查看次级动作
- **THEN** 调用仍进入批准闸，MUST NOT 因缓存自动放行；危险卡不出现该次级动作，缓存里不新增该条目

### Requirement: 权限模式切换

composer 控制行 SHALL 提供权限 chip（位于模型 / 思考合并选择器 chip 之后、ctx 读数之前），**显示
当前模式档的短名**（文案表 zh：只读 / 可写 / 完全；en：Read / Write / Full）——控制行被合并选择器
chip 与权限 chip 共同挤占，短名是「三档都能完整显示」的口径（Alex 2026-10-09 裁决；zh 短名「写入」
于 2026-10-10 批复改为「可写」）。点击 SHALL 弹出浮层：三档单选、当前档勾选、列表项显示**全名**
（zh：只读 / 保险库写入 / 完全访问；en：Read Only / Vault Write / Full Access）、且**每档附一行释义**
消歧档名与语义（`read_only` = 读自动放行、写操作都先问；`vault_write` = 库内写自动放行、库外命令
先问；`full_access` = 全自动、仅危险命令仍问；措辞可在实现批次微调，语义方向以此为准）。chip 的
悬停提示与可访问名 SHALL 说明当前档并附上**该档的同一行释义**（与浮层释义同源，不新增信息）。
浮层 SHALL 复用既有浮层可访问性口径（`role="menu"` / `menuitemradio` / `aria-checked`）。选择一档
SHALL 立即生效并经 `config_set_value` 写回 `[harness].permission_mode`；切换 MUST NOT 打断进行中
的轮次（对下一个判定生效，与模型 chip 同口径）。

浮层 SHALL 在三档单选项之外另附一段「已记住的规则」：逐条显示 `[harness].permissions.allow` 的
规则原文（等宽字体）与一个删除钮，删除钮的可访问名 SHALL 含规则原文。该列表为空时整段（含分隔线
与段标题）MUST NOT 渲染，浮层形态与无此段时一致。列表内容 SHALL 在浮层打开时从当前配置现读，
MUST NOT 呈现前端缓存的旧值；删除 SHALL 立即写回配置，并在下一次权限判定生效。规则条目 SHALL
只读——浮层内 MUST NOT 编辑规则文本（改写仍走配置文件）。条目较多时列表区 SHALL 滚动，浮层本体
MUST NOT 超出面板可视边界（沿用既有边界收编）。

#### Scenario: 三档浮层

- **WHEN** 点击权限 chip
- **THEN** 浮层列出三档（各显示全名 + 一行释义）、当前档勾选；选择另一档后 chip 文案（短名）更新、浮层关闭

#### Scenario: 切换不打断进行中轮次

- **WHEN** 一轮对话正在工具循环中，把模式从 `vault_write` 切到 `read_only`
- **THEN** 当前轮次按开轮时的模式判完；从下一个判定起按 `read_only` 执行

#### Scenario: chip 悬停提示带当前档释义

- **WHEN** 指针悬停在权限 chip 上（或读屏取该 chip 的可访问名）
- **THEN** 提示文本包含当前档全名与浮层里的那行释义（如「权限模式：保险库写入（点击切换）· 库内写自动放行；库外命令先问你」），且与浮层同一档的释义逐字相同

#### Scenario: 规则列表可见可删

- **WHEN** 配置的 allow 规则含 `cli(tvly search *)`；打开权限浮层并点击该规则旁的删除钮
- **THEN** 三档下方出现「已记住的规则」段并逐条显示规则原文；删除后该条从列表消失、配置里的规则同步移除；此后同类 `tvly search` 调用重新弹批准闸

### Requirement: cli_run 用途说明（purpose 字段）

`cli_run` 工具的参数 schema SHALL 包含必填字符串字段 `purpose`：模型发起调用时 SHALL 用一句人话说明该命令的用途（Claude Code 的 Bash description 同款——描述是调用的一部分）。purpose 缺失或 trim 后为空白串时，调用 MUST NOT 执行：系统 SHALL 在工具调用入口（判定管线之前）按统一错误信封结构化回送（人话 message 指明需补填用途说明），模型补填后重发。purpose 是模型自述的阅读辅助，MUST NOT 参与权限判定的任何一层（命令分类、vault 写重定向、危险黑名单、allow 规则、模式默认分层均只看 argv 本身）。批准卡 SHALL 在 CLI 命令上方显眼位置展示 purpose，命令原文完整可见、MUST NOT 被 purpose 替代或截断。

#### Scenario: purpose 随调用到达批准卡

- **WHEN** 模型发起带 `purpose: "安装依赖以跑测试"` 的 `cli_run` 写命令（ask 档）
- **THEN** 批准卡命令上方显眼位置显示该用途句；命令原文完整可见；权限判定结果与不带 purpose 的同一命令完全相同

#### Scenario: 空 purpose 拒绝补填

- **WHEN** 模型发起的 `cli_run` 调用缺 `purpose` 字段（或 purpose trim 后为空白串）
- **THEN** 调用不执行，回送指明需补填用途的错误信封；模型补填 purpose 重发后正常进入判定与执行

### Requirement: 模型图片能力声明

`config.json` 的 `[harness].providers.<id>.models` 逐项声明 SHALL 支持 **`vision`** 布尔键
（键名 2026-10-10 由 `image` 改名，避免与 `image_generation` 混淆；与既有的 `effort` /
`window` 同一条 config-only 声明链）：`true` 表示该 provider + 模型接受图片输入；该键缺席 /
模型未列在清单内 SHALL 按**不支持**处理（保守默认，与 `effort` 同侧），SHALL 给一条人话
warning。系统 MUST NOT 内置任何模型的图片能力——MUST NOT 硬编码、MUST NOT 出厂回落。本条的
`<id>` 是任意用户定义的 provider id（含新增条目），不限于固定集合。

当前生效 provider + 模型的图片能力为**不支持**时，含图片卡片的消息 SHALL 在**发送时**被挡下：
系统 SHALL 返回人话错误（错误码区分"图片不受支持"这一成因）并保留输入区内容，界面 SHALL 标出
该消息里的图片卡片（用户可移除后重发）。系统 MUST NOT 静默丢弃图片后照发、MUST NOT 在粘贴时
即拒收（贴入动作本身不受能力声明限制）。能力判据 SHALL 只有一处（发送路径），界面 MUST NOT
另立第二套能力判定。

任何面向用户的模型声明指引（配置校验 warning、发送期错误信封、设置面板的字段说明）SHALL 同时
列出 `id` / `effort` / `vision` / `window` 四项；`vision` 是图片发送与图片命名的唯一依据，
指引漏掉它会让图片能力无声失效。MUST NOT 只列 `effort` / `window`。

#### Scenario: 支持时正常投递

- **WHEN** 生效模型的声明含 `"vision": true`，发送一条携带图片卡片的消息
- **THEN** 消息正常发出，wire 请求含展开后的 `input_image` part

#### Scenario: 未声明按不支持

- **WHEN** 生效模型的声明缺 `vision` 键（或该模型不在清单内）
- **THEN** 该模型的图片能力按不支持处理并产生人话 warning；含图片卡片的消息发送被挡下

#### Scenario: 不支持时挡住并标出图片卡片

- **WHEN** 生效模型的 `vision` 为 `false` 或未声明，用户在 composer 贴入图片并点击发送
- **THEN** 发送被挡下并弹出人话错误；该消息里的图片卡片被标出（错误态可见）；输入区内容原样
  保留、会话不推进、MUST NOT 发出丢弃图片的降级消息；移除图片卡片后同一消息可正常发出

#### Scenario: 新增 provider 同样适用

- **WHEN** 用户新增 `local-lab`（generic 预设）并在其 `models` 里声明 `vision: true`，切到它
  后发送带图片的消息
- **THEN** 图片按声明放行；能力判定不依赖 provider id 是否属于任何固定集合

### Requirement: cli_run 执行环境（登录 shell PATH）

系统 SHALL 在进程内**首次**执行 `cli_run` 时经用户登录 shell 解析一份完整 `PATH`，并把解析结果注入
此后每个 `cli_run` 子进程的环境变量 `PATH`——目的是让裸命令（如装在用户 shell 启动文件追加目录里的
CLI）无需 `zsh -lc` 一类包裹即可被找到，从而不再因「找不到命令」逐条进入批准闸。

shell SHALL 取环境变量 `SHELL`（缺失或 trim 后为空白时回落 `/bin/zsh`）。当 shell 的 basename 为
`zsh` 或 `bash` 时，系统 SHALL 以**登录 + 交互**旗标（`-l -i -c`）执行一条只打印 `PATH` 的命令
（实证：PATH 增补同时定义在登录启动文件与交互启动文件两处，只加载其一拿不全）；其余 shell MUST NOT
猜测旗标，直接按解析失败处理。解析 SHALL 在独立子进程内进行，`stdin` 置空、`stderr` 丢弃；输出 SHALL
用一对固定标记夹取 `PATH`（启动文件会向 stdout 打杂输出，MUST NOT 被当作 PATH）。解析 SHALL 带超时
（默认 5 秒）：超时 / 子进程错误 / 取不到标记 / 标记之间为空白，一律判**解析失败**。解析结果 SHALL
在进程内缓存复用（成功与失败都缓存），MUST NOT 每次 `cli_run` 都重新解析。

解析成功时注入的 `PATH` SHALL 为「解析结果在前 + 应用继承到的额外目录去重追加在后」（空段丢弃）；
解析失败时 MUST NOT 改写子进程环境——`cli_run` 子进程照常继承应用自身 `PATH`。本机制 MUST NOT 改动
权限模型：解析出的 `PATH` 只影响子进程能否找到命令，MUST NOT 影响命令是否被放行——命令分类、危险
黑名单、shell 包装器规则、allow / deny 规则、模式默认分层与批准缓存全部照旧只以 argv 为判据。

#### Scenario: 裸命令找到登录 shell 里的工具

- **WHEN** 用户 shell 的启动文件把某工具目录追加进 PATH，且该目录不在应用进程自身 PATH 里；模型调用
  `cli_run("tvly", ["--version"])`（裸命令，无 `zsh -lc` 包裹）
- **THEN** 子进程带上解析出的完整 PATH，命令被正常找到并执行，MUST NOT 出现「command not found」

#### Scenario: 解析失败回退继承 PATH

- **WHEN** 登录 shell 解析超时，或输出的标记之间为空（启动文件挂住 / 子进程被 kill / 启动文件把 PATH 清空）
- **THEN** `cli_run` 子进程不改写 PATH、照常继承应用自身环境，命令执行行为与本次改动前一致；
  AND 该失败结果被缓存，后续 `cli_run` MUST NOT 反复触发超时重试

#### Scenario: 只对已知 shell 解析

- **WHEN** `$SHELL` 指向 zsh / bash 之外的 shell（如 fish / nu），或缺失、为空白
- **THEN** zsh / bash ⇒ 以 `-l -i -c` 解析；其他 shell ⇒ 不猜旗标、按解析失败回退继承 PATH；
  `$SHELL` 缺失或空白 ⇒ 以 `/bin/zsh` 解析

#### Scenario: 权限判定不受 PATH 注入影响

- **WHEN** 解析出的 PATH 让某个此前找不到的命令变得可执行（如裸 `tvly`）
- **THEN** 该命令仍按既有分类走判定管线（只读直接放行、写在对应档逐个问、危险黑名单任何档都问），
  PATH 注入 MUST NOT 使任何命令免于判定；`zsh -lc` 一类 shell 包装器仍归危险、任何档都逐个问

### Requirement: 消息摘录序列化协议

发送新消息时，消息摘录附件 SHALL 序列化为 `<msg-quote role="…" at="…">摘录原文</msg-quote>`——每段消息摘录一行，全部 `<msg-quote>` 上下文 SHALL 按「新消息的附件前置序列化协议」条的**块序**投影落在各自锚点位置（该 requirement 标题沿用归档身份，正文口径以块序为准）；历史已发送消息的任意交错顺序只用于留存、解析与呈现，MUST NOT 被重排。`role` MUST 为 `user` 或 `assistant` 且 MUST 在场；`at`（来源消息上屏时刻，ISO 8601 本地时间串、秒级）可缺——不可考时产出 role-only 元素；属性值与文本节点 MUST 做 XML 转义。序列化结构 SHALL NOT 包含任何编号——遵循一致性原则：投递给模型的上下文要素对人必须也可查（transcript who 行显示角色与相对时间、卡片 hover 显示完整摘录与绝对时间），编号对人无区分价值故不进协议。会话 JSONL 留存 SHALL 记录序列化后的完整消息（含 `<msg-quote>` 元素，与 `<quote>` 同纪律），历史 JSONL MUST NOT 因新投递语义改写。解析还原路径 SHALL 识别 `<msg-quote>` 还原为消息摘录卡片，并保留历史消息的文字 / 卡片交错顺序；对不识别元素 SHALL 保守处理，MUST NOT 静默丢弃其文本内容。agent 回复 SHALL 按摘录内容与角色/时间回指。

#### Scenario: 序列化结构

- **WHEN** 发送一条「消息摘录卡 + 问题」的消息
- **THEN** 模型收到的消息中摘录为一个 `<msg-quote>` 元素（role 属性在场且合法、at 随来源消息可缺、无编号属性），问题文字按块序落在 `</msg-quote>` 之后

#### Scenario: 转义 round-trip

- **WHEN** 摘录原文含 `<`、`&`、`"` 等字符，或来源消息无 at
- **THEN** 序列化输出中对应位置为 XML 转义形式，解析后还原为原文；无 at 来源产出无 at 属性的元素，解析还原为 at 为空的消息摘录卡片

#### Scenario: UI 与协议无编号

- **WHEN** 输入区或 transcript 呈现消息摘录卡片，或 agent 回复引用某段消息摘录
- **THEN** 界面任何位置与投递给模型的消息中均不出现 `#N` / `index` 形式的卡片编号

#### Scenario: 未知元素保守处理

- **WHEN** 快照恢复的留存消息文本中含序列化协议不认识的元素
- **THEN** 该元素的文本内容 MUST NOT 被静默丢弃（维持既有保守解析口径）

### Requirement: 系统提示词固定段来源

系统提示词的固定段正文——身份段（装配清单来源 id `identity`）、摘录回指纪律（来源 id `quote_reference`）与工作区段（来源 id `workspace`）——SHALL 以仓内 Markdown 文件为**唯一**真源：`src-tauri/src/harness/prompts/identity.md`、`src-tauri/src/harness/prompts/quote-reference.md` 与 `src-tauri/src/harness/prompts/workspace-reference.md`，经编译期嵌入进入程序。文件名与来源 id SHALL 一一对应（`identity` ↔ `identity.md`、`quote_reference` ↔ `quote-reference.md`，仅 `_` ↔ `-` 的命名转换不同），使「id → 文件」与「文件 → id」双向可检索；代码侧 SHALL 同时保留指向来源文件的仓内路径常量。系统 MUST NOT 在运行期从配置目录、vault 或任何外部路径读取这三段正文的覆盖内容，也 MUST NOT 在代码里保留第二份正文副本。

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

### Requirement: 输出中的 vault 路径可点击

harness 面板的 agent 输出里出现的 vault 内**文件**路径 SHALL 上屏为可点击元素。点击 SHALL 复用
既有打开链路：文件未打开时在新标签里打开（尚无文件的空文档按既有打开语义被复用），已在任一处
打开时切到既有标签，MUST NOT 产生第二个标签。已打开文件的视口与选区分档：该文件已是活跃 pane 的
**前台文档**且链接**无行号锚**时，点击 MUST NOT 改变 `scrollTop`、MUST NOT 改变选区 / caret、
MUST NOT 重新装载，MUST NOT 切换活跃 pane 或标签，只 SHALL 给该标签一次短暂导航高亮（口径见
`multi-tabs` 的「标签的短暂导航高亮」）；该文件在同 pane 的**后台标签**时 SHALL 切到该标签并恢复
它自己的滚动位置（切换文档的既有语义），并同样闪一次标签；带**行号锚**时 SHALL 打开或切到该标签
并把目标行滚入视口居中（既有行为）。链接指向**未打开**的文件时，新标签本身即反馈，MUST NOT 闪烁。
点击 MUST NOT 把焦点移入编辑器——焦点 SHALL 留在发起点击的 harness composer。正文与工具卡片的
路径按钮 SHALL 各自在**按钮级** `mousedown` 上 `preventDefault()`（MUST NOT 用容器级监听，见
REVIEW.md「标题栏 preventDefault」条的同族纪律），使鼠标按下不夺走 composer 焦点；`click`
语义与 `Enter` 激活 SHALL 不变。同一条判定 SHALL 覆盖面板正文与工具卡片两类入口，MUST NOT 为
卡片另写打开或落点语义。打开 MUST NOT 创建任何
文件——候选未命中当前 vault 的文件索引时 SHALL 保持纯文本；这条与文档内 wikilink 的「点开即创建」
语义**刻意分叉**。

vault 内**目录**路径 SHALL 同样上屏为可点击元素。点击目录 SHALL 在左栏文件树里定位该目录：展开它的
祖先链、把目录行滚进视口、并给该行一次短暂高亮。目录点击 MUST NOT 打开任何文档、MUST NOT 切换或
新建标签、MUST NOT 创建任何条目、MUST NOT 改变文件树的当前行标记、MUST NOT 改变前台文档；定位语义
细节见 `file-tree`「目录定位不动当前行」。

路径识别 SHALL 采用「候选宽、校验严」：候选字符集 SHALL 允许中文等非 ASCII 文件名（锁定为 ASCII-only
候选的实现 MUST NOT 合入），且 SHALL 识别紧贴中文行文、两侧不带空格的路径（如「见路径」「路径的」
这类写法）；候选 SHALL 支持 `:行号`、`:行号:列号` 与 `:起-止` 三种后缀（行号 1-based；列号只解析、
v1 不参与落点；`起` / `止` 是两个十进制行号、`止` MUST NOT 小于 `起`，两者之间 MUST NOT 含空白）。
畸形形态（`12-` / `-9` / `9-12-15` / `止 < 起`）SHALL 使**整个**后缀不成立：可点范围止于路径本身，
MUST NOT 只吞一半；`-` 两侧含空白（`12 - 40`）时按既有的 `:行号` 口径只吞到第一个数字（链接落到第 12
行，`- 40` 留作普通文本）——空白本来就是候选边界，这与 `路径:12 后续文字` 的既有行为同一条。
**行文标点**（句末句号 / 省略号 / 逗号 / 括号 / 引号 / 中文标点）紧跟在后缀之后时 MUST NOT 使合法后缀
失效：`路径:69.` 的可点范围 SHALL 是整段 `路径:69`（标点留作普通文本），落点与高亮照旧。**连续点号段**
之后若仍为路径延续字符（ASCII 字母 / 数字 / `_` / `-` / `/`），整个后缀 SHALL 不成立（`路径:12.5` /
`路径:12..5` / `路径:12.foo` / `路径:12.-3` / `路径:12._3` / `路径:12./3` 都按畸形后缀处理，可点范围
止于路径本身）；点号段后为串尾 / 空白 / 中文 / 其他标点时才按句末标点放行。
`起-止` 的落点 SHALL 是**起始行**（与 `:行号` 同一落点算式）；行范围 MUST NOT 成为范围选择——点击是
「去看这段在哪」而不是「把这段选起来准备改写」。

被点击的带行号链接（`路径:行号`、`路径:行号:列号`、`路径:起-止`）SHALL 额外获得一次**瞬态整行高亮**：
单行与行列形态高亮该行**整行**，行范围形态高亮 `起`…`止` 的**闭区间**。高亮 SHALL 以编辑器行装饰
（`Decoration.line`）实现，MUST NOT 以文档选区实现——选区会把随后的一次键入变成对目标段的覆盖。
高亮 SHALL 在约 1.4 秒后自动消退；同一入口再次点击 SHALL 替换现有高亮并**重置**消退计时（不叠加、
不留残影）；切换标签与关闭会话 SHALL 立即清除该高亮。高亮 MUST NOT 改变文档正文、MUST NOT 进入撤销栈、
MUST NOT 改变会话的 dirty 状态；`起` / `止` 越界时 SHALL 钳到 `1..文档行数`（与 `:行号` 越界同口径），
不报错。单次高亮的行数 SHALL 有上限（2000 行）：钳制后范围超过上限时 SHALL 只做落点、不做高亮
——MUST NOT 只画范围的前一段。

该瞬态高亮 SHALL 只由 harness 面板**正文**里的路径链接触发；面板工具卡片上的路径（结构化工具参数）、
快速打开、文档内 wikilink 锚点跳转与「跳转到行」命令 MUST NOT 产生它——这些入口沿用各自的既有行为。

**文件**候选 SHALL 仅在命中当前 vault 的文件索引、条目类型为文件、且按既有打开分类可打开（非图片 /
二进制）时链接化，行号后缀只对文件生效。**目录**候选 SHALL 仅在命中当前 vault 的**文件树目录模型**
时链接化——该判据 SHALL 与树侧定位能力使用同一份数据（文件树模型），MUST NOT 另维护一份目录索引或
第二份忽略名单；目录候选的可点范围 MUST NOT 包含行号后缀。目录引用带**单个尾斜杠**时 SHALL 可识别：
展示文本逐字保留尾斜杠，成员判定按去掉尾斜杠后的路径进行。

未命中任何索引、图片 / 二进制文件、vault 外绝对路径、含 `..` 的路径、URL 以及带空格的文件名 SHALL
保持纯文本。目录形态里，被 fs-io **不显示档**（`vault.ignore` 里档位为 `"hidden"` 的名字，默认 `.git` / `.DS_Store`）挡住因而
在树模型里没有行的目录、树模型里不存在的目录（含惰性目录之下本会话从未取回的目录）SHALL 保持纯文本；
命中**惰性档**（`vault.ignore` 里档位为 `"lazy"` 的名字，默认含 `node_modules` / `target` / `dist` 等）或用户规则的目录在树模型里
有行，因此与其他目录同口径可点。候选来自模型输出，按不可信输入处理：
面板 MUST NOT 依据候选自行拼文件系统路径或放宽边界校验——打开 MUST 复用既有打开链路的 vault 内路径
约束，定位 MUST 复用文件树的模型内路径约束。目录定位在路径不可达时（惰性祖先取数失败、定位前刚被
删除）SHALL 是空动作，MUST NOT 产生错误提示或半截展开现场。

链接化范围 SHALL 覆盖段落、标题、列表项、引用块、表格 cell 的纯文本与**行内代码**；围栏与缩进代码块
里的路径 MUST NOT 链接化（保留代码的复制与选择语义）；锚元素内部的文本 MUST NOT 再次链接化
（MUST NOT 产生嵌套锚）。

工具调用卡片上由**结构化工具参数**取得的路径 SHALL 同样可点击：Read / Create / Patch / Delete 的
`path`、Move 的源与目标、以及 diff 头里的文件名；Read 的 `offset`（1-based）SHALL 作为点击后的落点
行。卡片路径与正文使用**同一份**目标类型判定：解析为文件的走既有打开链路（已打开切既有标签、
未打开新标签）再按 `offset` 落行，解析为目录的走「左栏定位」。MUST NOT 对卡片上的任意文本做路径正则——参数摘要被截断而解析不出结构化路径时，卡片
保持原样且不可点。恢复渲染（快照 / 会话恢复）的工具行 SHALL 与 live 行同口径。卡片路径的打开与
视口落点 SHALL 与正文路径同一条判定——已在前台且无行号锚时保持位置、后台标签恢复自身位置并闪一次、
未打开时新标签不闪；MUST NOT 为卡片另写一条打开语义。卡片路径带 `offset` 时 SHALL 只滚动落行，
MUST NOT 产生瞬态行高亮（高亮只由正文路径链接触发，既有禁令不变），标签照常闪一次；这条与正文
行锚的「滚动 + 行高亮」**刻意分叉**，不得为了「同一条判定」把卡片高亮加回来。

**文件**点击造成的视口位移 SHALL 按阅读位置合同 CL-2 开「应用推动视口」的让位窗口：跳转的「中间态 →
目标位置」两拍内到达的滚动事件 MUST NOT 被阅读位置捕获；窗口边界 MUST NOT 由时长量定义。TOC 跳转与
harness 路径跳转 SHALL 使用同一捕获语义。目录点击只滚左栏、不触编辑器视口，CL-2 不适用于目录定位。
无行号锚的前台点击不产生任何视口位移（不滚、不重载），CL-2 不适用——没有需要保护的中间态。

#### Scenario: 正文里的 vault 路径点开为新标签

- **WHEN** agent 回复的正文里出现一个存在于 vault 的文件路径（含中文文件名），用户点击该路径
- **THEN** 该文件在活跃 pane 的一个新标签里打开并成为前台；当前标签的内容不被替换

#### Scenario: 行号锚定到目标行

- **WHEN** agent 回复里写作 `路径:行号`（或 `路径:行号:列号`），用户点击该路径
- **THEN** 文件打开后目标行被滚入视口并居中，该整行同时获得一次瞬态高亮（列号只解析、不参与落点，
  也不收窄高亮范围）；行号越界时按编辑器既有口径钳到末行且不报错，高亮随之落在钳制后的行上

#### Scenario: 行范围锚定到起始行

- **WHEN** agent 回复里写作 `路径:起-止`（如 `notes/plan.md:120-140`），用户点击该路径
- **THEN** 文件在新标签打开并把第 `起` 行滚入视口居中（落点与 `:行号` 同一算式：折叠光标落在该行
  行首）；第 `起`…`止` 行（闭区间，两端都含）同时获得一次瞬态整行高亮；文档正文 MUST NOT 被改变，
  选区 MUST NOT 成为范围选择（高亮是行装饰，不是选区）；`止` 越界时同样不报错

#### Scenario: 行范围高亮是闭区间

- **WHEN** 用户点击 `路径:12-40`
- **THEN** 第 12 行到第 40 行都带高亮，第 11 行与第 41 行不带；同一时刻只有这一处高亮

#### Scenario: 重复点击替换高亮并重置消退计时

- **WHEN** 高亮尚未消退时用户再次点击同一条带行号的路径，或点击另一条带行号的路径
- **THEN** 旧高亮被这次点击的高亮整块替换（不叠加、不残留旧行），消退计时从这次点击重新起算

#### Scenario: 切标签清除行高亮

- **WHEN** 行高亮还在时用户切到另一个标签，或关闭该会话
- **THEN** 高亮立即从原文档消失；切回原标签时不残留

#### Scenario: 高亮不改正文、不进撤销栈、不碰 dirty

- **WHEN** 一次带行号的路径点击完成（高亮在场）
- **THEN** 文档正文逐字节不变、撤销栈深度不变、会话 dirty 状态不变

#### Scenario: 超大范围只落点不高亮

- **WHEN** 链接的行范围在钳制到文档行数后超过 2000 行
- **THEN** 落点照常（起始行滚入视口并居中），但不画行高亮——MUST NOT 退化成只画范围的前一段

#### Scenario: 工具卡片路径点击不产生行高亮

- **WHEN** 用户点击工具卡片上的文件路径（含 Read 带 `offset` 的路径）
- **THEN** 按既有口径打开并落行，但不产生瞬态行高亮（高亮只由正文路径链接触发）

#### Scenario: 畸形行范围不吞半截

- **WHEN** 回复写作 `notes/plan.md:12-`、`notes/plan.md:-9` 或 `notes/plan.md:9-12-15`
- **THEN** 整个后缀不成立：可点范围止于路径本身、不产出任何行落点；`止` 小于 `起`（如
  `notes/plan.md:40-12`）时同样不产行落点，MUST NOT 反向钳成一个合法范围

#### Scenario: 句末标点不吞行号后缀

- **WHEN** 回复写作 `design.md:69.`（句末英文句号）或 `design.md:69-72.`（行范围 + 句号）
- **THEN** 行号后缀成立：可点元素的名字是整段 `design.md:69` / `design.md:69-72`（句号留作普通
  文本，MUST NOT 退化成裸路径 `design.md`）；点击落到第 69 行并给一次瞬态高亮，行范围按闭区间
  高亮 69…72

#### Scenario: 点号段后接路径字符仍是畸形后缀

- **WHEN** 回复写作 `a.md:12.5`、`a.md:12..5` 或 `a.md:12.foo`
- **THEN** 连续点号段之后仍是路径延续字符：整个后缀不成立，可点范围止于 `a.md`，不产任何行落点

#### Scenario: `-` 两侧含空白时按既有行号口径

- **WHEN** 回复写作 `notes/plan.md:12 - 40`（`-` 两侧各有一个空格）
- **THEN** 空白是候选边界：可点范围为 `notes/plan.md:12`（点击落到第 12 行），` - 40` 保持普通文本
  ——与 `notes/plan.md:12 后续文字` 的既有行为一致

#### Scenario: 已打开的文件不重复开标签

- **WHEN** 被点击的路径对应的文件已在某个标签里打开
- **THEN** 只切到既有标签（跨 pane 时按既有语义移动标签）并执行行定位；标签总数不变

#### Scenario: 前台文档的裸路径点击保持位置

- **WHEN** 目标文件已是活跃 pane 的前台文档，回复里写作不带行号的路径，用户点击该路径
- **THEN** `scrollTop`、选区与 caret、文档正文逐字节、标签总数与活跃 pane 全部不变；该文件
  MUST NOT 重新装载（撤销栈与 dirty 状态不动）；该标签 SHALL 闪一次；焦点仍在 harness composer

#### Scenario: 后台标签的裸路径点击恢复自身位置

- **WHEN** 目标文件在同一 pane 的后台标签（它离开前台时停在文档中部），回复里写作不带行号的
  路径，用户点击该路径
- **THEN** 切到该标签并恢复它自己的滚动位置（MUST NOT 重置到篇首），该标签闪一次；标签总数不变

#### Scenario: 未打开的路径点击开新标签且不闪

- **WHEN** 目标文件尚未打开，用户点击一条不带行号的路径
- **THEN** 新标签打开该文件并成为前台；新标签 MUST NOT 闪（新标签本身即反馈）

#### Scenario: 行锚点击仍滚动并高亮

- **WHEN** 目标文件已在前台且停在别处，用户点击**正文**里的 `路径:行号`（或 `路径:起-止`）
- **THEN** 目标行照旧滚入视口居中并获得瞬态整行 / 闭区间高亮（既有行为）；该标签同时闪一次；
  文档正文、选区口径与 dirty 状态按既有行锚条款不变。工具卡片带 `offset` 不适用本场景，按
  「工具卡片路径适用同一判定」只滚动、不高亮

#### Scenario: 路径按钮按下不夺 composer 焦点

- **WHEN** 用户在正文路径按钮或工具卡片路径按钮上按下鼠标，随后完成点击
- **THEN** 按钮级 `mousedown` 的 `preventDefault()` 生效，焦点全程留在 harness composer 的
  `.cm-content`；`click` 照常触发打开 / 闪烁；同一按钮的 `Enter` 激活仍可用（键盘可达性不变）。
  正文与卡片各测一例，MUST NOT 用容器级监听代替

#### Scenario: 工具卡片路径适用同一判定

- **WHEN** 用户点击工具卡片上一条不带行号、且目标已是前台文档的路径（如 Read 的 `path`）
- **THEN** 与正文裸路径同口径：不滚、不动选区、不重载，只闪标签；卡片路径带 `offset` 时滚动
  到落点行，但 MUST NOT 产生瞬态行高亮（沿用「工具卡片路径点击不产生行高亮」的既有禁令），
  标签同样闪一次

#### Scenario: 目录引用点开在左栏定位

- **WHEN** agent 回复里出现一个存在于 vault 树模型的目录路径，用户点击它
- **THEN** 左栏文件树展开该目录的全部祖先（目标行出现在可视区并滚进视口），该行获得一次短暂高亮；
  目标目录自身的展开 / 折叠状态不被改变

#### Scenario: 目录定位不打开文档、不切标签、不创建条目

- **WHEN** 当前有打开中的文档与若干标签，用户点击一条目录引用
- **THEN** 标签总数与前台标签不变、编辑器内容与视口不变、vault 内不产生任何新条目；文件树的当前行
  标记也不变（目录行不会成为「当前行」）

#### Scenario: 目录引用的边界形态保持纯文本

- **WHEN** 正文里的路径指向被不显示档挡住的目录（默认如 `.git`）、或惰性目录之下本
  会话从未取回的目录、或是 vault 外绝对路径 / 含 `..` 的路径
- **THEN** 该文本保持纯文本，不产可点击元素；点击它不触发任何动作

#### Scenario: 尾斜杠目录引用

- **WHEN** agent 回复写作 `目录路径/`（单个尾斜杠），且去尾斜杠后的路径是树模型里的目录
- **THEN** 该文本可点，可见文本逐字保留尾斜杠；点击按去尾斜杠后的路径定位；`a/b//` 这类多尾斜杠
  不识别，保持纯文本

#### Scenario: 目录引用带行号后缀时只链接路径本身

- **WHEN** agent 回复写作 `目录路径:12`
- **THEN** 可点范围止于目录路径本身（`:12` 留作普通文本）；点击只做左栏定位，不带任何行落点语义，
  也不产生行高亮

#### Scenario: 不存在的路径与目录保持纯文本

- **WHEN** 正文里的路径既不命中当前 vault 的文件索引、也不命中文件树的目录模型（含不存在的路径与
  目录）、或指向图片 / 二进制文件、或是 vault 外绝对路径 / 含 `..`
- **THEN** 该文本保持纯文本，不产可点击元素；点击它不触发任何打开或定位动作

#### Scenario: 行内代码在列、代码块不在列

- **WHEN** 同一段回复里，路径分别写在行内代码与围栏代码块里
- **THEN** 行内代码里的路径（文件或目录）可点；围栏代码块里的同形文本保持代码原文、不可点

#### Scenario: 锚内文本不产嵌套锚

- **WHEN** 模型输出 `[说明](https://example.com)` 这类 Markdown 链接，其显示文本里含 vault 路径
- **THEN** 链接按既有外链语义渲染，其显示文本内部不再产第二个可点元素

#### Scenario: 工具卡片路径可点

- **WHEN** 工具调用卡片上显示 Read 的 `path`（参数里带 `offset`）或 diff 头里的文件名
- **THEN** 该路径可点击：解析为文件的走既有打开链路（已打开切既有标签、未打开新标签）并按
  `offset` 落行（只滚动，不产生行高亮）；解析为目录的走「左栏定位」；参数摘要被截断、解析不出
  路径的卡片不可点

#### Scenario: 跳转不覆盖阅读位置（CL-2）

- **WHEN** 用户点击一条带行号的文件路径，跳转过程产生中间态滚动（含篇首或负值形态），随后越过阅读
  位置的防抖窗口
- **THEN** 阅读位置捕获 MUST NOT 记录中间态；最终记录的是用户实际停留的目标行（或窗口前用户自己
  的位置，若用户未继续操作）

### Requirement: 路径引用纪律

会话的系统上下文 SHALL 注入一段「路径引用纪律」固定段（与「摘录引用的回指纪律」同构）。该段 SHALL
要求 agent：引用 vault 内文件时写**完整的 vault 相对路径并带扩展名**；指向具体位置时带 `:行号`
（必要时 `:行号:列号`）；引用**一段连续行**时带 `:起-止`（如 `:120-140`，两端的行号都取自你实际读到
的位置，MUST NOT 凭印象编一个范围）；**只引用工具结果里真实出现过的路径**，不凭记忆拼路径；MUST NOT 用 Markdown
链接语法（`[文字](路径)`）包裹 vault 相对路径——该语法在面板里按外链处理，点击不会打开文件；引用
目录时说清是目录，不写成文件路径。装配清单 SHALL 为该固定段记一条来源条目（与既有固定段同口径：
无单一文件来源、`exists:true`、字节数为注入文本长度）。

该纪律的**遵从度** SHALL 按抽样观察验收，MUST NOT 写成机器断言：验收套件跑在 mock provider 上，
固定 fixture 代表不了真实模型的书写习惯。

#### Scenario: 纪律段注入与装配清单

- **WHEN** 建立一个新会话
- **THEN** 系统上下文包含路径引用纪律段（完整相对路径 + 扩展名、`:行号`、`:起-止` 行范围、只引用真实
  出现过的路径、不用 Markdown 链接语法）；`session_open` 的装配清单含该固定段的来源条目

#### Scenario: 抽样观察（人工，不作机器判据）

- **WHEN** 用真实 provider 跑一轮 dogfood 提问，让 agent 引用一个 vault 文件
- **THEN** 人工抽样回复里的路径写法（完整相对路径 + 扩展名、带行号、只引用工具结果里出现过的路径）；
  不满足时作为 prompt 迭代输入，MUST NOT 据此判本次实现失败

### Requirement: Chat Completions 方言

kimi provider 在 `wire_api = "chat_completions"` 时 SHALL 走 Chat Completions 形态：`POST {base_url}/chat/completions`，请求体为 `{model, messages, tools, tool_choice:"auto", stream:true, stream_options:{include_usage:true}}`（工具集为空——如压缩调用——时 `tools` 为空数组、`tool_choice` 照发：端点接受该形态，见 6.4 探针 S1b；`system` 为空时不发 `{role:"system"}` 消息——空文本会被端点 400）；**模型声明支持思考档位时** SHALL 另带 `thinking:{type:"enabled", effort, keep:"all"}`，未声明时 MUST NOT 发该字段；MUST NOT 发 `include` / `store` / `reasoning` / `max_tokens` / `max_completion_tokens` 字段。会话内部历史（`Session.input`）SHALL 保持既有 Responses item 形态不变——items → messages 的翻译 SHALL 发生在发送边界的单一构造点（`wire_body` 与 `wire_body_bytes` 共用一份构造，纪律同 Responses 侧），MUST NOT 改写留存项。翻译规则：system 为首条 `{role:"system"}` 消息；reasoning 项的明文 SHALL 折叠进**其后第一条 assistant 消息**的 `reasoning_content`（多段拼接；带 `tool_calls` 的 assistant 消息同样 SHALL 携带——该端点对缺失 `reasoning_content` 的 tool 调用消息返回 400）；一轮的 N 个 function_call SHALL 合并为**单条** `{role:"assistant", tool_calls:[...]}` 消息（该轮若还有正文，正文 SHALL 并入同一消息的 `content`——chat 一轮只有一条 assistant 消息，两条并存会让 `tool_calls` 那条缺 `reasoning_content`；无正文时 `content` 为 null），其后 SHALL 紧随 N 条 `{role:"tool", tool_call_id}` 消息、中间 MUST NOT 插入其它消息；`input_image` 附件 SHALL 译为 `image_url` content part（展开点不变）；悬空 function_call（恢复边界：无配对 output）SHALL 在翻译时丢弃并落诊断记录。usage SHALL 映射到既有读数结构（`prompt_tokens`→`input_tokens`、`cached_tokens` 或 `prompt_tokens_details.cached_tokens`→`cached_tokens`、`completion_tokens`→`output_tokens`、`cache_write_tokens` 记 0），ctx% / cache% 读数口径与 Responses 方言一致。超限判定 SHALL 命中 chat 方言文案（`token limit` / `total message size` / `supports only 256k context`），触发与 Responses 方言同一套「自动压缩 + 重试一次」兜底。错误路径的 HTTP 面诊断（`http_status` / `raw_body` / `request_id`）SHALL 与 Responses 方言同一份。

#### Scenario: 发送形状

- **WHEN** kimi provider 配置 `wire_api = "chat_completions"` 并完成一轮对话
- **THEN** 请求发往 `{base_url}/chat/completions`，body 为 messages 形态（system 居首）；声明支持思考档位的模型带 `thinking` 字段；body 不含 `include` / `store` / `max_tokens` 字段

#### Scenario: reasoning 回放折叠

- **WHEN** chat 方言下历史含 reasoning 项（含模型只发工具调用、无正文的轮次）
- **THEN** 该轮 reasoning 明文折叠进其后第一条 assistant 消息的 `reasoning_content`；带 `tool_calls` 的 assistant 消息同样携带 `reasoning_content`

#### Scenario: 工具调用配对顺序

- **WHEN** chat 方言下一轮产生多个工具调用
- **THEN** 请求历史中是单条含 `tool_calls` 的 assistant 消息、紧随每个 call 各一条 `tool` 消息，其间无其它消息

#### Scenario: usage 读数映射

- **WHEN** chat 方言下完成一轮带 usage 的对话
- **THEN** 控制行与气泡读数由映射后的 usage 产出，与 Responses 方言同一份 `UsageSnapshot` 口径（含绝对值键与事件/快照同键同值不变量）

#### Scenario: 超限兜底

- **WHEN** chat 方言返回上下文超限类错误（`token limit` / `total message size` / `supports only 256k context` 文案）
- **THEN** 系统自动压缩并重试该轮一次；仍失败才向面板报错

#### Scenario: 跨方言恢复续聊

- **WHEN** 恢复一份 Responses 时期留存的会话（`session_open` 无 `wire_api` 或值为 `responses`），随后以 chat 方言续聊
- **THEN** 发送的 messages 由留存 items 经翻译层产出，留存 JSONL 不被改写；恢复充分性判据在两种方言下各自成立

#### Scenario: 缺省行为不变

- **WHEN** 配置未写 `wire_api`（或显式 `responses`）
- **THEN** 请求形状、字段集与行为与既有 Responses 方言逐字节一致

### Requirement: 面板块级全屏钮的锚点

harness 面板里，表格块的全屏触发钮 SHALL 锚定在**表格自身可视盒**的右上角内侧（`right` / `top`
各 6px），MUST NOT 悬在面板正文的右缘：表格所在的定位容器 SHALL 贴合表格的自然宽（上限为面板正文宽），
窄表因此钮随表可见、与表之间不隔空白。代码块的全屏钮 SHALL 保持整行锚点（块底色铺满面板正文宽，
其右缘即块可视盒右缘），MUST NOT 因本条款改为随内容宽收缩。钮的形态、图标、读屏名、出现时机与
点击行为沿用既有条款——本条款只改锚点，MUST NOT 引入第二套位置 class 或新的尺寸值。

#### Scenario: 窄表

- **WHEN** 面板消息里有一张自然宽明显窄于面板正文宽的表格，指针悬停该表
- **THEN** 全屏钮出现在表格右缘内侧 6px（定位容器的右缘与表格右缘相差 ≤1px），点击仍打开该表的全屏遮罩

#### Scenario: 宽表与代码块

- **WHEN** 表格自然宽达到或超过面板正文宽 / 指针悬停一个代码块
- **THEN** 表格的定位容器以面板正文宽为上限（不溢出、宽表行为与改动前逐值相同）；代码块的定位容器仍与面板正文同宽

### Requirement: 图片摘录到对话

图片 SHALL 与文本一样能作为摘录来源进入对话输入区，且**一个来源、同一协议**：由本能力插入的图片附件与
粘贴进来的图片卡片 SHALL 走完全相同的附件数据模型与投递协议（参与 `Image N` 编号、可 `@` 引用、可经移除钮删除、
投递时携带结构化标签、transcript 同构沉淀、快照恢复同一 round-trip）——MUST NOT 为摘录来源另立附件类型、编号
规则或投递字段。

**入口一：图片上的引用钮**。文档内**终态渲染出的**图片（已产出 `<img>` 的引用）SHALL 在悬停其可视盒时
浮现「Quote to chat」浮钮（与文本选区摘录钮同一文案、同一形态家族与同一钳制口径：钮整体 MUST 落在触发
它的 pane 可视区内，见既有「浮动操作钮钳制」口径）。点击 SHALL 把该图片作为图片附件插入对话输入区；面板
未打开时 SHALL 先打开面板再插入（与文本摘录同一条路径）。**加载中 / 读取失败 / 终态不可见**三类占位
没有 `<img>`，因此 MUST NOT 出现引用钮——「占位不可引用」是结构性事实，MUST NOT 靠一条需要维护的开关。

**入口二：跨图片的选区**。在编辑器 pane 中选中一段内容、且选区内含已渲染图片时，一次文本摘录手势
SHALL 产出「文本引用卡片 + 按文档序的图片附件」：卡片在前（保持既有卡片数据与语义不变），图片附件紧随其后、
按图片在选区内的出现顺序排列。整次插入 SHALL 是**一个**结构编辑步（一次撤销即撤掉整次引用）。选区内
**只有图片、没有文字**时 MUST NOT 生成文本引用卡片（`lines` / 摘录原文必填且空文本卡片在失锚链上无
意义），只插入图片附件。选区内解析不到 / 不存在的图片 SHALL 被跳过且 MUST NOT 阻断同一次引用的其余部分。
同一选区内同一路径的图片 MUST NOT 重复插入。

**来源与隐私**：引用 SHALL 只**读取** vault 内源文件，MUST NOT 改写源文件、MUST NOT 在 vault 内产生
任何新条目；字节 SHALL 落 harness 侧存储（内容寻址、去重即同文件）。人侧 SHALL 能看见图片来自哪个文件
（卡片缩略图的悬停提示含来源的 vault 相对路径）；投递给模型的内容 MUST NOT 因本能力新增来源字段或路径
文本——模型侧看到的仍是图片与 `Image N` 标签，与粘贴图片一致。

**格式与失败**：可引用的来源格式 SHALL 以 harness 侧图片写入的格式表（下称「可引用格式表」）为唯一
判定面——表内子类型按该表既有的转换规则入库（`png` 无损转 WebP、`jpeg` / `webp` 原样），表外子类型
拒绝。不支持的格式（可引用格式表之外的子类型）、超过 50MB 上限、读取或写入失败 SHALL 给人话 toast
说明原因，MUST NOT 插入卡片后留破图、MUST NOT 静默失败。一次引用含多张图时，单张失败 MUST NOT 回滚
其余已成功的插入（失败张数与原因由 toast 说明）。

图片是发送期能力：模型未声明视觉能力时，含图片的消息 SHALL 按既有「模型图片能力声明」条款拒绝发送，
不被本能力放宽。

#### Scenario: 悬停图片出现引用钮并插入图片块

- **WHEN** 文档里一张已渲染的图片被指针悬停，用户点击浮现的「Quote to chat」钮
- **THEN** 对话输入区出现该图片的图片卡片（可见缩略图、编号 `Image 1`）；vault 目录零新增或修改；
  输入区可直接继续输入问题

#### Scenario: 选区跨文字与图片时卡片与图片一起进入

- **WHEN** 用户选中一段文字、其中间含一张已渲染图片，点击文本摘录钮
- **THEN** 输入区依次出现「引用卡片（含该段文字与行范围）」与「该图片的图片附件」；附件顺序按文档序；
  一次 ⌘Z 同时撤掉卡片与图片

#### Scenario: 选区只有图片时不造空卡片

- **WHEN** 用户选中恰好覆盖一张图片的范围（无文字），点击摘录钮
- **THEN** 输入区只出现图片附件，MUST NOT 出现空文本的引用卡片

#### Scenario: 占位不可引用

- **WHEN** 文档里的图片引用处于加载中、读取失败或终态不可见（占位块）状态，指针悬停其上
- **THEN** MUST NOT 出现引用钮；该引用在选区摘录里也不产生图片附件

#### Scenario: 不支持的格式与部分失败

- **WHEN** 用户引用一张可引用格式表之外的图片（如 `gif`），或一次选区引用中含 2 张图而其中 1 张超过
  50MB
- **THEN** 不支持的格式给一次人话 toast 且不插卡片；部分失败时其余图片照常插入，toast 说明失败张数与
  原因，输入区不出现破图卡片

#### Scenario: 引用不改 vault、模型侧看不到来源路径

- **WHEN** 引用一张 vault 内图片并发送
- **THEN** vault 内文件逐字节不变、无新增条目；harness 侧存储出现该图的内容寻址文件；发送的
  content parts 里该图只带 `Image N` 标签与图片内容，MUST NOT 出现 vault 路径文本

### Requirement: 引用失败的留痕与引用语境反馈

图片引用失败的处置 SHALL **持久可见**，MUST NOT 只有一次瞬态 toast：一次引用里失败了几张，
人侧 MUST 能在输入区（引用卡片的出处行，或没有文本卡片时的输入区状态行）读到「N 张图片未能
引用」这一读数，且该读数 MUST 存活到下一次引用 / 发送 / 切会话，MUST NOT 随几秒后自动消隐。
读数 SHALL 只存在于呈现层：MUST NOT 进卡片数据模型、MUST NOT 进序列化 / 投递载荷 / 草稿。

引用路径的失败人话 SHALL 按**调用点**分码：粘贴语境与引用语境的同一失败原因可以有不同措辞，
引用路径拿到的格式不支持提示 MUST NOT 使用剪贴板语境的说法（「剪贴板」二字）。失败项 SHALL 与
成功项一起返回给调用方（同一结果集合、保持输入序），单张失败 MUST NOT 回滚已成功的插入；失败
SHALL NOT 产出图片卡片。可引用格式的判定 SHALL 在读取 vault 字节与写入 harness 存储**之前**
生效（不可引用的格式不产生后端调用）；后端写入原语仍是最后一道闸，其拒绝按同一引用语境措辞。

#### Scenario: svg 引用失败

- **WHEN** 在文档里点一张 `svg` 图片的「引用」钮（预览能渲染、可引用格式表里没有）
- **THEN** toast 的文案是引用语境的说法（含 `image/svg+xml`、不含「剪贴板」），输入区出现
  「1 张图片未能引用」的持久状态行，composer 里不出现图片卡片；读 vault 与写 harness 两条
  命令都没有发出

#### Scenario: 多图引用部分失败

- **WHEN** 选区里有两张图，其中一张的格式不可引用
- **THEN** 引用卡片与可引用的那张图片附件照常插入（一个撤销步），卡片出处行同时显示
  「1 张图片未能引用」；撤销一次撤掉整次引用，该读数随卡片一起消失

#### Scenario: 留痕的收口

- **WHEN** 一次引用失败留下的输入区状态行在场，用户随后发送这条消息（或新建会话 / 切 vault）
- **THEN** 状态行收起，MUST NOT 留到下一段输入上；卡片上的读数属卡片自身，随卡片存在

### Requirement: 引用卡片的含图读数

引用卡片的出处行 SHALL 显示「含 N 张图片」这一**派生读数**（摘录原文里能渲染成图片的引用数），
其中 N 的判据 SHALL 与选区图片枚举同源（标准 Markdown 图片 + `![[…]]` 嵌入；代码上下文、
表格内、远程 http(s) 引用与非图片扩展不计；同一目标只计一次）。该读数 SHALL 由摘录原文现算，
MUST NOT 写入卡片数据模型、MUST NOT 进序列化 / 投递载荷 / 草稿（失锚链的前缀校验依赖摘录原文
逐字不变）。N 为 0 时 MUST NOT 显示该读数；卡片几何 SHALL 保持既有形态（读数接在既有出处行内，
不新增行）。

#### Scenario: 摘录里含图片

- **WHEN** 跨文字与 `![[pic.png]]` 做一次摘录
- **THEN** 引用卡片的出处行显示「含 1 张图片」与出处（文档名 · 最近一级标题），投递载荷里
  只有既有的 `<quote>` 文本与图片 part——没有这个读数的任何痕迹

#### Scenario: 不可引用的格式也计数

- **WHEN** 摘录原文里是 `![[logo.svg]]`
- **THEN** 角标显示「含 1 张图片」（读数描述摘录里有什么），引用失败另由失败留痕显示

### Requirement: 会话名回落口径（首个问题段落）

会话名的回落素材（未生成标题时的显示值、历史浮层行名、恢复会话的初值）SHALL 取该会话**首个
非空问题段落**：MUST NOT 包含序列化元素（`<quote>` / `<msg-quote>` / `<image …/>` 卡片元素），
MUST NOT 携带 XML 转义的残留（实体 SHALL 还原成原文），空白 SHALL 折叠成单空格并去首尾。
该口径 SHALL 在**前端活态路径与后端留存读取两处逐条相同**（同一份素材得到同一个期望值，由
共享 fixture 钉住）。会话已有有效标题时 SHALL 显示标题，MUST NOT 回落到首条用户消息。

标题事件到达时，标题栏的会话名 SHALL 即时更新，已打开的历史浮层里**当前会话那一行** SHALL
原地更新为新标题（不重开浮层、不跳位置）；历史浮层与恢复会话 MUST NOT 显示序列化元素或它的
任何前缀。

#### Scenario: quote 会话的回落名

- **WHEN** 一条以「引用卡片 + 提问」组成的第一条用户消息落盘，该会话尚无标题
- **THEN** 后端返回的首条用户消息素材是提问段落原文（不含 `<quote`、不含 `&amp;` 一类转义
  残留），浮层行名与恢复后的标题栏显示同一段文本

#### Scenario: 标题到达后行名跟着改

- **WHEN** 历史浮层正打开、当前会话行的名还是回落值，此时 `title` 事件带着有效标题到达
- **THEN** 标题栏会话名与浮层里那一行同时改为标题；其它行不受影响

#### Scenario: 标题已存在

- **WHEN** 打开历史浮层，某会话的留存里已有有效标题
- **THEN** 该行显示标题，MUST NOT 显示首条用户消息作为回落名

### Requirement: SVG 引用的栅格化成功路径

引用一张 `svg` 图片 SHALL 与引用位图走**同一条**链路、无分支差异：格式预检放行、读 vault 字节
与写 harness 存储两条命令照常发出、写入口把 SVG 栅格化成位图后落盘。引用结果里的图片卡片 SHALL
引用**位图**内容寻址名（`pasted-<hash16>.webp`），MUST NOT 引用 SVG 文件名或 SVG 字节；卡片
元信息（宽高）SHALL 取自栅格化产物的像素尺寸。卡片的数据模型、序列化、投递 parts、留存形状
MUST NOT 为 svg 新增字段或第二种形态（图片附件只有一种形态）。

引用 svg **成功**时 MUST NOT 产生失败留痕（无「N 张图片未能引用」状态行）与格式不支持提示；
D585 / D586 的失败面 SHALL 保留给**真正不支持**的格式（可引用格式表之外的扩展名，如 gif）。
栅格化自身失败（畸形 SVG / 画布尺寸非法）SHALL 按写入口既有错误码族回落，只报该张、不产卡片、
不回滚同批次已成功的引用。

#### Scenario: 引用文档里的 svg

- **WHEN** 在文档里点一张 `svg` 图片的「引用」钮
- **THEN** composer 出现图片卡片，卡片引用名是 `pasted-<hash16>.webp`（位图）、带 `@` 插入引用
  钮；输入区没有「N 张图片未能引用」状态行，也没有「暂不支持引用该格式」提示；读 vault 与写
  harness 两条命令各发一次

#### Scenario: 真不支持的格式仍走失败面

- **WHEN** 点一张可引用格式表之外的图片（如 `gif`）的「引用」钮
- **THEN** 格式预检在 IPC 之前失败：toast 是引用语境的人话（D585，含该 MIME、不含「剪贴板」
  字样），输入区留下持久的「1 张图片未能引用」（D586），composer 不出现图片卡片，读 vault 与
  写 harness 两条命令都没有发出

#### Scenario: svg 栅格化失败

- **WHEN** 引用的 svg 是畸形 XML（或画布尺寸非法）
- **THEN** 该张只报一条失败读数（走既有错误码族的人话），不产图片卡片；同批次里其它可引用的
  图片照常插入，一次撤销仍撤掉整次引用

### Requirement: 对话里的代码块与表格全屏查看

harness 面板里**终态渲染出的**围栏 / 缩进代码块与表格 SHALL 可进入应用内全屏查看，形态与 content pane
的同类能力一致：每个这类块 SHALL 在其可视盒悬停时浮现一个全屏钮（与文档内块级动作钮**同一形态家族**：
同一壳 / 尺寸 / 热态 / eink 规则，同一「钮整体落在触发面板可视区内」的钳制口径；可聚焦、Enter 触发），
点击 SHALL 打开全屏遮罩。钮 SHALL 只挂在真正渲染出的块上——尚未闭合的围栏块（**没有尾 `CodeMark`
节点**的 `FencedCode`；@lezer/markdown 把未闭合围栏同样解析成 `FencedCode`，闭合与否的判据因此是那个
尾节点）MUST NOT 出现钮。该判据是解析事实，MUST NOT 靠一条需要维护的开关判定。

全屏内容 SHALL 复用既有两条能力的口径，MUST NOT 为面板另立一套呈现：

- **表格**：按 content pane 表格全屏的同一口径呈现（打开那一刻渲染态表格的只读快照副本、按自然尺寸 +
  双向滚动、克隆里不出现任何钮副本）；
- **代码块**：按 content pane 代码块全屏的同一口径呈现（整块源码按行 + 头部条 + 着色 token；超过既有
  单块着色上限时降级为单块纯文本，阈值 MUST NOT 另立）。

关闭路径 SHALL 与既有遮罩完全一致：`Esc`、点击遮罩、再次触发（toggle 语义）、焦点离开兜底，以及**内容
换代**（会话切换 / 面板重载 / 快照恢复导致消息被整体替换）时的显式关闭。关闭后焦点 SHALL 回到发起它的
harness 面板（触发钮仍在 DOM 时回到该钮，否则回到输入区），MUST NOT 交给编辑器。

**流式口径**：消息仍在生长时打开的全屏 SHALL 是**打开那一刻的快照**——后续增量 MUST NOT 灌进遮罩
（MUST NOT 出现一半新一半旧的内容），遮罩 MUST NOT 因底层重渲而静默清空。关闭后再次打开 SHALL 显示
当时的最新内容。

全屏查看 SHALL 是结构性只读：遮罩内容不带事件监听、不在面板的输入子树内；打开与关闭 MUST NOT 改动消息
文本、MUST NOT 改动会话留存、MUST NOT 触发发送或复制。块的既有交互（路径链接、图片放大、摘录手势）在
面板内 SHALL 逐条不变。

#### Scenario: 代码块的全屏入口与内容

- **WHEN** 面板里一条回复含围栏代码块，指针悬停该块并点击浮现的全屏钮
- **THEN** 打开全屏遮罩，内容为该块的整块源码（按行、含头部条与着色 token，文本与块内原文逐字相同）；
  遮罩读屏名与文档内同一词条；再次触发同一个钮（或按 Esc / 点击遮罩）关闭并回到面板

#### Scenario: 表格的全屏入口与内容

- **WHEN** 面板里一条回复含表格，点击其全屏钮
- **THEN** 遮罩按自然尺寸显示该表（放不下时双向滚动），表格文本与面板内逐 cell 相同；快照内不出现
  全屏钮副本；关闭路径与代码块相同

#### Scenario: 流式生长期间打开得到快照

- **WHEN** agent 回复仍在流式生长，用户对其中已闭合的代码块打开全屏，随后回复继续增长
- **THEN** 遮罩内容停在打开那一刻（不追加新文本、不清空）；关闭后再打开显示最新内容

#### Scenario: 内容换代时遮罩自动关闭

- **WHEN** 全屏遮罩打开期间切换会话（或面板重载导致消息被整体替换）
- **THEN** 遮罩关闭并把焦点交还面板，MUST NOT 停在一份已不存在的内容上

#### Scenario: 围栏未闭合时没有入口

- **WHEN** 回复正在流式输出一个尚未闭合的围栏块（`FencedCode` 尚缺尾 `CodeMark` 节点）
- **THEN** 该片段不出现全屏钮；围栏闭合（尾 `CodeMark` 到场）、块成为终态的那一帧起钮出现

#### Scenario: 全屏不改动任何内容

- **WHEN** 打开并关闭代码块 / 表格全屏
- **THEN** 消息文本、会话留存与配置逐字节不变；不产生任何发送、复制或文件写入

### Requirement: 引用路径解码失败的文案

引用路径（vault 图片 → harness 存储）的**解码失败** SHALL 上屏引用语境的人话：该文案 MUST NOT
出现「剪贴板」（英文列 MUST NOT 出现 "clipboard"），MUST NOT 与格式不支持的文案混用——解码失败
说的是「格式支持，但这份字节解不开（不是合法图片 / SVG 解析失败 / 画布尺寸非法）」，格式不支持
说的是「这种格式还不支持」。两条文案 SHALL 互不为子串，使人侧一眼能分辨「换一张图就好」与
「这个格式现在做不到」。

错误码 SHALL 保持单一一族：MUST NOT 为引用语境新增后端 code。语境差异 SHALL 由前端在**调用点**
渲染——同一个 `attachment_decode_failed` 在粘贴路径读粘贴语境条目、在引用路径读引用语境条目。
粘贴路径的上屏文案 MUST NOT 因本条款改变任何字。

引用语境的解码失败文案 SHALL 是文案表的一条独立条目（编号唯一；deck 与运行时表两列逐字一致，
由既有漂移门禁强制）。参数 `{reason}` SHALL 来自后端错误信封，前端 MUST NOT 重算或改写它；
信封缺该参数时上屏 SHALL 回落为后端提供的 message，MUST NOT 抛错，MUST NOT 出现未替换的占位符。

该失败 SHALL 沿用引用事务既有的失败契约：该张不产图片卡片、其余张照常插入、失败读数随结果返回
并在输入区持久留痕（见「引用失败的留痕与引用语境反馈」）。

#### Scenario: 引用一张字节损坏的位图

- **WHEN** 选中含 `![[broken.png]]` 的源码并摘录到对话（该文件的字节不是合法 png）
- **THEN** toast 是引用语境的说法（含「无法解码」/ "decode"，不含「剪贴板」/ "clipboard"，
  也不等于「暂不支持引用该格式」那一句）；输入区出现「1 张图片未能引用」的持久状态行，
  composer 里没有该图的卡片

#### Scenario: 畸形 SVG 的栅格化失败

- **WHEN** 引用一张 XML 不完整或画布尺寸非法的 svg
- **THEN** 上屏同一条引用语境解码失败文案；MUST NOT 出现粘贴语境文案，MUST NOT 出现格式不支持
  文案

#### Scenario: 真实粘贴路径逐字不变

- **WHEN** 粘贴一张字节损坏的 png（与引用共用同一个写原语、同一个 `attachment_decode_failed`）
- **THEN** 上屏仍是粘贴语境的「无法解码剪贴板图片：{reason}」，与本 change 之前逐字相同

#### Scenario: 缺参不抛

- **WHEN** 后端错误信封缺 `reason` 参数
- **THEN** 提示不变成异常：上屏回落为后端提供的 message，MUST NOT 出现未替换的 `{reason}`

### Requirement: 会话自动命名

系统 SHALL 为每个逻辑会话维护一个**会话标题**，并按以下时机以辅助 LLM 调用完成生成或重估：①该会话首轮对话正常完成（首条用户消息得到最终响应）后生成初始标题；②距上一次完成的评估满 5 轮时重估（一轮 = 一条用户消息及其最终响应；工具循环中的多次模型请求不另计，`aborted` / 错误收尾的轮不计）；③话题漂移信号命中时重估——会话已有有效标题，且连续两条用户消息（各不少于 8 个码点）与当前标题的确定性词元重合度低于阈值（标题词元在消息中出现的比例 < 0.2；标题词元不足 3 个时不判漂移）。任何两次评估之间 MUST 至少间隔 3 轮，漂移信号 MUST NOT 把间隔压到更短；同一逻辑会话同时最多一个命名调用在途，在途期间的新触发点 SHALL 跳过（不排队）。尚无有效标题时（首个正常轮已过、初始生成失败或尚未成功），系统 SHALL 在下一个满足 3 轮下限的正常完成轮重试初始生成（`reason=first-turn`），直到成功——周期与漂移触发都以「已有有效标题」为前提，这条重试路径是唯一兜底。

每次评估 SHALL 是一次**便宜档辅助调用**：不带工具；模型声明支持思考档时使用最低档 `Low`，未声明时不发该字段；素材只含当前标题、首轮问答与最近两轮问答的正文（剔除工具调用参数与结果、图片附件、思考文本与自动注入的编辑器上下文节）；首轮每条 ≤500 码点、最近两轮每条 ≤400 码点、整份素材 ≤3000 码点，超长按码点截断。输出由 prompt 约束为一行判定，不依赖 provider 的 `max_output_tokens`（该字段在 Responses 端点被忽略）。

生成器 SHALL 输出 `keep` / `rename` 判定（JSON：`{"decision":"keep"}` 或 `{"decision":"rename","title":"…"}`）：当前标题仍能描述当前对话时 SHALL 输出 keep（拿不准一律 keep）；仅当当前标题已失真（话题已转移或标题明显错误）且新标题显著更好时才输出 rename。系统 MUST 只在 rename 且标题通过规范化校验时替换标题：规范化后须为单行、1–20 个码点、剥除包裹引号 / 反引号与句末标点，且与当前标题不同；keep、非法 JSON、空标题、超长、调用失败或超时一律保持当前标题不变（尚无当前标题的初始生成里，keep 无可保持的对象，SHALL 按 `invalid` 处理并走初始重试路径）。命名调用的失败或「不换名」结果 MUST NOT 向用户报错、MUST NOT 弹 toast、MUST NOT 中断或阻塞对话轮次。

自动命名 SHALL 默认开启（`[harness].session_naming.enabled = true`）；关闭时 MUST NOT 发起任何命名调用、MUST NOT 写标题记录，既有标题记录照常展示。命名调用 SHALL 发往 `[harness].session_naming.provider` 指向的 provider（缺省 = 会话当前 provider，即 `null`），`api_key` / `base_url` / wire 方言与模型同出该 provider 条目；模型 SHALL 取 `[harness].session_naming.model`（缺省 = 该 provider 的生效模型），非空值须在**选定 provider** 的 `models` 清单内声明，未声明时 SHALL 回落该 provider 的生效模型并给一条人话 warning（此时便宜档只由调用形态保证——本仓无模型价格表，见 design D8）。

标题 SHALL 只承担会话身份的展示：标题变化 SHALL 经状态快照与事件通道到达面板并即时更新标题栏会话名与已打开的历史浮层行名，MUST NOT 修改 transcript、session id、历史排序、会话内容或 vault 内任何文件。标题的留存、继承与回落口径见「会话本地留存」与「会话边界」条。

#### Scenario: 首轮后生成标题

- **WHEN** mock provider 完成一条用户消息及其最终响应，fixture 的 `titles` 脚本给出 `{"decision":"rename","title":"Rust 生命周期排查"}`
- **THEN** 标题栏会话名显示「Rust 生命周期排查」；会话 JSONL 追加一条 `session_title` 记录（`decision=initial`、`reason=first-turn`、`model` 为本次调用模型）；历史浮层中该会话行显示同一标题

#### Scenario: 每 5 轮重估

- **WHEN** 距上一次完成的评估已满 5 轮，会话完成第 5 轮的响应
- **THEN** 触发一次重估调用（`reason=cadence`）；keep 时标题不变，rename 且通过校验时标题更新

#### Scenario: 初始生成失败后重试

- **WHEN** 初始生成调用失败（尚无有效标题），其后又完成 3 轮正常对话
- **THEN** 在第 3 轮结束时重试初始生成（`reason=first-turn`），不早于 3 轮、也不等 5 轮周期；成功前会话名保持回落口径

#### Scenario: 话题漂移提前重估

- **WHEN** 会话已有标题，其后连续两条用户消息（各 ≥8 个码点）与当前标题的词元重合度均低于 0.2，且距上次评估已满 3 轮
- **THEN** 不等到 5 轮即触发重估（`reason=drift`）；重估结果仍受 keep / rename 防抖约束

#### Scenario: 显著更好才换

- **WHEN** 重估调用输出 keep，或输出的标题规范化后与当前标题相同
- **THEN** 会话标题保持不变，标题栏会话名与历史列表不变；留存追加一条 `decision=keep` 的记录（携带当时生效的标题）

#### Scenario: 非法输出不换名

- **WHEN** 生成器输出非法 JSON、未知 decision、空标题、超过 20 个码点、初始生成时输出 keep（无当前标题可保持），或调用超时 / 返回错误
- **THEN** 会话标题保持当前值，界面不出现错误提示或 toast；留存追加 `decision=error` 的记录并带错误码（`harness_title_invalid` / `harness_title_failed`），记录不含对话正文

#### Scenario: 关闭自动命名

- **WHEN** `[harness].session_naming.enabled = false` 并完成任意轮次对话
- **THEN** 系统不发起任何命名调用、不写 `session_title` 记录；会话名按「会话边界」条的回落口径显示

#### Scenario: 命名不阻塞对话

- **WHEN** 命名调用在途时用户发送下一条消息
- **THEN** 新一轮对话立即开始处理，不等命名调用结束；该结果若在新一轮进行中或会话已轮换后到达 SHALL 被丢弃（不写记录、不改标题）

#### Scenario: 标题更新不扰动会话

- **WHEN** 一次 rename 在会话空闲时生效
- **THEN** 标题栏会话名与已打开的历史浮层行名同步更新；transcript、消息顺序、滚动位置、焦点、session id 与历史清单顺序均不变

### Requirement: transcript 的跟随滚动与回到底部

harness 面板的 transcript SHALL 区分**跟随态**与**脱离态**。跟随态下，新增内容（流式正文、思考块、
工具行、通知、错误行、批准卡等）到达后视口 SHALL 停留在内容末尾，最新一行 MUST 在视口内；脱离态下，
任何新增内容 MUST NOT 写滚动位——`scrollTop` 的变化 SHALL ≤ 1px，用户正在阅读的那一行 MUST 停在
原处。

两态 SHALL 由**几何位置**判定，MUST NOT 由显式开关、模式或超时判定：视口距内容底部不超过**回底容差**
SHALL 视为在底部（跟随）；用户以任何方式把视口带离底部超过**脱离阈值**后 SHALL 立即进入脱离态——
滚轮 / 触控板、拖动滚动条、以及任何把视口带离底部的动作（含「消息摘录卡」跳回旧消息的滚动定位）
MUST 共用这一条判据，MUST NOT 按输入通道各写一份。视口回到距底 ≤ 回底容差时 SHALL 自动恢复跟随，
MUST NOT 要求用户点击或按键。回底容差与脱离阈值之间 SHALL 是滞回区间：跟随态在距底 ≤ 脱离阈值内
MUST NOT 脱离，脱离态在距底 > 回底容差内 MUST NOT 复跟（底部附近 MUST NOT 抖动）；两个值 SHALL 都
小于一行正文的渲染高度。具体取值是实现精度（在 design 层定），场景断言 MUST NOT 写死像素值。

脱离态下 SHALL 在 transcript 视口内浮现「回到底部」钮：钮 MUST NOT 随内容滚动（常驻视口右下角），
点击 SHALL 把视口带回内容末尾、恢复跟随态，钮随之退场。脱离态期间 transcript 有新内容到达时，
钮 SHALL 呈现未读提示；回底或恢复跟随态后提示 SHALL 清除。未读提示 MUST NOT 使用数字计数——流式
增量不构成「消息」这种计数单位，任何数字都是伪造读数。

**强制回底的白名单**：只有用户自己发起的动作 SHALL 强制回到末尾并恢复跟随——发送一条消息、切换 /
恢复会话（含快照重建）、切换 vault、重新打开面板。其余事件（流式增量与轮次终态、工具行更新、通知、
错误行、批准卡、自动回合）MUST NOT 强制改变滚动位，只更新未读提示。

transcript 内容不足一屏（内容高度 ≤ 视口高度）时 MUST NOT 出现脱离态与「回到底部」钮。跟随态下面板
尺寸变化（窗口缩放 / 分栏调整）SHALL 继续贴底；脱离态下尺寸变化 MUST NOT 写滚动位。

「回到底部」钮 SHALL 是可键盘聚焦的按钮：可访问名取文案表（无新内容 / 有新内容两串），随界面语言
重绘；配色 SHALL 只消费 token 层（三主题成立，eink 不引入彩色），`prefers-reduced-motion` 下
MUST NOT 脉冲。面板 MUST NOT 为「回到底部」新增全局键位：composer 聚焦时 Space SHALL 仍然键入空格，
Space / PgDn MUST NOT 被本需求解释为滚动或回底命令。

跟随 / 脱离的判定与写滚动位的编排 SHALL 只有一份实现（纯模型层）：面板 DOM 接线、单测与验收场景
MUST NOT 各自复制阈值或比较逻辑。

#### Scenario: 流式期间上滚后阅读位置保持

- **WHEN** 一轮回复正在流式增长，用户把 transcript 视口上滚离开底部（距底 > 脱离阈值）
- **THEN** 后续增量到达时视口不移动（`scrollTop` 变化 ≤ 1px），阅读中的那一行仍在原处；「回到底部」
  钮浮现

#### Scenario: 回到底部恢复跟随

- **WHEN** 脱离态下点击「回到底部」钮，或用户手动把视口滚回距底 ≤ 回底容差
- **THEN** 视口到达内容末尾、「回到底部」钮退场；下一个增量到达后视口仍贴底（距底 ≤ 回底容差）

#### Scenario: 跟随时增量贴底

- **WHEN** 视口在底部（距底 ≤ 回底容差）且流式增量到达
- **THEN** 每次增量落地后视口距底 ≤ 回底容差、最新一行在视口内，同一轮内不发生「越写越落后」

#### Scenario: 脱离态的新内容提示

- **WHEN** 脱离态期间 transcript 有新内容到达（流式正文 / 工具行 / 通知 / 错误行 / 批准卡任一）
- **THEN** 「回到底部」钮呈现未读提示，且提示不是数字计数；回到跟随态后未读提示消失

#### Scenario: 强制回底白名单

- **WHEN** 脱离态下用户发送一条消息、切换 / 恢复会话、切换 vault 或重新打开面板
- **THEN** 视口回到内容末尾并恢复跟随态（新消息 / 恢复内容可见），「回到底部」钮退场

#### Scenario: 非用户事件不拽走视口

- **WHEN** 脱离态下到达工具行更新、通知、错误行、批准卡或自动回合的增量
- **THEN** `scrollTop` 不变（≤ 1px），只有未读提示可能变化；视口不回到末尾

#### Scenario: 内容不足一屏

- **WHEN** transcript 的内容高度不超过视口高度
- **THEN** 不出现脱离态与「回到底部」钮，任何滚动调用都不产生可见位移

#### Scenario: composer 键位不被劫持

- **WHEN** composer 聚焦时按 Space 与 PgDn
- **THEN** Space 正常落进 composer 文本、PgDn 只按既有归属处理，transcript 的滚动位不变，MUST NOT
  触发回底动作

#### Scenario: 钮的主题与语言纪律

- **WHEN** 三主题（light / dark / eink）下钮可见，或界面语言为 zh / en
- **THEN** 钮的配色与描边逐值来自 token 层（eink 无彩色、以描边区分层次），可访问名取对应语言的
  文案（无新内容 / 有新内容两串）

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

- **WHEN** 一次运行的契约声明 `tool_policy.allow` 为 9 件 vault 操作工具（cron 交接的形状），且
  `[harness.subagents].enabled = true`
- **THEN** 该运行的模型请求只包含白名单内的工具定义，`task` MUST NOT 出现；同一配置下的交互发送
  （没有交接契约）仍注册 `task`

### Requirement: 权限规则的持久化与治理

系统 SHALL 支持把一次批准沉淀为**持久权限规则**，写入全局配置 `[harness].permissions.allow`
（跨 vault 生效）。规则文本 MUST 由后端从待决调用的 argv / 路径**现算**（单一真源）：前端
MUST NOT 拼装、改写或回传规则字符串，后端 MUST NOT 采信前端传入的规则文本。写入 SHALL 去重
（已存在同文规则时不重复追加），写回 SHALL 原子（读 → 合并 → 原子写）。

规则的生成口径 SHALL 为：`cli_run` → `cli(<命令> <首个非 flag 参数> *)`；取不到第二词
（只有命令、或第二词以 `-` 开头）时为 `cli(<命令> *)`。`vault_patch` / `vault_create` /
`vault_move` → 路径含目录段时为 `tool(<目录>/*)`，否则为精确规则 `tool(<路径>)`。
`vault_delete` 与 `cron_task_create` / `cron_task_remove` MUST NOT 提供持久化入口（删除与
「每天自行运行」的授权不宜一次点击到永久），二者保留会话内记忆能力（见「会话内批准缓存」）。
生成的规则文本 MUST 是规则语法可解析、且能真实命中同族调用的字符串；无法安全表达（含换行、
空路径等）时 MUST NOT 提供该入口——退化为「多问一次」可接受，退化为「误放行」不可接受。

持久规则 MUST NOT 解锁危险黑名单：判定层序（deny > vault 内写重定向 > 危险黑名单 > allow >
模式默认分层）不变，手写 `cli(bash *)` 这类 allow 规则对危险层无效；危险黑名单命中的批准卡
MUST NOT 提供沉淀入口（见「批准闸呈现与决策后收敛」）。

规则列表 SHALL 在权限浮层中逐条可见、可删（呈现口径见「权限模式切换」）。删除 SHALL 幂等
（规则不存在时安静成功），并在下一次权限判定生效。规则写回失败时，本次调用 MUST NOT 执行：
批准保持待决，MUST NOT 出现「调用已执行、规则没写」或「规则已写、调用未批准」的半态。

本期规则作用域 SHALL 为全局（所有 vault 生效），MUST NOT 提供 session / vault 级作用域或规则
优先级数值——`[harness].permissions` 仍只有 `allow` / `deny` 两张表，MUST NOT 引入 `ask` 规则层。

#### Scenario: 沉淀前缀规则后同类查询免问

- **WHEN** 保险库写入档下 `cli_run("tvly", ["search", "prompt caching"])` 进入批准闸，Alex 点击「以后都允许 `cli(tvly search *)`」，随后模型调用 `cli_run("tvly", ["search", "另一个问题"])`
- **THEN** 第二次调用直接执行、不进批准闸；`config.json` 的 `[harness].permissions.allow` 含 `cli(tvly search *)`；之后调用 `cli_run("tvly", ["save", "x"])` 仍弹批准闸（不同子命令）

#### Scenario: 规则文本由后端生成并去重

- **WHEN** 同一前缀的规则已存在于配置，Alex 又在同类调用上点击「以后都允许」
- **THEN** 配置里仍只有一条该规则（MUST NOT 重复追加）；按钮上显示的文本与写入配置的文本逐字相同

#### Scenario: 危险命令不可被持久规则解锁

- **WHEN** 配置的 allow 规则含 `cli(bash *)`（手写或历史遗留），模型调用 `cli_run("bash", ["-lc", "rm -rf /tmp/x"])`
- **THEN** 调用仍进入批准闸（危险黑名单层先于 allow 规则），MUST NOT 因该规则自动放行

#### Scenario: 规则写回失败不执行调用

- **WHEN** 配置文件不可写（权限 / 磁盘错误），Alex 在某批准卡上点击「以后都允许」
- **THEN** 本次调用不执行、批准卡保持待决并显示错误；再次普通采纳可正常执行

### Requirement: provider 条目与预设

`harness.providers` 的每个条目 SHALL 由 `preset` 决定协议行为。预设的取值与语义：

| 预设 | 官方 Base URL | Responses 的 `store:false` | 超限特征串 | 支持 wire | 缺省 wire | 要求 api_key |
|---|---|---|---|---|---|---|
| `kimi` | `https://api.moonshot.cn/v1` | 发送 | kimi 预设表 | `responses` / `chat_completions` | `responses` | 是 |
| `deepseek` | `https://api.deepseek.com` | 不发送 | deepseek 预设表 | `responses`（v1；chat 档未实现） | `responses` | 是 |
| `generic` | 无 | 不发送 | 已知话术并集（保守识别） | `chat_completions` / `responses` | `chat_completions` | 否 |
| `mock` | 无 | 不经过 HTTP | 并集 | 不消费 | `responses` | 否 |

`generic` 预设的条目 SHALL 要求非空 `base_url`；缺失时该条目不可用（`configured = false`）
并在校验期产生一条人话 warning。`generic` 的 `api_key` 为空 SHALL 表示「不发送
Authorization 头」，MUST NOT 因此把条目判为未配置（本地 OpenAI 兼容端点通常不需要 Key）。

`mock` 是保留 id：`preset = "mock"` SHALL 只允许 id 恰好为 `mock`；其它 id 声明 mock 预设时
条目 SHALL 被忽略并给一条人话 warning。设置面板 MUST NOT 呈现或允许新增 / 删除 `mock`。

条目里的 `base_url` 为空串 SHALL 视同缺省 + warning：kimi / deepseek 落到官方地址，
generic 视为未填；「使用官方地址」的规范写法是删除该键（见 `settings` 的「模型接入的编辑面」
条），MUST NOT 写空串。`wire_api` 的非法值 /
该预设不支持的档位 SHALL 回落该预设的缺省值 + 人话 warning，MUST NOT 静默忽略。

#### Scenario: 同预设多实例

- **WHEN** 配置里有 `kimi-work` 与 `kimi-personal` 两个条目，都是 `preset: "kimi"`，Key 与
  模型清单不同
- **THEN** 两者行为都走 kimi 预设（官方地址 / store / 超限特征串）；各自使用自己的 Key 与
  清单；切换当前使用项不改变另一个条目的任何字段

#### Scenario: generic 缺 Base URL 不可用

- **WHEN** 一个 `preset: "generic"` 的条目没有 `base_url`（或写成空串）
- **THEN** 该条目 `configured = false`，装载期给一条点名的人话 warning；发送时若它是当前使用项，
  返回 `harness_base_url_missing`；MUST NOT 回落到任何内置地址

#### Scenario: generic 空 Key 不发送 Authorization

- **WHEN** 一个 `preset: "generic"` 的条目 `api_key` 为空、Base URL 与模型清单齐全
- **THEN** 该条目 `configured = true`；请求不携带 Authorization 头；MUST NOT 报
  「api_key 未配置」

#### Scenario: mock 是保留 id

- **WHEN** 配置里出现 id 为 `local-mock`、`preset: "mock"` 的条目
- **THEN** 该条目被忽略并给一条人话 warning；只有 id 恰好为 `mock` 的条目走 fixture 驱动

#### Scenario: 预设不按 id 推断

- **WHEN** 配置里有一个 id 为 `kimi` 但 `preset: "generic"`、`base_url` 指向
  `http://127.0.0.1:8080/v1` 的条目
- **THEN** 它按 generic 行为运行（不发 store、缺省 chat 方言、Base URL 用配置值），MUST NOT
  因为 id 叫 `kimi` 就使用 kimi 官方地址或 kimi 的 store 口径

### Requirement: provider 配置迁移

加载期 SHALL 对旧格式（`providers` 条目缺 `preset`）执行一次性迁移：对 id 为 `kimi` /
`deepseek` / `mock` 的条目分别补 `preset: "kimi"` / `"deepseek"` / `"mock"`；条目已写
`preset` 时 MUST NOT 覆盖（用户显式值优先）；其它 id MUST NOT 被迁移（按 `generic` + warning
对待）。

迁移 SHALL 是幂等的：迁移后的文件再次加载不再产生写操作。迁移 SHALL 与既有退役 model 值迁移
合并为同一次原子写，最多写盘一次；写失败 SHALL NOT 阻断加载——内存中的值已补齐（本次生效值
正确），只多一条 warning，下次加载再试。

迁移 MUST NOT 改名、搬字段或改写其它键；除新增的 `preset` 外，文件内容 SHALL 逐字节不变。
系统 MUST NOT 保留「旧结构」的第二条读取路径或双写路径：迁移完成后，运行期只按带 `preset`
的新 schema 解释 provider 条目。

#### Scenario: 旧配置一次补齐

- **WHEN** 用旧格式配置启动（`providers.kimi` / `.deepseek` / `.mock` 都没有 `preset`）
- **THEN** 启动正常、行为与升级前一致；文件被原子改写，三个条目各多一个 `preset`；其它键
  逐字节不变；warning 里说明发生了迁移

#### Scenario: 迁移幂等

- **WHEN** 对已迁移的文件再次启动
- **THEN** 不再写盘（文件 mtime 与内容不变）；不产生迁移 warning

#### Scenario: 显式预设不被覆盖

- **WHEN** 旧文件的 `providers.kimi` 已写 `preset: "generic"`
- **THEN** 迁移不改它；该条目按 generic 运行（用户显式值优先）

#### Scenario: 迁移写失败不阻断

- **WHEN** 配置目录只读，迁移无法落盘
- **THEN** 本次启动仍按补齐 preset 后的配置运行；给一条「迁移未能落盘，下次启动会再试」的
  warning；MUST NOT 因写失败把配置回落到默认

#### Scenario: 未知 id 不迁移

- **WHEN** 旧文件里有一个手写的 `providers.openai` 条目（旧 schema 会静默忽略它）
- **THEN** 迁移不给它补预设；新版本按 `generic` + 一条 warning 对待（条目出现在管理面，
  但缺 Base URL 时不可用）

### Requirement: 模型清单声明

`config.json` 的 `[harness].providers.<id>.models` SHALL 是模型能力与上下文窗口的**唯一**声明
源；系统 MUST NOT 内置任何模型 id、能力或窗口数值，MUST NOT 出厂回落内置模型表，MUST NOT 提供
「可用模型目录 / 推荐模型」这类第二来源。`<id>` 是任意用户定义的 provider id；provider 集合是
动态映射（见「provider 条目与预设」条），本 requirement MUST NOT 被理解为限制 provider 数量或
名称。清单每项 SHALL 是对象，字段与处置如下：

| 字段 | 类型 | 缺省 | 非法处置 |
|---|---|---|---|
| `id` | 非空字符串，清单内唯一 | 无（必需） | 丢弃该项 + 人话 warning，其余项照常生效 |
| `effort` | 布尔 | `false` + warning | 丢弃该项 + warning |
| `vision` | 布尔 | `false` + warning | 丢弃该项 + warning |
| `window` | 整数，`1..=10_000_000` tokens | `131072` + warning | 丢弃该项 + warning |

清单 SHALL 按原顺序保留合法项；一项写坏 MUST NOT 拖垮整份配置或清单的其余项。未知子键 SHALL
在运行期忽略；经设置面板保存时 SHALL 按 `id` 保留（见 `settings` capability 的「设置写通道」
条）。

生效模型 SHALL 按以下顺序解析：显式 `providers.<id>.model`（须在清单内；不在清单内时保留该
值、窗口按 `131072` 保守估算、`effort` 与 `vision` 都按不支持处理，并给 warning）→ 缺省 /
空串取清单首项 `id` → 清单为空时为空串（不伪造，发送期返回人话错误
`harness_model_missing`）。上下文窗口、effort 能力、vision 能力 SHALL 都从本清单读取，
MUST NOT 另立第二套表。

#### Scenario: 合法清单生效

- **WHEN** `kimi-work.models` 声明
  `[{id: "k3-256k", effort: true, vision: true, window: 262144}]` 且 `model` 键缺省
- **THEN** 生效模型为 `k3-256k`；上下文窗口为 262144；effort 与 vision 都按支持处理；模型
  选择器列出该模型

#### Scenario: 缺省字段按保守值并告警

- **WHEN** 某项只写 `{id: "m1"}`，缺 `effort` / `vision` / `window`
- **THEN** 该项保留并生效，`effort` 与 `vision` 按不支持、`window` 按 131072；三项缺失各产生
  一条人话 warning

#### Scenario: 坏项只丢自己

- **WHEN** 清单含三项：一条合法项、一条 `window: 0`、一条重复 `id`
- **THEN** 只有合法项生效；另外两项各产生一条点名序号的 warning；配置不回落、其余项不受影响

#### Scenario: 空清单不伪造模型

- **WHEN** provider 节已配置（有 `api_key`）但 `models` 为空
- **THEN** 生效模型为空串；模型选择器显示空态；发送时返回 `harness_model_missing`；MUST NOT
  回落到任何内置模型

### Requirement: 面板收起与跨 vault 的活动在场

harness 面板的活动状态 MUST NOT 只存在于面板内部。活动 SHALL 按 vault 根路径记账：标题栏 harness toggle 钮
（`harness.toggle` 的可见入口）呈现**当前 vault 会话**的活动；vault 切换器浮层的非当前行呈现**该行 vault**
的活动（行级呈现的完整合同见 `vault-workspace` 的「vault 列表行的活动状态」条）。标题栏三态可辨：空闲 /
在途 / 有未读结果；三态 SHALL 同时在钮的可访问描述上可读（MUST NOT 只靠颜色承载语义）：状态词 SHALL 同时
写进该钮的 `title`——WKWebView 把钮当叶子节点，钮内文本不进 AX 树、`aria-describedby` 指向的隐藏文本在
自动化通道里读不到，`title`（AX `help`）是三态可判定读数的唯一载体。该钮挂在标题栏且面板展开时不在场上
（既有退让条款），因此三态的在场判据 SHALL 取收起态（面板展开期间的读数由面板内既有的发送钮 / 阶段行
承载）。活动提示 MUST NOT 自动展开面板、MUST NOT 抢焦点、MUST NOT 切换 vault、MUST NOT 触发系统通知，
也 MUST NOT 引入新的全局键位；行级标记 MUST NOT 在浮层收起时可见（不得变成常驻角标）。

**在途**的判据 SHALL 只有一个：该 vault 的轮次状态；同一份按 vault 键控的活动记录 SHALL 同时服务标题栏钮
与切换器行，两处 MUST NOT 各存一份。当前 vault 的呈现读 SHALL 取后端会话的轮次状态。后端 SHALL 把「轮次
在跑」与「终态已发、会话尚未释放」区分成两个状态，`harness_state` 快照 SHALL 携带**呈现读** `in_flight`
——它只在「轮次在跑、终态未发」时为真，在「终态已发、尚未释放」窗口里 MUST 为假。用于协议判定（在途拒绝
新的发送 / 新会话）的**协议读** SHALL 保持今天的语义（终态已发、尚未释放时仍视为占用），两读 MUST 由同
一个会话级轮次状态派生，MUST NOT 各存一份。该状态 SHALL 覆盖**全部轮次来源**——用户发送、点击发起的 cron
运行、唤醒链的自动回合——以及**该轮次的全部终态路径**（正常完成、配置级失败、内部错误 / panic、空响应、
用户停止、程序性中止）；MUST NOT 只对普通回合成立（自动回合的失败路径同样经历「终态已发、尚未释放」的
窗口）。面板在装载、切回 vault、恢复会话三个时点 SHALL 按**进入快照**的 `in_flight` 恢复相位，MUST NOT
因视图复位（切 vault 时的 `resetView`）或事件按 vault 过滤而把一个仍在途的轮次呈现为空闲；`in_flight`
为假时 SHALL 就地收口（相位空闲、轮次闸门关闭、清「中途接管」标记），MUST NOT 等一个可能永远不会到达的
终态事件。前端 MUST NOT 保存终态记忆，也 MUST NOT 把 `harness_busy` 拒绝当作在途证据——拒绝只可能来自上
述「终态已发、尚未释放」窗口或本地假空闲，处置 SHALL 是重取一次快照并按 `in_flight` 应用，MUST NOT 直接
改相位。

非当前 vault 的轮次状态 SHALL 由该 vault 的 `harness:event` 信封派生：轮次开始取本地发送的乐观起点（同步
拒绝时按发送前的记录回滚）或后端 `auto_turn_started`，轮次结束取该 vault 的 `done` / `error` / `aborted`
终态。派生理由 SHALL 是 `harness_state` 只服务当前 vault、非当前 vault 没有快照可读；切回该 vault 后的进入
快照 SHALL 以 `in_flight` 与事件记录对账一次，MUST NOT 让两读长期分叉。事件派生只是同一记录的输入，
MUST NOT 引入第二张未读表、第二个相位状态机或第二份后端真源。

**停止子态** SHALL 沿用既有两态机的语义：running 下点击停止进入 stopping、重复点击保持 stopping（幂等）、
终态统一收口回 idle；本能力 MUST NOT 另立第二套相位状态机——相位只有一份投影。

**终态与释放的次序 MUST NOT 反转**：改成「先释放再发终态」会让旧轮终态落到其后开始的新轮上（新轮被误认为
结束、后续增量被轮次闸门丢弃），因此终态的发射先于会话释放这一既有次序 SHALL 保持不变；两个状态的区分
由后端轮次状态承担，MUST NOT 由前端按时序猜测。终态对账用的那份快照 MUST NOT 参与相位判定，只重建内容。

切回一个仍在途的 vault 时，该轮次**尚未上屏的后续增量** SHALL 继续渲染（轮次闸门随相位一并恢复）；
该轮次到达终态时，面板 SHALL 以后端会话快照对账一次渲染面，MUST NOT 把缺少开头部分的中途正文当作该轮的
完整回答留在 transcript 里。

**未读结果** SHALL 只由轮次终态产生，并按终态种类分档：正常结束 = 有新的回复；错误终态 = 有失败结果；
用户主动停止（`aborted`）MUST NOT 产生未读，也 MUST NOT 清除既有未读。未读只在该 vault 的 transcript
不在屏幕上期间产生；**已读 = 该 vault 的 transcript 真的在屏幕上**，判据 SHALL 是「该 vault 是当前 vault、
且 harness pane 对它在场（布局已落定）」——不看窗口焦点、不看应用是否前台。重新打开面板 SHALL 清除当前
vault 的未读（已读清算的入口之一）；切到一个布局里有 harness pane 的 vault、面板随布局在场时 SHALL 清除
该 vault 的未读；切过去但面板收起（或目标布局没有 harness pane）MUST NOT 清除，标记保留并转由标题栏钮
承载。切换 vault 本身是视图复位口径，MUST NOT 被当作已读（见下）。MUST NOT 使用数字计数，MUST NOT 为同一
vault 累计多条未读。

**作用域与来源**：活动记录 SHALL 按 vault 根路径键控，覆盖该 vault 的用户发送、点击发起的 cron 运行与唤
醒链的自动回合；标题栏钮 SHALL 只呈现当前 vault 的记录，切换器行 SHALL 只呈现**非当前 vault** 的行，当前
vault 的行 MUST NOT 重复呈现（当前行由标题栏钮承载，避免同一状态两处出现）。切换 vault MUST NOT 清空任一
vault 的未读；视图复位（新会话 / 恢复历史会话 / cron 点击运行切屏 / cron 发起失败回滚 / cron 通知打开会话）
SHALL 只清**动作发起时捕获的 vault** 的记录（换会话即换视图）；MUST NOT 按异步回包到达时的当前 vault
清除——在 A 发起
新会话 / 恢复、回包到达前切到 B 时，只清 A，B 的记录 MUST NOT 被误清。显式删除 / 重定位 vault 时 SHALL
按后端实际打开根丢弃该 vault 的记录；实际根不可得时 MUST NOT 改用注册表原值 `path` 猜键，记录 MAY 留到
重载。系统 MUST NOT 以注册表路径做周期性清理（旧拼写不同会误删当前标题栏仍在用的记录）。未匹配到实际根、
已无行可显示的内存记录 MAY 留到重载，属非持久化边界：它 MUST NOT 产生任何可见标记，MUST NOT 被当作
「已读 / 未读」的可见状态。无人值守 / 后台 cron 运行（隔离 runtime、事件不进当前 transcript）MUST NOT
参与该记录——它们的完成走 cron 自己的通知通道；点击发起的 cron 运行走交互槽位，按普通轮次呈现。后台子
代理完成通知（`notice`）不单独产生未读，其未读由所属轮次的终态承担。审批等待（`approval_request` 挂起）
归「在途」档，MUST NOT 单独成为一档未读（它等待处置，不是「已完成、待你看」的结果）。未读水位 MUST NOT 跨应用重启或 webview 重载回放：应用重启后所有
vault 从空闲开始；webview 重载后未读同样不回放，但当前 vault 的真实在途 SHALL 仍按进入快照的 `in_flight`
恢复（MUST NOT 因此把在途呈现为空闲），非当前 vault 没有快照、重载后其相位与未读暂时未知，直到该 vault
的后续事件到达或用户切回它并读快照。

**视觉与主题**：空闲态 MUST NOT 新增任何上屏像素（既有整页基线不因本能力更新）；三态形状 SHALL 承载语义、
颜色只作增强，eink 主题下 MUST NOT 依赖彩色或中间调区分。标题栏钮与切换器行 SHALL 复用同一套形状语言
（在途 = 空心环、未读回复 = 实心点、未读失败 = 实心点 + 外环）与同一档 6×6 尺寸；行标记 MUST NOT 新增
文本或计数，状态词 SHALL 只写进该行切换钮的 `title`，行内文本、可访问名与点击定位 MUST NOT 因它改变。
MUST NOT 引入常态动画（因此 `prefers-reduced-motion` 无分支）。状态文案 SHALL 走文案表 zh/en 双档并随界面
语言切换重绘（复用既有 D870–D872，不新增 copy key）。

#### Scenario: 收起期间完成一轮并点亮未读

- **WHEN** 面板打开、发送一条提问后立即收起面板（`⌘⇧A`），该轮随后正常结束
- **THEN** 收起期间标题栏 toggle 钮呈「在途」态（可访问描述为处理中）；轮次结束后转为「有新的回复」态，
  本轮的增量与终态 MUST NOT 把面板重新展开、MUST NOT 抢走焦点

#### Scenario: 收起期间失败轮次呈失败档

- **WHEN** 面板收起期间到达一个错误终态（`error`）
- **THEN** 指示呈「有失败结果」态，与「有新的回复」在形状上可辨（不单靠颜色）

#### Scenario: 用户主动停止不产生未读

- **WHEN** 一轮在途时用户点击停止，并在 `aborted` 终态到达之前收起面板（终态在收起期间到达）
- **THEN** 指示回到空闲态，MUST NOT 留下未读标记

#### Scenario: 重新打开面板即清算未读

- **WHEN** 指示处于「有新的回复」态，用户经 `⌘⇧A` / toggle 钮打开面板
- **THEN** 未读标记立即消失、指示呈空闲（该轮若仍在途则呈在途），面板内容按既有恢复路径正常呈现

#### Scenario: 终态已发、尚未释放的窗口报不在途

- **WHEN** 一轮已发出终态（`done` / `error` / `aborted` 任一）、会话尚未释放（协议上仍占用），此时读快照
- **THEN** 快照的呈现读为「不在途」，面板保持空闲（或按该终态种类呈未读档），MUST NOT 复活为在途、
  MUST NOT 重开轮次闸门；对账快照只重建内容，不参与相位判定

#### Scenario: 终态后立即发送被拒不复活

- **WHEN** 面板已处理完终态、用户在上述窗口内发送，后端以 `harness_busy` 拒绝
- **THEN** 面板只上一条错误行并重取一次快照（呈现读仍为不在途），MUST NOT 因这次拒绝把相位改成在途；
  用户随后重试正常发出（窗口结束）

#### Scenario: 离开期间发生的终态由进入快照收口

- **WHEN** 在 vault A 发起一轮、切到 B、该轮在 B 期间结束（vault A 的 transcript 不在屏幕上），随后在 B
  打开切换器
- **THEN** A 的行呈「有新的回复」（不是「处理中」；该轮终态已收口）；切到 A（面板仍收起）后标题栏钮呈
  「有新的回复」，再次打开切换器时 A 行不显示标记（当前行由钮承载）；进入快照的呈现读为「不在途」，
  面板就地收口（相位空闲、轮次闸门关闭、清接管标记），MUST NOT 停在「处理中」等一个不会到达的事件；
  打开面板后该轮的回答按快照完整呈现，未读随之清除

#### Scenario: 自动唤醒回合的终态同样收口

- **WHEN** 唤醒链的自动回合在配置级失败或内部错误（panic）上结束，此时会话尚未释放（协议上仍占用）
- **THEN** 快照的呈现读为「不在途」，面板当轮收口（相位空闲、轮次闸门关闭），MUST NOT 因该回合的
  `auto_turn_started` 曾把相位置为处理中而停在空闲之外——自动回合的失败路径与普通回合同一条判据

#### Scenario: 停止中的相位与幂等

- **WHEN** 一轮在途（running）时点击发送钮的停止态，随后再次点击（连点），直到终态到达
- **THEN** 相位在首次点击后进入 stopping、重复点击保持 stopping（幂等，不重复发停止请求）；期间到达的
  快照 MUST NOT 把它改回 running 或提前收口；终态到达后相位回到 idle

#### Scenario: 跨 vault 往返仍在途不呈空闲

- **WHEN** 在 vault A 发起一轮对话（处理中）、切到 vault B、再切回 A，此时该轮仍在后端运行
- **THEN** 切回 A 后标题栏指示与面板内发送钮都呈处理中（发送钮为停止态），MUST NOT 出现「看似可发送」的
  空闲态——用户不会在以为空闲的状态下撞上「对话正在进行中」的拒绝

#### Scenario: 切回后在途轮次续渲染并对账

- **WHEN** 切回一个仍在途的 vault，该轮随后产出更多正文并正常结束
- **THEN** 切回之后的增量继续上屏；终态到达时渲染面按后端快照对账，transcript 里该轮呈现与留存一致的完整
  回答（MUST NOT 留下缺开头的半截正文）

#### Scenario: 未读不计数

- **WHEN** 面板收起期间先后有两个轮次到达终态（第二个由唤醒链的自动回合发起，含一个失败）
- **THEN** 指示仍只是一枚状态标记，MUST NOT 出现数字计数或第二条标记

#### Scenario: 重复切换不丢在途状态

- **WHEN** 一轮在 vault A 处理中，用户在同一次会话里反复在 A / B 之间切换多次（A→B→A→B→A）
- **THEN** 每次切回 A 指示都仍呈在途（不因切换次数累积成多条未读、也不掉回空闲）；该轮终态只收口一次，
  transcript 里不出现重复消息，切回后的增量照常上屏

#### Scenario: 后台 cron 运行不点亮指示

- **WHEN** 一个无人值守 / 定时 cron 运行在后台完成（隔离 runtime，事件不进当前 transcript）
- **THEN** 标题栏指示的相位与未读态都不因这次运行改变；其完成提示仍走 cron 既有通知通道

#### Scenario: 点击发起的 cron 运行按普通轮次呈现

- **WHEN** 用户点击 cron 通知发起一次运行（交互槽位），随后收起面板
- **THEN** 收起期间指示呈在途，运行结束后按普通轮次点亮未读

#### Scenario: cron 发起失败回滚按发起 vault 收口

- **WHEN** 在 vault A 点击 cron 通知发起运行（`beginCronRun` 已复位 A 的视图），请求在途时切到 B，随后
  运行发起被拒
- **THEN** 只回滚 A 的记录与视图；B 的记录、transcript、输入区与快照 MUST NOT 被复位或重取；A 的失败
  提示不写进 B；切回 A 时按快照重建

#### Scenario: cron 通知恢复跨 vault 不操作当前视图

- **WHEN** 点击 vault A 的结果通知恢复会话，`harness_resume_session` 在途时切到 B，随后恢复成功
- **THEN** 只复位 A 的记录；B MUST NOT 被打开 harness pane、MUST NOT 清未读、MUST NOT 重取快照；A 的
  恢复内容不渲染进 B，切回 A 时按快照重建

#### Scenario: 非当前 vault 的在途在行上可见

- **WHEN** 在 vault A 发起一轮（处理中），收起面板并切到 B，随后打开切换器
- **THEN** A 的行呈「处理中」（空心环），当前 vault B 的行不显示任何标记；标记落在 A 行切换钮矩形内，
  MUST NOT 压住移除钮、MUST NOT 出现数字或第二枚标记

#### Scenario: 切过去但面板收起不清未读

- **WHEN** vault A 有「有新的回复」未读，用户从 B 切到 A，而 A 的存储布局里没有 harness pane（切过去后
  面板仍是收起态）
- **THEN** 切换本身 MUST NOT 清除未读；标题栏钮呈「有新的回复」，再次打开切换器时 A 行不显示标记
  （当前行由钮承载）；随后用户经 `⌘⇧A` 打开面板，未读才清除

#### Scenario: 目标布局有 harness pane 时随在场清算

- **WHEN** vault A 有「有失败结果」未读，用户从 B 切到 A，A 的存储布局里 harness pane 在场
- **THEN** 布局落定、面板随在场后该未读清除，标题栏钮回到空闲；MUST NOT 在布局落定之前凭切换动作抢先
  清算（切换窗口内到达的终态按「不在屏幕上」保守记未读，由随后的在场信号校正）

#### Scenario: 审批等待归在途

- **WHEN** vault A 的一轮因工具审批挂起（`approval_request` 等待处置），用户切到 B 并打开切换器
- **THEN** A 的行呈「处理中」，MUST NOT 呈「有新的回复」或「有失败结果」；该档不引入第四种清算语义

#### Scenario: 停止不清既有未读

- **WHEN** vault A 已有「有新的回复」未读，A 又发起一轮并在终态前被用户主动停止，用户在 `aborted` 到达前
  切到 B
- **THEN** A 的行仍呈「有新的回复」，MUST NOT 因这次 `aborted` 清除既有未读、MUST NOT 改呈「有失败结果」

#### Scenario: 停止请求被拒不关掉新轮

- **WHEN** vault A 的一轮在途时用户点击停止并切到 B；停止请求随后被后端拒绝为「没有在途轮次」，而 A 的
  记录已因终态回到空闲或已开始新的一轮
- **THEN** 拒绝只收口停止中的那一轮：记录已 idle 或已 running 时 MUST NOT 被改回 idle、MUST NOT 改写
  新轮的相位；错误行 MUST NOT 写进 B 的视图

#### Scenario: 后台通知不单独点亮

- **WHEN** 后台子代理完成并发出 `notice`，但没有触发自动唤醒回合
- **THEN** 该 vault 的记录不因 `notice` 产生未读；若 `notice` 触发了自动唤醒回合，未读由该回合的终态按
  普通轮次产生

#### Scenario: 无人值守 cron 不参与跨 vault 记录

- **WHEN** 一个无人值守 / 定时 cron 运行针对非当前 vault 到点（后端结构上拒绝跨 vault 派发，隔离 runtime
  也不发面板事件）
- **THEN** 任何 vault 的行与标题栏钮都不因这次运行改变；其完成提示仍走 cron 既有通知通道

#### Scenario: 浮层收起时行标记不可见

- **WHEN** 某非当前 vault 有未读，用户关闭 vault 切换器
- **THEN** 行标记随浮层一起消失，MUST NOT 留下常驻角标、树头部标记或数字；再次打开浮层时按该 vault 的
  当前记录重建标记（不在关闭期间维护常驻 DOM 镜像）

#### Scenario: 新会话回包跨 vault 只清发起 vault

- **WHEN** 在 vault A 发起「新会话」，回包到达前切到 B，回包随后到达
- **THEN** 只清 A 的记录（A 从新会话起算）；B 的在途与未读记录 MUST NOT 被清、B 的视图 MUST NOT 被这次
  回包重建；切回 A 时按 A 的会话快照呈现

#### Scenario: 恢复回包跨 vault 只清发起 vault

- **WHEN** 在 vault A 恢复一个历史会话，回包到达前切到 B，回包随后到达
- **THEN** 只清 A 的记录；B 的记录与视图不受影响；A 恢复后的会话内容按既有恢复路径呈现，MUST NOT 把
  恢复内容写进 B 的 transcript

#### Scenario: 发送拒绝按发送时 vault 收口

- **WHEN** 在 vault A 发送后立即切到 B，A 的发送随后被同步拒绝（`harness_busy` / 缺配置）
- **THEN** 只撤销 A 的乐观在途记录（回到发送前状态）；B 的轮次闸门、transcript 与输入区 MUST NOT 被
  这次拒绝改动；切回 A 后不呈假在途

#### Scenario: 重启与 webview 重载不保留

- **WHEN** 某 vault 有未读时应用退出并重启，或 webview 重载且当前 vault 仍有一轮在后端运行
- **THEN** 应用重启：所有 vault 从空闲开始，MUST NOT 从磁盘回放未读；webview 重载：未读同样不回放，但
  当前 vault 的真实在途 SHALL 按进入快照的 `in_flight` 恢复、MUST NOT 呈假空闲；非当前 vault 没有快照，
  重载后其相位与未读暂时未知，直到该 vault 的后续事件到达或用户切回它并读快照（场景名的「不保留」只指
  未读水位，不指在途）

#### Scenario: 行标记不改变行的既有口径

- **WHEN** 非当前 vault 行显示「有新的回复」标记，用户输入查询筛选、用 ↑↓ 移动游标或点击该行
- **THEN** 匹配对象仍是显示名、结果集与游标空间不变、行内文本与可访问名不因标记改变、点击仍按既有
  切换语义发起切换；标记 MUST NOT 引入第二套键位或改变排序

#### Scenario: 三主题与语言纪律

- **WHEN** 在 light / dark / eink 三主题下分别呈现在途、未读回复、未读失败三态，或把界面语言切到 zh / en
- **THEN** 三态在每一主题下都可辨（eink 靠形状、不用彩色与中间调）；状态文案随语言重绘，取值来自文案表

#### Scenario: 空闲态零像素漂移

- **WHEN** 会话空闲且面板收起
- **THEN** toggle 钮的上屏像素与本次改动前逐像素相同（既有整页基线不更新）；三态的「在场」由结构断言守卫，
  MUST NOT 依赖整页像素容差（6px 级元素落在容差预算之内，像素对比对它没有区分度）

### Requirement: vault 根拼写统一与会话归属的目录身份判据

同一 vault 目录在所有打开入口 SHALL 只有**一种**根拼写：打开入口的公共函数（`prepare_vault_open`——启动
恢复、vault 列表切换、cron 目标三条来路都汇入此处）SHALL 先把请求根规范化为唯一的规范化路径，并以这一个
值作为 `VaultState.root`、harness 会话分桶键、`session_open.vault_root` 与 vault 注册表
`VaultWorkspace.path` 的共同取值；MUST NOT 由各调用方各自决定拼写。规范化失败（目录不存在 / 无权访问）
SHALL 拒绝打开并如实报错，MUST NOT 退回原始拼写继续打开。

归一之后，**同一目录 SHALL 只有一个 harness 会话桶**（会话表仍按归一后的根路径字符串分桶，该既有设计
不变；本条款只约束根的唯一来源，MUST NOT 引入第二份分桶键）：切走再切回同一目录 MUST 命中同一个会话，
`harness_state` MUST NOT 因根拼写差异返回空快照，界面 MUST NOT 因此呈现「空闲空会话」。

会话文件对 vault 的归属判据 SHALL 仍是首行 `session_open.vault_root`（判据字段不变；`sessions/<vault 稳定
id>/` 目录仍只作组织维度，MUST NOT 成为归属判据的第二真源）。比较口径 SHALL 是**目录身份**：记录值与当前
根逐字相等直接通过，否则两侧规范化后按同一目录判定；任一侧取不到身份（`vault_root` 缺失 / 非字符串 /
目录已删 / 无权访问）SHALL NOT 归属——MUST NOT 以「无法比较」当作相等放行。因此升级前写入的另一种拼写
（例如 macOS 上 `/tmp` 与 `/private/tmp` 是同一目录的两种写法）MUST 仍归属当前 vault：列举 SHALL 在场、
恢复 SHALL 可打开、删除入口按同一判据处理，MUST NOT 把它们判成别的 vault 的会话或孤儿。存量 JSONL 的写法
MUST NOT 被改写（`vault_root` 保持原样），也 MUST NOT 重新分桶；仓内一次性归位脚本的归属口径与本条同源
（先规范化再查注册表）。

#### Scenario: 两种拼写打开同一目录命中同一个会话桶

- **WHEN** 启动恢复用配置里的一种拼写（如 `/tmp/<vault>`）打开某 vault，随后从 vault 列表用注册表里的
  另一种拼写（如 `/private/tmp/<vault>`）切回同一目录，该会话此时有在途轮次
- **THEN** 两次打开得到的根逐字相同（均为规范化路径）；切回时 `harness_state` 命中同一个会话并返回其真实
  内容与在途读数，MUST NOT 返回空快照、MUST NOT 呈现空闲空会话、MUST NOT 出现第二个会话桶

#### Scenario: 存量会话不因拼写差异被判成孤儿

- **WHEN** 升级前写入的会话文件首行 `session_open.vault_root` 记着另一种拼写（同一目录），当前会话按规范化
  根运行
- **THEN** 该会话在列举里在场、可恢复、可删除；文件内容逐字节不变（`vault_root` 不改写）；归属结论只由其
  首行 `vault_root` 的目录身份决定，会话目录位置不构成归属判据

#### Scenario: 取不到目录身份不归属

- **WHEN** 某会话文件首行 `vault_root` 缺失 / 非字符串，或该目录已删 / 无权访问导致无法判定同一目录
- **THEN** 该文件不被判为当前 vault 的会话（不出现在列举、恢复入口不读它），MUST NOT 以「无法比较当作
  相等」放行

#### Scenario: 根不可规范化时拒绝打开

- **WHEN** 请求打开的 vault 根目录不存在或无权访问（规范化失败）
- **THEN** 打开动作 SHALL 失败并如实报错（工作区路径错误），MUST NOT 以原始拼写继续打开

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

### Requirement: CM 对话输入区与区外附件

对话输入区 SHALL 是一个最小 CodeMirror 6 纯文本编辑区；引用卡片、消息摘录卡片与图片卡片 SHALL 作为**零长度块级 widget** 渲染在文本之中（`Decoration.widget({ block: true, side: -1 })`），文档 MUST NOT 出现任何卡片占位字符、哨兵字符或隐藏结构。每张卡片的锚点 SHALL 是文档中的一个**精确 UTF-16 偏移**（`0 <= anchor <= doc.length`，不要求行首）；块级 widget SHALL 在该偏移把文本拆成前后两块：偏移之前的文字在卡上方、之后的文字在卡下方，偏移恰在行首时卡落在两行之间。同一偏移多张卡片 SHALL 合成一个 widget、按视觉次序纵向堆叠，新插入的卡片 SHALL 落在该堆叠的底部。卡片 MUST NOT 可编辑、MUST NOT 获得键盘焦点、MUST NOT 参与文本选区；caret、方向键、⌘A、⌘C、Backspace / Delete MUST NOT 进入或删除卡片。卡片与文字 SHALL 按视觉顺序进入 AX 阅读顺序（卡片摘录在前、其下方文字在后）；卡片标记 MUST NOT 出现在 **composer 的** `AXTextArea.value` 中，MUST NOT 被读成可编辑 / 可聚焦控件；编辑器源文档可以包含原始摘录，负向断言 MUST NOT 扩大到编辑器的 `AXTextArea.value`。文本编辑区 SHALL 只承载完整问题文字。

插入附件 SHALL 落在 caret 处：caret 之前的文字在卡上方、之后的文字在卡下方。caret 在行首时锚在该行行首；caret 在行中时 SHALL 先在该处插入一个真实换行把行拆开，卡片落在新行上方；caret 在行尾且其后还有行时 SHALL 锚在下一行行首，MUST NOT 额外插入空行；caret 在文末时 SHALL 补一个换行造出下方行。拆行 / 补行与卡片插入 MUST 在同一条 transaction。**上述行首只是初始插入的产物**：插入后 anchor 是行首；后续文本编辑 MUST NOT 把 anchor 钳回行首（见「CM composer 的单一 history」）。插入后 SHALL 把键盘焦点交给文本编辑区，caret 停在卡片正下方的行首，随后键入 MUST NOT 落进卡片；面板原本未打开时 SHALL 先打开面板再移交焦点。IME 组合期间的插卡请求 SHALL 进入 FIFO 队列并延迟到组合结束后按序落位；发送前 SHALL 先 drain，无法安全 drain 时 SHALL 延迟发送，MUST NOT 清空队列。延迟期间的发送意图 SHALL 由**单个一次性 `pendingSend`（带视图世代）**承载：重复触发合并为一次；`compositionend` drain 成功后仅触发一次发送；切 vault / 新会话 / 面板销毁同时取消；drain 失败 SHALL 取消发送、保留未消费请求，MUST NOT 投递缺卡消息。组合中的文本 MUST NOT 丢失、组合 MUST NOT 被打断。

附件 SHALL 只经移除钮移除；文本 Backspace / Delete MUST NOT 删卡。粘贴 SHALL 按剪贴板内容分派：含 `image/*` 时走「图片粘贴卡片」且图优先，其余内容只收 `text/plain` 并保留换行。新发送的用户消息 SHALL 按**块序**（文字行与卡片锚点的合并顺序）沉淀；块序即视觉顺序，MUST NOT 再把全部卡片硬编码到完整问题之前。历史已发送消息仍 SHALL 按留存原文交错显示。在卡片锚点处键入或粘贴的内容 SHALL 落在卡片下方。空消息判据 SHALL 仍是「文档为空且卡片为空」；只有空白文本不算消息。空态占位 SHALL 只在文档与卡片都为空时出现，MUST NOT 覆盖卡片。

composer 摘录正文 SHALL 通过 `data-excerpt + CSS ::before` 保留视觉呈现，出处、编号与动作 glyph SHALL 同样以 data 属性 + CSS pseudo 呈现。实际 AX 树的 textbox value SHALL 只含文档文字（块分隔换行除外），完整摘录 SHALL 只暴露一个阅读节点，出处与动作 MUST NOT 混入 value；动作的 `aria-label` SHALL 保留。copy listener SHALL 写入 `state.sliceDoc(main.from, main.to)`；空选区 SHALL 写入 `""`，MUST NOT 复制整段或卡片文本；`clipboardData === null` 时 MUST NOT `preventDefault()`，保留原生回退。

#### Scenario: 添加附件不拆文本且可直接继续输入

- **WHEN** 问题文字中已有合法 caret 且位于某行行首（不触发拆行的情形），用户从编辑器、transcript 或剪贴板加入一个附件
- **THEN** 卡片出现在该行上方（零长度块级 widget，文本逐字节不变）、caret 落在该行行首即卡片正下方，焦点在文本区，随后键入接在该行行首

#### Scenario: 文本键不改变附件

- **WHEN** composer 内有一张或多张卡片，用户在文本区执行 Backspace / Delete、⌘A、普通键入或 IME 组合
- **THEN** 只有文本 / 选区按各自语义变化，卡片数量、身份与相对顺序不变；anchor 按精确偏移随文档映射（MUST NOT 钳回行首），卡片只能经 × 移除

#### Scenario: 新消息附件前置、历史交错保留

- **WHEN** 用户在空输入区先插两张卡片、再在卡片下方输入完整问题并发送（本例全部卡片在文字之前），随后查看新消息和一条历史交错消息
- **THEN** 新消息先呈现全部卡片再呈现完整问题（块序的特例）；历史消息仍按留存的文字 / 卡片交错顺序呈现，MUST NOT 被迁移或重排

#### Scenario: 粘贴按剪贴板内容分派

- **WHEN** 在文本区粘贴多行纯文本，或粘贴同时含文字与图片的剪贴板
- **THEN** 纯文本只进入当前文本选区并保留换行，落在卡片下方的规则与键入相同；图文同板只把第一张图片写成卡片，夹带文字不得另行落入文本区

#### Scenario: 新消息按块序投递

- **WHEN** 用户输入前段、在中间插入卡片、再输入后段并发送
- **THEN** 新消息按文字 / 卡片 / 文字的块序呈现，MUST NOT 把卡片全部挪到前段之前；历史消息仍按留存原文呈现

#### Scenario: 行中插卡拆行

- **WHEN** caret 在某一行中间，用户加入一个附件
- **THEN** 该行在 caret 处拆成两行（插入一个真实 `\n`），卡片落在前后半句之间；拆行与卡片插入是同一条 transaction，一次撤销同时撤掉两者

#### Scenario: 文末插卡补行

- **WHEN** caret 在文档末尾（末行行尾或空文档），用户加入一个附件
- **THEN** 文末补一个 `\n` 造出下方行（空文档不补），卡片在全部文字之后、caret 在新行行首；随后键入从卡片下方开始

#### Scenario: 跨卡文本选区只删除文本

- **WHEN** 用户从一张卡片上方的文字选到卡片下方的文字，按 Backspace / Delete
- **THEN** 只有选中的文本被删除，选区覆盖的卡片全部保留；每张卡的 anchor 按精确偏移映射（不钳行首），不丢卡、不报错；随后 undo 恢复原 anchor 与块序

#### Scenario: 复制只取问题文字

- **WHEN** composer 内有卡片，用户 ⌘A 后 ⌘C，或选中跨卡的一段文本后 ⌘C
- **THEN** 应用内 copy 事件的数据逐字节等于选中的问题文字；系统剪贴板读取按平台归一后（统一行尾、去一个尾换行）相等；两者都不含卡片摘录、`×` / `@` 文本、占位字符或哨兵字符

#### Scenario: IME 组合期连续两卡后发送

- **WHEN** 用户在 IME 组合期间连续发起两次插卡请求，未等组合结束就触发发送
- **THEN** 发送投影前队列按序 drain，两张卡片按请求顺序落入 composer 并进入投递；MUST NOT 因发送清空队列、MUST NOT 丢任一张卡；组合文本不丢、组合不被打断

#### Scenario: AX 卡片不可编辑不可聚焦

- **WHEN** 读屏读取 composer 子树
- **THEN** 卡片摘录按视觉顺序出现在其下方文字之前；卡片标记 MUST NOT 出现在 **composer 的** `AXTextArea.value` 中，MUST NOT 作为可编辑或可聚焦控件暴露；编辑器源文档可以包含原始摘录，负向断言 MUST NOT 扩大到编辑器的 `AXTextArea.value`；composer 子树不可读时断言必须 FAIL，不得空过

#### Scenario: 延迟发送只触发一次

- **WHEN** 组合期已有插卡请求，用户在组合结束前连续触发两次发送（Enter / 发送钮）
- **THEN** 只有一个 `pendingSend` 被设置；`compositionend` drain 成功后只发送一条消息，MUST NOT 重复投递；重复触发不产生第二条消息

#### Scenario: 切视图取消延迟发送

- **WHEN** `pendingSend` 已设置，随后切 vault / 新会话 / 面板销毁
- **THEN** pending 被清空、旧视图的队列被清空，新的 `compositionend` MUST NOT 发送旧视图的消息；新视图的发送不受影响

#### Scenario: drain 失败不投递缺卡消息

- **WHEN** `pendingSend` 已设置，`compositionend` 后 drain 某条插卡请求失败
- **THEN** 发送被取消，未消费请求保留在队列中，MUST NOT 发出缺卡消息；后续可重试 drain，成功后才允许发送

### Requirement: CM composer 的单一 history

composer SHALL 使用 CodeMirror history 作为文本与卡片的唯一撤销 / 重做真源，MUST NOT 再维护 DOM / blocks 快照栈。卡片 SHALL 以 `{ id, card, anchor }` 记录：`id` 是会话内稳定身份，`anchor` 是文档中的**精确 UTF-16 偏移**（不要求行首）。卡片添加与移除 SHALL 由专用 StateEffect 更新 StateField；移除按 `id` 定位，MUST NOT 按下标定位；附件结构事务 SHALL 与相邻编辑隔离。composer MUST NOT 在现有 history 上执行 `addToHistory:false` 或 `remote` 的文档变更；装载 / 复位（草稿恢复、切 vault、发送清空）MUST 新建 `EditorState` 重置 history。新建会话、选择 / 恢复其他会话与会话重载 MUST NOT 复位 composer：文字、引用 / 消息摘录 / 图片卡片、Skill 引用、光标与撤销历史 SHALL 原样保留，下一次发送 SHALL 进入当前选中会话；这些切换 MUST NOT 清除当前 vault 的盘上草稿——草稿只在发送成功或用户手动删除时清除，其他 vault 的草稿与保留后的新输入不得受影响。切 vault MUST 恢复各 vault 自己的草稿，MUST NOT 跨 vault 混用；会话切换 MUST 作废在途的草稿恢复，迟到的读回 MUST NOT 覆盖会话切换后保留的输入区、MUST NOT 借此重建编辑史。MUST NOT 用 `state.update({annotations: Transaction.addToHistory.of(false)})` 在旧 state 上打补丁。连续文本输入 SHALL 按 CM history 聚簇；IME 整段 history SHALL 由 CM 管理，MUST NOT 在 compositionstart/end 手工压栈。导航本身 MUST NOT 产生编辑 undo 事件。

文本 Backspace / Delete、⌘A、普通输入、粘贴与 IME MUST NOT 发出附件增删 effect，因此不得增删或重排卡片；文本变更引起的 anchor 映射是机械重映射，不属于附件编辑。重置、草稿恢复、切 vault 和发送成功后的空输入 SHALL 是新的编辑史，MUST NOT 撤销回另一 vault 或已发送内容。新建 / 选择 / 恢复会话与会话重载 MUST NOT 产生新的编辑史：撤销 / 重做 SHALL 跨这些会话切换保留，MUST NOT 撤销回另一 vault 或已发送内容。

anchor SHALL 随 `tr.changes.mapPos(anchor, -1)` 做精确偏移映射，**MUST NOT 钳到行首**：删除行界后 anchor 落在行中时，块级 widget 在该偏移把文本拆成前后两块。映射后 SHALL 按新 anchor 与映射前视觉位次稳定排序，同锚点保持原相对次序。

anchor 的可逆性 MUST NOT 只靠 `mapPos` 反推。每次改变文档或卡片结构的事务 SHALL 携带 `composerAnchorsSyncEffect`（由事务扩展器写入事务后的完整 placed-attachment 数组）；`invertedEffects` SHALL 只为该 effect 产出逆 effect，逆 effect 携带事务前的完整数组；undo / redo SHALL 直接恢复该数组（含每张卡的精确 anchor 与顺序）。结构 effect MUST NOT 再单独提供 `invertedEffects`，避免撤销时双重应用。history 产生的 undo / redo 事务 MUST NOT 再追加前向 sync effect（`userEvent` 以 `undo` / `redo` 开头时跳过），否则前向 effect 会覆盖精确恢复值。sync effect 载荷是最终文档坐标，MUST NOT 再用 `mapEffect` 映射。sync effect 的 identity map MUST NOT 被用来给非 history 文档变更补映射：CM 会把旧 history 分支经 `mapEffects` 映射，identity 不会更新旧快照；若未来必须支持 `addToHistory:false` / `remote` 变更，须另设计快照重映射，MUST NOT 简单给 sync effect 加 `mapPos`（普通 history 分组也会调用 `mapEffects`，会造成二次位移）。

插入卡片与它伴随的换行 / 补行 MUST 在同一条 transaction，一次 undo 全还原、redo 全恢复；移除卡片的 undo SHALL 按逆 sync effect 恢复原 anchor 与原堆叠位次。

#### Scenario: 附件与文本共享可验证的 undo/redo

- **WHEN** 用户依次输入文字、添加卡片、移除另一张卡，再逐步 undo 和 redo
- **THEN** 每一步按统一 history 逆序 / 正序恢复相应文本、selection 与卡片；不存在只恢复文本或只恢复卡片的第二历史

#### Scenario: 连续键入与 IME 归 CM 聚簇

- **WHEN** 用户连续键入，或完成一段 IME 组合后撤销
- **THEN** CM 按其 history 聚簇恢复文本；产品没有 compositionstart/end 的额外快照步，卡片数量与相对顺序不变，anchor 按精确偏移映射（可落在行中）

#### Scenario: 插卡与拆行是一步 undo

- **WHEN** 用户在行中插入一张卡片，随后按一次 ⌘Z，再按一次 ⌘⇧Z
- **THEN** 一次 ⌘Z 同时撤掉卡片与拆行，文本回到插卡前逐字节；一次 ⌘⇧Z 同时恢复卡片与拆行，anchor 与堆叠位次不变

#### Scenario: 文本编辑后卡片不丢

- **WHEN** 用户在卡片上方 / 锚点处 / 卡片下方插入或删除多行文本，包括删除行界与跨行删除
- **THEN** 每张卡片仍在场，anchor 是文档中的精确偏移（可落在行中）；同锚点多卡的相对顺序与编辑前一致，MUST NOT 因钳制翻转；`composerBlocks()` 的文字 / 卡片顺序与视觉顺序一致

#### Scenario: 移除与撤销恢复原堆叠位次

- **WHEN** 同一锚点堆叠三张卡，移除中间一张后按 ⌘Z
- **THEN** 被移除的卡按逆 sync effect 回到原 `id`、原 anchor 与原上下位次，另外两张卡的数据与顺序不变

#### Scenario: 删除行界后块序不变

- **WHEN** doc 为 `A\nB`、卡片 anchor 为 2（A 与 B 之间），用户删除行界得到 `AB`
- **THEN** 卡片 anchor 映射为 1（A 与 B 之间），`composerBlocks()` 仍是 `[A, card, B]`，MUST NOT 变成 `[card, AB]`；块级 widget 在偏移 1 处把 `AB` 拆成前后两块

#### Scenario: undo 还原原偏移与 composerBlocks

- **WHEN** 上一条场景删除行界后按 ⌘Z
- **THEN** doc 恢复为 `A\nB`、卡片 anchor 精确恢复为 2，`composerBlocks()` 逐项恢复为 `[A, card, B]`；MUST NOT 只保证卡片不丢或卡片间顺序不翻转

#### Scenario: 全选替换后 undo 还原

- **WHEN** doc 为 `A\nB`、卡片 anchor 为 2，用户 ⌘A 后键入 `XYZ` 替换全部文本，再按 ⌘Z
- **THEN** 前向替换后卡片仍在场（anchor 收到替换起点 0），`composerBlocks()` 为 `[card, XYZ]`；undo 后 doc 与 anchor 精确恢复为 `A\nB` / 2，`composerBlocks()` 恢复为 `[A, card, B]`

#### Scenario: 非 history 文档变更被拒绝

- **WHEN** 代码尝试在现有 composer state 上以 `addToHistory:false` 或 `remote` 修改 doc
- **THEN** 该事务被拒绝（开发断言 / 过滤器），composer 内容与 history 不变；**重建 `EditorState` 的装载 / 复位路径（草稿恢复、切 vault、发送清空）旧 history 不可达**；新建 / 选择 / 恢复会话与会话重载 MUST NOT 新建 `EditorState`，**其旧 history 仍须可达（撤销 / 重做跨这些会话切换保留）**；MUST NOT 用 sync effect 的 `mapPos` 补映射

#### Scenario: 新建会话保留输入区

- **WHEN** 输入区含文字、引用卡 / 图片卡与 Skill 引用，caret 在文本中部，用户点击「新会话」
- **THEN** transcript 清空、会话名回到「新会话」；输入区的文字、卡片、Skill、光标与切换前逐字段相同，撤销历史仍可撤销；盘上草稿未被删除；随后的发送进入新会话

#### Scenario: 选择 / 恢复历史会话保留输入区

- **WHEN** 输入区含内容，用户从会话浮层选择另一条历史会话，或经 cron 结果通知打开其会话
- **THEN** 只切换消息列表与会话名；输入区内容、光标与撤销历史保持，下一次发送进入恢复后的会话

#### Scenario: 会话重载保留输入区

- **WHEN** 输入区含内容，面板按后端当前会话重载（cron 发起失败回滚 / 打开会话通知的重载通道）
- **THEN** transcript 按该通道重建，输入区 MUST NOT 被清空或重建编辑史；在途的草稿恢复 MUST NOT 覆盖它

#### Scenario: 新建失败不清输入区

- **WHEN** 用户点击「新会话」而 `harness_new_session` 的回包被拒绝
- **THEN** 面板只追加错误行；输入区内容、卡片、光标与撤销历史与点击前相同，盘上草稿不变

#### Scenario: 新会话取消发送意图但不清内容

- **WHEN** `pendingSend` 已设置（组合期），用户点击「新会话」
- **THEN** 旧视图的延迟发送被取消、插卡队列按既有口径清空；输入区的文字、卡片与光标保留，组合文本 MUST NOT 被清掉

#### Scenario: 连续切换不被在途草稿恢复覆盖

- **WHEN** 草稿读回在途时用户新建会话或重载会话（连续切换）
- **THEN** 迟到的读回 MUST NOT 铺进输入区、MUST NOT 重建编辑史；输入区保持会话切换时的内容

#### Scenario: 切 vault 仍按 vault 恢复草稿

- **WHEN** 输入区含 vault A 的内容，用户切到 vault B 再切回 A
- **THEN** 切到 B 时输入区按 B 自己的草稿恢复（B 无草稿则为空），切回 A 时恢复 A 的草稿；MUST NOT 把 A 的内容带进 B，MUST NOT 把 B 的草稿写进 A

#### Scenario: 发送成功仍清空并清草稿

- **WHEN** 用户在保留的输入区里直接发送且后端受理
- **THEN** 输入区清空，草稿按发送时定格的归属清除（「发送与写失败保留语义」条逐字不变）

### Requirement: 新消息的附件前置序列化协议

发送新消息时，系统 SHALL 按**块序**投影：把文档在每个卡片锚点**偏移**处切开，按文字 / 卡片锚点的合并顺序产出块序列；每段文档摘录一行 `<quote file="…" heading="…" lines="A-B">摘录原文</quote>`，消息摘录沿用 `<msg-quote>`；`lines` MUST 非空，属性值与文本节点 MUST 做 XML 转义。`projectDelivery` SHALL 继续单源产出 panelText 与 parts，发送方 MUST NOT 另写一套序列化。

文本区没有卡片时，`composerBlocks()` SHALL 产出与现行单段落文档相同的 `[paragraph(doc)]`，`panelText` 与「单段落文档的现行投影」逐字节相同（段落仍过 XML 转义，MUST NOT 声称与 doc 原文逐字节相同）。有卡片时，`panelText` SHALL 等于「把文档在每个锚点偏移处切开、插入该锚点上的卡片行后拼回」；`parts` SHALL 按块序在图片块处 flush 文本、图片 part 落在它的块位置，MUST NOT 再把完整问题统一放到最后。

序列化结构 SHALL NOT 包含引用 / 消息摘录卡片编号；图片仍是唯一例外，按「图片编号与引用」携带 `Image N` 结构化标签。序列化后的完整消息 SHALL 以 wire 形态逐字节留存。历史消息的任意交错解析与显示 SHALL 保留，MUST NOT 因新 composer 的块序语义改写历史 JSONL；重试仍回放 `input` 历史里的 user 消息原文，MUST NOT 从 composer 状态二次投影。

#### Scenario: 新消息统一附件前置

- **WHEN** 全部卡片都锚在问题文字之前（例如先插卡、再在卡片下方输入完整问题），用户发送
- **THEN** 投递先出现 `<quote>` / `<msg-quote>` 文本上下文及图片 part，最后才是完整问题——这是块序的一个特例；卡片相对顺序与视觉顺序一致

#### Scenario: 新消息按块序投影

- **WHEN** 当前文本是「前段 / 后段」，一张引用卡锚在前段之后、一张图片锚在后段之后，用户发送
- **THEN** 投递先出现前段文字、再出现 `<quote>`、再出现后段文字与图片 part；卡片相对顺序与视觉顺序一致，MUST NOT 出现「全部卡片在前、完整问题在后」

#### Scenario: 无卡时与单段落投影逐字节一致

- **WHEN** composer 只有纯文本（无卡片），文本含 `<`、`&` 等需要转义的字符
- **THEN** `composerBlocks()` 只产出一个段落块，`panelText` 等于现行单段落投影（同样的 XML 转义），`parts` 只有这一个 text part

#### Scenario: 转义与零编号回归

- **WHEN** 摘录原文或出处含 `<`、`&`、`"` 等字符，消息含引用 / 消息摘录与图片
- **THEN** XML 转义 round-trip 还原；`<quote>` / `<msg-quote>` 无序号属性，图片标签编号与卡片徽标一致

#### Scenario: 历史消息不改写

- **WHEN** 历史 JSONL 中一条用户消息是「问题1 / 卡片 / 问题2」交错形态
- **THEN** 恢复与 transcript 仍按原顺序显示和再投影，文件逐字节不变

### Requirement: 区外图片附件粘贴

harness composer SHALL 支持粘贴剪贴板图片：含 `image/*` 时拦截粘贴，把图片落到 `<config_dir>/harness/attachments/<vault 稳定 id>/` 的内容寻址文件，并按「CM 对话输入区与区外附件」的落位规则插入图片卡片。vault 稳定 id、MIME / 50MB / 转码 / 不降级分辨率、图优先、多图取第一项和不写 vault 的既有约束不变。图片落盘成功 SHALL 按 caret 落位：caret 在行首时锚在该行行首，在行中时拆行，在行尾且其后还有行时锚到下一行行首（不额外插空行），在文末时补行；caret 停在卡片下方行首，MUST NOT 删除或改写问题文字。失败后给人话 toast、不插卡片、不留半截临时文件。

图片卡片 SHALL 呈现可见缩略图与移除钮；字节经读回命令按需取，MUST NOT 把 base64 落进卡片数据、草稿或留存。发送后 transcript 按块序投影呈现，历史快照仍能从引用还原任意交错图片卡。

#### Scenario: 贴图只追加附件

- **WHEN** caret 在文末，用户粘贴一张 png 截图
- **THEN** 图片写 harness 附件目录，文末补一个 `\n`、图片卡片追加在全部文字之后；原文本逐字节保留、caret 在新行行首、焦点在文本区；vault 零写入，可直接继续输入

#### Scenario: 图文同板与失败回归

- **WHEN** 剪贴板同时含文字和多张图片，或图片格式不支持 / 超限 / 落盘失败
- **THEN** 前者只取第一张图且不写夹带文字；后者给对应 toast、无新卡片、无半截文件，原文本保持

#### Scenario: 行中贴图拆行

- **WHEN** 问题文字中间有 caret，用户粘贴一张 png 截图
- **THEN** 该行在 caret 处拆行，图片卡片落在前后半句之间；原文本逐字节保留、caret 在卡片下方行首；拆行与卡片插入是同一条 transaction

### Requirement: 附件前置图片投递协议

发送新消息时，系统 SHALL 把卡片按**块序**投影为 Responses API content parts：图片 part 落在它的块位置，文本 part 是相邻文字行的连续段；块序是唯一顺序，MUST NOT 以「全部附件前置」为固定投影（全部卡片恰在文字之前只是块序的一个特例）。文本与图片由既有 `projectDelivery` 同源产出，文本 part MUST NOT 包含引用 / 消息摘录卡片编号；图片按同一编号源携带 `Image N` 结构化标签。

会话 input 项与 JSONL MUST NOT 内联图片字节；图片以 `lumir-attachment://<内容寻址名>` 引用留存，provider wire 在发送前展开为 data URL。展开失败不得静默缺图；引用按当前 vault id 解析，历史恢复继续从 wire 引用还原图片卡片及其历史交错位置。块序投影 MUST NOT 改变 wire 的 part 类型、标签格式或留存形态。

#### Scenario: content parts 附件前置

- **WHEN** 全部卡片都锚在完整问题之前（例如先插图片 A、引用卡、图片 B，再在下方输入多行问题），用户发送
- **THEN** 图片 A / B 的 parts 与引用上下文都在完整问题之前，图片相对顺序和标签为 Image 1 / Image 2；这是块序的特例，问题换行完整保留

#### Scenario: content parts 按块序交错

- **WHEN** 块序为「文字 A / 图片 X / 文字 B / 引用卡 / 文字 C」，用户发送
- **THEN** parts 依次是 text(A)、image(X, Image 1)、text(B + 引用上下文 + C)；图片标签与卡片徽标一致，问题换行完整保留

#### Scenario: 引用进留存、展开进 wire

- **WHEN** 携带图片卡片的交错消息发出并落盘
- **THEN** JSONL 中只有 harness 附件引用且无 base64，provider 请求同位置是展开后的 data URL；展开失败则本轮人话收口、不缺图发送

#### Scenario: 历史交错消息不改写

- **WHEN** 恢复一条历史交错消息，其中图片卡在文字之间
- **THEN** 恢复路径按留存原文还原图片卡片及其交错位置，JSONL 逐字节不变；编号按该消息自己的图序重建

### Requirement: composer 草稿 v2 与一次性 v1 转换

composer 内容 SHALL 作为当前 vault 的一份草稿自动保存与恢复；落点、tmp+rename、无 vault 不落盘、防抖、离散 flush、无变更不写、写失败 warning、串行写清、per-vault 隔离及发送成功 / 失败语义不变。草稿 MUST NOT 写入 vault。每次写入链 SHALL 捕获当前编辑世代；写失败时只有 epoch 未变且期间无新编辑才允许恢复原 pending。新编辑写已入链时，旧写 MUST NOT 借失败回填取得待写所有权；无新编辑时仍 SHALL 保留失败内容供后续 flush 重试。

草稿的归属 SHALL 在出发时绑定：前端在装载 vault 时记下该 vault 的稳定 id，读、写、清除命令 MUST 携带它；后端 SHALL 只按携带的 id 解析落点，MUST NOT 读取当前打开的 vault。切 vault 之前发出的在途写无论何时执行 MUST 只落它出发时的 vault 的文件，MUST NOT 写进之后打开的 vault；在途读的结果 MUST 按装载世代作废，不得覆盖新 vault 的输入区或「已落盘」基准。写失败重试 SHALL 仍打出发时的归属 id。切换 vault 时旧 vault 的待写按既有纪律丢弃（由切换前的 flush 写走），其迟到失败 MUST NOT 回填新 vault 的待写、MUST NOT 改变新 vault 的「已落盘」基准。

新草稿 SHALL 是 `{version:3,text,caret,cards,skills}`：text 是完整问题，caret 是 `[0,text.length]` 内 UTF-16 offset 或 null，cards 按**视觉顺序**逐项保存 `{card, at}`——`card` 是既有附件记录，`at` 是该卡的**精确 UTF-16 偏移**（不要求行首，`0 <= at <= text.length`）；skills 是显式选择引用数组，每项 `{name,from,to}`，from/to 是 `text` 内的 UTF-16 偏移，与 caret、卡片 `at` 同属 `text` 坐标，切片必须逐字节等于 `/名字`；CRLF 归一时 SHALL 按共同出口的同一映射重定位。读取时越界、切片不匹配或名字不合 `/` 调用 grammar 的引用 MUST 被丢弃，MUST NOT 影响草稿其余内容的恢复。skills MUST NOT 保存用户 / 模型调用策略快照；发送时 SHALL 按当前 Skill 策略重新判定。图片只存内容寻址名、源 mime 与可选宽高，MUST NOT 内联 base64；v3 合法往返必须逐字段还原（含 refs）。`id` 不写盘，恢复时按数组顺序重新编号。

**CRLF 归一放在所有版本解析 / 迁移完成后的共同出口**：CM 在 `EditorState.create` 时按 `/\r\n?|\n/` 分行并统一为 LF，原始 CRLF 坐标（caret / 卡片 `at` / refs 的 `from` / `to`）不能直接灌进 state。v1 / v2 / v3 SHALL 先各自解析 / 迁移成同形状草稿（`{text,caret,cards:[{card,at}],skills:[{name,from,to}]}`，仍是原始坐标），再统一把 `\r\n` / `\r` 归一为 `\n`，并用同一份原始 offset → 归一 offset 映射重定位 caret、每张卡的 `at` 与每个 ref 的 `from` / `to`；MUST NOT 只映射其中一部分。归一后的草稿 SHALL 同时用于**写回 v3**与**创建 `EditorState`**；refs 的范围 / 切片 / grammar 校验 SHALL 在归一并重映射之后进行，MUST NOT 用原始坐标校验后把旧偏移留在归一草稿里。MUST NOT 只归一文本而保留原始坐标，MUST NOT 让写回与 state 使用两份不同坐标。混合行界（`\r\n` / `\r` / `\n` 混用）按同一扫描处理。

现存 v2 与 v1 都是迁移的具体消费者。读到合法 v2 时 SHALL 一次性转换：可见内容保留，**行尾及坐标按共同出口的统一映射归一**（不是字节级原样保留）；全部卡片落 `at: 0`（等价于 v2 的「卡片全在前」语义），caret 由原始偏移映射到归一文本坐标；skills 为空。读到合法 v1 时 SHALL 沿用现行转换（段落按原顺序以 `\n` 连接，未知块以可见 JSON 文本加入，卡片按相对顺序全部抽入 cards；段落 caret 精确映射，卡片 / 末尾边界映射到最近后续文本块起点，无后续则全文末尾），再全部落 `at: 0`，skills 为空。v1 / v2 转换成功后 SHALL 立即经既有串行 store 写回 v3，此后只读 / 只写 v3；MUST NOT 双写、保留旧编辑路径或建立通用迁移平台。load 起始 SHALL 捕获编辑世代；读盘期间发生新编辑时 MUST 跳过旧迁移写回及 written 基准覆盖，保留当前 pending / written。迁移写一旦入串行链，后续编辑写 SHALL 排在其后，最终落盘必须是最新输入。损坏 v1 / v2 / v3 安静回空；迁移写失败不谎报已保存。

发送被同步拒绝、而拒绝回包晚于用户的下一条输入时，输入区的合并 SHALL 保持「原文在前、当前在后」：文本为 `restored.text + current.text`，当前卡片的 anchor 平移 `restored.text.length`，再按精确偏移稳定排序；恢复侧的 skills 引用保持原偏移，当前侧 skills 引用同样平移 `restored.text.length`，合并后逐条按 v3 规则重新校验。MUST NOT 为对齐行首补换行、MUST NOT 钳到行首。精确偏移模型下，当前卡片平移到原文末尾后由块级 widget 在该偏移拆文本，自然落在原文之后、当前文字之前。当前侧为空态时 SHALL 原样返回 restored。

#### Scenario: v2 往返与合法 caret

- **WHEN** 盘上是合法 v2 草稿，包含多行文本、三类附件和文本中部 caret，装载同一 vault 后重开
- **THEN** text / caret / cards 逐字段保留（全部卡片落 `at: 0`，即 v2 的「卡片全在前」语义），skills 为空，图片引用不变且无 base64；读回后立即写回 v3，重新装载 v3 仍逐字段还原

#### Scenario: v1 一次性转换不丢内容

- **WHEN** 现存 v1 含交错段落、未知块、三类卡片与段落 / 卡片 / 末尾 caret
- **THEN** 所有段落和未知块可见文本各出现一次，卡片相对顺序不变且全部落 `at: 0`，skills 为空，caret 按合同映射且合法；成功后盘上只写一份 v3，无双写

#### Scenario: 发送与写失败保留语义

- **WHEN** 发送成功、发送被能力闸拒绝，或草稿写盘失败
- **THEN** 成功清空草稿；拒绝恢复发送前 text / caret / cards / skills 且草稿不变；写失败给 warning、不阻断输入、不谎报已保存

#### Scenario: 旧写失败不夺回新编辑的待写所有权

- **WHEN** v1 / v2 迁移写或普通 v3 旧写在途，新输入 flush 已入串行链，随后旧写失败、新写成功并再次 flush；对照组旧写失败期间无新编辑
- **THEN** 前者再次 flush 不得写出旧内容，盘上逐字节保持新输入；对照组保留原待写并可在下一次 flush 成功重试

#### Scenario: 迟到的旧写不串台

- **WHEN** vault-a 的草稿写已发出但在途，随后切到 vault-b 完成装载，旧的写才执行
- **THEN** 它只落 vault-a 的草稿文件、逐字节不改 vault-b 的草稿；vault-b 的后续编辑只写 vault-b

#### Scenario: 迟到的旧读不污染新现场

- **WHEN** vault-a 的草稿读已发出但在途，装载 vault-b 的读先完成，旧的读才返回
- **THEN** 旧读结果整体作废（不返回内容、不铺进输入区），vault-b 的「已落盘」基准与盘上草稿不变

#### Scenario: v3 往返与合法 caret

- **WHEN** 草稿包含多行文本、三类卡片、行首与**行中**锚点、显式选择引用和文本中部 caret，保存后重开同一 vault
- **THEN** text / caret / cards / skills 逐字段恢复，每张卡（含行中 anchor）与视觉顺序不变，图片引用不变且无 base64；失效引用被丢弃且不影响其余内容；草稿不含调用策略快照，发送时按当前策略判定；撤销史不跨进程恢复

#### Scenario: CRLF v3 装载与坐标重映射

- **WHEN** 盘上 v3 草稿的 text 是 `A\r\nB\r\nC`，caret 在 B 之后（原始 offset 4），一张卡片的 `at` 指向 C 行首（原始 offset 6）
- **THEN** 创建 state 前文本归一为 `A\nB\nC`，caret 与 `at` 用同一映射重定位（分别变为 3 与 4）；恢复后的文本、caret、anchor 与 `composerBlocks()` 顺序全部正确，MUST NOT 把原始 CRLF 坐标直接灌进 state

#### Scenario: CRLF 归一不丢 Skill 引用

- **WHEN** 盘上 v3 草稿的 text 是 `A\r\n/acc-skill-abc `，含一个引用 `{name:"acc-skill-abc",from:3,to:17}`（原始切片逐字节等于 `/acc-skill-abc`），caret 与一张卡片的 `at` 都在文末（原始 offset 18）
- **THEN** 共同出口把文本归一为 `A\n/acc-skill-abc `，同一映射重定位引用为 `[2,16)`（切片仍逐字节等于 `/acc-skill-abc`）、caret 与卡片 `at` 为 17；恢复后引用保留并照常出 chip，MUST NOT 用旧偏移 `[3,17)` 切成 `acc-skill-abc ` 后丢弃该引用

#### Scenario: CRLF v2 caret 归一

- **WHEN** 盘上 v2 草稿的 text 是 `A\r\nB\r\nC`，caret 在 B 之后（原始 offset 4），cards 含一张卡片
- **THEN** 迁移先得到 v3 形状（卡片 `at: 0`，caret 仍为原始 4），共同出口把文本归一为 `A\nB\nC`、caret 映射为 3；写回的 v3 与创建的 state 都用这份归一草稿，MUST NOT 把 caret 4 直接灌进 state

#### Scenario: 混合行界 v1 归一

- **WHEN** 现存 v1 的段落文本混用 `\r\n`、`\r`、`\n`（如 `A\r\nB`、`C\rD`、`E\nF`），caret 位于其中一个段落之后
- **THEN** v1 转换后走共同出口：所有行界归一为 `\n`，caret 按同一原始 offset → 归一 offset 映射重定位，可见文本一段不丢；写回 v3 与创建 state 使用同一份归一坐标

#### Scenario: 写失败重试仍落出发时的 vault

- **WHEN** vault-a 的草稿写失败（人话 warning），随后用户在 vault-a 里再次 flush
- **THEN** 重试携带的归属仍是 vault-a，成功后才更新 vault-a 的草稿；期间切换到的其他 vault 的草稿与待写不受影响

#### Scenario: 发送被拒合并不丢卡片

- **WHEN** 发送被拒的回包晚于用户的下一条输入：原文末尾无换行，当前侧已粘贴一张图片卡片
- **THEN** 合并结果是「原文 + 当前文字」（MUST NOT 补换行），当前图片卡 anchor 平移原文长度后恰好落在原文末尾、当前文字之前；块级 widget 在该偏移拆文本，两边内容一张不丢，anchor 不需要是行首

### Requirement: 区外图片附件编号与引用

图片编号 SHALL 在一条消息内按**块序** 1-based 分配，只计图片块，不含引用 / 消息摘录或文本；移除后即时重编且无空号。编号 MUST 是派生读数，不持久化进卡片源数据；composer 徽标、transcript 与投递标签共用同一编号函数，MUST NOT 从卡片数组下标另取一份。

composer 图片卡片 SHALL 提供 `@` 钮，点击在当前文本选区插入普通 `Image N` 文本，不拆段落；插入后 caret 在文本之后。`N` SHALL 在点击时按附件 id 在块序里反查，MUST NOT 使用渲染时的旧编号。后续图片重编号 MUST NOT 静默改写已插入文本。发送时每张图片的标签紧邻其内容之前，标签进 provider wire、以结构化字段留存而不进留存文本面；历史恢复继续按原图序重建编号。

#### Scenario: 删除重编与 @ 插入

- **WHEN** 输入区按块序有图片 A / B / C，删除 A 后在问题中部点击新编号 B 的 @
- **THEN** 剩余卡即时显示 1 / 2；原 caret 处插入普通 `Image 1`，文本不拆段、caret 在插入文本之后，既有引用文本不被重写

#### Scenario: 徽标与 wire 标签同源

- **WHEN** 发送含两张图片且未使用 @ 的消息，随后恢复历史
- **THEN** 两个图片 part 分别带 Image 1 / Image 2，编号与发送时徽标一致；留存文本面无标签行，历史恢复编号不变

### Requirement: 区外消息摘录附件

系统 SHALL 提供消息摘录手势：在 transcript 用户 / 助手消息体内选中片段后出现浮动「摘录到对话」钮，点击把消息摘录按「CM 对话输入区与区外附件」的落位规则加入对话输入区；面板未打开时先打开。选区稳定时机、落点钳制、排除思考 / 工具 / 批准 / 引用卡内部选区和两手势互斥不变。附件呈现竖条、至多两行摘录、`对话 · 角色` 出处、移除钮与完整摘录 / 绝对时间 hover；数据保留 role、可缺 at 与所见文本。

点击附件 SHALL 按 role+at → 摘录原文搜索 → 失锚 toast 的三层路径跳回并瞬态高亮，MUST NOT 静默跳到其他消息。插入 SHALL 按 caret 落位规则执行：可能拆行 / 补行、caret 落到卡片下方行首，MUST NOT 删除问题文字；完成后焦点回文本区。携带消息摘录时继续跳过视口注入；历史快照仍按留存原文还原消息摘录卡及其历史交错位置。

#### Scenario: 消息摘录入 tray 后可继续输入

- **WHEN** 在 transcript 助手消息中选择一段并点击摘录钮，且 composer 的 caret 在某行行首（不触发拆行的情形）
- **THEN** 该行上方新增消息摘录卡片，原文本逐字节不变、caret 落在该行行首即卡片正下方、焦点回文本区；随后可直接继续输入，点击卡片可定位来源并高亮

#### Scenario: 排除面、失锚与历史恢复

- **WHEN** 选区来自排除面，或来源消息已不在当前会话，或恢复一条历史交错消息
- **THEN** 排除面不产卡；失锚给 toast 不错跳；历史消息仍按原交错顺序显示并还原 role / at / 摘录文本

### Requirement: CM composer 的 Emacs 文本导航族

composer 的 Emacs 文本导航族 SHALL 经统一键位表 `text` 作用域分发，并适配到 CM EditorView / EditorState；MUST NOT 再由旧块模型或浏览器原生 contenteditable caret 决定。键位覆盖不变：⌃F/B、⌃A/E、⌃N/P、⌃D/H、⌥D/⌥⌫、⌃K/Y、⌃T、扩选六键与按词扩选；族外键位路径不变。

所有命令只作用于纯文本。字符与视觉行移动、逻辑行首尾和扩选 SHALL 用 CM 移动原语；扩选 anchor 不动。字素簇 / 词边界 SHALL 复用编辑器共享扫描核；⌃D/H 与**折叠光标上的无修饰物理 Backspace** 删除一个字素簇或选区（同一份 `clusterBackward` 步长），⌥D/⌥⌫ 按词 kill，⌃K kill 到逻辑行尾（在行尾则杀行界），⌃Y 插入共享 kill 槽，⌃T 转置相邻字素簇。kill 槽继续跨编辑器 / composer 共用，内容不含卡片。任何文本命令 MUST NOT 添加、移除或重排卡片；anchor 按精确偏移随文档映射（MUST NOT 钳到行首），不属于「重排」。

物理 Backspace / Delete 的 `deleteContentBackward` / `deleteContentForward` SHALL 由 composer 的 `beforeinput` 闸门按统一选区事务合同处理：单区间非空选区 MUST `preventDefault()` 并按 `state.selection` 删除；折叠 caret 上只有 Backspace（`deleteContentBackward`）由本闸门接管，按同一份 `clusterBackward` 删一个整字素簇，forward Delete 交还原生路径。一次删除 = 一条 history 步（一次 undo 复原）。修饰键变体（`deleteWordBackward` / `deleteHardLineBackward` / `deleteSoftLineBackward`）、IME 组合期、只读会话与多区间 MUST NOT 被本闸门改变；MUST NOT 在 composer 侧复制第二份字素判定表。

#### Scenario: 文本移动、扩选与删除不触附件

- **WHEN** composer 内有卡片，用户在多行 / 软折行文本中执行移动、扩选、字符 / 词删除和转置
- **THEN** 文本与 selection 按 CM / 共享词法语义变化，导航不产编辑 undo；卡片数量、身份与相对顺序不变，anchor 按精确偏移映射（可落在行中）

#### Scenario: 物理 Backspace 与 ⌃H 同一步长

- **GIVEN** composer 文档为 `A مَ B`、`x👍🏽y` 或 `xe\u0301\u0323y`，caret 在簇之后且无选区
- **WHEN** 按一次无修饰 Backspace
- **THEN** 文档分别变为 `A  B`、`xy`、`xy`——base 与全部附标 / 修饰符一起删除，MUST NOT 只剩码点后缀
- **AND** 同一次按压的 `editor.delete-char-backward`（⌃H）结果逐字节相同；一次 undo 复原；卡片不增删，anchor 按精确偏移映射

#### Scenario: kill-yank 跨面共用

- **WHEN** 在编辑器 kill 一段多行文本后到 composer yank，再反向操作
- **THEN** 两侧使用同一 kill 槽与连续 kill 合并规则，多行文本进入当前文本选区，卡片不成为 kill 内容

### Requirement: CM composer 的文本全选

焦点在 composer 文本区时按 ⌘A SHALL 经统一键位表选择 `0 → doc.length` 的全部问题文字，MUST NOT 选到编辑器 / transcript，也 MUST NOT 选择、删除或高亮卡片。后续删除 / 键入只替换全部文本；undo 恢复文本与 selection，卡片数量、身份与相对顺序保持不变（anchor 按精确偏移映射，MUST NOT 钳到行首）。选区绘制 SHALL 使用 CM 自身选区层，不再存在旧块级自绘高亮。

#### Scenario: 全选只覆盖文本

- **WHEN** composer 有多行问题和多张卡片，按 ⌘A 后键入一个字符再撤销
- **THEN** 键入后文本只剩该字符、卡片全部在场且相对顺序不变；撤销恢复全部原文本，整个过程中卡片数量、身份与相对顺序不变，anchor 按精确偏移映射（不要求行首）

### Requirement: composer 竖直移动的同列位口径

> 与 `move-composer-to-codemirror-nov18` 的「CM composer 的 Emacs 文本导航族」同题：本条只收敛
> **竖直移动的列位单位**，不复制其余条款。living spec 里「同 x 位」的措辞由本条取代——真机 140
> 在 M831 之前交付的是字符列（旧实现 `caretRangeFromPoint` 两个引擎都取左侧边界），M831 换内核后
> CM 的像素 goal column 把它读成右一列，Alex 在真机上裁决期望为「上一行同列 2」。

composer 的 ⌃N / ⌃P（含 ⇧ 扩选形态）SHALL 在**渲染行**之间移动，同列位 SHALL 是**行内字符列**
（行首起的 UTF-16 offset 差），MUST NOT 是像素 x 或「像素上最近的字符边界」。软折行产生的一屏行
SHALL 是一个停靠行；行选择 MAY 交给引擎的竖直移动原语，列位 MUST 按目标渲染行的字符列重算。
落点超出目标行长度时 SHALL 钳到该行行尾。连续竖直移动 SHALL 保留目标列：越过短行被钳位后，继续
同方向到达长行时 MUST 回到原列。水平移动、键入与换行 SHALL 重置目标列。⌃N / ⌃P 本身 MUST NOT
修改文档或产生编辑 undo 事件；文档首 / 末行的原地不动 SHALL 回落行首 / 行尾。

实现 MUST NOT 读取 DOM Range 几何或重建第二套 caret 模型来定列位。

#### Scenario: 短行行尾回长行取字符列

- **WHEN** 文档是 `yabzcdw\nmn`、caret 在末行行尾（列 2），composer 字体为比例字体，按 ⌃P
- **THEN** caret 落到第一行第 2 列（`ya|bzcdw`），随后键入 `p` 得 `yapbzcdw`，MUST NOT 落到第 3 列
  （`yab|zcdw`，像素 goal column 的缺陷签名）

#### Scenario: 连续上下移动保留目标列

- **WHEN** caret 在第 3 行第 10 列，依次按 ⌃P、⌃P、⌃N、⌃N，中间一行只有 2 列
- **THEN** 落点依次为第 2 行行尾（列 2，钳位）、第 1 行第 10 列、第 2 行行尾、第 3 行第 10 列；
  文档与撤销栈全程不变

#### Scenario: 软折行仍逐屏行移动

- **WHEN** 一个逻辑行在 composer 宽度内软折成多屏行，caret 在第 2 屏行第 5 列
- **THEN** ⌃P 落到第 1 屏行第 5 列、⌃N 回到第 2 屏行第 5 列（MUST NOT 一步跳到上一 / 下一逻辑行）

### Requirement: 留存健康状态

系统 SHALL 为每个活跃逻辑会话维护**两个相互独立**的留存健康维度：**当前写健康**（`state`：这段会话的留存现在还能不能写）与**历史缺口**（`history_gap`：这段会话是否已经缺失恢复所依赖的记录，或文件是否可能因部分写而损坏）。两者 MUST NOT 合并成一个 `ok/degraded`：一次成功追加只证明写能力恢复，不能补回已经缺失的记录。另有辅助事实 `history_written`（本逻辑会话是否已有至少一条 `llm_request` / `llm_response` 成功写盘），只用于「尚未落盘」提示，不是第三个健康维度。

当前写健康：任意一次写失败（序列化 / 打开 / 首行写入 / 行写入）SHALL 使 `state` 转 `degraded`；此后任意一次成功追加 SHALL 使其转回 `ok`。`state=degraded` SHALL 带 `severity` 与 `detail`：`severity` 为 `history`（失败记录属于 `llm_request` / `llm_response`；或失败可能已在文件里留下部分字节；或首行 `session_open` 失败）或 `annotation`（仅 sidecar 且没有任何字节落盘）；`detail` SHALL 记录本段 `degraded` 首次失败的分类，后续失败不刷新，恢复时清空。`annotation` 级失败 MUST NOT 降低已有的 `history`。

历史缺口：`history_gap` SHALL 是 latch，包含 `present` / `since_ts` / `detail`。以下任一情况 SHALL 置 `present=true`，并记录首次缺口时间与首次缺口分类：

- `llm_request` / `llm_response` 任一次写失败（无论是否留下部分字节——该记录永久缺失）；
- 任意一次写失败可能已在文件里留下部分字节（无法区分时 MUST 按「可能部分写」处理——JSONL 完整性可能受损）。

`history_gap.present=true` 后，后续成功追加、自动压缩换文件、切 vault MUST NOT 清除它；只有产生新的逻辑会话（显式「新会话」、从历史恢复、app 重启后重新建立会话）才从 `present=false` 起算。`annotation` 干净失败 MUST NOT 置 `history_gap`，也 MUST NOT 清除或降低已有的缺口。

**首行失败必须同时评价本次 `record(payload)` 的 payload**：`record(payload)` 在首行写入失败时直接返回，本次 payload 也没有写出、没有被 `pending_open` 保存。因此：

- 本次 payload 是 `llm_request` / `llm_response`：即使首行干净失败（未写入任何字节），该 payload 也随本次调用永久丢失 → `history_gap` SHALL 置 true；后续重试成功只恢复当前写健康，MUST NOT 补回这条记录，也 MUST NOT 清缺口。
- 本次 payload 是 annotation：首行失败 SHALL 只影响当前写健康（`severity=history`），不置 `history_gap`；annotation 丢失不 latch。首行重试成功后当前写健康回 `ok`。
- 本次只写首行、没有 payload 被丢弃（若存在这种独立写首行的路径）：不置 `history_gap`。

写点 MUST 保留挂起的 `session_open` 行，使下一条记录仍先重试写首行。首行或任意记录的部分写 SHALL 置 `history_gap`。系统 MUST NOT 承诺部分写后的文件仍可被完整读取或恢复；已损坏的文件不修复、不截断。唯一的例外是恢复会话文件的首次发布：它 MUST 采用原子发布（临时文件完整写入后不覆盖地发布最终 JSONL）；**本次发布 MUST NOT 创建空 / 半截最终文件；撞名时既有目标 MUST 逐字节保留**（见「会话本地留存」条）；该例外不适用于发布成功之后的 append-only 写入，也不修复既有损坏文件。

**已激活但未发布的恢复批次** SHALL 单独评价，不与已发布文件的 append-only 失败混同。从历史会话恢复、首次真实请求已使恢复激活（`activated=true`）而文件尚未发布时，激活时形成的批次（`session_open` / `inherit` / `notice_delivered` / 已产生的 history 记录）SHALL 完整保留在内存中；此期间发布失败 SHALL 置当前写健康为 `degraded`、`severity=history`、`detail` 记录发布失败分类、`since_ts` 记首次失败时间，但 MUST NOT 置 `history_gap.present=true`——缓冲记录尚未永久丢失，MUST NOT 提前制造缺口，也 MUST NOT 发 `false→true` 的缺口事件。`history_written` 保持 `false`；呈现 SHALL 用「对话暂未保存」与「现在退出，这段对话将无法恢复」两段文案，MUST NOT 使用缺口文案「此前部分对话记录未能保存」。全部缓冲记录随后一次发布成功时，当前写健康 SHALL 转 `ok`、`history_written` SHALL 转 `true`、`history_gap.present` 保持 `false`，MUST NOT 出现假缺口。若退出前始终未发布成功，该批记录随内存消失且 MUST NOT 在重启后补报——它不属于 latch 口径（文件从未存在）。已发布之后的普通 append-only 写入（含部分写）仍按本条的既有口径判缺口。因未发布批次被拒绝的查看切换 / 显式新会话，或被跳过的压缩轮换 / 落回的 overflow 终态，MUST NOT 重置、清除或改写当前健康（`degraded`、`since_ts`、`history_written`、`history_gap` 全部保持）。

`history_written` SHALL 在本逻辑会话第一条 `llm_request` / `llm_response` 成功写盘时转 `true`，同一逻辑会话内不再回落；自动压缩换文件沿用；新逻辑会话重置为 `false`。它 MUST NOT 参与 `history_gap` 判定，只决定「现在退出，这段对话将无法恢复」这条退出风险句是否还在。

`since_ts`（当前写健康）SHALL 记录本段 `degraded` 首次失败时间，恢复时归零；`history_gap.since_ts` SHALL 记录本段首次缺口时间，新逻辑会话时归零。

健康状态 SHALL 在 `harness_state` 快照的 `persistence` 键与 `harness:event` 的 `persistence` 事件两处呈现，**同键同值**：顶层 `state` / `since_ts` / `severity` / `detail` / `history_written` / `history_gap` 六键恒在场；`history_gap` 内 `present` / `since_ts` / `detail` 三键恒在场。`state=ok` 时 `severity` 为 `null`、`since_ts` 为 0、`detail` 为空串；`history_gap.present=false` 时其 `since_ts` 为 0、`detail` 为空串。事件与快照 MUST 共用同一份序列化，MUST NOT 各列一份键清单。`state=ok` 且 `history_gap.present=true` 是合法状态，MUST NOT 被呈现为健康。

事件 SHALL 在以下跃迁时发出：当前写健康 `ok→degraded`、`degraded→ok`、`annotation→history`；历史缺口 `false→true`；`history_written` `false→true`。一次失败 / 成功可同时改变多项，发出一条完整载荷；`degraded→ok` 且缺口仍为 true 的恢复事件 MUST 发出。重复失败不发事件，快照是重挂载 / 重载时的地板。

呈现：`history_gap.present=true` 期间，harness 面板 SHALL 在 composer 上方持续显示一条警示块（`role="status"`，浅警示色底 + 左侧警示边条、正文色、完整换行，不用红色），文案 MUST 明确「此前部分对话记录未能保存」；`state=ok` 时 MUST 明确「新内容已恢复写入」。`state=degraded` 且缺口在场时，文案 MUST 同时说明当前写入仍未保存（「对话暂未保存」）并给出检查磁盘空间 / 目录权限的下一步；`state=degraded` 且无缺口时，警示块按 `severity` 显示当前失败。`history_written=false` 且存在任何持久化告警（`state=degraded` 或缺口）时，文案 MUST 额外说明「现在退出，这段对话将无法恢复」；`history_written` 转 true 后该句消失，缺口文案仍保留。警示块不自动消隐、不随轮次结束消失、不提供关闭按钮；`state=ok` 且无缺口时 SHALL 隐藏（`history_written=false` 本身不构成告警，只在已有告警时追加退出风险句）。

本逻辑会话首次进入 `severity=history`（包括先 `annotation` 后升级为 `history`）或 `history_gap` 首次 `present=true` 时，SHALL 额外给一条 sticky 提示，每个逻辑会话只一条，按文案去重，面板重挂载不重复。无动作的 history sticky SHALL 提供原生可聚焦关闭钮（`button`，读屏名「关闭提示 / Close notification」）与 Escape 关闭路径：Tab 可达，Enter / Space 触发 click；MUST NOT 自动抢焦点。Escape 准入 MUST 复用 `src/escape-router.ts` 的 `escapeDisposition()`：组合期 / `keyCode=229` 不关、不消费；⇧/⌘/⌃/⌥+Escape 只消费默认行为、不关；普通 Escape 关闭 sticky，且 MUST NOT 连带关闭面板。关闭（Enter / Space / Escape / 点击）后 SHALL 把焦点归还到提示出现前的有效元素；该元素失效时回落到 composer 区域，MUST NOT 落到 `body`。其他无动作 sticky MUST NOT 因此新增关闭钮或改变 DOM。sticky MAY 点击关闭；关闭只移除本次提示，MUST NOT 隐藏警示块、MUST NOT 清除 `history_gap`、MUST NOT 被视为对未来失败的静音。两类呈现 MUST NOT 提供额外的「忽略 / 静音」控件（关闭 sticky 只等于关闭本次提示），MUST NOT 写配置项。

切 vault 只切换当前展示的会话快照，MUST NOT 清除或重置任何会话的健康；切回时 SHALL 显示该会话自身仍 latch 的状态。显式「新会话」SHALL 立即清除当前会话健康（含 `history_gap` 与 `history_written`），面板 MUST NOT 继续显示旧状态；从历史恢复 / app 重启后重新建立会话，从空健康起算。自动压缩开新文件 SHALL 沿用两维与 `history_written`，直到新文件首次成功追加；该成功只把当前写健康转 `ok`，MUST NOT 清除缺口。

每次写失败 SHALL 另落一条结构化诊断日志（记录种类 + 错误分类 + 是否可能部分写）；日志 MUST NOT 含消息正文、文档内容或 system prompt。

会话目录创建失败 SHALL 仍走既有 `harness_jsonl_failed` 硬错误（发送被拒），不进入健康状态；恢复文件的首次发布 MUST NOT 创建目录，其目录缺失按「已激活但未发布的恢复批次」处理，不适用本句。子运行审计流水、composer 草稿、附件 MUST NOT 进入本状态。健康只覆盖「本次 write 系统调用是否成功」，MUST NOT 被理解为对 `fsync`、断电、外部删除或写到旧 inode 的保证。隔离运行（无人值守）SHALL NOT 向面板呈现健康，只进日志。

#### Scenario: 当前写失败与恢复

- **WHEN** 一条 `session_title`（sidecar）写入干净失败（未写入任何字节），随后下一次追加成功
- **THEN** 失败后 `state=degraded`、`severity=annotation`、`history_gap.present=false`；成功后 `state=ok`、`severity=null`、缺口仍为 false；警示块随两次跃迁显示 / 隐藏

#### Scenario: 历史失败后成功恢复写能力，缺口仍在

- **WHEN** 一条 `llm_request` 写入失败；随后恢复可写并完成下一次成功追加
- **THEN** 失败后 `state=degraded`、`severity=history`、`history_gap.present=true`；成功后 `state=ok`、`severity=null`，但 `history_gap.present` 仍为 true；事件发出 `state=ok` + gap true 的恢复载荷；面板显示「此前部分对话记录未能保存；新内容已恢复写入。」，MUST NOT 回到健康文案

#### Scenario: 压缩轮换沿用缺口

- **WHEN** 会话处于 `history_gap.present=true` 时自动压缩开新文件，且新文件首次追加成功
- **THEN** 当前写健康转 `ok`，`history_gap.present` 仍为 true；缺口不被新文件洗白

#### Scenario: 切 vault 不清健康

- **WHEN** vault A 的会话已有 `history_gap.present=true`，用户切到 vault B（B 的会话健康为 `ok`），再切回 A
- **THEN** 切到 B 时显示 B 自身的健康；切回 A 时 A 的缺口仍在；切 vault 本身 MUST NOT 产生清除或缺口的重置

#### Scenario: 新会话与恢复重置两维

- **WHEN** 用户显式「新会话」（未被未发布批次守卫拒绝），或从历史恢复产生新会话，或 app 重启后重新建立会话
- **THEN** 两维与 `history_written` 都从空健康起算（`state=ok`、`history_gap.present=false`、`history_written=false`）；面板 MUST NOT 继续显示旧会话的警示块；旧缺口只留在盘上与日志，app 重启后 MUST NOT 补报旧告警

#### Scenario: 严重度与缺口触发

- **WHEN** 同一会话先发生 `session_title` 干净失败，再发生 `llm_request` 干净失败，随后发生 `approval` 部分写失败
- **THEN** 第一次为 `annotation` 且无缺口；第二次为 `history` 且置缺口；第三次仍为 `history`、缺口保持；`annotation` 失败不降级 `history`

#### Scenario: annotation 失败不清缺口

- **WHEN** `history_gap.present=true` 且当前写健康为 `ok` 时，发生一次 `session_title` 干净失败，随后成功
- **THEN** 失败期间 `state=degraded`、`severity=annotation`，缺口仍为 true；成功后 `state=ok`，缺口仍为 true

#### Scenario: 首行干净失败 + history payload

- **WHEN** 首行 `session_open` 在未写入任何字节时失败，而本次 `record(payload)` 的 payload 是 `llm_request`；随后恢复可写并写入下一条记录
- **THEN** 写点保留挂起行；重试成功后首行是 `session_open`，但本次 `llm_request` 已随失败丢失、MUST NOT 被后续成功补回；`history_gap.present=true`，后续成功只把当前写健康转 `ok`；`history_written` 在一条 history 记录真正成功前保持 false

#### Scenario: 首行干净失败 + annotation payload

- **WHEN** 首行 `session_open` 在未写入任何字节时失败，而本次 payload 是 `session_title`；随后恢复可写并写入下一条记录
- **THEN** 写点保留挂起行；重试成功后首行是 `session_open`；`history_gap.present=false`（annotation 丢失不 latch），当前写健康回 `ok`；本场景 MUST NOT 被理解为「部分写也可恢复」的保证

#### Scenario: 尚未落盘的风险提示

- **WHEN** `history_written=false` 且存在持久化告警（首行 + `llm_request` 失败后尚无任何 history 记录成功）
- **THEN** 警示块除缺口文案外 MUST 明确「现在退出，这段对话将无法恢复」；随后一条 `llm_request` 成功写盘使 `history_written=true`，该句消失，但缺口文案仍保留

#### Scenario: 前缀写入后报错

- **WHEN** 一次 `llm_request` 或 sidecar 写入先写入若干字节、随后返回错误
- **THEN** 当前写健康为 `degraded`、`severity=history`、`history_gap.present=true`；后续成功追加 MUST NOT 清除缺口；系统 MUST NOT 声称该文件仍可被完整读取 / 恢复；新逻辑会话才清除缺口

#### Scenario: 快照与事件同键同值

- **WHEN** 健康状态发生一次跃迁（含 `state=ok` + gap true 的恢复、`history_written false→true`）
- **THEN** `persistence` 事件的顶层六键与 `history_gap` 三键同 `harness_state` 快照逐键同值（同一份序列化）；事件另带 `type=persistence` 与 `vault` 信封

#### Scenario: 缺口恢复后的呈现与消退

- **WHEN** 当前写健康回 `ok` 但 `history_gap.present=true`，随后用户开始新会话
- **THEN** 新会话前警示块持续显示缺口文案（不自动消隐、无关闭按钮），MUST NOT 呈现为健康；新会话后警示块隐藏

#### Scenario: 首次 history 的 sticky 含升级

- **WHEN** 本逻辑会话先发生 `annotation` 失败（只亮警示块），随后升级为 `history` 失败
- **THEN** 在进入 `history` 的那一刻给一条 sticky 提示；这是本逻辑会话唯一一条；关闭并重开面板不重复

#### Scenario: 关闭 sticky 不等于静音

- **WHEN** sticky 提示在场，用户点击关闭它
- **THEN** 只移除本次提示；警示块仍在、`history_gap` 不变、不写配置；新逻辑会话仍可再次触发 sticky

#### Scenario: 旧快照缺键不误报

- **WHEN** 前端收到不含 `persistence` / `history_gap` / `history_written` 键的旧快照
- **THEN** 视为 `ok` / `present=false` / `history_written=true`：不显示警示块、不弹提示、不误报「尚未保存」；会话其余内容照常恢复

#### Scenario: 隔离运行不呈现

- **WHEN** 无人值守运行发生留存写失败
- **THEN** 面板收不到 `persistence` 事件、无警示块；诊断日志有记录；交互会话的健康不受影响

#### Scenario: 写失败不阻断对话

- **WHEN** 留存写入失败期间用户继续一轮对话
- **THEN** 轮次照常完成、消息照常上屏；新增的只有健康状态与诊断日志，MUST NOT 出现用户侧「发送失败」

#### Scenario: pending 恢复激活后发布失败不置缺口

- **WHEN** 恢复会话后首次发送，发布因目录不可写在最终 `.jsonl` 出现前失败
- **THEN** `state=degraded`、`severity=history`、`history_written=false`、`history_gap.present=false`；事件只发 `ok→degraded`，不发缺口 `false→true`；警示块说明「对话暂未保存」与退出风险，MUST NOT 出现「此前部分对话记录未能保存」

#### Scenario: 发布重试成功且无假缺口

- **WHEN** 上一场景后目录恢复可写，下一条记录触发发布成功
- **THEN** `state=ok`、`severity=null`、`history_written=true`、`history_gap.present=false`；缓冲记录各落盘一次；事件发 `degraded→ok` 与 `history_written` `false→true`，不发缺口事件

#### Scenario: 初始批次的豁免止于发布

- **WHEN** 恢复文件已发布成功，随后一条 `llm_request` 部分写失败
- **THEN** 按既有口径 `severity=history`、`history_gap.present=true`；MUST NOT 以「初始批次豁免」放行

#### Scenario: 未发布即退出不补报

- **WHEN** 发布始终失败，用户退出并重启 app
- **THEN** 不补报该会话的健康告警、不出现恢复文件或清单行；源文件未被改写

#### Scenario: 拒绝替换不清健康

- **WHEN** pending 恢复已 `activated=true` 且发布失败（`state=degraded`、`history_gap=false`），用户点另一历史 / 触发新会话被拒，或自动压缩被跳过 / 落回既有 overflow 终态
- **THEN** `state`、`severity`、`since_ts`、`history_written`、`history_gap` 全部保持原值；不发 `degraded→ok` 或缺口事件；警示块文案不变；被拒操作本身 MUST NOT 产生新的持久化写；overflow 终态只发既有 provider 错误事件，MUST NOT 发新的 persistence 错误

### Requirement: 失败轮次显式重试

交互式用户轮次因**可重试的 provider 往返失败**而终态收尾后，系统 SHALL 在错误行上提供显式的
「重试」动作；重试 SHALL 在同一个会话、同一个逻辑轮次里重新发出**失败的那一次 provider
往返**。重试动作本身 MUST NOT 新建会话 / JSONL 文件 / 用户消息 / 对外可见的轮次 id
（既有自动压缩 / 恢复等会话轮换不受本条约束），MUST NOT 自动重试、退避或排队。

**可重试性 SHALL 由后端唯一分类产出**（error 事件与 `harness_state` 快照同源），前端 MUST NOT
维护第二份可重试性清单或按文案猜测（`errorText` 的文案映射不属可重试性判定）。分类 MUST 读
**稳定内部失败类别**，MUST NOT 直接读 provider 原始 `code`——原始 code / message 只作诊断与
文案素材。

可重试集合：网络层发送失败；HTTP `408` / `425` / `429` / 任意 `5xx`；**归一后的 transient 流失败**
（传输层读错误、通道意外断开、协议终态未达而 EOF、流内 `error` / `response.failed` 归一为
transient 的类别）；空响应（无正文也无工具调用）。不可重试集合：配置级失败（provider / api_key /
base_url / model 缺失）、HTTP 4xx 请求与鉴权错误（`400` / `401` / `403` / `404` / `409` / `422`；
`408` / `425` / `429` 之外的其余 4xx 一律不可重试）、**归一为 permanent 的流错误**（鉴权 / 权限 /
非法请求 / 内容策略 / 额度耗尽）、附件类错误、上下文超限终态与压缩失败、内部错误 / 线程失败 /
无会话 / 忙、用户停止、工具循环上限、mock 脚本耗尽。分类结果 SHALL 随 error 事件与快照下发
（缺键 = 不提供重试）；HTTP 错误 SHALL 按状态码分类，MUST NOT 按 provider 错误体里的 `code`
字面量推断。上下文超限终态与压缩失败 SHALL 优先判否——即使 HTTP 状态码落在可重试集合，只要
该轮被判为超限终态或压缩失败，就不提供重试。`harness_retry` 命令自身的同步拒绝（忙 / 过期 /
线程起不来 / vision 闸拒绝）不属于轮次失败分类；线程起不来时失败状态 SHALL 放回、动作保留，
用户可再点（这不是自动重试）。

**流失败的归一边界**：Responses 方言 SHALL 以 `response.completed` / `response.incomplete` /
`response.failed` 为协议终态；Chat 方言 SHALL 以 `[DONE]`（或请求了
`stream_options.include_usage` 时的 usage 末帧——其后只会是 `[DONE]`，不丢内容）为协议终态。
终态未达而 EOF SHALL 归为 stream failure，MUST NOT 当正常完成。读错误与通道意外断开同样 SHALL
归为 stream failure，MUST NOT 静默按已收内容收尾。`response.failed` 与流内 `error` SHALL 在解析边界归一为 transient /
permanent 两类稳定类别（已知鉴权 / 权限 / 非法请求 / 内容策略 / 额度耗尽为 permanent；其余含
`server_error` 与未知类别按 transient），MUST NOT 把 provider 原始 code 直接交给可重试性判定。上述归一 SHALL
有 Responses 与 Chat 两方言的真实解析层反例（合成字节流）；mock 的显式错误不构成充分证据。
若未来某方言有官方协议证据允许无终态正常 EOF，必须在该 provider 预设显式声明并补真实解析层
测试，MUST NOT 默认放行。

**重试请求 SHALL 复用会话当前的 `input` 原始项**（含原始 text parts 与 image part 引用）：
系统 MUST NOT 从显示面的 `<quote>` XML / 卡片重建消息，MUST NOT 重新入队用户消息或面板消息，
MUST NOT 重新拼装上下文节，MUST NOT 重新装配系统提示。对失败点位于响应项入 `input` 之前的
全部可重试错误，重试请求的 `messages` 数组（含原始 parts）SHALL 与失败请求的 `messages`
逐字节相同；用户消息条数 MUST 不变。切换 provider / model / 思考档位后重试是允许的修复路径，
此时期望的只是 `input` / `messages` / 原始 parts 不变，MUST NOT 要求完整 HTTP 请求
（模型名、参数、工具定义、wire 方言）逐字节相同。

**重试前 SHALL 重新执行 vision 闸**：系统 SHALL 基于失败轮 `input` 中的图片 parts，按**当前**
provider / model 重新执行与发送路径同一份 vision 能力判据（`config.vision_supported` 的同一
实现与同一错误码，MUST NOT 另立第二套判定）。当前模型不支持而失败 `input` 含图时，重试 SHALL
被拒绝为 `harness_image_unsupported`、失败状态 SHALL 保留、provider 请求数 MUST 为 0。该
preflight SHALL 在消费失败状态之前完成（或失败时完整回滚），MUST NOT 出现「先消费 failed 再
拒绝」导致动作丢失。

**重试 MUST NOT 重放已执行的工具调用**：失败点位于工具执行之前，失败的那次往返不可能已执行
工具；此前轮次已完成的工具调用项与输出项留在 `input` 里，重试 MUST NOT 重新执行它们。该保证
MUST NOT 被扩大解释为「后续模型不会发起任何新的写操作」——重试成功后模型新发起的工具调用 SHALL
照常经既有权限规则、权限模式与批准闸判定，与任何普通回合相同，MUST NOT 因「这是重试」跳过
任何闸。

**重试动作 SHALL 一次点击最多重新发出一次失败的那次 provider 往返**：后端 SHALL 在锁内消费
失败状态，连点 / 并发重试的第二次 SHALL 被拒绝（忙或无失败轮次）；前端点击后 SHALL 立即禁用
动作并进入处理中相位，MUST NOT 显示两个在途轮次。重试成功后模型若发起工具调用，其后的往返
按正常回合继续，MUST NOT 被理解为「整次点击只允许一个 HTTP 请求」。

**同步拒绝 SHALL NOT 本地强制 idle**：busy / stale / no_failed / thread_failed / image_unsupported
等重试同步拒绝 MUST NOT 调用本地收口、强制 idle 或关闭轮次闸门；相位 SHALL 由 `harness_state`
的 `in_flight` 权威收口。busy 尤甚：第一次重试仍在流式输出时第二次重试得 `harness_busy`，第二次
MUST NOT 影响第一次的后续分片、工具行或终态——第一轮的文本分片 MUST 继续上屏，终态 MUST 正常
收口。拒绝的人话错误行 SHALL 照常上屏，但 MUST NOT 以本地相位记忆覆盖 `in_flight`。动作 SHALL
由同一份快照的 `retry` **就地幂等更新**：`retry` 缺席移除动作，在场保留 / 重建；MUST NOT 为
此重放 transcript 或清掉刚追加的拒绝错误行。

**世代守卫**：每次开始新轮次（发送、重试、自动回合、cron 运行）SHALL 推进会话的轮次世代；
失败状态 SHALL 记录其世代。重试 SHALL 只在「同一会话对象、当前世代、同一失败记录、且会话
空闲」时被接受；失败后用户又发了新消息、开了新会话、从历史恢复了会话，旧的重试动作 SHALL
失效并返回明确的过期 / 无失败错误，MUST NOT 作用于新的轮次或新的会话。**关闭 vault** 会丢弃
该 vault 的会话（失败状态随之消失）；**切换 vault** MUST NOT 让旧视图的动作作用于新 vault 的
会话，但该 vault 的失败状态 SHALL 保留，切回时按快照重建动作。跨 vault 的重试请求 MUST NOT
落到非当前 vault 的会话；前端视图世代换代后到达的旧拒绝回包 MUST NOT 改写新视图。

**存活范围**：重试动作 SHALL 跨 webview 重载与切 vault 回来存活（由 `harness_state` 快照携带
可重试轮次标识，缺键 = 不提供）；MUST NOT 跨 app 重启或跨历史会话恢复存活——失败事实是内存态，
重启 / 恢复后的视图不重建重试动作。错误行本身仍是 live 面；快照重建的是尾部的重试动作行
（通用文案，不复制原错误行），MUST NOT 被当作 transcript 错误行的持久化。**`enter` 与 `content`
两档快照 SHALL 在消息重放后按 `retry` 幂等保证恰好一条尾部动作（`retry` 缺席时为 0 条）**：
`content` 档清面后 MUST 重建动作（不得因「不新增」而丢掉入口），动作已在场时 MUST NOT 追加
第二条。

**失败轮的半截正文**：失败前已流式上屏的半截正文 SHALL 保留在 transcript 并标注「未完成」
（与「已停止」同型的 live 面标记），MUST NOT 被当作完整回答；重试成功后新的回答 SHALL 另起
一条 assistant 消息，MUST NOT 替换 / 删除旧的那条。该半截正文是 live 面：webview 重载 /
切 vault 回来不重建（其事实留在 JSONL 的 `llm_response`）；历史恢复路径的折叠行为不在本条内。

**重试成功的一轮 SHALL 按一次正常完成的轮次收尾**（含会话自动命名的触发判定）；重试轮 SHALL
按一次新的内部轮次获得完整的 `loop_max` 预算（不继承失败轮已用轮数，`overflow_retried` 同样从零起），
这 MUST NOT 改变 `loop_max` 的既有语义。重试 MUST NOT
把排队中的后台完成通知并入本次请求（它们按既有口径在之后的下一次用户发言前并入）。重试 MUST
NOT 改变上下文超限的既有「自动压缩 + 重试该轮一次」口径、
MUST NOT 改变错误行同文案去重、MUST NOT 改变 `in_flight` 相位模型。

#### Scenario: 网络失败后重试成功

- **WHEN** 一条已受理的用户消息在未触发自动压缩的会话里因网络层发送失败
  （`harness_network_failed`）终态收尾，用户点击错误行上的重试动作，随后一次响应成功
- **THEN** transcript 仍只有一条该用户消息；新回答正常上屏；同一 JSONL 文件只新增一对
  `llm_request` / `llm_response`；重试动作本身不新建会话、不新建 JSONL 文件、不写
  `session_open`

#### Scenario: 瞬时 HTTP 错误给重试，请求类 4xx 不给

- **WHEN** 同一会话先后遭遇 HTTP `503`、`429`、`400`、`401` 四类失败
- **THEN** `503` / `429` 的错误行出现重试动作；`400` / `401` 的错误行不出现重试动作；
  两种判定都来自后端分类结果，前端不按 `code` 或文案自行推断

#### Scenario: Responses 无终态 EOF 与读错误归为流失败

- **WHEN** Responses 方言的真实解析层收到文本分片后，分别出现（a）读循环 I/O 错误 / channel
  意外断开，（b）EOF 但未收到 `response.completed` / `response.incomplete` / `response.failed`
- **THEN** 两种情况都产出稳定的 stream failure 类别（不是正常完成），已收到的正文保留；
  该类别的可重试性由后端分类给出，重试请求与失败请求的 `messages` 相同

#### Scenario: Chat 无终态 EOF 与读错误归为流失败

- **WHEN** Chat 方言的真实解析层收到文本分片后，分别出现（a）读循环 I/O 错误 / channel
  意外断开，（b）EOF 但未收到 `[DONE]`（也未收到 usage 末帧）
- **THEN** 两种情况都产出稳定的 stream failure 类别（不是正常完成），已收到的正文保留；
  正常收到 `[DONE]` 或 usage 末帧的流仍按正常完成收尾

#### Scenario: response.failed 与流内 error 的 transient / permanent 归一

- **WHEN** 真实解析层分别收到 `response.failed` / 流内 `error`，其 provider 错误为
  `server_error`（transient）与 `invalid_request_error`（permanent）
- **THEN** transient 类出现重试动作；permanent 类不出现重试动作；判定读归一后的内部类别，
  MUST NOT 直接依据 provider 原始 `code`；原始 code / message 仍随错误行 / 留存可查

#### Scenario: 失败发生在工具轮之后不重放工具

- **WHEN** 第一轮工具调用成功执行（如 `vault_create` 写入一份文件），第二轮 provider 往返失败，
  用户点击重试并成功
- **THEN** 目标文件仍只有一份；transcript 里该工具行只出现一次；重试请求包含第一轮已完成的
  调用项与输出项且顺序不变；JSONL 只多一对记录

#### Scenario: 重试后的新写工具仍需批准

- **WHEN** 失败轮之前已批准并执行过一次写工具（一次性批准、未选「本会话不再问」），随后该轮
  失败；用户重试成功，模型发起一个**新的**、当前权限模式下需要批准的写工具调用
- **THEN** 批准前该调用 MUST NOT 产生任何副作用（目标文件 / 目录未被修改）；批准卡 SHALL 照常
  出现（MUST NOT 复用失败前的一次性批准决定）；批准后该调用 SHALL 恰好执行一次；transcript 的
  工具行与 JSONL 记录不得出现重复执行

#### Scenario: 连点与并发重试只重发一次失败往返

- **WHEN** 用户连点两次重试，或两个重试请求并发到达（重试轮内没有工具调用）
- **THEN** 失败的那次往返只被重新发出一次（JSONL 的 `llm_request` 只 +1 对）；第二次返回忙或
  无失败轮次；前端只呈现一个在途轮次，第二个动作在第一次点击后即被禁用

#### Scenario: 第一次重试仍流式时第二次 busy

- **WHEN** 第一次重试已被接受、正在流式输出；用户在结束前再次触发重试，第二次得到
  `harness_busy`
- **THEN** 第二次 MUST NOT 本地强制 idle、MUST NOT 关闭轮次闸门；相位由 `in_flight` 快照保持
  running；第一次重试的后续文本分片、工具行与终态 SHALL 继续正常上屏，不产生额外 provider 请求

#### Scenario: 失败后发新消息使旧动作过期

- **WHEN** 一次可重试失败后，用户没有重试而是发送了一条新消息（或开了新会话 / 从历史恢复了
  会话），随后再点击旧的重试动作
- **THEN** 重试被拒绝为过期或无失败轮次；新消息 / 新会话 / 恢复的会话不受影响，不产生额外
  provider 请求，也不把旧失败状态的任何项并入新轮次

#### Scenario: 跨 webview 重载与切 vault 回来仍可重试

- **WHEN** 一次可重试失败后 webview 重载，或切到 vault B 再切回 vault A
- **THEN** 回到该 vault 时 transcript 尾部按快照重建重试动作行且可点击；其他 vault 的失败
  不出现在当前 vault；重载前已上屏的半截正文不重建（仍是 live 面）

#### Scenario: 中途接管后的 content 快照仍有一条动作

- **WHEN** 一个中途接管的轮次以可重试错误收尾，error 分支发起 `content` 快照；快照返回时
  transcript 被清面并按 messages 重放
- **THEN** 重放完成后按快照 `retry` 恰好重建一条尾部重试动作（不是零条、也不是两条）；
  动作可点击，点击只发出一次重试请求

#### Scenario: 线程启动失败后的动作仍在

- **WHEN** 用户点击重试，后端因线程启动失败返回 `harness_thread_failed`（失败状态已放回）
- **THEN** 错误行照常上屏；轻量快照重新拉取后尾部动作仍在且可再次点击；MUST NOT 因这次拒绝
  丢失重试入口，也 MUST NOT 清掉拒绝错误行

#### Scenario: 不跨重启与历史恢复

- **WHEN** 一次可重试失败后重启 app，或从会话浮层恢复该历史会话
- **THEN** 恢复后的视图不出现重试动作，也不能对旧失败轮发起重试；用户可发送新消息继续对话

#### Scenario: 半截正文标「未完成」且重试回答并列

- **WHEN** 流式已产出部分正文后 provider 失败，用户重试并成功
- **THEN** 旧半截正文保留在 transcript 并标注「未完成」；重试成功的回答是第二条 assistant
  消息、不替换旧内容；消息快照不重建那条半截正文

#### Scenario: 切换 provider / 模型 / 思考档位 / wire 后重试

- **WHEN** 一次可重试失败后，用户切换 provider、模型、思考档位或 wire 方言，再点击重试
- **THEN** 重试按新配置发出；重试请求的 `messages` / `input` / 原始 parts 与失败请求逐字节
  相同；完整 HTTP 请求（模型名、参数、工具定义、wire 方言）可以不同；该轮 `llm_request`
  记录里的 provider / 模型 / `params.thinking` 为新值；wire 方言按当前配置发送，
  `session_open` 的方言键不因重试改写

#### Scenario: 含图失败切非 vision 模型被拒

- **WHEN** 一次含图片 parts 的失败后，用户把 provider / model 切到未声明 `vision` 的模型，
  再点击重试
- **THEN** 重试被拒绝为 `harness_image_unsupported`；provider 请求数为 0；失败状态 SHALL 保留，
  重试动作仍在；切回支持 vision 的模型后可再次重试

#### Scenario: 空响应可重试且请求保持一致

- **WHEN** provider 返回一次空响应（无正文、无工具调用），用户点击重试并成功
- **THEN** 错误行出现重试动作；重试请求的 `messages` 与失败请求相同（空响应的 reasoning
  回放项不进入 `input`）；重试成功后正常回答上屏

#### Scenario: 非交互轮次不产生重试

- **WHEN** cron 运行、子运行或自动唤醒回合以可重试类错误失败
- **THEN** 该会话不产生可重试状态，面板不出现重试动作；cron 失败仍按运行契约回执，
  自动回合按既有终态口径收口

### Requirement: 恢复历史会话不折叠失败响应

从历史会话恢复续聊时，既有「折叠锚点请求之后未入请求的末尾响应」的口径 SHALL 以该响应
**不带 `error`** 为前提：若配对的那条 `llm_response` 带 `error`，系统 MUST NOT 把它的正文 /
思考回放项 / 工具调用折进恢复后的 `input` 或面板记录；恢复结果 SHALL 停在失败前已完成的
最后一项。失败轮已流出的半截正文是 live 面，MUST NOT 在恢复后以完整回答的形态重建。

该约束只作用于恢复时的折叠判定，对既有 JSONL 文件的读取是只读的：MUST NOT 迁移、回写或
删除任何记录；成功响应的折叠行为逐字节不变。

#### Scenario: 失败响应的半截正文不折叠

- **WHEN** 源会话的最后一条 `llm_request` 之后配对一条带 `error` 的 `llm_response`，且该响应
  含半截正文与思考文本
- **THEN** 恢复后的 `input` 不含该响应的正文 / 思考回放项 / 工具调用；面板不出现该半截正文；
  恢复结果停在失败前已完成的最后一项，用户可继续对话

#### Scenario: 失败响应无正文同样不折叠

- **WHEN** 源会话的末尾 `llm_response` 带 `error` 且没有任何正文或工具调用
- **THEN** 恢复后的 `input` 与面板都不新增项；不出现只有角色 meta 行的空 assistant 消息

#### Scenario: 成功响应的折叠逐字节不变

- **WHEN** 源会话的末尾 `llm_response` 不带 `error`（正常完成的末轮回答）
- **THEN** 恢复时仍按既有口径折叠其正文 / 思考 / 工具调用；恢复结果与改动前逐字节相同

#### Scenario: 旧文件只读

- **WHEN** 恢复一份包含失败响应的既有会话文件
- **THEN** 该文件不被迁移、回写或删除任何记录；文件的字节与 mtime 不变；恢复只影响新会话
  内存态与新 JSONL 文件

### Requirement: Harness 阅读密度、消息节奏与阅读宽

harness transcript SHALL 以 `calc(var(--fs-body) * var(--lumir-hp-scale, 1))` 与 `var(--lh-chat)` 呈现正文，
默认缩放档计算值为 15px/1.58（行高 23.7px）；外侧 padding SHALL 为 `16px 16px 12px`，消息间距 SHALL 为
16px。composer 外侧 padding SHALL 为 `12px 16px 16px`。字号 SHALL 继续受编辑器与 Harness 共享缩放比控制，
MUST NOT 另立 Harness 字号状态。

assistant 正文里的段落、普通列表、代码、引用、表格与块级 slot SHALL 以 8px 纵向间距分隔，首末块相应外边距
归零；`slot > codeblock/table-scroll/table` 的嵌套 margin 链路 SHALL 同步归零，MUST NOT 叠出双倍间距。
列表缩进 SHALL 为 24px，相邻列表项上距 2px，项内段落间距 4px。正文 SHALL 使用
`overflow-wrap:anywhere; word-break:normal`，长 URL MUST NOT 撑宽 transcript；表格内 URL 仍由固有宽与
局部横滚合同承担。

用户气泡 padding SHALL 为 8/12px；底色、边框、圆角与正文档配色不变。角色 meta 行 SHALL 保持 10.5px，
下距 SHALL 为 4px。角色与时间的颜色分层按「消息呈现」执行。

transcript 的直接消息子项 SHALL 以 `max-inline-size:var(--layout-review-measure)` 限制阅读宽，默认 token
值为 720px。该值是**上限而非固定宽**：可用宽不足 720px 时消息仍占满可用宽；达到上限后消息 SHALL 左对齐，
左缘与 transcript 内容左缘一致（±1px），MUST NOT 居中或把用户消息右对齐。该上限 MUST NOT 作用于 pane、
Harness 容器、composer 外侧或 composer 输入区，MUST NOT 引入第二份 720px 配置或字面值真源。

#### Scenario: 默认缩放档的阅读节奏

- **WHEN** 以默认 `--lumir-hp-scale=1` 打开含多段回答、三级列表与用户消息的 Harness
- **THEN** transcript 的计算样式为 15px/23.7px、padding `16px 16px 12px`、gap 16px；普通块间距为 8px
  且首末归零，列表缩进 / 项距 / 项内段落分别为 24px / 2px / 4px；用户气泡 padding 为 8px 12px，
  who 下距为 4px

#### Scenario: 三宽度下的消息上限与左缘

- **WHEN** 同一合成消息分别在 1200×800、1800×900、2400×1000 视口的默认 1:1 Harness pane 中呈现
- **THEN** 三组消息宽分别约为 448.5px、720px、720px（容差 1px）；三组左缘均与 transcript 内容左缘
  一致（±1px）；窄组与无 720 上限候选的宽度差 ≤1px，宽 / 超宽组只收窄消息，不改变 pane 或 composer 宽度

#### Scenario: 共享缩放比仍然生效

- **WHEN** 通过既有字号命令把编辑器与 Harness 同步调到非默认缩放档，再按 ⌘0
- **THEN** transcript 与 composer 字号随 `--lumir-hp-scale` 同步变化且行高比仍为 1.58；间距、控件最小尺寸
  和 720px 上限不二次缩放；⌘0 后两个内容面回各自基线，全程不新增 Harness 独立字号状态

#### Scenario: 长正文不撑宽 transcript

- **WHEN** 三主题 × 三宽度九组中均放入长 URL、长段落与三级嵌套列表
- **THEN** 每组 `.lumir-hp-transcript` 均满足 `scrollWidth === clientWidth`，正文链接文本完整可见，
  列表续行不越出消息；设置 transcript 纵滚到底后 `scrollTop > 0`

### Requirement: Harness 代码块与横线表排版

Harness 代码块 SHALL 保持 12.5px/1.55，padding SHALL 为 10/12px，圆角 SHALL 为 `var(--r8)`。既有局部
横滚、细条档、复制与全屏入口 MUST NOT 改变；MUST NOT 为本次排版新增滚动容器、改变 overflow 轴或重写
滚动行为。

Harness **面板内的**表格 SHALL 以 13px/1.5 呈现，th / td padding SHALL 为 6/10px。表格 SHALL 采用**横线表**：
cell 的上 / 左 / 右边框为 0，只保留 1px 底边；表头底边取 `var(--border)`，数据 cell 底边取
`var(--border-soft)`，MUST NOT 恢复全网格。表格固有宽、cell 单行、窄表贴合内容、宽表局部横滚、嵌套收缩、
全屏快照源与关闭路径均沿用「对话表格的固有宽与局部横滚」及既有全屏合同，MUST NOT 改 stacked cards。

全屏快照克隆 `<table>` 后不再位于面板 body 祖先链下，SHALL 继续消费 `.lumir-table-fs-snapshot` 的
`--editor-font-size`（默认 15px）与既有编辑器缩放语义，MUST NOT 套用面板表格的 13px 字号。全屏专属布局、
快照内容与开关行为不变；共享 `.lumir-hp-table th/td` 的横线与 6/10px padding 随克隆保留。面板与全屏的
计算样式断言 MUST 分开，面板证据 MUST NOT 冒充全屏证据。

#### Scenario: 代码块计算样式与局部横滚

- **WHEN** 三主题 × 三宽度九组中均放入超出容器宽的长代码行
- **THEN** 代码块计算字号 / 行高为 12.5px / 19.375px、padding 为 10px 12px、radius 为 8px；
  每组先满足 `code.scrollWidth > code.clientWidth`，写入 `scrollLeft=120` 后读数 >0；
  transcript 仍无横向溢出

#### Scenario: 面板横线表而不是全网格

- **WHEN** 在任一主题下查看 Harness 面板内的表格
- **THEN** 表格计算字号 / 行高为 13px / 19.5px，th / td padding 为 6px 10px；每个 cell 只有 1px 底边，
  表头与数据行分别消费结构 / 层次 hairline token，不出现上 / 左 / 右网格线

#### Scenario: 全屏快照保留编辑器字号与现有布局

- **WHEN** 从 Harness 面板打开表格全屏快照，分别在默认与非默认编辑器字号下读取快照，再关闭全屏
- **THEN** 快照继续消费 `--editor-font-size`（默认计算值 15px，非默认档随既有缩放变化），MUST NOT 为 13px；
  快照内容仍直接来自 table 本身并保持固有宽，共享 cell 只保留横线且 padding 为 6px 10px；全屏专属布局、
  打开与关闭行为不变，不把面板的 body 作用域字号断言套到快照上

#### Scenario: 窄 pane 宽表只在自身容器横滚

- **WHEN** 1200×800 视口的 Harness 中含自然宽超过消息可用宽的表格
- **THEN** 先满足 `.lumir-hp-table-scroll.scrollWidth > clientWidth`，写入 `scrollLeft=120` 后读数 >0；
  表格保持固有宽和 cell 单行，transcript `scrollWidth === clientWidth`

#### Scenario: 宽 pane 不强制制造表格溢出

- **WHEN** 同一合成宽表在 1800×900 与 2400×1000 视口呈现，其固有宽小于消息可用宽
- **THEN** 表格仍按固有宽呈现，横滚容器 `scrollWidth === clientWidth`；不得为通过滚动断言而拉宽表格，
  窄表也不被拉伸到 720px

### Requirement: Harness 工具与批准决策区排版

工具行 SHALL 保持 12px，以 `min-height:28px; height:auto` 取代固定 24px 高。工具名 / 参数 / 终态词的
既有排布、参数省略与终态词保护 MUST NOT 改变。工具尾注 `.lumir-hp-tool-out` SHALL 取 `--text-2`。

批准卡 padding SHALL 为 10/12px；purpose、basis、note、diff、argv、reason 的决策段下距 SHALL 为 8px。
批准动作按钮 SHALL `min-height:32px` 且水平 padding 为 12px。待决副句 `.lumir-hp-approval-sub`、判定依据
`.lumir-hp-approval-basis` 与后果 `.lumir-hp-approval-note` SHALL 取 `--text-2`。长次级动作允许既有换行，
命令原文仍在自己的局部滚动区完整可达；采纳、拒绝、会话内记住与持久规则行为不变。

本 requirement 指定的任务型次级文字及「消息呈现」的角色、composer placeholder、运行提示和空态提示，
在三主题实际承载面上的对比度 SHALL ≥4.5:1。时间读数等刻意退后的装饰性 meta MUST NOT 被一概提色。

#### Scenario: 工具行与批准控件计算值

- **WHEN** Harness 同屏呈现完成工具行与待决批准卡
- **THEN** 工具行字号为 12px、min-height 为 28px、height 为 auto 且实际高度 ≥28px；批准卡 padding 为
  10px 12px，指定决策段下距为 8px；批准按钮 min-height 为 32px、padding-inline 为 12px

#### Scenario: 三主题任务文字对比度

- **WHEN** 在 light / dark / eink 下分别读取角色、批准副句 / 依据 / 后果、工具尾注、运行提示、placeholder
  与空态提示的前景 token 和实际合成背景
- **THEN** 这些元素均消费 `--text-2`，逐元素对比度 ≥4.5:1；用户气泡正文仍 ≥7:1，时间仍消费 `--text-3`；
  缺元素、缺背景或颜色不可解析时判 FAIL，不得按空值跳过

#### Scenario: 窄 pane 决策动作完整可达

- **WHEN** 1200×800 视口下批准卡含长次级动作、长命令与采纳 / 拒绝按钮
- **THEN** 所有动作均在批准卡与 Harness 可视范围内，不被固定高度裁切；长次级动作按既有口径换行，
  长命令可在局部滚动区完整到达；点击采纳或拒绝仍走既有行为路径

### Requirement: Harness composer、空态与运行提示排版

composer 输入 SHALL 以 `calc(var(--fs-body) * var(--lumir-hp-scale, 1))` 与 `var(--lh-chat)` 呈现，默认
计算值为 15px/1.58；min-height SHALL 为 48px，padding SHALL 为 10/12/4px。placeholder SHALL 取
`--text-2`，top / left 分别为 10/12px，与首行输入位置一致。既有 max-height、纵滚、控制行、焦点、CodeMirror
文本 / 选区 / IME 与发送行为 MUST NOT 改变。composer 与其外侧 MUST NOT 获得 720px 固定宽或阅读宽上限。

空态提示 SHALL 为 13px/1.58、`--text-2`、24px padding；现有 margin auto 与 text-align 等布局不变，
MUST NOT 重做空态信息架构。运行阶段提示 `.lumir-hp-stage` SHALL 取 `--text-2`；其位置、既有不定态进度、
动画与交互不变，进度区移动明确不属于本 requirement。

有序承接 SHALL 固定为 `fix-harness-approval-visibility-nov23` → 本 change →
`move-harness-progress-to-output-tail-nov23`。前置审批可见性 change 未归档且 `--archived` 审计未 PASS 时，
本 change MUST NOT 施工；前置阶段色 `--text-3` 由本 change 改为 `--text-2`。本 change 未归档、审计未 PASS
且新 idle 基线未经 Alex 批准落盘时，后续尾行 change MUST NOT 施工。后续 change SHALL 继承本 change 的
阶段 `--text-2`、16px gap、`16px 16px 12px` transcript padding 与空态排版，不得恢复旧值。

后续尾行 change 若仍取 2px 净间距，SHALL 把旧 `calc(var(--sp-2) - var(--sp-4))` 重算为
`calc(var(--sp-2) - var(--sp-8))`；仅在后续 change 把空态改为绝对定位时，四边 SHALL 按新 transcript
padding 取 `top/right/left:var(--sp-8); bottom:var(--sp-6)`，并继承 13px/1.58、`--text-2`、24px padding。
其“idle 零漂移”SHALL 只相对本 change 后的新 idle 基线判定。

#### Scenario: composer 默认计算值与 placeholder 对齐

- **WHEN** composer 为空并随后输入首行文字
- **THEN** 输入计算字号 / 行高为 15px / 23.7px、min-height 为 48px、padding 为 10px 12px 4px；
  placeholder top/left 为 10px/12px、颜色为 `--text-2`，与首行行位一致；输入后 placeholder 退场，
  空态与首行输入态不出现异常高度跳变

#### Scenario: composer 不被 720px 封顶

- **WHEN** 分别在 1200×800、1800×900、2400×1000 视口打开 Harness
- **THEN** composer 外侧 padding 为 12px 16px 16px，composer 随 pane 可用宽伸缩；超宽组 composer 实际宽
  >720px，且输入、模型 chip、ctx 读数与发送钮均在 Harness 内，无横向控制行溢出或遮挡

#### Scenario: 空态与运行提示只改指定排版

- **WHEN** 分别查看空会话与工具循环进行中的 Harness
- **THEN** 空态为 13px/20.54px、`--text-2`、24px padding，现有居中方式不变；阶段提示为 `--text-2`，
  不定态进度与阶段位置、动画和运行行为保持原样

#### Scenario: 后续尾行 change 按本 change 的新几何承接

- **WHEN** 前置审批可见性 change 和本 change 已依次归档且审计 PASS，本 change 的新 idle 基线已获 Alex
  批准并落盘，随后 `move-harness-progress-to-output-tail-nov23` 开始施工
- **THEN** 尾行阶段提示继承 `--text-2`，不恢复 `--text-3`；2px 净间距按 16px gap 使用
  `calc(var(--sp-2) - var(--sp-8))`；空态绝对定位四边使用 `sp-8/sp-8/sp-6/sp-8`，并继承本 change 的
  13px/1.58、`--text-2`、24px padding；其 idle 对拍使用本 change 后的新基线，不使用旧 8px gap、
  `8/8/4px` transcript padding 或旧空态配方

### Requirement: Skill 候选浮层的表面不变量

harness composer 的 Skill 候选浮层 SHALL 是不透底的浮层面：其计算后的 `background-color` SHALL
等于当前主题的 `--preview-bg`，alpha SHALL 为 1。该表面 SHALL 按 `ui-design-system`「设计 token
层」的浮层壳配方（`--preview-bg` + 1px `--border` + `--shadow-raise`）取值，MUST NOT 引用未登记
的 token、MUST NOT 以**失效声明回落成 transparent** 或半透明底落空——「浮层在内容之上」必须在
绘制结果上成立，MUST NOT 只体现为 `z-index`。

判据 SHALL 落在**绘制结果**上：在浮层可见面（圆角与 1px 边框之内）内，浮层背后画了什么 MUST NOT
影响该区域的像素；三主题（light / dark / eink）SHALL 各判一次。

#### Scenario: 三主题下浮层底色等于 --preview-bg

- **WHEN** 打开 Skill 候选浮层，当前主题分别为 light、dark、eink
- **THEN** 浮层计算后的 `background-color` 等于该主题 `--preview-bg` 的值（light `#ffffff` /
  dark `#26272b` / eink `#ffffff`），且 alpha = 1

#### Scenario: 底层文字不穿透

- **WHEN** 在候选浮层背后铺一层高对比文字与底色，再换成另一套高对比配色
- **THEN** 浮层可见面的像素两次逐字节相同（背后内容不进入浮层）；把浮层背景强制改为
  `transparent` 时，同一对比 SHALL 出现差异——判据本身必须有区分度

### Requirement: 消息摘录真机验收通道

使用真实 CGEvent 在 transcript 建立消息选区的验收场景 SHALL 按本轮窗口、fixture 与消息排版标定拖选线段，起点与终点 SHALL 落在目标消息正文文本几何内；窗口尺寸、fixture 或排版变化后 MUST 按本轮截图重新标定，MUST NOT 把落入消息间空白的拖选重试归因成产品选择器失效。选区是否建立 SHALL 继续由浮动「摘录到对话」钮的正观测独立判定，坐标调整 MUST NOT 删除或放宽该断言。

当 composer 采用 inline cards 时，输入定位 SHALL 使用当前 AXTextArea 的占位名与本轮注入文本组合，MUST NOT 依赖旧 tray 才会暴露的卡片角色名；动作内部 SHALL 通过注入前后文本计数变化证明输入落点。

#### Scenario: 消息排版变化后的真实拖选

- **WHEN** 121 在 mock 回答已渲染后执行真实拖选，且消息排版已改变正文行的位置
- **THEN** 按本轮截图把起终点重标定到同一 assistant 正文行内，再执行 CGEvent 拖选；只有浮动「摘录到对话」钮实际出现才算选区建立，几何、入卡、移除与再次摘录断言继续执行

#### Scenario: inline cards 后继续输入第二问

- **WHEN** 消息摘录卡已作为 composer 内 widget 插入，准备在卡片后的文本段落输入问题
- **THEN** typeInNode 通过占位名或本轮注入文本定位同一个 composer，且 N→N+1 回读成立；随后发送、transcript 同构与 `<msg-quote role at>` wire 断言继续执行

### Requirement: Harness Markdown strong 的流式渲染一致性

凡项目既有 `@lezer/markdown` GFM 配置认定为 `StrongEmphasis` 的 strong，Harness SHALL 在普通段落、
有序/无序列表、嵌套列表、跨行项、CJK/英文、标点与同行后续文本中一致渲染为 `<strong>`，MUST NOT
把对应 delimiter 当作字面星号上屏。0 个 strong 的文本 MUST NOT 新增 strong；多个 strong SHALL
分别保留其范围。代码 span、围栏/缩进代码块与转义星号 SHALL 保持字面文本，MUST NOT 因本合同
被转为 strong。本 requirement MUST NOT 扩展既有 GFM 解析器未认定为 strong 的语法。

流式增量渲染与终态渲染 SHALL 对同一段完整源收敛到相同的 strong 语义。流式定稿 MUST NOT
在仍可能被后续缩进段落延续的列表内部切断块级上下文；尤其有序/无序列表空行后的合法缩进续段
MUST NOT 被切成顶层缩进代码块。确认列表已被后续顶层块关闭后，该列表 SHALL 可以定稿；普通段落
与已闭合代码围栏的既有定稿能力 MUST NOT 被移除。本合同只约束解析与 DOM 语义，MUST NOT 改变
既有排版、进度尾行、引用卡、工具卡或审批卡。

#### Scenario: strong 宿主与文本矩阵

- **WHEN** 同一真实渲染件处理普通段落、有序/无序/嵌套列表和跨行项中的 0/1/多个 strong，
  输入覆盖 CJK、英文、标点与闭合 delimiter 后的同行后续文本
- **THEN** 每个被既有 GFM 解析器认定的 strong 都生成对应 `<strong>`，可见文本不含其 delimiter，
  后续文本仍按原文呈现；无 strong 的宿主不产生 `<strong>`

#### Scenario: 代码链接与转义反例

- **WHEN** strong 内含链接或代码 span，链接内含 strong，或列表/段落含 `` `**代码**` ``、
  围栏代码与 `\*\*转义\*\*`
- **THEN** strong 与链接的嵌套范围保持解析语义；代码和转义中的星号逐字保留且不生成 `<strong>`，
  不得通过全局替换星号获得表面正确

#### Scenario: 空行后的列表缩进续段流式到达

- **WHEN** 有序列表项在空行后以四空格缩进继续一个含 `**粗体**后续` 的合法段落，流式 chunk
  先到达列表与该续段，稍后才到达后续顶层块
- **THEN** 中间态与终态都把续段保留在列表项内并渲染 `<strong>`，不得产生含该续段的顶层
  `<pre>` 或字面 `**`；后续顶层块到达后列表可定稿

#### Scenario: 已结束块仍可定稿

- **WHEN** 普通段落后出现空行，或列表/闭合代码围栏之后已经出现后续顶层块
- **THEN** 已结束块按既有增量路径定稿，进行中的尾块继续重渲；不得为了修复列表上下文而
  退化为每个 chunk 都冻结全部正文或取消全部增量定稿

### Requirement: 统一 Web 搜索与抓取工具

`harness.web_access.enabled` 缺省为 `true`，交互主会话 SHALL 默认提供 `web_search` 与 `web_fetch`，
两者 SHALL 使用同一结果信封与 `WebSource` 来源结构；显式 false 不注册这两件工具。`web_search` 输入 SHALL 仅含 `query` / `count` / `need_content`：query trim 后为 1–128 个
Unicode 字符且不全为空白；count 缺省 5、本地允许 1–10，越界 SHALL 返回 `web_args_invalid` 而非静默
clamp；`need_content` 缺省 `false`。`web_fetch` 输入 SHALL 仅含 1–8192 字符的 `url`。工具 schema
MUST NOT 暴露 API Key、provider、base URL、超时、重试、响应上限或任意 HTTP header。

统一信封 SHALL 含 `ok` / `provider` / `provider_id` / `operation` / `attempts` / `local_precheck` /
`trust` / `truncated` / `truncated_fields`，并 SHALL 另含两个可空结果读数 `result_count` /
`result_text_bytes`。成功 Search 的两个读数 SHALL 在预算裁剪全部完成后由后端**单一一次**计算：
`result_count` = 实际回送模型的结果条数（不是 provider 原始条数、不是请求的 `count`）；
`result_text_bytes` = 最终保留各结果的 title / snippet / summary / content 各字符串 UTF-8 字节数
之和（不含 URL / site / date / authority / query 与 JSON 结构开销，不是网页大小或网络流量）。
非 Search 成功、失败、缺读数时两键 SHALL 为 null，MUST NOT 以 0 冒充空结果。`local_precheck` SHALL 记录 Fetch 是否**实际执行过**
本地预检：未配置、配置非法、参数非法、权限拒绝等未进入 executor 的路径为 `false`；进入 executor
后无论预检成功、失败还是取消均为 `true`。审计 MUST NOT 仅按 `operation=fetch` 推断该值。`provider` / `provider_id` SHALL 为 `string | null`：只有 provider
解析成功才填 `"deepseek"` 与实际配置映射键；未配置、配置歧义、自定义 base URL 及解析前的参数 /
权限 / URL 拒绝均填 null 且 `attempts=0`，MUST NOT 伪造 `"deepseek"` 为配置 id 或在多候选时暗选。
基础参数形状与 URL 静态安全校验（scheme / userinfo / 控制字符 / 反斜杠 / 缺失 host，以及
`localhost`、`.local`、非全局单播 IP 字面量）SHALL 在 provider 解析与可选批准预览之前完成：
任一 provider 配置状态（未配置、配置歧义、自定义 base URL）都 MUST NOT 掩盖 URL 安全拒绝，
被拒调用 MUST NOT 变成 `web_provider_unconfigured`，也 MUST NOT 产生批准卡；这些路径的
`local_precheck` 为 `false`（预检未执行），`attempts` 为 `0`，可解析出 origin 的拒绝仍带
`source.url`，带凭据的输入 MUST NOT 被抄进 `source`。
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
Fetch Markdown 24,000 字符，Lumir message / provider_message / request_id / provider_code 各 1,000
字符；Search / Fetch API 响应
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

#### Scenario: URL 安全拒绝先于 provider 解析

- **WHEN** `web_fetch` 收到 `localhost`、`.local`、非全局单播 IP 字面量、非 HTTP(S) scheme 或带凭据的
  URL，且 provider 处于未配置 / 配置歧义 / 自定义 base URL 任一状态（`approval` 为任意值）
- **THEN** 结果恒为 `web_url_blocked`（参数形状非法则为 `web_args_invalid`），MUST NOT 被配置状态
  改写成 `web_provider_unconfigured`；`provider` / `provider_id` 为 null、`attempts=0`、
  `local_precheck=false`，不产生批准卡，可解析出 origin 的路径仍带 `source.url`

#### Scenario: 截断显式且 JSON 完整

- **WHEN** 搜索摘要、正文、结果数组或 provider 错误文案超过预算
- **THEN** 输出仍为完整 JSON，顶层 `truncated:true`，`truncated_fields` 精确指出被裁路径；未裁的
  URL / date / authority / provider 保持完整，不出现只加省略号的无标记截断

#### Scenario: 响应字节与上下文预算独立

- **WHEN** DeepSeek 响应超过对应 2 / 4 MiB 上限，或合法响应的正文超过模型字符预算
- **THEN** 前者返回 `web_response_too_large` 且不解析半截 JSON；后者可返回有界结果但必须显式标记截断

#### Scenario: 错误元数据同样有界

- **WHEN** provider 的错误响应带超长 `message` / `provider_message` / `request_id` / `provider_code`，
  或本地预检失败的错误串包含完整 8,192 字符 URL
- **THEN** 四个字段各自不超过 1,000 字符，且被裁字段逐一进入 `truncated_fields`；URL 本身的
  `source.url` 不被裁剪

#### Scenario: 审计按实际发生记录预检与外发

- **WHEN** 分别发生 allow_all 正常执行、ask 批准后执行、deny、未配置
- **THEN** 只有进入 executor 的 Fetch 审计 `local_precheck=true`；`provider_fetch` 只在
  `attempts>0` 时为 true；deny / 未配置的审计两个布尔均为 false，MUST NOT 按 operation 恒猜

#### Scenario: 结果读数按预算裁剪后的实际回送计算

- **WHEN** Search 返回的结果被字段截断、聚合裁剪或整条移除
- **THEN** `result_count` 等于最终仍回送模型的结果条数，`result_text_bytes` 等于这些结果的
  title / snippet / summary / content 的 UTF-8 字节和；真正成功的空结果为 `0` 而不是 null，
  失败 / 非 Search 成功为 null（MUST NOT 以 0 冒充）

### Requirement: Web 访问策略与 origin 例外

`harness.web_access.approval` 缺省为 `allow_all`，`web_search` / `web_fetch` SHALL 在所有权限模式中
默认直接执行；只有显式 `approval=ask` 才进入批准闸。Web 判定顺序 SHALL 为 deny > 既有硬层 >
`web_access.approval`，deny 永远优先。Web MUST NOT 使用 allow 规则或会话缓存派生授权，也 MUST NOT
生成 Web 专用持久 allow / 免问动作；其它工具的 allow / 缓存语义不变。

Search 的 permission subject SHALL 为完整 query；Fetch 的 subject SHALL 为规范化 origin
（scheme + host + 有效 port），origin 规范化 SHALL 小写 scheme / host、省略默认 port、保留非默认 port，
且不含 userinfo / path / query / fragment。默认无批准卡时，Web 工具行 SHALL 默认紧凑：运行中单行
显示状态与纯 query（Fetch 为纯 URL），MUST NOT 显示原始 arguments JSON 或默认参数；完成后默认
显示 query（Fetch 为 URL）；Fetch 的默认行 URL SHALL 是调用 arguments 的原始输入 URL，重定向后的
最终 `source.url` SHALL 只在默认关闭的「查看详情」中呈现，MUST NOT 覆盖默认行。Search 成功另有
第二行结果健康摘要——正常为 `N 条结果 · 文本 X`，
字段截断追加 `· 已截断`，`truncated_fields` 含 `results` 时为 `保留 N 条结果 · 文本 X · 已截断`，
真正成功的空结果为 `0 条结果 · 搜索成功`（英文同义双语；N 与 X 的口径见「统一 Web 搜索与抓取
工具」条）。失败时直接显示稳定错误码与人话原因，MUST NOT 显示条数或文本大小。provider id、
attempts、完整 query / URL、截断字段、实际外发与费用、`trust:"untrusted"` SHALL 全部保留在默认
关闭的「查看详情」中，可展开完整回看；MUST NOT 删除事件 / 面板记录 / JSONL / 安全元数据。Ask
待决卡的完整预览信息不变。live 事件与快照 / 会话恢复两条路径 SHALL 同形同默认态：恢复行的
query / URL SHALL 从该调用的持久化输入（同一份 arguments，完整不截断；Fetch 为原始输入
URL）恢复，MUST NOT 把失败摘要（`状态 · code: message`）或最终 `source.url` 当默认行参数；
旧留存缺该输入时 SHALL 安全降级为空、MUST NOT 伪造。
旧留存缺结果读数时 SHALL 不显示条数与文本大小（MUST NOT 补零）。
`harness.permissions.deny` 中的 `web_fetch(origin)` SHALL 在初始调用与每跳重定向重新判定。

跨 origin 重定向不是新工具调用，MUST NOT 另开批准。预检 SHALL 先校验 Location 的 scheme / 凭据 /
host，再检查目标 origin deny；未封禁才继续 DNS / 连接 / 内容类型校验，全部通过后可执行。
被封禁目标在任何 approval 值下都 SHALL 返回 `permission_denied`，且不连接该 origin、不调用 DeepSeek。
基础参数形状与 URL scheme / userinfo 校验 SHALL 在可选批准预览之前完成，非法调用不得产生携带凭据
或无效目标的批准卡。任何 approval 值都不得跳过 DNS、重定向、内容类型、预算或密钥检查。

#### Scenario: 默认 Allow 不逐次弹卡且审计完整

- **WHEN** approval 缺省为 `allow_all`，模型以不同 query 连续搜索并抓取多个页面
- **THEN** 所有调用默认直接执行，没有会话范围限制或逐次批准卡；每次工具行显示 query / URL 与
  结果健康摘要，provider、attempts、费用与 untrusted 说明保留在默认关闭的「查看详情」中

#### Scenario: origin deny 恢复默认策略

- **WHEN** 权限 deny 含 `web_fetch(https://example.com)`，用户单独移除或清空该 deny
- **THEN** 写入复用既有权限规则与 revision；默认 `allow_all` 下该 origin 恢复直接执行，`ask` 下恢复
  批准闸，approval 不被暗改，其它规则不变

#### Scenario: 跨 origin 重定向只做硬校验与 deny

- **WHEN** Fetch 收到指向另一 origin 的 Location，目标未封禁；另一序列的目标命中 origin deny
- **THEN** 未封禁目标经 scheme / 凭据 / DNS / no_proxy / 内容类型校验后可继续，不另开批准；
  封禁目标返回 `permission_denied`，未连接新 origin、未请求 DeepSeek
- **AND** A → B 全部通过后，提交给 DeepSeek 的 url 与 `source.url` 都是最后一个通过校验的 B URL，
  不得拒绝跨源或继续提交 A URL

#### Scenario: 默认紧凑与详情默认关闭

- **WHEN** allow_all 下一次 Search 成功完成
- **THEN** 工具行显示 query，第二行显示 `N 条结果 · 文本 X`；详情入口读「查看详情」且
  `aria-expanded=false`，审计正文不可见；展开后可见 provider / attempts / 完整 query / 截断字段 /
  外发与费用 / untrusted，再次点击收回

#### Scenario: 空结果、字段截断与结果裁剪

- **WHEN** Search 真正成功但没有结果 / 某字段被截断 / 结果数组被整条移除
- **THEN** 三种分别显示 `0 条结果 · 搜索成功`、`N 条结果 · 文本 X · 已截断`、
  `保留 N 条结果 · 文本 X · 已截断`；N 与 X 取预算裁剪后的实际回送值

#### Scenario: 失败不显示条数与大小

- **WHEN** Web 调用以 `web_provider_unconfigured` / `web_http_error` / `permission_denied` 等失败
- **THEN** 工具行直接显示稳定错误码与人话原因，MUST NOT 出现 `0 条结果` / `0 B` 一类读数；
  provider / attempts / 外发事实仍可在「查看详情」中回看

#### Scenario: 实时与恢复同形

- **WHEN** 同一 Web 调用分别经 live 事件与快照 / 会话恢复重建
- **THEN** 两者工具行（含默认行可见的 query / URL）、第二行健康摘要、详情入口与默认关闭态一致；
  旧留存缺输入 / 读数时不显示 query / URL / 条数 / 大小（MUST NOT 伪造）

#### Scenario: Fetch 重定向的原始输入与最终 URL

- **WHEN** Fetch 从原始 URL A 重定向到最终 URL B 后成功或失败
- **THEN** live、快照恢复与 JSONL 恢复的默认行都显示原始 A；展开「查看详情」后显示最终 B 与
  其余审计事实；默认行 MUST NOT 被最终 B 覆盖

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
目标站。默认无批准卡时该事实与费用 SHALL 仍在设置区、工具行与结果可见；`approval=ask` 时还须在
批准卡可见。目标预检与 DeepSeek client SHALL 都显式 `no_proxy`，不得继承系统或手动代理。
tools API 的 3xx MUST NOT 跟随并统一归 `web_provider_protocol_error`；目标预检 MUST NOT 携带
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

每次 Fetch 与每次重定向 SHALL 重新执行完整 URL / DNS 校验。URL SHALL 为 1–8192 字符的
HTTP / HTTPS、含 host、无 userinfo；其它 scheme、控制字符、反斜杠混淆与解析失败 SHALL 拒绝，
MUST NOT 修复成另一个 URL。IP 字面量与 DNS 的全部 A / AAAA 结果 SHALL 都是全局可路由单播；
任一结果为 loopback、private、link-local、unspecified、multicast、reserved、documentation、CGNAT、
IPv4-mapped / 兼容映射的非全局地址时整条拒绝，MUST NOT 只挑一个公网地址放行。`localhost`、
`.local` 与 DNS 解析失败 SHALL fail closed。初始 URL 的 scheme / 凭据与主机类判定（`localhost`、
`.local`、IP 字面量是否全局可路由）只依赖 URL 字面量，SHALL 在 provider 解析之前完成；重定向的
每一跳仍 SHALL 重新执行同一套主机类判定，两处共用同一判定实现（同一语义 MUST NOT 两处真源）。

连接 SHALL 只使用已验证地址集，并保留原 host 的 Host 与 TLS SNI；连接前 MUST NOT 再次由系统 resolver
自由选择地址。目标预检与 DeepSeek client SHALL 都显式 `no_proxy`，每个 hop MUST NOT 重新继承
HTTP(S)_PROXY / ALL_PROXY / NO_PROXY 或手动 Proxy。`no_proxy + 已验证地址集 + 原 Host / SNI +
手动逐跳 redirect` SHALL 是同一客户端构造不变量，不能只靠 resolver override 防代理绕路。
校验与连接 SHALL 共用同一地址集，下一跳 SHALL 重新执行全集校验，以防 check-then-connect 与
DNS rebinding 绕过。错误 MUST NOT 回显完整 DNS 答案或内部网络拓扑。

本地预检 SHALL 每个 hop 先发 HEAD，无法判定时用 `Range: bytes=0-4095` GET 复核；即使目标忽略 Range，
读取 SHALL 以响应头和最多 4 KiB 为界并随即关闭，预检正文 MUST NOT 进入模型。单 hop 不得超过 10 秒、
整链不得超过 30 秒、最多 5 次重定向；预检 MUST NOT 自动重试。相对 Location SHALL 按当前 URL 解析并
逐跳重验 scheme / 凭据 / host 与 origin deny；跨 origin 不是新工具调用，未封禁才继续 DNS 与连接，
不另开批准。

预检 SHALL 只接受 `text/html` 与 `application/xhtml+xml`（可带参数）。明确非 HTML 返回
`web_unsupported_content`，Content-Type 缺失或冲突且 Range GET 仍无法判定返回
`web_content_type_unknown`；两者只可提示另行选择 curl，MUST NOT 自动调用。预检通过后才可调用
DeepSeek Fetch，且只发送最后一个通过全部校验的 URL（允许跨 origin）。Search MUST NOT 主动访问结果 URL。

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

- **WHEN** 目标页面先对 HEAD 返回不明确 Content-Type，再对忽略 Range 的 GET 返回超大 HTML，随后跨 origin 跳转
- **THEN** GET 最多读取 4 KiB 即关闭，正文不进入模型；下一跳重新做 URL / DNS 校验，整链超过时限或
  5 跳即失败且不调用 DeepSeek

#### Scenario: 整次 deadline 覆盖预检

- **WHEN** Fetch 的本地预检耗时超过整次工具调用预算（150 秒；测试注入更短值）
- **THEN** 在共享 deadline 用尽时返回 `web_timeout`、`attempts=0`，且不再向 DeepSeek 发送任何请求

#### Scenario: 非 HTML 不自动回落 curl

- **WHEN** 预检确认目标为 PDF / 二进制，或无法确认其为 HTML
- **THEN** 分别返回 `web_unsupported_content` / `web_content_type_unknown`，DeepSeek attempts=0；
  模型可另行选择 curl，但该调用仍走既有 CLI 权限与批准

#### Scenario: 不伪称 provider 侧 SSRF 证据

- **WHEN** DeepSeek 对预检后的 URL 返回 Markdown，但未返回远端 final URL / IP / redirect chain
- **THEN** `source.url` 只表示本地预检并提交的 URL；审计不得写成「已验证 DeepSeek 最终连接地址」

### Requirement: Web 请求可靠性与计费边界

DeepSeek 每次 attempt SHALL 连接超时 5 秒；Search / Fetch attempt 总超时分别 30 / 45 秒，含退避与
本地预检的整次工具调用分别不超过 100 / 150 秒。Fetch 的本地预检与 DeepSeek 阶段 SHALL 共享同一
deadline：预检只使用剩余时间，整次 deadline 用尽后 MUST NOT 再发 provider 请求，返回 `web_timeout`
且 `attempts=0`。响应头与 body 读取 SHALL 计入 deadline。取消 SHALL 复用
`ctx.aborted()` 的同一事实源，在发起前、退避、响应等待与 body 分块读取时检查，且 MUST NOT 持会话锁。
取消后 SHALL 关闭响应、不再发新 attempt、返回 `web_cancelled`，部分 JSON 不得当成功解析；
已在 OS / provider 处理的请求无法撤销，系统 MUST NOT 承诺取消可撤销潜在费用。

自动重试 SHALL 只针对 DeepSeek tools API 的 HTTP 408 / 429 / 5xx，最多初次 + 2 次重试；退避优先使用
上限 2 秒的 `Retry-After`（delta-seconds 或 RFC 2822 / IMF-fixdate 的 HTTP-date；obsolete RFC 850 /
asctime 形态按缺失处理），缺失时使用 250ms、1s。重试耗尽后的 `message` SHALL 如实写明「已尝试
初次 + 重试」；单次不可重试的失败才使用「未自动重试」。其它 4xx（含 425）、本地 DNS / connect / TLS /
timeout、取消、200 后响应过大 / 非 JSON / 坏 JSON / 形状不符 / 空正文 MUST NOT 自动重试。
本地预检 MUST NOT 自动重试。Search 空 results 不视为错误，Fetch 空 Markdown 即使官方不计费也不重试。
200 已到达后的本地解析失败 MUST NOT 为追求成功而重复请求。

错误 SHALL 使用稳定内部分类：`web_args_invalid` / `web_access_config_invalid` /
`web_provider_unconfigured` / `web_url_blocked` / `web_dns_failed` / `web_dns_blocked` /
`web_redirect_limit` / `web_unsupported_content` / `web_content_type_unknown` / `web_network_failed` /
`web_timeout` / `web_cancelled` / `web_response_too_large` / `web_provider_protocol_error` /
`web_http_error` / `web_empty_content`。4xx / 5xx SHALL 归 `web_http_error` 并保留真实 status、
attempts 与可得的 provider code / request id；3xx SHALL 不跟随并统一归
`web_provider_protocol_error`，不得双重映射。DeepSeek 404 MUST NOT 被伪造为更精确的目标原因。
`web_access_config_invalid` 的结果 SHALL 为 `provider:null, provider_id:null, attempts:0`，不注册、
零请求，MUST NOT 映射为 `tool_unknown` 或 `web_provider_unconfigured`。

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

Search / Fetch 的 title、snippet、summary、content 与 provider_message SHALL 全部视为
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
新 Web 调用仍按当前 `web_access.approval` 与 origin deny 处理，并重新执行全部安全校验。
历史恢复 SHALL 仅凭既有 JSONL 保留 query / URL、来源、错误与
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

### Requirement: Skill 候选可见性的机器判据

Skill 候选「游标 option 完整落在真实可见带内」的机器判据 SHALL 独立于实现计算真实可见带：
取候选盒与**全部裁切祖先**矩形及视口的交集，再扣掉候选自身（滚动口）的边框与 padding。
判据 MUST NOT 复用实现里的裁剪辅助函数、MUST NOT 以候选自身的盒或 `clientHeight` 代餐——
与实现同源的判据只能证明「实现与自己一致」，祖先裁切或滚动口 padding 出错时它照样通过。

判据 SHALL 在**每一次**游标变化上成立，而不是只在某个代表步：真实规模目录（超过一屏、含长描述）、
`↑` / `↓` 与 `⌃N` / `⌃P` 两种键族、向下与向上两个方向，逐拍走完整个列表。每一拍 SHALL 同时断言
（a）游标 option 完整落在真实可见带内；（b）可见标记（`.is-selected`）与 `aria-selected` 在**同一个**
option 上、且同一时刻至多一个可见标记，标记本身可辨（线宽 / 颜色与底色差成立）。
候选滚动位置发生变化、或 AX 树里存在该行，MUST NOT 单独作为「可见」的判据。

该判据 SHALL 在 chromium 与真机同款 UA 的 WebKit project 各判一次：揭示只写 `scrollTop`，两引擎的
滚动钳制与子像素取整不同，chromium 绿 MUST NOT 替代真实 UA 的 WebKit 分支（该 project 不覆写
`deviceScaleFactor`，实际 DPR 1）。

真机验收场景 SHALL 为同一条不变量给出 **AX 暴露**判据：AX 快照按离屏过滤只暴露曝光窗口内的行，而该
窗口比像素可见区**多一行**，因此它是**必要不充分**判据——游标行的文本不在快照里 SHALL 判为「该行在真实
可见带之外」（这一向足以判红），文本在场 MUST NOT 被判为「整行完整可见」。整行 ⊆ 真实可见带、带内不动、
留一行上下文这些完整几何 SHALL 由浏览器几何矩阵判定，MUST NOT 用 AX 暴露冒充；只留截图 MUST NOT 被
当作可见性判据。

#### Scenario: 长目录逐拍导航

- **WHEN** 真实规模目录（30 项、长描述）打开候选，并逐拍按 `⌃N` 走到底、再逐拍按 `⌃P` 走回顶
- **THEN** 每一拍的选中 option 都完整落在独立计算的真实可见带内，`.is-selected` 与
  `aria-selected` 指向同一项，且恰好一个可见标记

#### Scenario: 候选盒不得越出裁切祖先

- **WHEN** 短视口、共享字号缩放、窄 harness pane 或窗口收缩后候选重排
- **THEN** 候选盒的上下缘仍在裁切祖先与视口之内（必要时收缩 `max-height`），游标 option 仍完整在带内；
  原本完整可见的游标被新几何挤出带时补揭示，被用户手动滚开的位置不被拉回

#### Scenario: 真机选中行的 AX 暴露

- **WHEN** 真机场景把游标移到列表末项与倒数第二项
- **THEN** 该行的文本出现在 AX 快照的曝光窗口里（窗口外的行不暴露；窗口比像素可见区多一行，故本判据
  只能判「不出现＝不可见」这一向），完整几何由浏览器矩阵判，判据不依赖截图

### Requirement: Skill 的混合调用、入口策略与候选接受

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
MUST NOT 被当作显式调用依据；候选未出现或已被关闭时，`/tmp`、`/usr/local` 等斜杠开头路径与
普通文本保持原义，有候选时按「高亮即接受」由按键确认。调用关系 SHALL
由发送时随当前新消息提交的显式选择元数据表达，按文本位置排序、同名只取首次。后端 MUST NOT 从消息文本
解析技能名。历史消息里的 token / 选择 MUST NOT 在后续轮次重新触发显式注入；重试 SHALL 原样回放该轮输入。

**高亮即接受**：候选打开且 `items` 非空时 SHALL 总有唯一游标，且该游标 SHALL 直接处于接受态
（armed）；无修饰 `Enter` / `Tab` SHALL 把 `items[highlighted]` 替换为 `/完整名 ` 并创建引用，
MUST NOT 发送消息。接受不要求 token 前缀等于全名，也不要求候选唯一——打开即按首项 / 按名字保留项 /
全名项高亮，用户看见哪一项，接受键就作用于哪一项（Alex 2026-11-26 批准的 Enter 新合同）。接受是
**用户按键确认**的显式选择，MUST NOT 被描述为后端从文本推断调用；`/tmp` 这类路径前缀在有候选时同样
按当前高亮接受，候选不存在或用户先 `Esc` 关闭时 `Enter` 才回到发送原义。

**异步候选更新**：catalog / 索引回包只更新 `items`，SHALL 按名字保留当前游标与接受目标；目标消失时
回落（全名项 > 首项）并照常保持接受态。接受动作在按键时刻定格目标，晚到回包 MUST NOT 把已接受的项换成另一项；
候选已因 `Esc` / 接受 / 失焦 / 换会话关闭时，旧回包 MUST NOT 重新打开候选、改写 composer 文本或
新增 / 替换引用。

**候选、游标与接受态**：键入 `/` 且满足边界与名字前缀匹配时 SHALL 显示候选。候选 SHALL 维护**唯一游标**
与**接受态**（定义见 `docs/specs/selector-contract.md` C1 / C4）：游标打开即有，取全名项、按名字保留的
上一项或首项；方向键 / `⌃N` / `⌃P` 与指针真实移动只负责改变游标，`items` 非空时接受态恒为真，
`data-armed` 只作「有效高亮 ⇒ 可接受」的观测位，MUST NOT 被样式消费。无候选时 `Enter` / `Tab`
MUST NOT 被候选消费；有候选时无修饰的 `Enter` / `Tab` 接受当前项，`Esc` 关闭，鼠标点击接受且
按下时 MUST NOT 夺走输入区焦点。`Esc` 关闭候选后 `Enter` SHALL 发送 composer 原文（含 `/名字`、
`/tmp` 等字样），MUST NOT 接受任何项。

候选打开时无修饰的 `↑` / `↓` 与无 Shift 的 `⌃N` / `⌃P` SHALL 经同一路径移动游标（下一项 / 上一项，
到端停住、不环绕），事件 SHALL 被候选消费且 MUST NOT 同时移动 composer caret、改变文档或产生撤销步。
游标由指针移动接管时，揭示滚动把另一行搬到静止指针下面 MUST NOT 改动游标。
候选关闭时的 `⌃N` / `⌃P` SHALL 保留 composer 既有 Emacs 行移动；`⌃⇧N` / `⌃⇧P` SHALL 保留既有扩选，
候选按原有关闭路径结束但 MUST NOT 消费该组合键。带修饰键的同名方向键 MUST NOT 被候选消费；
`⇧↑` / `⇧↓` SHALL 保留原生扩选，扩选使 caret 离开 Skill token 后候选按既有选区同步路径关闭，MUST NOT
为保留候选而阻断或重写原生选区。`Esc` SHALL 走共享浮层层栈，一次只关最上层，MUST NOT 收起面板或移动焦点。

**候选几何与揭示**：真实可见带 SHALL 取 `menuRect ∩ panelRect ∩ viewport`（再扣掉候选自身的边框与
padding），MUST NOT 取候选的 `clientHeight`——菜单盒被祖先裁掉时，盒内坐标会把屏外的行判成可见。候选盒
SHALL 完整落在面板与视口内：面板高度不足时收缩 `max-height`，允许向上覆盖 transcript，垂直夹取宿主
MUST NOT 是 composer 区；行高与高度 MUST 取实测值，MUST NOT 另留一份硬编码行高。下方放置 SHALL 以
控制行顶缘为界，MUST NOT 压住控制行；上翻空间不足时 SHALL 先按上方可用空间收缩 `max-height`，
MUST NOT 让盒底越过 caret；`max-height` 上限的唯一真源 SHALL 是 CSS，上限 MUST 取「清空 inline 后实测的
受约束高度」，MUST NOT 把 `getComputedStyle` 的字符串按 px 解析（百分比等非 px 计算值会被静默误读）。
候选在窗口 / 面板尺寸变化与同状态回包（token / 游标 / items 不变）后 SHALL 按新 clip 重新夹取；
揭示只在游标改变、或重排前完整可见的游标被新几何挤出带时发生，重排 MUST NOT 重建 items、MUST NOT
改动游标，也 MUST NOT 把用户手动滚开的候选位置拉回游标项；重排内部为读数清空 `max-height` 时 MUST 保留
候选自身滚动位置（先记后恢复），已完整可见目标的 `scrollTop` MUST NOT 因此改变。判定「重排前完整可见」
SHALL 依据上一次放置确立的几何（上一次放置后游标完整在带内，且此后用户没有滚动过候选），MUST NOT 依据
几何变化后的 clip。

游标经键盘或指针改变后，当前 option SHALL 完整落在真实可见带内；已完整可见时候选滚动位置 MUST NOT 改变，
越界时 SHALL 只滚动候选到带边缘并保留一行上下文，首尾自然 clamp。首尾、长列表与指针 / 键盘混合输入均
SHALL 满足同一不变量，MUST NOT 通过滚动整页、transcript、编辑器或 composer 完成揭示。候选 SHALL 继续
归滚动条细条档，右缘 12px 内 MUST NOT 新增常驻可交互件。

**候选响应式尺寸**：候选 SHALL 按 composer 宿主可用宽度加宽。令 `avail = max(0, hostWidth − 16px)`、
`cap = min(48em, avail)`、`target = min(max(200px, 0.85 × avail), cap)`，最终宽度 SHALL 为
`min(max(naturalWidth, target), cap)`。窄 pane MUST NOT 越界，正常 pane 的短内容 SHALL 取得可用空间驱动的
目标宽，超宽 pane MUST 受 48em 上限，长描述 SHALL 可超过旧 26em；em 上限 SHALL 随共享 Harness 字号缩放。
该 Skill 专用目标宽与上限 MUST NOT 改写其它 list 浮层的 26em 档。

输入法组合期 MUST NOT 触发候选、响应候选导航键或吞掉确认候选的 `Enter`；组合开始时已打开的候选 SHALL
立即关闭。组合结束后 SHALL 按**最终文档**重算一次候选状态（在 CodeMirror 的 pending MutationRecord 清空
之后），MUST NOT 在 `compositionend` 的同步路径里抢确认 `Enter`。

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

- **WHEN** 用户完整键入 `/acc-skill-abc 问题`（名字后跟空格与正文，token 已结束）并发送
- **THEN** 候选此时不显示；消息照常发出，该用户消息不含 `lumir_skill` 或显式注入正文；模型自主入口是否
  按既有逻辑调用不受该文本 token 强制。名字后未继续输入、caret 仍在 token 内时按「部分匹配与多候选默认
  接受当前高亮」场景处理。

#### Scenario: 路径前缀候选按高亮接受，Esc 后发送原文

- **WHEN** vault 内存在名为 `tmp-acc` 的技能，用户在行首、空格后或列表项里键入 `/tmp`
- **THEN** 候选显示且 `tmp-acc` 是当前高亮；`Enter` 把它替换为 `/tmp-acc ` 并创建引用（不要求全名），
  不发送消息；若用户先按 `Esc` 关闭候选再按 `Enter`，消息发送原文 `/tmp`，`llm_request.messages`
  不含 `lumir_skill`

#### Scenario: Esc 关闭后 Enter 发送原文

- **WHEN** 候选已显示（`Enter` 本会接受当前高亮），用户先按 `Esc` 关闭候选，再按 `Enter`
- **THEN** 消息按 composer 原文发送，不创建 Skill 引用；候选不因这次发送或迟到回包重新打开

#### Scenario: 部分匹配与多候选默认接受当前高亮

- **WHEN** 候选显示两项以上（如键入 `/acc` 命中 `acc-skill-abc` 与 `acc-deploy`），用户未按方向键、
  未移动指针，直接按无修饰 `Enter` 或 `Tab`
- **THEN** 接受键把当前高亮（首项）替换为 `/acc-skill-abc ` 并创建引用，MUST NOT 发送消息；
  再按一次 `Enter` 才发送该消息。方向键 / `⌃N` / `⌃P` / 指针改变高亮后，接受键作用于新的高亮项

#### Scenario: 无候选时 Enter 发送普通文本

- **WHEN** 用户键入 `/zzz`（前缀零命中，候选不显示），或继续输入使 Skill token 结束，然后按 `Enter`
- **THEN** 消息按原文发送，`skills_json` 为空；候选不消费该 `Enter`，也不创建 Skill 引用

#### Scenario: 异步 catalog 不换接受目标、旧回包不重开候选

- **WHEN** 候选打开期间 catalog / 索引回包晚到并按名字保留当前项；或候选已因 `Esc` / 接受而关闭后
  才收到旧回包
- **THEN** 打开期间的回包 SHALL 保留当前游标与接受目标（名字消失才回落全名项或首项），`Enter` 接受的
  仍是同一项，MUST NOT 换项；关闭后的旧回包 MUST NOT 重新打开候选、改写 composer 文本或新增 / 替换引用

#### Scenario: 选择态键位与 IME

- **WHEN** 候选已武装，用户使用方向键 / Ctrl+N / Ctrl+P / Enter / Tab / Esc；另一次在中文输入法组合期键入或确认
- **THEN** 候选只消费相应导航与选中键，Ctrl+N / Ctrl+P 与方向键分别同义且不改 composer caret 或文档；
  Esc 只关候选；组合期不触发、不导航、不吞确认 Enter，组合开始关闭已有候选；组合结束后按最终文档重算
  一次候选状态（重算后仍是接受态，但仍不抢组合确认的那拍 Enter）

#### Scenario: Shift+Arrow 保留原生扩选并关闭候选

- **WHEN** 候选已显示，caret 位于多行 composer 的 Skill token 末尾，用户按 `⇧↑` 或 `⇧↓`
- **THEN** 事件不被候选消费，原生扩选非空且文档不变；caret 离开 Skill token 后候选按既有选区同步路径关闭

#### Scenario: 长列表高亮始终可见且不带动整页

- **WHEN** 候选长度覆盖不足一屏、恰好一屏与超出一屏，用户用两类键盘从首项到末项再返回，并在中部交替使用指针与键盘
- **THEN** 每次游标改变后当前 option 均完整落在 `menuRect ∩ panelRect ∩ viewport` 内；已可见时滚动位置不变，
  越出时只滚动候选到带边缘并保留一行上下文；游标不环绕，整页、transcript、编辑器与 composer 的滚动位置不变

#### Scenario: 可见最底项再移一项

- **WHEN** 长列表打开时游标停在最后一个完整可见行，用户再按一次 `↓`
- **THEN** 下一项完整进入真实可见带，且它与带底之间保留一行上下文；候选 `scrollTop` 增大，祖先与页面的
  滚动位置不变

#### Scenario: 短视口收缩态连续导航

- **WHEN** 视口高度不足、候选已按可用空间收缩且列表真实溢出，用户连续按 `↓` 到末项再连续按 `↑` 回到首项
- **THEN** 每一拍高亮项仍完整落在真实可见带内；按键前已完整可见的目标，其 `scrollTop` 不变——重排为读数
  清空 `max-height` 造成的钳制 MUST NOT 泄漏到揭示判据

#### Scenario: 窗口缩放与同状态回包后的重排

- **WHEN** 候选打开时把窗口缩放到面板高度大幅缩短，或候选打开期间发生一次不改变 token / 游标 / items 的
  文档回包（同状态同步）
- **THEN** 候选盒按新的 `menuRect ∩ panelRect ∩ viewport` 重新夹取、必要时收缩 `max-height`；重排前完整
  可见的高亮项仍完整可见，候选 items 不重建（option 节点不变），游标与 `aria-selected` / `data-armed` /
  `aria-activedescendant` 均不变

#### Scenario: 手动滚开后的重排不拉回高亮项

- **WHEN** 用户先把候选向上滚开（高亮项已不在可见带内），随后发生同状态回包，或窗口 / 面板尺寸变化
- **THEN** 候选 `scrollTop` 保持用户滚到的位置，揭示不发生，高亮项不被搬回视野；只有新的几何把原本
  完整可见的游标挤出带时才按最小揭示把它带回带内，且 MUST NOT 借机回弹到高亮首项

#### Scenario: 同拍放置让游标揭示不受跨拍让位例外影响

- **WHEN** 用户先把候选滚开（高亮项已不在可见带内），或刚发生一次同状态回包 / 窗口缩放的重排，随后按
  `↓` / `↑` / `⌃N` / `⌃P` 改变游标
- **THEN** 新游标仍 SHALL 完整落在 `menuRect ∩ panelRect ∩ viewport` 内并按最小揭示保留一行上下文；
  Skill 候选的放置与揭示在同一拍内完成，不存在「游标改变后、写拍前」可被用户滚动插入的窗口，C3 的
  跨拍让位例外在本表面不成立；让位只作用于没有游标变化的重排，MUST NOT 被扩展成「游标改变可以不揭示」

#### Scenario: 三类宿主宽度与三主题下的响应式尺寸

- **WHEN** 在 light / dark / eink 下分别把 Harness pane 置于窄、正常、超宽可用宽度，并显示短描述与长描述候选
- **THEN** 短内容宽度随可用空间增长，长内容可超过 26em 但不超过 48em 或 pane 可用宽；菜单始终不越出宿主，
  其它 list 浮层宽度不变

#### Scenario: 候选关闭后 `⌃N` / `⌃P` 保留行移动

- **WHEN** 候选未打开，composer 光标位于多行文本中，用户按 `⌃N` 或 `⌃P`
- **THEN** 光标按输入区既有行移动语义处理，事件不被候选消费，消息不发送、文本不变

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
  `harness.web_access.enabled=false` 时 Web 工具不注册，不得以幻觉调用代替显式 CLI 选择

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

### Requirement: 显式 Skill 加载痕迹

用户显式选择的每个 Skill SHALL 在 harness 面板留下**恰好一条**与工具调用同形的痕迹记录（工具行），
加载成功与失败同等留痕。痕迹 MUST 显示 Skill 名称与终态：成功 SHALL 呈「已加载」终态；失败 SHALL 呈
失败终态并给出具体原因——至少覆盖名字不合 grammar、当前回合发现结果里不存在、SKILL.md 缺失 /
不可读 / 超限、加载结果无正文、调用元数据非法、`user-invocable: false` 与权限拒绝，MUST NOT 静默跳过。

痕迹 MUST 只含名称、终态、错误码 / 人话原因与时刻，MUST NOT 含 SKILL.md 正文或 Skill 目录内其他文件
的内容；面板文本与辅助技术树 MUST NOT 因该痕迹出现任何正文。痕迹行的工具名 SHALL 为 `explicit_skill`
（与模型自主调用的 `skill_load` 区分），MUST NOT 被描述或呈现为模型自主调用；行的折叠、图标、参数格、
失败尾注与时间读数 SHALL 复用既有工具行视觉体系，MUST NOT 新造一套渲染形态。既有 requirement 里对
未知 / 超限 / 读取失败 / 不合 grammar 的「跳过」SHALL 仅指不注入正文、不阻断发送；本条要求这些名字
留下失败痕迹，MUST NOT 改变其正文注入面。

痕迹行的工具名只用于面板呈现，MUST NOT 向模型注册成第二件工具；权限判定仍以 `skill_load` + 技能名 +
`{"name": <name>}` 进行，与既有显式入口逐字一致。

痕迹 SHALL 可恢复：痕迹项 SHALL 随该条用户消息进入会话 `input` 与 `llm_request.messages` 的本地字段
`lumir_skill_trace`（数组，元素含 `name` / `status`，失败时含 `code` / `message`，及 `ts`），该字段 MUST
在发送给 provider 的 wire 展开时被剥离；恢复会话 / 切换历史后 SHALL 从该字段重建同一批工具行（名称、
终态、原因与时刻一致），MUST NOT 重新执行正文加载。live 路径与恢复路径 MUST 共用同一份「痕迹项 → 面板
消息」映射，MUST NOT 各算一套；两条路径 MUST NOT 重复留痕。重试 SHALL 原样回放该轮输入，MUST NOT 重算
痕迹或追加痕迹行。

同名选择 SHALL 只加载并留痕一次（按发送顺序先到先得）。显式痕迹 MUST NOT 改变权限判定、执行期正文
加载器、正文注入 part、面板正文投影、自动命名素材与自动 `skill_load` 的工具行 / 结果回送：权限与策略
失败沿用既有错误码，自动入口的既有表现逐字不变。

#### Scenario: 成功加载留一行

- **WHEN** 用户显式选择一个可加载 Skill 并发送消息
- **THEN** 该用户消息之后出现一条工具名 `explicit_skill` 的痕迹行，参数格为该 Skill 名称，终态为已加载；
  SKILL.md 正文仍只进入该用户消息的模型可见 part，面板文本与 AX 不含正文字符串

#### Scenario: 多 Skill 一次发送

- **WHEN** 一条消息显式选择两个不同 Skill，且元数据里重复出现其中一个名字
- **THEN** 每个不同名字各得一条痕迹行（同名的重复项不产生第二行），行的顺序与发送元数据里各名字首次出现
  的顺序一致

#### Scenario: 失败留痕与具体原因

- **WHEN** 用户显式选择的名字分别命中 grammar 不合、不存在、元数据非法、禁手动、权限 deny、SKILL.md
  缺失与 SKILL.md 超限
- **THEN** 每个名字各得一条失败终态的痕迹行，尾注含对应错误码与人话原因（权限拒绝带命中的规则原文，
  口径同既有 deny 回送）；用户消息照常发送；失败原因 MUST NOT 以任何正文 part 形式进入该消息

#### Scenario: 恢复后痕迹仍在且不重复

- **WHEN** 含显式痕迹（成功与失败各至少一条）的会话被切走后再恢复
- **THEN** 面板重建出同样的痕迹行（名称、终态、原因与时刻一致），MUST NOT 重新执行正文加载；
  每条名字仍然只有一行，用户消息不重复、正文不上屏

#### Scenario: 重试不重复留痕

- **WHEN** 显式回合的 provider 往返失败后用户触发重试
- **THEN** 该轮输入原样回放，不重新加载 Skill、不新增痕迹行；之后恢复该会话，每个名字仍只有一行

#### Scenario: 自动入口不回归

- **WHEN** 模型自主调用 `skill_load`
- **THEN** 仍走既有的工具行与工具结果回送，不产生 `explicit_skill` 痕迹行；其重试、恢复与压缩行为不变

#### Scenario: 正文与失败码不进入 provider wire

- **WHEN** 一次显式发送同时含成功加载与失败选择
- **THEN** 留存里的该用户消息带 `lumir_skill` 正文 part 与 `lumir_skill_trace` 数组，但实际发送给 provider 的
  wire MUST NOT 含 `lumir_skill`、`lumir_skill_trace` 标记，也 MUST NOT 出现失败错误码；正文仍按既有语义
  进入 wire

### Requirement: 流式分片定稿的边界与字符守恒

流式正文的增量渲染把每段源切成「已定稿块」与「进行中尾块」；切分点 SHALL 是**下一片尾块在当前源里的起点**。对任意当前已到达的源，定稿边界 MUST 是 `[0, source.length]` 内的整数——MUST NOT 指向源长之外。源以换行结尾时 `split("\n")` 多出的末尾空串行 MUST NOT 把边界推到源长之外；边界越界等于让下一片从源外起切，其首字符被吞掉且不报任何错。

「已定稿块 + 尾块」SHALL 与当前源逐字一致（不丢、不重复、不重排）；后续分片到达时 MUST NOT 因切分游标而跳过任何字符，含分片恰好断在尾换行之后的情形。分片点落在块边界（空行之后）时，两段渲染文本的拼接 SHALL 等于同源完整渲染的文本；分片点在普通段落内部的软断行处时，源层守恒仍 MUST 成立（渲染形态在轮次收口时收敛，与既有增量渲染口径一致）。

本 requirement 只约束切分游标的边界与字符守恒，MUST NOT 改变 Markdown 解析语义、定稿时点或排版：尾换行、连续空行、CRLF、闭合代码围栏之后的已结束块照旧 SHALL 可定稿；未闭合围栏内的空行与仍在生长的列表内部空行照旧 MUST NOT 构成定稿边界（列表上下文合同见「Harness Markdown strong 的流式渲染一致性」）。

#### Scenario: 尾换行分片后首字符不丢

- **WHEN** 第一片正文以换行结尾（段落 + 单个 `\n`，或段落 + 空行 + `\n`），面板完成一次增量渲染；第二片的第一个字符随后到达
- **THEN** 第二片整段进入尾块且其首字符上屏；已定稿块不重渲，也不吞掉、复制或重排任何字符

#### Scenario: 边界恒在源长内

- **WHEN** 对任意已到达的流式源（含尾换行、连续空行、CRLF、闭合围栏、空源）计算定稿边界
- **THEN** 边界恒为 `[0, source.length]` 内的整数；以该边界切出的「冻结前缀 + 尾块」与当前源逐字相同

#### Scenario: 既有定稿语义不回归

- **WHEN** 源末尾是闭合代码围栏后的空行、列表内部空行，或未闭合围栏内的空行
- **THEN** 闭合围栏后的已结束块照旧可定稿；列表内部空行与未闭合围栏的空行照旧不构成定稿边界；普通段落的增量定稿能力不被移除
