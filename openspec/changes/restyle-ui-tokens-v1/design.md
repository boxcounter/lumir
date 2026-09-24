# Design: restyle-ui-tokens-v1

本 change 的现状盘点（逐条给文件:行号）、落点、机制选择与被否决方案。值的唯一权威文本是
[design-tokens-v1.md](../../../docs/specs/design-tokens-v1.md)，本文件不复制 token 值，
只写「这些值怎么进代码」。

## 1. 现状盘点

### 1.1 token 层与它的消费面

| 事实 | 锚点 |
|---|---|
| 现行 token 一组 17 个 + callout 13 色，全部在 `:root` 一个块里，无主题机制 | `src/style.css:6-28` |
| token 化不彻底（既有漂移）：`.filetree` / `.ft-empty` 把正文族写字面量而非 `var(--font-body)`；搜索面板、键位面板等 chrome 表面散落 `--bg-2` / `--bd-*` 引用 | `src/style.css:111`、`:226` |
| 编辑器渲染层的语法高亮借用 callout 色：`tok-string` → `--callout-tip`、`tok-literal` → `--callout-warning`、`tok-property` → `--callout-note`、`tok-type` → `--callout-abstract`、`tok-comment` → `--dim`、`tok-keyword` → `--accent` | `src/preview/theme.ts:157-162` |
| callout 底色用 `color-mix(in srgb, var(--callout-c) var(--callout-tint), var(--bg))`——`--bg` 删除时这里必须同步改指新底色 token | `src/preview/theme.ts:112` |
| `--editor-font-family` / `--editor-mono-family` / `--editor-font-size` 三个编辑器 token 引用 shell 基线（`var(--font-body)` / `var(--font-mono)` / `16px`）；typography-and-zoom 的机制（配置写入、档位、重测量）都挂在这层上 | `src/style.css:14-24`（typography change 的 delta，已合入 master） |

### 1.2 骨架现状

| 事实 | 锚点 |
|---|---|
| app-shell 是 CSS grid：左栏 `fileTree`（`--nav-width: 244px`，≤1100px 媒体查询降 204px）× 右列三行（masthead / 标签栏 / 正文）；标签栏空态 hidden 时第二行塌成 0 | `src/style.css:47-83` |
| masthead 承载：vault 名（宋体大字 + 双线装饰 `::after`）、当前文件路径、toc 当前位置指示 | `src/style.css:61-76`；`src/toc.ts`（指示段） |
| 窗口 1200×800，原生标题栏（无 `titleBarStyle` / `hiddenTitle` 配置） | `src-tauri/tauri.conf.json:13-18` |
| 无 modeline；文件路径在 masthead，行数 / 语法 / 编码信息今天**没有展示位** | `src/style.css`（无 modeline 选择器） |
| 视觉 harness 的 `config_get` 桩只出 `editor.*` + `keys`；新配置表要扩桩（`patchEditorConfig` 同形态的新 helper 或直接扩桩） | `tests/visual/scenes/tauri-stub.ts:66-67` |
| 验收 harness 的 `writeConfig` 认 `mode` / `lineWrap` / `codeBlockWrap` / 排版三字段；`ui.theme` 要一并扩 | `scripts/acceptance/lib/app.mjs:28-45` |
| 视觉基线 34 张（13 个快照目录），1200×800、dsf=1 | `find tests/visual/baselines -name '*.png'` = 34；`tests/visual/README.md:23-25` |

### 1.3 frontmatter 与内容类型现状

| 事实 | 锚点 |
|---|---|
| properties 区块今天是键值表格形态（StateField 跨行 replace 装饰），样式引用 `--bg-2` / `--bd-1` / `--dim` | `openspec/specs/frontmatter-properties/spec.md`；`src/preview/theme.ts:174-215` |
| 内容类型（表格 / 围栏代码块 / 引用 / 列表 / 标题）的样式在 `src/preview/theme.ts`，颜色引用 `--bg-2` / `--bd-2` / `--dim` / `--accent` / callout 色 | `src/preview/theme.ts:79-220` |

## 2. 机制选择

### 2.1 token 的落法：三组 `:root[data-theme]` + 一组非色 token

