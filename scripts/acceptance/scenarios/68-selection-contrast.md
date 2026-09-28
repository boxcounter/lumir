---
id: "68-selection-contrast"
item: 68
title: 三主题编辑器选区带可辨（含 eink 选中区文字可读）
steps:
  - name: 造 fixture（场景自建，不动 fixtures 目录）
    do: vaultWrite
    file: m291-contrast.md
    content: |
      第一段正文，给选区一个起点。

      > 引用块里的 **粗体**、`行内码` 与普通文字。

      ```js
      const alpha = 1;
      "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM"
      const gamma = 2;
      ```

      末尾一段正文。
    expect:
      - label: fixture 已落盘（读不到一律 FAIL）
        file: { path: m291-contrast.md, exists: true }
      - label: 着色行的字符串在源码里（它是本场景 eink 判据的被测对象）
        file: { path: m291-contrast.md, has: "MMMM" }
      - shot: fixture

  - name: 等一拍再读（外部写入后立刻读 AX 会与 DOM 刷新抢）
    do: sleep
    ms: 1200

  - name: 打开 fixture（点左栏树行）
    do: open
    file: m291-contrast.md
    marker: "第一段正文"
    expect:
      - shot: 渲染态

  - name: 记下文件基线（本场景的手势一个都不许改文档）
    do: record
    file: m291-contrast.md
    as: 手势前

  - name: 标定采样点（选区建立**之前**：证明四个 y 各自落在预期的承载面上，坐标漂了就红）
    do: sleep
    ms: 400
    expect:
      - label: 首行与内容列左缘外都是纸（同一个 y 上两点同色）
        pixel:
          same:
            - [ { x: 900, y: 169, as: "首行·行内" }, { x: 300, y: 169, as: "首行·内容列左缘外" } ]
      - label: 字符串代码行的行区带 MUST 与纸可辨（代码块在场；标定 y=271 落在代码块上）
        pixel:
          differ:
            - [ { x: 900, y: 271, as: "字符串代码行" }, { x: 300, y: 271, as: "内容列左缘外" } ]
          min: 8
      - label: 引用块行也是纸（标定 y=198）
        pixel:
          same:
            - [ { x: 900, y: 198, as: "引用块行·行内" }, { x: 300, y: 198, as: "引用块行·内容列左缘外" } ]
      - shot: 标定-light

  - name: 把光标放进第 1 行（点编辑器正文起点；正文内元素没有 AX bbox，只能按坐标点）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里（键盘注入的前置）
        ax: { focused: "AXTextArea" }

  - name: 抢前台（同机别的 app 抢走前台时后台注入的 chord 会丢键——REVIEW.md 第 11 条）
    do: focusWindow
    retries: 4

  - name: ⌃A 到行首 + ⌃⇧N ×14 向下扩选（扩到文末；多出来的按键幂等，装置因此不依赖行数精确对齐）
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
      ]
    expect:
      - label: 手势不改文档（sha256 + mtime 双比）
        file: { path: m291-contrast.md, unchangedSince: 手势前, mtimeUnchangedSince: 手势前 }
      - label: 选区覆盖了强调范围——`**粗体**` 的定界符回到 DOM（那段因此是被**重建**出来的，缺陷的现场前提）
        editor: { has: "**粗体**" }
      - shot: 选区起点-light

  - name: 判选区带（light）：起点左界 / 中段 / 代码块内，三处都 MUST 可辨
    do: sleep
    ms: 600
    expect:
      - label: 选区**起点**的边界 MUST 可辨——行内 900 与内容列左缘外 300 在同一 y 上分属带内 / 带外
        pixel:
          differ:
            - [ { x: 900, y: 169, as: "选区内·首行" }, { x: 300, y: 169, as: "选区外·内容列左缘外" } ]
          min: 40
      - label: 选区**中段** MUST 可辨
        pixel:
          differ:
            - [ { x: 900, y: 198, as: "选区内·引用块行" }, { x: 300, y: 198, as: "选区外·内容列左缘外" } ]
          min: 40
      - label: "**代码块内**的带 MUST 可辨（块底色不再盖住带）"
        pixel:
          differ:
            - [ { x: 900, y: 271, as: "选区内·字符串代码行" }, { x: 300, y: 271, as: "选区外·内容列左缘外" } ]
          min: 40
      - label: 带在代码块上与在正文上同色（同一选区同一带；light 的带不透明 ⇒ 绝对判据）
        pixel:
          same:
            - [ { x: 900, y: 271, as: "选区内·字符串代码行" }, { x: 900, y: 169, as: "选区内·首行" } ]
      - shot: 选区-light

  - name: 切到 dark 档
    do: configWrite
    theme: dark
  - name: (dark) 重新打开 fixture
    do: open
    file: m291-contrast.md
    marker: "第一段正文"
  - name: (dark) 标定采样点（选区前）
    do: sleep
    ms: 400
    expect:
      - label: 字符串代码行的行区带 MUST 与纸可辨
        pixel:
          differ:
            - [ { x: 900, y: 271, as: "字符串代码行" }, { x: 300, y: 271, as: "内容列左缘外" } ]
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
      ]
    expect:
      - label: 手势不改文档
        file: { path: m291-contrast.md, unchangedSince: 手势前, mtimeUnchangedSince: 手势前 }
  - name: (dark) 判选区带
    do: sleep
    ms: 600
    expect:
      - label: dark 的带是半透明白（合成色随承载面变）⇒ 判「起点左界、中段、代码块内都 MUST 与选区外可辨」
        pixel:
          differ:
            - [ { x: 900, y: 169, as: "选区内·首行" }, { x: 300, y: 169, as: "选区外·内容列左缘外" } ]
          min: 40
      - label: dark 选区中段 MUST 可辨
        pixel:
          differ:
            - [ { x: 900, y: 198, as: "选区内·引用块行" }, { x: 300, y: 198, as: "选区外·内容列左缘外" } ]
          min: 40
      - label: dark 代码块内的带 MUST 可辨
        pixel:
          differ:
            - [ { x: 900, y: 271, as: "选区内·字符串代码行" }, { x: 300, y: 271, as: "选区外·内容列左缘外" } ]
          min: 40
      - label: dark 的合成色随承载面变 ⇒ 代码行与正文行上的带「同色」这条不成立，如实登记为相对读数
        pixel:
          same:
            - [ { x: 800, y: 271, as: "代码行右段 a" }, { x: 900, y: 271, as: "代码行右段 b" } ]
      - shot: 选区-dark

  - name: 切到 eink 档（本档的坏法不是「带看不见」，是「带里的字被吞」）
    do: configWrite
    theme: eink
  - name: (eink) 重新打开 fixture
    do: open
    file: m291-contrast.md
    marker: "第一段正文"
  - name: (eink) 标定采样点（选区前）
    do: sleep
    ms: 400
    expect:
      - label: 字符串代码行的行区带 MUST 与纸可辨（eink 是白底黑框里的灰行区）
        pixel:
          differ:
            - [ { x: 900, y: 271, as: "字符串代码行" }, { x: 300, y: 271, as: "内容列左缘外" } ]
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
      ]
    expect:
      - label: 手势不改文档
        file: { path: m291-contrast.md, unchangedSince: 手势前, mtimeUnchangedSince: 手势前 }
  - name: (eink) 判带与带内文字
    do: sleep
    ms: 600
    expect:
      - label: eink 的带 MUST 与选区外可辨（起点左界）
        pixel:
          differ:
            - [ { x: 900, y: 169, as: "选区内·首行" }, { x: 300, y: 169, as: "选区外·内容列左缘外" } ]
          min: 40
      - label: eink 代码块内的带 MUST 可辨（带不透明 ⇒ 与正文上的带同色）
        pixel:
          same:
            - [ { x: 900, y: 271, as: "选区内·字符串代码行" }, { x: 900, y: 169, as: "选区内·首行" } ]
      - label: eink 选中区里**着色**字符串的笔画 MUST 可辨（选中区内的文字像素与选区底色可区分；黑底黑字会让亮度跨度塌到 0）
        pixel:
          contrast:
            - { x: 500, y: 278, as: "选区内·着色字符串笔画", min: 60 }
      - label: eink 选中区里**强调段**（显露重建出来的那一段）的笔画 MUST 可辨——Alex 的引用块粗体现场
        pixel:
          contrast:
            - { x: 549, y: 198, as: "选区内·强调段笔画", min: 60 }
      - label: eink 选中区里**行内 code 药丸**的字 MUST 可读（药丸自带底色压在带之上，但字色必须可读）
        pixel:
          contrast:
            - { x: 596, y: 199, as: "选区内·药丸笔画", min: 60 }
      - label: eink 选中区里正文的笔画同样 MUST 可辨
        pixel:
          contrast:
            - { x: 420, y: 169, as: "选区内·正文笔画", min: 60 }
      - shot: 选区-eink

  - name: (eink) chrome 侧证据①：树当前行的截图（判据在 chromium，这里是给 Alex 过目的现场）
    do: sleep
    ms: 300
    expect:
      - shot: eink-chrome-树当前行
  - name: (eink) chrome 侧证据②：点树头（坐标兜底——套件的 AX 节点查不到该按钮）并拍浮层当前项
    do: click
    target: { x: 120, y: 62 }
    expect:
      - shot: eink-chrome-浮层当前项（浮层没开时这张就是树头现场，如实留档不粉饰）

