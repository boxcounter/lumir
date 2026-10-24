# Design: 左栏宽度可拖拽、⌘B 收起/展开、vault 根右键新建

- Change ID: add-sidebar-resize-hide-and-root-create
- 日期: 2026-10-23

本文只写「怎么做到 proposal 里已裁的行为」与「为什么这样做」。代码锚点是起草时在本分支
（基于 master）逐一读过原文的位置；行号会漂，实现前以符号名为准。

## 0. 事实清单（起草时核对过原文）

| 事实 | 锚点 | 与本 change 的关系 |
|---|---|---|
| 左栏宽度 token 与两处读点 | `src/style.css:220`（`--layout-sidebar-w: 236px`）、`:340`（`.app-shell` 网格列）、`:374`（`.titlebar-traffic` 的 `width`） | 运行期写入点 = `documentElement` 上的同一 token（与 `--layout-doc-measure` 同一条路） |
| 应用骨架 DOM | `src/shell.ts` 的 `createShell`（`.app-shell` / `.titlebar` / `.titlebar-traffic` / `.pane-filetree` / `.tree-pane`） | 分隔条元素与收起态 class 的落点 |
| 侧栏与标题栏的对齐契约 | `src/style.css:330-345` 的注释（traffic 灯区宽 = 侧栏宽，二者像素对齐） | 收起后 traffic 区必须回到最小宽，不能留 236px 空位 |
| 阅读栏宽拖拽（同族先例） | `src/content-width.ts:90` `createContentWidthDrag`、`:146` `onCommit`、`src/main.ts:1244` 的装配与写盘（失败 toast + 不回滚） | 左栏分隔条复用同一套「rAF 合并 + 松手提交一次 + 写失败只提示」结构 |
| pane 分隔条拖拽（同形先例） | `src/pane-layout.ts:191`（divider 的 `pointerdown` 与拖拽闭包） | 左栏分隔条是同一形态（竖直 hairline + 指针拖拽） |
| 配置写通道 | `src/ipc.ts:69` `configSetUiValue(key, value)`；Rust 侧 `config_set_ui_value` | `ui.sidebar_width` 的落盘通道，零新命令 |
| `[ui]` 表的校验模板 | `src-tauri/src/config.rs:404` `UiConfig`、`:2068` 起 `content_width` 的区间校验（越界回落默认 + warning）、`:1469` `RawUiConfig` 的 `Option<f64>` | 新字段照抄同一模板（类型不符 → 整文件回落，与 `font_size` 同路） |
| ts-rs 导出面 | `src/bindings/UiConfig.ts`（由 `UiConfig` 导出） | 改 Rust 结构即重导出；`bindings-drift` 门禁要求先 `git add` |
| 统一键位表 | `src/keys.ts` 的 `KEY_BINDINGS`（`Cmd-b` 现无绑定，已 `grep` 全表核实）；`Cmd-w` / `Cmd-o` / `Cmd-f` 已占，命令族前缀 `view.*` 已有 `view.theme-cycle` 等先例 | 新命令 `view.toggle-sidebar` 的落点 |
| 原生菜单 accelerator 核查 | `src-tauri/src/lib.rs:372` 起（`Menu::default()` 只增删退出守卫与撤销/重做，`CloseWindow` 的 ⌘W 是唯一会截获的预置项） | ⌘B 不经原生菜单截获，能到 webview |
| 树右键命中 | `src/tree.ts:449` 的 `contextmenu` 监听：`rowLiAt(...)` 命中行才 `preventDefault`；`:487` 起是拖拽落点判定，其「不在任何行带 = vault 根」判据在 M538 已定义 | 根右键复用**同一条**「不在任何行」判据，MUST NOT 另写一套几何 |
| 菜单项集单一真源 | `src/tree-menu.ts:95` `menuItemsFor(kind)`、`:114` `menuActionsFor`、`:327` `createTreeContextMenu`；`:175` `open(target, at)` 的焦点归还锚点 | root 项集是同一函数的第三档输入，不新开一份列表 |
| 菜单动作分发 | `src/main.ts:1872` `runTreeAction`（`new-file` / `new-dir` → `tree.beginCreate`） | 根右键复用同一分发，路径参数为 `""` |
| 根下新建已可用 | `src/tree.ts:1009` `beginCreate`（`:1018` 起对 `parentRel === ""` 单独取 `.ft-root-list`）、`:782` `renderAll` 建出根节点 `nodes.set("", root)` | 根 = 空串路径在树模型里是既有事实，无需新能力 |
| 收起态焦点风险 | `src/quote-gesture.ts`（选区来源恒为活跃编辑器 pane）、`src/tree.ts` 的 `editablePath` / 行内编辑 | 收起前必须收掉行内编辑与菜单并把焦点交还文档 pane |

