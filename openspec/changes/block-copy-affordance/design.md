# Design: block-copy-affordance

技术方案与权衡。proposal 写「做什么」，本文写「怎么落、以及哪些地方会咬人」。

## 0. 一句话方案

在既有的**块级装饰层**上，为「渲染为 grid 的表」与「围栏 / 缩进代码块」各挂一个 hover 触发钮
（复制），与 M240 的放大钮组成右锚定按钮群；点击时从 **EditorState 的文档文本**切出该块的内容写进剪贴板，
反馈走既有 toast。零新 token、零后端、零配置。

## 1. 现状机制（实现期的落点，逐条可复核）

| 机制 | 现状 | 本 change 怎么用 |
|---|---|---|
| 触发钮的坐标系 | 表格侧有 rank-20 的 `.cm-lp-table-slot`（`position: relative`），钮是 grid 子树里的绝对定位 widget，包含块落在横滚容器**之外** ⇒ 内容横滚时钮不动 | 原样沿用；代码块侧复制该层（见 §2.4） |
| 形态纪律 | `.lumir-table-fs-trigger` 把壳 / 尺寸 / 时机 / eink 逐值写在 `src/style.css`，来源是 M235 划稿的推荐档 | 抽成共享类（见 §2.2），表格侧类名与位置**不动** |
| 装饰层注入口 | `PreviewContext` 里 `tableFullscreen()` 是「能力提供者」形状：未接线返回 null，钮仍在、点了没反应（`src/preview/livePreview.ts:57-75`） | 增一个同形状的口子 `blockCopy()` |
| 剪贴板 | `navigator.clipboard.writeText` + 失败 toast，真机场景 47 有逐字断言（M244） | 原样复用，不引插件 |
| toast | `src/main.ts:199` 的 `toast(text, actions, sticky, tone)`，成功 tone 给 ✓ 前缀 | 成功用 `success`，失败用默认 neutral |
| 命令族 | `table.toggle-fullscreen` = 命令级命中条件（`KeymapContext.commandGate`）+ `KEYLESS_COMMAND_IDS` 登记 + 面板「未绑定 + 成因」行 | `block.copy` 照抄这一套（若裁决点 5 取推荐项） |

**为什么复制钮必须由装饰层挂、不能由 CSS 造**：块的存在判据（是不是 grid 表、块内有没有源码行）只有
装饰层知道；CSS 只能对 DOM 反应，会在降级表 / mermaid 图表态上造出「有钮但点了没东西可复制」的形态。

## 2. 按钮群：共存方案

### 2.1 几何（不变量）

```
块的可视盒（表格 = 横滚容器的可视区；代码块 = 内容容器）
┌──────────────────────────────────────┐
│                      [复制][放大] ← top: 6px
│   ┌─────────┬─────────┬─────────┐    │      right: 6px（放大，M240 现状）
│   │         │         │         │    │      复制 = 放大左侧 4px ⇒ right: 36px
└───┴─────────┴─────────┴─────────┴────┘
```

- 放大钮：`top: 6px; right: 6px`，26×24 —— **M240 已实现的现状，本 change 一字不动**（位置、类名、
  断言选择器、图标、读屏名全不变）。
- 复制钮：`top: 6px; right: 36px`，26×24，与放大钮**间隙 4px**（26 + 4 + 6 = 36）。
- 组内次序：自左至右「复制 → 放大」。选「放大贴角」而不是「复制贴角」的判据只有一条：
  放大钮已经落地并占着角落，把它挪走要动已实现的几何、既有视觉断言与基线；往左长一格是零搬移。
- **窄块的位置事实**：锚点是 slot 右缘（= 栏宽右缘），**不随表格自然宽收缩**——窄表的钮本来就不压在
  表上，而是悬在表右侧的内容区上方（M235 的 NOTES 已如实记过单钮版的这一条）：
  `src/preview/livePreview.ts` 的 slot 是 rank-20 的 BlockWrapper，宽度是栏宽而不是表格自然宽。
  组宽翻倍到 56px 只是把这块悬空加宽 30px，仍满足「hover 期间才出现、移开即还」；本 change 不为此另造形态
  （例如按表格自然宽定位钮会引入「钮位置随内容宽度变」的第二套口径，代价大于这点观感）。

