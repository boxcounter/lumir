---
id: "721-harness-vault-unread"
item: 721
tier: full
title: 跨 vault 的活动记录：非当前 vault 的在途 / 未读在切换器行上可读，切过去但面板收起不清未读
open: harness-note.md
marker: "HNL-ALPHA"
# change extend-harness-activity-across-vaults-nov23 的真机判据（design §14.6）。
#
# 判据本体只能在真机观测（WKWebView 的 AX 树）：
#   ① 非当前 vault 的活动只在该 vault 的切换器行上呈现——行切换钮的 `title`（AX `help=`）是
#      三态的唯一可判定读数：`<显示名> · 处理中 / 有新的回复 / 有失败结果`；
#   ② 当前行不显示标记（由标题栏 toggle 钮承载，`help="Harness 面板 · <状态词>"`）；
#   ③ **切换本身不是已读**：切到一个布局里没有 harness pane 的 vault、面板仍收起时，未读不清；
#      打开面板（或布局落定后 pane 随在场）才清；
#   ④ 用户主动停止（aborted）不产生未读；空闲行没有任何标记。
#
# mock 脚本 `$fixtures/harness-mock-activity-unread.json` 按轮次消费：
#   轮 1 = 8s × 3 片的慢流（造「切到 B 之后 A 仍在途」的窗口；A 期间在 B 完成 ⇒ A 行未读回复）；
#   轮 2 = 错误终态（⇒ 失败档）；
#   轮 3 = 8s × 2 片的慢流（用于主动停止）；
#   轮 4 = 立即完成（在 B 发起、A 期间完成 ⇒ 用于「切过去但面板收起不清未读」）。
#
# **面板展开时 toggle 不在场上**（双 pane 退让条款）：有态判据都取**收起态**。
# 场景 252（当前 vault 收起态的活动）与之互补、不重叠；本场景不改它的口径。
seed:
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-activity-unread.json"
steps:
  # ── 轮次一：A 发起慢流 → 收起 → 切到 B：A 行呈「处理中」──────────────────
  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 空闲态：发送钮在场（面板随 ⌘⇧A 打开）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 第一轮提问（慢流，将在 B 期间继续跑）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|ugg" }
    text: "ugg1"
  - name: 发送
    do: key
    key: enter
  - name: 等在途
    do: waitFor
    waitFor:
      has: ["/AXButton \\(停止\\)/"]
    timeoutMs: 30000
  - name: 收起面板（切 vault 时面板不在屏幕上）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 面板已收起
        ax: { not: "分隔条" }

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

  - name: 打开切换器看 A 行（非当前 vault 的在途）
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 等切换器行渲染
    do: waitFor
    waitFor:
      has: ["lumir-m102-acceptance · 处理中"]
    timeoutMs: 30000
    expect:
      - label: A 行呈「处理中」（空心环档；行切换钮 title → AX help）
        ax: { has: "lumir-m102-acceptance · 处理中" }
      - label: B 行（当前）不显示任何活动标记——当前行由标题栏钮承载
        ax: { not: "/lumir-m102-acceptance-b · (处理中|有新的回复|有失败结果)/" }
      - shot: 01-A行处理中

  # ── 轮次一在 B 期间结束：A 行转「有新的回复」────────────────────────────
  - name: 等这一轮在 B 期间结束（A 行由「处理中」转未读回复）
    do: waitFor
    waitFor:
      has: ["lumir-m102-acceptance · 有新的回复"]
      not: ["lumir-m102-acceptance · 处理中"]
    timeoutMs: 90000
    expect:
      - label: A 行呈「有新的回复」（该轮终态已收口，不是「处理中」）
        ax: { has: "lumir-m102-acceptance · 有新的回复" }
      - shot: 02-A行未读回复

  # ── 点回 A（面板仍收起）：标题栏钮承载未读，当前行不重复 ────────────────
  - name: 点 A 行（面板仍收起）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance(?!-b)/" }
  - name: 等 A 装载完成
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000
    expect:
      - label: 切换本身不清未读：标题栏钮呈「有新的回复」
        ax: { has: "Harness 面板 · 有新的回复" }
      - label: 面板仍是收起的（未读的承载体是标题栏钮，不是被自动展开的面板）
        ax: { not: "分隔条" }
      - shot: 03-切回A-钮未读

  - name: 再开切换器：当前行 A 不显示标记
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 等切换器行渲染（无 A 行标记）
    do: waitFor
    waitFor:
      not: ["/lumir-m102-acceptance · (处理中|有新的回复|有失败结果)/"]
    timeoutMs: 30000
    expect:
      - label: 当前行不重复呈现活动（同一状态只在标题栏钮上出现一次）
        ax: { not: "/lumir-m102-acceptance · (处理中|有新的回复|有失败结果)/" }
      - shot: 04-当前行不重复

  # ── 打开面板：回复在场、未读清算 ────────────────────────────────────────
  - name: 打开面板（`⌘⇧A` 关闭切换器后开面板）
    do: keys
    keys: ["escape"]
  - name: 打开面板
    do: keys
    keys: ["cmd+shift+a"]
  - name: 等面板在场
    do: waitFor
    waitFor:
      has: ["分隔条"]
    timeoutMs: 30000
    expect:
      - label: 第一轮的回答完整在场（快照铺开）
        ax: { has: "UG1-C 第三片。" }
    # 面板展开时 toggle 按退让条款不在场上：未读的清算由「收起后再看钮」判（下一步）。
  - name: 收起面板
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 打开过面板 ⇒ 未读已清算：钮回到空闲（D327 逐字，不含状态词）
        ax: { has: "Harness 面板" }
      - label: 空闲态不再有状态词
        ax: { not: "/Harness 面板 · (处理中|有新的回复|有失败结果)/" }
      - shot: 05-打开面板即已读

  # ── 轮次二：A 失败 → 切 B：A 行失败档；切回 A（面板收起）→ 钮仍失败；打开即清 ──
  - name: 第二轮提问（错误终态）
    do: keys
    keys: ["cmd+shift+a"]
  - name: 等面板在场
    do: waitFor
    waitFor:
      has: ["分隔条"]
    timeoutMs: 30000
  - name: 输入并发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|ugg" }
    text: "ugg3"
  - name: 发送
    do: key
    key: enter
  - name: 等在途
    do: waitFor
    waitFor:
      has: ["/AXButton \\(停止\\)/"]
    timeoutMs: 30000
  - name: 收起面板
    do: keys
    keys: ["cmd+shift+a"]
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
  - name: 打开切换器等 A 行失败档
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 等 A 行呈失败档
    do: waitFor
    waitFor:
      has: ["lumir-m102-acceptance · 有失败结果"]
    timeoutMs: 60000
    expect:
      - label: A 行呈「有失败结果」（与「有新的回复」不单靠颜色可辨）
        ax: { has: "lumir-m102-acceptance · 有失败结果" }
      - shot: 06-A行失败

  - name: 点 A 行（面板仍收起）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance(?!-b)/" }
  - name: 等 A 装载完成
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000
    expect:
      - label: 切到 A 但面板不在场 ⇒ 未读保留在标题栏钮上
        ax: { has: "Harness 面板 · 有失败结果" }
      - shot: 07-切回A-钮失败
  - name: 打开面板即清
    do: keys
    keys: ["cmd+shift+a"]
  - name: 等面板在场
    do: waitFor
    waitFor:
      has: ["分隔条"]
    timeoutMs: 30000
  - name: 收起面板
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 打开面板后失败未读已清算
        ax: { not: "/Harness 面板 · (处理中|有新的回复|有失败结果)/" }

  # ── 轮次三：主动停止不产生未读 ──────────────────────────────────────────
  - name: 第三轮提问（将在途时主动停止；fixture 轮 3 = 慢流）
    do: keys
    keys: ["cmd+shift+a"]
  - name: 等面板在场
    do: waitFor
    waitFor:
      has: ["分隔条"]
    timeoutMs: 30000
  - name: 输入并发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|ugg" }
    text: "ugg4"
  - name: 发送
    do: key
    key: enter
  - name: 等在途
    do: waitFor
    waitFor:
      has: ["/AXButton \\(停止\\)/"]
    timeoutMs: 30000
  - name: 点停止（发送钮的停止态）
    do: click
    target: { role: AXButton, name: "停止" }
  - name: 收起面板并切到 B
    do: keys
    keys: ["cmd+shift+a"]
  - name: 切到 vault B
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 点 B 行
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }
  - name: 等 B 装载完成并让 aborted 收口
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000
  - name: 静待 aborted 终态到达
    do: sleep
    ms: 4000
  - name: 打开切换器：A 行无任何标记
    do: click
    target: { any: "点击查看全部 vault" }
    expect:
      - label: 主动停止不产生未读：A 行没有任何状态词
        ax: { not: "/lumir-m102-acceptance · (处理中|有新的回复|有失败结果)/" }
      - shot: 08-停止后A行无标记

  # ── 时序回归：B 有未读 → 切到 B（布局无 harness pane、面板收起）→ 未读不得被误清算 ──
  - name: 点 B 行（当前就是 B；先关掉切换器）
    do: keys
    keys: ["escape"]
  - name: 在 B 发起一轮（面板打开）
    do: keys
    keys: ["cmd+shift+a"]
  - name: 等面板在场
    do: waitFor
    waitFor:
      has: ["分隔条"]
    timeoutMs: 30000
  - name: 输入并发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|ugg" }
    text: "ugg5"
  - name: 发送
    do: key
    key: enter
  - name: 收起面板（这一轮将在 A 期间结束）
    do: keys
    keys: ["cmd+shift+a"]
  - name: 切到 A
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
  - name: 打开切换器等 B 行未读
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 等 B 行呈未读回复
    do: waitFor
    waitFor:
      has: ["lumir-m102-acceptance-b · 有新的回复"]
    timeoutMs: 60000
    expect:
      - label: B 在 A 期间完成 ⇒ B 行呈未读回复
        ax: { has: "lumir-m102-acceptance-b · 有新的回复" }

  - name: 切到 B（面板仍收起；B 的存储布局里没有 harness pane）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }
  - name: 等 B 装载完成（布局落定、面板仍是收起的）
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000
    expect:
      - label: 切换本身不是已读：布局无 harness pane ⇒ 未读保留在标题栏钮上
        ax: { has: "Harness 面板 · 有新的回复" }
      - label: 面板仍是收起的（未读不清、也不自动展开）
        ax: { not: "分隔条" }
      - shot: 09-时序回归-未读保留
  - name: 打开面板才清
    do: keys
    keys: ["cmd+shift+a"]
  - name: 等面板在场
    do: waitFor
    waitFor:
      has: ["分隔条"]
    timeoutMs: 30000
  - name: 收起面板
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 打开面板后未读清算（与场景 252 的当前 vault 口径一致）
        ax: { not: "/Harness 面板 · (处理中|有新的回复|有失败结果)/" }
      - shot: 10-打开即清
---
