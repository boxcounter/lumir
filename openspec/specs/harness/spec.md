# harness Specification

## Purpose
定义 AI 探针（harness）的落地口径——ADR 0007 授权的探索期能力：应用骨架右栏 dock 的对话面板
（唤起 / 收起、流式 Markdown 呈现、上下文用量常驻显示）；唤起时的编辑器上下文注入（当前路径 +
视口行范围，发送前可核对）；AGENTS.md 双层（user-wide `~/.agents/AGENTS.md` + vault 根）与 Skill
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

composer（输入区）与控制行 SHALL 收进同一个圆角卡片容器（内容底色 + 边框 + focus-within 强调框）；控制行位于容器底部，自左向右为模型 chip、ctx 读数、弹性间隔、发送钮。发送钮 SHALL 为图标钮（↑ / ■ 两态 glyph），配色 SHALL 按原型中性实心取值（浅色深灰近黑 + 白 glyph、深色浅灰 + 深 glyph、eink 纯黑，经组件级变量落账，不改全局 accent 一族）；处理中（busy）态 SHALL 显示脉冲环（box-shadow 呼吸动画，环色为与按钮同族的中性 tint；eink 下环不可见、状态由 glyph 承担；prefers-reduced-motion 下不脉冲）。其可读名称与悬停提示 SHALL 沿用文案表两态文案（发送 / 停止），行为口径（Enter 发送、处理中点击停止、stopping 幂等）不变。

#### Scenario: 唤起与流式对话

- **WHEN** 面板经命令唤起并发送一条提问
- **THEN** 面板出现在旁侧 pane（无第二 pane 时自动分栏，默认宽度比 harness:文档 pane = 1:2）；模型输出以增量方式逐段呈现并按 Markdown 渲染；期间编辑器键入响应不受影响

#### Scenario: composer 容器形态

- **WHEN** 面板打开且输入区获得焦点
- **THEN** 输入区与控制行在同一个圆角卡片容器内，容器呈 focus-within 强调框；发送钮为图标钮且读屏名为「发送」（处理中为「停止」）

#### Scenario: 文案与 token 纪律

- **WHEN** 界面语言切换（zh ↔ en）
- **THEN** 面板全部长驻文案经 `onRelabel` 重绘为对应语言；面板样式全部取值自 token 层

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

会话建立时，系统 SHALL 自动装配系统上下文，包含 user-wide（`~/.agents/AGENTS.md`）与 vault-wide（vault 根 `AGENTS.md`）两层文件内容；文件不存在 SHALL 静默跳过。嵌套子目录级 AGENTS.md 不在本期。

#### Scenario: 双层注入

- **WHEN** 两处 AGENTS.md 均存在并发起新会话
- **THEN** 系统上下文包含两份文件的内容；仅一处存在时注入存在的一份，不报错

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

判定总序 SHALL 为：deny 规则 > vault 内写重定向 > 危险黑名单 > allow 规则 > 模式默认分层——前四层模式无关，allow 规则 SHALL 在任何档生效（含 `read_only` 档），模式只替换最底层默认分层。deny 命中 SHALL 直接拒绝并回送模型；ask 档 SHALL 以批准闸呈现：执行前挂起循环，面板显示待批准项（写文档显示 diff 预览，CLI 显示完整命令），Alex 采纳后才执行，拒绝（及可选原因）回送模型；未决批准项 MUST NOT 自动超时通过。

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

批准项被采纳或拒绝后，卡片 MUST 收敛为一行终态记录：工具名 + 决策结果（已采纳 / 已拒绝）+ 决策的相对时间戳。diff / argv 预览 MUST 默认折叠，可经单一入口展开回看；待决语义副句（写类「批准后才会落盘」/ 命令类「批准后才会在终端运行，输出回到对话里」）与决策按钮 MUST 随决策退场，MUST NOT 以置灰形态残留在终态记录里（置灰按钮会被误读为「待处理 / 等待中」）。拒绝时若附了原因，原因文本 MUST 在终态记录中直接可见（无需展开详情）。`cli_run` 批准卡 SHALL 在命令上方显眼位置展示模型自述的 `purpose` 用途句，命令原文完整可见、MUST NOT 被用途句替代或截断；purpose 是阅读辅助而非安全判据，权限判定 MUST NOT 参考 purpose。

