---
id: "36-restyle-content"
item: 36
title: restyle 内容面真机呈现：doc-title 块（fm 后正文前 + meta 三要素）、callout 双段标签、文件树目录 chevron 与选中行
fixtures: [callout.md]
open: callout.md
marker: "Callout 正文第一行"
steps:
  - name: doc-title 块在场（fm 文档）：标题 + meta 行（行数 · 修改于）
    do: settle
    expect:
      - label: meta 行的「N 行 · 修改于 M月D日」段暴露进 AX（doc-title 块在真机 WKWebView 下渲染）
        ax: { has: "/行 · 修改于 /" }
      - label: 编辑器装载正常（doc-title 是纯插入 widget，不动文档文本）
        editor: { has: "Callout 正文第一行" }
      - shot: doc-title-块

  - name: callout 双段标签（C7）：中文类型名 + 自定义标题在场，源码标记被替换
    do: settle
    expect:
      - label: zh 段「笔记」在场（[!note] 的中文类型标签）
        ax: { has: "笔记" }
      - label: 自定义标题「提示标题」在场
        ax: { has: "提示标题" }
      - label: 反向：源码标记 [!note] 不出现在编辑器文本（widget 替换，不是源码透显）
        editor: { not: "[!note]" }
      - shot: callout-双段标签

  - name: 造一个真目录（vaultWrite 嵌套路径）让文件树出现 chevron 行
    do: vaultWrite
    file: restyle-dir/note-in-dir.md
    content: "# 目录内文档\n\n供 chevron 对齐核对。\n"
    expect:
      - label: 嵌套文件落盘（harness 支持嵌套 vaultWrite）
        file: { path: restyle-dir/note-in-dir.md, has: "目录内文档" }

  - name: 重启让文件树重扫（watch 不拾取外部新建目录，finding 20260925-worker-fix-closeout-bug-watch）
    do: restart

  - name: 目录行进树并展开：chevron 与选中行的对齐留读数
    do: settle
    expect:
      - label: 目录行 restyle-dir 在文件树（重启后全量重扫把新目录带进来）
        ax: { has: "restyle-dir" }

  - name: 点开目录行：chevron 旋转展开、子文件行出现（缩进对齐的观感归截图）
    do: click
    target: { name: "restyle-dir" }
    expect:
      - label: 子文件行 note-in-dir.md 出现（目录真的展开了）
        ax: { has: "note-in-dir.md" }
      - shot: 树-chevron-展开

  - name: 选中目录内文件：chevron 列与选中行的几何读数（AX dump 带 bbox，逐条可核）
    do: open
    file: restyle-dir/note-in-dir.md
    marker: "目录内文档"
    expect:
      - label: 目录内文档已装载
        editor: { has: "目录内文档" }
      - shot: 树-chevron-选中行

  - name: 清理嵌套文件（目录本身由 resetVault 的目录清理带走的口径见 README）
    do: vaultRm
    file: restyle-dir/note-in-dir.md
    expect:
      - label: 嵌套文件已删（不给后续场景留树残留）
        file: { path: restyle-dir/note-in-dir.md, exists: false }
---

# restyle 内容面真机呈现（restyle 追加修复批 M221）

## 这个场景验什么

1. **doc-title 块在真机 WKWebView 下渲染**：fm 文档的标题（basename 去扩展名）+ meta 行
   （路径 · 行数 · 修改于，本 fixture 在 vault 根、路径段省略）。机器判据只钉「meta 段进 AX」
   与「编辑器照常装载」；24px/680/1.28/-0.012em 与「fm 后正文前」的位置判据由 chromium 场景
   `tests/visual/scenes/doc-title.spec.ts` 守（计算属性层），真机只留截图供 Alex 抽审。
2. **callout 双段标签（C7）**：zh 类型名 + 自定义标题都在场、源码 `[!note]` 不透显。
   双段的字号/字重/族色（12.5px/650 + 13px/550）由 chromium 场景 `callout.spec.ts` 守。
3. **文件树目录 chevron**：真目录行（vaultWrite 嵌套路径造出，随后 restart 让树重扫）的
   chevron 槽位、展开旋转与选中行缩进对齐——AX dump 的 bbox 是读数证据，对齐观感归 Alex
   抽审（手感/审美不下沉）。

## 已知边界

- vaultWrite 的嵌套路径支持（mkdirp）与 resetVault 的目录清理由本场景同 PR 引入
  （`scripts/acceptance/lib/`）：目录不跨场景残留。
- **watch 不拾取外部新建目录**：vaultWrite 落盘后文件树 60s 内不出现新目录，重启 app 才可见
  （finding `20260925-worker-fix-closeout-bug-watch`）。本场景在 vaultWrite 后插一步
  `do: restart` 绕行；产品修复后应删掉这步并恢复「watch 增量刷新」判据。
- chevron 的 0.12s 旋转过渡、对齐像素级观感不进机器判据（同 13-toc 的手感项口径）。
