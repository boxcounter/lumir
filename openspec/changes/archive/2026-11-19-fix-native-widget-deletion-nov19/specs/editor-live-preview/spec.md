## ADDED Requirements

### Requirement: 跨 replace 装饰的跨行删除

任意落到浏览器原生路径的**跨行合并**删除——空光标在行尾的 forward Delete（吸收下一行），或在行首的 Backspace / `⌘⌫`（吸收本行）——SHALL 只删除两端之间那一个换行。被吸收行的其他源码 MUST 逐字节保留，包括 replace widget 覆盖的源片段（列表 marker、`[[wikilink]]`、行内 `$公式$`、链接尾标）与隐藏的源码标记（`**`、`#`、`>`）；MUST NOT 把渲染层显示文本（marker glyph `–` / `◦`、wikilink label、公式渲染文本、链接尾标 `→`）写进文档，MUST NOT 因浏览器重建行 DOM 而拆行或增删换行。

接管判据 SHALL 只读 `EditorState`（空光标、恰在行边界、被吸收一侧确有行），MUST NOT 检测 widget 类型、replace 装饰数量或 DOM/AX 的文本形状，也 MUST NOT 按显示字形猜编辑意图（与「DOM/AX 不是文档真源」同源）。因此纯文本行的事务结果 MUST 与原生删除逐字节相同，新增 widget 类型自然落在类内、不需要逐类登记。

一次跨行删除 MUST 是一个撤销步：一次 undo 恢复删除前文档与选区，一次 redo 恢复删除后状态。dirty MUST 继续按当前文档与 `cleanDoc` 逐字比较；显式保存载荷 MUST 逐字等于当前 `EditorState.doc`。行内删除（不跨行）、非空选区删除、IME 组合期删除、只读会话与多区间选区 MUST NOT 被本接管改变——实测它们不会重建被吸收行的 DOM。专项不变量与证伪口径见 `docs/specs/lists.md` L7。

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
- **AND** 行内（不跨行）删除、非空选区删除与 IME 组合期删除保持既有路径，文档结果与输入前合同不变
