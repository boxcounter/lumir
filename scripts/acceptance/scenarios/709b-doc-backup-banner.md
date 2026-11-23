---
id: "709b-doc-backup-banner"
item: 709
tier: full
title: 文档崩溃备份写失败——文档区 sticky 横幅可见且不伪装成保存失败
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: 在首次备份之前占住恢复目录（普通文件 ⇒ 备份目录创建必失败）
    do: envWrite
    file: "recovery"
    content: "这不是目录：占住 lumir/recovery，让崩溃备份写入失败。"
  - name: 制造 dirty 内容
    do: clickEditor
    dy: 6
  - name: 输入待备份内容
    do: type
    text: "PERSIST-BACKUP-FAIL"
    expect:
      - label: 输入已进入编辑器
        editor: { has: "PERSIST-BACKUP-FAIL" }
  - name: 等崩溃备份自己的 debounce 到期（停止输入满 2s + 裕量）
    do: sleep
    ms: 4000
    expect:
      - shot: 备份失败横幅
      - label: 文档区出现写失败子条件（含受影响数与首个路径）
        ax: { has: "无法为 1 份未保存的文档写入崩溃备份" }
      - label: 横幅点名首个受影响路径
        ax: { has: "首个：plain.md" }
      - label: 写失败子条件给出「全部保存」动作（复用 saveAllDirty）
        ax: { has: "全部保存" }
      - label: 备份失败 ≠ 保存失败：vault 内文件未被改写（写盘只由 ⌘S 触发）
        file: { path: plain.md, not: "PERSIST-BACKUP-FAIL" }
---

说明：真实可达的失败面。`envWrite` 在**隔离配置目录**（`<env>/lumir/recovery`）写一个普通
文件——app 的备份链路随后要创建 `<recovery>/<vault-key>/` 目录，`create_dir_all` 在「父级是
普通文件」时必然失败；这不是假注入，而是磁盘上真实存在的错误形态（目录被同名的外部文件占住）。
写入发生在首次备份 debounce 之前（键入前），因此失败在备份到期时**第一次**就出现。

横幅的两个子条件里，本场景只触发写失败：`recovery_list` 在 vault 装载时已经成功过，不会在
备份失败后自动重跑，所以枚举失败子条件不在场。`vault 内文件未被改写` 是「备份 ≠ 保存」的
反向对照——横幅只说备份失败，不得暗示保存失败。
