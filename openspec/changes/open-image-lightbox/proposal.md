# Proposal: 图片双击放大查看（应用内 lightbox 遮罩）

- Change ID: open-image-lightbox
- 日期: 2026-09-18
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 需求原话（2026-09-18）：**「双击图片能看大图」**。

### 一、诉求面在哪：内联图片「能显示」不等于「看得清」

图片内联渲染刚刚被 M178 修好（`attachment-svg-and-fallback` 已归档）：三种引用形态今天都能画出来，
不可见的形态有可见占位。但内联的尺寸口径是**按阅读栏宽收窄**——`.cm-lp-image img { max-width: 100% }`
（`src/preview/theme.ts:211`），而阅读栏宽是固定的正文栏。M178 的实测矩阵里，2000×600 的图在 600px
容器下渲染为 600×180（收窄口径本身正常工作，代价是大图只剩缩略版）——截图、图表、设计稿这类
「信息在细节里」的图片，在文档里因此只能看到缩略版，**放大查看**是它的直接补位，
且不需要动内联渲染的任何口径（本 change 一个字都不改）。

### 二、四个必须写清的设计点，以及它们在代码里的现状

| # | 设计点 | 现状锚点（可复核） |
|---|---|---|
| 1 | 双击落在 replace widget 上，不得误触源码显露 | 图片分支把整条引用换成 widget（`src/preview/livePreview.ts:872-878` 的 `Image` 分支 → `buildStandardImage` `:929-948` / `buildWikiEmbedWidget` `:1039-1058`）。`ImageWidget` **不覆写** `ignoreEvent`（`src/preview/attachments.ts:254-325`）——全仓只有公式与 mermaid 两处专门处理这件事（`src/preview/math.ts:172-189`、`src/preview/mermaid.ts:204-215`，两处注释写明「CM 对 widget 内事件默认 ignoreEvent、不放置光标」）。CM 的事件归属判定对 widget 返回 false（`@codemirror/view` 6.43.11 的 `eventBelongsToEditor`），所以**双击今天不会移动光标、不会触发选词**。图片行又不在选区显露覆盖集内（M178 节点 1 裁决 A，`docs/backlog.md` 第 19 条），因此也**不会显露源码**。本 change 必须把这两条一起维持（实现前先按 [tasks.md](tasks.md) 1.1 取一次现状读数，再动手） |
| 2 | 键盘可达性：焦点管理 + `Esc` 关闭后归还编辑器 | 既有同形实现是键位查看面板（M133）：`role="dialog"` + `aria-modal` + `tabIndex=-1` + 打开即 `focus()` + `Tab` 留驻 + 关闭键就地消费 + `restoreFocus()`（`src/bindings-panel.ts:70-77`、`:148-185`），关闭后由装配层交还编辑器（`src/main.ts:467-471` 的 `restoreFocus: () => editor.view.focus()`）。就地键匹配复用 `keyToken`，不另写一套口径 |
| 3 | 大图缩放口径 | 内联口径是 `maxWidth: 100%` + `borderRadius`（`src/preview/theme.ts:211`），没有任何放大/缩放交互。裁决点见下 |
| 4 | SVG 与位图同构 | M178 已把「svg 与位图走同一条渲染路径、不为 svg 单立分支」写成 living spec 条款（`openspec/specs/attachment-display/spec.md` 的「附件图片内联显示」），并把「SVG 只经 `<img>`」写成安全条款（同 spec 的「SVG 图片的渲染安全性」）。放大查看必须落在同一条路径上，否则同一张图会有两套载入上下文 |

另外两条在需求原话之外、但决定实现能不能站住：

- **占位不可点开**。三类失败形态（加载中 / 读取失败 / 终态不可见）今天都是「没有 `<img>` 的 DOM」
  （`src/preview/attachments.ts:278-282` 的状态块、`:287` 与 `:319-321` 的两处 `errorChip`）。
  把双击只挂在**终态渲染出的 `<img>` 上**，「占位不可点开」就是结构性事实而非一条需要维护的分支。
- **大图 decode 时机**。附件字节经 `fs_read_attachment` 以 base64 进来（`src/main.ts:80-88`），
  上限 50MB（`src-tauri/src/fs_io.rs:30` 的 `ATTACHMENT_MAX_BYTES`）。放大图**必须复用内联那张图已经加载好的同一个源**，
  不能再读一次字节——否则一次双击就多一份「读盘 + base64 字符串 + 解码位图」的开销，
  与 ADR 0002 §6 的常驻内存口径直接冲突。

