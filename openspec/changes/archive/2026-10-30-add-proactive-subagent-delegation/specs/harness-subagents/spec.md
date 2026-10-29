# harness-subagents 增量规格（change add-proactive-subagent-delegation）

> 起草注记（非规格正文）：本 delta 一条 ADDED（委派触发时机的唯一居所）、一条 MODIFIED（内建定义：
> `explore` 补 `vault_list`、新增 `general`）。MODIFIED 块按当前 living spec
> （`openspec/specs/harness-subagents/spec.md`）的整条 requirement 复制再改，段落顺序与段数保持
> 不变，改动为「内建 `explore`」一段的改准、新增「内建 `general`」一段与两个同名场景。
>
> **`general` 是节点 1 的组成候选（design §9.2），不默认已批准**：它与本 delta 的其他条款一起裁决。
> 若节点 1 否决 `general`，**本提案不进入实现**——由 tower 修订 proposal / design / tasks / delta 后
> 重新走节点 1；实现者 MUST NOT 按清单自行删减本 delta 的条款（「否决后现场缩减」已按 Alex
> 2026-10-29 裁决废除）。
>
> **归档顺序（语义依赖，非 delta 基线依赖）**：`vault_list` 进入「工具集声明与默认收紧」条的闭集合
> 由 change `add-harness-vault-workspace-list` 的 delta 承担（该 change 已实现、待归档）。本 change
> 必须在它**之后**归档，否则并入后的 living spec 会出现「`explore` / `general` 声明了闭集合外的
> 工具」的自相矛盾——`general` 声明 9 件全量，尤其依赖这一条。两 change 改的是不同 requirement，
> 不存在 delta 互相覆盖。

## ADDED Requirements

### Requirement: 委派的触发时机（`task` 工具描述）

`task` 工具的描述 SHALL 由三段组成，顺序固定：**能力说明**（沿用现行文本：子代理有独立上下文、
只把摘要返回、不能再次委派、需要批准的调用会弹给用户；语义 MUST NOT 变更）→ **委派策略段** →
**生效定义清单**。
策略段 SHALL 是代码中的单一常量文本（一个居所），MUST NOT 由配置、定义文件、环境或用户输入拼接；
清单的格式与来源沿用「子代理定义文件」条（每行一个定义），本 requirement 不另定义清单形状。

委派成立的**必要条件只有一个**：清单里存在 `description` 与所需能力都匹配的定义（专用定义或
`general`）——针对**整件事**，或针对能从它**独立拆出的子任务**。任务形状（跨多份文件、
材料多、只需要一份压缩结论）SHALL 只是判据三的**收益信号**，MUST NOT 被写成委派的门槛：**简单
任务也可以派**。整件事与拆出的子任务都不匹配时，模型 SHALL 自己做，MUST NOT 把能力不匹配的整件
事硬塞给子代理（只读的 `explore` MUST NOT 承接需要写文件或执行命令的整件事）。

允许且 SHALL 允许**只委派匹配的子任务**：整件事里若有一段能力与描述都对得上、且本身是独立可交付
单元（只用子代理已声明的工具即可完成），策略段 SHALL 允许只把该子任务交给子代理、其余由主会话
完成，MUST NOT 要求把整件事一并委派。子任务的**体量 MUST NOT 成为允许委派的条件**——省上下文、
并行、专用模型、隔离过程材料都是判据三里的收益信号，由模型按总成本判断是否值得拆。这属分工，
不属兜底——兜底指用能力不匹配的子代理硬扛整件事。

策略段 SHALL 至少表达四条判据，四条判据的**固定标签**逐字为「匹配就委派」「无匹配就自己做」
「按总成本权衡」「独立才并行」，另有**固定锚点句「简单任务也可以派」**（两者都是跨制品的逐字
锚点，MUST NOT 改写成同义说法；改它们须同批改 spec、单测断言与文档抄录）：

1. **匹配就委派**：策略段 SHALL 指示模型——**按顺序选人**：清单里有 `description` 与能力都对得上的
   **专用**定义就派它（匹配哪个派哪个，不必等用户点名）；没有专用、但清单里有 `general` 且任务在
   它的能力范围内，派 `general`——专用优先、`general` 是次选而非默认选择；**多文件调研 SHALL 在
   第一步就调用 `task` 交给对得上的子代理**——策略段的逐字措辞为「多文件调研第一步就调用 task
   交给对得上的子代理，不要先做 vault_list / vault_read」，MUST NOT 先自行 `vault_list` /
   `vault_read` 把材料全读一遍再决定；
