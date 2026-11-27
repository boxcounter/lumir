---
# change add-harness-message-withdraw-nov26（Alex 2026-11-26 节点 1：仅撤回最近一条；成功后删除
# 原会话 A、只留从撤回点开始的新会话 B；原文回到 composer 供编辑）。
#
# 判据分三层，每层都有区分度：
# 1. 显示面：撤回后 transcript 不再有该消息（`node` 按 AXStaticText 判在场性——正文里的字符串
#    不是节点，`ax.has/not` 会命中 composer 的值，没有区分度；**编辑器内部文本**（`AXTextArea`
#    的后代 `AXStaticText`，Composer 的 CodeMirror 正文也会出现在这里）同样不算节点，否则原文
#    一旦回到 composer，本判据恒红——真机 2026-11-27 的 882 现场；
# 2. composer 面：同一条文本出现在 `AXTextArea` 的值里（撤回前是 present:false——空 composer）；
# 3. 上下文面：撤回后改发另一句，盘上最新会话文件里**没有**被撤回的文本、且带
#    `opened_from":"withdraw"`；会话目录里只剩一份 JSONL（A 已物理删除）。
# 撤回钮 hover 才显形（读屏名 D1052「撤回这一轮」，悬停提示 D1089 说明完整后果；本场景走套件
# 的 AXPress 点击通道，hover 的视觉形态不在判据内——预览另留一张截图，形态归 Alex）。
id: "882-harness-withdraw-message"
item: 882
tier: full
title: 撤回最近一条用户消息：transcript 移除、原文回 composer、新会话 B 唯一且上下文不再含它
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
seed:
  registry:
    - { id: acc-withdraw, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-withdraw:
      panes:
        - { tabs: [harness-note.md], active: harness-note.md }
      ratio: 0.5
      harnessPane: true
steps:
  - name: 等 harness pane 按存储装配
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "问点什么"]
    timeoutMs: 40000
    expect:
      - shot: 01-起始态

  - name: 点 composer 建立输入焦点
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 输入要撤回的那一句
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|q882-WITHDRAW" }
    text: "q882-WITHDRAW"

  - name: 发送
    do: key
    key: enter

  - name: 在途撤回入口为 disabled：28×28 命中几何与「先停止」提示不变
    do: hover
    target: { role: AXButton, name: "^撤回这一轮$" }
    expect:
      - geom: { target: { role: AXButton, name: "^撤回这一轮$" }, minWidth: 28, minHeight: 28 }
      - ax: { has: 'help="先停止本轮，再撤回"' }
      - shot: 01b-在途disabled

  - name: 等第一轮回答
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    timeoutMs: 30000

  - name: 等回合收口（无在途轮次）
    do: waitFor
    waitFor:
      not: ["/AXButton \\(停止\\)/"]
    timeoutMs: 15000
    expect:
      - label: 撤回前：transcript 里有这条消息（AXStaticText 在场）
        node: { role: AXStaticText, name: "q882-WITHDRAW", present: true }
      - label: 撤回前：composer 是空的（同一条文本不在 AXTextArea 里）
        node: { role: AXTextArea, name: "q882-WITHDRAW", present: false }
      - label: 撤回入口的悬停提示说明完整后果（AX help=；change clarify-harness-withdraw-scope-nov27）
        ax: { has: 'help="撤回这条消息和它引发的回答、工具记录；原文回到输入框"' }
      - shot: 02-撤回前

  - name: 真实指针点复制左缘透明区（CGEvent mode=1；change improve-harness-action-targets-nov27）
    do: doubleClick
    target: { role: AXButton, name: "复制消息", nth: 0 }
    mode: 1
    dx: 0.04
    dy: 0.5
    expect:
      - label: 复制源逐字进入系统剪贴板
        clipboard: { exact: "q882-WITHDRAW" }
      - label: 既有 success 反馈仍在
        ax: { has: "✓ 已复制" }
      - geom: { target: { role: AXButton, name: "复制消息", nth: 0 }, minWidth: 28, minHeight: 28 }
      - geom: { target: { role: AXButton, name: "^撤回这一轮$" }, minWidth: 28, minHeight: 28 }
      - shot: 02a-复制success

  - name: 等复制 success 自动消退
    do: waitFor
    waitFor:
      not: ["✓ 已复制"]
    timeoutMs: 5000

  # 悬停入口 = 预览：本条消息 + 它的回答应被共同高亮（截图证据；像素形态归 Alex，套件不判）。
  - name: 悬停撤回入口（预览将被移除的那一段）
    do: hover
    target: { role: AXButton, name: "^撤回这一轮$" }
    expect:
      - shot: 02b-撤回预览

  - name: 点最后一条用户消息上的「撤回」
    do: click
    target: { role: AXButton, name: "^撤回这一轮$" }

  - name: 等新会话文件发布（B 的 opened_from=withdraw）
    do: waitForFile
    waitForFile:
      path: "env:harness/sessions/acc-withdraw/*.jsonl"
      has: '"opened_from":"withdraw"'
    timeoutMs: 20000
    expect:
      - label: transcript 不再显示被撤回的消息
        node: { role: AXStaticText, name: "q882-WITHDRAW", present: false }
      - label: 原文回到 composer（AXTextArea 的值）
        node: { role: AXTextArea, name: "q882-WITHDRAW", present: true }
      - label: 会话目录只剩一份 JSONL（A 已物理删除，只留 B）
        glob: { dir: "env:harness/sessions/acc-withdraw", pattern: "/[^/]+\\.jsonl$", exact: 1 }
      - label: B 里没有撤回前的文本（seed 只携带撤回点之前的前缀）
        file: { path: "env:harness/sessions/acc-withdraw/*.jsonl", not: "q882-WITHDRAW" }
      - shot: 03-撤回后

  - name: 把 composer 里的原文换成另一句（模拟编辑后重发）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|q882-" }
    text: "q882-replacement"
    replace: true

  - name: 发送替换后的消息
    do: key
    key: enter

  - name: 等第二轮回答
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    timeoutMs: 30000

  - name: 等回合收口
    do: waitFor
    waitFor:
      not: ["/AXButton \\(停止\\)/"]
    timeoutMs: 15000
    expect:
      - label: 新会话的请求里带的是替换后的消息
        file: { path: "env:harness/sessions/acc-withdraw/*.jsonl", has: "q882-replacement" }
      - label: 被撤回的文本没有随新请求回到模型上下文
        file: { path: "env:harness/sessions/acc-withdraw/*.jsonl", not: "q882-WITHDRAW" }
      - label: 仍是撤回产生的那一份（没有另开新文件）
        glob: { dir: "env:harness/sessions/acc-withdraw", pattern: "/[^/]+\\.jsonl$", exact: 1 }
      - shot: 04-重发后
---
