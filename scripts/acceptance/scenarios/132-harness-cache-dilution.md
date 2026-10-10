---
# M443（change harness-cache-metrics）：大块摊薄成因——单回合新增超过已缓存前缀的一半时，控制行
# **仍是会话累计**，气泡里的单回合值旁出现摊薄成因句（点破「非缓存失效」）。
id: "132-harness-cache-dilution"
item: 132
title: Harness 缓存读数②：大块摊薄回合——控制行仍显示会话累计、气泡出摊薄成因句、写入为 0 时该行不渲染
open: harness-note.md
marker: "HNL-ALPHA"
# 单轮 mock，数值取 M438 调查报告的实测形状（前缀 6612 全命中 + 新增 6174 工具输出 = input
# 12786 / cached 6400）：单回合 6400/12786 = 50.05% → 50%，新增 6386 > 已缓存 6400 的一半
# （3200）⇒ 摊薄成因。会话累计此刻 == 单回合（只有一个样本）。
# cache_write_tokens = 0：本回合值为 0 ⇒ 气泡第四行**整行不渲染**（判定键是单回合值）。
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
    do: keys
    keys: ["d", "i", "l", "u", "t", "e"]
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
      - label: 控制行 = ctx 10%（12786/131072）· cache 50%（本回合恰是唯一样本 ⇒ 累计 == 单回合）
        ax: { has: "10% · 50%" }
      - shot: 01-控制行

  - name: hover 读数（锚点 = 读数左邻的权限 chip；ctx 读数在 AX 里没有 bbox）
    do: hover
    target: { anchor: { role: AXPopUpButton, any: "/权限模式/" }, offsetX: 24 }
    expect:
      - label: 气泡在场（后续负向断言的正观测）
        ax: { has: "/上下文窗口占用\\s*：\\s*10%/" }
      - label: 第三行本回合 = 50% + 摊薄成因句（"新增超过已缓存前缀的一半，命中率被摊薄——非缓存失效"）
        ax: { has: "/本回合缓存命中\\s*：\\s*50%/" }
      - label: 摊薄成因句在场（点破非缓存失效）
        ax: { has: "/本回合新增内容已超过已缓存前缀的一半\\s*，命中率被摊薄\\s*——非缓存失效\\s*。/" }
      - label: 冷启动句不在（本回合 cached != 0——两句成因句互斥）
        ax: { not: "本回合未命中缓存" }
      - label: 缓存写入行不渲染（本回合 cache_write_tokens = 0，判定键是单回合值）
        ax: { not: "缓存写入" }
      - shot: 02-hover气泡

  - name: 移开读数（移到发送钮）——气泡收起
    do: hover
    target: { role: AXButton, name: "^发送$" }
    expect:
      - label: 气泡收起后摊薄句不在 AX 树里（负向断言的正观测 = 上一步曾读到它）
        ax: { not: "命中率被摊薄" }
---

# 132-harness-cache-dilution —— 大块摊薄成因 + 写入为 0 不渲染（M443）

## 本场景在验什么

Alex 的原始误判现场（2026-10-10「一个会话里 cache hit 很低，只有 50%」）就是这一回合的形状：
前缀全命中、又新增一大块内容（工具输出），**单回合**命中率被算术摊薄到 50%。改动后：

1. 控制行显示**会话累计**（此刻只有一个样本，故与单回合同为 50%——本场景不会因为改口径而变红，
   它判的是「成因句出来了」这一面；两个读数分得开的场景见 131）。
2. 气泡里本回合值旁出现**摊薄成因句**（D454），点破「非缓存失效」。
3. 缓存写入为 0 时第四行**不渲染**（design §5.2 第 4 行：判定键是本回合 `cache_write_tokens`，
   provider 不提供该字段时按 0 —— DeepSeek 与 Kimi Code 端点即此）。

## 断言口径与区分度

- **数值取自 M438 实测**：input 12786 / cached 6400 ⇒ 新增 6386 > 6400/2 = 3200 ⇒ `block_dilution`。
  生成成句的阈值就在这一条上：把阈值改成「新增 > cached」（6386 < 6400）时本场景的成因句断言必红。
- **成因句由后端判定**：前端只按 `cache_note` 的值取句，因此这条断言同时守住了「后端判定 → 事件
  载荷 → 前端取句」这条链（判定真值表在 `src-tauri/src/harness/session.rs` 的单测里）。
- **负向断言配正观测**：`缓存写入` 不在场、气泡已收起两条负断言，各自有同一步 / 上一步的
  「气泡在场」正观测（`上下文窗口占用：10%`、`命中率被摊薄` 曾读到）。
- 气泡断言写成换行容忍的正则（`\s*`），理由见场景 131 的同名条目。

## 覆盖边界

- 本场景不走 vault 切换，因此不复用 131 的会话键舞蹈；单轮会话不需要它。
- 真 provider 侧的成因判定不在真机层判（mock fixture 驱动的是同一条解析 → 判定 → 事件链）。
