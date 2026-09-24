---
id: "34-restyle-theme-skeleton"
item: 34
title: restyle 收尾：ui.theme=eink 经配置通道生效、骨架几何与信息落位在场、masthead 指纹不在场、验收 vault 文件哈希不变
fixtures: [keys.md]
open: keys.md
marker: "键位场景"
config: { theme: "eink" }
steps:
  - name: 配置通道的落盘证据（front-matter 的 config 经套件 writeConfig 通道在起 app 之前写好）
    do: settle
    expect:
      - label: 隔离 config.json 里 ui.theme = eink（配置面唯一入口；场景不自己贴 data-theme 属性）
        file: { path: "env:config.json", has: '"theme": "eink"' }
      - label: 反向：这份配置里没有 light（「读到了 eink」不是「读到了任意一份 config」）
        file: { path: "env:config.json", not: '"theme": "light"' }
      - shot: eink-首屏

  - name: 记录源文件基线（本场景不做任何写 vault 的动作，基线点因此只需在断言之前）
    do: record
    as: 场景文件
    file: keys.md
    expect:
      - label: 基线文件存在且可读（读不到一律 FAIL，不允许在空值上比较）
        file: { path: keys.md, exists: true }

  - name: 主题施加没有打断启动链路（应用带着 eink 配置照常把文档渲染出来）
    do: settle
    expect:
      - label: 编辑器已装载 fixture
        editor: { has: "键位场景" }
      - label: 文件树在场（骨架的侧栏区活着）
        ax: { has: "/AXPopUpButton \\(vault：lumir-m102-acceptance（点击查看全部 vault）\\)/" }

  - name: 骨架与信息落位（迁移后的承载点逐个正观测）
    do: settle
    expect:
      - label: vault 名在侧栏头（旧 masthead 的落点 1）
        ax: { has: "/AXPopUpButton \\(vault：lumir-m102-acceptance（点击查看全部 vault）\\)/" }
      - label: 当前文件路径在 modeline（旧 masthead 的落点 2；AX 把 modeline 左右两段合并成一条静态文本，故判「以文件名开头」）
        ax: { has: "/AXStaticText = \"keys\\.md [^\"]*Markdown/" }
      - label: modeline 右段的「语法 · 行数 · 编码」在场（本 change 新增的展示位）
        ax: { has: "/Markdown · \\d+ 行 · UTF-8/" }
      - shot: eink-骨架与信息落位

  - name: masthead 不在场（判据取旧 masthead 的**独有 AX 指纹**，不是「某段文字在不在」）
    do: settle
    expect:
      - label: 旧 masthead 的那一行（vault 名与文件路径合并成的同一条 AXStaticText）不存在
        ax: { not: "/AXStaticText = \"lumir-m102-acceptance keys\\.md\"/" }
      - label: 旧 masthead 的独有文案「未打开 vault」不存在（该串在本 change 后从 src/ 完全删除）
        ax: { not: "未打开 vault" }
      - label: 正观测：有一条静态文本**以文件名开头**且紧跟 modeline 右段（与上面那条「vault 名 + 路径」的旧合并形态互斥）
        ax: { has: "/AXStaticText = \"keys\\.md [^\"]*Markdown/" }
      - shot: masthead-不在场

  - name: 整轮前后验收 vault 文件哈希不变（ADR 0003 §3）
    do: settle
    expect:
      - label: keys.md 逐字节不变
        file: { path: keys.md, unchangedSince: 场景文件 }
      - label: keys.md 的 mtime 也未推进
        file: { path: keys.md, mtimeUnchangedSince: 场景文件 }
---

# restyle 收尾：主题通道 / 骨架落位 / masthead 移除（change restyle-ui-tokens-v1，tasks §9.1）

## 这个场景验什么

真机（WKWebView）上验四件在 chromium 层验不到、或只在真机上才成立的事：

1. **`ui.theme` 配置通道的落盘与启动**：主题经隔离 `config.json` 的 `[ui]` 表进来（front-matter 的
   `config: { theme: "eink" }` 走套件既有的 `writeConfig` 通道，与 `font_size` / `[keys]` 同形），
   应用带着它起得来、把文档渲染出来。
