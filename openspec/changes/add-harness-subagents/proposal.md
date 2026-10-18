# Proposal: Subagents（`task` 工具 + 子代理定义）——委托式 harness 运行与运行公共层回抽

- Change ID: add-harness-subagents
- 日期: 2026-10-18（同日按 Alex 的参照系意见修订）
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
> 移到「定义文件」），不改约束本身**：深度仍恰好 1 层、默认仍收紧、用量仍归主会话、三重闸仍全在。
>
> **统一抽象（Alex 认可的次序）**：「第一个原语（cron）带最小抽象落地，第二个原语（Subagents）
> 出现时回抽公共层。因此本提案必须正面处理『触发 → 上下文装配 → 工具循环 → 留存』公共层。」
> 该承诺的书面落点是评审中的 change `add-cron-runtime-daemon` 重构稿 design §14：「Subagents 落地
> 时 MUST 回抽公共层『触发 → 装配 → 运行 → 留存』，把 cron 的触发源与 Subagents 的委托触发一起
> 接入该层，MUST NOT 让 Subagents 另写一套调度。」**本 change 是这条承诺的兑现点。**
>
> **调度策略（真源「调度策略」节，供节点 1 参考）**：① 能确定性计算的不花 token；② 按产物纠错成本
> 分档（一次性产物便宜档，累积产物强档或便宜档 + 批准闸）；③ 大体量遍历拆两层；④ 吞吐与判断拆阶段。
> 错误方向不对称：漏记可补、错记污染，写入偏保守。**这些是调用方的策略，不是机制的知识**——定义文件
> 是策略的载体，机制只读它、校验它、执行它。
>
> **ADR 前置**：ADR 0007 的 Revisit 条件写明「探针能力清单需要扩张（如后台任务、subagent 从架构约束
> 转为实际需求）→ Alex 显式裁决后修订本 ADR，不允许在 OpenSpec change 中静默扩张」。2026-10-18 的
> 裁决已把 subagent 从「架构约束」转为「实际需求」；ADR 0007 的修订（工具集边界新增「编排工具」一类）
> 列为本 change 的实现前置，见 Impact 与 tasks §0。

## 参照系：与 Claude Code subagents 的逐项对照

**vision 原设计与成熟实践收敛的部分不变，本节只处理借鉴增量。** 收敛项一句话带过：独立上下文窗口、
只回摘要；工具集 allowlist 收紧；模型档位（调用参数 > 定义 > `inherit`）；用量计入主会话同一上限；
轮次闸触顶返回 partial。这五条本提案照旧，不因参照系重开讨论。

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

### 刻意不同（视真源已裁决心与产品面为更大约束）

| 维度 | Claude Code 的做法 | 本稿做法与理由 |
|---|---|---|
| `tools` 缺省 | 省略 = 继承子代理可用的全部工具（含 `Agent`，因此默认可嵌套） | **省略 = 只读三件**（`vault_read` / `vault_search` / `skill_load`）。真源已裁决「工具集默认收紧、写入显式声明」；全量继承等于默认放开写与 CLI，不采纳 |
| 权限模式 | 定义可写 `permissionMode`（受主会话模式约束） | v1 不采纳：继承用户选定的会话档位。vault 里的定义文件不得改变用户设定的权限边界；要收紧用 `tools` 表达即可 |
| 内建子代理 | 内建 Explore / Plan | 不做：本产品没有「代码库探索」这一特定场景；内建名字还会与用户定义撞名。只读三件的通用定义已覆盖同一用途 |
| 并发 | 后台子代理、并发上限、agent teams | v1 全不做：串行、前台、无后台运行（真源首场景不需要并行；并行涉及事件交错与配额争用，留待真实数据） |

### 不采纳的定义字段（逐条给理由）

`disallowedTools`（本稿默认不是全量继承，deny-list 无适用面）；`permissionMode`（见上）；`skills`
预载（Skill 索引已装配、`skill_load` 可运行时加载）；`initialPrompt`（正文承担）；`background`
（v1 串行）；`isolation: worktree`（Lumir 不是 git 工作树产品）；`omitClaudeMd` 对应物（AGENTS.md
三层是本产品的基础约定，始终装配）；`hooks` / `mcpServers` / `memory` / `effort` /
`autoCompactWindow`（无对应机制或不适用）。这些字段出现在定义里时产一条 warning 并忽略，不静默吞掉。

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

## What Changes

两个 capability：**新增** `harness-subagents`（定义文件 + 委托运行）；**修订** `harness`（新增「运行
公共层」一条 requirement，并改准「工具循环」的工具清单）。逐条对应 `specs/` 下的 delta。

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
   `max_turns` / `max_tokens` / `timeout_secs`。正文即子运行 system prompt 的**身份段**（替换固定
   身份段；AGENTS.md 三层与 Skill 索引仍照常装配，另加固定的「委托运行约束段」）。
