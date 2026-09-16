---
id: "08e-force-overwrite"
item: 8
title: 强制覆盖——二次确认，以及覆盖后再次冲突仍给同一组动作
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: 聚焦并输入
    do: clickEditor
    dy: 6
  - name: 输入会被强制覆盖的内容
    do: type
    text: "FORCE-MINE"
    expect:
      - label: 输入已进入编辑器
        editor: { has: "FORCE-MINE" }
  - name: 外部改写磁盘
    do: vaultWrite
    file: plain.md
    content: "# 纯文本基线\n\n外部版本。\n"
  - name: 保存触发冲突
    do: key
    key: "cmd+s"
    expect:
      - shot: 冲突提示
      - label: 冲突提示给出强制覆盖动作
        ax: { has: "强制覆盖" }
  - name: 点「强制覆盖保存」
    do: click
    target: { role: AXButton, name: "强制覆盖保存" }
    expect:
      - shot: 二次确认
      - label: 出现不可撤销的二次确认文案
        ax: { has: "/不可撤销|确认强制覆盖/" }
      - label: 二次确认给出「覆盖保存」动作
        ax: { has: "覆盖保存" }
  - name: 确认覆盖
    do: click
    target: { role: AXButton, name: "覆盖保存" }
    expect:
      - shot: 覆盖之后
      - label: 磁盘已被内存内容覆盖
        file: { path: plain.md, has: "FORCE-MINE" }
      - label: 给出强制覆盖成功反馈
        ax: { has: "已强制覆盖保存" }
  - name: 再次外部改写并保存——应再次给出同一组冲突动作
    do: vaultWrite
    file: plain.md
    content: "# 纯文本基线\n\n外部版本第二轮。\n"
  - name: 第二轮保存
    do: key
    key: "cmd+s"
    expect:
      - shot: 第二轮冲突
      - label: 覆盖后再冲突仍给「强制覆盖」动作（动作没被用掉）
        ax: { has: "强制覆盖" }
      - label: 第二轮冲突时磁盘仍是外部版本（未被静默覆盖）
        file: { path: plain.md, has: "外部版本第二轮" }
---

说明：backlog 项 8 的「强制覆盖再冲突的双动作」= 覆盖路径的二次确认（不可撤销提示）+ 覆盖动作
可重复使用。断言落在两处硬事实：① 覆盖后磁盘内容确为内存版本；② 第二轮冲突仍给出同一组动作且
磁盘未被静默覆盖。
