# Proposal: UI 中英双语——文案层机制与全量文案迁移

- Change ID: ui-language-i18n
- 日期: 2026-09-27
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 裁决原话（2026-09-27，针对 tower「现在不做 i18n 机制」的建议）：**「不采纳你的建议，我希望现在就支持中英双语。」**

触发它的前情是一处**已裁并已落地的裁决**：标签右键菜单三项（deck 的 D149–D151）在 M254 初上屏为中文，Alex 2026-09-27 答复「上屏」给英文，落地载体是 **M257**（`feat/tab-overflow-english-menu-m257`：`src/tabs.ts` 三个常量改英文串 + `文案-Copy.md` 的 D149–D151 两列对调、原中文措辞移到中文列备查）——**已于 2026-09-27 合并**（merge `cd9142d`）。M257 的改动同时把一处结构性缺口摆到台面上：**「界面语言」这个词在仓里被反复引用，而它对应的机制压根不存在**——deck 的编号沿革段与 `src/tabs.ts:41` 的注释都写着「界面语言是中文」「不跟界面语言走的可见文案仍只有 D114 的 END」，而 `AppConfig` 没有语言键、文案全部硬编码在各模块里。本 change 把它实现出来，并给「不跟界面语言走的文案」一个一等的表达（design §4.5 的上屏列锁定）。

### 一、现状：不是「缺一个开关」，是缺一整层

| 事实 | 读数 / 锚点 |
|---|---|
| `[ui]` 表只有两个键 | `theme`（`light`/`dark`/`eink`）与 `content_width`（`src/bindings/UiConfig.ts`）；`AppConfig` 恰为 `version` / `last_vault` / `editor`×7 / `ui`×2 / `keys` / `log`（`src-tauri/src/config.rs:65-95`）——**没有任何语言键** |
| 上屏文案全部硬编码 | 前端含中文的串 **284** 条 / 29 个文件（其中 84 条含 `${}` 插值）；后端 `CommandError` 带中文 message 的构造点 **99** 个 / **46** 个 `code` / **82** 个模板。扣除只进日志的与键位表逐条来由后，候选上屏文案**约 320 条**（读数底稿：[evidence/ui-language-i18n](evidence/ui-string-inventory.md)，可复跑） |
| 文案表存在，但不是运行时真源 | [文案-Copy.md](../../../文案-Copy.md) 自述「本文是产品可见文案 source of truth」，133 行活跃编号（最大 D151），含中英两列 + 「设计意图」列；但 English 列**今天没有任何运行期落点**——单测里只有 **2 个**在运行期解析 deck 的行（`end-marker` / `image-widget`，各带 `deckRow()` helper），另有 **7 个**把措辞写死成字面量、只在注释里引用 D 编号（**改 deck 不会让那 7 个变红**），其余文案靠注释里的 D 编号手工互引 |
| 零 i18n 基础设施 | 全仓无 `i18n` / `locale` / `Intl.` / `navigator.language` 命中；`index.html:2` 写死 `lang="en"`（与全界面中文不符）；日期与相对时间硬编码中文（`src/preview/doc-meta.ts` 的「{月}月{日}日」、`src/vault-switcher.ts:163-171` 的「刚刚 / N 分钟前 / 昨天」） |
| 双语在局部已经存在 | `src/preview/callout.ts:78-90` 的 `register(canonical, zh, …)` 同时持英文 canonical 名与中文标签；`文案-Copy.md` 的每一行都有 English 列——语言面缺的是**取值层**，不是文案本身 |
| 同族机制已经跑通 | M237 的主题运行期切换：`applyTheme` 单一施加点（`src/main.ts:805-816`，模块头明文「MUST NOT 出现第二处 `data-theme` 写入者」）+ 双入口（`view.theme-cycle` 的 ⌘⇧T 与 modeline 指示钮）+ 乐观施加 + `config_set_ui_value` 写回 + 失败降级不回滚 |

