# Design: code-block-fullscreen

形态总览（推荐项）：caret 在 md 模式的一块围栏 / 缩进代码块内（或该块的横滚容器持焦、或经块上的
hover 触发钮）时执行 `code-block.toggle-fullscreen`，打开应用内全屏遮罩，内容 = **该块的整块源码**，
按当前 `editor.code_block_wrap` 口径呈现；关闭语义与 M240 表格全屏逐条同款。本文件给出
现状锚点、内容的来源取舍、入口接线、tokens/三主题、性能与内容边界、被否决方案与风险。
所有锚点按本 mission 的 base tip `6e9f024` 核对（2026-09-27）。

## 1. 现状锚点：代码块今天是什么

### 1.1 渲染：行装饰 + 头部条 + 纯函数着色，容器是块级横滚层

- **块发现与块级容器**：`codeBlockWrappers`（`src/preview/livePreview.ts:370-400`）在
  `tableDiscoveryRange`（视口 ± max(首行长 × 2, 2048)，`:224-230`）范围内遍历语法树，
  对每个 `FencedCode` / `CodeBlock` 出一个 `BlockWrapper`（rank 10）：
  `class="cm-lp-block-scroll cm-lp-codeblock-scroll"`、`role="region"`、
  `aria-label="Markdown 代码块 ${index}"`、`tabindex="0"`；范围按**整行**取（起点对齐行首、
  终点对齐末行行尾），与表格容器同口径。
- **容器是有条件的**：`src/editor.ts:1131-1133` ——
  `if (mode === "md" && !settings.codeBlockWrap) extensions.push(EditorView.blockWrappers.of(codeBlockWrappers))`。
  折行口径打开时**没有任何容器**，也没有任何 AX region（spec 的「折行渲染与代码块横滚容器」
  明文要求那种口径下 MUST NOT 出现块内横滚容器，
  `openspec/specs/editor-live-preview/spec.md:309-352`）。
- **行与头部条**：`FencedCode` / `CodeBlock` 的每一行出一个 line 装饰，class
  `cm-lp-codeblock-line`；块的首行在**有 `CodeMark`**（围栏行）时额外挂 `cm-lp-codeblock-head`
  ——「围栏行即头部条」，语言标记是围栏行自己的文字，不另造 DOM 元素
  （`src/preview/livePreview.ts:1004-1015`；样式 `src/preview/theme.ts:238-260`）。
  缩进代码块没有围栏行 ⇒ 没有头部条。
- **着色**：`collectCodeTokens`（`src/preview/livePreview.ts:799-816`）取 `CodeText` 子节点的
  文本与 `CodeInfo`（info string），调 `highlightCode(code, info)`，为每个 token 出一个
  `Decoration.mark({ class: token.cls })`——**装饰按视口裁剪**（`:812-813`），但
  `highlightCode` 的输入是**整块文本**、结果按「语言 + 原文」缓存
  （`src/preview/code.ts:436-447`，`CACHE_LIMIT = 32`）。token class 是 `cm-lp-tok-<role>`
  （`comment / keyword / string / literal / property / type`，`src/preview/code.ts:233-263`）。
- **着色上限**：`MAX_HIGHLIGHT_CHARS = 64 * 1024`（`src/preview/code.ts:357`）——超过即
  `highlightCode` 返回空表、回落纯文本渲染；**块本身照常渲染，没有降级文案，也没有「无入口」**
  （与表格 64 KiB 整块降级为源码是**不同的**口径，`docs/specs/table-reading.md` §1 只管表格）。
- **重算时机**：`ViewPlugin` 在 `docChanged / selectionSet / viewportChanged / 语法树变化 /
  forced` 时重建装饰（`src/preview/livePreview.ts:539-563`）。

### 1.2 折行口径：两轴四组合，代码块那一轴的决定落在容器存不存在

`editor.code_block_wrap`（Rust 真源 `src-tauri/src/config.rs:112`，默认 `false`，`:151`；
TS 侧默认 `src/preview/theme.ts:52`；运行期命令 `view.toggle-code-block-wrap`，
`src/editor.ts:1835-1837`、`src/keys.ts:238`/`:281`）。它的作用面只有 md 模式
（`src-tauri/src/config.rs:109-111` 的 doc comment 明写「对非 md 文件无可观测效果」）：

