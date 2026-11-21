# 列表渲染归属合同（list rendering attribution）

> 状态：新增（M421，2026-10-10）。本文档是**列表行在 live preview 里的渲染归属**的质量合同：
> 可被测试证伪的不变量条款。渲染/交互缺陷修复的「合同先行」规则见
> [../process/rendering-defect-contract-first.md](../process/rendering-defect-contract-first.md)——
> 定位到本文件某一条、配不变量级属性测试，两者与修复同 PR。
> 列表的**标记外观**（glyph / 复合编号 / 字号档 / 悬挂缩进像素）不在本文件，见
> `src/preview/lists.ts` 与 `src/preview/theme.ts` 的 `.cm-lp-list-*` 规则；
> 列表的**解析语义**（CommonMark 归属）不在本文件——本文件只约束**渲染归属**。
> **L7 是唯一的例外**：它约束「原生删除跨过 replace 装饰边界」时的源码保真；按行为类别
> 收在此处，是因为列表 marker 是这类 replace 装饰最常见的一格，判据本身不限于列表。
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

## 裸 marker 行条款（M461，2026-10-12）

**裸 marker 行** = 行首是合法列表标记（有序 `\d{1,9}[.)]`、无序 `-` / `+` / `*`）、
标记后为空白至行尾（空项）或带内容，但语法树未把该行认作列表项首行——典型
`para\n1. `（空列表项按 CommonMark 不能打断段落，行是 lazy continuation）。判定
`bareListMarkerLine` 与 L1–L4 共用一个文件、一份 `listLineInfo` 真源（补集关系，
树已接管的形态一律让回既有路径）。

### B1 — 列表编辑态门控与光标相接即算

**任意**裸 marker 行，live preview SHALL 仅在**判据选区**（reveal-gate 的按压快照
口径）与该行范围相接（含端点）时按列表项首行渲染（藏源码标记、marker widget、
悬挂缩进）；光标在上一行行尾（= 本行行首前一字符）MUST NOT 触发，光标在本行行首
（marker 之前）MUST 触发（与 M110 行级显露同取向）。这是**刻意例外于 L3** 的新
条款：L3 约束「归属判定」与光标无关，B1 约束的是其上的「编辑态门控」——后者本就
是光标驱动的渲染事件。

### B2 — 编辑态不改写文档

B1 的进入 / 离开 MUST NOT 改写文档源码：裸行在编辑态与字面态两种渲染下，行内
源码逐字节相同（ADR 0003 §3 铁律同 L4）。Enter 在裸行上的退出（删空标记）与续行
（插下一序号）、Backspace 在内容起点删除 marker 都是**显式编辑动作**，不属于本条禁止的
「渲染事件」。

### B3 — 内容起点 Backspace 第一次按键即删标记

裸 marker 行的空光标位于内容起点时，Backspace SHALL 单次删除 marker 与其后空白，保留
引用前缀 / 行首缩进，光标落在删除起点。第一次按键 MUST 生效；真列表、非空选区、正文其他
位置与只读会话 MUST NOT 被这条裸行分派接管。

## L5 — 列表 marker 的隐藏源码区间是水平导航的一个原子步（M795）

**任意**列表行（项首行 / 真续行 / 裸 marker 行的编辑态），渲染层隐藏的源码区间 MUST 恰好是水平导航
当作**原子步**跨过的区间，两者 MUST 取自同一份判定（`src/preview/lists.ts` 的 `listLineRender`）：

- 区间端点 = 渲染层 `Decoration.replace` 覆盖的范围（marker + 尾随空白、引用前缀、续行行首缩进、
  裸行的标记段）。多藏一个字符会让光标落在看不见的源码上，少藏一个字符会让「一步跨过」停在可见字形
  中间——两种都违反本条。
- 水平移动（`←` / `→`、`⌃B` / `⌃F`）的落点 MUST NOT 停在区间内部；落在内部时钳到移动方向一侧的
  可见边界（前进 → 正文起点，后退 → 可见行首）。区间**不隐藏**时（裸 marker 行不在编辑态、
  lazy continuation 行按顶层段落渲染）MUST NOT 有原子步——那里每个字符都是可见的。
- 由此：从可见行首按一次 `→` 或 `⌃F` 到正文起点，再一次前进一个字素簇；反向对称。任意列表类型、
  嵌套深度、marker 宽度与正文字素下成立。文档字节不变（L4 照旧）。

**边界归 C1**：列表行上的光标矩形高度 = 该行正文文本的行盒，这支条款住
`docs/specs/editor-caret.md` 的 C1（本条只约束导航单位，不另立几何口径）。

## L6 — 列表项内容起点输入的跨层一致性（M830）

**适用范围**：未被用户单字符键位覆盖的默认文本输入路径；空光标位于真列表 / 嵌套项
`listLineRender.hidden.to`，或裸 marker 行编辑态的内容起点。普通 `insertText`、IME 组合更新、
组合中删除与组合提交走同一合同，不按列表类型、项序号、字符或 DOM/AX 形状分叉。

