# Tasks: add-harness-turn-retry-nov23

> `openspec/specs/**` 活跃期只读；所有规格变更只写本 change 的 delta。
> 节点 1 已通过（2026-11-23，Alex 原话「三项推荐。」）：D1–D5 全部按推荐值生效，可进入实现。
> 实现期发现 proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。
> 断言本体以 `design.md` §11 为唯一真源；本文件的测试项只列落地批次与完成判据，不复制断言全文。

## 0. 提案与节点 1 —— 已完成（2026-11-23）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/harness/spec.md` / 本文件
- [x] 0.2 proposal 头部保留节点状态块：方向准入 + 节点 1 结论（原话与日期）；不再保留
      「待批」口径
- [x] 0.3 节点 1 送裁 D1–D5（每项带推荐值与另一选项的代价）：2026-11-23 Alex 原话
      「三项推荐。」= D1–D5 全部按推荐值批准，已回填 proposal / design
- [x] 0.4 D5 已裁「并入」⇒ 本项不适用：保留「恢复历史会话不折叠失败响应」requirement、
      本文件 §7 与 R13，不另立 change
- [x] 0.5 D3 按推荐值（不把 4xx / permanent 流错误纳入）⇒ 本项不适用：设计 §3.3 真值表与
      R1 / A6 期望按推荐值保留，不动状态机

## 1. 先红（测试先行，红必须是行为红）

- [x] 1.1 Rust 侧：先写 R1–R17（断言以 design §11.1 为准），含 R15 双方言真实解析层反例
      （合成字节流 + 会返回 `io::Error` 的 reader）。新 API 尚无签名时先落最小签名，红必须红在
      断言上（行为不符），MUST NOT 把编译错当先红证据
- [x] 1.2 前端侧：先写 F1–F12（design §11.2）。DOM / 快照 / 相位断言落
      `tests/visual/scenes/harness-turn-retry-nov23.spec.ts`；可提取的纯函数（事件 → 动作模型 /
      turn 选择）落 `tests/unit`。MUST NOT 把 DOM 行为塞进 unit 层；RED 判据是「动作不在场 /
      点击无调用 / 快照不重建 / busy 误收口」，不是场景语法错
- [ ] 1.3 真机侧：先写 A1–A11 场景（design §11.3）并在未实现的当前树上跑一遍 RED——
      **放弃原因（节点 2 对账，2026-11-23）**：本 change 是从零实现的新能力，A 组 RED 要求一套已存在的
      命令 / 动作才能观察到「动作不在场 / 点击无请求」；本批实际执行顺序是「实现完成 → 真机首跑
      （4/11）」，**未在未实现树上执行 A 组 RED，不伪装为先红**。可替代的先红证据：R 组 16 条新用例
      中 14 条在「保留新签名、行为退回改动前」的补丁下行为判红（
      `.local/reviews/harness-proposals/retry-red-rust.log`）；F 组 10/10 在同类补丁下判红
      （`retry-red-frontend.log`）。真机侧唯一可证伪的行为红是首轮 718 的真实产品 FAIL（同拍半截
      正文未标「未完成」，现场与根因见 `.local/missions/harness-turn-retry-nov23/triage-r1.md`），
      由 `c3c3c260` 修复后复跑 PASS。按 `openspec-workflow.md` 节点 2 要件 3「未勾项就地写明放弃
      理由」处理，不删任务项。RED 判据仍为「重试动作不在场 / 点击无请求 / 新写工具未经批准即执行」，
      不是场景语法错
- [ ] 1.4 把三组 RED 证据路径写进实现报告（均落**主仓** `.local/`，不落 worktree）：
      `.local/reviews/harness-proposals/retry-red-{rust,frontend}.log` 与
      `.local/acceptance/<日期>/<场景>/RED-before-fix/`；写不出可 `ls` 的指针按「未跑」处理
      **放弃原因（节点 2 对账，2026-11-23）**：rust / frontend 两份 RED 日志已落并可 `ls`；
      **acceptance 的 `RED-before-fix/` 未生成**——原因同 1.3（无「未实现树」的真机 RED 现场），
      其替代证据是 R / F 两组行为红 + 718 的真实 FAIL→修复 PASS；718 的 before-fix 现场已被复跑
      覆盖，结论落在 `.local/missions/harness-turn-retry-nov23/triage-r1.md`。按「未跑 / 放弃」
      如实记录，不以已实现树充数。

