# Design: add-session-auto-naming

> 读者假设：不看代码也能评审。设计真源是 `.local/design/harness-vision.md`「就地增强 > 会话自动命名」节（2026-10-18 定稿，git 外）。真源只给了四条机制（首轮生成 / 每 N 轮或漂移重估 / keep-rename 防抖 / 留存加 title 且旧文件回落）与一条调度口径（便宜档）；本文把参数、边界与失败路径钉死，供实现批照章落地、供 reviewer 对账。
>
> 基线口径：本 change 的 spec 增量以 living spec 当前正文为基线，并对齐已实现未归档的 change `add-harness-chat-completions-dialect` 已写入的 wire 方言条款（该 change 的增量同时改「配置节 [harness]」与「会话本地留存」两条）。归档顺序对账见 D17。

## 1. 目标与不变量

**目标**：让历史列表里的每一行都能被认出来——首轮就有名字，话题转移后名字跟得上，且名字不会频繁跳动。

**不变量**（实现批的验收线）：

1. 命名调用 MUST NOT 阻塞或延迟任何对话轮次；MUST NOT 进入 keypress-to-paint 路径（ADR 0002 §6）。
2. 命名失败 MUST NOT 产生用户可见错误（toast / 错误横幅 / 面板错误行），MUST NOT 阻断对话。
3. 标题只影响「会话身份的展示」：不改 transcript、不改 session id、不改历史排序、不改会话内容、不写 vault（ADR 0003）。
4. 有效标题只有一个读取口径（D6 的 last-wins 链），前端 MUST NOT 自行生成或猜测标题。
5. 旧会话文件零改动可用：无标题记录时安静回落到既有首条用户消息口径，恢复充分性判据不变（D7）。
6. 命名调用不进会话 wire（不落 `llm_request` / `llm_response`），不进入 ctx% / cache 读数与其累计（D8）。
7. `session_title` 记录只在会话空闲时追加，MUST NOT 插在一对 `llm_request` / `llm_response` 之间（恢复的「折叠末尾响应」依赖相邻性，D9）。
8. 命名调用的 provider / 模型 / wire 方言 / `api_key` / `base_url` 只由一处解析口产出（D8 的 `title_target`），MUST NOT 各处自行挑选、也 MUST NOT 混用会话 provider 与 title provider 的字段。

## 2. D1 触发时机与「轮」的口径

**轮的定义**：一条用户消息 + 它触发的完整响应（含工具循环的多次模型请求收口、含该轮结束时的自动压缩）。工具循环的每一次 `llm_request` 不另计一轮；压缩调用不另计一轮。

**只统计正常完成的轮**（面板收到 `done`）：`aborted` / 以错误收尾的轮不计数、不触发。理由：标题素材需要真实问答；用户中途打断的半轮不构成话题。

**四个触发点**（评估 = 一次命名调用 + 一次落记录）：

| 触发 | 条件 | `reason` |
|---|---|---|
| 首轮生成 | 本逻辑会话第一个正常完成的轮结束时，且尚无有效标题 | `first-turn` |
| 初始重试 | 尚无有效标题（初始生成失败 / 尚未成功），距上一次评估满 3 轮 | `first-turn` |
| 周期重估 | 距上一次**完成的评估**满 5 轮，且会话有有效标题 | `cadence` |
| 漂移重估 | 会话有有效标题；漂移信号命中（D5）；距上一次完成的评估满 3 轮 | `drift` |

**间隔下限**：任何两次评估之间至少间隔 3 轮（含「上一次评估失败」的情形——失败也算一次尝试，但见下条）。漂移信号不得把间隔压到 3 轮以下；周期触发天然是 5 轮。

**失败不立刻重试**：一次评估失败（网络 / 超时 / 非法输出）在计数上算一次评估。已有标题时，下一次触发按 3 轮 / 5 轮的自然节奏到来；尚无有效标题时走「初始重试」行（每 3 轮一次），直到拿到标题。两种情况都不做立即重试——便宜档的代价可以忽略，重试风暴的代价不可忽略。

