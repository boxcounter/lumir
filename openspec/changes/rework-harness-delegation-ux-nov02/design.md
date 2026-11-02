# Design: 子代理委派可见面的信息层级、状态归属与视觉合同

- Change: `rework-harness-delegation-ux-nov02`
- 依据：节点 1 批准的完整方案（proposal「节点 1 批准记录」）+ UX 复盘 + 生命周期审计。
- 读者：实现者与 reviewer。行为合同 §7 可逐条映射到单测 / 视觉场景 / 真机场景。

## 1. 主对象与核心问题

用户对一次委派只问三件事，按打断强度排序：

1. **现在需要我做什么？**——有没有等我批准的、有没有卡住的、有没有失败的。
2. **还在跑什么、多久、能不能停？**——过程控制；用户要的是「还活着 / 值得等」，不是内部步数。
3. **交办回来的是什么？花了多少？**——结果理解与偶发的成本诊断。

主对象是**一次交办**（意图 description、执行者 agent、状态、结果、代价、可介入动作）。`run_id`、
`rounds`、`segment`、`tool_calls`、`model`、`input/cached/output` 是它的记账字段，只在下钻时出现。

## 2. 信息层级

| 层 | 何时可见 | 内容 |
|---|---|---|
| L0 | 不点击 | 状态词、description、执行者（次要）、已用时、可执行动作（停止 / 批准 / 确认） |
| L1 | 一次点击 | 最近一步、模型、步数、摘要 |
| L2 | 详情 / 按需 | 单次用量、触顶原因与轮次预算、分段 |

原则：**每个可见数字都必须回答 L0/L1 的问题**；回答不了的一律进 L2 或只进诊断。`rounds` 不回答
任何一层（它是 `max_turns` 的消耗计数），因此只在触顶时作为原因出现。

## 3. 状态 → 归属（唯一真源）

| 状态 | composer 上方控制区 | transcript `task` 行 |
|---|---|---|
| 默认（无在跑、无待批、无待确认失败） | **不存在**（无标题、无完成汇总、无用量块） | 历史行保留（终态） |
| 单个前台 run（running） | **不出现** | 就地显示 `● 运行中 · description · agent · 12s · 停止`；运行期间不被工具块折叠 |
| ≥2 并行 run，或任一后台 run | 出现，逐行：状态词 + description（主）+ agent（次）+ 用时 + 停止 | 同步存在（同一事实，按相位单一归属） |
| 等待批准 | 出现；该行自动展开 + 批准卡；标题写「N 个等待批准」 | 同步存在 |
| 完成（done） | 行立即消失 | 同一行翻终态：`✓ 已完成 · description · agent · 1m33s`，摘要首行 + 详情 |
| 后台 partial / failed / stopped | **保留一行直到用户确认**（行尾「知道了」）；状态词 + 原因 + 摘要首行 | 同一行翻终态，原因直接进折叠行 |
| 前台 partial / failed / stopped | 不出现（用户就在对话流里，结果行已可见） | 同一行翻终态，原因直接进折叠行 |
| `auto_wake.blocked` | 不出现 | 对话流一条自动化提示（文案沿用现表）+「继续」；「继续」后就地换成结果句 |
| `enabled = false` | 不出现 | 没有 `task` 调用，自然没有行 |

为什么单前台 run 不出现控制区（批准方案给了「不出现 / 极细状态线」二选一）：一条常驻细条仍然是
「同一事实第二处读数」，而且用户的视线本来就在刚发出的那条 `task` 行上；行内的停止钮已覆盖过程
控制。代价是用户滚远后看不到在跑什么——由「运行中的行不折叠」+ 会话浮层的选路承担，不额外加条。

## 4. 生命周期与身份

### 4.1 同一 run 的 resume 段是一个身份

`reduceSubruns` 的 `subagent_started` 遇到同 `runId` 的既有视图时：

- `segments = 旧值 + 1`；`status` 回到 `running`；`stoppedBy = null`；`summary` 保留上一段（下一段
  收尾时覆盖）；
- 记录**段基线**（旧 `rounds` / `toolCalls` / 三个 token 字段），其后 `progress` 与 `finished` 的
  段内读数**加到基线上**——`rounds` 与 `steps` 因此是跨段累计，而不是第二段从 0 开始；
- `steps` 继续按到达序累计（沿用最近 20 条上限）；`elapsedMs` 在段内继续由 `progress` 推进，
  `finished` 的 `duration_ms` 覆盖为最近一段的真实用时（跨段总时长不可由事件推出，不伪造）；
- `stoppedBy` 在新段开始时复位为 null（上一段的触顶原因不得延续到新段）；
- 一个 run 在任务区、`task` 行与通知里始终只有一个身份；行详情显示「N 段」。resume 的第二条
  `tool_call` 仍会在 transcript 里产生一次调用记录，`subagent_started` 绑定既有身份时收走那条
  未绑定的重复任务行（事件序是 `tool_call started → subagent_started`）。

### 4.2 跨 vault：快照是 live 状态的唯一真源

