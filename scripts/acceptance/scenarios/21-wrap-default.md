---
id: "21-wrap-default"
item: 21
title: 折行口径默认值（文件折行、代码块不折行）与代码块横滚容器
marker: "折行口径探针"
steps:
  - name: 造一份含超长代码行与超长正文行的探针文档
    do: vaultWrite
    file: wrap-probe.md
    content: |
      # 折行口径探针

      正文段落：一行普通长度的句子。

      超长正文行（刻意超过阅读栏宽）：折行口径的默认值来自 config.json 的 editor.line_wrap，运行期翻转由 view.toggle-line-wrap 承担；这一行刻意写得很长，远超阅读栏宽，默认折行时应折成多个视觉行：PROSE-END-MARK。

      ```text
      vault: Everything-copy | file: Logbook/2026-09/2026-09-18.md | note: the quick brown fox jumps over the lazy dog 0123456789 | flag: true | count: 42 | tail: CODE-END-MARK
      ```

      ```text
      short code line
      ```

      尾段：代码块容器不得改变下方内容的纵向位置。
    expect:
      - label: 探针文档已落到验收 vault
        file: { path: wrap-probe.md, exists: true }
  - name: 打开探针文档（配置里没有 editor 折行两项 → 走 Rust Default）
    do: open
    file: wrap-probe.md
    marker: "折行口径探针"
    expect:
      - label: 代码行文本在 AX 树里（后面的断言都有正观测垫底）
        ax: { has: "CODE-END-MARK" }
      - label: 代码块的横滚容器在 AX 树里（读屏名 Markdown 代码块 1）——默认 code_block_wrap=false 的机器判据
        ax: { has: "Markdown 代码块 1" }
      - label: 正文与代码行都在编辑器文本里（打开不改文档）；探针正文刻意不含半角双引号
        editor: { has: "PROSE-END-MARK" }
      - shot: 默认口径
  - name: 把焦点交给编辑器内容区（给 Tab 一个确定的起点）
    do: clickEditor
    expect:
      - label: 焦点在编辑器内容区（Tab 的起点确定，才谈得上「Tab 进容器」）
        ax: { focused: "AXTextArea" }
      - shot: 编辑器聚焦
  - name: Tab 把焦点移进代码块容器
    do: key
    key: "tab"
    expect:
      - label: 焦点进入代码块容器（容器是 role=region → AXGroup，成为唯一的 focused 节点）
        ax: { focused: "AXGroup" }
      - shot: Tab 之后
  - name: 容器焦点内按 → 横滚 120px
    do: key
    key: "right"
    expect:
      - label: 焦点仍在容器上（横滚键由容器消费，不落回 caret 路径）
        ax: { focused: "AXGroup" }
      - shot: 右移 120px
  - name: End 滚到最右端
    do: key
    key: "end"
    expect:
      - shot: 最右端
  - name: Home 回最左，Escape 交还焦点
    do: keys
    keys: ["home", "escape"]
    expect:
      - label: Escape 之后焦点回到编辑器内容区
        ax: { focused: "AXTextArea" }
      - label: 全程不改文档（滚动的容器只动显示，不碰正文）
        editor: { has: "CODE-END-MARK" }
      - shot: 回到最左并交还焦点
---

说明（M180，change `line-wrap-options`）：默认口径 = 文件折行（`editor.line_wrap` 默认 `true`）、
代码块不折行（`editor.code_block_wrap` 默认 `false`）。本场景不写 `config:`，因此 config.json 里没有
`[editor]` 的折行两项，应用走 Rust 侧 `Default`——这正是「老配置文件原样启动」的真实形态。

三条机器判据：① **横滚容器在不在 AX 树里**（容器带 `role=region` + `aria-label="Markdown 代码块 N"`，
默认口径下它在）——默认 `code_block_wrap=false` 的判据；② **焦点归属**（Tab 后 `focused` 是容器
`AXGroup`、Escape 后回到 `AXTextArea`）——容器键盘可达且焦点键由容器消费的判据；③ **文档文本未变**
（`editor.has`）。其余两条轴（正文行折 / 代码块不折）在真机侧没有计算属性通道可读——**视觉口径看
`shots/`**：默认口径图与 → / End / Home 三张滚动序列（横滚的发生与幅度一眼可判）。

**焦点起点很关键**（M180 实测）：`open` 之后焦点落在左栏的文件行按钮上（AX dump 里
`AXButton (wrap-probe.md) … (focused)`），此时一次 Tab 只会走到左栏的下一行、进不了编辑器——
所以要先用 `clickEditor` 把焦点交给 `.cm-content`，Tab 才会按 DOM 序进入它内部的容器
（容器 `tabindex=0`，是 `.cm-content` 之后的第一个可 Tab 元素）。这是场景写法的坑，不是产品行为。

**探针文档刻意不含半角双引号**：套件解析 AX 时用 `/=\s*"([\s\S]*?)"/` 取 `AXTextArea` 的 value
（`lib/ax.mjs`），非贪婪匹配会在文档里出现的第一个 `"` 处截断——正文里带 `"` 会让 `editor: has`
断言读到半截文本（`not` 断言则可能因此假 PASS）。这是解析侧既有的边界，本场景的构造避开了它并
把边界记在这里（正式 finding 已按协议提交）。

已知边界（如实记录，别当 bug 追）：容器在编辑器内、没有 AX bbox，所以无法按坐标/AX 节点点击它；
滚动的**幅度**在真机侧只能看截图（横滚位置不在 AX 通道里），120px 步进与 End/Home 的机器断言在
视觉层（`tests/visual/scenes/render-codeblock.spec.ts` 的容器键盘场景）。

