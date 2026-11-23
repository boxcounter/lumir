# Design: 跨 vault 的活动记录与按需未读入口

> 本文件写实现合同与取舍，不是实现记录。行号是起草时（2026-11-23）的读数，实现时以符号为准。
> **实现后回改（2026-11-23）**：§1 的表是**改动前**的事实底座（保留原读数，不回写历史）；最终符号以
> §3.1 的接口与代码为准——`createVaultActivityStore` / `activityDisplayed` / `activityKind` /
> `activityStatusKey` 在 `src/harness-activity.ts`，面板侧的 `accountActivity` / `projectActivity` /
> `renderActivity` / `paneSettled` / `reloadSessionView` 在 `src/harness-panel.ts`。
> 节点状态见 [proposal.md](proposal.md)：节点 1 已通过（2026-11-23，Alex 原话「三项推荐。」），
> D1–D6 全部按推荐值生效（D2 = 三态）。

## 1. 事实底座（实现前必须成立，逐条可核）

| # | 事实 | 位置 |
|---|---|---|
| F1 | `harness:event` 的公共信封 `vault` = 会话所属 vault 根路径，唯一施加点 | `src-tauri/src/harness/events.rs:26-39` |
| F2 | 前端只有一个 harness 事件监听器，收到**全部** vault 的事件 | `src/ipc.ts:813-818` |
| F3 | 非当前 vault 的事件在 `handleEvent` 第一道闸被整条丢弃（含终态） | `src/harness-panel.ts:8056-8059` |
| F4 | 后端会话表按 vault 根路径键控；切走不销毁、工具循环线程不中断 | `src-tauri/src/harness.rs:100-125` |
| F5 | `harness_state` 只服务当前 vault；非当前 vault 无快照可读 | `src-tauri/src/harness.rs:1915-1926` |
| F6 | 未读只有 `reply` / `failure` 两档、无计数；只由终态产生；`aborted` 不产生 | `src/harness-activity.ts:19-20`、`:77-87` |
| F7 | 未读只在「面板不在屏幕上」产生；`mounted` 实参是 `mountEl !== null` | `src/harness-activity.ts:77-87`；`src/harness-panel.ts:8297` / `:8348` / `:8357` |
| F8 | 「已读」入口是面板挂载：`opened` → `unread = null` | `src/harness-activity.ts:93-94`；派发点 `src/harness-panel.ts:9514-9516` |
| F9 | 切 vault 清空未读（当前口径） | `src/harness-activity.ts:95-98`；`src/harness-panel.ts:8894` |
| F10 | `applyVault` 顺序：flush → 编辑器复位 → `harnessPanel.vaultChanged`（4094）→ `switcher.onVaultLoaded`（4106）；后者 `await getSession` 后才 `applyStoredLayout` | `src/main.ts:4032-4110`、`:776-807`；`src/vault-switcher.ts:599-707` |
| F11 | `vaultChanged` 对同一 vault 是空操作；否则 `resetView()` + 重拉快照 | `src/harness-panel.ts:8928-8946` |
| F12 | `resetView` 有 5 个调用点：切 vault / 新会话 / cron 回滚 / cron 切屏 / 恢复会话 | `src/harness-panel.ts:8937` / `:9155` / `:9207` / `:9186` / `:9428` |
| F13 | cron 结果通知点击用 `vaultChanged("", null)` + `vaultChanged(root)` 强制重取（无专用 API） | `src/main.ts:3257-3269` |
| F14 | 点击发起的 cron 运行**先切到目标 vault** 再开面板、再发起 | `src/main.ts:3196-3219` |
| F15 | 无人值守 cron 只在「目标 vault == 当前 vault」时派发；隔离 runtime 不发面板事件 | `src-tauri/src/cron.rs:284-312`；`src-tauri/src/harness.rs:108-113` / `:200-214` / `:1555-1560` |
| F16 | 自动唤醒回合发 `auto_turn_started`；后台通知发 `notice`；二者都走同一 `ScopedSink` | `src-tauri/src/harness/subagents.rs:1106-1110` / `:1227-1250` |
| F17 | 后端**没有** `sent` 事件；发送相位由前端本地推 | `src/ipc.ts:496-557`；`src-tauri/src/harness/events.rs:92-421` |
| F18 | 乐观发送：先 `sent`，同步拒绝时走 `local_finish`，但收口被 `viewGeneration` 守卫整条丢弃 | `src/harness-panel.ts:9010-9034`、`:9046-9066` |
| F19 | 切换器行是 `div.vault-row-wrap` + 切换钮 + 移除钮两个兄弟；当前项不渲染移除钮 | `src/vault-switcher.ts:1161-1238` |
| F20 | 列表每次打开重新拉取，MUST NOT 维护常驻镜像；行数据 `path` 是注册表原值（未规范化） | `src/vault-switcher.ts:13-14`、`:848-851`；`src/bindings/VaultListEntry.ts:8-24`；`src-tauri/src/vault_registry.rs:400-463` |
| F21 | `.vault-list` 属滚动条「隐藏档」；行右缘不得被条压住 | `tests/unit/scrollbar-registry.test.ts:51-54` |
| F22 | 结构断言而非整页像素基线的先例 | `tests/visual/scenes/m756-harness-activity-presence.spec.ts:1-25` |
| F23 | 真机可判定载体是 `title` → AX `help` | `scripts/acceptance/README.md:536`、`:926`、`:1040-1055` |
| F24 | 现行 living spec 明确「只呈现当前 vault / 切换复位未读 / 跨 vault 未读不在范围」 | `openspec/specs/harness/spec.md:2294-2439` |
| F25 | 场景 253 把「完成后往返不伪造未读」写成正向断言 | `scripts/acceptance/scenarios/253-harness-vault-activity.md:154-171` |

结论：**跨 vault 记账只需要事件**（F1–F5）。上一 change 的 design §7 说「需要第二份真源」，是因为当时
只考虑了「切回时读快照」；事件信封已经把非当前 vault 的终态送到前端，第二份真源可以避免。

## 2. 结论与不变量

### 2.1 采用的最小形态

把现有的活动 reducer 从「面板单例」提升为**按 vault 根路径键控的一张表**：

- 每条记录仍是 `{ phase, unread }`，转移规则逐条沿用 `reduceActivity`，只把「面板是否在屏幕上」换成
  「该 vault 的 transcript 是否在屏幕上」。
- 标题栏 toggle 钮读 `store.of(currentVault)`；vault 切换器行读 `store.of(row.path)`，且只在行不是当前项
  时渲染。
- 行级三态是 D2 的裁决值（2026-11-23，按推荐值生效）：它让「切过去撞 busy」与「审批阻塞」也有信号；
  只做未读两档的退路不再适用，实现 MUST NOT 因此把 store 做成两套字段。

### 2.2 不变量（评审按这几条核）

