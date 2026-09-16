---
id: "08-autosave"
item: 8
title: 自动保存 2s 落盘 / 冲突期暂停 / 崩溃恢复
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: 记录落盘基线
    do: record
    as: before
    file: plain.md
    expect:
      - label: 基线文件存在
        file: { path: plain.md, exists: true }
  - name: 聚焦编辑器（真实点击建立渲染层焦点）
    do: clickEditor
    dy: 6
  - name: 输入内容（触发 autosave 去抖）
    do: type
    text: "AUTOSAVE-PROBE"
    expect:
      - label: 输入已进入编辑器缓冲
        editor: { has: "AUTOSAVE-PROBE" }
  - name: 等待自动保存（去抖 2000ms）
    do: sleep
    ms: 5000
    expect:
      - label: 编辑器缓冲里仍有本次输入（未丢失）
        editor: { has: "AUTOSAVE-PROBE" }
      - label: 磁盘文件已被自动保存写入（sha256 变化）
        file: { path: plain.md, changedSince: before }
      - label: 磁盘内容确实包含本次输入
        file: { path: plain.md, has: "AUTOSAVE-PROBE" }
      - shot: 自动保存后
---

说明：`AUTOSAVE_DEBOUNCE_MS = 2000`（openspec fs-io spec）。本场景用**磁盘轮询断言**（sha256 +
内容）而非 toast 文案，避免 toast 存在时长影响判定。「冲突/外部修改期自动保存暂停」与「崩溃恢复
双动作」两个子行为依赖外部改文件与进程 kill，写在场景 07 与 07b（恢复路径）里，共用同一套
toast 字符串断言。
