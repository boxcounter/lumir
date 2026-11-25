---
id: "13-toc"
item: 13
tier: full
title: 轻量大纲：位置指示 / 浮层条目 / 键盘（↑↓ / ⌃N⌃P）与鼠标跳转 / 关闭 / 空标题与 frontmatter 边界
fixtures: [toc-outline.md, toc-frontmatter.md, toc-plain.md, toc-long.md, toc-long-code.md]
open: toc-outline.md
marker: "第一部分说明段落"
steps:
  - name: 打开带层级标题的文档（浮层未激活）
    do: settle
    expect:
      - shot: 文档与位置指示
      - label: 编辑器已装载本 fixture
        editor: { has: "第一部分说明段落" }
      - label: 未激活时没有任何浮层（大纲零常驻界面）
        ax: { not: "⌃N⌃P 选择" }

  - name: 点击 modeline 的位置指示段展开大纲（按 help 命中，不看标题链文本）
    do: click
    target: { role: AXButton, help: "点击展开大纲" }
    expect:
      - shot: 浮层展开
      - label: 浮层已展开（提示串只存在于浮层里）
        ax: { has: "⌃N⌃P 选择" }
      - label: H3 条目在列表里（文档块 + 条目 = 2 行以上）
        ax: { count: { pattern: "甲小节细节", min: 2 } }
      - label: H6 条目也在列表里（H1–H6 全覆盖）
        ax: { count: { pattern: "六层标题", min: 2 } }

  # 消歧（2026-11-25 真机轮）：`^乙小节$` 在 AX 里有**两个**命中——同一段标题文本既以渲染态
  # `AXStaticText = "乙小节"` 出现在正文里，又以浮层条目 `AXStaticText (乙小节)` 出现在列表里，
  # 正文那次排在前（`findNode` 对 title / label / value 任一命中即算，见 README「已知边界」的
  # `target.name` 条）。两处 role 同为 AXStaticText，没有 role 可分流的余地，故按 README 的
  # 「其次才用 nth」取 nth: 1（= 浮层条目，dump 序与 DOM 序同源）。
  # 漏写 nth 的现场：这一步点的是**正文标题**，光标落在标题文字中段而非行尾，下一步的 ⌃K 于是
  # 只删掉「节」、没有并掉换行（磁盘 `## 乙小\n乙小节正文。`），连带后面两条链条断言一起红。
  - name: 鼠标点浮层里的「乙小节」条目跳转（AXPress 路径，确定性最高）
    do: click
    target: { role: AXStaticText, name: "^乙小节$", nth: 1 }
    expect:
      - shot: 鼠标跳转后
      - label: 浮层已收起
        ax: { not: "⌃N⌃P 选择" }
      - label: 位置指示换成乙小节那一段（真的跳过去了）
        ax: { has: "第一部分 › 乙小节" }

  - name: 光标确实落在该标题行尾（⌃K 在行尾连带换行＝把下一行并进标题行）
    do: key
    key: "ctrl+k"

  - name: 看合并后的标题链
    do: sleep
    ms: 400
    expect:
      - label: 位置指示末段出现合并后的标题文本（光标不在行尾时合并结果不同）
        ax: { has: "第一部分 › 乙小节乙小节正文。" }

  - name: 保存（dirty 会拦住后面的换文件）
    do: key
    key: "cmd+s"

  - name: 等保存落盘
    do: sleep
    ms: 1000
    expect:
      - label: 跳转落点（行尾）与 ⌃K 的合并已落盘（磁盘事实）
        file: { path: toc-outline.md, has: "乙小节乙小节正文。" }

  - name: ⌘⇧O 打开浮层（键盘入口）
    do: key
    key: "cmd+shift+o"
    expect:
      - shot: 键盘入口打开
      - label: 浮层已展开
        ax: { has: "⌃N⌃P 选择" }

  - name: ↓ 在浮层内移动（浮层就地消费，不穿透文档）
    do: keys
    keys: ["Down"]

  - name: ↓ 之后键盘游标落在「乙小节细节」条目上
    do: sleep
    ms: 400
    expect:
      - label: 浮层仍开着（↓ 没有关掉浮层）
        ax: { has: "⌃N⌃P 选择" }

  - name: Enter 跳转到键盘游标选中的标题
    do: key
    key: "return"
    expect:
      - shot: 键盘跳转后
      - label: 浮层已收起（Enter 是跳转，不是留在浮层里）
        ax: { not: "⌃N⌃P 选择" }
      - label: 位置指示给出跳转目标的完整标题链（含父级与已合并的父标题）——**这条同时判「↓ 真的把游标下移了一条」**：游标若没动，链条会是「第一部分 › 乙小节乙小节正文。」（少一层）
        ax: { has: "第一部分 › 乙小节乙小节正文。 › 乙小节细节" }

  - name: ⌘⇧O 再开（同一个键开→关→开）
    do: key
    key: "cmd+shift+o"
    expect:
      - label: 浮层已展开
        ax: { has: "⌃N⌃P 选择" }

  - name: Esc 关闭浮层
    do: key
    key: "escape"
    expect:
      - label: 浮层已收起
        ax: { not: "⌃N⌃P 选择" }
      - label: Esc 只关浮层，不动文档
        editor: { has: "乙小节细节正文。" }

  # change fix-selector-ime-aria-nov25：关闭路径的焦点口径按主动 / 被动区分——Esc 是主动关闭，
  # 焦点回编辑器；点浮层外的被动关闭不抢焦点。真机 AX 只判主动关闭这一半（被动关闭的落点归
  # 浏览器默认行为，chromium 矩阵已覆盖）。
  - name: Esc 之后焦点交还编辑器
    do: settle
    expect:
      - label: 焦点在编辑器正文（AXTextArea）上，而不是停在已隐藏的筛选框里
        ax: { focused: "AXTextArea" }

  - name: ⌘⇧O 再开，按 Tab 把焦点移出浮层
    do: key
    key: "cmd+shift+o"
    expect:
      - label: 浮层已展开
        ax: { has: "⌃N⌃P 选择" }

  - name: Tab 两次（浮层不消费 Tab，焦点离开即收起）
    do: keys
    keys: ["tab", "tab"]
    expect:
      - label: 浮层收起（MUST NOT 留下浮层开着、焦点在外）
        ax: { not: "⌃N⌃P 选择" }

  - name: 打开标题数远超一屏的长文（60 条标题，条目数远超浮层可视区）
    do: open
    file: toc-long.md
    marker: "第 1 章概览正文。"
    expect:
      - label: 编辑器已装载长文
        editor: { has: "第 1 章概览正文。" }

  - name: ⌘⇧O 打开长文的大纲（60 条条目把浮层顶到高度上限，列表在浮层内滚动）
    do: key
    key: "cmd+shift+o"
    expect:
      - shot: 长文浮层（高度上限 + 底部提示常驻的现场）
      - label: 浮层已展开
        ax: { has: "⌃N⌃P 选择" }
      - label: 提示覆盖全部五个就地键（↑↓ / ⌃N / ⌃P / Enter / Esc，文案 D86）
        ax: { has: "↑↓ ⌃N⌃P 选择 · Enter 跳转 · Esc 关闭" }
      - label: 条目表里 H4 层也在（文档块 + 条目 = 2 行以上）
        ax: { count: { pattern: "第 1 章 深一层", min: 2 } }

  # M507 裁决（勿迁）：浮层内被列表消费的 ⌃N，游标不进 AX（mine 位置指示在浮层开着时恒 = 文档游标），
  # 没有「未变才重注」的判据。**不要加 `verify`**——命中会被判「未落地」重注后假 FAIL。判据与证据见
  # README「已知边界」的 chord verify 条。
  - name: ⌃N 连按四次（Emacs next-line；与 ↓ 共用同一移动实现）
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]

  - name: 判 ⌃N 的落点（每章四条标题，从首条下移四条 = 下一章的 H1）
    do: sleep
    ms: 400
    expect:
      - shot: ⌃N 四次之后
      - label: 浮层仍开着（⌃N 不是关闭键）
        ax: { has: "⌃N⌃P 选择" }
      - label: ⌃N 没有穿透到文档（编辑器光标仍在第 1 章，指示段链条未推进到小节段）
        ax: { not: "第 1 章 概览 › 第 1 章 小节" }

  # 游标落点的判据（M199 实测改写）：焦点迁到筛选输入框后，浮层条目**不再带 `(focused)` 标记**
  # （AX 里的唯一 focused 节点是 AXComboBox），因此改取**派生证据**——modeline 指示段的标题链。
  # 「链条里的 `›` 分隔符只可能由指示段产生」，因此带分隔符的链条串只对目标位置成立。
  # ⌃N 的落点由「再下一条 + Enter」证明：↓ 只走一条，从第 2 章的 H1 落到它的 H2，链条因此两段。
  - name: ↓ 再一条后 Enter —— 由链条证明 ⌃N×4 的落点（第 2 章概览 → 第 2 章小节）
    do: keys
    keys: ["Down", "return"]
    expect:
      - label: 浮层已收起（Enter 是跳转）
        ax: { not: "⌃N⌃P 选择" }
      - label: 链条落在「第 2 章 概览 › 第 2 章 小节」（⌃N×4 若没落在第 2 章的 H1 上，两段链条对不上）
        ax: { has: "第 2 章 概览 › 第 2 章 小节" }

  - name: ⌘⇧O 再开浮层（上一腿的 Enter 已收起它；重开从当前段起算）
    do: key
    key: "cmd+shift+o"
    expect:
      - label: 浮层已展开
        ax: { has: "⌃N⌃P 选择" }

  - name: ⌃P 连按三次（Emacs previous-line，方向相反）
    do: keys
    keys: ["ctrl+p", "ctrl+p", "ctrl+p"]

  - name: 判 ⌃P 的落点（第 2 章小节起上移三条 = 第 1 章的 H3），同样由链条证明
    do: key
    key: "return"
    expect:
      - label: 浮层已收起（Enter 是跳转）
        ax: { not: "⌃N⌃P 选择" }
      - label: 链条落在「第 1 章 概览 › 第 1 章 小节 › 第 1 章 细目」（⌃P 与 ↑ 共用同一移动实现，方向相反）
        ax: { has: "第 1 章 概览 › 第 1 章 小节 › 第 1 章 细目" }

  - name: ⌘⇧O 再开（判浮层态在关→开之间清干净）
    do: key
    key: "cmd+shift+o"
    expect:
      - label: 浮层已展开
        ax: { has: "⌃N⌃P 选择" }

  - name: Esc 收起长文浮层
    do: key
    key: "escape"
    expect:
      - label: 浮层已收起（⌃N/⌃P 的浮层态清干净）
        ax: { not: "⌃N⌃P 选择" }
      - label: 浮层里的 ⌃N/⌃P 导航没动过文档
        editor: { has: "第 1 章概览正文。" }

  # 落点判据（M523 订正；M199 起的 `not: "第 1 章 概览 › 第 1 章 小节"` 口径倒置，见下）：
  # 光标在「第 1 章 细目」行尾按 ⌃N 下移 4 行恰好落进「第 1 章 深一层」段（`toc-long.md` 第 11 行），
  # 而**任何**在该子树里的落点其链条都含 `第 1 章 概览 › 第 1 章 小节` 这个前缀——`not` 形式于是
  # 把「正确落点」判成红、只有在注入多落几行冲进第 2 章时才绿（假绿方向反了：REVIEW.md 「断言等价于子串」条同族）。
  # 现在是 `has` 形式，取两档——「已落进第 1 章 深一层段」与「已越到第 2 章」。
  # **两档都必须带 `›` 锚点**：链条串里的 `›` 只可能来自 modeline 指示段（正文与浮层条目都没有这个
  # 分隔符），写成裸标题文本（如 `has: "第 1 章 深一层"`）会被文档正文与大纲条目满足 → 假绿。
  # 容忍带：⌃N 是 chord、注入**没有**回读与重试（README 的判定边界），实测里出现过整批重复
  # （4 次按出 8 行的落点）⇒ 少按停在「第 1 章 细目」段（3 段链条）红、按多落进第 2 章照绿、
  # 按更多冲进第 3 章红；「⌃N 没归还编辑器」这种真缺陷让链条整段不变 → 红。
  - name: 关闭后 ⌃N 归还给编辑器（同一物理键换归属）
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]
    expect:
      - label: 光标已推进到「第 1 章 深一层」那一段（上一步跳在「第 1 章 细目」的行尾，下移 4 行 = 第 11 行的深一层正文；⌃N 没归还编辑器的话链条仍是 3 段停在「第 1 章 细目」）
        ax: { has: "/第 1 章 概览 › 第 1 章 小节 › 第 1 章 细目 › 第 1 章 深一层|›第 2 章 概览/" }
      - label: 编辑器光标移动不改文档字节
        editor: { has: "第 1 章概览正文。" }

  - name: 切到 frontmatter 文档
    do: open
    file: toc-frontmatter.md
    marker: "真标题正文"
    expect:
      - label: 上一份文档的标题链已撤下（指示段随文档切换清空）
        ax: { not: "第一部分 › 乙小节" }

  - name: ⌘⇧O 看 frontmatter 文档的大纲
    do: key
    key: "cmd+shift+o"
    expect:
      - shot: frontmatter 边界
      - label: 浮层已展开
        ax: { has: "⌃N⌃P 选择" }
      - label: frontmatter 里的 `#` 注释行没有被当成标题（渲染态里它不在正文里）
        ax: { not: "幽灵标题" }
      - label: 真正的标题照常列出（文档块 + 条目 = 2 行以上）
        ax: { count: { pattern: "前言下的真标题", min: 2 } }

  - name: Esc 收起浮层
    do: key
    key: "escape"
    expect:
      - label: 浮层已收起
        ax: { not: "⌃N⌃P 选择" }

  - name: 打开没有任何标题的文档
    do: open
    file: toc-plain.md
    marker: "纯文本文档"
    expect:
      - label: 编辑器已装载
        editor: { has: "纯文本文档" }

  - name: ⌘⇧O 在无标题文档上给提示而不是空浮层
    do: key
    key: "cmd+shift+o"
    expect:
      - shot: 空标题提示
      - label: 给出「还没有标题」提示（文案 D84）
        ax: { has: "这份文档还没有标题" }
      - label: 不弹空浮层
        ax: { not: "⌃N⌃P 选择" }

  # M754：长文里「点了条目但没跳过去」。**起跳点必须离开文档原点**——阅读位置的写回对
  # 锚 = 0 提前返回，缺陷只在「视口已经滚过一段」时才发作，这正是用户说的「有时候」。
  # AX 不暴露 scrollTop（见 README「已知边界」），判据取组合证据：指示段的标题链是
  # 「光标在视口内取光标、否则取视口顶部」的函数（`src/toc.ts` 的 `anchorPos`）——跳转后链条
  # 落在目标的完整链上 ⟺ 光标与视口都在目标处；视口若留在原处，光标已被滚出视口，链条给出的
  # 是原处那一节。本形状与视觉场景 `tests/visual/scenes/toc-outline.spec.ts` 的长文用例同一份
  # fixture（那边直接读几何量判「视口揭示」，这边判真机 WKWebView 上的同一条不变量）。
  - name: 打开标题之间夹长代码块的长文（360 行：1 H1 + 15 H2 + 3 H3 + 15 个 16 行代码块）
    do: open
    file: toc-long-code.md
    marker: "第 1 节正文说明。"
    expect:
      - label: 编辑器已装载长文
        editor: { has: "第 1 节正文说明。" }

  - name: 点正文建立编辑器焦点（⌃V 是 editor 作用域，焦点还在文件树按钮上时不命中）
    do: clickEditor

  - name: ⌃V 连按四次把视口推到文档中段
    do: keys
    keys: ["ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v"]

  - name: 判视口真的离开了文档原点
    do: settle
    expect:
      - shot: 翻屏之后（视口停在文档中段）
      - label: 指示段给出章节链——`›` 分隔符只可能由指示段产生（文档正文里没有它），停在原点时链条只有 H1 一段
        ax: { has: "长文总览 › " }

  - name: ⌘⇧O 打开浮层
    do: key
    key: "cmd+shift+o"
    expect:
      - label: 浮层已展开、焦点落在筛选框上
        ax: { has: "⌃N⌃P 选择" }
      # 2026-11-25 真机轮订正：WKWebView 把 `aria-activedescendant` 指向的**游标行**报成 focused
      # （实测 focused = `AXStaticText (第 3 节 标题) actions=[AXPress]`，筛选框本身不带该标记），
      # 所以「focused 是 AXComboBox」这条在此态下恒不可达——它与 ARIA combobox 的焦点语义也相反：
      # DOM 焦点在输入框上，AX 的 focused 标记落在被 activedescendant 指的那一行。判据改判
      # 「focused 落在浮层条目（AXStaticText）上而不是编辑器」，「打开即可打字」由下一步的注入
      # 回读（AXValue 逐字等于查询串，焦点不在输入框时字符会漏进别处）直接证明。
      - label: 焦点在浮层的游标行上（AX 的 focused 跟 `aria-activedescendant` 走，不是筛选框）
        ax: { focused: "AXStaticText" }

  - name: 用筛选框把远端条目收成唯一一条（M507 通道：原生输入原子注入，不逐字符丢键）
    do: typeInNode
    target: { role: AXComboBox, name: "筛选" }
    text: "第 2 节 标题"
    expect:
      - label: 查询串逐字落在输入框里（AXValue 是 typeInNode 的回读字段）
        ax: { has: "/AXComboBox \\(筛选\\) Value: 第 2 节 标题/" }

  # change fix-selector-ime-aria-nov25：输入面 ⌘A 全选。必须走 cgevent 真键盘事件——KimiCU 的
  # `cmd+a` 会走 AX 全选兼容路径（零键盘事件），验不到产品自己的 Cmd-A 分支。
  - name: ⌘A 全选筛选串（真实键盘事件）
    do: key
    key: "cmd+a"
    channel: cgevent

  - name: 全选后按一次 Backspace（盲发，恰好一次）：全选生效则整串被清空
    do: keys
    keys: ["Backspace"]

  - name: 判输入串是否被整串清空
    do: settle
    expect:
      - label: 输入框已空（没有 Value 字段）；全选未生效时这里会是「第 2 节 标」的 Value
        ax: { not: "/AXComboBox \\(筛选\\) Value:/" }
      - label: 结果集回到全量（第 2 章的小节标题重新出现在大纲里，正文之外多一份）
        ax: { count: { pattern: "第 2 章 小节", min: 2 } }

  - name: 恢复远端条目查询（供下一步 Enter 使用）
    do: typeInNode
    target: { role: AXComboBox, name: "筛选" }
    text: "第 2 节 标题"
    expect:
      - label: 查询串逐字落在输入框里
        ax: { has: "/AXComboBox \\(筛选\\) Value: 第 2 节 标题/" }

  - name: Enter 跳到筛选出来的那一条（结果集只剩一条，游标就是它）
    do: key
    key: "return"
    expect:
      - shot: 从中段跳到远端之后的现场
      - label: 浮层已收起（Enter 是跳转）
        ax: { not: "⌃N⌃P 选择" }
      - label: 链条落在「第 2 节」上——视口若留在中段，这里会是中段那一节的链
        ax: { has: "长文总览 › 第 2 节 标题" }
      - label: 跳转只改选区与视口，不改文档
        editor: { has: "第 1 节正文说明。" }
