# Design: 左栏点击图片文件在内容区显示图片

- Change ID: add-image-file-preview
- 日期: 2026-10-23

本文只写「怎么做到 proposal 里已裁的行为」与「为什么这样做」。代码锚点是起草时在本分支（基于
master）逐一读过原文的位置；行号会漂，实现前以符号名为准。

## 0. 事实清单（起草时核对过原文）

| 事实 | 锚点 | 与本 change 的关系 |
|---|---|---|
| 分类注册表（image 分类与 MIME） | `src/preview/attachments.ts:108` `IMAGE_MIME`（含 `svg` / `heic`）、`:135` `REGISTRY`、`:228` `mimeTypeOf`、`:232` `isImageName` | 唯一事实源，本 change 不新增第二份扩展名集合 |
| 打开分类 | `src/tree.ts:222` `openKind`（md / code / text 之外一律 `"binary"`） | 本 change 的改动点：图片单独一档 |
| 「暂不支持预览」落点 | `src/main.ts:2201` `loadSessionContent` 的 `kind === "binary"` 分支（`:2208`） → `showNotice(t("D25"))`；文案在 `src/copy-data.ts:52` | 图片从这条分支移出 |
| 覆盖层的显隐 | `src/main.ts:1271` 起 `.editor-notice`（`const notice`）（`shell.editor` 上的整块遮罩）、`showNotice` / `showEditor` | **只**服务单 pane 的临时提示，双 pane 会盖两栏——不适合作为图片查看面 |
| 字节供给 | `src/preview/attachments.ts:262` `createInvokeAttachmentProvider().readDataUrl`（`fs_read_attachment` → `data:${mime};base64,…`）；后端 `src-tauri/src/fs_io.rs:1837` `read_attachment`（50MB 上限，`ATTACHMENT_MAX_BYTES` 在 `:371`） | 查看面复用同一条供给（零新命令） |
| 放大遮罩 | `src/lightbox.ts`（`open(src, rawRef)`；「同一 data URL 的第二次使用命中已解码位图」的实证在文件头） | 双击放大复用，不重读字节 |
| 会话模型 | `src/editor.ts:899` `EditorSession`（`state` / `path` / `loaded` / `cleanDoc` / `dirty` / `mode` / `editable` / `scroll`）、`:1004` `EditorHandle`（每 pane 一个 `view` + 命令表） | 图片会话要落在这一层：它没有可编辑内容，但有路径与标签身份 |
| pane 句柄是联合类型 | `src/main.ts:209` `PaneHandle = {kind:"doc"|"harness"}`、`:193` `PaneAssembly`（`mountEl` / `stripEl` / `guideEl`） | 查看面是 pane 局部元素，挂 `mountEl` |
| 标签栏数据源 | `src/tabs.ts`（会话列表即标签序，`renderTabs` 只渲染） | 图片会话进列表即进标签栏，标题取 `baseName(path)` |
| 前台同步唯一落点 | `src/main.ts:2065` `syncActiveDocument`（modeline / dirty 镜像 / 大纲 / 树当前行 / 标签栏 / 会话落盘 / 阅读位置 flush / 壳装载） | 图片会话要在这一个函数里走各自的分支 |
| 会话恢复建壳闸门 | `src/main.ts:1635` `createShell`：`openKind(path) === "binary"` → return false（图片与二进制一起被跳过） | 必须放行图片，否则重启丢图片标签 |
| 会话落盘形状 | `src-tauri/src/vault_session.rs:49` `PaneSession`（有序相对路径 + 激活项）；`src/main.ts:1650` `openPinned` | **天然支持**图片——存的就是路径，恢复时按 `openKind` 重新分类 |
| 路径链接的可点集 | `src/main.ts:1036` `linkableVaultPaths`（`openKind(path) !== "binary"`） | 分类变更后会**静默**把图片路径变成可点（harness spec 明确要求图片保持纯文本）⇒ 必须显式排除图片 |
| 「打开」的既有闸门 | `src/main.ts:1419`（`openFile(path, openKind(path), …)`）、`:2025`（新建后自动打开）、`:2275`（壳装载）、`:2483`（路径链接打开） | 每个消费点都要按新分类核对（见 §3.3） |
| 单 pane 空态引导 | `src/pane-layout.ts` `emptyPaneGuideVisible` | 图片标签不算「空 pane」（有路径标签） |

