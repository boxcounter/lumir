---
id: "180-subagent-delegate-discovery"
item: "8.1"
tier: core
title: 子代理 8.1 委派执行链（fixture 驱动，不证明模型主动选择）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-delegate.json"
steps:
  - name: 写入子代理定义 .lumir/agents/research.md
    do: vaultWrite
    file: ".lumir/agents/research.md"
    content: |
      ---
      name: research
      description: 调研 vault 里的规范变更并给结论
      tools: [vault_read, vault_search]
      ---
      你是只读调研子代理。只做探索与综合，不修改文件。
      

  - name: 写入子代理定义 .lumir/agents/reviewer.md
    do: vaultWrite
    file: ".lumir/agents/reviewer.md"
    content: |
      ---
      name: reviewer
      description: 复核结论：逐条找反例、找依据缺口
      ---
      你是只读复核子代理。
      

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

  - name: 等父会话收到子代理摘要并续写
    do: waitFor
    waitFor:
      has: ["SGA-PARENT-ONE 父会话总结：research 已梳理完 9 个变更。"]
    timeoutMs: 30000
    expect:
      - label: 父会话最终回答上屏（委派闭环：子运行 → 工具结果 → 父续写）
        ax: { has: "SGA-PARENT-ONE" }
      - label: 子运行过程不进主 transcript（可见面 ≠ 进上下文）
        ax: { not: "SGA-CHILD-ONE 子代理结论" }
      - label: 子代理清单注入生效（任务区标题显示本次会话的完成计数）
        ax: { has: "/任务 · 本次会话 1 个已完成/" }
      - label: 父会话留存里有一段 subrun sidecar（用量同源）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"agent":"research".*"kind":"subrun".*"status":"completed".*$/' }
      - label: 子运行审计流水按 run 独立落盘（run_open 首段）
        file: { path: "env:harness/subruns/*/*.jsonl", has: '/^.*"kind":"run_open".*$/' }
      - shot: 01-委派完成

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: subagent_started 落诊断（agent = research、前台）
        file: { path: "env:logs/*.jsonl", has: '/^.*"agent":"research".*"background":"false".*"event":"subagent_started".*$/' }
      - label: subagent_finished 落诊断（status = completed）
        file: { path: "env:logs/*.jsonl", has: '/^.*"agent":"research".*"event":"subagent_finished".*"status":"completed".*$/' }

---

# 180 —— 8.1 委派执行链（fixture 驱动）

vault 放两个定义（research / reviewer），mock 父响应按 fixture 直接发出 `task` 调用。
判据：父会话拿到摘要并续写（tool 结果回填闭环）、子运行过程不上 transcript、诊断事件与
留存（subrun sidecar / 审计流水）三处独立事实同时在场。

**本场景证明的是执行链，MUST NOT 读成「模型会主动委派」**：`task` 调用来自 fixture 的脚本，
不是模型的选择。模型是否主动选择由真实 provider 六格验收（design §7）回答；
「工具有没有暴露给模型」由场景 257 的 `llm_request.tool_names` 与 194 的关停态对照回答。
本场景的可见面证据只取其后果：按名字委派的一条调用能跑通并闭环。

工具描述里的清单注入由后端 `task_definition` 生成（design §4.4），清单正文不进断言——
它是模型上下文，不是界面读数。