---

轻量大纲（TOC popover）的**行为**判定（M148）。规格见 `openspec/specs/toc-outline/spec.md`
（归档记录 `openspec/changes/archive/2026-09-17-add-toc-outline/`），入口形态由 Alex 裁决：
modeline 显示当前标题路径（兼作位置指示），点击它或按 ⌘⇧O 展开浮层大纲。M157 的两条增补
（浮层内的 ⌃N / ⌃P 与「最大高度 = 窗口高的 80%」）见
`openspec/changes/archive/2026-09-18-toc-popover-emacs-keys-and-max-height/`。

## 断言口径（为什么这么写）

- **浮层「开」的判据是提示串 `↑↓ ⌃N⌃P 选择 · Enter 跳转 · Esc 关闭`（文案 D86）**：它只存在于
  浮层里，文档正文与文件树都不会出现——用它判「浮层开着」不存在子串型假绿。反过来
  `not: "⌃N⌃P 选择"` 就是「浮层已收起」的判据。（M157 起提示串扩为覆盖五个就地键：`⌃N` / `⌃P`
  不进统一键位表、也不进键位面板，这行提示是它们唯一的可见出口；本文件里该探针共 **13 处**，
  与提示文案必须同批更新——漏一处就是整条场景假绿或假红。）
- **条目在列表里用 `count … min: 2`**：同一条标题文本在 AX 里出现两次——渲染态的文档块一次、
  浮层条目一次（M148 实测：浮层在 AX 里落成 `AXList (大纲)` + 逐条 `AXStaticText (标题)`，
  每条带 `actions=[AXPress]`）。只写 `has` 会被文档正文满足（等价于子串，无区分度），这正是
  REVIEW.md 「断言等价于子串」条要挡的形态。