### 2.2 CSS 结构：抽共享类，但不动既有类名

三处（表复制 / 代码块复制 / 代码块放大）与既有的一处（表放大）是同一个形态的四个消费者，
照抄四遍就是 REVIEW.md 第 8 条的形态。做法：

- 新增共享类 `.lumir-block-trigger`：装 §1 表里那套形态纪律（壳、尺寸、圆角、图标色与热态、
  过渡、`opacity/visibility` 的出现时机、eink 两条规则、`focus-visible` 浮现）。
- 既有 `.lumir-table-fs-trigger` 与新增的 `.lumir-block-copy-trigger` 各只保留**位置偏移**，
  并且它们的元素**同时带共享类**（`class="lumir-block-trigger lumir-table-fs-trigger"`）。
- 好处：既有选择器（`tests/visual/scenes/m240-table-fullscreen*.spec.ts` 的 `.lumir-table-fs-trigger`
  定位、`:root[data-theme="eink"]` 分支）逐字继续有效——元素仍带 `.lumir-table-fs-trigger`，
  只是**规则来源**从该 class 换到共享 class，计算值与静止态像素都不变（钮在静止态 `visibility: hidden`，
  本就不在任何整页基线里）；坏处是类名有两层——以「形态一处、位置各一处」的分工换回来，
  写进代码注释即可。既有 eink 规则与 `:hover` / `focus-visible` 那条浮现规则一并搬到共享类
  （MUST NOT 两处各留一份）。

### 2.3 与 code-block-fullscreen（M262）的共存与**落地次序**

M262 会给代码块加放大钮，本 change 会给表格与代码块加复制钮——两者都会在代码块上出 hover 钮。
共用约定（写进 delta，先落地者建立、后落地者并入）：

1. **一组一钮位**：一个块上只有一个动作钮群，组成员按「复制在左、放大在右」排；MUST NOT 各挂各的、
   各定各的偏移。
2. **零搬移**：后落地者把自己的钮放进**最终位置**，MUST NOT 挪动已落地的钮。
   - 表格侧：M240 已落地 ⇒ 放大贴角，本 change 的复制固定 `right: 36px`（无过渡形态）。
   - 代码块侧（两种次序都成立）：**先落地者占角（`right: 6px`），后落地者落在左（复制）/ 补到角（放大）**。
     若本 change 先落地，代码块上会短暂只有「复制」一个钮、离角 36px（视觉上略向内缩）；
     M262 落地时把放大补到角落，本题的钮一动不动。若 M262 先落地，本 change 的复制直接落在其左侧。
     这个过渡形态是落地次序的必然产物，如实记录，不为它加兼容分支。
3. **宿主层共享**：两边都需要「包含块在横滚容器之外」的 slot。表格侧已有 `.cm-lp-table-slot`；
   代码块侧由先落地者建立（本 change 的 §2.4 就是它），后落地者复用，MUST NOT 再套一层。
   （两层 rank-20 嵌套在几何上是等价的，但它会让「零足迹」这句话失去可核对性。）
4. **偏移常量只写一次**：组内次序、间隙、锚点写在**一个**位置（共享类比或常量模块），
   两边 import 同一份——M262 若对代码块选了别的锚点（例如块外沟槽），本 change 的裁决点 2
   需随裁决重排（见 proposal 裁决点 2 的备选列）。

### 2.4 代码块侧的 slot 与折行口径

复用 M240 的手法为代码块建立零足迹 slot（BlockWrapper，rank 20，`position: relative`）：
挂点在 `src/editor.ts` 的 `wrapExtensions` 旁**独立于** `codeBlockWrappers`（后者只在
`md && !codeBlockWrap` 时装，见 `src/editor.ts:1122-1135`），因为复制钮不该随折行开关消失。

硬约束：slot 层 MUST NOT 带任何 `overflow` / `padding` / `margin` / 背景 / 边框——
M180 的口径「代码块折行时块内 MUST NOT 出现横向滚动容器」不变（`openspec/specs/editor-live-preview/spec.md`
的「折行渲染与代码块横滚容器」条）；slot 只是定位层。落地时用既有 m240 场景的
「装 / 不装 slot 两态几何对比」手法做一次零基线变化验证。

