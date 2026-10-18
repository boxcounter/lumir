---
id: "172-cron-silent-run"
item: 172
title: silent-run：静默运行、全程零通知、会话留存可查（§7.4）
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron.json"
  cron:
    tasks:
      - id: "acc-cron-silent"
        vault: "$vault"
        at: "$pastMinute"
        prompt: "CRON-PROBE-SILENT 静默运行，不要通知。"
        delivery: "silent-run"
        session: "new"
steps:
  - name: 等到点后的静默运行完成
    do: sleep
    ms: 50000
    expect:
      - label: 运行已发生（无用户点击）
        file:
          path: "env:logs/*.jsonl"
          has: '"event":"cron_run_started"'
      - label: 运行终态 ok=true
        file:
          path: "env:logs/*.jsonl"
          has: '/^.*"event":"cron_run_finished".*"ok":"true".*$/'
      - label: silent-run 全程零通知（任何 kind 的 cron_notified 都是 0 条）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_notified"', exact: 0 }
      - label: 会话留存可经既有 per-vault 布局找到
        file: { path: "env:harness/sessions/*/*.jsonl", has: "CRON-PROBE-SILENT" }
      - label: 用户当前界面没有该后台 prompt
        ax: { not: "CRON-PROBE-SILENT" }
      - shot: 静默运行后的界面
---

说明（§7.4）：`silent-run` 是「静默运行、不通知」档的定义：运行与留存照常，全程零通知。
负向判据用 `file.count` 按行计数（`cron_notified` 任何 kind 都必须为 0），不是靠 `not` 的
子串有无——后者在多事件混排的日志里没有区分度。
