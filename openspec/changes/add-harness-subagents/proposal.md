# Proposal: Subagents（`task` 工具）——委托式 harness 运行与运行公共层回抽

- Change ID: add-harness-subagents
- 日期: 2026-10-18
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> **裁决留痕（2026-10-18，逐字）**
>
> **起草授权**：「是。」——对「Subagents 提案紧随 cron 之后起草」的确认。
>
> **定位（已裁决）**：「Subagents / Cron 定位 | harness 通用原语，不特化到任何场景」。出处：
> `.local/design/harness-vision.md`（git 外，设计真源，下称「真源」）的「裁决记录」表。
>
> **形态（真源标「已倾向」）**：「`task` 工具——入参为任务描述、prompt、模型档位、工具集、失控闸值、
> 超时。子 agent 跑自己的工具循环，结果以摘要回主会话。」同节四项「已倾向」：派生深度限 1 层、
> 工具集按任务声明且默认收紧（调研类默认只读）、子 agent 用量归入主会话累计读数、token / 时间 /
> 轮次三重失控闸任一触顶即收敛返回部分结果。**本提案把这四项按「倾向」落地，逐项落法与替代方案见
> 裁决点 3–8（派生深度 1 层作为机制不变量，不提供关闭开关，见 design §4.3）；Alex 可逐条否决，
> 否决项按替代方案改写后重走节点 1。**
>
> **统一抽象（Alex 认可的次序）**：「第一个原语（cron）带最小抽象落地，第二个原语（Subagents）
> 出现时回抽公共层。因此本提案必须正面处理『触发 → 上下文装配 → 工具循环 → 留存』公共层。」
> 该承诺的书面落点是评审中的 change `add-cron-runtime-daemon` 重构稿 design §14：「Subagents 落地
> 时 MUST 回抽公共层『触发 → 装配 → 运行 → 留存』，把 cron 的触发源与 Subagents 的委托触发一起
> 接入该层，MUST NOT 让 Subagents 另写一套调度。」**本 change 是这条承诺的兑现点。**
>
> **调度策略（真源「调度策略」节，供节点 1 参考）**：① 能确定性计算的不花 token；② 按产物纠错成本
> 分档（一次性产物便宜档，累积产物强档或便宜档 + 批准闸）；③ 大体量遍历拆两层；④ 吞吐与判断拆阶段。
> 错误方向不对称：漏记可补、错记污染，写入偏保守。**这些是调用方的策略，不是机制的知识**——机制只
> 提供参数面，策略由调用方（人或主 agent）按此原则填参。
>
> **ADR 前置**：ADR 0007 的 Revisit 条件写明「探针能力清单需要扩张（如后台任务、subagent 从架构约束
> 转为实际需求）→ Alex 显式裁决后修订本 ADR，不允许在 OpenSpec change 中静默扩张」。2026-10-18 的
> 裁决已把 subagent 从「架构约束」转为「实际需求」；ADR 0007 的修订（工具集边界新增「编排工具」一类）
> 列为本 change 的实现前置，见 Impact 与 tasks §0。

## Why

1. **主会话的上下文是最贵的一份共享资源**。调研类任务（读十份材料、逐篇摘要、跨源比对）的中间材料
   一旦进主会话历史，此后每一轮往返都要重新载入它——即使命中前缀缓存，输入 token 也不归零。子运行
   把材料关在自己的循环里，主会话只收一份摘要：主会话的上下文增长从「材料体量」变成「摘要体量」。
   这是本能力的第一价值，也是它在首场景（创意设计调研）之外的通用价值。
2. **模型档位是配额与质量的分配手段**。真源「调度策略」第 ④ 条（吞吐与判断拆阶段）在 Subagents 上的
   落法就是让调用方为一次委派指定模型：抓取与逐篇摘要用便宜档，跨源综合回到主会话的强档。机制只
   接受一个模型参数，不内置「调研该用哪档」这类判断——**机制进代码、策略进参数**。