## 2. 补 mock 的测试表达能力（不得以「mock 表达不了」跳过）

- [x] 2.1 `FixtureError` 增加可选 `http_status` 与可选 `kind`（稳定内部类别）
      （`src-tauri/src/harness/llm.rs`），映射进 `TurnError` / `HttpNon2xx`；显式 `kind` 优先；
      单测证明 fixture 能表达 `429` / `500` / `400` / transient / permanent，且分类器判定正确
- [x] 2.2 fixture 的 error 条目允许同时带 `chunks` / `text`：mock 先按序流出这些分片，再以该 error
      终态收尾（`TurnOutput` 同时带半截正文与 error）；单测证明「半截正文 + 流中断」可表达
- [x] 2.3 落一张「失败类别 × 可表达性 × 覆盖测试」对账表（放 `design.md` §11 或 fixture 模块注释）：
      网络失败 / 429 / 5xx / 4xx / 读错误 / 通道断开 / 无终态 EOF / transient 流错误 /
      permanent 流错误 / 空响应 / 半截正文后失败 / 先工具后失败 / 新写工具批准，逐类给出
      单测或验收落点；任何一类 MUST NOT 只写「mock 不可表达，跳过」
- [x] 2.4 既有 fixture 向后兼容：不带新键的 fixture 行为逐字节不变；补一条回归单测
- [x] 2.5 同步 `llm.rs` 模块头的 fixture 格式文档（`http_status`、可选 `kind`、error + `chunks` /
      `text` 的语义与弹尽口径），避免文档与实现漂移
- [x] 2.6 **真实解析层反例（R15）不属于 mock 能力**：直接喂 `parse_sse_reader` /
      `parse_chat_sse_reader` 合成字节流，覆盖读错误（`io::Error`）、无哨兵断开（reader panic）、
      无终态 EOF、`server_error` / `invalid_request_error` 两类 `response.failed` 与流内 `error`；
      mock 显式 error 只用于 R4–R14 / A1–A11 的产品流程，MUST NOT 作为流分类的唯一证据

## 3. 后端：传输归一、失败分类与状态

- [x] 3.1 真实 SSE 读循环：`pump_sse` 返回可区分结束原因（Terminal / Aborted / Eof / ReadError）；
      读线程正常 EOF 发 `Finished` 哨兵，`io::Error` 发显式 ReadError，无哨兵的断开按 ReadError；
      `sink.aborted()` 仍归 Aborted（不产错误）
- [x] 3.2 Responses 的 `terminal_seen` 由 `response.completed` / `response.incomplete` /
      `response.failed` 事件名显式置位，MUST NOT 用 usage / error 有无近似；`[DONE]` 不置位。
      Chat 的 `terminal_seen` 由 `[DONE]` / usage 末帧置位
- [x] 3.3 Eof 且无终态 → `StreamMissingTerminal`；ReadError → `StreamTransport`；两者保留已收
      正文 / 思考 / 调用，但设置 `output.error`（可见错误）
- [x] 3.4 `response.failed` / 流内 `error` 按 `type` / `code` 归一 `StreamReportedTransient` /
      `StreamReportedPermanent`（已知鉴权 / 权限 / 非法请求 / 内容策略 / 额度耗尽为 permanent；
      其余含 `server_error` / 未知为 transient）；原始 code / message 只留诊断；`TurnError` 增加
      `kind`
- [x] 3.5 实现后端唯一分类器（输入 `FailureKind` + `context_overflow`；输出可重试 / 不可重试），
      覆写 design §3.3 真值表；R1 绿
- [x] 3.6 `Session` 增加 `turn_seq` 与 `failed: Option<FailedTurn>`（仅 `turn` / `input_len` /
      `user_text`，字段见 design §4.1）；`begin_turn` 推进世代并清空 `failed`；`reset_session` /
      `resume_session` / 关闭 vault 随会话对象消失；R2 / R17 绿
