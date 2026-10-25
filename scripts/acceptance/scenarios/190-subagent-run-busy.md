---
id: "190-subagent-run-busy"
item: "8.8"
title: 子代理 8.8 运行中的后台 run resume ⇒ run_busy
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$env/subagent-fixtures/run-busy.json"
seed:
  # 模板在起 app 之前预置（M745，口径与 189 同条）：`${run_id}` 由 mockFill 在运行期就地替换。
  envFiles:
    - path: subagent-fixtures/run-busy.json
      from: "$fixtures/subagent-fixtures/run-busy.json"
steps:
  - name: 写入定义 .lumir/agents/research.md
    do: vaultWrite
    file: ".lumir/agents/research.md"
    content: |
      ---
      name: research
      description: 后台慢任务
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

  - name: 等后台任务启动
    do: waitFor
    waitFor:
      has: ["SGF-BUSY-PARENT 父会话：后台已启动。"]
    timeoutMs: 30000
    expect:
      - shot: 01-后台已启动

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: 后台 run 已启动（status=running 的工具结果让父回合正常收尾）
        file: { path: "env:logs/*.jsonl", has: '/"background":"true".*"event":"subagent_started"/' }

  - name: 填入后台 run 的 run_id
    do: mockFill
    file: "subagent-fixtures/run-busy.json"

  - name: 等回合收口（发送钮回到发送态——busy 已释放才能发下一条）
    do: waitFor
    waitFor:
      has: ['/AXButton \(发送\)/']
    timeoutMs: 15000

  - name: 立即发第二条消息续跑（后台 run 仍在跑）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|SUBQ2" }
    text: "SUBQ2"
  - name: 发送
    do: key
    key: enter

  - name: 等续跑被拒
    do: waitFor
    waitFor:
      has: ["SGF-BUSY2-PARENT 父会话：续跑被拒。"]
    timeoutMs: 30000
    expect:
      - label: 运行中的 run 拒绝 resume（run_busy，不并发写同一子会话）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "run_busy" }
      - shot: 02-run-busy

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: 拒绝走 `subagent_rejected` 诊断（reason = run_busy）
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_rejected".*"reason":"run_busy"/' }

---

# 190 —— 8.8 run_busy

后台 run 的首段用 `delay_ms: 20000` 撑开运行窗口；第二条消息里 `task(resume=<run_id>)` 撞上
仍在跑的 run ⇒ `run_busy`，不并发写同一子会话。run_id 由 `mockFill` 从审计文件名取。

已知边界：本场景在后台 run 收敛前结束（app 由套件停止），不判它之后的终态。