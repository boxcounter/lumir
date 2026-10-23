# Design: 光标可见性与 frontmatter 光标超高修复

- Change ID: `cursor-visibility-oct23`
- 日期: 2026-10-23

本文只写「怎么做到 proposal 里已裁的行为」与「为什么这样做」。代码锚点是起草时在本分支
（基于 master `1e148cb9`）逐一读过原文的位置；行号会漂，实现前以符号名为准。
本合同先行规则见 [rendering-defect-contract-first.md](../../../docs/process/rendering-defect-contract-first.md)。

## 0. 事实清单（起草时核对过原文）

| 事实 | 锚点 | 与本 change 的关系 |
|---|---|---|
| frontmatter 是块级 replace 装饰，覆盖 `[fm.from, fm.to]` | `src/preview/livePreview.ts:639-655` | 光标落在块边界时，CM6 用整块几何画光标 |
| doc-title 折叠进同一个 widget 的 outer | `src/preview/frontmatter.ts:145-156`；合同 I2 见 `tests/unit/doc-title-placement.test.ts:24-32` | 「块高度」包含标题与 meta；拆分会撞 M222 的两岛拓扑约束 |
| 现有显露判据 = 选区覆盖整块，只换 `--sel` 底色 | `src/preview/livePreview.ts:648`；`src/preview/theme.ts:185-188` | 与本 change 要统一的「严格重叠即显露」不同 |
| 公式 / mermaid 的指针入口 | `src/preview/math.ts:176-198`（`enterReplacedSource`）；`src/preview/mermaid.ts:366` | 直接复用的既有交互语汇 |
| 公式 / mermaid 的显露判据 | `src/preview/math.ts:308` / `:352`；`src/preview/mermaid.ts:421`（都是 `state.selection` 严格重叠） | frontmatter 改为同族口径（但保留 M259 快照） |
| 空光标的矩形高度 = `coordsAtPos` 的 top / bottom 之差 | `node_modules/@codemirror/view/dist/index.js:9292-9299` | 根因的直接落点 |
| block widget 的 `coordsAt` 返回整块 `getBoundingClientRect()` | 同文件 `:3249-3257`（`DocView.coordsAt`）、`:2122-2128`（`WidgetTile.coordsInWidget`） | 「整块高度」的来源 |
| 指针坐标 → 非文本块的边界位置（若该击走 CM 坐标路径） | 同文件 `:3829-3830` | 非文本块只会给出 `block.from` / `block.to` 两个位置 |
| widget 内事件默认被 CM 忽略 | 同文件 `:161`（`ignoreEvent` 默认 true）、`:4874`、`:7239` | 点击不走 CM 落点逻辑；选区可能停在装载预置的边界，或由原生选区读回边界 |
| 垂直移动的边界钳制 | `src/editor.ts:135-181`（`blockWidgetBoundaries` / `clampAcrossBlockWidgets`）、`:325-337`（`verticalTarget`） | 键盘路径也会把光标停在块边界 |
| 装载复位选区到 0 | `src/editor.ts:2301-2309`（`loadedState`）、`:2580-2597`（openFile 的 `dispatchTrusted`） | 有 frontmatter 时 0 = `fm.from` |
| 焦点交还路径 | `src/editor.ts:1272-1274`、`:2830-2843`（`focusPreservingReadingPosition`） | 把预置的边界选区显形 |
| 光标粗细 / 闪烁的现行值 | `node_modules/@codemirror/view/dist/index.js:6880-6925`；应用只覆盖颜色 `src/editor.ts:1834-1836` | 视觉改造的落点 |
| 三主题的 `--text` | `docs/specs/design-tokens-v1.md:57`；eink 线宽语汇 `:193-196` / 规则⑧ `:284-288` | D2 的取值依据 |
| living spec 的 frontmatter 显露句与缺口 | `openspec/specs/editor-live-preview/spec.md:11`（requirement 含 frontmatter）、`:40-43`（scene 未含 frontmatter） | 本 change 补 requirement / scenario |
| 评审纪律 | `REVIEW.md`「同一语义两处真源」「值或开关声明了却没有消费者」「覆盖声明超出真实验证」 | 实现与报告纪律 |

## 1. 根因链（完整版）

### 1.1 缺陷现场

Alex 的截图（本会话附件 `f_d1ac35ea-…png`，1456×426）里，光标是一条竖线，从 properties 盒
顶边一直画到 doc-title 的 meta 行底边（约 350px 高），而正文行高约 25px。竖线贴在块内容的
左缘，宽约 2–3 设备像素（1.2 CSS px 在 2× 屏上的量级）——这同时是「第 2 条太细」的现场读数。

### 1.2 几何链

1. **块边界 → 整块 rect**：光标位置在 `fm.from` / `fm.to` 时，`DocView.coordsAt` 把位置解析到
   `WidgetTile`，再走 `coordsInWidget(offset, side, true)`；block 分支不按字形量，直接拿
   `this.dom.getBoundingClientRect()`（`@codemirror/view/dist/index.js:2122-2128`），只把
   left / right 收成一条线（`flattenRect`，`:514-521`），top / bottom 原样保留。widget 的 DOM
   是 `.cm-lp-frontmatter-outer`，它包着 properties 盒与折叠的 doc-title（`frontmatter.ts:145-156`）。