- 色彩 29 个按 tokens 文档对照表写三组：`:root, :root[data-theme="light"]` / `[data-theme="dark"]` / `[data-theme="eink"]`（原型原样的结构，已在原型里验证）。
- 非色 token（字体 / 间距 / 圆角 / 布局 / 动效）写一组 `:root`，三主题共享——「三主题共享结构与排版基因」（brief 已识别张力的解法）。
- **命名直接取 tokens 文档的 token 名**（`--frame` / `--content-bg` / `--text-2` / `--border-soft` / `--tk-*` / `--sp-*` / `--r*` / `--layout-*` / `--dur-*`）。旧名（`--bg` / `--dim` / `--accent`）一律替换不保留别名：双名并存就是两处真源（REVIEW.md 第 8 条）。`rg` 全仓清点旧 token 引用是实现的第 2 步（tasks §2）。
- eink 的组件级覆盖（白底黑框、手工反白、线宽强调）照原型写法落在各组件规则上（`:root[data-theme="eink"] .xxx`），不进 token——它们是规则不是值（tokens 文档 §eink 规则）。

### 2.2 主题施加：`data-theme` + 启动一次写入

- `[ui] theme` 经既有 `config_get` 在启动时装配层写入 `document.documentElement.dataset.theme`（与 `applyTypography` 同形态、同落点区）。
- 默认 `light`；非法值 → warning + 回落 `light`（照 `editor.mode` 的 validate 模板）。
- 视觉 harness 用 `data-theme` 属性直接注入（不需要真实配置通道也能截三主题），验收套件走真实 `writeConfig` 通道。

### 2.3 masthead 移除与信息迁移

| masthead 现状 | 去向 | 依据 |
|---|---|---|
| vault 名（宋体大字 + 双线） | 侧栏头（13px / 650，带 caret 的切换器入口形态不变） | 定稿图 01–03：侧栏头「Everything ⌄」 |
| 当前文件路径 | modeline 左侧 | 定稿图：modeline 左 `1_Projects / … / dimension-design.md` |
| toc 当前位置指示（⌘⇧O 的锚点） | modeline 左侧路径段之后（同一行，路径 › 标题链）；**指示段今天不显示时的 modeline 形态 = 仅路径** | toc-outline spec 的「当前位置指示」语义不变，只是承载面从 masthead 迁到 modeline |
| 行数 / 语法 / 编码 | modeline 右侧（新增展示位，信息来自既有编辑器状态，无新数据源） | 定稿图：modeline 右 `Markdown · 338 行 · UTF-8` |

双线装饰（`masthead::after` 的 3px+1px 边框）随 masthead 一并删除——它是 editorial 体系的标志物，新体系里没有对应物。

### 2.4 骨架的落法

- grid 改四区：标题栏行（42px，横跨全宽）/ 主行（侧栏 236 + 正文 + dock 预留列）/ modeline 行（25px，横跨全宽）。dock 预留列**宽度 0、无内容、无边框**——「预留」是结构上的（grid 模板里有一列、agent 特性落地时改列宽即接入），本版零像素。
- 标签迁入标题栏：标签显示判据（≥1 文件打开）不变；标题栏在无打开文件时只剩 traffic 灯区与动作钮。
- overlay 标题栏：`tauri.conf.json` 加 `"titleBarStyle": "Overlay", "hiddenTitle": true`，traffic 灯保持原生绘制，标题栏区加 `-webkit-app-region: drag`（原型已有此规则）。**风险如实记录**：tests/visual README 把「引入自定义 titlebar」列为整窗截图门禁的重评信号——本 change 接受这个信号，整窗截图场景立项评估（proposal Non-goals）。
- 窗口尺寸 1200×800 不变；侧栏 236 + 正文 664 在 1200 宽下成立（正文栏 = 1200-236 = 964 > 664 + 两侧留白）。

### 2.5 编辑器渲染层的落法

- `theme.ts` 的颜色引用按 tokens 文档 §差距 的映射表逐个改指；`tok-*` → `--tk-*`；frontmatter 区块样式重写为 `.fm` 形态（`theme.ts:174-215` 一段整体替换）；`color-mix` 里的 `--bg` → `--content-bg`。
- 栏宽：`--measure: 80%`（grid `minmax(0, var(--measure))`）→ 664px 定值居中。编辑器网格列的落法（定值列 + 两侧弹性）在实现时定，口径 = 定稿图（正文列 664 居中、宽窗下两侧留白）。
- **D1 裁决的落点**：`--editor-font-size` 默认 16px→15px（`src/style.css` 一处 + Rust `DEFAULT_FONT_SIZE` + 两侧指针注释，typography change 留下的成对纪律照旧）；`--line-height` 1.75→1.7。档位表 [12,32] 与 ×1.1 不变（档位数值随基准漂移是 typography 机制的既有性质）。

### 2.6 callout 语义收敛（D2 裁决 = 本 change 内收敛，2026-09-24）

