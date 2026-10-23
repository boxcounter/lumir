# harness Specification

## Purpose
定义 AI 探针（harness）的落地口径——ADR 0007 授权的探索期能力：应用骨架右栏 dock 的对话面板
（唤起 / 收起、流式 Markdown 呈现、上下文用量常驻显示）；唤起时的编辑器上下文注入（当前路径 +
视口行范围，发送前可核对）；AGENTS.md 三层（user-wide `~/.agents/AGENTS.md` + vault 根 +
vault 根 `AGENTS.local.md` 本地覆盖层）与 Skill
双根（user-wide + vault-wide）的自动装配；Rust core 的工具循环与固定工具集（`vault_read` /
`vault_search` / `vault_patch` / `vault_create` / `vault_move` / `vault_delete` / `skill_load` /
`cli_run`，共 8 件）；三层权限规则（allow / ask / deny）之上的**三档权限模式**（`read_only` /
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
归档并入（2026-10-11）叠加 composer 图片粘贴 / 投递协议与按 vault 分目录的会话留存。

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

系统 SHALL 自动发现 user-wide（`~/.agents/skills/`）与 vault-wide（`<vault>/.agents/skills/`）两处的 Skill（SKILL.md 约定），vault-wide 同名覆盖 user-wide。Skill 索引（name + description）SHALL 注入系统上下文；`skill_load(name)` 工具 SHALL 按名加载 SKILL.md 全文，路径解析 MUST 限定在两个 Skill 根内（只读、防逃逸）。外部能力（如 Tavily）SHALL 以「Skill + 对应 CLI」形态接入，系统 SHALL NOT 为特定外部服务内置专用工具。

#### Scenario: 索引注入与按需加载

- **WHEN** Skill 根下存在某外部搜索技能且 Alex 提问需要联网搜索
- **THEN** 模型可见技能索引中的该技能条目，经 `skill_load` 取得用法后经 `cli_run` 调用对应 CLI

#### Scenario: 路径逃逸拒绝

- **WHEN** `skill_load` 收到指向 Skill 根外的路径或名称
- **THEN** 拒绝并回送错误，不读取任何根外文件

### Requirement: 工具循环

对话运行时 SHALL 支持工具循环：模型返回工具调用时，系统执行对应工具并将结果回送，直至模型不再调用工具或达到循环上限（默认 50，`[harness].loop_max` 可调；出厂值 M367 由 8 上调至 50，上界仍为 64）。达到上限 SHALL 终止循环并在面板给出明确提示。运行时 SHALL 维护会话状态于 Rust core，webview 重载 MUST NOT 丢失会话。工具集 SHALL 恰好为：`vault_read`、`vault_search`、`vault_patch`、`vault_create`、`vault_move`、`vault_delete`、`skill_load`、`cli_run`——清单外能力扩张须经 Alex 裁决（ADR 0007；本 change 的 `vault_move` / `vault_delete` 即该裁决的落地）。

#### Scenario: 多轮工具往返

- **WHEN** 模型的回答需要先读文件（返回 `vault_read` 调用）
- **THEN** 系统执行读取、把内容回送模型、继续生成最终回答；面板可见「调用了什么工具」

#### Scenario: 移动与删除工具在册

- **WHEN** 模型调用 `vault_move` 或 `vault_delete`（参数为 vault 相对路径）
- **THEN** 系统执行移动/移入废纸篓并按统一结果信封回送；参数逃逸 vault 根时拒绝且文件系统不变

#### Scenario: 循环上限

- **WHEN** 模型连续调用工具达到 `loop_max`
- **THEN** 循环终止，面板显示达到上限的提示，不产生进一步工具执行

### Requirement: 权限机制

系统 SHALL 实现三层权限规则：allow / ask / deny，判定顺序 deny > allow > 默认分层。规则语法 SHALL 支持 tool 级与 tool+模式级（如 `cli(tavily *)` 的命令前缀匹配）。权限规则之外，系统 SHALL 提供**三档权限模式**作为默认分层的档位：`read_only` / `vault_write`（默认）/ `full_access`，逐档语义如下——读类工具（`vault_read` / `vault_search` / `skill_load`）三档均直接放行；`vault_patch` / `vault_create` / `vault_move` 在 `read_only` 档 SHALL 逐个问（Always Ask，2026-10-09 Alex 裁决：该档语义为「读自动放行、一切写逐个问」，模式层 MUST NOT 直接拒绝），在 `vault_write` 与 `full_access` 档 SHALL 自动放行；`vault_delete` 在 `read_only` 与 `vault_write` 档 SHALL 逐个问（Vault Write 档的分界以 Alex 裁决点 1 为口径），在 `full_access` 档 SHALL 自动放行；`cli_run` 只读白名单命令三档均直接放行；`cli_run` 写命令在 `read_only` 与 `vault_write` 档 SHALL 逐个问，在 `full_access` 档 SHALL 自动放行（写目标在 vault 内者除外，见「cli_run 命令分类与 vault 写重定向」）；危险黑名单命令（rm / shutdown·reboot·halt·poweroff / mkfs 系 / dd / git reset --hard / git clean / shell 包装器类，首版清单）**任何档都 SHALL 逐个问**，MUST NOT 自动放行。模式层 SHALL 只在「直接放行」与「逐个问」之间切换，SHALL NOT 产出「拒绝」——拒绝只来自用户 deny 规则。

判定总序 SHALL 为：deny 规则 > vault 内写重定向 > 危险黑名单 > allow 规则 > 模式默认分层——前四层模式无关，allow 规则 SHALL 在任何档生效（含 `read_only` 档），模式只替换最底层默认分层。deny 命中 SHALL 直接拒绝并回送模型：拒绝对话 MUST NOT 进入批准闸（不产批准卡、不等待用户决定），且回送的错误 SHALL 带上**命中的规则原文**（如「命中 deny 规则 cli(npm run deploy*)」），使「是哪条规则拦的」不必回配置文件核对；规则原文拼入后若超出工具行摘要的展示长度上限，SHALL 退回不带规则原文的既有文案，MUST NOT 呈现被截断的规则名。ask 档 SHALL 以批准闸呈现：执行前挂起循环，面板显示待批准项（写文档显示 diff 预览，CLI 显示完整命令），Alex 采纳后才执行，拒绝（及可选原因）回送模型；未决批准项 MUST NOT 自动超时通过。

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

- **WHEN** `vault_write` 档下 Alex 对某 `cli_run` 写命令点「采纳且本会话不再问」，同一会话内模型再次以相同规范化主体串调用同一命令
- **THEN** 第二次调用直接执行不进批准闸；「新会话」后同主体串调用恢复逐个问

#### Scenario: 默认分层生效

- **WHEN** 模型先调用 `vault_read` 再调用 `vault_patch`（默认 `vault_write` 档，均无规则命中）
- **THEN** `vault_read` 直接执行；`vault_patch` 直接执行（默认档写工具自动放行）

#### Scenario: deny 优先

- **WHEN** 一条 `cli_run` 同时匹配 allow 与 deny 规则
- **THEN** 该调用被拒绝并把原因回送模型，不进入批准闸

#### Scenario: 采纳与拒绝

- **WHEN** 面板收到 ask 档批准项的预览（写文档显示 diff、CLI 显示完整命令），Alex 点击采纳（或拒绝）
- **THEN** 采纳则执行（写工具落盘口径不变）；拒绝则副作用不发生，模型收到对应结果

### Requirement: 批准闸呈现与决策后收敛

批准闸的 diff 预览中，以 `+` / `-` 起首的增删行底色 MUST 覆盖该行文本的完整宽度，与卡片可视宽度无关：行文本超出可视宽度（容器出现横向滚动）时，底色 MUST 随文本延伸至整行末尾，MUST NOT 在可视宽度处截断。该不变量对任意行内容长度与任意面板宽度恒成立（渲染缺陷合同先行，条款引用输入分布而非具体案例）。

批准项被采纳或拒绝后，卡片 MUST 收敛为一行终态记录：工具名 + 决策结果（已采纳 / 已拒绝）+ 决策的相对时间戳。diff / argv 预览 MUST 默认折叠，可经单一入口展开回看；待决语义副句（写类「批准后才会落盘」）、判定依据行与决策按钮 MUST 随决策退场，MUST NOT 以置灰形态残留在终态记录里（置灰按钮会被误读为「待处理 / 等待中」）。拒绝时若附了原因，原因文本 MUST 在终态记录中直接可见（无需展开详情）。`cli_run` 批准卡 SHALL 在命令上方显眼位置展示模型自述的 `purpose` 用途句，命令原文完整可见、MUST NOT 被用途句替代或截断；purpose 是阅读辅助而非安全判据，权限判定 MUST NOT 参考 purpose。

批准卡 SHALL 在待决问句下方展示一行**判定依据**，说明这次调用**为什么进闸**（人话一行，随卡片出现）。判定依据 SHALL 由后端判定管线产出并随批准请求事件与 `harness_state` 快照两条通道同源到达前端，前端 MUST NOT 自行推导层级；依据 SHALL 覆盖产批准卡的两层，并如实区分：**危险黑名单**命中（shell 包装器类点名包装器命令名并说明其内容不可知；其余危险命令类说明命中安全黑名单）与**模式默认分层**（带当时判定的档位名与该档释义）。判定依据 MISSING（旧后端 / 旧快照载荷）时该行 SHALL NOT 渲染，MUST NOT 以猜测或默认文案填充。该行 SHALL 随界面语言重取文案，MUST NOT 残留旧语言串。

#### Scenario: diff 行高亮覆盖整行文本

- **WHEN** 面板呈现含超出可视宽度的增删行的 diff 预览（任意行长度 × 任意面板宽度）
- **THEN** 每个增删行元素的宽度 ≥ 该行文本的完整宽度，底色铺满整行、横向滚动区外无未高亮文本

#### Scenario: 采纳后收敛为终态记录

- **WHEN** Alex 对带 diff 预览的批准项点击采纳
- **THEN** 卡片收敛为一行记录（工具名 + 已采纳 + 相对时间戳）；diff 默认折叠、展开后可回看；待决标题、判定依据行与决策按钮退场，界面不再出现置灰的采纳 / 拒绝钮

#### Scenario: 拒绝附原因可见

- **WHEN** Alex 填写拒绝原因并点击拒绝
- **THEN** 终态记录直接显示原因文本（不依赖展开详情）；diff 默认折叠、可展开回看

#### Scenario: 用途句在命令上方呈现

- **WHEN** 一个带 `purpose` 的 `cli_run` 写命令进入批准闸
- **THEN** 批准卡命令上方显眼位置显示 purpose 用途句，命令原文完整可见；purpose 不参与判定（判定结果与同命令不带 purpose 时一致）

#### Scenario: 危险黑名单进闸时的判定依据

- **WHEN** 模型在任意档（含 `full_access`）调用 shell 包装器命令（如 `cli_run("zsh", ["-lc", "…"])`）
- **THEN** 批准卡的判定依据行说明这是 shell 包装器命令、点出包装器命令名、并说明内容不可知因而任何权限档都需逐个确认

#### Scenario: 模式默认分层进闸时的判定依据

- **WHEN** 默认 `vault_write` 档下模型调用库外写命令（如 `cli_run("npm", ["install"])`）进入批准闸
- **THEN** 批准卡的判定依据行带出当时档位（`保险库写入` / `Vault Write`）与该档释义（库内写自动放行、库外命令先问），使「已是 Write 档为何还问」在卡上自洽可读

#### Scenario: 判定依据随决策退场

- **WHEN** Alex 对带判定依据行的批准项点击采纳或拒绝
- **THEN** 终态记录里不出现判定依据行（与待决副句、决策按钮一同退场），界面零残留

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

`config.json` SHALL 支持 `[harness]` 节：`provider`（闭集合 `kimi` / `deepseek` / `mock`）、`providers` 表（各 provider 的 `api_key` / `model` / 可选 `base_url` / 可选 `wire_api`——闭集合 `responses` / `chat_completions`，缺省 `responses`；v1 仅 kimi 实现 chat 档，其余 provider 配置 chat 档 SHALL 回落 `responses` 并给 warning；mock 为 `fixture` 路径）、`permissions`（`allow` / `deny` 规则表）、`permission_mode`（闭集合 `read_only` / `vault_write` / `full_access`，默认 `vault_write`）、`loop_max`、`warn_ctx_pct`。校验 SHALL 沿用既有模板：缺字段回落默认不告警；闭集合取值非法回落默认 + 人话 warning；类型不符整文件回落（ADR 0002 §5）。运行期写回 SHALL 经泛化的 `config_set_value(section, key, value)`，`ui` 表既有行为不变。

#### Scenario: 非法 provider 回落

- **WHEN** 配置里 `provider` 为闭集合外的值
- **THEN** 启动不失败，provider 回落默认并产生一条人话 warning

