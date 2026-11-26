---
# change preserve-composer-across-sessions-nov26（Alex 2026-11-26「采纳」）：
# 新建 / 选择会话只切换消息列表，composer 的文字、引用卡与盘上草稿原样保留；下一次发送进入
# 当前选中会话；草稿只在发送成功或用户手动删除时清除。
#
# 本场景走两条真实入口：「＋新会话」与「会话浮层选择历史会话（恢复）」。判据都走可观测面：
# AX 里的 composer 文本与卡片出处行（卡片出处行只在卡片节点上出现）、盘上草稿的 sha256
# （record + unchangedSince）、恢复后的新 JSONL 文件（opened_from=restore + 问题原文）。
# 引用卡由正文摘录手势插入（场景 84 同链路），覆盖「卡片跨会话保留」这一半。
id: "878-composer-preserve-across-sessions"
item: 878
tier: full
title: 新建 / 选择会话保留 composer（文字、引用卡与草稿；下一次发送进入当前会话）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
seed:
  registry:
    - { id: acc-preserve, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-preserve:
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

  - name: 第一条会话：输入并发送（造出一条历史会话供后面选择）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|prsvfirst" }
    text: "prsvfirst"
  - name: 发送第一条
    do: key
    key: enter

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

  - name: 输入要保留的问题（发送后焦点仍在 composer）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|preserve878" }
    text: "preserve878 keep this question"

  - name: 光标进编辑器（引用卡从正文摘录）
    do: clickEditor
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 下移到 HNL-BETA 那一行
    do: keys
    keys: ["ctrl+n", "ctrl+n"]
  - name: 扩选该行
    do: keys
    keys: ["ctrl+shift+n"]
  - name: 点浮动钮把摘录做成卡片
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: 引用卡入 composer（出处行只在卡片节点上出现）
        ax: { has: "harness-note.md · Harness 验收笔记" }

  - name: 等草稿防抖落盘
    do: settle
    expect:
      - label: 新建前草稿已含要保留的问题（正观测：草稿链路活着）
        file: { path: "env:harness/drafts/acc-preserve.json", has: "preserve878" }
      - shot: 02-新建前

  - name: 记录草稿基线
    do: record
    as: preserve-draft
    file: "env:harness/drafts/acc-preserve.json"

  - name: 点「＋新会话」（会话名钮是 AXPopUpButton，唯一叫「新会话」的 AXButton 是＋钮）
    do: click
    target: { role: AXButton, name: "^新会话$" }

  - name: 等新会话重置（transcript 回空态是 resetView 的正观测）
    do: waitFor
    waitFor:
      has: ["与当前文档对话"]
    timeoutMs: 15000
    expect:
      - label: 新建会话后 composer 文字仍在
        ax: { has: "preserve878 keep this question" }
      - label: 新建会话后引用卡仍在（出处行仍可从 AX 读到）
        ax: { has: "harness-note.md · Harness 验收笔记" }
      - shot: 03-新建会话后

  - name: 草稿未被删除（旧实现会在这里清盘上草稿）
    do: settle
    expect:
      - label: 盘上草稿逐字节未变（sha256 基线）
        file: { path: "env:harness/drafts/acc-preserve.json", unchangedSince: preserve-draft }
      - label: 草稿仍含问题原文
        file: { path: "env:harness/drafts/acc-preserve.json", has: "preserve878" }

  - name: 打开会话浮层（会话名钮带 aria-haspopup → AXPopUpButton）
    do: click
    target: { role: AXPopUpButton, name: "新会话" }

  - name: 等历史会话行出现
    do: waitFor
    waitFor:
      has: ["prsvfirst"]
    timeoutMs: 15000

  - name: 选中历史会话——恢复续聊
    do: clickInNode
    target: { name: "prsvfirst" }

  - name: 等恢复完成
    do: waitFor
    waitFor:
      has: ["/AXPopUpButton \\(prsvfirst/"]
    timeoutMs: 15000
    expect:
      - label: 恢复出的会话内容回到 transcript（只可能来自恢复的历史）
        ax: { has: "验收回答：上下文已收到。" }
      - label: 选择会话后 composer 文字仍在
        ax: { has: "preserve878 keep this question" }
      - label: 选择会话后引用卡仍在
        ax: { has: "harness-note.md · Harness 验收笔记" }
      - shot: 04-恢复会话后

  - name: 记录发送前正文（防止 Enter 漏进编辑器覆盖引用行）
    do: recordEditor
    as: preserve878-editor-before

  - name: 点 composer 卡片下方的空白输入区建立焦点（点卡片会按既定语义跳回正文）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么|preserve878", dy: 0.9 }

  - name: 发送保留下来的问题（下一次发送进入当前选中会话）
    do: key
    key: enter

  - name: 等发送被受理（composer 清空；历史回答不能冒充新一轮）
    do: waitFor
    waitFor:
      not: ["/AXTextArea = \"preserve878/"]
    timeoutMs: 30000

  - name: 断言发送落在恢复出的会话
    do: settle
    expect:
      - label: 保留的问题作为 transcript 静态文本上屏（不是 composer 自身的 AXTextArea）
        ax: { has: "/AXStaticText = \"preserve878 keep this question/" }
      - label: Enter 没有落进编辑器或覆盖引用行
        editor: { unchangedSince: preserve878-editor-before }
      - label: 恢复出的会话在首次真实请求时发布新文件（opened_from=restore）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"opened_from":"restore"' }
      - label: 问题原文进入该会话的 JSONL（下一次请求的 input）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "preserve878 keep this question" }
      - shot: 05-发送后
---

# 878 —— 新建 / 选择会话保留 composer

合同（change `preserve-composer-across-sessions-nov26`，Alex 2026-11-26「采纳」）：

- 新建或选择其他会话只切换消息列表；composer 的文字、引用卡、图片、Skill、光标与撤销历史全部
  保留；下一次发送到当前选中会话；
- 只有发送成功或用户手动删除才清除草稿；切 vault 仍恢复各 vault 自己的草稿（本场景不覆盖切
  vault，那一半由 change 的 chromium 场景与场景 135 分工）。

本场景覆盖两条真实入口：`＋新会话` 与 `会话浮层选择历史会话（恢复）`。判据设计：

- **文字**：`ax.has` 断言 composer 的 AX 文本里仍有问题原文（新建后、恢复后各一次）。
- **卡片**：出处行 `harness-note.md · Harness 验收笔记` 只在卡片节点上出现（正文里的同名文本
  不含文件名前缀），新建 / 恢复后各断言一次。
- **草稿**：`record` + `unchangedSince`（sha256）判「会话切换不改写盘上草稿」——比「文件还在」
  强一档；旧实现会 `putDraft("")` 删除，这一条直接判红。
- **下一次发送进入当前会话**：恢复后发送，断言新文件 `opened_from=restore` 且含问题原文；
  若发送落到别处（新会话 / 旧会话），这条 JSONL 判据不成立。

未覆盖（如实登记）：光标位置与撤销历史的真机判据（AX 读不到 caret / 编辑史，归 change 的
chromium 场景 `harness-composer-session-preserve-nov26.spec.ts`）；图片卡与 Skill 引用（同归
chromium 场景）；切 vault 的 per-vault 草稿恢复（场景 135 已覆盖）。
