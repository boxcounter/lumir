---
id: "26-svg-scroll-stability"
item: 26
title: 倒序滚动经过大尺寸 svg 图：图渲染完整、终态无自发位移（替换区尺寸的会话内一致性，M187）
fixtures: [svg-scroll.md, svg-scroll-tall.svg]
open: svg-scroll.md
marker: "svg 滚动场景"
steps:
  - name: 起点：大图在首屏之下
    expect:
      - label: 图片行的源码还没被装饰替换（尚未进入渲染视口）
        editor: { has: "![滚动大图](svg-scroll-tall.svg)" }
      - shot: 起点

  - name: 建立渲染层焦点（后面的翻屏键要落到编辑器上）
    do: clickEditor
    expect:
      - label: 编辑器已就位（AXTextArea 可读）
        editor: { has: "段落 01" }

  - name: 正向翻屏到底：大图渲染一次后滚出渲染视口（几何进会话记忆、widget 被销毁）
    do: keys
    keys: [ctrl+v, ctrl+v, ctrl+v]
    gapMs: 500
    expect:
      - label: 翻到底后大图已滚出渲染视口（视口内看不到它的源码，也看不到图片）
        editor: { not: "![滚动大图](svg-scroll-tall.svg)" }
      - shot: 到底

  - name: 倒序翻屏回到大图：两屏内落到图片处（重建 widget，缺陷现场）
    do: keys
    keys: [alt+v, alt+v]
    gapMs: 500
    expect:
      - label: 大图已渲染出来（AXImage 在场，alt 是原始引用串）
        ax: { count: { pattern: "/AXImage \\(!\\[滚动大图\\]\\(svg-scroll-tall\\.svg\\)\\) @[0-9,-]+ [0-9]{3}×[0-9]{3}/", exact: 1 } }
      - label: 图片真的画出来了（svg 内部文本进了 AX 树）
        ax: { has: "svg 滚动夹具" }
      - label: 加载中状态已退场（没有卡住的占位）
        editor: { not: "加载中…" }
      - label: 图片行仍被 replace 装饰藏起源码（装饰没被销毁后遗留成源码）
        editor: { not: "![滚动大图](svg-scroll-tall.svg)" }
      - shot: 倒序回来看图

  - name: 停手一拍（无输入）：终态稳定，没有自发位移
    do: settle
    expect:
      - label: 大图仍在原位渲染（重建后没有回跳把它推走）
        ax: { count: { pattern: "/AXImage \\(!\\[滚动大图\\]\\(svg-scroll-tall\\.svg\\)\\) @[0-9,-]+ [0-9]{3}×[0-9]{3}/", exact: 1 } }
      - label: 终态里图片的显示宽度仍等于栏宽一档、高度按固有比例（M182 的宽度不变量没被本修复连带破坏）
        ax: { count: { pattern: "/AXImage \\(!\\[滚动大图\\]\\(svg-scroll-tall\\.svg\\)\\) @[0-9,-]+ [6-9][0-9]{2}×[4-6][0-9]{2}/", exact: 1 } }
      - shot: 停手一拍
---

说明：本场景守 M187（替换区尺寸的会话内一致性，条款见 [docs/specs/image-reading.md](../../../docs/specs/image-reading.md) §5）
的用户可见终态——**倒序滚动经过大尺寸 svg 图后，图必须渲染完整、终态不得出现把正文推走的自发位移**。

## 这条场景能判什么、不能判什么（写清楚，别把它读成「瞬态已验」）

- **能判**：一次「正向到底 → 倒序回来」的翻屏往返之后，大图在终态被完整渲染（AXImage + svg
  内部文本都在）、没有被回跳推到视口之外、也没有停在加载中状态；终态宽度仍是栏宽一档（M182 的
  不变量没被本修复破坏）。这三条是用户报告里的**终态**部分（「滚不到那张 svg 图片的完整内容」）。
- **判不到**：本缺陷的**瞬态**。M187 的现场是「重建瞬间的行块被压缩 → CM 滚动锚定把 scrollTop
  推走 → 字节到达再推回」的一对位移，两次相差一次字节到达的时间（真机上是毫秒级：invoke +
  base64 + 解码）。本套件读不到 `scrollTop`（见 `14-tabs.md` 的说明），每个断言的采样间隔（一次
  MCP 往返，数百毫秒）也远长于该窗口——**采样落在瞬态之后，所以本场景在修复前后都是绿的**，
  它的价值是终态回归护栏，不是本修复的判别性验证。
- **判别性验证在哪**：chromium 通道（真 app + 桩后端 + 滚轮驱动 + 逐帧采样 scrollTop）。M187 的
  探针实测：修复前「非用户输入的 scrollTop 变化」1 次 / 最坏 465px；修复后 0 次 / 最坏 0px；
  正向滚动两态都是 0（与用户「快滚不触发、正向不触发」的报告一致）。探针脚本与逐条输出留档
  `test-results/m187/`（git 外）。

## 驱动与落点的口径

- **驱动用 ⌃V / ⌥V**（app 自己的翻屏键，`src/keys.ts` 的 `editor.scroll-page-down/up`，只滚视口
  不动光标）。套件没有滚轮动作（`lib/execute.mjs` 的动作表里没有 scroll），所以「慢速倒序滚动」
  在这条通道上表达不了；翻屏键是这条通道能做到的「倒序滚动」。两个键都要求编辑器持有渲染层焦点，
  因此先 `clickEditor`。
- **步长**：⌃V ≈ clientHeight − 2×行高（真机窗口 1200×800 下约 600px 一屏）。夹具因此按「一屏
  内能落到图片处」设计：图片上方 14 段、下方 38 段正文；从底部倒序两屏落在大图上（第三屏会落到
  图片上方）。若窗口尺寸/字体度量变化导致落点漂移，调 `svg-scroll.md` 的段落数，不要放宽断言。
- **AXImage 的几何判据**：宽度取 `[6-9][0-9]{2}`（600–999）而不是写死 735——栏宽随窗口与字体度量
  浮动（同 `23-image-first-open-width.md` 的口径）；高度 `[4-6][0-9]{2}` 对应 viewBox 720×560 在
  栏宽下的等比高度。`svg 滚动夹具` 是夹具 svg 内部的唯一文本（AX 里能读到，先例见
  `20-image-fallback.md` 的 `normal fixture`）。
