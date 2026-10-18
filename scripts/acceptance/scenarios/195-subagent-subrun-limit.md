---
id: "195-subagent-subrun-limit"
item: "8.12"
title: 子代理 8.12 次数闸：max_subruns_per_turn=1 时第二个委派被拒
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-subrun-limit.json"
    subagents:
      max_subruns_per_turn: 1
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
      has: ["SGI-LIMIT-PARENT 父会话：第二个被拒。"]
    timeoutMs: 30000
    expect:
      - shot: 01-次数闸

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: 第一个委派正常执行
        file: { path: "env:logs/*.jsonl", has: '/"agent":"research".*"event":"subagent_started"/' }
      - label: 第二个委派被次数闸拒绝（subrun_limit）
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_rejected".*"reason":"subrun_limit"/' }
      - label: 只有一段真正执行
        file: { path: "env:logs/*.jsonl", count: { pattern: '"event":"subagent_started"', exact: 1 } }
      - label: 被拒调用不占额度、不产出完成事件
        file: { path: "env:logs/*.jsonl", count: { pattern: '"event":"subagent_finished"', exact: 1 } }

---

# 195 —— 8.12 次数闸

`max_subruns_per_turn = 1`：同一助手消息里的第二个 `task` 调用被 `subrun_limit` 拒绝，第一个照常
执行。判据：一条 rejected、恰好一条 started / finished。