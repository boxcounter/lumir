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

  - name: 把焦点交给编辑器内容区（后续按键的确定起点）
    do: clickEditor
    expect:
      - label: 焦点在编辑器内容区
        ax: { focused: "AXTextArea" }
      - shot: 编辑器聚焦

  - name: 记录编辑器文本基线（后面两处「未变」断言逐字节比，不是子串）
    do: recordEditor
    as: 编辑器基线
    expect:
      - label: 编辑器文本可读（不可读时 recordEditor 直接报错，不在空值上空转）
        editor: { has: "CODE-END-MARK" }

  - name: 记录探针文档的磁盘基线（本场景全程不写盘）
    do: record
    as: 探针文档基线
    file: wrap-probe.md

  - name: 编辑器内按 Tab：焦点不再进入代码块容器（list-tab-indent 接管后的真实状态）
    do: key
    key: "tab"
    expect:
      - label: 焦点仍在编辑器内容区（TAB 归列表缩进命令；命中即消费，不落回原生焦点遍历——本行不是列表项 ⇒ 命令无操作）
        ax: { focused: "AXTextArea" }
      - label: 编辑器文本逐字节不变（代码块内的 TAB 不动文档）
        editor: { unchangedSince: 编辑器基线 }
      - shot: Tab-焦点不再进容器

  - name: 容器焦点内的五条滚动键已无从触发（入口被移除）：按键只作用于编辑器
    do: keys
    keys: ["right", "end", "home", "escape"]
    expect:
      - label: 焦点始终在编辑器内容区（`←` `→` `Home` `End` `Escape` 没有到达容器的路径）
        ax: { focused: "AXTextArea" }
      - label: 编辑器文本逐字节不变（容器横滚只动显示；此处连显示都不动）
        editor: { unchangedSince: 编辑器基线 }
      - label: 探针文档 sha256 与 mtime 都不动（容器与键位都不碰正文）
        file: { path: wrap-probe.md, unchangedSince: 探针文档基线, mtimeUnchangedSince: 探针文档基线 }
      - shot: 滚动键-焦点仍在编辑器
---

说明（M180，change `line-wrap-options`）：默认口径 = 文件折行（`editor.line_wrap` 默认 `true`）、
代码块不折行（`editor.code_block_wrap` 默认 `false`）。本场景不写 `config:`，因此 config.json 里没有
`[editor]` 的折行两项，应用走 Rust 侧 `Default`——这正是「老配置文件原样启动」的真实形态。

**本 change 之后本场景验什么**（M239 收口后的口径）：

| 判据 | 通道 | 说明 |
|---|---|---|
| 横滚容器在不在 | `ax: has "Markdown 代码块 N"` | 默认 `code_block_wrap=false` 的判据：容器带 `role=region` + 读屏名，默认口径下它在 |
| 代码行是否完整、是否被折走 | `ax: has "CODE-END-MARK"` | 超长行整行仍在（不折行时一行到底；折行与否的**视觉**差异看 `shots/`） |
| 文档没被碰过 | `editor.unchangedSince` + 文件 sha256/mtime | 容器与键位都只作用于显示层，MUST NOT 改正文 |
| 焦点归属 | `ax: focused` | M239 之后：编辑器内按 `Tab` **不再**把焦点送进容器（见「已知边界」） |

其余两条轴（正文行折 / 代码块不折）在真机侧没有计算属性通道可读——**视觉口径看 `shots/`**。
**容器横向滚动的行为**（`→` 步进 120px、`End` 最右、`Home` 最左、`Escape` 交还焦点）由 chromium 层
`tests/visual/scenes/render-codeblock.spec.ts` 承担（那里用 `el.focus()` 编程聚焦，不依赖键盘入口；
`Dblclick`/点击会把焦点收回 contentDOM，这也是真机上点不亮容器的同一个原因）。

**焦点起点很关键**（M180 实测）：`open` 之后焦点落在左栏的文件行按钮上（AX dump 里
`AXButton (wrap-probe.md) … (focused)`），此时一次 Tab 只会走到左栏的下一行、进不了编辑器——
所以先用 `clickEditor` 把焦点交给 `.cm-content`，后续按键才有确定的落点。

**探针文档刻意不含半角双引号**：套件解析 AX 时用 `/=\s*"([\s\S]*?)"/` 取 `AXTextArea` 的 value
（`lib/ax.mjs`），非贪婪匹配会在文档里出现的第一个 `"` 处截断——正文里带 `"` 会让 `editor: has`
断言读到半截文本（`not` 断言则可能因此假 PASS）。这是解析侧既有的边界，本场景的构造避开了它并
把边界记在这里（正式 finding 已按协议提交）。

## 已知边界（M239 收口，2026-09-26）

- **块级横滚容器的键盘可达性已被 change `list-tab-indent`（M239）移除**：编辑器内容区里的 `Tab`
  归列表缩进命令 `editor.list-indent`（键位层命中即消费），原生焦点遍历不再能把焦点送进容器；
  容器节点在 AX 里既无 bbox 也无 `AXPress` 动作，**按节点点也不生效**（本场景 2026-09-26 实测：
  `AXPress` 后 `focused=AXTextArea`，证据 `test-results/acceptance/2026-09-26-m239-21/`）。
  ⇒ 容器内那五条键（`←` `→` `Home` `End` `Escape`）在真机上**当前没有触发路径**。
- **仍然成立、本场景继续断言**：容器在 AX 树里（默认口径的判据）、超长代码行整行完整、编辑器文本
  与磁盘文件逐字节不变、`Tab` 之后焦点留在编辑器（键被消费，不落回原生遍历）。
- **覆盖归属如实登记**：那五条键的**行为**（120px 步进 / 端点 / `Escape` 交还）仍由 chromium 层
  `tests/visual/scenes/render-codeblock.spec.ts` 以 **编程聚焦** 验证（真机侧不重复验，也不假装键盘
  入口还在）；容器横向滚动本身的「能不能滚」（`overflow-x: auto`）不属本套件的可读通道（scrollLeft
  不进 AX），由视觉层与样式合同承担。
- **恢复入口**：`docs/backlog.md` 已登记候选①——新增 `editor.focus-block-scroll` 命令 + 键位，把焦点
  送回当前光标所在的块级横滚容器，待 Alex 立项；本 change 只如实记录现状，不自行加键。
