# harness 增量规格

> 起草注记（非规格正文）：本 change 给 harness composer 加「粘贴剪贴板图片」通道——图随消息进上下文
> （多模态），与 living spec 的「混排对话输入区」「引用消息序列化协议」「会话本地留存」「配置节 [harness]」
> 对齐。数据模型、投递投影、harness 侧存储、能力声明与发送闸的机制与差异理由见
> [design.md](../../design.md)。

## ADDED Requirements

### Requirement: 图片粘贴卡片

harness 面板输入区（composer）SHALL 支持粘贴剪贴板里的图片：粘贴动作到达且剪贴板含 `image/*` 数据时，
系统 SHALL 拦截该粘贴、把图片落 **harness 侧存储**（`<config_dir>/harness/attachments/` 下的内容寻址文件
`pasted-<内容哈希前 16 位>.<扩展名>`），并在光标处插入 block 级**图片卡片**。落盘与转码 SHALL 复用二进制附件
写入的既有口径（`image/png` → WebP 无损转码、`image/jpeg` 与 `image/webp` 原样、其余 `image/*` 子类型拒绝并给
人话反馈；50MB 上限判定在转码之前；分辨率 MUST NOT 降采样）。图片落点 MUST NOT 进 vault——本能力 MUST NOT
新增或改写 vault 内任何文件。剪贴板同时含文本与图片数据时 SHALL 图优先；多图剪贴板 SHALL 只取第一个
`image/*` 项。

图片卡片 SHALL 是 composer 的**原子块**，与既有引用卡片同族：拆段插入、插入后光标落卡片下一行的问题段落、
移除钮（输入区内）、整体选择与删除、发送后在 transcript 同构沉淀（无移除钮）——全部与「混排对话输入区」的
既有卡片语义一致。卡片 SHALL 呈现可见缩略图（字节经读回命令按需取，MUST NOT 把 base64 落进卡片数据、快照或
留存）。快照恢复时图片卡片 SHALL 从留存内容解析还原（与 `<quote>` / `<msg-quote>` 同 round-trip 口径）。
任一步失败（格式不支持、超限、转码/落盘/读回失败）SHALL 给人话 toast，MUST NOT 静默失败、MUST NOT 插入卡片
后留破图、MUST NOT 留半截临时文件。非图片剪贴板的粘贴行为 MUST NOT 被本能力改变。

#### Scenario: 粘贴图片落 harness 侧并插入卡片

- **WHEN** composer 聚焦、剪贴板置一张 png 截图并执行粘贴
- **THEN** 配置目录 `harness/attachments/` 下出现 `pasted-<hash16>.webp`（解码像素与剪贴板一致），vault 目录
  零新增或修改；composer 在光标处出现图片卡片（可见缩略图）、可直接继续输入问题

#### Scenario: 图文同板图优先、多图取第一张

- **WHEN** 剪贴板同时含文本与一张图片，或含两张图片
- **THEN** 只产出该剪贴板里第一个 `image/*` 项的图片卡片；夹带的文本 MUST NOT 另行作为纯文本落入输入区

#### Scenario: 非图片粘贴回归

- **WHEN** 剪贴板为纯文本（无 `image/*`）并在 composer 执行粘贴
- **THEN** 行为与本能力存在之前逐字节一致（纯文本净化，多行拆成多个段落块）；`harness/attachments/` 无新增文件

#### Scenario: 失败一律人话出口

- **WHEN** 剪贴板图片的 MIME 子类型未支持、或超过 50MB、或转码/落盘失败
- **THEN** 弹出对应人话 toast；composer 不出现该图片卡片；附件目录无半截临时文件残留

#### Scenario: 发送后同构沉淀与快照恢复

- **WHEN** 携带图片卡片与问题段落的交错消息发送完成，随后重启 app 恢复会话
- **THEN** transcript 中该用户消息按相同交错顺序呈现图片卡片（无移除钮、缩略图可见）；恢复后图片卡片与原文
  交错顺序、附件引用与发送前一致

### Requirement: 图片消息投递协议

发送消息时，系统 SHALL 把混排输入区的块序列投影为 Responses API 的 content parts：文本块 SHALL 按
「引用消息序列化协议」的既有 XML 形态序列化为 `input_text` part，图片块 SHALL 产出 `input_image` part；
`input_text` 与 `input_image` SHALL 按块序交错排布（图片在文本流中的位置 MUST 与 composer 里的交错顺序一致）。
文本 part 的序列化 MUST NOT 包含卡片编号（沿用一致性原则）。

会话侧（内存 input 项与 JSONL 留存）MUST NOT 内联图片字节：图片在 input 项里 SHALL 以 **harness 附件引用**
形态在场（`image_url` 为 `lumir-attachment://<内容寻址名>`），MUST NOT 出现 base64 data URL。发给 provider 的
wire 请求 SHALL 在**发送前**把引用展开为 `{"type":"input_image","image_url":"data:image/<子类型>;base64,…"}`；
展开失败 SHALL 以人话错误收口，MUST NOT 发出静默缺图的请求。恢复充分性口径随之写实：仅凭 JSONL 的引用 +
内容寻址的 harness 附件目录（引用名即内容哈希，`引用 → 字节` 确定性）可重建该轮请求。历史会话恢复路径
SHALL 从 wire 项的引用还原图片卡片，MUST NOT 伪造、MUST NOT 丢弃。

#### Scenario: content parts 交错顺序

