# clipboard-image-paste Specification

## Purpose

定义「粘贴剪贴板图片」的编辑通道：md 模式且可编辑时，剪贴板含 `image/*` 数据的粘贴
被拦截并转码压缩落盘 vault（当前笔记同目录，无路径文档退 vault 根；内容寻址命名
`pasted-<hash16>.<ext>`、全 vault 同名去重、默认 WebP 无损转码），随后在光标处插入
`![[文件名]]` 引用；非图片剪贴板的粘贴行为逐字节不变，失败一律人话 toast、不留半截。
渲染侧（引用语法的内联显示、占位、lightbox）由 `attachment-display` 承接，字节写落盘
由 `fs-io` 的「二进制附件写入」承接。由 change `paste-clipboard-image` 归档并入
（2026-10-10，实现 M415 通道探针 + M416 后端写原语与前端链路）。语义命名是同一通道的异步
后续、不属落盘原语：落盘仍先取内容寻址的暂存名 `pasted-<hash16>.<ext>`，仅在
`harness.attachment_naming.enabled` 开且选定 provider 声明了 vision 模型时，粘贴成功后再发起
一次独立命名调用，成功才改名为 `<slug>-<hash6>.<ext>` 并按解析结果更新全 vault 引用（toast 给
一次撤销入口，撤销即对称反向操作）；命名失败 / 超时 / 开关关闭时保留暂存名，粘贴路径不等待、
不阻塞插入（change `add-semantic-image-naming` 归档并入，2026-10-24，实现 M709）。

## Requirements

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

落盘位置 SHALL 为**当前笔记所在目录**；无路径文档 SHALL 退落 vault 根。落盘文件名 SHALL 为
内容寻址形态 `pasted-<SHA-256 前 16 位十六进制>.<目标扩展名>`，**哈希以转码后字节计算**
（内容寻址：同名 ⇒ 同转码结果 ⇒ 同内容）；目标扩展名由后端按转码目标格式决定——`source_mime` → 目标
格式与扩展名的映射 SHALL 只存在于后端 `fs_io` 的 `attachment_target`（唯一真源，前端 MUST NOT
另立第二份）；`src/preview/attachments.ts` 的 MIME 注册表只承担渲染侧的「扩展名 → MIME」方向，
不承担转码目标映射。

`pasted-<hash16>.<ext>` 是该文件的**暂存身份**：语义命名成功后文件名 SHALL 变为
`<语义名>-<内容哈希前 6 位>.<同一扩展名>`（见「图片语义命名与异步重命名」）。**内容同一性
MUST NOT 由文件名承担**，判据 SHALL 恒为转码后字节的 SHA-256。

同一张图片（字节相同）再次粘贴时——**无论目标笔记在哪个目录、也无论该图当前用的是暂存名还是
语义名**——系统 SHALL 探测到全 vault 已有同一内容并跳过写盘，仅插入指向既有位置（及其当前
文件名）的引用：MUST NOT 产生重复副本（首贴位置赢）。探测 SHALL 同时覆盖两种文件名形态：
精确名 `pasted-<hash16>.<ext>`，与同扩展名、stem 末段为一段十六进制短后缀且其前 6 位等于
`hash6` 的语义名（覆盖 6 / 8 / 12 / 16 位的后缀扩展形态）；后者 SHALL 重新计算该文件字节的
SHA-256 并与本次转码结果比对（MUST NOT 仅凭后缀前缀相同即判同图）。
并发竞态下的撞名 MUST NOT 覆盖，按去重命中收敛。已落盘文件 MUST NOT 随 undo 或引用删除而
自动删除。文件名 MUST NOT 取自系统时间或剪贴板原始文件名。

语义改名的目标名 SHALL 在改名之前做全 vault 可用性探测；与既有文件撞名且内容不同时 MUST NOT
覆盖，SHALL 按扩展短哈希后缀（6 → 8 → 12 → 16 位）取得未占用名。

#### Scenario: 同图跨笔记再贴不产生副本

- **WHEN** 在 `notes/a.md` 贴入一张图后，再在 `notes/sub/b.md` 贴入同一张图
- **THEN** 全 vault 该哈希名文件只有一个（位于 `notes/`，首贴位置）；第二次无写盘、
  仅插引用；两处引用都渲染同一图片

