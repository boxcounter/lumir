---
id: "261-native-widget-deletion"
item: 261
tier: full
title: 原生跨行删除不写显示文本——列表 / wikilink / 行内公式的精确合并、一次撤销与精确落盘（M836）
fixtures: [list-indent-ordered.md, links-wiki.md]
open: list-indent-ordered.md
marker: "uno"
steps:
  # witness A：有序列表行被吸收（Delete 在上一行行尾）。marker 是 replace widget，
  # 修复前 Chromium 会把 `–` 写进源码并拆行，WebKit 写成 `1.uno2.dos` 这类拼接。
  - name: 起点：有序列表已打开，marker 以 widget 接管
    do: focusWindow
    retries: 4
    click: true
    expect:
      - label: 正向锚点——本轮 AX 读取是活的
        editor: { has: "uno" }
      - label: 第二项也在场
        editor: { has: "dos" }
      - label: marker 已接管（AX 里没有字面 `1. uno`）
        editor: { not: "1. uno" }
      - label: 焦点在编辑器正文
        ax: { focused: "AXTextArea" }

  - name: 记录文档基线（合并与撤销都不得落盘之外的写）
    do: record
    file: list-indent-ordered.md
    as: 列表基线

  - name: ⌃A 到首行行首（真键盘事件通道）
    do: key
    key: "ctrl+a"
    channel: cgevent
    gapMs: 150

  - name: ⌃E 到首行行尾
    do: key
    key: "ctrl+e"
    channel: cgevent
    gapMs: 150

  # 合并行以 `1. ` 开头**仍是合法有序列表项**，marker widget 会再次接管；AX 对它的
  # 序列化是「marker 段 + 内容段」两行（实测 `1.\nuno2. dos`，YAML 双引号里的 \n 是真换行），
  # 不是一行字面 `1. uno2. dos`（那是修复前 Chromium 的坏形态）。逐字节判据归 ⌘S 后的
  # `file.exact`，这里只判「合并落点 + widget 序列化」。
  - name: forward Delete 合并「uno 行 / dos 行」
    do: key
    key: "forwarddelete"
    gapMs: 250
    expect:
      - label: 源码逐字节合并（列表 marker 的源 `1. ` / `2. ` 保留、不拆行）
        editor: { not: "–" }
      - label: 合并行仍是列表项：marker 与内容按 widget 序列化成两段（`1.` + 换行 + `uno2. dos`）
        editor: { has: "1.\nuno2. dos" }

  - name: ⌘S 落盘（唯一写盘键）
    do: key
    key: "cmd+s"
    gapMs: 400
    expect:
      - label: 盘上全文 = 精确合并（file.exact 是这条链唯一有区分度的全文判据）
        file: { path: list-indent-ordered.md, exact: "1. uno2. dos\n", changedSince: 列表基线 }
      - label: dirty 已收窄
        ax: { not: "（未保存）" }

  - name: 记录保存后的基线（撤销不得再写盘）
    do: record
    file: list-indent-ordered.md
    as: 列表保存基线

  - name: 一次撤销回合并前
    do: key
    key: "cmd+z"
    gapMs: 300
    expect:
      - label: 合并行消失、列表恢复
        editor: { not: "1. uno2. dos" }
      - label: 零额外写盘（sha256 + mtime 双比，基线取保存后的那一份）
        file: { path: list-indent-ordered.md, unchangedSince: 列表保存基线, mtimeUnchangedSince: 列表保存基线 }

  # witness A2：同一对行用 ⌘⌫（行首 backward line delete）合并，结果必须与 A 的盘上
  # 字节相同——dirty 在合并后应直接收窄（当前文档 == 盘上已保存内容）。
  - name: ↓ 到第二行行首
    do: key
    key: "down"
    gapMs: 120
  - name: ⌃A 到第二行行首
    do: key
    key: "ctrl+a"
    channel: cgevent
    gapMs: 150
  - name: ⌘⌫ 合并两行
    do: key
    key: "cmd+backspace"
    gapMs: 250
    expect:
      - label: 不得出现 marker 字形
        editor: { not: "–" }
      - label: 合并结果与 A 的已保存字节一致（dirty 直接收窄）
        ax: { not: "（未保存）" }
      - label: 盘上未因撤销 / 再合并发生写入
        file: { path: list-indent-ordered.md, unchangedSince: 列表保存基线, mtimeUnchangedSince: 列表保存基线 }

  # witness B：wikilink 行被吸收。fixture 首行 `[[plain]]` 以 widget 渲染（AX 只剩 label）；
  # 修复前 Delete 会把 `[[ ]]` 静默丢掉（Chromium `alphaplain`，正确源码是 `alpha[[plain]]`）。
  - name: 打开 links-wiki.md
    do: open
    file: links-wiki.md
    marker: "第二段内容"
    expect:
      - label: wikilink 以 widget 渲染（AX 里没有字面 `[[plain]]`）
        editor: { not: "[[plain]]" }
      - label: label 仍可读
        editor: { has: "plain" }

  - name: 焦点回到编辑器正文
    do: focusWindow
    retries: 4
    click: true

  - name: ⌃A 到首行行首
    do: key
    key: "ctrl+a"
    channel: cgevent
    gapMs: 150

  - name: Enter 在 wikilink 行之前开一行
    do: key
    key: "return"
    gapMs: 200

  - name: ↑ 回到新开的空行
    do: key
    key: "up"
    gapMs: 120

  - name: 键入 alpha（可打印 keys，字面回读）
    do: keys
    keys: ["a", "l", "p", "h", "a"]
    gapMs: 120
    expect:
      - label: 前缀行已落地
        editor: { has: "alpha" }

  - name: 记录 wikilink 基线
    do: record
    file: links-wiki.md
    as: wikilink 基线

  - name: ⌃E 到 alpha 行尾
    do: key
    key: "ctrl+e"
    channel: cgevent
    gapMs: 150

  - name: forward Delete 吸收 wikilink 行
    do: key
    key: "forwarddelete"
    gapMs: 250

  - name: ⌘S 落盘
    do: key
    key: "cmd+s"
    gapMs: 400
    expect:
      - label: 盘上全文保留 wikilink 源码（`[[plain]]` 不得被 label 取代）
        file: { path: links-wiki.md, exact: "alpha[[plain]]\n\n第二段内容。\n", changedSince: wikilink 基线 }

  - name: 记录保存后的基线
    do: record
    file: links-wiki.md
    as: wikilink 保存基线

  - name: 一次撤销
    do: key
    key: "cmd+z"
    gapMs: 300
    expect:
      - label: 文档回到「alpha 行 + wikilink 行」
        editor: { has: "alpha" }
      - label: 盘上保持已保存内容
        file: { path: links-wiki.md, unchangedSince: wikilink 保存基线 }

  # witness C：行内公式行被吸收。先重写为两行 `alpha` / `$x$`（$ 是盲键触发 widget），
  # 修复前 Chromium 会把 KaTeX 的 mathml+html 文本写进源码（`alpha\nx\nx\n`）。
  #
  # 全选覆写不能用「alpha 计数 N→N+1」判落地：目标串在旧文档里本就存在，替换后计数不变，
  # 计数 oracle 会必然判红（M838 现场）。配方：⌘A（真键盘事件）后先键入旧文档里不存在的
  # 哨兵串 `alphaq`——0→1 是有效计数 oracle，且「旧内容不在场」两条断言证明这是整段覆写
  # 而非追加；随后盲键 Backspace 删掉哨兵尾字符，用「哨兵消失 + alpha 仍在」两条正向观测
  # 确认盲键落地（不让盲发环节没有判据）。
  - name: ⌘A 全选（真键盘事件通道）
    do: key
    key: "cmd+a"
    channel: cgevent
    gapMs: 150
  - name: 键入哨兵串 alphaq 覆写选区（可打印 keys，字面回读 0→1）
    do: keys
    keys: ["a", "l", "p", "h", "a", "q"]
    gapMs: 120
    expect:
      - label: 哨兵串整段落地（`alphaq` 在旧文档出现 0 次，覆写后恰 1 次）
        editor: { has: "alphaq" }
      - label: 旧文档被选区替换（wikilink label 不在场 ⇒ 不是追加）
        editor: { not: "plain" }
      - label: 旧文档第二段也不在场
        editor: { not: "第二段内容" }
  - name: 盲键 Backspace 删掉哨兵尾字符
    do: key
    key: "backspace"
    gapMs: 150
    expect:
      - label: 哨兵串整体消失（盲键落地的独立正观测）
        editor: { not: "alphaq" }
      - label: 文档只剩 alpha 前缀行
        editor: { has: "alpha" }
  - name: Enter 开第二行
    do: key
    key: "return"
    gapMs: 200
  - name: 键入 x
    do: keys
    keys: ["x"]
    gapMs: 120
  - name: ⌃A 到第二行行首
    do: key
    key: "ctrl+a"
    channel: cgevent
    gapMs: 150
  - name: 键入 $（可打印 keys，字面回读）开公式
    do: keys
    keys: ["$"]
    gapMs: 150
  - name: ⌃E 到行尾
    do: key
    key: "ctrl+e"
    channel: cgevent
    gapMs: 150
  - name: 盲键 $ 闭合公式（widget 接管）
    do: key
    key: "$"
    gapMs: 250
    expect:
      - label: 公式以 widget 渲染（AX 里没有字面 `$x$`）
        editor: { not: "$x$" }
      - label: 前缀行仍在
        editor: { has: "alpha" }

  - name: ↑ 回 alpha 行
    do: key
    key: "up"
    gapMs: 150
  - name: ⌃E 到 alpha 行尾
    do: key
    key: "ctrl+e"
    channel: cgevent
    gapMs: 150

  - name: 记录公式基线
    do: record
    file: links-wiki.md
    as: 公式基线

  - name: forward Delete 吸收公式行
    do: key
    key: "forwarddelete"
    gapMs: 250

  - name: ⌘S 落盘
    do: key
    key: "cmd+s"
    gapMs: 400
    expect:
      - label: 盘上全文保留公式源码（不得写入渲染文本）
        file: { path: links-wiki.md, exact: "alpha$x$", changedSince: 公式基线 }
      - label: dirty 已收窄
        ax: { not: "（未保存）" }
