# Proposal: 已受理但 provider 往返失败的轮次可显式重试

- Change ID: `add-harness-turn-retry-nov23`
- 日期: 2026-11-23
- 角色: Alex Lee（方向准入、节点 1 裁决），AI agent（起草）

> **评审记录（先读）**
> 节点 1（提案评审）：**已通过**（2026-11-23）。Alex 原话：「三项推荐。」
> 裁决口径：本批三项提案（持久化健康状态 / 失败轮次显式重试 / 跨 vault 终态未读）一起送裁、
> 一次答复，语义为**三项全部按推荐值批准**。本 change 的 D1–D5 全部按推荐值生效（D5 = 并入，
> 同批修恢复折叠缺陷），无改值、无否决项；语义边界、制品范围与下文「What Changes」即为批准的
> 施工依据。
> 实现期若范围 / 行为需求发生变化，停下更新本文件并重走节点 1，不静默扩 scope。

## Why

### 现场：一次瞬时失败把整轮提问作废

harness 的发送是「受理即接管」：`harness_send` 返回 Ok 之后，乐观上屏的用户消息就是真实的一轮，
后端失败只发一条 `error` 事件，不回滚输入区（`src/harness-panel.ts:9046-9078` 的注释与分支）。
于是网络抖动、网关 502 / 503、429 限流、流被中断这类**下一次可能就好**的失败，用户能做的只有：

1. 看着一条错误行，手动把刚才的问题重新打一遍；
2. 如果那轮带了图片卡 / 摘录卡 / 多段富内容，还要逐张重新插入——而卡片对应的原消息已经在
   会话 `input` 里，只是模型没答上来；
3. 重新发送会产生**第二条用户消息**，历史里同一问题出现两次，模型与读者都要自己分辨哪条是重试。

这不是「错误展示不好看」，而是**已受理的工作被丢掉**。后端其实完整保留了失败请求的全部原料：
`Session.input` 是请求的唯一事实源（`src-tauri/src/harness/turn.rs:520-539`），失败点发生在
`execute_calls` **之前**（`turn.rs:583-614` 对比 `:705`），失败的那次往返不可能已经执行过
工具（此前轮次已完成的工具项留在 `input` 里）。也就是说，
「把失败的那一次 provider 往返原地再发一次」在数据上是最小、最安全的补救，缺的只是一个显式入口。

### 现状证据（当前树）

