---
id: "90-harness-model-chip"
item: 90
title: 合并选择器：读数 = model · effort、浮层三维分段（mock 隐藏）、provider 选择写回（M373 适配 chip 合并）
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
      - label: 控制行在位（发送钮）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 合并 chip 读屏名 = D393（mock 无模型维度 → model 读数回落 provider id；effort = 会话默认 High）
        ax: { has: "模型：mock · 思考程度：High（点击切换）" }

  - name: 点合并 chip 展开三维浮层（chip 带 aria-haspopup → WKWebView 映射 AXPopUpButton，target 不锁 role）
    do: click
    target: { name: "^模型：" }
    expect:
      - label: Provider 段列 kimi / deepseek（mock 按 Alex 裁决「界面上隐藏」从可选列表过滤，数据保留）
        ax: { has: "/[(\"]kimi[)]/" }
      - label: deepseek 档在场
        ax: { has: "/[(\"]deepseek[)]/" }
      - label: mock 档不在可选列表（ASCII 括号锚节点名；chip 读屏名里的「mock」不带括号、不误命中）
        ax: { not: "/[(\"]mock[)]/" }
      - label: effort 段三裸档在场
        ax: { has: "/\\(Low\\)/" }
      - label: 展开浮层不改 chip 的读数（chip 仍在、仍是 mock 档）
        ax: { has: "模型：mock · 思考程度：High（点击切换）" }
      - shot: 01-合并浮层（三维分段：Provider（无 mock）/ 思考程度；mock 无模型维度故无模型段）

  - name: 点 kimi 档——选择写回 config（provider 键），浮层不自动关（M373 裁决）
    do: click
    target: { name: "^kimi$" }

  - name: 等 chip 读数翻成 kimi-k3（选择先行，写回随后；kimi 缺省 model = 出厂 kimi-k3）
    do: waitFor
    waitFor:
      has: ["模型：kimi-k3 · 思考程度：High（点击切换）"]
    expect:
      - label: chip 读数 = 新 provider 的 model（kimi 出厂默认 kimi-k3）· effort 不抹（仍是 High——切 provider 不抹 effort，M373 裁决）
        ax: { has: "模型：kimi-k3 · 思考程度：High（点击切换）" }
      - label: 写回落盘：config.json 的 harness.provider 已是 kimi（pretty JSON 两空格缩进）
        file: { path: "env:config.json", has: '"provider": "kimi"' }
      - shot: 02-选择后-chip读数
---

# 90-harness-model-chip —— 合并选择器 chip 的读数、浮层与 provider 写回

## 本场景在验什么

M373 起双 chip（模型 + 思考）合并为**一个选择器 chip**（`src/harness-panel.ts` 的
`.lumir-hp-model`）：

- **chip 读数 = 「model · effort」双读数**（U+00B7），provider 不进 chip（Alex 裁决
  「不需要显示 provider，只需要 model · effort」）。当前 provider = mock（验收
  fixture 驱动档）时没有模型维度（Rust 侧 `HarnessMockConfig` 只有 fixture），model
  读数回落 provider id 本身——chip 形态保持「model · effort」不变形。读屏名 = D393
  「模型：{model} · 思考程度：{level}（点击切换）」。
- **浮层 = 单浮层三维分段**（Provider / 模型 / 思考程度）：provider 段只列
  `kimi` / `deepseek`——**mock 按 Alex 裁决「界面上隐藏，代码保留」在可选列表层过滤**
  （数据保留在 config 里）。当前 provider 无模型维度时模型段不渲染，故本场景浮层两段。
- **选择写回**：点 `kimi` 档 → `config_set_value("harness","provider","kimi")` 落盘，
  `env:config.json` 含 `"provider": "kimi"`；chip 读数翻成 kimi 的 model（出厂默认
  `kimi-k3`）· effort 不抹（会话档位与 provider 无关）。
- **选定不自动关浮层**（Alex 裁决）：选择后浮层仍开（正观测 = 随后点空白处浮层收起）。

## M351 修复的 AX 暴露问题（沿革，M349 首跑实测归因保留）

**修复前**：`.lumir-hp-modelpop` 是 chip `<button>` 的**子节点**，而 WKWebView 的 AX 树把
**嵌在 button 里的 button 当成叶子**——浮层项在 AX 里一个都不出现。M349 首跑实测
（`test-results/acceptance/2026-10-06/90-harness-model-chip/`）：截图里浮层清楚可见，
而同一时刻的 AX dump 里 chip 节点没有任何子节点。

**修复后（M351，finding 20261006-worker-hp4）**：chip 与浮层同挂 wrapper
（`.lumir-hp-modelwrap`，`position: relative` 的包含块），浮层不再嵌在 button 内，浮层项带
`role=menuitemradio` + `aria-checked` 语义——AX 树正常暴露。M373 起浮层换合并形态
（`.lumir-hp-selpop`），wrapper 结构不变。结构层行为断言在
`tests/visual/scenes/m347-harness-composer.spec.ts`（DOM 层）与本场景（AX 层）双通道。

## 已知边界

- **chip 与浮层项的 AX role 都不锁定**：chip 带 `aria-haspopup="menu"`，WKWebView 把它映射成
  `AXPopUpButton` 而非 `AXButton`；浮层项 `role=menuitemradio` 可能映射成 `AXMenuItemRadio`。
  两个点击 target 都只给裸正则源 `name`（`findNode` 对 title/label/value 逐一匹配），不写 role。
- **mock 隐藏的判据是 ASCII 括号锚**：chip 读屏名含「mock」子串，裸 `not: "mock"` 会把 chip
  自己也算进去；浮层项的 AX 名形如 `(kimi)` / `(mock)`，用 `[(\"]mock[\)]` 锚定括号/引号
  才不误伤 chip。
- **「浮层收起」不做 AX 负向断言**：WKWebView 可能把 chip 读数暴露成静态文本子节点，按名字
  负向断言「kimi 项离场」会被假杀。收起语义归 m347 视觉场景（DOM 层）钉。
- **model 读数回落**：mock 无模型维度时 chip 显示 provider id——这是刻意的形态保全（验收
  专用档），有模型维度的 provider（kimi/deepseek）显示各自 `model` 配置值（本场景选 kimi
  后读数 = `kimi-k3` 即出厂默认回填的实证）。
- **chip ellipsis / hover 全名**：CSS 层行为，视觉层判（`max-width` 截断 + `title` 全名）。

## 环境与副作用

- 不写 vault 文件；`harness.provider` 的写回落在**隔离** `XDG_CONFIG_HOME` 的 config.json
  （每场景重生成，不污染后续场景）；真实 `~/.config/lumir` 全程不读写。
- 合成 vault `/tmp/lumir-m102-acceptance`；1420 全程不碰。
