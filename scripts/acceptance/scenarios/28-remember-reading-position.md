---
id: "28-remember-reading-position"
item: 28
title: 记住文档阅读位置：重启后再次打开同一文件从上次位置继续
fixtures: [reading-position-long.md]
open: reading-position-long.md
marker: "阅读位置长文 开篇标记"
steps:
  - name: 篇首前置：开篇标记在渲染行里、尾部标记不在（后面两条「不在」因此有对照）
    do: settle
    expect:
      - shot: 打开后篇首
      - label: 开篇标记在渲染行里
        ax: { has: "阅读位置长文 开篇标记" }
      - label: 尾部章节标记此时不在渲染行里（证明「翻屏之后才出现」不是恒真）
        ax: { not: "第 24 章 阅读位置标记 篇尾乙" }

  - name: 建立编辑器焦点（点正文顶部：⌃V 翻屏的落点）
    do: clickEditor
    dy: 6
    expect:
      - label: 文档已装载
        editor: { has: "阅读位置长文 开篇标记" }

  - name: 记录磁盘基线 + 位置文件本轮之前不存在
    do: record
    as: 长文文件
    file: reading-position-long.md
    expect:
      - label: 隔离配置目录里此刻还没有位置文件（本次写入必须是这次产生的）
        file: { path: "env:reading-positions/*.json", exists: false }

  - name: ⌃V 翻屏到文档尾部（Emacs C-v：只滚视口、不动光标＝「滚着读」的真实状态）
    do: keys
    keys: ["ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v"]
    gapMs: 400
    expect:
      - shot: 翻屏之后
      - label: 视口已离开篇首（开篇标记不在渲染行里）
        ax: { not: "阅读位置长文 开篇标记" }
      - label: 尾部章节标记在渲染行里（上一条不得在「读不到」上空过）
        ax: { has: "第 24 章 阅读位置标记 篇尾乙" }

  - name: 等防抖写入（滚动停止后 1s 一档）后核对位置确实落到了隔离配置目录
    do: sleep
    ms: 2500
    expect:
      - label: 位置文件出现在隔离配置目录的 reading-positions 下（写侧真的发生了）
        file: { path: "env:reading-positions/*.json", has: "reading-position-long.md" }
      - label: 位置没有写进 vault（ADR 0003 §3）
        file: { path: reading-position-long.md, unchangedSince: 长文文件 }

  - name: 重启 app（跨会话：位置必须已落盘才可能恢复；重启后不自动打开任何文件）
    do: restart
    expect:
      - label: 重启后没有标签（空 vault 引导在场，说明 vault 已装载完成）
        ax: { has: "这个 vault 还没有打开的文件" }
      - label: 重启后没有自动打开任何文件（开篇标记不在渲染行里）
        ax: { not: "阅读位置长文 开篇标记" }

  - name: 手工点开同一文件（装载路径 → 恢复）
    do: open
    file: reading-position-long.md
    marker: "第 24 章 阅读位置标记 篇尾乙"
    expect:
      - shot: 重启后重新打开
      - label: 视口回到上次离开的位置：尾部章节标记在渲染行里
        ax: { has: "第 24 章 阅读位置标记 篇尾乙" }
      - label: 未被拽回篇首：开篇标记不在渲染行里
        ax: { not: "阅读位置长文 开篇标记" }

  - name: 铁律核对（ADR 0003 §3）：文档逐字节未变、vault 里没有新增的 json / tmp 产物
    do: settle
    expect:
      - label: 磁盘长文逐字节未变
        file: { path: reading-position-long.md, unchangedSince: 长文文件 }
      - label: vault 目录里没有位置类产物（位置只进配置目录）
        glob: { dir: "/tmp/lumir-m102-acceptance", pattern: "\\.(json|tmp)$", exact: 0 }
---

## 这条场景在验什么

本能力的**唯一端到端判据**：读一半（⌃V 翻屏到尾部）→ 重启 app → 手工点开同一文件 → 视口回到上次
离开的位置。跨进程的持久化没法在 chromium 桩里验（桩不真实重启），因此它只在这一层。

**判据为什么只对目标成立**：KimICU 的 AX 输出不暴露滚动位置（整窗一个 `AXScrollArea`，没有可读的
`scrollTop`；实测见 26 号场景的「`editor.*` 断言读的是渲染窗口」一节），所以本场景用**被测行为自己
产出的渲染行**作判据——WKWebView 只给视口内已渲染的行建 `AXStaticText` 节点。于是「回到了上次的位置」
写成一对断言：尾部章节标记**在**渲染行里（人确实还在文档尾部且 AX 可读）+ 开篇标记**不在**（没有被
拽回篇首）。同一对断言在翻屏之后、重启之后、重新打开之后各判一次：第一处是前置条件（证明「离开篇首」
这个状态真的建立起来了），后两处是能力本身的判据。

**为什么必须有「等防抖 + 核对落盘」这一步**：位置是应用自己在写（验收套件的 DSL 不能往配置目录预置
文件），重启前的落盘断言把「根本没写」与「写了但没恢复」这两件事分开——否则一次 FAIL 归因不到是写侧
还是读侧。

## 覆盖边界（如实标注）

- **存储侧的降级分支不在这一层**：损坏文件 / 版本不符 / 上限淘汰 / 越界键清理都构造不出来（DSL 没有
  往配置目录写文件的动作），它们归 `cargo test`（`reading_position` 模块 6 条）与
  `tests/unit/reading-position.test.ts`（15 条）。本场景只验端到端那一跳。
- **像素级「差多少算回到原处」不在判据里**：AX 不暴露 `scrollTop`，本场景只判「尾部那两行在、篇首那两行
  不在」。精确到行的往返读数在 chromium 层（`tests/visual/scenes/reading-position-probe.spec.ts`，实测
  `scrollTop` 差 0）。
- **位置文件按 vault 稳定 id 命名，id 是 pid 派生的**，故断言用 `env:reading-positions/*.json` 的 glob
  形式（取最新一份），不写死文件名。
- **运行前请先清一次** `test-results/acceptance/env/lumir/reading-positions/`：套件不为这个新目录做
  per-scenario 重置（`run.mjs` 只重置 recovery / workspaces / vault-sessions），残留文件会让
  「本轮之前不存在」与「mtime 已推进」两条断言失去区分度。