3. **第二个触发源出现，公共层的回抽到期**。现有会话形态本就是「触发器 + 上下文装配 + 工具循环 +
   留存」；用户输入与 cron 是前两类触发源，委托是第三类。cron 提案已声明不在自己之前预造空壳抽象、
   由 Subagents 兑现回抽；两个 change 目前都零代码，此刻改形状的成本最低。若再拖，cron 的运行槽位、
   交接事件与前端处理器会按单触发源形状落地，回抽要动已写好的实现与验收场景。
4. **失控闸是开放自动委派的前置条件**。委派循环的三个典型失控面：模型自我递归委托、单次委派烧掉整份
   配额、子运行卡死把主回合一起挂住。不先给出三重闸（轮次 / token / 时间）与「任一触顶即收敛返回部分
   结果」的语义，就不该把 `task` 暴露给模型。
5. **写入偏保守有现成的落点**。真源的错误方向不对称（漏记可补、错记污染）在 Subagents 上等价于：
   子运行默认只读，写权限必须由调用方显式声明；而声明之后仍要过既有的权限管线与批准闸，机制不因
   「它是子 agent」而放松任何一层。v1 更进一步：子运行无法回答人工批准，ask 级调用一律拒绝回送
   （裁决点 5）。
6. **现在做的成本最低**。本 change 与 cron 提案都停在提案阶段，没有实现、没有验收场景、没有历史
   配置兼容面。公共层在这一刻回抽只改设计；晚一步就要连带迁移 cron 已落地的运行交接形状。

## What Changes

两个 capability：**新增** `harness-subagents`（委托运行）；**修订** `harness`（新增「运行公共层」一条
requirement，并改准「工具循环」的工具清单）。逐条对应 `specs/` 下的 delta。

### A. 运行公共层：`RunSpec` + `RunContext`（`harness` capability，ADDED）

1. **一份运行契约**：`RunSpec` 描述一次运行的全部输入——触发来源（用户输入 / cron / 委托）、目标
   vault、会话目标（交互会话 / 无人值守槽位 / 子运行）、投递 parts、模型覆盖、工具白名单、预算、
   批准策略、用量归属、事件接收端。三类触发源都产出 `RunSpec`，MUST NOT 各自定义一套交接载荷。
2. **一个循环**：`run_turn_for` 的依赖面收敛为 `RunContext`（会话状态、事件 sink、工具定义、权限判定、
   批准等待、预算检查、留存写入）。交互会话、cron 运行槽位、子运行各提供一个 `RunContext` 实现，
   循环本体只有一份。**差异显式化为契约里的枚举值（会话目标、批准策略），不是同一个函数里的
   `if origin == ...` 分支。**
3. **装配与留存沿用既有实现**：系统上下文（`harness/context.rs` 三层 AGENTS + Skill 索引）、会话
   留存（`harness/jsonl.rs` 的 wire 形态）、权限管线（`harness/permissions.rs`）不重写，只被
   `RunSpec` 参数化（工具白名单、模型覆盖、用量归属）。
4. **交互路径行为逐字节不变**：回抽是参数化，不是语义改动；既有「恢复充分性」测试、session JSONL
   形状与面板事件契约是回归判据（tasks §1）。
5. **cron 接入同一契约**：cron 的运行槽位与 `cron:run` 交接载荷改为 `RunSpec` 的序列化形状；cron
   提案 §14 的「MUST 回抽」承诺由本 change 兑现，cron 实现（尚未开工）按此形状落地，不再二次重构。

### B. `task` 工具：第 9 件工具，编排类（`harness-subagents` ADDED）

1. **入参**：`description`（一句话标签，进进度与诊断）、`prompt`（自包含任务说明）、可选 `model`、
   可选 `tools`、可选 `max_rounds` / `max_tokens` / `timeout_secs`。与真源「任务描述、prompt、模型
   档位、工具集、失控闸值、超时」一一对应。
