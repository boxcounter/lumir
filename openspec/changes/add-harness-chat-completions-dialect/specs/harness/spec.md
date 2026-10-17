# harness 增量规格

> 起草注记（非规格正文）：本 change 给 kimi provider 增加 Chat Completions wire 方言。
> 决策与证据见 [design.md](../../design.md)；三条 MODIFIED 的基线正文在
> `openspec/specs/harness/spec.md`（配置节 [harness] / 会话本地留存 / 上下文用量显示与触顶处理），
> 除下列标注改动外逐字保留。

## ADDED Requirements

### Requirement: Chat Completions 方言

kimi provider 在 `wire_api = "chat_completions"` 时 SHALL 走 Chat Completions 形态：`POST {base_url}/chat/completions`，请求体为 `{model, messages, tools, tool_choice:"auto", stream:true, stream_options:{include_usage:true}}`；**模型声明支持思考档位时** SHALL 另带 `thinking:{type:"enabled", effort, keep:"all"}`，未声明时 MUST NOT 发该字段；MUST NOT 发 `include` / `store` / `reasoning` / `max_tokens` / `max_completion_tokens` 字段。会话内部历史（`Session.input`）SHALL 保持既有 Responses item 形态不变——items → messages 的翻译 SHALL 发生在发送边界的单一构造点（`wire_body` 与 `wire_body_bytes` 共用一份构造，纪律同 Responses 侧），MUST NOT 改写留存项。翻译规则：system 为首条 `{role:"system"}` 消息；reasoning 项的明文 SHALL 折叠进**其后第一条 assistant 消息**的 `reasoning_content`（多段拼接；带 `tool_calls` 的 assistant 消息同样 SHALL 携带——该端点对缺失 `reasoning_content` 的 tool 调用消息返回 400）；一轮的 N 个 function_call SHALL 合并为**单条** `{role:"assistant", tool_calls:[...]}` 消息，其后 SHALL 紧随 N 条 `{role:"tool", tool_call_id}` 消息、中间 MUST NOT 插入其它消息；`input_image` 附件 SHALL 译为 `image_url` content part（展开点不变）；悬空 function_call（恢复边界：无配对 output）SHALL 在翻译时丢弃并落诊断记录。usage SHALL 映射到既有读数结构（`prompt_tokens`→`input_tokens`、`cached_tokens` 或 `prompt_tokens_details.cached_tokens`→`cached_tokens`、`completion_tokens`→`output_tokens`、`cache_write_tokens` 记 0），ctx% / cache% 读数口径与 Responses 方言一致。超限判定 SHALL 命中 chat 方言文案（`token limit` / `total message size` / `supports only 256k context`），触发与 Responses 方言同一套「自动压缩 + 重试一次」兜底。错误路径的 HTTP 面诊断（`http_status` / `raw_body` / `request_id`）SHALL 与 Responses 方言同一份。

#### Scenario: 发送形状

- **WHEN** kimi provider 配置 `wire_api = "chat_completions"` 并完成一轮对话
- **THEN** 请求发往 `{base_url}/chat/completions`，body 为 messages 形态（system 居首）；声明支持思考档位的模型带 `thinking` 字段；body 不含 `include` / `store` / `max_tokens` 字段

#### Scenario: reasoning 回放折叠

- **WHEN** chat 方言下历史含 reasoning 项（含模型只发工具调用、无正文的轮次）
- **THEN** 该轮 reasoning 明文折叠进其后第一条 assistant 消息的 `reasoning_content`；带 `tool_calls` 的 assistant 消息同样携带 `reasoning_content`

#### Scenario: 工具调用配对顺序

- **WHEN** chat 方言下一轮产生多个工具调用
- **THEN** 请求历史中是单条含 `tool_calls` 的 assistant 消息、紧随每个 call 各一条 `tool` 消息，其间无其它消息

#### Scenario: usage 读数映射

- **WHEN** chat 方言下完成一轮带 usage 的对话
- **THEN** 控制行与气泡读数由映射后的 usage 产出，与 Responses 方言同一份 `UsageSnapshot` 口径（含绝对值键与事件/快照同键同值不变量）

#### Scenario: 超限兜底

