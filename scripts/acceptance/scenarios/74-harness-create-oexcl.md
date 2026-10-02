---
id: "74-harness-create-oexcl"
item: 74
title: Harness ⑤ vault_create O_EXCL：撞名不覆盖、新名落盘（change add-harness-probe，mock provider）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-create.json"
steps:
  - name: 记下既有文件的基线（sha256 + mtime）
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
    keys: ["m", "a", "k", "e", "i", "t"]
  - name: 发送
    do: key
    key: enter

  - name: 等第一个批准闸（撞名新建 harness-note.md）
    do: waitFor
    waitFor:
      has: ["HNC-SHOULD-NOT-LAND 不应落盘"]
    expect:
      - label: 批准闸标题在场（create 也是写类工具，默认 ask）
        ax: { has: "vault_create 请求修改文件，采纳后才落盘：" }
      - shot: 01-撞名闸

  - name: 采纳撞名新建（O_EXCL 必须在执行期拒掉）
    do: click
    target: { role: AXButton, name: "^采纳$", nth: 0 }

  - name: 等撞名被拒 + 第二个批准闸（新名 harness-created.md）出现
    do: waitFor
    waitFor:
      has: ["fs_already_exists", "+HNC-NEW 新建落盘内容。"]
    expect:
      - label: 撞名新建被 O_EXCL 拒掉（错误回送模型）
        ax: { has: "/error · fs_already_exists/" }
      - label: 第二个闸的 diff 预览在场
        ax: { has: "+HNC-NEW 新建落盘内容。" }
      - shot: 02-撞名被拒

  - name: 采纳第二个闸（nth 1：第一张卡的按钮已禁用但仍在 transcript 里）
    do: click
    target: { role: AXButton, name: "^采纳$", nth: 1 }

  - name: 等循环收尾
    do: waitFor
    waitFor:
      has: ["新建完成。"]
    expect:
      - label: 既有文件内容逐字节不变（撞名新建没覆盖它）
        file: { path: harness-note.md, unchangedSince: before }
      - label: 既有文件 mtime 未推进
        file: { path: harness-note.md, mtimeUnchangedSince: before }
      - label: 新文件落盘
        file: { path: harness-created.md, exists: true }
      - label: 新文件内容正确
        file: { path: harness-created.md, has: "HNC-NEW 新建落盘内容。" }
      - label: JSONL 记下撞名失败
        file: { path: "env:harness/*.jsonl", has: "fs_already_exists" }
      - shot: 03-新建完成
---

spec 判据（harness「工具循环」+ design §4 vault_create）：新建文档 O_EXCL 不覆盖既有
文件——撞名时既有文件逐字节不变（内容 + mtime 双判据），错误回送模型后循环继续；
换用新名后正常落盘。fixture 把「撞名 → 被拒 → 换名 → 成功」编在同一轮工具循环里。
