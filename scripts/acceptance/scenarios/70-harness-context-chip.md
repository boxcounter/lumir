---
id: "70-harness-context-chip"
item: 70
title: Harness ① 选区唤起 + 上下文 chip（change add-harness-probe，mock provider）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: 把光标放进第 1 行（点编辑器正文起点）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里（键盘注入的前置）
        ax: { focused: "AXTextArea" }
  - name: 抢前台（后台注入的 chord 在前台被抢时会丢键——REVIEW.md 第 11 条）
    do: focusWindow
    retries: 4
  - name: ⌃⇧N 两次：把选区从第 1 行扩到第 3 行（同场景 64 已验证的手势；⌘A 全选在盲发 chord 下不可靠）
    do: keys
    keys: ["ctrl+shift+n", "ctrl+shift+n"]

  - name: ⌘⇧A 唤起面板——chip 显示选区上下文（发送前可核对）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 面板出现（发送钮在场是本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: chip 是「选区」口径（不是视口），带文件路径与行范围
        ax: { has: "/上下文：harness-note\\.md · 选区 \\d+–\\d+ 行/" }
      - shot: 01-选区唤起

  - name: 输入提问并 Enter 发送
    do: keys
    keys: ["c", "t", "x", "p", "r", "o", "b", "e"]
  - name: 发送
    do: key
    key: enter

  - name: 等 mock 回答到达
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    expect:
      - label: 回答渲染在面板里
        ax: { has: "验收回答：上下文已收到。" }
      - label: 提问进了 JSONL 留存
        file: { path: "env:harness/*.jsonl", has: '"kind":"user_message"' }
      - label: 注入的上下文节在 JSONL 里（文件路径 + 选区标记）
        file: { path: "env:harness/*.jsonl", has: "/当前编辑器上下文：\\\\n文件：harness-note\\.md\\\\n选区（第/" }
      - label: 选区原文随消息注入（标题行在选区覆盖内；「视口还是选区」由上一条「选区（第」判别）
        file: { path: "env:harness/*.jsonl", has: "# Harness 验收笔记" }
      - shot: 02-回答到达
---

spec 判据（harness「上下文注入与可见性 · 选区注入」）：选中后唤起面板，chip 显示路径 +
选区摘要；模型收到的消息包含路径与选区原文。本场景用 ⌃⇧N 键盘扩选构造选区（AX 读不到选区
本身，套件「光标/选区不可断言」边界；⌘A 全选盲发 chord 实测不可靠，弃用），chip 的
「选区 N–M 行」是选区在场的派生判据；注入侧用 JSONL 留存的 user_message 全文断言
（含「选区（第」节与选区原文）。
