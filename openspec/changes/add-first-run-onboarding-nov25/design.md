# Design: add-first-run-onboarding-nov25

## 1. 术语与表面层级

本 change 不新增启动面。既有启动态 `#startup` 有两种模式：

| 模式 | 时机 | 承载 | 内容 | 是否 pane |
|---|---|---|---|---|
| 恢复模式（既有） | 首个内容帧 → 树就绪 / 未打开终态 / 安全阀 | `#startup`（`document.body` 下的独立兄弟节点） | 骨架 + 产品标记 + 阶段行 + D6 入口 | 否 |
| **首启模式（新）** | 真正首次启动且无 vault | 同一个 `#startup` | 只有「添加 vault」主操作，整窗居中 | 否；**不是 content pane，也不是 harness pane** |

首启模式撤销之前，工作区尚未进入：shell 的 titlebar / tree / editor / modeline 全部 `inert`，
对辅助技术隐藏；用户可做的只有「添加 vault」。vault 打开、树就绪后，`#startup` 单帧移除，工作区
才出现 content pane 与 harness pane。tips 是工作区 content pane 内部的一个引导面，不是新 pane。

关键边界：**不新增第二个启动面 / 首启屏模块，也不新增第二个「添加 vault」按钮**。首启模式复用
既有启动态的唯一入口（同一 `requestAddVault` 命令、同一 dirty 守卫路径），只改布局、内容、文案
与撤下规则。这是 Alex 原话「现有启动屏只有唯一主操作，重点修居中与纯启动屏层级，不额外加按钮」
的直接兑现。

## 2. 现状证据与失效点

### 2.1 启动态只有一个主操作，但不是整窗居中

- `src/boot.ts:50` 首帧前读一次 `config_get`，`:56` 经 `src/config-handoff.ts` 交给主模块，
  `:63` 挂载 `#startup`，`:67` 才 `await import("./main")`。
- `src/startup-surface.ts:61` 建 `#startup`；`:79` 建骨架侧栏；`:90` 建内容列；`:102-107` 建唯一
  的 D6「打开 vault」按钮。
- CSS `src/startup-surface.css:32` 的 `.startup-body` 是两列（`--layout-sidebar-w` + 内容列），
  `.startup-content`（`:76`）在**内容列**里 flex 居中。因此按钮中心是「侧栏右侧内容列的中心」，
  不是整窗中心；左栏还有骨架行。
- `src/startup-gate.ts` 的 `startupDismissReason` 是四选一：`degraded` / `tree_ready` /
  `no_vault` / `timeout`。非首启的未打开终态会在 `src/main.ts:4585` 撤下启动面并调
  `tree.showEmpty()`（`src/tree.ts:1526`），这就是「左上角 + 中央空白」的来源。

### 2.2 空 vault 首入态的覆盖层

- `src/main.ts:1724` `showEmptyVaultState()` 调 `renderNotice(t("D107"), { label: t("D882"),
  run: () => tree.beginCreate("", "file") })`。
- `renderNotice`（`src/main.ts:1695`）把 `.editor-notice` 挂到 `shell.editorRow`
  （`src/main.ts:1689`）；CSS `src/style.css:1406` 起是 `position:absolute; inset:0` +
  不透明 `--content-bg`。它覆盖整条 pane 行，包括 harness pane。
- 因此**不能**复用它来放 tips：一旦默认展开 harness，tips 会把 harness 一起盖住。

### 2.3 空 pane 引导与 tips 抢同一块面

- `src/main.ts:650` `renderAllTabStrips` 是空 pane 引导显隐的唯一写点：
  `assembly.guideEl!.hidden = !emptyPaneGuideVisible(...)`（`src/main.ts:678`）。
- 判据在 `src/pane-layout.ts:103`：分栏 + 无带路径标签 + 前台非 dirty 草稿 + 已装载 vault。
  首启 tips 正是「分栏 + 无标签」，D369（`src/copy-data.ts:847`）会同时点亮。
- 必须让 tips 与 D369 共用同一个门，不能各判一次。

### 2.4 harness 默认展开的既有语义

- `openHarnessPane(focusComposer = true)`（`src/main.ts:890`）做三件事：`split("harness")`、
  面板 `attachTo`、`syncActiveDocument()`，最后 `switcher.sessionChanged()`（`src/main.ts:902`）
  按 debounce 写 `vault-sessions/<id>.json` 的 `harness_pane` 位。
- 它**不**建 harness 会话、不写 JSONL、不发 preflight。无会话时 `harness_state` 返回
  `StateSnapshot::empty`（`src-tauri/src/harness.rs:593`）；`send_preflight` 只在
  `harness_send` / `harness_cron_run` 两条路径（`src-tauri/src/harness.rs:1787`、`:2046`）。
