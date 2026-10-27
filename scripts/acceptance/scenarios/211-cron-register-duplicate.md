---
id: "211-cron-register-duplicate"
item: 211
tier: full
title: 重名拒绝：cron_task_exists、配置逐字节不变、面板工具行显示错误摘要（tasks §8.5）
open: harness-note.md
marker: "HNL-ALPHA"
# 既有任务预置在配置里（id = acc-cron-dup）：对话里再建同名任务，create 必须在执行期
# 被拒（工具不静默覆盖），配置逐字节不变。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron-duplicate.json"
  cron:
    tasks:
      - id: "acc-cron-dup"
        vault: "$vault"
        at: "$nextMinute"
        prompt: "CRON-DUP-SEED 既有任务，重名者不得覆盖。"
        delivery: "notify-then-run"
        session: "new"
steps:
  - name: 记下配置基线（sha256 + mtime——「没落盘」的双判据）
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

  - name: 输入「再建一条同名任务」并 Enter 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|crondedup" }
    text: "crondedup"
  - name: 发送
    do: key
    key: enter

  - name: 等批准卡（预览不校验重名——重名在执行期才判）
    do: waitFor
    waitFor:
      has: ["CRON-DUP-PROBE 重名必须被拒。"]
    expect:
      - label: 批准卡在场（同名任务也会先给卡，判在采纳后的执行期）
        ax: { has: "要执行这次 cron_task_create 调用吗？" }
      - label: 卡上是重名任务的身份
        ax: { has: '/cron_task_create\s*acc-cron-dup\s*\d{2}:\d{2}/' }
      - shot: 01-重名批准卡

  - name: 采纳（执行期应被 cron_task_exists 拒掉）
    do: click
    target: { role: AXButton, name: "^采纳$" }

  - name: 等循环收尾（错误回送模型 → 最终回答）
    do: waitFor
    waitFor:
      has: ["重名被拒了。"]
    expect:
      - label: 面板工具行显示错误摘要（工具名 + 错误码）
        ax: { has: "/error · cron_task_exists/" }
      - label: 错误摘要里带既有任务的时间（指出冲突的是哪一条）
        ax: { has: "已存在（at = " }
      - label: 配置逐字节不变（工具不静默覆盖）
        file: { path: "env:config.json", unchangedSince: configBefore }
      - label: 配置 mtime 也未推进（写同一份内容也会推开 mtime，双判据）
        file: { path: "env:config.json", mtimeUnchangedSince: configBefore }
      - label: 文件里仍只有一条该 id（没有出现第二条同 id 项）
        file:
          path: "env:config.json"
          count: { pattern: '"id": "acc-cron-dup"', exact: 1 }
      - label: 既有任务的 prompt 原样保留（没被新参数覆盖）
        file: { path: "env:config.json", has: "CRON-DUP-SEED 既有任务，重名者不得覆盖。" }
      - label: 诊断事件：cron_task_rejected(code=cron_task_exists)
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_task_rejected, task: acc-cron-dup, code: cron_task_exists }
      - label: 没有落「注册成功」（失败路径不得有假记录）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '/cron_task_registered[^}]*acc-cron-dup/', exact: 0 }
      - shot: 02-重名被拒
---

# 211-cron-register-duplicate —— 重名拒绝（tasks §8.5）

## 本场景在验什么

对已存在 `id` 再 `cron_task_create`：批准卡照常出（预览不校验——校验在执行侧），采纳后执行期
返回 `cron_task_exists`（带既有任务的 `at`），配置逐字节不变，面板工具行显示
`error · cron_task_exists: …` 摘要，模型收到错误后继续收尾。

## 判据的区分度

- 「配置逐字节不变」用 `unchangedSince` + `mtimeUnchangedSince` 成对：只比 sha256 时，
  「写了同一份内容」与「根本没写」分不出来；mtime 未推进才证明写从未发生。
- 「没有第二条同 id」用行数精确 1：配置是 pretty JSON、一个任务一个 `"id"` 行，重名写进去
  会变成 2 行。
- 「没有假记录」：`cron_task_registered` 行数精确 0（失败路径不得落注册成功）。

## 环境与边界

合成 vault + 隔离 `XDG_CONFIG_HOME`；`at` 写 `$nextMinute`（既有任务与创建尝试都按写入时刻
换算），场景在到点前结束，通知不参与判定。
