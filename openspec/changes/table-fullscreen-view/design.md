# Design: table-fullscreen-view

形态总览（推荐项）：caret 在已渲染为 grid 的表内（或表格滚动容器持焦）时执行
`table.toggle-fullscreen`，打开应用内全屏遮罩，内容 = 该表打开那一刻渲染态 grid 的**只读快照副本**；
关闭语义与 M184 image lightbox 逐条同款。本文件给出现状锚点、快照机制取舍、tokens/三主题、
性能边界与被否决方案。所有锚点按 master tip `5841002` 核对。

## 1. 现状锚点：表格今天是什么

### 1.1 渲染机制：BlockWrapper + line/mark 装饰，cell 是活源码位置

- 表格发现：`findTables`（`src/preview/table.ts:98-139`）从语法树的 `Table` 节点恢复行/槽位/对齐，
  产出 `TableModel`；按 `EditorState` + 视口范围缓存（`src/preview/livePreview.ts:189-222` 的
  `tableMetadataCache`）。
- 发现范围**视口有界**：`tableDiscoveryRange` = 视口 ± max(首行长×2, 2048)
  （`src/preview/livePreview.ts:224-230`）；MUST NOT 全文档扫描（`docs/specs/table-reading.md` §6
  明确拒绝「打开时同步扫描全文构建所有表格 metadata」）。树未覆盖时走 30ms 短延时重试
  （`:239-261`，M115 真实缺陷的防线）。
- 呈现：两个 BlockWrapper——外层 `.cm-lp-block-scroll.cm-lp-table-scroll`（`role="region"`、
  `tabindex=0`、`aria-label="Markdown 表格 N"`，`:266-272`）+ 内层 `.cm-lp-table`
  （`role="table"`、grid，`:273-284`）；行是 line 装饰（`.cm-lp-table-row`）、cell 是 mark 装饰
  （`.cm-lp-table-cell`，inline style 写 `grid-column` 与 `text-align`，`:560-599`）；管道符经行内
  `Decoration.replace` 隐藏（残留 `img.cm-widgetBuffer` 由 `src/style.css:897-899` 摘掉）。
  **cell 内容就是文档的活源码位置**——这是与图片（replace widget）的根本差别，直接决定裁决点 2。
- 宽度合同（M119）：表框 `inline-size: max-content` + 轨道 `minmax(min-content, max-content)`，
  cell 不折行不裁切；可见宽 = min(自然宽, 栏宽)，超出由 `.cm-lp-table-scroll` 横滚
  （`src/style.css:804-838`；纯函数口径 `src/preview/table.ts:219-224` 的 `planTableWidth`）。

### 1.2 降级表：>64 KiB 或非矩形 → 整块源码，没有 grid DOM

`src/preview/table.ts:118-122`（`oversize` 阈值 64 KiB）与 `:132`（`degraded` 标志）；
降级文案 `degradationNotice`（`:148-158`）经 `.cm-lp-table-degraded::after` 上屏
（`src/style.css:906-916`）；合同 `docs/specs/table-reading.md` §1（三层分级）与 §2（矩形性）。
**推论**：可放大的表源码 ≤64 KiB——全屏快照的成本上界因此有界（§6）。

### 1.3 既有交互（本 change 不加不减）

| 交互 | 现状 | 锚点 |
|---|---|---|
| cell / 表头双击 | 选词；落在对齐填充空白上时改选最近的实际词（M113）；表头双击选区漂移已修（M115）；「表头双击选中手感」是 AGENTS.md 登记的 Alex 手感项 | `src/preview/livePreview.ts:419-448` |
| 滚动容器持焦键 | `←` `→`（120px 步进）`Home` `End` `Escape`（焦点交还编辑器），统一键位表 + `when` 条件 | `src/preview/livePreview.ts:347-367`；`src/keys.ts:246-249`（`BLOCK_SCROLL_CLASS` 单一来源） |
| 选区显露覆盖集 | 不含表格（表格不是 replace widget，cell 本就可见可编辑） | `openspec/specs/editor-live-preview/spec.md`「live preview 装饰层」的显露清单 |
| AX | 容器 region + grid table/row/cell + `aria-colcount/rowcount` | `src/preview/livePreview.ts:266-284`；合同 `docs/specs/table-reading.md` §4 |

### 1.4 浮层先例（本 change 的零件箱）

