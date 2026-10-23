# Design: 启动态（App 启动屏）

> 起草注记：本文按「起草期取值」的**倾向侧**写——D1 感知性能 / D2 到树可用 / D3 前端两段式启动 /
> D4 骨架 + 产品标记 + 阶段行 / D5 首帧前施主题。若 D1 裁品牌仪式，§2 / §3 重写、静态首帧方案转入首选，
> 且实现前必须补原型与「视觉保真」一节（§10）。若 D2 裁「只到壳挂载」，§4 的 `vault-workspace` MODIFIED
> 整块撤回，本 change 退化为纯新 capability（体积约减半）。

术语（本文与 spec 一致，首次出现就地定义）：

- **启动态（startup state）**：从主窗 webview 的首个内容帧起，到当前 vault 的树可交互（或落到未打开终态）
  为止，屏幕上那一个覆盖整窗的、结构化、只讲真话的启动面。
- **启动层（boot layer）**：主模块之外的一层薄入口，负责读配置、施主题、画启动态的首帧，然后才装载主模块。

## 0. 事实清单（起草时核对过的原文）

| # | 事实 | 出处 |
|---|---|---|
| F1 | 主窗声明式创建：`visible: false`、`backgroundColor: "#fdfdfc"`、`titleBarStyle: Overlay` | `src-tauri/tauri.conf.json` 的 `app.windows[0]` |
| F2 | setup 次序：`logging::init` → `migrate_legacy_registry_dir_at_startup` → `emit_ready` → 菜单手术 → `window_state::init` → `apply_startup_size`（施加尺寸 → `show()` → `set_focus`）→ `start_restore` → `start_cron` | `src-tauri/src/lib.rs:187-210`、`:307-361` |
| F3 | 窗口底色（M525）在**恢复线程**里施加：`restore_last_vault` 第一件事是 `window_chrome::apply_startup_window_background` | `src-tauri/src/lib.rs:766-774`；`src-tauri/src/window_chrome.rs` 模块头 |
| F4 | 冷启动端点 = spawn → stdout 出现 `LUMIR_READY `；**不含**前端首屏挂载、**不含** `last_vault` 恢复 | [docs/specs/perf-measurement.md](../../../docs/specs/perf-measurement.md) §1；`src-tauri/src/ready.rs` 契约 |
| F5 | `index.html` 只有一个空的 `#app` 与一条指向 `/src/main.ts` 的模块脚本；CSS 由 `src/main.ts:142` import | `index.html`、`src/main.ts:142-147` |
| F6 | 壳在模块顶层同步建出（`const shell = createShell(app)`），早于任何异步配置读 | `src/main.ts:187` |
| F7 | 主题在 `configGet().then(...)` 末尾施加；未施加前 `data-theme` 缺失 ⇒ 命中 `:root, :root[data-theme="light"]` 默认块 | `src/main.ts:3731-3808`；`src/style.css:14-15` |
| F8 | 骨架几何 token：`--layout-titlebar-h: 42px` / `--layout-sidebar-w: 236px` / `--layout-modeline-h: 25px` / `--layout-tree-row-h: 25px`；过渡只有 `--dur-hover: 0.1s` / `--dur-ui: 0.12s` | `src/style.css:225-228`、`:239`、`:250-251` |
| F9 | 动效纪律：不得新增入场动画或弹性曲线；全仓只有 hover 过渡与 pulse 呼吸 | `openspec/specs/ui-design-system/spec.md`「chrome 表面与动效纪律」 |
| F10 | 恢复中态的既有形态：`.ft-empty`（notice 行 + D5 引导 + 「打开 vault」按钮）；启动路径**不开** M252 的装载指示器（`begin` 只在 `loadUserVault`） | `src/tree.ts:1475-1504`；`src/main.ts:1657`、`:1683-1696`、`:3682-3706` |
| F11 | 恢复让位规则、「打开 vault」入口在恢复期间可用、`LUMIR_READY` 位置不动 | `openspec/specs/vault-workspace/spec.md`「启动恢复的时序与可见性」 |
| F12 | 产品名真源是 `tauri.conf.json` 的 `productName`，前端经内置通道读取，**不得硬编码** | `openspec/specs/ui-design-system/spec.md`「产品名与版本号常显」；`src/main.ts:3714-3726` |
| F13 | 诊断日志只收白名单事件名与字段（非白名单被拒），前端经 `log_event` 落盘 | `src-tauri/src/logging.rs` 模块头 |
| F14 | 树装载是 `applyVault` 里的同步整树重建（「大 vault 上可能数百 ms」），会话恢复在其后异步发生 | `src/main.ts:3586-3615` |
| F15 | `createShell` 用 `mount.replaceChildren(root)` **整体替换 `#app` 的子节点** | `src/shell.ts:94`、`:248` |