| `code_block_wrap` | 块内行 | 块级横滚容器 |
|---|---|---|
| `false`（默认） | 不折行（`.cm-content.cm-lp-codeblock-nowrap .cm-line.cm-lp-codeblock-line { white-space: pre }`，`src/preview/theme.ts:262-266`） | 存在（`.cm-lp-block-scroll` 的 `overflow-x: auto`，`src/style.css:953-963`、`:978-986`） |
| `true` | 折行（`… .cm-lp-codeblock-wrap … { white-space: break-spaces }`，`src/preview/theme.ts:269-273`） | **不存在**（`src/editor.ts:1131-1133`） |

**关键机制事实**（本 change 的设计直接踩在这两条上）：

1. 两个折行 class 挂在 `.cm-content` 上（`EditorView.contentAttributes`，
   `src/editor.ts:1125-1129`），**规则的选择器前缀也是 `.cm-content`**
   （`src/preview/theme.ts:34-42` 的注释写明这是为了压过基础主题的 `.cmLineWrapping`）。
   ⇒ 任何脱离 `.cm-content` 的容器都不会自动获得这两条口径，**必须显式处理**
   （这正是 M240 design §2 实测到的「CM 主题 scope 到编辑器根」那一类问题的同族）。
2. 容器存在与否决定了「块的可视盒」有没有 CSS 盒子。**折行口径下没有任何块级元素可挂触发钮**
   ⇒ 触发钮若照搬表格的 `Decoration.widget` + 包含块手法，需要**新增一层与折行无关的 slot 层**
   （§4.2）。

### 1.3 模式与可编辑性（本 change 的作用面只有一半）

`modeForPath` 按扩展名裁决模式（`src/editor.ts:1111-1114`）；md 模式 = 高亮 + live preview 装饰层，
code 模式 = 仅高亮（`src/editor.ts:1435-1437`，`openspec/specs/editor-live-preview/spec.md:816-830`
的「单内核双模式与可编辑性落地」）。可编辑性与模式正交（`isEditablePath` 判定）。**code 模式没有
围栏渲染 ⇒ 没有块对象**，本 change MUST NOT 在 code 模式产生任何容器、入口或提示
（与 `code_block_wrap` 对 code 模式的「无作用对象」同一口径）。

### 1.4 命中判定的既有零件

- **「某位置是否属于代码块」**：`codeblockOnLine`（`src/preview/livePreview.ts:750-764`）——
  从行的首个非空白字符 `resolveInner` 后逐级上溯父节点找 `FencedCode` / `CodeBlock`。
  今天只在块间分隔样式中使用（`:733-738`），模块私有。
- **块本身**：块的范围需要另取（`codeblockOnLine` 只回答「在不在块里」）；块序数（读屏名里的 N）
  今天是 `codeBlockWrappers` 内部的 `index++`（视口有界遍历的产物）。
  ⇒ 实现期需要一个与装饰层**同一遍历、同一范围**的 `codeBlockAt(view, pos)` 返回
  `{ from, to, index, info }`，MUST NOT 另写一份语法树遍历（REVIEW.md 第 8 条）。
- **表格侧的对应零件**（形态参照）：`tableFullscreenTarget`（`src/preview/livePreview.ts:335-351`）
  ——容器持焦 / caret 在 grid 表内两条入口，返回 `{ table, label }`。

### 1.5 浮层先例（本 change 的零件箱，逐条对齐）

- **M240 表格全屏**：`src/table-fullscreen.ts`（状态机 `createTableFullscreenState`、
  四条关闭路径回同一个 `close`、惰性建 DOM、就地 `Esc`）；CSS `src/style.css:1300-1343`
  （遮罩 `--scrim` + 居中面板壳 `--preview-bg`/`--border`/`--shadow-raise`/`--r10`，
  壳内 `overflow: auto` 双向滚动，`[hidden]` 显式补回，eink 无阴影 + 1.4px 黑框）；
  读屏名复用源元素的既有标签，MUST NOT 另写字面量（`src/table-fullscreen.ts` 文件头）。
- **M235/M240 触发钮**：`src/preview/table-trigger.ts`——slot 层（rank 20）`position: relative`
  当包含块、钮是 `Decoration.widget` + `position: absolute`、静止态
  `opacity: 0; visibility: hidden`（不进读屏树、不接收指针）、hover 可视盒才浮现、
  eink 白底黑框 + 热态反白（CSS `src/style.css:1007-1049`）。
