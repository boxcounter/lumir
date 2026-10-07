---
id: "99-harness-k3-thinking-chip"
item: 99
title: k3-256k 思考程度可用（M373 合并 chip）：订阅模型配置下 chip 可点、浮层三档、选择写会话
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: kimi
    kimiModel: "k3-256k"
seed:
  # 预置「上次会话里 harness 面板在场」⇒ 启动即装配出面板（场景 95 口径：全程零键盘）。
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-a:
      panes:
        - { tabs: [harness-note.md], active: harness-note.md }
      harnessPane: true
steps:
  - name: 等启动恢复落定——k3-256k 配置生效、思考 chip 可用态
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "模型：k3-256k · 思考程度：High（点击切换）"]
      not: ["当前模型不支持思考程度调节"]
    timeoutMs: 40000
    expect:
      - label: harness 面板按存储恢复成旁侧 pane（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: k3-256k 已写进隔离 config（配置落盘的正观测——模型 chip 面只显示 provider 名，模型 id 的 AX 出口只有能力判定与 config 本身）
        file: { path: "env:config.json", has: "\"model\": \"k3-256k\"" }
      - label: 合并 chip 读屏名 = D393 支持态（M372 修复判据：k3-256k 是 k3 系、支持 effort——M373 起真源是 schema preset 声明）
        ax: { has: "模型：k3-256k · 思考程度：High（点击切换）" }
      - label: 区分度负向断言——禁用说明 D390 不在场（修前 chip 被误判置灰，读屏名是本句）
        ax: { not: "当前模型不支持思考程度调节" }
      - shot: 01-k3-256k-chip-可用

  - name: 点合并 chip 展开三维浮层（不支持态读屏名会是 D390——点得开即「可点」的正观测）
    do: click
    target: { name: "^模型：" }
    expect:
      - label: 浮层 effort 段 Low 档在
        ax: { has: "/\\(Low\\)/" }
      - label: effort 段 High 档在
        ax: { has: "/\\(High\\)/" }
      - label: effort 段 Max 档在
        ax: { has: "/\\(Max\\)/" }
      - shot: 02-三档浮层

  - name: 点 Max 档——选择即写会话
    do: click
    target: { name: "^Max$" }

  - name: 等 chip 读数翻成 Max（选择先行，命令写会话随后）
    do: waitFor
    waitFor:
      has: ["模型：k3-256k · 思考程度：Max（点击切换）"]
    timeoutMs: 15000
    expect:
      - label: chip 读数 = Max（可点、可切换的完整回路成立）
        ax: { has: "模型：k3-256k · 思考程度：Max（点击切换）" }
      - shot: 03-选后-Max
---

# 99-harness-k3-thinking-chip —— k3-256k 的思考程度 chip 可用性（M372 缺陷 2）

## 本场景在验什么

Alex 配置 Kimi Code 订阅端的 `k3-256k` 模型后，思考程度 chip 被置灰不可点（原话：「当使用
kimi 的 k3-256k 模型时，thinking level 是灰色不可点击的」）。根因：`thinking::supported` 的
k3 系判定只认 `kimi-k3` 前缀，订阅端 id `k3-256k` 不命中 ⇒ `supported=false` ⇒ chip 禁用。
修复后判定按词元切分（非字母数字断开），`k3-256k` 命中 k3 系。

真机可观测回路（不发消息、零 LLM 调用——能力判定按 config 现算，与 api_key 无关）：

1. **配置生效**：`k3-256k` 已写进隔离 config（`file` 断言 `env:config.json`——模型 chip 面只
   显示 provider 名，模型 id 没有 AX 出口；config 落盘 + 下列能力判定联合即「配置被消费」）。
2. **chip 可用**：读屏名 = D393「模型：k3-256k · 思考程度：High（点击切换）」且 D390 禁用说明**不在场**
   （修前是 D390 + `disabled`，本条与下一条对修复前形态必 FAIL——区分度自证）。
3. **可点可切换**：点 chip 浮层三档全在（禁用钮点不出浮层）⇒ 选 Max ⇒ 读数翻 Max。
4. **负向对偶在场景 101**：同一条 `kimiModel` 配置链配 `kimi-k2.6`（k2 系、官方文档明确不支持
   effort）⇒ chip 必须置灰——证明 supported 确按配置的模型现算（默认模型 kimi-k3 恒真，
   单看正向半是假绿温床）。

## 断言口径

- **D390 负向断言的区分度**：修前 chip 的 aria-label/title 整句是「当前模型不支持思考程度
  调节」，`not` 命中即判 FAIL；修后 D389 与 D390 互斥，两句联合不断言「灰色」（像素层），
  断言的是**能力判定的线上形状**（读屏名 = 快照 `thinking.supported` 的可读出口）。
- **不发消息**：kimi provider 的 api_key 是占位串（`acceptance-dummy`），本场景零发送，
  不存在外呼；发送链路的验证在场景 100（mock provider）与 Rust 单测层。
- **模型 id 的 AX 出口**：M373 起模型 id 上 chip（model 读数），本场景的 D393 读屏名里
  直接含 `k3-256k`——「配置已生效」由读屏名 + `file` 断言（隔离 config.json 含
  `"model": "k3-256k"`）+ 能力判定三方联合证明，负向对偶在场景 101。

## 已知边界（如实登记）

- **「灰不灰」的像素面不在本场景**：置灰的视觉效果（`.is-disabled` 配色）归视觉层；能力
  判定的真源是快照 `thinking.supported`，本场景断言它的可读出口。
- **「k3-256k 请求确实带 reasoning.effort」不在真机断言**：真机套件没有读请求体的通道
  （场景 95 同款边界）——「会话档位 → 请求参数」链由 core 集成测试钉死；`supported` 判定
  本身（含 `k3-256k` / `kimi-code/k3-256k` 命中、`kimi-k30` 不命中）由
  `src-tauri/src/harness/thinking.rs` 的 `support_is_provider_and_model_dependent` 单测钉死。

## 环境与副作用

- 不写 vault 文件、不碰剪贴板、零外部 API 调用（占位 api_key 永不发出请求）。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；真实 vault 与
  `~/.config/lumir` 全程不读写。1420 全程不碰。
