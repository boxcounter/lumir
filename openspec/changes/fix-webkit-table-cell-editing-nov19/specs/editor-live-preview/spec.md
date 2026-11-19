## ADDED Requirements

### Requirement: 表格 cell 内的原生键入与单字符删除

折叠光标落在 grid 表格 cell 的 slot 内时，浏览器原生路径的键入与单字符删除 SHALL 只改被点中的源字节：键入在光标处插入且 MUST NOT 改到相邻源字节（包括 cell 首尾的对齐空白与隐藏管道符）；Backspace MUST 只删光标前的一个源字节、Delete MUST 只删光标后的一个源字节，字素簇口径与 `⌃H` / `⌃D` 相同。MUST NOT 跨过隐藏管道符、换行或分隔行，MUST NOT 把渲染态 cell 文本 / 对齐空白 / 表格结构写回源码。

接管判据 SHALL 只读 `EditorState`（单折叠光标 + cell 归属），MUST NOT 检测 DOM / AX 的文本形状、MUST NOT 按字符类型或渲染字形猜编辑意图，也 MUST NOT 引入第二套 caret 模型——cell 归属、slot 与内容区间 MUST 复用 `src/cell-geometry.ts` 的既有纯位置判定（与 ⌃E / 删除命令同一份）。因此结果在两引擎上 SHALL 逐字节一致：chromium 的原生路径本来就正确，WebKit 的原生 target range 会跨过零宽 replace 覆盖的隐藏源码（M842 现场），接管后两者同合同。

一次键入或删除 MUST 是一个撤销步：一次 undo 恢复编辑前文档与选区，一次 redo 恢复编辑后状态。dirty MUST 继续按当前文档与 `cleanDoc` 逐字比较；显式保存载荷 MUST 逐字等于当前 `EditorState.doc`。非空选区（归选区删除的通用接管）、IME 组合期、只读会话与多区间选区 MUST NOT 被本接管改变。

#### Scenario: 数据 cell 内容尾缘键入

- **GIVEN** 文档为 `| a | b |\n| --- | --- |\n| c | d |\n`，表格渲染为 grid，光标在数据 cell 内容右缘（`c` 之后、尾部对齐空白之前）
- **WHEN** 键入 `Q`
- **THEN** 文档变为 `| cQ | d |`——插入只在光标处发生，尾部对齐空白与管道符逐字节保留
- **AND** 选区落在插入字符之后；一次 undo 恢复原文与编辑前选区

#### Scenario: 数据 cell 内容首缘 Backspace

- **GIVEN** 同一文档，光标在数据 cell 内容左缘（`c` 之前、首部对齐空白之后）
- **WHEN** 按 Backspace
- **THEN** 文档变为 `|c | d |`——只删光标前的那一个源空白，MUST NOT 跨过隐藏管道符、换行或分隔行
- **AND** 表格仍渲染为 grid（未降级为原始 Markdown）；一次 undo 恢复原文

#### Scenario: 数据 cell 内容尾缘 Delete

- **GIVEN** 同一文档，光标在数据 cell 内容右缘
- **WHEN** 按 forward Delete
- **THEN** 文档变为 `| c| d |`——只删光标后的那一个源空白，MUST NOT 跨进下一 cell 删掉隐藏管道
- **AND** 一次 undo 恢复原文

#### Scenario: 表头 cell 与数据 cell 同合同

- **GIVEN** 同一文档，光标在表头 cell `a` 的内容右缘
- **WHEN** 键入 `Q`
- **THEN** 文档变为 `| aQ | b |\n| --- | --- |\n| c | d |\n`，与数据 cell 的契约逐字节一致
- **AND** 表头 cell 的 Backspace / Delete 同样只改相邻一个源字节

#### Scenario: 保存与撤销

- **GIVEN** 上述任一编辑完成且文档已标脏
- **WHEN** 按 `⌘S` 保存
- **THEN** 盘上全文逐字节等于当前 `EditorState.doc`
- **AND** 一次 undo 后盘上内容不变（撤销不写盘）
