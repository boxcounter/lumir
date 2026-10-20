---
id: "171-cron-run-then-notify"
item: 171
title: run-then-notify：到点静默运行、终态后投递结果通知、点击结果通知恢复会话（§7.3）
# 同 170：点击结果通知恢复会话只能在打包实例上判（dev flavour 的点击响应路由到 Terminal）。
requires: bundle
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron.json"
  cron:
    tasks:
      - id: "acc-cron-run"
        vault: "$vault"
        # 同 170：通知必须落在套件开始轮询之后（横幅只停留约 5s，`$pastMinute` 会与就绪门赛跑）。
        at: "$nextMinute"
        prompt: "CRON-PROBE-RUNTHEN 后台运行，不要出现在用户当前会话里。"
        delivery: "run-then-notify"
        session: "new"
steps:
  - name: 等结果通知横幅出现（后台运行完成后的「已完成」通知）
    do: waitForNotification
    title: "acc-cron-run"
    body: "已完成"
    # `$nextMinute` 最坏是「写入时刻 + 60s 再向上取整」≈120s，再加 30s tick 余量。
    timeoutMs: 180000
    expect:
      - label: 后台运行已发起（无用户点击）
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_run_started }
      - label: 运行终态 ok=true
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_run_finished, ok: "true" }
      - label: 终态后投递了结果通知（kind=result）
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_notified, kind: result }
      - label: run-then-notify 不投「到点」通知
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '/^.*"event":"cron_notified".*"kind":"trigger".*$/', exact: 0 }
      - label: 任务的 prompt 进入后台会话的留存（per-vault 布局）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "CRON-PROBE-RUNTHEN" }
      - label: 用户当前会话 / 界面没有被后台运行的 prompt 污染
        ax: { not: "CRON-PROBE-RUNTHEN" }
      - shot: 运行完成后的界面

  - name: 点击结果通知横幅（系统通知中心 AXPress = 真实点击）
    do: clickNotification
    title: "acc-cron-run"
    body: "已完成"

  - name: 等点击恢复该次运行的会话（prompt 出现在面板上）
    do: waitFor
    waitFor:
      has: ["CRON-PROBE-RUNTHEN"]
    timeoutMs: 30000
    expect:
      - label: 点击链路被处理（cron_click ok=true, action=open-session）
        file:
          path: "env:logs/*.jsonl"
          # 字段序无关（M612）：serde_json 按字母序落盘（action→event→ok→task）。
          jsonl: { event: cron_click, task: acc-cron-run, ok: "true", action: open-session }
      - label: 点击不重跑（全程 cron_run_started 恰好一条）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started"', exact: 1 }
      - label: 面板显示该次运行的 prompt（会话被恢复）
        ax: { has: "CRON-PROBE-RUNTHEN" }
      - shot: 点击结果通知后的会话
---

# 171-cron-run-then-notify —— run-then-notify 与结果通知点击（§7.3）

## 本场景在验什么

`run-then-notify` 的到点语义是「无『到点』通知、静默发起运行、终态后投递结果通知」，再加上
点击结果通知恢复该次会话、**不重跑**：

1. 到点后台运行（无用户点击）→ `cron_run_started` → `cron_run_finished(ok=true)`；
2. 终态后投递 `cron_notified(kind=result)`，且全程没有 `kind=trigger` 通知；
3. 后台会话落在 `env:harness/sessions/<vault id>/`，而用户当前会话不被 prompt 污染；
4. 点击结果通知 → `cron_click(ok=true, action=open-session)`，面板显示该次运行的 prompt，
   且 `cron_run_started` 仍为一条（点击不重跑）。

运行槽位与交互会话槽位分离的机器判据在 Rust 契约测试
（`run_slot_does_not_touch_the_interactive_session`），本场景补真机侧证据。

## 点击怎么驱动（§7.7 的兑现方式）

与场景 170 同一通道：`do: waitForNotification` 轮询系统通知中心，按「标题 = 任务 id、
正文 = 已完成」定位结果通知条目（同任务的 trigger 通知只有一条 `到点`，正文可区分两档）；
横幅在场后先判运行侧六条，再用 `do: clickNotification` 发 `AXPress`。横幅只在屏上停留数秒，
因此「先睡 50s 再点」的旧写法不可用——等待由 `waitForNotification` 自己完成。新鲜度口径与
170 相同（M617）：等待只认动作开始之后新出现的条目，点击沿用同一基线，不点上一轮 run 的旧通知。

## 已知边界

- 结果通知的正文只有「已完成 / 运行失败」（design §5.2），不含 prompt 与会话 id；点击恢复靠
  `extra` 里的 `session_id`，其读取链路由 Rust 侧实现覆盖，本场景只判用户面后果（会话被恢复）。
