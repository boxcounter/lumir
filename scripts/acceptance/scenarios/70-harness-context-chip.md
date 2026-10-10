---
id: "70-harness-context-chip"
item: 70
title: Harness ① 上下文 chip：视口口径（选区不再自动注入）+ 随消息注入路径与视口行号（不含原文）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: 把光标放进第 1 行（点编辑器正文起点）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里（键盘注入的前置）
        ax: { focused: "AXTextArea" }
  - name: 抢前台（后台注入的 chord 在前台被抢时会丢键——REVIEW.md 第 11 条）
    do: focusWindow
    retries: 4
  - name: ⌃⇧N 两次把选区扩到第 3 行——**选区不再改变注入口径**（见下「改口径」注）
    do: keys
    keys: ["ctrl+shift+n", "ctrl+shift+n"]

  - name: ⌘⇧A 打开 harness pane——chip 显示上下文（发送前可核对）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（分栏成立，D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位（发送钮在场是本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: chip 是「视口」口径，带文件路径与行范围（即使编辑器里有选区）
        ax: { has: "/上下文：harness-note\\.md · 视口 \\d+–\\d+ 行/" }
      - shot: 01-视口-chip

  - name: 输入提问并 Enter 发送
    do: keys
    keys: ["c", "t", "x", "p", "r", "o", "b", "e"]
  - name: 发送
    do: key
    key: enter

  - name: 等 mock 回答到达
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    expect:
      - label: 回答渲染在面板里
        ax: { has: "验收回答：上下文已收到。" }
      - label: 提问以 llm_request 落盘（wire 口径：user 消息在 request.messages）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*"kind":"llm_request".*ctxprobe.*$/' }
      - label: 注入的上下文节在 llm_request 里（文件路径 + 视口节头）
        file: { path: "env:harness/sessions/*.jsonl", has: "/当前编辑器上下文：\\\\n文件：harness-note\\.md\\\\n视口（第/" }
      - label: 视口节到行号为止、紧跟收尾方括号（M412：节里没有原文段）
        file: { path: "env:harness/sessions/*.jsonl", has: "/视口（第 \\d+-\\d+ 行）\\]/" }
      - label: 选区**没有**被自动注入（remove 后的合同：选中片段只经摘录卡片显式策展）
        file: { path: "env:harness/sessions/*.jsonl", not: "选区（第" }
      - label: 视口原文**不再**随消息注入（M412：视口覆盖内的标题行不进 JSONL）
        file: { path: "env:harness/sessions/*.jsonl", not: "# Harness 验收笔记" }
      - shot: 02-回答到达
---

# 70-harness-context-chip —— 上下文 chip 与注入口径（change add-harness-probe §8，
# add-harness-quote-cards 修订后；M412 视口原文移除）

## 本场景在验什么

spec 判据（harness「上下文注入与可见性」）：打开 harness pane 后面板显示**可核对**的上下文
chip（路径 + 行范围）；随消息注入同一份上下文。现行口径（`src/harness-context.ts` 的文件头
是 canonical 居所）：

- 当前 TAB 的 vault 相对路径**恒注入**（有活动文件时）；
- 消息未携带引用卡片时注入**视口行范围**（起止行号）——M412 起**不注入该范围的原文**；
- 消息携带引用卡片时跳过视口注入（场景 83/85 覆盖）；
- **选区 SHALL NOT 被自动注入**——选中片段一律经「摘录引用卡片」手势显式策展。

## 改口径沿革（本场景为何整段重写，M349；M412 再改注入侧）

`add-harness-quote-cards`（M345，2026-10-06 合并）的 tasks 4.1「选区自动注入移除；路径注入
保留；视口注入在无卡片时保留、携带卡片时跳过；可核对 chip 口径更新」把**选区自动注入整条移除**，
D331（chip 的选区形态）随之退场。本场景（item 70）当时没跟着改，于是在 M349 真机批次里红了两次
（根因不是 pane 化、也不是丢键；`test-results/acceptance/2026-10-06/70-harness-context-chip/`）：
注入串变成 `视口（第 1-6 行）`，而断言还在找 `选区（第`。旧断言「选区 N–M 行」的现场见
`test-results/acceptance/2026-10-04/70-harness-context-chip/steps.md`（当时 PASS）。

**M412 再改注入侧**：Alex 指出「我发的每个消息都会带视口 context 的原文，很冗余，浪费上下文」，
裁决视口块只留行号、去原文。因此本场景的**注入侧**由「路径 + 视口节头 + 原文」收紧为「路径 +
视口行号」，原文那两条断言翻成负向（见下）。

**保留 ⌃⇧N 扩选这一步是有意的**：新合同的最强判据不是「不选时注入视口」，而是「**即使编辑器里
有选区**，注入的仍是视口」——所以先造一个选区，再断言 chip 与 JSONL 双面都是视口口径。
（⌃⇧N 是盲发 chord、可能丢键；丢了这一步退化成「无选区时也是视口」，断言照样成立、不倒向假绿：
`not: "选区（第"` 仍会挡住任何自动选区注入。）

## 断言口径

- **chip 口径**：`/上下文：harness-note\.md · 视口 \d+–\d+ 行/`——D332 的视口形态，仅由 chip
  渲染产出。`–` 是 en dash（U+2013），不是连字符。
- **chip 位置（M370）**：chip 移进 composer 区（横线之下、composerBox 之上）——本场景的
  AX 断言全部按文本匹配，位置变化不影响判据；两张截图（01/02）的构图因此与旧基线不同，
  像素面归视觉基线纪律（本场景截图只作证据，不断言像素）。
- **注入侧**用 JSONL 留存的 `llm_request.request.messages` 全文断言：文件路径节 + 视口行号节，
  且视口节到 `行）` 为止、紧跟收尾 `]`（`/视口（第 \d+-\d+ 行）\]/`）——节里没有原文段。
  wire 口径下用户消息不是独立的事件 kind，而是该次请求 messages 的 user 项。
- **负向断言①`not: "选区（第"`** 是「选区不再自动注入」的判据：该串只在旧的选区注入形态里出现，
  移除后任何路径都不该产出它。
- **负向断言②`not: "# Harness 验收笔记"`** 是「视口原文不再注入」的判据（M412）：该标题行在
  M412 之前正是随视口原文进 JSONL 的那串，因此这条负向**有区分度**（旧实现下必红）；它不得进
  JSONL——本场景无工具调用（mock 直答），文档正文除了视口注入没有别的进上下文路径，所以这条
  负向不可能被别的来源误伤。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；真实 vault 只读。
- 只读文档、发一条 mock 提问；JSONL 落在隔离配置目录的 `sessions/` 下（`env:harness/sessions/*.jsonl`）。1420 全程不碰。
