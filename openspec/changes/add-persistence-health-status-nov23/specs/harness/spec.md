# Harness 增量：留存健康状态（add-persistence-health-status-nov23）

## MODIFIED Requirements

### Requirement: 会话本地留存

会话 SHALL 以 wire/input 形态落配置目录（MUST NOT 写入 vault），作为 ADR 0007 双向记录机制的一侧：每会话一个 append-only JSONL 文件（`<config_dir>/harness/sessions/<vault 稳定 id>/<session_id>.jsonl`），文件首行 SHALL 为 `session_open` 记录——含 session id、vault 根路径、provider / 模型 / 思考档位 / **wire 方言（`wire_api`，缺省值同样在场）**、**完整装配后 system prompt 全文**与装配清单（每个来源的路径、存在与否、字节数；不存在的来源 SHALL 同样在场）、**读数种子**（M526：恢复 / 压缩开文件时在场——`usage` 读数快照 + `cache_totals` 累计四元组；链式恢复从这里起算，全新会话不落这两键）。`<vault 稳定 id>` SHALL 是 vault 注册表 id（与 `vault-sessions/<id>.json`、`reading-positions/<id>.json` 同一份身份），MUST NOT 用 vault 路径派生的消毒名（消毒名有撞名面且无长度 / 字符集保证，M309 现场）。每次发给模型的**会话请求**（含工具循环的每次迭代与压缩调用）SHALL 落一条 `llm_request` 记录（完整请求体：system + messages + 参数，**另带本次实际发送体的字节数 `request_bytes`**——按 wire 展开后的尺寸算，省掉「按字节比外推请求多大」；不具备真实 HTTP body 的 mock 档省略该键），**另带本次暴露给模型的工具名清单 `tool_names`**（按请求中工具定义的顺序、只记名字，MUST NOT 记录工具 schema / 描述 / 参数——`task` 的描述里含用户写的定义描述，属用户内容；该键恒在场，无工具的请求记空数组 `[]`——`[]` 表示「这一请求不带任何工具」，与「没有记录」区分；本 change 之前的文件缺该键，读取方 MUST NOT 把它当作空数组），每次响应 SHALL 落一条 `llm_response` 记录（正文 / 思考归一回放项与展示文本 / 工具调用 / usage（SHALL 含 input / cached / output 与**缓存写入 `cache_write_tokens`**——provider 不提供时按 0 记录）/ 错误；思考 MUST 落盘——**回放项归一回放形状**（`{"type":"reasoning", summary, [content], [encrypted_content]}`：kimi 的明文载体是 `summary`、deepseek 的是 `content`，各按在场项保留；`encrypted_content` 有则在场），`id` 字段 MUST NOT 进入回放项（`store:false` 下重放 `rs_*` id 属非标用法），展示文本另存）；请求侧在 **Responses 方言**且模型声明支持思考档位时（判据 `HarnessConfig::effort_supported`，读配置 schema 的 per-model `effort` 声明）SHALL 带 `include:["reasoning.encrypted_content"]`（store:false 官方回放模式的前提——让服务端在 reasoning item 里回传密文，重放时无需 id 即可还原）；未声明 effort 的模型（含 deepseek 现役形态）MUST NOT 发该字段；**Chat Completions 方言 MUST NOT 发 `include` / `store`**，其 wire 形态与思考回放字段见「Chat Completions 方言」条；wire 不可推导的决策与事件（批准 / 拒绝、停止中断、LLM 错误、循环上限）SHALL 以 sidecar 记录留存——其中 **LLM 错误的 sidecar 记录 SHALL 另带 HTTP 面诊断**（非 2xx 时的 HTTP 状态码、原始响应 body——按固定上限截断防巨型 body 撑爆留存、服务端 request id 若响应头或 body 提供；不具备 HTTP 面的错误省略这些键），且**错误事件的既有形态（`type`/`code`/`message`）不变**（新诊断只进留存，不破坏既有消费方），被 wire 覆盖或失去意义的 11 类事件 kind（`user_message` / `assistant_text` / `tool_call` / `tool_result` / `usage` / `tool_denied` / `compact` / `session_reset` / `approval_overwritten` / `approval_withdrawn` / `turn_abort_requested`）SHALL NOT 再记（重复记录即第二事实源）。记录点 SHALL 与发送点同点，MUST NOT 经二次序列化产生第二事实源。验收口径 SHALL 为恢复充分性：仅凭 JSONL 能逐字节重建任意一轮发给模型的请求——wire 体由留存 + 代码版本 + `wire_api` 方言共同推导，`session_open` 的方言键是推导依据之一；重建 MUST 忽略全部 sidecar 记录（含 `session_title`），旧文件缺失标题记录不改变重建结果。

