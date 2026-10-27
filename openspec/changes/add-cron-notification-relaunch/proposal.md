# Proposal: 支持「应用退出后点击通知」——常驻通知 delegate + 通知台账 + 无主响应恢复

- Change ID: add-cron-notification-relaunch
- 日期: 2026-10-28
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> **裁决留痕（2026-10-28，Alex 逐字）**
>
> 「理解了，那我对『进程退出后点击旧通知的诊断』没有异议，请你安排处理。」
>
> 该句话在三条候选里的落法：**A 支持进程退出后的旧通知点击**已被选定；**C 改成到点静默运行**
> 明确不选；**B 放弃跨进程点击**不作方向。本 change 只做 A，触点不改触达策略本身
> （`notify-then-run` 仍是「到点先通知、点击才运行」）。
>
> **诊断依据**：`.local/reports/m752-cron-click-diagnosis.md`（M752 现场读数 + crate 源码机制）。

## Why

**事故形态**：`notify-then-run` 任务到点投递了「到点」通知，用户在应用**已退出**后点它——系统把
应用拉起来了，但没有任何运行发生。诊断报告的读数（非敏感字段）：2026-10-27 投递
`cron_notified{kind: trigger}` 之后，点击时所在的进程日志里**零 `cron_click` 行**，而 08:51 有一次
新进程启动；对照 2026-10-26 同一任务（投递与点击都落在同一进程内）链路完整
（`cron_click → cron_run_started → cron_run_finished`）。用户可见的后果是「点了通知，只弹出一个空
窗口」。

**机制成因（读源码坐实，非推测）**：

- 点击响应按 request id 查一张**进程内**映射（`mac-usernotifications 0.3.1` 的
  `delegate.rs`：`HashMap<request_id, oneshot::Sender>`），查不到只打一条 debug 日志然后丢弃——
  响应通道的生命周期就是进程生命周期。
- 该映射与 delegate 的安装都是**库内私有**（`register_response_sender` / `install` 均为
  `pub(crate)`），外部无法补挂「无主响应」的接收者；delegate 本身还只在首次 UN 调用时**懒装**。
