---
id: "709d-doc-banner-save-failure"
item: 709
tier: full
title: 文档备份失败横幅——保存失败时横幅保留，并给出既有保存失败反馈
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: 占住恢复目录并制造 dirty 内容
    do: envWrite
    file: "recovery"
    content: "这不是目录：占住 lumir/recovery，让崩溃备份写入失败。"
  - name: 键入
    do: clickEditor
    dy: 6
  - name: 输入内容
    do: type
    text: "PERSIST-SAVE-CONFLICT"
    expect:
      - label: 输入已生效
        editor: { has: "PERSIST-SAVE-CONFLICT" }
  - name: 等备份失败
    do: sleep
    ms: 4000
    expect:
      - label: 前提：写失败子条件在场
        ax: { has: "全部保存" }
  - name: 从外部改写磁盘（dirty 文档 ⇒ 冲突待决，不静默重载）
    do: vaultWrite
    file: plain.md
    content: "# 外部改写\n\n磁盘上的版本已被外部程序修改。\n"
  - name: 留一拍让 watch 分流完成（dirty 文档不静默重载）
    do: sleep
    ms: 800
    expect:
      - label: 前提：外部改写没有静默覆盖内存内容
        editor: { has: "PERSIST-SAVE-CONFLICT" }
  - name: 点「全部保存」（保存必失败：CAS 冲突）
    do: click
    target: { role: AXButton, name: "全部保存" }
  - name: 等失败反馈落地
    do: sleep
    ms: 1000
    expect:
      - shot: 保存失败之后
      - label: 横幅保留（该路径的 dirty 内容仍未得到备份）
        ax: { has: "无法为 1 份未保存的文档写入崩溃备份" }
      - label: 既有保存失败反馈点名冲突处置（保存失败不等于备份失败被洗白）
        ax: { has: "保存冲突" }
      - label: 内容没有写入磁盘（保存失败如实保留风险）
        file: { path: plain.md, not: "PERSIST-SAVE-CONFLICT" }
---

说明：横幅的写失败子条件按路径清空，**保存失败不清**——保存失败时该路径仍是「dirty 内容
未得到备份」，横幅必须保留，并加上既有的保存失败反馈（冲突提示带「强制覆盖保存 / 重新载入」
两个动作）。`vaultWrite` 从外部改写磁盘是真实可达的 CAS 冲突来源（watch 事件流），不是假注入。
