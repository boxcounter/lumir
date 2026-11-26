---
# 885（change fix-no-tab-empty-state-nov27）：无 TAB 空态的呈现修正。
#
# 本场景只覆盖真机 WKWebView 上**行为可观测**的两条：单 pane scratch 的「无行号但可输入」，
# 以及分栏空 pane 的「无行号、键入无效、引导在场」。行号 gutter 与插入光标的**像素**判据在
# screenshot 里留证（光标层是否真的没画，chromium 层的结构断言在
# tests/visual/scenes/no-tab-empty-state-nov27.spec.ts；真机像素归 Alex 过目，不在本场景判红）。
# 首启 tips / 老用户 D107 覆盖层收窄的判据同样在视觉场景；本场景不伪造首启状态。
#
# 2026-11-27 真机首跑：`open goto-line-long.md` 等待「第 1 行」60s 超时。证据
# `.local/acceptance/2026-11-27-ux-goal/885-no-tab-empty-state/` 的 AX 快照显示文档其实已装载
# （AXTextArea 全文在场、标签选中），只是 fixture 以 `## 段一` 开头、没有「第 1 行」这一行——
# 是场景 marker 写错，不是 tips 遮挡 / 打开意图 / fixture 或窗口状态 / 产品回归。marker 改为
# fixture 实有的 `段一`；本批只跑 `--check`，真机待主会话重排。
id: "885-no-tab-empty-state"
item: 885
tier: full
title: 无 TAB 空态：单 pane scratch 无行号但可输入；分栏空 pane 无行号、键入无效、引导在场
fixtures: [goto-line-long.md]
open: goto-line-long.md
marker: "段一"
config:
  lineNumbers: "on"
  keys: { F2: "pane.split" }
steps:
  - name: 起点：文档打开、on 档 gutter 在场（后面「无标签后没有 gutter」的对照面）
    do: settle
    expect:
      - label: 文档已装载（正观测）
        editor: { has: "第 2 行：填充段落" }
      - shot: 01-有文档-on-档

  - name: 关掉最后一个标签，回到单 pane scratch
    do: key
    key: "cmd+w"
    expect:
      - label: 前台回到未命名空文档
        ax: { has: "无当前文件" }
      - shot: 02-无标签-单-pane

  - name: 点正文并键入：scratch 仍可编辑（M149 形态不被本 change 收紧）
    do: clickEditor
  - name: 键入 scratch 文本
    do: type
    text: "NO-TAB-SCRATCH"
    expect:
      - label: 键入真的落进空文档（不是「按键被吞」的假只读）
        ax: { has: "NO-TAB-SCRATCH" }
      - shot: 03-scratch-可输入

  - name: 撤销回 clean，避免打开守卫拦住下一步
    do: key
    key: "cmd+z"
    expect:
      - label: 撤销后文本退出（确认上一步落的是可撤销的编辑，不是残留渲染）
        ax: { not: "NO-TAB-SCRATCH" }

  - name: 重新打开文档：gutter 同帧恢复
    do: open
    file: goto-line-long.md
    marker: "段一"
    expect:
      - label: 文档回到前台
        editor: { has: "第 2 行：填充段落" }
      - shot: 04-重开文档-gutter-恢复

  - name: 分栏得到空 pane（F2 由本场景 config 绑定）
    do: key
    key: "f2"
    expect:
      - label: 分栏已发生（分隔条在场）
        ax: { has: "分隔条" }
      - label: 空 pane 引导在场（D369）
        ax: { has: "在左栏选一个文件" }
      - shot: 05-分栏空-pane

  - name: 在空 pane 里键入：结构性只读拒收，且不出现「打了没反应」的脏状态
    do: type
    text: "MUST-NOT-LAND"
    expect:
      - label: 键入没有落进任何文档
        ax: { not: "MUST-NOT-LAND" }
      - label: 没有未保存修改标记
        ax: { not: "（未保存）" }
      - shot: 06-空-pane-键入无效

---
