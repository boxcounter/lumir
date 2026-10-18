# harness 增量规格

> 起草注记（非规格正文）：本 change 给 harness 增加会话自动命名。决策与参数见 [design.md](../../design.md)；三条 MODIFIED 的基线是 `openspec/specs/harness/spec.md` 当前正文，并保留已实现未归档 change `add-harness-chat-completions-dialect` 已写入的 wire 方言条款（该 change 同时改「配置节 [harness]」与「会话本地留存」；归档顺序对账见 design D17），除下列标注改动外逐字保留。

## ADDED Requirements

### Requirement: 会话自动命名

系统 SHALL 为每个逻辑会话维护一个**会话标题**，并按以下时机以辅助 LLM 调用完成生成或重估：①该会话首轮对话正常完成（首条用户消息得到最终响应）后生成初始标题；②距上一次完成的评估满 5 轮时重估（一轮 = 一条用户消息及其最终响应；工具循环中的多次模型请求不另计，`aborted` / 错误收尾的轮不计）；③话题漂移信号命中时重估——会话已有有效标题，且连续两条用户消息（各不少于 8 个码点）与当前标题的确定性词元重合度低于阈值（标题词元在消息中出现的比例 < 0.2；标题词元不足 3 个时不判漂移）。任何两次评估之间 MUST 至少间隔 3 轮，漂移信号 MUST NOT 把间隔压到更短；同一逻辑会话同时最多一个命名调用在途，在途期间的新触发点 SHALL 跳过（不排队）。尚无有效标题时（首个正常轮已过、初始生成失败或尚未成功），系统 SHALL 在下一个满足 3 轮下限的正常完成轮重试初始生成（`reason=first-turn`），直到成功——周期与漂移触发都以「已有有效标题」为前提，这条重试路径是唯一兜底。

每次评估 SHALL 是一次**便宜档辅助调用**：不带工具；模型声明支持思考档时使用最低档 `Low`，未声明时不发该字段；素材只含当前标题、首轮问答与最近两轮问答的正文（剔除工具调用参数与结果、图片附件、思考文本与自动注入的编辑器上下文节）；首轮每条 ≤500 码点、最近两轮每条 ≤400 码点、整份素材 ≤3000 码点，超长按码点截断。输出由 prompt 约束为一行判定，不依赖 provider 的 `max_output_tokens`（该字段在 Responses 端点被忽略）。

生成器 SHALL 输出 `keep` / `rename` 判定（JSON：`{"decision":"keep"}` 或 `{"decision":"rename","title":"…"}`）：当前标题仍能描述当前对话时 SHALL 输出 keep（拿不准一律 keep）；仅当当前标题已失真（话题已转移或标题明显错误）且新标题显著更好时才输出 rename。系统 MUST 只在 rename 且标题通过规范化校验时替换标题：规范化后须为单行、1–20 个码点、剥除包裹引号 / 反引号与句末标点，且与当前标题不同；keep、非法 JSON、空标题、超长、调用失败或超时一律保持当前标题不变（尚无当前标题的初始生成里，keep 无可保持的对象，SHALL 按 `invalid` 处理并走初始重试路径）。命名调用的失败或「不换名」结果 MUST NOT 向用户报错、MUST NOT 弹 toast、MUST NOT 中断或阻塞对话轮次。

自动命名 SHALL 默认开启（`[harness].auto_title = true`）；关闭时 MUST NOT 发起任何命名调用、MUST NOT 写标题记录，既有标题记录照常展示。命名调用使用的模型 SHALL 取当前 provider 的 `[harness].providers.<id>.title_model`；未配置时取该 provider 的生效模型（此时便宜档只由调用形态保证——本仓无模型价格表，见 design D8）。

标题 SHALL 只承担会话身份的展示：标题变化 SHALL 经状态快照与事件通道到达面板并即时更新标题栏会话名与已打开的历史浮层行名，MUST NOT 修改 transcript、session id、历史排序、会话内容或 vault 内任何文件。标题的留存、继承与回落口径见「会话本地留存」与「会话边界」条。

