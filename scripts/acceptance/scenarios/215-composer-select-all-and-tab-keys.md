---
# M627（Alex 2026-10-23 的三条报告之二、之三）：
#   ① 「harness composer 里 CMD + A 没有选中 composer 中的全文」——⌘A 归 `text` 作用域后，
#      composer 内全选必须覆盖全部块（含卡片）。真机通道注入不了 ⌘A（M536 键码级丢弃），因此
#      本场景用 `[keys]` 把**同一条命令**（editor.select-all）绑到通道可达的 ⌘J 上，验
#      composer 侧命令实现的真机行为；⌘A → 命令这一步（含原生菜单让位）由 chromium 场景
#      tests/visual/scenes/m627-composer-select-all.spec.ts 与 Rust 单测覆盖（见正文边界）。
#   ② 「三键组合无法切换 TAB：CMD + SHIFT + ,/.」——⌘⇧, / ⌘⇧. 的 token 形态在真机注入通道
#      上给不出（Shift 隐含符号条，M242 同款），因此同样用 ⌘K / ⌘L 绑到 tab.prev / tab.next
#      验**命令链路的真机行为**；`Cmd-<` / `Cmd->` 的按键链路判据在 chromium 的
#      tests/visual/scenes/m242-tab-cycle-key-tokens.spec.ts。
id: "215-composer-select-all-and-tab-keys"
item: 215
title: composer 全选（经同命令可达键）与 tab.prev / tab.next 的真机命令链路（M627）
fixtures: [tabs-a.md, tabs-b.md, harness-note.md]
open: tabs-a.md
marker: "标签场景 A"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
  keys:
    "Cmd-j": "editor.select-all"
    "Cmd-k": "tab.prev"
    "Cmd-l": "tab.next"
