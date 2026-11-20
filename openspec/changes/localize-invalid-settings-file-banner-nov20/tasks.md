# Tasks: localize-invalid-settings-file-banner-nov20

> 任务与 M866 的 mission tasks 一一对应；勾选项对应实现批的完成状态。证据：单测 / 门禁日志
> 落在 `.local/missions/M866/`（git 外）。

## 1. 合同与枚举

- [x] 1.1 读 REVIEW.md 与 `src-tauri/src/settings.rs` 的实际构造点：`snapshot_at` 的四个
      `SettingsFileState::Invalid` 分支（读取失败 / JSON 非法 / 顶层非对象 / `validate_value`
      整文件回落）；前端消费者只有 `settings-panel.ts` 的 `renderBanner`（直拼 `message`）
- [x] 1.2 复用 `config.rs` 的 `failed_snapshot` 既有 code（`config_read_failed` /
      `config_invalid_json` / `config_invalid_structure`）——同一类装载失败在 console 诊断与
      设置横幅上是同一个 code（REVIEW.md『同一语义两处真源』）；顶层非对象与字段类型不符同归
      `config_invalid_structure`（`RawConfig` 解析本就把两者归为一类）
- [x] 1.3 定义合同：`Invalid{code, message, line, column}`；`message` 退回诊断日志与未知 code
      兜底，code 已知时 MUST NOT 上屏；行号是结构化读数、由 D850 前缀承担

## 2. 实现

- [x] 2.1 `src-tauri/src/settings.rs`：`SettingsFileState::Invalid` 增加 `code`；四个构造点
      统一走 `invalid_file(code, message, line, column)` 单一出口；`message`（含 os / parser
      内部串）与 `line` / `column` 原样保留在信封里
- [x] 2.2 `src/settings-panel.ts`：新增纯函数 `fileInvalidReason()` / `fileInvalidBody()`，
      经 `errorText` 读 `ERROR_COPY`（未知 code 自动回落 `message`）；`renderBanner` 改用
      `fileInvalidBody`，不再拼接后端 message
- [x] 2.3 `src/copy-data.ts` + `文案-Copy.md`：`ERROR_COPY` 收三个 code（D940–D942，中英双列、
      **无占位**、可行动）；D849 标题改中性「配置文件无法载入」；D850 的占位 `{message}` 改
      `{reason}`
- [x] 2.4 ts-rs 重导出 `src/bindings/SettingsFileState.ts`（随 `cargo test` 生成）并提交

## 3. 门禁与测试

- [x] 3.1 `tests/unit/error-text.test.ts`：新增第五条扫描通道 `invalid_file("code", …)`；
      三个 code 从 `LOG_ONLY_DIAGNOSTIC_CODES` 转正；新增 `uncoveredFile` 覆盖断言、幽灵条目
      反向核对、构造点 / code 数量下限、横幅模板无占位断言
- [x] 3.2 `src-tauri/src/settings.rs` 单测：四个真实变体各一条——JSON 非法（code + line /
      column）、顶层数组（structure）、结构不符（`font_size` 字符串）、读取失败（把
      `config.json` 建成目录造真实 I/O 错误）；每条都断言 message 不被吞
- [x] 3.3 `tests/unit/settings-panel.test.ts`：`fileInvalidReason` / `fileInvalidBody` 的
      zh / en 两档、可行动方向、内部串（`os error 13` / `expected value …`）不上屏、
      行号前缀、无行号形态、未知 code 回落
- [x] 3.4 `tests/visual/scenes/m734-settings-panel.spec.ts`：zh（JSON 非法带行号）与 en
      （读取失败带 os 串）两条结构 / 文本断言，覆盖标题 / 正文 / 路径 / 只读态 / 无内部串；
      **不新增像素基线**（新基线须 Alex 过目）
- [x] 3.5 完整 `scripts/gate.sh quick`：`GATE RESULT: 13/13 PASS（SKIP 0）`、退出码 0；
      `scripts/gate.sh visual`（端口 4403、`/tmp/lumir-m866-target`）：`GATE RESULT: 15/15 PASS
      （SKIP 0）`、退出码 0，像素套件 1274 passed / 4 skipped / 0 failed——**既有基线零变化**
      （新增用例只做文本 / 结构断言，不建基线）。日志：`.local/missions/M866/quick-r2.log`
      与 `visual.log`（git 外）

## 4. 文档与收尾

- [x] 4.1 `docs/backlog.md`：核销 `SettingsFileState::Invalid` 横幅直出 message 的 `#fix`
      条目；在归档跟踪队列登记本 change（80/80 行，`backlog-check` PASS）
- [x] 4.2 非目标核对：未改读取 / 校验 / 保存行为与配置项语义；未起真机；未改像素基线；
      `harness::context` 的 prompt 字节测试失败随快照 WIP 一起被 rebase 排除，最终树上 cargo
      测试全绿
- [x] 4.3 提交后 `TowerComplete` 附逐项对账，等待独立 review
