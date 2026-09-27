---
id: "43-list-tab-indent"
item: 43
title: 列表项缩进命令的真机链路——经 [keys] 绑到通道可达的 ⌘J / ⌘⇧J：缩进的源码写回（有序列表按新归属重排序号）、到顶 / 非列表 / 非 md 会话无操作、一次撤销还原
fixtures: [list-indent-bullet.md, list-indent-ordered.md, list-indent-quote.md, list-indent-nested.md, list-indent-paragraph.md, code-outline.js]
open: list-indent-bullet.md
marker: "alpha"
config:
  keys: { "Cmd-j": "editor.list-indent", "Cmd-Shift-j": "editor.list-outdent" }
steps:
  - name: 起点：源文件与渲染态都可读
    do: record
    as: 文档基线
    file: list-indent-bullet.md
    expect:
      - label: 基线文件存在且可读（读不到一律 FAIL，不允许在空值上比较）
        file: { path: list-indent-bullet.md, exists: true }
      - label: 起点：bravo 与 alpha 同层（源文件 `- bravo`）
        file: { path: list-indent-bullet.md, has: "/^- bravo$/" }
      - label: 渲染态可读（正向锚点：本次 AX 读取是活的）
        editor: { has: "alpha" }
      - label: 起点是干净的（标签读屏名没有「未保存」后缀，D90——dirty 判据的唯一可读通道）
        ax: { not: "（未保存）" }
      - label: "[keys] 覆盖已生效（本场景的注入都走它；配置没写进去则后面的探索全是空转）"
        file: { path: env:config.json, has: "\"Cmd-j\": \"editor.list-indent\"" }
      - shot: 起点

  - name: 建立编辑器焦点（点编辑器顶边；点后光标在文档首行 = 第一项 `- alpha`）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里（键盘注入的前置；`open` 之后焦点在树行上）
        ax: { focused: "AXTextArea" }

  - name: 记录首项现场的文件基线（无操作类断言比 sha256 + mtime；此刻文件从未被本场景写过）
    do: record
    as: 首项基线
    file: list-indent-bullet.md

  - name: ⌘⇧J（凸排）：列表项已在顶层 ⇒ 无操作（D3a）
    do: key
    key: "cmd+shift+j"
    expect:
      - label: 文档逐字节不变（sha256 + mtime 一起比：不 dispatch 就不该有写盘）
        file: { path: list-indent-bullet.md, unchangedSince: 首项基线, mtimeUnchangedSince: 首项基线 }
      - label: 没有变 dirty（dirty 只在命令 dispatch 后才可能亮）
        ax: { not: "（未保存）" }
      - label: 焦点仍在编辑器里（命令命中即消费，不把键放回原生路径）
        ax: { focused: "AXTextArea" }

  - name: ⌘J（缩进）：本项是列表第一项 ⇒ 没有可嵌套的父项，同样无操作
    do: key
    key: "cmd+j"
    expect:
      - label: 文档仍逐字节不变（sha256 + mtime）
        file: { path: list-indent-bullet.md, unchangedSince: 首项基线, mtimeUnchangedSince: 首项基线 }
      - label: 仍不是 dirty
        ax: { not: "（未保存）" }
      - label: 渲染态没变（正向锚点：编辑器此刻可读）
        editor: { has: "alpha" }
      - shot: 第一项-两个方向都无操作

  - name: 移到第 2 行（`- bravo`）并到行尾
    do: keys
    keys: ["ctrl+n", "ctrl+e"]
    expect:
      - label: 纯光标移动不碰文档
        editor: { has: "alpha" }

  - name: 落点见证：在光标处键入 q（`keys` 走回读 + 只在字节未变时重试，落地即被证实）
    do: keys
    keys: ["q"]
    expect:
      - label: q 落在 bravo 这一行（不是 alpha 行）⇒ 后面的缩进作用对象已被钉住
        editor: { has: "bravoq" }
      - shot: 落点见证

  - name: 等这次键入的自动保存落盘（并等它自己的 fs 回声走完，见正文「红因定位」）
    # 这一步不是凑等待：M266 定位出「第二次保存被误判成外部修改」的红因就落在这个窗口里
    # （自身写盘的回声在 dirty 时被当外部修改 ⇒ 自动保存被暂停），故先把第一次保存**证实**
    # 落盘再按 ⌘J。判据本身也是正观测：磁盘此时确实是本场景写下的版本。
    do: sleep
    ms: 3000
    expect:
      - label: 见证字符 q 已落盘（第二次保存因此是在「磁盘 = 本场景这一版」之上发生的）
        file: { path: list-indent-bullet.md, has: "/^- bravoq$/" }

  - name: 按 ⌘J：整项缩进一层（步长 = 上一同级项 alpha 的内容列 2）
    do: key
    key: "cmd+j"
    expect:
      - label: 焦点仍留在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: 等自动保存落盘（2s 防抖 + 裕量；这里刻意不用 ⌘S——丢键会让下面的文件断言读到旧内容而假绿）
    # 等待长度维持 2600：M266 实测把它加长到 6000 **不能**让这一步转绿（红因是自动保存被暂停，
    # 不是等得不够），因此不靠加长等待掩盖问题。两件事实留给后批，省得再查一遍：
    # ① 诊断日志白名单里没有「保存成功」这类正向事件（只有 save_conflict / autosave_paused /
    #    recovery_written 这类，见 `src/bindings/LogEventName.ts`）——「有没有保存」只能从磁盘
    #    内容与 mtime 判；② 真出这类事时，`env:lumir/logs/<日期>.jsonl` 里会留下
    #    `save_external_change` + `autosave_paused(reason=external)` 两条（M266 就是靠它定案的）。
    do: sleep
    ms: 2600
    expect:
      - label: 这次改动没有引出「检测到外部修改」提示（自身写盘的回声不许被当成外部修改，见正文「红因定位」）
        ax: { not: "检测到外部修改" }
      - label: 源文件里 bravo 变成 2 空格缩进（`  - bravoq`）
        file: { path: list-indent-bullet.md, has: "/^  - bravoq$/" }
      - label: 反向：原来那一行不再存在（判据带行锚点，不是子串互含）
        file: { path: list-indent-bullet.md, not: "/^- bravoq$/" }
      - label: 上一同级项 alpha 逐字节未动（只动归属项）
        file: { path: list-indent-bullet.md, has: "/^- alpha$/" }
      - shot: bravo-缩进写回

  - name: 记下缩进后的磁盘基线（下一条「一次撤销还原」必须与它比较）
    # M266 补：撤销断言在缩进**从未落盘**时恒真（源文件本来就回到 `- bravoq`，M256 就是这么
    # 空过的）。先记一份缩进后的基线，撤销步再断言「sha256 与它不同」——缩进没发生时这条会红。
    do: record
    as: 缩进后基线
    file: list-indent-bullet.md

  - name: 一次 ⌘Z：单次 dispatch 应被撤销史归成一步（见证字符 q 是另一次输入，不受影响）
    do: key
    key: "cmd+z"
  - name: 等自动保存落盘
    do: sleep
    ms: 2600
    expect:
      - label: 一次撤销把整次平移还原（源文件回到 `- bravoq`）
        file: { path: list-indent-bullet.md, has: "/^- bravoq$/" }
      - label: 反向：`  - bravoq` 不再存在
        file: { path: list-indent-bullet.md, not: "/^  - bravoq$/" }
      - label: 撤销真的写了一次盘（与「缩进后基线」不同——缩进从未落盘时这条会红，堵死空过）
        file: { path: list-indent-bullet.md, changedSince: 缩进后基线 }
      - shot: 一次撤销后

  - name: 换文件：有序列表（`1. uno` / `2. dos`）
    do: open
    file: list-indent-ordered.md
    marker: "uno"
    expect:
      - label: 新文件已装载（渲染态可读）
        editor: { has: "dos" }

  - name: 建立编辑器焦点（新会话光标在文档首行）
    do: clickEditor
    expect:
      - label: 焦点在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: 移到第 2 行（`2. dos`）到行尾并键入见证字符
    do: keys
    keys: ["ctrl+n", "ctrl+e", "q"]
    expect:
      - label: q 落在 dos 这一行 ⇒ 落点已钉住
        editor: { has: "dosq" }

  - name: 按 ⌘J：步长 3（`2. ` 的内容列）且源码编号按新归属重排为 `1.`
    do: key
    key: "cmd+j"
  - name: 等自动保存落盘
    do: sleep
    ms: 2600
    expect:
      - label: dos 成为 uno 的子项且编号重排为本组第 1 项（`   1. dosq`，3 空格 = `1. ` 的内容列宽）
        file: { path: list-indent-ordered.md, has: "/^   1\\. dosq$/" }
      - label: 反向：原来的 `2. dosq` 不再存在
        file: { path: list-indent-ordered.md, not: "/^2\\. dosq$/" }
      - label: 原分组第一项 `1. uno` 逐字节未动（编号重排只落受影响的分组）
        file: { path: list-indent-ordered.md, has: "/^1\\. uno$/" }
      - shot: dos-缩进与编号重排

  - name: 换文件：引用内的列表（`> - echo` / `> - foxtrot`）
    do: open
    file: list-indent-quote.md
    marker: "echo"
    expect:
      - label: 新文件已装载
        editor: { has: "foxtrot" }

  - name: 建立编辑器焦点
    do: clickEditor
    expect:
      - label: 焦点在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: 移到第 2 行到行尾并键入见证字符
    do: keys
    keys: ["ctrl+n", "ctrl+e", "q"]
    expect:
      - label: q 落在 foxtrot 这一行 ⇒ 落点已钉住
        editor: { has: "foxtrotq" }

  - name: 按 ⌘J：插入点在最内层 `>` 之后
    do: key
    key: "cmd+j"
  - name: 等自动保存落盘
    do: sleep
    ms: 2600
    expect:
      - label: 源文件里 `> - foxtrotq` 变成 `>   - foxtrotq`（2 空格加在 `> ` 之后）
        file: { path: list-indent-quote.md, has: "/^>   - foxtrotq$/" }
      - label: 反向：原来的 `> - foxtrotq` 不再存在
        file: { path: list-indent-quote.md, not: "/^> - foxtrotq$/" }
      - label: 引用结构未变（上一行仍是 `> - echo`）
        file: { path: list-indent-quote.md, has: "/^> - echo$/" }
      - shot: 引用内列表缩进

  - name: 换文件：非列表行（只有一段正文）
    do: open
    file: list-indent-paragraph.md
    marker: "这一行是普通段落。"
    expect:
      - label: 新文件已装载
        editor: { has: "这一行是普通段落。" }

  - name: 建立编辑器焦点（光标在首行 = 那段正文）
    do: clickEditor
    expect:
      - label: 焦点在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: 记录段落现场的文件基线
    do: record
    as: 段落基线
    file: list-indent-paragraph.md

  - name: 非列表行按 ⌘J：无操作（D4a——不插空白、也不把键放回原生路径）
    do: key
    key: "cmd+j"
    expect:
      - label: 文档逐字节不变（sha256 + mtime）
        file: { path: list-indent-paragraph.md, unchangedSince: 段落基线, mtimeUnchangedSince: 段落基线 }
      - label: dirty 没被点亮
        ax: { not: "（未保存）" }
      - label: 焦点没跳出编辑器（键被命中即消费，命令不是在别处空转）
        ax: { focused: "AXTextArea" }
      - shot: 非列表行-无操作

  - name: 非列表行按 ⌘⇧J：同样无操作
    do: key
    key: "cmd+shift+j"
    expect:
      - label: 文档仍逐字节不变
        file: { path: list-indent-paragraph.md, unchangedSince: 段落基线, mtimeUnchangedSince: 段落基线 }
      - label: 焦点仍在编辑器里
        ax: { focused: "AXTextArea" }

  - name: 换文件：嵌套列表（`- alpha` / `  - bravo` / `  - charlie`）
    do: open
    file: list-indent-nested.md
    marker: "charlie"
    expect:
      - label: 新文件已装载
        editor: { has: "charlie" }

  - name: 建立编辑器焦点
    do: clickEditor
    expect:
      - label: 焦点在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: 移到第 3 行（`  - charlie`）到行尾并键入见证字符
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+e", "q"]
    expect:
      - label: q 落在 charlie 这一行 ⇒ 落点已钉住
        editor: { has: "charlieq" }

  - name: 按 ⌘J：嵌套项再缩一层（步长 = 上一同级项 bravo 的内容列 4 − 本项 marker 列 2 = 2）
    do: key
    key: "cmd+j"
  - name: 等自动保存落盘
    do: sleep
    ms: 2600
    expect:
      - label: 源文件里 charlie 变成 4 空格缩进（`    - charlieq`）
        file: { path: list-indent-nested.md, has: "/^    - charlieq$/" }
      - label: 反向：原来的那一行不再存在
        file: { path: list-indent-nested.md, not: "/^  - charlieq$/" }
      - label: 只动归属项：前面的兄弟项 bravo 逐字节未动
        file: { path: list-indent-nested.md, has: "/^  - bravo$/" }
      - shot: 嵌套项-再缩一层

  - name: 换文件：非 md 的 code 会话（`.js`——editable-non-md-files 之后**可编辑**，不是只读）
    do: open
    file: code-outline.js
    marker: "const LIMIT = 42;"
    expect:
      - label: 代码文件已装载（渲染态可读）
        editor: { has: "const LIMIT = 42;" }

  - name: 建立编辑器焦点（`open` 之后焦点在树行上，必须点回编辑器，否则键根本不进编辑器）
    do: clickEditor
    expect:
      - label: 焦点在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: 记录 code 会话的磁盘基线
    do: record
    as: code 基线
    file: code-outline.js

  - name: code 会话里按 ⌘J（当前行不是列表项 ⇒ 非列表行无操作，D4a）
    do: key
    key: "cmd+j"
    expect:
      - label: 文件 sha256 与 mtime 都不动（命令在非列表行上 MUST NOT 留下空白 diff）
        file: { path: code-outline.js, unchangedSince: code 基线, mtimeUnchangedSince: code 基线 }
      - label: 焦点没跳出编辑器
        ax: { focused: "AXTextArea" }
      - shot: code 会话-⌘J

  - name: code 会话里按 ⌘⇧J
    do: key
    key: "cmd+shift+j"
    expect:
      - label: 文件仍逐字节不动
        file: { path: code-outline.js, unchangedSince: code 基线, mtimeUnchangedSince: code 基线 }
      - label: 焦点仍在编辑器里
        ax: { focused: "AXTextArea" }
