# Tasks: add-model-automation-settings-oct24

## 1. 提案与原型（节点 1 交付）

- [x] 1.1 盘点固定 `HarnessProviders` 的全部消费者（`HarnessProvider` 精确引用 30 个文件 / 255 处；去掉 ts-rs 生成物 21 / 233；产品源码 13 / 211；另列 11 个不含类型名的形状级消费者）与四级影响面，落 design §0；设计可扩展 provider 映射（id / preset / 条目校验 / active 回退 / 命名目标解析）
- [x] 1.2 重写 `proposal.md` / `design.md` / `tasks.md` 与 `specs/{settings,harness,keymap-commands}` delta 为完整 provider 管理（增删改、删除保护与替代目标、preset、一次性迁移、CAS 写通道、未知字段保留、全局自动化与**内联可编辑**的命名目标）
- [x] 1.3 重做自包含可点击原型 `design/prototypes/model-automation-settings-oct24.html`：provider 列表 + 添加 / 编辑 / 删除、删除保护（当前使用 / 命名引用 / 未保存草稿）、重复 id、空清单、模型清单、高级区（预设只读 / Base URL / Wire）、全局自动化与两个命名行的内联目标选择（provider + 模型、默认跟随、关闭禁用但保留、图片标 vision、一行生效说明、无独立摘要框）；控制面板覆盖全部场景 / 主题 / provider / 操作，合成数据
- [x] 1.4 新增机器断言并跑绿：`evidence/prototype-semantics-check.mjs`（36 项：增删流程、id 冲突、删除保护、空清单、自动化全局性、内联命名目标可编辑 / 跟随 / 覆盖 / 悬空 / 会话失效覆盖模型回落 / 显式模型 + 空清单 / 关闭禁用但保留 / vision / 一行说明含来源与时机 / 无摘要框、单页无 TAB；含负向对照与 8 个 mutant 实测）与 `evidence/provider-rules-check.mjs`（47 项：迁移、默认回退、命名目标解析与编辑、失效模型按 kind 回落 / 跳过、显式生效模型优先于清单首项（含显式模型 + 空清单）、删除计划、id 规则的纯函数判定表；含 18 个 mutant 对照）
- [x] 1.5 重截三主题关键屏（已配置 / 自动化 / 命名关闭 / 图片无 vision / 空清单 / 添加 / 删除保护），同步 `.local/reviews/model-automation-settings-oct24/`（proposal / design / tasks / specs / prototype / index 副本 / 断言日志 / 截图）
- [x] 1.6 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 与 `scripts/docs-check.sh` 通过；`design/prototypes/index.html` 的本原型条目改准（只改本条目）
- [ ] 1.7 等 Alex 节点 1 裁决；未通过前不进入实现

## 2. 配置 schema 与迁移（Rust）

- [ ] 2.1 删除 `HarnessProvider` 枚举与 `HarnessProviders` 固定三字段：`HarnessConfig.provider` 改为 `String`（active id）、`providers` 改为 `BTreeMap<String, HarnessProviderConfig>`；`HarnessMockConfig.fixture` 并入统一条目（`preset = mock`），独立结构删除
- [ ] 2.2 新增 `ProviderPreset { Kimi, Deepseek, Generic, Mock }` 与条目 schema（`preset` 必需、`fixture` 仅 mock）；`RawHarnessProviders` 改为「对象 → 逐条解析」，条目级宽容（非法条目只丢自己 + 点名 warning，不拖垮整文件）
- [ ] 2.3 实现 `configured` 派生读数（mock / generic / kimi / deepseek 四条判据）与 active 解析 / 默认回退（显式优先、configured 优先、预设顺序、空映射、悬空 + warning）
- [ ] 2.4 两张命名表的 `provider` 从枚举改为 id：目标在映射内即用，悬空回落 active + warning；`model` 覆盖仍按目标 provider 的清单校验（会话命名回落、图片命名保留值 + 资格闸）
- [ ] 2.5 一次性迁移：旧三档条目补 `preset`（显式值不覆盖、未知 id 不迁移、幂等），与退役 model 迁移合并为同一次原子写；写失败只 warning、内存值仍生效
- [ ] 2.6 能力读取 `model_specs` / `context_window` / `effort_supported` / `wire_api` / `vision_supported` 改为按 id 查条目；未命中走既有保守默认（空清单 / `FALLBACK_CONTEXT_WINDOW` / 不支持）
- [ ] 2.7 `validate()` 的 warning 生产改为结构化诊断（`ConfigDiagnostic { code, path, severity, message }`），`ConfigSnapshot.warnings` 由诊断的 `message` 派生、文案逐字不变；建立阻断级词表（含 provider id / preset / 删除引用 / 命名目标）
- [ ] 2.8 新增严格读 + `update_json_atomic_strict`（与既有原子写共用锁与 `write_file_atomic`）；文件不可解析时返回解析错误而非按 `{}` 处理
- [ ] 2.9 把 `write_config_value_to` / `write_last_vault_to` 改为在 `update_json_atomic` 闭包内读—改—写，关闭「读发生在取锁之前」的丢更新窗口

