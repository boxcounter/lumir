# fs-io 增量规格（M666）

> 起草注记（非规格正文）：一条 MODIFIED + 一条 ADDED，基线是 living spec
> [openspec/specs/fs-io/spec.md](../../../../../specs/fs-io/spec.md)。MODIFIED 是**整块替换**，下面
> 的正文逐段抄自 living「二进制附件写入」，只把「转码策略」一段改写为三档转换（其余段落与四个
> 场景逐字未动，供 `scripts/openspec-archive-check.mjs` 对账）。动机与取舍见
> [design.md](../../design.md) D1–D4。

## MODIFIED Requirements

### Requirement: 二进制附件写入

系统 SHALL 提供 `fs_write_attachment(dir_rel, data_base64, source_mime)` command：
将 base64 解码后的剪贴板图片字节**转码压缩**后写入 vault 内指定**已存在**的相对目录，
返回 `{ path, name }`（最终 vault 相对路径与内容寻址文件名）。`dir_rel` SHALL 经
`resolve_in_vault` 全量逃逸防护（`..` 穿越、绝对路径、符号链接逃逸 MUST 拒绝），
MUST NOT 由调用方自觉保证；目录不存在时 SHALL 返回 `fs_not_found`，MUST NOT 隐式创建。

剪贴板字节解码后超过 50MB（与「二进制附件读取」同口径）时 SHALL 返回人话错误，
MUST NOT 分配对应内存。格式判定 SHALL 先于解码与尺寸判定（「不支持的类型」与「太大」是两条
互不遮盖的失败面）。转换策略：默认目标格式为 **WebP 无损**——`image/png` 输入转码、
`image/jpeg` / `image/webp` 原样落盘、`image/svg+xml` 输入先**栅格化成位图**再转码（MUST NOT
原样落盘 SVG 字节，安全边界见下方「SVG 源的栅格化与安全边界」），其余 `image/*` 子类型拒绝；
转换失败 SHALL 返回人话错误，MUST NOT 插引用留半截。转换口径 SHALL 由写入口的格式表唯一决定，
vault 附件写入与 harness 图片存储两条调用链 MUST 走同一个转换入口，MUST NOT 各自实现一遍转码
策略。

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

## ADDED Requirements

### Requirement: SVG 源的栅格化与安全边界

写入口收到 `image/svg+xml` 时 SHALL 先把它**栅格化成位图**，再走既有的 png→WebP 转换与内容寻址
落盘链路：落盘文件 SHALL 是 `pasted-<hash16>.webp`（位图），**MUST NOT 原样落盘 SVG 字节**，也
MUST NOT 引入 SVG 专属的落盘扩展名 / 读回分支 / 缩略图分支（读回侧、投递与恢复因此零改动）。

栅格化 SHALL 遵守以下安全边界：

1. **外部资源 MUST NOT 被加载**：SVG 里的 `href` 一律不当文件路径解析——`file:` URI、绝对路径、
   相对路径与 `http(s)` 引用 MUST NOT 触发任何文件读取或网络请求；解析器默认的「把 href 当本地
   路径读取」行为 MUST NOT 保留。`data:` URI 是内联载荷（零 I/O），SHALL 照常渲染。
2. **尺寸 MUST 有上限**：以 viewBox / width / height 换算出的位图尺寸 SHALL 把最长边夹到一个固定
   上限（本实现取 4096 像素），短边按同一比例缩（不改变长宽比）。上限 MUST 在**分配位图之前**
   生效——50MB 的输入字节上限拦不住「小字节、大画布」。
3. **产物 MUST 是位图**：栅格化只产出 PNG 字节交回既有转换入口；任何路径 MUST NOT 把 SVG 源码
   回传给前端、也 MUST NOT 用 `innerHTML` 内联 SVG。
4. **字体是环境依赖**：`<text>` 的渲染 SHALL 使用系统字体，渲染结果是**引用那一刻的快照**
   （与编辑器预览可能不同形），这属接受的语义，MUST NOT 当作缺陷处理。

栅格化失败 SHALL 走写入口既有的错误码族（解析失败 / 画布尺寸非法 → `attachment_decode_failed`，
PNG 编码失败 → `attachment_encode_failed`），MUST NOT 落盘任何文件、MUST NOT 插半截引用。

#### Scenario: svg 转码写入并读回

- **WHEN** `fs_write_attachment("", <合法 svg 的 base64>, "image/svg+xml")`，vault 根存在、
  全 vault 无同名文件
- **THEN** 落盘 `pasted-<hash16>.webp`：字节是 WebP 位图（不是 SVG 文本）、解码后尺寸等于
  viewBox（未超上限时）；返回的 `path` / `name` 与该文件一致；同一份 svg 再写一次命中内容寻址
  去重（`fresh = false`）

#### Scenario: 巨大 viewBox 被夹取

- **WHEN** svg 的 viewBox 是 `0 0 100000 100000`（输入字节很小）
- **THEN** 位图最长边是上限值（4096），短边按同一比例缩；MUST NOT 按 viewBox 原尺寸分配内存

#### Scenario: 外部 href 不被读取

- **WHEN** svg 里是 `<image href="/绝对路径/某图.png">` 或 `href="../../x.png"`，且该文件真实存在
- **THEN** 渲染结果里不含该文件的内容（不进位图）；`data:` URI 的内联图片照常渲染

#### Scenario: 畸形 svg 被拒

- **WHEN** `source_mime` 是 `image/svg+xml` 而字节不是合法 SVG（畸形 XML / 非 UTF-8 / 根元素不是
  `svg`）
- **THEN** 返回 `attachment_decode_failed`，目标目录零文件创建或修改

#### Scenario: 位图三档行为不变

- **WHEN** `image/png` / `image/jpeg` / `image/webp` 三种源格式各写一次
- **THEN** 行为与本次改动前逐字节一致：png 转码 WebP 无损、jpeg / webp 原样，落盘名
  `pasted-<hash16>.<ext>`
