---
id: "265-table-cell-webkit-editing"
item: 265
tier: full
title: WebKit 表格 cell 端点编辑——键入 / Backspace / Delete 只改被点中的源字节、一次撤销与精确落盘（M855）
fixtures: [table.md]
open: table.md
marker: "表格场景"
steps:
  - name: 渲染态：表格以 grid 渲染
    expect:
      - label: grid 表已渲染为 AX 表
        ax: { has: "AXTable (Markdown 表格 1)" }
      - label: 源码管道行不在渲染态正文里
        editor: { not: "| 名称 | 状态 |" }
      - label: 单元格文本按渲染态可见
        ax: { has: "名称 / 状态" }
      - shot: 表格渲染态

  - name: 点进第一张表的数据行（caret 落在表内；列位置无关——下面用 ⌃A / ⌃E 归一到首 cell）
    do: clickInNode
    target: { role: "AXTable", any: "Markdown 表格 1" }
    dx: 0.5
    dy: 0.5
    expect:
      - label: 点击后仍是渲染态表格
        ax: { has: "AXTable (Markdown 表格 1)" }
      - shot: 光标入表

  # witness A：数据 cell 内容尾缘键入。M842 现场：WebKit 原生路径把插入点折到块首、
  # 吃掉 cell 尾部对齐空白（chromium 同操作正确）。判据落在 ⌘S 后的 file.exact。
  - name: ⌃A 到本行行首（真键盘事件通道）
    do: key
    key: "ctrl+a"
    channel: cgevent
    gapMs: 150
  - name: ⌃E 到首 cell 内容右缘
    do: key
    key: "ctrl+e"
    channel: cgevent
    gapMs: 150
  - name: 键入 q
    do: keys
    keys: ["q"]
    gapMs: 150
    expect:
      - label: 字符插在 cell 内容里（渲染态可见）
        editor: { has: "甲q" }
  - name: 记录表格基线
    do: record
    file: table.md
    as: 表格基线
  - name: ⌘S 落盘
    do: key
    key: "cmd+s"
    gapMs: 400
    expect:
      - label: 盘上全文 = 单个源字节插入（尾随对齐空白与管道原样保留）
        file:
          path: table.md
          changedSince: 表格基线
          exact: |
            ---
            title: 表格场景
            ---

            # 表格场景

            短表：

            | 名称 | 状态 |
            |------|------|
            | 甲q | 正常 |
            | 乙 | 停用 |

            中间段落，把两张表隔开。

            含公式的 cell：

            | 左列 | 右列 |
            |------|------|
            | 行内 $y$ | 块级 $$y$$ |

            宽表（超栏宽）：

            | 编号 | 名称 | 状态 | 备注一 | 备注二 | 备注三 | 备注四 | 备注五 | 备注六 |
            |------|------|------|--------|--------|--------|--------|--------|--------|
            | 一 | 甲 | 正常 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 |
            | 二 | 乙 | 停用 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 |
      - label: dirty 已收窄
        ax: { not: "（未保存）" }
  - name: 记录保存后的基线 A
    do: record
    file: table.md
    as: 保存基线A
  - name: 一次撤销回到键入前
    do: key
    key: "cmd+z"
    gapMs: 300
    expect:
      - label: 渲染态 cell 回到「甲」
        editor: { not: "甲q" }
      - label: 撤销不写盘（sha256 + mtime 双比，基线取保存后的那一份）
        file: { path: table.md, unchangedSince: 保存基线A, mtimeUnchangedSince: 保存基线A }

  # witness B：数据 cell 内容首缘 Backspace。M842 现场：WebKit 把首缘对齐空白当块边界，
  # 删除 range 从上一行可见文本尾跨过隐藏管道 / 换行 / 分隔行（毁表）。合同只删前一个源字节。
  - name: ⌃B 从内容右缘退到内容左缘（真键盘事件通道）
    do: key
    key: "ctrl+b"
    channel: cgevent
    gapMs: 150
  - name: Backspace 只删前一个源字节（cell 首缘的对齐空白）
    do: key
    key: "backspace"
    gapMs: 250
    expect:
      - label: grid 表仍在（没有跨过隐藏管道 / 分隔行）
        ax: { has: "AXTable (Markdown 表格 1)" }
      - label: cell 内容未被改写
        editor: { has: "甲" }
  - name: ⌘S 落盘
    do: key
    key: "cmd+s"
    gapMs: 400
    expect:
      - label: 盘上全文 = 只删了首缘那一个空格（管道与其余行原样）
        file:
          path: table.md
          changedSince: 保存基线A
          exact: |
            ---
            title: 表格场景
            ---

            # 表格场景

            短表：

            | 名称 | 状态 |
            |------|------|
            |甲 | 正常 |
            | 乙 | 停用 |

            中间段落，把两张表隔开。

            含公式的 cell：

            | 左列 | 右列 |
            |------|------|
            | 行内 $y$ | 块级 $$y$$ |

            宽表（超栏宽）：

            | 编号 | 名称 | 状态 | 备注一 | 备注二 | 备注三 | 备注四 | 备注五 | 备注六 |
            |------|------|------|--------|--------|--------|--------|--------|--------|
            | 一 | 甲 | 正常 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 |
            | 二 | 乙 | 停用 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 |
  - name: 记录保存后的基线 B
    do: record
    file: table.md
    as: 保存基线B
  - name: 一次撤销
    do: key
    key: "cmd+z"
    gapMs: 300
    expect:
      - label: 盘上保持已保存内容
        file: { path: table.md, unchangedSince: 保存基线B, mtimeUnchangedSince: 保存基线B }

  # witness C：数据 cell 内容尾缘 Delete。M842 现场：WebKit 把删除 range 跨进下一 cell，
  # 删掉隐藏管道与下一 cell 的首缘空白（`| c d |`）。合同只删后一个源字节。
  - name: ⌃E 回内容右缘
    do: key
    key: "ctrl+e"
    channel: cgevent
    gapMs: 150
  - name: forward Delete 只删后一个源字节（cell 尾缘的对齐空白）
    do: key
    key: "forwarddelete"
    gapMs: 250
    expect:
      - label: grid 表仍在（没有删掉隐藏管道）
        ax: { has: "AXTable (Markdown 表格 1)" }
      - label: cell 内容未被改写
        editor: { has: "甲" }
  - name: ⌘S 落盘
    do: key
    key: "cmd+s"
    gapMs: 400
    expect:
      - label: 盘上全文 = 只删了尾缘那一个空格（管道与其余行原样）
        file:
          path: table.md
          changedSince: 保存基线B
          exact: |
            ---
            title: 表格场景
            ---

            # 表格场景

            短表：

            | 名称 | 状态 |
            |------|------|
            | 甲| 正常 |
            | 乙 | 停用 |

            中间段落，把两张表隔开。

            含公式的 cell：

            | 左列 | 右列 |
            |------|------|
            | 行内 $y$ | 块级 $$y$$ |

            宽表（超栏宽）：

            | 编号 | 名称 | 状态 | 备注一 | 备注二 | 备注三 | 备注四 | 备注五 | 备注六 |
            |------|------|------|--------|--------|--------|--------|--------|--------|
            | 一 | 甲 | 正常 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 |
            | 二 | 乙 | 停用 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 |
  - name: 记录保存后的基线 C
    do: record
    file: table.md
    as: 保存基线C
  - name: 一次撤销
    do: key
    key: "cmd+z"
    gapMs: 300
    expect:
      - label: 盘上保持已保存内容
        file: { path: table.md, unchangedSince: 保存基线C, mtimeUnchangedSince: 保存基线C }

  # witness D：表头 cell 对照（原生路径本来正确；闸门命中后结果必须与数据 cell 同合同）。
  - name: ↑ 到表头行
    do: key
    key: "up"
    gapMs: 200
  - name: ⌃A 到表头行行首
    do: key
    key: "ctrl+a"
    channel: cgevent
    gapMs: 150
  - name: ⌃E 到表头首 cell 内容右缘
    do: key
    key: "ctrl+e"
    channel: cgevent
    gapMs: 150
  - name: 键入 q
    do: keys
    keys: ["q"]
    gapMs: 150
    expect:
      - label: 字符插在表头 cell 内容里（渲染态可见）
        editor: { has: "名称q" }
  - name: ⌘S 落盘
    do: key
    key: "cmd+s"
    gapMs: 400
    expect:
      - label: 盘上全文 = 表头单个源字节插入（对照数据 cell 同合同）
        file:
          path: table.md
          changedSince: 保存基线C
          exact: |
            ---
            title: 表格场景
            ---

            # 表格场景

            短表：

            | 名称q | 状态 |
            |------|------|
            | 甲 | 正常 |
            | 乙 | 停用 |

            中间段落，把两张表隔开。

            含公式的 cell：

            | 左列 | 右列 |
            |------|------|
            | 行内 $y$ | 块级 $$y$$ |

            宽表（超栏宽）：

            | 编号 | 名称 | 状态 | 备注一 | 备注二 | 备注三 | 备注四 | 备注五 | 备注六 |
            |------|------|------|--------|--------|--------|--------|--------|--------|
            | 一 | 甲 | 正常 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 |
            | 二 | 乙 | 停用 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 | 说明说明说明 |
      - label: dirty 已收窄
        ax: { not: "（未保存）" }
  - name: 记录表头保存后的基线
    do: record
    file: table.md
    as: 保存基线D
  - name: 一次撤销回到表头键入前
    do: key
    key: "cmd+z"
    gapMs: 300
    expect:
      - label: 表头 cell 回到「名称」
        editor: { not: "名称q" }
      - label: 撤销不写盘
        file: { path: table.md, unchangedSince: 保存基线D, mtimeUnchangedSince: 保存基线D }