### 二、诉求面

「支持中英双语」对用户可见的差别只有一个：**同一条界面文案按当前语言说**。它牵动的面却是全仓（30 个前端模块 + 46 个后端 error code），因此本 change 的实质是**引入一层文案取值层并把既有文案迁进去**，配置项与快捷键只是这层的出入口。

## What Changes

每条对应 [design.md](design.md) 的一节与 `specs/` 增量里的一条 requirement。

1. **文案取值层**（新 capability `ui-language`）：`文案-Copy.md` 保持**规范文本与评审面**（Alex 读的那一份），运行时新增一份按 D 编号索引的**双列表**（zh / en 同在一处），全部上屏文案 MUST 经 `t(key, params)` 取值；既有「各模块自持字面量 + 9 个单测分散断言（其中只有 2 个在运行期解析 deck）」的分散形态收敛为**一张表 + 一条全量漂移测试**（键集合一一对应，逐字相等）。
2. **`[ui] language` 配置键**（`zh` / `en`，**默认 `zh`**——裁决点 D1）：照 `theme` 的三层校验模板（缺字段回落默认不告警 / 非法值回落默认 + 人话 warning / 类型错整文件回落），`UiLanguage` 用闭集合枚举以保住 `UiConfig` 的 `Copy` 派生。
3. **运行期即时切换**（裁决点 D2）：`applyLanguage` 是唯一施加点，运行期真源是 `<html lang>`（顺手修掉 `index.html:2` 的 `lang="en"`）；切换时重写长驻 chrome 的文本（模型信号、树、标签、空态、读屏名）并走既有 `editor.refreshPreview()` 重建预览 widget 的文本；随后 `config_set_ui_value("language", …)` 写回，写失败只 toast、不回滚运行态（与主题同款降级）。
4. **切换入口**（裁决点 D3）：modeline 右段指示钮（可见文本 = 当前语言标识，点击切换）+ 命令 `view.language-cycle`（默认 ⌘⇧L，`global`，单段无空白，可经 `[keys]` 重绑 / 解绑）。两个值的「循环」即切换；**零新增原生菜单项**。
5. **动态文案参数化**（裁决点 D5）：文案表存 `{占位名}` 模板（沿用 deck 现有的 `{原因}`/`{路径}`/`{数量}` 约定，占位名用 ASCII，两列同名并由测试断言）；数字、日期、相对时间、复数走 `Intl`（`NumberFormat` / `DateTimeFormat` / `RelativeTimeFormat` / `PluralRules`），**MUST NOT** 手拼复数或年月日。
6. **Rust 侧人话文案归前端渲染**（裁决点 D6）：`CommandError` 保留 `code`，新增 `params`（值对象）；前端按 `code` 出文案并插参数，`message` 退回「日志 + 未知 code 兜底」；完整性门禁保证 46 个 code 全覆盖（缺一即红，因此兜底不可达）。原生目录选择器标题由 Rust 在弹出时读一次 `ui.language`。
7. **不随界面语言变化的文案是一等公民**：两种形态都由条目自身表达——① **两列同形**（现状 3 条：D77 / D80 / D114 的 `END`）；② **上屏列锁定**（现状 D149–D151 三条标签菜单项：M257 已裁恒定英文上屏，deck 两列对调、上屏取 English 列、原中文措辞留中文列备查）。两者在两种界面语言下上屏文本逐字相同，且都不再靠注释里的散记——今天 `src/tabs.ts:41` 那句「全仓唯一不跟界面语言走的可见文案仍只有 D114 的 END」正随 M257 而失效（它自己已改成「不止 D114 一处」），本 change 把这件事从注释升级为条目属性（[design.md](design.md) §4.5）。
8. **明确不随语言变化的面**（不变量，写进 spec）：文档内容与一切进磁盘的派生物（含崩溃备份的「-恢复」派生文件名）、诊断日志与配置告警、键位面板逐条 `doc`（deck 明文排除）、macOS 原生菜单（半覆盖，见下）。
9. **真机验收场景 55**（编号声明见 [tasks.md](tasks.md) §6）。

