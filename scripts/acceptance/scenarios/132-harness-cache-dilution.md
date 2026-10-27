---
# M443（change harness-cache-metrics）：大块摊薄成因——单回合新增超过已缓存前缀的一半时，
# 控制行**仍是会话累计**。
# M533：气泡行集精简后成因句不再上屏（Alex 2026-10-16「气泡内容太冗余了」）——本场景改判
# 「摊薄回合的气泡里没有本回合行、没有成因句、没有写入行」，同时守住控制行读数不被摊薄改动。
id: "132-harness-cache-dilution"
item: 132
tier: full
title: Harness 缓存读数②：大块摊薄回合——控制行仍显示会话累计、气泡只剩用量行与命中率行（本回合 / 成因 / 写入行不上屏）
open: harness-note.md
marker: "HNL-ALPHA"
# 单轮 mock，数值取 M438 调查报告的实测形状（前缀 6612 全命中 + 新增 6174 工具输出 = input
# 12786 / cached 6400）：单回合 6400/12786 = 50.05% → 50%，新增 6386 > 已缓存 6400 的一半
# （3200）⇒ 后端会标 block_dilution。M533 后该标注没有上屏面：气泡里 MUST NOT 出现成因句，
# 本回合 50% 也不上屏（只有控制行那条「10% · 50%」能读到它，且它此刻恰等于会话累计）。
# cache_write_tokens = 0：M533 后写入行整行不存在（判定键与行都不在了）。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cache-dilution.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: composer 控制行在位（发送钮在场 = 本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问并 Enter 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|dilute" }
    text: "dilute"
    expect:
      - label: 提问落在 composer 里（注入落地的正观测）
        ax: { has: "dilute" }
  - name: 发送
    do: key
    key: enter

  - name: 等回答到达
    do: waitFor
    waitFor:
      has: ["摊薄回答。"]
    timeoutMs: 60000
    expect:
      - label: 控制行 = ctx 10%（12786/131072）· cache 50%（本回合恰是唯一样本 ⇒ 累计 == 单回合；
          摊薄不改主读数口径）
        ax: { has: "10% · 50%" }
      - shot: 01-控制行

  - name: hover 读数（锚点 = 读数左邻的权限 chip；ctx 读数在 AX 里没有 bbox）
    do: hover
    target: { anchor: { role: AXPopUpButton, any: "/权限模式/" }, offsetX: 24 }
    expect:
      - label: 用量行在场 = 本步的「气泡翻开」正观测（M526 起 D463 tokens 形态 + M532 起 k/m 单位）
        ax: { has: "/上下文：已用\\s*12\\.7k\\s*\\/\\s*131k\\s*tokens（10%）/" }
      - label: 命中率行只出百分比（M533 精简的 D465；单回合 50% 此刻等于会话累计 50%）
        ax: { has: "/缓存命中率\\s*（会话）\\s*：\\s*50%/" }
      - label: 本回合命中行不渲染（M533 退场；本回合 50% 这条读数不再有上屏面）
        ax: { not: "本回合缓存命中" }
      - label: 摊薄成因句不渲染（M533 退场——后端仍标 `block_dilution`，只是没有落点）
        ax: { not: "命中率被摊薄" }
      - label: 冷启动句也不在（该回合 cached != 0，后端本就不标冷启动）
        ax: { not: "本回合未命中缓存" }
      - label: 缓存写入行整行不渲染（M533 退场；本回合 cache_write_tokens = 0）
        ax: { not: "缓存写入" }
      - shot: 02-hover气泡

  - name: 移开读数（移到发送钮）——气泡收起
    do: hover
    target: { role: AXButton, name: "^发送$" }
    expect:
      - label: 移动后读数仍在屏上（正观测：这次读取真的读到了一个活着的面板）
        ax: { has: "10% · 50%" }
      - label: 气泡收起后含义行不在 AX 树里（负向断言的正观测 = 上一步曾读到用量行与命中率行）
        ax: { not: "缓存命中率" }
---

# 132-harness-cache-dilution —— 大块摊薄回合（M443 建、M533 重判）

## 本场景在验什么

Alex 的原始误判现场（2026-10-10「一个会话里 cache hit 很低，只有 50%」）就是这一回合的形状：
前缀全命中、又新增一大块内容（工具输出），**单回合**命中率被算术摊薄到 50%。M443 的落点是
「控制行显示会话累计 + 气泡里出摊薄成因句」；**M533 起成因句这条出口按 Alex 2026-10-16 的裁决
退场**（气泡只留「当前上下文使用量和百分比」与「会话的缓存命中率」两项），本场景随之重判为：

1. 控制行仍显示**会话累计**（此刻只有一个样本，故与单回合同为 50%——本场景不会因为改口径而变红，
   它判的是「末位含义行 + 警示行为空」这一面；两个读数分得开的场景见 131）。
2. 气泡里**没有**本回合命中行、没有成因句、没有缓存写入行——三组读数都只在 wire 留存里。
3. 越线警示句不在场（10% < 85%）。

## 断言口径与区分度

- **数值取自 M438 实测**：input 12786 / cached 6400 ⇒ 新增 6386 > 6400/2 = 3200 ⇒ 后端标
  `block_dilution`。改前本场景的第二条断言读的是成因句原文（把阈值改成「新增 > cached」
  （6386 < 6400）时必红）；**M533 后该句不上屏**，于是判据反转成 `not: "命中率被摊薄"`——
  区分度仍在：把成因句放回气泡（旧的 D454 行为）本步即红。
- **负向断言配正观测**：三条 `not`（本回合行 / 成因句 / 写入行）与 `not: "缓存命中率"`（气泡已收起）
  各自有同一步或上一步的「气泡在场」正观测（`上下文：已用 12.7k / 131k tokens（10%）`、
  `缓存命中率（会话）：50%`），不用「读不到就当没有」（REVIEW.md 「读不到当成空」条）。
- **后端判定链仍在覆盖之内**：`cache_note` 的判定真值表在 `src-tauri/src/harness/session.rs` 的
  单测里；上屏面退场后，前端只剩「不渲染它」这一条——本场景判的正是这条。
- 气泡断言写成换行容忍的正则（`\s*`），理由见场景 131 的同名条目。

## 覆盖边界

- 本场景不走 vault 切换，因此不复用 131 的会话键舞蹈；单轮会话不需要它。
- 真 provider 侧的成因判定不在真机层判（mock fixture 驱动的是同一条解析 → 判定 → 事件链）；
  M533 后成因标注只落 wire 留存，真机层的可读面是 `llm_response.usage` 的 file 断言
  （场景 105 / 133 覆盖留存面）。
