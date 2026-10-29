# 子代理定义文件（subagent definitions）

> 状态：生效中的格式与装载合同（change `add-harness-subagents` tasks §6.4，2026-10-19）。
> 真源：`src-tauri/src/harness/agents.rs`（扫描、解析、逐字段校验、优先级与清单渲染都在那里；
> 本文档是它的可读投影，冲突时以代码为准）。字段的**语义**（工具白名单、三重闸、批准透传、
> 模型解析序）以 change design §4 / §8 / §11 为准，本文件只描述「定义文件怎么写、怎么被装载」。

## 1. 路径与发现

| 作用域 | 路径 | 说明 |
|---|---|---|
| vault 级 | `<vault>/.lumir/agents/**/*.md` | 随 vault 走、可入版本控制；`.` 前缀沿用「应用私有配置」惯例 |
| 用户级 | `<config_dir>/agents/**/*.md` | 跨 vault 复用；复用既有配置根（不新建 home dotdir） |

- 只认 `.md` 扩展名，递归扫描子目录。
- **身份只看 frontmatter 的 `name`**，子目录与文件名不参与身份。
- 不做「向上递归到仓库根」：vault 是单根，没有仓库根概念。
- 目录不存在视为空，不报错；目录内文件不可读只跳过该文件并产 warning，扫描整体不失败。
- 扫描**不跟随符号链接**（避免目录环）。

## 2. 文件格式

定义是 Markdown 文件：文件必须以 `---` 行开头，frontmatter 以另一行 `---` 收尾；其后是正文。

```markdown
---
name: research
description: 调研 vault 里的规范变更并给结论
tools: [vault_read, vault_search]
model: inherit
max_turns: 8
---

你是只读调研子代理。只做探索与综合，不修改文件。
结束时直接给出：结论 / 依据（vault 相对路径）/ 不确定项 / 未覆盖范围。
```

- frontmatter 是 YAML，但本仓只消费**标量 + 字符串列表 + 注释**子集；锚点、别名、多文档不在
  支持范围内（多文档直接判非法）。
- 正文是该子代理 system prompt 的**身份段**：非空时替换固定身份段，为空时只用固定身份段。
  正文**不进主会话上下文**，也**不进清单**——只在委派装配时按需读取。
- 字段名一律 **snake_case**。写成参照系的 camelCase（如 `maxTurns`）会走「未识别字段」warning
  并被忽略，不会静默生效。

## 3. frontmatter 字段（v1 闭集合）

| 字段 | 必填 | 值域 | 缺省 | 机制用途 |
|---|---|---|---|---|
| `name` | 是 | 非空、无空白、不含 `/`、≤64 字符 | — | 身份、委派参数、诊断 |
| `description` | 是 | 非空（首尾空白去掉后非空） | — | 自动委派的匹配依据；注入 `task` 工具描述 |
| `tools` | 否 | 9 件 vault 操作工具名的子集；`task` 非法 | 只读三件 | 子运行的工具白名单 |
| `model` | 否 | `inherit` 或当前 provider `models[]` 里的 id | `inherit` | 模型选择（见 design §11 的解析序） |
| `max_turns` | 否 | 正整数 | `[harness.subagents].max_turns` | 轮次闸；超过配置值则夹取 |
| `max_tokens` | 否 | 正整数 | `[harness.subagents].max_tokens` | token 闸；超过配置值则夹取 |
| `timeout_secs` | 否 | 正整数 | `[harness.subagents].timeout_secs` | 时间闸；超过配置值则夹取 |
| `background` | 否 | bool | `false` | 强制后台运行：调用参数只能把前台升为后台，不能把定义的后台降为前台 |

- `tools: []` 合法：零工具子运行（纯推理 / 判断）。
- 缺省工具集是**只读三件**：`vault_read` / `vault_search` / `skill_load`。写类工具与 `cli_run`
  必须显式声明（能力边界见 §9）；`vault_list`（目录 / 路径发现，change
  `add-harness-vault-workspace-list` 起在册）同样属可显式声明的只读工具——缺省集不含它，
  声明后才可见。