**关闭**：`[harness].session_naming.enabled = false` 时不发起任何调用、不写记录。

**单飞行**：同一逻辑会话同时最多一个命名调用在途；在途期间到达的触发点直接跳过（不排队，下一次触发点自然接上）。

## 3. D2 素材装配（送给命名模型的内容）

**组成**（按顺序拼成一段纯文本）：

1. 当前标题（仅重估时有；初始生成时为「（无）」）。
2. 首轮问答：首条用户消息 + 首条助手回复。
3. 最近两轮问答：最近两条用户消息 + 它们各自的最终助手回复。

**上限**：首轮每条 ≤ 500 码点；最近两轮每条 ≤ 400 码点；整份素材 ≤ 3 000 码点。超长按码点截断并补「…」。

**剔除**（MUST NOT 出现在素材里）：

- 自动注入的编辑器上下文节——用户消息先经既有 `strip_context_section` 剥离（形态真源在 `turn.rs`，前端与命名服务共用这一份，不另写 marker 字面量）；
- 工具调用的参数与结果（`function_call` / `function_call_output`）；
- 图片附件（`input_image`）、思考文本（reasoning）、system prompt / AGENTS 指令 / Skill 索引。

**取材口径**：只取 `user` / `assistant` 消息的正文 text part；一条消息内的多个 text part 拼接、空白折叠成单空格。首轮与最近两轮重叠时去重（同一轮只出现一次）。

**素材去向（隐私）**：命名调用发往 `[harness].session_naming.provider` 指向的 provider（缺省 = 会话当前 provider），按该 provider 条目的 `base_url` / `api_key` / wire 方言走。缺省配置下不引入新的数据接收方；把 `session_naming.provider` 显式指向另一个 provider 时，素材会发给该服务方——这是配置者的显式选择，不是默认路径（Alex 2026-10-18 裁决「这个约束没有必要。去掉它。」，见 proposal 裁决留痕①）。素材无论发往哪个 provider 都只是会话内容的子集（本节的剔除与上限）；除会话留存外不做额外本地持久化（调用本身不落 wire，见 D8）。

## 4. D3 生成器契约与解析

**prompt**（中文，与现有压缩指令同风格；实现放 `harness/prompts/title.md` 或 `title.rs` 常量，单一处）：

- 角色：给一段对话摘录起一个短标题；标题用于历史列表里认出这段对话。
- 输出**严格一行 JSON**，二选一：`{"decision":"keep"}` / `{"decision":"rename","title":"…"}`。
- `keep` 的定义：当前标题仍能描述这段对话（哪怕还能更精确）——**拿不准就 keep**。
- `rename` 的定义：当前标题已经失真（对话主体已转到别的话题，或当前标题让人误解为另一件事），且新标题**显著更好**。
- 标题规格：2–16 个码点（硬上限 20）、与对话主语言一致、不带引号 / 书名号 / Markdown / 句末标点、不是整句。
- 不给模型任何工具；不要求解释（解释会稀释短输出约束）。

**解析与规范化**（纯函数，单测钉死）：

1. 从响应正文里取第一个 `{` 到最后一个 `}` 的子串（容忍模型包 ```json 代码块或前后废话）；解析失败 → `error/invalid`。
2. `decision` 不是 `keep` / `rename` → `error/invalid`；**无当前标题的初始生成里 `keep` 视为 `error/invalid`**（没有可保持的标题，否则会话永远拿不到名字、重试路径也不会启动）。
3. `rename` 时对 `title` 做规范化：trim → 换行 / 制表符折成单空格 → 连续空白折成一个 → 剥掉首尾成对的 `"` `'` `` ` `` `「」` `『』` → 剥句末标点 `。．.!！?？`。
4. 校验：规范化后 1–20 个码点；与**当前标题**规范化后不同。任一不满足 → `error/invalid`（保持原名）。
5. 通过 → 记为 `rename`。