2. **结果信封**：成功 `{"ok": true, "status": "completed" | "partial", "summary": …, "usage": …,
   "rounds": …, "denied_calls": …, "stopped_by": …}`；失败沿用既有信封 `{"ok": false, "code": …,
   "message": …}`。
   部分结果不是失败（`ok=true` + `status=partial` + `stopped_by`），父 agent 可据 `stopped_by` 决定
   缩小范围重试或自己接手。
3. **摘要上限**：回送父会话的摘要设字符上限，超出显式标 `truncated: true` 并保头尾；MUST NOT 静默
   截断（沿用工具集既有纪律）。
4. **派生深度恰好 1**：子运行的工具集里 MUST NOT 出现 `task`；声明 `task` 的调用被拒并回送原因。
   深度是机制不变量，不提供配置项。

### C. 子运行引擎：隔离、收紧、收敛

1. **上下文隔离**：子运行有独立的 system 上下文与会话输入（同一份三层 AGENTS + Skill 索引装配，空
   历史 + 任务 prompt），MUST NOT 继承父会话的对话历史；父会话也 MUST NOT 收到子运行的过程消息，
   只收工具结果里的摘要。
2. **工具集收紧**：`tools` 是白名单，默认 `["vault_read", "vault_search", "skill_load"]`（只读三件）；
   写类与 `cli_run` 必须显式声明。未声明的工具不出现在子运行的工具定义里（模型看不见，不是调用后
   拒绝）。清单外的工具名被拒并回送原因。
3. **三重失控闸**：轮次、token（子运行累计 input+output）、wall-clock 时间。检查点为每次 LLM 往返
   之前与每个工具调用之前；任一触顶即停止开新往返、收敛返回已产出的部分结果。已在执行的工具调用
   不中途打断（`cli_run` 自带 60 秒上限即其最坏粒度），因此时间闸的实际上界 = 截止时刻 + 单次工具
   最长耗时。
4. **批准策略**：子运行 MUST NOT 挂在人工批准上。命中 ask 档的调用一律以「无人可批准」拒绝并回送
   给子模型，计数进结果的 `denied_calls`；deny 规则、危险黑名单、vault 内写重定向三层照常生效
   （不因无人值守而放松）。
5. **串行执行**：一次助手消息里的多个 `task` 调用按既有「tool_calls 逐个执行」口径串行跑；机制不做
   并行调度（裁决点 9）。

### D. 用量归属与留存

1. **用量归主会话**：子运行每次往返的 usage 折叠进父会话的累计读数（input / cached / cache write /
   样本数），父会话控制行读数因此不再系统性低估。折叠后 cache% 是混合读数（父 + 子、可能跨模型），
   这是「归主会话」的既定代价，在读数含义上如实说明。
2. **可重算**：父会话 JSONL 落一条 `subrun` sidecar 记录（run id、模型、结果、usage、审计文件指针）；
   「从历史恢复以留存重算读数」的口径不变，重算输入新增这一类记录，live 与恢复读数 MUST 相等。
3. **子运行审计流水**：`<config_dir>/harness/subruns/<vault 稳定 id>/<run_id>.jsonl`，与父会话同 wire
   形态、append-only、MUST NOT 写入 vault；不进 `sessions/` 目录、不进会话列表、不可恢复（裁决点 6）。

### E. 配置与开关（`[harness.subagents]`）

`enabled`（默认 true，kill switch）、`default_max_rounds`（20）、`default_max_tokens`（200000）、
`default_timeout_secs`（300）、`max_subruns_per_turn`（8）。逐项 schema 校验、非法项人话 warning +
缺省回落（ADR 0002 第 5 条）；每个键在 design §12 指明消费者。**档位名映射表不做**：模型用显式 id
（裁决点 7）。

### F. 与 cron 的接入关系

