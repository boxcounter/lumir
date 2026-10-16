---
# M526：ctx/cache hover 气泡的 **tokens 读数**——第一行上下文已用/上限 tokens + 百分比（D463）、
# 第二行会话累计命中 tokens + 累计命中率（D465）、第三行本回合命中 tokens + 命中率（D466，
# 成因句照旧追加）；本 fixture 的 cache_write_tokens 缺失按 0 记 ⇒ 缓存写入行不渲染（正观测先行）。
id: "155-harness-ctxpop-tokens"
item: 155
title: "Harness 气泡 tokens 读数：上下文已用/上限 tokens、cache 命中 tokens；空会话无假读数"
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
      - label: 气泡第一行 = 上下文已用/上限 tokens + 百分比（D463：1000 / 131072 · 1%）
        ax: { has: "/上下文：已用\\s*1000\\s*\\/\\s*131072\\s*tokens（1%）/" }
      - label: 气泡第二行 = 本会话命中 tokens + 累计命中率（D465：100 tokens · 10%）
        ax: { has: "/缓存命中：本会话\\s*100\\s*tokens\\s*·\\s*累计命中率\\s*10%/" }
      - label: 气泡第三行 = 本回合命中 tokens + 命中率（D466：100 tokens · 10%），成因句照旧追加
        ax: { has: "/本回合缓存命中：\\s*100\\s*tokens\\s*·\\s*命中率\\s*10%/" }
      - label: 缓存写入行不渲染（本 fixture 缺 cache_write_tokens 按 0 记——判定键是本回合值；
          「读不到」负向断言的正观测 = 上面三行同一步在场，与场景 133 同口径）
        ax: { not: "缓存写入" }
      - shot: 02-首轮-hover气泡

  - name: 移开读数（移到发送钮）
    do: hover
    target: { role: AXButton, name: "^发送$" }
    expect:
      - label: 移动后读数仍在屏上（正观测：面板活着）
        ax: { has: "1% · 10%" }
      - label: 气泡收起（前一步读到过 tokens 行）
        ax: { not: "上下文：已用" }
---

# 155-harness-ctxpop-tokens —— ctx/cache 气泡的 tokens 读数（M526）

## 本场景在验什么

Alex 原话：「ctx • cache 的 hint 里显示具体的 tokens 使用量。」change 落点（M526）：

1. **Rust 侧 `UsageSnapshot` 补绝对值字段**：`input_tokens` / `cached_tokens` /
   `cached_tokens_session` / `context_window`（+ `has_usage` 真读数判据），`record_usage` 与
   留存重算共用同一算法（`CacheTotals::snapshot`）。
2. **气泡进 tokens 形态**：第一行「上下文：已用 {used} / {limit} tokens（{ctx}%）」（D463，
   无上限值时降级 D464）、第二行「缓存命中：本会话 {cached} tokens · 累计命中率 {cache}%」
   （D465）、第三行「本回合缓存命中：{cached} tokens · 命中率 {turn}%」（D466，成因句照旧
   追加）；绝对值缺键（旧后端载荷）时各行降级回 M378/M443 的百分比形态（D395/D401/D452）。
3. **空会话不假读数**：从未发过请求的会话 `has_usage=false` ⇒ 读数区整体隐藏（「0% · 0%」
   虚报口径退场）。

## 断言口径与区分度

- **数值可手算**：mock 窗口回落 131072（场景 133 同口径），fixture usage = input 1000 /
  cached 100 ⇒ ctx = round(1000/131072×100) = **1%**、会话累计 = 100/1000 = **10%**——控制行与
  气泡三行的数都能从 fixture 原文手算推出，不是事后从实现抄的读数。
- **本回合成因标注**：input−cached = 900 > cached÷2 = 50 ⇒ `block_dilution`，D466 行尾应带
  摊薄成因句——本场景只断第三行的 tokens 主干（`/…命中率\s*10%/`），成因句的逐字断言归
  场景 132（M443 已覆盖判定与文案，这里不重复）。
- **缓存写入行不渲染的负向断言带正观测**：同一步先断三行 tokens 在场（「读不到」≠「没有」，
  REVIEW.md 第 2 条）；区分度反向：若实现把「缺键按 0」改成「缺键不渲染」，本场景不受影响，
  场景 133 的写入行断言会红——两行判定键不同，互不吞没。
- **空会话无假读数的负向断言带正观测**：发送钮在场是同一步的正观测；区分度反向：把
  `has_usage` 门改回「零值也渲染」，本步会读到「0% · 0%」而判红。
- 气泡断言写成 `\s*` 容忍的正则：WKWebView 的 AX 文本可能把行内空格折叠（场景 131/133
  的同名条目）。

## 覆盖边界（如实登记）

- **无上限降级（D464）不在本场景**：mock 窗口恒有回落值（131072），`context_window` 为 0 的
  形态真机不可造——降级文案由单测（`ctxPopRows` 的 D464 用例）覆盖。
- **旧载荷降级形态（D395/D401/D452）不在本场景**：需要旧后端配合，真机层不可造——同由
  `ctxPopRows` 单测覆盖。
- 会话恢复后的读数可见性归场景 106（M526 更新版）；链式恢复的累计口径由 Rust 单测
  （`usage_from_records` / `restore_usage`）覆盖。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；mock 只回文案、不写 vault。
  1420 全程不碰（实例走 `LUMIR_ACCEPTANCE_PORT=1430`）。
