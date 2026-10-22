# Design: Quote to chat 支持图片

- Change ID: add-image-quote-to-chat
- 日期: 2026-10-23

本文只写「怎么做到 proposal 里已裁的行为」与「为什么这样做」。代码锚点是起草时在本分支（基于
master）逐一读过原文的位置；行号会漂，实现前以符号名为准。

## 0. 事实清单（起草时核对过原文）

| 事实 | 锚点 | 与本 change 的关系 |
|---|---|---|
| 摘录手势（文本选区） | `src/quote-gesture.ts:360` `createQuoteGesture`、`:527` `doc.sliceString(from, to)` 取摘录原文、`:533` `document.addEventListener("selectionchange")` 时机门 | 两条新增触发之一的落点 |
| 卡片数据与必填 | `src/quote-card.ts:36` `QuoteCard`（`file` / `heading` / `lines` / `text`）、`:95` `LINES_REQUIRED_MESSAGE`、`harness-panel.ts:9386` 的 `createQuoteCard` 校验 | 决定「只有图片」时不造卡（D4） |
| 卡片入 composer | `src/harness-panel.ts:9385` `insertQuoteCard`（开面板 → `caretFromDom` → `insertCardAtCaret` → 聚焦）、`:466` `insertBlockAtCaret`（图片块的既有插入原语） | 新入口「卡片 + 若干图片块」要在同一个模型步里完成 |
| 一次模型步 = 一个撤销步 | `src/harness-panel.ts:5106` `withModel(op, force)`（先快照再施加）、`:1170` `STRUCTURAL_EDIT_FORCE` | 「一次引用一个撤销步」由**一次** `withModel` 调用保证，不需要新机制 |
| 图片块数据 | `src/quote-card.ts:68` `ImageRef`（`name` / `sourceMime`）、`:77` `ImageCard`（+`width` / `height`）、`:87` `ComposerBlock` | 引用进来的图片块与粘贴图片同一形态 |
| 编号与投递 | `src/quote-card.ts:224` `imageOrdinals`、`:233` `imageMentionText`、`:299` `serializeDelivery`；Rust 侧 `src-tauri/src/harness/attachments.rs:57` `parse_delivery_parts`（图片 part 缺 `label` 即非法） | 新来源的图片**自动**进入编号与标签，不过问协议 |
| 字节写 / 读（harness 侧） | `src/harness-panel.ts:4526` `harnessWriteImage(dataBase64, blob.type)`、`:4215` `harnessReadImage(name)`；后端 `src-tauri/src/harness.rs:1582` `harness_write_image`、`attachments.rs:205` `write_image`（png→WebP 无损、jpeg/webp 原样、其余拒绝、50MB 上限在转码前） | 引用一张 vault 图片 = 先读 vault 字节，再走**同一条**写入口 |
| 字节读（vault 侧） | `src/ipc.ts:132` `fsReadAttachment(path)`（base64，50MB）、`src-tauri/src/fs_io.rs:1837` `read_attachment` | 新增的只有「读 vault 图」这一步（vault 内既有能力） |
| MIME 推导 | `src/preview/attachments.ts:228` `mimeTypeOf`、`:169` `extensionOf` | `sourceMime` 的来源，不新写扩展名表 |
| 图片 widget 与其路径 | `src/preview/attachments.ts:427` `ImageWidget`（字段 `key` = 解析后的 vault 路径、`rawRef` = 引用原文）、`:449` `toDOM`（双击处理器挂终点 `<img>`） | 悬停钮挂在这里；形态照 `onDoubleClick` 的注入方式 |
| 图片 widget 的三个构造点 | `src/preview/livePreview.ts:1410`（标准 md 图片）、`:1490`（`![[...]]` 有解析器）、`:1521`（无解析器降级） | 三处都要能拿到同一个注入口（否则某一形态没有引用钮） |
| 图片语法与解析 | `src/preview/wikilinks.ts:28` `findWikilinkSpans`；标准 md 图片由 lezer 语法树节点 `Image` 产出（`livePreview.ts:1287`）；相对路径解析 `src/preview/attachments.ts:282` `resolveImagePath`；文件名唯一匹配 `:248` `resolveByNameUnique` | 选区内的图片枚举必须复用这三样，MUST NOT 新写第三份语法 |
| 粘贴链路的失败口径 | `src/preview/attachments.ts` 的错误码族（`attachment_*`）、`copy-data.ts` 的 `ERROR_COPY` | 引用失败的 toast 走既有错误文案，不新写一套 |