- 面板挂载后 `harnessPanel.vaultChanged()` 会拉一次 `harness_state`，这是装载 vault 本来就发生
  的只读快照，不是新会话。

## 3. 首启判定

### 3.1 唯一判据

`firstRun = config.last_vault === null`，在启动时取一次快照，之后只读。

- 不把注册表是否为空并进判据：多一次 `vault_list` IPC，且慢挂载卷上不是零成本；`last_vault`
  已经是「这台机器上是否已经进入过工作区」的既有真源。
- 判定必须在任何 vault 装载之前完成。用户打开首个 vault 时后端立刻写 `last_vault`，任何
  「延迟到 `onEmptyVault` 再读 config」的写法都会把自己判成老用户。
- 判定此后**不因写注册表 / 写 `last_vault` / 切换 vault 而复算**。

### 3.2 读取与交接（实现约束）

`src/boot.ts:50` 已经在首帧前拿到配置快照。不要在主模块里再读一次 config，也不要依赖 Promise
微任务顺序：

- `src/boot.ts` 在 `mountStartupSurface` 之前算 `const firstRun = snapshot !== null &&
  snapshot.config.last_vault === null;`，把 `firstRun` 作为 `StartupSurfaceOptions` 的字段传给
  启动面。
- `src/startup-surface.ts` 把 `firstRun` 与 `visible`（`dismissed === null`）存在句柄上（只读
  字段），并在 `#startup` 上加 `startup-first-run` class。
- `src/main.ts` 在启动恢复块之前读 `const firstRunPending = startupSurface()?.firstRun === true;`。
  启动面由 `boot` 在 `await import("./main")` 之前挂载，因此这里同步可取；启动面不存在（降级 /
  非产品路径）时按非首启处理。判断「是否仍在场」用 `startupSurface()?.visible === true`，不用
  `firstRun` 单独判——句柄在撤下后仍存在，`firstRun` 仍为真。
- 同一份配置只读一次；不需要新增 `config-handoff` 的 peek API，也不新增 IPC。

### 3.3 生命周期

- `firstRunPending`：启动快照，只读。
- `firstRunTipsPending` / `firstRunTipsConsumed`：本次启动内的一次性状态；不落盘。
- 打开首个 vault 后，`firstRunPending` 仍为真（不因 `last_vault` 写回而变），所以本次启动内
  仍可按首启规则处理首个空 vault 的 tips / harness。
- tips 在首个 vault 装载完成时被消费：若恢复出标签，tips 不出现且不补到后续空态；若无标签，
  tips 出现一次，打开首个文档即消失，本会话不再出现。
- 首启模式只出现一次：树就绪即移除；用户取消目录选择器或打开失败时保持在场，可重试。

### 3.4 已知误判面

- 手删 `config.json` 但注册表 / 会话还在的老用户会被判成首启：会看到一次首启模式与 tips，无持久化
  后果；下一次启动 `last_vault` 已写回，不再出现。
- 首启打开 vault 后没读任何文档就退出：下次启动 `last_vault` 非空，按老用户空 vault 处理
  （D107 + 新建笔记），tips 不再出现。这是「不新增持久化字段」的固有边界。
- 配置读取失败：`snapshot === null` ⇒ `firstRun = false`，走既有未打开 / 错误空态；不把读失败
  伪装成首启（REVIEW.md『读不到当成空』条）。

## 4. 启动态首启模式

### 4.1 形态

`src/startup-surface.ts` 增加首启模式分支，`src/startup-surface.css` 增加
`.startup-first-run` 组：

- **不建骨架侧栏**：首启模式不建 `.startup-sidebar` / `.startup-row`；只有内容层。
- **不建产品标记**：首启模式不建 `.startup-mark`；窗口标题 / macOS 系统 chrome 承担身份。
- **不建阶段行**：首启模式没有「正在恢复上次打开的 vault」这件事可说；`setPhase` 在首启模式
  是空操作，`notifyNoVault` 也是空操作。
- **只有唯一按钮**：复用既有 `.ft-open-btn startup-open` 形态，文案取首启模式的新文案
  「添加 vault」；非首启仍是 D6「打开 vault」。
- **整窗居中**：`#startup` 已是 `position:fixed; inset:0`。首启模式把 `.startup-content` 设为
  `position:absolute; inset:0; display:flex; align-items:center; justify-content:center;`，
  按钮中心 = viewport 中心。不是「内容列居中」，也不是「侧栏旁边居中」。