2. **光标层 → 该 rect 的高度**：`RectangleMarker.forRange` 对空区间调用
   `view.coordsAtPos(head, assoc || 1)`，并把 `pos.bottom - pos.top` 直接当高度
   （`:9292-9299`）。于是「整块 rect 的高度」原封不动成为「光标高度」。
3. **位置怎么落到边界**：
   - **指针**：widget 内的 mousedown 默认被 CM 忽略（`ignoreEvent` 默认 true，`:161`），点击
     因此不走 CM 自己的落点逻辑。光标位置的现实路径有两条：① 选区仍是装载时预置的 0
     （下面「装载 / 聚焦」条）；② 浏览器把原生选区塌缩在 `contenteditable=false` 岛的边缘，
     CM 经 `selectionchange` 读回后落在 `fm.from` / `fm.to`。具体走哪一支未在真机逐帧区分；
     两支的后果相同。即便某一击被 CM 的坐标路径处理，非文本 block 也只会给出边界：
     `posAtCoords` 按 y 的上 / 下半返回 `block.from` / `block.to`（`:3829-3830`）。
   - **键盘**：`verticalTarget` 对跨块级 widget 的落点调 `clampAcrossBlockWidgets`，把目标
     钳到行进方向的近端边界（`editor.ts:325-337`）；从正文首行按 ↑ / ⌃P，落点就是 `fm.to`。
   - **装载 / 聚焦**：装载事务把选区复位到 0（`editor.ts:2304`、`:2585`）；有 frontmatter 时
     0 = `fm.from`。编辑器未聚焦时光标不画；任何一次聚焦（点击、Tab、浮层交还焦点）都会让
     这个边界光标显形。
4. **为什么块一直渲染**：frontmatter 的显露判据要求选区**覆盖整块**（`livePreview.ts:648`），
   空光标在边界 / 块内都不满足，widget 不撤。公式 / mermaid 用的是「严格重叠即撤」：
   **块内**的选区会显露，所以它们的指针入口（把选区 dispatch 到块内）能工作；但**边界**上的
   空光标与块范围不严格重叠，装饰同样不撤——所以键盘 clamp 到边界的路径三类同病。
   frontmatter 连块内都不显露，是三类里覆盖最窄的一条。

### 1.3 结论

- 这是**渲染缺陷**：光标几何取了块 widget 的 rect，违反「光标矩形属于一条可见文本行」这条
  隐含不变量。归因不是 CSS 宽度、不是行高、不是字体。
- 合同缺口：living spec 的 requirement 已包含 frontmatter 的显露，但缺一条**光标几何**条款，
  且 frontmatter 没有进「触及即显露」的 Scenario 输入分布。本 change 先补合同再改实现。
- 同类输入：块级公式 / mermaid 在键盘边界路径上也会得到同样的整块高度光标（它们只补了
  指针入口，没补键盘边界）；本 change 的合同与规范化覆盖这三类，属同一不变量，不是扩 scope。

## 2. 合同条款（拟新增 `docs/specs/editor-caret.md`）

以下是**待 Alex 过目的条款原文**（D3）。输入分布引用文档形状与交互入口，不引用具体案例。

### C1 — 光标矩形的高度 = 所在可见文本行的行盒高度

对**任意** md 文档、选区、主题与字号档：若 `drawSelection()` 画出了光标矩形，该矩形 SHALL
落在一条**可见文本行**的几何范围内，其高度 MUST 等于该行行盒的高度（同一字形度量下，容差
±1px）。光标矩形 MUST NOT 取任何**被块级 replace 装饰覆盖的源范围**的总高度（该范围可跨
多行，其替换面高度与行高没有对应关系）。若某光标位置没有任何可见文本行承载（位置落在渲染态
的替换块内或边界），系统 SHALL 在绘制前二选一：**显露该块的源码**、使光标所在源行可见，或
**把光标移到相邻的可见文本位置**；MUST NOT 在替换块的渲染面上绘制光标。

### C2 — 替换块的指针入口

渲染态的块级 replace 面（frontmatter properties、块级公式、mermaid 图表）MUST 消费
`mousedown`（`preventDefault`，MUST NOT 让原生选区滞留在 `contenteditable=false` 岛边缘）。
有对应源码的渲染面（frontmatter properties 盒、块级公式、mermaid 图表）SHALL 显露该块源码，
并把空光标放在点击位置对应的源行内；frontmatter 内没有对应源码的合成面（折叠的 doc-title、
纯装饰 padding）SHALL 只把焦点交给编辑器，光标按 C3 规范化到可见位置。任何入口 MUST NOT
改写文档。

### C3 — 装载与聚焦的初始光标