1. **单一生产者**：`unread` 只由这份 store 的终态转移产生；标题栏钮与行只渲染，不写。
2. **单一相位状态机**：`phase` 的每次跃迁仍委托 `reduceSendPhase`；不新增第二套状态机（沿用上一 change
   的 `stop_clicked` 建模理由）。
3. **无后端变更**：不新增命令、不改事件协议、不改快照字段、不新增 Rust 用例。
4. **无第二真源**：不因行标记而在 `vault_list` 里加 `unread` 字段，也不维护「列表镜像」。
5. **无持久化**：未读水位只在内存、重启 / webview 重载后都不回放；app 重启全部从空闲开始，webview
   重载后当前 vault 的真实在途仍按进入快照恢复（见 §4.5）。
6. **无噪声**：没有计数、常驻角标、动画、toast、系统通知、自动切换 / 展开 / 抢焦点、新全局键位。
7. **行不改语义**：行标记不改变行高、行宽、排序、筛选匹配对象、游标空间、可访问名与点击落点。
8. **无注册表路径清理**：不设通用 `retain`、不按 `vault_list` 的 `path` 周期清理；只有显式删除 / 重定位
   按实际后端打开根 `drop`，避免旧拼写误删当前标题状态。

## 3. 状态模型

### 3.1 模块与接口

`src/harness-activity.ts`（现有纯模型层）扩为「逐条 reducer + 按 vault 键控的 store」；仍零 DOM、零定时器。

```ts
// 记录与事件（沿用现有 ActivityState；新增事件只表达跨 vault 的输入）
interface VaultActivityStore {
  of(vault: string): ActivityState;              // 未知键返回 INITIAL_ACTIVITY，不分配条目
  dispatch(vault: string, event: VaultActivityEvent): void;
  beginSend(vault: string): ActivityToken;       // 捕获 before + 记录版本，并置 turn_started
  rollbackSend(vault: string, token: ActivityToken): boolean; // 版本未变才恢复；返回是否生效
  finishIfStopping(vault: string): boolean;      // 停止请求被拒：仅当仍为 stopping 才收口
  reset(vault: string): void;                    // 视图复位（换会话）：phase idle + unread null
  drop(vault: string): void;                     // 显式删除 / 重定位：按实际后端打开根丢弃记录，不迁移
  subscribe(listener: () => void): () => void;   // 行 / 钮的渲染通知
}

interface ActivityToken {
  before: ActivityState;
  version: number;                               // 记录每次转移递增；只用于撤销过期的乐观起点
}

type VaultActivityEvent =
  | { type: "turn_started" }                        // 本地发送（乐观）或 auto_turn_started
  | { type: "stop_clicked" }
  | { type: "terminal"; kind: "done" | "error" | "aborted"; displayed: boolean }
  | { type: "displayed" }                           // 该 vault 的 transcript 在屏幕上
  | { type: "reset_view" }                          // 换会话（新会话 / 恢复 / cron 切屏 / cron 回滚）
  | { type: "enter_snapshot"; inFlight: boolean; epochAtRequest: number; epoch: number };
```

- `enter_snapshot` 的 epoch 判据仍由面板侧的 `enterSnapshotApplies` 决定（单一判据），store 只接受已判定
  可应用的事件；非当前 vault 不调用它（无快照）。
- `beginSend` / `rollbackSend` 只服务「同步拒绝」：`beginSend` 记录 `before`、应用乐观 `turn_started`，并
  返回**应用之后**的记录版本；`rollbackSend` 只在当前版本仍等于该 token 版本时恢复 `before`（发送后若已有
  真实事件推进了记录，回滚 MUST NOT 覆盖它）。**版本在每条生命周期输入上都推进**（`turn_started` /
  `stop_clicked` / `terminal` / `reset_view` / `enter_snapshot`），即使该输入没改变状态——乐观 `sent`
  之后的 `auto_turn_started` 在记录上是「相位 already running、无状态跃迁」，但它证明这一轮确实起来了，
  迟到的拒绝 MUST NOT 再把它撤销成空闲；`displayed` 只在真的清掉未读时算一次跃迁；它不产生未读、不当作一轮终态，不是第二个写入口，而是撤销
  一次乐观 `turn_started`（见 §6）。
- `finishIfStopping` 服务「停止请求被拒」：只在记录仍为 stopping 时收口；若该 vault 已因终态回到 idle
  或已开始新的一轮，MUST NOT 改写（见 §6.4）。
- `subscribe` 只在生命周期事件上触发；分片、工具行、`notice` 不触发（避免 per-chunk 重排）。

### 3.2 事件归类（与 spec 表一致）

| 输入 | 记录变化 | 说明 |
|---|---|---|
| 本地发送被前端受理（乐观） | `turn_started` → running | 发送时捕获 `sendVault`；若同步拒绝，`rollbackSend` |
| `auto_turn_started`（该 vault 信封） | running | 非当前 vault 也记（行上呈在途） |
| `stop_clicked` | running → stopping | 只可能发生在当前 vault（停止钮在面板内） |
| `done` | phase idle；`displayed` 为假 → unread `reply`；为真 → unread 清空 | 终态种类直接来自事件类型 |
| `error` | phase idle；`displayed` 为假 → unread `failure`；为真 → 清空 | 同上 |
| `aborted` | phase idle；unread **不变** | 用户自己按的；不清既有未读 |
| `approval_request` | 不改相位（该轮仍 running） | 行上因此呈「处理中」；不单列一档 |
| `notice` | 不改记录 | 若触发自动唤醒，后续 `auto_turn_started` / 终态照常 |
| `reset_view` | phase idle、unread null | 换会话的四个既有调用点 + 新增 `reloadSessionView`（见 §7） |
| `displayed` | unread null | 当前 vault 且 pane 在场时由面板发 |
| 重复终态 | 幂等 | 每个 vault 至多一枚未读，不累计 |
| 事件缺 `vault` | 归属当前 vault；当前为 null 时丢弃 | 与既有 `inCurrentVault` 的宽容口径一致 |

### 3.3 键与生命周期

- 键是**后端根路径串**（`event.vault` / `VaultInfo.root` / 注册表 `path` 在 M779 后同源；极老注册项例外
  见 §9）。
- `of` 对未知键**不分配**条目（`Map.get` 缺省返回 `INITIAL_ACTIVITY`），避免事件风暴把无关键写进表。
- 事件可以为未知 vault 建条目（例如某 vault 的在途轮次在切走后结束）；本 change **不设通用 retain /
  周期性清理**：没有行可显示的内存记录 MAY 留到应用重启或 webview 重载，属非持久化边界；它 MUST NOT
  产生任何可见标记。
- 内存是 O(注册 vault 数 + 未见过的活动 vault 数) 条小对象；无定时器、无订阅泄漏（`subscribe` 返回退订
  函数，装配层持有并随 app 生命周期释放）。

## 4. 显示门与已读时序（本设计最要紧的一节）

### 4.1 定义

> **已读 = 该 vault 是当前 vault，且 harness pane 对它在场（布局已落定）。**