## 3. 设置写通道（Rust）

- [ ] 3.1 新增 `src-tauri/src/settings.rs`：`SettingsSnapshot`（顶层 revision；providers 规范顺序；raw vs 生效；`wire_api` raw 原 JSON 值 + `effective.wire_api`；Key 只回末 4 位；`references` 三个布尔；命名目标解析读数；文件状态；能力矩阵含预设表 / id 规则 / 保留 id）
- [ ] 3.2 实现 `SettingsPatch`：Add（id + preset）/ Update（Key / models / base_url / wire_api）/ Delete（`active_after` + 两个命名重定向）/ `active_provider` / automation / **naming（两组 `NamingEdit { provider, model }`，Set 与 Reset）**；`deny_unknown_fields`；`preset` 不出现在 Update
- [ ] 3.3 实现 apply 算法：锁内 revision 比对 → 添加 / 更新 / 删除 / 重定向 / active / 命名目标（provider 先、model 后，换 provider 清 model）/ 开关按序应用 → 严格复解析 → 非回归判据（candidate × changed paths）→ 引用完整性复核 → 原子写
- [ ] 3.4 实现删除计划：锁内按现读文件计算 active / 两个命名目标引用；缺替代目标 / 目标不存在 / 目标等于被删项 → Blocked；目标变化时清除对应 `model` 覆盖；删最后一个时删除 active 与命名 provider 键
- [ ] 3.5 revision 口径：覆盖 provider 条目（不含 chip 写回的 `providers.<id>.model`）、`harness.provider`、四开关、两个命名 `provider` 与两个命名 `model`（删除会清它们，外部改动必须触发冲突）；`Missing` 按空对象、`Invalid` 为 None
- [ ] 3.6 未知字段保留：provider 条目只改提交路径；models 按 `id` 保留未知子键；装载期被忽略的非法条目不被其它条目的保存改写
- [ ] 3.7 设置快照 / patch / 结果类型经 ts-rs 导出，重导出 `src/bindings/**` 并随实现提交
- [ ] 3.8 半配置与最小可保存状态：Key 非空 + models 空 → Blocked；generic 已有 Key 或模型但缺 base_url → Blocked；完全空的 generic 条目允许保存、`configured = false`
- [ ] 3.9 命名目标编辑：快照下发 `NamingTargetState`（两个 override 的 raw 值、provider / 模型选项、解析结果与 vision 资格）；patch 校验（目标合法非 mock、model 在目标清单内、换 provider 清 model、Reset 删键）；开关关闭时快照与 patch 都不清空值

## 4. 运行时消费者

- [ ] 4.1 `harness/llm.rs`：`preset` 改为按 `ProviderPreset` 查表；`client_at` / `network_client` / `title_client` / `naming_client` 改为按 id 查条目；`store:false` 按预设；generic 空 Key 不发送 Authorization 头
- [ ] 4.2 `harness/llm.rs::active_model` 改为按 active id 查条目（mock 返回空串，不再借 kimi 的 model）；`turn.rs` 的 ctx% 窗口读取随之走 `context_window` 的保守默认
- [ ] 4.3 `harness.rs::with_model_override` 改写 `providers.<active>.model`；cron / 子代理的模型覆盖校验按 active 条目
- [ ] 4.4 `harness/scheduler.rs` 的 provider 闸键从 `&'static str` 改为 `String`（动态 id），测试 introspection 同步
- [ ] 4.5 mock 判定统一为「条目 `preset == Mock`」：`harness/subagents.rs`、`harness/agents.rs`、`attachment_naming.rs` 三处条件与错误文案
- [ ] 4.6 `harness/turn.rs` 的 `session_open.provider` 仍是 id 字符串（形状不变）；恢复路径不按枚举解析历史值；`harness.rs` 每回合现读配置的路径不变
- [ ] 4.7 发送期缺失态：无 active provider → `harness_provider_missing`；generic 缺 base_url → `harness_base_url_missing`；kimi / deepseek 缺 Key → `harness_api_key_missing`（文案指向设置）

