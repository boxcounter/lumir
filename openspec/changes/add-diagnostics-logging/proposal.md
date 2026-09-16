# Proposal: 运行时诊断日志——结构化事件落盘，给 agent 一双眼睛

- Change ID: add-diagnostics-logging
- 日期: 2026-09-16
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

AI-only 模式下（[ADR 0004](../../../docs/adr/0004-development-and-openness-strategy.md)）CI 门禁覆盖了「合入前」，但运行时对 agent 是全黑的：`src-tauri` 无任何日志依赖（Cargo.toml 无 tracing/log），`ConfigSnapshot.warnings` 只进 console 无出口（backlog，M132 finding），偶发缺陷「编辑区全空白」因复现条件未锁定两批未立项（backlog「未复现」）。

dogfood 阶段（ADR 0006 转向）的决策输入是 friction log，其中「哪里卡住」的一半（崩溃恢复触发、保存冲突频发、渲染失败、性能毛刺）是机器可记录的事件，目前全靠 Alex 人肉回忆与转述。本 change 让这些事件以机器可读形式落盘，agent 会话可直接读取定位，Alex 只需记录「想回外部工具」的动机部分。

## What Changes

新增一个 capability：`diagnostics`。

1. **结构化事件日志落盘**（`diagnostics`）：关键运行时事件以 JSONL（每行一个 JSON 对象）写入 `<config_dir>/logs/` 按日滚动文件（`YYYY-MM-DD.jsonl`）。每条事件含 `ts`（ISO 8601）、`level`、`event` 与诊断字段（vault 相对路径、错误码、耗时等）。v0 事件集：`save_conflict` / `save_external_change` / `autosave_paused` / `autosave_resumed` / `recovery_written` / `recovery_restored` / `render_error`（mermaid/katex）/ `config_warning` / `slow_callback`（超 16ms 预算的后台回调采样）。
2. **非阻塞写入**：日志写不在 keypress-to-paint 路径上引入同步文件 IO（ADR 0002 §6 性能合同），缓冲批量落盘；门禁验证以 perf.yml 相对回归不退化为准。
3. **滚动与体积治理**：单文件上限 5MB、保留最近 7 天（先到为准），超限惰性删除——复用注册表 ghost tmp 治理的惰性删除模式（只在写入跃迁时触发清理，幂等）。
4. **`[log]` 配置表**：`~/.config/lumir/` config.toml 加 `[log]` 表，`level = "info" | "off"`，默认 `info`（dogfood 期需要数据）；配置即数据带 schema 校验（ADR 0002 §5），非法值走既有 warning 语义不崩。
5. **前端事件统一转发**：前端关键事件（渲染失败、autosave 状态跃迁、config warnings 等）经单一 invoke 命令转发 Rust 侧统一落盘；前端不自行写文件。

**裁决点 1——默认开关**（推荐值：`info` 默认开）：dogfood 期的数据价值依赖默认开；隐私代价低（事件不含文档正文、永不外发）。备选：`off` 默认开——dogfood 数据大概率残缺。**（2026-09-16 Alex 裁决：按推荐值定稿）**

**裁决点 2——保留期**（推荐值：7 天或 10 个文件先到为准，单文件 5MB 上限）：覆盖一个 dogfood 周期足够。备选：30 天——磁盘与噪音增加，价值不明显。**（2026-09-16 Alex 裁决：按推荐值定稿）**

## Non-goals

- 无遥测/上报/任何网络外发——日志只落本地，读日志的是本地 agent。
- 不做 UI 日志查看器（agent 读文件即可；`config_warning` 的 UI 出口属 UX 重做阶段的独立条目，见 backlog）。
- 不做 metrics dashboard / 聚合分析。
- 日志不写入 vault 内任何位置（ADR 0003 §3 铁律——只写 `<config_dir>/logs/`）。
- 不记录文档正文、键入内容等隐私数据。

## Impact

- 影响的 specs：新增 capability `diagnostics`。
- 影响的代码/系统：Rust core 新增 logging 模块（缓冲写 + 惰性清理）与单一 `log_event` invoke 命令；前端在既有事件点（保存冲突、autosave 跃迁、渲染失败、config warnings、慢回调采样）加转发调用。
- 关联约束：ADR 0002 §5（配置即数据）、ADR 0002 §6（性能合同——keypress-to-paint 路径零同步 IO）、ADR 0003 §3（永不改写 vault 文件）。
