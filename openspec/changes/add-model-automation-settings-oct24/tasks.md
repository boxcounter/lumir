# Tasks: add-model-automation-settings-oct24

## 1. 提案与原型（节点 1 交付）

- [x] 1.1 盘点固定 `HarnessProviders` 的全部消费者（`HarnessProvider` 精确引用 30 个文件 / 255 处；去掉 ts-rs 生成物 21 / 233；产品源码 13 / 211；另列 11 个不含类型名的形状级消费者）与四级影响面，落 design §0；设计可扩展 provider 映射（id / preset / 条目校验 / active 回退 / 命名目标解析）
- [x] 1.2 重写 `proposal.md` / `design.md` / `tasks.md` 与 `specs/{settings,harness,keymap-commands}` delta 为完整 provider 管理（增删改、删除保护与替代目标、preset、一次性迁移、CAS 写通道、未知字段保留、全局自动化与**内联可编辑**的命名目标）
- [x] 1.3 重做自包含可点击原型 `design/prototypes/model-automation-settings-oct24.html`：provider 列表 + 添加 / 编辑 / 删除、删除保护（当前使用 / 命名引用 / 未保存草稿）、重复 id、空清单、模型清单、高级区（预设只读 / Base URL / Wire）、全局自动化与两个命名行的内联目标选择（provider + 模型、默认跟随、关闭禁用但保留、图片标 vision、一行生效说明、无独立摘要框）；控制面板覆盖全部场景 / 主题 / provider / 操作，合成数据
- [x] 1.4 新增机器断言并跑绿：`evidence/prototype-semantics-check.mjs`（36 项：增删流程、id 冲突、删除保护、空清单、自动化全局性、内联命名目标可编辑 / 跟随 / 覆盖 / 悬空 / 会话失效覆盖模型回落 / 显式模型 + 空清单 / 关闭禁用但保留 / vision / 一行说明含来源与时机 / 无摘要框、单页无 TAB；含负向对照与 8 个 mutant 实测）与 `evidence/provider-rules-check.mjs`（47 项：迁移、默认回退、命名目标解析与编辑、失效模型按 kind 回落 / 跳过、显式生效模型优先于清单首项（含显式模型 + 空清单）、删除计划、id 规则的纯函数判定表；含 18 个 mutant 对照）。**后者已于 M743 删除**：判定表由 Rust 单测接管（映射见 7.11 与文末「收尾批记录」）。
- [x] 1.5 重截三主题关键屏（已配置 / 自动化 / 命名关闭 / 图片无 vision / 空清单 / 添加 / 删除保护），同步 `.local/reviews/model-automation-settings-oct24/`（proposal / design / tasks / specs / prototype / index 副本 / 断言日志 / 截图）
- [x] 1.6 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 与 `scripts/docs-check.sh` 通过；`design/prototypes/index.html` 的本原型条目改准（只改本条目）
- [ ] 1.7 等 Alex 节点 1 裁决；未通过前不进入实现

## 2. 配置 schema 与迁移（Rust）

- [x] 2.1 删除 `HarnessProvider` 枚举与 `HarnessProviders` 固定三字段：`HarnessConfig.provider` 改为 `String`（active id）、`providers` 改为 `BTreeMap<String, HarnessProviderConfig>`；`HarnessMockConfig.fixture` 并入统一条目（`preset = mock`），独立结构删除
- [x] 2.2 新增 `ProviderPreset { Kimi, Deepseek, Generic, Mock }` 与条目 schema（`preset` 必需、`fixture` 仅 mock）；`RawHarnessProviders` 改为「对象 → 逐条解析」，条目级宽容（非法条目只丢自己 + 点名 warning，不拖垮整文件）
- [x] 2.3 实现 `configured` 派生读数（mock / generic / kimi / deepseek 四条判据）与 active 解析 / 默认回退（显式优先、configured 优先、预设顺序、空映射、悬空 + warning）
- [x] 2.4 两张命名表的 `provider` 从枚举改为 id：目标在映射内即用，悬空回落 active + warning；`model` 覆盖仍按目标 provider 的清单校验（会话命名回落、图片命名保留值 + 资格闸）
- [x] 2.5 一次性迁移：旧三档条目补 `preset`（显式值不覆盖、未知 id 不迁移、幂等），与退役 model 迁移合并为同一次原子写；写失败只 warning、内存值仍生效
- [x] 2.6 能力读取 `model_specs` / `context_window` / `effort_supported` / `wire_api` / `vision_supported` 改为按 id 查条目；未命中走既有保守默认（空清单 / `FALLBACK_CONTEXT_WINDOW` / 不支持）
- [x] 2.7 `validate()` 的 warning 生产改为结构化诊断（`ConfigDiagnostic { code, path, severity, message }`），`ConfigSnapshot.warnings` 由诊断的 `message` 派生、文案逐字不变；建立阻断级词表（含 provider id / preset / 删除引用 / 命名目标）
- [x] 2.8 新增严格读 + `update_json_atomic_strict`（与既有原子写共用锁与 `write_file_atomic`）；文件不可解析时返回解析错误而非按 `{}` 处理
- [x] 2.9 把 `write_config_value_to` / `write_last_vault_to` 改为在 `update_json_atomic` 闭包内读—改—写，关闭「读发生在取锁之前」的丢更新窗口

## 3. 设置写通道（Rust）

