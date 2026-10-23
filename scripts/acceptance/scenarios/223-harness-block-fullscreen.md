---
id: "223-harness-block-fullscreen"
item: 223
title: harness 面板里的代码块与表格全屏：hover 钮打开遮罩、内容只含该块、Esc 退出、焦点回到面板
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-block-fs.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问并 Enter 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|blkfs" }
    text: "blkfs"
    expect:
      - label: 提问落在 composer 里（注入落地——下一步 Enter 才有东西可发）
        ax: { has: "blkfs" }
  - name: 发送
    do: key
    key: enter

  - name: 等回答到达（代码块与表格都上屏）
    do: waitFor
    waitFor:
      has: ["BLOCK-FS-CODE-01"]
    timeoutMs: 30000
    expect:
      - label: 回答里的代码块已渲染（内容逐字）
        ax: { has: "BLOCK-FS-CODE-02" }
      - label: 回答里的表格已渲染（cell 逐字）
        ax: { has: "BLOCK-FS-CELL-甲" }
      # 入口是 hover 钮（共享形态类的静止态口径：visibility: hidden ⇒ 不进 AX 树）。
      # 这条是负向断言，正观测由下面「hover 之后它出现了」那一步配对。
      - label: 静止态全屏钮不在 AX 树里（共享形态类的刻意口径，不是缺陷）
        ax: { not: "放大查看代码块" }
      - shot: 01-块已上屏

  - name: 悬停代码块的第一行（hover 是钮浮现的唯一通道）
    do: hover
    target: { role: AXStaticText, name: "BLOCK-FS-CODE-01", dy: 0.5 }
    retries: 4
    expect:
      - label: 悬停后全屏钮进 AX 树（钮已浮现——入口是被 hover 唤出来的）
        ax: { has: "/AXButton \\(放大查看代码块\\)/" }

  - name: 点开代码块全屏
    do: click
    target: { role: AXButton, name: "^放大查看代码块$" }
    settleMs: 800

  - name: 等遮罩接管
    do: settle
    expect:
      - label: 遮罩打开（AX 树被模态接管：面板控制行的发送钮消失）
        ax: { not: "/AXButton \\(发送\\)/" }
      - label: 遮罩里有该块的整块源码（两行都在）
        ax: { has: "BLOCK-FS-CODE-01" }
      - label: 遮罩只含该块——表格 cell 不在（重建而非克隆整条消息）
        ax: { not: "BLOCK-FS-CELL-甲" }
      - shot: 02-代码块全屏

  - name: Esc 退出
    do: key
    key: "escape"
    expect:
      - label: 遮罩退场（面板控制行回到 AX 树）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 焦点回到发起它的面板（落在全屏钮上，不是编辑器）
        ax: { focused: "AXButton" }
      - shot: 03-退出后

  - name: 悬停表格 cell（同一通道打开表格全屏）
    do: hover
    target: { role: AXStaticText, name: "BLOCK-FS-CELL-甲", dy: 0.5 }
    retries: 4
    expect:
      - label: 悬停后表格的全屏钮进 AX 树
        ax: { has: "/AXButton \\(放大查看表格\\)/" }
      # 钮的位置（表格右上角内侧 6px，M660 #4）由 chromium 场景按几何钉住；这张截图留给
      # Alex 看「钮是否一眼可见」的手感判断。
      - shot: 03b-表格悬停-全屏钮

  - name: 点开表格全屏
    do: click
    target: { role: AXButton, name: "^放大查看表格$" }
    settleMs: 800

  - name: 等遮罩接管
    do: settle
    expect:
      - label: 表格遮罩打开（模态接管）
        ax: { not: "/AXButton \\(发送\\)/" }
      - label: 遮罩里有该表的 cell 文本
        ax: { has: "BLOCK-FS-CELL-甲" }
      - label: 遮罩只含该表——代码块内容不在（快照源就是那张表）
        ax: { not: "BLOCK-FS-CODE-01" }
      - shot: 04-表格全屏

  - name: Esc 退出
    do: key
    key: "escape"
    expect:
      - label: 遮罩退场、面板回来
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 焦点回到面板
        ax: { focused: "AXButton" }
---