## 1. 分段与可挂点

| 阶段 | 今天这一段的呈现 | 能挂启动屏吗 | 结论 |
|---|---|---|---|
| S0 进程装载 → setup | 无（窗口未显示） | 不能（webview 还不存在） | 只有 Dock 图标，任何界面都不在这里 |
| S1 `LUMIR_READY` → `show()` | 空窗，原生底色 | 只能由原生层画 | 不做原生层；这段时间短、且已有底色兜底（另有一个次序缺陷，§9） |
| S2 页面装载 + 主模块执行 + 壳挂载 | 空窗 → 半成品壳 | **能，且只有 webview 能** | 启动态的天然起点：启动层先画，主模块后载 |
| S3 主题施加 | 首个内容帧可能按 light 默认块出图（结构上成立：壳先于主题建出；是否已上屏未实测） | — | 与 S2 合并处理：启动层把主题施加提到首帧之前（D5） |
| S4 vault 状态落地 | 恢复中：D95 一行 | 能（会与 D95 冲突） | 启动态吸收它（D2 / MODIFIED） |
| S5 树装载 | 空树/旧空态 | 能（这正是「大 vault 慢」最贵的一段） | 启动态活到这一段结束（D2） |
| S6 标签恢复 | 标签逐个出现 | 能，但不该 | 不纳入：它与「打开 1MB 文档」的等待同构，M252 的指示器已覆盖用户发起的装载；纳入会把启动态变成长尾 |

**结论（对应 mission 任务 1）**：启动屏挂在 **webview 的首个内容帧**，渲染者是**前端启动层**，不是原生窗；
生命周期从 `LUMIR_READY` 之后前端开始执行起（S2 起点）到 S5 结束。S0–S1 不归任何前端面。

## 2. 形态

### 2.1 启动态不是遮罩层，是首个内容帧

遮罩（overlay）意味着「底下有一个已经画好的界面被盖住」，而 S2 时界面根本不存在。启动态因此是整窗唯一的
**可见**内容：不是盖在已建界面上的蒙层，而是壳尚未就位时唯一的呈现面。撤下那一帧它直接把可见面交给真实壳
——没有「蒙层消失」的过程，也就没有需要动画的转场。

**它必须挂在 `#app` 之外**：`createShell` 用 `mount.replaceChildren(root)` 整体替换 `#app` 的子节点（F15），
挂在 `#app` 里的启动面会在壳建出的一瞬间被抹掉。启动层因此在 `document.body` 下建一个独立兄弟节点（如
`#startup`）覆盖整窗；壳照常在 `#app` 里建，建完仍被启动面盖住，直到撤下。这也让撤下那一帧是「揭开已就位的
界面」而不是「替换一个半成品」。

### 2.2 生命周期

- **起点**：启动层写完启动面 DOM 后的首个绘制帧（§3.4 的 `nextPaint`）。
- **终点（三选一先到）**：
  1. 当前 vault 的树装载完成——挂在 `applyVault` 的 `tree.setVault` 之后（F14 的同一段，`phaseMs(treeAt, ...)`
     之后）：树已经可交互，启动态没有理由继续在场；
  2. vault 状态落到「未打开」终态——挂在 `refreshVaultStatus` 的 `tree.showEmpty(...)` 分支（F10）：
     无 `last_vault` / 路径失效 / 打开失败 / 配置读失败都由这一条覆盖；
  3. 安全阀超时（实现值 ≤10s）：恢复线程理论上一定会走 `RestoreGuard` 的收尾（`src-tauri/src/lib.rs:694-759`），
     但「打开网络卷上的 vault」这类路径可能长时间不返回——启动态 MUST NOT 变成把人困住的盖子。
