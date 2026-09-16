---
id: "09-emacs-keys"
item: 9
title: Emacs 键位行为 + ⌘Z 真机路径 + ⌘/ 键位面板
fixtures: [keys.md]
open: keys.md
marker: "键位场景"
steps:
  - name: 建立编辑器焦点
    do: clickEditor
    dy: 6
    expect:
      - label: 文档已装载
        editor: { has: "Alpha" }
  - name: ⌘Z 真机路径——先造一次可撤销的编辑
    do: type
    text: "UNDO-ME"
    expect:
      - label: 插入内容已生效
        editor: { has: "UNDO-ME" }
  - name: 按 ⌘Z
    do: key
    key: "cmd+z"
    expect:
      - shot: cmd-z-之后
      - label: ⌘Z 未被 macOS 视图层级吃掉（文档回退、插入内容消失）
        editor: { not: "UNDO-ME" }
  - name: 开面板前记录文档基线（面板打开期间 AX 里没有编辑器节点，必须在可读时记）
    do: recordEditor
    as: beforePanel
    expect:
      - label: 基线非空（确认记的是真文档，不是不可读的空串）
        editor: { has: "Alpha" }
  - name: 打开 ⌘/ 键位面板
    do: key
    key: "cmd+/"
    expect:
      - shot: 键位面板
      - label: 面板打开（dialog 就位）
        ax: { has: "键位（生效中）" }
      - label: 面板列出命令与键位
        ax: { has: "移动与选择" }
      - label: 面板打开期间 AX 里确实没有编辑器节点（说明该窗口不可读文档）
        ax: { not: "AXTextArea" }
  - name: 面板打开期间注入会改文档的按键与可打印字符
    do: keys
    keys: ["ctrl+n", "x", "ctrl+d"]
    expect:
      - label: 注入后面板仍在（没有被按键关掉）
        ax: { has: "键位（生效中）" }
      - shot: 注入之后
  - name: 再按 ⌘/ 关闭面板
    do: key
    key: "cmd+/"
    expect:
      - shot: 面板已关闭
      - label: 面板已关闭
        ax: { not: "键位（生效中）" }
  - name: 关面板后与基线逐字节比较（真正验证不穿透）
    expect:
      - label: 面板打开期间文档逐字节不变（作用域键与可打印字符都没穿透）
        editor: { unchangedSince: beforePanel }
      - label: 注入的字符没有落进文档
        editor: { not: "x" }
---

说明：⌘Z 是本套件最有价值的一条真机判定——Tauri 默认菜单的预置 Undo 带 ⍰⌘Z key equivalent，
会先在视图层级被吃掉，M?/keymap-unify 的修复把它换成无 accelerator 的自定义菜单项，让 ⌘Z 回到
webview 键位层。本场景用「插入 → ⌘Z → 插入内容消失」直接判定该路径。Emacs 逐键行为
（⌃V/⌥V、⌃L、⌃D/⌃H/⌃T、⌥D/⌥⌫、⌃K/⌃Y、⌃G、shift-extend）依赖光标与选区位置，KimiCU 的 AX
输出不暴露选区；其中「不破坏文档」这一层由本场景的负向断言与场景 03 覆盖，逐键语义由 chromium
侧 `tests/visual/scenes/m132-emacs-keys` 覆盖。

面板不穿透的**基线必须在开面板前记录、关面板后比较**：⌘/ 面板打开期间 AX 快照里没有 AXTextArea
（实测 0 个，面板前后各 1 个），在面板内读文档只会读到「不可读」。套件侧已把「编辑器节点不可读」
与「文档为空」分开：不可读时 editor.* 一律记 FAIL，不再空转。