## 须提请 Alex 节点 1 裁决的选项

九项都给了推荐项，且推荐项**已按默认写进 delta 与 tasks**；改判备选时按 [tasks.md](tasks.md) 末的「裁决改写指引」改 delta 与任务，不静默扩 scope。

| # | 裁决点 | 推荐（已写进 delta） | 备选 | 一句话取舍 |
|---|---|---|---|---|
| D1 | **默认语言** | **`zh`**：今天全部上屏文案都是 deck 的中文列，默认 zh 意味**开箱体验零变化**；deck 自己的文本两处写着「界面语言是中文」（`文案-Copy.md` 的编号沿革段、`src/tabs.ts:41` 的注释）；deck 的文案是中文列先写、英文列后写 | `en` 默认（若要对外读作英文产品）；或跟随系统语言 | 默认 zh 还有一个直接收益：**既有整页视觉基线零重拍**（迁移必须逐像素中性，任何基线 diff 都说明某条串被悄悄改了）。取 `en` 则全部整页基线要重拍并请 Alex 逐张过目 |
| D2 | **切换是否运行期即时生效** | **即时**（照 M237：单一施加点 + 重绘长驻 chrome + 重建预览装饰 + 写回配置，失败降级不回滚） | 仅配置键 + 重启生效 | 这是**本 change 体量最大的开关**。备选下重绘面整段消失、tasks 减半，代价是切换语言要重启，且与主题（同族偏好的既有范式）两种语义 |
| D3 | **入口形态** | **modeline 指示钮 + `view.language-cycle`（⌘⇧L）双入口**（照 M237；钮是「现在是什么语言」的常驻归因出口） | 仅配置键；仅 modeline 钮（不占快捷键）；原生菜单项 | 原生菜单项是 macOS 惯例的落点，但本仓的应用菜单是 tauri 预置英文、且 Rust 用字符串相等做菜单结构校验（`lib.rs` 的 `is_close_item_text` 等），改菜单要连带重做那套判定——属另一个 change |
| D4 | **文案表技术形态** | **新 TS 文案表（按 D 编号索引）+ 全量 deck 漂移测试**；deck 保持规范文本与评审面 | deck 升格为机器真源 + 生成 TS 表 | deck 的**格是编辑性 bundle 不是「一格一条串」**：D64 一格 9 条、D66 一格 2 条（且会随扩写变）、而 D67 本身就是一条含 ` / ` 的串——机械切分错，人工映射表则不省审查成本。拒绝理由与三条实证见 [design.md](design.md) §4.2 |
| D5 | **动态文案参数化** | **`{占位名}` 模板 + 运行时插值 + `Intl` 家族**（数字 / 日期 / 相对时间 / 复数） | 每条写一个模板函数承载（今天 `tree-menu.ts` 的形态）；ICU MessageFormat 全套 | 模板沿用 deck 已经在用的占位约定，零新约定；`Intl` 覆盖复数与日期，手拼复数是把语言规则写死在代码里。ICU 全套要引入依赖（本仓取向零新增依赖） |
| D6 | **Rust 侧 46 个 `code` 的人话文案** | **前端按 `code` 渲染 + Rust 增 `params`**；`message` 退回日志与兜底；完整性门禁保证 code 全覆盖 | Rust 侧自带双语文案表；或保持现状（en 模式下后端文案仍中文，登记半覆盖） | 前端已有同款雏形（`src/save-controller.ts:147-152` 的 `SAVE_ERROR_HINTS` 就是 `Record<code, string>`），本 change 把 4 个 code 推广到 46 个。保持现状的代价最直观：保存冲突、文件不存在这些**最先撞见**的提示在 en 模式下全是中文 |
| D7 | **覆盖范围** | **全量**（前端约 217 条 + 后端 46 个 code），分期只体现在 tasks 的执行顺序 | 先机制 + 树/菜单/对话框最小可见面，预览与后端二期 | 半覆盖在 dogfood 里第一眼就看出来（同一屏里中英混排），且「残留」会变成长期技术债。代价是 deck 要扩容到约 180–200 行、英文列新写约 190 条——**这是本 change 的关键路径**（Alex 的文案评审节点） |
| D8 | **键位面板逐条「键位来由」（`src/keys.ts` 的 59 处 `doc`）是否纳入** | **不纳入**：deck 明文写着它「不是本 deck 的条目……表即文档，随绑定一起维护」，且是含 M 编号与 Emacs 术语的贡献者说明 | 纳入（+59 条长句翻译，「表即文档」的真源分裂成两份） | 面板骨架 / 分组标题 / 未绑定标注等 16 条**在面内**会跟着切，只有逐条来由固定中文。若 Alex 要求覆盖，另立条目与 change |
| D9 | **三条标签菜单项与 M257 的关系**（M257 已裁**恒定英文上屏**并**已合并 `cd9142d`**；本 change 默认语言 `zh` 时，这三项是否随语言显示中文） | **与 M257 一致：恒定英文**——三条登记为「**上屏列锁定**」条目（无论界面语言都取 English 列；deck 保持 M257 的两列对调形态，原中文措辞留中文列备查），`zh` 界面下这三项仍是英文 | 随界面语言走：`zh` 默认下上屏中文、`en` 上屏英文——**这等于回退 M257 的裁决**，需 Alex 明确改判，且要回退 `src/tabs.ts` 三常量、deck 双列与两处文案断言 | 推荐项不推翻一条刚落地的裁决，且把「不跟界面语言走的文案」从注释里的散记升级为一等的锁列条目（M257 的注释已写「不跟界面语言走的可见文案由此不止 D114 的 END 一处」）。备选的唯一好处是「语言设置管全部界面文案」这条一致性彻底；代价是推翻既有裁决并让已合并的 M257 返工。**两支都不是「例外清单」**——形态落在 deck 行与文案表条目上（design §4.5） |

