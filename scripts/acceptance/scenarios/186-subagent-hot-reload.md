---
id: "186-subagent-hot-reload"
item: "8.5"
title: 子代理 8.5 热加载：回合间改定义的模型与工具，下一回合生效
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-hot-reload.json"
steps:
  - name: 写入定义 .lumir/agents/research.md
    do: vaultWrite
    file: ".lumir/agents/research.md"
    content: |
      ---
      name: research
      description: 第一版定义
      model: mock-fast
      tools: [vault_read]
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

  - name: 等第一轮完成
    do: waitFor
    waitFor:
      has: ["SGH-ONE-PARENT 第一轮父总结。"]
    timeoutMs: 30000
    expect:
      - shot: 01-第一版

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: 第一轮按第一版定义运行（model = mock-fast、工具只一件）
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_started".*"model":"mock-fast".*"tools":"vault_read"/' }

  - name: 回合间改写定义（换模型 + 换工具）
    do: vaultWrite
    file: ".lumir/agents/research.md"
    content: |
      ---
      name: research
      description: 第二版定义
      model: mock-strong
      tools: [vault_read, vault_search]
      ---

  - name: 等第一轮收口（发送钮回到发送态——busy 已释放才能发第二条）
    do: waitFor
    waitFor:
      has: ['/AXButton \(发送\)/']
    timeoutMs: 15000

  - name: 再发一条消息（不重启）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|SUBQ2" }
    text: "SUBQ2"
  - name: 发送
    do: key
    key: enter

  - name: 等第二轮完成
    do: waitFor
    waitFor:
      has: ["SGH-TWO-PARENT 第二轮父总结。"]
    timeoutMs: 30000
    expect:
      - shot: 02-第二版生效

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: 第二轮用上了新模型与新工具（无需重启）
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_started".*"model":"mock-strong".*"tools":"vault_read,vault_search"/' }

---

# 186 —— 8.5 热加载

定义在**回合开头**扫描一次（design §4.7）：回合间改文件，下一回合的委派看到新字段。
判据取两轮 `subagent_started` 的 `model` 与 `tools` 串——第一版必须是旧值、第二版必须是新值，
两个方向都在断言里（只有一侧成立说明「读到的是同一份快照」）。