- **可拖动**：`.startup-titlebar` 保留 `data-tauri-drag-region="deep"`，首启模式下绝对定位到
  顶部、高度取 `--layout-titlebar-h`、背景透明、z-index 高于内容层；容器 MUST NOT 挂
  `mousedown` + `preventDefault`（REVIEW.md『标题栏 mousedown preventDefault 打断拖拽』条）。
- **无动画 / 无过渡**：与既有启动态同口径，单帧挂载 / 移除。
- **三主题**：所有颜色取既有 token（`--content-bg` / `--text` / `--border` / `--hover`），
  按钮复用 `.ft-open-btn` 的既有主题适配。

### 4.2 撤下规则

`src/startup-gate.ts` 的 `startupDismissReason` 保持不变（它是非首启的闭集合）。首启模式在
`startup-surface.ts` 的 `evaluate` 里先分流：

```ts
if (firstRunMode && !state.treeReady && !state.degraded) return; // 首启不因 no_vault / timeout 撤下
const reason = startupDismissReason({ ...state, elapsedMs: ... });
```

- 首启模式**不设安全阀定时器**：首启没有恢复线程，唯一入口始终可用；超时撤下只会把用户丢回
  「左上角 + 中央空白」的既有空态，违背需求。`timer` 变量允许 `undefined`，`dismiss` 清定时器
  前判空。
- `notifyNoVault()` 在首启模式只记录（或不记录）但不触发撤下；主模块仍可调用，保持调用点统一。
- 唯一撤下：`treeReady`（首个 vault 树就绪）或 `degraded`（启动层 / 主模块失败）。
- 撤下是单帧 `root.remove()`；`dismissed` 幂等；诊断读数照旧落 `startup_surface`，首启模式的
  reason 只可能是 `tree_ready` / `degraded`。

### 4.3 主模块接线

- `src/main.ts` 启动块：`const startup = startupSurface(); const firstRunPending =
  startup?.firstRun === true;`。
- `refreshVaultStatus` 的未打开终态分支：

  ```ts
  if (status.restore_pending) {
    startup?.setPhase(RESTORING_NOTICE());
  } else {
    startup?.notifyNoVault();
    if (!firstRunPending) tree.showEmpty(status.notice);
    // 首启：启动面首启模式仍在场，不铺树空态
  }
  ```

- `refreshVaultStatus().catch`：首启模式读失败时先 `startup?.degrade()` 让路，再走既有
  `tree.showEmpty(errorMessage(e))`。错误必须可见，不能被启动面盖住；这是降级路径，不是首启
  终态。
- `startup?.onDismiss` 的回调同时承担两件事：恢复工作区可交互；非首启 `timeout` 时补 D95 恢复
  中态。首启模式不会走 `timeout`，但仍需恢复 inert。
- `applyVault` 的 `startup?.notifyTreeReady()` 是首启模式的撤下信号；随后 `showEditor()` /
  `onEmptyVault` 接管工作区。
- `startup?.setOpenHandler(() => requestAddVault())` 保持既有接线；首启模式的「添加 vault」与
  非首启的 D6 共用同一条命令、同一条 dirty 守卫路径。

### 4.4 工作区隔离

首启模式在场期间工作区尚未进入：

- shell 建出后，若 `firstRunPending && startup?.visible`，设 `shell.root.inert = true` 与
  `aria-hidden="true"`；首启模式撤下时在 `onDismiss` 回调里恢复。
- 启动面在 `document.body` 下、shell 之外，`inert` 不影响它；它的唯一按钮仍可点。
- 不在首启模式挂载时抢焦点：既有启动态「MUST NOT 抢键盘焦点」条款不变；按钮是屏上唯一可聚焦
  元素，用户点击 / Tab 即可到达。首启模式撤下时不抢焦点，工作区装载路径自己决定焦点。
- 不注册新键位、不拦截不属于启动面的输入事件；shell inert 期间工作区快捷键不会穿透。

### 4.5 不是 pane / 不是新表面

首启模式 MUST NOT 挂进 `shell.editorPane` / `.editor-pane` / `.pane-editor` / pane 容器；它不参与
`paneLayout`、不占标签槽、不写 `vault-sessions`。它也没有新增模块 / 新增按钮：DOM 仍是 `#startup`，
入口仍是那个 `startup-open` 按钮，只是 class、文案与布局按模式分叉。测试断言：

- `#startup.startup-first-run` 存在；
- `.startup-sidebar` / `.startup-mark` / `.startup-phase` 计数为 0；
- `#startup` 不在任何 `.editor-pane` / `.pane-editor` 内；
- `vault-sessions` 不因首启模式发生写入。

