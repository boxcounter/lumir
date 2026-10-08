# Design: wire 形态会话留存

proposal 的技术面：文件布局、记录 schema、不变量、恢复设计与验证方法。UI 面只加一个极简选择器（复用会话浮层既有组件），无新视觉设计、无原型，不需要「视觉保真」节。

## 1. 文件布局与会话身份

```
<config_dir>/harness/sessions/<session_id>.jsonl
<config_dir>/harness/<sanitize(vault_root)>.jsonl   ← 旧形态，孤儿，不再续写
```

- `session_id`：时间序 id `s<unix_millis>-<6 位随机 base36>`（如 `s1759912345678-k3x9ab`）——可排序、够唯一、人可读；不取 UUID 纯随机形，因为「按时间列出会话」是未来的第一消费姿势。
- 一个逻辑会话一个文件，append-only，首行恒为 `session_open`。
- 会话建立 / 「新会话」重置 / 自动压缩 / 从历史会话恢复 → 各建新文件；旧文件封闭（不再追加，也不改写）。
- 不做会话索引文件、不做清理策略（探针期；选择器直接扫 `sessions/` 目录，无需索引）。

## 2. 记录 envelope 与 schema

沿用现行 envelope：`{"ts": <unix 秒>, "payload": {...}}`（`unix_secs_now` 与面板消息同取时点纪律不变，M353）。

### `session_open`（每文件恰一行，首行）

```json
{
  "kind": "session_open",
  "session_id": "s1759912345678-k3x9ab",
  "vault_root": "/tmp/lumir-demo-vault",
  "opened_from": "new | reset | compact | restore",
  "provider": "kimi",
  "model": "kimi-for-coding",
  "thinking": "high",
  "system": "<完整装配后 system prompt 全文，逐字节>",
  "assembly": [
    {"source": "identity", "path": null, "exists": true, "bytes": 412},
    {"source": "quote_reference", "path": null, "exists": true, "bytes": 231},
    {"source": "agents_user_wide", "path": "/Users/demo/.agents/AGENTS.md", "exists": true, "bytes": 2081},
    {"source": "agents_vault_root", "path": "/tmp/lumir-demo-vault/AGENTS.md", "exists": false, "bytes": 0},
    {"source": "skill_index", "path": null, "exists": true, "skills": 3}
  ],
  "compact_summary": "<仅 opened_from=compact 时在场：压缩摘要全文>",
  "restored_from": "<仅 opened_from=restore 时在场：被恢复会话的 session_id>"
}
```

装配清单（`assembly`）是新增的结构化出口：`assemble_system` 从「返回 String」改为「返回 {text, manifest}」（`context.rs`），调用侧三处装配点（建立 / 重置 / 压缩）都落 `session_open`。`exists: false` 的来源也在场——「当时不存在」本身是装配事实的一部分（现状：静默跳过导致事后无法区分「没配」与「忘了注入」）。**恢复是第四种建文件路径，但不重新装配**：`opened_from=restore` 的新文件沿用被恢复会话的 `system` 与 `assembly`（逐字节灌回，见 §6），不跑 `assemble_system`。

`opened_from` 四值：会话建立 = `new`；「新会话」= `reset`；自动压缩 = `compact`（摘要进 `compact_summary`，对应旧 `compact` 事件的摘要语义）；从历史会话恢复 = `restore`（源会话 id 进 `restored_from`）。

### `llm_request`（每次 LLM 调用恰一条，含工具循环每次迭代与压缩调用）

```json
{
  "kind": "llm_request",
  "request": {
    "provider": "kimi",
    "model": "kimi-for-coding",
    "system": "<逐字节同 session_open.system 或压缩后新装配>",
    "messages": [ ... ],
    "params": { "thinking": "high" }
  }
}
```

`request` 是传给 LLM client 的同一个结构化值——**记录点就在发送点**，不存在二次序列化，天然没有翻译层。`messages` 里用户消息含序列化后的 `<quote>` 块（引用消息序列化协议的 wire 口径）。

