# Design: harness pane 里的代码块与表格支持全屏查看

- Change ID: add-harness-block-fullscreen
- 日期: 2026-10-23

本文只写「怎么做到 proposal 里已裁的行为」与「为什么这样做」。代码锚点是起草时在本分支（基于
master）逐一读过原文的位置；行号会漂，实现前以符号名为准。

## 0. 事实清单（起草时核对过原文）

| 事实 | 锚点 | 与本 change 的关系 |
|---|---|---|
| 面板的代码块渲染 | `src/harness-panel.ts:2801` `buildCodeBlock(code, info)`（`<pre class="lumir-hp-codeblock">` + `highlightCode` 的 token span） | 加定位容器与悬停钮的落点 |
| 面板的块分发 | 同文件 `renderBlock`：`:2932` `FencedCode`、`:2943` `CodeBlock`、`:2947` `Table` | 三类块共用一条「包一层 slot + 挂钮」的路径 |
| 流式渲染 | 同文件 `:3002` `renderMarkdownInto`、`:3008` `finalizedUpTo`（已完成块只渲一次、**尾块每帧重渲**） | 决定「打开即快照」的口径与钮在尾块里的可用性 |
| 表格全屏 | `src/table-fullscreen.ts:52` 起的 `TableFullscreen.open(source: HTMLElement, label)`：深克隆渲染态子树、自然尺寸 + 双向滚动、只读克隆卫生（`cleanSnapshot` 已把 `.lumir-table-fs-trigger` / `.lumir-block-trigger` 一并摘掉）、主题镜像取**源元素**（`mirrorThemeScope(source, snapshot, …)`） | 面板直接把 `<table>` 交进去即可；共享类因此自动被克隆卫生覆盖 |
| 代码块全屏 | `src/code-block-fullscreen.ts`（`open(render, label)`、`themeScopeSource()` 注入）、`src/preview/code-block-content.ts:29` `CodeBlockRender` / `:49` `planCodeBlock`（行 + 头部条 + token；超过 `MAX_CODE_HIGHLIGHT_CHARS` = 64 KiB 降级为单块纯文本） | 面板侧按同一纯函数产出内容计划 |
| 编辑器侧的内容计划来源 | `src/preview/livePreview.ts:499` `codeBlockRender(view, block)`：`source` / `CodeText.from - block.from` / `codeBlockContent(doc, block.node)` / `head` / `info` | 面板侧的同一条映射（**抽成共享函数**，避免两份） |
| 浮层状态机 | `src/overlay-state.ts`：`OverlayCloseReason = escape / overlay / toggle / blur / document`；`handleKeyToken` 就地消费 Esc | 关闭路径全量复用，不新增 |
| 主题镜像 | `src/overlay-scope.ts` `mirrorThemeScope`；代码块全屏按 `themeScopeSource()` 取来源 | 面板来源要能返回面板根（而不是编辑器 DOM） |
| 装配与单实例 | `src/main.ts:1088-1130`：两个遮罩各一个实例，`restoreFocus` 按来源 pane 归还焦点（`focusSourcePane`） | 需要把「来源」扩一档：面板 |
| 块级动作钮家族 | `src/preview/block-trigger.ts`（`BLOCK_TRIGGER_CLASS` 等共享类）、`src/style.css` 的 `.lumir-block-trigger` 族（壳 / 热态 / hover 时机 / eink 两条规则） | 面板侧的钮只新增**位置** class，形态取共享类 |
| 既有键位 | `src/keys.ts:352` / `:360`：`table.toggle-fullscreen` / `code-block.toggle-fullscreen` 都在 `KEYLESS_COMMAND_IDS`（默认不绑键） | D1 的「不加默认快捷键」有既有先例 |
| 文案 | `D156`（放大查看代码块）、`D152`（跳转到行，未用）、`D203`（表格）、`D204`（代码块） | 钮与遮罩的读屏名从既有词条拼，不新增编号 |

## 1. 入口：块级 slot 与悬停钮

### 1.1 DOM 形状

面板里每个**代码块 / 表格**外面包一层 `.lumir-hp-block-slot`（`position: relative`，零足迹——
无背景 / 边框 / 内边距 / overflow），块本体与钮都在里面：

```
<div class="lumir-hp-block-slot">
  <pre class="lumir-hp-codeblock">…</pre>  或  <table>…</table>
  <button class="lumir-block-trigger lumir-hp-block-fs-trigger" aria-label="…">…</button>
</div>
```

- 定位：钮 `position: absolute; top: 6px; right: 6px`（与 content pane 的放大钮同一几何）。
- 形态：**只**带共享类 `.lumir-block-trigger`（壳 / 尺寸 / 圆角 / 图标色 / 过渡 / eink 两条规则
  在 `src/style.css` 写一份）；本 change 只加一个位置 class，MUST NOT 新写一套壳或热态。
- 浮现：`.lumir-hp-block-slot:hover .lumir-block-trigger` + `:focus-visible`（与 content pane 的
  「hover 可视盒即浮现 / 键盘焦点同样浮现」同一条规则，选择器在共享规则里补一条即可）。
