# fs-io 增量规格

## ADDED Requirements

### Requirement: 文件级操作（删除 / 重命名 / 新建 / 定位）

系统 SHALL 提供以下后端命令，全部只作用于 vault 内路径，安全边界与读取链路同源
（`resolve_in_vault` 或其新建变体）：删除（`fs_trash_entry`）、重命名（`fs_rename_entry`）、
新建文件（`fs_create_file`）、新建目录（`fs_create_dir`）、系统文件管理器定位
（`fs_reveal_in_finder`）。

- 删除 SHALL 为**移到系统废纸篓**（用户可经系统通道恢复），MUST NOT 提供永久删除路径；
  废纸篓失败 SHALL 报错且 MUST NOT 留下部分删除状态。
- 重命名 SHALL 只支持同目录改末段名；目标已存在 MUST NOT 覆盖。
- 新建 SHALL 使用原子创建语义（`create_new` 或等价），撞名即拒绝。
- 新建/改名的末段名 SHALL 校验：非空、不含 `/`、不是 `.`/`..`、不命中枚举忽略集
  （`IGNORED_NAMES`）。
- 目标解析 SHALL 经新建变体（父目录沿用 `resolve_in_vault` 全部逃逸防护，末段名按上条校验），
  MUST NOT 为写操作放松 vault 边界。
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

- **WHEN** 新建/改名的末段名为 `.git` / `.DS_Store` / `node_modules`
- **THEN** 返回 `fs_name_invalid`，文件系统不变

### Requirement: app 内文件操作的 tab 联动

app 内发起的重命名命中打开中的文档时，前端 SHALL 就地 remap 打开 session 的路径（文件 = 单
session 替换；目录 = 其下全部打开 session 的前缀替换），保留 dirty 内容、revision 基准、滚动
与光标状态；本次改名的 watcher 回响 SHALL 按命令返回的 old→new 对做一次性归因抑制，MUST NOT
触发「已被外部删除」处置。抑制条目消费即清或超时即清，MUST NOT 常驻。app 内发起的删除命中
打开中的文档时 SHALL 沿用既有 watcher 删除处置（tab 保留、自动保存暂停、提示内容未丢失），
不另开分支。外部发起的删除/改名 SHALL 完全沿用 watcher 现状处置。

#### Scenario: app 内改名打开中的文件不误报

- **WHEN** 打开中的 `a.md`（含未保存修改）经右键菜单改名为 `b.md`
- **THEN** tab 就地变为 `b.md`，未保存内容与编辑状态保留，全程无「已被外部删除」提示

#### Scenario: app 内改名目录联动深层 session

- **WHEN** 目录 `sub` 经右键菜单改名为 `sub2`，且 `sub/deep/a.md` 打开中
- **THEN** 该 session 路径前缀替换为 `sub2/deep/a.md`，状态保留，无误报

#### Scenario: app 内删除打开中的文件沿用现状处置

- **WHEN** 打开中的 `a.md` 经右键菜单确认删除
- **THEN** tab 保留、自动保存暂停、sticky 提示内容未丢失（与外部删除同一处置）
