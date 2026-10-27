---
id: "196-subagent-concurrency-limit"
item: "8.12"
tier: full
title: 子代理 8.12 并发闸：max_concurrent=1 时第二个后台委派被拒
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-concurrency.json"
    subagents:
      max_concurrent: 1
steps:
  - name: 写入定义 .lumir/agents/research.md
    do: vaultWrite
    file: ".lumir/agents/research.md"
    content: |
      ---
      name: research
      description: 通用样本
      ---
      

  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现
        ax: { has: "分隔条" }

  - name: 输入提问并发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|SUBQ" }
    text: "SUBQ"
  - name: 发送
    do: key
    key: enter

  - name: 等回合完成
    do: waitFor
    waitFor:
      has: ["SGJ-CONCURRENCY-PARENT 父会话：第二个被拒。"]
    timeoutMs: 30000
    expect:
      - shot: 01-并发闸

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: 第一个后台 run 拿到并发许可
        file: { path: "env:logs/*.jsonl", has: '/"background":"true".*"event":"subagent_started"/' }
      - label: 第二个后台委派被并发闸拒绝（concurrency_limit，不排队）
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_rejected".*"reason":"concurrency_limit"/' }
      - label: 只启动了一段
        file: { path: "env:logs/*.jsonl", count: { pattern: '"event":"subagent_started"', exact: 1 } }

---

# 196 —— 8.12 并发闸

`max_concurrent = 1`：第一个后台 run 占住许可（首段 `delay_ms: 3000` 撑窗口），第二个后台委派
非阻塞取许可失败 ⇒ `concurrency_limit`（不排队、不自动补跑）。