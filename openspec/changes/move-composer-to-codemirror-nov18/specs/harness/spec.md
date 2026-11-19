# harness 增量规格

> 本 change 以单一 CM6 文本内核与区外附件 tray 替代 contenteditable 混排块模型。取消交错、卡间 caret、
> 跨卡选区和删卡键是节点 1 已批准的有意消类；历史消息交错解析不属于被删除的编辑行为。
> 归档对账声明：删除「对话输入区 SHALL 为混排编辑区且是全 composer 的唯一形态」
> 归档对账声明：删除「混排输入区 SHALL 自管撤销栈」
> 归档对账声明：删除「发送消息时，系统 SHALL 把混排输入区序列化为 XML 结构投递给模型」
> 归档对账声明：删除「图片卡片 SHALL 是 composer 的原子块」
> 归档对账声明：删除「input_text 与 input_image SHALL 按块序交错排布」
> 归档对账声明：删除「草稿 SHALL 存混排块模型」
> 归档对账声明：删除「composer 的光标位 SHALL 由块下标 + 段内偏移表示」
> 归档对账声明：删除「焦点在 composer 内时按下 ⌘A SHALL 选中 composer 的全部块」

## MODIFIED Requirements

### Requirement: 摘录引用卡片

系统 SHALL 提供摘录创建手势：在编辑器 pane 中选中片段后出现浮动「摘录到对话」钮，点击把该片段作为引用附件加入编辑区外 tray；harness 面板未打开时 SHALL 先打开面板再入卡片。**钮的出现时机 SHALL 是「选区完成后」**：鼠标拖拽选区在松开（mouseup）前 MUST NOT 出现，键盘建立的选区在选区稳定（停止变化约 350ms）后才出现，选区清空或移出编辑器即消失。**落点 SHALL 就近取选区末端（光标侧）附近**，且钮整体 MUST 钳制在触发面板可视区内（M531 不变量）。每张卡片 SHALL 呈现：引号竖条、摘录原文截断（至多两行）、出处行（文档名 · 最近一级标题；摘录在文档首个标题之前时仅显示文档名）、（输入区内）移除钮；hover SHALL 显示完整摘录与完整标题链。卡片数据 SHALL 携带：vault 相对路径 file、最近一级标题 heading、行范围 lines（从选区捕获，MUST 非空，取不到行范围时 MUST NOT 生成卡片）、摘录原文。点击卡片 SHALL 跳回原文位置并瞬态高亮。编辑器侧 SHALL NOT 出现任何常驻的摘录相关装饰——只存在两种瞬态：存在的选区（含浮动钮）、跳回高亮。摘录来源 SHALL 为「最近活跃编辑器 pane」的选区（ADR 0008 Decision 3 语义），harness 面板持焦 MUST NOT 改变该归属。

#### Scenario: 选区创建卡片

- **WHEN** 在编辑器 pane 中选中一段文字并点击浮动「摘录到对话」钮
- **THEN** 附件 tray 出现一张引用卡片（竖条 + 至多两行摘录 + 出处行）；卡片数据含该文件的相对路径、最近一级标题、选区行范围与摘录原文；编辑器侧无任何常驻装饰残留

#### Scenario: 点击卡片跳回高亮

- **WHEN** 点击输入区或已发送消息中的引用卡片
- **THEN** 对应编辑器 pane 定位到摘录原文位置并瞬态高亮（约 1.4s 消退）

### Requirement: 消息摘录序列化协议

发送新消息时，消息摘录附件 SHALL 序列化为 `<msg-quote role="…" at="…">摘录原文</msg-quote>`——每段消息摘录一行，全部 `<msg-quote>` 上下文 SHALL 按「新消息的附件前置序列化协议」位于完整问题文字之前；历史已发送消息的任意交错顺序只用于留存、解析与呈现，MUST NOT 被重排。`role` MUST 为 `user` 或 `assistant` 且 MUST 在场；`at`（来源消息上屏时刻，ISO 8601 本地时间串、秒级）可缺——不可考时产出 role-only 元素；属性值与文本节点 MUST 做 XML 转义。序列化结构 SHALL NOT 包含任何编号——遵循一致性原则：投递给模型的上下文要素对人必须也可查（transcript who 行显示角色与相对时间、卡片 hover 显示完整摘录与绝对时间），编号对人无区分价值故不进协议。会话 JSONL 留存 SHALL 记录序列化后的完整消息（含 `<msg-quote>` 元素，与 `<quote>` 同纪律），历史 JSONL MUST NOT 因新投递语义改写。解析还原路径 SHALL 识别 `<msg-quote>` 还原为消息摘录卡片，并保留历史消息的文字 / 卡片交错顺序；对不识别元素 SHALL 保守处理，MUST NOT 静默丢弃其文本内容。agent 回复 SHALL 按摘录内容与角色/时间回指。

