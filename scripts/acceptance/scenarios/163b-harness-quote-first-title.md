---
# M669（补 M667 任务 4 未完成的一半）：quote 首条消息 → 命名事件 → **标题栏与已开浮层行**
# 同一条事件里即时更新。
#
# 为什么不能并进场景 163：163 是「先收口、再开浮层读行名」——它证明两处口径一致，但证明不了
# **已开着的浮层行会跟着改名**。M662 的现场恰在那条路径上：行名按「上屏名」匹配改名
# （`retitleOpenSessRows`），前后端回落口径不一致时行停在旧名（`<quote file="…`）。
# 本场景把「浮层开着等命名事件」做成可判读数：浮层行是 AXMenuItem、标题栏会话名是
# AXPopUpButton，role 分流让两条断言各打各的面（`node` 断言，不是整棵树文本匹配）。
#
# 时间窗：mock 响应 `delay_ms: 8000`——发送后先落 wire、再开浮层、最后命名事件到达。
#
# M671（Alex 2026-10-24 现场）：quote 卡片进 composer 后焦点没有搬进输入区——「quote 完想
# 直接打字，字会落进编辑器」。本场景因此**不点 composer**：卡片插入后直接键入，「键入落在
# 哪一侧」就是产品焦点归属的判据（正文「当前状态」段记着假绿形态与判据分层）。
id: "163b-harness-quote-first-title"
item: 163
title: 会话自动命名②：quote 首条消息 → 命名事件 → 标题栏与已开历史浮层行同步改名
open: harness-quote.md
marker: "QALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-title-quote.json"
steps:
  - name: 把光标放进编辑器第 1 行（**真实鼠标单击**：同时建立 DOM 焦点、key window 与 webview 焦点）
    do: clickEditor
    real: true
    retries: 4
    # 本场景的键盘注入（⌃N / ⌃⇧N）与随后的真实点击都要求 webview 先有焦点。M670 实测：
    # `focusWindow click: true` 打的是标题栏拖拽区（`data-tauri-drag-region="deep"`），那一下
    # 只让 webview **失去**焦点，此后鼠标移动与键盘注入整批停投（finding
    # 20261024-worker-image-hover-quote-oct24-bug-focuswindow-click-true-wkwebview.md）；
    # 建立焦点的确定手段是正文里的真实单击（与场景 222 同一条通道）。
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: 光标下移到第 3 行（标题行 + 空行之后）
    do: keys
    keys: ["ctrl+n", "ctrl+n"]

  - name: ⌃⇧N 选中第 3 行（场景 81 的同款配方）
    do: keys
    keys: ["ctrl+shift+n"]

  # 浮现是**延迟**的（M541 时机门：键盘选区静默 `GESTURE_SETTLE_MS`=350ms 后才出钮），`keys`
  # 注入返回时计时器通常还没到点——立即断言读到的是「尚未浮现」，是一条随机器负载漂的假红
  #（2026-10-24 本场景实测：同一次运行里紧接着的 click 步能找到这颗钮）。等这个可观测终态。
  - name: 等浮动「摘录到对话」钮浮现
    do: waitFor
    waitFor:
      has: ["/AXButton \\(摘录到对话\\)/"]
    timeoutMs: 10000
    expect:
      - label: 浮动「摘录到对话」钮在场（选区建立的正观测）
        ax: { has: "/AXButton \\(摘录到对话\\)/" }

  - name: 点浮动钮 → harness pane 自动分栏、卡片入 composer、焦点搬进输入区
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: harness pane 自动分栏打开（分隔条在位）
        ax: { has: "分隔条" }
      - label: 卡片带出处行（文档名 · 最近一级标题）
        ax: { has: "harness-quote.md · 摘录卡片验收" }
      - shot: 01-卡片入composer

  - name: 记下编辑器基线（下一步的落点判据要逐字节比较）
    do: recordEditor
    as: 编辑器基线-键入前

  # M671：本步**不点 composer**。产品行为 = 卡片插入后焦点已在输入区，用户可以直接打字；
  # 注入落在哪一侧就是焦点归属的判据（串里不含 'e'——press_key 在本机确定性丢 'e'，M497）。
  - name: 直接键入问题（卡片之外的那段正文正是回落名的数据源）
    do: keys
    keys: ["q", "q", "m", "a", "r", "k"]
    gapMs: 100
    expect:
      - label: 问题落在 composer
        ax: { has: "qqmark" }
      - label: 编辑器正文逐字节未变——注入没有漏进仍有焦点的编辑器（M669 中间一轮 01:49 的真实形态；本步唯一能抓到「焦点没搬进输入区」的判据）
        editor: { unchangedSince: 编辑器基线-键入前 }

  - name: 发送（mock 响应刻意延迟 8s，留出「浮层先开、命名事件后到」的窗口）
    do: key
    key: enter

  - name: 等首条消息落进 wire（浮层清单从这里读；也是 quote 形态的正观测）
    do: waitForFile
    waitForFile:
      path: "env:harness/sessions/*/*.jsonl"
      has: "<quote file="
    timeoutMs: 20000
    expect:
      - label: 首条用户消息是 quote 形态（XML 块进了 wire）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "<quote file=" }

  - name: 命名事件之前先打开历史浮层（本场景的关键前置：浮层开着等改名）
    do: click
    target: { role: AXPopUpButton, name: "新会话|qqmark" }

  - name: 等浮层行出现——行名是回落口径的段落文本
    do: waitFor
    waitFor:
      has: ["/AXMenuItem \\(qqmark/"]
    timeoutMs: 20000
    expect:
      - label: 浮层行在场且行名 = 回落名（段落文本）
        node: { role: AXMenuItem, name: "qqmark", present: true }
      - label: 回落名里没有 XML 前缀（M662 修的正是这一处）
        ax: { not: "<quote file=" }
      - shot: 02-浮层行-回落名

  - name: 等命名事件：已开的浮层行随标题事件即时改名
    do: waitFor
    waitFor:
      has: ["/AXMenuItem \\(引用首问命名/", "验收回答：引用问题已收到。"]
    timeoutMs: 30000
    expect:
      - label: 已开的浮层行即时换成生成的标题（按上屏名匹配改名命中的正观测）
        node: { role: AXMenuItem, name: "引用首问命名", present: true }
      - label: 旧回落名退场（行没有停在旧名上）
        node: { role: AXMenuItem, name: "qqmark", present: false }
      - label: 标题栏会话名同步换成同一标题（两处同一口径）
        node: { role: AXPopUpButton, name: "引用首问命名", present: true }
      - label: 首轮命名落 decision=initial（JSONL sidecar）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"decision":"initial"' }
      - label: 记录带触发原因 first-turn
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"reason":"first-turn"' }
      - shot: 03-浮层行-标题即时更新
