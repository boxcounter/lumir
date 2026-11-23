# Design: 失败轮次的显式重试

- Change ID: `add-harness-turn-retry-nov23`
- 日期: 2026-11-23
- 状态: 节点 1 已通过（2026-11-23，Alex 原话「三项推荐。」）；D1–D5 全部按推荐值生效，
  本文件是实现依据

## 1. 结论

**重试 = 在同一个会话、同一个逻辑轮次里，重新发出「失败的那一次 provider 往返」。**

- 不重发用户消息、不重跑失败前的工具循环（不重放旧工具调用）；重试动作本身不新建会话 /
  JSONL / 对外轮次 id（既有自动压缩 / 恢复的会话轮换不受影响）。
- 失败事实由后端持有并作为唯一判据方；前端只渲染一个动作。
- 可重试性由后端唯一分类；前端不维护第二份错误码清单。
- **流失败在真实传输 / 协议边界归一**：读错误、通道断开、协议终态未达而 EOF 都算 stream
  failure；`response.failed` / 流内 `error` 归一 transient / permanent，分类不读 provider 原始 code。
- 重试前基于失败 `input` 重新执行当前模型的 vision 闸；不支持时拒绝、保留失败状态、零请求。
- 重试同步拒绝（尤其 busy）不本地强制 idle；相位由 `in_flight` 快照收口；`enter` / `content`
  两档快照都幂等重建恰好一条动作。
- 重试成功后的新写工具仍走既有批准闸（有可证伪的 fixture 测试）。
- 只做显式重试：无自动重试、无退避、无队列、无重试计数。
- 跨 webview 重载 / 切 vault 回来可重试；跨 app 重启 / 历史恢复不做。
- 恢复历史时把 `error` 响应当完整正文折叠的同根缺陷，D5 已裁「并入」（2026-11-23），同批修掉。

## 2. 为什么是「一次 provider 往返」，不是「一整轮」

一轮用户回合可能包含多次 provider 往返（工具循环每迭代一次就是一次）。失败可能发生在：

- 第 1 次往返：`input` 末尾就是用户消息；
- 第 k 次往返（k > 1）：`input` 末尾是上一轮已完成的工具调用项 + 输出项。

两种情况下，失败的那一次请求都由 `build_request` 从 `session.input` 整体克隆而来
（`src-tauri/src/harness/turn.rs:520-539`），且错误分支在 `execute_calls` 之前返回
（`:583-614` 对比 `:705`）。因此：

- 失败的那次往返没有执行任何工具（此前轮次已完成的调用项与输出项留在 `input` 里）；
- `session.input` 在失败后没有被失败响应污染（错误分支 return 早于输出项入队）；
- 「再发一次同一请求」在结构上就是「从模型该继续的地方继续」，不是整轮重放。

整轮重放（备选 D）会从用户消息重新跑工具循环：历史里出现第二条用户消息，或要回滚 `input`
丢掉已完成的工具结果；还会重复执行工具、重复写、重复计费。否决。

## 3. 失败分类：真实传输 / 协议边界归一

### 3.1 判据输入：稳定内部失败类别

分类器 MUST 是后端唯一实现，输入是**稳定内部失败类别**（由传输 / 协议解析边界产出），
不是 provider 原始 `code`：

```
classify_failure(kind: FailureKind, context_overflow: bool) -> Retryable | NotRetryable

FailureKind =
  | NetworkSend                 // 发送失败（连接 / DNS / 超时）
  | HttpNon2xx(u16)             // 非 2xx，按状态码
  | StreamTransport             // SSE 读错误 / channel 意外断开
  | StreamMissingTerminal       // 协议终态未达而 EOF
  | StreamReportedTransient     // response.failed / 流内 error，归一为 transient
  | StreamReportedPermanent     // response.failed / 流内 error，归一为 permanent
  | EmptyResponse               // 无正文、无工具调用
  | Config | Attachment | CompactFailed | Internal | Protocol
```

`context_overflow` 是独立布尔（既有特征串判定），优先于 `kind` 判否；`Overflow` 因此不单列
`FailureKind` 变体，避免同一事实两个来源。

`TurnError` 增加 `kind: FailureKind`；`code` / `message` 仍保留，只作文案与诊断。分类器
MUST NOT 读 `code` 字面量；`llm_error` sidecar / error 事件里的 provider 原始 code 只作诊断
素材，MUST NOT 进入可重试性判定。provider 原始 code 只在**边界归一函数**里出现一次，其输出是
`FailureKind`；分类器与前端都只读 `FailureKind`（前端只读 error 事件 / 快照里的 `retry` 缺键）。

为什么不是 `llm::retryable(&TurnError)` 单一函数：`harness_empty_response` 由 `turn.rs` 直接发
终态（`:670-679`），从不经过 `TurnError`；`harness_internal_error` 由 panic 收口发出，同样不是
`TurnError`。分类器定义在失败类别层，才能覆盖全部终态出口。

### 3.2 协议终态与传输语义（真实解析层）

**终态是协议合同，不是「读到 EOF 就算完」**：

| 方言 | 协议终态 | 证据 |
|---|---|---|
| Responses | `response.completed` / `response.incomplete` / `response.failed` | [OpenAI Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events)；客户端可在这三类事件后停止读流，**没有**「无终态 EOF 即正常」的协议依据 |
| Chat Completions | `data: [DONE]`；请求了 `stream_options.include_usage` 时 usage 末帧是最后一个内容帧（其后只会是 `[DONE]`），可作收流点 | [OpenAI Chat Completions streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)；官方形态以 `[DONE]` 终止 |

