---
id: "72-harness-patch-approve"
item: 72
title: Harness ③ patch 批准闸：采纳落盘、未触及部分逐字节不变、打开中会话同步（change add-harness-probe，mock provider）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-patch.json"
steps:
  - name: 记下 patch 前的磁盘基线（sha256 + mtime）
    do: record
    as: before
    file: harness-note.md

  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问并 Enter 发送
    do: keys
    keys: ["p", "a", "t", "c", "h", "i", "t"]
  - name: 发送
    do: key
    key: enter

  - name: 等批准闸出现（写类工具默认 ask，循环挂起）
    do: waitFor
    waitFor:
      has: ["vault_patch 请求修改文件，采纳后才落盘："]
    expect:
      - label: 批准闸标题在场
        ax: { has: "vault_patch 请求修改文件，采纳后才落盘：" }
      - label: diff 预览有删除行
        ax: { has: "-HNL-BETA 第二行，等待 patch。" }
      - label: diff 预览有新增行
        ax: { has: "+HNL-BETA 第二行，patch 已落盘。" }
      - label: 闸悬停期间磁盘逐字节不变（未采纳不落盘）
        file: { path: harness-note.md, unchangedSince: before }
      - shot: 01-批准闸

  - name: 点击采纳
    do: click
    target: { role: AXButton, name: "^采纳$" }

  - name: 等循环收尾（patch 落盘 + 最终回答）
    do: waitFor
    waitFor:
      has: ["第二行处理完了。"]
    expect:
      - label: 工具完成行可见
        ax: { has: "工具完成：vault_patch — 成功" }

  - name: 等打开中会话经 watch → 外部变更分流同步（留一拍再读）
    do: sleep
    ms: 1500
  - name: 界面落定
    do: settle
    expect:
      - label: 打开中的编辑器会话已同步到新内容
        editor: { has: "HNL-BETA 第二行，patch 已落盘。" }
      - label: 编辑器里旧文本已不在
        editor: { not: "等待 patch" }
      - label: 落盘内容 = 只换命中段、未触及部分逐字节不变（三行连续块整体断言）
        file: { path: harness-note.md, has: "HNL-ALPHA 第一行。\nHNL-BETA 第二行，patch 已落盘。\nHNL-GAMMA 第三行，不动。" }
      - label: 磁盘确实变了（与基线对比）
        file: { path: harness-note.md, changedSince: before }
      - label: JSONL 记下批准后的工具调用（decision=ask）
        file: { path: "env:harness/*.jsonl", has: '"decision":"ask","id":"call_p1","kind":"tool_call","name":"vault_patch"' }
      - shot: 02-采纳后
---

spec 判据（harness「权限机制 · 采纳与拒绝」的采纳侧 + fs-io「局部 patch 写入」）：
采纳前磁盘逐字节不变；采纳后 patch 按口径落盘——old_string 唯一命中替换、未触及部分
不变（用三行连续块断言：若未触及部分被动过，连续块必然断开）；被 patch 文件有打开中的
编辑器会话，经既有 watch → 会话刷新通路同步（本场景的编辑器从开头就开着
harness-note.md，且全程未手动编辑 = clean 会话，外部变更自动重载）。