- 三个 `max_*` 字段是「用户意图」，`[harness.subagents]` 的对应键同时是缺省值与上限；冲突取小，
  装载期夹取并产一条点名 warning。

## 4. 校验与丢弃规则

校验是**逐定义**的：单个定义非法只丢它自己并产一条点名文件 / 字段的 warning；扫描本身永不失败
（最坏只剩两个内建定义 `explore` / `general`）。

| 情形 | 处置 |
|---|---|
| frontmatter 缺失 / 未闭合 / YAML 解析失败 / 多文档 | 丢弃 + warning（点名文件） |
| `name` / `description` 缺失或为空 | 丢弃 + warning |
| `name` 含空白、含 `/`、超过 64 字符 | 丢弃 + warning |
| `tools` 不是字符串列表 | 丢弃 + warning |
| `tools` 含未知工具名或 `task` | 丢弃 + warning（点名条目）——fail loud，不让子代理在静默缺工具下跑 |
| `tools: []` | 合法：零工具子运行 |
| `model` 不在当前 provider 的模型清单 | **保留定义**，回落 `inherit` + warning |
| `max_turns` / `max_tokens` / `timeout_secs` 类型非法或非正数 | **保留定义**，取配置值 + warning |
| `max_*` 超过配置上限 | **保留定义**，夹取到上限 + warning |
| `background` 不是布尔值 | **保留定义**，取 `false` + warning |
| 未识别字段 | **保留定义**，warning 并忽略（文案点名该字段在本版本不采纳） |
| 同一作用域内同名 | 字典序第一个生效 + warning（确定性规则，不依赖文件系统读序） |
| 文件不可读 | 跳过 + warning（不阻断扫描） |

「丢弃」的判据是**机制看不懂定义**（缺身份、工具名拼错、YAML 坏了）；「保留 + 回落」的判据是
**机制看懂了但值不可用**（模型 id 不在清单、数值越界）。前者是作者错误、必须可见；后者是配置
约定、按保守方向回落。

## 5. 优先级与同名

优先级从高到低：**vault 级 > 用户级 > 内建**。

- 跨层同名：更具体的作用域覆盖更泛的，产一条覆盖 warning；清单里只出现生效的一份。
- 同层同名：按文件路径字典序取第一个，产一条 warning。规则是确定性的——不依赖文件系统读序，
  换机器 / 换文件系统得到同一结果。
- 内建 `explore` 与 `general` 同规则可被用户级 / vault 级同名定义覆盖；不提供「单独禁用内建」的
  开关。

## 6. 内建定义（`explore` / `general`）

两个内建定义都**不落盘**（不在 `<vault>/.lumir/agents/`），来源标记为 `builtin`，与磁盘定义走
**同一条**解析、校验、优先级与清单路径：frontmatter 是一段代码内常量，不是装载阶段的特殊分支。
用户级 / vault 级同名定义覆盖它们（覆盖产一条人话 warning，清单只保留生效的一份）；不提供
「单独禁用内建」的开关。

### 6.1 `explore`（只读探索）

| 项 | 值 |
|---|---|
| `name` | `explore` |
| `description` | 「只读探索：在 vault 里列目录、按路径枚举、搜索与读取文件、加载 skill，产出结论与依据；不改文件、不跑命令。」 |
| `tools` | `vault_read` / `vault_search` / `vault_list` / `skill_load` |
| `model` | `inherit` |
| 三闸 | 取 `[harness.subagents]` 缺省（定义不写值，也就没有夹取） |
| 正文 | 内置身份段：只做探索与综合，输出「结论 + 依据（vault 相对路径）+ 不确定项 + 未覆盖范围」 |

- `vault_list` 是定义**显式声明**的第四条，不是缺省集扩张：`tools` 省略时的缺省集仍是只读三件
  （`DEFAULT_TOOLS` 不变——扩缺省集会改变所有既有自定义定义拿到的能力）。
- 描述里的「列目录 / 按路径枚举」因此有对应工具：MUST NOT 出现「描述声称能列目录、工具集里却
  没有列目录工具」的情形。

### 6.2 `general`（通用执行）

