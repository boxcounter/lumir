---
id: "86-harness-pane-toggle"
item: 86
title: ⌘⇧A 开合 harness pane：自动分栏默认 1:1、再按收起不丢标签、pane.close 于 harness pane 同义
fixtures: [tabs-a.md]
open: tabs-a.md
marker: "标签场景 A"
seed:
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: 单 pane 常态（无分隔条、一个标签、正文在位）
    do: settle
    expect:
      - shot: 01-单-pane
      - label: 单 pane 没有分隔条（D368 只在分栏态出现）
        ax: { not: "分隔条" }
      - label: 一个标签（一个关闭钮）
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - label: 编辑器正文是 tabs-a
        editor: { has: "标签场景 A" }
      - label: 标题栏 harness toggle 钮在场（M370 起钮面是火花 SVG 图标；aria-pressed 钮在 WKWebView 读作 AXCheckBox，读屏名仍是 D327「对话面板」）
        ax: { has: "/AXCheckBox \\(对话面板\\)/" }

  - name: ⌘⇧A 打开 harness pane——无第二 pane 时自动分栏
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - shot: 02-harness-pane-打开
      - label: 自动分栏成立（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位（发送钮是本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 标题栏 harness 段出现（会话名 / 新建会话钮，D330）
        ax: { has: "/AXButton \\(新会话\\)/" }
      - label: 文档标签没有被复制也没有丢失（仍是一个关闭钮）
        ax: { count: { pattern: "关闭 ", exact: 1 } }

  - name: 等布局落盘（防抖 1s）——核对记下的形状与默认比例
    do: sleep
    ms: 2600
    expect:
      - label: 会话文件记下 harness pane 在场（harness_pane 持久位）
        file: { path: "env:vault-sessions/acc-a.json", has: '"harness_pane": true' }
      - label: 默认宽度比 = 文档侧 1/2（harness:文档 = 1:1，Alex 2026-10-10 裁决）
        file: { path: "env:vault-sessions/acc-a.json", has: '"pane_split_ratio": 0.5' }
      - label: 会话是 v2 分栏形状
        file: { path: "env:vault-sessions/acc-a.json", has: '"version": 2' }

  - name: ⌘⇧A 再按——收起 harness pane，回单 pane，标签不丢
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - shot: 03-收起
      - label: 分隔条消失（回到单 pane 常态）
        ax: { not: "分隔条" }
      - label: 面板离场（发送钮不在）
        ax: { not: "/AXButton \\(发送\\)/" }
      - label: 收起不丢标签
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - label: 文档正文仍在
        editor: { has: "标签场景 A" }

  - name: ⌘⇧A 再开（分栏态焦点落 composer）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 又分栏了
        ax: { has: "分隔条" }
      - label: 标签数不变
        ax: { count: { pattern: "关闭 ", exact: 1 } }

  - name: ⌥W（pane.close）——活跃 pane 是 harness，语义 = 关 harness
    do: key
    key: "alt+w"
    expect:
      - shot: 04-pane-close-收-harness
      - label: pane.close 于 harness pane 收起 harness（回单 pane）
        ax: { not: "分隔条" }
      - label: 收 harness 不动文档标签
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - label: 文档正文仍在
        editor: { has: "标签场景 A" }
---

# 86-harness-pane-toggle —— ⌘⇧A 的 pane 语义（change move-harness-to-pane-chat-frame tasks 1.1/1.3）

## 本场景在验什么

M346（HP1）把 harness 从 dock 列归位 pane 之后，`⌘⇧A` / 标题栏 toggle 钮的语义变成「在旁侧
pane 打开/收起 harness」，且 **harness 在场时文档 pane 至多一个**（上限二不变）。本场景走真机
键盘通道验四条只有在真实 WKWebView + 真实键盘下才成立的事：

1. **自动分栏**：单 pane 下按 `⌘⇧A`，无第二 pane 时自动分栏（分隔条 D368 出现），面板落在
   旁侧 pane 里（发送钮在场）。