两个 change 无代码硬依赖；实现顺序建议 = 本 change 的公共层先落（因为它是 cron 声明的到期点），
cron 实现接入 `RunSpec`。若 cron 先开工，其运行槽位按 `RunSpec` 形状落地、公共层由本 change 补齐，
**不允许 cron 另起一套交接载荷**。该顺序由 tower 在实现排期上对齐，不构成本 change 的阻塞项。

## Non-goals

- **不做并行子 agent**：沿用既有「工具调用逐个执行」口径，多个 `task` 调用串行。并行涉及并发模型
  请求、事件交错与配额争用，属 v2，需真实使用数据后再设计。
- **不做递归派生**：深度硬性 1 层，不提供配置项，不在子运行工具集里放 `task`。
- **不做子运行的可恢复会话**：审计流水留档即可，子运行不出现在会话历史列表，不进 `sessions/`。
- **不做人工批准透传**：子运行的 ask 级调用直接拒绝（裁决点 5 的推荐面）；把批准卡透传到主会话是
  一个独立的 UX 设计（归属哪条 transcript、批准文案、等待语义），不在 v1。
- **不做子运行过程流式上屏**：只保留 `task` 工具卡（运行中 → 完成/失败）与摘要；过程留审计文件。
- **不做档位名到模型 id 的映射表**：调用方传显式模型 id；档位是调用方的策略词汇。
- **不做任务模板 / 预设工具集 / 场景枚举**：新场景 = 新调用方传新的参数组合，机制零改动。
- **不做跨会话成本账本与配额管理**：只有单次运行的三重闸与单回合的委派次数上限，不做全局账本。
- **不做图片 / 附件入参**：v1 的 `prompt` 只有文本；附件投递链路已有，但子运行的输入形态另需设计
  （图片会显著改变预算与隔离语义），留档。
- **不做子 agent 间通信 / 消息总线**：父 agent 是唯一的协调者，v1 引入总线等于引入第二套调度。
- **不做 `task` 的自动重试**：失败或触顶由父 agent 决定是否重试；机制不自作主张。

## 反向扳机与降级路径

**反向扳机（与 cron 同口径：连续 4 周零使用即删除）**：从本 change 合并之日起连续 4 周，
`subagent_finished` 事件（含 `completed` 与 `partial`）累计为 0 ⇒ 走新 change 删除本能力：`task`
工具、子运行引擎、`[harness.subagents]` 配置节与审计流水。运行公共层**不随之下线**——它已被 cron
消费，删除面按届时实际消费者决定（与 cron 反向扳机的处置口径一致）。

**降级路径（不自动调参，由人按周检查后改配置或另立 change）**：

1. **触顶率过高**（最近 10 次子运行中 ≥5 次 `stopped_by` 非空）⇒ 先查任务颗粒度（父 agent 拆得太
   粗），再调高 `default_*` 预算——调配置即可生效，机制不自适应。
2. **完成率长期偏低**（连续 4 周 `completed / started < 50%`）⇒ 降级为只读调研专用：走一个后续
   change 把 `tools` 白名单限到只读三件；在 change 落地前，用目标 vault 的 AGENTS.md 写死「委派
   只做调研」的约定（策略层降级，机制不动）。
3. **写类委派零使用**（连续 4 周无任何 `subagent_finished` 的工具集含写类/`cli_run`）⇒ 走后续 change
   删除写工具声明能力，只留只读三件——未使用即删，降低安全面。
4. **紧急关停**：`[harness.subagents].enabled = false` 后 `task` 工具不再注册（模型看不见），无需
   改代码、无需重启以外的动作（配置生效时机随装载，与既有配置一致）。

## 观测：怎么知道用了 / 有效 / 出问题怎么发现

诊断事件（本地 JSONL，`~/.config/lumir/logs/`，不联网、不外发）三个：

