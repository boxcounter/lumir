# Design: 生成中进度的输出尾行

> 本文件写实现合同与取舍，不是实现记录。行号是起草时（2026-11-23）的读数，实现时以符号为准。
> 节点状态见 [proposal.md](proposal.md)：节点 1 已批准——Alex 2026-11-24 回复「同意。」，D1–D6 按
> 推荐值生效。两个前序均已归档且审计 PASS，排版基线已获 Alex 批准落盘；本次实现提交不归档。

## 0. 前置门禁（硬）

三项 change 的顺序固定为 `fix-harness-approval-visibility-nov23` →
`refine-harness-typography-nov23` → 本 change。本 change **必须最后落**：

1. **两个前序都已归档**：`fix-harness-approval-visibility-nov23` 与
   `refine-harness-typography-nov23` 均已归档，开工已分别复跑
   `node scripts/openspec-archive-check.mjs --archived <change-id>` 并 PASS。
2. **排版新基线已批准落盘**：`refine-harness-typography-nov23` 的 20 张候选视觉基线已经 Alex 逐张
   过目、批准并落盘；本 change 的 running 候选仍需独立过目，不得当正式基线。
3. **delta 以两前序归档后的 living 为基线**：living「进度呈现」已**整块重抄**进本 change 的
   delta——24 个 living scenario 全部逐条保留，另加 19 个尾行 / 排版承接 scenario。MUST NOT 只写
   改动段，MUST NOT 在未复核的情况下直接归档，否则归档时整块替换会抹掉审批前序新增的终态撤回 /
   idle stale / enter 前置 / 清算矩阵 / 发送最终几何等条款，以及排版 change 的阅读密度 / token 条款。
4. **承接排版几何**：阶段行取 `--text-2`；transcript gap 16px，尾行 4px 净间距用
   `calc(var(--sp-2) - var(--sp-8))`；空态绝对定位四边 `top/right/left: var(--sp-8);
   bottom: var(--sp-6)`，并继承 13px/1.58、`--text-2`、24px padding。MUST NOT 恢复排版前的阶段色、
   间距公式或空态配方；排版归档后的 living / CSS 是唯一基线。
5. **「idle 零漂移」的基准**：只相对于 `refine-harness-typography-nov23` 归档后的新 idle 基线成立；
   MUST NOT 承诺相对排版前旧基线的零漂移，也不得为凑零漂移恢复排版前旧值。
6. 合并后的文案优先级：`stopping > approval > midTakeover > waiting/generating`。`approval` 是
   前置的 `pendingApprovals` 派生信号，不是新相位；待批优先于接管。
7. 集成测试：尾行在 transcript 内时，`enter_snapshot(in_flight=true) + pending` 读「等待批准…」
   且标题栏信号仍在；脱离态下待批到达时标题栏信号仍在、`scrollTop` 不变。

## 1. 施工前事实底座（基线 `16216a1f`，逐条可核）

F7 / F8 / F15 的样式读数按 `refine-harness-typography-nov23` 归档后的施工基线写；排版前的旧值不是
本 change 的合同起点。位置列只写稳定符号，避免实现后的行号漂移把历史事实误读成当前形态。

