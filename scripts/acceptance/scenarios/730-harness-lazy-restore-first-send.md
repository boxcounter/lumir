---
id: "730-harness-lazy-restore-first-send"
item: 730
tier: full
title: 首次真实发送唯一发布：初始批次顺序、双击只受理一轮、源行再次发送形成第二分支
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-lazy-send.json"
seed:
  registry:
    - { id: acc-lazy, path: $vault, lastOpenedAt: 1757000002000 }
  envFiles:
    - { path: harness/sessions/acc-lazy/s100000-lazy-a.jsonl, from: "$fixtures/lazy-restore-a.jsonl" }
steps:
  - name: 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
  - name: 打开历史浮层
    do: click
    target: { role: AXPopUpButton, name: "新会话" }
  - name: 查看 A
    do: clickInNode
    target: { role: AXMenuItem, name: "查看甲" }
  - name: 等 A 重建
    do: waitFor
    waitFor:
      has: ["甲回答", "后台任务完成"]
    timeoutMs: 15000
  - name: 输入首次续聊
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|双击首发" }
    text: "双击首发"
  - name: 双击发送（第二击只能得到 busy 或禁用拒绝）
    do: doubleClick
    target: { role: AXButton, name: "^发送$" }
    retries: 2
  - name: 等首轮完成
    do: waitFor
    waitFor:
      has: ["LAZY-OK"]
    timeoutMs: 30000
    expect:
      - label: 源 + 一份恢复文件，双击不产生第二份
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 2 }
      - label: 首条真实 llm_request 恰一条
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"llm_request"', exact: 1 } }
      - label: 对应响应恰一条
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"llm_response"', exact: 1 } }
      - label: session_open 恰一条
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"session_open"', exact: 1 } }
      - label: inherit 在初始批次恰一条
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"decision":"inherit"', exact: 1 } }
      - label: notice_delivered 在初始批次恰一条
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"notice_delivered"', exact: 1 } }
      - label: 用户消息只上屏一次
        ax: { count: { pattern: "双击首发", exact: 1 } }
      - shot: 01-双击只一轮
  - name: 新会话，让源行可再次建立分支
    do: click
    target: { role: AXButton, name: "^新会话$" }
  - name: 打开历史浮层
    do: click
    target: { role: AXPopUpButton, name: "新会话" }
  - name: 点源 A 行（第一分支在前，源行第二）
    do: clickInNode
    target: { role: AXMenuItem, name: "查看甲", nth: 1 }
  - name: 等源 A 再次重建
    do: waitFor
    waitFor:
      has: ["甲回答"]
    timeoutMs: 15000
  - name: 输入第二分支首轮
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|第二分支" }
    text: "第二分支"
  - name: 发送
    do: key
    key: enter
  - name: 等第二分支回答
    do: waitFor
    waitFor:
      has: ["LAZY-OK"]
    timeoutMs: 30000
    expect:
      - label: 第二个真实分支才增加第三份文件
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 3 }
      - label: 第二分支仍指向同一源 A
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"restored_from":"s100000-lazy-a"' }
      - label: 第二分支也只有一个首个请求
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"llm_request"', exact: 1 } }
      - shot: 02-第二分支
---

# 730 —— 首次发送与第二分支

mock 首轮延迟 1.5 秒，让双击的第二击落在 busy 窗口。文件数、请求数与上屏用户数三重判定只受理一轮。