#### Scenario: 语义命名后同图再贴仍去重

- **WHEN** 一张图已粘贴并完成语义改名（如 `notes/harness-arch-a3f2c4.webp`），随后在另一篇
  笔记贴入同一张图
- **THEN** 不产生新文件、不写盘；新笔记插入的引用指向该语义名文件；全 vault 该内容的副本数
  仍为 1

#### Scenario: 6 位后缀相同但内容不同不误合并

- **WHEN** 两张内容不同的图片，其转码后 SHA-256 的前 6 位相同（构造碰撞），其中一张已有语义名
- **THEN** 第二张照常落盘为暂存名文件；系统 MUST NOT 把它判为去重命中、MUST NOT 让两处引用
  指向同一文件

#### Scenario: 改名撞名不覆盖

- **WHEN** 语义改名算出的目标名在全 vault 已被另一个同名、内容不同的文件占用
- **THEN** 既有文件逐字节不变；本次改名按扩展后缀（8 / 12 / 16 位）取得未占用名后继续

#### Scenario: 不同图片永不重名

- **WHEN** 先后贴入两张不同的截图（不同内容）
- **THEN** 两个文件名不同，各自落在当前笔记目录；MUST NOT 出现后贴覆盖先贴

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

### Requirement: 图片语义命名与异步重命名

配置 `harness.attachment_naming.enabled` 为 `true`（出厂默认）时，系统 SHALL 为**本次粘贴
新写盘**的图片排一次语义命名。粘贴事务 SHALL 先按「落盘与命名去重」落暂存名并插入引用，在
keypress-to-paint <16ms 的性能合同内完成；命名 SHALL 是投递之后的异步任务，MUST NOT 在粘贴
路径上等待模型调用。去重命中（未写盘）、文件已是语义名、开关关闭时 MUST NOT 投递任务。

命名请求 SHALL 携带：图片字节 + **粘贴时刻**光标前后段落的文本 + 笔记标题；前后段落各有长度
上限，MUST NOT 携带整篇文档。调用目标 SHALL 由 `harness.attachment_naming` 三键解析：provider
取 `harness.attachment_naming.provider`（`null` = 当前生效 provider），模型取
`harness.attachment_naming.model`（`null` = 该 provider 的生效模型）；provider / 模型 / wire
方言 / api_key / base_url SHALL 同出**同一个 provider 条目**（MUST NOT 跨条目混用）。所选模型
MUST 由该 provider 的配置声明 `vision: true`（mock provider 恒定支持，但没有模型维度 ⇒ `model`
只能是 `null`）。无满足条件的模型时，系统 SHALL 跳过命名、保留暂存名、MUST NOT 弹失败 toast
（诊断日志如实记录一条）；MUST NOT 静默换用清单里的其它模型。

模型输出 SHALL 被规整为文件名 slug，字符集 SHALL 为**纯 ASCII kebab-case**：只允许小写 ASCII
字母 `a-z`、数字 `0-9` 与连字符 `-`；ASCII 大写 SHALL 折叠为小写，空白与下划线 SHALL 折成
单个 `-`，连续 `-` SHALL 折叠为一个，首尾 `-` SHALL 裁掉；不在此字符集内的字符（含中日韩
字符在内的所有非 ASCII 字符）SHALL 被剔除，MUST NOT 做音译或转写；长度上限 40 个字符。
规整后为空、或调用失败（网络错误 / 超时 / 错误响应 / 输出不可用 / 无可用模型）时，系统
SHALL 保留暂存名、MUST NOT 留下半截改名、MUST NOT 弹失败 toast。模型输出 MUST NOT 被当作
路径、命令或配置使用。

命名任务 SHALL 串行执行（同一时刻至多一个请求）；同一文件路径同时最多一个任务。任务完成前
vault 被切换或关闭、目标文件已不存在、或文件字节哈希已变时，任务 SHALL 按「异步缺口的放弃与
撤销」放弃。改名成功 SHALL 产生一条带「撤销」动作的 toast，其文本含新文件名。

#### Scenario: 粘贴先落暂存名、异步改名