#### Scenario: diff 行高亮覆盖整行文本

- **WHEN** 面板呈现含超出可视宽度的增删行的 diff 预览（任意行长度 × 任意面板宽度）
- **THEN** 每个增删行元素的宽度 ≥ 该行文本的完整宽度，底色铺满整行、横向滚动区外无未高亮文本

#### Scenario: 采纳后收敛为终态记录

- **WHEN** Alex 对带 diff 预览的批准项点击采纳
- **THEN** 卡片收敛为一行记录（工具名 + 已采纳 + 相对时间戳）；diff 默认折叠、展开后可回看；待决标题与决策按钮退场，界面不再出现置灰的采纳 / 拒绝钮

#### Scenario: 拒绝附原因可见

- **WHEN** Alex 填写拒绝原因并点击拒绝
- **THEN** 终态记录直接显示原因文本（不依赖展开详情）；diff 默认折叠、可展开回看

#### Scenario: 用途句在命令上方呈现

- **WHEN** 一个带 `purpose` 的 `cli_run` 写命令进入批准闸
- **THEN** 批准卡命令上方显眼位置显示 purpose 用途句，命令原文完整可见；purpose 不参与判定（判定结果与同命令不带 purpose 时一致）

### Requirement: 上下文用量显示与触顶处理

composer 控制行 SHALL 常驻显示上下文用量读数（位于模型 chip 之后、发送钮之前）：context window 已用 %（最近一次请求的 input tokens ÷ 模型上下文窗口）与 cache hit %（Responses 形态下两 provider 统一走 `usage.input_tokens_details.cached_tokens`；映射表留在 provider 预设内防字段方言）。用量超过警示阈值（默认 85%，可配）时读数 SHALL 高亮，指针悬停读数 SHALL 浮出说明气泡（向上展开、右缘对齐读数右缘）、移开即收起；SHALL NOT 常驻显示警示句，也 SHALL NOT 另挂 ⓘ 类可点入口（2026-10-07 去感叹号改 hover 形态，读数高亮已承担警示语义）。系统 SHALL 默认自动压缩（`auto_compact = true`）：每轮响应完成后检查，越阈值即自动把会话历史压缩为摘要、开新逻辑会话并注入摘要 + 当前编辑器上下文 + 系统上下文；自动压缩 MUST NOT 静默——面板插入可见压缩标记（摘要可展开），压缩前历史 SHALL 完整留存在旧会话 JSONL 文件（封闭不再追加），压缩摘要 SHALL 随新会话 `session_open` 留存。API 返回上下文超限错误时 SHALL 自动压缩后重试该轮一次。系统 MUST NOT 静默截断会话历史。

