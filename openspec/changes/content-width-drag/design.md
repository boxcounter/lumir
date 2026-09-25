# Design: content-width-drag

本 change 的现状盘点（逐条给文件:行号）、落点、重排策略评估与被否决方案。
盘点是 2026-09-25 在 worktree `wt-223`（base master `3f3354d`）上实测所得，行号即该 base 的现值；
CM 侧契约用主 checkout 的 `node_modules`（`@codemirror/view@6.43.11`，`pnpm-lock.yaml` 锁定值）
实证，行号即本地 dist 现值。

## 1. 现状盘点

### 1.1 栏宽机制（中列 grid 轨道 + token 单写值）

| 事实 | 锚点 |
|---|---|
| 阅读栏宽 = `.cm-scroller` 的 grid 中列轨道：md 模式 `minmax(24px, 1fr) minmax(0, var(--layout-doc-measure)) minmax(24px, 1fr)`（正文列居中、两侧吸收余白）；code 模式 `minmax(max-content, 1fr) minmax(0, var(--layout-doc-measure)) minmax(0, 1fr)`（gutter 占左列，代码正文列恒为 token 值） | `src/editor.ts:1282-1288`（`display: grid !important` 在 `:1284`） |
| token 定义：`--layout-doc-measure: 664px`，在 `:root` token 区；**全仓唯一消费者**就是上面那两行 grid 模板 | `src/style.css:193`；`rg "layout-doc-measure" src/` 只命中 `style.css:193` 与 `editor.ts:1285-1286` |
| 664px 是**框宽**：正文内边距 `paddingInline: var(--sp-13)`（44px×2），文字实测宽 576px；与定稿图 `.doc { max-width:664px; padding:32px 44px 20px }` 逐项一致 | `src/editor.ts:1269-1274`（注释）、`:1292`（padding 声明）、`src/style.css:177`（`--sp-13: 44px`） |
| tokens 文档同值登记：「`--layout-doc-measure` 664px 正文 max-width，居中」 | `docs/specs/design-tokens-v1.md:203` |
| **轨道语义是上限**：`minmax(0, token)` 意味着窗口不够宽时中列收缩到可用宽度，token 只当 max-width 用——配置项的语义因此是「栏宽上限」，不是「栏宽定值」 | 由 `src/editor.ts:1285-1286` 的模板直接推出 |
| 旧口径 `--measure: 80%`（百分比中列）已退役，无残留 | `src/editor.ts:1269-1271` 注释 |
| 任务书口述「定稿宽度 680px」与代码/定稿证据（664px）不符；680 在仓内只作为字重 `--fw-display: 680` 出现 | `src/style.css:154`；裁决点 D1 |

### 1.2 折行（M180）与宽度变化的交界面

| 事实 | 锚点 |
|---|---|
| 折行扩展的唯一装配点 `wrapExtensions(mode, settings)`：正文行 `EditorView.lineWrapping`（给 `.cm-content` 加 `cm-lineWrapping` 类），代码块行是内容级 class + 不折行时的块级横滚容器 | `src/editor.ts:1037-1056` |
| 折行真源是应用运行期闭包值，翻转 = 遍历全部会话做 `wrapCompartment.reconfigure`（前台 dispatch、后台换 state） | `src/editor.ts:1062`、`:1598-1604`（`reconfigureWrap`）、`:1653-1661`（`setWrap`） |
| 折行的配置链：`[editor] line_wrap / code_block_wrap` → `config_get` → `main.ts` 启动装配一次 `editor.setWrap(...)`；运行期翻转由两条 `view.toggle-*` 命令承担、不回写配置 | `src/main.ts:941-948`；`openspec/changes/archive/2026-09-18-line-wrap-options/specs/editor-live-preview/spec.md` |
| **宽度变化不碰这条链**：宽度是纯 CSS token 值，不是 CM 扩展；折行的开关状态不变，变的只是折行的**折点位置**。宽度侧没有 Compartment 重配需求 | 由 1.1（grid 模板引用 var）与 1.4（CM 测量链）推出 |
| 宽度变化后折行重算的触发链：token 值变 → grid 中列宽度变 → `.cm-content` 宽度变 → **显式 `view.requestMeasure()`** → CM 测量pass检测到 contentWidth 变化超过一个字符宽（折行开时）→ 高度 oracle 刷新 + 高度图整体重建 → 视口行重新测量、折点重算 | 链路实证见 §1.4；`requestMeasure` 先例 `src/editor.ts:1615-1621` |