## 3. 复制内容口径（本 change 唯一有真值风险的地方）

### 3.1 探针读数（2026-09-27，本机 `@lezer/markdown` + GFM，`node --input-type=module -e` 一次跑完）

输入（节选）与语法树读数（外层用四反引号包裹，示例里本身有三反引号围栏）：

````
para

```js
let a = 1;
  if (x) {
    y();
  }
```

    indented 1
    indented 2

        deeper

~~~
empty fence above
~~~
````

| 节点 | 范围切片（JSON.stringify 后的原文） |
|---|---|
| `FencedCode 6..50` | `"```js\nlet a = 1;\n  if (x) {\n    y();\n  }\n```"` |
| `CodeMark 6..9` / `CodeInfo 9..11` / `CodeText 12..46` / `CodeMark 47..50` | CodeText = `"let a = 1;\n  if (x) {\n    y();\n  }"`（**围栏之间、无尾换行**） |
| `CodeBlock 56..97`（缩进块） | 三个 `CodeText`：`"indented 1\n"`、`"indented 2\n\n"`、`"    deeper"` —— **语法缩进不在切片里，相对缩进保留** |
| 空围栏块 | 无 `CodeText` 子节点 ⇒ 空串 |

两条由此坐实的事实（实现期的依据）：

1. **围栏块**：`CodeText` 子节点切片 = 纯内容，天然不含围栏行与语言标记，天然无尾换行。
2. **缩进块**：lezer 已经把「它是代码块」的那层语法缩进吃掉（4 空格），内容自身的相对缩进留在
   `CodeText` 里；但缩进块**每行一个 `CodeText` 子节点**，节点之间的间隙正是语法缩进——因此规则是
   **按序拼接（相邻的）`CodeText` 子节点文本，丢弃节点之间的间隙**，而不是取块范围的整段切片。

另有一条换行归一的读数（同一台机器，`@codemirror/state`）：`EditorState.create({doc: "a\r\nb\r\n"})`
的 `doc.toString()` 是 `"a\nb\n"`、`lineBreak` 为 `"\n"`。因此**复制结果是 LF 换行的模型文本**，
即使源文件是 CRLF——这不是本 change 的新行为，而是「从 EditorState 复制」的既有语义，如实记录在
已知边界里（用户粘到别处要的是文本，不是磁盘字节；本 change 也不读磁盘）。

### 3.2 规则（delta 的正文）

| 块 | 复制内容 | 依据 |
|---|---|---|
| 渲染为 grid 的 pipe table | lezer `Table` 节点范围的源码切片：含表头分隔行、含用户自己写的对齐填充与短行写法；前后不补空行、不追加尾换行 | 源文件是唯一真源（ADR 0003 §3 的同向口径）；渲染态隐藏了分隔行，用户「按屏幕理解」会以为它多余，但它才是这张表在文档里的样子 |
| 围栏代码块 | `CodeText` 子节点切片（§3.1 事实 1） | 诉求原话「代码块复制纯内容（不含围栏行）」 |
| 缩进代码块 | 相邻 `CodeText` 子节点文本按序拼接（§3.1 事实 2） | 同一条用户口径：给「代码」，不给「它是代码块」的那层缩进 |

**为什么必须从 EditorState 切、不能从 DOM 取文本**：渲染态 DOM 里表头分隔行不存在
（`src/preview/livePreview.ts:655-658` 的 `Decoration.replace`）、cell 内是渲染后的 inline 形态、
被 widget 替换的块（mermaid）里连源码行都没有——DOM 取法会得到「屏幕的样子」，而用户要的是
「文档里的写法」。

**为什么不缓存**：切片在**点击那一刻**从当前 `EditorState` 现取，因此不存在「装饰是旧文档的」
这一类快照问题（M240 的遮罩需要快照语义，复制不需要：内容是模型上的一个区间，取就是最新）。

## 4. 触发、装配与失败路径

- **触发钮**：`Decoration.widget` 挂在块内（表格沿用既有挂点：表头行行首；代码块挂在该块首行行首），
  绝对定位、包含块是 slot。点击处理与本 M240 钮同款：`mousedown` 先 `preventDefault`（不扰动文档），
  `click` 时**现取**块范围（不缓存 DOM 引用与范围——装饰重建后缓存的引用会指向旧节点）。
