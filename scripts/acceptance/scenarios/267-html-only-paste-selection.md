---
# M859：无可插入文本的粘贴是严格空操作。finding
# `20261119-worker-unicode-clipboard-bug-html-only-cm-dopaste`（M843）：正文 HTML-only
# （无 text/plain / uri-list）+ 非空选区时，CM 默认 paste 以空串 replaceSelection，静默删源码。
#
# 真机 witness 分工（双引擎矩阵在 tests/visual/scenes/text-clipboard-adversarial.spec.ts）：
# 套件只有 clipboardText / clipboardImage 两条置剪贴板通道，**造不出「只有 text/html」的
# 剪贴板**。因此真机层取同一退化类的另一形态——code 模式（图片粘贴不接管）+ 仅图片剪贴板 +
# 非空选区：修复前同样走 `doPaste("")` 删选区，判据与 HTML-only 完全同源（「无可插入文本 ⇒
# 严格空操作」）。HTML-only 本身的判据在 chromium + webkit-realua 双引擎视觉用例里。
#
# 非空选区的真机通道：套件的 CGEvent drag 在 CM 正文造不出文本选区（README「已知边界」），
# 所以用 ⌘A（`editor.select-all`，真键盘事件）建选区，并用「随后键入覆写全篇」当**派生的
# 选区观测**：选区若在粘贴后仍非空，键入就会替换全篇（旧文本两条都消失）。
# 右键通道（M415）：button:right 取节点 bbox 中心注入真实鼠标；文档必须够高，让中心落在
# 选区内的文字上（macOS 在选区内右键保留选区）。
id: "267-html-only-paste-selection"
item: 267
tier: full
title: 无可插入文本的粘贴是严格空操作——code 模式图片剪贴板不删选区、md 文本/图片粘贴不回归（M859）
steps:
  # ---------------------------------------------------------------------------
  # W1：code 模式 + 仅图片剪贴板 + 全选选区 ⇒ 粘贴是严格空操作（修复前整篇被删）
  # ---------------------------------------------------------------------------
  - name: 造 code 模式文件 notes/p.txt（40 行：撑满正文区，右键中心落在选区内）
    do: vaultWrite
    file: notes/p.txt
    content: "alpha 00\nalpha 01\nalpha 02\nalpha 03\nalpha 04\nalpha 05\nalpha 06\nalpha 07\nalpha 08\nalpha 09\nalpha 10\nalpha 11\nalpha 12\nalpha 13\nalpha 14\nalpha 15\nalpha 16\nalpha 17\nalpha 18\nalpha 19\nalpha 20\nalpha 21\nalpha 22\nalpha 23\nalpha 24\nalpha 25\nalpha 26\nalpha 27\nalpha 28\nalpha 29\nalpha 30\nalpha 31\nalpha 32\nalpha 33\nalpha 34\nalpha 35\nalpha 36\nalpha 37\nalpha 38\nalpha 39\n"
    expect:
      - label: 文件已落盘
        file: { path: notes/p.txt, has: "alpha 00" }

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
    marker: "alpha 00"
    expect:
      - label: 编辑器装载文件
        editor: { has: "alpha 00" }

  - name: 起跑：窗口前台 + 编辑器焦点（后续 cgevent 键位需要前台）
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

  - name: 键入 z（制造一个真实撤销步，供 W1 末尾判「粘贴没有留下撤销步」）
    do: keys
    keys: ["z"]
    gapMs: 150
    expect:
      - label: z 落在文档起点
        editor: { has: "zalpha 00" }

  - name: ⌘A 全选（真键盘事件通道，建立非空选区）
    do: key
    key: "cmd+a"
    channel: cgevent
    gapMs: 200

  - name: 剪贴板置合成 png（只有 image 数据，无 text/plain）
    do: clipboardImage
    synth: { width: 200, height: 120, seed: 11 }

  - name: 右键唤出 WebKit 原生上下文菜单（bbox 中心落在选区内）
    do: click
    target: { role: AXTextArea, button: right }
    expect:
      - label: 原生菜单出现且 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点原生菜单 Paste（真实粘贴事件到达 DOM）
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }
    settleMs: 400
    expect:
      # 判别性判据：修复前这里整篇被删（doc 只剩空串），`zalpha 00` 必然不在场。
      - label: 文档逐字未变（无可插入文本的粘贴是空操作）
        editor: { has: "zalpha 00" }
      - label: code 模式不接管图片（没有附件落盘）
        glob: { dir: notes, pattern: "pasted-[0-9a-f]{16}\\.webp$", exact: 0 }
      - label: 未自动写盘
        file: { path: notes/p.txt, unchangedSince: 文档基线, mtimeUnchangedSince: 文档基线 }

  - name: 键入 qq（派生的选区观测：选区仍在 ⇒ 全篇被替换；右键塌了选区则 alpha 仍在）
    do: keys
    keys: ["q", "q"]
    gapMs: 150
    expect:
      - label: 全篇被 qq 替换（粘贴之后选区仍非空）
        editor: { not: "alpha 00" }
      - label: 键入落地
        editor: { has: "qq" }

  - name: 一次撤销（撤 qq）
    do: key
    key: "cmd+z"
    gapMs: 250

  - name: 再一次撤销（撤 Z ⇒ 回到原文；粘贴没有留下可撤销步）
    do: key
    key: "cmd+z"
    gapMs: 250
    expect:
      - label: 原文恢复且 Z 不在场（两次撤销恰好越过键入与 Z，没有多出来的粘贴步）
        editor: { has: "alpha 00" }
      - label: Z 已撤回
        editor: { not: "zalpha" }
      - label: 全程零写盘（sha256 + mtime 双比）
        file: { path: notes/p.txt, unchangedSince: 文档基线, mtimeUnchangedSince: 文档基线 }

  - name: 清理 W1 文件
    do: vaultRm
    file: notes/p.txt

  # ---------------------------------------------------------------------------
  # W2：md + 纯文本 + 全选选区 ⇒ 文本粘贴照常替换选区（闸门不拦可插文本）
  # ---------------------------------------------------------------------------
  - name: 造 md 文件 notes/t.md
    do: vaultWrite
    file: notes/t.md
    content: "alpha 00\nalpha 01\nalpha 02\nalpha 03\nalpha 04\nalpha 05\nalpha 06\nalpha 07\nalpha 08\nalpha 09\nalpha 10\nalpha 11\nalpha 12\nalpha 13\nalpha 14\nalpha 15\nalpha 16\nalpha 17\nalpha 18\nalpha 19\nalpha 20\nalpha 21\nalpha 22\nalpha 23\nalpha 24\nalpha 25\nalpha 26\nalpha 27\nalpha 28\nalpha 29\nalpha 30\nalpha 31\nalpha 32\nalpha 33\nalpha 34\nalpha 35\nalpha 36\nalpha 37\nalpha 38\nalpha 39\n"
    expect:
      - label: 文件已落盘
        file: { path: notes/t.md, has: "alpha 00" }

  - name: 等树刷新
    do: waitFor
    waitFor:
      has: ["/AXButton \\(notes\\)/"]
    timeoutMs: 30000

  - name: 打开 t.md
    do: open
    file: notes/t.md
    marker: "alpha 00"
    expect:
      - label: 编辑器装载笔记
        editor: { has: "alpha 00" }

  - name: 编辑器焦点
    do: focusWindow
    retries: 4
    click: true
    expect:
      - label: 焦点在编辑器正文
        ax: { focused: "AXTextArea" }

  - name: 记录文档基线
    do: record
    file: notes/t.md
    as: 文档基线

  - name: ⌘A 全选
    do: key
    key: "cmd+a"
    channel: cgevent
    gapMs: 200

  - name: 剪贴板置纯文本
    do: clipboardText
    text: "OMEGA"

  - name: 右键 → 原生菜单 Paste
    do: click
    target: { role: AXTextArea, button: right }
    expect:
      - label: Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点 Paste
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }
    settleMs: 400
    expect:
      - label: 文本替换全选选区（闸门没有吞掉可插文本）
        editor: { has: "OMEGA" }
      - label: 旧文本不在场（替换而不是追加）
        editor: { not: "alpha" }

  - name: ⌘S 落盘
    do: key
    key: "cmd+s"
    gapMs: 400
    expect:
      - label: 盘上全文 = 粘贴后的精确结果
        file: { path: notes/t.md, exact: "OMEGA" }
      - label: dirty 已收窄
        ax: { not: "（未保存）" }

  - name: 清理 W2 文件
    do: vaultRm
    file: notes/t.md

  # ---------------------------------------------------------------------------
  # W3：md + 仅图片剪贴板 + 全选选区 ⇒ 图片粘贴照常优先、替换选区（优先级不回归）
  # ---------------------------------------------------------------------------
  - name: 造 md 文件 notes/i.md
    do: vaultWrite
    file: notes/i.md
    content: "alpha 00\nalpha 01\nalpha 02\nalpha 03\nalpha 04\nalpha 05\nalpha 06\nalpha 07\nalpha 08\nalpha 09\nalpha 10\nalpha 11\nalpha 12\nalpha 13\nalpha 14\nalpha 15\nalpha 16\nalpha 17\nalpha 18\nalpha 19\nalpha 20\nalpha 21\nalpha 22\nalpha 23\nalpha 24\nalpha 25\nalpha 26\nalpha 27\nalpha 28\nalpha 29\nalpha 30\nalpha 31\nalpha 32\nalpha 33\nalpha 34\nalpha 35\nalpha 36\nalpha 37\nalpha 38\nalpha 39\n"
    expect:
      - label: 文件已落盘
        file: { path: notes/i.md, has: "alpha 00" }

  - name: 等树刷新
    do: waitFor
    waitFor:
      has: ["/AXButton \\(notes\\)/"]
    timeoutMs: 30000

  - name: 打开 i.md
    do: open
    file: notes/i.md
    marker: "alpha 00"
    expect:
      - label: 编辑器装载笔记
        editor: { has: "alpha 00" }

  - name: 编辑器焦点
    do: focusWindow
    retries: 4
    click: true
    expect:
      - label: 焦点在编辑器正文
        ax: { focused: "AXTextArea" }

  - name: ⌘A 全选
    do: key
    key: "cmd+a"
    channel: cgevent
    gapMs: 200

  - name: 剪贴板置合成 png
    do: clipboardImage
    synth: { width: 240, height: 160, seed: 23 }

  - name: 右键 → 原生菜单 Paste
    do: click
    target: { role: AXTextArea, button: right }
    expect:
      - label: Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点 Paste（md 走图片分支，引用替换全选选区）
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }
    settleMs: 400

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
      - label: 旧文本不在场（引用替换了全选选区）
        editor: { not: "alpha 00" }

  - name: 清理 W3 笔记（附件由下一场景的 resetVault 清除非 md 产物）
    do: vaultRm
    file: notes/i.md
