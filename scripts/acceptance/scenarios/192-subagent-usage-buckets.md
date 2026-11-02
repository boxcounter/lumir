---
id: "192-subagent-usage-buckets"
item: "8.10"
tier: full
title: 子代理 8.10 用量按模型分桶 + 恢复后相等
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-usage.json"
steps:
  - name: 写入定义 .lumir/agents/fast_agent.md
    do: vaultWrite
    file: ".lumir/agents/fast_agent.md"
    content: |
      ---
      name: fast_agent
      description: 快模型段
      model: mock-fast
      ---
      

  - name: 写入定义 .lumir/agents/strong_agent.md
    do: vaultWrite
    file: ".lumir/agents/strong_agent.md"
    content: |
      ---
      name: strong_agent
      description: 强模型段
      model: mock-strong
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

  - name: 等两段都完成
    do: waitFor
    waitFor:
      has: ["SGF-USAGE-PARENT 父会话：两段都完成。"]
    timeoutMs: 30000
    expect:
      - label: 父会话留存里两个模型的 sidecar 各一条（分桶互不折叠）
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '/"kind":"subrun".*"model":"mock-fast"/', exact: 1 } }
      - label: 强模型桶同样独立
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '/"kind":"subrun".*"model":"mock-strong"/', exact: 1 } }
      - label: 完成后任务控制区整块消失（无「本次会话完成数」汇总，M822 C1）
        ax: { not: "/任务.*个运行中/" }
      - label: 不出现常驻按模型用量表（M822：用量改按需查看）
        ax: { not: "子任务用量（按模型）" }

  - name: 打开会话浮层查看按需用量段
    do: click
    target: { role: AXPopUpButton, name: "SUBQ|新会话" }
    expect:
      - label: 会话浮层顶部出现「本会话子任务用量」
        ax: { has: "本会话子任务用量" }
      - label: 多模型时按模型分行：快模型桶在场
        ax: { has: "mock-fast" }
      - label: 强模型桶也在（≥2 桶才分组）
        ax: { has: "mock-strong" }
      - shot: 01-会话用量按模型分桶

  - name: 收起会话浮层
    do: key
    key: escape

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: 两个 run 各用自己的模型
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_started".*"model":"mock-fast"/' }
      - label: 强模型段也在
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_started".*"model":"mock-strong"/' }

  - name: 重启应用
    do: restart

  - name: 等 pane 恢复（重启会恢复上次的面板布局；不再 ⌘⇧A，否则会把恢复出的面板关掉）
    do: waitFor
    waitFor:
      has: ['/AXButton \(发送\)/']
    timeoutMs: 40000
  - name: pane 就绪（与上一拍同判据，保留一步以便证据分段）
    do: waitFor
    waitFor:
      has: ['/AXButton \(发送\)/']
    timeoutMs: 30000
  - name: 点「＋新会话」把恢复出的会话切成历史（恢复路径要求当前会话不同于目标）
    do: click
    target: { role: AXButton, name: "^新会话$" }
  - name: 等新会话空态
    do: waitFor
    waitFor:
      has: ["与当前文档对话"]
    timeoutMs: 15000

  - name: 打开会话浮层
    do: click
    target: { role: AXPopUpButton, name: "新会话" }
  - name: 等历史会话行
    do: waitFor
    waitFor:
      has: ["SUBQ"]
    timeoutMs: 15000
  - name: 恢复历史会话
    do: clickInNode
    target: { name: "SUBQ" }
  - name: 等恢复后的会话就位
    do: waitFor
    waitFor:
      has: ['/AXButton \(发送\)/']
    timeoutMs: 30000
    expect:
      - label: 恢复后空闲态任务控制区不出现（存量用量不占位）
        ax: { not: "/任务.*个运行中/" }

  - name: 打开会话浮层查看按需用量段
    do: click
    target: { role: AXPopUpButton, name: "SUBQ|新会话" }
    expect:
      - label: 恢复后用量段仍在（读数由留存里的 subrun sidecar 重算）
        ax: { has: "本会话子任务用量" }
      - label: 恢复后两个模型桶仍在（与 live 相等）
        ax: { has: "mock-fast" }
      - label: 强模型桶也在
        ax: { has: "mock-strong" }
      - label: 重启后的分桶来自留存里的两段 subrun（重算输入在盘上）
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"subrun"', exact: 2 } }
      - shot: 02-恢复后分桶
---

# 192 —— 8.10 用量按模型分桶与恢复

两个并行 run 分别用 `mock-fast` / `mock-strong`。判据：事件、父会话 sidecar（两个模型桶各一条）、
会话浮层的按需用量段（M822 起常驻用量区退场，聚合只在按需入口），以及**重启恢复后用量段仍列出
两个桶**（读数由留存里的 `subrun` sidecar 重算，与 live 相等）。

恢复路径的口径（本场景的实测边界）：应用重启后会自动把最近的会话读回内存，面板据此重建 readonly
读数——用量区因此出现且两桶都在。`harness_resume_session` 另开新留存文件时把分桶种子写进
`session_open`（链式恢复不断档），那条路径由 M589 单测 `subrun_usage_seed_round_trips_and_chains`
钉住，本场景不重复断言新文件的 seed（面板同进程自动恢复与选择器恢复是两条入口，判据取
「重启后两个桶仍在 + 盘上有两段 subrun」这一对）。

父会话自己的 ctx% / cache% 不掺子运行读数的机制判据在 M589 的单测
（`subrun_records_do_not_change_parent_readings`）——本场景只判可见面与留存。