### 1.3 配置链路与 `[ui]` 表现状

| 事实 | 锚点 |
|---|---|
| `AppConfig`：`version / last_vault / editor / ui / keys / log`；`ui` 是结构化表（`RawUiConfig` 镜像），不是 `Value` 整表 | `src-tauri/src/config.rs:65-72`（`ui` 字段 `:72`）、`:236-242` |
| `UiConfig` 目前只有 `theme: UiTheme` 一个字段；`RawUiConfig` 只有 `theme: Option<String>` | `config.rs:167-174`、`:270-277` |
| `validate()` 的 ui 分支：缺字段回落默认（不告警）；取值非法回落默认 + warning；类型不符（`"theme": 2`）在 serde 解析期失败 → **整文件回落**（全部默认 + warning，连 `last_vault` 一起丢） | `config.rs:426-438`；整文件回落 `:191-209`；单测先例 `wrong_type_ui_theme_falls_back_entire_file` |
| 数值配置字段的既有先例：`editor.font_size`（f64，区间 `[12, 32]`，越界回落默认 + warning；常量 `DEFAULT_FONT_SIZE` / `FONT_SIZE_MIN` / `FONT_SIZE_MAX` 三处同语义写值各有断言钉住） | `config.rs:96-160`（字段与常量）、`:413-424`（validate 区间判定）；TS 侧镜像 `src/typography.ts:26-31` |
| 前端只在启动读一次配置：`configGet()` → `main.ts` 装配区（setMode → setWrap → applyTypography → applyKeyConfig → ui.theme 施加在块末）；无 watcher、无第二次读取 | `src/main.ts:939-979`（`ui.theme` 施加在 `:969-979`）；`configGet` 定义 `src/ipc.ts:38-39` |
| ts-rs 自动导出 `src/bindings/UiConfig.ts`，bindings 漂移门禁在 `scripts/gate.sh:61-70` | `config.rs:167-170` 的 derive |
| 视觉桩：`config_get` 桩现返回 `ui: { theme }`，形状与 Rust `AppConfig` 逐项同值 | `tests/visual/scenes/tauri-stub.ts:269-290`（注释 `:290`） |
| 验收 harness 的 `writeConfig` 只认 `mode / keys / 折行 / 排版 / theme` 等既有可选字段，新增字段要一并扩 | `scripts/acceptance/lib/app.mjs:28-36` |

### 1.4 CM6 测量链实证（本地 `node_modules/@codemirror/view/dist/index.js`，6.43.11）

| 事实 | 锚点 |
|---|---|
| CM 的 ResizeObserver 只观察 **`view.scrollDOM`**（`.cm-scroller`）——改 CSS 变量让 grid 中列变宽**不改变** scrollDOM 尺寸，该观察者不触发 | dist `:7165-7171`（`this.resizeScroll.observe(view.scrollDOM)`） |
| 因此宽度变化后必须**显式** `view.requestMeasure()`，否则高度图与坐标停留在旧宽度——这正是 M103/M110 同族「CSS 换了而 CM 没重测」的缺陷形态；typography 的施加函数每次都显式请求重测量，注释写明原因 | `src/editor.ts:1615-1621`（`applyTypographySettings`）、`:1646-1658`（`textScale` 同形） |
| 测量 pass 内：折行开且 `|contentWidth − contentDOMWidth| > charWidth` 时，置 `refresh`，oracle 用新行宽刷新 | dist `:6324-6326`、`:6388-6390` |
| `refresh` 为真时**高度图整体重建**：`HeightMap.empty().applyChanges(..., [ChangedRange(0,0,0,doc.length)])`，随后视口行重新测量（`MeasuredHeights`）；视口外高度由 oracle 重新估算 | dist `:6403`、`:6420` |
| 这个「整体重建」并非新量级：折行 toggle（M180）走 `mustRefreshForWrapping` 触发同一形态（dist `:6324`），已在性能合同下跑通；差异是拖拽期间逐帧重复 | dist `:6324`；M180 先例 |
| 折行关时宽度变化不触发 refresh（条件含 `oracle.lineWrapping`），高度不变，横向溢出范围由浏览器布局与 CM 常规测量更新 | dist `:6388` 的条件 |
| `requestMeasure` 走 rAF 调度（`measureScheduled` 防抖：同帧重复请求只排一次） | dist `:8144` 附近（`measureScheduled = 0` 注释）、`:8325`（`requestMeasure` 定义） |
| 高度纪律：CM 按 border-box 量行高，margin 对高度图不可见——手柄与任何间距表达 MUST NOT 落 margin 进文档流 | `src/preview/livePreview.ts:734`、`src/style.css:284-288`、`src/preview/theme.ts:95-101`（M110 注释族） |
| 光标可见性先例：字号变化会把光标行推出视口，`keepCaretVisible()` 用 `EditorView.scrollIntoView(y:"nearest")` 做最小滚动——宽度收窄同形，复用该函数 | `src/editor.ts:1624-1637` |

