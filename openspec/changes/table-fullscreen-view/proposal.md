# Proposal: 表格放大全屏查看（应用内遮罩浮层）

- Change ID: table-fullscreen-view
- 日期: 2026-09-25
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 需求原话（2026-09-25）：**「表格放大全屏查看」**。参考形态：DeepSeek Harness 式的内容放大。

### 一、诉求面在哪：宽表「能渲染」不等于「看得全」

表格阅读链路今天已经完整：pipe table 经语法树识别后按 grid 渲染（`src/preview/livePreview.ts:262-288`
的两个 BlockWrapper + `:560-599` 的行/格装饰），宽度合同是「表框 = 内容自然宽、可见宽 =
min(自然宽, 栏宽)、超出部分由表格局部横滚承载」（M119，`docs/specs/table-reading.md` §3；
`src/style.css:825-838`）。这张合同对**编辑中的表**是对的——cell 不折行、不裁切、列不错位；
代价是宽表在阅读栏里永远只能看到局部，扫读一张 20 列的表要反复横滚。图片侧的同构诉求
（「信息在细节里，内联只剩缩略版」）已由 M184 的 lightbox 解决（双击看大图，`src/lightbox.ts`）；
表格是另一类「信息在整体结构里」的内容，**放大全屏查看**是横滚的直接补位，且不需要动内联渲染的
任何口径（本 change 一个字都不改）。

### 二、四个必须写清的设计点，以及它们在代码里的现状

| # | 设计点 | 现状锚点（可复核） |
|---|---|---|
| 1 | 全屏形态 | 既有先例是 M184 的图片 lightbox：应用内全屏遮罩（`position: fixed; inset: 0` + `--scrim` 底，`src/style.css:1011-1025`）+ 模态焦点管理（`role="dialog"` + `aria-modal` + 打开即持焦，`src/lightbox.ts:107-180`，手法同键位面板 `src/bindings-panel.ts`）。形态裁决见裁决点 1 |
| 2 | 全屏内只读还是可编辑 | 表格**不是** replace widget：cell 内容就是文档的活源码位置（line/mark 装饰 + 管道符行内 replace，`src/preview/livePreview.ts:560-599`；`src/style.css:895-899` 的 widgetBuffer 注释），正文的表格今天就可编辑。「全屏里再编辑一份」意味着第二个编辑器实例或把 CM 装饰 DOM 搬进遮罩，两条路都与现状架构冲突（理由见 [design.md](design.md) §2）。裁决见裁决点 2 |
| 3 | 入口 | 鼠标手势里双击已被占：cell 与表头的双击 = 选词（M113 的对齐填充空白处理 `src/preview/livePreview.ts:419-448`；M115 修过表头双击选区漂移；「表头双击选中手感」在 AGENTS.md 里是 Alex 的手感项）。表格滚动容器是可聚焦 region（`tabindex=0`、`aria-label="Markdown 表格 N"`，`src/preview/livePreview.ts:266-272`），持焦时有 `←` `→` `Home` `End` `Escape` 五条 widget 键（`src/preview/livePreview.ts:347-367`，统一键位表 + `when` 条件，`src/keys.ts`）。命令机制现成：M180 的「默认不绑键清单」（`src/keys.ts:217-222` 的 `KEYLESS_COMMAND_IDS`）+ `[keys]` 配置绑定 + 键位面板「未绑定」行（D66 口径）。裁决见裁决点 3 |
| 4 | 与 image lightbox 的关闭交互一致性 | M184 已定型：三条用户路径（`Esc` 就地消费 / 点击遮罩 / 遮罩内再次双击）+ 一条焦点兜底（`blur` 关闭不抢焦点），四条回同一个 `close`（`src/lightbox.ts:75-98`）；`Esc` 就地消费不进统一键位表（`Esc` 已被 `editor.widget-escape` 占用，`src/keys.ts:43-52`）。表格全屏的关闭语义没有理由另起一套，裁决点 4 只收表格特有的增量 |

另外两条在需求原话之外、但决定实现能不能站住：

- **降级表没有入口**。超过 64 KiB 源码或非矩形的表整块回退为源码 + 降级文案（`src/preview/table.ts:118-122`、
  `:148-158`；合同 `docs/specs/table-reading.md` §1-§2），降级表**没有 grid DOM**。把打开条件钉在
  「该表当前渲染为 grid」上，「降级表无入口」就是结构性事实而非一条需要维护的开关——与 M184
  「占位不可点开」（没有 `<img>` 就没有监听者）同一手法。
