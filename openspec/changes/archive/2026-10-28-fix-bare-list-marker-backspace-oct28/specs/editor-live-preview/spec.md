## ADDED Requirements

### Requirement: 裸 marker 行的 Backspace 删除

在可编辑 md 会话的裸 marker 行上，当主选区为空光标且位于内容起点（marker 与其后空白之后、正文之前）时，`Backspace` SHALL 在上游 Markdown 删除命令之前接管：单次事务删除当前 marker 与其后空白，保留引用前缀 / 行首缩进，光标落在删除起点。第一次按键 MUST 产生该文档变更，不得要求第二次按键才生效。

非裸 marker 行、语法树已接管的真列表 / 引用、非空选区、光标位于正文其他位置及只读会话 MUST NOT 被该分派接管；它们继续走既有上游命令或原生删除路径。该行为不随 `editor.auto_indent` 改变，不新增统一键位表命令 id。

#### Scenario: 段落后裸空标记第一次 Backspace 即删除

- **WHEN** 文档为 `para\n1. `，空光标位于 `1. ` 之后，按一次 `Backspace`
- **THEN** 文档变为 `para\n`，行数不变，光标位于原空行行首，且只有一次删除事务

#### Scenario: 带内容裸 marker 行保留前缀与正文

- **WHEN** 在 `para\n2. abc` 的内容起点，或 `> para\n> 1. ` 的空标记之后按一次 `Backspace`
- **THEN** 只删除 marker 与其后空白：分别得到 `para\nabc`、`> para\n> `，正文 / 引用前缀保留，光标位于删除起点

#### Scenario: 非裸行与只读会话不被接管

- **WHEN** 光标位于真列表标记后、裸行正文末尾、非空选区，或会话为只读
- **THEN** 裸 marker Backspace 分派返回未命中，不自行产生文档变更；可编辑非裸行走既有删除路径，只读会话文档逐字节不变
