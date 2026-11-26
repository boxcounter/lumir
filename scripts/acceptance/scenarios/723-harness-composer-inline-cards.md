---
id: "723-harness-composer-inline-cards"
item: 723
tier: core
title: composer 零长度 inline cards：精确块序 + scoped AX + 一步 undo + 纯文本复制 + 草稿 v3
open: harness-quote.md
marker: "QALPHA"
config:
  keys:
    "Cmd-j": "editor.select-all"
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: composer 的 AXGroup scope 与文本区都在位
        node: { role: AXGroup, name: "问点什么", present: true }

  - name: 编辑器选区 → 第一张 quote 卡
    do: clickEditor
  - name: 建立第 3 行选区
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+shift+n"]
  - name: 等第一次选区对应的摘录按钮进入 AX 树
    do: waitFor
    waitFor:
      has: ["/AXButton \\(摘录到对话\\)/"]
    timeoutMs: 10000
  - name: 插入第一张卡
    do: clickInNode
    target: { role: AXButton, name: "摘录到对话" }

  - name: 键入卡后文本并核对 composer 子树顺序与负向 value
    do: typeInNode
    target: { role: AXTextArea, name: ".*", nth: 1 }
    text: "CW-TEXT-B"
    expect:
      - label: 注入后焦点仍在 composer 的 AXTextArea
        ax: { focused: "AXTextArea" }
      - label: quote 在文本之前；编辑器里的 QALPHA 原文不参与 scoped 判序
        ax: { scope: { role: AXGroup, name: "问点什么" }, order: ["QALPHA", "CW-TEXT-B"] }
      - label: 卡片摘录不进入 composer 的 AXTextArea.value
        ax: { scope: { role: AXGroup, name: "问点什么" }, order: ["QALPHA"], notInValue: "QALPHA" }
      - shot: 01-卡前文本后

  - name: 回编辑器重新建立选区
    do: clickEditor
  - name: 移到第 4 行并选取 QBETA
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+shift+n"]
  - name: 等第二次选区对应的摘录按钮进入 AX 树
    do: waitFor
    waitFor:
      has: ["/AXButton \\(摘录到对话\\)/"]
    timeoutMs: 10000
  - name: 文末插入第二张卡
    do: clickInNode
    target: { role: AXButton, name: "摘录到对话" }
  - name: 键入第二段文字
    do: typeInNode
    target: { role: AXTextArea, name: ".*", nth: 1 }
    text: "CW-TEXT-C"
    expect:
      - label: 第二段注入后焦点仍在 composer 的 AXTextArea
        ax: { focused: "AXTextArea" }
      - label: 块序 = 卡 / 卡 / 文本 / 卡 / 文本
        ax: { scope: { role: AXGroup, name: "问点什么" }, order: ["QALPHA", "CW-TEXT-B", "QBETA", "CW-TEXT-C"] }

  - name: 全选折叠到文首再前进一个字符，准备行中插卡
    do: keys
    keys: ["cmd+j", "left", "ctrl+f"]
  - name: 回编辑器建立摘录选区
    do: clickEditor
  - name: 移到第 5 行并选取 QGAMMA
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+shift+n"]
  - name: 等第三次选区对应的摘录按钮进入 AX 树
    do: waitFor
    waitFor:
      has: ["/AXButton \\(摘录到对话\\)/"]
    timeoutMs: 10000
  - name: 行中插入第三张卡（拆行与卡片同一 history 步）
    do: clickInNode
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: 第三张卡在场且移除钮总数为 3
        ax: { count: { pattern: "移除摘录", exact: 3 } }

  - name: 一步 undo 撤掉拆行与第三张卡
    do: key
    key: "cmd+z"
    expect:
      - label: 回到两张卡
        ax: { count: { pattern: "移除摘录", exact: 2 } }
  - name: 一步 redo 恢复第三张卡
    do: key
    key: "cmd+shift+z"
    expect:
      - label: 第三张卡与拆行同事务恢复
        ax: { count: { pattern: "移除摘录", exact: 3 } }
  - name: 再 undo 回到两张卡，准备复制
    do: key
    key: "cmd+z"

  - name: 复制前确认焦点与精确块序
    do: settle
    expect:
      - label: 复制前焦点仍在 composer 的 AXTextArea
        ax: { focused: "AXTextArea" }
      - label: 复制前两段文字仍按原块序保留
        ax: { scope: { role: AXGroup, name: "问点什么" }, order: ["QALPHA", "CW-TEXT-B", "QBETA", "CW-TEXT-C"] }
  - name: ⌘J 全选 + ⌘C 后读取外部剪贴板
    do: keys
    keys: ["cmd+j", "cmd+c"]
  - name: 外部剪贴板按平台归一后只含文本
    do: clipboardRead
    expect:
      - label: 剪贴板逐字等于两段文本，不含卡片、×、@ 或哨兵
        clipboard: { exact: "CW-TEXT-B\nCW-TEXT-C" }
      - label: 卡片摘录没有进入剪贴板
        clipboard: { not: "QALPHA" }

  - name: 折叠选区后 Backspace 只删文本
    do: keys
    keys: ["right", "backspace"]
    expect:
      - label: 卡片数量不变
        ax: { count: { pattern: "移除摘录", exact: 2 } }

  - name: 等草稿防抖落盘
    do: sleep
    ms: 1800
    expect:
      - label: 草稿升级为 v3
        file: { path: "env:harness/drafts/*.json", has: '"version":3' }
      - label: placed cards 携带精确 at
        file: { path: "env:harness/drafts/*.json", has: '"at":' }
      - shot: 02-inline-cards-草稿v3
---

# 723 —— composer inline cards 真机矩阵

本场景的自动判据限定在 composer 的 `AXGroup（问点什么）` 子树。编辑器源文档本来就有 QALPHA，
不能用整棵 AX 树做顺序或负向断言。`notInValue` 也只检查 composer 内的 AXTextArea。

## 同批复跑项

- 行首、行尾、文末、空文档与非空选区插卡；删除行界、跨行删除、⌘A 替换后的精确 anchor 与 undo/redo。
- 连续两次组合期插卡后发送：FIFO 保序，重复发送意图只产生一次 `harness_send`。
- 切 vault / 新会话 / 面板销毁取消旧 pendingSend；drain 失败保留未消费请求且不投递缺卡消息。
- 外部剪贴板按平台归一（统一行尾并去掉一个尾换行）比较；应用内 copy event 才做逐字节断言。

## 原生 IME 边界

原生 TSM 组合、候选窗和候选选择不由本场景合成。复验时先建立组合文本，再在组合期连续插入两张卡并触发发送；
确认组合未被打断、组合文本未丢、两张卡按序投递。切视图与 drain 失败矩阵另按上节执行。自动段未覆盖这些原生动作，
报告 MUST NOT 把本场景 PASS 写成原生 IME PASS。
