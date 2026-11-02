---
id: "240-harness-subagent-vault-switch"
item: "8.24"
tier: full
title: 子代理跨 vault 往返：切走清行、切回按 live 快照重建（停止可用）、切走期间收尾不复活
open: harness-note.md
marker: "HNL-ALPHA"
# M822（change rework-harness-delegation-ux-nov02）的真机判据：旧实现有**相反的两个**错误。
#
#   ① 僵尸行：`clearTranscriptSurface()` 只清 `runRowEls` 不删 `taskList` 子节点，切走后行 DOM
#      仍在；下一次快照带回 `subrun_usage` 时整块重新可见 = 冻结的「运行中 + 停止」（M819 截图）。
#   ② 反向缺口：切回时仍在跑的 run 没有行、也没有停止——快照没有 live run 列表可重建。
#
# 本场景依次判：切走后面板里没有该 run 的行/停止 ⇒ 快速切回时行与停止按 `live_subruns` 重建 ⇒
# 再切走并等它在后台收尾 ⇒ 切回时不得显示「运行中」（终态由 transcript 的 task 行承载，事件在
# 切走期间被 vault 过滤丢弃，终态来自快照 `subrun_runs` 对账）。
#
# mock 脚本 `$fixtures/harness-mock-subagent-vault-switch.json`：后台 run 的首响应延迟 40s——
# 覆盖两次 vault 装载 + 一次「切走后收尾」的等待窗口。
seed:
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-subagent-vault-switch.json"
steps:
  - name: 写入定义 .lumir/agents/research.md
    do: vaultWrite
    file: ".lumir/agents/research.md"
    content: |
      ---
      name: research
      description: 后台长任务
      ---


  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现
        ax: { has: "分隔条" }

  - name: 输入提问并发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|SUBQ" }
    text: "SUBQ"
  - name: 发送
    do: key
    key: enter

  - name: 等父回合收尾（后台已启动）
    do: waitFor
    waitFor:
      has: ["SWB-PARENT 父会话：后台已启动。"]
    timeoutMs: 30000
    expect:
      - label: 后台 run 在控制区占一行（带后台标记）
        ax: { has: "/后台长任务/" }
      - shot: 01-A-后台运行中

  - name: 展开控制区行（停止在展开区里；控制区行以 agent 名开头，transcript 行以 task 开头）
    do: click
    target: { role: AXButton, name: "^research .*后台长任务" }
  - name: 等展开后的重渲（停止入口出现）
    do: waitFor
    waitFor:
      has: ['/AXButton \(停止该任务\)/']
    timeoutMs: 10000
    expect:
      - label: 运行中的行提供「停止」（控制区行）
        ax: { has: '/AXButton \(停止该任务\)/' }
  - name: 切到 vault B
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 点 B 行
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }
  - name: 等 B 装载完成
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000
    expect:
      - label: 切走后 A 的 run 行不再可见（旧实现：僵尸行留在 DOM，快照带回用量时重新可见）
        ax: { not: '/AXButton \(停止该任务\)/' }
      - label: 控制区不出现 A 的后台任务行
        ax: { not: "/后台长任务/" }
      - shot: 02-B-无残留

  - name: 快速切回 vault A（run 仍在跑）
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 点 A 行
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance(?!-b)/" }
  - name: 等 A 装载完成
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000
    expect:
      - label: 切回时仍在跑的 run 按快照 live 列表重建行（旧实现：0 行）
        ax: { has: "/后台长任务/" }
      - shot: 03-A-切回仍在跑

  - name: 展开重建后的行
    do: click
    target: { role: AXButton, name: "^research .*后台长任务" }
  - name: 等重建行的展开重渲（停止入口出现）
    do: waitFor
    waitFor:
      has: ['/AXButton \(停止该任务\)/']
    timeoutMs: 10000
    expect:
      - label: 重建的行带「停止」（旧实现：没有行，也就没有停止入口）
        ax: { has: '/AXButton \(停止该任务\)/' }
  - name: 再切到 vault B
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 点 B 行（第二次）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }
  - name: 等 B 装载完成
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000

  - name: 在 B 里等后台 run 收尾（事件在切走期间被 vault 过滤丢弃）
    do: sleep
    ms: 45000

  - name: 切回 vault A（run 已在切走期间收尾）
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 点 A 行（第三次）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance(?!-b)/" }
  - name: 等 A 装载完成
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000
    expect:
      - label: 切走期间收尾的 run 不得以运行中形态复活（无停止入口）
        ax: { not: '/AXButton \(停止该任务\)/' }
      - label: 终态由 transcript 的 task 行承载（启动信封的 running 被快照逐 run 汇总对账）
        ax: { has: "/task research 后台长任务.*已完成/" }
      - label: 后台完成通知照常可见（回放自会话面板记录）
        ax: { has: "后台任务完成 · research" }
      - shot: 04-A-切走期间收尾
---

# 240 —— 8.24 子代理跨 vault 往返

后台 run 在 A 里运行；切到 B 再切回 A：行与「停止」必须按快照 `live_subruns` 重建；再切到 B
并等它收尾后切回：不得残留「运行中」行，终态由 transcript 的 `task` 行承载（`subrun_runs` 对账）。

已知边界：切 vault 的装载时长由真机决定；40s 的子运行窗口覆盖两次装载与一次 45s 等待。若机器
极慢导致第二次切回前 run 已收尾，`03-A-切回仍在跑` 会判红——如实暴露，不做自适应重试。