- [x] 3.7 错误终态登记失败：仅交互用户轮与重试轮；记录 `turn` / `input_len` / `user_text`；
      `done` / `aborted` / 不可重试错误清空；R2 / R12 绿
- [x] 3.8 `StateSnapshot` 增加可选 `retry`（`skip_serializing_if`），`empty` 同样缺键；R7 绿
- [x] 3.9 `events::error` 增加可选 `retry`（仅可重试时在场）；既有三键不变；`llm_error` sidecar
      可加 `failure_kind` 供诊断（不参与恢复重建）；补形状单测
- [x] 3.10 空响应判定前移到响应项入 `input` / `panel` 之前；`record_usage` / `on_round_usage`
      仍照常调用，思考兜底仍先于错误收口，abort 仍优先于空响应判定；R11 绿
- [x] 3.11 半截正文「未完成」标记的 live 状态（不进 `panel` / 快照）；R9 绿
- [x] 3.12 线程失败 / 配置级失败不得被误登记为可重试轮次；`harness_retry` 起线程失败例外见 4.5
- [x] 3.13 为全部 `TurnError` / 终态构造点设置 `kind`：`NetworkSend`、`HttpNon2xx(status)`、
      `StreamTransport`、`StreamMissingTerminal`、`StreamReported*`；空响应 / 配置 / 附件 / 内部
      错误在 turn 层设置对应 kind；用构造点清单逐处核对，MUST NOT 让 `kind` 落到错误默认值

## 4. 后端：重试入口与轮次来源

- [x] 4.1 `TurnInput::Resume { user_text }`：不调 `begin_user_turn`、不入队 user / panel、
      不覆盖 `current_context`、`panel_base = panel_len()`、`rounds` / `overflow_retried` 归零；
      不并入排队通知
- [x] 4.2 轮次来源显式化（交互用户 / 重试 / cron / 子运行 / 自动回合）；只有前两者允许登记失败；
      MUST NOT 用 completion / tool_policy 间接推断
- [x] 4.3 **vision 前置闸**：抽 `image_gate_error_for_input`（或等价）复用 `image_gate_error` 的
      同一 `config.vision_supported` 判据与同一错误码；在消费 `failed` 之前检查失败 `input` 的
      image parts；不支持 → `harness_image_unsupported`、failed 保留、不 begin、零请求；
      检查与重试线程使用同一份 config 快照（不在检查后重新 load）；R3 / R16 绿
- [x] 4.4 `begin_retry` 原子守卫 + 票据：无会话 / 忙 / 无失败 / 世代过期 / `input_len` 不符的
      守卫；校验通过后在同一把锁内消费 `failed`、`begin_turn`、返回票据；R3 绿
- [x] 4.5 `harness_retry(turn)` 命令：`begin_retry` → 起 `lumir-harness-llm` 线程跑 Resume；
      **线程入口 MUST NOT 再调 `acquire_turn`**（相位已 Running，二次 acquire 必得 busy）；
      线程起不来时 failed 放回、`turn_seq` 回滚、`end_turn`、返回 `harness_thread_failed`；
      R3 / R6 绿
- [x] 4.6 把 `run_turn` 的线程体与「是否已 acquire」拆开（`TurnStart` 枚举或等价入口），
      发送 / 重试共用同一份 sink / client / catch_unwind / release / title 实现
- [x] 4.7 注册命令到 `src-tauri/src/lib.rs`；`harness_thread_failed` / `harness_turn_stale` /
      `harness_no_failed_turn` 错误码与文案就位（含稳定流失败码的 copy-data 条目）
- [x] 4.8 恢复充分性：重试轮仍在同一 JSONL 追加成对记录，不写 `session_open`；R10 绿

## 5. 前端：错误行动作与半截正文

- [x] 5.1 `src/ipc.ts` 增加 `harnessRetry(turn)`，`HarnessEvent` 的 error 增加可选 `retry`，
      `harness_state` 注释补 `retry` 读出口
- [x] 5.2 `appendError` 支持挂动作容器；同文案去重时就地替换并重绑最新 turn；不同文案照常追加；
      F1 / F3 绿