- **撤下**：单帧内移除（`remove()` 而非改 opacity），无过渡、无动画（F9）。
- **不新造状态机**：两个终点都挂在既有收口上，启动层只暴露一个 `dismiss(reason)`；撤下原因同时进诊断读数（§5）。

### 2.3 内容形态

- **骨架**：整窗几何（标题栏 42 / 侧栏 236 / 内容区 / modeline 25）与左侧若干条树行占位（25px 行高），
  全部取 F8 的 `--layout-*` token；占位块填充取 `--hover` / `--border` 档。骨架只表达「结构在长出来」，
  **不画假条目名、不画假数字**。标题栏占位带 MUST 带 `data-tauri-drag-region`（与真实壳同口径）：启动态期间
  窗口仍要能拖动；启动面容器 MUST NOT 挂 `mousedown` + `preventDefault`（REVIEW.md『标题栏 mousedown
  preventDefault 打断拖拽』条：容器级「别抢焦点」的写法会静默打断窗口拖拽）。
- **产品标记**：内容区居中的产品名（`getName()`，F12 的真源），失败或未就绪则整体不显示——派生规则沿用
  「读取失败隐藏标识块」口径。启动态**不显示版本号**：版本号的常显位是真实壳的标题栏标识块，启动态不是
  标题栏，重复显示等于第二个展示位。
- **阶段行**：只在恢复进行中显示，文本取既有 D95（`tree.showEmpty` 用的同一句，文案真源在 `文案-Copy.md` /
  `src/copy-data.ts`）；其余阶段不显示任何文案。**MUST NOT** 出现百分比、剩余时间、条目数。
- **字体层级**：产品标记取既有的产品名档（与标题栏标识块同一档字号 / 字重），阶段行取 meta 档（`--text-2`
  或 `--text-3`）。不新造字号档（本仓没有独立的 splash 字层级，也不该为此新增一档）。

### 2.4 三主题

三主题下同构：几何与字号不变，颜色全部走 token。eink 档的占位块与底色对比按既有 `--hover`（`rgba(0,0,0,0.06)`）
走，不另立 eink 专用覆盖。启动态**不设**专门的 `data-surface="splash"` 主题块——它只用既有 token。

## 3. 机制：前端两段式启动（D3 的倾向侧）

### 3.1 为什么不是静态 `index.html` 首帧

静态首帧能把「窗口上屏即见骨架」做到极致，但要付两笔账：

1. **主题通道**：`index.html` 的静态标记在 `configGet` 之前绘制，拿不到 `[ui] theme`，只能按默认 light 出图
   ——对 dark / eink 用户就是一次异色闪烁（M525 要消除的正是这类）。要让静态首帧主题正确，必须在
   document-start 注入主题：`initialization_script` 只存在于 `WebviewWindowBuilder`（程序化建窗），
   `tauri.conf.json` 的 `app.windows[]` 没有该字段（tauri 2.12.4 源码核对，版本取 `src-tauri/Cargo.lock`
   的 pin）；`Builder::on_page_load` 是「导航开始」时机，能否稳定早于文档脚本与首帧需要实测。
2. **第二份布局**：骨架要在 HTML 里再写一遍元素结构。几何值虽可复用 `--layout-*` token，但 DOM 结构是第二份
   真源，后续改壳结构时不会自动跟着变。

两段式启动没有这两笔账：启动层在 JS 里建面、建之前先读配置施主题（一次异步读，见 §3.4），状态与主题都只有
一份真源。

### 3.2 为什么不是独立 splash 窗

- 第二个 webview 的创建成本要么进 `spawn → LUMIR_READY`（与冷启动合同正面冲突），要么晚于它创建——那就
  退化成「主窗出现后再弹一个窗」，观感上是闪一下多出来的窗。
