## ADDED Requirements

### Requirement: 失败轮次显式重试

交互式用户轮次因**可重试的 provider 往返失败**而终态收尾后，系统 SHALL 在错误行上提供显式的
「重试」动作；重试 SHALL 在同一个会话、同一个逻辑轮次里重新发出**失败的那一次 provider
往返**。重试动作本身 MUST NOT 新建会话 / JSONL 文件 / 用户消息 / 对外可见的轮次 id
（既有自动压缩 / 恢复等会话轮换不受本条约束），MUST NOT 自动重试、退避或排队。

**可重试性 SHALL 由后端唯一分类产出**（error 事件与 `harness_state` 快照同源），前端 MUST NOT
维护第二份可重试性清单或按文案猜测（`errorText` 的文案映射不属可重试性判定）。分类 MUST 读
**稳定内部失败类别**，MUST NOT 直接读 provider 原始 `code`——原始 code / message 只作诊断与
文案素材。

可重试集合：网络层发送失败；HTTP `408` / `425` / `429` / 任意 `5xx`；**归一后的 transient 流失败**
（传输层读错误、通道意外断开、协议终态未达而 EOF、流内 `error` / `response.failed` 归一为
transient 的类别）；空响应（无正文也无工具调用）。不可重试集合：配置级失败（provider / api_key /
base_url / model 缺失）、HTTP 4xx 请求与鉴权错误（`400` / `401` / `403` / `404` / `409` / `422`；
`408` / `425` / `429` 之外的其余 4xx 一律不可重试）、**归一为 permanent 的流错误**（鉴权 / 权限 /
非法请求 / 内容策略 / 额度耗尽）、附件类错误、上下文超限终态与压缩失败、内部错误 / 线程失败 /
无会话 / 忙、用户停止、工具循环上限、mock 脚本耗尽。分类结果 SHALL 随 error 事件与快照下发
（缺键 = 不提供重试）；HTTP 错误 SHALL 按状态码分类，MUST NOT 按 provider 错误体里的 `code`
字面量推断。上下文超限终态与压缩失败 SHALL 优先判否——即使 HTTP 状态码落在可重试集合，只要
该轮被判为超限终态或压缩失败，就不提供重试。`harness_retry` 命令自身的同步拒绝（忙 / 过期 /
线程起不来 / vision 闸拒绝）不属于轮次失败分类；线程起不来时失败状态 SHALL 放回、动作保留，
用户可再点（这不是自动重试）。

**流失败的归一边界**：Responses 方言 SHALL 以 `response.completed` / `response.incomplete` /
`response.failed` 为协议终态；Chat 方言 SHALL 以 `[DONE]`（或请求了
`stream_options.include_usage` 时的 usage 末帧——其后只会是 `[DONE]`，不丢内容）为协议终态。
终态未达而 EOF SHALL 归为 stream failure，MUST NOT 当正常完成。读错误与通道意外断开同样 SHALL
归为 stream failure，MUST NOT 静默按已收内容收尾。`response.failed` 与流内 `error` SHALL 在解析边界归一为 transient /
permanent 两类稳定类别（已知鉴权 / 权限 / 非法请求 / 内容策略 / 额度耗尽为 permanent；其余含
`server_error` 与未知类别按 transient），MUST NOT 把 provider 原始 code 直接交给可重试性判定。上述归一 SHALL
有 Responses 与 Chat 两方言的真实解析层反例（合成字节流）；mock 的显式错误不构成充分证据。
若未来某方言有官方协议证据允许无终态正常 EOF，必须在该 provider 预设显式声明并补真实解析层
测试，MUST NOT 默认放行。