以 frontmatter 开头的 md 文档装载后，初始空光标 SHALL 位于该块之后的第一条可见文本行行首
（存在时）；不存在正文行时，编辑器获得焦点后 SHALL 显露 frontmatter 源码并把光标放到块内
可见源行。编辑器获得焦点时，若当前空光标位于已渲染 frontmatter 块的边界上，系统 SHALL 按
本条的规则规范化（有正文行 → 正文首行；无 → 显露源码）；MUST NOT 在聚焦后留下覆盖替换块
高度的光标矩形。除上述入口外，任何事务（含 `editor.goto-line` 的行首落点、程序化选区）把
空光标放到已渲染 frontmatter 块的边界上时，系统 SHALL 同样按本条的规则规范化（有正文行 →
正文首行；无 → 块内显露）；垂直移动事务归 C4 处理；装载事务除外——它由装载路径显式处理。

### C4 — 键盘垂直移动不落在替换块渲染面

垂直移动（↑↓ / ⌃P⌃N，含扩选）跨越块级 replace 时，落点 SHALL 是行进方向上的**最近可见
源码行**（钳制进块内并显露出该块），MUST NOT 停在渲染态替换块的边界上；同时 MUST NOT 一次
跨过整块（M110 的既有意图保留：块不被一步跳过）。

### C5 — 显露与光标规范化不改写文档

C1–C4 的显露、光标移动与装饰重建 MUST NOT 改写文档：`EditorState.doc` 与磁盘文件在操作前后
逐字节不变（ADR 0003 §3）。这条是既有铁律在本合同的复述，作为属性测试的公共断言。

### 2.1 条款的输入分布（属性测试口径）

条款不引用具体案例，测试 fixture 必须扫这些维度：

| 维度 | 取值 |
|---|---|
| frontmatter 形状 | 无 fm（对照）· 1 行 · 3 行 · 20 行 · 512 行（`MAX_FRONTMATTER_LINES` 上限）· 空 fm（`---\n---`）· 非法 YAML 回退 · 只有 fm 无正文 · fm + 正文 |
| doc-title | 有文件路径（折叠标题 + meta）· 无路径（无标题） |
| 入口 | 点击 properties 上 / 中 / 下三分之一 · 点击 doc-title 标题行 / meta 行 · 点击 outer padding · 点击正文（对照）· Tab 聚焦 · 装载后聚焦 · 浮层关闭交还焦点（程序化 `focus()`）· ↑ / ⌃P 从正文首行 · ↓ / ⌃N 从末段进入正文 · Shift+↑ 扩选 · 拖拽覆盖块的一部分 · ⌘A |
| 主题 | light · dark · eink |
| 字号 | 15px（出厂）· 32px（配置上限） |
| 文档位置 | fm 在文档首（唯一合法位置）；长文档滚动到中段后回到篇首；只有 fm 的短文档 |

## 3. 实现设计

### 3.1 显露判据统一（frontmatter）

- `frontmatterSet` 的判据从
  `revealSelection(state).ranges.some(r => r.from <= fm.from && r.to >= fm.to)`（覆盖整块）
  改为 `touchesSource(state, fm.from, fm.to)`（`reveal-gate.ts:45-47` 的严格重叠 + M259 快照）。
  这与 callout 行 / 链接的严格重叠同源，也与公式 / mermaid 的 strict overlap 同族；差异只在
  「判据选区取快照」这一条（frontmatter 必须保留 M259，理由见 `reveal-gate.ts` 文件头）。
- `FrontmatterWidget` 的 `selected` 参数与 `cm-lp-frontmatter-selected` 样式删除：
  严格重叠一旦成立 widget 就撤下，selected 态不可达（REVIEW.md「值或开关声明了却没有
  消费者」条）。`FrontmatterWidget.eq` 与 `tests/unit/doc-title-placement.test.ts:172-181` 的
  构造参数同步收窄。
- `frontmatterDecorations.update` 的触发条件不变（`tr.docChanged || tr.selection ||
  effects(previewRefresh / pointerPressFrame)`）——揭示 / 恢复都靠它重算。

### 3.2 指针入口

**共享助手**：把 `enterReplacedSource` 从 `src/preview/math.ts:176-198` 迁到新模块
`src/preview/replaced-source.ts`，`math.ts` / `mermaid.ts` / `frontmatter.ts` 三处 import
同一份实现（REVIEW.md「同一语义两处真源」条）。行为逐字不变：`preventDefault` → 把选区
dispatch 到块内锚点 → 重测点击坐标 → 钳制到内层区间 → `view.focus()`。

**FrontmatterWidget.toDOM(view)**：`WidgetType.toDOM` 的 view 参数本来就有，当前实现没接；
改为接住 view，在 `outer` 上挂一个 `mousedown`（左键）：

