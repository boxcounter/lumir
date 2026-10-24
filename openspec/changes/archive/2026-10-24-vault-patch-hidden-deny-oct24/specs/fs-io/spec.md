# fs-io 增量规格

> 起草注记（非规格正文）：本 change 只改两条 requirement——「局部 patch 写入」与「文件级操作
> （删除 / 重命名 / 新建 / 定位）」。两个 MODIFIED 块均按当前 living spec
> （`openspec/specs/fs-io/spec.md`，master `36716305`）的原文**整块复制**后增补，未改动的段落逐字保留。
> 机制与审计结论见 [proposal.md](../../proposal.md)。

## MODIFIED Requirements

### Requirement: 文件级操作（删除 / 重命名 / 新建 / 定位）

系统 SHALL 提供以下后端命令，全部只作用于 vault 内路径，安全边界与读取链路同源
（`resolve_in_vault` 或其新建变体）：删除（`fs_trash_entry`）、重命名（`fs_rename_entry`）、
新建文件（`fs_create_file`）、新建目录（`fs_create_dir`）、系统文件管理器定位
（`fs_reveal_in_finder`）。

- 删除 SHALL 为**移到系统废纸篓**（用户可经系统通道恢复），MUST NOT 提供永久删除路径；
  废纸篓失败 SHALL 报错且 MUST NOT 留下部分删除状态。
- 重命名 SHALL 只支持同目录改末段名；目标已存在 MUST NOT 覆盖。
- 新建 SHALL 使用原子创建语义（`create_new` 或等价），撞名即拒绝。
- 新建/改名的末段名 SHALL 校验：非空、不含 `/`、不是 `.`/`..`、不命中 **`hidden` 档（含恒定临时文件模式）**。命中 `lazy` 档或用户规则的名字 MUST NOT 被拒绝（那是可见、可打开的名字，只是不进索引）。
- **无名字级写操作特判**（2026-10-17 节点 1 裁决）：删除 / 重命名 / 移动 / 新建 MUST NOT 对特定名字（含 `.git`）做额外拦截——是否可操作只取决于该名字是否在可见集里。`.git` 默认在 `hidden` 档，因此默认没有行、写操作被末段名校验拒绝（**已存在的**条目见下一条）；用户把它配置成可见后，它就是普通条目。
- **既有条目的 `hidden` 档判定**：删除的目标、重命名的**源**、移动的**源与目标路径**（含目标父段）命中 `hidden` 档 SHALL 返回 `fs_name_invalid`，文件系统不变。理由与上一条同源：这类条目在枚举结果里没有行，用户既看不到也点不到，删除 / 改名 / 移动它没有正当入口；这条判定同时是 `hidden` 档写入面的入口闸（隐藏的仓库配置文件可被改写 + 只读命令执行仓库配置 = 零批准执行链，2026-10-24 立项）。判定 SHALL 复用装载时那**一份**忽略策略，MUST NOT 自建名字名单（含 `.git` 的硬编码拦截）；用户把该名字配置成可见后，它与普通条目等价。
- **判定按文件系统身份，不按显示名**：`hidden` 判定 SHALL **大小写不敏感**——macOS 默认文件系统大小写不敏感，`.GIT` 与 `.git` 是同一个条目，按字符串大小写敏感判定会让变体路径整体绕闸（2026-10-24 r1 实证）。这一条只约束写入口；枚举分类的名字匹配口径不变（大小写敏感，见「全类型递归枚举」的已知边界）。既有目标 SHALL 还按**解析后的真实路径**判一次（`resolve_in_vault` 的 canonical 结果折回 vault 相对路径）——vault 内的可见名字可以是指向 `hidden` 条目的符号链接，字符串判定看不出来；删除用的是 canonical 路径，只判字符串会把真的是 `hidden` 的目录搬进废纸篓。
- 目标解析 SHALL 经新建变体（父目录沿用 `resolve_in_vault` 全部逃逸防护，末段名按上条校验），
  MUST NOT 为写操作放松 vault 边界。父目录补建时 SHALL 逐段拒绝 `hidden` 档名字；`lazy` 档名字允许作为父段（建出来的条目随该目录惰性）。