| # | 施工前事实 | 基线符号 |
|---|---|---|
| F1 | 进度 DOM = `.lumir-hp-progress`（阶段行 + 3px 条形），空闲时 `hidden` | `progress` / `stageLine` / `barTrack` |
| F2 | 进度挂在 transcript 视口**之外**、composer 之上 | `panel.append(transcriptViewport, progress, …)` |
| F3 | 显隐只由相位翻一位：`progress.hidden = !running` | `applySendPhase` |
| F4 | 阶段文案三档：D381 / D382 / D400；语言切换经 `applyStage` 重取 | `stageCopyKey` / `applyStage` |
| F5 | 只有首个 `text_chunk` 把 `stageWaiting` 翻假；`reasoning_chunk` / `tool_call` 先到时不翻（缺陷） | `handleEvent` 的三个分片分支 |
| F6 | 流式泡在首个 reasoning / tool / text 分片时才创建（等待期无宿主） | `ensureStreamingMessage` |
| F7 | transcript 是 `overflow-y:auto` 的 flex 列；施工基线取排版归档后的 gap 16px（`--sp-8`）与 `16px 16px 12px` 外侧 padding | `.lumir-hp-transcript` |
| F8 | 进度块当前自带左右 padding（补 transcript 之外的留白），移入 transcript 后必须去掉，避免与容器 padding 叠加 | `.lumir-hp-progress` |
| F9 | 条形 3px、`margin-bottom: --sp-2`；eink 下明度双档脉冲 | `.lumir-hp-bar[-fill]` |
| F10 | 空态判据用 `transcript.childElementCount` | `syncEmptyHint` |
| F11 | 跟滚控制器：`contentGrew` / `contentReplaced` / `viewportChanged` / `reset`；detached 零写入；未读基线取 `scrollHeight` | `createFollowController` |
| F12 | 终态分支：`done` 定稿后派发终态；`aborted` 先补「已停止」标记、后派发终态；`error` 先派发终态、后追加错误行 | `handleEvent` 的 `done` / `aborted` / `error` |
| F13 | 中途接管：`enter_snapshot` 置 `midTakeover`，但未把 `stageWaiting` 置假；`resetView` 会把它置真 | `projectActivity` / `resetView` |
| F14 | 快照重建经 `clearTranscriptSurface()` 清空 transcript（尾行节点会被一并移除） | `clearTranscriptSurface` |
| F15 | 排版归档后空态 `.lumir-hp-empty` 仍靠 flex 内容盒的剩余空间居中（13px/1.58、`--text-2`、24px padding）——尾行占位后提示会移动 | `.lumir-hp-empty` |
| F16 | 顶层 `transcript.append` 有 12 处直接写入，含 compact 标记、孤儿工具块、快照 assistant | 各顶层渲染函数 |
| F17 | `compact` 事件在 `done` 前调用 `appendCompactMarker`，此刻进度可能仍可见 | `appendCompactMarker` |

结论：尾行方案不需要新事件、不需要后端配合；需要新增三个机制——「布局变化」与「新内容」在跟滚
模型里的区分、transcript 顶层追加的唯一入口 + 运行时兜底、空态几何与 flex 剩余空间解耦。

最终实现符号为 `progressTailView`（纯模型）、`applySendPhase`（相位 / 尾行布局）、`applyStage`
（文案）、`markAssistantOutputStarted`、`appendTranscriptNode` + `ensureTailLast` +
`transcriptTailObserver`、`transcriptHasContent` 与 `FollowController.layoutMutated`。

## 2. 结论与不变量

### 2.1 采用形态

`.lumir-hp-progress` 成为 `.lumir-hp-transcript` 的子节点，视觉上永远排在其余子项之后；相位进入
处理中时挂到尾位，空闲时隐藏（`display:none` 不参与 flex 布局，零像素、零间距）。transcript 重建
（快照 / 恢复）会移除该节点，下一次进入处理中时重新挂上；节点对象本身始终是同一个。

所有 transcript 顶层追加 SHALL 经唯一 helper `appendTranscriptNode(node)`（append + `ensureTailLast`）。
另设 `childList` MutationObserver 兜底：任何绕过 helper 的追加（现有 compact 标记 / 孤儿工具 /
快照 assistant，或未来新增路径）在回调里重新置尾。正常路径由 helper 同步保证；兜底保证契约不依赖
人工枚举调用点。

### 2.2 不变量（评审按这几条核）

1. **单一元素**：整个运行期同一节点；文案换字不换节点。
2. **最后可见项**：运行中 `progress` 是 transcript 最后一个可见子项；视觉序由 `order` 保证，
   DOM 序同时置尾。
3. **不遮挡**：文档流占位，非浮层、非 abspos、不补底 padding。
4. **不跳动**：高度恒定；显隐不影响上方内容位置。
5. **空态不误判**：空态提示的判据排除尾行；提示的几何位置不随尾行显隐变化。
6. **detached 零写入**：尾行显隐只补偿**自身布局增量**到未读基线，不点未读、不写滚动位；同一批
   真实内容增长仍照常点亮未读。
7. **终态先离场**：先隐藏尾行，再落终态标记 / 错误行。
8. **写点分工**：`applySendPhase` 是按钮态、显隐、挂载 / 置尾、`data-phase` 与布局测量的唯一
   入口；`applyStage` 是阶段文案的唯一 DOM 写点，由相位施加、首个有效产出推进、审批集合变化
   重施与语言重绘共同调用。文本重施 MUST NOT 另写显隐、位置或条形形态，也 MUST NOT 触发置尾、
   贴底或布局测量。
