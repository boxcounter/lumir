---
id: "252-cron-click-after-exit"
# item 项号取 704（现有最大 703 + 1）：**文件名按 change 的约定是 252**，但 `item` 是覆盖表的
# 主键，252 已被 `49-vault-switch-feedback` 占用（该场景 id 与 item 不一致是既有现状）。
item: 704
tier: bundle
title: 应用退出后点击通知：跨进程恢复、快照会话与四类拒绝（change add-cron-notification-relaunch §8.2）
# 跨进程点击只能在打包实例上判：dev flavour 的响应路由给 Terminal（README「实例 flavour」）。
requires: bundle
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron.json"
  cron:
    # 两条任务都落在下一个分钟边界（同 170 / 171：通知必须在套件开始轮询之后才出现）。
    # `notify-then-run` 供判据 1–8；`run-then-notify` 供判据 9（结果通知的跨进程恢复）。
    tasks:
      - id: "acc-cron-relaunch"
        vault: "$vault"
        at: "$nextMinute"
        prompt: "CRON-PROBE-RELAUNCH 退出后点击这条通知应当运行这一条。"
        delivery: "notify-then-run"
        session: "new"
      - id: "acc-cron-run"
        vault: "$vault"
        at: "$nextMinute"
        prompt: "CRON-PROBE-RELAUNCH-RESULT 结果通知的会话恢复目标。"
        delivery: "run-then-notify"
        session: "new"
