---
# M528：Alex 2026-10-16 dogfood 两条反馈的真机判据——
#   ① 「harness 里的 cli_run 的看不到命令是什么，只看到参数」：cli_run 的 arguments 是模型现写的
#      JSON，本 fixture 刻意把 `args` 排在 `command` 之前、整串 149 字（>工具行摘要的 80 字预算）
#      ——修前按原文截断，前 80 字里根本没有 `command`，工具行只剩一串参数。
#   ② 「harness 里没有正确渲染表格，第一行的第一列应该是一个空白格，但渲染出来的时候第一行少了它
#      （从原本的 3 列变成了 2 列）」：解析器对空单元格不产 cell 节点、只产相邻的两个分隔符，
#      修前按 cell 节点渲染就把空格吃掉、后续格子整体左移。
# 断言口径与覆盖边界见正文（本场景**未真机跑过**，读数待首跑证实）。
id: "157-harness-toolsum-table-columns"
item: 157
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

  - name: 缺陷②：表格空单元格不丢列（列数守恒）
    do: settle
    expect:
      - label: 表格以表格节点呈现（2 行：表头 + 表体——表未渲染时这条先红，计数断言不会空过）
        ax: { count: { pattern: "AXRow", exact: 2 } }
      - label: 表体行是 3 格（3 个 `<td>` = 3 个 AXCell；修前空单元格不产 cell 节点，只剩 2 个）
        ax: { count: { pattern: "AXCell", exact: 3 } }
      - label: 表头行的格文本上屏（乙只出现在表头）
        ax: { has: "乙" }
      - label: 表体行的首列与末列格文本都上屏（列位没被空格吃掉后左移）
        ax: { has: "甲" }
      - label: 表体行末列格文本上屏
        ax: { has: "丙" }
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
- **缺陷②（有区分度，但依赖 AX 的一个形态假设，见下）**：表格是
  `| | 乙 | 丙 |` / `| --- | --- | --- |` / `| 甲 |  | 丙 |`——表头首格空（Alex 现场）、
  表体中间格空。`AXCell` 计数在修后是 3（表体行的 3 个 `<td>`），修前是 2（空格那格不产节点）。
- **断言引擎口径**：`ax.count` 数的是 AX 文本里**命中该模式的行数**（`lib/execute.mjs`）；
  正则带 `m` flag，`\s` 可跨行。

## 覆盖边界（如实登记，别读成「已覆盖」）

- **本场景未真机跑**（M528 期间真机验收暂停中——在场有安装版 Lumir 实例，套件预检按纪律拒跑、
  退出码 2）。这里只做到 `node scripts/acceptance/run.mjs --check` 静态校验通过。首次真机跑若
  报错，按下面两条先分辨「断言形态」还是「产品缺陷」，不要直接当回归。
- **`AXCell` / `AXRow` 计数依赖一组未在真机证实过的形态假设**：判据来自 `test-results/acceptance/
  2026-10-14-full/152-harness-transcript-link-and-time/ax/01-01-live-链接上屏.txt` 里 harness 面板内
  **唯一**一张表的 dump——`<tbody>` 的 `<td>` 各产一个 `AXCell`，`<thead>` 的 `<th>` 不产 `AXCell`
  （表头行的读屏名是拼接后的名字，没有子节点）；一个 `<tr>` 产一个 `AXRow`，且面板其余部分（文件
  树、composer、消息正文）不产 `AXRow`（同一批 harness dump 里 `AXRow` 只出现在 152 那张表上）。
  两条未证实的推论各自的后果：① 若**空** `<td>` 不产 `AXCell`，`exact: 3` 在修后也会红（假 FAIL，
  属断言形态问题）；② 若 `<th>` 也产 `AXCell`，修后是 6、修前是 4，`exact: 3` 恒红（同样是形态
  问题）。首跑读数落定后按实际形态改这两条。**反过来说**：`min` 类写法在 ② 的情况下会变成「修前
  也绿」的恒真断言，故这里取 `exact`。
- **表头那一格空槽在 AX 里不可观测**：`<th>` 不产 `AXCell`、空槽又不产文本，因此「表头首列空白
  不塌列」这一侧**没有真机判据**。它的机器判据在单测
  （`tests/unit/harness-transcript-render.test.ts` 的「首列空白」与属性化用例，任意列数 × 任意
  空槽位置）与视觉基线上；本场景只覆盖表体侧的空槽列数。
- **不判像素**：表格三列是否**画对**（列宽、边框、对齐）归视觉门禁与 Alex 手感，本场景只判结构层
  的格数与文本。同理工具行摘要的省略号落点（`.lumir-hp-tool-text` 的 `nowrap + ellipsis`）是
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
