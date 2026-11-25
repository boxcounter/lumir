---
# change add-harness-turn-retry-nov23 A6：不可重试失败（HTTP 400）不出现重试动作。判定来自后端
# 分类（`HttpNon2xx(400)` → 不可重试），前端只读 error 事件的 retry 缺键。
id: "715-harness-retry-nonretryable"
item: 715
tier: full
title: 请求类 4xx 不给重试（错误行在场、无动作、无快照 retry）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-retry-http-400.json"
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
    target: { role: AXTextArea, name: "问点什么|badreq" }
    text: "badreq"
  - name: Enter
    do: key
    key: enter
  - name: 等错误行
    do: waitFor
    waitFor:
      has: ["/HTTP 400/"]
    timeoutMs: 30000
    expect:
      # 实读（真机 2026-11-23）：`harness_http_error` 不在文案表里（表内只有
      # `harness_http_failed`），errorText 缺条目时回落后端 message「HTTP 400」，
      # 外层套 D348 ⇒「错误：HTTP 400」。断言按实际可观测面上屏的串写。
      - label: 错误行在场（错误：HTTP 400；该 code 尚无文案表条目，回落后端 message）
        ax: { has: "/错误：HTTP 400/" }
      - label: 不可重试失败没有「重试」动作
        node: { role: AXButton, name: "^重试$", present: false }
      - label: 不可重试失败不产生快照 retry（JSONL 没有第二条请求）
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"llm_request"', exact: 1 } }
      - shot: 01-无重试动作
---

# 715-harness-retry-nonretryable —— 4xx 不给重试

`HttpNon2xx(400)` 不属可重试集合（同一请求重发必然再失败）；分类结果缺 `retry` 键，
前端不渲染动作。permanent 流错误（内容策略 / 鉴权）的同类判据由 R15 的真实解析层反例覆盖。