- **浮层条目的 AX 结构（M148 实测；M199 起游标通道改写）**：`AXList (大纲)` 的 label 来自
  `aria-label`；条目是 `AXStaticText (条目标题)`，带 `AXPress` 动作。**M148–M198 期间**键盘游标所在的
  那一条带 `(focused)` 标记（那时焦点在列表上），`↓` 的落点判据写成「同一行同时出现条目 label 与
  `(focused)`」（`/AXStaticText \(乙小节细节\).*\(focused\)/`）。
  **M199 实测推翻这条通道**：筛选输入框接管焦点后，`(focused)` 跟着 `aria-activedescendant` 跑，
  不再出现在「所有条目都没有标记」的旧形态里（AX dump：`.local/acceptance/2026-09-24/32-list-filter/ax/`）。
  2026-11-25 真机轮补齐了这条映射的另一半：`aria-activedescendant` 挂在**持焦的输入框**上，但
  WKWebView 把标记记在**被它指向的那一行**（实测 `focused` = `AXStaticText (第 3 节 标题)
  actions=[AXPress]`，筛选框 `AXComboBox (筛选)` 自己不带该标记；现场
  `.local/acceptance/2026-11-25-selector-accessibility-final/13-toc/ax/`）。因此「focused 是
  AXComboBox」不是可达态，游标落点也不该靠 focused 标记判——它改用**派生证据**：modeline
  指示段的标题链（见下一条）；「浮层还开着」这种恒真断言仍不足以承担它，链条串里的 `›` 分隔符才是判据。
