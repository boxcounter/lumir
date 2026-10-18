---
id: "163-harness-auto-title-first-turn"
item: 163
title: 会话自动命名①：首轮完成后生成标题（标题栏 + 历史浮层行名 + JSONL decision=initial）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-title-initial.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮在场 = 本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入首轮提问（短标记：不参与漂移判定）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|zqtitle" }
    text: "zqtitle"
    expect:
      - label: 提问落在 composer 里（注入落地的正观测）
        ax: { has: "zqtitle" }

  - name: 发送
    do: key
    key: enter

  - name: 等回答到达 + 标题落到标题栏（命名调用是轮后的后台线程，事件驱动更新）
    do: waitFor
    waitFor:
      has: ["验收回答：标题已生成。", "/AXPopUpButton \\(Rust 生命周期排查/"]
    timeoutMs: 30000
    expect:
      - label: 标题栏会话名换成了生成的标题（标题优先于首条用户消息——若优先级反了这里会是 zqtitle）
        ax: { has: "/AXPopUpButton \\(Rust 生命周期排查/" }
      - label: 首轮命名落 decision=initial（JSONL sidecar，标题值在场）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"decision":"initial"' }
      - label: 记录带触发原因 first-turn
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"reason":"first-turn"' }
      - label: 记录带标题值（有效标题的唯一来源）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "Rust 生命周期排查" }
      - shot: 01-首轮标题

  - name: 等回合收口（无在途轮次——「＋新会话」要求非 busy）
    do: waitFor
    waitFor:
      not: ["/AXButton \\(停止\\)/"]
    timeoutMs: 15000

  - name: 点「＋新会话」把源会话切成历史会话（会话名钮带 aria-haspopup → AXPopUpButton，role 分流）
    do: click
    target: { role: AXButton, name: "^新会话$" }

  - name: 等新会话重置完成（transcript 回空态）
    do: waitFor
    waitFor:
      has: ["与当前文档对话"]
    timeoutMs: 15000

  - name: 打开会话浮层（此刻标题栏是「新会话」，标题串只可能出现在浮层行里）
    do: click
    target: { role: AXPopUpButton, name: "新会话" }

  - name: 等历史会话行出现（清单现拉现建——harness_list_sessions 往返）
    do: waitFor
    waitFor:
      has: ["Rust 生命周期排查"]
    timeoutMs: 15000
    expect:
      - label: 历史浮层行显示同一标题（列表与标题栏同一读取口径）
        ax: { has: "Rust 生命周期排查" }
      - label: 浮层真实渲染——包围盒完整、落在视口内，且区域内确有已绘制的字形（O1/O2 两段）
        geom:
          target: { name: "Rust 生命周期排查" }
          minWidth: 120
          minHeight: 16
          painted: { min: 60 }
      - shot: 02-浮层标题
---

# 163-harness-auto-title-first-turn —— 首轮生成标题（change add-session-auto-naming 5.3①）

## 本场景在验什么

1. 首轮对话正常完成后，命名调用产出标题，**标题栏会话名**立刻换成标题（不等 webview 重载）；
2. `session_title` sidecar 落盘：`decision=initial`、`reason=first-turn`、标题值在场；
3. 历史浮层里该会话行显示**同一个标题**（列举走同一读取口径）。

## 断言口径

- **标题只从后端来**：mock fixture 的 `titles` 队列给出 `{"decision":"rename","title":"Rust 生命周期排查"}`；
  前端不生成、不猜测标题，标题栏与浮层行都应当逐字显示它。
- **优先级可判**：首条用户消息是 `zqtitle`，若「标题优先」没生效，标题栏会显示 `zqtitle` 或
  「新会话」——`/AXPopUpButton \(Rust 生命周期排查/` 这条断言因此有区分度。
- **浮层行的独有性**：断言前先点「＋新会话」清空 transcript，此时标题串只可能来自浮层行
  （标题栏已回「新会话」）——与场景 106 同一做法。
- **事件驱动的等待**：`title` 事件是轮完成后的后台线程发出的（不是请求路径的一部分），
  故等待条件把「回答到达」与「标题栏换成标题」写在同一个 `waitFor` 里。
- **落盘键序**：`serde_json` 无 `preserve_order`，键按字典序（`decision` 在 `kind` 之前，
  `reason` 在 `title` 之前）——断言只用键值对子串，不写整行正则，键序变化不误判。

## 已知边界

- 命名调用的 stderr 诊断不判（用户面零可见错误：本场景的 `expect` 里没有任何错误行断言）。
- 标题硬上限（20 码点）与超过后的 invalid 分支留 Rust 单测（`harness::title::tests::parse_*`）。
