# harness 增量规格（change add-proactive-subagent-delegation）

> 起草注记（非规格正文）：本 delta 只改「会话本地留存」一条——`llm_request` 增 `tool_names`（本次
> 暴露给模型的工具名清单），用于在留存里区分「工具未暴露」与「模型未选择」。MODIFIED 块按当前
> living spec（`openspec/specs/harness/spec.md`）的整条 requirement 复制再改，段落顺序与段数保持
> 不变，改动只有首段插入一句与文件末尾新增两条场景。

## MODIFIED Requirements

### Requirement: 会话本地留存

会话 SHALL 以 wire/input 形态落配置目录（MUST NOT 写入 vault），作为 ADR 0007 双向记录机制的一侧：每会话一个 append-only JSONL 文件（`<config_dir>/harness/sessions/<vault 稳定 id>/<session_id>.jsonl`），文件首行 SHALL 为 `session_open` 记录——含 session id、vault 根路径、provider / 模型 / 思考档位 / **wire 方言（`wire_api`，缺省值同样在场）**、**完整装配后 system prompt 全文**与装配清单（每个来源的路径、存在与否、字节数；不存在的来源 SHALL 同样在场）、**读数种子**（M526：恢复 / 压缩开文件时在场——`usage` 读数快照 + `cache_totals` 累计四元组；链式恢复从这里起算，全新会话不落这两键）。`<vault 稳定 id>` SHALL 是 vault 注册表 id（与 `vault-sessions/<id>.json`、`reading-positions/<id>.json` 同一份身份），MUST NOT 用 vault 路径派生的消毒名（消毒名有撞名面且无长度 / 字符集保证，M309 现场）。每次发给模型的**会话请求**（含工具循环的每次迭代与压缩调用）SHALL 落一条 `llm_request` 记录（完整请求体：system + messages + 参数，**另带本次实际发送体的字节数 `request_bytes`**——按 wire 展开后的尺寸算，省掉「按字节比外推请求多大」；不具备真实 HTTP body 的 mock 档省略该键），**另带本次暴露给模型的工具名清单 `tool_names`**（按请求中工具定义的顺序、只记名字，MUST NOT 记录工具 schema / 描述 / 参数——`task` 的描述里含用户写的定义描述，属用户内容；该键恒在场，无工具的请求记空数组 `[]`——`[]` 表示「这一请求不带任何工具」，与「没有记录」区分；本 change 之前的文件缺该键，读取方 MUST NOT 把它当作空数组），每次响应 SHALL 落一条 `llm_response` 记录（正文 / 思考归一回放项与展示文本 / 工具调用 / usage（SHALL 含 input / cached / output 与**缓存写入 `cache_write_tokens`**——provider 不提供时按 0 记录）/ 错误；思考 MUST 落盘——**回放项归一回放形状**（`{"type":"reasoning", summary, [content], [encrypted_content]}`：kimi 的明文载体是 `summary`、deepseek 的是 `content`，各按在场项保留；`encrypted_content` 有则在场），`id` 字段 MUST NOT 进入回放项（`store:false` 下重放 `rs_*` id 属非标用法），展示文本另存）；请求侧在 **Responses 方言**且模型声明支持思考档位时（判据 `HarnessConfig::effort_supported`，读配置 schema 的 per-model `effort` 声明）SHALL 带 `include:["reasoning.encrypted_content"]`（store:false 官方回放模式的前提——让服务端在 reasoning item 里回传密文，重放时无需 id 即可还原）；未声明 effort 的模型（含 deepseek 现役形态）MUST NOT 发该字段；**Chat Completions 方言 MUST NOT 发 `include` / `store`**，其 wire 形态与思考回放字段见「Chat Completions 方言」条；wire 不可推导的决策与事件（批准 / 拒绝、停止中断、LLM 错误、循环上限）SHALL 以 sidecar 记录留存——其中 **LLM 错误的 sidecar 记录 SHALL 另带 HTTP 面诊断**（非 2xx 时的 HTTP 状态码、原始响应 body——按固定上限截断防巨型 body 撑爆留存、服务端 request id 若响应头或 body 提供；不具备 HTTP 面的错误省略这些键），且**错误事件的既有形态（`type`/`code`/`message`）不变**（新诊断只进留存，不破坏既有消费方），被 wire 覆盖或失去意义的 11 类事件 kind（`user_message` / `assistant_text` / `tool_call` / `tool_result` / `usage` / `tool_denied` / `compact` / `session_reset` / `approval_overwritten` / `approval_withdrawn` / `turn_abort_requested`）SHALL NOT 再记（重复记录即第二事实源）。记录点 SHALL 与发送点同点，MUST NOT 经二次序列化产生第二事实源。验收口径 SHALL 为恢复充分性：仅凭 JSONL 能逐字节重建任意一轮发给模型的请求——wire 体由留存 + 代码版本 + `wire_api` 方言共同推导，`session_open` 的方言键是推导依据之一；重建 MUST 忽略全部 sidecar 记录（含 `session_title`），旧文件缺失标题记录不改变重建结果。

