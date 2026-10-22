---
# M628（Alex 2026-10-23 两条视觉调整）：① user 消息气泡可读性（普通模式与 eink 分别调）；
# ② harness 代码块横向滚动条改细。
#
# 本场景的口径：**证据场景**——截图给 Alex 人眼过目（三主题各一张），机器判据落在视觉套件
# `tests/visual/scenes/m628-harness-bubble-and-scrollbar.spec.ts`（气泡正文取 `--text` 的
# 归属断言 + WCAG 对比度 ≥ 7 + 代码块 `scrollbar-width: thin` 与 CSSOM 4px 声明）。
# 为什么不在套件里再写一遍像素判据：气泡观感属「手感 / 审美」面，按 AGENTS.md「真机验收
# 套件」节「手感/审美不下沉」的口径，套件只留截图证据；而 `pixel` 断言要写死采样点坐标，
# 面板分栏比例 / 消息行位一变就假红，坐标真源在 CSS 与 DOM 里，抄进场景就是第二份真源
# （REVIEW.md「同一语义两处真源」条）。
#
# 真机上仍要判的是**行为面**：气泡与代码块都随本轮回答上屏、主题切换（light → dark → eink）
# 不丢内容——这两条是「样式改坏了会红」的可观测终态。
id: "218-harness-bubble-and-scrollbar"
item: 218
title: harness 用户气泡与代码块滚动条（M628）：三主题下消息与代码块同屏上屏、切主题不丢内容、截图证据
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-bubble-scroll.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮在场是本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入一条用户消息（气泡正文的素材；串里不含 'e'，避开逐键注入的确定性丢键）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|bbr" }
    text: "bbr 这条用户消息读起来清楚吗"
    expect:
      - label: 提问落在 composer 里（注入落地——下一步 Enter 才有东西可发）
        ax: { has: "bbr 这条用户消息读起来清楚吗" }

  - name: 发送
    do: key
    key: enter

  - name: 等回答上屏（含一行超长代码）
    do: waitFor
    waitFor:
      has: ["BUBBLE-PROBE", "longIdentifier"]
    timeoutMs: 60000
    expect:
      - label: 用户消息气泡在场（发送后 composer 已清空，该串只可能来自 transcript）
        ax: { has: "bbr 这条用户消息读起来清楚吗" }
      - label: 回答正文在场（本轮 mock 的标记串）
        ax: { has: "BUBBLE-PROBE" }
      - label: 代码块那一行在场（超长行整行渲染，横向滚动条的载体）
        ax: { has: "longIdentifier" }
      - shot: 01-light-气泡与代码块

  - name: 切到 dark（点 modeline 主题钮一档）
    do: click
    target: { role: AXButton, name: "主题：light（点击切换）" }
    expect:
      - label: 指示钮文案变成 dark（点歪/没生效的话就是这条先红）
        ax: { has: "主题：dark（点击切换）" }
      - label: 切主题不丢消息：用户气泡仍在
        ax: { has: "bbr 这条用户消息读起来清楚吗" }
      - shot: 02-dark-气泡与代码块

  - name: 切到 eink（灰实底退场、改白面 + 黑框的那一档）
    do: click
    target: { role: AXButton, name: "主题：dark（点击切换）" }
    expect:
      - label: 指示钮文案变成 eink
        ax: { has: "主题：eink（点击切换）" }
      - label: 切主题不丢消息：用户气泡仍在
        ax: { has: "bbr 这条用户消息读起来清楚吗" }
      - label: 切主题不丢代码块：超长行仍在
        ax: { has: "longIdentifier" }
      - shot: 03-eink-气泡与代码块
---

# 这个场景验什么

M628 的两条视觉调整要在真机 WKWebView 下走一遍「样式改了，东西还在不在」：

1. **用户消息气泡**：发送后气泡正文上屏（`bbr …` 只可能来自 transcript——composer 发送后清空），
   三主题各截一张图给 Alex 看可读性（浅色 = `--sel` 实底 + 正文档字；eink = 白面 + 1px 黑框）。
2. **代码块横向滚动条**：回答里的超长代码行整行在场（横向溢出的载体），eink 截图看细条形态。

## 判据为什么这样分

- **机器判据（视觉套件 m628）**：气泡正文取 `--text`（token 归属探针）、三主题 WCAG 对比度
  ≥ 7、气泡面与 agent 面可辨；代码块 `scrollbar-width: thin` 计算值 + CSSOM 里
  `.lumir-hp-codeblock::-webkit-scrollbar { width/height: 4px }` 与 diff / argv 逐值一致。
  修前该场景全红（light 4.26:1、`scrollbar-width: auto`），区分度已实测。
- **本场景（真机）**：内容在场 + 切主题不丢内容 + 三张截图。观感与手感归 Alex 人眼，
  按 AGENTS.md「真机验收套件」节不下沉成坐标断言。

## 已知边界

- 本场景首次真机运行在下一个 dogfood 批次（合并后）；截图落在
  `.local/acceptance/<日期>/218-harness-bubble-and-scrollbar/`。
- chromium 里 `::-webkit-scrollbar` 的形态是 overlay（闲置不上屏），截图看不到条；
  WKWebView 声明该选择器后是常驻自绘条，真机截图能看见 4px 细条——这正是本场景要看的东西。
