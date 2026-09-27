# Design: product-version-display

本文件是「标题栏常显产品名与版本号」的机制设计。§1 现状盘点（锚点可复核），§2 标题栏
剩余空间实测（本提案的硬依据），§3 机制设计，§4 被否决方案。

## 1. 现状盘点

| 环节 | 事实 | 锚点 |
|---|---|---|
| 标题栏 DOM | `createShell` 建 `header.titlebar`（`data-tauri-drag-region="deep"`，整条可拖拽），子节点只有 `div.titlebar-traffic`（236px 占位）与 `nav.tabstrip`（空态 hidden） | `src/shell.ts:48-64` |
| 标题栏 CSS | 42px 高、flex、右 padding `--sp-6`（12px）；tabstrip `flex: 1 1 auto` + `overflow-x: auto`——tab 自身 `flex: 0 0 auto`（不收缩），溢出 = 横向滚动 | `src/style.css:304-336`、`:345-360`（.tab） |
| 右侧动作钮区 | 本版零 DOM 零 CSS（预留槽位）；`--layout-tb-btn`（30×28）入库无消费者是**有意的预留面** | `src/style.css:338-342`（自述）；restyle delta「应用骨架布局」 |
| 版本号真源 | `productName = "Lumir"`、`version = "0.0.0"`；`app.windows[0].title = "Lumir"`（hiddenTitle: true，不可见） | `src-tauri/tauri.conf.json:3-4`、`:15`、`:19` |
| 前端链路 | **无现存 IPC** 暴露产品名 / 版本号；`src/ipc.ts` 是 invoke 的唯一封装层，全部命令逐条核对无此项 | `src/ipc.ts` 全文；`grep -rn 'getVersion\|getName' src/` 零命中 |
| 官方内置通道 | `@tauri-apps/api` ^2.11.1 已在依赖；`@tauri-apps/api/app` 的 `getName()` / `getVersion()` 读到的就是 tauri.conf.json 的 productName / version（Tauri 2 官方 API，构建期注入）；所需 ACL 权限名在 schema 中存在 | `package.json:32`；`src-tauri/gen/schemas/desktop-schema.json`（`core:app:allow-name` / `core:app:allow-version`） |
| 现有 ACL | 3 条（event listen/unlisten + window start-dragging），无 app 族——**不加权限则 `getVersion()` 被 ACL 拒绝**（M26 先例：无 capabilities 时 listen 静默失败） | `src-tauri/capabilities/default.json` |
| modeline | 25px，左「路径 › 大纲指示段」右「语法 · 行数 · UTF-8」；右段文案由装配层派生写入（`syncModelineMeta`）；11px `--fs-label` / `--text-3` | `src/shell.ts:72-90`；`src/main.ts:592-613`；`src/style.css:438-498` |
| token 真源 | 字号阶梯（`--fs-ui-s` 12.5 / `--fs-label-s` 11.5 / `--fs-label` 11）、字重档（400/500/550/600/650/680/700）、字色 3 档（`--text`/`--text-2`/`--text-3`）、间距 2px 基网 | `src/style.css:136-177`；`docs/specs/design-tokens-v1.md` 字体节 / 间距节 |

## 2. 标题栏剩余空间实测

**方法**：master tip（`1e2aca2`）`pnpm build` 产物，chromium + `tests/visual` 的 tauri 桩
（`stubTauri` + `DEMO_VAULT`），vite preview 端口 1559（不碰 1420/1430）；双击钉住 4 个
固定标签（README.md / LICENSE / guide.md / notes.txt），逐档 `setViewportSize` 量测
`getBoundingClientRect` 与 `scrollWidth`，并对标题栏矩形 clip 截图。探针脚本与全部产物在
`test-results/m225-probe/`（git 外证据目录）。**口径注意**：chromium 近似（与视觉门禁同一
近似层），字体度量与 WKWebView 有亚像素差；量的是 flex 几何，结论对渲染引擎不敏感。

**量测结果**（`results/measurements.json`）：

| 窗口宽 | 标题栏宽 | traffic | 标签区可视 | 标签内容实宽 | 右端空闲 |
|---|---|---|---|---|---|
| 1200（空态） | 1200 | 236 | —（hidden） | 0 | **952** |
| 1200 | 1200 | 236 | 952 | ≈446（4 标签 122/100/104/102 + gap） | **≈506** |
| 1000 | 1000 | 236 | 752 | ≈446 | ≈306 |
| 900 | 900 | 236 | 652 | ≈446 | ≈206 |
| 800 | 800 | 236 | 552 | ≈446 | ≈106 |
| 700 | 700 | 236 | 452 | ≈446 | **≈6** |
| 600 | 600 | 236 | 352 | 447（scrollWidth） | **−95（开始横滚）** |
| 520 | 520 | 236 | 272 | 447 | −175（横滚） |

**文案渲染宽度**（`--font-sans`，实测）：