- [x] 5.3 点击生命周期：立即禁用 + `dispatchActivity({type:"sent"})` + 恰好一次 `harnessRetry`；
      开始前补 `collapseTools()` / `lastAssistantEl = null`；F2 绿
- [x] 5.4 重试成功 `done` 清动作；再失败可重试重绑新 turn；再失败不可重试动作消失；F3 绿
- [x] 5.5 半截正文「未完成」标记（文案走 copy-data，zh / en）；重试成功追加第二条 assistant；
      F7 绿
- [x] 5.6 新轮次开始（发送 / 重试 / 自动回合）清旧动作；非 idle 点击 no-op；F8 绿
- [x] 5.7 文案条目走文案漂移门禁；`aria-label` / `title` 随语言切换重绘；F6 绿
- [x] 5.8 **busy 拒绝不本地收口**：`harness_busy` 走同一份 `harness_state` 轻量快照（可新增
      `fetchRetrySnapshot`，复用 `applyEnterSnapshot`；不改变既有 `fetchActivitySnapshot` 的职责），
      MUST NOT `local_finish` / 强制 idle / 关 `turnOpen`；同一份快照同时读 `retry` 就地更新动作
      （不重放、不清拒绝错误行）；第一次重试仍流式时第二次 busy，后续分片 / 工具行 / 终态照常；
      F5 / F9 绿
- [x] 5.9 stale / no_failed / thread_failed / image_unsupported 同样不本地强制 idle；相位由
      `in_flight` 快照决定，动作由同一快照 `retry` 就地幂等更新；F5 / F11 / F12 绿
- [x] 5.10 vision 拒绝：`harness_image_unsupported` 人话错误行 + 动作仍在 + 零请求；文案用
      重试语境（切换到支持图片的模型），MUST NOT 照抄「移除图片卡片」；F12 绿

## 6. 前端：快照与世代

- [x] 6.1 `enter` 快照：消息重放后先移除既有动作行，`retry` 在场则追加恰好一条
      「上一轮未完成 · 重试」动作行；不带 → 不追加；F4 绿
- [x] 6.2 `content` 快照：清面重放后同样按 `retry` 幂等重建恰好一条（先移除再追加），
      MUST NOT 把「不重复」实现成「不新增」；F4 / F10 绿
- [x] 6.3 动作行不进 `panel`、不参与消息计数、不被当 assistant / error 消息
- [x] 6.4 `resetView` / `vaultChanged` / `local_finish` 清动作；`snapshotSeq` / `viewGeneration`
      作废旧回包；F4 / F5 绿
- [x] 6.5 重试同步拒绝（busy / stale / no_failed / thread_failed / image_unsupported）→
      错误行 + 轻量快照就地更新 `in_flight` 相位与 `retry` 动作；MUST NOT 本地强制 idle /
      重放内容 / 清掉拒绝错误行；F5 绿
- [x] 6.6 中途接管（`midTakeover`）后 error 触发 content 快照：清面重放后恰好一条动作，
      点击只发一次请求；F10 绿
- [x] 6.7 线程启动失败后 failed 已放回：快照 `retry` 在场，动作重建且可再点；F11 绿

## 7. D5：恢复历史不折叠失败响应（D5 已并入，2026-11-23）

- [x] 7.1 `resume_session` 折叠锚点响应前判 `response["error"]`；在场则正文 / 思考 / `tool_calls`
      整条不折
- [x] 7.2 面板映射不产出失败 assistant 消息；`restored_panel_messages` 的输入不再含失败项
- [x] 7.3 成功响应折叠逐字节不变；旧文件只读（字节与 mtime 不变）；R13 绿
- [x] 7.4 与 `openspec/specs/harness/spec.md` 既有「会话边界」条并读无歧义：新 requirement
      只加「以响应不带 `error` 为前提」的限定，不复制既有正文

## 8. 测试矩阵对账（R / F / A）

> 断言全文见 `design.md` §11.1–§11.3；本节只做落地对账，完成判据 = 对应测试 PASS 且证据可 `ls`。

