---
# M443（change harness-cache-metrics）：`cache_write_tokens` 遥测——wire 留存的 `llm_response.usage`
# 含原值（本回合值，provider 不提供时记 0）。
# M533：气泡行集精简后缓存写入**不再有上屏面**——本场景改判「写入行整行不渲染」（两轮都不渲染），
# 留存面断言原样保留（这是该遥测现在唯一的可读入口）。
id: "133-harness-cache-write"
item: 133
title: Harness 缓存读数③：缓存写入只进留存（本回合 + 按 0 记）、气泡不渲染写入行
open: harness-note.md
marker: "HNL-ALPHA"
# 两轮 mock：首轮 cache_write_tokens = 16000（写入非零）、次轮 = 0（确实没写 / provider 不提供）。
# M533 前判定键是**本回合值**（为 0 时该行不渲染）；现在两轮都不该出现这一行——首轮（16000）
# 与次轮（0）各判一次，区分度因此落在「非零值也不上屏」这条上（旧实现首轮会渲染出写入行）。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cache-write.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: composer 控制行在位（发送钮在场）
        ax: { has: "/AXButton \\(发送\\)/" }

  # ── 第一轮：写入非零（此刻只判留存与「不上屏」）────────────────────────────
  - name: 输入提问并 Enter 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|write" }
    text: "write"
    expect:
      - label: 提问落在 composer 里（注入落地的正观测）
        ax: { has: "write" }
  - name: 发送
    do: key
    key: enter
  - name: 等第一轮回答到达
    do: waitFor
    waitFor:
      has: ["写缓存回答。"]
    timeoutMs: 60000
    expect:
      - label: 控制行 = ctx 15%（20000/131072）· 会话累计 20%（4000/20000）
        ax: { has: "15% · 20%" }
      - label: 留存 usage 块含 cache_write_tokens 原值（wire 口径；provider 不提供时记 0，从不缺键
          ——M533 后这是写入遥测唯一的可读入口）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"kind":"llm_response".*"cache_write_tokens":16000.*$/' }
      - shot: 01-首轮-控制行

  - name: hover 读数（锚点 = 读数左邻的权限 chip；ctx 读数在 AX 里没有 bbox）
    do: hover
    target: { anchor: { role: AXPopUpButton, any: "/权限模式/" }, offsetX: 24 }
    expect:
      - label: 气泡在场（后续负向断言的正观测；M526 起 D463 tokens 形态 + M532 起 k/m 单位）
        ax: { has: "/上下文：已用\\s*20k\\s*\\/\\s*131k\\s*tokens（15%）/" }
      - label: 命中率行只出百分比（M533 精简的 D465：本回合 4000/20000 = 20%，此刻等于会话累计）
        ax: { has: "/缓存命中率\\s*（会话）\\s*：\\s*20%/" }
      - label: 缓存写入行不渲染——**本回合值 16000 非零也不上屏**（M533 退场；旧实现这一行在场，
          本步因此对旧行为判红）
        ax: { not: "缓存写入" }
      - shot: 02-首轮-hover气泡

  - name: 移开读数（移到发送钮）
    do: hover
    target: { role: AXButton, name: "^发送$" }
    expect:
      - label: 移动后读数仍在屏上（正观测：面板活着）
        ax: { has: "15% · 20%" }
      - label: 气泡收起（前一步读到过含义行）
        ax: { not: "缓存命中率" }

  # ── 第二轮：本回合写入为 0（留存记 0；气泡依旧不出写入行）─────────────────────
  - name: 点 composer 聚焦
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 输入第二个提问并发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|again" }
    text: "again"
  - name: 发送
    do: key
    key: enter
  - name: 等第二轮回答到达
    do: waitFor
    waitFor:
      has: ["零写入回答。"]
    timeoutMs: 60000
    expect:
      - label: 控制行 = ctx 17%（22000/131072）· 会话累计 60%（25000/42000，跨回合累计）
        ax: { has: "17% · 60%" }
      - label: 次轮留存 usage 的 cache_write_tokens 记 0（provider 不提供该字段时按 0，不留缺键）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"kind":"llm_response".*"cache_write_tokens":0.*$/' }
      - shot: 03-次轮-控制行

  - name: hover 读数
    do: hover
    target: { anchor: { role: AXPopUpButton, any: "/权限模式/" }, offsetX: 24 }
    expect:
      - label: 气泡在场（= 本次读取真的读到了翻出的气泡，零值断言的输入成立；M526 起 tokens 形态 + M532 起 k/m）
        ax: { has: "/上下文：已用\\s*22k\\s*\\/\\s*131k\\s*tokens（17%）/" }
      - label: 命中率行 = 60%（会话累计跨回合；M533 精简的 D465 只出百分比）
        ax: { has: "/缓存命中率\\s*（会话）\\s*：\\s*60%/" }
      - label: 本回合命中行不渲染（M533 退场；本回合 21000/22000 = 95% 这条读数不再有上屏面）
        ax: { not: "本回合缓存命中" }
      - label: 缓存写入行整行不渲染（本回合值为 0，且 M533 后该行已不存在）
        ax: { not: "缓存写入" }
      - shot: 04-次轮-hover气泡

  - name: 移开读数
    do: hover
    target: { role: AXButton, name: "^发送$" }
    expect:
      - label: 移动后读数仍在屏上（正观测：面板活着）
        ax: { has: "17% · 60%" }
      - label: 气泡收起（前一步读到过含义行）
        ax: { not: "缓存命中率" }