---

# 261 — 原生跨行删除不写显示文本（M836）

真机 witness 只放三条**代表格**（与 `tests/visual/scenes/editing-oracle.spec.ts` 的有向矩阵
同合同，矩阵负责 Chromium + WebKit 全类型覆盖，本场景负责真实 WKWebView 的入口与落盘）：

1. **有序列表行被吸收**（`list-indent-ordered.md`）：Delete 合并两行 ⇒ 源码 `1. uno2. dos`，
   不得出现 marker 字形 `–`；`⌘S` 用 `file.exact` 判全文；一次 `⌘Z` 复原且不写盘。
   随后用 `⌘⌫` 在同一对行上再合并一次——结果必须与已保存字节相同（dirty 直接收窄）。
2. **wikilink 行被吸收**（`links-wiki.md`）：在 `[[plain]]` 行之前键入 `alpha`，Delete 合并 ⇒
   盘上必须是 `alpha[[plain]]`；修复前该源码会被 widget 的 label `plain` 静默取代。
3. **行内公式行被吸收**：重写为 `alpha` / `$x$` 两行（`$` 走盲键，widget 闭合后 AX 不再
   含字面 `$x$`），Delete 合并 ⇒ 盘上必须是 `alpha$x$`；修复前 KaTeX 的渲染文本会进源码。

