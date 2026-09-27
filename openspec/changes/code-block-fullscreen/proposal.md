# Proposal: 代码块放大全屏查看（应用内遮罩浮层）

- Change ID: code-block-fullscreen
- 日期: 2026-09-27
- 角色: Alex Lee（评审/裁决），AI agent（起草）
- 状态: **提案（节点 1 待裁决）**——本 change 只到评审节点 1，零实现。

## Why

Alex 需求原话（2026-09-27）：**「代码块也可以像表格那样，放大查看。」**
表格侧的同形能力已由 `table-fullscreen-view` 落地并合并（M240，living spec 在
`openspec/specs/editor-live-preview/spec.md:894-995`、`:972-995`），本 change 是它的同族补位。

### 一、诉求面在哪：阅读栏里的「能读」不等于「看得全」

md 模式的围栏 / 缩进代码块今天已完整渲染：行装饰 + 头部条（围栏行即头部条）
（`src/preview/livePreview.ts:1004-1015`）、语法着色（`src/preview/code.ts:436-447` 的
`highlightCode`）、不折行时由块级横滚容器承载超长行
（`src/preview/livePreview.ts:370-400`，容器 `.cm-lp-block-scroll .cm-lp-codeblock-scroll`，
`role="region"` + `tabindex="0"` + 读屏名 `Markdown 代码块 N`）。三件事叠起来的现状是：

- **宽度受阅读栏限制**。栏宽 `ui.content_width` 默认 **760px**、上限 1200px
  （`src-tauri/src/config.rs:183`、`docs/specs/config-reference.md:65`）；窗口通常远宽于此，
  全屏遮罩能给出的可用宽 = 窗口宽 − 两倍 `--sp-12`，是本能力最直接的增量。
- **纵向受整篇文档限制**。代码块长于剩余视口时，读完要往下滚，滚过去就丢了块的上下文
  （同样的量级问题表格侧已用「看一眼整张表」解决）。
- **超长行的横滚在窄容器里反复往返**。

诉求因此不是「渲染不出来」，而是**「同一块代码在更大的画布上、离开文档流地看一遍」**——
与 M240 表格全屏同一句话（`openspec/changes/archive/2026-09-27-table-fullscreen-view/proposal.md` §一）。

### 二、四个必须写清的设计点，以及它们在代码里的现状

| # | 设计点 | 现状锚点（可复核） |
|---|---|---|
| 1 | 全屏形态 | 既有先例两条同族：M184 图片 lightbox（`src/lightbox.ts`，遮罩 `--scrim` 底 + 模态焦点）与 M240 表格全屏（`src/table-fullscreen.ts`，遮罩 + 居中面板壳 + 壳内双向滚动，CSS `src/style.css:1300-1343`）。形态裁决见裁决点 1 |
| 2 | 全屏里呈现什么 | 代码块的**渲染产物是一条线性的文本序列**（行 + token 着色），与表格 cell 里的富 inline DOM（链接 / 图片 / 行内代码）不同：它的源码本身就能重建同一观感，且着色只有一个纯函数出口 `highlightCode`（`src/preview/code.ts:436-447`）。**但 DOM 里只有已渲染的那些行**——CM 按视口渲染（M240 实测：700 行表只渲染 49 行，`archive/…-table-fullscreen-view/tasks.md:205`）。裁决点 2 就是这个岔口 |
| 3 | code 模式（非 md 文件）是否适用 | code 模式**没有 live preview 装饰层**（`src/editor.ts:1435-1437` 的 mode 分支），因此没有围栏渲染、没有「块」这个对象，也没有 `.cm-lp-codeblock-scroll` 容器；code 模式的「放大」只能是整份文件级的专注视图（另一个形态）。裁决点 3 |
| 4 | 入口 | 表格侧 D3 裁决给了**双入口**（命令 + hover 触发钮），形态按 M235 划稿实现（`src/preview/table-trigger.ts` 的文件头）。代码块侧可逐条照搬——但它需要一层「slot」包装层当钮的包含块，而代码块今天**没有这一层**，且折行口径下连横滚容器都不存在（`src/editor.ts:1131-1133`）。裁决点 5 |