- 窗口焦点 / z 序 / 关闭时序要另立一套：本仓的 `RunEvent` 处理（Resized / CloseRequested / Focused / dirty
  守卫）都按单窗写死（`src-tauri/src/lib.rs:232-287`），加一个窗要逐条排除它，改动面与收益不成比例。

### 3.3 为什么不是把 `show()` 闸到主模块首帧

那会让窗口出现时刻从「setup 完成」推迟到「主模块执行完」，而主模块是全仓最重的一次装载（CodeMirror +
整壳）——用户会看到 Dock 图标更久、屏幕上什么都没有。感知上这是反向优化。**本 change 不动 `show()` 时机**，
只把「上屏 → 启动层首帧」这段空窗变成**可测量**（§5），若后续实测这段显著（≥约 100ms），再单独立案讨论闸门
（见 §9 已知边界）。

### 3.4 启动层的装配次序

```
// src/boot.ts（新入口；index.html 的 script 指向它）
(async () => {                                  // 不用 top-level await：最低系统 10.15 的 WKWebView 是 Safari 13 级，
  const [snapshot, name] = await Promise.all([  // TLA 要 Safari 15（实现期在真机确认，保守起见不用）
    configGet().catch(() => null),              // 启动链路本来就有这一次读；失败 ⇒ 默认主题
    getName().catch(() => null),                // 产品名真源（失败 ⇒ 不显示标记）
  ]);
  handOffConfig(snapshot);                      // 同一份读数交给主模块复用（MUST NOT 再读一次）
  applyThemeAttribute(snapshot);                // 只写 <html data-theme>：颜色 token 生效；不碰 modeline
  mountStartupSurface({ productName: name });   // 骨架 + 标记（name 为空则整块不建）
  await nextPaint();                            // 双 rAF：尽力确保启动态先上屏（best effort，见下「渲染节流」）
  await import("./main");                       // 主模块：整壳 + 编辑器 + 既有启动装配（顶层副作用照旧）
})();
```

三个实现要求：

1. **样式必须在启动层就位**：启动层 SHALL import 启动面用到的样式（与主模块同一份 token 表，MUST NOT 另立
   第二份）；主模块对同一份 CSS 的 import 由构建器去重。否则首个内容帧会是无样式的裸 DOM。
2. **`nextPaint` 只是尽力**：主模块装载是异步的，浏览器通常会在本任务结束后绘制；双 rAF 把「先画后载」的
   意图写清，但不作为正确性依赖（若绘制被推迟，启动态与主模块首帧会落在同一帧，结果仍是启动态先于壳可见）。
3. **主模块装载失败必须撤下启动态**：`await import("./main")` 抛错时（构建损坏 / 语法错误），启动层 MUST
   `dismiss("degraded")` 后把错误交给既有 console 路径，MUST NOT 让启动面顶在最前面当白屏用。

**配置读数只有一份**：`handOffConfig` 把启动层那次 `configGet` 的结果（含失败）交给主模块，主模块的配置装配
从自己再发一次 `configGet` 改为接这份结果（现有形态就是 `configGet().then(...).catch(() => {})`，改动只是
把发起方换掉）。同一份配置两处各读一次会多一次 IPC，也让「谁是启动期配置的读者」出现两个答案。

### 3.5 首帧主题（D5）

启动层在 `mountStartupSurface` 之前 `await configGet()`，因此首个内容帧就带着正确的 `data-theme`。代价是首帧
被一次 IPC 推迟（本机量级为个位数毫秒，实现期记录读数）；收益是关掉 S3 的主题断档——**主模块是在主题施加之前
就把壳建出来的**（F6 → F7），两者之间存在一个「壳已绘制、主题尚未施加」的可能性窗口；它是否真的上屏未实测
（见 §9 第 6 条），但启动层不需要赌这一点。

配置读失败时按既有语义回落默认主题（`config::load` 的 fallback 已在 Rust 侧给出 warning），启动层不再判一次。

### 3.6 隐藏窗口的渲染节流（留给未来的闸门方案）

