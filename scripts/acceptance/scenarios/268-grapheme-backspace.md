---
# M860（change unify-grapheme-backspace-nov19）：真机 WKWebView 下的字素步长 witness。
# 修复前两条现场（双引擎视觉层已钉住，本场景取同一条合同在真实 app 的读数）：
#   1. 正文 / composer 的无修饰物理 Backspace 交给浏览器原生 contenteditable：WKWebView 对
#      阿拉伯文 / 希伯来文附标逐码点退（`xمَy` 一次 Backspace 得 `xمy`，base 与附标断开）；
#   2. composer 的 ⌃H 走 CM `deleteCharBackward`，对职业 ZWJ 等簇只退一个 CM 簇后缀
#      （`Q👩🏽‍🚀W` 一次 ⌃H 得 `Q👩W`）。
# 合同：同一条 `quote-card.clusterBackward` 步长——一次删除 = 一个整字素簇、caret 落删除起点、
# 一次 undo 复原；修饰键变体 / IME / 只读 / 非空选区保持既有路径。
#
# 通道说明（与 267 / 144 同源）：
#   - 物理 Backspace 用 `do: key` 的 KimiCU 通道（裸键不是 chord，cgevent 单数步不允许）；
#     144 的裸 Backspace 步是这条通道的既有先例。
#   - ⌘A / ⌘V / ⌃B / ⌃H / ⌘Z 都是 chord，显式写 `channel: cgevent`（M767 真键盘事件）；
#     M859 实测 cgevent 的 ⌘V 在 WKWebView 落地（code 模式现场）。
#   - 正文内容用剪贴板 + ⌘V 改写（不新增 fixture 文件、不依赖树刷新）：先 ⌘A 全选再粘贴，
#     文档即精确等于粘贴串；随后 ⌘Z 逐级还原。
#   - composer 的读数按 AX 节点值锚定（`node.name` 是裸正则源）：`^Q$` 只匹配值恰好为 `Q`
#     的 AXTextArea（编辑器正文不可能是这个值），因此正向断言有区分度、负向不靠跨节点正则。
#   - **粘贴步用 `do: keys`（单元素）而不是 `do: key`**：`do: key` 的 `gapMs` 不生效（单键步
#     只在 `do: keys` 的循环里 sleep），而 700ms 是历史分组边界，不是猜时长：CM history 的 `newGroupDelay` 是
#     500ms，粘贴后 500ms 内的删除会被并进同一条 undo 记录（Node 探针复现：间隔 0ms 时一次
#     undo 撤到粘贴前、间隔 600ms 时一次 undo 精确复原被删的簇）。本场景要验的是「删除本身
#     一个撤销步」，所以每次粘贴后等过 500ms 再发删除键。
id: "268-grapheme-backspace"
item: 268
tier: full
title: 无修饰物理 Backspace 与 composer ⌃H 按字素簇整簇删除（M860）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  # ---------------------------------------------------------------------------
  # W1：md 正文物理 Backspace——阿拉伯文附标整簇（修复前 WKWebView 只退附标，得 xمy）
  # ---------------------------------------------------------------------------
  - name: 起跑：窗口前台 + 编辑器焦点
    do: focusWindow
    retries: 4
    click: true
    expect:
      - label: 焦点在编辑器正文
        ax: { focused: "AXTextArea" }

  - name: ⌘A 全选（真键盘事件；粘贴将整篇替换）
    do: key
    key: "cmd+a"
    channel: cgevent
    gapMs: 150

  - name: 剪贴板置含阿拉伯文附标的探针串
    do: clipboardText
    text: "xمَy"

  - name: ⌘V 粘贴（正文替换全选内容）
    do: keys
    keys: ["cmd+v"]
    channel: cgevent
    gapMs: 700
    expect:
      - label: 探针串已进正文（base + 附标）
        editor: { has: "xمَy" }

  - name: ⌃B 把 caret 移到 y 之前（附标之后）
    do: key
    key: "ctrl+b"
    channel: cgevent
    gapMs: 150

  - name: Backspace（无修饰物理前删；修复前只退附标 ⇒ xمy）
    do: key
    key: "backspace"
    gapMs: 300
    expect:
      # 判别性判据：整簇删除得 `xy`；只退附标的现场是 `xمy`（"xy" 不在场、`xم` 在场）。
      - label: 附标与 base 一起删除（整簇）
        editor: { has: "xy" }
      - label: 没有留下断开的 base + 附标
        editor: { not: "xم" }

  - name: ⌘Z 一次 undo 复原整簇
    do: key
    key: "cmd+z"
    channel: cgevent
    gapMs: 300
    expect:
      - label: 一次 undo 恢复粘贴后的探针串
        editor: { has: "xمَy" }

  - name: ⌘Z 再撤一拍（撤掉粘贴，回到 fixture 原文）
    do: key
    key: "cmd+z"
    channel: cgevent
    gapMs: 300
    expect:
      - label: fixture 原文回归（本轮没有落盘、无残留修改）
        editor: { has: "HNL-ALPHA" }

  # ---------------------------------------------------------------------------
  # W2：composer 物理 Backspace——阿拉伯文附标整簇（修复前只剩 Q + 附标）
  # ---------------------------------------------------------------------------
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: composer 在位（空输入态 = D328 占位读屏名）
        ax: { has: "问点什么" }

  - name: 真实鼠标点 composer
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: composer ⌘A 全选（保证下面的粘贴是整值替换，不受草稿残留影响）
    do: key
    key: "cmd+a"
    channel: cgevent
    gapMs: 150

  - name: 剪贴板置 composer 探针串（ASCII 前缀 + 阿拉伯文附标，caret 落在末尾）
    do: clipboardText
    text: "Qمَ"

  - name: ⌘V 粘贴进 composer
    do: keys
    keys: ["cmd+v"]
    channel: cgevent
    gapMs: 700
    expect:
      - label: composer 值逐字节等于探针串
        node: { role: AXTextArea, name: "^Qمَ$", present: true }

  - name: Backspace（无修饰物理前删；修复前只退附标 ⇒ Qم）
    do: key
    key: "backspace"
    gapMs: 300
    expect:
      # 锚定整值：`^Q$` 只可能命中 composer 的整簇删除结果，编辑器的 fixture 文本不会命中。
      - label: 附标与 base 一起删除（整簇）
        node: { role: AXTextArea, name: "^Q$", present: true }

  - name: ⌘Z 一次 undo 复原整簇
    do: key
    key: "cmd+z"
    channel: cgevent
    gapMs: 300
    expect:
      - label: 一次 undo 恢复探针串
        node: { role: AXTextArea, name: "^Qمَ$", present: true }

  # ---------------------------------------------------------------------------
  # W3：composer ⌃H——职业 ZWJ + 肤色整簇（修复前 CM 簇后缀只退到 Q👩W）
  # ---------------------------------------------------------------------------
  - name: composer ⌘A 全选（清空上一轮探针串）
    do: key
    key: "cmd+a"
    channel: cgevent
    gapMs: 150

  - name: 剪贴板置 ZWJ 探针串
    do: clipboardText
    text: "Q👩🏽‍🚀W"

  - name: ⌘V 粘贴（替换全选）
    do: keys
    keys: ["cmd+v"]
    channel: cgevent
    gapMs: 700
    expect:
      - label: composer 值逐字节等于 ZWJ 探针串
        node: { role: AXTextArea, name: "^Q👩🏽‍🚀W$", present: true }

  - name: ⌃B 把 caret 移到 W 之前（ZWJ 簇之后）
    do: key
    key: "ctrl+b"
    channel: cgevent
    gapMs: 150

  - name: ⌃H（composer 命令；修复前只退 CM 簇后缀 ⇒ Q👩W）
    do: key
    key: "ctrl+h"
    channel: cgevent
    gapMs: 300
    expect:
      - label: ZWJ 簇整簇删除（Q + W 相邻）
        node: { role: AXTextArea, name: "^QW$", present: true }

  - name: ⌘Z 一次 undo 复原整簇
    do: key
    key: "cmd+z"
    channel: cgevent
    gapMs: 300
    expect:
      - label: 一次 undo 恢复 ZWJ 探针串
        node: { role: AXTextArea, name: "^Q👩🏽‍🚀W$", present: true }
