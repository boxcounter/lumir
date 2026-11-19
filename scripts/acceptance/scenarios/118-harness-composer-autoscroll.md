---
id: "118-harness-composer-autoscroll"
item: 118
tier: full
title: composer 断行后视口自动滚到光标行：最下一行带 = 新断出的空行（M419，HC2）
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

  - name: 键入第 1 行（行尾 ⇧Enter）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|l01" }
    text: "l01"
  # M507 裁决（勿迁）：本步 chord 的副作用在 AX 里**逐次不可观测**——段末 ⇧Enter 落的空段落不序列化
  # （AX 只在块之间插 \n），bbox 又受 composer min-height 封顶。**不要加 `verify`**：命中会被判
  # 「未落地」重注后假 FAIL，重注还可能多落一个查不出来的空段落。判据与证据见 README「已知边界」的
  # chord verify 条（⇧Enter 族的根治方向 = 套件自有 CGEvent 键盘注入通道，M509 探针立项中）。
  - do: key
    key: "shift+return"
    name: 第 1 行后的 ⇧Enter
  # M518：⇧Enter 之后的素材注入改走 keys（逐键 press_key），不再用 typeInNode——M517 探针定案
  # （2026-10-14）：typeInNode 的 type_text 是无 index 的 AX 注入、不进 composer 模型，软断行之后
  # AXTextArea 值 "l01l02\nl03l04\nl05l06\nl07l08l09l10"：十行被折成五块）。键串不含 'e'
  # （press_key 丢键史字符，M497/M509）。第 1 行（软断行之前）仍走 typeInNode。
  - name: 键入第 2 行
    do: keys
    keys: ["l", "0", "2"]
    gapMs: 60
  - do: key
    key: "shift+return"
    name: 第 2 行后的 ⇧Enter
  - name: 键入第 3 行
    do: keys
    keys: ["l", "0", "3"]
    gapMs: 60
  - do: key
    key: "shift+return"
    name: 第 3 行后的 ⇧Enter
  - name: 键入第 4 行
    do: keys
    keys: ["l", "0", "4"]
    gapMs: 60
  - do: key
    key: "shift+return"
    name: 第 4 行后的 ⇧Enter
  - name: 键入第 5 行
    do: keys
    keys: ["l", "0", "5"]
    gapMs: 60
  - do: key
    key: "shift+return"
    name: 第 5 行后的 ⇧Enter
  - name: 键入第 6 行
    do: keys
    keys: ["l", "0", "6"]
    gapMs: 60
  - do: key
    key: "shift+return"
    name: 第 6 行后的 ⇧Enter
  - name: 键入第 7 行
    do: keys
    keys: ["l", "0", "7"]
    gapMs: 60
  - do: key
    key: "shift+return"
    name: 第 7 行后的 ⇧Enter
  - name: 键入第 8 行
    do: keys
    keys: ["l", "0", "8"]
    gapMs: 60
  - do: key
    key: "shift+return"
    name: 第 8 行后的 ⇧Enter
  - name: 键入第 9 行
    do: keys
    keys: ["l", "0", "9"]
    gapMs: 60
  - do: key
    key: "shift+return"
    name: 第 9 行后的 ⇧Enter
  - name: 键入第 10 行（内容至此超过 composer 的 max-height 150px）
    do: keys
    keys: ["l", "1", "0"]
    gapMs: 60

  - name: 最后一次 ⇧Enter——新行必须落在视口内（HC2）
    do: key
    key: "shift+return"
    expect:
      - label: 断行是真的（composer 处于 max-height 封顶的可滚态：十行内容 236px > 150px）——缺陷形态下十次按键合并成五行、composer 只有 117px 高，本条红
        geom:
          target: { role: AXTextArea, any: "/l0/" }
          minHeight: 140
      - label: 上部的文字行照旧有字形（对照：面板真的在渲染文字，不是空的/塌的）
        pixel:
          contrast:
            - { x: 748, y: 702, as: "倒数第二行文字行（l10）", min: 60 }
      - label: 换行后光标行在视口内：composer 可视区**最下一行带是空白** = 刚断出来的空行（缺陷形态下这一带是「盒子长高但没有可渲染行」留下的幻影空白，本条是行为守卫、不区分显式滚动代码——口径见正文）
        pixel:
          same:
            - [ { x: 748, y: 723, as: "最下一行带（新断出的空行）" }, { x: 1150, y: 723, as: "同一行带右侧空白" } ]
      # 跨行判据走**解析值**（M765，与 117 同口径）：KimiCU 0.6.8 起 dump 原文里的换行是字面 `\n`，
      # `ax.has` 的 `[\r\n]+` 命中 0 次（假红）；`node` 匹配 `parseNodes` 还原后的 value。
      - label: 十行内容逐行落地（换行真的存在，不是同行拼接）
        node: { role: AXTextArea, name: 'l09\n+l10', present: true }
      - shot: 01-断行后-视口在最末行
---
# 118 —— CM composer 断行后的光标可见性

## 判据

连续 ⇧Enter 增加逻辑行后，CM 负责把 caret 所在行揭示到可视区。场景用最后一行字形、换行值与滚动读数确认用户不需要手动回滚。实现没有 `renderComposer`、程序化 Range caret 或 observer 归一路径。

## 通道边界

保留场景内的 chord 不盲目重试与逐键注入纪律。AX 读不到单次空行几何时，以随后落地的可见探针文本判定，不把不可读当空值。
