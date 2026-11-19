---
# M854：非空选区删除 = 源码精确删除。M842 发现选区端点落在渲染隐藏区（表格管道 / 分隔行、
# 列表 marker）时，Backspace / Delete 走原生路径、CM 的 DOMReader 按渲染结果回写源码，
# ⌘S 把损坏结果落盘（finding 20261119-worker-markdown-stability-bug-dom）。
#
# 真机 witness（完整矩阵在 tests/visual/scenes/markdown-editing-stability.spec.ts，
# chromium + webkit 两引擎逐字节判）：本场景只取一条代表格，判真实 WKWebView 的入口与落盘。
# 文档在场景内用 vaultWrite 改写成 M842 的最小现场（`| a | b | / | --- | --- | / | c | d |`）：
# M854 双引擎探针证明该形态在 WebKit 上删除单字符 cell 会丢空格（`[26,27)` 原生得 `|| d |`，
# 正确是 `|  | d |`），chromium 同操作正确——这是本场景在真机上的区分度来源。
#
# 为什么不用键盘选区：⌃A → → ↓ ⇧→ 在 Playwright 两引擎能造出 `[26,27)`，但真机 WKWebView
# 的 caret 几何使 ↓/⇧↓ 落点与 Playwright 不同（实测落到 cell 后的空格，删除的是空格而不是
# 字符，M854 真机首跑 FAIL 现场）；改用真实鼠标双击 cell 的单字符（word selection），落点
# 由截图一次标定即可重复。
id: "266-selection-delete-widgets"
item: 266
tier: full
title: 非空选区删除 = 源码精确删除——表格单字符 cell 选区、精确落盘、一次撤销（M854）
fixtures: [table-fullscreen.md]
open: table-fullscreen.md
marker: "表格全屏场景"
steps:
  # ---------------------------------------------------------------------------
  # 准备：把已打开的 fixture 改写成 M842 的最小现场，重启后从磁盘重载。
  # ---------------------------------------------------------------------------
  - name: 改写成最小表格现场（vaultWrite 从外部写，随后 restart 重载）
    do: vaultWrite
    file: table-fullscreen.md
    content: "| a | b |\n| --- | --- |\n| c | d |\n"

  - name: 重启并等文档重载
    do: restart
    expect:
      - label: 重启未留下 dirty 守卫（文档由外部写入，无未保存修改）
        ax: { not: "（未保存）" }

  - name: 起点：文档已重载、焦点在编辑器正文
    do: focusWindow
    retries: 4
    click: true
    expect:
      - label: 数据行 cell 文本在场（本轮 AX 读取是活的）
        editor: { has: "c" }
      - label: 表格以 grid 渲染（AX 里没有字面管道行）
        editor: { not: "| a | b |" }
      - label: 焦点在编辑器正文
        ax: { focused: "AXTextArea" }

  - name: 记录文档基线（删除之外的任何写盘都算红）
    do: record
    file: table-fullscreen.md
    as: 文档基线

  - name: 截取表格现场（校准 double-click 落点用；证据目录 shots/）
    do: settle
    expect:
      - shot: 01-最小表格现场

  # ---------------------------------------------------------------------------
  # W1：单字符 cell 选区（M842 的 WebKit 破坏形状）
  # 真实鼠标双击数据 cell 的词（单字符 `c`）——选区由浏览器 word-selection 给出，
  # 不依赖 caret 几何推算（真机 ↓/⇧↓ 的落点与 Playwright 不同，M854 实测）。
  # 坐标是窗口局部点（1200×800），由本场景 shots/01 按截图标定（`c` 字形中心 ≈ 384,202）；改 fixture / 字号 /
  # 栏宽后必须重标（与场景 228 / 233 同一纪律）。
  # ---------------------------------------------------------------------------
  - name: 双击数据 cell 的单字符（word selection）
    do: doubleClick
    target: { x: 384, y: 202 }
    settleMs: 300

  - name: Backspace 删除选区（闸门按 state 选区源码 dispatch）
    do: key
    key: "backspace"
    gapMs: 300
    expect:
      - label: 邻接 cell 保留（未被渲染回写吞掉空格）
        editor: { has: "d" }
      - label: 被删字符不在场
        editor: { not: "c" }
      - label: 删除未落盘（只有 ⌘S 写盘）
        file: { path: table-fullscreen.md, unchangedSince: 文档基线, mtimeUnchangedSince: 文档基线 }

  - name: ⌘S 落盘
    do: key
    key: "cmd+s"
    gapMs: 400
    expect:
      - label: 盘上全文 = 删掉源码 [26,27) 之后的精确结果（WebKit 修复前会写成 `|| d |`）
        file: { path: table-fullscreen.md, exact: "| a | b |\n| --- | --- |\n|  | d |\n", changedSince: 文档基线 }
      - label: dirty 已收窄
        ax: { not: "（未保存）" }

  - name: 记录保存后的基线（撤销不得再写盘）
    do: record
    file: table-fullscreen.md
    as: 保存基线

  - name: 一次撤销回删除前
    do: key
    key: "cmd+z"
    gapMs: 300
    expect:
      - label: 被删字符回来
        editor: { has: "c" }
      - label: 零额外写盘（sha256 + mtime 双比）
        file: { path: table-fullscreen.md, unchangedSince: 保存基线, mtimeUnchangedSince: 保存基线 }
