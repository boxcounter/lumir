# Proposal: Subagents（`task` 工具 + 子代理定义）——委托式 harness 运行与运行公共层回抽

- Change ID: add-harness-subagents
- 日期: 2026-10-18（第一轮：按 Alex 的参照系意见修订；第二轮：按 Alex 节点 1 阅读中的裁决修订，逐条见「裁决留痕」）
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> **裁决留痕（2026-10-18，逐字）**
>
> **起草授权**：「是。」——对「Subagents 提案紧随 cron 之后起草」的确认。
>
> **修订方向（2026-10-18，Alex 原话）**：「Subagents 已经是 Agent 产品很成熟的概念了，我们可以参考
> 借鉴、无需自定义」。据此本稿以 Claude Code 官方 subagents 设计为参照系重写形态：子代理由
> **Markdown + YAML frontmatter 定义文件**描述，`task` 工具按**名字**委派，主 agent 按 `description`
> 自动委派；初稿的「每次调用内联声明工具集 / 预算」不再是主界面。参照系事实来源：
> [Create custom subagents](https://code.claude.com/docs/en/sub-agents)（2026-10-18 抓取）。
>
> **定位（已裁决）**：「Subagents / Cron 定位 | harness 通用原语，不特化到任何场景」。出处：
> `.local/design/harness-vision.md`（git 外，设计真源，下称「真源」）的「裁决记录」表。
>
> **形态（真源标「已倾向」）**：「`task` 工具——入参为任务描述、prompt、模型档位、工具集、失控闸值、
> 超时。子 agent 跑自己的工具循环，结果以摘要回主会话。」同节四项「已倾向」：派生深度限 1 层、
> 工具集按任务声明且默认收紧（调研类默认只读）、子 agent 用量归入主会话累计读数、token / 时间 /
> 轮次三重失控闸任一触顶即收敛返回部分结果。**参照系只改这些约束的落法（工具集与闸值从「调用参数」
> 移到「定义文件」），不改约束本身**：深度仍恰好 1 层、默认仍收紧、三重闸仍全在。
> 其中「用量归入主会话累计读数」一项已被 2026-10-18 裁决推翻（不同模型的 token 折叠成一个数没有
> 意义），改为**按模型分桶记账**（§E.1）。
>
> **统一抽象（Alex 认可的次序）**：「第一个原语（cron）带最小抽象落地，第二个原语（Subagents）
> 出现时回抽公共层。因此本提案必须正面处理『触发 → 上下文装配 → 工具循环 → 留存』公共层。」
> 该承诺的书面落点是 change `add-cron-runtime-daemon` 重构稿 design §14：「Subagents 落地
> 时 MUST 回抽公共层『触发 → 装配 → 运行 → 留存』，把 cron 的触发源与 Subagents 的委托触发一起
> 接入该层，MUST NOT 让 Subagents 另写一套调度。」**本 change 是这条承诺的兑现点。**
>
> **调度策略**：机制不含调度策略，策略全在定义文件。
>
> **ADR 前置**：ADR 0007 的 Revisit 条件写明「探针能力清单需要扩张（如后台任务、subagent 从架构约束
> 转为实际需求）→ Alex 显式裁决后修订本 ADR，不允许在 OpenSpec change 中静默扩张」。2026-10-18 的
> 裁决已把 subagent 从「架构约束」转为「实际需求」；ADR 0007 的修订（工具集边界新增「编排工具」一类）
> 列为本 change 的实现前置，见 Impact 与 tasks §0。
>
> **节点 1 阅读中的裁决（2026-10-18，逐字）——本稿相对上一版的全部改动来源**：
>
> | Alex 原话 | 落到本稿哪里 |
> |---|---|
> | 「我反对。我希望支持后台运行和并行。」（针对上一版「v1 串行、前台」） | 推翻裁决点 13：同一回合多个 `task` 调用并行、支持后台运行、并发上限进 `[harness.subagents]`；§D.6 重写，design §12 重写为「并发、后台与调度」 |
> | 「确认。」（批准卡透传） | 推翻裁决点 7：子运行继承主会话权限档，ask 级调用照常弹批准卡并点名发起者 |
> | 「同意。」（内建 explore 子代理） | 推翻「不做内建子代理」：内建只读 `explore`；用户 / vault 定义同名覆盖内建（§B.6） |
> | 「这个应该包含 UX 改动，subagents 和 tasks 应该是用户可见的。所以需要出原型，我查看。」 | 新增 §G「UX：用户可见面」+ 原型 [`design/prototypes/subagents-tasks.html`](../../../design/prototypes/subagents-tasks.html) |
> | 「我希望 subagent 是可以通过配置项启用/禁用的，默认启用。」 | `[harness.subagents].enabled` 缺省 `true`，kill switch 语义如实写明（§F） |
> | 「去掉反向扳机。也把 cron 的反向扳机去掉。」 | 反向扳机整节删除（cron 侧已由 M572 处理）；本稿只留「降级路径」 |
> | 「那不同的模型的 token 使用量没有任何意义。」 | 用量归属从「折叠进父会话单一读数」改为**按模型分桶记账**（§E.1） |
> | 「那 subagent 是否会是一个能力极度受限的版本，比如连使用 tvly 搜索都不可以，列目录也不可以。」 | 澄清缺省收紧只是缺省值、工具集可声明 8 件任意子集（含 `cli_run`）；联网搜索是 harness 本体缺口，见「能力边界」节 |
>
> **节点 1 后续裁决（2026-10-18，Alex 原话）**：「全部采纳。」——针对本稿末尾设计取舍第 14–18 条。
> 五项均按提案原样采纳：**14 后台完成不自动起回合——采纳**、**15 并发上限与请求级闸——采纳**、
> **16 待批请求改列表——采纳**、**17 任务面板位置——采纳**、**18 内建 `explore` 覆盖告警——采纳**。
> 节点 1 整体仍未通过（等 Alex 通读提案）。

## 参照系：与 Claude Code subagents 的逐项对照

**vision 原设计与成熟实践收敛的部分不变，本节只处理借鉴增量。** 收敛项一句话带过：独立上下文窗口、
只回摘要；工具集 allowlist 收紧；模型档位（调用参数 > 定义 > `inherit`）；用量计入同一配额；
轮次闸触顶返回 partial。这五条本提案照旧，不因参照系重开讨论（「用量计入主会话同一上限」在第二轮
裁决里改为「计入同一配额、按模型分桶记账」——配额口径不变，读数口径改了）。

### 借鉴项（初稿没有、本稿采纳）

| 维度 | Claude Code 的做法 | 本稿落法 |
|---|---|---|
| 定义形态 | Markdown + YAML frontmatter，`name` / `description` 必填，正文即 system prompt | 同形；vault 级 `<vault>/.lumir/agents/*.md`，用户级 `<config_dir>/agents/*.md` |
| 发现与作用域 | 项目 `.claude/agents/` 从 cwd 向上递归到仓库根 + 用户 `~/.claude/agents/`；同名按距离优先级 | vault 级覆盖用户级；同一层同名取字典序第一个 + warning（比参照系的「文件系统读序」确定）。Lumir 的 vault 是单根、无「仓库根」概念，故不做向上遍历 |
| 自动委派 | 主 agent 按 `description` 匹配委派；描述合计超 15k token 启动告警 | 采纳：清单（名字 + 描述）注入 `task` 工具描述；超阈值产 warning（token 按 `字符数 ÷ 4` 粗估） |
| 热加载 | 磁盘改动数秒内生效（新建目录等少数情形需重启） | 采纳等价效果：**每回合开头扫描**两目录并快照，下次委派即用新定义；连「新建目录需重启」的例外都没有 |
| 触顶语义 | `maxTurns` 触顶 → 输出标 partial，主 agent 可 resume 继续 | 采纳并扩到三闸：任一闸触顶 → `status=partial` + `resumable=true` + `run_id`；`task` 支持 `resume` |
| 深度 | 默认 3 层、可配；到限时**收回 Agent 工具**（工具白名单即机制） | 深度固定 1 层：子运行的工具定义恒不含 `task`，不维护运行时深度计数、不提供配置项 |
| 模型解析 | 调用参数 > frontmatter > 环境变量；`inherit` = 主会话模型 | 调用参数 > 定义 `model` > `inherit`；不做环境变量层 |
| 部分输出 | API 中断但已有文本 → 返回部分输出并说明；什么都没产出才失败 | 采纳：`stopped_by=error` 的 partial 结果；无文本才 `failed` |
| 前台 / 后台 | 前台子代理阻塞主对话、批准卡随到随弹；后台子代理并行跑，主对话继续；后台结果作为完成通知在后续回合送达 | 采纳：`task(background=true)` 与定义 `background: true`；前台 `task` 阻塞本回合，后台 run 跨回合继续，结果以自动化通知进入父会话 |
| 并发上限 | 同一会话默认最多 20 个同时运行，超出即报错并告知不要重试 | 采纳机制、不照默认值：`[harness.subagents].max_concurrent`（缺省 4，域 1–16） |
| 批准透传 | 子代理继承主会话权限规则；ask 级调用把提示浮到主会话并**点名是哪个子代理**在问；拒绝只废掉这一次调用、不停子代理 | 采纳：继承用户选定的权限档；批准卡点名 agent 与 run；拒绝只拒该次调用（`approval_denied`）并计数，子运行继续 |
| 内建子代理 | 内建 Explore（只读、无写）/ Plan / general-purpose；用户或项目定义同名时覆盖内建 | 采纳一个：内建 `explore`（只读三件）；用户 / vault 定义同名覆盖内建，覆盖产一条 warning |

### 刻意不同（视真源已裁决心与产品面为更大约束）

| 维度 | Claude Code 的做法 | 本稿做法与理由 |
|---|---|---|
| `tools` 缺省 | 省略 = 继承子代理可用的全部工具（含 `Agent`，因此默认可嵌套） | **省略 = 只读三件**（`vault_read` / `vault_search` / `skill_load`）。真源已裁决「工具集默认收紧、写入显式声明」；全量继承等于默认放开写与 CLI，不采纳。**这只是缺省值**：定义可声明 8 件工具任意子集，含 `cli_run` |
| 权限模式字段 | 定义可写 `permissionMode`（受主会话模式约束） | v1 不采纳该字段：子运行恒继承用户选定的会话档位，vault 里的定义文件不得改变用户设定的权限边界（ask 的透传是另一件事，照参照系） |
| 缺省前台 | 交互会话缺省把子代理放后台跑 | 本稿缺省**前台**：`task` 调用在同回合内收敛，摘要与后续推理在同一回合里闭合；后台是显式要求（调用参数或定义字段）。理由：本产品的主会话面板只有一个回合语义，缺省后台会让「回合结束」与「任务仍在跑」成为常态，用户难以判断该不该等 |
| 后台完成后的投递 | 后台结果以完成通知进入后续回合，主对话可被唤起来汇报 | 采纳「通知在后续回合送达」，**不采纳自动起回合**：本产品不在无人注视时消耗配额（已裁决，见设计取舍 14） |

### 不采纳的定义字段（逐条给理由）

`disallowedTools`（本稿默认不是全量继承，deny-list 无适用面）；`permissionMode`（见上）；`skills`
预载（Skill 索引已装配、`skill_load` 可运行时加载）；`initialPrompt`（正文承担）；`isolation: worktree`
（Lumir 不是 git 工作树产品）；`omitClaudeMd` 对应物（AGENTS.md 三层是本产品的基础约定，始终装配）；
`hooks` / `mcpServers` / `memory` / `effort` / `autoCompactWindow` / `color`（无对应机制或不适用）。
这些字段出现在定义里时产一条 warning 并忽略，不静默吞掉。

## Why

1. **主会话的上下文是最贵的一份共享资源**。调研类任务（读十份材料、逐篇摘要、跨源比对）的中间材料
   一旦进主会话历史，此后每一轮往返都要重新载入它——即使命中前缀缓存，输入 token 也不归零。子运行
   把材料关在自己的循环里，主会话只收一份摘要：主会话的上下文增长从「材料体量」变成「摘要体量」。
2. **成熟形态的核心不是「能调一个子 agent」，而是「同一类子 agent 可以被定义、复用、版本化」**。
   初稿把工具集、模型、闸值全部塞进每次调用的参数里：模型每次都要重写一遍策略、用户无法预先约束、
   定义无法随 vault 走。参照系把策略收进定义文件后，机制只回答「有哪些子代理、怎么跑、怎么收敛」，
   「谁用什么工具、在什么模型上跑、花多少」成为可编辑、可版本化、可评审的文本——这与本仓「机制进
   代码、策略进文档」是同一条原则。
3. **自动委派是定义文件的存在理由**。如果只能显式调用，`description` 就退化成注释，模型不知道
   自己有哪些帮手；定义文件只剩「参数包」的作用。采纳清单注入 + `description` 匹配，才能让「新场景
   = 新定义文件、代码零改动」成立。
4. **可 resume 的部分结果把「闸」从惩罚变成可协作的边界**。只会失败的重试代价是重跑整段材料；可
   续跑的部分结果允许「先给 20 轮、不够再加」，配合 token / 时间闸，成本控制从「一次押注」变成
   「分段追加」。
5. **公共层的回抽到期**。现有会话形态本就是「触发器 + 上下文装配 + 工具循环 + 留存」；用户输入、
   cron、委托是三类触发源。cron 提案已声明不在自己之前预造空壳抽象、由 Subagents 兑现回抽；两个
   change 都零代码，此刻改形状成本最低。
6. **失控闸与默认收紧是开放委派的前提**。委派循环的三个失控面：模型自我递归委托、单次委派烧掉整份
   配额、子运行卡死把主回合挂住。三重闸 + 白名单深度的语义先立，再把 `task` 暴露给模型。
7. **并行与后台是「委托」这件事的本来用途**（Alex 裁决）。只做串行前台，`task` 只是一次「换个上下文
   重述任务」的昂贵调用；能并行的独立子任务（三份材料各读一遍、两个假设各验一遍）才是委托省时间的
   地方。后台则让「长任务不占住对话」成立——用户可以在子任务跑着的时候继续问别的事。
8. **用户可见是能力的一部分，不是装饰**（Alex 裁决）。看不见的任务等于不可信：用户要知道派了几路、
   各自用什么模型、卡在等谁批准、花了多少。可见面与机制同批设计，避免「先上线再补一个面板」把面板
   挤成事后拼装的对话框附件。

## What Changes

两个 capability：**新增** `harness-subagents`（定义文件 + 委托运行 + 并行后台 + 可见面）；**修订**
`harness`（新增「运行公共层」一条 requirement，并改准「工具循环」的并发执行口径）。逐条对应
`specs/` 下的 delta。

### A. 运行公共层：`RunSpec` + `RunContext`（`harness` capability，ADDED）

1. **一份运行契约**：`RunSpec` 描述一次运行的输入——触发来源（用户输入 / cron / 委托）、目标 vault、
   会话目标（交互会话 / 无人值守槽位 / 子运行）、投递内容、模型覆盖、工具白名单、预算、批准策略、
   用量归属、事件接收端。三类触发源都产出 `RunSpec`，MUST NOT 各自定义一套交接载荷。
2. **一个循环**：`run_turn_for` 的依赖面收敛为 `RunContext`（会话状态、事件 sink、工具定义、权限判定、
   批准等待、预算检查、留存写入）。交互会话、cron 运行槽位、子运行各提供一个实现，循环本体只有一份；
   差异显式化为契约枚举值，不是同一函数里的 `if origin == ...` 分支。
3. **装配与留存沿用既有实现**：系统上下文（三层 AGENTS + Skill 索引）、会话 wire 留存、权限管线不
   重写，只被 `RunSpec` 参数化。交互路径行为（事件形状、JSONL 形状、批准语义）MUST 逐字节不变。
4. **cron 接入同一契约**：cron 的运行槽位与 `cron:run` 交接载荷改为 `RunSpec` 的序列化形状；cron
   提案 §14 的回抽承诺由本 change 兑现。

### B. 子代理定义文件（`harness-subagents` ADDED）

1. **位置与作用域**：vault 级 `<vault>/.lumir/agents/**/*.md`（随 vault 走、可入版本控制；`.` 前缀
   沿用真源「应用私有配置」的命名惯例）+ 用户级 `<config_dir>/agents/**/*.md`（跨 vault 复用）。
   两者递归扫描；身份只看 frontmatter 的 `name`，子目录不参与身份。
2. **格式**：YAML frontmatter + Markdown 正文。必填 `name` / `description`；可选 `tools` / `model` /
   `max_turns` / `max_tokens` / `timeout_secs` / `background`。正文即子运行 system prompt 的**身份段**
   （替换固定身份段；AGENTS.md 三层与 Skill 索引仍照常装配，另加固定的「委托运行约束段」）。
3. **优先级与冲突**：vault 级同名覆盖用户级；同一层同名取字典序第一个并产 warning。定义非法（必填
   缺失、`tools` 含未知工具或 `task`、类型不符）时丢弃该定义并产 warning，其余定义照常生效。
4. **自动委派**：扫描结果里每个定义的 `name` + `description` 注入 `task` 工具描述，主 agent 据此
   自动委派；描述合计超过 15k token（按 `字符数 ÷ 4` 粗估）时产一条 warning。
5. **热加载**：每回合开头扫描一次并快照；磁盘改动在下次委派生效，无需重启。
6. **一个内建定义：`explore`**（Alex 裁决「同意」）。描述为只读探索（在 vault 里搜索、按路径枚举、
   读文件、加载 skill，产出结论摘要），`tools` = 只读三件，`model` = `inherit`，三闸取配置缺省。
   它与其他定义走同一条装载、清单注入与校验路径，**不是代码里的特殊分支**。命名冲突规则：用户级 /
   vault 级同名定义覆盖内建（参照系同款规则：自定义 Explore 覆盖内建），覆盖时产一条人话 warning
   （清单里只出现一次，生效的是自定义定义）；`[harness.subagents].enabled = false` 时内建与自定义
   定义一起退场。

### C. `task` 工具：第 9 件工具，编排类（`harness-subagents` ADDED）

1. **入参**：`agent`（定义名，必填）、`prompt`（自包含任务说明，必填）、`description`（一句话标签，
   必填）、可选 `model`（调用级覆盖，沿用参照系优先级）、可选 `resume`（续跑已有 run）、可选
   `background`（bool，缺省 false；定义 `background: true` 时强制后台）。
   工具集与闸值**不在调用参数里**——它们是定义文件的字段（参照系形态）。
2. **结果信封**：`{"ok": true, "status": "completed" | "partial" | "running", "agent": …, "run_id": …,
   "resumable": …, "summary": …, "usage": …, "model": …, "rounds": …, "denied_calls": …,
   "stopped_by": …}`；失败沿用 `{"ok": false, "code": …, "message": …}`。部分结果不是失败；
   后台启动成功时 `status=running`（结果稍后以自动化通知进入会话）。
3. **摘要上限**：回送摘要设字符上限，超出显式标 `truncated: true` 并保头尾，MUST NOT 静默截断。
4. **深度恰好 1 层**：子运行的工具定义恒不含 `task`；定义文件把 `task` 写进 `tools` 属定义非法
   （装载期丢弃 + warning）。不维护运行时深度计数、不提供深度配置项。
5. **并发**：同一条助手消息里的多个 `task` 调用**并行执行**（非 `task` 调用维持既有逐个执行）；
   前台调用阻塞本回合，后台调用立即返回 `status=running`。两者共用会话级并发上限。

### D. 子运行引擎：隔离、收紧、并发、收敛、续跑

1. **上下文隔离**：独立 system（定义正文 + 委托约束段 + 三层 AGENTS + Skill 索引）、空历史 + 任务
   prompt；MUST NOT 继承父会话历史；父会话上下文只收摘要，MUST NOT 收子运行过程消息（过程消息
   **可以**进可见面，见 §G，但不进任何 LLM 上下文）。
2. **工具集**：来自定义的 `tools`（allowlist）；缺省只读三件；未声明的工具不出现在子运行的工具定义
   里。**缺省收紧只是缺省值**：8 件工具任意子集都可声明（含写类与 `cli_run`）；是否放行仍走既有权限
   管线与用户选定的权限档（两道独立闸）。
3. **三重失控闸**：轮次 / token（累计 input+output）/ wall-clock；定义字段给值、夹取到
   `[harness.subagents]` 的上限。检查点为每次往返前、每个工具调用前；触顶停止开新往返并返回部分结果，
   **不追加「请总结」调用**。provider 侧配额耗尽 / 限流不算「内生产出」，按 `stopped_by=quota` 收敛，
   不自动重试。等待用户批准的时间不计入时间闸（等人的延迟不是模型的失控方向）。
4. **可续跑（resume）**：partial 结果带 `run_id` 与 `resumable=true`；`task(resume=run_id, prompt=…)`
   在同一子会话上继续，预算由定义重新给一段。子会话在内存里按 run id 保留（每父会话最多 4 个，LRU
   淘汰）；不进会话列表、不可跨重启恢复。API 中断但已有文本时同样返回 partial（`stopped_by=error`）。
5. **批准策略（Alex 裁决「确认」）**：子运行**继承**用户选定的权限档（不另立档、不因是子代理而放松
   或收紧）；ask 级调用照常给用户弹批准卡，卡片点名发起的子代理与 run。批准后该次调用执行；拒绝只
   废掉这一次调用并计数（`approval_denied`），子运行继续。会话级「本会话不再问」的记忆仍是同一份
   会话批准缓存（一个用户、一次会话、一份授权状态）。deny 规则 / 危险黑名单 / vault 写重定向照常生效。
6. **并发、后台与调度**：见 design §12（执行模型、事件交错、配额争用、取消与生命周期）。
7. **可见面与过程隔离**：子运行的过程（文本、思考、工具行）只进任务详情视图与诊断事件，MUST NOT
   进入父会话 transcript 或父会话的 LLM 历史；父会话只收 `task` 工具结果与后台完成通知。

### E. 用量归属与留存

1. **按模型分桶记账**（Alex：「不同的模型的 token 使用量没有任何意义」）。子运行的 usage **不**折叠
   进父会话的单一累计读数，而是按**模型 id 分桶**记账：每个模型一桶（input / cached / cache write /
   output / 往返样本数 / 运行段数），挂在父会话的读数面上供面板与诊断读取。父会话自己的 ctx% 不受
   子运行影响（子运行的 token 从不进入父会话的请求）；cache% 也不再被跨模型混算——父会话读数只算
   父会话自己的往返，子运行各模型各算各的。
2. **配额不分桶**：分桶是读数口径，不是配额口径。所有桶都计入同一 provider 配额，`[harness.subagents]`
   的预算与并发上限是唯一的机制侧闸。
3. **可重算**：父会话 JSONL 每段一条 `subrun` sidecar（run id、segment、agent、模型、终态、usage、
   审计指针）；恢复重算按模型桶累加该类记录，live 与恢复读数 MUST 逐字段相等（顺序无关的求和）。
4. **子运行审计流水**：`<config_dir>/harness/subruns/<vault 稳定 id>/<run_id>.jsonl`，同一 run 的多个
   segment 追加同一文件；不进 `sessions/`、不进会话列表、不可恢复。

### F. 配置与开关（`[harness.subagents]`）

`enabled`（kill switch，**缺省 true**——关闭后 `task` 不注册、定义文件保留不动）、`max_turns`（20）、
`max_tokens`（200000）、`timeout_secs`（300）——三者同时是定义缺省值与上限；`max_subruns_per_turn`
（8，按父回合计数）；`max_concurrent`（4，会话级同时运行的子运行数上限，前台与后台合计）。逐项
schema 校验、非法项人话 warning + 夹取/缺省回落（ADR 0002 第 5 条）；每键消费者见 design §14。

### G. UX：用户可见面（Alex 裁决「需要出原型」）

原型：[`design/prototypes/subagents-tasks.html`](../../../design/prototypes/subagents-tasks.html)
（页面内置可点击控制面板，全部合成数据，`?panel=0` 关面板供截图；场景 / 主题 / 面板位置全部点击
可达）。用户可感知的行为，机制侧承诺：

1. **任务面板**：agent 面板内、composer 上方一条常驻区（「任务 · N 个运行中」），**只列运行中 /
   等待批准 / 后台运行的 run**：agent 名、一句话 description、状态、轮次与 tokens 读数（模型在详情
   里）。行可展开看步骤流水（工具名 + 参数摘要 + 计数器），运行中的行可「停止」。历史任务不逐行留在
   面板——全部收敛后任务区收敛为一行摘要（「本次会话 N 个已完成 · M 个部分结果」），每个 run 的详情
   与摘要从 transcript 的 `task` 工具行点开。
2. **后台任务**：回合结束后仍在跑的行常驻面板（带「后台」标记）；完成时结果以一条**自动化通知**
   消息落在 transcript（样式与用户消息区分），并在面板行留下完成态。
3. **批准卡透传**：子代理的 ask 级调用在面板对应行内就地展开批准卡（预览 + 判定依据 + 发起的
   agent 与 description），面板标题同时标出「N 个等待批准」；批准后子运行继续，拒绝只拒该次调用。
   父会话自己的批准卡仍在 transcript 的工具行下（不变）。
4. **按模型用量**：任务区的「子任务用量（按模型）」每个模型一行（input / cached / output / 运行
   段数）。父会话控制行的 ctx% / cache% 读数不变，不掺入子运行数字。
5. **子代理清单**：面板内一个只读折叠列表（名字、description、工具数、模型、来源：内建 / vault /
   用户），让「有哪些子代理」可发现；不做定义文件的 UI 编辑器（v1 仍是文本文件）。
6. **关停**：`enabled = false` 时 `task` 不注册、面板任务区不出现（空态不占位）；定义文件与内建
   `explore` 保留。

### H. 与 cron 的接入关系

两个 change 无代码硬依赖；建议公共层随本 change 先落，cron 实现按 `RunSpec` 接入。若 cron 先开工，
其交接载荷直接按 `RunSpec` 形状写，公共层由本 change 补齐；**不允许两套交接形状并存**。配额与请求
调度是全进程共用的（cron 运行、子运行、交互回合共用一个 provider 闸），见 design §12.3。

## 能力边界（对「能力极度受限」疑虑的正面回答）

- **缺省收紧不是天花板**：`tools` 省略 = 只读三件，只是缺省值。定义可以声明 8 件工具的任意子集，
  含写类（`vault_patch` / `vault_create` / `vault_move` / `vault_delete`）与 `cli_run`；声明之后
  是否放行由权限管线与用户选定的档位决定（与主会话同一套判定）。
- **列目录可以**：`vault_search` 带 `path_glob` 路径过滤（如 `项目/**`），即可枚举目录下的文件。
- **联网搜索是 harness 本体的缺口，不是子代理被额外削掉的**：当前 8 件工具里没有 web 类工具，
  主会话同样没有（`src-tauri/src/harness/tools.rs:100-109`）。现时 workaround 是 `cli_run` 调
  `tvly` 这类 CLI（受权限管线与批准闸约束，与主会话完全同权）。补 web 工具是独立的能力扩张，须经
  ADR 0007 裁决，另立 change；本提案不预造占位工具。

## Non-goals

- **不做递归派生**：深度固定 1 层；`task` 不可被授予子代理；无深度配置项。
- **不做子运行的可恢复会话**：审计流水留档；内存保留只为同会话内的 resume，重启即失效；不进会话列表。
- **不做子运行过程进 LLM 上下文**：过程只进任务详情视图与诊断，MUST NOT 进父会话 transcript 正文或
  父会话历史（可见 ≠ 进上下文）。
- **不做后台任务的自动续跑回合**：完成通知落在会话里，模型在下一次用户发言时看到（已裁决，见设计取舍 14）。
- **不做 agent teams / 子代理之间互相通信**：并行是「同一回合的兄弟任务」，没有消息总线，没有共享
  黑板；子运行之间互不可见。
- **不做定义文件的 UI 编辑器**：v1 定义即文本文件，UI 只提供只读清单（§G.5）。
- **不采纳 `permissionMode` / `disallowedTools` / `skills` 预载 / `isolation(worktree)` /
  `omitClaudeMd` / `hooks` / `mcpServers` / `memory` / `effort`**：理由见参照系末节。
- **不做跨会话成本账本与配额管理**：只有单次运行的三重闸、单回合委派次数上限与会话级并发上限。
- **不做附件 / 图片入参**：v1 的 `prompt` 只有文本。
- **不做 `task` 的自动重试**：失败或触顶由父 agent 决定重试或 resume；provider 配额错误不自动重试。
- **不做环境变量层的模型覆盖**：模型解析只认调用参数 > 定义 > `inherit`。
- **不做子代理级别的独立权限档**：子运行继承会话档（§D.5）。
- **不做 `task` 的跨会话后台**：后台 run 的生命周期止于父会话（重置 / 恢复 / 切会话 / 退出即中止）。

## 降级路径（反向扳机已撤回）

**反向扳机（连续零使用即删除能力）已由 Alex 裁决撤回**（原话：「去掉反向扳机。也把 cron 的反向扳机
去掉。」），本节不再定义任何删除时限或零使用判据。降级只走下面的「人按周检查后改配置或另立 change」：

1. **触顶率过高**（最近 10 段中 ≥5 段 `stopped_by` 非空）⇒ 先查任务颗粒度，再调高 `[harness.subagents]`
   的上限（定义值受它夹取）。
2. **完成率持续偏低**（人按周检查后的判断，不设时限判据）⇒ 考虑走后续 change 把 `tools` 白名单限到
   只读三件；落地前先用 vault 的 AGENTS.md 约定「委派只做调研」。
3. **写类委派看起来没有必要**（人按周检查定义与使用情况后的判断，不设零使用判据）⇒ 考虑走后续
   change 删除写工具声明能力。
4. **并发压力过大**（`max_concurrent` 长期顶格且大量排队）⇒ 先降上限；仍不够则改调度（请求级公平性
   另立 change），MUST NOT 靠提高上限硬扛。
5. **紧急关停**：`[harness.subagents].enabled = false` 后 `task` 不再注册（模型看不见）、面板任务区
   不出现，定义文件与内建 `explore` 保留不动。

## 观测：怎么知道用了 / 有效 / 出问题怎么发现

诊断事件（本地 JSONL，`~/.config/lumir/logs/`，不联网、不外发）：

- `subagent_started`：run id、segment、父会话 id、`agent`、`description`、模型、工具集、三项闸值、
  `background`。
- `subagent_progress` / `subagent_step`：可见面事件（面板读数与步骤行），节流产出，只带读数与
  人话化参数摘要。
- `subagent_finished`：run id、segment、`agent`、`status`（completed / partial / failed / aborted）、
  `stopped_by`（rounds / tokens / time / quota / error / null）、`rounds`、三项 token 读数、模型、
  `denied_calls`、`duration_ms`、`summary_chars`、审计文件路径。
- `subagent_notified`：后台结果通知落进父会话时一条（run id、是否当回合送达）。
- `subagent_rejected`：`reason`（disabled / agent_not_found / run_not_resumable / run_busy /
  agent_mismatch / subrun_limit / concurrency_limit / model_not_configured / empty_prompt）。
- `subagent_catalog_large`：描述合计超过阈值时一条（含估算 token 数）。

**怎么知道用了**：

```bash
rg -c '"event":"subagent_finished".*"status":"(completed|partial)"' ~/.config/lumir/logs/
```

**怎么知道有效**：四个读数——① 隔离效果：子运行 `input_tokens`（吃进的材料量）对比 `summary_chars`
（还给主会话的量），量级相当说明这次委派没省任何东西；② 完成率 `completed / started`；③ 触顶分布
（`stopped_by` 按值计数，quota 单独看——它指向配额而不是任务颗粒度）；④ 并行的真实收益：同回合并行
的 run 数与各自 `duration_ms` 的重叠程度（并行若没缩短墙钟时间，说明瓶颈在配额而不是任务本身）。

**出问题怎么发现**：子运行失败 / 触顶 / 被拒都有终态工具结果（不出现「永远转圈」）；每段有审计流水，
`subagent_finished` 带路径；定义装载问题（非法定义、描述超阈值、未知字段、覆盖内建）各产一条人话
warning；配置非法项夹取后照常启动；真机验收覆盖定义发现、自动委派、并行、后台、批准透传、resume、
三闸、深度与开关（tasks §8）。

## Impact

- **影响的 specs**：
  - `harness-subagents`：ADDED（新 capability）——定义文件与内建 `explore`、`task` 工具、工具集收紧、
    并行与后台、三重闸与部分结果、resume、批准透传、用量按模型分桶、留存与诊断、模型选择、配置节、
    任务面板可见面。
  - `harness`：ADDED「运行公共层」；MODIFIED「工具循环」（清单改为 8 件 vault 操作工具 + 1 件编排
    工具 `task`，并写明同回合多个 `task` 并行、子运行不持有它）。
- **影响的代码/系统**（概述，细节见 design.md）：
  - `src-tauri/src/harness/agents.rs`（新）：定义扫描（两目录递归）、内建 `explore` 与覆盖规则、
    YAML frontmatter 解析、校验、优先级、清单与 token 估算。
  - `src-tauri/src/harness/run.rs`（新）：`RunSpec` / `RunContext` / `RunOutcome` 与循环入口。
  - `src-tauri/src/harness/turn.rs`：循环依赖面收敛为 `RunContext`；工具定义按上下文生成（`task`
    描述含 agent 清单）；同回合多个 `task` 的并行编排与按调用序回填结果。
  - `src-tauri/src/harness/subagents.rs`（新）：子运行宿主（每 run 一线程）、三重闸、收敛与
    resume 保留、后台投递、结果信封。
  - `src-tauri/src/harness/scheduler.rs`（新）：会话级并发上限 + per-provider 请求闸（配额争用）。
  - `src-tauri/src/harness/tools.rs`：新增 `task` 工具；工具清单常量与文件头按「8 + 1」改准。
  - `src-tauri/src/harness/approval.rs` / `session.rs`：待批请求由单槽改为按 run 的列表（含 source
    元数据）；子运行的 ask 挂到父会话同一张表；快照字段同步。
  - `src-tauri/src/harness/session.rs`：按模型分桶的用量表与 `subrun` sidecar；恢复重算纳入。
  - `src-tauri/src/harness/jsonl.rs`：`subruns/<vault 稳定 id>/` 审计目录、后台结果通知记录。
  - `src-tauri/src/harness/llm.rs`：`client_at` 模型覆盖；请求闸接入；mock 父子游标（并行时按 run
    分配脚本游标）。
  - `src-tauri/src/config.rs`：`[harness.subagents]` 节（含 `max_concurrent`）+ 校验 + ts-rs 导出。
  - `src-tauri/src/logging.rs`：七个诊断事件进白名单。
  - `src/harness-panel.ts`：任务面板（运行行、详情、停止、按模型用量、子代理清单）、批准卡渲染扩展。
  - `src-tauri/Cargo.toml`：YAML 解析依赖（`serde_yaml` 已 deprecated；候选 `yaml-rust2` 0.13 /
    `saphyr` 0.2，均 2026 年在维护；只解析标量 + 字符串列表子集）。
  - `src/bindings/**`、`docs/specs/config-reference.md`、`docs/specs/subagent-definitions.md`（新，
    定义格式参考）、`scripts/acceptance/scenarios/**`、`design/prototypes/subagents-tasks.html`。
- **关联约束**：
  - ADR 0007 Revisit 条件：subagent 转实际需求须 Alex 显式裁决后修订 ADR；实现前置 = ADR 0007 修订
    （新增「编排工具」分类与 9 件工具清单）。
  - ADR 0002 第 5 条（配置即数据 + schema 校验）：`[harness.subagents]` 按既有解析模型；定义文件是
    vault 侧的配置，校验口径同源（非法项丢弃 + 人话 warning）。
  - ADR 0002 第 6 条（性能合同）：定义扫描只在回合开始做一次目录读，不落冷启动与 keypress 路径。
  - ADR 0002 第 7 条（核心模块不耦合 tauri）：扫描 / 校验 / 解析 / 调度纯 Rust，可单测。
  - ADR 0003 第 3 条（永不改写源文件格式）：子运行写入仍走既有工具与权限管线，不新增写入通道。
  - REVIEW.md「值或开关声明了却没有消费者」：`[harness.subagents]` 每键在 design §14 指明消费者。
  - AGENTS.md「变更默认直接切断」：无兼容层（`task` 是新工具、定义目录是新面）；批准快照字段由
    `pending_approval` 改为列表时一次迁净，不留双形状。
  - AGENTS.md 信息卫生：全部制品、原型与验收 fixture 只用 `<vault>` / `<config_dir>` 占位与合成数据，
    无真实路径与真实内容。

## 设计取舍（节点 1 裁决点，逐条可否决）

1. **公共层按 `RunSpec` + `RunContext` 回抽**（推荐）。抽「一次运行的输入契约」与「循环的依赖面」，
   交互会话 / 无人值守 / 子运行各给一个实现；cron 的运行槽位改为 `RunSpec` 序列化形状。备选：不抽、
   在 `run_turn_for` 内按 origin 分支——差异会长进同一个函数（同函数分叉 = 假共享），预算、用量与
   批准策略各自演化。design §3 对「不抽」逐条反驳。
2. **新增第 9 件工具 `task`，工具清单重述为「8 件 vault 操作工具 + 1 件编排工具」**（推荐）。这是
   ADR 0007 Revisit 条件命中的点，实现前须修订 ADR。参照系把该工具的形状定为「按名字委派」
   （对应 Claude Code 的 Agent 工具），本稿采纳。备选：做成 `/task` 命令——不是模型可自主调用的
   委派，与真源「`task` 工具」形态不符。
3. **子代理定义文件 v1 就进（vault 级 + 用户级）**（推荐）。理由：① 参照系的核心是定义，只有
   `task(prompt, tools, model…)` 的内联参数面是本仓自定义物，正是「无需自定义」要消掉的部分；② 定义
   文件与真源「策略进 vault 文档」同构，可版本化、可评审；③ 用户级只是同一扫描器的第二个根，边际
   成本低，且「跨 vault 复用调研 agent」是首场景的自然需求。位置：vault `<vault>/.lumir/agents/`、
   用户 `<config_dir>/agents/`（复用既有配置根，不新建 home dotdir）。备选一：v1 只做 vault 级、
   用户级 v2——更小，但跨 vault 复用得靠复制文件；备选二：整体推迟到 v2，v1 只做内联参数 `task`
   ——形态会被推翻，等于先写一版自定义物再改回成熟形态，不推荐。
4. **自动委派 + 显式点名都在 v1**（推荐）。清单（名字 + 描述）注入 `task` 工具描述，主 agent 据此
   自动委派；用户在对话里点名任何定义即可显式调用。理由：这是定义文件的价值所在（新场景 = 新定义，
   代码零改动）；描述合计超 15k token 时产 warning（粗估）。备选：v1 仅显式点名——更保守，但
   `description` 退化为注释、模型不知道自己能用什么，等于保留了一半自定义形态。
5. **子运行默认工具集 = 只读三件**（推荐）。调研类默认只读是真源「已倾向」项。这是**对参照系的
   刻意偏离**：Claude Code 省略 `tools` 等于继承全部工具，Lumir 省略等于只读三件。备选：跟随参照系
   全量继承——等于默认放开写与 CLI，与真源裁决冲突，不采纳。
6. **写入 = 工具集声明 + 权限管线双重闸**（推荐）。声明只决定可见性，放行仍由权限管线与用户选定档位
   判定；子运行与主会话同权，不另立档。默认 `vault_write` 档下 `vault_patch` / `vault_create` /
   `vault_move` 自动放行；`vault_delete` 与 `cli_run` 写命令该档需批准 → 透传批准卡（见 7）。备选：
   声明即视为批准（不推荐：把「可见」偷换成「批准」）。
7. **【已裁决·推翻原案】ask 级调用透传批准卡**（Alex：「确认。」）。子运行继承会话权限档，ask 浮到
   父会话批准卡并点名发起者；批准则执行，拒绝只废该次调用并计数，子运行继续。会话级「本会话不再问」
   复用同一份批准缓存（一个用户、一次会话、一份授权状态）。因此待批请求由「会话内单槽」改为按 run
   的列表，面板按 ask 时间排队呈现（design §8.3、§12.2）。备选（原案，已否决）：一律拒绝并计数
   ——能力被砍掉一半，且用户看不出「为什么子代理说没权限」。
8. **子运行不留可恢复会话：审计流水 + 父会话 `subrun` sidecar + 内存保留（供 resume）**（推荐）。
   审计 `<config_dir>/harness/subruns/<vault id>/<run_id>.jsonl`；父会话 sidecar 承担重算与指针；
   内存保留每父会话最多 4 个 run（LRU），重启即失效。备选一：子会话进 `sessions/`（历史列表被淹没）；
   备选二：完全不落盘（失败无法复盘）；备选三：不保留内存、resume 只限同一回合（能力弱于参照系）。
9. **模型解析序：调用参数 > 定义 `model` > `inherit`**（推荐，照参照系）。定义里的未知模型 id 按配置
   约定 warning + 回落 `inherit`（定义不丢）；调用参数里的未知 id 直接 `model_not_configured`
   （调用方是模型，静默回落会训练出错误习惯）。不做环境变量层。备选：只允许 `inherit`——放弃
   「便宜档跑吞吐」的真源策略。
10. **闸值在定义文件里、夹取到配置上限**（推荐）。`max_turns` / `max_tokens` / `timeout_secs` 是定义
    字段，`[harness.subagents]` 给缺省兼上限；调用参数不开放闸值覆盖（照参照系：`maxTurns` 是定义
    字段）。备选：保留逐次入参——与参照系不符，且模型每次都要重述策略。
11. **触顶语义 = partial + 可 resume**（推荐，照参照系）。三闸任一触顶都产 `status=partial` +
    `resumable=true` + `run_id`；resume 以同一子会话继续、预算重新给一段；API 中断但已有文本同样
    partial（`stopped_by=error`）。备选：触顶即终态、重试从头开始——材料要重读一遍，成本更高。
12. **深度限 1 层的实现口径 = 不授予 `task` 工具（白名单即机制）**（推荐，照参照系的机制、不照它的
    默认值）。不维护运行时深度计数、不提供配置项；定义里写 `task` 属定义非法（装载期丢弃 + warning）。
    结果与真源一致（仍恰好 1 层），只是不再用计数表达。备选：保留深度计数 + 调用期 `depth_exceeded`
    ——多一处状态，且与「工具白名单即机制」重复表达同一约束。
13. **【已裁决·推翻原案】并行 + 后台运行**（Alex：「我反对。我希望支持后台运行和并行。」）。同一回合
    多个 `task` 调用并行、`background=true`（或定义 `background: true`）让 run 跨越回合继续跑；
    并发上限进 `[harness.subagents].max_concurrent`。事件交错与配额争用作为设计节正面处理（design
    §12）。备选（原案，已否决）：串行前台、留待真实数据。
14. **后台完成不自动起回合**（已裁决「全部采纳」，2026-10-18）。**定为**：后台 run 结束时结果作为一条
    自动化通知落进父会话 transcript 与 wire 记录；父会话空闲时**不**自动发起一回合，模型在下一次
    用户发言时看到。理由：无人注视时消耗配额是比「晚一点知道结果」更重的代价。否决的备选：照参照系
    自动起通知回合——响应更及时，但用户离开时也会烧 token。
15. **并发上限缺省 4 + 请求级闸 + 父优先**（已裁决「全部采纳」，2026-10-18）。**定为**：`max_concurrent`
    缺省 4（域 1–16）；请求级闸为每 provider 一个信号量（`max_concurrent + 1` 个许可，留一个给父会话
    自己的往返），子请求 FIFO，父请求优先——避免父被自己的子任务饿死。否决的备选：无请求级闸、只靠
    run 级上限（`cli_run` 等工具不占 LLM 请求，但 N 路同时发请求仍会打满 provider 限流）。
16. **待批请求改为按 run 的列表**（已裁决「全部采纳」，2026-10-18；7 的直接后果）。**定为**：会话快照
    字段由 `pending_approval` 单值改为 `pending_approvals` 数组（元素带 `source`：交互 / 子运行 +
    agent + run_id）；前端一次渲染多张卡，按 ask 时间排序；停止回合时全部收回。否决的备选：串行化
    批准（第二个 ask 在内部排队，界面上一次只见一张卡）——实现更小，但「谁在等」被藏起来，与可见面
    方向相反。
17. **任务面板位置：agent 面板内、composer 上方**（已裁决「全部采纳」，2026-10-18）。**定为**：任务区
    挂在 composer 上方，与既有控制行（ctx% 读数）同一纵向带，不新增侧栏、不改主内容区布局；代价是
    348px 窄栏里每行信息必须克制（agent 名 + 一句话 + 状态 + 一个读数，详情展开看）。否决的备选：
    独立「任务」视图 / 新增侧栏——信息容量大，但把「正在跑什么」藏进二级入口。
18. **内建 `explore` 的覆盖告警**（已裁决「全部采纳」，2026-10-18）。**定为**：自定义定义覆盖内建时
    产一条 warning 并让清单只出现一次。理由：覆盖是合法意图（参照系同款规则），但「我写的 explore
    没生效」与「生效了但被覆盖」必须在诊断里分得清。否决的备选：静默覆盖（照参照系）——更安静，但
    排查成本高。

以上 18 条均为设计取舍。第 7、13 条已按 Alex 裁决改写；第 14–18 条已由 Alex 裁决「全部采纳。」并按
既定口径落文（见裁决留痕「节点 1 后续裁决」）；其余各条仍待节点 1 通读时的否决意见。
节点 1 通过前不进入实现。