## What Changes

1. **双击内联图片打开应用内遮罩（lightbox），图片居中放大显示**。双击只挂在该引用终态渲染出的
   `<img>` 元素上；遮罩覆盖窗口内容区、定位在文档流之外（展开/关闭不动文档几何）；缩放口径为
   **适配遮罩且不放大**（见裁决点 2 的默认项）。（delta：ADDED `attachment-display / 图片双击放大查看`）

2. **三条关闭路径回到同一实现**：`Esc`、点击遮罩、在遮罩内再次双击图片。遮罩是模态层——打开即持有
   焦点，持有期间 `editor` 作用域的键不穿透文档、`Tab` 留在遮罩内；关闭后焦点交还编辑器；
   焦点离开遮罩（上面又开了面板 / 窗口失活）时遮罩自行关闭且不抢焦点。同一 delta requirement 覆盖。

3. **放大图只经 `<img>`、复用同一图像源、不新增字节通道**：放大图取内联图片的同一 `data:` / URL 源，
   MUST NOT 二次调用 `fs_read_attachment`，MUST NOT 把 SVG 内容内联进 DOM（沿用 M178 的安全条款口径），
   svg 与位图同构、无扩展名分支。遮罩 DOM 惰性建立，打开/关闭不在文档打开路径与键入路径上新增工作。
   （delta：ADDED `attachment-display / 放大查看的字节来源与性能边界`）

4. **打开与关闭都不碰文档**：`EditorState.doc` 与磁盘文件逐字节不变（ADR 0003 §3），选区与光标落点
   不变，图片行的显露口径不加不减（M178 节点 1 裁决 A 不变）。双击要阻止事件默认行为，防止原生
   caret / 选区滞留进被替换的 widget DOM（那是公式 / mermaid 已记录过的落点跳变机制，
   `src/preview/math.ts:172-189`），但**不把光标送进源码区间**——与 M111 / M112「点击进源码编辑」
   的口径相反，理由见 [design.md](design.md) 第 4.4 节。

5. **本 change 不改内联渲染的任何口径**：`.cm-lp-image` 的 `max-width: 100%` 保持现状（M178 的非目标
   ——「不做图片缩放 / 尺寸规整」——继续有效）；路径解析、CSP、字节通道、Rust 侧一律不动。

## 须提请 Alex 节点 1 裁决的选项

四项都给了推荐项（推荐项的形态**已经按默认写进 delta**）；若裁决改成备选，delta 与 tasks 按下面表格的
「备选」列改写，不静默扩 scope。

| # | 裁决点 | 推荐（已写进 delta） | 备选 | 一句话取舍 |
|---|---|---|---|---|
| 1 | 放大形态 | 应用内全屏遮罩 + 图片居中（复键位面板的遮罩手法与模态语义） | ① 不做遮罩：新标签页 / 交给系统预览（Quick Look）；② 就地放大：不动遮罩，把文档里那张内联图放大 | 推荐项保持「编辑器内聚」，与既有浮层惯用语一致；①把一次看图变成跨窗口/跨应用的动作，且退出后回不到原来的滚动位置；②会推动文档几何（内联图一放大就把正文挤走），与「浮层零常驻占地」的既有口径冲突 |
| 2 | 缩放口径 | 适配遮罩且不放大（大图完整可见、小图按原尺寸） | ① 原尺寸 100%（超出时遮罩内滚动）；② 适配 + 单击在「适配 ↔ 100%」间切换 | 推荐项一行 CSS 且不需要第二套滚动手势，任何尺寸的图都「一眼看全」；①能看到像素级细节但大图要靠滚动/拖动查看；②两种都能拿到，代价是占掉单击手势、多一个要靠提示才能发现的状态，并与「双击关闭」挤在同一手势族里 |
| 3 | 是否绑命令 / 键位 | 不加命令、不绑键：双击是唯一打开路径；键盘路径只覆盖关闭与焦点归还 | ① 加命令 `image.open-lightbox`（默认不绑键，登记进 `KEYLESS_COMMAND_IDS`，用户可经 `[keys]` 绑定——M180 折行开关的先例）；② 命令 + 默认绑键（需另选一个空位组合并核对冲突） | 推荐项把 delta 收在一个 capability（0 处 keymap-commands 改动）、也不新增「光标处图片」的定位口径；①给键盘用户一条可用路径（`[keys]` 绑定后生效），代价是新增一个命令 id + 「光标处是图片」这条与装饰层并行的定位逻辑；②不配置也能用，代价是永久占掉一个物理组合 |
| 4 | 关闭手势与提示 | 保留「遮罩内双击图片关闭」，不加可见提示文案 | ① 加一条提示（`Esc` / 点击遮罩）——需 deck 追加 D114 + 备注段登记；② 去掉双击关闭（只留 `Esc` 与点击遮罩），把双击手势留给将来的缩放切换 | 推荐项零新文案、零新视觉面；①与 `toc-outline` 的「就地键要有可见出口」义务更一致（那条义务的语境是浮层里就地消费了 `↑↓`/`⌃N`/`⌃P` 这类在别处另有语义的键，而这里的就地键只有 `Esc`——macOS 通行的「关掉当前层」约定，且另两条关闭路径是鼠标动作）；②避免「双击＝关闭」与将来「单击＝切缩放」在同一手势族里互相牵扯 |

