---
id: "122-harness-message-excerpt-exclusion"
item: 423
title: harness 消息摘录 ② 排除面：思考块内选区不出钮（消息体选区出钮为正向对照）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-thinking.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮在场 = 本次读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 发一条提问（mock 产出 reasoning_chunks 的响应）
    do: keys
    keys: ["e", "x", "c"]
  - name: 发送
    do: key
    key: enter

  - name: 等回答与思考块到达（折叠默认态）
    do: waitFor
    waitFor:
      has: ["THINK-ANSWER-01", "/思考过程 · \\d+ 秒/"]
    expect:
      - label: 回答正文渲染
        ax: { has: "THINK-ANSWER-01" }
      - label: 折叠默认态下思考原文不显（负观测的正向前置）
        ax: { not: "THINK-BODY-ALPHA" }

  - name: 点折叠行展开思考块
    do: click
    target: { role: AXButton, name: "^思考过程" }
  - name: 展开态：思考原文可见
    do: waitFor
    waitFor:
      has: ["THINK-BODY-ALPHA 第一片。"]
    expect:
      - label: 展开后思考原文上屏（下一步的选区目标在场）
        ax: { has: "THINK-BODY-ALPHA 第一片。" }

  - name: 拖选思考块正文里的一段（选区落在思考块内）→ MUST NOT 出浮动钮
    do: drag
    target: { x: 900, y: 161 }
    dx: 100
    dy: 0
    expect:
      - label: 思考块内选区不出「摘录到对话」钮（排除面）
        ax: { not: "/AXButton \\(摘录到对话\\)/" }
      - shot: 01-思考块内无钮

  - name: 拖选回答正文里的一段（正向对照：同一手势在消息体里出钮）
    do: drag
    target: { x: 900, y: 207 }
    dx: 100
    dy: 0
    expect:
      - label: 消息体选区出钮（证明上一条负观测不是「手势全不工作」的空转）
        ax: { has: "/AXButton \\(摘录到对话\\)/" }
      - shot: 02-消息体出钮
---

# 122-harness-message-excerpt-exclusion —— 消息摘录 ② 排除面（design §8 ②）

## 本场景在验什么

transcript 里并非所有文字都能摘：思考块、工具行、批准卡、消息内引用卡片内部的选区 MUST NOT
出「摘录到对话」钮（design §5 排除面）。本场景用思考块一条可造的形状验排除，并配一条**正向
对照**（同一 `selectText` 手势在助手段正文里出钮）——排除面的负向断言必须有一条同通道的正观测
兜底，否则「按钮根本没工作」也会让负向断言假绿（REVIEW.md 第 1/2 条）。

## 已知边界（如实登记）

- 选区通道是既有的 **`drag`（`{x,y}` 窗口局部坐标）**——拖拽两条：思考块正文（y=161）与回答
  正文（y=207），坐标随 fixture 布局走，改 fixture / 窗口尺寸须重取（方法见场景 121 的说明）。
  选择这条通道的实证：transcript / 思考块的文本在 AX 里都是**无 bbox 的 `AXStaticText`**，
  `doubleClick` / `drag` 的节点定位报「找不到带 bbox 的节点」；KimiCU 的 `select_text` 虽能选中
  文本，但**不产生 DOM `selectionchange`**，应用侧手势收不到（对照：对编辑器正文做同样操作，
  编辑器那颗摘录钮也不出现）——因此套件没有引入 `selectText` 动词。
- 工具行 / 批准卡 / 卡片内部三条排除分支的 DOM 判据在 chromium 视觉场景
  `tests/visual/scenes/m423-message-excerpt.spec.ts`（程序化选区，稳定可判）。