> **已知边界（现象记录 + 根因调查进行中，非规格变更；2026-10-12 起）**：在 k3-256k 的 coding 端点（`api.kimi.com/coding/v1`，走 Responses 形状）上，Lumir 的真实会话里出现过「回报 `input_tokens` 尚不足名义窗口一半、紧接着的一次请求却被端点以 400 拒」（`Your request exceeded k3-256k model token limit: 262144`）——该会话成功的最大回报值 99,399，下一发即被拒；30 万字符的纯合成输入（剔除 reasoning 重放与 tools）同样被拒。另两点已坐实：端点**忽略**客户端 `max_output_tokens`（照收、响应回显 `null`），改 thinking 档位也不改变结论；该变体的报错**不带** `(requested: N)`，服务端算出的那个数拿不到。
>
> **「该端点存在远低于名义窗口的输入上限」这一结论已被证伪、不再成立**：同在 `api.kimi.com/coding`、同一模型 `k3-256k`，Kimi Code 的历史会话已被成功服务到 **234,656 input tokens**（≈ 名义窗口的 91%），其 wire 日志零真实 token-limit 报错。差异线索：Kimi Code 走 chat completions 形状、思考全文以 `reasoning_content` 明文重放；Lumir 走 Responses 形状、reasoning item 以 `rs_*` id + 摘要回放（不带 `encrypted_content`）。**头号假设**（服务端按 id 展开完整思考参与计账）**经 M464 三发对照探测未被支持，方向收窄为「reasoning 项本身的在场」**（2026-10-12）：把事故会话的请求体（主体 420 KB、251 个 input 项含 62 条 reasoning 项）三发——①原样带 `rs_*` id、②剥掉全部 `rs_*` id、③整项删尽 62 条 reasoning 项。**①与②都返回同一条 400**（`Your request exceeded k3-256k model token limit: 262144`；body 仅差 0.8%），**③返回 200**（服务端回报 `input_tokens = 76,149`、`reasoning_tokens = 0`）⇒ 移除 id 不改变判定、**移除 reasoning 项才越过闸**，即隐形膨胀来自 reasoning 项本身（与 id 无关）——62 条项（正文仅约 111 KB）在上限闸被计成 ≥18.6 万 token，而非 reasoning 部分被诚实报为 7.6 万。**机制尚未完全钉死**：③ 的 200 不能区分「服务端把 reasoning 项展开为完整思考原文计账」与「摘要文本按更大口径计账」——分离需第四发（把 62 条 reasoning 项替换成等长普通文本），**尚未跑**（待裁决）。修复方向（请求 `include` + 重放带 `encrypted_content`）不受此影响、独立成立于对齐官方 store:false 形状；事故项录于本改动之前、不含密文，故本探测**未直接验证**「带 blob 的新会话重放」是否越过闸（合并后新会话自然积累密文，留作活体验证）。本条只登记现象与调查状态，**不对该端点输入上限作任何断言**，也不对根因下结论（`docs/backlog.md` 第 44 条仍悬，探针全表见 `test-results/m464-probe/`，git 外）。
>
> 控制行 ctx% 读数的**现行口径仍为**「最近一次成功往返的 `input_tokens` ÷ 模型声明窗口」（上段之口径不变；meter 本体与错误路径均未因此改动）。是否调整分母口径（`docs/backlog.md` 第 44 条；该条所述「分母有效上限」结论处于**争议 / 调查中**）**待裁决**。错误路径的可观察性与每次请求的实际发送体字节数见「会话本地留存」条。

#### Scenario: 用量显示

- **WHEN** 完成一轮对话（含 mock provider 给出的 usage 数值）
- **THEN** 控制行读数显示与 usage 字段一致的 ctx% 与 cache hit%；读数位于模型 chip 与发送钮之间

#### Scenario: 超阈值警示收敛为悬停气泡

- **WHEN** ctx% 越过警示阈值
- **THEN** 读数高亮；指针悬停读数时浮出说明气泡、移开即收起；界面不出现常驻警示句、无 ⓘ 入口

#### Scenario: 自动压缩

- **WHEN** 一轮响应完成后 ctx% 越过警示阈值
- **THEN** 系统自动生成会话摘要并开新逻辑会话；面板出现可见的压缩标记，摘要可展开查看；后续对话在新会话上继续；压缩前历史完整留存在旧 JSONL 文件、摘要随新文件 `session_open` 留存

#### Scenario: 超限兜底

- **WHEN** API 返回上下文超限错误
- **THEN** 系统自动压缩并重试该轮一次；仍失败才向面板报错

### Requirement: 配置节 [harness]

`config.json` SHALL 支持 `[harness]` 节：`provider`（闭集合 `kimi` / `deepseek` / `mock`）、`providers` 表（各 provider 的 `api_key` / `model` / 可选 `base_url`；mock 为 `fixture` 路径）、`permissions`（`allow` / `deny` 规则表）、`permission_mode`（闭集合 `read_only` / `vault_write` / `full_access`，默认 `vault_write`）、`loop_max`、`warn_ctx_pct`。校验 SHALL 沿用既有模板：缺字段回落默认不告警；闭集合取值非法回落默认 + 人话 warning；类型不符整文件回落（ADR 0002 §5）。运行期写回 SHALL 经泛化的 `config_set_value(section, key, value)`，`ui` 表既有行为不变。