- `subagent_started`：run id、父会话 id、`description`、模型、工具集、三项预算值。
- `subagent_finished`：run id、`status`（completed / partial / failed / aborted）、`stopped_by`、
  `rounds`、`input_tokens` / `cached_tokens` / `output_tokens`、`denied_calls`、`duration_ms`、
  `summary_chars`、审计文件路径。
- `subagent_rejected`：`reason`（disabled / depth / subrun_limit / model_not_configured /
  tool_not_allowed / empty_prompt）。

**怎么知道用了**：

```bash
# 子运行次数（completed 与 partial 都算使用；failed 不算）
rg -c '"event":"subagent_finished".*"status":"(completed|partial)"' ~/.config/lumir/logs/
```

**怎么知道有效**：三个读数，均从上两个事件里直接取，不需要指标系统。

1. **隔离效果**：`subagent_finished.input_tokens`（子运行吃进去的材料量）与 `summary_chars`（还给
   主会话的量）的对比——子运行吃了 8 万 token、只回 1 千字，隔离成立；两者量级相当则这次委派没有
   省下任何东西，该任务不该用子 agent。
2. **完成率**：`completed / started`。低完成率说明任务描述或预算不匹配（先查颗粒度，再查预算）。
3. **触顶分布**：`stopped_by` 按值计数。集中在 token / 轮次档 = 预算与任务颗粒度不匹配（先查颗粒度，
   再调默认值）；集中在时间档 = 任务范围过大或某类工具调用偏慢。

**出问题怎么发现**：

- 子运行失败、触顶、被拒都**有结果可看**：父会话的 `task` 工具卡落到终态，工具结果带 `code` 或
  `stopped_by`，不出现「调用后永远转圈」的形态（时间闸保证上界）。
- 每一次子运行都有审计流水（`subruns/<vault id>/<run_id>.jsonl`），失败可从 `subagent_finished` 的
  指针直接定位到原始往返记录。
- 委派次数上限触发时父会话收到明确的工具结果（`subrun_limit`），不是静默跳过。
- 配置非法项在装载期一条人话 warning，按缺省值或夹取后的合法值生效，不因配置错误让应用启动失败。
- 真机验收场景覆盖：只读调研、显式写工具、三重闸触顶、深度拒绝、用量折叠、开关关停（tasks §7）。

## Impact

- **影响的 specs**：
  - `harness-subagents`：ADDED（新 capability）——`task` 工具、工具集声明与收紧、三重失控闸、批准
    策略、子运行上下文隔离、用量归属、留存与诊断、模型选择、配置节。
  - `harness`：ADDED「运行公共层」一条 requirement（`RunSpec` / `RunContext` / 三类触发源接入）；
    MODIFIED「工具循环」（工具清单由 8 件改为「8 件 vault 工具 + 1 件编排工具 `task`」，并写明子
    运行不持有 `task`）。
- **影响的代码/系统**（概述，细节见 design.md）：
  - `src-tauri/src/harness/run.rs`（新）：`RunSpec` / `RunOrigin` / `SessionTarget` / `RunBudget` /
    `ApprovalPolicy` / `RunOutcome` / `RunContext` 与循环入口。
  - `src-tauri/src/harness/turn.rs`：把 `run_turn_for` 的依赖面从 `Runtime + VaultScope` 收敛为
    `RunContext`；工具定义由 `RunSpec.tool_policy` 决定，不再硬编码 `tools::definitions()`。
  - `src-tauri/src/harness/subagents.rs`（新）：子运行宿主、预算检查、收敛逻辑、结果信封、审计写入。
  - `src-tauri/src/harness/tools.rs`：新增第 9 件工具 `task` 的定义与执行入口；工具清单常量与文件头
    「恰好 8 个」的表述按新分类改准；白名单过滤函数。
  - `src-tauri/src/harness/session.rs`：用量折叠入口（把一次子运行的 usage 并入父会话累计器）与
    `subrun` sidecar 记录；恢复重算纳入该类记录。
  - `src-tauri/src/harness/jsonl.rs`：子运行审计流水目录（`subruns/<vault 稳定 id>/`），与会话目录
    分离。
  - `src-tauri/src/harness/llm.rs`：`client_at` 接受模型覆盖（子运行与 cron 共用）。
  - `src-tauri/src/config.rs`：`[harness.subagents]` 节 + 校验 + ts-rs 导出。
  - `src-tauri/src/logging.rs`：三个诊断事件进白名单。
  - `src/bindings/**`：ts-rs 重导出。
  - `docs/specs/config-reference.md`：`[harness.subagents]` 键表与生效时机。
  - `scripts/acceptance/scenarios/`：新增真机验收场景（tasks §7）。