#### Scenario: 序列化结构

- **WHEN** 发送一条「消息摘录卡 + 问题」的消息
- **THEN** 模型收到的消息中摘录为一个 `<msg-quote>` 元素（role 属性在场且合法、at 随来源消息可缺、无编号属性），问题文字位于 `</msg-quote>` 之后

#### Scenario: 转义 round-trip

- **WHEN** 摘录原文含 `<`、`&`、`"` 等字符，或来源消息无 at
- **THEN** 序列化输出中对应位置为 XML 转义形式，解析后还原为原文；无 at 来源产出无 at 属性的元素，解析还原为 at 为空的消息摘录卡片

#### Scenario: UI 与协议无编号

- **WHEN** 输入区或 transcript 呈现消息摘录卡片，或 agent 回复引用某段消息摘录
- **THEN** 界面任何位置与投递给模型的消息中均不出现 `#N` / `index` 形式的卡片编号

#### Scenario: 未知元素保守处理

- **WHEN** 快照恢复的留存消息文本中含序列化协议不认识的元素
- **THEN** 该元素的文本内容 MUST NOT 被静默丢弃（维持既有保守解析口径）

### Requirement: 图片摘录到对话

图片 SHALL 与文本一样能作为摘录来源进入对话输入区，且**一个来源、同一协议**：由本能力插入的图片附件与
粘贴进来的图片卡片 SHALL 走完全相同的附件数据模型与投递协议（参与 `Image N` 编号、可 `@` 引用、可经移除钮删除、
投递时携带结构化标签、transcript 同构沉淀、快照恢复同一 round-trip）——MUST NOT 为摘录来源另立附件类型、编号
规则或投递字段。

**入口一：图片上的引用钮**。文档内**终态渲染出的**图片（已产出 `<img>` 的引用）SHALL 在悬停其可视盒时
浮现「Quote to chat」浮钮（与文本选区摘录钮同一文案、同一形态家族与同一钳制口径：钮整体 MUST 落在触发
它的 pane 可视区内，见既有「浮动操作钮钳制」口径）。点击 SHALL 把该图片作为图片附件插入对话输入区；面板
未打开时 SHALL 先打开面板再插入（与文本摘录同一条路径）。**加载中 / 读取失败 / 终态不可见**三类占位
没有 `<img>`，因此 MUST NOT 出现引用钮——「占位不可引用」是结构性事实，MUST NOT 靠一条需要维护的开关。

**入口二：跨图片的选区**。在编辑器 pane 中选中一段内容、且选区内含已渲染图片时，一次文本摘录手势
SHALL 产出「文本引用卡片 + 按文档序的图片附件」：卡片在前（保持既有卡片数据与语义不变），图片附件紧随其后、
按图片在选区内的出现顺序排列。整次插入 SHALL 是**一个**结构编辑步（一次撤销即撤掉整次引用）。选区内
**只有图片、没有文字**时 MUST NOT 生成文本引用卡片（`lines` / 摘录原文必填且空文本卡片在失锚链上无
意义），只插入图片附件。选区内解析不到 / 不存在的图片 SHALL 被跳过且 MUST NOT 阻断同一次引用的其余部分。
同一选区内同一路径的图片 MUST NOT 重复插入。

**来源与隐私**：引用 SHALL 只**读取** vault 内源文件，MUST NOT 改写源文件、MUST NOT 在 vault 内产生
任何新条目；字节 SHALL 落 harness 侧存储（内容寻址、去重即同文件）。人侧 SHALL 能看见图片来自哪个文件
（卡片缩略图的悬停提示含来源的 vault 相对路径）；投递给模型的内容 MUST NOT 因本能力新增来源字段或路径
文本——模型侧看到的仍是图片与 `Image N` 标签，与粘贴图片一致。

