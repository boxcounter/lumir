# Proposal: 设置面板的装载期配置诊断按 code 本地化

- Change ID: `localize-config-diagnostic-messages-nov20`
- 日期: 2026-11-20
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> **来源与授权**
>
> - M858 finding `.tower/comms/findings/20261120-worker-complete-error-copy-improve-configdiagnostic-rust-message-en.md`：
>   设置面板还有**第三条**错误 / 诊断信封——`ConfigSnapshot.diagnostics` / `SettingsSnapshot.diagnostics`
>   的 `ConfigDiagnostic{code, path, message}`。渲染时直接 `document.createTextNode(entry.message)`，
>   en 界面显示 Rust 中文原文；这些 code 不在 error-text 门禁的扫描面内。
> - Alex 在 M858 收口时授权「主动修复类似不清晰 / 不友好问题」。本 change 覆盖**诊断信封这一类别**，
>   不另造文案系统（复用 `ERROR_COPY` / `errorText` / deck 与 M858 的 `maskRust` 扫描）。
> - 模型行 notes（`ModelDraft.diagnostics`）是同一条缺陷的第二个出口：只有 Rust message、没有 code。

## Why

设置面的诊断有三个出口，前两个已在 M852 / M858 收进文案表，第三个漏了：

1. `SettingsFieldError`（保存被拒的字段错误）——`mapFieldErrors` → `errorText`，已覆盖；
2. 流式 `events::error("<code>", …)`——`harness-panel` 的 `case "error"` → `errorText`，已覆盖；
3. **`ConfigDiagnostic{code, path, message}`**（装载期配置诊断）——`settings-panel.ts` 的
   `fillDiagnostics`、被忽略 provider 的条目诊断、模型行 notes 三处**直出 `message`**，未覆盖。

后果与 M849 / M858 是同一类：en 界面下，保存或打开设置面板时看到的「该模型被忽略 / 命名目标回落 /
provider 被忽略」诊断仍是中文（例如 `配置项 harness.providers.kimi-work.models[0] 的 id "x" 重复，已忽略`）。
模型行 notes 更隐蔽：后端只下发 `Vec<String>`（message），code 只在同一快照的 `diagnostics` 里，
前端没有直接的 code 通道。

另一个缺口是门禁：`tests/unit/error-text.test.ts` 只扫 `CommandError::new` / `field_error` /
`events::error` 三条通道，`sink.warn` / `warn_at` / `failed_snapshot` / `ConfigDiagnostic{…}` 字面量
不在其中——新增诊断 code 不会被任何判据拦住。

## What Changes

1. **`ERROR_COPY` 收设置面可达的诊断 code**（29 个，deck D899–D927）：provider 级 9 条、模型行 13 条、
   命名目标 3 条、配置迁移写回 1 条，以及当前使用项 / preset 迁移等。模板**不带占位**——诊断信封没有
   params 通道，读数由键路径承担（诊断行本来就单独渲染 `path`；模型行 notes 挂在该行下）。同一 code 在
   Rust 侧有多种 message 模板时取一条覆盖该情形的句子（与 M282 的 D6(a) 同口径）。
2. **同一个 code 的两条信封拆档**（12 个 RejectOnWrite code，deck D928–D939）：`settings.rs` 的
   `plan_and_apply` 把阻断级诊断经 `field_error(path, diagnostic.code, …)` 转成保存被拒的字段错误。
   装载期说「已忽略该模型」，保存现场说「改哪里才能保存」——一句话同时承担两种事实是错的，按
   `config_parse_failed` 的 `FIELD_ERROR_COPY` 先例拆出字段错误档（参数面相同、语义相反）。
2. **三处渲染口统一走 `errorText`**：`fillDiagnostics`、被忽略 provider 的条目诊断、模型行 notes。
   未知 code / 缺参回落后端 message（`errorText` 的既有兜底，`MUST NOT` 显示空白或裸 code）。
3. **模型行 notes 的 code 取回**：`localizeModelNotes(snapshot, providerId, index, notes)` 按
   `harness.providers.<id>.models[<i>]` 前缀从同一快照的 `diagnostics` 取 code（与 Rust `model_drafts`
   的归属规则同源）；条数对不上时整行回落原 message——宁可少译，不丢诊断。
4. **error-text 门禁加第四条扫描通道**：`sink.warn` / `sink.warn_at` / `failed_snapshot` /
   `ConfigDiagnostic { code: "…" }` 字面量；设置面可达的 code 必须有双语条目且模板无占位；
   **log-only** 的 code（editor / ui / keys / log / vault / cron / 装载失败三类 / subagents 整节 /
   permission / loop_max / warn_ctx_pct）进显式豁免表，并由「豁免项必须真实存在构造点、不得同时
   进 `ERROR_COPY`」反向对账——不给没有消费者的 code 造文案，也不留静默关掉的门禁。
5. **不改 Rust 协议**：不为诊断补 `params`、不把 message 模板拆成新 code，也不改保存 / 校验行为。
   模板取不到读数（值 / 范围 / 内部错误串）一律不插——`config_migration_write_failed` 的
   `Permission denied (os error 13)` 这类内部串因此不会上屏。

## 非目标

- **不改 `SettingsFileState::Invalid` 的横幅**：它的 message 没有 code（`{message, line, column}`），
  本地化需要 Rust 侧补 code，属另一个 change（登记在 `docs/backlog.md`）。
- **不把 log-only 的诊断拉进设置面板**：`harness.subagents` 整节 / 权限 / 轮次阈值 / editor / ui /
  keys / log / vault / cron 的 warning 仍只进 console 与诊断日志（`i18n-exempt: log` 口径，
  见 `openspec/specs/ui-language/spec.md` 的「不随语言变化的面」）。
- **不改 `ConfigSnapshot.warnings`**：它仍是 `diagnostics.message` 的保序投影，只服务 console /
  诊断日志；本 change 只改设置面板的上屏面。

## Impact

- 用户可见：设置面板的诊断行与模型行 notes 在 en 下变英文；zh 下由 Rust 格式化句变为 code 级覆盖句
  （读数从句子移到诊断行的键路径 / 所在模型行）——**这是有意的措辞收敛**，不是文案回退。
- 门禁：`error-text` 的扫描面扩大；新增诊断 code 未进表即红。
- 行为：保存 / 校验 / 诊断产出零改动（Rust 一行未改）。
