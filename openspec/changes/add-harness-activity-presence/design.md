# Design: harness 面板的活动在场

- Change ID: `add-harness-activity-presence`
- 日期: 2026-10-27
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 本文只写「怎么落」与「为什么这么落」。要不要做、做什么、不做什么见 [proposal.md](proposal.md)；
> 可执行口径以 [specs/harness/spec.md](specs/harness/spec.md) 的 delta 为准。

## 1. 事实底座（实现前必须成立的前提，逐条可核）

| # | 事实 | 位置 |
|---|---|---|
| F1 | 收起 pane = `attachTo(null)`，只摘 DOM；事件订阅、流式态、发送相位长驻 | `src/main.ts:461`、`src/harness-panel.ts:10195-10267` |
| F2 | 事件订阅在构造期装一次，与挂载无关 | `src/harness-panel.ts:9094` |
| F3 | toggle 火花钮常驻标题栏，只有开合两态（`aria-pressed`） | `src/harness-panel.ts:3860`、`src/harness-panel.css:21-61` |
| F4 | 切 vault 后旧 vault 事件一律丢弃，后端工具循环不中断 | `src/harness-panel.ts:8807-8811` |
| F5 | 切 vault 的 `vaultChanged` → `resetView` 把相位刷回 idle、关掉轮次闸门 | `src/harness-panel.ts:9483`、`:9402`、`:9432`、`:9448-9450` |
| F6 | 快照 `StateSnapshot` 无在途读数，`restoreSnapshot` 无从恢复相位 | `src-tauri/src/harness/session.rs:402-429`、`src/harness-panel.ts:9309` |
| F7 | 后端有会话级在途状态（今天是一位 `busy`，本 change 升级为三态轮次状态机），且已有宽容读法 | `src-tauri/src/harness/session.rs:549`、`:757`、`src-tauri/src/harness.rs:459-470` |
| F8 | 在途时 `send` 被 `harness_busy` 拒；`new_session` / 恢复同样被拒 | `src-tauri/src/harness.rs:303-321`、`:475-500` |
| F9 | 相位只有一个写入口 `applySendPhase` | `src/harness-panel.ts:6706` |
| F10 | 无人值守 cron 走隔离 runtime，事件不进当前 transcript；点击发起走交互槽位 | `src-tauri/src/harness.rs:1511-1535`、`src/main.ts:3097-3117` |
| F11 | 终态事件只有三类：`done` / `error` / `aborted`（成功与否由事件种类表达，不由字符串表达） | `src/ipc.ts:479-540`、`src/harness-panel.ts:9023-9088` |
| F12 | **后端先发终态、后释放 busy**：正常完成 `done` 在 `:699`、`release_turn` 在 `:297`（`run_turn_core` 返回之后）；配置级错误 `:259-260` 先 error 再释放；自动唤醒回合 `:1729` 才释放 | `src-tauri/src/harness/turn.rs` |
| F13 | 停止子态由既有 `reduceSendPhase` 承载（`running + stop-clicked → stopping`，重复点击幂等），点击路径在 `:6730-6735` | `src/harness-panel.ts:2368-2379`、`:6730-6735` |
| F14 | `busy` 的**写点只有两个**（`acquire_turn` 置真、`release_turn` 置假）；读点六处：`acquire_turn` 拒绝、`request_abort`（`:360`）、`session_busy`（`:467`）、子运行 `parent_busy`（`subagents.rs:489`）、唤醒合并（`subagents.rs:1122`）、标题任务（`title.rs:727`） | `src-tauri/src/harness.rs:322` / `:396`、`src-tauri/src/harness/session.rs:757-763` |
| F15 | 终态发射点**共 10 个位点 / 11 条发射语句**（与 r3 评审的「11 个调用点」同一口径：`:867` / `:868` 是同一个 `match` 的两个分支；早先只列普通回合的八处，漏了自动唤醒回合两处）：交互回合——配置级 `error` `:259`、panic `error` `:277`、入队失败 `:442`、压缩重试 `:573`、LLM `:581`、空响应 `:640`、正常 `done` `:699`、中止 `:867`（带原因 `error`）/`:868`（`aborted`）；**自动唤醒回合**——配置级 `error` `:1692`（释放 `:1693`）、panic `error` `:1714`（释放 `:1729`）。全部先于 `release_turn` | `src-tauri/src/harness/turn.rs` |

## 2. 落点：为什么是标题栏 toggle 钮（对应 proposal 的 D1）