teardown:
  - label: 收尾：三组手势（light / dark / eink）都没有改动 fixture 文件
    file: { path: m291-contrast.md, unchangedSince: 手势前, mtimeUnchangedSince: 手势前 }
  - label: 收尾：着色行的字符串仍在源码里（没有把手势当成编辑）
    file: { path: m291-contrast.md, has: "MMMM" }
---

# 三主题编辑器选区带可辨（含 eink 选中区文字可读）

## 这个场景验什么

**缺陷**（Alex 报告，2026-09-28，两档同批出现）：

1. **撞色**（light / dark）：编辑器选区带与它要压住的承载面太近——light 正文底色差 21、
   light 代码块行区带只差 11、dark 正文底色差 14。Alex 原话「我人眼压根看不出来我从哪里选中的」。
2. **eink 的「黑底反白」在编辑器只有一半成立**：编辑器选区由 CM 的 `drawSelection` 画在**文字之下**，
   文字反白只能靠原生选区的 `::selection { color }`，而它**盖不过子元素的显式色**——代码块的语法
   着色 span（`.cm-lp-tok-*`，eink 下 `#000`/`#6e6e6e`）与头部条都写了显式 color。于是选中区里
   **未着色**的文字反白成白字、**已着色**的那段仍是黑字压黑底 ⇒「code block 几乎看不到文字」。

