# Proposal: 跨 vault 的 Harness 终态按需未读入口

- Change ID: `extend-harness-activity-across-vaults-nov23`
- 日期: 2026-11-23
- 角色: Alex Lee（方向批准、节点 1 裁决），AI agent（起草）

> 节点状态（先读这一段）
>
> - **节点 1（提案评审）已通过**（2026-11-23）。Alex 原话：「三项推荐。」本批三项提案（持久化健康
>   状态 / 失败轮次显式重试 / 跨 vault 终态未读）一起送裁、一次答复，语义为**三项全部按推荐值批准**。
> - **D1–D6 全部按推荐值生效**：D1 严格已读时点、**D2 三态（含在途）**、D3 不跨重启、D4 当前行不
>   显示、D5 审批等待归在途、D6 单独 notice 不点亮。无改值、无否决项；下文「What Changes」与两份
>   delta 即为批准的施工依据。
> - 实现期若范围 / 行为需求发生变化，停下更新本文件并重走节点 1，不静默扩 scope。
> - 本 change 只到提案层；living spec 的改动以 delta 形式留在本 change 目录内，归档时并入，不提前改写
>   living spec。
>
> **r1 评审处置（2026-11-23，独立评审判 needs-changes）**：逐条落实跨 vault 阻塞与相关建议——
> ① 清除语义改为「动作发起时捕获的 vault」，补新会话 / 恢复跨 vault 回包场景；② 删除通用 `retain` 与
> 注册表原 `path` 清理，只靠显式删除 / 重定位按实际后端打开根 `drop`，无行记录最多留到重载；③ 区分
> webview 重载与 app 重启（未读都不回放，但重载后当前 vault 的真实在途仍按进入快照恢复，非当前 vault
> 暂时未知）；④ 源码次序 / `rg` 断言降为结构补充，新增 deferred Promise 的面板 / 装配行为测试；⑤ 标明
> D2 两档退路须同步撤三态条款，行宽裁点保持明确。详见 `design.md` §4.5 / §6 / §7 / §9 / §14 与本文件对应段。
>
> **r2 评审处置（2026-11-23，复审判 needs-changes）**：剩余阻塞是 cron 两条异步路径缺 DOM 守卫。已将
> `actionVault + viewGeneration` 扩到 `beginCronRun` / `reloadSession` 与 `handleCronOpenSession` /
> `reloadSessionView`：记录只复位实际目标 vault；DOM 打开 / 复位 / 渲染 / `fetchSnapshot` 只在目标仍当前
> 且世代未变时执行，切走后跳过 B 的全部副作用。`§8` 与 tasks 3.9 改为显式 `{ targetVault, viewToken }`，
> §14.3b / tasks 1.2a 增加「cron 发起→切 B→reject」与「cron 恢复→切 B→resolve」两条 deferred 测试。

## Why

### 现场

在 vault A 发起一轮后收起面板、切到 vault B 继续工作，A 的轮次仍在后端运行；它结束时，用户当前看到的
B 没有任何信号，只有切回 A 或重新打开面板才发现「早就答完了」。上一个 change
`add-harness-activity-presence` 解决了**当前 vault 收起态**的在途 / 未读指示，但把跨 vault 未读明确列为
非目标（其 design §7 与 spec 的「离开期间发生的终态」场景都写死了「MUST NOT 伪造未读」）。

### 关键事实：不需要新的后端通道

后端给每条 `harness:event` 盖的 `vault` 信封（`src-tauri/src/harness/events.rs:26-39`）已经把**全部 vault**
的事件送到前端；前端只有一个监听器（`src/ipc.ts:813-818`），收到全部事件。今天唯一丢掉跨 vault 终态的
地方是 `src/harness-panel.ts:8056-8059` 的一道 `inCurrentVault` 过滤。后端会话表按 vault 根路径键控、
切走不销毁（`src-tauri/src/harness.rs:100-125`），但 `harness_state` 只服务当前 vault
（`src-tauri/src/harness.rs:1915-1926`）——所以跨 vault 的活动只能靠事件记账，不能靠快照轮询；事件已经
够用，不需要第二份真源。

### 为什么值得做

- 未读是「有结果待我看」的 UI 事实，不是新的执行状态；现有 reducer 已有两档未读与三态形状，扩展成本低。
- 不做的话，用户在 dogfood 里会继续用「反复切 vault 检查」代替提示，正好撞上后端 `harness_busy` 拒绝。

## What Changes

### 1. 把活动记录从「面板单例」提升为「按 vault 键控的一张表」

- 扩展现有的前端 activity reducer / store（`src/harness-activity.ts`），键是后端 vault 根路径；每条记录
  仍是 `phase` + `unread` 两个字段，转移规则逐条沿用现有 reducer，MUST NOT 另立第二套相位状态机。
- 复用**全部** harness 事件信封：轮次开始（本地发送 / `auto_turn_started`）、终态（`done` / `error` /
  `aborted`）、`notice` 的既有归类都不变；不新增后端命令、不改 Rust、不新增事件类型。
