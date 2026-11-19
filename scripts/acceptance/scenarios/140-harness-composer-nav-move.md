---
# M447（change composer-emacs-nav）：composer 内 Emacs 移动族（⌃F/⌃B/⌃A/⌃E/⌃N/⌃P）的落点判据。
# 本套件的 AX 通道不暴露 contenteditable 内的光标位（README「光标/选区不可断言」条），因此
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

  - name: 真实鼠标点 composer（CM contentDOM 的 DOM 焦点靠真实 mousedown 建立）
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
# 140 —— CM composer 的 Emacs 移动族

## 判据

⌃B/⌃F、⌃A/⌃E、⌃N/⌃P 经统一键位表适配到 CM 命令。AX 不暴露 caret offset，因此每个导航动作后键入探针字符，以其精确落点验证移动；导航不得改变文本或产生编辑 history，也不得把输入漏进编辑器文档。

## 覆盖边界

视觉行移动由 CM 原语负责。真机只验证命令链路和可观察落点，不再引用已删除的块停靠点或 caret 归一函数。
