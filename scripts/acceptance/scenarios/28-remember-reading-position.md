---
id: "28-remember-reading-position"
item: 28
title: 记住文档阅读位置：重启后再次打开同一文件从上次位置继续
fixtures: [toc-long.md]
open: toc-long.md
marker: "第 1 章 概览"
steps:
  - name: 篇首前置：第 1 章两行在渲染行里、第 15 章两行不在（后面的「不在」因此有对照）
    do: settle
    expect:
      - shot: 打开后篇首
      - label: 第 1 章两行在 AX 渲染行里
        ax: { has: "第 1 章 概览 第 1 章概览正文。" }
      - label: 第 15 章两行此时不在渲染行里（证明「翻屏之后才出现」不是恒真）
        ax: { not: "第 15 章 概览 第 15 章概览正文。" }

  - name: 建立编辑器焦点（点正文顶部：⌃V 翻屏的落点）
    do: clickEditor
    dy: 6
    expect:
      - label: 文档已装载
        editor: { has: "第 1 章 概览" }

  - name: 记录磁盘基线 + 位置文件本轮之前不存在
    do: record
    as: 长文文件
    file: toc-long.md
    expect:
      - label: 隔离配置目录里此刻还没有位置文件（本次写入必须是这次产生的）
        file: { path: "env:reading-positions/*.json", exists: false }

  - name: ⌃V 翻屏到文档尾部（Emacs C-v：只滚视口、不动光标＝「滚着读」的真实状态）
    do: keys
    keys: ["ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v"]
    gapMs: 400
    expect:
      - shot: 翻屏之后
      - label: 视口已离开篇首（第 1 章两行不再出现在渲染行里）
        ax: { not: "第 1 章 概览 第 1 章概览正文。" }
      - label: 第 15 章两行在渲染行里（上一条不得在「读不到」上空过）
        ax: { has: "第 15 章 概览 第 15 章概览正文。" }

  - name: 等防抖写入（滚动停止后 1s 一档）后核对位置确实落到了隔离配置目录
    do: sleep
    ms: 2500
    expect:
      - label: 位置文件出现在隔离配置目录的 reading-positions 下（写侧真的发生了）
        file: { path: "env:reading-positions/*.json", has: "toc-long.md" }
      - label: 位置没有写进这个文件（ADR 0003 §3：位置只落配置目录）
        file: { path: toc-long.md, unchangedSince: 长文文件 }

  - name: 重启 app（跨会话：位置必须已落盘才可能恢复；重启后不自动打开任何文件）
    do: restart
    expect:
      - label: 重启后没有标签（空 vault 引导在场，说明 vault 已装载完成）
        ax: { has: "这个 vault 还没有打开的文件" }
      - label: 重启后没有自动打开任何文件（第 1 章两行不在渲染行里）
        ax: { not: "第 1 章 概览 第 1 章概览正文。" }

  - name: 手工点开同一文件（装载路径 → 恢复）
    do: open
    file: toc-long.md
    # marker 是对 **AXTextArea.value** 的正则（不是对整份 AX dump 的子串）：value 里相邻两行用
    # **换行**相连，而 AXStaticText 节点里用**空格**相连（`ax.has` 那条走的是后者）。`\s*` 两边都命中，
    # 因此这条等待既能证明「文件真的进了编辑器」、又钉住「它进的位置就是尾部」。
    marker: "第 15 章 概览\\s*第 15 章概览正文。"
    expect:
      - shot: 重启后重新打开
      - label: 视口回到上次离开的位置：第 15 章两行在渲染行里
        ax: { has: "第 15 章 概览 第 15 章概览正文。" }
      - label: 未被拽回篇首：第 1 章两行不在渲染行里
        ax: { not: "第 1 章 概览 第 1 章概览正文。" }

  - name: 铁律核对（ADR 0003 §3）：文档逐字节未变、vault 里没有新增的 json / tmp 产物
    do: settle
    expect:
      - label: 磁盘长文逐字节未变
        file: { path: toc-long.md, unchangedSince: 长文文件 }
      - label: vault 目录里没有位置类产物（位置只进配置目录）
        glob: { dir: "/tmp/lumir-m102-acceptance", pattern: "\\.(json|tmp)$", exact: 0 }
---

## 这条场景在验什么

本能力的**唯一端到端判据**：读一半（⌃V 翻屏到第 15 章）→ 重启 app → 手工点开同一文件 → 视口回到
上次离开的位置。跨进程的持久化没法在 chromium 桩里验（桩不真实重启），因此它只在这一层。

**判据形态沿用场景 25 的成对写法**（那里已被真机反复验证过）：KimICU 的 AX 输出不暴露滚动位置
（整窗一个 `AXScrollArea`，没有可读的 `scrollTop`；`editor.*` 断言读的是 AXTextArea.value = 渲染窗口
± 约 1000px，见 26 号场景的一节），因此「回到了上次的位置」只能写成一对断言——
`第 15 章 概览 第 15 章概览正文。` **在**渲染行里（人还在文档尾部且 AX 可读）+ `第 1 章 概览 第 1 章概览正文。`
**不在**（没有被拽回篇首）。同一对断言在翻屏之后、重启之后、重新打开之后各判一次：第一处是前置条件
（证明「离开篇首」这个状态真的建立起来了），后两处是能力本身的判据。

**为什么必须有「等防抖 + 核对落盘」这一步**：位置由应用自己写（验收 DSL 不能往配置目录预置文件），
重启前的落盘断言把「根本没写」与「写了但没恢复」分开——否则一次 FAIL 归因不到写侧还是读侧。它同时钉住
一条实现纪律：**滚动之前不许有位置文件**（flush 在没有待写内容时不写盘），否则这条断言会先红。

## 覆盖边界（如实标注）

- **存储侧的降级分支不在这一层**：损坏文件 / 版本不符 / 上限淘汰 / 越界键清理都构造不出来（DSL 没有
  往配置目录写文件的动作），它们归 `cargo test`（`reading_position` 模块 6 条）与
  `tests/unit/reading-position.test.ts`（15 条）。本场景只验端到端那一跳。
- **像素级「差多少算回到原处」不在判据里**：AX 不暴露 `scrollTop`。精确往返读数在 chromium 层
  （`tests/visual/scenes/reading-position-probe.spec.ts`：同一处「捕获 → 关标签 → 重新打开」的
  `scrollTop` 差 **0**，顶部可见行逐字相同）。「滚回篇首附近但没到顶部」这类小幅漂移不在判据内，
  属手感范畴归 Alex。
- **位置文件按 vault 稳定 id 命名（id 是 pid 派生的）**，故断言用 `env:reading-positions/*.json` 的
  glob 形式（取最新一份），不写死文件名。
- **per-scenario 隔离**：`run.mjs` 已为这个新目录加 `resetPositions()`（与 recovery / workspaces /
  vault-sessions 同因）——否则上一场景（或昨天那次 run）留在隔离配置目录里的位置会让本场景一打开
  文件就换位置。
