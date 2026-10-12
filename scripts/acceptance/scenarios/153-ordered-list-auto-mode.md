---
id: "153-ordered-list-auto-mode"
item: 153
title: 列表自动模式三态（M461）——「1. + 空格」进入列表编辑、Enter 续行、空项 Enter 退出；IME 组合期不重复的英文路径对照
fixtures: [ordered-list-auto.md]
open: ordered-list-auto.md
marker: "列表自动模式探针"
steps:
  # ── 用例 1（进入 + 续行）：段落后新行输入「1. alpha」→ Enter 必须续出「2. 」
  - name: 打开 fixture，光标移到段落行尾并回车造新行
    do: clickEditor
    expect:
      - label: 打开成功
        editor: { has: "列表自动模式探针" }
      - shot: 起点-纯段落无列表
  - name: 行尾回车，输入「1. alpha」（英文路径直输）
    do: keys
    keys: ["ctrl+e", "return"]
  - name: 输入 marker 与内容（type 动作带次数回读：「1. alpha」恰出现一次 = 无重复插入）
    do: type
    text: "1. alpha"
    expect:
      - label: 渲染态：光标在裸行上，「1. alpha」行进入列表编辑态（截图证据；AX 的 AXTextArea.value 是渲染后文本）
        editor: { has: "1. alpha" }
      - shot: 进入态-1.-行应显示为列表项
  - name: Enter 续行（有内容 → 续下一序号）
    do: key
    key: "return"
  - name: 落盘
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对续行
    do: sleep
    ms: 1200
    expect:
      - label: 续行成立：「2. 」被自动写出（旧行为下 Enter 只是裸换行，「2. 」必不出现）
        file: { path: ordered-list-auto.md, has: '/1\. alpha\n2\. /' }
      - label: 无重复 marker（组合期缺陷的英文路径对照：同一行只出现一次「1. 」）
        file: { path: ordered-list-auto.md, not: '/1\. 1\. /' }
      - shot: 续行态-2.行在场

  # ── 用例 2（退出）：空项「2. 」上 Enter = 删标记留空行、不新增行
  - name: 光标在「2. 」行（续行后光标即在其 marker 之后），直接 Enter
    do: key
    key: "return"
  - name: 落盘
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对退出
    do: sleep
    ms: 1200
    expect:
      - label: 空项 marker 被删去（「2. 」不再出现；列表变松 / 保留 marker 的旧分支都会红）
        file: { path: ordered-list-auto.md, not: '/\n2\. /' }
      - label: 行保留为结尾空行、不新增行（「1. alpha」行即文档内容行尾）
        file: { path: ordered-list-auto.md, has: '/1\. alpha\n$/' }
      - shot: 退出态-空行保留且光标在其上

  # ── 用例 3（单步撤销）：一次撤销回到退出前
  - name: 撤销退出那一步
    do: key
    key: "cmd+z"
  - name: 落盘
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对
    do: sleep
    ms: 1200
    expect:
      - label: 「2. 」回来（一次 Enter 退出 = 一次撤销步；若退出是两步事务，一次撤销回不到带 marker 的形态）
        file: { path: ordered-list-auto.md, has: '/1\. alpha\n2\. /' }
      - shot: 撤销后-marker回来
---

# 153 · 列表自动模式三态（M461）

Alex 2026-10-12 dogfood：「当我输入『1. 』（注意：有空格）……时，没有自动进入列表编辑
模式，这不符合预期。」根因：空列表项按 CommonMark 不能打断段落，`para\n1. ` 的行是
lazy continuation，树驱动的渲染与续行都不认它。本 change 按文本模式特判进入列表
编辑态（渲染证据看截图，行为终态用落盘文件钉死）。

- **进入态**的判据由用例 1 的续行结果间接钉死：只有「1. 」行被认作列表项，
  Enter 才会续出「2. 」（旧行为是裸换行）。渲染观感（marker widget、悬挂缩进）归
  截图证据与 Alex 手感，与套件「不做手感判定」分工一致。
- **IME 组合期不重复**（Alex 报告的第二缺陷：中文输入法输入字符时多出「1. 」）的
  判据：修复落在 DOM 入口拒收 WebKit 原生自动列表（insertOrderedList 族
  beforeinput），英文路径直输照绿（本场景的「恰出现一次」断言）+ chromium 视觉层
  有派发事件的接线断言。真机组合态无法用合成键盘复现（合成事件不进 TSM，
  探针证据 test-results/m461-probe/readings.md），**真 IME 复验留 dogfood**——若
  Alex 的中文输入法仍复现重复，按「裸 DOM 变更路径」另立项（本拦截不兜该形态，
  已登记为已知边界）。
