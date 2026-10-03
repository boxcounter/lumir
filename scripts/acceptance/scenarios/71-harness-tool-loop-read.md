---
id: "71-harness-tool-loop-read"
item: 71
title: Harness ② 工具循环：vault_read 读文件并回答（change add-harness-probe，mock provider）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-read.json"
steps:
  - name: ⌘⇧A 唤起面板
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 面板出现
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问并 Enter 发送
    do: keys
    keys: ["r", "e", "a", "d", "i", "t"]
  - name: 发送
    do: key
    key: enter

  - name: 等工具循环跑完（vault_read → 回送 → 最终回答）
    do: waitFor
    waitFor:
      has: ["HNL 读完了：阿尔法行在，贝塔行在，伽马行在。"]
    expect:
      - label: 工具完成行可见（面板可见「调用了什么工具」）
        ax: { has: "工具完成：vault_read — 成功" }
      - label: 最终回答渲染
        ax: { has: "HNL 读完了：阿尔法行在，贝塔行在，伽马行在。" }
      - label: 读类工具默认 allow——全程没有批准闸（负向断言的正观测 = 上面两条）
        ax: { not: "采纳后才落盘" }
      - label: JSONL 记下这次工具调用且 decision=allow
        file: { path: "env:harness/*.jsonl", has: '"decision":"allow","id":"call_1","kind":"tool_call","name":"vault_read"' }
      - label: 工具结果（文件内容）回送了模型
        file: { path: "env:harness/*.jsonl", has: '"id":"call_1","kind":"tool_result","ok":true' }
      - shot: 01-工具循环完成
---

spec 判据（harness「工具循环 · 多轮工具往返」+「权限机制 · 默认分层生效」的读侧）：
模型返回 vault_read 调用 → 系统执行读取 → 内容回送 → 继续生成最终回答；面板可见
「调用了什么工具」；读类工具默认 allow 不进批准闸。工具循环的两段响应都编在
harness-mock-read.json 里（mock 每次发送从头弹脚本，一个场景只发一次问）。