---

# 268 — 无修饰物理 Backspace 与 composer ⌃H 按字素簇整簇删除（M860）

## 这个场景验什么

M843 在 Node 与双引擎视觉层登记了两条 finding：composer 的 ⌃H 走 CM 的 `deleteCharBackward`
（CM 簇后缀，职业 ZWJ / 肤色 / 组合标记 / RTL 附标只退一个码点），正文与 composer 的物理
Backspace 完全交给浏览器原生（WKWebView 对阿拉伯文 / 希伯来文附标逐码点退）。M860 把两条入口
统一到 `src/quote-card.ts` 的 `clusterBackward`，本场景在真实 WKWebView 上取同一条合同的三条 witness。

## 三条 witness 的分工

1. **W1（正文物理 Backspace）**：fixture 文档用 ⌘A + ⌘V 改写成 `xمَy`（阿拉伯文附标），⌃B 把
   caret 移到 `y` 之前，按 Backspace。判据：①正文含 `xy`（整簇）；②`xم` 不在场（修复前只退
   附标的现场）；③一次 ⌘Z 回到 `xمَy`；④再撤一拍回到 fixture 原文 `HNL-ALPHA`（本轮无残留）。
2. **W2（composer 物理 Backspace）**：composer 粘贴 `Qمَ`（caret 在末尾），按 Backspace。
   判据：AX 节点值恰好为 `Q`（`^Q$` 锚定；修复前是 `Qم`）；一次 ⌘Z 回到 `Qمَ`。
