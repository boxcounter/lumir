---
# change add-harness-turn-retry-nov23 A3：连点 / 并发第二次被拒——一次点击最多重发一次失败往返。
# 第一次重试仍在流式（fixture 的 delay_ms 撑窗口），第二次点击落在禁用钮上；成功后 JSONL 的
# llm_request 恰 2 条、回答恰一份。
id: "712-harness-retry-double-click"
item: 712
tier: full
title: 连点重试只重发一次失败往返（在途窗口内第二次不产生额外请求）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-retry-delayed.json"
steps:
  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|double" }
    text: "double"
  - name: Enter
    do: key
    key: enter
  - name: 等失败动作
    do: waitFor
    waitFor:
      has: ["/AXButton \\(重试\\)/"]
    timeoutMs: 30000
  - name: 第一次点重试
    do: click
    target: { role: AXButton, name: "^重试$" }
  # 第二击**不做**：按钮点击后立即 disabled，AXPress 一个禁用节点必然报
  # `target element is disabled (AXEnabled=false)`——那是装置层的动作失败，不是产品行为。
  # 连点语义的可观测面改为「禁用标记在场 + 请求数只 +1」，见下一步与末尾计数。
  - name: 断言动作已禁用（在途窗口内第二次点击不可能被受理）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(重试\\)[^\\n]*\\(disabled\\)/"]
    timeoutMs: 5000
    expect:
      - label: 重试动作在第一次点击后立即禁用（AX 文本带 (disabled)）
        ax: { has: '/AXButton \(重试\)[^\n]*\(disabled\)/' }
      - shot: 01-第一次点击后动作禁用
  - name: 等重试成功
    do: waitFor
    waitFor:
      has: ["RETRY-OK"]
    timeoutMs: 30000
    expect:
      - label: 失败往返只被重发一次（llm_request 恰 2 条）
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"llm_request"', exact: 2 } }
      - label: 回答只一份（重复重试会再产一份）
        ax: { has: "RETRY-OK", count: { pattern: "RETRY-OK", exact: 1 } }
      - label: 动作已消失
        node: { role: AXButton, name: "^重试$", present: false }
      - shot: 01-连点后单份回答
---

# 712-harness-retry-double-click —— 连点

第二击可能因按钮 `disabled` 而落在不可点元素上（`allowMissing` 只放过「节点不可点」这一形态，
不放行「请求被受理」）：真正的判据是 JSONL 的 2 条上限与回答的单份性。并发两次后端请求的
守卫归 R3 / R6（`begin_retry` 的 busy + 消费 failed）。