另外两条在需求原话之外、但决定实现能不能站住：

- **折行口径是全屏必须回答的问题**。`editor.code_block_wrap` 今天决定两件事：块内行是否折行
  （`src/preview/theme.ts:262-273` 的两条内容级 class 规则，class 挂在 `.cm-content` 上）、
  以及横滚容器**存不存在**（`src/editor.ts:1131-1133`）。全屏态若另立一套口径，就会出现
  「同一块代码在两处折行行为不同」的第三种状态。裁决点 4 专收这一条。
- **超限块没有可依赖的既有上界**。表格侧的快照成本有天然上界：>64 KiB 源码的表整块降级为源码、
  **没有 grid DOM、没有入口**（`docs/specs/table-reading.md` §1）。代码块**没有这条降级**——
  >64 KiB 的块仍照常渲染（只是着色停用，`src/preview/code.ts:357` 的
  `MAX_HIGHLIGHT_CHARS = 64 * 1024` ⇒ `highlightCode` 返回空表、回落纯文本），
  所以「整块呈现」的 DOM 规模需要一条**新的**边界口径（见 What Changes 第 4 条与
  [design.md](design.md) §6）。

## What Changes

（以下按各裁决点的**推荐项**写；裁决改备选时按裁决点表的「备选」列改写 delta 与 tasks，不静默扩 scope。）

1. **新增命令 `code-block.toggle-fullscreen`**：遮罩已开 → 关闭（toggle）；否则 caret 落在
   md 模式的一块围栏 / 缩进代码块内、或该块的横滚容器持焦 → 打开该块的全屏遮罩。默认**不绑键**，
   登记进 `KEYLESS_COMMAND_IDS`（`src/keys.ts:277`，M180 / M240 先例），用户可经 `[keys]` 绑定；
   键位面板自动列出（未绑定行按 D66 口径给成因）。命中条件由命令级门承担
   （`KeymapContext.commandGate`，M240 的实现期定稿）。作用域 `global`，理由与 `toc.toggle` /
   `table.toggle-fullscreen` 同款：遮罩开着时焦点在遮罩里，`editor` 作用域会让「再执行一次关闭」失效。
   （delta：ADDED `editor-live-preview / 代码块放大全屏查看` + ADDED
   `keymap-commands / 代码块全屏查看命令——code-block.toggle-fullscreen`）

2. **第二条入口：代码块右上角内侧的 hover 触发钮**（与表格 D3 的双入口逐条同形：
   四角框字形、静止态零足迹、eink 黑框反白、`aria-label` 取文案 deck 新条目 D152
   「放大查看代码块」）。钮锚定**块的可视盒**坐标系（内容横滚时钮不动），因此需要新增一层
   零足迹的 slot 包装层（`.cm-lp-codeblock-slot`，照 `.cm-lp-table-slot` 的机制，
   `src/preview/table-trigger.ts`、`src/style.css:993-996`）；该层 SHALL 在 md 模式**无条件存在**
   （折行口径下也要有——否则「折行时没有入口」会变成一条要维护的开关而不是结构性事实）。
   （delta：并入第 1 条的 requirement 与 design.md §4）

3. **全屏内容 = 该代码块的整块源码，按当前折行口径呈现**（裁决点 2 的推荐项）：
   行与 token SHALL 复用文档内代码块的**同一份着色实现与同一批 class**
   （`highlightCode` + `.cm-lp-tok-*` + `.cm-lp-codeblock-line` / `cm-lp-codeblock-head`），
   MUST NOT 为浮层另写一套语言表、色值映射或行样式；块的**首行**在该块带 `CodeMark`（即围栏块的
   起始围栏）时 SHALL 以头部条形态呈现（既有口径：围栏行即头部条、尾围栏是普通代码行；缩进代码块
   没有围栏行，因此没有头部条）；MUST NOT 出现行号、编辑入口或第三套文本布局。
   只读是**结构性**的（浮层内容不在编辑器的 `contenteditable` 子树内、不带事件监听），
   文本保持原生可选可复制。