---

# 267 — 无可插入文本的粘贴是严格空操作（M859）

## 这个场景验什么

M843 发现：正文 HTML-only 剪贴板（无 `text/plain` / `text/uri-list`）+ 非空选区时，CM 的
默认 paste 以空串 `replaceSelection`，**静默删除选区**。修复在 `src/editor.ts` 的 paste
处理器里加一条与 CM 默认语义同源的降级闸门：无 image 项、无可插文本 ⇒ `preventDefault`
并保持严格空操作（文档 / 选区 / 撤销栈 / dirty 全不变）。

真机层取同一退化类的另一形态：**code 模式 + 仅图片剪贴板 + 非空选区**。code 模式不接管
图片粘贴（`imagePasteItemIndex` 只认 md），修复前同样落到 `doPaste("")` 删选区。

## 三条 witness 的分工

1. **W1（退化类 ⇒ 空操作）**：code 模式 40 行文本，键入 `Z` 造一个真实撤销步 → ⌘A 全选 →
   右键原生菜单 Paste 一张合成 png。判据四条：①文档逐字未变（`zalpha 00` 仍在场——修复前
   整篇被删）；②没有附件落盘（code 模式不接管图片）；③未自动写盘（sha256 + mtime 双比）；
   ④随后键入 `qq` 全篇替换（派生观测：粘贴之后选区仍非空），再一次 + 再一次 ⌘Z 回到原文
   （粘贴没有留下可撤销步）。