- [x] 3.1 新增 `src-tauri/src/settings.rs`：`SettingsSnapshot`（顶层 revision；providers 规范顺序；raw vs 生效；`wire_api` raw 原 JSON 值 + `effective.wire_api`；Key 只回末 4 位；`references` 三个布尔；命名目标解析读数；文件状态；能力矩阵含预设表 / id 规则 / 保留 id）
- [x] 3.2 实现 `SettingsPatch`：Add（id + preset）/ Update（Key / models / base_url / wire_api）/ Delete（`active_after` + 两个命名重定向）/ `active_provider` / automation / **naming（两组 `NamingEdit { provider, model }`，Set 与 Reset）**；`deny_unknown_fields`；`preset` 不出现在 Update
- [x] 3.3 实现 apply 算法：锁内 revision 比对 → 添加 / 更新 / 删除 / 重定向 / active / 命名目标（provider 先、model 后，换 provider 清 model）/ 开关按序应用 → 严格复解析 → 非回归判据（candidate × changed paths）→ 引用完整性复核 → 原子写
- [x] 3.4 实现删除计划：锁内按现读文件计算 active / 两个命名目标引用；缺替代目标 / 目标不存在 / 目标等于被删项 → Blocked；目标变化时清除对应 `model` 覆盖；删最后一个时删除 active 与命名 provider 键
- [x] 3.5 revision 口径：覆盖 provider 条目（不含 chip 写回的 `providers.<id>.model`）、`harness.provider`、四开关、两个命名 `provider` 与两个命名 `model`（删除会清它们，外部改动必须触发冲突）；`Missing` 按空对象、`Invalid` 为 None
- [x] 3.6 未知字段保留：provider 条目只改提交路径；models 按 `id` 保留未知子键；装载期被忽略的非法条目不被其它条目的保存改写
- [x] 3.7 设置快照 / patch / 结果类型经 ts-rs 导出，重导出 `src/bindings/**` 并随实现提交
- [x] 3.8 半配置与最小可保存状态：Key 非空 + models 空 → Blocked；generic 已有 Key 或模型但缺 base_url → Blocked；完全空的 generic 条目允许保存、`configured = false`
- [x] 3.9 命名目标编辑：快照下发 `NamingTargetState`（两个 override 的 raw 值、provider / 模型选项、解析结果与 vision 资格）；patch 校验（目标合法非 mock、model 在目标清单内、换 provider 清 model、Reset 删键）；开关关闭时快照与 patch 都不清空值

## 4. 运行时消费者

- [x] 4.1 `harness/llm.rs`：`preset` 改为按 `ProviderPreset` 查表；`client_at` / `network_client` / `title_client` / `naming_client` 改为按 id 查条目；`store:false` 按预设；generic 空 Key 不发送 Authorization 头
- [x] 4.2 `harness/llm.rs::active_model` 改为按 active id 查条目（mock 返回空串，不再借 kimi 的 model）；`turn.rs` 的 ctx% 窗口读取随之走 `context_window` 的保守默认
- [x] 4.3 `harness.rs::with_model_override` 改写 `providers.<active>.model`；cron / 子代理的模型覆盖校验按 active 条目
- [x] 4.4 `harness/scheduler.rs` 的 provider 闸键从 `&'static str` 改为 `String`（动态 id），测试 introspection 同步
- [x] 4.5 mock 判定统一为「条目 `preset == Mock`」：`harness/subagents.rs`、`harness/agents.rs`、`attachment_naming.rs` 三处条件与错误文案
- [x] 4.6 `harness/turn.rs` 的 `session_open.provider` 仍是 id 字符串（形状不变）；恢复路径不按枚举解析历史值；`harness.rs` 每回合现读配置的路径不变
- [x] 4.7 发送期缺失态：无 active provider → `harness_provider_missing`；generic 缺 base_url → `harness_base_url_missing`；kimi / deepseek 缺 Key → `harness_api_key_missing`（文案指向设置）

## 5. 前端

- [x] 5.1 命令 `app.settings-open`（global、默认 `⌘,`）+ 应用菜单「设置…」项（无 accelerator、结构假设失败降级）
- [x] 5.2 `src/settings-panel.ts`：模态面板、provider 列表（顺序 / 状态 / 当前徽标 / 选中）、添加表单（id + 预设 + 重复 id / 字符集错误）、编辑表单（基础区 / 高级区 / 危险区）、空清单态
- [x] 5.3 删除确认（右列原地，不弹二级 modal）：当前使用替代选择、两个命名目标的「跟随当前 / 指定」、未保存草稿提示、删最后一个的后果文案；删除只改草稿
- [x] 5.4 草稿状态机：clean / dirty / saving / saved / blocked / conflict / fileInvalid；保存中禁用全部编辑控件（输入 / 选择 / 开关 / 行增删 / 添加 / 删除 / 设为当前使用 / 页级还原 / 取消）
- [x] 5.5 可访问性：背景 `inert`、`role="dialog"` + `aria-modal`、焦点圈定与交还、三条关闭路径、脏面板两步确认、`role="status"` polite live region
- [x] 5.6 字段错误按 path 回填、`aria-invalid` / `aria-errormessage`、首错聚焦；重复模型 id **两行**都标错；provider 条目诊断挂在条目上；顶部横幅（回落 / 文件不可解析 / 冲突 + 两个动作）
- [x] 5.7 自动化节独立成全局卡片，`renderAutomation` 与 provider 路径解耦；会话命名 / 图片命名两行内联两个目标选择（provider + 模型，默认跟随 / 生效模型 = 删键）与**一行**生效说明；关闭功能时禁用但保留选择与草稿；图片命名的模型选项标 vision；删除 provider 后重算选项与说明；**不渲染独立摘要框**
- [x] 5.8 `src/harness-panel.ts`：删除 `PROVIDER_IDS` 闭集合推断；`harnessSelection` 读动态 id 与 `configured` 读数；chip 空态「未配置模型」+「去设置」；选中写 `harness.provider`、模型写 `providers.<id>.model`
- [x] 5.9 `src/copy-data.ts`：D402 / D403 / D404 改为「去设置面板」并补 `vision`；新增 provider 缺失 / 空清单 / generic 缺 Base URL 的文案；会话命名节奏、图片命名资格与跳过、命名目标「跟随当前 / 指定 / 已关闭但保留」文案按 design §10
- [x] 5.10 样式按 design §11 落地（provider 列表选中 / 当前徽标 / 添加表单 / 删除确认 / 空态；eink 1.4px 边框、无阴影、黑白实底）
- [x] 5.11 面板关闭后 chip 重新取数一次（沿用 `configGet`），不引入全局配置状态层

