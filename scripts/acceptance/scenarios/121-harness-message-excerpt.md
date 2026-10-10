---
id: "121-harness-message-excerpt"
item: 423
title: harness 消息摘录 ① transcript 选区 → 浮动钮 → 卡片入 composer（+ 序列化结构 / 视口 skip / transcript 同构）
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
      - label: 面板在位（发送钮在场 = 本次读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 先发一条普通提问，建立一条 assistant 消息（稍后的选区目标）
    do: keys
    keys: ["h", "m", "e"]
  - name: 发送
    do: key
    key: enter
  - name: 等回答到达
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    expect:
      - label: assistant 消息已渲染
        ax: { has: "验收回答：上下文已收到。" }
      - shot: 01-两条消息

  - name: 拖选 assistant 消息正文里的一段文字（transcript 静态文本无 AX bbox，用窗口局部坐标真实拖选）→ 浮动「摘录到对话」钮应浮现
    do: drag
    target: { x: 900, y: 130 }
    dx: 120
    dy: 0
    expect:
      - label: 浮动「摘录到对话」钮在场（D370）
        ax: { has: "/AXButton \\(摘录到对话\\)/" }
      - shot: 02-浮动钮

  - name: 点浮动钮 → 消息摘录卡片入 composer
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: 卡片出处行「对话 · Agent」在场（D442 + D386）
        ax: { has: "对话 · Agent" }
      - label: 卡片带 × 移除钮（composer 形态，读屏名 D371）
        ax: { has: "/AXButton \\(移除摘录\\)/" }
      - label: chip 走「仅路径」形态（携带卡片 ⇒ 跳过视口注入，D373）
        ax: { has: "上下文：harness-note.md" }
      - shot: 03-卡片入composer

  - name: 点 × 移除钮（卡片按整体作用移除；移除后 chip 回到视口形态）
    do: click
    target: { role: AXButton, name: "移除摘录" }
    expect:
      - label: 卡片被整体移除（出处行从 composer 消失）
        ax: { not: "对话 · Agent" }
      - label: chip 回到「视口」形态（卡片没了 ⇒ 视口注入恢复）
        ax: { has: "/上下文：harness-note\\.md · 视口 \\d+–\\d+ 行/" }

  - name: 重新摘一次（确认移除不破坏手势），再写问题并发送
    do: drag
    target: { x: 900, y: 130 }
    dx: 120
    dy: 0
  - name: 点浮动钮把卡片放回 composer
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: 卡片再次入 composer
        ax: { has: "对话 · Agent" }
  - name: 在卡片后的问题段落里写问题（插入后光标落卡片下一行）
    do: keys
    keys: ["w", "h", "y"]
  - name: 发送
    do: key
    key: enter
  - name: 等第二轮回答到达
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    expect:
      - label: 已发送的用户消息里卡片是**跳回入口**（读屏名 D444 + 出处）
        ax: { has: "/AXButton \\(跳回来源消息: 对话 · Agent\\)/" }
      - label: 问题文字与卡片同构平铺在 transcript 里
        ax: { has: "why" }
      - shot: 04-transcript沉淀

  - name: 读会话 wire 留存，断言序列化协议
    do: settle
    expect:
      - label: 投递文本含 `<msg-quote role at>`（role 必选、at 为秒级 ISO 本地串）
        file:
          path: "env:harness/sessions/*.jsonl"
          has: '/msg-quote role=\\?"assistant\\?" at=\\?"[0-9-]+T[0-9:]+\\?"/'
      - label: 协议零编号（无 index / idx 属性）
        file:
          path: "env:harness/sessions/*.jsonl"
          not: '/msg-quote[^>]*(index|idx)=/'
---

# 121-harness-message-excerpt —— 消息摘录 ①（change harness-message-excerpt design §8 ①②⑤⑥）

## 本场景在验什么

在 transcript 的 assistant 消息体内选中片段 → 选区右下浮现「摘录到对话」浮动钮（复用 D370
文案）→ 点击把片段作为 block 级**消息摘录卡片**送进混排 composer（出处行「对话 · 角色」、
× 移除钮）→ 携带卡片时跳过视口注入（chip 走 D373「仅路径」形态）→ 发送后卡片在用户消息里
同构沉淀为跳回入口（读屏名 D444）→ 会话 wire 留存里留下 `<msg-quote role="…" at="…">` 元素。

