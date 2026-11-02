---
# change add-path-line-target-highlight-nov02 的真机判据（承接 add-path-line-range-links 的 221）：
# harness 输出里的带行号路径家族——`{path}:{行}`、`{path}:{起}-{止}`——整段是一个可点元素，
# 点击在**新标签**打开并落到起始行；点击后目标行 / 行范围获得一次瞬态行高亮（~1.4s 后退），
# 畸形范围（`止 < 起`）只链接路径本身、后缀留作普通文本（不吞半截）。
#
# 落点位置、选区与高亮底色都由截图人工判读：AXTextArea.value 是整个文档文本、AX 读不到选区，
# 也读不到装饰类名（与场景 161 / CL-1 / CL-2 同一已知边界，「覆盖边界」一节如实登记）。
# 复用 fixtures/goto-line-long.md 作目标文件（不新增 .md fixture：验收 vault 每次重置为
# fixtures 里**全部** .md 的副本，为一条判据给所有场景加一个文件不划算）；第 39 行 =
# `JUMP-TARGET-39`、第 48 行 = `LAST-LINE-MARKER`，在 48 行文档里开篇一屏看不到、落点后居中
# ——截图据此可判读。
id: "221-harness-path-line-range"
item: 552
tier: full
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

  - name: 行范围 / 单行 / 畸形形态的可点性
    do: settle
    expect:
      - label: 行范围整段是一个可点元素（AXButton，名字 = 原文含 :39-48）
        ax: { has: '/AXButton \(goto-line-long\.md:39-48\)/' }
      - label: 单行形态整段是一个可点元素（名字 = 原文含 :39）
        ax: { has: '/AXButton \(goto-line-long\.md:39\)/' }
      - label: 畸形范围只链接路径本身（名字里没有后缀）
        ax: { has: '/AXButton \(goto-line-long\.md\)/' }
      - label: 畸形后缀不出现在任何可点元素的名字里（反向判据：可点范围没吞半截）
        ax: { not: '/AXButton \(goto-line-long\.md:48-39\)/' }
      - shot: 01-行范围可点性

  - name: 点行范围链接（新标签打开目标文件；本步只立结构，不抢高亮截图）
    do: click
    target: { role: AXButton, name: "^goto-line-long\\.md:39-48$" }

  - name: 等目标文件装载（编辑器出现第 39 行原文）
    do: waitFor
    waitFor:
      has: ["JUMP-TARGET-39"]
    timeoutMs: 15000
    expect:
      - label: '目标文件在**新标签**里且成为前台（AXRadioButton 的 Value: true）'
        ax: { has: '/AXRadioButton \(goto-line-long\.md\) Value: true/' }
      - label: 原标签仍在（新标签意图，不是替换当前标签）
        ax: { has: '/AXRadioButton \(harness-note\.md\)/' }
      - label: 目标文件正文已装载（编辑器文本里出现第 39 行原文）
        editor: { has: "JUMP-TARGET-39" }

  - name: 点单行链接（文件已打开 → 切到既有标签并高亮第 39 行）；截图紧跟点击、不 settle
    do: click
    target: { role: AXButton, name: "^goto-line-long\\.md:39$" }
    expect:
      - shot: 02-单行高亮（点击后 ~0.6s 内拍摄；1.4s 瞬态窗口内，第 39 行整行应带底色）

  - name: 单行落点复核（截图之后再做 AX / 文本断言）
    do: waitFor
    waitFor:
      has: ["JUMP-TARGET-39"]
    timeoutMs: 15000
    expect:
      - label: 同一文件只切标签（目标文件仍是前台，不重复开）
        ax: { has: '/AXRadioButton \(goto-line-long\.md\) Value: true/' }
      - label: 目标行文本在场
        editor: { has: "JUMP-TARGET-39" }

  - name: 点行范围链接（同一文件已打开 → 切到既有标签并高亮 39–48）；截图紧跟点击、不 settle
    do: click
    target: { role: AXButton, name: "^goto-line-long\\.md:39-48$" }
    expect:
      - shot: 03-行范围高亮（点击后 ~0.6s 内拍摄；39–48 行整段应带底色）

  - name: 行范围落点复核（截图之后再做断言）
    do: waitFor
    waitFor:
      has: ["LAST-LINE-MARKER"]
    timeoutMs: 15000
    expect:
      - label: 同一文件只切标签（仍是同一标签）
        ax: { has: '/AXRadioButton \(goto-line-long\.md\) Value: true/' }
      - label: 目标文件正文仍完整（行范围末行在场）
        editor: { has: "LAST-LINE-MARKER" }

  - name: 等高亮消退（~1.4s 的瞬态；有界观察窗）
    do: sleep
    ms: 2400

  - name: 消退现场
    do: settle
    expect:
      - shot: 04-高亮消退（39–48 行不再带底色；由截图判读）
      - label: 消退后正文不变（高亮只是装饰，不动文档）
        editor: { has: "JUMP-TARGET-39" }
