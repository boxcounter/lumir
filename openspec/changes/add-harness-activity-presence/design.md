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
| F7 | 后端有唯一在途真值 `SessionContext.busy`，且已有宽容读法 | `src-tauri/src/harness/session.rs:549`、`:757`、`src-tauri/src/harness.rs:459-470` |
| F8 | 在途时 `send` 被 `harness_busy` 拒；`new_session` / 恢复同样被拒 | `src-tauri/src/harness.rs:303-321`、`:475-500` |
| F9 | 相位只有一个写入口 `applySendPhase` | `src/harness-panel.ts:6706` |
| F10 | 无人值守 cron 走隔离 runtime，事件不进当前 transcript；点击发起走交互槽位 | `src-tauri/src/harness.rs:1511-1535`、`src/main.ts:3097-3117` |
| F11 | 终态事件只有三类：`done` / `error` / `aborted`（成功与否由事件种类表达，不由字符串表达） | `src/ipc.ts:479-540`、`src/harness-panel.ts:9023-9088` |
| F12 | **后端先发终态、后释放 busy**：正常完成 `done` 在 `:699`、`release_turn` 在 `:297`（`run_turn_core` 返回之后）；配置级错误 `:259-260` 先 error 再释放；自动唤醒回合 `:1729` 才释放 | `src-tauri/src/harness/turn.rs` |
| F13 | 停止子态由既有 `reduceSendPhase` 承载（`running + stop-clicked → stopping`，重复点击幂等），点击路径在 `:6730-6735` | `src/harness-panel.ts:2368-2379`、`:6730-6735` |

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
  afterTerminal: boolean;  // 本会话最近一次观察到的是终态；新轮开始 / 换作用域时清除（§4 的守门）
}

type ActivityEvent =
  | { type: "sent" }                 // 用户发送（= 新轮开始）
  | { type: "auto_turn_started" }    // 唤醒链自动回合（= 新轮开始）
  | { type: "stop_clicked" }         // 用户点击停止（M756 r1 P2-2：必须在此显式建模）
  | { type: "terminal"; kind: "done" | "error" | "aborted"; mounted: boolean }
  | { type: "enter_snapshot"; busy: boolean; epochAtRequest: number; epoch: number }
  | { type: "busy_rejected" }        // 后端 harness_busy 拒绝：唯一无条件拉回在途的出口
  | { type: "opened" }               // 面板挂载（= 已读）
  | { type: "vault_changed" };       // 作用域切换（视图复位）