2. **无匹配就自己做**：策略段 SHALL 指示模型——整件事、以及能从它独立拆出的子任务，在清单里既没有
   匹配的专用定义、也不适合交给 `general` 时，自己做，MUST NOT 调用 `task`，MUST NOT 拿能力不够的
   子代理硬扛；若能拆出匹配且独立可交付的子任务，SHALL 允许只派那一段、其余自己做；
3. **按总成本权衡**：策略段 SHALL 指示模型——委派有固定开销（另起上下文、多一轮摘要），也有收益
   （省下主会话上下文、可并行、可用专用模型、把大量过程材料关在子运行里；跨多份文件反复比对或
   材料多而只需要一份压缩结论时收益通常更大）；是否值得由模型按**总成本**判断。策略段 SHALL 明确
   **简单任务也可以派**（只要上述收益超过开销），MUST NOT 把「简单任务不委派」写成义务或禁令，
   MUST NOT 把材料量 / 文件数写成委派的门槛；
4. **独立才并行**：策略段 SHALL 指示模型——互不依赖的多份调研**可以**在同一条消息里发起多个
   `task` 调用；后一步依赖前一步结果的不并行，同一件事不重复委派。这条是**许可**不是义务：
   策略段 MUST NOT 把它表述为「必须并行 / 总是并行」，MUST NOT 据此把可独立完成的任务推向委派。

**机制层的硬约束只有四类**：权限（批准 / 拒绝）、预算（轮次 / token / 时间三闸与会话级并发、
每回合委派数上限）、深度（子运行无 `task`）、能力（工具白名单）。**委派时机不在硬约束之内**：
机制 MUST NOT 以任务大小、形状或内容为由拒绝或强制一次委派；「简单任务不值得派」是可被模型推翻的
策略判断，MUST NOT 被实现成机制闸。

机制侧 SHALL NOT 提供任何**自动改派 / 自动兜底**路径：子运行只能由模型显式调用 `task` 发起；
`agent` 不存在时沿用 `agent_not_found`（回错误与可用名字清单、不启动子运行），系统 MUST NOT 自行
替换成 `explore` 或任何其它定义，MUST NOT 依据任务内容替模型挑选定义、MUST NOT 在能力不匹配时
降级执行。

策略段 SHALL 被表述为**给模型的判断指引**，系统 MUST NOT 解析它、MUST NOT 据它建立任务类型枚举
或路由表：机制对任务内容的处理口径不变（见「委托运行（`task` 工具）」条的「MUST NOT 解析 prompt」）。
策略段 MUST NOT 鼓励无条件委派，也 MUST NOT 把委派表述为默认动作。

通用提示词（identity / 工作区段 / AGENTS.md 装配）MUST NOT 承载委派策略——策略只有一个居所，
即 `task` 工具描述；是否把指引同时写进通用提示词属独立裁决，本 requirement MUST NOT 被实现为
「两处各写一份」。

#### Scenario: 三段顺序固定且策略段只出现一次

- **WHEN** 装载出任意数量的生效定义（含只有内建 `explore` 的情形）
- **THEN** `task` 工具描述以能力说明开头、策略段居中、清单在后；策略段恰出现一次；清单仍逐定义
  一行、内容不受策略段影响

#### Scenario: 四条判据的固定标签在描述里在场

- **WHEN** 读取 `task` 工具定义
- **THEN** 描述含「匹配就委派」「无匹配就自己做」「按总成本权衡」「独立才并行」四个固定标签与
  各自判据，缺任一即不满足本 requirement；「匹配就委派」判据含「专用优先、`general` 次选」的条件
  分支；「按总成本权衡」判据含「总成本」与「简单任务也可以派」的许可措辞，且**不含**「简单任务
  一律不派」这类禁令；且描述里没有把「独立才并行」写成「必须并行」这类义务措辞

#### Scenario: 机制不硬约束委派时机