- **命令机制**：`KEYLESS_COMMAND_IDS`（`src/keys.ts:277-285`）+ 键位面板「未绑定」行（D66 口径）
  + 命令级门 `KeymapContext.commandGate`（`src/main.ts:917-927` 的表格实现）。

## 2. 内容来源：由源码整块重建（裁决点 2 的推荐项）

### 2.1 为什么不是「克隆渲染 DOM」

表格侧克隆是被**渲染形态**逼出来的：cell 内容是文档的活源码位置（line/mark 装饰，不是 replace
widget），cell 里的链接 / 行内代码 / 图片都已是渲染好的 DOM，从源码重建会丢掉全部 inline 渲染——
那才是「同一张表两套呈现口径」（`archive/2026-09-27-table-fullscreen-view/design.md` §2）。
代码块**不具备这个性质**：它的渲染产物是「行 + token 着色 + 头部条」，而三者都有可复用的单一出口
（行 / 头部条的 class 与 `highlightCode` 的 token class）——重建**不引入第二套呈现口径**。

反过来，克隆有一个对代码块**致命**的代价：DOM 里只有**已渲染的视口**那一部分。
M240 实测 700 行的表在浏览器里只渲染 49 行、未渲染区以 `.cm-gap` 占位
（`archive/2026-09-27-table-fullscreen-view/tasks.md:205`、`design.md` §6）。表格把这条如实记成
已知边界（「完整快照需要另一条渲染路径，是另一个 change」）；对代码块，**那条「另一条渲染路径」
就是本节**——一个纯函数（`highlightCode`）加一次按行的文本切分，成本极低，而收益是把
「放大看长代码」这件事变成真的。取克隆则全屏在长块上看到一个死胡同（渲染到 `.cm-gap` 就没了），
恰恰在本能力最需要它的场合失效。

### 2.2 重建的口径（写进 delta 的硬约束）

- **内容 = 块的整块源码**：`doc.sliceString(node.from, node.to)`，按行切分；
  围栏行（有 `CodeMark` 时）以**头部条**形态呈现，其余行以代码行形态呈现——与文档内同一口径
  （`src/preview/livePreview.ts:1004-1015`）。缩进代码块没有头部条。
- **着色**：`highlightCode(codeText, infoString)`——与文档内**同一个函数、同一份语言表、
  同一份缓存**（`src/preview/code.ts:436-447`）。token 落 `cm-lp-tok-*` class，与文档内同名。
- **行样式**：复用既有 class 名（`cm-lp-codeblock-line` / `cm-lp-codeblock-head`）与既有规则，
  MUST NOT 在 `src/style.css` 为浮层另写一套行样式或第二份色值映射。落地手段沿用 M240 已验证的
  **主题 scope 镜像**（`mirrorThemeScope`，`src/table-fullscreen.ts:157-167`）：把源编辑器根上的
  非 `cm-` 生成类镜像到浮层内容容器上，使 CM 注入的主题规则重新命中；容器同时显式补齐
  字体 / 字号 / 行高（取 `--editor-mono-family` / `--editor-font-size` / `--lh-code` 这些
  编辑器作用域 token，与运行期字号步进同源）。
- **只读是结构性的**：重建出的节点不在编辑器的 `contenteditable` 子树内、不带事件监听、
  不接 CM 的任何 API ⇒ 没有编辑路径可言，不是一条要维护的开关。文本 SHALL 保持原生可选可复制
  （MUST NOT `user-select: none`）——「只读」不等于「不可选」。
- **不含任何编辑器运行态**：没有光标 / 选区层、没有 `.cm-gap`、没有触发钮
  （钮是文档 DOM 里的 widget，重建路径天然不带它——比克隆路径少一类卫生处理）。
- **文档代际与快照语义**：内容取自**打开那一刻**的 `EditorState`；遮罩持焦期间编辑键不穿透，
  文档只可能因外部修改重载而变化——那条走 `blur` 兜底关闭（§5），不留「浮层里是旧代码」的状态。

### 2.3 被否决的第三条路（写在案）

**搬动原 DOM 节点进浮层**：CM 装饰 DOM 归 CM 管，搬走会让编辑器布局与装饰状态脱节
（M184 否决「搬 `<img>`」的同款理由）。**起第二个只读 EditorView**：要把装饰层、键位、
附件通道再装配一遍，与「单内核」定位摩擦（M240 裁决点 2 备选已按同款理由否决）。