```
if (event.button !== 0) return;
const fm = detectFrontmatter(view.state.doc);
if (!fm) return;
const target = event.target as HTMLElement | null;
if (target?.closest(".cm-lp-frontmatter") !== null) {
  // properties 盒：进 YAML 源码，落在点击行
  const from = view.posAtDOM(outer); // widget 根节点：块起点 = fm.from
  const innerFrom = view.state.doc.line(1).to + 1 - from; // 跳过开围栏行
  const innerTo = view.state.doc.lineAt(fm.to).from - from; // 收在闭围栏行之前
  enterReplacedSource(event, view, outer, innerFrom, innerTo);
} else {
  // doc-title / padding：合成面，不进入 YAML；聚焦后把边界光标规范化
  event.preventDefault();
  view.focus();
  normalizeFrontmatterCaret(view);
}
```

- `posAtDOM(outer)` 用 **widget 根节点**（不是嵌套的 properties 盒）取块起点，避免
  `posFromDOM` 在 widget 内部节点上返回非块首位置；`innerFrom` / `innerTo` 用**运行期文档**
  计算，不把绝对位置存进 widget（位置会随文档变化漂移，存了就是第二处真源）。
- 标题 / padding 分支在 `focus()` 之后**显式调用** `normalizeFrontmatterCaret`（导出在
  `frontmatter.ts`，与 focus 处理器同一份实现）：编辑器已经聚焦时点标题不会再触发 `focus`
  事件，只靠 focus 处理器会漏掉这一支。
- 点击属性值里的 tags / status chip 也走 properties 分支（chip 不是编辑入口），落点是点击
  所在 YAML 行。
- 不实现「点 doc-title 改文件名」——不在本 change（Non-goals）。

### 3.3 装载 / 聚焦的初始光标

**纯函数**（放 `src/preview/frontmatter.ts`，可单测）：

```
/**
 * 以 fm 开头的 md 文档的初始光标：闭围栏行之后第一行的行首；没有下一行返回 null。
 */
export function firstBodyLineStart(doc: Text, fm: { from: number; to: number }): number | null {
  // fm.to 不含换行：doc.length 大于它时存在下一行（含末空行，仍有正常行高，M399）。
  return fm.to < doc.length ? doc.lineAt(fm.to + 1).from : null;
}
```

输入是 CM 的 `Text`（`doc.lineAt` 是 O(log n)，`detectFrontmatter` 的首部扫描有 512 行
上限），不在装载路径上构造 `textLineView` 的全量行数组（打开 1MB 文档的性能路径，
ADR 0002 §6）。

**装载路径**：
- `loadedState`（`editor.ts:2301`）：先按现有事务派生新 state（selection 0），再
  `detectFrontmatter(next.doc)` + `firstBodyLineStart(next.doc, fm)`；有正文行就再派生一次
  selection（纯 state 运算，无 view、无渲染中间态）。code 模式跳过。
- openFile 的 `dispatchTrusted`（`:2580`）：装载事务之后调用同一个
  `normalizeInitialCaret(view)`——它读 `view.state.doc`（已是新文档），有正文行且选区在 0
  时 dispatch 到正文首行。无正文行时不动（widget 正常渲染，聚焦时由下面的规范化接管）。
- `normalizeInitialCaret(view)` 的完整口径：md + 有 fm + 当前选区在 `fm.from` 时才工作；
  有正文行 → 正文首行；无正文行且 `view.hasFocus` → 调 `normalizeFrontmatterCaret` 显露
  源码，未聚焦则不动（widget 正常渲染）。
- 会话激活（`activate` 的 `view.setState`，`editor.ts:2338`）之后，若 `view.hasFocus`，
  调用 `normalizeFrontmatterCaret`：以键盘切到「装载时未被聚焦、只有 fm」的后台会话不会
  再触发 focus 事件，不补这一刀就会留下边界光标。
- mode 热切换（`setMode` 重配到 md，`editor.ts` 的 `setMode`）之后同理：若 `view.hasFocus`，
  调用 normalizer（code 模式下没有 field，normalizer 自然 no-op；切到 md 后边界光标才需要
  处理）。

**聚焦规范化**（md 专属，装在 `livePreview` 扩展组）：
- 用 `EditorView.domEventHandlers({ focus })`：contentDOM 获得焦点时调用
  `normalizeFrontmatterCaret(view)`（若该版本 CM 不转发 `focus`，改用 contentDOM 的原生
  `focus` 监听，行为等价）。**MUST NOT 放在 `ViewPlugin.update` 里**——CM 禁止在
  更新进行中 dispatch，会用焦点回调之外的方式抛「update in progress」；DOM 事件回调里
  dispatch 是既有写法（`enterReplacedSource` 同款）。
- 装载路径的「已聚焦时装载」不靠 focus 事件（不会再触发），由 `normalizeInitialCaret` 在
  装载事务之后处理（见上）。全部装载入口只有两处：`loadedState`（后台会话）与 openFile 的
  `dispatchTrusted`（`rg "dispatchTrusted\\("` 的唯一调用点），不存在第三条漏网。
