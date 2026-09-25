# Proposal: ⌘{ / ⌘} 循环切换标签——标签命令族补两条默认绑定

- Change ID: tab-cycle-keys
- 日期: 2026-09-26
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 原话：「CMD +{ 和 CMD +} 可以切换 TAB」。

现状里这两个键位是**未消费状态**：唯一分发表（`src/keys.ts:293` 的 `KEY_BINDINGS`）
没有 `Cmd-{` / `Cmd-}` token（grep 零命中），原生菜单 accelerator 集合与自定义菜单项
里也没有它们（核对见 design §1.2）——按键落到 webview 后无任何归属，静默无事发生。

`⌘{` / `⌘}`（即 `⇧⌘[` / `⇧⌘]`）是 macOS 上切换标签的既定惯例键：WebKit 官方快捷键
文档把「Show next tab / Show previous tab」写成 `⇧⌘}` / `⇧⌘{`
（[WebKit Keyboard Shortcuts](https://webkit.org/web-inspector/keyboard-shortcuts/)），
Safari / Firefox 的 mac 版同样接受这对键。多标签（M149）已落地且标签命令族
（`tab.next` / `tab.prev`）与循环切换能力（`src/tabs.ts:225` 的 `cycleTab`，首尾回卷）
全部就位——缺的只是这两条默认绑定。本 change 零新命令、零新机制，只是给既有命令
再各接一条键（同一命令两条绑定是表内既有形态：撤销既有 `Ctrl-/` 与 `Ctrl-_`，
`view.text-scale-up` 既有 `Cmd-=` 与 `Cmd-+`）。

流程：本提案走「先出稿再裁决」（Alex 流程裁决），实现待节点 1 通过后开始。

## What Changes

1. **两条新绑定，零新命令**（delta：`keymap-commands`，MODIFY 既有 requirement
   「标签命令族——关闭 / 循环切换 / 序号直达」）：`Cmd-}` → `tab.next`、
   `Cmd-{` → `tab.prev`，scope `global`（与命令族其余绑定同口径——标签是窗口级对象，
   焦点在文件树 / 搜索框 / 大纲浮层里时同样要能切）。命令实现、作用域、[keys] 可重绑
   / 解绑、describe-bindings 面板收录全部是既有机制，本 change 零新代码路径。

2. **方向映射按 macOS 惯例**：`}` 侧 = 下一个、`{` 侧 = 上一个（WebKit 文档的
   Show next/previous tab 写法同上）。物理上 `⌘{` 就是 `⌘⇧[`（US 布局上 `{` 必须按
   Shift），事件 token 的归一化形态是 `Cmd-{`（`{` ∈ SHIFT_IMPLIED_KEYS，Shift 已隐含
   在字符里）——机制与实测先例见 design §1.1。

3. **真机验收场景**：新增 `scripts/acceptance/scenarios/45-tab-cycle-keys.md`，随实现
   同 PR（AGENTS.md：验收场景维护权归新功能 mission）。编号 45 按 registry 对账无撞号
   （36=restyle-content（master 已落库）、37=heading-hierarchy-ramp、
   38=content-width-drag、39=product-version-display、40=table-fullscreen-view、
   41/42=nonmd-edit（M231）、43=list-tab-indent（M230）、44 仓内未查到声明按 tower
   口径视为已占、46=dotfile-jsonc-highlight（M233）；逐条出处见 tasks.md §4 文首）。

## 待 Alex 裁决

| # | 裁决点 | 选项 | 推荐 | 理由 |
|---|---|---|---|---|
| D1 | 首 / 尾标签处再按的行为 | a. 环绕（末端回卷到第一个 / 首端回卷到最后一个）；b. 停住（无操作） | **a** | 复用既有 `cycleTab`（`src/tabs.ts:225-230`）即环绕，与 `⌃⇥` / `⌃⇧⇥` 的既有行为逐字一致——同一条命令（`tab.next` / `tab.prev`）MUST NOT 因触发键不同而行为分叉（同一命令两个语义正是 M131 要消灭的漂移）；WebKit / Safari 的标签循环键也是环绕 |
| D2 | 是否同步绑 Emacs 风格备选键位 | a. 不绑（只绑 `⌘{` / `⌘}`）；b. 同时绑一对 `⌃` 系备选 | **a** | Emacs 本身没有规范的 buffer 循环键（`C-x ←/→` 是多段 chord，本版键位层不支持多段 chord——`applyKeyOverrides` 明确拒绝含空白的键位，`src/keys.ts:530-533`）；占位绑一对自选键纯属猜测用户偏好，而 [keys] 重绑是既有机制，有需要的用户自己绑即可 |
| D3 | 命令命名与 [keys] 可重绑性 | a. 复用 `tab.next` / `tab.prev`，不新增命令 id；b. 新增独立命令 id | **a** | 语义就是「循环切换标签」，与 `⌃⇥` 逐字相同，新 id 只会制造「两条 id 同一语义」的幻影（REVIEW.md 第 8 条）；复用后 [keys] 配置重绑 / 解绑、键位面板渲染自动覆盖（面板渲染生效表，`tab.*` 组的归组依据 `TAB_COMMAND_IDS` 不变），零配套改动 |

## Non-goals

- 不绑 `⌘[` / `⌘]`（不带 Shift 的形态）：它们是 Safari 的前进 / 后退惯例键，Alex 原话
  点名的是 `{` / `}`；本仓无前进 / 后退语义可绑，留空（用户可经 [keys] 自行绑定）。
- 不新增命令 id、不动 `tab.*` 命令实现、不动标签栏 UI、不动原生菜单。
- 不改 `⌃⇥` / `⌃⇧⇥` 的既有绑定与行为（两对键并存，指向同两条命令）。
- 不引入多段 chord、不新增配置项、不改 `[keys]` 的校验口径。

## Impact

- 影响的 specs：`keymap-commands`（MODIFIED 一条 requirement「标签命令族——关闭 /
  循环切换 / 序号直达」：默认绑定清单加两条、边界 scenario 沿用）
- 影响的代码/系统（实现期）：`src/keys.ts`（2 条绑定 + doc，零新命令 id）、
  `tests/unit/keys.test.ts`（既有不变量断言自动覆盖，预期零新断言）、
  `scripts/acceptance/scenarios/45-tab-cycle-keys.md`（真机场景）
- 关联约束：ADR 0006（Emacs keybinding PKM 定位——mac 惯例键归 `⌘` 系的分工依据）；
  性能合同无关（两条绑定只进构造期建表，keypress 路径零新增工作）
- 与活跃 change 的关系：无交集（其余活跃 change 均不碰键位表的 `tab.*` 区段）。