## 6. 文档与规格

- [x] 6.1 `docs/specs/config-reference.md` §1.5：`providers` 改为动态映射、补 `preset` 与条目 schema；§1.6 / §1.7 的 provider 取值从闭集合改为「`providers` 表内的 id」
- [x] 6.2 `docs/specs/config-reference.md` §1.5 的 `models[]` 指向新增的「模型清单声明」requirement；§3 补设置面的写回路径（CAS / revision / 删键）与新描述
- [x] 6.3 `scripts/acceptance/README.md` 的 provider 段读取口径从「恒列三档」改为「动态列表 + 空态」；场景 front-matter 的 `config.harness` 写法补 `preset`（迁移可兜底，但新场景应显式写）
- [x] 6.4 `design/prototypes/index.html` 的本原型条目改为完整 provider 管理 + 内联命名目标（只改本条目）
- [x] 6.5 实现 PR 合并时在 `docs/backlog.md` 落该 change 的归档跟踪条目（判据见 `docs/process/openspec-workflow.md`）
- [x] 6.6 归档时把新建 capability `settings` 的占位 Purpose 替换为「应用内设置面板：provider 管理与自动化开关的可见编辑面」，再跑一次 `validate --all --strict`（M743 改为**在 delta 写入最终 Purpose**，由 openspec 1.12.0 归档时携带，见文末记录）

## 7. 验证

- [x] 7.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 7.2 `scripts/docs-check.sh` 通过（含 `openspec-archive-check.mjs` 的 MODIFIED 段落对账）
- [ ] 7.3 Rust 单测：迁移（补齐 / 幂等 / 显式值优先 / 写失败 / 未知 id / 与退役 model 同写）；映射解析（非法条目只丢自己 / preset 非法 / generic 缺 base_url / mock 保留 id / id 字符集）；active 回退（显式 / 缺省 / configured 优先 / 空映射 / 悬空 / mock 不被缺省选中）；生效模型（显式 `providers.<id>.model` 优先、不在清单与空清单都保留 + warning、缺省取清单首项）；命名目标（合法 / 悬空 / 缺省；失效覆盖模型——会话命名回落生效模型、图片命名保留原值并跳过；编辑——目标非 mock、model 在清单内、换 provider 清 model、同一笔 provider+model 按新目标校验、Reset 删键、开关关闭不清值）；删除保护（active / 命名引用 / 草稿外的替代目标 / 删最后一个（含只剩 mock）/ model 覆盖清除 / 文件逐字节不变）；快照 raw/生效 / revision / 坏条目可见；revision 冲突（外部改两个命名 `model` 后删除 provider → Conflict，不得静默清值）；patch 类型拒绝 / preset 不可改 / 重复 id / 未知子键保留；页级还原保留条目；非回归三组
- [x] 7.4 前端单测（`pnpm test`）：增删改流程、重复 id、删除保护控件按 `references` 出现、删除后 active / 命名目标改写、空清单、保存中控件禁用、错误回填与 ARIA（重复模型 id 两行都标）、逐项恢复默认仅显式存在、内联命名目标四形态（跟随 / 指定 / 悬空回落 / 关闭禁用但保留）、换 provider 清 model、会话失效覆盖模型回落且不显示「会跳过」、显式模型 + 空清单仍取显式值、图片 vision 标记与跳过分支的来源 + 时机、自动化不随 provider 变化、单页无 TAB、反向文案断言（无独立摘要框、无「每轮生成」）
- [x] 7.5 视觉场景：1280×800 与 900×700 下打开即完整可见（O1/O2）、无水平溢出、Tab 不逃出面板；三主题各一屏 + 空清单 / 添加（重复 id 错误）/ 删除确认 / 命名关闭（选择禁用但保留）/ 图片无 vision / 会话覆盖模型回落 / 显式模型 + 空清单 / 校验错误 / 保存中各一屏
- [x] 7.6 `scripts/gate.sh quick` 与本地 `scripts/gate.sh visual` 通过（`GATE RESULT: 14/14 PASS（SKIP 1）`；SKIP 为 tsc-visual 环境缺依赖，依赖装好后单跑退出码 0——见文末记录）
- [x] 7.7 回扫既有验收场景里对 provider 选项、模型 chip、D402–D404、模型清单空态、`harness_model_missing` 的期望，逐条改准（只新增场景不算完成）
- [x] 7.8 新增验收场景：`⌘,` 与菜单打开同一面板；添加 provider 后 chip 出现；重复 id 被拒且文件不变；删除当前 provider 需替代目标；删除被命名引用项后读数更新；删除最后一个 provider 的空态与发送错误；旧格式配置启动后补齐 preset 且二次启动不再写
- [x] 7.9 真机验收套件全量跑一遍，证据落 `.local/acceptance/`（242 场景：PASS 211 / FAIL 24 / INVALID 7；本 change 相关场景全绿，其余逐条归因见文末记录）
- [x] 7.10 全程只用合成 Key（形如 `test-key-…`）；MUST NOT 读取或写入真实 `~/.config/lumir` 与真实 vault
- [x] 7.11 原型回归：`node openspec/changes/add-model-automation-settings-oct24/evidence/prototype-semantics-check.mjs`（36 项）与 `node .../evidence/provider-rules-check.mjs`（47 项）全绿；实现 PR 把规则判定表移植成 Rust 单测后删除 `provider-rules-check.mjs`（M743 已执行：47/47 复跑留档后删除脚本，映射见文末记录）

## 实现批记录（M734 前端批，2026-10-25）