9. **顶层追加唯一入口**：helper 同步置尾，`childList` 兜底覆盖绕过路径；MUST NOT 靠逐个调用点
   人工枚举。

## 3. DOM 与样式合同

### 3.1 结构

```
.lumir-hp-transcript-viewport
  .lumir-hp-transcript
    …既有子项（order: 0）…
    .lumir-hp-progress            ← order: 1；hidden 时 display:none
      .lumir-hp-stage             ← 单行文本（nowrap + ellipsis）
      .lumir-hp-bar
        .lumir-hp-bar-fill
  .lumir-hp-jumpbottom            ← 仍在视口层，不随内容滚动
```

### 3.2 CSS 规则（逐条）

- `.lumir-hp-progress`：去掉自身左右 padding（transcript 已有左右 padding），改为 `padding: 0`；
  `order: 1`；`margin-top: calc(var(--sp-2) - var(--sp-8))`——transcript gap 为 16px（`--sp-8`），
  尾行与上方末条的净间距为 16px gap + (4px − 16px) margin = 4px（`--sp-2`）。`[hidden] { display: none }`
  保留。
- `.lumir-hp-stage`：颜色取 `--text-2`（排版 change 已升档，本 change 不重复声明，也 MUST NOT
  改回排版前的阶段色）；`white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`
  `margin-bottom: 4px` 保留（与条形的最小分隔）。
- `.lumir-hp-bar`：`margin-bottom: 0`（尾行之后由 transcript 的底 padding 收尾）；高度 3px 不变。
- `.lumir-hp-bar-fill`：不变（宽度 40%、`translateX` 动画）。
- 停止冻结：尾行带相位标记（如 `data-phase="stopping"`），
  `.lumir-hp-progress[data-phase="stopping"] .lumir-hp-bar-fill { animation: none; }`；
  冻结后条形停在静态基准位（无位移）。eink 的 `width: 100%` 与 `animation: none` 叠加后是
  一条静态满宽条。
- `prefers-reduced-motion`：既有条形没有降级分支，本 change 不新增；停止冻结与减少动效无关。

### 3.3 高度恒定

高度 = 阶段行行高（`--fs-meta` × 排版归档后 transcript 的 `--lh-chat` 1.58）+ 4px + 3px。三者都与
文案 / 语言无关：

- 单行 `nowrap` + `ellipsis`：长文案不换行；
- 文案切档不重建节点，浏览器不会重算行盒结构；
- 条形高度是固定 px，不受字体影响。

eink 只改 `width` / `animation`，不改高度。

## 4. 相位与文案

### 4.1 状态来源

| 来源 | 状态 | 落点 |
|---|---|---|
| `sent` / `auto_turn_started` | running，`stageWaiting = true` | `dispatchActivity` → `applySendPhase` |
| 首个有效助手产出（`reasoning_chunk` / `tool_call` / `text_chunk` 任一） | `stageWaiting = false` | 三者共用的 `markAssistantOutputStarted()` → `applyStage()` |
| `stop_clicked` | stopping | `dispatchActivity` → `applySendPhase` |
| `enter_snapshot(inFlight=true)` | running + 接管 | `dispatchActivity` → `applySendPhase` |
| `terminal` / `local_finish` / `vault_changed` | idle | `dispatchActivity` → `applySendPhase` |

现行代码只有 `text_chunk` 翻假（F5）；`reasoning_chunk` / `tool_call` 必须先调用同一个推进函数，
否则「先思考 / 先调工具、全程无正文」会一直停在 D381。推进函数只翻 `stageWaiting` 并调
`applyStage()` 重施阶段文案，不改相位、不建节点、不触发布局测量；重施加仍沿用 `text_chunk` 的
既有守卫——仅 `activity.phase !== "idle"` 时调用，迟到分片不得把已收口的尾行写回。

### 4.2 写点分工与施加顺序

写点按职责拆开，两者都不复制对方的逻辑：

- `applySendPhase(next)`：按钮态、尾行显隐、挂载 / 置尾、`data-phase` 与对应
  `layoutMutated` 布局测量的唯一入口。顺序固定：
  1. 按钮态（既有）；
  2. `progress.hidden = next === "idle"`；
  3. 若 running：确保节点在 transcript 内、且是最后一个子节点（`ensureTailLast()`）；
  4. `progress.dataset.phase = next`（停止冻结的判据）；
  5. 调 `applyStage()` 写文案（同一入口的收尾步骤；布局测量已在步骤 2–4 前后完成）。
