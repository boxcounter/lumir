# Tasks: ui-language-i18n

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，不是「跑过了」的口头声明（[REVIEW.md](../../../REVIEW.md) 第 7 条）。

**提案阶段状态（M267，2026-09-27）**：本 change 只到节点 1，以下任务**全部未开工**——`[ ]` 是提案阶段的默认状态。实现批次接手时按第 1 节的读数起手，并把每条任务勾选时的证据指针补进本文件。

**条件项（随节点 1 的裁决改写）**：正文按推荐项写，其中两项**已由 Alex 在节点 1 裁决**（2026-09-27，原话、修正与边界见 [proposal.md](proposal.md) 的「节点 1 裁决」）：**D1 默认 `en`**、**D8 键位来由纳入**。同一条裁决里「日志也纳入」的部分**已被他随后的修正撤回**（「日志消息就固定用英文，无需 i18n」）——原 Non-goals「不本地化只进诊断日志 / 配置告警的串」按其本意保留：日志与配置告警**不进语言面**，日志事件名 / 等级 / 字段名 / 集合值字段 / `code` 也不翻（**不随任何裁决点改判**）。其余按推荐项：D2 运行期即时、D3 双入口、D4 新 TS 文案表 + 漂移测试、D5 `{占位}` + `Intl`、D6 前端按 code 渲染 + Rust 增 `params`、D7 全量覆盖、**D9 三条标签菜单项保持 M257 的恒定英文上屏（按上屏列锁定条目处理）**。任一项改判备选时按「裁决改写指引」一节改 delta 与相应任务，不静默扩 scope。

**体量提示**：本 change 的主成本不在机制（机制照抄 M237 的形状），而在**文案迁移与英文列的新写**（第 3 节是关键路径，需要 Alex 的文案评审）。键位来由 59 条纳入后第 3 节上修（见 3.7）、默认语言改判 `en` 后基线重拍成本上修（见 8.1）；日志 / 告警文本不进面，因此第 5 节不因语言面而扩。第 2 节完成后机制即可验证；第 3–4 节的量与 §1 的读数一致。

## 1. 现状读数与反向验证（实现前，先测再改）

- [ ] 1.1 复跑读数底稿并**改准数字**：`node openspec/changes/ui-language-i18n/evidence/count-ui-strings.mjs`，把 implementation 时点与随后一次全仓改动前的数字写进 [design.md](design.md) §1.1 / §1.2（本提案的数字是提案时点的读数）。
  **验收口径**：读数命令可复跑、输出落 `test-results/` 与 [evidence/ui-string-inventory.md](evidence/ui-string-inventory.md) 两侧；design 表里的每个数字都能在该输出里找到。
- [ ] 1.2 产出**逐条覆盖清单**（不是抽样）：把前端 284 条与后端 99 个构造点逐条判定「进双语面 / 不进（并写明归属 §design 8.1–8.4 的哪一类）」，落 `test-results/<日期>/ui-language-inventory/coverage.csv`（列：文件、行、原文、判定、去向键）。**终裁后「不进」是两类**：只进诊断日志 / 配置告警的串（`console.warn`、`ConfigSnapshot.warnings`、日志事件名与字段名）与机器可读标识符（等级 / 集合值字段 / `code`）；**键位来由 59 条归「进」**（原扣除项已由终裁取消）。
  **验收口径**：清单条数与 1.1 的读数一致（差额逐条写明理由）；「不进」的每一条都能指到 design §8 的某一类；清单里的「进」集与第 3 节的 deck 新条目一一对应；59 条键位来由各有一行。
- [ ] 1.3 反向验证（先红，REVIEW.md 第 1 条防线）：先写出四条断言在**未实现前**跑一次，必须全部 FAIL——① 取值门禁（`src/**` 除文案表外零 CJK 字面量）；② 漂移门禁（deck ↔ 表全量）；③ `en` 下 modeline 与树头部取英文列；④ 键位面板逐条来由在 `en` 下取英文列（终裁后新纳入的面）。
  **验收口径**：四条红灯输出留档（`test-results/`）；没有这一步的绿灯不算数。
- [ ] 1.4 **启动首帧闪烁实测**（design §9 的未验项）：默认语言已裁为 `en`，因此风险落在**配置为 `zh` 的用户**——在 `ui.language = zh` 的配置下逐帧抓启动序列（`pnpm tauri dev` + KimiCU 截图，或录屏抽帧），判定是否出现「英文首帧 → 中文」的可见闪烁。
  **验收口径**：结论与帧证据落 `test-results/<日期>/ui-language-startup-flash/`；**测出闪烁必须处理**（两条候选缓解见 design §9），测不出也要留可复算的帧证据（不能只写「没看到」）。
