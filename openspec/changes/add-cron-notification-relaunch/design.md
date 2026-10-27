# Design: 常驻通知 delegate 与「退出后点击」恢复

> 本文件只写**实现取向与判定口径**，不写逐行实现。所有引用行号以本 change 起草时的 master 为准
> （2026-10-28）。

## 1. 事实基线

### 1.1 现状链路（读代码，非推测）

| 环节 | 位置 | 现行行为 |
|---|---|---|
| 投递 | `src-tauri/src/lib.rs:1862` `deliver_notification` | macOS 打包实例走 `notify_rust::Notification::show()`，随后用 `get_delivered_notification_ids` 自查系统是否收下；dev flavour 走 legacy 投递 |
| 点击等待 | `src-tauri/src/lib.rs:2011` `spawn_notification_click_waiter` | 每条通知投递成功后起一个线程跑 `handle.wait_for_response(cb)`，回调里投 `CronMessage::Click` 给守护线程 |
| 点击处置 | `src-tauri/src/lib.rs:1593` `handle_click` | 校验任务在场 → 聚焦窗口 → 前端接线层未就绪则 `not_ready` 退回 → 按触达策略发起运行 / 恢复会话；同日重复点击只打开已有会话 |
| 守护线程 | `src-tauri/src/lib.rs:1183` `start_cron` / `:1201` `cron_loop` | `setup` 内起线程，自己装载配置与 `cron-state.json`，随后 `poke(Startup)` |
| 前端接线 | `src/main.ts:3163` `installCronBridge` | 四条监听装好后 `invoke("cron_bridge_ready")`；Rust 侧 `mark_bridge_ready`（`lib.rs:999`）置位并补一次启动触发 |
| 切换 vault 的 dirty 门 | `src/main.ts:3091` `ensureCronVault` / `:3779` `guardVaultSwitch` | 目标 vault ≠ 当前时走 `switchToVault`；dirty 时由既有闸给出三出口（保存并切换 / 放弃并切换 / 取消），未被继续则 `ensureCronVault` 抛 `vault_not_open` |

### 1.2 依赖库的硬约束（`mac-usernotifications 0.3.1`，本仓 `Cargo.toml` 钉死）

- 响应映射是**进程内**的私有表：`delegate.rs:34-39` 的 `HashMap<request_id, oneshot::Sender>`；
  查不到时只 `log::debug!` 然后丢弃（`delegate.rs:113-131`）。
- 注册与安装都是 `pub(crate)`：`register_response_sender`（`delegate.rs:41`）、`install`
  （`delegate.rs:145-153`）。**外部无法补挂「无主响应」的接收者**。
- delegate 是**懒装**的：`worker.rs:14-33` 在首次 `dispatch` 时才起 worker 线程并调用
  `install()`；而 `install()` 用 `OnceLock` 保证进程内只执行一次，执行方式是
  `center.setDelegate(...)`——**覆盖式**。
- `notify-rust 4.18.2` 的 `NotificationHandle::wait_for_response`
  （`src/macos/unusernotifications.rs:139`）消费的正是上述私有通道：一旦 delegate 被换掉，它
  永远不会 resolve。
- delegate 属性本身是 `weak`（Apple 文档声明 `weak var delegate`）——**谁装谁负责保活**。

### 1.3 平台合同（Apple 官方原文）

- 「To guarantee that your app responds to all actionable notifications, you must set the value of
  this property before your app finishes launching.」
  （[UNUserNotificationCenter.delegate](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/delegate)）