4. **超限块的呈现边界**：块源码超过既有着色上限 64 KiB 时，浮层以**单块纯文本**呈现整块源码
   （不逐行建 DOM、不着色），源码逐字节一致。理由：本 change 必须给「整块呈现」一条上界，
   而 64 KiB 是仓内既有的、`highlightCode` 已经在用的阈值（`src/preview/code.ts:357`），
   MUST NOT 为全屏另立一个新阈值（REVIEW.md 第 8 条：同一语义不要两处真源）。
   （delta：并入「全屏内容的重建与性能边界」）

5. **折行口径沿用配置，不新增浮层内开关**（裁决点 4 的推荐项）：`code_block_wrap = false`
   （默认）时浮层内行不折行、超长行由浮层容器横向滚动到达；`true` 时行在浮层栏内折行、
   MUST NOT 出现横向滚动。浮层容器的纵向与横向滚动都走原生路径（滚轮 / 触控板 / 方向键），
   MUST NOT 为此新增统一键位表条目。

6. **关闭交互与表格全屏逐条同款**：`Esc`（遮罩上就地消费，不进统一键位表）、点击遮罩
   （面板以外区域）、再次执行 `code-block.toggle-fullscreen`（toggle）、焦点兜底
   （`blur` 关闭且不抢焦点）；四条回同一个 `close`，前三条关闭后焦点交还编辑器。
   遮罩持焦期间 `editor` 作用域的键不穿透、`Tab` 留在遮罩内。

7. **打开与关闭都不碰文档**：`EditorState.doc` 与磁盘文件逐字节不变（ADR 0003 §3）、
   选区与光标落点不变；文档代际变化（外部修改重载）时遮罩按 `blur` 口径关闭且不抢焦点。

8. **本 change 不改代码块的任何既有内联口径**：折行两轴口径、横滚容器、头部条、着色映射、
   缩进代码块的行为、块级 widget 的五条滚动键一律不动；`src-tauri/**` 零改动。

## 须提请 Alex 节点 1 裁决的选项

五项都给了推荐项（推荐项的形态**已经按默认写进 delta**）；若裁决改成备选，delta 与 tasks 按
「备选」列改写，不静默扩 scope。

