# Design: 待批状态的单一判据、两个标题栏承载与完整清算

> 本文件写实现合同与取舍，不是实现记录。行号是起草时（2026-11-23）的读数，实现时以符号为准。
> 节点状态见 [proposal.md](proposal.md)：**节点 1 待批**，D1–D6 均未生效；本文件按推荐值写合同，
> 批准值不同则先改本文件与 spec delta，不静默改口径。

## 1. 事实底座（实现前必须成立，逐条可核）

| # | 事实 | 位置 |
|---|---|---|
| F1 | 父会话待决批准项的唯一真源是 `pendingApprovals: Map<id, PendingApproval>` | `src/harness-panel.ts:4130` |
| F2 | 子运行透传的批准项另表 `taskApprovals`，卡挂任务区（transcript 之外） | `src/harness-panel.ts:4183`、`:8048` |
| F3 | `appendApproval` 就地升级工具行、建卡、写 Map，末尾只调 `follow.contentGrew()` | `src/harness-panel.ts:7255-7446` |
| F4 | 决策闭包先 `pendingApprovals.delete(id)`（幂等），再收敛终态记录、调后端 | `src/harness-panel.ts:7420-7432` |
| F5 | 停止 / 中断收回全部待决项：撤卡、解壳回工具行、`pendingApprovals.clear()`，随后才派发 `terminal(aborted)` | `src/harness-panel.ts:8770-8795` |
| F6 | `clearTranscriptSurface()` 清 `pendingApprovals` 与 `decidedApprovals`，**不派发相位事件** | `src/harness-panel.ts:9291-9300` |
| F7 | 进入快照先 `applyEnterSnapshot(in_flight)` 回填相位，再重放消息与 `pending_approvals` 列表 | `src/harness-panel.ts:9111-9132`、`:9176-9205` |
| F8 | 终态对账（`content` 档）先清面（F6），再重放消息与待决列表；相位与跟滚态不动 | `src/harness-panel.ts:9126-9132`、`:9211-9214` |
| F9 | 阶段行唯一写点 `applyStage()`；文案三档 D381 / D382 / D400，`stopping` 优先 | `src/harness-panel.ts:5992-5999` |
| F10 | 标题栏活动状态唯一写点 `applyActivityBadge()`：`data-activity` + `aria-live` 状态文本 + `title` | `src/harness-panel.ts:5976-5990`、`:3481-3490` |
| F11 | 面板打开（分栏）时 toggle 钮被既有退让条款隐藏，活动徽标不在屏上 | `src/main.ts:754-757`、`src/harness-panel.ts:10104-10106`；现场 `tests/visual/scenes/m303-harness-panel.spec.ts:129`、`harness-async-adversarial.spec.ts:421` |
| F12 | 面板打开时标题栏在场的是 harness 段 `.lumir-hp-seg`（会话名 + 加号钮），段随 `attachTo` 翻 `hidden` | `src/harness-panel.ts:3496-3538`、`:10071` |
| F13 | 进度块挂在 transcript 视口之外、composer 之上；显隐使 transcript 视口高度变化约 28px | `src/harness-panel.ts:3927`、`src/harness-scroll-lock.ts:148-155`、`src/harness-panel.css:1789-1807` |
| F14 | 发送先 `appendUserMessage`（内含回底），再清 composer，再 `dispatchActivity(sent)`（进度出现） | `src/harness-panel.ts:6107-6142`、`:9512-9517` |
| F15 | 跟滚控制器：阈值单一真源；脱离态零写入；`jumpToBottom` 同步写底并刷新回声基准 | `src/harness-scroll-lock.ts:35-39`、`:148-161`、`:197-223` |
| F16 | 语言切换的 `applyLabels()` 末尾重跑 `applySendPhase(activity.phase)` 与 `applyActivityBadge()` | `src/harness-panel.ts:4863-4892` |
| F17 | 后端在批准闸上 `rx.recv()` 阻塞、不超时，轮次保持 `in_flight` | `src-tauri/src/harness/run.rs:572-592` |
| F18 | `done` / `error` 先派发终态、再请求 `content` 快照；`content` 档不改相位。因此终态后快照落地时相位是 idle，待批列表若还在也只是陈旧数据 | `src/harness-panel.ts:8741`、`:8810`、`:9102`、`:9211-9214` |
| F19 | 进入快照（`enter`）**不清面**；调用点只有构造（空面）、`vaultChanged`（先 `resetView`）、`reloadSession`（先 `resetView`） | `src/harness-panel.ts:9123`、`:9425`、`:9458`、`:9691-9695` |
| F20 | 重新打开面板经 `attachTo` 挂回，**不调** `fetchSnapshot()`；跨开合保留的是本地状态，不是快照重建 | `src/harness-panel.ts:10015-10060` |

结论：不需要新事件、新快照字段或 Rust 改动。需要的是：一个派生判据、两个互斥的标题栏承载、
一个统一重施入口、以及发送路径的一处幂等回底。

## 2. 采用形态与状态矩阵

### 2.1 派生判据

待批信号只在**有在途轮次可依附**时成立：