`harness_state` 新增 `live_subruns: LiveSubrunSnapshot[]`（`vault` 作用域内的在跑 run）：

```json
{ "run_id": "...", "agent": "...", "description": "...", "model": "...",
  "background": false, "rounds": 3, "tool_calls": 7, "last_tool": "vault_read",
  "elapsed_ms": 12000 }
```

- 由 `SubagentHub` 的活动表产出：`subagent_started` 建项，`on_round`（每回合一次）更新
  `rounds / tool_calls / last_tool / elapsed_ms`，段收尾后从活动表删除——**已收尾的 run 不在表里**，
  因此「切走期间收尾」的 run 切回后不会复活。
- `harness_state` 同时新增 `subrun_runs`：逐 run 的终态汇总（`status` / `stopped_by` / `rounds` /
  `segments` / 三个 token 字段 / `duration_ms` / `tool_calls` / `background`，多段求和），由父会话
  在写 `subrun` sidecar 的同一次调用里落账，恢复时由同一批 sidecar 重算。它是**恢复出的 `task`
  行的终态真源**：后台调用的工具结果信封在启动时就写定 `status: running`，切走期间收尾的 run
  若只靠信封会永远显示「运行中」；前端在快照落地时用 `subrun_runs` 对该行对账（仍不在 live
  列表里 = 已收尾），并把终态行并入 `subruns` 视图——`background` 的异常终态因此仍以待确认行出现。
- 逐 run 汇总随 `session_open` 落种子（恢复新文件没有旧 sidecar），压缩跨边界时同样携带；否则
  二次恢复 / 压缩后恢复会让失败与部分结果退回「运行中」。恢复出的在跑 run 由 live 快照刷新为
  live 形态（行内停止、用时、详情），不依赖事件回放。
- 「知道了」的确认按 run id 记忆（跨切 vault / 重载保留，集合有上限）；同一 run 确认后不再出现。
- failed / aborted 的结果信封同样带任务身份（agent / run_id / segment / background / status /
  model / duration / tool_calls / usage），恢复行与 live 行同形（状态词、图标、用量）。
- 前端 `applyTaskReadings` 把它作为在跑行的权威来源：在表 = 建行 / 更新；不在表 = 立即移除行（旧
  vault 的僵尸行随之消失）。缺键（旧后端 / 桩）= 不应用，退化为既有事件驱动，不伪造、不静默清空。
- `clearTranscriptSurface()` 显式 `taskList.replaceChildren()`；`renderTaskArea()` 追加一道
  「按 `data-run` 对账」的纵深防线：任何不在可见集合里的行节点一律移除，不依赖 map 是否同步。

### 4.3 通知落点

后台完成通知只做「索引」：agent、description、终态（含触顶原因）、摘要首行；删除
「详情见任务面板」。详情与用量统一在 transcript 的 `task` 行，且该行在恢复后仍可展开。

## 5. 用量

- **单次（per-run）**：进 `task` 行详情。live 读 `SubrunView` 的累计字段；恢复读快照
  `subrun_runs` 的逐 run 汇总（多段求和），行文案与 live 相同（`D876`）。
- **会话聚合（按需）**：会话浮层顶部「本会话子任务用量」段，数据源是快照 `subrun_usage`（既有、
  按模型分桶）。只有一个模型桶时只显示一行总量（不出现模型名分组）；≥2 桶才按模型分组。没有任何
  桶时整段不出现。浮层的揭示条件相应放宽：有历史会话**或**有用量读数时都揭示。
- **删除**：composer 上方的常驻用量块与其标题；空闲态「本次会话 N 个已完成」汇总。

## 6. 视觉保真

（有原型：`design/prototypes/subagents-tasks.html` 为上一代形态；本 change 以它为基础做「减法」，
不新增卡片语言。核对方式：并排截图对照，不追求逐像素。）

### 6.1 布局节奏

- 控制区仍是 composer 上方一段：`border-top: 1px solid var(--border)`、底色 `var(--agent-bg)`、
  内边距沿用 `.lumir-tp` 现值。标题行高与既有 `.lumir-tp-head` 一致（`--sp-3` / `--sp-4`）。
- 行高沿用 `.lumir-tp-row` 的 `min-height: 26px`、`--sp-1` / `--sp-2` 内边距；行间 1px 间隙。
- **多待批 / 多行内部滚动**：`.lumir-tp-list` 增加 `max-height: min(40vh, 320px)` 与
  `overflow-y: auto`——≥3 行时列表自身滚动、composer 始终可见（design §19.2 的原承诺）；滚动条按
  `tests/unit/scrollbar-registry.test.ts` 归**隐藏档**（行右缘有常驻动作钮，细条仍会盖住）。

### 6.2 行内元素与字层级

- 顺序：状态图标（12px 槽）→ agent（mono，`--fs-meta`）→ description（主，省略号截断，唯一可截断
  字段）→ 后台标记 → 用时读数（右对齐前）→ 状态词（不含 running 时用图标 + 读屏名？**改**：running
  也给词，见 §6.4）。标题行 `--fs-label-s` + `--fw-semibold`。
