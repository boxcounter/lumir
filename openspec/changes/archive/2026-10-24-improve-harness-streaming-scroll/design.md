# Design: harness 流式输出期间的阅读位置保护

- Change ID: improve-harness-streaming-scroll
- 日期: 2026-10-23

本文只写「怎么做到 proposal 里已裁的行为」与「为什么这样做」。代码锚点是起草时在本分支
（基于 master）逐一读过原文的位置；行号会漂，实现前以符号名为准。

## 0. 事实清单（起草时核对过原文）

| 事实 | 锚点 | 与本 change 的关系 |
|---|---|---|
| transcript 容器：`overflow-y: auto`、`flex: 1 1 auto`、`position: relative`，行高 `--lh-ui`（1.5）× 13px ≈ 19.5px | `src/harness-panel.css:319`；`src/harness-panel.ts:3604` | 唯一被本 change 改变滚动行为的容器 |
| 唯一滚动动作 = 无条件写底 | `src/harness-panel.ts:5936` `scrollToBottom()`：`transcript.scrollTop = transcript.scrollHeight` | 改造点：分成「跟随下贴底」与「强制回底」两个出口 |
| 16 处调用点 | 见 §3.1 的逐点分流表 | 每一处必须显式归入「内容增长」或「强制回底」，无第三类 |
| 流式增量写底 | `flushChunks()` `:7211` 由 rAF（`:7201`）驱动，正文缓冲非空时在 `:7236` 写 `scrollTop` | Alex 报的「立刻被拽到底部」的直接成因 |
| 面板没有任何 `scroll` 监听 | 全仓 `addEventListener("scroll")` 只在 `src/content-width.ts:109` 与 `src/editor.ts:2128`（编辑器 / 内容宽度） | 「用户是否在底部」今天不存在，需要新增一份判据 |
| 终态全量重渲 | `finalizeStreamingMessage()` `:7245` 把每个文本段 `replaceChildren()` 后全量渲染，末尾 `:7270` 写底 | 脱离态下这里也必须不写；高度可能微变（已知边界 §6） |
| 会话恢复 / 快照重建以写底收尾 | `restoreSnapshot()` `:8421` → `:8499`；`resumeSession()` `:9219` → `:9233` | 强制回底白名单（恢复后必须看到末尾） |
| 消息摘录卡跳回用 `scrollIntoView` | `jumpToMessageQuote()` `:4570`，`:4578` | 不改它：跳回本身会产生 scroll 事件，几何判据自然进入脱离态 |
| 快照复位 | `resetView()` `:8514`（`transcript.replaceChildren()` 起头） | 复位跟随态与未读标记 |
| 面板挂载 | `attachTo()` `:9299`（`mount.append(panel)`） | 重新打开面板 = 用户动作，强制回底并恢复跟随 |
| 面板 DOM 组装 | `panel.append(transcript, progress, taskArea, composerArea)` `:3824` | transcript 需要包一层视口容器承载浮钮（§4.1） |
| 错误去重路径 | `appendError()` `:6618`，同文案分支 `:6622` 写底 | MODIFIED 的落点：跟随态滚到可见、脱离态不写 |
| 文案施加 | `applyLabels()` `:5154`（由 `onRelabel` 驱动） | 浮钮可访问名在此重取，两串文案 |
| 面板无 elevation 纪律 | `src/harness-panel.css:1` 头部注释；`--agent-bg` 是面板底色 `:73` | 面板本体不浮起；浮在正文上的件沿用既有浮层配方（消息摘录钮同一条），不新造面 |

## 1. 缺陷机理：为什么必须是「两态」而不是「延后滚动」

今天的 `scrollToBottom()` 是**无条件**的：内容一长出来就写 `scrollTop = scrollHeight`。流式
增量走 rAF 合帧，所以只要在本轮里，任何一次「上滚」都会在下一帧被覆盖——用户看到的是
「滚不上去 / 立刻弹回底部」。把它改成「延迟 300ms 再贴底」只是把抢滚动延后，用户仍然不能
稳定阅读；改成「流式期间禁用自动滚动」又会在用户本来就在底部时让视口越来越落后，破坏
「看着回答长出来」的核心体验。