| 方案 | 收起后在场 | 打扰阅读 | 追加成本 | 结论 |
|---|---|---|---|---|
| **标题栏 toggle 钮（采纳）** | 是（常驻） | 极低（钮在标题栏右端，本就在视野边缘） | 一枚状态点 + 三态属性 | 采纳 |
| 面板 tab 条 / pane 分隔条 | 否 | — | — | 面板收起时 pane 不存在，无承载体 |
| 「回到底部」钮的未读提示 | 否 | — | — | 该钮只在面板内、且只在脱离态出现，面板收起时不存在 |
| 系统通知 / Dock 徽标 | 是 | 高（跨 app 打断） | 权限、去重、点击路由 | 非目标（proposal） |
| modeline / 状态栏 | 是 | 中（离 harness 的入口远，需要额外建立「这是 harness 的」语义） | 新槽位 | 与「不新增常驻 UI」冲突 |

**钮上位置**：状态点锚在钮的右下角（钮 30×28，见 `--layout-tb-btn-*`；点在钮内、不越出钮盒）。
理由：钮面是 14px 火花图标居中，右下角是唯一不与图标本体重叠、又不越出可点区域的位置。

**不新增动画**：在途态用静态空心环表达。理由三条——① 发送钮已有脉冲环，"处理中"的动感语义在面板
内已经建立，标题栏再动是重复且持续的视觉噪声（用户此刻在正文阅读）；② 省掉 `prefers-reduced-motion`
的第三条分支；③ 标题栏常驻元素做无限动画会持续占用合成线程，与 ADR 0002 §6 的性能纪律方向相反。

**零像素漂移**：状态点节点常驻 DOM，空闲态经 CSS（`[data-activity="idle"]` 下 `display:none`）不产生
任何上屏像素。既有 28 个含 toggle 钮的视觉场景（`rg -l 'hp-toggle' tests/visual/scenes`）因此逐像素不变，
不需要更新基线；**新增可见元素低于整页容差预算（6×6 px 远小于 1200×800×0.001 ≈ 960 px），其「在场」
必须由结构断言守卫，不能指望整页像素**（`tests/visual/README.md`「新增场景」第 5 条）。

## 3. 状态模型（纯函数，零 DOM；相位仍由既有 reducer 产出）

```ts
// 面板外部可见的状态。相位沿用既有 SendPhase，且**只由 reduceSendPhase 产出**（见下）
type ActivityUnread = null | "reply" | "failure";

interface ActivityState {
  phase: SendPhase;        // idle | running | stopping —— 本模块不自己算，逐条委托 reduceSendPhase
  unread: ActivityUnread;  // 面板收起期间产生的终态结果
}

type ActivityEvent =
  | { type: "sent" }                 // 用户发送（= 新轮开始）
  | { type: "auto_turn_started" }    // 唤醒链自动回合（= 新轮开始）
  | { type: "stop_clicked" }         // 用户点击停止（M756 r1 P2-2：必须在此显式建模）
  | { type: "terminal"; kind: "done" | "error" | "aborted"; mounted: boolean }
  | { type: "enter_snapshot"; inFlight: boolean; epochAtRequest: number; epoch: number }  // inFlight ← 快照键 in_flight
  | { type: "opened" }               // 面板挂载（= 已读）
  | { type: "vault_changed" };       // 作用域切换（视图复位）
```

**r2 P2-1 删掉的两样东西**：本地终态记忆（原 `afterTerminal`）与「`harness_busy` 即复活」的
`busy_rejected`。两者都只能靠本地推次序去弥补一个分不清「在跑」与「终态已发、未释放」的真值；补齐的正确
位置在后端（§4 的三态轮次状态机），前端因此不保存任何终态记忆。

**单一相位状态机（r1 P2-2 的闭合口径）**：`phase` 的每个跃迁都经既有 `reduceSendPhase`
（`src/harness-panel.ts:2368-2379`），映射关系是——`sent` / `auto_turn_started` → `{type:"sent"}`、
`stop_clicked` → `{type:"stop-clicked"}`、三类终态 → `{type:"finished"}`。唯一写入口仍是
`applySendPhase`（`:6706`）。本模块只新增 `unread` 一个字段，MUST NOT 自行判定相位——否则 `stopping`
会有两个持有者（旧 reducer 一份、新状态机一份），快照恢复也会与本地 stopping 分叉。**任务里的「全表」
测试因此必须覆盖停止路径**，不能只有发送与终态。

转移规则（每条在 spec 的 scenario 或 §10 的确定性用例里有对应断言）：