| 组 | 项 | 落点 | 完成判据 |
|---|---|---|---|
| R | R1 分类真值表 | `llm.rs` / 分类模块单测 | `FailureKind` 全表逐行 PASS，判定不读 provider 原始 code |
| R | R2 失败状态生命周期 | `session.rs` 单测 | 登记 / 清空 / 换会话三类断言 PASS |
| R | R3 重试守卫 / vision | `harness.rs` 单测 | 五种错误码 + vision 拒绝零请求 + 线程失败放回（含 turn_seq 回滚）+ 不重复 acquire PASS |
| R | R4 请求恒等 | `session_recording.rs` | 第 1 轮与第 k 轮各一例逐字节相等 |
| R | R4b 切换配置 | `session_recording.rs` | messages 不变；新 llm_request 记录新 provider / model / thinking |
| R | R5 工具不重放 | `session_recording.rs` | 文件一份、工具行一次、记录 +1 对 |
| R | R6 一次点击只重发一次失败往返 | `harness` 单测 | 并发第二次被拒；无工具 fixture 下请求数 +1 |
| R | R7 快照在场 / 缺席 | `session.rs` 单测 | 五种状态各一断言 |
| R | R8 超限不重试 | `turn.rs` 单测 | `retry` 缺席且无二次压缩 |
| R | R9 半截正文 | `turn.rs` 单测 | 分片已转发、未进 input/panel、第二条回答、input 只含后者（DOM 标记归 F7） |
| R | R10 恢复充分性 | `session_recording.rs` | 恢复 = 一条用户 + 一条回答 |
| R | R11 空响应 | `turn.rs` 单测 | messages 相等、reasoning 不入 input、usage/on_round_usage/思考兜底/abort 优先级各一断言 |
| R | R12 非交互轮次 | `harness.rs` / `subagents.rs` 单测 | 无 failed / retry |
| R | R13 D5 折叠 | `harness.rs` + `session_recording.rs` | 失败不折、成功照折、文件只读 |
| R | R14 新写工具批准 | `harness_runtime.rs` | 批准前零副作用、批准卡再现、批准后恰好一次 |
| R | R15 双方言真实解析层 | `llm.rs` 单测 | ReadError / 无终态 EOF / transient / permanent 八例 PASS |
| R | R16 vision 前置闸 | `harness_runtime.rs` | 非 vision 拒绝零请求、failed 保留、切回可重试 |
| R | R17 失败字段收敛 | `session.rs` 单测 / 编译面 | 只有 turn / input_len / user_text |
| F | F1 事件带 / 不带动作 | `tests/visual`（纯逻辑可下放 unit） | 两条断言 PASS |
| F | F2 点击一次 + 禁用 + running | `tests/visual`（纯逻辑可下放 unit） | 调用计数 = 1 |
| F | F3 同文案替换 / 重绑 | `tests/visual`（纯逻辑可下放 unit） | 一行、最新 turn |
| F | F4 重置 / 两档快照恰好一条 | `tests/visual`（纯逻辑可下放 unit） | enter / content 各一断言，0 或 2 条即红 |
| F | F5 拒绝不强制 idle | `tests/visual`（纯逻辑可下放 unit） | busy 保持 running；stale/no_failed/thread/image 由 in_flight 收口 |
| F | F6 zh / en 重绘 | `tests/visual`（纯逻辑可下放 unit） | 文案与可访问名同步 |
| F | F7 未完成 + 第二条回答 | `tests/visual`（纯逻辑可下放 unit） | 旧条保留、新条追加 |
| F | F8 新轮次清动作 / 非 idle no-op | `tests/visual`（纯逻辑可下放 unit） | 两条断言 PASS |
| F | F9 busy while streaming | `tests/visual`（纯逻辑可下放 unit） | 后续分片上屏、done 正常、turnOpen 不关 |
| F | F10 中途接管 content 快照 | `tests/visual`（纯逻辑可下放 unit） | 清面后恰好一条动作 |
| F | F11 线程启动失败 | `tests/visual`（纯逻辑可下放 unit） | 动作重建且可再点 |
| F | F12 vision 拒绝 | `tests/visual`（纯逻辑可下放 unit） | 错误行 + 动作仍在 + 零请求 |
| A | A1 网络失败重试 | `scripts/acceptance` | 场景 PASS + 截图证据 |
| A | A2 先工具后失败 | `scripts/acceptance` | 工具行一次、文件未重写 |
| A | A3 连点 | `scripts/acceptance` | 无工具 fixture 下请求数只 +1 |
| A | A4 切 vault 回来 | `scripts/acceptance` | 动作在场可点 |
| A | A5 新会话清动作 | `scripts/acceptance` | 动作消失 |
| A | A6 不可重试无动作 | `scripts/acceptance` | 无动作 |
| A | A7 HTTP 429 / 500 | `scripts/acceptance` | 动作在场且可点 |
| A | A8 空响应 | `scripts/acceptance` | 动作在场且可点 |
| A | A9 半截正文 + 流中断 | `scripts/acceptance` | 未完成标记、重试后第二条回答 |
| A | A10 新写工具批准 | `scripts/acceptance` | 批准前零副作用、卡片再现、批准后一次 |
| A | A11 含图切非 vision | `scripts/acceptance` | 拒绝、零请求、动作仍在、切回可重试 |