- **已完成**：tasks §5.1–§5.11（面板 `src/settings-panel.ts` / `.css`、⌘, 与 App 菜单
  「Settings…」、chip 动态 id / `configured` / 「去设置」、copy D402–D404 与 D698–D865）。
- **测试**：`tests/unit/settings-panel.test.ts`（32 项：草稿 / patch / 命名目标四形态 / 错误按
  path 回填 / 页级还原 / 反向文案）；`tests/unit/harness-panel-control.test.ts` 改写为动态
  schema；`tests/visual/scenes/m734-settings-panel.spec.ts`（10 项结构 / 几何 / 三主题 /
  删除保护 / 保存中禁用）；13 个既有 harness 视觉场景的 provider 桩收敛到
  `tests/visual/scenes/provider-config.ts`（M738 finding 的视觉侧）；验收
  `scripts/acceptance/lib/app.mjs` 的 mock / kimi 条目补 `preset`；新增场景
  `scripts/acceptance/scenarios/250-settings-panel-provider-crud.md`。
- **实跑读数**：`pnpm test` 1437 passed；`gate.sh quick` 结果见批次报告；本地视觉
  `playwright test`（13 个改动场景 + 新设置场景）72 passed；`run.mjs --check` 241 个场景通过；
  两个原型回归脚本 36 / 47 全绿。
- **M738 的视觉桩修复**：其提交 `fa4f034b` 已 cherry-pick 进本批（tower 裁决：不接受 master
  留 tsc-visual 红；M738 标 abandoned 只作合并路径调整，实现随本批一并 fresh review）。桩的
  `providerEntry` 与场景侧的 `provider-config.ts` 收敛为同一份派生实现，`tauri-stub` 从那里
  导入；`configured` 仍按 `derive_configured` 在桩侧派生。
- **未完成 / 待裁决**：
  1. **视觉像素基线**（7.5 的像素面）：Alex 2026-10-25 对
     `.local/reviews/m734-settings/` 的候选截图回复「批准。」（经 tower 转达），已为 11 张
     设置场景补 `expectScreenshot` 与基线（仅这 11 张，未动其它基线）。核对方式：把批准候选
     原图放入基线目录后跑场景，10/11 逐像素通过（容差内）；唯一差异是 `06-delete-confirm`
     的删除钮由浅底红字改为实底白字（design §11.5 的配方，批准后修的 CSS 权重缺陷），
     该张基线按修正后的渲染重新生成并在批次报告里点名，等 Alex 追认。
  2. **真机全量验收**（7.9）：本批只跑 `--check` 与场景静态校验；250 的主链真跑归批次收尾。
  3. **菜单入口的真机点击**：套件无菜单栏动作，菜单与 ⌘, 共用 `app.settings-open` 的 toggle
     由代码结构保证（`MENU_COMMANDS.settings`），真机手点归 Alex 的手感项。
  4. `provider-rules-check.mjs` 的退役（7.11 后半句）未在本批执行：规则表已在 M732/M733 的
     Rust 单测里覆盖，但删除脚本需要一次独立的“规则表已全部移植”对账，留给归档前的收口
     （**M743 已执行并对账，见文末「收尾批记录」**）。

## r1 返修记录（2026-10-25，review r1 p1-6items / merge hold）

按 review `.tower/comms/reviews/review-feat-implement-settings-panel-frontend-oct25-reviewer-settings-panel-fronte-r1.md`：

1. **P1-1** 新增被拒：`planProviderEdits` 产出「每条 Add 在 patch 里的下标」，`mapFieldErrors` 带
   `addIdIndex`，按**草稿下标**（`focusedIndex`）定位被拒条目并保留其 Key / 模型 / Base URL；id 在
   条目自己的输入里可改（`#lumir-set-draft-id`），落盘后不再出现。撤销未落盘新增恢复
   `activeBeforeAdd`（空配置首项 → active 回到 null 且不写 `active_provider`）。
2. **P1-2** 命名行未编辑时直接消费后端 `resolved` / `model_options`（`namingRowModel` 的 clean
   分支）；草稿预览只把 `valid !== false` 的行当有效声明，raw 坏行的 vision 一律判不合格。
3. **P1-3** 删除保护与删除计划改读**当前草稿**的引用面（`draftReferences`）；选中态按草稿下标
   而不是 id（同 id 两条草稿不再命中第一条）；删 active 且命名目标是「跟随」时当场清 model 覆盖。
4. **P2-4** `active` / 两个命名 / 文件级错误有可见出口（通用错误横幅 + 命名行内错误）并计入
   「需要修正」计数与首错焦点；`settings_get` 失败显示真实错误横幅与「读取设置失败，保存已禁用」
   状态，不再停在加载文案。
5. **P2-5** 场景 250 主链在重复 id 被拒后先删掉那条草稿新增再继续；新增场景
   `251-settings-panel-legacy-preset-migration`（旧格式补 preset + 二次启动；r1 只写了
   `unchangedSince` = sha256，mtime 判据是 r2 才补上的，见下条 r2 记录）；`app.mjs` 增加
   `rawProviders` 原样透传入口（README 同条记录）。
6. **P2-6** 清 Key 同步 `hasKey=false`（显示未配置）；Base URL / Wire 恢复默认后按钮消失。

附带修掉两处 DOM 级问题（r1 回归实测）：输入框 `change` 时的整页重绘会吃掉紧接着的一次点击
（改为就地更新状态），以及 `flex: 1` 在自动高度列里把正文压成 0 高度（改 `flex: 1 1 auto`）。

**基线状态（2026-10-25 追认后）**：Alex 对 `.local/reviews/m734-settings-r1/` 的两张候选
（`05-add-duplicate.png` / `06-delete-confirm.png`）明确回复「确认」，两张均批准为基线。

- `05-add-duplicate`：按批准候选恢复像素断言，基线文件即该候选图（逐字节相同，sha256
  `64225bf7…a19c`）；其它基线未动。