- 未读只有一个生产者（这份 store）；标题栏钮与切换器行都只做渲染，MUST NOT 各写一份判定。

### 2. 已读判据：transcript 真的在屏幕上

- **已读 = 该 vault 是当前 vault，且 harness pane 对它在场（布局已落定）**；不看窗口焦点、不看应用是否
  前台（沿用上一 change 的口径）。
- 切到某 vault 但面板是收起的（或目标存储布局里没有 harness pane）MUST NOT 清除该 vault 的未读；标记保留，
  转由标题栏钮承载，打开面板才清。
- 视图复位（新会话 / 恢复 / cron 切屏 / cron 回滚）只清**动作发起时捕获的 vault**；异步回包到达时的当前
  vault 不参与清除——在 A 发起、切到 B、回包才到时只清 A，B 的记录与视图不受影响。
- cron 两条异步路径（发起失败回滚 / 通知恢复）同样按发起时目标 vault + 视图世代守卫：切走后只清目标记录，
  MUST NOT 打开 / 复位 / 渲染 / 重取 B 的视图或快照。
- 显示门必须在 `vaultChanged` 置假、在 `applyStoredLayout` 落定后按目标布局置真 / 置假——否则「目标 vault
  没有 harness pane」会在切换瞬间被误清算（时序见 design §4）。

### 3. vault 切换器非当前行的轻量三态（D2 已定：三态）

- 行上复用标题栏钮的同一套形状语言：在途 = 空心环、未读回复 = 实心点、未读失败 = 实心点 + 外环；6×6，
  形状承载语义，eink 靠形状。
- **只在行不是当前项时**渲染；当前行不重复（当前 vault 的信号由标题栏钮承载）。
- 只在切换器浮层打开时可见；没有计数、没有常驻角标、没有动画、没有 toast、没有系统通知、不自动切 vault、
  不自动展开面板、不抢焦点。
- 行内不新增文本：标记是空的 `aria-hidden` 元素，状态词只进该行切换钮的 `title`（`<显示名> · <状态词>`）。
- 行宽裁点（不属 D1–D6，节点 1 未单列裁决）：按「有态时名称省略号最多提前 12px」实现；若 Alex 看到
  真机后不接受该收缩，备选是把标记放到摘要次行右端（行为不变，形态另裁）。

### 4. 终态归类（沿用既有语义，逐条写死）

| 情形 | 是否算未读 | 口径 |
|---|---|---|
| 后台正常完成（`done`） | 算，档位「有新的回复」 | 与当前 vault 既有规则同源 |
| 后台失败（`error`） | 算，档位「有失败结果」 | 失败是用户需要看一眼的东西 |
| 用户主动停止（`aborted`） | 不算，也不清既有未读 | 停止是用户刚做的事，提醒他只是复述 |
| 审批等待（`approval_request` 挂起） | 不算未读，归「在途」 | 它是「阻塞、待处置」，不是「已完成、待你看」；单独成档会引入第四种清算语义 |
| 无人值守 / 定时 cron | 不参与 | 隔离 runtime 不发面板事件，且后端结构上拒绝跨 vault 派发 |
| 点击发起的 cron 运行 | 按普通轮次 | 发起前已切到目标 vault，只影响标题栏钮 |
| 后台子代理完成通知（`notice`） | 不单独算 | 若触发自动唤醒回合，未读由该回合终态承担 |
| 自动唤醒回合（`auto_turn_started` → 终态） | 算（若在后台发生） | 与用户回合在「有没有新内容要看」上等价 |
| 同步发送被拒（`harness_busy` / 缺配置 / 图片闸） | 不算 | 这一轮根本没起来；乐观记录按发送前状态回滚 |

### 5. 未读不跨重启 / webview 重载回放（在途按快照恢复）

记录是纯内存，未读水位 MUST NOT 持久化：应用重启后所有 vault 从空闲开始，webview 重载后也不回放旧未读。
两者不能合并成同一语义——webview 重载不会杀掉 Rust 后端仍在跑的轮次：

- **app 重启**：后端会话与轮次都结束，全部从空闲起算。
- **webview 重载**：当前 vault 的真实在途仍由进入快照的 `in_flight` 恢复（既有合同，MUST NOT 呈假空闲）；
  非当前 vault 没有快照，重载后其相位 / 未读暂时未知，直到该 vault 的后续事件到达或用户切回它读快照。
- 不做「退出前没看到」的持久化（per-session 已读水位、schema、清理规则、陈旧标记噪声都不在本版范围）。


### 6. 规格与验收回扫

- `harness` 的「面板收起与跨 vault 的活动在场」用 **MODIFIED** 整块替换（整条复制现行正文再改），把
  「只呈现当前 vault」「切换 vault 复位未读」「跨 vault 完成的未读不在范围内」三条改准。
- `vault-workspace` 用 **ADDED** 新增「vault 列表行的活动状态」。
- 回扫 `scripts/acceptance/scenarios/253-harness-vault-activity.md`：它的第三步把「完成后往返 ⇒ 不伪造
  未读」写成正向断言，本 change 落地后必须改准，否则场景必红且看起来像产品缺陷。
