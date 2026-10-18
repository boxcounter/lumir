---
id: "198-subagent-parallel"
item: "8.16"
title: 子代理 8.16 同回合并行 + 按序回填（慢段先启动、快段先完成）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-parallel.json"
steps:
  - name: 写入定义 .lumir/agents/alpha.md
    do: vaultWrite
    file: ".lumir/agents/alpha.md"
    content: |
      ---
      name: alpha
      description: 慢段样本
      ---
      

  - name: 写入定义 .lumir/agents/beta.md
    do: vaultWrite
    file: ".lumir/agents/beta.md"
    content: |
      ---
      name: beta
      description: 快段样本
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

  - name: 等两段都完成
    do: waitFor
    waitFor:
      has: ["SGM-PARALLEL-PARENT 父会话：两段都完成。"]
    timeoutMs: 30000
    expect:
      - label: 工具结果按调用序回填（parent 第二轮请求里 call_a 的输出在 call_b 之前）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/"call_id":"call_a".*"call_id":"call_b"/' }
      - label: transcript 里两行 task 工具行都在（行序由调用时的创建序保证，AX 断言面不判顺序）
        ax: { has: "/task alpha/" }
      - label: 第二行同样在场
        ax: { has: "/task beta/" }
      - shot: 01-并行完成

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: 两个 run 都启动（同回合并行）
        file: { path: "env:logs/*.jsonl", count: { pattern: '"event":"subagent_started"', exact: 2 } }
      - label: 慢段（alpha）在内
        file: { path: "env:logs/*.jsonl", has: '/"agent":"alpha".*"event":"subagent_started"/' }
      - label: 快段（beta）也在
        file: { path: "env:logs/*.jsonl", has: '/"agent":"beta".*"event":"subagent_started"/' }

---

# 198 —— 8.16 同回合并行 + 按序回填

一条助手消息含两个 `task`：alpha 慢（delay 900）、beta 快（delay 150）。两段并行启动、各自收敛；
父请求的 tool results 按**调用序**回填（`call_a` 的输出在 `call_b` 之前）。

已知边界：两段时间区间的**重叠**没有机器断言（验收断言面没有跨行时间序判据）；本场景判的是
「两个 started 都在、快段先完成不影响回填序」。重叠本身由 `join_in_call_order` 单测与事件时序
承担。