- 失败 SHALL 返回人话 `CommandError`（区分 `fs_not_found` / `fs_already_exists` /
  `fs_name_invalid` / `fs_trash_failed` 等错误码）。

#### Scenario: 删除进废纸篓且可恢复

- **WHEN** 用户确认删除文件 `a.md`
- **THEN** `a.md` 从 vault 消失并进入系统废纸篓；若废纸篓调用失败，文件保持原样并返回
  `fs_trash_failed`

#### Scenario: 改名撞名拒绝

- **WHEN** 重命名目标名与既有条目同名
- **THEN** 返回 `fs_already_exists`，两个条目逐字节不变

#### Scenario: 逃逸路径拒绝

- **WHEN** 任一文件级命令收到含 `..` 或绝对路径的输入
- **THEN** 返回 `fs_path_escape`，文件系统不变

#### Scenario: 忽略集名拒绝

- **WHEN** 新建 / 改名的末段名为 `.git` 或 `.DS_Store`
- **THEN** 返回 `fs_name_invalid`，文件系统不变

#### Scenario: 惰性档名允许

- **WHEN** 新建 / 改名的末段名为 `node_modules`（缺省配置下属惰性档）
- **THEN** 操作成功（该名字惰性可见、可打开，只是不进索引）

#### Scenario: 既有隐藏条目的删除 / 改名 / 移动拒绝

- **WHEN** 删除或改名的源、或移动的源路径命中 `hidden` 档（如 `.git/HEAD`、`sub/.git/x.md`、
  `.DS_Store`）
- **THEN** 返回 `fs_name_invalid`，源条目逐字节不变、目标路径不存在

#### Scenario: 移进隐藏目录拒绝

- **WHEN** 移动的目标路径某一段命中 `hidden` 档（如 `note.md` → `.git/objects/info`）
- **THEN** 返回 `fs_name_invalid`，`note.md` 仍在原位，隐藏目录下不出现新条目

#### Scenario: 配置成可见后既有条目按普通条目处理

- **WHEN** 用户把 `.git` 从 `hidden` 档移出（`vault.ignore` 里不再列为 `hidden`），对 `.git/HEAD`
  发起改名
- **THEN** 改名照常成功（判定随装载时的忽略策略走，MUST NOT 是硬编码 `.git` 名单）

#### Scenario: 大小写变体同样拒绝

- **WHEN** 删除 / 改名 / 移动的目标或源写成大小写变体（如 `.GIT`、`.Git/HEAD`，或新建 / 移动
  目标的父段写成 `.GIT`）
- **THEN** 返回 `fs_name_invalid`，文件系统不变（大小写不敏感的文件系统上它与 `hidden` 档
  命中是同一个条目）

#### Scenario: 符号链接指向隐藏条目不穿透

- **WHEN** vault 内的可见名字是指向 `hidden` 条目的符号链接（如 `repo-link` → `.git`、
  `doc-link.md` → `.git/config`），对它们发起删除 / 改名 / 移动
- **THEN** 返回 `fs_name_invalid`，链接与其真实目标都保持原样

### Requirement: 局部 patch 写入

系统 SHALL 提供 `fs_patch_file(path, edits: [{old_string, new_string}], revision)` 库函数：对 vault 内既有文本文件应用一组编辑。每个 `old_string` SHALL 在**应用它的那一刻**的文本中**恰好命中一次**——零次或多次命中 SHALL 拒绝整组编辑并返回带命中次数与编辑序号的人话错误；编辑按数组顺序逐个应用（后一条看得到前一条的结果）；空 `edits` 或空 `old_string` SHALL 拒绝（空串没有唯一命中语义，MUST NOT 退化成插入）。替换后未触及部分 SHALL 逐字节不变（ADR 0003 §3 在 agent 写入侧的延伸）。image/binary 扩展名 SHALL 拒绝（沿用 `fs_read_only` 口径），判定先于任何 IO。

