---
id: "865-wikilink-caret-reveal-nov24"
item: 865
tier: full
title: wikilink 键盘 / 指针进入源码、修饰键旧语义与精确 undo / save
fixtures: [links-wiki.md, plain.md]
open: links-wiki.md
marker: "第二段内容"
steps:
  - name: 起点：普通 wikilink 以 replace widget 渲染
    do: focusWindow
    retries: 4
    click: true
    expect:
      - label: label 与后段正文可读
        editor: { has: "plain" }
      - label: 光标未触及 span 时不显露源码
        editor: { not: "[[plain]]" }

  - name: 记录非编辑手势与落盘的公共基线
    do: record
    file: links-wiki.md
    as: wikilink 基线

  - name: → 首次进入隐藏 span，完整源码立即上屏
    do: key
    key: "right"
    gapMs: 150
    expect:
      - label: 首个内部落点即显露完整 [[...]]
        editor: { has: "[[plain]]" }
      - label: 纯移动不写盘
        file: { path: links-wiki.md, unchangedSince: wikilink 基线, mtimeUnchangedSince: wikilink 基线 }

  - name: 再按 → 逐字符到 target 起点并键入 z
    do: key
    key: "right"
    gapMs: 120
  - name: 键入 z（可打印回读）
    do: keys
    keys: ["z"]
    gapMs: 150
    expect:
      - label: 字符写进 target 源码而不是渲染 label 或链接边界
        editor: { has: "[[zplain]]" }

  - name: ⌘S 落盘精确等于 EditorState 中的源码
    do: key
    key: "cmd+s"
    gapMs: 400
    expect:
      - label: 盘上全文是显式源码编辑结果
        file: { path: links-wiki.md, exact: "[[zplain]]\n\n第二段内容。\n", changedSince: wikilink 基线 }

  - name: 一次 undo 单步复原，随后保存回干净基线
    do: key
    key: "cmd+z"
    gapMs: 250
    expect:
      - label: 一次撤销恢复原文
        editor: { has: "[[plain]]" }
  - name: 保存撤销后的原文
    do: key
    key: "cmd+s"
    gapMs: 400
    expect:
      - label: 盘上恢复原始字节
        file: { path: links-wiki.md, exact: "[[plain]]\n\n第二段内容。\n" }

  - name: 移出 span 后恢复 widget
    do: key
    key: "ctrl+e"
    channel: cgevent
    gapMs: 180
    expect:
      - label: 离开后源码重新隐藏
        editor: { not: "[[plain]]" }
      - label: 离开与恢复不写盘
        file: { path: links-wiki.md, unchangedSince: wikilink 基线, mtimeUnchangedSince: wikilink 基线 }

  - name: 无修饰主键点击 widget 只进入源码、不跳转
    do: clickEditor
    dx: 50
    dy: 6
    real: true
    retries: 2
    expect:
      - label: 点击后完整源码显露
        editor: { has: "[[plain]]" }
      - label: 未打开目标文件
        editor: { not: "纯文本基线" }
      - label: 点击本身不写盘
        file: { path: links-wiki.md, unchangedSince: wikilink 基线, mtimeUnchangedSince: wikilink 基线 }

  - name: 回到渲染态，准备修饰键矩阵
    do: key
    key: "ctrl+e"
    channel: cgevent
    gapMs: 180
    expect:
      - label: widget 已恢复
        editor: { not: "[[plain]]" }

  - name: Ctrl-Click 不激活、不先进入编辑
    do: click
    target: { role: "AXStaticText", name: "plain", modifiers: ["control"] }
    expect:
      - label: 仍在源文档且 widget 未撤下
        editor: { not: "[[plain]]" }
      - label: 没有跳转目标或新建提示
        ax: { not: "/纯文本基线|未创建的链接/" }
      - label: 文档字节不变
        file: { path: links-wiki.md, unchangedSince: wikilink 基线, mtimeUnchangedSince: wikilink 基线 }

  - name: Shift-Click 不先进入编辑或触发跳转
    do: click
    target: { role: "AXStaticText", name: "plain", modifiers: ["shift"] }
    expect:
      - label: widget 保持渲染态
        editor: { not: "[[plain]]" }
      - label: 无跳转或提示
        ax: { not: "/纯文本基线|未创建的链接/" }

  - name: Alt-Click 不先进入编辑或触发跳转
    do: click
    target: { role: "AXStaticText", name: "plain", modifiers: ["alt"] }
    expect:
      - label: widget 保持渲染态
        editor: { not: "[[plain]]" }
      - label: 无跳转或提示
        ax: { not: "/纯文本基线|未创建的链接/" }
      - label: 三类修饰手势均未写盘
        file: { path: links-wiki.md, unchangedSince: wikilink 基线, mtimeUnchangedSince: wikilink 基线 }

  - name: Meta-Click 沿用既有链接跟随
    do: click
    target: { role: "AXStaticText", name: "plain", modifiers: ["meta"] }
    expect:
      - label: 打开既有目标笔记
        editor: { has: "纯文本基线" }
---

# 865 — wikilink 光标显露的真机入口与字节合同

精确 anchor / head、首次 drag 的空光标、第二次正反向拖选以及三态 × Meta / Ctrl / Shift / Alt 的原视图逐格取证，归 `tests/visual/scenes/wikilink-caret-reveal.spec.ts`；本场景只补真实 WKWebView 的键盘 / 指针入口、跳转、编辑、undo、save 和磁盘字节，不把 AX 读不到的选区几何写成弱断言。

只读三态 widget 的入口由同一 visual 文件中的真实 `EditorState.readOnly` 编辑器 fixture 覆盖。vault 外只读文档按既有合同不注入 wikilink resolver，真机应用内没有「只读 + 三态 replace widget」的装配路径；本场景不把 vault 外的纯原文降级形态冒充该防线。

执行边界：场景会写合成 vault 的 `links-wiki.md`，并在结尾前保存回原始字节；不触碰真实 vault。修饰键点击使用套件的真实 CGEvent 通道，需要主窗口在前台。精确指针拖选不在真机重复建设。
