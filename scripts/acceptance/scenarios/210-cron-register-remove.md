---
id: "210-cron-register-remove"
item: 210
title: 对话删除任务：配置退场、cron_task_removed、到点不再通知（对照组照常响）（tasks §8.4）
open: harness-note.md
marker: "HNL-ALPHA"
# 对照任务 acc-cron-keep-control 预置在配置里（同一分钟到点）：它的通知是本场景「到点
# 判定确实跑过」的正观测——被删的 acc-cron-doomed 在同一个 tick 里没有响，才说明删除生效，
# 而不是「这个时刻根本没人评估」。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron-remove.json"
  cron:
    tasks:
      - id: "acc-cron-keep-control"
        vault: "$vault"
        at: "$nextMinute"
        prompt: "CRON-KEEP-CONTROL-PROBE 对照组：到点照常投通知。"
        delivery: "notify-then-run"
        session: "new"
steps:
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

  - name: 输入「建一条再删掉」并 Enter 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|crondel" }
    text: "crondel"
  - name: 发送
    do: key
    key: enter

  - name: 等建任务批准卡
    do: waitFor
    waitFor:
      has: ["CRON-DOOMED-PROBE 建了马上删，到点不该响。"]
    expect:
      - label: 建任务批准卡在场
        ax: { has: "要执行这次 cron_task_create 调用吗？" }
      - label: 卡上是待删任务的身份（acc-cron-doomed）
        ax: { has: '/cron_task_create\s*acc-cron-doomed\s*\d{2}:\d{2}/' }
      - shot: 01-建任务卡

  - name: 采纳建任务
    do: click
    target: { role: AXButton, name: "^采纳$" }

  - name: 等删除批准卡（工具循环的第二步）
    do: waitFor
    waitFor:
      has: ["要执行这次 cron_task_remove 调用吗？"]
    expect:
      - label: 删除批准卡在场（D415 回落句）
        ax: { has: "要执行这次 cron_task_remove 调用吗？" }
      - label: 卡上是要删的任务（任务行 D528 + 时间 D523）
        ax: { has: '/cron_task_remove\s*acc-cron-doomed/' }
      - label: 删除后果说明在场（D536：删除后不再触发）
        ax: { has: "删除后不再触发" }
      - label: 删除前配置里该任务在场（正观测：下一条的「退场」有东西可退）
        file: { path: "env:config.json", has: '"id": "acc-cron-doomed"' }
      - shot: 02-删除卡

  - name: 采纳删除
    do: click
    target: { role: AXButton, name: "^采纳$" }

  - name: 等循环收尾
    do: waitFor
    waitFor:
      has: ["任务已删除。"]
    expect:
      - label: 配置里不再有该任务
        file: { path: "env:config.json", not: "acc-cron-doomed" }
      - label: 对照组仍在配置里（删除不碰别的任务）
        file: { path: "env:config.json", has: '"id": "acc-cron-keep-control"' }
      - label: 删除诊断事件：cron_task_removed（运行时确认生效）
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_task_removed, task: acc-cron-doomed, effect: active }
      - shot: 03-删除后

  - name: 等到点：对照组通知落盘（证明这个时刻确实评估过）
    # 同 207：等日志事件（投递成功才写），不等横幅——横幅的 AX 树里存着上一批同标题的通知。
    # 「被删任务零通知」这条负向判据因此有真正的区分度：这一刻确实评估过，且对照组响了。
    do: waitForFile
    waitForFile:
      path: "env:logs/*.jsonl"
      jsonl: { event: cron_notified, task: acc-cron-keep-control, kind: trigger }
    timeoutMs: 180000
    expect:
      - label: 对照组到点通知已投递（到点判定跑过 —— 区分度正观测）
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_notified, task: acc-cron-keep-control, kind: trigger }
      - label: 被删任务到点后零通知（行数精确 0）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '/cron_notified[^}]*acc-cron-doomed/', exact: 0 }
      - label: 未点击 ⇒ 零运行
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started"', exact: 0 }
      - shot: 04-对照组到点
---

# 210-cron-register-remove —— 对话删除任务（tasks §8.4）

## 本场景在验什么

先经对话建一条任务（`acc-cron-doomed`，`$nextMinute` 到点），再经对话删除它：
`cron_task_removed(effect=active)`、配置里退场、到点后没有任何通知。

## 区分度（删除的「不响」怎么证明）

「删掉的任务没响」在「这个时刻什么都没评估」时同样成立。因此配置里预置一条同分钟到点的
**对照任务**（`acc-cron-keep-control`）：它的 `cron_notified` 必须落盘（`waitForFile` 等这一条
日志事件），证明到达同一个 tick；同一份日志里按任务 id 计数——对照组 1 条、被删任务 0 条。

## 时序前提

建与删都在到点之前完成（`$nextMinute` 至少 60s 后到点，两步批准各一次点击）。若删除晚于
到点，被删任务会先响一次，场景按 FAIL 如实判红——那是「删除前已经触发过」的真实时序问题，
不是套件假判。

## 环境与边界

合成 vault + 隔离 `XDG_CONFIG_HOME`；到点判定取应用日志（`cron_notified`），不依赖通知横幅
是否上屏——横幅的 AX 树里存着更早一次 run 的同标题通知，拿它当等待条件会抢跑（207 首跑实测；
M617 起 `waitForNotification` 已带新鲜度基线，本场景的判据仍是应用日志）。
