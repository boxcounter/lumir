## MODIFIED Requirements

### Requirement: 跨 replace 装饰的跨行删除

任意落到浏览器原生路径的**跨行合并**删除——空光标在行尾的 forward Delete（吸收下一行），或在行首的 Backspace / `⌘⌫`（吸收本行）——SHALL 只删除两端之间那一个换行。被吸收行的其他源码 MUST 逐字节保留，包括 replace widget 覆盖的源片段（列表 marker、`[[wikilink]]`、行内 `$公式$`、链接尾标）与隐藏的源码标记（`**`、`#`、`>`）；MUST NOT 把渲染层显示文本（marker glyph `–` / `◦`、wikilink label、公式渲染文本、链接尾标 `→`）写进文档，MUST NOT 因浏览器重建行 DOM 而拆行或增删换行。

接管判据 SHALL 只读 `EditorState`（空光标、恰在行边界、被吸收一侧确有行），MUST NOT 检测 widget 类型、replace 装饰数量或 DOM/AX 的文本形状，也 MUST NOT 按显示字形猜编辑意图（与「DOM/AX 不是文档真源」同源）。因此纯文本行的事务结果 MUST 与原生删除逐字节相同，新增 widget 类型自然落在类内、不需要逐类登记。

一次跨行删除 MUST 是一个撤销步：一次 undo 恢复删除前文档与选区，一次 redo 恢复删除后状态。dirty MUST 继续按当前文档与 `cleanDoc` 逐字比较；显式保存载荷 MUST 逐字等于当前 `EditorState.doc`。IME 组合期删除、只读会话与多区间选区 MUST NOT 被本接管改变；**行内（不跨行）折叠光标的无修饰 Backspace** 改由「折叠光标的字素步长前删」接管（M860：与 `⌃H` / `⌃D` 同一份字素核），**非空选区删除**与普通键入替换改由「跨渲染隐藏区的非空选区编辑」接管。跨行删除的专项不变量见 `docs/specs/lists.md` L7；**非空选区删除**与普通键入替换的判据见本 requirement 与 `src/editor.ts` 的闸门注释（L7 的适用范围段已同步指向本条）。

#### Scenario: 列表 marker 行被吸收

- **GIVEN** 文档为 `alpha\n- item\n`（或 `+` / `*` / 有序 / 任务项 / 嵌套项的同类形态），且下一行渲染了列表 marker widget
- **WHEN** 光标在 `alpha` 行尾按 forward Delete（或在本行行首按 Backspace / `⌘⌫`）
- **THEN** 文档变为 `alpha- item\n`（源码逐字节合并），MUST NOT 出现 `–` / `◦` 字形或额外换行
- **AND** 一次 undo 精确恢复删除前文档与选区；`⌘S` 的落盘全文等于当前 `EditorState.doc`

#### Scenario: wikilink 与行内公式行被吸收

- **GIVEN** 文档为 `alpha\nb [[x]] c\n` 或 `alpha\n$x$\n`，且 wikilink / 行内公式以 replace widget 渲染
- **WHEN** 在同一行边界按 Delete / Backspace / `⌘⌫` 合并两行
- **THEN** 文档分别变为 `alphab [[x]] c\n` 与 `alpha$x$\n`——widget 的源片段保留，显示文本不进入源码
- **AND** 一次 undo 恢复原文档；保存载荷逐字等于 `EditorState.doc`

#### Scenario: 普通行与行内删除不受影响

- **GIVEN** 相邻两行都是无 replace 装饰的普通文本（或 lazy continuation 行）
- **WHEN** 在行边界执行 Delete / Backspace / `⌘⌫`
- **THEN** 结果与浏览器原生删除逐字节相同（只少一个换行）
- **AND** 行内（不跨行）折叠光标 Backspace 的字素步长见「折叠光标的字素步长前删」；IME 组合期删除与修饰键变体保持既有路径；非空选区删除见「跨渲染隐藏区的非空选区编辑」

## ADDED Requirements

### Requirement: 折叠光标的字素步长前删

折叠光标上的**无修饰物理 Backspace**（`beforeinput` 的 `inputType` 为 `deleteContentBackward`）在 md 与 code 两种正文模式下 SHALL 只删除光标前的一个完整字素簇，步长 MUST 与 `⌃H` / `⌃D` 共用同一份扫描核（`src/quote-card.ts` 的 `clusterBackward`，`includeExtending=true`）；删除结果 MUST 等于 `doc.slice(0, prevCluster) + doc.slice(caret)`，光标 MUST 落在删除起点。MUST NOT 按渲染形状、widget 类型或字符类型猜删除粒度；MUST NOT 在本接管里维护第二份字素判定表。

一次删除 MUST 是一个撤销步：一次 undo 恢复删除前文档与选区，一次 redo 恢复删除后状态。dirty MUST 继续按当前文档与 `cleanDoc` 逐字比较；显式保存载荷 MUST 逐字等于当前 `EditorState.doc`。

IME 组合期（`view.compositionStarted` 与 `event.isComposing`）、只读会话与非空选区 MUST NOT 被本接管改变。**修饰键变体 MUST NOT 被本接管**：`⌥⌫` / `⌘⌫` 等以 `deleteWordBackward` / `deleteHardLineBackward` / `deleteSoftLineBackward` 等不同 `inputType` 到达，行为保持各引擎既有路径；forward Delete 与词删除变体不在本 requirement 内。

#### Scenario: RTL 附标与组合标记整簇删除

- **GIVEN** 文档为 `A مَ B` 或 `A שָׁ B`（阿拉伯文 / 希伯来文附标），或 `xe\u0301\u0323y`（重音 + 下点）
- **WHEN** 光标在簇之后按一次无修饰 Backspace
- **THEN** 文档分别变为 `A  B` 与 `xy`——base 与全部附标一起删除，MUST NOT 留下孤立附标
- **AND** 一次 undo 精确恢复原文；`⌘S` 的落盘全文等于当前 `EditorState.doc`

#### Scenario: emoji 修饰与 ZWJ 整簇删除

- **GIVEN** 文档为 `x👍🏽y`、`x👩🏽‍🚀y` 或 `a👨‍👩‍👧‍👦b`
- **WHEN** 光标在簇之后按一次无修饰 Backspace
- **THEN** 文档分别变为 `xy`、`xy`、`ab`——MUST NOT 只剩 base emoji 或半个 ZWJ 序列
- **AND** 一次 undo 复原；结果不得出现孤立代理项

#### Scenario: code 模式同判

- **GIVEN** 同一簇文档以非 md 扩展名打开（code 模式，无 replace 装饰）
- **WHEN** 光标在簇之后按一次无修饰 Backspace
- **THEN** 文档结果与 md 模式逐字节相同；一次 undo 复原
- **AND** code 模式不因本接管获得 M836 / M854 的选区或回读语义——那些仍只属 md 模式

#### Scenario: 修饰键变体、IME、只读与选区不受影响

- **GIVEN** `⌥⌫` / `⌘⌫` 输入、IME 组合期、只读会话或非空选区
- **WHEN** 执行删除输入
- **THEN** 既有路径与字节结果不变：`⌥⌫` / `⌘⌫` 不被本闸门消费（保持各引擎既有语义）、组合期删除交还输入法、只读会话不产生文档变更、非空选区删除见「跨渲染隐藏区的非空选区编辑」
