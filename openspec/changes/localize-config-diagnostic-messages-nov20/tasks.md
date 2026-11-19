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
      未执行 `--update`（r1 复跑结果见 §5.4）

## 4. 文档与收尾

- [x] 4.1 `文案-Copy.md`：D899–D927 行 + 编号沿革 + 消费点 + 当前末位
- [x] 4.2 `docs/backlog.md` 登记本 change 不覆盖的剩余缺口（`SettingsFileState::Invalid`
      横幅无 code；`harness.subagents` 整节等 log-only 诊断不上设置面板）
- [x] 4.3 非目标核对：Rust 一行未改；未启动真机；未改无关设置行为（保存 / 校验 / 路由零改动）

## 5. r1 返修（review P1-1 / P2-1）

- [x] 5.1 **P1-1 多构造点文案按分支核对**：逐个 code 重读 Rust 全部构造点，修正 11 条说错后果的
      文案——D899/D900（没有可用 provider 时保持未配置）、D904（非字符串 / 闭集合外 / mock+非 mock
      id 三成因）、D905（`migrate_provider_presets` 只给 id 为 kimi/deepseek/mock 的条目补同名预设，
      不是「补为 generic」）、D908（非字符串 → 整条 provider 忽略；取值非法 → 回退默认协议）、D922
      （退役值改写目标是 models 清单首项，不是「等价模型」）、D925（会话命名回落 vs 图片命名原样保留
      并跳过、含「未声明 vision」成因）、D928（非字符串 id）、D934（wire_api 非字符串分支）、D936
      （删除键只对自带官方地址的预设成立，generic 没有）、D938（mock 与 id 的组合出口）；其余 code 的
      分支复核对账见设计 D7
- [x] 5.2 **分支语义测试（不是 CJK / 关键词判绿）**：`tests/unit/first-run-error-copy.test.ts`
      新增 6 条按分支断言的用例——session/attachment 命名两档结局（含 mustNot：图片命名不得写成
      回落）、wire_api 字符串/非字符串两分支、无可用 provider 落点、base_url 删除键条件、mock/id
      组合出口、模型 id 非字符串分支；同一 code 的多条现场 message 必须得到同一句覆盖文案
- [x] 5.3 **P2-1 无占位门禁按信封分列**：`tests/unit/error-text.test.ts` 的占位判据拆成字段错误档
      （`FIELD_ERROR_COPY ?? ERROR_COPY`）与装载期诊断档（一律 `ERROR_COPY`，含 12 个双信封 code
      的诊断侧）+ 事件档；反向：三类条目数下限、12 个双信封诊断必须被分列检查、mutant
      `{ mutant_loading_diagnostic: "D174" }` 必须报红；另做过真实表负向验证（给 D908 加占位 →
      「装载期诊断模板 MUST NOT 带占位」转红，恢复后转绿）
- [x] 5.4 复跑：`pnpm test` 1670 tests / 1668 pass / 0 fail / 2 todo（既有 known-defect 标记）；
      `scripts/gate.sh quick`（cargo 锁内、`/tmp/lumir-m865-target`、端口 4401）：
      `GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0。visual 按 tower 排期等 M859 槽位释放后复跑；
      09-validation-error 基线仍未更新（待 Alex 过目）
