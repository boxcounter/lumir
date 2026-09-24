---
id: "30-code-outline"
item: 30
title: 代码文件的符号大纲：⌘⇧O 展开符号条目、跳转到声明、惰性解析（没按过 ⌘⇧O 就不解析、不出指示段）、两条新空态提示
fixtures: [code-outline.js, code-outline-comments.py, code-outline.lua]
open: code-outline.js
marker: "const LIMIT = 42;"
steps:
  - name: 打开代码文件（尚未按过 ⌘⇧O）：记录磁盘基线，「结构未解析」的读数当场可见
    do: record
    as: 磁盘基线
    file: code-outline.js
    expect:
      - shot: 打开后（未解析）
      - label: 编辑器已装载本 fixture（AX 快照是活的，下面两条负向判据才有意义）
        ax: { has: "const LIMIT = 42;" }
      - label: 指示段没有出现——它的悬停提示（「点击展开大纲」）在 AX 里找不到
        ax: { not: "点击展开大纲" }
      - label: 也没有任何符号链（指示段的 AX 名带链；见本文件正文的 AX 形态一节）
        ax: { not: "/AXButton \\(›LIMIT\\)/" }

  - name: 记下编辑器基线（后面的「不改写源文件」逐字节判据）
    do: recordEditor
    as: 编辑器基线

  - name: ⌘⇧O 展开符号大纲（首次需要结构 ⇒ 就在这里解析）
    do: key
    key: "cmd+shift+o"
    expect:
      - shot: 浮层展开
      - label: 浮层已展开（提示串只存在于浮层里）
        ax: { has: "⌃N⌃P 选择" }
      - label: 指示段当场出现（解析发生了），链是光标所在的常量声明
        ax: { has: "/AXButton \\(›LIMIT\\)/" }
      - label: 条目表里正好四条：常量 / 类 / 字段 / 方法各一条
        ax: { count: { pattern: "/AXStaticText \\(LIMIT\\)/", exact: 1 } }
      - label: 类也是条目
        ax: { count: { pattern: "/AXStaticText \\(Util\\)/", exact: 1 } }
      - label: 类字段是条目
        ax: { count: { pattern: "/AXStaticText \\(field\\)/", exact: 1 } }
      - label: 方法是条目
        ax: { count: { pattern: "/AXStaticText \\(greet\\)/", exact: 1 } }
      - label: 局部变量**不是**条目（同一通道刚证明四条真条目在，这条 0 命中才有区分度）
        ax: { count: { pattern: "/AXStaticText \\(local\\)/", exact: 0 } }
      - label: 当前段落在光标所在的常量上（浮层打开时键盘游标已就位）
        ax: { count: { pattern: "/AXStaticText \\(LIMIT\\).*\\(focused\\)/", exact: 1 } }

  - name: ⌃N 连按十六次（Emacs next-line；条目只有四条 ⇒ 无论落地几次都夹在末条）
    do: keys
    keys:
      ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]

  - name: 判落点：键盘游标落在末条 greet 上
    do: sleep
    ms: 400
    expect:
      - label: 浮层仍开着（⌃N 不是关闭键）
        ax: { has: "⌃N⌃P 选择" }
      - label: 条目的 AX 行同时带 greet 与该条的 focused 标记（游标真的移到了末条）
        ax: { count: { pattern: "/AXStaticText \\(greet\\).*\\(focused\\)/", exact: 1 } }

  - name: Enter 跳转到 greet（类内方法）的声明起点
    do: key
    key: "return"
    expect:
      - shot: 跳转后（类内方法：符号链带父级）
      - label: 浮层已收起（Enter 是跳转，不是留在浮层里）
        ax: { not: "⌃N⌃P 选择" }
      - label: 指示段给出完整符号链：光标真的落进了 Util 的 greet 里（只滚动不改选区的实现会停在上一处）
        ax: { has: "/AXButton \\(›Util › greet\\)/" }
      - label: 跳转只改选区与视口：编辑器逐字节未变（ADR 0003 §3）
        editor: { unchangedSince: 编辑器基线 }
      - label: 磁盘文件 sha256 未变（跳转与解析都不写盘）
        file: { path: code-outline.js, unchangedSince: 磁盘基线 }

  - name: ⌘⇧O 再开（同一个键开→关→开）
    do: key
    key: "cmd+shift+o"
    expect:
      - label: 浮层已展开
        ax: { has: "⌃N⌃P 选择" }

  - name: ⌃P 连按十六次（Emacs previous-line；无论落地几次都夹在首条）
    do: keys
    keys:
      ["ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p", "ctrl+p"]

  - name: 判落点：键盘游标落在首条 LIMIT 上
    do: sleep
    ms: 400
    expect:
      - label: 条目的 AX 行同时带 LIMIT 与该条的 focused 标记（游标真的回到了首条）
        ax: { count: { pattern: "/AXStaticText \\(LIMIT\\).*\\(focused\\)/", exact: 1 } }

  - name: Enter 跳转到顶层常量 LIMIT 的声明起点
    do: key
    key: "return"
    expect:
      - shot: 跳转后（顶层常量：符号链无父级）
      - label: 浮层已收起
        ax: { not: "⌃N⌃P 选择" }
      - label: 指示段换成顶层常量的链（无父级 ⇒ 与上一条的 ›Util › greet 可分辨）
        ax: { has: "/AXButton \\(›LIMIT\\)/" }
      - label: 两次跳转之后文档仍未变（编辑器逐字节）
        editor: { unchangedSince: 编辑器基线 }

  - name: 切到不支持档的语言（.lua）：先确认编辑器换了文档
    do: open
    file: code-outline.lua
    marker: "local function greet"
    expect:
      - label: 编辑器已装载
        ax: { has: "local function greet" }

  - name: ⌘⇧O 在不支持的语言上给提示，而不是空浮层
    do: key
    key: "cmd+shift+o"
    expect:
      - shot: 不支持语言的提示
      - label: 给出「暂不支持大纲」的提示
        ax: { has: "这份文件类型暂不支持大纲" }
      - label: 不展开浮层，也没有任何由文本匹配猜出来的条目
        ax: { not: "⌃N⌃P 选择" }
      - label: 不再吐 md 的空标题提示（那句话在代码文件上是错的）
        ax: { not: "这份文档还没有标题" }

  - name: 等上一条提示自消（toast 常驻 3.5s），避免两条同框
    do: sleep
    ms: 3800

  - name: 切到受支持但文件里没有条目的语言（只有注释的 .py）
    do: open
    file: code-outline-comments.py
    marker: "只有注释的模块"
    expect:
      - label: 编辑器已装载
        ax: { has: "只有注释的模块" }

  - name: ⌘⇧O 给「没有可提取的符号」的提示（与上一条互斥）
    do: key
    key: "cmd+shift+o"
    expect:
      - shot: 无符号文件的提示
      - label: 给出「没有可提取的符号」的提示
        ax: { has: "这份文件没有可提取的符号，大纲为空" }
      - label: 不展开浮层
        ax: { not: "⌃N⌃P 选择" }
      - label: 也不是 md 的空标题提示
        ax: { not: "这份文档还没有标题" }
      - label: 也不是「暂不支持」那条（两种情形的提示互斥）
        ax: { not: "这份文件类型暂不支持大纲" }