- `06-delete-confirm`：保持当前实底白字基线（与批准候选同源，sha256 `25e5267d…a74e8`）。
- 其余 9 张仍与最早批准的候选逐像素一致。

## r2 返修记录（2026-10-25，review r2 p1-2items / merge hold）

按 review `.tower/comms/reviews/review-feat-implement-settings-panel-frontend-oct25-reviewer-settings-panel-fronte-r1-2.md`：

1. **P1-1 删除计划按草稿身份**：`DraftDeleteForm` 只带**草稿下标**（`index`），`openDelete` /
   `renderDeleteForm` / `applyDraftDelete` / `providerDelete` 全按下标定位，不再用
   `findProvider(draft, id)` 取第一条同 id 条目。同 id 的已保存条目 + 被拒新增里，从新增条目点
   「删除…」删掉的是新增那条（= 撤销添加），已保存条目不动、patch 里不出现 provider 编辑、
   active 不被改写；撤销后 `focusedIndex` 随数组前移修正。
   回归：单测 ×2（删新增 / 删已保存）+ 视觉「被拒的重复新增按草稿身份删除」。
2. **P1-2 改名只改归属它的引用**：新增 `renameDraftProviderId`——草稿里若另有同 id 且未删的条目，
   active / 两个命名目标 / selection 一律不动（引用按 id 字面寻址，这个 id 的实体是盘上那条）。
   回归：单测 ×2（同 id 不动 / 唯一持有者跟着改）+ 视觉「重复 id 新增改名不动…」（断言「当前」
   徽标留在已保存条目、两个命名选择器仍指 kimi-work，第二笔 patch 无 `active_provider` / `naming`）。
3. **P2-3 场景 251 的 mtime 判据**：二次启动断言改成**两条同写**——`unchangedSince`（sha256）+
   `mtimeUnchangedSince`（mtime）。执行器里 `unchangedSince` 只比 sha256，写回同一份字节照样 PASS；
   本条目 r1 记录里「`unchangedSince` 覆盖 sha256/mtime」的表述已改准。
4. **P2-4 命名行错误节点可移除**：节点由 `AutomationRow.error` 持有，每次重绘先移除再挂；
   `markDirty`（任何就地编辑都经过它）同步移除，不再出现「计数清零、错误文字还在」。
   回归：视觉「命名行的后端错误在编辑清错后从持久行里移除」（输入框就地编辑 → 节点消失；
   再整页重绘不复活）。

三条新视觉用例都做了**反向验证**：把 `src/settings-panel.ts` 换回 r1 tip 的版本后各按预期判红
（删除确认缺「有未保存的修改」块 / 已保存条目丢「当前」徽标 / 旧错误节点仍在），恢复后 22 条全绿。

5. **真跑 250/251 暴露的产品缺陷（随本条一并修掉）**——两处都只在真机上才看得见
   （视觉桩的 snapshot 恒有「列表内的当前使用项」）：
   - `addProviderDraft` 只在 `active === null` 时才把新增项设为当前使用。配置原本是
     `provider: "mock"`（mock 不呈现、也不在设置面列表里）时，新增的第一条 provider **不会**
     成为当前使用——正是 design §4.4 要避免的「添加成功但还不能用」。改为：当前使用项不可用
     （没设 / 指向列表外的 id / 只剩 mock）时由新增项接管；撤销这条新增时 active 回到**盘上的
     原值**（含 mock），不发一笔把用户显式选择删掉的 `active_provider = reset`。
   - `markDirty` 无条件把状态置为 dirty：撤销一条从未落盘的新增后草稿已经干净、保存钮已灰，
     状态行却仍写「有未保存的修改」。改为按 `draftIsDirty()` 取 dirty / clean。
6. **场景 250/251 自身的执行缺陷（首次真跑全部暴露）**：`ax.has` / `file.has` 写成数组（数组只有
   `waitFor.has` 支持，`matcher()` 会把数组拼成 `a,b,c` 一个字面串而恒不命中）；`typeInNode` 的
   目标名没写「注入前（label / 占位）与注入后（值）都能命中」的交替正则；撤销新增后点了一个
   **已禁用**的保存钮；`providers: {}` 的期望（保留的 mock 条目仍在文件里）；251 的恢复标签写成
   `settings-note.md`（本场景打开的是 `harness-note.md`）。`--check` 补一条静态规则：
   `ax.has/not`、`file.has/not` 写数组即报 problem（同一份假绿形态不再靠人读发现）。

## r3 返修记录（2026-10-25，review r3 p1-2items / merge hold）

按 review `.tower/comms/reviews/review-feat-implement-settings-panel-frontend-oct25-reviewer-settings-panel-fronte-r1-3.md`：

1. **P1-1 多笔未落盘新增的删除要兑现替代目标**：`applyDraftDelete` 拆成两条语义——**未被任何引用
   指着的新增** = 撤销添加（从草稿里摘掉，不改写引用）；**被 active / 命名指着的新增**（含已保存
   条目）仍走替代目标逻辑：`activeAfter` 有效就采用、无效回落第一个候选、没有候选时未落盘新增
   回到 `activeBeforeAdd`（`mock` 不会被一笔 reset 删掉）；命名目标按计划改成 follow / 指定并
   clear 掉旧 provider 的 model 覆盖。回归：单测 ×3（mock 基线删当前项 → patch 带
   `active_provider = set(second)` 与 `[add second]`；未被引用的新增仍是纯撤销；被命名引用的
   新增删除时兑现重定向）+ 视觉「mock 基线下两笔新增，删掉当前使用那笔时替代项写进 patch」。
