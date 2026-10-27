---
id: "182-subagent-explicit-write-tool"
item: "8.2"
tier: full
title: 子代理 8.2 显式写工具（声明 vault_patch）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-write-tool.json"
steps:
  - name: 写入子代理定义 .lumir/agents/writer.md
    do: vaultWrite
    file: ".lumir/agents/writer.md"
    content: |
      ---
      name: writer
      description: 写入变更
      tools: [vault_read, vault_patch]
      ---
      你是写入子代理，只改被点名的文件。
      

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
      has: ["SGB-WRITER-PARENT 父会话：写入完成。"]
    timeoutMs: 30000
    expect:
      - label: 父会话完成闭环
        ax: { has: "SGB-WRITER-PARENT" }
      - label: 子代理的写入走既有工具语义（文件内容真的改了）
        file: { path: "harness-note.md", has: "SGB-WRITTEN 第二行已由子代理修改。" }
      - label: 默认档（vault_write）下库内写自动放行 ⇒ 无批准卡
        ax: { not: "等待批准" }
      - shot: 01-显式写工具

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: 显式工具白名单生效（两个条目，不是只读三件）
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_started".*"tools":"vault_read,vault_patch"/' }

---

# 182 —— 8.2 显式写工具

定义声明 `tools: [vault_read, vault_patch]`，子代理调用 `vault_patch` 改 vault 内文件。
判据：白名单事件串、文件真实落盘、默认档下无批准闸（两处独立事实）。