# Design: surface-cron-notify-failure

> 起草注记：本文件只写**怎么做**与**为什么这样而不是那样**。行为口径以
> [specs/cron/spec.md](specs/cron/spec.md) 为准；用户可见文案以 `文案-Copy.md` 的 D551–D554 为准。

## 1. 现状与成因（M636 定论摘要）

链路（现状）：

1. 守护线程启动 / 任务集重载时调 `ensure_notification_permission`
   （`src-tauri/src/lib.rs`）→ `notify_rust::request_auth_blocking()`；
2. `Ok(false)` 只落一条 `config_warning`「通知权限被拒绝…」；
3. 到点 `deliver_notification` 投递 → 失败只落 `config_warning`，不写 `last_fired`，
   下一次评估（30s tick）重试；UI 完全无感。

成因（2026-10-23 调查，`.tower/comms` 的 M636 报告面）：macOS 26 的 usernotificationsd 按
**调用进程的代码签名身份**判定资格。安装包只有 linker ad-hoc 签名（Info.plist 未绑定、
TeamIdentifier 为空）时系统认不到该 bundle id，`requestAuthorization` 与
`addNotificationRequest` 一律被拒；系统设置里「Lumir」的条目属于另一个签过名的身份（探针 /
验收副本），与正在跑的二进制无关。此时 `authorizationStatus` 是 `NotDetermined`——**不是**
`Denied`。

因此「用户拒绝」与「系统不认这个身份」是两件事，用户可见文案必须分开。

## 2. 判据单一化：一次申请，两处消费

**唯一申请点**：`ensure_notification_permission`（原有位置与时机不变：有有效任务时一次、
重载补检）。结果写进进程级 `OnceLock<NotifyPermission>`。

**注册路径不申请**。`CronToolPort::create` 需要的权限读数经**重载回执**回流：
`cron::ReloadOutcome` 增加 `notify_permission` 字段，`CronRunner::apply_reload` 在补检后填它。
`CronToolPort::reload_effect` 把三元组 `(effect, seeded, notify_permission)` 交给 `create`。

为什么不直接在工具路径调一次 `request_auth_blocking`：

- 「未决定」时它会弹系统对话框并阻塞调用线程——工具跑在回合线程上，用户不在场时这次工具调用
  会一直挂着；而守护线程上弹窗是可接受的（它本来就在启动时做同一件事）。
- 两处申请 = 两处判据，正是 REVIEW.md「同一语义两处真源」的形态。

回执丢失（1s 超时 / 线程不在 / 配置重读失败）时 `notify_permission = Unknown`：注册回执因此
**不声称**任何结论，诊断面仍有既有的「重载未确认」warning。

## 3. 两档成因的判定

`request_auth_blocking()` 之后读一次 `notify_rust::get_notification_settings_blocking()`
（`mac-usernotifications` 0.3.1 的设置查询，无对话框；`preview-macos-un` 已启用，
`blocking-wrappers` 是该 crate 的默认 feature）：

| 申请结果 | `authorization_status` | 判据 |
|---|---|---|
| `Ok(true)` | — | `Granted` |
| `Ok(false)` | `NotDetermined` | `Unrecognized`（系统里没有本客户端的授权记录） |
| `Ok(false)` | `Denied` | `Denied` |
| `Ok(false)` | 其它（两头矛盾） | `Denied`（送不出去，不编原因） |
| `Ok(false)` | 查询失败 | `Denied` + 一条 warning（不排除用户拒绝） |
| `Err(_)` | — | `Unknown`（无法判定） |

dev flavour 与非 macOS 恒为 `Granted`（dev 走 legacy 投递、非 macOS 无查询 API）——与既有行为
一致，不新增拦截。

`Ok(false)` + `NotDetermined` 判为「身份未被认可」的依据是 M636 的机制结论：系统若不认这个
客户端，`requestAuthorization` 的应答不会落在授权记录里，状态停在 `NotDetermined`；而用户真正
点过「不允许」的状态是 `Denied`。

## 4. 注册告知的载荷与转达

`cron_task_create` 回执增加一个可选字段：

```json
{ "ok": true, "task": {…}, "effect": "active", "skip_today": false,
  "notice": "系统未认可当前 Lumir 的通知身份（安装包缺少有效签名），通知无法送达。这条任务到点不会有提醒" }
```

- 判别点在 `cron::registration_notice(delivery, permission, language)`（纯函数）：只有
  `notify-then-run` 且判据为「送不出去」才出句。
- 文案在 `cron::notify_permission_notice`（Rust 侧持有，按注册那一刻的界面语言取列）。这是
  D321 同款的**第二处**「后端持有文案」落点，理由写进 deck 设计意图列：回执由模型读、句子要
  逐字转达，不能由前端渲染（前端根本看不见工具回执）。