---

# 163b-harness-quote-first-title —— quote 首条消息的命名呈现

## 当前状态（M671）

- **M669 r1 的两层红都已落地**：第一层「⌃⇧N 选区 → 浮动钮不浮现」归 M670（根因是场景层
  拿 `focusWindow click: true` 去「抢 key window」，标题栏拖拽区那一下让 webview 失焦，此后
  鼠标移动与键盘注入整批停投；2026-10-24 01:57 场那 9 断言 / 8 红全部是它的级联）。
  本场景照 222 改成的配方：正文**真实鼠标单击**（`clickEditor real: true`）建立焦点。
- **第二层（本场景现在的判据面）**：卡片插入后**焦点是否搬进 composer**。M671 之前本场景用
  `clickInNode` 点 composer 再注入——那一步把「产品是否搬了焦点」整个绕过去，是**假绿**形态
  （产品没搬，场景照样绿）。现在删掉它：卡片插入后直接键入，落点即判据。

## 本场景在验什么

M659/M662 的会话自动命名在**quote 首条消息**这条路径上的用户面：

1. quote 卡片进 composer 后焦点落在输入区，用户可以直接打字（M671）：键入进 composer、
   编辑器逐字节不变；
2. quote 首条消息（摘录卡片 + 一段问题文字）发出去后，命名调用照常触发，标题事件到达；
3. **已开着的历史浮层行**随事件即时改名（`retitleOpenSessRows` 命中的正观测）；
4. 标题栏会话名与浮层行在同一事件里换成同一标题；
5. `session_title` sidecar 落 `decision=initial` / `reason=first-turn`。

