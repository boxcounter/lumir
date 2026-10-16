---
id: "160-quote-button-viewport-clamp"
item: 531
title: 摘录浮动钮落点钳制：选区并集盒越出挂载容器（长行 / 跨多行）时钮仍在视口内
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

  - name: ⌘A 全选——选区并集盒的右缘（= fixture 里那行 316 字符代码行的右缘）与下缘同时越出挂载容器
    do: keys
    keys: ["cmd+a"]
    expect:
      - label: 浮动「摘录到对话」钮在场（D370；同时是「⌘A 真的建出选区」的正观测）
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
要用户把编辑器列横滑过去才看得见）。构造：`⌘A` 全选 ⇒ 选区并集盒在两个方向上都越出容器——
右缘 = fixture 里那行 316 字符的代码行右缘（`code_block_wrap` 出厂 `false` ⇒ 不折行，右缘伸到
容器外 ≈ 1540px，容器仅 964px 宽）、下缘 = 整篇的末行。

判据是 `geom`（M397 的几何可见性断言）：包围盒**完整落在视口内**、非退化（宽 ≥ 40 / 高 ≥ 16），
且包围盒区域内扫得到已绘制字形。修前（`placeButton` 零钳制）钮的落点 = 选区包围盒右下 + 4px
⇒ 落在 x ≈ 1779 / y ≈ 2465（窗口只有 1200×800），`geom` 的「越出视口」当场判红；修后钮被钳在
容器内，同一断言转绿。

## 判据为什么这样写

- **为什么是 `⌘A` 而不是「⌃N ×11 把光标挪到那行长行 + ⌃⇧N 选中」**：真机键盘注入会**丢键**
  （REVIEW.md 第 11 条），而 ⌃N / ⌃⇧N 这类 chord 在套件里是盲发、没有回读重试（`keys` 只对全可
  打印单字符序列做回读重试）。多按 11 次＝多 11 个丢键机会，而丢键的后果是「选中了别的行」——
  那行不越界，钮的落点正常，`geom` 照绿、**判据静默空转**（REVIEW.md 第 1 条）。`⌘A` 一个 chord、
  一次成败：丢了就没有选区、钮不在场，第一条断言当场判红，不会静默。
- **为什么用 `geom` 而不是 `ax.has`**：AX 里有节点只说明「这个元素存在」，不说明它在视口内——
  被祖先 `overflow` 裁掉、或被推到滚动窗口之外的内容，WKWebView 的 AX 照样暴露节点与**未裁**的
  包围盒（M397 的现场）。`geom` 的两段（几何 + 绘制）才判得了「用户真的看得见」。
- **`minWidth: 40` 是第二条判据**：未钳制时钮还会被「left 到容器右缘」的可用宽压成逐字换行的
  窄条（实测 31px 宽 × 107.5px 高，另一现场形态）；尺寸下限把「钮在视口内但形态已坏」也判红。
- **为什么不用「点得到」当判据**：`click` 走 AXPress（「按下这个元素」），**恒能命中**，与元素在
  不在视口内无关——它证不了这条缺陷（本场景因此不设点击步：点得到不等于看得见）。
- **水平与垂直两个方向都判得到**：全选的并集盒右缘越界（长代码行）＋ 下缘越界（横跨整篇），
  因此这一条判据同时覆盖 `left` 与 `top` 两处钳制。

## 已知边界（如实登记）

- **「编辑器列可横滑」这一半在真机层判不了**：套件没有读数出口（AX 不暴露 `scrollWidth`、
  `pixel` 只给底色/对比度），因此真机层只判「钮在视口内」这个**用户看得见的后果**；
  「`.pane-editor` 不得被这颗钮撑出横向滚动」由 chromium 视觉场景
  `tests/visual/scenes/m345-quote-card.spec.ts` 的「钳制」用例判（读 `.pane-editor.scrollWidth`）。
  机制实测（M531）：编辑器列是 `class="pane pane-editor"`，`src/style.css` 的 `.pane { overflow: auto }`
  命中它 ⇒ 溢出被这一列自己吸收成横向滚动（两栏态下它同时装两个 pane，所以观感是「两个 pane
  一起横滑」），**不会**传到文档根——`documentElement.scrollWidth` 恒为窗口宽。
- **本场景的前提与结论在本层都判得到**：fixture 原文、`⌘A` 全选、双向越界、钮被收进容器与
  「编辑器列不可横滚」在同一份 assertions 里各有一条（chromium 视觉场景
  `m345-quote-card.spec.ts` 的「真机场景 160 的前提在本层可复现」用例）——fixture 行结构或
  ⌘A 语义一旦变，本场景会在那里先红。
- **钮的纵向钳制在编辑器侧的另一形态**（选区只贴容器底缘、不横跨整篇）够不到判别性落点：
  文档尾留白 + 文档结束标记恒留 ≈58px 余量 > 钮高 + 4px。本场景改用全选，纵向越界因此是**整篇**
  造成的，不受那条余量影响；transcript 那颗钮的纵向现场另有 chromium 用例
  （`tests/visual/scenes/m423-message-excerpt.spec.ts`）。

## 环境与副作用

- 合成 vault + 隔离 `XDG_CONFIG_HOME`；dev 端口 1430（`LUMIR_ACCEPTANCE_PORT`），绝不碰 1420。
- 只用键盘注入建选区，不移动真实光标（`clickEditor` / `keys` 都是后台通道）。
