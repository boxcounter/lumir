---
id: "03-table-ctrl-np"
item: 3
title: Ctrl+N/P 表格行为（M118 裁决）
fixtures: [table.md]
open: table.md
marker: "表格场景"
steps:
  - name: 表格渲染态
    expect:
      - label: grid 表已渲染为 AX 表（render 为 widget，源码不显露）
        ax: { has: "AXTable (Markdown 表格 1)" }
      - label: 管道符行未出现在渲染态正文
        editor: { not: "| 名称 | 状态 |" }
      - label: 单元格文本按渲染态可见
        ax: { has: "名称 / 状态" }
      - shot: 表格渲染态
  - name: 点进第一张表的数据行（把光标送进表内）
    do: clickInNode
    target: { role: "AXTable", any: "Markdown 表格 1" }
    dx: 0.5
    dy: 0.8
    expect:
      - shot: 光标入表
      - label: 点击未把表格点坏（仍是渲染态 widget）
        ax: { has: "AXTable (Markdown 表格 1)" }
  - name: ⌃N 连续下行（表内逐 cell 行移动）
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]
    expect:
      - label: 连续 ⌃N 后表格仍在（键位未破坏结构）
        ax: { has: "Markdown 表格" }
      - label: 多次 ⌃N 后文档仍在（未损坏）
        editor: { has: "表格场景" }
      - shot: ctrl-n-之后
  - name: ⌃P 连续上行
    do: keys
    keys: ["ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p"]
    expect:
      - label: 连续 ⌃P 后表格仍在
        ax: { has: "Markdown 表格" }
      - label: 连续 ⌃P 后文档仍在
        editor: { has: "表格场景" }
      - shot: ctrl-p-之后
  - name: 跨整表跳过（一次按键不该把文档弄坏）
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]
    expect:
      - label: 跨表下行序列后文本内容完好
        editor: { has: "中间段落" }
      - label: 管道符未泄漏进渲染态正文
        editor: { not: "|------|------|" }
      - shot: 跨表跳过-之后
---

说明（诚实边界）：M118 裁决的「表内逐 cell 行移动、相邻行进出、跨整表跳过」里，**逐 cell 落点**需要
光标位置（`AXSelectedTextRange`），KimiCU 的 AX 输出不暴露选区。本场景钉住可机验的两层：
① grid 表确实渲染成 AX 表（`AXTable (Markdown 表格 N)` + 行/单元格文本）；
② ⌃N/⌃P 序列后表格与文档内容完好（键位不破坏结构）。
**光标是否真的进了表格 cell，当前不可回读**——KimiCU 的 AX 输出不暴露光标/选区，且实测按坐标点
进 AXTable 的 bbox 内也不会让渲染态表格让位给源码行，故不做该断言。
逐 cell 落点的精确口径由 chromium 侧 `tests/visual/scenes/m113/m118` 覆盖；真机手感归 Alex。