3. **优先级与冲突**：vault 级同名覆盖用户级；同一层同名取字典序第一个并产 warning。定义非法（必填
   缺失、`tools` 含未知工具或 `task`、类型不符）时丢弃该定义并产 warning，其余定义照常生效。
4. **自动委派**：扫描结果里每个定义的 `name` + `description` 注入 `task` 工具描述，主 agent 据此
   自动委派；描述合计超过 15k token（按 `字符数 ÷ 4` 粗估）时产一条 warning。
5. **热加载**：每回合开头扫描一次并快照；磁盘改动在下次委派生效，无需重启。

### C. `task` 工具：第 9 件工具，编排类（`harness-subagents` ADDED）

1. **入参**：`agent`（定义名，必填）、`prompt`（自包含任务说明，必填）、`description`（一句话标签，
   必填）、可选 `model`（调用级覆盖，沿用参照系优先级）、可选 `resume`（续跑已有 run）。
   工具集与闸值**不在调用参数里**——它们是定义文件的字段（参照系形态）。
2. **结果信封**：`{"ok": true, "status": "completed" | "partial", "agent": …, "run_id": …,
   "resumable": …, "summary": …, "usage": …, "rounds": …, "denied_calls": …, "stopped_by": …}`；
   失败沿用 `{"ok": false, "code": …, "message": …}`。部分结果不是失败。
3. **摘要上限**：回送摘要设字符上限，超出显式标 `truncated: true` 并保头尾，MUST NOT 静默截断。
4. **深度恰好 1 层**：子运行的工具定义恒不含 `task`；定义文件把 `task` 写进 `tools` 属定义非法
   （装载期丢弃 + warning）。不维护运行时深度计数、不提供深度配置项。

### D. 子运行引擎：隔离、收紧、收敛、续跑

1. **上下文隔离**：独立 system（定义正文 + 委托约束段 + 三层 AGENTS + Skill 索引）、空历史 + 任务
   prompt；MUST NOT 继承父会话历史；父会话只收工具结果里的摘要，MUST NOT 收子运行过程消息。
2. **工具集**：来自定义的 `tools`（allowlist）；缺省只读三件；未声明的工具不出现在子运行的工具定义
   里。是否放行仍走既有权限管线与用户选定的权限档（两道独立闸）。
3. **三重失控闸**：轮次 / token（累计 input+output）/ wall-clock；定义字段给值、夹取到
   `[harness.subagents]` 的上限。检查点为每次往返前、每个工具调用前；触顶停止开新往返并返回部分结果，
   **不追加「请总结」调用**。
4. **可续跑（resume）**：partial 结果带 `run_id` 与 `resumable=true`；`task(resume=run_id, prompt=…)`
   在同一子会话上继续，预算由定义重新给一段。子会话在内存里按 run id 保留（每父会话最多 4 个，LRU
   淘汰）；不进会话列表、不可跨重启恢复。API 中断但已有文本时同样返回 partial（`stopped_by=error`）。
5. **批准策略**：子运行 MUST NOT 挂在人工批准上；ask 级调用一律以 `approval_unavailable` 拒绝并计数，
   且 MUST NOT 复用父会话批准缓存。deny / 危险黑名单 / vault 写重定向照常生效。
6. **串行执行**：一次助手消息里的多个 `task` 调用按既有「tool_calls 逐个执行」口径串行跑。

### E. 用量归属与留存

1. **用量归主会话**：每个运行段（首次或 resume）结束（任何终态）时把 usage 一次性折叠进父会话累计器
   （input / cached / cache write / 样本数）。父会话 `ctx%` 不受折叠影响；折叠后 cache% 是混合读数。
2. **可重算**：父会话 JSONL 每段落一条 `subrun` sidecar（run id、segment、agent、模型、终态、usage、
   审计指针）；恢复重算纳入该类记录，live 与恢复读数 MUST 相等。
3. **子运行审计流水**：`<config_dir>/harness/subruns/<vault 稳定 id>/<run_id>.jsonl`，同一 run 的多个
   segment 追加同一文件；不进 `sessions/`、不进会话列表、不可恢复。

### F. 配置与开关（`[harness.subagents]`）

`enabled`（kill switch）、`max_turns`（20）、`max_tokens`（200000）、`timeout_secs`（300）——三者同时是
定义缺省值与上限；`max_subruns_per_turn`（8，按父回合计数）。逐项 schema 校验、非法项人话 warning +
夹取/缺省回落（ADR 0002 第 5 条）；每键消费者见 design §14。

### G. 与 cron 的接入关系

