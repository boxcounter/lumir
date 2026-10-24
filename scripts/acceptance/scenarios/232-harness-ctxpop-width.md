---
# 浮层宽度合同（M702，change overlay-width-contract-oct24）的真机判据之二：harness Context
# 气泡在 WKWebView 下按内容宽度展开（P 档：内容固有宽 + 34em 上限 + 224px 组件下限），
# 长读数不再被 224px 定值逼成两行。
#
# 为什么这条只能在真机层：气泡宽度由「真机字形宽度 + --lumir-hp-scale」共同决定，而
# chromium 与 WKWebView 的字形宽度有 <3% 差异（M698 §8）。这里用较长的真实读数
# （118k / 131k tokens（90%））当输入——旧形态 224px 下这个句子必折 2 行（M698 §3.2 的
# 同族读数），新形态下气泡长到内容宽（≈ 237px）。
#
# 判据的落点说明：气泡没有自己的 AX 名字，geom 取气泡里的文本节点（`any` 匹配读数句）。
# 真机上若文本节点的 bbox 报的是「换行后的盒宽」而不是未换行的整行宽，本条对旧形态同样会
# 红（旧盒 224 < 232）——两个读法下 minWidth 232 都有区分度。
#
# 不覆盖：字号 2.13 档的气泡宽度（真机步进 ⌘= 八次可复现，但本场景只判基线档；
# 2.13 档的几何判据在 chromium 结构矩阵里，真机手感归 Alex）。
id: "232-harness-ctxpop-width"
item: 702
title: Context 气泡宽度：长读数按内容展开（26em 时代的 224px 定值不再折行）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-ctx-warn.json"
    # 本场景只验气泡宽度，不让 90% 越线触发自动压缩（同场景 87 的口径）。
    autoCompact: false
steps:
  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现
        ax: { has: "分隔条" }
      - label: 控制行在位（发送钮）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问并发送（mock fixture 返回 usage 118000/131072 ≈ 90%）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|over" }
    text: "over"
  - name: 发送
    do: key
    key: enter

  - name: 等回答到达
    do: waitFor
    waitFor:
      has: ["用量越线回答。"]
    timeoutMs: 15000
    expect:
      - label: 控制行读数 = ctx 90% · cache 50%
        ax: { has: "90% · 50%" }
      - label: 警示句默认不在界面上（hover 才翻出）
        ax: { not: "越过 85% 警示线" }

  - name: hover 读数——气泡翻出
    do: hover
    target: { anchor: { role: AXPopUpButton, any: "/权限模式/" }, offsetX: 24 }
    expect:
      - label: 第一行读数句在场（M526 / M532 的 tokens 形态）
        ax: { has: "/上下文：已用\\s*118k\\s*\\/\\s*131k\\s*tokens（90%）/" }
      - label: 越线警示句在气泡里
        ax: { has: "/越过\\s*85%\\s*警示线——下一轮对话将自动压缩/" }

  - name: 气泡内容现场
    do: settle
    expect:
      - label: 三行内容齐全且连续（usage → 会话命中率 → 越线警示；行集与 D463/D465/D335 一致）
        ax: { has: "/上下文：已用[\\s\\S]*缓存命中率（会话）：[\\s\\S]*越过\\s*85%\\s*警示线/" }
      - label: 气泡确实被绘制（O1 的绘制段：包围盒区域内扫描到字形亮度跨度；气泡在读数上方、压着 transcript 空白带）
        pixel:
          contrast:
            - { x: 900, y: 689, as: "气泡内警示句字形", min: 60 }
      - shot: 01-长读数气泡

  - name: 移开读数——气泡收起
    do: hover
    target: { role: AXButton, name: "^发送$" }
    expect:
      - label: 读数仍在屏上（正观测）
        ax: { has: "90% · 50%" }
      - label: 气泡随 mouseleave 收起（三段内容同时离场）
        ax: { not: "越过 85% 警示线" }
---

spec 判据（ui-design-system「浮层宽度分档与可读宽度注册表」）：Context 气泡属 P 说明折行档，
宽度 SHALL 取内容固有宽并钳到 `[224px, min(34em, pane 可用宽)]`；上限 MUST 用 em（随
`--lumir-hp-scale` 缩放），MUST NOT 用与内容无关的定值同时承载「短内容不空旷」与
「放大档不折行」。窄 pane 下 SHALL 先收窄、再换边、最后才平移，包围盒 MUST 完整落在 pane 内。

M698 实测（§3.2）：旧形态「定宽 224px + 只缩不放」下，越线警示句 234px 必折 2 行、
2.13 档首行 482px 折 3 行。本场景的长读数（118k/131k）在旧形态下折成 5 行、新形态 3 行。

**覆盖边界（如实登记）**：气泡的**宽度与行数**在真机层不可直接量——WKWebView 的 AX 只给
按钮 / 文本域 / 列表 / 分隔条这类节点 bbox，浮层组与 static text 都没有 bbox（本场景第一次
运行的 AX dump 实证：`AXGroup` 与 `AXStaticText` 均无几何；首跑还踩到「pixel 复用 mode=ax
快照、没有截图」的通道缺口，已按 geom 段的同一纪律修掉）。因此真机层守「hover 翻出、
三段内容齐全、确实绘制、mouseleave 收起」四条；**宽度数字**由
`tests/visual/scenes/m702-overlay-width.spec.ts` 的 chromium 结构矩阵（1× / 2.13× / 窄 pane /
resize 重夹）与 `tests/unit/overlay-placement.test.ts` 的纯几何判。
