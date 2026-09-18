# Design: image-svg-and-fallback

## 1. 现状锚点（本 change 要动的东西今天在哪）

### 1.1 扩展名白名单：**只有一份**，且 svg 已在其中

| 问题 | 答案 | 证据 |
|---|---|---|
| 白名单在哪 | `src/preview/attachments.ts:76-87` 的 `IMAGE_MIME`（键集即 image 分类）；svg 在 `:82`，MIME = `image/svg+xml` | 另见模块头 `:8-12` 声明「本文件是扩展名 → 分类/语言/MIME 的唯一事实源」 |
| 谁是消费者 | `src/tree.ts:8,32,40`（展示分类）、`src/main.ts:43,84`（附件 `data:` URL 的 MIME）、`src/editor.ts:23-24`（模式裁决）、`src/preview/code.ts:38`（语言名类型约束） | `rg` 全仓无第二份图片扩展名表（[REVIEW.md](../../../REVIEW.md) 第 8 条的核对动作已做） |
| 未收录的扩展归哪一类 | 不在白名单里（`REGISTRY` 之外的扩展按 `text` 分类，`src/preview/attachments.ts:129-132`），但这**不影响内联渲染**，见 1.2 | |
| vault 扫描是否按扩展名过滤 | 不过滤：`src-tauri/src/fs_io.rs:155` 的注释写明「全类型递归枚举（不按扩展名过滤）」；唯一的忽略集是 `IGNORED_NAMES`（`:27`：`.git` / `.DS_Store` / `node_modules`） | |

**关键结构事实**：标准 Markdown 图片的渲染路径**不查这张白名单**。`buildStandardImage`
（`src/preview/livePreview.ts:863-884`）只区分「外部 `http(s)` URL」（`:869-873`，URL 直接当 `src`）
与「其余一切」（`:880-883`，交给 provider 读字节），MIME 仅用于拼 `data:` URL，未知扩展兜底成
`application/octet-stream`（`src/main.ts:84`）。**因此「把 svg 加进白名单」不是待做的修复**——
白名单里已经有了，而它根本不在这条路径的判断链上。

### 1.2 图片字节的加载方式：invoke + base64 的 `data:` URL（不是 asset / custom protocol）

| 环节 | 实现 | 证据 |
|---|---|---|
| 前端读字节 | `fsReadAttachment(path)` → `invoke<string>("fs_read_attachment", { path })` | `src/main.ts:82-86`（装配）、`src/preview/attachments.ts:171-182`（同契约的默认 provider） |
| 拼 URL | `` `data:${mime};base64,${base64}` ``，mime 取扩展名注册表 | `src/main.ts:84` |
| Rust 命令 | `fs_read_attachment` → `fs_io::read_attachment` → `base64_encode` | `src-tauri/src/commands.rs:549-554`、`src-tauri/src/fs_io.rs:424-427`；命令注册在 `src-tauri/src/lib.rs:73` |
| 路径防护 | `resolve_in_vault`：拒绝空路径、绝对路径、含 `..` 的路径、canonicalize 后逃出 vault 根的路径 | `src-tauri/src/fs_io.rs:234-253`、`:268+` |
| 大小上限 | 50MB，**先看 metadata 再读**（超限不分配内存） | `src-tauri/src/fs_io.rs:30`、`:288-297` |
| 前端相对路径解析 | `resolveImagePath`：相对当前文件目录解析；逃逸 vault 根时回退为 vault 根相对 | `src/preview/attachments.ts:194-211` |
| 成品 CSP | `img-src 'self' asset: data:` —— `data:` 放行（所以内联路径可用），外部 `http(s)` 图片**一律被拦** | `src-tauri/tauri.conf.json:21` |

结论：**本 change 不新增任何字节通道**。「图片加载方式」的三种候选里，现行是 invoke+base64，
不是 Tauri 的 asset protocol，也不是自定义 protocol。

### 1.3 加载失败与「不支持格式」的现行处理：两条兜底 + 一个空洞

`ImageWidget`（`src/preview/attachments.ts:214-255`，DOM 见 `:227-234`）的每次 `toDOM` 都会：

1. 先插入 `加载中… {原始引用}` 的可见状态块（`:231-234`，样式 `.cm-lp-image-status`
   `src/preview/theme.ts:146`）；
