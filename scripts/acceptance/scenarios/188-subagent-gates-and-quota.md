---
id: "188-subagent-gates-and-quota"
item: "8.7"
title: 子代理 8.7 三重闸触顶 + 配额（partial + stopped_by + 无追加调用）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-gates.json"
steps:
  - name: 写入定义 .lumir/agents/tiny_tokens.md
    do: vaultWrite
    file: ".lumir/agents/tiny_tokens.md"
    content: |
      ---
      name: tiny_tokens
      description: token 闸
      max_tokens: 1
      ---
      

  - name: 写入定义 .lumir/agents/tiny_rounds.md
    do: vaultWrite
    file: ".lumir/agents/tiny_rounds.md"
    content: |
      ---
      name: tiny_rounds
      description: 轮次闸
      max_turns: 1
      ---
      

  - name: 写入定义 .lumir/agents/tiny_time.md
    do: vaultWrite
    file: ".lumir/agents/tiny_time.md"
    content: |
      ---
      name: tiny_time
      description: 时间闸
      timeout_secs: 1
      ---
      

  - name: 写入定义 .lumir/agents/tiny_quota.md
    do: vaultWrite
    file: ".lumir/agents/tiny_quota.md"
    content: |
      ---
      name: tiny_quota
      description: 配额
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

  - name: 第一段：token 闸触顶
    do: waitFor
    waitFor:
      has: ["SGF-TOKENS-PARENT 父会话：第一段触顶。"]
    timeoutMs: 30000
    expect:
      - label: 父会话已收下第一段结果并续写
        ax: { has: "SGF-TOKENS-PARENT" }
      - shot: 01-token闸

  - name: 等回合收口
    do: waitFor
    waitFor:
      has: ['/AXButton \(发送\)/']
    timeoutMs: 15000
  - name: 第二段：轮次闸
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|SUBQ2" }
    text: "SUBQ2"
  - name: 发送
    do: key
    key: enter

  - name: 第二段触顶
    do: waitFor
    waitFor:
      has: ["SGF-ROUNDS-PARENT 父会话：第二段触顶。"]
    timeoutMs: 30000
    expect:
      - shot: 02-轮次闸

  - name: 等回合收口
    do: waitFor
    waitFor:
      has: ['/AXButton \(发送\)/']
    timeoutMs: 15000
  - name: 第三段：时间闸
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|SUBQ3" }
    text: "SUBQ3"
  - name: 发送
    do: key
    key: enter

  - name: 第三段触顶
    do: waitFor
    waitFor:
      has: ["SGF-TIME-PARENT 父会话：第三段触顶。"]
    timeoutMs: 30000
    expect:
      - shot: 03-时间闸

  - name: 等回合收口
    do: waitFor
    waitFor:
      has: ['/AXButton \(发送\)/']
    timeoutMs: 15000
  - name: 第四段：配额
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|SUBQ4" }
    text: "SUBQ4"
  - name: 发送
    do: key
    key: enter

  - name: 第四段收敛
    do: waitFor
    waitFor:
      has: ["SGF-QUOTA-PARENT 父会话：第四段配额收敛。"]
    timeoutMs: 30000
    expect:
      - shot: 04-配额

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: token 闸 ⇒ partial + stopped_by=tokens
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_finished".*"status":"partial".*"stopped_by":"tokens"/' }
      - label: 轮次闸 ⇒ partial + stopped_by=rounds
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_finished".*"status":"partial".*"stopped_by":"rounds"/' }
      - label: 时间闸 ⇒ partial + stopped_by=time
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_finished".*"status":"partial".*"stopped_by":"time"/' }
      - label: 配额 ⇒ partial + stopped_by=quota（与接口错误分开）
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_finished".*"status":"partial".*"stopped_by":"quota"/' }
      - label: 三个预算闸各自只跑了一轮（触顶后无追加总结调用）
        file: { path: "env:logs/*.jsonl", count: { pattern: '/"event":"subagent_finished".*"rounds":"1"/', exact: 3 } }
      - label: 配额段 = 工具轮 + 错误轮（两轮，不重试）
        file: { path: "env:logs/*.jsonl", count: { pattern: '/"agent":"tiny_quota".*"rounds":"2".*"stopped_by":"quota"/', exact: 1 } }

---

# 188 —— 8.7 三重闸 + 配额

四个定义分别把 `max_tokens` / `max_turns` / `timeout_secs` 压到极小，外加一段 quota 收敛。
判据：四种 `stopped_by` 各一条、四段 `rounds=1`（触顶后不追加总结调用，配额也不重试）。
时间闸的 `delay_ms: 1500` 是「响应尚未开始」的窗口（不可中断，但预算在下一轮检查点判到）。