```ts
function hasPendingApprovals(): boolean {
  return pendingApprovals.size > 0;
}

function approvalSignalActive(phase: SendPhase): boolean {
  return phase === "running" && hasPendingApprovals();
}
```

- 判据只有 `pendingApprovals` 一个来源；MUST NOT 由事件种类、相位、计时、文案或另一枚布尔推导。
- `phase === "stopping"` 时信号为假：用户已请求停止，先在读「正在停止…」；待决项随即被收回。
- `phase === "idle"` 时信号为假：待批没有在途轮次可依附即视为陈旧数据，按陈旧项**撤回**——
  不渲染可决策卡、不入集合、不置状态。旧快照缺 `in_flight` 而带 `pending_approvals` 时同样如此；
  live 批准请求在 idle 到达也按陈旧处理。

### 2.2 状态矩阵（逐条写死）

| 状态 | 阶段行 | 段状态词（面板开） | toggle 状态（面板收） |
|---|---|---|---|
| 空闲 / 历史恢复不在途 | 隐藏（零像素） | 不显示 | 空闲（无状态词） |
| 已发送、首个正文分片前，无待批 | D381 等待响应… | 不显示 | 处理中 |
| 生成中（含工具循环），无待批 | D382 正在生成回复… | 不显示 | 处理中 |
| `running` + 待批（首个待决项到达） | **等待批准…** | **等待批准** | **等待批准** |
| `running` + 待批 + 后续正文 / 工具增量 | 维持「等待批准…」（集合未空） | 维持 | 维持 |
| 待批期间点停止（`stopping`） | D400 正在停止… | 退场 | 处理中 |
| done / error / aborted 收尾且仍有待批 | 隐藏（终态） | 退场 | 空闲 / 未读档 |
| 终态后 `content` 对账快照 + 非空列表 | 隐藏（相位 idle） | 不显示 | 空闲 / 未读档（列表按 stale 丢弃） |
| 终态后 `content` 对账快照 + 空列表 | 隐藏（相位 idle） | 不显示 | 空闲 / 未读档 |
| 采纳 / 拒绝后仍 `running` | 回落到 D381 / D382 | 退场 | 处理中 |
| 采纳 / 拒绝后随终态回 `idle` | 隐藏 | 退场 | 空闲 / 未读档 |
| 停止 / 中断收回待决项 | D400 → 隐藏 | 退场 | 处理中 → 空闲 |
| `enter` `in_flight=true` + 非空列表（中途接管） | 等待批准…（MUST NOT 先闪等待响应） | 等待批准 | 等待批准 |
| `enter` `in_flight=true` + 空列表 | D381 / D382 | 不显示 | 处理中 |
| `enter` `in_flight=false` + 非空列表（旧快照） | 隐藏 / 按 idle | 不显示 | 空闲（列表按 stale 丢弃，不落卡） |
| 切会话 / 切 vault / 新会话 | 隐藏 / 新相位 | 退场 | 空闲 |
| 空闲遗留待批 → `sent` / `auto_turn_started` | 新轮 D381 | 不显示 | 处理中（旧待批已清） |
| done / error 带待批 → 新一轮 | 新轮 D381 | 不显示 | 处理中（终态已清） |
| 仅子运行待批 | 正常生成档 | 不显示 | 处理中 |
| 语言切换（待批期间） | 重取 | 重取 | 重取 |

终态对账两行覆盖**面板开 / 收**两种：面板开时 toggle 不可见但状态文本仍按 idle / 未读档写；
面板收时 toggle 可见。两种都 MUST NOT 出现「处理中」或「等待批准」——`content` 不改相位，
终态后相位是 idle。

## 3. 单一写点与承载

### 3.1 三个输出面，两个写函数

| 输出面 | 写函数 | 内容 |
|---|---|---|
| 阶段行 `.lumir-hp-stage` | `applyStage()` | 文案键由纯选择器决定 |
| toggle 状态（`data-activity` / `activityStatus` / `title`） | `applyActivityBadge()` | 状态词与悬停提示 |
| 段状态词 `.lumir-hp-seg-status` | `applyActivityBadge()` | 可见文本 + `role="status"` + `hidden` |

`applyActivityBadge()` 同时写两枚**互斥可见**的标题栏承载：面板收起时 toggle 在场、段隐藏；
面板打开时段在场、toggle 被退让条款隐藏（F11 / F12）。两个承载共用一个状态词、一份判据，
因此不存在「徽标说等待批准、段还说处理中」的分叉。MUST NOT 为段状态词另设第二个状态函数或
第二个布尔。段本身的 `hidden` 由 `attachTo` 管，状态词的 `hidden` / 文本由 `applyActivityBadge`
管，两者正交——面板打开前状态词可以已备好，打开后立即可见。

### 3.2 纯选择器（可单测，不碰 DOM）