steps:
  # ---- 正向证据：真实配置目录的只读 stat 基线（design §8.2 最后一条；r1 P2-1） -------------
  # 防线是包装脚本 + 拉起前的静态前置门；这里是「拉起之后真实 `~/.config/lumir` 没有被写过」的
  # 正向证据（mtime / size / inode）。基线取在首个步骤：套件自己的那次启动已经由同一份包装拉起，
  # 本场景真正要盯的是**系统按通知点击拉起的新进程**。
  - name: 记录真实配置目录的只读 stat 基线
    do: realConfigStat
    realConfigStat: baseline

  # ---- 判据 4 的前半：通知到场但未点击 ⇒ 零点击、零点击触发的运行 -------------------------
  - name: 等「到点」通知横幅出现（到点后 30s tick 内投递；未点击前不运行）
    do: waitForNotification
    title: "acc-cron-relaunch"
    body: "到点"
    timeoutMs: 180000
    expect:
      - label: 未点击 ⇒ 没有任何点击事件（判据 4 的前半）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_click"', exact: 0 }

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
      # 判据 1 的前置：台账条目与 last_fired 同一次落盘（§4 到点路径）
      - label: 台账里已有这条通知的条目（kind=trigger）
        file: { path: "env:cron-state.json", has: '"kind": "trigger"' }

  - name: 等结果通知事件落盘（run-then-notify 的「已完成」）
    do: waitForFile
    waitForFile:
      path: "env:logs/*.jsonl"
      jsonl: { event: cron_notified, kind: result }
    timeoutMs: 120000
    expect:
      - label: 结果通知已投递
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_notified, kind: result }
      # 判据 9 的前置：结果通知的台账条目带那次运行的会话快照
      - label: 台账里结果通知条目带会话快照
        file: { path: "env:cron-state.json", has: '"session_id"' }

  - name: 等结果通知横幅出现（留作判据 9 的点击目标）
    do: waitForNotification
    title: "acc-cron-run"
    body: "已完成"
    timeoutMs: 60000

  # ---- 判据 4 的后半：正常退出 → 只重启不点击 ⇒ 仍然零点击 -------------------------------
  - name: 正常退出应用（AppleEvent quit，不是 SIGTERM）
    do: quitApp
    expect:
      - label: 退出前没有任何点击事件
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_click"', exact: 0 }

  - name: 只启动应用（不点通知）
    do: restart
    expect:
      - label: 仅拉起应用不产生点击（判据 4）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_click"', exact: 0 }
      - label: 仅拉起应用不产生点击触发的运行（判据 4）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started".*"trigger":"click"', exact: 0 }

  - name: 再次正常退出（把它留给「点击拉起」这一轮）
    do: quitApp

  # ---- 判据 1 / 2 / 3：退出后点击到点通知 → 系统拉起 → 运行 ------------------------------
  - name: 点击「到点」通知（应用已退出；系统按 bundle id 拉起验收副本）
    do: clickNotification
    title: "acc-cron-relaunch"
    body: "到点"

  - name: 按验收 bundle id 重新附着到被拉起的新进程
    do: attachRelaunched
    timeoutMs: 60000
    expect:
      - label: 新进程落一条跨进程点击（判据 1：source=relaunch、ok、action=run，恰好一条）
        file:
          path: "env:logs/*.jsonl"
          count:
            { pattern: '"action":"run","event":"cron_click".*"ok":"true".*"source":"relaunch"', exact: 1 }
      - label: 点击发起的运行已开始（判据 2：trigger=click）
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_run_started, trigger: click }
      - label: 运行终态 ok=true（判据 2）
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_run_finished, ok: "true" }
      - label: 面板出现任务 prompt（判据 3）
        ax: { has: "CRON-PROBE-RELAUNCH 退出后点击这条通知应当运行这一条。" }
      - label: 会话 JSONL 落在目标 vault 的 per-vault 目录（判据 3）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "CRON-PROBE-RELAUNCH" }
      - shot: 退出后点击的恢复结果

  # ---- 判据 5：第二次点击同一条通知 ⇒ 只打开已有会话，不重跑 ------------------------------
  - name: 再次点击同一条通知
    do: clickNotification
    title: "acc-cron-relaunch"
    body: "到点"
    expect:
      - label: 第二次点击也落一条 cron_click（判据 5）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_click"', exact: 2 }
      - label: 仍然只有一次点击触发的运行（判据 5：不产生第二次模型请求）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started".*"trigger":"click"', exact: 1 }

  # ---- 判据 9：结果通知的跨进程恢复，恢复的是**快照会话**而不是任务最新会话 --------------
  - name: 退出（把「任务最新会话」改成另一场真实会话，再看点击恢复哪一条）
    do: quitApp

  - name: 把 tasks.acc-cron-run.session_id 改成另一场真实会话（与结果通知的快照不同）
    do: cronStateEdit
    cronStateEdit: task_session
    task: "acc-cron-run"
    sessionId: "$otherVaultSession"

  - name: 点击结果通知（应用已退出）
    do: clickNotification
    title: "acc-cron-run"
    body: "已完成"

  - name: 重新附着到被拉起的新进程
    do: attachRelaunched
    timeoutMs: 60000
    expect:
      - label: 结果通知的点击落到 open-session（判据 9）
        file:
          path: "env:logs/*.jsonl"
          count:
            {
              pattern: '"action":"open-session","event":"cron_click".*"ok":"true".*"source":"relaunch"',
              exact: 1,
            }
      - label: 点击不重跑（点击触发的运行仍为一条）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started".*"trigger":"click"', exact: 1 }
      # 区分度：恢复的是结果通知那次运行（-RESULT 后缀），不是被改成「最新」的那场会话。
      - label: 面板显示的是结果通知那次运行的内容（判据 9 的区分度）
        ax: { has: "CRON-PROBE-RELAUNCH-RESULT" }
      - label: 没有被错恢复成点击那次交互运行的会话（读最新会话的实现会命中这一条）
        ax: { not: "CRON-PROBE-RELAUNCH 退出后点击这条通知应当运行这一条。" }
      - shot: 结果通知的跨进程会话恢复

  # ---- 判据 7：跨天点击不补跑 -------------------------------------------------------------
  - name: 退出后把台账的派发日期改成昨天
    do: quitApp
  - name: 台账日期改成昨天
    do: cronStateEdit
    cronStateEdit: notice_date_yesterday

  - name: 点击「到点」通知（派发日期是昨天）
    do: clickNotification
    title: "acc-cron-relaunch"
    body: "到点"

  - name: 重新附着
    do: attachRelaunched
    timeoutMs: 60000
    expect:
      - label: 跨天点击被拒（判据 7：notice_stale）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"error":"notice_stale","event":"cron_click"', exact: 1 }
      - label: 跨天点击不发起运行
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started".*"trigger":"click"', exact: 1 }

  # ---- 判据 6：点击已删除任务的通知 -------------------------------------------------------
  - name: 退出后从配置里删掉任务
    do: quitApp
  - name: 删掉任务 acc-cron-relaunch
    do: cronTaskEdit
    cronTaskEdit:
      drop: "acc-cron-relaunch"

  - name: 点击「到点」通知（任务已被删除）
    do: clickNotification
    title: "acc-cron-relaunch"
    body: "到点"

  - name: 重新附着
    do: attachRelaunched
    timeoutMs: 60000
    expect:
      - label: 任务已删除的点击被拒（判据 6：task_unknown）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"error":"task_unknown","event":"cron_click"', exact: 1 }
      - label: 任务已删除时给了一句人话提示（不当静默失败）
        ax: { has: "这条提醒对应的任务已删除" }
      - label: 不发起运行
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started".*"trigger":"click"', exact: 1 }

  # ---- 判据 8：台账外 request id ----------------------------------------------------------
  - name: 退出后清空台账
    do: quitApp
  - name: 删掉全部台账条目（模拟台账外 request id）
    do: cronStateEdit
    cronStateEdit: notice_drop

  - name: 点击「到点」通知（台账里已经没有它）
    do: clickNotification
    title: "acc-cron-relaunch"
    body: "到点"

  - name: 重新附着
    do: attachRelaunched
    timeoutMs: 60000
    expect:
      - label: 台账外 request id 被拒（判据 8：notice_unknown）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"error":"notice_unknown","event":"cron_click"', exact: 1 }
      - label: 不发起运行
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started".*"trigger":"click"', exact: 1 }
      # notice_unknown 刻意不上屏（旧版本遗留 / 被裁剪的通知属正常噪声）：两条点击提示都不该出现。
      - label: 台账外点击不上屏提示（判据 8）
        ax: { not: "这条提醒对应的任务已删除" }
      - label: 台账外点击不上屏「已过期」提示
        ax: { not: "这条提醒已过期" }
      - shot: 台账外点击后的界面

  # ---- 正向证据：整场结束后真实配置目录逐项未变（r1 P2-1） ---------------------------------
  - name: 核对真实配置目录的 stat 与基线一致
    do: realConfigStat
    realConfigStat: compare
    expect:
      - label: 新进程写入的 cron-state.json 落在套件 env 下（不是真实配置目录）
        file: { path: "env:cron-state.json", has: '"notices"' }