- [ ] 1.5 核对三处机制（决定实现细节，design §5.2 / §5.3）：
  ① `⌘⇧L` 的三条冲突来源复核（表内 / muda 预置 accelerator 集合 / macOS 预置）——**不得引用本提案的读数当结论**；
  ② `applyLanguage` 与 `configGet()` 块的相对位置在桩环境下是否与 `applyTheme` 同款安全（缺 `ui` 表时只让语言不施加）；
  ③ 长驻 chrome 的清单是否完整：以「切换后逐面截图比对」为准，而不是以模块清单为准。
  **验收口径**：三条结论写进实现 PR；与 design 推断不符的先改 design 再动手。
- [ ] 1.6 `Intl` 在真机 WKWebView 的可用性实测：`Intl.PluralRules` / `RelativeTimeFormat` / `DateTimeFormat` 的 `zh-Hans` 与 `en` 输出各取一次真实读数（真机控制台或一条临时场景）。
  **验收口径**：读数落 `test-results/`；若某项不可用（如 ICU 裁剪），回来改 design 并重走节点 1（MUST NOT 静默换成手写格式）。
- [ ] 1.7 **键位来由的映射清单**（终裁后新纳入的面）：给出「键位来由 59 条 → 文案表键」的映射表（落 `coverage.csv` 的「去向键」列），并核对 `src/keys.ts` 的 59 条 `doc` 与 deck 对应关系；日志 / 配置告警的 26 条（Rust 18 + TS 8）**不进面**，只在清单里登记为「不进（日志面，终裁固定语言）」。
  **验收口径**：59 条来由与 59 个键一一对应，映射表可被 3.7 的漂移断言直接消费；26 条日志 / 告警文本各有指向 design §8.2 的「不进」判定；清单落 `test-results/<日期>/ui-language-inventory/`。

## 2. 机制（文案层 + 配置键 + 施加点）

- [ ] 2.1 新增文案表模块（`src/copy.ts` 一族）：双列数据 + `CopyKey` 类型 + `t(key, params)` + 当前语言读取（读 `<html lang>`）+ 重绘注册（`relabel` 回调集合）。MUST NOT 引入依赖、MUST NOT 在模块内另存当前语言状态。
  **验收口径**：`git diff package.json` 的 dependencies 为空；模块内除表数据外零 CJK 字面量；`t()` 的插值对两列占位名不同名时判错（负向单测）。
- [ ] 2.2 `src-tauri/src/config.rs`：`UiLanguage` 闭集合枚举 + `UiConfig.language` + `RawUiConfig.language` + `validate()` 一段（照 `ui.theme` 的三层模板）+ 三条单测（配置驱动 / 非法值回落 + warning / 类型不符整文件回落）。
  **验收口径**：`cargo test` 绿；三条新单测的命名与 `ui.theme` 的三条同族；`cargo tree -e features` 确认 `UiConfig` 的 `Copy` 派生未被打破（编译即可证）；`src/bindings/**` 重导出后**先 `git add` 再跑 quick**（M249 口径）。
- [ ] 2.3 `src/main.ts`：`applyLanguage(lang)` 唯一施加点——写 `<html lang>`、设置文案层语言、按注册顺序跑 `relabel()`、调 `editor.refreshPreview()`；启动块内加一行（与 `applyTheme` 相邻、同属块内末尾一族）。
  **验收口径**：全仓只有一处写 `<html lang>`（`rg`）；把重绘段临时注释掉后第 8 节的 en 面场景必须红（否则断言形同没有）；`index.html` 不再写死 `lang="en"`。
- [ ] 2.4 配置写回：切换时经 `configSetUiValue("language", next)` 写回；失败只 toast + `logEvent("config_warning", {source: "language", …})`，**不回滚运行态**。
  **验收口径**：写失败（可用只读 config 目录或 stub 制造）时语言保持已切换、toast 出现、诊断事件落盘；`git diff src-tauri/src/commands.rs` 里无新增写命令。
- [ ] 2.5 modeline 指示钮：`src/shell.ts` 建 DOM（初始 `hidden`），施加点写可见文本 + `title` + `aria-label`，点击走同一条实现路径。
  **验收口径**：未施加前隐藏；施加后文本随语言更新；`rg` 确认钮的写入者只有施加点一处（与主题钮同款纪律）。
- [ ] 2.6 `view.language-cycle`：`src/keys.ts` 的 `NON_TAB_GLOBAL_COMMAND_IDS` 加一条 + 默认绑定 `Cmd-Shift-L`（附来由说明，写明三条冲突来源的复核结果）+ 装配层实现。
  **验收口径**：键位面板里出现该命令且带来由说明；`KEYLESS_COMMAND_IDS` 内容不变；三项对账（`COMMAND_IDS` / `KEY_BINDINGS` / `KEYLESS_COMMAND_IDS`）单测绿。

## 3. 文案表与 deck 对齐（关键路径，需 Alex 文案评审）