若将来要做 §3.3 的 show 闸门：**不能**用 rAF 当首帧信号——窗口不可见时 WebKit 可能不派发渲染帧（遮挡 / 不可见
窗口的节流），信号应改为「DOM 就绪 + 主题已施加」，并自带超时兜底。本 change 不用这条路径，登记在此以免后来者
踩同一个坑。

## 4. 与既有不变量的关系

- **`LUMIR_READY`**：位置与语义逐字不变（F2 / F4 / F11）。启动层在 `LUMIR_READY` 之后才可能执行，因此不可能
  影响该端点。
- **setup 零新增同步工作**：本 change 的 Rust 侧改动为零（只动诊断白名单），`lib.rs` 的 setup 次序不变。
- **恢复并发结构**：`restore_pending`、`vault:restore_finished`、让位规则、恢复线程的 `RestoreGuard` 全部不动
  （F11）。启动态只是**呈现层**换了一个面。
- **「打开 vault」入口**：启动态内提供同名入口，复用 `tree.showEmpty` 的 `.ft-open-btn` 回调（`onOpenVault`，
  `src/tree.ts:1504`）与 `loadVault` 的 dirty 守卫路径（`src/main.ts:3536`）——不新开第二条打开链路。
- **键位、焦点与窗口拖拽**：启动态不持焦点、不注册键盘监听、不拦事件（它只是一层静态 DOM）；既有全局键位在
  启动态期间的语义不变（此时没有可操作对象，键位自然落到既有空动作上）。标题栏占位带保留 `data-tauri-drag-region`，
  窗口在启动态期间可拖动——「恢复完成前窗口可交互」这条既有承诺因此在启动态里仍然成立（可拖动 + 入口可点）。
- **动效纪律**：零新增动画 / 过渡（F9）。
- **信息卫生**：启动面只有结构与产品名，不含 vault 名、路径、文件名或任何真实内容。
- **诊断日志**：新增事件名与字段 MUST 先进 `logging.rs` 白名单（F13）；载荷只允许阶段名 / 撤下原因 / 毫秒数 /
  unix 毫秒时间戳。
- **读数可对照**：两条读数都带 unix 毫秒时间戳，与 `LUMIR_READY` 的 `ts_unix_ms`（`src-tauri/src/ready.rs`）
  直接相减即得「窗口上屏 → 启动层首帧」与「上屏 → 撤下」——同一台机器、同一只时钟，不需要额外的跨进程打点。

## 5. 性能接触面与读数

- **端点不动**：不新增 CI 端点、不改 `perf.yml`、不改阈值。理由沿用 perf spec §1 的既有裁决：headless CI 读不到
  webview 内部时刻。
- **新增两条诊断读数**（既有 `log_event` 通道，F13）：
  - `startup_surface` / `phase = first_frame`：启动层首帧绘制完成（带页面内 `performance.now()` 与 unix 毫秒
    时间戳两个读数——前者用于同进程内差值，后者用于与 `LUMIR_READY` 对照）；
  - `startup_surface` / `phase = dismissed` + `reason ∈ {tree_ready, no_vault, timeout, degraded}`。
- **验收判据（同机、同 build、n≥20）**：spawn → `LUMIR_READY` 的 median 增量 ≤10ms。这是本 change 自己的设计
  门槛，比 CI 的 40% 相对回归容忍线紧得多——拿它当「没拖慢」的证据，而不是拿门禁恰好没红当证据。
- **观测缺口补上的那一块**：「上屏 → 启动层首帧」今天没有任何读数（F4 明确排除），本 change 把它变成一条可
  grep 的日志；它不作门禁，只作后续是否需要 show 闸门的判据。
- **实现期落点与实测**：事件名 `startup_surface`、字段 `phase` / `reason` / `ms` / `ts_unix_ms`（白名单在
  `src-tauri/src/logging.rs`，越界字段被拒）；两项实测读数见 §11.4。

## 6. 失败路径与边界