#### Scenario: 非法 permission_mode 回落

- **WHEN** 配置里 `permission_mode` 为闭集合外的值（或类型不符）
- **THEN** 启动不失败，模式回落 `vault_write` 并产生一条人话 warning（类型不符时整文件回落）

#### Scenario: 非法 wire_api 回落

- **WHEN** 某 provider 的 `wire_api` 为闭集合外的值
- **THEN** 启动不失败，该 provider 的方言回落 `responses` 并产生一条人话 warning；deepseek 配置 `chat_completions` 同样回落并告警（v1 未实现其 chat 档）

#### Scenario: 切换写回持久化

- **WHEN** 在面板权限 chip 把模式从 `vault_write` 切到 `read_only`
- **THEN** 下一个判定按 `read_only` 执行；`config.json` 的 `[harness].permission_mode` 被写回为 `read_only`，重启后保持

### Requirement: 会话边界

会话 SHALL 绑定 vault：内存态一个 vault 一个活跃会话（`RuntimeInner.sessions` 按 vault 键控、resume 铸新 id 替换槽位）；盘上按 vault 分目录并存多份历史会话 JSONL 留存，浮层可切换 / 新建 / 恢复（M433）。切 vault SHALL 切到该 vault 的会话，切回时恢复；关闭 vault 丢弃其会话；app 重启清空全部会话。每个逻辑会话 SHALL 有稳定 session id（`s<unix_millis>-<6 位随机>`，落 JSONL 文件名与 `session_open`）；会话建立、「新会话」重置、自动压缩、从历史会话恢复，四者 SHALL 各开一个 JSONL 文件，旧文件封闭不再追加（压缩前历史完整留存在旧文件，压缩摘要随新文件 `session_open` 留存；恢复新文件以 `opened_from=restore` + `restored_from` 标记源会话）。标题栏 harness 段 SHALL 提供「新会话」动作（面板在场时）：清空当前 vault 会话的消息历史并重新装配系统上下文（AGENTS.md / Skill 索引不变），旧会话 JSONL 文件不受影响。harness 段 SHALL 显示会话名——取首条用户消息截断（约 20 字），未发消息时显示「新会话」。探针期 SHALL 提供**最小恢复入口**：标题栏 harness 段的会话浮层 SHALL 列出本 vault 的历史会话（极简选择器，按时间序、会话名取该会话首条用户消息截断约 20 字；仅本 vault，只列不管理），选中一项 SHALL 从该会话 JSONL 重建会话并续写新会话文件——恢复 = 读文件最后一条 `llm_request` 的完整请求体，并折叠其后未入请求的末尾响应（算法见 design §6.2），system 与 input 原样灌回（**不重新装配**系统上下文）、不跨 provider 重写回放项。探针期 SHALL NOT 提供完整多会话管理 UI（会话重命名 / 搜索 / 分组等）与历史回看列表的完整形态；会话浮层每行已提供**单条删除**入口（行内两步确认、活跃会话拒删，M406 面板批次落地），它不属上述「完整管理 UI」。

#### Scenario: 切 vault 切会话

- **WHEN** 在 vault A 有进行中的会话，切到 vault B 再切回
- **THEN** B 呈现其自身会话（或空会话），工具与上下文注入均解析到 B；切回 A 时 A 的会话原样恢复

#### Scenario: 新会话重置

- **WHEN** 在一段关于旧话题的对话后点击标题栏 harness 段的「新会话」
- **THEN** 消息历史清空、系统上下文重新装配，随后提问不受旧话题影响；旧会话 JSONL 文件完整保留且不再追加

#### Scenario: 新会话动作的幂等性

- **WHEN** 在任意会话状态（含尚无会话——首条提问未发出）下触发「新会话」，或连续触发多次
- **THEN** 每次调用均成功，结果恒为新空会话；尚无会话时为平凡成功（不报错——「没有会话」正是目标状态）

#### Scenario: 处理中触发新会话

- **WHEN** 一轮对话正在处理中（busy）时触发「新会话」
- **THEN** 返回「对话正在处理中」错误信封，在途会话不丢失、不产生副作用；待本轮结束或停止后可再次触发

#### Scenario: 压缩开新文件

- **WHEN** 自动压缩触发、开新逻辑会话
- **THEN** 新逻辑会话落新 session id 的新 JSONL 文件，其 `session_open` 携带压缩摘要；压缩前历史在旧 JSONL 文件中完整留存且不再追加

#### Scenario: 历史会话列举

- **WHEN** 打开标题栏 harness 段的会话浮层
- **THEN** 列出本 vault 的历史会话（极简选择器，按时间序、会话名取该会话首条用户消息截断约 20 字），不列其他 vault 的会话；「新建会话」动作是 harness 段段首的 ＋ 钮、不在浮层内（浮层只剩历史行，M406 起；空清单时浮层整层不开）

#### Scenario: 从历史会话恢复续聊

- **WHEN** 在会话浮层选择一个历史会话
- **THEN** 该会话的 system 与 input（最后一条 `llm_request` 的完整请求体，并折叠其后未入请求的末尾响应，算法见 design §6.2）原样灌回内存态、不重新装配系统上下文；开新 JSONL 文件（首行 `session_open` 标 `opened_from=restore`、`restored_from`=源会话 id），旧文件封闭；其后提问按恢复的历史续写；读数随留存重算灌回新会话（控制行显示源会话最近一次真实读数），并以读数种子（`usage` + `cache_totals`）落进新文件首行，供链式恢复起算

### Requirement: 会话本地留存

会话 SHALL 以 wire/input 形态落配置目录（MUST NOT 写入 vault），作为 ADR 0007 双向记录机制的一侧：每会话一个 append-only JSONL 文件（`<config_dir>/harness/sessions/<vault 稳定 id>/<session_id>.jsonl`），文件首行 SHALL 为 `session_open` 记录——含 session id、vault 根路径、provider / 模型 / 思考档位 / **wire 方言（`wire_api`，缺省值同样在场）**、**完整装配后 system prompt 全文**与装配清单（每个来源的路径、存在与否、字节数；不存在的来源 SHALL 同样在场）、**读数种子**（M526：恢复 / 压缩开文件时在场——`usage` 读数快照 + `cache_totals` 累计四元组；链式恢复从这里起算，全新会话不落这两键）。`<vault 稳定 id>` SHALL 是 vault 注册表 id（与 `vault-sessions/<id>.json`、`reading-positions/<id>.json` 同一份身份），MUST NOT 用 vault 路径派生的消毒名（消毒名有撞名面且无长度 / 字符集保证，M309 现场）。每次发给模型的请求（含工具循环的每次迭代与压缩调用）SHALL 落一条 `llm_request` 记录（完整请求体：system + messages + 参数，**另带本次实际发送体的字节数 `request_bytes`**——按 wire 展开后的尺寸算，省掉「按字节比外推请求多大」；不具备真实 HTTP body 的 mock 档省略该键），每次响应 SHALL 落一条 `llm_response` 记录（正文 / 思考归一回放项与展示文本 / 工具调用 / usage（SHALL 含 input / cached / output 与**缓存写入 `cache_write_tokens`**——provider 不提供时按 0 记录）/ 错误；思考 MUST 落盘——**回放项归一回放形状**（`{"type":"reasoning", summary, [content], [encrypted_content]}`：kimi 的明文载体是 `summary`、deepseek 的是 `content`，各按在场项保留；`encrypted_content` 有则在场），`id` 字段 MUST NOT 进入回放项（`store:false` 下重放 `rs_*` id 属非标用法），展示文本另存）；请求侧在 **Responses 方言**且模型声明支持思考档位时（判据 `HarnessConfig::effort_supported`，读配置 schema 的 per-model `effort` 声明）SHALL 带 `include:["reasoning.encrypted_content"]`（store:false 官方回放模式的前提——让服务端在 reasoning item 里回传密文，重放时无需 id 即可还原）；未声明 effort 的模型（含 deepseek 现役形态）MUST NOT 发该字段；**Chat Completions 方言 MUST NOT 发 `include` / `store`**，其 wire 形态与思考回放字段见「Chat Completions 方言」条；wire 不可推导的决策与事件（批准 / 拒绝、停止中断、LLM 错误、循环上限）SHALL 以 sidecar 记录留存——其中 **LLM 错误的 sidecar 记录 SHALL 另带 HTTP 面诊断**（非 2xx 时的 HTTP 状态码、原始响应 body——按固定上限截断防巨型 body 撑爆留存、服务端 request id 若响应头或 body 提供；不具备 HTTP 面的错误省略这些键），且**错误事件的既有形态（`type`/`code`/`message`）不变**（新诊断只进留存，不破坏既有消费方），被 wire 覆盖或失去意义的 11 类事件 kind（`user_message` / `assistant_text` / `tool_call` / `tool_result` / `usage` / `tool_denied` / `compact` / `session_reset` / `approval_overwritten` / `approval_withdrawn` / `turn_abort_requested`）SHALL NOT 再记（重复记录即第二事实源）。记录点 SHALL 与发送点同点，MUST NOT 经二次序列化产生第二事实源。验收口径 SHALL 为恢复充分性：仅凭 JSONL 能逐字节重建任意一轮发给模型的请求——wire 体由留存 + 代码版本 + `wire_api` 方言共同推导，`session_open` 的方言键是推导依据之一。

会话文件的 vault 归属 SHALL 仍以首行 `session_open.vault_root` 为**唯一**判据：列举、恢复、删除三处的归属过滤口径不变，目录只作组织维度，MUST NOT 成为归属判据的第二真源（文件被手工挪动 / 拷贝不改变其归属结论）。目录名 SHALL NOT 与保留目录名 `_orphaned` 相同。`sessions/<vault 稳定 id>/<session_id>.jsonl` SHALL 是**唯一布局**：新建会话 SHALL 只落其 vault 的目录，列举 / 恢复 / 删除 SHALL 只读该目录；产品运行时 MUST NOT 含任何迁移逻辑（无启动迁移入口、无旧布局读取路径），也 MUST NOT 读平铺在 `sessions/` 根下的 `*.jsonl`——MUST NOT 保留平铺布局的双读 / 双写过渡层（本仓无外部消费者，兼容层保护对象的举证责任在建层一方；REVIEW.md「消费者是谁」）。存量平铺文件（升级前遗留）的归位 SHALL 由**仓内一次性脚本**（`scripts/` 下，手动执行一次即弃，不进产品运行时）完成：脚本按各文件首行 `session_open.vault_root`（先规范化再查注册表）移入对应 vault 目录，`vault_root` 不可解析 / 在注册表里找不到 / 目标位置已有同名文件的 SHALL 移入保留目录 `sessions/_orphaned/`，MUST NOT 删除或改写任何文件，且 MUST be 幂等（重复执行零搬运）；脚本遇单文件失败时留原地并自报，重跑脚本收敛。上一代「按 vault 聚合的业务事件流水」形态（`<config_dir>/harness/<消毒名>.jsonl`）照旧不再续写、不做迁移（运行时 / 产品侧零读者，验收套件的 JSONL 断言随实现迁移至 wire 口径；M309 孤儿先例）。写失败不阻断对话的既有纪律不变。

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

- **WHEN** mock provider 跑完一轮含工具循环的对话（消息含 `<quote>` 块、响应含思考文本）
- **THEN** 仅凭 JSONL 独立重建的每个请求与落盘 `llm_request` 深度相等（逐字节重建判据）；第 i 条响应的正文 / 思考 / 工具调用与第 i+1 条请求的历史对应项逐字节一致

#### Scenario: 思考落盘与回放

- **WHEN** 一轮响应含 reasoning 文本，其后一轮把上一轮响应的 reasoning 项带回历史
- **THEN** `llm_response` 记录思考——回放项（**归一形状**：剥掉 `id`、`MUST NOT` 含 `id`；保 `summary` / `content` / `encrypted_content`）与展示文本（给人看）分别在 `reasoning` / `thinking` 字段；后续请求的历史中该归一后的 reasoning 回放项逐字节在场，且 Responses 方言请求体在模型声明支持思考档位时带 `include:["reasoning.encrypted_content"]`（chat 方言不带该字段，其回放形态见「Chat Completions 方言」条）；恢复旧会话（记录早于本改动、reasoning 项仍带 `rs_*` id）时，重建的 input 同样不含 `id`

#### Scenario: 缓存写入随 usage 落盘

- **WHEN** provider 的响应 usage 带回 `cache_write_tokens`，完成一轮对话
- **THEN** 对应 `llm_response` 记录的 `usage` 块含 `cache_write_tokens` 原值；provider 不提供该字段时记为 0

### Requirement: mock provider

`provider = "mock"` 时 SHALL 从配置指向的 fixture 文件读取脚本化响应（含工具调用序列与 usage 数值），确定性驱动工具循环——真机验收 MUST NOT 依赖真实外部 API。