不看窗口焦点、不看应用是否前台。`displayed` 是**派生量**，不是按 vault 存的持久标志：

```
displayed(vault) = (vault === currentVault && panePresent)
```

`panePresent` 是面板级布尔：面板 DOM 挂在 harness pane 里为真。它只由三个入口更新：

1. `attachTo(mount !== null)` → 真，并派发 `opened`（既有已读入口）；
2. `attachTo(null)` → 假；
3. `paneSettled(present)`（新增 API，由 `applyStoredLayout` 末尾调用）→ 真 / 假；为真时对当前 vault
   派发 `displayed`。

### 4.2 为什么不能按「切换瞬间的 DOM」判定

`applyVault` 在 `harnessPanel.vaultChanged`（F10，`src/main.ts:4094`）之后才经 `onVaultLoaded` 的
`getSession` await 走到 `applyStoredLayout`（`src/main.ts:776-807`）。若在 `vaultChanged` 那一刻按
`mountEl !== null` 判定：

- 目标 vault 的存储布局**没有** harness pane：旧 vault 的面板仍挂着，会被误判「在屏幕上」→ 未读被提前
  清算，随后面板才被关掉，信号静默丢失；
- 目标布局**有** harness pane：旧面板也仍挂着，判定「在屏幕上」碰巧正确，但这是巧合，不是合同。

因此：

- `vaultChanged` 只把 `panePresent` 置假，**不动未读**；
- `applyStoredLayout` 末尾给出显式信号：它在两条分支（有 / 无 harness pane）落定后都调
  `harnessPanel.paneSettled(present)`；
- 用户打开面板（`attachTo(mount)`）也清算（既有 `opened` 路径）。

### 4.3 时序表

| 时刻 | 动作 | 记录 / 显示门 |
|---|---|---|
| 切 vault 开始 | `vaultChanged(root, id)`：`currentVault = root`；`panePresent = false`；`resetView({ clearActivityFor: null })` | 目标 vault 的未读保留；旧 vault 的记录保留 |
| 切换窗口内终态到达（旧 vault） | `handleEvent` 先记账；`vault !== current` → 不再渲染 | 旧 vault 的 `displayed=false` → 记未读（保守） |
| 切换窗口内终态到达（新 vault） | 同上；`vault === current` 但 `panePresent=false` | 记未读；若布局随后有 pane，由 `displayed` 校正 |
| 布局落定且 harness pane 在场 | `applyStoredLayout` → `paneSettled(true)` | 当前 vault 的未读清除；`panePresent=true` |
| 布局落定且无 harness pane | `applyStoredLayout` → `paneSettled(false)` | 未读保留；`panePresent=false` |
| 用户 `⌘⇧A` / 点 toggle 打开 | `attachTo(mount)` → `opened` | 当前 vault 未读清除；`panePresent=true` |
| 用户收起面板 | `attachTo(null)` | `panePresent=false`；在途与未读都保留（收起 ≠ 复位） |
| 新会话 / 恢复 / cron 切屏 / cron 回滚 | `resetView({ clearActivityFor: <动作发起时捕获的 vault> })` | 该 vault 的记录 reset（idle / null）；其它 vault 不动 |
| 删除 / 重定位 vault | `drop(oldPath)` | 记录丢弃，不迁移；不复活陈旧信息 |

### 4.4 `applyStoredLayout` 的落点

`applyStoredLayout`（`src/main.ts:776-807`）在两条分支的**末尾**、`applySplitChrome()` 与
`syncActiveDocument()` 之后调用一次：

```ts
harnessPanel.paneSettled(paneLayout.panes().some((pane) => pane.handle.kind === "harness"));
```

要求：

- 两条分支都发（有 harness / 无 harness），不是只在 `addPane("harness")` 分支发；
- 已是目标形态时（本次 `addPane` / `closeHarnessPane` 都是空操作）也照常发——目标是「布局已落定」，
  不是「本次有改动」；
- 启动恢复、切换、重定位、新增 vault 都走 `switcher.onVaultLoaded` → `applyStoredLayout`，因此同一信号
  覆盖全部装载路径；
- 面板侧 `paneSettled` 幂等：重复 true 不重复清（`unread` 已是 null 时无副作用），重复 false 只置门。

### 4.5 app 重启与 webview 重载不是同一语义

- **未读水位**：两者都不回放；记录是纯内存，重载 / 重启后从空 store 起算。
- **app 重启**：Rust 后端与轮次一起结束，全部 vault 空闲是事实。
- **webview 重载**：Rust 后端仍在跑，当前 vault 的真实在途仍由**进入快照**的 `in_flight` 恢复（既有合同，
  `applyEnterSnapshot`）；MUST NOT 因「未读不持久化」把在途也清零、呈现假空闲。
- **非当前 vault**：重载后没有快照可读，其相位 / 未读**暂时未知**（不显示标记），直到该 vault 的后续事件
  到达，或用户切回它并读快照。MUST NOT 伪造「空闲」或「未读」。
- **生命周期处置**：这条边界写进 spec 的重启 / 重载场景；实现测试覆盖「重载后当前 vault 在途由快照恢复」
  与「非当前 vault 无标记直到事件」。

## 5. 事件接线（`handleEvent` 的次序）

### 5.1 新的处理顺序

```
1. 解析归属：vault = event.vault ?? currentVault；currentVault 为 null 且事件无 vault ⇒ 丢弃。
2. 先记账（在 vault 过滤与 turnOpen 闸门之前）：
   - terminal ⇒ store.dispatch(vault, { terminal, kind, displayed: vault === currentVault && panePresent })
   - auto_turn_started ⇒ store.dispatch(vault, { turn_started })
   - notice / text_chunk / tool_* 等不改记录
3. if (vault !== currentVault) return;            // 不碰 DOM、不碰 turnOpen
4. 既有 turnOpen 闸门与渲染（当前 vault 的可见面）
5. 当前 vault 的终态 / 自动回合仍按既有路径维护 turnOpen、midTakeover、DOM。
```

关键点：

- **记账必须在 F3 的 `inCurrentVault` 过滤之前**，否则跨 vault 终态仍然丢失。这是本 change 的核心接线
  改动，装配对账测试会钉住次序（§14）。
- **跨 vault 事件 MUST NOT 碰当前视图的 `turnOpen` / `midTakeover` / DOM**：它们属于当前会话的视图投影，
  被别的 vault 的终态关掉会让当前轮的分片被「轮次已关」丢弃。
- 当前 vault 的 `terminal` 仍走原有逻辑：store 先记（`displayed` 决定未读），面板再收口闸门与渲染。
- `notice` 不触发 store；`aborted` 只收口相位，不清未读。
- `enter_snapshot` 仍由 `fetchSnapshot` / `applyEnterSnapshot` 驱动；它只作用于当前 vault 的记录，并沿用
  `enterSnapshotApplies` 的 epoch / stopping 判据（单一判据，模型已导出）。