- 语义：`<button type="button">`（不是 `<a>`），Enter 触发；点击 `preventDefault` + `stopPropagation`
  ——消息容器可能有自己的点击行为（摘录手势、复制），钮的点击不得被它接走。

**为什么包 slot 而不是给 `<pre>` 加 `position: relative`**：`<pre>` 与 `<table>` 都是内容盒，
钮的绝对定位需要一个**不参与内容流**的祖先；给块本体加 `position: relative` 会让钮在横向滚动时
跟着内容滚动（面板里表格可能横向溢出）。slot 在滚动容器之外，这与 content pane 的
`.cm-lp-codeblock-slot` / `.cm-lp-table-slot` 是**同一条理由**（`src/preview/block-trigger.ts` 的
文件头）。

### 1.2 何时可用

- 终态渲染出的块 = 有 slot 就有钮（结构性，不设开关）。
- 流式尾块每帧重渲（`renderMarkdownInto` 的 finalized / tail 分界）：尾块**照样**有钮——但打开后
  得到的是那一刻的快照（§5）。围栏尚未闭合时该内容在语法上还不是 `FencedCode` 节点，因此**没有**
  块、也没有钮；围栏闭合的那一帧起钮出现（这是解析事实，不是一条要维护的判据）。

### 1.3 读屏名与序号

- 代码块：`t("D156")`（「放大查看代码块」）——与 content pane 的钮同一份词条。
- 表格：`t("D203")`（「表格」）+ 序号 → 遮罩的 label 形如「Markdown 表格 2」。序号按**消息内**、
  只数表格块、1-based（D5）；无序号时读屏无法区分同一消息里的两个表格。
- 序号的实现：渲染一条消息时先数出块序（与 `imageOrdinals` 同为「块序列的派生读数」的形态，但作用面
  是渲染出的块，不进任何数据模型；MUST NOT 持久化）。

## 2. 表格全屏

- 调用 `tableFullscreen.open(tableEl, label)`：`tableEl` 就是刚渲染出的 `<table>`。
- 深克隆 + 自然尺寸 + 双向滚动 + 只读卫生全部由既有实现承担；克隆卫生已把 `.lumir-block-trigger`
  摘掉，因此快照里不会出现一份副本钮（这是共享类的红利，MUST NOT 在面板侧另写一份清理）。
- 主题镜像取源元素（`mirrorThemeScope(source, …)`）——面板根已带 `data-theme` 镜像（面板自身用
  `mirrorThemeScope`），因此 eink 下的遮罩观感与面板一致。

## 3. 代码块全屏

- 内容计划走 `planCodeBlock`（同一纯函数、同一 64 KiB 上限、同一降级形态）。
- 节点 → 计划参数的映射在编辑器侧已有一份（`livePreview.ts:499` 的 `codeBlockRender`）。本 change
  **把它抽成共享函数**（落 `src/preview/code-block-content.ts`，签名形如
  `planCodeBlockOfDocument(sourceText, node)`），编辑器侧与面板侧都调它——REVIEW.md『同一语义两处
  真源』条：映射规则只留一份。
- 围栏块：首行（围栏行）作头部条、`info` 进着色语言；缩进块：无头部条、无语言（`planCodeBlock` 的
  既有口径，面板与编辑器因此逐项同形）。
- 读屏名：`t("D156")`（同一词条）。

## 4. 装配（单实例、焦点归还、主题来源）

### 4.1 单实例

两个遮罩各一个实例（`src/main.ts:1088` 起）。面板与编辑器**共用**这同一个实例：同一时刻只可能有
一个全屏遮罩——这正是「应用模态」的语义。因此从面板打开会顶掉编辑器里已开的同类遮罩（用户看不到
两个遮罩叠加），无需第二套实例。

### 4.2 焦点归还

既有实现按「来源 pane」归还焦点（`focusSourcePane`）。本 change 把来源扩成一档：

```
type OverlaySource = { kind: "pane"; paneId: PaneId } | { kind: "harness" };
```

- 从面板打开时来源记 `harness`；关闭时焦点回到**该块的触发钮**（若它还在 DOM 里——流式重渲会替换
  尾块的 DOM），否则回到面板的 composer（面板的稳定焦点落点）。MUST NOT 把焦点交给编辑器。
- 从编辑器打开时行为逐字不变。

### 4.3 主题镜像来源

`codeBlockFullscreen` 的 `themeScopeSource()` 从「恒取编辑器 DOM」改为「按当前来源取」：来源是面板时
返回面板根（面板根带主题作用域），否则返回编辑器 DOM。表格侧不需要改（它从源元素自己镜像）。

## 5. 流式口径（D4：打开即快照）

- 打开时把**那一刻**的内容固化为遮罩内容：
  - 表格：深克隆那一刻的 `<table>`（既有实现即如此）；
  - 代码块：按那一刻的块源码生成 `CodeBlockRender`（一次纯函数调用）。
- 之后面板继续生长**不**回灌遮罩：遮罩里既不会出现「一半新一半旧」，也不会突然清空。用户关闭再
  打开即看到最新内容——这是可预期、可解释的行为（与 content pane 两条全屏的「快照副本」同一条语义）。