#### Scenario: 首轮后生成标题

- **WHEN** mock provider 完成一条用户消息及其最终响应，fixture 的 `titles` 脚本给出 `{"decision":"rename","title":"Rust 生命周期排查"}`
- **THEN** 标题栏会话名显示「Rust 生命周期排查」；会话 JSONL 追加一条 `session_title` 记录（`decision=initial`、`reason=first-turn`、`model` 为本次调用模型）；历史浮层中该会话行显示同一标题

#### Scenario: 每 5 轮重估

- **WHEN** 距上一次完成的评估已满 5 轮，会话完成第 5 轮的响应
- **THEN** 触发一次重估调用（`reason=cadence`）；keep 时标题不变，rename 且通过校验时标题更新

#### Scenario: 初始生成失败后重试

- **WHEN** 初始生成调用失败（尚无有效标题），其后又完成 3 轮正常对话
- **THEN** 在第 3 轮结束时重试初始生成（`reason=first-turn`），不早于 3 轮、也不等 5 轮周期；成功前会话名保持回落口径

#### Scenario: 话题漂移提前重估

- **WHEN** 会话已有标题，其后连续两条用户消息（各 ≥8 个码点）与当前标题的词元重合度均低于 0.2，且距上次评估已满 3 轮
- **THEN** 不等到 5 轮即触发重估（`reason=drift`）；重估结果仍受 keep / rename 防抖约束

#### Scenario: 显著更好才换

- **WHEN** 重估调用输出 keep，或输出的标题规范化后与当前标题相同
- **THEN** 会话标题保持不变，标题栏会话名与历史列表不变；留存追加一条 `decision=keep` 的记录（携带当时生效的标题）

#### Scenario: 非法输出不换名

- **WHEN** 生成器输出非法 JSON、未知 decision、空标题、超过 20 个码点、初始生成时输出 keep（无当前标题可保持），或调用超时 / 返回错误
- **THEN** 会话标题保持当前值，界面不出现错误提示或 toast；留存追加 `decision=error` 的记录并带错误码（`harness_title_invalid` / `harness_title_failed`），记录不含对话正文

#### Scenario: 关闭自动命名

- **WHEN** `[harness].auto_title = false` 并完成任意轮次对话
- **THEN** 系统不发起任何命名调用、不写 `session_title` 记录；会话名按「会话边界」条的回落口径显示

#### Scenario: 命名不阻塞对话

- **WHEN** 命名调用在途时用户发送下一条消息
- **THEN** 新一轮对话立即开始处理，不等命名调用结束；该结果若在新一轮进行中或会话已轮换后到达 SHALL 被丢弃（不写记录、不改标题）

#### Scenario: 标题更新不扰动会话

- **WHEN** 一次 rename 在会话空闲时生效
- **THEN** 标题栏会话名与已打开的历史浮层行名同步更新；transcript、消息顺序、滚动位置、焦点、session id 与历史清单顺序均不变

## MODIFIED Requirements

### Requirement: 配置节 [harness]

`config.json` SHALL 支持 `[harness]` 节：`provider`（闭集合 `kimi` / `deepseek` / `mock`）、`providers` 表（各 provider 的 `api_key` / `model` / 可选 `base_url` / `models` 模型清单（逐项 `{id, effort, vision, window}`；config-only，不内置模型表）/ 可选 `wire_api`——闭集合 `responses` / `chat_completions`，缺省 `responses`；v1 仅 kimi 实现 chat 档，其余 provider 配置 chat 档 SHALL 回落 `responses` 并给 warning / 可选 `title_model`——命名调用专用模型，须在该 provider 的 `models` 清单内声明，未声明时回落该 provider 的生效模型并给一条人话 warning；mock 为 `fixture` 路径且无 `title_model` 键）、`permissions`（`allow` / `deny` 规则表）、`permission_mode`（闭集合 `read_only` / `vault_write` / `full_access`，默认 `vault_write`）、`loop_max`、`warn_ctx_pct`、`auto_compact`（默认 `true`）、`auto_title`（默认 `true`）。校验 SHALL 沿用既有模板：缺字段回落默认不告警；闭集合取值非法回落默认 + 人话 warning；类型不符整文件回落（ADR 0002 §5）。运行期写回 SHALL 经泛化的 `config_set_value(section, key, value)`，`ui` 表既有行为不变。