- **文档与选区**：提交文本 SHALL 只插入当前空光标或替换当前选区；marker 源码、尾随空白与
  其他项文本 MUST 逐字节不变。空光标输入后 `selection.main.head` MUST 位于提交文本末尾。
  例如第 7 个空有序项 `7. ` 输入 `a` 后，源码 MUST 是 `7. a`，不是 `7.a`，也不是吞掉 `a`。
- **组合中删除的边界**：一次 Backspace SHALL 只删除组合起点之后、光标之前的一个完整字素；
  marked text 已空时 MUST 是 no-op，MUST NOT 删除 marker、组合前正文或相邻行，也 MUST NOT
  清空相邻行的渲染文本。组合期判定 SHALL 使用覆盖完整事件窗口的 `view.compositionStarted`，
  MUST NOT 只信会在组合中删除时错报 false 的 `event.isComposing`；删除类型 SHALL 覆盖
  Chromium 的 `deleteContentBackward` 与 WKWebView 实测的 `deleteCompositionText`。
- **组合期装饰稳定**：从 compositionstart 到 compositionend，列表装饰 SHALL 保持组合前的
  DOM 形态，不得在输入法持有原始文本节点时插入或替换 marker widget；组合结束后统一重建。
  段落后 `- ` 变为列表时，组合中 MUST NOT 同时出现原始 marker 与新 widget。
- **marker 与几何**：渲染稳定后，每个可见列表项 MUST 恰有一个 marker widget；显示 glyph /
  复合序号、计算样式与正文起点 x MUST 保持输入前同合同。普通输入、组合更新 / 删除与组合提交
  MUST NOT 造成 marker 丢失、重复、样式退化或正文悬挂位置漂移。
- **DOM/AX 不是文档真源**：marker widget 与正文可在 DOM/AX 中序列化为无空格拼接（源码
  `7. a` 呈现为 `7.a`）。该形状本身 MUST NOT 作为改写文档、拒收输入或恢复旧吞弃护栏的依据；
  行为判定的文档真源是 CodeMirror `EditorState.doc`，落盘真源是显式保存载荷 / 文件字节。
- **历史、dirty 与保存**：一次普通输入或一段完整组合（含更新、删除与提交）SHALL 一次 undo
  恢复精确输入前文档与选区，一次 redo 恢复精确输入后文档与选区；`input.type.compose.start`
  MUST NOT 因紧邻前一笔普通输入而与之并组。dirty 继续按当前文档与
  `cleanDoc` 逐字比较；显式保存载荷 MUST 逐字等于当前 `EditorState.doc`，保存后以该文档为
  dirty 基线。因此保存后 undo 到不同文档 MUST 标 dirty，redo 回保存文档 MUST 清除 dirty。
- **既有编辑行为不动**：本条 MUST NOT 改变 B3 / 上游 / Emacs 的精确 range 删除、裸 marker
  Enter/Backspace、L5 原子导航或 C1 光标几何；不得新增按 DOM 形状猜测编辑意图的生产分支。

## 证伪方式（L1–L6 属性测试口径）

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
4. **L5 区间与导航**（单元 + 键位层）：`tests/unit/list-lazy-continuation.test.ts` 断言
   `listLineRender` 的隐藏区间端点矩阵（列表类型 × marker 宽度 × 嵌套 × 引用前缀 × 任务项 ×
   裸行门控），以及 `listHiddenRangeAt` 在区间内部钳到可见边界、在边界位不动；
   `tests/visual/scenes/cursor-motion.spec.ts` 用真实按键断言 `←`/`→` 与 `⌃B`/`⌃F` 两组键的
   「一次到位 + 逐字素 + 反向对称 + 跨行不跳字 + 文档字节不变」。反向验证：去掉钳制调用
   （`horizontalTarget` 里的 `listHiddenRangeAt`）后逐条变红，恢复后全绿。
5. **L6 输入跨层一致性**（chromium，`tests/visual/scenes/lists.spec.ts`）：对连续空有序项分别
   走真实点击与模型选区，再覆盖 bullet / 嵌套 / 裸 marker / 组合提交代表样本。每路独立读取
   `EditorState.doc` 与 `selection.main`、逐行 marker 数量和计算样式、各内容起点的
   行盒左缘 + 计算后 `padding-inline-start`（空项正文 body x）、`document_save` 载荷、
   DOM `7.a` 与源码 `7. a` 的分层差异。反向验证至少分别破坏输入落点、marker 数量 / 几何和
   保存 / 历史语义，对应断言 MUST 变红；全部恢复后目标测试 MUST 全绿。
   `tests/visual/scenes/editing-oracle.spec.ts` 另用 CDP `Input.imeSetComposition` 驱动真引擎组合，
   对真 bullet / 有序 / 嵌套 / 裸 marker / 段落后 setext 切换逐项执行「首字符 → 删空 → 起点再退格
   → 候选提交 → 保存 → 一次撤销」，并断言相邻行 DOM 不清空；另以合成 beforeinput 覆盖
   WKWebView 实测的 `deleteCompositionText`，以真实组合事件断言组合期 marker 数量不增加、
   提交后才刷新。真机场景 153 用不点击的注入通道复核连续空项输入、文件精确字节与撤销。

