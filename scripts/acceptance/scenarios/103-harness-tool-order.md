---
id: "103-harness-tool-order"
item: 103
title: 工具行时序：先调工具后作答的轮次，定稿后工具行保持在最终回答之前（M374）
open: harness-note.md
marker: "HNL-ALPHA"
# 这条 mock 脚本的第 1 条响应 = 正文 ORD1 + vault_read 调用，第 2 条 = 最终回答 ORD2——
# 真实时序：ORD1 → 工具 → ORD2。M368 把工具清单挂到消息**末尾**后，ORD2 会把工具行
# 压到消息最后（「看上去像是先出回复才 tool use」，Alex 2026-10-07）；M374 改为
# 「文本段 + 工具块」按到达序交错，本场景用整树有序正则钉死这个顺序。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-tool-order.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 空闲态：发送钮在场
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问（可打印序列，注入回读校验由 keys 动作内部完成）
    do: keys
    keys: ["o", "r", "d", "r"]
    expect:
      - label: 提问落在 composer 里（注入落地——下一步 Enter 才有东西可发）
        ax: { has: "ordr" }
  - name: 发送
    do: key
    key: enter

  - name: 等工具循环跑完（vault_read → 回送 → ORD2 到达 = 本轮定稿）
    do: waitFor
    waitFor:
      has: ["ORD2-最终答案在工具之后。"]
    timeoutMs: 30000
    expect:
      - shot: 01-定稿后顺序
      - label: 有序性三判据（整树正则）：ORD1 → 工具行 → ORD2——工具行保持在它发生的
          文本段之前的原位（M374；旧实现工具块挂消息末尾，本正则必红）
        ax:
          has: '/ORD1-先读文件再回答。[\s\S]*vault_read\s*harness-note\.md[\s\S]*ORD2-最终答案在工具之后。/'
      - label: 工具行 = 徽章 + 人话化参数（M406 起成功行上屏形态，JSON 原文不上屏）
        ax: { has: '/vault_read\s*harness-note\.md/' }
      - label: 首轮正文保留（ORD1 与 ORD2 同轮共存）
        ax: { has: "ORD1-先读文件再回答。" }
      - label: JSONL 记下这次工具调用（wire 口径：llm_response 的 tool_calls）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"kind":"llm_response".*"id":"call_1","name":"vault_read".*$/' }
---

# 103-harness-tool-order —— 工具行时序（M374 缺陷①）

## 本场景在验什么

Alex 2026-10-07 原话：「tool use 明明在回复之前就出现，但当回复显示时 tool use 出现在了
末尾，看上去像是先出回复才 tool use」。根因：M368 把工具清单从 transcript 级挂到**消息级**
时挂点取在消息末尾，而 agent 轮次的真实时序是「先调工具、后作答」——定稿重渲后工具清单
稳居消息末尾，与发生顺序倒挂。

修复：消息本体改为「文本段 + 工具块」按到达序交错（harness-panel.ts 的 textSegments /
sealedToolBlocks），定稿按段全量重渲、工具块位置不动。本场景的有序正则
（ORD1 → 工具行 → ORD2）就是这条结构的不变量。

## 断言口径

- **有序性**：`ax.text` 是整棵 AX 树的扁平文本，有序正则 `/ORD1…[\s\S]*vault_read…[\s\S]*ORD2…/`
  一次读取里钉死三段相对位置（REVIEW.md 第 1 条的写法：先造必红输入——旧实现工具在
  ORD2 之后，本正则必红；区分度已自证）。相邻 span 在 AX 树里会被合并、分隔形态不固定，
  徽章名与参数之间用 `\s*` 容错（M406 口径）。
- **工具行形态**：M406 起成功行 = 工具徽章 + `humanizeToolArgs` 人话化参数（71 号场景同锚），
  参数 JSON 原文不再上屏。
- **单工具行不折叠**：≥2 行才折叠成摘要钮，本场景恰好 1 行，行本体就是断言锚。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；vault_read 只读
  harness-note.md，不写任何文件。1420 全程不碰（实例走 `LUMIR_ACCEPTANCE_PORT=1430`）。