- **M184 image lightbox**：`src/lightbox.ts`（状态机 `createLightboxState` `:75-98` + DOM 层
  `createImageLightbox` `:107-180`；惰性建 DOM；四条关闭路径回同一个 `close`；`Esc` 就地消费不进
  统一键位表）；遮罩 CSS `src/style.css:1005-1038`（`--scrim` 底、`z-index: 20`、`[hidden]` 显式补回）。
- **M133 键位面板**：`role="dialog"` + `aria-modal` + `tabIndex=-1` + 打开即 `focus()` + `Tab` 留驻 +
  `restoreFocus()`（`src/bindings-panel.ts`；CSS `src/style.css:918-951`：浮层壳配方 =
  `--preview-bg` + 1px `--border` + `--shadow-raise` + `--r10`，eink 升级 1.4px 线宽无阴影）。
- **命令机制**：`KEYLESS_COMMAND_IDS`（`src/keys.ts:217-222`，M180 先例）+ 键位面板「未绑定」行
  （D66 口径，`openspec/specs/keymap-commands/spec.md` 的「统一键位分发表」）+ `toc.toggle` 的
  global 作用域理由（浮层开着时焦点不在编辑器内，`editor` 作用域会让「再按一次收起」失效——
  `openspec/changes/archive/2026-09-17-add-toc-outline/specs/keymap-commands/spec.md`）。

## 2. 快照机制：DOM 克隆，而不是重建，更不是搬动

打开遮罩时，把该表的内层 grid（`.cm-lp-table` 子树）**深克隆**进遮罩容器，得到一个只读快照。

逐条论证：

1. **保真度**：cell 里的链接标记、行内代码、图片、公式等 inline 形态都是装饰层已经渲染好的 DOM，
   克隆原样带走（`<img>` 的 `src` 是同一字符串，浏览器按 URL 串键控复用已解码位图——M184 实测，
   `src/lightbox.ts` 文件头）。重建一条「从 TableModel + 源码切片画一张静态表」的旁路则会丢掉全部
   inline 渲染（cell 内的 `` `code` ``、链接、`![img]` 全退回原文），是同一张表的两套呈现口径——
   [REVIEW.md](../../../REVIEW.md) 第 8 条的形态，否决。
2. **不搬动**：CM 装饰 DOM 归 CM 管，把节点**搬**进遮罩会让编辑器布局与装饰状态脱节
   （M184 否决「搬 `<img>`」的同款理由，`open-image-lightbox` design §3）。克隆是唯一不碰原件的做法。
3. **只读是结构性的**：克隆不带事件监听、不在 CM 的 contenteditable 子树内，没有编辑路径可言——
   「全屏内只读」不是一条要维护的开关。
4. **快照时刻 = 打开时刻**：遮罩是模态层，持焦期间编辑键不穿透，文档不会因用户编辑在遮罩底下变化；
   唯一例外是**外部修改重载**（watch 链路）——文档代际变化时遮罩 SHALL 关闭且不抢焦点
   （视同 `blur` 兜底），不留「看旧表」的第三种状态。

实现期必须处理的克隆卫生（写进 [tasks.md](tasks.md) 2.x 的验收口径；**下面两条是实测后的定稿，
与本节初稿的推断不同处已按 tasks 1.3 的纪律回改**）：

- **摘除 CM 运行态残留**：`img.cm-widgetBuffer`（CM 在隐藏 replace 位置插的零宽 buffer）与
  **触发钮**（本 change 自己加的 `Decoration.widget`）、以及 **`.cm-gap`**（CM 对「未渲染区」的
  占位，实测 700 行表里它带着 16,651px 的未渲染内容高度——留着会让快照出现一块与任何内容都不
  对应的空白）。三者都**物理摘除**，不依赖 CSS 规则。断言钉住「克隆文本与源表逐字节一致」+
  「克隆里这三类节点计数为 0」。
- **选区**：**实测本应用未装 `drawSelection`**（`src/` 全仓零命中，DOM 里没有
  `.cm-selectionLayer` / `.cm-cursorLayer`），选区是原生 DOM 选区——克隆在脱离文档的树里天然
  不带选区视觉。选择器仍按 `.cm-selectionLayer` / `.cm-cursorLayer` 清一遍，纯防御（将来装上
  drawSelection 时不会静默带上「当前选区」这个编辑态假 affordance）。
