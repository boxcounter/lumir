# Design: localize-config-diagnostic-messages-nov20

本 change 的技术决策与依据。节点 1（提案评审）由 tower 按既有裁决通道处理；以下 D1–D6 是实现口径。

## D1：诊断按 code 走 `ERROR_COPY` + `errorText`，不另造映射

诊断信封与 `CommandError` / `SettingsFieldError` 是「同一语义（后端 code → 前端文案）」的第三条
通道（`openspec/specs/ui-language/spec.md` 的「Rust 侧错误的文案归属」）。既然取值口已经有
`errorText`（含未知 code 回落、缺参回落），新增一张诊断专用表就是同一语义的第二份真源
（REVIEW.md『同一语义两处真源』条），也违背 finding 里「避免为诊断另造文案系统」的约束。

**落法**：29 个设置面可达的 code 直接进 `ERROR_COPY`；渲染点 `errorText(entry)`。`ConfigDiagnostic`
多出的 `path` / `severity` 字段与 `ErrorEnvelope` 结构兼容（`errorText` 只读 `code` / `message` /
`params`），不需要适配层。

**同一个 code 的第二条信封**：`settings.rs` 的 `plan_and_apply` 把 RejectOnWrite 诊断经
`field_error(path, diagnostic.code, message)` 转成 `SettingsFieldError`，字段错误面读
`FIELD_ERROR_COPY` 改道表。这些 code 因此在两条信封上出现，而两档语义相反（装载期「已忽略」
vs 保存被拒「改哪里才能保存」）——12 个 code 的保存档取 D928–D939（与 `config_parse_failed`
的 D696/D697 先例同形）。不复用诊断档：保存被拒时文件逐字节未变，说「已忽略」是事实错误。
门禁按 `config.rs` 的 `REJECT_ON_WRITE_CODES`（动态 `field_error` 构造点的 code 来源）机械
核对 `FIELD_ERROR_COPY` 的条目，不靠人读。

## D2：path 路由只做「找 code」，不做第二套校验

`SettingsSnapshot.diagnostics` 本身已经按 `settings.rs` 的 `in_settings_scope` 过滤过；面板内的
两栏（模型接入 / 自动化）按现有 `automationScoped(path)` 分流，本 change 不动这条路由。

**模型行 notes 是唯一需要新路由的地方**：`ModelDraft.diagnostics` 是 `Vec<String>`，只有 message。
code 在**同一个快照**的 `diagnostics` 里，路径是同一条键路径
（`harness.providers.<id>.models[<i>]` 及其后代）——这正是 Rust `model_drafts` 收集 notes 的规则
（`settings.rs` 的 `MODEL_DROP_CODES` / `path_is_under`）。`localizeModelNotes` 复刻这条归属规则：
前缀相等或后代；**条数对齐时逐条映射**，对不齐整行回落原 message。

为什么不在 Rust 侧给 `ModelDraft.diagnostics` 加 code：那要改 ts-rs 导出面与设置快照形状，
而现有 `snapshot.diagnostics` 已经携带 code；按 path 取回是零协议成本的解（mission 明确
「优先使用现有 path/code 数据」）。条数守卫是对「后端换了清单口径」的防线：错配时宁可显示
Rust 中文 message（既有行为），也不把 A 行的文案贴到 B 行。

## D3：未知 code / 缺参安全回落 `message`

沿用 `errorText` 的既有兜底：未知 code → message；模板缺参 → console 记一条并回落 message。
诊断码表新增条目全部无占位，缺参路径实际不可达，但兜底不删（前向兼容）。这条同时保证：
未来 Rust 新增一个未登记的诊断 code 时，用户看到的是中文 message 而不是空白或裸 code。

## D4：不泄露读数 / 内部技术串

诊断 message 里常有用户配置值（`"openai"`、重复的 model id、`os error 13`）与合法区间等读数。
诊断信封没有 params 通道，模板一律**无占位**：