| 位置 | 事实 |
|---|---|
| `src-tauri/src/harness.rs:303-326` | `acquire_turn`：忙则 `harness_busy`，否则 `begin_turn()`；一轮一次，无排队 |
| `src-tauri/src/harness.rs:381-398` | `release_turn`：先撤销本轮工具白名单、再 `end_turn()` |
| `src-tauri/src/harness.rs:526-630` | 恢复会话取最后一条会话 `llm_request` 的 messages，并折叠其后一条 `llm_response`；**折叠不检查 `error`**（见 D5） |
| `src-tauri/src/harness/turn.rs:446-477` | 用户消息在轮次开头入 `input` + `panel` + `current_context` |
| `src-tauri/src/harness/turn.rs:520-539` | 请求由 `build_request`（整体克隆 `session.input`）构造，`record_llm_request` 与发送同点 |
| `src-tauri/src/harness/turn.rs:583-614` | 错误即终态：超限且未试过才压缩后重试一次，其余错误落 `llm_error` sidecar、发 `error`、返回；**没有任何「可重试」标识** |
| `src-tauri/src/harness/llm.rs:1113-1125` | 真实 SSE 读循环：读错误 / channel 断开只是 `break`，**不生成 `TurnError`**，按已收内容收尾 |
| `src-tauri/src/harness/llm.rs:1162` | Responses 流无终态事件（`response.completed/incomplete/failed`）时**明确按正常完成收尾** |
| `src-tauri/src/harness/llm.rs:1212-1230` | `response.failed` / 流内 `error` 保留 provider 自有 `code`（如 `server_error`）；分类若只认 `harness_response_failed` / `harness_stream_error` 会漏掉真实瞬时错误 |
| `src-tauri/src/harness/llm.rs:2003-2023` | Chat 方言的 `finish()` 同样不检查终态；EOF 无 `[DONE]` / usage 末帧也按正常完成收尾 |
| `src-tauri/src/harness.rs:855-874`、`src-tauri/src/harness.rs:1441-1443` | vision 发送闸只接收 composer 的 `DeliveryPart`，只在 `harness_send` 调用；重试的 `Resume` 没有 parts，也没有等价检查 |
| `openspec/specs/harness/spec.md:1215-1219` | 既有合同：当前 provider + 模型不支持图片时，含图消息必须在发送时被挡下；能力判据只有一处 |
| `src-tauri/src/harness/turn.rs:670-679` | 空响应在响应项已折进 `input` 之后判终态（`harness_empty_response`） |
| `src-tauri/src/harness/turn.rs:705-731` | 工具调用在错误分支之后才执行；失败的那次往返之后不会执行任何工具（此前轮次已完成的工具项留在 `input`） |
| `src-tauri/src/harness/session.rs:684-741` | `TurnPhase` 为 Idle / Running / Finishing；会话无对外轮次 id，有 `subagent_token` 判会话换代 |
| `src-tauri/src/harness/session.rs:454-490`、`:1044-1080` | `StateSnapshot` 可加字段；当前无失败 / 重试读出口 |
| `src-tauri/src/harness/llm.rs:208-237` | `TurnError` 只有 `context_overflow` 一个分类位与 HTTP 诊断字段 |
| `src-tauri/src/harness/llm.rs:2087-2091`、`:2364-2369` | mock fixture 的 `error` 只有 `code` / `message`，**没有 HTTP 状态位**——5xx / 429 的分类当前无法在验收里表达 |
| `src-tauri/src/harness/events.rs:414-416` | 终态事件 `error` 只有 `code` / `message`，无轮次身份 |
| `src/harness-panel.ts:8352-8371` | error 分支只收相位、取文案、`appendError` |
| `src/harness-panel.ts:6611-6628` | 错误行同文案就地替换、不堆叠 |
| `src/harness-panel.ts:9010-9078` | 发送是唯一入口；同步拒绝才回滚乐观消息，**已受理之后的失败不回滚**；`harness_busy` 特例不本地收口，交 `in_flight` 快照 |
| `src/harness-panel.ts:8671` | `content` 快照先 `clearTranscriptSurface()` 再重放；「只更新既有动作行」的规则在清面后会丢掉重试入口 |
| `src/harness-panel.ts:4023-4035` | `viewGeneration` / `snapshotSeq`：切 vault、新会话、cron 切屏、恢复会话都推进，旧回包整条作废 |
| `src/harness-activity.ts:19-99` | 相位只有 idle / running / stopping，明确不保存终态记忆 |
| `openspec/specs/harness/spec.md:958-959` | 既有硬边界：错误行是 **live 面**；面板记录只有 user / assistant / tool / compact 四类角色 |
| `openspec/specs/harness/spec.md:327` | 上下文超限已有「自动压缩 + 重试该轮一次」的兜底，是唯一既有重试 |
| `openspec/specs/harness/spec.md:600` | 每次会话请求落一条 `llm_request`、响应落一条 `llm_response`（含错误） |
| `src-tauri/src/harness/run.rs:616-652` | `loop_max` 触顶 = 写入一条 assistant 提示 + `done`，不是 error 终态 |
| `scripts/acceptance/scenarios/708-harness-send-reject-rollback.md` | 真机套件已能断言错误行文案与草稿逐字节，重试场景可复用同一形态 |

### 为什么是「显式重试」，不是自动重试

- 一轮重试会把整段会话前缀再发一次，成本由用户承担；是否再花这笔钱应由用户决定。
- 失败也可能来自账户 / 配置 / 服务端策略，自动重试只会把同一个错误再撞一遍。
- 自动重试与「停止」语义冲突：用户按了停止就要真的停，不能让后台悄悄再发一轮。

## What Changes

1. **新增 `harness` 能力：失败轮次显式重试**（`specs/harness/spec.md` 的 ADDED requirement）。
   交互式用户轮次因可重试的 provider 往返失败而终态后，错误行上出现「重试」动作；点击后在
   **同一个会话、同一个逻辑轮次**里重新发出失败的那一次 provider 往返。
2. **重试复用会话当前的 `input` 原始项**：不重建用户消息、不从显示面 `<quote>` XML / 卡片反序列化、
   不重新拼上下文节、不重复入队用户消息；重试动作本身不新建会话 / JSONL / 对外轮次 id（既有
   自动压缩 / 恢复的会话轮换不受影响）。失败在响应入 `input` 之前时，重试请求的 `messages`
   （含原始 text / image parts）与失败请求逐字节相同。
3. **不重放已执行的工具**：失败点位于工具执行之前；重试只补发该次往返，不重跑此前任何工具调用。
   该保证不扩大到「后续模型不会发起新的写操作」——重试成功后模型新发起的工具调用仍照常经既有
   权限规则、权限模式与批准闸。