```

**单一相位状态机（r1 P2-2 的闭合口径）**：`phase` 的每个跃迁都经既有 `reduceSendPhase`
（`src/harness-panel.ts:2368-2379`），映射关系是——`sent` / `auto_turn_started` → `{type:"sent"}`、
`stop_clicked` → `{type:"stop-clicked"}`、三类终态 → `{type:"finished"}`。唯一写入口仍是
`applySendPhase`（`:6706`）。本模块只新增 `unread` 与 `afterTerminal` 两个字段，MUST NOT 自行判定
相位——否则 `stopping` 会有两个持有者（旧 reducer 一份、新状态机一份），快照恢复也会与本地 stopping
分叉。**任务里的「全表」测试因此必须覆盖停止路径**，不能只有发送与终态。

转移规则（每条在 spec 的 scenario 或 §10 的确定性用例里有对应断言）：

- `sent` / `auto_turn_started`：`phase = reduceSendPhase(phase, {type:"sent"})`；`afterTerminal = false`；
  `unread` 不动。
- `stop_clicked`：`phase = reduceSendPhase(phase, {type:"stop-clicked"})`——**只在 running 时**进入
  stopping，重复点击保持 stopping（与 `src/harness-panel.ts:6730-6735` 的点击路径同一条幂等语义）；
  `unread` 不动。
- `terminal(kind, mounted)`：`phase = reduceSendPhase(phase, {type:"finished"})`（running 与 stopping 都
  收口回 idle，与既有「done / error / aborted 都导向 finished」一致）；`afterTerminal = true`；
  `unread`——`mounted === true` 时为 `null`（结果就在屏幕上），`mounted === false` 且 `done` / `error`
  时分别为 `reply` / `failure`，`aborted` 时不动（停止是用户按的；此前已有的未读也只由 `opened` 清除）。
- `enter_snapshot`：仅当 `epochAtRequest === epoch`、快照 vault 等于当前 vault、当前相位不是 `stopping`
  时应用，且 `busy === true` 还要求 `afterTerminal === false`（§4 的守门）；映射只产出 `running` / `idle`。
- `busy_rejected`：`phase = running`、`afterTerminal = false`——后端刚以 `harness_busy` 拒绝过一次发送，
  说明本轮确实在途；这是唯一不经快照的在途判据，也是 `afterTerminal` 把界面锁在假空闲时的出口。
- `opened`：`unread = null`（**已读清算的唯一入口**——重新打开面板即视为已读；切换 vault 的复位是
  另一条口径，见 `vault_changed`）。
- `vault_changed`：`unread = null`、`afterTerminal = false`（换作用域 = 本会话的观察史作废；见 §7）。

**对账路径不进这个 reducer**：终态对账（§5）只重建内容，MUST NOT 以任何形式把快照喂进本模型——
它是 r1 P2-1 的现场（终态后读到的 `busy:true` 会把已结束的轮次复活成在途）。

**为什么未读不计数**：流式增量、工具行、通知都不构成「一条消息」这种可数单位，任何数字都是伪造读数——
与 `harness` 既有「回到底部」钮的未读提示同一条纪律（`openspec/specs/harness/spec.md` 的
「transcript 的跟随滚动与回到底部」：未读提示 MUST NOT 使用数字计数）。

**为什么未读由终态种类派生**：`done` / `error` / `aborted` 三个事件就是后端的终态分类，前端只做词映射、
不自行判定成功（REVIEW.md「同一语义两处真源」条：不得把「判成功」建立在字符串字面量上）。

## 4. 相位真源与恢复：快照带 `busy`，且只在「进入会话」的快照回填

**形状**：`StateSnapshot` 增一个布尔字段（`busy`），空态快照同形给 `false`。选择布尔而不是复合对象：
面板需要的只是「有没有在途轮次」；`stopping` 是**本地**子态（停止已请求、等终态），跨进程无法也无必要
恢复——从快照恢复出的相位只会是 `running` / `idle`，本地处于 stopping 时快照相位整条丢弃（§3）。

**为什么快照相位只在「进入会话」时应用（r1 P2-1 的闭合口径，不动后端 busy 协议）**：后端**先发终态、
后释放 busy**——正常完成在 `src-tauri/src/harness/turn.rs:699` 发 `done`，`:297` 才 `release_turn`；
配置级错误 `:259-260` 先发 `error` 再释放；自动唤醒回合 `:1729` 才释放。因此前端收到终态之后立刻读到的
快照，**合法地**可能带 `busy:true`。若这种快照也回填相位，已结束的轮次会被复活成在途，且不会再有事件把
它收回去（终态已经用过）。`phaseEpoch` 拦不到这个方向：请求本身就发生在终态之后，epoch 是一致的。

闭合口径两条，缺一不可：

1. **按用途分两种快照**：**进入快照**（装载 / 切回 vault / 恢复会话）是唯一允许改相位的；**终态对账快照**
   只重建内容，MUST NOT 读 `busy`、MUST NOT 改相位、MUST NOT 重开 `turnOpen`。判据是调用点，不是时间戳。
2. **`afterTerminal` 守门**：即使进入快照，`busy:true` 也只在「本地未处理过该作用域的终态」时才允许把
   相位拉到 running；见过终态之后、观察到新一轮开始（`sent` / `auto_turn_started`）之前，快照的
   `busy:true` 一律丢弃——它只可能来自刚结束那一轮的 busy 尚未释放。

代价与出口：若离开期间该会话又起了一轮（事件被 vault 过滤，本地没有观察史），进入快照会被这条守门挡下；
用户真去发送会拿到 `harness_busy`，走 `busy_rejected` 无条件拉回在途（§3），不会永久假空闲。方向取
「不把已结束的轮次说成在途」——与本提案的目标一致。

**为什么不新增 `turn_state` 事件**：相位在途内已经由 `sent` / `auto_turn_started` / `stop-clicked` /
`done` / `error` / `aborted` 这些事件驱动，再加一路「busy 变更」事件就是同一事实的第二条通道；本轮要补的
只是**恢复**（装载 / 切回 / 恢复会话这三个时点没有事件可依），快照正好是这些时点已经在用的通道。

**世代守卫（防「迟到的旧快照把新相位打回去」）**：面板维护 `phaseEpoch`，任何经事件推进的相位变化都
`phaseEpoch += 1`；发起快照请求时记下当时的 epoch，响应回来时 epoch 不一致就丢弃快照里的相位（只应用
消息、usage 等其余部分）。这与既有的 `snapshotSeq`（丢弃过期响应）同一条纪律，两把锁防的是不同的事：
`snapshotSeq` 防「旧请求覆盖新请求」，epoch 防「快照与事件互相打架」。

**已知残留窗口**：`vaultChanged` → `resetView` 把相位刷 idle 之后、快照回来之前，按钮会短暂呈可发送。
这段窗口里如果用户真的发了，后端会以 `harness_busy` 拒绝；面板 SHALL 走 `busy_rejected`（§3）把相位与
`afterTerminal` 一起校正回在途（而不是只上一条错误行）——把这条竞态的出口接在同一个状态模型上。

## 5. 在途轮次的重连续与终态对账

切回一个仍在途的 vault 时，三件事必须一起成立，否则「相位对了但内容仍然错」：

1. **相位**：由**进入快照**的 `busy` 恢复（§4；并受 `afterTerminal` 守门）。
2. **闸门**：`turnOpen` 与相位同源恢复——只在进入快照 `busy === true` 且相位被拉到 running 时置真
   （否则切回后的 `text_chunk` / `tool_call` / `reasoning_chunk` 会被 `GATED_EVENT_TYPES` 当「已结束轮次的
   迟到产出」丢弃）。终态事件把它置假之后，MUST NOT 有任何快照或对账路径把它重开。
3. **对账**：切走期间错过的正文没有任何本地副本——那些分片在过滤时就丢了。因此本轮 SHALL 记住「这是一次
   中途接管」，在终态事件到达时按后端快照重建一次渲染面（与 `cronRunAdopted` 的 `reloadSession()` 同一
   手法，`src/harness-panel.ts:9936`），把残缺的流式泡换成留存里的完整消息。MUST NOT 让一段起头缺失的
   流式正文以「这一轮的完整回答」的形式留在屏幕上。

**对账是内容路径，不是相位路径（r1 P2-1）**：对账用的那份快照 MUST NOT 参与相位判定——重建完成后相位
已由终态收口为 idle、`turnOpen` 保持假、未读按 §3 产生；这份快照里的 `busy` 读都不读（后端此刻可能还没
释放 busy，读到 `true` 是合法时序，见 §4）。实现上如果复用 `restoreSnapshot`，必须给它一个显式的
「只内容」档位，MUST NOT 让对账走完整恢复路径——那会把 `busy:true` 顺带回填，正是 r1 P2-1 的现场。

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
| 纯模型 | `tests/unit/harness-activity-presence.test.ts` | 状态机全表（§3 每条转移，**含 `stop_clicked`**）；`opened` 清未读；`aborted` 不置未读；`vault_changed` 清未读；进入快照在 epoch 不一致 / 当前 stopping / `afterTerminal` 为真时丢弃 |
| 装配对账（源码级） | `tests/unit/harness-activity-wiring.test.ts` | 进入快照路径调相位与闸门恢复；**对账路径只走内容档位、MUST NOT 调相位 / 闸门恢复**；三类终态都把 `mounted` 传进状态机；`attachTo(null)` 不清相位/不清未读（收起≠复位）；toggle 钮的三态属性由唯一函数施加 |
| Rust | `src-tauri/src/harness/session.rs` 的 `#[cfg(test)]` | `snapshot()` 在 `acquire_turn` 后 `busy=true`、`release_turn` 后 `busy=false`；空态快照 `busy=false` 且键在场 |
| 视觉（结构） | `tests/visual/scenes/m756-harness-activity-presence.spec.ts` | 三态结构断言 + 点锚在钮内 + 空闲态无新增像素（整页像素断言交给既有场景；本场景只做结构与计算属性断言，不新增基线） |
| 真机（行为） | `scripts/acceptance/scenarios/252-harness-activity-presence.md` | 收起期间完成：在途 → 未读恢复档 → 打开面板后状态文本消失、回答在场 |
| 真机（行为） | `scripts/acceptance/scenarios/253-harness-vault-activity.md` | 跨 vault 往返仍在途：切回后发送钮为停止态、状态文本为处理中、后续增量上屏；终态后完整回答在场（对账生效）；错误轮次点亮失败档；停止不点亮 |

