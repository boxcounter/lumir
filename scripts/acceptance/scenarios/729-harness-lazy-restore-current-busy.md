---
id: "729-harness-lazy-restore-current-busy"
item: 729
tier: full
title: 当前已发布文件直切：空闲与 busy 均成功，busy 切换另一历史被拒且零副作用
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-lazy-busy.json"
seed:
  registry:
    - { id: acc-lazy, path: $vault, lastOpenedAt: 1757000002000 }
  envFiles:
    - { path: harness/sessions/acc-lazy/s200000-lazy-b.jsonl, from: "$fixtures/lazy-restore-b.jsonl" }
steps:
  - name: 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
  - name: 发送首轮建立当前已发布文件
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|BUSY-ONE" }
    text: "BUSY-ONE"
  - name: 发送
    do: key
    key: enter
  - name: 等首轮完成
    do: waitFor
    waitFor:
      has: ["BUSY-BASE"]
    timeoutMs: 30000
  - name: 发送慢第二轮撑开 busy 窗口
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|BUSY-TWO" }
    text: "BUSY-TWO"
  - name: 发送
    do: key
    key: enter
  - name: 等 busy 出现
    do: waitFor
    waitFor:
      has: ["/AXButton \\(停止\\)/"]
    timeoutMs: 10000
  - name: busy 下打开历史浮层
    do: click
    target: { role: AXPopUpButton, name: "BUSY-ONE" }
  - name: 点击另一历史 B（真正切换，应被拒）
    do: clickInNode
    target: { role: AXMenuItem, name: "查看乙" }
  - name: 等 busy 错误
    do: waitFor
    waitFor:
      has: ["对话正在处理中"]
    timeoutMs: 10000
    expect:
      - label: 原 transcript 未丢
        ax: { has: "BUSY-BASE" }
      - label: busy 切换没有新增文件
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 2 }
  - name: busy 下再开浮层
    do: click
    target: { role: AXPopUpButton, name: "BUSY-ONE" }
  - name: 点击当前已发布文件（switched=false，应成功）
    do: clickInNode
    target: { role: AXMenuItem, name: "BUSY-ONE" }
  - name: 当前项直切零副作用
    do: settle
    expect:
      - label: 没有 busy 错误
        ax: { not: "对话正在处理中" }
      - label: 原 transcript 未重放或清空
        ax: { has: "BUSY-BASE" }
      - label: 不 fork、不新增文件
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 2 }
      - shot: 01-busy当前项直切
---

# 729 —— 当前项 busy 直切

第二条 mock 响应延迟 12 秒。busy 下点击另一历史必须报 `harness_busy`；点击当前文件则在 busy 判定之前按身份直切成功。