4. **可重试集合由后端唯一分类，流失败在真实传输 / 协议边界归一**：网络失败、HTTP 408 / 425 /
   429 / 任意 5xx、空响应给重试；流失败按稳定内部类别归一——传输层读错误 / 通道意外断开、
   协议要求的终态事件未达而 EOF 均归为 stream failure；流内 `error` / `response.failed` 归一为
   transient（可重试）或 permanent（鉴权 / 权限 / 非法请求 / 内容策略，不可重试）。分类 MUST NOT
   直接读 provider 原始 `code`，原始 code 只作诊断 / 文案素材。Responses 的终态是
   `response.completed` / `response.incomplete` / `response.failed`；Chat 的终态是 `[DONE]`（或
   请求了 `stream_options.include_usage` 时的 usage 末帧）。终态未达而 EOF MUST NOT 当正常完成。
   配置级失败、4xx 请求 / 鉴权、附件类、超限终态 / 压缩失败、内部错误 / 线程失败 / 无会话 /
   忙、停止 / 循环上限、`fixture_exhausted` 不给重试。分类结果随 error 事件与 `harness_state`
   快照下发。
5. **重试前重新执行 vision 闸**：重试 SHALL 基于失败轮 `input` 中的图片 parts，按当前 provider /
   model 重新执行与 `harness_send` 同一份 vision 能力判据；不支持时拒绝
   `harness_image_unsupported`、保留失败状态、零 provider 请求。preflight MUST 在消费 `failed`
   之前完成（或失败时回滚）。
6. **世代守卫与幂等**：一次点击最多重新发出一次失败的那次往返（重试成功后模型若调用工具，
   其后的往返按正常回合继续）；连点 / 并发第二次被拒；失败后用户又发新消息、开新会话、
   恢复历史会话，旧重试动作失效；关闭 vault 丢弃失败状态，切 vault 保留、切回重建。动作跨
   webview 重载 / 切 vault 回来存活（快照字段），不跨 app 重启 / 历史恢复。
7. **同步拒绝不强制 idle**：busy / stale / no_failed / thread_failed / image_unsupported 的
   拒绝都 MUST NOT 本地 `local_finish`、强制 idle 或关闭轮次闸门；相位由 `harness_state.in_flight`
   权威收口，动作由同一份轻量快照的 `retry` 就地幂等更新（不重放内容、不清拒绝错误行）。
   第一次重试仍在流式输出时第二次 busy，后续分片与终态 MUST 继续上屏。
8. **快照两档都幂等重建一条动作**：`enter` 与 `content` 快照在消息重放后都按 `retry` 保证恰好
   一条尾部动作；`content` 快照清面后 MUST 重建，不得因「不新增」而丢掉入口。
9. **失败轮半截正文保留并标「未完成」**：重试成功后的回答另起一条 assistant 消息，不替换旧内容；
   半截正文是 live 面，重载 / 切 vault 不重建。
10. **同一根缺陷的并入项（D5，已裁并入）**：恢复历史会话时，带 `error` 的 `llm_response` 当前会被当作
    完整回答折进历史；本提案推荐同批修掉（新增一条 ADDED requirement），使恢复结果停在失败前
    已完成的最后一项。D5 已裁「并入」（2026-11-23），该 requirement 留在本 change。
11. **补 mock 测试能力**：fixture 的 `error` 增加可选 `http_status` 与可选 `kind`（稳定内部类别），
    并允许 error 条目先流出 `chunks` / `text` 再以该错误收尾。mock 显式错误只用于产品流程；
    **流失败的分类证据必须来自 Responses / Chat 两方言的真实解析层反例**（合成字节流，含读错误、
    EOF 无终态、transient / permanent 两类 `response.failed` / 流内 `error`），mock 显式错误
    不算充分。
12. **重试后的新写工具仍需批准**：新增 fixture 覆盖「失败前已批准过一次写工具 → 失败 → 重试
    返回一个新的需批准写工具」；断言批准前零副作用、批准后恰好执行一次、不复用失败前的一次性
    批准决定。

### 语义影响（节点 1 已确认，2026-11-23）

**现状**：Responses 流在终态事件未达时按已收内容正常收尾（`llm.rs:1162`），Chat 流在无
`[DONE]` / usage 末帧时也按正常完成收尾（`llm.rs:2003-2023`）；读错误 / 通道断开只是 `break`
（`llm.rs:1113-1125`）。用户看到的是一段**截断回答**，没有错误、没有重试入口。

