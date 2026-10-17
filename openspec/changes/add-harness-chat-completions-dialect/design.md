# Design: add-harness-chat-completions-dialect

> 读者假设：不看代码也能评审。证据指针统一指向 `test-results/ctxdiag-2026-10-17/`（git 外：root-cause.md / evidence.md / provider.md / code-path.md / probes/results-mechanism.json）。

## 1. 背景与证据摘要

- **根因（已钉死）**：Kimi 编码端点 `https://api.kimi.com/coding/v1/responses` 的前置闸按**请求体 UTF-8 字节数**判定，边界实测 `(417,231, 417,512]` 字节（区间宽 281 B）。报错文案 `Your request exceeded k3-256k model token limit: 262144` 中的 262144 是名义窗口，不是闸的计数单位。判据：417,985 B 纯英文合成请求（外推 ~8.1 万 tokens）被 400，而 104,571 tokens（417,231 B）的事故请求通过；11 个候选计数模型中唯字节口径自洽（evidence.md §5）。
- **chat 方言对照（同账号同模型，本机 Kimi Code CLI wire 实证）**：Chat Completions 路径普通轮最高服务到 211,055 input tokens、压缩轮 234,656（名义窗口 80–89%），请求体 0.83–1.1 MB 放行（provider.md §2.5–2.6；本会话已抽查 `~/.kimi-code/sessions/.../wire.jsonl` 复核：`usage.record` 峰值 234,656，其请求事件 `kind=compaction`，普通轮峰值 211,055）。
- **客户端无膨胀缺陷**：被拒请求 156/156 项 distinct，system/tools 各一份（code-path.md §Q5）。
- **次生问题**：ctx% 分母用名义 262,144，`warn_ctx_pct=85` 需 usage 222,822 ≈ 89 万字节请求体，在 41.7 万字节闸下结构性不可达；主动压缩从不触发，只剩 400 兜底。

## 2. 决策点

### D1 方言选择：`wire_api` 配置键（per provider，显式，无嗅探）

- 形态：`[harness].providers.<id>.wire_api`，闭集合 `"responses"` / `"chat_completions"`，缺省 `responses`；非法值回落默认 + 人话 warning（沿用 config.rs 既有校验模板）。
- 命名借自 Codex 同名键（`wire_api = "responses"`），语义一致。
- **不做 base_url 自动嗅探**：字节闸只在 coding 端点实证过，平台端点（`api.moonshot.cn`/`api.kimi.com` 平台侧）的 Responses 行为未测；M381 的 config-only 哲学（「彻底不使用内置表」）要求行为差异来自配置显式声明。
- v1 范围：`chat_completions` 仅 kimi 实现；deepseek 配置该键 → warning + 回落 `responses`（deepseek 现役 Responses 形态未触闸，无迁移需求）。mock 无此键（fixture 驱动在 client 之上）。

### D2 手写适配层，不引入外部 SDK（2026-10-17 Alex 追问的裁决讨论）

- 结论：新增 `ChatCompletionsClient` 实现既有 `LlmClient` trait，复用 `Request`/`TurnOutput`/`StreamSink`/错误诊断/压缩集成；只新写「items→messages 翻译 + chat SSE 解析 + usage/错误映射」。
- 理由（按权重）：① SDK 只替换类型定义与 SSE 分帧，覆盖不到流式分片转发（M369）、在途停止保留产出、reasoning 归一、usage 读数、错误诊断这些真实体量；② Kimi 方言字段在 OpenAI spec 之外——Kimi Code 用成熟 SDK（`@ai-sdk/openai-compatible`）仍须自写 `kimiOpenAITrait` 注入 `thinking` 字段与 `reasoning_content` 处理（本机 bundle 实证，provider.md §2.6）；③ 本次字节闸定位靠的正是手写层的逐字节诊断（`request_bytes`/`raw_body`/`request_id`），抽象层在网关行为特异时是障碍；④ 仅两家 provider，手写层 wire 形状已被单测钉死。
- **Revisit 触发条件**（任一成立再重议）：provider 数量涨到方言维护不过来的量级；Moonshot 发布官方 Rust SDK 且原生覆盖 coding 方言字段；决定放弃 wire 级诊断（与 M463 方向相反）。

### D3 存储形态不变，翻译在 wire 边界单一构造点

