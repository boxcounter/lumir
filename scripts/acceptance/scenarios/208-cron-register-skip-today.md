---
id: "208-cron-register-skip-today"
item: 208
tier: full
title: 注册日不补触发：已过点注册写当日种子，切前台 / 重启都不投递（tasks §8.2）
open: harness-note.md
marker: "HNL-ALPHA"
# 对照组（acc-cron-control，启动即到点）是本场景的**区分度正观测**：它证明调度线程在跑、
# 到点通知会投递、日志通路通着。注册任务（acc-cron-skip）的 at 是「今日已过」——注册时
# 被种子挡掉，此后多次切前台 + restart 都不得投递。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron-register-skip.json"
  cron:
    tasks:
      - id: "acc-cron-control"
        vault: "$vault"
        at: "$pastMinute"
        prompt: "CRON-CONTROL-PROBE 对照组：到点投通知。"
        delivery: "notify-then-run"
        session: "new"
steps:
  - name: 启动后的拉取触发：对照组照常投递（正观测）
    do: sleep
    ms: 30000
    expect:
      - label: 对照组到点通知已投递（调度线程与日志通路活着的证据）
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_notified, task: acc-cron-control, kind: trigger }
      - label: 注册任务此刻还不存在（本场景从「只有对照组」的状态起）
        file: { path: "env:config.json", not: "acc-cron-skip" }

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

  - name: 输入「建一条今天已过点的任务」并 Enter 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|crondedup" }
    text: "crondedup"
  - name: 发送
    do: key
    key: enter

  - name: 等批准卡出现
    do: waitFor
    waitFor:
      has: ["要执行这次 cron_task_create 调用吗？"]
    expect:
      - label: 批准卡问句在场
        ax: { has: "要执行这次 cron_task_create 调用吗？" }
      - label: 注册日口径：今天已过点，注册后今天不再触发（D534，skip_today=true）
        ax: { has: "今天已过点，注册后今天不再触发" }
      - label: prompt 全文在卡上
        ax: { has: "CRON-SKIP-PROBE 注册日不补触发：这条今天不该再响。" }
      - shot: 01-已过点批准卡

  - name: 采纳注册
    do: click
    target: { role: AXButton, name: "^采纳$" }

  - name: 等循环收尾
    do: waitFor
    waitFor:
      has: ["任务已注册，今天不再触发。"]
    expect:
      - label: 注册诊断事件：cron_task_registered(skip_today=true)
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_task_registered, task: acc-cron-skip, skip_today: "true" }
      - label: 注册即写当日种子（cron-state.json 里该任务今日 last_fired）
        file:
          path: "env:cron-state.json"
          has: '/"acc-cron-skip":\s*\{\s*"last_fired":\s*"\d{4}-\d{2}-\d{2}"/'
      - label: 配置里两条任务都在（新增不覆盖对照组）
        file: { path: "env:config.json", has: '"id": "acc-cron-skip"' }
      - label: 对照组仍在配置里
        file: { path: "env:config.json", has: '"id": "acc-cron-control"' }
      - shot: 02-注册后

  - name: 切前台（焦点拉取触发，评估一次）
    do: focusWindow
    retries: 4
  - name: 再切一次前台
    do: focusWindow
    retries: 4

  - name: 重启应用（启动补触发必须被注册日种子挡住）
    do: restart

  - name: 重启后等启动补触发与 tick 评估
    do: sleep
    ms: 20000
    expect:
      - label: 注册任务全程零通知（多次切前台 + 重启都不补触发）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '/cron_notified[^}]*acc-cron-skip/', exact: 0 }
      - label: 对照组也只投递过一次（重启不重复——同日去重，正观测仍在）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '/cron_notified[^}]*acc-cron-control/', exact: 1 }
      - label: 未点击 ⇒ 全程零运行
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started"', exact: 0 }
      - shot: 03-重启后
---

# 208-cron-register-skip-today —— 注册日不补触发（tasks §8.2）

## 本场景在验什么

`at` 是**今日已过**的任务在对话里注册：批准卡必须如实给出「今天已过点，注册后今天不再触发」，
采纳后写当日种子（`cron_task_registered(skip_today=true)` + `cron-state.json` 今日 `last_fired`），
此后多次切前台（焦点拉取触发）与 `restart`（启动补触发）都不得投递该任务的通知。

## 区分度（负向断言的正观测）

「零通知」在调度线程完全没跑时也成立，因此本场景在配置里预置了一条**对照组**
（`acc-cron-control`，今日已过时刻、启动即到点）：它的 `cron_notified` 必须恰投递一次。
这一条同时证明三件事——线程在跑、到点判定成立、日志在记。注册任务与对照组在同一份日志里
按任务 id 分开计数（`cron_notified` 行内任务名），「有 / 没有」因此有区分度。

## `at` 与时间口径

fixture 里的 `at` 写 `$pastMinute`（写入配置时刻的前一分钟），对照组同理；两者都不写死时刻，
跨天重跑成立。

## 环境与边界

合成 vault + 隔离 `XDG_CONFIG_HOME`；通知横幅不上屏也能判定（判据是应用日志与状态文件，
横幅像素不是判据）。
