---
# M703（change harness-table-horizontal-scroll-oct24）的真机判据：harness 对话里的宽表在
# WKWebView 下按固有宽铺开，横向溢出由表格自己的容器承载。
#
# **本场景判什么、不判什么**：真机 AX 不暴露表格几何、cell 行数或 scrollTop，
# 「表格多宽 / 是否还折行 / 实际滚了多少」在真机层不可机验。本文件只判四条可观测终态：
# ① 宽表上屏且首末列 cell 文本齐全；② 滚轮注入在表格区域执行不报错（通道自证，证据里留
# 自报行）；③ 前后各一张 `shot` 给 Alex 人眼判「是否铺开 / 是否滚起来了」；④ 滚动后内容不丢。
# 几何与「cell 单行」的机器判据在 `tests/visual/scenes/m703-harness-table-scroll.spec.ts`
# （chromium 结构矩阵），MUST NOT 把本场景读成「几何已机验」。
id: "234-harness-table-horizontal-scroll"
item: 703
title: harness 对话宽表：固有宽铺开、横向滚轮在表格区域执行、滚动前后截图（几何归 chromium 矩阵）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-table-scroll.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问并 Enter 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|tbl" }
    text: "tbl"
    expect:
      - label: 提问落在 composer 里（注入落地——下一步 Enter 才有东西可发）
        ax: { has: "tbl" }
  - name: 发送
    do: key
    key: enter

  - name: 等宽表上屏
    do: waitFor
    waitFor:
      has: ["TABLE-SCROLL-首列-甲"]
    timeoutMs: 30000
    expect:
      - label: 表格首列 cell 在场
        ax: { has: "TABLE-SCROLL-首列-甲" }
      - label: 表格末列 cell 在场（横向溢出时末列初始在可视区外，AX 仍应收录全文）
        ax: { has: "TABLE-SCROLL-末列-甲" }
      - label: 表头在场
        ax: { has: "名称" }
      - shot: 01-宽表初始态

  - name: 让窗口成为 key window（真实正文单击，滚轮注入的前台前提）
    do: focusWindow
    retries: 4
    click: true

  - name: 在宽表区域投真实横向滚轮
    do: scroll
    # 落点 = 宽表可视区域内的截图像素点。为什么不用 AX 节点：WKWebView 把表格暴露成
    # AXTable + AXRow（行只有组合名、没有 bbox，cell 也不是 AXStaticText），节点路径取不到
    # 滚轮落点。本点由本场景证据的 AX dump 标定（AXTable @698,142 563×67，取表内 (900,175)）；
    # 窗口由套件钉 1200×800，表格位置随首条消息固定。方向与位移量不做机验——前后截图为唯一判据。
    target: { x: 900, y: 175 }
    # dx 符号与 dy 同一套「正数 = 向左/向上」约定（M669 标定）：表格初始在左端，要向右滚就得给负值。
    dx: -20
    dy: 0
    wheel: true
    settleMs: 900
    expect:
      # 通道自证：wheel: true 跳过 KimiCU、直接投 CGEvent 滚轮，证据里留一条自报行。
      # 本步骤一旦报错就是通道 / 前台问题，不是产品行为——README「已知边界」的滚动条。
      - label: 滚动后表格内容不丢（首列仍在 AX 树里）
        ax: { has: "TABLE-SCROLL-首列-甲" }
      - label: 滚动后末列仍在
        ax: { has: "TABLE-SCROLL-末列-甲" }
      - shot: 02-横向滚动后
---

# 这个场景验什么

M703 把 harness 对话表格改成「内容固有宽 + 表格自己的横滚容器」。chromium 结构矩阵
（`tests/visual/scenes/m703-harness-table-scroll.spec.ts`）已经钉住几何与声明层；本场景补真机
WKWebView 的两件事：

1. **内容终态**：mock 回复里的 4 列宽表在真机 AX 树里首末列齐全——渲染链没被新容器切断。
2. **滚动通道**：`do: scroll` + `wheel: true` 在表格区域投真实滚轮，执行不报错；滚动前后
   各一张截图，给 Alex 人眼判「表是否横向铺开、滚动是否真的发生」。

## 判据为什么这样分

- **机器判据（chromium 矩阵）**：wrapper 溢出 > 20px、表宽 = `scrollWidth`、每个 cell 单行
  （distinct line-top = 1）、transcript 无横溢、slot / 钮锚点、CSSOM 4px 细条声明。
- **本场景（真机）**：AX 不暴露几何 / 行数 / scrollTop，只判内容在场与通道执行；观感归 Alex。
  横向滚动的方向 / 距离也不做机验——截图是唯一判据。

## 已知边界

- 真机 AX 不提供 cell bbox 时，滚轮落点由目标节点的中心换算；若该节点无 bbox，本步骤会报
  「无法计算落点」——这是通道边界，不是产品缺陷。
- 首次注入若落在表格右半（横向已到末尾），滚轮可能无位移；截图前后对比即可分辨。
- 表格的自然宽随 WKWebView 字形宽度浮动（与 chromium 有 <3% 差异），因此本场景不写任何
  像素宽度断言。
