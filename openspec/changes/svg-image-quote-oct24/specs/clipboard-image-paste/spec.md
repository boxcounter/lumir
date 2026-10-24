# clipboard-image-paste 增量规格（M666）

> 起草注记（非规格正文）：一条 MODIFIED，基线是 living spec
> [openspec/specs/clipboard-image-paste/spec.md](../../../../specs/clipboard-image-paste/spec.md)。
> 为什么这个 change 要改粘贴链路的规格：**粘贴与引用共用同一个写入口**（`fs_write_attachment` /
> `harness_write_image` 背后的 `fs_io::ATTACHMENT_TARGETS`），「哪些源格式可写、各自怎么转码」这
> 句话在 living spec 里同时出现在 fs-io 与本文两处。只改 fs-io 会留下「规格说拒绝 svg、代码在
> 栅格化」的矛盾（REVIEW.md「同一语义两处真源」条）。
>
> 正文逐段抄自 living「转码压缩」，**只改「其余 `image/*` 子类型 SHALL 拒绝」那一段**（补上 svg
> 的栅格化档与指针），其余段落与两个场景逐字未动，供 `scripts/openspec-archive-check.mjs` 对账。
> 粘贴链路的人侧行为不变：macOS 剪贴板里的图片数据是位图，svg 只会作为**文件**被粘贴（走文件
> 路径而非本链路），栅格化档因此在本链路上是一条兜底口径而不是新的用户可见能力。

## MODIFIED Requirements

### Requirement: 转码压缩

剪贴板图片字节原样可能巨大（macOS 系统截图进剪贴板为 Retina 物理像素的无损
RGBA，1280×960 逻辑尺寸实测达 18.8MB），系统 SHALL **转码压缩后落盘**，MUST NOT
原样落盘剪贴板字节。默认目标格式 SHALL 为 **WebP 无损**：截图含文字，有损 JPEG
不适合；WebP 无损逐像素保真且体积显著小于 PNG；质量档位或有损选项首版 MUST NOT
开放配置。`image/png` 输入 SHALL 转码 WebP 无损；`image/jpeg` 与 `image/webp` SHALL
原样落盘（已是压缩格式，再编码只损画质）；`image/svg+xml` 输入 SHALL 先栅格化成位图再
转码（MUST NOT 原样落盘 SVG 字节；安全边界与失败面见 fs-io 的「SVG 源的栅格化与安全
边界」）；其余 `image/*` 子类型 SHALL 拒绝并给人话反馈。转码失败 MUST NOT 插入引用、
MUST NOT 留半截文件。分辨率 MUST NOT 降采样（保留原始像素）。

#### Scenario: 大图转码后显著变小

- **WHEN** 剪贴板置一张 2560×1920（Retina 2x）的类截图 png（原始字节约 15–20MB 级）
- **THEN** 落盘文件为 WebP 无损、解码像素与源逐像素一致，且落盘字节远小于剪贴板
  原始字节（实现期 S5 场景填实测比值）

#### Scenario: 转码失败不留半截

- **WHEN** 剪贴板字节损坏无法解码
- **THEN** 给人话 toast，文档不插引用、磁盘无临时文件残留