## 1. 宽度：token、真源与拖拽

### 1.1 真源与写入点

- 唯一运行期真源 = `documentElement` 上的 `--layout-sidebar-w`（CSS 的两处读点因此同时跟随，
  不存在第二份宽度数值）。JS 侧常量与钳制纯函数放新模块 `src/sidebar-width.ts`：
  `SIDEBAR_WIDTH_TOKEN` / `DEFAULT_SIDEBAR_WIDTH = 236` / `SIDEBAR_WIDTH_MIN = 180` /
  `SIDEBAR_WIDTH_MAX = 480` / `clampSidebarWidth()`。
- 出厂默认写值的三处同族处置与阅读栏宽一致（`REVIEW.md`『同一语义两处真源』条）：Rust
  `DEFAULT_SIDEBAR_WIDTH`、TS `DEFAULT_SIDEBAR_WIDTH`、`src/style.css` 的 `220px` 那一行——
  三处同值、互指注释、各有断言钉住。
- 启动施加点：配置到达后 `applySidebarWidth(snapshot.config.ui.sidebar_width)`（与
  `editor.setContentWidth` 同一装配区），只写 token、不重排 DOM。

### 1.2 分隔条与拖拽

- 元素：`.app-shell` 内、`.pane-filetree` 之后插入一条 `.sidebar-divider`（`role="separator"`、
  `aria-orientation="vertical"`、可聚焦、带读屏名）。**静止态零新增视觉**：元素是 6px 宽的透明
  命中带（`cursor: col-resize`），跨在既有的 1px 右侧 hairline 上；只有其中央 1px 在 hover / 拖拽中 /
  `:focus-visible` 时显现一档 `--hover` 底色。命中宽度与可见宽度分离是阅读栏宽手柄的既有手法
  （`src/content-width.ts`），不新增色值、不新增尺寸 token（eink 由既有 token 自动覆盖）。
  定位：`position: absolute`，纵跨主行（grid `row 2`），`left` 由 `--layout-sidebar-w` 派生——
  **MUST NOT 作为网格项参与排布**（`.app-shell` 的 `grid-template-columns` 只有两列，多一个
  网格项会把正文挤到下一行）。
- 手势：`pointerdown` → `setPointerCapture` → 每次 `pointermove` 记读数 → rAF 合并后
  `applySidebarWidth(clamp(width))`（实时重排）；`pointerup` 时若值有变化 → `configSetUiValue
  ("sidebar_width", w)` 一次。写失败降级为 toast + 诊断日志、**运行期宽度不回滚**（与阅读栏宽
  D3 逐条同口径）。
- 运行期钳制：`[SIDEBAR_WIDTH_MIN, min(SIDEBAR_WIDTH_MAX, window.innerWidth * 0.4)]`——窗口很窄
  时不让左栏吃掉正文；窗口尺寸变化时按同一式子重钳（不写盘：盘上存的是用户意图值，静态区间
  已由 Rust 校验）。
- 拖拽期零 IPC、零布局读取竞态：宽度施加只写 token；分隔条位置由网格列宽决定，不需要二次测量。

### 1.3 与标题栏的对齐

`.titlebar-traffic` 的 `width: var(--layout-sidebar-w)` 在宽度变化后自动跟随（同一 token），
产品标识块与侧栏右缘因此仍像素对齐——**这是既有的对齐机制**，本 change 不新增对齐代码。
分隔条不得进入标题栏行（标题栏是独立网格行，`grid-column: 1 / -1`），拖拽热区只覆盖主行。

## 2. 收起与展开（⌘B）

### 2.1 状态与几何

- 状态：`.app-shell` 上的 `is-sidebar-hidden` class（**运行期态，不落盘**，D2）。
- 收起几何：`.app-shell.is-sidebar-hidden` 的 `grid-template-columns: 0 minmax(0, 1fr)`；
  `.pane-filetree { display: none }`（藏 DOM，不销毁——树模型、展开态、watcher 订阅全部保留）；
  `.titlebar-traffic { width: auto }`（标识块贴到交通灯右侧，不再留 236px 空位）。
- 展开：移除 class，宽度自动回到 `--layout-sidebar-w`（token 值未变，因此「收起前的宽度」不需要
  单独记忆）。
- 收起时**分隔条不显示、不可拖**（收起态没有任何可调宽度，留着命中带会在窗口左缘形成一条无意义的
  拖拽热区）。

### 2.2 焦点与在手交互（收起的必要条件）

收起是「隐藏用户可能正在操作的面」，因此必须先收掉在手状态，顺序固定：

1. 关闭树右键菜单（若开着）；
2. 取消进行中的行内编辑（重命名 / 新建）——**按取消处理**，不提交半截输入；
3. 若焦点在左栏内（树行、编辑框、菜单），把焦点交还活跃文档 pane 的编辑器；
4. 施加 class。