- [ ] 3.1 deck 扩容：按 1.2 的覆盖清单为每条进面的串补 D 编号（**编号起点重基**：实现期 deck 末位续接，按当前 master 读数预计 D156 起——D152 = M261、D153–D155 = M263；动工前再核一次末位，见 §10.1；只追加不复用），补全中英两列与「设计意图」列；不随语言变化的条目按形态写——**两列同形**（D114 式）或**上屏列锁定**（D149–D151，M257 式；MUST 在「设计意图」列写明锁定方向）。
  **验收口径**：deck 行数 ≈ 覆盖清单的「进」集去重后的条数（差额逐条说明）；无编号复用（对照 deck 的「编号沿革」段，含 M261 / M263 已占号的复核）。
- [ ] 3.2 英文列新写：条数以 3.1 的实际条数为准（原估约 190 条，终裁纳入键位来由 59 条后上修；日志 / 告警文本不进面，不贡献条数）。术语与语气按 deck 既有 English 列的体例（`Close` / `Unclosed` 风格的动作短语、`MUST NOT` 之外的文案不出现中英混排）。
  **验收口径**：逐条有英文列；**请 Alex 过目英文列**（这是本 change 的文案评审节点，与视觉基线同级的人肉裁决点）。
- [ ] 3.3 多串格的键序列：为 D64 / D66 / D69 这类格内多串的行在漂移测试里显式声明键序列（附「为什么不能按分隔符机械切分」的注释，反例取 D67）。
  **验收口径**：D64 的 9 条、D66 的 2 条、D69 的 2 条各自的键与格内顺序逐条相等；D67 整体一条（不被切分）——四条断言各自可单独读出。
- [ ] 3.4 `tests/unit/copy.test.ts`：漂移门禁（全量 + 键集合一一对应 + 两列占位名同名）+ 取值门禁（AST 扫描，允许清单**只有文案表自身**——`keys.ts` 的 `doc` 改为键引用后不再是豁免项，见 4.6）。
  **验收口径**：1.3 的两条红灯在此转绿；**往文案表里改一个字**后漂移门禁必须红；**在任一模块写一条中文串**后取值门禁必须红（两次反向验证各自留档）；允许清单里出现除文案表以外的路径时测试自身判错。
- [ ] 3.5 既有 **9 个**触及可见文案的单测改为断言文案表条目（断言对象仍是 deck 行——规范文本不变，路径改成经表的键）。其中 **2 个在运行期解析 deck**（`end-marker` / `image-widget`，各带 `deckRow()` helper + `readFileSync`），**7 个把措辞写死成字面量**（`tree-menu` / `tree-paths` / `list-filter` / `theme` / `content-width` / `tab-menu` / `table-fullscreen`；其中 `tree-paths` 断的是 Rust 侧 `fs_io.rs` 的同源措辞，5 个在注释里引用 D 编号）——**单独改 deck 不会让那 7 个变红**，这正是本 change 把覆盖面收敛成一张表 + 一条全量门禁的论据。
  **验收口径**：`node tests/unit/run.mjs` 绿；改造后这 9 个的失败信息都能指出是 deck 的哪一行不一致（改造前只有 2 个具备这种能力）。
- [ ] 3.6 （条件项：D9 取推荐项才做）**上屏列锁定**条目：文案表条目带锁列属性，`t()` 对锁列条目忽略当前界面语言；漂移门禁断言锁列方向与 deck 的「设计意图」列一致；MUST 断言 `zh` 界面下上屏的是锁定列（**不是**中文列里的备查措辞）。
  **验收口径**：`zh` 与 `en` 两种界面语言下 D149–D151 的渲染文本逐字相同、且等于 deck 的 English 列；把锁列属性摘掉后该断言必须红（反向验证留档）。
- [ ] 3.7 **59 条键位来由进 deck**（节点 1 裁决后新纳入的面）：按 1.7 的映射表为每条来由建文案条目（含两列与「设计意图」列），英文列保留 `M149` / `Emacs` / `⌘⇧L` 这类术语的原形、只译句子；deck 的「编号沿革」段同步改准原「表即文档……不是本 deck 的条目」的口径（否则 deck 自述与实现互相打脸）。
  **验收口径**：59 条来由各有键、两列齐备；术语原形保留（`rg` 抽查 `M\\d+` 与 `Emacs` 在英文列的出现）；改准后的 deck 措辞与 4.6 的实现一致；**请 Alex 过目英文列**（与 3.2 同一评审节点）。

## 4. 前端迁移（按承载面分组）

每条的统一验收口径：该面的文案在 `zh` 下与迁移前**逐字相同**（迁移是纯搬运），在 `en` 下取英文列；`en` 下不残留中文（含读屏名与悬停提示）。

