---
id: "82-quote-card-mixed-edit"
item: 82
title: 摘录卡片 ② 混排编辑区（光标落卡片下一行、一条消息挂两张卡片）
open: harness-quote.md
marker: "QALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: 把光标放进编辑器第 1 行
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 光标下移到 QBETA 那一行
    do: keys
    keys: ["ctrl+n", "ctrl+n"]
  - name: 光标归行首（列位置与点击无关，选择范围因此确定）
    do: keys
    keys: ["ctrl+a"]
  - name: ⌃⇧N 扩选（卡片 A 的摘录范围）
    do: keys
    keys: ["ctrl+shift+n"]
  - name: 点浮动钮把摘录 A 做成卡片（harness pane 此时关闭，自动分栏打开）
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: 卡片 A 入 composer（出处行在场）
        ax: { has: "harness-quote.md · 摘录卡片验收" }
      - shot: 01-卡片A

  - name: 直接在卡片下一行的问题段落写问题（证明插入后光标落在卡片下一行）
    do: keys
    keys: ["a", "l", "p", "h", "a"]

  - name: 发送第一条消息（一张卡片 + 一段问题）
    do: key
    key: enter
  - name: 等 mock 回答到达
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    expect:
      - label: 序列化按块交错顺序：卡片 A → alpha（问题落在卡片之后 = 光标落在卡片下一行）
        file:
          path: "env:harness/sessions/*.jsonl"
          has: '<quote file=\"harness-quote.md\" heading=\"摘录卡片验收\" lines=\"4-5\">QBETA 乙段：把可执行动作捞出来过一遍。\n</quote>\nalpha'
      - label: 协议无编号
        file: { path: "env:harness/sessions/*.jsonl", not: "index=" }
      - shot: 02-第一条消息

  - name: 第二条消息——回到编辑器：光标移到 QALPHA 那一行
    do: clickEditor
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 光标下移到 QALPHA 那一行
    do: keys
    keys: ["ctrl+n"]
  - name: 光标归行首
    do: keys
    keys: ["ctrl+a"]
  - name: ⌃⇧N 扩选（第一条摘录范围）
    do: keys
    keys: ["ctrl+shift+n"]
  - name: 点浮动钮做第一张卡片
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: 摘录入 composer（出处行在场）
        ax: { has: "harness-quote.md · 摘录卡片验收" }

  - name: 再摘一处（QBETA 那一行）
    do: clickEditor
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 光标下移到 QBETA 那一行
    do: keys
    keys: ["ctrl+n", "ctrl+n"]
  - name: 光标归行首
    do: keys
    keys: ["ctrl+a"]
  - name: ⌃⇧N 扩选
    do: keys
    keys: ["ctrl+shift+n"]
  - name: 点浮动钮做第二张卡片——一条消息挂两张卡片
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: composer 里两张卡片的摘录原文都在（同文档同标题，靠摘录文本区分）
        ax: { has: "QALPHA 甲段：先读结论再读论证。" }
      - shot: 03-两张卡片

  - name: 发送第二条消息（两张卡片、无问题文字）
    do: key
    key: enter
  - name: 留一拍等发送链路把 llm_request 落进 JSONL（AX 看不到 JSONL 落盘，mock 每轮都回同一文案，无法用它做同步）
    do: sleep
    ms: 2500
    expect:
      - label: 一条消息里两张卡片按插入顺序序列化（先 QALPHA 后 QBETA）
        file:
          path: "env:harness/sessions/*.jsonl"
          has: '<quote file=\"harness-quote.md\" heading=\"摘录卡片验收\" lines=\"3-4\">QALPHA 甲段：先读结论再读论证。\n</quote>\n<quote file=\"harness-quote.md\" heading=\"摘录卡片验收\" lines=\"4-5\">QBETA 乙段：把可执行动作捞出来过一遍。\n</quote>'
      - shot: 04-第二条消息
---

# 摘录卡片 ② 混排编辑区

spec 判据（change add-harness-quote-cards 的「混排对话输入区」）：对话输入区是混排编辑区，
卡片是原子 block 节点，问题文字在卡片之间的段落里；「摘录到对话」插入后**光标落到卡片下一行的
问题段落**；一条消息可挂多张卡片（承接「一次 pin 多个」需求）。

## 判据为什么这样写

- **「光标落卡片下一行」**：插入卡片 A 后立刻键入 `alpha`，序列化里 `</quote>\nalpha` 证明这段
  文字落在卡片之后。若光标落在卡片之前，`alpha` 会排在标签之前。
- **一条消息两张卡片**：第二条消息先摘 QALPHA（`lines=3-4`）再摘 QBETA（`lines=4-5`），逐字节
  断言两张卡片的序列化顺序——顺序倒置或丢卡都会红。
- 两处摘录同文档同标题，判据只能靠 `lines` 区分，顺带把「同文档相似摘录用 lines 消歧」这条
  会话纪律落在序列化层上。
- **第二条消息的同步用「留一拍」而非 waitFor**：mock provider 每轮都回同一条文案（fixture 每次
  调用按序弹响应，但 client 是**每轮新建**的，响应表因此每轮从第 0 条重来），所以「等回答文案」
  对第二条消息没有区分度。JSONL 的 `llm_request`（含这条 user 消息）在轮次开始（LLM 调用之前）就写入，2500ms 是
  留裕量的一拍（同 README「外部写入后先留一拍」的口径）。

## 已知边界（如实登记）

- **「段落中间拆段插入」与「问题文字夹在两张卡片之间」在真机手势路径上不可达**：浮动钮的出现
  前提是编辑器里有选区，点击它时焦点/选区在编辑器里，`insertQuoteCard` 读到的 composer 内选区
  必然为空，于是走「末尾块前缘」的兜底落点——新卡片恒插在 composer 最后一个块之前。要让问题文字
  落在两张卡片之间，需要 composer 在其后还留着一个空段落（真机只有经粘贴多行文本才能造出），
  因此本场景不构造该形态。拆段插入分支由单测（`tests/unit/harness-composer.test.ts` 的
  `insertCardAtCaret` 段落中间 case）与视觉场景覆盖。
- 卡片数不写 `ax.count`：transcript 里已发送的卡片带同一条出处行，计数会被上一轮消息污染。