### 5.2 本地发送

`send()` 在 `dispatchActivity({ type: "sent" })` 的位置改为：

```ts
const sendVault = currentVault;               // 发送时定格；currentVault 为 null 时不发
const token = store.beginSend(sendVault);     // 捕获 before + 记录版本，并置 turn_started
```

成功回执不写记录（相位由事件 / 快照收口）；同步拒绝见 §6。

## 6. 发送后切 vault 的同步拒绝收口（必须修的在途卡死）

### 6.1 缺陷形态

现状（F18）：`send()` 先置 running（`src/harness-panel.ts:9034`），同步拒绝的收口在 `viewGeneration`
守卫之后（`:9050`、`:9066`）——用户切走后这条 `local_finish` 被整条丢弃。单 vault 时代切换会复位所以无
症状；按 vault 记账后 A 会**永久停在在途**（没有终态会来，因为它根本没起来）。

### 6.2 处置：把「活动记录收口」与「DOM / 输入区回滚」拆开

- `send()` 捕获 `sendVault` 与 `beginSend` 返回的 token（含发送前记录与记录版本）。
- 同步拒绝到达时，**先无条件** `store.rollbackSend(sendVault, token)`（在 `viewGeneration` 守卫之前）。
  这撤销的是乐观 `turn_started`，不是一轮终态；不产生未读、不清既有未读。
- `rollbackSend` **只在记录版本与 token 一致时生效**：若发送后已有真实事件推进了该 vault 的记录（例如
  后端已发 `auto_turn_started` / 终态），回滚 MUST NOT 用陈旧的 `before` 覆盖它——拒绝只撤销自己那一步，
  不撤销别人的转移。
- 然后仍按既有 `viewGeneration` 守卫决定 DOM / 错误行 / 输入区回滚是否落地（切走后不回滚新视图）。
- `harness_busy` 的既有处置（重取一次当前快照）保留，但不再影响「发送时 vault」的记录：若该 vault 真的
  还有另一轮在跑，token 版本已被真实事件推进，回滚 no-op（记录仍是 running）；若是「终态已发、尚未释放」
  窗口，`before` 是 idle 且版本未变，恢复 idle 正确。
- 不为这条路径新增「拒绝 ⇒ running」的转移（沿用上一 change 的纪律：拒绝不是在途证据）。

### 6.3 确定性回归

- **WHEN** 在 A 发送后立即切到 B，A 的发送被同步拒绝（`harness_busy` / 缺配置）
- **THEN** A 的记录回到发送前（不留在途），B 的 `turnOpen` / DOM / 输入区不受影响；切回 A 后不呈假在途。
- **WHEN** 发送后、拒绝到达前，A 的记录已被真实事件推进（如 `auto_turn_started` 或终态）
- **THEN** `rollbackSend` no-op，MUST NOT 用发送前快照覆盖真实状态。

### 6.4 停止请求被拒的同类收口

`stopHandler` 的 catch 现在直接 `appendError` + `local_finish`（`src/harness-panel.ts:3778-3787`）。按 vault
记账后，如果用户点击停止后切到 B，这条迟到的拒绝会关掉 B 的记录、把错误行写进 B 的视图——与发送拒绝
同形。处置：

- 点击停止时捕获 `stopVault = currentVault` 与 `stopViewGeneration = viewGeneration`；`stop_clicked` 记到
  `stopVault`。
- 拒绝到达时调 `store.finishIfStopping(stopVault)`：只在记录仍为 stopping 时收口；若 aborted 已到
  （idle）或该 vault 已开始新的一轮（running），no-op——MUST NOT 把新轮改成 idle。
- 错误行 / 输入区只在 `viewGeneration === stopViewGeneration` 时落地；切走后不写进新视图。

### 6.5 判定表

| 异步动作 | 捕获的键 | 收口 API | DOM / 快照守卫 |
|---|---|---|---|
| 发送被同步拒绝 | `sendVault` + token | `rollbackSend(sendVault, token)`（返回是否生效：生效才收口本视图闸门） | `viewGeneration` |
| 停止请求被拒 | `stopVault` | `finishIfStopping(stopVault)`（同上） | `viewGeneration` |
| 新会话 / 恢复回包 | `actionVault` + `actionToken` | `reset(actionVault)` | `actionToken` + `currentVault === actionVault` |
| cron 发起失败回滚 | `cronVault` + `cronToken`（`beginCronRun` 时捕获） | `reset(cronVault)` | `cronToken` + `currentVault === cronVault` |
| cron 通知打开会话 | `targetVault`（payload / 实际装载根）+ `cronToken` | `reset(targetVault)` | `cronToken` + `currentVault === targetVault` |

## 7. `resetView` 调用点与清除归属（原五处 + 新增 `reloadSessionView`）

`resetView`（`src/harness-panel.ts:8869`）增加参数：
`resetView(options: { clearActivityFor: string | null })`。非 `null` 时对**该 vault** 派发 `reset_view`；
`null` 时只做视图复位（DOM、世代、草稿等），不动任何记录。

**键的取法**：调用点 MUST 传「动作发起时捕获的 vault」，MUST NOT 在异步回调里读 `currentVault` 再清。
反例：在 A 点「新会话」后立刻切到 B，`harnessNewSession()` 的 `.then` 才执行；若此时清 `currentVault`
（B），会把 B 的未读 / 在途记录清掉。捕获 A 则语义正确——换的是 A 的会话。

| 调用点 | 现位置 | 场景 | `clearActivityFor` | 理由 |
|---|---|---|---|---|
| `vaultChanged` | `:8937` | 切 / 重开 vault | **null** | 切 vault 不是换会话；未读保留，已读由显示门判定 |
| `startNewSession` | `:9155` | 新建会话 | **调用前捕获的 vault（A）** | 换会话即换视图；旧的终态不再属于该视图 |
| `beginCronRun` | `:9186` | cron 点击运行切屏 | **调用前捕获的 vault** | 随后置 running；先清旧视图 |
| `reloadSession` | `:9207` | cron 发起失败回滚 | **`beginCronRun` 时捕获的 `cronVault`** | 放弃乐观视图；只回滚目标 vault |
| `reloadSessionView` | 新增 | cron 通知打开会话 | **`payload.vault`（恢复发起前捕获）** | 用户主动看该会话即已读；不读 `currentVault` |
| `resumeSession` | `:9428` | 恢复历史会话 | **调用前捕获的 vault（A）** | 换会话即换视图 |

注意：`vaultChanged` 先更新 `currentVault` 再调 `resetView`，所以 `null` 档必须在「不写记录」这一侧，
不能靠「记录键不是新 vault」来兜底（那会把新 vault 的记录清掉）。

