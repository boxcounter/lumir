---
id: "201-subagent-panel-and-stop"
item: "8.19"
tier: full
title: 子代理 8.19 任务面板可见（WKWebView AX）+ 停止单个 run
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-panel.json"
steps:
  - name: 写入定义 .lumir/agents/alpha.md
    do: vaultWrite
    file: ".lumir/agents/alpha.md"
    content: |
      ---
      name: alpha
      description: 慢任务甲
      ---
      

  - name: 写入定义 .lumir/agents/beta.md
    do: vaultWrite
    file: ".lumir/agents/beta.md"
    content: |
      ---
      name: beta
      description: 慢任务乙
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

  - name: 等两个 run 都出现在任务区
    do: waitFor
    waitFor:
      has: ["任务 2 个运行中"]
    timeoutMs: 20000
    expect:
      - label: 任务区标题给出运行中计数
        ax: { has: "/任务 2 个运行中/" }
      - label: 两行各自点名 agent 与 description
        ax: { has: "/alpha.*慢任务甲/" }
      - label: 第二行同样在场
        ax: { has: "/beta.*慢任务乙/" }
      - label: 子运行自己的工具行不进主 transcript（父会话只看见 task 调用）
        ax: { not: '/vault_read\s*harness-note\.md/' }
      - shot: 01-两行运行中

  - name: 展开第一个 run 的行详情（目标限定任务区的行：带读数的按钮，不是 transcript 的 task 行）
    do: click
    target: { role: AXButton, name: "慢任务甲.*轮" }
    expect:
      - label: 行详情给出模型 / 轮次与步数读数
        ax: { has: "/轮 · [0-9]+ 步/" }
      - label: 运行中的行提供「停止」
        ax: { has: '/AXButton \(停止\)/' }
      - shot: 02-行详情

  - name: 停止第一个 run（只停它；任务行停止钮的读屏名是「停止该任务」，与发送钮的「停止」区分）
    do: click
    target: { role: AXButton, name: "^停止该任务$" }

  - name: 等本轮结束
    do: waitFor
    waitFor:
      has: ["SGP-PANEL-PARENT 父会话：本轮结束。"]
    timeoutMs: 30000
    expect:
      - label: 停止后任务区不再有运行中行
        ax: { not: "/任务.*个运行中/" }
      - shot: 03-停止后

  - name: 等两条终态落日志（被停的 run 在下一个检查点收敛）
    do: sleep
    ms: 2000
    expect:
      - label: 被停止的 run 收敛为 aborted（不触发唤醒）
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_finished".*"status":"aborted"/' }
      - label: 另一个 run 照常完成（只停它，不影响兄弟 run）
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_finished".*"status":"completed"/' }
---

# 201 —— 8.19 任务面板可见 + 停止单个 run

两个前台 run 并行（各自先做一次 `vault_read`，首响应 `delay_ms: 8000` 撑出可见窗口——这个
窗口里要完成「等两行出现 → 展开行详情 → 截图 → 点停止」，2.5s 时展开 + settle + 截图就已把点击
推到 run 结束之后，停止路径因此判不出 aborted）。判据：
任务区标题与两行读数（AX）、子运行工具行不进主 transcript、展开行给出详情与「停止」、
停止一个只让它自己 `aborted` 而兄弟 run 照常 `completed`。
