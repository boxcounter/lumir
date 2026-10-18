---
id: "184-subagent-approval-reject"
item: "8.3"
title: 子代理 8.3 批准透传（拒绝 ⇒ denied_calls=1、文件未删、子运行继续）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-reject.json"
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

  - name: 等批准卡出现
    do: waitFor
    waitFor:
      has: ["来自 scriber：清理目标文件", '/AXButton \(拒绝\)/']
    timeoutMs: 30000
    expect:
      - label: 批准卡点名发起者
        ax: { has: "来自 scriber：清理目标文件" }
      - shot: 01-拒绝前

  - name: 拒绝
    do: click
    target: { role: AXButton, name: "^拒绝$" }

  - name: 等子运行继续并完成
    do: waitFor
    waitFor:
      has: ["SGC-REJECTED-PARENT 父会话：子代理报告删除被拒。"]
    timeoutMs: 30000
    expect:
      - label: 拒绝只废掉这一次调用——子运行继续并完成
        ax: { has: "SGC-REJECTED-PARENT" }
      - label: 文件未被删除
        file: { path: "target.md", has: "SGC-TARGET" }
      - label: 拒绝 + 原因落留存（approval sidecar 记 rejected）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"decision":"rejected".*"kind":"approval".*$/' }
      - shot: 02-拒绝后完成

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: denied_calls = 1（拒绝计入子运行读数）
        file: { path: "env:logs/*.jsonl", has: '/"denied_calls":"1".*"event":"subagent_finished"/' }
      - label: 终态 completed（拒绝不是子运行失败）
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_finished".*"status":"completed"/' }

---

# 184 —— 8.3 批准透传（拒绝）

拒绝 ⇒ 工具结果回送 `approval_denied`、`denied_calls=1`、文件未删、子运行继续跑完。
判据：界面续写、盘上文件仍在、诊断事件的两个数字（denied_calls / status）、留存决策记录。