- `normalizeFrontmatterCaret`：
  1. `fm = state.field(frontmatterBlockField, false)`（单一检测场，见 3.3.1）；无 → 返回。
  2. 选区非空 → 返回（严格重叠会显露，head 落在可见源码行）。
  3. `head` 不是 `fm.from` / `fm.to` → 返回（块内位置已被显露；块外正常）。
  4. 若 `touchesSource(state, fm.from, fm.to)`（widget 当前未渲染）→ 返回。
  5. 有正文行 → dispatch 到 `firstBodyLineStart`；无正文行 → 按边界侧推进块内一个字符
     （`head === fm.from ? fm.from + 1 : fm.to - 1`），让严格重叠显露源码。
- 只改选区、不带 `scrollIntoView`；不碰文档、不碰阅读位置。避免与
  `focusPreservingReadingPosition` 的滚动簿记打架（M280 的纪律）。
- `normalizeFrontmatterCaret` 导出在 `frontmatter.ts`：3.2 的标题 / padding 分支与这里的
  focus 处理器共用同一份。它只在聚焦 / 边界事务时工作；装载后的「有正文才移、无正文不动」
  归 `normalizeInitialCaret`，两者不合并（无正文时前者要显露源码、后者要保持 properties
  渲染）。
- 只在 md 模式装（`livePreview` 本身只在 md 分支），code 模式零影响。

### 3.3.1 边界光标的事务级兜底（frontmatter）

`editor.goto-line`（`revealLineAt`，`editor.ts:2455-2467`）与其它程序化选区会把空光标直接
放到 `fm.from` / `fm.to`，不经过指针 / 键盘 / 聚焦三条规范化。兜底放在**事务层**：

1. **单一检测场** `frontmatterBlockField`（`StateField<FrontmatterBlock | null>`）：
   `create` 与 `docChanged` 时 `detectFrontmatter`（首部扫描 ≤512 行，含 `inner`），其余
   绘制帧 O(1)。`frontmatterSet` 改为读这个 field 拿 `inner` 建 widget（此前每次 update 都
   自己 `detectFrontmatter`；现在检测只剩一处），filter 与聚焦规范化读它的 `from` / `to`。
   field 在扩展组里排在 `frontmatterDecorations` 之前（后者 `create` 时依赖它）。
2. **`frontmatterCaretFilter`**（`EditorState.transactionFilter.of`）：
   - `fm` 为 null → 原样返回；
   - `tr.newSelection.main` 非空 → 原样返回（严格重叠负责显露）；
   - `head` 不在 `fm.from` / `fm.to` → 原样返回；
   - `tr.annotation(trustedLoad)` → 原样返回（装载由装载路径显式处理，避免「打开只有 fm
     的文档立刻变源码」）；
   - 否则按来源分流：
     - **垂直移动事务**（`tr.isUserEvent("move.line.up")` / `"move.line.down"`）→ 推进块内
       一个字符（`head === fm.from ? fm.from + 1 : fm.to - 1`），严格重叠随之显露（C4）；
     - **其它事务**（goto-line / 程序化选区 / 指针）→ 有正文行时落到
       `firstBodyLineStart(tr.state.doc, fm)`（正文首行，C3），无正文行时推进块内一个字符
       （显露）。指针落在 properties 盒的路径由 3.2 的 mousedown 显式 dispatch 到块内，
       不经过本分支；落在标题 / padding 的路径只聚焦，由聚焦规范化处理。
   - 第二个事务的选区已不是边界（正文首行或块内），不会自我循环；只在 md 模式装。
3. **注解单一来源**：`trustedLoad` 现在定义在 `editor.ts:1564`，被 `changeFilter` /
   `dispatchTrusted` / `loadedState` 使用；livePreview 的新 filter 也要读它。迁到新模块
   `src/editor-annotations.ts`，两处 import（避免 editor ↔ livePreview 循环，也避免复制
   一份注解）。
4. **已知边界**：`goto-line` 到第 1 行、以及任何非移动事务把空光标放到 `fm.from`，都会落到
   正文首行（有正文时）——不显示 properties 盒也不自动变 YAML；没有正文行时才显露源码。
   这是 C3 的直接后果；若 Alex 希望 goto-line 第 1 行显示 YAML 原文，把「其它事务」分支的
   目标改成块内即可，不重开节点 1。

### 3.4 键盘垂直移动的边界推进

`clampAcrossBlockWidgets`（`editor.ts:170-181`）现在返回块边界 `best`；改为返回块内最近
源码位：

- forward（向下）→ `best + 1`
- backward（向上）→ `best - 1`

`best` 是 `starts` / `ends` 里的近端边界，块长度 ≥ 2（这三类 replace 的源码长度下界），
因此 `+1` / `-1` 必在块内。选择落在块内后：
- frontmatter 的 `touchesSource` 严格重叠成立 → widget 撤下；
- 公式 / mermaid 的 `state.selection` 严格重叠成立 → widget 撤下；
- 光标落在可见源码行上（C1 / C4 成立），且没有一步跨过整块（M110 的意图保留）。

注释同步改准：原注释「钳制到行进方向的近端边界」改为「钳制到块内最近源码位（并显露）」，
并把 M110 的来历与本 change 的 C4 一起写明，避免下一个人按旧注释改回边界。