teardown:
  - label: 收尾：bravo 已由一次撤销还原（`- bravoq`）
    file: { path: list-indent-bullet.md, has: "/^- bravoq$/" }
  - label: 收尾：有序列表的 dos 停在缩进 + 重排后的形态
    file: { path: list-indent-ordered.md, has: "/^   1\\. dosq$/" }
  - label: 收尾：引用内列表停在 `>   - foxtrotq`
    file: { path: list-indent-quote.md, has: "/^>   - foxtrotq$/" }
  - label: 收尾：嵌套列表里 charlie 停在再缩一层的形态
    file: { path: list-indent-nested.md, has: "/^    - charlieq$/" }
  - label: 收尾：普通段落文件从未被写过（仍是基线内容）
    file: { path: list-indent-paragraph.md, has: "/^这一行是普通段落。$/" }
---

# 列表项缩进命令的真机链路（change list-tab-indent / M239；M249 收口）

## 这个场景验什么、不验什么（先读这段）

Alex 节点 1 裁决（D1a / D2c / D3a / D4a / D5a）把 `Tab` / `Shift-Tab` 绑给列表项缩进。**但 KimiCU 的
键盘注入落不下 `Tab`**：M240 三路归因（单独复跑仍红 → 不是丢键抖动；把 `src/` 整体回到实现前仍红 →
不是后续 change 引入；chromium 探针里 Tab / Shift+Tab 行为正常 → 不是产品缺陷）证明边界在注入通道，
不是命令实现（现场见 finding `20260926-worker-impl-table-fs-bug-tab-shift-tab-wkwebview-m239-43-master.md`
与 README「键盘注入通道的两类不可达」）。