- **样式作用域**：本节初稿的推断**只对了一半，实测范围更广**。仓内表格规则是全局选择器
  （`.cm-lp-table …`，`src/style.css`），克隆脱离 `.cm-editor` 后仍然命中 ✓；但 CM 主题
  （`livePreviewTheme` / `codeBindingTheme` 等全部 `EditorView.theme` 规则）**整批**都 scope 到
  编辑器根的生成类上（实测编辑器根为 `cm-editor ͼ1 ͼ2 ͼm ͼ14 ͼ5`，规则形如
  `.ͼ1 .cm-lp-inline-code { … }`），克隆脱离后**一条都不命中**——不止基础主题的字体/行高：
  `.cm-lp-inline-code` 退回 sans / 13.5px（实测该列 max-content 因此短 9px，列宽 74.78px →
  65.75px），`.cm-lp-link*` 丢 accent 色与上标标记。处置因此分两层：
  ① 遮罩容器显式补齐字体 / 字号 / 行高 / 字色（取 `--editor-font-family` / `--editor-font-size` /
  `--lh-ui` 这些**编辑器作用域 token**，与运行期字号步进同源）；② 装快照时把源元素所在编辑器根上
  的**主题 scope 类**（非 `cm-` 前缀的那些生成类）镜像到快照容器上——这样同一批规则重新命中克隆，
  而规则值仍只有 `src/preview/theme.ts` 一处（**镜像而非复制**，规避 REVIEW.md 第 8 条）。
  代价是对 CM 的 scope 机制有一处依赖，守卫是计算样式断言（CM 换掉该机制时断言红，不静默降级）。
- **id / aria 引用**：克隆里的 `aria-colindex` 等属性原样保留（读屏结构不丢）；若将来出现 `id`
  引用（当前表格 DOM 无 `id`），克隆时摘除。

## 3. 遮罩本体与 tokens（三主题一致）

- 根：`position: fixed; inset: 0; z-index: 20; background: var(--scrim)`，显式补回 `[hidden]`
  规则（author `display` 盖 UA 的坑已踩过两次：`src/style.css:931-934`、`:1022-1025`）。
- 内容：居中面板壳 = `--preview-bg` + 1px `--border` + `--shadow-raise` + `--r10`
  （键位面板配方，`src/style.css:935-948`）；表格快照在壳内**双向滚动**（`overflow: auto`）——
  与 M184 图片的「适配遮罩不放大」不同：表格的价值就在自然尺寸，**不缩放、不压缩**，
  放不下就滚（这正是「比阅读栏宽」的增量价值）。壳的最大尺寸 = 遮罩可用区域减内边距。
- 语义：`role="dialog"` + `aria-modal="true"` + `tabIndex=-1` + 打开即 `focus()`；
  读屏名复用表格容器既有的 `Markdown 表格 N` 标签生成处（`src/preview/livePreview.ts:266`，
  同一字符串单一来源，零新 deck 条目）。
- **三主题**：light/dark 走 token 自然成立；eink 照浮层规则⑦⑧——无阴影、边框升级 1.4px 实心黑
  （`src/style.css:949-951` 同款）；`--scrim` 在 eink 以明度差保留（M184 已验证的遮罩底口径）。
  **零新 token、零组件级新增色值**。

## 4. 入口接线（推荐项：命令，默认不绑键）

- 命令 id `table.toggle-fullscreen`，进 `COMMAND_IDS` / `GLOBAL_COMMAND_IDS`，登记
  `KEYLESS_COMMAND_IDS`（默认不绑键是要签字的决定，不是遗漏——`src/keys.ts` 的口径）。
- 作用域 `global` + 命中条件：遮罩开着 → 关闭（toggle）；否则 caret 在已渲染 grid 的表内或表格
  滚动容器持焦 → 打开。取 global 的理由照 `toc.toggle`：遮罩开着时焦点在遮罩里，`editor` 作用域下
  「再按一次关闭」不成立。条件**由命令级门承担**（实现期定稿）：绑定层的 `when` 只拿得到事件、
  拿不到编辑器状态，而 `[keys]` 覆盖产出的绑定没有 `when` 字段——`KeymapContext.commandGate`
  是键位层留的那个口子，门为假时不消费事件（不 `preventDefault`，M132 的既有语义）。
- 定位用既有零件：caret 位置 → `fullscreenTableAt(tableModels(state, discoveryRange).models, pos)`
  （`tableAt` 二分 + `rectangular && !degraded` 两个条件，`src/preview/table.ts`）；「容器持焦」
  这条走 DOM（容器元素本身就是「渲染为 grid」的证据），两条路径都回到「要克隆的 grid 元素 +
  它既有的 `aria-label`」——降级表/非矩形表的命中条件天然为假，**无入口是结构性事实**（proposal §二）。