**格式与失败**：可引用的来源格式 SHALL 以 harness 侧图片写入的格式表（下称「可引用格式表」）为唯一
判定面——表内子类型按该表既有的转换规则入库（`png` 无损转 WebP、`jpeg` / `webp` 原样），表外子类型
拒绝。不支持的格式（可引用格式表之外的子类型）、超过 50MB 上限、读取或写入失败 SHALL 给人话 toast
说明原因，MUST NOT 插入卡片后留破图、MUST NOT 静默失败。一次引用含多张图时，单张失败 MUST NOT 回滚
其余已成功的插入（失败张数与原因由 toast 说明）。

图片是发送期能力：模型未声明视觉能力时，含图片的消息 SHALL 按既有「模型图片能力声明」条款拒绝发送，
不被本能力放宽。

#### Scenario: 悬停图片出现引用钮并插入图片块

- **WHEN** 文档里一张已渲染的图片被指针悬停，用户点击浮现的「Quote to chat」钮
- **THEN** 对话输入区出现该图片的图片卡片（可见缩略图、编号 `Image 1`）；vault 目录零新增或修改；
  输入区可直接继续输入问题

#### Scenario: 选区跨文字与图片时卡片与图片一起进入

- **WHEN** 用户选中一段文字、其中间含一张已渲染图片，点击文本摘录钮
- **THEN** 输入区依次出现「引用卡片（含该段文字与行范围）」与「该图片的图片附件」；附件顺序按文档序；
  一次 ⌘Z 同时撤掉卡片与图片

#### Scenario: 选区只有图片时不造空卡片

- **WHEN** 用户选中恰好覆盖一张图片的范围（无文字），点击摘录钮
- **THEN** 输入区只出现图片附件，MUST NOT 出现空文本的引用卡片

#### Scenario: 占位不可引用

- **WHEN** 文档里的图片引用处于加载中、读取失败或终态不可见（占位块）状态，指针悬停其上
- **THEN** MUST NOT 出现引用钮；该引用在选区摘录里也不产生图片附件

#### Scenario: 不支持的格式与部分失败

- **WHEN** 用户引用一张可引用格式表之外的图片（如 `gif`），或一次选区引用中含 2 张图而其中 1 张超过
  50MB
- **THEN** 不支持的格式给一次人话 toast 且不插卡片；部分失败时其余图片照常插入，toast 说明失败张数与
  原因，输入区不出现破图卡片

#### Scenario: 引用不改 vault、模型侧看不到来源路径

- **WHEN** 引用一张 vault 内图片并发送
- **THEN** vault 内文件逐字节不变、无新增条目；harness 侧存储出现该图的内容寻址文件；发送的
  content parts 里该图只带 `Image N` 标签与图片内容，MUST NOT 出现 vault 路径文本

### Requirement: 引用失败的留痕与引用语境反馈

图片引用失败的处置 SHALL **持久可见**，MUST NOT 只有一次瞬态 toast：一次引用里失败了几张，
人侧 MUST 能在输入区（引用卡片的出处行，或没有文本卡片时的输入区状态行）读到「N 张图片未能
引用」这一读数，且该读数 MUST 存活到下一次引用 / 发送 / 切会话，MUST NOT 随几秒后自动消隐。
读数 SHALL 只存在于呈现层：MUST NOT 进卡片数据模型、MUST NOT 进序列化 / 投递载荷 / 草稿。

引用路径的失败人话 SHALL 按**调用点**分码：粘贴语境与引用语境的同一失败原因可以有不同措辞，
引用路径拿到的格式不支持提示 MUST NOT 使用剪贴板语境的说法（「剪贴板」二字）。失败项 SHALL 与
成功项一起返回给调用方（同一结果集合、保持输入序），单张失败 MUST NOT 回滚已成功的插入；失败
SHALL NOT 产出图片卡片。可引用格式的判定 SHALL 在读取 vault 字节与写入 harness 存储**之前**
生效（不可引用的格式不产生后端调用）；后端写入原语仍是最后一道闸，其拒绝按同一引用语境措辞。

#### Scenario: svg 引用失败

- **WHEN** 在文档里点一张 `svg` 图片的「引用」钮（预览能渲染、可引用格式表里没有）
- **THEN** toast 的文案是引用语境的说法（含 `image/svg+xml`、不含「剪贴板」），输入区出现
  「1 张图片未能引用」的持久状态行，composer 里不出现图片卡片；读 vault 与写 harness 两条
  命令都没有发出

#### Scenario: 多图引用部分失败

