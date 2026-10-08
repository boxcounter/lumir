# Tasks: reshape-harness-session-recording

## 1. 留存结构改造

- [ ] 1.1 `JsonlWriter` 改造为会话文件布局：`<config_dir>/harness/sessions/<session_id>.jsonl`（session_id = `s<unix_millis>-<6 位随机 base36>`），首行恒为 `session_open`；旧 vault 聚合文件不再续写（无迁移，M309 先例）
- [ ] 1.2 `assemble_system`（`src-tauri/src/harness/context.rs`）改为返回 `{text, manifest}` 结构化装配结果；三处装配点（会话建立 / 「新会话」重置 / 自动压缩）各落一条 `session_open`，含 system 全文、provider / 模型 / 思考档位、`assembly` 清单（每来源路径 + exists + 字节数）、`opened_from`（new / reset / compact，compact 带摘要）
- [ ] 1.3 发送点落 `llm_request`（完整请求体：provider / model / system / messages / params），响应点落 `llm_response`（正文 / thinking / tool_calls / usage / error / mock_fixture）；覆盖工具循环每次迭代与压缩调用；记录点与发送点同点，无二次序列化
- [ ] 1.4 思考文本落盘（裁决点 1，默认落：进 `llm_response.thinking` 与后续请求历史；Alex 否决则移除该字段）
- [ ] 1.5 sidecar 记录收口：保留 `approval` / `turn_aborted` / `llm_error` / `loop_max_reached`；废弃被 wire 覆盖的 10 类事件 kind
- [ ] 1.6 记录失败不阻断对话的既有纪律保持（IO / 序列化失败只打 stderr）

## 2. 验证

- [ ] 2.1 恢复充分性属性测试（Rust）：mock provider 跑一轮含工具循环对话（含 `<quote>` 消息与 thinking），从 JSONL 独立重建每个请求并与落盘 `llm_request` 断言深度相等；反向验证（手改重建结果必红）
- [ ] 2.2 不变量断言：首行 / session_id 一致、请求-响应严格成对、第 i 响应与第 i+1 请求历史逐字节一致、同文件 system 一致
- [ ] 2.3 既有留存测试换代：`jsonl.rs` quote 逐字节用例迁为 wire 口径；旧文件不续写断言
- [ ] 2.4 scripts/acceptance 新增 wire 留存场景（mock provider 一轮 + 断言 `sessions/*.jsonl` 首行与请求记录在场），fixture 全部合成
- [ ] 2.5 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