### `llm_response`（每次 LLM 调用恰一条，与 `llm_request` 成对、按序相间）

```json
{
  "kind": "llm_response",
  "text": "<完整轮次正文>",
  "reasoning": "<reasoning 回放项原文（provider 方言，逐字节原样）；无则缺省>",
  "thinking": "<思考展示文本（reasoning_deltas 汇总 / 从回放项提取）；无则缺省>",
  "tool_calls": [ ... ],
  "usage": { "input_tokens": 1234, "cached_tokens": 800, "output_tokens": 56 },
  "error": "<仅失败时在场>",
  "mock_fixture": "<仅 mock provider：fixture 路径>"
}
```

- `reasoning` 与 `thinking` 分存（裁决点 1 落盘的「思考」两者都在场）：`reasoning` 是**回放项**——provider 方言的不透明项（kimi 的 `encrypted_content`、deepseek 的 `reasoning_text` content parts），逐字节保真、原样，供恢复回填最后一条响应（见 §6）；`thinking` 是**展示文本**（给人看的思考），两者物理隔离、互不借道（M362 纪律）。只在历史（`llm_request.messages`）里的推理项走回放，展示文本永不回传模型。
- `reasoning` 是 provider 方言，不可跨 provider 复用（kimi 的 `encrypted_content` 对 deepseek 无意义，反之亦然；跨 provider 恢复的重写见 Non-goals）。
- mock provider 记 `mock_fixture`：确定性验收的因果链（哪份 fixture 驱动了这一轮）对分析有价值。

### sidecar 记录（决策类，wire 不可推导）

保留 4 类：`approval`（采纳 / 拒绝 + 原因）、`turn_aborted`（停止）、`llm_error`（LLM 调用失败）、`loop_max_reached`。废弃 11 类被 wire 覆盖或失去意义的事件 kind：`user_message` / `assistant_text` / `tool_call` / `tool_result` / `usage` / `tool_denied` / `compact` / `session_reset` / `approval_overwritten` / `approval_withdrawn` / `turn_abort_requested`——其中 `usage` 并入 `llm_response`，`compact` / `session_reset` 并入文件边界 + `session_open`，`tool_denied` 是 wire 可推导的（deny 时回送模型的 tool result 带 `permission_denied` 错误码与工具名 / subject，随历史进下一条 `llm_request.messages`）。

## 3. 不变量（实现 MUST 守住）

1. **首行不变量**：每个 `sessions/*.jsonl` 首行是 `session_open`，且全文件 `session_id` 一致。
2. **请求-响应配对**：`llm_request` 与 `llm_response` 严格交替成对（失败响应也是响应，`error` 字段在场）；压缩调用的丢弃 sink 不影响留存（留存与 sink 是两条出口）。
3. **历史接续一致性**：第 i 条 `llm_response` 的正文 / 思考（`reasoning` 回放项）/ 工具调用，必须与第 i+1 条 `llm_request.messages` 中对应的 assistant / tool 项逐字节一致。这是「单份事实」的机器可检形态：响应一旦入历史，就只从历史读。
4. **system 一致性**：同一文件内所有 `llm_request.system` 与首行 `session_open.system` 逐字节一致（压缩开新文件后按新文件首行为准）。
5. **恢复充分性**：仅凭文件内容可重建每一轮请求——本不变量的验收形态，见 §5。
6. **记录不阻断对话**：IO / 序列化失败只打 stderr 的既有纪律不变（`jsonl.rs` 现行口径）。

## 4. 体积权衡（裁决点 2 的定量注脚）

完整请求体意味着同轮工具循环的第 n 次迭代重复携带前 n-1 轮历史：50 次迭代的循环，末次请求 ≈ 50 × 平均单轮历史。探针期会话量级（数十轮、单请求数十 KB）下是 MB 级文件，压缩开新文件给增长封顶；为省这份重复引入增量 + 重放器，换来的是恢复代码路径与发送路径各说各话——被否。若 dogfood 出现体积实证，优先做的是「压缩旧文件 / 截断附件」类事后整理，不动 wire 口径。