- **WHEN** 选区里有两张图，其中一张的格式不可引用
- **THEN** 引用卡片与可引用的那张图片附件照常插入（一个撤销步），卡片出处行同时显示
  「1 张图片未能引用」；撤销一次撤掉整次引用，该读数随卡片一起消失

#### Scenario: 留痕的收口

- **WHEN** 一次引用失败留下的输入区状态行在场，用户随后发送这条消息（或新建会话 / 切 vault）
- **THEN** 状态行收起，MUST NOT 留到下一段输入上；卡片上的读数属卡片自身，随卡片存在

### Requirement: SVG 引用的栅格化成功路径

引用一张 `svg` 图片 SHALL 与引用位图走**同一条**链路、无分支差异：格式预检放行、读 vault 字节
与写 harness 存储两条命令照常发出、写入口把 SVG 栅格化成位图后落盘。引用结果里的图片卡片 SHALL
引用**位图**内容寻址名（`pasted-<hash16>.webp`），MUST NOT 引用 SVG 文件名或 SVG 字节；卡片
元信息（宽高）SHALL 取自栅格化产物的像素尺寸。卡片的数据模型、序列化、投递 parts、留存形状
MUST NOT 为 svg 新增字段或第二种形态（图片附件只有一种形态）。

引用 svg **成功**时 MUST NOT 产生失败留痕（无「N 张图片未能引用」状态行）与格式不支持提示；
D585 / D586 的失败面 SHALL 保留给**真正不支持**的格式（可引用格式表之外的扩展名，如 gif）。
栅格化自身失败（畸形 SVG / 画布尺寸非法）SHALL 按写入口既有错误码族回落，只报该张、不产卡片、
不回滚同批次已成功的引用。

#### Scenario: 引用文档里的 svg

- **WHEN** 在文档里点一张 `svg` 图片的「引用」钮
- **THEN** composer 出现图片卡片，卡片引用名是 `pasted-<hash16>.webp`（位图）、带 `@` 插入引用
  钮；输入区没有「N 张图片未能引用」状态行，也没有「暂不支持引用该格式」提示；读 vault 与写
  harness 两条命令各发一次

#### Scenario: 真不支持的格式仍走失败面

- **WHEN** 点一张可引用格式表之外的图片（如 `gif`）的「引用」钮
- **THEN** 格式预检在 IPC 之前失败：toast 是引用语境的人话（D585，含该 MIME、不含「剪贴板」
  字样），输入区留下持久的「1 张图片未能引用」（D586），composer 不出现图片卡片，读 vault 与
  写 harness 两条命令都没有发出

#### Scenario: svg 栅格化失败

- **WHEN** 引用的 svg 是畸形 XML（或画布尺寸非法）
- **THEN** 该张只报一条失败读数（走既有错误码族的人话），不产图片卡片；同批次里其它可引用的
  图片照常插入，一次撤销仍撤掉整次引用

## ADDED Requirements

### Requirement: CM 对话输入区与区外附件

对话输入区 SHALL 由一个最小 CodeMirror 6 纯文本编辑区和编辑区外的有序附件 tray 组成；引用卡片、消息摘录卡片与图片卡片 MUST NOT 作为 CM 文本内的原子 block / widget。文本编辑区 SHALL 只承载完整问题文字，附件 tray SHALL 按加入顺序呈现卡片；添加附件 MUST NOT 拆分文本、改变 caret 或写入隐藏占位。三类附件插入后 SHALL 把键盘焦点交给文本编辑区，caret 保持插入前的合法位置，随后键入 MUST NOT 落进编辑器正文；面板原本未打开时 SHALL 先打开面板再移交焦点。

附件 SHALL 只经移除钮移除；文本 Backspace / Delete MUST NOT 删卡。粘贴 SHALL 按剪贴板内容分派：含 `image/*` 时走「图片粘贴卡片」且图优先，其余内容只收 `text/plain` 并保留换行。新发送的用户消息 SHALL 按「全部附件上下文在前、完整问题在后」的同一投影沉淀；新输入 MUST NOT 支持文字 / 卡片任意交错、卡片前后缘或两卡之间 caret、跨卡选区或块级自绘选区高亮。历史已发送消息仍 SHALL 按留存原文交错显示。

#### Scenario: 添加附件不拆文本且可直接继续输入

