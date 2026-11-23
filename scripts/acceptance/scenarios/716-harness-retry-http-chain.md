---
# change add-harness-turn-retry-nov23 A7：瞬时 HTTP 错误给重试——500 失败 → 重试再遇 429 →
# 动作重绑到新 turn → 再重试成功。两类状态码都走 `http_status` 分类（408/425/429/任意 5xx）。
id: "716-harness-retry-http-chain"
item: 716
tier: full
title: HTTP 500 / 429 给重试：连续失败重绑动作，最终一次点击成功
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-retry-http-chain.json"
steps:
  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|httpchain" }
    text: "httpchain"
  - name: Enter
    do: key
    key: enter
  - name: 等 500 失败动作
    do: waitFor
    waitFor:
      has: ["/AXButton \\(重试\\)/"]
    timeoutMs: 30000
  - name: 第一次重试（撞 429）
    do: click
    target: { role: AXButton, name: "^重试$" }
  - name: 等第二次失败后动作仍在（500 与 429 文案不同 ⇒ 两行；动作重绑新 turn）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(重试\\)/"]
    timeoutMs: 30000
    expect:
      # 实读（真机 2026-11-23）：500 与 429 的文案不同（「错误：HTTP 500」/「错误：HTTP 429」），
      # 既有规则是「同文案就地替换、不同文案追加」——两行都在场才是合同行为；动作只保留最新一条。
      - label: 500 错误行恰一条
        ax: { has: "/错误：HTTP 500/", count: { pattern: "/错误：HTTP 500/", exact: 1 } }
      - label: 429 错误行恰一条
        ax: { has: "/错误：HTTP 429/", count: { pattern: "/错误：HTTP 429/", exact: 1 } }
      - label: 动作仍恰好一条（重绑到最新失败轮）
        ax: { has: "/AXButton \\(重试\\)/", count: { pattern: "/AXButton \\(重试\\)/", exact: 1 } }
      - shot: 01-429-后动作重绑
  - name: 第二次重试（成功）
    do: click
    target: { role: AXButton, name: "^重试$" }
  - name: 等成功
    do: waitFor
    waitFor:
      has: ["RETRY-OK"]
    timeoutMs: 30000
    expect:
      - ax: { has: "RETRY-OK" }
      - label: 三次请求（首轮 + 两次重试）各一对记录
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"llm_request"', exact: 3 } }
      - shot: 02-最终成功
---

# 716-harness-retry-http-chain —— 500 / 429

Mock fixture 的 `http_status` 是测试表达面（不是真实解析层证据）：状态码 → `HttpNon2xx` 的分类
由 R1 钉死；真实网络层的 5xx / 429 归一不在此层判别。408 / 425 同属可重试集合，本场景不重复。
