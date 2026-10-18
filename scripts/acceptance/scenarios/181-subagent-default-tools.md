---
id: "181-subagent-default-tools"
item: "8.2"
title: 子代理 8.2 默认只读三件（未声明 tools）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-default-tools.json"
steps:
  - name: 写入子代理定义 .lumir/agents/reader.md
    do: vaultWrite
    file: ".lumir/agents/reader.md"
    content: |
      ---
      name: reader
      description: 只读探索
      ---
      你是只读探索子代理。
      

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

  - name: 等父会话续写
    do: waitFor
    waitFor:
      has: ["SGB-READER-PARENT 父会话：摘要已收到。"]
    timeoutMs: 30000
    expect:
      - label: 委派完成闭环
        ax: { has: "SGB-READER-PARENT" }
      - label: 读类工具默认放行 ⇒ 全程无批准卡
        ax: { not: "等待批准" }
      - shot: 01-默认只读

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: 未声明 tools ⇒ 子运行工具恰为只读三件（comma 串逐字）
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_started".*"tools":"vault_read,vault_search,skill_load"/' }

---

# 181 —— 8.2 默认只读

定义不写 `tools` ⇒ 白名单取只读三件（`vault_read` / `vault_search` / `skill_load`）。
判据取 `subagent_started` 诊断的 `tools` 串（字段与面板事件同名同源，design §13）：
多一件写工具就会多一个逗号段，断言因此有区分度。