## 1. 两条触发路径

### 1.1 图片上的悬停引用钮

- 形态：**复用**块级动作钮家族的共享类 `.lumir-block-trigger`（壳 / 尺寸 / 圆角 / 图标色 / 过渡 /
  出现时机 / eink 两条规则只在 `src/style.css` 写一份，`src/preview/block-trigger.ts` 的注释已把这个
  家族定为单一真源）；新增的只有一个**位置 class**（贴图片右下角内侧：`right: 6px; bottom: 6px`——
  与块的右上角家族错开，避免与图片内容本身的角部细节重叠）。文案取既有 `D370`「Quote to chat」
  （与文本选区钮同一份文案，不新增词条）。
- 出现时机：与块级钮同判据——悬停图片的可视盒即浮现；钮自身可聚焦（`focus-visible` 同族规则），
  这样键盘用户**在有焦点可达路径时**也能用（图片 `<img>` 不可聚焦时仍只有指针路径，见 §10 边界）。
- 接线：`ImageWidget` 增加可选构造参数 `onQuote`（形态照 `onDoubleClick`：未注入即不渲染钮——
  「能力没装配是结构性表现，不是一条要维护的开关」）。三个构造点（`livePreview.ts:1410` / `:1490`
  / `:1521`）共用同一个 `PreviewContext` 口子 `quoteImage(): QuoteImageHandler | null`。
- 点击：`handler(key, rawRef)` —— `key` 是**解析后的 vault 路径**（widget 已有），`rawRef` 只用于
  人侧标注（§4.2）。命中后先阻止默认与冒泡（避免触发双击放大 / 选区），再走 §3 的引用事务。

### 1.2 跨图片的选区

- 手势侧在既有流程里多一步：拿到 `from` / `to` 之后，**枚举选区内的图片引用**（§2），并把结果随
  卡片一起交给面板。
- 空选区 / 选区里没有图片 ⇒ 行为与今天逐字节一致（既有路径不变）。
- 选区里有图片但文本为空（选区恰好覆盖整张图片的替换区）⇒ 只插图片块，不造空文本卡片（D4）。

## 2. 选区内的图片枚举（单一解析真源）

新增纯函数（落 `src/preview/attachments.ts` 或 `src/preview/livePreview.ts` 的既有解析层，
起草倾向后者——它已持有语法树与 `PreviewContext`）：

```
collectImageRefs(state, from, to, ctx): { from: number; to: number; path: string; rawRef: string }[]
```

判据与渲染层**逐条相同**，MUST NOT 另写语法：

1. **标准 Markdown 图片**：`syntaxTree(state).iterate({from, to})` 的 `Image` 节点（渲染层的同一判据）；
   目标取节点内的 URL 文本，相对解析走 `resolveImagePath(ref, currentFilePath)`。
2. **`![[...]]` 嵌入**：`findWikilinkSpans` 的 `embed` 分支；带目录前缀按 vault 相对路径直接用，裸
   文件名走 `resolveByNameUnique`（文件名唯一匹配）；解析不到 → 跳过（与渲染层「占位」同判据）。
3. **排除**：围栏 / 缩进代码块内的文本不产图片（语法树节点判定已天然覆盖——代码块里的 `![](…)` 不是
   `Image` 节点）；`![[note]]` 这类非图片嵌入跳过（`isImageName` 判定）。
4. **顺序**：按 `from` 升序（文档序），去重按 `path`（同一张图被引用两次时只引一次——避免把同一份
   字节写两遍、也在模型侧避免两张同图占两个编号；这是**起草期取值**，不是裁决点）。
5. 解析失败 / 不存在的图片：跳过并**不阻断**整次引用（文本卡片照常产出；不让一张坏图废掉一次引用）。

