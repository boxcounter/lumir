---
id: "160-quote-button-viewport-clamp"
item: 531
title: 摘录浮动钮落点钳制：选区并集盒越出挂载容器（长行）时钮仍在视口内
open: code-block-fullscreen.md
marker: "TOP-MARK"
steps:
  - name: 把光标放进编辑器正文（后续鼠标动作的前置）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: 抢前台（真鼠标动作落在最上层那扇窗——README 环境纪律）
    do: focusWindow
    retries: 4

  - name: 双击 316 字符长行上的 A 串（连续无分隔符 ⇒ CM 词选区覆盖整行 ⇒ 选区右缘越出容器）
    # 通道选择的全经过（2026-10-16 探针定案，证据 test-results/acceptance/2026-10-16/tmp-m536-drag-probe/）：
    # ① ⌘A 单发 1/1、幂等三连发 3/3 全丢（press_key 键码级丢弃族，同 cmd+v 8/9；cmd+s / cmd+z
    #   同场照落——非服务整体退化）；② 套件 CGEvent 拖选在 CM 编辑器里造不出任何选区（裸拖 /
    #   前置 hover / 段内短拖三个变体 3/3 全败，M228 边界复确认；transcript 静态文本侧 121/122
    #   能用是因为那条不是 CM 编辑器）；③ swift shift+点击（mode 6）不延拓选区（正文行 / 右下 /
    #   标题行多点实证）；④ 双击（M209 swift clickState 通道）造词选区 2/2 可靠，且 316 个连续
    #   A 无词内分隔符，一词即整行——选区并集盒右缘 = 行右缘 ≈1540px > 容器 964px，横向越界
    #   现场成立（修前钮落点 = 右缘 + 4px 必出视口 / 被压成窄条）。纵向（top）钳制在编辑器侧
    #   本就没有判别性落点（M531 提交说明与「已知边界」如实登记），本场景只判横向。
    # 坐标口径：窗口钉 1200×800 @8,40、文档从头开卷（每场景新实例）；A 串在窗口局部 (466..1054+,
    # 415) 一行，双击点 (800,415) 必落 A 上。失效条件：fixture 行结构 / 编辑器列几何变化会让
    # 双击落空，届时下方两条断言如实红，先核对截图再改坐标。
    do: doubleClick
    target: { x: 800, y: 415 }
    expect:
      - label: 浮动「摘录到对话」钮在场（D370；同时是「选区真的建出来了」的正观测）
        ax: { has: "/AXButton \\(摘录到对话\\)/" }
      - label: 长行 A 串真的被选中了（选中范围在 AX value 里显露为源码，场景 64 的口径；防「双击
          落在短词上、geom 静默空转」——没选中 A{30,} 本条必红）
        editor: { has: '/const long = "A{30,}/' }
      - shot: 01-长行词选区

  - name: settle 后判几何（geom 自取带图快照；与上步拆开避免 pixel/geom 复用无图 AX 快照）
    do: sleep
    ms: 600
    expect:
      - label: 钮整体落在视口内且尺寸未被子缩（几何包围盒 + 包围盒内确有已绘制字形 = M531 钳制生效）
        geom:
          target: { role: AXButton, name: "摘录到对话" }
          minWidth: 40
          minHeight: 16
          painted: { min: 60 }
      - shot: 02-钮在视口内
---

# 160-quote-button-viewport-clamp —— 浮动钮落点钳制（M531，change fix-quote-button-viewport-clamp）

## 本场景在验什么

编辑器选区越出挂载容器时，浮动「摘录到对话」钮 MUST 被收进容器的可视区（而不是落在视口之外、
要用户把编辑器列横滑过去才看得见）。构造：双击 fixture 里那行 316 字符代码行（`code_block_wrap`
出厂 `false` ⇒ 不折行）上的连续 A 串——CM 词选区一词覆盖整行，选区并集盒右缘 = 行右缘
≈ 1540px（容器仅 964px 宽）⇒ 横向越界。修前（`placeButton` 零钳制）钮的落点 = 选区右缘 + 4px
⇒ 落在视口之外、或被「left 到容器右缘」的可用宽压成逐字换行的窄条（M531 实测 31px 宽）；修后
钮被钳在容器右缘内侧、保持自然宽。

判据是 `geom`（M397 的几何可见性断言）：包围盒**完整落在视口内**、非退化（宽 ≥ 40 / 高 ≥ 16），
且包围盒区域内扫得到已绘制字形。