---

# 221-harness-path-line-range —— 带行号路径可点击 + 点击后瞬态行高亮

## 本场景在验什么

- Alex 2026-10-23 的需求（逐字）：「支持 harness 输出里的 {path}:{line-start}-{line-end} 可点击
  （现在已经支持 {path}:{line}:{column}）」——已由 `add-path-line-range-links` 落地。
- Alex 2026-11-02 的需求（逐字）：「点击 {path}:{line} 家族（包括：{line}:{column} 和
  {line-start}-{line-end}），自动高亮那一行或那个范围。」——本 change 落地，本场景承接验证。

mock provider 把三种形态一次铺开：

1. **合法行范围** `goto-line-long.md:39-48` → 整段一个可点元素；首次点击在新标签打开、落到第 39 行
   （居中，结构断言）；文件已打开后再次点击只切标签并给 39–48 行（闭区间）一次瞬态高亮。
2. **单行** `goto-line-long.md:39` → 文件已打开时点击只切标签、落到第 39 行，该行整行获得一次
   瞬态高亮（~1.4s 后退）。
3. **畸形范围** `goto-line-long.md:48-39`（`止 < 起`）→ 只链接路径本身，`:48-39` 留作普通文本
   ——失败模式不是「不可点」而是「吞半截」，判据落在「可点元素的名字里没有这个后缀」上。

## 判据为什么这样写

- **整段可点用 `AXButton \(…\)`**：路径链接元素是 `<button type="button">`，AX 里是名字 = 原文的
  AXButton（与场景 161 同口径）。若实现把「路径」与「行号后缀」拆成两个节点，`has` 会落空——
  它同时钉住了「一个元素、不改写正文」。
- **畸形形态用 `ax: { not: … }` 作反向判据**：只否定 `AXButton (名字含后缀)` 这一形态，避免把
  正文里作为普通文本出现的同一串误判。正向那半用「路径本身可点」作对照，防「整条都没渲染」的假绿。
- **高亮与消退落在截图上，且截图必须抢在 1.4s 窗口内**：AX 读不到装饰类名与计算样式；`02` / `03` /
  `04` 三张截图是同一条链路的三拍（单行、行范围、消退后）。**时序是本场景的一条判据**：执行器
  `settle` 至少等一个 700ms 采样间隔，`shot` 拍摄前又固定 `sleep(600)` 并另做一次 full AX 读——
  「先 settle 再 shot」的固定等待已约 1300ms，正确实现也极易在拍摄前消退（M823 r1 P1 现场）。
  因此 `02` / `03` 的截图**直接挂在点击步的 expect 上**（点击前文件已由行范围链接打开，切换 + 高亮
  是快路径），结构断言放到截图之后的独立步骤；`04` 用一段有界观察窗（`sleep 2400`，README 允许的
  两类 sleep 口径之一）证明消退，随后只复核正文未被改动。

## 覆盖边界（如实登记）

- **滚动位置与高亮底色没有机器判据**：`AXTextArea.value` 是整个文档文本，AX 读不到 `scrollTop`、
  选区与装饰类名（CL-1 / CL-2 的同一已知边界）；是否居中、是否带底色由截图人工判读。
- **`02` / `03` 的「高亮在场」只有截图证据，且依赖拍摄落在 1.4s 窗口内**：这是本场景唯一靠时序
  保证的判据——截图直接挂在点击步、不做前置 `settle`（理由见上节）。若机器负载导致拍摄仍然错过
  窗口，图上不会有底色（人工判读看到一次假阴性）：先核步骤耗时与现场负载，不当作产品缺陷。
  `04` 只证明「拍摄时已无底色」，不能单独证明 `02` / `03` 拍到过。
- **「不选中 / 正文不变」的机器判据在视觉层**：
  `tests/visual/scenes/m632-path-line-range-link.spec.ts` 在真 CM view 上断言
  `selection.main.empty === true`、正文逐字节不变、`.cm-line-highlight` 的行集合与三主题计算底色；
  单测覆盖装饰集的越界钳制、2000 行上限与替换语义。
- **`止` 越界不报错**（钳到末行）与 `:12 - 40` 带空白形态由单测覆盖，不在真机造现场。
- **「重复点击重置消退计时」在真机层不可判**（需要毫秒级读数），由视觉场景的计时用例承担。
- **prompt 遵从度**（路径引用纪律里 `:起-止` 那一句）是抽样观察，不进机器断言——mock provider
  代表不了真实模型的书写习惯。
- **样例全合成**：文件名与正文标记都是验收用的合成串，不含真实 vault 内容。
