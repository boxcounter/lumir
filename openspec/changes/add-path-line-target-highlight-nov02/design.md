# Design: 点击 harness 正文里的带行号路径时，瞬态高亮目标行 / 行范围

- Change ID: add-path-line-target-highlight-nov02
- 日期: 2026-11-02

本文只写「怎么做到 proposal 里已裁的行为」与「为什么这样做」。代码锚点是起草时在本分支（基于
master）逐一读过原文的位置；行号会漂，实现前以符号名为准。

## 0. 事实清单（起草时核对过原文）

| 事实 | 锚点 | 与本 change 的关系 |
|---|---|---|
| 后缀正则 | `src/harness-path-link.ts:20` `LINE_SUFFIX = /:(\d{1,7})(?:-(\d{1,7})|:(\d{1,7}))?/y` | 不改正则；第二段是 `-N` 时是行范围 |
| 后缀解析 | 同文件 `:92` `lineSuffixAt`：`止 < 起` 整段不成立；`止` 越界不在这里判 | 改动点之一：把 `止` 作为 `lineEnd` 带出（今天算完即丢） |
| 候选产出 | 同文件 `:174` `findPathCandidates`：文件候选吞后缀，`PathCandidate` 带 `line` / `column` / `from` / `to` / `text` | 改动点之二：`PathCandidate.lineEnd` 声明并接线 |
| 跳转编排 | 同文件 `:307` `PathJumpPlan` / `:330` `openPathAtLine`：open → 窗口内 reveal → 下一帧复核 | 改动点之三：plan 增加可选 `highlight`，`openPathAtLine` 增加可选 `lineEnd` |
| 落点原语 | `src/editor.ts:2638` `revealLineAt`（行首 + 居中 + CL-2 让位窗口） | **不改**：高亮不碰选区、不碰滚动 |
| 既有瞬态高亮范式 | `src/quote-gesture.ts:314-341`：`QUOTE_FLASH_MS = 1400`、`setQuoteFlash` 状态效果、`quoteFlashField`（`Decoration.mark`）、eink 覆写 | 抄结构、不抄生命周期：mark 装饰按字符区间，且既有计时器清的是「当前 view 的 state」——本仓全部标签共用一个 `EditorView`（`view.setState` 切换），切标签后那一下会清到别的会话上 |
| 会话模型 | `src/editor.ts:2491` `activate` / `:2908` `closeSession` / `:2956` `reset`；会话各持一份 `EditorState`，共用 `view` | 高亮装饰存于 StateField ⇒ 随会话 state 走；清除必须**按会话**施加 |
| 基础层装配点 | `src/editor.ts:2142` `sessionState` 里的 `quoteFlashExtension`（模式无关） | 新扩展装在同一层：md / code 两种模式与只读会话都同样生效 |
| 面板渲染上下文 | `src/harness-panel.ts:2845` `PathLinkRenderContext`（`openFile(path, line?)`）、`:2860` `createPathLinkEl` | 改动点之四：`lineEnd` 透传；工具卡片目标不带它 |
| 工具卡片目标 | 同文件 `:4550` `pathLinks`、`:7073` `createToolText`（结构化参数目标，`ToolPathTarget` 没有行范围） | **不改**：卡片点击不产生高亮 |
| 装配点 | `src/main.ts:3000` `jumpPlanFor`（唯一装配）、`:3040` 面板回调、`:1473` 快速打开回调 | 改动点之五：plan 增加 `highlight`；只有面板回调传 `lineEnd` |
| 既有配色 | `src/style.css:334` `.cm-quote-jump-flash { background: var(--pending-tint) }` + `:337` eink → `rgba(0,0,0,0.1)` | 新类沿用同一 token 与 eink 覆写，不新增视觉 token |

## 1. 解析层：把 `止` 带出来

`lineSuffixAt` 的返回值从 `{ line?, column?, end }` 扩为 `{ line?, column?, lineEnd?, end }`：

- 单行 / 行列后缀：`lineEnd = line`（高亮范围退化为一行）；
- 行范围后缀：`lineEnd = 止`（解析时已经算过 `止 >= 起`，这里不再判）；
- 无后缀：三者都缺省。

`PathCandidate.lineEnd?` 与 `line` 同源同段，导出给面板。**这是给 `lineEnd` 的第一个消费者**
（REVIEW.md『值或开关声明了却没有消费者』条）：它不再只是「后缀是否成立」的中间量，而是高亮的
范围下界。

`lineSuffixAt` 的另一个调用方 `src/quick-open.ts` 的 `splitLineSuffix` 只读 `line` / `end`，新增
字段对它无行为影响（quick-open 的打开也不带 `lineEnd`，见 §3）。

## 2. 编辑器原语：行装饰 + 会话级生命周期

