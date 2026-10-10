# fs-io 增量规格

> 起草注记（非规格正文）：本 change 为「粘贴剪贴板图片」补一件二进制**写**原语。design 见
> [design.md](../../design.md) §3–§4。基线正文在 `openspec/specs/fs-io/spec.md`
> （既有「二进制附件读取」只有读——本条 ADDED 不改动读侧任何口径）。节点 1 裁决后形态：
> 命名与转码收进后端，哈希以转码后字节计；目录必须已存在，不隐式建目录
> （原「自动建父目录」分叉随落盘位置裁为当前笔记同目录而消失）。

## ADDED Requirements

### Requirement: 二进制附件写入

系统 SHALL 提供 `fs_write_attachment(dir_rel, data_base64, source_mime)` command：
将 base64 解码后的剪贴板图片字节**转码压缩**后写入 vault 内指定**已存在**的相对目录，
返回 `{ path, name }`（最终 vault 相对路径与内容寻址文件名）。`dir_rel` SHALL 经
`resolve_in_vault` 全量逃逸防护（`..` 穿越、绝对路径、符号链接逃逸 MUST 拒绝），
MUST NOT 由调用方自觉保证；目录不存在时 SHALL 返回 `fs_not_found`，MUST NOT 隐式创建。

剪贴板字节解码后超过 50MB（与「二进制附件读取」同口径）时 SHALL 返回人话错误，
MUST NOT 分配对应内存。转码策略：默认目标格式为 **WebP 无损**（策略明细见 change
design §4，`image/png` 输入转码、`image/jpeg` / `image/webp` 原样落盘、其余 `image/*`
 子类型拒绝）；转码失败 SHALL 返回人话错误，MUST NOT 插引用留半截。

文件名 SHALL 为内容寻址形态 `pasted-<转码后字节 SHA-256 前 16 位十六进制>.<目标扩展名>`。
写入前 SHALL 先全 vault 按文件名探测：已存在即 MUST NOT 重复写盘，返回既有路径
（内容寻址保证同名同内容，按去重命中收敛）；探测后的写入仍撞名（并发竞态）时
MUST NOT 覆盖，同样按去重命中收敛。写入 MUST 为原子替换：内容先写入同目录临时文件
（`.{文件名}.lumir-{pid}`），再 rename 替换目标；写入或替换结果无法确认时 SHALL 返回
错误，MUST NOT 向用户报告成功。写入产生的文件系统变化 SHALL 经既有 watch 增量事件流
自然扩散（文件树刷新等消费方走既有口径）。

#### Scenario: 转码写入成功并可读回

- **WHEN** `fs_write_attachment("notes", <合法 png 的 base64>, "image/png")`，目录
  `notes/` 存在、全 vault 无同名文件
- **THEN** 落盘 `notes/pasted-<hash16>.webp`：字节为 WebP 格式、解码后像素与源 png
  逐像素一致（无损）；`<hash16>` 等于落盘字节的 SHA-256 前 16 位；返回的 `path` / `name`
  与该文件一致；同一相对路径经 `fs_read_attachment` 读回逐字节一致

#### Scenario: 全 vault 同名去重

- **WHEN** 同一 png 内容在第二个目录再次调用（全 vault 已存在其转码后同名文件）
- **THEN** 不重复写盘（首贴位置的文件 mtime 不变），返回既有路径

#### Scenario: 超限拒绝

- **WHEN** 解码后超过 50MB 的 base64 载荷
- **THEN** 返回人话错误，目标路径无任何文件创建或修改

#### Scenario: 目录不存在与逃逸路径拒绝

- **WHEN** `dir_rel` 不存在 / 为 `../../etc` / 绝对路径 / 指向 vault 外的符号链接
- **THEN** 返回 `CommandError`（目录不存在为 `fs_not_found`），不写入任何 vault 外内容、
  MUST NOT 隐式创建目录

#### Scenario: 不支持的输入格式

- **WHEN** `source_mime` 为 `image/x-unknown` 等未支持子类型
- **THEN** 返回人话错误，不猜扩展名、不落盘