会话文件的 vault 归属 SHALL 仍以首行 `session_open.vault_root` 为**唯一**判据：列举、恢复、删除三处的归属过滤口径不变，目录只作组织维度，MUST NOT 成为归属判据的第二真源（文件被手工挪动 / 拷贝不改变其归属结论）。目录名 SHALL NOT 与保留目录名 `_orphaned` 相同。`sessions/<vault 稳定 id>/<session_id>.jsonl` SHALL 是**唯一布局**：新建会话 SHALL 只落其 vault 的目录，列举 / 恢复 / 删除 SHALL 只读该目录；产品运行时 MUST NOT 含任何迁移逻辑（无启动迁移入口、无旧布局读取路径），也 MUST NOT 读平铺在 `sessions/` 根下的 `*.jsonl`——MUST NOT 保留平铺布局的双读 / 双写过渡层（本仓无外部消费者，兼容层保护对象的举证责任在建层一方；REVIEW.md「消费者是谁」）。存量平铺文件（升级前遗留）的归位 SHALL 由**仓内一次性脚本**（`scripts/` 下，手动执行一次即弃，不进产品运行时）完成：脚本按各文件首行 `session_open.vault_root`（先规范化再查注册表）移入对应 vault 目录，`vault_root` 不可解析 / 在注册表里找不到 / 目标位置已有同名文件的 SHALL 移入保留目录 `sessions/_orphaned/`，MUST NOT 删除或改写任何文件，且 MUST be 幂等（重复执行零搬运）；脚本遇单文件失败时留原地并自报，重跑脚本收敛。上一代「按 vault 聚合的业务事件流水」形态（`<config_dir>/harness/<消毒名>.jsonl`）照旧不再续写、不做迁移（运行时 / 产品侧零读者，验收套件的 JSONL 断言随实现迁移至 wire 口径；M309 孤儿先例）。写失败不阻断对话的既有纪律不变；写失败的结果 SHALL 反映在「留存健康状态」条定义的**当前写健康与历史缺口**两个维度上，MUST NOT 只留在 stderr 与诊断日志里。

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

## ADDED Requirements

### Requirement: 留存健康状态

系统 SHALL 为每个活跃逻辑会话维护**两个相互独立**的留存健康维度：**当前写健康**（`state`：这段会话的留存现在还能不能写）与**历史缺口**（`history_gap`：这段会话是否已经缺失恢复所依赖的记录，或文件是否可能因部分写而损坏）。两者 MUST NOT 合并成一个 `ok/degraded`：一次成功追加只证明写能力恢复，不能补回已经缺失的记录。另有辅助事实 `history_written`（本逻辑会话是否已有至少一条 `llm_request` / `llm_response` 成功写盘），只用于「尚未落盘」提示，不是第三个健康维度。

当前写健康：任意一次写失败（序列化 / 打开 / 首行写入 / 行写入）SHALL 使 `state` 转 `degraded`；此后任意一次成功追加 SHALL 使其转回 `ok`。`state=degraded` SHALL 带 `severity` 与 `detail`：`severity` 为 `history`（失败记录属于 `llm_request` / `llm_response`；或失败可能已在文件里留下部分字节；或首行 `session_open` 失败）或 `annotation`（仅 sidecar 且没有任何字节落盘）；`detail` SHALL 记录本段 `degraded` 首次失败的分类，后续失败不刷新，恢复时清空。`annotation` 级失败 MUST NOT 降低已有的 `history`。

历史缺口：`history_gap` SHALL 是 latch，包含 `present` / `since_ts` / `detail`。以下任一情况 SHALL 置 `present=true`，并记录首次缺口时间与首次缺口分类：

