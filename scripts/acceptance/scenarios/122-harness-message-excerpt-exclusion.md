---
id: "122-harness-message-excerpt-exclusion"
item: 423
title: harness 消息摘录 ② 排除面：思考块内选区不出钮（消息体选区出钮为正向对照）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-thinking.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮在场 = 本次读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 发一条长提问（mock 产出 reasoning_chunks 的响应）——问题够长，正向对照的落点才不落在气泡的空白处
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|harness-user-message-body-positive-control-probe-alpha-bravo-charlie" }
    text: "harness-user-message-body-positive-control-probe-alpha-bravo-charlie"
  - name: 发送
    do: key
    key: enter

  - name: 等回答与思考块到达（折叠默认态）
    do: waitFor
    waitFor:
      has: ["THINK-ANSWER-01", "/思考过程 · \\d+ 秒/"]
    expect:
      - label: 回答正文渲染
        ax: { has: "THINK-ANSWER-01" }
      - label: 折叠默认态下思考原文不显（负观测的正向前置）
        ax: { not: "THINK-BODY-ALPHA" }

  - name: 点折叠行展开思考块
    do: click
    target: { role: AXButton, name: "^思考过程" }
  - name: 展开态：思考原文可见
    do: waitFor
    waitFor:
      has: ["THINK-BODY-ALPHA 第一片。"]
    expect:
      - label: 展开后思考原文上屏（下一步的选区目标在场）
        ax: { has: "THINK-BODY-ALPHA 第一片。" }

  - name: 拖选思考块正文里的一段（选区落在思考块内）→ MUST NOT 出浮动钮
    do: drag
    target: { x: 1000, y: 161 }
    dx: 100
    dy: 0
    expect:
      - label: 思考块内选区不出「摘录到对话」钮（排除面）
        ax: { not: "/AXButton \\(摘录到对话\\)/" }
      - shot: 01-思考块内无钮

  - name: 拖选**用户消息体**里的一段（正向对照：同一手势在消息体里出钮；落点取 transcript 首条消息的正文行——它是顶部锚定的）
    do: drag
    target: { x: 1000, y: 90 }
    dx: 100
    dy: 0
    expect:
      - label: 消息体选区出钮（证明上一条负观测不是「手势全不工作」的空转）
        ax: { has: "/AXButton \\(摘录到对话\\)/" }
      - label: 钮整体落在视口内（落点钳制的不变式；有区分度的现场在场景 160 与 m423 的「钳制」用例）
        geom:
          target: { role: AXButton, name: "摘录到对话" }
          minWidth: 40
          minHeight: 16
          painted: { min: 60 }
      - shot: 02-消息体出钮

  - name: 点这颗钮，验它确实来自**消息体**（落点若漂到编辑器 pane，出的是编辑器那颗同名的钮）
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: 卡片出处行是「对话 · 你」（D442；编辑器那颗钮产出的出处行是文件名，不是它）
        ax: { has: "对话 · 你" }
      - shot: 03-出处行
---

# 122-harness-message-excerpt-exclusion —— 消息摘录 ② 排除面（design §8 ②）

## 本场景在验什么

transcript 里并非所有文字都能摘：思考块、工具行、批准卡、消息内引用卡片内部的选区 MUST NOT
出「摘录到对话」钮（design §5 排除面）。本场景用思考块一条可造的形状验排除，并配一条**正向
对照**（同一 `drag` 拖选手势在**用户消息气泡**里出钮）——排除面的负向断言必须有一条同通道的
正观测兜底，否则「按钮根本没工作」也会让负向断言假绿（REVIEW.md 「断言等价于子串 / 读不到当成空」条）。正向对照落在
用户消息体而不是助手段的**回答正文**，是为了让落点落在**顶部锚定**的正文行上（下节）。

## 两个落点怎么定（2026-10-13 真机读数标定）

两条 `drag` 的 y：

| 落点 | y | 为什么是它 |
|---|---|---|
| 思考块正文第一行 | **161** | 折叠钮（`思考过程 · N 秒`）的 bbox 顶部在 y=127（`ax/*` 的 mode=ax；2026-10-10 与 2026-10-13 两轮**逐点相同**），其下第一行正文 ≈ 152–169 ⇒ 161 命中第一行，且**思考块折行条数变化也不影响第一行**（折行只往下长） |
| 用户消息正文第一行 | **90** | transcript 是**顶部锚定**的：首条消息的 who 行在 y=63、气泡正文行在 ≈82–98（两轮证据同）。窗口尺寸、harness pane 的宽度、思考块折几行都改不动它 |

**回答正文（y≈190 或 207）不能当正向对照的落点了**：它的 y 取决于思考块占几行，而思考块折行
与否取决于 harness pane 的宽度，pane 宽度又取决于**持久化的 pane_split_ratio**（写在 vault
会话文件里，跨场景继承；2026-10-10 那轮是 0.656、2026-10-13 是 0.482、本轮结束时落盘 0.6）——
同一个窗口尺寸下，回答正文的 y 可以是 190 也可以是 207，差一行。顶部锚定的用户消息正文行没有
这个耦合。助手段回答正文的**可摘性**由场景 121 覆盖（那里没有思考块，落点稳定）。