**异步动作的 DOM 守卫（四条路径）**：`startNewSession` / `resumeSession` 的 `.then` 现在会无条件
`resetView()` 并渲染 / 刷新；`reloadSession`（cron 发起失败回滚）与 `handleCronOpenSession` /
`reloadSessionView`（cron 通知打开会话）同样可能在回包前切到 B。若不管，会清掉 B 的视图、把 A 的恢复
内容渲染进 B、或对 B 重取快照。统一处置：

- 动作发起时捕获 `actionVault` 与 `actionToken = viewGeneration`：
  - 新会话 / 恢复：发起时的当前 vault；
  - cron 发起运行：`beginCronRun` 时的当前 vault（即 `cronVault`），失败回滚沿用它；
  - cron 通知打开会话：`payload.vault`（经 `ensureCronVault` 后的实际目标根），在 `harness_resume_session`
    前捕获；不得在 resolve 后读 `currentVault`。
- 记录始终只复位 `actionVault`（`resetView({ clearActivityFor: actionVault })` 的记录部分）；
- DOM 打开 / 复位 / 消息渲染 / 读数刷新 / `fetchSnapshot` 只在 `isViewCurrent(actionToken)` 且
  `currentVault === actionVault` 时执行；否则整段跳过——用户已在 B，B 的 DOM 与快照 MUST NOT 被触碰，
  A 的可见内容等切回时由快照重建；
- `catch` 的错误行 / toast 同样按 `actionToken` 守卫，不写进 B；
- cron 两条路径的额外约束：`reloadSession(cronVault, cronToken)` 与
  `reloadSessionView(targetVault, cronToken)` 的签名必须显式接收目标 vault 与 token，MUST NOT 在函数内部
  读 `currentVault` 或复用「当前会话」语义。

这不是新增行为，而是把「异步回包不得写错视图」的既有视图世代纪律补到这些路径上；行为测试（§14.3b）
必须实际执行 A 动作 → 切 B → resolve / reject 并观察 B 的 DOM 与快照未被改写。

## 8. `vaultChanged("", null)` 空哨兵的替换

现状（F13）：通知点击用「先置空再设回」骗过 `vaultChanged` 的同 vault 早退，从而重取会话面。引入显示门后
这条哨兵会：

- 把 `panePresent` 置假且没有布局信号来恢复（它不走 `applyStoredLayout`）；
- 触发两次完整 `resetView` / DOM 重建，出现无谓闪烁；
- 让 `currentVault` 短暂为 `""`，期间到达的事件归属错乱。

处置：新增面板 API `reloadSessionView(options: { targetVault: string; viewToken: number })`（语义 = 清
**目标 vault** 的活动记录 + 仅当目标仍当前且 `viewToken` 未变时执行 `resetView` 与 `fetchSnapshot`）。
`handleCronOpenSession` 在 `harness_resume_session` 发起前捕获 `payload.vault`（经 `ensureCronVault` 后的
实际目标根）与 `viewGeneration`，resolve 后用它调用；MUST NOT 在 API 内部读 `currentVault`。既有
`reloadSession`（cron 发起失败回滚）同样改为接收 `{ targetVault, viewToken }`。两者差别只在命名 / 注释：
前者是「用户要求看这个会话」的重取通道，后者是失败回滚；两者都只清 `targetVault` 的未读（用户主动看 =
已读）。若调用时目标已不是当前 vault 或世代已变：只清目标记录，DOM 打开 / 复位 / 渲染 / `fetchSnapshot`
全部跳过，B 的视图 MUST NOT 被触碰。实现时 MUST NOT 再保留 `vaultChanged("", null)` 的调用点，装配测试
会 `rg` 钉住。

## 9. `drop` 与旧路径拼写

### 9.1 生命周期（无通用 retain）

| 事件 | 处置 |
|---|---|
| 显式删除 vault 成功 | `drop(实际后端打开根)`；撤销不回填 |
| 重定位 / 重映射成功 | `drop(旧的实际后端打开根)`；不迁移到新路径（用户刚显式改了身份） |
| 删除时该 vault 仍有在途轮次 | 记录被丢；后续终态会再建一条无行可显示记录；该记录 MAY 留到重载 |
| 未知键读 | 返回 `INITIAL_ACTIVITY`，不分配 |
| 无行可显示的内存记录 | MAY 留到应用重启 / webview 重载；MUST NOT 产生可见标记 |
| 应用重启 / webview 重载 | 整个 store 重建（未读不回放；重载后当前 vault 的在途按快照恢复，见 §4.5） |

**MUST NOT 设通用 `retain` 或按 `vault_list` 的 `path` 做周期性清理**：`vault_list` 返回注册表原值，
store 键是后端根；旧拼写下二者不同，按注册表路径清理会把当前标题栏仍在用的规范化根记录删掉。无行记录
虽会残留到重载，但不可见、且本版不持久化，是可接受边界；不能用一个会误删可见状态的清理换「表干净」。

### 9.2 旧拼写边界（fail-closed）

`vault_list` 返回的 `path` 是注册表原值、未规范化（F20）；M779 之后新打开会写规范化根。极老注册项可能
路径拼写与事件键不同：

- 行查 `store.of(row.path)` 查不到 → 不显示标记（**fail-closed，不误报**）；
- 当前 vault 的标题栏钮仍按事件键 / 当前根呈现；**不得因注册表路径不同而清理它**；
- 不在本 change 规范化 `path`、不改注册项、不做「同目录猜测」——那会把列表身份与事件键耦合成第二套
  判据，且可能把两个不同 vault 合错；
- 显式删除 / 重定位的 `drop` 也 MUST 用实际后端打开根（不是注册表原值）；取不到实际根时宁可不 drop，
  让记录留到重载，也不冒误删当前标题状态的风险；
- 写进 spec 的已知边界；若将来要收口，单开 change（先统一注册表读写路径，再让行键与事件键同源）。

## 10. 切换器行呈现（D2 已定：三态）

> **D2 裁定值**：三态（含 `inflight`），2026-11-23 按推荐值批准。两档退路不再适用——本节、两份 delta
> 与 tasks 一律按三态实现，不得保留「行只保留 reply / failure」的分叉表述。

### 10.1 数据与渲染

- 切换器 deps 增加 `activityOf(path): ActivityState` 与 `subscribeActivity(listener)`。
- `renderRow`（`src/vault-switcher.ts:1161-1238`）：
  - `const activity = this.deps.activityOf(row.path);`
  - `const current = row.id === this.currentId;`
  - 仅当 `row.available && !current && (activity.phase !== "idle" || activity.unread !== null)` 时插入
    标记。
  - 标记是 `span.vault-row-activity`，`aria-hidden="true"`，`data-activity` = `inflight` / `reply` /
    `failure`；**无文本**。
  - 状态词取 `t("D870")` / `t("D871")` / `t("D872")`；`el.title = `${row.name} · ${status}``。
  - 空闲 / 当前行：不插入节点、不设 `title`（保持行原样）。
