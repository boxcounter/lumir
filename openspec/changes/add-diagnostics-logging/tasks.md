# Tasks: add-diagnostics-logging

## 1. Rust core：日志模块

- [ ] 1.1 `src-tauri/src/logging.rs`：JSONL 事件写入 `<config_dir>/logs/YYYY-MM-DD.jsonl`；事件字段 `ts`（ISO 8601）/ `level` / `event` / 诊断字段；缓冲批量落盘，写入路径不在 UI 关键路径上做同步 IO
- [ ] 1.2 滚动治理：单文件 5MB 上限、保留最近 7 天（先到为准），超限惰性删除（只在写入跃迁时触发，幂等）
- [ ] 1.3 `log_event` invoke 命令（前端事件统一入口，校验 event 名与字段白名单，拒绝正文级负载）
- [ ] 1.4 单元测试：事件写入格式、滚动清理、白名单拒绝、缓冲 flush

## 2. 配置

- [ ] 2.1 config.toml `[log]` 表：`level = "info" | "off"`，默认 `info`；schema 校验 + 非法值 warning（复用既有 config warning 语义），`off` 时事件丢弃不写盘

## 3. 事件埋点（v0 事件集）

- [ ] 3.1 Rust 侧：`save_conflict` / `save_external_change` / `recovery_written` / `recovery_restored`（挂在 save/recovery 既有事件点）
- [ ] 3.2 前端转发：渲染失败（mermaid/katex）、autosave 状态跃迁（`autosave_paused` / `autosave_resumed`）、`config_warning`、`slow_callback`（>16ms 后台回调采样）

## 4. 验证

- [ ] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 4.2 `scripts/gate.sh all` 全绿（性能相对回归不退化 = 非阻塞写入的门禁验证）
- [ ] 4.3 桌面复验：触发一次保存冲突与一次崩溃恢复，`logs/` 当日文件出现对应事件行且不含文档正文