## 9. 真机场景与证据

- [x] 9.1 新增 `scripts/acceptance/fixtures/harness-mock-retry-network.json`：
      `[{"error":{"code":"harness_network_failed","message":"…"}},{"text":"RETRY-OK"}]`
- [x] 9.2 新增 `harness-mock-retry-http.json`：`[{"error":{"code":"harness_http_error","http_status":500}},{"text":"RETRY-OK"}]`
      与 429 变体；不写真实 provider 文案 / key / URL
- [x] 9.3 新增 `harness-mock-retry-tools.json`：
      `[{"text":"先建","tool_calls":[vault_create]},{"error":…},{"text":"RETRY-OK"}]`；目标路径用合成
      vault 内的一次性文件名，场景注释写明「默认档 `vault_create` 自动放行」与「重试后文件内容 /
      mtime 不变」的判据；若套件无法表达写入计数，用 R5 兜底并在场景注释登记该边界
- [x] 9.4 新增 `harness-mock-retry-partial.json`：
      `[{"chunks":["PART-1","PART-2"],"error":{"code":"harness_stream_error","kind":"stream_reported_transient"}},{"text":"RETRY-OK"}]`
- [x] 9.5 新增 `harness-mock-retry-empty.json`：`[{},{"text":"RETRY-OK"}]`
- [x] 9.6 新增 `harness-mock-retry-nonretryable.json`：
      `[{"error":{"code":"harness_http_error","message":"HTTP 400","http_status":400}}]`；
      若要另测 permanent 流错误，R15 的解析层例覆盖，真机可另加一条
- [x] 9.7 新增 `harness-mock-retry-approval.json`：
      `[text+tool_call(vault_delete A), error, text+tool_call(vault_delete B), text]`；默认
      `vault_write` 档下 `vault_delete` 需批准；断言批准前零副作用、批准卡出现两次、批准后
      B 恰好删除一次
- [x] 9.8 新增 `harness-mock-retry-image-nonvision.json`：含图失败（`input` 带 image part）→
      切非 vision provider/model 后重试；断言 `harness_image_unsupported`、零请求、动作仍在
- [x] 9.9 新增场景 A1–A11（id 按套件当期最大 item 号顺延）；每条场景 front-matter 的 `tier` 与
      `item` 填准；注释写明「重试按钮存在性」「请求数」「批准前零副作用」的判据
- [x] 9.10 `node scripts/acceptance/coverage.mjs` 重生成 `COVERAGE.md`；
      `node scripts/acceptance/run.mjs --check` 绿
- [x] 9.11 真机跑 A1–A11，证据落**主仓** `.local/acceptance/2026-11-23-harness-turn-retry/`
      （截图含失败态、重试后态、批准前 / 后；JSONL 计数见 steps.md 的读数）。
      **11/11 PASS**，分三批：
      - 首轮：710 / 711 / 714 / 717 PASS（日志 `.local/missions/harness-turn-retry-nov23/acceptance-a1-a11.log`）
      - 复跑：712 / 715 / 716 / 718 / 719 / 720 PASS（`…/acceptance-rerun-seven.log`）
      - 单跑：713 PASS（`…/acceptance-713-rerun.log`）
      逐场景 PASS 断言数（`steps.md` 的 `- PASS` 行）：710=10、711=11、712=6、713=5、714=3、
      715=4、716=7、717=6、718=8、719=10、720=6。

