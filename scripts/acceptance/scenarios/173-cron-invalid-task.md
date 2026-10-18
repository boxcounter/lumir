---
id: "173-cron-invalid-task"
item: 173
title: 配置非法项只丢弃该项：at=25:00 落 cron_task_invalid、合法任务照常触发（§7.5）
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron.json"
  cron:
    tasks:
      - id: "acc-cron-bad"
        vault: "$vault"
        at: "25:00"
        prompt: "CRON-PROBE-BAD 这条永远不该运行。"
        delivery: "silent-run"
      - id: "acc-cron-good"
        vault: "$vault"
        at: "$pastMinute"
        prompt: "CRON-PROBE-GOOD 非法项不连累这一条。"
        delivery: "silent-run"
steps:
  - name: 启动成功（非法项不阻断启动）
    expect:
      - label: vault 已装载、界面可用
        ax: { has: "vault：" }
      - shot: 启动后

  - name: 等到合法任务到点运行
    do: sleep
    ms: 50000
    expect:
      - label: 非法任务落一条 cron_task_invalid（field=at）
        file:
          path: "env:logs/*.jsonl"
          has: '/^.*"event":"cron_task_invalid".*"field":"at".*$/'
      - label: 合法任务照常运行
        file:
          path: "env:logs/*.jsonl"
          has: '/^.*"event":"cron_run_started".*"task":"acc-cron-good".*$/'
      - label: 非法任务零运行
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '/^.*"event":"cron_run_started".*"task":"acc-cron-bad".*$/', exact: 0 }
      - label: 合法任务的会话留存存在
        file: { path: "env:harness/sessions/*/*.jsonl", has: "CRON-PROBE-GOOD" }
      - shot: 合法任务运行后
---

说明（§7.5）：`at="25:00"` 在装载期被逐项校验丢弃（`cron_task_invalid(field=at)`），其余任务
照常生效——这是「配置即数据」的逐项校验口径。人话 warning 随 `ConfigSnapshot` 交给前端；
本场景断言的是可机器判定的结构化事件与「非法任务零运行、合法任务照常运行」两条后果。
