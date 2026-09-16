---
id: "06-callout-and-width"
item: 6
title: Callout 光标行源码显露 / cell 内 $$y$$ / 表格宽度证据
fixtures: [callout.md, table.md]
open: callout.md
marker: "Callout 场景"
steps:
  - name: Callout 渲染态
    expect:
      - label: 渲染态下 `[!note]` 标记不显露（Callout 已成 widget）
        editor: { not: "[!note]" }
      - label: Callout 内容按块渲染（标题 + 正文行）
        editor: { has: "提示标题" }
      - label: Callout 正文行不再带 `>` 引用前缀
        editor: { not: "> Callout 正文" }
      - shot: callout-渲染态
  - name: 光标移入 callout 首行（点编辑器顶部 + ⌃N 逐行下行）
    do: clickEditor
    dy: 6
    expect:
      - label: 光标进入正文后文档未被破坏
        editor: { has: "Callout" }
  - name: ⌃N 下行靠近 callout 首行（取现场证据）
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]
    expect:
      - label: 下行过程中文档未被破坏
        editor: { has: "Callout 正文第一行。" }
      - shot: callout-光标行
  - name: 切到 table.md 取证表格宽度（欠宽/超宽）
    do: open
    file: table.md
    marker: "表格场景"
    expect:
      - label: 切表后文档已换为表格场景
        editor: { has: "宽表" }
      - label: 宽表超栏宽时按横滚处理（未被裁掉内容）
        editor: { has: "说明说明说明" }
      - shot: 表格宽度-欠宽与超宽
---

说明：callout 的机器断言是「渲染态：`[!note]` 标记与 `>` 前缀都不显露、内容按块渲染」；
「光标进该行后源码显露」需要把光标精确落在 callout 首行，而 AXX 面无选区、渲染行高又不固定，
当前不可机验（见 README 已知边界），故只留截图证据。
表格宽度（欠宽不拉伸、超宽横滚）的**手感**归 Alex，本场景只留截图证据（backlog 待裁决项 4
「宽表横向溢出裁切是否预期」同源）。cell 内 `$$y$$` 的渲染断言在场景 05。