- 读数由键路径承担——`fillDiagnostics` / 被忽略 provider 的条目诊断本来就单独渲染 `path`；
  模型行 notes 就挂在该模型行下，行内已有 id / window 等字段值；
- 例外只在「人类可读的固定词表」（preset / wire_api 的可选值、API Key 这两个概念），它们不是用户读数；
- 内部错误串（`config_migration_write_failed` 的 `Permission denied (os error 13)`）MUST NOT 上屏，
  只保留可行动方向（检查写入权限 / 下次启动重试）。

## D5：log-only code 的显式豁免表，而不是「全量 sink.warn 都要文案」

诊断构造点共 81 处 / 56 个 code。其中 27 个的键路径**永远不在设置快照范围**（`in_settings_scope`
只放行 `harness.provider*`、naming 与 `harness.subagents.enabled`）：editor / ui / keys / log /
vault / cron / version / last_vault / 装载失败三类 / `harness.subagents` 整节 / 权限 / 轮次与上下文
阈值。它们只经 `ConfigSnapshot.warnings` 进 console 与诊断日志（`i18n-exempt: log`，语言固定）。

给它们造文案 = 没有消费者的条目（REVIEW.md『值或开关声明了却没有消费者』），门禁会变成「为凑数
写文案」。因此：

- 设置面可达的 29 个 code → `ERROR_COPY` + 无占位 + 双语两档断言；
- 其余 27 个 → `tests/unit/error-text.test.ts` 的 `LOG_ONLY_DIAGNOSTIC_CODES`，每条注明「为什么不
  上屏」；
- 反向对账：豁免表里的 code 必须真实扫到、且不得同时出现在 `ERROR_COPY`（分类写错即红）；
  新增诊断 code 两者都不在即红——豁免是白名单，不是关闭门禁的开关。

## D6：门禁的扫描通道与判据

第四条通道扫四类构造点（`maskRust` 掩掉注释 / 字符串，`#[cfg(test)]` 之后不计）：

| 构造点 | code 位置 |
|---|---|
| `sink.warn("code", …)` | 第 1 个参数 |
| `sink.warn_at("code", …)` | 第 1 个参数 |
| `failed_snapshot(path, "code", …)` | 第 2 个参数 |
| `ConfigDiagnostic { code: "…" }` | 结构体字面量的 `code` 字段 |

判据：

1. 每条通道的 code 集合与 `ERROR_COPY`（+ 诊断豁免表）逐一对账，缺一即红；反向查幽灵条目；
2. 诊断模板 MUST NOT 带占位（与字段错误 / 事件字面量同一判据）；
3. 设置面可达的诊断条目 MUST 是双语两档（en 列无 CJK、两列不同、zh 列是中文）；
4. 反向阈值：诊断构造点 ≥ 70、code ≥ 50、可达 code ≥ 29——扫描器失灵时判据不会空转。

判据的区分度按 REVIEW.md『断言等价于子串』条处理：每条「不含中文」的负向断言都在同一用例里
正观测「后端原文确实是中文」，并把后端原文喂给同一组谓词确认会命中。

## 被否的替代方案

- **在 Rust 侧给 `ConfigDiagnostic` 加 `params`**：能保留读数插值，但要改 ts-rs 导出面、IPC 快照
  形状与全部 81 个构造点，收益只是「句子里的读数」——而这些读数已经在诊断行 / 模型行上可见。
- **诊断专用 `DIAGNOSTIC_COPY` 表**：同一语义（code → 文案）的第二份真源；`errorText` 的回落 /
  覆盖 / 缺参逻辑会被复制一遍。
- **为每个 Rust message 模板建新 code**：code 是语义分类不是消息 id（living spec 明文）；
  且要为 56 个 code 摊出上百条 code，Review 面与 Rust 协议面都失控。
- **只修 en、zh 保留 Rust message**：`errorText` 的取值单位是 code，做不到「同一 code 按语言走
  不同来源」，且会留下「zh 文案不受门禁约束」的暗面。

## D7：多构造点 code 的覆盖句必须写清**每个分支的结局**（r1 P1-1）