#### Scenario: 非法 provider 回落

- **WHEN** 配置里 `provider` 为闭集合外的值
- **THEN** 启动不失败，provider 回落默认并产生一条人话 warning

#### Scenario: 非法 permission_mode 回落

- **WHEN** 配置里 `permission_mode` 为闭集合外的值（或类型不符）
- **THEN** 启动不失败，模式回落 `vault_write` 并产生一条人话 warning（类型不符时整文件回落）

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
- **THEN** 该会话的 system 与 input（最后一条 `llm_request` 的完整请求体，并折叠其后未入请求的末尾响应，算法见 design §6.2）原样灌回内存态、不重新装配系统上下文；开新 JSONL 文件（首行 `session_open` 标 `opened_from=restore`、`restored_from`=源会话 id），旧文件封闭；其后提问按恢复的历史续写

### Requirement: 会话本地留存

会话 SHALL 以 wire/input 形态落配置目录（MUST NOT 写入 vault），作为 ADR 0007 双向记录机制的一侧：每会话一个 append-only JSONL 文件（`<config_dir>/harness/sessions/<vault 稳定 id>/<session_id>.jsonl`），文件首行 SHALL 为 `session_open` 记录——含 session id、vault 根路径、provider / 模型 / 思考档位、**完整装配后 system prompt 全文**与装配清单（每个来源的路径、存在与否、字节数；不存在的来源 SHALL 同样在场）。`<vault 稳定 id>` SHALL 是 vault 注册表 id（与 `vault-sessions/<id>.json`、`reading-positions/<id>.json` 同一份身份），MUST NOT 用 vault 路径派生的消毒名（消毒名有撞名面且无长度 / 字符集保证，M309 现场）。每次发给模型的请求（含工具循环的每次迭代与压缩调用）SHALL 落一条 `llm_request` 记录（完整请求体：system + messages + 参数，**另带本次实际发送体的字节数 `request_bytes`**——按 wire 展开后的尺寸算，省掉「按字节比外推请求多大」；不具备真实 HTTP body 的 mock 档省略该键），每次响应 SHALL 落一条 `llm_response` 记录（正文 / 思考归一回放项与展示文本 / 工具调用 / usage / 错误；思考 MUST 落盘——**回放项归一回放形状**（`{"type":"reasoning", summary, [content], [encrypted_content]}`：kimi 的明文载体是 `summary`、deepseek 的是 `content`，各按在场项保留；`encrypted_content` 有则在场），`id` 字段 MUST NOT 进入回放项（`store:false` 下重放 `rs_*` id 属非标用法），展示文本另存）；请求侧 **在模型声明支持思考档位时**（与顶层 `reasoning.effort` 同条件——判据 `HarnessConfig::effort_supported`，读配置 schema 的 per-model `effort` 声明）SHALL 带 `include:["reasoning.encrypted_content"]`（store:false 官方回放模式的前提——让服务端在 reasoning item 里回传密文，重放时无需 id 即可还原）；未声明 effort 的模型（含 deepseek 现役形态）MUST NOT 发该字段；wire 不可推导的决策与事件（批准 / 拒绝、停止中断、LLM 错误、循环上限）SHALL 以 sidecar 记录留存——其中 **LLM 错误的 sidecar 记录 SHALL 另带 HTTP 面诊断**（非 2xx 时的 HTTP 状态码、原始响应 body——按固定上限截断防巨型 body 撑爆留存、服务端 request id 若响应头或 body 提供；不具备 HTTP 面的错误省略这些键），且**错误事件的既有形态（`type`/`code`/`message`）不变**（新诊断只进留存，不破坏既有消费方），被 wire 覆盖或失去意义的 11 类事件 kind（`user_message` / `assistant_text` / `tool_call` / `tool_result` / `usage` / `tool_denied` / `compact` / `session_reset` / `approval_overwritten` / `approval_withdrawn` / `turn_abort_requested`）SHALL NOT 再记（重复记录即第二事实源）。记录点 SHALL 与发送点同点，MUST NOT 经二次序列化产生第二事实源。验收口径 SHALL 为恢复充分性：仅凭 JSONL 能逐字节重建任意一轮发给模型的请求。

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
- **THEN** 新 JSONL 文件首行为 `session_open`：system prompt 全文逐字节在场；装配清单含每个来源的路径与存在与否（user-wide AGENTS.md 不存在时 `exists:false` 同样记录）；provider / 模型 / 思考档位在场