## 5. 首启工作区 tips

### 5.1 落点

新增 `src/first-run-tips.ts`，纯 DOM 构建（只吃 `t()`，零 `innerHTML`）。tips 元素挂进
`shell.editorPane`（root doc pane 的挂载元素，`.editor-pane` 已是 `position: relative`），
**不挂** `shell.editorRow` 的 `.editor-notice`：

- `position: absolute; inset: 0` 只覆盖 root doc pane；
- harness pane 是 `editorRow` 里 root pane 的兄弟，tips 不会盖住它；
- 不新增 `overflow` 容器（避免动 `tests/unit/scrollbar-registry.test.ts` 的分档登记）；
- 背景取 `--content-bg` 不透明；不 `display:none` 编辑器 DOM（那会让 CM 在恢复时重新测量），
  而是用覆盖层 + 结构性只读。

### 5.2 显示与撤下

单一入口 `onEmptyVault` 的首启分支：

```ts
if (firstRunTipsPending && !firstRunTipsConsumed) {
  showFirstRunTips();       // 建 DOM、置 flag、隐藏 widthDrag、登记 relabel
  openHarnessPane(false);   // 默认展开 harness，不抢焦点
  renderAllTabStrips();     // 让 guideEl 的门读到最后状态
} else {
  showEmptyVaultState();    // 老用户空 vault：D107 + D882 原样
}
```

- 顺序有意：先置 `firstRunTipsVisible`，再 `openHarnessPane(false)`，让 `openHarnessPane` 内部的
  `syncActiveDocument()` → `renderAllTabStrips()` 已经看到 tips 门，不会先点亮 D369 再撤下。
  末尾再 `renderAllTabStrips()` 一次，幂等收口。
- `showEditor()`（`src/main.ts:1729`）统一撤下：若 tips 在场，移除 DOM、清 flag、恢复可编辑与
  `widthDrag`，并重跑一次 `renderAllTabStrips()`；不在每次打开文档时都重跑（条件早退）。
- 首个文档打开 / 标签出现即消失；本会话不再出现。首个 vault 恢复出标签时 `onEmptyVault` 不会
  被调用，tips 不出现，也不补到后续空态（首个 vault 装载完成即消费）。
- 语言切换：`relabelNotice = showFirstRunTips`，复用既有 `onRelabel` 重绘路径。

### 5.3 D369 并列门

`renderAllTabStrips` 是唯一写点，新增一个模块级 `firstRunTipsVisible`：

```ts
assembly.guideEl!.hidden =
  !emptyPaneGuideVisible(split, hasTabs, foreground.dirty, vaultLoaded) || firstRunTipsVisible;
```

- 只有这一处读 flag；别处不另埋钩子。
- tips 撤下后重跑一次，D369 按既有判据恢复（若仍满足分栏 + 无标签 + 非 dirty）。
- 单测覆盖两个方向：tips 在场 → guide hidden；tips 撤离 → 按判据重新可见。

### 5.4 输入闸门

tips 在场时，空白草稿 MUST NOT 接受文本输入：

- `renderAllTabStrips` 的 `editor.setSessionEditable(...)` 追加 `&& !firstRunTipsVisible`，
  与 D369 共用同一 flag；
- 这是结构性只读（编辑器可编辑性本身拒收），不是 DOM 层吞键；
- 打开任一文档后 `hasTabs` 为真，`showEditor()` 清 flag，`renderAllTabStrips` 恢复可编辑；
- 不在 tips 里做「首键撤下」——见 proposal 节点 1 的唯一行为分叉。

### 5.5 tips 内容

9 条，分三组呈现（导航 / 写作与对话 / 创建）：

| 行 | 键位 / 手势 | 文案（zh / en 草案） | 真源 |
|---|---|---|---|
| 1 | `⌘P` | 快速打开文件 / Quick open a file | `src/keys.ts:777` `app.quick-open` |
| 2 | `⌘F` | 文件内查找 / Find in the current file | `src/keys.ts:773` `app.search-open` |
| 3 | `⌘⇧O` | 大纲 / Outline | `src/keys.ts:778` `toc.toggle` |
| 4 | `⌘O` | 切换或新增 vault / Switch or add a vault | `src/keys.ts:779` `vault.switcher` |
| 5 | `⌘⇧A` | 打开或收起对话 / Open or hide the chat pane | `src/keys.ts:835` `harness.toggle` |
| 6 | `⌘,` | 设置 / Settings | `src/keys.ts:783` `app.settings-open` |
| 7 | `[[` | 插入双链 / Insert a wikilink | `src/link-suggest.ts`；change `add-wikilink-suggestion-nov24` |
| 8 | 选中文本 → 浮动钮 | 摘录到对话 / Quote to chat | `src/quote-gesture.ts`；D370 |
| 9 | 右键左栏 vault 名 | 新建笔记 / New note | `file-tree`「vault 根的新建入口」；`src/tree-menu.ts` |