同一个 code 在 Rust 侧有多条构造点、且后果不同时（现状 56 个 code 里 23 个如此），一条覆盖句
MUST 同时说清每个分支的结局与出口，MUST NOT 把 A 分支的结局写给 B 分支。逐 code 复核对账：

| code | 构造点 / 分支 | 真实后果（写进文案） |
|---|---|---|
| `harness_provider_empty` / `harness_provider_unknown` | `resolve_active_provider` 的空串 / 悬空分支 | 按预设顺序回退到可用 provider；**没有可用 provider 时保持未配置**（第 4 步的空串落点） |
| `harness_provider_preset_invalid` | 非字符串 / 闭集合外 / `preset=mock` + `id≠mock` | 三种成因都导致整条 provider 忽略；mock 分支的出口是改 preset **或** id 的组合 |
| `harness_wire_api_invalid` | `validate_provider_entry`（非字符串）vs `validate_wire_api`（取值非法） | 非字符串 → **整条 provider 被忽略**；取值非法 → 回退为预设默认协议 |
| `harness_naming_model_invalid` | 会话命名（mock / 不在清单 / 无目标 provider）vs 图片命名（mock / 不在清单 / **未声明 vision** / 无目标） | 会话命名回退为该 provider 的生效模型；图片命名**原样保留覆盖值**、跳过命名、保留暂存名（`settings` 既有合同） |
| `harness_base_url_empty`（字段错误档） | 预设有 / 没有官方地址 | 删除键的回退只对自带官方地址的预设成立；generic 没有官方地址，必须点名 |
| `harness_model_id_empty` | 缺键 / 空串 / 非字符串 | 诊断档与保存档都点名「或不是字符串」 |
| `harness_provider_preset_migrated` | `migrate_provider_presets` | 只给 id 为 kimi / deepseek / mock 的条目补**同名**预设，其它 id 不补——不能写成「补为 generic」 |
| `harness_model_retired_migrated` | `migrate_retired_kimi_model` 的 `find_map` | 改写目标是该 provider `models` 清单**首个可用 id**（`find_map` 跳过非对象 / id 非字符串 / id 为空或**纯空白**的项；M381：不内置替补值）——不是字面清单首项，也不声称「等价模型」 |
| 其余 47 个 code | 单构造点或同义多模板 | 覆盖句与各构造点逐条比对无收窄（如 `harness_model_invalid` 三型同义、`harness_model_empty` 两落点已并列） |

判据形态：`tests/unit/first-run-error-copy.test.ts` 的 r1 组按分支断言 `must`（该分支真实后果的
不可省略成分）与 `mustNot`（只在别的分支成立的结局被误写进这句时的形状）。仅判「双语 / 无 CJK /
含可行动关键词」发现不了这类事实错误，MUST NOT 作为唯一判据。

## D8：无占位门禁按信封分列（r1 P2-1）

12 个 RejectOnWrite code 同时出现在诊断与字段错误两条信封上。若用
`FIELD_ERROR_COPY[code] ?? ERROR_COPY[code]` 取唯一模板，装载期诊断档（D902/D904/D906–D910/
D914–D916/D918/D920）根本不会被检查——诊断档带占位时门禁仍绿，运行时 `errorText(entry)` 因
无 params 回落 Rust message。

判据拆成三档并各自反向计数：

- 字段错误档：`field_error` 字面量构造点 ∪ `config.rs` 的 `REJECT_ON_WRITE_CODES`（动态转发
  来源），取值面 `FIELD_ERROR_COPY ?? ERROR_COPY`；
- 装载期诊断档：全部诊断 code 一律取 `ERROR_COPY`（含双信封 code 的诊断侧）；
- 事件字面量档：`ERROR_COPY`。

mutant 反向验证：给装载期档喂一条带占位的真实模板（`{ mutant_loading_diagnostic: "D174" }`），
判据必须报红；另在真实表上做过一次负向验证（给 D908 临时加 `{value}` → 装载期档判红）。
