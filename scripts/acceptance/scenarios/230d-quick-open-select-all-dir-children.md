---
# change fix-quick-open-select-all-directory-children-nov21 的真机判据：输入框内 ⌘A 全选 +
# 目录语境的直接子级提示 / 筛选。与 230a–230c 共用 item 655（`run.mjs 230` 按 id 前缀选中）。
#
# 为什么这条判据只能在真机层：
#   1. `⌘A` 是否被 WKWebView / 原生菜单 / 键位层截走只有真机按键能答（chromium 里原生 select-all
#      本来就能用，夹具层的 defaultPrevented 只判「有没有显式接管」）。本场景的 ⌘A 步 MUST 走
#      `channel: cgevent` 的真键盘事件：KimiCU 的 `cmd+a` 走 AX 全选兼容路径（零键盘事件），
#      会把「应用没接管」判成绿（change fix-text-input-select-all-nov26 的根因现场）。
#   2. 目录语境的提示行与候选收窄是 AX 可见文本 + 真索引的联合读数；chromium 场景已覆盖 DOM
#      逐条文本，这里补「真 webview 下同样成立」。
#
# 本组不覆盖：候选的像素宽度与滚动手感（视觉层 / Alex 手感裁决）、候选高亮行（AX 无稳定读数形态，
# 判在 chromium 的 quick-open-active-target 场景）、深层后代被排除的解析矩阵
# （tests/unit/quick-open.test.ts）。
#
# 候选行的可访问名是**整条显示路径**（视觉上的目录前缀 / 文件名 / 尾 `/` 分段只留布局用途）：
# 「直接子目录以尾斜杠出现在候选里」判的就是这个连续名；「深层后代 MUST NOT 混入」的负向断言
# 也依赖同一形态——可访问名若退回按内容合成，WKWebView 会在段边界插空格
# （实测 `qo-dir/ 深层 /`），正向连续串恒不命中、负向断言则在深后代被列出来时仍会绿。
id: "230d-quick-open-select-all-dir-children"
item: 655
tier: full
title: 按路径快速打开（⌘P）之四：输入框内 ⌘A 全选输入串 / 目录语境只列一层文件与子目录、深层后代不混入
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
      - label: 提示行说明这是目录、直接子项含文件与子目录
        ax: { has: "/qo-dir 是目录 · 直接子项 2 条/" }
      - label: 直接子级文件出现在候选里
        ax: { has: "qo-dir/直接子项.md" }
      - label: 直接子目录以尾斜杠出现在候选里
        ax: { has: "qo-dir/深层/" }
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
  - name: 游标移到直接子级文件（目录排序在文件之前时不得误进入子目录）
    do: key
    key: down
  - name: 第二次 Enter 打开当前游标所在的直接子级文件候选
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
  - name: ⌘A（真实键盘事件——KimiCU 的 cmd+a 走 AX 全选兼容路径，验不到应用的分派）
    do: keys
    keys: ["cmd+a"]
    channel: cgevent
  - name: 键入替换（只有全选成立时 Value 才是单个字符）
    do: keys
    keys: ["z"]
  - name: ⌘A 的行为读数
    do: settle
    expect:
      - label: 输入框的值被整串替换为 `z`（未全选时会得到 `abcz` 或 `zabc`）
        # 值必须**到此为止**：`Value: z` 后面只允许 bbox / actions / focused 或行尾（AX dump 里
        # `Value: …` 的终止形态，见 ax.mjs 的 parseNodes）。不能只判「包含 Value: z」——
        # 那会把全选失效 + 光标在开头时输入的 `zabc` 判成 PASS（review r1 P2-1）。
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\) Value: z(?=[ \\t]*(?:@|actions=|\\(focused\\)|$))/" }
      - label: 编辑器文档没有被这次 ⌘A 改动（正文仍是刚打开的文件）
        ax: { has: "DIRECT-CHILD-655-MARKER" }
  - name: 收起输入面
    do: key
    key: escape

---

本场景判目录语境的两段式（第一次 Enter 只揭示、第二次打开游标行）与 ⌘A 全选；目录语境的候选
高亮仍是「首行起步、移动后 Enter 消费游标行」的既有合同，本场景按 Enter 的实际结果验证它（不读
高亮样式——AX dump 没有稳定读数形态，理由见 230a 的「覆盖边界」）。「高亮行 = Enter 目标」与
「无对应候选时不高亮」的不变量由 chromium 的 `tests/visual/scenes/quick-open-active-target.spec.ts`
钉住。