正确的判据是**用户的意图由视口位置表达**：距底容差内 = 「我在看最新」，继续跟随；离开底部
超过阈值 = 「我在读这里」，停止写滚动位。这个判据没有模式开关、没有超时、没有「上次交互
时间」，因此不会与用户的实际位置矛盾。

## 2. 状态模型（纯函数，无 DOM）

新增模块 `src/harness-scroll-lock.ts`（命名与 `src/harness-path-link.ts` / `src/code-identifiers.ts`
同族：纯模型单独成文件，面板只做接线）。这一层是**唯一**的判据来源；面板、单测、视觉场景
都消费它，MUST NOT 在面板里再写一份阈值或比较（REVIEW.md『同一语义两处真源』条）。

```ts
export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
}
export type FollowPhase = "following" | "detached";

/** 距底 ≤ 此值 = 在底部（回底 / 复跟）。取值理由：吸收亚像素与舍入，又不把「滚了一小段」误判成在底。 */
export const FOLLOW_ATTACH_PX = 6;
/** 距底 > 此值 = 离开底部（脱离）。必须 < 一行正文高度（默认 19.5px），否则「只滚一行」不会脱离。 */
export const FOLLOW_DETACH_PX = 16;

export function maxScrollTop(m: ScrollMetrics): number;          // max(0, scrollHeight - clientHeight)
export function distanceFromBottom(m: ScrollMetrics): number;    // max(0, maxScrollTop - scrollTop)
export function bottomScrollTop(m: ScrollMetrics): number;       // maxScrollTop，写回值
export function reduceFollow(phase: FollowPhase, m: ScrollMetrics): FollowPhase;
```

`reduceFollow` 的真值（滞回）：

| 当前态 | 读数 | 次态 |
|---|---|---|
| following | 距底 ≤ `FOLLOW_DETACH_PX`（含负值 / 0） | following |
| following | 距底 > `FOLLOW_DETACH_PX` | detached |
| detached | 距底 ≤ `FOLLOW_ATTACH_PX` | following |
| detached | 距底 > `FOLLOW_ATTACH_PX` | detached |

三条必须钉进单测的边界：

1. **负距底**（macOS 橡皮筋把 `scrollTop` 拉过最大值）算「在底」→ 不因回弹脱离。
2. **内容不足一屏**（`scrollHeight ≤ clientHeight`）→ 距底恒 0 → 恒 following，不出现按钮。
3. **滞回区间**（`FOLLOW_ATTACH_PX < 距底 ≤ FOLLOW_DETACH_PX`）→ 保持原态：following 不脱离
   （小幅抖动不闪），detached 不复跟（小幅回滚不抢）。

控制器（同样无 DOM，由面板注入真实元素适配器）：

```ts
export interface FollowSurface {
  read(): ScrollMetrics;
  writeScrollTop(top: number): void;
  /** 把写底推迟到下一帧（面板注入 requestAnimationFrame；单测注入手动调度器）。 */
  schedule(cb: () => void): void;
  /** 两态 / 未读的呈现出口（面板里 = 浮钮的 hidden 与未读类）。只在值变化时被调用。 */
  render(state: { phase: FollowPhase; unread: boolean }): void;
}
export interface FollowController {
  phase(): FollowPhase;
  /** 用户滚动（scroll 事件）→ 只按几何位置换态；MUST NOT 写 scrollTop。 */
  onScroll(): void;
  /** 内容增长后的唯一出口：following 排一次下一帧写底；detached 只更新未读。 */
  contentGrew(): void;
  /** 内容**就地替换**（错误行同文案去重，高度可能不变）：detached 下点亮未读
   *（spec「脱离态下重复错误不拽走视口」要求未读提示在场），following 下同 contentGrew。 */
  contentReplaced(): void;
  /** 立即执行排队的写底（面板 rAF 尾部调用：该拍已在 scroll 事件之后，无需再等一帧）。 */
  flushNow(): void;
  /** 强制回底（白名单动作）→ 同步写底 + 回 following + 清未读。 */
  jumpToBottom(): void;
  /** 视口尺寸变化：following 时排一次写底；detached 时什么都不写。 */
  viewportChanged(): void;
  /** 视图复位（会话切换 / 清空）：回 following、清未读、写底。 */
  reset(): void;
}
export function createFollowController(surface: FollowSurface): FollowController;
```