```ts
/** 阶段行文案键。优先级：stopping > 待批 > 等待响应 / 生成中。 */
export function stageCopyKey(
  phase: SendPhase,
  pending: boolean,
  stageWaiting: boolean,
): "D400" | "APPROVAL" | "D381" | "D382";

/** 标题栏状态文案键。idle 时按未读分档；非 idle 时待批优先于「处理中」。 */
export function activityStatusKey(
  phase: SendPhase,
  unread: ActivityUnread,
  pending: boolean,
): "D416" | "D870" | "D871" | "D872" | "";
```

- `APPROVAL` 是实现期的占位名，对应新增的阶段行文案键（取号见 §7）；`D416` 复用既有
  「等待批准」串（同一语义，不另立同文重复键）。
- `applyStage()` / `applyActivityBadge()` 只负责把键映射到 `t()` 并落 DOM；MUST NOT 在函数里
  再写一遍优先级分支（否则纯选择器与 DOM 两处真源）。

### 3.3 统一重施入口

```ts
/** 待决集合变化后的唯一重施入口：阶段行 + 标题栏两承载。 */
function refreshApprovalSignal(): void {
  if (activity.phase !== "idle") applyStage();
  applyActivityBadge();
}
```

调用点（每一处都在集合变化**之后**、同一次同步批次内）：

1. `appendApproval`：在**函数入口**先判相位；若为 `idle`，该批准项按陈旧项处理——不建流式泡 /
   工具块、不落卡、不入集合、直接返回（快照与 live 同一判据）。非 idle 时在 `pendingApprovals.set`
   + `relabelApproval` 之后、`follow.contentGrew()` 之前重施。
2. `decide`：`pendingApprovals.delete` + `settleApprovalRecord` 之后。
3. **终态统一撤回**：新增 `withdrawPendingApprovals(reason)`——撤卡、恢复工具行并标注未执行
   （done / error；新增文案键，实现期取号）/ 已停止（aborted，沿用 D383）、清空集合、使决策闭包
   失效、`settledApprovalCalls.clear()`；`done` / `error` / `aborted` 三个终态分支在内容收口
   （finalize / 未完成 / 已停止标记）之后、`dispatchActivity(terminal)` **之前**各调一次
   （与 aborted 现状同序；`aborted` 用同一函数替换现有内联循环，标签保持 D383，不改既有观感）。
   `aborted` 的「已停止标记 vs terminal」先后若随后续尾行 change 调整，撤回 MUST 仍保持在
   `dispatchActivity(terminal)` 之前。
4. **新一轮前清 stale**：`dispatchActivity` 的 `sent` / `auto_turn_started` 分支在置 `turnOpen`
   之前，若**上一相位为空闲**且集合非空，则调 `withdrawPendingApprovals("stale")`——覆盖「旧快照
   缺在途读数、带待决卡、相位 idle」的反例，使新一轮不继承旧待批。已处于处理中的轮次（如重复的
   `auto_turn_started`）MUST NOT 清合法待批。
5. `clearTranscriptSurface()`：清 Map 之后（覆盖换会话 / 切 vault / 新会话 / 终态对账清面）。
6. `restoreSnapshot()`：待决列表重放结束后重施一次。它只重算**现有** Map / 状态，不能删除旧 id；
   列表为空时的幻影清理由 `content` 的 `clearTranscriptSurface`（F6）与 `enter` 的前置
   `resetView` / 构造（F19）保证，不靠末尾这一次重施。
7. 语言切换：`applyLabels()` 既有末尾调用已覆盖（F16），不新增调用点。

**`restoreSnapshot` 末尾重施不能替代清面**：它只重算现有 Map，不能删除 enter 快照已不含的旧 id。
`enter` 的权威清理由前置不变量保证（F19：构造空面 / `resetView`）；`content` 的清理由
`clearTranscriptSurface()` 保证（F6）。**重开面板**走 `attachTo`、不拉快照（F20），测试只能证明
本地状态跨开合保留，不得记作快照重建覆盖。

`dispatchActivity` 的相位 / 未读变化仍走既有 `applySendPhase` + `applyActivityBadge`；待批不是
相位事件，因此不新增 `ActivityEvent` 类型（避免把「待批」塞进相位状态机，造成两个持有者）。

`applyActivityBadge` 在写 `activityStatus.textContent` / 段状态词文本前 SHALL 先比较旧值，
相同则不写：同一待批集合期间的重复投递 / 工具行更新不应触发 `aria-live` 的重复播报。

### 3.4 顺序约束

- 重施必须发生在 Map 变更之后；否则读到旧集合。
- `appendApproval` 的重施必须发生在卡落 DOM 之后（卡片与状态同帧出现，避免「有状态没卡」）。
- aborted 的重施必须发生在撤卡之后（否则会重施出一张已撤的卡对应的状态）。
- 快照重建的重施必须发生在 `applyEnterSnapshot`（相位回填）与待决列表重放**都完成之后**；
  否则阶段行会按旧相位 / 旧集合写一次，再被下一次写纠正（同帧内不可见，但会让测试出现
  瞬时读数）。
- 终态统一撤回必须在 `dispatchActivity(terminal)` 之前完成：先撤卡 / 清集合，再施加终态；否则终态
  相位下仍可能有一帧可点的卡。