---

# 252-cron-click-after-exit —— 应用退出后点击通知（change add-cron-notification-relaunch §8.2）

## 本场景在验什么

`notify-then-run` 的「到点」通知投递之后**应用退出**，用户点它：系统按 bundle id 拉起验收副本，
新进程靠 `cron-state.json` 的**通知台账**识别这次点击并落地成一次运行。判据清单的唯一定义在
[`design.md`](../../../openspec/changes/add-cron-notification-relaunch/design.md) §8.2，本文件按
编号引用，不另抄一份：

| 判据 | 本场景的落点 |
|---|---|
| 1 新进程落一条 `cron_click{source: relaunch, ok: true, action: run}` | 「重新附着」步的 count 断言（恰好一条） |
| 2 `cron_run_started{trigger: click}` 与 `cron_run_finished{ok: true}` 各一条 | 同上两步 |
| 3 目标 vault 被打开、面板出现 prompt、会话落在 per-vault 目录 | `ax:` 与 `env:harness/sessions/*/*.jsonl` |
| 4 负向控制：只启动不点击 ⇒ 零点击、零点击触发的运行 | 「只启动应用（不点通知）」步 |
| 5 第二次点击：`cron_click` 增加但运行仍一条 | 「再次点击同一条通知」步 |
| 6 任务已删除：`task_unknown` + 人话提示 | 「删掉任务 acc-cron-relaunch」之后 |
| 7 跨天：`notice_stale` | 「台账日期改成昨天」之后 |
| 8 台账外 request id：`notice_unknown` 且不上屏 | 「删掉全部台账条目」之后 |
| 9 结果通知的跨进程恢复按**快照会话** | 「把 tasks.acc-cron-run.session_id 改成另一场真实会话」之后 |

