---
id: "160-quote-button-viewport-clamp"
item: 531
title: 摘录浮动钮落点钳制：选区越出挂载容器（长行 / 跨多行）时钮仍在视口内
open: code-block-fullscreen.md
marker: "TOP-MARK"
steps:
  - name: 把光标放进编辑器正文（键盘注入的前置）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: 抢前台（后台注入的 chord 被抢前台时会丢键——REVIEW.md 第 11 条）
    do: focusWindow
    retries: 4

  - name: 光标下移到第 12 行（围栏代码块里那行 316 字符的长行；code_block_wrap 出厂 false ⇒ 不折行）
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]

  - name: ⌃⇧N 选中该行——选区并集盒的右缘随长行伸到挂载容器之外（现场形态：钮的候选落点越出容器）
    do: keys
    keys: ["ctrl+shift+n"]
    selection: "/AXButton \\(摘录到对话\\)/"
    expect:
      - label: 浮动「摘录到对话」钮在场（D370；同时是选区建立的正观测）
        ax: { has: "/AXButton \\(摘录到对话\\)/" }
      - label: 钮整体落在视口内且尺寸未被子缩（几何包围盒 + 包围盒内确有已绘制字形）
        geom:
          target: { role: AXButton, name: "摘录到对话" }
          minWidth: 40
          minHeight: 16
          painted: { min: 60 }
      - shot: 01-钮在视口内
---

# 160-quote-button-viewport-clamp —— 浮动钮落点钳制（M531，change fix-quote-button-viewport-clamp）

## 本场景在验什么

编辑器选区越出挂载容器时，浮动「摘录到对话」钮 MUST 被收进容器的可视区（而不是落在视口之外、
要用户把编辑器列横滑过去才看得见）。构造：围栏代码块里那行 316 字符的长行（`code_block_wrap`
出厂 `false` ⇒ 代码块行不折行），选中该行 ⇒ 选区包围盒的右缘伸到挂载容器 `.editor-pane` 之外
≈ 1300px（容器仅 964px 宽）。

判据是 `geom`（M397 的几何可见性断言）：包围盒**完整落在视口内**、非退化（宽 ≥ 40 / 高 ≥ 16），
且包围盒区域内扫得到已绘制字形。修前（`placeButton` 零钳制）钮的落点 = 选区右缘 + 4px ⇒ 落在
x ≈ 1779（窗口仅 1200 宽），`geom` 的「越出视口」当场判红；修后钮被钳在容器内，同一断言转绿。

## 判据为什么这样写

- **为什么用 `geom` 而不是 `ax.has`**：AX 里有节点只说明「这个元素存在」，不说明它在视口内——
  被祖先 `overflow` 裁掉、或被推到滚动窗口之外的内容，WKWebView 的 AX 照样暴露节点与**未裁**的
  包围盒（M397 的现场）。`geom` 的两段（几何 + 绘制）才判得了「用户真的看得见」。
- **`minWidth: 40` 是第二条判据**：未钳制时钮还会被「left 到容器右缘」的可用宽压成逐字换行的
  窄条（实测 31px 宽 × 107.5px 高，另一现场形态）；尺寸下限把「钮在视口内但形态已坏」也判红。
- **为什么不用「点得到」当判据**：`click` 走 AXPress（「按下这个元素」），**恒能命中**，与元素在
  不在视口内无关——它证不了这条缺陷（本场景因此不设点击步：点得到不等于看得见）。
- **为什么代码块长行能造出越界**：围栏代码块的行由 `editor.code_block_wrap` 裁决（出厂 `false`
  ⇒ `.cm-lp-codeblock-nowrap` 的 `white-space: pre`），长行不折、右缘远远伸出正文列；它是**出厂
  口径下**就能造出「选区越出容器」的形态（折行正文的并集盒右缘距容器右缘还差 68px）。
- **⌃N ×11 的来历**：长行在 fixture 的第 12 行（`TOP-MARK` 段 1 行 + 空行 1 行 + 缩进代码块
  6 行 + 空行 1 行 + 围栏行 1 行 + 短行 1 行）。⌃⇧N 在无选区时**选中当前行**（M132 的
  shift-extend 口径，场景 81 / 66 同用法），一次就够。

## 已知边界（如实登记）

- **「编辑器列可横滑」这一半在真机层判不了**：套件没有读数出口（AX 不暴露 `scrollWidth`、
  `pixel` 只给底色/对比度），因此真机层只判「钮在视口内」这个**用户看得见的后果**；
  「`.pane-editor` 不得被这颗钮撑出横向滚动」由 chromium 视觉场景
  `tests/visual/scenes/m345-quote-card.spec.ts` 的「钳制」用例判（读 `.pane-editor.scrollWidth`）。
- **钮的纵向钳制不在本场景**：编辑器那颗够不到判别性落点（文档尾留白 + 文档结束标记恒留
  ≈58px 余量 > 钮高 + 4px）；有区分度的纵向现场是 transcript 那颗钮，由 chromium 视觉场景
  `tests/visual/scenes/m423-message-excerpt.spec.ts` 的「钳制」用例判。
- **坐标与文档耦合**：⌃N 的次数与 fixture 的行号绑定；改 fixture 的行结构须同步核对（失准时
  「钮在场」这条正观测会当场判红，不会静默空转）。

## 环境与副作用

- 合成 vault + 隔离 `XDG_CONFIG_HOME`；dev 端口 1430（`LUMIR_ACCEPTANCE_PORT`），绝不碰 1420。
- 只用键盘注入建选区，不移动真实光标（`clickEditor` / `keys` 都是后台通道）。