#### Scenario: 确定性验收

- **WHEN** 验收场景以 mock provider 配置启动 app 并发送提问
- **THEN** 工具循环严格按 fixture 脚本推进，断言可复现

### Requirement: 摘录引用卡片

系统 SHALL 提供摘录创建手势：在编辑器 pane 中选中片段后出现浮动「摘录到对话」钮，点击把该片段作为 block 级引用卡片加入对话输入区；harness 面板未打开时 SHALL 先打开面板再入卡片。**钮的出现时机 SHALL 是「选区完成后」**：鼠标拖拽选区在松开（mouseup）前 MUST NOT 出现，键盘建立的选区在选区稳定（停止变化约 350ms）后才出现，选区清空或移出编辑器即消失。**落点 SHALL 就近取选区末端（光标侧）附近**，且钮整体 MUST 钳制在触发面板可视区内（M531 不变量）。每张卡片 SHALL 呈现：引号竖条、摘录原文截断（至多两行）、出处行（文档名 · 最近一级标题；摘录在文档首个标题之前时仅显示文档名）、（输入区内）移除钮；hover SHALL 显示完整摘录与完整标题链。卡片数据 SHALL 携带：vault 相对路径 file、最近一级标题 heading、行范围 lines（从选区捕获，MUST 非空，取不到行范围时 MUST NOT 生成卡片）、摘录原文。点击卡片 SHALL 跳回原文位置并瞬态高亮。编辑器侧 SHALL NOT 出现任何常驻的摘录相关装饰——只存在两种瞬态：存在的选区（含浮动钮）、跳回高亮。摘录来源 SHALL 为「最近活跃编辑器 pane」的选区（ADR 0008 Decision 3 语义），harness 面板持焦 MUST NOT 改变该归属。

#### Scenario: 选区创建卡片

- **WHEN** 在编辑器 pane 中选中一段文字并点击浮动「摘录到对话」钮
- **THEN** 对话输入区出现一张引用卡片（竖条 + 至多两行摘录 + 出处行）；卡片数据含该文件的相对路径、最近一级标题、选区行范围与摘录原文；编辑器侧无任何常驻装饰残留

#### Scenario: 点击卡片跳回高亮

- **WHEN** 点击输入区或已发送消息中的引用卡片
- **THEN** 对应编辑器 pane 定位到摘录原文位置并瞬态高亮（约 1.4s 消退）

### Requirement: 混排对话输入区

对话输入区 SHALL 为混排编辑区且是全 composer 的唯一形态（无卡片时退化为纯文本输入，不存在两种输入框并存）：
引用卡片、消息摘录卡片与**图片卡片**（本 change 新增）都是原子 block 节点（删除/选择按整体作用），问题文字在
卡片之间的段落中，各类卡片与段落可任意交错。「摘录到对话」 SHALL 在光标处插入卡片——光标落在段落中间时 SHALL
把该段落从光标处拆为两段、卡片插入中间；**插入后光标 SHALL 落到卡片下一行的问题段落**（该处已有空段落则复用、
否则新建）。卡片 SHALL 可经移除钮移除（图片卡片的移除钮语义与引用卡片一致）。粘贴进输入区的内容 SHALL 按
剪贴板内容分派：剪贴板含 `image/*` 数据时 SHALL 走「图片粘贴卡片」（图优先，不净化）；其余内容 SHALL 净化为
纯文本。已发送的用户消息 SHALL 同构呈现（卡片与问题段落上下交替，卡片无移除钮）。光标位 SHALL 覆盖段落内的
字符偏移与卡片的前缘（含相邻两张卡片之间的边界位），且这些位置 SHALL 可由键盘导航一族到达与互相移动
（见「composer 的 Emacs 文本导航族」条）；仅移动光标 MUST NOT 改变块序列。卡片与卡片之间、卡片与段落之间
SHALL 同样存在可编辑的光标位（相邻两张卡片之间无段落时亦然，见「原子块边界光标位」）；在任一此类位置上输入
内容 SHALL 物化一个承接它的问题段落（见「边界光标位上的内容输入物化段落」）。

#### Scenario: 卡片与问题交错

- **WHEN** 输入区已有「卡片1 + 问题1」，用户在问题1 之后继续摘录或贴入一张图片并输入问题2
- **THEN** 输入区呈现 卡片1 / 问题1 / 卡片2 / 问题2 上下交替（卡片2 可以是引用卡片、消息摘录卡片或图片卡片）；
  光标可在任意卡片前后继续输入；**两张卡片相邻（中间没有段落）时，两卡之间的边界位同样可由键盘导航到达并
  就地输入**

#### Scenario: 光标处拆段插入

- **WHEN** 光标落在某问题段落中间时触发「摘录到对话」或贴入一张图片
- **THEN** 该段落从光标处拆为两段，新卡片插入两段之间，光标落到新卡片下一行的问题段落（无则新建），可直接
  继续输入问题

#### Scenario: 相邻卡片之间就地输入

- **WHEN** 输入区有两张相邻的卡片（两者之间无段落），用户把光标移进它们之间并输入问题文字
- **THEN** 两张卡片之间出现该文字所在的问题段落，卡片次序与内容不变；随后该消息按既有序列化协议投递
  （卡片按块序产出各自的元素，问题段落落在两者之间）

#### Scenario: 发送后同构沉淀

- **WHEN** 携带两张卡片与两段问题的消息发送完成
- **THEN** transcript 中该用户消息按相同交错顺序呈现卡片与问题段落，卡片无移除钮且可点击跳回（图片卡片无跳回、
  只呈现缩略图）

#### Scenario: 粘贴按剪贴板内容分派

- **WHEN** 在输入区粘贴纯文本，或粘贴剪贴板里的图片
- **THEN** 纯文本走既有净化（多行拆成多个段落块）；图片走「图片粘贴卡片」落 harness 侧并插入图片卡片——
  两者互不串台

### Requirement: 混排输入区的撤销栈聚簇与结构操作独立成步

混排输入区 SHALL 自管撤销栈（原生 undo 对 DOM 干预不可靠，`⌘Z` / `⌘⇧Z` / `⌘Y` 走就地路径）；
栈内每一步 SHALL 是一个「修改前态」快照。窗口期内的**连续键入** SHALL 聚合成一个撤销步；
**结构性操作** SHALL 强制独立成步（跳过聚簇），MUST NOT 与相邻键入或另一结构性操作共用一个前态。
结构性操作 SHALL 至少含：原子卡片（引用 / 消息摘录 / 图片）的插入与移除、粘贴（含图片粘贴卡片）、
`@` 提及插入、拆段（`⇧Enter` 软断行）、边界光标位上的物化键入与 IME 组合物化，以及**删除族**
（`⌃D` / `⌃H` 与裸 `Backspace` / `Delete` 的删字符、删选区、删卡片）。删除族与 kill 族
（`⌥D` / `⌥⌫` / `⌃K`）的**选区档**（有选区时先删选区）、以及 kill-yank 族的就地档与 `⌃Y` SHALL 同为
结构性操作。栈顶同态去重 SHALL 让 no-op 不产生幽灵撤销步。结构性操作的各入口 SHALL 共用同一份
force 判定（单一真源），MUST NOT 各写一处字面量。

**三处豁免（MUST NOT 被读成结构性操作）**：① 键入本身（原生文本编辑的压栈）；② 字符级编辑
（`⌃T` 转置——属打字流）；③ 删除族的**空转**（段首退格 / 前向删除到末缘——不是编辑，压栈只会造出
「撤销了看不出变化」的幽灵步）。三者走聚簇或直接不产生撤销步。

这条不变量 M343 引入撤销栈时只落在实现注释里（`withModel` 的「force=true 用于结构性操作」），
living spec 缺条款；M447/M453 的 `deleteAtCaret` 与裸 `Backspace`/`Delete` 分支、以及 `⇧Enter`
软断行因此各写成 force=false 而无人可对账（M510 补条款并逐处修准）。

#### Scenario: 结构操作之后的删除仍能单独撤销

- **WHEN** 在输入区贴入一张卡片（结构性操作，压入「贴图前的空态」前态），并在聚簇窗口内按 `⌃H`
  （或裸 `Backspace` / `⌃D` / `Delete`）把该卡片删掉
- **THEN** 删除这一步 SHALL 独立压入「贴图后、删卡前」的前态；紧随的 `⌘Z` SHALL 恢复该卡片，
  MUST NOT 跳过删除直接弹回贴图前的空输入区

#### Scenario: 结构操作之后的选区 kill 仍能单独撤销

- **WHEN** 在输入区贴入一张卡片（结构性操作），光标处已有跨该卡片的选区，并在聚簇窗口内按 `⌥D` /
  `⌥⌫`（`killWordAtCaret`）或 `⌃K`（`killLineAtCaretCommand`）走选区删除档
- **THEN** 这一步 SHALL 独立压入「贴图后、删选区前」的前态；紧随的 `⌘Z` SHALL 恢复该卡片，
  MUST NOT 弹回贴图前的空输入区

#### Scenario: 结构操作之后的拆段仍能单独撤销

- **WHEN** 在输入区贴入一张卡片（结构性操作，光标落在卡片下一行的问题段落），并在聚簇窗口内按
  `⇧Enter` 拆段
- **THEN** 拆段这一步 SHALL 独立压入「贴图后、拆段前」的前态；紧随的 `⌘Z` SHALL 只撤销拆段
  （恢复卡片与问题段落），MUST NOT 把结构操作（贴图）一起弹没

#### Scenario: 连续键入聚合成一步

- **WHEN** 用户在聚簇窗口内于同一段落连续键入多个字符（无结构性操作夹入）
- **THEN** 这些键入 SHALL 聚合成一个撤销步：一次 `⌘Z` 回到该串键入之前的状态，MUST NOT 逐字符各成一步

### Requirement: 引用消息序列化协议

发送消息时，系统 SHALL 把混排输入区序列化为 XML 结构投递给模型：每段摘录一行 `<quote file="…" heading="…" lines="A-B">摘录原文</quote>`，问题文字 SHALL 按交错顺序排布在标签之间（卡片阅读顺序 = 序列化顺序）；`lines` MUST 非空；`heading` SHALL 与卡片出处行显示的最近一级标题一致；属性值与文本节点 MUST 做 XML 转义。序列化结构 SHALL NOT 包含**卡片编号**——`<quote>` / `<msg-quote>` 元素 MUST NOT 带任何序号属性（遵循一致性原则：它们的 `file` / `heading` / `lines` / `role` / `at` 属性本身就是身份，投递给模型的上下文要素对人必须也可查，编号对人无区分价值故不进协议）。**图片块是该禁令的唯一例外**：图片在 wire 上没有文本身份（`input_image` part 只承载字节），编号是模型指代单张图的唯一把手，故图片块按「图片编号与引用」携带 `Image N` 标签与编号。UI SHALL NOT 对引用卡片与消息摘录卡片显示编号；图片卡片 SHALL 按「图片编号与引用」显示编号。agent 回复 SHALL 按摘录内容/出处回指，同文档多段相似摘录时用出处（标题 / 行范围）消歧。序列化后的完整消息（含 `<quote>` 块）SHALL 以 wire 形态留存：在对应 `llm_request` 记录的 messages 数组中逐字节在场，经请求体重建即得。

#### Scenario: 序列化结构

- **WHEN** 发送一条「卡片1 + 问题1 + 卡片2 + 问题2」交错的消息
- **THEN** 模型收到的消息中两段摘录各为一个 `<quote>` 元素（file / heading / lines 三属性齐全、lines 非空、无编号属性），问题1 位于第一个 `</quote>` 之后、问题2 位于第二个 `</quote>` 之后

#### Scenario: 转义

- **WHEN** 摘录原文或出处含 `<`、`&`、`"` 等字符
- **THEN** 序列化输出中对应位置为 XML 转义形式，解析后还原为原文

#### Scenario: UI 与协议无编号

- **WHEN** 输入区或 transcript 呈现引用卡片 / 消息摘录卡片，或 agent 回复引用某段摘录
- **THEN** 界面任何位置与投递给模型的消息中均不出现这些卡片的编号（无 `#N` / 序号属性）——本禁令的
  作用面是引用卡片与消息摘录卡片，图片卡片的编号与标签不在其内（见「图片编号与引用」）；agent 回复按
  摘录内容/出处回指（如「『倒序阅读』那段」）

#### Scenario: 图片块的编号例外

- **WHEN** 发送一条同时含引用卡片与图片卡片的交错消息
- **THEN** 模型中该消息里的 `<quote>` 元素保持无编号属性，而图片块前带 `Image N` 标签、其 N 与该图片
  卡片徽标一致

#### Scenario: 留存逐字节在场