2. **骨架与信息落位的真机形态**：侧栏头（vault 名）、modeline 左（文件路径）、modeline 右
   （语法 · 行数 · 编码）三点在真实 AX 树里各自在场。
3. **masthead 移除**：旧标题区那一行的 AX 指纹不再出现。
4. **不写源文件**：整轮下来验收 vault 的文件字节与 mtime 不变（ADR 0003 §3）。

## 主题「生效」的机器判据到哪一层（如实登记，别把它读大）

本套件的通道是 AX 文本 / 编辑器文本 / 磁盘文件；**没有计算属性通道**（`scripts/acceptance/README.md`
的断言表），而主题的全部效应都是色值与线宽——两者都不进 AX。因此：

- **机器可判**：配置层（`config.json` 里 `ui.theme` 确实是 `eink`）+ 启动链路层（带这份配置起得来、
  文档渲染出来、骨架在场）。
- **截图可判（人眼）**：`shot` 落三张（eink 首屏 / 骨架与信息落位 / masthead 不在场），eink 下的
  底色与对比是**手眼项**——按 AGENTS.md「手感/审美不下沉」的口径，这一层交给 Alex 抽审。
- **结构层可判（另一层）**：`ui.theme` → `documentElement.dataset.theme` 的接线与三主题的取值由
  chromium 场景 `tests/visual/scenes/restyle-theme.spec.ts` 的计算属性断言守（那里有样式通道）。
  两句合起来才是「主题生效」的完整覆盖，任何一句单独用都会把结论说大（REVIEW.md 第 6 条）。

## masthead 不在场的判据为什么用「合并行」这条指纹

旧 masthead 的 DOM 是「vault 名 span + 文件路径 span + 大纲指示段 button」三件，AX 把它前两件
**合并成一条 AXStaticText**（真机实证：`- [8] AXStaticText = "lumir-m102-acceptance end-marker-long.md"`，
见 `test-results/acceptance/2026-09-21/27-document-end-marker/ax/`）。迁移后 vault 名进了侧栏头的
按钮、文件路径进了 modeline——**「vault 名与路径合并成一条静态文本」这条形态只可能由旧 masthead
产生**，因此它是可判定的移除指纹。

**modeline 的 AX 形态（M213 真机实测，写在这里供后来者省一轮）**：`.modeline-left`（路径）与
`.modeline-right`（语法 · 行数 · 编码）会被 AX **合并成同一条静态文本**，形如
`- [122] AXStaticText = "keys.md Markdown · 12 行 · UTF-8"`。因此判据写成「以文件名开头且紧跟右段」
（`/AXStaticText = "keys\.md [^"]*Markdown/`），而**不是**「存在 `AXStaticText = "keys.md"`」——
后者恒不成立（第一轮就是这么红的）。这条合并也顺带说明：旧 masthead 的指纹
（`"<vault 名> <路径>"`）与新形态（`"<路径> <右段>"`）在**同一条静态文本的两个不同位置**上，
两者互斥、可同时断言。

配套的两条让这条负向断言有区分度（REVIEW.md 第 1 / 2 条）：一条断言路径以**文件名开头**的静态文本
在场（正观测；若有人把三个信息又合并回一行，这条与上一条会同时响），一条断言旧 masthead 的独有文案
「未打开 vault」不存在。**边界**：真机层没有 DOM 通道，`rg -n 'masthead' src/` 零命中与
`.masthead` 选择器不存在由 `docs/process` 门禁（tasks §4.2 的验收口径）与
`tests/visual/scenes/restyle-skeleton.spec.ts` 承担。

## 已知边界

- eink 的**可见**确认依赖截图（见上）；本场景不声称「机器判出主题是 eink」。
- 「modeline 右段在场」的判据是文本形态正则（`Markdown · N 行 · UTF-8`）：行数取 `doc.lines`，
  fixture 改动会让 N 变而断言照绿——它守的是**派生接线**，不是某个具体数字。
- 本场景不覆盖：标题栏 overlay 形态（traffic 灯原生绘制 / 标题不显示 / 可拖拽）——那是窗口级证据，
  走 `35-restyle-three-themes` 与本批的 `test-results/m213/titlebar/` 读数。