## 判据为什么这样写

- **为什么用「双击长行词」建选区**：真机层可靠的建选区通道只剩双击——⌘A 被 press_key 确定性
  丢弃（见 steps 注释全经过）、CGEvent 拖选在 CM 编辑器内造不出选区（M228 边界）、shift+点击
  不延拓。316 个连续 A 无词内分隔符，双击任一点都选中整行，一个动作即造出「右缘越出容器」的
  判别性现场；且双击是 M209 用 clickState 显式合成的通道，WKWebView 的 DOM dblclick 可靠落地。
- **为什么加 `editor has /const long = "A{30,}/` 这一条**：选中范围在 AXTextArea.value 里**显露为
  源码**（场景 64 的口径）。它是防「geom 静默空转」的正观测——若双击落在行内短词上（fixture
  改动 / 坐标漂移），钮照样出现、geom 照样绿，但越界现场根本没造出来；这条断言把「A 串确实被
  选中」钉死，造不出越界现场就如实红。
- **为什么用 `geom` 而不是 `ax.has`**：AX 里有节点只说明「这个元素存在」，不说明它在视口内——
  被祖先 `overflow` 裁掉、或被推到滚动窗口之外的内容，WKWebView 的 AX 照样暴露节点与**未裁**的
  包围盒（M397 的现场）。`geom` 的两段（几何 + 绘制）才判得了「用户真的看得见」。
- **`minWidth: 40` 是第二条判据**：未钳制时钮会被可用宽压成逐字换行的窄条（实测 31px 宽 ×
  107.5px 高）；尺寸下限把「钮在视口内但形态已坏」也判红。
- **为什么不用「点得到」当判据**：`click` 走 AXPress（「按下这个元素」），**恒能命中**，与元素在
  不在视口内无关——它证不了这条缺陷（本场景因此不设点击步：点得到不等于看得见）。
- **只判横向（left 钳制），纵向（top 钳制）在编辑器侧无判别性落点**：与 M531 提交说明同一结论
  （「文档尾留白 + 文档结束标记恒留 ≈58px 余量 > 钮高 + 4px」），纵向那颗钮（transcript 侧）
  另有 chromium 用例 `tests/visual/scenes/m423-message-excerpt.spec.ts` 的「钳制」用例。

## 已知边界（如实登记）

- **「编辑器列可横滑」这一半在真机层判不了**：套件没有读数出口（AX 不暴露 `scrollWidth`、
  `pixel` 只给底色/对比度），因此真机层只判「钮在视口内」这个**用户看得见的后果**；
  「`.pane-editor` 不得被这颗钮撑出横向滚动」由 chromium 视觉场景
  `tests/visual/scenes/m345-quote-card.spec.ts` 的「钳制」用例判（读 `.pane-editor.scrollWidth`）。
  机制实测（M531）：编辑器列是 `class="pane pane-editor"`，`src/style.css` 的 `.pane { overflow: auto }`
  命中它 ⇒ 溢出被这一列自己吸收成横向滚动（两栏态下它同时装两个 pane，所以观感是「两个 pane
  一起横滑」），**不会**传到文档根——`documentElement.scrollWidth` 恒为窗口宽。
- **本场景的前提与结论在本层都判得到**：fixture 行结构（316 字符行在场）由 `editor has` 那条
  间接钉死（选中 A{30,} ⇒ 行在场且词选区成立）；chromium 视觉场景
  `m345-quote-card.spec.ts` 的「真机场景 160 的前提在本层可复现」用例另钉键盘建选区语义与
  容器几何——fixture 行结构、编辑器列几何或建选区语义一旦变，本场景会在这里先红。
- **双击坐标是硬编码窗口局部点**（窗口钉 1200×800 @8,40、文档从头开卷）：fixture 行结构或
  编辑器列几何变化会让双击落空（`editor has` 断言如实红），改坐标前先看截图证据。

## 环境与副作用

- 合成 vault + 隔离 `XDG_CONFIG_HOME`；dev 端口 1430（`LUMIR_ACCEPTANCE_PORT`），绝不碰 1420。
- 选区用**真实鼠标双击**建立（CGEvent clickState 通道，会移动真实光标、要求窗口在前台——
  focusWindow 步即此前置）；键盘注入只用于光标落位（clickEditor）。
