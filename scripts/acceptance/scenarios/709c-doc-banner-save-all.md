---
id: "709c-doc-banner-save-all"
item: 709
tier: full
title: 文档备份失败横幅——「全部保存」后内容进 vault、写失败子条件清除、横幅撤下
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
    text: "PERSIST-SAVE-ALL"
    expect:
      - label: 输入已生效
        editor: { has: "PERSIST-SAVE-ALL" }
  - name: 等备份失败
    do: sleep
    ms: 4000
    expect:
      - label: 前提：写失败子条件在场
        ax: { has: "全部保存" }
  - name: 点「全部保存」
    do: click
    target: { role: AXButton, name: "全部保存" }
  - name: 等保存落地
    do: sleep
    ms: 1200
    expect:
      - shot: 全部保存之后
      - label: 内容已进 vault（横幅没有把保存说成失败）
        file: { path: plain.md, has: "PERSIST-SAVE-ALL" }
      - label: 路径转 clean ⇒ 写失败子条件清除
        ax: { not: "无法为 1 份未保存的文档写入崩溃备份" }
      - label: 没有枚举失败子条件 ⇒ 横幅整体撤下（动作钮一并离场）
        ax: { not: "全部保存" }
---

说明：按 design §5.6 的清空语义——**写失败子条件 = 该路径的 dirty 内容未得到备份**；保存成功
后该路径不再需要备份，继续留横幅等于「没有风险却在报警」。本场景不预置恢复目录的枚举失败，
因此写失败子条件清空后横幅应当撤下（两个子条件都清除）。保存失败时横幅保留的对照见 709d。
