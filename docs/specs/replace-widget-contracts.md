# replace 装饰构造的责任合同

> 适用面：`src/**/*.ts` 里所有 `Decoration.replace(...)` 构造——包括纯隐藏 `{}`、带 `widget`
> 的替换、`block: true` 的块级替换，以及 `widget` 为工厂调用 / 简写属性的形态。
>
> 本文是人读版本；机器判据的真源是 `tests/unit/replace-widget-registry.test.ts` 的 `REGISTRY`。
> 来源：2026-11-27 编辑器治理复盘（Alex 采纳）的 P0 项「replace widget 注册表 + 设计闸门」，
> 以及 [渲染/交互缺陷合同先行规则](../process/rendering-defect-contract-first.md)。
>
> 实现居所（均为既有）：显露判据 `src/preview/reveal-gate.ts` 与 `src/preview/lists.ts` 的
> `lineTouchesSelection`；块级指针入口 `src/preview/replaced-source.ts`；原生编辑闸门
> `src/editor.ts` 的 `absorbNativeEdit`；组合生命周期 `src/composition-settle.ts`。

## 为什么需要这份合同

replace 装饰同时决定六件事：源码是否可见、指针落在哪里、只读会话能否改动、原生编辑会不会把
渲染文本写回文档、谁写几何、IME 组合期谁收口。它们今天分散在 5 个 replace 构造文件与各自的 widget / 几何实现里，**没有任何机制强制
新构造先回答**——reviewer 没想到某种构造，新 widget 就带着未定义的显露 / 指针 / 原生编辑语义
进入产品。

滚动条分档与文本输入面已用同一形态解决过同类问题：把判据反过来，凡命中结构特征者都必须先在
注册表归位；注册表与源码双向对账，新增未登记即红，登记了但源码里已不存在（僵尸条目）也红。
本条沿用同一形态，不新增依赖，不复制运行时实现。

## 不变量

### R1 — 每个 replace 站点恰好一条登记

静态扫描 `src/**/*.ts` 的全部 `Decoration.replace(...)` 调用。每个站点 MUST 在 `REGISTRY`
里恰好对应一条登记；未登记即判红，并列出站点的文件、所属函数、widget 类、span 与同组序号。

### R2 — 登记条目必须仍能落到源码

每条登记 MUST 在源码里找到对应站点（文件 + 所属函数 + widget 类 / 纯隐藏 + inline/block +
同组出现序号全部相符）。改名、删除、换 widget 类、改 span、同组内插入 / 删除 / 换序导致的
僵尸条目与序号漂移 MUST 判红。站点定位 MUST NOT 使用行号——行号会随无关改动漂移。

### R3 — 注册表只分配责任，不复制运行时实现

每条登记 MUST 声明七项责任：span、显露策略、指针 / 只读策略、原生编辑策略、几何写入者、
IME 策略、测试指针。

- 原生编辑策略 MUST 指向共享 state 闸门 `src/editor.ts` 的 `absorbNativeEdit`；该闸门只读
  `EditorState`，不识别 widget 类型、不读 DOM / AX 形状。`src/preview/**` MUST NOT 出现
  `beforeinput` 监听——给新 widget 补一份局部闸门是禁止形态。
- 显露策略 MUST 指向既有的显露谓词（`touchesSource` / `rangeRevealsSource` /
  `touchesSelection` / `lineTouchesSelection` / 构造自己的选区重叠判定），或明确声明
  「恒渲染、不显露」。注册表 MUST NOT 提供 `shouldReveal()` 之类的第二套判定。
- 指针入口 MUST 是既有的 `enterReplacedSource` / 链接跟随 / 图片动作，或明确声明不消费。
- IME 策略 MUST 是共享组合生命周期（`scheduleCompositionSettle` + `compositionSettled`）或
  编辑器的原生组合路径；MUST NOT 出现 widget 自有的组合生命周期。

### R4 — 字段锚点与测试指针必须可解析

每个责任字段 MUST 带至少一个锚点：代码符号（精确标识符）、CSS 选择器，或测试 / 验收场景
路径。锚点对应的文件与文本 MUST 在仓库里当下存在；测试指针 MUST 是当下存在的单测、视觉场景
或验收场景。锚点失效即判红——不允许把字段写成不再指向任何实现的死字符串。

### R5 — 新构造先登记，再实现

新增 replace 构造 SHALL 在同一变更内先登记、再实现；MUST NOT 先加构造等评审发现问题。
`Decoration.replace` MUST NOT 被别名引用（`const replace = Decoration.replace`、解构
`const { replace } = Decoration`、把属性访问结果存进变量等）——别名会让静态扫描失明，
判据随之失效。