- **WHEN** 一轮携带引用卡片的消息发出并落盘
- **THEN** 对应 `llm_request` 的 messages 中含 `<quote>` 块的完整序列化消息，逐字节等于发送前的序列化产物

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

composer 控制行 SHALL 提供模型选择 chip：列出 `[harness].providers` 已配置的 provider（闭集合 `kimi` / `deepseek` / `mock`），选择即切换当前 provider 并经运行期写回通道持久化（`config_set_value` 泛化口径，与 `[ui]` 写回同路）；切换对下一轮生效，MUST NOT 打断进行中的轮次。chip 文本过长 SHALL 截断（ellipsis），完整名称在 hover 呈现。配置缺失或非法时 chip SHALL 回落到默认 provider 且不报错（沿用 `[harness]` 配置节的回落纪律）。

#### Scenario: 切换 provider 并写回

- **WHEN** 配置里 `kimi` 与 `deepseek` 两个 provider 均已配置，在控制行模型 chip 里从 `kimi` 切到 `deepseek`
- **THEN** 下一轮对话走 `deepseek`；`config.json` 的 `[harness].provider` 被写回为新值，重启后保持

#### Scenario: 进行中的轮次不受影响

- **WHEN** 一轮对话正在流式输出时切换模型 chip
- **THEN** 当前轮次按原 provider 跑完；切换自下一轮生效

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

#### Scenario: 进行中呈现不定态与阶段

- **WHEN** 一轮对话进入工具循环（如先读文件再搜索）
- **THEN** 面板显示不定态进度条与当前阶段行；任何时刻不出现百分比读数

#### Scenario: 完成即折叠

- **WHEN** 某个工具调用完成
- **THEN** 该调用在 transcript 中折叠为一行摘要（工具名 + 结果概要），过程细节不再占位

### Requirement: 消息呈现

transcript 中的用户与 agent 消息 SHALL 带角色 + 时间读数 meta 行（如「你 · 12 秒前 / Agent · 刚刚」）：角色名与时间读数同行，视觉上降档于消息正文（micro 字号、三级文字色）。用户消息 SHALL 以描边气泡呈现（内容底色 + 柔和边框 + 圆角），正文色降一档以区分于 agent 消息；agent 消息 SHALL 平铺排版（无气泡）。读数形态 SHALL 按数据来源分两档：**live**（本轮上屏打戳的消息）按「刚刚 / N 秒前 / N 分钟前 / N 小时前 / 昨天」分档；**restored**（快照恢复与会话恢复重放的消息，时间读数来自留存）按「同日窄相对 / 跨天短日期」呈现——留存在盘上，读数可以跨天甚至跨周，「昨天」对更老的消息是错读数。两档 SHALL 随时间低频刷新与随语言切换重绘（形态随消息携带、重绘不重算）。快照 / 恢复重建的消息 SHALL 以后端时间戳（`PanelMessage.ts`）显示真实读数；**会话恢复的 ts SHALL 来自留存记录的信封**（wire 项自身不带时间戳，按项在记录序里的产出时刻归属，见 design §3）；无时间戳可归的消息 SHALL 只显示角色、SHALL NOT 伪造读数。快照消息面 SHALL 保真：正文为空的 assistant 轮（模型只发工具调用、无正文）MUST NOT 落成面板记录——快照恢复 MUST NOT 出现只有角色 meta 行、正文为空的「空气泡」；工具记录（`role: tool`）SHALL 持久化摘要（`PanelMessage.summary`），成功为调用参数摘要、失败含细分状态与错误码，使 webview 重载后工具行仍有信息；成功侧的参数摘要是**单行**人话文本，`cli_run` 为「命令 + 参数」拼接且**命令本体恒在最前**（参数 JSON 原样截断时，排在命令之前的 `args` 会把它挤出可见头部，工具行只剩一串参数），含空白或引号的参数 SHALL 加引号使参数边界可辨。同一份摘要 SHALL 是 live 事件、面板持久化与恢复重建三条路径的同一份（MUST NOT 各算各的）；恢复路径读到旧快照的参数 JSON 时 SHALL 按同一形态人话化呈现。

#### Scenario: 新消息带 meta 行

- **WHEN** 发送一条提问并收到 agent 回答
- **THEN** 两条消息都带角色 + 时间读数 meta 行（用户消息在描边气泡内，agent 消息平铺）；读数初始落在「刚刚 / N 秒前」档

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

transcript 中的错误行 SHALL 同文案去重：新错误的文案与当前最后一条错误行逐字相同时 SHALL 就地替换该条（更新原行并滚到可见），SHALL NOT 追加堆叠；不同文案的错误照常追加。

#### Scenario: 同一错误不堆叠

- **WHEN** 同一原因的错误连续发生多次（如后端尚未就绪时反复触发同一失败）
- **THEN** transcript 中该文案的错误行始终只有一条，不发生追加堆叠

### Requirement: 浮层可访问性

harness 的浮层（模型 chip 的 provider 浮层、标题栏 harness 段的会话浮层）SHALL 对辅助技术可达：浮层 MUST NOT 嵌在 `<button>` 元素内（WKWebView 将嵌套按钮当叶子、不暴露其内容）；浮层 SHALL 以 `role="menu"` 及菜单项角色（provider 项 `menuitemradio` + `aria-checked`）呈现，触发钮 SHALL 带 `aria-haspopup="menu"` 与随开合翻转的 `aria-expanded`。浮层打开时 Escape SHALL 先收浮层，无浮层打开时 Escape 才收面板。

#### Scenario: 浮层项读屏可达

- **WHEN** 打开模型 chip 的 provider 浮层或会话名浮层
- **THEN** 浮层项在 WKWebView 的 AX 树中逐个暴露（可经辅助技术定位并激活）

#### Scenario: Escape 分层

- **WHEN** 任一浮层打开时按 Escape
- **THEN** 只收起浮层，面板保持打开；浮层全关时再按 Escape 才收起面板

### Requirement: 工具调用呈现

工具调用 SHALL 以步骤清单形态呈现于当前 agent 消息内（hairline 夹区、独立于消息正文）：运行中的调用 SHALL 显示运行中行（脉冲指示 + 调用名），完成的调用 SHALL 翻为完成行（✓ 图标 + 结果摘要）；同一轮次的多次调用 SHALL 累积为有序多行清单。轮次结束后，含两行及以上的清单 SHALL 折叠为一行摘要（「N 个工具调用 · 全部完成」），摘要 SHALL 可点击展开回看全部步骤行；单行清单 SHALL 保持展开。快照恢复的历史轮次 SHALL 按同口径重建清单与折叠态。

#### Scenario: 进行中清单

- **WHEN** agent 轮次中发生工具调用（started → done）
- **THEN** 当前 agent 消息内出现步骤行：started 时为运行中行（脉冲指示），done 时该行翻为完成行（✓ + 结果摘要）；多次调用按到达次序逐行累积

#### Scenario: 完成后折叠与回看

- **WHEN** 一轮含两次及以上工具调用的轮次结束
- **THEN** 清单折叠为一行摘要（含调用数）；点击摘要展开回看全部步骤行，再点收回

#### Scenario: 单行不折叠

- **WHEN** 一轮只含一次工具调用的轮次结束
- **THEN** 该步骤行保持展开可见，不出现摘要行

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

系统 SHALL 在权限判定前对每次 `cli_run` 调用做命令分类：按命令名白名单与参数形态判定为**只读**（如 `ls` / `cat` / `rg` / `git` 只读子命令族 / 不带 `-i` 的 `sed` / `jq` 等，首版清单以 design §3.1 为准）、**危险**（rm / shutdown·reboot·halt·poweroff / mkfs 系 / dd / `git reset --hard` / `git clean` / shell 包装器类，首版清单以 design §3.3 为准）或**写**（其余一切，含未知命令——保守默认）。shell 包装器命令（`sh` / `bash` / `zsh` / `dash` / `fish` / `csh` / `ksh` / `cmd` / `powershell` / `pwsh` / `osascript` / `eval` / `exec` 等）SHALL 归为危险——内容不可知即视同潜在危险，任何档都逐个问（tower 已裁决，Alex「危险命令任何档都问」分界的推论）。任一参数含 shell 元字符（`|` `;` `&&` `||` `>` `>>` `<` 等）的调用 SHALL 保守归为写。三者均 MUST NOT 按命令名白名单放行。

间接调用包装器（`sudo` / `xargs` / `find` 的 `-exec` / `-execdir` / `-ok` / `-okdir`，2026-10-10 Alex 裁决「堵」）SHALL 递归提取被包装命令、以其分类为本条调用的分类：`sudo rm` 视同 `rm`（危险），`sudo ls` 视同 `ls`（只读，不得误伤）。被包装命令取不出确定形态（裸 `sudo` / `xargs` 无命令 / `-exec` 子句不完整）SHALL 保守归为危险——任何档都逐个问。递归 MUST NOT 展开到包装器名单之外（不做通用 shell 语义解析），且 MUST 先于 shell 元字符保守规则判定（`sudo bash -c "a;b"` 按被包装命令判，不因外层参数带元字符落「写」被 `full_access` 放行）。

分类为写、且写目标解析进 vault 内的 `cli_run` 调用，**任何权限档都 SHALL 直接拒绝**并回送结构化重定向提示：固定错误码（`cli_redirected_to_vault_tool`）+ 固定标记文本包裹的 JSON 载荷（`reason` / `targets` / `suggested_tool` 字段固定），指明应改用哪个 vault 工具（`vault_patch` / `vault_create` / `vault_move` / `vault_delete`）。`suggested_tool` SHALL 按写动词形态映射（`mv`/`cp`→`vault_move`、`rm`→`vault_delete`、`sed -i`/重定向→`vault_patch`、`touch`/新文件→`vault_create`、`mkdir`→`vault_create`）——`mkdir` 的落点是 `vault_create`：建目录不另立工具，`vault_create` SHALL 自动创建缺失的父目录（`mkdir -p` 语义）。目标是否「在 vault 内」的判定不确定时 SHALL NOT 重定向，回落正常写分类。闸门 MUST NOT 自动把 cli_run 改写成 vault 工具调用——重定向只经回送文本由模型自行改道。

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

批准闸 SHALL 提供次级动作「采纳且本会话不再问」：点击后该次调用执行，且 `(工具名, 规范化主体串)` 记入当前会话的批准缓存；同一会话内后续与缓存键精确匹配（同工具、同规范化主体串）的调用 SHALL 直接执行，MUST NOT 重复弹批准闸。点「采纳」本身 MUST NOT 记入缓存。缓存 SHALL 为会话内存态：「新会话」、切 vault 切会话、app 重启即清空；MUST NOT 落盘、MUST NOT 进 JSONL 留存。缓存命中只在模式默认分层生效——deny 规则、vault 内写重定向、危险黑名单三层 MUST 先于缓存判定（缓存不解锁这三层）。

#### Scenario: 显式记忆与精确匹配

- **WHEN** Alex 对 `cli_run("npm", ["run", "test"])` 点「采纳且本会话不再问」，随后模型调用 `cli_run("npm", ["run", "test"])`
- **THEN** 第二次直接执行；随后模型调用 `cli_run("npm", ["run", "build"])`（不同主体串）仍弹批准闸

#### Scenario: 黑名单不受缓存影响

- **WHEN** 缓存中已有某主体串，模型以相同主体串调用命中危险黑名单的命令
- **THEN** 仍进入批准闸，MUST NOT 因缓存自动放行

### Requirement: 权限模式切换

composer 控制行 SHALL 提供权限 chip（位于模型 / 思考合并选择器 chip 之后、ctx 读数之前），**显示当前模式档的短名**（文案表 zh：只读 / 可写 / 完全；en：Read / Write / Full）——控制行被合并选择器 chip 与权限 chip 共同挤占，短名是「三档都能完整显示」的口径（Alex 2026-10-09 裁决；zh 短名「写入」于 2026-10-10 批复改为「可写」）。点击 SHALL 弹出浮层：三档单选、当前档勾选、列表项显示**全名**（zh：只读 / 保险库写入 / 完全访问；en：Read Only / Vault Write / Full Access）、且**每档附一行释义**消歧档名与语义（`read_only` = 读自动放行、写操作都先问；`vault_write` = 库内写自动放行、库外命令先问；`full_access` = 全自动、仅危险命令仍问；措辞可在实现批次微调，语义方向以此为准）。chip 的悬停提示与可访问名 SHALL 说明当前档并附上**该档的同一行释义**（与浮层释义同源，不新增信息）。浮层 SHALL 复用既有浮层可访问性口径（`role="menu"` / `menuitemradio` / `aria-checked`）。选择一档 SHALL 立即生效并经 `config_set_value` 写回 `[harness].permission_mode`；切换 MUST NOT 打断进行中的轮次（对下一个判定生效，与模型 chip 同口径）。

#### Scenario: 三档浮层