- **WHEN** 问题文字中已有合法 caret，用户从编辑器、transcript 或剪贴板加入一个附件
- **THEN** 附件按加入顺序出现在文本区外 tray；文本逐字节不变、caret 不移动，焦点落在文本区，随后键入接在原 caret 处

#### Scenario: 文本键不改变附件

- **WHEN** tray 中有一张或多张附件，用户在文本区执行 Backspace / Delete、⌘A、普通键入或 IME 组合
- **THEN** 只有文本 / 选区按各自语义变化，附件内容、数量和顺序逐字段不变；附件只能经 × 移除

#### Scenario: 新消息附件前置、历史交错保留

- **WHEN** 用户先输入问题再加入附件并发送，随后查看新消息和一条历史交错消息
- **THEN** 新消息先呈现全部附件再呈现完整问题；历史消息仍按留存的文字 / 卡片交错顺序呈现，MUST NOT 被迁移或重排

#### Scenario: 粘贴按剪贴板内容分派

- **WHEN** 在文本区粘贴多行纯文本，或粘贴同时含文字与图片的剪贴板
- **THEN** 纯文本只进入当前文本选区并保留换行；图文同板只把第一张图片写成附件，夹带文字不得另行落入文本区

### Requirement: CM composer 的单一 history

composer SHALL 使用 CodeMirror history 作为文本与附件的唯一撤销 / 重做真源，MUST NOT 再维护 DOM / blocks 快照栈。附件添加与移除 SHALL 由专用 StateEffect 更新 StateField，并经 `invertedEffects` 生成逆 effect；附件结构事务 SHALL 与相邻编辑隔离。连续文本输入 SHALL 按 CM history 聚簇；IME 整段 history SHALL 由 CM 管理，MUST NOT 在 compositionstart/end 手工压栈。导航本身 MUST NOT 产生编辑 undo 事件。

文本 Backspace / Delete、⌘A、普通输入、粘贴与 IME MUST NOT 发出附件 effect，因此不得改变附件 field。重置、草稿恢复、切 vault 和发送成功后的空输入 SHALL 是新的编辑史，MUST NOT 撤销回另一 vault 或已发送内容。

#### Scenario: 附件与文本共享可验证的 undo/redo

- **WHEN** 用户依次输入文字、添加附件、移除另一附件，再逐步 undo 和 redo
- **THEN** 每一步按统一 history 逆序 / 正序恢复相应文本、selection 与附件；不存在只恢复文本或只恢复卡片的第二历史

#### Scenario: 连续键入与 IME 归 CM 聚簇

- **WHEN** 用户连续键入，或完成一段 IME 组合后撤销
- **THEN** CM 按其 history 聚簇恢复文本；产品没有 compositionstart/end 的额外快照步，附件始终不变

### Requirement: 新消息的附件前置序列化协议

发送新消息时，系统 SHALL 把全部附件按 tray 顺序投影到完整问题文字之前：每段文档摘录一行 `<quote file="…" heading="…" lines="A-B">摘录原文</quote>`，消息摘录沿用 `<msg-quote>`；`lines` MUST 非空，属性值与文本节点 MUST 做 XML 转义。`projectDelivery` SHALL 继续单源产出 panelText 与 parts，发送方 MUST NOT 另写一套序列化。

序列化结构 SHALL NOT 包含引用 / 消息摘录卡片编号；图片仍是唯一例外，按「图片编号与引用」携带 `Image N` 结构化标签。序列化后的完整消息 SHALL 以 wire 形态逐字节留存。历史消息的任意交错解析与显示 SHALL 保留，MUST NOT 因新 composer 的前置语义改写历史 JSONL。

#### Scenario: 新消息统一附件前置

- **WHEN** 当前文本是完整问题，tray 依次有引用卡、消息摘录卡和图片卡，用户发送
- **THEN** 投递先出现 `<quote>` 与 `<msg-quote>` 文本上下文及图片 part，最后才是完整问题；卡片相对顺序与 tray 一致

#### Scenario: 转义与零编号回归

- **WHEN** 摘录原文或出处含 `<`、`&`、`"` 等字符，消息含引用 / 消息摘录与图片
- **THEN** XML 转义 round-trip 还原；`<quote>` / `<msg-quote>` 无序号属性，图片标签编号与卡片徽标一致

#### Scenario: 历史消息不改写