- `sent` / `auto_turn_started` 的 stale 清理必须在 `turnOpen = true` 之前完成，且以**上一相位为空闲**
  为条件：新一轮的闸门打开后旧待批不应还能被决策；处理中的轮次不清合法待批。
- 重施 MUST NOT 触发 `follow.contentGrew()` / `jumpToBottom()` / 未读变化：它只写文案与显隐。

## 4. 清算矩阵（逐个出口）

| 出口 | Map 动作 | 期望可见结果 | 防的缺陷 |
|---|---|---|---|
| 批准项到达（父会话，running） | `set(id, pending)` | 阶段行 / 段状态词 / toggle 同时读「等待批准」；卡在 transcript 内 | 只改卡不改状态（现状） |
| 批准项到达（父会话，idle / 旧快照） | 不入集合、不落卡 | 无待批状态、无可决策卡 | idle 幻影卡 / 下一轮复活 |
| 批准项到达（子运行） | `taskApprovals` 另表，不动父 Map | 父会话状态不变；任务区卡照常可见 | 父会话误报 |
| 采纳 / 拒绝 | `delete(id)` | 同一同步批次内退出待批；回落到生成档或终态；卡收敛 | 点完还读「等待批准」 |
| 停止 / 中断 | 统一撤回 `clear()` | 撤卡 + 标已停止（D383）+ 退场；随后 `stopping → idle` | 永恒「等待批准」幻影行 |
| done / error 收尾 | 统一撤回 `clear()` | 撤卡 + 标未执行 + 退场；随后终态 | 终态后残留可点的卡 |
| 换会话 / 切 vault / 新会话 | `clear()`（清面） | 新视图无待批；旧视图待决不串入 | 上一会话的待批泄漏到新视图 |
| 进入快照（enter） | **不清面**（前置已清）；在途列表重建；idle 列表丢弃 | 在途有列表 → 待批；无列表 → 生成档；idle 列表 → 无卡无状态 | 把 enter 当清面 / 旧 id 残留 |
| 终态对账（content） | 清面后按列表重放；idle 列表丢弃 | 终态相位下无待批；列表为空也不残留 | 旧视图有、新快照无 → 幻影 |
| 空闲遗留待批 → 新一轮 | `sent` / `auto_turn_started` 前清 stale | 新轮无待批；旧卡撤下 | 旧快照待批在新轮复活 |
| 重开面板 | 不拉快照、不清面 | 本地状态跨开合保留（不是快照重建） | 把本地保留误当快照覆盖 |

补充口径：

- **幂等**：同一 id 的重复决策不会二次兑现（`delete` 返回假即返回），重施也不会产生可见变化。
  同一 id 的重复投递同样不重建卡片（`appendApproval` 入口按待决 / 已决策集合早退）。
- **不计数**：待批状态是布尔，不是「N 项待批」；不引入数字读数（与未读提示同一条纪律）。
- **多待批项**：状态只在集合变空时退场；逐个决策期间维持「等待批准」。布尔判据因此不能
  在第一次 `delete` 后就假设已清空。**实现期发现并修复**：`appendApproval` 复用
  `block.running` 时会把上一条已挂的 `.lumir-hp-pend` 壳整体 `replaceWith` 掉，第一项的卡在第
  二项到达时静默消失；现在已在待决壳里的行会另起一行（同一工具块尾部），两张卡各自可决策。
- **决策后 done 配对（独立评审 r1 / r2）**：生产身份链是 `approval_request.id = ap-N`、工具
  done 带模型 `call_id`，两者**没有协议字段**可直接对应（`ApprovalRequest` /
  `PendingApprovalSnapshot` 都不带 call_id）。唯一现成关联是**事件序 + 行身份**：同一
  `handle_call` 先发带 `call_id` 的 `tool_call started`，批准卡就地升级这条行；前端据此把
  call_id 记到待批记录（`startedCallIds` → `pending.callId`），done 按 call_id 精确消费。
  快照恢复的待批没有 started 行，只能按工具名 + **到达顺序**（快照列表序 = 调用序，不是用户决策序）FIFO；后端顺序
  执行时 done 也按调用序到达，但**同名反序 done 无法从现成事件区分调用身份**，归属可能与执行顺序相反——这是该
  路径的明确限制，MUST NOT 假装精确。无 call_id 的旧事件同样只有 FIFO，**不承诺重复 done
  幂等**。有 call_id 的同一调用重复 done 幂等（`consumed`；快照项首次认领后升级 call_id，
  后续同 id done 同样幂等）。
- **同 turn 内 call_id 复用（r3 评审）**：后端只在单个 `TurnOutput` 内按 call_id 去重，工具
  循环可在同一 turn 内复用 id。`tool_call started` 因此是**新调用的权威起点**：它 SHALL 让该
  id 的旧配对（consumed 的 exact 项与已升级的 FIFO 项）退役，旧 transcript 行保留不删，新行
  重新建立 started 身份；`doneCallIds` 只在 `done` 路径写入、在新 started 与终态 / 清面清掉，
  保证本代重复 done 幂等而不吞下一代。旧行 MUST NOT 被改写。