**重试请求 SHALL 复用会话当前的 `input` 原始项**（含原始 text parts 与 image part 引用）：
系统 MUST NOT 从显示面的 `<quote>` XML / 卡片重建消息，MUST NOT 重新入队用户消息或面板消息，
MUST NOT 重新拼装上下文节，MUST NOT 重新装配系统提示。对失败点位于响应项入 `input` 之前的
全部可重试错误，重试请求的 `messages` 数组（含原始 parts）SHALL 与失败请求的 `messages`
逐字节相同；用户消息条数 MUST 不变。切换 provider / model / 思考档位后重试是允许的修复路径，
此时期望的只是 `input` / `messages` / 原始 parts 不变，MUST NOT 要求完整 HTTP 请求
（模型名、参数、工具定义、wire 方言）逐字节相同。

**重试前 SHALL 重新执行 vision 闸**：系统 SHALL 基于失败轮 `input` 中的图片 parts，按**当前**
provider / model 重新执行与发送路径同一份 vision 能力判据（`config.vision_supported` 的同一
实现与同一错误码，MUST NOT 另立第二套判定）。当前模型不支持而失败 `input` 含图时，重试 SHALL
被拒绝为 `harness_image_unsupported`、失败状态 SHALL 保留、provider 请求数 MUST 为 0。该
preflight SHALL 在消费失败状态之前完成（或失败时完整回滚），MUST NOT 出现「先消费 failed 再
拒绝」导致动作丢失。

**重试 MUST NOT 重放已执行的工具调用**：失败点位于工具执行之前，失败的那次往返不可能已执行
工具；此前轮次已完成的工具调用项与输出项留在 `input` 里，重试 MUST NOT 重新执行它们。该保证
MUST NOT 被扩大解释为「后续模型不会发起任何新的写操作」——重试成功后模型新发起的工具调用 SHALL
照常经既有权限规则、权限模式与批准闸判定，与任何普通回合相同，MUST NOT 因「这是重试」跳过
任何闸。

**重试动作 SHALL 一次点击最多重新发出一次失败的那次 provider 往返**：后端 SHALL 在锁内消费
失败状态，连点 / 并发重试的第二次 SHALL 被拒绝（忙或无失败轮次）；前端点击后 SHALL 立即禁用
动作并进入处理中相位，MUST NOT 显示两个在途轮次。重试成功后模型若发起工具调用，其后的往返
按正常回合继续，MUST NOT 被理解为「整次点击只允许一个 HTTP 请求」。

**同步拒绝 SHALL NOT 本地强制 idle**：busy / stale / no_failed / thread_failed / image_unsupported
等重试同步拒绝 MUST NOT 调用本地收口、强制 idle 或关闭轮次闸门；相位 SHALL 由 `harness_state`
的 `in_flight` 权威收口。busy 尤甚：第一次重试仍在流式输出时第二次重试得 `harness_busy`，第二次
MUST NOT 影响第一次的后续分片、工具行或终态——第一轮的文本分片 MUST 继续上屏，终态 MUST 正常
收口。拒绝的人话错误行 SHALL 照常上屏，但 MUST NOT 以本地相位记忆覆盖 `in_flight`。动作 SHALL
由同一份快照的 `retry` **就地幂等更新**：`retry` 缺席移除动作，在场保留 / 重建；MUST NOT 为
此重放 transcript 或清掉刚追加的拒绝错误行。

**世代守卫**：每次开始新轮次（发送、重试、自动回合、cron 运行）SHALL 推进会话的轮次世代；
失败状态 SHALL 记录其世代。重试 SHALL 只在「同一会话对象、当前世代、同一失败记录、且会话
空闲」时被接受；失败后用户又发了新消息、开了新会话、从历史恢复了会话，旧的重试动作 SHALL
失效并返回明确的过期 / 无失败错误，MUST NOT 作用于新的轮次或新的会话。**关闭 vault** 会丢弃
该 vault 的会话（失败状态随之消失）；**切换 vault** MUST NOT 让旧视图的动作作用于新 vault 的
会话，但该 vault 的失败状态 SHALL 保留，切回时按快照重建动作。跨 vault 的重试请求 MUST NOT
落到非当前 vault 的会话；前端视图世代换代后到达的旧拒绝回包 MUST NOT 改写新视图。

