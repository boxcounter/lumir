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
      {"vault":"Everything-copy","file":"Logbook/2026-09/2026-09-18.md","note":"the quick brown fox jumps over the lazy dog 0123456789","flag":true,"count":42,"tail":"CODE-END-MARK"}
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
      - label: 代码行文本在 AX 树里（后面的负向/正向断言都有正观测垫底）
        ax: { has: "CODE-END-MARK" }
      - label: 代码块的横滚容器在 AX 树里（读屏名 Markdown 代码块 1）——默认 code_block_wrap=false 的机器判据
        ax: { has: "Markdown 代码块 1" }
      - label: 正文与代码行都在文档里（打开不改文档）
        editor: { has: "PROSE-END-MARK" }
      - shot: 默认口径
  - name: Tab 把焦点移进代码块容器
    do: key
    key: "tab"
    expect:
      - shot: Tab 之后
  - name: 容器焦点内按 → 横滚 120px
    do: key
    key: "right"
    expect:
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
---

说明（M180，change `line-wrap-options`）：默认口径 = 文件折行（`editor.line_wrap` 默认 `true`）、
代码块不折行（`editor.code_block_wrap` 默认 `false`）。本场景不写 `config:`，因此 config.json 里没有
`[editor]` 的折行两项，应用走 Rust 侧 `Default`——这正是「老配置文件原样启动」的真实形态。

机器判据只有一条：**横滚容器在不在 AX 树里**（容器带 `role=region` + `aria-label="Markdown 代码块 N"`，
默认口径下它在）。其余两条轴（正文行折 / 代码块不折）在真机侧没有计算属性通道可读——**视觉口径看
`shots/`**：默认口径的整页图、以及 Tab → → / End / Home 四张滚动序列（滚动的发生与步进幅度一眼可判）。
`Escape` 后焦点回到 `AXTextArea` 是键盘路径的机器判据（容器焦点键走统一键位表，见
`openspec/specs/keymap-commands` 的「轨道 D 的 widget 滚动键纳入统一键位表」）。

已知边界（如实记录，别当 bug 追）：容器在编辑器内、没有 AX bbox，所以无法按坐标/AX 节点点击它，
只能靠 `Tab` 移焦点；若焦点顺序在某个系统版本上变了，滚动的机器证据就只剩截图序列。