因此本场景的定位按 M249 收口成**命令链路**：`[keys]` 把 `editor.list-indent` / `editor.list-outdent`
绑到通道可达的 `⌘J` / `⌘⇧J`（不是 Shift 隐含符号，token 形态不受第二条边界影响），在真机 WKWebView
上走一遍「按键 → 键位层分发 → 语法树归属判定 → 源码写回 → 落盘」——**验的是命令本身与它下游的一切**。

**`Tab` / `Shift-Tab` 这个键本身的链路在真机上未验**（`press_key("tab")` 不落 WKWebView），它的判据
落在 chromium：`tests/visual/scenes/m239-list-tab-indent.spec.ts`（真 CM + 真键位层，八条用例，含一条
`[keys]` 解绑 Tab 的反向对照）。两层合起来才等于「D1a–D4a 全部落地」——**不要把本场景的 PASS 读成
「Tab 也验过了」**（REVIEW.md 第 6 条）。

1. **无序列表缩进**：`- bravo`（第二项）按 ⌘J 变 `  - bravoq`（步长 2 = 上一同级项的内容列）。
2. **一次撤销**：同一现场按一次 ⌘Z，源文件回到 `- bravoq`（单次 dispatch = 一步撤销）。
3. **有序列表缩进 + 编号重排（D2c）**：`2. dos` 变 `   1. dosq`——3 空格是 `2. ` 的内容列宽（固定 2
   空格在有序列表上**嵌不进去**，实测见 change 的 design §3），且源码编号按新归属重排为新分组的第 1
   项；原分组第一项 `1. uno` 逐字节不动。
