# Tasks: localize-config-diagnostic-messages-nov20

> 任务与 M865 的 mission tasks 一一对应；勾选项对应实现批的完成状态。证据：单测命令与
> 视觉套件的日志落在 `.local/missions/M865/`（git 外）。

## 1. 合同与枚举

- [x] 1.1 读 REVIEW.md 与 M858 finding，枚举 `ConfigDiagnostic` 的真实构造点：`sink.warn` /
      `sink.warn_at`（`config.rs` 的 `DiagnosticSink` 唯一出口）、`failed_snapshot(path, code, …)`
      与 4 处 `ConfigDiagnostic { code: "…" }` 字面量；模型 notes 的消费者是
      `settings-panel.ts` 的 `renderModelTable`（数据来自 `ModelDraft.diagnostics`）
- [x] 1.2 分类：81 处构造点 / 56 个 code；**设置快照可达 29 个**（`settings.rs` 的
      `in_settings_scope` 放行 `harness.provider*`、naming、`harness.subagents.enabled` 与文件级
      诊断），其余 27 个只进 console / 诊断日志（`i18n-exempt: log`）
- [x] 1.3 定义合同：诊断按 `code` 走 `ERROR_COPY` + `errorText`；path 只承担读数与模型行归属
      （不做第二套校验）；未知 code / 缺参回落 `message`；模板不带占位、不插配置值与内部错误串

## 2. 实现

- [x] 2.1 `src/copy-data.ts`：`ERROR_COPY` 增收 29 个诊断 code，deck 取号 D899–D927（中英双列、
      无占位；同一 code 多模板时取覆盖式句子）；同 12 个 RejectOnWrite code 的**保存被拒**档进
      `FIELD_ERROR_COPY`（D928–D939）——`settings.rs` 的 `plan_and_apply` 把它们转成
      `field_error(path, diagnostic.code, …)`，「装载期已忽略」的措辞在保存现场不成立
- [x] 2.2 `src/settings-panel.ts` 三处直出 message 的渲染口统一改走 `errorText`：
      `fillDiagnostics`、被忽略 provider 的条目诊断、模型行 notes
- [x] 2.3 新增纯函数 `localizeModelNotes(snapshot, providerId, index, notes)`：按
      `harness.providers.<id>.models[<i>]`（含后代）从同一快照取回 code；条数对不上整行回落原
      message（与 Rust `model_drafts` 的归属规则同源，不改 Rust 协议）

## 3. 门禁与测试

- [x] 3.1 `tests/unit/error-text.test.ts` 加第四条扫描通道（`sink.warn` / `sink.warn_at` /
      `failed_snapshot` / `ConfigDiagnostic{code}` 字面量）+ `LOG_ONLY_DIAGNOSTIC_CODES` 豁免表
      + 三条反向判据（豁免必须真实存在、不得与 `ERROR_COPY` 重叠、扫描量阈值）
- [x] 3.2 单测：诊断 6 个代表 code 的 en / zh 双档、可行动方向、不插读数
      （`tests/unit/first-run-error-copy.test.ts`）；`localizeModelNotes` 的对齐 / 回落 / 未知
      code 兜底与 path 路由（`tests/unit/settings-panel.test.ts`）；诊断条目的双语两档
      （`tests/unit/error-text.test.ts`）
- [x] 3.3 视觉场景：`m734-settings-panel` 的被忽略 provider 诊断改用 deck 文案断言；
      `first-run-error-copy` 新增设置面板诊断的 en / zh 两档渲染（该文件在 `webkit-realua`
      工程里，双引擎各跑一次）
- [x] 3.4 完整 `scripts/gate.sh quick` 全绿（13/13 PASS，SKIP 0）；`scripts/gate.sh visual`（端口 4401）
      结构断言全绿，**唯一**差异是 `m734-settings-panel` 的 `09-validation-error` 像素基线
      （重复 id 的字段错误文案换表，1010 px）——按「基线更新是人肉裁决点」交 Alex 过目，
      未执行 `--update`

## 4. 文档与收尾

- [x] 4.1 `文案-Copy.md`：D899–D927 行 + 编号沿革 + 消费点 + 当前末位
- [x] 4.2 `docs/backlog.md` 登记本 change 不覆盖的剩余缺口（`SettingsFileState::Invalid`
      横幅无 code；`harness.subagents` 整节等 log-only 诊断不上设置面板）
- [x] 4.3 非目标核对：Rust 一行未改；未启动真机；未改无关设置行为（保存 / 校验 / 路由零改动）