---

# 266 — 非空选区删除 = 源码精确删除（M854）

M842 的双引擎矩阵发现：选区任一端落在渲染隐藏区（表格 cell 间的管道、整行被 replace 覆盖的
分隔行、列表 marker）时，Backspace / Delete 走浏览器原生路径，CM 的 DOMReader 按渲染结果回写
源码，表格结构与列表 marker 会被摧毁并随 ⌘S 落盘。修复落在 `src/editor.ts` 的 beforeinput
闸门：**非空选区**的删除类 inputType 一律 preventDefault，并按 `state.selection` 的源码字节
dispatch 一个显式事务（空光标行边界合并沿用 M836 的判据；IME / readonly 语义不变）。

## witness

文档在场景内由 `vaultWrite` 改写为 M842 的最小现场（三行单字符 cell 表格）并 `restart`
重载。**真实鼠标双击**数据 cell 的单字符（`c`）得到 word selection，Backspace 后
`⌘S` 的 `file.exact` 必须是 `|  | d |\n`。修复前 WebKit 的原生删除按渲染 DOM 回写、把邻接
空格吞掉（探针实测 `|| d |`），chromium 正确——这是本场景在真机 WKWebView 上的区分度来源。
一次 `⌘Z` 复原且零额外写盘。

## 真机执行记录

- 2026-11-19，master `594a0eae` + 本 change 实现（dev flavour，`LUMIR_ACCEPTANCE_PORT=4393`）：
  `PASS`、1/1、场景 26.8s、退出码 0；15 条断言全 PASS，`file.exact` 为
  `| a | b |\n| --- | --- |\n|  | d |\n`（33 字符逐字一致），一次 `⌘Z` 复原且零额外写盘。
  证据：`/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-19-m854-266/`
  （`steps.md` / `run.log` / `shots/01-01-最小表格现场.jpeg`，git 外）。
- 同一窗口内的首跑曾被磁盘水位挡住（`磁盘可用 0.13G < 2G`，退出码 2、INVALID），
  按 tower 裁决清盘后复跑；该次运行不是产品失败，保留为环境证据。

## 判据边界（如实声明）

- 表格在 AX 里是渲染后的 grid 文本，**不是 raw doc oracle**：逐字节判据一律落在 `⌘S` 后的
  `file.exact`；`editor.has/not` 只做「删除确实落地 / 邻接 cell 没被吞」的正反向锚点。
- 键盘路线（`⌃A → → ↓ ⇧→`）在 Playwright 两引擎可造出同一选区，但真机 WKWebView 的
  caret 几何使 ↓/⇧↓ 落点与 Playwright 不同（M854 真机实测落到空格而非 cell 字符），故真机
  改用真实鼠标双击（word selection）；选区本身 AX 读不到，判据落在删除后的精确字节上
  （双击落空会让 `file.exact` 变红，不会假绿）。
- 新增 fixture 超出本 mission 写面，文档用 `vaultWrite` + `restart` 构造（套件既有动作）。
- 真机执行记录：待本场景 PASS 后回填（场景 261 的口径：未跑不得记 PASS）。
