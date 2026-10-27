---
# M447（change composer-emacs-nav）：composer 内 Emacs 移动族（⌃F/⌃B/⌃A/⌃E/⌃N/⌃P）的落点判据。
# 本套件的 AX 通道不暴露 contenteditable 内的光标位（README「光标/选区不可断言」条），因此
# **落点读数换形态**：先导航、再键入一个探针字符，断言它落在哪一格——落点由模型读回的光标决定。
# 判据口径见正文「判据为什么这样写」。
id: "140-harness-composer-nav-move"
item: 140
tier: full
title: composer 内 Emacs 移动族落点：⌃B/⌃F/⌃A/⌃E/⌃N/⌃P（M447）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
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

  - name: 记编辑器文档基线（打字不得漏进文档——焦点争议的通用防线）
    do: recordEditor
    as: doc-before-nav

  - name: 键入探针串 abcd（小写探针串；typeInNode 粘贴通道原样落地）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|abcd" }
    text: "abcd"
    expect:
      - label: 探针串落进 composer（abcd）
        ax: { has: "abcd" }

  - name: ⌃B 两次（从末尾回退两格）后键入 z
    do: keys
    keys: ["ctrl+b", "ctrl+b", "z"]
    gapMs: 150
    expect:
      - label: z 落在回退两格处（abzcd）——⌃B 的落点读数
        ax: { has: "abzcd" }
      - label: 打字没有漏进编辑器文档（焦点确在 composer）
        editor: { unchangedSince: doc-before-nav }

  # M767：⌃A 走**真键盘事件**通道（`channel: cgevent` → keycode+flags，lib/cgevent-key.swift）。原因：
  # KimiCU 0.6.8 的 press_key 在文本控件上把 ctrl+a 特判成 AX「全选」兼容路径（零键盘事件，应用
  # 键位层命中不到 Ctrl-a），本步会变成「全选 + 覆写」。只切 chord 这一半，断言一条不动；同行紧随
  # 的普通字符 y 仍走 KimiCU（探针 A1：普通字符没有这条兼容路径）。证据：M766 报告
  # `.local/reports/ctrl-a-channel-oct28/README.md`（行为矩阵 A1 vs B1）。
  - name: ⌃A 到行首后键入 y
    do: keys
    channel: cgevent
    keys: ["ctrl+a", "y"]
    gapMs: 150
    expect:
      - label: y 落在行首（yabzcd）——⌃A 的落点读数
        ax: { has: "yabzcd" }

  - name: ⌃E 到行尾后键入 w
    do: keys
    keys: ["ctrl+e", "w"]
    gapMs: 150
    expect:
      - label: w 落在行尾（yabzcdw）——⌃E 的落点读数
        ax: { has: "yabzcdw" }
      - shot: 01-段落内移动族落点

  # M507 裁决（勿迁）：本步是「⇧Enter + 可打印字符」的混合序列，chord 那一半的副作用在 AX 里
  # **逐次不可观测**（段末空段落不序列化 + bbox min-height 封顶）。**不要给本步加 `verify`**：命中会被判
  # 「未落地」重注后假 FAIL，重注还可能多落一个查不出来的空段落。判据与证据见 README「已知边界」的 chord
  # verify 条（⇧Enter 族的根治方向 = 套件自有 CGEvent 键盘注入通道；M767 已落地 chord 形态
  # `channel: cgevent`，但本步未迁移——末尾空段落不可观测的判据还没设计，仍保持盲发、不挂 verify）。
  - name: ⇧Enter 换行后键入第二段 mn
    do: keys
    keys: ["shift+return", "m", "n"]
    gapMs: 150
    expect:
      # 跨行判据走**解析值**（M765，与 117 同口径）：KimiCU 0.6.8 起 dump 原文里的换行是字面 `\n`，
      # `ax.has` 的 `[\r\n]+` 命中 0 次（假红）；`node` 匹配 `parseNodes` 还原后的 value。
      # 别改回 `ax.has`——那是把上游的换行表示法写进场景（README「多行 UI 文本的换行编码」条）。
      - label: 第二段到位（两段分两行）
        node: { role: AXTextArea, name: 'yabzcdw\n+mn', present: true }

  - name: ⌃P 上移一行后键入 p
    do: keys
    keys: ["ctrl+p", "p"]
    gapMs: 150
    expect:
      - label: p 落在第一段同列位——⌃P 的落点读数
        ax: { has: "yapbzcdw" }

  - name: ⌃N 下移一行后键入 q
    do: keys
    keys: ["ctrl+n", "q"]
    gapMs: 150
    expect:
      - label: q 落在第二段同列位——⌃N 的落点读数
        ax: { has: "mnq" }
      - shot: 02-跨段落移动族落点