- 转达义务在 `cron-reference.md`：回执带 `notice` 就原样转达，MUST NOT 省略或改写成「可能会提醒」。

`run-then-notify` 与 `silent-run` 不出句：前者运行照常发生、通知发不出去由连续失败提示收口；
后者本来就不发通知。注册时先报一条会让同一件事说两遍。

## 5. 连续失败的可见提示

`cron::NotifyFailureStreak`（纯状态，无上屏动作）：

- `record_failure()` 自增并返回 `Some(count)` **仅当**「已达阈值且本段尚未上屏」；
- `record_success()` 清零并复位上屏标记。

阈值 `NOTIFY_FAILURE_NOTICE_AFTER = 3`：`notify-then-run` 的投递失败按 30s tick 重试，3 次 ≈
1.5 分钟——足以排除一次抖动，又不至于让用户等到下次交互才发现提醒没来。计数是**全进程**的，
不分任务：成因是应用级的（身份 / 权限），按任务各记一份只会让同一件事报若干遍。

上屏走既有 `cron:notice` 通道，载荷 `{ code, params: { count } }`；`code` 按**已探测的**权限快照
分档（`cron::delivery_failed_code`）：

| 快照 | code | 文案 |
|---|---|---|
| `Unrecognized` | `cron_notify_delivery_failed_identity` | D553（点名签名成因，不把「去系统设置」当唯一出路） |
| 其它 / 未探测 | `cron_notify_delivery_failed` | D554（通用：检查系统设置里的权限） |

用快照而不是失败错误串判成因：错误串来自第三方 crate（`mac-notification-sys`），措辞随版本漂移
（REVIEW.md「同一语义两处真源」条：不把判断建立在另一个模块的字符串字面上）。

既有 5 处 `cron:notice` 直传中文串的调用点不动（i18n 收尾是独立治理）；`cron:notice` 的两种
载荷形态由前端一个取值口 `cronNoticeText` 统一处理：有 `code` 走文案表，否则回落 `message`。

## 6. 文案落地

| 编号 | 消费者 | 形态 |
|---|---|---|
| D551 | Rust `notify_permission_notice`（`Unrecognized`） | 进 `cron_task_create` 回执，模型转达 |
| D552 | Rust `notify_permission_notice`（`Denied`） | 同上 |
| D553 | 前端 `CRON_NOTICE_COPY`（identity code） | toast |
| D554 | 前端 `CRON_NOTICE_COPY`（通用 code） | toast |

`src/copy-data.ts` 里四条都要有（漂移门禁要求 deck ↔ 表一一对应）；D551 / D552 前端不取值，
注释与 deck 设计意图列互相指明（与 D321 同形态）。编号在 rebase 到含 M631 的 master 时顺延：
M631 先占了 D548–D550（左栏 ⌘B / 分隔条读屏名 / 宽度写盘失败），本 change 的四个条目取 D551–D554。

## 7. 验证与已知边界

- 判别点全部落在纯函数上，由 Rust 单测覆盖：`registration_notice` 的档位矩阵、
  `notify_permission_notice` 两档措辞（拒绝档含「系统设置」引导、身份档**不含**）、
  `delivery_failed_code` 分档、`NotifyFailureStreak` 的阈值与「一段只提示一次」、
  `cron_task_create` 回执的 `notice` 在场 / 缺席。
- 文案层由既有漂移门禁（`tests/unit/copy.test.ts`）覆盖：deck 与 `src/copy-data.ts` 逐字对齐，
  占位名按位置归一。
- **真机边界**：验收副本（`com.lumir.app.acceptance`）的签名身份被系统认可，「身份未被认可」这
  一支无法在验收副本上复现（权限被拒态同理）。本 change 对这两支只做静态校验（`cargo test` +
  `openspec validate`），真机验收只覆盖「注册成功、回执字段缺席」的正常路径。要真验身份档，得用
  一份 ad-hoc 签名的安装包跑——那是产品侧签名问题的验证现场，不属本 change。

## 8. 被拒的替代方案

- **注册时直接再申请一次授权**：会把用户应答时序绑到一条工具调用上（见 §2），且构成第二处判据。
- **用失败错误串判成因**（匹配「rejected the notification request」）：字符串判据跨 crate 版本
  漂移，且同一串可能对应多种失败。
- **只改文案不去分档**（统一说「通知不可用，请检查系统设置」）：本次现场照做无效——设置里开着。
- **把 `notice` 做成前端 toast 而不是回执字段**：toast 会消失，而「到点不会有提醒」是任务属性，
  必须在会话里留下可回看的句子。