- **WHEN** chat 方言返回上下文超限类错误（`token limit` / `total message size` / `supports only 256k context` 文案）
- **THEN** 系统自动压缩并重试该轮一次；仍失败才向面板报错

#### Scenario: 跨方言恢复续聊

- **WHEN** 恢复一份 Responses 时期留存的会话（`session_open` 无 `wire_api` 或值为 `responses`），随后以 chat 方言续聊
- **THEN** 发送的 messages 由留存 items 经翻译层产出，留存 JSONL 不被改写；恢复充分性判据在两种方言下各自成立

#### Scenario: 缺省行为不变

- **WHEN** 配置未写 `wire_api`（或显式 `responses`）
- **THEN** 请求形状、字段集与行为与既有 Responses 方言逐字节一致

## MODIFIED Requirements

### Requirement: 配置节 [harness]

`config.json` SHALL 支持 `[harness]` 节：`provider`（闭集合 `kimi` / `deepseek` / `mock`）、`providers` 表（各 provider 的 `api_key` / `model` / 可选 `base_url` / 可选 `wire_api`——闭集合 `responses` / `chat_completions`，缺省 `responses`；v1 仅 kimi 实现 chat 档，其余 provider 配置 chat 档 SHALL 回落 `responses` 并给 warning；mock 为 `fixture` 路径）、`permissions`（`allow` / `deny` 规则表）、`permission_mode`（闭集合 `read_only` / `vault_write` / `full_access`，默认 `vault_write`）、`loop_max`、`warn_ctx_pct`。校验 SHALL 沿用既有模板：缺字段回落默认不告警；闭集合取值非法回落默认 + 人话 warning；类型不符整文件回落（ADR 0002 §5）。运行期写回 SHALL 经泛化的 `config_set_value(section, key, value)`，`ui` 表既有行为不变。

#### Scenario: 非法 provider 回落

- **WHEN** 配置里 `provider` 为闭集合外的值
- **THEN** 启动不失败，provider 回落默认并产生一条人话 warning

#### Scenario: 非法 permission_mode 回落

- **WHEN** 配置里 `permission_mode` 为闭集合外的值（或类型不符）
- **THEN** 启动不失败，模式回落 `vault_write` 并产生一条人话 warning（类型不符时整文件回落）

#### Scenario: 非法 wire_api 回落

- **WHEN** 某 provider 的 `wire_api` 为闭集合外的值
- **THEN** 启动不失败，该 provider 的方言回落 `responses` 并产生一条人话 warning；deepseek 配置 `chat_completions` 同样回落并告警（v1 未实现其 chat 档）

#### Scenario: 切换写回持久化

- **WHEN** 在面板权限 chip 把模式从 `vault_write` 切到 `read_only`
- **THEN** 下一个判定按 `read_only` 执行；`config.json` 的 `[harness].permission_mode` 被写回为 `read_only`，重启后保持

### Requirement: 会话本地留存