- `Session.input` 保持既有 Responses item 形态（canonical）；`ChatCompletionsClient` 在构造请求体时翻译为 chat messages。恢复路径（`resume_session`）零改动；Responses 时期留存的会话恢复后可直接以 chat 方言续聊——翻译在发送边界，留存项不重写（「不跨 provider 重写回放项」条款不受影响）。
- 干跑实证（2026-10-17，tower 以封存事故请求 `test-results/k3-256k-overflow-2026-10-14/failed-request.json` 离线翻译）：156/156 项全覆盖映射为 109 条 chat messages，无悬空/未映射项；chat 请求体估算 418,570 B vs Responses 实测 418,906 B（差 0.08%）。
- **关键认知：chat 方言不是减量方案**——reasoning 全量回放是 Kimi chat 的硬性要求（官方错误参考：`thinking is enabled but reasoning_content is missing in assistant tool call message` 400），体积不降。chat 方言绕开的是 Responses 专属字节闸本身（chat 路径实证 0.83–1.1 MB 放行）。reasoning 减量是独立杠杆，不在本 change（proposal Non-goals）。
- 构造纪律沿用 REVIEW.md「同一语义两处真源」：chat 侧的 `wire_body` / `wire_body_bytes` 共用一份构造（与 Responses 侧 M463 同构）。

### D4 items → messages 翻译表

| 内部 item（canonical） | chat message | 规则 |
|---|---|---|
| `system`（顶层 instructions） | `{role:"system", content}` 首条 | 一轮一条 |
| user 消息 | `{role:"user", content}` | 文本直出 |
| assistant 消息 | `{role:"assistant", content}` | 与之前累积的 reasoning 合并（见下） |
| reasoning 项（`summary`/`content` 明文） | 折叠进**其后第一条 assistant 消息**的 `reasoning_content`（多段拼接） | Kimi 硬性要求：带 tool_calls 的 assistant 消息也必须带 reasoning_content（官方错误参考 400 文案实证） |
| function_call 组（一轮 N 个） | 单条 `{role:"assistant", content:null, reasoning_content?, tool_calls:[{id, type:"function", function:{name, arguments}}]}` | 该轮的 reasoning 折叠进本条 |
| function_call_output 组 | 紧随的 `{role:"tool", tool_call_id, content}` × N | tool 消息必须紧邻 tool_calls 消息，中间不得插入其它消息（CLIProxyAPI#6231 实证该端点按 chat 管线严格校验顺序）；canonical 顺序（calls 组→outputs 组，M360）天然满足 |
| `input_image` 附件（data URL） | user 消息 content parts `{type:"image_url", image_url:{url}}` | 展开点不变（`expand_image_refs` 先于翻译） |
| 悬空 function_call（恢复边界：有 call 无 output，code-path §Q2 已登记） | 翻译时丢弃并落一条诊断记录 | 发送必 400（tool_calls 未配对）；丢弃是唯一不必然失败的处置 |

### D5 思考档位字段

- chat 方言：`thinking: {type:"enabled", effort, keep:"all"}`（Kimi Code `kimiOpenAITrait` 实证形态，provider.md §2.6 Q2）。`keep:"all"` 明示全量回放意图，与 Kimi Code 默认 `thinkingKeep:"all"` 对齐。
- 能力判据沿用 `HarnessConfig::effort_supported`（per-model `effort` 声明）：未声明的模型 MUST NOT 发 `thinking` 字段（与 Responses 侧 `reasoning.effort` 同纪律）。

### D6 usage 映射（meter 零改动的前提）

| 既有 `Usage` 字段 | chat 来源 | 依据 |
|---|---|---|
| `input_tokens` | `usage.prompt_tokens` | bundle：`usage.prompt_tokens ?? 0` |
| `cached_tokens` | `usage.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0` | bundle 原文行（两种字段布局都兜） |
| `cache_write_tokens` | 无 chat 对应 → 0 | 会话累计读数口径不变（spec「缓存写入随 usage 落盘」已有 provider 缺字段记 0 的先例） |
| `output_tokens` | `usage.completion_tokens` | 标准 OpenAI 形态 |

- 流式 usage：`stream_options:{include_usage:true}`（bundle 实证 Kimi Code 发送形态），从末帧取 usage；端点不回 usage 帧时该轮无读数（与既有「无 usage 不更新 meter」同纪律）。
- **coding 端点的确切 usage 字段名由冒烟探针钉死**（任务 6.4）；bundle 是先验，探针是判定。

### D7 错误映射与超限特征串

