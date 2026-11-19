---
id: "114-paste-text-regression"
item: 114
tier: core
title: 文本粘贴回归（剪贴板无图片时拦截层 MUST NOT 消费事件）
steps:
  - name: 造笔记并打开
    do: vaultWrite
    file: notes/t.md
    content: "# S3 文本粘贴\n\n"
    expect:
      - label: 笔记已落盘
        file: { path: notes/t.md, has: "S3 文本粘贴" }

  - name: 等 watch 增量把 notes 目录刷进树（行进场再点，不等则点击会扑空）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(notes\\)/"]
    timeoutMs: 30000

  - name: 展开 notes 目录
    do: click
    target: { any: "/^notes$/" }
    expect:
      - label: notes 目录行在场（watch 增量已刷新）
        ax: { has: "/AXButton \\(notes\\)/" }

  - name: 打开笔记
    do: open
    file: notes/t.md
    marker: "S3 文本粘贴"
    expect:
      - label: 笔记装载进编辑器
        editor: { has: "S3 文本粘贴" }

  - name: 编辑器建立焦点（paste 前置：真实点击同时把窗口做成 key，cgevent 真键盘事件需要）
    do: clickEditor
    real: true

  - name: 剪贴板置纯文本（无 image/* 数据）
    do: clipboardText
    text: "文本粘贴回归标记"

  # 粘贴通道（M864）：⌘V 走 cgevent 真键盘事件（M859 真机实测）；原生上下文菜单 Paste 的
  # AXPress 会静默 no-op，不再使用——见 112 的同段注释。
  - name: ⌘V 投递 paste（cgevent 真键盘事件；剪贴板无图片项）
    do: key
    key: "cmd+v"
    channel: cgevent
    gapMs: 500

  - name: 等文本落地
    do: waitFor
    waitFor:
      has: ["文本粘贴回归标记"]
    timeoutMs: 40000
    expect:
      - label: 文本按默认粘贴行为插入（与能力存在之前一致）
        editor: { has: "文本粘贴回归标记" }
      - label: 笔记目录没有新增任何附件
        glob: { dir: notes, pattern: "pasted-", exact: 0 }
      - label: 剪贴板内容仍是原来的纯文本（粘贴未改写剪贴板）
        clipboard: { has: "文本粘贴回归标记" }
      - shot: S3-文本粘贴回归

  - name: 清理
    do: vaultRm
    file: notes/t.md
---

# 文本粘贴回归（S3，change paste-clipboard-image）

## 这个场景验什么

**降级条款不是恒真**：剪贴板不含 `image/*` 时，粘贴拦截层必须**不消费**事件，走 CodeMirror
的默认文本粘贴，逐字节与能力存在之前一致（spec「非图片剪贴板降级」）。这条同时挡住「拦截器
误吞文本粘贴」这类回归——只判「图片能贴上」是判不出这一半的。

## 为什么用 ⌘V（cgevent）而不是原生菜单

M415/M416 时代用的「右键唤出原生上下文菜单 → 点 Paste」通道已弃用：M859 真机实测 AXPress
到 AXMenuItem 会**静默 no-op**（菜单不收起、paste 不触发，且间歇复现；finding
`20261120-worker-html-only-paste-improve-cgevent-v-paste-axpress.md`）。现在的通道是
`do: key { key: "cmd+v", channel: cgevent }`——真键盘事件，M859 在编辑器上实测投递了真实
paste 事件（README「原生剪贴板命令」条的通道分档）。文本粘贴在这个通道上是 pasteboard 不含
file 项的那一档（M415 探针第 1 号读数：`types=["text/plain"]`，无 file item），正是要验的
输入面；判据仍落在**文本落地**与**目录零附件**两侧。
