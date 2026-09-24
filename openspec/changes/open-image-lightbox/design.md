# Design: open-image-lightbox

## 1. 现状锚点：双击内联图片今天会发生什么

### 1.1 事件语义：widget 内的事件 CM 默认不处理

图片引用在装饰层被整条 `Decoration.replace` 掉，替换物是 `ImageWidget`
（`src/preview/livePreview.ts:872-878` 的 `Image` 分支 → `buildStandardImage` `:929-948`；
方言形态走 `buildWikiEmbedWidget` `:1039-1058`；两处最终都是同一个 `ImageWidget`）。
`ImageWidget`（`src/preview/attachments.ts:254-325`）**不覆写 `ignoreEvent`**，而 CM 的默认值是
「忽略 widget 内的全部事件」（`@codemirror/view` 6.43.11 的 `eventBelongsToEditor`：事件从
`event.target` 往上走到 `contentDOM`，途中任一 widget 的 `ignoreEvent(event)` 返回真即判为
「不属于编辑器」）。仓内已有两处第一手记录写着同一件事：`src/preview/math.ts:172-189` 与
`src/preview/mermaid.ts:204-215`（「CM 对 widget 内事件默认 ignoreEvent、不放置光标」）。

两条推论，都是本 change 的地基：

1. 双击图片**今天不会移动光标**、不会触发 CM 的选词路径，也不会产生选区——因此「双击不得误触
   源码显露」这条要求在今天**天然成立**（图片行本就不在显露覆盖集内，见 1.2），本 change 的任务是
   **别把它弄坏**，而不是修它。
2. 想给 widget 加交互，得自己挂 DOM 监听——这不构成键位旁路（键位表管键盘，图片的双击是鼠标动作），
   与 `src/link-follow.ts` 的 ⌘-Click 同族（鼠标路径就地判定）。

**但 1 是机制推断，不是本轮实测读数。** 按 [REVIEW.md](../../../REVIEW.md) 第 7 条的纪律，
[tasks.md](tasks.md) 1.1 要求在动手前跑一次现状读数（双击后 caret 行号、`docText`、遮罩不存在、
无源码显露），把读数落进 `test-results/`；实现后同一读数必须逐值相同。

### 1.2 图片行不在选区显露覆盖集内（本 change 维持）

`touchesSelection` 的调用点里没有图片分支，M178 的节点 1 已把「维持现状、不加图片行的显露」裁决在案
（`docs/backlog.md` 第 19 条继续跟踪）。本 change 的 spec 里写的是「不加不减」——即：
双击（或单击）图片 MUST NOT 让源码出现，也 MUST NOT 顺手把图片行纳入显露覆盖集。

### 1.3 终态三分支与「哪里才有 `<img>`」

`ImageWidget.toDOM`（`src/preview/attachments.ts:272-324`）的终态只有三种可能：

| 终态 | DOM | 双击应做什么 |
|---|---|---|
| 加载中 | `.cm-lp-image-status` 状态块（`:278-282`） | 无操作（还没有 `<img>`） |
| 成功渲染出可见图像 | `<img>`（`:291-293` 建、`:311` 插入、`:307` 尺寸兜底） | 打开遮罩 |
| 读取失败 / 终态不可见 | `.cm-lp-image-error` 占位块（`:287` 的 `fallback`、`:319-321` 的读取失败） | 无操作（`replaceChildren` 已把 `<img>` 移除） |

`AttachmentNoticeWidget`（附件未找到 / 内容嵌入不支持 / 未接线，`src/preview/attachments.ts:335-355`）
同样是「没有 `<img>` 的 DOM」。

## 2. 为什么「占位不可点开」要写成结构性事实

三种占位与加载态的共同点是**没有 `<img>` 元素**。把双击监听器挂在**新建出来的那个 `<img>` 上**
（而不是挂在 widget 容器 `.cm-lp-image` 上），就得到一条不需要维护的不变量：

> 有 `<img>` ⇔ 双击可打开 ⇔ 终态可见。

反过来做（挂在容器上 + 用状态标志判断）会得到一条需要与三处分支同步的开关——任何一处分支漏改，
就会出现「占位也能点开一个空遮罩」或「图能显示但点不开」。同类教训见 [REVIEW.md](../../../REVIEW.md)
第 8 条（同语义两处真源）与第 9 条（声明了却没有消费者）。

副产物：加载中双击也无操作，这在语义上是对的（图还没出来，「看大图」无从谈起），
且 MUST NOT 为此给提示（一条「还在加载」的 toast 是噪音）。

