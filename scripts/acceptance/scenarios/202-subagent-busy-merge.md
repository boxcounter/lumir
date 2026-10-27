---
id: "202-subagent-busy-merge"
item: "8.20"
tier: full
title: 子代理 8.20 忙时合并：两个后台结果只起一个自动回合
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-busy-merge.json"
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

  - name: 等两个后台启动
    do: waitFor
    waitFor:
      has: ["SGQ-START-PARENT 父会话：两个后台已启动。"]
    timeoutMs: 30000
    expect:
      - shot: 01-两个后台

  - name: 等诊断日志落盘（两个后台都已启动）
    do: sleep
    ms: 1200
    expect:
      - label: 两个后台 run 都启动
        file: { path: "env:logs/*.jsonl", count: { pattern: '/"background":"true".*"event":"subagent_started"/', exact: 2 } }

  - name: 用户回合进行中（两个后台结果在此期间收敛）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|SUBQ2" }
    text: "SUBQ2"
  - name: 发送
    do: key
    key: enter

  - name: 等合并后的自动回合
    do: waitFor
    waitFor:
      has: ["SGQ-MERGED-AUTO 父会话：两条后台结果已合并处理。"]
    timeoutMs: 40000
    expect:
      - label: 合并后的自动回合回复上屏
        ax: { has: "SGQ-MERGED-AUTO" }
      - shot: 02-忙时合并

  - name: 等诊断日志落盘（合并回合的链序号）
    do: sleep
    ms: 1500
    expect:
      - label: 两条通知都被处理为同一次自动回合（都是 chain_index=1）
        file: { path: "env:logs/*.jsonl", count: { pattern: '/"chain_index":"1".*"event":"subagent_notified".*"wake":"auto_turn"/', exact: 2 } }
      - label: 没有第二个自动回合（chain_index=2 不出现）
        file: { path: "env:logs/*.jsonl", count: { pattern: '/"chain_index":"2".*"event":"subagent_notified"/', exact: 0 } }
---

# 202 —— 8.20 忙时合并为一个回合

用户回合（`delay_ms: 3000`）进行中两个后台 run 相继收敛：通知进 pending，回合结束后合并为
**一条**输入、起**一个**自动回合。判据：两条 `subagent_notified` 的 `chain_index` 都是 1
（若叠了两个回合，第二条会是 2）且 `chain_index=2` 零次。