**本 change 后**：上述三类（读错误、通道意外断开、协议终态未达而 EOF）归为 stream failure；
失败轮的半截正文保留并标「未完成」，同时出现错误行与重试动作。**少量以前静默通过的截断回答
会变成可见错误**——这是有意的行为变更，不是纯增量。协议依据：Responses 以
`response.completed` / `response.incomplete` / `response.failed` 为终态
（[OpenAI Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events)）；
Chat 以 `data: [DONE]` 为终止哨兵（[OpenAI Chat Completions streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)）。
仓内没有协议证据支持「无终态 EOF 属正常完成」，因此默认不放行；若未来某 provider 有官方文档
证明其允许无终态正常 EOF，必须在该 provider 预设显式声明并补真实解析层测试，MUST NOT 默认放行。

### 与既有合同的关系

- **不改**上下文超限的「自动压缩 + 重试该轮一次」口径（`openspec/specs/harness/spec.md:327`）；
  终态超限仍不提供手动重试，避免二次压缩 / 二次轮换文件。
- **不改** `loop_max` 语义（触顶是 `done`，不是 error）、错误行同文案去重、`in_flight` 相位模型。
- **有意改变**「无终态 EOF 按正常完成」的现状（见上「语义影响」）；这是本 change 的核心行为
  变更之一，不是顺带重构。
- **复用**既有 vision 能力判据（`config.vision_supported` + 同一错误码），不新增第二套判定；
  重试只是把同一判据应用到失败 `input` 的图片 parts。
- **不新增**自动重试、退避、重试队列、批量重试、失败原因自动修复（换 provider / 换模型 / 改 Key）。
- **不把**重试做成新会话或新 JSONL 文件；重试动作本身只在同一文件追加一对 `llm_request` /
  `llm_response`（既有自动压缩的轮换除外），符合「每次请求都有记录」的既有契约
  （`openspec/specs/harness/spec.md:600`）。

## 节点 1 裁决点（D1–D5，2026-11-23 全部按推荐值批准）

以下五项是产品语义，答案会改变方案结构或成本；技术实现不需要裁决。

| # | 事项 | 裁决结果（按推荐值生效） | 另一选项 / 代价（未采纳） |
|---|---|---|---|
| D1 | 重试的语义边界 | **只重发失败的那一次 provider 往返** | 整轮重新回答：会重跑工具、重复写、重复扣费；必须加「工具已执行即禁重试」，等于放弃大多数真实场景 |
| D2 | 失败轮已流出的半截正文 | **保留并标「未完成」，重试成功后并列第二条回答** | 替换旧正文（用户看到的内容被撤掉）／不标注直接追加（无法区分完整与截断） |
| D3 | 哪些失败给按钮 | **网络 / 408 / 425 / 429 / 任意 5xx / 归一后的 transient 流失败（含读错误、通道断开、无终态 EOF、`server_error` 等）/ 空响应** | 也把 permanent 流错误（鉴权 / 权限 / 非法请求 / 内容策略）与 401 / 400 纳入：按钮常是死的；不纳入则用户改完配置需重新输入 |
| D4 | 重试的存活范围 | **跨 webview 重载 / 切 vault 回来可以；跨重启 / 历史恢复不做** | 跨重启需要新增留存派生与恢复态错误行，成本约再翻一倍，且与「错误行是 live 面」的边界冲突 |
| D5 | 恢复时把 `error` 响应当完整正文折叠 | **并入本 change，同批修掉** | 另立 change：本 change 只做重试，恢复缺陷先登记 finding；风险是失败轮的「未完成」语义在恢复路径继续失真 |

已定、不再作为裁决点：**「把失败消息放回输入区编辑后重发」不在本期**。它需要发送时留存
composer 的 `{text, caret, cards}` 结构，且原消息已在历史里（要么产生两条用户消息、要么做删除），
与本期「原地补发」是两条不同语义；另立 change。

## Non-goals

- 不自动重试、不退避、不排队、不做重试计数 / 重试上限设置。
- 不重放失败轮之前的工具调用，不回滚已完成的工具结果，不删除历史里已产生的项。
- 重试动作本身不新建会话、不新建 JSONL 文件、不新增对外可见的轮次 id、不改 `turn_phase`
  三态语义（既有自动压缩 / 恢复的会话轮换不属本条禁止面）。