- 装配照 M184：`PreviewContext` 增口子（`tableFullscreen(): TableFullscreen | null`，未接线返回
  `null`，同 `lightbox()` 口径），`src/main.ts` 建遮罩（挂点 `shell.root`、
  `restoreFocus: () => editor.view.focus()`）并注入。**scope 补记**：`PreviewContext` 的对象字面量
  在 `src/editor.ts`（M184 的注入点也在那里），该文件不在 M240 的初始 scope 内，经 tower 裁决扩入
  （2026-09-26，mission scope 已留痕）——4 行改动，与 M184 逐条同形。
- **鼠标入口**（D3 的双入口之另一侧）：表格右上角内侧的 hover 触发钮，锚定表格可视盒坐标系
  （第三层 BlockWrapper `.cm-lp-table-slot` + 一个绝对定位的 `Decoration.widget`，机制与理由
  见 `src/preview/table-trigger.ts` 文件头）；形态纪律逐条按 M235 划稿
  （`design/prototypes/table-fs-trigger/` 的 `inside-corners-hover`），读屏名取 deck D124。
- `[keys]` 绑定后生效；键位面板自动列出未绑定行（D66 口径）。

## 5. 关闭路径：与 M184 逐条同款 + toggle

| 路径 | 落点 | 与 M184 的关系 |
|---|---|---|
| `Esc` | 遮罩上就地消费（`keyToken` 归一化）+ `preventDefault`；**不进统一键位表**（`Esc` 已归 `editor.widget-escape`（带 `when`），同 token 第二条绑定被构造期拒绝） | 同款 |
| 点击遮罩（表格外区域） | 遮罩 `mousedown`：`event.target === overlay` 时关闭，**先 `preventDefault`**（否则 `blur` 先关掉它、`restoreFocus` 被吃掉——M184 design §4.2 的坑） | 同款 |
| 再次执行 `table.toggle-fullscreen` | 命令层（global 作用域的理由，§4） | 命令入口的自然对偶（`toc.toggle` 同款）；M184 的对应位是「遮罩内再次双击图片」 |
| 焦点兜底 | 遮罩 `blur` → 关闭且**不抢焦点**（另开面板 / 窗口失活 / 文档代际变化都归这条） | 同款 |

四条回同一个 `close(reason)` 单入口（M184 状态机手法，`src/lightbox.ts:75-98`）。
遮罩持焦期间：`editor` 作用域键不穿透（`isEditorEvent` 口径）、`Tab`/`⇧Tab` 留驻
（`preventDefault`）；遮罩内容器的滚动走**原生**路径（滚轮/触控板/方向键在可滚动焦点元素上
原生滚动，不占统一键位表——遮罩 DOM 不是 CM widget，widget 滚动键的 `when` 条件天然不命中）。
打开与关闭前后：`EditorState.doc` / 磁盘文件逐字节不变、选区与 caret 逐值不变（ADR 0003 §3）。

## 6. 性能边界

- **可放大的表有界**：`degraded` 阈值 64 KiB 源码（`src/preview/table.ts:118-122`）⇒ 快照克隆的
  输入上界 = 一张 ≤64 KiB 源码的表的渲染 DOM。这是合同给出的天然上界，本 change 不设新上限。
- **「100k 行」归在哪**：仓内 100k 量级的既有合同是**列表**渲染预算（`tests/visual/scenes/lists.spec.ts`
  的 100k 密集项，p95 60ms，`docs/backlog.md:1290`）；表格侧的合同分级是字节口径（≤16 / 16–64 /
  >64 KiB，`docs/specs/table-reading.md` §1）。一张 100k **行**的 pipe table 必然远超 64 KiB ⇒
  今天整块降级为源码 ⇒ **结构性无全屏入口**；含 100k 行/级的**文档**不受影响——表格发现保持
  视口有界（`tableDiscoveryRange`），命令命中判定走缓存模型的二分（`tableAt`），
  MUST NOT 为全屏引入全文档扫描。若将来放宽 64 KiB 上限（另一个 change），本 capability 的
  快照成本随上限同步有界，不需要改合同。
- **惰性建 DOM**：遮罩节点首次打开时才建（M184 同款）；文档打开路径与键入路径零新增工作
  （ADR 0002 §6 的打开 1MB <100ms 与 keypress-to-paint <16ms 不因此放宽）。触发钮按 decoration
  装配（与表格的 BlockWrapper 同一份 models），打开路径不因它多一次扫描。