- [ ] 4.1 菜单与确认框：`src/tree-menu.ts`（7 项 + 确认框 5 句）、`src/tabs.ts`（读屏名 + 3 项）——`tabs.ts` 的三项按裁决 D9 落点写。
- [ ] 4.2 toast 与守护提示：`src/save-controller.ts`（28+，含 4 个 code 的 `SAVE_ERROR_HINTS` 迁入表）、`src/link-follow.ts`、`src/theme.ts`、`src/content-width.ts`、`src/main.ts` 的若干条。
- [ ] 4.3 modeline 与状态行：`src/main.ts` 的 `无当前文件` / `（未保存）` / `${language} · ${lines} 行 · UTF-8`（行数走 `Intl.NumberFormat`）、`src/toc.ts` 的指示钮提示、`src/theme.ts` 的主题钮文案。
- [ ] 4.4 文件树：`src/tree.ts` 的头部 `title`/`aria-label`、空态、内联编辑三条读屏名、5 条行内校验原因（D143–D147，与 Rust 的 `fs_name_invalid` 同源，两处取同一个键）。
- [ ] 4.5 浮层 / 面板 / 搜索：`src/toc.ts`、`src/vault-switcher.ts`（含相对时间走 `Intl.RelativeTimeFormat`、计数走 `Intl`）、`src/search.ts`、`src/list-filter.ts`（两处浮层共用的三个常量）。
- [ ] 4.6 键位面板：`src/bindings-panel.ts`（骨架 16 条）+ **逐条来由 59 条**（节点 1 裁决后纳入）——`src/keys.ts` 的 `doc` 文本字段改为 `docKey`（指向文案表），面板渲染时经 `t(docKey)` 取值；`.doc` 的字面量清空后取值门禁（3.4）不再需要豁免。
  **验收口径**：`en` 下打开键位面板，骨架与逐条来由**全部**取英文列（无中文残留）；`zh` 下与迁移前逐字相同；`rg "doc:" src/keys.ts` 的命中只剩键引用形态；1.3④ 的红灯在此转绿。
- [ ] 4.7 预览装饰与 widget：`src/preview/` 下 `livePreview.ts`、`attachments.ts`、`math.ts`、`mermaid.ts`、`table.ts`（含 `data-degraded` 的降级归因句）、`frontmatter.ts`、`callout.ts`（13 个类型标签）、`lists.ts`、`table-trigger.ts`、`doc-title.ts`、`doc-meta.ts`（日期走 `Intl.DateTimeFormat`）、`endMarker.ts`（两列同形，不动）。
  **验收口径**：切换后**已渲染的**表格降级归因句与附件提示同步换语言（这一条专门钉 `data-degraded` 经 `attr()` 上屏的路径——属性不重建就不变）。
- [ ] 4.8 长驻 chrome 的 `relabel()`：按 1.5③ 的完整清单为每个承载长驻文案的模块补重写路径，并接入施加点的重绘循环。
  **验收口径**：`rg` 出的每个长驻写入点都能在切换后重跑；切换两次（`zh→en→zh`）后逐面截图与初始 `zh` 态逐像素相同（往返幂等）。
- [ ] 4.9 不回读、不新增事件：`rg "config:changed\|config-changed" src/` 无新增命中；切换的运行期真源只有施加点写入的那份状态。

## 5. 后端文案归属（裁决点 D6）

- [ ] 5.1 `src-tauri/src/commands.rs` 的 `CommandError` 增 `params`（键值对，缺失可省）并重导出 bindings；99 个带中文 message 的构造点按 1.2 的清单补参数（无参数的模板不补）。
  **验收口径**：`cargo test` 绿；`git diff --stat` 显示改动集中在信封构造点；`src/bindings/CommandError.ts` 已重导出并 `git add`（M249）。
- [ ] 5.2 前端 `errorText(e)`：`isCommandError` → 有文案条目则按 `code` 渲染并插参数；无条目回落 `e.message`（不可达，见 5.3）；`errorMessage()` 的既有调用点逐处改到 `errorText`（日志与诊断仍用 `message`——日志面不进语言面，见 12.1）。
  **验收口径**：`rg "errorMessage\(" src/` 的剩余命中都能指到「日志 / 诊断」用途；toast 与 notice 的路径全部走 `errorText`。
- [ ] 5.3 完整性门禁：后端可能产出的 code 集合与前端文案条目逐一对账（集合来源写清：源码扫描或共享清单），缺一即红。
  **验收口径**：**临时删掉**一条 code 的文案条目后门禁必须红（反向验证留档）；门禁输出里能读到 code 总数（本提案读数 46，实现期以 1.1 为准）。
- [ ] 5.4 原生目录选择器标题：Rust 在弹出时读一次语言再设标题。
  **验收口径**：`en` 下标题为英文、`zh` 下与今天逐字相同；已弹出对话框不跟随切换（如实写进 PR）。
- [ ] 5.5 启动恢复 notice 等非信封的后端可见文案：按同一张 code 表 + 参数路径处理。
  **验收口径**：`en` 下启动恢复提示为英文；日志内容不变（日志面不进语言面）。

## 6. 入口与指示钮的真机面