脚注：`⌘/` 查看全部键位（默认键位） / Press `⌘/` to see all shortcuts (defaults)。
`⌘/` 的真源是 `src/keys.ts:772` `app.describe-bindings`。

- **不硬编码键位字符串**：1–6 行的 keycap 从 `src/keys.ts` 的 `KEY_BINDINGS`（`:634`）按 command
  id 取默认绑定，不写 `"⌘P"` 字面量。默认键位改了，tips 跟着表走；单测对账「每条 key 行都能在
  默认表里找到对应 command」。
- `[[` 与「选中文本」是触发形态，不是键位；第 9 行是菜单路径。三者按文本 token 渲染，不冒充
  快捷键。
- 文案注「默认键位」：`[keys]` 可重绑，tips 展示的是出厂默认，`⌘/` 是唯一不会随重绑失真的出口
  （与 D369 的已知明账同族）。
- 不在 tips 里放「知道了」「关闭」按钮；打开文档或 tips 被工作区状态取代即消失。

## 6. 默认 harness

### 6.1 行为

首启空 vault 的 `onEmptyVault` 调 `openHarnessPane(false)`：

- `focusComposer = false`：不抢焦点；与 cron 结果通知 / 恢复路径的既有口径同源。
- 无第二 doc pane 时按 1:1 分栏（`HARNESS_DEFAULT_DOC_RATIO = 1/2`，`src/main.ts:790`；
  canonical 定义在 `openspec/specs/pane-layout/spec.md` 的「harness pane」）。
- 已有第二 doc pane 时按既有 `openHarnessPane` 语义收拢标签；首启空 vault 通常没有。
- 已恢复 `harness_pane: true` 时 `openHarnessPane` 早退，幂等。

### 6.2 副作用边界

- **不建空会话 / JSONL**：面板 `attachTo` 只建 DOM；`harness_state` 无会话时返回空快照；
  JSONL 在首次真实 `llm_request` 才发布（归档 change `reshape-harness-session-recording` 口径）。
- **不发 preflight**：`send_preflight` 只在 `harness_send` / `harness_cron_run`；默认展开不经过。
- **允许落盘**：`openHarnessPane` 末尾 `switcher.sessionChanged()` 会把 `harness_pane: true`
  写进既有 `vault-sessions/<id>.json`。这是既有按 vault 持久化布局的一部分，不新增字段；
  用户收起 harness 后写 false，下次启动不再自动展开。
- **不新增第二条开合通道**：`openHarnessPane` 是 `harness.toggle` 已经在用的同一实现；首启只是
  在装载后的初始布局里调用一次。`pane-layout` delta 显式把它写成「harness.toggle 承担打开」的
  唯一例外，且只发生一次、不是用户可触发的命令。

## 7. 文案

### 7.1 新增条目

实现时按 `文案-Copy.md` 当前末位连续取号（**起草时末位 D1028**；实现前再核一次，防止并行
change 占号），中英双列必填：

- 首启模式按钮：`添加 vault` / `Add vault`。
- tips 标题：`开始使用` / `Get started`（若视觉上需要；不需要则省略，不占号）。
- 9 条 tips 的标签（见 §5.5）。
- 脚注：`默认键位 · ⌘/ 查看全部` / `Defaults · press ⌘/ for all shortcuts`。
- tips 区域读屏名（`role="region"` 的 `aria-label`）：`首次使用提示` / `Getting started tips`。

约 12 条。`src/copy-data.ts` 与 `文案-Copy.md` 同批追加；`tests/unit/copy.test.ts` 双向对账，
`src/**` 除文案表外零 CJK 字面量。

### 7.2 文案口径

- 首启模式按钮用「添加 vault」而不是 D6「打开 vault」：无 vault 时动作是添加；非首启启动态与
  老用户树空态仍用 D6，不改全局文案。
- 启动面模块按 `firstRun` 选择文案键；`onRelabel` 用同一分支重写，模式在挂载时固定，不运行期翻转。
- tips 的键位描述一律「默认键位」，不承诺用户重绑后的当前键位；`⌘/` 是完整出口。
- 第 9 条「右键左栏 vault 名 → 新建笔记」是首启空态去掉 D882 按钮后的可发现创建路径；它引用
  `file-tree` 既有根级菜单，不新增创建命令。
- 不在 tips 里写「config.json」「provider」这类实现词；它面向首次使用者，不是设置向导。

