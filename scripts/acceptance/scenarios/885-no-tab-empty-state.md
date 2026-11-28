---
# 885（change make-no-tab-empty-workspace-nov28）：无 TAB 统一为空工作区。
#
# 本场景覆盖真机 WKWebView 上**行为可观测**的四条：
#   ① 关掉最后一个标签后是空工作区：标题 + 两个动作在场，focus 落在主操作，正文结构性只读；
#   ② 空工作区不能产生内容：负向键入不落字、无「（未保存）」、⌘S 不弹「不可保存」；
#   ③ ⌥G 在空工作区没有编辑器目标（输入条不打开）；
#   ④ 分栏空 pane 同合同：右 pane 空工作区、Quick Open 取消后焦点回主操作、左 pane 文档不受影响。
# 行号 gutter 与插入光标的**像素**判据在 screenshot 留证（chromium 结构断言在
# tests/visual/scenes/no-tab-empty-workspace-nov28.spec.ts）；本场景不伪造首启状态。
#
# 2026-11-27 的旧版本（fix-no-tab-empty-state-nov27）验的是「单 pane scratch 仍可输入」；
# 该形态已被 Alex 2026-11-28 裁决取消，本场景同步改判为「空工作区不可输入」。
id: "885-no-tab-empty-state"
item: 885
tier: full
title: 无 TAB 空工作区：不可输入、无 dirty / 保存目标、两个动作与焦点落点；分栏同合同
fixtures: [goto-line-long.md]
open: goto-line-long.md
marker: "段一"
config:
  lineNumbers: "on"
steps:
  - name: 起点：文档打开（后面「无标签后是空工作区」的对照面）
    do: settle
    expect:
      - label: 文档已装载（正观测）
        editor: { has: "第 2 行：填充段落" }
      - label: 有文档时没有空工作区标题
        ax: { not: "没有打开的文档" }
      - shot: 01-有文档

  - name: 关掉最后一个标签，回到空工作区
    do: key
    key: "cmd+w"
    expect:
      - label: 正文标题点明空工作区
        ax: { has: "没有打开的文档" }
      - label: 主操作在场（走既有 Quick Open）
        ax: { has: "/AXButton[^\\n]*打开笔记…/" }
      - label: 次操作在场（走既有内联命名）
        ax: { has: "/AXButton[^\\n]*新建笔记/" }
      - label: modeline 显示无当前文件
        ax: { has: "无当前文件" }
      - label: 旧的水印引导不再出现
        ax: { not: "在左栏选一个文件" }
      - label: 焦点落在主操作（不是正文 / body）
        ax: { focused: { role: "AXButton", name: "打开笔记…" } }
      - shot: 02-空工作区

  - name: 在空工作区正文里键入（结构性只读宿主）
    do: typeInNode
    target: { role: AXTextArea, name: ".*", nth: 0 }
    text: "NO-TAB-LAND"
    allowNoLanding: true
    expect:
      - label: 键入没有落进任何文档
        ax: { not: "NO-TAB-LAND" }
      - label: 没有未保存修改标记
        ax: { not: "（未保存）" }
      - shot: 03-空工作区-键入无效

  - name: 空工作区按 ⌘S：没有保存目标
    do: key
    key: "cmd+s"
    expect:
      - label: 不弹「无法保存 / 没有打开文件」类提示
        ax: { not: "无法保存" }
      - label: 不出现「没有打开的文件」的不可保存提示
        ax: { not: "没有打开的文件" }
      - shot: 04-空工作区-cmd-s

  - name: 空工作区按 ⌥G：键位作用域是 editor，主操作持焦时不打开输入条
    do: key
    key: "alt+g"
    expect:
      - label: 跳转输入条不打开（空工作区没有编辑器目标）
        ax: { not: "跳转到行" }
      - label: 焦点仍在空工作区主操作
        ax: { focused: { role: "AXButton", name: "打开笔记…" } }
      - shot: 05-空工作区-altg

  - name: 重新打开文档：空工作区离场
    do: open
    file: goto-line-long.md
    marker: "段一"
    expect:
      - label: 文档回到前台
        editor: { has: "第 2 行：填充段落" }
      - label: 空工作区标题离场
        ax: { not: "没有打开的文档" }
      - shot: 06-重开文档

  - name: 分栏得到空的右 pane（产品默认 ⌥S；场景 79 同一条真机路径）
    do: key
    key: "alt+s"
    expect:
      - label: 分栏已发生（分隔条在场）
        ax: { has: "分隔条" }
      - label: 空 pane 是同一空工作区（标题 + 动作）
        ax: { has: "没有打开的文档" }
      - label: 空 pane 的旧水印文案不再出现
        ax: { not: "在左栏选一个文件" }
      - shot: 07-分栏空工作区

  - name: 点右 pane 的「打开笔记…」：先激活所属 pane，再打开 Quick Open
    do: click
    target: { any: "/^打开笔记…$/" }
    expect:
      - label: 快速打开浮层已打开（输入框读屏名）
        ax: { has: "按路径快速打开文件" }
      - shot: 08-空工作区-打开笔记浮层

  - name: Esc 取消：不打开任何文件，焦点回空工作区主操作
    do: key
    key: "escape"
    expect:
      - label: 浮层收起
        ax: { not: "按路径快速打开文件" }
      - label: 空工作区标题仍在
        ax: { has: "没有打开的文档" }
      - label: 焦点回主操作（不落正文 / 不串到左 pane）
        ax: { focused: { role: "AXButton", name: "打开笔记…" } }
      - label: 左 pane 的文档原样在场
        editor: { has: "第 2 行：填充段落" }
      - shot: 09-空工作区-取消回焦点
---