## 判据边界（如实声明）

- **AX 不是 raw doc oracle**：编辑器 AX 文本是渲染后的文本（marker 显示为 `1.`、wikilink
  显示 label、公式显示渲染结果），因此逐字节判据一律落在 `⌘S` 后的**文件**上
  （`file.exact`）；`editor.has/not` 只做「widget 已接管」的正反向锚点。marker widget 的 AX
  序列化是「marker 段 + 内容段」**两段**（合并后的列表项读作 `1.\nuno2. dos`），断言按这个
  形态写，不要写回字面 `1. uno2. dos`。
- **真机执行记录**：2026-11-19 在 master `ee74260`（dev flavour）重跑本场景：33 断言全
  PASS、退出码 0；三处 `file.exact`（`1. uno2. dos\n` / `alpha[[plain]]\n\n第二段内容。\n` /
  `alpha$x$`）逐字节命中（证据 `.local/acceptance/2026-11-19-widget-oracle-fix/`，git 外）。
  M836 期间真机窗口已结束、本场景未跑；本轮修掉当时暴露的两条场景 oracle（列表 AX 序列化、
  全选覆写的计数 oracle）后重跑，未跑不得记 PASS 的口径不变。
- **native IME 不在此场景**：组合期删除归浏览器 / CM 的合成处理，不在本合同的接管面内。