patch SHALL 携带调用方持有的 revision（SHA-256），与 `document_save` 同一套 compare-and-swap 口径：冲突返回 `document_conflict`，文件逐字节不变。

落盘 SHALL 走与保存**同一个写核心**（同目录 `.lumir-` 临时文件 + 原子 rename + ghost 重试），因此写入过程 MUST NOT 在文件树或 `fs:entry_changed` 事件流里产生临时条目（写盘方的自身标记被既有忽略集挡下）；patch 完成后 SHALL 有目标文件的一条 `modified` 增量进入事件流。被 patch 文件若有打开的编辑器会话，系统 SHALL 经该既有通路（`fs:entry_changed` 的外部变更分流：未 dirty 自动重载、dirty 交用户选择）同步编辑器内容，MUST NOT 绕过通路只改盘而不更新会话。

patch 的目标路径 SHALL 按 **`hidden` 档（含恒定临时文件模式，含任一祖先段）** 判定：命中 SHALL 返回 `fs_name_invalid`，判定 MUST 在读取文件内容与任何写入之前。这类条目在枚举结果里没有行（见「全类型递归枚举」），改写它等于静默改动用户看不见的东西——隐藏的仓库配置文件被改写 + 只读命令执行仓库配置即经此处走通（2026-10-24 立项）。判定 SHALL 复用装载时那**一份**忽略策略，MUST NOT 自建名字名单；用户把该名字配置成可见后，patch 按普通文件处理。判定 SHALL 按文件系统身份做（大小写不敏感 + 按 canonical 真身再判一次，口径同「文件级操作（删除 / 重命名 / 新建 / 定位）」的对应条款）：`.GIT/config` 与「可见名字是指向 `.git/config` 的符号链接」两种形态都 MUST 被拒。

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

#### Scenario: hidden 档既有文件拒绝 patch

- **WHEN** patch 的目标路径命中 `hidden` 档（如 `.git/config`，或 `sub/.git/x.md` 这类祖先段命中）
- **THEN** 返回 `fs_name_invalid`，文件逐字节不变、revision 不变，且不进入读取内容之后的任何步骤；
  同一份策略下普通既有文件照常可 patch

#### Scenario: hidden 档的大小写变体拒绝 patch

- **WHEN** 目标写成大小写变体（如 `.GIT/config`；大小写不敏感的文件系统上它就是 `.git/config`）
- **THEN** 返回 `fs_name_invalid`，目标文件逐字节不变、revision 不变

#### Scenario: 符号链接指向隐藏文件拒绝 patch

- **WHEN** patch 的目标是 vault 内的符号链接，其 canonical 落点命中 `hidden` 档（如
  `doc-link.md` → `.git/config`）
- **THEN** 返回 `fs_name_invalid`，链接与其真实目标都逐字节不变

#### Scenario: 配置成可见后按普通文件 patch

- **WHEN** 用户把 `.git` 从 `hidden` 档移出（`vault.ignore` 里不再列为 `hidden`），对 `.git/config`
  发起 patch
- **THEN** 编辑照常落盘、revision 前进（判定随装载时的忽略策略走，MUST NOT 是硬编码 `.git` 名单）

#### Scenario: 临时条目不入事件流

- **WHEN** patch 落盘（写入临时文件并原子替换目标）
- **THEN** `fs:entry_changed` 流里只有目标文件的 `modified` 增量，不含任何 `.lumir-` 临时条目

#### Scenario: 打开中会话同步

- **WHEN** patch 命中一个已打开的文档
- **THEN** 编辑器内容经既有外部变更分流与该文件的新内容收敛（未 dirty 自动重载；dirty 时由用户选择重载或保留），MUST NOT 出现「磁盘已变而编辑器仍停在旧内容」的静默分歧