### 3.5 光标视觉（D2 = A）

- `src/editor.ts` 的 `baseTheme` 里，`.cm-cursor, .cm-dropCursor` 的现有规则（只改颜色，
  `:1836`）扩展为：
  - `borderLeft: "2px solid var(--text)"`（宽度是组件常量；颜色仍走 token）
  - `marginLeft: "-1px"`（CM 基础主题的 `-0.6px` 是按 1.2px 居中的；宽度改 2px 必须同步
    居中，否则光标相对插入点右偏 0.4px）
- `&.cm-focused > .cm-scroller > .cm-cursorLayer { animation: "none" }`：取消闪烁。
  CM 基础主题把动画挂在 layer 上（`:6883-6887`）；用**同选择器 + 明确值**覆盖，必要时
  `!important`（基础主题与用户主题的先后顺序不是可依赖的契约，实现期以计算样式断言钉住）。
- eink：同宽、同色（`--text` = `#000`）、常亮。tokens 文档规则⑧（线宽是 eink 的强调）与
  2px 引用块竖线的先例支持这个宽度；不新增色、不新增 token 数量（`--cursor-w` 不引入，
  按组件常量登记在 `docs/specs/editor-caret.md` 与 design-tokens 的「阴影与 hairline」节）。
  光标是**交互指示线**，不进 tokens 文档「三处粗 hairline 是装饰性结构线的全部」那张清单，
  两者不冲突。
- 若 D2 改判 B（保留闪烁）：删掉 `animation: none` 一条，宽度 / 居中不变；若改判 C，
  宽度改 3px、`marginLeft` 改 `-1.5px`。delta 与测试同步改。

### 3.6 改动面

| 文件 | 改动 |
|---|---|
| `docs/specs/editor-caret.md` | 新建：C1–C5 条款 + 输入分布 + 属性测试指针 |
| `docs/specs/design-tokens-v1.md` | 「阴影与 hairline」节登记光标宽度 2px / 常亮 / eink 同值 |
| `src/preview/replaced-source.ts` | 新建：`enterReplacedSource` 从 math.ts 迁入 |
| `src/editor-annotations.ts` | 新建：`trustedLoad` 从 editor.ts 迁入（editor / livePreview 共用） |
| `src/preview/math.ts` | 删本地实现、改 import；reveal 注释里的「frontmatter selected 口径」改准 |
| `src/preview/mermaid.ts` | 改 import；同上注释 |
| `src/preview/frontmatter.ts` | `toDOM(view)` + mousedown 路由；`selected` 删除；新增 `firstBodyLineStart` / `frontmatterBlockField` / `normalizeFrontmatterCaret` |
| `src/preview/livePreview.ts` | 显露判据改 `touchesSource`；装 `frontmatterCaretFilter` 与 focus 处理器 |
| `src/preview/theme.ts` | 删除 `cm-lp-frontmatter-selected` 三行样式 |
| `src/editor.ts` | 初始选区、`clampAcrossBlockWidgets` 边界推进、光标宽度 / 居中 / 常亮、改 import `trustedLoad` |
| `src/style.css` | 无 token 新增；如实现选择变量则在 `:root` 留一处并有注释（默认不加） |
| `tests/unit/doc-title-placement.test.ts` | FrontmatterWidget 构造参数收窄 |
| `tests/unit/frontmatter-caret.test.ts`（新） | `firstBodyLineStart` / 边界规范化纯函数的输入网格 |
| `tests/visual/scenes/m647-caret-geometry.spec.ts`（新） | §4 的属性矩阵 + 光标计算样式 |
| `scripts/acceptance/scenarios/228-caret-visibility.md`（新） | 真机截图证据 + 文档不变 |

## 4. 属性测试矩阵（不变量级）

测试层：**chromium 结构 / 几何层**（`tests/visual/scenes/m647-caret-geometry.spec.ts`）。
真机 AX 不暴露光标矩形，像素层只能留截图证据（见 §6），所以 C1 的机器判据落在这一层。

### 4.1 读数方法

- 从 `.cm-content` 的 `cmTile.root.view` 取 `view.state.selection.main.head`；
  用 `view.coordsAtPos(head, assoc)` 取「CM 认为的光标矩形」。
- 从 `.cm-cursor` 的 `getBoundingClientRect()` 取「实际画出来的光标矩形」。
- 「所在可见文本行的行盒高度」：取 `head` 所在源行对应的 `.cm-line` 的 `getBoundingClientRect().height`；
  若该行被 widget 覆盖（不应发生），判 FAIL（读数不可得 ≠ 通过，REVIEW.md「读不到当成空」条）。
- 对照读数：
  - 正文行光标（正向）：高度 = 正文行盒（约 25.5px，15px × 1.7）。
  - H1 行光标（区分度）：高度 = H1 行盒（大于正文行盒），证明「等于行盒」不是把光标钳到
    常量高度。
  - properties 盒渲染时：`.cm-cursor` 高度 MUST 小于 `.cm-lp-frontmatter-outer` 的高度
    （旧实现的整块高度），这是让断言在修前 FAIL 的区分度对照。

