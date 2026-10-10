# 列表渲染归属合同（list rendering attribution）

> 状态：新增（M421，2026-10-10）。本文档是**列表行在 live preview 里的渲染归属**的质量合同：
> 可被测试证伪的不变量条款。渲染/交互缺陷修复的「合同先行」规则见
> [../process/rendering-defect-contract-first.md](../process/rendering-defect-contract-first.md)——
> 定位到本文件某一条、配不变量级属性测试，两者与修复同 PR。
> 列表的**标记外观**（glyph / 复合编号 / 字号档 / 悬挂缩进像素）不在本文件，见
> `src/preview/lists.ts` 与 `src/preview/theme.ts` 的 `.cm-lp-list-*` 规则；
> 列表的**解析语义**（CommonMark 归属）不在本文件——本文件只约束**渲染归属**。
> 相关 living spec（requirement 层）：`openspec/specs/editor-live-preview/spec.md`
> 「Markdown 渲染保真」（引用内列表）与 M399 的「空行渲染不变量」。

## 适用范围

输入分布是**文档里紧邻列表项的行**（条款引用分布，不引用具体案例）：

- **列表类型**：无序（`-` / `*` / `+`）、有序（`1.` / `2)`）、任务列表（`- [ ]`）；
- **嵌套深度**：1 层及更深，父项可以是 ul 或 ol；
- **该行与项之间**：紧邻（无空行）vs 隔一个空行；
- **该行的行首**：文档第 1 列即非空白（无源码缩进）vs 行首有 1–3 个空格 / 更深缩进；
- **语法树归属**：该行被解析为**列表项内的段落**（CommonMark lazy continuation）vs 顶层段落。

## 术语

- **项首行**：携带列表标记（marker）的那一行。
- **真续行**：与项之间无空行、且**行首带源码缩进**（文档第 1 列是空白）的项内段落行，
  如 `- a\n  x` 的第二行。
- **lazy continuation 行**：与**上一个列表项行**之间无空行、**行首无源码空白**
  （该行第一个字符即非空白，位于文档第 1 列）、且语法树把它解析进该列表项内段落的那一行
  （CommonMark 的 lazy continuation）。`- a\nx` 的第二行即此形态。

## 不变量

### L1 — lazy continuation 行按顶层段落渲染在行首

**任意** lazy continuation 行，live preview SHALL 把它按**顶层段落**渲染：该行文本的第一个
字符与光标 MUST 出现在**正文左缘**（与该文档里任一顶层段落行文本的左缘相同 x），MUST NOT
继承列表项的正文缩进（即 MUST NOT 施加 `--lp-list-body` 的 `padding-inline-start`）。

### L2 — 真续行与项首行的渲染不变

- **任意**真续行（行首带源码缩进、解析进列表项内段落），SHALL 保持项内渲染：行首源码空白
  SHALL 被隐藏、文本左缘 SHALL 落在**项正文起点**（正文左缘 + 该项组的 `--lp-list-body`），
  MUST NOT 按顶层段落渲染。
- **任意**项首行（marker 行），SHALL 保持标记渲染（marker 换 glyph / 复合编号、悬挂缩进），
  MUST NOT 因其项内段落的归属而落到 L1。

### L3 — 判定与光标位置无关

L1/L2 的渲染归属 MUST NOT 依赖光标 / 选区是否在该行上：同一文档在「光标在该 lazy 行上」
与「光标在别处」两种状态下，该行的文本左缘 MUST 相同。

### L4 — 渲染归属不改写文档

L1/L3 的实现 MUST NOT 改写文档源码（ADR 0003 §3 铁律）：上文各行的源码形态（含 lazy 行
第 1 列的字符）在渲染前后逐字节相同，「行归属变普通段落」只是渲染层事件。

## 证伪方式（属性测试口径）

对「列表类型 × 嵌套深度 × 与项之间有无空行 × 行首缩进 × 语法树归属」的输入分布逐个取样：

1. **几何**（chromium，`tests/visual/scenes/lists.spec.ts`）：取目标行**文本第一个字符**的
   `getBoundingClientRect().x`，断言 L1 行与顶层段落行同 x、L2 行 = 正文左缘 +
   `--lp-list-body`；再在同一次渲染里把光标移到该行上复测，断言 L3（两次读数相同）。
2. **归属**（单元，`tests/unit/list-lazy-continuation.test.ts`）：用**真 lezer 解析器**对同一
   输入分布解析，断言渲染归属判定（`src/preview/lists.ts` 的 `listLineInfo`）对 lazy 行给出
   「按普通段落」、对真续行给出「项内」——反向用例（带缩进的续行 MUST 仍项内）与
   「语法树确实归属 ListItem」同在一处，防止判定退化成「无条件关掉续行缩进」。
3. **反向验证**：把判定条件临时改回缺陷形态（lazy 行也施 `--lp-list-body`），几何断言 MUST
   变红；不变红即说明该断言对该缺陷无区分度，不算覆盖。

## 与实现的关系

- 判定的**单一真源**是 `src/preview/lists.ts` 的 `listLineInfo`（纯函数，不碰 view、不碰坐标）；
  `ListLayout.build()` 与单元测试共用它（REVIEW.md 第 8 条：同语义不得两处写值）。
- 渲染归属不改文档语义：lazy 行在 CommonMark 意义上**仍属**该列表项（渲染层与解析层在此
  分道）。Lumir 当前无独立 reading view，因此该行不会有任何视图按 CommonMark 缩进呈现——
  这是「与 Obsidian live preview 编辑层一致」的**知情取舍**（对照口径见上文「适用范围」的
  来源：Obsidian 1.14.4 live preview 把 `- a\nx` 渲染在顶层左边距，其 reading view 才缩进）。
- 真机行为层（`scripts/acceptance/scenarios/120-*.md`）判**文档终态**（源码第 1 列、无补分隔
  空行）与**屏幕上的字符列**（`pixel.contrast` 在字符列采样，点与阈值由截图实测标定，带修前红
  对照）；精确的文本左缘 x 坐标归上面第 1 点的 chromium 场景（真机取色只到「这一列有没有字
  形」这一档，套件 AX 不暴露行级几何，见其 README「已知边界」）。

## 已知边界（v1 未覆盖，如实登记）

1. **引用块内的 lazy continuation**（`> - a` 后紧邻 `> b`）不在 v1 判据内：lazy 判据取
   「文档第 1 列非空白」，而引用行以 `>` 起首、第 1 列恒非空白——该形态保持既有渲染
   （项内缩进），与正文里的同一形态暂不一致。**对照**：Obsidian 1.14.4 live preview 把
   `- a\nx` 渲染在顶层左边距（本条的来源），引用内的同形态未做对照。
2. **lazy 行带 1–3 个空格缩进**（CommonMark 允许的 lazy 行缩进区间，如 `- a\n x`）不在 v1
   判据内：判据是「行首无源码空白」，带缩进的这一档落到 L2 的项内渲染（与既有行为一致）。
   两处边界合起来是「v1 只覆盖 Alex 报告的形态（退出后行首必无空白）」的知情收窄。
