---
id: "194-subagent-disabled"
item: "8.12"
tier: full
title: 子代理 8.12 关停：task 不注册、任务区不出现、定义保留
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-disabled.json"
    subagents:
      enabled: false
steps:
  - name: 写入定义 .lumir/agents/research.md
    do: vaultWrite
    file: ".lumir/agents/research.md"
    content: |
      ---
      name: research
      description: 关停时保留的定义
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
      has: ["SGD-DISABLED-PARENT 父会话：这次没有派子任务。"]
    timeoutMs: 30000
    expect:
      - label: 关停态下父会话仍正常（这条回答来自 mock 第 1 条，不经过任何委派）
        ax: { has: "SGD-DISABLED-PARENT" }
      - label: 暴露面按实际请求记录（tool_names 恒在场：负向断言不在「键缺失」上恒绿）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"tool_names":[' }
      - label: 关停态 tool_names 不含 task（与 257 的启用态在同一字段上对照）
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '/"tool_names":\[[^\]]*"task"/', exact: 0 } }
      - label: 任务区整块不出现（空态不占位）
        ax: { not: "任务 · 本次会话" }
      - label: 定义文件原样保留（重新启用即恢复）
        file: { path: ".lumir/agents/research.md", has: "关停时保留的定义" }
      - shot: 01-关停态
---

# 194 —— 8.12 关停

`[harness.subagents].enabled = false`：`task` 不注册、任务区整块不出现；定义文件与内建
`explore` 原样保留（改配置即可恢复，不需要删定义）。清单区已随 M610 退场，不再有界面判据。

暴露面判据（`llm_request.tool_names`）与 257 配对：同一字段在关停态不含 `task`、在启用态
含 `task`——两侧共用一条断言形态才有区分度。原先「请求体的 tools 清单里没有 task」的断言
（`"name":"task"` 计数为 0）已撤：`llm_request` 从不记录工具定义，那条判据在空集上恒真，
属 REVIEW.md「断言等价于子串」条拦的形态。