**输出长度**：不依赖 provider 的 `max_output_tokens` / `max_tokens`（Responses 端点忽略该字段，见「上下文用量显示与触顶处理」的既有调查口径）；长度由 prompt 约束 + 解析侧 ≤20 码点硬校验共同保证。模型输出超长的代价只是这一次不换名，不会把长文本写进留存。

## 5. D4 防抖：「显著更好才换」

防抖分两层，缺一不可：

- **语义层**（prompt）：keep 是默认答案；rename 需要「当前标题失真」+「新标题显著更好」两个条件同时成立。把「还可以更好」明确排除在外。
- **机制层**（解析与调度）：非法 / 空 / 超长 / 与当前相同 → 不换；两次评估至少隔 3 轮；周期从**任何一次完成的评估**（keep 或 rename）重新计 5 轮。

**为什么需要防抖**：历史列表的可辨识性建立在「名字稳定」上。每轮都让模型重起一个名字，列表会因为频繁改名而失去检索锚点——比首条消息截断更糟。防抖的代价是标题可能短暂滞后于话题；这是有意的方向选择（稳定优先于精确）。

**可观测**：`session_title` 记录带 `decision`，dogfood 期可直接统计 rename / keep / error 的比例与 reason 分布；如果 keep 占比接近 100%（模型过度保守）或 rename 间隔过短（模型过度激进），调 prompt 的判定句，不改机制。

## 6. D5 话题漂移信号（零 token 的确定性启发式）

漂移检测本身 MUST NOT 花 token——它是触发条件，判断仍由生成器的 keep/rename 完成。

**词元化**（确定性、可单测）：

- 文本转小写、NFKC 归一（全角转半角）。
- CJK 连续片段取**字符 bigram**（单字片段取该字）。
- ASCII 字母 / 数字连续片段取整词。
- 丢弃停用词表（中英文各一小份：的 / 了 / 是 / 在 / 我 / 你 / 他 / and / the / to / of …）与纯标点。

**信号**：设标题词元集合 T、用户消息词元集合 M，`containment = |T ∩ M| / |T|`。

- 仅当 `|T| ≥ 3` 时计算（标题太短，重合度没有统计意义）。
- 仅当用户消息 ≥ 8 个码点时计入（「继续」「好的」这类短指令既不命中也不打断连续计数）。
- `containment < 0.20` 记一次命中；连续两次命中 → 漂移信号成立，触发一次重估（仍受 D1 的 3 轮下限约束）。
- 一次未命中把连续计数清零。

**为什么是词元重合而不是语义判断**：语义判断要额外一次 LLM 调用（每轮都付），与本 change 的便宜档口径冲突；词元重合零 token、确定、可测试。误报的代价只是一次便宜调用 + 模型大概率 keep，不改变标题；漏报的代价是等到 5 轮周期——两者都在可接受范围。阈值 `0.20` 是标定值，集中在一个常量里，dogfood 后按 `reason=drift` 的 keep/rename 比例再调（revisit 条件见 D15）。

## 7. D6 留存格式与有效标题

**新记录 kind**：`session_title`（sidecar，append-only）：

```json
{"kind":"session_title","title":"Rust 生命周期排查","decision":"rename","reason":"drift","model":"k3-256k","ts":1760000000}
```

| 字段 | 取值 | 说明 |
|---|---|---|
| `title` | 字符串 | `initial` / `rename` / `keep` / `inherit` 必带；`error` 不带 |
| `decision` | `initial` / `rename` / `keep` / `inherit` / `error` | 本次落记录的原因类别 |
| `reason` | `first-turn` / `cadence` / `drift` / `inherit` | `error` 记录沿用触发原因 |
| `code` | 字符串 | 仅 `error`：`harness_title_failed`（调用失败 / 超时）/ `harness_title_invalid`（输出不合契约） |
| `model` | 字符串 | 本次调用实际使用的模型 id；`inherit` 记录不带该键（没有发起调用） |
| `ts` | 整数 | UNIX 秒，与既有记录同取时点 |

