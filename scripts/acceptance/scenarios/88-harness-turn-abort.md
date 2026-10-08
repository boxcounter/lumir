---
id: "88-harness-turn-abort"
item: 88
title: 发送/停止两态：mock 长流在途时点停止 → 本轮中断、已产出保留并标「已停止」、composer 立即可用
open: harness-note.md
marker: "HNL-ALPHA"
# mock 的这条响应带 `delay_ms: 12000`（脚本化延迟）：complete() 在 lumir-harness-llm 专线程上
# 阻塞 12 秒不返回，这段时间就是「处理中」窗口。本场景要在窗口内点停止——12s 对键盘注入 +
# 一次 MCP 往返（秒级）留足裕量。**`delay_ms` 是不可中断的**（一次睡到底），因此停止请求仍由
# complete() 返回后的检查点判到、产出照常完整保留——「流式期间就能断」那半边（M369 的在途停止）
# 走场景 97 的 `chunk_delay_ms` 形态（见正文「为什么「长流」用 delay_ms」）。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-abort.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 空闲态：发送钮在场（D329）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 空闲态没有停止钮
        ax: { not: "/AXButton \\(停止\\)/" }

  - name: 输入提问并 Enter 发送——相位入 running
    do: keys
    keys: ["a", "b", "o", "r", "t"]
  - name: 发送
    do: key
    key: enter

  - name: 等两态翻转（同一颗钮换成停止态）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(停止\\)/"]
    timeoutMs: 20000
    expect:
      - label: 处理中：发送钮的钮面换成停止态（D378）
        ax: { has: "/AXButton \\(停止\\)/" }
      - label: 同时刻没有发送钮（两态互斥）
        ax: { not: "/AXButton \\(发送\\)/" }
      - label: 阶段指示在场（不定态进度 + 「等待响应…」，D381）
        ax: { has: "等待响应…" }
      - shot: 01-处理中-停止钮

  - name: 点停止——中断本轮（harness_abort）
    do: click
    target: { role: AXButton, name: "^停止$" }

  - name: 等中断收口（mock 睡满 12s 后 complete 返回，检查点判中断——delay_ms 不可中断，见正文）
    do: waitFor
    waitFor:
      has: ["已停止"]
    timeoutMs: 60000
    expect:
      - shot: 02-已停止
      - label: 中断标注「已停止」挂在被打断的消息上（D383）
        ax: { has: "已停止" }
      - label: 已产出内容保留在 transcript（中断是「不再继续」，不是回滚）
        ax: { has: "ABORT-KEEP 这段产出应当保留。" }
      - label: JSONL 记下中断事件（turn_aborted sidecar）
        file: { path: "env:harness/sessions/*.jsonl", has: '"kind":"turn_aborted"' }
      - label: 已产出文本也已留存（中断前半截响应随 llm_response 落盘）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*"kind":"llm_response".*ABORT-KEEP 这段产出应当保留。.*$/' }

  - name: composer 收口回空闲（aborted 经 finished 回 idle，可继续发问）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(发送\\)/"]
    timeoutMs: 15000
    expect:
      - label: 停止后钮面回到发送态（本轮结束）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 停止钮已离场
        ax: { not: "/AXButton \\(停止\\)/" }
      - label: 进度/阶段行随相位收起
        ax: { not: "等待响应…" }
---

# 88-harness-turn-abort —— 发送/停止两态与轮次中断（change move-harness-to-pane-chat-frame tasks 4.1）

## 本场景在验什么

M347 把发送钮做成两态（空闲「发送」/ 处理中「停止」），M348 把停止态点击接通 Rust core 的
`harness_abort`。本场景走真机验证这条链路端到端成立：

1. **两态翻转**：空闲时钮面 `发送`（D329）、没有停止钮；发出提问后翻成 `停止`（D378），
   同时刻没有 `发送`（互斥）。
2. **阶段指示与不定态进度**：处理中阶段行读 `等待响应…`（D381，首个 chunk 前）。进度条本身
   是普通 `div`（无 `role`、无 aria-label），AX 读不到——它的判据在视觉层与截图里。