#### Scenario: 恢复充分性（属性级）

- **WHEN** mock provider 跑完一轮含工具循环的对话（消息含 `<quote>` 块、响应含思考文本）
- **THEN** 仅凭 JSONL 独立重建的每个请求与落盘 `llm_request` 深度相等（逐字节重建判据）；第 i 条响应的正文 / 思考 / 工具调用与第 i+1 条请求的历史对应项逐字节一致

#### Scenario: 思考落盘与回放

- **WHEN** 一轮响应含 reasoning 文本，其后一轮把上一轮响应的 reasoning 项带回历史
- **THEN** `llm_response` 记录思考——回放项（**归一形状**：剥掉 `id`、`MUST NOT` 含 `id`；保 `summary` / `content` / `encrypted_content`）与展示文本（给人看）分别在 `reasoning` / `thinking` 字段；后续请求的历史中该归一后的 reasoning 回放项逐字节在场，且请求体**在模型声明支持思考档位时**带 `include:["reasoning.encrypted_content"]`；恢复旧会话（记录早于本改动、reasoning 项仍带 `rs_*` id）时，重建的 input 同样不含 `id`

### Requirement: mock provider

`provider = "mock"` 时 SHALL 从配置指向的 fixture 文件读取脚本化响应（含工具调用序列与 usage 数值），确定性驱动工具循环——真机验收 MUST NOT 依赖真实外部 API。

#### Scenario: 确定性验收

- **WHEN** 验收场景以 mock provider 配置启动 app 并发送提问
- **THEN** 工具循环严格按 fixture 脚本推进，断言可复现

### Requirement: 摘录引用卡片

系统 SHALL 提供摘录创建手势：在编辑器 pane 中选中片段后出现浮动「摘录到对话」钮，点击把该片段作为 block 级引用卡片加入对话输入区；harness 面板未打开时 SHALL 先打开面板再入卡片。每张卡片 SHALL 呈现：引号竖条、摘录原文截断（至多两行）、出处行（文档名 · 最近一级标题；摘录在文档首个标题之前时仅显示文档名）、（输入区内）移除钮；hover SHALL 显示完整摘录与完整标题链。卡片数据 SHALL 携带：vault 相对路径 file、最近一级标题 heading、行范围 lines（从选区捕获，MUST 非空，取不到行范围时 MUST NOT 生成卡片）、摘录原文。点击卡片 SHALL 跳回原文位置并瞬态高亮。编辑器侧 SHALL NOT 出现任何常驻的摘录相关装饰——只存在两种瞬态：进行中的选区（含浮动钮）、跳回高亮。摘录来源 SHALL 为「最近活跃编辑器 pane」的选区（ADR 0008 Decision 3 语义），harness 面板持焦 MUST NOT 改变该归属。

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
纯文本。已发送的用户消息 SHALL 同构呈现（卡片与问题段落上下交替，卡片无移除钮）。

#### Scenario: 卡片与问题交错

- **WHEN** 输入区已有「卡片1 + 问题1」，用户在问题1 之后继续摘录或贴入一张图片并输入问题2
- **THEN** 输入区呈现 卡片1 / 问题1 / 卡片2 / 问题2 上下交替（卡片2 可以是引用卡片、消息摘录卡片或图片卡片）；
  光标可在任意卡片前后继续输入

