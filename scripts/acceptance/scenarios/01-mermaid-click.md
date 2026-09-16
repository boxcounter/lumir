---
id: "01-mermaid-click"
item: 1
title: Mermaid 图表点击进源码编辑
fixtures: [mermaid.md]
open: mermaid.md
marker: "Mermaid 场景"
steps:
  - name: 渲染态（含失败块）
    expect:
      - label: 渲染成功块在 AX 树中以 widget 形态出现（help = 围栏原文）
        ax: { has: 'help="```mermaid' }
      - label: 渲染态下图表源码未在正文显露（成功块仍是图形）
        editor: { not: "A[入口] --> B[出口]" }
      - label: 渲染失败块给出失败文案
        ax: { has: "图表解析失败" }
      - label: 失败块保留原文（可回溯源码）
        editor: { has: "A[[[坏语法" }
      - shot: 渲染态
  - name: 点击图表进源码编辑
    do: click
    target: { role: AXGroup, help: "/```mermaid/" }
    expect:
      - shot: 点击后
      - label: 点击后渲染 widget 让位（help 消失）
        ax: { not: 'help="```mermaid' }
      - label: 图表源码在正文显露
        editor: { has: "A[入口] --> B[出口]" }
      - label: 显露后文档回到渲染态所需内容未丢（围栏仍在文档里）
        editor: { has: "```mermaid" }
---

说明：M112 口径——pending/ok/error 三态 widget 都挂 `mousedown` → `enterReplacedSource`，
点击显露源码并把光标放进围栏内；pending 态点击后 settle 也不回弹。本场景用合成 fixture 同时
覆盖「渲染成功」与「渲染失败」两态。渲染中（pending）态在本地渲染器已加载后窗口极短，不做
机器断言，由截图证据留档。
