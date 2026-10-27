---
# 原场景 47（`47-file-tree-context-menu`，M244）拆出的第 4 组（M747）：dirty tab 联动。
# 拆分口径见 47a 的头注释：逐条保留原断言与必要注释、判据一条不放宽、每组自带 fixture 与
# 启动锚点。本组只验「打开中的 dirty 文件被改名 / 被删除」时的标签与内容处置（裁决点 5）；
# 菜单基本行为在 47a、改名与校验在 47b、删除与新建在 47c。
# `node scripts/acceptance/run.mjs 47` 按 **id 前缀**或 item 号选中四组。
id: "47d-dirty-tab-linkage"
item: 47
tier: full
title: 打开中 dirty 文件的改名联动与删除处置：标签就地换名、未保存内容不丢、两种误报都不出现
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

  - name: 造出联动用的靠前文件（右键走真实指针坐标，必须在可视区内；见 47a 正文「已知边界」）
    do: vaultWrite
    file: aab-tab.md
    content: "# 菜单场景\n\n这一篇用来验改名联动。\n"
    expect:
      - label: 磁盘上有了 aab-tab.md
        file: { path: aab-tab.md, exists: true }
  - name: 等 watcher 把新文件收敛进树
    do: sleep
    ms: 1500
    expect:
      - label: 树里有 aab-tab.md
        ax: { has: "aab-tab.md" }

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
  # 右键对象就是上一步打开并改脏的那一个文件（M324 修正）：旧稿曾在这里右键 `note.md`（一个没
  # 打开、也没改动的文件），末步却去删 `aab-ren.md`（这个路径从没被创建过）——三步互相矛盾，且
  # `note.md` 的树行排在字母表靠后、AX 报的内容坐标 y≈1605 落在 768 高的窗口之外，而套件没有
  # 滚动动作（README「已知边界」），右键走真实指针坐标根本点不到它。打开中 + 靠近树顶的
  # `aab-tab.md` 两条都满足。
  - name: 右键打开中的文件 → 重命名
    do: click
    target: { role: AXButton, name: "^aab-tab.md$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "重命名…" }
  - name: 点「重命名…」
    do: click
    target: { any: "重命名…" }
    expect:
      - label: 输入框在场且预填的是当前名
        ax: { has: '/AXTextField = "aab-tab.md" /' }
      - label: 输入框持焦点
        ax: { focused: "AXTextField" }
  # M768 通道审计（保留 AX）：⌘A 打在重命名输入框（原生 `<input>`）上，判据只要求「文本被选中」
  # 让下一条 typeInNode 替换之——理由见本场景第一处 ⌘A 步的注释。
  - name: 全选并输入新名
    do: key
    key: "cmd+a"
  - name: 输入 aabren.md（M507 原子注入）
    do: typeInNode
    target: { role: AXTextField, name: "aab-tab.md|aabren.md" }
    text: "aabren.md"
    expect:
      - label: 输入框里是 aabren.md（注入真的落地了）
        ax: { has: '/AXTextField = "aabren.md" /' }
  - name: Enter 提交
    do: key
    key: "return"
    expect:
      - label: 磁盘上出现 aabren.md
        file: { path: aabren.md, exists: true }
      - label: 磁盘上不再有 aab-tab.md（改名不是复制）
        file: { path: aab-tab.md, exists: false }
  - name: 等改名收敛（树行来自 watcher 回响；下一步要右键的那一行必须先到）
    do: waitFor
    waitFor: { has: ["aabren.md"] }
    expect:
      - label: 标签就地换名成新名（dirty 标签的读屏名带「（未保存）」后缀，故只锚前缀）
        ax: { has: "/AXRadioButton \\(aabren\\.md/" }
      - label: 旧名的标签不再存在（与上一条配对：负向断言旁边必有正观测）
        ax: { not: "/AXRadioButton \\(aab-tab\\.md/" }
      - label: 未保存内容仍在编辑器里（改名不改字节）
        editor: { has: "M244DIRTY" }
      - label: 无「检测到外部修改」误报（remap 后 created:new 命中 dirty 会话的那条分支）
        ax: { not: "检测到外部修改" }
      - label: 无「已被外部删除」误报
        ax: { not: "当前文件已被外部删除" }
      - shot: 改名之后的 dirty 标签

  - name: 删除打开中的文件：沿用现状处置（sticky 提示 + 内容不丢）
    do: click
    target: { role: AXButton, name: "^aabren.md$", button: right }
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
    target: { any: "/^移到废纸篓$/" }
  # 与 47c 那次同样的口径（M355）：确认后等**可观测终态**再读磁盘，不在同一个 tick 里赌删盘已经
  # 回来。这里的终态是 sticky 提示——它本身就是 watcher 的 deleted 回响走完的那一刻才出现的
  #（打开中文件的删除处置），比树行更直接。
  - name: 等外部删除处置落到界面（sticky 提示 = 回响已走完）
    do: waitFor
    waitFor: { has: ["当前文件已被外部删除；编辑器中的内容未丢失"] }
    expect:
      - label: vault 内已无该文件
        file: { path: aabren.md, exists: false }
      - label: sticky 提示出现（与外部删除同一处置）
        ax: { has: "当前文件已被外部删除；编辑器中的内容未丢失" }
      - label: 编辑器内容未丢（未保存的改动还在）
        editor: { has: "M244DIRTY" }
      - shot: 删除打开中的文件之后

teardown:
  - label: 收尾：aab-tab.md 已改名（不在 vault 里）
    file: { path: aab-tab.md, exists: false }
  - label: 收尾：aabren.md 已移到废纸篓（不在 vault 里）
    file: { path: aabren.md, exists: false }
  - label: 收尾：note.md 是 fixture 原文（本组只读它，没动它）
    file: { path: note.md, has: "相对目标" }
---

# 47d —— dirty tab 联动（原场景 47 拆分第 4 组，M747）

## 本组在验什么

原场景 47（change file-tree-context-menu / M244）的裁决点 5：

1. **打开中的 dirty 文件被改名**：标签**就地换名**（旧名标签不再存在）、未保存内容保留、
   **两种误报都不出现**——「当前文件已被外部删除」与「检测到外部修改」（这是 remap + 回响抑制的
   真机判据）。
2. **删除打开中的文件**：沿用既有外部删除处置（sticky 提示「当前文件已被外部删除；编辑器中的
   内容未丢失」+ 内容不丢），磁盘断言等 sticky 提示（回响已走完）再读。

拆分口径（M747）：断言逐条保留、判据一条不放宽；本组自带 fixture 与启动锚点，独立诊断。
同族其余三组：`47a-menu-basics`（菜单基本行为）/ `47b-rename-validation`（改名与校验）/
`47c-create-and-delete`（新建与删除）。四组同属 item 47，`run.mjs 47` 按 id 前缀选中全部。

## 判据通道（本组相关的部分）

| 要判的东西 | 通道 | 为什么不是别的 |
|---|---|---|
| 标签是否就地换名 | **AX 文本**（`AXRadioButton (…)` 的读屏名，dirty 时带「（未保存）」后缀） | 标签栏在 AX 里可见；只锚前缀是为了吸收「（未保存）」后缀 |
| 未保存内容是否保留 | **`editor.has`（AXTextArea.value）** | 内容是最终判据；标签名只证明「哪一行」 |
| 是否误报 | **AX 负向断言 + 正向锚点** | 负向断言必须配同一动作的正向观测（本节每条负向断言前面都有正向断言），否则会退化成恒真（REVIEW.md「断言等价于子串」条） |
| 删盘何时完成 | **`do: waitFor`** 等 sticky 提示 | sticky 提示是 watcher 的 deleted 回响走完那一刻才出现的（比树行更直接，M355） |

## 已知边界（如实登记）

- **1. 右键对象必须是「打开中 + 靠近树顶」的那一个（M324 修正）**：右键走真实指针坐标，目标行
  必须落在窗口可视区内。旧稿曾右键 `note.md`（没打开、也没改动，且树行排在字母表靠后、AX 报的
  内容坐标 y≈1605 落在 768 高的窗口之外——套件没有滚动动作），末步又去删一个从没被创建过的
  `aab-ren.md`，三步互相矛盾。本组用打开中的 `aab-tab.md`，两条都满足。
- **2. 改名 = `deleted:old` + `created:new`**：脏标签的 remap 由 `created:new` 命中 dirty 会话的那
  条分支完成；「无外部修改 / 无外部删除误报」两条负向断言配「树里出现 aabren.md」与「标签就地
  换名」两条正向锚点，不是空转。
- **3. 两处删除都等可观测终态（M355）**：点确认只把 invoke 发出去，删盘是异步链路
  （webview → Rust command → `trash::delete` → FSEvents → watcher 回响），进程内**第一次** trash
  调用还要走 macOS 废纸篓子系统的初始化。本组的终态是 **sticky 提示**（打开中文件的删除处置），
  它比树行更直接地证明回响已走完；磁盘断言排在它后面。**不要**改回「点完立刻读」，也**不要**
  用 `sleep` 猜时长。
- **4. 注入通道的老账**：① `cmd+a` 是 chord，套件**盲发不重试**（丢键就红，先复跑一次再判产品
  缺陷）；② 内联输入框的素材串注入走 `do: typeInNode`（M507：`type_text` 整串一次 + M143 计数
  回读重试）——旧写法逐字符 `do: keys` 对 WKWebView 丢键（'e' 本机确定性丢失）。
- **5. `any` 目标要写正则形态（M324）**：确认框按钮用 `any: "/^移到废纸篓$/"` 锚定
  `AXButton (移到废纸篓)`，不与菜单项「移到废纸篓…」混淆；`target.name` 是裸正则源、
  `target.any` 走 `matcher()`，两种口径别混。
- **6. 不做手感判定**：改名后标签的视觉过渡、sticky 提示的停留手感归 Alex；本组只留截图。
- **7. 不覆盖**：菜单项集分流 / 空白区右键 / 复制路径 / Finder（47a）、撞名与忽略集校验（47b）、
  删除确认框的两档文案细节与目录下新建（47c）——本组只判 dirty 联动。
- **8. 本组不抢前台**：没有 Finder / 没有真实鼠标手势之外的激活动作，结束后 Lumir 仍在前台。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；端口 1430。
- 本组会真的改动合成 vault：`aab-tab.md` → `aabren.md` 的改名与随后的删除（进系统废纸篓）。
  用户真实 vault 全程只读。
- **废纸篓**：被删的条目真的进系统废纸篓（`trash::delete` 的平台语义，无法在测试里绕过）；
  本组只断言「vault 内消失」，不探测 `$HOME/.Trash`——套件不隔离 HOME。
