---
id: "92-harness-new-session-idempotent"
item: 92
title: 新建会话幂等（M350）：空会话态连点「新会话」×3 不报错、视图保持空态
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）——全新 vault，从未提问（无会话态）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 空闲态：发送钮在场（D329）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 空态提示在场（D346，视图初始形态）
        ax: { has: "与当前文档对话" }
      - label: 段内「新会话」同名钮恰两颗（会话名钮 + 新建钮；浮层未开）
        ax: { count: { pattern: "/\\(新会话\\)/", exact: 2 } }

  - name: 连点新建会话 ①（消歧靠 role 分流：会话名钮带 aria-haspopup → AXPopUpButton，＋新建钮是唯一叫「新会话」的 AXButton）
    do: click
    target: { role: AXButton, name: "^新会话$", nth: 0 }

  - name: 连点新建会话 ②
    do: click
    target: { role: AXButton, name: "^新会话$", nth: 0 }

  - name: 连点新建会话 ③
    do: click
    target: { role: AXButton, name: "^新会话$", nth: 0 }
    expect:
      - label: 无「当前没有正在进行的对话轮次」错误（M350 前的回归形态：new_session 被 no_session 短路）
        ax: { not: "当前没有正在进行的对话轮次" }
      - label: 空态提示仍在（resetView 后视图回空态，不是报错现场）
        ax: { has: "与当前文档对话" }
      - label: 「新会话」仍恰两颗（护卫：误点会话名钮会开出浮层多一行——没点错对象）
        ax: { count: { pattern: "/\\(新会话\\)/", exact: 2 } }
      - shot: 01-连点三次后
---

# 92-harness-new-session-idempotent —— 新建会话幂等（change harness-new-session-idempotent，M350）

## 本场景在验什么

M350 的不变量（`src-tauri/src/harness.rs` `Runtime::new_session` 文档注释）：**任意会话状态下
调用 new_session 均成功，结果恒为新空会话**；无会话（从未提问 / 刚重置）时目标状态已成立，
平凡成功。M350 前的回归形态：旧实现用 `with_session` 探测 busy，无会话时被
`harness_no_session` 短路成错误——面板「New session → 报错『当前没有正在进行的对话轮次』→
再点仍报错」。

真机判据（全新 vault、从未提问 = 最干净的无会话态）：

1. 连点「＋新会话」钮三次，**错误横幅零出现**（`not "当前没有正在进行的对话轮次"`——
   前端 `startNewSession` 的 catch 会把它 appendError 进 transcript）。
2. 空态提示（D346）仍在：每次成功都是 resetView 回空态，视图不自残。
3. 「新会话」同名钮计数恒为 2：这条是**点没点错对象**的护卫——段内会话名钮与新建钮在
   未命名会话下 AX 名都是「新会话」（场景 86 注释实测），消歧靠 role 分流：会话名钮带
   `aria-haspopup="menu"` → WKWebView 映射 `AXPopUpButton`，＋新建钮无 haspopup 保持
   `AXButton`（2026-10-07 批次实证：`nth` 按 DOM 序取钮的初版全红——role 锁定 AXButton
   后只剩新建钮一个命中）；若点错开到会话浮层，浮层动作项同文案会多出第三个「新会话」
   节点，计数立即破 2。

## 已知边界

- **无会话态没有盘上正观测**：wire 口径下「新会话」重置只影响内存态与留存文件的**边界**（旧文件
  封闭、下一次建立会话才开新文件），重置本身不写任何决策类 sidecar（`session_reset` 是 reshape
  废弃的 kind）；全新会话在收到第一条记录前留存文件惰性不建——无会话态因此没有任何盘上记录可
  断言，本场景的判据全在 AX 面（错误零出现 + 视图守恒），不盘 file 断言。
- **busy 失败态不在本场景**：「对话正在处理中，请等本轮结束…」（harness_busy）需要在途
  轮次现场，由 Rust 侧单测覆盖；本场景只锁「无会话 ≠ 错误」这条回归。
- **role 分流口径脆弱性已知**：消歧依赖 WKWebView「aria-haspopup → AXPopUpButton」这条
  稳定映射；若未来新建钮也加 haspopup（或会话名钮去掉），role 锁定会失配——计数断言
  （exact 2）与点击失配会一起红，不会静默假绿。

## 环境与副作用

- 不写 vault 文件、不发提问（零 mock 往返）；合成 vault `/tmp/lumir-m102-acceptance` +
  隔离 `XDG_CONFIG_HOME`；真实 vault 只读，1420 全程不碰。