- `applyStage()`：阶段文案的唯一 DOM 写点。调用方包括 `applySendPhase`、首个有效产出推进
  （`markAssistantOutputStarted()`）、审批前置的 `refreshApprovalSignal()` 重施与语言重绘
  （`onRelabel`）。它只写阶段行文本，MUST NOT 改显隐、位置、`data-phase` 或条形形态，
  MUST NOT 触发置尾、贴底或布局测量。语言重绘还需重取按钮文案，因此最终接线允许
  `applySendPhase(renderedPhase, /* relabelOnly */ true)`：只执行步骤 1 与步骤 5，明确跳过步骤 2–4。

文案优先级（`applyStage`）：

```
stopping → D400
approval（running + pendingApprovals 非空）→ 等待批准…
midTakeover → D983「正在继续本轮…」
stageWaiting → D381
否则 → D382
```

- `stopping` 必须最高：接管中途用户点停止，读「正在停止」而不是「正在继续 / 等待批准」。
- `approval` 在 `midTakeover` 与 `stageWaiting` 之前：待批是前置 change 的派生信号（不是新相位），
  轮次实际阻塞在用户决策；接管期有 pending 时读「等待批准…」，MUST NOT 读「正在继续本轮…」。
- `midTakeover` 在 `stageWaiting` 之前：接管期已经有过输出，不能读「等待响应」。
- 工具循环期没有单独档位（D4）：`stageWaiting` 已为假，读 D382。

文案重施路径（首个有效产出、审批集合变化、语言切换）只换文本，不重跑 `applySendPhase` 的步骤
2–4；不得因此额外置尾、贴底或测量布局。按钮语言重取只允许走上述 `relabelOnly` 短路，不得形成第二处
按钮状态写点。

### 4.3 终止次序

- `done`：`finalizeStreamingMessage()` → `dispatchActivity(terminal)`（尾行隐藏）。既有顺序已满足。
- `aborted`：**先** `dispatchActivity(terminal)`（尾行隐藏）**再**补「已停止」标记。现状是标记
  先落、终态后派发，必须调整；未读口径不变（`aborted` 不产生未读），`follow.contentGrew()`
  仍由标记追加触发。
- `error`：既有顺序已是「先终态、后错误行」，保持；只需确认尾行在同一次相位施加里隐藏。

终态分支 MUST NOT 为了「先隐藏」而新增第二处写 `progress.hidden`；隐藏必须仍由 `applySendPhase`
完成（显隐的唯一写点）。调整的是分支里**调用次序**，不是写点。

### 4.4 中途接管

`enter_snapshot` 的 `inFlight=true` 分支：

- `midTakeover = true`（既有）；
- `stageWaiting = false`（**新增**）——接管期已有输出，不能先闪「等待响应…」；
- 若快照同时带非空 `pending_approvals`，阶段行读「等待批准…」（approval > midTakeover），
  MUST NOT 读「正在继续本轮…」；标题栏审批信号由前置 change 提供，不随尾行位置变化；
- 快照重建完成后，`applySendPhase` 的 running 分支把尾行重新挂到 transcript 末尾（F14：重建会
  把节点清掉）。

### 4.5 顶层追加唯一入口 + 运行时兜底

唯一 helper：

```ts
function appendTranscriptNode(node: Node): void {
  transcript.append(node);
  ensureTailLast();
}
```

`ensureTailLast()`：若 running 且 `progress.parentElement !== transcript` → append；若 running 且
`transcript.lastElementChild !== progress` → append（append 已有节点即移动）。幂等。

`childList` MutationObserver（观察 transcript，`subtree: false`）：

- 回调只做 `ensureTailLast()`；
- 守卫：本批没有顶层 `addedNodes`（例如 `replaceChildren()` 清空）→ 直接返回；`progress.hidden`
  （空闲 / 非处理中）→ 直接返回；`transcript.lastElementChild === progress` → 直接返回（防循环）；
- 观察器是**兜底**：现有 12 处顶层 append（compact 标记、孤儿工具块、快照 assistant、通知、错误、
  批准卡等）与未来新增路径都被覆盖，**不需要在 design 里维护调用点清单**；
- 正常路径仍走 helper（同步序正确）；绕过路径由观察器在微任务里纠正，相关 DOM 断言等一帧再判；
- `clearTranscriptSurface()` 的 `replaceChildren()` 是清空，不置尾；清空后在途的尾行由下一次
  `applySendPhase` 或后续 helper 挂回。观察器只保证「有顶层追加时尾行在末位」，不承担相位收口。