3. **W3（composer ⌃H）**：composer 粘贴 `Q👩🏽‍🚀W`，⌃B 移到 `W` 之前，按 ⌃H。判据：AX 节点值
   恰好为 `QW`（修复前 CM 簇后缀得 `Q👩W`）；一次 ⌘Z 回到原串。

## 判据边界（如实声明）

- **物理 Backspace 的注入通道是 KimiCU `press_key`**（`do: key` 的裸键步）：cgevent 单数步只接受
  chord（`channelSpecProblem` 判红），144 的裸 Backspace 步是这条通道的既有先例。本场景判的是
  「真实 WKWebView 收到一次 Backspace 后的文档结果」，注入通道不改变被测路径。
- **正文与 composer 的读数来源不同**：正文走 `editor` 断言（AXTextArea.value 的整篇文档）；
  composer 与编辑器同为 `AXTextArea`，因此 composer 用 `node` 的值锚定（`^…$`）而不是跨节点
  子串正则（REVIEW.md「断言等价于子串」条）。W1 的 `editor: { not: "xم" }` 只在正文范围内成立
  （composer 此时不在场）。
- **不落盘**：三条 witness 都只读 AX / 文档内存态，不按 ⌘S；W1 末尾用两拍 ⌘Z 回到 fixture 原文，
  确保本轮不留下 dirty 文档。mock provider、不发消息、不读写用户 vault。
- **先红后绿**：修复前的真机红证据取既有记录（M843 的双引擎实测 finding + M860 视觉层退回 master 的
  mutant：3 条新用例全红）；本窗口按 tower 裁决未再重建修复前版本。修复后真机读数：r7/r8 连续两跑
  `1/1 PASS`（13 条断言、退出码 0，证据 `.local/acceptance/2026-11-20/268-grapheme-backspace/`）。
