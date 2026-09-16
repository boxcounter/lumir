# Tasks: add-diagnostics-logging

> 实现注记（M134）：本 change 落地时发现制品把配置文件写成 `config.toml`，仓库现状是
> `config.json`（config.rs 的「JSON 而非 TOML」选型，M132 起生效），已按现状实现并更正
> proposal / spec / 本文件的文字（tower 2026-09-16 裁决：按 config.json + 更正制品文字）。
> 另一处分组调整：`save_external_change` 落在前端转发而非 Rust 侧——「命中打开中的文档
> 且不是自身保存」的判据依赖前端持有的 displayedPath / revision，Rust 的 watch 流只有
> 全 vault 变更（记全量会淹没信号）。详见 3.1。

## 1. Rust core：日志模块

- [x] 1.1 `src-tauri/src/logging.rs`：JSONL 事件写入 `<config_dir>/logs/YYYY-MM-DD.jsonl`（日期取 UTC）；事件字段 `ts`（ISO 8601，UTC）/ `level` / `event` / 诊断字段；缓冲批量落盘（调用线程只做校验 + 通道发送，落盘在 `lumir-log` 写线程按批做，静默期 200ms / 单批 256 条），写入路径不在 UI 关键路径上做同步 IO
- [x] 1.2 滚动治理：单文件 5MB 上限（追加会越限即删档重开）、保留最近 7 天 / 最多 10 个文件（先到为准），超限惰性删除（只在写入跃迁时触发，幂等）
- [x] 1.3 `log_event` invoke 命令（前端事件统一入口；事件名 = `LogEventName` 枚举，字段名逐事件白名单 + 值长 256 字符上限，白名单外负载返回 `log_event_rejected` 且不落盘）
- [x] 1.4 单元测试：事件写入格式、滚动清理（超期 / 保留窗口边界 / 文件数上限 / 单文件越限）、白名单拒绝（未知字段 / 正文级 message / 超长值 / 保留字段）、缓冲 flush（flush 前不落盘、flush 后整批在盘）

## 2. 配置

- [x] 2.1 config.json `log` 表：`{"log": {"level": "info" | "off"}}`，默认 `info`；schema 校验 + 非法值 warning（复用既有 config warning 语义，错形状只丢该表），`off` 时事件丢弃不写盘（连 logs 目录都不创建）

## 3. 事件埋点（v0 事件集）

- [x] 3.1 Rust 侧：`save_conflict`（`document_save` 的 CAS 失败点）/ `recovery_written`（`recovery_backup` 成功）/ `recovery_restored`（`recovery_load` 读到备份——恢复链路在 Rust 侧唯一的可观测点）；`save_external_change` 由前端转发（见上方注记）
- [x] 3.2 前端转发：渲染失败（mermaid / katex，只记分类错误码——原始错误文本含文档片段）、autosave 状态跃迁（`autosave_paused` / `autosave_resumed`，只在暂停集合跃迁时记）、`config_warning`（config 与 [keys] 两处 warning 各落一份）、`slow_callback`（>16ms 后台回调采样：fs_entry_changed / mermaid_settle）、`save_external_change`

## 4. 验证

- [x] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 4.2 `scripts/gate.sh all` 全绿（性能相对回归不退化 = 非阻塞写入的门禁验证）
- [x] 4.3 桌面复验：触发一次保存冲突与一次崩溃恢复，`logs/` 当日文件出现对应事件行且不含文档正文（隔离 XDG 与 vault；实测事件序列见 commit message / review-request）