**存活范围**：重试动作 SHALL 跨 webview 重载与切 vault 回来存活（由 `harness_state` 快照携带
可重试轮次标识，缺键 = 不提供）；MUST NOT 跨 app 重启或跨历史会话恢复存活——失败事实是内存态，
重启 / 恢复后的视图不重建重试动作。错误行本身仍是 live 面；快照重建的是尾部的重试动作行
（通用文案，不复制原错误行），MUST NOT 被当作 transcript 错误行的持久化。**`enter` 与 `content`
两档快照 SHALL 在消息重放后按 `retry` 幂等保证恰好一条尾部动作（`retry` 缺席时为 0 条）**：
`content` 档清面后 MUST 重建动作（不得因「不新增」而丢掉入口），动作已在场时 MUST NOT 追加
第二条。

**失败轮的半截正文**：失败前已流式上屏的半截正文 SHALL 保留在 transcript 并标注「未完成」
（与「已停止」同型的 live 面标记），MUST NOT 被当作完整回答；重试成功后新的回答 SHALL 另起
一条 assistant 消息，MUST NOT 替换 / 删除旧的那条。该半截正文是 live 面：webview 重载 /
切 vault 回来不重建（其事实留在 JSONL 的 `llm_response`）；历史恢复路径的折叠行为不在本条内。

**重试成功的一轮 SHALL 按一次正常完成的轮次收尾**（含会话自动命名的触发判定）；重试轮 SHALL
按一次新的内部轮次获得完整的 `loop_max` 预算（不继承失败轮已用轮数，`overflow_retried` 同样从零起），
这 MUST NOT 改变 `loop_max` 的既有语义。重试 MUST NOT
把排队中的后台完成通知并入本次请求（它们按既有口径在之后的下一次用户发言前并入）。重试 MUST
NOT 改变上下文超限的既有「自动压缩 + 重试该轮一次」口径、
MUST NOT 改变错误行同文案去重、MUST NOT 改变 `in_flight` 相位模型。

#### Scenario: 网络失败后重试成功

- **WHEN** 一条已受理的用户消息在未触发自动压缩的会话里因网络层发送失败
  （`harness_network_failed`）终态收尾，用户点击错误行上的重试动作，随后一次响应成功
- **THEN** transcript 仍只有一条该用户消息；新回答正常上屏；同一 JSONL 文件只新增一对
  `llm_request` / `llm_response`；重试动作本身不新建会话、不新建 JSONL 文件、不写
  `session_open`

#### Scenario: 瞬时 HTTP 错误给重试，请求类 4xx 不给

- **WHEN** 同一会话先后遭遇 HTTP `503`、`429`、`400`、`401` 四类失败
- **THEN** `503` / `429` 的错误行出现重试动作；`400` / `401` 的错误行不出现重试动作；
  两种判定都来自后端分类结果，前端不按 `code` 或文案自行推断

#### Scenario: Responses 无终态 EOF 与读错误归为流失败

- **WHEN** Responses 方言的真实解析层收到文本分片后，分别出现（a）读循环 I/O 错误 / channel
  意外断开，（b）EOF 但未收到 `response.completed` / `response.incomplete` / `response.failed`
- **THEN** 两种情况都产出稳定的 stream failure 类别（不是正常完成），已收到的正文保留；
  该类别的可重试性由后端分类给出，重试请求与失败请求的 `messages` 相同

#### Scenario: Chat 无终态 EOF 与读错误归为流失败

- **WHEN** Chat 方言的真实解析层收到文本分片后，分别出现（a）读循环 I/O 错误 / channel
  意外断开，（b）EOF 但未收到 `[DONE]`（也未收到 usage 末帧）
- **THEN** 两种情况都产出稳定的 stream failure 类别（不是正常完成），已收到的正文保留；
  正常收到 `[DONE]` 或 usage 末帧的流仍按正常完成收尾

#### Scenario: response.failed 与流内 error 的 transient / permanent 归一

- **WHEN** 真实解析层分别收到 `response.failed` / 流内 `error`，其 provider 错误为
  `server_error`（transient）与 `invalid_request_error`（permanent）
