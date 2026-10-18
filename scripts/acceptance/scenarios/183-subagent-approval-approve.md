---
id: "183-subagent-approval-approve"
item: "8.3"
title: 子代理 8.3 批准透传（采纳 ⇒ 文件删除）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-approve.json"
    permission_mode: read_only
steps:
  - name: 写入子代理定义 .lumir/agents/scriber.md
    do: vaultWrite
    file: ".lumir/agents/scriber.md"
    content: |
      ---
      name: scriber
      description: 清理目标文件
      tools: [vault_delete]
      ---
      你是清理子代理。
      

  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现
        ax: { has: "分隔条" }

  - name: 准备目标文件
    do: vaultWrite
    file: "target.md"
    content: |
      SGC-TARGET 将被删除的目标文件。
  - name: 输入提问并发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|SUBQ" }
    text: "SUBQ"
  - name: 发送
    do: key
    key: enter

  - name: 等子运行的批准卡在任务行内展开
    do: waitFor
    waitFor:
      has: ["来自 scriber：清理目标文件", '/AXButton \(采纳\)/']
    timeoutMs: 30000
    expect:
      - label: 批准卡点名发起者（卡片跟着发起者走，不是父会话的卡）
        ax: { has: "来自 scriber：清理目标文件" }
      - label: 待批数出现在任务区标题（阻塞决策不藏在折叠区里）
        ax: { has: "/任务.*1 个等待批准/" }
      - label: 卡体给出删除的后果说明（可恢复，非永久删除）
        ax: { has: "移入系统废纸篓" }
      - shot: 01-任务行内批准卡

  - name: 采纳
    do: click
    target: { role: AXButton, name: "^采纳$" }

  - name: 等子运行继续并完成
    do: waitFor
    waitFor:
      has: ["SGC-APPROVED-PARENT 父会话：删除完成。"]
    timeoutMs: 30000
    expect:
      - label: 采纳后子运行继续跑完（父会话收到续写）
        ax: { has: "SGC-APPROVED-PARENT" }
      - label: 文件按既有语义删除
        file: { path: "target.md", exists: false }
      - label: 批准决策落留存（approval 终态记录）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"decision":"approved".*"kind":"approval".*$/' }
      - shot: 02-批准后完成

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: subagent_finished 终态 completed（批准不是失败）
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_finished".*"status":"completed"/' }

---

# 183 —— 8.3 批准透传（采纳）

子代理声明 `vault_delete`；`read_only` 档下一切写逐个问。批准卡渲染在**任务面板该 run 的
行内**并点名发起者（design §19.2），采纳后子运行继续、文件真被删除。

判据三处独立：界面（卡与点名）、盘（文件不存在）、留存（approval sidecar + 终态）。