- **关联约束**：
  - ADR 0007 Revisit 条件（工具清单扩张须 Alex 显式裁决后修订 ADR）：本 change 以 2026-10-18 裁决为
    依据，实现前置 = ADR 0007 修订（新增「编排工具」分类与 9 件工具清单）。
  - ADR 0007 工具集边界原则（读不建工具、写要防护）：`task` 不是 vault 操作工具，是编排工具——
    ADR 修订须把这条分类写清，避免与「写且需防护才有 vault 工具」冲突。
  - ADR 0002 第 5 条（配置即数据 + schema 校验）：`[harness.subagents]` 按既有解析模型落地。
  - ADR 0002 第 6 条（性能合同）：子运行只在父轮次内按需发生，不落冷启动路径；工具定义过滤在请求
    构造时完成，不新增编辑器热路径工作。
  - ADR 0002 第 7 条（核心模块不耦合 tauri）：`run.rs` / `subagents.rs` 的预算与收敛逻辑纯 Rust，
    可单测。
  - ADR 0003 第 3 条（永不改写源文件格式）：子运行的写入仍走既有工具与权限管线，不新增写入通道。
  - `harness` living spec 的「上下文用量显示与触顶处理」：折叠口径与恢复重算的关系见 design §8，
    实现须保 live 与恢复读数相等。
  - REVIEW.md「值或开关声明了却没有消费者」条：`[harness.subagents]` 每个键在 design §12 指明消费者。
  - AGENTS.md「变更默认直接切断」：本 change 不引入兼容层（`task` 是新工具、配置是新键，无存量消费
    者）；cron 交接载荷若在实现期已存在，按 RunSpec 一次迁净，不留双形状。
  - AGENTS.md 信息卫生：本提案与全部制品只用 `<vault>` / `<config_dir>` 一类占位，无真实路径与内容。

## 节点 1 需裁决的设计取舍（逐条可否决）

1. **公共层按 `RunSpec` + `RunContext` 回抽**（推荐）。抽的是「一次运行的输入契约」与「循环的依赖
   面」，两个宿主（交互会话 / 子运行）各给一个实现；cron 的运行槽位改为 `RunSpec` 的序列化形状。
   备选：不抽，子运行直接复用 `run_turn_for` 并在函数内按 origin 分支——那样差异长进同一个函数
   （同函数分叉 = 假共享），vision 要避免的「两套调度」变成「一个函数两套 if」，且 cron 与 subagents
   的预算、用量、批准策略会各自演化。见 design §3 对「不抽」的逐条反驳。
2. **新增第 9 件工具 `task`，并把工具清单重述为「8 件 vault 工具 + 1 件编排工具」**（推荐）。这是
   ADR 0007 Revisit 条件命中的点：须 Alex 在实现前修订 ADR 0007（新增编排工具分类），本 change 只
   改 harness living spec 与 `tools.rs` 的表述。备选：把 `task` 做成「非工具的内部能力」（如 `/task`
   命令）——那就不是模型可自主调用的委派，与真源「`task` 工具」形态不符。
