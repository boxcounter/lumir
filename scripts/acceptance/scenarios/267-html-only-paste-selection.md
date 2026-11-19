---
# M859：无可插入文本的粘贴是严格空操作。finding
# `20261119-worker-unicode-clipboard-bug-html-only-cm-dopaste`（M843，r1 又登记
# `20261120-…-text-markdown-only-html-only`）：正文在「只有 text/html / text/markdown、
# 无 text/plain 与 uri-list」的剪贴板上粘贴且存在非空选区时，CM 默认 paste 以空串
# replaceSelection，静默删源码。合同：这一类粘贴是**严格空操作**（doc / 选区 / 撤销栈 /
# dirty 全不变）。
#
# 真机 witness 分工（双引擎矩阵在 tests/visual/scenes/text-clipboard-adversarial.spec.ts）：
# 套件只有 clipboardText / clipboardImage 两条置剪贴板通道，**造不出「只有 text/html」或
# 「只有 text/markdown」的剪贴板**；真机层因此取同一退化类的另一形态——code 模式（图片粘贴
# 不接管）+ 仅图片剪贴板 + 非空选区：修复前同样走 `doPaste("")` 删选区，判据与 HTML-only
# 完全同源。HTML-only / text-markdown-only 本身的判据在双引擎视觉用例（chromium + webkit-realua）。
#
# 粘贴通道（M859 真机实测，`.local/missions/M859/probe-cmdv.log`）：`do: key` 的 **cgevent
# 真键盘通道**发的 ⌘V **落地**（code 模式实测：修前选区被删、修后空操作）。README 里
# 「⌘V 注入不落地」是 M345/M456 的 KimiCU `press_key` 通道结论，不适用于 M767 的 cgevent。
# 原生上下文菜单 Paste 通道在本机**不可靠**（AXPress 到 AXMenuItem 静默 no-op、菜单不收起），
# 本场景不用它。
#
# 非空选区的真机通道：键盘（⌃A 到行首 + → / ⇧→）。套件的 CGEvent drag 在 CM 正文造不出
# 文本选区（README「已知边界」），故用「粘贴后按 Backspace」当**派生的选区观测**，三种读数：
# ①选区保留 ⇒ 删掉 [3,6) 得 `alpbeta`（绿）；②仅选区塌陷、原文 `alpha beta` 仍在 ⇒ 在偏移 3
# 删前一个字符 `p` 得 `alha beta`（假绿防线）；③修复前粘贴已把 [3,6) 删成 `alpbeta`，再按
# Backspace 得 `albeta`（红跑现场）。三种读数与步骤「Backspace」及文末判据边界表逐字一致。
id: "267-html-only-paste-selection"
item: 267
tier: full
title: 无可插入文本的粘贴是严格空操作——code 模式图片剪贴板不删选区、md 文本/图片粘贴不回归（M859）
steps:
  # ---------------------------------------------------------------------------
  # W1：code 模式 + 仅图片剪贴板 + 非空选区 ⇒ 粘贴是严格空操作（修复前 [3,6) 被删）
  # ---------------------------------------------------------------------------
  - name: 造 code 模式文件 notes/p.txt
    do: vaultWrite
    file: notes/p.txt
    content: "alpha beta\n"
    expect:
      - label: 文件已落盘
        file: { path: notes/p.txt, has: "alpha beta" }

  - name: 等 watch 增量把 notes 目录刷进树（行进场再点，不等则点击会扑空）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(notes\\)/"]
    timeoutMs: 30000

  - name: 展开 notes 目录
    do: click
    target: { any: "/^notes$/" }
    expect:
      - label: notes 目录行在场（watch 增量已刷新）
        ax: { has: "/AXButton \\(notes\\)/" }

  - name: 打开 p.txt（非 md 文本 ⇒ code 模式、可编辑）
    do: open
    file: notes/p.txt
    marker: "alpha beta"
    expect:
      - label: 编辑器装载文件
        editor: { has: "alpha beta" }

  - name: 起跑：窗口前台 + 编辑器焦点（cgevent 键位需要前台）
    do: focusWindow
    retries: 4
    click: true
    expect:
      - label: 焦点在编辑器正文
        ax: { focused: "AXTextArea" }

  - name: 记录文档基线（自动写盘一律算红）
    do: record
    file: notes/p.txt
    as: 文档基线

  - name: ⌃A 到行首（真键盘事件；focusWindow 的落点不保证在偏移 0）
    do: key
    key: "ctrl+a"
    channel: cgevent
    gapMs: 150

  - name: → ×3 到偏移 3
    do: keys
    keys: ["right", "right", "right"]
    gapMs: 120

  - name: ⇧→ ×3 选中 [3,6)（真键盘事件扩展选区）
    do: keys
    keys: ["shift+right", "shift+right", "shift+right"]
    channel: cgevent
    gapMs: 200

  - name: 剪贴板置合成 png（只有 image 数据，无 text/plain）
    do: clipboardImage
    synth: { width: 200, height: 120, seed: 11 }

  - name: ⌘V 投递 paste（cgevent 真键盘事件；真实 WKWebView 的 paste 事件）
    do: key
    key: "cmd+v"
    channel: cgevent
    gapMs: 500
    expect:
      # 判别性判据：修复前这里 [3,6) 被删、文档变 `alpbeta`，`alpha beta` 必然不在场。
      - label: 文档逐字未变（无可插入文本的粘贴是空操作）
        editor: { has: "alpha beta" }
      - label: code 模式不接管图片（没有附件落盘）
        glob: { dir: notes, pattern: "pasted-[0-9a-f]{16}\\.webp$", exact: 0 }
      - label: 未自动写盘（sha256 + mtime 双比）
        file: { path: notes/p.txt, unchangedSince: 文档基线, mtimeUnchangedSince: 文档基线 }

  - name: Backspace（派生的选区观测：选区保留 ⇒ 删 [3,6) 得 alpbeta；仅塌陷、原文仍在 ⇒ 删前一个字符 p 得 alha beta；修复前已删成 alpbeta 再按 ⇒ albeta）
    do: key
    key: "backspace"
    gapMs: 250
    expect:
      - label: 选区在粘贴之后仍非空（Backspace 删掉 [3,6) ⇒ 文档变 alpbeta）
        editor: { has: "alpbeta" }

  - name: 清理 W1 文件
    do: vaultRm
    file: notes/p.txt

  # ---------------------------------------------------------------------------
  # W2：md + 纯文本 + 非空选区 ⇒ 文本粘贴照常替换选区（闸门不拦可插文本）
  # ---------------------------------------------------------------------------
  - name: 造 md 文件 notes/t.md
    do: vaultWrite
    file: notes/t.md
    content: "alpha beta\n"
    expect:
      - label: 文件已落盘
        file: { path: notes/t.md, has: "alpha beta" }

  - name: 等树刷新
    do: waitFor
    waitFor:
      has: ["/AXButton \\(notes\\)/"]
    timeoutMs: 30000

  - name: 打开 t.md
    do: open
    file: notes/t.md
    marker: "alpha beta"
    expect:
      - label: 编辑器装载笔记
        editor: { has: "alpha beta" }

  - name: 编辑器焦点
    do: focusWindow
    retries: 4
    click: true
    expect:
      - label: 焦点在编辑器正文
        ax: { focused: "AXTextArea" }

  - name: ⌃A 到行首
    do: key
    key: "ctrl+a"
    channel: cgevent
    gapMs: 150

  - name: → ×3 到偏移 3
    do: keys
    keys: ["right", "right", "right"]
    gapMs: 120

  - name: ⇧→ ×3 选中 [3,6)
    do: keys
    keys: ["shift+right", "shift+right", "shift+right"]
    channel: cgevent
    gapMs: 200

  - name: 剪贴板置纯文本
    do: clipboardText
    text: "OMEGA"

  - name: ⌘V 粘贴纯文本
    do: key
    key: "cmd+v"
    channel: cgevent
    gapMs: 500
    expect:
      - label: 文本替换选区（闸门没有吞掉可插文本）
        editor: { has: "alpOMEGA" }
      - label: 旧选区内容不在场（替换而不是追加）
        editor: { not: "alpha" }

  - name: ⌘S 落盘
    do: key
    key: "cmd+s"
    gapMs: 400
    expect:
      - label: 盘上全文 = 粘贴后的精确结果
        file: { path: notes/t.md, exact: "alpOMEGAbeta\n" }

  - name: 关闭 t.md 标签（W3 的 dirty 断言只看自己的文档）
    do: key
    key: "cmd+w"
    gapMs: 300

  - name: 清理 W2 文件
    do: vaultRm
    file: notes/t.md

  # ---------------------------------------------------------------------------
  # W3：md + 仅图片剪贴板 + 非空选区 ⇒ 图片粘贴照常优先、替换选区（优先级不回归）
  # ---------------------------------------------------------------------------
  - name: 造 md 文件 notes/i.md
    do: vaultWrite
    file: notes/i.md
    content: "alpha beta\n"
    expect:
      - label: 文件已落盘
        file: { path: notes/i.md, has: "alpha beta" }

  - name: 等树刷新
    do: waitFor
    waitFor:
      has: ["/AXButton \\(notes\\)/"]
    timeoutMs: 30000

  - name: 打开 i.md
    do: open
    file: notes/i.md
    marker: "alpha beta"
    expect:
      - label: 编辑器装载笔记
        editor: { has: "alpha beta" }

  - name: 编辑器焦点
    do: focusWindow
    retries: 4
    click: true
    expect:
      - label: 焦点在编辑器正文
        ax: { focused: "AXTextArea" }

  - name: ⌃A 到行首
    do: key
    key: "ctrl+a"
    channel: cgevent
    gapMs: 150

  - name: → ×3 到偏移 3
    do: keys
    keys: ["right", "right", "right"]
    gapMs: 120

  - name: ⇧→ ×3 选中 [3,6)
    do: keys
    keys: ["shift+right", "shift+right", "shift+right"]
    channel: cgevent
    gapMs: 200

  - name: 剪贴板置合成 png
    do: clipboardImage
    synth: { width: 240, height: 160, seed: 23 }

  - name: ⌘V 投递 paste（md 走图片分支，引用替换选区）
    do: key
    key: "cmd+v"
    channel: cgevent
    gapMs: 500

  - name: 等图片 widget 挂载
    do: waitFor
    waitFor:
      has: ["/AXImage[^\n]*pasted-[0-9a-f]{16}\\.webp/"]
    timeoutMs: 40000
    expect:
      - label: 笔记同目录恰好一个附件
        glob: { dir: notes, pattern: "pasted-[0-9a-f]{16}\\.webp$", exact: 1 }
      - label: 图片粘贴优先（引用渲染成图片节点，不是纯文本）
        ax: { has: "/AXImage[^\n]*pasted-[0-9a-f]{16}\\.webp/" }
      - label: 旧选区内容不在场（引用替换了选区）
        editor: { not: "pha" }

  - name: 清理 W3 笔记（附件由下一场景的 resetVault 清除非 md 产物）
    do: vaultRm
    file: notes/i.md