**有效标题（唯一读取口径）**：文件内**最后一条带 `title` 的 `session_title` 记录**的 `title`；没有则回落首条用户消息（既有口径）。读取函数只有一处（Rust 侧 `effective_title(records)`），列表、恢复、快照、事件四条出口都从它取——MUST NOT 各写一份 last-wins 逻辑（REVIEW.md「同一语义两处真源」条）。

**为什么写 keep**：①审计——dogfood 期能算出防抖的实际行为（keep / rename / error 比例与 reason 分布）；②知道上一次评估发生在会话的哪个位置（对照记录 `ts` 与轮次时间，排查「名字为什么不更新」）；③用户报标题不对时，能直接看到模型当时给的是 keep。cadence 计数在轮换（新会话 / 压缩 / 恢复）时重置，不从记录重建——记录不携带轮序号，重建不成立。

**为什么不写进 `session_open`**：文件首行在会话建立时写出，标题最早也要等首轮结束才有；append-only 文件不允许回头改首行。再加一个「首行 title + 后续记录」的双家结构会让有效标题出现优先链歧义，正是 REVIEW.md「同一语义两处真源」要挡的形态。`session_open` 一行不改。

**为什么 error 也写**：命名失败默认静默，如果没有记录，用户和我们都无法知道「为什么没有标题 / 为什么没改」；error 记录只带错误码，不带对话内容。

## 8. D7 轮换继承与旧文件回落

**继承点**（两个）：

- **自动压缩**：压缩开新逻辑会话时，新文件在 `session_open` 之后追加一条 `decision=inherit` 的 `session_title`（携带源会话的有效标题）。不继承的话，新文件的首条用户消息是「（此前会话已压缩为摘要，接着摘要继续）…」，回落口径会把这段模板文字当成会话名——比没有标题更糟。
- **从历史会话恢复**：新文件同样追加 `inherit` 记录（源会话有有效标题时）；源会话没有生成标题时不写，回落口径在恢复后仍然成立（恢复会灌回原始首条用户消息，回落名字与源会话一致）。

**不继承点**：用户点「新会话」= 显式开始新对话，不继承标题；首个正常轮结束后重新生成。

**旧文件**：本 change 之前的 JSONL 没有 `session_title` 记录。列举、恢复、展示一律安静回落——不告警、不写 warning、不做一次性回填脚本、不改写任何既有文件（append-only + ADR 0003 的「不改写既有文件」纪律）。恢复它们时也不补写 inherit（源无标题，回落即可）。

**链式恢复**：A 恢复自 B、C 恢复自 A 时，标题沿 inherit 链传递；任一环有 rename，后续恢复拿到的是该环最后一条带 title 的记录。

## 9. D8 调度与便宜档

**配置键**（2026-10-18 配置面重塑后收成一张表；走既有校验模板，缺省即出厂行为）：

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `harness.session_naming.enabled` | bool | `true` | 关闭后不发起任何命名调用、不写标题记录 |
| `harness.session_naming.provider` | string \| null | `null`（= 会话当前 provider） | 命名调用发往哪个 provider；非空须是 `providers` 表内的 id（`kimi` / `deepseek` / `mock`） |
| `harness.session_naming.model` | string \| null | `null`（= 该 provider 的 `model`） | 命名调用专用模型；须在**选定 provider**（`provider` 缺省时即会话当前 provider）的 `models` 清单内声明 |

**布局判据**（与 `add-semantic-image-naming` 的 `attachment_naming` 共用一条，落 `docs/specs/config-reference.md` §1.6 / §1.7）：配置跟随资源域——自动 LLM 行为的开关与模型选择归 `[harness]` 域；触发位置（轮结束 / 粘贴）是 UI 事实，不是配置域。原 `auto_title` / `title_provider` / `providers.<id>.title_model` 三处旧键废除，按未知键口径静默忽略，无兼容读取（见 proposal 裁决留痕②）。