- **配对表清理（r2 评审）**：终态撤回 MUST NOT 因 `pendingApprovals` 已空而早退——已消费记录
  及其 DOM 引用必须在**正常终态**与**新一轮开始**时无条件清掉，否则跨轮累积并扩大未来
  call_id 碰撞时的误配对面。`sent` / `auto_turn_started` 在上一相位为空闲时无条件清 stale。
- **不自动超时**：待批不会因时间退场；只有上述出口会清算。
- **快照是地板**：进入 / 对账快照的 `pending_approvals` 是待决集合的唯一重建依据；前端 MUST NOT
  保留「上一份快照里有过待批」的记忆来补状态。

## 5. 滚动合同与发送最终几何

### 5.1 不变量

1. 待批状态的出现 / 退场只改**文案与显隐**，不改滚动位：`scrollTop` 变化 ≤ 1px。
2. 待批状态本身不是「新内容」：MUST NOT 点亮未读、MUST NOT 重设未读基线。
   批准卡到达仍走既有 `follow.contentGrew()`（脱离态点亮未读，跟随态排一次贴底）。
3. 阈值与两态判据不动：`FOLLOW_ATTACH_PX = 6` / `FOLLOW_DETACH_PX = 16`、滞回、`onScroll` 唯一换态
   全部保持（F15）。MUST NOT 按输入通道另写判据，MUST NOT 在 `contentGrew` / `viewportChanged`
   里自动复跟。
4. 批准卡 / 快照回填 MUST NOT 强制回底（spec `:1989-1991`、场景 `:2030-2033`）。
5. 终态统一撤回（done / error / aborted）只改内容与状态，不写滚动位：`scrollTop` 变化 ≤ 1px；
   撤卡 / 标未执行不触发 `contentGrew()`，随后终态按既有口径处理未读。

### 5.2 发送最终几何（D5）

现状时序（F14）：

```
appendUserMessage()
  └─ 建用户消息 DOM → follow.jumpToBottom()      ← 写底用的是「卡片仍在 composer、进度块未出现」的几何
resetComposer()                                   ← 卡片移除：transcript 视口变高、max 变小
dispatchActivity(sent)
  └─ applySendPhase → progress.hidden = false     ← 进度块出现：视口变矮、max 变大（约 +28px）
```

两处布局变化都发生在写底之后，写底值按旧几何计算，与最终上限的偏差可达「卡片高度 + 约 28px」；
浏览器在卡片移除后通常把 `scrollTop` 夹到新上限（此时可见偏差只剩约 28px），但回声基准仍停在
旧值，且夹取与进度块出现之间留下一个可被滚动事件误判的窗口。修复只加一条：

```ts
dispatchActivity({ type: "sent" });
// 发送 = 强制回底白名单动作。上面的写底发生在 composer 清空与进度块出现之前；
// 这里按最终几何再回底一次（幂等），让写底值 / 回声基准 / 最终上限一致。
follow.jumpToBottom();
```

- 位置：`send()` 内、`dispatchActivity(sent)` 之后（`src/harness-panel.ts:9517` 之后）；此时
  `resetComposer()` 已执行、`applySendPhase` 已让进度块显隐落定。`jumpToBottom` 内的
  `read()` 会强制同步布局，读到的是最终几何，不需要 rAF。
- 幂等：重复调用只再写一次同一个上限，并刷新回声基准；不改变相位（仍是 following）。
- **只限发送**：`appendUserMessage` 的首跳保留；本 change 只在 `send()` 加第二跳。自动回合
  （`:8727`）、retry（`:6988`）、cron（`:9679`）等入口不在已批范围内，MUST NOT 静默扩散；若实现期
  发现它们也有同类几何窗口，登记 finding 另裁，不在本 change 顺手改。
- **实现期实测（2026-11-24，修前源码）修正了本节对缺口方向的预期**：卡片从 composer 移除会让
  transcript 变高、滚动上限**变小**，浏览器把旧写底值夹到新上限；随后进度块把上限加回来。
  条目的净缺口是 `进度块高度 − 被移除的输入区高度`：46px 的引用卡路径为负（夹取后仍在底，修前
  也绿），**composer 高度不变的纯文本发送**为正（实测 28px，修前必红）。因此 m638 的判别性断言
  落在纯文本路径，引用卡路径保留为「卡片移除 / 进度块显示 / 仍贴底」的回归 guard。D5 的
  「末尾按最终几何再回底一次」对两条路径同时成立，取舍不变。
- 回归防线：m638 的新用例在**同一个页面 task 内**点击发送并立即读 `scrollTop` / `max`
  （rAF 之前），旧实现必红；随后再等两帧确认仍贴底、浮钮不在场。

## 6. 可见面与视觉口径（无原型）

本 change 没有新原型；视觉口径按既有设计系统与 token 落，**禁止只写「沿用既有设计系统」**：

### 6.1 标题栏段状态词

