---
id: "866-wikilink-suggestion-nov24"
item: 866
tier: full
title: 行内 [[ 候选：过滤 / 键鼠接受 / Escape / 空态 / 特殊扩展名与零隐式写入
fixtures: [wikilink-suggestion-source.md, notes/Alpha.md, notes/alphabet.md, notes/readme.markdown, foo.md, foo.md.md]
open: wikilink-suggestion-source.md
marker: '\[\[al'
steps:
  - name: 建立正文焦点，确保 opener 查询位于编辑器内
    do: focusWindow
    click: true

  - name: 记录源文档磁盘基线
    do: record
    file: wikilink-suggestion-source.md
    as: 源文档基线

  - name: 光标到 opener 查询末尾，候选按完整路径出现
    do: key
    key: "ctrl+e"
    expect:
      - label: 两个 .md 候选在场且含目录
        ax: { has: '/notes/Alpha\.md|notes/alphabet\.md/' }
      - label: .markdown 不进入候选
        ax: { not: "readme.markdown" }
      - label: 浮层不裁切（同时留截图证据）
        shot: 00-keyboard-candidates
      - label: 打开与过滤不写源文件
        file: { path: wikilink-suggestion-source.md, unchangedSince: 源文档基线, mtimeUnchangedSince: 源文档基线 }

  - name: ↓ 后 Enter 接受第二项，保留完整相对路径与实际扩展名
    do: key
    key: "down"
  - name: 接受当前候选
    do: key
    key: "enter"
  - name: 左移进入新增链接的源码，核对完整插入文本
    do: key
    key: "left"
    expect:
      - label: 文档插入所选完整路径
        editor: { has: "[[notes/alphabet.md]]" }
      - label: 候选已关闭且没有打开目标笔记
        ax: { not: "/# Alphabet|# Alpha/" }
      - label: 接受只改内存文档，未隐式落盘
        file: { path: wikilink-suggestion-source.md, unchangedSince: 源文档基线, mtimeUnchangedSince: 源文档基线 }

  - name: 重置为键盘查询，准备鼠标接受
    do: key
    key: "cmd+a"
    channel: cgevent
  - name: 输入 [[al
    do: type
    text: "[[al"
    expect:
      - label: 候选重新打开
        ax: { has: "Alpha.md" }

  - name: 等候选行完成本拍渲染
    do: settle

  - name: 主键按下并抬起 Alpha 行，编辑器接受而不打开目标
    do: drag
    target: { x: 500, y: 190 }
    dx: 0
    dy: 0
  - name: 左移进入鼠标所接受链接的源码
    do: key
    key: "left"
    expect:
      - label: 鼠标接受完整路径
        editor: { has: "[[notes/Alpha.md]]" }
      - label: 焦点仍在编辑器
        ax: { focused: "AXTextArea" }
      - label: 源文件磁盘仍未改
        file: { path: wikilink-suggestion-source.md, unchangedSince: 源文档基线, mtimeUnchangedSince: 源文档基线 }

  - name: 再次打开候选并记录 Escape 前的内存文档
    do: key
    key: "cmd+a"
    channel: cgevent
  - name: 输入 [[al
    do: type
    text: "[[al"
  - name: 记录 Escape 前文档
    do: recordEditor
    as: Escape 前文档
  - name: Escape 只关闭候选
    do: key
    key: "escape"
    expect:
      - label: Escape 不消费文档或移动目标
        editor: { unchangedSince: Escape 前文档 }
      - label: 候选文案消失
        ax: { not: "notes/Alpha.md" }

  - name: 无匹配只有空态，不创建笔记
    do: key
    key: "cmd+a"
    channel: cgevent
  - name: 输入不存在名称
    do: type
    text: "[[no-such-note-xyz"
  - name: 等零命中浮层完成本拍渲染
    do: settle
    expect:
      - label: 既有零命中文案在场
        ax: { has: "/没有匹配的条目|No matching items/" }
      - label: 候选层不创建 missing.md
        file: { path: no-such-note-xyz.md, exists: false }
      - label: 空态也不写源文件
        file: { path: wikilink-suggestion-source.md, unchangedSince: 源文档基线, mtimeUnchangedSince: 源文档基线 }

  - name: foo.md.md 不被旧去扩展名算法重定向
    do: key
    key: "cmd+a"
    channel: cgevent
  - name: 输入重复扩展名查询
    do: type
    text: "[[foo.md."
  - name: 等重复扩展名候选行完成本拍渲染
    do: settle
  - name: 主键按下并抬起 foo.md.md 行，接受重复扩展名目标
    do: drag
    target: { x: 500, y: 190 }
    dx: 0
    dy: 0
  - name: 左移进入重复扩展名链接的源码
    do: key
    key: "left"
    expect:
      - label: 插入完整实际文件名 foo.md.md
        editor: { has: "[[foo.md.md]]" }
      - label: 未误插会解析到 foo.md 的短目标
        editor: { not: "[[foo.md]]" }
      - label: 目标文件未被创建或改写，源文件仍未隐式保存
        file: { path: wikilink-suggestion-source.md, unchangedSince: 源文档基线, mtimeUnchangedSince: 源文档基线 }
---

# 866 — 行内 wikilink 候选的真机流程

本场景只覆盖真实 WKWebView 的打开 / 过滤 / 方向键 / Enter / Escape / 鼠标接受、空态、完整路径插入与磁盘字节。候选列表 DOM 的精确 active 项、caret 位于 `]]` 外、Link/Image/代码/frontmatter 排除、IME pending MutationRecord 时序、万文件性能与三主题几何分别由 `tests/unit/link-suggest.test.ts`、`tests/visual/scenes/wikilink-suggestion.spec.ts` 和 Rust `wikilink_suggestion_full_path_round_trip_matrix` 覆盖。

截图 `00-keyboard-candidates` 用于 Alex 抽审浮层是否被裁切；不声称 AX 能读出浮层几何。场景会修改合成 vault 中文档的内存态但不保存，磁盘 `wikilink-suggestion-source.md` 必须始终保持基线；`no-such-note-xyz.md` 不得出现。目标文件只读，创建仍归既有显式 ⌘⏎ 动作，不由候选触发。