## Non-goals

- **不做 macOS 应用菜单的本地化，也不新增 / 改造原生菜单项**（tauri/muda 预置英文项；Rust 的菜单结构校验用字符串相等做判据，本身 locale 敏感——改菜单文案要连带重做那套判定，属另一个 change）。
- **不本地化文档内容与其派生物**：正文、frontmatter 值、文件名、路径、wikilink 文本一律不动；崩溃备份的「-恢复」后缀派生文件名**也在内**（它进磁盘，是数据不是文案——同一次崩溃在不同语言下产出不同备份名会毁掉恢复链路与测试判据）。
- **不本地化只进诊断日志 / 配置告警的串**（`console.warn`、`ConfigSnapshot.warnings`、`logging.rs` 的事件名），日志保持中文（面向开发者）。
- **不把键位面板的逐条 `doc` 纳入**（裁决点 D8）。
- **不引入 i18n 依赖库，不引入 ICU MessageFormat**：只用双列表查找 + `{占位名}` 插值 + 标准库 `Intl`。
- **不做第三种语言、不做 RTL、不做语法性数/格变形**（本 change 只解决中英两列与它们需要的格式差异）。
- **不跟随系统语言**（与主题「MUST NOT 引入 `prefers-color-scheme` 通道」同一取舍：显示偏好只有配置一处真源）。若 D1 取跟随系统，此项改写并需回答「系统语言变化时是否运行期跟随」。
- **不改既有 17 个 capability 的行为条款**：本 change 只改「文案从哪来」与新增一个配置键、一条命令。既有 living spec 里写出的中文引文（7 处）**不改写**，在 `ui-language` 里立一条读法条款（读作默认语言取值，不构成语言约束）。
- **不新增 IPC command**：写回复用 `config_set_ui_value`；不新增 `config:changed` 类事件（运行期真源是刚施加的值，MUST NOT 回读）。
- **不做首选项窗口 / 命令面板 / 语言选择对话框**：入口形态由 D3 定，不扩为通用设置界面。
- **不改 `[keys]` 配置面与既有命令行为**（只新增一条命令 id）。

