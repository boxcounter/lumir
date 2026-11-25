---
# change add-harness-turn-retry-nov23 A9：流式已产出半截正文后失败——旧回答保留并标「未完成」，
# 重试成功另起第二条 assistant（不替换旧内容）。
id: "718-harness-retry-partial"
item: 718
tier: full
title: 半截正文标「未完成」，重试成功后并列第二条回答
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-retry-partial.json"
    # 本场景不验证 Web；显式关闭以固定工具面（阶段5回扫）。
    web_access:
      enabled: false
steps:
  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|partial" }
    text: "partial"
  - name: Enter
    do: key
    key: enter
  - name: 等半截正文 + 未完成标记 + 动作
    do: waitFor
    waitFor:
      has: ["PART-1PART-2", "未完成"]
    timeoutMs: 30000
    expect:
      - label: 半截正文保留在 transcript
        ax: { has: "PART-1PART-2" }
      - label: 「未完成」标记恰一处（与「已停止」同型 live 标记）
        ax: { has: "未完成", count: { pattern: "未完成", exact: 1 } }
      - label: 动作在场
        ax: { has: "/AXButton \\(重试\\)/", count: { pattern: "/AXButton \\(重试\\)/", exact: 1 } }
      - shot: 01-半截正文与未完成
  - name: 点重试
    do: click
    target: { role: AXButton, name: "^重试$" }
  - name: 等第二条回答
    do: waitFor
    waitFor:
      has: ["RETRY-OK"]
    timeoutMs: 30000
    expect:
      - label: 新回答另起一条
        ax: { has: "RETRY-OK" }
      - label: 旧半截正文保留（不被替换 / 删除）
        ax: { has: "PART-1PART-2" }
      - label: 「未完成」标记仍在旧条上
        ax: { has: "未完成", count: { pattern: "未完成", exact: 1 } }
      - shot: 02-并列两条回答
---

# 718-harness-retry-partial —— 半截正文

流式错误（`stream_reported_transient`）在 mock 里的表达是「error 条目带 chunks」：先按序流出，
再以错误收尾。真实解析层（读错误 / 无终态 EOF / response.failed）的同类判据由 R15 覆盖。
