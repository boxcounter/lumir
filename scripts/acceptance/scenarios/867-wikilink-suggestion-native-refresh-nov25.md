---
id: "867-wikilink-suggestion-native-refresh-nov25"
item: 867
tier: full
title: 行内 [[ 候选：原生逐字输入立即打开、query 逐拍同步、逐字删除关闭
fixtures: [native-home.md, d/Alpha.md, d/Beta.md, d/sigma.md, d/source.md]
open: native-home.md
marker: "native candidate fixture"
steps:
  - name: 建立正文焦点，避免每拍输入前重点击而关闭再重开候选
    do: focusWindow
    click: true

  - name: 记录源文档磁盘基线
    do: record
    file: native-home.md
    as: 源文档基线

  - name: 全选 fixture 正文，准备逐字原生输入
    do: key
    key: "cmd+a"
    channel: cgevent

  - name: 第一个 [ 不构成 opener
    do: keys
    keys: ["["]
    expect:
      - label: 候选 listbox 未打开
        node: { role: AXList, name: 筛选, present: false }

  - name: 第二个 [ 形成完整 opener，立即显示当前空 query 候选
    do: keys
    keys: ["["]
    expect:
      - label: 候选 listbox 已打开
        node: { role: AXList, name: 筛选, present: true }
      - label: 空 query 含 Alpha
        node: { role: AXStaticText, name: "^d/Alpha\\.md$", present: true }
      - label: 空 query 含 Beta
        node: { role: AXStaticText, name: "^d/Beta\\.md$", present: true }
      - label: 空 query 含 sigma
        node: { role: AXStaticText, name: "^d/sigma\\.md$", present: true }
      - label: 空 query 含 source
        node: { role: AXStaticText, name: "^d/source\\.md$", present: true }
      - label: 空 query 含当前笔记
        node: { role: AXStaticText, name: "^native-home\\.md$", present: true }
      - label: 打开候选不改写磁盘
        file: { path: native-home.md, unchangedSince: 源文档基线, mtimeUnchangedSince: 源文档基线 }
      - shot: 00-empty-query

  - name: 输入 s，候选不得停留在空 query 的上一代 items
    do: keys
    keys: ["s"]
    expect:
      - label: query=s 时 sigma 在前、source 在后
        ax: { scope: { role: AXList, name: 筛选 }, order: ["d/sigma.md", "d/source.md"] }
      - label: Alpha 不含 s 且不再候选
        node: { role: AXStaticText, name: "^d/Alpha\\.md$", present: false }
      - label: Beta 不含 s 且不再候选
        node: { role: AXStaticText, name: "^d/Beta\\.md$", present: false }
      - label: 当前 query 落在正文
        editor: { has: "[[s" }
      - label: 过滤不写磁盘
        file: { path: native-home.md, unchangedSince: 源文档基线, mtimeUnchangedSince: 源文档基线 }
      - shot: 01-query-s

  - name: 再输入 i，候选同步收窄到 sigma
    do: keys
    keys: ["i"]
    expect:
      - label: query=si 只剩 sigma
        ax: { scope: { role: AXList, name: 筛选 }, order: ["d/sigma.md"] }
      - label: source 不含 si 且不再候选
        node: { role: AXStaticText, name: "^d/source\\.md$", present: false }
      - label: 当前 query 落在正文
        editor: { has: "[[si" }

  - name: 删除 i，恢复 query=s 的候选代际
    do: key
    key: "backspace"
    expect:
      - label: 删除后 sigma 与 source 按既有分层恢复
        ax: { scope: { role: AXList, name: 筛选 }, order: ["d/sigma.md", "d/source.md"] }
      - label: Alpha 仍不得复活
        node: { role: AXStaticText, name: "^d/Alpha\\.md$", present: false }

  - name: 删除 s，恢复空 query 候选
    do: key
    key: "backspace"
    expect:
      - label: Alpha 恢复为空 query 候选
        node: { role: AXStaticText, name: "^d/Alpha\\.md$", present: true }
      - label: Beta 恢复为空 query 候选
        node: { role: AXStaticText, name: "^d/Beta\\.md$", present: true }
      - label: sigma 与 source 仍在
        ax: { scope: { role: AXList, name: 筛选 }, order: ["d/sigma.md", "d/source.md"] }

  - name: 再删除一个 [，opener 不完整必须关闭并清掉旧候选
    do: key
    key: "backspace"
    expect:
      - label: 候选 listbox 已关闭
        node: { role: AXList, name: 筛选, present: false }
      - label: 旧 Alpha 候选不残留
        node: { role: AXStaticText, name: "^d/Alpha\\.md$", present: false }
      - label: 旧 sigma 候选不残留
        node: { role: AXStaticText, name: "^d/sigma\\.md$", present: false }
      - label: 正文只剩单 [
        editor: { has: "[" }
      - label: 整个原生序列零隐式落盘
        file: { path: native-home.md, unchangedSince: 源文档基线, mtimeUnchangedSince: 源文档基线 }
---

# 867 — wikilink 候选的原生事务同步

本场景专门复现 Alex 2026-11-25 的 0.16.0 实测序列。每拍只输入一个可打印字符或一次 Backspace，不在拍间重新点击编辑器；因此旧实现中「首次打开后插件被禁用、后续继续显示上一代候选」不能被关闭再重开的路径掩盖。

`d/` 在文件树中保持折叠，候选行则显示完整路径。`d/Alpha.md` 等负向判据因此只可能来自候选，不会命中文件树 basename 或 fixture 正文。`native-home.md` 与 `d/` 均不含 `s`，query=s 的正向候选只有 `d/sigma.md` 与 `d/source.md`；sigma 属 stem 前缀层，source 属完整路径子串层，顺序同时守住既有分层。

本 worker 只执行静态校验。真实 WKWebView 由主会话运行：

```bash
node scripts/acceptance/run.mjs 867-wikilink-suggestion-native-refresh-nov25
```

场景修改合成 vault 的内存文档但不保存；`native-home.md` 的磁盘字节与 mtime 必须始终等于基线。候选接受、创建文件、IME、完整路径与扩展名语义归既有 866 及浏览器回归，本场景不扩展这些行为。
