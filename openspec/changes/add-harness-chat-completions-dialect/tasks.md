# Tasks: add-harness-chat-completions-dialect

## 1. 配置 schema

- [x] 1.1 `HarnessProviderConfig` 增加可选键 `wire_api`（闭集合 `responses` / `chat_completions`，缺省 `responses`；非法值回落默认 + 人话 warning；类型不符走既有整文件回落模板）
- [x] 1.2 kimi 接受两档；deepseek 配 `chat_completions` 时给 warning 并回落 `responses`；mock 无此键
- [x] 1.3 ts-rs 重导出 `src/bindings/**`，先 `git add` 重导出产物再跑门禁（bindings-drift 纪律）
- [x] 1.4 单测：缺省 / 两档合法值 / 非法值回落 + warning / deepseek 配 chat 档的回落

## 2. ChatCompletionsClient

- [x] 2.1 实现 `LlmClient`：`POST {base}/chat/completions`；items → messages 翻译在发送边界单一构造点（`wire_body` / `wire_body_bytes` 共用构造，纪律同 Responses 侧 M463）
- [x] 2.2 翻译表按 design D4 全覆盖：system / user / assistant / reasoning 折叠进 `reasoning_content` / function_call 组 → 单条 `tool_calls` 消息 / function_call_output → 紧随 tool 消息 / `input_image` → `image_url` part / 悬空 function_call 丢弃 + 诊断落盘
- [x] 2.3 思考档位：`thinking:{type:"enabled", effort, keep:"all"}`，仅 `effort_supported` 时发送
- [x] 2.4 chat SSE 解析：content / reasoning_content delta、tool_calls 累积、`stream_options:{include_usage:true}` 的 usage 帧；在途停止保留已产出（与 Responses 侧同语义）
- [x] 2.5 usage 映射按 design D6（`prompt_tokens`→`input_tokens`；cached 两种字段布局兜底；`cache_write_tokens` 记 0；`completion_tokens`→`output_tokens`）
- [x] 2.6 错误路径复用 `http_error_turn_error`（http_status / raw_body 截断 / request_id），不做方言特判
- [x] 2.7 单测钉死 2.2–2.6 全部行为（纯函数层，不起 HTTP）

## 3. 超限特征串

- [x] 3.1 kimi 预设 `overflow_indicators` 增补 `total message size` 与 `supports only 256k context`
- [x] 3.2 单测：chat 方言三条文案均判 `context_overflow`；Responses 既有文案回归不破

## 4. 留存与恢复

- [x] 4.1 `session_open` 增记 `wire_api`；`llm_request` / `llm_response` 形态不变（request_bytes 语义不变——方言各自的实际发送体字节数）
- [x] 4.2 跨方言恢复测试：Responses 时期留存的会话灌回后，chat 客户端翻译输出逐字段正确（纯函数断言）
- [x] 4.3 恢复充分性判据（仅凭 JSONL 逐字节重建请求）在两种方言下各自成立

## 5. spec 与文档

- [x] 5.1 本 change 的 spec 增量落准（配置节 [harness] / Chat Completions 方言（新增）/ 会话本地留存 / 上下文用量显示与触顶处理的已知边界注收口）
- [x] 5.2 `docs/specs/config-reference.md` 的 [harness] 节补 `wire_api` 键说明
- [x] 5.3 `docs/backlog.md`「harness ctx% meter 的分母口径」条收口改写：主问题（分母有效性）由本 change 解决；「错误轮 meter 是否同步读数」子问题保留为独立待裁行

## 6. 验证

- [x] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 6.2 `cargo test` 与 `pnpm test` 全绿；`scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行口径报告）
- [x] 6.3 回扫真机验收套件与 wire 相关的断言 / fixture（含 M548 reasoning 回放面）：确认 mock 层零改动；发现泄漏到验收层的 wire 形状断言随本 PR 改准。**回扫结论**：零改动——验收断言的对象是 mock 驱动的 `llm_request` / `llm_response` 与 `session_open` 子串（场景 105/106/123/148 等），不受 `wire_api` 键影响；mock provider 没有该键，wire 翻译层不参与验收层
- [x] 6.4 真 API 冒烟探针（**需 Alex 授权配额**，合成内容，design §4 的 S1–S3）：钉死 coding chat 端点的 usage 字段名 / SSE 形态、reasoning_content 回放接受性、~42 万字节体量是否放行；结果落 `test-results/`（git 外）。**实测**：S1 / S1b / S2a / S2b / S3 全 200（含 421,213 B 请求体）；证据 `test-results/m562-probes-2026-10-18/`
- [x] 6.5 Alex 的 `config.json` 加 `wire_api = "chat_completions"`（已备份为 `~/.config/lumir/config.json.bak-20261018-wireapi`，只增一键）。**改完即停**（mission 口径）：真机 dogfood（多轮对话 + 工具循环 + 85% 预警 / 自动压缩 + meter 越过 40% 区间）归 Alex 手跑