- 浮层打开期间：`subscribeActivity` 回调里若浮层可见，遍历 `this.rows` 就地更新标记与 `title`（不重新
  拉取、不重排、不改游标）；**当前行也要清掉可能残留的标记与 `title`**（行由非当前变当前时不得留痕）；
  浮层关闭时回调直接返回，不做 DOM 工作。
- 行的 `toHaveText`、`aria-selected`、`data-vault`、点击处理器全部不变；标记不进入可访问名。

### 10.2 为什么当前行不显示（D4）

- 当前 vault 的信号已由标题栏钮承载；双承载会让同一状态在两处出现，是「常驻角标噪声」的入口。
- 当前行的 `vault-row-flag`（「当前」）已经在右端占位；再放活动标记会挤压名称且语义重复。
- 用户切到某 vault 后，浮层通常关闭；即使仍打开，当前行也不显示，避免「刚切过去就看到一个标记」的
  误导（那时 transcript 已在屏幕上，未读应已清算）。

### 10.3 只在浮层打开可见

- 行 DOM 只存在于浮层打开期间；关闭即随 `hidden` 消失。
- 不新增树头部角标、Dock 徽标、菜单栏图标、toast、系统通知。
- 浮层打开时列表仍只拉取一次（既有纪律）；活动更新是本地 store 通知，不触发第二次拉取。

## 11. 视觉保真合同

> 本 change 无独立原型稿；形态由文字合同 + 结构断言 + 并排截图裁决。`--update` 产生的任何基线仍归
> Alex 人肉过目。行标记是「标题栏钮形状语言的复用」，不是新视觉体系。

### 11.1 形状与尺寸

- 尺寸：6×6 px（与 `.lumir-hp-toggle-dot` 同档）；`border-radius: var(--r-pill)`；`box-sizing: border-box`。
- 在途：空心环，`1.5px solid currentColor`（行文字色，弱化；不抢阅读）。
- 未读回复：实心点，`background: var(--accent)`。
- 未读失败：实心点 + 1px 外环，`background: var(--danger)`，`box-shadow: 0 0 0 1px var(--danger)`。
- 标记 `pointer-events: none`：点击永远落到行切换钮，不改变点击落点。

### 11.2 位置与布局

- 标记在行顶行（`.vault-row-top`）内、名称之后，`margin-left: auto` 推到右端；与名称之间用既有
  `gap: var(--sp-3)`。
- 标记在切换钮的内容盒内：其矩形完全落在 `button.vault-row` 的矩形内；移除钮是 `vault-row-wrap` 的
  兄弟，标记与它**不相交**（结构断言钉住）。
- 空闲行不插入标记节点：不占宽、不产生像素、不改变名称省略号位置。
- 有态时标记占 6px + 6px gap；名称的省略号最多提前 12px 出现。这是可接受的、仅在有态时发生的收缩；
  不通过预留常驻空白来避免（那会让空闲行漂移）。**裁点**：若 Alex 不接受这 12px 收缩，备选形态是把
  标记放在摘要次行右端（行为不变，只改呈现）；在裁决前按本节实现，不自行另选位置。
- 不改 `.vault-list` 的滚动条档位（隐藏档）；不新增滚动容器；标记不贴近容器右缘（仍在行内，行有既有
  内边距）。

### 11.3 三主题与 eink

- light / dark：形状 + token（`--accent` / `--danger` / `currentColor`）；颜色只作增强。
- eink：`--accent` / `--danger` 恒 `#000`，三态靠形状区分（空心环 / 实心点 / 实心点 + 外环）；
  在途描边用 `var(--text)` 提实；不引入彩色或中间调（6px 面积上的抖动会糊）。
- 无动画、无过渡、无 `prefers-reduced-motion` 分支。

### 11.4 字层级 / 行高

- 不新增文本，因此不新增字号 / 字重 / 行高；行高由既有 `.vault-row` 与 `.vault-row-sub` 决定，标记
  不改变行高。
- `title` 只承载状态词，不上屏；不改变行内摘要（标签数 · 时间）。

### 11.5 状态差异

| 行状态 | 标记 | `title` | 像素变化 |
|---|---|---|---|
| 空闲 | 无节点 | 无 | 零 |
| 在途 | 空心环 | `<名字> · 处理中` | +6px（+gap） |
| 未读回复 | 实心点 | `<名字> · 有新的回复` | +6px（+gap） |
| 未读失败 | 实心点 + 外环 | `<名字> · 有失败结果` | +6px（+gap） |
| 当前行 | 无节点（无论状态） | 无 | 零（由标题栏钮承载） |

hover / focus 只走既有行样式，标记不变化、不放大、不变色。

## 12. 噪声闸门、性能与无障碍

### 12.1 噪声闸门（实现期防扩 scope）

MUST NOT 新增：入口 / 树头部角标、数字计数、常驻点、动画、toast、系统通知、Dock 徽标、菜单栏图标、
自动切换 vault、自动展开面板、抢焦点、新全局键位、未读列表 / 通知中心、诊断事件、定时器。
只有浮层打开时行标记可见；每 vault 至多一枚；当前行不显示；空闲行零像素。

### 12.2 性能（ADR 0002 第 6 条）

- store 读写 O(1)；事件只处理生命周期类型，`text_chunk` / `tool_*` 不触碰 store。
- `subscribe` 只在相位 / 未读跃迁时触发；浮层关闭时回调零 DOM 工作。
- 不进入按键路径；不新增定时器；不新增 IPC；不增加每分片工作量。
- 切换器行更新只遍历可见行（≤ 注册表条目数，通常个位数），且只在浮层打开时发生。

### 12.3 无障碍

- 行标记 `aria-hidden="true"`，不进入可访问名；状态词进 `title`（AX `help`），真机可判。
- 不新增 `aria-live`（行列表里的播报会变成噪声）；标题栏钮的既有 `aria-live` 不变。
- 不改变行的 `role="option"`、`aria-selected`、`aria-disabled`、键盘游标。

## 13. 备选方案与取舍

| 方案 | 做法 | 代价 | 结论 |
|---|---|---|---|
| **A. 只做未读两档** | 行上只显示 reply / failure，不显示非当前 vault 的在途 | 更小；但「切过去撞 busy」与审批阻塞无信号 | 可选退路（D2 裁定） |
| **B. 推荐：三态单 store** | 一份按 vault 键控的记录，标题栏钮与行同源；在途覆盖审批等待 | 需按 vault 记账发送 / 停止 / 自动回合，并处理乐观发送收口 | **推荐** |
| C. 后端持有 per-vault 未读，随 `vault_list` 返回 | 注册表列表直接带 `unread` | 「已读」是 UI 事实 → 需新的 mark-read 命令；标题栏仍由事件驱动 → 同一语义两个产出点；列表只在打开时拉，实时性差 | 不推荐 |
| D. 持久化未读水位 | 配目录落 per-vault / per-session 水位 | 陈旧标记、清理规则、schema 迁移；收益仅「退出前没看到」 | 不推荐，列非目标 |
| E. 全局跳窗 / 通知中心 | 任意 vault 有结果就弹窗 / 常驻汇总 | 噪声；Alex 已明确否掉方向 | 不做 |