# 223-harness-block-fullscreen —— harness 面板里的块级全屏（M634，change add-harness-block-fullscreen）

## 本场景在验什么

Alex 的需求原话：「harness pane 中的 code 和 table 也支持全屏查看（类似 content pane 里的做法）」。
面板里的**代码块与表格**悬停浮现全屏钮，点击打开**既有的**两个单实例遮罩（content pane 那两条的
同一份实现：同一壳、同一关闭路径、同一呈现口径）。本场景在真实 WKWebView 下判三件事：

1. **入口**：静止态钮不在 AX 树里（共享形态类的 `visibility: hidden` 口径）；hover 到块上之后钮
   出现、可按（两态都断言，负向断言有正观测配对）。
2. **遮罩内容只含该块**：代码块全屏里没有表格 cell、表格全屏里没有代码行——这条钉的是「呈现计划
   取自那一块」而不是「克隆整条消息」。
3. **关闭与焦点**：`Esc` 退场，焦点回到发起它的面板（不是编辑器）——`aria-modal` 的语义要求
   关掉当前层之后键盘还能继续用。

## 断言口径

- **模态接管 = 面板控制行消失**：遮罩是 `role=dialog` + `aria-modal=true`，WKWebView 在遮罩打开
  期间把面板其余部分移出 AX 树（与场景 62 的「标签栏消失」同一判据）。因此「遮罩开着」用
  `not 发送` 判，「遮罩关了」用 `has 发送` 判——比按遮罩文本判更稳（遮罩与面板都显示同一段文本，
  文本类断言分不出两者）。
- **内容互斥**：代码块全屏里 `not BLOCK-FS-CELL-甲`、表格全屏里 `not BLOCK-FS-CODE-01`。两段文本
  在面板里同时在场（上一步各自断言过），所以这两条不是「读不到当成空」的空转负向
  （REVIEW.md「读不到当成空」条）。
- **hover 是唯一通道**：钮静止态 `visibility: hidden`，不进 AX 树（`not 放大查看代码块` 那条）——
  这是形态类的刻意口径，不是缺陷；hover 之后同一条断言反过来成立，两条配对证明「通道有效」。
- **钮与表格的几何距离不进真机判据**（M660 #4）：AX 只回答「钮在不在树里」，回答不了「钮离表
  多远」；「表格 slot 贴合表宽、钮落回表格右缘内侧 6px」由
  `tests/visual/scenes/m634-harness-block-fullscreen.spec.ts` 的 M660 #4 用例按 `getBoundingClientRect`
  钉住（含「表确实窄于面板」的区分度前置）。本场景的 `03b` 截图只作手感证据。

## 已知边界（如实登记）

- **hover 目标是静态文本节点**：`do: hover` 按节点 bbox 取点，代码行 / 表格 cell 在 WKWebView 的
  AX 树里是 `AXStaticText`。若某次 AX 快照里这些文本节点没有 bbox（WebKit 版本差异），hover 会
  报「找不到带 bbox 的节点」——那是通道退化，不是产品缺陷；届时改用 `anchor` 形态（锚在同块内
  另一个有 bbox 的节点上并按 `offsetX/offsetY` 取点）即可，判据本身不变。
- **钮的浮现手感、遮罩观感**（壳、间距、滚动节奏）归 Alex 手感裁决，不进机器判据；本场景只判
  在场 / 内容 / 关闭 / 焦点。
- **流式期间打开的快照口径**（D4）不在本场景：需要 mock 分片 + 片间隔窗口，已由视觉场景
  `tests/visual/scenes/m634-harness-block-fullscreen.spec.ts`（chromium 结构断言）与单测覆盖；
  真机层的分片时序另行加场景，避免把两条互不相关的时序杠杆挤进一个场景。
- **表格快照只含已渲染的部分**：与 content pane 表格全屏同一条既有边界（长表 / 惰性渲染），本
  场景的合成表只有一行，判不到这一层。

## 环境与副作用

- 只发问、只见证遮罩开合：**不写 vault 文件**（`BLOCK-FS` 系列文本都是合成 fixture 内容）。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；1420 全程不碰，实例走
  `LUMIR_ACCEPTANCE_PORT`（默认 1430）。
