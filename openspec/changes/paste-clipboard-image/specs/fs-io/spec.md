# fs-io 增量规格

> 起草注记（非规格正文）：本 change 为「粘贴剪贴板图片」补一件与
> `fs_read_attachment` 对称的二进制**写**原语。design 见
> [design.md](../../design.md) §3。基线正文在 `openspec/specs/fs-io/spec.md`
> （既有「二进制附件读取」只有读——本条 ADDED 不改动读侧任何口径）。

## ADDED Requirements

### Requirement: 二进制附件写入

系统 SHALL 提供 `fs_write_attachment(path, data_base64)` command：将 base64 解码后的
字节写入 vault 内指定相对路径，返回写入的 vault 相对路径。路径 SHALL 经
`resolve_in_vault` 全量逃逸防护（`..` 穿越、绝对路径、符号链接逃逸 MUST 拒绝），
MUST NOT 由调用方自觉保证。单附件大小 SHALL 设上限（50MB，与「二进制附件读取」同口径），
超限返回人话错误，MUST NOT 分配对应内存。

写入 MUST 为原子替换：内容先写入同目录临时文件（`.{文件名}.lumir-{pid}`），再 rename
替换目标；写入或替换结果无法确认时 SHALL 返回错误，MUST NOT 向用户报告成功。目标已存在
时 SHALL 返回 `fs_already_exists` 并 MUST NOT 覆盖既有条目。目标父目录缺失时 SHALL
自动创建（mkdir -p 语义），不另立建目录命令。写入产生的文件系统变化 SHALL 经既有 watch
增量事件流自然扩散（文件树刷新等消费方走既有口径）。

#### Scenario: 写入成功并可读回

- **WHEN** `fs_write_attachment("attachments/pasted-a1b2c3d4.png", <合法 base64>)`，
  目标不存在且父目录 `attachments/` 也不存在
- **THEN** 父目录自动创建、字节落盘；同一相对路径经 `fs_read_attachment` 读回逐字节一致；
  返回的相对路径与请求路径相同

#### Scenario: 超限拒绝

- **WHEN** 解码后超过 50MB 的 base64 载荷
- **THEN** 返回人话错误，目标路径无任何文件创建或修改

#### Scenario: 撞名不覆盖

- **WHEN** 目标路径已存在条目时调用 `fs_write_attachment`
- **THEN** 返回 `fs_already_exists`，既有条目逐字节不变

#### Scenario: 逃逸路径拒绝

- **WHEN** path 为 `../../etc/x.png`、绝对路径或指向 vault 外的符号链接
- **THEN** 返回 `CommandError`，不写入任何 vault 外内容
