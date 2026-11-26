# Proposal: 首启引导——启动态首启模式、工作区 tips 与默认 harness

- Change ID: `add-first-run-onboarding-nov25`
- 日期: 2026-11-25
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 节点 1（提案评审）**已批准**（2026-11-25）。Alex 裁决原话：「采纳推荐的只读」。批准范围：
> 本提案的意图与边界；tips 在场时空白草稿**结构性只读**（打开首个文档恢复可编辑）；其余按推荐
> 执行（首启模式按钮「添加 vault」、tips 9 条清单）。本提案提交内不实现产品代码。

## Why

真正首次启动（配置里没有 `last_vault`）的用户，今天看到的不是一块纯启动屏，而是「左上角 + 中央空白」：

- 启动态 `#startup` 本身只有一个 D6「打开 vault」入口，但它在内容列里居中（左侧还有骨架侧栏），
  不是整窗居中；而且 `refreshVaultStatus` 一到未打开终态就撤下它（`src/main.ts:4571`、
  `src/main.ts:4585`），随后 `tree.showEmpty()` 在左栏顶部给出 D5 说明 + D6 按钮
  （`src/tree.ts:1526`），正文区是一份空白未命名草稿（`src/main.ts:1729` 的 `showEditor`）。
- 打开首个 vault 后，若没有任何标签，正文显示 `.editor-notice` 覆盖层：D107 + D882「新建笔记」
  （`src/main.ts:1724`）。该覆盖层挂在 `shell.editorRow` 上（`src/main.ts:1689`），`inset:0`
  且不透明，一旦默认展开 harness pane 就会把 harness 一起盖住。

Alex 的需求是：首次启动屏只有「添加 vault」一个主操作，且主操作在整个启动主窗口中水平 / 垂直
居中；现有启动屏已经只有唯一主操作，重点修居中与纯启动屏层级，不额外加按钮。打开首个 vault 后，
content pane 显示真实功能与快捷键 tips，去掉当前的新建文件按钮，并默认显示 harness pane。
启动屏不称 content pane——打开 vault 进入工作区后才有 content / harness pane。

## What Changes

1. **新增 capability `first-run-onboarding`**
   - 「首启判定与作用域」：启动时取一次 `config.last_vault === null` 快照作为唯一判据，此后不因
     注册表 / `last_vault` 写回而复算；配置读取失败按非首启保守处理；首启的进入面是既有启动态的
     首启模式，不新增第二个启动面 / 按钮；不新增持久化引导字段。
   - 「首启工作区初始构成」：首个 vault 打开且没有标签时，content pane 显示真实功能 / 默认键位
     tips，去掉 D107 / D882 新建按钮；tips 无关闭钮、无第二动作，打开首个文档即消失且本会话不再
     出现；tips 不盖 harness，D369 空 pane 引导让位；tips 在场时空白草稿结构性只读。默认展开
     harness pane（不抢焦点、不建会话 / JSONL、不发 preflight，既有 `harness_pane` 布局位照常落盘）。
2. **`app-startup` MODIFIED「启动态的上屏与撤下」**：真正首次启动进入启动态的**首启模式**——
   只保留唯一「添加 vault」入口；不因 `no_vault` 终态或安全阀超时撤下，只在首个 vault 树就绪或
   启动层 / 主模块降级时撤下；首启模式期间工作区（`#app`）对辅助技术隐藏且不可交互。工作区命令
   分发 SHALL 走同一闸门：默认键位、配置重绑后的分发器与原生菜单命令都阻断（设置 / harness /
   键位面板不可穿透），闸门不产生 DOM / IPC / 布局副作用。非首启的三种撤下情形逐字不变。
3. **`app-startup` MODIFIED「启动态的内容与视觉口径」**：首启模式只由唯一「添加 vault」主操作
   构成，整窗水平 / 垂直居中；不建骨架、产品标记或阶段行。非首启的骨架 / 产品标记 / 阶段行条款
   与三主题、token、零动画口径逐字保留。
4. **`vault-workspace` MODIFIED「vault 切换器入口与列表浮层」**：未装载 vault 时仍无列表入口；
   D5 / D6 空态的沿用口径限定在非首启，首启由启动态首启模式承接。
5. **`file-tree` MODIFIED「未打开 vault 空态」**：非首启仍由文件树 pane 显示空态与打开入口；
   首启不呈现树空态。
6. **`pane-layout` MODIFIED「harness pane」**：首启空 vault 的初始布局是 `harness.toggle` 打开
   语义的唯一例外；只发生一次，不构成用户可触发的第二开合通道。

## Non-goals