---

# 265 — WebKit 表格 cell 端点编辑（M855）

真机 witness 只放四格代表（与 `tests/visual/scenes/markdown-editing-stability.spec.ts` 的
表格编辑对抗组同合同；矩阵负责 chromium + WebKit 的全位置覆盖，本场景负责真实 WKWebView
的入口与落盘）：

1. **数据 cell 内容尾缘键入**：⌃A（行首）→ ⌃E（首 cell 内容右缘）→ 键入 `q` ⇒
   盘上必须是 `| 甲q | 正常 |`——cell 尾部的对齐空白与管道逐字节保留。
2. **数据 cell 内容首缘 Backspace**：⌃B 退到内容左缘（内容右缘的前一个源字节）⇒
   盘上必须是 `|甲 | 正常 |`——只删首缘那一个空格，不得跨过隐藏管道 / 换行 / 分隔行。
3. **数据 cell 内容尾缘 Delete**：⌃E 回内容右缘 → forward Delete ⇒ 盘上必须是
   `| 甲| 正常 |`——只删尾缘那一个空格，不得跨进下一 cell 删掉隐藏管道。
4. **表头 cell 对照**：↑ 到表头行 → ⌃A → ⌃E → 键入 `q` ⇒ 盘上必须是
   `| 名称q | 状态 |`（原生路径本来就正确，闸门命中后结果必须逐字节相同）。

