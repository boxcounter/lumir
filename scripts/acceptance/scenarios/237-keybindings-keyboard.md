---
id: "237-keybindings-keyboard"
item: 237
title: 键位速查——键盘全程：输入框焦点、Tab 循环、↑↓/Enter 详情、End 末行、Esc 分层与关闭
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: 建立编辑器焦点并记录文档基线
    do: clickEditor
    dy: 6
    expect:
      - label: 文档已装载（正向锚点）
        editor: { has: "纯文本基线" }
  - name: 记录文档基线
    do: recordEditor
    as: beforeKeyboard
    expect:
      - label: 基线非空
        editor: { has: "纯文本基线" }

  - name: 注入前把窗口带到前台
    do: focusWindow

  - name: ⌘/ 打开键位速查（焦点应落在查询框）
    do: key
    key: "cmd+/"
    expect:
      - label: 面板打开
        ax: { has: "键位速查（生效中）" }
      - label: 打开即全量（71 条命令 · 11 组）
        ax: { has: "71 条命令 · 11 组" }
      - shot: 打开-输入框焦点

  - name: 不点任何东西直接键入 toc（焦点在查询框才有这个结果）
    do: keys
    keys: ["t", "o", "c"]
    expect:
      - label: 查询生效：命中 1 / 71
        ax: { has: "命中 1 / 71" }
      - label: 别名 toc 命中「打开大纲」
        ax: { has: "打开大纲" }
      - shot: 键盘查询-toc

  - name: Tab 离开输入框后继续注入可打印字符（应落到捕获按钮而不是查询框）
    do: key
    key: tab
    expect:
      - label: 焦点离开输入框后查询串没有被追加（仍是命中 1 / 71）
        ax: { has: "命中 1 / 71" }
  - name: 在按钮上键入 x（按钮不接收文本，查询不应变化）
    do: key
    key: x
    expect:
      - label: 查询串未被追加（仍是 toc 的唯一命中）
        ax: { has: "命中 1 / 71" }
      - label: 目标行仍是「打开大纲」
        ax: { has: "打开大纲" }

  - name: Esc 清查询（面板保持）
    do: key
    key: escape
    expect:
      - label: 回到全量
        ax: { has: "71 条命令 · 11 组" }
      - label: 面板仍在
        ax: { has: "键位速查（生效中）" }

  - name: Tab 三次走过捕获按钮 / 作用域 / 列表后回到输入框
    do: keys
    keys: ["tab", "tab", "tab", "tab"]
    expect:
      - label: 四停循环后仍在面板内（面板没被 Tab 送出焦点而失效）
        ax: { has: "键位速查（生效中）" }
  - name: 键入 toc 验证焦点已回到输入框
    do: keys
    keys: ["t", "o", "c"]
    expect:
      - label: 查询生效（Tab 循环回到输入框）
        ax: { has: "命中 1 / 71" }
      - shot: Tab-四停后回到输入框

  - name: Esc 清查询；用 ↓ + Enter 展开第二行详情
    do: key
    key: escape
    expect:
      - label: 回到全量
        ax: { has: "71 条命令 · 11 组" }
  - name: ↓ 选择第二行（下移一行）并 Enter 展开
    do: keys
    keys: ["down", "enter"]
    expect:
      - label: 详情展示第二行的命令 id（editor.cursor-down）
        ax: { has: "editor.cursor-down" }
      - label: 详情承载来由字段
        ax: { has: "来由" }
      - shot: 详情-第二行

  - name: 焦点移到列表（Tab 到列表）后用 End 落最后一行并 Enter
    do: key
    key: tab
    expect:
      - label: 第一次 Tab 到捕获按钮（面板仍在）
        ax: { has: "键位速查（生效中）" }
  - name: 再 Tab 两次到列表（输入框 → 捕获 → 作用域 → 列表）
    do: keys
    keys: ["tab", "tab"]
  - name: End + Enter 展开最后一行的详情
    do: keys
    keys: ["end", "enter"]
    expect:
      - label: 最后一行是 pane.close（命令 id 只出现在详情里）
        ax: { has: "pane.close" }
      - label: 最后一行的人类标签
        ax: { has: "关闭窗格" }
      - shot: End-最后一行详情

  - name: Esc 清查询 / Esc 关闭（当前查询为空，第一下即关闭）
    do: key
    key: escape
    expect:
      - label: 面板已关闭
        ax: { not: "键位速查（生效中）" }
      - label: 关闭后焦点交还编辑器（再按 ⌃D 能删字符 → 文档变化）
        editor: { has: "纯文本基线" }
      - shot: 关闭后-焦点交还

  - name: ⌃G 关闭路径
    do: key
    key: "cmd+/"
    expect:
      - label: 面板再次打开
        ax: { has: "键位速查（生效中）" }
  - name: 按 ⌃G
    do: key
    key: "ctrl+g"
    expect:
      - label: ⌃G 关闭面板
        ax: { not: "键位速查（生效中）" }
      - label: 键盘全程文档逐字节不变
        editor: { unchangedSince: beforeKeyboard }
---

# 键位速查：键盘全程（change improve-keybindings-lookup-oct24）

## 这个场景验什么

1. **打开即焦点在查询框**：不点击直接键入 `toc` 就能过滤（若焦点没落输入框，字符会落进编辑器）。
2. **Tab 不逃出面板**：Tab 离开输入框后键入 `x` 不会污染查询串；四停循环后回到输入框，再键入
   `toc` 仍能过滤。
3. **↑↓ / Enter**：↓ 选择第二行、Enter 展开详情，命令 id `editor.cursor-down` 只在详情里出现。
4. **End**：焦点在列表时 End 落到最后一行（`pane.close`），Enter 展开其详情。
5. **Esc / ⌃G**：Esc 清查询 → 关闭；⌃G 关闭；关闭后焦点交还编辑器；全程文档逐字节不变。

## 已知边界（如实登记）

- **PageDown 的真实滚动量不可机判**：WKWebView 的 AX 不暴露滚动容器的 `scrollTop`，本场景不把
  「按了 PageDown」写成「滚到了哪里」；滚动截图留证，滚动量归 Alex dogfood。列表滚动容器的
  键盘可滚性由视觉场景的结构断言（焦点在 `.lumir-bindings-body`）与实现（显式 scrollTop）共同
  保证。
- **Tab 四停的顺序**由视觉场景逐停断言（`toBeFocused` 四次）；本场景只判「循环后回到输入框」
  与「不逃出面板」两条真机可读的行为。
- **shift+Tab 反向**未单列：正向循环已覆盖「焦点不逃出」，反向路径与正向共用同一份
  `focusStops()` 实现（视觉场景另有断言）。