## 3. 打开路径的接线（谁把 `src` 交给遮罩）

放大图的图像源**必须**是内联那张图已经加载好的源——`img.src`（`data:` URL 或外部 URL）。

- 不能按引用重新解析 + 重新读字节：那是第二次 `fs_read_attachment`（50MB 上限下等于再造一份 base64
  字符串），而且会让「放大图」与「内联图」可能来自不同快照（文件在两者之间被改动）。
- 不能把内联的 `<img>` 元素**搬**进遮罩：那个元素在 CM 的装饰 DOM 里，搬走会让编辑器的布局与
  装饰层状态脱节（widget 的 `toDOM` 产物归 CM 管）。

接线（与既有装配手法同形）：

| 环节 | 做法 | 既有先例 |
|---|---|---|
| `PreviewContext` 增一个可选口子 | 形如 `openLightbox(): ImageLightboxHandle \| null`——未接线时返回 `null`，widget 因此没有双击路径（与 `attachmentProvider()` 未接线时一律走占位同一口径） | `src/preview/livePreview.ts:53-60` 的 `PreviewContext`（`attachmentProvider()` / `wikilinkResolver()` 都是「可空口子 + 降级」） |
| 三处 `ImageWidget` 构造点把口子传下去 | `buildStandardImage`（`src/preview/livePreview.ts:929-948`，含外部 URL 分支）与 `buildWikiEmbedWidget`（`:1039-1058`） | 同文件既有写法 |
| 装配层注入 | `src/main.ts` 建 lightbox（挂点 `shell.root`、`restoreFocus: () => editor.view.focus()`）并把句柄交给 preview 上下文 | `editor.setAttachmentProvider(...)`（`src/main.ts:80-88`）、`createBindingsPanel({ mount, bindings, restoreFocus })`（`:467-471`） |
| 遮罩本体 | 新模块 `src/lightbox.ts`，与 `src/toc.ts`、`src/bindings-panel.ts` 同级同形（能力与 DOM 在自己模块、装配在 `main.ts`） | `src/toc.ts` / `src/bindings-panel.ts` |

`ImageWidget` 的构造签名因此多一个可选参数（双击回调）。它**不参与 `eq()`**（`src/preview/attachments.ts:266-270`）：
回调的差异不改变渲染结果，参与相等性只会让装饰无谓重建。

## 4. 遮罩本体：DOM、焦点与关闭路径

### 4.1 形态

- 根：`position: fixed; inset: 0` 的遮罩层（半透明底），复用键位面板的手法和 token
  （`src/style.css:370-381`：`z-index: 20` + `color-mix(in srgb, var(--text) 30%, transparent)`
  + 显式补回 `.lumir-lightbox-overlay[hidden] { display: none }`——author 的 `display` 会盖掉
  UA 的 `[hidden]` 规则，这一条在 `.lumir-bindings-overlay` 上已经踩过一次）。
- 内容：居中容器 + 一个 `<img>`。放大图的 `alt` = 原始引用文本（与内联图同一口径，
  `src/preview/attachments.ts:292`）：读屏可读，且给真机验收一个稳定的 AX 锚点。
- 语义：`role="dialog"` + `aria-modal="true"` + `tabIndex = -1` + 打开即 `focus()`
  （照 `src/bindings-panel.ts:70-77`）。

### 4.2 关闭路径四条（三条用户路径 + 一条焦点兜底）与两个必须写清的坑

