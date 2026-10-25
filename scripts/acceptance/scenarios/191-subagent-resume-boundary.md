---
id: "191-subagent-resume-boundary"
item: "8.9"
title: 子代理 8.9 resume 边界：agent 不匹配、重启后不可续跑
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$env/subagent-fixtures/boundary.json"
seed:
  # 模板在起 app 之前预置（M745，口径与 189 同条）：`${run_id}` 由 mockFill 在运行期就地替换；
  # 场景后面的两个 envWrite 是**运行期改写**同一份副本（重启前后各一段脚本），与预置不冲突。
  envFiles:
    - path: subagent-fixtures/boundary.json
      from: "$fixtures/subagent-fixtures/boundary.json"
steps:
  - name: 写入定义 .lumir/agents/research.md
    do: vaultWrite
    file: ".lumir/agents/research.md"
    content: |
      ---
      name: research
      description: 边界样本
      ---
      

  - name: 写入定义 .lumir/agents/reviewer.md
    do: vaultWrite
    file: ".lumir/agents/reviewer.md"
    content: |
      ---
      name: reviewer
      description: 复核样本
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

  - name: 等第一段完成
    do: waitFor
    waitFor:
      has: ["SGF-BOUNDARY-PARENT 父会话：第一段完成。"]
    timeoutMs: 30000

  - name: 填入真实 run_id
    do: mockFill
    file: "subagent-fixtures/boundary.json"

  - name: 等回合收口（发送钮回到发送态——busy 已释放才能发下一条）
    do: waitFor
    waitFor:
      has: ['/AXButton \(发送\)/']
    timeoutMs: 15000

  - name: 用不同 agent 续跑
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|SUBQ2" }
    text: "SUBQ2"
  - name: 发送
    do: key
    key: enter

  - name: 等 agent 不匹配被拒
    do: waitFor
    waitFor:
      has: ["SGF-BOUNDARY2-PARENT 父会话：续跑被拒。"]
    timeoutMs: 30000
    expect:
      - label: agent 不匹配 ⇒ agent_mismatch（不继续）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "agent_mismatch" }
      - shot: 01-agent-mismatch

  - name: 换一份「重启后」的脚本（resume 落在第 1 条）
    do: envWrite
    file: "subagent-fixtures/boundary.json"
    content: |
      {
        "version": 1,
        "responses": [
          {
            "text": "重启后续跑。",
            "tool_calls": [
              {
                "id": "call_n3",
                "name": "task",
                "arguments": "{\"agent\": \"research\", \"prompt\": \"重启后续跑\", \"description\": \"重启后续跑\", \"resume\": \"${run_id}\"}"
              }
            ]
          },
          {
            "text": "SGF-BOUNDARY3-PARENT 父会话：重启后不可续跑。"
          }
        ],
        "subrun_span": 1
      }

  - name: 重启应用（保留表是内存态，重启即清空）
    do: restart

  - name: 重启后确认 pane 在场（重启会恢复上次的面板布局；不再 ⌘⇧A，否则会把恢复出的面板关掉）
    do: waitFor
    waitFor:
      has: ['/AXButton \(发送\)/']
    timeoutMs: 40000

  - name: 重启后重新铺模板（占位还原）
    do: envWrite
    file: "subagent-fixtures/boundary.json"
    content: |
      {
        "version": 1,
        "responses": [
          {
            "text": "重启后续跑。",
            "tool_calls": [
              {
                "id": "call_n3",
                "name": "task",
                "arguments": "{\"agent\": \"research\", \"prompt\": \"重启后续跑\", \"description\": \"重启后续跑\", \"resume\": \"${run_id}\"}"
              }
            ]
          },
          {
            "text": "SGF-BOUNDARY3-PARENT 父会话：重启后不可续跑。"
          }
        ],
        "subrun_span": 1
      }

  - name: 填 run_id 并发送
    do: mockFill
    file: "subagent-fixtures/boundary.json"
  - name: 输入提问并发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|SUBQ" }
    text: "SUBQ"
  - name: 发送
    do: key
    key: enter

  - name: 等重启后的续跑被拒
    do: waitFor
    waitFor:
      has: ["SGF-BOUNDARY3-PARENT 父会话：重启后不可续跑。"]
    timeoutMs: 30000
    expect:
      - label: 重启后同一 run_id 不可续跑（保留表跨重启不可 resume）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "run_not_resumable" }
      - shot: 02-重启后不可续跑
---

# 191 —— 8.9 resume 边界

两段判据：① 同一 run 用不同 agent 续跑 ⇒ `agent_mismatch`；② 重启后（保留表随进程消失）
同一 run_id 续跑 ⇒ `run_not_resumable`。

已知边界：**第 5 个 run LRU 淘汰后 resume** 这条不在真机层（静态 fixture 无法拿到被淘汰 run 的
id；`MAX_RETAINED_RUNS` 的淘汰语义由 `retained_runs_evict_oldest` 单测钉住）。重启路径证明了
「保留表不可跨进程」，LRU 路径证明「保留表只在内存里活一段」——两者是同一条能力边界的两端。
