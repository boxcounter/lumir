---
# change add-harness-turn-retry-nov23 A8：空响应（无正文、无工具调用）给重试；重试成功后正常
# 回答上屏。空响应的 reasoning 回放项不进 `input`（重试请求与失败请求 messages 相同，归 R11）。
id: "717-harness-retry-empty"
item: 717
tier: full
title: 空响应可重试：动作在场、点击成功；失败轮不留回放项
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-retry-empty.json"
steps:
  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|emptyturn" }
    text: "emptyturn"
  - name: Enter
    do: key
    key: enter
  - name: 等空响应错误 + 动作
    do: waitFor
    waitFor:
      has: ["/AXButton \\(重试\\)/"]
    timeoutMs: 30000
    expect:
      - label: 空响应的人话错误行（D898）
        ax: { has: "/模型返回了空响应/" }
      - label: 动作恰好一条
        ax: { has: "/AXButton \\(重试\\)/", count: { pattern: "/AXButton \\(重试\\)/", exact: 1 } }
      - label: 空响应的 usage 照常记账（ctx 读数非零）——空响应不是「没发生过请求」
        ax: { has: "/\\d+% · \\d+%|\\d+%/" }
      - shot: 01-空响应
  - name: 点重试
    do: click
    target: { role: AXButton, name: "^重试$" }
  - name: 等成功
    do: waitFor
    waitFor:
      has: ["RETRY-OK"]
    timeoutMs: 30000
    expect:
      - ax: { has: "RETRY-OK" }
      - shot: 02-空响应重试成功
---

# 717-harness-retry-empty —— 空响应

空响应判定已前移到响应项入 `input` / `panel` 之前：失败轮不留 reasoning 回放项，重试请求
`messages` 与失败请求相同（R11 的逐字节断言）。usage / on_round_usage / 思考兜底 / abort 的
优先级不变（R11 单测）。