## 3. 引用事务（vault 图 → composer 图片块）

一次引用 = 先做两步异步 I/O（读 vault 字节、写 harness 存储），再用**一次** `withModel` 把结果
落进 composer（因此是一次结构编辑 = 一个撤销步）：

1. **读 vault 字节**：`fsReadAttachment(path)` → base64；`sourceMime = mimeTypeOf(extensionOf(path))`。
   失败（不存在 / 超 50MB / 非法路径）→ toast（既有错误文案）+ 跳过该图。
2. **写 harness 侧存储**：`harnessWriteImage(base64, sourceMime)` → `{name, width, height}`。后端会做
   png→WebP 无损转码、jpeg/webp 原样、其余子类型拒绝（D1 的格式面）；内容寻址去重 ⇒ 同一张图引用
   两次不会产生两份文件、也不会重复占空间。
3. **插块**：文本卡片（若有）在前，图片按文档序在后（D3），每张图一个 `{kind:"image", card}`
   （`ImageCard` 带 `name` / `sourceMime` / `width` / `height`），光标落在最后一个块之后的新段落。

顺序与失败处置的两条硬约束：

- **先落盘再插块**：块插进去之前字节必须已在 harness 存储里，否则会留下「卡片在场、缩略图读不回」的
  破图态（与粘贴链路的失败口径一致）。
- **部分失败不整体回滚**：n 张图里有一张失败时，其余照常插入 + toast 说明失败原因。理由：整体回滚
  会让一次选区引用因为一张坏图完全失效，而用户的意图是「把这段带上」；失败张数在 toast 里说清。
  （这是**起草期取值**，列在 proposal 表外的实现决策，实现说明里写清。）

## 4. composer 侧

### 4.1 新入口（面板对外面）

`HarnessPanel` 增加一个结构化入口（名字以实现为准，语义固定）：

```
insertQuoteWithImages(card: QuoteCard | null, images: ImageCard[]): void
```

- 面板未打开时先开（与 `insertQuoteCard` 同一条「先开再插」的路径，焦点落 composer）。
- 插入点：`caretFromDom()` 的当前光标（既有口径：不可得时落末尾）。
- **一次** `withModel(...)`：`insertCardAtCaret`（若有卡）+ 逐个 `insertBlockAtCaret`，最后把光标
  落在尾部新段落——因此 ⌘Z 一次撤掉整次引用。
- 既有的 `insertQuoteCard` 保留（文本摘录仍走它）；两者共用同一套插入原语，MUST NOT 复制一份。

### 4.2 人侧来源标注（D2）

图片块的卡片数据**不加字段**（`ImageCard` 的字段是投递协议的投影，加来源会让「图片块」出现两种
形态）。来源路径放在**DOM 的 hover title**：缩略图的 `title` 写「来自 <vault 相对路径>」，与引用
卡片的出处行同一条人类可读口径；该文本**不进**序列化、不进投递、不进草稿存储。

> 这样人侧能回答「这张图哪来的」，模型侧看到的仍是「图片 + `Image N`」——与粘贴图片同一协议。

## 5. 为什么引用正文不剥离图片语法

跨图片选区的引用卡片 `text` 是选区原文（`doc.sliceString`），其中**包含**图片的源码（`![[x.png]]`）。
本 change **不**把它剥掉：

- 悬停 / 跳回失锚链靠 `quotePrefixMatched(doc.sliceString(行范围), card.text)` 做逐字前缀校验
  （`src/quote-gesture.ts` 的 `resolveQuoteAnchor`）——剥离后前缀对不上，卡片点回会掉进第二层
  「全文搜索」，极端情况下直接失锚 toast。
- 模型因此会同时看到「图片语法文本」与「图片字节」。这不是冗余故障，而是**诚实的上下文**：文本
  说明「这里原本有一张图」，字节给出内容本身。

副作用如实登记：引用正文里会看到 `![[...]]` 之类标记（与今天跨图片选区的行为一致，本 change 没有
让它更糟）。

## 6. 待裁决点