#### Scenario: 光标处拆段插入

- **WHEN** 光标落在某问题段落中间时触发「摘录到对话」或贴入一张图片
- **THEN** 该段落从光标处拆为两段，新卡片插入两段之间，光标落到新卡片下一行的问题段落（无则新建），可直接
  继续输入问题

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
拆段（`⇧Enter` 软断行），以及**删除族**（`⌃D` / `⌃H` 与裸 `Backspace` / `Delete` 的删字符、
删选区、删卡片）。栈顶同态去重 SHALL 让 no-op 不产生幽灵撤销步。删除族的各入口 SHALL 共用同一份
force 判定（单一真源），MUST NOT 各写一处字面量。

这条不变量 M343 引入撤销栈时只落在实现注释里（`withModel` 的「force=true 用于结构性操作」），
living spec 缺条款；M447/M453 的 `deleteAtCaret` 与裸 `Backspace`/`Delete` 分支因此写成 force=false
而无人可对账（M510 补条款）。

#### Scenario: 结构操作之后的删除仍能单独撤销

- **WHEN** 在输入区贴入一张卡片（结构性操作，压入「贴图前的空态」前态），并在聚簇窗口内按 `⌃H`
  （或裸 `Backspace` / `⌃D` / `Delete`）把该卡片删掉
- **THEN** 删除这一步 SHALL 独立压入「贴图后、删卡前」的前态；紧随的 `⌘Z` SHALL 恢复该卡片，
  MUST NOT 跳过删除直接弹回贴图前的空输入区

#### Scenario: 连续键入聚合成一步

- **WHEN** 用户在聚簇窗口内于同一段落连续键入多个字符（无结构性操作夹入）
- **THEN** 这些键入 SHALL 聚合成一个撤销步：一次 `⌘Z` 回到该串键入之前的状态，MUST NOT 逐字符各成一步

### Requirement: 引用消息序列化协议

发送消息时，系统 SHALL 把混排输入区序列化为 XML 结构投递给模型：每段摘录一行 `<quote file="…" heading="…" lines="A-B">摘录原文</quote>`，问题文字 SHALL 按交错顺序排布在标签之间（卡片阅读顺序 = 序列化顺序）；`lines` MUST 非空；`heading` SHALL 与卡片出处行显示的最近一级标题一致；属性值与文本节点 MUST 做 XML 转义。序列化结构 SHALL NOT 包含任何编号——遵循一致性原则：投递给模型的上下文要素对人必须也可查（卡片出处行、hover 完整摘录与标题链、注入 chip），编号对人无区分价值故不进协议。UI SHALL NOT 显示卡片编号；agent 回复 SHALL 按摘录内容/出处回指，同文档多段相似摘录时用出处（标题 / 行范围）消歧。序列化后的完整消息（含 `<quote>` 块）SHALL 以 wire 形态留存：在对应 `llm_request` 记录的 messages 数组中逐字节在场，经请求体重建即得。

#### Scenario: 序列化结构

- **WHEN** 发送一条「卡片1 + 问题1 + 卡片2 + 问题2」交错的消息
- **THEN** 模型收到的消息中两段摘录各为一个 `<quote>` 元素（file / heading / lines 三属性齐全、lines 非空、无编号属性），问题1 位于第一个 `</quote>` 之后、问题2 位于第二个 `</quote>` 之后

#### Scenario: 转义

- **WHEN** 摘录原文或出处含 `<`、`&`、`"` 等字符
- **THEN** 序列化输出中对应位置为 XML 转义形式，解析后还原为原文

#### Scenario: UI 与协议无编号

- **WHEN** 输入区或 transcript 呈现引用卡片，或 agent 回复引用某段摘录
- **THEN** 界面任何位置与投递给模型的消息中均不出现 `#N` / `index` 形式的卡片编号；agent 回复按摘录内容/出处回指（如「『倒序阅读』那段」）

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

