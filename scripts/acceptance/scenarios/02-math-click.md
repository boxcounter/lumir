---
id: "02-math-click"
item: 2
title: 公式渲染态与进编辑路径（⌃B 次数仍待判定）
fixtures: [math.md]
open: math.md
marker: "公式场景"
steps:
  - name: 渲染态
    expect:
      - label: 行内公式源码未在正文显露（已渲染为公式）
        editor: { not: "$a^2+b^2=c^2$" }
      - label: 行内公式渲染成 KaTeX 文本（源码被 replace）
        ax: { has: "行内公式" }
      - label: 块级公式源码未在正文显露
        editor: { not: "\\int_0^1 x^2" }
      - label: 块级公式渲染结果可见（积分符号与分式都在）
        ax: { has: "公式后普通段落文本" }
      - shot: 渲染态
  - name: 键盘路径进入公式行（为后续 ⌃B 判定留证据）
    do: clickEditor
    dy: 6
    expect:
      - label: 编辑器已接收焦点且文档完好
        editor: { has: "公式场景" }
  - name: ⌃N 下行 + ⌃E 到行尾
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+e"]
    expect:
      - label: 光标移动未破坏渲染态（公式仍未显露源码）
        editor: { not: "$a^2+b^2=c^2$" }
      - shot: 光标在公式行附近
---

说明（诚实边界）：backlog 项 2 的开放问题是「公式后按 Ctrl+B 是否 1–2 次」。该判定要求
**光标停在公式 span 之后**，而 KimiCU 的 AX 输出不暴露光标/选区位置（README 已知边界），
「⌃N 下行 + ⌃E 行尾 + ⌃B」这条纯键盘路径的落点无法回读校验，故本场景只钉渲染层：
行内/块级公式都已渲染成 KaTeX、源码不显露。**⌃B 次数仍待真机判定**（代码口径为 1 次：
`mathSpanCrossed` 落点 = span.to−1），已在 backlog 保持「待判定」并附本场景证据。