## 10. 门禁、信息卫生与收尾

- [x] 10.1 `cargo test`（目标用例 + 全量），显式含 R15 双方言真实解析层反例；先红 / 后绿两组
      日志都在
- [x] 10.2 `pnpm test`（纯逻辑层）与 `pnpm exec tsc --noEmit`；DOM 断言（F1–F12）在 10.4 的视觉
      门禁里跑，MUST NOT 把 DOM 行为塞进 unit 层
- [x] 10.3 `bash scripts/gate.sh quick` 全绿；照抄 `GATE RESULT` 原文行与退出码
- [x] 10.4 动过 `src/style.css` / `src/harness-panel.css` / `tests/visual/scenes/**` 时本地跑
      `bash scripts/gate.sh visual`；未动视觉面则在报告里写明「不适用」
- [x] 10.5 `bash scripts/docs-check.sh` 与
      `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 全绿
- [x] 10.6 信息卫生：fixture / 场景 / 视觉基线只用合成 vault 内容；对改动面做 text 级 grep 清扫
      （真实人名、真实项目 / 目录 / 文件名、真实文档正文、真实 provider key / URL）
- [x] 10.7 文案漂移门禁：新增 zh / en 文案编号与 `src/copy-data.ts` 一致；`pnpm test` 的文案用例绿
- [x] 10.8 实现 PR 合并时在 `docs/backlog.md` 的归档跟踪队列落一条本 change 记录（一行 gist +
      五要件状态；后续归档按 `docs/process/openspec-workflow.md` 执行）
- [x] 10.9 覆盖声明对账：R1–R17（`cargo test` 全绿 + `.local/reviews/harness-proposals/
      retry-red-rust.log`）、F1–F12（10/10，`tests/visual/scenes/harness-turn-retry-nov23.spec.ts`）、
      A1–A11（11/11，场景名与 PASS 计数见 9.11）均给得出证据指针；拿不出证据的项保持「未验」
      （acceptance 的 RED-before-fix 见 1.3 / 1.4）。

## 11. 验证（change 层）

- [x] 11.1 `npx --yes @fission-ai/openspec@1.12.0 validate add-harness-turn-retry-nov23 --strict`
      与 `validate --all --strict` 通过
- [x] 11.2 `bash scripts/docs-check.sh` 通过（其中含 `openspec-archive-check.mjs` 门禁模式与
      相对链接检查）；本 change 未归档，`--archived` 审计不适用
- [x] 11.3 本 change 的验收动作：`design.md` §11 的 R / F / A 矩阵按 §8 对账表逐项 PASS
      （R：`cargo test` 全绿 + RED 日志；F：10/10；A：11/11，见 9.11）；
      真机证据在主仓 `.local/acceptance/2026-11-23-harness-turn-retry/`，门禁日志在
      `.local/missions/harness-turn-retry-nov23/gates.log`（不落 worktree）。

## 12. 节点 2（归档放行材料，2026-11-23）

- [x] 12.1 节点 2 材料按五要件落齐：`proposal.md` 的「节点 2」块（节点 1 / 独立评审 / tasks 完成数
      与放弃原因 / 门禁与三批真机证据 / 规格对账三项读数）；`docs/backlog.md` 归档跟踪条目同步
      五要件状态（有且仅有一条）
- [x] 12.2 独立 reviewer 评审：结论 **clean / merge**，绑定 tip `a9538e90`，无 P1 / P2（2026-11-23）；
      评审结论由 tower 转达，未提供独立评审文件路径（不代填）。本节点 2 材料提交为 docs-only，
      不改实现与规格 delta
- [x] 12.3 merge 到 master（由 tower 执行；提交 `2951ca51` 已合并并推送）
- [x] 12.4 归档：归档提交 `9d0ddfbf`；`node scripts/openspec-archive-check.mjs --archived
      add-harness-turn-retry-nov23` PASS（0 MODIFIED / 0 段，人工恢复 0 段，声明认领 0 段）
