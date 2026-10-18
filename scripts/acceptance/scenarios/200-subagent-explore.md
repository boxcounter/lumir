---
id: "200-subagent-explore"
item: "8.18"
title: 子代理 8.18 内建 explore 与其被同名定义覆盖
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-explore.json"
steps:
  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现
        ax: { has: "分隔条" }

  - name: 等清单拉取完成
    do: waitFor
    waitFor:
      has: ["/子代理清单 · 1/"]
    timeoutMs: 15000
  - name: 打开子代理清单（无自定义定义）
    do: click
    target: { role: AXButton, name: "子代理清单 · 1" }
    expect:
      - label: 清单只有内建 explore
        ax: { has: "explore" }
      - label: 来源标为内建
        ax: { has: "内建" }
      - label: 工具数是只读三件
        ax: { has: "3 件工具" }
      - shot: 01-内建 explore

  - name: 输入提问并发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|SUBQ" }
    text: "SUBQ"
  - name: 发送
    do: key
    key: enter

  - name: 等回合完成
    do: waitFor
    waitFor:
      has: ["SGO-EXPLORE-PARENT 父会话：清单已收到。"]
    timeoutMs: 30000
    expect:
      - shot: 02-内建运行

  - name: 等诊断日志落盘（内建 explore 的工具集）
    do: sleep
    ms: 1200
    expect:
      - label: 内建的 explore 可被委派（工具为只读三件）
        file: { path: "env:logs/*.jsonl", has: '/"agent":"explore".*"event":"subagent_started".*"tools":"vault_read,vault_search,skill_load"/' }

  - name: 放一个同名自定义定义（覆盖内建）
    do: vaultWrite
    file: ".lumir/agents/explore.md"
    content: |
      ---
      name: explore
      description: 自定义探索（覆盖内建）
      tools: [vault_read]
      ---

  - name: 再发一条消息触发定义重扫
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|SUBQ2" }
    text: "SUBQ2"
  - name: 发送
    do: key
    key: enter

  - name: 等第二次委派完成
    do: waitFor
    waitFor:
      has: ["SGO-EXPLORE-PARENT2 父会话：第二次清单已收到。"]
    timeoutMs: 30000
    expect:
      - shot: 03-覆盖后

  - name: 等诊断日志落盘（覆盖后）
    do: sleep
    ms: 1200
    expect:
      - label: 生效的是自定义定义（工具只剩 vault_read）
        file: { path: "env:logs/*.jsonl", count: { pattern: '/"agent":"explore".*"event":"subagent_started".*"tools":"vault_read"/', exact: 1 } }
      - label: 覆盖 warning 落诊断
        file: { path: "env:logs/*.jsonl", has: "（原来源：内建 explore）" }
---

# 200 —— 8.18 内建 explore 与覆盖

无自定义定义时清单含内建 `explore`（只读三件）；放同名自定义定义后生效的是自定义定义，清单
只显示一份并注明覆盖来源。判据：清单区读数、两轮 `subagent_started.tools`、覆盖 warning。
