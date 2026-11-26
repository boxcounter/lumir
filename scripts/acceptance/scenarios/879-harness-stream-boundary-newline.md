---
# change fix-harness-stream-boundary-newline-nov26（Alex 2026-11-26「好。请你安排」）：
# 流式分片边界不得超过当前源长。第一片以换行结尾时，旧实现的定稿边界是「源长 + 1」，
# 下一片从源外起切——首字符被吞掉，且在轮次终态全量重渲之前一直缺席。
#
# 判据落在流式**中间态**：分片间隔 6 秒，第二片到达后、第三片未到时读一次 AX。区分度：
# 修复后 AX 有「首字符检验。」，旧实现只有「字符检验。」（缺「首」）——这是终态重渲
# 掩盖不了的那一段窗口（终态会按完整源重渲，所以终态断言只作回归面，不是判据本体）。
id: "879-harness-stream-boundary-newline"
item: 879
tier: full
title: 流式分片边界不越界：前一片以换行结尾时，下一片首字符在中间态即上屏
open: harness-note.md
marker: "HNL-ALPHA"
# mock 逐片到达：chunks 是显式字符串列表，chunk_delay_ms 撑开片间隔（与场景 97 同一杠杆）。
# 第一片以单个换行结尾（split 会多出一个空串行——旧实现越界边界的触发形态）。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-newline-chunks.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 空闲态：发送钮在场（本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问（短 ASCII 序列，少受逐键注入噪声影响）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|strm-nl" }
    text: "strm-nl"
    expect:
      - label: 提问落在 composer 里（注入落地——下一步 Enter 才有东西可发）
        ax: { has: "strm-nl" }

  - name: 发送
    do: key
    key: enter

  - name: 等第一片（以换行结尾）上屏
    do: waitFor
    waitFor:
      has: ["边界后段。"]
    timeoutMs: 30000
    expect:
      - label: 第一片两段都已上屏（前段已定稿、后段在尾块）
        ax: { has: "边界前段。" }
      - label: 第二片尚未到达（增量到达，不是整条一次上屏）
        ax: { not: "首字符检验。" }

  - name: 等第二片到达（片间隔 6 秒；此后还有 6 秒窗口到第三片）
    do: waitFor
    waitFor:
      has: ["字符检验。"]
    timeoutMs: 30000
    expect:
      # 判据本体：第一片以换行结尾 ⇒ 边界必须夹在源长内，第二片的首字符「首」必须上屏。
      # 旧实现边界 = 第一片源长 + 1，尾块从「字」起切——这一条即判红。
      - label: 第二片首字符在中间态即上屏（边界不越界的正观测）
        ax: { has: "首字符检验。" }
      - label: 第一片正文未丢（跨片拼接不重排、不吞前文）
        ax: { has: "边界前段。" }
      - label: 第一片尾段仍在（前一片没有被越界边界整段跳过）
        ax: { has: "边界后段。" }
      - shot: 01-第二片首字符

  - name: 等第三片到达
    do: waitFor
    waitFor:
      has: ["结束。"]
    timeoutMs: 30000
    expect:
      - shot: 02-第三片

  - name: 等轮次收口（无在途轮次）
    do: waitFor
    waitFor:
      not: ["/AXButton \\(停止\\)/"]
    timeoutMs: 30000
    expect:
      # 终态按完整源全量重渲，旧实现也会补齐——故这里只作回归面（不替代中间态判据）。
      - label: 终态含第一片前段（跨片拼接不重排）
        ax: { has: "边界前段。" }
      - label: 终态含第一片尾段
        ax: { has: "边界后段。" }
      - label: 终态含第二片完整文本（首字符在终态只得来自完整源重渲）
        ax: { has: "首字符检验。" }
      - label: 终态含第三片文本
        ax: { has: "结束。" }
      - label: 已收口回空闲（停止钮离场）
        ax: { not: "/AXButton \\(停止\\)/" }
      - shot: 03-终态
---

# 879 —— 流式分片边界不越界（change `fix-harness-stream-boundary-newline-nov26`）

## 本场景在验什么

`flushChunks` 把流式源切成「已定稿块」与「进行中尾块」：切分点写进文本段的
`renderedFinalized` 游标，下一片到达时 `slice(renderedFinalized)` 就是尾块的起点。旧实现
的 `finalizedUpTo` 用 `source.split("\n")` 逐行推进 offset——源以 `\n` 结尾时 split 多产出
一个空串行，该行按「空行」推入 `offset + 0 + 1 = source.length + 1`。游标因此越过源长，
下一片从源外起切，**首字符被吞掉**。

本场景用 mock 的显式分片把触发形态摆出来：

- 第一片 = `边界前段。\n\n边界后段。\n`（以单个换行结尾）；
- 第二片 = `首字符检验。`（第一片的下一片，首字符是判据本体）；
- 第三片 = `结束。`。

## 判据与区分度

- **中间态（判据本体）**：第二片到达后、第三片未到时读 AX，要求 `首字符检验。` 在场。
  旧实现边界 = 第一片源长 + 1，尾块从「字」起切，AX 里只有 `字符检验。`——这一条必红。
  先等 `字符检验。` 是**预备件**（证明第二片确实已到达，避免「读不到当空」的假绿），
  真正判红的是完整串 `首字符检验。`。
- **终态（回归面）**：轮次收口时 `finalizeStreamingMessage` 对每段完整源全量重渲，旧实现
  在这一步也会补齐首字符——所以终态断言只能守住「没有永久丢字 / 没有重排重复」，它不是
  本缺陷的判据本体，如实登记在此。
- **片间隔**：`chunk_delay_ms: 6000` 撑出中间态窗口（与场景 97 同一杠杆）；第二片到达后
  到第三片之间是完整的 6 秒。

## 已知边界（如实登记）

- 中间态窗口是**时间窗**，不是状态窗：机器极慢、AX 读取超过 6 秒时可能读到第三片之后。
  那时第二片文本仍在（修复后），判据不会假红；但若回归形态变成「只在两帧之间丢字」，本
  场景可能漏判——那属于渲染时序面，由单测（真面板 rAF 逐帧断言）守。
- 判据只覆盖「第一片以单换行结尾」这一触发形态；连续空行、CRLF、闭合围栏后的同样形态由
  `tests/unit/harness-stream-boundary.test.ts` 的属性用例与真面板用例覆盖，不在这里逐条重跑。
- 本场景不判排版 / 字号 / 间距（归 Chromium 视觉门禁）。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；只发问、不改 vault 文件。
  真实 vault 只读；1420 不碰（实例走 `LUMIR_ACCEPTANCE_PORT=1430`）。
- 本场景耗时主要是一到两次片间隔（6s）+ 收口。