- [ ] 6.1 指示钮形态核对：与主题钮同族（右段末尾、初始 `hidden`、点击切换、悬停提示与读屏名齐备）。
  **验收口径**：三主题（light / dark / eink）下钮的可见性正常；窄窗退让时不与版本号段互相遮挡（照 M236/M237 的判据）。
- [ ] 6.2 双入口同源核对：命令与钮点击走同一条实现路径（`rg` 出一处实现、两处调用）。
  **验收口径**：分别触发两次，行为逐项一致；把钮的点击监听摘掉后命令仍工作（互不依赖）。

## 7. 单测（`tests/unit`，纯逻辑层）

- [ ] 7.1 文案表层：漂移门禁（全量）、取值门禁、两列占位名同名、多串格键序列（3.4 覆盖）。
- [ ] 7.2 `t()` 的插值与缺参：少传一个参数时报错（不静默留空位）；多传参数不报错（向前兼容）。
  **验收口径**：两条用例各自可单独读出；失败信息带上键名与缺失的占位名。
- [ ] 7.3 `errorText()`：code 覆盖、参数插值、未知 code 兜底、`zh` / `en` 两态。
  **验收口径**：参数化用例逐条给 case，失败信息带 code。
- [ ] 7.4 格式化：`Intl` 的复数（`1 tab` / `2 tabs` 与中文同形的对照）、日期、相对时间各一条，`zh` / `en` 两态。
  **验收口径**：`node tests/unit/run.mjs` PASS，新增用例数写进 PR。
- [ ] 7.5 语言域的纯逻辑（`currentLanguage()` 读 `<html lang>`、下一步语言的推导）与 M237 的 `theme.ts` 同款分层：纯逻辑单测，DOM 写入归装配层。
  **验收口径**：单测层不造 DOM 替身（本仓纪律）。

## 8. 视觉与基线（chromium，CI 结构层 + 本地像素层）

- [ ] 8.1 **默认 `en` 的基线全量重拍**（D1 已裁 `en`）：迁移落地后本地全量跑视觉套件，**既有整页基线（中文态）全部重拍**；重拍前逐张出对比图、逐张请 Alex 过目（`--update-snapshots` 不得裸跑，AGENTS.md 的硬规则「基线更新是人肉裁决点」）。
  **验收口径**：`LUMIR_VISUAL_PORT=<自选> bash scripts/gate.sh visual` 全绿；每一张变动的基线都能**定位到具体是哪条串/哪个面被改**（不放过「差值很小」的绿灯）；过目记录（逐张或分批）落 `test-results/<日期>/ui-language-baselines/`。
- [ ] 8.2 **zh 迁移中性（一次性对照）**：把 `ui.language` 固定为 `zh` 跑一遍全量视觉套件，与**重拍前的旧基线**逐像素比对——迁移是纯搬运，`zh` 下任何基线 diff 都说明某条串被改了。这是本 change 最强的回归判据，默认语言改判后它不再免费获得，必须显式跑一次。
  **验收口径**：对照跑全绿（或每条 diff 都被定位并解释）；对照用的基线快照与结论留档（`git stash` / 临时目录留存旧基线的方式写进 PR）。
- [ ] 8.3 en 面新场景：一条新场景断言 `en` 下 chrome 文案（树头部 / modeline / 标签读屏名 / 一条 toast）+ 切换前后 + 「切换后不残留中文」的负向断言（配对正观测，REVIEW.md 第 2 条）。
  **验收口径**：负向断言（不残留中文）必须配一条正观测（同一场景里 `en` 文案确实上屏）；断言能单独读出是哪一个面。
- [ ] 8.4 预览装饰随切换重建：断言已渲染的表格降级归因句在切换后换语言（专门钉 `data-degraded` + `attr()` 的路径）。
  **验收口径**：1.3③/2.3 的「注释掉重绘段即红」在此可复核。
- [ ] 8.5 反向验证：把 `applyLanguage` 的重绘段注释掉后 8.3 / 8.4 必须红，红灯留档。
- [ ] 8.6 基线处置纪律：本 change **不新增整页基线**（en 面由 8.3 的场景覆盖，不为每个既有场景加第二份 en 基线——成本与收益不成比例，如实写进 PR 的覆盖声明），但**既有基线全部重拍**（8.1，默认语言改判的直接后果）；重拍按 [tests/visual/README.md](../../../tests/visual/README.md) 先出对比图请 Alex 过目再 `--update-snapshots=all`。
  **验收口径**：PR 写明「新增基线 = 0、重拍基线 = <张数>」+ 逐张过目记录；裸跑 `--update-snapshots` 不算。

## 9. 真机验收场景（WKWebView，`scripts/acceptance/`）

