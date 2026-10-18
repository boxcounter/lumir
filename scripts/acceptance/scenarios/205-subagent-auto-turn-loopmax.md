---
id: "205-subagent-auto-turn-loopmax"
item: "8.22"
title: 子代理 8.22 自动回合内触顶 loop_max：按既有提示结束、链计数不变
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-loopmax.json"
    loopMax: 2
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

  - name: 等自动回合触顶 loop_max（2）
    do: waitFor
    waitFor:
      has: ["已达到工具循环上限（2 轮）"]
    timeoutMs: 60000
    expect:
      - label: 自动回合按既有提示结束
        ax: { has: "已达到工具循环上限（2 轮）" }
      - label: 触顶记进留存（loop_max_reached sidecar）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "/loop_max_reached/" }
      - label: 链计数不被工具往返推进（auto 回合仍是 chain_index=1）
        file: { path: "env:logs/*.jsonl", has: '/"chain_index":"1".*"event":"subagent_notified".*"wake":"auto_turn"/' }
      - shot: 01-loop-max
---

# 205 —— 8.22 自动回合与 loop_max 正交

`loopMax = 2`：自动回合里模型反复调工具、触顶后按既有提示结束；链计数数的是**回合数**，
不被工具往返推进（本条仍是 `chain_index = 1`）。两者各自停摆、互不替代。