- **装配**：`PreviewContext.blockCopy()` 提供 `{ copy(kind, range): void } | null`（形状同
  `tableFullscreen()`）。装配层（`src/main.ts`）实现两件事：从 `EditorState` 切片、写剪贴板 + toast。
  未接线时钮仍在、点了没反应（既有口径：能力没装配是结构性表现，不是开关）。
- **失败路径**：`navigator.clipboard.writeText` 抛错（不可用 / 权限被拒）→ toast「复制失败：{原因}」
  （deck D155）+ `console.warn` 一条（诊断事件名是 Rust 侧白名单，本 change 不动它，M244 同款处置：
  不借一个语义不符的既有事件名冒充）。**MUST NOT** 静默（REVIEW.md 第 2 条一族的纪律：不可观测的失败
  不许沉默）。
- **成功路径**：toast「已复制表格」/「已复制代码块」（D154），success tone（✓）。措辞与触发钮读屏名
  同词（D153 的「复制{块类型}」→ D154 的「已复制{块类型}」），让用户能确认复制的是哪一种块——
  与 D137/D138 的「复制完整路径」同一口径。

## 5. 命令与命中条件（裁决点 5 取推荐项时）

- `block.copy`，作用域 `editor`，默认不绑键 + `KEYLESS_COMMAND_IDS` 登记（M180/M240 先例）。
  **为什么是 `editor` 而不是 `global`**：`table.toggle-fullscreen` 取 `global` 是因为遮罩打开时焦点
  在遮罩内、`editor` 作用域会让 toggle 失效；复制没有第二种焦点状态，命中判据（caret 在哪一块里）
  本身要求编辑器持焦 ⇒ `global` 在这里是多余的放权。
- **命中条件**（命令级门，`KeymapContext.commandGate` 同款）：caret 落在①一张**当前渲染为 grid** 的表内，
  或②一个围栏 / 缩进代码块内；不满足时 MUST NOT 消费事件（`preventDefault` 不发，同名按键走原生路径）。
  判据都取自语法树与表格模型，不读 DOM。
- **优先序**：caret 在一张表**内**的代码块里是不可能的（表格 cell 里没有块级节点），因此两条判据天然互斥，
  不需要定序；实现期若发现可达的交叠形态（如实测出现），按「内层块优先」定序并把现场补进本文。

## 6. 性能与只读边界（ADR 0002 §6）

- **hover 不做任何计算**：钮的出现是纯 CSS（`:hover` + `visibility`），无 JS 监听、无重排；
  装饰层的构建成本与既有表格全屏钮**同级**（多一个 widget、代码块侧多一层 slot），
  不引入全文档扫描——代码块侧沿用表格的视口有界发现范围（`tableDiscoveryRange`）口径。
- **复制在点击路径上**：一次 `sliceString`（O(块大小)）+ 一次剪贴板写入。表格块受 64 KiB 降级上限约束；
  **代码块没有大小上限**，一个 1 MB 的代码块会是一次 1 MB 的同步切片——如实记录：这在点击路径上、
  不在键入路径与文档打开路径上，不改性能合同；落地时真机量一次大块代码块的点击到 toast 时延并落档
  （量不出人可感延迟就只记读数，不为此加阈值）。
- **只读**：点击不改文档、不改选区与光标落点（`mousedown` preventDefault + 切片只读）；
  文档代际变化（外部重载）不需要任何特殊处理——下一次点击取到的就是新文档的内容（与 M240 遮罩的快照
  语义不同，理由见 §3.2）。

## 7. 判据分层与真机场景 58 草案

分层沿用 M240 的分工（这是本 change **值得单独写清**的一处，因为它决定了能力的真机可见性）：