#### Scenario: 非法 provider 回落

- **WHEN** 配置里 `provider` 为闭集合外的值
- **THEN** 启动不失败，provider 回落默认并产生一条人话 warning

#### Scenario: 非法 permission_mode 回落

- **WHEN** 配置里 `permission_mode` 为闭集合外的值（或类型不符）
- **THEN** 启动不失败，模式回落 `vault_write` 并产生一条人话 warning（类型不符时整文件回落）

#### Scenario: 非法 wire_api 回落

- **WHEN** 某 provider 的 `wire_api` 为闭集合外的值
- **THEN** 启动不失败，该 provider 的方言回落 `responses` 并产生一条人话 warning；deepseek 配置 `chat_completions` 同样回落并告警（v1 未实现其 chat 档）

#### Scenario: title_model 未声明回落

- **WHEN** 某 provider 的 `title_model` 非空、但不在该 provider 的 `models` 清单内
- **THEN** 启动不失败，命名调用回落该 provider 的生效模型并产生一条人话 warning；`title_model` 类型不符时整文件回落

#### Scenario: auto_title 缺省与类型不符

- **WHEN** 配置未写 `auto_title`，或写成非布尔值
- **THEN** 未写时按默认 `true` 生效、不告警；类型不符时整文件回落（ADR 0002 §5 既有模板），回落后的 `auto_title` 为 `true`

#### Scenario: 切换写回持久化

- **WHEN** 在面板权限 chip 把模式从 `vault_write` 切到 `read_only`
- **THEN** 下一个判定按 `read_only` 执行；`config.json` 的 `[harness].permission_mode` 被写回为 `read_only`，重启后保持

### Requirement: 会话边界

会话 SHALL 绑定 vault：内存态一个 vault 一个活跃会话（`RuntimeInner.sessions` 按 vault 键控、resume 铸新 id 替换槽位）；盘上按 vault 分目录并存多份历史会话 JSONL 留存，浮层可切换 / 新建 / 恢复（M433）。切 vault SHALL 切到该 vault 的会话，切回时恢复；关闭 vault 丢弃其会话；app 重启清空全部会话。每个逻辑会话 SHALL 有稳定 session id（`s<unix_millis>-<6 位随机>`，落 JSONL 文件名与 `session_open`）；会话建立、「新会话」重置、自动压缩、从历史会话恢复，四者 SHALL 各开一个 JSONL 文件，旧文件封闭不再追加（压缩前历史完整留存在旧文件，压缩摘要随新文件 `session_open` 留存；恢复新文件以 `opened_from=restore` + `restored_from` 标记源会话）。标题栏 harness 段 SHALL 提供「新会话」动作（面板在场时）：清空当前 vault 会话的消息历史并重新装配系统上下文（AGENTS.md / Skill 索引不变），旧会话 JSONL 文件不受影响。harness 段 SHALL 显示会话名——取**有效标题**（「会话本地留存」条的 last-wins 口径：最后一条带 `title` 的 `session_title` 记录），无标题记录时回落首条用户消息截断（约 20 字），两者皆无时显示「新会话」；生成标题的硬上限（20 码点）与显示截断长度相同，故标题显示不带省略号。会话标题变化 SHALL 即时反映到标题栏会话名与已打开的历史浮层行名，MUST NOT 要求 webview 重载；标题变化 MUST NOT 改变 transcript、session id、历史清单顺序或会话内容。自动压缩与从历史会话恢复开新逻辑会话时，源会话的有效标题 SHALL 随新文件继承（见「会话本地留存」条），使会话名在轮换后保持连续；「新会话」显式开始新对话，MUST NOT 继承。探针期 SHALL 提供**最小恢复入口**：标题栏 harness 段的会话浮层 SHALL 列出本 vault 的历史会话（极简选择器，按时间序、会话名取该会话的有效标题、无标题记录时回落该会话首条用户消息截断约 20 字；仅本 vault，只列不管理），选中一项 SHALL 从该会话 JSONL 重建会话并续写新会话文件——恢复 = 读文件最后一条 `llm_request` 的完整请求体，并折叠其后未入请求的末尾响应（算法见 design §6.2），system 与 input 原样灌回（**不重新装配**系统上下文）、不跨 provider 重写回放项。探针期 SHALL NOT 提供完整多会话管理 UI（会话重命名 / 搜索 / 分组等）与历史回看列表的完整形态；自动命名不属本禁令的「完整多会话管理 UI」——仍无手动重命名入口、无搜索、无分组。会话浮层每行已提供**单条删除**入口（行内两步确认、活跃会话拒删，M406 面板批次落地），它不属上述「完整管理 UI」。