### 1.5 `config.json` 写回先例（本 change 要复用的纪律）

| 事实 | 锚点 |
|---|---|
| 运行期对配置的写入只碰 `last_vault` 一个字段：读整份 JSON 为 `serde_json::Value`（解析失败按 `{}` 起）、只改该字段、`tmp` 文件 + `rename` 原子替换、保留未知字段；纯函数部分 `merge_last_vault` 可测 | `src-tauri/src/commands.rs:394-428`（`write_last_vault_to`）、`:433-439`（`merge_last_vault`） |
| 第二处写入点 `vault_remap` 同纪律 | `src-tauri/src/workspaces.rs:263-287` |
| 写失败的降级先例：`remember_last_vault` 失败只 warning、MUST NOT 让主流程失败 | `commands.rs:441-450` 附近（注释记明 M127/M121 教训） |
| M180/M195 的「运行期 MUST NOT 回写」针对瞬态开关；本 change 的宽度是持久偏好，回写即核心语义（proposal D3） | `src/main.ts:941-951` 的注释族 |
| 应用级持久状态的另一条路（独立状态文件 + 防抖 flush）：阅读位置 M194——本 change 不取，理由见 §3 | `src-tauri/src/reading_position.rs`、`src/reading-position.ts` |

### 1.6 手柄的宿主面

| 事实 | 锚点 |
|---|---|
| shell 骨架：`app-shell` 下标题栏 / 文件树 / 编辑器 pane / modeline 四区；编辑器 pane 是 `pane("pane-editor")`，CM 挂载其中 | `src/shell.ts:67`、`:92`；挂载 `src/main.ts:63` |
| 手柄 SHALL 挂在编辑器 pane 内、与 `.cm-editor` 并列的覆盖层（position absolute），MUST NOT 进 `.cm-scroller` / `.cm-content` 内部（那里是 CM 高度图与装饰层的地盘） | 由 §1.4 的高度纪律推出 |
| 空态（无 vault / 恢复中）时编辑器 pane 上有覆盖层或隐藏，手柄此时 MUST NOT 出现 | `src/main.ts:848`（`showEditor`）一带的空态处理 |
| 真机与视觉两层的操作通道：KimiCU 的 drag 可直接对手柄做拖拽（`scripts/acceptance/README.md`）；视觉层 Playwright 用 `page.mouse` 同形 | 套件文档 |

## 2. 设计落点

### 2.1 配置面（Rust）

- `UiConfig` 增 `content_width: f64`（与 `font_size` 同取 f64：JSON 数值字段的先例类型，
  `config.rs:128-129`；`Option<u32>` 会把 `"content_width": 700.5` 打进整文件回落，f64 更宽容）。
  `Default` 给 664（D1）。
- 常量三件套照 `font_size` 模板：`DEFAULT_CONTENT_WIDTH = 664.0`、`CONTENT_WIDTH_MIN = 480.0`、
  `CONTENT_WIDTH_MAX = 1200.0`（D2）；TS 侧镜像常量放新模块（§2.3），两侧互指注释 + 各自单测钉住
  （REVIEW.md 第 8 条的既有处置，先例 `src/typography.ts:15-18`）。
- `RawUiConfig` 增 `content_width: Option<f64>`；`validate()` 的 ui 分支按 `font_size` 模板扩：
  缺字段回落默认不告警；越界回落默认 + warning；类型不符走整文件回落（既有解析模型性质，
  如实记录 + 单测钉住，不发明逐字段容忍）。
- ts-rs 导出 `src/bindings/UiConfig.ts` 随 `cargo test` 更新并提交（bindings 漂移门禁）。
- 前端装配：`main.ts` 的配置消费块里，`applyTypography` 之后加一次
  `editor.setContentWidth(snapshot.config.ui.content_width)`；该值经 Rust 校验，前端不判区间
  （与主题「前端不判非法值」同口径，避免第二处真源）。

### 2.2 手柄 DOM 归属与命中区