## 判据为什么这样写

- **键入落点 = 焦点归属的判据，不是 `ax: { focused: "AXTextArea" }`**：编辑器的正文与
  composer 在 AX 里**同为 AXTextArea**，`focused` 断言分不出是哪一侧（M500/M502 已实证：
  focused 标记可以与 `type_text` 的真实投递背离）。因此判据写成「键入后 composer 里有串
  （正观测）+ 编辑器逐字节未变（区分度判据）」——焦点落在编辑器时第一条也可能绿（整棵 AX
  树里都有该串），第二条必红。这就是本步不能省 `editor.unchangedSince` 的理由。
- **两步注入之间的基线**：`recordEditor` 必须记在键入之前、卡片插入之后（编辑器正文在这一
  段里不会被产品改写；基线记早了一旦有别的步骤写编辑器，这条判据就会变成假红）。
- **浮层必须「先开、事件后到」**：163 已经覆盖「事件 → 标题栏 → 重开浮层读行名」；本场景换
  的是**已开浮层**那条路径——它是 M662 现场的唯一可判面（行名按上屏名匹配改名，口径一歪
  行就停在旧名上）。mock 响应的 `delay_ms: 8000` 造出这个窗口；`waitForFile` 先证 wire 已
  落（浮层清单的数据源），再开浮层。
- **role 分流让两条断言各打各的面**：浮层行是 `AXMenuItem`（名字带「N秒前」），标题栏会话名
  是 `AXPopUpButton`——`node` 断言按 role + name 定位，两处同名也不会互相满足。整棵树文本
  匹配分不出「行改了」与「标题栏改了」（M669 给套件加的 `node` 断言正是为此）。
- **旧名退场是独立判据**：`node: { role: AXMenuItem, name: "qqmark", present: false }`——改名
  没命中时行名会停在 `qqmark`，这一条必红（不是「标题串出现就算过」）。
- **回落名的来源**：composer 是「quote 卡片 + 一段段落文字」，回落口径取第一个非空**段落**
  块（`firstUserTextOf` / 后端 `first_paragraph_text` 同口径），段落是 `qqmark`。因此浮层行
  在命名前应当显示 `qqmark`，而不是 XML 序列化文本（M662 修的现场）。
- **前台前提**：正文真实单击同时建立 DOM 焦点、key window 与 webview 焦点——`focusWindow`
  本身只保证 app 在前台，窗口未必是 key window；而 `focusWindow click: true` 的标题栏单击
  会让 webview 失焦（M670）。键盘注入与真实点击的前台纪律以正文单击为准。

## 已知边界

- 命名调用的 stderr 诊断不判（用户面零可见错误）。
- 标题的截断 / 硬上限（20 码点）与 fallback 的跨语言对齐各有单测
  （`tests/unit/session-name-fallback.test.ts` 与 `harness::title` 的单测），本场景只证真机上
  的呈现链路。
- 标题事件与浮层清单拉取的竞态：`waitForFile` 之后再开浮层，清单来自已落盘的 wire；若产品
  在「清单拉取期间」完成改名，`retitleOpenSessRows` 会按旧名匹配不到（该行此刻尚未渲染）——
  这种情形在本场景的延迟窗口下不会出现（8s 远大于清单往返）。
- 键入通道：`do: keys` 逐键注入对 composer 会丢 'e'（M497）——本场景的素材串 `qqmark` 不含
  'e'；`typeInNode` 不适用（它的 attempt-1 焦点守卫会在目标没持焦时先点目标，恰好把本场景要
  判的「焦点有没有搬过去」mask 掉）。
