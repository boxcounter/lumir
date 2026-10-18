---
id: "199-subagent-background-wake"
item: "8.17"
title: 子代理 8.17 后台运行 + 完成通知 + 自动唤醒
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-background.json"
steps:
  - name: 写入定义 .lumir/agents/research.md
    do: vaultWrite
    file: ".lumir/agents/research.md"
    content: |
      ---
      name: research
      description: 通用样本
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

  - name: 等后台启动（父回合正常收尾）
    do: waitFor
    waitFor:
      has: ["SGN-BG-PARENT 父会话：后台已启动。"]
    timeoutMs: 30000
    expect:
      - shot: 01-后台已启动

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: 后台 run 以 background=true 启动
        file: { path: "env:logs/*.jsonl", has: '/"background":"true".*"event":"subagent_started"/' }

  - name: 等完成通知上屏 + 自动回合汇报
    do: waitFor
    waitFor:
      has: ["SGN-AUTO 父会话：后台任务已完成，汇报如下。"]
    timeoutMs: 30000
    expect:
      - label: transcript 出现后台完成通知（与用户消息区分）
        ax: { has: "后台任务完成 · research" }
      - label: 通知带详情指引
        ax: { has: "详情见任务面板" }
      - label: 通知以 auto_notice 标记进了模型上下文（llm_request.messages）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "auto_notice" }
      - label: 投递标记落盘（notice_delivered sidecar）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "notice_delivered" }
      - label: 自动回合的助手回复上屏（普通回合形态，无额外标记）
        ax: { has: "SGN-AUTO" }
      - shot: 02-自动唤醒

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: 通知被最终处理为 auto_turn、链序号 1
        file: { path: "env:logs/*.jsonl", has: '/"chain_index":"1".*"event":"subagent_notified".*"wake":"auto_turn"/' }

---

# 199 —— 8.17 后台运行 + 通知 + 自动唤醒

`background=true`：工具结果立即 `running`、父回合正常收尾；run 收敛后通知上屏（带 `auto_notice`
标记与投递标记），空闲合并窗口到期后自动起一个回合（`wake=auto_turn`、`chain_index=1`）。