- **WHEN** 历史 JSONL 中一条用户消息是「问题1 / 卡片 / 问题2」交错形态
- **THEN** 恢复与 transcript 仍按原顺序显示和再投影，文件逐字节不变

### Requirement: 区外图片附件粘贴

harness composer SHALL 支持粘贴剪贴板图片：含 `image/*` 时拦截粘贴，把图片落到 `<config_dir>/harness/attachments/<vault 稳定 id>/` 的内容寻址文件，并在编辑区外 tray 追加图片附件。vault 稳定 id、MIME / 50MB / 转码 / 不降级分辨率、图优先、多图取第一项和不写 vault 的既有约束不变。图片落盘成功 MUST NOT 拆分问题文字或移动 caret；失败后给人话 toast、不插附件、不留半截临时文件。

图片附件 SHALL 呈现可见缩略图与移除钮；字节经读回命令按需取，MUST NOT 把 base64 落进附件数据、草稿或留存。发送后 transcript 按附件前置投影呈现，历史快照仍能从引用还原任意交错图片卡。

#### Scenario: 贴图只追加附件

- **WHEN** 问题文字中间有 caret，用户粘贴一张 png 截图
- **THEN** 图片写 harness 附件目录并追加 tray，文本和 caret 不变、焦点在文本区；vault 零写入，可直接继续输入

#### Scenario: 图文同板与失败回归

- **WHEN** 剪贴板同时含文字和多张图片，或图片格式不支持 / 超限 / 落盘失败
- **THEN** 前者只取第一张图且不写夹带文字；后者给对应 toast、无新附件、无半截文件，原文本保持

### Requirement: 附件前置图片投递协议

发送新消息时，系统 SHALL 把附件按 tray 顺序投影为 Responses API content parts，再把完整问题作为最后的文本内容；图片 parts MUST 位于完整问题之前。文本与图片由既有 `projectDelivery` 同源产出，文本 part MUST NOT 包含引用 / 消息摘录卡片编号；图片按同一编号源携带 `Image N` 结构化标签。

会话 input 项与 JSONL MUST NOT 内联图片字节；图片以 `lumir-attachment://<内容寻址名>` 引用留存，provider wire 在发送前展开为 data URL。展开失败不得静默缺图；引用按当前 vault id 解析，历史恢复继续从 wire 引用还原图片卡片及其历史交错位置。

#### Scenario: content parts 附件前置

- **WHEN** tray 有图片 A、引用卡和图片 B，完整问题为多行文字，用户发送
- **THEN** 图片 A / B 的 parts 与引用上下文都在完整问题之前，图片相对顺序和标签为 Image 1 / Image 2；问题换行完整保留

#### Scenario: 引用进留存、展开进 wire

- **WHEN** 携带图片附件的消息发出并落盘
- **THEN** JSONL 中只有 harness 附件引用且无 base64，provider 请求同位置是展开后的 data URL；展开失败则本轮人话收口、不缺图发送

### Requirement: composer 草稿 v2 与一次性 v1 转换

composer 内容 SHALL 作为当前 vault 的一份草稿自动保存与恢复；落点、tmp+rename、无 vault 不落盘、防抖、离散 flush、无变更不写、写失败 warning、串行写清、per-vault 隔离及发送成功 / 失败语义不变。草稿 MUST NOT 写入 vault。

新草稿 SHALL 是 `{version:2,text,caret,cards}`：text 是完整问题，caret 是 `[0,text.length]` 内 UTF-16 offset 或 null，cards 按 tray 顺序逐字段保存。图片只存内容寻址名、源 mime 与可选宽高，MUST NOT 内联 base64；v2 合法往返必须逐字段还原。

现存 v1 是迁移的具体消费者。读到合法 v1 时 SHALL 一次性转换：段落按原顺序以 `\n` 连接，未知块以可见 JSON 文本加入，卡片按相对顺序全部抽入 cards；段落 caret 精确映射，卡片 / 末尾边界映射到最近后续文本块起点，无后续则全文末尾。成功转换后 SHALL 立即经既有串行 store 写回 v2，此后只读 / 只写 v2；MUST NOT 双写、保留旧编辑路径或建立通用迁移平台。损坏 v1 / v2 安静回空；迁移写失败不谎报已保存。

#### Scenario: v2 往返与合法 caret

- **WHEN** 草稿包含多行文本、三类附件和文本中部 caret，保存后重开同一 vault
- **THEN** text / caret / cards 逐字段恢复，图片引用不变且无 base64；撤销史不跨进程恢复

