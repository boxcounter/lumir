---
id: "227-fullscreen-select-esc"
item: 227
tier: full
title: 全屏遮罩内的选中动作不改变退出路径：遮罩内尝试 ⌘A 之后 Esc 仍关闭、焦点回编辑器、文档与磁盘零写入
fixtures: [table-fullscreen.md]
open: table-fullscreen.md
marker: "表格全屏场景"
config:
  keys: { "Cmd-j": "table.toggle-fullscreen" }
steps:
  - name: 终态：正常表渲染为 grid（放大命令的靶子）
    expect:
      - label: 正常表渲染成 AX 表（命令的命中条件成立）
        ax: { has: "AXTable (Markdown 表格 1)" }
      - shot: 01-终态

  - name: 基线：记录编辑器内容（末尾 unchangedSince 的对照物）
    do: recordEditor
    as: before
    expect:
      - label: 基线记录成功（正文可读——读不到时 recordEditor 自己会红）
        editor: { has: "表格全屏场景" }

  - name: 基线：记录磁盘文件 sha256/mtime
    do: record
    file: table-fullscreen.md
    as: doc
    expect:
      - label: 磁盘基线已记下
        file: { path: table-fullscreen.md, exists: true }

  - name: caret 进正常表
    do: clickInNode
    target: { role: "AXTable", any: "Markdown 表格 1" }
    dx: 0.5
    dy: 0.5
    expect:
      - label: caret 已进表（grid 表仍在）
        ax: { has: "Markdown 表格 1" }

  - name: 执行 table.toggle-fullscreen（经 [keys] 绑定的 ⌘J）打开遮罩
    do: key
    key: "cmd+j"
    expect:
      - label: 遮罩打开（模态接管：标签栏从 AX 树里消失）
        ax: { not: "关闭 table-fullscreen.md" }
      - label: 遮罩里是快照表且几何非零（AX 文本可读 ≠ 元素可见，两条一起钉）
        ax: { count: { pattern: "/AXTable \\(Markdown 表格 1\\) @\\d+,\\d+ [1-9]\\d*×[1-9]\\d*/", exact: 1 } }
      - label: 快照 cell 文本在场
        ax: { has: "甲" }
      - shot: 02-遮罩打开

  # 真机通道的 ⌘A 是键码级丢弃（M536；本 README「键盘注入通道的两类不可达」同族），选区与
  # 复制不在真机判据内（AX 不暴露选区、原生 ⌘C 注入不落地）。这一步验的是**不变量**：无论 ⌘A
  # 落不落地，它都不得关闭遮罩、不得改写内容；退出路径由下一步 Esc 正观测。
  #
  # M768 通道审计（保留 AX，不切 cgevent）：遮罩不是应用的键位层作用域（`Cmd-a` 属 `text` 面，
  # 只认编辑器 / composer 的事件源），这里要的只是「做一次选中动作」。KimiCU 0.6.8 起 `cmd+a`
  # 走 AX 全选——对这条**负向不变量**而言，它比旧行为（键码级丢弃、什么都没发生）更接近真实用户
  # 动作，断言口径一字不变；替成真键盘事件不增加区分度。
  - name: 遮罩内尝试 ⌘A
    do: key
    key: "cmd+a"
    expect:
      - label: 遮罩仍开着（⌘A 不得成为第二条关闭路径）
        ax: { not: "关闭 table-fullscreen.md" }
      - label: 快照内容仍在（选中动作不改写遮罩内容）
        ax: { has: "甲" }
      - shot: 03-⌘A 之后

  - name: Esc 关闭并交还焦点（有选中动作在先也不变）
    do: key
    key: "escape"
    expect:
      - label: 遮罩退场（标签栏回到 AX 树）
        ax: { has: "关闭 table-fullscreen.md" }
      - label: 焦点回到编辑器（行为可用性的既有口径）
        ax: { focused: "AXTextArea" }
      - shot: 04-Esc 关闭后

  - name: 只读：文档与磁盘逐字节不变（ADR 0003 §3）
    expect:
      - label: 编辑器内容与基线逐字节相同
        editor: { unchangedSince: before }
      - label: 磁盘文件 sha256 与基线相同
        file: { path: table-fullscreen.md, unchangedSince: doc }
      - shot: 05-收尾
---

# 227 全屏遮罩内的选中动作不改变退出路径（M650，change fullscreen-table-text-selection）

## 本场景在验什么

change 的 spec 要求：遮罩内已有选区时，既有四条关闭路径（`Esc`、点击遮罩、再次执行同一 toggle、
焦点离开的 blur 兜底）逐条不变；关闭后不得残留可被复制动作取到的遮罩文本。真机通道**断言不了
选区本身**（AX 不暴露选区，原生 ⌘C 注入不落地——见 `scripts/acceptance/README.md` 的「光标/选区
不可断言」与 M536 的两类不可达），因此本场景把真机判据收在**可断言的那一半**：

1. 遮罩内按下 ⌘A 这个动作**不得**关闭遮罩、不得改写快照内容（负向，由下一步的正观测配对）。
2. 之后 `Esc` 仍然关闭遮罩、焦点回到编辑器（退出路径不变）。
3. 全程编辑器文档与磁盘文件逐字节不变（只读）。

「⌘A 选中了遮罩内容」与「拖选看得见选中带」这两条**不在本场景**：它们的判据在引擎层
（`tests/visual/scenes/m642-overlay-select-all.spec.ts` 的选区锚点断言 + 三主题选区带对比断言）
与真机探针（M650 的 `.local/probes/` 读数与截图）里，选中的观感归 Alex 手感裁决。

## 断言口径

- **遮罩开着 = 标签栏不在 AX 树里**（`aria-modal` 的模态接管，与场景 40 / 223 同一判据）；
  遮罩关了 = `关闭 table-fullscreen.md` 重新出现。快照表用「几何非零 + `AXTable (Markdown 表格 1)`
  ` 计数恰好 1」钉，防「AX 文本可读 ≠ 元素可见」。
- **⌘A 是负向步骤**：真机通道里它不落地时，两条断言恒真——因此下一条 Esc 步骤是它的正观测
  （遮罩确实还开着、并且确实能关）。
- **只读用逐字节比较**（`recordEditor` / `record`），不读布尔口。

## 已知边界

- 本场景只覆盖表格全屏面；代码块全屏面与它共用同一份遮罩模块与同一条 `keydown` 分支
  （`src/code-block-fullscreen.ts`），行为由 chromium 场景覆盖，真机键盘通道不区分两个面。
- 拖选的真机观感（能否看到选中带）不在套件通道内，见上。
