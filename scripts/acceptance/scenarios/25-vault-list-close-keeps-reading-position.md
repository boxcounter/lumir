---
id: "25-vault-list-close-keeps-reading-position"
item: 25
title: 打开 / 收起 vault 列表不改变正文阅读位置
fixtures: [toc-long.md]
open: toc-long.md
marker: "第 1 章 概览"
steps:
  - name: 初始阅读位置（篇首）
    do: settle
    expect:
      - shot: 打开后篇首
      - label: 篇首两行在 AX 渲染行里（后面那条「不在」因此有对照）
        ax: { has: "第 1 章 概览 第 1 章概览正文。" }

  - name: 建立编辑器焦点（点正文顶部：光标落在篇首，正是「滚着读」之前的起点）
    do: clickEditor
    dy: 6
    expect:
      - label: 文档已装载
        editor: { has: "第 1 章 概览" }

  - name: ⌃V 翻屏到文档尾部（Emacs C-v：只滚视口、不动光标＝「滚着读」的真实状态）
    do: keys
    keys: ["ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v"]
    expect:
      - shot: 翻屏之后
      - label: 视口已离开篇首（第 1 章两行不再出现在渲染行里）
        ax: { not: "第 1 章 概览 第 1 章概览正文。" }
      - label: 尾部章节两行在渲染行里（上一条不得在「读不到」上空过）
        ax: { has: "第 15 章 概览 第 15 章概览正文。" }

  - name: 点树头部入口打开列表（鼠标路径）
    do: click
    target: { any: "点击查看全部 vault" }
    expect:
      - shot: 列表已打开
      - label: 浮层确实打开了（底部新增入口只存在于浮层里）
        ax: { has: "选择一个目录作为新 vault" }
      - label: 打开浮层也没改变阅读位置（第 1 章两行仍不在渲染行里）
        ax: { not: "第 1 章 概览 第 1 章概览正文。" }
      - label: 尾部章节两行仍在渲染行里
        ax: { has: "第 15 章 概览 第 15 章概览正文。" }

  - name: Esc 收起列表
    do: key
    key: "escape"
    expect:
      - shot: Esc 收起后
      - label: 浮层已收起（列表内容不在 AX 里）
        ax: { not: "选择一个目录作为新 vault" }
      - label: 阅读位置不变——第 1 章两行不得回到渲染行里（缺陷现场：整个正文跳回篇首）
        ax: { not: "第 1 章 概览 第 1 章概览正文。" }
      - label: 尾部章节两行仍在渲染行里（与翻屏后同一条判据）
        ax: { has: "第 15 章 概览 第 15 章概览正文。" }

  - name: 再按 ⌘O 打开列表（键位路径）
    do: key
    key: "cmd+o"
    expect:
      - label: 浮层重新出现（键位路径有效）
        ax: { has: "选择一个目录作为新 vault" }

  - name: ⌘O 再按一次收起（关闭路径：同一命令反转）
    do: key
    key: "cmd+o"
    expect:
      - shot: ⌘O 收起后
      - label: 浮层已收起
        ax: { not: "选择一个目录作为新 vault" }
      - label: 阅读位置不变（第 1 章两行仍不在渲染行里）
        ax: { not: "第 1 章 概览 第 1 章概览正文。" }
      - label: 尾部章节两行仍在渲染行里
        ax: { has: "第 15 章 概览 第 15 章概览正文。" }

  - name: 对照：⌘/ 键位面板（同族焦点交还路径，面板本体在 src/bindings-panel.ts）
    do: key
    key: "cmd+/"
    expect:
      - label: 面板已打开
        ax: { has: "键位（生效中）" }

  - name: 对照：Esc 收起键位面板后阅读位置同样不变
    do: key
    key: "escape"
    expect:
      - label: 面板已收起（面板内容不在 AX 里）
        ax: { not: "键位（生效中）" }
      - label: 阅读位置不变（第 1 章两行仍不在渲染行里）
        ax: { not: "第 1 章 概览 第 1 章概览正文。" }
      - label: 尾部章节两行仍在渲染行里
        ax: { has: "第 15 章 概览 第 15 章概览正文。" }

  - name: 对照：⌘F 搜索面板（另一条焦点交还路径，面板本体在 src/search.ts）
    do: key
    key: "cmd+f"
    expect:
      - label: 搜索面板已打开
        ax: { has: "查找" }

  - name: 对照：Esc 收起搜索面板后阅读位置同样不变
    do: key
    key: "escape"
    expect:
      - label: 阅读位置不变（第 1 章两行仍不在渲染行里）
        ax: { not: "第 1 章 概览 第 1 章概览正文。" }
      - label: 尾部章节两行仍在渲染行里
        ax: { has: "第 15 章 概览 第 15 章概览正文。" }