**唯一解析口**：`HarnessConfig::title_target(session_provider) -> TitleTarget { provider, model, wire_api, api_key, base_url }`。五个字段同出 `session_naming.provider` 指向的那一个 provider 条目——`provider` = `session_naming.provider`（缺省 / 非法值 → 会话当前 provider），`model` = `session_naming.model`（命中该条目的 `models` 清单）否则该条目的 `model`，`wire_api` / `api_key` / `base_url` 也取该条目。命名调用 MUST NOT 混用会话 provider 与 title provider 的字段（例如模型取 A、key 取 B）——这是不变量 8。

**校验口径**：`session_naming.enabled` 类型不符 → 整文件回落（既有模板）；`session_naming.provider` 类型不符（非字符串且非 null）→ 整文件回落；`session_naming.provider` 非空且不在 `providers` 表内（闭集合外取值）→ 一条人话 warning + 回落 `null`（= 会话当前 provider，不阻断、不失败）；`session_naming.model` 非字符串 → 整文件回落；`session_naming.model` 非空且不在**选定 provider** 的 `models` 清单内 → 一条人话 warning + 回落 `null`（= 该 provider 的生效模型，不把未声明的模型发给 API）。这一点与 `attachment_naming.model` 的「只点名、值原样保留」不同：附件命名有 vision 资格闸，回落等于替用户选模型；会话命名没有资格闸，选错模型只会让这次调用失败。mock provider 没有模型清单（fixture 驱动，模型选择无意义）：`session_naming.model` 非空 ⇒ 装载期一条 warning + 归一为 `null`；`session_naming.provider = mock` 时命名调用走 mock 的 `titles` 队列（D12），`model` 字段只作记录（空串）。`session_naming.provider` 指向的 provider 的 `api_key` 为空不另设校验（与「空 `api_key` 是未配置的出厂状态、不告警」同口径）：命名调用按 D10 静默失败，会话名保持既有标题 / 回落口径。

**调用形态**（便宜档的两条腿）：

1. **形态最省**：单次、非 agentic；不带工具；素材只含 D2 的受限文本；输出由 prompt + 解析硬约束；独立 20 秒超时（不复用会话请求的 300 秒超时）；失败不重试。
2. **模型 / provider 可选更便宜**：`session_naming.provider` / `session_naming.model` 配了就用它们；都没配就与会话同 provider、用该 provider 的生效模型——此时「便宜档」由形态保证（一次调用约 1–3k input tokens、输出 < 100 tokens，相对会话本身可忽略）。

**思考档**：`ThinkingEffort` 没有「关闭」档（闭集合 Low / High / Max）。命名调用在模型声明支持思考档时发 `Low`（最低成本档），未声明时不发该字段——MUST NOT 新增「关闭」枚举值（那会扩散到会话 chip 与全部 provider 映射）。

**不计入会话读数**：命名调用的 usage MUST NOT 进入 `UsageSnapshot`、`cache_totals`、ctx% / cache% 的任何一条出口；也 MUST NOT 落 `llm_request` / `llm_response`。

**为什么不能自动选最便宜模型**：本仓无模型价格 / 档位元数据，模型清单是 config-only 的 id + 能力声明（M381）。自动选便宜模型需要内置价格表，违背「配置即数据」。可选覆盖键是当前约束下唯一诚实的落法。

## 10. D9 并发、生命周期与丢弃规则

**线程模型**：轮结束后由运行时起一个后台线程执行命名调用；轮次完成路径只做一次「是否该触发」的快速判定（纯内存），然后返回——不等结果、不持会话锁发 HTTP。

**锁纪律**：素材装配与「是否可追加」在短会话锁内完成；HTTP 调用在锁外；结果落盘前重新取锁，复核以下条件，任一不满足即丢弃：

1. 同一 vault（`VaultScope` 未变）；
2. 同一逻辑会话 id（未发生新会话 / 压缩 / 恢复 / 切 vault）；
3. 会话当前空闲（无在途轮次）——保证 `session_title` 不会插进一对请求 / 响应之间；
4. `session_naming.enabled` 仍为开（**落盘时点**重读配置，不是在途前的快照）。

