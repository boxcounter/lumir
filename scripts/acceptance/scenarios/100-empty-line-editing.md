---
id: "100-empty-line-editing"
item: 100
title: 空行编辑三连（M399）——有内容行行首 Enter 换行且新空行可见、空列表项 Enter 去标记留空行（不新增行）、删空项 marker 后行保留可见
fixtures: [empty-line-start.md, empty-line-list.md, empty-line-tight-two.md, empty-line-delete-marker.md]
open: empty-line-start.md
marker: "行首换行探针行"
steps:
  # ── 用例 1（问题 1）：光标在有内容行的行首按 Enter —— 换行发生、新空行插在该行之前且可见
  - name: 起点：单行 fixture 已打开，光标落在第一行
    do: clickEditor
    expect:
      - label: 打开成功
        editor: { has: "行首换行探针行" }
      - label: 起点没有任何空行（下面那条 /^$/ 因此有区分度）
        file: { path: empty-line-start.md, not: '/^$/' }
      - shot: 起点
  - name: 光标移到行首（⌃A）并按 Enter
    do: keys
    keys: ["ctrl+a", "return"]
  - name: 落盘（⌘S 发两次换一次丢键的容错）
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对
    do: sleep
    ms: 1200
    expect:
      - label: 文档以空行开头（行首 Enter 真的在行前插入了空行；用 /^\n/ 而非 /^$/ —— 后者会被落盘尾随换行假绿）
        file: { path: empty-line-start.md, has: '/^\n/' }
      - label: 原内容行逐字节还在
        file: { path: empty-line-start.md, has: "行首换行探针行。" }
      - shot: 行首Enter后-新空行应可见且光标在场

  # ── 用例 2（问题 2，三 item 形态）：空列表项上 Enter —— 去标记、行保留、不新增行
  - name: 打开两 item 列表 fixture，光标移到第二项行尾
    do: open
    file: empty-line-list.md
    marker: "alpha"
  - name: 建立焦点并定位
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 光标到第二项行尾，按 Enter 续出第三项（空 item）
    do: keys
    keys: ["ctrl+n", "ctrl+e", "return"]
  - name: 落盘核对：空 item 已创建（marker-only 行在场，作为下一条 not 的对照）
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 等待落盘
    do: sleep
    ms: 1200
    expect:
      - label: 空第三项已创建（列表续行回归：既有行为不变）
        file: { path: empty-line-list.md, has: '/^- $/' }
      - shot: 空item已创建
  - name: 在空 item 上再按 Enter（裁决：去标记、留空行、光标在行首、不新增行）
    do: key
    key: "return"
  - name: 落盘
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对
    do: sleep
    ms: 1200
    expect:
      - label: marker-only 行已消失（标记被删去）
        file: { path: empty-line-list.md, not: '/^- $/' }
      - label: 文档末行是空行且没有额外新增行（'- bravo\n' 即结尾——若变成 '- bravo\n\n' 或 '- bravo\n- \n' 都不匹配）
        file: { path: empty-line-list.md, has: '/- bravo\n$/' }
      - shot: 空项Enter后-该行应为可见空行且光标在其上

  # ── 用例 3（问题 2，tight 两 item 形态——命令层修复的钉固）：空第二项 Enter 不得把列表「变松」
  - name: 打开 tight 两 item fixture（第二项为空 item），光标到其行尾
    do: open
    file: empty-line-tight-two.md
    marker: "alpha"
  - name: 建立焦点并定位
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 光标到空 item 行尾，按 Enter
    do: keys
    keys: ["ctrl+n", "ctrl+e", "return"]
  - name: 落盘
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对
    do: sleep
    ms: 1200
    expect:
      - label: 空第二项的标记被删去（上游默认的「插空行变松」分支 '- alpha\\n\\n- ' 会保留 '- '，必红）
        file: { path: empty-line-tight-two.md, not: '/- $/' }
      - label: 文档为 '- alpha' + 一个空行结尾（不新增行）
        file: { path: empty-line-tight-two.md, has: '/- alpha\n$/' }
      - shot: tight两item-空项Enter后

  # ── 用例 4（问题 3）：删掉空列表项的行首「-」——行保留为可见空行、光标不消失
  - name: 打开删 marker 专用 fixture（与用例 3 同内容、独立文件，避免串场），光标到空 item 行尾
    do: open
    file: empty-line-delete-marker.md
    marker: "alpha"
  - name: 建立焦点并定位
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 删空 item 的 marker（裸 "-" 行尾一次 backspace：上游 deleteMarkupBackward 把标记换成两个空格——真机实证终态 '- alpha\n  '，行保留即修复形态）
    do: keys
    keys: ["ctrl+n", "ctrl+e", "backspace"]
  - name: 落盘
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对
    do: sleep
    ms: 1200
    expect:
      - label: 行保留：换行符在场（行被合并掉会变成 '- alpha' 无尾换行，必红；行内是空格还是空串不苛求——那是上游缩进保留语义）
        file: { path: empty-line-delete-marker.md, has: '/- alpha\n/' }
      - label: 没有额外空行（'- alpha\n\n' 形态必红）
        file: { path: empty-line-delete-marker.md, not: '/\n\n/' }
      - label: 第二行没有 marker 残留（锚定行首：'- alpha' 自身的 '-' 不算残留）
        file: { path: empty-line-delete-marker.md, not: '/\n-/' }
      - shot: 删marker后-该行应保留为可见空行且光标在场
---

# 100 · 空行编辑三连（M399）

Alex 报告的三个缺陷（行首 Enter 看似无效 / 空列表项 Enter 后行与光标消失 / 删空项 marker 后行消失）
的真机链路。共享根因在渲染层（空行被压成 0 高），命令层分歧只有 tight 两 item 列表的空第二项；
文档层终态用落盘后的文件内容逐条钉死，「行可见、光标在场」由每步的截图证据承担
（AX 拿不到行级几何，见套件已知边界）。
