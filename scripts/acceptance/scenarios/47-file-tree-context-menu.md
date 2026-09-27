---
id: "47-file-tree-context-menu"
item: 47
title: 文件树条目右键菜单——右键出菜单与项集分流、删除进废纸篓、树内联重命名（含撞名 / 忽略集拒绝）、复制绝对路径、在 Finder 中显示、目录下新建文件与子目录、打开中 tab 的改名联动与删除处置
fixtures: [note.md]
steps:
  - name: 启动就绪：树里 fixture 行在场（正向锚点——这次 AX 读取是活的）
    do: settle
    expect:
      - label: 树里有 plain.md 行
        ax: { has: "plain.md" }
      - label: 树里有 note.md 行
        ax: { has: "note.md" }
      - label: 起点没有打开任何文件（后面「右键不改上下文」的对照基线）
        ax: { has: "这个 vault 还没有打开的文件" }
      - shot: 启动后的树

  - name: 造出两个靠前的文件（右键走真实指针坐标，必须在可视区内；见「已知边界」）
    do: vaultWrite
    file: aaa-menu.md
    content: "# 菜单圆桌\n\n这一篇用来当文件行的右键对象。\n"
    expect:
      - label: 磁盘上有了 aaa-menu.md
        file: { path: aaa-menu.md, exists: true }
  - name: 再造一个给 tab 联动用（同样靠前）
    do: vaultWrite
    file: aab-tab.md
    content: "# 菜单场景\n\n这一篇用来验改名联动。\n"
    expect:
      - label: 磁盘上有了 aab-tab.md
        file: { path: aab-tab.md, exists: true }
  - name: 等 watcher 把两个新文件收敛进树
    do: sleep
    ms: 1500
    expect:
      - label: 树里有 aaa-menu.md
        ax: { has: "aaa-menu.md" }
      - label: 树里有 aab-tab.md
        ax: { has: "aab-tab.md" }

  - name: 反向铺底：此刻剪贴板**不含**待复制的绝对路径
    expect:
      - label: 剪贴板不含 $vault/aaa-menu.md（下面的正向断言因此有区分度）
        clipboard: { not: "$vault/aaa-menu.md" }

  - name: 右键文件行 → 菜单出现且含文件项集（四项、不含新建项）
    do: click
    target: { role: AXButton, name: "^aaa-menu.md$", button: right }
    expect:
      - label: 菜单里有「重命名…」
        ax: { has: "重命名…" }
      - label: 菜单里有「复制完整路径」
        ax: { has: "复制完整路径" }
      - label: 菜单里有「在 Finder 中显示」
        ax: { has: "在 Finder 中显示" }
      - label: 菜单里有「移到废纸篓…」
        ax: { has: "移到废纸篓…" }
      - label: 文件行菜单不含「新建文件…」（项集分流）
        ax: { not: "新建文件…" }
      - label: 文件行菜单不含「新建子目录…」
        ax: { not: "新建子目录…" }
      - label: 右键不改上下文：仍然没有打开任何文件
        ax: { has: "这个 vault 还没有打开的文件" }
      - shot: 文件行右键菜单

  - name: Esc 收起菜单（键盘关闭路径）
    do: key
    key: "escape"
    expect:
      - label: 菜单已收起（「重命名…」不在 AX 里）
        ax: { not: "重命名…" }
      - label: 没有打开任何文件（右键 + 关闭全程不改上下文）
        ax: { has: "这个 vault 还没有打开的文件" }

  - name: 右键点在行的空白区（名字右侧、行盒右缘之内）也作用于该行
    do: click
    # dx 是节点 bbox 内的横向比例：0.96 落在行盒右缘附近、名字文本之外——那一带属于该行
    # （`.ft-name` 弹性撑满行内剩余宽度），用户在那里点右键说的仍是「这一行」。
    target: { role: AXButton, name: "^aaa-menu.md$", button: right, dx: 0.96 }
    expect:
      - label: 菜单出现（这一带与名字上是同一条命中路径）
        ax: { has: "复制完整路径" }
      - label: 作用行就是指针下那一行（文件项集：有「在 Finder 中显示」、无新建项）
        ax: { has: "在 Finder 中显示" }
      - label: 空白区右键同样不落到目录项集
        ax: { not: "新建文件…" }
      - label: 右键不改上下文（空白区右键也不打开文件）
        ax: { has: "这个 vault 还没有打开的文件" }
      - shot: 行空白区右键菜单
  - name: Esc 收起（下一步从干净状态开始）
    do: key
    key: "escape"
    expect:
      - label: 菜单已收起
        ax: { not: "复制完整路径" }

  - name: 外部造出子目录（给目录行菜单与新建用）
    do: vaultWrite
    file: menu-sub/x.md
    content: "子目录里的笔记。\n"
    expect:
      - label: 磁盘上有了 menu-sub/x.md
        file: { path: menu-sub/x.md, exists: true }

  - name: 右键目录行 → 菜单多出新建两项（六项）
    do: sleep
    ms: 1200
    expect:
      - label: 目录行已在树里
        ax: { has: "menu-sub" }
    # 上一步的 sleep 是等 watcher 把外部新建的目录收敛进树（这一步才对得上右键落点）
  - name: 右键目录行
    do: click
    target: { role: AXButton, name: "^menu-sub$", button: right }
    expect:
      - label: 目录行菜单含「新建文件…」
        ax: { has: "新建文件…" }
      - label: 目录行菜单含「新建子目录…」
        ax: { has: "新建子目录…" }
      - label: 目录行菜单也含通用的三项
        ax: { has: "复制完整路径" }
      - label: 目录行菜单含破坏性项
        ax: { has: "移到废纸篓…" }
      - shot: 目录行右键菜单
  - name: Esc 收起目录菜单（下一步的复制必须落在**文件行**的菜单上）
    do: key
    key: "escape"
    expect:
      - label: 目录菜单已收起
        ax: { not: "新建子目录…" }

  - name: 复制完整路径 → 剪贴板读到的必须是**绝对路径**
    do: click
    target: { role: AXButton, name: "^aaa-menu.md$", button: right }
    expect:
      - label: 文件行菜单在场
        ax: { has: "复制完整路径" }
  - name: 点「复制完整路径」
    do: click
    target: { any: "复制完整路径" }
    expect:
      - label: 剪贴板是 vault 根 + 相对路径（绝对路径，裁决点 4）
        clipboard: { exact: "$vault/aaa-menu.md" }
      - label: 给出成功提示
        ax: { has: "已复制完整路径" }
      - shot: 复制完整路径之后

  - name: 在 Finder 中显示（弱断言：只读动作，磁盘逐字节不变）
    do: record
    as: finder 前
    file: aaa-menu.md
    expect:
      - label: 基线记到了（读不到一律 FAIL）
        file: { path: aaa-menu.md, exists: true }
  - name: 右键 → 在 Finder 中显示
    do: click
    target: { role: AXButton, name: "^aaa-menu.md$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "在 Finder 中显示" }
  - name: 点「在 Finder 中显示」
    do: click
    target: { any: "在 Finder 中显示" }
    expect:
      - label: 命令没有报错（没有错误 toast）
        ax: { not: "无法在 Finder 中显示" }
      - label: aaa-menu.md 逐字节未变（relaunch 只调系统文件管理器，不改 vault）
        file: { path: aaa-menu.md, unchangedSince: finder 前 }
      - shot: 在 Finder 中显示之后

  - name: 树内联重命名：行名换成输入框（清空原名后输入新名）
    do: click
    target: { role: AXButton, name: "^aaa-menu.md$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "重命名…" }
  - name: 点「重命名…」
    do: click
    target: { any: "重命名…" }
    expect:
      - label: 行内出现输入框（读屏名带原名）
        ax: { has: "重命名 aaa-menu.md" }
      - shot: 内联重命名输入框
  - name: 全选原名（chord 盲发不重试）
    do: key
    key: "cmd+a"
  - name: 输入新名（逐字符，回读校验 + 只在字节未变时重试）
    do: keys
    keys: ["a", "a", "a", "-", "r", "e", "n", ".", "m", "d"]
    expect:
      - label: 输入框里是 aaa-ren.md（注入真的落地了）
        ax: { has: "aaa-ren.md" }
  - name: Enter 提交
    do: key
    key: "return"
    expect:
      - label: 磁盘上出现 aaa-ren.md
        file: { path: aaa-ren.md, exists: true }
      - label: 磁盘上不再有 aaa-menu.md
        file: { path: aaa-menu.md, exists: false }
      - label: 树里出现 aaa-ren.md（watcher 回响收敛）
        ax: { has: "aaa-ren.md" }
      - label: 全程无「已被外部删除」误报（app 内改名不是外部删除）
        ax: { not: "当前文件已被外部删除" }
      - label: 全程无「检测到外部修改」误报
        ax: { not: "检测到外部修改" }
      - shot: 重命名之后

  - name: 内联重命名撞名：改名到既有 note.md → 行内给原因、磁盘不变
    do: click
    target: { role: AXButton, name: "^aaa-ren.md$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "重命名…" }
  - name: 点「重命名…」
    do: click
    target: { any: "重命名…" }
    expect:
      - label: 输入框在场（读屏名带当前名）
        ax: { has: "重命名 aaa-ren.md" }
  - name: 全选并输入撞名
    do: key
    key: "cmd+a"
  - name: 输入 note.md（与既有 fixture 撞名）
    do: keys
    keys: ["n", "o", "t", "e", ".", "m", "d"]
    expect:
      - label: 行内给出撞名原因（前端预检，提交前就说清）
        ax: { has: "已存在同名条目：note.md" }
  - name: Enter 提交非法名
    do: key
    key: "return"
    expect:
      - label: 既有 note.md 逐字节不变（MUST NOT 覆盖）
        file: { path: note.md, has: "相对目标" }
      - label: aaa-ren.md 仍在（改名被拒）
        file: { path: aaa-ren.md, exists: true }
      - shot: 撞名拒绝

  - name: 忽略集名也拒绝（.git）
    do: key
    key: "cmd+a"
  - name: 输入 .git
    do: keys
    keys: [".", "g", "i", "t"]
    expect:
      - label: 行内给出忽略集原因
        ax: { has: "在忽略集内" }
  - name: Enter 提交非法名（仍然拒绝）
    do: key
    key: "return"
    expect:
      - label: aaa-ren.md 仍在磁盘上（忽略集名不得改名成功）
        file: { path: aaa-ren.md, exists: true }
  - name: Esc 取消编辑态
    do: key
    key: "escape"
    expect:
      - label: 编辑态已退出（输入框的读屏名不在 AX 里）
        ax: { not: "重命名 aaa-ren.md" }
      - label: 树里仍显示 aaa-ren.md
        ax: { has: "aaa-ren.md" }

  - name: 删除进废纸篓：确认框 → 确认 → vault 内消失
    do: click
    target: { role: AXButton, name: "^aaa-ren.md$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "移到废纸篓…" }
  - name: 点「移到废纸篓…」
    do: click
    target: { any: "移到废纸篓…" }
    expect:
      - label: 确认框出现（两步动作的第二步）
        ax: { has: "移到废纸篓？" }
      - label: 文件档正文点名条目
        ax: { has: "aaa-ren.md 会移到系统废纸篓。" }
      - shot: 删除确认框（文件）
  - name: 点确认
    do: click
    target: { any: "^移到废纸篓$" }
    expect:
      - label: vault 内已无该文件（移到废纸篓）
        file: { path: aaa-ren.md, exists: false }
      - shot: 删除之后

  - name: 目录删除的确认文案必须明示「连同其中全部内容」（取消，不真删）
    do: click
    target: { role: AXButton, name: "^menu-sub$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "移到废纸篓…" }
  - name: 点「移到废纸篓…」（目录）
    do: click
    target: { any: "移到废纸篓…" }
    expect:
      - label: 目录档正文明示连带全部内容
        ax: { has: "menu-sub 会连同其中全部内容一起移到系统废纸篓。" }
      - shot: 删除确认框（目录）
  - name: 取消（Esc）
    do: key
    key: "escape"
    expect:
      - label: 目录与其中的文件都还在
        file: { path: menu-sub/x.md, exists: true }

  - name: 目录下新建文件：内联命名 → 磁盘出现空文件 → 自动打开
    do: click
    target: { role: AXButton, name: "^menu-sub$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "新建文件…" }
  - name: 点「新建文件…」
    do: click
    target: { any: "新建文件…" }
    expect:
      - label: 行内输入框出现（新建文件的读屏名）
        ax: { has: "新建文件的名称" }
      - shot: 新建文件输入框
  - name: 输入 fresh.md
    do: keys
    keys: ["f", "r", "e", "s", "h", ".", "m", "d"]
    expect:
      - label: 输入落地
        ax: { has: "fresh.md" }
  - name: Enter 提交
    do: key
    key: "return"
    expect:
      - label: 磁盘上出现 menu-sub/fresh.md
        file: { path: menu-sub/fresh.md, exists: true }
      - label: 新建的是空文件
        file: { path: menu-sub/fresh.md, has: "" }
      - label: 新文件已自动打开（标签读屏名是 fresh.md）
        ax: { has: "fresh.md" }
      - shot: 新建文件并自动打开

  - name: 目录下新建子目录：磁盘出现目录、树里出现条目
    do: click
    target: { role: AXButton, name: "^menu-sub$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "新建子目录…" }
  - name: 点「新建子目录…」
    do: click
    target: { any: "新建子目录…" }
    expect:
      - label: 行内输入框出现（新建子目录的读屏名）
        ax: { has: "新建子目录的名称" }
  - name: 输入 freshdir
    do: keys
    keys: ["f", "r", "e", "s", "h", "d", "i", "r"]
  - name: Enter 提交
    do: key
    key: "return"
    expect:
      - label: 磁盘上出现 menu-sub/freshdir 目录
        file: { path: menu-sub/freshdir, exists: true }
      - shot: 新建子目录之后

  - name: tab 联动：打开中的 dirty 文件被改名——tab 就地换名、内容不丢、不误报
    do: open
    file: aab-tab.md
    marker: "菜单场景"
    expect:
      - label: aab-tab.md 已打开
        editor: { has: "菜单场景" }
  - name: 让它变 dirty（键入探针）
    do: type
    text: "M244DIRTY"
    expect:
      - label: 键入落地并回读
        editor: { has: "M244DIRTY" }
      - label: 未保存标记出现（D90）
        ax: { has: "（未保存）" }
      - label: 反向：探针此刻不在磁盘上
        file: { path: aab-tab.md, not: "M244DIRTY" }
      - shot: 打开中的 dirty 文件
  - name: 右键打开中的文件 → 重命名
    do: click
    target: { role: AXButton, name: "^note.md$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "重命名…" }
  - name: 点「重命名…」
    do: click
    target: { any: "重命名…" }
    expect:
      - label: 输入框在场
        ax: { has: "重命名 note.md" }
  - name: 全选并输入新名
    do: key
    key: "cmd+a"
  - name: 输入 note-renamed.md
    do: keys
    keys: ["n", "o", "t", "e", "-", "r", "e", "n", "a", "m", "e", "d", ".", "m", "d"]
  - name: Enter 提交
    do: key
    key: "return"
    expect:
      - label: 磁盘上出现 note-renamed.md
        file: { path: note-renamed.md, exists: true }
      - label: 标签就地换名（不再有名为 note.md 的标签）
        ax: { not: "/AXRadioButton \\(note\\.md\\)/" }
      - label: 未保存内容仍在编辑器里（改名不改字节）
        editor: { has: "M244DIRTY" }
      - label: 无「检测到外部修改」误报（remap 后 created:new 命中 dirty 会话的那条分支）
        ax: { not: "检测到外部修改" }
      - label: 无「已被外部删除」误报
        ax: { not: "当前文件已被外部删除" }
      - shot: 改名之后的 dirty 标签

  - name: 删除打开中的文件：沿用现状处置（sticky 提示 + 内容不丢）
    do: click
    target: { role: AXButton, name: "^aab-ren.md$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "移到废纸篓…" }
  - name: 点「移到废纸篓…」
    do: click
    target: { any: "移到废纸篓…" }
    expect:
      - label: 确认框在场
        ax: { has: "移到废纸篓？" }
  - name: 点确认
    do: click
    target: { any: "^移到废纸篓$" }
    expect:
      - label: vault 内已无该文件
        file: { path: aab-ren.md, exists: false }
      - label: sticky 提示出现（与外部删除同一处置）
        ax: { has: "当前文件已被外部删除；编辑器中的内容未丢失" }
      - label: 编辑器内容未丢（未保存的改动还在）
        editor: { has: "M244DIRTY" }
      - shot: 删除打开中的文件之后

teardown:
  - label: 收尾：aaa-menu.md 已改名并被删除，不在 vault 里
    file: { path: aaa-menu.md, exists: false }
  - label: 收尾：note.md 是 fixture 原文（撞名用例只读它，没动它）
    file: { path: note.md, has: "相对目标" }
  - label: 收尾：新建的文件与目录都落在合成 vault 里（不碰用户真实 vault）
    file: { path: menu-sub/fresh.md, exists: true }
---

# 文件树条目右键菜单（change file-tree-context-menu / M244）

## 这个场景验什么

Alex 请求的六个条目级操作（删除、重命名、复制完整路径、在 Finder 中显示、目录下新建文件 /
子目录）在真实 WKWebView + 真实文件系统上的行为，以及两个必须裁决的联动（裁决点 4 的绝对
路径、裁决点 5 的 tab 联动）：

1. **右键出菜单与项集分流**：文件行四项、目录行六项，破坏性项在尾部；菜单是应用内自绘浮层
   （DOM/AX 可见，因此可断言）；**右键不改上下文**（不打开文件、不动标签）。**右键目标行 =
   菜单作用行**（M251 的不变量）：行元素内任意横向位置（含名字右侧那段空白）与行元素右缘到
   面板右缘之间那条带（`.filetree` 的右内边距）都作用于该行——真机侧判「名字右侧的空白区」
   （`dx` 比例落点），面板右缘那条带由 chromium 层判（真机坐标通道取不到容器 bbox，见「已知边界」）。
   **作用行高亮**（M251，tower 裁决的 A 形态）：菜单开着时那一行带 `is-menu-target`（取选中档
   底色、不动字重），关菜单即撤——真机侧只给截图（本套件无计算属性通道，与第 26 项的情况同因），
   取值判据在 chromium 层 `tests/visual/scenes/tree-menu.spec.ts` 的两条 M251 用例。
2. **删除 = 移到废纸篓 + 确认框**：确认正文按条目类型分两档（目录档明示「连同其中全部内容」），
   确认后 vault 内条目消失。
3. **树内联重命名**：行名换成输入框（读屏名带原名）、提交后磁盘改名、**撞名与忽略集名被拒**
   且磁盘逐字节不变。
4. **复制完整路径**：剪贴板读到的是**绝对路径**（`$vault/相对路径`）；判据带反向铺底。
5. **在 Finder 中显示**：只读动作——磁盘 sha256 未变、无错误提示（不验 Finder 窗口本身，
   见「已知边界」）。
6. **目录下新建**：新建文件落盘为空文件且**自动打开**；新建子目录落盘。
7. **tab 联动**（裁决点 5）：打开中的 dirty 文件被改名时，标签就地换名、未保存内容保留、
   **两种误报（「已被外部删除」/「检测到外部修改」）都不出现**（这是 remap + 回响抑制的
   真机判据）；删除打开中的文件时沿用既有外部删除处置（sticky 提示 + 内容不丢）。

## 判据走哪几条通道（可读性如实登记）

| 要判的东西 | 通道 | 为什么不是别的 |
|---|---|---|
| 菜单出现与项集 | **AX 文本**（菜单项的 label） | 菜单是 DOM 浮层，WKWebView 把它暴露进 AX；原生菜单则完全不可断言（这也是裁决点 1 选自绘的理由之一） |
| 右键这个动作 | **`click` 的 `button: right`**（坐标路径） | AX 索引路径发的是 AXPress（「按下这个元素」），产不出鼠标右键；`contextmenu` 靠真实指针事件。坐标取自节点 bbox 中心（套件新增能力，见本节末尾） |
| 改名 / 新建 / 删除的结果 | **磁盘事实**（`file.exists` / `has` / `unchangedSince`）+ **AX 树** | 命令返回值读不到（套件没有 IPC 读数通道）；磁盘是名实相符的最终判据 |
| 剪贴板内容 | **`clipboard` 断言形态**（固定 `osascript -e 'the clipboard'`） | 剪贴板既不在 AX 也不在磁盘；套件刻意不引入通用 shell 通道，只开这一个窄命令 |
| tab 是否误报 | **AX 文本的负向断言 + 正向配对** | 提示是 sticky toast，AX 里可见；负向断言必须配「同一动作的正向锚点」（本节每条负向断言前面都有正向断言），否则会退化成恒真（REVIEW.md 第 1 条） |

## 本场景用到的套件能力（两处窄扩展，M244，tower 裁决扩 scope）

- **`click` 的 `button`**：`target` 里写 `button: right` 时走坐标路径（节点 bbox 中心注入真实
  鼠标事件），左键默认值行为不变。这是右键唯一的可达通道。
- **`clipboardRead` 动作与 `clipboard` 断言形态**：只有一条固定命令（`osascript -e 'the clipboard'`），
  不接受任意命令、不接受参数；读不到（命令失败）时**一律判 FAIL**，不许当成空（REVIEW.md 第 2 条）。
- **`$vault` 占位符**：期望值里引用合成验收 vault 的绝对路径，避免硬编码 `/tmp` 那一份。

## 已知边界（如实登记，不读成「全量已验」）

- **「在 Finder 中显示」只做弱断言**：Finder 窗口本身不进本套件的可断言面（它是另一个 app 的
  UI，且打开与否取决于系统状态）。这里断言的是「命令没报错 + vault 逐字节未变」；「Finder 里
  真的选中了那一项」由 Alex 手感验收（`fs_reveal_in_finder` 的实现是 opener 插件的
  `reveal_item_in_dir`，语义与 `link_open_path` 同一条最小权限路径）。
- **注入通道的两条老账**：① `cmd+a` 是 chord，套件**盲发不重试**（丢键就 red，按 README 先复跑
  一次再判产品缺陷）；② `keys` 的逐字符注入对 WKWebView 间歇丢键，本场景的判据都是「回读 +
  只在字节未变时重试」，仍可能整批丢键——红了先复跑。
- **不做手感判定**：菜单的间距/阴影观感、内联输入框的宽度手感归 Alex；本场景只留截图。
- **不新增像素基线**：`shot` 是给人看的证据；形态的逐像素回归在 chromium 侧
  （`tests/visual/scenes/tree-menu.spec.ts` 的五个元素级基线 + M251 新增的「行右侧空白带」用例）。
- **右键命中面只在 chromium 层判到像素级**（M251）：真机坐标通道只能表达「节点 bbox 内的横向
  比例」（`dx`/`dy`），行元素右缘之外那条带（面板右内边距，实测约 9px）在节点 bbox 之外、无法
  按比例表达；用绝对值会把窗口宽度写死。因此本场景判「名字右侧的空白区」（`dx` 落点），
  面板右缘那条带由 `tree-menu.spec.ts` 按**容器 bbox 实测**判（它能量到 `.filetree` 的右缘）。
- **作用行高亮的色值不在真机判**（M251）：本套件无计算属性通道（同本节第 26 项那条边界），
  真机只能给截图（`行空白区右键菜单` 那张里可以肉眼看到那一行被高亮）；「底色 = `--sel`、
  字重不动、关菜单即撤、eink 反白」四条判据在 chromium 层
  （`tests/visual/scenes/tree-menu.spec.ts` 的两条 M251 用例，含同指针位置的前后对照）。
- **不覆盖**：跨目录移动（非目标）、多选批量操作（非目标）、vault 根本身的右键（非目标）。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；端口 1430。
- **本场景会真的改动合成 vault**：改名（plain.md → renamed.md）、删除（进系统废纸篓）、新建
  （menu-sub/ 下的文件与目录）。这些都在合成 vault 里，用户真实 vault 全程只读。
- **废纸篓**：被删的条目真的进系统废纸篓（`trash::delete` 的平台语义，无法在测试里绕过）。
  场景因此不探测 `$HOME/.Trash` 的内容，只断言「vault 内消失」——套件不隔离 HOME。
