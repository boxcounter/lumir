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

  - name: 滚动前的视口读数（AX 的 offscreen_filter 只暴露视口内的行）
    expect:
      - label: 首行「上移一行」在视口内（正向锚点）
        ax: { has: "上移一行" }
      - label: 末尾命令「关闭窗格」不在视口内（负向基线，后面出现才说明真滚动）
        ax: { not: "关闭窗格" }

  - name: 连续 PageDown：列表真的滚动（行集变化，不是只移动焦点）
    do: keys
    keys: ["pagedown", "pagedown", "pagedown", "pagedown", "pagedown"]
    expect:
      - label: 末尾命令「关闭窗格」进入视口（PageDown 改变了滚动位置）
        ax: { has: "关闭窗格" }
      - label: 首行「上移一行」离开视口（不是「按了但没滚」）
        ax: { not: "上移一行" }
      - shot: PageDown-滚到底

  - name: 连续 PageUp 回到顶部
    do: keys
    keys: ["pageup", "pageup", "pageup", "pageup", "pageup"]
    expect:
      - label: 首行重新进入视口
        ax: { has: "上移一行" }
      - label: 末尾命令离开视口
        ax: { not: "关闭窗格" }
      - shot: PageUp-回顶

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

  - name: Esc 关闭（当前查询为空，第一下即关闭）
    do: key
    key: escape
    expect:
      - label: 面板已关闭
        ax: { not: "键位速查（生效中）" }
      - label: 关闭后焦点交还编辑器（focused 节点是 AXTextArea）
        ax: { focused: "AXTextArea" }
      - label: 键盘全程文档逐字节不变（关闭前）
        editor: { unchangedSince: beforeKeyboard }
      - shot: 关闭后-焦点交还

  - name: 在编辑器里按 ⌃D：焦点确实回到编辑器、命令真的执行
    do: key
    key: "ctrl+d"
    expect:
      - label: 文档发生变化（⌃D 到达编辑器并删掉一个字符）
        editor: { changedSince: beforeKeyboard }
      - shot: ctrl-d-删字符

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
---

# 键位速查：键盘全程（change improve-keybindings-lookup-oct24）

## 这个场景验什么

1. **打开即焦点在查询框**：不点击直接键入 `toc` 就能过滤（若焦点没落输入框，字符会落进编辑器）。
2. **Tab 不逃出面板**：Tab 离开输入框后键入 `x` 不会污染查询串；四停循环后回到输入框，再键入
   `toc` 仍能过滤。
3. **↑↓ / Enter**：↓ 选择第二行、Enter 展开详情，命令 id `editor.cursor-down` 只在详情里出现。
4. **End**：焦点在列表时 End 落到最后一行（`pane.close`），Enter 展开其详情。
5. **Esc / ⌃G**：Esc 清查询 → 关闭；关闭后 AX 焦点是 `AXTextArea`，并在编辑器里按 `⌃D` 看到文档
   真的变化（焦点交还的可执行判据）；⌃G 关闭；关闭前文档逐字节不变。
6. **PageDown / PageUp**：AX 的 `offscreen_filter` 只暴露视口行——滚动前末行不在、PageDown 后末行
   出现且首行消失、PageUp 后反向，证明列表真的滚动而不是只移动焦点。

## 已知边界（如实登记）

- **PageDown 的滚动量仍不可机读，但滚动位置可判**：WKWebView 的 AX 不暴露 `scrollTop`，且快照带
  `offscreen_filter`——只列当前视口内的行。本场景因此用「滚动前末尾命令不在 AX、PageDown 后末尾
  命令出现且首行消失、PageUp 后反向」判「列表真的滚动了」；滚了多少像素仍归 Alex dogfood。
- **Tab 四停的顺序**由视觉场景逐停断言（`toBeFocused` 四次）；本场景只判「循环后回到输入框」
  与「不逃出面板」两条真机可读的行为。
- **shift+Tab 反向**未单列：正向循环已覆盖「焦点不逃出」，反向路径与正向共用同一份
  `focusStops()` 实现（视觉场景另有断言）。