两个 change 无代码硬依赖；建议公共层随本 change 先落，cron 实现按 `RunSpec` 接入。若 cron 先开工，
其交接载荷直接按 `RunSpec` 形状写，公共层由本 change 补齐；**不允许两套交接形状并存**。

## Non-goals

- **不做并行 / 后台子代理**：v1 串行、前台；没有 background、并发上限、agent teams。
- **不做递归派生**：深度固定 1 层；`task` 不可被授予子代理；无 `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`
  对应配置项。
- **不做子运行的可恢复会话**：审计流水留档；内存保留只为同会话内的 resume，重启即失效；不进会话列表。
- **不做人工批准透传**：ask 级调用直接拒绝并计数（裁决点 5）。
- **不做子运行过程流式上屏**：只保留 `task` 工具卡（agent + description + 终态）与摘要。
- **不采纳 `permissionMode` / `disallowedTools` / `skills` 预载 / `background` / `isolation(worktree)` /
  `omitClaudeMd` / `hooks` / `mcpServers` / `memory` / `effort`**：理由见参照系末节。
- **不做内建子代理（Explore / Plan）**：用户可自建同名定义；机制不内置任何定义。
- **不做定义文件的 UI 编辑器 / 列表面板**：v1 定义即文本文件，用户直接编辑；发现结果只进工具描述与
  诊断事件。
- **不做跨会话成本账本与配额管理**：只有单次运行的三重闸与单回合的委派次数上限。
- **不做附件 / 图片入参**：v1 的 `prompt` 只有文本。
- **不做 `task` 的自动重试**：失败或触顶由父 agent 决定重试或 resume。
- **不做环境变量层的模型覆盖**：模型解析只认调用参数 > 定义 > `inherit`。

## 反向扳机与降级路径

**反向扳机（与 cron 同口径：连续 4 周零使用即删除）**：从本 change 合并之日起连续 4 周，
`subagent_finished` 事件（含 completed 与 partial）累计为 0 ⇒ 走新 change 删除本能力：`task` 工具、
子运行引擎、定义文件扫描、`[harness.subagents]` 配置节与审计流水。运行公共层**不随之下线**（已被
cron 消费，按届时实际消费者去留）。

**降级路径（不自动调参，由人按周检查后改配置或另立 change）**：

1. **触顶率过高**（最近 10 段中 ≥5 段 `stopped_by` 非空）⇒ 先查任务颗粒度，再调高 `[harness.subagents]`
   的上限（定义值受它夹取）。
2. **完成率长期偏低**（连续 4 周 `completed / started < 50%`）⇒ 走后续 change 把 `tools` 白名单限到
   只读三件；落地前先用 vault 的 AGENTS.md 约定「委派只做调研」。
3. **写类委派零使用**（连续 4 周无任何 `subagent_finished` 的定义含写类 / `cli_run`）⇒ 走后续 change
   删除写工具声明能力。
4. **紧急关停**：`[harness.subagents].enabled = false` 后 `task` 不再注册（模型看不见），定义文件保留
   不动。

## 观测：怎么知道用了 / 有效 / 出问题怎么发现

诊断事件（本地 JSONL，`~/.config/lumir/logs/`，不联网、不外发）：

- `subagent_started`：run id、segment、父会话 id、`agent`、`description`、模型、工具集、三项闸值。
- `subagent_finished`：run id、segment、`agent`、`status`（completed / partial / failed / aborted）、
  `stopped_by`（rounds / tokens / time / error / null）、`rounds`、三项 token 读数、`denied_calls`、
  `duration_ms`、`summary_chars`、审计文件路径。
- `subagent_rejected`：`reason`（disabled / agent_not_found / run_not_resumable / agent_mismatch /
  subrun_limit / model_not_configured / empty_prompt）。
- `subagent_catalog_large`：描述合计超过阈值时一条（含估算 token 数）。

**怎么知道用了**：

```bash
rg -c '"event":"subagent_finished".*"status":"(completed|partial)"' ~/.config/lumir/logs/
```

**怎么知道有效**：三个读数——① 隔离效果：`input_tokens`（子运行吃进的材料量）对比 `summary_chars`
（还给主会话的量），量级相当说明这次委派没省任何东西；② 完成率 `completed / started`；③ 触顶分布
（`stopped_by` 按值计数）：集中 token / 轮次 = 预算与颗粒度不匹配，集中时间 = 范围过大。

**出问题怎么发现**：子运行失败 / 触顶 / 被拒都有终态工具结果（不出现「永远转圈」）；每段有审计流水，
`subagent_finished` 带路径；定义装载问题（非法定义、描述超阈值、未知字段）各产一条人话 warning；
配置非法项夹取后照常启动；真机验收覆盖定义发现、自动委派、resume、三闸、深度与开关（tasks §8）。

## Impact