方案 B 的主要风险不是功能，而是「两条承载做成两套判定」。设计强制：`unread` 只有一个生产者（store），
`harness-activity.ts` 的 reducer 是唯一转移规则；标题栏与行只做渲染。

## 14. 测试设计

### 14.1 先红后绿

所有行为测试 MUST 先在旧实现上红（或断言失败），再实现转绿；不接受「写完实现再补测试」。行标记是新增
DOM，结构场景的「空闲零新增像素 / 当前行无标记」在旧实现上天然绿，须另配一条「非当前行三态在场」的
红判据（旧实现无标记）。

### 14.2 模型层（`tests/unit/harness-vault-activity.test.ts`，新增 / 扩展）

1. 按 vault 隔离：B 的终态不动 A 的记录；
2. `displayed` 门：当前 + 在场才清；非当前终态必置未读；当前但门假也置未读；
3. `aborted` 不置未读、也不清既有未读；
4. `done` / `error` 分档；
5. 重复终态只一枚、不计数；
6. `reset_view` 只清目标 vault；
7. `drop` 后读回 idle；未知键不分配；**没有通用 `retain`**（store 不提供按注册表路径清理的 API）；
   无行记录不改变 `of(当前根)` 的读数；
8. 相位逐条与 `reduceSendPhase` 输出相等（含 stopping 幂等）；
9. `rollbackSend` 撤销乐观起点：版本未变时 running → 之前的 idle / running 原样恢复，不产生未读；
   版本已变时 no-op（不用陈旧 before 覆盖真实转移）；
10. `finishIfStopping` 只在 stopping 收口；idle / running 时 no-op；
11. `subscribe` 只在跃迁时触发（分片 / notice 不触发）。

### 14.3 装配结构对账（源码级，补充）

以下断言只守结构不变量，**不能替代 14.3b 的行为测试**：

1. `handleEvent` 的记录步骤在 vault 过滤与 `turnOpen` 闸门**之前**（源码级次序断言）；
2. `unread` 只有这一个生产者：全仓 `rg` 不存在第二张按 vault 的未读表 / 第二个 `applyActivityBadge`
   写点；
3. `resetView` 五个调用点逐点断言「清哪个 vault / 不清」矩阵（§7；含异步回调按发起时 vault 清除）；
4. `applyStoredLayout` 两条分支都发 `paneSettled`，本次无改动也发；
5. `vaultChanged("", null)` 无残留调用点；`handleCronOpenSession` 走
   `reloadSessionView({ targetVault, viewToken })`；
6. 无通用 `retain` / 无按注册表 `path` 的周期性清理（`rg` 无该 API 与调用点）；
7. 无新增定时器 / 无 per-chunk 重排 / 无新增 IPC。

### 14.3b 装配行为竞态（deferred Promise，必须）

用可控 deferred 的依赖桩（`harnessSend` / `harnessAbort` / `harnessNewSession` / `harnessResumeSession` /
`getSession` 等返回可手动 resolve / reject 的 Promise），**实际执行**「A 动作 → 切 B → resolve / reject」，
观察 A/B 两侧 store 与 DOM。每条都要在旧实现上红：

> 若现有面板 / 装配 factory 没有暴露这些依赖，先在 `src/harness-panel.ts` / `src/main.ts` 的 deps 增加
> 测试注入点（生产默认值不变），或用模块级 mock；**不得退化成只读源码断言**。

1. **发送拒绝**：A 发送 → 切 B → reject（`harness_busy` / 缺配置）。断言：A 记录回到发送前（不留在途）、
   B 的 `turnOpen` / transcript / 输入区不变；A 的拒绝错误行不写进 B。
2. **停止拒绝**：A 在途 → 点停止 → 切 B → reject。断言：A 只在仍为 stopping 时收口；若 A 已 idle 或已
   有新轮 running，则 no-op；B 的记录 / DOM 不变。
3. **新会话回包**：A 发起新会话 → 切 B → resolve。断言：只清 A 的记录（A 从新会话起算）；B 的记录与
   DOM 不变；A 的会话内容不渲染进 B。
4. **恢复回包**：A 发起恢复 → 切 B → resolve。断言：只清 A 的记录；B 的记录与 DOM 不变；恢复内容不
   写进 B 的 transcript。
5. **token 版本交错**：A 发送（token v1）→ 后端事件推进 A 的记录（`auto_turn_started` / 终态）→
   reject 到达。断言：`rollbackSend` no-op，不用陈旧 `before` 覆盖真实状态。
6. **resetView 异步清除**：A 发起新会话 / 恢复 → 切 B → 回包 `.then` 调 `resetView`。断言：清 A 而非 B
   （若实现读 `currentVault`，B 的记录会被误清，测试必红）。
7. **门时序**：A 切到「布局无 harness pane」的 B，终态在布局落定前到达。断言：先按不在屏幕上记未读，
   `paneSettled(false)` 后保留；`paneSettled(true)` 才清除。
8. **cron 发起失败回滚**：A 调 `beginCronRun` → 切 B → `harness_cron_run` reject。断言：A 的记录按新会话
   复位 / 放弃乐观运行；`reloadSession(A, token)` 只作用于 A；B 的记录、DOM 与快照 MUST NOT 被复位或
   重取；A 的失败提示不写进 B。
9. **cron 通知打开会话**：A 通知点击发起 `harness_resume_session` → 切 B → resolve。断言：A 的记录按新
   会话复位；B MUST NOT 被 `openHarnessPane` 打开、MUST NOT 清未读、MUST NOT 重取快照；恢复内容不渲染
   进 B，切回 A 时由快照重建。

真机主路径矩阵（14.6）不能替代这些确定性竞态测试。

### 14.4 切换器行（扩展 `tests/unit/vault-switcher.test.ts`）

1. 非当前行有状态才建标记；当前行永不建；
2. 标记 span 无文本、`aria-hidden`；行 `title` 为「名字 · 状态词」，空闲无 title；
3. 浮层打开期间 store 变化就地更新，不触发第二次 `vault_list`、不重排、游标不变；
4. 显式移除后行与标记随列表消失；注册表变化但无显式移除时，无行记录不产生可见标记（**不做 retain**）；
   经显式移除的 vault 重新加入同一目录铸新 id 时不复活旧记录；
5. 筛选、键盘游标、`toHaveText` 口径不变；旧拼写路径无标记，且当前标题栏状态不因旧拼写被清理；
6. 标记矩形完全落在切换钮矩形内，且与移除钮矩形不相交（可用 jsdom 的 `getBoundingClientRect`
   桩 + 结构断言；像素层由视觉场景兜底）。

### 14.5 结构视觉（新增 `tests/visual/scenes/mvp-vault-row-activity.spec.ts`）