## L7 — 跨 replace 装饰的跨行删除（M836）

**适用范围**：所有落到浏览器原生删除路径的**跨行合并**——空光标在行尾按 forward Delete
（吸收下一行），或在行首按 Backspace / `⌘⌫`（吸收本行）。列表项只是最常见的一格：
wikilink、行内公式、链接尾标、任务项以及隐藏的源码标记（`**`、`#`、`>`）吸收时同属这一类。
行内删除（删除范围不跨行）与组合期（IME）删除不在本条内；组合期行内删除归 L6，
本条只约束非组合的跨行合并，不再沿用「组合删除不改写 DOM」这一已被反例推翻的假设。
其中**折叠光标的无修饰物理 Backspace** 的字素步长另归 `openspec/specs/editor-live-preview` 的
「折叠光标的字素步长前删」（M860，change `unify-grapheme-backspace-nov19`：md / code 同判，
按 `quote-card.clusterBackward` 删一个整簇）；本条只约束跨行合并，不重复该口径。
**非空选区**上的删除与普通键入替换不属于「跨行合并」这一格，由 M854 的统一选区事务接管
（判据见 `openspec/specs/editor-live-preview` 的「跨渲染隐藏区的非空选区编辑」与 change
`fix-selection-delete-across-widgets-nov19`；本条不重复）。

- **只改预期源 range**：一次跨行删除 SHALL 只删除两端之间**那一个换行**；被吸收行的其他
  源码 MUST 逐字节保留，包括 widget 覆盖的源片段（`[[x]]`、`$x$`、`- `）与隐藏标记
  （`**`）。MUST NOT 把渲染层显示文本（marker glyph `–` / `◦`、wikilink label、公式渲染
  文本、链接尾标 `→`）写进文档，MUST NOT 因浏览器重建行 DOM 而拆行或增删换行。
- **判据只读 EditorState**：接管判据 SHALL 只读 `EditorState`（空光标、行边界、被吸收
  一侧有行），MUST NOT 检测 widget 类型 / replace 装饰数量 / DOM 或 AX 的文本形状，也
  MUST NOT 按显示字形猜意图（与 L6「DOM/AX 不是文档真源」同源）。因此新增 widget 类型
  自然落在类内，不需要逐类登记。
- **历史、dirty 与保存**：一次跨行删除 MUST 是一个撤销步：一次 undo 恢复删除前文档与
  选区，一次 redo 恢复删除后状态。dirty 继续按 `cleanDoc` 逐字比较；显式保存载荷 MUST
  逐字等于当前 `EditorState.doc`。
- **既有路径不动**：本条 MUST NOT 改变行内删除、裸 marker 行 Backspace、L5 原子导航或
  L6 输入合同（组合期行内删除按 L6 的组合起点与最后一字素边界处理）；行内折叠光标 Backspace
  的字素步长按「适用范围」的 M860 指针另归 `editor-live-preview`，本条只约束跨行合并；
  非空选区编辑按统一选区事务的合同处理（见上）。
  `⌥⌫` / `⌥⌦` 在默认键位表已由应用命令接管；若被解绑，落到原生的词删除变体同样按本条
  接管的同一口径处理。
- **不接管的变体（如实登记）**：`deleteSoftLineForward` / `deleteHardLineForward` 在行尾
  两引擎实测为 no-op，且默认键位表没有绑定——不进入接管集；多区间选区（应用不提供多光标）
  由统一选区编辑合同按 `state.selection` 逐区间处理（见上）。

### 证伪方式

1. **有向矩阵**（chromium + 真机同款 UA 的 WebKit，`tests/visual/scenes/editing-oracle.spec.ts`）：
   对 `-` / `+` / `*` / 有序 / 任务 / 嵌套与 wikilink、行内公式、隐藏标记（`**`）逐格执行
   Delete（行尾）、Backspace（行首）、`⌘⌫`（行首），与独立模型对拍 `doc` 与选区，并验
   一次 undo 复原与 `⌘S` 落盘全文。每格**先断言被吸收行确实渲染了 replace 装饰**（widget
   不存在时该格对缺陷没有区分度）；普通行与 lazy continuation 作同形对照。
2. **反向验证**：临时移除闸门（不 dispatch 显式事务、放行原生删除）后，矩阵中的列表 /
   wikilink / 公式 / `**` 格 MUST 变红（Chromium 写 `–` 并拆行，WebKit 写 `–` 拼接）；
   恢复后 MUST 全绿。
3. **真机**：`scripts/acceptance/scenarios/261-native-widget-deletion.md` 用真 WKWebView
   复核列表 / wikilink / 公式三格与精确落盘、一次撤销；未跑不得记 PASS。

## 与实现的关系

- 判定的**单一真源**是 `src/preview/lists.ts` 的 `listLineInfo`（纯函数，不碰 view、不碰坐标）；
  `ListLayout.build()` 与单元测试共用它（REVIEW.md 「同一语义两处真源」条：同语义不得两处写值）。
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
