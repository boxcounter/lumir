# clipboard-image-paste 增量规格

> 起草注记（非规格正文）：本 change 新建 capability「剪贴板图片粘贴」。渲染侧
> （`![[...]]` / `![alt](path)` 的内联显示、占位、lightbox）全部由既有
> `attachment-display` living spec 承接，本 capability 只覆盖「粘贴 → 转码落盘 →
> 插入引用」编辑通道；字节写落盘由 `fs-io` 的「二进制附件写入」承接。**节点 1 已裁决
> （2026-10-10）**：落盘位置 = 当前笔记同目录（无路径文档退 vault 根）、插入语法
> `![[文件名]]`、内容哈希命名（**哈希以转码后字节计**）、图文同板图优先、**转码压缩
> 入范围**（新增 requirement，推翻原「不转码」非目标）。

## ADDED Requirements

### Requirement: 粘贴触发与引用插入

在 md 模式且可编辑的编辑器中，当粘贴动作（⌘V 或菜单粘贴）到达且剪贴板含 `image/*`
数据时，系统 SHALL 阻止默认粘贴行为，将图片经 `fs_write_attachment` 落盘**当前笔记
所在目录**（无路径的新建文档 SHALL 退落 vault 根），并在当前光标/选区处插入
`![[pasted-<内容哈希前 16 位>.<扩展名>]]` 引用（光标在行内中间时前后补换行，引用
独占一行）。有选区时插入 SHALL 先替换选区。插入 SHALL 是普通编辑事务：进入 dirty
标记、文档保存链路与 undo 栈，与键入同权。文档后续保存到别的目录时 MUST NOT 搬动
已落盘图片。

code / text 模式编辑器、只读（不可编辑）文档中的粘贴 MUST NOT 触发本能力，维持现状。
多图剪贴板只取第一个 `image/*` 项。剪贴板同时含文本与图片数据时 SHALL 图优先。

#### Scenario: 截图粘贴落盘并显示

- **WHEN** `notes/x.md` 聚焦，剪贴板置一张 png 截图，执行 ⌘V
- **THEN** vault 内 `notes/` 下出现 `pasted-<hash16>.webp` 且解码像素与剪贴板一致；
  文档光标处插入 `![[pasted-<hash16>.webp]]`；live preview 在该位置渲染出可见图片
  （替换区几何非零）

#### Scenario: 未保存新文档退落 vault 根

- **WHEN** 一个尚未保存、无路径的新建 md 文档中执行贴图
- **THEN** 图片落盘 vault 根（而非报错或拒贴）、引用照常插入并渲染

#### Scenario: 只读与非 md 模式不触发

- **WHEN** 在只读文档或 code 模式编辑器中执行 ⌘V（剪贴板含图片）
- **THEN** 本能力不拦截、不落盘、不插入；行为与粘贴能力存在之前一致

### Requirement: 落盘与命名去重

落盘位置 SHALL 为**当前笔记所在目录**；无路径文档 SHALL 退落 vault 根。落盘文件名
SHALL 为内容寻址形态 `pasted-<SHA-256 前 16 位十六进制>.<目标扩展名>`，**哈希以
转码后字节计算**（内容寻址：同名 ⇒ 同转码结果 ⇒ 同内容）；扩展名按转码目标格式映射，
映射表 SHALL 收进 `src/preview/attachments.ts` 的既有 MIME 注册表，MUST NOT 另立第二份。

同一张图片（字节相同）再次粘贴时——**无论目标笔记在哪个目录**——系统 SHALL 探测到
全 vault 已有同名文件并跳过写盘，仅插入引用：MUST NOT 产生重复副本（首贴位置赢）。
并发竞态下的撞名 MUST NOT 覆盖，按去重命中收敛。已落盘文件 MUST NOT 随 undo 或引用
删除而自动删除。文件名 MUST NOT 取自系统时间或剪贴板原始文件名。

#### Scenario: 同图跨笔记再贴不产生副本

