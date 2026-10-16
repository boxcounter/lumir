---
# M526：ctx/cache hover 气泡的 **tokens 读数**——第一行上下文已用/上限 tokens + 百分比（D463）；
# M533：气泡行集精简为「用量行 + 会话缓存命中率行（只百分比）+ 越线警示行」，本回合命中行 /
#   缓存写入行 / 成因句退场——本场景同时判这两条退场（负向断言配正观测）。
# M532：气泡内 tokens 数字走 k/m 单位（≥1,000,000 → m、≥1,000 → k、千位以下原值直出）——
#   本 fixture 的数落在 1k 档（1000 → 1k、131072 → 131k）。
id: "155-harness-ctxpop-tokens"
item: 155
title: "Harness 气泡读数：上下文已用/上限 tokens（k/m 单位）+ 会话命中率（只百分比）；本回合 / 写入行不渲染；空会话无假读数"
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: composer 控制行在位（发送钮在场——本条是正观测，配合下一条负向断言）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 空会话无假读数（M526：从未发过请求 ⇒ has_usage=false ⇒ 读数区整体隐藏，不出现「0% · 0%」）
        ax: { not: "/[0-9]+% · [0-9]+%/" }

  - name: 输入提问并 Enter 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|tokval" }
    text: "tokval"
    expect:
      - label: 提问落在 composer 里（注入落地的正观测）
        ax: { has: "tokval" }
  - name: 发送
    do: key
    key: enter
  - name: 等第一轮回答到达
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    timeoutMs: 30000
    expect:
      - label: 控制行 = ctx 1%（1000/131072）· 会话累计 10%（100/1000）
        ax: { has: "1% · 10%" }
      - label: 留存 usage 块带 input/cached 原值（气泡 tokens 读数的数据源）
        # 键序：usage 块落盘字典序 cached_tokens 在 input_tokens 之前（serde_json 无 preserve_order；
        # 场景 76 同纪律），正则键序必须与落盘序一致，否则真机必 FAIL。
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"kind":"llm_response".*"cached_tokens":100.*"input_tokens":1000.*$/' }
      - shot: 01-首轮-控制行

  - name: hover 读数（锚点 = 读数左邻的权限 chip；ctx 读数在 AX 里没有 bbox，与场景 133 同锚）
    do: hover
    target: { anchor: { role: AXPopUpButton, any: "/权限模式/" }, offsetX: 24 }
    expect:
      - label: 气泡第一行 = 上下文已用/上限 tokens + 百分比（D463：1000 → 1k、131072 → 131k · 1%）
        ax: { has: "/上下文：已用\\s*1k\\s*\\/\\s*131k\\s*tokens（1%）/" }
      - label: 气泡第二行 = 会话缓存命中率**只出百分比**（M533 的 D465：`cached_tokens_session`
          在场（100）也不进这一行——这正是 Alex 那轮裁决的 supersede）
        ax: { has: "/缓存命中率\\s*（会话）\\s*：\\s*10%/" }
      - label: 本回合命中行整行不渲染（M533 退场；下面的负向断言以本步两条在天行为正观测）
        ax: { not: "本回合缓存命中" }
      - label: 缓存写入行整行不渲染（M533 退场；本 fixture 本就缺 cache_write_tokens）
        ax: { not: "缓存写入" }
      - label: 成因句也不上屏（M533 退场——本回合 input−cached = 900 > cached÷2 = 50 本会标
          `block_dilution`，此刻两句话都不该在任何行里）
        ax: { not: "被摊薄" }
      - shot: 02-首轮-hover气泡

  - name: 移开读数（移到发送钮）
    do: hover
    target: { role: AXButton, name: "^发送$" }
    expect:
      - label: 移动后读数仍在屏上（正观测：面板活着）
        ax: { has: "1% · 10%" }
      - label: 气泡收起（前一步读到过含义行）
        ax: { not: "上下文：已用" }
---

# 155-harness-ctxpop-tokens —— ctx/cache 气泡的读数与行集（M526 建、M533 改）

## 本场景在验什么

Alex 原话（M526）：「ctx • cache 的 hint 里显示具体的 tokens 使用量。」change 落点：

1. **Rust 侧 `UsageSnapshot` 补绝对值字段**：`input_tokens` / `cached_tokens` /
   `cached_tokens_session` / `context_window`（+ `has_usage` 真读数判据），`record_usage` 与
   留存重算共用同一算法（`CacheTotals::snapshot`）。