实现语义：

- **写底一律推迟到 rAF，MUST NOT 在事件回调里同步写**：浏览器的渲染更新次序是
  「scroll 事件 → rAF 回调」，把写底放在 rAF 里，就保证任何一次用户滚动（wheel /
  滚动条 / `scrollIntoView`）的 scroll 事件都先被 `onScroll` 看到并完成换态，随后那一帧的
  写底才会检查状态。这条闭合了一个真实竞态：工具行 / 通知 / 错误 / 批准卡是**同步**写 DOM
  的事件路径，它们若在 wheel 输入与 scroll 事件之间同步写底，会把用户刚滚出的位置覆盖掉，
  而 scroll 事件随后读到距底 0、误判为「仍在跟随」。
- `contentGrew()`：following → 置 pending 并 `schedule(flush)`（同帧多次增长只排一次）；
  detached → 用新鲜读数比较 `unreadBaseline`（`scrollHeight > baseline + 1`，1px 容差），
  **不写** `scrollTop`、不排写。
- `contentReplaced()`（错误行同文案去重）：高度可能不变（就地替换），但「下面发生了新事件」是
  事实；detached → 不比较高度、直接点亮未读（spec「脱离态下重复错误不拽走视口」要求未读提示
  在场）；following → 与 `contentGrew()` 同义（滚到可见）。
- `flushNow()`：pending 已清或态已不是 following（用户滚动已把态换走）→ 直接返回；否则写
  `bottomScrollTop(read())`。排队的 `flush` 只是延时版的同一个函数。它是 rAF 里的最后一道
  复核，MUST NOT 改态。面板自己的 rAF（流式合帧）在末尾直接调它——该拍已在 scroll 事件之后，
  再等一帧只会让视口永远落后一帧的增量；非 rAF 的事件路径（工具行 / 通知 / 错误 / 批准卡）
  则让 `schedule` 排到下一帧。
- 进入 detached 的那一刻记下 `unreadBaseline = read().scrollHeight`。
- **只有 `onScroll()` 能改态**：`contentGrew()` / `flushNow()` / `viewportChanged()` 一律不改态
  ——内容增长永远不能被误读成「用户滚动」。`jumpToBottom()` / `reset()` 是白名单动作，按
  定义可以置回 following。
- **自写回声**（实现期实证补充，2026-10-23）：写底会异步产生一个 scroll 事件；若布局在写入与
  事件之间变了（实证：发送消息 → 强制回底 → 进度条出现把视口压矮 28px，事件这时才到、读到
  距底 28px），几何判据单独会把「我们的回声」判成「用户上滚」。控制器记住最近一次写入值，
  读数与写入值差 ≤ 1px 的 scroll 事件按「不是用户滚动」吞掉一次：不换态，距底超出回底容差时
  补排一次贴底（layout 变化自己收敛）。一次写入只产生一次回声，识别后即清——之后用户真滚到
  同一像素位置仍按几何判据正常换态。
- `following` 下写回触发的 scroll 事件随后读到距底 0，仍是 following（不抖动）。

## 3. DOM 接线（`src/harness-panel.ts`）

### 3.1 16 处调用点逐点分流

「增长」= 走 `follow.contentGrew()`；「强制」= 走 `follow.jumpToBottom()`。MUST NOT 保留任何
裸写 `transcript.scrollTop` 的第三类调用点（实现后可 `rg "scrollTop" src/harness-panel.ts`
复核只剩适配器里的唯一写入口）。