seed:
  registry:
    - { id: acc-m627, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-m627: { tabs: [tabs-a.md, tabs-b.md], active: tabs-a.md }
steps:
  - name: 等启动恢复（vault + 两个标签）跑完
    do: sleep
    ms: 8000
    expect:
      - label: 会话里的两个标签都恢复了（每个标签恰好一个关闭钮）
        ax: { count: { pattern: "关闭 ", exact: 2 } }
      - label: 激活项是会话里存的 tabs-a
        ax: { has: "/AXRadioButton \\(tabs-a\\.md\\) Value: true/" }
      - label: tabs-a 的正文上屏
        editor: { has: "标签场景 A" }

  # ── ① composer 全选（命令链路：⌘J 绑定到 editor.select-all） ──────────────────────
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: composer 在位（空输入态 = D328 占位读屏名）
        ax: { has: "问点什么" }

  - name: 真实鼠标点 composer（contenteditable 的 DOM 焦点靠真实 mousedown 建立）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 记编辑器文档基线（打字 / 删除不得漏进文档）
    do: recordEditor
    as: 键盘前文档

  - name: 键入第一段探针串 alpha
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|alpha" }
    text: "alpha"
    expect:
      - label: 第一段落进 composer
        ax: { has: "alpha" }

  - name: ⇧Enter 换行后键入第二段 beta（两段让「全选」有可判的多块文本）
    do: keys
    keys: ["shift+return"]
    gapMs: 150

  - name: 键入第二段探针串 beta
    do: typeInNode
    target: { role: AXTextArea, name: "alpha|beta" }
    text: "beta"
    expect:
      - label: 第二段落进 composer（两段分两行）
        ax: { has: "/alpha[\r\n]+beta/" }

  - name: 注入前确保窗口在前台
    do: focusWindow

  - name: ⌘J（[keys] 把 editor.select-all 绑到通道可达的键上）→ 全选 composer 全文
    do: key
    key: "cmd+j"

  - name: 退格删除整个选区——全选成立的端到端判据
    do: key
    key: "Backspace"
    expect:
      - label: composer 回到空输入态（占位读屏名回来）——全选真的选中了全文
        ax: { has: "问点什么" }
      - label: 两段探针串都不在了（不是只删了一个字符 / 一段）
        ax: { not: "alpha" }
      - label: 第二段也不在
        ax: { not: "beta" }
      - label: 删除没有漏进编辑器文档
        editor: { unchangedSince: 键盘前文档 }
      - shot: 01-全选后删除-composer-清空

  # ── ② tab.prev / tab.next 的命令链路（⌘K / ⌘L 绑定） ────────────────────────────
  - name: 注入前确保窗口在前台
    do: focusWindow

  - name: ⌘L（tab.next）：tabs-a → tabs-b
    do: key
    key: "cmd+l"
    expect:
      - label: 激活标签切到 tabs-b
        ax: { has: "/AXRadioButton \\(tabs-b\\.md\\) Value: true/" }
      - label: 反向：tabs-a 不再是激活项
        ax: { not: "/AXRadioButton \\(tabs-a\\.md\\) Value: true/" }
      - label: tabs-b 的正文上屏（切标签必须真的换文档）
        editor: { has: "标签场景 B" }

  - name: 注入前确保窗口在前台
    do: focusWindow

  - name: ⌘K（tab.prev）：tabs-b → tabs-a
    do: key
    key: "cmd+k"
    expect:
      - label: 激活标签切回 tabs-a
        ax: { has: "/AXRadioButton \\(tabs-a\\.md\\) Value: true/" }
      - label: tabs-a 的正文上屏
        editor: { has: "标签场景 A" }
      - shot: 02-tab-循环回第一个

---

# composer 全选与 tab 键的命令链路（M627）

## 这个场景验什么

Alex 2026-10-23 的两条报告：

1. **composer ⌘A 全选**：修法是让 ⌘A 真正进统一键位层（Edit 菜单的预置 Select All 让出
   加速键）+ 把 `editor.select-all` 收进 `text` 作用域（composer 侧由面板的模型层全选，
   不再依赖引擎原生 selectAll——它在混排 contenteditable 上选不到全文）。
2. **⌘⇧, / ⌘⇧. 切标签**：两条新绑定指向既有的 `tab.prev` / `tab.next`（零新命令）。

真机判据取**同一条命令**经通道可达键触发的行为：`[keys]` 把 `editor.select-all` 绑到 `⌘J`、
`tab.prev` / `tab.next` 绑到 `⌘K` / `⌘L`，验的是 composer 全选实现与标签命令链路在
WKWebView 里的真实行为（全选 → 退格 → composer 清空；切标签 → 正文真的换）。

## 覆盖边界（如实登记）

- **⌘A 的按键链路不在真机验**：KimiCU 的 `press_key` 对 `cmd+a` 是键码级确定性丢弃
  （README「已知边界」的 M536 条，5/5 实测）。判据落在 chromium 的
  `tests/visual/scenes/m627-composer-select-all.spec.ts`（Playwright 按 US 布局自己算字符，
  走同一条 window keydown 分发器；含卡片 + 段落、全选后键入替换、编辑器面互不串台三条）。
- **⌘⇧, / ⌘⇧. 的按键链路不在真机验**：`⇧,` / `⇧.` 的字符形态（`<` / `>`）在注入通道给不出
  （与 M242 的 `⌘}` / `⌘{` 同一条 Shift 隐含符号边界）。判据落在 chromium 的
  `tests/visual/scenes/m242-tab-cycle-key-tokens.spec.ts`（`Meta+Shift+Comma` → key `<`）与
  `tests/unit/keys.test.ts` 的 token 形态专测。
- **方向映射是假设**：`⌘⇧,` = 上一个、`⌘⇧.` = 下一个（, 在 . 左侧）由 tower 拟定、未经 Alex
  确认；若验收时两键方向相反，按同一对 token 对调即可（与命令层无关）。
- **Edit 菜单 Select All 的点击路径不在本场景**：套件没有菜单栏驱动动作（无菜单栏点击先例）。
  该路径由 Rust 单测（`menu_command_of` 的 id → 载荷）+ 前端一处按焦点路由的实现覆盖；
  真机上的人肉复验步骤记在正文末：焦点在 composer、点 Edit > Select All、按退格——composer
  应清空。