两条 `drag` 的 x = **1000**：它是**窗口局部坐标**（transcript 文本在 AX 里是无 bbox 的
`AXStaticText`，节点形态定位不了；KimiCU 的 `select_text` 能选中却不产生 DOM `selectionchange`，
手势收不到——因此套件没有引入 `selectText` 动词，只能用坐标拖选）。1000 的取值依据：

- **必须落在 pane 内**（否则拖到左侧编辑器 pane 上，出的会是编辑器那颗同名钮）：pane 左缘 =
  294 + ratio×(窗宽−294)（由两轮读数反推：窗宽 1200 / ratio 0.656 → 888；窗宽 1361 / ratio 0.482
  → 808，两处都命中同一式子）。x 在 pane 内 ⟺ ratio < 706/(窗宽−294)：窗宽 1361 → 0.662、
  1200 → 0.779、1152 → 0.823。实测过的两个点（888 与 808）都在 1000 左边、留 112 / 192px 余量；
  最贴的一次是「窗宽 1361 且 ratio 取到实测最大值 0.656」→ 左缘 ≈ 994，1000 只余 6px。
  **再往上（窗宽 1361 且 ratio > 0.662）1000 就出 pane 了**——那时正向对照会红（见下条），
  不会被编辑器那颗同名钮掩盖成假绿。
- **必须在第一行**。用户消息那条问题（68 个字符的探针串）保证气泡第一行从正文左缘一直铺到
  1000 之后：正文左缘最靠左的情形（pane 最宽）≈ 696，68 字符 ≈ 420px ⇒ 覆盖到 ≈1116。
  问题短了就会在气泡右半边的空白处落下、拖不出选区（正向断言当场红）。

**判错来源不会假绿**：落点漂到编辑器 pane 时，编辑器那颗同名钮也会让「消息体选区出钮」这条
断言通过——所以正向对照后补一步「点这颗钮 ⇒ 卡片出处行是 `对话 · 你`（D442）」。编辑器那颗钮
产出的出处行是文件名，不是 `对话 · 你`，落点漂移因此变成一条**可读的红**。

## 已知边界（如实登记）

- **拖选通道仍是窗口局部坐标**（上节的口径与包络）：改 fixture、改窗口尺寸或改 pane 的
  split ratio 都可能让 1000/90/161 失准——失准时「思考块内不出钮」只是空转（负观测在空选区上
  也成立），但正向对照那两条会红，所以不会静默假绿。
- **pane 宽度不可由场景确定**（已知缺口，超出本场景范围）：`pane_split_ratio` 存在 vault 会话
  文件里，跨场景继承、套件的 per-scenario reset 不清它 ⇒ 同一条 run 内不同场景看到的 pane
  宽度可以不同。坐标型场景都吃这个亏（本场景与 121 同源）。
- **浮动钮的落点钳制（M531）**：本场景的拖选落点在 transcript 顶部锚定的正文行上，钮的候选落点
  远在可视区内——`geom` 那条只作**不变式**（钮在视口内且尺寸未坏）。有区分度的现场：编辑器那颗钮
  由场景 160 判（选区越出挂载容器），transcript 那颗的纵向钳制由 chromium 视觉场景
  `tests/visual/scenes/m423-message-excerpt.spec.ts` 的「钳制」用例判（选区贴 transcript 可视区底缘）。
- 工具行 / 批准卡 / 卡片内部三条排除分支的 DOM 判据在 chromium 视觉场景
  `tests/visual/scenes/m423-message-excerpt.spec.ts`（程序化选区，稳定可判）。
- **末步 `do: click` 的 AXPress 通道在 M541 之后对本钮失效（M549 定位，2026-10-17）**：现象是
  该步读完断言时 AX 里钮已消失、composer 仍空（KimiCU 只在返回值里自报 `suspected_noop`，
  套件照判 FAIL 不静默）。真机四跑的分离证据（现场 `test-results/acceptance/m549-122/`）：
  ① 只把 `src/message-quote-gesture.ts` 与 `src/quote-gesture.ts` 退回 M541（`f9be8e1a`）之前的
  版本、其余全部为当前 master ⇒ 本场景 12/12 PASS（`run5-prev541-frontend`）；② 同样两文件为
  M541 版本时，本步换 `clickInNode`（KimiCU 坐标通道）仍 FAIL（`run6-clickinnode`），换
  `doubleClick` + `mode: 1`（swift 真实指针单击，同一坐标）则 12/12 PASS（`run7-realclick`）。
  ⇒ 两个 KimiCU 通道都无效、真实指针点击有效；缺口是「该钮经辅助功能 press 不再可按下」
  （**候选机制**：M541 新加的 document 级 pointer 监听把这次按下当成新拖拽、`hideButton()`
  把钮摘出 DOM；未最终坐实，详见 finding），
  **产品侧修复前本步会一直红**，换 KimiCU 通道绕不过去（详情与复现见 M549 的 finding）。