2. **P1-2 引用归属按持有者身份**：`Draft` 增加 `activeOwner` / `namingOwner`（草稿条目对象身份），
   `createDraft`（快照引用 → 已保存条目）、`addProviderDraft`（接管 active）、`setActiveDraft`、
   `setNamingProviderDraft`、`applyDraftDelete`（重定向后的新持有者）、`pageResetDraft` 各自维护；
   `renameDraftProviderId` 只在**持有者是这条草稿**时改写引用，不再用「存在另一个同 id」推断。
   回归：单测 ×4（同 id 两笔改第一笔 → 引用跟着走；改第二笔 → 留在第一笔；显式把 active 切到
   第二笔后改第一笔不动它、改第二笔才跟着走；`deleteReferences` 只看持有者身份）+ 视觉 ×2
   （两笔同 id 改第一笔 / 改第二笔两个方向）。
3. **P2-3 通用字段错误与保存失败横幅**：`markDirty` 里补 `renderBanner()`——就地编辑（输入框
   input 不走整页重绘）后 `[data-banner="field-errors"]` / `[data-banner="save-error"]` 与
   `errors` / `lastError` 同步消失。回归：视觉「字段错误 / 保存失败横幅在输入框就地编辑后撤销」
   （桩新增 `applyThrowsOnce`：第一次 `settings_apply` 抛 IPC 错误的形态）。
4. **P2-4 冲突未解决时守住 conflict**：`markDirty` 不再把 `conflict` 降级成 dirty；`save(false)` 在
   conflict 态直接拒绝（唯一可写路径是横幅里的「仍然保存」，用冲突返回的新 revision）。回归：
   视觉「冲突后继续编辑仍守住 conflict 与两个动作，底栏保存不再启用」（就地编辑 + 整页重绘两种
   路径都断言横幅、两个动作、状态行「外部冲突」与底栏禁用）。
5. **P2-5 清除 Key 后的草稿意图**：`DraftProvider` 增加 `keyWasSet`（快照事实，草稿的清除 / 替换
   不改它）；新增纯函数 `keyEditForInput`——空输入按「盘上有没有 Key」决定 `clear` 还是 null，
   输入框处理器同步 `hasKey` 显示，不再出现「界面说未配置、patch 却没有 `api_key.clear`」。
   回归：单测 ×2（清除 → 替换 → 再清空仍发 clear；盘上无 Key 时输入后清空 = 什么都不改）+
   视觉「清除 Key → 输入替换 → 再清空，仍发 api_key.clear 且显示未配置」。

六条新视觉用例里的五条做了**反向验证**（把 `src/settings-panel.ts` 换回 r2 tip `7fee3c1f` 的版本：
P1-1、P1-2 正向、P2-3、P2-4、P2-5 各按预期判红；「改第二笔」那条是方向覆盖、旧实现不判红，
如实标注），恢复后 28 条全绿。