- `sent` / `auto_turn_started`：`phase = reduceSendPhase(phase, {type:"sent"})`；`unread` 不动。
- `stop_clicked`：`phase = reduceSendPhase(phase, {type:"stop-clicked"})`——**只在 running 时**进入
  stopping，重复点击保持 stopping（与 `src/harness-panel.ts:6730-6735` 的点击路径同一条幂等语义）；
  `unread` 不动。
- `terminal(kind, mounted)`：`phase = reduceSendPhase(phase, {type:"finished"})`（running 与 stopping 都
  收口回 idle，与既有「done / error / aborted 都导向 finished」一致）；`unread`——`mounted === true`
  时为 `null`（结果就在屏幕上），`mounted === false` 且 `done` / `error` 时分别为 `reply` / `failure`，
  `aborted` 时不动（停止是用户按的；此前已有的未读也只由 `opened` 清除）。
- `enter_snapshot`：仅当 `epochAtRequest === epoch`、快照 vault 等于当前 vault、当前相位不是 `stopping`
  时应用；`inFlight === true` ⇒ `running`（接线层同时置 `turnOpen`、置「中途接管」标志），
  `inFlight === false` ⇒ `idle`（**收口**：接线层同时关 `turnOpen`、清「中途接管」标志）。映射只产出
  `running` / `idle`，恢复出的相位不会是 `stopping`。
- `opened`：`unread = null`（**已读清算的唯一入口**——重新打开面板即视为已读；切换 vault 的复位是
  另一条口径，见 `vault_changed`）。
- `vault_changed`：`unread = null`（视图复位；见 §7「跨 vault 的口径」）。这里**不再有**终态记忆要清——
  收口判据在后端的 `in_flight` 上。

**对账路径不进这个 reducer**：终态对账（§5）只重建内容，MUST NOT 以任何形式把快照喂进本模型。

**为什么未读不计数**：流式增量、工具行、通知都不构成「一条消息」这种可数单位，任何数字都是伪造读数——
与 `harness` 既有「回到底部」钮的未读提示同一条纪律（`openspec/specs/harness/spec.md` 的
「transcript 的跟随滚动与回到底部」：未读提示 MUST NOT 使用数字计数）。

**为什么未读由终态种类派生**：`done` / `error` / `aborted` 三个事件就是后端的终态分类，前端只做词映射、
不自行判定成功（REVIEW.md「同一语义两处真源」条：不得把「判成功」建立在字符串字面量上）。

## 4. 相位真源：后端轮次状态机（三态），快照只报 `in_flight`

**为什么本地补偿走不通（r2 P2-1）**：`busy` 只有一位，它把「轮次在跑」与「终态已发、还没释放」压成同一个
真值。前端侧的任何补偿都只能靠本地记忆去猜次序，而两条合法时序恰恰没有记忆可依：

- **终态在离开期间被过滤**：A 发起后切到 B，后端在 B 期间发终态（事件被 `src/harness-panel.ts:8807-8810`
  丢弃）；切回 A 时本地没有任何终态记忆，`busy` 位在这一刻既可能是「新轮在跑」也可能是「旧轮尚未释放」。
- **终态后、释放前的发送拒绝**：前端已消费 `done`，用户在 `release_turn` 之前发送，后端在
  `src-tauri/src/harness.rs:303-319` 返回 `harness_busy`——这次拒绝来自**已经结束**的那一轮。

规则越补越像在给一个分不清状态的真值打补丁。补齐的位置在后端。

**合同：把「终态已发」变成后端的一等状态**。`Session` 的 `busy: bool` 升级为三态轮次状态机：

| 状态 | 含义 | `is_busy()`（协议读） | `in_flight()`（呈现读） |
|---|---|---|---|
| `Idle` | 没有轮次 | false | false |
| `Running` | 轮次在跑、终态未发 | true | **true** |
| `Finishing` | 终态已发、`release_turn` 尚未执行 | true | **false** |

写点各一处，与今天 `busy` 的两个写点（F14）一一对应：

- `acquire_turn`：`Idle → Running`；非 `Idle` 一律拒绝（`harness_busy` 语义逐字不变）。
- **终态发射**：`Running → Finishing`。F15 的 10 个位点 / 11 条语句（交互回合八处 + **自动唤醒回合两处**：
  配置级 `error` `turn.rs:1692`、panic `error` `:1714`）统一经**一个 helper** 置位后再发事件——单一写点，
  漏一处就是假在途。自动回合这两处尤其容易漏：面板在 `auto_turn_started` 已经把相位置 running，而它们
  直到 `:1729` 才释放，窗口与普通回合同形。
- `release_turn`：任意 → `Idle`（保持它今天的幂等语义）。