**为什么严格要求空闲**：恢复路径的「折叠末尾未入请求的响应」读取锚点 `llm_request` 的**紧邻下一条**记录（`records[index + 1]` 必须是 `llm_response`）。标题记录若插在这对之间，恢复会丢掉末轮响应。这条约束是恢复正确性的前提，不是风格选择。

**丢弃不重试**：被丢弃的结果不再补写（下一次触发点自然到来）；丢弃时只打 stderr（含原因）。

**配置快照**：每次调用在启动时取一份配置快照（`title_target` 的五个字段 + `models` 清单），会话中途改配置从下一次调用起生效。

## 11. D10 失败与可观测

- **用户面**：零可见错误。不弹 toast、不写面板错误行、不阻断对话（与「留存写失败不阻断对话」同一条纪律）。
- **诊断面**：一条 stderr（`lumir: 会话标题生成失败（<code>）：<原因>`，不含对话正文）+ 一条 `decision=error` 的 `session_title` 记录（错误码，无正文）。
- **超时**：20 秒；超时按 `harness_title_failed` 处理。
- **可观测指标**（dogfood 期直接读 JSONL 即可）：每个会话的 rename / keep / error 次数、`reason` 分布、rename 的轮次间隔。不建面板、不做指标 dashboard。

## 12. D11 面板呈现与更新通道

**显示优先级**（标题栏会话名与历史浮层行名共用）：

1. 有效标题（后端读取，D6）；
2. 首条用户消息截断约 20 字（既有 `truncateSessionName`）；
3. 「新会话」（既有 D330 文案）。

生成标题硬上限 20 码点 = 显示截断长度，因此标题显示时**不带省略号**；回落口径的截断行为不变。

**更新通道**：

- `harness_state` 快照增加 `title`（可选，无标题时缺键）。
- `harness:event` 增加 kind `title`（载荷 `{title}`；继承时也发一次）。
- 两条出口都取 D6 的同一个读取函数结果；前端 MUST NOT 自行推导标题。

**更新行为**：标题变化时只改会话名文本与 `title` 提示（tooltip），不重渲染 transcript、不改变滚动位置、不移动焦点、不重排历史清单；历史浮层若正打开，行名原地更新（不重开、不跳位置）。

**轮换**：压缩 / 恢复后，面板先按既有逻辑重置视图，再应用 `inherit` 标题；「新会话」重置为无标题 —— 显示回落口径（未发消息 = 「新会话」）。

**绑定**：`SessionSummary` 增加可选 `title`；`StateSnapshot` 增加可选 `title`；ts-rs 重导出 `src/bindings/**` 并 `git add`（gate 的 bindings-drift 判据）。

## 13. D12 mock provider 与验收

**fixture 扩展**：文件顶层增加可选 `titles` 数组（元素形状与 `responses` 相同）。命名调用使用一个独立的 mock 队列：每次调用弹一条 `titles`；缺失 / 空 / 弹尽 → 返回空正文 → 解析为 `error/invalid` → 保持原名（无标题时保持回落名）。

**为什么必须独立队列**：mock fixture 的 `responses` 是会话级游标（`with_start` 按 `consumed` 推进）。命名调用若从同一队列弹，会把既有场景的脚本整体错位——所有 mock 场景（70–77、87–98 等）会在本 change 落地后集体变红。独立队列让既有 fixture 零改动。

**验收可断言**：`titles` 写 `{"decision":"rename","title":"…"}` 的 JSON 文本即可驱动 initial / rename / keep / invalid 全部路径；场景用 `file` 断言读 JSONL 的 `session_title` 记录，用 AX 断言读标题栏与会话浮层行名。

## 14. D13 测试计划

**Rust 单测**（`title.rs` 纯函数为主，判定层不依赖网络）：

