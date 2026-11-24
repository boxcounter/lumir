---
id: "728-harness-lazy-restore-view"
item: 728
tier: full
title: 查看历史零写盘：标题与通知、同源重复点击、A→B→A、空源首次发送才发布
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-lazy-send.json"
seed:
  registry:
    - { id: acc-lazy, path: $vault, lastOpenedAt: 1757000002000 }
  envFiles:
    - { path: harness/sessions/acc-lazy/s100000-lazy-a.jsonl, from: "$fixtures/lazy-restore-a.jsonl" }
    - { path: harness/sessions/acc-lazy/s200000-lazy-b.jsonl, from: "$fixtures/lazy-restore-b.jsonl" }
    - { path: harness/sessions/acc-lazy/s150000-lazy-empty.jsonl, from: "$fixtures/lazy-restore-empty.jsonl" }
steps:
  - name: 记录源 A 基线
    do: record
    file: "env:harness/sessions/acc-lazy/s100000-lazy-a.jsonl"
    as: sourceA
  - name: 记录源 B 基线
    do: record
    file: "env:harness/sessions/acc-lazy/s200000-lazy-b.jsonl"
    as: sourceB
  - name: 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
  - name: 打开历史浮层
    do: click
    target: { role: AXPopUpButton, name: "新会话" }
  - name: 查看带标题与未消费通知的 A
    do: clickInNode
    target: { role: AXMenuItem, name: "查看甲" }
  - name: 等 A 的 transcript 与通知重建
    do: waitFor
    waitFor:
      has: ["甲回答", "后台任务完成"]
    timeoutMs: 15000
    expect:
      - label: 通知恰一条，transcript 属于 A
        ax: { count: { pattern: "后台任务完成", exact: 1 } }
      - label: 查看后仍只有三份源 JSONL
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 3 }
      - label: 查看后无临时文件
        glob: { dir: "env:harness/sessions", pattern: "\\.tmp$", exact: 0 }
      - label: 源 A 字节不变
        file: { path: "env:harness/sessions/acc-lazy/s100000-lazy-a.jsonl", unchangedSince: sourceA }
      - label: 源 A mtime 不变
        file: { path: "env:harness/sessions/acc-lazy/s100000-lazy-a.jsonl", mtimeUnchangedSince: sourceA }
      - shot: 01-查看A零写盘
  - name: 再开浮层并重复点击同一 A
    do: click
    target: { role: AXPopUpButton, name: "查看甲" }
  - name: 同源 pending 复用（switched=false 只关浮层）
    do: clickInNode
    target: { role: AXMenuItem, name: "查看甲" }
  - name: 重复点击不重放、不新增
    do: settle
    expect:
      - label: 通知仍恰一条
        ax: { count: { pattern: "后台任务完成", exact: 1 } }
      - label: 目录仍三份 JSONL
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 3 }
  - name: 打开浮层切到 B
    do: click
    target: { role: AXPopUpButton, name: "查看甲" }
  - name: 查看 B
    do: clickInNode
    target: { role: AXMenuItem, name: "查看乙" }
  - name: 等 B 的 transcript
    do: waitFor
    waitFor:
      has: ["乙回答"]
    timeoutMs: 15000
    expect:
      - label: A 的旧 transcript 已替换
        ax: { not: "甲回答" }
      - label: A→B 仍零新增
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 3 }
  - name: 再切回 A
    do: click
    target: { role: AXPopUpButton, name: "查看乙" }
  - name: 查看 A
    do: clickInNode
    target: { role: AXMenuItem, name: "查看甲" }
  - name: 等 A 再次重建
    do: waitFor
    waitFor:
      has: ["甲回答"]
    timeoutMs: 15000
    expect:
      - label: A→B→A 仍零新增
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 3 }
      - label: 源 B 字节不变
        file: { path: "env:harness/sessions/acc-lazy/s200000-lazy-b.jsonl", unchangedSince: sourceB }
      - label: 源 B mtime 不变
        file: { path: "env:harness/sessions/acc-lazy/s200000-lazy-b.jsonl", mtimeUnchangedSince: sourceB }
  - name: 打开浮层选择空源
    do: click
    target: { role: AXPopUpButton, name: "查看甲" }
  - name: 查看空源（无标题无轮次，行名回落新会话）
    do: clickInNode
    target: { role: AXMenuItem, name: "^新会话$" }
  - name: 空源为空面板且零新增
    do: settle
    expect:
      - label: 空源显示空态提示
        ax: { has: "与当前文档对话" }
      - label: 空源查看仍三份 JSONL
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 3 }
  - name: 在空源里输入首条真实消息
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|空源首问" }
    text: "空源首问"
  - name: 发送
    do: key
    key: enter
  - name: 等首次真实回答（此时才发布）
    do: waitFor
    waitFor:
      has: ["LAZY-OK"]
    timeoutMs: 30000
    expect:
      - label: 首次发送后恰增加一份恢复文件
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 4 }
      - label: 恢复谱系指向空源
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"restored_from":"s150000-lazy-empty"' }
      - label: 空源初始批次只有 open + 一对请求响应
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"llm_request"', exact: 1 } }
      - shot: 02-空源首发
---

# 728 —— 查看零写盘

纯查看只重建内存投影。A/B 都有有效标题与未消费通知，用来证明非空 view 元数据也不会提前构造或发布初始批次。
同源重复点击的可观测判据是通知与 transcript 不重复；id / token 稳定性由 Rust 测试承担，真机不声称能读取 pending token。