- **快照语义**。遮罩是模态层，持焦期间编辑键不穿透；但文档仍可能因**外部修改重载**（watch 链路）
  在遮罩底下变化。全屏内容是打开那一刻的快照，文档代际变化时遮罩 SHALL 关闭且不抢焦点
  （视同焦点兜底）——不留「遮罩里看的是旧表、文档里已是新表」的第三种状态。

## What Changes

（以下按各裁决点的**推荐项**写；裁决改备选时按裁决点表的「备选」列改写 delta 与 tasks，不静默扩 scope。）

1. **新增命令 `table.toggle-fullscreen`，caret 在表内或表格滚动容器持焦时打开该表的全屏遮罩**。
   默认**不绑键**，登记进 `KEYLESS_COMMAND_IDS`（M180 折行开关先例），用户可经 `[keys]` 绑定；
   键位面板自动列出（未绑定行按 D66 口径显示成因）。遮罩开着时再执行同一命令 = 关闭（toggle），
   因此作用域取 `global` 并带命中条件（`toc.toggle` 选 global 的同款理由）。
   （delta：ADDED `editor-live-preview / 表格放大全屏查看` + ADDED `keymap-commands / 表格全屏查看命令`）

2. **全屏内容 = 打开那一刻的只读快照**：遮罩内呈现的是该表当时渲染态 grid 的副本
   （含 cell 内已渲染的链接 / 行内代码 / 图片等 inline 形态），只读——全屏是查看形态，编辑回文档里做
   （关闭即回到原表，光标与选区逐值不变）。快照机制与「不搬 CM DOM」的防线见 [design.md](design.md) §2。

3. **关闭交互与 image lightbox 完全一致**：`Esc`（遮罩上就地消费，不进统一键位表）、点击遮罩
   （表格以外的区域）、焦点兜底（`blur` 关闭且不抢焦点）；命令路径再加一条「再次执行
   `table.toggle-fullscreen` 关闭」，四条用户路径 + 一条兜底回到同一个 `close`。关闭后焦点交还编辑器。
   遮罩持焦期间 `editor` 作用域的键不穿透、`Tab` 留在遮罩内。同一 delta requirement 覆盖。

4. **打开与关闭都不碰文档**：`EditorState.doc` 与磁盘文件逐字节不变（ADR 0003 §3），选区与光标落点
   不变；表格的选区显露口径（本就不在显露覆盖集内）不加不减。文档代际变化（外部重载）时遮罩自行关闭
   且不抢焦点。

5. **降级表与非矩形表没有任何打开路径**：命令在 caret 不在已渲染 grid 的表内时命中条件为假、
   不消费事件（行为判据：事件原样留给原生路径）。这是「该表当前渲染为 grid」的结构性结果，
   MUST NOT 用「降级时给提示」之类的分支模拟（一条「这表不能放大」的 toast 是噪音）。

6. **本 change 不改内联表格渲染的任何口径**：宽度合同、横滚容器、双击选词、widget 滚动键、
   降级文案一律不动；`src-tauri/**` 零改动（全屏内容是装饰层 DOM 的副本，不新增字节通道）。

## 须提请 Alex 节点 1 裁决的选项

四项都给了推荐项（推荐项的形态**已经按默认写进 delta**）；若裁决改成备选，delta 与 tasks 按
「备选」列改写，不静默扩 scope。

