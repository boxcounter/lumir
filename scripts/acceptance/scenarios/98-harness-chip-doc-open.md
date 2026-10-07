---
id: "98-harness-chip-doc-open"
item: 98
title: "Harness ⑭ 上下文 chip 随文档打开即时刷新（不开 composer 也刷新；M370 修复「开着文件显示 Context: none」）"
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: ⌘⇧A 打开 harness pane——chip 指向当前文档
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: chip 指向 harness-note（D332 视口形态）
        ax: { has: "/上下文：harness-note\\.md · 视口 \\d+–\\d+ 行/" }

  - name: 左栏点开第二个文档（焦点落在编辑器，**不碰 composer**）
    do: open
    file: harness-note-two.md
    marker: "HNL2-ALPHA"

  - name: 等界面落定（chip 的会话身份看守 400ms 一拍刷新）
    do: settle
    expect:
      - label: chip 已随文档打开刷新到第二个文件（旧现场：开着文件却停在旧读数 / none）
        ax: { has: "/上下文：harness-note-two\\.md · 视口 \\d+–\\d+ 行/" }
      - label: 旧文档的 chip 文案不再出现（正反双判，不是「两个都在」的假绿）
        ax: { not: "/上下文：harness-note\\.md /" }
      - label: 编辑器正文确已是第二个文档（AX 编辑器通道的正观测）
        editor: { has: "HNL2-ALPHA" }
      - shot: 01-切文档-chip已刷新

  - name: 再点回第一个文档——chip 反向刷新
    do: open
    file: harness-note.md
    marker: "HNL-ALPHA"

  - name: 等界面落定
    do: settle
    expect:
      - label: chip 回到第一个文件
        ax: { has: "/上下文：harness-note\\.md · 视口 \\d+–\\d+ 行/" }
      - label: 第二个文档的 chip 文案不再出现（标签仍在——负向必须锚 chip 文案串，不能锚文件名）
        ax: { not: "/上下文：harness-note-two/" }
---

spec 判据（harness「上下文注入与可见性」的**即时性**面，M370）：文档打开 / 标签切换后，
上下文 chip **不依赖 composer 获焦**即刷新到当前文档——Alex 2026-10-07 现场「开着文件显示
Context: none」。

- **旧触发集为何漏**：`refreshChip` 只在 composer 获焦 / 发送 / 切 vault / 挂载时调用（
  `src/harness-panel.ts` 的注释是 canonical 居所）——打开文档后焦点落在编辑器，chip 停在
  打开面板那一刻的读数上（面板开在空档那就是「Context: none」）。
- **修复形态**：会话身份看守——attach 期间每 400ms 比一次 `editor.activeSession()` 引用，
  变了才 `refreshChip`。装配层没有现成的「活跃会话变化」事件通道，面板能稳定读到的只有
  复合句柄的 `activeSession()`（harness pane 持焦时解析到活跃 doc pane），身份比对是
  最小钩子（只在变化那一拍付出 assembly 成本）。
- **本场景的判别力**：正向（新文件路径出现）+ 负向（旧文件路径消失）双判——只断正向的
  话「chip 从不刷新、两个文件恰好都没打开过」之类的现场会假绿；反向一步（点回第一个
  文档）挡「只增不减」的实现偏差。

## 断言口径

- **chip 文案**：`/上下文：<file> · 视口 \d+–\d+ 行/`（D332 视口形态；`–` = en dash）。
  负向判据写成 `/上下文：harness-note\.md /`（带尾空格）——避开「harness-note-two.md」
  的前缀撞车：two 的 chip 文本是「harness-note-two.md」，不含「harness-note.md 」子串，
  反向判定因此有区分度。
- **settle 的语义**：连续两次 AX 快照逐字节一致才算落定——看守的刷新拍（≤400ms +
  渲染）落进 settle 的等待窗里，断言不会抢到刷新前半截状态。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；真实 vault 只读。
- 只打开文档、不发消息（mock fixture 因此不会弹尽）；不写 vault 文件。
- 1420 全程不碰，套件走自带 1430。