#### Scenario: v1 一次性转换不丢内容

- **WHEN** 现存 v1 含交错段落、未知块、三类卡片与段落 / 卡片 / 末尾 caret
- **THEN** 所有段落和未知块可见文本各出现一次，卡片相对顺序不变，caret 按合同映射且合法；成功后盘上只写一份 v2，无双写

#### Scenario: 发送与写失败保留语义

- **WHEN** 发送成功、发送被能力闸拒绝，或草稿写盘失败
- **THEN** 成功清空草稿；拒绝恢复发送前 text / caret / cards 且草稿不变；写失败给 warning、不阻断输入、不谎报已保存

### Requirement: 区外图片附件编号与引用

图片编号 SHALL 在一条消息内按图片附件顺序 1-based 分配，只计图片，不含引用 / 消息摘录或文本；移除后即时重编且无空号。编号 MUST 是派生读数，不持久化进卡片源数据；composer 徽标、transcript 与投递标签共用同一编号函数。

composer 图片附件 SHALL 提供 `@` 钮，点击在当前文本选区插入普通 `Image N` 文本，不拆段落；插入后 caret 在文本之后。后续图片重编号 MUST NOT 静默改写已插入文本。发送时每张图片的标签紧邻其内容之前，标签进 provider wire、以结构化字段留存而不进留存文本面；历史恢复继续按原图序重建编号。

#### Scenario: 删除重编与 @ 插入

- **WHEN** tray 有图片 A / B / C，删除 A 后在问题中部点击新编号 B 的 @
- **THEN** 剩余卡即时显示 1 / 2；原 caret 处插入普通 `Image 1`，文本不拆段、caret 在插入文本之后，既有引用文本不被重写

#### Scenario: 徽标与 wire 标签同源

- **WHEN** 发送含两张图片且未使用 @ 的消息，随后恢复历史
- **THEN** 两个图片 part 分别带 Image 1 / Image 2，编号与发送时徽标一致；留存文本面无标签行，历史恢复编号不变

### Requirement: 区外消息摘录附件

系统 SHALL 提供消息摘录手势：在 transcript 用户 / 助手消息体内选中片段后出现浮动「摘录到对话」钮，点击把消息摘录作为附件加入编辑区外 tray；面板未打开时先打开。选区稳定时机、落点钳制、排除思考 / 工具 / 批准 / 引用卡内部选区和两手势互斥不变。附件呈现竖条、至多两行摘录、`对话 · 角色` 出处、移除钮与完整摘录 / 绝对时间 hover；数据保留 role、可缺 at 与所见文本。

点击附件 SHALL 按 role+at → 摘录原文搜索 → 失锚 toast 的三层路径跳回并瞬态高亮，MUST NOT 静默跳到其他消息。插入不拆文本、不动 caret，完成后焦点回文本区。携带消息摘录时继续跳过视口注入；历史快照仍按留存原文还原消息摘录卡及其历史交错位置。

#### Scenario: 消息摘录入 tray 后可继续输入

- **WHEN** 在 transcript 助手消息中选择一段并点击摘录钮
- **THEN** 文本区外新增消息摘录附件，原文本与 caret 不变、焦点回文本区；点击附件可定位来源并高亮

#### Scenario: 排除面、失锚与历史恢复

- **WHEN** 选区来自排除面，或来源消息已不在当前会话，或恢复一条历史交错消息
- **THEN** 排除面不产卡；失锚给 toast 不错跳；历史消息仍按原交错顺序显示并还原 role / at / 摘录文本

### Requirement: CM composer 的 Emacs 文本导航族

composer 的 Emacs 文本导航族 SHALL 经统一键位表 `text` 作用域分发，并适配到 CM EditorView / EditorState；MUST NOT 再由旧块模型或浏览器原生 contenteditable caret 决定。键位覆盖不变：⌃F/B、⌃A/E、⌃N/P、⌃D/H、⌥D/⌥⌫、⌃K/Y、⌃T、扩选六键与按词扩选；族外键位路径不变。

所有命令只作用于纯文本。字符与视觉行移动、逻辑行首尾和扩选 SHALL 用 CM 移动原语；扩选 anchor 不动。字素簇 / 词边界 SHALL 复用编辑器共享扫描核；⌃D/H 与删除键删除字素簇或选区，⌥D/⌥⌫ 按词 kill，⌃K kill 到逻辑行尾（在行尾则杀行界），⌃Y 插入共享 kill 槽，⌃T 转置相邻字素簇。kill 槽继续跨编辑器 / composer 共用，内容不含附件。任何文本命令 MUST NOT 添加、移除或重排附件。