- 用桩的 `__fireHarnessEvent` 注入带 `vault` 的 `auto_turn_started` / 终态，打开切换器。
- 判据：
  1. 非当前行三态形状可判（`data-activity` + 计算样式：border / background / box-shadow）；
  2. 标记点完全落在切换钮矩形内、不越出、不与移除钮相交；
  3. 当前行无标记；空闲行零新增像素 / 无标记节点；
  4. 三主题下靠形状可分（eink 不依赖颜色）；
  5. 浮层关闭后标记不可见（无浮层外节点）。
- **不新增整页像素基线**（沿用 m756 先例；6px 元素远小于整页容差预算）。若未来要基线，单独走
  `--update` + Alex 过目。

### 14.6 真机矩阵（真实 WKWebView，mock provider）

新场景（**实现期分配：id / item = 721**——起草时读数 272 / 708 已过时，实现时套件最大 id / item 均为
720；`721-harness-vault-unread` 随本 change 同批落盘，fixture `harness-mock-activity-unread.json`）：

1. A 发起慢流 → 收起面板 → 切到 B → 打开切换器 → A 行 `help` 含「处理中」；截图。
2. 等终态 → A 行 `help` 含「有新的回复」；截图。
3. 点 A（面板仍收起）→ 标题栏钮 `help` 含「有新的回复」；当前行无标记；截图。
4. 打开面板 → 回复在场；再收起 → 钮回到空闲；截图。
5. A 再来一轮失败 → 切到 B → A 行 `help` 含「有失败结果」；切到 A（面板不在场）→ 钮仍显示失败；
   打开面板 → 清；截图。
6. A 再来一轮并主动停止 → 切到 B → A 行无任何标记（`help` 不含三词）；截图。
7. **时序回归**：B 有未读时，切到一个「存储布局里没有 harness pane」的 vault → 未读不得被误清算
   （切过去后面板已收起，钮仍显示未读）；截图。
8. 编辑中途不切 vault 的对照：当前 vault 收起态行为与场景 252 逐字一致（不回归）。

回扫：把 `scripts/acceptance/scenarios/253-harness-vault-activity.md:154-171` 的第三步从「完成后往返 ⇒
不伪造未读」改为「完成后往返 ⇒ 呈未读、切回并在面板在场时清算」；场景 252 不改；`COVERAGE.md` 重新生成。
证据落 `.local/acceptance/`（git 外）。

### 14.7 门禁

- `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`
- `bash scripts/docs-check.sh`（含 archive-check 门禁模式：MODIFIED 不得静默丢段）
- `scripts/gate.sh quick`
- `scripts/gate.sh visual`（动过 `src/style.css` / `src/harness-panel.css`，必须本地跑像素层）
- 真机场景 PASS + 证据目录可 `ls`

## 15. 风险与已知边界

1. **乐观发送 + 视图守卫卡死在途**：必须在发送时捕获 vault 与 token，同步拒绝先 `rollbackSend` 再走视图守卫
   （§6）；配「切走后发送被拒 ⇒ A 不留在途」与「版本已变 ⇒ 回滚 no-op」两条回归。
1b. **停止拒绝串视图**：必须在点击时捕获 `stopVault` 与视图世代，拒绝时 `finishIfStopping(stopVault)`；
   否则切走后会关掉 B 的记录、把错误行写进 B（§6.4）。
2. **空哨兵**：`vaultChanged("", null)` 会破坏显示门（§8）；替换为显式
   `reloadSessionView({ targetVault, viewToken })`，测试钉住无残留。
3. **`applyStoredLayout` 之前到达的终态**：门必须在 `vaultChanged` 置假、布局落定后置真；否则目标无 pane
   会误清算（§4）。
4. **注册表旧拼写**：行键与事件键可能不同；fail-closed 不显示标记，不猜测映射、不改列表身份（§9.2）。
5. **切换窗口内到达的终态**：保守按「不在屏幕上」记未读；随后若 pane 在场由 `displayed` 校正。宁多一枚
   标记，不静默丢失。
6. **未读不持久化 / 重载**：未读水位不回放；app 重启全部空闲；webview 重载后当前 vault 的真实在途仍按
   进入快照恢复，非当前 vault 暂时未知（§4.5）。MUST NOT 把「未读不持久化」误读成「重载后在途也清零」。
7. **两个同名 vault**：本来靠摘要与悬浮提示区分（路径次行已按 M217 裁掉）；本 change 不改变该现状，
   行标记也不提供区分。
8. **视觉基线**：行标记只在有态时出现，空闲基线零漂移；新结构场景不新增整页基线；任何 `--update` 是
   Alex 人肉裁决点。
9. **滚动条纪律**：`.vault-list` 属隐藏档；标记不引入新滚动容器、不压移除钮；结构断言钉「点在切换钮
   矩形内且与移除钮不相交」。
10. **行宽收缩**：有态时名称省略号最多提前 12px 出现；不预留常驻空白（否则空闲漂移）。若 Alex 认为
    收缩不可接受，备选是把标记放在摘要次行右端（行为不变，形态另裁）；裁决前不自行换位置。
11. **事件量**：全部 vault 的事件本来就到达前端（F2）；本 change 只新增终态 / `auto_turn_started` 的
    常数级记账，不新增订阅、不新增 IPC。
12. **无行记录**：不设通用 `retain`；显式删除 / 重定位按实际后端打开根 `drop`；无行记录 MAY 留到重载、
    MUST NOT 产生可见标记。取不到实际根时宁可不 drop，也不冒误删当前标题状态的风险（§9）。
13. **旧拼写 + retain 的反例**：若实现图省事按 `vault_list` 的 `path` 周期清理，旧拼写会把规范化根的
    当前标题状态删掉；这是本 change 明确禁止的方案，源码断言与行为测试都要钉住。
14. **可重试失败的 `beginRetry` 跨 vault（r1 评审后改为按 token 收口）**：重试点击与普通发送共用
    同一条乐观起点通道（`beginSendActivity` 捕获点击前的记录与版本）；拒绝到达时**先**撤销这次乐观
    `turn_started`（版本门：期间已有真实 `auto_turn_started` / 终态时不覆盖），**再**走视图世代守卫
    决定错误行与轻量快照。这遵守 change add-harness-turn-retry-nov23 的「不得按拒绝语义强制 idle」
    合同——恢复的是点击前的记录本身，不是「拒绝 ⇒ idle」；切到 B 后 A 因此不残留假在途。

## 16. 实现期可另定的细节（不构成裁决点）

- store 的具体文件拆分（留在 `harness-activity.ts` 或新文件）与命名。
- 行标记的类名、是否在空闲时保留隐藏节点（推荐不保留，零像素最直接）。
- `paneSettled` 的命名与放置（面板 API vs deps 回调）。
- 新真机场景的 id / item 编号（按套件当前最大 +1 分配，不预占 273）。
- 结构视觉场景的文件名（建议 `mvp-vault-row-activity.spec.ts`）。
