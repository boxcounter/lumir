---
# M457：composer 内「⌃A 回当前行行首」与「光标在卡片之后空行行首按 ⌃B 落在前一行行末」两条判据。
#
# 缺陷现场（Alex，2026-10-12 dogfood，附截图）：
#   ① 「希望 Ctrl-A 回到行首」——键入之后光标恒停在段落末缘，而段末缘会被
#      `normalizeComposerCaret` 折到下一块前缘 ⇒ 行级命令对着「下一块」算行 ⇒ ⌃A 表现为
#      「按了没反应」（真机探针实测：段末 offset 11 按 ⌃A 选区完全不动）。
#   ② 「光标在卡片之后空行行首按 Ctrl+B，光标出现在摘录卡正文里，而不是行末」——边界位的写回
#      形态是块级容器边界（`Range(composer, N)`），引擎量不出 caret 几何、画在哪由引擎自行
#      决定（真机表现为落进卡片正文）。M457 把写回改成**有文本宿主的相邻位**：段落后紧邻卡片
#      这一档落**前一段落的末缘**（= 前一行行末）。
#
# 「text 作用域有没有派发」这一条的读数也在本场景：⌃A 在段末「不动」只能由「键位层命中 +
# 模型层无动作」产生（原生 ⌃A 会回行首）——因此它是绑定生效的**负向签名**，本场景的
# 「⌃B + 落字」是它的**正向签名**。
#
# 【通道现状，M864，2026-11-20】本场景原先受两条通道问题阻塞：① 原生上下文菜单 Paste 的 AXPress
# 会静默 no-op（M859）；② 菜单 Paste 交互之后 CGEvent 逐键注入对 composer 确定性死亡（M456）。
# M864 把贴图步迁到 cgevent ⌘V，② 的前提消失；探针串的两处 ⌘V 也从 KimiCU press_key（cmd+v 有
# 确定性丢弃族）改走 cgevent。模型层判据（`moveLineStart` / `moveLineEnd` 的段末档、写回落点
# 的文本宿主阶梯）仍由单测覆盖（`tests/unit/composer-nav.test.ts`、`tests/unit/harness-composer.test.ts`），
# 「引擎层判不了」的两条（caret 几何、beforeinput 派发）登记在 backlog「待修 findings」的 M457 WebKit 探针条与 finding。
id: "150-harness-composer-line-start-and-caret-geometry"
item: 150
tier: full
title: composer 卡片后空行：⌃B 落前一行行末 + ⌃A 回行首（M457）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  # 编辑器基线先记（M864 148 真机实证：pane 打开动画期间 AX 长值连读多次都带 U+FFFD 残读）——
  # 此时只有编辑器一棵 AX 树、无动画，判据不变。
  - name: 记编辑器文档基线（打字不得漏进文档——焦点争议的通用防线，场景 100 同口径）
    do: recordEditor
    as: doc-before-caret

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

  - name: 键入合成 marker（小写探针串；typeInNode 粘贴通道原样落地）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|hnl" }
    text: "hnl"
    expect:
      - label: marker 落进 composer
        ax: { has: "hnl" }

  - name: 剪贴板置合成 png（360×200，seed 51）
    do: clipboardImage
    synth: { width: 360, height: 200, seed: 51 }

  # 粘贴通道（M864）：⌘V 走 cgevent 真键盘事件（M859 真机实测）；原生上下文菜单 Paste 的
  # AXPress 会静默 no-op（菜单不收起、paste 不触发），不再使用——见 112 的同段注释。
  # composer 焦点由上面的 clickInNode 建立。
  - name: ⌘V 贴图（cgevent 真键盘事件；光标在 marker 段落末尾 ⇒ 图片插其后、并补一个承接光标的空段落）
    do: key
    key: "cmd+v"
    channel: cgevent
    gapMs: 500

  - name: 等图片卡片落定（现场 = [marker 段落, 图片卡, 空段落]，光标在空段落段首）
    do: waitFor
    waitFor:
      has: ["/hnl[\\s\\S]{0,80}?360×200/"]
    timeoutMs: 30000
    expect:
      - shot: 01-现场-marker段落在图片卡之上-光标在末尾空行

  # 点末尾空行把光标钉在该空段落段首（粘贴后 caret 本应已在那里；本步是确定化前置，
  # 不再承担「菜单粘贴后 window 失焦」的焦点重建职责——M864 起贴图走 cgevent，没有菜单交互）。
  - name: 点末尾空行（把光标钉在承接空段落段首）
    do: clickInNode
    target: { role: AXTextArea, name: "360×200" }
    dy: 0.97
    expect:
      - label: composer 拿到键盘焦点（AX 里恰一个 focused 的 AXTextArea）
        ax: { focused: "AXTextArea" }

  - name: 抢回窗口前台（cgevent 真键盘事件的前台前提）
    do: focusWindow
    retries: 3

  - name: ⌃B（卡片后空行行首回移一步——应落在**前一行的行末**，不是卡片内部）
    do: key
    key: "ctrl+b"

  - name: 探针串置剪贴板（keys 注入在 composer 上不落地 ⇒ 换粘贴通道）
    do: clipboardText
    text: "xqzk"

  - name: ⌘V 落字（落进哪一格 = 上面那一次 ⌃B 把光标挪到了哪；cgevent 真键盘事件）
    do: key
    key: cmd+v
    channel: cgevent
    # M507：chord 副作用回读 verify-retry——⌘V 的直接副作用 = composer 值里多出 "xqzk"（AX 可读，
    # 丢键时值逐字节不变 ⇒ 未变才重注 ≤3 次）。M864：通道从 KimiCU press_key 换到 cgevent
    # （press_key 的 cmd+v 有确定性丢弃族，见 README「原生剪贴板命令」条），verify 语义不变。
    verify: { pattern: "xqzk" }
    expect:
      - label: 探针串**接在 marker 段落末尾**（同一行 ⇒ AX 里 hnl 之后紧邻 xqzk）
        ax: { has: "/hnlxqzk/" }
      - label: 未落位签名不在场（缺陷形态：光标不在文本行上 ⇒ 字要么没落地、要么另起一段落）
        ax: { not: "/hnl[\\s\\S]{1,20}xqzk/" }
      - label: 图片卡片仍在（导航 + 落字都不吞卡）
        ax: { has: "360×200" }
      - shot: 02-⌃B后落字-接在前一行行末

  # M768 通道审计：⌃A 是本场景的被测动作（「回当前行行首」= 应用自己的 `editor.line-start`）。
  # KimiCU 0.6.8 的 press_key 对 ctrl+a 走 AX 全选兼容路径（零键盘事件），键位层命中不到，
  # 下一条 ⌘V 的判据 `/yqzkhnl/`（字落在行首）会因「全文被选中」而必红（假红）。channel: cgevent
  # 改走真键盘事件；断言一条未动。
  - name: ⌃A（回当前行行首——光标现在在该行行末）
    do: key
    channel: cgevent
    key: "ctrl+a"

  - name: 探针串置剪贴板（第二个探针串，与上面那个可区分）
    do: clipboardText
    text: "yqzk"

  - name: ⌘V 落字（⌃A 生效 ⇒ 字落在**行首**；cgevent 真键盘事件）
    do: key
    key: cmd+v
    channel: cgevent
    verify: { pattern: "yqzk" }
    expect:
      - label: 探针串落在 marker 段落**行首**（AX 里 yqzk 在 hnl 之前）
        ax: { has: "/yqzkhnl/" }
      - label: 探针串没有漏进编辑器文档（焦点确在 composer）
        editor: { unchangedSince: doc-before-caret }
      - shot: 03-⌃A后落字-落在行首

  # ── M457 追加：⌃N / ⌃P 走**渲染行**（Alex 2026-10-12 裁决「与编辑器正文对齐」）────────────
  # 现场：一段足够长、在窄 composer 里软折成多行的文本，光标停在**末行**。判据的机器部分在
  # 模型层闸门（`visualLineStepCrossed`，单测）与 WebKit 探针（真实 app 里量选区 rect 的 top：
  # 修前 ⌃P 完全不动，修后 top 减一个行高）；真机套件这一档只留截图给 Alex 过目——AX 不暴露
  # contenteditable 内的光标位，「打字落点」在这里又依赖折行点（脆判据），故不写文本位置断言。
  - name: 键入一段长文本（窄 composer 里软折成多行视觉行）
    do: typeInNode
    target: { role: AXTextArea, name: "yqzk|hnlxqzkyqzkhnlxqzk" }
    text: "hnlxqzkyqzkhnlxqzk"
    expect:
      - label: 长文本落进 composer
        ax: { has: "hnlxqzkyqzkhnlxqzk" }
      - shot: 04-长文本-软折行前的现场

  - name: ⌃P（末行 → 上一渲染行，同 x 位）
    do: key
    key: "ctrl+p"
    expect:
      - label: 光标移动**不改**文本（导航不是编辑）
        ax: { has: "hnlxqzkyqzkhnlxqzk" }
      - shot: 05-⌃P后-光标应落在上一渲染行（人眼读数）

  - name: ⌃N（回到下一渲染行）
    do: key
    key: "ctrl+n"
    expect:
      - label: 光标移动**不改**文本
        ax: { has: "hnlxqzkyqzkhnlxqzk" }
      - shot: 06-⌃N后-光标应回到下一渲染行（人眼读数）
