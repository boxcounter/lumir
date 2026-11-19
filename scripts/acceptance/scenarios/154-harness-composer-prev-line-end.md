---
# CM 纯文本导航回归：末尾空行行首按 ⌃B，应回到上一逻辑行行末。
# 用导航后的探针文本落点代替 AX 不可读的 caret offset。
id: "154-harness-composer-prev-line-end"
item: 154
tier: full
title: composer 末段空行行首 ⌃B 落上一行行末（M465，HC4 第 1 条）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  # 行位判据与 117 同口径：窗口尺寸自 M437 起由产品按工作区 90% 现算，显式钉住才有稳定几何。
  - name: 钉窗口尺寸
    do: resizeWindow
    width: 1200
    height: 800
    settleMs: 900

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
    as: doc-before-caret

  - name: 键入第一行
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|hnl-brk-aa" }
    text: "hnl-brk-aa"

  # M507 裁决（勿迁）：本步 chord 的副作用在 AX 里**逐次不可观测**——段末 ⇧Enter 落的空段落不序列化
  # （AX 只在块之间插 \n），bbox 又受 composer min-height 封顶。**不要加 `verify`**：命中会被判
  # 「未落地」重注后假 FAIL，重注还可能多落一个查不出来的空段落。判据与证据见 README「已知边界」的
  # chord verify 条（⇧Enter 族的根治方向 = 套件自有 CGEvent 键盘注入通道，M509 探针立项中）。
  - name: ⇧Enter（段末落一个新空段落，光标在其段首）
    do: key
    key: "shift+return"

  # M518：⇧Enter 之后的素材注入改走 keys（逐键 press_key），不再用 typeInNode——M517 探针定案
  # （2026-10-14）：typeInNode 的 type_text 是 AX 注入、不进 composer 模型，软断行之后
  # 写明：caret 由键盘导航定位、落点即判据的步骤不适用）。本步键串不含 'e'（丢键史字符，M497/M509）。
  # 第一行（软断行之前）仍走 typeInNode：注入时 caret 在空 composer 末尾，与追加语义等价。
  - name: 键入第二行
    do: keys
    keys: ["h", "n", "l", "-", "b", "r", "k", "-", "c", "d"]
    gapMs: 60

  - name: ⇧Enter（第二行之后落末尾空行——光标停在空行行首 = 待验位置）
    do: key
    key: "shift+return"
    expect:
      # 跨行判据走**解析值**（M765，与 117 同口径）：KimiCU 0.6.8 起 dump 原文里的换行是字面 `\n`，
      # `ax.has` 的 `[\r\n]+` 命中 0 次（假红）；`node` 匹配 `parseNodes` 还原后的 value。
      - label: 两行文本各占一行（AX 里有换行分隔）
        node: { role: AXTextArea, name: 'hnl-brk-aa\n+hnl-brk-cd', present: true }
      - shot: 01-现场-两行文本加末尾空行-光标在空行行首

  - name: ⌃B（**待验动作**：空行行首回移一步 ⇒ 应落在上一行行末）
    do: key
    key: "ctrl+b"
    expect:
      - label: 导航不改文本（不是编辑）
        node: { role: AXTextArea, name: 'hnl-brk-aa\n+hnl-brk-cd', present: true }

  # M498 迁移边界（如实登记）：⌃B/⌃F 后的落点即判据，typeInNode 的可靠通道是「追加到末尾」
  # ——语义不合，本步与下面第二个探针串留在 do:keys（探针串无 'e'，避开了确定性丢键；
  # 随机连续丢键段风险 finding 已报）。
  - name: 键入探针串（落进 ⌃B 之后的那个位置）
    do: keys
    keys: ["x", "q", "z", "k"]
    gapMs: 60
    expect:
      - label: 探针串接在**上一行行末**（`hnl-brk-cd` 之后紧邻 `xqzk`，同一行）
        ax: { has: "hnl-brk-cdxqzk" }
      - label: 缺陷签名不在场（落点差一个字符：探针串夹在 `c` 与 `d` 之间）
        ax: { not: "hnl-brk-cxqzkd" }
      # 负向形态同理走解析值：`ax.not` 的 `[\r\n]+` 在字面 `\n` 原文上命中 0 次 ⇒ 恒真（假绿）。
      # `present: false` 要求**没有任何** AXTextArea 命中该跨行串，且退化快照（0 节点）一律 FAIL。
      - label: 缺陷形态之二不在场（探针串另起一行 = 光标没回到上一行）
        node: { role: AXTextArea, name: 'hnl-brk-cd\n+xqzk', present: false }
      - label: 探针串没有漏进编辑器文档（焦点确在 composer）
        editor: { unchangedSince: doc-before-caret }
      - shot: 02-⌃B后落字-接在上一行行末

  # ── ⌃F 的对称面（HC4 第 1 条的「一步」双向）────────────────────────────────────────────
  # ⌃F 单步没有独立的真机签名（修前它落到「末尾之后」、修后落到空段落前缘，两者都是 0×0 的
  # 无几何位置，AX / 像素都读不出差别）——因此这一档用**往返**形态判：⌃F 一步 + ⌃B 一步回到
  # 原处再键入。修后探针串接在上一行行末（原地往返）；修前 ⌃F 落到「末尾之后」、⌃B 从那里退回
  # 空段落前缘 ⇒ 探针串**另起一行**（缺陷签名）。
  - name: ⌃F（从上一行行末向下一步 ⇒ 应落到末尾空行）
    do: key
    key: "ctrl+f"

  - name: ⌃B（反向一步 ⇒ 应回到刚才那一行的行末）
    do: key
    key: "ctrl+b"

  - name: 键入第二个探针串（判据：接在上一行行末 = 往返回到原处）
    do: keys
    keys: ["y", "q", "z", "k"]
    gapMs: 60
    expect:
      - label: 第二个探针串接在第一个之后（同一行——⌃F / ⌃B 各一步、原地往返）
        ax: { has: "hnl-brk-cdxqzkyqzk" }
      - label: 缺陷签名不在场（⌃F 落到「末尾之后」后 ⌃B 只退到空段落前缘 ⇒ 探针串另起一行）
        node: { role: AXTextArea, name: 'hnl-brk-cdxqzk\n+yqzk', present: false }
      - label: 两张探针串都落在 composer、没漏进编辑器文档
        editor: { unchangedSince: doc-before-caret }
      - shot: 03-⌃F⌃B往返后落字-仍在同一行
---
# 154 —— 空行行首 ⌃B 的上一行末落点

## 判据

末尾空行行首按 ⌃B 应回到上一逻辑行行末。AX 不暴露 caret offset，因此导航后键入探针串：接在上一行原文之后为正观测，落在倒数第二字符之后或另起一行为反例。⌃F/⌃B 往返同样不得改变落点。

## 实现与通道边界

移动由 CM selection 命令完成，不再有块下标、末尾之后等价表示或 caret normalize。逐键注入与 chord 不盲目重试沿用 frontmatter 的通道纪律；产品断言行未改。
