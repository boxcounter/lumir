# Design: wire 形态会话留存

proposal 的技术面：文件布局、记录 schema、不变量、验证方法。无原型（无 UI 面），不需要「视觉保真」节。

## 1. 文件布局与会话身份

```
<config_dir>/harness/sessions/<session_id>.jsonl
<config_dir>/harness/<sanitize(vault_root)>.jsonl   ← 旧形态，孤儿，不再续写
```

- `session_id`：时间序 id `s<unix_millis>-<6 位随机 base36>`（如 `s1759912345678-k3x9ab`）——可排序、够唯一、人可读；不取 UUID 纯随机形，因为「按时间列出会话」是未来的第一消费姿势。
- 一个逻辑会话一个文件，append-only，首行恒为 `session_open`。
- 会话建立 / 「新会话」重置 / 自动压缩开新逻辑会话 → 各建新文件；旧文件封闭（不再追加，也不改写）。
- 不做会话索引文件、不做清理策略（探针期；无读者）。

## 2. 记录 envelope 与 schema

沿用现行 envelope：`{"ts": <unix 秒>, "payload": {...}}`（`unix_secs_now` 与面板消息同取时点纪律不变，M353）。

### `session_open`（每文件恰一行，首行）

```json
{
  "kind": "session_open",
  "session_id": "s1759912345678-k3x9ab",
  "vault_root": "/tmp/lumir-demo-vault",
  "opened_from": "new | reset | compact",
  "provider": "kimi",
  "model": "kimi-for-coding",
  "thinking": "high",
  "system": "<完整装配后 system prompt 全文，逐字节>",
  "assembly": [
    {"source": "identity", "path": null, "exists": true, "bytes": 412},
    {"source": "agents_user_wide", "path": "/Users/demo/.agents/AGENTS.md", "exists": true, "bytes": 2081},
    {"source": "agents_vault_root", "path": "/tmp/lumir-demo-vault/AGENTS.md", "exists": false, "bytes": 0},
    {"source": "skill_index", "path": null, "exists": true, "skills": 3}
  ],
  "compact_summary": "<仅 opened_from=compact 时在场：压缩摘要全文>"
}
```

装配清单（`assembly`）是新增的结构化出口：`assemble_system` 从「返回 String」改为「返回 {text, manifest}」（`context.rs`），调用侧三处装配点（建立 / 重置 / 压缩）都落 `session_open`。`exists: false` 的来源也在场——「当时不存在」本身是装配事实的一部分（现状：静默跳过导致事后无法区分「没配」与「忘了注入」）。

`opened_from` 三值：会话建立 = `new`；「新会话」= `reset`；自动压缩 = `compact`（摘要进 `compact_summary`，对应旧 `compact` 事件的摘要语义）。

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
  "text": "<正文增量外的完整轮次文本>",
  "thinking": "<reasoning 原文；无则缺省>",
  "tool_calls": [ ... ],
  "usage": { "input_tokens": 1234, "cached_tokens": 800, "output_tokens": 56 },
  "error": "<仅失败时在场>",
  "mock_fixture": "<仅 mock provider：fixture 路径>"
}
```

- `thinking` = 裁决点 1（默认落；Alex 否决则整体移除该字段）。
- mock provider 记 `mock_fixture`：确定性验收的因果链（哪份 fixture 驱动了这一轮）对分析有价值。

### sidecar 记录（决策类，wire 不可推导）

保留 4 类：`approval`（采纳 / 拒绝 + 原因）、`turn_aborted`（停止）、`llm_error`（LLM 调用失败）、`loop_max_reached`。废弃 10 类被 wire 覆盖或失去意义的事件 kind：`user_message` / `assistant_text` / `tool_call` / `tool_result` / `usage` / `compact` / `session_reset` / `approval_overwritten` / `approval_withdrawn` / `turn_abort_requested`——其中 `usage` 并入 `llm_response`，`compact` / `session_reset` 并入文件边界 + `session_open`。

## 3. 不变量（实现 MUST 守住）

1. **首行不变量**：每个 `sessions/*.jsonl` 首行是 `session_open`，且全文件 `session_id` 一致。
2. **请求-响应配对**：`llm_request` 与 `llm_response` 严格交替成对（失败响应也是响应，`error` 字段在场）；压缩调用的丢弃 sink 不影响留存（留存与 sink 是两条出口）。
3. **历史接续一致性**：第 i 条 `llm_response` 的正文 / 思考 / 工具调用，必须与第 i+1 条 `llm_request.messages` 中对应的 assistant / tool 项逐字节一致。这是「单份事实」的机器可检形态：响应一旦入历史，就只从历史读。
4. **system 一致性**：同一文件内所有 `llm_request.system` 与首行 `session_open.system` 逐字节一致（压缩开新文件后按新文件首行为准）。
5. **恢复充分性**：仅凭文件内容可重建每一轮请求——本不变量的验收形态，见 §5。
6. **记录不阻断对话**：IO / 序列化失败只打 stderr 的既有纪律不变（`jsonl.rs` 现行口径）。

## 4. 体积权衡（裁决点 2 的定量注脚）

完整请求体意味着同轮工具循环的第 n 次迭代重复携带前 n-1 轮历史：50 次迭代的循环，末次请求 ≈ 50 × 平均单轮历史。探针期会话量级（数十轮、单请求数十 KB）下是 MB 级文件，压缩开新文件给增长封顶；为省这份重复引入增量 + 重放器，换来的是恢复代码路径与发送路径各说各话——被否。若 dogfood 出现体积实证，优先做的是「压缩旧文件 / 截断附件」类事后整理，不动 wire 口径。

## 5. 验证方法

- **恢复充分性属性测试（Rust，核心判据）**：mock provider 脚本跑一轮含工具循环的对话（含 `<quote>` 消息与 thinking fixture）；测试从落盘 JSONL **独立**重建每个请求（取 `session_open.system` + 依不变量 3 重放），与对应 `llm_request.request` 断言深度相等。反向验证：手改一条重建结果，断言必红（REVIEW.md 第 1 条纪律）。
- **记录形状集成断言**：mock provider 一轮后断言文件首行 `session_open`（system 全文在场、assembly 含 exists:false 项）、请求-响应配对数、思考字段在场（裁决点 1 落地时）。
- **既有留存测试换代**：`jsonl.rs` 的 quote 逐字节用例迁移为新口径（`<quote>` 块在 `llm_request.messages` 中断言）。
- **验收场景**：scripts/acceptance 新增 wire 留存场景（mock provider 跑一轮，读 `sessions/*.jsonl` 断言首行与请求记录在场）；fixture 全部合成。
- **旧文件孤儿断言**：升级后旧 vault 聚合文件不被续写（mtime / 行数不变）。

## 6. 明确不实现的（防 scope 蔓延）

读取者（恢复命令、会话枚举 UI）、索引文件、旧文件迁移、压缩文件整理、远端上报。详见 proposal Non-goals。
