---
# M528：Alex 2026-10-16 dogfood 两条反馈的真机判据——
#   ① 「harness 里的 cli_run 的看不到命令是什么，只看到参数」：cli_run 的 arguments 是模型现写的
#      JSON，本 fixture 刻意把 `args` 排在 `command` 之前、整串 149 字（>工具行摘要的 80 字预算）
#      ——修前按原文截断，前 80 字里根本没有 `command`，工具行只剩一串参数。
#   ② 「harness 里没有正确渲染表格，第一行的第一列应该是一个空白格，但渲染出来的时候第一行少了它
#      （从原本的 3 列变成了 2 列）」：解析器对空单元格不产 cell 节点、只产相邻的两个分隔符，
#      修前按 cell 节点渲染就把空格吃掉、后续格子整体左移。
# 断言口径与覆盖边界见正文。首跑 2026-10-16（M535）：缺陷① 四条全 PASS；缺陷② 的 `AXCell` 计数
# 实测 0（面板表不产 AXCell）——断言形态错、非产品缺陷，已改为真机形态（AXRow 计数 + 行名锚定），
# 空槽列位的判据落到单测（见正文「覆盖边界」）。
id: "157-harness-toolsum-table-columns"
item: 157
tier: full
title: "harness transcript：cli_run 长参数行显示命令本体、空单元格不在表格里丢列（M528）"
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-toolsum-table.json"
    # cli 默认 ask：不放开就要停在批准闸上（本场景验的是工具行的摘要形态，不是闸）。
    permissions:
      allow: ["cli(*)"]
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位（发送钮是 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问并 Enter 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|toolsum" }
    text: "toolsum"
    expect:
      - label: 提问落在 composer 里（注入落地的正观测）
        ax: { has: "toolsum" }
  - name: 发送
    do: key
    key: enter

  - name: 等两轮都落定（末轮正文里带那张表）
    do: waitFor
    waitFor:
      has: ["下面这张表的表头第一格是空的"]
    timeoutMs: 30000

  - name: 缺陷①：cli_run 工具行以命令本体领读
    do: settle
    expect:
      - label: 命令本体在工具行上可见（修前这里是 `cli_run {"purpose":…`——80 字前缀里只有参数）
        ax: { has: '/cli_run\s*echo TSA-ALPHA/' }
      - label: 截断落在命令之后的参数上（命令完整、参数串按序在场）
        ax: { has: "TSA-ALPHA TSB-BRAVO TSC-CHARLIE TSD-DELTA" }
      - label: 摘要里的末段参数仍在场（截的是它之后的部分，不是把整条命令砍掉）
        ax: { has: "TSF-FOXTROT" }
      - label: 工具行不再回落到 arguments JSON 原文（修前的形态）
        ax: { not: '/cli_run\s*\{/' }
      - shot: 01-live-命令本体

  - name: 缺陷②：表格以表格行形态渲染、每行的格文本按列序上屏
    do: settle
    expect:
      - label: 表格以表格节点呈现（2 行：表头 + 表体——表未渲染时这条先红，计数断言不会空过）
        ax: { count: { pattern: "AXRow", exact: 2 } }
      - label: 表头行的格文本按列序拼接（本 fixture 表头首格空，行名只含两个非空格：乙、丙）
        ax: { has: '/AXRow\s+"乙\s*\/\s*丙"/' }
      - label: 表体行的格文本按列序拼接（空槽在中间：甲、丙——「格文本丢一个」或整行不上屏必红）
        ax: { has: '/AXRow\s+"甲\s*\/\s*丙"/' }
      - shot: 02-live-表格列数
---

# 157-harness-toolsum-table-columns —— M528 两条呈现面缺陷的真机判据

## 本场景在验什么

Alex 2026-10-16 dogfood 的两条反馈（原话见 front-matter 注释）：

1. 「harness 里的 cli_run 的看不到命令是什么，只看到参数」——工具行的参数摘要由 core 的
   `summarize_args` 产出。修前它把 arguments JSON **原文**截断 80 字：cli_run 的 arguments 是模型
   现写的，键序不定，`args` 排在 `command` 前时 80 字前缀里根本没有命令本体；前端拿到这半截 JSON
   解析失败、回落原文上屏，于是工具行只剩一串参数。修复 = core 先解析 JSON、用 `tools::cli_argv`
   （argv 取出的单一真源）拼成「命令 + 参数」文本，再对**拼接后的整串**截断——命令恒在最前。
2. 「harness 里没有正确渲染表格，第一行的第一列应该是一个空白格，但渲染出来的时候第一行少了它
   （从原本的 3 列变成了 2 列）」——lezer 的 GFM 对**空单元格不产 `TableCell` 节点**、只产相邻的
   两个 `TableDelimiter`；修前按 `TableCell` 子节点渲染，等于把空格从表格里抹掉、后续格子整体左移。
   修复 = 列位按分隔符序号判定、空位补空 cell，列数取 delimiter 行的列数。

## 断言口径（为什么有区分度）