| 路径 | 落点 | 注意 |
|---|---|---|
| `Esc` | 遮罩上就地消费（`keyToken` 归一化，照 `src/toc.ts:391-415` / `src/bindings-panel.ts:165-185`） | **不进统一键位表**：`Esc` 已被 `editor.widget-escape`（带 `when` 条件）占用，表的不变量是「一个 token 一条绑定」，同 token 第二条会被构造期拒绝（`src/keys.ts:43-52` 的 M148 段落逐字记着这条）。就地消费 + `preventDefault`，window 上的分发器对已消费事件让路 |
| 点击遮罩（图片以外的区域） | 遮罩上的 `mousedown`：`event.target === overlay` 时关闭 | **必须 `preventDefault()`**：不阻止默认行为，点击非可聚焦元素会让遮罩失焦 → `blur` 先把它关掉（见下一行），随后这次点击的关闭路径已经无事可做，`restoreFocus` 永远执行不到，焦点掉到 `<body>`——表现是「关掉了，但键盘没回到编辑器」。指示段与浮层条目都用 `mousedown` + `preventDefault` 保持焦点（`src/toc.ts:227`、`:321`），这里同一手法 |
| 在遮罩内再次双击图片 | 放大图上的 `dblclick` | 同上：放大图的 `mousedown` 也 `preventDefault`，否则双击的第一下就把遮罩的焦点抖掉了 |
| 焦点离开遮罩 | 遮罩 `blur` → 关闭，**且不抢焦点**（`close(false)`） | 照 `src/toc.ts:231-232` 的 `blur → close(false)` 口径。它同时兜住两件事：① 在遮罩之上另开面板（`⌘/`、`⌘F`、`⌘⇧O`、`⌘O`、`⌃⇥` 这类 **global** 作用域命令在模态层上照常生效，与键位面板同一现状）——新面板抢走焦点，遮罩自行退场，不会留下「背景里还开着一个模态层、焦点却在编辑器」的第三种状态；② 窗口失活。不抢焦点是因为焦点本来就去了别处，拽回来是无礼的（`src/toc.ts:358-368` 的注释逐字写着这条理由） |

`close(restoreFocus = true)` 的单入口形态照抄 `src/toc.ts:363-368`：`Esc` 与遮罩点击走
`close(true)`（交还编辑器）；`blur` 走 `close(false)`。三条用户路径都回到同一个 `close`，
避免「三条路径三种收尾」的漂移。

### 4.3 模态层的两条保证

- **编辑键不穿透**：遮罩持有焦点（`editor` 作用域的绑定要求事件目标在 `contentDOM` 内，
  `src/main.ts:429-436` 的 `isEditorEvent`），所以 `⌃D` / `⌃K` / `⌃A` 等在遮罩打开期间不命中；
  `Tab` / `⇧Tab` 在遮罩上 `preventDefault` 挡住（照 `src/bindings-panel.ts:171-174`）——
  否则焦点会走进编辑器内容区，穿透保证当场失效。
- **关闭后归还**：`view.focus()`。注意 `view.focus()` 不改选区（CM 只是把焦点交回并同步 DOM 选区），
  因此「打开与关闭都不动选区」这条与它不冲突——这条要有断言，不能只靠机制推断
  （[tasks.md](tasks.md) 5.3）。

### 4.4 双击要 `preventDefault`，但**不**把光标送进源码

M111 / M112 给公式与 mermaid 的处理是：`mousedown` 里先 `preventDefault`，再把光标送进 span 内
触发源码显露（`src/preview/math.ts:172-189` 的 `enterReplacedSource`）。理由是那两个 widget
「点击即编辑」是用户预期。**本 change 故意不跟这条**：看大图是查看动作，图片行又没有显露口径
（1.2），往被替换的区间里塞一个不可见的光标只会让人以为点坏了。

但 `preventDefault` 这一步要跟：M112 记录的机制是「原生 caret / 选区若滞留在被替换的 widget 节点上，
异步重建后 CM 读取时会把它映射为 0（落点跳到文档起点）」。图片也会重建（预览刷新、加载 settle、
尺寸兜底改样式都可能重建装饰），所以双击要阻止默认行为，把原生选区这条路径掐断。
**这条的判据是「打开/关闭前后 caret 与选区逐值不变」，不是「有没有调用某个 API」**——
[tasks.md](tasks.md) 1.1 的现状读数就是它的基线。

## 5. 缩放口径的取点（推荐项：适配遮罩且不放大）

CSS 判据（推荐项）：

- 放大图不加 `width` / `height`，因此浏览器的默认行为就是**按自然尺寸渲染**——「小图不放大」由
  「不设宽度」天然成立，不需要一条 `max-width: 100%` 之外的规则，也 MUST NOT 写
  `width: 100%`（那会把小图拉大、失真）。
- 「不越出遮罩」由 `max-width: 100%` + `max-height: 100%` 给出，配合 `min-width: 0 / min-height: 0`
  的 flex 父项（否则 flex 子项的内容尺寸会顶开容器）。遮罩的可用区域要减掉内边距。
- 组件口径：`object-fit: contain` 在本形态下不是必需的（我们不设固定宽高），MUST NOT 借它引入
  「框比图大」的观感。

两条断言（[tasks.md](tasks.md) 5.6）：大图的渲染盒宽高都 ≤ 遮罩可用区域；小图的渲染盒 ≤ 自然尺寸。