---

# 267 — 无可插入文本的粘贴是严格空操作（M859）

## 这个场景验什么

M843 发现：正文在 HTML-only 剪贴板（无 `text/plain` / `text/uri-list`）上粘贴且存在非空选区
时，CM 的默认 paste 以空串 `replaceSelection`，**静默删除选区**（r1 又确认 `text/markdown`-only
同一缺口）。修复在 `src/editor.ts` 的 paste 处理器里加一条与 CM 默认语义同源的降级闸门：无
image 项、无可插文本 ⇒ `preventDefault` 并保持严格空操作（文档 / 选区 / 撤销栈 / dirty 全不变）。

真机层另外取同一退化类的另一种形态：**code 模式 + 仅图片剪贴板 + 非空选区**。code 模式不接管
图片粘贴（`imagePasteItemIndex` 只认 md），修复前同样落到 `doPaste("")` 删选区。

## 三条 witness 的分工

1. **W1（退化类 ⇒ 空操作）**：code 模式 `alpha beta\n`，⌃A + → ×3 + ⇧→ ×3 选中 `[3,6)`，
   剪贴板置合成 png，**⌘V（cgevent 真键盘事件）** 投递 paste。判据：①文档逐字未变
   （修复前 `[3,6)` 被删，文档变 `alpbeta`）；②没有附件落盘（code 模式不接管图片）；③未自动
   写盘（sha256 + mtime 双比）；④随后按 Backspace——派生观测的三种读数：①选区保留 ⇒ 删掉
   `[3,6)` 得 `alpbeta`（绿）；②仅选区塌陷、原文 `alpha beta` 仍在 ⇒ 在偏移 3 删前一个字符
   `p` 得 `alha beta`（假绿防线）；③修复前粘贴已把 `[3,6)` 删成 `alpbeta`、再按 Backspace 得
   `albeta`（红跑现场）。
