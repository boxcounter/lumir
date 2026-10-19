---
id: "185-subagent-definition-validation"
item: "8.4"
title: 子代理 8.4 定义校验与优先级（坏定义告警、vault 覆盖用户级、同层字典序）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-validation.json"
steps:
  - name: 写入定义 .lumir/agents/broken-missing-name.md
    do: vaultWrite
    file: ".lumir/agents/broken-missing-name.md"
    content: |
      ---
      description: 缺 name 的坏定义
      ---
      

  - name: 写入定义 .lumir/agents/broken-unknown-tool.md
    do: vaultWrite
    file: ".lumir/agents/broken-unknown-tool.md"
    content: |
      ---
      name: badtool
      description: 未知工具
      tools: [vault_bogus]
      ---
      

  - name: 写入定义 .lumir/agents/broken-task-tool.md
    do: vaultWrite
    file: ".lumir/agents/broken-task-tool.md"
    content: |
      ---
      name: nested
      description: 试图再次委派
      tools: [task]
      ---
      

  - name: 写入定义 .lumir/agents/field-ok.md
    do: vaultWrite
    file: ".lumir/agents/field-ok.md"
    content: |
      ---
      name: field-ok
      description: 未识别字段但定义保留
      maxTurns: 5
      ---
      

  - name: 写入定义 .lumir/agents/budget.md
    do: vaultWrite
    file: ".lumir/agents/budget.md"
    content: |
      ---
      name: budget
      description: 预算越界被夹取
      max_turns: 999
      ---
      

  - name: 写入定义 .lumir/agents/background-bool.md
    do: vaultWrite
    file: ".lumir/agents/background-bool.md"
    content: |
      ---
      name: background-bool
      description: background 类型错
      background: "yes"
      ---
      

  - name: 写入定义 .lumir/agents/dupe-b.md
    do: vaultWrite
    file: ".lumir/agents/dupe-b.md"
    content: |
      ---
      name: dupe
      description: 同层同名 B
      ---
      

  - name: 写入定义 .lumir/agents/dupe-a.md
    do: vaultWrite
    file: ".lumir/agents/dupe-a.md"
    content: |
      ---
      name: dupe
      description: 同层同名 A
      ---
      

  - name: 写入定义 .lumir/agents/research.md
    do: vaultWrite
    file: ".lumir/agents/research.md"
    content: |
      ---
      name: research
      description: vault 级同名定义
      ---
      

  - name: 写入用户级定义 research.md
    do: envWrite
    file: "agents/research.md"
    content: |
      ---
      name: research
      description: 用户级同名定义
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

  - name: 等这一轮装载完成（定义在回合开头扫描）
    do: waitFor
    waitFor:
      has: ["SGD-CHECK 定义装载完成。"]
    timeoutMs: 30000
    expect:
      - shot: 01-定义校验

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: 缺 name 的定义被丢弃 + warning
        file: { path: "env:logs/*.jsonl", has: "缺少必填字段 name" }
      - label: 未知工具名整条丢弃（fail loud）
        file: { path: "env:logs/*.jsonl", has: "字段 tools 含未知工具 vault_bogus" }
      - label: tools 含 task 整条丢弃（子代理不能再委派）
        file: { path: "env:logs/*.jsonl", has: "字段 tools 不能包含 task" }
      - label: 未识别字段 warning，定义保留
        file: { path: "env:logs/*.jsonl", has: "未识别字段 maxTurns" }
      - label: 预算越界被夹取 + warning
        file: { path: "env:logs/*.jsonl", has: "超过配置上限 20" }
      - label: background 类型错回落 false + warning
        file: { path: "env:logs/*.jsonl", has: "字段 background 必须是布尔值" }
      - label: 同层同名按字典序取第一个 + warning
        file: { path: "env:logs/*.jsonl", has: "子代理定义同名冲突（vault 级）" }
      - label: vault 覆盖用户级 + 覆盖 warning
        file: { path: "env:logs/*.jsonl", has: '/子代理定义 research 被 .* 覆盖（原来源：.*）/' }

---

# 185 —— 8.4 定义校验与优先级

坏定义各产一条点名 warning 且好定义照常；`vault > 用户级` 的覆盖与同层字典序规则各自可判。
判据取诊断日志的 `config_warning`（`source = subagents`）。M610 起面板清单区已退场，界面计数读数
一并删除——本场景只判每条坏定义的丢弃 / 降级 warning，不再单独断言「好定义保留」。