## 1. 形态：图片是一个文档标签（D1 的倾向侧）

### 1.1 为什么不是「临时查看面」

临时查看面的实现小得多，但它必须回答一个没有好答案的问题：**标签栏显示谁**。点开图片时当前文档的
标签仍是「当前」，于是界面同时说两件事（「你在看图片」与「当前文档是 A」）。要消除这层歧义，就得
再看一份「正在查看什么」的状态——那正是标签账本已经在做的事。既然最终都要改标签层，就不该先造一个
中间态再拆掉（AGENTS.md「变更默认直接切断」）。

标签形态还直接兑现三件事：⌘W 关闭、分栏并排（图与文档对照）、重启恢复。这三件都不需要额外设计。

### 1.2 会话模型怎么放（不做「空文本别名」）

图片会话与文档会话共用一个标签账本，但**不是**「空文本会话」：把图片伪装成一份空文本文档会打开一条
真实的数据风险——⌘S / 保存全部 / 关标签前保存三条链路都可能把空文本写回图片文件（ADR 0003 §3 铁律
的反面）。因此：

- `EditorSession` 增加判别字段 `kind: "doc" | "image"`（默认 `"doc"`，全部既有构造点不受影响）。
- 图片会话**不带可编辑内容**：`state` 取一份**哨兵空状态**（共享、只读、无路径语义），`editable`
  恒 `false`、`dirty` 恒 `false`、`cleanDoc` 恒空串、`scroll` 恒 `undefined`。
- **所有写盘入口与「读 state 做语义」的入口 SHALL 以 `kind` 判据把关**（`isDocSession(session)` 单一
  判据函数，`src/editor.ts` 导出）：保存控制器三入口、搜索面板、大纲、阅读位置、modeline 右段。
  这是「要记得加判据」的软约束，因此由单测兜底——三个保存入口各有一条「图片会话 → 零 `document_write`
  invoke」的用例（判别性：把判据删掉，用例必红）。
- 图片会话的 `mode` 取新档 `"image"`（`EditorMode` 加一档；它不落盘、不进配置，属纯运行期投影），
  用于 modeline 分支与命令层的排除判据。

### 1.3 前台化

- 图片会话成为前台时：pane 的 CM 视图 SHALL 切到哨兵空状态（**MUST NOT 留着上一份文档的状态**——
  否则任何读 `view.state` 的命令都会作用在上一份文档上，⌘S 尤其危险），同时显示该 pane 的查看面
  （§2）。切回文档会话时 `activateSession` 既有的换 state 逻辑把文档状态装回视图，滚动位置由既有
  `scroll` 快照恢复。
- 焦点：图片会话前台时焦点落查看面容器（`tabindex=0`，可读屏），因此 `editor` 作用域的键位（按
  contentDOM 判定）自然不命中——图片上没有文本编辑语义，这是**结构性**的，不需要额外的键位开关。

### 1.4 会话恢复

- `createShell`（`src/main.ts:1635`）放行图片：为图片建一个 `loaded=false` 的图片会话（不建文本壳）。
  它成为前台时由装配层触发字节装载（对应文档会话的 `ensureActiveSessionLoaded`，两条路径同一处挂）。
- 恢复失败（文件已被删除 / 超过上限）SHALL 保留标签并显示失败占位（spec 场景），MUST NOT 静默丢标签：
  「路径在会话里存在」是用户的期望，占位比消失更诚实。

## 2. 查看面

### 2.1 DOM 与几何

- 每 pane 一个惰性建立的 `.image-viewer`（挂在 `PaneAssembly.mountEl`，`position:absolute; inset:0`），
  与 CM 视图同级但互斥显示（`hidden` 切换）。**不复用** `.editor-notice`：后者是 `shell.editor` 上
  的整块遮罩，双 pane 时会盖两栏（`src/main.ts:1268` 的既有注释明写这一点）。
- 内容：一个 `<img>`（`max-width: 100%`、`max-height: 100%`、`object-fit: contain`、不设
  `width/height` 属性——浏览器按自然尺寸渲染、由 CSS 约束适配，因此「小图不放大」天然成立，与
  lightbox 的缩放口径同源）、一个失败占位块（复用文档内图片的 `errorChip` 形态与人话文案口径）、
  一个加载态文本（与内联图片的 `imageLoadingText` 同一来源）。