- **打开成本**：一次子树克隆 + 一次样式重算，O(表格 DOM)。**实测**（chromium 1200×800，
  tasks 2.4 的读数落 `test-results/acceptance/2026-09-26/table-fullscreen-before/open-cost.json`）：
  近上限夹具（700 行 / 60,764 B / 29,940 chars，两个降级判据都在 64 KiB 之下）打开总耗时
  **3.4ms**（事件分发链 3.4ms + 样式与布局 0ms），快照 496 节点 / 1,678 字符 / 宽 454.83px
  （= 文档内 grid 宽）。远在「用户主动动作可感知」档之下，不押优化。
- **视口语义是真正的上界（实测修正）**：CM 只渲染视口附近的行，因此快照的规模不由表源码大小
  决定，而由**打开那一刻已渲染的那部分**决定——同一夹具在浏览器里只渲染 49 行，未渲染区以
  `.cm-gap` 占位（16,651px）。推论两条：① 成本上界比 §6 初稿的估计更小；② **长表在全屏里只看
  到已渲染的部分**（不是缺陷，是「打开那一刻渲染态 grid 的副本」的字面口径），如实写进 spec 的
  已知边界与 PR——完整快照需要另一条渲染路径（design §8 已否决的「从 TableModel 重建」那一类），
  是另一个 change。
- **字节通道**：零新增——快照来自既有 DOM，不调 `fs_read_attachment`，`src-tauri/**` 零改动。

## 7. 与既有交互的边界（逐条核对，防误伤）

| 交互 | 关系 | 依据 |
|---|---|---|
| cell / 表头双击选词 | **不变**：本 change 不占双击 | §1.3；裁决点 3 备选③被否的理由 |
| 滚动容器五条 widget 键 | **不变**：遮罩 DOM 不是 CM widget，`when` 条件不命中 | `src/keys.ts:246-249` |
| 图片 lightbox | **同形不共享状态**：两个遮罩没有互斥注册表；表格遮罩持焦时 `⌘/` 等 global 命令照常生效，新层抢焦点 → 本遮罩 `blur` 退场（既有口径）。表格 cell 里的图片双击今天打开图片 lightbox；快照克隆里的 `<img>` 不带监听——**克隆内双击图片不开 lightbox**（快照只读语义的应有之义，写进已知边界） | `src/lightbox.ts`；`src/toc.ts:360-367`（focusout 监听） |
| 选区显露 | 表格本就不在显露覆盖集内，不加不减 | §1.3 |
| 外部重载 / 保存链路 | 文档代际变化 → 遮罩按 `blur` 口径关闭不抢焦点；保存不改变文档内容（⌘S 穿透与否由模态语义决定：遮罩持焦时 ⌘S 是 global 命令、照常生效——与 M184 期间一致） | §2.4；`src/save-controller.ts` |
| 只读 code 模式 | 无关：表格 grid 只发生在 md 模式的装饰层 | `openspec/specs/editor-live-preview/spec.md`「单内核双模式落地」 |
| 多标签 | 遮罩是窗口级层，随当前标签的文档；切标签（⌃⇥，global）抢焦点 → `blur` 退场 | `src/keys.ts` 标签命令 |

## 8. 备选方案与拒绝理由

| 方案 | 拒绝理由 |
|---|---|
| 独立 zen 视图（裁决点 1 备选） | 窗口级视图态 × 标签 × 文档的笛卡尔积；退出要回答「恢复到哪个滚动位置」；体量与「看一眼整张表」不匹配。列进裁决点表交 Alex 决定 |
| 遮罩内可编辑（裁决点 2 备选） | 要么搬 CM 装饰 DOM（破坏编辑器布局与装饰状态，M184 同构否决），要么起第二个 EditorView（装饰层装配全接一遍 + 与单内核定位摩擦）；表格在正文里今天就可编辑，没有「只能进全屏才能改」的缺口 |
| 从 TableModel + 源码切片重建一张静态表 | 丢掉全部 inline 渲染（链接/行内代码/图片退回原文），同一张表两套呈现口径（REVIEW.md 第 8 条） |
| 双击表头作入口（裁决点 3 备选③） | 与既有双击选词直接冲突（M113/M115 两次修过的行为 + AGENTS.md 手感项）；等于重新定义表头双击语义 |
| 表格工具钮作入口（裁决点 3 备选②） | 内容区第一个 chrome 元素：出现时机/位置/eink 形态都需单独裁决；出现在所有含表格的整页基线里（基线卫生成本）；发现性收益真实但可由「⌘/ 面板的未绑定行」部分覆盖。列进裁决点表 |
| 默认绑键（裁决点 3 备选①） | 永久占掉一个物理组合；本版没有强证据表明它是高频动作。列进裁决点表 |
| 把 `Esc` 写进统一键位表 | 「一个 token 一条绑定」不变量：`Esc` 已归 `editor.widget-escape`，第二条被构造期拒绝；就地消费是既有自洽形态 |
| 快照里保留「当前选区」视觉 | 快照是查看物，选区是编辑态；克隆摘除选区层，避免「以为可以接着选/改」的假 affordance |

