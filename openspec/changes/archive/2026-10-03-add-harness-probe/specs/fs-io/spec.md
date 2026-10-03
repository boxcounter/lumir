# fs-io 增量规格

> 起草注记（非规格正文）：两条 ADDED，基线是 living spec [openspec/specs/fs-io/spec.md](../../../../../specs/fs-io/spec.md)
> 的「文档保存与冲突恢复」（整文件 `document_save` + CAS）与「文件级操作」（新建空文件）。
> 本增量为 harness 提供局部写与带内容新建两个写能力；
> 「局部 patch 是唯一写既有文档的能力」的边界由 harness spec 的「写入批准闸」与工具集条款封顶，
> 此处只定义写入机制本身。两个函数都是**库函数**（harness 工具层调用），不是 Tauri command。

## ADDED Requirements

### Requirement: 局部 patch 写入

系统 SHALL 提供 `fs_patch_file(path, edits: [{old_string, new_string}], revision)` 库函数：对 vault 内既有文本文件应用一组编辑。每个 `old_string` SHALL 在**应用它的那一刻**的文本中**恰好命中一次**——零次或多次命中 SHALL 拒绝整组编辑并返回带命中次数与编辑序号的人话错误；编辑按数组顺序逐个应用（后一条看得到前一条的结果）；空 `edits` 或空 `old_string` SHALL 拒绝（空串没有唯一命中语义，MUST NOT 退化成插入）。替换后未触及部分 SHALL 逐字节不变（ADR 0003 §3 在 agent 写入侧的延伸）。image/binary 扩展名 SHALL 拒绝（沿用 `fs_read_only` 口径），判定先于任何 IO。

patch SHALL 携带调用方持有的 revision（SHA-256），与 `document_save` 同一套 compare-and-swap 口径：冲突返回 `document_conflict`，文件逐字节不变。

落盘 SHALL 走与保存**同一个写核心**（同目录 `.lumir-` 临时文件 + 原子 rename + ghost 重试），因此写入过程 MUST NOT 在文件树或 `fs:entry_changed` 事件流里产生临时条目（写盘方的自身标记被既有忽略集挡下）；patch 完成后 SHALL 有目标文件的一条 `modified` 增量进入事件流。被 patch 文件若有打开的编辑器会话，系统 SHALL 经该既有通路（`fs:entry_changed` 的外部变更分流：未 dirty 自动重载、dirty 交用户选择）同步编辑器内容，MUST NOT 绕过通路只改盘而不更新会话。

#### Scenario: 唯一命中替换

- **WHEN** 对文件应用一个 `old_string` 唯一命中的编辑
- **THEN** 命中处被替换，文件其余部分逐字节不变（前后两段与原文 sha256 相同），revision 前进

#### Scenario: 非唯一命中拒绝

- **WHEN** `old_string` 在文件中出现零次或多次
- **THEN** 拒绝整组编辑（含数组中先前的合法编辑也不落盘），文件逐字节不变、revision 不变，错误中指明命中次数与编辑序号

#### Scenario: revision 冲突

- **WHEN** patch 携带的 revision 与当前文件不一致
- **THEN** 返回 `document_conflict`，文件不变，由调用方重读后重试

#### Scenario: image/binary 拒绝

- **WHEN** 目标路径的扩展名属于 image/binary 拒绝清单（如 `.png` / `.pdf` / `.zip`）
- **THEN** 返回 `fs_read_only`，不写入任何字节，且不因目标不存在而返回 `fs_not_found`

#### Scenario: 临时条目不入事件流

- **WHEN** patch 落盘（写入临时文件并原子替换目标）
- **THEN** `fs:entry_changed` 流里只有目标文件的 `modified` 增量，不含任何 `.lumir-` 临时条目

#### Scenario: 打开中会话同步

- **WHEN** patch 命中一个已打开的文档
- **THEN** 编辑器内容经既有外部变更分流与该文件的新内容收敛（未 dirty 自动重载；dirty 时由用户选择重载或保留），MUST NOT 出现「磁盘已变而编辑器仍停在旧内容」的静默分歧

### Requirement: 新建文档（含内容，O_EXCL）

系统 SHALL 提供 `vault_create_file(path, content)` 库函数：按显式 vault 相对路径新建文档并写入内容，使用原子创建语义（`create_new`）——目标已存在 SHALL 返回 `fs_already_exists`，MUST NOT 覆盖既有文件或目录的任何字节。

目标 SHALL 经既有新建变体解析（父目录沿用 `resolve_in_vault` 的全部逃逸防护，末段名按内置忽略名校验）；父目录 MUST NOT 被隐式创建，不存在时返回 `fs_not_found`。路径的**父段** MUST NOT 命中内置忽略名（如 `.git/new.md`、`node_modules/x.md`）：建在忽略子树里的文件不出现在文件树里、用户也删不掉，属静默丢失。image/binary 扩展名 SHALL 拒绝（`fs_read_only`）。写入或落盘失败 SHALL 删除刚建出的文件，MUST NOT 留下半截内容。

#### Scenario: 新建成功且不覆盖

- **WHEN** 对不存在的路径调用一次 `vault_create_file`，随后对同一路径再调用一次
- **THEN** 第一次创建成功并写入内容；第二次返回 `fs_already_exists`，文件内容仍是第一次写入的那一份

#### Scenario: 非法目标各归其错误码

- **WHEN** 目标为不存在父目录下的路径 / 含 `..` 或绝对路径 / 末段或父段命中内置忽略名 / image-binary 扩展名 / 空路径
- **THEN** 分别返回 `fs_not_found` / `fs_path_escape` / `fs_name_invalid` / `fs_read_only` / `fs_path_invalid`，且文件系统上不出现任何新条目