节点 1 裁决 D2 采纳备选：13 类 callout 在本 change 内收敛为五族语义色。**映射表与四条规则的唯一权威文本是 [design-tokens-v1.md](../../../docs/specs/design-tokens-v1.md) §callout 语义收敛（v1.2 增补）**（蓝 4：note/abstract/info/todo；绿 2：tip/success；琥珀 2：question/warning；红 3：failure/danger/bug；灰 2：example/quote），此处只写落法，不复制映射：

- 每类 callout 的 `--callout-<type>` 色值改指所属族的语义 token（`--accent` / `--ok` / `--pending` / `--danger` / `--text-3`），底色取对应 tint（`--accent-tint` / `--ok-tint` / `--pending-tint` / `--danger-tint` / `--agent-bg`）；红系 tint 用 v1.2 新增的 `--danger-tint`。
- **`color-mix` 现混色全部退场**：`theme.ts:112` 的 `color-mix(in srgb, var(--callout-c) var(--callout-tint), var(--bg))` 整段删除，底色直接取 tint token——tint 本身就是按三主题逐档调好的，不再运行期混色。
- **eink**：色条全黑、底色全白（tint 在 eink 档为 `transparent`），与 tokens v1.2 eink 规则一致；2.6 原版「eink 管 chrome 不管内容着色」的口径随之作废——收敛后 callout 色全部来自语义族 token，eink 下自然全黑，无规则冲突残留。
- **不引入图标**：同族类型（如红系 failure/danger/bug）的区分只靠标题行文字，这是 v1.2 映射的刻意取舍（原型 `?screen=6` 三主题已验证一眼可辨）。

### 2.7 周边表面类推映射（提案评审补充，2026-09-24）

原型定稿图未直接呈现周边表面。处置口径：**换皮不改交互**——每个表面由「已定稿组件
样式 + token」类推组装；浮层壳没有类推依据的部分指向 tokens v1.1 新增的
`--shadow-raise` / `--scrim`（[design-tokens-v1.md](../../../docs/specs/design-tokens-v1.md)
§浮层 elevation 与遮罩）。实现按本表逐行执行，**任何偏离表内类推关系的取值都必须
记录**（落 `test-results/<mission>/peripheral-surfaces.md`，逐表面写取值来源）。

| # | 表面（实现锚点） | 结构现状 | 类推组装 |
|---|---|---|---|
| 1 | **toc 大纲浮层** `.lumir-toc`（`src/toc.ts:298-328`，样式 `src/style.css:509-576`） | 绝对定位浮层：filter 输入 + 列表 + hint/empty | 壳 = `--preview-bg` + 1px `--border` + `--shadow-raise`（eink：白底黑框、无阴影）；列表行 = 文件树同族（行高/字号/缩进随层级、is-active = 树选中态 `--sel`、hover `--hover`）；filter 输入 = 下划线形态（底线 `--border`、focus `--accent`，eink focus 走线宽强调档）；hint / empty = `--text-3` 提示档。**连锁偏差**：浮层位置锚点今天相对 masthead（`src/toc.ts:556-562`），masthead 移除后锚点改 modeline 的指示段——这是位置调整不是交互变化，如实记录 |
| 2 | **vault 切换器浮层** `.vault-pop`（`src/vault-switcher.ts:574-611`，样式 `src/style.css:582-683`） | 与 toc 同手法的浮层：filter + 两档文本行 + 分隔线 + 底部添加行 | 壳同 #1（`--preview-bg` + hairline + `--shadow-raise`）；行 = 主行 13px `--text` / 次行 11px `--text-3` 的两档文本（doc-meta 同族）；状态点 = 语义色（current = `--accent`、失效 = `--text-3`）；分隔线 = `--border-soft`；hover/选中 = `--hover` / `--sel` |
| 3 | **搜索面板** `.lumir-search`（`src/search.ts`，样式 `src/search-panel.css`） | CM 顶部 dock 面板（**非浮层**，不用 elevation） | 面板 = `--frame` 底 + 底边 `--border` hairline（与标题栏同手法的「框体表面」）；label 改 sans 650 + 正字距（`--font-display` 退场，editorial 大字距标签不再存在）；输入 = 下划线形态同 #1；匹配高亮 = `--accent-tint`，当前匹配 = 在 tint 档内加深一档（实现时定值并记录）；计数 = `--text-3` |
| 4 | **lightbox 遮罩** `.lumir-lightbox-overlay`（`src/lightbox.ts:115-123`，样式 `src/style.css:447-470`） | 全屏遮罩 + 裸图（无面板、无边框） | 遮罩 = `--scrim`（eink 明度差保留）；图片本体零 chrome（现状即定稿气质：内容即界面）；无阴影、无边框 |
| 5 | **键位面板** `.lumir-bindings-overlay` / `.lumir-bindings-panel`（`src/bindings-panel.ts:66-136`，样式 `src/style.css:388-445`） | 全屏遮罩 + 居中 modal 面板：标题 + 分组行 + hint | 遮罩 = `--scrim`；面板 = `--preview-bg` + 1px `--border` + `--shadow-raise`（eink：1.4px 黑框强调档、无阴影）；标题 = sans 650（display 族退场）；键名列 = `--font-mono` 12px `--text`，命令 / 说明列 = `--text-3` / `--text-2`；未绑定行的 accent 语义保留（`--accent`，eink 黑） |
| 6 | **toast** `.lumir-toast`（`src/main.ts:129-138`，样式 `src/style.css:84-85`） | 右下角反色条 | 反色 chip 沿用（bg `--text` / fg `--content-bg`）+ 圆角 `--r7`；它是浮出物 → 吃 `--shadow-raise`（eink：黑底白字本身成立，无阴影）；action 钮描边取 `--border` |
| 7 | **空态组**：`.editor-notice`、`.ft-empty`、`.pane[data-empty-label]`、`.vault-empty`、`.lumir-toc-empty`（`src/style.css:94-101`、`:238`、`:269-290` 等） | 各表面的占位文案 | 非浮层：文案 = `--text-3` 提示档，底色沿用所在表面，无新增样式决策 |
| 8 | **list-filter**（`src/list-filter.ts`） | 行为模块（浮层内筛选输入逻辑） | 无自身表面；其输入框形态随宿主浮层（#1 / #2 的 filter 行） |

