---
id: "170-cron-click-run"
item: 170
title: 点击通知发起运行：click = intent（真机环境无法自动化点击时标 INVALID，不伪造 PASS）（§7.2）
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron.json"
  # `$pastMinute` = 当前分钟的前一分钟（今日已过）：启动后的拉取触发立即到点，不必等。
  cron:
    tasks:
      - id: "acc-cron-click"
        vault: "$vault"
        at: "$pastMinute"
        prompt: "CRON-PROBE-CLICK 点击通知后应当运行这一条。"
        delivery: "notify-then-run"
        session: "new"
steps:
  - name: 启动后的拉取触发：通知已投递，未点击不运行
    do: sleep
    ms: 40000
    expect:
      - label: 到点通知已投递
        file:
          path: "env:logs/*.jsonl"
          has: '/^.*"event":"cron_notified".*"kind":"trigger".*$/'
      - label: 未点击 ⇒ 没有 cron_run_started（无模型请求）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started"', exact: 0 }
      - shot: 通知已投递（Lumir 窗口；横幅属系统通知中心，不在窗口内）

  - name: 点击通知本体（系统通知中心）
    do: invalidate
    reason: >-
      本机处于专注模式（DND），通知横幅被 usernoted 抑制（日志：muted by DND suppression:
      delay，通知只进通知中心存储、不上屏）；通知中心面板无法在套件内打开、横幅也不在 Lumir
      的 AX 树 / 窗口截图内，因此「按截图坐标点击横幅本体」无法客观执行。按 §7.7 标 INVALID，
      不伪造 PASS。复跑条件：关闭专注模式后重跑本场景，点击后再断言 cron_click(ok=true,
      action=run) / cron_run_started / cron_run_finished(ok=true) / 面板出现 prompt 与回答 /
      会话 JSONL 落在目标 vault 目录。
---

说明（§7.2）：点击链路的前半段（到点 → 通知投递 → 未点击零运行）在本场景可判且已断言；
后半段（点击横幅 → `cron_click(ok=true, action=run)` → 运行）依赖系统通知中心的可点击性：
横幅不在 Lumir 的 AX 树里（§7.7 的边界口径），本机 DND 还抑制了横幅上屏，因此套件无法
客观执行这一步。**整场标 INVALID（退出码 2），不伪造 PASS**——本场景的读数不能用于判
「点击链路是否可用」，只保留到点 / 投递 / 未点击零运行这三条正面证据。