`is_busy()` 改为 `phase != Idle`，因此 F14 的六个读点语义**逐字不变**（`acquire_turn` 拒绝、`new_session`
拒绝、`request_abort`、`session_busy`、子运行 `parent_busy` 与唤醒合并、标题任务）；新增的 `in_flight()`
只服务面板快照。

**快照**：`harness_state` 增 `in_flight: bool`（空态同形 `false`，键恒在场）。面板**只读这个键**，不看
`busy`——`busy` 是协议位，在 `Finishing` 窗口里它为真而轮次已经结束。

**为什么不是「先 release 再发终态」**：那样会引入反方向的竞态——旧轮 release 之后新轮立刻 acquire 并开始
流式，旧轮终态随后才到；前端会把**新轮**的相位收口成 idle、给它挂一条不属于它的未读，`turnOpen` 也被关掉，
新轮后续分片随之被闸门丢弃。事件流不保证跨轮次序，reorder 只是把窗口从一个方向搬到另一个方向，而且新窗口
里错的是「正在进行的轮次」。本 change 保持发射次序不动，只让读出来的状态精确。

**前端因此没有终态记忆**：`enter_snapshot` 的 `in_flight` 就是权威答案——

- `true`：相位 `running`、`turnOpen` 置真、置「中途接管」标志（切回一个仍在跑的轮次）。
- `false`：相位 `idle`、`turnOpen` 关掉、清「中途接管」标志。**这就是「未观察到的终态」的收口**：后端说
  已经不在跑了，界面就收口，不再等一个永远不会来的事件。

**`harness_busy` 不是在途证据**：真在途时面板是停止态、用户根本发不出去；能发出并被拒只可能落在
`Finishing` 窗口（或快照请求失败造成本地假 idle）。因此拒绝的处置是**再问一次权威的相位**——走**只读相位
通道**（`fetchActivitySnapshot`：只解析快照、按 `in_flight` 应用相位与闸门），MUST NOT 直接改相位（r2 删掉了
无条件复活）。**不走进入档全量恢复**：这条重取发生在**已有内容**的 transcript 上，事前没有 `resetView`，
进入档的 `renderSnapshotMessages` 是逐条 append（历史会再上屏一遍），末尾的 `follow.jumpToBottom()` 还会
把正在阅读的视口拽回底部（实现评审 r1 P1-1 的现场）。

**世代守卫（防「请求在发送前发出、响应在发送后回来」），两道各管一件事**：

- `phaseEpoch`：任何经事件推进的相位变化都 +1；发起快照请求时记下当时的 epoch。响应 epoch 不一致时
  **按档位分开处置**——**进入档只丢弃相位部分**（`applyEnterSnapshot` 不应用 `in_flight`，消息与 usage
  等照旧应用：它是「补内容」的路径，迟到的内容最多让读数旧一拍，而相位被旧读数打回去才是真错）；**只内容
  档整条丢弃**（它是「清面 + 重放」，落地会把请求之后乐观上屏的新消息清掉，实现评审 r1 的追加项）。
- `snapshotSeq`：防「旧请求覆盖新请求」；并且**视图换代（`resetView`）也推进它**——新建会话 / 切 vault /
  cron 切屏之后到达的回包属于上一代视图，落地会把旧会话的消息重放进新视图（相位在 idle → idle 的复位里
  不推进，epoch 那道守卫拦不住，这是实现评审 r1 P1 的现场）。

两道守卫合起来才覆盖三种交错：「同一视图里开始了新一轮」（epoch）、「响应迟到」（seq）、「换了一个会话」
（seq 随视图换代推进）。

**残留**：`Finishing` 窗口内的发送仍会被协议拒绝（`busy` 为真）。这是后端既有行为，窗口是「终态发射 →
`release_turn`」之间的几行代码；界面此时显示空闲，用户重试即成功。本 change 不为此改协议。

**为什么不新增 `turn_state` 事件**：相位在途内已经由 `sent` / `auto_turn_started` / `stop-clicked` /
`done` / `error` / `aborted` 这些事件驱动，再加一路「busy 变更」事件就是同一事实的第二条通道；本轮要补的
只是**恢复**（装载 / 切回 / 恢复会话这三个时点没有事件可依），快照正好是这些时点已经在用的通道。

## 5. 在途轮次的重连续与终态对账

切回一个仍在途的 vault 时，三件事必须一起成立，否则「相位对了但内容仍然错」：