- **位置**：`.lumir-hp-seg` 内、会话名钮之后、加号钮之前；状态词 `flex: none`，MUST NOT 被段的
  `overflow: hidden` 裁掉。**收缩链路**：`.lumir-hp-sessionwrap` 与 `.lumir-hp-session` 由
  `flex: none` 改为 `flex: 0 1 auto` 并设 `min-width: 0`；`.lumir-hp-sname` 设 `min-width: 0`
  （保留 `overflow: hidden` + ellipsis）。只改 `.lumir-hp-sname` 不够——父级 `flex: none` 仍不收缩，
  长会话名 + 状态词 + 加号会一起溢出并被段裁掉。
- **字层级**：`font-size: calc(var(--fs-meta) * var(--lumir-hp-scale, 1))`、`font-weight: var(--fw-medium)`、
  `white-space: nowrap`；不升档、不加粗。
- **颜色**：文字取 `--pending`（三主题均有定义，eink 为黑）；MUST NOT 新增颜色 / 底色 / 边框 /
  阴影 / 圆角。eink 不引入彩色，文字本身就是信号。
- **显隐**：非待批时 `[hidden] { display: none }`（零像素、不占 flex 间距）；待批时恢复正常
  flex 子项显示。idle / 无待批 / 面板收起时既有整页基线零漂移。
- **可访问性**：`role="status"`（隐式 polite），文本即「等待批准」；不另设 `aria-label` 覆盖文本。
  与 toggle 的 `aria-live` 互斥可见，同一时刻只有一个 live 区域在场。
- **不遮挡**：段是 flex 子项，不浮层、不绝对定位；不压会话名与加号钮。
- **测试宽度**：取「固定项（状态词 + 加号 + padding + gaps）之和以上、但不足以容纳长会话名」的
  段宽，迫使 sname 收缩 / 省略，同时给固定项留出可容纳的空间；不要用固定项本身都放不下的
  病态宽度判红。

### 6.2 toggle 状态

- `data-activity` 维持既有 `inflight` 形状（待批是在途的一种，不是第四态）；
- `activityStatus` 与 `title` 的状态词由 D870「处理中」改为「等待批准」；
- 状态点尺寸、颜色、eink 形状零变化。

### 6.3 阶段行

- 沿用 `.lumir-hp-stage` 的 `--fs-meta` / `--text-3`；新增待批档不改变字号、行高、间距；
- 进度条形态不变（不定态滑动；停止冻结口径不变）；
- 待批不是新动画、不是新颜色；eink 不变。

手感（段状态词是否太显眼、是否需要更弱的退让）归 Alex 真机裁决，不进机器判据。

## 7. 文案与取号

| 输出面 | 文案键 | 取值 | 说明 |
|---|---|---|---|
| 阶段行待批 | D976 | 等待批准… / Awaiting approval… | 与 D381 / D382 / D400 同族的省略号形态 |
| 段状态词 | 复用 D416 | 等待批准 / Awaiting approval | 与工具行待决尾注同一语义、同一串；不另立同文重复键 |
| toggle 状态词 / title | 复用 D416 | 等待批准 / Awaiting approval | title 形如「对话面板 · 等待批准」 |
| done / error 撤卡的工具行标签 | D977 | 未执行 / Not executed | aborted 仍用 D383「已停止」；两者不混用 |

取号纪律（实现期落定，2026-11-24）：起草时 deck 末位 D971；本分支 rebase 到 master `0180dab5`
时 `global-line-numbers-toggle-nov23` 已占 D972–D975，因此顺延取 **D976**（阶段行「等待批准…」）
与 **D977**（done / error 撤卡「未执行」），接当前末位。`move-harness-progress-to-output-tail-nov23`
的「正在继续本轮…」候选号须以本 change 归档后的 deck 末位复核。D416 的消费点为
`appendApproval` / `relabelApproval` + `applyActivityBadge`（同一串服务工具行尾注与标题栏待批
状态，MUST NOT 为标题栏另立同文键）。

## 8. 测试与验收矩阵