`order: 1` 是视觉兜底；DOM 序由 helper + 观察器守住。观察器只处理顶层 childList，流式正文分片在
消息元素内部增长，不触发它；快照重建的一批 append 在微任务里合并为一次置尾。

## 5. 跟滚模型

### 5.1 新增入口

`FollowController` 增加：

```ts
/** 非内容性的本地面布局变化（进度尾行显隐、重挂）：只补偿布局增量，不是新内容。
 *  following：排一次贴底（尾行在视口内可见）；
 *  detached：unreadBaseline += deltaPx（clamp ≥ 0），不改态、不点未读、不写滚动位。 */
layoutMutated(deltaPx: number): void;
```

`deltaPx` MUST 只由尾行自身的布局变化测量：`applySendPhase` 在改 `progress.hidden` / 置尾 /
`data-phase` 之前读一次 `transcript.scrollHeight`，这些步骤完成后读一次，传差值。MUST NOT 把同一批
内容追加或纯文案重施的高度算进来；`applyStage` 的文本重施路径 MUST NOT 测量或调用 `layoutMutated`。

为什么不是复用 `contentGrew`：它会把增量判成「有新内容」，detached 下点亮未读（正是要避免的
假未读）。为什么不是 `viewportChanged`：它管视口尺寸变化，且 following 下会排写底；尾行显隐
不是视口变化，detached 下也不应写底。

### 5.2 调用点

- `applySendPhase` 的布局三件事（`hidden` / 置尾 / `data-phase`）包在一段里，前后各读一次
  `transcript.scrollHeight`，完成后 `layoutMutated(after - before)`；随后调 `applyStage()` 写文案，
  文案不计入 delta；
- 快照重建后重挂尾行同样只测这一段的差值；
- `applyStage` 的文本重施路径（首个有效产出、审批集合变化、语言重绘）不测量、不调
  `layoutMutated`、不置尾、不贴底；
- 空闲态重建（尾行被清掉、没有重新挂）不调用——transcript 已由 `reset()` 写底。

### 5.3 为什么不能把当前总高度当新基线

反例（评审现场）：detached 基线 `H0` → 真实内容增加 `C` → 尾行隐藏减少 `P` → `layoutMutated` →
`contentGrew`。若 `layoutMutated` 把 `H0 + C - P` 直接设为基线，`contentGrew` 看不到 `C`，真实未读
被吞。按 `deltaPx = -P` 补偿后基线是 `H0 - P`，`contentGrew` 仍能看到 `H0 + C - P > H0 - P + 1`。

顺序：尾行 DOM 变化 → `layoutMutated(delta)` →（若有新内容）`contentGrew()`。following 下
`layoutMutated()` 自己排一次贴底，因此自动回合 / cron 这类**不经过 `jumpToBottom()`** 的轮次开始时，
尾行出现也会被带进视口。普通用户发送走 `follow.jumpToBottom()`（白名单），**不能**用来做 detached
反例；detached 测试与真机步骤必须用 `auto_turn_started` / 后台通知等不强制回底的入口。

## 6. 空态：判据与几何

### 6.1 在场判据

`syncEmptyHint()` 改为「除尾行与空态提示之外没有任何子节点」：

```ts
function transcriptHasContent(): boolean {
  return Array.from(transcript.children).some((el) => el !== progress && el !== emptyHint);
}

if (!transcriptHasContent() && !transcript.contains(emptyHint)) appendTranscriptNode(emptyHint);
else if (transcriptHasContent() && transcript.contains(emptyHint)) emptyHint.remove();
```

空态提示本身也是 transcript 的子节点，判据必须同时排除 `progress` 与 `emptyHint`；实现时用一个
具名 helper（如 `transcriptHasContent()`）收口，MUST NOT 在两处各写一份。

### 6.2 几何：不参与 flex 剩余空间分配

现行（排版归档后）空态仍在 flex 列里靠**内容盒**的剩余空间居中（排版 change 只改字号 / 颜色 /
padding，未改居中方式）；尾行一占位，剩余空间变小，提示就会上移。改为绝对定位，但必须**保持排版后的
内容盒中心**，而不是以 padding box 的 `50%` 居中：