- `llm_request` / `llm_response` 任一次写失败（无论是否留下部分字节——该记录永久缺失）；
- 任意一次写失败可能已在文件里留下部分字节（无法区分时 MUST 按「可能部分写」处理——JSONL 完整性可能受损）。

`history_gap.present=true` 后，后续成功追加、自动压缩换文件、切 vault MUST NOT 清除它；只有产生新的逻辑会话（显式「新会话」、从历史恢复、app 重启后重新建立会话）才从 `present=false` 起算。`annotation` 干净失败 MUST NOT 置 `history_gap`，也 MUST NOT 清除或降低已有的缺口。

**首行失败必须同时评价本次 `record(payload)` 的 payload**：`record(payload)` 在首行写入失败时直接返回，本次 payload 也没有写出、没有被 `pending_open` 保存。因此：

- 本次 payload 是 `llm_request` / `llm_response`：即使首行干净失败（未写入任何字节），该 payload 也随本次调用永久丢失 → `history_gap` SHALL 置 true；后续重试成功只恢复当前写健康，MUST NOT 补回这条记录，也 MUST NOT 清缺口。
- 本次 payload 是 annotation：首行失败 SHALL 只影响当前写健康（`severity=history`），不置 `history_gap`；annotation 丢失不 latch。首行重试成功后当前写健康回 `ok`。
- 本次只写首行、没有 payload 被丢弃（若存在这种独立写首行的路径）：不置 `history_gap`。

写点 MUST 保留挂起的 `session_open` 行，使下一条记录仍先重试写首行。首行或任意记录的部分写 SHALL 置 `history_gap`。系统 MUST NOT 承诺部分写后的文件仍可被完整读取或恢复；已损坏的文件本 change 不修复、不截断、不做原子发布。

`history_written` SHALL 在本逻辑会话第一条 `llm_request` / `llm_response` 成功写盘时转 `true`，同一逻辑会话内不再回落；自动压缩换文件沿用；新逻辑会话重置为 `false`。它 MUST NOT 参与 `history_gap` 判定，只决定「本次会话的新记录尚未落盘」提示是否还在。

`since_ts`（当前写健康）SHALL 记录本段 `degraded` 首次失败时间，恢复时归零；`history_gap.since_ts` SHALL 记录本段首次缺口时间，新逻辑会话时归零。

健康状态 SHALL 在 `harness_state` 快照的 `persistence` 键与 `harness:event` 的 `persistence` 事件两处呈现，**同键同值**：顶层 `state` / `since_ts` / `severity` / `detail` / `history_written` / `history_gap` 六键恒在场；`history_gap` 内 `present` / `since_ts` / `detail` 三键恒在场。`state=ok` 时 `severity` 为 `null`、`since_ts` 为 0、`detail` 为空串；`history_gap.present=false` 时其 `since_ts` 为 0、`detail` 为空串。事件与快照 MUST 共用同一份序列化，MUST NOT 各列一份键清单。`state=ok` 且 `history_gap.present=true` 是合法状态，MUST NOT 被呈现为健康。

事件 SHALL 在以下跃迁时发出：当前写健康 `ok→degraded`、`degraded→ok`、`annotation→history`；历史缺口 `false→true`；`history_written` `false→true`。一次失败 / 成功可同时改变多项，发出一条完整载荷；`degraded→ok` 且缺口仍为 true 的恢复事件 MUST 发出。重复失败不发事件，快照是重挂载 / 重载时的地板。

呈现：`history_gap.present=true` 期间，harness 面板 SHALL 在 composer 上方持续显示一条状态行（`role="status"`），文案 MUST 明确「此前部分记录缺失 / 这段历史可能不完整」；`state=ok` 时 MUST 明确「写入已恢复，但此前记录缺失」。`state=degraded` 且缺口在场时，文案 MUST 同时说明当前写入仍在失败；`state=degraded` 且无缺口时，状态行按 `severity` 显示当前失败。`history_written=false` 且存在任何持久化告警（`state=degraded` 或缺口）时，文案 MUST 额外说明「本次会话的新记录尚未落盘，退出后无法恢复」；`history_written` 转 true 后该句消失，缺口文案仍保留。状态行不自动消隐、不随轮次结束消失、不提供关闭按钮；`state=ok` 且无缺口时 SHALL 隐藏（`history_written=false` 本身不构成告警，只在已有告警时追加提示）。

