---
id: "render-table-degrade"
item: 11
title: 表格降级文案带上出错行号与原因（M138）/ 短行补空列不再降级（M142）
fixtures: [render-table-degrade.md]
open: render-table-degrade.md
marker: "表格降级场景"
steps:
  - name: 多列表保持源码态
    expect:
      - label: 多列表整块回退为源码，不补列不猜测
        editor: { has: "| 乙 | 停用 | 补充 | 多余 |" }
      - label: 表头行同样按源码显示
        editor: { has: "| 名称 | 状态 | 备注 |" }
      - shot: 降级表源码态
  - name: 降级文案归因
    expect:
      - label: 文案指出出错行号与表头列数
        ax: { has: "第 10 行单元格数与表头不符（应为 3 列）" }
      - label: 文案同时说明保留原始 Markdown
        ax: { has: "保留原始 Markdown" }
  - name: 短行表按矩形渲染
    expect:
      - label: 末行少一格的表渲染成表格（短行尾部补了空 cell）
        ax: { has: "Markdown 表格" }
      - label: 该行源码不再整块显露
        editor: { not: "| 短行甲 | 短行乙 |" }
      - label: 短行表的内容仍在
        editor: { has: "短行甲" }
      - shot: 短行表渲染态
---

说明：fixture 有两条相反的表形态，钉的是 M142 收窄后的合同口径
（`docs/specs/table-reading.md` §2）：

- **多列整块降级**：表头声明 3 列，第 10 行（`| 乙 | 停用 | 补充 | 多余 |`）有 4 格——GFM 对
  多列是 excess ignored，静默丢列与「不猜测修复」冲突，故整块回退源码。M137 的排查显示
  「只说降级、不说哪一行」会让定位成本高到要另开一个 survey mission，本场景钉的就是这句归因
  文案（行号为**文档行号**，用户照着能直接找到源文件那一行）。
- **短行尾部补空列**：末行 `| 短行甲 | 短行乙 |` 只有 2 格而表头声明 3 列，按 GFM spec §4.10
  尾部补空 cell 后正常渲染——空 cell 就是空 cell，不填占位符、不加缺列标记；源文件一字不改。
  Alex 2026-09-16 裁决采纳（背景见 backlog「已核销」的 GFM 短行条目）。

本场景的可机验面：多列表的源码态与归因文案走 AX 文本；短行表渲染成 `Markdown 表格` 走 AX 结构，
「源码不再显露」走 `editor` 的**渲染后**文本（被 widget 替换掉的源码在里面看不见）。手感项
（空 cell 观感、列宽是否合意）只留截图，判定归 Alex。