**r3 验证读数**（rebase 到 `origin/master` `1e93bb74`，含 M741 无 sudo 测试修复之后）：
`pnpm test` 1465 passed；三处 tsc 通过；设置面板视觉 28 passed；`scripts/gate.sh visual` →
**`GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0**（`cargo-test 40s`、`visual-regression 565s`，
视觉套件 874 passed / 1 skipped / 0 failed）；真机 `run.mjs 250 251` → **2/2 PASS，退出码 0**
（250：41 PASS / 0 FAIL；251：10 PASS / 0 FAIL）；`openspec validate --all --strict` 33 passed；
`docs-check` PASS；`acceptance --check` 242 场景。证据见 `.local/reviews/m734-settings-r3/`。

## r4 返修记录（2026-10-25，review r4 p1-1items）

**P1-1 删除未落盘新增时把同 id 的幸存新增也排除了**：`deleteCandidates` 按 **id** 排除整组同 id
条目，「mock 基线 + 两笔同 id 新增 + 删当前第一笔」因此候选为空 → active 回落到 `mock`、patch 不带
`active_provider`（后端缺该字段即不改配置，保存后盘上继续用 mock），删除确认还把「列表里仍有另一笔」
写成「这是最后一个 provider」。修：新增 `replacementCandidates(draft, provider)`——**未落盘条目只
排除它自己**（同 id 的幸存新增保存后就是该 id 的实体），已保存条目仍按 id 排除（`deleteCandidates`
保持原语义：后端按 id 删）；`applyDraftDelete` / `renderDeleteForm` / `openDelete` / 危险区「还有
别的 provider」判据统一走它；候选 id 去重。
回归：单测 ×2（候选清单按身份排除；mock 基线两笔同 id 删第一笔 → patch 同时含幸存
`{action:"add", id:"same"}` 与 `active_provider = set("same")`、`activeOwner` 落到幸存条目）+
视觉「mock 基线 + 两笔同 id 新增，删当前第一笔——替代选择出现且 patch 带幸存 Add 与 active」
（对 r3 tip `48dac6d7` 反向验证：旧实现按「最后一个 provider」判红）。
读数：`pnpm test` 1467 passed；三处 tsc 通过；设置面板视觉 **29 passed**（含 11 张已批基线）；
`scripts/gate.sh quick` → `GATE RESULT: 13/13 PASS（SKIP 0）`；`openspec validate --all --strict`
33 passed；`docs-check` PASS；`acceptance --check` 242 场景。

## 收尾批记录（M743，2026-10-25）

**范围**：tasks §6.1–§6.6 与 §7.1 / 7.2 / 7.6 / 7.9 / 7.11（文档、回扫、门禁、真机全量）。
不动产品代码，不扩产品范围。

### 文档（§6）

- `docs/specs/config-reference.md`：§1.5 拆出 **§1.5.1 `harness.providers`（provider 映射）**——
  id 规则 / preset 入口 / 条目字段表 / 预设行为表（官方 Base URL、Key 要求、缺省与支持的 wire、
  `store:false`、`configured` 判据）/ 当前使用项解析 / 逐条宽容 / 一次性迁移；§1.6 / §1.7 的
  `provider` 取值从闭集合改为「`providers` 表内的 id」；§2 补「provider 条目逐条校验」例外；
  §3 重写为两类写通道（单键合并 + 设置面整笔 patch：严格读 / CAS revision / 非回归 / 删键 /
  未知键保留），并把全部行号改到现值（`write_last_vault_to` :598、`write_config_value_to` :660、
  `write_json_atomic` :2300、`update_json_atomic` :2332、`update_json_atomic_strict` :2361、
  `remember_last_vault` :731、`harness.rs` :1787 / :1816、`cron.rs` :1160 / :1228、
  `main.ts` :2912 / :1529 / :1571 / :2960）。
- `scripts/acceptance/README.md`：`rawProviders` 条补「只验迁移才省 `preset`，新场景显式写」；
  `config.harness` 键表补 `rawProviders` 并指向 `subagents` / `attachment_naming` 两节；
  `kimiModels` 条登记「只写清单也补合成 Key」；原「provider 段恒列三档」块替换为**动态列表 +
  空态 + `configured` 判据**。
- `design/prototypes/index.html`：条目已在 1.6 改准；本轮逐条核对描述与原型一致（16 场景、内联
  命名目标、无摘要框、预设只读、Base URL 密钥目的地警示、`?panel=0`），无漂移，未改。
- `docs/backlog.md`：归档跟踪队列落该 change 一条（M743）。

### 回扫（7.7 的补漏 + 本轮复核）

- **场景 90 的旧断言在动态映射下必红**：它只声明 kimi（清单）与 mock，却断言 Provider 段
  「kimi / deepseek」都在——`deepseek` 已不是可选条目。改为「kimi 在场 + deepseek 不在场」的
  负向判据（旧固定三档实现必红，有区分度）。同时 kimi 条目必须有非空 Key 才 `configured`
  （否则不进可选列表），`lib/app.mjs` 的 `kimiModels` 分支在缺省时补合成 Key（与 `kimiModel`
  同族；显式写下的 Key 不覆盖）。
- **场景 230 / 231**：`config.harness.provider: mock` 但无 fixture ⇒ mock 条目不存在、provider
  悬空。230 只用 harness composer 聚焦（不发送）、231 完全不用 harness，两条断言都不依赖
  provider 读数，保持原样；全量真机跑作为验证（读数见下）。
- 其余 provider 场景：99 / 101 / 102 / 128 / 138 都有 `kimiModel`（合成 Key）或 fixture，102 的
  「模型段只列声明项」断言不受影响。

### 7.11 后半句：`provider-rules-check.mjs` 退役对账

- 删除前复跑 **47/47 PASS**（日志 `.local/reviews/m743-finalize/provider-rules-check-before-delete.log`）；
  36 项原型语义断言同期复跑 **36/36 PASS**。脚本已删除；`design.md` §12.4 与 tasks 1.4 的指针
  已同步标注。
- 29 条正向判定 → Rust 单测映射（18 条 mutant 是脚本自检，不移植）：
  - R1 / R5 → `config::harness_preset_migration_adds_only_preset`；R2 → `..._is_idempotent`；
    R3 → `..._keeps_explicit_preset`；R4 → `..._skips_unknown_ids`
  - R6 → `config::harness_configured_follows_preset`；R7 / R8 / R9 / R10 / R10b →
    `config::harness_active_provider_resolution`
  - R11 → `config::naming_target_resolution` / `naming_override_dangling_falls_back_to_active`；
    R12 → `config::harness_mock_preset_requires_reserved_id` +
    `settings::naming_target_rejects_mock_and_unknown_provider`
  - R12b / R12e → `settings::naming_provider_change_clears_model_and_accepts_same_patch_model`；
    R12c → `settings::naming_target_rejects_mock_and_unknown_provider`；R12d →
    `settings::naming_model_must_be_in_target_list_and_reset_deletes_keys`；R12f →
    `settings::switching_off_naming_keeps_the_target_keys`
  - R12g → `config::session_naming_model_falls_back_when_undeclared` +
    `attachment_naming_keeps_undeclared_model_and_names_the_gate`；R12h →
    `config::naming_defaults_use_explicit_entry_model` + `harness_effective_model_resolution`
  - R13 → `settings::deleting_active_requires_replacement_target`；R14 →
    `deleting_naming_referenced_provider_requires_retarget`；R15 →
    `deleting_active_with_target_rewrites_active_and_clears_following_model`；R16 / R16b →
    `deleting_last_provider_removes_active_and_naming_keys_but_keeps_mock`；R18 / R18b →
    `delete_retarget_must_be_a_valid_non_mock_candidate`；R19 → `config::harness_provider_id_rules`
  - **R17（删非引用项不动 active / 命名）如实登记为唯一薄弱点**：删除计划只在命中 active /
    raw active / 命名引用时才改写，`settings::deleting_an_ignored_entry_is_allowed` 覆盖「删
    非引用条目成功、其余条目不变」，但**没有逐键断言 active / 命名不变**。不宣称 29/29 逐条直断。
- 说明：判据的可执行副本在提案期承担的是「规则自洽」；实现期的真源是 Rust 装载与写通道代码 +
  上述单测，脚本继续留着会成为第二份手抄规则（REVIEW.md「同一语义两处真源」条）。

### 6.6 的落地方式

openspec 1.12.0 归档新 capability 时会携带 delta 的 `## Purpose`（不足 50 字符会告警、strict
判红）。本轮把最终 Purpose 直接写进 `specs/settings/spec.md`（含 6.6 指定句 + 范围说明，>50
字符），并在临时副本上实跑 `archive` + `validate --all --strict`：Purpose 原样进入
`openspec/specs/settings/spec.md`，**33 passed / 0 failed**。归档步骤因此无需再替换占位。

### 门禁与真机读数

**门禁（本地）**

