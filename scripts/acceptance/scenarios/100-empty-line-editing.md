---
id: "100-empty-line-editing"
item: 100
tier: full
title: 空行编辑三连（M399）+ 末尾空行落字的行盒 / END 稳定性——有内容行行首 Enter 换行且新空行可见、空列表项 Enter 去标记留空行（不新增行）、删空项 marker 后行保留可见、末尾空行输入首字不改文档总高
fixtures: [empty-line-start.md, empty-line-list.md, empty-line-tight-two.md, empty-line-delete-marker.md, empty-line-long-2nl.md, empty-line-long-1nl.md]
open: empty-line-start.md
marker: "行首换行探针行"
config:
  lineNumbers: "on"
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
  # M768 通道审计：⌃A 是应用自己的 `editor.line-start`（Emacs 行首），必须由键位层处理——
  # KimiCU 0.6.8 的 press_key 对 ctrl+a 走 AX 全选兼容路径（零键盘事件），会变成「全选 + Enter
  # 覆写全文」，下一条「原内容行逐字节还在」必红（假红）。channel: cgevent 只接 chord 键，
  # 同一行的 return 仍走 KimiCU。判据一条未动。
  - name: 光标移到行首（⌃A）并按 Enter
    do: keys
    channel: cgevent
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

  # ── 用例 5（change fix-empty-line-height-stability-nov27）：文档末尾空行输入首字——
  # END 标记的包围盒 MUST 逐值不变（旧模型：末行获得 8px 下距，文档总高 +8，END 下移 8px）。
  # fixture 末尾**两个换行**（末行是空行），落字后该行才是「文档末文本行」，正是旧模型的付账点。
  - name: 打开长文 fixture（末尾两个换行）
    do: open
    file: empty-line-long-2nl.md
    marker: "末行稳定探针第 1 段"
  - name: 建立焦点
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: ⌥G 跳到末行（行号 61 是末尾空行，其行首即文档末尾）
    do: key
    key: "alt+g"
    expect:
      - label: goto-line 输入条在场且预填当前行（1）
        ax: { has: '/AXTextField = "1"/' }
      - label: 文档总行数 = 61（fixture 行数，正观测）
        ax: { has: "共 61 行" }
  - name: 键入 61 确认落点
    do: keys
    keys: ["6", "1"]
  - name: 确认跳到末行
    do: key
    key: "return"
    expect:
      - label: 输入条已收起（落点已生效）
        ax: { not: "AXTextField" }
  - name: 再向下翻两屏把 END 标记带进视口（⌃V 只滚不改光标，光标仍在文档末尾）
    do: keys
    keys: ["ctrl+v", "ctrl+v"]
    gapMs: 400
    expect:
      - label: END 标记在场（长文超过一屏；正观测，下一条 geom 才有读数对象）
        ax: { count: { pattern: "AXStaticText = \"END\"", exact: 1 } }
  - name: 记录编辑器几何与磁盘基线（落字前）
    do: record
    file: empty-line-long-2nl.md
    as: 末行落字前
    expect:
      - label: 编辑器 AXTextArea 的宽高基线（bbox 高度 = 文档总高；真机 END 节点没有 bbox，改判这里）
        geom:
          target: { role: AXTextArea, name: "末行稳定探针第 30 段" }
          record: 编辑器落字前
          allowOutside: true
          compare: ["w", "h"]
  - name: 在末尾空行输入首字
    do: type
    text: "ELH5-STABLE"
    expect:
      - label: 字符真的落进文档（区分度：没落字时下一条在其上恒真）
        editor: { has: "ELH5-STABLE" }
      - label: 编辑器 AXTextArea 的宽高逐值不变（旧模型末行 +8px 会让 bbox 高度整除增加，1px 即红）
        geom:
          target: { role: AXTextArea, name: "末行稳定探针第 30 段" }
          unchangedSince: 编辑器落字前
          allowOutside: true
          compare: ["w", "h"]
      - label: END 标记仍在场（截图留证；真机 END 节点无 bbox，不作几何判据）
        ax: { count: { pattern: "AXStaticText = \"END\"", exact: 1 } }
      - label: 没有隐式落盘（正文与磁盘都保持原有内容）
        file: { path: empty-line-long-2nl.md, unchangedSince: 末行落字前 }
      - shot: 末尾空行输入首字后（END 应在原位、行盒不夹带 8px）

  # ── 用例 6：单尾随换行——旧模型的 8px 在「上一段末行」与「末尾空行」之间搬家，END 不动、
  # 但光标所在行的行盒 / active gutter 变高。AX 没有行盒读数通道，这一形态的真机判据是
  # 落字前后两张截图（gutter 已置 on，active 行灰底即行盒高度显示器）；行盒 / gutter 的
  # **逐像素结构判据**在 chromium 场景 empty-line-height-stability-nov27（DOM 精确读数）。
  - name: 打开单尾随换行 fixture
    do: open
    file: empty-line-long-1nl.md
    marker: "末行稳定探针第 1 段"
  - name: 建立焦点并翻到文档末尾
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: ⌥G 跳到末行（行号 60 是末尾空行，其行首即文档末尾）
    do: key
    key: "alt+g"
    expect:
      - label: goto-line 输入条在场（正观测）
        ax: { has: '/AXTextField = "1"/' }
      - label: 文档总行数 = 60（fixture 行数，正观测）
        ax: { has: "共 60 行" }
  - name: 键入 60 确认落点
    do: keys
    keys: ["6", "0"]
  - name: 确认跳到末行并向下翻两屏（⌃V 只滚不改光标）
    do: keys
    keys: ["return", "ctrl+v", "ctrl+v"]
    gapMs: 400
    expect:
      - label: 输入条已收起（落点已生效）
        ax: { not: "AXTextField" }
      - shot: 单尾随换行-落字前（光标行盒 / active gutter 的对照面）
  - name: 输入首字
    do: type
    text: "ELH6-STABLE"
    expect:
      - label: 字符落进文档（正观测）
        editor: { has: "ELH6-STABLE" }
      - shot: 单尾随换行-落字后（光标行盒 / active gutter MUST 与落字前等高）