- 不新增第二个启动面 / 首启屏模块，也不新增第二个「添加 vault」按钮；复用既有启动态的唯一入口。
- 不改变非首启空 vault 的 D107 + D882「新建笔记」入口（M851 的该入口对老用户原样保留）。
- 不新增 `onboarding_done` 之类的配置 / 状态字段，不做跨启动的 tips 持久化。
- 不把「新建笔记」按钮做全局删除，也不改写 `file-tree` 的根级新建链路。
- 不改变非首启启动态的骨架、产品标记、阶段行、撤下判据与诊断读数。
- 不改变 pane 命令族、默认 1:1 分栏比、harness pane 的常规开合语义与持久化口径。
- 不改变编辑器 / 文件树 / 会话 / harness 的后端行为；本提案不新增 Rust 命令、不新增 IPC、
  不触碰 config schema 与 ts-rs 导出面。
- 不把 tips 做成可关闭的引导浮层，不增加「知道了」「下一步」等第二动作。
- 不改变首次安装的错误文案、provider 引导与设置面板。

## Impact

- 影响的 specs：
  - 新增 `first-run-onboarding`
  - `app-startup`（首启模式的撤下规则；首启模式的构成与居中原口径）
  - `vault-workspace`（D5 / D6 空态的作用域）
  - `file-tree`（未打开 vault 空态的作用域）
  - `pane-layout`（首启默认 harness 的例外）
- 影响的代码 / 系统（实现期）：
  - `src/boot.ts` 从启动时的配置快照算出 `firstRun` 并交给启动面；`src/startup-surface.ts` /
    `src/startup-surface.css` 增加首启模式的 DOM、居中布局、撤下规则与文案；`src/main.ts` 读取
    首启模式、跳过首启的树空态、在首启模式期间把工作区（`#app`）置为不可交互并阻断命令分发、
    `onEmptyVault` 的 tips
    分支、`showEditor` / `renderAllTabStrips` 的引导门；新增 tips 模块；`src/copy-data.ts` 与
    `文案-Copy.md`。
  - 视觉测试桩需能表达 `last_vault` 的真值（当前桩恒写 `null`）；`app-main` 与
    `first-run-empty-state` 场景需拆分首启 / 老用户两态；新增首启模式居中的几何断言；审计所有
    `stubTauri(page, null)` 场景，避免它们被误判成首启。
  - 验收套件：更新 263；新增下一个空号场景（现场核对为 877，876 已被
    `876-harness-web-production-no-injection` 占用）。原生目录选择器仍不驱动；为表达「用户选中
    首个 vault」的终态，需给套件补一个 **仅验收环境生效** 的打开路径动作（见 design §9.3）。
    该动作必须复用 `switchToVault` 完整前端链路（`loadUserVault → vaultOpenPath → applyVault`），
    不是只调 `vault_open_path`；桥接仅 DEV + 验收注入，普通 dev 无桥、production 反证。
- 关联约束：ADR 0002 性能合同（首启不得新增同步 IO / IPC；启动面首启模式与 tips 均为前端 DOM）、
  ADR 0003（不改写源文件）、ADR 0004（AI-only 开发）、ADR 0006（Emacs keybinding PKM 定位）。
- 视觉基线：`app-main` / 首启模式 / tips 会变或新增；按 AGENTS.md 硬规则，`--update` 前截图须
  Alex 过目，本提案不重录任何基线。

## 节点 1：批准记录

**裁决**：2026-11-25，Alex 原话「采纳推荐的只读」。节点 1 批准本提案的意图与边界；本文不再有
待裁事项。

**批准的行为口径**：

1. **tips 在场时，文档 pane 的空白草稿结构性只读**。tips 是不透明覆盖层，若草稿仍可编辑，键入
   会落进被遮住的未命名草稿，用户看不到自己写了什么，也没有保存入口。只读后，新建笔记走 tips
   里写明的既有路径（右键左栏 vault 名 → 新建笔记）；打开首个文档后恢复可编辑。
2. **其余按推荐**：首启模式的按钮用新文案「添加 vault」（非首启启动态与老用户树空态仍用 D6）；
   tips 采用 design §5.5 的 9 条清单 + 一句「默认键位，⌘/ 看全部」；只影响真正首次启动等边界
   逐条按本提案正文执行。

**批准不等于静默扩 scope**：实现期若发现需要改变本提案的意图 / 行为边界，仍按流程更新 proposal
并重新过节点 1；不得以「已批准」为由夹带新行为。

**其余边界已按推荐写入本提案**：只影响真正首次启动；老用户空 vault 保留现状；首启判定取启动
快照且不复算；打开首个文档 tips 消失；不新增持久化字段；默认 harness 用 `openHarnessPane(false)`，
不抢焦点、不建空 JSONL、不发 preflight，允许既有 `harness_pane:true` 布局落盘；tips 无额外界 /
关闭钮，注「默认键位」并以 `⌘/` 为出口；首启空态无创建按钮，老用户空 vault 的按钮保留；现有
启动屏只有唯一主操作，本次只修居中与纯启动屏层级，不额外加按钮。

