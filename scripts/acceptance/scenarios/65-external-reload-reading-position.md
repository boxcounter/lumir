---
id: "65-external-reload-reading-position"
item: 65
title: 外部改写当前文档：重载后视口不回篇首（阅读位置恢复）+ 表格全屏遮罩退出
fixtures: [reading-position-reload.md]
open: reading-position-reload.md
marker: "第 1 章 概览"
config:
  keys: { "Cmd-j": "table.toggle-fullscreen" }
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
    file: reading-position-reload.md
    expect:
      - label: 隔离配置目录里此刻还没有位置文件（本次写入必须是这次产生的）
        file: { path: "env:reading-positions/*.json", exists: false }

  - name: ⌃V 翻屏到文档尾部（只滚视口、不动光标＝「滚着读」的真实状态）
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
        file: { path: "env:reading-positions/*.json", has: "reading-position-reload.md" }
      - label: 位置没有写进这个文件（ADR 0003 §3：位置只落配置目录）
        file: { path: reading-position-reload.md, unchangedSince: 长文文件 }

  - name: caret 进文档尾部的表（第 15 章那张，渲染为 grid）
    do: clickInNode
    target: { role: "AXTable", any: "Markdown 表格 1" }
    dx: 0.5
    dy: 0.5
    expect:
      - label: 表格在场且渲染成 AX 表（命令的靶子；上一条「第 15 章在渲染行里」保证它在可视区）
        ax: { has: "Markdown 表格 1" }

  - name: 执行 table.toggle-fullscreen（经 [keys] 绑定的 ⌘J）打开遮罩
    do: key
    key: "cmd+j"
    expect:
      - label: 遮罩已打开（模态接管：标签栏从 AX 树里消失）
        ax: { not: "关闭 reading-position-reload.md" }
      - label: 快照里的表格文本在场
        ax: { has: "甲" }
      - shot: 遮罩打开

  - name: 外部改写当前文档（在**末尾追加**一段：锚之前的字节不变，恢复落点因此仍是原来那一行）
    do: vaultAppend
    file: reading-position-reload.md
    content: "\n外部追加的一段：这一段只存在于磁盘版。\n"
    expect:
      - label: 磁盘已按外部内容改写
        file: { path: reading-position-reload.md, has: "只存在于磁盘版" }

  - name: 等 watch 事件与自动重载跑完（干净缓冲 ⇒ 自动重载），再留一拍读 AX
    do: sleep
    ms: 2500
    expect:
      - shot: 外部重载之后
      - label: 内容确实被重载成磁盘版（「什么都没发生」不会让下面几条空过）
        editor: { has: "只存在于磁盘版" }
      - label: 遮罩已退出（内容换代后快照不再是当前文档；改前它会停在屏幕上）
        ax: { has: "关闭 reading-position-reload.md" }
      - label: 视口仍在尾部：第 15 章两行在渲染行里
        ax: { has: "第 15 章 概览 第 15 章概览正文。" }
      - label: 没被拽回篇首：第 1 章两行不在渲染行里
        ax: { not: "第 1 章 概览 第 1 章概览正文。" }

  - name: 铁律核对（ADR 0003 §3）：vault 里没有新增的 json / tmp 产物
    do: settle
    expect:
      - label: vault 目录里没有位置类产物（位置只进配置目录）
        glob: { dir: "/tmp/lumir-m102-acceptance", pattern: "\\.(json|tmp)$", exact: 0 }
---

## 这条场景在验什么

外部改写**当前**文档时（干净缓冲 ⇒ 自动重载），重载路径的两条行为（finding
`20260927-worker-survey-esc-jump-bug-item.md`，M279 的 T6 实测现场）：

1. **视口 MUST NOT 停在篇首**：重载把视口复位到篇首（`editor.reloadSession` 的既有复位），
   改前这一路**不经** `openFile` 的 `readingPositions.restoreFor`，读了一半的文档被外部改写一次
   就被拽回开头。修法是重载后按**装载口径**补一次恢复（与 `openFile` 同一条 store 口子）。
2. **内容取自旧一份文档的浮层 MUST 退出**：表格全屏的快照是**打开那一刻**渲染态 grid 的深克隆，
   文档换代后它展示的是已不存在的内容。改前这一路只有遮罩自己的 `blur` 兜底，而注释声称它兜住
   「文档代际变化」——实测**从不触发**（重载不移动焦点，遮罩一直持焦）。修法是重载处显式关闭。

## 判据形态：为什么「仍在原处」是一对断言

KimICU 的 AX 输出**不暴露滚动位置**（整窗一个 `AXScrollArea`，没有可读的 `scrollTop`），因此
「回到了上次的位置」只能写成一对：`第 15 章 概览 第 15 章概览正文。` **在**渲染行里（人还在文档
尾部、且 AX 可读）+ `第 1 章 概览 第 1 章概览正文。` **不在**。这对写法与场景 28 同源（那里已被
真机反复验证过），也是本能力的既有判据形态。

**外部写入为什么是「追加」而不是整篇重写**：锚是**文档位置**（行块起点 + 相对视口偏移），追加在
末尾不动锚之前的字节，恢复落点因此仍是原来那一行——否则「落点行号偏移」会与「位置没恢复」混在
一起，一次 FAIL 归因不到是读侧还是写侧。`editor.has 只存在于磁盘版` 那条断言同时钉住「重载真的
发生了」（防「什么都没发生」让后面几条空过）。

## 覆盖边界（如实标注）

- **像素级「差多少算回到原处」不在判据里**：AX 不暴露 `scrollTop`。精确往返读数在 chromium 层
  （`tests/visual/scenes/m286-external-reload-viewport.spec.ts`：同一处「重载前 → 重载后」的
  `scrollTop` 差 0，行号相同；那里的消融日志 `test-results/m286/` 给出改前的红：`1541 → 0`、
  遮罩 `hidden=false` 仍在）。
- **载荷侧的 pos 0 判据（M279 finding 的另一半）在 chromium 层**：视觉场景读桩上的
  `reading_position_put` 载荷；本层没有读配置目录里 json 字段的动作（DSL 没有「读文件内容」的
  断言形态），因此只判「位置文件里有这个路径」这一条写侧证据。
- **捕获让位窗口（M286 的 pos0 修法）不在本层**：它的判别层是单测（窗口语义，确定性）与
  webkit-realua 视觉场景（真机同款 UA 下引擎确实动过视口 + 载荷仍是跳变前的真锚），见
  `tests/unit/viewport-transition.test.ts` / `tests/unit/reading-position.test.ts` 与
  `tests/visual/scenes/m280-overlay-esc-scroll.spec.ts`。
- **后台标签的重载不在本层**：只改后台文档时「不拽走前台视口、不关前台遮罩」由视觉场景
  `m286-external-reload-viewport.spec.ts` 的第二条用例覆盖（本层改成后台标签再改写要另加
  `open` + 切换步骤，收益不成比例）。
- **手感的「重载之后读者有没有被惊到」不下沉**：归 Alex dogfood，本场景只留截图。