- **WHEN** 在 `notes/a.md` 贴入一张图后，再在 `notes/sub/b.md` 贴入同一张图
- **THEN** 全 vault 该哈希名文件只有一个（位于 `notes/`，首贴位置）；第二次无写盘、
  仅插引用；两处引用都渲染同一图片

#### Scenario: 不同图片永不重名

- **WHEN** 先后贴入两张不同的截图（不同内容）
- **THEN** 两个文件名不同，各自落在当前笔记目录；MUST NOT 出现后贴覆盖先贴

### Requirement: 转码压缩

剪贴板图片字节原样可能巨大（macOS 系统截图进剪贴板为 Retina 物理像素的无损
RGBA，1280×960 逻辑尺寸实测达 18.8MB），系统 SHALL **转码压缩后落盘**，MUST NOT
原样落盘剪贴板字节。默认目标格式 SHALL 为 **WebP 无损**：截图含文字，有损 JPEG
不适合；WebP 无损逐像素保真且体积显著小于 PNG；质量档位或有损选项首版 MUST NOT
开放配置。`image/png` 输入 SHALL 转码 WebP 无损；`image/jpeg` 与 `image/webp` SHALL
原样落盘（已是压缩格式，再编码只损画质）；其余 `image/*` 子类型 SHALL 拒绝并给人话
反馈。转码失败 MUST NOT 插入引用、MUST NOT 留半截文件。分辨率 MUST NOT 降采样
（保留原始像素）。

#### Scenario: 大图转码后显著变小

- **WHEN** 剪贴板置一张 2560×1920（Retina 2x）的类截图 png（原始字节约 15–20MB 级）
- **THEN** 落盘文件为 WebP 无损、解码像素与源逐像素一致，且落盘字节远小于剪贴板
  原始字节（实现期 S5 场景填实测比值）

#### Scenario: 转码失败不留半截

- **WHEN** 剪贴板字节损坏无法解码
- **THEN** 给人话 toast，文档不插引用、磁盘无临时文件残留

### Requirement: 非图片剪贴板降级

剪贴板不含 `image/*` 数据时（纯文本、富文本、文件等非图片内容），粘贴行为 SHALL 与
本能力存在之前逐字节一致：走 CodeMirror 默认文本粘贴，本能力的拦截层 MUST NOT 消费
事件、MUST NOT 改变任何现有粘贴行为。远程图片 URL 以文本形态粘贴时 SHALL 只粘贴
URL 文本，MUST NOT 触发下载或落盘。

#### Scenario: 文本粘贴回归

- **WHEN** 剪贴板为纯文本，在 md 编辑器执行 ⌘V
- **THEN** 文档插入该文本，与既有默认粘贴行为完全一致；笔记目录无新增文件

#### Scenario: 远程图片 URL 不下载

- **WHEN** 剪贴板含一段图片 URL 文本，执行 ⌘V
- **THEN** 只插入 URL 文本本身，不产生任何网络请求、不落盘

### Requirement: 失败反馈

贴图链路任一步失败（MIME 子类型未支持、超过 50MB、转码失败、写盘错误或结果不可
确认）时，系统 SHALL 给人话 toast（文案经 `文案-Copy.md` deck），MUST NOT 静默失败、
MUST NOT 插入引用后留下破图、MUST NOT 出现「文档插了引用但磁盘没有文件」的半截
状态。渲染期失败（字节损坏、格式不可渲染）不归本 requirement，按 `attachment-display`
的「图片引用的可见回退不变量」处置。

#### Scenario: 写盘失败不留半截

- **WHEN** `fs_write_attachment` 返回错误（如目标卷不可写）
- **THEN** 弹出对应人话 toast；文档不出现该图片的引用文本；磁盘无半截临时文件残留
  （`.lumir-{pid}` 临时文件被清理）

#### Scenario: 不支持的剪贴板格式有明确反馈

- **WHEN** 剪贴板图片的 MIME 子类型未支持（如 `image/x-unknown`）
- **THEN** toast 指明不支持的格式，不猜扩展名、不落盘、不插引用
