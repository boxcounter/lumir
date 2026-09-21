---
id: "26-svg-scroll-stability"
item: 26
title: 倒序滚动经过大尺寸 svg 图：图渲染完整、终态无自发位移（替换区尺寸的会话内一致性，M187）
fixtures: [svg-scroll.md, svg-scroll-tall.svg]
open: svg-scroll.md
marker: "svg 滚动场景"
steps:
  - name: 起点：大图在初始渲染视口之外（还没被渲染过）
    expect:
      - label: 渲染窗口停在文档开头（这条是下面那条负向断言的对照，堵死空读）
        editor: { has: "段落 01" }
      - label: 大图的替换区节点不在 AX 树里（该行还没进渲染视口：替换区与源码都不在场）
        ax: { not: "![滚动大图](svg-scroll-tall.svg)" }
      - shot: 起点

  - name: 建立渲染层焦点（后面的翻屏键要落到编辑器上）
    do: clickEditor
    expect:
      - label: 编辑器已就位（AXTextArea 可读）
        editor: { has: "段落 01" }

  - name: 正向翻屏三屏：大图第一次进渲染视口（渲染一次，几何进会话记忆）
    do: keys
    keys: [ctrl+v, ctrl+v, ctrl+v]
    gapMs: 500
    expect:
      - label: 大图的替换区已在 AX 树里（同一个匹配器：起点判「不在」、这里判「在」）
        ax: { has: "![滚动大图](svg-scroll-tall.svg)" }
      - label: 加载中状态已退场（settle 跑过＝渲染几何已记进会话缓存，M187 预留机制的前提成立）
        editor: { not: "加载中…" }
      - shot: 大图已渲染

  - name: 继续翻屏到底：大图滚出渲染视口（widget 被销毁）
    do: keys
    keys: [ctrl+v, ctrl+v, ctrl+v, ctrl+v, ctrl+v, ctrl+v, ctrl+v, ctrl+v]
    gapMs: 500
    expect:
      - label: 已到文档末尾（末段在渲染窗口里——本步的「不在」因此不得在空读上成立）
        editor: { has: "段落 148" }
      - label: 大图已滚出渲染视口（替换区节点与源码都不在场）
        ax: { not: "![滚动大图](svg-scroll-tall.svg)" }
      - shot: 到底

  - name: 倒序翻屏回到大图：三屏内落到图片处（重建 widget，缺陷现场）
    do: keys
    keys: [alt+v, alt+v, alt+v]
    gapMs: 500
    expect:
      - label: 大图的替换区回到 AX 树里（与「到底」步同一个匹配器，形成对照）
        ax: { has: "![滚动大图](svg-scroll-tall.svg)" }
      - label: 加载中状态已退场（没有卡住的占位）
        editor: { not: "加载中…" }
      - label: 图片行仍被 replace 装饰藏起源码（装饰没被销毁后遗留成源码）
        editor: { not: "![滚动大图](svg-scroll-tall.svg)" }
      - shot: 倒序回来看图

  - name: 停手一拍（无输入）：终态稳定，没有自发位移
    do: settle
    expect:
      - label: 大图仍在原位渲染（重建后没有回跳把它推出渲染视口）
        ax: { has: "![滚动大图](svg-scroll-tall.svg)" }
      - label: 终态里图片行仍被装饰（源码不显露）
        editor: { not: "![滚动大图](svg-scroll-tall.svg)" }
      - shot: 停手一拍
---

说明：本场景守 M187（替换区尺寸的会话内一致性，条款见 [docs/specs/image-reading.md](../../../docs/specs/image-reading.md) §5）
的用户可见终态——**倒序滚动经过大尺寸 svg 图后，图必须渲染完整、终态不得出现把正文推走的自发位移**。

## 这条场景能判什么、不能判什么（写清楚，别把它读成「瞬态已验」）

- **能判**：一次「正向到底 → 倒序回来」的翻屏往返之后，大图在终态仍被渲染（替换区节点在场、图片行仍被
  replace 装饰藏起源码、没有停在加载中状态），且终态稳定不漂移。往返沿途的状态各有一条断言（起点未
  渲染 → 正向三屏渲染过 → 到底被销毁 → 回来重建），前三条用的是**同一个匹配器**（`ax` 里的 alt 串），
  所以两处「不在」不会退化成空转（REVIEW.md 第 2 条）。「图渲染完整」（几何完整、比例正确）这条**不**
  在本通道判，理由见文末「覆盖边界」（AX 节点形状不稳定），改由 chromium 层 + 截图证据承担。
