---
id: "81-quote-card-create"
item: 81
title: 摘录卡片 ① 选区 → 浮动钮 → 卡片入 composer（harness pane 未开先开）
open: harness-quote.md
marker: "QALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: 把光标放进编辑器第 1 行（键盘注入的前置）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 抢前台（后台注入的 chord 被抢前台时会丢键——REVIEW.md 第 11 条）
    do: focusWindow
    retries: 4
  - name: 光标下移到第 3 行（标题行 + 空行之后）
    do: keys
    keys: ["ctrl+n", "ctrl+n"]
  - name: ⌃⇧N 选中第 3 行——浮动钮应在选区右下浮现
    do: keys
    keys: ["ctrl+shift+n"]
    expect:
      - label: 浮动「摘录到对话」钮在场（此刻 harness pane 还没打开）
        ax: { has: "摘录到对话" }
      - label: harness pane 此刻是收起的（正观测：本步确实是「未开先开」的前置）
        ax: { not: "/AXButton \\(发送\\)/" }
      - shot: 01-浮动钮

  - name: 点浮动钮 → harness pane 自动分栏、卡片入 composer
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: harness pane 自动分栏打开（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板已自动打开（发送钮是在场正观测）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: composer 内的卡片带出处行（文档名 · 最近一级标题）
        ax: { has: "harness-quote.md · 摘录卡片验收" }
      - label: 卡片摘录原文进了 composer（选区那几行的正文在卡片里）
        ax: { has: "/AXTextArea = \"Q[A-Z]+ (甲|乙|丙)段/" }
      - label: chip 走「仅路径」形态（消息携带卡片时跳过视口注入）
        ax: { has: "上下文：harness-quote.md" }
      - label: 卡片带 × 移除钮（composer 形态；读屏名 D371）
        ax: { has: "/AXButton \\(移除摘录\\)/" }
      - shot: 02-卡片入composer

  - name: 点 × 移除钮（卡片按整体作用移除）
    do: click
    target: { role: AXButton, name: "移除摘录" }
    expect:
      - label: 卡片被整体移除（出处行从 composer 消失）
        ax: { not: "harness-quote.md · 摘录卡片验收" }
      - label: 移除后 chip 回到「视口」形态（卡片没了 ⇒ 视口注入恢复，装配层读数）
        ax: { has: "/上下文：harness-quote\\.md · 视口 \\d+–\\d+ 行/" }
      - shot: 03-移除后
---

# 摘录卡片 ① 选区 → 浮动钮 → 卡片入 composer

spec 判据（change add-harness-quote-cards 的「摘录引用卡片」与「混排对话输入区」）：
在编辑器 pane 选中片段 → 选区右下浮现「摘录到对话」浮动钮（文案 D370）→ 点击后 harness pane
**未开先开**（自动分栏，旁侧 pane；M346 起取代原 dock 列）、选段以 block 级引用卡片进入 composer。
卡片出处行 = 文档名 · 最近一级标题
（裁决点 7 的最近一级标题语义）；卡片按原子块整体作用，可被移除。

## × 移除钮的来历（M343 的模块装缺陷，本场景首次抓到）

本场景第一版就断言了 × 移除钮，当场判红：`src/harness-panel.ts` 的 `createCardEl` 创建了
`.lumir-hp-qc-x`（文案 / 样式 / 点击处理器齐全）却漏了把它挂到卡片元素上，因此 AX 树与截图
上都找不到它——而 M343 的模型层单测（`removeBlockAt`）全绿，模块装的缺陷无人拦。
修法是一行 `el.append(remove)`（finding `20261006-worker-qc4-bug-composer-dom-createcardel-append.md`）；
DOM 侧另加一道防线在 `tests/visual/scenes/m345-quote-card.spec.ts`（结构在场 + 点击移除卡片），
本场景则验真机行为：× 在场（读屏名 D371）→ 点击 → 卡片消失、chip 回到视口形态。

## 判据为什么这样写

- 选区在 AX 层不可断言（套件「光标/选区不可断言」边界），用 ⌃⇧N 键盘扩选建立选区（与场景
  64/70 同一手势）。
- 「浮动钮在场」是**正观测**（AX 里出现名字为「摘录到对话」的 AXButton）；「面板未开」配一条
  负观测（发送钮不在场）——两条一起把「未开先开」的前置钉死，否则这条场景可能是「面板本来就
  开着」的空转。
- 卡片是否真进了 composer：以**出处行**「文档名 · 标题」为判据。该串只由卡片渲染产出，
  编辑器正文里没有它。
- chip 走 D373「仅路径」形态（`上下文：harness-quote.md`，不带「视口」）——它是「消息携带
  卡片 ⇒ 跳过视口注入」在装配层的可读读数。