- **WHEN** 在已保存的 md 笔记中粘贴一张图片（`attachment_naming.enabled` 开、模型可用）
- **THEN** 粘贴在键入路径内完成：文档立即插入 `![[pasted-<hash16>.<ext>]]` 引用并渲染；
  随后（不阻塞编辑器）文件改名为 `<语义名>-<hash6>.<ext>`，正文引用同步改为新名，并出现带
  「撤销」的 toast

#### Scenario: 无可用 vision 模型时静默保留暂存名

- **WHEN** `attachment_naming.enabled` 为开，但选定 provider + 模型的配置未声明 `vision: true`
- **THEN** 不发起任何模型请求；文件保持 `pasted-<hash16>.<ext>`；引用照常插入并渲染；
  不出现命名 toast、不出现失败 toast

#### Scenario: 模型输出被规整后才使用

- **WHEN** 模型回包为带引号与标点的文本（如 `"Harness Arch!"`），或为超长文本，或为纯中文名
  （如 `架构总览`）
- **THEN** 实际文件名使用规整后的 slug（如 `harness-arch-<hash6>.webp`）：大写折叠、引号与
  标点被剔除、长度被截到上限、文件名只含 `a-z` / `0-9` / `-`；纯中文名剔除后为空，按「规整后
  为空」处理，保留暂存名

#### Scenario: 调用失败不改变粘贴结果

- **WHEN** 命名调用超时或返回错误
- **THEN** 文件保持暂存名、引用与渲染不受影响；无失败 toast、无半截临时文件、无重复改名

### Requirement: 异步重命名的引用更新

改名时刻系统 SHALL 用 vault 内**唯一**的 wikilink 解析实现（`link_graph` 的词法识别与名称→
路径解析）对整个 vault 重新扫描，把所有指向该文件的 wikilink 的**末段路径**替换为新文件名。
匹配 SHALL 基于解析器的结构化 target（解析结果等于旧路径；改名完成后为解析结果等于新路径，
或 target 末段与目标文件名相等且大小写折叠沿用解析器同一规则），MUST NOT 依赖引用原文的逐
字节比对。`!` 前缀、目录前缀、`#heading`、`|alias` 与链接之外的正文 MUST 逐字节不变。
代码块、行内代码与 frontmatter 内的文本按解析口径不是链接，MUST NOT 被改动。标准 Markdown
图片链接 `![alt](path)` 不在本 requirement 射程。前端 MUST NOT 复制解析语义。

扫描 SHALL 以**改名时刻的磁盘内容**为准（在 rename 之前收集命中，因为改名后旧名不再可解析），
因此异步窗口内新增、删除、修改过的引用 SHALL 按同一判据被覆盖。扫描范围 SHALL 与粘贴去重同一
套目录口径（hidden 档与配置 `lazy` 档目录跳过；用户规则命中的惰性目录照旧遍历；不跟随符号
链接）。

每个被改写的笔记 SHALL 经临时文件 + rename 原子写入；写前 SHALL 核对文件内容哈希与扫描时一致，
不一致 SHALL 跳过该文件（MUST NOT 覆盖并发修改）并计数。改名本身 SHALL NOT 因个别笔记改写
失败而回滚；仍有引用指向旧名时，系统 SHALL 给人话 toast 点名未更新的数量，MUST NOT 静默。

打开中的文档 SHALL 被对账：clean 会话 SHALL 从磁盘重载；dirty 会话（含引用尚未保存到磁盘的
会话）SHALL 以同一解析规则对**内存文本**重算改写点并以编辑事务应用（保留撤销栈与未保存内容）。
若该引用也存在于磁盘副本，
磁盘副本 SHALL 被同样改写、该路径的磁盘 revision 基准 SHALL 推进到新值；若引用只存在于内存
（刚粘贴、尚未保存），磁盘副本 MUST NOT 被改动、基准保持不变。两种情形下用户随后保存
MUST NOT 产生 CAS 冲突；放弃修改时不会留下指向旧名的引用。被改名的图片若在标签中打开，其路径
SHALL 就地 remap。

#### Scenario: 多笔记多引用全部更新

- **WHEN** vault 内三篇笔记以 `![[pasted-0123456789abcdef.webp]]`、
  `![[notes/pasted-0123456789abcdef.webp|示意图]]`、
  `![[PASTED-0123456789ABCDEF.WEBP#小节]]` 三种形态引用同一张待改名图片