判据 9 的区分度做法：退出后用 `do: cronStateEdit`（`task_session`）把
`tasks.acc-cron-run.session_id` 指向**另一场真实会话**（`$otherVaultSession`：从磁盘上真实的
会话文件里挑一个与当前记录不同的 id）。点击结果通知后，面板必须显示结果通知那次运行的内容
（`CRON-PROBE-RELAUNCH-RESULT`）而**不是**被改成「最新」的那场会话（点击那次交互运行的
prompt）。「读最新会话」的实现会命中后一条 `ax: { not: … }`。

## 判据 4 的口径

这一轮里 `cron_run_started` **不是**零：同场还有一条 `run-then-notify` 任务按定时器自己跑过
（它的 trigger 是 `timer`，不是点击）。因此负向控制的机器判据是两条：`cron_click` 为 0，且
**没有** `trigger=click` 的 `cron_run_started`。系统单纯拉起一个进程时这两条都成立；一旦
「拉起」被误当成「点击已接受」，两条同时翻红。

## 验收隔离（fail-closed，不是事后探测）

拉起的实例不继承套件的环境变量，因此隔离必须发生在**任何 Lumir 代码运行之前**：
`node scripts/acceptance/build-bundle.mjs` 把真二进制改名为 `lumir-bin`，并在
`CFBundleExecutable` 的位置装一份 shell 包装；包装从固定路径的 token
（`/tmp/lumir-acceptance-isolate`，套件每次拉起前写入本次 run 的 `env/`）读隔离根，`exec` 之前
导出 `XDG_CONFIG_HOME` 与 `HOME`。token 缺失 / 不可读，或内容不是验收布局（`…/acceptance/env`
与 `…/acceptance/<run>/env` 两种放行，其余路径 fail-closed）时包装**拒绝启动**（退出码 78，
原因写 stderr），绝不回落真实 `~/.config`。

静态前置门在**任何一次拉起之前**跑（`app.mjs` 的 `assertBundleIsolation`）：核 `CFBundleExecutable`
指向包装、脚本导出两个变量、token 等于本次 run 的 `envHome()`。不成立即判 INVALID 且不发起拉起
——拉起之后再查目录只能发现污染，不能防污染。

## 真实配置目录的正向验证（不是防线）

防线是「包装脚本在 exec 前导出 `XDG_CONFIG_HOME` + `HOME`」与「拉起前的静态前置门」——两者都在
任何 Lumir 代码运行之前生效。拉起之后再查目录只能**发现**污染，防不住污染，因此这里的
`do: realConfigStat baseline / compare` 只作正向证据：整场结束时对真实 `~/.config/lumir` 做只读
stat（目录与直接子项的 inode / size / mtime），出现任何变化即判**环境项失败（INVALID）**——那说明
隔离没成立，整场读数不算数。它同时给出「新进程确实把
`cron-state.json` 写进了套件 `env/`」的对照。

## 已知边界

- **通知中心的条目寿命**：本场景在点击之间做了退出 / 重启 / 改状态等若干轮，横幅会离开屏幕、
  条目退进通知中心列表。`clickNotification` 读的是 NotificationCenter 的 AX 树，若某一轮里条目
  已经不在列表里（系统按保留策略清掉），点击会驱动不到——那一步按环境项排查，不要当产品缺陷。
- **首次授权是人肉 checkpoint**：新 bundle id 的通知权限为空时，第一次启动需要在系统设置里给
  验收副本授权，否则含通知的判据全红（README「实例 flavour」）。
- **DND**：专注模式抑制横幅时 `waitForNotification` 会超时；先按环境项排查。
