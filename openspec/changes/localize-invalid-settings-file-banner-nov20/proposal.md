# Proposal: 设置面板的配置文件状态横幅按 code 本地化

- Change ID: `localize-invalid-settings-file-banner-nov20`
- 日期: 2026-11-20
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> **来源与授权**
>
> - M865 收口时登记在 `docs/backlog.md` 的 `#fix` 条目：设置面板顶部横幅在
>   `SettingsFileState::Invalid` 时**直出 Rust 中文 message**，且 message 里带
>   `format!` 的内部错误串（`os error 13` / `expected value at line …`）。en 界面露中文，
>   还可能把 os / parser 内部串送上屏。
> - M865 只覆盖了 `ConfigDiagnostic` 与 `SettingsFieldError` 两条信封；文件状态信封
>   `SettingsFileState::Invalid{message, line, column}` 没有 `code`，不在任何文案门禁的扫描面内。
> - Alex 在 M865 收口时授权「主动修复类似不清晰 / 不友好问题」。本 change 按 M865 的既定口径
>   收口第三条出口，不另造文案系统（复用 `ERROR_COPY` / `errorText` / deck 与文本扫描门禁）。

## Why

设置面有三条错误 / 诊断信封，前两条已在 M852 / M858 / M865 收进文案表：

1. `SettingsFieldError`（保存被拒的字段错误）——`mapFieldErrors` → `errorText`，已覆盖；
2. `ConfigDiagnostic{code, path, message}`（装载期配置诊断）——三处渲染口 → `errorText`，已覆盖；
3. **`SettingsFileState::Invalid`**（配置文件无法读取 / 不是合法 JSON / 顶层非对象 / 结构不符）——
   `settings-panel.ts` 的 `renderBanner` 直接拼 `snapshot.file.message`，未覆盖。

后果：en 界面下，打开设置面板时顶部横幅是中文；`message` 里还带着 `Permission denied (os error 13)`、
serde 的 `expected value at line 3 column 8` 这类内部串——用户既读不懂，也不是可行动信息。

## What Changes

1. **Rust 协议补稳定 code**：`SettingsFileState::Invalid` 增加 `code`，取值复用 `config.rs` 的
   `failed_snapshot` 既有三个码——`config_read_failed` / `config_invalid_json` /
   `config_invalid_structure`（同一类装载失败在 console 诊断与设置横幅上是同一个 code，
   单一来源）。`message` 保留为诊断日志内容与未知 code 的兜底；`line` / `column` 保留。
   四个真实构造点（读失败 / JSON 非法 / 顶层非对象 / `validate_value` 整文件回落）统一走
   `invalid_file(...)` 一个出口。顶层非对象与字段类型不符同归 `config_invalid_structure`
   （`config.rs` 的 `RawConfig` 解析本就把两者归为同一类），文案写一条覆盖两类情形的句子。
2. **前端按 code 上屏**：新增纯函数 `fileInvalidReason()` / `fileInvalidBody()`，经唯一的
   `errorText` 取值口读 `ERROR_COPY`；有行号时套 D850（行号是结构化读数）。未知 code 回落
   `message`（不显示空白、裸 code 或别的 code 的文案）。`message` 中内部串在 code 已知时
   MUST NOT 上屏。
3. **文案**：`ERROR_COPY` 收三个 code，deck 取号 D940–D942（中英双列、无占位、可行动）；
   D849 标题从「config.json 无法解析」改中性「配置文件无法载入」（读失败不再是「解析」问题）；
   D850 的占位 `{message}` 改 `{reason}`——它承接的是本地化原因句，不是后端 message。
4. **门禁**：`tests/unit/error-text.test.ts` 新增第五条扫描通道（`invalid_file("code", …)`），
   三个码从 `LOG_ONLY_DIAGNOSTIC_CODES` 豁免表转正为 `ERROR_COPY` 条目；保留反向判据
   （豁免项必须真实存在、不得与覆盖并存、扫描量下限）。
5. **测试**：Rust 四个变体各断言 code / message 不被吞 / line·column 保留；前端单测覆盖
   zh / en 两档、可行动方向、内部串不上屏、未知 code 回落；视觉场景补 zh（带行号）与
   en（读失败）两条**结构 / 文本**断言（不新增像素基线）。

## 非目标

- **不改读取 / 校验 / 保存行为**：`snapshot_at` / `apply_at` / `validate_value` 的判定与写盘
  零改动；只加 code 与展示层取值。
- **不改 `ConfigDiagnostic` 的 params 通道**：两个信封仍是「没有参数的 code + message」
  形态，模板不带占位。
- **不改 D851 的既有表述**（「生效的是默认配置」）：那是 M865 的既有口径，本 change 不动。
- **不重录像素基线**：新增视觉用例只做文本 / 结构断言；现有没有任何场景渲染文件状态横幅，
  基线不受影响（若实测有变化，交 Alex 过目后再更新）。

## Impact

- 用户可见：en 界面横幅变英文；zh 界面由 Rust 格式化句改为 code 级覆盖句（内部串与读数
  从句子移到标题 / 行号 / 路径），这是有意的措辞收敛。
- 门禁：error-text 的扫描面扩大；新增文件状态 code 未进表即红。
- 行为：读取失败与解析失败仍是只读横幅 + 保存禁用，字段暂存行为不变。
