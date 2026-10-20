---
id: "209-cron-register-reject"
item: 209
title: 拒绝注册不落盘：同一轮里另一条已采纳的任务必须在文件里（正观测）（tasks §8.3）
open: harness-note.md
marker: "HNL-ALPHA"
# 同一轮工具循环里两次 cron_task_create：第一条采纳、第二条拒绝。
# 「拒绝不落盘」的区分度靠第一条：它必须真的写进配置（文件可写 + 工具能执行），
# 因此第二条缺席不是「根本写不进去」。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron-register-reject.json"
steps:
  - name: 记下批准前的配置基线
    do: record
    as: configBefore
    file: "env:config.json"

  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 抢前台（键盘注入的前台纪律）
    do: focusWindow
    retries: 4

  - name: 输入「建两条任务」并 Enter 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|cronrej" }
    text: "cronrej"
  - name: 发送
    do: key
    key: enter

  - name: 等第一张批准卡（acc-cron-keep）
    do: waitFor
    waitFor:
      has: ["CRON-KEEP-PROBE 这一条采纳后必须落盘。"]
    expect:
      - label: 第一张批准卡在场
        ax: { has: "要执行这次 cron_task_create 调用吗？" }
      - label: 卡上是第一条任务的身份（acc-cron-keep）
        ax: { has: '/cron_task_create\s*acc-cron-keep\s*\d{2}:\d{2}/' }
      - shot: 01-第一张卡

  - name: 采纳第一条
    do: click
    target: { role: AXButton, name: "^采纳$" }

  - name: 等第二张批准卡（acc-cron-drop）
    do: waitFor
    waitFor:
      has: ["CRON-DROP-PROBE 这一条拒绝后不得落盘。"]
    expect:
      - label: 第二张批准卡在场
        ax: { has: "要执行这次 cron_task_create 调用吗？" }
      - label: 卡上是第二条任务的身份（acc-cron-drop）
        ax: { has: '/cron_task_create\s*acc-cron-drop\s*\d{2}:\d{2}/' }
      - label: 第一条已落盘（拒绝前的正观测：文件可写、工具能执行）
        file: { path: "env:config.json", has: '"id": "acc-cron-keep"' }
      - shot: 02-第二张卡

  - name: 拒绝第二条
    do: click
    target: { role: AXButton, name: "^拒绝$" }

  - name: 等循环收尾（拒绝回送模型 → 最终回答）
    do: waitFor
    waitFor:
      has: ["一条采纳、一条拒绝。"]
    expect:
      - label: 采纳的那条在配置里
        file: { path: "env:config.json", has: '"id": "acc-cron-keep"' }
      - label: 拒绝的那条不在配置里（拒绝 = 工具从未执行）
        file: { path: "env:config.json", not: "acc-cron-drop" }
      - label: 「不落盘」不是「文件没被写过」——配置相对基线变了
        file: { path: "env:config.json", changedSince: configBefore }
      - label: 采纳的那条落了注册事件
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_task_registered, task: acc-cron-keep }
      - label: 拒绝的那条零注册事件（行数精确 0）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '/cron_task_registered[^}]*acc-cron-drop/', exact: 0 }
      - label: 拒绝的那条也没有拒绝码事件——它根本没进执行侧
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '/cron_task_rejected[^}]*acc-cron-drop/', exact: 0 }
      - shot: 03-决策后
---

# 209-cron-register-reject —— 拒绝不落盘（tasks §8.3）

## 本场景在验什么

批准卡点「拒绝」⇒ 工具不执行 ⇒ 配置里没有这条任务、没有 `cron_task_registered`、模型收到
拒绝结果后继续收尾（面板出现最终回答）。

## 区分度（本场景的核心）

「拒绝的那条不在文件里」单独拿出来是弱判据：文件根本写不进去时它同样成立。因此同一轮里
**先采纳一条、再拒绝一条**：

- 采纳的那条必须出现在配置里，并且配置相对批准前基线**变过**（`record` + `changedSince`）——
  证明「文件可写 + 工具能执行 + 写真的发生」；
- 拒绝的那条在配置里缺席、日志里零 `cron_task_registered` / 零 `cron_task_rejected`——
  它从未进执行侧（拒绝不是工具级错误，`cron_task_rejected` 是校验 / 重名 / 落盘失败专用）。

## 环境与边界

合成 vault + 隔离 `XDG_CONFIG_HOME`；`at` 写 `$nextMinute`（fixture 记号），本场景在到点前结束，
通知不参与判定。