```css
.lumir-hp-empty {
  position: absolute;
  top: var(--sp-8);
  right: var(--sp-8);
  bottom: var(--sp-6);
  left: var(--sp-8);
  display: grid;
  place-items: center;
  margin: 0;
  pointer-events: none; /* 纯文本，不拦截 transcript 的点击 / 滚动 */
}
```

- 排版归档后 transcript 的 padding 为 `var(--sp-8) var(--sp-8) var(--sp-6)`（16/16/12px）；现行
  flex 内容盒居中（本 change 施工前）的中心 = `H/2 + (var(--sp-8) - var(--sp-6))/2` = `H/2 + 2px`；
- `top/right/left: --sp-8`、`bottom: --sp-6` 让绝对盒恰好覆盖原内容盒，`grid` + `place-items:center`
  把文本居中在同一中心；元素自身的 24px padding 四边对称（排版 change 已改为 `--sp-10`），不改变中心；
- **MUST NOT 用 `top:50%` + `translateY(-50%)` 直接居中**：那是 padding box 的 50%，中心是 `H/2`，
  比排版后的 idle 中心高 2px，违背「相对排版后基线零漂移」。若不用四边定位，等价写法是
  `top: calc(50% + (var(--sp-8) - var(--sp-6)) / 2); transform: translateY(-50%)`；
- 绝对定位的包含块是 `.lumir-hp-transcript` 的 padding box（它已是 `position: relative`）；
  尾行改变的是内容高度，不是包含块高度，因此尾行显隐不移动提示；
- 字号 13px/1.58、`--text-2`、24px padding 全部继承 `refine-harness-typography-nov23`；本 change
  MUST NOT 改动字号 / 颜色 / padding，MUST NOT 用绝对定位顺手改回旧空态配方；
- 内容出现时提示被移除，不存在与正文重叠；仅空态 + 尾行时若视口极矮，二者可能接近，属已知边界。

判据必须分两层：

1. **排版后 / 本 change 后 idle 对账**：在排版归档后的实现（本 change 施工前）记录空态提示的中心
   （`cx0`, `cy0`），改造后断言 `|cx - cx0| ≤ 1px`、`|cy - cy0| ≤ 1px`。只测「尾行显隐前后不变」
   抓不到「本 change 的 idle 已整体上移 2px」；MUST NOT 以排版前旧基线为对账起点；若有意接受 2px，
   必须改 D6 并按基线人肉裁决流程处理，不能继续声称零漂移。
2. **尾行显隐不移动**：尾行出现 / 消失前后提示 `top` 位移 ≤1px；正控制用尾行自身
   `getBoundingClientRect()`（高度 >0、落在 transcript 视口内），不单独依赖 `scrollHeight`
   （空态下它有 `clientHeight` 下限）；若把视口压到小于尾行高度，再补 `scrollHeight` 差值 >1px。

## 7. 测试与验收矩阵