修法与取值（真源 [design-tokens-v1.md](../../../docs/specs/design-tokens-v1.md) §编辑器选区带）：
新增 `--sel-band` 一个 token 专供编辑器选区带（chrome 的选中态继续用 `--sel` + `--sel-text`，
规则④在那里的显式反白照旧成立），带与两种承载面（`--content-bg`、代码块行区带）的每通道最大差
MUST ≥ 40；eink 另把编辑器内的原生选区字色复位成 `--text`（带已是明度带，再反白就是白字压浅灰）。

## 判据为什么这样写

| 判据 | 修前 / 修后（窗口局部 7×7 主色） | 说明 |
|---|---|---|
| 起点左界：选区内 900 vs 内容列左缘外 300（同一 y） | light 修前 **21** → 修后 61；dark 修前 **14** → 修后 49；eink 修前修后都 255 | **主判据**（light / dark 的区分度就在这一条）。「从哪里开始选中」= 选区边界看不看得出来 |
| 中段：第三行同上 | light 修前 21 → 修后 61；dark 修前 14 → 修后 49 | 中段与起点同判据，防止「只有首行画了带」 |
| 代码块内 vs 选区外 | light 修前 21 → 修后 61；dark 修前 **35** → 修后 64；eink 修前修后都 240+ | M288 的不变量在**对比度**这一档上的延伸（M288 修的是「块底色盖住带」，本场景修的是「带本身太淡」） |
| light / eink：代码行上的带 == 正文行上的带（`same`） | 修前 light 差 11 → 修后 0；eink 修前 **240** → 修后 0 | 带**不透明**时的绝对签名：同一选区在两种承载面上必须同色。eink 修前那 240 就是「带被块底色盖住」的读数 |
| eink：选区内**着色字符串**的亮度跨度 | 修前 **0** → 修后 160 | **eink 的区分度判据**：着色 span 的显式色不被 `::selection` 覆盖 ⇒ 黑底上黑字，跨度塌到 0。仓内的 M288 场景 66 采样到的是**未着色**的标识符（那里反白生效、修前也亮），所以它对本条是假绿——这是本场景与 66 的分工，不是重复 |
| eink：选区内正文笔画的跨度 | 修前修后都大（未着色文字会反白） | **非区分度判据**，如实登记：它只证「正文那一半本来就没事」 |