---

代码文件的符号大纲（change `code-outline`，M197）的**行为**判定。规格见
`openspec/changes/code-outline/specs/toc-outline/spec.md` 的「代码文件的符号大纲」与「当前位置指示与
标题提取」，能力在 `src/code-structure.ts`（结构解析与条目提取）与 `src/toc.ts`（指示段与浮层）。
md 侧的全部口径由既有 `13-toc` 场景原样守——本场景只做 code 分支，**不改** 13-toc 一个字；
「md 口径零回归」的证据就是 13-toc 在同一批次里 PASS（同一枚二进制、同一条共用通道）。

## 断言口径（为什么这么写）

- **指示段在 AX 里是带链的 `AXButton`**（M197 实测）：`.masthead-section` 的 `title` 落成
  `help="点击展开大纲"`，其文本内容落成 AX 名，且 **CSS 的 `::before { content: "›" }`
  （`src/style.css:489`）也会进入 AX 名**——于是形如 `AXButton (›LIMIT)` / `AXButton (›Util › greet)`。
  本场景据此把「有没有指示段」「链是什么」写成**带节点形态的正则**：
  `ax: { not: "/AXButton \\(›LIMIT\\)/" }`（未解析 ⇒ 按钮 hidden ⇒ 该行根本不存在）与
  `ax: { has: "/AXButton \\(›Util › greet\\)/" }`（解析且光标落在 greet 里）。
  这比「指示段文本是否出现」强：链里的 `›` 只由指示段产生，而 `LIMIT` 这种不带父级的链在正文里也有
  ——节点形态把「正文命中」这条假绿路径堵死。