## Impact

- **影响的 specs**：**新建 `ui-language`**（ADDED ×7：文案真源与运行时文案表 / `[ui] language` 配置项 / 运行期切换与单一施加点 / 切换入口与指示钮 / 动态文案参数化与本地化格式 / Rust 侧错误的文案归属 / 不随语言变化的面）；**`keymap-commands` ADDED ×1**（`view.language-cycle` 命令，含默认键位与三条冲突来源的复核口径）。**`ui-design-system` 零增量**——理由与反方记录见 [design.md](design.md) §11。
- **影响的代码/系统**（实现期，本 mission 零产品代码改动）：
  - 新增 `src/copy.ts` 一族（双列文案表 + `t(key, params)` + `applyLanguage` 的重绘注册），约 200 行 + 表数据。
  - `src/main.ts`：`applyLanguage` 与 `applyTheme` 相邻；启动块内加一行；`view.language-cycle` 的实现落在装配层。
  - `src/shell.ts`：modeline 右段新增指示钮 DOM（照主题钮的形态：初始 `hidden`、施加后显示）。
  - 30 个前端模块：把字面量 / 模板函数换成按 key 取值；长驻 chrome 的模块补一个 `relabel()`。
  - `src-tauri/src/config.rs`：`UiConfig.language` + `UiLanguage` 枚举 + `RawUiConfig.language` + `validate()` 一段 + 单测（照 `ui.theme` 的三条现有测试形状）。
  - `src-tauri/src/commands.rs` 等 10 个 Rust 文件的 99 个信封构造点：补 `params`；`CommandError` 加字段（ts-rs 重导出 `src/bindings/**`）。
  - `src/keys.ts`：`NON_TAB_GLOBAL_COMMAND_IDS` 加 `view.language-cycle` + 一条默认绑定（附来由说明，表即文档）。
  - `index.html`：`lang="en"` 交给施加点写入（不再写死）。
- **影响的测试/验收**：
  - `tests/unit/copy.test.ts`（新）：deck↔表全量漂移（含 D64 / D66 / D69 三个多串格的键序列）、两列占位名同名、取值门禁（AST 扫描：`src/**` 除文案表与 `keys.ts` 的 `doc` 外零 CJK 字面量）。
  - `tests/unit/error-text.test.ts`（新）：46 个 code 的覆盖对账与参数插值、未知 code 的兜底。
  - 既有 **9 个**触及可见文案的单测（**2 个**在运行期解析 deck：`end-marker` / `image-widget`；**7 个**把措辞写死成字面量：`tree-menu` / `tree-paths` / `list-filter` / `theme` / `content-width` / `tab-menu` / `table-fullscreen`）：改成断言文案表条目（deck 仍是它们断言的规范文本，路径不变）。
  - `tests/visual/`：**zh 默认下全量基线预期零重拍**（迁移 MUST 逐像素中性——这是本 change 最强的回归判据）；新增一条 en 面场景（chrome 文案 + 切换 + 不残留中文）。
  - `scripts/acceptance/scenarios/55-<slug>.md` + fixture（编号声明见 [tasks.md](tasks.md) §6）。
  - `文案-Copy.md`：扩容到约 180–200 行（新增 D152 起；英文列新写约 190 条）。