- **影响的 specs**：
  - `harness-subagents`：ADDED（新 capability）——定义文件、`task` 工具、工具集收紧、三重闸与部分
    结果、resume、批准策略、上下文隔离、用量归属、留存与诊断、模型选择、配置节。
  - `harness`：ADDED「运行公共层」；MODIFIED「工具循环」（清单改为 8 件 vault 操作工具 + 1 件编排
    工具 `task`，并写明子运行不持有它）。
- **影响的代码/系统**（概述，细节见 design.md）：
  - `src-tauri/src/harness/agents.rs`（新）：定义扫描（两目录递归）、YAML frontmatter 解析、校验、
    优先级、清单与 token 估算。
  - `src-tauri/src/harness/run.rs`（新）：`RunSpec` / `RunContext` / `RunOutcome` 与循环入口。
  - `src-tauri/src/harness/turn.rs`：循环依赖面收敛为 `RunContext`；工具定义按上下文生成（`task`
    描述含 agent 清单）。
  - `src-tauri/src/harness/subagents.rs`（新）：子运行宿主、三重闸、收敛与 resume 保留、结果信封。
  - `src-tauri/src/harness/tools.rs`：新增 `task` 工具；工具清单常量与文件头按「8 + 1」改准。
  - `src-tauri/src/harness/session.rs`：用量折叠与 `subrun` sidecar；恢复重算纳入。
  - `src-tauri/src/harness/jsonl.rs`：`subruns/<vault 稳定 id>/` 审计目录。
  - `src-tauri/src/harness/llm.rs`：`client_at` 模型覆盖；mock 父子游标。
  - `src-tauri/src/config.rs`：`[harness.subagents]` 节 + 校验 + ts-rs 导出。
  - `src-tauri/src/logging.rs`：四个诊断事件进白名单。
  - `src-tauri/Cargo.toml`：YAML 解析依赖（`serde_yaml` 已 deprecated；候选 `yaml-rust2` 0.13 /
    `saphyr` 0.2，均 2026 年在维护；只解析标量 + 字符串列表子集）。
  - `src/bindings/**`、`docs/specs/config-reference.md`、`docs/specs/subagent-definitions.md`（新，
    定义格式参考）、`scripts/acceptance/scenarios/**`。
- **关联约束**：
  - ADR 0007 Revisit 条件：subagent 转实际需求须 Alex 显式裁决后修订 ADR；实现前置 = ADR 0007 修订
    （新增「编排工具」分类与 9 件工具清单）。
  - ADR 0002 第 5 条（配置即数据 + schema 校验）：`[harness.subagents]` 按既有解析模型；定义文件是
    vault 侧的配置，校验口径同源（非法项丢弃 + 人话 warning）。
  - ADR 0002 第 6 条（性能合同）：定义扫描只在回合开始做一次目录读，不落冷启动与 keypress 路径。
  - ADR 0002 第 7 条（核心模块不耦合 tauri）：扫描 / 校验 / 解析纯 Rust，可单测。
  - ADR 0003 第 3 条（永不改写源文件格式）：子运行写入仍走既有工具与权限管线，不新增写入通道。
  - REVIEW.md「值或开关声明了却没有消费者」：`[harness.subagents]` 每键在 design §14 指明消费者。
  - AGENTS.md「变更默认直接切断」：无兼容层（`task` 是新工具、定义目录是新面）；若 cron 交接载荷在
    实现期已存在，一次迁净，不留双形状。
  - AGENTS.md 信息卫生：全部制品只用 `<vault>` / `<config_dir>` 占位，无真实路径与内容。

## 节点 1 需裁决的设计取舍（逐条可否决）

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
   判定；子运行不进入批准闸，且不复用父会话批准缓存。默认 `vault_write` 档下 `vault_patch` /
   `vault_create` / `vault_move` 自动放行，声明后子运行可写；`vault_delete` 与 `cli_run` 写命令该档
   需批准 → 子运行内被拒并计数。备选：声明即视为批准（不推荐：把「可见」偷换成「批准」）。
7. **子运行不进入人工批准闸：ask 级调用一律拒绝回送**（推荐）。批准卡透传涉及归属、文案、等待语义
   与父回合阻塞，是独立 UX 设计；拒绝会计数并回送，父 agent 可接手。备选：透传批准卡——能力更强，
   建议另立 change。
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
13. **v1 串行执行、过程不上屏**（推荐）。沿用「tool_calls 逐个执行」；父会话只看到 `task` 工具卡
    （agent + description + 终态）与摘要。备选：后台 / 并行 + 折叠面板——需要并发模型请求、事件交错
    与新的面板契约，留待真实数据。

以上 13 条均为设计取舍，Alex 有拒绝面；本 proposal 不自带未裁决的阻塞项。节点 1 通过前不进入实现。