1. **相位**：由**进入快照**的 `in_flight` 恢复（§4）。
2. **闸门**：`turnOpen` 与相位同源恢复——只在进入快照 `inFlight === true` 时置真
   （否则切回后的 `text_chunk` / `tool_call` / `reasoning_chunk` 会被 `GATED_EVENT_TYPES` 当「已结束轮次的
   迟到产出」丢弃）；`inFlight === false` 时一并关闭并清「中途接管」标志（收口）。终态事件把它置假之后，
   MUST NOT 有任何快照或对账路径把它重开。
3. **对账**：切走期间错过的正文没有任何本地副本——那些分片在过滤时就丢了。因此本轮 SHALL 记住「这是一次
   中途接管」，在终态事件到达时按后端快照重建一次渲染面（**只内容档位** `restoreSnapshot(..., "content")`），
   把残缺的流式泡换成留存里的完整消息。MUST NOT 让一段起头缺失的流式正文以「这一轮的完整回答」的形式留
   在屏幕上。

   **与 cron 点击运行收尾合并成一次**：两者都要求「按后端快照重建内容、不动活动状态」，`done` 因此只发
   一次 `fetchSnapshot("content")`（`takeover || adopted`）。MUST NOT 复用 `reloadSession()`——它经
   `resetView` 以 `vault_changed` 结算，会把该轮刚产生的未读清掉（实现评审 r1 P1-2）；`reloadSession`
   只留给点击运行**发起失败**的回滚。

**内容也有世代守卫（实现评审 r1 追加）**：内容重建是「清面 + 按快照重放」，而请求与回包之间
可能已经开始了新一轮（`sent` 推进 `phaseEpoch`、新消息乐观上屏）。这份回包若照常落地，会把那条
新消息清掉、直到下一条事件才补回来。因此 **`content` 档**在清面**之前**比一次世代（与相位同一条
`phaseEpoch`），不一致**整条丢弃**——这条只适用于只内容档；进入档的过期只作用于相位一半（见 §4 的两档
分开处置），它没有「清面」这一步，迟到的内容最多让读数旧一拍。

**对账是内容路径，不是相位路径（r1 P2-1）**：对账用的那份快照 MUST NOT 参与相位判定——重建完成后相位
已由终态收口为 idle、`turnOpen` 保持假、未读按 §3 产生；这份快照里的 `in_flight` 读都不读（即便读出什么
也不该影响终态结论）。实现上如果复用 `restoreSnapshot`，必须给它一个显式的「只内容」档位，MUST NOT 让
对账走完整恢复路径——那会把快照相位顺带回填，正是 r1 P2-1 的现场。

**对账不拽走视口**：终态触发的是 `done` 之后的重建，此时滚动语义按既有「强制回底白名单」——终态本身不在
白名单里（`openspec/specs/harness/spec.md`「transcript 的跟随滚动与回到底部」），所以对账重建 MUST NOT
把正在阅读的视口拽回底部；重建后按既有跟随态决定滚动位。

## 6. 与既有机制的边界

| 机制 | 本 change 的处置 | 理由 |
|---|---|---|
| 点击发起的 cron 运行 | 按普通轮次呈现（`beginCronRun` 已把相位设为 running） | 走交互槽位、进当前 transcript（F10） |
| 无人值守 / 定时 cron 运行 | **不点亮**指示 | 走隔离 runtime、事件不进 transcript；结果走 cron 自己的通知与 `cron:notice` 通道 |
| `notice`（后台子代理完成通知） | 不单独产生未读 | 它所属的轮次终态会承担；单点为每条通知亮灯会把「有回复」稀释成噪声 |
| `auto_turn_started`（唤醒链） | 相位转 running；其终态照常产生未读 | 自动回合与用户回合在「有没有新内容要看」上等价 |
| `new_session` / 恢复会话 | 相位与未读随之复位（`resetView` 既有行为 + 进入快照恢复） | 换会话即换视图 |
| 窗口焦点 | 不参与判定 | 第二个事件源；本期只按面板是否在场判定 |

## 7. 跨 vault 的口径（对应 proposal D3）

未读是**当前 vault 的视图状态**，`vault_changed` 时清空。因此在 A 发起、切到 B、A 在 B 期间完成、再切回 A
时：指示呈空闲，回答由快照完整铺开（用户打开面板即见）。这条口径写进 spec 的 scenario，避免实现期
自行发明「跨 vault 未读」。

若 Alex 判 D3 要做，需要的是另一份能力：后端按会话暴露「上一轮终态 + 已读水位」，前端维护跨 vault 的
未读表——那是第二个真源与另一套清算语义，不属于本 change。

## 8. 视觉保真合同

