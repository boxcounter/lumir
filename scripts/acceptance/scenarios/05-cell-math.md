---
id: "05-cell-math"
item: 5
title: 表格 cell 内公式渲染 + 点击编辑
fixtures: [table.md]
open: table.md
marker: "表格场景"
steps:
  - name: cell 内公式渲染态
    expect:
      - label: 行内公式在 cell 内已渲染（源码不显露）
        editor: { not: "$y$" }
      - label: 块级 `$$y$$` 在单个 cell 内按行内样式渲染
        editor: { not: "$$y$$" }
      - label: 含公式的表已渲染为 AX 表
        ax: { has: "AXTable (Markdown 表格 2)" }
      - label: cell 渲染文本含公式结果（KaTeX 文本）
        ax: { has: "行内 / y / 块级 / y" }
      - shot: cell 内公式渲染态
  - name: 点进含公式的 cell（按 AXTable bbox 取坐标）
    do: clickInNode
    target: { role: "AXTable", any: "Markdown 表格 2" }
    dx: 0.75
    dy: 0.8
    expect:
      - shot: 点进公式 cell 后
      - label: 点击未把含公式的表点坏（仍是渲染态 widget）
        ax: { has: "AXTable (Markdown 表格 2)" }
      - label: 公式仍是渲染态（未被点击破坏成源码）
        editor: { not: "$y$" }
---

说明：M119 口径——完全落在单个 cell 内的同行 `$$...$$` 按行内样式渲染（块级 replace 会拆散 grid）。
判定用渲染层事实：cell 内 `$y$`/`$$y$$` 都已渲染、源码不显露，且渲染成 AX 表后单元格文本为
`行内 / y / 块级 / y`（KaTeX 只剩公式字符，原始 `$...$` 在 DOM title 上，AX 不暴露）。
「点击渲染态公式进编辑」这一步依赖光标/选区回读，当前不可机验（README 已知边界）。
