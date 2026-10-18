---
id: "189-subagent-resume"
item: "8.8"
title: 子代理 8.8 resume 续跑：同 run、segment=2、审计追加、用量继续归桶
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$env/subagent-fixtures/resume.json"
steps:
  - name: 写入定义 .lumir/agents/research.md
    do: vaultWrite
    file: ".lumir/agents/research.md"
    content: |
      ---
      name: research
      description: 续跑样本
      max_tokens: 1
      ---
      

  - name: 写入运行期 fixture 模板（${run_id} 由 mockFill 在运行期填充）
    do: envWrite
    file: "subagent-fixtures/resume.json"
    content: |
      {
        "version": 1,
        "responses": [
          {
            "text": "先派 research。",
            "tool_calls": [
              {
                "id": "call_r1",
                "name": "task",
                "arguments": "{\"agent\": \"research\", \"prompt\": \"跑一半停住\", \"description\": \"续跑段一\"}"
              }
            ]
          },
          {
            "text": "半截结论。",
            "usage": {
              "input_tokens": 60,
              "output_tokens": 40
            }
          },
          {
            "text": "SGH2-RESUMED-CHILD 续跑后的完整结论。"
          },
          {},
          {
            "text": "SGF-RESUME-PARENT 父会话：第一段触顶。"
          },
          {
            "text": "续跑刚才那段。",
            "tool_calls": [
              {
                "id": "call_r2",
                "name": "task",
                "arguments": "{\"agent\": \"research\", \"prompt\": \"继续跑完\", \"description\": \"续跑段二\", \"resume\": \"${run_id}\"}"
              }
            ]
          },
          {
            "text": "SGF-RESUME2-PARENT 父会话：续跑完成。"
          }
        ],
        "subrun_span": 3
      }
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

  - name: 等第一段触顶
    do: waitFor
    waitFor:
      has: ["SGF-RESUME-PARENT 父会话：第一段触顶。"]
    timeoutMs: 30000
    expect:
      - shot: 01-第一段触顶

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: 第一段以 tokens 触顶
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_finished".*"status":"partial".*"stopped_by":"tokens"/' }

  - name: 把真实 run_id 填进第二段的 resume 参数
    do: mockFill
    file: "subagent-fixtures/resume.json"

  - name: 等回合收口（发送钮回到发送态——busy 已释放才能发下一条）
    do: waitFor
    waitFor:
      has: ['/AXButton \(发送\)/']
    timeoutMs: 15000

  - name: 发第二条消息续跑
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|SUBQ2" }
    text: "SUBQ2"
  - name: 发送
    do: key
    key: enter

  - name: 等续跑完成
    do: waitFor
    waitFor:
      has: ["SGF-RESUME2-PARENT 父会话：续跑完成。"]
    timeoutMs: 30000
    expect:
      - label: 审计同一文件追加（run_open 只出现一次、run_segment 追加）
        file: { path: "env:harness/subruns/*/*.jsonl", has: '/"kind":"run_segment".*"segment":2/' }
      - label: 两段都记进父会话 sidecar（用量继续归桶）
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '/"agent":"research".*"kind":"subrun"/', exact: 2 } }
      - shot: 02-续跑完成

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: 第二段以 segment=2 续跑同一 run
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_started".*"segment":"2"/' }
      - label: 续跑段完成（resume 后可完成）
        file: { path: "env:logs/*.jsonl", count: { pattern: '/"event":"subagent_finished".*"status":"completed"/', exact: 1 } }

---

# 189 —— 8.8 resume 续跑

第一段以 `max_tokens: 1` 触顶，第二段用 `task(resume=<真实 run_id>)` 续跑。run_id 是运行期
产物（审计文件名 `<run_id>.jsonl`），静态 fixture 写不出来——本场景先用 `envWrite` 铺一份带
`${run_id}` 占位的**副本**，两步之间用 `mockFill` 就地替换（仓库 fixture 原文不动）。

判据：`segment=2`（同一 run 的第二段）、续跑段 terminal completed、审计同文件追加
（`run_open` 一次 + `run_segment`）、两段 sidecar 都进父会话留存（用量归桶不断档）。