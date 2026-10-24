# Proposal: Quote to chat 支持图片（悬停引用钮 + 选区里的图片随文本进入引用）

- Change ID: add-image-quote-to-chat
- 日期: 2026-10-23
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**通过**（Alex 2026-10-23 原话：「change 提案都通过」）。「Why」逐字保留
> Alex 的需求原话与已裁决的触发方式；四个起草期取值 D1–D4 随提案一并通过，按倾向侧落地。
> 节点 2（归档评审）：实现完成后填写。

## Why

Alex 2026-10-23 的需求原话（逐字）：

> 「Quote to chat 增加对图片的支持」

已裁决的触发方式（同日澄清，两条都要）：

> 「图片上加 Quote to chat 引用按钮（悬停图片时出现，与文本选区引用一致）」
>
> 「我选中一段内容中间有图片时，图片也会随着文本一起 Quote to chat」

**现状**（起草时逐处读过源码）：

- **摘录手势只认文本选区**：`createQuoteGesture`（`src/quote-gesture.ts:360`）读编辑器选区、按行范围
  建卡片；`QuoteCard` 的 `lines` / `text` 是必填（`src/quote-card.ts:36`，`lines` 非空校验在
  `harness-panel.ts:9386` 的 `insertQuoteCard` 里）。跨图片的选区因此只会把图片的**源码文本**
  （`![[x.png]]` / `![alt](path)`）当成普通字符抄进卡片——`quote-gesture.ts:527` 的
  `doc.sliceString(from, to)` 就是这么取的。
- **图片在文档里是 widget，且已经知道自己的 vault 路径**：`ImageWidget`（`src/preview/attachments.ts:427`）
  的 `key` 就是解析后的 vault 相对路径（构造点 `src/preview/livePreview.ts:1410` / `:1490` / `:1521`），
  且它已有「在图上挂一个处理器」的先例——双击进放大遮罩（`onDoubleClick`，`ImageWidget` 的构造参数）。
- **composer 已经能承载图片**：图片是 composer 的原子块（`src/quote-card.ts:68` `ImageRef` / `:77`
  `ImageCard` / `:87` `ComposerBlock`）；粘贴链路把字节写进 harness 侧存储（`harness-panel.ts:4526`
  的 `harnessWriteImage`，落 `attachments/<vault 稳定 id>/pasted-<hash16>.<ext>`，MUST NOT 触碰 vault）、
  缩略图按需读回（`:4215` `harnessReadImage`）；编号（`imageOrdinals`，`quote-card.ts:224`）、`@` 引用、
  投递标签 `Image N`（`serializeDelivery`，`:299`）与 transcript 沉淀全部已落地。
- **缺的只有两步**：把「图片 → 图片块」的入口接到预览里的图上，以及让跨图片的选区在抄文本之外**把图
  也带上**。没有一处需要新的后端命令。

**为什么值得做**：对话里最常粘的东西是截图与示意图；今天想引用文档里的图，只能先截图再粘贴（像素
路径绕一圈，还可能丢分辨率）。把引用入口直接放在图上，是把「看图」与「说这张图」之间的摩擦降到零。
第二条（选区带图）修的是一个**语义漏洞**：用户选中的那一段内容本来就包含图片，引用却只抄走了标记
文本——模型看到的上下文与用户看到的选区不是一回事。

## What Changes

逐条对应 `specs/harness/spec.md` 增量里的一个 requirement：

1. **图片上的引用钮**（harness，ADDED：图片摘录到对话）。文档内**已渲染**的图片在悬停时出现
   「Quote to chat」浮钮（与文本选区钮同一文案、同一形态家族、同一钳制规则）；点击把该图片作为
   **图片块**插入 composer（面板未打开时先打开，与文本摘录同一条路径）。图片块与粘贴图片**同一协议**：
   参与 `Image N` 编号、可 `@` 引用、可删除、投递时携带标签、transcript 同构沉淀。
2. **跨图片选区的引用带图**（同一条 requirement）。选区里含已渲染图片时，一次引用手势 SHALL 产出
   「文本引用卡片 + 按文档序的图片块」，作为**一个**结构编辑步落进 composer（⌘Z 一次撤掉整次引用）；
   图片块紧跟在引用卡片之后，按文档序排列。
3. **来源与格式口径**（同上）。人侧卡片 SHALL 能看出图片来自哪个文件（hover 显示来源路径），但
   **投递给模型的只有图片字节 + `Image N`**——不新增协议字段、不把 vault 路径塞进上下文（D2）。
   可引用的来源格式 = 既有 harness 粘贴链路支持的三种（`png` / `jpeg` / `webp`），其余格式给一次
   人话 toast、不插卡片（D1）。

## 起草期取值（已裁决之外，请评审时一并裁）

