# 编辑器光标（质量合同）

> 状态：**accepted**（2026-10-23 Alex 裁决 D3「按倾向」，即按
> [proposal](../../openspec/changes/cursor-visibility-oct23/proposal.md) 与
> [design](../../openspec/changes/cursor-visibility-oct23/design.md) §2 的条款原文落地）。
> 来历：两条用户痛点——「当点击 frontmatter 时，光标特别高」「光标太细，不容易快速一眼扫到」。
> 前者是渲染缺陷，按 [渲染缺陷合同先行规则](../process/rendering-defect-contract-first.md)
> 处置：先定位不变量条款与属性测试，禁止只做案例级补丁；后者是视觉决策（D2=A：2px 常亮）。
>
> 本文件是**不变量条款**的居所。条款不引用具体案例，实现与测试按条款的输入分布扫维度。

## C1 — 光标矩形的高度 = 所在可见文本行的行盒高度

对**任意** md 文档、选区、主题与字号档：若 `drawSelection()` 画出了光标矩形，该矩形 SHALL
落在一条**可见文本行**的几何范围内，其高度 MUST 等于该行行盒的高度（同一字形度量下，容差
±1px）。光标矩形 MUST NOT 取任何**被块级 replace 装饰覆盖的源范围**的总高度（该范围可跨
多行，其替换面高度与行高没有对应关系）。若某光标位置没有任何可见文本行承载（位置落在渲染态
的替换块内或边界），系统 SHALL 在绘制前二选一：**显露该块的源码**、使光标所在源行可见，或
**把光标移到相邻的可见文本位置**；MUST NOT 在替换块的渲染面上绘制光标。

## C2 — 替换块的指针入口

渲染态的块级 replace 面（frontmatter properties、块级公式、mermaid 图表）MUST 消费
`mousedown`（`preventDefault`，MUST NOT 让原生选区滞留在 `contenteditable=false` 岛边缘）。
有对应源码的渲染面（frontmatter properties 盒、块级公式、mermaid 图表）SHALL 显露该块源码，
并把空光标放在点击位置对应的源行内；frontmatter 内没有对应源码的合成面（折叠的 doc-title、
纯装饰 padding）SHALL 只把焦点交给编辑器，光标按 C3 规范化到可见位置。任何入口 MUST NOT
改写文档。

## C3 — 装载与聚焦的初始光标

以 frontmatter 开头的 md 文档装载后，初始空光标 SHALL 位于该块之后的第一条可见文本行行首
（存在时）；不存在正文行时，编辑器获得焦点后 SHALL 显露 frontmatter 源码并把光标放到块内
可见源行。编辑器获得焦点时，若当前空光标位于已渲染 frontmatter 块的边界上，系统 SHALL 按
本条的规则规范化（有正文行 → 正文首行；无 → 显露源码）；MUST NOT 在聚焦后留下覆盖替换块
高度的光标矩形。除上述入口外，任何事务（含 `editor.goto-line` 的行首落点、程序化选区）把
空光标放到已渲染 frontmatter 块的边界上时，系统 SHALL 同样按本条的规则规范化（有正文行 →
正文首行；无 → 块内显露）；垂直移动事务归 C4 处理；装载事务除外——它由装载路径显式处理。

## C4 — 键盘垂直移动不落在替换块渲染面

垂直移动（↑↓ / ⌃P⌃N，含扩选）跨越块级 replace 时，落点 SHALL 是行进方向上的**最近可见
源码行**（钳制进块内并显露出该块），MUST NOT 停在渲染态替换块的边界上；同时 MUST NOT 一次
跨过整块（M110 的既有意图保留：块不被一步跳过）。

## C5 — 显露与光标规范化不改写文档

C1–C4 的显露、光标移动与装饰重建 MUST NOT 改写文档：`EditorState.doc` 与磁盘文件在操作前后
逐字节不变（ADR 0003 §3）。这条是既有铁律在本合同的复述，作为属性测试的公共断言。

## 条款的输入分布（属性测试口径）

条款不引用具体案例，测试 fixture 必须扫这些维度：

| 维度 | 取值 |
|---|---|
| frontmatter 形状 | 无 fm（对照）· 1 行 · 3 行 · 20 行 · 512 行（`MAX_FRONTMATTER_LINES` 上限）· 空 fm（`---\n---`）· 非法 YAML 回退 · 只有 fm 无正文 · fm + 正文 |
| doc-title | 有文件路径（折叠标题 + meta）· 无路径（无标题） |
| 入口 | 点击 properties 上 / 中 / 下三分之一 · 点击 doc-title 标题行 / meta 行 · 点击 outer padding · 点击正文（对照）· Tab 聚焦 · 装载后聚焦 · 浮层关闭交还焦点（程序化 `focus()`）· ↑ / ⌃P 从正文首行 · ↓ / ⌃N 从末段进入正文 · Shift+↑ 扩选 · 拖拽覆盖块的一部分 · ⌘A |
| 主题 | light · dark · eink |
| 字号 | 15px（出厂）· 32px（配置上限） |
| 文档位置 | fm 在文档首（唯一合法位置）；长文档滚动到中段后回到篇首；只有 fm 的短文档 |

## 实现落点（条款 ↔ 代码的单向指针）

| 条款 | 落点 |
|---|---|
| C1 | `src/editor.ts` 的 `baseTheme`（光标宽度 / 常亮）；边界光标消除见 C2–C4 |
| C2 | `src/preview/replaced-source.ts`（三类块共用的指针入口）；`FrontmatterWidget` 的 mousedown 路由（`src/preview/frontmatter.ts`） |
| C3 | `firstBodyLineStart` / `normalizeFrontmatterCaret` / `frontmatterCaretSpecs`（`src/preview/frontmatter.ts`）；装载路径 `initialCaretState` / `normalizeInitialCaret`（`src/editor.ts`）；focus 处理器（`src/preview/livePreview.ts`） |
| C4 | `clampAcrossBlockWidgets`（`src/editor.ts`）与 `frontmatterCaretSpecs` 的垂直移动分支 |
| C5 | 全链路只 dispatch 选区，不改文档 |

光标视觉的**组件常量**：宽度 2px、常亮（无闪烁）、三主题同值（eink 同宽同色）。颜色取
`--text`，不新增 token；常亮覆盖的是 CM 基础主题挂在 `.cm-cursorLayer` 上的
`steps(1) cm-blink 1.2s infinite`（一半时间 `opacity: 0`——「一眼扫不到」的第二个成因）。
取值登记与理由见 [design-tokens-v1.md](design-tokens-v1.md) 的「阴影与 hairline」节。

## 属性测试与验证层

| 层 | 位置 | 判据 |
|---|---|---|
| 纯判定矩阵 | `tests/unit/frontmatter-caret.test.ts` | `firstBodyLineStart` 的输入网格；`frontmatterCaretSpecs` 的分流（边界 / 块内 / 块外 × 空 / 非空选区 × 垂直移动 / 普通事务 / 装载事务） |
| 几何 / 计算样式 | `tests/visual/scenes/m647-caret-geometry.spec.ts` | 光标矩形高度 = 所在可见行行盒 ±1px，且小于 `.cm-lp-frontmatter-outer` 高度（区分度对照）；`borderLeftWidth` = 2px、颜色 = `--text`、`marginLeft` = -1px、`animationName` = none |
| 真机 | `scripts/acceptance/scenarios/228-caret-visibility.md` | 点击 properties / doc-title 后 properties 撤下、标题让位、文档字节不变；光标高度归手感项（AX 不暴露 caret 几何） |
