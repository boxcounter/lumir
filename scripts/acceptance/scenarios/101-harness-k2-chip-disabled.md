---
id: "101-harness-k2-chip-disabled"
item: 101
title: kimi-k2.6 思考程度置灰（M373 合并 chip）：同一条配置链配 k2 系模型，能力按 schema 声明现算
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: kimi
    kimiModel: "kimi-k2.6"
    # M381 config-only：能力真源是 models 声明（内置 preset 已彻底删除）——场景合成
    # config 显式声明 k2.6 不支持 effort（与场景 99 的 k3-256k 声明互为对偶）。
    kimiModels:
      - { id: "kimi-k2.6", effort: false, window: 262144 }
seed:
  # 与场景 99 同构（seed 装配面板、全程零键盘）——唯一变量是 kimiModel 的取值。
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-a:
      panes:
        - { tabs: [harness-note.md], active: harness-note.md }
      harnessPane: true
steps:
  - name: 等启动恢复落定——k2.6 配置下 chip 必须置灰
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "当前模型不支持思考程度调节"]
      not: ["模型：kimi-k2.6 · 思考程度：High（点击切换）"]
    timeoutMs: 40000
    expect:
      - label: harness 面板按存储恢复成旁侧 pane（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: kimi-k2.6 已写进隔离 config（与场景 99 同一条配置链的正观测）
        file: { path: "env:config.json", has: "\"model\": \"kimi-k2.6\"" }
      - label: chip 读屏名 = D390 禁用说明（models 声明 effort=false ⇒ 能力按声明现算，M381 config-only）
        ax: { has: "当前模型不支持思考程度调节" }
      - label: 区分度负向断言——D393 支持态读屏名不在场（与场景 99 的断言互为对偶）
        ax: { not: "模型：kimi-k2.6 · 思考程度：High（点击切换）" }
      - shot: 01-k2.6-chip-置灰
---

# 101-harness-k2-chip-disabled —— 思考 chip 置灰的负向对偶（M372 缺陷 2 的区分度守卫）

## 本场景在验什么

场景 99 证明 `k3-256k`（声明 `effort=true`）下 chip 可用；本场景用**同一条配置链**
（`config.harness.kimiModel` + `kimiModels` 声明 → `providers.kimi.model` / `.models`）
配**同一个模型 id 但声明 `effort=false`** 的 `kimi-k2.6`，证明 `supported` 判据确实按**配置
的声明**现算——而不是恒真、也不是认死某个内置默认（M381 config-only 后内置默认已彻底
删除：不写 models 声明 = 空清单 = 一切模型不支持）。

判据对偶：场景 99 断言 D393 在场 / D390 不在场；本场景断言 D390 在场 / D393 不在场。两个
场景联合才钉死「声明翻转、读数跟着翻」这条语义。M373 合并后语义有变：chip 不再整颗禁用——
置灰只落 effort 读数，chip 照点得开（浮层 effort 段禁用 + D390 段尾说明 + 置灰格 hover hint）；
「点不出浮层」的旧断言口径随之退役，由 m347/m363 视觉场景的「段禁用 + hint」结构断言接防。

## 断言口径

- **本场景零点击**：只判能力判定的可读出口（D390 在场 / D393 缺席）。合并 chip 的可点
  性（不支持态照点开浮层）由 m347/m363 视觉场景与场景 102 的正向路径覆盖。「灰不灰」的
  像素面仍归视觉层。
- **负向断言的区分度**：若产品退化成「supported 恒 true」，本场景第一条 waitFor 即超时
  FAIL（D390 永不出现）；若 `kimiModel` 配置链断了（配置没写进 config），同样 FAIL
  （`file` 断言先红）——两条假绿路径都被堵。
- **不点 chip**：本场景是纯观测场景——点击路径（含不支持态点开后换组合）在场景 102
  覆盖。waitFor 的 has/not 联合已足钉死能力判定。

## 环境与副作用

- 不写 vault 文件、不碰剪贴板、零外部 API 调用（占位 api_key 永不发出请求）。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；真实 vault 与
  `~/.config/lumir` 全程不读写。1420 全程不碰。