| 面 | 用例要点 |
|---|---|
| 素材装配 | 剥注入节；剔除工具 / 图片 / 思考；首轮与最近两轮去重；各档字符上限截断 |
| 解析 / 规范化 | keep / rename 正常路径；代码块包裹；前后废话；非法 JSON；未知 decision；空标题；超长；与当前标题相同；句末标点 / 引号剥离；CJK 码点计数 |
| 漂移信号 | CJK bigram / ASCII 词元；停用词；短消息不计；标题词元 < 3 不判；连续两次命中触发；一次未命中清零 |
| 调度状态机 | 首轮触发；5 轮周期；3 轮下限；初始失败后每 3 轮重试；失败算一次评估；关闭开关；单飞行跳过 |
| 留存 | `session_title` 序列化 / 读取；last-wins；error 无 title；无记录回落；继承记录；空闲才追加 |
| 恢复 | 标题记录在场时重建请求逐字节相等（恢复充分性回归）；标题记录不落 `llm_request`；压缩 / 恢复的新文件首条记录是 inherit |
| 配置 | `harness.session_naming` 三键（`enabled` / `provider` / `model`）的缺省 / 合法 / 类型不符；`provider` 非法值回落 null；`model` 未在 models 清单回落 null + warning；旧键（`auto_title` / `title_provider` / `providers.<id>.title_model`）按未知键口径静默忽略；`title_target` 跨 provider 时五字段同出一条条目；mock 作 naming provider |
| 列表 | `SessionSummary.title` 在场 / 缺省 |

**前端单测**（`tests/unit/harness-session-picker.test.ts` 等）：`SessionEntry.title` 宽容解析；显示优先级 title → firstUserText → D330；title 更新不重排 / 不改 transcript 的纯模型层断言。

**门禁**：`cargo test`、`pnpm test`、`scripts/gate.sh quick`；动到视觉面（标题栏文本形态）后本地跑 `scripts/gate.sh visual`，像素基线按 [tests/visual/README.md](../../../tests/visual/README.md) 的纪律更新（基线更新是人肉裁决点）。

## 15. D14 真机验收场景计划

新增场景（编号取落地时最大号 +1，文件名 `16x-harness-auto-title-*.md`）：

1. **首轮命名**：mock fixture 的 `titles` 给 rename；发一条消息 → 标题栏显示标题；JSONL 有 `decision=initial` 记录；打开历史浮层，该会话行显示同一标题。
2. **keep 防抖**：`titles` 依次给 initial 与 keep；完成 5 轮（脚本可控）→ 标题不变，新增一条 `decision=keep` 记录。
3. **旧文件安静回落**：预置一份无 `session_title` 记录的会话 JSONL → 打开历史浮层与恢复，行名 / 标题栏显示首条用户消息截断，无告警。
4. **关闭开关**：`sessionNaming.enabled: false` → 完成首轮后无 `session_title` 记录，名字为回落口径。
5. **naming provider 非法值回落**：会话 provider 为 mock，配 `sessionNaming.provider: "openai"`（闭集合外）→ 启动不失败，首轮后仍按 mock 的 `titles` 写出 `session_title` 记录（回落会话 provider），标题栏正常显示标题。

> 场景配置键口径：验收套件的顶层键映射（`scripts/acceptance/lib/app.mjs` 的 `SCENARIO_CONFIG_KEYS`）在 2026-10-18 重塑后改为 `sessionNaming: { enabled, provider, model }` 直落 `harness.session_naming`（M580 已落地，见 tasks §5.2b）。旧键 `autoTitle` / `titleProvider` / `titleModel` 已从套件删掉并进 `--check` 的 `REMOVED_CONFIG_KEYS`（出现即报错、文案点名新键位），不再有静默忽略的场景。

漂移信号与合法 / 非法输出的全分支留在单测（真机场景驱动 5+ 轮成本高、判别力不增）；真机只锁「端到端能被看到」的五条。既有场景回扫：任何断言会话名等于首条消息截断的场景，若 fixture 未声明 `titles`，行为不变；新增 `titles` 只加在新场景自己的 fixture 上。

## 16. D15 风险与 revisit 条件