- **判不到**：本缺陷的**瞬态**。M187 的现场是「重建瞬间的行块被压缩 → CM 滚动锚定把 scrollTop
  推走 → 字节到达再推回」的一对位移，两次相差一次字节到达的时间（真机上是毫秒级：invoke +
  base64 + 解码）。本套件读不到 `scrollTop`（见 `14-tabs.md` 的说明），每个断言的采样间隔（一次
  MCP 往返，数百毫秒）也远长于该窗口——**采样落在瞬态之后，所以本场景在修复前后都是绿的**，
  它的价值是终态回归护栏，不是本修复的判别性验证。
- **判别性验证在哪**：chromium 通道的**常驻属性测试**
  [tests/visual/scenes/m187-image-scroll-stability.spec.ts](../../../tests/visual/scenes/m187-image-scroll-stability.spec.ts)
  ——逐帧采 `scrollTop` + 输入事件时间戳，判「非用户输入引起的滚动位移」，驱动扫正向快滚（控制组）、
  倒序慢滚、倒序快滚、翻屏键 ⌥V 与窄图重建路径。该文件在 master 上两条用例都 FAIL（最坏 532px /
  60px，读数见 [docs/specs/image-reading.md](../../../docs/specs/image-reading.md) §6），修复后 0 次 / 0px；
  红绿原样输出留档 `test-results/m187/`。**本场景与它分工**：它守瞬态（chromium 近似），本场景守
  真机终态（WKWebView）。

## `editor.*` 断言读的是「渲染窗口」，不是整篇文档（本次真机首跑失败的根因，后来者必读）

真机上 `AXTextArea.value` = CM **当前渲染区间**（viewport）里的 DOM 文本，不是整篇文档。链条：
[src/preview/livePreview.ts:585](../../../src/preview/livePreview.ts) 的 `buildDecorations` 遍历
`view.visibleRanges`；`visibleRanges` 由 `@codemirror/view` 的 `computeVisibleRanges` 在 **viewport 内**
生成（没有 state 装饰时就是整个 viewport）；CM 的 viewport = 可见区 ± 1000px（`VP.Margin`，按滚动
方向拆上下两份）。⇒ **渲染区间与装饰区间重合**，于是「某条非首行的源码可见」在这条通道上不存在：
该行在渲染区间内 ⇒ 一定被 replace 装饰换成 widget；不在渲染区间内 ⇒ DOM 里没有这一行，value 里
自然也没有它。唯一的例外是「光标行碎片」——光标停在视口外的行上时，CM 会把那一行渲染出来但**不**
装饰（`25` 场景的 `ax/02-翻屏之后.txt` 里那行未装饰的 `# 第 1 章 概览` 就是它），那是把光标停在
图片行上才会有的偶然形态，不适合当起点前提。

实测对齐（旧版夹具：图片上方 14 段）：起点那次 `AXTextArea.value` 只到「段落 20」，末尾偏移
≈1133px ≈ 可见底 633px + 500px；滚到底后 value 也只是当时那一屏附近的 32 段
（`../25-vault-list-close-keeps-reading-position/ax/01-打开后篇首.txt` 里 15 章的文档 value 只有
第 1–4 章，同一口径——该场景说明里那句「value 是整篇文本」与实测不符，已另报 finding）。
因此本场景出生时那条起点断言（`editor.has "![滚动大图](svg-scroll-tall.svg)"`，标签「图片行的源码
还没被装饰替换」）**在真机上恒 FAIL**，加段落数也修不好：这是通道语义，不是时序。出生首跑现场留档
`test-results/m190/26-baseline-fail-2026-09-21/`（同时可见：旧夹具下图片顶边本来就在首屏之内，
`shots/01-起点.jpeg`，「大图在首屏之下」这个前提本身不成立）。

## 覆盖边界：AX 里大图的**节点形状**不稳定，不要拿形状当判据

同一份夹具、同一个替换区，在 AX 里会以两种形状出现：

- `AXImage (![滚动大图](svg-scroll-tall.svg)) @x,y w×h`：叶子节点，**有 bbox**；
- `AXGroup (![滚动大图](svg-scroll-tall.svg))` + 子节点 `AXStaticText = "svg 滚动夹具 …"`：有子文本，
  **没有 bbox**。

实测（证据目录见下）：

- **同一次会话里两种形状都出现过**：出生首跑 `test-results/m190/26-baseline-fail-2026-09-21/ax/`——
  `02-起点.txt` 是 `AXGroup` + 子文本，`05-倒序回来看图.txt` 是 `AXImage … @325,260 735×572`。