> 本节按 [openspec-workflow.md](../../../docs/process/openspec-workflow.md)「有原型时的设计合同」的精神
> 写死可对账口径；本 change 无原型稿，形态由文字合同 + 并排截图裁决（`--update` 产生的任何基线仍归
> Alex 人肉过目）。**D1 是视觉裁决点**：下列取值是实现建议，Alex 可以改形态而不影响行为条款。

- **位置与尺寸**：状态点 6×6 px，锚在 toggle 钮内右下角（距钮右缘 5px、下缘 5px）；点与火花图标不重叠，
  点不越出钮盒（结构断言：点的 `getBoundingClientRect()` 完全落在钮的矩形内）。
- **三态形状**（形状载语义，颜色只做增强）：
  - 在途：空心环，1.5px 描边，`currentColor`（与钮面同色，弱化）；
  - 未读回复：实心圆点，`--accent`；
  - 未读失败：实心圆点 + 1px 外环，`--danger`。
- **三主题**：
  - light / dark：如上取值来自 token 层（`--accent` / `--danger` / `--text-3`）。
  - eink：`--accent` / `--danger` 在 eink 恒 `#000`，三态靠**形状**区分（空心环 / 实心点 / 实心点 + 外环），
    不引入彩色、不引入中间调（e-ink 的中间调靠抖动，6px 面积上的抖动会糊）。
- **动效**：无（见 §2）；因此 `prefers-reduced-motion` 无分支。
- **语言**：可访问名与状态描述走文案表 zh/en 双档，随 `onRelabel` 重绘（`src/copy-data.ts`）。
- **零漂移**：空闲态不产生任何上屏像素；既有整页基线不更新。三态观感若需留存，以新场景 + `--update`
  产生基线并送 Alex 过目（人肉裁决点）。

## 9. 可访问性合同

- 三态 SHALL 在 toggle 钮上可读：`aria-pressed` 承载开合（既有），状态经 `aria-describedby` 指向一段
  视觉隐藏的状态文本（「处理中」/「有新的回复」/「有失败结果」，空闲时该文本为空）。
- **不单靠颜色**：形状差异是主要判据（WCAG 1.4.1）。
- 终态到达时可经 `aria-live="polite"` 播报一次（只播终态，不播分片）；在途开始不播报（用户刚按下发送，
  他知道）。
- 真机验收的判据因此可落在 AX 上（见 §10）：6px 的点在 AX 里不可见，但状态文本可断言。

## 10. 测试设计

| 层 | 文件 | 判据 |
|---|---|---|
| 纯模型 | `tests/unit/harness-activity-presence.test.ts` | 状态机全表（§3 每条转移，**含 `stop_clicked`**）；`opened` 清未读；`aborted` 不置未读；`vault_changed` 清未读；进入快照在 epoch 不一致 / 当前 stopping 时丢弃 |
| 装配对账（源码级） | `tests/unit/harness-activity-wiring.test.ts` | 进入快照路径调相位与闸门恢复；**对账路径只走内容档位、MUST NOT 调相位 / 闸门恢复**；三类终态都把 `mounted` 传进状态机；`attachTo(null)` 不清相位/不清未读（收起≠复位）；toggle 钮的三态属性由唯一函数施加；`harness_busy` 处置只触发快照重取、不直接改相位 |
| Rust（轮次状态机） | `src-tauri/src/harness/session.rs` / `harness.rs` 的 `#[cfg(test)]` | 三态转移（`Idle→Running→Finishing→Idle`）与两个读口的分工：`Finishing` 时 `is_busy()==true` 而 `in_flight()==false`；快照 `in_flight` 三个状态各自取值；空态快照键在场；**逐条终态路径**（done / 配置级 error / 空响应 error / aborted）驱动后都进入 `Finishing` |
| 视觉（结构） | `tests/visual/scenes/m756-harness-activity-presence.spec.ts` | 三态结构断言 + 点锚在钮内 + 空闲态无新增像素（整页像素断言交给既有场景；本场景只做结构与计算属性断言，不新增基线） |
| 真机（行为） | `scripts/acceptance/scenarios/252-harness-activity-presence.md` | 收起期间完成：在途 → 未读恢复档 → 打开面板后状态文本消失、回答在场 |
| 真机（行为） | `scripts/acceptance/scenarios/253-harness-vault-activity.md` | 跨 vault 往返仍在途：切回后发送钮为停止态、状态文本为处理中、后续增量上屏；终态后完整回答在场（对账生效）；错误轮次点亮失败档；停止不点亮 |

**第一类：后端轮次状态机（Rust，必红）**

