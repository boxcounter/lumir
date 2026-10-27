---
id: "207-cron-conversational-register"
item: 207
title: 对话注册定时任务：批准卡（任务要素）→ 采纳落盘 → 注册即生效 → 过点通知、未点击零运行（tasks §8.1）
open: harness-note.md
marker: "HNL-ALPHA"
# change add-cron-conversational-registration tasks §8.1 的核心链路：
# 对话里说建定时任务 → 批准卡（带 cron 要素块）→ 采纳 → 配置有任务且**无 delivery 键** →
# cron_task_registered(skip_today=false) → 过点后 cron_notified → 当日 cron_run_started 为 0。
#
# `at` 写在 mock fixture 的 tool_calls 参数里、用 `$nextMinute` 记号（app.mjs 的
# materializeMockFixture 按写入配置时刻换算成「至少 60s 之后的下一个分钟边界」）——
# 注册时必须**未到点**（skip_today=false），过点后由 30s tick 投递「到点」通知。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron-register.json"
steps:
  - name: 记下批准前的配置基线（采纳后要判「写进去了」，不是「文件本来就长这样」）
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

  - name: 抢前台（键盘注入的前台纪律——REVIEW.md「键盘注入丢键」条）
    do: focusWindow
    retries: 4

  - name: 输入「建一条定时任务」并 Enter 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|cronreg" }
    text: "cronreg"
  - name: 发送
    do: key
    key: enter

  - name: 等批准卡出现（vault_write 档下 cron_task_create 逐个问）
    do: waitFor
    waitFor:
      has: ["要执行这次 cron_task_create 调用吗？"]
    expect:
      - label: 批准卡问句在场（D415 回落句：工具名承担身份）
        ax: { has: "要执行这次 cron_task_create 调用吗？" }
      - label: 待决工具行尾注「等待批准」（D416）
        ax: { has: "等待批准" }
      - label: 待决行上屏任务身份 + 时间（卡片要让人看见注册的是什么、什么时候响）
        ax: { has: '/cron_task_create\s*acc-cron-register\s*\d{2}:\d{2}/' }
      - label: 任务要素块：触达档位默认「到点提醒，点通知后运行」（D525 + D529，缺省 notify-then-run）
        ax: { has: "到点提醒，点通知后运行" }
      - label: 任务要素块：会话默认「新会话」（D526 + D532）
        ax: { has: "新会话" }
      - label: 任务要素块：目标 vault 行在场（D527）
        ax: { has: "目标 vault" }
      - label: 注册日口径：今天还没到点（D535，skip_today=false）
        ax: { has: "今天照常触发" }
      - label: prompt 全文在卡上（自包含载荷是批准时唯一可核对的意图）
        ax: { has: "CRON-REG-PROBE 每天记一笔今日进度，写入 daily-log.md。" }
      - label: 批准前磁盘上的任务不存在（未采纳不落盘）
        file: { path: "env:config.json", not: "acc-cron-register" }
      - shot: 01-批准卡

  - name: 采纳注册
    do: click
    target: { role: AXButton, name: "^采纳$" }

  - name: 等工具循环收尾（注册回执回送模型 → 最终回答）
    do: waitFor
    waitFor:
      has: ["定时任务已注册。"]
    expect:
      - label: 配置里多出该任务（工具只写模型给出的键）
        file: { path: "env:config.json", has: '"id": "acc-cron-register"' }
      - label: 缺省键不写死——delivery 键缺席（缺省跟随配置口径，不是把当次默认钉进文件）
        file: { path: "env:config.json", not: '"delivery"' }
      - label: 落盘的 at 是合法本地时刻
        file: { path: "env:config.json", has: '/"at": "\d{2}:\d{2}"/' }
      - label: 配置确实变了（与批准前基线对比——「没写」与「写成了原样」不是一回事）
        file: { path: "env:config.json", changedSince: configBefore }
      - label: 决策终态行结果词在场（D405）
        ax: { has: "已采纳" }
      - shot: 02-采纳后

  # 注册诊断事件是**批量落盘**（logging.rs 的 200ms 静默期）：UI 回执到了不等于这一行已在盘上。
  # M746 真机实测（2026-10-27）：到上一步时日志只有 8 行、`cron_task_registered` 还在下一批，
  # 立刻断言会红。等它落盘再断言（不是加 sleep——等待条件就是最终要断言的那条记录）。
  - name: 等注册诊断事件落盘（cron_task_registered）
    do: waitForFile
    waitForFile:
      path: "env:logs/*.jsonl"
      jsonl: { event: cron_task_registered, task: acc-cron-register, skip_today: "false" }
    timeoutMs: 20000
    expect:
      - label: 注册诊断事件：cron_task_registered(skip_today=false)
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_task_registered, task: acc-cron-register, skip_today: "false" }
      - label: 日志记录的是生效档位（delivery/session 缺省值由运行时补，不是配置里的键）
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_task_registered, task: acc-cron-register, delivery: "notify-then-run", session: "new" }

  - name: 等到点（$nextMinute 至少 60s 后到点，30s tick 内投递「到点」通知）
    # 等的是**日志落盘**（cron_notified 是投递成功后才写的事件），不是通知横幅：横幅由
    # NotificationCenter 渲染，其 AX 树里存着**上一次 run 同标题**的通知（2026-10-20 实测：
    # 到点前 56s 就命中了上一批的横幅），拿它当「本次事件已发生」的等待条件会让后续日志断言
    # 抢跑（M617 起 waitForNotification 已带新鲜度基线，但等日志事件直接读日志更直接）。
    # `waitForFile` 与下面的 file 断言同源（同一份 matcher / jsonl / path 口径）。
    do: waitForFile
    waitForFile:
      path: "env:logs/*.jsonl"
      jsonl: { event: cron_notified, task: acc-cron-register, kind: trigger }
    timeoutMs: 180000
    expect:
      - label: 到点通知已投递（notify-then-run 的 trigger 档）
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_notified, task: acc-cron-register, kind: trigger }
      - label: 未点击 ⇒ 当日零运行（cron_run_started 为 0，不花 token）
        file:
          path: "env:logs/*.jsonl"
          count: { pattern: '"event":"cron_run_started"', exact: 0 }
      - label: cron-state.json 记录了今日 last_fired（去重状态由线程写）
        file:
          path: "env:cron-state.json"
          has: '/"last_fired":\s*"\d{4}-\d{2}-\d{2}"/'
      - shot: 03-到点通知后