2. **W2（可插文本不拦）**：md + 纯文本剪贴板 + 同一选区 ⇒ 文本照常替换成 `alpOMEGAbeta`，
   ⌘S 盘上全文逐字等于 `alpOMEGAbeta\n`。闸门若误吞可插文本，`alpOMEGA` 不在场、这条必然判红。
3. **W3（图片优先不回归）**：md + 仅图片剪贴板 + 同一选区 ⇒ 图片分支优先，引用替换选区、
   `AXImage` 节点挂载、恰好一个附件。闸门若抢在图片分支之前拦截，图片不会落盘。

## 判据边界（如实声明）

- **HTML-only / text/markdown-only 本身造不出来**：套件只有 `clipboardText` / `clipboardImage`
  两条置剪贴板通道（`osascript` 固定命令），没有置 `text/html` / `text/markdown` 的口子；加口子
  会扩套件的固定命令纪律，不在本 change 的 scope 内。这两类 MIME 的判据在
  `tests/visual/scenes/text-clipboard-adversarial.spec.ts`（chromium + webkit-realua 双引擎，
  直接读 CM `state.selection`）。本场景判的是**同一条产品合同**的另一形态。
- **粘贴通道**：用 `do: key` 的 cgevent 真键盘通道发 ⌘V——M859 真机实测落地（
  `.local/missions/M859/probe-cmdv.log`）。README 的「⌘V 注入不落地」是旧 KimiCU `press_key`
  通道的结论。原生上下文菜单 Paste 通道在本机不可靠（AXPress 到 `AXMenuItem` 静默 no-op、菜单
  不收起，见 `.local/missions/M859/probe-menu-channel.log`），本场景不用它。
- **选区不可直接断言**（README「光标/选区不可断言」）：非空选区由键盘建立，用「随后按 Backspace
  删掉选区」当派生观测（选区长度 ≠ 1 才能与「塌成 caret 后删前一个字符」区分开；`[3,6)` 是三个
  字符，满足）。三种读数与步骤「Backspace」同口径：①选区保留 ⇒ 删 `[3,6)` 得 `alpbeta`（绿）；
  ②仅选区塌陷、原文 `alpha beta` 仍在 ⇒ 在偏移 3 删前一个字符 `p` 得 `alha beta`（假绿防线）；
  ③修复前粘贴已把 `[3,6)` 删成 `alpbeta`、再按 Backspace 得 `albeta`（红跑现场）。
- **先红后绿**：真机窗口内先在修复前构建上跑一遍（W1 的 doc 未变断言应判红），再在修复后构建上
  复跑；未跑不得记 PASS（场景 261 的口径）。
