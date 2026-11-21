---
# change fix-quick-open-select-all-directory-children-nov21 的真机判据：输入框内 ⌘A 全选 +
# 目录语境的直接子级提示 / 筛选。与 230a–230c 共用 item 655（`run.mjs 230` 按 id 前缀选中）。
#
# 为什么这条判据只能在真机层：
#   1. `⌘A` 是否被 WKWebView / 原生菜单 / 键位层截走只有真机按键能答（chromium 里原生 select-all
#      本来就能用，夹具层的 defaultPrevented 只判「有没有显式接管」）。
#   2. 目录语境的提示行与候选收窄是 AX 可见文本 + 真索引的联合读数；chromium 场景已覆盖 DOM
#      逐条文本，这里补「真 webview 下同样成立」。
#
# 本组不覆盖：候选的像素宽度与滚动手感（视觉层 / Alex 手感裁决）、深层后代被排除的解析矩阵
# （tests/unit/quick-open.test.ts）。
id: "230d-quick-open-select-all-dir-children"
item: 655
tier: full
title: 按路径快速打开（⌘P）之四：输入框内 ⌘A 全选输入串 / 目录语境只列直接子级文件、深层后代不混入
open: goto-line-long.md
marker: "JUMP-TARGET-39"
config:
  harness:
    provider: mock
steps:
  - name: 造目录语境现场——一个直接子级文件 + 一个深层后代（合成内容）
    do: vaultWrite
    file: qo-dir/直接子项.md
    content: "# 直接子项\n\nDIRECT-CHILD-655-MARKER\n"
  - name: 造深层后代（全路径子串会命中 `qo-dir`，直接子级收窄必须挡住它）
    do: vaultWrite
    file: qo-dir/深层/后代.md
    content: "# 深层后代\n\nDEEP-DESCENDANT-655-MARKER\n"
  - name: 等目录行出现在树里（vault 装载完成）
    do: waitFor
    waitFor:
      has: ["qo-dir"]
    timeoutMs: 15000
  - name: 焦点在编辑器后按 ⌘P
    do: clickEditor
  - name: 打开输入面
    do: keys
    keys: ["cmd+p"]
  - name: 输入目录路径
    do: keys
    keys: ["q", "o", "-", "d", "i", "r"]
    expect:
      - label: 目录路径落进输入框
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\) Value: qo-dir/" }
  - name: 目录语境的结果区
    do: settle
    expect:
      - label: 提示行说明这是目录、只列直接子级文件
        ax: { has: "/qo-dir 是目录 · 直接子级文件 1 条/" }
      - label: 直接子级文件出现在候选里
        ax: { has: "qo-dir/直接子项.md" }
      - label: 深层后代 MUST NOT 混入直接子级结果
        ax: { not: "qo-dir/深层/后代.md" }
      - shot: 01-目录语境直接子级

  - name: 第一次 Enter 只揭示「是目录」，不打开任何文件
    do: key
    key: enter
  - name: 揭示现场
    do: settle
    expect:
      - label: 提示行给出不能打开目录的终态原因
        ax: { has: "/qo-dir 是目录，不能打开/" }
      - label: 直接子级文件尚未打开（标记不在正文里）
        ax: { not: "DIRECT-CHILD-655-MARKER" }
  - name: 第二次 Enter 打开当前游标所在的直接子级候选
    do: key
    key: enter
  - name: 等直接子级文件装载
    do: waitFor
    waitFor:
      has: ["DIRECT-CHILD-655-MARKER"]
    timeoutMs: 15000

  - name: 重新打开输入面，验证 ⌘A 全选输入串
    do: keys
    keys: ["cmd+p"]
  - name: 输入三个字符
    do: keys
    keys: ["a", "b", "c"]
  - name: ⌘A
    do: keys
    keys: ["cmd+a"]
  - name: 键入替换（只有全选成立时 Value 才是单个字符）
    do: keys
    keys: ["z"]
  - name: ⌘A 的行为读数
    do: settle
    expect:
      - label: 输入框的值被整串替换为 `z`（未全选时会得到 `abcz` 或 `zabc`）
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\) Value: z/" }
      - label: 编辑器文档没有被这次 ⌘A 改动（正文仍是刚打开的文件）
        ax: { has: "DIRECT-CHILD-655-MARKER" }
  - name: 收起输入面
    do: key
    key: escape

---
