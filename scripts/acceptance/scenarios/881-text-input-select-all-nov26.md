---
# change fix-text-input-select-all-nov26 的真机判据：⌘A 的落面是**当前聚焦的输入面**。
#
# 为什么这条只能在真机层：chromium 的原生 select-all 本来就工作，夹具层的「选区正确」分不出
# 「应用接管了」与「引擎顺手做了」；WKWebView 上 M627 起 Edit 菜单的预置 Select All 已让出加速键，
# 原生路径不再兜底——用户报告的「重命名框 ⌘A 不能全选」正是这条差异。本场景只跑**新增覆盖的
# 两个面**（文件内搜索、跳转到行）；重命名 / 新建在 47b / 52（已改为 cgevent 真键盘），
# Quick Open / 大纲 / vault 在 230d / 13 / 17（同样走 cgevent）。
#
# 通道纪律：⌘A 步 MUST 写 `channel: cgevent`——KimiCU 的 `cmd+a` 在原生输入框上走 AX 全选兼容
# 路径（零键盘事件），既验不到应用的分派，也会把本 change 修掉的缺陷判成绿。
#
# 判据的区分度：全选后按一次 Backspace，输入串必须**整段消失**；只看「值变了」会把「只删了一个
# 字符」判成 PASS（REVIEW.md『断言等价于子串』条）。负向断言一律用**不带收尾引号的前缀**
# （`= "1/` / `= "ZZ-NO-SUCH-QUERY-88/`），这样「全选没生效只删了尾字符」与「Backspace 整拍丢失、
# 值还在」两种失败形态都会命中。
#
# 2026-11-27 真机 881 FAIL 的修复（证据
# `.local/acceptance/2026-11-27-ux-goal/881-text-input-select-all-nov26/steps.md`）：
#   ① 跳转到行的输入框**非空时 AX 只暴露值**（dump 里是 `AXTextField = "1"`；aria-label 不出现，
#      见 scripts/acceptance/README.md「真机 AX 读不到非空值输入框的读屏名」）。原断言
#      `ax.has "跳转到行"` 与 typeInNode 目标 `跳转到行|12` 都因此解析不到节点——这是**场景
#      locator 错**，不是产品回归（同一份证据里 `focused=AXTextField` 已证明输入框在场且持焦）。
#      现在按值定位；键入改走 56 号场景的 `keys` 通道（预填值已全选 ⇒ 键入即替换，回读目标 =
#      持焦输入框），不再依赖 typeInNode 对空态 / 非空态读屏名的猜测。
#   ② **AX 的 AXTextArea 暴露整篇正文**（dump 01 的 [203] 是全文；行节点也整篇在场）。因此
#      `ax.has/not` 对正文里的任何一行都恒真——原「第 39 行尚未进入视口」与「跳转后标记出现」
#      两条判据都不是可见性判据（前者必红、后者必绿）。两条一并删除；落点改用**被测功能自己的
#      读数**：Enter 后再按 ⌥G，输入条预填值 = 当前光标行号（56 号场景的同一手法），读到 140
#      即证明跳转落点。可见性 / 居中由 chromium 的 `tests/visual/scenes/m281-goto-line.spec.ts`
#      （`lineCenterOffset` + 实测 rect）与 Alex 截图手感负责，不在本场景冒充 AX 判据。
#   ③ 搜索步的查询串改用文档里不存在的 `ZZ-NO-SUCH-QUERY-881`：这一步只验 ⌘A 全选/清空查询框，
#      MUST NOT 让搜索命中移动光标或滚动正文（否则后续「预填 140」的落点判据会被提前改道）。
#   ④ fixture 改为 160 行的 `goto-line-far.md`（第 140 行 = FAR-TARGET-MARK）：跳转真的产生
#      滚动位移，截图供人看；可见性本身**不**作为 AX 判据（见 ②）。
id: "881-text-input-select-all-nov26"
item: 881
tier: full
title: 文本输入面的 ⌘A——文件内搜索 / 跳转到行由应用接管（整串替换），正文逐字节不变
fixtures: [goto-line-far.md]
open: goto-line-far.md
marker: "FAR-DOC-TOP"
steps:
  - name: 启动就绪：长文档打开（目标行在第 140 行，远离开篇；可见性不在这里用 AX 判）
    do: settle
    expect:
      - label: 开篇可见
        editor: { has: "FAR-DOC-TOP" }
      - label: 文档确实含远距目标行（内容判据；AXTextArea 暴露全文，见文件头 ②）
        editor: { has: "FAR-TARGET-MARK" }

  - name: 记编辑器基线（两个输入面的 ⌘A 都 MUST NOT 改正文）
    do: recordEditor
    as: 输入面之前的正文

  # ── ① 文件内搜索（⌘F 的查询框） ─────────────────────────────────────────
  - name: 打开文件内搜索
    do: key
    key: "cmd+f"
    expect:
      - label: 查询框在场且持焦
        ax: { has: "查找" }
      - label: 焦点在查询框（下一步注入的落点）
        ax: { focused: "AXTextField" }

  - name: 输入查询串（M507 原生输入原子注入；串在文档里不存在，不动光标与滚动）
    do: typeInNode
    target: { role: AXTextField, name: "查找|ZZ-NO-SUCH-QUERY-881" }
    text: "ZZ-NO-SUCH-QUERY-881"
    expect:
      - label: 查询串逐字落在查询框里（非空输入框在 AX 里的形态是 `AXTextField = "值"`）
        ax: { has: '/AXTextField = "ZZ-NO-SUCH-QUERY-881" /' }

  - name: ⌘A 全选查询串（真实键盘事件）
    do: key
    key: "cmd+a"
    channel: cgevent

  - name: 全选后按一次 Backspace（盲发，恰好一次）
    do: keys
    keys: ["Backspace"]

  - name: 判输入串是否被整串清空
    do: settle
    expect:
      - label: 查询框已整串清空（只删尾字符时是 `…-88`，Backspace 丢拍时仍是整串）
        ax: { not: '/AXTextField = "ZZ-NO-SUCH-QUERY-88/' }
      - label: 编辑器正文逐字节不变（⌘A 落在输入面，不碰文档）
        editor: { unchangedSince: 输入面之前的正文 }

  - name: 收起搜索
    do: key
    key: "escape"

  - name: 等搜索框从 AX 消失
    do: settle
    expect:
      - label: 查询框已从 AX 消失（下面「行号框 = 全应用唯一 AXTextField」的前提）
        ax: { not: "AXTextField" }

  - name: 焦点交还编辑器（alt+g 是 editor 作用域，事件目标必须在 contentDOM 内；光标回首行）
    do: clickEditor
    expect:
      - label: 焦点在编辑器正文
        ax: { focused: "AXTextArea" }

  # ── ② 跳转到行（⌥G 的行号框） ───────────────────────────────────────────
  - name: 打开跳转到行输入条
    do: key
    key: "alt+g"
    expect:
      # 非空输入框在 WKWebView 的 AX 里只暴露值（aria-label 读不到，见文件头 ①）。
      - label: 行号框在场并预填当前行号（值 = 1）
        ax: { has: '/AXTextField = "1"/' }
      - label: 焦点在行号框
        ax: { focused: "AXTextField" }

  # 预填值已全选 ⇒ 键入即替换成 12（56 号场景的同一通道：数字键逐位注入 + 持焦框回读）。
  # 不在开头「12」时（注入丢拍 / 没替换）下一步的负向断言会红——这正是「⌘A 之前不是全选」的现场。
  - name: 键入两位行号（替换预填的 1，得到 12）
    do: keys
    keys: ["1", "2"]
    expect:
      - label: 行号框里是 12（注入落地且是替换而非追加）
        ax: { has: '/AXTextField = "12"/' }

  - name: ⌘A 全选行号（真实键盘事件）
    do: key
    key: "cmd+a"
    channel: cgevent

  - name: 全选后按一次 Backspace
    do: keys
    keys: ["Backspace"]

  - name: 判行号是否被整串清空
    do: settle
    expect:
      # 前缀不带收尾引号：值若是 `1`（只删了尾字符）或 `12`（Backspace 丢拍）都命中这条负向断言。
      - label: 行号框已整串清空（未全选时会留下 `1`，Backspace 丢拍时仍是 `12`）
        ax: { not: '/AXTextField = "1/' }

  - name: 输入目标行号 140
    do: keys
    keys: ["1", "4", "0"]
    expect:
      - label: 行号框里是 140
        ax: { has: '/AXTextField = "140"/' }

  - name: Enter 跳转
    do: key
    key: "return"
    expect:
      - label: 输入条已收起（行号框从 AX 消失）
        ax: { not: "AXTextField" }
      - label: 焦点交还编辑器（下一步再按 alt+g 的前置：事件目标必须在 contentDOM 内）
        ax: { focused: "AXTextArea" }
      - label: 跳转 MUST NOT 改正文（逐字节）
        editor: { unchangedSince: 输入面之前的正文 }

  - name: 落点读数：再开输入条，预填值 = 当前光标行号
    do: key
    key: "alt+g"
    expect:
      - label: 光标已在第 140 行（跳到别处会读出别的值；预填值是被测功能自己的读数）
        ax: { has: '/AXTextField = "140"/' }
      - label: 焦点在行号框
        ax: { focused: "AXTextField" }
      - shot: 跳到第-140-行

  - name: 收起输入条
    do: key
    key: "escape"
    expect:
      - label: 输入条已收起
        ax: { not: "AXTextField" }

---

本场景只覆盖两个新接入的输入面（搜索 / 行号）；它们与 Quick Open、大纲、vault、文件树内联
重命名共用同一条统一分派（`selectAllAt`），后四面的 ⌘A 判据分别在 230d / 13 / 17 / 47b、
52，全部已改为 `channel: cgevent` 的真实键盘事件。

覆盖边界：
- **跳转落点**用「再开输入条读预填」判（光标行号），不用正文标记的 AX 在场性——AXTextArea 暴露
  整篇正文，标记在场性对任何行都恒真（2026-11-27 真机证据 dump 01 的 [203]）。落点的可见性 /
  居中由 chromium `m281-goto-line.spec.ts` 的实测几何判定，截图只作人审材料。
- 菜单 Edit ▸ Select All 的点击路径不在此场景（套件没有 macOS 菜单栏驱动动作，口径与
  14-tabs / 215 / 250 同；该路径由 chromium 场景 `text-input-select-all-nov26.spec.ts` 的
  菜单用例覆盖）。
- 设置面板各文本框与审批理由 textarea 与搜索 / 行号同一条分派，行为由视觉矩阵与静态清单兜底。