- [ ] 9.1 新增 `scripts/acceptance/scenarios/55-<slug>.md` + fixture（**编号声明见下**）：**fixture 把 `ui.language` 配为 `zh`**（默认已裁为 `en`，切换动作必须有起点），断言 `⌘⇧L` 切到 `en` 后 chrome 文案上屏为英文（modeline 提示、树头部 `title`/`aria-label`）+ 写回配置（读 `env/lumir/config.json` 的 `ui.language` = `en`）+ 重启后首帧即配置语言 + 结尾两条 `unchangedSince`（编辑器内容与磁盘 sha256）。
  **验收口径**：`node scripts/acceptance/run.mjs --check` 静态校验 PASS；`run.mjs 55` 真机 PASS，证据落 `test-results/acceptance/<日期>/55-<slug>/`（`status.txt` = PASS）。
- [ ] 9.2 真机反向验证：去掉切换入口的接线（或回退实现）跑同一场景，断言必须 FAIL，FAIL 留档（结果目录另开，不覆盖 PASS 证据）。
  **验收口径**：红灯输出与 PASS 证据分目录存放，两份都可 `ls`。
- [ ] 9.3 真机判据不漏「AX 可读 ≠ 元素可见」（M178 陷阱）：装饰与 chrome 断言同时钉「文本在场」与「编辑器文本可读」。
  **验收口径**：steps.md 里两条断言并列出现。
- [ ] 9.4 启动首帧闪烁的真机复核（与 1.4 同判据，在真实 WKWebView 下再测一次，chromium 的结论不作数；配置取 `ui.language = zh`——默认语言已裁为 `en`，闪烁风险落在 `zh` 用户）。
  **验收口径**：结论与帧证据落结果目录；测出闪烁必须闭环（否则本 change 不达验收）。
- [ ] 9.5 日志 / 告警面**不进语言面**的真机核对（终裁的负向断言）：切换语言前后各触发一条配置告警，断言日志负载的 `message` 与事件名 `config_warning`、`source` 字段、等级**逐字相同**（不随界面语言变化）。
  **验收口径**：负向断言（日志文本未变）要有一条正观测（同一次交互里界面文案确实换了语言）配对（REVIEW.md 第 2 条）；从 `env/lumir/logs/*.jsonl` 读回原文留档（`config_dir()` = `$XDG_CONFIG_HOME/lumir`，日志写 `<config_dir>/logs/`，与 9.1 的 `env/lumir/config.json` 同根）。

### 编号声明

真机场景取 **55**。依据（2026-09-27 对 master `8dbbb89` 实测）：`scripts/acceptance/scenarios/` 现有**文件**的最大编号是 **52**（`52-dir-rename-expand.md`，M258）；`51-tab-overflow.md` 是 M257 的场景（已合并 `cd9142d`）。其余号由在飞的手持：**53 = M259**（其广播登记）、**54 = M260**（change `bare-url-cmd-click`，其 `tasks.md` §6 已声明该号，提案在 master）、**56 = M261**（change `goto-line-command`，其 `tasks.md` §6 取 56 并明写「**55 归 M267**」）。因此本 change 取 **55**，与 M261 的声明互相印证。实现期动工前须按既定纪律（`openspec/changes/archive/2026-09-27-list-tab-indent/tasks.md` §6 的口径）**再核一次目录与在飞 change 的编号声明**，不盲取。

## 10. 文案 deck

- [ ] 10.1 `文案-Copy.md` 的「编号沿革」段补本批的 D 区间（**起点按编号重基确定**，见下）与「文案实现备注」段的实现落点（表模块 + 漂移测试路径），语言无关条目（含两列同形的新条目）在该段写明；**「表即文档……不是本 deck 的条目」的旧口径要按 3.7 改准**（59 条键位来由已纳入）。
  **验收口径**：新段的写法与既有各批同构（读一遍 D125–D151 那几段即知体例）；deck 里不再出现「界面语言是中文」这类已过时的断言——M257 已把 deck 的编号沿革段与 `src/tabs.ts` 的注释改写为「不跟界面语言走的可见文案由此不止 D114 的 END 一处」；**当前基座上真正残留的过时断言是 `文案-Copy.md:105`（D114 行）的「它是全仓唯一一处不跟界面语言走的可见文案」**（「唯一」已被 D149–D151 推翻），本 change 把这一处改准。
- [ ] 10.2 **deck 编号起点重基（本 change 的编号声明）**：原声明「新增 D152 起」与 M261 撞号。依 `docs/backlog.md` 的「文案 deck D152 编号碰撞」节 tower 裁决（2026-09-27）：M261（`goto-line-command`）占 **D152 起**、M263（`block-copy-affordance`）占 **D153–D155**，**本 change 的起点重基为「实现期 deck 末位续接」**——按当前 master `8dbbb89` 的读数（deck 末位 D151）预计 **D156 起**；M265（`vault-switch-restore-perf`）的试占同为 D156，因此**动工前 MUST 再核一次 deck 末位与在飞 change 的声明，不盲取**（与 3.1、proposal 的「deck 编号声明（重基）」同源）。
  **验收口径**：动工前的一次末位核对结论写进实现 PR（含当时 deck 的最大编号与每份在飞 change 的声明）；本批新增编号与 M261 / M263 / M265 的区间无重叠；deck 的「编号沿革」段与 proposal / tasks 的编号声明三处一致。