## 5. 验证方法

- **恢复充分性属性测试（Rust，核心判据）**：mock provider 脚本跑一轮含工具循环的对话（含 `<quote>` 消息与 thinking fixture）；测试从落盘 JSONL **独立**重建每个请求（取 `session_open.system` + 依不变量 3 重放），与对应 `llm_request.request` 断言深度相等。反向验证：手改一条重建结果，断言必红（REVIEW.md 第 1 条纪律）。
- **记录形状集成断言**：mock provider 一轮后断言文件首行 `session_open`（system 全文在场、assembly 含 exists:false 项）、请求-响应配对数、思考的 `reasoning` 与 `thinking` 双字段在场。
- **恢复路径测试（本期新增，最小恢复的落地判据）**：mock provider 造一段含工具循环的多轮会话 → 走恢复入口重建，断言新文件 `opened_from=restore` + `restored_from`=源 id、重建的 system / input 与源会话逐字节一致；恢复后再续一轮，断言新请求的 input = 源 input + 恢复后新增消息。含两个边界用例：末尾响应折叠、末尾响应带悬空工具调用。
- **既有留存测试换代**：`jsonl.rs` 的 quote 逐字节用例迁移为新口径（`<quote>` 块在 `llm_request.messages` 中断言）。
- **验收场景（迁移既有 + 新增）**：`scripts/acceptance/scenarios/` 下 15 个引用 `env:harness/*.jsonl` 的既有场景逐一对账迁移——锚定废弃 kind 的断言改写为 wire 口径（`llm_request` / `llm_response` 内容），保留类（`turn_aborted`）按 sidecar 口径核对；另新增 wire 留存场景（mock provider 跑一轮，读 `sessions/*.jsonl` 断言首行与请求记录在场）与恢复场景（选择器列出历史会话、恢复续聊）；fixture 全部合成。
- **旧文件孤儿断言**：升级后旧 vault 聚合文件不被续写（mtime / 行数不变）。

## 6. 最小恢复（本期纳入）

恢复是留存的真实消费者与验证器（proposal 裁决点 5）：把「逐字节重建请求」这条验收口径从测试搬进产品，漏记 / 错记会在真实续聊里暴露。

### 6.1 极简选择器

- 入口在标题栏 harness 段的**会话浮层**：现有「新建会话」动作项之外，同一浮层 SHALL 列出本 vault 的历史会话。
- 范围 = `sessions/*.jsonl` 中 `session_open.vault_root` 等于当前 vault 的文件（留存文件是平铺的，选择器按 vault 过滤）。
- 排序：按 session_id 时间序前缀**倒序**（最近的在上）。
- 每项会话名 = 该会话**首条用户消息**截断约 20 字（与标题栏会话名同口径；对恢复出的会话也成立——首条用户消息在灌回的 input 里）。
- 只读、只列：重命名 / 删除 / 搜索 / 分组等完整形态不做（Non-goals）。无历史会话时列表为空。

### 6.2 恢复算法（重建 Session）

选中一项 → 读其 `sessions/<id>.jsonl`：

1. **锚点** = 文件里**最后一条** `llm_request`。
2. `system` = 锚点请求的 `system`（逐字节，== 该文件 `session_open.system`，按不变量 4）——**不重新装配**：恢复旧会话就沿用旧会话当时的系统上下文（今天的 AGENTS.md / Skill 索引变了也不改历史），否则「恢复充分性」当场破。
3. `input` = 锚点请求的 `messages` 原样灌回。
4. **折叠末尾未入请求的响应**：若锚点之后还有 `llm_response`（会话结束在最后一轮答复之后、用户尚未再提问），把该响应的 assistant 轮追加进 `input`——按不变量 3 的逆向：`reasoning` 回放项在前、`text` 非空时的 assistant 消息项、`tool_calls` 的 function_call 项成组（M360 项序）。如此重建的 `input` 与会话当时持有的 `input` 逐字节一致。
   - 边界：末尾响应若含未配对的工具调用（工具循环中途被停 / 进程被杀），输出项缺失，恢复的 input 会有悬空 `function_call`——最小恢复按原样灌回（不伪造输出）；是否被 provider 拒收属已知边界，不阻断选择器。