会话 SHALL 以 wire/input 形态落配置目录（MUST NOT 写入 vault），作为 ADR 0007 双向记录机制的一侧：每会话一个 append-only JSONL 文件（`<config_dir>/harness/sessions/<vault 稳定 id>/<session_id>.jsonl`），文件首行 SHALL 为 `session_open` 记录——含 session id、vault 根路径、provider / 模型 / 思考档位 / **wire 方言（`wire_api`，缺省值同样在场）**、**完整装配后 system prompt 全文**与装配清单（每个来源的路径、存在与否、字节数；不存在的来源 SHALL 同样在场）、**读数种子**（M526：恢复 / 压缩开文件时在场——`usage` 读数快照 + `cache_totals` 累计四元组；链式恢复从这里起算，全新会话不落这两键）。`<vault 稳定 id>` SHALL 是 vault 注册表 id（与 `vault-sessions/<id>.json`、`reading-positions/<id>.json` 同一份身份），MUST NOT 用 vault 路径派生的消毒名（消毒名有撞名面且无长度 / 字符集保证，M309 现场）。每次发给模型的请求（含工具循环的每次迭代与压缩调用）SHALL 落一条 `llm_request` 记录（完整请求体：system + messages + 参数，**另带本次实际发送体的字节数 `request_bytes`**——按 wire 展开后的尺寸算，省掉「按字节比外推请求多大」；不具备真实 HTTP body 的 mock 档省略该键），每次响应 SHALL 落一条 `llm_response` 记录（正文 / 思考归一回放项与展示文本 / 工具调用 / usage（SHALL 含 input / cached / output 与**缓存写入 `cache_write_tokens`**——provider 不提供时按 0 记录）/ 错误；思考 MUST 落盘——**回放项归一回放形状**（`{"type":"reasoning", summary, [content], [encrypted_content]}`：kimi 的明文载体是 `summary`、deepseek 的是 `content`，各按在场项保留；`encrypted_content` 有则在场），`id` 字段 MUST NOT 进入回放项（`store:false` 下重放 `rs_*` id 属非标用法），展示文本另存）；请求侧在 **Responses 方言**且模型声明支持思考档位时（判据 `HarnessConfig::effort_supported`，读配置 schema 的 per-model `effort` 声明）SHALL 带 `include:["reasoning.encrypted_content"]`（store:false 官方回放模式的前提——让服务端在 reasoning item 里回传密文，重放时无需 id 即可还原）；未声明 effort 的模型（含 deepseek 现役形态）MUST NOT 发该字段；**Chat Completions 方言 MUST NOT 发 `include` / `store`**，其 wire 形态与思考回放字段见「Chat Completions 方言」条；wire 不可推导的决策与事件（批准 / 拒绝、停止中断、LLM 错误、循环上限）SHALL 以 sidecar 记录留存——其中 **LLM 错误的 sidecar 记录 SHALL 另带 HTTP 面诊断**（非 2xx 时的 HTTP 状态码、原始响应 body——按固定上限截断防巨型 body 撑爆留存、服务端 request id 若响应头或 body 提供；不具备 HTTP 面的错误省略这些键），且**错误事件的既有形态（`type`/`code`/`message`）不变**（新诊断只进留存，不破坏既有消费方），被 wire 覆盖或失去意义的 11 类事件 kind（`user_message` / `assistant_text` / `tool_call` / `tool_result` / `usage` / `tool_denied` / `compact` / `session_reset` / `approval_overwritten` / `approval_withdrawn` / `turn_abort_requested`）SHALL NOT 再记（重复记录即第二事实源）。记录点 SHALL 与发送点同点，MUST NOT 经二次序列化产生第二事实源。验收口径 SHALL 为恢复充分性：仅凭 JSONL 能逐字节重建任意一轮发给模型的请求——wire 体由留存 + 代码版本 + `wire_api` 方言共同推导，`session_open` 的方言键是推导依据之一。

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

- **WHEN** mock provider 跑完一轮含工具循环的对话（消息含 `<quote>` 块、响应含思考文本）
- **THEN** 仅凭 JSONL 独立重建的每个请求与落盘 `llm_request` 深度相等（逐字节重建判据）；第 i 条响应的正文 / 思考 / 工具调用与第 i+1 条请求的历史对应项逐字节一致

#### Scenario: 思考落盘与回放

- **WHEN** 一轮响应含 reasoning 文本，其后一轮把上一轮响应的 reasoning 项带回历史
- **THEN** `llm_response` 记录思考——回放项（**归一形状**：剥掉 `id`、`MUST NOT` 含 `id`；保 `summary` / `content` / `encrypted_content`）与展示文本（给人看）分别在 `reasoning` / `thinking` 字段；后续请求的历史中该归一后的 reasoning 回放项逐字节在场，且 Responses 方言请求体在模型声明支持思考档位时带 `include:["reasoning.encrypted_content"]`（chat 方言不带该字段，其回放形态见「Chat Completions 方言」条）；恢复旧会话（记录早于本改动、reasoning 项仍带 `rs_*` id）时，重建的 input 同样不含 `id`

#### Scenario: 缓存写入随 usage 落盘

- **WHEN** provider 的响应 usage 带回 `cache_write_tokens`，完成一轮对话
- **THEN** 对应 `llm_response` 记录的 `usage` 块含 `cache_write_tokens` 原值；provider 不提供该字段时记为 0

### Requirement: 上下文用量显示与触顶处理