- **WHEN** 点击权限 chip
- **THEN** 浮层列出三档（各显示全名 + 一行释义）、当前档勾选；选择另一档后 chip 文案（短名）更新、浮层关闭

#### Scenario: 切换不打断进行中轮次

- **WHEN** 一轮对话正在工具循环中，把模式从 `vault_write` 切到 `read_only`
- **THEN** 当前轮次按开轮时的模式判完；从下一个判定起按 `read_only` 执行

#### Scenario: chip 悬停提示带当前档释义

- **WHEN** 指针悬停在权限 chip 上（或读屏取该 chip 的可访问名）
- **THEN** 提示文本包含当前档全名与浮层里的那行释义（如「权限模式：保险库写入（点击切换）· 库内写自动放行；库外命令先问你」），且与浮层同一档的释义逐字相同

### Requirement: cli_run 用途说明（purpose 字段）

`cli_run` 工具的参数 schema SHALL 包含必填字符串字段 `purpose`：模型发起调用时 SHALL 用一句人话说明该命令的用途（Claude Code 的 Bash description 同款——描述是调用的一部分）。purpose 缺失或 trim 后为空白串时，调用 MUST NOT 执行：系统 SHALL 在工具调用入口（判定管线之前）按统一错误信封结构化回送（人话 message 指明需补填用途说明），模型补填后重发。purpose 是模型自述的阅读辅助，MUST NOT 参与权限判定的任何一层（命令分类、vault 写重定向、危险黑名单、allow 规则、模式默认分层均只看 argv 本身）。批准卡 SHALL 在 CLI 命令上方显眼位置展示 purpose，命令原文完整可见、MUST NOT 被 purpose 替代或截断。

#### Scenario: purpose 随调用到达批准卡

- **WHEN** 模型发起带 `purpose: "安装依赖以跑测试"` 的 `cli_run` 写命令（ask 档）
- **THEN** 批准卡命令上方显眼位置显示该用途句；命令原文完整可见；权限判定结果与不带 purpose 的同一命令完全相同

#### Scenario: 空 purpose 拒绝补填

- **WHEN** 模型发起的 `cli_run` 调用缺 `purpose` 字段（或 purpose trim 后为空白串）
- **THEN** 调用不执行，回送指明需补填用途的错误信封；模型补填 purpose 重发后正常进入判定与执行

### Requirement: 图片粘贴卡片

harness 面板输入区（composer）SHALL 支持粘贴剪贴板里的图片：粘贴动作到达且剪贴板含 `image/*` 数据时，
系统 SHALL 拦截该粘贴、把图片落 **harness 侧存储**（`<config_dir>/harness/attachments/<vault 稳定 id>/` 下的
内容寻址文件 `pasted-<内容哈希前 16 位>.<扩展名>`），并在光标处插入 block 级**图片卡片**。`<vault 稳定 id>`
SHALL 是 vault 注册表 id（与会话留存 `sessions/<vault 稳定 id>/` 同一份身份），MUST NOT 用 vault 路径派生的
消毒名；写时取不到合格 id SHALL 拒绝落盘并给人话反馈，MUST NOT 落进任何兜底目录。落盘与转码 SHALL 复用二进制附件
写入的既有口径（`image/png` → WebP 无损转码、`image/jpeg` 与 `image/webp` 原样、其余 `image/*` 子类型拒绝并给
人话反馈；50MB 上限判定在转码之前；分辨率 MUST NOT 降采样）。图片落点 MUST NOT 进 vault——本能力 MUST NOT
新增或改写 vault 内任何文件。剪贴板同时含文本与图片数据时 SHALL 图优先；多图剪贴板 SHALL 只取第一个
`image/*` 项。

图片卡片 SHALL 是 composer 的**原子块**，与既有引用卡片同族：拆段插入、插入后光标落卡片下一行的问题段落、
移除钮（输入区内）、整体选择与删除、发送后在 transcript 同构沉淀（无移除钮）——全部与「混排对话输入区」的
既有卡片语义一致。卡片 SHALL 呈现可见缩略图（字节经读回命令按需取，MUST NOT 把 base64 落进卡片数据、快照或
留存）。快照恢复时图片卡片 SHALL 从留存内容解析还原（与 `<quote>` / `<msg-quote>` 同 round-trip 口径）。
任一步失败（格式不支持、超限、转码/落盘/读回失败）SHALL 给人话 toast，MUST NOT 静默失败、MUST NOT 插入卡片
后留破图、MUST NOT 留半截临时文件。非图片剪贴板的粘贴行为 MUST NOT 被本能力改变。

#### Scenario: 粘贴图片落 harness 侧并插入卡片

- **WHEN** composer 聚焦、剪贴板置一张 png 截图并执行粘贴
- **THEN** 配置目录 `harness/attachments/<vault 稳定 id>/` 下出现 `pasted-<hash16>.webp`（解码像素与剪贴板一致），
  vault 目录零新增或修改；composer 在光标处出现图片卡片（可见缩略图）、可直接继续输入问题

#### Scenario: 图文同板图优先、多图取第一张

- **WHEN** 剪贴板同时含文本与一张图片，或含两张图片
- **THEN** 只产出该剪贴板里第一个 `image/*` 项的图片卡片；夹带的文本 MUST NOT 另行作为纯文本落入输入区

#### Scenario: 非图片粘贴回归

- **WHEN** 剪贴板为纯文本（无 `image/*`）并在 composer 执行粘贴
- **THEN** 行为与本能力存在之前逐字节一致（纯文本净化，多行拆成多个段落块）；`harness/attachments/<vault 稳定 id>/`
  无新增文件

#### Scenario: 失败一律人话出口

- **WHEN** 剪贴板图片的 MIME 子类型未支持、或超过 50MB、或转码/落盘失败
- **THEN** 弹出对应人话 toast；composer 不出现该图片卡片；附件目录无半截临时文件残留

#### Scenario: 发送后同构沉淀与快照恢复

- **WHEN** 携带图片卡片与问题段落的交错消息发送完成，随后重启 app 恢复会话
- **THEN** transcript 中该用户消息按相同交错顺序呈现图片卡片（无移除钮、缩略图可见）；恢复后图片卡片与原文
  交错顺序、附件引用与发送前一致

### Requirement: 图片消息投递协议

发送消息时，系统 SHALL 把混排输入区的块序列投影为 Responses API 的 content parts：文本块 SHALL 按
「引用消息序列化协议」的既有 XML 形态序列化为 `input_text` part，图片块 SHALL 产出 `input_image` part；
`input_text` 与 `input_image` SHALL 按块序交错排布（图片在文本流中的位置 MUST 与 composer 里的交错顺序一致）。
文本 part 的序列化 MUST NOT 包含卡片编号（沿用一致性原则）——该编号禁令的作用面是**引用卡片与
消息摘录卡片**；**图片块是唯一例外**，按「图片编号与引用」携带 `Image N` 标签与编号（图片在 wire 上
没有文本身份，编号是模型指代单张图的唯一把手；change composer-image-mention）。

会话侧（内存 input 项与 JSONL 留存）MUST NOT 内联图片字节：图片在 input 项里 SHALL 以 **harness 附件引用**
形态在场（`image_url` 为 `lumir-attachment://<内容寻址名>`），MUST NOT 出现 base64 data URL。发给 provider 的
wire 请求 SHALL 在**发送前**把引用展开为 `{"type":"input_image","image_url":"data:image/<子类型>;base64,…"}`；
展开失败 SHALL 以人话错误收口，MUST NOT 发出静默缺图的请求。恢复充分性口径随之写实：仅凭 JSONL 的引用 +
内容寻址的 harness 附件**同 id 目录**（`attachments/<vault 稳定 id>/`，引用名即内容哈希，`引用 → 字节` 确定性）
可重建该轮请求。引用 SHALL 按当前会话作用域的 vault id 在本 vault 目录内解析，MUST NOT 跨 vault 查找。历史会话恢复路径
SHALL 从 wire 项的引用还原图片卡片，MUST NOT 伪造、MUST NOT 丢弃。

#### Scenario: content parts 交错顺序

- **WHEN** 发送一条「问题段落 + 图片卡片 + 问题段落」的消息
- **THEN** 该 user 消息的 content 数组按块序为 `input_text` / `input_image` / `input_text`；图片 part 的位置与
  composer 里的交错顺序一致；文本 part 无引用卡片 / 消息摘录卡片的编号（图片块按「图片编号与引用」
  携带 `Image N` 标签）

#### Scenario: 引用进留存、展开进 wire

- **WHEN** 携带图片卡片的消息发出并落盘
- **THEN** 对应 `llm_request` 的 messages 中该 user 项的图片为 `lumir-attachment://<内容寻址名>` 引用，记录里
  **不含 base64**（无 `data:image` 串）；而发给 provider 的请求体里同一位置是 base64 data URL

#### Scenario: 展开失败不静默缺图

- **WHEN** 引用的附件文件缺失或不可读
- **THEN** 本轮以人话错误收口，MUST NOT 发出一份缺该图片的请求、MUST NOT 假装图片已投递

#### Scenario: 恢复还原图片卡片

- **WHEN** 从历史会话恢复（留存里该 user 项的图片是引用形态）
- **THEN** 恢复后的面板消息含对应图片卡片，交错顺序与附件引用与留存一致

### Requirement: 模型图片能力声明

`config.json` 的 `[harness].providers.<id>.models` 逐项声明 SHALL 支持 **`vision`** 布尔键（键名 2026-10-10 由
`image` 改名，避免与 `image_generation` 混淆；与既有的 `effort` / `window` 同一条 config-only 声明链）：
`true` 表示该 provider + 模型接受图片输入；该键缺席 / 模型未列在清单内
SHALL 按**不支持**处理（保守默认，与 `effort` 同侧），SHALL 给一条人话 warning。系统 MUST NOT 内置任何模型的
图片能力——MUST NOT 硬编码、MUST NOT 出厂回落。

当前生效 provider + 模型的图片能力为**不支持**时，含图片卡片的消息 SHALL 在**发送时**被挡下：系统 SHALL 返回
人话错误（错误码区分"图片不受支持"这一成因）并保留输入区内容，界面 SHALL 标出该消息里的图片卡片（用户可移除
后重发）。系统 MUST NOT 静默丢弃图片后照发、MUST NOT 在粘贴时即拒收（贴入动作本身不受能力声明限制）。
能力判据 SHALL 只有一处（发送路径），界面 MUST NOT 另立第二套能力判定。

#### Scenario: 支持时正常投递

- **WHEN** 生效模型的声明含 `"vision": true`，发送一条携带图片卡片的消息
- **THEN** 消息正常发出，wire 请求含展开后的 `input_image` part

#### Scenario: 未声明按不支持

- **WHEN** 生效模型的声明缺 `vision` 键（或该模型不在清单内）
- **THEN** 该模型的图片能力按不支持处理并产生人话 warning；含图片卡片的消息发送被挡下

#### Scenario: 不支持时挡住并标出图片卡片

- **WHEN** 生效模型的 `vision` 为 `false` 或未声明，用户在 composer 贴入图片并点击发送
- **THEN** 发送被挡下并弹出人话错误；该消息里的图片卡片被标出（错误态可见）；输入区内容原样保留、会话不推进、
  MUST NOT 发出丢弃图片的降级消息；移除图片卡片后同一消息可正常发出

### Requirement: composer 草稿自动保存与恢复

混排对话输入区（composer）的内容 SHALL 作为**当前 vault 的草稿**自动保存并在装载该 vault 时自动恢复；粒度 SHALL 为
**一个 vault 一份草稿**（草稿绑定 vault 稳定 id，不绑定会话）。草稿 SHALL 落配置目录
（`<config_dir>/harness/drafts/<vault 稳定 id>.json`，tmp + rename 原子替换），MUST NOT 写入 vault、MUST NOT 新增或
改写 vault 内任何文件；目录名 SHALL 是 vault 注册表稳定 id（与会话留存 `sessions/<vault 稳定 id>/`、附件
`attachments/<vault 稳定 id>/` 同一份身份），MUST NOT 用 vault 路径派生的消毒名。无 vault 打开时系统 SHALL 只在内存
中工作——MUST NOT 落盘、MUST NOT 报错、MUST NOT 落任何兜底目录。

草稿 SHALL 存混排块模型（`ComposerBlock` 序列），MUST NOT 存有损的面板文本投影：图片卡片 SHALL 以内容寻址名
（`pasted-<内容哈希前 16 位>.<扩展名>`）+ 源 mime（+ 可选像素宽高）的**引用形态**入草稿，MUST NOT 内联 base64；
解析到未知块类 SHALL 保守保留、MUST NOT 静默丢弃内容。

