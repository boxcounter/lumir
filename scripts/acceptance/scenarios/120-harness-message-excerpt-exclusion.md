---
id: "120-harness-message-excerpt-exclusion"
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

  - name: 双击思考块正文里的文字（选区落在思考块内）→ MUST NOT 出浮动钮
    do: doubleClick
    target: { any: "/THINK-BODY-ALPHA/" }
    expect:
      - label: 思考块内选区不出「摘录到对话」钮（排除面）
        ax: { not: "/AXButton \\(摘录到对话\\)/" }
      - shot: 01-思考块内无钮

  - name: 双击回答正文里的文字（正向对照：同一手势在消息体里出钮）
    do: doubleClick
    target: { any: "/THINK-ANSWER-01/" }
    expect:
      - label: 消息体选区出钮（证明上一条负观测不是「手势全不工作」的空转）
        ax: { has: "/AXButton \\(摘录到对话\\)/" }
      - shot: 02-消息体出钮
---

# 120-harness-message-excerpt-exclusion —— 消息摘录 ② 排除面（design §8 ②）

## 本场景在验什么

transcript 里并非所有文字都能摘：思考块、工具行、批准卡、消息内引用卡片内部的选区 MUST NOT
出「摘录到对话」钮（design §5 排除面）。本场景用思考块一条可造的形状验排除，并配一条**正向
对照**（同一双击手势在助手段正文里出钮）——排除面的负向断言必须有一条同通道的正观测兜底，
否则「按钮根本没工作」也会让负向断言假绿（REVIEW.md 第 1/2 条）。

## 已知边界（如实登记，2026-10-10 真机实证）

- **本场景当前在真机上红，成因与场景 119 同一条**：transcript 消息文本在 AX 树里是无 bbox 的
  `AXStaticText`，`doubleClick` 按节点定位报「找不到带 bbox 的节点」；套件缺「选中静态文本」
  动词（KimiCU 有 `select_text`，但 `lib/**` 不在本 mission scope）。给 `lib/` 加 `selectText`
  动词后本场景即可全绿——思考块内的负向断言与消息体的正向对照都在同一条通道上，无需其它前置。
  证据：`test-results/acceptance/2026-10-10/120-harness-message-excerpt-exclusion/`。
- 工具行 / 批准卡 / 卡片内部三条排除分支的 DOM 判据在 chromium 视觉场景
  `tests/visual/scenes/m423-message-excerpt.spec.ts`（程序化选区，稳定可判）。