**r1 P2-1 的确定性回归**（纯模型层，不依赖真机时序）：

- `terminal(done, mounted=false)` → `enter_snapshot(busy:true, epochAtRequest = epoch)` ⇒ 断言
  `phase === "idle"`、`afterTerminal === true`、`unread === "reply"`；`error` / `aborted` 各一条同型。
- 接线层：断言对账路径不调用相位恢复与 `turnOpen` 重开（源码级对账），且对账档位不读快照的 `busy` 键。
- **反例守卫（证明守门不是一刀切屏蔽）**：`vault_changed` → `enter_snapshot(busy:true)` ⇒ `phase === "running"`
  （真在途仍能恢复）；`terminal(done)` → `sent` → `enter_snapshot(busy:true)` ⇒ `running`（新一轮能恢复）。
- **出口守卫**：`terminal(done)` → `busy_rejected` ⇒ `running`、`afterTerminal === false`。
- 区分度自证：实现若改成「快照无条件回填」，第一条必红；若改成「永不回填」，反例守卫必红。

**r1 P2-2 的确定性回归**（停止路径进全表）：

- `idle + stop_clicked` ⇒ `idle`（未在运行不可停止）；`running + stop_clicked` ⇒ `stopping`；
  `stopping + stop_clicked` ⇒ `stopping`（幂等）。