- [ ] 10.3 D149–D151（标签菜单三项）与 M257 定稿：**M257 已合并（merge `cd9142d`），master 上 `src/tabs.ts` 三常量已是英文串、deck 两列已对调**——D9 取推荐项（默认）时现状即目标，本 change 只把它们登记为**上屏列锁定**条目（3.6）、不动那三处串；D9 取备选（随语言走）则要**回退 M257 的裁决**：三常量改回中文、deck 双列复位、`tests/unit/tab-menu.test.ts` 与 `tests/visual/scenes/tab-menu.spec.ts` 两处断言同步。
  **验收口径**：deck 行、`src/tabs.ts` 常量、`tests/unit/tab-menu.test.ts`、`tests/visual/scenes/tab-menu.spec.ts` 与文案表的锁列属性五者一致；推荐项下 `zh` 与 `en` 两种界面语言的渲染文本逐字相同、且等于 deck 的 English 列。

## 11. 验证与收官

- [ ] 11.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过，`change/ui-language-i18n` 为 ✓。
- [ ] 11.2 `bash scripts/gate.sh quick` 与 `LUMIR_VISUAL_PORT=<自选> bash scripts/gate.sh visual` 全绿（视觉侧本地跑，CI 只跑结构层）；真机 `node scripts/acceptance/run.mjs 55` 至少跑一次并留档。
- [ ] 11.3 `git diff --check` 通过；改动文件集合与 [proposal.md](proposal.md) 的 Impact 清单一致（出现跨 scope 的只读依赖先报 tower 批准）。
- [ ] 11.4 收官对账：tasks 全部勾选（或标注放弃原因）、spec 增量与实现一致（无实现期静默扩 scope）、living spec 归档另走节点 2；`docs/backlog.md:565-570` 的 M254 待裁决点**已随 M257 合并核销**（master `8dbbb89`），本 change 不再改它；`docs/backlog.md` 里新登记的边界（原生菜单半覆盖、**日志 / 配置告警不进语言面（终裁）与那处待确认的「固定英文」口径**、键位来由纳入、首帧闪烁结论、默认语言改判带来的基线重拍）各落一条。

## 12. 已声明的边界 / 不做

- [ ] 12.1 不做：macOS 应用菜单本地化与新增原生菜单项；文档内容与派生文件名的语言化；**只进诊断日志 / 配置告警的串**（终裁：诊断面向开发者、语言固定——含 `console.warn`、`ConfigSnapshot.warnings`、日志 `message` 与事件名 / 等级 / 字段名 / 集合值字段 / `CommandError.code`）；i18n 依赖库与 ICU MessageFormat；第三种语言与 RTL；跟随系统语言；既有 17 个 capability 的行为条款改写与新 IPC 命令。**12.1 随终裁只收缩了一处**：键位面板逐条 `doc`（59 处）原是「不做」，现已纳入（见 3.7 / 4.6）；日志那一项**保持不做**。
  **验收口径**：`git diff --stat src-tauri/src/lib.rs` 里无菜单项改动（除信封参数）；`git diff src/save-controller.ts` 里派生文件名的「恢复」仍是字面量（不在文案表里）；`rg "i18next\|formatjs\|intl-messageformat" package.json pnpm-lock.yaml` 零命中；`git diff src-tauri/src/logging.rs` 与 `config.rs` 的告警文本、事件名、白名单**无改动**。
- [ ] 12.2 已知边界如实写进 spec 与实现 PR：① macOS 菜单两种语言下都是英文（半覆盖）；② **键位面板逐条来由随语言切（终裁纳入）**——它的英文列是贡献者说明的翻译，术语保留原形；③ **日志与配置告警不进语言面**（终裁：诊断面向开发者、语言固定；现状文本为中文、事件名 / 字段名是英文标识符，终裁用词「固定英文」与现状文本的差异已在 proposal 的「节点 1 裁决」段报备）；④ 在飞的 toast 不追改；⑤ 首帧闪烁的实测结论与处置（默认 `en` 下风险落在 `zh` 用户）；⑥ 原生目录选择器标题按弹出时语言取值、已弹出的不跟随；⑦ 写通道盲写的既有边界；⑧ 既有 living spec 的 7 处中文引文读作该串在 `zh` 界面下的取值（不改写）；⑨ 三条标签菜单项在 `zh` 界面下仍是英文（上屏列锁定，与 M257 一致）及其与 M257 的合并顺序处置；⑩ **默认语言改判为 `en`** ⇒ 既有整页基线全量重拍（人肉裁决点）+ 未配置用户的原生对话框标题由中文变英文。
  **验收口径**：十条在 spec 与 PR 里各有一条对应文字（⑨ 同时要指到 proposal 边界清单的「三条标签菜单项」项；②③ 要指到 proposal 的「节点 1 裁决」段）。

