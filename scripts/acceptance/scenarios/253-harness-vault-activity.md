---
id: "253-harness-vault-activity"
item: 704
tier: full
title: harness 跨 vault 往返的在途准确：切回仍在途不呈空闲、续渲染并对账；完成后往返指示空闲
open: harness-note.md
marker: "HNL-ALPHA"
# change add-harness-activity-presence 的症状二判据（Alex dogfood 原话的另一半）：
# 「切到其他 vault 再切回，harness pane 看上去是停止的、可以发新消息，但一发就被拒」。
#
# 修复口径（spec「面板收起与跨 vault 的活动在场」）：相位**不在切 vault 时猜测**——`resetView`
# 只做视图复位，真相来自切回时那次**进入快照**的 `in_flight`（后端三态轮次状态机的呈现读）。
# 因此本场景的三个观测点都必须落在真机上：
#   ① 切回仍在途的 vault ⇒ 发送钮是停止态、状态文本「处理中」、后续增量继续上屏；
#   ② 该轮终态到达 ⇒ 渲染面按后端快照对账一次，transcript 是**完整回答**（不是缺开头的半截）；
#   ③ 完成后往返（切走 → 该轮在别的 vault 期间结束 → 切回）⇒ 指示空闲，回答按快照铺开。
#
# mock 脚本 `$fixtures/harness-mock-activity-vault.json`：三轮带 8s 片间隔的流，按轮次消费。
# 8s × 3 片 = 切 vault 往返的在途窗口（够两次点击 + 装载完成）。
seed:
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-activity-vault.json"
steps:
  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 空闲态：发送钮在场
        ax: { has: "/AXButton \\(发送\\)/" }

  # ── 轮次一：A 发起 → 收起 → 切到 B → 切回 A（仍在途）────────────────────
  - name: 第一轮提问
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|vlt" }
    text: "vlt"
  - name: 发送
    do: key
    key: enter
  - name: 在途
    do: waitFor
    waitFor:
      has: ["/AXButton \\(停止\\)/"]
    timeoutMs: 30000
  - name: 收起面板（切 vault 之前面板不在屏幕上——与 dogfood 现场一致）
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
    expect:
      - label: B 里没有 A 的在途态（指示只呈现当前 vault 的活动）
        ax: { not: "处理中" }
      - shot: 01-B-空闲

  - name: 切回 vault A
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 点 A 行
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance(?!-b)/" }
  - name: 等 A 装载完成（这一轮仍在跑）
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000
    expect:
      - label: 切回后指示仍是「处理中」——不呈假空闲（本场景的核心判据）
        ax: { has: "处理中" }
      - label: 标题栏 toggle 钮在场上（面板仍是收起的）
        node: { role: AXButton, name: "对话面板", present: true }
      - shot: 02-切回仍在途

  - name: 打开面板：发送钮必须是停止态（不是「看似可发送」的空闲）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 发送钮呈停止态——用户不会在以为空闲的状态下撞上「对话正在进行中」的拒绝
        ax: { has: "/AXButton \\(停止\\)/" }
      - label: 发送钮不是「发送」态
        ax: { not: "/AXButton \\(发送\\)/" }
      - shot: 03-切回后停止态

  - name: 等切回之后的增量继续上屏（轮次闸门随相位一并恢复）
    do: waitFor
    waitFor:
      has: ["VAULT-C 第三片。"]
    timeoutMs: 60000
    expect:
      - label: 切回之后的增量照常上屏（闸门已随相位恢复）
        ax: { has: "VAULT-C 第三片。" }
      - shot: 04-续渲染

  - name: 等终态收口（对账：完整回答，不是缺开头的半截）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(发送\\)/"]
    timeoutMs: 60000
    expect:
      - label: 终态后回到空闲
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 对账生效——开头那一片（切走期间被 vault 过滤掉的）重新在场
        ax: { has: "VAULT-A 第一片。" }
      - label: 末片也在场（完整回答）
        ax: { has: "VAULT-C 第三片。" }
      - shot: 05-对账完整回答

  # ── 轮次二：完成后往返（切走 → 该轮在 B 期间结束 → 切回）────────────────
  - name: 第二轮提问（这一轮将在 B 期间结束）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|vlt" }
    text: "vlt2"
  - name: 发送
    do: key
    key: enter
  - name: 收起并立刻切到 B
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
  - name: 在 B 里等够一轮（8s × 3 片 + 收口）
    do: sleep
    ms: 30000
  - name: 切回 A（该轮已在 B 期间结束，其终态事件被 vault 过滤——本地从未观察到）
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
      - label: 进入快照的呈现读为「不在途」⇒ 就地收口，不停在处理中等一个不会到达的事件
        ax: { not: "处理中" }
      - label: 也不伪造未读档位（跨 vault 完成的未读不在本能力范围，D3 非目标）
        ax: { not: "有新的回复" }
      - shot: 06-完成后往返-空闲

  - name: 打开面板：回答按快照完整铺开
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 第二轮的回答完整在场（快照铺开，不是半截流式泡）
        ax: { has: "VAULT2-A 第一片。" }
      - label: 末片也在场
        ax: { has: "VAULT2-C 第三片。" }
      - shot: 07-完成后往返-完整回答

  # ── 轮次三：反复切换不丢在途态、终态只收口一次 ──────────────────────────
  - name: 第三轮提问
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|vlt" }
    text: "vlt3"
  - name: 发送
    do: key
    key: enter
  - name: 收起并反复切换 A→B→A→B→A
    do: keys
    keys: ["cmd+shift+a"]
  - name: 切到 B（第 1 次）
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 点 B 行
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }
  - name: 等 B 装载
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000
  - name: 切回 A（第 1 次）
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 点 A 行
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance(?!-b)/" }
  - name: 等 A 装载
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000
    expect:
      - label: 第一次往返后仍呈在途（不因切换次数累积成未读、也不掉回空闲）
        ax: { has: "处理中" }
  - name: 切到 B（第 2 次）
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 点 B 行
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }
  - name: 等 B 装载
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000
  - name: 切回 A（第 2 次）
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 点 A 行
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance(?!-b)/" }
  - name: 等 A 装载并等到该轮收口
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000
    expect:
      - label: 反复切换后仍在途（第三次进入快照仍报在途）
        ax: { has: "处理中" }
      - shot: 08-反复切换仍在途

  - name: 打开面板等终态（这一轮的末片与收口）
    do: keys
    keys: ["cmd+shift+a"]
  - name: 等收口
    do: waitFor
    waitFor:
      has: ["/AXButton \\(发送\\)/"]
    timeoutMs: 90000
    expect:
      - label: 终态只收口一次、回到空闲
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 回答完整（含切走期间的开头一片）
        ax: { has: "VAULT3-A 第一片。" }
      - label: transcript 里没有重复消息（同一条开头只出现一次）
        ax: { count: { pattern: "VAULT3-A 第一片。", exact: 1 } }
      - shot: 09-反复切换收口