- 「When the user selects an action, the system launches your app in the background and calls the
  delegate’s … method.」
  （[Handling notifications and notification-related actions](https://developer.apple.com/documentation/usernotifications/handling-notifications-and-notification-related-actions)）

即：**「应用被拉起」是系统侧已经完成的动作，丢的是我们这一侧没有接收方**。合同必须保证「拉起之后
一定有人接」。

### 1.4 启动时序（为什么「在 setup 里装」够早）

`src-tauri/src/lib.rs:77` `run()` → `tauri::Builder::…build().run()`；tao 的
`app_delegate.rs:124-128` 在 `applicationDidFinishLaunching` 里同步调用 `AppState::launched`，
Tauri 的 `.setup(...)`（`lib.rs:212`）就在这条链上执行。因此 setup 内完成的安装**落在 Apple
要求的「完成启动之前」**。安装点仍按「越早越好」取 `run()` 入口（在窗口创建与 `setup` 之前），
判据是「delegate 已装」而不是「setup 已跑」；两者的差异在实现期用真机探针复核（§8.2）。

## 2. 方案选择：谁持有 delegate

| 方案 | 做法 | 判定 |
|---|---|---|
| **A（采用）本仓自持 macOS 通知平台层** | 新增窄模块，自己实现 delegate（安装 + 保活 + `willPresent` + 响应路由）、投递（`addNotificationRequest`）、投递后自查（`getDeliveredNotificationIds`）与授权查询；`notify-rust` 只承担 Linux / Windows | **采用**：单一所有者，无「谁最后装谁生效」的时序赌博；响应路由与点击处置只有一条路 |
| B 保留 `notify-rust` 投递 + 抢回 delegate | 启动主线程先做一次不弹窗的 `getNotificationSettings`（强制依赖库完成它的一次性安装），随后 `setDelegate` 装本仓 delegate | 否决：依赖依赖库的私有实现时序（`OnceLock` + worker 启动即装），升级即静默失效；且在启动路径上引入一次跨进程往返（冷启动合同） |
| C vendor / patch `mac-usernotifications` | `[patch.crates-io]` 本地副本，暴露 `install` 与全局响应钩子 | 否决：把一个约 2000 行的上游副本搬进仓并长期跟踪；收益只是省下 A 的 delegate 代码 |

**A 的代价与边界**：新增一处 `unsafe` objc2 面（估计 250–400 行，集中在
`src-tauri/src/notify/` 一个模块内，对外只暴露安全接口）。依赖面：`objc2` /
`objc2-user-notifications` / `objc2-foundation` / `block2` 升为直接依赖——四者都已在
`Cargo.lock` 里（`objc2` / `objc2-foundation` / `block2` 经 tauri 与 `mac-usernotifications`，
`objc2-user-notifications` 0.3.2 经 `mac-usernotifications` 与 `objc2-ui-kit`），**不引入任何新
版本**；删掉的 `mac-usernotifications 0.3.1` 与升为直接的 `objc2-user-notifications 0.3.2` 大致
等重。同时按「变更默认直接切断」：`notify-rust` 的 `preview-macos-un` feature 与
`mac-usernotifications` 直接依赖在本 change 内删除（macOS 上不再有调用点，留着就是假开关）；
`mac-notification-sys` 保留（dev flavour 的 legacy 投递仍在用）。

**M620 的既有语义必须原样保留**：投递成功判据 = 系统确认（自查 `getDeliveredNotificationIds`），
启动窗口内的本地早退重试、同 id 重投、失败不写 `last_fired`——这些是合同（`cron` living spec
「三档触达策略」与「通知送不出去时的注册告知」），A 只是换实现，不改语义。

## 3. 启动期 delegate

**必须做**：

1. macOS 打包实例（`!tauri::is_dev()` 且进程有 bundle id）在 `run()` 入口安装 delegate，并在
   `static` 里持有**强引用**直到进程退出（属性是 `weak`）。
2. `willPresent` 返回 `.banner | .sound`——保持「应用在前台也照常上屏」的现状。
3. `didReceive` 只做三件极轻的事：取 `request id` 与 `actionIdentifier`；立刻调用完成处理器
   （不让系统等）；把 `(request_id, action)` 推进一次性缓冲并尝试唤醒守护线程。

**必须不做**：

- MUST NOT 在启动路径上做跨进程查询或读写配置 / vault（冷启动 <300ms，ADR 0002 第 6 条）。
- MUST NOT 在 delegate 回调里做 IO、聚焦窗口或 `emit`——回调在主线程 run loop 上。
- MUST NOT 在 dev flavour 调用 UN（无 bundle 身份会 `abort`，M608 现场）。

**降级**：安装失败（无 bundle / 系统拒绝）只落一条 warning，不影响启动与投递；此时跨进程点击
不可用，进程内点击照旧（非 macOS 通道）。

## 4. 通知台账（识别与校验的唯一依据）

**落点**：`cron-state.json` 的同一份存档里新增 `notices` 段——不另开第二个文件（另开就要复制
一遍唯一写者 / 原子替换 / 读取纪律的合同）。

```jsonc
{
  "version": 1,
  "tasks": { /* 既有：last_fired / session_id */ },
  "notices": {
    "<request_id>": {
      "task": "<任务 id>",
      "kind": "trigger" | "result" | "failure",
      "date": "YYYY-MM-DD",                 // 派发的本地日期
      "session_id": "<可选，结果通知在场>"   // 供 run-then-notify 的会话恢复
    }
  }
}
```

**写入时机**：投递被系统确认之后，与 `last_fired` 的写入**同一次落盘**（`mark_fired` 的调用点
已在那条路径上）。写失败降级为 warning（投递仍然成立），该条通知随后按「台账查不到」被拒绝——
这是可接受的降级方向：宁可拒绝一次点击，也不按猜测执行。

**有界**：每次写入时裁掉「派发日期早于今天 − 7 天」的条目，并保留最多 32 条（超出按
`date` + `request_id` 排序丢最旧）。裁剪 MUST NOT 触碰 `tasks` 段。

**request id 形状不变**（`lumir-cron-{task}-{kind}-{millis}`）：它只作为台账的键与
`usernoted` 日志里的可读线索，**不再被解析**——任务 id 允许含 `-`，按字符串形状切分是不可靠的
真源。

**读取纪律**：与去重状态相同（缺失 / 不可读 / 非法 JSON / 版本不符 ⇒ 一律「无台账」）。`notices`
用 `#[serde(default)]`，旧文件读进来就是空台账；**不做迁移**（零外部消费者，见 AGENTS.md
「变更默认直接切断」）。

## 5. 无主响应恢复流水线

```
delegate(didReceive)            ← 主线程 run loop，可能发生在 setup 之前
   │  (request_id, action) 入缓冲（有界，先到先处理）
   ▼
守护线程装载完成（配置 + 状态 + 台账）
   │  drain 缓冲：按到达顺序处理
   ▼
校验（§5.1）——全部纯函数，单测覆盖
   ├─ 拒绝 → cron_click(ok=false, error=<码>) + 视情形人话提示；结束
   └─ 接受 → 与进程内点击**同一段**处置（handle_click 的既有分支）
               │
               ├─ 前端接线层未就绪 → 保留（不进 clicked_today），就绪后重放
               └─ 就绪 → 聚焦窗口 / 打开目标 vault / 发起运行或恢复会话
```

**为什么先缓冲**：响应只有一次投递机会。delegate 可能在 `setup` 之前（系统拉起时立刻回调）或
守护线程装载完成之前到达，此时既没有 `CronRuntime` 也没有任务集——直接丢弃就是本次要修的那个 bug
的翻版。缓冲是**进程内**的，不落盘：进程不在了就没有「待处理点击」，这是运行时机制的定义。

**与进程内点击的合流**：接受后的处置 MUST 复用 `handle_click` 的实现（聚焦 → vault → 运行 /
会话），不写第二套。差异只在两个入口参数：来源（`source`）与「未就绪时保留还是退回」。

### 5.1 接收判据（全部满足才算「被接受的点击」）

| # | 判据 | 不满足时 |
|---|---|---|
| 1 | `actionIdentifier` 是通知本体（`tap`） | 忽略（非 tap 动作照旧落 warning，不进处置） |
| 2 | `request_id` 在台账里 | `cron_click(ok=false, error=notice_unknown)`，无提示 |
| 3 | 台账里的任务仍在当前任务集里 | `cron_click(ok=false, error=task_unknown)` + 人话提示 |
| 4 | 台账的 `date` 等于今天（本地日期） | `cron_click(ok=false, error=notice_stale)` + 人话提示 |

判据 2、3、4 是**独立**的：台账裁剪掉的旧通知走 2，任务删除走 3，跨天走 4——三者的用户提示
不同，诊断码也不同（不合并成一类「失败」）。

### 5.2 落地语义（与 spec 场景一一对应）

| 情形 | 行为 | 诊断 | 用户可见 |
|---|---|---|---|
| 正常恢复（`notify-then-run`） | 聚焦窗口 → 打开目标 vault → 交互槽位发起运行 | `cron_click(ok=true, action=run, source=relaunch)` + `cron_run_started(trigger=click)` + `cron_run_finished` | 面板出现 prompt 并在同会话跑完 |
| 正常恢复（`run-then-notify` 结果通知） | 聚焦窗口 → 打开目标 vault → 恢复台账里的会话 | `cron_click(ok=true, action=open-session, source=relaunch)` | 会话被恢复，不重跑 |
| 台账外 request id | 拒绝 | `notice_unknown` | 无提示（不打扰；旧版本遗留通知属正常噪声） |
| 任务已删除 | 拒绝 | `task_unknown` | 一句「这条提醒对应的任务已被删除」 |
| 跨天 | 拒绝 | `notice_stale` | 一句「这条提醒已过期，今天到点会再提醒」 |
| 重复点击同一条 | 走既有同日幂等分支：只聚焦 + 打开已有会话 | `cron_click(ok=true, action=run, source=relaunch)` | 窗口聚焦、会话打开，不产生第二次模型请求 |
| 同一任务两条通知并发 | 至多一次运行（`clicked_today` + 在途表）；后到者只聚焦 | 同上 | 同上 |
| 界面未就绪 | **保留**该次点击，`bridge_ready` 后重放 | `cron_click_deferred{task, source, reason: not_ready}`；真正放弃（保留被同任务新点击覆盖、或进程退出）时补一条 `cron_click(ok=false, error=not_ready)` | 无（用户已经看到窗口） |
| dirty vault（目标 vault ≠ 当前且有未保存修改） | 走**既有** dirty 前置门（三出口）；未被继续时这次运行不落地，点击本身已被接受 | `cron_click(ok=true, action=run, source=relaunch)` + 运行未落地的回执 `cron_run_finished(ok=false, error=vault_not_open)` | 既有的脏标签守卫浮条 + 一条提示 |
| 运行失败 | 走既有终态路径，不自动重跑 | `cron_run_finished(ok=false)` | 面板上的失败态 + 提示一次 |
| 台账写失败 | 投递照常、`last_fired` 照写、warning | 投递路径 `config_warning` | 无（到点通知仍在） |

**为什么保留 / 放弃要单独一个事件**：`cron_click` 的 `ok` 是「这次点击有没有落地」的终局判据，
不能同时承载「收到了、还在等界面」。`cron_click_deferred` 与 `cron_click` 共用 `task` 与
`source` 两个字段，只多一个闭集合 `reason`——两个事件合起来才能把「点了没反应」在日志里区分成
「没收到 / 收到了在等 / 收到了但失败」。

## 6. 状态与并发

- `clicked_today`（既有）继续是「同日已跑过」的唯一内存判据；恢复的点击与进程内点击**共用**它，
  因此重复 / 并发点击天然幂等。
- `session_started_today`（既有，`lib.rs:2178`）继续兜底「进程重启后 `clicked_today` 丢失」的
  场景——本次的恢复点击正好落在这条兜底上：台账 `session_id` 若是今天的会话，则只打开、不重跑。
- 在途表 `inflight` 继续是「同一任务同一时刻至多一个运行」的判据；恢复点击也登记进去，终态照旧
  走 `finish`。
- **保留中的点击**（界面未就绪）最多 4 条（不同任务各一条，同任务后到者覆盖前者）；超出丢最旧并落
  warning。进程退出即丢弃（进程内缓冲，不落盘）。

## 7. 平台与 flavour 边界

| 环境 | 投递 | 点击接收 | 跨进程恢复 |
|---|---|---|---|
| macOS 打包实例 | 本仓 UN 实现 | 本仓 delegate | **支持**（本 change 的合同） |
| macOS dev flavour（`!custom-protocol`） | legacy（`mac-notification-sys`） | 不可达（响应路由给 Terminal，M608 已知边界） | 不声称 |
| Linux / Windows | `notify-rust` 平台后端 | 逐条 `wait_for_response` | 不声称 |

**MUST NOT 把「跨进程恢复」写成跨平台承诺**：其它平台的逐条等待照旧，诊断里 `source` 恒为进程内。

## 8. 可判定性

### 8.1 单测（纯函数，无 tauri 依赖）

- 台账的写入 / 裁剪 / 读取降级（复用 `cron.rs` 既有 `CronState` 测试风格）。
- 接收判据的四条判据逐条真值表（含「任务 id 含 `-` 也不影响识别」的用例——因为不解析 request id）。
- 恢复点击与进程内点击的合流参数（来源 / 保留 vs 退回）。
- 诊断字段白名单（`cron_click` 新增 `source`、新增 `cron_click_deferred` 后，日志字段表与测试同步）。

### 8.2 真机（bundle 场景，新增 `scripts/acceptance/scenarios/252-cron-click-after-exit.md`）

场景骨架：`notify-then-run` 任务 `$nextMinute` → 等横幅 → 等 `cron_notified` 落盘 → **正常退出
应用** → 点横幅（系统拉起应用）→ 断言新进程的日志与界面。

**判据（每条都要 PASS，不拿「进程起来了」当点击成立）**：

1. 新进程日志里 `cron_click{source: relaunch, ok: true, action: run}` 恰好一条；
2. `cron_run_started{trigger: click}` 与 `cron_run_finished{ok: true}` 各一条；
3. 目标 vault 被打开（面板可见任务 prompt），会话 JSONL 落在该 vault 的 per-vault 目录；
4. 负向控制：从「只启动应用、不点通知」的那一轮里，`cron_click` 与 `cron_run_started` 都为 0
   ——这条是「不把系统拉起当成点击已接受」的机器判据；
5. 第二次点击同一条通知：`cron_click` 增加一条但 `cron_run_started` 仍为 1；
6. 删除任务后再点旧通知：`cron_click{error: task_unknown}`，`cron_run_started` 不增加；
7. 跨天：把台账里那条的 `date` 改成昨天（套件直接改 `cron-state.json` 的 fixture 手段）后点击：
   `cron_click{error: notice_stale}`，不运行。

**验收隔离的关键约束（必须先在实现期探针解决）**：本仓配置目录取
`XDG_CONFIG_HOME` 或 `$HOME/.config`（`src-tauri/src/config.rs:1980`）。**被系统重新拉起的进程不再
继承套件的环境变量**，因此「点击 → 拉起」的那一轮会读用户真实配置目录——这违反套件「绝不读写
用户 `~/.config/lumir`」的既有约束。两条候选（实现期按探针结果取其一，取先成立者）：

- **LSEnvironment**：验收 bundle 的 `Info.plist` 注入 `LSEnvironment.XDG_CONFIG_HOME=<套件 env>`，
  由 LaunchServices 在拉起时注入环境变量；
- **包装可执行文件**：`CFBundleExecutable` 指向一个把环境变量导出后 `exec` 真二进制的脚本。

探针判据：点击拉起后的新进程，其 `config_dir()` 解析结果落在套件 `env/` 下（用 `cron-state.json`
的 mtime 与内容变化证明写的是套件目录，而不是用户目录）。探针不成立 ⇒ 本场景**不得**上真机跑，
先把隔离方案做实；MUST NOT 用「先备份用户配置目录」这类会碰真实数据的手段绕过。

### 8.3 「系统拉起 ≠ 点击已接受」的判据链

`source=relaunch` 的 `cron_click` 只由「delegate 收到响应 + 台账校验通过 + 进入处置」这一条路径
产出；单纯启动进程不经过该路径。因此负向控制（§8.2 第 4 条）与正向断言一起构成本 change 的核心
判据——缺任一条，测出来的就只是「app 能被拉起」。

## 9. 风险

| 风险 | 影响 | 处置 |
|---|---|---|
| 新 `unsafe` objc2 面写错 | 崩溃 / 静默丢响应 | 集中在单模块、对外只暴露安全接口；真机场景是最终判据；安装失败只降级不 panic |
| delegate 安装早于 `NSApplicationMain` 的兼容性 | 响应收不到 | 实现期真机探针（先 `run()` 入口，再 `setup` 起点），以「点击拉起后能收到回调」为判据 |
| 冷启动预算 | <300ms 合同 | 安装路径零 IO、零 XPC；用既有 perf 读数核对 |
| 依赖库升级 / 回退 | A 不依赖其内部时序，风险面缩小到「我们自己写的实现」 | `notify-rust` 仅剩 Linux / Windows，`preview-macos-un` 在本 change 内删除 |
| 验收环境读真实配置 | 违反套件隔离红线 | §8.2 的探针先行；不成立则场景不上真机 |
| 通知仍留在通知中心被反复点击 | 重复运行 | `clicked_today` + `session_started_today` + 在途表三重判据；跨天按 §5.1 拒绝 |

## 10. 不做（与 proposal 的 Non-goals 对应）

- 不做「应用启动即补跑错过的触发」（C 方案）。
- 不做通知分组 / 动作按钮 / 点击后清除通知。
- 不改通知文案、权限流程、连续失败提示。
- 不为其它平台承诺跨进程恢复。
