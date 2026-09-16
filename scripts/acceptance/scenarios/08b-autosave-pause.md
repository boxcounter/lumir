---
id: "08b-autosave-pause"
item: 8
title: 冲突期自动保存暂停——待决冲突期间不得回写磁盘
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: 聚焦并输入未保存内容
    do: clickEditor
    dy: 6
  - name: 输入
    do: type
    text: "PAUSE-PROBE"
    expect:
      - label: 输入已进入编辑器
        editor: { has: "PAUSE-PROBE" }
  - name: 外部改写磁盘（制造冲突前提）
    do: vaultWrite
    file: plain.md
    content: "# 纯文本基线\n\n外部版本。\n"
    expect:
      - label: 磁盘已是外部版本
        file: { path: plain.md, has: "外部版本" }
  - name: 保存触发冲突
    do: key
    key: "cmd+s"
    expect:
      - shot: 冲突提示
      - label: 进入冲突待决态
        ax: { has: "保存冲突" }
  - name: 记录冲突待决时的磁盘基线
    do: record
    as: atConflict
    file: plain.md
    expect:
      - label: 已记下磁盘基线
        file: { path: plain.md, exists: true }
  - name: 冲突待决期间继续输入（纯键盘，避免点击把 sticky toast 点掉）
    do: keys
    keys: ["m", "o", "r", "e"]
    expect:
      - label: 追加输入已生效
        editor: { has: "MORE" }
  - name: 等足够久（远超 2s 去抖）
    do: sleep
    ms: 7000
    expect:
      - label: 冲突待决期间自动保存已暂停——磁盘 sha256 未变
        file: { path: plain.md, unchangedSince: atConflict }
      - label: 磁盘仍是外部版本（没有被内存内容强行覆盖）
        file: { path: plain.md, has: "外部版本" }
      - label: 内存中的改动未丢
        editor: { has: "PAUSE-PROBE" }
      - label: 冲突提示仍在（待决未消解）
        ax: { has: "保存冲突" }
      - shot: 暂停验证之后
---

说明：`save-controller` 的口径是「存在未决冲突/外部修改待决/目标丢失时自动保存暂停，不硬冲 CAS」。
本场景的判据是**磁盘事实**：冲突提出后记录一次 sha256，跨过 2s 去抖再等 7s，磁盘必须逐字节不变。
若自动保存没有暂停（硬写），`unchangedSince` 与「磁盘仍是外部版本」两条会同时 FAIL——不存在假绿路径。
「暂停无用户感知」是 backlog 已记录的产品 finding，本场景不判它。
