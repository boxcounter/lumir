---
# change add-harness-turn-retry-nov23 A5：失败后点「＋新会话」——会话对象换新，失败状态消失，
# 重试动作不再出现。
id: "714-harness-retry-new-session"
item: 714
tier: full
title: 新会话清掉可重试状态（动作消失、无残留入口）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-retry-network.json"
steps:
  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 发送并等失败
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|newsess" }
    text: "newsess"
  - name: Enter
    do: key
    key: enter
  - name: 等动作
    do: waitFor
    waitFor:
      has: ["/AXButton \\(重试\\)/"]
    timeoutMs: 30000
  - name: 点「＋新会话」
    do: click
    target: { role: AXButton, name: "^新会话$" }
  - name: 等新会话空态
    do: waitFor
    waitFor:
      has: ["问点什么"]
    timeoutMs: 20000
    expect:
      - label: 动作消失（失败状态随会话对象消失）
        node: { role: AXButton, name: "^重试$", present: false }
      - label: 错误行不跨会话重建
        ax: { not: "错误：LLM 请求发送失败" }
      - shot: 01-新会话无动作
---

# 714-harness-retry-new-session —— 新会话

`begin_turn` 推进世代并清空 `failed`；`reset_session` 丢弃会话对象，失败状态随之消失。
错误行是 live 面，不跨会话重建——新视图只有空态。
