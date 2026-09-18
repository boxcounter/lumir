# Proposal: SVG 图片内联渲染与「不可见图片必须可见回退」不变量

- Change ID: image-svg-and-fallback
- 日期: 2026-09-18
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 实测原话（2026-09-18）：**「支持 svg 图片显示——目前不显示，而且连源码都看不到了、误以为没有图片，
当时源码是：`![Hooks Overview](images/hooks-overview.en.svg)`」**。

### 一、先纠正一个会被当成结论的假设：svg 并没有「不被支持」

svg 早在扩展名注册表里，MIME 为 `image/svg+xml`（`src/preview/attachments.ts:82`）。而且标准
Markdown 图片的渲染路径**根本不查扩展名白名单**——`buildStandardImage` 拿到 `![alt](target)` 就
替换成图片 widget，MIME 只用来拼 `data:` URL，未知扩展兜底成 `application/octet-stream`
（`src/preview/livePreview.ts:863-884`、`src/main.ts:82-86`）。也就是说，今天无论扩展名是什么
（`.png` 也好 `.svg` 也好 `.psd` 也好），行为都是「读字节 → 拼 `data:` URL → 交给 `<img>`」。

所以「svg 没被收录」不是本缺陷的可证伪描述。把 svg 加进白名单**不会修好任何东西**。真正成立的是
下面两件事。

### 二、缺陷一：替换区可以没有任何可见回退，于是「源码也看不到了」

`ImageWidget` 把整条 `![alt](path)` 替换掉（`src/preview/livePreview.ts:812`，`Decoration.replace`
覆盖 `ref.from–ref.to`），替换后的可见性只由两条兜底路径保证：

| 情形 | 现行处理 | 证据 |
|---|---|---|
| 字节读取（invoke）失败 | 可见错误块「图片读取失败：{引用}（{原因}）」 | `src/preview/attachments.ts:249-251` |
| `<img>` 触发 `error`，或**同步**探测到 `complete && naturalWidth === 0` | 可见错误块「图片解码失败：{引用}」 | `src/preview/attachments.ts:240-242`、`:245-247` |
| **解码成功、但渲染不出任何可见像素**（渲染尺寸为零） | **没有兜底** | 上表两条都不命中：没有 `error` 事件、`naturalWidth` 也不必然为 0 |

第三条一旦命中，整条引用被换成一块**零高度、零宽度的空白**：源码被 `replace` 装饰藏起来（图片分支
没有选区判断，`src/preview/livePreview.ts:807-815`），图片又看不见——这就是 Alex 说的「连源码都
看不到了、误以为没有图片」。注意这条不是 svg 专属：任何「能解码但渲染为不可见」的图片形态都会
落进来。