- **影响的文档**：`docs/backlog.md:565-570` 的 M254 待裁决点**已随 M257 合并核销**（M257 合并 `cd9142d`；master `8dbbb89` 的提交即「close M254 menu-language decision」），本 change **不再改它**——只在自己的 D9 与实现任务里引用「这三项的英文上屏已定」这一既成事实。`docs/backlog.md` 的「跨语言」相关条目不改。
- **关联约束**：ADR 0003 §3（铁律——装饰与文件名派生都不改文档，本 change 的派生物不随语言变即其下游）；ADR 0002 §5（配置即数据 + schema 校验，三层模板）；ADR 0002 §6（性能合同——文案表是内存查表，不引入全文档扫描；冷启动只多一次查表与一次 `applyLanguage`）；ADR 0002 §3（webview 不直接访问文件系统，本 change 零新 IO）；ADR 0006（键盘路径覆盖新命令）；ADR 0004 §5（功能变更走 OpenSpec）。
- **须提请注意的流程项**：本 change 引入的是**跨切面的文案取值层**（新模块 + 新真源边界 + 一条贯穿全仓的不变量）。按 AGENTS.md 的归属口径，「影响多个 capability 的结构关系」通常要一条 ADR。本 mission 的 scope 只含 `openspec/changes/ui-language-i18n/**`（无 ADR 写权），因此**如实登记**：若 Alex 认为「文案真源分层」需要 ADR 定案，请在节点 1 指示，由后续 mission 承接。

## 边界与已知限制

1. **macOS 应用菜单在两种语言下都是英文**（File / Edit / Window / Undo / Redo / Quit…）。来自 tauri/muda 的预置项，改它要重做 Rust 的菜单结构判定——本 change 不做，如实记账。
2. **键位面板逐条「键位来由」在 en 模式下仍中文**（59 条，裁决点 D8）。面板骨架与分组标题会跟着切。
3. **只进日志的串不切**（配置告警、`console.warn`、事件名），日志保持中文。
4. **正在飞的 toast 不追改**：切换语言时已弹出的浮条保持弹出时的语言直到消隐。
5. **启动首帧可能闪烁**：`ui.language` 经异步 `config_get` 到来，而 shell / 树状态在配置到达前已挂载——`language=en` 时可能先闪一帧中文。机制清楚但**未验**；tasks §1 有逐帧实测项与两条候选缓解，**MUST NOT** 静默接受。
6. **原生目录选择器的标题**由 OS 渲染、无法运行期切换：Rust 在弹出时读一次 `ui.language`，对已弹出的选择器无影响。
7. **写通道不校验**：`config_set_ui_value` 是通用键值盲写（值原样落盘），手写的非法值由下次启动的 `validate()` 兜——与 `ui.theme` 同款既有边界，本 change MUST NOT 给它加第二处写时校验。
8. **既有 living spec 的 7 处中文引文**读作默认语言取值（不改写）。若 Alex 要求把它们统一改为引用 D 编号，是一次独立的收尾治理（涉及 7 个 capability 的 spec 文本与 scenario 名，风险另计）。
9. **三条标签菜单项与 M257 的关系**（M257 已合并 `cd9142d`）：这三项**已由 M257 裁为恒定英文上屏并已落地**（`src/tabs.ts` 三个常量为英文串、`文案-Copy.md` 的 D149–D151 两列已对调、原中文措辞留在中文列备查），master `8dbbb89` 上可见的就是这一形态。处理口径：
   - 本 change 把它们登记为**上屏列锁定**条目（[design.md](design.md) §4.5），按普通文案参数化即可——**MUST NOT** 把它们当普通条目按语言选列，否则 `zh` 界面会显示出中文列的备查措辞，等于悄悄回退 M257 的裁决（这正是 D9 推荐项的全部内容：不改 M257 的结论）。
   - 若节点 1 取 D9 的备选（随语言走），那是**回退一条已合并的裁决**：接触面是同一批四处——`src/tabs.ts` 的三个常量、`文案-Copy.md` 的 D149–D151 三行、`tests/unit/tab-menu.test.ts` 与 `tests/visual/scenes/tab-menu.spec.ts` 的文案断言；需要与本 change 同批改，并在 PR 里写明回退理由。