- 新增真机场景（编号由套件在实现时分配，不预占 273）与结构视觉场景（不新增整页像素基线）。

## Non-goals

- 不做数字计数、常驻角标、树头部 / 入口角标、动画、toast、系统通知、Dock 徽标、菜单栏图标。
- 不自动切换 vault、不自动展开面板、不抢焦点、不新增全局键位、不做未读列表 / 通知中心。
- 不持久化未读水位，不跨应用重启 / webview 重载回放。
- 不保留通用 `retain` / 注册表原 `path` 清理：无行可显示的内存记录最多留到重载，MUST NOT 产生可见标记。
- 不为 `notice` 单独点亮；不把审批等待单列一档；不让无人值守 cron 参与。
- 不改后端事件协议或 `harness_state` 快照；不新增 Rust 命令或用例。
- 不在本 change 规范化注册表路径、不改列表身份；旧拼写查不到记录时按无记录处理（fail-closed）。
- 不更新视觉基线（如确需 `--update`，是 Alex 人肉裁决点）。

## 节点 1 裁决点（D1–D6，2026-11-23 全部按推荐值批准）

D1 与 D2 是真正的产品语义取舍；D3–D6 是防噪声边界。六项均已按推荐值生效，下表保留另一选项的
代价备查。

| # | 裁决点 | 裁决结果（按推荐值生效） | 备选 / 代价（未采纳） |
|---|---|---|---|
| **D1** | **已读时点**：切到该 vault 就算看过，还是 transcript 真的在屏幕上 | **后者**（严格）：切过去但面板收起，标记不清，转为标题栏钮；打开面板（或目标布局里面板随在场）才清 | 前者实现最省，但会把「切过去看一眼文件树」误当看过，与「打开面板即已读」的既有口径不一致 |
| **D2** | 非当前 vault 是否显示**在途** | **显示**：三态（在途 / 未读回复 / 未读失败）与标题栏钮同源；两档退路不再适用 | 只显示未读两档：审批阻塞与「切过去撞 busy」继续无信号；实现量少约三分之一 |
| **D3** | 是否跨重启保留未读 | **不保留** | 保留需 per-session 已读水位 + 清理规则，并会制造陈旧标记噪声 |
| **D4** | 当前 vault 行是否显示标记 | **完全不显示**（标题栏钮承载） | 双承载会让同一状态在两处出现，正是「常驻角标噪声」的入口 |
| **D5** | 审批等待是否单独一档 | **不单独**，归「在途」 | 单独一档会引入第四种清算语义（看过 ≠ 处置完），且当前 vault 的钮没有这一档，两个承载体分叉 |
| **D6** | 后台子代理完成但**无唤醒**（只有 `notice`）是否点亮 | **不点亮**（沿用既有条款） | 点亮会让每次后台委派完成都亮一行，噪声显著 |

另有一条实现期边界随本提案一并获批（2026-11-23，未单列裁决点）：**切换窗口内到达的终态按
「不在屏幕上」保守记未读**。理由：`applyVault` 在 `harnessPanel.vaultChanged`（`src/main.ts:4094`）
之后才经 `onVaultLoaded` 的 `getSession` await 走到 `applyStoredLayout`（`src/main.ts:776-807`）；
若按切换瞬间的 DOM 判定，会先误清算再关面板，信号静默丢失。宁可多一枚标记（随后由在场信号校正），
不静默丢失。

## Impact

- 影响的 specs：
  - `harness`：MODIFIED「面板收起与跨 vault 的活动在场」。
  - `vault-workspace`：ADDED「vault 列表行的活动状态」。
- 影响的代码 / 系统：前端 activity reducer 与 store（`src/harness-activity.ts`）、面板事件接线与显示门
  （`src/harness-panel.ts`）、装配层 `applyVault` / `applyStoredLayout` / cron 通知点击（`src/main.ts`）、
  vault 切换器行渲染（`src/vault-switcher.ts`）、行标记样式（`src/harness-panel.css` / `src/style.css`）。
  不涉及 Rust 生产代码。
- 关联约束：
  - ADR 0002 第 6 条性能合同：活动只在轮次生命周期事件上更新，不进入按键路径、不新增定时器、
    per-chunk 零新增工作。
  - ADR 0004：节点 1 已通过（2026-11-23），实现按本 change 的 tasks 推进；节点 2 仍按五要件放行。
  - 仓库信息卫生：所有测试 fixture、视觉场景与截图只用合成 vault 名 / 路径。
- 先例与边界：上一个 change 的 D3 把跨 vault 未读列为非目标；本 change 是对该取舍的**显式修订**，不是
  静默扩 scope——两份 delta 与场景 253 的回扫就是这次修订的留痕。

## 与 ADR 的关系

不需要 ADR：不改技术选型、不改分层，只新增一条前端行为与一条行级呈现；跨两个 capability 的行为变更由
单个 OpenSpec change 承载（先例：`add-harness-vault-workspace-list` 同时改 `harness` 与
`harness-subagents`）。