#### Scenario: 切 vault 切会话

- **WHEN** 在 vault A 有进行中的会话，切到 vault B 再切回
- **THEN** B 呈现其自身会话（或空会话），工具与上下文注入均解析到 B；切回 A 时 A 的会话原样恢复

#### Scenario: 新会话重置

- **WHEN** 在一段关于旧话题的对话后点击标题栏 harness 段的「新会话」
- **THEN** 消息历史清空、系统上下文重新装配，随后提问不受旧话题影响；旧会话 JSONL 文件完整保留且不再追加

#### Scenario: 新会话动作的幂等性

- **WHEN** 在任意会话状态（含尚无会话——首条提问未发出）下触发「新会话」，或连续触发多次
- **THEN** 每次调用均成功，结果恒为新空会话；尚无会话时为平凡成功（不报错——「没有会话」正是目标状态）

#### Scenario: 处理中触发新会话

- **WHEN** 一轮对话正在处理中（busy）时触发「新会话」
- **THEN** 返回「对话正在处理中」错误信封，在途会话不丢失、不产生副作用；待本轮结束或停止后可再次触发

#### Scenario: 压缩开新文件

- **WHEN** 自动压缩触发、开新逻辑会话
- **THEN** 新逻辑会话落新 session id 的新 JSONL 文件，其 `session_open` 携带压缩摘要；压缩前历史在旧 JSONL 文件中完整留存且不再追加

#### Scenario: 历史会话列举

- **WHEN** 打开标题栏 harness 段的会话浮层
- **THEN** 列出本 vault 的历史会话（极简选择器，按时间序、会话名取该会话的有效标题、无标题记录时回落该会话首条用户消息截断约 20 字），不列其他 vault 的会话；「新建会话」动作是 harness 段段首的 ＋ 钮、不在浮层内（浮层只剩历史行，M406 起；空清单时浮层整层不开）

#### Scenario: 从历史会话恢复续聊

- **WHEN** 在会话浮层选择一个历史会话
- **THEN** 该会话的 system 与 input（最后一条 `llm_request` 的完整请求体，并折叠其后未入请求的末尾响应，算法见 design §6.2）原样灌回内存态、不重新装配系统上下文；开新 JSONL 文件（首行 `session_open` 标 `opened_from=restore`、`restored_from`=源会话 id），旧文件封闭；源会话有有效标题时新文件随之继承，会话名保持连续；其后提问按恢复的历史续写；读数随留存重算灌回新会话（控制行显示源会话最近一次真实读数），并以读数种子（`usage` + `cache_totals`）落进新文件首行，供链式恢复起算

#### Scenario: 标题优先于首条消息

- **WHEN** 某会话已有有效标题，另一会话没有标题记录但已有首条用户消息
- **THEN** 前者在标题栏与历史浮层中显示标题（不带省略号）；后者显示首条用户消息截断约 20 字；两者均无时显示「新会话」

#### Scenario: 标题更新不重排历史

- **WHEN** 会话空闲时一次 rename 生效，历史浮层正打开
- **THEN** 标题栏会话名与该行行名原地更新，浮层不重开、不跳位置、清单顺序不变；transcript 不变

### Requirement: 会话本地留存