## 5. 前端

- [ ] 5.1 命令 `app.settings-open`（global、默认 `⌘,`）+ 应用菜单「设置…」项（无 accelerator、结构假设失败降级）
- [ ] 5.2 `src/settings-panel.ts`：模态面板、provider 列表（顺序 / 状态 / 当前徽标 / 选中）、添加表单（id + 预设 + 重复 id / 字符集错误）、编辑表单（基础区 / 高级区 / 危险区）、空清单态
- [ ] 5.3 删除确认（右列原地，不弹二级 modal）：当前使用替代选择、两个命名目标的「跟随当前 / 指定」、未保存草稿提示、删最后一个的后果文案；删除只改草稿
- [ ] 5.4 草稿状态机：clean / dirty / saving / saved / blocked / conflict / fileInvalid；保存中禁用全部编辑控件（输入 / 选择 / 开关 / 行增删 / 添加 / 删除 / 设为当前使用 / 页级还原 / 取消）
- [ ] 5.5 可访问性：背景 `inert`、`role="dialog"` + `aria-modal`、焦点圈定与交还、三条关闭路径、脏面板两步确认、`role="status"` polite live region
- [ ] 5.6 字段错误按 path 回填、`aria-invalid` / `aria-errormessage`、首错聚焦；重复模型 id **两行**都标错；provider 条目诊断挂在条目上；顶部横幅（回落 / 文件不可解析 / 冲突 + 两个动作）
- [ ] 5.7 自动化节独立成全局卡片，`renderAutomation` 与 provider 路径解耦；会话命名 / 图片命名两行内联两个目标选择（provider + 模型，默认跟随 / 生效模型 = 删键）与**一行**生效说明；关闭功能时禁用但保留选择与草稿；图片命名的模型选项标 vision；删除 provider 后重算选项与说明；**不渲染独立摘要框**
- [ ] 5.8 `src/harness-panel.ts`：删除 `PROVIDER_IDS` 闭集合推断；`harnessSelection` 读动态 id 与 `configured` 读数；chip 空态「未配置模型」+「去设置」；选中写 `harness.provider`、模型写 `providers.<id>.model`
- [ ] 5.9 `src/copy-data.ts`：D402 / D403 / D404 改为「去设置面板」并补 `vision`；新增 provider 缺失 / 空清单 / generic 缺 Base URL 的文案；会话命名节奏、图片命名资格与跳过、命名目标「跟随当前 / 指定 / 已关闭但保留」文案按 design §10
- [ ] 5.10 样式按 design §11 落地（provider 列表选中 / 当前徽标 / 添加表单 / 删除确认 / 空态；eink 1.4px 边框、无阴影、黑白实底）
- [ ] 5.11 面板关闭后 chip 重新取数一次（沿用 `configGet`），不引入全局配置状态层

## 6. 文档与规格

- [ ] 6.1 `docs/specs/config-reference.md` §1.5：`providers` 改为动态映射、补 `preset` 与条目 schema；§1.6 / §1.7 的 provider 取值从闭集合改为「`providers` 表内的 id」
- [ ] 6.2 `docs/specs/config-reference.md` §1.5 的 `models[]` 指向新增的「模型清单声明」requirement；§3 补设置面的写回路径（CAS / revision / 删键）与新描述
- [ ] 6.3 `scripts/acceptance/README.md` 的 provider 段读取口径从「恒列三档」改为「动态列表 + 空态」；场景 front-matter 的 `config.harness` 写法补 `preset`（迁移可兜底，但新场景应显式写）
- [ ] 6.4 `design/prototypes/index.html` 的本原型条目改为完整 provider 管理 + 内联命名目标（只改本条目）
- [ ] 6.5 实现 PR 合并时在 `docs/backlog.md` 落该 change 的归档跟踪条目（判据见 `docs/process/openspec-workflow.md`）
- [ ] 6.6 归档时把新建 capability `settings` 的占位 Purpose 替换为「应用内设置面板：provider 管理与自动化开关的可见编辑面」，再跑一次 `validate --all --strict`

