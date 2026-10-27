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
      # 任务的目标 vault 是第一个合成 vault；场景会**先切到第二个**再点通知（见 steps 首跳），
      # 「点击 → 打开目标 vault」这条交接因此有真判据（M752）。
      - id: "acc-cron-click"
        vault: "$vault"
        at: "$nextMinute"
        prompt: "CRON-PROBE-CLICK 点击通知后应当运行这一条。"
        delivery: "notify-then-run"
        session: "new"
seed:
  # 两个 vault 都预注册：⌘O 的列表里才有切走的第二行（同场景 19 / 131 的手法）。
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
steps:
  # ── 点击前的现场：app 停在**另一个** vault 上（M752）────────────────────────────
  # 点击通知必须把 app 带回任务的**目标** vault 再发起运行。M752 之前的场景让 app 停在目标
  # vault 上，因此「点击时要不要切 vault」这一整段交接没有被任何判据覆盖；真实事故就发生在
  # 这一段（点击后 app 停在当时的 vault / 标签状态）。这一跳把前置条件钉成「非目标 vault」，
  # 否则下面的断言会在同 vault 路径上照样绿（REVIEW.md「断言等价于假绿」条）。
  - name: 切到第二个合成 vault（点击前不在目标 vault 上）
    do: key
    key: "cmd+o"

  - name: 等 vault 列表浮层出现（两个 vault 都已预注册）
    do: waitFor
    waitFor:
      has: ["选择一个目录作为新 vault"]
    timeoutMs: 15000

  - name: 点第二个 vault 那一行
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }

  - name: 等第二个 vault 装载完成
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 60000
    expect:
      - shot: 已停在不属于任务目标的 vault 上
      - label: 现场确已离开目标 vault（下面「点击把 app 带回目标 vault」判据的前提）
        ax: { has: "vault：lumir-m102-acceptance-b（点击查看全部 vault）" }

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
      # M752：这一条是「点击把 app 带回任务的目标 vault」的判据。点击前场景停在第二个 vault 上，
      # 若交接只唤起窗口而不切 vault，标题栏仍显示 `-b`，这条必红。
      - label: 点击后已回到任务的目标 vault（不是停在点击前的那个 vault）
        ax: { has: "vault：lumir-m102-acceptance（点击查看全部 vault）" }
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

**点击前不在目标 vault 上（M752）**：场景从第二个合成 vault（`$vault2`）起步——任务的目标
vault 是第一个（`$vault`）。因此本场景同时判「点击 = 唤起窗口 + 打开目标 vault + 发起运行」
这条交接的后半段：只唤起窗口不切 vault 时，标题栏仍显示 `-b`，「点击后已回到任务的目标 vault」
这条判据必红。M752 之前的场景让 app 停在目标 vault 上，这段交接没有任何判据覆盖，真实事故
（点击后停在当时的 vault / 标签状态）就这样漏了过去。

## 覆盖边界（M752 诊断）

本场景**不覆盖「app 未运行时的通知点击」**：通知的响应通道按请求 id 登记在**投递它的那个进程**
里（`mac-usernotifications` 的 delegate + 进程内发送者表），进程退出后点击只会让系统重新拉起
app，响应没有任何接收方——用户看到的是「只拉起 app」。要让这种点击落地，需要启动期常驻的
通知 delegate + 「无主响应」落点，属新的产品合同（M752 已升级给 tower 裁决），不是本场景能
验的层。**10-27 的真实事故现场就是这一形态**：通知投递后进程退出，点击后 `cron_click` 缺失、
只有一次新的启动。

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