- **⌃N / ⌃P 与 ↑↓ 等价，关闭后归还编辑器（M157；判据 M199 改写）**：浮层里这两条键与箭头共用同一份
  `move()`（`src/toc.ts` 的 onKeydown）。落点判据取**指示段的链条**：按完 ⌃N / ⌃P 后再按一次 `↓`
  （或直接）用 `Enter` 跳过去，断言链条落在目标那一条上——链条是光标的函数，且带 `›` 的链条串只可能
  由指示段产生（文档正文里没有这个分隔符）。同理「浮层里的 ⌃N 不穿透文档」写 `not: "第 1 章 概览 ›
  第 1 章 小节"`，`Esc` 关闭后再连按 ⌃N 四次则链条必须跟着光标推进。
- **长文 fixture（`toc-long.md`，60 条标题 = 15 章 × H1–H4）**：条目数远超浮层可视区，把 ⌃N / ⌃P
  的导航放在有区分度的输入上（`toc-outline.md` 的 10 条标题连旧上限 55vh 都填不满）。
  「浮层总高 ≤ 窗口内容区高的 80%、列表在浮层内滚动、底部提示常驻」这三条的**机器断言在
  chromium 侧** `tests/visual/scenes/toc-outline.spec.ts`（真机 AX 不暴露元素高度与滚动量），
  本场景只留 `shot: 长文浮层` 的截图给 Alex，不声称在真机通道上验过高度上限。
