---
id: "66-code-block-selection"
item: 66
title: 代码块内选区底色可见（块底色 MUST NOT 盖住 drawSelection 自绘的选区）
steps:
  - name: 造 fixture（场景自建，不动 fixtures 目录）
    do: vaultWrite
    file: m288-code.md
    content: |
      这是第一段普通文字，给选区一个块外的起点。

      ```js
      code line one
      code line two
      code line three
      ```

      中间一段带 **中间粗体** 的普通文字。

      这是末尾一段普通文字。
    expect:
      - label: fixture 已落盘（读不到一律 FAIL）
        file: { path: m288-code.md, exists: true }
      - label: 粗体定界符在源码里（它是本场景的选区覆盖证据，见正文）
        file: { path: m288-code.md, has: "/\\*\\*中间粗体\\*\\*/" }
      - shot: fixture

  - name: 等一拍再读（外部写入后立刻读 AX 会与 DOM 刷新抢）
    do: sleep
    ms: 1200

  - name: 打开 fixture（点左栏树行）
    do: open
    file: m288-code.md
    marker: "这是第一段普通文字"
    expect:
      - label: 渲染态：粗体定界符不在（它是本场景的选区覆盖证据）
        editor: { not: "**中间粗体**" }
      - shot: 渲染态起点

  - name: 记下文件基线（本场景的手势一个都不许改文档）
    do: record
    file: m288-code.md
    as: 手势前

  - name: 判块底色在场（选区建立**之前**：证明采样点真的落在代码块上，不是落在块外——坐标漂了就红）
    do: sleep
    ms: 400
    expect:
      - label: 同一行代码上两点同色（这两个点都在代码行右段的落空底色带上）
        pixel:
          same:
            - [ { x: 700, y: 260, as: "代码行右段 a" }, { x: 800, y: 260, as: "代码行右段 b" } ]
      - label: 代码行底色 MUST 与块外正文底色可辨（代码块有一块自己的底色；标定采样点用）
        pixel:
          differ:
            - [ { x: 700, y: 260, as: "代码行" }, { x: 300, y: 205, as: "块外·正文左缘外" } ]
          min: 8

  - name: 把光标放进第 1 行（点编辑器正文起点；正文内元素没有 AX bbox，只能按坐标点）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里（键盘注入的前置）
        ax: { focused: "AXTextArea" }

  - name: 抢前台（同机别的 app 抢走前台时后台注入的 chord 会丢键——REVIEW.md 第 11 条）
    do: focusWindow
    retries: 4

  - name: ⌃A 到行首 + ⌃⇧N ×16 向下扩选（扩到文末；多出来的按键幂等，装置因此不依赖行数精确对齐）
    do: keys
    keys:
      [
        "ctrl+a",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
      ]
    expect:
      - label: 选区覆盖了代码块——块**之后**那一段的粗体显露为源码（锚点在第 1 行、选区连续 ⇒ 跨过整块）
        editor: { has: "**中间粗体**" }
      - label: 手势不改文档（sha256 + mtime 双比）
        file: { path: m288-code.md, unchangedSince: 手势前, mtimeUnchangedSince: 手势前 }
      - shot: 跨块选区

  - name: 判块内选区底色（AX 读不到选区，像素层是本缺陷唯一的真机判据）
    do: sleep
    ms: 600
    expect:
      - label: 块内选中处的底色 == 同一选区在块外正文上的底色（--sel 的签名；块底色盖住选区时这里读到的是块底色）
        pixel:
          same:
            - [ { x: 700, y: 260, as: "选区内·代码行" }, { x: 900, y: 169, as: "选区内·块外正文" } ]
      - label: 同一行代码上两点仍同色（选区内，转成一个色块——坐标没漂、没有半块半个洞）
        pixel:
          same:
            - [ { x: 700, y: 260, as: "选区内·代码行右段 a" }, { x: 800, y: 260, as: "选区内·代码行右段 b" } ]
      - shot: 底色-light

  - name: 切到 dark 档
    do: configWrite
    theme: dark
  - name: (dark) 重新打开 fixture
    do: open
    file: m288-code.md
    marker: "这是第一段普通文字"
  - name: (dark) 判块底色在场（选区前）
    do: sleep
    ms: 400
    expect:
      - label: 同一行代码上两点同色
        pixel:
          same:
            - [ { x: 700, y: 260, as: "代码行右段 a" }, { x: 800, y: 260, as: "代码行右段 b" } ]
      - label: 代码行底色 MUST 与块外正文可辨
        pixel:
          differ:
            - [ { x: 700, y: 260, as: "代码行" }, { x: 300, y: 205, as: "块外·正文左缘外" } ]
          min: 8
  - name: (dark) 把光标放进第 1 行
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: (dark) 抢前台
    do: focusWindow
    retries: 4
  - name: (dark) 同一条扩选
    do: keys
    keys:
      [
        "ctrl+a",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
      ]
    expect:
      - label: 选区覆盖了代码块（粗体显露）
        editor: { has: "**中间粗体**" }
  - name: (dark) 判底色
    do: sleep
    ms: 600
    expect:
      - label: dark 的 --sel 是半透明（白 7.5%），合成色随表面变 ⇒ 判「块内选中处 MUST 与块外底色可辨」
        pixel:
          differ:
            - [ { x: 700, y: 260, as: "选区内·代码行" }, { x: 300, y: 205, as: "块外·正文左缘外" } ]
          min: 8
      - label: dark 的选中处在代码行右段两点同色（坐标与色块的稳定读数）
        pixel:
          same:
            - [ { x: 700, y: 260, as: "选区内·代码行右段 a" }, { x: 800, y: 260, as: "选区内·代码行右段 b" } ]
      - shot: 底色-dark

  - name: 切到 eink 档（黑底反白：选中前景必须是 --sel-text）
    do: configWrite
    theme: eink
  - name: (eink) 重新打开 fixture
    do: open
    file: m288-code.md
    marker: "这是第一段普通文字"
  - name: (eink) 判块底色在场（选区前）
    do: sleep
    ms: 400
    expect:
      - label: 同一行代码上两点同色
        pixel:
          same:
            - [ { x: 700, y: 260, as: "代码行右段 a" }, { x: 800, y: 260, as: "代码行右段 b" } ]
      - label: 代码行底色 MUST 与块外正文可辨（eink 恒真的一半：这条只作标定，块底色 = 白底黑框里的灰行区）
        pixel:
          differ:
            - [ { x: 700, y: 260, as: "代码行" }, { x: 300, y: 205, as: "块外·正文左缘外" } ]
          min: 8
  - name: (eink) 把光标放进第 1 行
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: (eink) 抢前台
    do: focusWindow
    retries: 4
  - name: (eink) 同一条扩选
    do: keys
    keys:
      [
        "ctrl+a",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
      ]
    expect:
      - label: 选区覆盖了代码块（粗体显露）
        editor: { has: "**中间粗体**" }
  - name: (eink) 判底色与反白
    do: sleep
    ms: 600
    expect:
      - label: eink 的 --sel 是纯黑（不透明）⇒ 块内选中处 == 块外选中处（与 light 同一条绝对判据）
        pixel:
          same:
            - [ { x: 700, y: 260, as: "选区内·代码行" }, { x: 900, y: 169, as: "选区内·块外正文" } ]
      - label: eink 的块内选中处 MUST 与块外底色可辨（黑底 vs 白底）
        pixel:
          differ:
            - [ { x: 700, y: 260, as: "选区内·代码行" }, { x: 300, y: 205, as: "块外·正文左缘外" } ]
          min: 8
      - label: eink 块内选中处仍有可辨字形（黑底白字；黑底黑字会让亮度跨度塌到 0）
        pixel:
          contrast:
            - { x: 419, y: 260, as: "选区内·代码行笔画", min: 60 }
      - shot: 底色-eink