## 8. 视觉口径

### 8.1 启动态首启模式

- 布局：`.startup-content` 在 `#startup` 内绝对定位 `inset:0`，flex 水平 / 垂直居中；按钮中心与
  `window.innerWidth / 2`、`window.innerHeight / 2` 的偏差 ≤1 CSS px（取整后）。不接受「内容列
  居中」或「左上角按钮 + 中央空白」。
- 按钮：复用 `.ft-open-btn` 的既有形态（`--content-bg` 底、`--border` 边、`--r8` 圆角、
  `--fs-ui` 字号、`--fw-emphasis` 字重）；不新增第二种按钮样式。
- 背景：`--content-bg`；无骨架、无产品标记、无阶段行。
- 顶部拖拽带：高度 `--layout-titlebar-h`，背景透明，z-index 高于内容层；不画可见色带。
- 三主题同构；eink 下按钮描边按 `.ft-open-btn` 既有 1.4px 规则，不另写。
- 零 `animation` / `transition`；撤下是单帧移除。

### 8.2 tips

- 容器：root doc pane 内 `inset:0`，`display:flex; flex-direction:column; align-items:center;
  justify-content:center;`，`padding: var(--sp-9)`；不引入 `overflow`。
- 宽度：`max-width: min(var(--layout-doc-measure), 100%)`；行内 keycap + 标签用
  `display:grid; grid-template-columns: auto 1fr; gap: var(--sp-4)`。
- 字层级：标题 `--fs-ui` + `--fw-emphasis`；行 `--fs-ui` / `--lh-ui`；脚注 `--fs-meta` /
  `--text-3`。
- keycap：`--font-mono`、`--fs-meta`、`--hover` 底、1px `--border`、`--r4`；不新增色值。
- 分组：三组之间用 `--sp-6` 间距，组内 `--sp-2`；不画卡片、不画阴影。
- 三主题同构；eink 下边框走既有 token。
- 窗口很矮时 tips 允许被 pane 裁切（不做滚动容器，避免新增滚动面归档）；这是已知边界，正常
  窗口高度下 9 行 + 标题 + 脚注约 300px，远小于 content pane 高度。

### 8.3 视觉保真

本 change 没有独立 HTML 原型，不做逐像素原型对照。视觉判据落在：

- 首启模式按钮中心与窗口中心的几何断言（机器可判）；
- tips 与 harness 的并排结构断言（tips 只覆盖 root doc pane，harness 可见）；
- 三主题截图 + Alex 过目（基线更新的人肉裁决点）。

## 9. 测试与验收

### 9.1 单元测试

- 首启谓词：`last_vault === null` → true；字符串 / 读失败 → false；写回后不复算。
- 启动面首启模式：`firstRun` 为真时不建侧栏 / 产品标记 / 阶段行；`no_vault` 与超时不撤下；
  `tree_ready` / `degraded` 撤下。
- tips 键位对账：1–6 行的 keycap 由 `KEY_BINDINGS` 派生；每条 command id 都在默认表里有绑定；
  不出现硬编码的 `⌘` 字面量（AST / 字符串扫描）。
- D369 并列门：`firstRunTipsVisible` 为真时 guide 必隐；为假时按 `emptyPaneGuideVisible`。
- 输入闸门：tips 在场时 `setSessionEditable` 为 false；打开文档后恢复。
- 文案：新增 key 在 deck 与 `copy-data.ts` 双向存在；zh / en 均非空。

### 9.2 视觉测试与桩

`tests/visual/scenes/tauri-stub.ts` 当前 `config_get` 恒写 `last_vault: null`
（`tests/visual/scenes/tauri-stub.ts:589`）。本 change 必须先修桩，否则所有带 fixture 的视觉
场景、以及 `m645-startup-surface` 的恢复态都会落入首启模式：

- `VaultFixture` / `stubTauri` 支持 `lastVault`（含无 fixture 的非首启空态，例如
  `stubTauri(page, null, { lastVault: "/mock/missing-vault" })`）；缺省：有 fixture 时取
  `current.root`（老用户），`stubTauri(page, null)` 仍为 `null`（真首启）。
- 审计所有 `stubTauri(page, null)` 场景：`app-main`、`toc-outline`、`quick-open`、
  `m293-eink-literal-tokens`、`m149-tabs`、`first-run-empty-state`、`startup-restore`、
  `m831-harness-composer-codemirror`。它们若要旧的无 vault 工作区，必须显式给非 null 的
  `lastVault`（失效路径），否则会被首启模式覆盖。
