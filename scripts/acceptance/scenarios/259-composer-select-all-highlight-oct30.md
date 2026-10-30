---
# M815 / HC6：真实 WKWebView 的 composer 自绘选区高亮。物理 ⌘A 在 KimiCU 注入通道不可达，
# 因此与场景 215 同口径，经 [keys] 把同一条 editor.select-all 重绑到 ⌘J；不宣称验证物理 ⌘A。
id: "259-composer-select-all-highlight-oct30"
item: 259
tier: full
title: composer 全选自绘高亮：卡片与段落可见、折叠无残留、Backspace 整删（M815，HC6）
fixtures: [harness-quote.md]
open: harness-quote.md
marker: "QALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
  keys:
    "Cmd-j": "editor.select-all"
steps:
  - name: 钉窗口尺寸（像素判据的几何前提）
    do: resizeWindow
    width: 1200
    height: 800
    settleMs: 900

  - name: 把光标放进编辑器第 1 行
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: 抢前台
    do: focusWindow
    retries: 4

  - name: 光标下移到第 3 行并选中该行
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+shift+n"]
    expect:
      - label: 浮动「摘录到对话」钮在场
        ax: { has: "摘录到对话" }

  - name: 点浮动钮，生成位于 composer 首位的不可编辑引用卡片
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: 卡片出处与原文都进入 composer
        ax: { has: "harness-quote.md · 摘录卡片验收" }
      - label: 卡片带移除钮（不可编辑原子块在场）
        ax: { has: "/AXButton \\(移除摘录\\)/" }

  - name: 在卡片后的段落键入合成问题（AXPress 插卡语境用 keys，素材不含通道丢字 e）
    do: keys
    keys: ["q", "z", "x"]
    expect:
      - label: 卡片后的段落文本在场
        ax: { has: "qzx" }
      - label: 卡片与问题段落的底色在全选前不同（后续同色判据有区分度）
        pixel:
          differ:
            - [ { x: 1100, y: 685, as: "卡片右侧空白带" }, { x: 1100, y: 723, as: "段落右侧空白带" } ]
          min: 8
      - shot: 00-全选前-卡片与段落

  - name: 记编辑器文档基线（全选与删除不得漏进文档）
    do: recordEditor
    as: 全选前文档

  - name: ⌘J 触发同一 editor.select-all——首块卡片与段落必须出现同一选区带
    do: key
    key: "cmd+j"
    expect:
      - label: 首块卡片与段落都有可见高亮（两处空白带的底色一致）
        pixel:
          same:
            - [ { x: 1100, y: 685, as: "选中卡片右侧空白带" }, { x: 1100, y: 723, as: "选中段落右侧空白带" } ]
          tol: 12
      - label: 高亮没有铺满 composer 外（卡片选区带与编辑器空白不同色）
        pixel:
          differ:
            - [ { x: 1100, y: 685, as: "选中卡片" }, { x: 1100, y: 200, as: "composer 外空白" } ]
          min: 8
      - shot: 01-全选后-自绘高亮

  - name: 左方向键折叠选区——自绘高亮必须消失
    do: key
    key: "left"
    expect:
      - label: 折叠后卡片与段落恢复不同底色（无选区带残留）
        pixel:
          differ:
            - [ { x: 1100, y: 685, as: "折叠后卡片" }, { x: 1100, y: 723, as: "折叠后段落" } ]
          min: 8
      - label: 卡片与文本都未因折叠丢失
        ax: { has: "/QALPHA[\\s\\S]*qzx/" }
      - shot: 02-折叠后-无残留

  - name: 再次全选后 Backspace——选区覆盖卡片与文本的端到端判据
    do: key
    key: "cmd+j"

  - name: 整删全部块
    do: key
    key: "Backspace"
    expect:
      - label: composer 回到空输入态
        ax: { has: "问点什么" }
      - label: 引用卡片被整删
        ax: { not: "harness-quote.md · 摘录卡片验收" }
      - label: 问题文本被整删
        ax: { not: "qzx" }
      - label: 删除没有漏进编辑器文档
        editor: { unchangedSince: 全选前文档 }
      - shot: 03-Backspace后-全部块清空
---

# 259 — composer 全选高亮的真实 WKWebView 判据

本场景先制造调查报告中的缺陷结构：不可编辑引用卡片位于首位，后接问题段落。全选前卡片与段落
底色不同；全选后两处空白带必须呈现同一选区底色，证明不是只染了文字或只染了某一类块。左方向键
折叠后两色必须恢复差异，证明自绘层无残留。再次全选并 Backspace，卡片与文字都必须消失。

## 覆盖边界

- **不验证物理 ⌘A 注入**：KimiCU 对该键的注入不可达。本场景经 `[keys]` 把同一
  `editor.select-all` 绑到 ⌘J，验证真实 WKWebView 中的命令、绘制与删除。⌘A 到命令的分发由
  m627 与 Rust 菜单测试覆盖。
- AX 不暴露 contenteditable 的 DOM Selection，因此「覆盖全块」由两块可见高亮 + Backspace 整删
  共同证明；精确 DOM 端点由 `m815-composer-selection-highlight.spec.ts` 断言。
- 像素坐标按 1200×800 窗口标定；采样点都在块内右侧空白带，避免把文字笔画误当底色。
- 套件自动使用隔离 XDG_CONFIG_HOME 与合成 vault `/tmp/lumir-m102-acceptance`，不读取真实配置或 vault。