3. **子运行默认工具集 = 只读三件**（推荐）。调研类默认只读是「已倾向」项，本提案把默认值写死为
   `vault_read` / `vault_search` / `skill_load`。备选：默认继承父会话工具集——等于默认放开写入，
   与「默认收紧」相反，明确不推荐。
4. **写入 = 工具集声明 + 权限管线双重闸，任一不放行即不写**（推荐）。声明只决定「工具是否可见」，
   是否放行仍由既有权限管线判定；子运行不进入批准闸（见裁决点 5）。默认 `vault_write` 档下
   `vault_patch` / `vault_create` / `vault_move` 在管线里本来就自动放行（用户已选该档），因此声明后
   子运行可写；`vault_delete` 与 `cli_run` 写命令在该档要走批准，子运行无人可批 → 被拒并计数。
   备选：声明即视为批准（不推荐：等于把「是否可见」偷换成「是否批准」，违反不因无人值守放松安全闸）。
5. **子运行不进入人工批准闸：ask 级调用一律拒绝回送**（推荐）。理由：v1 首场景只读；批准卡透传涉及
   归属、文案、等待语义与父回合阻塞，是一份独立的 UX 设计；拒绝会被计数并回送，父 agent 可据此改为
   自己做写入或缩小范围。备选：批准卡透传到主会话并阻塞子运行——能力更强，但需要新的 UI 契约，
   建议另立 change。
6. **子运行不留可恢复会话：只留审计流水 + 父会话 `subrun` sidecar，用量一次性折叠进父会话**（推荐）。
   审计路径 `<config_dir>/harness/subruns/<vault 稳定 id>/<run_id>.jsonl`；不进会话列表、不进
   `sessions/`。`subrun` sidecar 同时承担两件事：父会话恢复时重算读数（live 与恢复必须相等）、把
   子运行的终态与审计指针留在主记录里。备选一：子会话进 `sessions/`（不推荐：历史列表被临时运行
   淹没）；备选二：完全不落盘、只留摘要（不推荐：失败与污染事故无法复盘）；备选三：用量只记在
   子运行审计里、不折叠父读数（不推荐：真源明确「用量归主会话」，两套读数会分叉）。
7. **模型用显式 id，不做档位名映射**（推荐）。`model` 缺省继承当前会话模型；非法 id 直接以
   `model_not_configured` 拒绝（父 agent 可改用合法 id 重试），不静默回落——回落会掩盖调用方的成本
   判断错误。备选：`[harness.subagents].tiers` 映射表（不推荐：多一层配置，随 provider 切换失效；
   档位是调用方策略，应由调用方填 id）。
8. **预算默认值与「逐次只能收紧」**：`max_rounds = 20`、`max_tokens = 200000`、
   `timeout_secs = 300`、`max_subruns_per_turn = 8`（推荐，全部可配）。逐次传入的预算 MUST NOT 超过
   配置缺省（超过即夹取并说明）——**配置是用户的闸，调用参数不得推翻用户设定的上限**。这些默认值是
   经验初值，没有实测依据；上线后按触顶分布调整（见「降级路径」）。备选一：不设默认、强制每次显式
   传三项（工具 schema 负担大，模型容易漏传）；备选二：逐次参数可任意放宽（不做：那等于把成本控制权
   交给模型）。
9. **v1 串行执行子运行**（推荐）。沿用既有「tool_calls 逐个执行」口径；并行留待真实使用数据。
   备选：父回合内并行跑多个 `task` 调用——需要并发模型请求、事件交错、配额争用与部分失败聚合，
   v1 做不扎实。
10. **子运行过程不上屏**（推荐）。父会话只看到 `task` 工具卡的进行中/完成状态与摘要；子运行的
    text / reasoning / tool_call 事件不转发到面板，只进审计流水。备选：折叠面板展示子运行过程——
    需要新的面板组件与事件契约，v1 不做。

以上 10 条均为设计取舍，Alex 有拒绝面；本 proposal 不自带未裁决的阻塞项。节点 1 通过前不进入实现。
