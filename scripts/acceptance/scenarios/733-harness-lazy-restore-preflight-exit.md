---
id: "733-harness-lazy-restore-preflight-exit"
item: 733
tier: full
title: 查看后退出不复活；provider 前置拒绝不激活 pending（无新文件、无临时文件、错误可见）
open: harness-note.md
marker: "HNL-ALPHA"
seed:
  registry:
    - { id: acc-lazy, path: $vault, lastOpenedAt: 1757000002000 }
  harnessSessions:
    - vaultId: acc-lazy
      name: s100000-lazy-a.jsonl
      raw: |
        {"ts":100000,"payload":{"kind":"session_open","session_id":"s100000-lazy-a","vault_root":"$vault","opened_from":"new","provider":"mock","model":"mock-model","thinking":"high","system":"S","assembly":[]}}
        {"ts":100001,"payload":{"kind":"llm_request","request":{"system":"S","messages":[{"role":"user","content":[{"type":"input_text","text":"甲问题"}]}]}}}
        {"ts":100002,"payload":{"kind":"llm_response","text":"甲回答"}}
        {"ts":100003,"payload":{"kind":"session_title","title":"查看甲","decision":"initial","reason":"first-turn"}}
        {"ts":100004,"payload":{"kind":"subrun","run_id":"run-lazy-a","agent":"research","description":"甲后台任务","status":"completed","model":"mock-model","usage":{"input_tokens":1,"cached_tokens":0,"output_tokens":1}}}
        {"ts":100005,"payload":{"kind":"notice_delivered","run_ids":["run-lazy-a"],"wake_batch":"batch-lazy-a","shown_at":100005}}
    - vaultId: acc-lazy
      name: s200000-lazy-b.jsonl
      raw: |
        {"ts":200000,"payload":{"kind":"session_open","session_id":"s200000-lazy-b","vault_root":"$vault","opened_from":"new","provider":"mock","model":"mock-model","thinking":"high","system":"S","assembly":[]}}
        {"ts":200001,"payload":{"kind":"llm_request","request":{"system":"S","messages":[{"role":"user","content":[{"type":"input_text","text":"乙问题"}]}]}}}
        {"ts":200002,"payload":{"kind":"llm_response","text":"乙回答"}}
        {"ts":200003,"payload":{"kind":"session_title","title":"查看乙","decision":"initial","reason":"first-turn"}}
        {"ts":200004,"payload":{"kind":"subrun","run_id":"run-lazy-b","agent":"research","description":"乙后台任务","status":"completed","model":"mock-model","usage":{"input_tokens":1,"cached_tokens":0,"output_tokens":1}}}
        {"ts":200005,"payload":{"kind":"notice_delivered","run_ids":["run-lazy-b"],"wake_batch":"batch-lazy-b","shown_at":200005}}
steps:
  - name: 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
  - name: 打开历史浮层查看 A
    do: click
    target: { role: AXPopUpButton, name: "新会话" }
  - name: 等 A 的历史行出现
    do: waitFor
    waitFor:
      has: ["/AXMenuItem \\(查看甲/"]
    timeoutMs: 15000
  - name: 查看 A
    do: clickInNode
    target: { role: AXMenuItem, name: "查看甲" }
  - name: 等 A 重建
    do: waitFor
    waitFor:
      has: ["甲回答"]
    timeoutMs: 15000
  - name: 切到 B
    do: click
    target: { role: AXPopUpButton, name: "查看甲" }
  - name: 等 B 的历史行出现
    do: waitFor
    waitFor:
      has: ["/AXMenuItem \\(查看乙/"]
    timeoutMs: 15000
  - name: 查看 B
    do: clickInNode
    target: { role: AXMenuItem, name: "查看乙" }
  - name: 等 B 重建
    do: waitFor
    waitFor:
      has: ["乙回答"]
    timeoutMs: 15000
  - name: 再切回 A
    do: click
    target: { role: AXPopUpButton, name: "查看乙" }
  - name: 等 A 的历史行出现
    do: waitFor
    waitFor:
      has: ["/AXMenuItem \\(查看甲/"]
    timeoutMs: 15000
  - name: 查看 A
    do: clickInNode
    target: { role: AXMenuItem, name: "查看甲" }
  - name: 等 A 重建后未发送即退出
    do: waitFor
    waitFor:
      has: ["甲回答"]
    timeoutMs: 15000
  - name: 重启（未发布 pending 随内存消失）
    do: restart
  - name: 等重启后面板就绪
    do: waitFor
    waitFor:
      has: ["/AXButton \\(发送\\)/"]
    timeoutMs: 40000
    expect:
      - label: 重启后仍只有 A/B 源文件，不复活空恢复文件
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 2 }
      - label: 无临时文件
        glob: { dir: "env:harness/sessions", pattern: "\\.tmp$", exact: 0 }
  - name: 再查看 A
    do: click
    target: { role: AXPopUpButton, name: "新会话" }
  - name: 等重启后 A 的历史行出现
    do: waitFor
    waitFor:
      has: ["/AXMenuItem \\(查看甲/"]
    timeoutMs: 15000
  - name: 查看 A
    do: clickInNode
    target: { role: AXMenuItem, name: "查看甲" }
  - name: 等 A 重建
    do: waitFor
    waitFor:
      has: ["甲回答"]
    timeoutMs: 15000
  - name: 输入前置拒绝消息（未配置 provider）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|前置拒绝" }
    text: "前置拒绝"
  - name: 发送
    do: key
    key: enter
  - name: 等 provider 前置错误
    do: waitFor
    waitFor:
      has: ["还没有可用的 provider"]
    timeoutMs: 15000
    expect:
      - label: 前置拒绝有可见错误作为正观测
        ax: { has: "还没有可用的 provider" }
      - label: 前置拒绝不激活、不发布
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 2 }
      - label: 前置拒绝无临时文件
        glob: { dir: "env:harness/sessions", pattern: "\\.tmp$", exact: 0 }
      - shot: 01-前置拒绝零写盘
---

# 733 —— 退出与 provider 前置边界

全程不配置 provider。第一段证明纯查看没有任何可跨重启复活的持久化意图；第二段证明发送前置闸在真实 `llm_request` 之前拒绝，pending 仍不发布。