**反向验证（实现期实测修正，2026-09-19）**：本节原先写的是「把 `max-height` 去掉跑一次，大图断言
必须红」。实测发现这条配方**没有区分度**——`wide.svg`（2000×600）在 1120×920 的可用区域里是被
**宽度**夹住的（2000 → 1120，高度只有 336），去掉 `max-height` 之后它照样在界内、断言照绿。因此
反向验证的样本必须是**高图**（600×2000）：去掉 `max-height` 后它按自然高度 2000px 溢出可用高度
921px，断言当场红。实现里的断言组因此同时放宽图与高图两腿（`tests/visual/scenes/markdown-combo.spec.ts`
的 M184 放大口径组），红输出留档 `test-results/m184/05-red-no-max-height-tall.log`。

同批实测的另外两条（留档 `test-results/m184/06`、`07`）：单独去掉 `max-width: 100%`、或单独去掉
`min-width/min-height: 0`，断言都仍绿——本布局下宽度一侧由 flex 的自动收缩与 `max-*` 各自足够。
四条声明因此都留着（互为第二道），但**唯一被实测证伪会红的是 `max-height`**，它是那条断言的
区分度来源；[tasks.md](tasks.md) 5.6 的验收口径按此改写。

## 6. SVG / 位图同构与安全边界

- 放大图与内联图**同一个源字符串**、同一个 `<img>` 语义 → 载入上下文完全相同，
  M178 的「SVG 图片的渲染安全性」条款（`openspec/specs/attachment-display/spec.md`）自动覆盖放大层，
  不需要为「放大后的 svg」另立一套口径。**这就是本 change 不加净化器、不开内联路径的理由**：
  经 `<img>` 时脚本执行与外部资源解析都被规范关闭（M178 design §4 的论证），而内联插入会打开该路径。
- svg 与位图的打开路径、呈现口径、关闭路径、焦点行为**完全同形**：实现上只有一处 `dblclick` 挂载点，
  不存在 `extensionOf(path) === "svg"` 这类分支的空间（M178 已把「不为 svg 单立分支」写成条款）。
- 外部 `http(s)` 图片：成品 CSP 是 `img-src 'self' asset: data:`（`src-tauri/tauri.conf.json:21`），
  这类引用在成品里必然加载失败 → 落到可见占位 → **没有 `<img>` → 不可打开**（第 2 节的结构性保证）。
  开发态（chromium 场景桩）里它能渲染时，放大路径与本地图片完全同形——不需要为「外链」添任何特例。
  这是可断言的正观测（[tasks.md](tasks.md) 5.4 的同一份文档里既有能打开也有打不开的引用）。

## 7. 与既有交互的边界（逐条核对，防误伤）

| 交互 | 关系 | 依据 |
|---|---|---|
| 图片行选区显露源码 | **不变**：本 change 不加不减 | `touchesSelection` 的调用点不含图片分支；M178 节点 1 裁决 A；`docs/backlog.md` 第 19 条 |
| 表格 cell 双击（选词） | **不重叠**：图片 widget 与表格 widget 是两类替换物，表格 cell 里没有图片引用 | `src/preview/livePreview.ts:370-371`（表格 cell 双击的对齐填充空白处理属表格 capability） |
| `⌘-Click` 链接跟随 | **不重叠**：图片引用不是链接节点（`Image` 与 `Link` 是语法树上两个不同分支） | `src/preview/livePreview.ts` 的 `Image` / `Link` 两个 case |
| 键位面板 / 搜索 panel / 大纲浮层 / vault 切换器 | **不新建互斥机制**：遮罩靠 `blur → close(false)` 自行退场（global 命令在模态层上照常生效是既有现状，键位面板同款）；MUST NOT 引入「overlay 注册表」这类新机制 | `src/toc.ts:231-232`；`src/bindings-panel.ts:70-77` |
| `Esc` 的归属 | 遮罩就地消费；关闭后 `Esc` 回到 `editor.widget-escape`（带 `when`）的既有归属 | `src/keys.ts:43-52` |
| 只读 code 模式（非 md 打开的文件） | 无关：图片内联渲染只发生在 md 模式的装饰层 | `openspec/specs/editor-live-preview/spec.md` 的「单内核双模式落地」 |

## 8. 性能与内存

- **不新增读取**：放大图复用 `img.src`，打开遮罩不触发 `fs_read_attachment`（可外部观测的判据：
  调用计数不变，[tasks.md](tasks.md) 5.5 / 6.x 有对应断言）。