2. **W2（可插文本不拦）**：md 全选 + 纯文本剪贴板 ⇒ 文本照常替换全篇，⌘S 盘上全文 `OMEGA`。
   闸门若误吞可插文本，`alpha` 仍在场、这条必然判红。
3. **W3（图片优先不回归）**：md 全选 + 仅图片剪贴板 ⇒ 图片分支优先，引用替换全篇、
   `AXImage` 节点挂载、恰好一个附件。闸门若先于图片分支拦截，图片不会落盘。

## 判据边界（如实声明）

- **HTML-only 本身造不出来**：套件只有 `clipboardText` / `clipboardImage` 两条置剪贴板
  通道（`osascript` 固定命令），没有置 `text/html` 的口子；加口子会扩套件的固定命令纪律，
  不在本 change 的 scope 内。HTML-only 的判据在
  `tests/visual/scenes/text-clipboard-adversarial.spec.ts`（chromium + webkit-realua 双引擎，
  直接读 CM `state.selection`）。本场景判的是**同一条产品合同**的另一形态。
- **选区不可直接断言**（README「光标/选区不可断言」）：非空选区由 ⌘A 建立，用「随后键入
  替换全篇」当派生观测；若右键塌掉了选区，`alpha 00` 仍在场 ⇒ 场景判红，不会假绿。
- **右键保留选区依赖 macOS 语义**：`button: right` 取 AXTextArea bbox 中心注入；40 行文本
  撑满正文区，中心落在选区内的文字上。改 fixture 行数 / 字号 / 栏宽 / 窗口尺寸后必须复核
  中心仍落在文字上（与场景 228 / 233 / 266 的坐标标定同一纪律）。
- **先红后绿**：真机窗口内先在修复前构建上跑一遍（W1 的 doc 未变断言应判红），再在修复后
  构建上复跑；未跑不得记 PASS（场景 261 的口径）。