| # | 裁决点 | 推荐（已写进 delta） | 备选 | 一句话取舍 |
|---|---|---|---|---|
| 1 | 全屏形态 | 应用内全屏遮罩浮层（复用 M240 表格全屏的浮层手法与模态语义，浮层内容 = 该代码块整块源码） | 独立 zen 视图：整窗切到「只看这块代码」的视图态 | 推荐项与两处既有浮层（M184 / M240）惯用语一致、定位在文档流之外（不动文档几何），开合是 O(1) 的层叠动作；zen 视图要动窗口级状态机（标签 × 文档 × 视图态的笛卡尔积），退出还要回答「恢复到哪个滚动位置」，体量与「看一遍这段代码」不匹配（M240 裁决点 1 已否决同款备选，理由逐条适用） |
| 2 | 全屏里呈现什么 | **整块源码**（由源码 + 既有着色实现重建，不随视口截断） | 深克隆渲染 DOM（表格同款）：快照 = 打开那一刻**已渲染**的那些行 | 表格侧克隆是被迫的（cell 里是活源码位置 + 富 inline DOM，重建会丢掉全部 inline 渲染）；代码块侧不同：内容是文本、着色有唯一纯函数出口，重建**不产生第二套呈现口径**，而且是唯一能让长块看到底的路径。取克隆则「放大看长代码」在最需要它的场合失效（CM 按视口渲染，M240 实测 700 行只渲染 49 行）——这是本裁决点真正的取舍 |
| 3 | code 模式（非 md 文件）是否适用 | **不适用**（本版只覆盖 md 模式的围栏 / 缩进代码块） | ① 对 code 模式文件提供「放大查看整份文件」（即 zen 视图，另一个 change）；② 对 code 模式下**选中的行区间**提供放大 | 推荐项是结构性事实：code 模式没有装饰层、没有围栏、没有块对象，也没有容器，连「哪一块」都无从定义（`src/editor.ts:1435-1437`）。放大整份文件是形态问题不是范围问题，且 code 模式今天已有两条现成的放大手段（窗口尺寸 + `view.text-scale-*` 字号步进：字号只有 `--editor-font-size` 一处真源、作用于编辑器内容面，正文 / 代码块 / code 模式同步，`openspec/specs/typography/spec.md:39-41`、`:85`）。如实记录：若 Alex 要的是「任何一段代码都能放大」，那是另一个 change，本 change 不夹带 |
| 4 | 折行 / 横滚在全屏态的口径 | **沿用当前 `editor.code_block_wrap`**（不折行 ⇒ 浮层内横向可滚；折行 ⇒ 浮层栏内折行、无横向滚动），**浮层内不设第二个折行开关** | ① 浮层恒为「不折行 + 横向滚动」（把全屏定义为「自然尺寸呈现」，与表格的「不缩放不压缩」对齐）；② 浮层内提供折行切换钮 | 推荐项守住「配置即数据」（`openspec/project.md`）与单一真源：用户在文档里看到的折行行为与全屏里一致，不出现「同一块代码两处折行不同」的第三种状态，也不新增 chrome 元素。备选①的代价是在浮层里**静默覆盖**用户已表达的偏好；备选②多一个钮 + 一条新状态（且 `view.toggle-code-block-wrap` 是 `editor` 作用域外围的应用运行期命令，浮层持焦时它未必可达，等于还要连带设计可达性） |
| 5 | 入口 | **双入口**（同 D3）：命令 `code-block.toggle-fullscreen` 默认不绑键 + 代码块 hover 触发钮（新增 deck D152） | ① 仅命令（无钮）；② 命令 + 默认绑键 | 推荐项与表格侧的裁决形态一致，两处浮层的可发现性心智成本为零；钮是内容区第二个 chrome 元素，静止态零足迹（照 M235/M240 的实现），基线影响可控。备选①可发现性全靠 ⌘/ 面板的「未绑定」行；备选②永久占掉一个物理组合，本版没有证据表明它是高频动作 |

## Non-goals

- **不做独立 zen 视图 / 新窗口 / 系统预览**（裁决点 1 备选）：与 ADR 0001 单窗口工作台一致。
- **不做 code 模式（非 md 文件）的放大查看**（裁决点 3 备选）：整份文件的专注视图是另一个 change；
  本 change MUST NOT 让 code 模式出现任何新入口或新容器。
- **全屏内不做编辑**：不改代码、不做行号、不做搜索 / 跳转 / 折叠、不做复制按钮
  （原生选中复制即可，浮层 MUST NOT 关掉文本选中）。
- **不做文档内多块导航**（上一块 / 下一块）：会引入跨块状态，是另一个形态（M240 同款非目标）。
- **浮层内不做折行开关**（裁决点 4 备选②）：折行口径只有配置一处真源。
- **不改代码块的任何既有内联口径**：不折行口径、横滚容器、头部条、着色映射、缩进代码块行为、
  widget 五条滚动键一律不动。
- **不新增字节通道**：浮层内容来自文档文本与既有装饰层，不调 `fs_read_attachment`、不动 Rust 侧。
- **不引入新视觉语言**：遮罩、面板壳、配色、圆角、阴影、触发钮形态一律取既有 token 与既有浮层 /
  触发钮配方（`--scrim` / `--preview-bg` / `--border` / `--shadow-raise` / `--r10` / `--code-bg` / `--r8`）。

## capability 归属：为什么是 `editor-live-preview` 的 ADDED

**结论**：新增 requirement 落 `editor-live-preview`（既有 living spec，代码块的渲染 / 折行 / 横滚 /
着色四条既有 requirement 都在那一份里：`openspec/specs/editor-live-preview/spec.md:161`、`:235`、
`:309`）；命令登记落 `keymap-commands`（ADDED ×1，照 `table.toggle-fullscreen`
（`openspec/specs/keymap-commands/spec.md:812-849`）与 `add-toc-outline` 的先例）。本 change
**不新建 capability**。