---

# 140-harness-composer-nav-move —— 移动族逐键落点（M447）

## 本场景在验什么

change `composer-emacs-nav` 把 composer 的 Emacs 文本导航族收回统一键位表（`text` 作用域）与模型层。
本场景覆盖**移动族**六键的**落点**：⌃B（后退一字符）· ⌃A（行首）· ⌃E（行尾）· ⌃P（上一逻辑行）·
⌃N（下一逻辑行）。⌃F 与 ⌃B 对称（同一份移动纯函数），由 140 的 ⌃B 条与单测层覆盖。

## 判据为什么这样写

- **落点读数换形态**：AX 通道不暴露 contenteditable 内的光标位，因此每条导航后**键入一个探针
  字符**，断言它在文本里的**位置**（左右邻字符）——模型读回的光标位决定探针落在哪一格，这条
  是「读数换形态」，不是判据放宽。
- **小写探针串**：历史口径（press_key 注入恒为小写）的遗留；M498 起 typeInNode 走粘贴通道、大小写原样，探针串维持小写不变。
- **`shift+return` 造第二段**：composer 的段落块是逻辑行单位；两段之间的跨块移动（⌃P 出段落）
  需要真实存在的第二段。⇧Enter 落一个新空段落（HC1），随后键入的 `mn` 落进它。
- **`gapMs`**：键入按默认 250ms 间隔注入，四拍可能越过撤销聚簇窗口（1000ms）而碎成多步——
  本场景不判撤销，压小间隔只是让读取窗口稳定。
- **⌃P 的期望值是 `yapbzcdw`（同列位 2）**：键入 `mn` 后光标停在第二逻辑段**行尾**（列 2），
  ⌃P 按 spec「同列位」应落到第一段第 2 列（`ya|bzcdw`）⇒ 键入 p 得 `yapbzcdw`；随后 ⌃N 从
  该处下移同列、超出第二段长度取行尾 ⇒ 键入 q 得 `mnq`（本步期望不变）。M455 修正了原写错的
  `ypabzcdw`（列 1，与「行尾在列 2」自相矛盾），并修好 ⌃P 在**段落末缘**丢列位的实现缺陷
  （`src/harness-panel.ts` 的 `moveLineVertical`：末缘光标被 `normalizeComposerCaret` 归一到
  边界位、列位随之丢失，⌃P 会落到上一行行首而非同列位）。

- **⌃A 走真键盘事件通道（M767）**：KimiCU 0.6.8 的 `press_key` 在文本控件上把 `ctrl+a` 特判成
  AX「全选」兼容路径、零键盘事件（应用键位层命中不到 `Ctrl-a`），本步会变成「全选 + 覆写」——
  这正是 M766 探针行为矩阵 A1 的现场。因此这一步显式写 `channel: cgevent`（`lib/cgevent-key.swift
  --key`，keycode+flags）；**通道只作用于 chord 键**，同行紧随的 `y` 仍走 KimiCU（A1：普通字符没有
  这条路径）。**断言一条没动**：`yabzcd` 就是「y 落在行首」的判据，换成全选再覆写只会剩 `y`
  （M766 报告 `.local/reports/ctrl-a-channel-oct28/README.md` 的 A1 vs B1）。

## 已知边界（如实登记）

- 光标几何（是否可见、在视口内）不在本场景的机器判据面（AX 不暴露光标几何），归截图人工过目
  （`shots/`）与合同 HC2 的纯函数单测。
- 逻辑行口径（`\n` 为界，不是视觉折行）：长段落按折行的上下移动留 dogfood 后另裁
  （change 的裁决点 6 与后续项 3）。
- 本场景不发消息、不写 vault（mock provider 只备着，零外部 API）；真实 vault 与 `~/.config/lumir`
  全程不读写；真机段走 `LUMIR_ACCEPTANCE_PORT`（1430），1420 不碰。