---

# 150-harness-composer-line-start-and-caret-geometry —— ⌃B 落在前一行行末、⌃A 回行首（M457）

## 本场景在验什么

Alex 原话（2026-10-12）：「希望 Ctrl-A 回到行首」；「当光标在新行行首时，我按下 Ctrl+B，光标会出现
在摘录卡正文的位置，而不是出现在行末」。合同条款 = [docs/specs/harness-composer.md](../../../docs/specs/harness-composer.md)
的 **HC3 第 2 条**（边界位的写回落点必须有 caret 几何）与 **HC4 第 1 条**（行级命令按光标所在行算行）：

1. 段落后紧邻卡片这一档按 ⌃B ⇒ 光标落在**前一段落的末缘**（前一行行末）；
2. 该位落字 ⇒ 字接在那一行上（不是另起一段落、也不是没落地）；
3. ⌃A ⇒ 光标回当前行行首。

## 判据为什么这样写

- **本套件的 AX 通道不暴露 contenteditable 内的光标位**（套件 README「光标/选区不可断言」条），
  因此落点读数换形态：**导航之后落一个探针串，断言它接在哪**——「hnl 之后紧邻 xqzk」证明那一次
  ⌃B 把光标落在了 marker 这一行的行末；「yqzk 在 hnl 之前」证明 ⌃A 把光标挪到了行首。