| 文案 | 12.5px/400 | 12.5px/550 | 11.5px/550 | 11px/550 |
|---|---|---|---|---|
| Lumir | 32.9 | 34.4 | 32.0 | 30.7 |
| 0.0.0 | 30.9 | 32.3 | 30.0 | 28.9 |
| Lumir · 0.0.0 | 74.4 | **77.3** | 72.0 | 69.3 |
| Lumir 0.0.0（空格） | 67.3 | 70.0 | 65.1 | 62.7 |

**结论**：标识块按 ≈95px 预算（77 文案 + 左右间距），在默认 1200px 窗口下余量 5 倍以上；
即便 8 个短名标签（≈900px）仍不挤压。「放不下」只在窗口 <~750px 且多标签时发生——
由 §3.2 的退让策略吸收，不构成拆分的默认理由。

## 3. 机制设计

### 3.1 DOM 落位与排版

- `src/shell.ts`：标题栏 append 第三个子节点 `<span class="titlebar-identity">`，内部分三段
  `<span class="ti-name">Lumir</span>` + `<span class="ti-sep">·</span>` +
  `<span class="ti-version">0.0.0</span>`（实现期结论：分隔符独立成段——D2 备选的退让要单独
  隐藏「分隔符 + 版本号」两段，独立 span 比「版本段前置分隔符」的文本切片干净；文案组装只在
  `src/modeline.ts` 一处）。
  容器带读屏名（`aria-label` 或 SR-only 前缀「应用版本」口径，实现期照 tabstrip 的
  `aria-label` 先例），纯展示、不可点（不是 button——无点击语义，MUST NOT 做成假控件）。
- **样式**（`src/style.css`，全部现行 token，零新值）：
  - 容器：`flex: none`（不参与收缩）、`margin-left: auto` 右端对齐（在 tabstrip 之后，
    即使 tabstrip hidden 也钉在右端）、`display: flex; align-items: center; gap: var(--sp-3)`、
    与标签的间距由 tabstrip 既有 `padding-left: var(--sp-3)` 与容器自身 `margin-left` 吸收，
    右缘已有 `--sp-6` padding；`user-select: none`（标识不是文本内容，框选标题栏不应带走它）。
  - 字档（裁决点 D3 推荐项）：产品名 `font-size: var(--fs-ui-s)`（12.5，与同行标签同档）、
    `font-weight: var(--fw-emphasis)`（550 特征档）、`color: var(--text-2)`；分隔符与版本号
    `color: var(--text-3)`、常规字重。整行 `font-family: var(--font-sans)` 继承，
    `tabular-nums` 随基体特性自然生效（版本号数字对齐）。
  - **三主题成立性**：只吃 `--text-2` / `--text-3`，两档字色在三主题都有定义（dark
    `#9b9a91`/`#62615b`，eink `#3d3d3d`/`#6e6e6e`），零组件级覆盖、零新色——eink 规则
    无一触发（无色相、无阴影、无底块）。
- **拖拽区共存**：标题栏整条是 `data-tauri-drag-region="deep"`；span 不是 clickable 元素，
  Tauri 的 drag.js 不会为它阻断拖拽（与 traffic 占位 div 同性质）——标识块上按下拖拽窗口
  仍然成立。实现期真机验收须覆盖这一点（场景 39 的断言项）。
- **与未来动作钮槽位的关系**：标识块是「信息展示」不是「动作钮」，物理上它占据右端——
  未来动作钮接入时排在标识块**左侧**（动作钮靠近内容区、产品标识钉窗口角，与 macOS
  惯例一致），间距走 `--sp-3`。本 change 不落动作钮 DOM/CSS，只在样式注释里写清这个
  排列约定（防下一次接入时把标识块挪位造成视觉基线漂移）。

### 3.2 窗口变窄的退让策略（裁决点 D2：**Alex 改选备选**，2026-09-25）

- **规则：窗口宽 < 640px 时，版本号退 modeline**。「Lumir」产品名钉在标题栏右端不动；
  版本号（连同「·」分隔符）从标题栏消失，拼进 modeline 右段尾部——「语法 · 行数 · UTF-8 · 0.0.0」。
  回到 ≥ 640px 时版本号回到标题栏。这是 Alex 原话「放不下就拆开放在不同的地方」的响应式形态。
- **阈值取 640px**（提案 D2 备选的示例值，裁决即采纳该量级）：实测表（§2）显示 700px +
  4 个短名标签时右端空闲只剩 ≈6px，800px 时才回到 106px（>95px 预算）；640 以下多标签
  必然横滚，退版本号给标签区腾出 ~65px。判定用 `matchMedia("(max-width: 639px)")`——
  纯宽度阈值、不数标签个数：规则确定性优先于「按实际占用动态算」（后者要监听标签流
  尺寸，增量复杂度不配收益）。
