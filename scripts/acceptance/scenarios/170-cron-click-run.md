---
id: "170-cron-click-run"
item: 170
tier: bundle
title: 点击通知发起运行：click = intent（通知中心 AXPress 点横幅；§7.2）
# 通知点击只能判在打包实例上：dev flavour 把通知归属写成 com.apple.Terminal，点击响应到不了
# 本进程（README「实例 flavour」）。dev 下 runner 直接标 INVALID，不产出假 FAIL。
requires: bundle
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron.json"
  # `$nextMinute` = 写入配置之后至少 60s 的下一个分钟边界：通知必须在**套件开始轮询之后**才
  # 出现。用 `$pastMinute` 会让启动拉取立刻到点，而横幅只停留约 5s、套件就绪门还要几秒——
  # 2026-10-19 首跑实测：通知 08:41:09 上屏、场景 08:41:16 才开始轮询，横幅已消失（M605）。
  cron:
    tasks:
      - id: "acc-cron-click"
        vault: "$vault"
        at: "$nextMinute"
        prompt: "CRON-PROBE-CLICK 点击通知后应当运行这一条。"
        delivery: "notify-then-run"
        session: "new"
steps:
  - name: 等「到点」通知横幅出现（到点后 30s tick 内投递；未点击前不运行）
    do: waitForNotification
    title: "acc-cron-click"
    body: "到点"
    # `$nextMinute` 最坏是「写入时刻 + 60s 再向上取整」≈120s，再加 30s tick 余量；90s 不够。
    timeoutMs: 180000
    expect:
      - label: 未点击 ⇒ 没有 cron_run_started（无模型请求）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started"', exact: 0 }
      - shot: 通知已投递（Lumir 窗口；横幅属系统通知中心，不在窗口内）

  # 日志是**批量落盘**（`logging.rs` 的 200ms 静默期）：横幅上屏由 usernoted 异步完成，可能早于
  # `cron_notified` 这一行落盘。M622 首跑实测：waitForNotification 返回时日志只有 6 行启动事件、
  # 没有 cron_notified（通知本体已投递、点击链路随后全 PASS）⇒ 等日志事件要直接轮询那份日志，
  # 不要拿「横幅已出现」当「日志已落盘」（README「waitForFile」条）。
  - name: 等到点投递事件落盘（cron_notified trigger）
    do: waitForFile
    waitForFile:
      path: "env:logs/*.jsonl"
      jsonl: { event: cron_notified, kind: trigger }
    timeoutMs: 30000
    expect:
      - label: 到点通知已投递
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_notified, kind: trigger }

  - name: 点击通知横幅本体（系统通知中心 AXPress = 真实点击）
    do: clickNotification
    title: "acc-cron-click"
    body: "到点"

  - name: 等点击发起的运行完成（prompt 与 mock 回答出现在交互会话里）
    do: waitFor
    waitFor:
      has: ["CRON-PROBE-CLICK", "cron 验收回答：任务已完成。"]
    timeoutMs: 40000
    expect:
      - label: 点击链路被处理（cron_click ok=true, action=run）
        file:
          path: "env:logs/*.jsonl"
          # 字段序无关（M612）：serde_json 按字母序落盘（action→event→ok→task），写死顺序的正则
          # 永不命中。逐字段断言，别回到「按序列化顺序拼正则」的写法。
          jsonl: { event: cron_click, task: acc-cron-click, ok: "true", action: run }
      - label: 点击后运行已发起（不是到点自动运行）
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_run_started }
      - label: 运行终态 ok=true
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_run_finished, ok: "true" }
      - label: 面板出现任务 prompt（点击落地到交互会话）
        ax: { has: "CRON-PROBE-CLICK" }
      - label: 面板出现回答（同一会话里跑完一轮）
        ax: { has: "cron 验收回答：任务已完成。" }
      - label: 会话 JSONL 落在目标 vault 目录（per-vault 布局）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "CRON-PROBE-CLICK" }
      - shot: 点击后运行完成
---

# 170-cron-click-run —— 点击通知发起运行（change add-cron-runtime-daemon §7.2）

## 本场景在验什么

`notify-then-run` 的点击链路：到点（`$nextMinute`，保证通知在套件开始轮询之后才出现）只投
「到点」通知 → **未点击零运行**（不花 token）→ 点击横幅
→ `cron_click(ok=true, action=run)` → 交互会话里发起运行 → `cron_run_finished(ok=true)`，
prompt 与回答出现在面板上、会话 JSONL 落在目标 vault 的目录里。

## 点击怎么驱动（§7.7 的兑现方式）

横幅由系统进程 `NotificationCenter.app` 渲染，**不在 Lumir 的 AX 树 / 窗口截图里**。本场景经
`do: clickNotification` 直接读 NotificationCenter 自己的 AX 树，按「标题 = 任务 id、正文 = 到点」
定位条目（`AXGroup`，label 形如 `(Terminal, acc-cron-click, 到点)`），对条目发 `AXPress`——与用户
点横幅是同一条系统默认动作。

三个动作分工（横幅只在屏上停留数秒，先 sleep 再点必然点空）：

1. `do: waitForNotification` 轮询通知中心直到条目出现——命中即返回，这一步的断言在
   「横幅在场、尚未点击」这个时点上判（负向判据 `cron_run_started` 必须为 0）；
2. `do: waitForFile` 等 `cron_notified(trigger)` **落盘**——日志是批量落盘（200ms 静默期），
   横幅由 usernoted 异步渲染，可能早于这一行写入；M622 首跑就撞上这个竞态（等待返回时日志只有
   6 行启动事件），判据因此改为直接轮询那份日志（README「waitForFile」）；
3. `do: clickNotification` 立刻在同一快照口径上重新定位并点击。

**新鲜度（M617）**：`waitForNotification` 在动作开始时快照当前匹配 title/body 的条目作基线，
只认那之后**新出现**的条目——上一轮 run 留在通知列表里的同标题条目不会让等待提前返回；
`clickNotification` 沿用这份基线，只点新出现的那条（点旧通知会被系统路由到已退出的实例，
`cron_click` 日志不出现，归因会误指向「点击链路坏掉」）。

**DND**：横幅被专注模式抑制时 `waitForNotification` 会超时失败（dump 里只有菜单栏）。本场景
2026-10-19 的复跑前提是 Alex 确认专注模式已关；若 dump 显示通知中心里没有条目而日志里
`cron_notified` 已投递，先按环境项（DND / 通知权限）排查，不要当产品缺陷。