| # | 裁决点 | 推荐（已写进 delta） | 备选 | 一句话取舍 |
|---|---|---|---|---|
| 1 | 全屏形态 | 应用内全屏遮罩浮层（复用 M184 lightbox 的遮罩手法与模态语义，内容区 = 表格副本，遮罩内双向滚动） | 独立 zen 视图：切换整个窗口到「只看这张表」的视图态，退出时恢复编辑器与滚动位置 | 推荐项与既有浮层惯用语一致、定位在文档流之外（不动文档几何），打开/关闭是 O(1) 的层叠动作；zen 视图要动窗口级状态机（标签 × 文档 × 视图态的笛卡尔积），退出还要回答「恢复到哪个滚动位置」，体量与「看一眼整张表」的诉求不匹配 |
| 2 | 全屏内可编辑性 | **只读**快照：全屏是查看形态，编辑回文档里做 | 可编辑：遮罩内编辑直接写回文档 | 推荐项下遮罩只是「同一张表的另一种呈现面」，与 M184 同族；可编辑要么把 CM 装饰 DOM 搬进遮罩（破坏编辑器布局与装饰状态，M184 已否决同构做法），要么起第二个 EditorView（装饰层装配——附件通道、wikilink 解析、键位——要全接一遍，且与「单内核」定位摩擦），体量是另一个数量级；表格在正文里**今天就可编辑**，不存在「只能进全屏才能改」的缺口 |
| 3 | 入口 | 命令 `table.toggle-fullscreen`（caret 在表内 / 表格容器持焦时命中），**默认不绑键**、登记 `KEYLESS_COMMAND_IDS`、可经 `[keys]` 绑定；键位面板自动列出 | ① 命令 + 默认绑键（需在实现期另选空位组合并核对冲突）；② 表格工具钮（悬停/聚焦表格时出现的 chrome 按钮，鼠标路径）；③ 双击表头 | 推荐项零新视觉面、零新文案（面板行是自动的），与 M180 折行开关同一先例；可发现性由 ⌘/ 面板的「未绑定 + 成因」行承担。①不配置也能用，代价是永久占掉一个物理组合；②给鼠标用户一条路，但它是**内容区第一个 chrome 按钮**（restyle 后的视觉纪律下，形态本身值得单独裁决，且会出现在所有含表格的整页基线里）；③与既有「双击选词」直接冲突（M113/M115 两次修过的行为，且是 AGENTS.md 登记的 Alex 手感项），等于重新定义表头双击语义 |
| 4 | 关闭交互 | 与 image lightbox **逐条同款**（`Esc` / 点击遮罩 / `blur` 兜底不抢焦点 / 关闭归还编辑器），外加命令路径的 toggle（再执行一次命令 = 关闭）；遮罩内表格超出可视区时由遮罩内容器原生滚动（滚轮/触控板/方向键），`Esc` 始终关遮罩 | 完全逐字复刻 M184（不加 toggle，关闭只有三条路径） | 推荐项保持两份浮层语义心智成本为零，toggle 是命令入口的自然对偶（`toc.toggle` 同款）；备选更保守，代价是「键盘打开的用户必须伸手去按 `Esc` 或抓鼠标」——其实 `Esc` 就是键盘键，代价很小，故此备选也成立 |

## Non-goals

- **不做独立 zen 视图 / 新窗口 / 系统预览**（裁决点 1 备选）：与 ADR 0001 单窗口工作台一致。
- **全屏内不做编辑**（裁决点 2 备选）：不做 cell 编辑、不改行列、不做排序/筛选/公式——
  全屏是查看形态；表格编辑在文档内既已可用。
- **不做文档内多表导航**（上一张 / 下一张）：会引入「当前在第几张」的跨表状态，是另一个形态。
- **不改内联表格渲染的任何口径**：宽度合同（M119）、横滚、双击选词、widget 键、降级文案全不动。
- **不做表格工具钮**（裁决点 3 备选②）：若 Alex 选它，它作为内容区第一个 chrome 元素，
  视觉形态（出现时机、位置、eink 表现）需要在本 change 内追加裁决，且整页基线要按
  [REVIEW.md](../../../REVIEW.md) 第 3 条逐张核对。
- **不改变降级表的任何行为**：降级表无入口是结构性结果，不加提示、不加「强制放大」旁路。
- **不新增字节通道**：快照来自装饰层既有 DOM 与文档文本，不调 `fs_read_attachment`、不动 Rust 侧。
- **不引入新视觉语言**：遮罩、配色、圆角、阴影一律取既有 token 与既有遮罩手法
  （`--scrim` / `--preview-bg` / `--border` / `--shadow-raise`，`src/style.css:918-951`、`:1005-1038`）。

## capability 归属：为什么是 `editor-live-preview` 的 ADDED

**结论**：新增 requirement 落 `editor-live-preview`（既有 living spec，
`openspec/specs/editor-live-preview/spec.md`）；命令登记落 `keymap-commands`（ADDED ×1，
照 `add-toc-outline` 的先例——新命令以一条新 requirement 登记 id、作用域、绑键口径与面板/配置可见性）。
本 change **不新建 capability**。