| 判据 | 机器层 | 真机层 |
|---|---|---|
| 尾行在 transcript 内、是最后可见子项 | 结构断言：`.lumir-hp-transcript > .lumir-hp-progress` 存在；`lastElementChild` 是它；`order` 计算值 = 1 | AX 无 containment，不判；截图留证 |
| 首个有效产出即离开等待 | 事件级测试：只发 `tool_call` / 只发 `reasoning_chunk`，**全程无 `text_chunk`** → D382（旧实现停在 D381，必红）；纯模型矩阵只作补充，不能替代事件级用例 | 新场景：工具先行 |
| 三档文案 + 中途接管句 | 纯模型单测：相位 × `pending` × `stageWaiting` × `midTakeover` → 文案键 / 可见 / 条形形态；m347 断言文案 | 88 / 97 / 104 既有 AX 文本断言逐字不变；新场景补接管 |
| 待批优先于接管 + 标题栏信号 | 集成：尾行在 transcript 内 + `enter_snapshot(in_flight=true) + pending` → 阶段行读「等待批准…」、条形态不定态；脱离态待批 → 标题栏审批信号仍在、`scrollTop` ≤1px | 新场景：AX 读「等待批准…」+ 面板收起后 toggle help |
| 不遮挡 | 几何：尾行 `top` ≥ 末条内容的 `bottom`；滚动到底时尾行 `bottom` ≤ 滚动区 `bottom` | 截图（手感归 Alex） |
| 不跳动 | 几何：等待 → 生成之间尾行高度不变；与末条内容的绝对净间距为 4px（±1px），相位切换前后恒定；节点 identity 不变 | 截图 |
| 顶层追加路径不越过尾行 | running 中触发 `compact` 标记、无 assistant 宿主的工具记录、快照 assistant 重建，各断言 `lastElementChild === progress`；再直接 `transcript.append` 一个节点，等一帧后观察器把尾行移回末位 | 可并入新场景（compact / 孤儿工具截图） |
| detached 下不拽视口、不假未读 | `tests/unit/harness-scroll-lock.test.ts`：尾行单独显隐不点未读；`H0 → +C → -P → layoutMutated(-P) → contentGrew` 必须未读；m638 用 `auto_turn_started`（**不用普通发送**）扩展「上滚后轮次开始 / 结束」 | `scrollTop` 在 AX 读不到，归截图证据 |
| 终态次序 | m347 扩展：`error` / `aborted` 后尾行隐藏、错误行 / 已停止标记在尾部 | 88 / 97 的「阶段行离场」断言 |
| 空态在场判据 | m303 / m347：只有尾行时提示仍在；有消息时提示不在 | 新场景 / 既有空态截图 |
| 空态几何不随尾行移动 | m347：仅空态 + 尾行时，尾行显隐前后提示 `top` 位移 ≤1px；**另测排版后 idle（本 change 施工前）vs 本 change idle 中心差 ≤1px** | 截图；相对排版后 idle 整页基线零漂移 |
| eink | 计算样式：停止态 `animation-name: none`；eink 明度分叉在场 | 截图 |
| 基线 | `scripts/gate.sh visual`；相对排版归档后的 idle 整页基线零漂移；running 态只出候选 | 候选截图交 Alex 过目 |

## 8. 视觉口径（无原型）

本 change 没有新原型，视觉口径按既有设计系统与 token 落：

- **位置**：transcript 文档流末尾；与末条内容的净间距为 4px（排版后 16px gap 与
  `margin-top: calc(var(--sp-2) - var(--sp-8))` 的 -12px 叠加）；左右与 transcript 内容同边。
- **字层级**：阶段行沿用 `--fs-meta` 与排版后的 `--text-2`（不升字号、不加粗）；本 change MUST NOT
  改回排版前的阶段色。
- **条形**：3px、`--border-soft` 轨道、`--accent` 填充；停止态静态基准位；eink 满宽 + 明度双档。
- **动效**：只作用于 `transform` / `opacity`；无淡入淡出、无高度动画。
- **空态**：绝对定位居中（不参与 flex 剩余空间分配）；字号 13px/1.58、`--text-2`、24px padding
  继承排版 change，本 change 不改。
- **不新增颜色 / 阴影 / 圆角**；不引入新的视觉件。

手感（出现 / 消失的节奏、长文案截断是否可接受）归 Alex 真机裁决，不进机器判据。

### 8.1 基线落地补充（2026-11-24）

Alex 已明确「批准进度尾行基线」。本次只更新审阅页中的 10 张 running 基线：light / dark / eink
各 narrow / wide / ultrawide 共 9 张，加 `harness-typography-empty-running`；其余 98 张基线和容差一律
不改。替换前后哈希清单证明 10 张目标与批准来源逐张一致，其余 98 张逐字节不变；light-narrow 另做
「新图 PASS → 旧图必 FAIL（10769 像素差）→ 新图恢复 PASS」的区分度验证。证据在主仓
`.local/reviews/ux-improvements/progress-tail-candidates/baseline-update-manifest-{before,after}.json` 与
`baseline-{new,old,restored}-light-narrow-*.log`。

final r2 对 `7bbd9010` 判 clean / merge；727 真机 1/1 PASS、40 断言、92.7s，88 / 97 / 104 相关
场景均 PASS。完整 `LUMIR_VISUAL_PORT=4398 scripts/gate.sh visual` 最终为
`GATE RESULT: 15/15 PASS（SKIP 0）`、退出码 0（1368 passed / 0 failed / 1 skipped）。上述批准、真机与
门禁证据共同满足节点 2 的独立验收面，不扩大 D6 的历史授权范围到其他基线。归档提交为 `44410018`，
随后 `--archived` 审计 PASS（对比 59 段，人工恢复 0 段，声明认领 0 段）。

## 9. 风险与已知边界

