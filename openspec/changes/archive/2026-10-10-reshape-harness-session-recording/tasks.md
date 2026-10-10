# Tasks: reshape-harness-session-recording

> **归档对账（M418 归档评审，2026-10-10）**：本 change 的实现由 M391–M396（RSR 批次）与 M398
> 落地并已全部合并 master，但任务清单在实现期未随勾选，一直停在 0/18——本 mission 按落盘实现
> 逐条核对后补齐勾选（实现侧零改动）。逐条证据：
>
> - **1.1–1.6**：`src-tauri/src/harness/jsonl.rs`（`sessions_dir` 的 `sessions/` 布局、`new_session_id`
>   的 `s<millis>-<6 base36>`、`pending_open` 保证首行恒为 `session_open`、旧 vault 聚合文件孤儿化、
>   写失败只打 stderr）、`harness/context.rs`（`AssembledSystem{text, manifest}`）、`harness/turn.rs`
>   （`record_llm_request` / `record_llm_response` 的 reasoning + thinking 双字段）。
> - **2.1–2.4**：`src-tauri/src/harness.rs`（`list_sessions` 按 vault 过滤 + 倒序、`resume_session` 的
>   末尾响应折叠与悬空工具调用灌回、`opened_from=restore` + `restored_from`）、`src/harness-panel.ts`
>   （会话浮层清单 + 恢复后重建 transcript）。
> - **3.1–3.4**：`src-tauri/tests/session_recording.rs`（`recovery_sufficiency_holds_for_tool_loop_turn` /
>   `recovery_sufficiency_fails_on_tampering` / `resume_rebuilds_session_and_continues_in_new_file` /
>   `resume_folds_trailing_response_with_dangling_tool_calls` / `wire_shape_records_full_session` 等）+
>   `jsonl.rs` 单测；既有 quote 逐字节用例已迁 wire 口径。
> - **3.5**：`45130b3` 把 15 个既有验收场景迁到 wire 口径（现全部引用 `env:harness/sessions/*.jsonl`）。
> - **3.6 / 3.7**：`scripts/acceptance/scenarios/105-harness-wire-retention.md` / `106-harness-session-restore.md`。
> - **3.8**：`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
>
> **同批 delta 措辞改准（详见 proposal 的节点 2 记录）**：① 会话边界的删除禁令与 M406 落地的
> 单条删除冲突，改为「不提供完整管理 UI；单条删除入口已存在」；② 「历史会话列举」scenario 的
> 「除『新建会话』外」随 M406 退场改写；③ 上下文用量的 ⓘ 钮形态改为 hover 浮层（living spec
> 既有漂移一并改准）。任务 2.3 的原文写作「在『新建会话』外列出…只列不管理」，其「新建项退场」
> 与「单条删除」两处后置变化已在上述两处改准中记录。

## 1. 留存结构改造

- [x] 1.1 `JsonlWriter` 改造为会话文件布局：`<config_dir>/harness/sessions/<session_id>.jsonl`（session_id = `s<unix_millis>-<6 位随机 base36>`），首行恒为 `session_open`；旧 vault 聚合文件不再续写（无迁移，M309 先例）
- [x] 1.2 `assemble_system`（`src-tauri/src/harness/context.rs`）改为返回 `{text, manifest}` 结构化装配结果；三处装配点（会话建立 / 「新会话」重置 / 自动压缩）各落一条 `session_open`，含 system 全文、provider / 模型 / 思考档位、`assembly` 清单（每来源路径 + exists + 字节数）、`opened_from`（new / reset / compact，compact 带摘要）；`opened_from` 第四值 `restore` 的 `session_open` 见 2.2（沿用源 system 与 assembly，不重新装配）
- [x] 1.3 发送点落 `llm_request`（完整请求体：provider / model / system / messages / params），响应点落 `llm_response`（正文 / `reasoning` 回放项 / `thinking` 展示文本 / tool_calls / usage / error / mock_fixture）；覆盖工具循环每次迭代与压缩调用；记录点与发送点同点，无二次序列化
- [x] 1.4 思考落盘（裁决点 1 已裁：落）：`llm_response` 双字段——`reasoning`（回放项，provider 方言逐字节原样）+ `thinking`（展示文本）；回放项供恢复回填末尾响应
- [x] 1.5 sidecar 记录收口：保留 `approval` / `turn_aborted` / `llm_error` / `loop_max_reached`；废弃被 wire 覆盖或失去意义的 11 类事件 kind（含 `tool_denied`——deny 回送的 tool result 带 `permission_denied` 错误码，随历史进下一条 `llm_request.messages`）
- [x] 1.6 记录失败不阻断对话的既有纪律保持（IO / 序列化失败只打 stderr）

## 2. 最小恢复（本期纳入，Alex 裁决点 5）

- [x] 2.1 会话列举：扫 `sessions/*.jsonl`，按 `session_open.vault_root` 过滤当前 vault、按 session_id 时间序倒序、会话名取首条用户消息截断约 20 字；经命令层（`harness.rs` + `ipc.ts`）暴露给面板
- [x] 2.2 恢复命令：读选中文件最后一条 `llm_request`，以 `system` + `messages` 原样重建 `Session`（**不重新装配**系统上下文）；折叠末尾 `llm_response` 的 assistant 轮（reasoning 回放项 + 正文 + 成组 function_call 项，M360 项序）；开新会话文件（新 session_id，`opened_from=restore` + `restored_from`=源 id），旧文件封闭不动
- [x] 2.3 选择器 UI：标题栏 harness 段会话浮层在「新建会话」外列出本 vault 历史会话（极简选择器，只列不管理）；点击一项即恢复续聊；面板从灌回的 wire 记录重建 transcript；空历史时列表为空
- [x] 2.4 恢复边界：末尾响应含未配对工具调用时按原样灌回（不伪造输出）；provider / 模型按源会话记录核对（跨 provider 方言重写不做，见 Non-goals）

## 3. 验证

- [x] 3.1 恢复充分性属性测试（Rust）：mock provider 跑一轮含工具循环对话（含 `<quote>` 消息与 thinking），从 JSONL 独立重建每个请求并与落盘 `llm_request` 断言深度相等；反向验证（手改重建结果必红）
- [x] 3.2 不变量断言：首行 / session_id 一致、请求-响应严格成对、第 i 响应与第 i+1 请求历史逐字节一致、同文件 system 一致
- [x] 3.3 恢复路径测试（Rust，最小恢复落地判据）：mock provider 多轮会话 → 恢复 → 断言新文件 `opened_from=restore` + `restored_from`、重建 system / input 与源一致；恢复后续一轮，断言新 input = 源 input + 新增消息；含末尾响应折叠、悬空工具调用两边界
- [x] 3.4 既有留存测试换代：`jsonl.rs` quote 逐字节用例迁为 wire 口径；旧文件不续写断言
- [x] 3.5 既有验收场景迁移：`scripts/acceptance/scenarios/` 下 15 个引用 `env:harness/*.jsonl` 的场景逐一对账——锚定废弃 kind 的断言（70 / 71 / 72 / 75 / 76 / 82 / 83 / 103 / 104 等）改写为 wire 口径（`llm_request` / `llm_response` 内容断言），保留类（`turn_aborted`，88 / 97 / 104 等）按 sidecar 口径核对
- [x] 3.6 scripts/acceptance 新增 wire 留存场景（mock provider 一轮 + 断言 `sessions/*.jsonl` 首行与请求记录在场），fixture 全部合成
- [x] 3.7 scripts/acceptance 新增恢复场景（选择器列出历史会话、点击恢复续聊、断言恢复后新会话文件 `opened_from=restore`），fixture 全部合成
- [x] 3.8 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
