# fs-io 增量规格

> 起草注记（非规格正文）：本 change 为 harness 的 `vault_move` 工具补跨目录移动原语
> `fs_move_entry`。design 见 [design.md](../../design.md) §5.2。基线正文在
> `openspec/specs/fs-io/spec.md`（「文件级操作」要求重命名只支持同目录——本条 ADDED 在其上扩展，
> 不改动既有重命名口径）。

## ADDED Requirements

### Requirement: 跨目录移动

系统 SHALL 提供后端命令 `fs_move_entry(root, from_rel, to_rel)`：源路径 SHALL 经 `resolve_in_vault` 解析（vault 内路径约束的全部逃逸防护），目标端 SHALL 复用新建变体的两段式解析（父目录经 `resolve_in_vault`、末段名经新建名校验）。目标撞名 MUST NOT 覆盖既有条目（写路径复查目标存在；该保证是「复查 + 极窄窗口」口径，不是原子保证，与既有重命名同纪律）。目标父目录 MUST 已存在，MUST NOT 隐式创建。跨卷移动 SHALL 如实报错（`fs_move_failed`），MUST NOT 静默退化为 copy+delete（不允许半移动状态）。app 内移动命中打开中的文档时，打开 session 的路径联动 SHALL 走 watch 增量事件流既有口径（与重命名同路）。

#### Scenario: 跨目录移动成功

- **WHEN** `fs_move_entry` 收到 `from_rel = "drafts/a.md"` 与 `to_rel = "notes/2026/a.md"`（两端均在 vault 内、目标父目录存在、目标不存在）
- **THEN** 条目移动到目标路径，源路径消失，返回移动后的 vault 相对路径

#### Scenario: 撞名不覆盖

- **WHEN** 目标路径已有同名条目时调用 `fs_move_entry`
- **THEN** 返回 `fs_already_exists`，源与目标均逐字节不变

#### Scenario: 逃逸路径拒绝

- **WHEN** `fs_move_entry` 的任一路径参数含 `..` 或绝对路径
- **THEN** 返回 `fs_path_escape`（或既有等价错误码），文件系统不变

#### Scenario: 跨卷如实失败

- **WHEN** 移动跨文件系统且底层 rename 失败
- **THEN** 返回 `fs_move_failed`；源与目标均不变，MUST NOT 出现源已删目标未建的半态