本逻辑会话首次进入 `severity=history`（包括先 `annotation` 后升级为 `history`）或 `history_gap` 首次 `present=true` 时，SHALL 额外给一条 sticky 提示，每个逻辑会话只一条，按文案去重，面板重挂载不重复。sticky MAY 点击关闭；关闭只移除本次提示，MUST NOT 隐藏状态行、MUST NOT 清除 `history_gap`、MUST NOT 被视为对未来失败的静音。两类呈现 MUST NOT 提供额外的「忽略 / 静音」控件（关闭 sticky 只等于关闭本次提示），MUST NOT 写配置项。

切 vault 只切换当前展示的会话快照，MUST NOT 清除或重置任何会话的健康；切回时 SHALL 显示该会话自身仍 latch 的状态。显式「新会话」SHALL 立即清除当前会话健康（含 `history_gap` 与 `history_written`），面板 MUST NOT 继续显示旧状态；从历史恢复 / app 重启后重新建立会话，从空健康起算。自动压缩开新文件 SHALL 沿用两维与 `history_written`，直到新文件首次成功追加；该成功只把当前写健康转 `ok`，MUST NOT 清除缺口。

每次写失败 SHALL 另落一条结构化诊断日志（记录种类 + 错误分类 + 是否可能部分写）；日志 MUST NOT 含消息正文、文档内容或 system prompt。

会话目录创建失败 SHALL 仍走既有 `harness_jsonl_failed` 硬错误（发送被拒），不进入健康状态。子运行审计流水、composer 草稿、附件 MUST NOT 进入本状态。健康只覆盖「本次 write 系统调用是否成功」，MUST NOT 被理解为对 `fsync`、断电、外部删除或写到旧 inode 的保证。隔离运行（无人值守）SHALL NOT 向面板呈现健康，只进日志。

#### Scenario: 当前写失败与恢复

- **WHEN** 一条 `session_title`（sidecar）写入干净失败（未写入任何字节），随后下一次追加成功
- **THEN** 失败后 `state=degraded`、`severity=annotation`、`history_gap.present=false`；成功后 `state=ok`、`severity=null`、缺口仍为 false；状态行随两次跃迁显示 / 隐藏

#### Scenario: 历史失败后成功恢复写能力，缺口仍在

- **WHEN** 一条 `llm_request` 写入失败；随后恢复可写并完成下一次成功追加
- **THEN** 失败后 `state=degraded`、`severity=history`、`history_gap.present=true`；成功后 `state=ok`、`severity=null`，但 `history_gap.present` 仍为 true；事件发出 `state=ok` + gap true 的恢复载荷；面板显示「写入已恢复，但此前记录缺失」，MUST NOT 回到健康文案

#### Scenario: 压缩轮换沿用缺口

- **WHEN** 会话处于 `history_gap.present=true` 时自动压缩开新文件，且新文件首次追加成功
- **THEN** 当前写健康转 `ok`，`history_gap.present` 仍为 true；缺口不被新文件洗白

#### Scenario: 切 vault 不清健康

- **WHEN** vault A 的会话已有 `history_gap.present=true`，用户切到 vault B（B 的会话健康为 `ok`），再切回 A
- **THEN** 切到 B 时显示 B 自身的健康；切回 A 时 A 的缺口仍在；切 vault 本身 MUST NOT 产生清除或缺口的重置

#### Scenario: 新会话与恢复重置两维

- **WHEN** 用户显式「新会话」，或从历史恢复产生新会话，或 app 重启后重新建立会话
- **THEN** 两维与 `history_written` 都从空健康起算（`state=ok`、`history_gap.present=false`、`history_written=false`）；面板 MUST NOT 继续显示旧会话的状态行；旧缺口只留在盘上与日志，app 重启后 MUST NOT 补报旧告警

#### Scenario: 严重度与缺口触发

- **WHEN** 同一会话先发生 `session_title` 干净失败，再发生 `llm_request` 干净失败，随后发生 `approval` 部分写失败
- **THEN** 第一次为 `annotation` 且无缺口；第二次为 `history` 且置缺口；第三次仍为 `history`、缺口保持；`annotation` 失败不降级 `history`

