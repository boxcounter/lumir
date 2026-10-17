---
id: "93-harness-thinking-blocks"
item: 93
title: 思考块三态（live：折叠默认 / 展开见原文 / 时长读数）+ 会话恢复重建的思考块默认收起、折叠行取无时长变体、点开见原文
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
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|thkprobe" }
    text: "thkprobe"
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

  - name: 等回合收口（＋新会话与恢复都要求非 busy）
    do: waitFor
    waitFor:
      not: ["/AXButton \\(停止\\)/"]
    timeoutMs: 15000

  - name: 点「＋新会话」把源会话切成历史会话（＋钮是唯一叫「新会话」的 AXButton；
      会话名钮带 aria-haspopup → AXPopUpButton，role 分流，场景 106 同口径）
    do: click
    target: { role: AXButton, name: "^新会话$" }

  - name: 等新会话重置（transcript 回空态——resetView 的正观测）
    do: waitFor
    waitFor:
      has: ["与当前文档对话"]
    timeoutMs: 15000

  - name: 打开会话浮层（会话名钮带 aria-haspopup → AXPopUpButton）
    do: click
    target: { role: AXPopUpButton, name: "新会话" }

  - name: 等历史会话行出现（会话名 = 源会话首条用户消息 thkprobe；此处已清 transcript，
      该串只在选择器行里）
    do: waitFor
    waitFor:
      has: ["thkprobe"]
    timeoutMs: 15000

  - name: 点历史会话行恢复（后端读末条 llm_request 的完整请求体 + 折入其后那条响应——
      fixture 的 `reasoning` 回放项由此进灌回的 input；坐标通道见场景 106 的 M406 口径）
    do: clickInNode
    target: { name: "thkprobe" }

  - name: 等恢复完成（会话名落回源会话首条用户消息）
    do: waitFor
    waitFor:
      has: ["/AXPopUpButton \\(thkprobe/"]
    timeoutMs: 15000

  - name: 恢复路径：重建的思考块默认收起（M542 不变量「恢复渲染 = 默认渲染」）
    do: settle
    expect:
      - label: 恢复的 assistant 消息重建（回答正文在场——下面几条只可能来自恢复出的历史）
        ax: { has: "THINK-ANSWER-01" }
      - label: 重建的思考块默认收起——思考原文不进 AX（body[hidden]，与 live 折叠默认同口径）
        ax: { not: "THINK-BODY-ALPHA" }
      - label: 折叠行在场、取无时长变体 D468：整串就是「思考过程」（wire 不带思考时长读数，不伪造数字）
        ax: { has: "/AXButton \\(思考过程\\)/" }
      - label: 恢复路径不出现时长变体 D388（D468 在场那条的可区分判据——live 那条块已随 resetView 清掉，全窗此刻只有恢复块）
        ax: { not: "/思考过程 · \\d+ 秒/" }
      - shot: 04-恢复-折叠默认

  - name: 点恢复块的折叠行展开
    do: click
    target: { role: AXButton, name: "^思考过程$" }

  - name: 展开后原文上屏（正观测：手势真落地，否则上一条「原文不显」是空转）
    do: waitFor
    waitFor:
      has: ["THINK-BODY-ALPHA 第一片。"]
    expect:
      - label: 展开后第一片思考原文上屏
        ax: { has: "THINK-BODY-ALPHA 第一片。" }
      - label: 同一块内第二片也在（reasoning 回放项的 summary parts 按到序拼接）
        ax: { has: "THINK-BODY-BETA 第二片。" }
      - shot: 05-恢复-展开
---

# 93-harness-thinking-blocks —— 思考块三态 + 恢复路径默认收起（change add-harness-thinking-display-and-effort §6.3 前半；M542 不变量）

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

后半段在同一份会话上验**恢复路径**（M542 不变量「恢复渲染 = 默认渲染」，Alex 2026-10-16
「重建后 thinking 过程默认是展开的，我希望它保持收起」）：发完一轮后「＋新会话」把源会话切成
历史会话 → 会话浮层选回它恢复 → 重建出的 transcript 里，思考块**默认收起**、折叠行取**无时长
变体 D468**（整串「思考过程」）、点开后原文上屏（正观测，防「原文不显」在空转的块上恒真）。