理由：全屏查看是「同一张表的另一种呈现面」——同一个 TableModel、同一套渲染口径、同一套降级判据
（「降级表无入口」就是 GFM/降级条款的补集），与图片 lightbox 归 `attachment-display` 同理
（M184 proposal 的归属论证逐条适用：同语义两处真源是 [REVIEW.md](../../../REVIEW.md) 第 8 条
点名的形态，拆开就会各自漂移）。反方（如实记录）：若裁决点 2 选「可编辑」或裁决点 1 选「zen 视图」，
体量会逼近独立 capability（那时应重新评审归属，而不是在本 change 里硬塞）。

## Impact

- 影响的 specs：`editor-live-preview`（ADDED ×2：「表格放大全屏查看」+「全屏查看的快照与性能边界」）、
  `keymap-commands`（ADDED ×1：「表格全屏查看命令——table.toggle-fullscreen」）。
  **不改**表格既有条款（GFM 短行/降级、宽度合同均不加不减）。若裁决点 3 选备选②（纯工具钮、无命令），
  `keymap-commands` 的 delta 整份撤掉。
- 影响的代码/系统（实现期，本 mission 零产品代码改动）：新增 `src/table-fullscreen.ts`
  （遮罩本体：DOM、快照、焦点、就地 `Esc`——与 `src/lightbox.ts` / `src/toc.ts` 同级同形）；
  `src/preview/livePreview.ts`（`PreviewContext` 增一个可选口子，同 `lightbox()` 先例）；
  `src/main.ts`（装配：挂点、`restoreFocus`、命令实现）；`src/keys.ts`（命令 id +
  `KEYLESS_COMMAND_IDS` 登记 + 命中条件）；`src/style.css`（新增遮罩段，零新 token）。
  `src-tauri/**` 零改动。
- 影响的文档：`文案-Copy.md` 推荐项下**零改动**（遮罩读屏名复用表格容器既有的
  `Markdown 表格 N` 标签生成处，`src/preview/livePreview.ts:266`——同一字符串单一来源；
  就地键只有 `Esc`，关闭路径其余是鼠标动作，同 M184 裁决点 4 的口径）。若裁决点 3 选备选②
  （工具钮）或裁决点 4 要求提示文案，追加 D120 起的新条目（末位当前为 D119）。
- 影响的测试/验收：`tests/visual/scenes/` 新增表格全屏断言组（打开/关闭/不穿透/快照保真/
  降级表无入口 + 反向验证先红）；`scripts/acceptance/scenarios/` 新增真机场景
  **40-table-fullscreen-view**（编号核对：master 现有最大编号 36（`36-restyle-content`），
  37/38/39 已分别被待实现的 `heading-hierarchy-ramp` / `content-width-drag` /
  `product-version-display` 三个 change 占用——依据各 change 的 tasks.md:
  `openspec/changes/heading-hierarchy-ramp/tasks.md:32`、
  `content-width-drag/tasks.md:89`、`product-version-display/tasks.md:41`；实现期动工前须按
  content-width-drag/tasks.md:85 的纪律再核一次编号）。推荐项（命令默认不绑键）下真机场景经
  `[keys]` 配置绑定触发（`09b-keys-config` 已有配置注入先例）。基线纪律：推荐项下静止态零视觉变化，
  预期**零基线更新**；遮罩观感截图留 `test-results/` 供 Alex 过目（同 M184 口径）。
- 关联约束：ADR 0003 §3（不改写源文件）、ADR 0002 §6（性能合同——遮罩 DOM 惰性建立，
  打开/关闭不在键入路径与文档打开路径上新增工作；可放大的表源码 ≤64 KiB，快照成本有界，
  详见 [design.md](design.md) §6）、ADR 0002 §3（webview 不直接访问文件系统——不新增读取路径）、
  ADR 0006（Emacs keybinding PKM 定位——命令入口与之同向；推荐项下鼠标用户无打开路径，
  如实写进 spec 已知边界与裁决点 3）、ADR 0004 第 5 条（功能变更走 OpenSpec）。
- 性能：打开/关闭 = 一次 DOM 克隆 + 一次层叠显隐，不在键入路径上；遮罩 DOM 惰性建立；
  文档发现范围保持视口有界（`tableDiscoveryRange`，`src/preview/livePreview.ts:224-230`），
  本 change MUST NOT 引入全文档扫描。克隆保真度与成本的实现期实测项见 [tasks.md](tasks.md) 2.x。