- **归属**：编辑器 pane（`src/shell.ts:67`）内的覆盖层容器，与 `.cm-editor` 并列、
  `position: absolute`、`pointer-events: none`；两条手柄条 `pointer-events: auto`。
  MUST NOT 落在 `.cm-scroller` / `.cm-content` 内（§1.4 高度纪律）。
- **定位**：JS 读 `.cm-content` 的 `getBoundingClientRect()`，换算成 pane 内坐标，把两条手柄分别
  贴到 `rect.left` / `rect.right`。更新时机：pane 的 `ResizeObserver`、`.cm-scroller` 的
  `scroll`（横向滚动会移动内容矩形，`line_wrap = false` 时存在）、宽度施加后、会话切换后。
  不用纯 CSS `calc(50% ± …)`：code 模式列不居中（gutter 占左列），百分比定位在两种模式间不一致，
  实测矩形是唯一对两者都成立的口径。
- **命中区**：手柄条宽 10px（列缘两侧各 5px）、高 = 编辑器 pane 高；`cursor: col-resize`。
  **视觉线** 2px、常态 `opacity: 0`，hover 命中区或拖拽中显现；色取 `--accent`（既有交互强调 token，
  零新配色；eink 档由 token 层自动落位）。
- **不抢输入**：手柄只在 10px 命中区内吃指针事件；文本选择、点击落点、纵向滚动在命中区外零影响。
  拖拽用 `setPointerCapture` 锁定指针，拖出命中区不中断。
- **空态隐藏**：无前台文档（空态覆盖层在）时手柄 `hidden`；`showEditor` 的状态分叉是唯一判定来源，
  不另造一份「有无文档」的布尔。
- 读屏：手柄是装饰性拖拽条，`role="separator"` + `aria-orientation="vertical"` + 读屏名
  「调整内容宽度」（文案条目随实现同批）；本版不做键盘调宽（proposal Non-goals），`tabindex` 不设，
  不进 Tab 序。

### 2.3 拖拽重排策略（核心风险节）

**结论：live 拖动**（D4 的建议项），逐帧施加 + 显式重测量，松手才持久化。

- **每次宽度应用 = 三步**：① 写 token：`documentElement.style.setProperty("--layout-doc-measure", "<w>px")`
  （写入路径与 typography 的 `applyTypography` 同构，`src/typography.ts:136-154`；token 名单一来源
  常量化）；② `view.requestMeasure()`（§1.4：CSS 变量不触发 CM 的 ResizeObserver，不显式请求
  就是坐标错位）；③ 拖拽期间每帧做这两步，rAF 合并（同一帧多次 pointermove 只施加了最后一次；
  CM 的 `requestMeasure` 自带同帧去重，§1.4）。
- **对称换算**：`width' = clamp(width₀ + 2·(x − x₀), MIN, MAX)`，取整到整数 px（读数可逐值比对，
  先例 `src/typography.ts:61-68` 的取整理由）。换算与钳制是纯函数（新模块 `src/content-width.ts`），
  DOM 判定与指针事件在装配侧，两者分开测。
- **高度图影响评估（tower 关注点）**：折行开时，栏宽变化超过一个字符宽 → CM 测量 pass 触发
  oracle 刷新 + **高度图整体重建**（dist:6388-6403 实证），视口行重新测量、视口外高度重新估算。
  这与折行 toggle（M180）是同一量级、同一形态，M180 已在性能合同下跑通；差异是拖拽期间**逐帧
  重复**——1 秒拖拽 ≈ 60 次重建。重建的分配量是 O（文档块数），测量量视口有界；对性能合同文档
  （1MB Markdown）拖拽的帧耗时是 tasks 里的硬实测项（perf 探针场景，拖拽过程中采样
  「施加→重测量→绘制」帧时间，参照 keypress-to-paint <16ms 的预算口径）。
- **退路（松手生效）**：若大文档实测不达标——拖拽中只画幽灵线（手柄跟随指针、正文不动），
  松手时一次施加 + 一次重测量 + 一次写盘。退路只改拖拽期行为，持久化与配置面不动。
- **光标可见性**：施加后调 `keepCaretVisible()`（既有函数，`src/editor.ts:1624-1637`）——收窄会
  把光标行推出视口，与字号放大同形。
- **折行关时**：高度不变、无重建；横向溢出范围随列宽变化，浏览器布局自处理，CM 常规测量跟上。
  手柄在 `line_wrap = false` 下照常可用（列宽仍有意义：横滚的 viewport 宽）。