#### Scenario: annotation 失败不清缺口

- **WHEN** `history_gap.present=true` 且当前写健康为 `ok` 时，发生一次 `session_title` 干净失败，随后成功
- **THEN** 失败期间 `state=degraded`、`severity=annotation`，缺口仍为 true；成功后 `state=ok`，缺口仍为 true

#### Scenario: 首行干净失败 + history payload

- **WHEN** 首行 `session_open` 在未写入任何字节时失败，而本次 `record(payload)` 的 payload 是 `llm_request`；随后恢复可写并写入下一条记录
- **THEN** 写点保留挂起行；重试成功后首行是 `session_open`，但本次 `llm_request` 已随失败丢失、MUST NOT 被后续成功补回；`history_gap.present=true`，后续成功只把当前写健康转 `ok`；`history_written` 在一条 history 记录真正成功前保持 false

#### Scenario: 首行干净失败 + annotation payload

- **WHEN** 首行 `session_open` 在未写入任何字节时失败，而本次 payload 是 `session_title`；随后恢复可写并写入下一条记录
- **THEN** 写点保留挂起行；重试成功后首行是 `session_open`；`history_gap.present=false`（annotation 丢失不 latch），当前写健康回 `ok`；本场景 MUST NOT 被理解为「部分写也可恢复」的保证

#### Scenario: 尚未落盘的风险提示

- **WHEN** `history_written=false` 且存在持久化告警（首行 + `llm_request` 失败后尚无任何 history 记录成功）
- **THEN** 状态行除缺口文案外 MUST 明确「本次会话的新记录尚未落盘，退出后无法恢复」；随后一条 `llm_request` 成功写盘使 `history_written=true`，该句消失，但缺口文案仍保留

#### Scenario: 前缀写入后报错

- **WHEN** 一次 `llm_request` 或 sidecar 写入先写入若干字节、随后返回错误
- **THEN** 当前写健康为 `degraded`、`severity=history`、`history_gap.present=true`；后续成功追加 MUST NOT 清除缺口；系统 MUST NOT 声称该文件仍可被完整读取 / 恢复；新逻辑会话才清除缺口

#### Scenario: 快照与事件同键同值

- **WHEN** 健康状态发生一次跃迁（含 `state=ok` + gap true 的恢复、`history_written false→true`）
- **THEN** `persistence` 事件的顶层六键与 `history_gap` 三键同 `harness_state` 快照逐键同值（同一份序列化）；事件另带 `type=persistence` 与 `vault` 信封

#### Scenario: 缺口恢复后的呈现与消退

- **WHEN** 当前写健康回 `ok` 但 `history_gap.present=true`，随后用户开始新会话
- **THEN** 新会话前状态行持续显示缺口文案（不自动消隐、无关闭按钮），MUST NOT 呈现为健康；新会话后状态行隐藏

#### Scenario: 首次 history 的 sticky 含升级

- **WHEN** 本逻辑会话先发生 `annotation` 失败（只亮状态行），随后升级为 `history` 失败
- **THEN** 在进入 `history` 的那一刻给一条 sticky 提示；这是本逻辑会话唯一一条；关闭并重开面板不重复

#### Scenario: 关闭 sticky 不等于静音

- **WHEN** sticky 提示在场，用户点击关闭它
- **THEN** 只移除本次提示；状态行仍在、`history_gap` 不变、不写配置；新逻辑会话仍可再次触发 sticky

#### Scenario: 旧快照缺键不误报

- **WHEN** 前端收到不含 `persistence` / `history_gap` / `history_written` 键的旧快照
- **THEN** 视为 `ok` / `present=false` / `history_written=true`：不显示状态行、不弹提示、不误报「尚未落盘」；会话其余内容照常恢复

#### Scenario: 隔离运行不呈现

- **WHEN** 无人值守运行发生留存写失败
- **THEN** 面板收不到 `persistence` 事件、无状态行；诊断日志有记录；交互会话的健康不受影响

#### Scenario: 写失败不阻断对话

- **WHEN** 留存写入失败期间用户继续一轮对话
- **THEN** 轮次照常完成、消息照常上屏；新增的只有健康状态与诊断日志，MUST NOT 出现用户侧「发送失败」