## 3. 浮层本体与 tokens（三主题一致）

- **根**：`position: fixed; inset: 0; z-index: 20; background: var(--scrim)` + 显式补回
  `[hidden]`（author `display` 盖 UA 规则的坑，M240 同款）。
- **面板壳**：浮层配方 = `--preview-bg` + 1px `--border` + `--shadow-raise` + `--r10`；
  尺寸上限 = 遮罩可用区域减内边距（`padding: var(--sp-12)` 的 flex 内容盒）；壳内 `overflow: auto`
  承载双向滚动。eink：无阴影、边框升级 1.4px 实心黑。
- **内容容器**：`--code-bg` 底板 + `--r8` 圆角（与文档内 `.cm-lp-codeblock-scroll` 同一视觉语言，
  `src/style.css:978-986`）；水平方向按「自然宽」（不折行口径）或「栏内折行」（折行口径）呈现。
  内容宽度的取值口径：面板宽 = 遮罩可用宽（窗口宽 − 2 × `--sp-12`），**明显大于**阅读栏默认
  760px（`src-tauri/src/config.rs:183`）——这是本能力在折行口径下仍然有价值的来源。
- **语义**：`role="dialog"` + `aria-modal="true"` + `tabIndex=-1` + 打开即 `focus()`；
  读屏名由**与文档内容器同一份生成处**产出（`Markdown 代码块 ${index}`，
  单一来源是一个函数而不是第二份字面量——理由见 §4.1：折行口径下文档里根本没有那个带
  `aria-label` 的容器，读屏名不能靠「从源元素现取」）。
- **零新 token、零组件级新增色值**；三主题由 token 体系自然成立。

## 4. 入口接线（推荐项：命令 + hover 触发钮）

### 4.1 命令

- id `code-block.toggle-fullscreen`，进 `COMMAND_IDS` / `GLOBAL_COMMAND_IDS`，登记
  `KEYLESS_COMMAND_IDS`（**默认不占键位是要签字的决定**，本版没有证据表明它是高频动作，
  M180 / M240 先例），`doc` 字段写明作用域取 `global` 的理由（同 `toc.toggle`）。
- 命中条件由**命令级门**承担（`KeymapContext.commandGate`，M240 实现期定稿的理由逐条适用：
  绑定层的 `when` 拿不到编辑器状态，`[keys]` 覆盖产出的绑定没有 `when` 字段）：
  ① 遮罩已开 → 关闭（toggle）；② caret 在 md 模式的一块围栏 / 缩进代码块内
  （`codeblockOnLine` 的既有判定 + `codeBlockAt` 取块）；③ 该块的横滚容器持焦
  （`isWidgetKeyTarget` 同款的 DOM 判定，`src/keys.ts:323-328`）。
  条件不满足时不消费事件（不 `preventDefault`）。
- **折行口径下的第 ③ 条自然为假**（没有容器）——「折行时没有容器入口」是结构性事实，
  MUST NOT 用一条开关模拟；②始终成立，因此入口不会被折行口径吞掉（写进 scenario 的正观测）。

### 4.2 触发钮与 slot 层

- **slot 层**：新增 `.cm-lp-codeblock-slot`（BlockWrapper，rank 20，`position: relative`，
  零背景 / 零边框 / 零内外边距），**在 md 模式无条件存在**——包括折行口径
  （否则钮在折行时无处可挂，会退化成「折行时没有鼠标入口」这条要维护的差异）。
  机制与理由逐条照 `.cm-lp-table-slot`（`src/preview/livePreview.ts:265-275`、
  `src/style.css:993-996`）。
  **与既有容器的关系**：slot（rank 20）在外、横滚容器（rank 10）在内，折行口径下内侧那层不存在，
  slot 仍在——两层相互独立，折行开关只影响内侧那一层。安装路径（`modeExtensions` 或
  `wrapExtensions`）由实现期按 Compartment 边界决定，不变量只有一条：**两种折行口径下 slot 都在**。
