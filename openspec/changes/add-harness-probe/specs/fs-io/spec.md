# fs-io 增量规格

> 起草注记（非规格正文）：一条 ADDED，基线是 living spec [openspec/specs/fs-io/spec.md](../../../../specs/fs-io/spec.md)
> 的「写入侧既有能力」（整文件 `document_save` + CAS）。本增量为 harness 提供局部写能力；
> 「局部 patch 是唯一写既有文档的能力」的边界由 harness spec 的「写入批准闸」与工具集条款封顶，
> 此处只定义写入机制本身。

## ADDED Requirements

### Requirement: 局部 patch 写入

系统 SHALL 提供 `fs_patch_file` command：对 vault 内既有文本文件应用一组编辑 `[{old_string, new_string}]`——每个 `old_string` 必须在文件中**恰好命中一次**（零次或多次命中 SHALL 拒绝并返回带原因的错误），替换后未触及部分 SHALL 逐字节不变（ADR 0003 §3 在 agent 写入侧的延伸）。image/binary 扩展名 SHALL 拒绝（沿用 `fs_read_only` 口径）。

patch SHALL 携带调用方持有的 revision（SHA-256），与 `document_save` 同一套 compare-and-swap 口径：冲突返回 `document_conflict`。落盘 SHALL 走与保存相同的「自身写盘」标记，MUST NOT 触发 watch 回声重载；被 patch 文件若有打开的编辑器会话，系统 SHALL 经既有会话刷新通路同步编辑器内容，MUST NOT 绕过编辑器直接改盘而不更新会话。

#### Scenario: 唯一命中替换

- **WHEN** 对文件应用一个 `old_string` 唯一命中的编辑
- **THEN** 命中处被替换，文件其余部分 sha256 逐段不变，revision 前进

#### Scenario: 非唯一命中拒绝

- **WHEN** `old_string` 在文件中出现零次或多次
- **THEN** 拒绝整组编辑，文件逐字节不变，错误中指明命中次数

#### Scenario: revision 冲突

- **WHEN** patch 携带的 revision 与当前文件不一致
- **THEN** 返回 `document_conflict`，文件不变，由调用方重读后重试