- **WHEN** 模型对一个只有单文件、一两步就能完成的简单任务调用 `task`（已暴露、能力与预算都允许）
- **THEN** 机制照常启动子运行并回送结果，MUST NOT 以「任务太简单」为由拒绝；机制能拒绝的只有
  权限、预算、深度、能力四类，各自的既有拒绝路径不受影响

#### Scenario: 无匹配不自动改派

- **WHEN** 模型调用 `task` 时给了一个清单里不存在的名字，或清单里只有只读的 `explore` 而整件事
  需要写文件 / 执行命令
- **THEN** 系统 MUST NOT 自动把调用改写到 `explore` 或任何其它定义、MUST NOT 以「能力不足」为由
  降级执行、MUST NOT 替模型把整件事拆开；不存在的名字只回 `agent_not_found` 与可用名字清单，
  不启动子运行

#### Scenario: 匹配的子任务可以单独委派

- **WHEN** 整件事含写文件 / 执行命令，但其中一段（如多份笔记的只读对照）与 `explore` 的
  `description` 与工具集匹配，且本身是独立可交付的子任务
- **THEN** 模型可以只委派该子任务（子运行的工具集为 `explore` 声明的白名单），整件事的其余部分由
  主会话完成；这不算兜底，系统 MUST NOT 因为「整件事不完全匹配」而拒绝这次子任务委派

#### Scenario: 通用提示词不含委派策略

- **WHEN** 检查装配后的 system prompt（identity / 工作区段 / AGENTS.md 装配）与工具定义
- **THEN** 委派策略措辞只出现在 `task` 工具描述里，system prompt 的任何一段都不含它

#### Scenario: 关停时策略随工具一起退场

- **WHEN** `[harness.subagents].enabled = false`
- **THEN** `task` 不在工具定义里，策略段与清单都不出现在任何请求中；定义文件与内建 `explore`
  仍保留在磁盘 / 装载结果里（照「子运行配置节」条）

## MODIFIED Requirements

### Requirement: 子代理定义文件

系统 SHALL 从两个作用域发现子代理定义，并以 Markdown + YAML frontmatter 为唯一格式：

- vault 级：`<vault>/.lumir/agents/**/*.md`（随 vault 走、可入版本控制）；
- 用户级：`<config_dir>/agents/**/*.md`（跨 vault 复用）。

扫描 SHALL 递归子目录；身份 MUST 只取 frontmatter 的 `name`，子目录不参与身份。frontmatter 的必填
字段 SHALL 为 `name`（非空、无空白、不含 `/`、≤64 字符）与 `description`（非空）；可选字段 SHALL
为 `tools`、`model`、`max_turns`、`max_tokens`、`timeout_secs`、`background`。`background: true` SHALL
表示该定义强制后台运行（调用参数无法把定义的后台降为前台）。frontmatter 之后的 Markdown 正文
SHALL 是该子代理 system prompt 的身份段。定义文件 MUST NOT 需要改代码即可生效：每回合开头扫描一次，
磁盘改动在下一回合的委派中生效，MUST NOT 要求重启应用。

同名定义 SHALL 以 vault 级覆盖用户级；同一作用域内同名时 SHALL 取字典序第一个并产出一条人话
warning（MUST NOT 依赖文件系统读序）。非法定义 SHALL 被逐条丢弃并各产一条点名文件与原因的 warning，
MUST NOT 让扫描整体失败：frontmatter 缺失 / 未闭合 / YAML 解析失败、`name` 或 `description` 缺失、
`tools` 含闭集合外的工具名或 `task`。`tools: []` SHALL 合法（零工具子运行）。`model` 不在当前
provider 清单时 SHALL 保留定义并回落 `inherit` + warning；`max_turns` / `max_tokens` /
`timeout_secs` 类型非法或越界时 SHALL 取配置上限 + warning。未识别的 frontmatter 字段 SHALL 产
warning 并忽略（文案点名该字段在本版本不采纳）。