- **钮**：`Decoration.widget`（inline point widget，挂在块的**首行行首**），
  `position: absolute; top: 6px; right: 6px`，最近的定位祖先是 slot ⇒ 横滚内容时钮不动
  （「别抄成跟着内容滚」，M235 的实现期交接）。四角框字形、静止态 `visibility: hidden`
  （不进读屏树、不接收指针、不进任何整页基线）、hover 块的可视盒才浮现、`mousedown`
  先 `preventDefault`（不扰动 caret）、eink 白底黑框 + 热态反白——逐条照
  `src/preview/table-trigger.ts` 与 `src/style.css:1007-1049`；钮的视觉形态沿用同一份划稿
  （`design/prototypes/table-fs-trigger/` 的 `inside-corners-hover`），MUST NOT 为代码块另起一套
  图标或出现时机（同一动作在两处两副面目正是本仓库要防的漂移）。
- **读屏名**：新 deck 条目 **D152「放大查看代码块」**（与 D124「放大查看表格」同族）。
  **浮层自己的读屏名不在这里**：它复用 `Markdown 代码块 N` 的同一生成处（§3）。

### 4.3 装配

照 M240：`PreviewContext` 增一个可选口子（`codeBlockFullscreen()`，未接线返回 `null`，
与 `lightbox()` / `tableFullscreen()` 同口径），`src/main.ts` 建浮层（挂点 `shell.root`、
`restoreFocus: () => editor.view.focus()`）并注入。`src/editor.ts` 的 ctx 注入点与
`wrapExtensions` 各加少量行（scope 说明：这两个文件在 M240 曾按同一理由扩入 scope，
本 change 的 Impact 清单已含它们）。

## 5. 关闭路径：与 M240 逐条同款

| 路径 | 落点 | 与 M240 的关系 |
|---|---|---|
| `Esc` | 浮层上就地消费（`keyToken` 归一化 + `preventDefault`）；**不进统一键位表**（`Esc` 已归 `editor.widget-escape`，同 token 第二条绑定被构造期拒绝） | 同款 |
| 点击遮罩（面板外区域） | 遮罩 `mousedown`：`event.target === overlay` 时关闭，**先 `preventDefault`**（否则 `blur` 先关掉它、`restoreFocus` 被吃掉） | 同款 |
| 再次执行 `code-block.toggle-fullscreen` | 命令层（global 作用域的理由，§4.1） | 命令入口的自然对偶 |
| 焦点兜底（`blur`） | 关闭且**不抢焦点**；兜住「另开面板 / 窗口失活 / 文档代际变化」 | 同款 |

四条回同一个 `close(reason)` 单入口。持焦期间：`editor` 作用域键不穿透、`Tab`/`⇧Tab` 留驻；
浮层内滚动走**原生**路径（滚轮 / 触控板 / 方向键在可滚动焦点元素上原生滚动，不占统一键位表）。
打开与关闭前后：`EditorState.doc` / 磁盘文件逐字节不变、选区与 caret 逐值不变（ADR 0003 §3）。

## 6. 内容边界与性能

- **不在键入 / 打开路径上**：本 change 不改装饰层的重算时机与范围（`ViewPlugin` 的
  视口增量义务不变，`src/preview/livePreview.ts:539-563`），浮层 DOM 惰性建立（首次打开时建）。
  ADR 0002 §6 的「打开 1MB <100ms」「keypress-to-paint <16ms」不因此放宽。
- **打开成本 = O(块源码长度)**：一次按行的 DOM 构建 + 一次 `highlightCode`
  （**后者文档内已在做**：`collectCodeTokens` 对整块文本调 `highlightCode`，
  只把装饰按视口裁剪，`src/preview/livePreview.ts:812-813`；结果还命中同一份缓存
  `src/preview/code.ts:436-447`）。⇒ 打开成本里**新增的部分只有 DOM 构建**。
- **内容上界（本 change 新立的一条，且复用既有阈值）**：块源码 ≤ 64 KiB 时按「行 + token」呈现
  （节点数与块长线性，token 数与 `highlightCode` 的输出同规模）；> 64 KiB 时以**单块纯文本**
  呈现整块源码（`textContent` 一个文本节点，不逐行建 DOM、不着色、行样式由浮层容器承担）。
  **为什么必须是 64 KiB**：本 change 要求「整块」，而代码块**没有**表格那条
  「>64 KiB 整块降级、无 DOM、无入口」的天然上界——不设界就等于给一个 5 MiB 的围栏块
  开一条「打开即构造百万节点」的路。64 KiB 是仓内**既有**的着色阈值
  （`src/preview/code.ts:357`），复用它而不是另立新阈值，是 REVIEW.md 第 8 条的要求；
  代价（超限块的头部条与行样式退化）如实写进已知边界。