composer 控制行 SHALL 常驻显示上下文用量读数（位于模型 chip 之后、发送钮之前）：context window 已用 %（最近一次请求的 input tokens ÷ 模型上下文窗口）与 cache hit %（Responses 形态下两 provider 统一走 `usage.input_tokens_details.cached_tokens`；映射表留在 provider 预设内防字段方言）。cache hit % SHALL 以**本逻辑会话累计命中率**（`Σcached_tokens ÷ Σinput_tokens`；会话建立、「新会话」重置、自动压缩开新逻辑会话各起一段、累计随之归零；**从历史恢复 SHALL 以源会话留存的读数为基底继续累计**——恢复时由留存重算：`session_open` 读数种子 + 其后会话轮次 usage 扫描，压缩调用是内部汇总调用、不计入）作为控制行**主读数**，MUST NOT 以最近一次请求的单回合命中率作为控制行主读数。**hover 气泡 SHALL 只呈现两项读数**（M533，Alex 2026-10-16：「气泡内容太冗余了。只需要这些信息：1. 当前上下文使用量和百分比。如果 ≥85 使用率，提示下一轮对话将自动压缩。2. 会话的缓存命中率」）：①上下文用量行——百分比 + 绝对 tokens 用量（M526；上下文已用 tokens / 模型窗口上限 tokens 与百分比同句），数据不可得时 SHALL 降级（绝对值缺键回落百分比形态、窗口上限值为零时不显示上限与百分比），MUST NOT 编造读数；②会话缓存命中率行——**只呈现百分比**（M533 是对 M526 需求 2 里 cache tokens 读数的显式 supersede，写法取 Alex 原话「缓存命中率（会话）：60%」；该行的百分比口径 SHALL 是会话累计，与控制行同一份读数）。**最近一次请求的单回合命中率、成因说明（冷启动 / 大块摊薄）与缓存写入 tokens SHALL NOT 出现在气泡里**（M533 移除这三项的上屏面）——三者 SHALL 仍随 `llm_response.usage` 进会话留存（见「会话本地留存」条），只是不再有上屏面。**气泡内的 tokens 数字 SHALL 以 k / m 为单位呈现**（M532，Alex 2026-10-16：「token 的最小单位是 k，如果超过 1000k，就升级成 m。让数字更加人可读 好理解」）：≥1,000,000 → `m` 档、≥1,000 → `k` 档、不足 1,000 原值直出（不带单位）；小数 SHALL 截断到 0.1 档（MUST NOT 四舍五入）、末尾 `.0` SHALL 省略（`1k` 而非 `1.0k`）。格式化 SHALL 由单一纯函数（`formatTokenCount`，`src/harness-panel.ts`）产出——M533 起气泡里只剩上下文用量行含 tokens 数字（D463 已用/上限、D464 降级行的已用）共此一份，MUST NOT 自行拼装；数字形态 MUST NOT 改变各行的在场 / 降级判定（绝对值缺键回落百分比形态、窗口上限为零时降级两条判定与单位无关）。控制行的百分比读数（ctx% / cache%）不是 tokens 数字，不受本规则约束。**从未发过请求的会话（快照 `has_usage=false`）读数区 SHALL NOT 渲染**（六键零值是缺省不是读数，渲染即成「0% · 0%」虚报）。**读数的两条载体 SHALL 携带同一组键**（M534，事件/快照一致性不变量）：`harness:event` 的 `usage` 事件与 `harness_state` 快照的 `usage` SHALL 携带同一组读数键（由同一份 `UsageSnapshot` 的序列化产出，含绝对值键 `input_tokens` / `cached_tokens` / `cached_tokens_session` / `context_window` / `has_usage`），MUST NOT 各维护一份键清单——新增读数键时两类载体 SHALL 同改。live 会话与快照 / 恢复路径因此渲染同一形态的读数（事件缺键会让 live 气泡静默回落百分比形态，而切 vault 回来走快照路径却带绝对值——M534 现场）；前端 MUST NOT 为任一载体另行推算读数。用量超过警示阈值（默认 85%，可配）时读数 SHALL 高亮，指针悬停读数 SHALL 浮出说明气泡（向上展开、右缘对齐读数右缘）、移开即收起；越线时气泡 SHALL 追加一行警示说明、点明**下一轮对话将自动压缩**（M533 措辞改准；该行恒在含义句之后）且 MUST NOT 复述同一行的百分比——用量行已显示过它，MUST NOT 常驻显示警示句，也 SHALL NOT 另挂 ⓘ 类可点入口（2026-10-07 去感叹号改 hover 形态，读数高亮已承担警示语义）。系统 SHALL 默认自动压缩（`auto_compact = true`）：每轮响应完成后检查，越阈值即自动把会话历史压缩为摘要、开新逻辑会话并注入摘要 + 当前编辑器上下文 + 系统上下文；自动压缩 MUST NOT 静默——面板插入可见压缩标记（摘要可展开），压缩前历史 SHALL 完整留存在旧会话 JSONL 文件（封闭不再追加），压缩摘要 SHALL 随新会话 `session_open` 留存。API 返回上下文超限错误时 SHALL 自动压缩后重试该轮一次。系统 MUST NOT 静默截断会话历史。

