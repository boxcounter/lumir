---
id: "93-harness-thinking-blocks"
item: 93
title: 思考块三态：折叠默认（原文不显）、展开见思考原文、折叠行时长读数在场
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-thinking.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏；分栏态焦点落 composer）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮在场 = 本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问（可打印序列，注入回读校验由 keys 动作内部完成）
    do: keys
    keys: ["t", "h", "k", "p", "r", "o", "b", "e"]
    expect:
      - label: 提问落在 composer 里（注入落地——下一步 Enter 才有东西可发）
        ax: { has: "thkprobe" }

  - name: Enter 发送（mock fixture 产出 reasoning_chunks 的这条响应）
    do: key
    key: enter

  - name: 等回答到达且思考块立起
    do: waitFor
    waitFor:
      has: ["THINK-ANSWER-01", "/思考过程 · \\d+ 秒/"]
    expect:
      - label: 回答正文渲染（agent 消息在场）
        ax: { has: "THINK-ANSWER-01" }
      - label: 折叠行「思考过程 · N 秒」在场（D388 时长读数在场）
        ax: { has: "/思考过程 · \\d+ 秒/" }
      - label: 折叠默认态下思考原文不显（body[hidden] 不进 AX——三态的第一态）
        ax: { not: "THINK-BODY-ALPHA" }
      - shot: 01-折叠默认

  - name: 点折叠行展开思考块
    do: click
    target: { role: AXButton, name: "^思考过程" }

  - name: 展开态：思考原文可见（两片都在）
    do: waitFor
    waitFor:
      has: ["THINK-BODY-ALPHA 第一片。", "THINK-BODY-BETA 第二片。"]
    expect:
      - label: 展开后第一片思考原文上屏
        ax: { has: "THINK-BODY-ALPHA 第一片。" }
      - label: 同一块内第二片也在（分片按到序拼接）
        ax: { has: "THINK-BODY-BETA 第二片。" }
      - label: 折叠行仍在（展开不撤行，时长读数保持）
        ax: { has: "/思考过程 · \\d+ 秒/" }
      - shot: 02-展开见原文

  - name: 再点折叠行收起（三态闭环：折叠 → 展开 → 折叠）
    do: click
    target: { role: AXButton, name: "^思考过程" }

  - name: 收起后：思考原文重新不可见
    do: waitFor
    waitFor:
      not: ["THINK-BODY-ALPHA"]
    expect:
      - label: 收起后思考原文不再进 AX
        ax: { not: "THINK-BODY-ALPHA" }
      - label: 折叠行仍在（收起不丢块）
        ax: { has: "/思考过程 · \\d+ 秒/" }
      - shot: 03-再折叠
---

# 93-harness-thinking-blocks —— 思考块三态（change add-harness-thinking-display-and-effort §6.3 前半）

## 本场景在验什么

mock fixture 产出 `reasoning_chunks`（M362 的展示分片通道）⇒ transcript 里 agent 消息渲染一个
**可折叠的思考块**，三态各有可观测判据：

1. **折叠默认**：块默认折叠，只有折叠行（chevron + 「思考过程 · N 秒」，D388）在场上屏，思考
   **原文不进 AX**（`body.hidden` ⇒ `display:none`，`src/harness-panel.css` 的
   `.lumir-hp-think-body[hidden]`）。这是「不含流式期间都折叠」的 Alex 裁决（提案节点 3）在
   真机上的可观测形态。
2. **展开见原文**：点折叠行 ⇒ `aria-expanded` 翻 `true`、`body.hidden=false`，思考原文（模型
   明文，`encrypted_content` 永不进展示通道）上屏；同一块内多个分片按到序拼接。
3. **时长读数在场**：折叠行文本恒为「思考过程 · N 秒」（模板整串走 D388），收起展开都不丢块。

## 断言口径与已知边界

- **「折叠默认」判「原文不显」而不是判 `aria-expanded`**：WKWebView 的 AX 文本不暴露
  `aria-expanded`（全仓现有 AX dump 零命中；模型 chip / vault 钮同样带该属性也读不到），
  直接断言它会把「读不到」当「false」——正是 REVIEW.md 第 2 条禁的假绿形态。折叠的**可观测
  后果**是原文不可见 + 折叠行在场，两者联合即「块存在且折叠」；`aria-expanded` 属性本身归
  前端单测（`tests/unit/harness-thinking.test.ts`）与视觉层。
- **「块数为零」的反向验证在场景 94**（另一份不含 reasoning 的 fixture）：本场景的 AX 是全窗
  范围，transcript 里已有本轮的块，无法在本场景内做「零块」计数。
- **时长读数在 mock 下恒为 0 秒**：`turn.rs` 把一条响应的 `reasoning_chunks` 在同一循环里连发
  （无片间延迟），前端时长 = 首末分片墙钟差 = 0。「时长在场」因此只断言折叠行渲染了
  `思考过程 · \d+ 秒`（读数存在、格式正确），不判它非零——那是 mock 通道的性质，不是缺陷；
  计时算法的正确性归前端单测 `thinkingDurationSec`。
- **思考原文的两片标记互不为子串**、且与回答串（`THINK-ANSWER-01`）、提问串（`thkprobe`）
  两两不复现：负向断言（`not THINK-BODY-ALPHA`）不会被别处的文本满足，正向断言也不会误命中。

## 环境与副作用

- 不写 vault 文件、不碰剪贴板；mock provider 只在内存里弹脚本，零外部 API 调用。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`（config.json 每场景重生成）；
  真实 `~/.config/lumir` 与真实 vault 全程不读写。1420 全程不碰。