5. 续写：恢复开**新会话文件**（新 session_id，`opened_from=restore`，`restored_from`=源 id），旧文件封闭不动；之后按常规在内存态上继续（新提问追加到灌回的 input 之后）。

面板（transcript）从灌回的 `input` + `llm_response` 重建渲染消息（user / assistant / tool 按 wire 项顺序），使恢复后用户看得到历史；这是面板视角，不参与回放（回放只走 `input`）。

### 6.3 思考文本回放的 provider 差异

回放项是 provider 方言，恢复必须**原样**重建，不能自行拼接：

- **kimi**：reasoning 项携带不透明 `encrypted_content`（SSE 经 `response.output_item.done` / `response.completed` 到达）；展示文本走 `response.reasoning_summary_text.delta`。回放时整项逐字节回传。
- **deepseek**：thinking 模式产出**独立** reasoning 项，content 为 `{"type":"reasoning_text","text":…}` parts（另带 `encrypted_content` / `status`）；带 `tools` 时后续每一轮 MUST 原样回传，否则 400（`The reasoning_text in the thinking mode must be passed back to the API`，M306 真机实测）；展示文本走 `response.reasoning_text.delta`。项序也是硬条件：同一轮多条工具调用须成组在输出项之前（M360 实测），单条 reasoning 项紧随其 assistant 消息之前入 input。
- **恢复怎么满足**：锚点之前的历史，回放项本就在 `llm_request.messages` 里逐字节在场，原样灌回即满足两家形状与项序，**无需重写**；只有末尾响应（§6.2 第 4 步）需要从 `llm_response.reasoning` 取回放项、按同一位置（assistant 消息之前）重插。恢复不读 `thinking`——那是展示文本，不是回放项。

详见 `src-tauri/src/harness/llm.rs` 模块文档「reasoning 回传纪律」（M306 / M360 / M362）与 `session.rs` 的 `assistant_item` / `function_call_item`（项序落点）。

## 7. 明确不实现的（防 scope 蔓延）

完整多会话管理 UI（重命名 / 删除 / 搜索 / 分组）、会话索引文件、旧文件迁移、压缩文件整理、跨 provider 恢复的方言重写、远端上报。详见 proposal Non-goals。

## 8. 未来方向（本期不做，留扣子）

本期取的是「每次调用落完整请求体」（§4）。**当会话变长、完整请求体重复落盘的体积成为实际问题时**，候选演进是改为两家 coding agent 的「wire 原生增量记录 + 确定性重建」形态——每发生一条消息 / 工具调用追加一行原文（wire 原生消息对象），恢复时按序拼装重建。这与 §4 否掉的「业务事件流水」不是一回事：增量记的是**发给模型的原文**，不是业务语义事件，拼装因此不变形。

一手依据（2026-10-08 本机实测两家实现）：

- **Kimi Code**：`wire.jsonl` 的 `llm.request` **只存哈希、不存请求体**；恢复靠消费 append 事件流重建。
- **Claude Code**：会话文件是 `parentUuid` 链的**完整消息对象逐条 append**。

**权衡（为什么本期仍取完整请求体）**：恢复时**逐字节保真决定 prompt cache 命中**——重建请求与当初发给模型的字节若有任何差异，provider 侧的前缀缓存即不命中。完整请求体方案**恢复零拼装**（§6.2 原样灌回），在恢复场景最稳；增量的代价是恢复代码路径与发送路径**各说各话**（拼装器要做到逐字节保真，等于把发送路径再实现一遍）。§4 已定：体积成为实际问题时，第一步是「压缩旧文件 / 截断附件」类事后整理；本节记的是**更深一层的结构候选**，待那时判定是否取它。
