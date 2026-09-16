---
id: "07c-external-reload"
item: 7
title: M124 恢复路径之三——外部修改且缓冲干净时自动重载
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: 干净缓冲下记录编辑器基线
    do: recordEditor
    as: clean
    expect:
      - label: 编辑器里是磁盘内容（无未保存改动）
        editor: { has: "第三行内容。" }
  - name: 外部改写磁盘文件
    do: vaultWrite
    file: plain.md
    content: "# 纯文本基线\n\n磁盘被外部改写，这一段只存在于磁盘。\n"
    expect:
      - label: 磁盘已按外部内容改写
        file: { path: plain.md, has: "只存在于磁盘" }
  - name: 等 watch 事件与自动重载
    do: sleep
    ms: 3500
    expect:
      - shot: 自动重载之后
      - label: 编辑器内容已被自动重载（不再是旧内容）
        editor: { not: "第三行内容。" }
      - label: 编辑器内容等于外部写入的新内容
        editor: { has: "只存在于磁盘" }
      - label: 给出自动重载反馈
        ax: { has: "自动重载" }
---

说明：外部修改的分支取决于缓冲是否 dirty——dirty 时给「重载（放弃我的修改）/保留我的版本」二选一，
**干净时自动重载**且不打扰用户。本场景走的是干净分支（不输入任何内容），断言编辑器文本被换成磁盘内容，
这是「自动重载真的发生」的直接证据；toast 文案是辅助证据（停留时长有限，故不作为唯一判据）。