## 9. 风险与未决点

| 项 | 状态 | 处置 |
|---|---|---|
| 克隆脱离 `.cm-editor` 后的计算样式保真（CM 注入主题不继承） | **已实测定论**：CM 主题**整批** scope 到编辑器根（实测 `cm-editor ͼ1 ͼ2 ͼm ͼ14 ͼ5`），丢的不止基础主题——行内代码退回 sans、链接丢 accent 色 | §2 已按实测回改；处置 = 容器补 token + 镜像主题 scope 类（不复制规则值），守卫是 5.4 的计算样式断言（反向验证留档 `test-results/acceptance/2026-09-26/table-fullscreen-before/reverse-1-theme-scope.log`） |
| 克隆里 CM selection 层的形态（DOM 层 vs 原生选区） | **已实测定论**：本应用未装 `drawSelection`，选区是原生 DOM 选区、DOM 里没有选区层 | 选择器仍清一遍（纯防御）；读数落 1.1 的 `readings.json` |
| 接近 64 KiB 上限表的打开耗时 | **已实测**：3.4ms（夹具 700 行 / 60,764 B），快照 496 节点 | 不需要记已知边界；读数落 `open-cost.json` |
| 长表（高于视口）在全屏里只看到已渲染的部分 | **实测发现**（CM 只渲染视口附近的行） | 写进 spec 已知边界 + `docs/backlog.md`；完整快照是另一个 change |
| 「遮罩开着时文档被外部重载」的真机行为 | 设计口径（按 `blur` 关闭），未真机验证 | 真机场景 40 覆盖；观感归 Alex |
| 宽表在遮罩内双向滚动的手感（触控板惯性、横向优先） | 未验 | 手感归 Alex dogfood，套件只留截图（AGENTS.md 分工） |
| 克隆内图片不响应双击（快照只读语义） | 设计决定 | 写进 spec 已知边界；若 Alex 期望「全屏里还能再放大图」，是另一个 change |

## 10. 验收面（与 tasks.md 对应）

- **合同层**：`editor-live-preview` 增量两条 + `keymap-commands` 增量一条，逐条落 scenario。
- **单测层**：遮罩状态机（四条关闭路径回同一 `close`、toggle、文档代际关闭）、命令命中条件
  （caret 在/不在表内、降级表、容器持焦）。
- **视觉层（chromium，CI）**：打开/三条关闭/toggle、不穿透与 `Tab` 留驻、快照保真（文本逐字节 +
  计算样式 + inline 形态）、降级表/非矩形表无入口（负向断言配对正观测）、宽表可滚/窄表不滚、
  容器持焦命中、文档与选区逐值不变；两条反向验证（关掉主题 scope 镜像 / 关掉克隆卫生）各留红灯
  证据。全部落在 `tests/visual/scenes/m240-table-fullscreen.spec.ts`（8 例）与读数探针
  `m240-table-fullscreen-readings.spec.ts`。
- **真机层（WKWebView）**：场景 **40-table-fullscreen-view**——推荐项下经 `[keys]` 绑定触发
  （`09b-keys-config` 的配置注入先例），断言遮罩 AX 几何非零、表格文本在场、`Esc` 关闭后焦点回编辑器、
  `editor.unchangedSince` 与磁盘 `unchangedSince` 两条独立断言。
- **不改写源文件**：三层都断言 `EditorState.doc` / 磁盘逐字节不变（ADR 0003 §3）。
- **基线**：推荐项下静止态零视觉变化，预期零基线更新；遮罩是新元素，观感截图留 `test-results/`
  请 Alex 过目（基线更新是人肉裁决点，tests/visual/README.md）。