---

# 207-cron-conversational-register —— 对话注册全链路（tasks §8.1）

## 本场景在验什么

用户说「建一条定时任务」→ 模型调 `cron_task_create` → 批准卡（带任务要素块：时间 / 星期 /
触达 / 会话 / 目标 vault + prompt 全文 + 注册日口径）→ 采纳 → 配置落盘（**只写模型给出的键**，
`delivery` 缺席是缺省语义的判据）→ 运行期重载确认（`cron_task_registered(skip_today=false)`）
→ 过点后 `cron_notified(kind=trigger)` → 未点击通知 ⇒ 当日 `cron_run_started` 为 0。

## `at` 为什么不是字面量

`at` 在**模型的工具参数**里（mock fixture 的 `tool_calls.arguments`），而判据要求「注册时未到点」。
套件对 `harness.fixture` 支持 `$nextMinute` / `$nowMinute` / `$pastMinute` 三个记号（与 `[cron]`
表同一份换算、同一个写入时刻），fixture 原文在仓库里保持静态。

## 判据的区分度

- 「无 delivery 键」是**文件级**负向断言：同一份配置里没有任何 `delivery` 字段——若工具把缺省值
  写死进文件，这条必红。
- 「配置确实变了」用 `record` 基线 + `changedSince`：证明采纳真的发生了一次写，而不是文件本来
  就有这条任务。
- 「当日零运行」用行数精确 0：`notify-then-run` 未点击 MUST NOT 发起运行（不花 token）。

## 环境与边界

合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；到点的等待与判定都取**应用日志**
（`cron_notified` 是投递成功后才写的事件），因此不依赖通知横幅是否上屏、也不受 DND 状态影响——
横幅的 AX 树里存着更早一次 run 的同标题通知，拿它当等待条件会抢跑（首跑实测；M617 起
`waitForNotification` 已带新鲜度基线，本场景仍直接读日志：等待与判定同源）。