- `acquire_turn` ⇒ `is_busy()==true`、`in_flight()==true`；终态发射后 ⇒ `is_busy()==true`、
  `in_flight()==false`（`Finishing`）；`release_turn` 后 ⇒ 两者皆 false。
- 终态路径全覆盖（**按 F15 的 10 个位点逐条驱动，不只普通回合**）：可经既有测试入口驱动的六条各一条
  行为用例——普通回合的正常 `done` / 配置级 `error` / 空响应 `error` / `aborted`；**自动唤醒回合
  （`run_auto_turn_acquired`）的配置级 `error` `turn.rs:1692` 与 panic `error` `:1714`**。自动回合的两条
  必须走真实入口（面板先在 `auto_turn_started` 置 running，此处才有「旧轮未释放」的窗口），MUST NOT 用
  helper 直调代替。其余三条（入队失败 `:442`、压缩重试失败 `:573`、LLM 错误 `:581`）以 helper 级单测 +
  §1.5 的源码断言兜底，并在测试注释里写明这是覆盖边界、不是漏项。每条行为用例断言终态已发、尚未释放时
  `is_busy() == true` 且快照 `in_flight == false`——**这就是「终态已发、未释放」窗口的确定性复现**，
  不需要定时等待。
- 新轮：`Finishing → Idle → Running` 后 `in_flight` 回到 true。
- 空态快照 `in_flight == false` 且键在场；序列化形状断言（面板读的是 JSON 键）。
- 语义守卫：F14 的六个 `is_busy()` 读点行为不变（至少覆盖 `acquire_turn` 在世态下的拒绝与 `new_session`
  的拒绝各一条）。
- **源码级断言只作静态兜底**（「终态只经 helper 发射」），MUST NOT 替代上面的逐路径行为用例——r3 的
  现场正是：静态清单声称覆盖全部，实际漏了两条自动回合路径，只有行为用例能抓住。

**第二类：前端状态模型（纯函数，必红）**

- `enter_snapshot(inFlight:true, epoch 一致)` ⇒ `running`（接线层同时 `turnOpen=true`、置接管标志）。
- `enter_snapshot(inFlight:false)` ⇒ `idle`（接线层 `turnOpen=false`、清接管标志）——**含「本地曾 running、
  未见终态」的收口路径**：这是「终态在离开期间被过滤」那条反例的确定性形式。
- 已观察 `done` 后 `enter_snapshot(inFlight:false)` ⇒ 仍 `idle`，未读不被清也不新增。
- 已观察 `done` 后 `enter_snapshot(inFlight:true)` ⇒ `running`：后端说新一轮在跑就以它为准（`Finishing`
  窗口已被 `in_flight` 排除，所以这条不再是复活）。
- epoch 不一致 / 当前 `stopping` ⇒ 丢弃快照相位（保留 §3 的既有规则）。
- `harness_busy` 拒绝只触发一次快照重取（源码级断言），**模型里没有「拒绝 ⇒ running」这条转移**——
  删掉的东西不许以别的名字回来。

**新轮 / 旧轮交错矩阵**（每条一行；「旧轮」= 已发终态、「新轮」= 其后 acquire 的轮次）：

| # | 时序 | 期望 |
|---|---|---|
| 1 | 旧轮 `done`（已观察）→ 进入快照（`Finishing`，`in_flight:false`） | `idle`；未读保持 `reply`；`turnOpen` 假 |
| 2 | 旧轮 `done`（已观察）→ 发送被 `harness_busy` 拒 | `idle` + 错误行；**不复活**；重试成功的路径不被本模型拦截 |
| 3 | 旧轮在离开期间发终态（事件被过滤）→ 切回进入快照（`Finishing`） | `idle`（收口）；不产生未读（终态未观察，不伪造档位） |
| 4 | 旧轮在离开期间结束 → 新轮已在途 → 切回进入快照（`Running`） | `running` + `turnOpen` 真 |
| 5 | 旧轮仍在途 → 切回进入快照（`Running`） | `running` + 后续增量上屏 |
| 6 | 新轮已 `sent`（本地 running）→ 快照响应来自发送之前（epoch 旧） | 丢弃相位，保持 `running` |
| 7 | `stopping` 中收到进入快照（两种 `in_flight`） | 保持 `stopping`，由终态收口 |
| 8 | 终态对账快照（内容档位） | 相位 / `turnOpen` / 未读一律不动 |
| 9 | 两轮连续终态（第二个是自动回合） | 未读仍只有一枚标记，不累计 |
| 10 | 终态 → 心跳式重复进入快照（同 vault 重复装载） | 幂等：始终 `idle` |
| 11 | **自动唤醒回合**在配置错误 / panic 上结束（`turn.rs:1692` / `:1714`，释放前）→ 进入快照 | `idle`（`in_flight:false`）；MUST NOT 因该回合的 `auto_turn_started` 曾置 running 而停在处理中 |

