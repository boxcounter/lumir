---
id: "search-01-find"
item: 10
title: 文件内搜索（⌘F）：panel 出现、匹配计数、上一个/下一个导航、Esc 还原焦点
fixtures: [search-probe.md]
open: search-probe.md
marker: "NEEDLE"
steps:
  - name: 建立编辑器焦点
    do: clickEditor
    dy: 6
    expect:
      - label: 文档已装载（目标词出现三次的短文档）
        editor: { has: "NEEDLE" }
  - name: 光标归位到文档首行行首（⌘↑ 原生到文档头 + ⌃A 行首，后者走统一键位层）
    do: keys
    keys: ["cmd+up", "ctrl+a"]
    gapMs: 250
    expect:
      - label: 光标归位后文档未变
        editor: { has: "NEEDLE" }
  - name: 记录文档基线（打开 panel 前）
    do: recordEditor
    as: beforeSearch
    expect:
      - label: 基线可读且非空（确认记的是真文档，不是不可读的空串）
        editor: { has: "NEEDLE" }
  - name: 用 ⌥⇧F（按词扩选）选中行首那个 NEEDLE——查询词由选区带入
    do: key
    key: "alt+shift+f"
    expect:
      - label: 扩选后 AX 可读（选区范围 AX 不暴露，真正判据是下一步带进输入框的查询词）
        ax: { has: "NEEDLE" }
  - name: ⌘F 打开搜索 panel（查询词取当前选区，官方 openSearchPanel 口径）
    do: key
    key: "cmd+f"
    expect:
      - label: panel 就位（「上一个」按钮在 AX 里可见）
        ax: { has: "上一个" }
      - label: panel 就位（「下一个」按钮）
        ax: { has: "下一个" }
      - label: 选区文本已带进输入框（查询词 = NEEDLE）
        ax: { has: "/AXTextField = \"NEEDLE\"/" }
      - label: 计数 1/3（选区正落在第一个匹配上）
        ax: { has: "1/3" }
      - shot: ⌘F-打开搜索-计数1_3
  - name: 回车导航到下一个匹配
    do: key
    key: "return"
    expect:
      - label: 计数前进到 2/3（选区移到第二个匹配）
        ax: { has: "2/3" }
      - label: 不再是第一个匹配
        ax: { not: "1/3" }
      - shot: 导航到第二个匹配
  - name: 回车再前进一个
    do: key
    key: "return"
    expect:
      - label: 计数前进到 3/3
        ax: { has: "3/3" }
      - shot: 导航到第三个匹配
  - name: ⇧回车回退到上一个匹配
    do: key
    key: "shift+return"
    expect:
      - label: 计数回退到 2/3
        ax: { has: "2/3" }
      - label: 回退后不再是第三个匹配
        ax: { not: "3/3" }
      - shot: 回退到第二个匹配
  - name: Esc 关闭 panel
    do: key
    key: "escape"
    expect:
      - label: panel 已关闭（bar 上的导航按钮从 AX 消失）
        ax: { not: "下一个" }
      - label: 关闭后文档逐字节等于搜索前的基线（搜索与导航不改文档）
        editor: { unchangedSince: beforeSearch }
      - shot: panel-已关闭
  - name: 关闭后敲字符：焦点已回到编辑器（字符落进文档即证明焦点不在 panel 输入框）
    do: keys
    keys: ["z", "z", "z"]
    gapMs: 250
    expect:
      - label: 字符落进文档（焦点已交还编辑器）
        editor: { has: "zzz" }
      - shot: 关闭后敲字符
---

说明：搜索 panel 由 `@codemirror/search` 提供能力（搜索状态 / 全匹配高亮 / 上一个 / 下一个 /
大小写切换），UI 是本项目按 editorial 基线重制的 bar（src/search.ts + src/search-panel.css）；
⌘F 经 keys.ts 的统一键位层（`app.search-open`，global 作用域）绑定，不是 editor 里的旁路 keymap
——重绑与键位面板可见性由 `search-02-binding` 覆盖。

**查询词为什么由选区带入，而不是逐字符敲进输入框**：本机实测，KimiCU 的 `press_key` 把可打印
字符注入 WKWebView 的原生 `<input>` 时会**丢键**——注入 `needle` 只有 `n/d/l` 落地，注入
`abcdefghijklmnopqrstuvwxyz` 只落地 `abcdghijkl`。app 侧探针（panel 根上的 keydown 监听 + input
事件回读）证明丢的键**从未到达 DOM**（收到的 keydown 序列是 `N,D,L`，输入框依次为 `[n][nd][ndl]`），
即丢在注入链路上、不是应用或 panel 的问题；同一注入打进编辑器（contenteditable）稳定落地
（末尾 `zzz` 三步即此对照）。故本场景用官方 `openSearchPanel` 的既有语义取查询词：打开时把当前
选区（≤100 字符）作为默认查询——`⌥⇧F` 按词选中行首的 `NEEDLE`，⌘F 时它成为查询词，产物与手敲
查询等价，且不依赖有损的字符注入。该注入缺陷已另立 finding 报给 tower。

断言口径：

- **计数语义**：`当前/总数`。查询词由选区带入时选区正落在第一个匹配上，故开面板即 `1/3`；回车
  进位 `2/3` → `3/3`，⇧回车回退 `2/3`。这条把「匹配计数正确」与「导航真的移动了选区」两个判定
  压在同一条可见证据上——KimiCU 的 AX 不暴露选区范围，计数进位是选区移动唯一可断言的侧面
  （选区与高亮的可见性另见 shots/）。
- **查询词断言用整行精确匹配**：`/AXTextField = "NEEDLE"/` 只认输入框节点的 value，不会被文档
  正文里的同名子串假绿（子串断言在这里会失效——文档里有三个 NEEDLE）。
- **ax 断言放在 shot 之前**：`shot` 会缓存一份 full 模式快照供同步骤后续断言复用，而 full 模式
  的 AX 文本偶发退化（实测有一次不含 panel 节点）。放在 shot 之前走独立的 ax 模式快照，避免把
  快照退化误判成功能缺陷。
- **面板打开期间不读编辑器文本**：套件口径是「编辑器不可读 ≠ 文档为空」（不可读时 editor.* 一律
  FAIL）。「搜索不改文档」这条放在关闭后与基线逐字节比较。
- **最后一步敲字符**：Esc 之后焦点是否真的回到编辑器，只能靠「字符落进文档」证明——若焦点还在
  panel 输入框里，字符会进查询框，文档不会出现 `zzz`。该步在逐字节比较之后执行，不污染前一条断言。
