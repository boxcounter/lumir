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
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位
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
      - label: 工具行带人话化参数（M406 三段式：名徽章 + 参数——vault_read 上屏路径，JSON 原文不上屏）
        ax: { has: '/vault_read\s*harness-note\.md/' }
      - label: 参数摘要的 JSON 原文不上屏（人话化取代摘要原文；区分度锚——旧形态必带这段 JSON）
        ax: { not: '{"path":"harness-note.md"}' }
      - label: 最终回答渲染
        ax: { has: "HNL 读完了：阿尔法行在，贝塔行在，伽马行在。" }
      - label: 读类工具默认 allow——全程没有批准闸（负向断言的正观测 = 上面两条）
        ax: { not: "要修改这个文件吗？" }
      - label: 读类工具默认 allow——命令类闸问句也不在场（D340）
        ax: { not: "要运行这条命令吗？" }
      - label: JSONL 记下这次工具调用（wire 口径：llm_response 的 tool_calls）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*"kind":"llm_response".*"id":"call_1","name":"vault_read".*$/' }
      - label: 工具结果（文件内容）回送了模型（function_call_output 项）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*"call_id":"call_1".*HNL-ALPHA.*"type":"function_call_output".*$/' }
      - shot: 01-工具循环完成
---

spec 判据（harness「工具循环 · 多轮工具往返」+「权限机制 · 默认分层生效」的读侧）：
模型返回 vault_read 调用 → 系统执行读取 → 内容回送 → 继续生成最终回答；面板可见
「调用了什么工具、带了什么参数」（M406 起工具行是「名徽章 + 人话化参数」的三段式——
vault_read 上屏提取出的路径，参数 JSON 原文不上屏；人话化判据本体在
tests/unit/harness-restore.test.ts 的 humanizeToolArgs 系）；读类工具默认 allow 不进
批准闸。工具循环的两段响应都编在 harness-mock-read.json 里（mock 每次发送从头弹脚本，
一个场景只发一次问）。
