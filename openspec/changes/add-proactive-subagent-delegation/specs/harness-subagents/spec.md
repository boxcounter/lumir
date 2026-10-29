# harness-subagents 增量规格（change add-proactive-subagent-delegation）

> 起草注记（非规格正文）：本 delta 一条 ADDED（委派触发时机的唯一居所）、一条 MODIFIED（内建
> `explore` 的工具集补 `vault_list`）。MODIFIED 块按当前 living spec
> （`openspec/specs/harness-subagents/spec.md`）的整条 requirement 复制再改，段落顺序与段数保持
> 不变，改动只有「内建 `explore`」一段与同名场景的「只读三件 → 只读四件」。
>
> **归档顺序（语义依赖，非 delta 基线依赖）**：`vault_list` 进入「工具集声明与默认收紧」条的闭集合
> 由 change `add-harness-vault-workspace-list` 的 delta 承担（该 change 已实现、待归档）。本 change
> 必须在它**之后**归档，否则并入后的 living spec 会出现「`explore` 声明了闭集合外的工具」的自相
> 矛盾。两 change 改的是不同 requirement，不存在 delta 互相覆盖。

## ADDED Requirements

### Requirement: 委派的触发时机（`task` 工具描述）

`task` 工具的描述 SHALL 由三段组成，顺序固定：**能力说明**（沿用现行文本：子代理有独立上下文、
只把摘要返回、不能再次委派、需要批准的调用会弹给用户；语义 MUST NOT 变更）→ **委派策略段** →
**生效定义清单**。
策略段 SHALL 是代码中的单一常量文本（一个居所），MUST NOT 由配置、定义文件、环境或用户输入拼接；
清单的格式与来源沿用「子代理定义文件」条（每行一个定义），本 requirement 不另定义清单形状。

策略段 SHALL 至少表达三条判据，三条判据的**固定标签**逐字为「匹配就委派」「简单任务自己做」
「独立才并行」（它们是跨制品的固定锚点，MUST NOT 改写成同义说法）：

1. **匹配就委派**：策略段 SHALL 指示模型——任务与某个定义的 `description` 相符，且需要跨多份文件
   调研 / 反复搜索比对，或过程材料多、最终只需要一份压缩结论时，主动委派该子代理，不必等用户点名；
2. **简单任务自己做**：策略段 SHALL 指示模型——读一两个文件、一两次工具调用就能答完的任务自己做、
   不委派；委派有固定开销（另起上下文、多一轮摘要），不为用而用；
3. **独立才并行**：策略段 SHALL 指示模型——互不依赖的多份调研**可以**在同一条消息里发起多个
   `task` 调用；后一步依赖前一步结果的不并行，同一件事不重复委派。这条是**许可**不是义务：
   策略段 MUST NOT 把它表述为「必须并行 / 总是并行」，MUST NOT 据此把可独立完成的任务推向委派。

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

#### Scenario: 三条判据的固定标签在描述里在场

- **WHEN** 读取 `task` 工具定义
- **THEN** 描述含「匹配就委派」「简单任务自己做」「独立才并行」三个固定标签与各自判据，缺任一即
  不满足本 requirement；且描述里没有把「独立才并行」写成「必须并行」这类义务措辞

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

#### Scenario: 非法定义逐条丢弃

- **WHEN** 某定义 `tools` 含 `task`，另一个定义缺 `description`，其余定义合法
- **THEN** 两个非法定义各产一条点名 warning 且不进入清单；合法定义照常可用，扫描不整体失败

#### Scenario: 描述超阈值告警不截断

- **WHEN** 所有定义描述合计的估算 token 数超过 15,000
- **THEN** 产出一条 warning 与 `subagent_catalog_large` 事件；清单仍完整注入，无定义被静默移除

#### Scenario: 未知字段可见

- **WHEN** 定义里写了本版本不采纳的字段（如 `permissionMode`）
- **THEN** 该定义仍生效，但产出一条点名该字段的 warning；MUST NOT 静默忽略