- **WHEN** 发送一条「问题段落 + 图片卡片 + 问题段落」的消息
- **THEN** 该 user 消息的 content 数组按块序为 `input_text` / `input_image` / `input_text`；图片 part 的位置与
  composer 里的交错顺序一致；文本 part 无卡片编号

#### Scenario: 引用进留存、展开进 wire

- **WHEN** 携带图片卡片的消息发出并落盘
- **THEN** 对应 `llm_request` 的 messages 中该 user 项的图片为 `lumir-attachment://<内容寻址名>` 引用，记录里
  **不含 base64**（无 `data:image` 串）；而发给 provider 的请求体里同一位置是 base64 data URL

#### Scenario: 展开失败不静默缺图

- **WHEN** 引用的附件文件缺失或不可读
- **THEN** 本轮以人话错误收口，MUST NOT 发出一份缺该图片的请求、MUST NOT 假装图片已投递

#### Scenario: 恢复还原图片卡片

- **WHEN** 从历史会话恢复（留存里该 user 项的图片是引用形态）
- **THEN** 恢复后的面板消息含对应图片卡片，交错顺序与附件引用与留存一致

### Requirement: 模型图片能力声明

`config.json` 的 `[harness].providers.<id>.models` 逐项声明 SHALL 支持 `image` 布尔键（与既有的 `effort` /
`window` 同一条 config-only 声明链）：`true` 表示该 provider + 模型接受图片输入；该键缺席 / 模型未列在清单内
SHALL 按**不支持**处理（保守默认，与 `effort` 同侧），SHALL 给一条人话 warning。系统 MUST NOT 内置任何模型的
图片能力——MUST NOT 硬编码、MUST NOT 出厂回落。

当前生效 provider + 模型的图片能力为**不支持**时，含图片卡片的消息 SHALL 在**发送时**被挡下：系统 SHALL 返回
人话错误（错误码区分"图片不受支持"这一成因）并保留输入区内容，界面 SHALL 标出该消息里的图片卡片（用户可移除
后重发）。系统 MUST NOT 静默丢弃图片后照发、MUST NOT 在粘贴时即拒收（贴入动作本身不受能力声明限制）。
能力判据 SHALL 只有一处（发送路径），界面 MUST NOT 另立第二套能力判定。

#### Scenario: 支持时正常投递

- **WHEN** 生效模型的声明含 `"image": true`，发送一条携带图片卡片的消息
- **THEN** 消息正常发出，wire 请求含展开后的 `input_image` part

#### Scenario: 未声明按不支持

- **WHEN** 生效模型的声明缺 `image` 键（或该模型不在清单内）
- **THEN** 该模型的图片能力按不支持处理并产生人话 warning；含图片卡片的消息发送被挡下

#### Scenario: 不支持时挡住并标出图片卡片

- **WHEN** 生效模型的 `image` 为 `false` 或未声明，用户在 composer 贴入图片并点击发送
- **THEN** 发送被挡下并弹出人话错误；该消息里的图片卡片被标出（错误态可见）；输入区内容原样保留、会话不推进、
  MUST NOT 发出丢弃图片的降级消息；移除图片卡片后同一消息可正常发出

## MODIFIED Requirements

### Requirement: 混排对话输入区

对话输入区 SHALL 为混排编辑区且是全 composer 的唯一形态（无卡片时退化为纯文本输入，不存在两种输入框并存）：
引用卡片、消息摘录卡片与**图片卡片**（本 change 新增）都是原子 block 节点（删除/选择按整体作用），问题文字在
卡片之间的段落中，各类卡片与段落可任意交错。「摘录到对话」 SHALL 在光标处插入卡片——光标落在段落中间时 SHALL
把该段落从光标处拆为两段、卡片插入中间；**插入后光标 SHALL 落到卡片下一行的问题段落**（该处已有空段落则复用、
否则新建）。卡片 SHALL 可经移除钮移除（图片卡片的移除钮语义与引用卡片一致）。粘贴进输入区的内容 SHALL 按
剪贴板内容分派：剪贴板含 `image/*` 数据时 SHALL 走「图片粘贴卡片」（图优先，不净化）；其余内容 SHALL 净化为
纯文本。已发送的用户消息 SHALL 同构呈现（卡片与问题段落上下交替，卡片无移除钮）。

#### Scenario: 卡片与问题交错

- **WHEN** 输入区已有「卡片1 + 问题1」，用户在问题1 之后继续摘录或贴入一张图片并输入问题2
- **THEN** 输入区呈现 卡片1 / 问题1 / 卡片2 / 问题2 上下交替（卡片2 可以是引用卡片、消息摘录卡片或图片卡片）；
  光标可在任意卡片前后继续输入

#### Scenario: 光标处拆段插入

- **WHEN** 光标落在某问题段落中间时触发「摘录到对话」或贴入一张图片
- **THEN** 该段落从光标处拆为两段，新卡片插入两段之间，光标落到新卡片下一行的问题段落（无则新建），可直接
  继续输入问题

#### Scenario: 发送后同构沉淀

- **WHEN** 携带两张卡片与两段问题的消息发送完成
- **THEN** transcript 中该用户消息按相同交错顺序呈现卡片与问题段落，卡片无移除钮且可点击跳回（图片卡片无跳回、
  只呈现缩略图）

#### Scenario: 粘贴按剪贴板内容分派

- **WHEN** 在输入区粘贴纯文本，或粘贴剪贴板里的图片
- **THEN** 纯文本走既有净化（多行拆成多个段落块）；图片走「图片粘贴卡片」落 harness 侧并插入图片卡片——
  两者互不串台