| # | 行 | 所属函数 | 分类 | 理由 |
|---|---|---|---|---|
| 1 | 6038 | `appendUserMessage` | **强制** | 用户发送 = 白名单动作，新消息必须在眼前 |
| 2–5 | 6517 / 6527 / 6547 / 6596 | `appendToolCall`（task 行建行 / task done / 抑制槽终态 / 普通行） | 增长 | 工具行是流式过程的一部分，不拽视口 |
| 6 | 6615 | `appendCompactMarker` | 增长 | 自动压缩标记不是用户动作 |
| 7–8 | 6622 / 6632 | `appendError`（同文案去重 / 新错误） | 增长 | 由 MODIFIED 的错误呈现条款收口：去重分支高度可能不变，走 `contentReplaced()`（detached 下点亮未读）；新错误走 `contentGrew()` |
| 9 | 7007 | `appendApproval` | 增长 | 批准卡不拽视口（D5）；未读圆点提示 |
| 10 | 7236 | `flushChunks`（rAF 合帧） | 增长 | 主战场：修前每帧无条件写底 |
| 11 | 7270 | `finalizeStreamingMessage` | 增长 | 轮次终态不强制回底（D6） |
| 12 | 7903 | `appendNotice` | 增长 | 后台完成通知不拽视口 |
| 13 | 7916 | `appendNoticePlain` | 增长 | 同上（兜底上屏） |
| 14 | 8163 | `handleEvent` 的 `aborted` 无产出标记 | 增长 | 中断收口不拽视口 |
| 15 | 8499 | `restoreSnapshot` | **强制** | 快照重建收尾必须看到末尾（既有语义；与 `resumeSession` 的收尾同一句） |
| 16 | 9233 | `resumeSession` | **强制** | 恢复历史会话必须从末尾读起（既有语义） |

额外的两个接线点（不在 16 处里）：

- `attachTo()`（`:9299`）：`mount.append(panel)` 之后 `follow.jumpToBottom()`——重新打开面板
  是白名单动作；同时覆盖「隐藏期间布局读数不可信」的现场（元素摘下时 `clientHeight` 为 0）。
- `resetView()`（`:8514`）：`transcript.replaceChildren()` 之后 `follow.reset()`——回 following、
  清未读、按钮退场；随后的快照 / 恢复路径各自「强制」一次。

### 3.2 scroll 监听

```ts
transcript.addEventListener("scroll", () => follow.onScroll(), { passive: true });
```

- passive：不阻止滚动、不进键盘路径（ADR 0002 §6 不受影响）；
- 构造期注册一次（面板单例、与消息摘录手势同一条生命周期口径）；
- 只读 `scrollTop / clientHeight / scrollHeight` 三个数，不量任何几何、不触发布局写入。
- **时序**：浏览器渲染更新的既有次序是「scroll 事件 → rAF 回调」，而内容增长的写底一律经
  `schedule` 推迟到 rAF（§2）。因此用户上滚的那一拍一定先被 `onScroll` 换态，随后那一帧的
  `flush()` 看到 detached 直接返回——不存在「增量先写底、滚动事件后到」的抢跑窗口。实现
  MUST NOT 在事件回调里同步写底（那会把判据挪到 scroll 事件之前）。

### 3.3 rAF 合帧的未读补扫

`flushChunks()` 在纯思考帧（`chunkBuffer === ""`）会早退，既有的写底也在早退之后，因此今天
「只有 reasoning_chunk 的一帧」不会贴底。为保持行为不变而仍要更新未读，rAF 回调里补一句：

```ts
flushChunks();                                               // 内部 contentGrew() → 排队
if (follow.phase() === "detached") follow.contentGrew();      // 纯思考帧的未读
else follow.flushNow();                                       // 本帧有增长则同帧落地
```

following 分支只为「本帧确实增长过」的 pending 写底（没有增长时 `flushNow()` 是 no-op），
不新增「思考帧也贴底」的行为；detached 分支只读一次 `scrollHeight`，无写。

### 3.4 视口尺寸变化

用 `ResizeObserver` 观察 transcript（或它的视口容器）**自身的盒尺寸**，回调只做
`follow.viewportChanged()`。选 RO 而不是 `window.resize`：分栏拖拽 / 左栏宽度变化同样会让面板
宽度变化 → 文本重排 → `scrollHeight` 变化，`window.resize` 看不见这条路径。RO 观察的是元素
盒子，内容高度增长不会触发（`scrollHeight` 不是被观察的盒），因此不会与 §3.3 的未读补扫重复。

- following：尺寸变化后补一次贴底（变矮 / 变窄导致末行落出视口时重新贴回）；
- detached：什么都不写（尺寸变化不得改变阅读位置）。