- **下游几何消费者**：图片几何缓存按行宽换算列数（`src/preview/attachments.ts:443`、`:484-486`）、
  表格容器与块级横滚容器的 `scrollWidth` 都随列宽变化——这些都由浏览器布局 + CM 重测量自动覆盖，
  实现期用 §4 的场景钉住，不在拖拽路径上加手工失效逻辑。

### 2.4 持久化时机与写入纪律

- **时机**：只在 `pointerup`（且值相对拖拽起点有变化）时写一次。拖拽过程零写盘——写盘频率与
  手势数绑定（一次手势一次写），不需要防抖。
- **写入通道**：新增 IPC `ui_set_content_width(width: f64)`；Rust 侧复用 `write_last_vault_to`
  的纪律：读整份 `Value`（解析失败按 `{}` 起）→ 确保 `ui` 是 object → 写 `content_width` →
  `to_string_pretty` → tmp+rename；未知字段与 `version` 处置照 `merge_last_vault`。
  纯函数部分（`merge_content_width`）单独可测，断言「其余字段逐字节语义不变」。
- **失败降级**：写失败 = CommandError → 前端 toast（新文案条目）+ `logEvent("config_warning")`；
  运行期宽度**不回滚**（与 `remember_last_vault` 的「主结果不受记忆写失败影响」同口径，
  `commands.rs:441-450` 的注释族）。
- **不回读**：写完后运行期真源就是刚施加的值，不重新 `config_get`（那是第二条同步路径，
  会引入「写后读」时序面）。
- **验收断言面**：真机场景断言 `config.json` 在拖拽后出现 `ui.content_width` 且其余键不动、
  文档内容与 dirty 不变；套件的 `XDG_CONFIG_HOME` 隔离天然覆盖「不碰用户真实配置」。

### 2.5 运行期真源与多标签 / 重启口径

- **真源**：`createEditor` 闭包内一份 `contentWidth` 值 + `documentElement` 上的 token（与
  typography 的 `typography` 闭包值同构，`src/editor.ts:1076-1087`）。token 天然覆盖全部会话
  与两种模式——**没有逐会话状态、没有 Compartment、新标签页自动取当前值**，M180 那套
  「遍历全部会话重配」在本 change 不需要。
- **与配置的关系**：启动时配置喂一次初值；拖拽回写让配置随即同步——因此不存在 M180/M195 的
  「运行期态 vs 配置默认」双真源分歧，重启后与退出前一致。
- **出厂默认两处写值**：Rust `DEFAULT_CONTENT_WIDTH` 与 TS 镜像常量同值、互指注释、各自单测
  （REVIEW.md 第 8 条既有处置）。CSS 侧 `--layout-doc-measure: 664px` 是「配置到达前」的起步值，
  构成第三处——三处同值的断言面照 `font_size` 先例（`src/typography.ts:15-18` 注释记的就是这条）。

### 2.6 与键位 / 命令体系的关系

零改动。本 change 不新增命令、不改 `COMMAND_IDS`、不动 `[keys]` 覆盖面、不动键位面板
（`src/keys.ts` 与 `src/bindings-panel.ts` 都不在改动面内）。拖拽是纯鼠标交互；键盘可达性
（方向键调宽）是有意留给后续 change 的非目标（proposal Non-goals）。

## 3. 被否决的方案与理由

| 方案 | 否决理由 |
|---|---|
| 松手才生效（幽灵线预览）作为默认形态 | 你引用的 DeepSeek 形态是 live；且 CM 的重建与折行 toggle 同量级，先实测再退化。保留为 D4 的退路（§2.3） |
| 手柄放进 `.cm-scroller` 内或用文档流内元素撑出命中区 | CM 高度图按 border-box 量行高，文档流内的异物/间距会污染测量（M110 同族教训，`src/preview/livePreview.ts:734`）；手柄必须是 shell 层覆盖元素 |
| 纯 CSS 定位（`calc(50% ± token/2)`） | code 模式中列不居中（gutter 占左列，`src/editor.ts:1286`），百分比定位在两种模式间不一致；`.cm-content` 实测矩形对两者都成立 |
| 拖拽中逐帧写盘 + 防抖 | 写盘频率跟着指针事件走，防抖窗口内丢最后一次写就是「宽度没存住」；松手一次写把手势与写盘一一对应 |
| 宽度存独立状态文件（reading-position 先例） | 「宽度」是用户可手编的偏好，独立文件会让它有两处居所，违背「配置即数据」的单一居所方向（ADR 0002 §5）；proposal D3 |
| 每帧写 token 但靠 CM 自己发现宽度变化 | CM 的 ResizeObserver 只看 `scrollDOM`（dist:7165-7171），grid 中列变宽不触发它——不显式 `requestMeasure` 就是坐标错位（§1.4） |
| 给手柄加默认键位或命令（如 `view.content-width-reset`） | 可见面从「拖拽 + 配置」扩到命令体系，键位面板/文案/门禁一起动；proposal Non-goals，后续按证据立项 |
| `Option<u32>` 承载配置值 | `"content_width": 700.5` 会在 serde 解析期失败走整文件回落；`f64` 与 `font_size` 先例同型，宽容度一致（§2.1） |
| 默认值改 680（跟随任务书口述） | 代码与定稿证据都是 664；680 是一次独立观感变更，会位移所有含编辑区的整页基线——若要做，值得单独走 Alex 过目，不搭本 change 的车（D1） |