- 双击 `<img>` → `ctx.lightbox().open(src, rawRef)`（`rawRef` = 文件名或路径；与文档内图片同一入口、
  同一份 `src` 字符串）。

### 2.2 字节装载与内存（D3）

- 装载：`readDataUrl(path)`（既有 provider，`fs_read_attachment` + `mimeTypeOf`）。
- 缓存策略：**只保留当前激活图片的 `src`**。切走（成为非前台）时把 `src` 置空并从 DOM 撤下
  `<img>`；切回时重读一次（IPC + base64）。理由：常驻内存合同 <200MB（ADR 0002 §6），50MB 的上限
  乘上「几张大图同时驻留」会直接打穿它；代价是切回有一次可感知的加载（如实登记为已知边界）。
- 同一张图在查看面与 lightbox 之间复用同一个 `data:` URL 字符串（第二次使用命中已解码位图，依据
  `src/lightbox.ts` 文件头的实测：同串再解 0.1ms）。MUST NOT 为放大重读字节。

### 2.3 失败与边界（D4）

- 50MB 上限、读取失败、解码不出可见像素三类都落到「占位 + 人话（含路径）」，与文档内图片的「可见
  回退不变量」同一口径；MUST NOT 弹对话框、MUST NOT 用破图图标、MUST NOT 退回 D25 覆盖层。
- SVG 走同一条 `<img>` + `data:image/svg+xml;base64,…` 路径（与内联渲染同口径，既有「SVG 图片的
  渲染安全性」条款自动覆盖：不在查看面里内联 SVG 内容、不做净化分支）。

## 3. 打开链路与分类

### 3.1 `openKind` 增加一档

`openKind(path)` 从 `"md" | "code" | "text" | "binary"` 改为 `"md" | "code" | "text" | "image" | "binary"`，
image 档来自既有注册表（`fileClassOfPath(path) === "image"`），**不新写扩展名集合**。

### 3.2 打开分流

`loadSessionContent` 在 `kind === "image"` 时不再走 binary 的提示分支，改走「建图片会话 + 前台化」；
`kind === "binary"` 的既有分支逐字不变（PDF、可执行文件仍是 D25 提示）。

### 3.3 分类消费者的逐点核对（改动面清单）

分类一旦分叉，所有读 `openKind` 的点都要回答「图片算不算」。起草时全仓核对结果：

| 消费点 | 今天的行为 | 本 change 的处置 |
|---|---|---|
| `src/main.ts:1037` `linkableVaultPaths` | `!== "binary"` ⇒ 只链接文本类 | **显式排除 image**（harness spec 要求图片保持纯文本；否则静默变成可点） |
| `src/main.ts:1635` `createShell`（会话恢复） | image/binary 都不建壳 | 放行 image（§1.4） |
| `src/main.ts:1419` / `:2025` / `:2275` / `:2483` `openFile` 调用点 | 按 kind 分流 | 图片走图片会话，其余不变 |
| `src/main.ts:2678`（quote 跳回） | `openKind` + quiet | 锚点指向图片的引用不存在（引用卡片只指向文本），行为不变 |
| `src/tree.ts:196` `displayKind` | 已区分 image（图标） | 不变 |
| 验收 / 视觉 fixture | 图片条目今天点开是 D25 | 增量场景改期望（tasks §4/§5） |

> 这一节是 REVIEW.md『同一语义两处真源』条要求的「先 `rg` 全仓确认消费点」，不是可选的收尾步骤。

## 4. 待裁决点

| # | 裁决点 | 选项与倾向 | 若裁另一侧的影响面 |
|---|---|---|---|
| D1 | 图片是标签还是临时查看面 | **倾向标签**（§1.1：标签栏是唯一账本；⌘W / 分栏 / 恢复免费） | 临时查看面：省掉 §1.2–§1.4 的会话模型改动，但标签栏「当前」失真、图片不进恢复；且仍要一份「正在查看什么」的状态 |
| D2 | 显示口径 | **倾向适配可视区且不放大**（与 lightbox 同一条口径） | 1:1 + 滚动：新增滚动容器与居中策略，与 lightbox 口径分叉，需要第二套视觉口径 |
| D3 | 内存策略 | **倾向只保留激活图片**（切回有一次加载） | 全保留：切标签瞬时，内存随打开图数线性涨，可能打穿 <200MB |
| D4 | 失败口径 | **倾向占位 + 人话**（与文档内图片同口径） | 回落 D25 覆盖层：语义上退回本提案要修掉的状态，且覆盖层会盖住标签 |
| D5 | modeline 右段 | **倾向「图片 · 宽×高 · 文件大小」**（沿用「这份内容是什么」的读数位） | 只写「图片」或留空：更省事，但同一位置在文档上信息密度很高，留空会像缺陷 |

