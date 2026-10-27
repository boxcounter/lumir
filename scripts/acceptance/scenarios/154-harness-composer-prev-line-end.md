---
# M465：composer 末段空行行首按 ⌃B ⇒ 落在**上一行行末**（不是倒数第二个字符之后）。
#
# 缺陷现场（Alex，2026-10-12 dogfood，附截图）：「当我把光标放在末行行首，按 Ctrl+B，光标移动到
# 上一行的倒数第二个字符后面，而不是行末。」现场 = 三行 composer（两行文本 + 末尾空行，M456 起
# ⇧Enter 在段末落下的常驻空段落）。
#
# 根因（模型层）：`composerCaretStops` 对每个候选停靠点先过 `normalizeComposerCaret`，而该折叠
# 不加条件地把**任何**段落非空末缘 `(i, len)` 折成后块前缘 `(i+1, 0)`。折叠只对**卡片**档成立
# （卡片前缘的写回位就是前段末缘，`domCaretTarget`）；后块是**段落**时两个块各占一行，后块前缘在
# 下一行、不是同一位。折叠后 `(i, len)` 被去重合并吃掉 ⇒ 序列里 `(i+1, 0)` 的前一项退化成
# `(i, len-1)`，⌃B 于是落在**倒数第二个字符之后**。
#
# 判据形态：AX 不暴露 contenteditable 内的光标位（套件 README「光标/选区不可断言」条），落点读数
# 换形态——**导航之后键入探针串，断言它接在哪一行**。探针串接在 `hnl-brk-cd` 之后 = 那一次 ⌃B
# 落在上一行行末；夹在 `c` 与 `d` 之间（`hnl-brk-cxqzkd`）是缺陷签名；另起一行是另一形态。
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

  - name: 真实鼠标点 composer（contenteditable 的 DOM 焦点靠真实 mousedown 建立）
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
  # composerObserver 从 DOM 回灌模型时把软断行块折叠掉，注入落点错位（README 的 typeInNode 条本就
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

# 154-harness-composer-prev-line-end —— 末段空行行首 ⌃B 落上一行行末（M465）

## 本场景在验什么

Alex 原话（2026-10-12）：「当我把光标放在末行行首，按 Ctrl+B，光标移动到上一行的倒数第二个字符
后面，而不是行末。」合同条款 = [docs/specs/harness-composer.md](../../../docs/specs/harness-composer.md)
的 **HC4 第 1 条**（停靠点序列的两条不变量：一步必有位移、序列不丢点）：

1. 段落后紧邻段落（含 M456 起常驻的末尾空段落）时，前段**末缘** `(i, len)` 是序列上的独立
   停靠点 ⇒ 从后块前缘按 ⌃B 落 `(i, len)` = **上一行行末**；
2. 落点用探针串读数：接在 `hnl-brk-cd` 之后 = 落在该行行末；夹在 `c` / `d` 之间 = 缺陷形态；
3. ⌃F 的反向对称用**往返**形态判（⌃F 一步 + ⌃B 一步）。

## 判据为什么这样写

- **AX 通道不暴露 contenteditable 内的光标位**（套件 README「光标/选区不可断言」条），落点读数
  因此换成「导航之后落一个探针串，断言它接在哪」——与场景 150 同一套口径。
- **三条断言都有区分度**（反向验证：把 `normalizeComposerCaret` 的折叠改回无条件形态后本场景
  判红，读数与截图落 `.local/acceptance/m465-acceptance/`，git 外）：
  - 修前那次 ⌃B 落 `(i, len-1)` ⇒ 探针串夹在末尾两字符之间（`hnl-brk-cxqzkd`）；
  - 修前 ⌃F 从段末落到「末尾之后」⇒ 往返后探针串另起一行；
  - 「接在上一行行末」这条是正向签名，与上面的负向签名互为反向验证。
- **注入通道（M518）**：第一行（软断行之前）用 `typeInNode`，⇧Enter 之后的两行文本与两个探针串
  一律 `do: keys`（逐键 `press_key`）。软断行之后的素材注入不能走 `typeInNode`——它的 `type_text`
  是 AX 注入、不进 composer 模型，`composerObserver` 从 DOM 回灌时把软断行块折叠，落点错位
  （M517 探针定案；README 的 `typeInNode` 条本就写明「caret 由键盘导航定位、落点即判据的步骤不适用」）。
  **全程不碰原生菜单 Paste**——134 / 141 / 150 的注入阻塞来自「原生菜单粘贴之后 CGEvent 逐键确定性
  死亡」（backlog「待修 findings」的「菜单 Paste 之后注入不落地」条 + README 的「原生剪贴板命令」已知边界），本场景不经过那条路径，因此真机可跑
  （同场景 117 的 M462 段）。

## 已知边界（如实登记）

- **⌃F 单步没有独立的真机签名**：修前它落到「末尾之后」（块级容器边界）、修后落到空段落前缘，
  两者都是 0×0 的无几何位置（M457 / M462 的探针读数），AX 与像素都读不出差别——本场景因此用
  「⌃F + ⌃B 往返」的合成形态判，单步的模型层判据由 `tests/unit/composer-nav.test.ts` 的
  「停靠点相邻即互为一步」属性承担。（M473 起「末尾之后」在**末块是非空段落**时改写该段文本末缘
  ——本场景的末块是**末尾空段落**，两档因此仍是 0×0，上面的判据形态不受影响。）
- **⌃⇧F / ⌃⇧B 扩选族**走的是同一份移动纯函数（HC4 第 3 条），本场景不另立真机步骤——真机层
  扩选族的既有判据在场景 146，模型层的对称性由上述属性覆盖。
- **段落 - 段落这一档的「写回位」**在真机上只能通过「探针串接在哪一行」间接判——本套件没有
  JS 求值通道（`scripts/acceptance/lib/cu.mjs`），读不到 `domCaretTarget` 的落点形态本身。