会话文件的 vault 归属 SHALL 仍以首行 `session_open.vault_root` 为**唯一**判据：列举、恢复、删除三处的归属过滤口径不变，目录只作组织维度，MUST NOT 成为归属判据的第二真源（文件被手工挪动 / 拷贝不改变其归属结论）。目录名 SHALL NOT 与保留目录名 `_orphaned` 相同。`sessions/<vault 稳定 id>/<session_id>.jsonl` SHALL 是**唯一布局**：新建会话 SHALL 只落其 vault 的目录，列举 / 恢复 / 删除 SHALL 只读该目录；产品运行时 MUST NOT 含任何迁移逻辑（无启动迁移入口、无旧布局读取路径），也 MUST NOT 读平铺在 `sessions/` 根下的 `*.jsonl`——MUST NOT 保留平铺布局的双读 / 双写过渡层（本仓无外部消费者，兼容层保护对象的举证责任在建层一方；REVIEW.md「消费者是谁」）。存量平铺文件（升级前遗留）的归位 SHALL 由**仓内一次性脚本**（`scripts/` 下，手动执行一次即弃，不进产品运行时）完成：脚本按各文件首行 `session_open.vault_root`（先规范化再查注册表）移入对应 vault 目录，`vault_root` 不可解析 / 在注册表里找不到 / 目标位置已有同名文件的 SHALL 移入保留目录 `sessions/_orphaned/`，MUST NOT 删除或改写任何文件，且 MUST be 幂等（重复执行零搬运）；脚本遇单文件失败时留原地并自报，重跑脚本收敛。上一代「按 vault 聚合的业务事件流水」形态（`<config_dir>/harness/<消毒名>.jsonl`）照旧不再续写、不做迁移（运行时 / 产品侧零读者，验收套件的 JSONL 断言随实现迁移至 wire 口径；M309 孤儿先例）。写失败不阻断对话的既有纪律不变。

会话标题 SHALL 以 sidecar 记录 `session_title` 追加留存：`{"kind":"session_title","title":"…","decision":"initial|rename|keep|inherit|error","reason":"first-turn|cadence|drift|inherit","model":"…","ts":…}`。每次命名评估结束（含 keep 与失败）SHALL 追加一条——`initial` / `rename` 记录携带新标题，`keep` 记录携带当时生效的标题，`error` 记录不带 `title` 并带错误码 `code`（`harness_title_failed` / `harness_title_invalid`）；`inherit` 记录不是评估产物，在建新文件时写入（见下段）。`model` SHALL 记录本次调用实际使用的模型 id（`inherit` 记录不带该键——它没有发起调用，`reason=inherit`）。**有效标题** SHALL 是文件内最后一条带 `title` 的 `session_title` 记录的 `title`；没有该记录时回落首条用户消息（见「会话边界」条）。有效标题的解析 MUST 只有一处实现，列举 / 恢复 / 快照 / 事件四条出口 MUST NOT 各写一份 last-wins 逻辑。标题记录 SHALL 只在会话空闲（无在途轮次）时追加，MUST NOT 插在一条 `llm_request` 与它配对的 `llm_response` 之间——恢复的「折叠末尾未入请求的响应」判据依赖这对记录的相邻性。

自动压缩与从历史会话恢复开新文件时，源会话的有效标题 SHALL 以一条 `decision=inherit` 的 `session_title` 记录写入新文件（源会话无标题记录时不写，回落口径自然成立）；「新会话」显式开始新对话，MUST NOT 继承。本 change 之前的会话文件不含 `session_title` 记录：列举、恢复、展示 SHALL 安静回落到首条用户消息口径，MUST NOT 告警、MUST NOT 回填或改写既有文件。

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
- **THEN** 新 JSONL 文件在 `session_open` 之后追加一条 `decision=inherit` 的 `session_title` 记录，标题栏与历史浮层继续显示该标题；源会话无标题记录时不写 inherit，展示回落首条用户消息口径

#### Scenario: 旧文件安静回落

- **WHEN** 列举、恢复或展示本 change 之前落盘的会话文件（无 `session_title` 记录）
- **THEN** 会话名回落该会话首条用户消息截断约 20 字；不产生 warning、不写任何回填记录、文件逐字节不变；恢复后的请求重建结果与不含标题记录时一致

#### Scenario: 请求暴露面可核对

- **WHEN** 同一个 vault 里先以 `[harness.subagents].enabled = true` 发出一条请求，再以 `enabled = false` 开新会话发出一条请求，期间还发生过一次子运行
- **THEN** 前者对应 `llm_request.tool_names` 按请求顺序列出工具名、含 `task`；后者不含 `task`；两次都是数组且只有名字（无 schema / 描述）；该子运行的审计流水里同字段只含其定义声明的白名单、`task` 恒缺席

#### Scenario: 旧文件缺键不判空

- **WHEN** 读取一份本 change 之前落盘的会话文件（`llm_request` 无 `tool_names` 键）
- **THEN** 该缺失被当作「没有记录」，MUST NOT 被当作空数组；恢复、读数重算与请求重建都不受影响，文件也不因读取而被改写
