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
# 字符」判成 PASS（REVIEW.md『断言等价于子串』条）。搜索框用「负向正则不许出现 `JUMP-TARGET-3`」
# 同时挡住「没全选（删掉尾字符）」与「没接管（值原样）」两种失败形态。
id: "881-text-input-select-all-nov26"
item: 881
tier: full
title: 文本输入面的 ⌘A——文件内搜索 / 跳转到行由应用接管（整串替换），正文逐字节不变
fixtures: [goto-line-long.md]
open: goto-line-long.md
marker: "第 2 行"
steps:
  - name: 启动就绪：长文档打开，目标行在开篇一屏之外（下一步的落点判据有区分度）
    do: settle
    expect:
      - label: 开篇可见
        editor: { has: "第 2 行" }
      - label: 目标行（第 39 行）尚未进入视口
        ax: { not: "JUMP-TARGET-39" }

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

  - name: 输入查询串（M507 原生输入原子注入）
    do: typeInNode
    target: { role: AXTextField, name: "查找|JUMP-TARGET-39" }
    text: "JUMP-TARGET-39"
    expect:
      - label: 查询串逐字落在查询框里（非空输入框在 AX 里的形态是 `AXTextField = "值"`）
        ax: { has: '/AXTextField = "JUMP-TARGET-39" /' }

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
      - label: 查询框已整串清空（只删掉尾字符时这里会是 `= "JUMP-TARGET-3"`，未接管时仍是整串）
        ax: { not: '/AXTextField = "JUMP-TARGET-3/' }
      - label: 编辑器正文逐字节不变（⌘A 落在输入面，不碰文档）
        editor: { unchangedSince: 输入面之前的正文 }

  - name: 收起搜索
    do: key
    key: "escape"

  # ── ② 跳转到行（⌥G 的行号框） ───────────────────────────────────────────
  - name: 打开跳转到行输入条
    do: key
    key: "alt+g"
    expect:
      - label: 行号框在场（预填当前行号并预选）
        ax: { has: "跳转到行" }
      - label: 焦点在行号框
        ax: { focused: "AXTextField" }

  # 把预选收成末尾光标，再追加一位——造出「⌘A 之前不是全选」的现场（否则全选前后的值一样，
  # 断言没有区分度）。
  - name: 光标收成末尾
    do: keys
    keys: ["right"]

  - name: 追加一位行号
    do: typeInNode
    target: { role: AXTextField, name: "跳转到行|12" }
    text: "2"
    expect:
      - label: 行号框里是 12（注入落地）
        ax: { has: '/AXTextField = "12" /' }

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
      - label: 行号框已整串清空（未全选时会留下 `1`）
        ax: { not: '/AXTextField = "1" /' }

  - name: 输入目标行号
    do: typeInNode
    target: { role: AXTextField, name: "跳转到行|39" }
    text: "39"
    expect:
      - label: 行号框里是 39
        ax: { has: '/AXTextField = "39" /' }

  - name: Enter 跳转
    do: key
    key: "return"

  - name: 等目标行进入视口（跳转生效）
    do: waitFor
    waitFor: { has: ["JUMP-TARGET-39"] }
    expect:
      - label: 第 39 行的标记出现在视口里
        ax: { has: "JUMP-TARGET-39" }
      - label: 跳转 MUST NOT 改正文（逐字节）
        editor: { unchangedSince: 输入面之前的正文 }
      - shot: 跳转落点

---

本场景只覆盖两个新接入的输入面（搜索 / 行号）；它们与 Quick Open、大纲、vault、文件树内联
重命名共用同一条统一分派（`selectAllAt`），后四面的 ⌘A 判据分别在 230d / 13 / 17 / 47b、
52，全部已改为 `channel: cgevent` 的真实键盘事件。

不覆盖：菜单 Edit ▸ Select All 的点击路径（套件没有 macOS 菜单栏驱动动作，口径与 14-tabs /
215 / 250 同；该路径由 chromium 场景 `text-input-select-all-nov26.spec.ts` 的菜单用例覆盖），
设置面板各文本框与审批理由 textarea（与搜索 / 行号同一条分派，行为由视觉矩阵与静态清单兜底）。