- **步骤顺序按「确定性优先」排（M148 全量轮实证）**：`key` / `keys` 都是**盲发**（不可回读的
  chord 不做重试，见 README 已知边界），一次丢键会连带后续依赖它的步骤一起 FAIL——全量轮里
  12-links 先跑（它会真的唤起浏览器与文本编辑），13-toc 的 `Enter` 就丢过一次，连带 6 条断言
  失败。因此本场景把**核心语义放确定性路径**：跳转的落点与光标位置由「鼠标点条目（AXPress，
  不经过键盘注入）+ ⌃K 行尾合并」这条链验证；键盘导航（↓ + Enter，以及后面的 ⌃N / ⌃P 块）
  单独成块放在后面，丢键时只波及本块。
- **位置指示的标题链是光标的函数**：指示段口径是「光标在可见范围内就取光标，光标滚出视口才
  退化为视口顶部」（`src/toc.ts` 的 `anchorPos`）。跳转是 `selection` + `scrollIntoView` 一次
  dispatch，跳转后光标必在可见范围内——所以「链条含父级」这条断言只有在光标真落到目标标题段时
  才成立；只滚动不改选区的实现会停在上一段（或链条缺一层）而 FAIL。
- **长文跳转必须从中段起跳（M754）**：用户报的「点了条目但没跳过去」只在视口已经离开文档原点
  时发作——阅读位置的写回对锚 = 0 提前返回，从顶端起跳永远是好的（这正是「有时候」的来源）。
  该块的判据是组合证据：先判视口真的动了（`长文总览 › ` 这条不带章节名的链只在视口落在章节里时
  成立），再判跳转后链条落在目标那一节（视口留在原处时链条给出的是原处那一节，因为光标已被
  滚出视口）。视觉侧同一份 fixture 的几何断言见 `tests/visual/scenes/toc-outline.spec.ts`。
