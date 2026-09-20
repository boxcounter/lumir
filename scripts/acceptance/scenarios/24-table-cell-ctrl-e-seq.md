---
id: "24-table-cell-ctrl-e-seq"
item: 24
title: 表格 cell 内 ⌃E→⌃F→⌃E 序列不把光标送回上一个 cell（M185）
fixtures: [table.md]
open: table.md
marker: "表格场景"
steps:
  - name: 点进第一张表（短表）的表头行，把光标送进表内
    do: clickInNode
    target: { role: "AXTable", any: "Markdown 表格 1" }
    dx: 0.1
    dy: 0.15
    expect:
      - label: grid 表已渲染为 AX 表
        ax: { has: "AXTable (Markdown 表格 1)" }
      - label: 管道符行未出现在渲染态正文（光标在表内，源码仍不显露）
        editor: { not: "| 名称 | 状态 |" }
      - shot: 光标入表
  - name: 记下序列前的文档基线
    do: recordEditor
    as: seqBase
    expect:
      - label: 基线已记下（文档可读，含第一张表的表头文本）
        editor: { has: "名称" }
  - name: ⌃A 归一化到本行首 cell → ⌃E 到该 cell 内容右缘 → ⌃F 一步 → ⌃E 再取行尾
    do: keys
    keys: ["ctrl+a", "ctrl+e", "ctrl+f", "ctrl+e"]
    expect:
      - label: 序列只移动光标，文档逐字节不变
        editor: { unchangedSince: seqBase }
      - label: 表格结构未被键位序列破坏（仍是渲染态 AX 表）
        ax: { has: "Markdown 表格 1" }
      - shot: ctrl-e-ctrl-f-ctrl-e-之后
  - name: 键入 x：落点必须落在第二个 cell（修复前落在第一个 cell）
    do: keys
    keys: ["x"]
    expect:
      - label: x 在第二个 cell 的内容右缘（修复前 x 落在第一个 cell）
        editor: { has: "/状态x|正常x|停用x/" }
      - label: 第一个 cell 里没有 x（修复前的落点）
        editor: { not: "/名称x|甲x|乙x/" }
      - label: 插入未把表格点坏
        ax: { has: "Markdown 表格 1" }
      - shot: 落点指纹
---

说明：本场景是 M185（⌃E→⌃F→⌃E 序列的 cell 归属修复）的真机取证。
**缺陷现场（Alex 2026-09-21 原话）**：「在表格的一个 cell 里 CTRL+E 把光标挪到尾部后，再按 CTRL+F
光标会进入下个 cell，但此时如果 CTRL+E 光标会回到刚才那个 cell 的尾部。」

**根因**（chromium 探针实测，M185）：⌃F 从 cell 内容右缘走一步，落点是**紧随其后的隐藏管道符左缘**
（= 该 cell slot 的 `to`）。那个位置原生 caret 矩形退化为 0×0（`coordsAtPos(pos, ±1)` 两侧都退化，
DOM 选区矩形 0×0），浏览器把 caret 画到管道符之后第一个被绘制的内容上——用户看到「光标进入下一个
cell」。而 slot 查找用的是闭区间（`pos >= slot.from && pos <= slot.to`），这个边界位被判给**前一个**
cell，⌃E 于是取前一个 cell 的内容右缘：光标往回跳一格并跨回上一个 cell。

**本场景的判据为什么是「键入 x 看它落在哪个 cell」**：KimiCU 的 AX 输出不暴露 `AXSelectedTextRange`
（`scripts/acceptance/README.md` 的「已知边界」），光标位置无法直接断言。于是用**被测命令自己的产物**
当判据：序列结束后落点在哪，就决定了紧接着键入的 `x` 落在哪个 cell 的内容右缘——这是该序列唯一
能产生这条文本的机制（`x` 在 fixture 里一次都不出现，见 `table.md`）。修好后 `x` 跟在**第二个** cell
的末字之后（「状态x」等），修复前跟在第一个 cell 的末字之后（「名称x」等），两条断言一正一反正好
把两个终态分开。第三个断言同时确认这一步没把表格点坏。

**序列为什么以 ⌃A 开头**：点击落点不确定（点的是 AXTable 的坐标框），⌃A 把光标归一到**本行可见行首**
= 首 cell 起点（M168 口径，行首本身可停靠），后续 ⌃E / ⌃F / ⌃E 才是确定的：
⌃E 取到首 cell 内容右缘 → ⌃F 走一步正好停在隐藏管道符左缘（fixture 的对齐空白是一个空格）→
第二次 ⌃E 必须取**第二个 cell** 的内容右缘。这三步在短表的任一行（表头 / 数据行）都成立，故断言用
三行的文本做择一（`状态x|正常x|停用x`）——点进表头行还是数据行都判得出，点进别的表则整条断言 FAIL，
截图可见光标在哪一行。

**反向验证（REVIEW.md 第 1 条的防线）**：同样的序列在**未修复**的代码上跑，chromium 探针落点读数
（`test-results/m185-probe/probe4.mjs`，本地 git 外）是「第二次 ⌃E → local 4 = 第一个 cell 内容右缘」，
修复后是「local 9 = 第二个 cell 内容右缘」——即上一条 expect 在修复前必然 FAIL。真机上的同一形态在
M185 合并后的批次里复跑确认。
