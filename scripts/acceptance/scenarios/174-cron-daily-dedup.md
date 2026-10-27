---
id: "174-cron-daily-dedup"
item: 174
title: 当日去重：通知一次后重启 + 多次切前台不再投递（§7.6）
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron.json"
  cron:
    tasks:
      - id: "acc-cron-dedup"
        vault: "$vault"
        at: "$pastMinute"
        prompt: "CRON-PROBE-DEDUP 今天只提醒一次。"
        delivery: "notify-then-run"
        session: "new"
steps:
  # 正向等待（M746）：`at: $pastMinute` 已过点，启动拉取在 app 就绪后几秒内就派发；
  # 等 `cron_notified` 落盘即可（判据与下面的 `file` 断言同源），不再按固定 35s 猜
  # 「启动 + 拉取 + 投递」的时长。首条落地即断言「恰一条」只覆盖到当下；重启与切前台
  # 两步会重新复核总数，重复投递在那里翻红。
  - name: 启动后的拉取触发：投递第一条（也是唯一一条）通知
    do: waitForFile
    waitForFile:
      path: "env:logs/*.jsonl"
      jsonl: { event: cron_notified, task: acc-cron-dedup, kind: trigger }
    timeoutMs: 60000
    expect:
      - label: 到点通知已投递（首条；「全程恰一条」由后两步复核）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '/^.*"event":"cron_notified".*"kind":"trigger".*$/', exact: 1 }
      - label: cron-state.json 记录了今日 last_fired
        file:
          path: "env:cron-state.json"
          has: '/"last_fired":\s*"\d{4}-\d{2}-\d{2}"/'

  - name: 重启应用（启动补触发必须被当日去重挡住）
    do: restart
  # 纯负向等待，**不能**事件化（M746 核实）：当日去重命中时 `cron::plan` 返回 `Plan::Idle`，
  # `dispatch` 不为它落任何事件——「正确地什么都没做」在磁盘上没有正向见证。窗口取 40s ≈
  # 启动拉取（秒级）之后的第一个 30s tick，覆盖「重启绕过去重、补触发或定时器又投一次」
  # 两条路径；缩短到 tick 以下就测不到定时器那条。
  - name: 等待重启后的启动补触发与 tick 评估（有界负观察窗 40s）
    do: sleep
    ms: 40000
    expect:
      - label: 重启后仍只有一条 trigger 通知（当日已触发不重复）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '/^.*"event":"cron_notified".*"kind":"trigger".*$/', exact: 1 }
      - label: last_fired 保持今日（未被改写 / 未清空）
        file:
          path: "env:cron-state.json"
          has: '/"last_fired":\s*"\d{4}-\d{2}-\d{2}"/'
      - label: 未点击 ⇒ 全程零运行
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started"', exact: 0 }
      - shot: 重启后的界面

  - name: 多次切前台（焦点触发不重复判定 / 不重复投递）
    do: focusWindow
  - name: 再切一次前台
    do: focusWindow
  # 负向证据的有界观察窗（M746）：焦点触发被去重挡住时同样**不落任何日志**（`Plan::Idle`），
  # 没有正向锚点可等。原来的写法在两个 `focusWindow` 返回后立即断言，等于在 t+0 上判
  # 「没有第二次投递」——判据本身成立，但没有任何机会撞上慢一点的回归。3s 覆盖焦点合并
  # （200ms）+ 投递 + 日志批量落盘（200ms）这条路径。
  - name: 有界负观察窗 3s：焦点触发不该补投 / 补跑
    do: sleep
    ms: 3000
    expect:
      - label: 焦点触发没有产生第二条 trigger 通知
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '/^.*"event":"cron_notified".*"kind":"trigger".*$/', exact: 1 }
      - label: 也没有因此发起运行
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started"', exact: 0 }
---

说明（§7.6）：`at` = 今日已过时刻、状态文件在场景开始前被清空。第一条 trigger 通知投递成功后
`last_fired` 写今日；重启（启动补触发）与多次切前台（焦点拉取触发）都必须被同一份去重状态
挡住。判据用 `file.count` 的精确行数（1 条），不用 `has` 的有无——后者区分不出「多投了一次」。
横幅数量在 DND 下不可见（§7.7 边界），本场景以日志条数 + `last_fired` 为客观判据。

**等待口径（M746）**：唯一能等的正向事件是第一条 `cron_notified`（`waitForFile`）；后两段是
纯负向等待——去重命中时 `cron::plan` 是 `Plan::Idle`，不落任何事件，磁盘上没有正向见证。因此
重启后留 40s（≈一个 30s tick，覆盖定时器路径）、切前台后留 3s（覆盖焦点合并 + 投递 + 日志
落盘），都是有界观察窗，不是猜时长。依据见 README 的「cron 场景的等待口径」节。