不做第 2 步就会留下一个「编辑着但看不见」的状态（输入框被 `display: none` 藏起来，提交/取消
两条路都断了）。第 3 步是键盘可用性底线：焦点落在不可见元素上时，按键会进一个用户看不见的地方。

### 2.3 命令与键位

- 命令 id `view.toggle-sidebar`（`view.*` 族，与 `view.theme-cycle` / `view.toggle-line-wrap`
  同族），scope `global`（焦点在编辑器、文件树、harness composer 时都要能按）。
- 默认键位 `Cmd-b`。冲突已核三条：① 表内——`grep 'key: "Cmd-'` 全表无 `Cmd-b`（`Ctrl-b` 是
  `editor.cursor-backward`，作用域 `text`，与 ⌘ 系不冲突）；② 原生菜单——`Menu::default()`
  的预置 accelerator 里唯一的 ⌘ 系截获项是 `CloseWindow`（⌘W），自建项只有 ⌘Q；③ 系统级——
  macOS 不给 ⌘B 预置系统菜单项（Bold 在文本编辑语义里，本应用无原生菜单项占用）。
- 「无孤儿命令」不变量：新命令有默认绑定，**不进** `KEYLESS_COMMAND_IDS`；键位查看面板与
  `[keys]` 重绑 / 解绑照既有语义生效（解绑后 ⌘B 无操作）。

## 3. vault 根右键新建

### 3.1 命中面（与拖拽落点同一条判据）

复用拖拽落点已定义的「vault 根」概念：**指针不在任何条目行带内**时，所在位置表示 vault 根。
两处落点（M538 已实现在拖拽里）：

- 树头部（`.ft-header`，vault 名那一行）；
- 列表尾部之下的空白（`.filetree` 的 `min-height: 100%` 撑出的区域）。

实现上只改一处：`contextmenu` 监听在 `rowLiAt(...) === null` 时不再直接 `return`，而是
`preventDefault()` 并请求 root 菜单。**命中行时行为逐字节不变**（既有条目菜单）。
未装载 vault 时树容器不在场，因此不会出现「空态也能新建」的形态。

### 3.2 菜单项集与动作

- `menuItemsFor` 增加第三档输入 `"root"`：`[新建文件, 新建子目录]`（无分隔线、无破坏性项）。
  这是项集定义的**唯一**位置——菜单渲染、单测、验收断言同源（既有纪律）。
- 动作复用 `runTreeAction` 的 `new-file` / `new-dir` 分支，`parentRel = ""`；`beginCreate("")`
  已能正确把输入行插到根列表首位（`:1017`）。
- 目标形态：`TreeMenuTarget` 的 `path = ""`、`kind = "dir"`、`name = vault 名`、`anchor` =
  vault 名按钮（关闭菜单后焦点归还它）——根没有行元素，锚点取头部入口是最近的等价物。
- 「右键不改上下文」原样有效：打开与关闭都不触发打开动作、不改当前行、不改标签。

### 3.3 拦下 webview 默认菜单

根区域右键必须 `preventDefault()`。理由有两条：① 默认菜单里的 Reload 是页面刷新，与文件树
无关（文件树由 watcher 增量维护，没有需要手工刷新的状态，D4）；② 同一面板里两种右键行为
（行上有自绘菜单、空白处弹系统菜单）本身是缺陷形态。

## 4. 待裁决点

| # | 裁决点 | 选项与倾向 | 若裁另一侧的影响面 |
|---|---|---|---|
| D1 | 宽度区间与默认值 | **倾向 `[180, 480]`、默认 236**（理由：默认不动 ⇒ 视觉基线零更新；180 保住 vault 名 + 箭头，480 够放长文件名） | 改两端常量 + Rust 区间 + 单测；默认值一动，全部整页基线需重截（人肉裁决点） |
| D2 | 收起状态是否跨启动 | **倾向不持久化**（启动即显示；隐藏的左栏易被读成缺陷） | 改设计：与宽度同路落盘（全局或 per-vault 需再裁），并考虑启动无左栏时的首个引导 |
| D3 | 恢复通道是否只有 ⌘B | **倾向只有 ⌘B**（单入口单真源；键位面板可查） | 加标题栏恢复钮 = 新增常驻 chrome 元素，需要视觉口径与视觉场景 |
| D4 | 根菜单是否保留 Reload | **倾向不保留**（Reload 是 webview 页面刷新，不是产品能力） | 若保留，需先定义「刷新」语义（重扫 vault？与 watcher 的关系？）——那是另一个能力 |
| D5 | 根新建命中面 | **倾向树头部 + 尾部空白**（与拖拽落点同判据） | 只留树头部时，尾部空白仍弹系统菜单，同面板两种右键行为 |
| D6 | 收起时是否留边缘悬停把手 | **倾向不留**（单入口；热区会与分隔条拖拽打架） | 需要定热区宽度、显现时机与它和分隔条的优先级 |