## 裁决改写指引（任一项改判备选时照此执行）

| 裁决点 | 取备选时的改写动作 |
|---|---|
| D1 默认 `zh`（**备选**——默认已裁 `en`，此项现指「改回 `zh`」） | delta：`ui.language` 的默认值改回 `zh`（requirement text 与 scenario）；「配置驱动语言」scenario 的 WHEN/THEN 对调。tasks：8.1 / 8.2 的基线判据复位为「零重拍即迁移中性」（一次性 zh 对照不再需要）；10.1 的编号沿革改写默认语言；proposal 的 D1 行与「节点 1 裁决」段记一次改判。 |
| D2 仅配置 + 重启生效 | delta：删「运行期语言切换与单一施加点」里的重绘段与指示钮点击语义，改为「启动施加一次、运行期不切换」；删「在飞的浮条不追改」scenario；「语言切换入口与指示钮」整条降级为「modeline 只读指示（显示当前语言，不可点）」或整条删除。tasks：删 2.5 / 2.6 / 4.8 / 6.x / 8.4 / 8.5；8.3 改为「配置 `zh` 重启后的 chrome 断言」（默认 `en` 时改为「配置 `zh` 后重启」）；9.1 改为「改配置 + 重启」。**这是体量减半的一处改写**。 |
| D3 去掉快捷键 | delta：`keymap-commands` 的整条 requirement 删除，改在 `ui-language` 记「无命令入口，仅指示钮」；`KEYLESS_COMMAND_IDS` 不受影响。tasks：删 2.6 与 6.2 的命令侧、7.x 里键位相关断言；9.1 的触发改为「点击指示钮」。 |
| D3 改原生菜单项 | delta：新增一条 `keymap-commands` 或 `ui-language` 的 requirement 描述菜单项与 accelerator 占用；**并追加一条**「后端菜单结构判定（字符串相等）如何随之重做」的条款。tasks：追加 Rust 菜单改造与那套判定的回归项（体量另计）。 |
| D4 deck 作机器真源 + 生成 TS | delta：文案真源 requirement 改写为「deck 是机器可读的真源，表由生成器产出」；**并追加**多串格的解析规则条款（D64 / D66 / D69 的键序列要写进 deck 本身）。tasks：删 3.3 的人工键序列，改为解析器 + 生成器 + 漂移门禁；追加「生成物静默错串」的负向验证（D67 型含 ` / ` 的串必须不被切分）。 |
| D5 改模板函数承载 | delta：参数化 requirement 去掉 `{占位名}` 约定，改为「每条文案一个纯函数，签名即参数契约」；两列占位名同名的门禁改写为「两个函数签名同构」的断言。tasks：3.4 的占位名断言改写；7.2 的缺参断言改为类型层（编译期）。 |
| D6 保持现状（Rust 文案不切） | delta：删「Rust 侧错误的文案归属」整条；在「不随语言变化的面」加一条「后端错误 message 保持中文（半覆盖，如实登记）」。tasks：删第 5 节（保留 5.4 的系统对话框标题可一并删）；spec 的「不随语言变化的面」scenario 追加一条。 |
| D6 改 Rust 自带双语文案表 | delta：文案真源 requirement 改为「前端表 + 后端表两份，各自与 deck 对账」；追加「Rust 如何得知当前语言」的条款（新状态 + 通道）。tasks：追加 Rust 侧表 + 跨语言漂移门禁 + 语言状态同步通道。 |
| D7 分期（先最小可见面） | delta：把「文案真源」的取值门禁范围收窄为「已迁移模块」，并新增一条「未迁移面的登记与二期承接」条款。tasks：第 3 / 4 / 5 节按面拆成「本期 / 二期」，`docs/backlog.md` 落二期条目。 |
| D8 键位来由**不**纳入（**备选**——本项已裁「纳入」） | delta：「不随语言变化的面」加回「键位表的逐条来由」一项，「文案真源」的取值门禁允许清单加回 `src/keys.ts` 的 `doc`。tasks：删 3.7 与 4.6 的来由部分（面板骨架仍随语言切）、删 1.7 的 59 条映射、deck 的「表即文档」旧口径不必改。 |
| D9 三条菜单项随语言走（推翻 M257 的恒定英文裁决） | delta：「不随语言变化的面」删去「上屏列锁定」形态、只留两列同形；「文案真源」里的锁列条款与「上屏列锁定不受界面语言影响」scenario 一并删除（除非另有锁列条目）。tasks：删 3.6；10.3 取备选分支（并要求 M257 同批回退 `src/tabs.ts` 三常量、deck 双列、`tests/unit/tab-menu.test.ts` 与 `tests/visual/scenes/tab-menu.spec.ts` 的文案断言）；8.3 的 en 面断言加一条「菜单三项随界面语言变化」；12.2 的 ⑨ 改写为「三条菜单项随语言走」。 |