生命周期：控制器构造期注册（面板单例长驻），不需要随 attach / detach 增删——面板摘下时盒子
尺寸变 0 会触发一次回调，following 下写一次无效的 0 值，无副作用（§6「面板隐藏期间」）。
字号缩放（`--lumir-hp-scale`）改变行高但不改变 transcript 的盒尺寸，RO 不触发；下一次
`contentGrew()` 收敛，属已知边界（§6）。

### 3.5 未读基线的一个细节

进入 detached 的 scroll 事件里读到的 `scrollHeight` 是「用户离开底部那一刻」的内容高度。若
用户在一次快速滚动中连续触发多个 scroll 事件，第一次已经进入 detached 并记基线，后续事件
只换态、不重记基线（仍是 detached → detached 无迁移）。实现按 `reduceFollow` 返回「态变了
才动作」即可，不要每次 scroll 都重置基线——否则未读永远追不上。

## 4. 视觉合同（新增可见件：回到底部浮钮）

无原型；本节按既有 token 与面板配方定值，Alex 可在节点 1 一并裁形态。

### 4.1 DOM 结构与定位

```
.lumir-harness
├── .lumir-hp-transcript-viewport   ← 新增：position: relative; flex: 1 1 auto; min-height: 0; display: flex
│   ├── .lumir-hp-transcript        ← 既有容器原样搬入（flex: 1 1 auto; min-height: 0）
│   └── .lumir-hp-jumpbottom        ← 新增：absolute; right/bottom 偏移；hidden 默认
├── .lumir-hp-progress
├── .lumir-hp-taskarea
└── .lumir-hp-composer-area
```

- 浮钮 MUST NOT 放进 `.lumir-hp-transcript` 内容流：那是滚动容器，绝对定位的子节点会随内容
  滚动（消息摘录钮是「跟选区走」的相反需求，不可复用同一条定位口径）。
- 覆盖层容器必须让 transcript 的可视高、内边距与今天逐值相同——既有视觉基线（m303 / m351 /
  m628 等）在浮钮 `hidden` 时预期**零像素漂移**；若实现后出现漂移，先查这层盒模型再谈更新
  基线（基线更新是人肉裁决点，不在本 change 内 `--update`）。
- 消息摘录浮动钮的 z 序高于回底钮（前者是瞬态交互、后者是常驻导航）；回底钮贴右下角
  （`--sp-6` 偏移），避开消息正文与系统 overlay 滚动条的常用滑道。

### 4.2 尺寸、配色、状态

| 项 | 取值 | 依据 |
|---|---|---|
| 尺寸 | 26 × 26 | 与发送钮 `.lumir-hp-send`（26×26）同一档，控制行 / 面板内小控件一族 |
| 圆角 | `--r-pill`（圆形） | 图标浮钮的既有语言（搜索 panel / toggle 同族） |
| 底面 | `--preview-bg` | 浮层件同族配方：与 transcript 内的消息摘录钮（`.quote-gesture-btn`，`src/style.css:845`）同一份面，比面板底 `--agent-bg`（`harness-panel.css:81`）亮一档；eink 两者同为白面，靠描边立起（规则⑤同款） |
| 描边 | 1px `--border` | 同上；eink 下即黑框 |
| 阴影 | `--shadow-raise`（eink = none，靠描边） | 与消息摘录钮同一条浮起语言；面板「平铺不吃 elevation」的纪律针对面板本体，浮在正文上的件走既有浮层配方 |
| 图标 | ↓（SVG，11×11，stroke 1.6，`aria-hidden`） | 与发送钮 glyph 同一条构造纪律（DOM API，无 innerHTML） |
| 图标色 | `--text-2`；hover / focus 时 `--text` | 次级控件，不抢正文 |
| hover / focus | 背景 `--hover`（eink 为 6% 黑叠层）；focus-visible 加 1px `--accent` 外框或无外框但可见态（按既有按钮配方） | 只消费 token |
| 未读圆点 | 6px 圆点，位于钮右上（`top/right: -1px`），`--accent`（eink = 黑）；`aria-hidden` | 布尔提示，不是计数（D3） |
| 层级 | `z-index: 10`；消息摘录钮是 `15`（`src/style.css:848`），恒在其上 | 摘录钮是瞬态交互，回底钮是常驻导航；两者落点重叠时以摘录钮为准 |
| 动效 | 无（不脉冲、不淡入）；`prefers-reduced-motion` 下零差异 | 省动效不是省状态：出现 / 消失本身就是状态表达 |