- **惰性建 DOM**：遮罩节点首次打开时才建（照 `src/toc.ts:208-222` 构造函数建 DOM 的做法，
  但 lightbox 连构建都可以推迟到首次打开——它没有「状态需要提前对齐」的需求）。
  打开路径（打开 1MB Markdown < 100ms，ADR 0002 §6）上因此零新增工作。
- **decode 复用：实现期实测（chromium，2026-09-19）**。同一 `data:` URL 的第二次使用**确实命中浏览器的
  已解码位图**，且复用是按 **URL 字符串**键控的，不是按像素内容：
  - 隔离实验（2600×1800 的 6.1MB PNG data URL）：首次 `decode()` **48.9ms**；同一串再 `decode()` 一次
    **0.1ms**；**像素相同但串不同**的第三张 **49.3ms**（对照）。相差两个数量级，足以区分「复用」与
    「重新解码」。
  - 真实路径（1.85MB 的 svg data URL 走遮罩）：首次打开 `dispatch 0.5ms / 布局完成 0.5ms`，关闭后再
    打开 `0.2ms / 0.2ms`。
  - **失败读数如实记录**：`performance.memory.usedJSHeapSize` 在三组读数里逐次相同（33.1MB 不变），
    这个量度在本形态下**读不出位图占用**（Chromium 的粗粒度上报）——所以本 change 不给内存结论，
    只说「复用成立」。
  - **限 chromium**：WKWebView 未测（真机层驱动不了双击，见 [tasks.md](tasks.md) 6.1 的通道边界记录），
    因此这条复用的适用范围按 chromium 记；50MB 上限下的大图表现仍按 fs-io 的既有边界对待。
  读数落 `test-results/m184/10-decode-probe.json`（本机，git 外）。
- **不在键入路径上**：双击是用户主动动作；打开/关闭只做一次 DOM 创建与一次 `src` 赋值。

## 9. 备选方案与拒绝理由

| 方案 | 拒绝理由 |
|---|---|
| 双击打开系统预览 / 新标签页（裁决点 1 备选①） | 一次看图变成跨应用/跨窗口动作，退出后回不到原滚动位置与上下文；与 ADR 0001 的单窗口工作台与既有浮层惯用语不一致。若 Alex 要，属另一个 change |
| 就地放大文档里的那张内联图（不走遮罩） | 会推动文档几何（正文被挤走），与「浮层零常驻占地」的既有口径冲突，且把「看图」和「编辑」混在同一层；还要回答「放大后光标/fold 状态怎么办」 |
| 挂在 widget 容器上 + 状态标志判断可不可点 | 引入第二处真源（终态判定已有三处分支），漏一处就出「占位能点开」或「图能显示却点不开」（REVIEW.md 第 8、9 条） |
| 按引用重新解析并再读一次字节给放大图 | 多一次 50MB 级读取与一份 base64 字符串；且与内联图可能来自不同快照。契约层面「字节来源为 fs-io 二进制附件读取」的单一通道被绕过（M178 的 1.2 节已记录现行通道） |
| 把内联的 `<img>` 元素搬进遮罩 | 该元素属于 CM 装饰层的 DOM，搬走即破坏编辑器布局与装饰状态；关闭时还要搬回来 |
| 为放大图内联 SVG（`innerHTML` / 解析后插入） | 打开脚本执行与外部资源解析，还会让放大层与内联层有两套载入上下文（M178 的安全条款理由，design §4） |
| 把 `Esc` 写进 `KEY_BINDINGS` | 表的不变量是「一个 token 一条绑定」，`Esc` 已被 `editor.widget-escape` 占用，同 token 第二条绑定会被构造器直接拒绝；浮层/面板的就地消费是既有自洽形态（`src/keys.ts:43-52`） |
| 同时提供命令 + 默认键（裁决点 3 备选②） | 需要另找空位组合并核对三条独立来源的冲突；且「光标处图片」的定位要新增一条与装饰层并行的判定。列进裁决点表交 Alex 决定，本 change 默认不做 |

## 10. 风险与未决点