采样点（窗口局部，1200×800 套件窗口）：

| 点 | 坐标 | 落在哪 |
|---|---|---|
| 首行（正文） | `(900, 169)` / `(300, 169)` | 第 1 行正文的行内落空带 / 内容列左缘外（选区外） |
| 引用块行（选区中段） | `(900, 198)` / `(300, 198)` | 第 3 行（引用块） / 同上 |
| 字符串代码行 | `(900, 271)` / `(300, 271)` | 第 7 行（代码块内、被选中的字符串行） / 同上 |
| 强调段笔画 | `(549, 198)` | 引用块里 `粗体` 两字的笔画（显露后它是源码文字，区位 x=519 起） |
| 药丸笔画 | `(596, 199)` | 引用块里行内 code「行内码」的笔画（药丸盒 x=563 起、宽 65） |
| 着色笔画 | `(500, 271)` | 字符串 token 的笔画（代码文本自 x≈396 起，x=500 稳落在字符串内） |
| 正文笔画 | `(420, 169)` | 第 1 行正文的字形 |

y 坐标与 chromium 场景 `tests/visual/scenes/m291-selection-contrast.spec.ts` **同一份 fixture（逐行同构）**，
两侧由 DOM 几何 / 手写坐标各量一次（chromium 侧实测首行 y=152.1+16.75≈169、字符串行 y=269.0+9.3≈278）。
坐标漂了会在**标定步**先红（「字符串代码行 MUST 与纸可辨」），不会把「点打在块外」当产品缺陷。

## 已知边界

- **起点落点只能是行首**：套件的键盘路径给不出行内锚点（⌃A 到行首 + ⌃⇧N 逐行扩选）。
  行内中点起点的两侧判据在 chromium 侧（该 spec 的 `startIn` / `startOut` 用起点**字符**坐标取点）。
  本场景用「内容列左缘 vs 行内」判边界可见性，与「从『取』字开始选中」是同一不变量。
- **不判手感**：带够不够醒目、dark 下选区内的注释变淡到什么程度（`--sel-band` 的已知代价，
  见 tokens 文档）归 Alex 手感项，本场景只钉数值口径与「文字可读」两条。
- **未覆盖：鼠标拖拽那一拍**（与场景 64 / 66 同一条边界）：合成 `drag` 会把中文输入法的预编辑
  提交进文档（README「已知边界」），故用键盘扩选建同一条选区。
- **dark 的「同色」判据不成立**：带是半透明白，合成色随承载面变（代码行上比正文行上亮 16），
  因此 dark 只走相对判据，代码行上的两点同色作稳定性读数——与 M288 场景 66 的同一登记。