## 7. 验证

- [ ] 7.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 7.2 `scripts/docs-check.sh` 通过（含 `openspec-archive-check.mjs` 的 MODIFIED 段落对账）
- [ ] 7.3 Rust 单测：迁移（补齐 / 幂等 / 显式值优先 / 写失败 / 未知 id / 与退役 model 同写）；映射解析（非法条目只丢自己 / preset 非法 / generic 缺 base_url / mock 保留 id / id 字符集）；active 回退（显式 / 缺省 / configured 优先 / 空映射 / 悬空 / mock 不被缺省选中）；生效模型（显式 `providers.<id>.model` 优先、不在清单与空清单都保留 + warning、缺省取清单首项）；命名目标（合法 / 悬空 / 缺省；失效覆盖模型——会话命名回落生效模型、图片命名保留原值并跳过；编辑——目标非 mock、model 在清单内、换 provider 清 model、同一笔 provider+model 按新目标校验、Reset 删键、开关关闭不清值）；删除保护（active / 命名引用 / 草稿外的替代目标 / 删最后一个（含只剩 mock）/ model 覆盖清除 / 文件逐字节不变）；快照 raw/生效 / revision / 坏条目可见；revision 冲突（外部改两个命名 `model` 后删除 provider → Conflict，不得静默清值）；patch 类型拒绝 / preset 不可改 / 重复 id / 未知子键保留；页级还原保留条目；非回归三组
- [ ] 7.4 前端单测（`pnpm test`）：增删改流程、重复 id、删除保护控件按 `references` 出现、删除后 active / 命名目标改写、空清单、保存中控件禁用、错误回填与 ARIA（重复模型 id 两行都标）、逐项恢复默认仅显式存在、内联命名目标四形态（跟随 / 指定 / 悬空回落 / 关闭禁用但保留）、换 provider 清 model、会话失效覆盖模型回落且不显示「会跳过」、显式模型 + 空清单仍取显式值、图片 vision 标记与跳过分支的来源 + 时机、自动化不随 provider 变化、单页无 TAB、反向文案断言（无独立摘要框、无「每轮生成」）
- [ ] 7.5 视觉场景：1280×800 与 900×700 下打开即完整可见（O1/O2）、无水平溢出、Tab 不逃出面板；三主题各一屏 + 空清单 / 添加（重复 id 错误）/ 删除确认 / 命名关闭（选择禁用但保留）/ 图片无 vision / 会话覆盖模型回落 / 显式模型 + 空清单 / 校验错误 / 保存中各一屏
- [ ] 7.6 `scripts/gate.sh quick` 与本地 `scripts/gate.sh visual` 通过
- [ ] 7.7 回扫既有验收场景里对 provider 选项、模型 chip、D402–D404、模型清单空态、`harness_model_missing` 的期望，逐条改准（只新增场景不算完成）
- [ ] 7.8 新增验收场景：`⌘,` 与菜单打开同一面板；添加 provider 后 chip 出现；重复 id 被拒且文件不变；删除当前 provider 需替代目标；删除被命名引用项后读数更新；删除最后一个 provider 的空态与发送错误；旧格式配置启动后补齐 preset 且二次启动不再写
- [ ] 7.9 真机验收套件全量跑一遍，证据落 `.local/acceptance/`
- [ ] 7.10 全程只用合成 Key（形如 `test-key-…`）；MUST NOT 读取或写入真实 `~/.config/lumir` 与真实 vault
- [ ] 7.11 原型回归：`node openspec/changes/add-model-automation-settings-oct24/evidence/prototype-semantics-check.mjs`（36 项）与 `node .../evidence/provider-rules-check.mjs`（47 项）全绿；实现 PR 把规则判定表移植成 Rust 单测后删除 `provider-rules-check.mjs`