4. **引用内列表**：`> - foxtrot` 变 `>   - foxtrotq`（2 空格加在最内层 `>` 之后）。
5. **嵌套列表再缩一层**：`  - charlie`（与 bravo 同层）变 `    - charlieq`，兄弟项 bravo 逐字节不动。
6. **无操作三形态**：列表第一项 ⌘J（没有可嵌套的父项）、顶层项 ⌘⇧J（D3a）、非列表行 ⌘J / ⌘⇧J
   （D4a）——文档 sha256 与 mtime 都不动、dirty 不亮、焦点不跳出编辑器。
7. **非 md 会话**：`.js` 文件里 ⌘J / ⌘⇧J 不动文件。**注意口径**：editable-non-md-files（M231）之后
   文本类文件是**可编辑**的，这里验的是「非列表行无操作」，不是「只读拒绝」——旧版本条写「非 md 会话
   只读（readOnly 提前返回）」是**错误前提**（`.js` 早已可编辑），已按事实改正。

## 判据走哪几条通道（可读性如实登记）

| 要判的东西 | 通道 | 为什么不是别的 |
|---|---|---|
| 源码写回（缩进量、编号重排） | **落盘后的 vault 文件**（行锚点正则） | 编辑器内容的 AX 读数 = **渲染后**文本：列表标记被 widget 替换、行首空白不进 AX（README「已知边界」）——源码级判据只能从磁盘取 |
| 写盘时机 | **自动保存（2s 防抖）+ 等 2600ms**，不用 ⌘S | 本轮实测教训：⌘S 丢键时文件断言会读到**旧内容**——正向断言假红，更糟的是「原来那一行不再存在」这类负向断言会**假绿**（REVIEW.md 第 2 条的家族）。自动保存不需要任何按键，写盘因此必然发生 |
| 命令是否真的被注入落实 | **每个用例先键入见证字符 `q` 并回读**（`bravoq` / `dosq` / `foxtrotq` / `charlieq`） | `keys` 的可打印序列走「回读 + 只在字节未变时重试」，落地即被证实；q 落在正确的行才说明定位键（⌃N / ⌃E）也落了地。**这条同时是后面文件断言的正观测**（REVIEW.md 第 1 条：负向断言必须有配对的活观测） |
| dirty 是否被点亮 | **标签读屏名里的「（未保存）」（D90）** | 套件读不到 dirty 位；标签 aria-label 是它唯一的可读出口。且只在**从未被编辑过**的文件上断言（fresh fixture），断言才有区分度 |
| `[keys]` 覆盖本身生效 | **隔离 `config.json` 的内容**（front-matter 的 `config:` 由套件写盘） | 覆盖没写进去的话，本场景的每一步都会「无操作」——而那会伪装成 PASS（文件断言本来就期望不变）。先读回配置再开跑，堵死这条空转路径 |
| 焦点是否仍在编辑器 | `ax: { focused: "AXTextArea" }`（解析形态，不是跨节点正则） | 命令命中即消费的直接后果；焦点跑了说明按键落到了别处（注入没落地或命令没命中）。见 README 的解析口径 |