### 4.3 可访问名与文案

- 无新内容：`回到底部` / `Back to bottom`；有新内容：`有新内容，回到底部` / `New content, back to bottom`。
- 同串落 `title` 与 `aria-label`（面板内图标钮的既有口径：D327 / D329 / D330）。
- 两条新文案按 deck 续号（当前最大 D550，从 D551 起），`src/copy-data.ts` 与 `文案-Copy.md`
  同批落、由 `tests/unit/copy.test.ts` 的全量漂移门禁钉住；`applyLabels()` 里按
  `follow.phase() / unread` 重取（语言切换、以及每次态变化时）。
- 未读圆点 MUST NOT 是唯一的信息载体：可访问名随未读态变化，屏幕阅读器可感知。
- **焦点归还**：钮点击后自身隐藏，若隐藏前它是 `document.activeElement`（键盘 Enter / Chromium
  下的鼠标点击都会让按钮获焦），把焦点交还 composer——否则焦点落到 `body`，键盘用户失去键入
  落点。Safari 的按钮点击默认不获焦，因此这条对鼠标路径无副作用。

## 5. 机器验收口径（三层，缺一层就退化为假绿）

### 5.1 单测（零 DOM，`node tests/unit/run.mjs`）

新文件 `tests/unit/harness-scroll-lock.test.ts`，只驱动 `src/harness-scroll-lock.ts` 的纯函数与
控制器（与 `harness-panel-control.test.ts` 同一零 DOM 口径）。**先造会红的输入**再实现：

- `reduceFollow` 四行真值表逐条；
- **滞回区分度**：following + 距底 10px → 仍 following（若实现写成「距底 > 0 即脱离」，这条红）；
  detached + 距底 10px → 仍 detached（若实现写成单一阈值，这条红）；
- **橡皮筋**：`scrollTop = max + 40`（负距底）→ following（若实现按 `scrollTop < max` 判脱离，红）；
- **不足一屏**：`scrollHeight = clientHeight`、`scrollTop = 0` → following，且 `contentGrew()` 不出现未读；
- **控制器**：detached 下 `contentGrew()` **不调用** `writeScrollTop`（用假 surface 记录所有写
  调用，断言数组为空）；following 下 `contentGrew()` 只排队、不立即写，运行手动调度器后写一次
  `bottomScrollTop`（同帧多次 `contentGrew()` 只排一次、只写一次）；`flushNow()` 立即执行排队
  的写、无 pending 时是 no-op；
- **竞态（本设计的关键用例）**：following 下 `contentGrew()` 已排队 → `onScroll()` 读到远离
  底部（detached）→ 再运行调度器 → 零写入（若实现让排队的写底跳过状态复核，这条红）；
- **只有 onScroll 改态**：`contentGrew()` / `flushNow()` / `viewportChanged()` 前后 `phase()`
  不变（白名单的 `jumpToBottom()` / `reset()` 除外）；
- **未读基线**：detached 后 `scrollHeight` 增长 → `unread = true`；`jumpToBottom()` → false；
  `scrollHeight` 不变时 `contentGrew()` 不点亮；
- **强制回底**：`jumpToBottom()` 写底、回 following、清未读；
- **reset / viewportChanged**：detached 下 `viewportChanged()` 零写入；following 下写底。

反向验证要求在实现期做一次：把「detached 不写」临时改成写底 → 控制器「零写入」那条必红；把
滞回改成单一阈值 → 「滞回区分度」那条必红（两条都写进测试文件注释，作为断言区分度的自证）。

### 5.2 视觉场景（chromium，进 CI 结构层）

新文件 `tests/visual/scenes/m638-harness-scroll-lock.spec.ts`（`stubTauri` + `__fireHarnessEvent`，
不新增像素基线）。断言序列：

1. **前提**：发一轮足够长的流式文本（逐 chunk 注入，行数 ≥ 3 屏），断言
   `scrollHeight > clientHeight + 120`——没有这个前提，后面所有读数都空转（REVIEW.md『断言等价于子串』条）；