| 项 | 值 |
|---|---|
| `name` | `general` |
| `description` | 「通用执行：按任务说明读写 vault、改文件、跑命令；不预设任务类型，一切由 prompt 决定。」 |
| `tools` | 9 件 vault 操作工具全量：`vault_read` / `vault_search` / `vault_list` / `vault_patch` / `vault_create` / `vault_move` / `vault_delete` / `skill_load` / `cli_run` |
| `model` | `inherit` |
| 三闸 | 取 `[harness.subagents]` 缺省（定义不写值，也就没有夹取） |
| 正文 | 通用执行身份段：按 prompt 完成任务、先读后改；写与命令经父会话的批准闸透传；不能再次委派；结束给「结论 + 依据 + 改动清单 + 不确定项」 |

- 定位：没有专用定义可派时的**次选**——专用优先、`general` 次选，不是默认选择（策略见 §8）。
  只读版 `general` 与 `explore` 高度重复，不采纳；工具集窄化不是可实施选项。
- `task` 与三件 cron 工具**仍不可得**：它们不在闭集合内（派生深度仍恰好 1 层，子代理不能再次
  委派）；把 `task` 写进 `tools` 的定义在装载期被丢弃。
- ask 级调用照既有批准透传语义执行，批准卡点名 `general`。
- 同名定义覆盖与 `explore` 同规则：覆盖产 warning，清单里只出现生效的一份。

### 6.3 共同口径

- 内建定义的存在意味着：`enabled = true` 时清单恒非空，`task` 工具照常注册（即使一个用户定义
  都没有）。
- `[harness.subagents].enabled = false` 是全局 kill switch：`task` 不注册（策略段与清单都不进入
  任何请求），但定义文件与两个内建定义原样保留（重新启用即恢复）。

## 7. 热加载与快照

- **每回合开头扫描一次**（读取两个目录 + 解析 + 合并），本回合内使用同一份快照；不做文件
  watcher。
- 磁盘改动（新建 / 修改 / 删除定义）在**下一回合**的委派中生效，无需重启应用。
- 同一回合内不会出现定义前后不一致：一次回合的所有请求共用同一份清单。
- 正文按需读取：扫描只保留元数据；委派装配时才读文件正文。扫描后文件被改坏，正文读取会报错，
  由委派侧按错误处理。

## 8. 清单注入与容量告警

- `task` 工具描述由**三段**组成、顺序固定（change add-proactive-subagent-delegation「委派的触发
  时机」条）：**能力说明 → 委派策略段 → 生效定义清单**。能力说明沿用现行文本（子代理有独立
  上下文、只把摘要返回、不能再次委派、需要批准的调用会弹给用户）。
- 委派策略段是代码内的**单一常量**（`src-tauri/src/harness/tools.rs` 的
  `TASK_DELEGATION_POLICY`），MUST NOT 由配置、定义文件、环境或用户输入拼接。它的四条**固定
  标签**「匹配就委派」「无匹配就自己做」「按总成本权衡」「独立才并行」与**固定锚点句**
  「简单任务也可以派」是跨制品逐字锚点，不得改写成同义说法；改文案须同批改 spec 增量、单测断言
  与本节的抄录。全文（与代码常量逐字一致）：

  ```text
  委派时机（按这四条判断要不要调用本工具）：
  - 匹配就委派：清单里有 description 与能力都对得上的专用子代理时，直接派给它，不必等用户点名；没有专用、但有通用的 general 且任务在它的能力范围内时，派 general——专用优先，general 是次选，不是默认选择。多文件调研第一步就调用 task 交给对得上的子代理，不要先做 vault_list / vault_read。
  - 无匹配就自己做：专用子代理与 general 都对不上时（整件事、以及能从它拆出来的子任务都算），自己做，不要调用本工具——不要拿能力不够的子代理硬扛整件事，系统也不会替你改派。反过来，如果能拆出一个 description 与能力都对得上、本身有独立价值的子任务，就只把那段交给它、剩下的自己做：例如多份笔记的只读对照交给只读子代理，拿回差异清单后自己写最终文件——这是分工，不是兜底。
  - 按总成本权衡：委派有固定开销（另起上下文、多一轮摘要），也可能有收益——省下主会话的上下文、可并行、可以用专用模型、把大量过程材料关在子运行里（要跨多份文件反复搜索比对、或材料多而只需要一份压缩结论时，这笔收益通常更大）。简单任务也可以派：只要这些收益加起来超过开销就值得。没有「简单任务一律不派」的硬规矩，也没有「材料不够多不许派」的门槛——你自己按总成本判断。
  - 独立才并行：互不依赖的多份调研可以在同一条消息里发多个 task 并行；后一步依赖前一步结果的，不要并行。这条是许可不是义务——不要为了并行而并行。
  ```