- **⌃K 在行尾连带换行**（`src/editor.ts:648` 的 Emacs 口径）：光标恰在 `## 乙小节` 行尾时 ⌃K
  把下一行并进标题行，标题文本变成 `乙小节乙小节正文。`；光标在行首会删掉整行、在行中会截断
  ——三种结果各不相同。断言写成**带父级的链条** `第一部分 › 乙小节乙小节正文。`（联合串只可能
  由指示段产生，文档正文里没有 `›`），因此它同时排除了「指示段是别处在凑字符串」这条路径。
  这一步会真的改文档，故脚本随后 ⌘S 落盘并断言磁盘事实，再继续换文件。
- **条目层级（缩进）不在这条通道里**：AX 不暴露缩进，层级视觉由 `shot: 浮层展开` 的截图留给
  Alex（与套件「手感/审美不下沉」的分工一致）；本场景只断言各层级条目都在列表里（H3、H6 各一条）。
- **frontmatter 边界**：`toc-frontmatter.md` 的首部 YAML 里有一行 `# 幽灵标题`（YAML 注释）。
  lezer 的 markdown 解析器不认识 frontmatter，若不排除，这行会以 `ATXHeading1` 混进大纲。它在
  渲染态里不出现（frontmatter 块被替换成 properties 表格，注释不是键值），所以
  `not: "幽灵标题"` 在浮层打开时成立 ⟺ 没有混进列表。