- **THEN** transient 类出现重试动作；permanent 类不出现重试动作；判定读归一后的内部类别，
  MUST NOT 直接依据 provider 原始 `code`；原始 code / message 仍随错误行 / 留存可查

#### Scenario: 失败发生在工具轮之后不重放工具

- **WHEN** 第一轮工具调用成功执行（如 `vault_create` 写入一份文件），第二轮 provider 往返失败，
  用户点击重试并成功
- **THEN** 目标文件仍只有一份；transcript 里该工具行只出现一次；重试请求包含第一轮已完成的
  调用项与输出项且顺序不变；JSONL 只多一对记录

#### Scenario: 重试后的新写工具仍需批准

- **WHEN** 失败轮之前已批准并执行过一次写工具（一次性批准、未选「本会话不再问」），随后该轮
  失败；用户重试成功，模型发起一个**新的**、当前权限模式下需要批准的写工具调用
- **THEN** 批准前该调用 MUST NOT 产生任何副作用（目标文件 / 目录未被修改）；批准卡 SHALL 照常
  出现（MUST NOT 复用失败前的一次性批准决定）；批准后该调用 SHALL 恰好执行一次；transcript 的
  工具行与 JSONL 记录不得出现重复执行

#### Scenario: 连点与并发重试只重发一次失败往返

- **WHEN** 用户连点两次重试，或两个重试请求并发到达（重试轮内没有工具调用）
- **THEN** 失败的那次往返只被重新发出一次（JSONL 的 `llm_request` 只 +1 对）；第二次返回忙或
  无失败轮次；前端只呈现一个在途轮次，第二个动作在第一次点击后即被禁用

#### Scenario: 第一次重试仍流式时第二次 busy

- **WHEN** 第一次重试已被接受、正在流式输出；用户在结束前再次触发重试，第二次得到
  `harness_busy`
- **THEN** 第二次 MUST NOT 本地强制 idle、MUST NOT 关闭轮次闸门；相位由 `in_flight` 快照保持
  running；第一次重试的后续文本分片、工具行与终态 SHALL 继续正常上屏，不产生额外 provider 请求

#### Scenario: 失败后发新消息使旧动作过期

- **WHEN** 一次可重试失败后，用户没有重试而是发送了一条新消息（或开了新会话 / 从历史恢复了
  会话），随后再点击旧的重试动作
- **THEN** 重试被拒绝为过期或无失败轮次；新消息 / 新会话 / 恢复的会话不受影响，不产生额外
  provider 请求，也不把旧失败状态的任何项并入新轮次

#### Scenario: 跨 webview 重载与切 vault 回来仍可重试

- **WHEN** 一次可重试失败后 webview 重载，或切到 vault B 再切回 vault A
- **THEN** 回到该 vault 时 transcript 尾部按快照重建重试动作行且可点击；其他 vault 的失败
  不出现在当前 vault；重载前已上屏的半截正文不重建（仍是 live 面）

#### Scenario: 中途接管后的 content 快照仍有一条动作

- **WHEN** 一个中途接管的轮次以可重试错误收尾，error 分支发起 `content` 快照；快照返回时
  transcript 被清面并按 messages 重放
- **THEN** 重放完成后按快照 `retry` 恰好重建一条尾部重试动作（不是零条、也不是两条）；
  动作可点击，点击只发出一次重试请求

#### Scenario: 线程启动失败后的动作仍在

- **WHEN** 用户点击重试，后端因线程启动失败返回 `harness_thread_failed`（失败状态已放回）
- **THEN** 错误行照常上屏；轻量快照重新拉取后尾部动作仍在且可再次点击；MUST NOT 因这次拒绝
  丢失重试入口，也 MUST NOT 清掉拒绝错误行

#### Scenario: 不跨重启与历史恢复

- **WHEN** 一次可重试失败后重启 app，或从会话浮层恢复该历史会话
- **THEN** 恢复后的视图不出现重试动作，也不能对旧失败轮发起重试；用户可发送新消息继续对话