---

# 100 · 空行编辑三连（M399）+ 末尾空行落字的行盒 / END 稳定性

Alex 报告的三个缺陷（行首 Enter 看似无效 / 空列表项 Enter 后行与光标消失 / 删空项 marker 后行消失）
的真机链路。共享根因在渲染层（空行被压成 0 高），命令层分歧只有 tight 两 item 列表的空第二项；
文档层终态用落盘后的文件内容逐条钉死，「行可见、光标在场」由每步的截图证据承担
（AX 拿不到行级几何，见套件已知边界）。

change `fix-empty-line-height-stability-nov27` 追加用例 5 / 6：普通正文与空行的 8px 段末下距归零后，
文档末尾空行落字 MUST NOT 改变文档总高。

**几何判据的落点（首轮真机修正）**：首轮用 END 标记的 `AXStaticText` 取 bbox，真机实测该节点
**没有 bbox**（证据 `.local/acceptance/2026-11-27-empty-line-height/`：`节点 {"role":"AXStaticText",
"name":"^END$"} 没有 bbox——AX 量不到几何`）。改判**编辑器 `AXTextArea`**：真机 dump 证实其 bbox
高度就是**文档内容总高**（fixture 2nl 为 2689、1nl 为 2646，恰好差一行 43px），且落字前后高度不变、
只有 y 随滚动变化——因此判据是 `geom` 的 `record` / `unchangedSince` 配
`compare: ["w","h"]`（只比宽高，不把滚动当几何变化）与 `allowOutside: true`（元素盒高于视口，
「完整落在视口内」那一段只服务浮层）。`target` 用 `role: AXTextArea` + fixture 文本限定**编辑器**
（composer 是另一个 AXTextArea，用 fixture 文本排除）。

**旧模型红 / 候选绿**：同一量（内容盒高度）在浏览器层有逐像素读数——用例「文档末尾空行输入首字」
与「`a\n` → `a\nx`」在旧模型上输入首字后内容盒 +8px、候选 0（`tests/visual/scenes/
empty-line-height-stability-nov27.spec.ts` 用 `.cm-content` 盒高断言）；真机 `AXTextArea` 的 bbox 高度
按同一定义读数，故旧模型会让 `unchangedSince` 判红、候选绿。END 标记只保留截图与在场性判据。

用例 6 是 END 不动、只有光标行盒 / active gutter 变高的形态——该形态**总高不变**，`AXTextArea`
高度没有区分度，机器判据仍由浏览器层承担；真机以落字前后截图留证（gutter 已置 `on`，active 行
灰底即行盒高度显示器）。
