---
id: "174-cron-daily-dedup"
item: 174
title: 当日去重：通知一次后重启 + 多次切前台不再投递（§7.6）
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron.json"
  cron:
    tasks:
      - id: "acc-cron-dedup"
        vault: "$vault"
        at: "$pastMinute"
        prompt: "CRON-PROBE-DEDUP 今天只提醒一次。"
        delivery: "notify-then-run"
        session: "new"
steps:
  - name: 启动后的拉取触发：投递第一条（也是唯一一条）通知
    do: sleep
    ms: 35000
    expect:
      - label: 到点通知恰投递一次
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '/^.*"event":"cron_notified".*"kind":"trigger".*$/', exact: 1 }
      - label: cron-state.json 记录了今日 last_fired
        file:
          path: "env:cron-state.json"
          has: '/"last_fired":\s*"\d{4}-\d{2}-\d{2}"/'

  - name: 重启应用（启动补触发必须被当日去重挡住）
    do: restart
  - name: 等待重启后的启动补触发与 tick 评估
    do: sleep
    ms: 40000
    expect:
      - label: 重启后仍只有一条 trigger 通知（当日已触发不重复）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '/^.*"event":"cron_notified".*"kind":"trigger".*$/', exact: 1 }
      - label: last_fired 保持今日（未被改写 / 未清空）
        file:
          path: "env:cron-state.json"
          has: '/"last_fired":\s*"\d{4}-\d{2}-\d{2}"/'
      - label: 未点击 ⇒ 全程零运行
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started"', exact: 0 }
      - shot: 重启后的界面

  - name: 多次切前台（焦点触发不重复判定 / 不重复投递）
    do: focusWindow
  - name: 再切一次前台
    do: focusWindow
    expect:
      - label: 焦点触发没有产生第二条 trigger 通知
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '/^.*"event":"cron_notified".*"kind":"trigger".*$/', exact: 1 }
      - label: 也没有因此发起运行
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started"', exact: 0 }
---

说明（§7.6）：`at` = 今日已过时刻、状态文件在场景开始前被清空。第一条 trigger 通知投递成功后
`last_fired` 写今日；重启（启动补触发）与多次切前台（焦点拉取触发）都必须被同一份去重状态
挡住。判据用 `file.count` 的精确行数（1 条），不用 `has` 的有无——后者区分不出「多投了一次」。
横幅数量在 DND 下不可见（§7.7 边界），本场景以日志条数 + `last_fired` 为客观判据。