- 终态行（transcript `task` 行）沿用工具行字层级：徽章 `task`、agent、description、
  `· 已完成 · 1m33s` 尾注；不加新字号、不加卡片边框（避免与批准卡混淆）。

### 6.3 各状态样式

- running：脉冲点（`--run`）+ 状态词；eink 下脉冲停用（既有 `:root[data-theme="eink"]` 规则）。
- waiting：暂停图标 + accent 底（既有）；行自动展开。
- done：✓ + `--text-3`；partial / failed / stopped：沿用既有 `is-partial` / `is-failed` /
  `is-stopped` 色族，**不新增颜色**；后台失败的「知道了」是 `.lumir-tp-mini` 次级钮。
- 详情区（`.lumir-tp-body`）字段顺序：`模型 · N 步 · 用时` → 触顶原因（仅触顶）→ 最近一步 → 摘要
  → 用量。用量行用 `--text-3`，与摘要同层级。

### 6.4 需要 Alex 手感裁决的项（不进机器判据）

- V1 行密度：中英文下「状态词 + description + agent + 用时 + 停止/知道了」一行是否够；
- V2 running 是否保留状态词（本 change 选择保留，图标仍承载颜色语义）；
- V3 会话浮层里用量段的视觉重量（与历史会话行同层级，不加分隔大标题）；
- V4 控制区出现 / 消失导致 composer 上下位移是否可接受；
- V5 终态 `task` 行是否要卡片化（本 change 保持工具行形态）。

## 7. 机器可验收的行为合同

- **C1 空闲不占位**：无在跑、无待批、无待确认失败时 `.lumir-tp` 不存在；任何状态都不出现常驻
  「子任务用量」块；恢复路径同样成立（替换现 m607 钉住的状态）。
- **C2 运行中不折叠**：前台 run 运行期间，其 transcript `task` 行在工具块 ≥2 行折叠后仍可见。
- **C3 终态行内容**：折叠的终态行含状态词、description、agent、用时；不含轮次读数。
- **C4 详情用量**：展开 `task` 行详情出现该 run 的 input / cached / output，live 与恢复同一行文案。
- **C5 通知落点**：后台完成通知不再出现「详情见任务面板」。
- **C6 单前台 run 不进控制区**：一个前台 run 在跑时 `.lumir-tp` 不存在，其 `task` 行可见且带停止钮。
- **C7 并行 / 后台 / 待批出现控制区**：≥2 在跑、任一后台、任一待批时控制区出现并逐行列出。
- **C8 后台失败保留**：后台 partial / failed / stopped 的行在收尾后仍在控制区，直到点「知道了」。
- **C9 模型维度**：会话用量段只有一个桶时无模型名分组；≥2 桶按模型分行。
- **C10 跨 vault 对账**：切走再切回后，旧会话的行不残留；仍在跑的 run 有行且带停止钮；切走期间
  收尾的 run 不出现为运行中。
- **C11 resume 身份**：同一 `run_id` 两段后任务区仍只有一行，`rounds` / `steps` 累计、`segments = 2`。
- **C12 触顶提示位置**：`auto_wake.blocked` 非空时提示与「继续」在对话流，控制区不出现提示行。
- **C13 阻塞不挤压**：≥3 个待批行时控制区列表自身滚动，composer 可见。
- **C14 关停**：`enabled = false` 无控制区、`task` 不注册（既有场景 194，保持不变）。
- **C15 会话隔离**：切会话清空控制区、`task` 行绑定与用量段（既有，保持不变）。
- **C16 单次用量对账**：UI 详情的 input / cached / output 等于该 run 在父会话 `subrun` sidecar 的
  各段求和（脚本可取留存核对）。
- **C17 恢复行终态对账**：恢复出的 `task` 行若信封为 `running` 而该 run 已有 `subrun_runs` 终态记录、
  且不在 live 列表里，行 MUST 显示终态（状态词 + 原因 + 用时），MUST NOT 停在一个假的「运行中」。
- **C18 恢复运行行可停止**：恢复出的 `running` 行在 live 快照落地后 MUST 换成 live 形态（行内
  「停止」、live 用时、可展开详情）；单前台 run 时控制区不出现也必须满足。
- **C19 resume 事件序单身份**：完整两段 `tool_call started → subagent_started → … → tool_call done`
  之后，transcript MUST 只有一个任务行；运行中的详情 MUST NOT 带上一段的触顶原因。
- **C20 四态恢复同形**：completed / partial / failed / aborted 的恢复行 MUST 显示对应状态词与图标，
  详情 MUST 有该 run 的用量读数；failed / aborted 的信封 MUST 带任务身份。
- **C21 种子链**：`subrun_runs` 经 `session_open` 种子跨「恢复 → 再恢复」与「压缩 → 恢复」保持
  逐字段相等；二次恢复后的行不得退回「运行中」。
- **C22 待确认归属**：后台 run 的 partial / failed / stopped 在切走 / 重载后 MUST 仍以待确认行出现，
  「知道了」后可确认且同一 run 不再出现。