**两条落点纪律**（真机 FAIL 的复盘结论，别退回旧写法）：
- **`open` 之后必须先 `clickEditor`**：`open` 是点左栏树行，焦点留在**树行**上；不点回编辑器时
  editor 作用域的绑定根本不命中（`ctx.isEditorEvent` 为假），键会落到原生焦点遍历上——现场表现
  就是 `focused=AXButton` 与「文档一字未动」。
- **不靠一次按键链去数行**：曾用 `⌃P × 20 回锚 → ⌃N × n` 定位，丢一个键整条链就错位（现场：本想
  缩进第 6 行，实际缩进了第 4 行）。现在每个用例用**独立 fixture + 只下移 1 行**（新开的会话光标在
  offset 0），且落点由见证字符证实。

## 红因定位：M256 / M266 那条「编辑器里缩进了、磁盘没跟上」的真因（2026-09-27，M266）

M240 那轮登记的红是**通道**问题（`Tab` 不落地，已由 M249 改走 `⌘J` 收口）；M256 与 M266 的红
**不是它**——真因是**自身写盘的回声被判成了「外部修改」，自动保存因此被暂停**。现场与证据：

- 现场（M266 实跑，三个读数互相印证）：编辑器里确实缩进了（`ax/04` 的 `AXStaticText = "◦ bravoq"`，
  顶层是 `– bravoq`）；磁盘仍是 `- alpha\n- bravoq\n`（只含见证字符 q）；同一份 AX dump 里带着
  **`检测到外部修改：「list-indent-bullet.md」` + 「重载（放弃我的修改）」**浮条。
