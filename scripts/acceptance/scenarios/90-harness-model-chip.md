---
id: "90-harness-model-chip"
item: 90
title: 模型 chip：读数 = 配置值、浮层列 provider（选择与写回判在视觉层——浮层不进 AX 树）
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

  - name: 点模型 chip 展开 provider 浮层（浮层内容只留截图证据，见下）
    do: click
    target: { role: AXButton, name: "^模型：" }
    expect:
      - shot: 01-模型浮层（浮层在 chip 上方展开，列出 provider 档与「当前」标记）
      - label: 展开浮层不改 chip 的读数（chip 仍在、仍是配置值）
        ax: { has: "模型：mock（点击切换）" }
---

# 90-harness-model-chip —— 模型 chip 的读数与浮层（change move-harness-to-pane-chat-frame tasks 3.1）

## 本场景在验什么（真机侧只到「读数」与「浮层渲染」）

- **chip 读数是配置值**：可访问名 = D376 `模型：{model}（点击切换）`（模板用全角括号，与
  KimiCU 加在标签外的半角括号不冲突，可逐字断）。`[harness].provider` 是唯一真源，chip 照读。
- **chip 能点开浮层**：点击后 `01-模型浮层` 那张截图是**人读证据**——浮层在 chip 上方展开，
  列出 `kimi` / `deepseek` / `mock` 三档，当前档（`mock`）带「当前」标记。

## 为什么「选择 + 写回」这条判据不落真机（M349 首跑实测）

**浮层内容不进 AX 树**：`.lumir-hp-modelpop` 是 chip `<button>` 的**子节点**（`position: absolute`
的包含块需要它锚在 chip 内），而 WKWebView 的 AX 树把**嵌在 button 里的 button 当成叶子**——
浮层项（`.lumir-hp-modelpop-item`）在 AX 里一个都不出现。M349 首跑实测（
`test-results/acceptance/2026-10-06/90-harness-model-chip/`）：截图里浮层清楚可见（三档 + 当前），
而同一时刻的 AX dump（`ax/01-01-模型浮层.txt`）里 chip 节点 `[230] AXButton (模型：mock（点击切换）)`
**没有任何子节点**，`deepseek` 在整棵树里零命中。

对照强化这条归因：ctx ⓘ 气泡（`.lumir-hp-ctxpop`）嵌在 **span** 里，AX 树就照常暴露（场景 87
点 ⓘ 后读到了气泡全文）。⇒ 是「嵌在 button 内」这一结构所致，不是浮层/交互本身的问题。

**因此**：真机侧只能判「chip 读数」与「浮层渲染（截图）」；**选择即写回
（`config_set_value("harness","provider",id)`）这条判据落视觉层**——
`tests/visual/scenes/m347-harness-composer.spec.ts` 用 DOM 通道点浮层项并断言写回参数逐字
（`__providerWrites` 记录）。这与套件对 ⌘V 粘帖那条边界的处置同一取向（README「已知边界」）。

## 已知边界

- **浮层项不可按 AX 找**：不要写 `target: { role: AXButton, name: "^deepseek$" }`——写不出可点
  节点（本场景首版就是这样 FAIL 的）。要判写回请用视觉层。
- **「当前」标记不能在真机直接判**：D98「当前」也出现在空态提示「与当前文档对话」里，`has
  "当前"` 会**假过**（本场景首版实测踩到）。要判当前档标记就走视觉层的
  `.lumir-hp-modelpop-item.is-current`。
- **选项表收不窄**：`config_get` 回的是 Rust 侧 `HarnessProviders` 结构体，`kimi`/`deepseek`/`mock`
  三字段恒序列化 ⇒ 真机上浮层恒列三档，配不出「只列一档」的现场。
- **chip ellipsis / hover 全名**：CSS 层行为，视觉层判（`max-width` 截断 + `title` 全名）。

## 环境与副作用

- 不写 vault 文件、不改配置（本场景不乱点浮层项）；真实 `~/.config/lumir` 全程不读写。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；1420 全程不碰。