3. **中断语义 = 「不再继续」**：在途点停止 → 本轮收口，**已产出的文本保留**并挂「已停止」
   徽标（D383），JSONL 记 `turn_aborted` sidecar + 保留的 `llm_response` 正文。
4. **composer 立即可用**：`aborted` 经 finished 回 idle，钮面回到 `发送`。

## 为什么「长流」用 `delay_ms`

`delay_ms` 让 `complete()` 阻塞式睡满 12 秒，期间一个 `text_chunk` 都不发——这正是「问题已发出、
模型还没开始吐字」这个窗口，也是本场景要验的**前端两态**（发送 ⇄ 停止）所处的相位：阶段行读
`等待响应…`（D381），而不是 `正在生成回复…`（D382）。

**它不可中断**（M369 起仍然如此，`delay_ms` 一次睡到底）：停止请求在这 12s 里落下，但要等
`complete()` 返回后才被中断检查点 ① 判到（`src-tauri/src/harness/turn.rs`）。因此
「睡满 12s → 返回已算好的响应 → 检查点看到中断标志 → 走 `abort_turn`」是这条链路的确定性路径，
不是竞态猜测；`abort_turn` 保留整条产出（`status="stopped"` 的面板消息 + `turn_aborted` 留存）
——这就是「产出保留 + 已停止标注」。

`delay_ms` 与「流式期间就能断」是两回事：M369 把停止标志接进了读流/分片产出循环（在途停止），
**可中断的时序杠杆是 `chunk_delay_ms`（分片之间的间隔）**，它的场景是 97。本场景刻意留在
`delay_ms` 形态上：它同时是被保护的回归面——若哪天有人把「无间隔也做中断探测」改回来，
「产出照常完整保留」这条就会红。

## 断言口径

- **停止钮点击**：`target: { role: AXButton, name: "^停止$" }`——钮的可访问名就是钮面文本
  （无 aria-label），`^停止$` 锚定避免误命中其它含「停止」的节点。
- **「已停止」在场**：`ax.has "已停止"`——D383 只在被打断的本轮消息上挂一次；它是中断**已发生**
  的正观测（配合下面的 JSONL 盘上事实，不靠时长猜）。
- **产出保留**：`ax.has` 断言中断文本（`ABORT-KEEP …`）——文本只可能来自流式转发（M369 起由
  解析层即时发 `text_chunk`）/ `abort_turn` 的面板消息路径。
- **JSONL**：`turn_aborted` sidecar 与保留的 `llm_response` 正文都是盘上事实，钉死「这一轮真的被中断收口」
  而不是「什么都没发生、停止钮恰好消失了」。

## 已知边界（如实登记）

- **进度条的「不定态」动画不在本层**：`.lumir-hp-progress` / `.lumir-hp-bar` 是无 role 的 div，
  AX 里只有阶段行文本可读。动画与线宽表达（含 eink punch）归视觉层。
- **「停止后可继续提问」只判到 idle**：本场景判钮面回到 `发送`（composer 已收口、可再发），
  **没有**真的再发一轮（mock 每轮从脚本头重弹，再发一轮会再睡 12s，成本高且对判据无增量）。
- **中断落在工具执行段 / 批准闸等待**：那两条检查点（②③）需要有在途工具调用的现场，本场景
  只覆盖检查点 ①。工具循环中断的判据在 Rust 侧单测
  （`src-tauri/src/harness/turn.rs` 的 `turn_aborted` 路径）与批准闸收回的 `approval_withdrawn`。
- **「流式期间就能断」不在本场景**：这里停在 `delay_ms`（不可中断）形态上，只验「产出保留 +
  已停止标注 + 两态收口」；**流中收流**（部分到达 + 在途停止）归场景 97——两者刻意分工，
  谁也不是谁的超集。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；不写 vault 文件（只发问、
  停止），JSONL 留存落在隔离配置目录的 `sessions/` 下（`env:harness/sessions/*.jsonl`）。真实 vault 只读。
- 本场景耗时主要是一次 12s 的 mock 延迟；`caffeinate` 包住整批以免休眠漂窗。