#### Scenario: 半截正文标「未完成」且重试回答并列

- **WHEN** 流式已产出部分正文后 provider 失败，用户重试并成功
- **THEN** 旧半截正文保留在 transcript 并标注「未完成」；重试成功的回答是第二条 assistant
  消息、不替换旧内容；消息快照不重建那条半截正文

#### Scenario: 切换 provider / 模型 / 思考档位 / wire 后重试

- **WHEN** 一次可重试失败后，用户切换 provider、模型、思考档位或 wire 方言，再点击重试
- **THEN** 重试按新配置发出；重试请求的 `messages` / `input` / 原始 parts 与失败请求逐字节
  相同；完整 HTTP 请求（模型名、参数、工具定义、wire 方言）可以不同；该轮 `llm_request`
  记录里的 provider / 模型 / `params.thinking` 为新值；wire 方言按当前配置发送，
  `session_open` 的方言键不因重试改写

#### Scenario: 含图失败切非 vision 模型被拒

- **WHEN** 一次含图片 parts 的失败后，用户把 provider / model 切到未声明 `vision` 的模型，
  再点击重试
- **THEN** 重试被拒绝为 `harness_image_unsupported`；provider 请求数为 0；失败状态 SHALL 保留，
  重试动作仍在；切回支持 vision 的模型后可再次重试

#### Scenario: 空响应可重试且请求保持一致

- **WHEN** provider 返回一次空响应（无正文、无工具调用），用户点击重试并成功
- **THEN** 错误行出现重试动作；重试请求的 `messages` 与失败请求相同（空响应的 reasoning
  回放项不进入 `input`）；重试成功后正常回答上屏

#### Scenario: 非交互轮次不产生重试

- **WHEN** cron 运行、子运行或自动唤醒回合以可重试类错误失败
- **THEN** 该会话不产生可重试状态，面板不出现重试动作；cron 失败仍按运行契约回执，
  自动回合按既有终态口径收口

### Requirement: 恢复历史会话不折叠失败响应

从历史会话恢复续聊时，既有「折叠锚点请求之后未入请求的末尾响应」的口径 SHALL 以该响应
**不带 `error`** 为前提：若配对的那条 `llm_response` 带 `error`，系统 MUST NOT 把它的正文 /
思考回放项 / 工具调用折进恢复后的 `input` 或面板记录；恢复结果 SHALL 停在失败前已完成的
最后一项。失败轮已流出的半截正文是 live 面，MUST NOT 在恢复后以完整回答的形态重建。

该约束只作用于恢复时的折叠判定，对既有 JSONL 文件的读取是只读的：MUST NOT 迁移、回写或
删除任何记录；成功响应的折叠行为逐字节不变。

#### Scenario: 失败响应的半截正文不折叠

- **WHEN** 源会话的最后一条 `llm_request` 之后配对一条带 `error` 的 `llm_response`，且该响应
  含半截正文与思考文本
- **THEN** 恢复后的 `input` 不含该响应的正文 / 思考回放项 / 工具调用；面板不出现该半截正文；
  恢复结果停在失败前已完成的最后一项，用户可继续对话

#### Scenario: 失败响应无正文同样不折叠

- **WHEN** 源会话的末尾 `llm_response` 带 `error` 且没有任何正文或工具调用
- **THEN** 恢复后的 `input` 与面板都不新增项；不出现只有角色 meta 行的空 assistant 消息

#### Scenario: 成功响应的折叠逐字节不变

- **WHEN** 源会话的末尾 `llm_response` 不带 `error`（正常完成的末轮回答）
- **THEN** 恢复时仍按既有口径折叠其正文 / 思考 / 工具调用；恢复结果与改动前逐字节相同

#### Scenario: 旧文件只读

- **WHEN** 恢复一份包含失败响应的既有会话文件
- **THEN** 该文件不被迁移、回写或删除任何记录；文件的字节与 mtime 不变；恢复只影响新会话
  内存态与新 JSONL 文件