- `scripts/gate.sh visual`（本 worktree 首个全量跑，`CARGO_TARGET_DIR` 指向主仓 warm target）：
  `GATE RESULT: 14/14 PASS（SKIP 1）`，退出码 0。逐项：cargo-fmt 1s / cargo-clippy 12s /
  cargo-test 59s / bindings-drift 0s / schemas-drift 0s / tsc-root 2s / tsc-unit 2s /
  unit-tests 3s / perf-fixture-tests 1s / acceptance-syntax 0s / docs-check 2s /
  openspec-validate 2s / isolation-runs 1s / visual-regression 576s。
- **SKIP 1 = `tsc-visual`**：起跑时 `tests/visual/node_modules` 尚未装好（视觉回归随后由
  `scripts/visual/run.sh` 自行补齐）。依赖装好后单跑 `cd tests/visual && ../../node_modules/.bin/tsc
  --noEmit` → **退出码 0**；`visual-regression` 本身 875 项全绿，SKIP 不是覆盖缺口。
- `docs-check` 与 `openspec validate --all --strict`（33 passed / 0 failed）在 gate 内各有一行 PASS；
  `node scripts/acceptance/run.mjs --check` = 242 场景静态校验通过。

**真机全量（7.9）**

- 命令：`LUMIR_ACCEPTANCE_RESULTS=.local/acceptance/2026-10-25-m743 node scripts/acceptance/run.mjs`
  （dev flavour；证据目录 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-10-25-m743/`，
  `summary.md` + 242 个场景目录 + `run.log` + `app.log`）。
- 读数：**242 个场景：PASS 211、FAIL 24、INVALID 7**（run 08:33:53 → 10:57:24，约 2h23m；
  结束行 `结论：211/242 PASS`；退出码 1）。
- **本 change 直接相关的场景全绿**：90-harness-model-chip（本轮改准的断言：Provider 段只列 kimi、
  deepseek 不在可选列表）、99 / 101 / 102 / 128 / 138（provider / model 维度 / 能力闸）、
  250-settings-panel-provider-crud（41 断言）、251-settings-panel-legacy-preset-migration（10 断言）。
- **INVALID 7 条**（读数不算数，非产品面）：
  - 170 / 171 / 213：`requires: bundle`，dev flavour 按设计直接标 INVALID（通知点击/冷启动投递
    只能在验收 bundle 上判，见套件 README「实例 flavour」）。
  - 189 / 190 / 191 / 206：`config.harness.fixture` 指向 `$env/subagent-fixtures/*.json`，而该文件
    由场景自己的第一个 `envWrite` 步骤写入——配置在启动前就要读 fixture，干净 env 下必然 ENOENT。
    共享 env 目录里残留旧文件时才通过。已作为 finding 上报（`20261025-worker-provider-docs-checks-oc-bug-189-190-191-mock-fixture-env-invalid.md`，
    206 同因）。
- **FAIL 24 条的归因**（没有一条落在 provider / 设置面代码路径上；逐条指针见
  `.local/reviews/m743-finalize/README.md`）：
  - **工具行路径按钮化导致的旧断言**（确定性）：103 / 104 / 111 / 96。工具参数里的文件路径已渲染
    成 `AXButton (…)`，而断言仍按「同一段静态文本里 `vault_read` 后紧跟路径」写正则。已 filed
    finding（`…-bug-103-104-111-path-link.md`，96 同因）。
  - **CGEvent / 键盘注入通道**（环境，README 已登记「已知边界」）：32 / 47 / 52 / 134 / 150 / 230。
    失败形态都是「注入过程中目标消失 / 字符缺失 / 3 次注入后 pattern 0 次」，不是产品读数。
    47 与 52 的复跑仍红（rename 输入在注入期被 AX 重新挂载），但 `src/tree.ts` 自本 change 之前
    未被改动（`git log -1 -- src/tree.ts` = `2ded688b`），归因环境。
  - **固定坐标拖选漂移**：121 / 81。拖选起手点写死 `(900,130)`，当前布局里 assistant 正文在
    `y≈126–133`（截图 `121-…/shots/01-01-两条消息.jpeg`），起手点落在正文下缘 1–2px 内，
    反复 3 次造不出选区。属「断言写死会随布局漂移的坐标」，非产品缺陷。
  - **AX role 漂移**：220。vault 入口现在是 `AXPopUpButton (vault：…（点击查看全部 vault）)`
    （`aria-haspopup` 自多 vault 切换器起就有），断言仍按 `role: AXButton` 找。
  - **已知 backlog 项**：68（`#check` 选区对比度标定）、82 / 83 / 85（backlog 明写的 quote-card
    探针族）、148（同族的 CGEvent 探针项）。
- **复跑**（同机、独立证据目录 `.local/acceptance/2026-10-25-m743-retry/`，15 个场景）：
  131 / 231 / 235 / 236 / 237 **转 PASS**；121 / 134 / 150 / 220 / 223 / 230 / 47 / 52 / 81 / 96
  仍红（形态与首跑一致，归入上面各类）。
  - 其中 235 / 236 / 237 是本 change **直接造成**的期望漂移：新增全局命令 `app.settings-open`
    让键位速查面板的全量计数从 71 变 72。已把三条场景里所有 `71 条命令 · 11 组` / `命中 1 / 71`
    改成 72，复跑三条全绿。
- **24 条 FAIL 的完整账**：5 条复跑转绿（131 / 231 / 235 / 236 / 237）；19 条持续红 = 工具行路径
  按钮化 4（103 / 104 / 111 / 96）+ 注入通道 6（32 / 47 / 52 / 134 / 150 / 230）+ 固定坐标拖选 2
  （121 / 81）+ AX role 漂移 1（220）+ hover 拿不到 bbox 1（223）+ 已知 backlog 5（68 / 82 / 83 /
  85 / 148）。**没有一条落在 provider / 模型 chip / 设置面代码路径上**。
- 合成 Key only：全部场景只用 `acceptance-dummy` / `test-key-…` 形合成串；真实
  `~/.config/lumir` 与真实 vault 全程未读写（套件自带的隔离 `XDG_CONFIG_HOME` 与合成 vault）。
