---
id: "27-document-end-marker"
item: 27
title: 正文末尾的结束标记（文档超过一屏时显示、装得下时不显示）
fixtures: [end-marker-long.md, end-marker-short.md]
open: end-marker-long.md
marker: "结束标记场景（长文·真机）"
steps:
  - name: 长文装载：磁盘基线与「标记不是正文」的负向判据
    do: record
    as: 长文文件
    file: end-marker-long.md
    expect:
      - label: 编辑器文档文本里没有标记的文案（标记不是正文内容）
        editor: { not: "到底了" }
      - shot: 长文首屏
  - name: 建立渲染层焦点（后面的翻屏键要落到编辑器上）
    do: clickEditor
    expect:
      - label: 编辑器已就位（AXTextArea 可读）
        editor: { has: "这一段是长文的第 1 段" }
      - label: 首屏（尚未滚动）标记的可读文本节点已在 AX 里（M178 现场：AX 文本不等于可见；**不是可见性判据**，见文末覆盖边界）
        ax: { count: { pattern: "/AXStaticText = \"到底了\"/", exact: 1 } }
  - name: 翻到文档末尾
    do: keys
    keys: ["ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v"]
    gapMs: 500
  - name: 文档末尾：标记在场、正文未被改写
    do: settle
    expect:
      - label: 末段正文在文档文本里（文档内容完整）
        editor: { has: "它的下面是文件的终点" }
      - label: 标记的可读文本节点仍在 AX 里（长文侧正观测）
        ax: { count: { pattern: "/AXStaticText = \"到底了\"/", exact: 1 } }
      - label: 标记的文案不在编辑器文档文本里（渲染不写文档）
        editor: { not: "到底了" }
      - label: 磁盘文件逐字节未变（ADR 0003 §3）
        file: { path: end-marker-long.md, unchangedSince: 长文文件 }
      - shot: 长文滚到底
  - name: 切到一屏装得下的短文
    do: open
    file: end-marker-short.md
    marker: "结束标记场景（短文·真机）"
  - name: 短文：整篇在视野内，标记不显示
    do: record
    as: 短文件
    file: end-marker-short.md
    expect:
      - label: 末段正文在文档文本里（正观测：AX 读的是这份文档）
        editor: { has: "第三段，也是最后一段" }
      - label: AX 树里没有标记的可读文本节点（一屏装得下时元素不在 DOM 里，不是「藏在视口外」）
        ax: { not: "到底了" }
      - label: 编辑器文档文本里也没有标记的文案
        editor: { not: "到底了" }
      - label: 磁盘文件逐字节未变
        file: { path: end-marker-short.md, unchangedSince: 短文件 }
      - shot: 短文
---

说明：本场景是 change `document-end-marker`（M189）的真机取证。两侧用**同一个匹配器**：长文那两步必须命中
标记的可读文本节点（`AXStaticText = "到底了"`），短文那一步必须完全不命中——「不命中」因此不是恒真的空转
（REVIEW.md 第 2 条），也同时证明 AX 读数本身是活的。

## 覆盖边界（如实标注，不许读成「已验证」）

- **真机通道读不到标记的几何**：WKWebView 在这条 AX 通道里只给 `AXButton` / `AXImage` / `AXScrollArea` 一类节点 bbox，
  纯文本节点（`AXTextArea` 自身、行内 `AXStaticText`）**没有 `@x,y W×H`**。实测现场（`ax/03-长文滚到底.txt`）：
  标记的节点是 `- [192] AXStaticText = "到底了"`、与 `AXTextArea` 同级（不在 textbox 里），无 bbox。
  因此「可见性」这条**不在真机通道判**，判据落在：
  1. **chromium 层**（`tests/visual/scenes/end-marker.spec.ts`）：渲染盒宽高非零、水平居中、落在正文内容盒之下、
     滚到底时落在滚动容器内、线段总宽 < 栏宽一半——几何断言齐全；
  2. **截图证据**（本场景的 `shots/`，人可读、Alex 抽审用）；
  3. **缺席判据**（本场景）：短文侧连节点都不存在（元素根本不在 DOM 里），长文侧节点存在——这一对是可断言的，
     但它证的是「标记在不在文档场景里」，**不是**「在不在视口里」。
- **不要用「AX 里有『到底了』」当可见性判据**：M178 的现场（`docs/backlog.md:293-304`）说的是不可见元素照样有 AX 文本；
  本场景 `建立渲染层焦点` 那一步就实测到了这一点——标记在首屏下方、节点已在 AX 里。所以那条断言只当**在场**证据用。
  那一步之前先 `clickEditor`：标记的挂载要等编辑器首个测量周期（CM 的 `requestMeasure` 走 rAF），
  窗口被挡住时 rAF 会被 WKWebView 饿住（本批次实测：套件拿不到前台的那次运行里，装载后立刻读 AX 读不到节点，
  点击编辑器让窗口可见后才读到）——这是通道/环境的边界，不是标记的可见性语义。
- **不做 ⌘A / ⌘F 的真机判据**：真机通道没有剪贴板与搜索面板的可断言读数；那两条在 chromium 层有精确断言
  （`end-marker.spec.ts` 的「非文档性」用例：真剪贴板文本 + 搜索面板计数）。真机侧的非文档性落点是
  磁盘逐字节 + `editor.not`（文档文本里没有标记文案）+ 标记节点在 textbox 之外。
- **反向验证**（REVIEW.md 第 1 条）：把标记的挂载去掉（回退到本 change 的实现前代码）后重跑本场景，
  长文那两步的节点断言必须 FAIL——没有这一步的 PASS 不算数。