- 平台合同：Apple 要求 delegate 在应用**完成启动之前**设好，否则「导致应用被启动的通知」响应会
  丢；用户点击动作时系统会**在后台拉起应用并调用 delegate**（[UNUserNotificationCenter.delegate](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/delegate)、
  [Handling notifications and notification-related actions](https://developer.apple.com/documentation/usernotifications/handling-notifications-and-notification-related-actions)）。
  换句话说：系统已经按预期把我们拉起来了，**丢的是我们这一侧没有接收方**。

**合同缺口**：living spec 的「通知的投递与点击唤起」只写到「点击等待随每条通知在投递成功后登记」
——这条口径把「逐条一次性等待」写成了唯一接收通道，于是进程退出后的点击在合同层面**没有位置**；
去重状态也只记 `last_fired` / `session_id`，没有「这条通知是哪次派发」的可核对事实。所以修复不是
补一个 case，而是要把「点击如何被接收、如何被识别、被拒绝时说什么」写成合同。

## What Changes

逐条对应 `specs/cron/spec.md` 的增量：

1. **点击接收模型改为常驻 delegate**（MODIFIED「通知的投递与点击唤起」）：macOS 打包实例的点击由
   进程内**常驻** delegate 接收，不再把「逐条登记一次性等待」当作唯一通道；`tap` 之外的响应照旧
   防御性忽略。进程内点击与跨进程恢复的点击 MUST 走**同一段**处置实现（打开 vault、唤起窗口、
   发起运行 / 恢复会话）。
2. **通知台账**（MODIFIED「触发去重状态与持久化」）：`cron-state.json` 追加 `notices` 段——每条
   已投递通知记 `request id / 任务 / 种类 / 派发本地日期 / 会话标识`。投递端口改为返回 request id
   作为台账键；**两条写入路径各自的原子性判据不同**：到点通知与 `last_fired` 同一次落盘；结果 /
   失败通知在 `finish` 投递成功后与当时的完整状态一次落盘（该路径不写 `last_fired`，台账条目的
   会话标识必须等于同次落盘里 `tasks.<task>.session_id`）。台账是「这次点击是不是我们发的、发给
   谁」的唯一核对依据。
3. **进程退出后的点击恢复**（ADDED「进程退出后的通知点击恢复」）：启动期 delegate 收下的响应先
   落进程内缓冲（无主响应落点），由守护线程在装载完成后取走；校验通过即进入既有点击流程；
   校验不通过按分类原因拒绝并给人话反馈。
4. **七类语义写死**（同一条 ADDED 的 requirement，逐条带场景）：任务已删除、跨天、重复点击、
   并发点击、界面未就绪、dirty vault、运行失败——每条都写明「发生什么、留什么诊断、用户看到
   什么」。
5. **诊断可判**：`cron_click` 增加 `source` 字段（进程内 / 跨进程恢复），拒绝原因用闭集合小词表
   （`notice_unknown` / `notice_stale` / `task_unknown` / `not_ready` / `focus_failed` /
   `emit_failed`）；dirty vault 与运行失败按既有「运行未落地」回执
   （`cron_run_finished(error=vault_not_open)` 等）收尾，不新造点击级错误码。不记录通知正文、
   prompt、vault 路径。

## Non-goals

- **不做 C（到点静默运行）**：不引入「应用启动即补跑错过的触发」，不改三档触达策略的任何一档。
- **不改通知内容**：标题（任务 id）与正文（到点 / 已完成 / 运行失败）逐字不变，权限流程
  （申请时机、被拒措辞、连续失败提示）不变。
- **不引入系统级守护**：仍是进程内机制；MUST NOT 用 launchd / LaunchAgent / 登录项 / 系统 cron
  让应用在退出期间自己跑起来。
- **不改其它平台**：Linux / Windows 与 macOS dev flavour 维持既有的「逐条等待」通道与已知边界
  （dev 的点击响应路由给 Terminal，本就不可达）。
- **不做通知中心的额外能力**：不做通知分组、自定义动作按钮、点击后的通知清除、跨设备同步。

## 需要裁决的最小事项（附推荐默认值）

1. **跨天点击（通知是昨天派的，今天才点）**：推荐 **不运行 + 一句人话提示**（「这条提醒已过期，
   今天到点会再提醒」）。理由：去重与派发全部按「本地日期」记账，跨天补跑会与今天自己的那次
   触发叠加成两次运行；且 `last_fired` 在派发时已写，补跑会让「今天跑过没有」失去单一判据。
   备选：照跑（用户点击即意图），代价是同日可能两次运行。
2. **点击已删除任务的通知**：推荐 **落诊断 + 一句人话提示**（「这条提醒对应的任务已被删除」）。
   理由：用户刚刚主动点击，静默看起来像坏了；且现行合同「任一步失败 SHALL 给人话反馈，MUST NOT
   静默」本来就要求这样。备选：只落诊断不上屏（与现在的 `task_unknown` 行为一致）。
   本条对进程内点击同样生效——同一语义不按来源分叉。
3. **技术取向（可否决）**：macOS 打包实例的通知平台层由本仓自持（delegate、投递、授权查询、
   投递后自查），`notify-rust` 退回只承担 Linux / Windows。理由与两个被否决方案见
   [design.md](design.md) §2——核心约束是「delegate 与响应映射都在依赖库内部私有且懒装，外部补挂
   只能依赖它的内部时序」。影响面限于 cron capability 的通知实现，不改 ADR 0002 的分层，因此
   不另立 ADR。

**本 change 的 spec 增量按上面三条推荐默认值写就**：裁决取「同意默认」即无需改动；若在两条行为
裁决上取备选，改动面只在语义表的一行与对应场景的一条 THEN。

## Impact

- 影响的 specs：`cron`（两个 MODIFIED + 一个 ADDED）。
- 影响的代码/系统：`src-tauri/src` 的通知平台层（新增 macOS 实现、`deliver_notification` 与
  `spawn_notification_click_waiter` 的 macOS 分支）、`cron` 的状态存档与守护线程（台账、恢复
  流水线）、前端接线层（界面未就绪时的点击保留与重放）、`src/bindings/**`（`cron_click` 字段）。
- 验收面：新增 bundle 真机场景（投递 → 退出 → 点击拉起 → 运行全链路 + 负向控制），并回扫既有
  通知类场景（169 / 170 / 171 / 213）在新接收模型下的期望。**验收隔离按失败关闭设计**：由包装
  可执行文件在 `exec` 前导出隔离的 `XDG_CONFIG_HOME` 与 `HOME`，配任何拉起之前的静态前置门；
  拉起后的目录断言只作正向验证，不充当防线（拉起后再检查等于已经碰过真实配置）。
- 关联约束：ADR 0002 第 6 条冷启动 <300ms（delegate 安装 MUST NOT 在启动路径上做跨进程查询）；
  「不改写源文件」铁律不受影响（本 change 不碰 vault）；进程内机制、不装系统守护（cron living
  spec「运行时定时守护」）。