## Non-goals

- **不做新标签页 / 系统预览**（裁决点 1 的备选①）：本 change 不调用任何外部程序、不新增窗口，
  与 ADR 0001（本地优先、单窗口工作台）一致。
- **不做缩放控件、手势缩放、拖拽平移、旋转、另存为**：裁决点 2 的推荐项下这些都没有立足点
  （图必然完整可见）；要 100% 像素级查看时再单独提 change。
- **不做文档内多图导航**（上一张 / 下一张、缩略图条）：需求原话只到「看大图」；
  导航会引入「当前在第几张」这份跨文档状态，是另一个形态。
- **不改内联图片的排版口径**：不做尺寸规整、不做最大高度钳制、不动 `max-width: 100%`
  （M178 非目标继续有效）。
- **不做图片行的选区显露源码**：M178 节点 1 裁决 A（维持现状）不变，`docs/backlog.md` 第 19 条继续跟踪。
- **不引入任何新视觉语言**：遮罩、配色、字体、圆角一律取既有 token 与既有遮罩手法
  （`src/style.css:370-381` 的键位面板遮罩段）。
- **不改字节通道与安全策略**：`fs_read_attachment`、`data:` URL 形态、CSP
  （`src-tauri/tauri.conf.json:21`）、`resolveImagePath`、路径防护一律不动（ADR 0002 §3 不变）。
- **不把 SVG 内联进 DOM**：放大图与内联图同一载入上下文（`<img>`），MUST NOT 为「放大后更清晰」
  之类似是而非的理由打开内联路径（M178 的安全条款理由见 `attachment-svg-and-fallback` 的 design §4）。

## capability 归属：为什么是 `attachment-display` 的 ADDED，而不是新 capability

**结论**：两条新增 requirement 都落 `attachment-display`（既有 living spec，
`openspec/specs/attachment-display/spec.md`），本 change **不新建 capability**。

理由逐条对照那份 living spec 的现有条款：

| 本 change 的条款 | 与既有条款的关系 |
|---|---|
| 双击只挂在**终态渲染出的 `<img>`** 上 → 占位 / 加载态没有打开路径 | 是「图片引用的可见回退不变量」与「附件图片内联显示」（终态 SHALL 可见）的**同一枚硬币的反面**：不可见就没有打开路径，可见才可放大。两条互为补集，拆开就会各自漂移 |
| 放大图只经 `<img>`（含 `data:` URL），MUST NOT 内联图像内容 | 「SVG 图片的渲染安全性」的**同一条载入上下文**。放大层与内联层若落在两个 capability，这条不变量要么写两遍、要么互相引用才能读全 |
| 放大图复用内联已加载的同一源、MUST NOT 二次读字节 | 「附件图片内联显示」里「字节来源 SHALL 为 fs-io 二进制附件读取」这条单一通道的延伸——放大会成为**第二条**读路径，正是那条条款要防的形态 |
| svg 与位图同构、无扩展名分支 | 「附件图片内联显示」已写死「svg SHALL 与位图走同一条渲染路径，MUST NOT 为 svg 单立分支」 |