- kimi 预设 `overflow_indicators` 增补：`"total message size"`（chat 的 2 MB 消息体上限，官方错误参考实证形态 `total message size N exceeds limit 2097152`——该体量对应 tokens 已远超窗口，映射为超限走压缩重试是正确处置）、`"supports only 256k context"`（真超窗的 401 族文案，官方文档明示处置就是 compact 或换模型——自动压缩重试正是 compact）。既有 `"token limit"` 已命中 chat 的 400 文案（`...exceeded model token limit: 262144 (requested: N)`）。
- `invalid_authentication_error` 信封是 Responses 闸的特产，chat 路径预期不再出现；若出现，走通用 HTTP 错误路径（诊断字段全落），不做特判。
- HTTP 面诊断（`http_status`/`raw_body` 截断/`request_id`）复用 `http_error_turn_error`，两方言同一份。

### D8 不发 max_tokens / max_completion_tokens

沿用 Responses 侧「不发」决定。旁证：Kimi Code 旧版按整窗发 `max_tokens=262144` 仍服务到 234k（coding chat 端点不把 max_tokens 计入 prompt 上限）；新版（PR #4091 后）默认不显式声明。「不发」是最保守形态。

### D9 回退路径

删配置一行回 `responses`；Responses 客户端与预设一行不动。chat 方言若命中该端点其它形状陷阱（kimi-code#3530 的 metadata 先例证明同族风险存在），回退成本为零。

## 3. 测试计划

- **cargo 单测**（判定层全在纯函数）：翻译表全 item 类型（含 reasoning 折叠、并行 tool calls 排序、悬空 call 丢弃、图片 part）；chat SSE 解析（content/reasoning_content delta、tool_calls 累积、usage 帧、abort 保留产出）；usage 映射两种 cached 字段布局；`is_overflow` 对 chat 三条文案的命中；`wire_api` 配置校验（缺省/合法/非法/类型不符）；`session_open` 增键。
- **跨方言恢复测试**：Responses 形态留存的 `llm_request` 灌回后，chat 客户端翻译输出的 messages 结构与逐字段内容正确（纯函数断言，不起 HTTP）。
- **Responses 侧既有测试一行不动**（含 M548 的 reasoning 回放 fixture）——它们的断言对象是该方言自己的行为。
- **bindings-drift 纪律**：config 结构动 ts-rs 导出面，先 `git add src/bindings/**` 再跑 `gate.sh quick`。

## 4. 探针计划（烧配额，需 Alex 授权后执行；全部合成内容）

| # | 探针 | 目的 | 成本上界 |
|---|---|---|---|
| S1 | 最小 chat 请求（coding 端点） | 钉死 usage 字段名 / SSE 帧形态 / 200 可达 | ~百 tokens |
| S2 | 思考开关 + 两轮往返（第二轮带 reasoning_content 回放） | 验证 `thinking` 字段与 reasoning_content 回放的接受性 | ~千 tokens |
| S3 | 复刻事故体量（~42 万字节合成内容） | 实证 chat 路径无 41.7 万字节闸（预期 200） | ~10 万 tokens |

S3 失败 = chat 路径也有体量闸，回退 D9，重新裁决；S3 成功即闭环「同内容、两方言、不同命运」的端到端证据。

## 5. 验收与门禁

- 真机验收套件（mock fixture 驱动）在 client 抽象之上，**预期零改动**；tasks 含一项回扫确认（含 M548 fixture 与任何 wire 形状断言）。若回扫发现 wire 形状断言泄漏到验收层，随实现同 PR 改准。
- `validate --all --strict`、`cargo test`、`pnpm test`、`gate.sh quick` 全绿为合并门槛。
- dogfood：合并后 Alex 日常使用即活体验证（chat 方言下 ctx% 应能首次越过 40% 区间，85% 预警恢复可达）。

## 6. 风险

| 风险 | 等级 | 对冲 |
|---|---|---|
| coding chat 端点 usage 字段与 bundle 先验不符 | 低 | S1 探针钉死；映射层对两种字段布局都兜底 |
| chat 路径存在未知形状陷阱（#3530 同族） | 中低 | D9 零成本回退；S3 探针提前暴露 |
| 翻译边界 case（悬空 call、orphan reasoning）处置不当 | 低 | 单测钉死 + 诊断落盘 |
| 压缩调用在 chat 方言下的形状（tools=[] + 单 user 消息） | 低 | 翻译表天然覆盖；S2 附带验证 |