- 定案读数：`env:lumir/logs/2026-09-27.jsonl`（隔离配置目录，git 外）在同一秒记下
  ```
  {"change":"modified","event":"save_external_change","path":"list-indent-bullet.md","ts":"…T07:39:52.322Z"}
  {"event":"autosave_paused","path":"list-indent-bullet.md","reason":"external","ts":"…T07:39:52.322Z"}
  {"event":"recovery_written","path":"list-indent-bullet.md","ts":"…T07:39:54.271Z"}
  ```
  而该文件此刻的 mtime 是 `…52.145Z`——**就是应用自己刚刚那次自动保存**。两条读数相隔 177 ms：
  「外部修改」这个事件是应用**自己写盘的回声**（FSEvents 延迟），不是任何外部改动。
- 机制（代码面）：`src/save-controller.ts` 的 `handleExternalChange` 只有一条自身写盘抑制——
  `saving.has(path)`（保存进行中忽略事件）。保存一结束抑制就撤，而回声随后才到；此时若缓冲区
  **又已 dirty**（本例：回声到达前的 177 ms 里 ⌘J 落了地），走的是 `if (isDirty(path))` 分支——
  该分支**不做任何 revision / 回声比对**（干净的兄弟分支有 `reloadDocument(onlyIfChanged)`），
  直接暂停自动保存并弹冲突浮条。后果：这次修改永不落盘（只留一份崩溃备份）。