2. `load()` 成功后建 `<img>`，`alt` 设为原始引用（`:238-239`），插入后设 `src`（`:243-244`）；
3. `img.onerror` → 换成错误块「图片解码失败：{原始引用}」（`:240-242`）；
   紧跟一次同步探测 `if (img.complete && img.naturalWidth === 0) img.onerror(new Event("error"))`
   （`:245-247`）；
4. `load()` reject（invoke 失败）→ 换成错误块「图片读取失败：{原始引用}（{原因}）」（`:249-251`）。

三种失败形态的覆盖情况：

| 失败形态 | 有可见回退吗 | 机制 |
|---|---|---|
| 字节读取失败（文件不存在 / 权限 / 超限 / 路径逃逸） | **有** | `:249-251` |
| `<img>` 抛 `error`（解码失败、格式不支持、**外部 URL 被 CSP 拦**） | **有** | `:240-242` |
| 解码成功但渲染不出可见像素（尺寸为零） | **无** | 两条都不命中：没有 `error` 事件；`naturalWidth` 也不必然为 0（例如声明了 `viewBox`、宽高为 `auto` 的 svg，规范要求宽高**保持 `auto`**，见 §4.4） |

「不支持格式」在今天**没有独立的判定与文案**：`![x](a.psd)` / `![x](a.heic)` 一律走
「读字节 → `data:` URL → 交给 `<img>`」，失败时归入「解码失败」那一类。也就是说，**格式支持与否
不是前端判定，而是渲染引擎的行为**——所以本 change 不在前端加格式白名单（那会造出第二份表，
违反 [REVIEW.md](../../../REVIEW.md) 第 8 条），只保证「引擎给不出可见像素时有可见回退」。

同一条兜底还覆盖 Obsidian 方言：`buildWikiEmbedWidget`（`src/preview/livePreview.ts:974-994`）先用
`isImageName`（`:979`，走 `attachments.ts:144-146`）分流，非图片出「内容嵌入不支持」占位（`:980`），
文件名匹配不到出「附件未找到」占位（`:990-992`），命中则同一个 `ImageWidget`（`:993`）。

### 1.4 源码显露：图片**不在**选区显露机制覆盖内（现状，本 change 不变）

`touchesSelection` 定义在 `src/preview/livePreview.ts:650-651`，全文只有六处调用：frontmatter 块
（`:419`，另有独立实现）、callout 首行（`:762`）、引用续行 `QuoteMark`（`:775`）、分隔线行（`:786`）、
标准链接（`:821`）、callout 内容行（`:669-670`、`:719`、`:802`）。**`Image` 分支
（`:807-815`）没有调用它**：`Decoration.replace` 覆盖整条 `![alt](path)`，光标进入该行也不显露源码。
全仓无 `atomicRanges`（`rg atomicRanges src/` 零命中），所以光标还能落进被替换的区间而不可见。
living spec `editor-live-preview` 的「live preview 装饰层」逐项点名显露覆盖集，其中**不含图片**。

→ 因此 proposal 里「光标进入该行显露源码」不能按「既有行为不变」写：对图片它本来就不存在。本
change 的处理是**维持现状**，并把「图片行是否与链接/分隔线同口径」列为选项 A/B 交 Alex 裁决
（见 proposal 同名小节）。

### 1.5 现有测试为什么没守住（断言没有区分度）

- `tests/visual/scenes/markdown-combo.spec.ts:34`：`.cm-lp-image-status, .cm-lp-image-error` 的
  first 可见。`加载中…` 块在图片插入前的第一帧就存在，因此「渲染成功」「原地变白板」「最终报错」
  三者都能让它 PASS。同场景对「成功渲染出图片」零断言（`.cm-lp-image img` 只在失败场景断言
  `toHaveCount(0)`，`:92`）。
- 该场景**没有整页基线**（`markdown-combo.spec.ts` 无 `toHaveScreenshot`，`tests/visual/baselines/`
  下也没有它的 snapshot 目录），所以视觉回归门禁对图片显示结果也不判任何东西。