- **实现落点**：退让逻辑在 `src/modeline.ts`（新模块，modeline 右段因此有了第二个写入者，
  版本号段是独立 span、与 `syncModelineMeta` 管的 meta 段互不覆盖——两个写入者各写各的
  元素，MUST NOT 合写同一个 textContent）。标题栏侧只隐藏 `ti-sep` / `ti-version` 两段，
  产品名段始终在。
- **标识块本身不收缩、不截断**（MUST NOT ellipsis——「Lumir · 0…」是假信息）；640px 以上
  的挤压仍由 tabstrip 的既有 `overflow-x: auto` 吸收。
- **空态**：无标签时 tabstrip hidden（`display: none`，`src/style.css:333-335`），
  标识块凭 `margin-left: auto` 仍钉右端——空态截图基线会因此变化（实现期须过视觉门禁
  并更新相关整页基线，走 Alex 过目流程，`tests/visual/README.md` 基线纪律）。
- **已知代价**（裁决时 Alex 知情）：版本号有两个展示位（标题栏 / modeline 右段尾部），
  写两处、读两处、测两处；跨越阈值瞬间界面元素跳动。验收覆盖：视觉场景
  （chromium，520px ↔ 1200px 往返断言两段 DOM 的显隐与文案）+ 真机场景 39（≈520px 退让）。
- macOS 窗口没有 min-width 配置（`tauri.conf.json:13-20` 未设），本 change **不新增
  min-width**（那约束的是整个应用而不止标题栏，是另一个裁决）。

### 3.3 版本号获取机制

- **通道**：`import { getName, getVersion } from "@tauri-apps/api/app"`——Tauri 2 内置 app
  模块，返回值即 tauri.conf.json 的 `productName` / `version`（构建期注入，真源唯一，
  REVIEW.md 第 8 条：前端 MUST NOT 再硬编码一份 "Lumir" 字面量）。
- **ACL**：`src-tauri/capabilities/default.json` 增加 `core:app:allow-name` 与
  `core:app:allow-version`（两条只读权限，schema 已列；description 补一句来由，照现有
  三条权限的注释密度）。
- **装配**：`src/main.ts` 启动装配段调用一次（与 `configGet()` 同批的启动读取位置），
  `Promise.all` 拿到后写 DOM；**失败降级**：任一调用 reject（ACL 漏配 / 非 Tauri 环境如
  chromium 视觉场景）→ 标识块隐藏（`hidden`）+ `logEvent` 一条——宁可不显示，不显示
  假版本号（REVIEW.md 第 2 条：「读不到」不许被当成「值为空」渲染出去）。视觉门禁的
  tauri 桩侧相应给 `plugin:app|name` / `plugin:app|version` 两条 invoke 路由（桩按
  __TAURI_INTERNALS__ 形状补，fixture 值固定 "Lumir" / "0.0.0"），保证视觉场景里标识块
  在场可断言。
- **时序**：启动读一次，运行期不刷新（版本号构建期固化，没有可监听的变化源）。

### 3.4 文档口径同步（实现期必做）

- `src/shell.ts:48-56` 的标题栏注释（「traffic 灯区 + 标签段」两段式自述）改为三段式。
- `src/style.css:338-342` 的「本版没有动作钮」自述补「右端已有标识块，动作钮接入时排其
  左侧」的排列约定。
- restyle delta「应用骨架布局」的「空态标题栏只剩 traffic 灯区」场景表述在归档时已与本
  change 冲突——本 change 的 specs delta 直接 MODIFIED 该条（见 specs/ui-design-system/spec.md）。

## 4. 被否决方案

| 方案 | 否决理由 |
|---|---|
| 新增 Rust 命令 `app_meta()` 返回 productName/version | 官方内置通道（`@tauri-apps/api/app` + 2 条 ACL）零新代码可达同一真源；自写命令 = 新 invoke 契约 + ts-rs 导出 + ACL 各一份，纯增量（唯一例外：若实现期发现内置通道在本仓 CSP/ACL 下不可用，回落此方案，design §3.3 已写明验证点） |
| 水平居中落位 | 裁决点 D1 备选：与右滑增长的标签流争夺同一水平带，碰撞规则无现成答案；空态 / 多标签下视觉重心漂移 |
| 标签横滚保标识（原 D2 推荐项） | **Alex 节点 1 改选备选**（2026-09-25）：极窄窗下标签区多 ~65px 的收益被采纳，两处展示位的成本被接受；原推荐项随之作废（它假设「常显优先级高于标签可视宽」在所有宽度成立，与裁决冲突） |
| 标识块可截断（ellipsis） | 95px 预算不存在正常截断场景；截断出的「Lumir · 0…」是假信息，违反「不显示假版本号」口径 |
| 版本号进 modeline 右段常显（默认拆分） | 实测不支持「标题栏放不下」的前提（§2：默认窗口余量 5 倍）；modeline 右段是「文档派生信息」语义位（语法/行数/编码随前台文档变），版本号是应用级常量，语义不同位 |
| 跟随 config.json 运行期刷新 / 监听变化 | 版本号构建期固化，没有变化源；启动读一次即完备 |
