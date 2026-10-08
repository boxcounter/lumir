# Tasks: reshape-harness-session-recording

## 1. 留存结构改造

- [ ] 1.1 `JsonlWriter` 改造为会话文件布局：`<config_dir>/harness/sessions/<session_id>.jsonl`（session_id = `s<unix_millis>-<6 位随机 base36>`），首行恒为 `session_open`；旧 vault 聚合文件不再续写（无迁移，M309 先例）
- [ ] 1.2 `assemble_system`（`src-tauri/src/harness/context.rs`）改为返回 `{text, manifest}` 结构化装配结果；三处装配点（会话建立 / 「新会话」重置 / 自动压缩）各落一条 `session_open`，含 system 全文、provider / 模型 / 思考档位、`assembly` 清单（每来源路径 + exists + 字节数）、`opened_from`（new / reset / compact，compact 带摘要）；`opened_from` 第四值 `restore` 的 `session_open` 见 2.2（沿用源 system 与 assembly，不重新装配）
- [ ] 1.3 发送点落 `llm_request`（完整请求体：provider / model / system / messages / params），响应点落 `llm_response`（正文 / `reasoning` 回放项 / `thinking` 展示文本 / tool_calls / usage / error / mock_fixture）；覆盖工具循环每次迭代与压缩调用；记录点与发送点同点，无二次序列化
- [ ] 1.4 思考落盘（裁决点 1 已裁：落）：`llm_response` 双字段——`reasoning`（回放项，provider 方言逐字节原样）+ `thinking`（展示文本）；回放项供恢复回填末尾响应
- [ ] 1.5 sidecar 记录收口：保留 `approval` / `turn_aborted` / `llm_error` / `loop_max_reached`；废弃被 wire 覆盖或失去意义的 11 类事件 kind（含 `tool_denied`——deny 回送的 tool result 带 `permission_denied` 错误码，随历史进下一条 `llm_request.messages`）
- [ ] 1.6 记录失败不阻断对话的既有纪律保持（IO / 序列化失败只打 stderr）

## 2. 最小恢复（本期纳入，Alex 裁决点 5）

- [ ] 2.1 会话列举：扫 `sessions/*.jsonl`，按 `session_open.vault_root` 过滤当前 vault、按 session_id 时间序倒序、会话名取首条用户消息截断约 20 字；经命令层（`harness.rs` + `ipc.ts`）暴露给面板
- [ ] 2.2 恢复命令：读选中文件最后一条 `llm_request`，以 `system` + `messages` 原样重建 `Session`（**不重新装配**系统上下文）；折叠末尾 `llm_response` 的 assistant 轮（reasoning 回放项 + 正文 + 成组 function_call 项，M360 项序）；开新会话文件（新 session_id，`opened_from=restore` + `restored_from`=源 id），旧文件封闭不动
- [ ] 2.3 选择器 UI：标题栏 harness 段会话浮层在「新建会话」外列出本 vault 历史会话（极简选择器，只列不管理）；点击一项即恢复续聊；面板从灌回的 wire 记录重建 transcript；空历史时列表为空
- [ ] 2.4 恢复边界：末尾响应含未配对工具调用时按原样灌回（不伪造输出）；provider / 模型按源会话记录核对（跨 provider 方言重写不做，见 Non-goals）

## 3. 验证

- [ ] 3.1 恢复充分性属性测试（Rust）：mock provider 跑一轮含工具循环对话（含 `<quote>` 消息与 thinking），从 JSONL 独立重建每个请求并与落盘 `llm_request` 断言深度相等；反向验证（手改重建结果必红）
- [ ] 3.2 不变量断言：首行 / session_id 一致、请求-响应严格成对、第 i 响应与第 i+1 请求历史逐字节一致、同文件 system 一致
- [ ] 3.3 恢复路径测试（Rust，最小恢复落地判据）：mock provider 多轮会话 → 恢复 → 断言新文件 `opened_from=restore` + `restored_from`、重建 system / input 与源一致；恢复后续一轮，断言新 input = 源 input + 新增消息；含末尾响应折叠、悬空工具调用两边界
- [ ] 3.4 既有留存测试换代：`jsonl.rs` quote 逐字节用例迁为 wire 口径；旧文件不续写断言
- [ ] 3.5 既有验收场景迁移：`scripts/acceptance/scenarios/` 下 15 个引用 `env:harness/*.jsonl` 的场景逐一对账——锚定废弃 kind 的断言（70 / 71 / 72 / 75 / 76 / 82 / 83 / 103 / 104 等）改写为 wire 口径（`llm_request` / `llm_response` 内容断言），保留类（`turn_aborted`，88 / 97 / 104 等）按 sidecar 口径核对
- [ ] 3.6 scripts/acceptance 新增 wire 留存场景（mock provider 一轮 + 断言 `sessions/*.jsonl` 首行与请求记录在场），fixture 全部合成
- [ ] 3.7 scripts/acceptance 新增恢复场景（选择器列出历史会话、点击恢复续聊、断言恢复后新会话文件 `opened_from=restore`），fixture 全部合成
- [ ] 3.8 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