## 4. 实现期必须验证 / 未决的点（逐条写实测结论）

0. **既有基线零变更核对**：默认值保持 664（D1 建议）时，全部含编辑区的整页基线时间戳与像素
   MUST NOT 变化（手柄常态不可见、token 默认同值）；变了按缺陷处理。逐张核对纪律见
   `tests/visual/README.md` 与 AGENTS.md 视觉门禁卫生条。
1. **手柄定位在两种模式下的正确性**：md（居中列）与 code（gutter + 非居中列）各断言手柄条与
   `.cm-content` 矩形缘重合（±1px）；横向滚动（`line_wrap = false`）后手柄跟随列缘。
2. **拖拽帧实测**：对性能合同文档（1MB Markdown，折行开）做 live 拖拽，采样「施加 → requestMeasure →
   绘制」帧耗时；结论（达标 / 退到松手生效）连同数据写回本节。超预算即走 §2.3 退路，不硬扛。
3. **折行重算正确性**：收窄后长行的折点数增加、点击折行内文字落点正确（坐标与画面一致——
   这是 `requestMeasure` 是否真的到位的试金石）；`line_wrap = false` 下变宽后 `.cm-scroller`
   的 `scrollWidth` 收缩。
4. **写盘纪律**：`merge_content_width` 纯函数断言「含未知字段 / 其它表的配置写回后逐键保留」；
   真机场景断言拖拽后 `config.json` 含 `ui.content_width`、其余键不变、文档 sha256 不变、
   dirty 不变。
5. **图片与表格的下游几何**：拖拽后图片列数换算（`attachments.ts:484-486`）与表格横滚容器表现
   跟随新列宽——若实测发现几何缓存不失效，补失效逻辑并在本节记录（先按「浏览器布局自动覆盖」
   假设验）。
6. **写失败降级**：模拟写盘失败（验收 harness 的隔离配置目录置只读），断言 toast 出现、运行期
   宽度不回滚。

## 5. 与 REVIEW.md 的对表（本 change 的实现面）

| REVIEW.md 条目 | 本 change 的落点 |
|---|---|
| 3 容差吞掉真实变化 | 手柄常态不可见 + 默认宽度同值 ⇒ 既有基线零变化是**可断言**的；新增场景单独出基线，逐张核对旧基线时间戳（§4-0） |
| 6 覆盖声明超出真实验证 | 拖拽帧实测不达标就走退路并如实记录，不冒称 live 已验（§2.3、§4-2） |
| 8 同一语义两处真源 | 默认宽 / 上下限三处写值（Rust 常量、TS 常量、CSS 默认）互指注释 + 各自断言；token 名常量化单一来源（§2.3、§2.5） |
| 9 声明即被消费 | `ui.content_width` 的消费者：启动装配 + 拖拽回写读侧（写侧 IPC）+ 视觉/真机断言；`editor.measure` 假开关教训不得重现 |
| M110 同族（margin / 测量不可见） | 手柄在 shell 层、零文档流侵入；宽度变化必走显式 `requestMeasure`（§1.4、§2.2、§2.3） |
| 11 真机键盘注入丢键 | 真机走 KimiCU **drag**（非键盘注入）；断言取「config.json 落值 + 截图」，不以事件次数当判据 |
| 13 测试污染真实环境 | 写盘断言只发生在验收套件的 `XDG_CONFIG_HOME` 隔离目录；不碰 `~/.config/lumir` |
| 14 前台盲等 | 纯提案 mission；实现期后台命令按 spawn 指令走 WaitFor |