| 判据 | 层 | 为什么 |
|---|---|---|
| 静止态零足迹、hover 两钮同时浮现、点击打开剪贴板 + toast、与既有全屏钮不冲突、窄块外溢观感 | chromium 视觉场景（`tests/visual/scenes/`） | 视觉层有可靠的 `hover()`；真机层的 hover 通道未验证（套件动作表里**没有** hover / mouseMove 动作，见 `scripts/acceptance/README.md` 的动作表） |
| 复制内容逐字节正确（表格含分隔行 / 围栏块不含围栏行 / 缩进块剥语法缩进）、文档与磁盘逐字节不变、真实 WKWebView 下剪贴板落地的真的是这份文本 | 真机场景 58 | 剪贴板既不在 AX 也不在磁盘，套件的 `clipboard` 断言形态（M244）是唯一逐字判据；这正是场景 47 的做法 |
| 手感与观感（钮的浮现节奏、遮挡感、toast 位置） | Alex dogfood | 手感层不下沉（AGENTS.md） |

**场景 58 步骤草案**（实现期落成 `scripts/acceptance/scenarios/58-block-copy.md` + fixture）：

1. fixture 含：一张宽表、一张窄表、一个非矩形（降级）表、一个围栏代码块（内容含相对缩进）、
   一个缩进代码块（含比语法缩进更深的一行）、一个 mermaid 围栏块；`config.keys` 绑 `block.copy`（`09b-keys-config` 先例）。
2. **表格**：caret 点进正常表 → 注入绑定键 → `clipboard: { exact: "<该表源码逐字节>" }`（含 `|---|` 分隔行）
   + `ax: { has: "已复制表格" }` + `editor: { unchangedSince: before }`。
3. **围栏代码块**：caret 点进块内 → 同一键 → `clipboard: { exact: "<纯内容>" }`（断言里**不含** ``` 与语言标记）
   + toast + 文档不变。
4. **缩进代码块**：同上，断言结果不含 4 空格语法缩进、保留更深那行的相对缩进。
5. **负对照配正观测**（REVIEW.md 第 2 条）：先在普通段落里按同一键（`clipboard` 保持上一次的值不变、
   不出现成功 toast），再在同一份文档的代码块里按同一键（剪贴板变成该块内容）——后一步是前一步的反面证据，
   证明「按键在本次注入通道里确实能落地」，前一步的「不变」不是空转。
6. **降级表**：caret 点进降级表 → 同一键 → 不出现 toast、剪贴板不变（它没有 grid DOM，不是可复制块）。
7. **mermaid**：caret 点进 mermaid 块（源码显露）→ 同一键 → 剪贴板 = mermaid 源码。
8. **收尾**：`editor: unchangedSince` + `file: unchangedSince` 两条独立断言（ADR 0003 §3）。
9. **反向验证**：去掉入口（解绑 `block.copy` 或回退实现）后重跑，脚本 2 / 3 的正观测必须 FAIL，现场留档。
10. **触发钮的真机路径如实记为未覆盖**（同场景 40 的口径）：真机层只验命令路径；hover 钮由 chromium 场景覆盖。
    若 Alex 要求在真机层也验钮，须给套件加一个 `hover` 动作（先例 M244 的 `clipboardRead` / `click.button`
    两处窄扩展，均需 tower 扩 scope）——本 change 不擅自扩套件面。

## 8. 已知边界与妥协（诚实清单）

- **窄块外溢**（§2.1）：组宽 56px，极窄块上向左溢出到栏沟 / 块外内容，hover 期间存在、移开即还。
- **落地次序的过渡形态**（§2.3）：代码块侧若本 change 先落地，会短暂出现「只有复制、离角 36px」的单钮形态。
- **mermaid 图表态没有钮**（裁决点 4 的推荐项）：需要源码时点图表显露源码（既有行为）或用命令入口。
- **CRLF 源文件**：复制结果是 LF（§3.1 的换行归一读数）——从模型复制，不从磁盘复制。
- **代码块无大小上限**（§6）：超大代码块的点击延迟未加阈值，只记读数。
- **表格单元格内含 wikilink / 行内代码时**，复制的是**原文写法**（`[[note]]`、`` `code` ``），不是渲染后的样子
  ——这与「复制文档里的写法」同一口径，但要如实说明：粘到纯文本消费方（聊天框）看到的是 wiki 语法。
- **同一张表在文档里出现两次**不会混淆：命中的是 caret 所在的那一张（命令路径）/ 指针所在可视盒里的那一张
  （钮路径），没有「当前第几张」的跨表状态（M240 已按此口径拒过多表导航）。