理由：全屏是「同一块代码的另一种呈现面」——同一份渲染口径、同一份折行判据、同一份着色实现，
与表格全屏归 `editor-live-preview`、图片 lightbox 归 `attachment-display` 同一分工。反方（如实记录）：
若裁决点 2 改取「深克隆切片」，全屏内容与文档渲染的耦合更深，归属结论不变；若裁决点 3 改成
「code 模式也适用」，体量会逼近独立 capability（那时应重新评审归属，而不是在本 change 里硬塞）。

## Impact

- 影响的 specs：`editor-live-preview`（ADDED ×2：「代码块放大全屏查看」+
  「全屏内容的重建与性能边界」）、`keymap-commands`（ADDED ×1：
  「代码块全屏查看命令——code-block.toggle-fullscreen」）。**不改**代码块既有条款
  （折行 / 横滚容器 / 着色 / 缩进块四条不加不减）。
- 影响的代码/系统（实现期；本 mission 零产品代码改动）：新增 `src/code-block-fullscreen.ts`
  （浮层本体：状态机、惰性 DOM、内容重建、就地 `Esc`——与 `src/table-fullscreen.ts` 同级同形）；
  新增 `src/preview/codeblock-trigger.ts`（触发钮 + slot class，照 `src/preview/table-trigger.ts`）；
  `src/preview/livePreview.ts`（slot 包装层、命中判定 `codeBlockAt`、`PreviewContext` 增一个可选口子，
  同 `lightbox()` / `tableFullscreen()` 先例）；`src/editor.ts`（`wrapExtensions` 装 slot 层 +
  ctx 注入）；`src/main.ts`（装配：挂点、`restoreFocus`、命令实现与门）；`src/keys.ts`
  （命令 id + `KEYLESS_COMMAND_IDS`）；`src/style.css`（浮层内容与触发钮的少量规则，零新 token）；
  `文案-Copy.md`（D152 一行 + 文末「文案实现备注」一段）。`src-tauri/**` 零改动。
- 影响的文档：`docs/specs/config-reference.md` 的 `editor.code_block_wrap` 行**不改**
  （折行口径本身不变，只是全屏沿用）；`docs/specs/table-reading.md` 不改（表格侧零改动）。
- 影响的测试/验收：`tests/visual/scenes/` 新增代码块全屏断言组 + fixture；单测新增浮层状态机与
  命中条件用例；`scripts/acceptance/scenarios/` 新增真机场景 **57**（编号声明见
  [tasks.md](tasks.md) §0，已按 M230/M234 协议向 tower 广播登记）。推荐项下静止态零视觉变化
  （钮在 rest 态 `visibility: hidden`，与 M240 同款），预期**零基线更新**；浮层观感截图留
  `test-results/` 供 Alex 过目（同 M184 / M240 口径）。
- 关联约束：ADR 0003 §3（不改写源文件——本能力三层都断言文档逐字节不变）、ADR 0002 §6
  （性能合同——浮层 DOM 惰性建立，打开 / 关闭不在键入路径与文档打开路径上新增工作；
  浮层内容的成本边界见 [design.md](design.md) §6）、ADR 0002 §3（webview 不直接访问文件系统）、
  ADR 0006（Emacs keybinding PKM —— 命令入口与之同向，推荐项下键盘入口默认不绑键）、
  ADR 0004 第 5 条（功能变更走 OpenSpec）、`openspec/project.md`（配置即数据）。
- 性能：打开 = 一次按块源码长度的行 / token 构建 + 一次层叠显隐，O(块源码)；**不在**键入路径与
  文档打开路径上（`EditorState` 与装饰层零改动，视口增量义务不变）。实测项与读数落点见
  [tasks.md](tasks.md) §2；超过「用户主动动作可感知」档时如实记为已知边界并另立 finding
  （M240 §2.4 的同款纪律）。
- 与在飞 change 的关系（如实记录）：`ui-language-i18n`（M267）正在改界面语言口径，本 change 新增的
  读屏名 / 钮标签（D152）按现役 deck 的写法取中文，**若 M267 的裁决改了这类标签的语言口径，
  D152 随同一条裁决走**——它是文案条目，不是结构决定（见 [design.md](design.md) §9）。