- `stopping + terminal(done)` ⇒ `idle`；`stopping + enter_snapshot(busy:true)` ⇒ `stopping`（不降级为
  running）；`stopping + enter_snapshot(busy:false)` ⇒ `stopping`（由终态收口，不由快照收口）。
- **委托而非重写**：逐条断言 `activity` 对 `stop_clicked` / `sent` / `finished` 的相位返回值与
  `reduceSendPhase` 的对应输出相等——两个实现分叉时必红。

**先红后绿**：252 / 253 在 master 上必红（当前没有状态文本、且切回后呈空闲）——实现前先在 master 跑一次
留证，再在实现后跑绿，读数落 `.local/acceptance/`。

**必红的机器判据候选**（单测层）：把 `resetView` 里「相位归 idle」且「快照不回填」的组合写成断言——
恢复逻辑一旦被删，相位会停在 idle，断言必红。

## 11. 实现期可另定的细节（不构成裁决点）

- 状态点的 CSS 实现（伪元素 vs 子 `<span>`）：取子元素，便于结构断言与 `history` 无关地测量尺寸。
- 快照字段名（`busy` vs `in_flight`）：取 `busy`，与后端 `SessionContext::is_busy` 同名同义，少一层翻译。
- 对账重建的触发条件（`done` 与 `error` / `aborted` 都重建 vs 只 `done` 重建）：按「中途接管」标志决定，
  三类终态一致处理（`error` / `aborted` 的快照里没有新消息，重建是幂等的空动作）。

## 12. 风险与回退

- **终态与 busy 释放的时序竞态（r1 P2-1）**：后端先发终态、后释放 busy（F12），所以终态之后的任何快照都
  可能读到 `busy:true`。两道防线——对账快照只重建内容（不读 `busy`、不改相位、不重开 `turnOpen`）+ 进入
  快照受 `afterTerminal` 守门（见过终态、未见新一轮之前不把相位拉回 running）。出口是 `busy_rejected`
  （发送被拒即无条件回到在途）。确定性用例见 §10。
- **快照与事件互相打架**：`phaseEpoch` 世代守卫（§4）——注意它只防「请求发出后又发生相位事件」这一个
  方向，防不到上面那条时序，两条防线互补。
- ** stopping 的相位归属（r1 P2-2）**：相位只由 `reduceSendPhase` 产出、新模块逐条委托；停止中的快照
  应用被整条丢弃，等终态收口——因此不存在「快照把 stopping 改回 running」的分叉。
- **重建打断阅读**：对账重建只在「中途接管」轮次的终态发生一次，且遵守跟随态合同（§5）。
- **性能**：指示更新只发生在事件边界（一轮 3–4 次相位变化），无新定时器、无 per-chunk 重排；
  不进入编辑器按键路径（ADR 0002 §6）。
- **回退**：`busy` 字段是新增键，旧前端宽容忽略；前端三态在快照缺键时退化为「事件驱动的既有两态」，
  不产生错误态（与 `harness-panel.ts` 既有「缺键 = 旧后端，不伪造」的口径一致）。