- **同一个状态在不同运行里形状不同**：终态在出生首跑里是 `AXImage … @325,260`，在
  `test-results/m190/26-calibration-runs-2026-09-21/ax/05-倒序回来看图.txt` 与
  `test-results/m190/26-pass-2026-09-21/ax/04-倒序回来看图.txt` 两次运行里都是 `AXGroup` + 子文本——
  三处同期的截图（各自的 `shots/04-倒序回来看图.jpeg`）里图片都**画得完整**（贴满栏宽、三色分带齐全、
  比例正确）。

⇒ 形状是 WebKit 的 AX 曝光细节，不是渲染质量的信号，任何以形状为前提的断言都会随机 FAIL。因此本场景
**只保留与形状无关的在场断言**（`ax.has` 匹配 alt 串，两种形状都命中），并删掉了原先两条形状相关断言：

- `ax: { has: "svg 滚动夹具" }`（借 `20-image-fallback.md` 的规则，原意是证「图真的画出来了」）——
  只在 `AXGroup` 形状下成立；
- `ax: { count: { pattern: "/AXImage … @… w×h/" } }`（宽度 = 栏宽、高度按固有比例）——只在 `AXImage`
  形状下成立。

**「图渲染完整」因此落在别处判**：chromium 层（M182 的宽度不变量：`23-image-first-open-width` 一族
+ [tests/visual/scenes/m187-image-scroll-stability.spec.ts](../../../tests/visual/scenes/m187-image-scroll-stability.spec.ts)
的重建路径）、`20-image-fallback.md` 的真机几何读数（那边用的是**不带 `<text>`** 的夹具 svg，其
`AXImage` 形状在多轮真机 run 里一直稳定）、以及本场景 `shots/` 的截图证据（人可读，Alex 抽审用）。

## 驱动与落点的口径

- **驱动用 ⌃V / ⌥V**（app 自己的翻屏键，`src/keys.ts` 的 `editor.scroll-page-down/up`，只滚视口
  不动光标）。套件没有滚轮动作（`lib/execute.mjs` 的动作表里没有 scroll），所以「慢速倒序滚动」
  在这条通道上表达不了；翻屏键是这条通道能做到的「倒序滚动」。两个键都要求编辑器持有渲染层焦点，
  因此先 `clickEditor`。
- **步长与落点**：步长 = `scroller.clientHeight − 2×行高`（`src/editor.ts` 的 `scrollPage`），真机
  1200×800 窗口下实测约 585px（clientHeight ≈633px）；到两端后继续按是空操作（浏览器把 scrollTop
  夹在 `[0, max]`，所以「正向到底」用多按几次表达，不去数到刚好）。
- **夹具按三段约束设计**（真机 1200×800 下实测：段块高 ≈27px、可见区高 ≈633px、一屏 ≈585px）：
  1. **图片上方 78 段**（≈2100px）保证图片落在**初始渲染视口之外**。CM 视口 = 可见区 ± 1000px（margin
     的上下分配随滚动状态变，最坏情况 1000px 全在可见底之下 ⇒ 视口底 = 633 + 1000 = 1633px），78 段
     给的 ≈2100px 留了约 470px 余量（实测：起点那次 AX 里图片节点不存在）。
  2. **图片下方 70 段**（≈1900px）保证**到底时图片已被销毁**。「到底」那次的视口下沿 = 可见顶 − 1000px，
     图片行底边距文末 1900px > 633 + 1000 = 1633px，整行落在渲染视口之外。（2026-09-21 第一次校准
     只放 38 段 ≈1045px，图片行底边距文末 1587px < 1633px，图片仍被渲染 ⇒ 那一步 FAIL，读数见证据
     目录 `ax/03-*.txt`：`AXImage (![滚动大图](…)) @339,-977`——图片在可见区上方约 1000px 处仍被渲染。）
  3. **倒序三屏**（≈1755px）把图片带回**可见区**：图片行距文末约 2470px，三屏后图片行落在视口上部
     （证据 `shots/` 的「倒序回来看图」）。
  正向三屏先把图片带进渲染视口（断言它在场 + 加载中状态已退场＝几何已进会话记忆），再八屏到底
  （断言它不在场；到底后多余按键是空操作）。若窗口尺寸/字体度量变化导致落点漂移，**调
  `svg-scroll.md` 的段落数**，不要放宽断言。
- **终态「图渲染完整」不在本通道判**（几何读数依赖不稳定的 AX 节点形状），判据面见上一节「覆盖边界」；
  本场景对终态只判「替换区在场 + 图片行仍被装饰 + 不在加载中」，并由 `shots/` 留人可读的截图证据。