teardown:
  - label: 收尾：三组手势（light / dark / eink）都没有改动 fixture 文件
    file: { path: m288-code.md, unchangedSince: 手势前, mtimeUnchangedSince: 手势前 }
  - label: 收尾：粗体定界符仍在源码里（没有把手势当成编辑）
    file: { path: m288-code.md, has: "/\\*\\*中间粗体\\*\\*/" }
---

# 代码块内选区底色可见（块底色 MUST NOT 盖住 drawSelection 自绘的选区）

## 这个场景验什么

**缺陷**（Alex 报告，2026-09-28）：md 的围栏代码块里扩选 / 拖选，选区看不见。定性（M288）：

- **机制是绘制顺序，不是撞色**（撞色是残留的第二档）。`drawSelection` 把选区画在
  `.cm-scroller` 里一个**负 z-index** 的层上（CM 的 `layer({above:false})` ⇒ `z-index = -1 - pos`，
  真机与 chromium 都实测 `-2`），而代码块底色是 in-flow 块的背景（`.cm-lp-codeblock-scroll` 的
  `background` + `.cm-line.cm-lp-codeblock-line` 的 `background`），按 CSS 绘制顺序排在负 z-index
  层**之后** ⇒ 选中处与未选中处逐像素同色。
- 三主题真机读数（M288 定性轮）：light 差 **0**、eink 差 **0**（被 100% 盖住）；dark 差 **14**
  （`--code-bg` 半透明，选区的色恰好透出来——dark 因此**修前也「可辨」**，见下）。
- **修法**：块底色移到容器的两个负 z-index 伪元素上（`src/style.css` 的
  `.cm-lp-codeblock-scroll::before/::after`；代码块折行档没有容器，由 `.cm-lp-codeblock-slot::before`
  承担），行自身那份底色在 slot 在场时让位。chromium 侧的同一不变量见
  `tests/visual/scenes/m288-codeblock-selection.spec.ts`（主题 × 折行口径 × 选区形态矩阵）。

