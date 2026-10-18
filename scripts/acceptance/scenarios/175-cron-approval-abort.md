---
id: "175-cron-approval-abort"
item: 175
title: 无人值守运行遇批准闸即中止（approval_required），不挂起、不放行（§3.5 / §6.4）
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron-approval.json"
    # read_only = 读自动放行、一切写逐个问：vault_patch 因此进批准闸。
    permission_mode: read_only
  cron:
    tasks:
      - id: "acc-cron-approval"
        vault: "$vault"
        at: "$pastMinute"
        prompt: "CRON-PROBE-APPROVAL 无人值守运行遇到批准闸必须中止。"
        delivery: "silent-run"
        session: "new"
steps:
  - name: 等到点后的无人值守运行撞上批准闸
    do: sleep
    ms: 50000
    expect:
      - label: 运行已发起
        file:
          path: "env:logs/*.jsonl"
          has: '"event":"cron_run_started"'
      - label: 终态是失败且错误码为 approval_required（不挂起、不自动放行）
        file:
          path: "env:logs/*.jsonl"
          has: '/^.*"error":"approval_required".*"event":"cron_run_finished".*"ok":"false".*$/'
      - label: 会话留存如实记录中止原因
        file:
          path: "env:harness/sessions/*/*.jsonl"
          has: '/^.*"kind":"turn_aborted".*"reason":"approval_required".*$/'
      - label: 被闸住的写没有落盘（无人值守运行不放行）
        file: { path: "harness-note.md", has: "HNL-BETA 第二行，等待 patch。" }
      - shot: 批准闸中止后的界面
---

说明（§3.5 / §6.4）：无人值守运行（`silent-run` / `run-then-notify`）遇到需批准的调用时 MUST
中止本次运行并以 `approval_required` 记录诊断——不自动放行、不自动拒绝、也不无限挂起。本场景
用 mock 的一轮 `vault_patch`（read_only 档必然进闸）驱动真机现场：终态事件带
`error=approval_required`，会话留存的 `turn_aborted` 带同一原因，且 patch 没有落盘。