---

# 133-harness-cache-write —— 缓存写入遥测（留存面，M443 建、M533 改判）

## 本场景在验什么

change `harness-cache-metrics` 的第二条（M438 清单第 5 项）：把 provider usage 里的
`cache_write_tokens` 纳入留存——「一个 50% 的单回合读数里，未命中部分有一部分是**必要的缓存
写入成本**而非浪费」这件事此前人对它是盲的。M443 的落点是两处：wire 留存 + 气泡第四行。

**M533 起第二处按 Alex 2026-10-16 的裁决退场**（气泡只留「当前上下文使用量和百分比」与
「会话的缓存命中率」两项），本场景随之重判为：

1. **留存面（不变）**：`llm_response.usage` 块含 `cache_write_tokens` 原值；provider 不提供该
   字段时记 **0**（不留缺键）。这是该遥测现在唯一的可读入口（诊断仍是「翻 JSONL」这条路径）。
2. **上屏面（新判据）**：气泡里 MUST NOT 出现缓存写入行——**首轮值非零（16000）也不出现**，
   次轮（0）同样不出现。旧实现首轮会渲染出这一行，本步因此对它判红。

## 断言口径与区分度

- **两轮的写入值刻意不同**（16000 / 0）：留存断言因此分得出「首轮记录了非零写入」与「次轮记为
  0」两条（同一份 JSONL 里两行同时在场，各自的判据互不吞没）——这两条 M533 后一条未改。
- **「不上屏」的判据带正观测**：断言 `缓存写入` 不在 AX 树里的同一步里，先断气泡在场
  （`上下文：已用 20k / 131k tokens（15%）` / `缓存命中率（会话）：20%`）——「读不到」不等于
  「没有」（REVIEW.md 「读不到当成空」条）。区分度反向：把写入行放回气泡（旧行为）本步即红；本场景两轮
  各判一次，非零值那轮正是旧实现的"在场"点。
- 气泡断言写成换行容忍的正则（`\s*`），理由见场景 131 的同名条目。

## 覆盖边界（如实登记）

- **真 provider 上这一行本就常态不出现**：Kimi Code 端点（`api.kimi.com/coding/v1`，model
  `k3-256k`）实测 `cache_write_tokens` 恒报 0（2026-10-11 冒烟，现场 `src-tauri/tests/harness_real_kimi_cache.rs`
  的模块文档与 change design §6），DeepSeek 无该字段 ⇒ 真机上「本回合值非零」的形态只可能来自
  mock。本场景判的是**链路正确性**（解析 → 累计 → 事件 / 快照 → 留存），不是「这个数在真 provider
  上一定有值」——后者是读数事实，不是能力断言。
- 状态条（`metrics.md` 之类的趋势图）不在 M443 范围（Non-goals），M533 也未引入任何替代展示面。
