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

  - name: 按 ⌘J：整项缩进一层（步长 = 上一同级项 alpha 的内容列 2）
    do: key
    key: "cmd+j"
    expect:
      - label: 焦点仍留在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: 等自动保存落盘（2s 防抖；这里刻意不用 ⌘S——丢键会让下面的文件断言读到旧内容而假绿）
    do: sleep
    ms: 2600
    expect:
      - label: 源文件里 bravo 变成 2 空格缩进（`  - bravoq`）
        file: { path: list-indent-bullet.md, has: "/^  - bravoq$/" }
      - label: 反向：原来那一行不再存在（判据带行锚点，不是子串互含）
        file: { path: list-indent-bullet.md, not: "/^- bravoq$/" }
      - label: 上一同级项 alpha 逐字节未动（只动归属项）
        file: { path: list-indent-bullet.md, has: "/^- alpha$/" }
      - shot: bravo-缩进写回

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