- `m645-startup-surface` 的 `RESTORING` 场景要显式给非 null `lastVault`（例如
  `/mock/restoring-vault`），保持既有骨架 / 产品标记 / 阶段行断言。
- 更新 `tests/visual/scenes/first-run-empty-state.spec.ts`：
  - 第一段（真首启）改为断言 `#startup.startup-first-run`、只有「添加 vault」按钮、按钮中心 =
    窗口中心、无侧栏 / 产品标记 / 阶段行；
  - 第二段拆成「老用户空 vault」（`lastVault: root`）→ D107 + New note 原样；
    「首启空 vault」（`lastVault: null` + fixture vault）→ tips + harness + 无 D107 / New note。
- 新增首启模式 / tips 的结构与几何用例；若纳入像素基线，三主题各一张，同样走人肉裁决。
- `app-main.spec.ts` 第一条若要保留旧空态基线，改为非首启的失效 `lastVault`；真首启另立用例与
  基线。

### 9.3 真机验收

**场景号**：现场查 `scripts/acceptance/COVERAGE.md` 末位 876，下一个空号为 **877**；
876 已被 `876-harness-web-production-no-injection` 占用，不得照抄调研里的 876。

**原生目录选择器缺口**：套件不驱动 rfd 的 `NSOpenPanel`（README 已知边界）。首启模式的
「添加 vault」按钮只判可见可达；「用户选中首个 vault」的终态需要一条**仅验收环境生效**的
`vaultOpenPath` 动作（dev server 注入 / 既有验收隔离通道，production 不暴露）。该动作调用与
原生选择器相同的 `vault_open_path`，只用于把「选中目录」这一步表达成可断言终态；它不是产品
行为，也不改变 `firstRunPending`（启动快照已经取过）。若 Alex 不接受这条测试通道，877 的
tips / 默认 harness 段退回视觉结构断言 + Alex 手工人肉一步，并在证据里如实登记缺口。

**877 建议步骤**：

1. 预置 registry（空 vault 或带一个未打开文件的 vault）；`envWrite` 一份不含 `last_vault` 的
   最小 config；`restart` 进入首启模式。
2. 断言：`#startup` / 「添加 vault」按钮可见；AX 里没有 D5「打开一个目录作为 vault」、没有
   `.startup-sidebar` / `.startup-mark` / `.startup-phase`；截图。
3. `vaultOpenPath` 打开预置 vault（等价于用户在原生选择器里选中它）。
4. 断言：`#startup` 已撤下；tips 可见（标题 / 9 条中的关键行 / 脚注）；harness pane 在场
   （1:1）；D107 / New note / D369 都不在 AX；截图。
5. 等 `vault-sessions/<id>.json` 防抖落盘：`harness_pane: true`；断言
   `harness/sessions/<vaultId>/` 下没有新增 JSONL（`file` 负向 / `count: 0`）。
6. 点击树里的文件打开：tips 消失、编辑器可编辑、文件正文可见。
7. 老用户回归：`configWrite lastVault: <vault>` + `restart` → D107 + New note 在场，tips 与
   默认 harness 都不出现（与 263 的第二段同口径）。

**263 更新**：第一段（无 `last_vault` 的空配置）从「左栏 D5 + D6」改为「启动态首启模式 + 添加
vault」；第二段（`configWrite lastVault` 后重启）保留 D107 + New note，作为老用户回归。263 的
截图基线随更新重截。

### 9.4 门禁

- `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`
- `bash scripts/docs-check.sh`
- `bash scripts/gate.sh quick`
- 动过视觉代码 / 场景后本地 `bash scripts/gate.sh visual`（CI 只跑结构层，像素层归本地）。
- 真机：`node scripts/acceptance/run.mjs 877 263`；证据落 `.local/acceptance/<日期>/`，不落
  worktree（合并后会被清理）。
- 视觉基线 `--update` 前截图交 Alex 过目；基线属人肉裁决点，不机械执行。

## 10. 风险与已知边界

1. **M851 的作用域**：本 change 只替换「真正首次启动」的首入态；非首启空 vault 的 D107 +
   D882 原样保留。不是全局删除「新建笔记」，也不是反转 M851 对老用户的入口。
2. **启动面语义扩展**：首启模式让启动面在 `no_vault` / 超时后继续在场。它仍只在 `#startup`
   这一个承载点，不新增状态机；`startup-gate` 的非首启判据逐字不变，首启分流在
   `startup-surface` 内。风险是「启动面长期在场」与既有「首个内容帧」语义混淆——spec 的
   MODIFIED 与首启模式 class / 测试把它说清。