保存 SHALL 为**防抖**（编辑停顿后落盘，窗口沿用同族 sidecar 的既有量级）+ **离散时点显式 flush**（切 vault 之前、
面板关闭、窗口失焦 / 退出）；系统 MUST NOT 只依赖防抖（切走之后不再有「当前 vault」这一上下文）。内容未变化时
SHALL 跳过写盘。写失败 SHALL 降级为人话 warning、MUST NOT 阻断输入、MUST NOT 谎报已保存。

恢复 SHALL 发生在装载 vault 时（app 启动装载后、切 vault 装载后）：读回该 vault 草稿并还原到输入区——块序、块类、
光标落位与图片卡片引用 SHALL 与保存前一致。无草稿 / 文件损坏 / 解析失败时 SHALL 安静回落到空的单段落输入区，
MUST NOT 报错、MUST NOT 伪造内容。恢复出的草稿是新编辑史——撤销 / 重做栈 MUST NOT 跨进程恢复。

**与其他时刻的交互**：发送**成功**后草稿 SHALL 清除（含落盘）；发送**被拒 / 失败**时草稿 SHALL 与输入区内容一并
原样保留，MUST NOT 出现「解析失败吞字」或「发送被拒即丢字」的空草稿窗口。切 vault 时 SHALL 先 flush 当前 vault 草稿、
再装载目标 vault 草稿。切换会话、新建会话、自动压缩 SHALL NOT 改变草稿（草稿属 vault 不属会话）；删除会话 MUST NOT
牵动草稿。

#### Scenario: 编辑后重开 app 恢复

- **WHEN** 在 composer 输入一段文本与一张引用卡片、停顿至防抖落盘，随后重启 app 并装载同一 vault
- **THEN** 输入区按相同块序还原该文本与引用卡片（引用卡片的 file / heading / lines 与保存前一致）；
  `<config_dir>/harness/drafts/<vault 稳定 id>.json` 是这次恢复的数据来源

#### Scenario: 切 vault 各留各的

- **WHEN** 在 vault A 的 composer 留有草稿，切到 vault B（其输入区为空），再切回 A
- **THEN** 切到 B 时 A 的草稿已 flush 落盘、B 的输入区呈现 B 自己的草稿（无则空）；切回 A 时 A 的草稿原样还原；
  `drafts/<A 的稳定 id>.json` 与 `drafts/<B 的稳定 id>.json` 互不影响；vault 目录零新增或修改

#### Scenario: 发送成功后清除

- **WHEN** 一条携带输入内容的用户消息发送被接受
- **THEN** 输入区清空，且该 vault 的草稿被清除（文件被删除或内容为空）——内容已进会话，不再作为未发送草稿留存

#### Scenario: 发送被拒时保留

- **WHEN** 当前模型不支持图片、一条携带图片卡片的草稿被发送闸挡下（未建会话、未入队）
- **THEN** 输入区原内容（含图片卡片）原样保留、图片卡片被标出错误态；该 vault 的草稿文件内容不变；
  MUST NOT 出现草稿先被清空再回滚的丢字窗口

#### Scenario: 图片卡片引用 round-trip 且草稿无 base64

- **WHEN** 草稿含图片卡片，重启后恢复该 vault
- **THEN** 还原出的图片卡片引用名与保存前一致、缩略图可经读回命令取回；草稿文件内不含 `data:image` 或长 base64 串
  （图片以内容寻址引用在场）

#### Scenario: 会话生命周期不动草稿

- **WHEN** 在留有草稿时切换历史会话、点击「新会话」、或发生自动压缩、或删除一份历史会话留存
- **THEN** composer 的草稿与 `<config_dir>/harness/drafts/<vault 稳定 id>.json` 均不受影响（切回该 vault 时草稿仍在）

#### Scenario: 无 vault 不落盘、不报错

- **WHEN** 尚未打开任何 vault 时在 composer 输入内容
- **THEN** 输入区照常可编辑，不产生任何 `drafts/` 文件、不弹错误、不落兜底目录

#### Scenario: 草稿损坏时安静回落

- **WHEN** 该 vault 的草稿文件缺失、为空或内容无法解析为草稿结构
- **THEN** 输入区回落到空的单段落形态，不报错、不伪造内容；随后编辑照常触发保存

#### Scenario: 写失败降级不阻断

- **WHEN** 草稿落盘失败（如磁盘不可写）
- **THEN** 产生一条人话 warning；输入区照常可用、内容不丢（仍留在内存），MUST NOT 阻断输入、MUST NOT 谎报已保存

### Requirement: 原子块边界光标位

composer 的模型层 SHALL 把「相邻两个原子块（卡片）之间的位置」当作一等公民的光标位：其表示 SHALL 为
`{block: 后一块的下标, offset: 0}`（等价于「后一块的前缘」）。该光标位 SHALL 满足 DOM 往返对称——从 DOM 读回时，
「选区锚在 composer 元素自身第 N 个子块边界」（`Range(composer, N)`）SHALL 归一为 `{block: N, offset: 0}`，
「选区锚在某张卡片元素内部或卡片元素本身」SHALL 归一为 `{block: 该卡片下标, offset: 0}`；把该位置写回 DOM SHALL
落在同一个边界上。该光标位 SHALL 跨整面重渲（`renderComposer` + 写回光标）与撤销 / 重做恢复保持一致。

仅把光标移动到该位置 MUST NOT 改变块序列、MUST NOT 产生撤销步——导航不是编辑。相邻两张卡片之间没有段落块是
**合法状态**，归一化 MUST NOT 为此凭空插入段落。

#### Scenario: ⌃B 落到两张相邻卡片之间

- **WHEN** composer 里有两张相邻的卡片（两者之间无段落）、光标在它们之后的段落里，用户按 ⌃B 把光标往回移
- **THEN** 模型读回的光标是 `{block: 后一张卡片的下标, offset: 0}`；块序列逐字节不变；撤销栈无新增步

#### Scenario: 相邻卡片之间的光标跨重渲与撤销保真

- **WHEN** 光标停在两张相邻卡片之间，此后发生一次整面重渲、或一次撤销后再重做
- **THEN** 光标被重新落在同一个边界上；块序列与重渲前一致

#### Scenario: 归一化不破坏边界光标位

- **WHEN** 光标停在两张相邻卡片之间，随后一次归一化折进了一个裸块
- **THEN** 归一化完成后光标仍在同一个边界位上；两张卡片之间不会被插入新段落

### Requirement: 边界光标位上的内容输入物化段落

光标停在相邻原子块之间的边界位上时，到达**内容型输入** SHALL 在该位置物化一个段落块并把内容落进它：
键入的字符、IME 组合的落字、粘贴与拖入的纯文本 SHALL 落在新段落里；⇧Enter SHALL 在该处落一个新空段落
（与「一次 ⇧Enter 恰好多一行可见行」的「卡片前缘」档同一条落法）；插入卡片 SHALL 把卡片落在该边界上，并保证
边界之后仍有承接光标的问题段落。

物化 MUST NOT 改动被该边界分隔的两张卡片、MUST NOT 把内容折进相邻的其它段落块。物化与该次输入 SHALL 合成
**一个**撤销步：一次撤销后 SHALL 回到「两张卡片相邻、两者之间无段落、光标在边界位」的前态。光标落在边界位本身
（无内容输入）MUST NOT 产生撤销步。在卡片前缘的位置输入纯文本时，系统 MUST NOT 删除该卡片。

#### Scenario: 在两张图之间打字

- **WHEN** 两张相邻的图片卡片之间的边界位上有光标，用户键入文字
- **THEN** 该边界处出现一个新的问题段落，文字落在其中；两张图片卡片原样保留、次序不变；光标落在该段落内

#### Scenario: 在两张图之间粘贴与 ⇧Enter

- **WHEN** 边界位上有光标，用户粘贴一行纯文本、或按 ⇧Enter
- **THEN** 该边界处出现承接内容的问题段落（⇧Enter 时为一个新空段落，`SHALL` 恰好多一行可见行）；两张图片
  卡片不受影响

#### Scenario: 在卡片前缘输入不吞卡

- **WHEN** 光标位于某张卡片的前缘，用户粘贴或键入一段纯文本
- **THEN** 该卡片仍在块序列中、内容与次序不变；文本落在该处物化的段落里

#### Scenario: 物化与输入合成一个撤销步

- **WHEN** 在边界位上键入文字后按一次撤销
- **THEN** 块序列回到「两张卡片相邻、两者之间无段落、光标在边界位」的前态；文字与新段落一并消失，两张卡片
  不丢

### Requirement: 图片编号与引用

系统 SHALL 为对话里的图片提供**编号**，且该编号在人可见的界面与投递给模型的消息两侧**同源**。

**编号规则**：编号 SHALL 在**一条消息内**按图片块在序列中的出现次序 1-based 分配（`Image 1` /
`Image 2`…），只计图片块，MUST NOT 计入引用卡片、消息摘录卡片或段落；编号自 1 起、MUST NOT 有空号；
图片块被移除后，同一消息内其余图片的编号 SHALL 即时重编（位序编号）。编号 SHALL 是块序列的**派生读数**
——MUST NOT 作为字段持久化进图片卡片的源数据、MUST NOT 进 composer 快照（恢复路径按同一规则重建）；
编号的计算 SHALL 只有一处（同一个纯函数既供卡片呈现、又供投递投影消费），界面 MUST NOT 另立第二份编号
判定。

**界面呈现**：composer 与 transcript 的图片卡片 SHALL 显示自己的编号；同一条消息在 composer、transcript
与恢复后三处显示的编号 SHALL 相同。引用卡片与消息摘录卡片 MUST NOT 显示编号。

**引用插入**：composer 内的图片卡片 SHALL 提供「插入引用」钮（`@` 形态；引用卡片与消息摘录卡片 MUST NOT
有该钮），点击该钮 SHALL 在**当前光标处**插入该图片的引用文本 `Image N`（N = 该卡片在点击时的编号）：
光标落在段落中间时 SHALL 按既有光标语义把该段落拆为两段、引用文本落在光标处；插入后光标 SHALL 落在
插入文本之后，可直接继续输入；光标不可得时 SHALL 按既有口径落 composer 末尾。插入的引用文本 SHALL 是
**普通可编辑文本**：系统 MUST NOT 在后续编辑中静默改写它——图片被移除导致编号重编后，已插入的文本可能
悬空，这是**可见**的、由用户处置的状态，系统 MUST NOT 静默错投。

**投递同源编号**：发送时**每个**图片块 SHALL 在投递序列里携带标签行 `Image N`，标签 SHALL 紧邻该图片
内容之前（模型因此能读到「编号 → 图」的配对）；标签的 N MUST 来自与卡片徽标同一份编号（一处真源，
MUST NOT 由第二处重算）。标签 SHALL 进入发给 provider 的 wire 请求；会话留存的**文本面 MUST NOT 出现
标签行**（恢复路径把留存当正文还原，标签若落在文本 part 会被复现成正文），留存 SHALL 以图片 part 上的
**结构化标签字段**承载编号，标签文本在发送前由该字段生成（真 client 与 mock 走同一条展开链）。
系统 MUST NOT 因用户已用 `@` 插入过引用而不注入标签。

**恢复与 transcript**：恢复路径 SHALL 按同一编号规则重建图片卡片的编号，MUST NOT 伪造、MUST NOT 丢弃；
一条已发送消息在 transcript 上的编号 SHALL 与该消息投递时模型看到的编号一致（消息发出即冻结其图序）。

#### Scenario: 编号按图序、只数图片块

- **WHEN** composer 里依次放入图片 A、引用卡片、图片 B、段落
- **THEN** 图片 A 的卡片显示编号 1、图片 B 的卡片显示编号 2；引用卡片与段落不参与编号

#### Scenario: 删除后位序重编

- **WHEN** composer 里有编号 1 / 2 / 3 的三张图片，移除其中编号 1 的那张
- **THEN** 剩余两张的卡片编号即时变为 1 / 2（无空号）；已插入正文的引用文本不被改写

#### Scenario: @ 钮在光标处插入引用

- **WHEN** 光标落在某问题段落中间，点击图片 B（编号 2）卡片上的 `@` 钮
- **THEN** 该段落从光标处拆为两段，`Image 2` 文本插入两段之间，光标落在插入文本之后可直接继续输入；
  正文中不出现编号以外的任何标记

#### Scenario: 卡片徽标与 wire 标签同源同 N

- **WHEN** 发送一条含两张图片（卡片徽标 1 / 2）的消息
- **THEN** wire 请求里第一个图片内容之前有 `Image 1` 标签、第二个之前有 `Image 2` 标签，且标签的编号与
  对应卡片徽标逐一对上；用户未使用过 `@` 引用时同样如此

#### Scenario: 留存文本面无标签、恢复后编号一致

