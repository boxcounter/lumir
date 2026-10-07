---
id: "101-harness-k2-chip-disabled"
item: 101
title: kimi-k2.6 思考 chip 置灰：同一条配置链配 k2 系模型，supported 按配置的模型现算
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: kimi
    kimiModel: "kimi-k2.6"
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
      not: ["思考程度：High（点击切换）"]
    timeoutMs: 40000
    expect:
      - label: harness 面板按存储恢复成旁侧 pane（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: kimi-k2.6 已写进隔离 config（与场景 99 同一条配置链的正观测）
        file: { path: "env:config.json", has: "\"model\": \"kimi-k2.6\"" }
      - label: chip 读屏名 = D390 禁用说明（k2 系官方文档明确不支持 reasoning.effort）
        ax: { has: "当前模型不支持思考程度调节" }
      - label: 区分度负向断言——D389 支持态读屏名不在场（与场景 99 的断言互为对偶）
        ax: { not: "思考程度：High（点击切换）" }
      - shot: 01-k2.6-chip-置灰
---

# 101-harness-k2-chip-disabled —— 思考 chip 置灰的负向对偶（M372 缺陷 2 的区分度守卫）

## 本场景在验什么

场景 99 证明 `k3-256k` 下 chip 可用；本场景用**同一条配置链**（`config.harness.kimiModel`
→ `providers.kimi.model`）配官方文档明确不支持 effort 的 `kimi-k2.6`，证明 `supported` 判据
确实按**配置的模型**现算——而不是恒真、也不是认死出厂默认 `kimi-k3`（两者都会让场景 99
假绿：默认模型本来就支持 effort，配置没生效也看不出来）。

判据对偶：场景 99 断言 D389 在场 / D390 不在场；本场景断言 D390 在场 / D389 不在场。两个
场景联合才钉死「k3-256k ⇒ 可用」这条修复语义（「禁用钮点不出浮层」不再单独真机断言——
disabled 按钮的 AXPress 通道在 WKWebView 里行为不定，判它会把环境噪声当产品缺陷；禁用的
不展开语义 = 原生 disabled 行为 + `setThinkPop(open && !thinkSupported)` 双闸，由代码审与
场景 99 的正向「可点出浮层」对偶覆盖）。

## 断言口径

- **点击目标用 D390 读屏名**：禁用态 chip 的 aria-label/title 就是「当前模型不支持思考程度
  调节」（copy-data D390）——`findNode` 按 title/label 匹配，点到的是这颗禁用钮本身。
- **「点不出浮层」用 not 断言 ASCII 括号档名**（`(Low)` / `(Max)`）：与场景 95/99 的正向
  断言同锚；disabled 按钮即使收到 AXPress 也不展开（`setThinkPop(open && !thinkSupported)`
  双闸）。「灰不灰」的像素面仍归视觉层，本场景只判能力判定的可读出口。
- **负向断言的区分度**：若产品退化成「supported 恒 true」，本场景第一条 waitFor 即超时
  FAIL（D390 永不出现）；若 `kimiModel` 配置链断了（配置没写进 config），同样 FAIL
  （`file` 断言先红）——两条假绿路径都被堵。
- **不点禁用钮**：disabled 按钮在 WKWebView AX 里不一定带 AXPress action，AXPress 注入
  对禁用控件的行为不定——用它当动作会把环境噪声判成产品缺陷。置灰态的 AX 形状断言
  （D390 在场 / D389 缺席）已足钉死能力判定。

## 环境与副作用

- 不写 vault 文件、不碰剪贴板、零外部 API 调用（占位 api_key 永不发出请求）。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；真实 vault 与
  `~/.config/lumir` 全程不读写。1420 全程不碰。
