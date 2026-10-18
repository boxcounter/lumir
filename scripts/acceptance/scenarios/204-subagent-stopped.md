---
id: "204-subagent-stopped"
item: "8.21"
title: 子代理 8.21 停止自动回合 ⇒ blocked_stopped（后续通知不再唤醒）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-stopped.json"
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
      has: ["SGS-PARENT 父会话：两个后台已启动。"]
    timeoutMs: 30000

  - name: 等自动回合开始（第一条结果唤醒）
    do: sleep
    ms: 3500

  - name: 停止自动回合（发送钮的停止态）
    do: click
    target: { role: AXButton, name: "^停止$", nth: 0 }

  - name: 等第二条结果被 blocked_stopped 挡住
    do: waitFor
    waitFor:
      has: ["/你停止了自动回合/"]
    timeoutMs: 60000
    expect:
      - label: 提示行给停止档文案
        ax: { has: "你停止了自动回合" }
      - label: 停止的自动回合没有产出汇报（没有被唤醒的回复）
        ax: { not: "SGS-AUTO" }
      - shot: 01-停止后不再唤醒

  - name: 等第二条结果的处理落日志（自动回合的 4s 响应跑完 + 日志刷盘）
    do: sleep
    ms: 6500
    expect:
      - label: 第二条结果的 wake = blocked_stopped（不再唤醒）
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_notified".*"wake":"blocked_stopped"/' }
---

# 204 —— 8.21 停止自动回合（blocked_stopped）

第一条后台结果在空闲合并窗口后起了一个自动回合（`delay_ms: 4000` 撑出停止窗口）；用户点停止
⇒ `blocked = stopped`。第二条结果随后收敛：通知照常上屏，但 `wake = blocked_stopped`，
不再被下一个完成通知推翻。

已知边界：停在 4 秒窗口内由场景固定 `sleep 3500` 保证；机器极慢时会在停止前结束——那样
`SGS-AUTO` 出现、场景判红（如实暴露，不做自适应重试）。