| 风险 | 处理 | revisit 触发 |
|---|---|---|
| 漂移启发式误报，导致频繁评估 | 连续两次命中 + 3 轮下限 + 生成器 keep 兜底；`reason=drift` 记录可统计 | dogfood 两周内 `drift` 的 keep 占比 > 80% → 提高阈值或改为只走周期 |
| 标题质量差（便宜模型 / prompt 不稳） | 配置 `session_naming.model` 换模型；rename 需过硬校验 | 连续多个会话标题不可读 → 改 prompt 判定句，不改机制 |
| 改名过于频繁 | keep 默认 + 显著更好判据 + 3 轮下限 | 同一会话 20 轮内 rename ≥ 3 次 → 收紧 prompt 判据或提高下限 |
| 命名调用成本 | 每 5 轮一次、短素材、短输出、不重试 | 会话数 × 轮数增长后仍可忽略；若不可忽略，配合更便宜的 `session_naming.model` |
| 恢复时末轮响应丢失（记录插入位置） | 空闲才追加（D9） + 单测钉「请求/响应相邻性」 | 出现任何恢复丢末轮响应的报告 → 检查追加时机 |
| 跨 provider 命名把素材发给另一个服务方 | 缺省不跨（`session_naming.provider` 缺省 = 会话 provider）；跨 provider 只在配置者显式指定时发生，素材仍是会话内容子集（D2） | 出现「命名素材不得离开某服务方」的合规要求 → 改为强制同 provider，或按策略禁止跨 provider |
| 与未归档 change 的 spec 文本冲突 | D17 对账 + 归档前核对 living spec | 归档评审时 living spec 出现标题条款缺失 → 不归档，先修增量 |

## 17. D16 备选方案与否决理由

- **只用首条消息截断（现状）**：零成本，但两个缺陷都不解决（不可辨识 + 失真）。否决。
- **确定性启发式命名（取首条消息的关键词）**：零 token，但质量上限低，话题转移仍不跟随；且中文关键词抽取本身需要词典 / 分词依赖。否决。
- **每轮都让模型重命名**：跟随最及时，但名字会跳，正好破坏「历史列表里找得到会话」的目的；成本也高一个量级。否决。
- **把整段会话喂给命名模型**：素材更全，但 token 成本与上下文溢出风险都不必要；首轮 + 最近两轮已足够判断「现在聊什么」。否决。
- **把标题写进 `session_open`**：见 D6，append-only + 双家歧义。否决。
- **做手动重命名 UI 代替自动命名**：把认知成本转给人，且探针期明确不做完整管理 UI。否决。
- **自动选最便宜模型**：无价格元数据，见 D8。否决（以可选配置键替代）。
- **命名恒发向会话当前 provider（原设计约束）**：Alex 2026-10-18 裁决「这个约束没有必要。去掉它。」——命名调用是普通辅助调用，发往哪个 provider 属配置选择，不需要在架构上锁死；缺省值已保证旧行为在默认路径上不变。否决（改为 `session_naming.provider`，缺省 = 会话 provider）。
- **把命名三键散在三处（`auto_title` / `title_provider` / `providers.<id>.title_model`）**：开关在表根、provider 在表根、model 却挂到 provider 条目下，读者要靠解析口才知道三者是一组；`title_*` 命名也只说了「标题」没说「会话」。2026-10-18 收成 `harness.session_naming = { enabled, provider, model }`（Alex：「好。就采纳这一版。」）。否决旧形态。

## 18. D17 与未归档 change 的文本对账

`add-harness-chat-completions-dialect` 已实现（master 代码含 `wire_api` 与 chat 方言），但其 spec 增量尚未归档，且它的增量同样修改「配置节 [harness]」与「会话本地留存」两条。本 change 的 MODIFIED 正文因此：

1. 以 living spec 当前正文为基线；
2. 把该 change 已写入的 wire 方言条款（`session_open.wire_api`、Responses / chat 方言的 `include` 条件）一并保留——避免本 change 后归档时把它们静默回退；
3. tasks 里有一条归档前对账项：确认 living spec 已并入哪个版本，再按「后归档者保留并集」的原则核对，MUST NOT 让任一方条款在归档时消失。

`wire_api` 的运行时语义不在本 change 的讨论范围；这里只是文本保真。