## 5. 视觉约束（无原型；此节是实现的视觉口径）

本 change **没有原型**（Alex 的需求是行为描述，未给稿）。以下口径用于防止「行为对、形态走样」：

- 分隔条：静止态**零足迹**（不可见、不占宽）；hover / 拖拽中 / `:focus-visible` 时显现
  `--hover` 一档底色，宽度 1px（与既有 hairline 同宽），不做圆角、不加阴影、不加图标。
- 收起态：标题栏左段 = 原生交通灯（系统绘制）+ 产品标识块，间距沿用 `--sp-3`；
  正文区左缘贴到窗口左缘，不留任何 padding 补偿。
- 拖拽中：光标保持 `col-resize`；拖拽期**不显示**浮层读数（与 pane 分隔条、阅读栏宽手柄一致）。
- 全部取值只取既有 token；MUST NOT 引入新色值、新字号、新圆角。

## 6. 不变量与边界

- **默认态逐像素不变**：未拖、未收起时，骨架几何、标题栏 traffic 宽、树形态与本次改动前一致
  （这是「既有视觉基线零更新」的前提）。
- **阅读位置 / CL-2 不涉及**：左栏不推动编辑器视口，无需转场窗口。
- **树模型不重建**：收起只切 `display`，不触发 `renderAll`；展开后展开态、当前行、惰性目录的
  已取回登记全部保留。
- **根新建与目录行新建是同一能力**：内联校验、后端权威判定、watcher 回响收敛全部复用，MUST NOT
  为根另写一套创建路径。
- **宽度写盘失败不回滚运行期值**（与阅读栏宽 D3 同口径），只 toast + `config_warning` 诊断事件。

## 7. 验证策略（判别性优先）

- **纯函数单测**（`tests/unit/sidebar-width.test.ts`）：`clampSidebarWidth` 的端点 / NaN /
  越界；运行期窗口钳制（0.4 × 宽度）与静态区间的叠加；token 名与三处默认值同值的对账断言
  （与 `CONTENT_WIDTH` 同族写法）。
- **视觉门禁**（`tests/visual/scenes/`，chromium + `tauri-stub`）：
  - 拖拽：从分隔条按下拖 80px → `.pane-filetree` 的计算宽度 = 期望值、`--layout-sidebar-w`
    读值一致、标题栏 traffic 宽同步；松手恰好一次 `config_set_ui_value`（桩记录 invoke 序列）。
  - 收起：按 `Cmd-b` → 网格首列 0、`.pane-filetree` 不可见、traffic 区宽度 = 标识块自然宽、
    文档正文左缘贴左；再按一次 → 全部复原（逐值对照收起前读数）。
  - 根右键：在树头部与尾部空白各右键一次 → 菜单出现且项集为两条新建、`preventDefault` 生效
    （桩里断言默认菜单无出口不可行时，退化为「菜单元素在场 + 当前行与标签不变」）。
  - 既有整页基线**零更新**：默认态未变即可；若实现导致任何整页基线变化，按「基线更新是人肉
    裁决点」处理，先报 Alex 过目。
- **真机验收**（`scripts/acceptance/scenarios/`）：拖宽 → 重启 app → 宽度保持；⌘B 来回；根右键
  新建文件（自动打开）与新建目录（不展开父目录）；隐藏态下焦点仍在文档、可在编辑器里打字。
- **门禁**：`scripts/gate.sh quick` 全绿；动过 `src/style.css` 与 `tests/visual/scenes/` ⇒
  另跑 `scripts/gate.sh visual` 并按 `GATE RESULT` 原文报告。

## 8. 已知边界（如实登记，不包装成覆盖）

1. 窗口宽度小于约 450px 时，左栏会被运行期钳到窗口的 40% 以下；盘上存的仍是用户拖出的值。
2. 收起态不跨启动（D2）：这是**选择**，不是遗漏。
3. 根右键的「尾部空白」依赖 `.filetree` 撑满 pane 高度（M538 的既有实现）；树被滚到底时尾部
   空白仍属于容器命中面，但需要列表短于视口才有可见空白——长列表滚到底后，空白只在
   「列表比视口短」时存在。
4. 拖拽宽度是整数像素；小数宽度在执行时取整（读数可逐值比对）。
5. **改宽只有指针拖拽一条通道**：分隔条可聚焦、有读屏名、`aria-valuenow` 随宽度更新，但不提供
   键盘步进命令（⌥←/⌥→ 之类）。这是有意的范围取舍（需求原话是「拖拽」），如实登记；要键盘
   步进属另一条命令，需单独立项。
