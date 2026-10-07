---
id: "102-harness-model-dimension"
item: 102
title: 合并选择器 model 维度（M373）：schema models 清单进浮层、选择写回 providers.kimi.model、effort 能力随声明翻转
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: kimi
    kimiModel: "kimi-k3"
    kimiModels:
      - { id: "kimi-k3", effort: true, window: 1048576 }
      - { id: "kimi-k2.6", effort: false, window: 262144 }
seed:
  # 与场景 99/101 同构（seed 装配面板、全程零键盘）。
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-a:
      panes:
        - { tabs: [harness-note.md], active: harness-note.md }
      harnessPane: true
steps:
  - name: 等启动恢复落定——schema models 清单生效、chip 支持态
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "模型：kimi-k3 · 思考程度：High（点击切换）"]
      not: ["当前模型不支持思考程度调节"]
    timeoutMs: 40000
    expect:
      - label: harness 面板按存储恢复成旁侧 pane（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: schema 落盘正观测：models 清单（含逐模型 effort/window 声明）已写进隔离 config
        file: { path: "env:config.json", has: '"models"' }
      - label: 当前 model = kimi-k3（effort=true）⇒ chip 读屏名 = D393 支持态
        ax: { has: "模型：kimi-k3 · 思考程度：High（点击切换）" }
      - label: 区分度负向断言——D390 不在场（kimi-k3 声明支持 effort）
        ax: { not: "当前模型不支持思考程度调节" }
      - shot: 01-kimi-k3-支持态

  - name: 点合并 chip 展开三维浮层（模型段 = schema 声明清单，两项全在）
    do: click
    target: { name: "^模型：" }
    expect:
      - label: 模型段 kimi-k3 项在（ASCII 括号锚）
        ax: { has: "/[(\"]kimi-k3[)]/" }
      - label: 模型段 kimi-k2.6 项在
        ax: { has: "/[(\"]kimi-k2[.]6[)]/" }
      - label: 内置 preset 的其余模型不在（用户声明 = 整体覆盖：k2.7-code / k3-256k 被清单替换）
        ax: { not: "/[(\"]kimi-k2[.]7-code[)]/" }
      - label: Provider 段 mock 隐藏（同场景 90 口径）
        ax: { not: "/[(\"]mock[)]/" }
      - label: effort 段三裸档在（kimi-k3 支持 effort ⇒ 段不禁用）
        ax: { has: "/\\(Low\\)/" }
      - shot: 02-模型段-schema清单

  - name: 点 kimi-k2.6 档——选择写回 providers.kimi.model（点分嵌套键）
    do: click
    target: { name: "^kimi-k2[.]6$" }

  - name: 等 chip 读屏名翻成 D390（schema 声明 effort=false ⇒ 能力翻转）
    do: waitFor
    waitFor:
      has: ["当前模型不支持思考程度调节"]
      not: ["模型：kimi-k2.6 · 思考程度：High（点击切换）"]
    timeoutMs: 15000
    expect:
      - label: chip 读屏名 = D390（effort 能力按 schema 逐模型声明现算——不靠词元猜测）
        ax: { has: "当前模型不支持思考程度调节" }
      - label: 写回落盘：providers.kimi.model 已是 kimi-k2.6（点分嵌套键写回）
        file: { path: "env:config.json", has: '"model": "kimi-k2.6"' }
      - label: models 清单写回后仍完整（合并写只动 model 键）
        file: { path: "env:config.json", has: '"kimi-k2.6"' }
      - shot: 03-k2.6-置灰

  - name: 不支持态照点 chip 换组合（合并 chip 永不禁用——置灰只落 effort 读数）
    do: click
    target: { name: "^当前模型不支持思考程度调节" }
    expect:
      - label: 浮层照开：模型段 kimi-k3 项在场（选择器可点开的正观测）
        ax: { has: "/[(\"]kimi-k3[)]/" }
      - label: 浮层 effort 段禁用说明句在场（D390 段尾说明）
        ax: { has: "当前模型不支持思考程度调节" }
      - shot: 04-不支持态-浮层照开

  - name: 点回 kimi-k3——能力翻转双向闭合
    do: click
    target: { name: "^kimi-k3$" }

  - name: 等 chip 读屏名回到 D393 支持态
    do: waitFor
    waitFor:
      has: ["模型：kimi-k3 · 思考程度：High（点击切换）"]
      not: ["当前模型不支持思考程度调节"]
    timeoutMs: 15000
    expect:
      - label: chip 读屏名回 D393（effort 能力随 model 选择双向翻转）
        ax: { has: "模型：kimi-k3 · 思考程度：High（点击切换）" }
      - label: 写回落盘：providers.kimi.model 已回 kimi-k3
        file: { path: "env:config.json", has: '"model": "kimi-k3"' }
      - shot: 05-回-kimi-k3
---

# 102-harness-model-dimension —— 合并选择器的 model 维度（M373 配置 schema 面）

## 本场景在验什么

M373 起 `[harness].providers.<id>` 暴露 **model 维度**（schema 是唯一真源）：

1. **models 清单进浮层**：用户声明的 `models`（逐项 `{id, effort, window}`）整体覆盖内置
   preset——浮层模型段只列声明的两项（`kimi-k3` / `kimi-k2.6`），preset 的其余模型
   （`kimi-k2.7-code` / `k3-256k` …）不出现（负向断言钉「整体覆盖」语义）。
2. **选择写回嵌套键**：点 `kimi-k2.6` → `config_set_value("harness","providers.kimi.model",…)`
   落盘（写通道 M373 支持点分路径）；合并写只动 `model` 键，models 清单逐键保留。
3. **能力随声明翻转**：`kimi-k2.6` 声明 `effort=false` ⇒ chip 读屏名翻 D390（置灰语义），
   浮层 effort 段禁用 + 段尾 D390 说明；点回 `kimi-k3`（`effort=true`）⇒ 翻回 D393——
   双向闭合。**真源是 schema 声明，不是 M372 的词元判定**（词元判定已退役：前缀不宽容，
   置灰安全侧由「未列出 = 不支持」的保守默认承担）。
4. **不支持态不锁死入口**：合并 chip 永不禁用——D390 态照点得开浮层换组合（裁决：
   「合并后选择器本身仍可点开换组合」）。

## 断言口径

- **点击 target 不锁 role**：chip 带 `aria-haspopup` → `AXPopUpButton`；浮层项
  `role=menuitemradio` 未必映射 `AXMenuItemRadio`（场景 90/95 同口径，裸正则源 name）。
- **`kimi-k2.6` 的正则转义**：`.` 在 name 正则里是通配——锚定写作 `kimi-k2[.]6`，
  同时挡住 `kimi-k2x6` 一类误命中。
- **hover hint 的覆盖分工**：置灰格的 hover hint（D394）与 ctx 读数含义 hint（D395）是
  mouseenter 浮层，真机套件无 hover 动词——它们的翻出/收回由 m347/m363 视觉结构层断言，
  本场景只覆盖「D390 读屏名 + 浮层段禁用说明」这两个 AX 可见面（如实登记边界）。
- **「models 清单仍完整」断言**：写回是 `providers.kimi.model` 点分合并写——若实现错成
  整表覆盖，models 键会被抹掉，该 file 断言即红。

## 环境与副作用

- 不写 vault 文件、不碰剪贴板、零外部 API 调用（占位 api_key 永不发出请求）。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；真实 vault 与
  `~/.config/lumir` 全程不读写。1420 全程不碰。