### 2.1 新模块 `src/navigation-highlight.ts`

```ts
export const NAVIGATION_HIGHLIGHT_MS = 1400;
export const MAX_HIGHLIGHT_LINES = 2000;
export const setLineHighlight = StateEffect.define<{ from: number; to: number } | null>();
export const lineHighlightField: StateField<DecorationSet>;
export const lineHighlightExtension: Extension;
```

- 装饰用 `Decoration.line({ class: "cm-line-highlight" })`，位置取每行行首。**不是** `Decoration.mark`：
  行装饰天然覆盖整行（含折行后的所有视觉行），不依赖字符区间，也不会被行内 widget 切断。
- 值语义：`null` 清除；新值**整块替换**旧值（`Decoration.set`），因此「同一时刻只有一处高亮」是
  数据结构的性质，不靠调用方先清后设。
- 文档一变更即整块清除（不是 `deco.map`）：行装饰的位置必须落在行首，编辑会把映射后的位置推到行中
  （`Decoration.line` 的行首不变量随之失效）；而高亮只是「刚才跳到了这里」的瞬态提示，用户开始编辑
  即已越过它——清掉比漂移诚实。
- 范围在**效果施加时**按 `tr.state.doc` 解析行首位置；调用方传的是 1-based 闭区间行号。

### 2.2 行数上限（性能护栏）

- 钳制到 `1..doc.lines` 之后，若 `to - from + 1 > MAX_HIGHLIGHT_LINES`，本模块返回
  `Decoration.none`（只落点、不高亮）。
- 数值依据（本机实测，`EditorState.update` 构建 N 条行装饰，200k 行文档、各 7 次取中位数）：

| 行数 | 构建耗时（中位 / 最大） |
|---|---|
| 500 | 0.18ms / 1.15ms |
| 1000 | 0.16ms / 0.21ms |
| 2000 | 0.27ms / 1.49ms |
| 3000 | 0.34ms / 0.36ms |
| 20000 | 7.86ms（单次） |
| 100000 | 34.26ms（单次） |

  2000 行落在单帧预算（16ms）之内且留足余量；2 万行起已经吃掉半个帧。**不做截断高亮**：
  只画前 2000 行会让用户以为范围就那么大，视觉承诺与文字承诺错位——宁可整段不画。

### 2.3 编辑器门面

`EditorHandle` 新增：

```ts
/** 给一段闭区间行加瞬态高亮（1-based，越界钳到文档边界）；只加装饰，不改选区 / 正文 / 历史。 */
highlightLineRange(from: number, to: number): void;
```

实现要点：

1. 先清掉旧计时器，再对**当前会话** dispatch `setLineHighlight.of({from, to})`（effect-only，
   不进撤销栈、不触发 `docChanged`）。
2. 计时器到点后按**会话**清除，而不是无条件对 `view` dispatch：
   - 会话仍是前台 ⇒ `view.dispatch({ effects: setLineHighlight.of(null) })`；
   - 会话已切到后台 ⇒ `session.state = session.state.update({ effects: ... }).state`；
   - 会话已关闭 / 已被 `reset` 掉 ⇒ 跳过（state 已作废）。
3. `activate()`（切标签）开头先清掉当前高亮：装饰存在 state 里，不清就会留在原会话的 state 中，
   切回去还会复现。
4. `closeSession()` 与 `reset()` 同样先清计时器与高亮指针。

**为什么不把计时器放进面板或 `openPathAtLine`**：生命周期属于编辑器内核（会话状态是它持有的），
放外面就绕不开「切标签后 `view` 已指向别的 state」这一层；而且重复点击的替换语义与计时器必须同源，
分两处会出现「装饰换了、旧计时器却把新高亮清掉」的时序缺陷。

## 3. 接线：只有正文路径链接带 `lineEnd`

数据链：

```
findPathCandidates            PathCandidate.lineEnd
  → PathLinkRenderContext.openFile(path, line, lineEnd)
  → HarnessPanelDeps.openVaultPath(path, line, lineEnd)
  → openPathAtLine(plan, path, line, lineEnd)
  → plan.highlight?.(line, lineEnd)   // 仅当 lineEnd !== undefined
```

- `lineEnd` 同时是**「这个入口是否参与行高亮」的显式开关**：正文候选总是带它（单行 = `line`），
  工具卡片目标（`ToolPathTarget` 无行范围）、快速打开（只传 `line`）、外部只读打开（只传 `line`）
  都不带 ⇒ 行为逐字不变。不需要另设布尔字段（那是同一语义的第二个真源）。
- `PathJumpPlan` 新增**可选**成员 `highlight?(from: number, to: number): void`；`jumpPlanFor`
  统一注入 `(from, to) => handle.highlightLineRange(from, to)`。快速打开 / 外部打开仍共用同一份
  plan 装配（M655 的「唯一装配点」不破），只是不会走到 `highlight` 分支。