| 情形 | 启动态的行为 |
|---|---|
| 启动层脚本异常 / 样式缺失 | 撤下（degraded），既有启动路径照走；不阻断、不上屏报错 |
| 主模块装载失败 | 同上（§3.4 第 3 条） |
| 无 `last_vault` | 状态终态到达即撤下，露出既有空态与打开入口 |
| `last_vault` 失效 / 打开失败 / 配置读失败 | 同上（`refreshVaultStatus` 的 notice 分支） |
| 恢复线程起不来 | `restore_pending` 保持 false ⇒ 走「未打开终态」撤下（既有降级语义） |
| 用户在启动态里打开另一个 vault | 既有让位规则接管；启动态等**新** vault 的树装载完成再撤下 |
| 大 vault 的同步建树 | 启动态在整段里冻结（静态面不重绘、无 spinner）——这是有意的：转圈需要动画帧，主线程被占时反而卡住 |
| 安全阀超时 | 撤下并露出既有恢复中态（D95 + 入口），用户可继续等或另选 vault |

## 7. 验证策略（判别性优先）

- **视觉场景（`tests/visual`）**：
  - 新场景：在 stub 里把 vault 状态按「恢复中」冻结，截启动态三主题（light / dark / eink）首帧；
  - 断言：几何等于 `--layout-*` 的解析值（标题栏 42 / 侧栏 236 / modeline 25 / 树行 25）；产品名与
    `getName()` 的 stub 值逐字一致；零 `transition` / `animation` 声明命中启动面；
  - 既有场景：**全部**必须在启动面撤下后才截帧——启动面的存在本身是回归（一个场景如果拍到启动面，说明
    撤下信号没接上）。先造一个「不撤下」的输入确认既有场景会红，再实现。
- **单测**：撤下判据是纯函数（输入 = 三个信号 + 是否超时，输出 = 撤下 / 继续）——三选一先到者、超时、
  降级四条各一例；产品名缺失时不建标记。
- **真机验收**：合成大 vault 冷启，按诊断读数断言「首帧 → 撤下 → reason=tree_ready」的顺序；恢复期间从
  启动态打开另一个 vault（让位）；安全阀路径用合成慢加载 fixture。像素归视觉场景，不重复拍。
- **冷启动读数**：本地前后各 20 次（同 build 不现实，用「改动前 build vs 改动后 build」两轮），median 增量
  ≤10ms；CI 读数照旧观察。
- **不可机器判定项**：骨架密度、产品名的位置观感、阶段行的语气——归 Alex 手感/审美裁决，给截图不给阈值。

## 8. 待裁决点

见 `proposal.md` 的「起草期取值」表（D1–D5）。两处耦合关系必须一起读：

- **D1 × D3**：D1 选品牌仪式 ⇒ 启动面必须从窗口上屏那一刻就存在（否则品牌面只在半个启动期里出现），
  D3 只能选静态首帧或独立窗；倾向侧（感知性能）不与 D3 冲突。
- **D2 × D4**：D2 裁「只到壳挂载」⇒ 阶段行几乎不会出现（恢复提示回到 D95 的既有位置），D4 退化为
  「骨架 + 标记」；倾向侧两者一起成立。

## 9. 已知边界（如实登记，不包装成覆盖）

1. **首帧前的空窗消不掉**：窗口 `show()` 早于前端执行（F2 / F5）。这一段里用户可能先看到窗口底色，也可能看到
   webview 自绘的一帧页面背景（页面已加载、启动面尚未挂上时）——后者在 dark / eink 下是浅色（CSS 默认块），
   属同一族的主题断档。本 change 只测量并登记这段的时长（§5、tasks 1.6），不宣称已消除；若后续实测显著，
   单独立案讨论 `show()` 闸门（§3.6 已记下那条路的坑）。**实现期实测**：release 构建、空配置、n=10，
   `LUMIR_READY` → 启动层首帧中位 ≈ 253ms（其中页面自身 ≈ 117ms，`ready` → 页面导航开始 ≈ 135ms）——
   见 §11.4。