**r1 P2-2 的确定性回归**（停止路径进全表，保持不变）：

- `idle + stop_clicked` ⇒ `idle`（未在运行不可停止）；`running + stop_clicked` ⇒ `stopping`；
  `stopping + stop_clicked` ⇒ `stopping`（幂等）。
- `stopping + terminal(done)` ⇒ `idle`；`stopping + enter_snapshot(inFlight:true)` ⇒ `stopping`（不降级为
  running）；`stopping + enter_snapshot(inFlight:false)` ⇒ `stopping`（由终态收口，不由快照收口）。
- **委托而非重写**：逐条断言 `activity` 对 `stop_clicked` / `sent` / `finished` 的相位返回值与
  `reduceSendPhase` 的对应输出相等——两个实现分叉时必红。

**先红后绿**：252 / 253 在 master 上必红（当前没有状态文本、且切回后呈空闲）——实现前先在 master 跑一次
留证，再在实现后跑绿，读数落 `.local/acceptance/`。

**必红的机器判据候选**（单测层）：把 `resetView` 里「相位归 idle」且「快照不回填」的组合写成断言——
恢复逻辑一旦被删，相位会停在 idle，断言必红。

## 11. 实现期可另定的细节（不构成裁决点）

- 状态点的 CSS 实现（伪元素 vs 子 `<span>`）：取子元素，便于结构断言与 `history` 无关地测量尺寸。
- 快照字段名固定取 `in_flight`（与运行态的**呈现**语义同名）；MUST NOT 复用 `busy`——那是协议位，
  `Finishing` 窗口里它与界面状态相反，同名会把下一位读者引向同一个错误。
- 三态枚举的落点（`Session` 内部私有枚举 vs 复用一个 `Option<...>`）：取私有枚举 + 两个读口
  （`is_busy` / `in_flight`），不让协议读者接触枚举本身。
- 对账重建的触发条件（`done` 与 `error` / `aborted` 都重建 vs 只 `done` 重建）：按「中途接管」标志决定，
  三类终态一致处理（`error` / `aborted` 的快照里没有新消息，重建是幂等的空动作）。

## 12. 风险与回退

- **终态到释放之间的窗口（r1/r2 P2-1）**：由后端的 `Finishing` 态吸收——协议位 `busy` 照旧为真（用户
  发不出去，语义不变），呈现位 `in_flight` 为假（界面立即收口）。前端不再需要任何终态记忆或拒绝复活；
  确定性用例见 §10 的两类回归与交错矩阵。
- **改动 `busy` 的读点**：`is_busy()` 的定义改为 `phase != Idle`，六个既有读点逐条核对语义不变（F14）；
  漏一个读点就可能把 `Finishing` 当成 Idle，因此 Rust 用例必须覆盖 `acquire_turn` 与 `new_session` 的拒绝。
- **终态发射点漏置 `Finishing`**：所有终态发射收敛到一个 helper（F15 的 10 个位点 / 11 条语句，含自动唤醒
  回合两处），漏一处就是假在途；用例逐条终态路径驱动断言，**源码级「只经 helper」断言只作静态兜底**；
  两类用例都要有，缺一类就会重演 r3 现场（清单声称完整、实际漏了两条路径）。
- **快照与事件互相打架**：`phaseEpoch` 世代守卫（§4）——它防「请求在发送前发出、响应在发送后回来」，
  与后端状态机互补（后者防「终态后读到旧在途」）。
- ** stopping 的相位归属（r1 P2-2）**：相位只由 `reduceSendPhase` 产出、新模块逐条委托；停止中到达的
  进入快照**不应用相位**（`enterSnapshotApplies` 判假，相位保持 stopping），等终态收口——因此不存在
  「快照把 stopping 改回 running」的分叉。
- **重建打断阅读**：对账重建只在「中途接管」轮次的终态发生一次，且遵守跟随态合同（§5）。
- **性能**：指示更新只发生在事件边界（一轮 3–4 次相位变化），无新定时器、无 per-chunk 重排；
  不进入编辑器按键路径（ADR 0002 §6）。
- **回退**：`in_flight` 是新增键，旧前端宽容忽略；前端三态在快照缺键时退化为「事件驱动的既有两态」，
  不产生错误态（与 `harness-panel.ts` 既有「缺键 = 旧后端，不伪造」的口径一致）。
