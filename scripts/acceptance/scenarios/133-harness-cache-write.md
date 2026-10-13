---
# M443（change harness-cache-metrics）：`cache_write_tokens` 遥测——气泡第四行呈现本回合与本会话累计的
# 缓存写入，wire 留存的 `llm_response.usage` 含原值；本回合值为 0 时该行不渲染（判定键是单回合值）。
id: "133-harness-cache-write"
item: 133
title: Harness 缓存读数③：缓存写入行 = 本回合 + 本会话累计、留存 usage 含 cache_write_tokens、零值不渲染
open: harness-note.md
marker: "HNL-ALPHA"
# 两轮 mock：首轮 cache_write_tokens = 16000（写入非零）、次轮 = 0（确实没写 / provider 不提供）。
# 写入行的判定键是**本回合值**：次轮为 0 ⇒ 整行不渲染，而本会话累计仍是 16000（不因零值丢掉累计）。
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

  # ── 第一轮：写入非零 ────────────────────────────────────────────────────────
  - name: 输入提问并 Enter 发送
    do: keys
    keys: ["w", "r", "i", "t", "e"]
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
      - label: 留存 usage 块含 cache_write_tokens 原值（wire 口径；provider 不提供时记 0，从不缺键）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"kind":"llm_response".*"cache_write_tokens":16000.*$/' }
      - shot: 01-首轮-控制行

  - name: hover 读数（锚点 = 读数左邻的权限 chip；ctx 读数在 AX 里没有 bbox）
    do: hover
    target: { anchor: { role: AXPopUpButton, any: "/权限模式/" }, offsetX: 24 }
    expect:
      - label: 气泡在场（后续零值不渲染断言的正观测）
        ax: { has: "/上下文窗口占用\\s*：\\s*15%/" }
      - label: 第四行 = 本回合 16000 / 本会话累计 16000
        ax: { has: "/缓存写入\\s*：\\s*本回合\\s*16000\\s*tokens\\s*·\\s*本会话累计\\s*16000\\s*tokens/" }
      - shot: 02-首轮-hover气泡

  - name: 移开读数（移到发送钮）
    do: hover
    target: { role: AXButton, name: "^发送$" }
    expect:
      - label: 移动后读数仍在屏上（正观测：面板活着）
        ax: { has: "15% · 20%" }
      - label: 气泡收起（前一步读到过写入行）
        ax: { not: "缓存写入" }

  # ── 第二轮：本回合写入为 0 ⇒ 该行不渲染，会话累计仍在 ─────────────────────────
  - name: 点 composer 聚焦
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 输入第二个提问并发送
    do: keys
    keys: ["a", "g", "a", "i", "n"]
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
      - label: 气泡在场（= 本次读取真的读到了翻出的气泡，零值断言的输入成立）
        ax: { has: "/上下文窗口占用\\s*：\\s*17%/" }
      - label: 第三行本回合值在场（95%，单回合）
        ax: { has: "/本回合缓存命中\\s*：\\s*95%/" }
      - label: 缓存写入行整行不渲染（本回合值为 0；判定键是单回合值，不取会话累计的 16000）
        ax: { not: "缓存写入" }
      - shot: 04-次轮-hover气泡

  - name: 移开读数
    do: hover
    target: { role: AXButton, name: "^发送$" }
    expect:
      - label: 移动后读数仍在屏上（正观测：面板活着）
        ax: { has: "17% · 60%" }
      - label: 气泡收起（前一步读到过本回合行）
        ax: { not: "本回合缓存命中" }
---

# 133-harness-cache-write —— 缓存写入遥测（气泡第四行 + 留存）（M443）

## 本场景在验什么

change `harness-cache-metrics` 的第二条（M438 清单第 5 项）：把 provider usage 里的
`cache_write_tokens` 纳入留存与面板——「一个 50% 的单回合读数里，未命中部分有一部分是**必要的
缓存写入成本**而非浪费」这件事此前人对它是盲的。两处落点：

1. **留存**（wire 口径）：`llm_response.usage` 块含 `cache_write_tokens` 原值；provider 不提供
   该字段时记 **0**（不留缺键，消费侧不必再判 null）。恢复 / 诊断因此可回溯。
2. **气泡第四行**：本回合与本逻辑会话累计两个数；**判定键是本回合值**——为 0（provider 不提供，
   或确实没写）时整行不渲染，与 D401 缺失回落同口径。

## 断言口径与区分度

- **两轮的写入值刻意不同**（16000 / 0）：留存断言因此分得出「首轮记录了非零写入」与「次轮记为
  0」两条（同一份 JSONL 里两行同时在场，各自的判据互不吞没）。
- **零值不渲染的判据带正观测**：断言 `缓存写入` 不在 AX 树里的同一步里，先断言气泡在场
  （`上下文窗口占用：17%`）与第三行在场（`本回合缓存命中：95%`）——「读不到」不等于「没有」
  （REVIEW.md 第 2 条）。反向的区分度：把渲染判据改成「缺键才不渲染」（即允许 0 渲染）时，
  这一步会读到 `缓存写入：本回合 0 tokens …` 而判红。
- **会话累计不因零值丢掉**：气泡第三 / 第四行的判定键都只看本回合值，但会话累计（16000）在次轮
  仍应保留——本场景不直接断言它（该行不渲染），由 Rust 单测（`record_usage` 的累计）与场景 131
  的跨回合累计断言覆盖；这里如实登记这条覆盖边界。
- 气泡断言写成换行容忍的正则（`\s*`），理由见场景 131 的同名条目。

## 覆盖边界（如实登记）

- **真 provider 上这一行常态不出现**：Kimi Code 端点（`api.kimi.com/coding/v1`，model `k3-256k`）
  实测 `cache_write_tokens` 恒报 0（2026-10-11 冒烟，现场 `src-tauri/tests/harness_real_kimi_cache.rs`
  的模块文档与 change design §6），DeepSeek 无该字段 ⇒ 真机上「本回合值非零」的形态只可能来自 mock。
  本场景判的是**链路正确性**（解析 → 累计 → 事件 / 快照 → 渲染 → 留存），不是「这个数在真 provider
  上一定有值」——后者是读数事实，不是能力断言。
- 状态条（`metrics.md` 之类的趋势图）不在本 change 范围（Non-goals）。
