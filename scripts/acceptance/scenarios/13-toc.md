---
id: "13-toc"
item: 13
title: 轻量大纲：位置指示 / 浮层条目 / 键盘与鼠标跳转 / 关闭 / 空标题与 frontmatter 边界
fixtures: [toc-outline.md, toc-frontmatter.md, toc-plain.md]
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
        ax: { not: "↑↓ 选择" }

  - name: 点击 masthead 的位置指示段展开大纲（按 help 命中，不看标题链文本）
    do: click
    target: { role: AXButton, help: "点击展开大纲" }
    expect:
      - shot: 浮层展开
      - label: 浮层已展开（提示串只存在于浮层里）
        ax: { has: "↑↓ 选择" }
      - label: H3 条目在列表里（文档块 + 条目 = 2 行以上）
        ax: { count: { pattern: "甲小节细节", min: 2 } }
      - label: H6 条目也在列表里（H1–H6 全覆盖）
        ax: { count: { pattern: "六层标题", min: 2 } }

  - name: 鼠标点浮层里的「乙小节」条目跳转（AXPress 路径，确定性最高）
    do: click
    target: { role: AXStaticText, name: "^乙小节$" }
    expect:
      - shot: 鼠标跳转后
      - label: 浮层已收起
        ax: { not: "↑↓ 选择" }
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
        ax: { has: "↑↓ 选择" }

  - name: ↓ 在浮层内移动（浮层就地消费，不穿透文档）
    do: keys
    keys: ["Down"]

  - name: ↓ 之后键盘游标落在「乙小节细节」条目上
    do: sleep
    ms: 400
    expect:
      - label: 浮层仍开着（↓ 没有关掉浮层）
        ax: { has: "↑↓ 选择" }
      - label: 条目的 AX 行同时带该条 label 与 focused 标记（游标真的下移了一条）
        ax: { count: { pattern: "/AXStaticText \\(乙小节细节\\).*\\(focused\\)/", exact: 1 } }

  - name: Enter 跳转到键盘游标选中的标题
    do: key
    key: "return"
    expect:
      - shot: 键盘跳转后
      - label: 浮层已收起（Enter 是跳转，不是留在浮层里）
        ax: { not: "↑↓ 选择" }
      - label: 位置指示给出跳转目标的完整标题链（含父级与已合并的父标题）
        ax: { has: "第一部分 › 乙小节乙小节正文。 › 乙小节细节" }

  - name: ⌘⇧O 再开（同一个键开→关→开）
    do: key
    key: "cmd+shift+o"
    expect:
      - label: 浮层已展开
        ax: { has: "↑↓ 选择" }

  - name: Esc 关闭浮层
    do: key
    key: "escape"
    expect:
      - label: 浮层已收起
        ax: { not: "↑↓ 选择" }
      - label: Esc 只关浮层，不动文档
        editor: { has: "乙小节细节正文。" }

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
        ax: { has: "↑↓ 选择" }
      - label: frontmatter 里的 `#` 注释行没有被当成标题（渲染态里它不在正文里）
        ax: { not: "幽灵标题" }
      - label: 真正的标题照常列出（文档块 + 条目 = 2 行以上）
        ax: { count: { pattern: "前言下的真标题", min: 2 } }

  - name: Esc 收起浮层
    do: key
    key: "escape"
    expect:
      - label: 浮层已收起
        ax: { not: "↑↓ 选择" }

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
        ax: { not: "↑↓ 选择" }
---

轻量大纲（TOC popover）的**行为**判定（M148）。规格见
`openspec/changes/add-toc-outline/specs/toc-outline/spec.md`，入口形态由 Alex 裁决：
masthead 显示当前标题路径（兼作位置指示），点击它或按 ⌘⇧O 展开浮层大纲。

## 断言口径（为什么这么写）

- **浮层「开」的判据是提示串 `↑↓ 选择 · Enter 跳转 · Esc 关闭`（文案 D86）**：它只存在于
  浮层里，文档正文与文件树都不会出现——用它判「浮层开着」不存在子串型假绿。反过来
  `not: "↑↓ 选择"` 就是「浮层已收起」的判据。
- **条目在列表里用 `count … min: 2`**：同一条标题文本在 AX 里出现两次——渲染态的文档块一次、
  浮层条目一次（M148 实测：浮层在 AX 里落成 `AXList (大纲)` + 逐条 `AXStaticText (标题)`，
  每条带 `actions=[AXPress]`）。只写 `has` 会被文档正文满足（等价于子串，无区分度），这正是
  REVIEW.md 第 1 条要挡的形态。
- **浮层条目的 AX 结构（M148 实测，供后续场景复用）**：`AXList (大纲)` 的 label 来自
  `aria-label`；条目是 `AXStaticText (条目标题)`，带 `AXPress` 动作；**键盘游标所在的那一条**
  带 `(focused)` 标记——这正是 `↓` 的判定通道：断言写成「同一行同时出现条目 label 与
  `(focused)`」（`/AXStaticText \(乙小节细节\).*\(focused\)/`），比「浮层还开着」这种恒真断言
  强得多。
- **步骤顺序按「确定性优先」排（M148 全量轮实证）**：`key` / `keys` 都是**盲发**（不可回读的
  chord 不做重试，见 README 已知边界），一次丢键会连带后续依赖它的步骤一起 FAIL——全量轮里
  12-links 先跑（它会真的唤起浏览器与文本编辑），13-toc 的 `Enter` 就丢过一次，连带 6 条断言
  失败。因此本场景把**核心语义放确定性路径**：跳转的落点与光标位置由「鼠标点条目（AXPress，
  不经过键盘注入）+ ⌃K 行尾合并」这条链验证；键盘导航（↓ + Enter）单独成块放在后面，丢键时
  只波及本块。
- **位置指示的标题链是光标的函数**：指示段口径是「光标在可见范围内就取光标，光标滚出视口才
  退化为视口顶部」（`src/toc.ts` 的 `anchorPos`）。跳转是 `selection` + `scrollIntoView` 一次
  dispatch，跳转后光标必在可见范围内——所以「链条含父级」这条断言只有在光标真落到目标标题段时
  才成立；只滚动不改选区的实现会停在上一段（或链条缺一层）而 FAIL。
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
  本场景依赖「跳转的 `close()` 把焦点交还编辑器」，故 ⌃K 紧跟跳转；若把 ⌃K 挪到别的上下文，需要
  先 `clickEditor` 或先做一次跳转。
- **鼠标跳转**：点浮层条目走的是与键盘同一跳转实现（`src/toc.ts` 的 `jumpTo`）。

## 环境与副作用

隔离 `XDG_CONFIG_HOME` 与合成 vault（`/tmp/lumir-m102-acceptance`），端口
`LUMIR_ACCEPTANCE_PORT`（默认 1430）。键盘步骤需要前台，runner 会 AXRaise Lumir 抢前台焦点。

本场景**会写验收 vault**：⌃K 的合并经 ⌘S 落盘到 `toc-outline.md`（合成 vault，下一次运行按
`fixtures/` 重置）。用户真实 vault 全程只读。

## 本场景会真唤起系统应用吗

不会。本场景不打开外链、不调用系统默认应用。