**反方（如实记录）**：lightbox 在交互形态上更接近 `toc-outline`——那是一个独立的 living spec，装着
「窗口级浮层 + 就地键 + 焦点管理」这类自成体系的东西。如果本 change 同时要长出命令族、文档内多图
导航、缩放控制，按那种体量单立一个 `image-viewer` 会更顺；但本 change 的形态只是「同一张图的另一种
呈现面」——同一个 widget、同一个图像源、同一套终态判据、同一套安全口径，所以归属不动。
将来真长出上述自成体系的交互面时再拆，拆分成本那时才值得付（同语义两处真源是
[REVIEW.md](../../../REVIEW.md) 第 8 条点名的形态，现在拆反而制造它）。

**边界说明**：若裁决点 3 选备选（加命令 / 绑键），delta 会追加 `keymap-commands` 的 MODIFIED ×1——
那是**命令与键位归属**的口径（该 living spec 逐条登记命令 id、作用域与默认绑键），
lightbox 本体的条款仍留在 `attachment-display`，capability 归属判断不变。
另外：能力归属说的是 **spec 归属**，不是代码位置——遮罩本体按 `toc-outline` / 键位面板的既有分工
落在独立模块 `src/lightbox.ts`（模块边界与 capability 边界本来就不一一对应）。

## Impact

- 影响的 specs：`attachment-display`（ADDED ×2）。**不改** `editor-live-preview`（图片行的显露口径不变，
  装饰层不新增规则与视口义务）。若裁决点 3 选备选①或②，追加 `keymap-commands` 的 MODIFIED ×1
  （命令 id、作用域、默认绑键与「默认不绑键清单」的登记）。
- 影响的代码/系统：新增 `src/lightbox.ts`（遮罩本体：DOM、打开/关闭、焦点、就地 `Esc`）——
  与 `src/toc.ts`、`src/bindings-panel.ts` 同级同形；`src/preview/attachments.ts`（`ImageWidget`
  在终态渲染出的 `<img>` 上接双击，实现 source 复用与「占位无入口」的结构性保证）；
  `src/preview/livePreview.ts`（`PreviewContext` 增一个可选口子，三处 `ImageWidget` 构造点传参）；
  `src/main.ts`（装配：挂点、`restoreFocus`、把 lightbox 句柄注入 preview 上下文——与
  `editor.setAttachmentProvider` / `createBindingsPanel` 同一手法）；`src/style.css`（新增遮罩段）。
  `src-tauri/**` 零改动。
- 影响的文档：`文案-Copy.md` **仅当裁决点 4 选备选①**（追加 D114 与备注段登记；末位当前为 D113）。
- 影响的测试/验收：`tests/visual/scenes/markdown-combo.spec.ts`（新增 lightbox 断言组；该场景已有
  `images.md` 的十条引用与附件读桩 `stubAttachmentReads`，是现成的输入面）+
  `tests/visual/fixtures/markdown-combo/`（按需补一份小于窗口的位图）；`scripts/acceptance/scenarios/`
  新增一个真机场景（编号 23）+ 复用既有 `scripts/acceptance/fixtures/image-fallback-*.svg`。
  基线按 [REVIEW.md](../../../REVIEW.md) 第 3 条的纪律逐张核对是否需要新增元素级基线
  （lightbox 是新元素，按 `tests/visual/README.md` 的基线更新纪律：截图先请 Alex 过目）。
- 关联约束：ADR 0003 §3（不改写源文件——打开/关闭都不碰文档）、ADR 0002 §3（webview 不直接访问
  文件系统——放大图不新增读取路径）、ADR 0002 §6（性能合同——可见回退/尺寸兜底那批新增的判定不在
  键入路径上，本 change 同样不新增解析与测量）、ADR 0006（Emacs keybinding PKM 定位——本次的边界是
  「打开路径只有鼠标」，已如实写进 spec 的已知边界与裁决点 3）、ADR 0004 第 5 条（功能变更走 OpenSpec）。
  另核对：ADR 0001 §4 的「非 modal」指**键位形态**不做 vim 式模式编辑，不是「不许有模态浮层」——
  键位面板（M133）已是同一形态的先例，本 change 不引入模式。
- 性能：打开/关闭 O(1)（一次 DOM 创建与一次 src 赋值），不在键入路径上；遮罩 DOM 惰性建立；
  不新增字节读取。同一 `data:` URL 的第二次 decode 是否复用浏览器的已解码位图**未验证**，
  按 [tasks.md](tasks.md) 的实现期实测项记录读数（50MB 上限下的大图是本项的主要观察对象）。