### 4.2 用例网格

| 组 | 输入 | 断言 |
|---|---|---|
| A 指针 | 点击 properties 上 / 中 / 下三分之一（fm 行数 1 / 3 / 20 / 512；有 / 无 title；有 / 无正文） | 点击后 `.cm-lp-frontmatter` 计数 0；选区落在 `[fm.from, fm.to)` 内；`.cm-cursor` 高度 = 所在 YAML 行行盒 ±1px；文档字节不变 |
| B 合成面 | 点击 doc-title 标题行 / meta 行 / outer padding | widget 计数 1（有正文）或 0（无正文）；选区 = 正文首行行首（无正文 → 块内）；光标高度 = 所在可见行行盒 ±1px |
| C 装载 / 聚焦 | 打开文档（有 / 无正文）→ `view.focus()` / Tab / 程序化 focus；已聚焦时切标签到「只有 fm」的后台会话 | 选区 = 正文首行（无正文 → 块内）；widget 在场态符合 C3；光标高度符合 C1；文档不变 |
| D 键盘 | 正文首行 ↑ / ⌃P；正文末段 ↓ / ⌃N；Shift+↑ 扩选 | 落点在块内（块显露）或正常正文行；`clampAcrossBlockWidgets` 不再产出边界位置；光标高度符合 C1；文档不变 |
| D2 事务边界 | `editor.goto-line` 跳第 1 行；程序化 `dispatch({selection:{anchor:0}})`；`revealLine(1)`；垂直移动事务 | 空光标在 `fm.from` / `fm.to` 时被 `frontmatterCaretFilter` 按来源分流：垂直移动 → 块内（显露）；其它 → 正文首行（无正文 → 块内）；装载事务（`trustedLoad`）不触发 filter，由装载路径放到正文首行；光标高度符合 C1；文档不变 |
| E 选区 | 拖拽覆盖块的一部分；⌘A；程序化选区覆盖一半 | widget 撤下（源码可见）；选区覆盖范围按既有 drawSelection 口径；折叠回正文后 widget 恢复；文档不变 |
| F 主题 / 字号 | light / dark / eink × 15px / 32px，重复 A / B / C 的代表格 | 所有高度断言按当前字号的行盒重算；eink 下光标计算样式 = 2px 黑、无动画 |
| G 光标样式 | 聚焦 × 三主题 | `getComputedStyle(.cm-cursor).borderLeftWidth` = 2px；颜色 = `--text` 计算值；`.cm-cursorLayer` 的 `animationName` = none（D2=A）；`marginLeft` = -1px；非聚焦时 `.cm-cursor` 不显示 |

### 4.3 通过标准

- 每一格的 C1 断言在**修前必须 FAIL**（用 properties 渲染时「光标高度 < 块高度」的对照证明
  区分度；实现 PR 里记录一次修前红色读数）。
- 任一格出现「读数不可得」判 FAIL，不判 skip（REVIEW.md「读不到当成空」条）。
- 文档字节在所有格子里逐字节不变（C5）。

## 5. 边界与风险

1. **编辑 YAML 期间 doc-title 让位**（D1=A 的已知代价）：标题折叠在同一个 widget 里
   （M222 的单岛拓扑），strict overlap 撤下整个 widget 时标题一起消失。移开光标（选区离开
   块范围）立即恢复；不引入「保留标题」的第二套拓扑（M222 的回归现场是撤销这条约束的代价）。
   若 Alex 认为不可接受，回落 D1=B。
2. **布局位移与点击落点的近似**：`enterReplacedSource` 的两步测量在 math / mermaid 上已有
   实践；frontmatter 撤下时高度差更大（properties + title 换成若干 YAML 行），点击坐标重测后
   可能偏一至数行，钳制保证落在块内。手感归 dogfood（design 的预期是「大致落在点击行」，
   不承诺逐行精确）。
3. **键盘入口是行为新增**：公式 / mermaid 此前只能点击进入源码，C4 让 ↑↓ 在边界处进入块内
   并显露。这是从「同一不变量」推出的必要行为（否则边界光标无法消除且不能一步跳过块）；
   它顺手回答了 backlog 的「mermaid / frontmatter 无键盘进入路径」一条，但本 change 不改
   backlog（按「候选提议安排处理」规则由 tower 处置）。
4. **M259 快照**：frontmatter 的显露判据继续用 `revealSelection`（按压窗口内取快照），不换成
   `state.selection`；否则拖拽经过块时会边拖边撤装饰，重复 M259 的幻影选区缺陷。
5. **性能**：`touchesSource` 只遍历选区 ranges；`firstBodyLineStart` 只在装载 / 聚焦时调用；
   聚焦规范化只在 focus 回调时跑一次 O(1) 检测；`frontmatterBlockField` 只在 `docChanged`
   时扫首部（≤512 行），filter 其余帧 O(1) 读 field。没有新增全量装饰构建，不触碰
   ADR 0002 §6 的打开路径阈值。
