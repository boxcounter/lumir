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
# 2026-11-27 真机 881 的两次 FAIL 与修复：
#   r1（`.local/acceptance/2026-11-27-ux-goal/881-text-input-select-all-nov26/`）：
#   ① 跳转到行的输入框**非空时 AX 只暴露值**（`AXTextField = "1"`；aria-label 不出现，见
#      scripts/acceptance/README.md「真机 AX 读不到非空值输入框的读屏名」）。原断言
#      `ax.has "跳转到行"` 与 typeInNode 目标 `跳转到行|12` 都解析不到节点——**场景 locator 错**，
#      不是产品回归（同一份证据里 `focused=AXTextField` 已证明输入框在场且持焦）。现在按值定位；
#      非空框的键入走 56 号场景的 `keys` 通道（预填值已全选 ⇒ 键入即替换，回读目标 = 持焦框）。
#   ② **AXTextArea.value 是渲染窗口，不是整篇正文**：160 行 fixture 只暴露前 53 行（r4 实测
#      267 字符，到「行53」为止；49 行的旧 fixture 恰好整篇都渲染，才让 r1 看起来像全文）。
#      因此 `editor.has/not` 可判「某行是否已渲染进窗口」（远距行有效：启动时第 140 行不在，
#      跳转后在），但 MUST NOT 当作整篇内容或精确像素可见性；`editor.unchangedSince` 只覆盖
#      窗口——跨滚动 / 跳转后不可再用它判「正文不变」，零写盘改用文件 sha256 + mtime。
#   r4（`.local/acceptance/2026-11-27-ux-goal-r4/881-text-input-select-all-nov26/`）：
#   ③ ⌘A 清空后输入框为**空**，`keys` 注入 140 时套件按空态 label（`跳转到行`）捕获回读身份；
#      值一出现 label 消失 → 报「回读目标在注入过程中消失」，而 dump 02 里
#      `AXTextField = "140"` 已落地——**套件身份口径**，不是产品。空框这一步改走 `typeInNode`
#      （target.name 并联空态读屏名与注入后的值），复用搜索步的同一通道。
#   ④ 搜索步的查询串用文档里不存在的 `ZZ-NO-SUCH-QUERY-881`：这一步只验 ⌘A 全选/清空查询框，
#      MUST NOT 让搜索命中移动光标或滚动正文。
#   ⑤ fixture 为 160 行的 `goto-line-far.md`（第 140 行 = FAR-TARGET-MARK，约 1 KB）：跳转真的
#      产生滚动；落点**双证**——目标行进入渲染窗口（`waitFor` + `editor.has`）与再开 ⌥G 的预填
#      值 = 光标行号 140（56 号场景的手法）。精确可见性 / 居中仍归 chromium
#      `tests/visual/scenes/m281-goto-line.spec.ts`（`lineCenterOffset` + 实测 rect）与 Alex 手感。
id: "881-text-input-select-all-nov26"
item: 881
tier: full
title: 文本输入面的 ⌘A——文件内搜索 / 跳转到行由应用接管（整串替换），正文逐字节不变
fixtures: [goto-line-far.md]
open: goto-line-far.md
marker: "FAR-DOC-TOP"
steps:
  - name: 启动就绪：长文档打开，目标行在开篇渲染窗口之外
    do: settle
    expect:
      - label: 开篇可见
        editor: { has: "FAR-DOC-TOP" }
      - label: 目标行（第 140 行）尚未进入渲染窗口（AXTextArea 值 = 渲染窗口，见文件头 ②）
        editor: { not: "FAR-TARGET-MARK" }
      - label: fixture 里确有目标行（文件判据，不依赖 AX 窗口）
        file: { path: goto-line-far.md, has: "FAR-TARGET-MARK" }

  - name: 记文档文件基线（跳转 MUST NOT 写盘：sha256 + mtime 两个口径）
    do: record
    as: 文档文件基线
    file: goto-line-far.md

  - name: 记编辑器窗口基线（搜索步的 ⌘A MUST NOT 改可见正文）
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
      - label: 编辑器可见正文逐字节不变（⌘A 落在输入面，不碰文档）
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

  - name: 输入目标行号 140（空框：typeInNode 的目标名并联空态读屏名与注入后的值）
    do: typeInNode
    target: { role: AXTextField, name: "跳转到行|行号|140" }
    text: "140"
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

  - name: 等目标行进入渲染窗口（跳转滚动生效）
    do: waitFor
    waitFor: { has: ["FAR-TARGET-MARK"] }
    timeoutMs: 10000
    expect:
      - label: 第 140 行已渲染进窗口（启动时不在，见第一步）
        editor: { has: "FAR-TARGET-MARK" }
      - label: 跳转 MUST NOT 写盘（sha256 + mtime）
        file: { path: goto-line-far.md, unchangedSince: 文档文件基线, mtimeUnchangedSince: 文档文件基线 }
      - label: 没有变 dirty（跳转不改文档）
        ax: { not: "（未保存）" }

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
- **跳转落点双证**：① 目标行进入渲染窗口（启动时 `editor.not`、跳转后 `waitFor` + `editor.has`；
  AXTextArea 是渲染窗口，远距行因此可判「是否已滚进窗口」）；② 再开 ⌥G 的预填值 = 光标行号
  140（场景 56 的手法）。精确像素可见性 / 居中由 chromium `m281-goto-line.spec.ts` 的实测几何
  判定，截图只作人审材料。
- **零写盘**用文件 sha256 + mtime（`record` + `file.unchangedSince` / `mtimeUnchangedSince`）：
  `editor.unchangedSince` 只覆盖渲染窗口，跳转后窗口内容会变，不能拿它判「正文不变」。
- 菜单 Edit ▸ Select All 的点击路径不在此场景（套件没有 macOS 菜单栏驱动动作，口径与
  14-tabs / 215 / 250 同；该路径由 chromium 场景 `text-input-select-all-nov26.spec.ts` 的
  菜单用例覆盖）。
- 设置面板各文本框与审批理由 textarea 与搜索 / 行号同一条分派，行为由视觉矩阵与静态清单兜底。
