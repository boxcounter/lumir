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

  - name: caret 移到当前长行尾，检验公开 scrollHandler 的揭示路径
    do: clickEditor
    dx: 120
    dy: 210
    expect:
      - label: 编辑器焦点与正文可读
        editor: { has: "NATIVE-WIDTH-END" }

  - name: End 到行尾并留图（caret 必须留在阅读栏 X 内，由主会话复核截图）
    do: key
    key: "end"
    expect:
      - label: 行尾揭示不改文档
        file: { path: native-visible.md, unchangedSince: 源文件基线, mtimeUnchangedSince: 源文件基线 }
      - shot: 行尾揭示

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
- native 由主会话统一执行。横滚落点使用默认 1200 窗口内的正文点；若窗口管理器改变尺寸，按实际截图复核，不把坐标失败计作产品缺陷。