6. **视觉基线**：光标宽度 / 常亮可能改变既有整页基线里的光标像素。按
   [tests/visual/README.md](../../../tests/visual/README.md) 的纪律，基线更新须 Alex 过目；
   实现 PR 报告里逐张列出变化基线。
7. **code 模式**：光标宽度 / 常亮是 mode 无关的 baseTheme 改动，code 模式同步生效；C1–C4
   只在 md 模式（livePreview）生效，code 模式没有 replace 装饰，行为不变。
8. **只有 frontmatter 的文档**：装载时初始选区仍可为 0（widget 正常渲染）；聚焦时 C3 的
   规范化把光标放进块内并显露源码。打开这种文档不会自动变源码（未聚焦时 widget 在）；
   聚焦后进入编辑态是设计选择。
9. **非法 YAML 回退**：widget 的 fallback 也挂同一个 mousedown 路由；点击回退块 → 显露
   源码（与 properties 分支同口径），光标落在围栏内可见行。
10. **二次入口**：`activeLine` 底色、`highlightActiveLineGutter` 等不消费选区几何，不受影响。
11. **幽灵块（既有口径）**：`blockWidgetBoundaries` 的数学扫描是词法口径，不排除 frontmatter /
    代码上下文；这些上下文里出现 `$$` 时，clamp 可能把光标推进一个**未被装饰**的范围。落点
    仍在可见文本行上（C1 不被违反），但行进方向可能不如预期。本 change 不改这个既有口径
    （不在缺陷面），属性矩阵不含该输入；实现期若观察到异常按 finding 处置。

## 6. 验证计划

| 层 | 命令 / 动作 | 判据 |
|---|---|---|
| 合同 | `docs/specs/editor-caret.md` 的 C1–C5 与 design §2 逐字一致 | 人读 + docs-check 链接可达 |
| 单测 | `pnpm test`（新增 `tests/unit/frontmatter-caret.test.ts`；更新 doc-title-placement） | 全绿 |
| 结构 / 几何 | `LUMIR_VISUAL_STRUCTURAL=1` 的 visual 层 + 新增 m647 场景 | 属性矩阵全绿；修前红色读数留档 |
| 像素 | 本地 `scripts/gate.sh visual` | 全绿；变化基线逐张过目 |
| 真机 | `node scripts/acceptance/run.mjs 228` | 场景 PASS（截图证据 + 文档不变）；光标高度归 Alex 手感项 |
| 文档 | `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` / `bash scripts/docs-check.sh` | 全绿 |
| 总门禁 | `bash scripts/gate.sh quick` | 照抄 `GATE RESULT` 原文行与退出码 |

真机验收的边界（照实登记）：套件的 AX 输出不暴露 `AXSelectedTextRange`（见
`scripts/acceptance/README.md` 的「光标/选区不可断言」条），所以场景 228 只能留「点击后
properties 撤下 / 标题让位 / 光标是短竖线」的截图证据与「文档不变」的字节断言；光标高度的
机器判据在 chromium 结构层，不在真机层。

## 7. 备选方案与否决理由

1. **CSS 给 `.cm-cursor` 加 `max-height`**：把整块高度裁到行高。否决——光标仍停在不可见的
   边界位置（在 properties 盒上画一条线），打字会写进看不见的 YAML；这是案例级补丁，违反
   合同先行规则。
2. **D1=B：properties 盒只读，点击只聚焦**：见 proposal D1 的代价；需要 MODIFIED living spec，
   且点击位置与落点不一致。作为 Alex 的备选保留。
3. **拆出 doc-title 做独立 widget**：让标题在 YAML 编辑期间保留。否决——M222 的回归 2
   实证两个相邻 ce=false 块会让 Chrome ⌘A→← 塌缩 no-op（`tests/unit/doc-title-placement.test.ts:10-32`），
   本 change 不重开这条约束。
4. **`WidgetType.coordsAt` 自定义返回单行 rect**：让光标在块边界显示为一行高。否决——
   光标仍在不可见位置，属于「把症状画小」，不满足 C1 的「落在可见文本行」。
5. **全局禁止在 block widget 上画光标（CSS 隐藏）**：否决——隐藏光标会让键盘用户失去位置
   反馈；且不解决「光标在隐藏 YAML 里」的编辑错位。
6. **atomicRanges + 跳过整块**：否决——M110 已裁定「一次按键跨过整块」是缺陷（落点感知
   丢失）；C4 保留「不一步跨过」。

## 8. 裁决点映射

| 裁决点 | 影响 | 未回时的落地 |
|---|---|---|
| D1 frontmatter 点击语义 | 3.2 的 properties / doc-title 路由；delta 的 C2 | A（properties → YAML；标题 / padding 只聚焦） |
| D2 光标视觉 | 3.5 的宽度 / 闪烁；ui-design-system delta | A（2px + 常亮；eink 同值） |
| D3 合同条款 | §2 的 C1–C5 原文；`docs/specs/editor-caret.md` | 按原文 |
