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
  # M461（ebc259e）起这一行按文本模式进入列表编辑态、marker 被 widget 替换：AXTextArea.value 把
  # 「1. 」（marker + 空格）序列化成 "1.\n"（不是字面 "1. "），于是**任何按出现次数回读的注入通道**
  # （do: type 的可打印回读 / 可打印 do: keys）都会把「其实已完整落地」误判成 partial 并判红
  # （2026-10-13 实测：目标串「1. alpha」出现 0 次）。因此把一次注入拆成三步，让每步的回读串都在
  # 序列化后的 value 里字面在场：marker 无尾空格时不触发列表特判（src/preview/lists.ts:96 的
  # BARE_MARKER_RE 要求 marker 后有空白），"1." 可走 type 的次数回读；触发 widget 的那个空格只能
  # 单发盲键（do: key 不做回读）；内容 "alpha" 仍字面在场，可走 type。断言放宽为 /1\.\s*alpha/。
  # 空格那一键若丢（盲发通道无回读）则 widget 不触发、「1. alpha」不成列表项——下游断言如实红，
  # 不为它配重试（重试会把空格重复插入，反而制造「1.  alpha」这类脏文本）。
  # 失效条件：widget 的 AX 序列化形态变化（例如不再插换行）时，这三步可还原成单步 do: type。
  - name: 输入 marker「1.」（无尾空格 ⇒ 不进列表态 ⇒ AXTextArea.value 字面保留 "1."，type 的次数回读可校验）
    do: type
    text: "1."
  - name: 补触发列表的尾空格（单发盲键：空格一落整行成裸 marker 行、marker 被 widget 替换，value 不再含字面「1. 」）
    do: key
    key: " "
  - name: 输入内容「alpha」（此时内容字面在场，type 的次数回读可校验）
    do: type
    text: "alpha"
    expect:
      - label: 渲染态：光标在裸行上，「1. alpha」行进入列表编辑态（M461 起 AXTextArea.value 把 marker 序列化成 widget 文本，故按 /1\.\s*alpha/ 判）
        editor: { has: '/1\.\s*alpha/' }
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
- **注入通道为什么拆成三步**（M461 后本场景的标定过期点，2026-10-14 重取）：M461 起「1. 」行在光标
  驻留时按列表项渲染、marker 被 widget 替换，AXTextArea.value 把它序列化成 `1.\n`（不是字面 `1. `）。
  于是**任何按出现次数回读的注入通道**（`do: type` 的可打印回读 / 可打印 `do: keys`）都会把「其实已
  完整落地」误判成 partial 并判红——2026-10-13 首跑就是这样红的（`目标串「1. alpha」出现 0 次`，而
  同一次 dump 里 DOM 静态文本 `1. alpha`、落盘文件都正确）。处置：拆成「`do: type "1."`（无尾空格时
  不触发列表特判 ⇒ 字面在场）→ `do: key " "`（触发 widget 的那个空格只能单发盲键，`do: key` 不做
  回读）→ `do: type "alpha"`」三步，断言放宽为 `/1\.\s*alpha/`。**失效条件**：widget 的 AX 序列化
  形态变化（例如不再插换行）时，可还原成单步 `do: type text: "1. alpha"` + 字面断言。
