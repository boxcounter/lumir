## MODIFIED Requirements

### Requirement: 跨 replace 装饰的跨行删除

任意落到浏览器原生路径的**跨行合并**删除——空光标在行尾的 forward Delete（吸收下一行），或在行首的 Backspace / `⌘⌫`（吸收本行）——SHALL 只删除两端之间那一个换行。被吸收行的其他源码 MUST 逐字节保留，包括 replace widget 覆盖的源片段（列表 marker、`[[wikilink]]`、行内 `$公式$`、链接尾标）与隐藏的源码标记（`**`、`#`、`>`）；MUST NOT 把渲染层显示文本（marker glyph `–` / `◦`、wikilink label、公式渲染文本、链接尾标 `→`）写进文档，MUST NOT 因浏览器重建行 DOM 而拆行或增删换行。

接管判据 SHALL 只读 `EditorState`（空光标、恰在行边界、被吸收一侧确有行），MUST NOT 检测 widget 类型、replace 装饰数量或 DOM/AX 的文本形状，也 MUST NOT 按显示字形猜编辑意图（与「DOM/AX 不是文档真源」同源）。因此纯文本行的事务结果 MUST 与原生删除逐字节相同，新增 widget 类型自然落在类内、不需要逐类登记。

一次跨行删除 MUST 是一个撤销步：一次 undo 恢复删除前文档与选区，一次 redo 恢复删除后状态。dirty MUST 继续按当前文档与 `cleanDoc` 逐字比较；显式保存载荷 MUST 逐字等于当前 `EditorState.doc`。行内删除（不跨行）、IME 组合期删除、只读会话与多区间选区 MUST NOT 被本接管改变——实测它们不会重建被吸收行的 DOM；**非空选区删除**改由「跨渲染隐藏区的非空选区删除」接管。跨行删除的专项不变量见 `docs/specs/lists.md` L7；**非空选区删除**的判据以本 requirement 与 `src/editor.ts` 的闸门注释为准（L7 目前仍写着「非空选区不在本条内」，该句在 M854 后已过时，属 docs/specs 的后续同步项，不在本 mission 的写面内）。

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
- **AND** 行内（不跨行）删除与 IME 组合期删除保持既有路径；非空选区删除见「跨渲染隐藏区的非空选区删除」

## ADDED Requirements

### Requirement: 跨渲染隐藏区的非空选区删除

任意删除类输入（Backspace / Delete、词删除、行删除变体）在 `EditorState` 存在**非空选区**时 SHALL NOT 落到浏览器原生编辑路径。编辑器 MUST `preventDefault` 并按 `state.selection` 的源码字节 dispatch 一个显式事务：文档结果 MUST 恰好等于 `doc.slice(0, from) + doc.slice(to)`（多区间时为各区间依次删除），MUST NOT 把 replace 装饰的渲染文本（表格 cell 文本、列表 marker glyph、wikilink label、公式渲染文本）写进文档，MUST NOT 因选区端点落在隐藏区间而拆行、吞管道符或删掉选区之外的源码。

接管判据 SHALL 只读 `EditorState`（选区非空、删除类 inputType），MUST NOT 检测 widget 类型、replace 装饰数量或 DOM/AX 的文本形状，也 MUST NOT 按渲染形状猜删除粒度；方向（正向 / 反向选区）与输入类型（Delete / Backspace / 词 / 行删除）MUST 不改变合同。普通单区间选区的字节结果 MUST 与原生删除相同；IME 组合期、只读会话与多区间选区 MUST 保持既有语义（只读不生效、组合期交还输入法、多区间按 state 逐区间删除）。

一次选区删除 MUST 是一个撤销步：一次 undo 恢复删除前文档（与选区），一次 redo 恢复删除后状态。dirty MUST 按当前文档与 `cleanDoc` 逐字比较；显式保存载荷 MUST 逐字等于当前 `EditorState.doc`。

#### Scenario: 表格跨行选区删除

- **GIVEN** 文档为 `| a | b |\n| --- | --- |\n| c | d |\n`，且表格以 grid 渲染、分隔行整行被 replace 覆盖
- **WHEN** 选区覆盖 `[2,32)`（表头 cell 内容到数据行末管道）并按 Backspace 或 Delete
- **THEN** 文档变为 `| |\n`——只删选区源码字节，MUST NOT 出现 `| \n|\n` 一类被重建的表格行
- **AND** 一次 undo 恢复原文；`⌘S` 的落盘全文等于当前 `EditorState.doc`

#### Scenario: 混合列表与 marker 内部端点

- **GIVEN** 文档为 `- a\n- b\n\n1. c\n`，有序项 marker 以 replace widget 隐藏
- **WHEN** 选区为 `[3,9)`（bullet 内容中间到有序项行首）或 `[2,10)`（终点落在 marker 内部）并按 Backspace
- **THEN** 文档分别变为 `- a1. c\n` 与 `- . c\n`（源码精确删除，MUST NOT 多出换行或丢空格）
- **AND** 反向选区（head < anchor）得到同一文档结果与同一落点

#### Scenario: 普通选区、只读与 IME 不受影响

- **GIVEN** 无 replace 装饰的普通文本，或外部只读会话，或 IME 组合期
- **WHEN** 执行删除类输入
- **THEN** 普通选区的字节结果与原生删除相同；只读会话不产生文档变更；组合期删除交还输入法既有路径