- 高亮与首轮 reveal 在**同一个让位窗口**内施加（`duringTransition`），但高亮本身只加装饰、不改滚动，
  CL-2 的捕获语义不受影响；下一帧的复核补发只重发 reveal，不重设高亮（不重置计时）。

## 4. 视觉：复用 pending-tint，不新增 token

```css
.cm-line-highlight { background: var(--pending-tint); }
:root[data-theme="eink"] .cm-line-highlight { background: rgba(0, 0, 0, 0.1); }
```

- light / dark 取既有 `--pending-tint`（与「摘录跳回高亮」同一族语义：黄色 pending 底色）；
- eink 档 `--pending-tint` 恒 `transparent`（语义色退场档），按既有裁决转 10% 黑——与
  `.cm-quote-jump-flash` 逐字同口径。
- 不新增设计 token、不改 `.cm-line` 的既有底色；高亮只叠一层背景，行内字号 / 行高 / 间距不参与。

## 5. 验证策略（判别性优先）

- **纯函数单测**（扩 `tests/unit/harness-path-link.test.ts`）：
  - `lineSuffixAt` / `findPathCandidates`：`:12` → `lineEnd = 12`；`:12:3` → `lineEnd = 12`；
    `:12-40` → `lineEnd = 40`；畸形形态 `lineEnd` 缺省；
  - 编排：带 `lineEnd` 时 `highlight(12, 40)` 恰好调用一次、与首轮 reveal 同窗；不带 `lineEnd`
    时**一次都不调用**（快速打开 / 工具卡片的回归锚点）。
- **装饰层单测**（与解析 / 编排同在 `tests/unit/harness-path-link.test.ts`：本 change 不新增文件，
  行高亮是 harness 路径链接的唯一消费者，纯逻辑与它的入口写在一起；node 里直接驱动 `EditorState`）：
  - 单行 / 闭区间产出的装饰数正好等于行数、行首位置正确（第 11 / 41 行不在集合里）；
  - 越界钳制（`900-1200` 在 60 行文档上 ⇒ 只剩第 60 行；非正行号 ⇒ 首行）；
  - 钳制后超过 2000 行 ⇒ 无装饰（上限的反向断言：2000 行整 ⇒ 有装饰）；
  - 替换语义：先设 12-40 再设 5-6 ⇒ 只剩 5-6；
  - `null` 清除；
  - 文档一变更即清除高亮（行装饰不能落在行中）；
  - 效果施加不改变 `doc` / `selection`（`tr.docChanged === false`）。
- **视觉场景**（更新 `tests/visual/scenes/m632-path-line-range-link.spec.ts`）：
  - 点击行范围后 `.cm-line-highlight` 在 DOM 上正好覆盖第 120–140 行、第 119 / 141 行没有；
  - 选区仍折叠（`selection.main.empty === true`）、正文逐字节不变；
  - 单行链接点击后只高亮一行；
  - 重复点击后高亮仍是同一段（不叠加）；
  - 切标签后原文档的高亮消失，切回来不残留；
  - 三主题（light / dark / eink）下 `.cm-line-highlight` 的计算背景色非透明、且与 `.cm-line` 的
    底色不同（eink 的 10% 黑覆写在计算值上可判）。
  - 无新像素基线：只做结构 / 计算属性断言。
- **真机场景**（更新 `scripts/acceptance/scenarios/221-harness-path-line-range.md` 与 fixture）：
  截图判读点击后目标行带底色；AX 读不到装饰类名，故真机层以「点击后目标行仍在视口内、文件未变、
  选区状态不参与判据」为主，视觉层的 DOM / 计算样式判据由 chromium 场景承担。
- **门禁**：`gate.sh quick` 全绿；动过 `src/style.css` 与视觉场景 ⇒ 本地跑 `gate.sh visual`。

## 6. 已知边界（如实登记，不包装成覆盖）

1. 高亮是瞬态视觉，AX 树读不到装饰类名——真机层的判据只能到「落点 + 截图判读」，机器判据在视觉场景。
2. 钳制后超过 2000 行的范围不高亮；这是有意退化，不是覆盖缺口。
3. `止` 越界按文档行数钳制；`起` 越界同样钳到末行（整段退化为最后一行的高亮），与 `:行号` 的
   既有越界口径同族。
4. 高亮只覆盖 harness 正文路径链接；工具卡片、快速打开、wikilink、⌥G 不产生高亮（本 change 的
   Non-goals，另有单测锚点）。
5. 切标签清除发生在 `activate()`；若未来出现「同一会话同时显示在两个 pane」的形态，需重新定义
   「切标签」的边界——当前多标签模型是一个会话一个 pane 槽位，不存在该形态。