| # | 裁决点 | 选项与倾向 | 若裁另一侧的影响面 |
|---|---|---|---|
| D1 | 可引用格式 | **倾向 png / jpeg / webp**（复用粘贴链路的转码面，零新命令） | 扩到 `svg` / `gif` 需要新的后端转码路径（svg 无可解码位图），是独立能力 |
| D2 | 来源是否投递 | **倾向不投递**（人侧 hover 可见，模型侧只有图片 + 编号） | 要投递则需在投递序列加来源文本行，协议增量 + 面板与留存两侧同步 |
| D3 | 卡片与图片的顺序 | **倾向卡片在前、图片按文档序在后** | 反序会让「行范围」读在图之后，与文档顺序相反 |
| D4 | 只有图片的选区是否造空文本卡 | **倾向不造**（只插图片块） | 造空卡需要放宽 `lines` 非空校验，且空文本卡在失锚链上没有意义 |

## 7. 视觉约束（无原型）

- 引用钮取块级动作钮家族的共享形态（`.lumir-block-trigger`），只加位置 class；eink 规则由该家族
  既有两条覆盖，MUST NOT 新写一套。
- 图片右下角内侧 `6px` 处；图片本身**不**加 hover 边框 / 阴影 / 缩放动效（浮现一个钮就是全部反馈）。
- 引用钮的读屏名取 `D370`（既有词条），不新增文案编号。
- 插入后 composer 的图片卡片与粘贴图片逐像素同形（同一条渲染路径）。

## 8. 验证策略（判别性优先）

- **枚举单测**（纯函数，零 DOM）：两种语法各命中；代码块内不命中；`![[note]]` 跳过；解析不到跳过；
  同一路径去重；文档序；选区跨多张图。
- **事务单测**（mock IPC）：写盘顺序（先 `harness_write_image` 再插块）；部分失败 → 其余插入 + toast；
  零写入路径（不碰 vault：整个流程只有 `fs_read_attachment` 读 + harness 侧写）。
- **插入编排单测**（驱动模型层）：卡片 + 2 图 → 块序 = [卡, 图1, 图2]、光标落尾段、**一次**撤销回到
  插入前；无文本选区 → 只有图、无卡；文本只有（无图）→ 与今天逐字节一致（回归锚点）。
- **视觉场景**（chromium + `tauri-stub`；桩需给 `fs_read_attachment` / `harness_write_image` 路由，
  图片用合成 1×1 PNG）：悬停已渲染图片 → 钮出现；点击 → composer 出现图片卡片、编号为 `Image 1`；
  选区跨文字与图片 → composer 出现引用卡 + 图片块；一次 ⌘Z 全撤。既有整页基线**零更新**（默认不动图）。
- **真机验收**：悬停引用一张 vault 图 → 发送 → 模型侧收到图片（mock provider 断言 parts 含 image）；
  跨图选区引用 → 发送 → transcript 同构沉淀；⌘Z 一次撤掉整次引用。
- **门禁**：`gate.sh quick` 全绿；动过 `src/style.css` / `src/preview/**` ⇒ 另跑 `gate.sh visual`。

## 9. 已知边界（如实登记，不包装成覆盖）

1. 只有 `png` / `jpeg` / `webp` 能被引用（D1）；`svg` / `gif` / `heic` 等给 toast。
2. 单张图片的引用钮只有指针路径（图片元素不可聚焦）；键盘用户可用「选区跨过图片 + 文本摘录钮」
   达成同等效果（那条路径产出同样是图片块）。
3. 引用正文保留图片语法文本（§5 的锚校验理由），模型会同时看到标记与图片。
4. 同一选区里同一张图被引用两次时只引一次（去重）；两张视觉相同但路径不同的图会各引一次（不同文件）。
5. 引用进来的图片在 harness 侧存储里是**独立副本**（内容寻址、与 vault 内原文件无链接关系）；vault
   内文件被删改不影响已引用的副本——这是「模型看到的是引用时的内容」这一语义的代价，也是它
   可解释的地方。
6. 模型无视觉能力时发送仍按既有 `harness_image_unsupported` 拒绝（前端 toast + 标出图片卡片），
   本 change 不改那条语义。
