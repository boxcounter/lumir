---
id: "169-cron-notify-trigger"
item: 169
title: cron 到点通知：notify-then-run 只投通知、不写 vault、未点击不花 token（change add-cron-runtime-daemon §7.1）
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron.json"
  # `$nextMinute` 由套件按写入时刻换算成「至少 60s 之后的下一个分钟边界」——不把时刻写死，
  # 跨天重跑也成立。delivery 缺省即 notify-then-run，这里显式写出来当判据。
  cron:
    tasks:
      - id: "acc-cron-notify"
        vault: "$vault"
        at: "$nextMinute"
        prompt: "CRON-PROBE-NOTIFY 这是一条只投通知的实验任务。"
        delivery: "notify-then-run"
        session: "new"
steps:
  - name: 到点前：只投通知前的准备态
    expect:
      - label: 去重状态尚不存在（本场景从空状态起）
        file: { path: "env:cron-state.json", exists: false }
      - label: 机制自身不往 vault 写任何东西（无 cron-state / 无临时文件）
        glob: { dir: ".", pattern: "cron-state\\.json|\\.tmp$", exact: 0 }
      - shot: 到点前

  - name: 等到点 + tick 余量（$nextMinute 至少 60s 后到点，30s tick 内评估）
    do: sleep
    ms: 125000

  - name: 到点后的判据
    expect:
      - label: 通知已投递（notify-then-run 的 trigger 通知）
        file:
          path: "env:logs/*.jsonl"
          has: '/^.*"event":"cron_notified".*"kind":"trigger".*$/'
      - label: 未点击 ⇒ 零运行、零模型请求（notify-then-run 的默认档语义）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started"', exact: 0 }
      - label: cron-state.json 记录了今日 last_fired
        file:
          path: "env:cron-state.json"
          has: '/"last_fired":\s*"\d{4}-\d{2}-\d{2}"/'
      - shot: 到点后（Lumir 窗口）
---

说明（§7.1）：任务 `at` = 写入时刻之后至少 60s 的下一个分钟边界，`delivery` 缺省档
`notify-then-run`。到点后机制只投通知并写 `last_fired`，MUST NOT 发起运行——因此日志里
`cron_run_started` 恒为 0 条，这条负向判据是本场景的核心（未点击不花 token）。

**通知横幅的验证边界（§7.7，如实登记）**：横幅属系统通知中心进程，不在 Lumir 的 AX 树里，
也不在 Lumir 窗口截图内（`shot` 拍到的是应用窗口）。本场景的投递判据是**应用日志**
（`cron_notified` 在 `deliver_notification` 返回成功后写入），不依赖横幅像素。

点击链路已不再靠人工：场景 170 / 171 用 `do: waitForNotification` / `do: clickNotification`
直接读 `NotificationCenter.app` 的 AX 树并对其条目发 `AXPress`（2026-10-19 起，专注模式关闭后
可复跑）。本场景（只投递、不点击）保持日志判据，不用横幅是否上屏作为 PASS/FAIL 条件。