- fixture 侧也不够：`tests/visual/fixtures/markdown-combo/combo.md:25,27,29,31` 四行里，
  `assets/sample.svg` 是**带 width/height** 的 svg（`sample.svg`），另三个目标不存在——**没有一份
  「能解码但渲染为零尺寸」的样本**，而那正是本缺陷的空洞所在。

## 2. 为什么「不可见」是必须堵的洞，而不是审美问题

替换装饰把源码藏起来，是 live preview 的既定设计（`editor-live-preview` spec 的编辑态口径）。这个
设计成立的前提是**替换物一定看得见**：渲染成功就给图，渲染不了就给占位。前提一旦破，用户失去的是
两样东西——图片**和**源码，而界面上没有任何迹象说明这里有东西。这与 living spec
`attachment-display` 的现行条款「MUST NOT 显示破图图标、抛错弹窗或阻断文档其余渲染」是同族问题，
只是现行条款只枚举了「不存在 / 解析失败 / 读取返回错误」三种成因，**没有覆盖「读取成功但渲染
不可见」**。

## 3. 本 change 的合同（不变量条款）

### 3.1 条款表述

> 对任意被 live preview 识别为图片引用的源码片段（标准 `![alt](target)`、外部 `http(s)` 目标、
> Obsidian `![[target]]` 三种形态），若替换区**最终没有可见图像像素**，替换区 SHALL 呈现可见占位，
> 占位 SHALL 含人话成因与原始引用文本；替换区 MUST NOT 出现零高度空白；从源码被替换到终态之间
> SHALL 始终有可见内容，MUST NOT 存在「有内容 → 空白 → 有内容」的空窗。

条款引用的是**输入分布**（引用形态 × 读取结果 × 解码结果 × 渲染尺寸），不引用具体案例（不是
「那张 svg」）。这正是
[rendering-defect-contract-first.md](../../../docs/process/rendering-defect-contract-first.md)
要求的形态：先定位/补齐不变量条款，再配不变量级的属性测试。

### 3.2 实现口径（不写死实现，只定判据）

- **终态判据**：加载完成后，图片可见的充分条件是「解码成功 **且** 渲染尺寸非零」。任一不成立即
  走占位。`naturalWidth/naturalHeight` 只能作辅助信号（`viewBox` + `auto` 宽高的 svg 可能报 0，
  而它们可能仍然渲染为可见；反过来也可能非零而外层塌成零）——判据必须落在**替换区自身的可见
  尺寸**上，不能只落在 `naturalWidth` 上。
- **不得依赖 `load` 事件的时序**：不得用「插入 `<img>` 后再补一次兜底」这种最终必然生效的方案
  ——空窗期内用户看到的就是空白，同样命中不变量。
- **占位形态复用既有视觉语言**：既有错误块样式 `.cm-lp-image-error`（`src/preview/theme.ts:147-156`）
  已具备边框、内边距与强调色，占位 SHALL 复用它，MUST NOT 引入新的视觉语言。

### 3.3 属性测试要扫的输入维度

| 维度 | 取值 |
|---|---|
| 引用形态 | 标准 `![alt](rel.svg)` / 标准 `![alt](https://…)` / `![[file.ext]]` |
| 目标存在性 | 存在 / 不存在 |
| 字节读取 | 成功 / invoke 报错（`tauri-stub` 的 `failures` 注入，见 `tests/visual/scenes/tauri-stub.ts:303`） |
| 解码 | 成功 / 触发 `error` / 同步 `naturalWidth === 0` |
| 渲染尺寸 | 非零 / 零（只声明 `viewBox` 的 svg；零字节以外的正常内容） |

断言（两层，都必须有）：

1. 视觉层（chromium）：替换区的可见内容高度 > 0（**不是**「某个 class 存在」）；且
   `.cm-lp-image img` 存在 **当且仅当** 渲染尺寸非零。
2. 真机层（WKWebView）：该位置的 AX 文本非空，且含原始引用串（alt 与路径都在这一串里）。

**反向验证（[REVIEW.md](../../../REVIEW.md) 第 1 条的防线）**：新断言写好后，先塞一份「只声明
`viewBox`」的零尺寸 svg 进去实测，**确认它红**（今天的实现就是红），再动实现。

## 4. SVG 安全性论证