2. **窗口底色的施加晚于 `show()`**（F3）：dark / eink 用户可能看到 light 窗口边缘一瞬。属窗口层缺陷，与启动态
   正交，另行登记，不在本 change 内修（proposal 的 Non-goals 已写明）。
3. **标签恢复（S6）不在启动态内**：撤下后标签仍可能逐个出现，与今天一致；要盖住它得把 M252 的指示器扩展到
   启动路径，那是另一个决定。
4. **启动态在同步建树段冻结**：静态面无动画，看起来「停住」是预期行为；不为此加任何 spinner。
5. **`prefers-reduced-motion` 无落点**：本 change 零动画，因此也不需要该开关（若将来加动效，必须先补这条）。
6. **「壳已绘制、主题尚未施加」的窗口期未实测**：结构上存在（F6 → F7），是否真的上屏（即 dark / eink 用户
   今天是否看到过一帧 light 壳）本 mission 没有真机证据，只登记为「未实测」。启动层不依赖这个判断——它把主题
   施加提到启动面绘制之前，无论那次闪烁是否发生，都能消除它；此外它需要修掉「半帧 light 壳」以外的另一种可能：
   先画后载的启动面自身若在主题之前绘制，同样会错色。
7. **启动层自己的空 body 帧**：页面已加载、启动面尚未挂上的那一小段（`await configGet` 期间），webview 可能
   先绘制一帧页面背景。启动面本身不会错色（它在主题施加之后才建），但这一帧在 dark / eink 下是浅色的。
   它属 §9 第 1 条同一族，只能测量与登记；要彻底消灭它需要 document-start 主题通道（§3.1 的代价），不在
   倾向侧范围内。

## 10. 视觉保真

本 change **无原型**，按 `docs/process/openspec-workflow.md` 的「有原型时必填」口径，本节在提案阶段不适用。
若 D1 裁品牌仪式（需要定稿的品牌面），实现前必须补原型截图并在此逐屏填写（布局节奏 / 卡片或字标样式 /
字层级 / 各状态样式），否则视觉层会落进无人负责的真空。

## 11. 实现注记（M645 落地）

本节回填实现期定下的落点与实测读数；§§1–10 的裁决与设计依据不改。

### 11.1 落点

| 文件 | 职责 |
|---|---|
| `src/boot.ts` | 启动层：`Promise.all([configGet, getName])`（两端各 `catch` 成 null）→ 交接配置 → 只写 `<html data-theme>` → 挂启动面 → 双 rAF（200ms 上界）→ `await import("./main")`；异常统一 `degrade()` |
| `src/startup-surface.ts` / `src/startup-surface.css` | 启动面的 DOM 与样式；`#startup` 挂 `document.body`（`#app` 之外）；`dismiss` 幂等、单帧 `remove()`；两条读数在此落盘 |
| `src/startup-gate.ts` | 撤下判据纯函数与安全阀常量（`STARTUP_TIMEOUT_MS = 10_000`），单测 `tests/unit/startup-gate.test.ts` |
| `src/config-handoff.ts` | 启动层 → 主模块的一次性配置快照交接 |
| `src/main.ts` | 两个撤下信号（`applyVault` 的 `tree.setVault` 之后、`refreshVaultStatus` 的未打开终态分支）、阶段行、启动态入口的接线、安全阀撤下后的既有恢复中态 |
| `src-tauri/src/logging.rs` | `startup_surface` 事件与四个允许字段（`phase` / `reason` / `ms` / `ts_unix_ms`） |

### 11.2 两处实现期收窄（按 spec 原意，未改契约）

1. **阶段行不是首帧的一部分。** spec「不读 vault」禁止启动层在首帧之前读 `vault_current`，而「恢复进行中」
   只有主模块能判（`refreshVaultStatus`）。因此首帧 = 骨架 + 产品标记；阶段行由主模块判到 `restore_pending`
   时经 `setPhase(t("D95"))` 施加，先于树出现。代价：无 `last_vault` 的启动里首帧也短暂只有标记（随后按
   `no_vault` 撤下）。