2. **跟随时贴底**：追加 5 个 chunk → `scrollTop` == `maxScrollTop`（±1px）；
3. **上滚脱离**：`page.mouse.move` 到 transcript 内 + `mouse.wheel(0, -300)` → `scrollTop` 至少
   减 100（证明滚动真的发生），回底钮 `hidden === false`；
4. **核心断言（修前必红）**：再注入 20 个 chunk，等两帧 rAF → `scrollTop` **逐值不变（±1px）**，
   且 `scrollHeight` 至少增加 100（证明确有新内容）；未读圆点在场；
5. **点钮回底**：点击钮 → `scrollTop` == `maxScrollTop`（±1px）、钮 `hidden === true`；再注入
   5 个 chunk → 仍在底部；
6. **滞回**：在底部时 `wheel(0, -8)`（< `FOLLOW_DETACH_PX`）→ 钮仍隐藏；注入 chunk →
   `scrollTop` 回到底（跟随未被小滚动打断）；
7. **白名单**：再次上滚脱离 → 填充 composer 并发送 → `scrollTop` 回到底、钮隐藏；
8. **非用户事件不拽**：脱离态下注入 `tool_call` / `notice` / `error` → `scrollTop` 不变（±1px）；
9. **不足一屏**：新会话（`resetView`）→ 内容 < 视口 → 钮隐藏、滚轮不产生脱离；
10. **主题 / 文案**：三主题下（`config: { theme }`）浮钮可见时的计算样式逐值等于 token 探针
    （`background-color` = `--preview-bg`、`border-color` = `--border`、圆点 = `--accent`）；
    `config: { language: "zh" | "en" }` 两档断言 `aria-label` 分别命中对应文案。

第 4 条是本 change 的**主判据**：缺陷形态下（`scrollToBottom()` 每帧写入）该断言必然红。
实现期把修复临时回退跑一次，把读数（修前 `scrollTop` 跳到 max、修后不变）写进场景文件头，
作为反向验证的落档。

### 5.3 真机验收场景（`scripts/acceptance/`，不进 CI）

新增场景 + mock fixture（`chunk_delay_ms` 撑开流式窗口，机制见 `src-tauri/src/harness/llm.rs`
模块头「逐片延迟」）：

1. 打开面板 → 发送 → `waitFor` 首片上屏；
2. `do: scroll` 在 transcript 区域上滚 → `ax: { has: "回到底部" }`（钮出现 = 脱离态被检测到；
   缺陷形态下钮根本不存在，这条有区分度）；
3. 等到末片上屏（`waitFor`）→ 钮仍在场（没有被任何增量操作拽回并隐藏）；
4. 点钮 → `ax: { not: "回到底部" }`；
5. 补充一条像素断言：点钮后 transcript 底部一行带有字形（`pixel.contrast`，阈值取场景 118 的
   同款 60）——证明「真的回到底部」，而不是按钮自说自话。

**通道风险（如实登记）**：`scripts/acceptance/README.md` 的已知边界写明 `do: scroll` 在 M252 /
M379 从未产出过位移，并给出可行修法（给 `lib/cgevent-click.swift` 加 wheel mode）。因此场景
落地顺序是：**先探针**（对 transcript 中心跑一次 `do: scroll` + 后续步骤观察是否脱离）——若仍
产不出位移，先给 `cgevent-click.swift` 补 wheel mode（与 `doubleClick` / `drag` 同一条已验证
通道），再写场景。场景 MUST NOT 依赖「AX 读 scrollTop」（WKWebView 不暴露），判据只用钮的
在场与否 + 像素。若 wheel mode 也不可行，如实把场景标为受阻上报 tower，不用「AX 里有文字」
冒充滚动生效。

## 6. 已知边界（如实登记）

- **内容重排**：`finalizeStreamingMessage` 全量重渲当前消息的文本段，高度可能有微小变化；
  本 change 保证「脱离态不写 `scrollTop`」，不承诺「任何重排都不移动可见行」。原生滚动锚定
  （`overflow-anchor`）的补偿行为跨引擎不一致，本仓未做实测、不作承诺；若实测在 WKWebView 上
  出现可见漂移，另立 change（不在本提案内静默扩 scope）。
- **纯思考帧**：见 §3.3——following 下不为思考帧新增贴底（保持今天的行为）；detached 下只点
  未读。若未来希望「思考块出现也贴底」，是独立的行为变更。