## 判据为什么这样写（区分度是实测钉的）

| 判据 | 修前 / 修后（真机实测） | 说明 |
|---|---|---|
| 块内选中处 == **同一选区在块外正文上**的底色 | light：修前**差 11**（读到块底色 `#f2f1ec`）→ 修后差 0；eink：修前**差 240** → 修后差 0 | **主判据**。light / eink 的 `--sel` 不透明 ⇒ 有绝对签名可用：块内选中处的底色必须等于同一选区画在别处的底色。被块底色盖住时读到的是块底色 |
| 选区前：代码行底色 != 块外正文底色 | 修前修后都成立（light 差 11 / dark 差 11 / eink 差 15） | **标定 + 防空转**：它证明采样点真的落在代码块上（坐标漂到块外会退化成「同色」判 FAIL），也证明「块外同色」不是整屏同色 |
| 同一行代码上两点同色（选区内） | 修前修后都成立 | 色块稳定性读数：证明采样点落在同一个色块里，不是落在边缘上 |
| dark：块内选中处 != 块外底色 | 修前修后都成立（修后 `#47484c` vs `#222327`，差 36） | **dark 的诚实登记**：`--sel` 半透明 ⇒ 合成色随表面变，绝对签名不成立，且 dark 修前也「可辨」（差 14）。这一条是**回归守卫**，不是区分度判据——不要把 dark 的 PASS 读成「这条缺陷在 dark 也被验过」 |
| eink：块内选中处的亮度跨度 ≥ 60 | 修后 ≈ 240（黑底白字） | 反白语义（`--sel` 黑底 + `::selection` 的 `--selText`）在块内同样成立；黑底黑字会让跨度塌到 0 |

- **撞色（Alex 的另一半猜测）确实存在，但不是本场景的判据**：修后 light 的块内选区与块底色仍只差
  11（`--sel` `#e8e7e1` 与 `--code-bg` `#f2f1ec` 的通道差），而 `--sel` 与正文底色差 21。要不要给
  代码块内的选区一个更重的变体，是 token 层（`docs/specs/design-tokens-v1.md`）的决定，不在本次
  修复的范围内（见 review-request 的读数表与 M288 的 backlog 拟记账段落）。

## 什么算「选区覆盖了代码块」（本场景的覆盖证据）

代码块的源码**恒常显示**（不像粗体 / 分隔线那样「选区触及即显露源码」），而套件读不到 AX 选区
（README「已知行为边界」的「光标/选区不可断言」）。因此本场景用**连续选区 + 一个可显露的锚点**
把覆盖面证死：

1. 锚点在文档第 1 行（`clickEditor` 点在编辑器顶部 + ⌃A 到行首）；
2. 头越过整个代码块——证据是**块之后那一段**里的「中间粗体」显露为源码
   （`editor: has "**中间粗体**"`），只有头越过整块才可能触及它；
3. CM 的选区是连续区间 ⇒ 代码块整块落在选区内。

扩选按键**刻意多按**（⌃⇧N ×16，超出文档行数）：多余的按键幂等，装置因此不依赖行数精确对齐。
若某次运行里粗体没有显露，上面那条断言判 FAIL——那时「块内读到块底色」与「选区根本没到」
就分得开（后者伴随粗体不显露）。

采样点（窗口局部，1200×800 套件窗口；三个坐标都经过「选区前块底色在场」那一步的标定，
坐标漂了会红）：

| 点 | 坐标 | 落在哪 |
|---|---|---|
| 代码行（块内） | `(700, 260)` / `(800, 260)` | 第 2 行代码 `code line two` 右段的落空底色带（行盒比文字长） |
| 块外选中 | `(900, 169)` | 第 1 行正文的行尾开放端（选区内、无字形） |
| 块外底色 | `(300, 205)` | 正文列左缘外（选区外） |
| eink 笔画 | `(419, 260)` | 代码行上 `code` 的字母笔画（亮度跨度读数） |

## 已知边界

- **不判手感**：选中底色在代码块上的观感（以及它比正文上的选中淡一半这件事）归 Alex 手感项，
  本场景只钉「选区被画出来了」。
- **未覆盖：鼠标拖拽那一拍**（与场景 64 同一条边界）：合成 `drag` 在本机会把中文输入法的预编辑
  提交进文档（README 的「已知边界」），因此本场景用键盘扩选建同一条选区。判据是「块底有没有盖住
  选区」，与手势无关。
- **未覆盖：代码块横滚（长行）时的读数**：本 fixture 的行都比栏宽短，没有横向滚动。块底色画在
  容器（不随内容滚动）上，横向滚动那一档由 chromium 侧的矩阵（`withLongLine`）覆盖。
