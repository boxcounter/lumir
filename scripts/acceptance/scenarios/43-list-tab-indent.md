---
id: "43-list-tab-indent"
item: 43
title: 列表项 TAB / SHIFT+TAB：缩进的源码写回（有序列表按新归属重排编号）、到顶与非列表无操作、往返与一次撤销
fixtures: [list-indent.md, code-outline.js]
open: list-indent.md
marker: "列表缩进场景"
steps:
  - name: 基线：源文件与渲染态都可读（后面所有负向断言的前提）
    do: record
    as: 文档基线
    file: list-indent.md
    expect:
      - label: 基线文件存在且可读（读不到一律 FAIL，不允许在空值上比较）
        file: { path: list-indent.md, exists: true }
      - label: 起点：delta 已嵌套在 charlie 之后（源文件 `  - delta`）
        file: { path: list-indent.md, has: "/^  - delta$/" }
      - label: 渲染态可读（正向锚点：本次 AX 读取是活的）
        editor: { has: "alpha" }
      - label: 起点是干净的（标签读屏名没有「未保存」后缀，D90——dirty 判据的唯一可读通道）
        ax: { not: "（未保存）" }
      - shot: 基线

  - name: 记录编辑器文本基线（负向逐字节断言的比较对象）
    do: recordEditor
    as: 编辑器基线
    expect:
      - label: 编辑器文本可读（不可读时 recordEditor 直接报错，不在空值上空转）
        editor: { has: "列表缩进场景" }

  - name: 建立编辑器焦点（点编辑器顶边；光标落在文档首行）
    do: clickEditor
    expect:
      - label: 点击本身不改文档
        editor: { unchangedSince: 编辑器基线 }

  - name: 落点指纹：⌃K 杀掉首行
    do: key
    key: "ctrl+k"
    expect:
      - label: 标题文案从渲染态消失 ⇒ 光标确实在首行（落点不在首行时这条先红，后面的 ⌃N 步数才可信）
        editor: { not: "列表缩进场景" }
      - shot: 落点指纹-杀掉首行

  - name: ⌃Y 粘回被 kill 的整行
    do: key
    key: "ctrl+y"
    expect:
      - label: 标题文案回到渲染态
        editor: { has: "列表缩进场景" }
      - label: 文档逐字节复原（⌃K + ⌃Y 是净零操作；行锚点保证不是子串互含）
        editor: { has: "/^列表缩进场景$/m" }

  - name: 移到第 6 行（`  - delta`）：⌃N × 5
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]
    expect:
      - label: 连续 ⌃N 只移动光标，文档逐字节不变
        editor: { unchangedSince: 编辑器基线 }

  - name: 在 delta 项上按 TAB：整项缩进一层（步长 = 上一同级项 charlie 的内容列 4 − delta 的 marker 列 2 = 2）
    do: key
    key: "tab"
    expect:
      - label: 焦点仍在编辑器正文里（编辑器内 TAB 的原生焦点遍历已被接管，D1a 的知情代价）
        ax: { focused: "AXTextArea" }
      - label: 渲染态仍是同一份列表（TAB 不插字符、不破坏解析）
        editor: { has: "charlie" }
      - shot: delta-TAB-后

  - name: ⌘S 落盘（自动保存有 2s 防抖，这里走确定性的保存键）
    do: keys
    keys: ["cmd+s"]
  - name: 等一次落盘
    do: sleep
    ms: 800
    expect:
      - label: 源文件里 delta 变成 4 空格缩进（该层步长 2；`    - delta`）
        file: { path: list-indent.md, has: "/^    - delta$/" }
      - label: 反向：原来那一行不再存在（判据带行锚点，不是子串互含）
        file: { path: list-indent.md, not: "/^  - delta$/" }
      - label: 上一同级项 charlie 逐字节未动（只动归属项）
        file: { path: list-indent.md, has: "/^  - charlie$/" }
      - label: 列表之外的行逐字节未动
        file: { path: list-indent.md, has: "/^这一行是普通段落。$/" }
      - label: 任务/正文文本未被改写（`delta` 本身还是在的）
        file: { path: list-indent.md, has: "/^    - delta$/" }
      - shot: delta-缩进写回

  - name: 同一项按 SHIFT+TAB：凸排回 charlie 那一层（往返复原）
    do: keys
    keys: ["shift+tab", "cmd+s"]
  - name: 等一次落盘
    do: sleep
    ms: 800
    expect:
      - label: 源文件回到 `  - delta`（往返逐字节复原）
        file: { path: list-indent.md, has: "/^  - delta$/" }
      - label: 反向：`    - delta` 不再存在
        file: { path: list-indent.md, not: "/^    - delta$/" }
      - shot: delta-凸排复原

  - name: 再按 TAB（缩进一次），先确认落盘
    do: keys
    keys: ["tab", "cmd+s"]
  - name: 等一次落盘
    do: sleep
    ms: 800
    expect:
      - label: TAB 已落地（缩进出现）
        file: { path: list-indent.md, has: "/^    - delta$/" }

  - name: 一次 ⌘Z：单次 dispatch 应被撤销史归成一步
    do: keys
    keys: ["cmd+z", "cmd+s"]
  - name: 等一次落盘
    do: sleep
    ms: 800
    expect:
      - label: 一次撤销把整次平移还原（源文件回到 `  - delta`）
        file: { path: list-indent.md, has: "/^  - delta$/" }
      - label: 反向：`    - delta` 不再存在
        file: { path: list-indent.md, not: "/^    - delta$/" }
      - shot: 一次撤销后

  - name: 回锚点（⌃P × 20 顶到文档首行）后移到第 10 行（`3. tres`）：⌃N × 9
    do: keys
    keys: ["ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]
    expect:
      - label: 纯光标移动不碰文档
        editor: { has: "/^3\\. tres$/m" }

  - name: 在 `3. tres` 上按 TAB：步长 3（`2. ` 的内容列）且源码编号按新归属重排为 `1.`
    do: keys
    keys: ["tab", "cmd+s"]
  - name: 等一次落盘
    do: sleep
    ms: 800
    expect:
      - label: tres 成为 dos 的子项且编号重排为本组第 1 项（`   1. tres`，3 空格 = `1. ` 的内容列宽）
        file: { path: list-indent.md, has: "/^   1\\. tres$/" }
      - label: 反向：原来的 `3. tres` 不再存在
        file: { path: list-indent.md, not: "/^3\\. tres$/" }
      - label: 原分组里位置未变的 `2. dos` 逐字节不变（编号重排只落受影响的分组）
        file: { path: list-indent.md, has: "/^2\\. dos$/" }
      - label: 原分组第一项 `1. uno` 也逐字节不变
        file: { path: list-indent.md, has: "/^1\\. uno$/" }
      - shot: tres-缩进与编号重排

  - name: 同一项按 SHIFT+TAB：凸回顶层并重排回原分组的规范序号
    do: keys
    keys: ["shift+tab", "cmd+s"]
  - name: 等一次落盘
    do: sleep
    ms: 800
    expect:
      - label: 源文件回到 `3. tres`（顶层项 + 原分组规范序号）
        file: { path: list-indent.md, has: "/^3\\. tres$/" }
      - label: 反向：`   1. tres` 不再存在
        file: { path: list-indent.md, not: "/^   1\\. tres$/" }
      - shot: tres-凸排复原

  - name: 回锚点后移到第 13 行（`> - foxtrot`）：⌃N × 12
    do: keys
    keys: ["ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]

  - name: 引用内列表按 TAB：插入点在最内层 `>` 之后
    do: keys
    keys: ["tab", "cmd+s"]
  - name: 等一次落盘
    do: sleep
    ms: 800
    expect:
      - label: 源文件里 `> - foxtrot` 变成 `>   - foxtrot`（2 空格加在 `> ` 之后）
        file: { path: list-indent.md, has: "/^>   - foxtrot$/" }
      - label: 反向：原来的 `> - foxtrot` 不再存在
        file: { path: list-indent.md, not: "/^> - foxtrot$/" }
      - label: 引用结构未变（上一行仍是 `> - echo`）
        file: { path: list-indent.md, has: "/^> - echo$/" }
      - shot: 引用内列表缩进

  - name: 回锚点后移到第 3 行（顶层首项 `- alpha`）：⌃N × 2
    do: keys
    keys: ["ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+n", "ctrl+n"]
  - name: 记录首项现场的文件基线
    do: record
    as: 首项基线
    file: list-indent.md

  - name: SHIFT+TAB：已在顶层 ⇒ 无操作（D3a）
    do: key
    key: "shift+tab"
    expect:
      - label: 文档逐字节不变（sha256 + mtime 一起比：不 dispatch 就不该有写盘）
        file: { path: list-indent.md, unchangedSince: 首项基线, mtimeUnchangedSince: 首项基线 }
      - label: 没有变 dirty（dirty 只在命令 dispatch 后才可能亮）
        ax: { not: "（未保存）" }

  - name: TAB：本项是列表第一项 ⇒ 没有可嵌套的父项，无操作（写入只会留下不可见的空白 diff）
    do: key
    key: "tab"
    expect:
      - label: 文档仍逐字节不变（sha256 + mtime）
        file: { path: list-indent.md, unchangedSince: 首项基线, mtimeUnchangedSince: 首项基线 }
      - label: 仍不是 dirty
        ax: { not: "（未保存）" }
      - label: 渲染态没变（正向锚点：编辑器此刻可读）
        editor: { has: "alpha" }
      - shot: 首项-TAB与SHIFT+TAB均无操作

  - name: 回锚点后移到第 15 行（普通段落）：⌃N × 14
    do: keys
    keys: ["ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]
  - name: 记录段落现场的文件基线
    do: record
    as: 段落基线
    file: list-indent.md

  - name: 非列表行按 TAB：无操作（D4a——不插空白、不把键放回原生路径）
    do: key
    key: "tab"
    expect:
      - label: 文档逐字节不变（sha256 + mtime）
        file: { path: list-indent.md, unchangedSince: 段落基线, mtimeUnchangedSince: 段落基线 }
      - label: dirty 没被点亮
        ax: { not: "（未保存）" }
      - label: 焦点没跳出编辑器（KEY 被命中即消费，不走原生焦点遍历）
        ax: { focused: "AXTextArea" }
      - shot: 非列表行-无操作

  - name: 非列表行按 SHIFT+TAB：同样无操作
    do: key
    key: "shift+tab"
    expect:
      - label: 文档仍逐字节不变
        file: { path: list-indent.md, unchangedSince: 段落基线, mtimeUnchangedSince: 段落基线 }
      - label: 焦点仍在编辑器里
        ax: { focused: "AXTextArea" }
  - name: 只读模式：打开非 md 文件（code 会话，state.readOnly = true）
    do: open
    file: code-outline.js
    marker: "const LIMIT = 42;"
    expect:
      - label: 代码文件已装载（渲染态可读，正向锚点）
        editor: { has: "const LIMIT = 42;" }

  - name: 记录只读现场的磁盘基线
    do: record
    as: 只读基线
    file: code-outline.js

  - name: 只读模式下按 TAB（命令按 state.readOnly 提前返回，changeFilter 再兜一层）
    do: key
    key: "tab"
    expect:
      - label: 文件 sha256 与 mtime 都不动（只读保证不因新增命令而放宽）
        file: { path: code-outline.js, unchangedSince: 只读基线, mtimeUnchangedSince: 只读基线 }
      - label: 焦点没跳出编辑器（键被命中即消费，没有落回原生路径）
        ax: { focused: "AXTextArea" }
      - shot: 只读模式-TAB

  - name: 只读模式下按 SHIFT+TAB
    do: key
    key: "shift+tab"
    expect:
      - label: 文件仍逐字节不动
        file: { path: code-outline.js, unchangedSince: 只读基线, mtimeUnchangedSince: 只读基线 }
      - label: 焦点仍在编辑器里
        ax: { focused: "AXTextArea" }

teardown:
  - label: 收尾：四组往返都复原（源文件仍是基线形态）
    file: { path: list-indent.md, has: "/^  - delta$/" }
  - label: 收尾：有序列表回到 `3. tres`
    file: { path: list-indent.md, has: "/^3\\. tres$/" }
  - label: 收尾：引用内列表回到 `> - foxtrot`
    file: { path: list-indent.md, has: "/^> - foxtrot$/" }
  - label: 收尾：首项仍是顶层 `- alpha`
    file: { path: list-indent.md, has: "/^- alpha$/" }
---

# 列表项 TAB / SHIFT+TAB（change list-tab-indent / M239）

## 这个场景验什么

Alex 节点 1 裁决（D1a / D2c / D3a / D4a / D5a）把 TAB / SHIFT+TAB 绑给列表项缩进。本场景在真机上
逐条走一遍**行为链**：按键 → 键位层分发 → 语法树归属判定 → 源码写回 → 落盘 → 撤销还原。

1. **无序列表缩进/凸排**：`  - delta`（嵌套项，上一同级项是 `  - charlie`）按 TAB 变 `    - delta`
   （步长 2 = charlie 的内容列 4 − delta 的 marker 列 2），SHIFT+TAB 逐字节回到 `  - delta`。
2. **有序列表缩进/凸排 + 编号重排（D2c）**：`3. tres` 按 TAB 变 `   1. tres`——3 空格是 `2. ` 的
   内容列宽（固定 2 空格在有序列表上**嵌不进去**，实测见 design §3），且源码编号按新归属重排为
   新分组的第 1 项；SHIFT+TAB 后回到顶层并重排回 `3. tres`。
3. **引用内列表**：`> - foxtrot` 按 TAB 变 `>   - foxtrot`（2 空格加在最内层 `>` 之后）。
4. **撤销**：TAB 后一次 ⌘Z 还原整次平移（单次 dispatch = 一步撤销）。
5. **无操作三形态**：顶层项 SHIFT+TAB（D3a）、列表第一项 TAB（没有可嵌套的父项）、非列表行
   TAB/SHIFT+TAB（D4a）——三种情形下文档 sha256 与 mtime 都不动、dirty 不亮、焦点不跳出编辑器。
6. **只读模式**：切到非 md 的 code 会话后按 TAB / SHIFT+TAB，文件 sha256 与 mtime 都不动
  （`applyListIndent` 的 readOnly 提前返回 + `changeFilter` 兜底）。

## 判据走哪几条通道（可读性如实登记）

| 要判的东西 | 通道 | 为什么不是别的 |
|---|---|---|
| 源码写回（缩进量、编号重排） | **落盘后的 vault 文件**（行锚点正则） | 编辑器内容的 AX 读数 = **渲染后**文本，列表标记被 widget 替换、行首空白不进 AX（README「已知边界」）——源码级判据只能从磁盘取；`⌘S` 让落盘确定发生（不等 2s 自动保存防抖） |
| dirty 是否被点亮 | **标签读屏名里的「（未保存）」（D90）** | 套件读不到 dirty 位；标签 aria-label 是它唯一的可读出口 |
| 焦点是否跳出编辑器 | `ax: { focused: "AXTextArea" }`（解析形态，不是跨节点正则） | D4a 的「不把键放回原生路径」在界面上的唯一可观测后果就是焦点没走；REVIEW.md 第 1 条的教训：落点类断言不用正则 |
| 光标落点 | **⌃K 杀掉首行后标题文案从渲染态消失**（落点指纹） | AX 不暴露 `AXSelectedTextRange`（README）；只有光标真在首行时，⌃K 才会把那句标题杀掉 |
| 后续行定位 | **⌃P × 20 顶到首行 → ⌃N × (n−1)** | 与 `clickEditor` 的实现注释同源口径：「从顶边往下落点，再用 ⌃N 逐行下行定位——比猜行高可靠」。多按的 ⌃P 会被文档首行钳住，因此每次定位都自带回锚点 |

**判据带行锚点**：源码断言一律写成 `/^    - delta$/` 这类**整行**形态。不这么写就会踩子串互含
——`"    - delta"` 里含 `"  - delta"`，负向断言会恒真（REVIEW.md 第 1 条的同族形态）。

## 已知边界

- **光标位置仍不可直接断言**：本场景用「落点指纹 + 行锚点断言」间接把它钉住（指纹不过 → 断言
  必然红，不会假绿）；`⌃N` 的落点是否真的落在目标行由源码断言反向证明（改错行就不会出现期望的
  那一行）。
- **键盘注入会整批丢键**（REVIEW.md 第 11 条：KimiCU 对 WKWebView 间歇丢键，同机第二个实例显著
  加剧）。TAB / SHIFT+TAB / ⌃N / ⌘S 全是 chord 或非可打印键 ⇒ 套件保持盲发不重试。**红了先复跑
  一次再判产品缺陷**；两种红可以互相区分：文件**任何一行都没变** ⇒ 多半是丢键；**变了但不在期望
  的行** ⇒ 先查 ⌃N 步数与落点指纹。
- **不做手感判定**：缩进的观感（列表标记与悬挂缩进的跟随）归 Alex，本场景只留截图证据。
- **不覆盖**：① 选区随 change mapping 的平移（AX 读不到选区）；② `[keys]` 重绑这两条命令
  （既有键位层机制，归键位面板场景 09b）；③ 缩进后**续行与子树**的协调平移在真机上只由
  `  - charlie` / `1. uno` / `2. dos` 这些邻居行的逐字节断言间接覆盖（fixture 里的目标项都是
  单行项）——多行项的整块平移由 `tests/unit/list-indent.test.ts` 的用例钉死。
- **口径备注（实现期决定，已在 change 文档留痕）**：**列表第一项按 TAB = 无操作**。理由是没有
  可嵌套的父项，写入只会在源码里留下渲染态看不见的空白 diff（与 D4c 被否决的同一理由，对称于
  D3a）。这条与本场景的一组断言直接对应（`- alpha` 上 TAB 后文件 sha256 / mtime 都不动）。
