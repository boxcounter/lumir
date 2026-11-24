---
id: "731-harness-lazy-restore-publish-retry"
item: 731
tier: full
title: 首次发布失败不阻断对话：provider 后置失败入内存批次，权限恢复后显式重试同文件精确计数
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-retry-delayed.json"
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
      has: ["甲回答"]
    timeoutMs: 15000
  - name: 会话目录改为只读（真实 OS 权限故障）
    do: envChmod
    file: "harness/sessions/acc-lazy"
    mode: 0o500
  - name: 输入会触发首次发布与 provider 失败的消息
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|权限失败重试" }
    text: "权限失败重试"
  - name: 发送
    do: key
    key: enter
  - name: 等 provider 失败与重试动作（发布失败不得阻断错误轮次）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(重试\\)/", "对话暂未保存", "现在退出，这段对话将无法恢复"]
    timeoutMs: 30000
    expect:
      - label: 本次最终恢复文件未发布，目录仍只有源文件
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 1 }
      - label: 不显示虚假的历史缺口文案
        ax: { not: "此前部分对话记录未能保存" }
      - shot: 01-发布失败对话继续
  - name: 恢复目录写权限
    do: envChmod
    file: "harness/sessions/acc-lazy"
    mode: 0o700
  - name: 点显式重试
    do: click
    target: { role: AXButton, name: "^重试$" }
  - name: 等重试成功（第二次真实 provider 尝试）
    do: waitFor
    waitFor:
      has: ["RETRY-OK"]
    timeoutMs: 30000
    expect:
      - label: 同一身份只发布一份恢复文件
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 2 }
      - label: 两次真实尝试恰两条请求
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"llm_request"', exact: 2 } }
      - label: 两次真实尝试恰两条响应
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"llm_response"', exact: 2 } }
      - label: 首次 provider 失败 sidecar 恰一条
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"llm_error"', exact: 1 } }
      - label: session_open 与 inherit 各一份
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"session_open"', exact: 1 } }
      - label: notice_delivered 不双写
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"notice_delivered"', exact: 1 } }
      - label: 显式重试没有新增用户消息
        ax: { count: { pattern: "权限失败重试", exact: 1 } }
      - label: 健康恢复后不再显示退出风险
        ax: { not: "现在退出，这段对话将无法恢复" }
      - shot: 02-同文件重试精确计数
---

# 731 —— 发布失败与显式重试

`envChmod` 制造真实目录权限失败；首轮 mock 在 provider 侧失败，第二轮显式重试成功。最终 JSONL 必须含两次请求、两次响应和一条失败 sidecar，且全部来自同一个 pending 身份。