2. **气泡第一行进 tokens 形态**：上下文用量行「上下文：已用 {used} / {limit} tokens（{ctx}%）」
   （D463，无上限值时降级 D464）；绝对值缺键（旧后端载荷）时回落 M378 的百分比形态（D395）。
3. **气泡 tokens 数字走 k/m 单位（M532）**：≥1,000,000 → `m` 档、≥1,000 → `k` 档、千位以下
   原值直出；小数截断到 0.1 档、末尾 `.0` 去掉。本场景的 `1000 → 1k`、`131072 → 131k` 两条是
   真机层唯一的单位形态判据。
4. **空会话不假读数**：从未发过请求的会话 `has_usage=false` ⇒ 读数区整体隐藏（「0% · 0%」
   虚报口径退场）。
5. **行集精简（M533）**：Alex 2026-10-16 裁决气泡只需「当前上下文使用量和百分比」与「会话的
   缓存命中率」两项 ⇒ 命中率行只出百分比（D465 改写，M526 的 cache tokens 读数与 M378 的
   百分比回落形态并入），本回合命中行 / 缓存写入行 / 成因句整批退场。**退场的只是上屏面**：
   `cache_pct_turn` / `cache_note` / `cache_write_tokens` 仍随 `llm_response.usage` 进留存
   （步 2 的 file 断言仍在判这份留存）。

## 断言口径与区分度

- **数值可手算**：mock 窗口回落 131072（场景 133 同口径），fixture usage = input 1000 /
  cached 100 ⇒ ctx = round(1000/131072×100) = **1%**、会话累计 = 100/1000 = **10%**——控制行与
  气泡两行的数都能从 fixture 原文手算推出，不是事后从实现抄的读数；单位形态同样可手算
  （1000 ÷ 1000 = 1 → `1k`；131072 截断到 0.1 档 = `131k`）。
- **单位形态有区分度**：把 `formatTokenCount` 摘掉（回原始数字）本步即红（`1000` ≠ `1k`）；
  反向，把千位以下也强行套 k（`1000` 之外的档）同样会红——k 档边界有断言守着。
- **命中率行「不带 tokens 计数」有区分度**：fixture 的 `cached_tokens_session` = 100 在场，
  M526 的实现会把这一行写成「缓存命中：本会话 100 tokens · 累计命中率 10%」——本步的
  `/缓存命中率\s*（会话）\s*：\s*10%/` 对旧形态判红（前缀不同，不是退化子串）。
- **三条退场负向断言都配正观测**：同一步先断用量行与命中率行在场（「读不到」≠「没有」，
  REVIEW.md 第 2 条）。区分度反向：把退场三行任意一行放回来（`本回合缓存命中` / `缓存写入` /
  成因句），本步即红。
- **空会话无假读数的负向断言带正观测**：发送钮在场是同一步的正观测；区分度反向：把
  `has_usage` 门改回「零值也渲染」，本步会读到「0% · 0%」而判红。
- 气泡断言写成 `\s*` 容忍的正则：WKWebView 的 AX 文本可能把行内空格折叠（场景 131/133
  的同名条目）。

## 覆盖边界（如实登记）

- **无上限降级（D464）不在本场景**：mock 窗口恒有回落值（131072），`context_window` 为 0 的
  形态真机不可造——降级文案由单测（`ctxPopRows` 的 D464 用例）覆盖。
- **旧载荷降级形态（D395）不在本场景**：需要旧后端配合，真机层不可造——同由 `ctxPopRows`
  单测覆盖。
- **k 档小数位与 m 档不在本场景**：mock 的数够不到百万级（`input_tokens` = 1000 是 fixture
  里唯一的 k 档整数值）——`999 / 999,999 / 1,000,000` 一类的边界与 m 档样本由
  `formatTokenCount` 的边界单测钉死（tests/unit/harness-cache-metrics.test.ts），m 档的
  气泡行级样本由 `ctxPopRows` 的 m 档用例覆盖；视觉层的小数位形态（`112.7k` / `78.6k` /
  截断不四舍五入）归 m347 场景的结构断言与元素像素基线。
- 会话恢复后的读数可见性归场景 106（M526 更新版）；链式恢复的累计口径由 Rust 单测
  （`usage_from_records` / `restore_usage`）覆盖。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；mock 只回文案、不写 vault。
  1420 全程不碰（实例走 `LUMIR_ACCEPTANCE_PORT=1430`）。