## 5. 与既有不变量的关系

- **不写源文件**（ADR 0003 §3）：查看面只读字节、只显示；`document_write` 在这条链路上零调用。
- **不产生可编辑面**：图片会话前台时 pane 视图是哨兵空状态、`editable=false`；键入不落任何地方。
- **搜索 / 大纲 / 阅读位置**：三者对图片会话为空动作——搜索面板照常打开但无内容可搜（空态，MUST NOT
  显示上一份文档的内容）；大纲不显示；阅读位置不记录（图片没有「上次读到哪里」）。
- **dirty 镜像**：图片会话恒 clean，不向后端上报 dirty；退出守卫不受影响。
- **CL-2 不涉及**：图片查看不推动编辑器视口。
- **性能合同**：图片走独立标签，不进「打开 1MB Markdown <100ms」的路径；装载一次的 IPC 与内联图片
  同一量级（50MB 上限以内的 base64 传输与解码是已存在的成本口径）。

## 6. 视觉约束（无原型）

本 change 没有原型。实现口径：

- 查看面底色取 `--content-bg`（与文档正文同一承载面），不新增色值。
- 图片居中（`display:grid; place-items:center`），四周留白吃既有 `--sp-*` 档；不画边框、不加阴影
  （与 lightbox 的「不装饰」取向一致）。
- 加载态与失败占位取既有文案与既有 chip 形态（与文档内图片同一来源，MUST NOT 新写一套文案）。
- 标签条里图片标签与文档标签同形（无图标、无角标）；modeline 右段按 D5。

## 7. 验证策略（判别性优先）

- **分类单测**：`openKind` 的 image 档（含 `.png` / `.svg` / `.heic` / 无扩展名 / 目录）；`linkableVaultPaths`
  仍排除图片（反向用例：造一个 image 路径，断言不进可点集——这是「静默变成可点」的唯一防线）。
- **会话单测**：图片会话的 `editable` / `dirty` / `kind` 取值；三个保存入口在图片会话上零 `document_write`；
  阅读位置对图片路径不写；搜索面板在图片会话上是空态。
- **恢复单测**：会话里含图片路径 → 建壳不再被跳过（`createShell` 返回真）；前台化时触发装载一次。
- **视觉场景**（chromium + `tauri-stub`，桩需新增 `fs_read_attachment` 路由，返回 1×1 合成 PNG 的
  base64 常量）：点树里的图片 → 查看面在场、`<img>` 的 `naturalWidth` > 0、标签标题正确、无 D25 文案；
  双击 → 遮罩打开；坏图（桩返回错误）→ 占位与人话在场；切到文档标签再切回 → 查看面按 D3 重读一次。
  既有整页基线：默认仍打开文档，**零更新**。
- **真机验收**（`scripts/acceptance/scenarios/`）：点开 png（合成 fixture）→ 看到图片；双击放大；
  ⌘S 无写入（文件 mtime 不变）；重启后图片标签恢复并显示；点开一个 PDF → 仍是 D25 提示（反向验证）。
- **门禁**：`gate.sh quick` 全绿；动过 `src/style.css` ⇒ 另跑 `gate.sh visual` 并按 `GATE RESULT` 原文报告。

## 8. 已知边界（如实登记，不包装成覆盖）

1. 显示格式取决于系统渲染引擎：`heic` / `avif` 等在 WKWebView 里能否解码不由我们决定，不能解码即失败
   占位（不做转码）。
2. 切回非激活图片有一次重读（D3）；500KB 以上的图在慢盘上可感知，如实登记。
3. 图片标签不参与「保存全部脏标签」与「切 vault 的 dirty 守卫」（恒 clean），因此不会拦退出。
4. 图片标签上的 ⌘F 打开搜索面板但没有内容可搜（空态），不提示「此文件不可搜索」（不加新文案）。
5. 文档内 `![[...]]` 引用图片的既有行为逐条不变；本 change 只影响**从树直接点开**的落点。
6. 缩放 / 旋转 / 平移 / 图集 / 缩略图列表均不在本 change（见 Non-goals）。
