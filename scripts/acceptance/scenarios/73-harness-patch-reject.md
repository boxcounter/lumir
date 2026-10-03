---
id: "73-harness-patch-reject"
item: 73
title: Harness ④ patch 批准闸：拒绝不落盘（change add-harness-probe，mock provider）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-patch.json"
steps:
  - name: 记下基线（sha256 + mtime）
    do: record
    as: before
    file: harness-note.md

  - name: ⌘⇧A 唤起面板
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 面板出现
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问并 Enter 发送
    do: keys
    keys: ["p", "a", "t", "c", "h", "i", "t"]
  - name: 发送
    do: key
    key: enter

  - name: 等批准闸出现
    do: waitFor
    waitFor:
      has: ["vault_patch 请求修改文件，采纳后才落盘："]
    expect:
      - label: 批准闸在场（本场景拒绝闸的正观测）
        ax: { has: "vault_patch 请求修改文件，采纳后才落盘：" }
      - shot: 01-批准闸

  - name: 点击拒绝
    do: click
    target: { role: AXButton, name: "^拒绝$" }

  - name: 等循环收尾（拒绝回送模型 → 最终回答）
    do: waitFor
    waitFor:
      has: ["第二行处理完了。"]
    expect:
      - label: 工具终态是 rejected（细分状态进 summary）
        ax: { has: "/rejected · approval_rejected/" }
      - label: 拒绝后磁盘内容逐字节不变
        file: { path: harness-note.md, unchangedSince: before }
      - label: 拒绝后 mtime 也未推进（「不落盘」双判据）
        file: { path: harness-note.md, mtimeUnchangedSince: before }
      - label: 编辑器里仍是旧文本
        editor: { has: "HNL-BETA 第二行，等待 patch。" }
      - label: JSONL 记下拒绝结果
        file: { path: "env:harness/*.jsonl", has: "approval_rejected" }
      - shot: 02-拒绝后
---

spec 判据（harness「权限机制 · 采纳与拒绝」的拒绝侧）：拒绝则磁盘逐字节不变，模型收到
对应结果。fixture 与场景 72 共用同一份（harness-mock-patch.json）——同一个 patch 提案，
72 采纳、73 拒绝，两侧判据互斥。