1. **28px 历史现场**：旧位置对视口高度的影响已记录在跟滚控制器注释里；新位置改为「内容高度」
   变化，`layoutMutated(deltaPx)` 是对应的新入口。基线只补偿尾行自身的增量；若实现里改成「当前
   总高度」，同一批的真实内容增长会被吞（§5.3 的反例）。若只在 following 下测试，detached 的
   假未读 / 吞未读都不会被发现——m638 与滚动单测必须显式覆盖，且用 `auto_turn_started`。
2. **DOM 序漏更新**：`order: 1` 兜住视觉序，但读屏 / 全选顺序可能退回。收口成唯一 helper +
   `childList` 观察器兜底；不维护调用点清单。观察器回调只做一次 `append`，快照重建的一批追加在
   微任务里合并，不随流式分片触发。
3. **首个有效产出**：只把 `text_chunk` 当推进（现行代码）会让「先思考 / 先调工具、全程无正文」
   停在 D381。三者共用推进函数；事件级测试必须只发 `tool_call` / `reasoning_chunk` 验证，纯模型
   矩阵不能替代（它可以手工预设 `stageWaiting=false`，绕开缺陷）。
4. **空态绝对定位的 2px 陷阱**：排版归档后 transcript padding 是 `sp-8/sp-8/sp-6`；现行 flex
   内容盒居中（本 change 施工前）的中心是 `H/2 + (var(--sp-8) - var(--sp-6))/2 = H/2 + 2px`。若新样式
   用 `top:50%` 直接居中，中心是 `H/2`，会相对排版后的 idle 中心整体上移 2px。必须用
   「top/right/left `--sp-8`、bottom `--sp-6`」的内容盒四边 + grid 居中（或等价补偿公式），并做
   「排版后 idle（本 change 施工前）中心 vs 本 change idle 中心 ≤1px」对账；只测尾行显隐前后不变
   抓不到这个整体位移。仅空态 + 尾行的极矮视口下二者可能接近，属已知边界。
5. **停止冻结的观感**：冻结后条形停在 40% 基准位，可能被读成「进度卡在 40%」。这是刻意的
   「非推进」信号；若 Alex 真机觉得像故障，备选是停止态整条淡出只留文字（需另裁）。
6. **中途接管句的取号**：D3 批准后取 deck 下一个未占用号；实现前复核末位为 D982，实际取 D983。
7. **快照重建期**：`clearTranscriptSurface` 会移除尾行；重建完成到下一次 `applySendPhase` 之间
   若有短暂空窗，尾行不在场——快照重建本身是同步批次，窗口在一帧内，不构成可见闪烁。
8. **粘性多行内容**：尾行是 flex 子项，若将来有子项设 `order > 1`，尾行不再最后；本 change 在
   CSS 注释里写明「transcript 子项默认 order 0，尾行 order 1 是唯一例外」。
9. **脱离态看不到尾行**：尾行随内容滚动，上滚阅读时它在视口外；本 change 不新增常驻浮层（会遮挡
   正文）。**审批信号的例外**：前置 change `fix-harness-approval-visibility-nov23` 已把标题栏的
   待批信号立为滚动区外不变量；本 change MUST NOT 削弱它——尾行移入滚动区后，待批期间标题栏仍须
   读「等待批准」。这不是本 change 新增的常驻指示，是既有合同的继承。

## 10. 实施顺序

0. **前置门禁**：确认 `fix-harness-approval-visibility-nov23` 与 `refine-harness-typography-nov23`
   均已归档且 `--archived` PASS，排版新基线已获 Alex 批准落盘；以两者归档后的 living 重抄本
   change 的 MODIFIED 块；按排版归档后的 CSS 核对阶段 `--text-2`、16px gap、
   `calc(var(--sp-2) - var(--sp-8))` 与空态四边 `sp-8/sp-8/sp-6/sp-8`；把优先级置为
   `stopping > approval > midTakeover > waiting/generating`；补待批 + 标题栏信号的集成断言。
1. 先红：事件级「只发 tool_call / reasoning」、纯模型矩阵、m347 / m638 结构断言、空态几何、
   顶层追加 DOM 序、`layoutMutated` 反例（旧实现必红）。
2. DOM 与样式（位置、order、单行、空态绝对居中、停止冻结）。
3. 顶层追加 helper + `childList` 观察器。
4. 相位施加（首个有效产出推进、文案优先级、中途接管）。
5. 终态次序（aborted 分支）。
6. 跟滚入口与单测（delta 补偿）。
7. 真机场景与既有场景回扫。
8. 门禁（quick / visual / docs）与候选截图。