- 不跨 app 重启、不跨历史会话恢复提供重试；不把错误行持久化进面板记录。
- 不做「放回输入区编辑后重发」、不改 composer 草稿模型、不改 caret 还原。
- 不改上下文超限自动压缩 / 重试口径、不改 `loop_max`、不改错误行去重、不改 `in_flight`。
- 不为 cron 运行、子运行、自动唤醒回合提供重试（它们不产生可重试状态）。
- 不做计费对账 / 补偿；失败请求本身是否计费由 provider 决定，Lumir 不推测。
- 不新增依赖、不改配置 schema、不改源文件格式铁律。
- 不改 vision 能力判据本身（支持矩阵 / config schema / 错误码不变）；重试只复用同一判据做前置检查。

## Impact

- **specs**：`harness` 一条或两条 ADDED requirement——主体一条「失败轮次显式重试」；D5 并入时
  另加一条「恢复历史会话不折叠失败响应」。无 MODIFIED，避免整块替换的丢段风险；ADDED 只加
  新行为或对既有口径的显式限定，不复制既有正文。
- **代码面（实现期）**：
  - 后端：`src-tauri/src/harness/llm.rs`（真实 SSE 读循环的终态 / 读错误 / 通道断开归一，
    `TurnError` 增加稳定失败类别，`response.failed` / 流内 `error` 归一，fixture HTTP 状态 +
    error+chunks）、`session.rs`（失败状态 / 世代 / 快照读出口）、`turn.rs`（`Resume` 分支、
    失败登记、空响应判定顺序、半截正文标记）、`harness.rs`（`begin_retry` + `harness_retry`
    命令、失败 input 的 vision 前置检查、恢复折叠判定）、`lib.rs`（命令注册）。
  - 前端：`src/ipc.ts`（`harnessRetry`、error 事件可选 `retry`、快照 `retry` 读出口）、
    `src/harness-panel.ts`（错误行动作、busy 拒绝走 `in_flight`、两档快照幂等重建、世代守卫、
    半截正文标记）、`src/copy-data.ts`（zh / en 文案，含新的稳定流失败码，编号走文案漂移门禁）；
    若新增样式则动 `src/harness-panel.css`（或 `src/style.css`），并补视觉结构断言。
  - 测试：`src-tauri/tests/session_recording.rs`、`src-tauri/tests/harness_runtime.rs`、
    `src-tauri/src/harness/{llm,session,turn}.rs` 与 `src-tauri/src/harness.rs` 单测、
    `tests/unit` / `tests/visual`、`scripts/acceptance/fixtures/**` 与 `scenarios/**`。
- **性能合同**：不新增后台线程、不新增常驻轮询；空闲态零请求、零像素变化。一次点击最多重新
  发出一次失败往返；重试轮内的工具循环 / 命名辅助调用按既有口径，重试只影响失败后的显式动作，
  不进入 keypress-to-paint / 冷启动路径。
- **信息卫生**：验收 fixture / 场景 / 视觉基线只用合成 vault 内容，不含真实人名、真实项目 / 目录 /
  文件名或真实文档正文；提交前对改动面做 text 级 grep 清扫。

## 验证口径

- 提案阶段（本文件）：`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 与
  `bash scripts/docs-check.sh` 通过；日志落主仓
  `.local/reviews/harness-proposals/retry-final-*.log`。
- 实现阶段：先红后绿（R / F / A 三组矩阵见 `design.md` §11）；真实失败 fixture 序列必须能在
  mock provider 下复现五类形态：网络失败、HTTP 429 与 5xx、流中断（含半截正文后失败）、
  空响应、先工具后失败；**流失败的分类证据必须另有 Responses / Chat 两方言的真实解析层反例**
  （读错误、通道断开、无终态 EOF、transient / permanent 两类 `response.failed` / 流内 `error`），
  mock 显式错误不算充分；真机新增 / 更新场景随实现同 PR；`bash scripts/gate.sh quick`、
  动过视觉面时 `bash scripts/gate.sh visual`、`bash scripts/docs-check.sh` 全绿；证据落
  主仓 `.local/acceptance/`，不落 worktree。
- 覆盖声明纪律：tasks 里写「已验」的项必须附场景名 + PASS 计数；拿不出 PASS 指针的写「未验」。

## 关联材料

- 现状与方案依据：本文件 Why 的证据表（全部为仓内 file:line）；实现期逐条复核。
- 流程与制品约定：`docs/process/openspec-workflow.md`；反复踩坑清单：`REVIEW.md`。
- 真机套件用法：`scripts/acceptance/README.md`；视觉门禁口径：`tests/visual/README.md`。
- 详细设计（状态机、分类真值表、测试矩阵、改动面）：同目录 `design.md`。
- 任务拆分（先红后绿、fixture 序列、R / F / A 矩阵落地、门禁与信息卫生）：同目录 `tasks.md`。