| # | 取值 | 倾向与理由 | 若你选另一侧 |
|---|---|---|---|
| D1 | 可引用格式 = `png` / `jpeg` / `webp`（`png` 无损转 WebP，其余原样） | 与粘贴图片的既有链路完全同一条（`harness_write_image` 的转码面），零新后端命令；`svg` / `gif` / `heic` 走一次人话 toast「暂不支持引用该格式」 | 扩展格式面要么给 `svg` 单开一条路径（渲染引擎能显示、但模型侧不接受 SVG 位图），要么给 `gif` 做静态首帧转码——都是新能力，不是接线 |
| D2 | 来源路径**不投递**（模型只看到图片与编号）；人侧卡片 hover 显示来源 | 与粘贴图片同一协议（模型侧一等公民是图片本身）；来源信息对「解释这张图」是噪音，对「核对这张图来自哪」有价值——所以给人看不给模型看 | 若你要投递来源，需要在投递序列里加一行来源文本（模型会读到 vault 路径），属协议增量、要单独裁 |
| D3 | 卡片与图片的**顺序** = 文本引用卡片在前、图片按文档序在后 | 读起来是「这段文字 + 这段里的图」；与 composer 的块序 = 投递序一致 | 图片在前：更像「先看图后看字」，但引用卡片的行范围要读在图片之后，阅读顺序与文档顺序相反 |
| D4 | 选区里**只有图片**（无文字）时不造空文本引用卡片，只插图片块 | `QuoteCard.lines` / `text` 必填且空摘要卡片在失锚链上没有意义（`quotePrefixMatched` 对空串恒不命中）；图片块本身已经表达「引用这张图」 | 若你要一个「来自某文件的图片」统一形态，需要给图片块加来源字段（与 D2 联动），属协议增量 |

## Non-goals

- **不做图片编辑**：不裁剪、不旋转、不加标注；引用就是把原图搬进对话（不写回 vault）。
- **不做多图选择器 / 图集拖入**：一张图一个入口；选区里自然带多张时按文档序全部带上。
- **不改文本摘录卡片的形态与数据模型**：`QuoteCard` 的 `file` / `heading` / `lines` / `text` 逐字不动，
  引用正文**不剥离图片语法**（见 design §5：锚校验要求逐字前缀）。
- **不新增后端命令**：字节走 `fs_read_attachment`（vault）+ `harness_write_image`（harness 侧），
  两条都已存在。
- **不改图片编号 / `@` 引用 / 投递标签的既有条款**：随引用进来的图片只是多了一个来源，编号规则逐字不变。
- **不做「点击图片引用卡片跳回文档并高亮」**：文本卡片有行锚可跳，图片块没有行锚语义（D4 的形态决定
  它不带 lines），不为此发明一套新的定位。
- **不改模型无视觉能力时的既有拒绝语义**（`harness_image_unsupported`），只在发送时按既有口径报错。

## Impact

- **影响的 specs**：`harness`（ADDED：图片摘录到对话）。`attachment-display` 的图片渲染条款被**引用**
  （引用钮挂在已渲染图片上），不改其字面条款。
- **影响的代码 / 系统**：
  - 前端（预览侧）：`src/preview/attachments.ts`（`ImageWidget` 增加引用入口，形态照 `onDoubleClick`）、
    `src/preview/livePreview.ts`（`PreviewContext` 增加一个口子，未接线时图片没有引用钮）。
  - 前端（手势侧）：`src/quote-gesture.ts`（选区内的图片枚举 + 与卡片同一次插入）、`src/main.ts`
    （装配：图片枚举依赖的 provider / resolver、插入编排）、`src/harness-panel.ts`（一次插入「卡片 +
    若干图片块」的结构编辑入口、读回缩略图复用）。
  - 样式：`src/style.css`（复用 `.lumir-block-trigger` 家族的共享形态，只新增位置 class）。
  - 后端：**零改动**。
- **关联约束**：
  - ADR 0003 §3 铁律：引用只读源文件、只在 harness 侧存储里写新文件（`attachments/<vault 稳定 id>/`，
    内容寻址、去重即同内容）。
  - 既有格式 / 上限口径：`harness_write_image` 的 50MB 上限与 png→WebP 转码（复用，不重写）。
  - 仓库信息卫生：验收 fixture 一律合成小图与合成文件名。

## 观测闸三问

- **怎么知道用户用了它**：悬停看图钮与选区引用都是显式动作；dogfood 可感知；无埋点。
- **怎么知道它有效**：悬停图片就能引用；选中一段含图的文字，composer 里出现「引用卡 + 图片」且一次
  ⌘Z 全撤；发送后模型能按 `Image N` 指代它们。
- **出问题怎么发现**：机器面兜底——选区内图片枚举的单测（两种语法、解析失败、代码块内的引用不算）、
  插入编排单测（顺序 / 一个撤销步 / 无文本选区不造卡）、失败路径 toast 的视觉场景、真机验收（悬停钮
  引用 + 跨图选区引用 + 发送后 transcript 同构）。