- **实测项**：近上限夹具（≥60 KiB 源码的块）的打开耗时与 DOM 规模读一次并落
  `test-results/`，写进实现 PR；超出「用户主动动作可感知」档时如实记为已知边界并另立 finding，
  MUST NOT 宣称「无成本」（M240 2.4 的同款纪律）。
- **零新增字节通道**：内容取自 `EditorState` 文本，不调 `fs_read_attachment`，`src-tauri/**` 零改动。

## 7. 与既有交互的边界（逐条核对，防误伤）

| 交互 | 关系 | 依据 |
|---|---|---|
| 块级横滚容器 + 五条 widget 键（`←` `→` `Home` `End` `Escape`） | **不变**：浮层容器 MUST NOT 带 `cm-lp-block-scroll`（否则 `isWidgetKeyTarget` 会把浮层里的方向键判给 widget 路径，与浮层自己的滚动语义打架）——浮层滚动走原生路径 | `src/keys.ts:310-328`、`src/preview/livePreview.ts:410-430` |
| `code_block_wrap` 的全部既有行为 | **不变**：浮层只是**读**这个口径；折行开关翻转时不回写、不重建浮层（若掩罩开着且配置被翻转，行口径按打开那一刻的快照呈现——与「快照 = 打开那一刻」同一语义） | `src/preview/theme.ts:262-273`、`src/editor.ts:1125-1133` |
| 代码块着色与头部条 | **不变**：浮层复用同一函数与同一批 class | §2.2 |
| 图片 lightbox / 表格全屏 | **同形不共享状态**：三处浮层没有互斥注册表；浮层持焦时 `⌘/` 等 global 命令照常生效，新层抢焦点 → 本浮层 `blur` 退场（既有口径） | `src/lightbox.ts`、`src/toc.ts:360-367` |
| 缩进代码块 | **可变大**，但按既有口径呈现（没有围栏行 ⇒ 没有头部条；没有 info string ⇒ 不着色）——不新立规则 | §1.1 |
| code 模式 / 非 md 文件 | **无关**：没有装饰层、没有块对象；本 change 为它加零个容器、零个入口、零条提示 | §1.3 |
| 选区显露 | 代码块不在显露覆盖集内，不加不减 | `openspec/specs/editor-live-preview/spec.md` 的「live preview 装饰层」 |
| 保存链路 | 打开与关闭不改写文档；浮层持焦时 `⌘S` 是 global 命令、照常生效（与 M184 / M240 一致） | ADR 0003 §3 |
| 多标签 | 浮层是窗口级层，随当前标签的文档；切标签抢焦点 → `blur` 退场 | `src/keys.ts` 标签命令 |

## 8. 备选方案与拒绝理由

| 方案 | 拒绝理由 |
|---|---|
| 独立 zen 视图（裁决点 1 备选） | 窗口级视图态 × 标签 × 文档的笛卡尔积；退出要回答「恢复到哪个滚动位置」；体量与「看一遍这段代码」不匹配。列进裁决点表交 Alex 决定 |
| 深克隆渲染 DOM（裁决点 2 备选） | 内容只含已渲染的视口切片 ⇒ 长块在全屏里是死胡同（CM 按视口渲染），恰在本能力最需要它的场合失效；而它在表格侧被选择的唯一理由（保 inline 渲染）对代码块不成立。列进裁决点表 |
| 浮层恒不折行 + 横向滚动（裁决点 4 备选①） | 在浮层里静默覆盖用户已表达的折行偏好，出现「同一块代码两处口径不同」。列进裁决点表 |
| 浮层内加折行切换钮（裁决点 4 备选②） | 多一个 chrome 元素 + 一条新状态；折行口径会有第三个真源。列进裁决点表 |
| code 模式也支持放大（裁决点 3 备选） | code 模式没有块对象；「放大整份文件」是 zen 视图那一族。列进裁决点表 |
| 搬动 CM 装饰 DOM 进浮层 | 破坏编辑器布局与装饰状态（M184 同款否决） |
| 起第二个只读 EditorView | 装饰层 / 键位 / 附件通道再装配一遍，与单内核定位摩擦（M240 裁决点 2 同款否决） |
| 全屏内容按视口切片 + 「已渲染到这里为止」提示 | 一条提示不能把死胡同变成可用；且它把 CM 的实现细节（视口渲染）暴露成用户可见文案 |
| 为超限块另立新阈值（如 128 KiB / N 行） | 同一语义两处真源（REVIEW.md 第 8 条）；64 KiB 是既有阈值且正是「着色停用」的那条线 |
| 把 `Esc` 写进统一键位表 | 「一个 token 一条绑定」不变量（M240 同款否决） |
| 浮层容器复用 `cm-lp-block-scroll` class | 键位层的 widget 判定按那个 class 认容器（`isWidgetKeyTarget`），复用会让浮层里的方向键被判给 `editor.widget-scroll-*`，与浮层自身的原生滚动语义打架 |