- 为什么只有第一个用例红：其余三个用例里 `q` 与 ⌘J 落在同一步、相隔很近，自动保存只在**最后**
  一次改动后 2s 触发一次——回声到达时缓冲区不再 dirty，走干净分支自然被识别成回声。
- **本场景侧的对策**：先一步 `sleep 3000` + 断言见证字符已落盘，让第一次保存与它的回声彻底走完
  再按 ⌘J（见步骤注释）。这是**避开窗口**，不是修产品：该竞态本身归 finding
  `.tower/comms/findings/20260927-worker-stale-scene-cleanup-bug-fs-dirty-43.md`
  与 `docs/backlog.md`，**本场景不覆盖它**（真机侧没有任何场景覆盖「同一次保存的回声与下一次编辑
  抢窗口」）。判据面上的护栏留在缩进那一步：`ax: { not: "检测到外部修改" }`——竞态若回来，红的是
  这一条（而不是让人再从头猜「命令没生效」）。

## 已知边界

- **`Tab` / `Shift-Tab` 的按键链路在真机上未验**（`press_key("tab")` 产不出 WKWebView 的 Tab
  keydown，M240 实测）。本场景因此经 `[keys]` 走 `⌘J` / `⌘⇧J`，验的是**同一条命令**；键位层那一段
  归 chromium（`tests/visual/scenes/m239-list-tab-indent.spec.ts`）。
- **键盘注入会整批丢键**（REVIEW.md 第 11 条：KimiCU 对 WKWebView 间歇丢键，同机第二个实例显著
  加剧）。⌘J / ⌘⇧J / ⌃N / ⌃E / ⌘Z 都是 chord，套件保持盲发不重试。**红了先复跑一次再判产品缺陷**；
  三种红可以互相区分：① 见证字符那条红 ⇒ 定位键（⌃N / ⌃E）丢了，产品没被碰到；② 文件断言红但
  文件里**任何一行都没变** ⇒ 多为 ⌘J 丢了；③ 文件里**变了但不在期望的行** ⇒ 先查落点；④ `focused`
  那条红 ⇒ 焦点没在编辑器里，先看 `clickEditor` 是否生效。
- **不做手感判定**：缩进的观感（列表标记与悬挂缩进的跟随）归 Alex，本场景只留截图证据。
- **不覆盖**：① 选区随 change mapping 的平移（AX 读不到选区）；② `Tab` / `Shift-Tab` 的默认绑定
  链路（见上，归 chromium）；③ 多行项（**续行** + 子树）的整块平移在真机上只由
  `^- alpha$` / `^1\. uno$` / `^> - echo$` 这些邻居行的逐字节断言间接覆盖——整块平移由
  `tests/unit/list-indent.test.ts` 的多行用例钉死；④ 见证字符 `q` 会留在 fixture 里（验收 vault 每次
  运行都从 fixtures/ 重置，且本场景的收尾断言按含 `q` 的形态写）。
- **`state.readOnly` 提前返回这一层在真机上验不到（也已无入口）**：`src/editor.ts` 的
  `applyListIndent` 只读时提前返回，但 editable-non-md-files（M231）之后凡能进编辑器的文件类都可
  编辑，image / binary 类又由文件树分流拦在编辑器之外——该守卫当前**没有可达入口**。旧版本场景把
  code 会话那一组写成「只读模式（readOnly 提前返回）」，实为空过（`.js` 可编辑，那组之所以过是因为
  非列表行本来就不写盘）。守卫本身的存废按 REVIEW.md 第 9 条（声明了却没有消费者）另议。
- **口径备注（实现期决定，change 文档留痕）**：**列表第一项缩进 = 无操作**。理由是没有可嵌套的
  父项，写入只会在源码里留下渲染态看不见的空白 diff（与 D4c 被否决的同一理由，对称于 D3a）。
  本场景有一组断言就是它（第一项上 ⌘J / ⌘⇧J 后文件 sha256 / mtime 都不动）。