- 策略是**给模型的判断指引**，不是机制路由表：系统不解析它、不据它分支、不按它校验调用。机制
  层硬约束只有权限（批准 / 拒绝）、预算（三闸与并发 / 每回合委派数）、深度（子运行无 `task`）、
  能力（工具白名单）四类；委派时机不在其中——机制 MUST NOT 以任务大小、形状或内容为由拒绝或
  强制一次委派。
- 策略只有一个居所：通用提示词（identity / 工作区段 / AGENTS.md 装配）MUST NOT 承载委派策略。
- 每个生效定义的 `name` + `description` 以固定格式追加在策略段之后：

  ```
  - explore：只读探索：…
  - general：通用执行：…
  - research：调研 vault 里的规范变更并给结论
  ```

- 描述内的换行折成空格（一行一个定义）；MUST NOT 截断清单——截断会让某些定义静默消失，比告警
  更糟。
- 容量估算：所有生效定义的描述字符数合计，按 `ceil(字符数 ÷ 4)` 粗估 token（本仓无本地
  tokenizer，文案注明「估算」）。估算值 **超过 15,000** 时产出一条 warning 与一条
  `subagent_catalog_large` 诊断事件（字段 `estimated_tokens` / `definition_count`）；清单本体
  照常完整注入。
- 正文不进清单：`task` 描述里只有名字与描述，没有正文内容。

## 9. 能力边界

- 工具集是 **9 件 vault 操作工具**的任意子集：`vault_read` / `vault_search` / `vault_list` /
  `vault_patch` / `vault_create` / `vault_move` / `vault_delete` / `skill_load` / `cli_run`。
  缺省只读三件只是 **缺省收紧**，不是能力天花板：声明写类工具、`cli_run` 或 `vault_list` 后照常
  可见。
- 工具是否可见（定义白名单）与是否放行（权限管线）是两道独立的闸：声明后仍走用户选定的权限档
  与同一套判定；落到 ask 的调用弹批准卡给用户。
- **无 web 工具**：这是 harness 本体的能力边界（主会话同样没有），不是子代理被额外削减。联网
  检索的现时方式是 `cli_run` 调用外部 CLI（与主会话同权、同批准闸）。
- **不能再次委派**：`task` 不在可授予集合内；把 `task` 写进 `tools` 的定义在装载期被丢弃。
  派生深度恰好 1 层，不维护运行时深度计数，也没有深度配置项。
- 思考档位继承父会话，不开放为定义字段。

## 10. 本版本不采纳的参照系字段

下列字段（来自 Claude Code subagents 参照系）在 v1 **不采纳**：写在定义里会产一条点名 warning
并被忽略，定义本身仍生效。

`disallowedTools` / `permissionMode` / `skills` / `initialPrompt` / `isolation` /
`omitClaudeMd` / `hooks` / `mcpServers` / `memory` / `effort` / `color`

不采纳 `permissionMode` 是硬边界：子运行继承用户选定的权限档，定义文件 MUST NOT 改变它。
不采纳 `effort` 与「思考档位继承父会话」同义。

## 11. 诊断与 warning 通道

- 装载期 warning 走既有 `config_warning` 事件（`source = "subagents"`，`message` 点名文件 /
  字段与原因），同一条 warning 在进程内只落一次（扫描每回合发生，不重复刷日志）。
- 容量告警另落 `subagent_catalog_large`（`estimated_tokens` / `definition_count`）。
- 定义里的 `name` / `description` 会进入模型请求（`task` 工具描述），按用户内容对待：诊断事件
  不复制清单正文。
