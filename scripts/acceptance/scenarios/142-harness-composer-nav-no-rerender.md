---
# M447（change composer-emacs-nav）：导航**不是编辑**——导航（⌃F/⌃B/⌃N/⌃P）不改文本、不成撤销步。
# 判据：键入一段文本 → 导航若干次 → 文本逐字不变；随后一次 ⌘Z 收回的是**最后一次编辑**
#（导航之前那次键入），不是「导航」——导航若被当成一个撤销步，这次 ⌘Z 会空推一步、文本仍旧。
id: "142-harness-composer-nav-no-rerender"
item: 142
tier: full
title: composer 导航不是编辑：文本不变、不成撤销步（M447）
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

  - name: 真实鼠标点 composer
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 键入一段文本 abcde（typeInNode 整串一次粘贴 = 一个撤销步）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|abcde" }
    text: "abcde"
    expect:
      - label: 文本到位（abcde）
        ax: { has: "abcde" }

  - name: 连续导航（⌃F/⌃B/⌃B/⌃F/⌃N/⌃P，只移动、不输入）
    do: keys
    keys: ["ctrl+f", "ctrl+b", "ctrl+b", "ctrl+f", "ctrl+n", "ctrl+p"]
    gapMs: 120

  - name: 等一拍后读文本
    do: settle
    expect:
      - label: 导航后文本逐字不变（导航不是编辑）
        ax: { has: "abcde" }
      - label: 导航没有凭空插入任何字符（composer 节点值逐字仍为 abcde）
        ax: { has: '/AXTextArea = "abcde" @/' }
      - shot: 01-导航后文本不变

  - name: 一次 ⌘Z（CM history）
    do: key
    key: "cmd+z"
    expect:
      - label: 收回到导航之前的那次编辑（文本整段收回）——导航若成步，这条会红（文本仍是 abcde）
        ax: { not: "abcde" }
---
# 142 —— 导航不是编辑

## 判据

导航只改变 CM selection，不改变 doc，也不新增可撤销编辑。场景在导航后执行一次 ⌘Z，验证撤销的是导航前的最后一次文本编辑，而不是导航本身。

## 覆盖边界

旧“整面重渲 / MutationObserver 计数”条款随 contenteditable 块模型退役。CM 自身如何绘制 selection 不归本场景断言；本场景保留文本守恒、history 守恒和文档焦点隔离。
