---
id: "90-harness-model-chip"
item: 90
title: 模型 chip：读数 = 配置值、浮层列 provider（M351 起浮层项进 AX 树，选择 + 写回判据下沉真机）
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
      - label: 当前模型 = 配置值读数（D376 读屏名带 provider 名，配置值即读数）
        ax: { has: "模型：mock（点击切换）" }

  - name: 点模型 chip 展开 provider 浮层（chip 带 aria-haspopup → WKWebView 映射 AXPopUpButton 而非 AXButton，target 不锁 role）
    do: click
    target: { name: "^模型：" }
    expect:
      - label: 浮层项进 AX 树（M351 修复后可达：三档之一的 kimi 在场；dump 行形如 `(kimi)` 或 `"kimi"`，锚 ASCII 括号/引号防误命中）
        ax: { has: "/[(\"]kimi[\")]/" }
      - label: 展开浮层不改 chip 的读数（chip 仍在、仍是配置值）
        ax: { has: "模型：mock（点击切换）" }
      - shot: 01-模型浮层（浮层在 chip 上方展开，列出 provider 档与「当前」标记）

  - name: 点 kimi 档——选择即写回（浮层项 role=menuitemradio，WKWebView 未必映射 AXButton，target 不锁 role）
    do: click
    target: { name: "^kimi$" }

  - name: 等 chip 读数翻成 kimi（选择先行，写回随后）
    do: waitFor
    waitFor:
      has: ["模型：kimi（点击切换）"]
    expect:
      - label: chip 读数 = 新选择（D376 重渲；读数翻转同时证明浮层已随选择收起——选择动作必经 setModelPop(false)）
        ax: { has: "模型：kimi（点击切换）" }
      - label: 写回落盘：config.json 的 harness.provider 已是 kimi（pretty JSON 两空格缩进）
        file: { path: "env:config.json", has: '"provider": "kimi"' }
      - shot: 02-选择后-chip读数
---

# 90-harness-model-chip —— 模型 chip 的读数、浮层与选择写回（change move-harness-to-pane-chat-frame tasks 3.1）

## 本场景在验什么

- **chip 读数是配置值**：可访问名 = D376 `模型：{model}（点击切换）`（模板用全角括号，与
  KimiCU 加在标签外的半角括号不冲突，可逐字断）。`[harness].provider` 是唯一真源，chip 照读。
- **浮层列 provider 档且项可达**：点击 chip 后浮层在 chip 上方展开，列出 `kimi` / `deepseek` /
  `mock` 三档，当前档带「当前」标记（截图人读证据）。
- **选择即写回（M351 起下沉真机）**：点 `kimi` 档 → chip 读数翻成 `模型：kimi（点击切换）`
  → `config_set_value("harness","provider",id)` 落盘，`env:config.json` 含
  `"provider": "kimi"`（Rust 侧 `write_config_json` 走 `to_string_pretty`，两空格缩进，
  逐字可断）。

## M351 修复的 AX 暴露问题（沿革，M349 首跑实测归因保留）

**修复前**：`.lumir-hp-modelpop` 是 chip `<button>` 的**子节点**（`position: absolute` 的
包含块需要它锚在 chip 内），而 WKWebView 的 AX 树把**嵌在 button 里的 button 当成叶子**——
浮层项在 AX 里一个都不出现。M349 首跑实测（`test-results/acceptance/2026-10-06/90-harness-model-chip/`）：
截图里浮层清楚可见（三档 + 当前），而同一时刻的 AX dump（`ax/01-01-模型浮层.txt`）里 chip 节点
`[230] AXButton (模型：mock（点击切换）)` **没有任何子节点**，`deepseek` 在整棵树里零命中。
对照：ctx ⓘ 气泡（`.lumir-hp-ctxpop`）嵌在 **span** 里，AX 树照常暴露（场景 87 点 ⓘ 后读到了
气泡全文）——是「嵌在 button 内」这一结构所致。

**修复后（M351，finding 20261006-worker-hp4）**：chip 与浮层同挂 wrapper
（`.lumir-hp-modelwrap`，`position: relative` 的包含块），浮层不再嵌在 button 内，浮层项带
`role=menuitemradio` + `aria-checked` 语义——AX 树正常暴露，「选择 + 写回」判据从视觉层
（`tests/visual/scenes/m347-harness-composer.spec.ts` 的 `__providerWrites` 通道）下沉真机。
视觉层那条 DOM 断言保留（双通道不冲突）。

## 已知边界

- **chip 与浮层项的 AX role 都不锁定**：chip 带 `aria-haspopup="menu"`，WKWebView 把它映射成
  `AXPopUpButton` 而非 `AXButton`（2026-10-07 批次实证：`role: AXButton` 锁定后找不到节点）；
  浮层项 `role=menuitemradio` 可能映射成 `AXMenuItemRadio`。两个点击 target 都只给裸正则源
  `name`（`findNode` 对 title/label/value 逐一匹配），不写 role。
- **「浮层收起」不做 AX 负向断言**：选择后 chip 的可见文本就是 `kimi`，WKWebView 可能把它
  暴露成 `AXStaticText = "kimi"` 子节点——按名字负向断言「kimi 项离场」会被这颗静态文本假杀。
  收起的正观测 = chip 读数翻转（选择动作必经 `setModelPop(false)`），浮层开合行为另由
  m347/m351 视觉场景在 DOM 层钉。
- **「当前」标记不能在真机直接判**：D98「当前」也出现在空态提示「与当前文档对话」里，`has
  "当前"` 会**假过**（本场景首版实测踩到）。当前档标记归视觉层
  `.lumir-hp-modelpop-item.is-current` 与截图。
- **选项表收不窄**：`config_get` 回的是 Rust 侧 `HarnessProviders` 结构体，`kimi`/`deepseek`/`mock`
  三字段恒序列化 ⇒ 真机上浮层恒列三档，配不出「只列一档」的现场。
- **chip ellipsis / hover 全名**：CSS 层行为，视觉层判（`max-width` 截断 + `title` 全名）。

## 环境与副作用

- 不写 vault 文件；`harness.provider` 的写回落在**隔离** `XDG_CONFIG_HOME` 的 config.json
  （每场景重生成，不污染后续场景）；真实 `~/.config/lumir` 全程不读写。
- 合成 vault `/tmp/lumir-m102-acceptance`；1420 全程不碰。
