# clipboard-image-paste 增量规格

> 起草注记（非规格正文）：本 change 新建 capability「剪贴板图片粘贴」。渲染侧
> （`![[...]]` / `![alt](path)` 的内联显示、占位、lightbox）全部由既有
> `attachment-display` living spec 承接，本 capability 只覆盖「粘贴 → 落盘 → 插入引用」
> 编辑通道；字节写落盘由 `fs-io` 的「二进制附件写入」承接。两个 Alex 裁决点的落地形态
> （落盘位置、插入语法、命名规则、图文优先级）以节点 1 裁决为准，本条按起草倾向
> （A/A/A/A）书写，裁决不同则回改本条再实现。

## ADDED Requirements

### Requirement: 粘贴触发与引用插入

在 md 模式且可编辑的编辑器中，当粘贴动作（⌘V 或菜单粘贴）到达且剪贴板含 `image/*`
数据时，系统 SHALL 阻止默认粘贴行为，将该图片字节落盘 vault 内 `attachments/` 目录
（目录缺失自动创建），并在当前光标/选区处插入 `![[pasted-<内容哈希前 16 位>.<扩展名>]]`
引用（光标在行内中间时前后补换行，引用独占一行）。有选区时插入 SHALL 先替换选区。
插入 SHALL 是普通编辑事务：进入 dirty 标记、文档保存链路与 undo 栈，与键入同权。
落盘路径是 vault 根相对，MUST NOT 依赖当前文件路径——无路径的新建文档粘贴 SHALL
同样成立。

code / text 模式编辑器、只读（不可编辑）文档中的粘贴 MUST NOT 触发本能力，维持现状。
多图剪贴板只取第一个 `image/*` 项。

#### Scenario: 截图粘贴落盘并显示

- **WHEN** md 文档编辑器聚焦，剪贴板置一张 png 截图，执行 ⌘V
- **THEN** vault 内出现 `attachments/pasted-<hash>.png` 且字节与剪贴板一致；文档光标处
  插入 `![[pasted-<hash>.png]]`；live preview 在该位置渲染出可见图片（替换区几何非零）

#### Scenario: 新文档粘贴不依赖文件路径

- **WHEN** 一个尚未保存、无路径的新建 md 文档中执行贴图
- **THEN** 图片照样落盘 `attachments/`、引用照常插入并渲染

#### Scenario: 只读与非 md 模式不触发

- **WHEN** 在只读文档或 code 模式编辑器中执行 ⌘V（剪贴板含图片）
- **THEN** 本能力不拦截、不落盘、不插入；行为与粘贴能力存在之前一致

### Requirement: 落盘与命名去重

落盘文件名 SHALL 为内容寻址形态：`pasted-<SHA-256 前 16 位十六进制>.<扩展名>`，
扩展名按剪贴板 MIME 子类型映射（`image/png` → `png`），映射表 SHALL 收进
`src/preview/attachments.ts` 的既有 MIME 注册表，MUST NOT 另立第二份映射表。
MIME 子类型未收录时 MUST NOT 猜测扩展名，按「失败反馈」处置。

同一张图片（字节相同 ⇒ 哈希相同 ⇒ 同名）再次粘贴时，系统 SHALL 探测到目标已存在并跳过
写盘，仅插入引用——MUST NOT 在 `attachments/` 下产生重复副本；返回 `fs_already_exists`
的并发写竞态 SHALL 按去重命中收敛（继续插入，报错界面不出现）。已落盘文件 MUST NOT 随
undo 或引用删除而自动删除。

#### Scenario: 同图再贴不产生副本

- **WHEN** 连续两次粘贴同一张 png（中间无其他写盘）
- **THEN** `attachments/` 下该哈希文件名只有一个文件，第二次的写盘被跳过；文档里两条
  引用都渲染出同一图片

#### Scenario: 时间戳与原始文件名不作名源

- **WHEN** 任意贴图场景
- **THEN** 文件名只来自内容哈希 + MIME 映射，MUST NOT 取自系统时间或剪贴板原始文件名
  （macOS 截图无原始文件名，时钟不应参与名源）

### Requirement: 非图片剪贴板降级

剪贴板不含 `image/*` 数据时（纯文本、富文本、文件等非图片内容），粘贴行为 SHALL 与
本能力存在之前逐字节一致：走 CodeMirror 默认文本粘贴，本能力的拦截层 MUST NOT 消费
事件、MUST NOT 改变任何现有粘贴行为。远程图片 URL 以文本形态粘贴时 SHALL 只粘贴
URL 文本，MUST NOT 触发下载或落盘。

#### Scenario: 文本粘贴回归

- **WHEN** 剪贴板为纯文本，在 md 编辑器执行 ⌘V
- **THEN** 文档插入该文本，与既有默认粘贴行为完全一致；`attachments/` 目录无新增文件

#### Scenario: 远程图片 URL 不下载

- **WHEN** 剪贴板含一段图片 URL 文本，执行 ⌘V
- **THEN** 只插入 URL 文本本身，不产生任何网络请求、不落盘

### Requirement: 失败反馈

贴图链路任一步失败（MIME 子类型未收录、超过 50MB、写盘错误或结果不可确认）时，
系统 SHALL 给人话 toast（文案经 `文案-Copy.md` deck），MUST NOT 静默失败、MUST NOT
插入引用后留下破图、MUST NOT 出现「文档插了引用但磁盘没有文件」的半截状态。渲染期
失败（字节损坏、格式不可渲染）不归本 requirement，按 `attachment-display` 的
「图片引用的可见回退不变量」处置。

#### Scenario: 写盘失败不留半截

- **WHEN** `fs_write_attachment` 返回错误（如目标卷不可写）
- **THEN** 弹出对应人话 toast；文档不出现该图片的引用文本；磁盘无半截临时文件残留
  （`.lumir-{pid}` 临时文件被清理）

#### Scenario: 不支持的剪贴板格式有明确反馈

- **WHEN** 剪贴板图片的 MIME 子类型未收录进注册表（如 `image/x-unknown`）
- **THEN** toast 指明不支持的格式，不猜扩展名、不落盘、不插引用