- **两条判据都有区分度**：缺陷形态下 ① ⌃B 的写回形态是块级容器边界，字不会接在 hnl 行末（要么
  没落地、要么另起一段落 ⇒ `/hnlxqzk/` 不命中、`/hnl[\s\S]{1,20}xqzk/` 命中）；② ⌃A 在段末无动作
  ⇒ 字接在行末（`/yqzkhnl/` 不命中）。
- **`focusWindow` / 点末尾空行**：前台与光标确定化的前置——cgevent 的 HID 事件要求 Lumir 在前台；
  点空段落把 caret 钉在承接空段落段首。M864 起贴图走 cgevent ⌘V，不再有「菜单 Paste 后 window
  失焦」这层问题。

## 已知边界（如实登记）

- **通道现状（M864）**：原先的「菜单 Paste 之后注入不落地」前提已随贴图步迁到 cgevent ⌘V 消失；
  两处探针串 ⌘V 也从 KimiCU press_key（cmd+v 确定性丢弃族）改到 cgevent。本场景的 ⌃B / ⌃A /
  ⌃N / ⌃P 与落字判据**待真机复跑重读**（本批真机代表是 112/127/148，150 未在本轮真机窗口内）；
  模型层判据仍由单测覆盖（`tests/unit/composer-nav.test.ts` 的段末档与渲染行闸门、
  `tests/unit/harness-composer.test.ts` 的写回落点阶梯），引擎层（caret 几何、`beforeinput`
  是否派发、渲染行一步）由 M457 的 WebKit 探针判（真实 app + WebKit，读数落
  `.local/probes/m457-probe/`，git 外；永久化的回归判据缺位已作为 finding 与 backlog「待修
  findings」的 M457 WebKit 探针条登记）。
- **⌃N / ⌃P 渲染行这一步的真机读数本场景只留截图**：AX 不暴露 contenteditable 内的光标位，
  「打字落点」在这里依赖折行点（脆判据），故两步只断言「导航不改文本」+ 截图给 Alex 人眼过目。
- **⌃N/⌃P 的视觉行口径在 change 的 delta spec 里还没同步**（待归档 change `composer-emacs-nav`
  的 `specs/harness/spec.md` 仍写「逻辑行之间移动」，living spec 里还没有这句），已按纪律报 tower
  等扩 scope；本场景与合同（`docs/specs/harness-composer.md` HC4）按**裁决后的口径**写。