### 4.1 载入上下文决定权限，`<img>` 上下文的两个处理模式都关闭脚本与外部资源

SVG 规范把「被引用时的处理模式」单独定义，按引用方式选模式，并给出每个模式下四项能力的开关
（[SVG Integration，W3C SVG 工作组编辑草案](https://svgwg.org/specs/integration/)）：

- 引言（§1）：原文「For example, SVG documents referenced by an HTML `img` element are required to
  have scripting disabled.」——`img` 引用的 SVG **必须**关闭脚本。
- 引用模式（§2）：`img` 元素（或任何取 `<image>` 值的 CSS 属性）对应两种模式之一——
  **animated image document**（动画可跑时）与 **static image document**（动画不可跑时）。
- 处理模式（§3）：这两种模式分别要求 **secure animated mode**（§3.4）与 **secure static mode**
  （§3.6）。两者的特性表逐项是：

  | 能力 | secure animated | secure static |
  |---|---|---|
  | script execution | **no** | **no** |
  | external references | **no** | **no** |
  | declarative animation | yes | no |
  | interactivity | **no** | **no** |

也就是说：**无论渲染引擎把 `img` 归到这两者中的哪一个，脚本执行与外部资源解析都是关闭的**——
这一点不依赖我们对引擎内部选择的猜测。规范对「关闭外部资源」的后果也写明了：任何经外部引用取
文档的尝试「must be treated as if a network error occurred and no data was received」。

同族的第一手描述见 MDN 的 `<image>` 元素页：以图像上下文显示的 SVG「external resources aren't
loaded, `:visited` styles aren't applied, and they cannot be interactive」
（[`<image>` - SVG | MDN](https://developer.mozilla.org/en-US/docs/Web/SVG/Element/image)）。

**信源可靠度说明**：SVG Integration 目前是 Editor's Draft（2025-09-14 版），不是 W3C REC；但它由
SVG 工作组维护、且描述的是浏览器现行行为，是本议题的一手规范来源。本 change 不把安全性只押在这
份引用上——第 3.3 节的属性测试会把「含 `<script>` 与外链的 svg」实测一遍（不执行、不发起请求），
把规范断言变成仓内可复现的证据。

### 4.2 因此被禁止的实现路径：把 SVG 内联进 DOM

若为了「让 svg 显示」而把文件内容经 `innerHTML` / `insertAdjacentHTML` / `DOMParser` + 插入节点
内联进文档，SVG 就变成 **dynamic interactive mode**（§3.2：脚本、外链、动画、交互全开）——一条
vault 里从别处下载的 svg 就能在打开笔记时执行脚本。所以 spec 条款 MUST NOT 用这些方式渲染 SVG，
只允许 `<img>`（本仓现有路径就是 `<img>`，本 change 只是把这条原因写进合同，防将来「顺手改成
内联」）。

**CSP 是第二道防线，不是本条款的理由**：成品 CSP（`src-tauri/tauri.conf.json:21`）是
`script-src 'self'` + `img-src 'self' asset: data:`，内联 SVG 里的行内 `<script>`、`on*` 事件属性
与外部 `<image href>` 今天都会被 CSP 挡下。禁止内联插入的理由是**不把这一点寄托在一行随时可能被
改动的 CSP 上**（本 change 不动 CSP），而不是「今天已经漏了」。

### 4.3 残余风险

- **资源耗尽**：50MB 上限（`src-tauri/src/fs_io.rs:30`）对图片偏大——base64 后约 67MB 字符串，
  解码后的位图可能远超常驻内存合同（ADR 0002 §6 的 200MB）。这是**既有边界**，对所有图片形态
  同等成立，不由 svg 引入；本 change 不改上限，但要求实现期在本节记录实测观感（见 tasks）。
- **XML 解析错误**：畸形 svg 由引擎判为 `error`，落进「解码失败」类，有可见回退——不需要额外处理。

### 4.4 尺寸：零尺寸是规范允许的形态

同一份规范另有一节规定 SVG 在 CSS 上下文里的尺寸解析
（[SVG Integration § Sizing SVG content in CSS context](https://svgwg.org/specs/integration/)）：
`svg` 元素的初始宽高为 `auto`；解析 `auto` 时，**没有 `viewBox`** 才把缺失的宽/高分别解析为
`300px` / `150px`（CSS 2.1 的替代元素尺寸算法），**有 `viewBox` 则把未声明的宽/高保持为 `auto`**，
只给出固有宽高比。因此「只声明 `viewBox`（或只声明 `viewBox` + 百分比宽高）」是一份**合法**的 svg，
它在行内 `inline-block` 容器（`src/preview/theme.ts:144`）里不保证得到非零渲染尺寸——这是第 1.3 节
「第三条失败形态」有规范支撑的来源，也是本 change 要求把终态判据落在**替换区可见尺寸**上的直接理由
（只读 `naturalWidth` 会在这一类上给出错误结论）。

## 5. fallback 形态与文案

### 5.1 为什么把「解码失败」改成成因中立的措辞

`<img>` 的 `error` 事件**不携带原因**：无法解码的格式、被 CSP 拦下的外部 URL、内容为空的响应、
XML 解析失败，前端拿到的是同一个事件。今天把这几类一律说成「图片解码失败：{引用}」，
对「外部 URL 被 CSP 拦」是**错误的人话**（proposal 的 Why 第四节第 3 点）。所以终态占位改用成因
中立的「图片无法显示：{引用}」。

### 5.2 占位必须含 alt 与路径，且**已经**由「保留原始引用文本」满足

三种形态传给 widget 的 `rawRef` 都是原始语法文本：标准形态传 `refText`（`livePreview.ts:810-812`
的 `doc.sliceString(ref.from, ref.to)`，即整条 `![alt](path)`），方言形态传 `raw`
（`:935` / `:962` / `:993` 的原文）。alt 与路径都在这一串里。因此条款写「占位 SHALL 含原始引用
文本」即可同时满足「含 alt 与路径」，不需要把 alt 与 target 拆成两个字段——**除非**要实现
「alt 与路径分行显示」的排版，那会把一次 widget 构造签名变更引进来（非目标级代价，不建议）。

### 5.3 deck 条目（新文案按 deck 流程登记）

三条图片态文案今天都不在 `文案-Copy.md` 里（deck 的 `D31`/`D32`/`D33`，`文案-Copy.md:22-24`，
只覆盖 `AttachmentNoticeWidget` 的三种占位）。按 deck 规则（编号只追加、不复用已删除编号，
当前末位 D110），本 change 追加：

| 编号 | 位置 | 角色 | 中文 | English | 设计意图 |
|---|---|---|---|---|---|
| D111 | 图片位加载中状态 | 作者 | 加载中… {引用} | Loading… {reference} | 加载是异步的，静默等待会让作者以为这里没有东西；带上引用文本让作者一眼认出是哪个引用。 |
| D112 | 图片字节读取失败占位 | 作者 | 图片读取失败：{引用}（{原因}） | Image read failed: {reference} ({reason}) | 这一类的成因后端给得出来（文件不存在 / 权限 / 超限），如实透传，与 D19 的通用错误形态同口径。 |
| D113 | 图片终态不可见占位（解码失败 / 格式不支持 / 渲染尺寸为零） | 作者 | 图片无法显示：{引用} | Image can't be displayed: {reference} | `img` 的失败事件不携带原因，编不出准确成因；措辞止于「显示不出来」+ 原始引用，既诚实又给出定位信息。 |

同时把被**替换掉**的旧串记入 deck 备注段的对照说明：`图片解码失败：{引用}` 退场（它把多类成因
一律说成解码失败），`加载中… {引用}` 与 `图片读取失败：{引用}（{原因}）` 为**补登**（实现期就
存在但从未进 deck）。文末「文案实现备注」段（`文案-Copy.md:105`）按既有记法登记归属文件。

## 6. 路径解析与 vault 边界：本 change 不变

- 相对路径解析：`resolveImagePath`（`src/preview/attachments.ts:194-211`）保持现状——相对当前文件
  目录解析，逃逸 vault 根时回退为 vault 根相对。svg 与位图**走同一份解析**，不新增 svg 专属分支。
- Rust 侧拒绝规则不变：空路径 / 绝对路径 / 含 `..` / canonicalize 后逃出 vault 根
  （`src-tauri/src/fs_io.rs:234-253`）。
- webview 仍不直接访问文件系统（ADR 0002 §3）：字节只能经 `fs_read_attachment` 进来。
- 外部 URL 分支（`src/preview/livePreview.ts:869-873`）保持现状：URL 直接当 `src`，成品里必然被
  CSP 拦下并落到可见占位（措辞已由 5.1 修正为不撒谎的成因）。

## 7. 备选方案与拒绝理由

| 方案 | 拒绝理由 |
|---|---|
| **只给 svg 加特判分支**（`extensionOf(path) === "svg"` 时做点什么） | 缺陷机制与扩展名无关（第 3.1 节的输入分布里没有「扩展名」这一维）；svg 特判会在下一篇报告换成 png/heic 时重演。也违反合同先行规则。 |
| **用 `naturalWidth === 0` 当唯一的终态判据** | `viewBox` + `auto` 宽高的 svg 可能报 0 而仍可见，图片也可能非零而外层塌成零。判据必须落在替换区自身的可见尺寸上（第 3.2 节）。 |
| **引入 asset protocol 或自定义 protocol 旁路 `data:` URL** | 现有 `data:` 路径没有失败证据；换通道要动 Rust、CSP 与权限面（非目标）。契约层面 「invoke + base64」是 living spec 已裁决的形态，换通道属于另一个 change。 |
| **内联 SVG 到 DOM（`innerHTML`）** | 打开脚本执行与外部资源解析（第 4.2 节），且被 CSP 挡下的同样是白板——收益为零、风险为正。 |
| **在前端加「可渲染格式白名单」** | 会造出第二份扩展名表（[REVIEW.md](../../../REVIEW.md) 第 8 条），而且前端判不出引擎的解码能力——判定权本来就在引擎手里。 |
| **给 svg 加净化器（sanitize）** | `<img>` 上下文已经关闭脚本与外链，净化器只增加一份需要长期跟进的解析代码（Non-goals）。 |
| **顺手把图片行纳入选区显露源码** | 这是对所有图片的可见行为变更，超出本次诉求；列为选项 B 交 Alex 裁决（proposal）。 |

## 8. 风险与未决点

| 项 | 状态 | 处置 |
|---|---|---|
| Alex 那张 svg 的真实成因（解码失败，还是解码成功但零尺寸） | **未定**，`<img>` 的错误事件不携带原因 | 实现期第一项任务：真机打开该形态的样本，用「有图 / 有占位 / 空白」三种终态定位；定位结果回填到本节。**不阻塞实现**——不变量对两种成因同等生效。 |
| 零尺寸判据的取法（何时算「不可见」） | 待实现期定 | 以「替换区可见高度 > 0」为判据，配合真机复核；阈值/取法写进实现 PR 的说明，不在本 change 预设像素值。 |
| 大图（含 50MB 级附件）的排版与内存 | 既有边界 | 本 change 不改；实现期记录一次实测观感，必要时另立 finding。 |
| 呈现层是多 vault / 多标签的装配 | 无冲突 | 图片渲染在 `EditorView` 的装饰层，与 vault 切换、标签切换无耦合。 |

## 9. 验收面（与 tasks.md 对应）

- **合同层**：`attachment-display` 增量的四条（2 MODIFIED + 2 ADDED）逐条落到 scenario。
- **视觉层（chromium，CI）**：`tests/visual/scenes/markdown-combo.spec.ts` 的无区分度断言换成
  「成功渲染」与「不可见即占位」两侧都判；新增零尺寸 svg / 位图与含脚本、外链的 svg fixture。
- **真机层（WKWebView，`scripts/acceptance/`）**：新增场景，断言该位置的 AX 文本在 svg 与失败
  形态下都非空且含原始引用。
- **文案层**：D111–D113 进 deck + 备注段登记。
- **不改写源文件**：所有场景断言 `EditorState.doc` / 磁盘文件逐字节不变（ADR 0003 §3）。
- **基线**：本 change 预期不动任何整页基线（`markdown-combo` 无基线；`rg` 全仓确认无基线场景含
  图片占位），但按 [REVIEW.md](../../../REVIEW.md) 第 3 条的纪律，实现期必须逐个核对图片占位
  出现过的场景，把核对结果写进 PR 说明。