| 判据 | 单元 / 结构层 | Chromium 层 | 真机层 |
|---|---|---|---|
| 待批判据只读 `pendingApprovals`，且只在 `running` 成立；idle 待批不产生键 | 纯选择器表驱动：phase × pending × stageWaiting × unread → 键 | — | — |
| 阶段行待批档 + 优先级 | 选择器单测 | m347：注入 `approval_request`，断言 `.lumir-hp-stage` 文本；停止时读 D400；idle 遗留待批 → 发送后新轮读 D381、无待批 | 新场景：AX 读「等待批准…」 |
| 无待批不误报 | 选择器单测 | m347 / m638：先有正文分片、再有无审批工具调用 → 仍读 D382；标题栏读「处理中」 | 新场景对照组 |
| 段状态词只在待批时可见、不被裁切 | — | m756：`.lumir-hp-seg-status` 可见 / 文案 / 在段矩形内；无待批隐藏；**窄段 + 长会话名**下状态词与加号钮都在段内，会话名宽度较无待批时变小 | 截图 |
| toggle 状态同源 | — | m756：`activityStatus` 与 `title` 读「等待批准」；`data-activity=inflight` | 面板收起后 AX 读 help |
| 面板收起仍有信号；重开是本地保留 | — | m756：收起后再注入 `approval_request` → toggle 状态；重开 → 段状态保留（`attachTo` 不拉快照，不得记作快照重建） | 新场景 |
| 决策后清算（running 桩） | 选择器 / 接线 | m384：改用 `in_flight:true` 或先 `sent` 建立 running；决策前正断言「等待批准…」可见；覆盖多项逐个决策、最后一项、回落 D381/D382；MutationObserver 断言重复事件 / 流式分片不产生新的状态文本 mutation | 新场景 |
| 撤回清算（aborted / done / error） | 接线 | m638 / m756：待批时停止、done、error 各一条 → 撤卡、工具行标未执行、状态退场、无幻影；done/error 后 next sent 不复活 | 新场景 |
| 快照重建（enter / content 分开） | 接线 | m756：enter `in_flight:true + 非空` → 待批；enter `in_flight:true + 空` → 无待批；enter `in_flight:false + 非空` → 无卡无状态；content 空 / 非空 × 面板开 / 收 → 终态相位下都不复活待批 | 新场景（如可达） |
| 视图复位不串会话 | 接线 | m756 / m638：待批时新会话 / 切会话 → 新视图无待批 | 截图 |
| 子运行待批不误报 | 选择器 + 接线 | m822 既有场景补一条：父会话状态不变 | 既有 188 回扫 |
| 脱离态不拽视口（事件顺序写死） | 跟滚单测不变 | m638：**先上滚进入脱离态，再注入 `approval_request`** → `scrollTop` ≤1px、未读点亮、段状态在场；对照：**待批已存在后上滚、期间无新内容** → 不要求未读、不强制回底 | 新场景：截图 + AX |
| 发送最终几何 | — | m638 新用例：引用卡 + 发送，同 task 读 `scrollTop == max`（旧实现必红）；同时断言 quote card 确实移除、进度块确实显示、回声基准刷新；两帧后仍贴底 | 新场景：发送后底部像素 / 浮钮不在场 |
| 终态对账空 / 非空 × 面板开 / 收 | 接线 | m756：先以 `in_flight:true` 进入（`midTakeover=true`），再 fire done / error 触发 `content` 对账；快照返回非空 / 空列表 × 面板开 / 收 → 相位 idle、阶段行隐藏、toggle 按 idle / 未读档；非空列表不复活卡 | 新场景（如可达） |
| 阈值 / 跟滚语义不变 | `tests/unit/harness-scroll-lock.test.ts` 全绿 | m638 既有 1–9 条全绿 | 既有跟随手感 |
| 语言 / 主题 | 选择器 | m347 / m756：zh ↔ en 重取；eink 无彩色 | 截图 |

**实现期补测（独立评审 P2，2026-11-24）**：m756 的 content 对账按四格逐一建独立页面（非空 /
空列表 × 面板开 / 收），终态撤回补面板收起时的 done / error / aborted；待批时新建会话与切会话
走真实 DOM（后者经真正的 resume 回执）；m822 真实渲染子运行批准卡并断言父会话阶段行 / 段状态词 /
toggle 不变。上述均为行为断言，不再是读源接线声明。

**先红后绿**：实现前先在旧实现上跑新增断言并留红（阶段行待批 / 段状态 / toggle 状态 / 脱离态
信号 / 发送同 task 贴底至少各一条）。结构场景的「无待批不显示」旧实现天然绿，不作红判据。

**真机场景**（新增一条，编号实现期按套件最大值 +1）：

1. 打开 pane，引用一段 assistant 正文形成 quote card，输入问题并发送；
2. 断言发送后浮钮不在场（贴底）；
3. 上滚约一屏（脱离），记录 `scrollTop`；
4. mock fixture 延迟产出待批工具调用 → AX 读「等待批准…」；截图记录段状态词与浮钮未读；
5. 点浮钮回底 → 批准卡可见；阶段行仍「等待批准…」；
6. 采纳 → 阶段行回落「正在生成回复…」/「等待响应…」，段状态词退场；
7. 第二条待批 → 点停止 → 卡片撤下、状态退场、无「等待批准」残留；
8. 证据落 `.local/acceptance/`。

**回扫既有场景**：88 / 97 / 104 / 110 / 151 / 188 / 252 / 253。本 change 不改既有三档文案与
三态语义，期望逐字不变；实现后全量跑一遍，发现的过期期望就地改准（改闸 / 语义类 change 的
回扫纪律）。

### 8.1 Deferred / 不进机器判据

- **像素基线**：待批运行态的新像素只出候选截图（`.local/`），本 change 不 `--update`；基线更新
  是人肉裁决点，归 Alex。
- **段状态词的视觉重量**：是否太显眼、是否要更弱的退让、是否该只在脱离态出现——归 Alex 真机手感，
  不进机器判据；机器只守「在场 / 文案 / 不被裁切 / 不双播报」。
- **浮钮强调态 / sticky 提示**（D6）：本 change 不实现；若 Alex 认为标题栏信号不够醒目，另开 change。
- **极窄窗口下的裁切观感**：机器判状态词与加号钮的矩形都在段矩形内、`sname` 实际变窄且 ellipsis
  生效；只有视觉重量 / 观感归截图抽审与 Alex 真机裁决。
