# Proposal: harness 的 kimi provider 增加 Chat Completions wire 方言

- Change ID: `add-harness-chat-completions-dialect`
- 日期: 2026-10-17
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

k3-256k 在 Lumir 内置 harness 里「上下文 ~10 万 tokens 即报超窗」的根因已钉死（2026-10-17 根因调查，证据 `test-results/ctxdiag-2026-10-17/`，git 外）：Kimi 编码端点的 `/coding/v1/responses` 路径前置一道**按请求体 UTF-8 字节数判定的闸**，边界实测 `(417,231, 417,512]` 字节，报错文案里的 `262144` 只是模型名义窗口、不是闸的计数单位。决定性证据：一只纯英文合成请求 417,985 字节、按服务端实测密度外推仅约 8.1 万 tokens 仍被 400 拒，而事故会话 104,571 tokens（417,231 字节）的请求通过——任何按 token 计的闸都不产生这个顺序。

同一账号、同一模型走 **Chat Completions** 方言时，本机 Kimi Code CLI 的 wire 记录实证可正常服务到 **211,055（普通轮）/ 234,656（压缩轮）input tokens**（≈名义窗口的 80–89%），请求体 0.83–1.1 MB 照单全收。即：真实窗口 262,144 在 chat 方言下可达，Responses 方言下只有 ~40% 可用。

客户端侧的次生问题：meter 的 ctx% 分母沿用名义 262,144，`warn_ctx_pct=85` 在字节闸下结构性不可达（触发需 ~89 万字节请求体，远超 41.7 万闸），主动压缩从不触发，只剩 400 错误路径的自动压缩兜底。

架构留口早已存在：`LlmClient` trait 的注释明引 ADR 0007 Decision 3——「将来 Chat Completions 适配器与 Responses 适配器并存于同一循环之下」（`src-tauri/src/harness/llm.rs`）。本 change 消费这个留口。

Alex 2026-10-17 裁决：「Chat Completions 适配是已被同账号实证的正路（21-23 万 tokens 可服务），值得立项。」

## What Changes

1. **配置新增 `wire_api` 键**：`[harness].providers.<id>` 增加可选键 `wire_api`（闭集合 `responses` / `chat_completions`，缺省 `responses`——现有配置行为逐字节不变；非法值回落默认 + 人话 warning，沿用既有校验模板）。v1 仅 kimi 实现 chat 方言；deepseek 配置该键给 warning 并回落 `responses`。
2. **新增 ChatCompletionsClient**：实现既有 `LlmClient` trait，kimi 在 `wire_api = "chat_completions"` 时走 `POST {base}/chat/completions`。会话存储形态（Responses item）不变，**items → messages 的翻译发生在发送边界的单一构造点**（与 `wire_body` / `wire_body_bytes` 共用构造的纪律同构）；思考回放按 Kimi chat 方言的硬性要求折叠为 assistant 消息的 `reasoning_content`；思考档位按 Kimi trait 形态以 `thinking` 字段表达；usage / 缓存读数映射到既有 `Usage` 结构，meter 与读数口径零改动。
3. **超限特征串扩充**：kimi 预设补 chat 方言的超限话术（`total message size`、`supports only 256k context`），既有 `token limit` 已命中 chat 的 400 文案；超限自动压缩重试逻辑不变。
4. **留存口径微调**：`session_open` 增记 `wire_api` 以便事后排查；`llm_request` / `llm_response` 形态与「恢复充分性」判据不变（wire 重建经方言翻译层推导）。旧会话（Responses 时期留存）恢复后可在 chat 方言下直接续聊——翻译在发送边界，留存项不重写。
5. **spec 注记收口**：「上下文用量显示与触顶处理」的「已知边界」注从「调查进行中」改写为调查收口结论（字节闸 + chat 对照实证 + 证据指针）。`docs/backlog.md`「harness ctx% meter 的分母口径」条的主问题由本 change 收口（chat 方言下名义分母恢复诚实）；其附属子问题「超限时 meter 是否同步读数」不在本 change，留 backlog。

## Non-goals

- **不引入外部 LLM SDK**（如 async-openai）。理由：SDK 只替换类型定义与 SSE 分帧，覆盖不到 Lumir 的流式分片转发、在途停止、reasoning 归一、usage 读数、错误诊断这些真正体量；Kimi 方言字段（`thinking`、`reasoning_content`）在 OpenAI spec 之外，spec 型 SDK 装不下——Kimi Code 自己用成熟 SDK（`@ai-sdk/openai-compatible`）仍须另写 `kimiOpenAITrait` 自定义层；本次字节闸定位恰恰靠手写层的逐字节诊断能力。revisit 触发条件与完整论证见 design.md D2。
- 不改 deepseek 方言（仍 Responses-only）；不删除、不改动 Responses 客户端的任何行为。
- **不做 reasoning 回放减量**（事故体 24% 的明文 summary 是独立减量杠杆，代价是跨轮思考上下文变弱，需另行裁决）。
- 不动 UI / 视觉 / 面板呈现；不动压缩语义与触发条件；不动工具集与权限模型。
- 不嵌入外部 agent runtime（ACP / headless CLI 属 ADR 级另一层问题，ADR 0007 Decision 3 的留给设计阶段的选项不在本 change 消费）。
- 不向 Kimi 报 bug（root-cause §6.4 的凭证材料已备，另行安排）。
- ctx% 公式与 `warn_ctx_pct` 默认值不变；「错误轮 meter 是否同步读数」维持现状（backlog 待裁项不动）。

## Impact

- 影响的 specs：`harness`
- 影响的代码/系统：`src-tauri/src/harness/llm.rs`（新客户端 + 预设表）、`src-tauri/src/config.rs`（`wire_api` 键与校验）、`src-tauri/src/harness/turn.rs` / `session.rs`（`session_open` 增键）、`src/bindings/`（ts-rs 重导出）；UI 零改动。
- 关联约束：ADR 0007 Decision 3（运行时抽象边界——本 change 消费其留口，不修改 ADR）；ADR 0002 §5 配置即数据（新键走既有校验模板）；性能合同不触及（网络与流式本就在编辑器热路径外）。
- 配置迁移：Alex 的 `config.json` 需在实现批加一行 `wire_api = "chat_completions"`（先备份，`vault.ignore` 迁移先例）；不做自动迁移。
- 回退路径：删掉该行配置即回 Responses 方言，Responses 路径一行未动。
