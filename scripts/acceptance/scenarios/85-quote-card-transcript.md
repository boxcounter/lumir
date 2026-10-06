---
id: "85-quote-card-transcript"
item: 85
title: 摘录卡片 ⑤ transcript 同构沉淀（卡片与问题段落平铺、卡片变跳回按钮、无 ×）
open: harness-quote.md
marker: "QALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: 把光标放进编辑器第 1 行
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 光标下移到 QBETA 那一行
    do: keys
    keys: ["ctrl+n", "ctrl+n"]
  - name: ⌃⇧N 扩选
    do: keys
    keys: ["ctrl+shift+n"]
  - name: 点浮动钮把摘录做成卡片
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: 卡片入 composer
        ax: { has: "harness-quote.md · 摘录卡片验收" }
  - name: 在卡片后的段落写问题
    do: keys
    keys: ["t", "p", "m", "s", "g"]
  - name: 发送
    do: key
    key: enter
  - name: 等 mock 回答到达
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    expect:
      - label: 已发送的用户消息里，卡片是**跳回按钮**（读屏名 D374：跳回原文位置 + 出处）
        ax: { has: "/AXButton \\(跳回原文位置: harness-quote\\.md · 摘录卡片验收\\)/" }
      - label: 问题文字与卡片同构平铺在 transcript 里（不是只剩卡片）
        ax: { has: "tpmsg" }
      - label: transcript 内的卡片没有 × 移除钮（× 只属 composer 形态；发送后 composer 也清零）
        ax: { not: "移除摘录" }
      - shot: 01-transcript沉淀
---

# 摘录卡片 ⑤ transcript 同构沉淀

spec 判据（change add-harness-quote-cards 的「混排对话输入区 · 已发送的用户消息同构呈现」）：
已发送的用户消息按块交错渲染——卡片与问题段落平铺；transcript 内的卡片**无 × 移除钮**，
整块是「跳回原文」按钮（读屏名 D374，键盘可达）。

## 判据为什么这样写

- **结构差异可判**：composer 里的卡片在 AX 里是 `AXGroup`（无读屏名、整块可点跳回），
  transcript 里的卡片带 `role=button` 与读屏名 `跳回原文位置: 文档名 · 标题`——本场景断言后者
  在场，正是「同构沉淀 + 变成跳回入口」的可读签名。
- 「无 ×」的负观测配一条正观测：transcript 卡片按钮在场（`AXButton (跳回原文位置…`）证明消息确实
  渲染出来了，负观测不是空转。
- 发送后 composer 清零：断言 composer 的出处行消失（否则负观测会读到残留的 composer 卡片）。
