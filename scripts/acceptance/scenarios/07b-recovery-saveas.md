---
id: "07b-recovery-saveas"
item: 7
title: M124 恢复路径之二——文件被外部删除后「另存为」
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: 制造「保存时目标已不存在」
    do: type
    text: "MEM-EDIT-2"
    expect:
      - label: 内存改动已进入缓冲
        editor: { has: "MEM-EDIT-2" }
  - name: 外部删除磁盘文件
    do: vaultWrite
    file: plain.md
    content: ""
    expect:
      - label: 磁盘文件已被清空（模拟外部删除/移动）
        file: { path: plain.md, exists: true }
  - name: 保存
    do: key
    key: "cmd+s"
    expect:
      - shot: 保存失败提示
      - label: 内存改动仍在编辑器里（未丢失）
        editor: { has: "MEM-EDIT-2" }
---

说明：这条路径的判据是「内存改动不丢 + 出现恢复动作」。`fs_not_found` 分支的 toast 文案与
「另存为新文件」按钮 label 见 openspec fs-io spec；磁盘侧应产生 `plain-恢复.md`（再撞名
`-2`…`-5`）。本场景只钉前两个可稳定观测的点，另存产物的落盘断言留待首次实跑后按真机文案补齐。