**边界（如实登记）**：静态扫描只认直接调用 `Decoration.replace(...)` 的形态；第三方库内部
构造、动态属性访问（如 `Decoration["replace"]`）不在判据内。别名已由 R5 判红兜底；其余形态
当前不存在，出现时应先扩扫描器而不是绕过。

## 登记清单

定位列的口径：`文件 · 所属函数 · widget 类（`hide` = 纯隐藏）· 同组序号`。序号只在同一
`(文件, 函数, widget, span)` 组内计数，从 1 开始；同组内插入 / 删除 / 换序会让后续序号后移，
判红并强制重新登记。

**原生编辑列全为「共享」**：29 条都指向 `src/editor.ts` 的 `absorbNativeEdit`，值逐条登记在
`REGISTRY` 的 `nativeEdit` 字段；下表不逐行重复。几何列给承担该构造纵向 / 横向几何的模块或
样式规则；IME 列「共享」= `scheduleCompositionSettle` / `compositionSettled`，「原生」= 交给
编辑器的组合路径。

| id | 定位（文件 · 函数 · widget · #） | span | 显露 | 指针 / 只读 | 几何写入者 | IME | 测试指针 |
|---|---|---|---|---|---|---|---|
| `callout-label` | `callout.ts` · `calloutMarkerDecorations` · `CalloutLabelWidget` · 1 | inline | 行严格重叠：callout 首行被选区触及即显示 `[!type]` 源码 | 不消费；只读同左 | `theme.ts` `.cm-lp-callout-type` | 原生 | `tests/visual/scenes/callout.spec.ts`、`tests/visual/scenes/m119-callout-source.spec.ts` |
| `list-marker-first` | `lists.ts` · `ListLayout.build` · `ListMarker` · 1 | inline | 恒渲染：真列表项首行 marker 不看选区 | 不消费；只读同左 | `lists.ts` `ListMarker.coordsAt` + `--lp-list-marker` | 共享 | `tests/unit/list-indent.test.ts`、`tests/visual/scenes/lists.spec.ts` |
| `list-continuation-indent` | `lists.ts` · `ListLayout.build` · `hide` · 1 | inline | 恒渲染：真续行行首缩进不看选区 | 不消费；只读同左 | `lists.ts` 行样式 `--lp-list-body` | 共享 | `tests/unit/list-lazy-continuation.test.ts`、`scripts/acceptance/scenarios/120-list-lazy-continuation-indent.md` |
| `list-marker-bare` | `lists.ts` · `ListLayout.build` · `ListMarker` · 2 | inline | 行相接：裸 marker 行进入编辑态才渲染 | 不消费；只读同左 | `lists.ts` `ListMarker.coordsAt` | 共享 | `tests/unit/ordered-list-auto-mode.test.ts`、`tests/visual/scenes/lists.spec.ts` |
| `list-setext-shield` | `lists.ts` · `ListLayout.build` · `SourceShield` · 1 | inline | 行相接：setext 候选行进入编辑态才屏蔽 `- ` | 不消费；只读同左 | `lists.ts` 行样式（不另加几何） | 共享（组合删除的原子节点） | `tests/unit/ordered-list-auto-mode.test.ts`、`scripts/acceptance/scenarios/271-ime-list-composition-wkwebview.md` |
| `frontmatter-block` | `livePreview.ts` · `frontmatterSet` · `FrontmatterWidget` · 1 | block | 区严格重叠：选区与块源码重叠即显示 YAML | 点击 properties 盒入源；只读同左（仅改选区） | `theme.ts` `.cm-lp-frontmatter-outer` | 原生 | `tests/visual/scenes/doc-title.spec.ts`、`tests/unit/frontmatter-caret.test.ts` |
| `table-gap-start` | `livePreview.ts` · `collectTableDecorations` · `hide` · 1 | inline | 恒渲染：grid 行首到首 cell 的间隙保持隐藏 | 不消费；只读同左 | `livePreview.ts` `tableWrappers` | 原生 | `tests/visual/scenes/m119-table-width.spec.ts`、`tests/visual/scenes/table-foundation-v2.spec.ts` |
| `table-empty-cell` | `livePreview.ts` · `collectTableDecorations` · `EmptyTableCellWidget` · 1 | inline | 恒渲染：空 cell 占位不看选区 | 不消费；只读同左 | `style.css` `.cm-lp-table-cell-empty` | 原生 | `tests/visual/scenes/m119-table-math.spec.ts`、`tests/visual/scenes/table-foundation-v2.spec.ts` |
| `table-gap-end` | `livePreview.ts` · `collectTableDecorations` · `hide` · 2 | inline | 恒渲染：末 cell 到行尾的间隙保持隐藏 | 不消费；只读同左 | `livePreview.ts` `tableWrappers` | 原生 | `tests/visual/scenes/m119-table-width.spec.ts`、`tests/visual/scenes/table-foundation-v2.spec.ts` |
| `table-separator-row` | `livePreview.ts` · `collectTableDecorations` · `hide` · 3 | inline | 恒渲染：分隔行整行隐藏 | 不消费；只读同左 | `livePreview.ts` `tableWrappers` | 原生 | `tests/visual/scenes/m119-table-width.spec.ts`、`tests/visual/scenes/table-foundation-v2.spec.ts` |
| `quote-mark` | `livePreview.ts` · `hideMark` · `hide` · 1 | inline | 行严格重叠：引用行被选区触及即显示 `>` | 不消费；只读同左 | `block-geometry.ts` `lineShapes` | 原生 | `tests/visual/scenes/render-quote-list.spec.ts`、`tests/unit/live-preview-reveal-gate.test.ts` |
| `heading-marks` | `livePreview.ts` · `collectSyntaxDecorations` · `hide` · 1 | inline | 行含端点相接：标题行被触及即显示 `#` | 不消费；只读同左 | `block-geometry.ts` `lineShapes` | 原生 | `tests/visual/scenes/m297-heading-caret-source.spec.ts`、`tests/unit/syntax-envelope.test.ts` |
| `emphasis-marks` | `livePreview.ts` · `collectSyntaxDecorations` · `hide` · 2 | inline | 范围含端点相接：强调范围被触及即整段显示源码；callout 内容行另有行级显露 | 不消费；只读同左 | `block-geometry.ts` `lineShapes` | 原生 | `tests/visual/scenes/m168-emphasis-caret-source.spec.ts`、`tests/unit/syntax-envelope.test.ts` |
| `horizontal-rule` | `livePreview.ts` · `collectSyntaxDecorations` · `HorizontalRuleWidget` · 1 | inline | 行严格重叠：分隔线行被触及即显示 `---` | 不消费；只读同左 | `theme.ts` `.cm-lp-hr` | 原生 | `tests/visual/scenes/render-hr.spec.ts`、`tests/visual/scenes/m110-interaction.spec.ts` |
| `link-marks` | `livePreview.ts` · `collectSyntaxDecorations` · `hide` · 3 | inline | 节点严格重叠：链接范围被触及即整条显示源码 | 点击跟随链接；只读同左 | `block-geometry.ts` `lineShapes` | 原生 | `tests/visual/scenes/render-link.spec.ts`、`tests/unit/literal-link.test.ts` |
| `autolink-brackets` | `livePreview.ts` · `collectSyntaxDecorations` · `hide` · 4 | inline | 节点严格重叠：裸 URL / 角括号链接被触及即显示源码 | 点击跟随链接；只读同左 | `block-geometry.ts` `lineShapes` | 原生 | `tests/visual/scenes/render-link.spec.ts`、`tests/unit/literal-link.test.ts` |
| `image-remote` | `livePreview.ts` · `buildStandardImage` · `ImageWidget` · 1 | inline | 恒渲染：远程引用永远走占位终态，不显露源码 | 不消费（远程占位没有 `<img>`，无放大 / 引用路径）；只读同左 | `attachments.ts` `knownGeometry` / `imageReserve` | 原生 | `tests/unit/image-widget.test.ts`、`tests/visual/scenes/m182-image-first-open-width.spec.ts` |
| `image-notice-standard` | `livePreview.ts` · `buildStandardImage` · `AttachmentNoticeWidget` · 1 | inline | 恒渲染：未接线附件提示不显露源码 | 不消费；只读同左 | `theme.ts` `.cm-lp-embed-unsupported` | 原生 | `tests/unit/image-widget.test.ts`、`tests/visual/scenes/render-markdown.spec.ts` |
| `image-local` | `livePreview.ts` · `buildStandardImage` · `ImageWidget` · 2 | inline | 恒渲染：本地图片永远渲染，不显露源码 | 双击放大 + 引用钮；只读同左 | `attachments.ts` `knownGeometry` / `imageReserve` | 原生 | `tests/unit/image-widget.test.ts`、`tests/visual/scenes/m633-image-quote.spec.ts` |
| `wikilink-embed-fallback` | `livePreview.ts` · `buildWikilink` · `buildWikiEmbedWidget` · 1 | inline | 恒渲染：无解析器时的嵌入降级不看选区 | 图片动作 / 提示不消费（按工厂返回值）；只读同左 | `theme.ts` `.cm-lp-embed-unsupported` | 原生 | `tests/visual/scenes/wikilink.spec.ts`、`scripts/acceptance/scenarios/865-wikilink-caret-reveal-nov24.md` |
| `wikilink-notice-unsupported` | `livePreview.ts` · `buildWikilink` · `AttachmentNoticeWidget` · 1 | inline | 恒渲染：块引用不支持提示不显露源码 | 不消费；只读同左 | `theme.ts` `.cm-lp-embed-unsupported` | 原生 | `tests/visual/scenes/wikilink.spec.ts`、`scripts/acceptance/scenarios/865-wikilink-caret-reveal-nov24.md` |
| `wikilink-notice-unresolved` | `livePreview.ts` · `buildWikilink` · `AttachmentNoticeWidget` · 2 | inline | 恒渲染：缺失嵌入提示不显露源码 | 不消费；只读同左 | `theme.ts` `.cm-lp-embed-unsupported` | 原生 | `tests/visual/scenes/wikilink.spec.ts`、`scripts/acceptance/scenarios/865-wikilink-caret-reveal-nov24.md` |
| `wikilink-notice-note` | `livePreview.ts` · `buildWikilink` · `AttachmentNoticeWidget` · 3 | inline | 恒渲染：笔记嵌入不支持提示不显露源码 | 不消费；只读同左 | `theme.ts` `.cm-lp-embed-unsupported` | 原生 | `tests/visual/scenes/wikilink.spec.ts`、`scripts/acceptance/scenarios/865-wikilink-caret-reveal-nov24.md` |
| `wikilink-notice-provider` | `livePreview.ts` · `buildWikilink` · `AttachmentNoticeWidget` · 4 | inline | 恒渲染：附件 provider 未接线提示不显露源码 | 不消费；只读同左 | `theme.ts` `.cm-lp-embed-unsupported` | 原生 | `tests/visual/scenes/wikilink.spec.ts`、`scripts/acceptance/scenarios/865-wikilink-caret-reveal-nov24.md` |
| `wikilink-image` | `livePreview.ts` · `buildWikilink` · `ImageWidget` · 1 | inline | 恒渲染：嵌入图片永远渲染，不显露 `![[...]]` | 双击放大 + 引用钮；只读同左 | `attachments.ts` `knownGeometry` / `imageReserve` | 原生 | `tests/visual/scenes/wikilink.spec.ts`、`scripts/acceptance/scenarios/865-wikilink-caret-reveal-nov24.md` |
| `wikilink-link` | `livePreview.ts` · `buildWikilink` · `WikilinkWidget` · 1 | inline | 节点严格重叠：普通 wikilink 被触及即显示源码 | 点击入源；只读点击恢复原选区与焦点 | `theme.ts` `.cm-lp-wikilink` | 原生 | `tests/visual/scenes/wikilink-caret-reveal.spec.ts`、`scripts/acceptance/scenarios/865-wikilink-caret-reveal-nov24.md` |
| `inline-math` | `math.ts` · `collectInlineMath` · `InlineMathWidget` · 1 | inline | 区严格重叠：选区与公式范围重叠即显示 `$...$` | 点击入源；只读同左 | `math.ts` `InlineMathWidget`（行内固有几何，无额外 CSS） | 原生 | `tests/visual/scenes/math.spec.ts`、`tests/visual/scenes/m111-math-interaction.spec.ts` |
| `block-math` | `math.ts` · `mathBlockSet` · `BlockMathWidget` · 1 | block | 区严格重叠：选区与块范围重叠即显示 `$$...$$` | 点击入源；只读同左 | `style.css` `.cm-lp-math-block` | 原生 | `tests/visual/scenes/math.spec.ts`、`scripts/acceptance/scenarios/02-math-click.md` |
| `mermaid-block` | `mermaid.ts` · `mermaidBlockSet` · `MermaidBlockWidget` · 1 | block | 区严格重叠：选区与块范围重叠即显示围栏源码 | 点击入源；只读同左 | `style.css` `.cm-lp-mermaid` | 原生 | `tests/visual/scenes/mermaid.spec.ts`、`tests/visual/scenes/m112-mermaid-click.spec.ts`、`scripts/acceptance/scenarios/01-mermaid-click.md` |

## 证伪方式

- **单元（静态对账）**：`tests/unit/replace-widget-registry.test.ts` 五组——
  ① 覆盖：每个扫描站点都在注册表；② 新鲜度：每条登记都能落到站点（含同组序号）；
  ③ 字段：span / widget / 七项责任齐全，策略值在受控词表内；④ 锚点：代码符号 / CSS 选择器 /
  测试路径当下存在；⑤ 单实现：原生编辑全指 `absorbNativeEdit`、`src/preview/**` 无
  `beforeinput`、`Decoration.replace` 无非调用位置。
- **反向输入**（区分度）：合成扫描结果分别造「缺登记 / 多登记 / 序号漂移 / 字段锚点失效 /
  别名引用」，逐条确认判红；另在真实源码里临时加一个未登记站点跑一次，确认报出该站点后删除。
- **行为面不在本层**：显露 / 指针 / 原生编辑 / IME 的运行时正确性由各条目的测试指针承担；
  注册表不证明行为正确，只保证责任被分配、且新构造不能再绕过准入面。
