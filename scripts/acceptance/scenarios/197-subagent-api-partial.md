---
id: "197-subagent-api-partial"
item: "8.13"
title: 子代理 8.13 API 中断 partial：已有文本 + stopped_by=error
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-partial.json"
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
      has: ["SGK-PARTIAL-PARENT 父会话：子代理返回部分结果。"]
    timeoutMs: 30000
    expect:
      - label: 已产出的部分文本保留在结果里（sidecar 摘要非空）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/"agent":"research".*"status":"partial".*"stopped_by":"error"/' }
      - shot: 01-API中断

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: 子运行以 partial 收敛、stopped_by=error（与配额分开）
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_finished".*"status":"partial".*"stopped_by":"error"/' }
      - label: 两轮往返（工具轮 + 错误轮），错误后不重试
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_finished".*"rounds":"2"/' }

---

# 197 —— 8.13 API 中断 partial

子运行第一轮产出文本 + 工具调用，第二轮 provider 返回错误。有文本 ⇒ `partial` +
`stopped_by=error`（不是 failed；`error` 与 `quota` 分开）。错误后不重试（rounds=2）。