## 判据为什么这样写

- **transcript 选区怎么造**：transcript 的消息文本在 AX 里是**无 bbox 的 `AXStaticText`**
  （`- [239] AXStaticText = "Agent · 刚刚 验收回答：上下文已收到。"`，无 `@x,y`），
  `doubleClick` / `drag` 的**节点定位**都报「找不到带 bbox 的节点」。可用的通道是 **`drag` 的
  `{x,y}`（窗口局部点）形态**——真实 CGEvent 拖拽在只读静态文本上会造出真实选区（M423 实测：
  拖完浮动钮 `AXButton (摘录到对话)` 当场出现）。坐标随 fixture 布局走（窗口 1200×800、
  harness pane 固定比分、两条短消息），**改 fixture / 窗口尺寸须重取**：跑
  `node scripts/acceptance/run.mjs 121 --keep-app`，看截图里 assistant 正文那一行的窗口局部
  坐标（截图像素 ÷ (截图像素宽/1200)）。
- **不判摘录原文逐字**：卡片的摘录取自 `selection.toString()`，其中文串在 AX 里与转录正文同源、
  没有区分度；卡片在场用**出处行**「对话 · Agent」（只由卡片渲染产出）与 × 钮判。
- **序列化断言取 wire 留存**：投递文本不在 AX 也不在剪贴板，落点是隔离配置目录的
  `harness/sessions/<id>.jsonl`（`llm_request` 记录）。内容在 JSON 里是转义串，故正则允许
  `\"` 与 `"` 两形；`at` 的**具体秒值随机器时区变**，只钉形状（`YYYY-MM-DDThh:mm:ss`）。
- **零编号**：负向断言 `/<msg-quote[^>]*(index|idx)=/` 不命中——属性集合只能是 role / at。
- **移除后再摘一次**：证明「移除按钮不破坏手势」（卡片被移除后，手势仍能再产卡片）。

## 已知边界（如实登记）

- **`select_text` 通道实测对选区驱动的手势无效（M423 探针）**：KimiCU 的 `select_text`（按快照
  index 选文本）能选中，但它只作用于 WebKit 的 AX 选区层——**不产生 DOM `selectionchange`**，
  应用侧（本手势与编辑器手势）都收不到。两条对照：① transcript 正文用 `select_text` 选中后
  截图有高亮，但浮动钮始终不出现；② 同样用 `select_text` 选中**编辑器**正文，编辑器那颗摘录钮
  也不出现（编辑器手势监听同一条 `selectionchange`）。套件因此**没有**引入 `selectText` 动词，
  改用既有 `drag` 的坐标形态（上一条）。另有两条 `select_text` 自身的限制：它只能在合并
  `AXStaticText` 的**第一段**里找文本（`text` 子串搜索），越界报 `text not found`。
- **坐标不是 bbox，是固定布局的常量**：本轮取证窗口固定 1200×800、harness pane 固定比分、
  fixture 固定；坐标漂了会以「浮动钮不在场」当场判红（不会静默选中别处通过——后面还有出处行
  「对话 · Agent」与 wire 里 `role="assistant"` 两条内容判据兜底）。
- **跳回三层（design §8 ④）不在本场景**：跳回命中的落点由面板设置的类名 + 滚动位置表达，
  两者都读不进 AX；跳回的**结构半**由 chromium 视觉场景
  `tests/visual/scenes/m423-message-excerpt.spec.ts` 覆盖（`.is-jump-flash` 出现→退场、
  高亮落在来源消息）。
- **快照恢复 round-trip（design §8 ⑤）** 的解析半由单测
  `tests/unit/message-quote-card.test.ts`（parseQuoteMessage ↔ serializeQuoteMessage 互逆）覆盖；
  真机上的「重启后卡片还原」需要预置 harness 会话留存，套件当前无该预置口（`seed` 只覆盖
  vault 注册表与标签会话）。

## 环境与副作用

- 合成 vault + 隔离 `XDG_CONFIG_HOME`；dev 端口 1430（`LUMIR_ACCEPTANCE_PORT`），绝不碰 1420。
- `drag` 会移动真实光标、要求目标窗口前台无遮挡（套件自带前台纪律与坐标换算）。
