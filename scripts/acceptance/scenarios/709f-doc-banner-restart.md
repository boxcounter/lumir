---
id: "709f-doc-banner-restart"
item: 709
tier: full
title: 文档备份失败横幅——重启不凭旧状态弹写失败，再次编辑并等满窗口后重现
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
    text: "PERSIST-RESTART"
    expect:
      - label: 输入已生效
        editor: { has: "PERSIST-RESTART" }
  - name: 等备份失败
    do: sleep
    ms: 4000
    expect:
      - label: 前提：写失败子条件在场
        ax: { has: "无法为 1 份未保存的文档写入崩溃备份" }

  - name: 硬停机后重启
    do: restart
    expect:
      - shot: 重启后现场
      - label: 写失败子条件不持久化：重启本身不凭旧状态弹写失败横幅
        ax: { not: "无法为 1 份未保存的文档写入崩溃备份" }
      - label: 枚举失败是**当前**失败（recovery 仍是普通文件）⇒ 横幅以该文案在场
        ax: { has: "无法检查残留备份" }

  - name: 重启后再编辑一次
    do: clickEditor
    dy: 6
  - name: 输入新内容
    do: type
    text: "-AGAIN"
    expect:
      - label: 重启恢复出磁盘上那份文档（前提；未保存内容本来就不在磁盘上）
        editor: { has: "第一行内容" }
      - label: 新输入已生效（落点由重启后的光标位置决定，不要求与旧串相邻）
        editor: { has: "-AGAIN" }
  - name: 等新的备份 debounce 到期（重试不静默）
    do: sleep
    ms: 4000
    expect:
      - shot: 再次失败之后
      - label: 写失败子条件按真实重试重新出现
        ax: { has: "无法为 1 份未保存的文档写入崩溃备份" }
      - label: 枚举失败仍在
        ax: { has: "无法检查残留备份" }
---

说明：失败集合只在内存、不跨重启（design §5.7）。重启后不凭旧状态伪造写失败子条件；枚举
失败是**重启后仍真实存在**的失败（`recovery` 普通文件还在），因此它照常在场——这两条同框
出现正是「重启不静默」与「不持久化伪造」的分界。用户再编辑一次、等满备份窗口，写失败子条件
由**真实重试**重新出现，不是从磁盘旧状态复活。