| 项 | 状态 | 处置 |
|---|---|---|
| 「双击今天不移动光标/不显露源码」的实测读数 | 机制已由 CM 源码与仓内两处注释佐证，**本轮未实测** | [tasks.md](tasks.md) 1.1：动手前取一次现状读数落 `test-results/`；实现后逐值相同 |
| 遮罩失焦即关（`blur → close(false)`）在「另开面板」时的观感 | 设计选择（照 toc 口径），**未真机验证** | 真机场景按 4.2 的表逐条走一遍；观感（是否觉得「怎么自己关了」）归 Alex 手感，套件只留截图 |
| 同一 `data:` URL 的第二次 decode 是否复用位图 | **无依据** | 实现期实测记录（§8）；不押在它上面 |
| 大图（50MB 级）放大时的内存与首帧 | 既有边界（上限属 fs-io），未测 | 实测一次并把读数写进 PR；异常则如实记为已知边界，另立 finding |
| 遮罩与 toast / 其他浮层的层级顺序 | 遮罩取 `z-index: 20`（与键位面板同层），既有浮层是 15、toast 是 10 | 视觉场景核对一次遮罩确实压住编辑器与左栏；若发现被压住的是遮罩，按既有层级数值调整并在 PR 说明 |
| 数字文档（十分小的图，如 16×16 图标）双击的观感 | 不放大即「和没放一样大」 | 推荐项的已知代价（proposal 裁决点 2 的一句话取舍里写明）；若 Alex 选 100% 或切换口径，delta 与 tasks 同步改 |

## 11. 验收面（与 tasks.md 对应）

- **合同层**：`attachment-display` 增量的两条（ADDED ×2）逐条落到 scenario。
- **视觉层（chromium，CI）**：`tests/visual/scenes/markdown-combo.spec.ts` 新增断言组——打开与三条
  关闭路径、占位/加载态不可打开（**正观测同场景内证明**）、焦点与不穿透、doc/caret 逐值不变、
  svg 与位图同构、缩放口径两侧；反向验证（先红）与「去掉 `max-height` 后必红」各留档。
- **真机层（WKWebView，`scripts/acceptance/`）**：新增场景（编号 23）断言放大图 **AXImage 几何非零**
  （不可见图的 AX 文本照样读得到——这条陷阱记在 `docs/backlog.md:257-264`（M178 finding，主要居所）与
  `openspec/changes/archive/2026-09-18-image-svg-and-fallback/tasks.md:190-192`，
  判据取几何）、`Esc` 关闭后焦点回编辑器、`editor.unchangedSince` 与磁盘 `unchangedSince`。
  **实现期实测：这一层被通道能力挡住（2026-09-19）**。场景与 fixture 写好后跑了两轮真机，双击路径全部
  落空；随后用四条注入通道做对照实验，结论是套件在 WKWebView 里**造不出 DOM 的 `dblclick`**（判据取
  既有行为「双击文件树行 = 新建固定标签」，四条通道下标签数都停在 1，而同一点位的单次点击证明落点
  准确）。因此真机场景**未落库**（只验前置条件的场景会让人误读为「真机验过」），边界写进
  `scripts/acceptance/README.md` 的「已知边界」，收口方式已请 tower 裁决——逐条记录见
  [tasks.md](tasks.md) 第 6 节与 8.3。**本 change 的真机覆盖因此是缺的，不是「已验」**；打开与关闭路径的
  行为覆盖暂落在 chromium 层（那里是真实 dblclick）。
  **归档期订正（M208 / M209，2026-09-25）**：上面这条「套件在 WKWebView 里造不出 `dblclick`」的结论
  **已作废**——M209 实测第五条通道（`/usr/bin/swift` + `CGEvent` 显式投递 `kCGMouseEventClickState`）
  能造出真实 `dblclick`，并已接进套件（`scripts/acceptance/lib/cgevent-click.swift` + `doubleClick` 动作）；
  M184 用的那条判据本身也不成立（`openFile` 对已打开的同路径短路，「双击文件树行 → 标签数 1→2」恒不成立）。
  真机场景最终以**编号 33** 落库（`scripts/acceptance/scenarios/33-image-lightbox.md`；2026-09-24 真机
  PASS 36 断言 + 反向验证 FAIL 7 红），本 change 的真机覆盖**不再是缺的**；原稿的 23 / 24 已分别被
  `23-image-first-open-width` 与 `24-table-cell-ctrl-e-seq` 占用。人工清单继续承接手感层。
- **不改写源文件**：视觉与真机两层都断言 `EditorState.doc` / 磁盘文件逐字节不变（ADR 0003 §3）。
- **基线**：lightbox 是新元素，按 [REVIEW.md](../../../REVIEW.md) 第 3 条与 `tests/visual/README.md`
  的纪律核对——现有场景里出现图片的只有 `markdown-combo`（该场景无 `toHaveScreenshot`），
  实现期逐张核对相册式基线并如实写明「零更新」或列出新增/重拍的基线名 + 截图先请 Alex 过目。