系统 SHALL 内置一个只读子代理定义 `explore`（Alex 裁决「同意」）：`tools` 为只读四件
`vault_read` / `vault_search` / `vault_list` / `skill_load`，`model` = `inherit`，三闸取
`[harness.subagents]` 缺省，描述其用途为「在 vault 里列目录、按路径枚举、搜索与读取文件、加载 skill，
产出结论与依据；不改文件、不跑命令」。`vault_list` SHALL 是可声明授予的只读工具（闭集合见「工具集
声明与默认收紧」条），内建 `explore` 显式声明它——描述里的「列目录 / 按路径枚举」因此有对应的工具，
MUST NOT 出现「描述声称能列目录、工具集里却没有列目录工具」的情形。`tools` 省略时的缺省集仍为只读
三件（`DEFAULT_TOOLS` 不变），内建 `explore` 的第四条是**定义显式声明**的结果，不是缺省集扩张。
内建定义 SHALL 与磁盘定义走同一条装载、校验与清单注入路径，MUST NOT 形成代码里的特殊分支。
同名定义 SHALL 以用户级 / vault 级覆盖内建（覆盖时产一条人话 warning，清单里只出现生效的一份）。

系统 SHALL 内置一个通用子代理定义 `general`：`tools` 为闭集合全部 9 件 vault 操作工具
（`vault_read` / `vault_search` / `vault_list` / `vault_patch` / `vault_create` / `vault_move` /
`vault_delete` / `skill_load` / `cli_run`），`model` = `inherit`，三闸取 `[harness.subagents]` 缺省，
描述其用途为「通用执行：按任务说明读写 vault、改文件、跑命令；不预设任务类型，一切由 prompt 决定」。
`general` MUST NOT 获得 `task` 与三件 cron 工具（闭集合之外，派生深度仍恰好 1 层）；ask 级调用照
既有批准透传语义执行并点名 `general`；同名定义覆盖与 `explore` 同规则（覆盖产 warning，清单只出现
一份）。`general` 的存在不改变「子运行工具集来自定义白名单」与「缺省集仍是只读三件」两条口径。

系统 SHALL 把每个生效定义的 `name` 与 `description` 注入 `task` 工具的描述（自动委派的依据）；
描述合计的估算 token 数（`ceil(字符数 ÷ 4)`）超过 15,000 时 SHALL 产出一条 warning 与
`subagent_catalog_large` 诊断事件，MUST NOT 截断清单。定义正文 MUST NOT 进入主会话上下文，只在
委派运行时装配。注入顺序与策略段的关系见「委派的触发时机（`task` 工具描述）」条。

#### Scenario: 定义即文件、按名可用

- **WHEN** 在 `<vault>/.lumir/agents/` 下新建一个 frontmatter 含 `name` / `description` 的文件
- **THEN** 下一回合起 `task` 工具描述里出现该名字与描述；用该名字委派可启动子运行，无需重启

#### Scenario: vault 级覆盖用户级

- **WHEN** 用户级与 vault 级各有一个 `name: research` 的定义
- **THEN** 委派 `research` 使用 vault 级定义的字段与正文；用户级同名定义不生效

#### Scenario: 内建 explore 可用且可被覆盖

- **WHEN** vault 与用户目录里都没有定义 / 另有一个 `name: explore` 的用户级定义
- **THEN** 前者清单里有内建 `explore`，委派它时工具定义恰为只读四件（`vault_read` / `vault_search` /
  `vault_list` / `skill_load`）；后者生效的是用户定义并产出一条覆盖 warning，清单里 `explore` 只出现一次

#### Scenario: 内建 general 可用且工具集为全量

- **WHEN** 默认清单（无自定义定义）委派 `general`
- **THEN** 子运行的工具定义恰为 9 件 vault 操作工具（含写类与 `cli_run`），`task` 与 cron 工具不在其中；
  同名自定义定义可覆盖它并产出一条覆盖 warning

#### Scenario: 非法定义逐条丢弃

- **WHEN** 某定义 `tools` 含 `task`，另一个定义缺 `description`，其余定义合法
- **THEN** 两个非法定义各产一条点名 warning 且不进入清单；合法定义照常可用，扫描不整体失败

#### Scenario: 描述超阈值告警不截断

- **WHEN** 所有定义描述合计的估算 token 数超过 15,000
- **THEN** 产出一条 warning 与 `subagent_catalog_large` 事件；清单仍完整注入，无定义被静默移除

#### Scenario: 未知字段可见

- **WHEN** 定义里写了本版本不采纳的字段（如 `permissionMode`）
- **THEN** 该定义仍生效，但产出一条点名该字段的 warning；MUST NOT 静默忽略