- **chromium 层不判的项**：`scrollTop` 的真实手感（惯性、动量尾巴）、WKWebView 的翻屏节奏归真机
  截图 / Alex；chromium 只判几何与结构。

## 9. 风险与已知边界

1. **toggle 在分栏态隐藏**（F11）：这是本设计改落点的直接原因。实现时 MUST NOT 通过「让 toggle
   在分栏态可见」来省掉段状态词——那会把一个退让控件变成常驻控件，且点击语义是关面板。
2. **段被裁切**：段有 `overflow: hidden`；状态词必须 `flex: none` 且排在会话名之后、加号钮之前，
   让会话名先省略。m756 用几何断言（状态词矩形在段矩形内）守住。
3. **双播报**：段 `role="status"` 与 toggle `aria-live` 互斥可见；实现后要确认面板开 / 收两态
   各只有一个 live 区域在场（结构断言：另一承载的 `offsetParent === null` 或 `hidden`）。
4. **幻影的主要出口是「列表为空的重建」**：`appendApproval` 不会被调用，必须在
   `restoreSnapshot` 末尾无条件重施一次；`clearTranscriptSurface` 也要重施。只挂在
   `appendApproval` 上会漏掉这一格。
5. **相位 idle + 待决列表**（旧快照缺 `in_flight`，或 live 待批在 idle 到达）：一律按 stale 丢弃——
   不渲染可决策卡、不入集合、不按「等待批准」上屏；若后端仍发批准，先排查终态或相位缺口，
   不在前端恢复卡片。
6. **stopping 期间待决未收回**：状态词必须已退场（优先级 stopping > 待批）；否则用户点了停止
   还读「等待批准」，与停止反馈冲突。
7. **重施的成本**：只在集合变化 / 相位变化时写 DOM；流式分片路径零新增节点、零新增布局读取，
   满足 ADR 0002 第 6 条。
8. **发送第二跳的边界**：只在 `send()`；自动回合 / retry / cron 不在已批范围，MUST NOT 顺手改。
   若实现期发现别处也有「清 composer / 进度显隐」的同类窗口，登记 finding 另裁，不静默扩散。
9. **尾行提案的基线**：本 change 归档后，尾行提案的 MODIFIED 块必须整块重抄新的 living；它的
   design §9.7 只能描述「尾行本身在脱离态不可见」，不得削弱本 change 的标题栏信号。
10. **取号竞争**：本 change 实现期实际取 D976–D977（master 落 D972–D975 后顺延）；后续提案以 deck 末位为准，不在提案期硬占。
11. **视觉基线**：待批是新的运行态像素，只出候选截图；idle / 无待批基线零漂移。`--update` 是
    人肉裁决点，本 change 不执行。
12. **done / error 撤卡是行为变化**：现状只撤 aborted；本 change 让 done / error 也撤卡并把工具行
    标为未执行。实现时 MUST NOT 只隐藏状态词；卡片必须不可点、决策闭包必须失效。
13. **enter 前置不变量**：`enter` 不清面，依赖构造 / `resetView` 的前置清理。若未来新增 `enter`
    调用点，必须先完成视图构造或 `resetView`；接线断言应钉住三个既有调用点，发现新调用点即红。
14. **idle 的 live 批准请求按陈旧处理**：这会让「相位已 idle 但后端仍发批准」不产生可点卡；
    若真出现该形态，先查后端是否漏发终态，不要在前端恢复卡片。
15. **会话名链路收缩**：只改 `.lumir-hp-sname` 不够；必须同时改 wrapper / button 的 `flex` 与
    `min-width`，否则窄段下状态词和加号会被裁掉。

## 10. 实施顺序

1. **先红**：纯选择器单测（表驱动）、m347 / m756 / m638 / m384 的新增断言、真机场景骨架；
   在旧实现上跑出预期红并留日志。
2. **纯判据与文案键**：`hasPendingApprovals` / `approvalSignalActive` / `stageCopyKey` /
   `activityStatusKey`；deck 取号与 D416 消费点扩展。
3. **标题栏两承载**：`.lumir-hp-seg-status` 节点与 CSS；`applyActivityBadge` 同步写段与 toggle；
   `applyActivityBadge` 仍是标题栏状态的唯一写点。
4. **阶段行**：`applyStage` 改用 `stageCopyKey`；停止优先保持。
5. **清算接线**：`refreshApprovalSignal`；`withdrawPendingApprovals` 在 done / error / aborted 与
   `sent` / `auto_turn_started` 的调用；`appendApproval` 的 idle stale 守卫；快照末尾重施。
6. **发送最终几何**：`send()` 末尾第二跳；m638 同 task 断言转绿。
7. **场景与门禁**：m347 / m756 / m638 / m384 转绿；真机场景 + 回扫 88 / 97 / 104 / 110 / 151 /
   188 / 252 / 253；`scripts/gate.sh quick`、`scripts/gate.sh visual`、`scripts/docs-check.sh`、
   `validate --all --strict`；候选截图归档。
