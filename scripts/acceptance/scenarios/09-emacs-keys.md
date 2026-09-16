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
  - name: 打开 ⌘/ 键位面板
    do: key
    key: "cmd+/"
    expect:
      - shot: 键位面板
      - label: 面板打开（dialog 就位）
        ax: { has: "键位（生效中）" }
      - label: 面板列出命令与键位
        ax: { has: "移动与选择" }
  - name: 面板不穿透——按键不应改到文档
    do: key
    key: "ctrl+n"
    expect:
      - label: 面板打开期间文档逐字节不变（作用域键被拦住）
        editor: { not: "UNDO-ME" }
      - label: 面板仍在
        ax: { has: "键位（生效中）" }
  - name: 再按 ⌘/ 关闭面板
    do: key
    key: "cmd+/"
    expect:
      - shot: 面板已关闭
      - label: 面板已关闭
        ax: { not: "键位（生效中）" }
---

说明：⌘Z 是本套件最有价值的一条真机判定——Tauri 默认菜单的预置 Undo 带 ⍰⌘Z key equivalent，
会先在视图层级被吃掉，M?/keymap-unify 的修复把它换成无 accelerator 的自定义菜单项，让 ⌘Z 回到
webview 键位层。本场景用「插入 → ⌘Z → 插入内容消失」直接判定该路径。Emacs 逐键行为
（⌃V/⌥V、⌃L、⌃D/⌃H/⌃T、⌥D/⌥⌫、⌃K/⌃Y、⌃G、shift-extend）依赖光标与选区位置，KimiCU 的 AX
输出不暴露选区；其中「不破坏文档」这一层由本场景的负向断言与场景 03 覆盖，逐键语义由 chromium
侧 `tests/visual/scenes/m132-emacs-keys` 覆盖。