- **`click` 动作的 `target` 口径**（详见 README 的已知边界，M148 首轮踩过）：`target.name` 是裸
  正则源、不是 `/.../` 匹配器。因此位置指示段按 `help="点击展开大纲"` 命中（`findByHelp` 才走
  匹配器，且这条 help 与标题链文本无关，比按标题链找更稳）；浮层条目用**锚定**正则 `^乙小节$`
  ——AXTextArea 的 value 是整个文档文本，不加锚点会让它也被命中（它的 value 里含 `乙小节` 那一行）。
- **`editor` 作用域的键要先让编辑器拿到焦点**：`do: open` 是点左栏行，焦点留在树按钮上，此时
  ⌃K 这类 `editor` 作用域命令不命中（作用域判定看事件目标是否在 contentDOM 内），按键会落到别处。
  本场景依赖「跳转自己把焦点交还编辑器」（`src/toc.ts` 的 `jumpTo`：收起浮层 → `view.focus()` →
  落点，M754 起与 `editor.jumpToLine` 同一交接口径），故 ⌃K 紧跟跳转；若把 ⌃K 挪到别的上下文，
  需要先 `clickEditor` 或先做一次跳转。
- **鼠标跳转**：点浮层条目走的是与键盘同一跳转实现（`src/toc.ts` 的 `jumpTo`）。
- **IME 组合期与 ARIA 属性不在这条通道里**（change fix-selector-ime-aria-nov25）：AX 读不到
  option 的 `aria-selected` / `aria-current`，组合期按键序列也无法由套件稳定注入。代码级判据在
  `tests/visual/scenes/selector-aria-ime-nov25.spec.ts`；真机只做手工复核（真实中文输入法下组合期
  `↓` / `Enter` 不导航、不接受，组合结束后列表按最终串刷新一次），清单见该 change 的完工报告。
- **`⌘A` 全选必须走 cgevent 真键盘事件**（同上 change）：KimiCU 的 `cmd+a` 在原生输入框上走
  AX 全选兼容路径（零键盘事件），会把「原生 Select All 顺手做了」误判成产品分支生效。判据是
  「全选后按一次 Backspace（盲发，恰好一次）→ 输入框没有 `Value` 字段」：全选没生效时只删掉最后
  一个字符，输入框仍有值；正文里的同名前缀不参与这条判据（匹配的是 AXComboBox 的 Value 字段）。

## 环境与副作用

隔离 `XDG_CONFIG_HOME` 与合成 vault（`/tmp/lumir-m102-acceptance`），端口
`LUMIR_ACCEPTANCE_PORT`（默认 1430）。键盘步骤需要前台，runner 会 AXRaise Lumir 抢前台焦点。

本场景**会写验收 vault**：⌃K 的合并经 ⌘S 落盘到 `toc-outline.md`（合成 vault，下一次运行按
`fixtures/` 重置）。用户真实 vault 全程只读。

## 本场景会真唤起系统应用吗

不会。本场景不打开外链、不调用系统默认应用。