**没有类推依据、指向新增 token 的表面**：浮层壳（#1 #2 #5 #6 的 elevation）→
`--shadow-raise`；全屏遮罩（#4 #5）→ `--scrim`。其余每一行都能在定稿组件里指出
类推来源。shell 里**没有**自绘确认对话框（`rg 'confirm|dialog' src/` 零命中），
原生确认（如未保存守卫）走系统对话框，不在 restyle 面内。

## 3. 被否决方案

| 方案 | 否决理由 |
|---|---|
| 保留旧 token 名作别名，渐进迁移 | 双名 = 两处真源（REVIEW.md 第 8 条）；全仓 `rg` 清点 + 基线全量重建本来就是本 change 的成本，渐进没有省下任何东西 |
| 主题用 `prefers-color-scheme` 媒体查询自动跟随 | D3 备选 A：运行期主题变化引入重测量与基线口径问题；且 eink 没有系统级对应物，始终需要显式配置——配置面少不了，自动跟随是纯增量复杂度 |
| dock 预留位渲染一个空 pane（占宽 348） | 「不在场时零痕迹」（原则 5）：预留是结构上的，空 pane 是可见的 agent 痕迹，且白白吃掉正文宽度 |
| 保留 masthead 只换皮 | 定稿图里没有 masthead；保留它就是「批准的稿」与「出厂的样」第二处不一致（同 D1 的逻辑） |
| serif 标题族保留为 eink/某主题的变体 | 无衬线表皮是已裁决项（brief §裁决记录），`--font-display` 删除不保留 |

## 4. 未决项（实现期必须回填结论）

| # | 问题 | 处置 |
|---|---|---|
| 0 | overlay 标题栏下 traffic 灯与标签行的垂直对齐（原生灯位固定 12px 左右 inset，42px 栏内的对齐要真机核） | 实现期真机读数，落 `test-results/<mission>/`；若原生灯位与 236 宽 traffic 区冲突，如实记录并回报，不静默改栏高 |
| 1 | 编辑器网格列从 `minmax(0, 80%)` 到 664 定值居中的确切落法（`minmax(0, 664px)` + 居中轨道 vs padding 方案），以及 code 模式（`minmax(max-content, 1fr)`）在新栏宽下的行为 | 实现期以定稿图为合同逐项核（列表 marker 测量、表格管道对齐在新栏宽下不破）；code 模式口径写进实现期 tasks |
| 2 | modeline 的信息源：行数 / 语法 / 编码今天**没有现成展示位**，取数路径（编辑器状态已有 vs 需新增只读派生） | 实现期定，口径「只读派生、零新状态」；行数在 1MB 文档上的成本需核（不能为此引入全文档遍历，ADR 0002 §6） |
| 3 | dark / eink 下 KaTeX 公式、mermaid、图片附件的呈现（tokens 文档未覆盖，原型也没有） | 本版按「继承 currentColor 与底色 token 迁移」处理，逐张基线重建时你若发现事故再立项——如实写进 tasks 的基线核对项 |
| 4 | 窄窗口（<1100px）行为：旧媒体查询（侧栏 204）随旧 token 删除，新策略本版不定 | 已知边界，写进 spec 或 proposal；真实影响待 dogfood |