> **已知边界收口（2026-10-17 根因调查结论，替代 2026-10-12 起的「调查进行中」注）**：k3-256k 在 coding 端点（`api.kimi.com/coding/v1`）Responses 方言下「回报 `input_tokens` 不足名义窗口一半即被 400」的现象，根因已钉死为该端点 Responses 路径前置的**请求体字节闸**——按请求体 UTF-8 字节数判定，边界实测 `(417,231, 417,512]` 字节；报错文案 `Your request exceeded k3-256k model token limit: 262144` 的 262144 是名义窗口、不是闸的计数单位（决定性证据：417,985 B 纯英文合成请求外推仅 ~8.1 万 tokens 仍被 400，而 104,571 tokens / 417,231 B 的请求通过）。同账号同模型 **Chat Completions 方言**实证可正常服务到 211,055（普通轮）/ 234,656（压缩轮）input tokens、请求体 0.83–1.1 MB 放行——41.7 万字节是 Responses 方言专属，非账号/模型上限。证据 `test-results/ctxdiag-2026-10-17/`（git 外）。
>
> 对 meter 的含义：chat 方言下 `input_tokens ÷ 262,144` 的分母恢复诚实，`warn_ctx_pct`（默认 85%）重新可达，主动压缩路径恢复有效；Responses 方言下 85% 预警结构性不可达（触发需 ~89 万字节请求体，远超 41.7 万字节闸），只剩 400 错误路径兜底。「超限时 meter 是否同步读数」（错误路径 return 早于 `record_usage`，读数停在旧值）仍待裁（`docs/backlog.md`）。

#### Scenario: 用量显示

- **WHEN** 完成一轮对话（含 mock provider 给出的 usage 数值）
- **THEN** 控制行读数显示与 usage 字段一致的 ctx% 与会话累计 cache hit%；读数位于模型 chip 与发送钮之间

#### Scenario: 会话累计读数跨回合

- **WHEN** 同一逻辑会话内先后完成多个带 usage 的回合
- **THEN** 控制行 cache 读数 SHALL 等于该会话至今的 `Σcached_tokens ÷ Σinput_tokens`（MUST NOT 只反映
  最近一回合的单回合值）；开启新逻辑会话（「新会话」重置 / 自动压缩）后累计 SHALL 重新起算

#### Scenario: 气泡的行集（用量 + 命中率）

- **WHEN** 完成一轮带 usage 的对话后悬停读数
- **THEN** 气泡只呈现两行含义句：上下文用量行（百分比 + 绝对 tokens 用量）与会话缓存命中率行；
  该回合的单回合命中率、成因说明、缓存写入 tokens 三行 SHALL NOT 出现（M533 行集精简，三者在
  留存里仍可查）；越线时在其后追加警示行

#### Scenario: 气泡呈现绝对 tokens 用量