svg 恰好有一类**规范允许**的零尺寸形态：宽度/高度为 `auto` 且只声明了 `viewBox` 时，规范要求把
宽高**保持为 `auto`**（只在完全没有 `viewBox` 时才回落到 300px×150px 的默认替代元素尺寸）
（[SVG Integration § Sizing SVG content in CSS context](https://svgwg.org/specs/integration/)）。
在行内 `inline-block` 容器里，这个 `auto` 就可能塌成 0——而 `.cm-lp-image img` 只有 `maxWidth: 100%`，
没有任何最小尺寸兜底（`src/preview/theme.ts:144-146`）。

**本节不断言 Alex 那一张 svg 的具体成因**（[tasks.md](tasks.md) 的 1.1–1.3 把它列为实现期的第一项
任务：真机复现并判定是「解码失败」还是「解码成功但零尺寸」）。本 change 的立场是：**无论成因是哪
一类，空白都不允许出现**——这正是把它写成不变量而不是写成一个 svg 补丁的理由。

### 三、缺陷二：现有测试守不住这条线（断言没有区分度）

`tests/visual/scenes/markdown-combo.spec.ts:34` 的断言是
`.cm-lp-image-status, .cm-lp-image-error` 的 first 可见——而 `加载中… {引用}` 这块状态文本
（`src/preview/attachments.ts:231-234`）**在图片插入前的第一帧就存在**，因此这条断言被任何状态
满足：一张最终渲染成功的图、一张原地变白板的图、一张最终报错的图，三者都能让它 PASS。同一场景里
对「成功渲染出图片」没有任何断言（`.cm-lp-image img` 只在失败场景里被断言 `toHaveCount(0)`，
`:92`）。这与 [REVIEW.md](../../../REVIEW.md) 第 1 条「断言等价于子串、没有区分度」同形。

### 四、为什么这条不变量要覆盖**全部**图片形态，而不是只覆盖 svg

三条理由，都可证伪：

1. 缺陷的机制（替换区无可见回退）与扩展名无关，只与「最终有没有可见像素」有关。
2. 引用形态有三条，共用同一个 widget：标准 `![alt](path)`（含 `http(s)` 外部 URL 分支，
   `src/preview/livePreview.ts:869-873`）、Obsidian `![[file.ext]]`（`src/preview/livePreview.ts:993`）。
   只修一条，另外两条仍会静默消失。
3. 打包后的 CSP 是 `img-src 'self' asset: data:`（`src-tauri/tauri.conf.json:21`）：外部 URL 的图片
   在成品里**必然**加载失败，而它今天给出的成因是「图片解码失败」——**错误的人话**。可渲染性由渲染
   引擎决定、前端判不出来（这正是本 change 不加格式白名单的理由），所以「引擎给不出可见像素」的
   失败面不止 svg 一种。

## What Changes

1. **svg 与位图经同一条内联渲染路径显示**，并把「渲染终态必须可见」写成硬要求：可渲染格式集合
   SHALL 继续以扩展名注册表为唯一事实源（`src/preview/attachments.ts:76-87`，本 change 不新增第二份
   表）；MUST NOT 出现「分类已收录、渲染结果为不可见」的形态。（delta：MODIFIED
   `attachment-display / 附件图片内联显示`）

2. **新增不变量：图片引用不可见时必须可见回退。** 对任意被 live preview 识别为图片引用的源码片段
   （三种形态：标准 `![alt](target)`、外部 URL、Obsidian `![[target]]`），只要替换区最终没有可见
   图像像素（读取失败 / 解码失败 / 格式不可渲染 / 解码成功但渲染尺寸为零），替换区 SHALL 呈现
   **可见**占位，占位 SHALL 含人话成因与**原始引用文本**（其中即含 alt 与路径）；替换区 MUST NOT
   出现零高度空白；加载中状态 SHALL 同样可见，MUST NOT 存在「有内容 → 空白 → 有内容」的空窗。
   （delta：ADDED `attachment-display / 图片引用的可见回退不变量`）

3. **SVG 的渲染安全性口径写进 spec**：SVG SHALL 只经 `<img>` 元素加载（`data:` URL），MUST NOT 用
   `innerHTML` / `insertAdjacentHTML` / `DOMParser` + 插入 DOM 等方式把 SVG 内联进文档；理由是
   `<img>` 上下文对应的处理模式**规范上关闭脚本执行、关闭外部资源解析**，而内联插入会让两者都打开。
   论证与引用见 [design.md](design.md) 第 4 节。（delta：ADDED
   `attachment-display / SVG 图片的渲染安全性`）

4. **失败文案收口 + deck 登记**：`图片解码失败：{引用}` 改为成因中立的 `图片无法显示：{引用}`——因为
   `img` 的 `error` 事件**不携带原因**，把 CSP 拦住的外部图片、无法解码的格式、渲染为空的图一律说成
   「解码失败」是错的（现场见 Why 第四节第 3 点）。三条图片态文案（加载中 / 读取失败 / 无法显示）
   今天都不在 deck 里，本 change 一并补登为 D111–D113（`文案-Copy.md`，末位为 D110）。

5. **既有的选区显露机制不动（见下方「须提请裁决的现状不符」）**：本 change MUST NOT 增删 live
   preview 的源码显露覆盖集——callout 行与内容行、标准链接、分隔线行、frontmatter 块、公式与
   mermaid widget 的显露口径逐条保持现状。

## 须提请裁决的现状不符：**图片行今天并不会「光标进入就显露源码」**

**裁决（2026-09-18，节点 1，Alex）：选项 A = 维持现状。** 本 change MUST NOT 增删图片行的选区
显露；「图片行是否与链接/分隔线同口径」单独立项留待将来（`docs/backlog.md` 第 19 条继续跟踪，
不核销）。本 change 对「看不到源码」的缓解就是可见占位本身——占位上写着路径与 alt。

briefing 的口径是「光标进入该行照常显露源码的既有行为不变」。对照代码，这条前提**在图片上不成立**，
不能按「不变」写进 spec，否则会留下一句与实现不符的条款：

- live preview 的显露判据是 `touchesSelection`（`src/preview/livePreview.ts:650-651`），今天只有
  六处调用它——frontmatter 块（`:419`）、callout 首行（`:762`）、引用续行标记（`:775`）、分隔线行
  （`:786`）、标准链接（`:821`）、callout 内容行（`:669-670`、`:719`、`:802`）。**`Image` 分支
  （`:807-815`）没有调用它**：整条引用被无条件替换，光标进入该行也不会显露源码。
- 全文没有 `atomicRanges`（`rg atomicRanges src/` 零命中），所以光标可以落进被替换的区间而不可见。
- living spec `editor-live-preview` 的「live preview 装饰层」逐项点名了显露覆盖集，**其中不含图片**。

两个选项，请 Alex 在评审节点 1 一并裁决（本 change 建议 A）：

| 选项 | 内容 | 代价 |
|---|---|---|
| **A（已采纳）** | 维持现状：本 change 不加图片行的显露，把「图片行是否与链接/分隔线同口径」单独立项 | 本 change 的改动面收在最窄；「看不到源码」由可见占位（含原始引用文本）缓解——占位上就写着路径与 alt |
| B（未采纳） | 并入本 change：`Image` 分支加选区判断，图片行照常显露源码 | 同一物理动作（点图片）会让图片消失、源码出现，是对**所有**图片的可见行为变更，超出 Alex 本次报告的诉求面；需同步改 `editor-live-preview` spec 的显露覆盖集枚举 |

现状已作为 finding 上报（可复核的证据就是本节的 `file:line`：`touchesSelection` 全文六处调用没有
一处落在图片分支）。**节点 1 裁决已落（2026-09-18，Alex：A = 维持现状）**：本 change 不动图片行的
显露口径，该项继续挂 `docs/backlog.md` 第 19 条跟踪到将来单独立项。

## Non-goals

- **不加 SVG 净化（sanitize）**：本 change 拒绝的是「内联插入 DOM」这条实现路径，不是「解析并改写
  SVG 内容」。经 `<img>` 加载时脚本与外部资源解析都被规范关闭，无需自建净化器（论证见 design 第 4
  节）；自建净化器会引入一份需要持续跟进的解析代码，收益为零。
- **不做图片缩放 / 尺寸规整 / 最大高度钳制**：`.cm-lp-image img` 保持 `maxWidth: 100%` 现状。
  大图撑高行高、超宽图的排版手感是既有边界，不在本次诉求内。
- **不做 SVG 的交互**：`<img>` 语义下 SVG 不可交互（规范如此），悬停提示、点击进源码、缩放都不做。
- **不做「图片行选区显露源码」**（除 Alex 选 B）。
- **不改路径解析口径**：`resolveImagePath`（vault 边界内的相对路径解析 + 逃逸回退 vault 根，
  `src/preview/attachments.ts:194-211`）与 `![[…]]` 的文件名唯一匹配一律不动；Rust 侧读取链路
  （`fs_read_attachment`）与 `..` / 绝对路径拒绝（`src-tauri/src/fs_io.rs:234-253`）一律不动。
- **不引入 asset protocol / custom protocol**：字节来源继续走 invoke + base64 的 `data:` URL
  （`src/preview/attachments.ts:171-182`、`src/main.ts:82-86`），与 living spec 的现行形态一致。
- **不改 SVG 的额外格式支持**：`avif` / `heic` 等是否被 WKWebView 解码不由本 change 保证——它们已
  在可渲染分类内，落进同一条兜底不变量即可。

## Impact

- 影响的 specs：`attachment-display`（MODIFIED ×2、ADDED ×2）。**不改** `editor-live-preview`
  （除非 Alex 选 B，则追加一条 MODIFIED 同步显露覆盖集）。
- 影响的代码/系统：`src/preview/attachments.ts`（`ImageWidget` 的终态判定与占位文案）、
  `src/preview/livePreview.ts`（仅在需要把 alt 与目标分别传给 widget 时调整构造入参）、
  `src/preview/theme.ts`（仅在需要给占位补一条最小可见高度时；预期复用既有
  `.cm-lp-image-error` 段，零新视觉语言）。`src-tauri/**` 零改动。
- 影响的文档：`文案-Copy.md`（新增 D111–D113，末位 D110 之后连续追加；文末「文案实现备注」段
  (`文案-Copy.md:105`) 登记归属文件）。
- 影响的测试/验收：`tests/visual/scenes/markdown-combo.spec.ts`（`:34` 的无区分度断言换成
  「成功渲染」与「不可见即占位」两侧都判）、`tests/visual/fixtures/markdown-combo/`（新增
  零尺寸「只声明 viewBox」的 svg 与位图、含 `<script>` 与外链的 svg 各一份）、
  `scripts/acceptance/scenarios/`（新增一个真机场景）。
- 关联约束：ADR 0003 §3（不改写源文件——本 change 全程只改装饰层，`EditorState.doc` 逐字节不变）、
  ADR 0002 §3（webview 不直接访问文件系统——继续走 invoke）、ADR 0002 §6（性能合同——不新增解析，
  SVG 仍只交给 `<img>` 解码）、ADR 0001（本地优先——SVG 经 `<img>` 不解析外部资源，与「不上网」一致）。
- 性能：无新增解析与测量。终态判定是加载后一次同步属性读取，不在键入路径上。
