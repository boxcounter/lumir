---
# change add-path-line-range-links 的真机判据：harness 输出里的 `{path}:{起}-{止}` 与既有的
# `{path}:{行}:{列}` 同链路——整段（含后缀）是一个可点元素，点击在**新标签**打开并落到起始行；
# 畸形范围（`止 < 起`）只链接路径本身、后缀留作普通文本（不吞半截）。
#
# 落点位置与「有没有出现选区」由截图人工判读：AXTextArea.value 是整个文档文本、AX 读不到选区
#（与场景 161 / CL-1 / CL-2 同一已知边界，「覆盖边界」一节如实登记）。
# 复用 fixtures/goto-line-long.md 作目标文件（不新增 .md fixture：验收 vault 每次重置为
# fixtures 里**全部** .md 的副本，为一条判据给所有场景加一个文件不划算）；第 39 行 =
# `JUMP-TARGET-39`，在 48 行文档里开篇一屏看不到、落点后居中——截图据此可判读。
id: "221-harness-path-line-range"
item: 552
title: harness 输出里的行范围路径可点击（:起-止 落到起始行，畸形形态不吞半截）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-path-line-range.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 面板以旁侧 pane 出现（发送钮在场是 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 点 composer 聚焦并输入提问
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 输入提问
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|rlmark" }
    text: "rlmark"
    expect:
      - label: 提问落进 composer（注入落地的正观测）
        ax: { has: "rlmark" }
  - name: 发送
    do: key
    key: enter

  - name: 等 mock 回答渲染完
    do: waitFor
    waitFor:
      has: ["行范围链接验收"]
    timeoutMs: 30000

  - name: 行范围与畸形形态的可点性
    do: settle
    expect:
      - label: 行范围整段是一个可点元素（AXButton，名字 = 原文含 :39-48）
        ax: { has: '/AXButton \(goto-line-long\.md:39-48\)/' }
      - label: 畸形范围只链接路径本身（名字里没有后缀）
        ax: { has: '/AXButton \(goto-line-long\.md\)/' }
      - label: 畸形后缀不出现在任何可点元素的名字里（反向判据：可点范围没吞半截）
        ax: { not: '/AXButton \(goto-line-long\.md:48-39\)/' }
      - shot: 01-行范围可点性

  - name: 点行范围链接
    do: click
    target: { role: AXButton, name: "^goto-line-long\\.md:39-48$" }

  - name: 等目标文件装载（编辑器出现第 39 行原文）
    do: waitFor
    waitFor:
      has: ["JUMP-TARGET-39"]
    timeoutMs: 15000

  - name: 落点现场
    do: settle
    expect:
      - label: '目标文件在**新标签**里且成为前台（AXRadioButton 的 Value: true）'
        ax: { has: '/AXRadioButton \(goto-line-long\.md\) Value: true/' }
      - label: 原标签仍在（新标签意图，不是替换当前标签）
        ax: { has: '/AXRadioButton \(harness-note\.md\)/' }
      - label: 目标文件正文已装载（编辑器文本里出现第 39 行原文）
        editor: { has: "JUMP-TARGET-39" }
      - shot: 02-行范围落点（第 39 行居中；选区是否出现由截图判读）
---

# 221-harness-path-line-range —— 输出里的行范围路径可点击（change add-path-line-range-links）

## 本场景在验什么

Alex 2026-10-23 的需求（逐字）：「支持 harness 输出里的 {path}:{line-start}-{line-end} 可点击
（现在已经支持 {path}:{line}:{column}）」。本场景用 mock provider 把两种形态一次铺开：

1. **合法行范围**：`goto-line-long.md:39-48` → 整段（含后缀）是一个可点元素，点击在新标签打开
   并落到**起始行**第 39 行（居中）；行范围不选中、不高亮。
2. **畸形范围**：`goto-line-long.md:48-39`（`止 < 起`）→ 只链接路径本身，`:48-39` 留作普通文本
   ——这个形态的失败模式不是「不可点」，而是「吞半截」，所以判据落在「可点元素的名字里没有
   这个后缀」上。

## 判据为什么这样写

- **整段可点用 `AXButton \(…:39-48\)`**：路径链接元素是 `<button type="button">`，AX 里是
  名字 = 原文的 AXButton（与场景 161 同口径）。若实现把「路径」与「行号后缀」拆成两个节点，
  这条 `has` 会落空——它同时钉住了「一个元素、不改写正文」。
- **畸形形态用 `ax: { not: … }` 作反向判据**：只否定 `AXButton (名字含后缀)` 这一形态，避免把
  正文里作为普通文本出现的同一串误判。正向那半用「路径本身可点」作对照，防「整条都没渲染」的假绿。
- **落点只剩两个机器判据**：文件被打开、落点行传给了 revealLine（后者在
  `tests/unit/harness-path-link.test.ts` 的跳转编排用例里）。实际滚动位置与「有没有选区」读不到。

## 覆盖边界（如实登记）

- **滚动位置没有机器判据**：`AXTextArea.value` 是整个文档文本，套件没有 `scrollTop` 读数
  （CL-1 / CL-2 的同一已知边界）；第 39 行是否居中由 `02-行范围落点` 截图人工判读。
- **「不选中」在本层不可判**：AX 读不到选区（README「已知边界」的「光标/选区不可断言」条）。
  机器判据落在 `tests/visual/scenes/m632-path-line-range-link.spec.ts`（真 CM view 上
  `selection.main.empty === true` 且正文逐字节不变）与单测（候选不携带止、编排只收到起始行）。
- **`止` 越界不报错**（按起始行落点）与 `:12 - 40` 带空白形态由单测覆盖，不在真机造现场。
- **prompt 遵从度**（路径引用纪律里 `:起-止` 那一句）是抽样观察，不进机器断言——mock provider
  代表不了真实模型的书写习惯。
- **样例全合成**：文件名与正文标记都是验收用的合成串，不含真实 vault 内容。