- **字号缩放**：`--lumir-hp-scale` 变化导致的行高变化不触发 resize 事件；下一次内容增长 /
  视口变化时收敛。极端情况下（空闲、脱离态）阅读位置不受影响——这正是我们要保护的。
- **面板隐藏期间**：元素摘下 DOM，`clientHeight` / `scrollHeight` 读数为 0；`contentGrew()`
  排队的写底读到 0 盒子、写上 0（无效果），事件照常累积。重新挂载时按白名单强制回底，不依赖
  隐藏期间的读数。
- **未读的语义**：布尔「下面有新东西」，不是「有几条」。用户滚到接近底部但未进容差时圆点仍在
  （下面确实还有内容）；进入容差即清除。这是有意取舍（D3）。
- **滚动通道**：真机场景的上滚依赖 `do: scroll` / wheel mode（§5.3）；chromium 场景用
  `page.mouse.wheel`，是行为层的主判据。

## 7. 起草期裁决点

逐条与 [proposal.md](proposal.md) 的 D1–D8 对应；本设计的取值按「倾向」列写成。**若 Alex 裁
另一侧**，改动落点：

| 裁决点 | 倾向（本设计已落） | 裁另一侧时的设计改动 |
|---|---|---|
| D1 几何判据 | 无显式开关 | 需要新增开关控件 / 快捷键 + 冲突规则（「开关开着但用户上滚」谁赢），本设计 §2 的 reducer 要加第三态 |
| D2 钮何时可见 | 脱离即显示 | 只在新内容时显示：`render` 条件改为 `phase === "detached" && unread` |
| D3 未读形态 | 圆点无数字 | 数字：需定义计数单位与清零时机（新增数据面），未读基线从 `scrollHeight` 改成事件计数 |
| D4 键盘 | 不新增键位 | 新增快捷键 / transcript 可聚焦：键位表、焦点环、Space 归属另立合同 |
| D5 强制白名单 | 仅用户动作 | 批准卡 / 错误强制回底：§3.1 的第 7–9 行改强制，MODIFIED 的错误条款回到「恒滚到可见」，并需接受阅读被打断 |
| D6 脱离存续 | 跨轮次保持 | 每轮开始回底：在 `sent` / `auto_turn_started` 加 `jumpToBottom()` |
| D7 钮形态 | 右下角圆形浮钮 | 顶部横幅 / 行内条：§4.1 的 DOM 与盒模型账重做 |
| D8 阈值 | 6 / 16px 滞回 | 单一阈值 / 更大阈值：只改常量与 §5.1 的滞回断言 |

## 8. 改动面与文件清单（实现期）

| 文件 | 改动 |
|---|---|
| `src/harness-scroll-lock.ts` | 新增：§2 的纯函数 + 控制器 |
| `tests/unit/harness-scroll-lock.test.ts` | 新增：§5.1 的真值表与控制器断言 |
| `src/harness-panel.ts` | 16 处调用点分流（§3.1）、scroll 监听（§3.2）、rAF 未读补扫（§3.3）、resize（§3.4）、浮钮 DOM / 文案 / 态渲染、`resetView` / `attachTo` 接线 |
| `src/harness-panel.css` | §4.1 的视口容器、§4.2 的浮钮与圆点（只消费 token；eink 与 reduced-motion 分支） |
| `src/copy-data.ts` / `文案-Copy.md` | 两条新文案（D551 起），deck 与运行时表同批 |
| `tests/visual/scenes/m638-harness-scroll-lock.spec.ts` | 新增：§5.2 的行为场景（不新增像素基线） |
| `scripts/acceptance/scenarios/<编号>-harness-scroll-lock.md` + `fixtures/harness-mock-scroll-lock.json` | 新增：§5.3 的真机场景（编号按当时批次号续，不复用） |
| `scripts/acceptance/lib/cgevent-click.swift` | **仅当** §5.3 的 scroll 探针仍产不出位移：补 wheel mode |

单一真源检查：阈值只在 `src/harness-scroll-lock.ts` 定义一次；面板不重复比较，css 不写阈值；
场景不写阈值（用行为断言，不 assert 6 / 16 这两个数——它们是实现精度，不是产品语义）。