- **惰性判据 = 同一条正则的前后对照**，不是产品里的计数器：打开后不按 `⌘⇧O` 时该 AXButton 不存在，
  按一次之后同一条正则命中。**「打开即解析」的实现会在第一步就命中而红**（这正是 design §5 的反向验证
  配方）。判据还配了两条 liveness（`ax: { has: "const LIMIT = 42;" }` / 编辑器逐字节判据），AX 快照
  退化时先红的是正向断言，不会写成「读不到 = 不存在 = 通过」（REVIEW.md 第 2 条）。
- **浮层条目的 AX 形态**（M197 实测，供后续场景复用）：`AXList (大纲)` 之下逐条
  `AXStaticText (条目文本)`，**键盘游标所在的那一条**带 `(focused)` 标记。因此「条目表里有哪几条」
  可以写成逐条 `count … exact: 1`，负向（局部变量不入列）写成 `exact: 0` **且与四条正向同框**
  ——同一通道先证明四条真条目在，0 命中才有区分度。
- **用「夹到端点」吸收丢键**（REVIEW.md 第 11 条）：真机逐键注入会整批丢键，按「按 n 次」算落点
  不可靠。本场景的两次导航都连按十六次（条目只有四条）：落地几次都无所谓，落不到就夹在端点上
  ——⌃N 夹末条 `greet`、⌃P 夹首条 `LIMIT`，两条落点各由一个精确断言判（`(focused)` 与指示段的链）。
  这比「按三次刚好到 greet」稳，也比「浮层还开着」这种恒真断言强。
- **两条新空态提示**：文案以 `文案-Copy.md` 为单一来源（本 change 新增两条；编号在实现期分配，见
  change 的 tasks.md 5.1）。断言同时给「不是 D84」与「两种情形互斥」两条负向——本次要修的正是
  「⌘⇧O 在代码文件上吐『这份文档还没有标题』」这句错话。
- **跳转落点用指示段的链做派生证据**：AX 不暴露选区（README 的已知边界）。`›Util › greet` 与
  `›LIMIT` 两条**互相可分辨**的链证明了两件事：跳转真的把光标移进了目标符号（只滚动不改选区的实现
  会停在上一处），且跳转落点随条目层级变化。**精确保留**：真机通道判不了「声明起点 vs 标题行尾」的
  字符级差异（两者都在同一个声明节点内），这一点由 chromium 侧
  `tests/visual/scenes/code-outline.spec.ts` 读 CM 选区精确断言（字符偏移相等）。
- **会写盘吗**：不写。本场景全程只读（跳转只改选区与视口，MUST NOT 改写文档），因此不需要 `⌘S` 与
  dirty 相关步骤；`unchangedSince` 两条断言（编辑器逐字节 + 磁盘 sha256）是这一点的机器证据
  （ADR 0003 §3）。

## 覆盖边界（如实写）

- **T2（css / scss 的规则集条目）不在本场景**：条目口径由 `tests/unit/code-structure.test.ts` 与
  `tests/visual/scenes/code-outline.spec.ts`（chromium）逐条断言；真机侧的差异只在渲染与键盘通道，
  与语言无关，故不重复造一遍键盘注入步骤（每个 chord 都是盲发，步骤越少越稳）。
- **1MB 级代码文件首次 `⌘⇧O` 的可感延迟**不在本场景：fixture 都是短文件；量级读数与真机复测结果
  记在 change 的 design §1.6 与实现报告里，属 Alex 的手感项。