- **缺陷①（有区分度）**：本 fixture 的 arguments 是
  `{"purpose":"…","args":[…],"command":"echo"}`，共 149 字——80 字前缀落在 `…"TSD-DELT`，
  里面**没有** `command`。修前前端回落原文，工具行文本是 `cli_run {"purpose":…`，故
  `/cli_run\s*echo TSA-ALPHA/` 不可命中；修后是 `cli_run echo TSA-ALPHA …`（拼接后 86 字，
  超 80 字截断在末尾，命令与前半段参数完整）。第三条断言钉「截的是尾不是头」——`TSF-FOXTROT`
  落在 80 字预算之内。第四条 `not /cli_run\s*\{/` 是修前形态的负断言（`{` 不含引号，不受 AX
  文本里内层引号渲染形态的影响）。
- **为什么不能复用场景 75**：75 的 cli_run 参数是
  `{"command":"echo","args":["HNE-ALLOWED"],"purpose":"回显一个验收标记"}`，只有 63 字、且
  `command` 在最前——修前修后都会渲染成 `echo HNE-ALLOWED`，拿它判这条缺陷的断言**恒真**。
- **缺陷②（结构层可判的部分）**：表格是 `| | 乙 | 丙 |` / `| --- | --- | --- |` / `| 甲 |  | 丙 |`
  ——表头首格空（Alex 现场）、表体中间格空。真机 AX 里这张表是 `AXTable` + 两个**叶子** `AXRow`
  （行名 = 该行非空格文本按列序拼接：`乙 / 丙` 与 `甲 / 丙`；零 `AXCell`，形态来历见「覆盖边界」），
  故这里判「表格以表格行形态渲染 + 每行的格文本按列序上屏」：`AXRow` 计数钉行数，两条行名断言钉
  每行确有那两个非空格（**格文本丢一个**或整行不上屏必红）。空槽列位本身在真机不可判，见边界节。
- **断言引擎口径**：`ax.count` 数的是 AX 文本里**命中该模式的行数**（`lib/execute.mjs`）；
  正则带 `m` flag，`\s` 可跨行。

## 覆盖边界（如实登记，别读成「已覆盖」）

- **空槽列位在真机 AX 里没有可观测量（M535 首跑坐实，如实登记）**：2026-10-16 的真机读数
  （`.local/acceptance/2026-10-16/157-harness-toolsum-table-columns/ax/03-02-live-表格列数.txt`）
  ——harness 面板这张表只产 `AXTable` + 2 个叶子 `AXRow`，**`AXCell` 计数 = 0**（面板渲染的 `<td>`
  不产 `AXCell`；编辑器预览表才产，见该条 dump 与 `03-table-ctrl-np` 等编辑器侧 dump）；行名又由
  **非空格**文本拼接而来，空槽不贡献片段 ⇒ 修前（空格被吃掉、后续格子左移）与修后（空槽占位）的
  AX 读数**逐字相同**。因此「列数守恒 / 空槽不塌列」这一判据**不在真机层**，它的机器判据是单测
  （`tests/unit/harness-transcript-render.test.ts`：首列 / 中列 / 末列空白、`||` 零宽空槽、短行补齐、
  th/td 归属，加属性化用例「列数 1..5 × 2^cols 种空槽位置」）与视觉基线。**本场景覆盖的是表格的
  结构在场与格文本**——不要把它的 PASS 读成「空槽列位已在真机验过」。
- **首跑（2026-10-16）的形态教训**：M528 起草时把 `AXCell` 计数当判据（假设 `<tbody>` 的 `<td>`
  各产一个 `AXCell`、`<th>` 不产），真机实读 0 个 ⇒ 那是**断言形态错**、不是产品缺陷。换断言时
  可用的形态口径：`AXRow` 的行名可锚（`/AXRow\s+"…"/`），空槽与列位**不可**锚。
- **不判像素**：表格三列是否**画对**（列宽、边框、对齐）归视觉门禁与 Alex 手感，本场景只判结构层
  的行数与格文本。同理工具行摘要的省略号落点（`.lumir-hp-tool-text` 的 `nowrap + ellipsis`）是
  视觉层，不在本场景。
- **恢复路径不在本场景**：摘要的成品文本在恢复重建路径还有一个消费点（`appendRestoredToolRow`
  的「已采纳」分支）。它需要进过批准闸的 cli_run + 一次会话恢复，与场景 75/71/96 的现场重叠，
  留给后续批次；判据目前只有 `tests/unit/harness-restore.test.ts` 的 `toolArgsText`（纯函数层，
  不含 DOM 接线）。

## 环境与副作用

- 合成 fixture（`harness-mock-toolsum-table.json`，标记串 `TSA-ALPHA` / `TSB-BRAVO` …）与隔离
  `XDG_CONFIG_HOME`；端口走 `LUMIR_ACCEPTANCE_PORT`（缺省 1430），1420 全程不碰。
- 本场景**真跑一次 `echo`**（8 个参数）：纯回显、不写盘、不改 vault——`permissions.allow: ["cli(*)"]`
  只为把它从批准闸上放行（cli 默认档是 ask）。
- 不写 vault：`harness-note.md` 只被打开、不被改。