## 证据与现状锚点

详见同目录 [evidence.md](evidence.md)。关键事实：

- 启动面：`src/startup-surface.ts:61` 挂载；「打开 vault」按钮在 `:102-107`；`#startup` 固定
  整窗，但 `.startup-content` 位于 `.startup-body` 的内容列（左侧有骨架侧栏），不是整窗居中。
- 未打开终态：`src/main.ts:4571` `refreshVaultStatus` → `src/main.ts:4585` `notifyNoVault` +
  `tree.showEmpty`；树空态 DOM 在 `src/tree.ts:1526`。
- 空 vault 新建按钮：`src/main.ts:1724` `showEmptyVaultState`；覆盖层挂在
  `src/main.ts:1689` 的 `shell.editorRow`，CSS `src/style.css:1406` 起 `inset:0` 不透明。
- 空 pane 引导：`src/main.ts:678` 的 `assembly.guideEl.hidden`；判据在
  `src/pane-layout.ts:103`。
- harness 打开：`src/main.ts:890` `openHarnessPane(focusComposer = true)`；落盘在
  `src/main.ts:902` `switcher.sessionChanged()`；无会话的 `harness_state` 返回空快照
  （`src-tauri/src/harness.rs:593`）；preflight 只在发送 / cron 路径
  （`src-tauri/src/harness.rs:1787`、`:2046`）。
- 配置快照：`src/boot.ts:50` 首帧前读一次、`:56` 交接给主模块；`ConfigSnapshot.config.last_vault`
  在 `src/bindings/AppConfig.ts`。
- 文案 deck 当前末位 D1028（`src/copy-data.ts:2985`、`文案-Copy.md:1006`），不是调研时的 D991。
- 验收覆盖表末位 876；下一个空号为 877（`scripts/acceptance/COVERAGE.md` 末行）。

## 节点 2：归档记录

**归档前（2026-11-27）**：

1. **方案已批准**：节点 1 于 2026-11-25 通过（Alex 原话「采纳推荐的只读」）；实现期无静默扩 scope。
2. **独立 reviewer clean / merge**：K3 verdict `clean/merge`，绑定 tip `c04a3abf`，P1 / P2 / P3 = 0
   （`/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/first-run-onboarding-nov25/k3-verdict.md`）。
   归档分支 tip `f1fe9c99` 在审阅 tip 之后只并入 master 侧合并（`59052847` +
   `fix-no-tab-empty-state-nov27`）；首启文件集未再改动，`main.ts` 的 `renderAllTabStrips` 只把既有
   `firstRunTipsVisible` 并入 `structuralReadOnly`，行为保持、2144 单测全绿。
3. **tasks 完成**：全部勾选，真实读数见 tasks 7.5 / 9.3 / 9.4 / 9.5。
4. **门禁与真机证据**：完整 `bash scripts/gate.sh visual` 在 `c04a3abf` 上
   `GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0（日志
   `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/first-run-onboarding-nov25/gate-logs/gate-visual-lowload-20261127-c04a3abf.log`）；
   真机 877 / 263 / 47c / 220 PASS，39 / 36 / 43 / 55 断言
   （`/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-27-ux-goal/`）。
5. **规格对账**：`node scripts/openspec-archive-check.mjs` PASS（27 份 delta / 23 条 MODIFIED /
   399 段，0 静默丢段；队列条目唯一）；`validate --all --strict` 45 passed / 0 failed；归档队列
   有且仅有一条本 change 条目。

**归档后（2026-11-27）**：

- 归档提交：`955e74ab`（`chore(openspec): archive add-first-run-onboarding-nov25`）。
- 包装器输出：`Totals: + 2, ~ 5, - 0, → 0`；
  `Change 'add-first-run-onboarding-nov25' archived as '2026-11-27-add-first-run-onboarding-nov25'.`
- 修链：归档 delta 1 处（`specs/app-startup/spec.md` 的 `../../../archive/...` →
  `../../../../archive/...`）；living `openspec/specs/app-startup/spec.md` 的同一段落改为内联
  代码路径（与归档 delta 文本一致，供 `--archived` 逐段对账），`scripts/openspec-links.sh`
  710 条相对链接全部可达。
- `node scripts/openspec-archive-check.mjs --archived add-first-run-onboarding-nov25`：
  `PASS（openspec/changes/archive/2026-11-27-add-first-run-onboarding-nov25：5 条 MODIFIED，
  对比 57 段；人工恢复 0 段，声明认领 0 段）`（2026-11-27）。
- `validate --all --strict`：45 passed / 0 failed；`docs-check` PASS。