transcript 中的用户与 agent 消息 SHALL 带角色 + 相对时间 meta 行（如「你 · 12 秒前 / Agent · 刚刚」）：角色名与相对时间同行，视觉上降档于消息正文（micro 字号、三级文字色）。用户消息 SHALL 以描边气泡呈现（内容底色 + 柔和边框 + 圆角），正文色降一档以区分于 agent 消息；agent 消息 SHALL 平铺排版（无气泡）。相对时间 SHALL 按「刚刚 / N 秒前 / N 分钟前 / N 小时前 / 昨天」分档并随时间低频刷新与随语言切换重绘。快照恢复的历史消息 SHALL 以后端时间戳（`PanelMessage.ts`）显示真实相对时间；无时间戳的旧快照 SHALL 只显示角色、SHALL NOT 伪造相对时间。快照消息面 SHALL 保真：正文为空的 assistant 轮（模型只发工具调用、无正文）MUST NOT 落成面板记录——快照恢复 MUST NOT 出现只有角色 meta 行、正文为空的「空气泡」；工具记录（`role: tool`）SHALL 持久化摘要（`PanelMessage.summary`），成功为调用参数摘要、失败含细分状态与错误码，使 webview 重载后工具行仍有信息。

#### Scenario: 新消息带 meta 行

- **WHEN** 发送一条提问并收到 agent 回答
- **THEN** 两条消息都带角色 + 相对时间 meta 行（用户消息在描边气泡内，agent 消息平铺）；相对时间初始落在「刚刚 / N 秒前」档

#### Scenario: 恢复消息按后端时间戳显示

- **WHEN** webview 重载或 pane 恢复后从快照重建 transcript
- **THEN** 携带后端 `ts` 的恢复消息按该戳显示相对时间；缺 `ts` 的旧快照消息只显示角色、不显示相对时间（不伪造）

#### Scenario: 工具轮快照保真

- **WHEN** 模型某轮只返回工具调用、无正文文本，随后 webview 重载从快照恢复
- **THEN** transcript 不出现只有角色 meta 行、正文为空的 agent 消息；工具行仍显示调用参数摘要（调用失败时显示细分状态与错误码）

#### Scenario: 语言切换重绘

- **WHEN** 界面语言切换（zh ↔ en）
- **THEN** 角色名与相对时间随 `onRelabel` 重绘为对应语言

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

composer 控制行 SHALL 提供权限 chip（位于模型 / 思考合并选择器 chip 之后、ctx 读数之前），**显示当前模式档的短名**（文案表 zh：只读 / 可写 / 完全；en：Read / Write / Full）——控制行被合并选择器 chip 与权限 chip 共同挤占，短名是「三档都能完整显示」的口径（Alex 2026-10-09 裁决；zh 短名「写入」于 2026-10-10 批复改为「可写」）。点击 SHALL 弹出浮层：三档单选、当前档勾选、列表项显示**全名**（zh：只读 / 保险库写入 / 完全访问；en：Read Only / Vault Write / Full Access）、且**每档附一行释义**消歧档名与语义（`read_only` = 读自动放行、写操作都先问；`vault_write` = 库内写自动放行、库外命令先问；`full_access` = 全自动、仅危险命令仍问；措辞可在实现批次微调，语义方向以此为准）。浮层 SHALL 复用既有浮层可访问性口径（`role="menu"` / `menuitemradio` / `aria-checked`）。选择一档 SHALL 立即生效并经 `config_set_value` 写回 `[harness].permission_mode`；切换 MUST NOT 打断进行中的轮次（对下一个判定生效，与模型 chip 同口径）。

#### Scenario: 三档浮层

- **WHEN** 点击权限 chip
- **THEN** 浮层列出三档（各显示全名 + 一行释义）、当前档勾选；选择另一档后 chip 文案（短名）更新、浮层关闭

#### Scenario: 切换不打断进行中轮次

- **WHEN** 一轮对话正在工具循环中，把模式从 `vault_write` 切到 `read_only`
- **THEN** 当前轮次按开轮时的模式判完；从下一个判定起按 `read_only` 执行

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
