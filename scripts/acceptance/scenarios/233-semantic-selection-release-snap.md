---
# M687（change semantic-selection-markdown-oct23）：指针选区「松开时语法包裹外扩」的真机判据。
#   双击粗体词（真机套件唯一能造出编辑器选区的通道，`doubleClick`）→ 松开后选区扩到 `**…**`
#   → 浮动摘录钮 → 点钮 → composer 的引用卡片原文含两侧定界符；文档逐字节不变。
# 为什么只判双击：套件的 `drag` 在 WKWebView 里造不出编辑器选区（M228/M423 实测，见
# scripts/acceptance/README.md「已知边界」），拖选路径只有 chromium 结构场景（m687-semantic-selection）
# 与 Alex dogfood 两侧兜住；选区本身 AX 读不到，判据落在下游可读产物（composer 卡片文本）。
# 坐标口径：窗口钉 1200×800；fixture 第 3 行（空行之后）是 `**粗体词** …`，字形列左缘 ≈ 382、
# 粗体词渲染宽度 ≈ 45、该行中心 y ≈ 231（窗口局部，按 2026-10-24 真机截图 02 标定；首跑取
# x=430 落在词后的空格上，引文成了「是本行的…」，改到词中点 404）。第一次点击的显露会让 `**`
# 重新占宽（第二次点击的同一坐标不能落在定界符上，两字词会偏，故 fixture 用三字词）。
id: "233-semantic-selection-release-snap"
item: 233
title: 双击粗体词松开后外扩到 `**…**` → 摘录卡片原文含定界符；文档逐字节不变
fixtures: [semantic-selection-note.md]
open: semantic-selection-note.md
marker: "粗体词"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: 真实鼠标单击正文建立 webview 焦点（真鼠标双击落在 key window 上的前置）
    do: clickEditor
    real: true
    retries: 4
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
      - shot: 01-打开文档

  - name: 记录文档基线（外扩事务 MUST NOT 改文档）
    do: recordEditor
    as: before-editor
    expect:
      - label: 编辑器基线非空（记的是真文档，不是不可读的空串）
        editor: { has: "粗体词" }

  - name: 记录磁盘基线（逐字节 + mtime）
    do: record
    as: before-file
    file: semantic-selection-note.md

  - name: 双击粗体词（真鼠标 CGEvent 双击；坐标见文件头）
    do: doubleClick
    target: { x: 404, y: 231 }
    expect:
      - label: 浮动「摘录到对话」钮在场（选区建出来了的正观测；双击的 settle 窗口由下一步 waitFor 等）
        ax: { has: "/AXButton \\(摘录到对话\\)/" }
      - shot: 02-双击后浮动钮

  - name: 等浮动钮到可点终态（外扩后的 selectionchange 会重新排期一个 settle 窗口——现状既有行为）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(摘录到对话\\)/"]
    timeoutMs: 10000
    expect:
      - label: 浮动摘录钮浮现（选区有效）
        ax: { has: "/AXButton \\(摘录到对话\\)/" }

  - name: 点「摘录到对话」→ 引用卡片入 composer（harness pane 未开先开）
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: harness pane 自动分栏打开（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: composer 卡片原文含两侧 `**`（外扩没发生时会只有「粗体词」，这条必红）
        ax: { has: '/\*\*粗体词\*\*/' }
      - label: 卡片出处行 = 文档名 · 最近一级标题（卡片真的来自这份文档）
        ax: { has: "semantic-selection-note.md · 语义选中验收" }
      - shot: 03-引用卡片含定界符

  # 编辑器 AX 文本 = **渲染态文本**（显露的定界符会出现在 value 里）：基线与终态必须取同一个显露态，
  # 否则「标题行从显露回到渲染」这类纯装饰变化会被当成文档改动（首跑即这一条假红）。把光标送回
  # 第 1 行（基线时的同一位置）再比字节——这几次点击本身不改文档。
  - name: 把光标送回基线位置（第 1 行），恢复与基线相同的显露态
    do: clickEditor
    expect:
      - label: 焦点回到编辑器正文
        ax: { focused: "AXTextArea" }

  - name: 文档与磁盘逐字节不变
    expect:
      - label: 编辑器文本逐字节等于双击前的基线（同一显露态下比较）
        editor: { unchangedSince: before-editor }
      - label: 磁盘内容 sha256 未变
        file: { path: semantic-selection-note.md, unchangedSince: before-file }
      - label: 磁盘 mtime 未变（没发生「同内容重写」）
        file: { path: semantic-selection-note.md, mtimeUnchangedSince: before-file }
---

# 233-semantic-selection-release-snap —— 双击粗体词的语法包裹外扩（M687）

## 本场景在验什么

change `semantic-selection-markdown-oct23` 在**真实 WKWebView** 下的端到端行为：双击渲染态的粗体词
→ 松开时选区外扩到 `**粗体词**` 的节点范围 → 摘录浮动钮 → 点钮 → composer 的引用卡片原文以
`**` 包裹。没有外扩时卡片只有「粗体词」（当前主分支的形态），正则断言当场红。

## 为什么判据落在 composer

选区范围在真机 AX 里读不到（编辑器不暴露 `AXSelectedTextRange`），「依赖 ⌘C 读回选区文本」的真机
判据不可靠（`.local/probes/` 的历史读数与 README「已知边界」）。composer 的引用卡片文本是下游可读
产物，`AXTextArea` 的 value 里带着卡片原文——它同时覆盖「选区真的含定界符」与「Quote 读的是外扩后
的选区」两件事。

## 覆盖边界（如实登记，不包装成覆盖）

- **拖选路径**：真机套件的 `drag` 在 WKWebView 编辑器里造不出文本选区（M228 / M423 实测）。拖选的
  机器判据只在 chromium 结构场景 `tests/visual/scenes/m687-semantic-selection.spec.ts`，手感归
  Alex dogfood。本场景**不**假装覆盖拖选。
- **三击 / 部分覆盖 / 选中底色**：同样归 chromium 结构场景与纯函数单测；真机只判双击这一条可注入
  路径的下游产物。
- **两字粗体词的双击落点**：第一次点击的显露会让 `**` 重新占宽，两字词的中心双击可能选中 `**` 而
  不是词（change design §7 第 11 条）。fixture 因此用三字词，双击坐标落在字内。
- **350ms settle**：浮动钮在 mouseup 后会被一次同范围的 selectionchange 重新排期（现状既有行为，
  探针读数见 `.local/probes/m687-semantic-release-snap/`）。`waitFor` 等的是按钮的可观测终态，
  不缩短、不等死时间。