---

## 这条场景在验什么

Alex 原话（M186）：「打开 vault 列表然后 ESC 收起列表，右栏文档内容区域会自动回到顶部。期望是不改
阅读位置，应该保持在我刚才阅读的位置」。

**判据为什么只对目标成立**：KimiCU 的 AX 输出不暴露滚动位置（整窗只有一个 `AXScrollArea`，没有可读
的 scrollTop），本场景因此用**被测行为自己产出的渲染行**当判据——WKWebView 只给**视口内已渲染**的行
建 `AXStaticText` 节点（长文档实测：滚到尾部时渲染行从第 11 章起，篇首两行不再有节点；`AXTextArea`
的 *value* 是**当前渲染区间**（可见区 ± ~1000px，随滚动位置变化）的行文本，不是整篇文本——同样
不能当阅读位置判据，实测见 `26-svg-scroll-stability.md` 的「`editor.*` 断言读的是渲染窗口」一节）。
行内两段（标题 + 紧随的正文）在同一个节点里以空格相连，形如
`第 1 章 概览 第 1 章概览正文。`，这个串**只可能**来自渲染行节点，不会与 value 的窗口文本混淆。

于是「阅读位置没被打回篇首」写成一对断言：`第 1 章 …` 两行**不在** AX 里（离开了篇首）+ `第 15 章 …`
两行**在** AX 里（人确实在文档尾部且 AX 可读，堵死「读不到 → 负向断言恒真」这条假绿路径）。同一对
断言在翻屏之后、列表打开之后、两种关闭路径之后各判一次：第一处是前置条件（证明「离开篇首」这个状态
真的建立起来了），后面几处是缺陷本身的判据。

`⌃V`（`editor.scroll-page-down`）是本场景的关键选择：它**只滚视口、不移动光标**（`src/editor.ts`
的 `scrollPage`），复现的正是「用触控板滚着读、光标还留在原处」这一用户的真实状态。

末尾两条**对照**（键位面板 / 搜索面板）验的是同一条不变量的家族属性：这三条路径都把焦点交还编辑器
（`view.focus()`），都可能在聚焦时被浏览器把视口揭示到光标处。契约条款见
`openspec/specs/vault-workspace/spec.md` 的「vault 切换器入口与列表浮层」（打开与关闭浮层 MUST NOT
改变阅读位置），实现见 `src/vault-switcher.ts` 的 `close` / `handOffFocus`。

## 覆盖边界（如实标注）

- **修复前也通过**：本场景在 M186 的修复**之前**跑过一次，同样全绿（真机复现不出用户报告的现场）。
  因此它钉的是**不变量本身**（打开/关闭浮层前后阅读位置一致），不是「修复前后由红转绿」的回归证明。
  缺陷现场无法在套件里重建的原因见下一条——这条如实写在场景里，避免后来者把它读成「红灯已转绿」。
- **触控板滚动注入不了**：KimICU 的 scroll 动作对 CM 的 scroller 无效（M116 实测）。⌃V 是唯一能
  注入的滚动路径，它需要编辑器有焦点（editor 作用域）——因此本场景覆盖不到「**文档打开后从未点进
  编辑器**（无 DOM 光标）+ 视口已滚动」这一状态，而那正是最可能触发浏览器「聚焦即揭示光标」的现场。
  代码层面两者的差别只在「谁改的 scrollTop」，都不移动光标。
- **只判「没被打回篇首」**：AX 不暴露精确 scrollTop，也不该为此加通道。「滚回篇首附近但没到顶部」
  这类小幅漂移不在判据覆盖内——那属于手感范畴，归 Alex 人肉，套件只留截图。