- **WHEN** 完成一轮对话后悬停读数（usage 读数带绝对值字段：input tokens 与模型窗口——事件与快照同一组键，见下条 scenario）
- **THEN** 气泡的上下文用量行 SHALL 同句呈现上下文已用 tokens、模型窗口上限 tokens 与百分比；
  绝对值缺键（旧后端载荷）时该行回落百分比形态；窗口上限值为零（无上限值）时该行 SHALL NOT 显示
  上限与百分比、走降级文案（MUST NOT 编造读数）。命中率行 SHALL 只呈现百分比，MUST NOT 带 tokens 计数
  （M533 的显式 supersede），其口径 SHALL 与控制行同为会话累计

#### Scenario: usage 事件与状态快照同键同值

- **WHEN** 完成一轮带 usage 的对话（live 路径）
- **THEN** `harness:event` 的 `usage` 事件与 `harness_state` 快照的 `usage` SHALL 携带同一组读数键与
  同一个值（含绝对值键 `input_tokens` / `cached_tokens` / `cached_tokens_session` / `context_window` /
  `has_usage`），两者 SHALL 由同一份 `UsageSnapshot` 的序列化产出；任一侧 MUST NOT 出现对侧没有的
  读数键（判别键 `type` 除外），live 会话与切 vault 回来 / 恢复的读数形态 SHALL 一致

#### Scenario: 单个回合的命中低谷不产生气泡行

- **WHEN** 某一回合 `cached_tokens` 为零（会话首个请求的典型冷启动，或前缀缓存过期），或该回合新增
  tokens 超过已缓存前缀的一半（大块内容摊薄）
- **THEN** 控制行主读数仍显示会话累计值；气泡里 MUST NOT 出现该回合的单回合值，也 MUST NOT 出现
  任何成因说明句（两种情形仍随 `llm_response.usage` 落留存，供事后排查）

#### Scenario: 气泡 tokens 数字走 k / m 单位

- **WHEN** 气泡的上下文用量行呈现 tokens 数字（上下文已用 / 模型窗口上限，含无上限降级行的已用值）
- **THEN** ≥1,000,000 的读数 SHALL 以 `m` 为单位、≥1,000 的读数 SHALL 以 `k` 为单位、不足 1,000 的读数
  SHALL 以原值直出（`0` 呈 `0`、不呈 `0k`）；小数 SHALL 截断到 0.1 档（MUST NOT 四舍五入）且末尾 `.0`
  省略。边界以四条定档：`999` → `999`、`1000` → `1k`、`999999` → `999.9k`（k 档 MUST NOT 出现 `1000k`）、
  `1000000` → `1m`；同一规则 SHALL 同时适用于无上限降级行

#### Scenario: 空会话不假读数

- **WHEN** 会话尚未发出过任何请求（快照 `has_usage=false`，如「新会话」后或恢复了一个空会话）
- **THEN** 控制行读数区 SHALL NOT 渲染（不出现「0% · 0%」）；首次带 usage 的回合完成后读数 SHALL 出现真值

#### Scenario: 恢复后读数接续源会话

- **WHEN** 从历史会话恢复续聊（源会话留存的记录里含带 usage 的回合）
- **THEN** 恢复后控制行与气泡 SHALL 显示源会话最近一次真实读数（留存重算：首行读数种子 + 其后会话轮次
  usage 扫描，压缩调用不计入）；其后的会话累计 SHALL 从源会话的累计接着算（链式恢复从各文件首行的种子
  起算，不断档）；源会话从未发过请求时读数区保持隐藏

#### Scenario: 超阈值警示收敛为悬停气泡

- **WHEN** ctx% 越过警示阈值
- **THEN** 读数高亮；指针悬停读数时浮出说明气泡、移开即收起；越线时气泡在含义句之后追加一行警示说明，
  点明下一轮对话将自动压缩（M533 措辞），且 MUST NOT 复述用量行刚显示过的百分比；界面不出现常驻警示句、
  无 ⓘ 入口

#### Scenario: 自动压缩

- **WHEN** 一轮响应完成后 ctx% 越过警示阈值
- **THEN** 系统自动生成会话摘要并开新逻辑会话；面板出现可见的压缩标记，摘要可展开查看；后续对话在新会话上继续；压缩前历史完整留存在旧 JSONL 文件、摘要随新文件 `session_open` 留存

#### Scenario: 超限兜底

- **WHEN** API 返回上下文超限错误
- **THEN** 系统自动压缩并重试该轮一次；仍失败才向面板报错