- **THEN** 改名后三处引用的末段都变为新文件名；`notes/` 目录前缀、`|示意图`、`#小节` 与其余
  正文逐字节不变；三处都仍渲染同一图片

#### Scenario: 代码块内的同串不碰

- **WHEN** 某笔记的围栏代码块、行内代码与 frontmatter 里出现与旧文件名相同的文本
- **THEN** 这三处逐字节不变；只有真正的 wikilink 被改写；整篇笔记除链接末段外逐字节不变

#### Scenario: 异步窗口内新增的引用同样更新

- **WHEN** 命名调用进行中（异步缺口），用户在同篇或另一篇笔记里新增一条指向暂存名的引用，
  或修改已有引用的别名 / 位置
- **THEN** 改名完成后新引用同样被更新到新名；别名与位置保持用户改动后的样子

#### Scenario: 脏文档引用同步更新且不丢内容

- **WHEN** 一条引用所在的笔记有未保存修改（dirty），该笔记在标签中打开
- **THEN** 内存文本里的引用被更新，未保存的其他修改原样保留（仍 dirty）；磁盘副本的引用也已
  更新（该引用在扫描时已存在于磁盘副本）；随后 ⌘S 保存不报磁盘冲突；若用户放弃修改关闭标签，
  磁盘上的引用仍指向新名

#### Scenario: 并发修改的笔记被跳过并计数

- **WHEN** 扫描与写盘之间某篇笔记被外部改写
- **THEN** 该文件 MUST NOT 被覆盖；系统跳过它并在结果中计数，随后以人话 toast 点名未更新
  数量；其余笔记的引用照常更新

### Requirement: 异步缺口的放弃与撤销

放弃判据 SHALL 只有一条，并在改名与引用更新之前判定：命名时刻目标文件已不在粘贴落盘的位置
（在异步缺口内被人工改名、移走或删除），或该位置的文件字节哈希与落盘记录不一致时，系统
SHALL 完全放弃本次命名——不改名、不改引用、不弹 toast、不留补偿状态。MUST NOT 猜测新位置、
MUST NOT 覆盖人的命名。发起时的 vault 已被切换或关闭时，任务同样 SHALL 终止（技术前提失效；
不产生产品侧可见动作）。

改名成功 SHALL 提供撤销入口：一条 toast 明示新文件名并带「撤销」动作；撤销窗口 = 该 toast 的
可见期。撤销 SHALL 是与改名对称的反向操作：以同一解析能力重新全 vault 扫描，把指向新名的引用
末段改回 `pasted-<hash16>.<ext>`，再把文件改回该暂存名。撤销 SHALL 服从同一组放弃判据（目标
已被再次改名 / 移走 / 内容变化，或暂存名已被占用时放弃）；撤销失败 SHALL 给人话 toast，
MUST NOT 静默。撤销 MUST NOT 触发新一轮语义命名。

#### Scenario: 缺口内被人工改名则放弃

- **WHEN** 命名调用尚未返回时，用户把暂存名文件改成自定义名字（或移走 / 删除）
- **THEN** 本次命名完全放弃：没有第二次改名、没有引用改写、没有命名 toast；用户的自定义名字
  与文件位置原样保留

#### Scenario: 撤销恢复暂存名与全部引用

- **WHEN** 改名成功后在 toast 可见期内点击「撤销」
- **THEN** 文件改回 `pasted-<hash16>.<ext>`；全 vault 中指向新名的引用（含窗口内新增的）全部
  改回暂存名；不再出现新一轮命名 toast

#### Scenario: 撤销时文件已被再次改动则放弃并提示

- **WHEN** 改名成功后用户又把该图片改成别的名字，随后点击「撤销」
- **THEN** 系统放弃撤销、文件保持用户当前命名；弹出一条人话 toast 说明无法撤销；MUST NOT
  覆盖用户命名

#### Scenario: 撤销窗口过后没有撤销入口

- **WHEN** 命名 toast 已自动消隐（超过可见期）后用户再想撤销
- **THEN** 界面上不存在该次改名的撤销入口；后续编辑行为不受影响
