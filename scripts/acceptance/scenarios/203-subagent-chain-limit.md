---
id: "203-subagent-chain-limit"
item: "8.21"
tier: full
title: 子代理 8.21 链上限（5）：第 6 条结果不起回合、通知上屏、提示行 +「继续」
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-chain.json"
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

  - name: 等连续五个自动回合跑完
    do: waitFor
    waitFor:
      has: ["SGR-AUTO-5 自动回合 5。"]
    timeoutMs: 120000
    expect:
      - label: 五个自动回合依次推进（链序号 1..5 都出现过）
        file: { path: "env:logs/*.jsonl", has: '/"chain_index":"5".*"event":"subagent_notified".*"wake":"auto_turn"/' }
      - shot: 01-五轮自动回合

  - name: 等第 6 条后台结果被链闸挡住
    do: waitFor
    waitFor:
      has: ["/自动回合已达上限（5）/"]
    timeoutMs: 60000
    expect:
      - label: 触顶提示行出现（文案带上限值）
        ax: { has: "自动回合已达上限（5）" }
      - label: 提示行带「继续」按钮
        ax: { has: '/AXButton \(继续\)/' }
      - label: 通知照常上屏（第 6 条也可见）
        ax: { has: "后台任务完成 · research" }
      - shot: 02-链触顶

  - name: 等诊断日志落盘（第 6 条结果的 wake）
    do: sleep
    ms: 1500
    expect:
      - label: 第 6 条结果的 wake = blocked_chain（不起回合）
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_notified".*"wake":"blocked_chain"/' }

  - name: 点「继续」＝一次用户发言（链清零并起回合）
    do: click
    target: { role: AXButton, name: "^继续$" }

  - name: 等继续后的回合
    do: waitFor
    waitFor:
      has: ["SGR-CONTINUE 继续后的回合。"]
    timeoutMs: 60000
    expect:
      - label: 「继续」后起了一个回合（等价用户发言）
        ax: { has: "SGR-CONTINUE" }
      - label: 提示行收敛为「已继续」结果句
        ax: { has: "已继续：链计数清零" }
      - shot: 03-继续后
---

# 203 —— 8.21 链上限与继续

后台 run 的收敛驱动链式自动回合：每一轮自动回合再起一个后台 run，连续 5 轮后 `chain = 5`
⇒ 第 6 条结果不起回合（`wake = blocked_chain`），通知照常上屏，任务区顶部出现提示行；
点「继续」等价一次用户发言（链清零并起一个回合）。

已知边界：本场景把「用户发言后链清零、下一条结果恢复唤醒」的**后半段**留给 8.21b（停止档）；
发言路径与「继续」是同一条链清零实现（`begin_user_turn`），单测
`user_turn_resets_chain` 另钉。
