---
id: "889-markdown-visible-width"
item: 889
tier: full
title: Markdown 不折行可见窗口：正文横滚不越出阅读栏、行尾可达、全选复制不含 chrome、源文件零改写
config:
  editor: { line_wrap: false }
  lineNumbers: "on"
steps:
  - name: 写入合成自然长行（不含真实 vault 内容）
    do: vaultWrite
    file: native-visible.md
    content: |
      # 可见窗口验收

      Visible window native probe alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima. Visible window native probe alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima. Visible window native probe alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima. Visible window native probe alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima. Visible window native probe alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima. NATIVE-WIDTH-END

      short anchor
    expect:
      - label: 合成文档已落验收 vault
        file: { path: native-visible.md, exists: true }

  - name: 记录源文件基线
    do: record
    as: 源文件基线
    file: native-visible.md
    expect:
      - label: 基线可读
        file: { path: native-visible.md, has: "NATIVE-WIDTH-END" }

  - name: 打开 nowrap Markdown，先留起点证据
    do: open
    file: native-visible.md
    marker: "可见窗口验收"
    expect:
      - label: 正文与行号开关已装载
        editor: { has: "NATIVE-WIDTH-END" }
      - shot: 起点

  - name: 真实横向滚轮在正文内滑动（候选 scrollport 是 contentDOM，不再移动整条阅读列）
    do: scroll
    target: { x: 700, y: 260 }
    dx: -18
    wheel: true
    expect:
      - label: 横滚后文档仍逐字节不变
        file: { path: native-visible.md, unchangedSince: 源文件基线, mtimeUnchangedSince: 源文件基线 }
      - shot: 横滚后

  - name: 默认顶部落点建立编辑器焦点（不按行高猜长行坐标）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文
        ax: { focused: "AXTextArea" }
      - label: 正文可读
        editor: { has: "NATIVE-WIDTH-END" }

  - name: ⌥G 打开跳转到行，读出起点行号
    do: key
    key: "alt+g"
    expect:
      - label: 预填当前行号 1（后续跳到第 3 行的对照基线）
        ax: { has: '/AXTextField = "1"/' }
      - label: 焦点在行号框
        ax: { focused: "AXTextField" }

  - name: 输入 3，明确选择自然长行
    do: keys
    keys: ["3"]
    expect:
      - label: 行号框已替换为 3
        ax: { has: '/AXTextField = "3"/' }

  - name: Enter 跳到第 3 行起点
    do: key
    key: "return"
    expect:
      - label: 输入条已收起
        ax: { not: "AXTextField" }
      - label: 焦点交还编辑器
        ax: { focused: "AXTextArea" }
      - label: 跳转不改源文件
        file: { path: native-visible.md, unchangedSince: 源文件基线, mtimeUnchangedSince: 源文件基线 }

  - name: Ctrl+E 到自然长行行尾并立即留图（图中必须显示 NATIVE-WIDTH-END，caret 在第 3 行行尾/X 内，由主会话复核）
    do: key
    key: "ctrl+e"
    expect:
      - label: 行尾揭示不改文档
        file: { path: native-visible.md, unchangedSince: 源文件基线, mtimeUnchangedSince: 源文件基线 }
      - shot: 行尾揭示

  - name: Ctrl+E 后重开 ⌥G：预填值直接证明 caret 仍在第 3 行
    do: key
    key: "alt+g"
    expect:
      - label: caret 行号 = 3（旧的 short anchor 错误落点会读出 6 并在此判红）
        ax: { has: '/AXTextField = "3"/' }
      - label: 行号读数框持焦
        ax: { focused: "AXTextField" }
      - shot: 行尾光标行号

  - name: Escape 收起行号框并交还编辑器焦点
    do: key
    key: "escape"
    expect:
      - label: 输入条已收起
        ax: { not: "AXTextField" }
      - label: 焦点交还编辑器
        ax: { focused: "AXTextArea" }
      - label: 行号读取与焦点往返不改源文件
        file: { path: native-visible.md, unchangedSince: 源文件基线, mtimeUnchangedSince: 源文件基线 }

  - name: 真实 ⌘A/⌘C：文档全文可选，doc-title 与 END chrome 不进剪贴板
    do: keys
    channel: cgevent
    keys: ["cmd+a", "cmd+c"]
    expect:
      - label: 剪贴板含自然长行尾
        clipboard: { has: "NATIVE-WIDTH-END" }
      - label: 剪贴板不含 doc-title
        clipboard: { not: "native-visible" }
      - label: 剪贴板末尾没有 END 标记
        clipboard: { not: "/\\nEND\\s*$/" }
      - label: 源文件全程零写盘
        file: { path: native-visible.md, unchangedSince: 源文件基线, mtimeUnchangedSince: 源文件基线 }
      - shot: 全选复制后
---

## 口径与边界

- 本场景由 change `clip-markdown-content-to-reading-width-nov27` 引入。精确 glyph Range/裁剪交集、三主题、单双 pane、宽窄窗、行号 off/on、搜索、粘贴、undo 与阅读位置数值矩阵归 `tests/visual/scenes/markdown-visible-width.spec.ts`。
- AX 不提供可靠的 contentDOM scrollLeft 或 caret/selection 像素坐标；本场景用真实输入 + 截图 + 文档/剪贴板断言，不把「AX 仍读得到被裁文本」冒充可见性。
- 行尾路径不依赖 `clickEditor` 的行高坐标标定：默认顶部落点只负责建立焦点，再用 ⌥G 跳到第 3 行。Ctrl+E 后立即留「行尾揭示」图，随后再开 ⌥G；预填值必须仍为 3。这个读数会把旧场景误落第 6 行 `short anchor` 的现场判红，不再只靠「文档不变」放行。
- `editor.has` 只证明文本进入 AX 可读面，不能证明 glyph 在 X 内。主会话复跑时必须审「行尾揭示」图：明确看到 `NATIVE-WIDTH-END`，caret 在第 3 行行尾且位于阅读栏 X 内；「行尾光标行号」图提供同现场的行号旁证。
- native 由主会话统一执行。横滚落点使用默认 1200 窗口内的正文点；若窗口管理器改变尺寸，按实际截图复核，不把坐标失败计作产品缺陷。