每格都在 ⌘S 后用 `file.exact` 判**整篇全文**（AX 不是 raw doc oracle：渲染态只显示 cell
文本，看不出对齐空白 / 管道是否被改写），并各做一次 `⌘Z` + `unchangedSince` +
`mtimeUnchangedSince` 的「撤销不写盘」判据。

## 判据边界（如实声明）

- **caret 落点不可回读**：KimiCU 的 AX 输出不暴露光标 / 选区，因此落点靠应用自己的
  命令归一到「首 cell 内容右缘」（⌃A 行首 → ⌃E cell 内容右缘；M168/M185 的落点口径），
  再用 `file.exact` 反证落点是否如预期——落点偏了会写成别的字节，断言如实判红。
- **列位置无关**：点击只负责把 caret 送进第一张表的数据行；⌃A 按行归一，列由 ⌃E 归一，
  因此不依赖 AXTable bbox 的像素比例落在哪一列。
- **未跑不得记 PASS**：本场景新增时真机窗口未分配，执行记录留待 tower 串行安排后补；
  证据落 `.local/acceptance/<日期>/`（git 外），跑法 `node scripts/acceptance/run.mjs 265`。
- **选区删除不在此场景**：非空选区删除归 finding `20261119-worker-markdown-stability-bug-dom`
  的通用修复（M854，场景 266）；本场景只判折叠光标的键入与单字符删除。