- 遮罩打开期间消息若被**整体替换**（会话切换 / 面板重载 / 快照恢复）：沿用既有 `document` 关闭路径
  （调用方在内容换代的显式点关闭遮罩），MUST NOT 让遮罩停在一份已不存在的内容上。面板侧的换代点
  = `reloadSession` / 会话切换 / 面板重建——一律调 `closeDocumentOverlays` 的同族入口（新增一条
  面板侧的调用点，不新写关闭逻辑）。

## 6. 只读与不变量

- 遮罩内容只读：表格是克隆、代码块是重建的 DOM，都不带事件监听、不在面板的输入子树内。
- 打开 / 关闭 MUST NOT 改消息文本、MUST NOT 改会话留存、MUST NOT 触发发送或复制。
- 块的既有交互（路径链接、图片双击放大、摘录手势）在**面板内**逐条不变；钮只新增一个点击目标，
  且点击被 `stopPropagation` 隔离。
- `Esc` 就地消费（不进统一键位表）——与三处既有浮层同一条理由（表内一个 token 一条绑定）。

## 7. 待裁决点

| # | 裁决点 | 选项与倾向 | 若裁另一侧的影响面 |
|---|---|---|---|
| D1 | 入口与键位 | **倾向 hover 钮 + 不加默认快捷键**（content pane 的两条同类命令也默认不绑键） | 加键位要先定「面板里当前是哪一块」的命中判据（焦点在 composer 时不成立），属另一条设计 |
| D2 | 遮罩复用还是另起 | **倾向复用**两个单实例遮罩（关闭路径 / 主题 / 读屏 / 焦点归还同源） | 另起：复制一套五条关闭路径与主题规则，两套形态必然漂移 |
| D3 | 代码块呈现口径 | **倾向复用 `planCodeBlock`**（行 + 头部条 + token，64 KiB 降级同源） | 克隆 `<pre>`：实现更小，但与 content pane 的呈现口径分叉 |
| D4 | 流式中打开的内容口径 | **倾向打开即快照**（与两条既有全屏的「快照」语义一致） | 跟随生长：要定块身份、增量边界、用户滚动时的锚点，另有复杂度 |
| D5 | 表格读屏名序号 | **倾向消息内序号**（「Markdown 表格 2」） | 不带序号：同一消息两个表格读屏不可区分 |

## 8. 视觉约束（无原型）

- 钮只取 `.lumir-block-trigger` 共享类 + 一个位置 class；几何与 content pane 的放大钮一致
  （`top: 6px; right: 6px`）。
- slot 零足迹（无背景 / 边框 / 内边距 / overflow），不得改变块的既有排版与折行。
- eink 下由共享类的两条既有规则覆盖，MUST NOT 新增 eink 分支。
- 遮罩观感完全由既有两条遮罩提供（同一壳、同一底色、同一滚动容器），本 change 不新增遮罩样式。

## 9. 验证策略（判别性优先）

- **纯函数 / 映射单测**：抽出的 `planCodeBlockOfDocument` 对围栏块 / 缩进块 / 超 64 KiB 三种输入
  产出与编辑器侧**逐项相同**的计划（同一用例表跑两侧，防漂移）；表格块序号的派生读数（只数表格）。
- **渲染单测**（驱动 `renderMarkdownInto` + 最小 DOM 替身）：代码块与表格产出 slot + 钮；钮的
  `aria-label` 取自既有词条；流式尾块里围栏未闭合时无钮、闭合后有钮（反向用例）。
- **视觉场景**（chromium + `tauri-stub`）：mock 回复含一个长代码块与一个宽表格 → 悬停出现钮 →
  点击 → 遮罩在场、内容与块逐字相同（代码块）/ 表格 cell 文本相同、遮罩内无按钮副本 → `Esc` 关闭、
  焦点回到面板。既有整页基线：回复里默认不 hover，**零更新**。
- **真机验收**（`scripts/acceptance/scenarios/`）：真实 WKWebView 下点开代码块与表格全屏、Esc 退出；
  流式期间（mock provider 分片）打开代码块 → 内容冻结在打开那一刻，关闭再开为新内容；关闭后焦点在面板。
- **门禁**：`gate.sh quick` 全绿；动过 `src/style.css` / `src/harness-panel.css` ⇒ 另跑
  `gate.sh visual` 并按 `GATE RESULT` 原文报告。

## 10. 已知边界（如实登记，不包装成覆盖）

1. 流式期间打开是快照（D4），不跟随生长。
2. 尾块在打开后被重渲，关闭时触发钮可能已不在 DOM 里——焦点退回 composer（§4.2）。
3. 面板内的块没有「复制块」钮（非目标）；复制仍走消息级按钮。
4. 表格快照是「打开那一刻渲染态的子集」，与 content pane 表格全屏同一条已知边界（长表、惰性渲染）。
5. 从面板打开全屏会顶掉编辑器里已开的同类全屏（单实例的应用模态语义）。
6. 快捷键不在本 change（D1）。