3. **首启判定的一次性**：首启打开 vault 后未读文档就退出，下次按老用户空 vault 处理；无持久化
   方案下 tips 不再出现。这是 Alex 已定的「不新增持久化引导字段」的代价。
4. **配置删除误判**：手删 `config.json` 但注册表还在的老用户会看到一次首启模式 / tips；无持久化
   后果。
5. **配置读取失败**：`snapshot === null` ⇒ 非首启；`vaultCurrent` 读失败 ⇒ 首启模式 `degrade()`，
   走既有错误空态，不把读失败伪装成首启。
6. **D369 抢面**：已用单一 flag 解决；若实现里另埋第二个写入点，会回到两处真源，单测必须覆盖。
7. **覆盖层盖 harness**：tips 挂 `editorPane`，不挂 `editorRow`；实现时 `rg` 确认没有复用
   `.editor-notice`。
8. **空白草稿输入**：tips 在场时结构性只读；若不做，键入会落进被遮住的草稿。这是节点 1 的
   唯一行为分叉。
9. **键位漂移**：keycap 从 `KEY_BINDINGS` 派生，脚注注「默认键位」，`⌘/` 兜底；不在 tips 里
   写死 `"⌘P"` 字面量。
10. **视觉基线**：`app-main` / 首启模式 / tips 会变或新增；基线更新须 Alex 过目。
11. **视觉桩误判面**：`config_get` 恒 `last_vault: null` 会让所有 fixture 场景和 m645 恢复态
    落入首启模式；必须先修桩并审计全部 `stubTauri(page, null)` 场景。
12. **验收选择器缺口**：原生 `NSOpenPanel` 不驱动；`vaultOpenPath` 是验收通道，不是产品能力。
    若不做，877 的 tips 段只能人工验，证据里必须如实写「未自动化」。
13. **shell inert 与 toast**：首启模式期间工作区 inert；打开失败的 toast 可能在 inert 子树内。
    首启模式保持在场可重试，错误仍按既有路径尝试上屏；若视觉上被遮，按已知边界登记，不为此
    新增第二条错误通道。
14. **矮窗**：tips 不做滚动容器，极矮窗口可能裁切；正常窗口高度下不触发。若后续要支持矮窗，
    另立 overflow 归档 change，不在本 change 夹带。

## 11. 已否决的替代方案

- **新增独立的 `#first-run` 首启屏**：会多一个启动面与第二个「添加 vault」按钮，违背「现有
  启动屏只有唯一主操作，不额外加按钮」；也会让用户在启动面与首启屏之间看到一次跳变。否决，
  改为复用 `#startup` 的首启模式。
- **复用 `.editor-notice` / `editorRow` 放 tips**：会盖住 harness；且 `inset:0` 覆盖整条 pane 行。
  否决。
- **把启动态一直留着但不改模式**：恢复模式的骨架 + 产品标记 + 阶段行在首启下是假内容（没有
  恢复），且按钮仍在内容列。否决。
- **把首启模式放进 `shell.editorPane` 或某个 pane**：违反「首启不是 content pane」；pane 容器
  在 vault 打开前不应成为首启的承载。否决。
- **新增 `[ui] onboarding_done` 字段**：Alex 明确不新增持久化引导字段；还会碰 Rust config
  schema、ts-rs 导出面与配置文档。否决。
- **全局删除 D882「新建笔记」**：反转 M851 对所有空 vault 的行为，影响老用户；本 change 只改
  首启。否决。
- **每次空 vault 都默认展开 harness**：改变所有空 vault 的默认布局，波及老用户手感与场景
  86 / 91。否决。
- **默认展开时聚焦 composer**：无 provider 的用户第一动作会撞报错；且抢焦点。否决。
- **tips 加「知道了」关闭钮**：Alex 明确无额外界 / 关闭钮；开文档即消失是唯一出口。否决。
- **tips 里硬编码键位字符串**：`[keys]` 可重绑，写死必然漂移；改为从 `KEY_BINDINGS` 派生。否决。
- **首启模式加产品标记 / 骨架 / 阶段行**：与「只有添加 vault」冲突；窗口标题与系统 chrome 已
  提供身份。否决。
- **用 `display:none` 藏编辑器 DOM**：恢复时 CM 要重新测量，容易出首帧抖动；改为不透明覆盖 +
  结构性只读。否决。

## 12. 待 Alex 裁决

- 节点 1 批准。
- 唯一行为分叉：tips 在场时空白草稿结构性只读（推荐）vs 首键撤下 tips。
- 低风险文案 / 内容口径（可点名覆盖，不阻塞）：首启模式按钮「添加 vault」vs D6「打开 vault」；
  tips 9 条清单是否按 §5.5。