2. **默认宽度比 1:1**（harness:文档）：`splitRatio` 记的是**文档侧**占比，`openHarnessPane`
   在「本 vault 无存储比例」时置 `HARNESS_DEFAULT_DOC_RATIO = 1/2`（2026-10-10 裁决，原 2/3）。
   判据落在会话文件 `pane_split_ratio`（0.5）——这是比例的盘上事实（AX 通道读不到栏宽）。
3. **再按收起、不丢标签**：`⌘⇧A` 二次按下收 harness pane，文档标签计数与正文都不变。
4. **`pane.close` 于 harness pane 同义**：分栏态焦点落 composer（活跃 pane = harness），
   `⌥W`（pane.close）因此 = 关 harness，而不是去关文档 pane。

## 断言口径

- **在不在分栏**：`ax: { has/not: "分隔条" }`——D368（`分隔条——拖拽调整左右两个 pane 的宽度`）
   只在非 root pane 在场时建元素，是分栏的唯一结构证据（与场景 79 同源）。
- **面板在位**：`AXButton (发送)`（D329）——面板已挂进 pane 挂载元素，发送钮在场即面板在位。
- **标题栏 toggle 钮**（M370 适配）：钮面是原型同款火花 SVG（可见文字「对话 / Chat」退场，
  可读身份 = D327 读屏名「对话面板」）——单 pane 态断 `/AXCheckBox \(对话面板\)/`（带
  aria-pressed 的 button 在 WKWebView AX 树里映射成 AXCheckBox，不是 AXButton）；
  分栏态它按退让条款隐藏（步骤「⌘⇧A 打开」后看不到它是预期，不是缺失）。
- **标题栏 harness 段**：`AXButton (新会话)`（D330）——段内的会话名下拉钮与新建会话钮在未命名
   会话下都读作「新会话」，两者之一在场即证明段已装配（段读屏名 D375「对话会话」是另一条）。
- **标签计数**：用「关闭钮读屏名」计数（每个标签恰一个关闭钮，与场景 14/79 同源）。harness pane
   恒零标签，因此它开合不影响这个计数——计数不变正是「不丢标签 / 不复制标签」的判据。
- **默认比例**：读 `env:vault-sessions/acc-a.json` 的 `pane_split_ratio`。AX 通道读不到栏宽，
  比例只能从盘上事实判。`0.5` 是 1/2 的**精确**值（serde_json 打印 `0.5`，不是 `0.5000…`）。

## 已知边界

- **拖拽改比例不在本场景**：分隔条拖拽改的是 `pane_split_ratio`，属场景 38（栏宽拖拽）同族的
  坐标通道面，本场景只验「首次打开的默认比例」。
- **「存储比例优先」这一面未覆盖（本场景只覆盖默认值这一面）**：M434 的 tasks 3.2 要求
  「无存储比例 → 1:1」与「有存储比例 → 用存储值」两面并存。本场景每次运行都从**无存储比例**
  起步（`seed` 只预置注册项、不预置会话），因此判的是前者；后者需要一个**非默认比例的预置
  现场**（`seed.sessions.<id>.ratio` ≈ 0.6）并观察打开时不用默认值——本场景不展开，归
  pane 比例专项（与下面「收起后比例是否保留」同因：都要一个非默认比例的预置现场）。
  `storedRatioApplied` 的取值只在收到存储布局后才为真，默认值只在它之外生效。
- **收起后比例是否保留**：`storedRatioApplied` 在收到存储布局后置真，收起/重开沿用存储比例
  （不回到默认）。本场景不展开这条（同上，需要一个非默认比例的预置现场）。
- **`⌥S`（pane.split）在 harness 在场时无操作**：上限二下 `split()` 返回 null。判据弱（无第三
  pane 的可观测形态与「仍分栏」等价），本场景不写这条，避免一条恒真的断言。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；预置注册项 `acc-a` 指向
  `$vault`（会话文件因此落在 `env:vault-sessions/acc-a.json`），真实 vault 只读。
- 只开合 harness pane 与文档 pane，**不改 vault 文件**；会话文件在隔离配置目录下。
- 会 `AXRaise` 抢前台焦点（键盘步骤需要），跑完由套件交还；1420 全程不碰，套件走自带 1430。
