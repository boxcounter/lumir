---
id: "235-keybindings-lookup-query"
item: 235
title: 键位速查——每命令一行的内容模型、文本查询（标签 / 别名 / id）、来由零命中与查询空态
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: 建立编辑器焦点并记录文档基线（面板打开期间 AX 不读编辑器，基线必须提前记）
    do: clickEditor
    dy: 6
    expect:
      - label: 文档已装载（正向锚点：这次读取是活的）
        editor: { has: "纯文本基线" }
  - name: 记录文档基线
    do: recordEditor
    as: beforeLookup
    expect:
      - label: 基线非空
        editor: { has: "纯文本基线" }

  - name: 注入前把窗口带到前台（键盘注入的前台纪律）
    do: focusWindow

  - name: ⌘/ 打开键位速查
    do: key
    key: "cmd+/"
    expect:
      - label: 面板打开且标题是「键位速查（生效中）」
        ax: { has: "键位速查（生效中）" }
      - label: 每命令一行的计数（72 条命令 · 11 组）
        ax: { has: "72 条命令 · 11 组" }
      - label: 分组标题沿用既有功能族
        ax: { has: "移动与选择" }
      - label: 命令的人类标签上屏（不是命令 id / 维护者来由）
        ax: { has: "上移一行" }
      - label: 键位区显示字形而不是原始 token（⌃P 不是 Ctrl-p）
        ax: { has: "⌃P" }
      - label: 原始 token 不在主行（只能在详情里）
        ax: { not: "Ctrl-p" }
      - shot: 打开后的全量速查

  - name: 文本查询「大纲」（typeInNode：原生输入框的可靠注入通道）
    do: typeInNode
    target: { role: AXComboBox, name: "查找命令|大纲" }
    text: "大纲"
    expect:
      - label: 查询串落地
        ax: { has: '/AXComboBox.*大纲/' }
      - label: 命中计数分母是当前作用域后的全量（72）
        ax: { has: "命中 1 / 72" }
      - label: 目标命令恰一行：打开大纲
        ax: { has: "打开大纲" }
      - label: 它的键位区显示 ⇧⌘O
        ax: { has: "⇧⌘O" }
      - shot: 查询-大纲

  - name: Esc 清查询（面板保持打开）
    do: key
    key: escape
    expect:
      - label: 查询已清空、面板仍在
        ax: { has: "72 条命令 · 11 组" }

  - name: 输入只出现在维护者来由里的 mission 编号 M447
    do: typeInNode
    target: { role: AXComboBox, name: "查找命令|M447" }
    text: "M447"
    expect:
      - label: 来由不进主搜索语料：零命中
        ax: { has: "没有匹配的命令" }
      - label: 空态给出下一步（标签 / 别名 / id）
        ax: { has: "试试命令标签、别名或 id" }
      - shot: 查询-M447-空态

  - name: Esc 清查询后输入「删除」
    do: key
    key: escape
    expect:
      - label: 回到全量
        ax: { has: "72 条命令 · 11 组" }
  - name: 输入「删除」
    do: typeInNode
    target: { role: AXComboBox, name: "查找命令|删除" }
    text: "删除"
    expect:
      - label: 命中删除族命令
        ax: { has: "删除后一个字符" }
      - label: 反向：来由里写了「已删除」的 toc.toggle 不得误命中
        ax: { not: "打开大纲" }
      - shot: 查询-删除

  - name: Esc 清查询、再 Esc 关闭面板
    do: key
    key: escape
    expect:
      - label: 第一下只清查询
        ax: { has: "72 条命令 · 11 组" }
  - name: 第二下 Esc 关闭
    do: key
    key: escape
    expect:
      - label: 面板已关闭
        ax: { not: "键位速查（生效中）" }
      - label: 关闭后文档逐字节不变（查询与 Esc 不穿透到文档）
        editor: { unchangedSince: beforeLookup }
      - shot: 关闭后
---

# 键位速查：内容模型与文本查询（change improve-keybindings-lookup-oct24）

## 这个场景验什么

1. **行模型与内容**：面板按「一条命令一行」渲染（72 条命令 · 11 组，不是一条绑定一行），
   主行是人类标签 + 键位字形 + scope 徽标；原始 token（`Ctrl-p`）只进详情，不在主行泄漏。
2. **where-is**：输入「大纲」恰命中 `toc.toggle` 一行，键位区是 `⇧⌘O`，计数分母是当前作用域下的
   全量（72）。
3. **来由不进搜索语料**：`M447`（只出现在维护者来由里）零命中并给空态；「删除」不误命中
   `toc.toggle`（它的来由里写着「已删除」）。
4. **Esc 分层**：有查询 → 清查询（面板保持）；再按 → 关闭；关闭后文档逐字节不变。

## 通道与边界

- 查询词走 `do: typeInNode`（原生输入框的可靠注入通道；逐字符 `press_key` 对输入框有确定性丢键，
  README 的 `typeInNode` / `press_key` 条）。目标 role 按 WKWebView 对 `role=combobox` 的暴露形态
  写 `AXComboBox`；首跑若 AX 报 `AXTextField`，改 role 即可，语义不变。
- 菜单入口（Help → Keyboard Shortcuts）在真机 AX 通道里点不到 macOS 菜单栏（与既有 14-tabs /
  45 的登记同口径）：菜单手术的结构假设与 id → 载荷映射由 Rust 单测覆盖，菜单事件 → 同一 toggle
  的链路由视觉场景 `fireMenuCommand` 覆盖；本场景只验键位路径。
- 面板像素观感 / 行密度归 Alex dogfood，`shot` 只作证据，不做逐像素比较。