- **WHEN** 一条含图片的消息发送完成，随后重启 app 恢复该会话
- **THEN** 该轮 `llm_request` 记录里 user 项的文本面不含 `Image N` 行（标签以结构化字段记在图片 part 上，
  不留 base64）；恢复后各图片卡片的编号与发送时一致，恢复出的消息正文不出现多余标签行

#### Scenario: 引用卡片与消息摘录卡片零编号（回归）

- **WHEN** composer 或 transcript 呈现引用卡片 / 消息摘录卡片，或发送含它们的消息
- **THEN** 界面与投递消息中均不出现它们的编号或序号属性（`<quote>` / `<msg-quote>` 零编号口径不变）

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

### Requirement: 消息摘录卡片

系统 SHALL 提供消息摘录手势：在 transcript 的用户消息或助手消息体内选中片段后出现浮动「摘录到对话」钮（与「摘录引用卡片」同手势形态），点击把该片段作为 block 级**消息摘录卡片**加入混排输入区；harness 面板未打开时 SHALL 先打开面板再入卡片。**钮的出现时机与落点同「摘录引用卡片」同一口径**：选区完成后才出现（拖拽中不出现、mouseup 后出现、键盘选区稳定后出现、选区清空即消失），落点就近取选区末端（光标侧）附近且整体钳制在 transcript 可视滚动区内。每张消息摘录卡片 SHALL 呈现：引号竖条、摘录原文截断（至多两行）、出处行（`对话 · 角色`）、（输入区内）移除钮；hover SHALL 显示完整摘录与来源消息的绝对时间。卡片数据 SHALL 携带：来源角色 role（`user`/`assistant`，必选）、上屏时间戳 at（可缺——快照恢复无戳的旧消息允许 role-only 出处）、摘录原文（所见文本，即渲染后选区文本）。思考块、工具行、批准卡与消息内引用卡片内部的选区 MUST NOT 产出消息摘录。点击卡片 SHALL 跳回 transcript 中对应来源消息并瞬态高亮整条消息（约 1.4s 消退）；定位按三层降级——① role + 上屏戳匹配；② 未命中则在 transcript 各消息体内搜索摘录原文（前缀匹配口径）；③ 仍找不到则 toast 告知该摘录已失锚（如「新会话」已重置、切换 vault），MUST NOT 静默跳到其他消息。快照恢复时消息摘录卡片 SHALL 从留存原文解析还原（与 `<quote>` 同 round-trip 口径）。消息携带消息摘录卡片时 SHALL 同「携带卡片时跳过视口」口径跳过视口注入（「上下文注入与可见性」的「携带卡片」涵盖文档引用卡片与消息摘录卡片两类）。消息摘录手势与编辑器摘录手势 SHALL 互斥并存——同屏至多浮现一个浮动钮，以后发生选区变化的来源容器为准。

#### Scenario: 消息选区创建卡片

- **WHEN** 在 transcript 某条助手消息体内选中一段文字并点击浮动「摘录到对话」钮
- **THEN** 混排输入区出现一张消息摘录卡片（竖条 + 至多两行摘录 + 出处行「对话 · Agent」）；卡片数据含来源角色、上屏时间戳与摘录原文；transcript 侧无任何常驻装饰残留

#### Scenario: 排除面

- **WHEN** 在思考块内、工具行上、批准卡内或消息内的引用卡片内部选中文字
- **THEN** 不出现浮动「摘录到对话」钮，不产生任何摘录产物

#### Scenario: 两手势互斥

- **WHEN** 先在编辑器中选中文字（编辑器浮动钮浮现），随后在 transcript 消息中选中文字（或反之）
- **THEN** 同屏只存在一个浮动钮；后发生的选区来源容器决定哪个钮在场

#### Scenario: 点击跳回消息高亮

- **WHEN** 点击输入区或已发送消息中的消息摘录卡片，且来源消息仍在当前会话 transcript 中
- **THEN** transcript 滚动定位到该消息，整条消息瞬态高亮（约 1.4s 消退）

#### Scenario: 失锚告知

- **WHEN** 点击消息摘录卡片，但来源消息已不在当前会话 transcript 中（「新会话」已重置或已切换 vault）
- **THEN** 面板出现 toast 告知该摘录已失锚，transcript 不发生任何跳转

#### Scenario: 快照恢复还原

- **WHEN** 重启 app 恢复会话，历史用户消息中含消息摘录卡片的序列化原文
- **THEN** 该消息还原后消息摘录卡片按原交错顺序呈现，卡片可点击跳回；卡片数据（role / at / 摘录原文）与留存一致

#### Scenario: 携带消息摘录卡跳过视口

- **WHEN** 发送一条仅携带消息摘录卡片（无文档引用卡片）的消息
- **THEN** 该条消息不附加视口行范围注入；chip 不显示视口（与携带文档引用卡片同口径）

### Requirement: 消息摘录序列化协议

发送消息时，混排输入区的消息摘录卡片 SHALL 序列化为 `<msg-quote role="…" at="…">摘录原文</msg-quote>`——每段消息摘录一行，问题文字 SHALL 按交错顺序排布在标签之间（与 `<quote>` 同一交错规则）；`role` MUST 为 `user` 或 `assistant` 且 MUST 在场；`at`（来源消息上屏时刻，ISO 8601 本地时间串、秒级）可缺——不可考时产出 role-only 元素；属性值与文本节点 MUST 做 XML 转义。序列化结构 SHALL NOT 包含任何编号——遵循一致性原则：投递给模型的上下文要素对人必须也可查（transcript who 行显示角色与相对时间、卡片 hover 显示完整摘录与绝对时间），编号对人无区分价值故不进协议。会话 JSONL 留存 SHALL 记录序列化后的完整消息（含 `<msg-quote>` 块，与 `<quote>` 同纪律）。解析还原路径 SHALL 识别 `<msg-quote>` 还原为消息摘录卡片；对不识别元素 SHALL 保守处理，MUST NOT 静默丢弃其文本内容。agent 回复 SHALL 按摘录内容与角色/时间回指。

#### Scenario: 序列化结构

- **WHEN** 发送一条「消息摘录卡 + 问题」的消息
- **THEN** 模型收到的消息中摘录为一个 `<msg-quote>` 元素（role 属性在场且合法、at 随来源消息可缺、无编号属性），问题文字位于 `</msg-quote>` 之后

#### Scenario: 转义 round-trip

- **WHEN** 摘录原文含 `<`、`&`、`"` 等字符，或来源消息无 at
- **THEN** 序列化输出中对应位置为 XML 转义形式，解析后还原为原文；无 at 来源产出无 at 属性的元素，解析还原为 at 为空的消息摘录卡片

#### Scenario: UI 与协议无编号

- **WHEN** 输入区或 transcript 呈现消息摘录卡片，或 agent 回复引用某段消息摘录
- **THEN** 界面任何位置与投递给模型的消息中均不出现 `#N` / `index` 形式的卡片编号

#### Scenario: 未知元素保守处理

- **WHEN** 快照恢复的留存消息文本中含序列化协议不认识的元素
- **THEN** 该元素的文本内容 MUST NOT 被静默丢弃（维持既有保守解析口径）

### Requirement: composer 的 Emacs 文本导航族

harness 面板输入区（composer）内的 Emacs 文本导航族 SHALL 经统一键位表分发（作用域 `text`），并按模型层
语义执行；MUST NOT 由引擎的原生 caret 路径决定行为。本能力覆盖的键位 SHALL 为：⌃F / ⌃B、⌃A / ⌃E、
⌃N / ⌃P、⌃D / ⌃H、⌥D / ⌥⌫、⌃K / ⌃Y、⌃T、扩选六键 ⌃⇧F / ⌃⇧B / ⌃⇧N / ⌃⇧P / ⌃⇧A / ⌃⇧E 与按词扩选
⌥F / ⌥B。族外的键位（⌃G、⌥G、翻屏族 ⌃V / ⌥V / ⌃L、`Tab` / `⇧Tab`、撤销族 ⌘Z / ⌘⇧Z / ⌘Y 及其 Emacs
别名）MUST NOT 被本能力改变——它们在 composer 内照旧走各自既有路径。

**停靠点与移动**：composer 的光标位 SHALL 由「块下标 + 段内偏移」表示；段落块 SHALL 提供其文本的全部偏移位，
原子卡片 SHALL 提供其**前缘**（= 该卡片下标 + 偏移 0）与**后缘**（= 下一块前缘）两个位置。视觉重合的相邻
表示（段落末缘与紧邻后块的前缘、相邻两段落之间的公共边界）SHALL 归一到**后一块前缘**的表示，且归一 SHALL
只有一处实现（从 DOM 读回与全部移动命令共用）。⌃F / ⌃B SHALL 在停靠点序列上移动**一步**——段内按字符
（组合字符 / 代理对作为整体一步），遇原子卡片 SHALL 整块一步跨过。⌃A / ⌃E SHALL 落到当前**逻辑行**的行首 /
行尾（`\n` 为行界）。⌃N / ⌃P SHALL 优先在**渲染行**之间移动（软折行产生的每一屏行是一行；同 x 位，超出目标行
长度取行尾）——**段内没有相邻渲染行时**才沿用既有的逻辑行 / 跨相邻段落块行为（超集；本 change 的原始口径是
「逻辑行之间移动」，M457 按 Alex 2026-10-12 裁决「与编辑器正文对齐」升为渲染行，故 change 的 design §4 与
tasks 里「逻辑行」的措辞停留在当时口径、未回改，**以本增量为准**）；卡片 MUST NOT 产生停靠行（被整体跳过）。
任一步移动 MUST NOT 原地空走（相邻停靠点在归一等价类后必不相同）。

**导航不是编辑**：仅移动光标 MUST NOT 改变块序列、MUST NOT 产生撤销步、MUST NOT 触发 composer 的整面重渲
（只允许写选区与滚动位）；移动后光标行 SHALL 在 composer 视口内（沿用既有视口合同）。

**删除族**：⌃D / ⌃H SHALL 与 Delete / Backspace 键走**同一份**模型语义（后删 / 前删一字符；光标在卡片前缘 /
段末遇卡片时对整块作用；有选区时删除选区），MUST NOT 存在第二份删除判定。⌥D / ⌥⌫ SHALL 按词 kill 到词尾 /
词首并并入 kill 槽；词边界口径 SHALL 与编辑器侧共用同一份实现。`⌥⌫` 与 `⌥Delete` SHALL 由本能力接管（经统一
键位表），MUST NOT 被输入区既有的就地退格 / 前删路径吞掉——它们今天在 composer 内被当作**普通逐字符退格**
消费（引擎原生词删除从未生效），接管后 MUST 表现为词级 kill。词级 kill 与 ⌃K MUST NOT 跨块——到达段落边界即
停（段边界处无动作），MUST NOT 隐式合并段落、MUST NOT 隐式删除卡片。

**kill 与 yank**：kill 槽 SHALL 是**跨面共用**的单一真源（编辑器与 composer 同一槽、同一份连续 kill 相接
判定）；kill 的内容 MUST NOT 含卡片（本能力的 kill 只作用于文本）。⌃K SHALL kill 到当前逻辑行行尾，已在行尾
则 kill 该行界（段落内合并两行），已在段落末行行尾则无动作。⌃Y SHALL 把 kill 槽内容插入光标处（有选区时先
删除选区），多行内容 SHALL 经段落拆分入口落成多个段落块；光标在卡片边界位时 yank SHALL 先在该处物化一个段落
再把内容落进去。

**转置与扩选**：⌃T SHALL 与编辑器侧转置语义一致（光标左右两个字符簇交换、光标落右端），在段首 /
卡片边界处无动作（段尾与编辑器侧同形——转置末两个字素簇，Emacs C-t 的原义）。扩选族 SHALL 保持
**anchor 不动**、由同一份移动纯函数驱动 head；⌥F / ⌥B SHALL 为**按词扩选**（与键位表内既有语义一致），
MUST NOT 被实现为词移动。

任一步失败（无动作、块边界、无法插入）SHALL 表现为「无动作」，MUST NOT 改动块序列、MUST NOT 留下半截状态。

#### Scenario: 原子卡片一步跨过

- **WHEN** composer 的块序列里有相邻的两张卡片（两者之间没有段落），光标在它们之后的段落里，按 ⌃B
- **THEN** 光标落到两张卡片之间（模型值 = 后一张卡片的前缘）；再按 ⌃B 落到第一张卡片的**前缘**（一步跨过两张
  卡片中的后一张）；块序列逐字节不变；撤销栈无新增步

#### Scenario: 段内与跨块移动

- **WHEN** 光标停在一个含软换行（`\n`）的段落中间，依次按 ⌃E、⌃N、⌃P
- **THEN** ⌃E 落到该逻辑行行尾；⌃N 落到下一渲染行的同 x 位（该段落每逻辑行只有一屏行时即「下一逻辑行的同列位」；
  超出目标行长度取行尾）；⌃P 回到上一渲染行；段落已是最后一段再按 ⌃N 时**光标不动**（无相邻段落块，且卡片
  不产生停靠行）

