---
id: "23-image-first-open-width"
item: 23
title: 图片显示宽度不依赖加载时序（首开 vs 切走切回两态收敛到栏宽）
fixtures: [image-width-probe.md, image-width-probe-other.md, image-width-probe-wide.svg, image-width-probe-narrow.svg, image-width-probe-percent.svg]
open: image-width-probe.md
marker: "图片宽度场景"
steps:
  - name: 首开：固有尺寸不确定的引用即达栏宽（修复前停在加载中状态块的宽度）
    do: sleep
    ms: 1500
    expect:
      - label: 百分比固有宽度的 svg 首开即按栏宽渲染（修复前实测 379×77）
        ax: { count: { pattern: "/AXImage \\(!\\[percent svg again\\]\\(image-width-probe-percent\\.svg\\)\\) @[0-9,-]+ [6-9][0-9]{2}×[5-9][0-9]/", exact: 1 } }
      - label: 超栏宽的定尺寸 svg 按栏宽收窄（控制组，两态都不变）
        ax: { count: { pattern: "/AXImage \\(!\\[wide svg\\]\\(image-width-probe-wide\\.svg\\)\\) @[0-9,-]+ [6-9][0-9]{2}×[3-9][0-9]/", exact: 1 } }
      - label: 窄于栏宽的定尺寸 svg 不被拉伸：宽度停在固有宽一档（400），而不是栏宽（控制组）
        ax: { count: { pattern: "/AXImage \\(!\\[narrow svg\\]\\(image-width-probe-narrow\\.svg\\)\\) @[0-9,-]+ [3-4][0-9]{2}×[3-9][0-9]/", exact: 1 } }
      - label: 图片行的源码仍被 replace 装饰藏起
        editor: { not: "image-width-probe-percent.svg" }
      - shot: 首开
  - name: 切到另一篇
    do: open
    file: image-width-probe-other.md
    marker: "另一篇"
  - name: 切回：同一引用收敛到与首开逐项相同的宽度
    do: open
    file: image-width-probe.md
    marker: "图片宽度场景"
    expect:
      - label: 百分比固有宽度的 svg 切回后仍按栏宽渲染（与首开同一条判据）
        ax: { count: { pattern: "/AXImage \\(!\\[percent svg again\\]\\(image-width-probe-percent\\.svg\\)\\) @[0-9,-]+ [6-9][0-9]{2}×[5-9][0-9]/", exact: 1 } }
      - label: 超栏宽的定尺寸 svg 仍是栏宽（控制组）
        ax: { count: { pattern: "/AXImage \\(!\\[wide svg\\]\\(image-width-probe-wide\\.svg\\)\\) @[0-9,-]+ [6-9][0-9]{2}×[3-9][0-9]/", exact: 1 } }
      - label: 窄于栏宽的定尺寸 svg 仍停在固有宽一档（控制组）
        ax: { count: { pattern: "/AXImage \\(!\\[narrow svg\\]\\(image-width-probe-narrow\\.svg\\)\\) @[0-9,-]+ [3-4][0-9]{2}×[3-9][0-9]/", exact: 1 } }
      - shot: 切回
---

说明：本场景是 M182（图片显示宽度不变量）的真机取证与门禁场景。**两态用同一条判据断言**——
「首开」与「切走切回」两步里三条 AXImage 断言逐字相同，因此同时断了两件事：每条引用的宽度两态
一致（收敛），且固有尺寸不确定的引用等于栏宽。

- **判据为什么是几何读数**：`<img>` 的 `alt` 与 AX 文本与渲染尺寸无关（M178 的教训，场景 20 的
  说明里有现场），所以宽度只能读 `AXImage … @x,y W×H` 的 bbox。宽度取 `[6-9][0-9]{2}`（600–999）
  而不是写死 735：栏宽随窗口/字体度量浮动，写死会换机即红；`[6-9][0-9]{2}` 仍能把修复前的读数
  （实测 379，加载中状态块的文本宽度）挡在外面——这是本场景的区分度所在。
- **窄图控制组的判据为什么是区间**：真机实测发现 WKWebView 的 AX 给「以固有尺寸渲染」的
  `AXImage` 节点的 bbox 是**估计值**——同一次运行内，断言时点的读数命中 4xx（所以断言过），
  截图时点的读数是 `385×59`（400×60 的 0.9625 倍）；被栏宽夹住的图（超栏宽 / 按栏宽填充）读数
  稳定精确（735 在全部 run、全部时点逐次相同）。截图实测该窄图渲染宽 ≈ 400 CSS px
  （`shots/01-首开.jpeg`，窗宽 1200 → 截图 1152，缩放 0.96 → 383/0.96 ≈ 399），即**渲染正确、
  AX 读数偏小约 4%**。因此真机层这一条判「**没被拉伸到栏宽**」这个用户可见的失效形态
  （区间 300–499；拉伸后会是 6xx–7xx），「宽度恒等于固有宽」的精确断言留在 chromium 属性测试
  （`m182-image-first-open-width.spec.ts` 的 DEFINITE 组，读数精确：240×80 → 240.0）。
- **控制组用 svg 而不是位图**：定固有尺寸（2000×300 / 1000×100）的 svg 与位图走同一条 CSS 尺寸
  路径（都按固有宽度 + 栏宽算），位图的解码腿由场景 20 的 0 字节位图覆盖；这样验收 fixture 全为
  文本，不留二进制。
- **第一条百分比的引用没有几何读数**：它是文档里第一张图，AX 把它的节点并成无 bbox 的 `AXGroup`
  （实测两态都如此），所以判据落在同一份文件的第二次引用上（同形态、两态都有 bbox）。第一张的
  行为由 chromium 属性测试（`tests/visual/scenes/m182-image-first-open-width.spec.ts`，同一份文件
  + `![[]]` 方言形态）覆盖。
- **反向验证**（REVIEW.md 第 1 条的防线）：移除机制落点（`src/preview/theme.ts` 的
  `.cm-lp-image` `width: "100%"`）后，本场景首开步转红（实测读数 `379×77`），切回步仍绿——即
  红在「首开」而不是「切回」，正是缺陷的两个终态分支。红输出留档 `test-results/m182/`。