---

# 253-harness-vault-activity —— 跨 vault 往返的在途准确

## 本场景在验什么

dogfood 现场：在 vault A 发问 → 切到 B → 切回 A，面板看上去空闲，一发就被后端 `harness_busy`
拒绝。根因是三条本地补偿（事件按 vault 过滤、`resetView` 把相位刷回 idle、快照没有在途读数）
叠加成「用错方向的补偿」——真相在后端（轮次状态机），前端的活干的是**在切回的时点把它读回来**。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` 与 `/tmp/lumir-m102-acceptance-b`；只发问、切 vault，
  不写 vault 文件。真实 vault 只读。
- 隔离 `XDG_CONFIG_HOME`；harness 留存落在 `env:harness/sessions/*/*.jsonl`。
- 耗时主要来自三轮 8s 片间隔与四次 vault 装载；本场景约 3–4 分钟。

## 覆盖边界

- 在途窗口依赖 mock 的片间隔（8s × 3 片）。若机器在装载上偶发超窗（切回时该轮已结束），
  场景会在「切回仍在途」一条判红——那不是产品缺陷，重跑即可（`--check` 与 `COVERAGE` 不受影响）。
- 跨 vault 完成的**未读**是 D3 非目标：本场景显式断言它不点亮（而非缺失覆盖）。
