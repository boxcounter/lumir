---
id: "94-harness-thinking-absent"
item: 94
title: 无 reasoning 的响应整条 agent 消息零思考块（块数为零的反向验证）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-no-reasoning.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏；分栏态焦点落 composer）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮在场 = 本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问
    do: keys
    keys: ["n", "o", "t", "h", "k", "p", "r", "o", "b", "e"]
    expect:
      - label: 提问落在 composer 里（注入落地）
        ax: { has: "nothkprobe" }

  - name: Enter 发送（mock fixture 的这条响应不含 reasoning）
    do: key
    key: enter

  - name: 等回答到达
    do: waitFor
    waitFor:
      has: ["NOTHINK-ANSWER-01"]
    expect:
      - label: 回答正文渲染——**正观测**：agent 消息确实在场（「零块」不是「什么都没渲染」）
        ax: { has: "NOTHINK-ANSWER-01" }

  - name: 整条 agent 消息零思考块
    do: settle
    expect:
      - label: 折叠行计数为零（没有 reasoning ⇒ 不渲染空块——design §3「零噪声」）
        ax: { count: { pattern: "思考过程 ·", exact: 0 } }
      - label: 思考块正文标记也不在（与折叠行同一件的第二面判据）
        ax: { not: "THINK-BODY-ALPHA" }
      - shot: 01-无思考块
---

# 94-harness-thinking-absent —— 无 reasoning ⇒ 零思考块（change add-harness-thinking-display-and-effort §6.4）

## 本场景在验什么

mock fixture 的响应**不含** `reasoning` / `reasoning_chunks` ⇒ 该 agent 消息**不渲染任何思考块**
（design §3「无 reasoning 内容的消息不渲染块（不是渲染空块）——零噪声」）。

判据是**零块计数**（`ax.count` 上 `思考过程 ·` 命中数 = 0），配一条**正观测**：回答正文
（`NOTHINK-ANSWER-01`）必须在场。这一配对是设计 §6.4 明写的「防恒真空转」——如果 transcript
根本没渲染出 agent 消息，「零块」会在空输入上恒真；正观测把「零块」钉在「消息在、块不在」这个
真实形态上（REVIEW.md 第 1/2 条）。

## 为什么必须另起一个场景（而不是并进场景 93）

harness 面板的 mock fixture 由 front-matter 的 `config.harness.fixture` 在**起 app 之前**写进隔离
config.json（`run.mjs` 的 M284 口径），套件的 `configWrite` 动作**不覆盖 harness 段**（一次
configWrite 会把 harness 段整表抹掉），因此同一个 app 实例里换不了 fixture。而 93 的 transcript
里已有本轮带 reasoning 的思考块，AX 是全窗范围、没有消息级作用域 ⇒「零块计数」在 93 的现场恒
不为零。故反向验证必须是一个**独立起实例**的场景（本场景）。

## 断言口径

- **零块**用计数而不是负向子串：「命中 0 次」对「块在不在」是无歧义读数；负向子串只能证明「这
  一串不在」，对「有没有渲染一个空块」没有区分度。
- **`思考过程 ·` 是本场景唯一的块标记源**（D388 折叠行前缀）：思考块一旦渲染，折叠行必然带这
  串；本 fixture 的回答/提问串都不含它，计数不受别处文本干扰。
- `settle` 是断言前的稳定等待（等 rAF 合帧与轮次收尾落定），不是「等异步干完」——轮次终点由上面
  `waitFor` 的 `NOTHINK-ANSWER-01` 钉住。

## 环境与副作用

- 不写 vault 文件、不碰剪贴板；mock provider 只在内存里弹脚本。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；真实 vault 只读。1420 不碰。