会话 SHALL 以 wire/input 形态落配置目录（MUST NOT 写入 vault），作为 ADR 0007 双向记录机制的一侧：每会话一个 append-only JSONL 文件（`<config_dir>/harness/sessions/<vault 稳定 id>/<session_id>.jsonl`），文件首行 SHALL 为 `session_open` 记录——含 session id、vault 根路径、provider / 模型 / 思考档位 / **wire 方言（`wire_api`，缺省值同样在场）**、**完整装配后 system prompt 全文**与装配清单（每个来源的路径、存在与否、字节数；不存在的来源 SHALL 同样在场）、**读数种子**（M526：恢复 / 压缩开文件时在场——`usage` 读数快照 + `cache_totals` 累计四元组；链式恢复从这里起算，全新会话不落这两键）。`<vault 稳定 id>` SHALL 是 vault 注册表 id（与 `vault-sessions/<id>.json`、`reading-positions/<id>.json` 同一份身份），MUST NOT 用 vault 路径派生的消毒名（消毒名有撞名面且无长度 / 字符集保证，M309 现场）。每次发给模型的**会话请求**（含工具循环的每次迭代与压缩调用）SHALL 落一条 `llm_request` 记录（完整请求体：system + messages + 参数，**另带本次实际发送体的字节数 `request_bytes`**——按 wire 展开后的尺寸算，省掉「按字节比外推请求多大」；不具备真实 HTTP body 的 mock 档省略该键），每次响应 SHALL 落一条 `llm_response` 记录（正文 / 思考归一回放项与展示文本 / 工具调用 / usage（SHALL 含 input / cached / output 与**缓存写入 `cache_write_tokens`**——provider 不提供时按 0 记录）/ 错误；思考 MUST 落盘——**回放项归一回放形状**（`{"type":"reasoning", summary, [content], [encrypted_content]}`：kimi 的明文载体是 `summary`、deepseek 的是 `content`，各按在场项保留；`encrypted_content` 有则在场），`id` 字段 MUST NOT 进入回放项（`store:false` 下重放 `rs_*` id 属非标用法），展示文本另存）；请求侧在 **Responses 方言**且模型声明支持思考档位时（判据 `HarnessConfig::effort_supported`，读配置 schema 的 per-model `effort` 声明）SHALL 带 `include:["reasoning.encrypted_content"]`（store:false 官方回放模式的前提——让服务端在 reasoning item 里回传密文，重放时无需 id 即可还原）；未声明 effort 的模型（含 deepseek 现役形态）MUST NOT 发该字段；**Chat Completions 方言 MUST NOT 发 `include` / `store`**，其 wire 形态与思考回放字段见「Chat Completions 方言」条；wire 不可推导的决策与事件（批准 / 拒绝、停止中断、LLM 错误、循环上限）SHALL 以 sidecar 记录留存——其中 **LLM 错误的 sidecar 记录 SHALL 另带 HTTP 面诊断**（非 2xx 时的 HTTP 状态码、原始响应 body——按固定上限截断防巨型 body 撑爆留存、服务端 request id 若响应头或 body 提供；不具备 HTTP 面的错误省略这些键），且**错误事件的既有形态（`type`/`code`/`message`）不变**（新诊断只进留存，不破坏既有消费方），被 wire 覆盖或失去意义的 11 类事件 kind（`user_message` / `assistant_text` / `tool_call` / `tool_result` / `usage` / `tool_denied` / `compact` / `session_reset` / `approval_overwritten` / `approval_withdrawn` / `turn_abort_requested`）SHALL NOT 再记（重复记录即第二事实源）。记录点 SHALL 与发送点同点，MUST NOT 经二次序列化产生第二事实源。验收口径 SHALL 为恢复充分性：仅凭 JSONL 能逐字节重建任意一轮发给模型的请求——wire 体由留存 + 代码版本 + `wire_api` 方言共同推导，`session_open` 的方言键是推导依据之一；重建 MUST 忽略全部 sidecar 记录（含 `session_title`），旧文件缺失标题记录不改变重建结果。

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