2. **`nextPaint` 带上界。** §3.4 的「双 rAF 只是尽力」落成「双 rAF 与 200ms 定时器取先到者」：窗口不可见时
   WebKit 可能不派发渲染帧（§3.6），没有上界等于让主模块装载押在一次可能不来的回调上。上界只保证不卡死，
   不改变「先画后载」的意图。

### 11.3 async IIFE 与 TLA（tasks 1.1）

本机（macOS 26.6.2，`WebKit.framework` 版本 21624）的 WKWebView 支持 top-level await；但产品最低支持系统
10.15 的 WKWebView 是 Safari 13 级、TLA 要 Safari 15。结论：**不用 TLA**，用 async IIFE（语义等价，不押用户
系统版本）。结论写在 `src/boot.ts` 文件头。

### 11.4 实测读数（本机，2026-10-23）

- **`phase=first_frame` 的语义**：`ms` 是「启动层交出渲染机会」的时刻（双 rAF 或 200ms 上界先到者），不是
  绘制完成时刻。
- **「上屏 → 启动层首帧」**（release 构建、隔离的空配置、warm-up 1 次后 n=10；`LUMIR_READY.ts_unix_ms` 与
  `first_frame.ts_unix_ms` 相减）：241 / 241 / 243 / 247 / 251 / 255 / 257 / 257 / 261 / 264 ms，**中位
  ≈ 253ms**；其中页面自身（`first_frame.ms`）≈ 112–126ms，其余（≈ 135ms）是 `LUMIR_READY` → 页面导航
  开始的那一段（§9 第 1 条的已知边界，本 change 只测量不消除）。dev flavour 下同一间隔被 vite 模块图拉长到
  ≈ 690–770ms（验收场景 225 的两次冷启读数），**dev 数字不可与产品口径混用**。
- **冷启动主口径**（spawn → `LUMIR_READY`，release，两枚只差 `logging.rs` 一个枚举值的构建；5 轮交错、每轮
  n=20）：单轮中位增量 −31…+36ms（量级已超 10ms 判据——那是机器噪声，见下），中位-中位 **−8.1ms**（改动前
  246.7ms / 改动后 238.6ms）→ 满足 ≤10ms 判据。结构上该端点由 Rust setup 发射、早于本 change 的任何前端
  代码；Rust 侧唯一改动是诊断白名单的事件枚举值（启动路径不引用），因此读数按「没拖慢」采信。

### 11.5 视觉层判据的边界（反向验证记录）

删掉 `applyVault` 里的 `startup?.notifyTreeReady()` 后实测：`startup-restore.spec.ts` 的第 3 / 4 条在 5s
内判红（判别力成立）；**但 app-main 等既有截图场景仍全绿、每条多耗 10s**——交互类场景的点击会重试到安全阀
（10s）把启动面撤下之后再成功，覆盖层不进截图。因此「撤下信号有没有接上」的判别性判据只落在
`startup-restore.spec.ts`（树就绪后 5s 内断言 `#startup` 计数为 0），`expect-screenshot.ts` 的撤下门只作
第二道防线（防「启动面永不撤下」）。这条边界同时写在两处代码注释与 `scripts/acceptance/README.md` 的
「已知边界」。

**两段式启动作废了两条视觉场景的旧就绪代理**（同一批反向验证的副产物）：`page.goto("/")` 不再等于
「壳 / 编辑器已建出」（主模块在配置到手后才装载），`config_get` 的调用计数也不再等于「配置已施加」
（那次读取由启动层在**装载主模块之前**发起）。首轮全量视觉门禁因此红了 4 条（lists / m293 的 dark 与
eink / mv-vault-switcher）：两条是 `goto` 后裸 `evaluate` 拿到 `null`，两条是抢在键位覆盖之前按 ⌘⇧T。
处置：受影响场景改等界面信号（`.cm-content` / `.ft-vault` / `configApplied()`），`configGets` helper 与
`__configGets` 计数器删除（「调用过」与「已施加」不再同一件事，留一个没有消费者的代理只会让下一个人
再踩一次）；口径写进 `tests/visual/README.md` 的「启动是两段式的」条。第二次全量门禁结果见 tasks 5.6。
