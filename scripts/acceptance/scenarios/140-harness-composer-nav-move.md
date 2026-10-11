---
# M447（change composer-emacs-nav）：composer 内 Emacs 移动族（⌃F/⌃B/⌃A/⌃E/⌃N/⌃P）的落点判据。
# 本套件的 AX 通道不暴露 contenteditable 内的光标位（README「光标/选区不可断言」条），因此
# **落点读数换形态**：先导航、再键入一个探针字符，断言它落在哪一格——落点由模型读回的光标决定。
# 判据口径见正文「判据为什么这样写」。
id: "140-harness-composer-nav-move"
item: 140
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

  - name: 键入探针串 abcd（小写——KimiCU 的按键注入恒为小写）
    do: keys
    keys: ["a", "b", "c", "d"]
    gapMs: 100
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

  - name: ⌃A 到行首后键入 y
    do: keys
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

  - name: ⇧Enter 换行后键入第二段 mn
    do: keys
    keys: ["shift+return", "m", "n"]
    gapMs: 150
    expect:
      - label: 第二段到位（两段分两行）
        ax: { has: "/yabzcdw[\r\n]+mn/" }

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
- **小写探针串**：KimiCU 的按键注入恒为小写字母（场景 117 的既有口径）。
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

## 已知边界（如实登记）

- 光标几何（是否可见、在视口内）不在本场景的机器判据面（AX 不暴露光标几何），归截图人工过目
  （`shots/`）与合同 HC2 的纯函数单测。
- 逻辑行口径（`\n` 为界，不是视觉折行）：长段落按折行的上下移动留 dogfood 后另裁
  （change 的裁决点 6 与后续项 3）。
- 本场景不发消息、不写 vault（mock provider 只备着，零外部 API）；真实 vault 与 `~/.config/lumir`
  全程不读写；真机段走 `LUMIR_ACCEPTANCE_PORT`（1430），1420 不碰。