#### Scenario: ⌃N / ⌃P 走渲染行（软折行段落内）

- **WHEN** 光标停在一个**长到在 composer 里软折成多屏行**的段落内某一行，按 ⌃P（或 ⌃N）
- **THEN** 光标落到**上一屏（下一屏）渲染行的同 x 位**——块序列与文本逐字节不变（导航不是编辑）、撤销栈无新增
  步；该段落内那一方向**没有**相邻渲染行（已在首行 / 末行）时才落到既有行为上：跨到相邻段落块的对应行，
  没有相邻段落块则不动

#### Scenario: 导航不改块序列、不成撤销步、不重渲

- **WHEN** 在 composer 内连续按 ⌃F / ⌃B / ⌃N / ⌃P 若干次（只移动、不输入）
- **THEN** 块序列与全部块内容逐字节不变；撤销栈无新增步（随后一次 ⌘Z 撤销的是导航之前的最后一次编辑，不是
  导航本身）；composer 的 DOM 子树在这批按键期间无结构性变更（无整面重渲）

#### Scenario: 删除族按整卡与词级不跨块

- **WHEN** 光标在卡片前缘按 ⌃D；光标在段落段首、其前一块是卡片时按 ⌃H；光标在段落段首、其前一块是段落时
  按 ⌥⌫
- **THEN** 前两次都删掉整张卡片（与 Delete / Backspace 键同结果）；第三次停在段落边界、块序列逐字节不变
  （词级 kill 不跨块、不隐式合并段落、不隐式删卡片）

#### Scenario: ⌥⌫ 是词级删除（不被就地退格路径吞掉）

- **WHEN** composer 的段落文本是 `alpha beta`、光标在行尾，按 ⌥⌫
- **THEN** 段落变成 `alpha `——删掉的是**整个词**，不是单个字符；被杀文本进了 kill 槽（在别处按 ⌃Y 可插回）。
  若实现退化为逐字符退格（今天的形态：就地退格路径先消费了这拍），本条 MUST 变红。裸 Backspace 仍是逐字符
  退格，本能力 MUST NOT 改变它。

#### Scenario: kill 槽跨面共用

- **WHEN** 在编辑器里 ⌃K 杀掉一段文本，随后把焦点移到 composer 按 ⌃Y
- **THEN** 编辑器侧杀掉的那段文本插入 composer 的光标处；反向（composer ⌃K → 编辑器 ⌃Y）同样成立；两处用的是
  同一个槽（编辑器侧行为逐字节不变）

#### Scenario: yank 的多行内容与边界位物化

- **WHEN** kill 槽里是多行文本，光标停在两个相邻卡片之间按 ⌃Y
- **THEN** 该处先物化一个段落块，多行内容按段落拆分落进相邻的多个段落块（块序为：前卡片 / 新段落… / 后卡片），
  光标落在插入内容末尾；卡片不被吞、不被删

#### Scenario: 扩选族 anchor 不动

- **WHEN** 光标在段落中间，按 ⌃⇧F 若干次（跨越一张卡片）
- **THEN** 选区的 anchor 端点保持不动，head 端点按移动族同一套停靠点前进（含整块跨过卡片）；随后的 ⌃D 或 ⌃H
  删除该选区

#### Scenario: 族外键在 composer 内不受影响

- **WHEN** 焦点在 composer 内，依次按 ⌥G、⌃V、`Tab`、⌘Z
- **THEN** 它们的路径与行为与本能力存在之前一致（本能力不接管、不消费）：⌥G 与 `Tab` 不产生任何本层动作，
  ⌃V 走视口滚动，⌘Z 仍由 composer 既有的撤销栈处理

### Requirement: composer 的全选（⌘A，M627）

焦点在 composer 内时按下 `⌘A` SHALL 选中 composer 的**全部块**——段落块的全部文本与原子卡片
（引用卡片 / 消息摘录卡片 / 图片卡片）整体在内，MUST NOT 只选当前段落、MUST NOT 把选区扩到
composer 之外（编辑器 / transcript 不被波及）。命令 SHALL 经统一键位表的 `text` 作用域分发
（`editor.select-all` 与编辑器内容面共用同一条绑定，装配层按事件目标分派），MUST NOT 依赖引擎
原生的 selectAll：混排 contenteditable 里的原生 selectAll 选不到全文（Alex 2026-10-23 报告的
形态；Edit 菜单的预置 Select All 因此让出 `⌘A` 加速键，见 keymap-commands 的「⌘A 归文本面」）。
全选后的删除 / 键入 SHALL 走既有选区路径（删除整段选区、键入替换整段选区），MUST NOT 留下半截
卡片或裸节点。视图层契约与证伪口径见 `docs/specs/harness-composer.md` 的 HC6。

#### Scenario: 有卡片时全选覆盖全文

- **WHEN** composer 里有一张引用卡片、卡片后一行问题段落，焦点在 composer 内按 `⌘A`
- **THEN** 选区覆盖卡片与段落的全部内容（摘录原文与问题文本都在选区里），编辑器与 transcript
  的选区 / 内容不受影响

#### Scenario: 全选后键入替换整段内容

- **WHEN** composer 里有两段文本，按 `⌘A` 后键入一个字符
- **THEN** composer 只剩该字符（整段被替换，而不是在光标处插入）；随后的撤销恢复全选前的块序列

### Requirement: 系统提示词固定段来源

系统提示词的两段固定正文——身份段（装配清单来源 id `identity`）与摘录回指纪律（来源 id `quote_reference`）——SHALL 以仓内 Markdown 文件为**唯一**真源：`src-tauri/src/harness/prompts/identity.md` 与 `src-tauri/src/harness/prompts/quote-reference.md`，经编译期嵌入进入程序。文件名与来源 id SHALL 一一对应（`identity` ↔ `identity.md`、`quote_reference` ↔ `quote-reference.md`，仅 `_` ↔ `-` 的命名转换不同），使「id → 文件」与「文件 → id」双向可检索；代码侧 SHALL 同时保留指向来源文件的仓内路径常量。系统 MUST NOT 在运行期从配置目录、vault 或任何外部路径读取这两段正文的覆盖内容，也 MUST NOT 在代码里保留第二份正文副本。

固定段的注入顺序 SHALL 仍由装配代码决定（identity → quote_reference → AGENTS.md 三层 → Skill 索引），MUST NOT 改为目录枚举顺序或文件名字典序——`prompts/` 目录内新增或重命名其他文件 MUST NOT 改变装配结果。装配处 SHALL 消化来源文件的末尾空白（每段统一 trim 一次，消化文件尾换行与既有字面量的差异），注入文本其余字节 SHALL 与来源文件正文逐字节一致（MUST NOT 重排、重折行、转义改写）；文件尾换行 / 行尾空白 MUST NOT 进入注入文本，固定段与相邻节的拼接格式（`\n\n===== 标题 =====\n` + 正文）SHALL 与改造前逐字节一致。

装配清单（`session_open.assembly`，形态见「会话本地留存」）中这两段的条目 SHALL 记录来源文件的**仓内相对路径**（`src-tauri/src/harness/prompts/identity.md` / `src-tauri/src/harness/prompts/quote-reference.md`）：`path` MUST NOT 为 `null`，MUST NOT 为构建机绝对路径（绝对路径会把本机用户名写进会话留存）；`exists` SHALL 恒为 `true`，`bytes` SHALL 为注入（trim 后）文本的字节数。

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
- **THEN** 固定段的注入顺序仍为 identity → quote_reference，装配结果不随目录枚举顺序或文件名字典序变化

### Requirement: 输出中的 vault 路径可点击

harness 面板的 agent 输出里出现的 vault 内**文件**路径 SHALL 上屏为可点击元素。点击 SHALL 在
**新标签**里打开该文件（该文件已在任一处打开时切到既有标签，MUST NOT 产生第二个标签；尚无文件的
空文档按既有打开语义被复用），带行号锚时 SHALL 把目标行滚入视口并居中。打开 MUST NOT 创建任何
文件——候选未命中当前 vault 的文件索引时 SHALL 保持纯文本；这条与文档内 wikilink 的「点开即创建」
语义**刻意分叉**。

vault 内**目录**路径 SHALL 同样上屏为可点击元素。点击目录 SHALL 在左栏文件树里定位该目录：展开它的
祖先链、把目录行滚进视口、并给该行一次短暂高亮。目录点击 MUST NOT 打开任何文档、MUST NOT 切换或
新建标签、MUST NOT 创建任何条目、MUST NOT 改变文件树的当前行标记、MUST NOT 改变前台文档；定位语义
细节见 `file-tree`「目录定位不动当前行」。

路径识别 SHALL 采用「候选宽、校验严」：候选字符集 SHALL 允许中文等非 ASCII 文件名（锁定为 ASCII-only
候选的实现 MUST NOT 合入），且 SHALL 识别紧贴中文行文、两侧不带空格的路径（如「见路径」「路径的」
这类写法）；候选 SHALL 支持 `:行号` 与 `:行号:列号` 后缀（行号 1-based；列号只解析、v1 不参与落点）。
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
行。卡片路径与正文使用**同一份**目标类型判定：解析为文件的走「新标签 + 行定位」，解析为目录的走
「左栏定位」。MUST NOT 对卡片上的任意文本做路径正则——参数摘要被截断而解析不出结构化路径时，卡片
保持原样且不可点。恢复渲染（快照 / 会话恢复）的工具行 SHALL 与 live 行同口径。

**文件**点击造成的视口位移 SHALL 按阅读位置合同 CL-2 开「应用推动视口」的让位窗口：跳转的「中间态 →
目标位置」两拍内到达的滚动事件 MUST NOT 被阅读位置捕获；窗口边界 MUST NOT 由时长量定义。TOC 跳转与
harness 路径跳转 SHALL 使用同一捕获语义。目录点击只滚左栏、不触编辑器视口，CL-2 不适用于目录定位。

#### Scenario: 正文里的 vault 路径点开为新标签

- **WHEN** agent 回复的正文里出现一个存在于 vault 的文件路径（含中文文件名），用户点击该路径
- **THEN** 该文件在活跃 pane 的一个新标签里打开并成为前台；当前标签的内容不被替换

#### Scenario: 行号锚定到目标行

- **WHEN** agent 回复里写作 `路径:行号`（或 `路径:行号:列号`），用户点击该路径
- **THEN** 文件打开后目标行被滚入视口并居中；行号越界时按编辑器既有口径钳到末行且不报错

#### Scenario: 已打开的文件不重复开标签

- **WHEN** 被点击的路径对应的文件已在某个标签里打开
- **THEN** 只切到既有标签（跨 pane 时按既有语义移动标签）并执行行定位；标签总数不变

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
- **THEN** 可点范围止于目录路径本身（`:12` 留作普通文本）；点击只做左栏定位，不带任何行落点语义

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
- **THEN** 该路径可点击：解析为文件的走「新标签 + `offset` 行落点」；解析为目录的走「左栏定位」；
  参数摘要被截断、解析不出路径的卡片不可点

#### Scenario: 跳转不覆盖阅读位置（CL-2）

- **WHEN** 用户点击一条带行号的文件路径，跳转过程产生中间态滚动（含篇首或负值形态），随后越过阅读
  位置的防抖窗口
- **THEN** 阅读位置捕获 MUST NOT 记录中间态；最终记录的是用户实际停留的目标行（或窗口前用户自己
  的位置，若用户未继续操作）

### Requirement: 路径引用纪律

会话的系统上下文 SHALL 注入一段「路径引用纪律」固定段（与「摘录引用的回指纪律」同构）。该段 SHALL
要求 agent：引用 vault 内文件时写**完整的 vault 相对路径并带扩展名**；指向具体位置时带 `:行号`
（必要时 `:行号:列号`）；**只引用工具结果里真实出现过的路径**，不凭记忆拼路径；MUST NOT 用 Markdown
链接语法（`[文字](路径)`）包裹 vault 相对路径——该语法在面板里按外链处理，点击不会打开文件；引用
目录时说清是目录，不写成文件路径。装配清单 SHALL 为该固定段记一条来源条目（与既有固定段同口径：
无单一文件来源、`exists:true`、字节数为注入文本长度）。

该纪律的**遵从度** SHALL 按抽样观察验收，MUST NOT 写成机器断言：验收套件跑在 mock provider 上，
固定 fixture 代表不了真实模型的书写习惯。

#### Scenario: 纪律段注入与装配清单

- **WHEN** 建立一个新会话
- **THEN** 系统上下文包含路径引用纪律段（完整相对路径 + 扩展名、`:行号`、只引用真实出现过的路径、
  不用 Markdown 链接语法）；`session_open` 的装配清单含该固定段的来源条目

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
