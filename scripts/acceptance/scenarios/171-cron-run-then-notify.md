---
id: "171-cron-run-then-notify"
item: 171
title: run-then-notify：到点静默运行、终态后投递结果通知、用户当前会话不被污染（§7.3）
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron.json"
  cron:
    tasks:
      - id: "acc-cron-run"
        vault: "$vault"
        at: "$pastMinute"
        prompt: "CRON-PROBE-RUNTHEN 后台运行，不要出现在用户当前会话里。"
        delivery: "run-then-notify"
        session: "new"
steps:
  - name: 等到点后的后台运行完成（启动拉取触发 + mock 一轮问答 + 结果通知）
    do: sleep
    ms: 50000
    expect:
      - label: 后台运行已发起（无用户点击）
        file:
          path: "env:logs/*.jsonl"
          has: '"event":"cron_run_started"'
      - label: 运行终态 ok=true
        file:
          path: "env:logs/*.jsonl"
          has: '/^.*"event":"cron_run_finished".*"ok":"true".*$/'
      - label: 终态后投递了结果通知（kind=result）
        file:
          path: "env:logs/*.jsonl"
          has: '/^.*"event":"cron_notified".*"kind":"result".*$/'
      - label: run-then-notify 不投「到点」通知
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '/^.*"event":"cron_notified".*"kind":"trigger".*$/', exact: 0 }
      - label: 任务的 prompt 进入后台会话的留存（per-vault 布局）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "CRON-PROBE-RUNTHEN" }
      - label: 用户当前会话 / 界面没有被后台运行的 prompt 污染
        ax: { not: "CRON-PROBE-RUNTHEN" }
      - shot: 运行完成后的界面

  - name: 点击结果通知恢复该次会话
    do: invalidate
    reason: >-
      本机 DND 抑制通知横幅上屏（usernoted：muted by DND suppression），横幅不在 Lumir 的 AX
      树 / 窗口截图内，套件无法客观点击系统通知中心里的结果通知。按 §7.7 标 INVALID，不伪造
      PASS；运行侧的三条判据（started / finished ok=true / kind=result）与「无 trigger 通知」
      已在本步之前客观判定。复跑条件：关闭专注模式后点击结果通知，再断言
      cron_click(ok=true, action=open-session) 且不产生第二次 cron_run_started。
---

说明（§7.3）：`run-then-notify` 的到点语义是「无『到点』通知、静默发起运行、终态后投递结果
通知」。运行槽位与交互会话槽位分离的机器判据在 Rust 契约测试
（`run_slot_does_not_touch_the_interactive_session`），本场景补真机侧证据：后台会话照常落在
`env:harness/sessions/<vault id>/`，而用户界面里没有该 prompt。

点击结果通知恢复会话的后半段依赖系统通知中心的可点击性（§7.7 边界 + 本机 DND），套件无法
客观执行，按 §7.7 标 INVALID；前面已通过的三条运行侧判据仍留在 steps.md 里作为正面证据。