两条路径的可区分性来自 fixture 的两个字段**互不影响**（M362 纪律）：`reasoning_chunks` 是展示分片
（live 路径专用，产出的是**带时长的 D388** 折叠行），`reasoning` 是**回放项**（进 wire 的
`llm_response.reasoning`，恢复时折回 input ⇒ core 侧 `thinking::reasoning_text` 取明文 ⇒ 面板
按 `PanelMessage.reasoning` 建块）。因此「恢复块不出现 D388、只出现 D468」这条负向断言在本场景里
有区分度——若恢复走了 live 口径、或时长被拿 0 填空，它必红。

## 断言口径与已知边界

- **「折叠默认」判「原文不显」而不是判 `aria-expanded`**：WKWebView 的 AX 文本不暴露
  `aria-expanded`（全仓现有 AX dump 零命中；模型 chip / vault 钮同样带该属性也读不到），
  直接断言它会把「读不到」当「false」——正是 REVIEW.md 「读不到当成空」条禁的假绿形态。折叠的**可观测
  后果**是原文不可见 + 折叠行在场，两者联合即「块存在且折叠」；`aria-expanded` 属性本身归
  前端单测（`tests/unit/harness-thinking.test.ts`）与视觉层。
- **恢复段的「原文不显」有正向前置**：① 展开那几步证明同一通道能真的改到 DOM；② 恢复段内部
  先断言回答正文在场（transcript 确实重建），再断言原文不显、再点开证明原文真的在那里
  ——「点开后原文上屏」这条正观测是整段负向判据的防恒真装置（REVIEW.md 「断言等价于子串」条）。
- **D468 与 D388 的区分判据**：D468 是「思考过程」，D388 是「思考过程 · {sec} 秒」——断言形态
  `/AXButton \(思考过程\)/`（整串到右括号为止）只命中前者，`/思考过程 · \d+ 秒/` 只命中后者。
  两条一起用（一条在场、一条不在场）才有区分度：只判「思考过程」在场会被带时长的那条满足。
- **恢复的思考文本来自 wire 明文**：kimi 的不透明 `encrypted_content` 项取不到明文 ⇒ 不建块
  （不伪造）。本 fixture 给的是 kimi 形态的 `summary` parts（`thinking::reasoning_text` 认它）。
  若将来 fixture 改成只给 `encrypted_content`，本场景的恢复段会红——那是如实反映「取不到明文」，
  不是缺陷。
- **「块数为零」的反向验证在场景 94**（另一份不含 reasoning 的 fixture）：本场景的 AX 是全窗
  范围，transcript 里已有本轮的块，无法在本场景内做「零块」计数。
- **时长读数在 mock 下恒为 0 秒**：`turn.rs` 把一条响应的 `reasoning_chunks` 在同一循环里连发
  （无片间延迟），前端时长 = 首末分片墙钟差 = 0。「时长在场」因此只断言折叠行渲染了
  `思考过程 · \d+ 秒`（读数存在、格式正确），不判它非零——那是 mock 通道的性质，不是缺陷；
  计时算法的正确性归前端单测 `thinkingDurationSec`。
- **思考原文的两片标记互不为子串**、且与回答串（`THINK-ANSWER-01`）、提问串（`thkprobe`）
  两两不复现：负向断言（`not THINK-BODY-ALPHA`）不会被别处的文本满足，正向断言也不会误命中。
- **恢复回路与场景 106 同源**：后端恢复取源文件**末条会话轮次** `llm_request` 的完整请求体、
  再折入紧随其后的那条 `llm_response`（`src-tauri/src/harness.rs` 的 `resume_session`）——
  折入的响应项里就带 `reasoning` 回放项，这是本场景单轮会话也能恢复出思考块的原因。会话名 /
  选择器行 / 恢复后会话名钮的定位锚点与「＋新会话」的 role 分流，均照 106 的既有口径写。

## 环境与副作用

- 不写 vault 文件、不碰剪贴板；mock provider 只在内存里弹脚本，零外部 API 调用。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`（config.json 每场景重生成）；
  真实 `~/.config/lumir` 与真实 vault 全程不读写。1420 全程不碰。
