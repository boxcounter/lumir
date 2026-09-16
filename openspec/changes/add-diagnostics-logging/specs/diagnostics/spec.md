# diagnostics 增量

## ADDED Requirements

### Requirement: 结构化事件日志落盘

系统 SHALL 将关键运行时事件以 JSONL（每行一个 JSON 对象）写入 `<config_dir>/logs/` 下的按日滚动文件（`YYYY-MM-DD.jsonl`，日期取 UTC——Rust core 无本地时区来源，单一时区口径无歧义）。每条事件 MUST 含 `ts`（ISO 8601，UTC）、`level`、`event` 字段；事件负载 MUST NOT 包含文档正文或键入内容，仅含事件名、vault 相对路径、错误码、耗时等诊断字段。日志 MUST NOT 写入 vault 内任何位置（ADR 0003 §3），MUST NOT 经网络外发。

#### Scenario: 保存冲突事件落盘

- **GIVEN** 一个已打开的 vault 文档发生保存冲突
- **WHEN** 冲突提示出现
- **THEN** `<config_dir>/logs/` 当日 JSONL 文件新增一行 `event: "save_conflict"`，含该文档的 vault 相对路径与错误码，不含文档正文

#### Scenario: 崩溃恢复事件落盘

- **GIVEN** 存在一份崩溃备份
- **WHEN** 用户选择「恢复内容」并完成恢复
- **THEN** 当日 JSONL 文件出现 `recovery_restored` 事件，含 vault 相对路径

### Requirement: 非阻塞写入

日志写入 MUST NOT 在 keypress-to-paint 路径上引入同步文件 IO（ADR 0002 §6）。实现 SHALL 采用缓冲批量落盘。

#### Scenario: 性能门禁不退化

- **WHEN** CI 执行 perf.yml 相对回归测量
- **THEN** keypress-to-paint 与冷启动相对滚动基线的回退不超容忍线（口径以 docs/specs/perf-measurement.md 为准）

### Requirement: 滚动与体积治理

日志文件 SHALL 受体积与保留期双重约束：单文件超 5MB 或超出保留期（最近 7 天，先到为准）时惰性删除，清理只在写入跃迁时触发且幂等。

#### Scenario: 超期日志清理

- **GIVEN** `logs/` 下存在 8 天前的日志文件
- **WHEN** 下一次事件写入发生
- **THEN** 超期文件被删除，当日文件不受影响

### Requirement: log 配置表

`~/.config/lumir/config.json` SHALL 支持 `log` 表（`{"log": {"level": "info"}}`），`level` 合法值为 `"info"`（默认）与 `"off"`；`off` 时事件丢弃不写盘。非法值 MUST 走既有 config warning 语义，不得导致启动失败（ADR 0002 §5）。配置格式随现状（config.rs 的「JSON 而非 TOML」选型），本 change 不做格式迁移。

#### Scenario: 关闭日志

- **GIVEN** config.json 含 `"log": {"level": "off"}`
- **WHEN** 发生保存冲突
- **THEN** `logs/` 不产生新事件行，应用行为不受影响

### Requirement: 前端事件统一转发

前端关键事件 SHALL 经单一 invoke 命令（`log_event`）转发至 Rust 侧统一落盘；前端 MUST NOT 自行写日志文件。invoke 入口 SHALL 校验事件名与字段白名单，拒绝白名单外的负载。

#### Scenario: 渲染失败转发

- **GIVEN** 一个 mermaid 代码块渲染失败
- **WHEN** 前端渲染器捕获失败
- **THEN** 当日 JSONL 文件出现 `render_error` 事件，`kind: "mermaid"`，含错误码不含块内容
