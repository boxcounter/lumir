---
id: "render-table-degrade"
item: 11
title: 表格降级文案带上出错行号与原因（M138）
fixtures: [render-table-degrade.md]
open: render-table-degrade.md
marker: "表格降级场景"
steps:
  - name: 降级表保持源码态
    expect:
      - label: 非矩形表整块回退为源码，不补列不猜测
        editor: { has: "| 乙 | 停用 |" }
      - label: 表头行同样按源码显示
        editor: { has: "| 名称 | 状态 | 备注 |" }
      - shot: 降级表源码态
  - name: 降级文案归因
    expect:
      - label: 文案指出出错行号与表头列数
        ax: { has: "第 10 行单元格数与表头不符（应为 3 列）" }
      - label: 文案同时说明保留原始 Markdown
        ax: { has: "保留原始 Markdown" }
---

说明：fixture 的表头声明 3 列，第 10 行（`| 乙 | 停用 |`）只有 2 格——降级是合同预期行为
（`docs/specs/table-reading.md`：非矩形表整块回退源码，系统不得补列），但 M137 的排查显示
「只说降级、不说哪一行」会让定位成本高到要另开一个 survey mission。本场景钉的就是这句归因
文案（行号为**文档行号**，用户照着能直接找到源文件那一行）。
