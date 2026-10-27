---
id: "213-cron-startup-notification"
item: 213
tier: bundle
title: 冷启动即到点的「到点」通知必须真实出现在通知中心（M620）
# 通知投递的真实性只能在打包实例上判（dev flavour 走 com.apple.Terminal 归属，见 README「实例 flavour」）。
requires: bundle
config:
  cron:
    tasks:
      # `$pastMinute` = 应用启动那一刻任务已经到点：启动评估（Trigger::Startup）会立刻投递。
      # 这正是 M620 的现场——冷启动最初约 0.5s 内主线程 run loop 尚未进入等待，阻塞投递会被
      # 本地拒绝（MainThreadNotRunning）而请求根本没发出去；M620 前的投递封装又把这个错误吞成
      # 恒 Ok。
      - id: "acc-cron-startup"
        vault: "$vault"
        at: "$pastMinute"
        prompt: "CRON-PROBE-STARTUP 这条任务在应用冷启动的同一刻到点。"
        delivery: "notify-then-run"
        session: "new"
steps:
  # 面板打开前 NotificationCenter 的 AX 树只剩菜单栏（读不到任何条目）；冷启动投递早于场景轮询，
  # 想用 AX 判「条目在通知中心里」必须先把面板打开。
  - name: 打开通知中心面板
    do: openNotificationCenter
  - name: 冷启动后通知中心里真实存在这条「到点」条目（判据在通知中心，不在 Lumir 窗口里）
    do: waitForNotification
    title: "acc-cron-startup"
    body: "到点"
    # **fresh: false（M620）**：冷启动投递发生在套件开始轮询之前，条目已经躺在通知中心里。
    # 默认的新鲜度基线会把「动作开始时已在场」的唯一条目当旧条目挡掉（实测基线读到 1 条、
    # 等待因此永远等不到）——这一档显式接受已送达的条目。判据的区分度由下面两条日志断言兜底：
    # 日志按场景重置，`cron_notified(trigger=startup)` 只可能由本轮写出。
    fresh: false
    timeoutMs: 30000
    expect:
      - label: 到点通知真实投递（cron_notified 落盘，trigger=startup 证明走的是启动评估）
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_notified, kind: trigger, trigger: startup }
      - label: 未点击 ⇒ 没有 cron_run_started（不花 token）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started"', exact: 0 }
      - shot: 冷启动即到点的通知已出现在通知中心
  # 把面板收起来：面板是全场最大的一层窗口，留着会影响后续场景的前台 / 横幅判定。
  - name: 收起通知中心面板
    do: closeNotificationCenter
---

# 213-cron-startup-notification —— 冷启动即到点的通知不能丢（M620）

## 本场景在验什么

`notify-then-run` 任务在**应用冷启动那一刻已经到点**（`$pastMinute`）→ 启动评估投递「到点」
通知。两条判据一起看：

1. 通知中心里真的存在这条条目（`waitForNotification`，`fresh: false`——见下）；
2. 应用日志里有本轮的 `cron_notified(trigger=startup)`（日志按场景重置）。

## 为什么必须新增这条场景（M620 的现场）

2026-10-21 的探针（M620，产物在 `/tmp`、不入库）确认：macOS 打包实例冷启动最初约 0.5s 内，
`mac-usernotifications` 的**阻塞**投递（`notify-rust` 的 `show()` 走它）会直接返回
`MainThreadNotRunning`——主线程 `CFRunLoop` 还没进入等待——请求根本没发给 usernoted。M620 前的
投递封装把该错误吞成恒 Ok ⇒ 本仓误判「已投递」，写 `cron_notified` + `last_fired`，这次提醒
永久丢失。

既有场景 170 / 171 都用 `$nextMinute`（启动后 60–120s 才到点），因此从未覆盖这条路径——这正是
finding 里「启动窗口」的成因：不是系统在 0–60s 内丢通知，而是**启动最初半秒内的投递被本地拒绝、
且被误判成功、不再重试**。

## 为什么要先打开通知中心面板

`NotificationCenter.app` 的 AX 树只在**面板打开**时才有 `AXWindow` / 通知条目；面板关着时只剩
菜单栏（M620 实测：冷启动投递 3s 后开始轮询，30s / 72 次读取全是 12 个元素、无 `AXWindow`，
而同一时刻 usernoted 已记录 `Delivering … to [.alert .lockScreen .notificationCenter]`、
点开面板立刻读到 `(Lumir, acc-cron-startup, 到点)`）。因此场景先 `openNotificationCenter`
（点菜单栏时钟，幂等：已在打开态就跳过）再读，读完 `closeNotificationCenter` 收起。

## 为什么用 `fresh: false`

`waitForNotification` 的默认判据只认「动作开始之后新出现」的条目（M617），用来挡住更早一次
run 的残留条目。冷启动投递发生在套件开始轮询**之前**，条目已经躺在通知中心里——默认判据会把
它当旧条目挡掉，等待必然超时（M620 实测：基线读到 1 条 `AXGroup (Lumir, acc-cron-startup, 到点)`，
随后 120s 等不到「新」条目）。这一档因此显式接受已在场的匹配条目。

区分度由同一步里的 `cron_notified` 断言兜底：日志按场景重置，`cron_notified(trigger=startup)`
只可能由本轮写出；修复前该事件同样会写（插件恒 Ok 的假成功），所以**单看日志不足以判**——
这正是两条判据必须同时在场的原因：通知中心条目证明「系统真的收到了」，日志证明「是本轮发生的」。

## 判据方向（REVIEW.md「假绿」条）

- 修复前的真机读数（M620，本场景的第一次运行）：`cron_notified(trigger=startup)` 在启动后
  9ms 落盘，usernoted 同一时刻**只有连接行、零通知请求**；通知中心基线 0 条、120s 内 276 次
  读取全空 ⇒ FAIL。
- 修复后：同一场景的基线快照读到 `1 条：- [10] AXGroup (Lumir, acc-cron-startup, 到点)`，
  usernoted 记录 `Adding new request` / `Delivering … to [.alert .lockScreen .notificationCenter]`
  / `Presenting … as banner`。
- 负向判据 `cron_run_started` 计数为 0 证明本条没有把「点击」算进来（未点击不花 token）。

## 已知边界

- **上一轮残留条目的假绿**：`fresh: false` 不区分新旧，若同一台机器上短时间内重复跑本场景，
  上一轮留下的 `acc-cron-startup` 条目仍在通知中心，会让本步「立刻命中」。兜底是同一场景里的
  `cron_notified` 断言：修复后它只在投递被系统接受后才写，写不出来就判 FAIL。要彻底干净，
  跑前等残留条目过期（数分钟）或手动清掉通知中心。
- 专注模式（DND）会把横幅降级为延迟投递，但条目仍会进入通知中心；若 dump 只剩菜单栏，先按
  环境项（DND / 通知权限）排查，不要当产品缺陷。
