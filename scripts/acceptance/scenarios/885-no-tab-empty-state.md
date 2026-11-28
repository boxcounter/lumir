---
# 885（change make-no-tab-empty-workspace-nov28）：无 TAB 统一为空工作区。
#
# Alex 2026-11-28 空态重设计：首启 / 普通 / 双 pane 共用四条 Lumir 特有 tips；无 Open / New
# 按钮、无通用快捷键。静态 region 承接焦点，被覆盖编辑器宿主 inert，不为留焦点伪造按钮。
# 本场景验真机 WKWebView 上可观察的：不可输入 / 无 dirty / 无保存目标、⌥G 无目标、region
# 焦点归还、双 pane 不串焦。chromium 另验程序 focus 无法进入 inert 正文与完整读屏列表语义。
# 键入负例走 do: typeInNode + channel:cgevent + allowNoLanding：向当前 focused region
# 注入真实 Unicode，目标未变才接受且不重试，不再调用 do:type/typeInEditor/type_text；
# partial / target-lost 仍失败。
id: "885-no-tab-empty-state"
item: 885
tier: full
title: 无 TAB 空工作区：共享四条 tips、不可输入、region 焦点与分栏 Quick Open 归还
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
      - label: 有文档时没有共享空态标题
        ax: { not: "开始使用" }
      - shot: 01-有文档

  - name: 关掉最后一个标签，回到共享空工作区
    do: key
    key: "cmd+w"
    expect:
      - label: 共享 tips 标题在场
        ax: { has: "开始使用" }
      - label: 四条中的大纲与知识链接在场
        ax: { has: "大纲" }
      - label: 知识链接在场
        ax: { has: "知识链接" }
      - label: 不再有打开笔记按钮
        ax: { not: "/AXButton[^\\n]*打开笔记…/" }
      - label: 不再有新建笔记按钮
        ax: { not: "/AXButton[^\\n]*新建笔记/" }
      - label: 通用快速打开提示不回流
        ax: { not: "快速打开文件" }
      - label: modeline 显示无当前文件
        ax: { has: "无当前文件" }
      - label: 焦点落在命名静态 region（不是正文 / body / 伪按钮）
        ax: { focused: { role: "AXGroup", name: "开始使用" } }
      - shot: 02-空工作区

  - name: 空工作区按 ⌥G（region 持焦）：不打开跳转输入条
    do: key
    key: "alt+g"
    expect:
      - label: 跳转输入条不打开（可观察形态：没有「共 N 行」）
        ax: { not: "共 1 行" }
      - label: 焦点仍在空工作区 region
        ax: { focused: { role: "AXGroup", name: "开始使用" } }
      - shot: 03-空工作区-altg

  - name: 向当前聚焦 region 注入文本（不定位 inert 正文；未变才接受且不重试）
    # 已持焦的 region 不需要也不允许点击。type_text 会拒绝静态 region，press_key 序列又会
    # 误开 vault 浮层；显式 cgevent 复用真实 Unicode 注入，目标值未变才接受，partial / target-lost 仍失败。
    do: typeInNode
    target: { role: AXGroup, name: "开始使用", nth: 0 }
    text: "NO-TAB-LAND"
    allowNoLanding: true
    channel: cgevent
    expect:
      - label: 键入没有落进任何文档
        ax: { not: "NO-TAB-LAND" }
      - label: 焦点没有转入 inert 正文，仍在命名 region
        ax: { focused: { role: "AXGroup", name: "开始使用" } }
      - label: 没有未保存修改标记
        ax: { not: "（未保存）" }
      - shot: 04-空工作区-键入无效

  - name: 空工作区按 ⌘S：没有保存目标
    do: key
    key: "cmd+s"
    expect:
      - label: 不弹「无法保存」类提示
        ax: { not: "无法保存" }
      - label: 不出现「没有打开的文件」的不可保存提示
        ax: { not: "没有打开的文件" }
      - shot: 05-空工作区-cmd-s

  - name: 重新打开文档：空工作区离场
    do: open
    file: goto-line-long.md
    marker: "段一"
    expect:
      - label: 文档回到前台
        editor: { has: "第 2 行：填充段落" }
      - label: 空工作区标题离场
        ax: { not: "开始使用" }
      - shot: 06-重开文档

  - name: 分栏得到空的右 pane（同一组共享 tips）
    do: key
    key: "alt+s"
    expect:
      - label: 分栏已发生（分隔条在场）
        ax: { has: "分隔条" }
      - label: 空 pane 显示同一组 tips
        ax: { has: "开始使用" }
      - label: 焦点在右 pane 的静态 region
        ax: { focused: { role: "AXGroup", name: "开始使用" } }
      - shot: 07-分栏空工作区

  - name: 经既有 ⌘P 在右 pane 打开 Quick Open
    do: key
    key: "cmd+p"
    expect:
      - label: 快速打开浮层已打开（输入框读屏名）
        ax: { has: "按路径快速打开文件" }
      - shot: 08-空工作区-QuickOpen

  - name: Esc 取消：不打开任何文件，焦点回右 pane 的 region
    do: key
    key: "escape"
    channel: cgevent
    expect:
      - label: 浮层收起
        ax: { not: "按路径快速打开文件" }
      - label: 空工作区标题仍在
        ax: { has: "开始使用" }
      - label: 焦点回静态 region（不落正文 / 不串到左 pane）
        ax: { focused: { role: "AXGroup", name: "开始使用" } }
      - label: 左 pane 的文档原样在场
        editor: { has: "第 2 行：填充段落" }
      - shot: 09-空工作区-取消回焦点
---