## 9. 风险与未决点

| 项 | 状态 | 处置 |
|---|---|---|
| 重建后的观感与文档内不一致（字体 / 行高 / 头部条 / 底板） | 已知风险（M240 实测过同族：CM 主题整批 scope 到编辑器根） | 复用 M240 已验证的「镜像主题 scope 类 + 容器补编辑器作用域 token」机制；守卫是计算样式断言（文档内块 vs 浮层内容逐项对照），M240 5.4 同款 |
| 浮层内容容器的行样式会不会成为第二份真源 | 设计上已收口（复用既有 class 与既有规则） | 视觉断言钉住计算样式；若实现期发现必须新写行样式，回来改 design 而不是就地复制 |
| 触发钮进整页基线（内容区第二个 chrome 元素） | 可判 | 静止态 `visibility: hidden`（M240 零基线变化的同款机制）；基线核对按 REVIEW.md 第 3 条逐张走内容判据 |
| 超限块（>64 KiB）的观感退化（无头部条 / 无行样式） | 设计决定 | 写进 spec 已知边界与 PR；若要更好的呈现，是另一个 change |
| 打开成本在近上限夹具上超「可感知」档 | 未测 | §6 的实测项；超档则如实记为已知边界 + finding，不押优化 |
| `codeBlockAt` 与装饰层的索引口径漂移（读屏名里的 N） | 已知风险 | 单一遍历：块序数 SHALL 由与装饰层同一范围的同一函数产出（REVIEW.md 第 8 条），单测钉住 |
| 折行口径下「容器持焦」这条入口不存在 | 设计决定（结构性） | 写进 spec 正文与 scenario 的正观测（caret 入口在两种口径下都成立） |
| D152 与在飞 `ui-language-i18n`（M267）的语言口径 | 跨 change 相依 | 本 change 按现役 deck 写法取中文读屏名；M267 若改了这类标签的语言口径，D152 随同一条裁决走（改一个常量 + deck 一行） |
| 浮层内文本的复制体验（长块跨屏选中） | 归 Alex dogfood | 套件只留截图；手感/观感不下沉（AGENTS.md 分工） |

## 10. 验收面（与 tasks.md 对应）

- **合同层**：`editor-live-preview` 增量两条 + `keymap-commands` 增量一条，逐条落 scenario。
- **单测层**：浮层状态机（四条关闭路径回同一 `close`、toggle、文档代际关闭）、命中条件
  （caret 在块内 / 块外 / 两种折行口径 / 容器持焦 / 浮层已开），内容重建的纯逻辑
  （源码 → 行 / token 切分、>64 KiB 退化分支、围栏行判定）。
- **视觉层（chromium，CI 结构层 + 本地像素层）**：打开 / 三条关闭 / toggle、不穿透与 `Tab` 留驻、
  内容保真（文本逐字节 + 计算样式）、折行两口径（不折行 ⇒ `scrollWidth > clientWidth`；
  折行 ⇒ 无横向滚动）、长块不截断（含超出视口的部分）、>64 KiB 退化分支、
  缩进代码块可变大、code 模式无入口（负向断言配正观测，REVIEW.md 第 2 条）、
  文档与选区逐值不变；反向验证（关掉 scope 镜像 / 关掉命中的块判定）各留红灯证据。
- **真机层（WKWebView）**：场景 **57**（草案见 [tasks.md](tasks.md) §6）。
- **不改写源文件**：三层都断言 `EditorState.doc` / 磁盘逐字节不变（ADR 0003 §3）。
- **基线**：推荐项下静止态零视觉变化（slot 层零足迹 + 钮 rest 态不绘制），预期零基线更新；
  浮层观感截图留 `test-results/` 请 Alex 过目（基线更新是人肉裁决点，`tests/visual/README.md`）。