已知第三方 OpenAI-compatible 端点可能不发 `[DONE]`
（[ik_llama.cpp issue #467](https://github.com/ikawrakow/ik_llama.cpp/issues/467)），或某些
Responses 兼容实现只发 `[DONE]` 不发 `response.*` 终态。本仓**不以社区 issue 作为放行依据**：
这些形态统一按 `StreamMissingTerminal` 处理（可见错误）。若未来要支持，必须在该 provider 预设
显式声明、给出官方文档证据并补真实解析层测试，MUST NOT 默认放行。

现状与缺口（当前树）：

- `pump_sse` 把读错误（`Ok(Err(_))`）与 channel 断开都只是 `break`（`llm.rs:1113-1125`），
  没有把两者带给上层。
- `parse_sse_reader` 在无终态事件时直接返回已收内容（`llm.rs:1162`）；
  `parse_chat_sse_reader` 的 `finish()` 同样不检查终态（`llm.rs:2003-2023`）。
- `dispatch_event` 的终态判定用 `usage.is_some() || error.is_some()` 近似（`llm.rs:1166-1169`），
  不是事件名判据；`response.failed` / 流内 `error` 保留 provider 原始 code（`llm.rs:1212-1230`）。

**本 change 的解析层要求**：

1. `pump_sse` SHALL 返回可区分的结束原因：`Terminal` / `Aborted` / `Eof` / `ReadError`。
   读线程在正常 EOF 后发 `Finished` 哨兵；`io::Error` 以显式 `ReadError` 信号交给消费端；
   消费端只在收到 `Finished` 后的断开判 `Eof`，**无哨兵的断开**（线程 panic / 异常）按
   `ReadError` 处理。`sink.aborted()` 仍归 `Aborted`，由 `turn` 的停止检查点收口，MUST NOT
   当成错误。
2. Responses：`terminal_seen` SHALL 由 `response.completed` / `response.incomplete` /
   `response.failed` 三个事件名显式置位，MUST NOT 用 usage / error 有无近似。`[DONE]` 不是
   Responses 终态，单独出现不置位。
3. Chat：`terminal_seen` SHALL 由 `[DONE]` 或 usage 末帧显式置位。
4. `Eof` 且 `terminal_seen == false` → `StreamMissingTerminal`；`ReadError` → `StreamTransport`；
   两者都保留已收正文 / 思考 / 调用，但 `output.error` 必须被设置（可见错误）。
5. `response.failed` / 流内 `error` → `StreamReportedTransient` 或 `StreamReportedPermanent`：
   按 provider 错误的 `type` / `code` 归一；已知永久类（`invalid_request_error` /
   `authentication_error` / `permission_error` / `not_found_error` / `content_policy_violation` /
   `insufficient_quota` 等鉴权、权限、非法请求、内容策略、额度耗尽）判 permanent；其余含
   `server_error` 与未知类别判 transient。原始 code / message 保留在 `TurnError.code` /
   `message` 与 `llm_error` sidecar，只作诊断。
6. `context_overflow` 仍由既有特征串计算；`context_overflow=true` 优先于 `kind` 判否（含
   `StreamReported*` 与 HTTP 5xx 形态）。
7. 若未来某 provider 有官方文档证明允许无终态正常 EOF，必须在该 provider 预设显式声明并补
   真实解析层测试；MUST NOT 默认放行。

**语义影响（节点 1 已确认，2026-11-23）**：现状下「无终态 EOF」与「读错误 / 通道断开」两类形态会让截断回答
静默通过；本 change 后变成可见错误 + 半截正文「未完成」+ 可重试动作（transient 类）。这是有意
的行为变更。

**测试证据要求**：上述 1–6 必须有 Responses 与 Chat 两方言的真实解析层反例（合成字节流：
deltas 后 ReadError、deltas 后无哨兵断开、deltas 后 EOF 无终态、`response.failed(server_error)`、
`response.failed(invalid_request_error)`、Chat `error` 两类、Chat `[DONE]` 正常收尾）。
mock 的显式 `error` 只用于产品流程，不构成分类证据。

### 3.3 分类真值表

| 失败类别 | 可重试 | 理由 |
|---|---|---|
| `NetworkSend` | 是 | 连接 / DNS / 超时类，重发可能成功 |
| `HttpNon2xx(408 / 425 / 429 / 任意 5xx)` | 是 | 瞬时 / 限流 / 服务端 |
| `HttpNon2xx(其余 4xx)` | 否 | 同一请求重发必然再失败；改配置后重新发送 |
| `StreamTransport` | 是 | 读错误 / 通道断开；请求已完成、无工具副作用 |
| `StreamMissingTerminal` | 是 | 协议终态未达而 EOF；半截正文不再静默通过 |
| `StreamReportedTransient` | 是 | `server_error` / rate limit / 未知；重发可能成功 |
| `StreamReportedPermanent` | 否 | 鉴权 / 权限 / 非法请求 / 内容策略；重发必然再失败 |
| `EmptyResponse` | 是 | 请求已完成、无副作用；重试最便宜 |
| `Config` | 否 | 配置级失败；失败时用户消息尚未入会话 |
| `Attachment` | 否 | 文件缺失 / 损坏 / 能力不支持 |
| `context_overflow=true`（超限终态） | 否 | 既有「自动压缩 + 重试一次」已覆盖；再点会连锁开新 JSONL |
| `CompactFailed` | 否 | 压缩本身失败，重试只会再撞 |
| `Internal` / `Protocol` / `fixture_exhausted` | 否 | 内部 / 协议 / 测试脚本错误 |
| 用户停止（`aborted`） | 否 | 不是 error 终态；用户已表态「不再继续」 |
| `loop_max` 触顶 | 否 | 不是 error 终态；已有明确提示与开新会话建议 |

**优先级**：`Overflow` / `CompactFailed` 恒判否，优先于 `StreamReported*` 与 HTTP 状态码——
即使 HTTP 状态落在 5xx，只要是超限终态 / 压缩失败就不提供重试；`EmptyResponse` 只在空响应
分支成立，与其他类别互斥。

### 3.4 分类结果的消费面

- error 事件：`{"type":"error","code","message","retry":{"turn":N}}`；不可重试时 `retry` 缺键。
- `harness_state` 快照：`{"retry":{"turn":N}}`；无失败 / 不可重试 / 非交互轮次时缺键。
- `llm_error` sidecar MAY 带 `failure_kind`（稳定内部类别）供诊断；它 MUST NOT 参与恢复重建，
  也 MUST NOT 成为第二判据源（判定只认 `TurnError.kind`）。
- 前端 MUST NOT 自己按 `code` / `message` 判断可重试性；缺键即不渲染动作。

## 4. 状态机

### 4.1 后端（每个 vault 的活跃会话一份）

```
Session {
    turn_seq: u64,              // 轮次世代；begin_turn 推进，不落盘、不进 wire
    failed: Option<FailedTurn>, // 仅「当前仍可重试」的最近一次失败
}

FailedTurn {
    turn: u64,          // 失败时的 turn_seq
    input_len: usize,   // 失败时 session.input 的长度（廉价二道保险）
    user_text: String,  // 本轮用户提问原文段，供重试成功后的 after_turn（命名 / 节奏）
}
```

`code` / `http_status` / `round` / `tools_executed` 已删除：快照与事件只暴露 `turn`，没有 UI
消费合同；诊断所需的 code / message / HTTP 面已在 `llm_error` sidecar 与 `llm_response` 里。
保留三个字段各自有消费者：`turn`（动作绑定 + 世代守卫）、`input_len`（守卫）、`user_text`
（重试成功后的会话自动命名）。

```
                  send / retry（acquire 成功，begin_turn 推进世代并清 failed）
        ┌──────────────────────────────────────────────────────────┐
        │                                                          ▼
  Idle(failed=None) ◄── done / aborted / 不可重试 error ────── Running
        ▲                                                          │
        │                                                          ├─ 可重试 error ──► Idle(failed=Some)
        │                                                          │
        └──────────── retry 被接受（failed 在锁内被取走）──────────┘
```

| 事件 | `turn_seq` | `failed` |
|---|---|---|
| `begin_turn`（发送 / 重试 / 自动回合 / cron 交互槽） | +1 | 清空 |
| 可重试错误终态（仅交互用户轮 / 重试轮） | 不变 | 写入本轮的 `FailedTurn` |
| 不可重试错误终态 / `done` / `aborted` | 不变 | 清空 |
| `reset_session` / `resume_session` / 关闭 vault | 会话对象换新（`subagent_token` 变） | 随对象消失 |
| 线程起不来（`harness_thread_failed`） | 不变 | 轮次内不登记（同步拒绝，未进入轮次）；`harness_retry` 起线程失败是例外：failed 放回，动作保留 |

**为什么 `turn_seq` 不对外暴露**：它不是会话 id、不是 JSONL 里的轮次 id，只用于「这次失败还是不是
当前这一轮」的守卫。对外只出现在 `retry.turn` 里做动作绑定，读者无法拿它寻址任何持久化对象。

### 4.2 `harness_retry(turn)` 的守卫（同一把锁内原子完成）

1. 当前 vault 无会话 → `harness_no_session`（复用既有错误码）。
2. 会话忙（`is_busy`）→ `harness_busy`（复用既有文案；连点 / 并发第二次必中）。
3. `failed` 为空 → `harness_no_failed_turn`。
4. `turn != failed.turn` 或 `session.turn_seq != failed.turn` → `harness_turn_stale`。
5. **vision 前置闸**：读取失败轮的 `input`，若含 image part 且当前 provider / model 未声明
   vision → `harness_image_unsupported`；`failed` 原样保留、不 `begin_turn`、零 provider 请求。
   能力判据 MUST 与 `harness_send` 的 `image_gate_error` 同一实现（或抽同一纯函数），MUST NOT
   另立第二套。此步 MUST 在消费 `failed` 之前；**vision 检查与后续重试线程 MUST 使用同一份
   config 快照**，MUST NOT 在检查后重新 `load` 一次。
6. `session.input.len() != failed.input_len` → `harness_turn_stale`（廉价二道保险）。
7. 校验通过后**在同一把锁内**取走 `failed`（消费，防重放）→ `begin_turn()`（推进世代、置
   Running、清 abort）→ 返回「重试票据」（含 `user_text`）。线程入口 MUST NOT 再调
   `acquire_turn`——此时相位已是 Running，二次 acquire 必得 `harness_busy`；重试复用发送路径
   `run_turn` 的线程体（sink / client / catch_unwind / release / title 的同一实现），只跳过
   acquire 一步。
8. 线程起不来：把 `failed` 放回（同一把锁内）、把 `turn_seq` 回滚到 `begin_retry` 之前的值
   （或等价地不推进世代）、`end_turn()`、返回 `harness_thread_failed`——一次瞬时资源失败不得把
   重试入口也吞掉；这不是自动重试。回滚 MUST 保证 `failed.turn` 与 `turn_seq` 仍一致，动作行
   不需要换绑。放回 MUST 只发生在「尚未起线程」的失败路径，MUST NOT 在轮次已开始后复活旧失败
   状态。

### 4.3 前端生命周期

```
error(retry:{turn}) → appendError + 错误行上的「重试」动作（retryTurn = turn）
click → 动作立即禁用 + dispatchActivity(sent) + harnessRetry(turn)
   ├ 接受 → 相位 running，流式上屏；done → 清 retryTurn
   ├ 再失败（可重试）→ 新 error（新 turn）→ 同一错误行就地替换，动作绑新 turn
   ├ 再失败（不可重试）→ 错误行更新，动作消失
   └ 拒绝（busy / stale / no_failed / thread_failed / image_unsupported）
        → 错误行 + 重取 in_flight 快照（不 local_finish、不强制 idle、不关 turnOpen）
        → 动作由快照 retry 幂等重建（vision 拒绝 / 线程失败时 failed 仍保留）
```

- 不新增 `SendPhase` 档位；重试复用 running / idle 两态。
- **busy 拒绝不是本地收口**：相位由 `harness_state.in_flight` 权威决定（与发送路径的
  `harness_busy` 特例同一口径）。第一次重试仍在流式时第二次 busy，第二次 MUST NOT 关
  `turnOpen` / 清 `midTakeover` / 强制 idle；第一次的后续分片、工具行与终态照常上屏。
- stale / no_failed / thread_failed / image_unsupported 同样不本地强制 idle——staleness 的成因
  可能正是新一轮在跑；统一让快照 `in_flight` 决定相位，动作则由快照 `retry` 决定。
- vision 拒绝（`harness_image_unsupported`）走人话错误行；`failed` 保留，快照 `retry` 仍在，
  用户切回支持 vision 的模型后可再点。
- 开始重试时要补两件现有发送由 `appendUserMessage` 顺带完成的事：`collapseTools()` 与
  `lastAssistantEl = null`，否则新一轮的思考块 / 工具行会挂到上一轮气泡上。
- 任何新轮次开始（发送 / 重试 / 自动回合）都清掉旧的重试动作；同一时刻最多一个可点动作；
  `enter` / `content` 两档快照重放后都幂等重建恰好一条尾部动作（见 §6.3）。

### 4.4 世代守卫矩阵

| 威胁 | 守卫 |
|---|---|
| 连点 / 并发重试 | `is_busy` + `failed` 在锁内被取走；第二次必得 `harness_busy` 或 `harness_no_failed_turn` |
| 第一次重试仍流式 + 第二次 busy | 不本地收口；`in_flight` 快照保持 running；不关 `turnOpen`；第一次后续分片 / 终态照常 |
| vision 闸拒绝（切到非 vision 模型） | `failed` 保留、零请求；快照 `retry` 重建动作 |
| 线程启动失败 | `failed` 放回、`turn_seq` 回滚；快照 `retry` 重建动作 |
| 失败后用户又发新消息 | `begin_turn` 已推进 `turn_seq` → `harness_turn_stale` |
| 新会话 / 恢复会话 / 关闭 vault | 会话对象换新 → 无 `failed`（`harness_no_failed_turn`） |
| 切 vault | 会话按 vault 键控；命令只作用于当前 vault；前端 `viewGeneration` 作废旧视图回包 |
| 旧轮次迟到的终态事件 | 相位由 `in_flight` 快照收口；动作绑定最新事件里的 turn |
| webview 重载 | `harness_state.retry` 重建尾部动作行（见 §6） |
| 重试请求本身的迟到拒绝回包 | 发送时定格 `viewGeneration`；换代后整条 no-op |

## 5. 请求复用与不变量

### 5.1 唯一事实源：`Session.input`

重试 MUST 走 `build_request(ctx)`（`turn.rs:946` 起的同一实现），它整体克隆 `session.input`：

- **消息**：不重新装配用户消息、不重新拼上下文节（它已在项内）、不重新装配 system prompt。
- **part**：wire 项的 `content` parts（`input_text` / `input_image` / `lumir_label`）原样进请求；
  MUST NOT 用 `serializeQuoteMessage` / `projectDelivery` 反向重建——后者会重排、会把 XML 当正文、
  且对非法卡片直接抛错。
- **card**：只存在显示面；恢复 / 切 vault 的用户气泡已由 `panel_text_of_content` →
  `parseQuoteMessage` 重建，重试不新增第二条路径。
- **caret**：只在「放回输入区编辑后重发」里需要；本期不做（发送路径不保存发送时的 caret）。

### 5.2 可测不变量

| # | 不变量 | 范围 |
|---|---|---|
| P1 | 重试请求的 `messages` 与失败请求的 `messages` 逐字节相同（含原始 text / image parts） | 全部可重试错误（含 `StreamTransport` / `StreamMissingTerminal` / `StreamReported*`） |
| P2 | 会话 `input` 长度在失败到重试之间不变；用户消息条数不变 | 同上 |
| P3 | 重试一次 = `llm_request` / `llm_response` 各 +1 条；重试动作本身不新建 JSONL、不写 `session_open`（既有自动压缩的轮换除外） | 全部 |
| P4 | 失败轮之前已完成的工具调用项与输出项原样在 `input` 里，不重排、不重执行 | 全部 |
| P5 | 切换 provider / model 后重试：P1 / P2 仍成立；完整 HTTP 请求（模型名、参数、工具定义、wire 方言）**不要求**逐字节相同 | 全部 |
| P6 | 空响应失败：重试请求与失败请求的 `messages` 相同（空响应的 reasoning 回放项不进 `input`） | 空响应 |

**P1 的边界（空响应）**：当前空响应终态在响应项已折进 `input` 之后才判（`turn.rs:616-679`）。
若该次响应只带 reasoning，`input` 会先多一个 reasoning 项，重试请求因此与失败请求不完全相同。
本 change 的支撑改动：把空响应判定前移到响应项入 `input` / `panel` 之前（usage 仍照常累计），
使空响应不留任何回放项——这既是 P1 的前提，也避免「失败响应的思考进入下一轮历史」。
这是有意的小行为收紧，登记在 tasks 的支撑改动项里。

### 5.3 工具不重放：结构保证与其边界

- **结构保证**：错误分支（`turn.rs:583-614`）位于 `execute_calls`（`:705`）之前；失败的那次往返
  不可能执行任何工具。重试只进 `TurnInput::Resume`：该分支没有用户消息入队、没有预先重放旧
  工具调用的步骤；它进入同一条工具循环，第一条请求即失败的那次请求，成功响应后的新工具调用
  按正常回合执行。因此不存在「从失败用户消息重新起一轮」的代码路径。
- **不扩大的解释**：这不等于「重试后模型不会发起任何新的写操作」。重试成功后，模型新发起的
  `vault_patch` / `vault_create` / `cli_run` 等调用照常走既有权限规则、权限模式与批准闸；
  规格只保证**不自动重放旧工具调用**，不保证后续回合零写操作，也不得因此绕过任何闸。
  **可证伪测试**见 R14 / A10：失败前一次性批准过的写工具，不得让重试后的新写工具免批。

## 6. 快照、事件与恢复边界

### 6.1 事件

`events::error` 增加可选 `retry`：

```json
{"type":"error","code":"harness_network_failed","message":"…","retry":{"turn":7}}
```

不可重试时缺键（不写 `retry:null`，避免前端把「在场但空」当可重试）。既有 `type` / `code` /
`message` 三键不变，旧消费者不受影响。

### 6.2 快照

`StateSnapshot` 增加可选 `retry`（`skip_serializing_if` 缺键）：

```json
{"retry":{"turn":7}}
```

- **只暴露 turn，不暴露 code / message / 半截正文**：恢复态重试行是通用文案 + 动作，不是
  transcript 错误行的持久化；错误行仍是 live 面（`openspec/specs/harness/spec.md:958-959`）。
  代价是重载后看不到原错误原因——这是「错误行 live-only」的直接后果，换取不新增留存面；
  用户点击后若再失败，会从新错误行得知原因。
- `StateSnapshot::empty` 同样缺键。
- `reset_session` / `resume_session` / 关闭 vault 后自然缺键（会话对象换新）。

### 6.3 恢复渲染

- **enter 快照**（面板装载 / 切回 vault）：消息重放完成后，按 `retry` 幂等重建尾部动作：
  先移除既有动作行，若 `retry` 在场则追加恰好一条。
- **content 快照**（接管 / 错误后重取）：`content` 档会 `clearTranscriptSurface()` 后重放，
  因此**清面后必须按 `retry` 重建**；同样先移除既有动作行再追加，保证恰好一条。MUST NOT 把
  「不重复」实现成「不新增」——否则中途接管后错误行与动作都被清掉，入口归零。
- 线程启动失败 / vision 闸拒绝后，后端仍保留 `failed`；快照 `retry` 在场，重放后动作必须在场。
- **拒绝路径（busy / stale / no_failed / thread_failed / image_unsupported）不重放内容**：用轻量
  快照就地更新相位与动作，保留刚追加的拒绝错误行；`retry` 缺席移除动作，在场保留 / 重建。
- 动作行 MUST NOT 进入 `panel` 记录、MUST NOT 参与消息计数、MUST NOT 被当作 assistant / error
  消息。
- 切 vault 后旧视图的回包由 `snapshotSeq` / `viewGeneration` 作废；动作只跟随当前 vault 的快照。
- 幂等判据：重放后 `transcript` 中该类动作行数量恰好为 1（`retry` 缺席时为 0）；重复 content
  快照不叠加。

### 6.4 不跨重启 / 不跨历史恢复

- 失败事实只在内存态，不落 JSONL；app 重启后会话对象消失，恢复历史不重建重试动作。恢复内容
  是否包含失败响应按 D5 裁决（§7）。
- 恢复历史时，若末尾响应带 `error`，不折叠（§7，D5 并入时）；恢复结果 = 用户消息 + 之前已完成
  的工具项，没有 assistant 回答、没有重试动作。用户可以直接继续对话（发新消息），也可以重新提问。

## 7. D5：恢复历史不折叠失败响应

### 7.1 现状缺陷

`resume_session` 取最后一条会话 `llm_request` 的 messages，然后无条件折叠其后一条
`llm_response`（`harness.rs:603-630`）：不检查 `response["error"]`。后果：

- 失败响应的半截正文被当作完整 assistant 消息折进 `input`，模型把它当已完成的历史；
- 面板映射 `restored_panel_messages` 从同一 `restored` 数组产出，恢复后一段被截断的回答
  看起来像完整回答；
- 与「错误行是 live 面」的边界冲突：错误行不重建，但失败的**正文**却被重建了。

### 7.2 修法

折叠锚点响应前判 `response["error"]` 是否在场；在场则整条跳过（正文 / 思考 / `tool_calls`
都不折）。恢复结果停在失败前已完成的最后一项。对既有文件的读取保持只读：不迁移、不回写、
不删除记录；成功响应的折叠行为逐字节不变。

### 7.3 与既有 requirement 的关系

不写 MODIFIED：既有「会话边界」条（`openspec/specs/harness/spec.md:549-596`）与新 requirement
不是整块替换关系，MODIFIED 会要求整条复制、抄漏即静默丢段（`docs/process/openspec-workflow.md`
的实测先例）。新增一条 ADDED requirement，显式写明「既有折叠口径以响应不带 `error` 为前提」，
让两条并读时没有歧义。D5 已裁「并入」（2026-11-23）：该 ADDED requirement 与 §7 / R13 保留，
「另立」退路不再适用。

## 8. 非交互轮次的排除

| 轮次来源 | 是否产生可重试状态 | 理由 |
|---|---|---|
| 交互用户发送（`harness_send`） | 是 | 本 change 的对象 |
| 显式重试（`harness_retry`） | 是 | 再次失败仍可重试，动作绑新 turn |
| cron 运行（`harness_cron_run`，含交互槽） | 否 | 失败按运行契约回执（`cron:run_finished`）；重试不会触发 completion，状态机会悬挂 |
| 子运行（`subagents`） | 否 | 子运行有自己的引擎与生命周期；父会话不持有它的失败事实 |
| 自动唤醒回合（`TurnInput::Preloaded`） | 否 | 没有用户动作；失败按自动回合口径收口，不产生可点动作 |

实现口径：`run_turn` / `run_turn_core_with_mode` 增加一个显式的轮次来源（或等价的
`allow_retry` 位），只有交互用户轮与重试轮允许登记失败；MUST NOT 用「有没有 completion 回调」
「有没有 tool_policy」这类间接推断——那是第二真源。

交互槽上的 cron / 自动回合与用户发送共用会话世代：它们开始时推进 `turn_seq` 并清空 `failed`，
旧重试动作因此失效——这是共享会话的既有语义，不另开旁路；用户可在其结束后重新发送。

## 9. 前端交互细节

### 9.1 错误行上的动作

- `appendError` 目前只写 `textContent`；扩展为可挂一个动作容器。同文案去重时就地替换正文并
  重绑动作到最新 turn（新 error 不可重试时移除动作）；不同文案照常追加新错误行（既有口径不变）。
- 动作的可访问名走文案表（zh / en），带 `title` / `aria-label`；键盘可达（按钮语义，不是裸 div）。
- 点击后立即 `disabled`，并在同一拍 `dispatchActivity({type:"sent"})`；不等待后端回执。
- **同步拒绝统一走同一份 `harness_state` 轻量快照**（可新增 `fetchRetrySnapshot`，内部复用
  `applyEnterSnapshot`；MUST NOT 改变既有 `fetchActivitySnapshot` 的「只读相位」职责）：
  同一份响应同时读 `in_flight` 与 `retry`；相位按 `in_flight`，动作按 `retry` **就地幂等更新**
  （不重放消息、不清刚追加的拒绝错误行）。busy / stale / no_failed 时 `retry` 通常缺席 →
  移除动作；thread_failed / image_unsupported 时 `retry` 在场 → 动作保留 / 重建。
- **busy 拒绝不是本地收口**：相位由 `harness_state.in_flight` 权威决定（与发送路径的
  `harness_busy` 特例同一口径）。第一次重试仍在流式时第二次 busy，第二次 MUST NOT 关
  `turnOpen` / 清 `midTakeover` / 强制 idle；第一次的后续分片、工具行与终态照常上屏。
- stale / no_failed / thread_failed / image_unsupported 同样不本地强制 idle——staleness 的成因
  可能正是新一轮在跑；统一让快照 `in_flight` 决定相位，动作则由快照 `retry` 决定。
- **vision 拒绝**：`harness_image_unsupported` 走人话错误行；`failed` 保留、零 provider 请求；
  快照 `retry` 重建动作，切回支持 vision 的模型后可再点。重试语境没有 composer 卡片可移除，
  文案 MUST NOT 照抄发送路径的「移除图片卡片」句，SHALL 指向「切换到支持图片的模型」。
- **content 快照**：清面后按 `retry` 幂等重建恰好一条尾部动作（见 §6.3），不得只更新既有行。
- **拒绝路径不触发 content 快照**：用轻量快照就地更新相位与动作，避免清掉刚追加的拒绝错误行；
  `retry` 缺席则移除动作，在场则保留 / 重建。

### 9.2 半截正文的「未完成」标记

- 失败轮的流式正文已经在 live DOM 里；error 分支当前只 `finalizeStreamingMessage()`。新增一个
  live-only 状态标记（与 `aborted` 的「已停止」同型）：在该条 assistant 消息尾部标注「未完成」。
- **语义影响**：现状下无终态 EOF / 读错误会让截断回答静默通过；本 change 后同一形态变成
  可见错误 + 「未完成」标记（transient 类还带重试动作）。这是有意行为变更，节点 1 材料已声明。
- 该标记不进 `panel`、不进快照、不进恢复；重试成功后的新回答另起一条 assistant 消息。
- 若失败前没有任何正文（网络失败在首字节之前），不产生空状态标记。

### 9.3 重试成功 / 再失败

- 成功：正常 `done`，清 `retryTurn`；`after_turn(user_text)` 用 `FailedTurn.user_text`，
  会话自动命名的「首轮 / 5 轮节奏」不因一次失败而永久跳过。
- 再失败且可重试：新 error 带新 turn；同文案错误行就地替换并重绑动作；旧的「未完成」正文保留。
- 再失败且不可重试：动作消失，错误行按既有文案展示。
- **同步拒绝不是新失败**：busy / stale / no_failed / thread_failed / image_unsupported 不适用
  上一条「动作消失」——vision / 线程失败保留 `failed`，动作由快照 `retry` 重建；busy 时相位由
  `in_flight` 决定，不本地收口。

### 9.4 队列通知

重试不调用 `begin_user_turn`，不并入排队中的后台完成通知；它们按既有口径在之后的下一次用户
发言前并入。重试也不等待仍在跑的后台子运行——它们的结果在之后的回合以通知出现。

### 9.5 视觉口径（无原型，按既有错误行 / 状态标记）

本 change 没有原型；不新建设计系统，也不改 `ui-design-system` 的既有条款。落到实现的最小口径：

- **重试动作**挂在错误行内、文案之后，随错误行既有折行规则换行；不新开浮层 / toast / 图标钮，
  不新增独立区块。视觉件与既有次级文本钮同族（同一份 hover / focus ring / disabled 口径）。
- **字级与颜色**取错误行同一档（micro 字号、错误色族）；eink 主题不引入彩色，用下划线 / 描边
  表达可点，与既有 eink 档的处理一致。
- **「未完成」标记**复用「已停止」标记的几何与字级，只换文案；不新增颜色、图标或动效。
- **快照尾部动作行**与 live 错误行上的动作使用同一视觉件，文案为通用句；空闲态零像素变化。
- **手感 / 审美**（按钮位置是否顺手、文案长度、错误行高度变化）归 Alex 真机裁决，不进机器判据；
  机器只断言动作在场 / 可访问名 / 空闲态无像素漂移。

## 10. 备选与取舍

| 备选 | 做法 | 代价 / 风险 | 结论 |
|---|---|---|---|
| **A（推荐）** 失败往返原地续发 | 复用 `input`，从失败那次请求继续 | 需要后端失败状态 + 一条新命令；无重复写、无重复入队 | 采纳 |
| B 编辑后重发 | 把失败消息重建为 composer 的 `{text, caret, cards}` | 需要发送时留存 composer 结构；原消息已在 `input` 里，再发会产生第二条用户消息（要删旧的 → 破坏性）；caret 无留存 | 本期不做，另立 change |
| C 跨重启 / 恢复后仍可重试 | 用 `llm_error` / `llm_response.error` 派生失败事实 | 需要新的留存派生逻辑 + 恢复态错误行（与「错误行是 live 面」冲突）；还要先修 D5 | 不做 |
| D 整轮重放 | 从用户消息重新跑工具循环 | 重复执行工具、重复写、重复计费；必须加「工具已执行即禁重试」，等于把 A 的主要场景全禁掉 | 否决 |
| E 自动重试 / 退避 | 后台自动再发 | 明确出界（成本与停止语义） | 否决 |

## 11. 测试矩阵

### 11.1 后端（Rust 单测 / 集成）

| # | 断言 | 落点建议 |
|---|---|---|
| R1 | `classify_failure` 真值表：`NetworkSend` / `HttpNon2xx(408/425/429/5xx)` / `StreamTransport` / `StreamMissingTerminal` / `StreamReportedTransient` / `EmptyResponse` 可重试；`HttpNon2xx(其余 4xx)` / `StreamReportedPermanent` / `Config` / `Attachment` / `CompactFailed` / `Internal` / `Protocol` / `fixture_exhausted` 不可重试；`context_overflow=true` 优先判否；判定不读 provider 原始 code | `llm.rs` / 新分类模块单测 |
| R2 | 可重试错误后 `failed` 被登记；`done` / `aborted` / 不可重试错误 / `begin_turn` / `reset_session` / `resume_session` 后为空 | `session.rs` 单测 |
| R3 | `harness_retry` 守卫：无会话、无失败、忙、turn 过期、input_len 不符各返回约定错误码；**vision 前置闸在消费 failed 之前**（含图 + 非 vision → `harness_image_unsupported`、failed 保留、零请求）；线程起不来时 failed 放回 + `turn_seq` 回滚；线程入口不重复 `acquire_turn` | `harness.rs`（`begin_retry` 原子守卫 + 票据） |
| R4 | **属性：重试请求 == 失败请求**——第 1 轮失败与第 k 轮失败各一例，`llm_request.request.messages` 与重试的逐字节相等；`input` 长度不变 | `session_recording.rs` |
| R4b | **切换配置后重试**：failure 后切 provider / model / effort（或 wire），重试的 `messages` 仍逐字节相同；新 `llm_request` 记录新 provider / model / `params.thinking`（wire 方言按当前配置发送，`session_open` 不因重试改写） | `session_recording.rs` |
| R5 | **工具不重放**：fixture 先成功执行一次 `vault_create`，下一轮失败；重试后目标文件仍只有一份、面板工具记录只一条、`llm_request` 只多一对 | 同上 |
| R6 | 一次点击最多重发一次失败往返：并发两次 retry，第二次 `harness_busy` / `harness_no_failed_turn`；在无工具调用的 fixture 下请求数 +1 | `harness_runtime.rs` 或单测 |
| R7 | 快照：可重试失败后 `retry` 在场；`done` / `aborted` / 不可重试 / 新会话 / 恢复后缺席；`in_flight` 在 `Finishing` 为假 | `session.rs` 单测 |
| R8 | 超限终态不给重试（`retry` 缺席），且不会二次压缩 / 二次轮换文件 | `turn.rs` 单测 |
| R9 | 流式失败带半截正文：错误终态时半截正文已逐片转发（sink 收到 chunks）且未进入 `input` / `panel`；重试成功生成**第二条** assistant 消息；`input` 只含后者 | `turn.rs` 单测（DOM 标记由 F7 覆盖） |
| R10 | 恢复充分性回归：重试后的 JSONL 恢复 → 一条用户消息 + 一条最终回答，无重复、无半截正文 | `session_recording.rs` |
| R11 | 空响应：重试请求 messages 与失败请求相同；空响应的 reasoning 回放项不进 `input`；**并断言空响应路径的 `record_usage` / `on_round_usage` 仍被调用、思考兜底仍先于错误收口、abort 仍优先于空响应判定**；重试成功后正常回答 | `turn.rs` 单测 |
| R12 | 非交互轮次（cron / 子运行 / 自动回合）失败不产生 `failed` / `retry` | `harness.rs` / `subagents.rs` 单测 |
| R13 | D5：恢复时带 `error` 的末尾响应不折叠（正文 / 思考 / tool_calls 都不进 `input` 与面板）；成功响应仍折叠；旧文件逐字节不变 | `harness.rs` 单测 + `session_recording.rs` |
| R14 | **重试后的新写工具仍需批准**：fixture 第一轮 `vault_delete A` 经一次性批准执行，下一轮失败；重试返回 `vault_delete B`。断言批准前 B 仍在、A 已删；批准卡再次出现（不复用 A 的一次性批准）；批准后 B 恰好删除一次；工具记录与 `llm_request` 无重复执行 | `harness_runtime.rs`（fixture 序列） |
| R15 | **真实解析层流失败（双方言）**：Responses 合成字节流分别造 deltas 后 ReadError（`io::Error`）、无哨兵断开（reader panic）、deltas 后 EOF 无 `response.completed/incomplete/failed`、`response.failed(server_error)`、`response.failed(invalid_request_error)`；Chat 分别造 deltas 后 ReadError、无哨兵断开、deltas 后 EOF 无 `[DONE]`/usage、流内 `error(server_error)`、流内 `error(invalid_request_error)`。断言归一类别、正文保留、可重试性正确；正常 `[DONE]` / 终态仍正常收尾 | `llm.rs` 解析层单测（合成 `BufRead`，含会返回 `io::Error` / panic 的 reader） |
| R16 | **vision 前置闸**：含图失败后切到未声明 vision 的模型 → `harness_image_unsupported`、`failed` 保留、provider 请求数 0；切回 vision 模型后可重试成功 | `harness.rs` / `harness_runtime.rs` |
| R17 | `FailedTurn` 只保留 `turn` / `input_len` / `user_text`；无 `code` / `http_status` / `round` / `tools_executed` 字段（无消费者的字段不复活） | `session.rs` 单测 / 编译面 |

### 11.2 前端（`tests/visual/scenes/**` 结构断言 + 可提取的 `tests/unit` 纯逻辑）

| # | 断言 |
|---|---|
| F1 | error 事件带 `retry` → 错误行出现可点动作；不带 → 无动作 |
| F2 | 点击 → 恰好一次 `harnessRetry(turn)`，按钮立即禁用，相位 running |
| F3 | 同一错误文案再次到达 → 错误行仍只有一条，动作绑定**最新** turn |
| F4 | `resetView` / `vaultChanged` / `local_finish` → 动作清除；`enter` 快照带 `retry` → 恰好一条尾部行；`content` 快照清面重放后同样恰好一条（不是零条、不是两条） |
| F5 | 重试被拒：busy → 相位由 `in_flight` 快照保持 running、不关 `turnOpen`；stale / no_failed / thread_failed / image_unsupported → 同样不本地强制 idle，轻量快照就地更新相位 + 动作且不清拒绝错误行 |
| F6 | 文案表 zh / en 切换后动作文案重绘；`aria-label` / `title` 同步 |
| F7 | 半截正文标「未完成」；重试成功追加第二条 assistant，不替换旧条 |
| F8 | 新轮次开始（发送 / 重试 / 自动回合）清掉旧动作；非 idle 相位点击 no-op |
| F9 | 第一次重试仍流式时第二次 retry 得 busy：相位保持 running、`turnOpen` 不关，后续 `text_chunk` 仍上屏，`done` 正常收口 |
| F10 | 中途接管（`midTakeover`）后 error 触发 content 快照：清面重放后恰好一条动作，点击只发一次请求 |
| F11 | 线程启动失败（`harness_thread_failed`）后轻量快照 `retry` 仍在：动作就地更新且可再点，拒绝错误行不被清掉 |
| F12 | 含图失败切非 vision 模型点重试：`harness_image_unsupported` 错误行、动作仍在、无 provider 请求 |

落点：F1–F12 是 DOM / 快照 / 相位行为，主落 `tests/visual/scenes/harness-turn-retry-nov23.spec.ts`
（chromium 结构断言，与 `harness-send-reject-nov22.spec.ts` 同层）；若把「事件 → 动作模型」或
「turn 选择 / 去重」抽成纯函数，纯函数部分落 `tests/unit`，但 **MUST NOT** 把 DOM 行为塞进
unit 层（`tests/unit/README.md` 的层界）。真机 WKWebView 行为归 A1–A11。

### 11.3 真机验收（`scripts/acceptance`，mock provider）

| # | 场景 |
|---|---|
| A1 | fixture `[error(harness_network_failed), text("RETRY-OK")]`：发送 → 错误行 + 重试动作 → 点击 → `RETRY-OK` 上屏；用户气泡只有一条 |
| A2 | fixture `[text, tool_call(vault_create), error(kind=stream_reported_transient), text]`：工具行只出现一次；重试后回答完整；目标文件内容 / mtime 不变（未重复写） |
| A3 | 连点重试（无工具 fixture）：第二次不产生额外请求（断言 JSONL 的 `llm_request` 计数） |
| A4 | 失败后切 vault B 再切回 A：重试动作仍在、点击可用（快照字段） |
| A5 | 失败后点「新会话」：重试动作消失；无 `failed` 状态 |
| A6 | 不可重试失败（fixture 给 HTTP `400`，`http_status:400`）：不出现重试动作 |
| A7 | HTTP 429 / 500（fixture 新增 `http_status`）：出现重试动作；点击成功 |
| A8 | 空响应（fixture `{}`）：出现重试动作；点击成功 |
| A9 | 半截正文 + 流中断（fixture 先流出 `chunks` 再给 `error`，`kind=stream_reported_transient`）：旧回答标「未完成」；点击重试成功 → 第二条 assistant 回答上屏 |
| A10 | 重试后的新写工具需批准：失败前一次性批准 `vault_delete A`，失败后重试返回 `vault_delete B`；断言批准前 B 仍在、批准卡再次出现、批准后 B 恰好删除一次 |
| A11 | 含图失败切非 vision 模型：点重试被 `harness_image_unsupported` 拒绝、零 provider 请求、动作仍在；切回 vision 模型后可重试成功 |

证据落 `.local/acceptance/`；新场景与 `COVERAGE.md` 随实现同 PR 更新。

### 11.4 mock 测试能力缺口（必须补，不得跳过）

现状 fixture 的 `error` 只有 `code` / `message`（`llm.rs:2087-2091`），且 error 条目在
`MockClient::complete` 里先于分片返回（`:2364-2369`）——因此当前 mock **无法表达**三类真实失败：

| 失败形态 | 现状 | 本 change 的补法 |
|---|---|---|
| HTTP `429` / `5xx` / `4xx` 的分类 | `FixtureError` 无 HTTP 状态位 | 增加可选 `http_status`，映射进 `TurnError` / `HttpNon2xx` |
| 归一后的流失败类别（transient / permanent / transport / missing terminal） | `FixtureError` 只有 provider 风格 code | 增加可选 `kind`（稳定内部类别）；显式 `kind` 优先，缺省才按 `http_status` / 既有 mock 简写映射（测试专用，MUST NOT 作为真实解析层证据） |
| 已流出半截正文后再失败 | error 条目直接返回，无法先给分片 | error 条目允许同时带 `chunks` / `text`：先按序流出，再以该 error 收尾（`TurnOutput` 同时带半截正文与 error） |

三类补法都只扩测试面，不改真 provider 路径；不带新键的既有 fixture 行为逐字节不变。
「mock 表达不了」不构成跳过 R9 / A9 的理由。

**但 mock 显式错误仍不覆盖真实传输边界**：R15 MUST 直接用合成字节流喂
`parse_sse_reader` / `parse_chat_sse_reader`，造出读错误、无终态 EOF、transient / permanent
两类 `response.failed` / 流内 `error`；mock 只用于产品流程（R4–R14、A1–A11）。若只测 mock 的
显式 `error`，评审指出的「读错误 / 通道断开静默 break」「`server_error` 落入不可重试」两个
缺口都不会被判红。

### 11.5 视觉

- 结构断言：重试动作在场 / 可访问名（`title` / `aria-label`）；「未完成」标记的 class / 文案。
- 空闲态零像素漂移：错误行与动作只在失败时出现，既有整页基线不应变。
- 动过 `src/style.css` / `src/harness-panel.css` / `tests/visual/scenes/**` 时本地跑
  `bash scripts/gate.sh visual`；基线更新仍须 Alex 过目。

## 12. 改动面（实现期文件级）

| 文件 | 改动 |
|---|---|
| `src-tauri/src/harness/llm.rs` | `pump_sse` 返回可区分结束原因（Terminal / Aborted / Eof / ReadError）；Responses 用事件名置 `terminal_seen`；Chat 用 `[DONE]` / usage 置位；EOF 无终态 → `StreamMissingTerminal`；读错误 → `StreamTransport`；`response.failed` / 流内 `error` 归一 transient / permanent；`TurnError` 增加 `kind`；失败分类器 + 双方言解析层单测；fixture 增加 `http_status`、可选 `kind`、error+chunks |
| `src-tauri/src/harness/session.rs` | `turn_seq` / `FailedTurn`（仅 `turn` / `input_len` / `user_text`）；`begin_turn` 推进世代并清空；`snapshot` / `empty` 的 `retry` 读出口 |
| `src-tauri/src/harness/turn.rs` | `TurnInput::Resume`；轮次来源 / `allow_retry`；错误分支登记失败；空响应判定前移；半截正文「未完成」标记；error 事件带 `retry` |
| `src-tauri/src/harness.rs` | `begin_retry`（原子守卫 + 取票 + `begin_turn`）/ `restore_failed` / `harness_retry` 命令；**失败 input 的 vision 前置检查（复用 `image_gate_error` 同一判据）在消费 failed 之前**；`run_turn` 拆出「已 acquire」入口（或 `TurnStart` 枚举），重试路径 MUST NOT 二次 `acquire_turn`；恢复折叠判 `error` |
| `src-tauri/src/lib.rs` | 注册 `harness_retry` |
| `src/ipc.ts` | `harnessRetry(turn)`；`HarnessEvent` 的 error 可选 `retry`；`harness_state` 的 `retry` 读出口注释 |
| `src/harness-panel.ts` | 错误行动作、点击生命周期、busy 拒绝走 `in_flight`、两档快照幂等重建、世代守卫、半截正文标记 |
| `src/copy-data.ts` | zh / en 文案条目（含稳定流失败码；编号走文案漂移门禁） |
| `src/harness-panel.css` 或 `src/style.css` | 动作按钮 / 未完成标记样式（若需要） |
| `scripts/acceptance/fixtures/**` | 网络失败 / HTTP 429 与 500 / 流中断（含半截正文）/ 空响应 / 先工具后失败 / 不可重试 / 新写工具批准 / 含图 + 非 vision 八组 fixture |
| `scripts/acceptance/scenarios/**` | A1–A11 场景；更新 `COVERAGE.md` |
| `tests/visual/scenes/**` | F1–F12 结构断言 / 未完成标记 / 空闲零漂移（若动样式） |
| `src-tauri/tests/session_recording.rs` | R4 / R4b / R5 / R10 / R13 集成测试 |
| `src-tauri/tests/harness_runtime.rs` | R14 / R16（新写工具批准、vision 前置闸） |

## 13. 风险与边界

- **计费**：每次重试都会把整段会话前缀再发一次；provider 侧缓存可能降低实际成本；Lumir 不做
  计费对账 / 补偿，也不推测失败请求是否计费。
- **provider 切换**：重试按当前 provider / model / 思考档位发出；请求记录里的 provider / model
  会是新值。P1 只保证 `input` / `messages` / 原始 parts 不变，不保证完整请求逐字节相同。
- **空响应判定前移**：这是本 change 的支撑改动，会改变「失败空响应的 reasoning 是否进入下一轮
  历史」；属于有意收紧，需在 review 时明确核对，不得被当作无关重构。
- **后台子运行**：父轮失败后仍在跑的子运行不被重试影响；它们的结果在之后的回合以通知并入。
- **错误行去重**：重试动作挂在错误行上，但错误行本身仍是 live 面；快照恢复的是尾部动作行，
  不是错误行。两者 MUST NOT 混为一条记录。
- **线程起不来**：`harness_retry` 放回 `failed`、回滚 `turn_seq` 后返回 `harness_thread_failed`；
  用户可再点，不自动重试。
- **语义影响（节点 1 已声明）**：无终态 EOF / 读错误从「静默正常收尾」变为「可见错误 + 半截
  正文未完成」；transient 类还带重试动作。这是本 change 的核心行为变更之一。
- **解析层归一的风险**：未知 `response.failed` / 流内 `error` 默认 transient，按钮可能再失败
  一次（一次请求的成本）；已知鉴权 / 权限 / 非法请求 / 内容策略 / 额度耗尽归 permanent，不提供
  按钮。provider 原始 code 只作诊断，MUST NOT 参与分类。
- **只发 `[DONE]` 的 Responses 兼容端点**：会被判 `StreamMissingTerminal`（可见错误）。这是
  有意的保守选择；若实际 provider 如此，必须按预设显式豁免 + 官方文档 + 真实解析层测试，
  MUST NOT 用社区 issue 默认放行。
- **vision 前置闸**：切到未声明 vision 的模型时重试被拒、failed 保留、零请求；这是既有发送闸
  的复用，不新增能力矩阵。
- **busy / 快照**：重试同步拒绝不本地收口；`enter` / `content` 两档都重建恰好一条动作，避免
  中途接管清面、线程启动失败后入口消失。
- **失败字段**：`FailedTurn` 只保留 `turn` / `input_len` / `user_text`；`code` / `http_status` /
  `round` / `tools_executed` 已删除（无消费者）。
- **重试轮在发出请求前遇到配置级失败**（如 provider 刚被删 / Key 刚被清）：旧失败状态已被消费，
  本设计不自动恢复（与「配置级失败不提供重试」一致）；用户修好配置后重新发送。若 Alex 认为应
  保留旧动作，需要额外的「本次未发出请求」信号与恢复路径，成本另计。
- **D5 的范围**：只跳过带 `error` 的末尾响应；不改成功响应的折叠、不改请求锚点判定、不改读数
  重算、不改子运行分桶重算。
- **非目标复核**：不新增依赖、不改配置 schema、不改源文件格式、不触碰性能合同。

## 14. 节点 1 裁决点映射（2026-11-23 全部按推荐值批准）

| 裁决点 | 裁决结果 | 本设计的落点 | 另一选项的影响（未采纳，保留备查） |
|---|---|---|---|
| D1 只重发失败往返 | 按推荐值 | §2 / §5 / §8 | 整轮重放需重写状态机与工具语义，本设计不作废重来 |
| D2 半截正文保留并标「未完成」 | 按推荐值 | §9.2 | 替换正文需删 live DOM 内容，且与「不回滚」纪律冲突；不标注则无法区分 |
| D3 可重试集合 | 按推荐值 | §3.3 | 加入 4xx 只需改分类器真值表与文案，不动状态机；permanent 流错误要改归一表 |
| D4 存活范围 | 按推荐值 | §6 | 跨重启需新增留存派生与恢复态错误行，成本翻倍 |
| D5 并入恢复折叠修复 | 按推荐值（并入） | §7 | 删除第二条 ADDED requirement 与 R13 / 相关 tasks，另立 change |