#### Scenario: 文本移动、扩选与删除不触附件

- **WHEN** tray 有附件，用户在多行 / 软折行文本中执行移动、扩选、字符 / 词删除和转置
- **THEN** 文本与 selection 按 CM / 共享词法语义变化，导航不产编辑 undo；附件 field 逐字段不变

#### Scenario: kill-yank 跨面共用

- **WHEN** 在编辑器 kill 一段多行文本后到 composer yank，再反向操作
- **THEN** 两侧使用同一 kill 槽与连续 kill 合并规则，多行文本进入当前文本选区，附件不成为 kill 内容

### Requirement: CM composer 的文本全选

焦点在 composer 文本区时按 ⌘A SHALL 经统一键位表选择 `0 → doc.length` 的全部问题文字，MUST NOT 选到编辑器 / transcript，也 MUST NOT 选择、删除或高亮附件。后续删除 / 键入只替换全部文本；undo 恢复文本与 selection，附件保持不变。选区绘制 SHALL 使用 CM 自身选区层，不再存在旧块级自绘高亮。

#### Scenario: 全选只覆盖文本

- **WHEN** composer 有多行问题和多个附件，按 ⌘A 后键入一个字符再撤销
- **THEN** 键入后文本只剩该字符、附件原样在场；撤销恢复全部原文本，整个过程中附件数量、顺序与数据不变

## REMOVED Requirements


以下旧 requirement 连同其块模型 Scenario 整体退役；对应的 CM 新合同见上方 ADDED，旧 Scenario 不复制、不换选择器保留。

### Requirement: 混排对话输入区

整条移除。文本与附件不再由 contenteditable 块序列共同承载；新产品语义、保留行为和验证口径由对应的 CM requirement 替代。

### Requirement: 混排输入区的撤销栈聚簇与结构操作独立成步

整条移除。文本与附件不再由 contenteditable 块序列共同承载；新产品语义、保留行为和验证口径由对应的 CM requirement 替代。

### Requirement: 引用消息序列化协议

整条移除。文本与附件不再由 contenteditable 块序列共同承载；新产品语义、保留行为和验证口径由对应的 CM requirement 替代。

### Requirement: 图片粘贴卡片

整条移除。文本与附件不再由 contenteditable 块序列共同承载；新产品语义、保留行为和验证口径由对应的 CM requirement 替代。

### Requirement: 图片消息投递协议

整条移除。文本与附件不再由 contenteditable 块序列共同承载；新产品语义、保留行为和验证口径由对应的 CM requirement 替代。

### Requirement: composer 草稿自动保存与恢复

整条移除。文本与附件不再由 contenteditable 块序列共同承载；新产品语义、保留行为和验证口径由对应的 CM requirement 替代。

### Requirement: 图片编号与引用

整条移除。文本与附件不再由 contenteditable 块序列共同承载；新产品语义、保留行为和验证口径由对应的 CM requirement 替代。

### Requirement: 消息摘录卡片

整条移除。文本与附件不再由 contenteditable 块序列共同承载；新产品语义、保留行为和验证口径由对应的 CM requirement 替代。

### Requirement: composer 的 Emacs 文本导航族

整条移除。文本与附件不再由 contenteditable 块序列共同承载；新产品语义、保留行为和验证口径由对应的 CM requirement 替代。

### Requirement: composer 的全选（⌘A，M627）

整条移除。文本与附件不再由 contenteditable 块序列共同承载；新产品语义、保留行为和验证口径由对应的 CM requirement 替代。

### Requirement: 原子块边界光标位

整条移除。附件不再位于文本编辑区，卡片前后缘、相邻两卡之间不再是文本 caret 位；不得另建锚点或映射维持该模型。文本 caret 由「composer 的 Emacs 文本导航族」与 HC1 约束。

### Requirement: 边界光标位上的内容输入物化段落

整条移除。没有卡间边界位，就不需要物化段落；普通输入、IME、粘贴和 ⇧Enter 只编辑 CM 文本，附件添加不拆文本。相关旧 Scenario 全部退役，不迁移为新实现同义断言。
