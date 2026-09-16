---
id: "08c-crash-recovery"
item: 8
title: 崩溃恢复——启动提示双动作与「恢复内容」
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: 制造「未保存且自动保存已暂停」的现场（冲突待决 → 落崩溃备份）
    do: clickEditor
    dy: 6
  - name: 输入待恢复内容
    do: type
    text: "CRASH-RECOVER-ME"
    expect:
      - label: 输入已进入编辑器
        editor: { has: "CRASH-RECOVER-ME" }
  - name: 外部改写造成冲突待决（自动保存转写崩溃备份）
    do: vaultWrite
    file: plain.md
    content: "# 纯文本基线\n\n外部版本。\n"
  - name: 等崩溃备份落盘
    do: sleep
    ms: 4000
    expect:
      - shot: 待决现场
      - label: 前提成立：进入「外部修改待决」态（自动保存暂停）
        ax: { has: "/检测到外部修改|保留我的版本/" }
      - label: 隔离配置目录下出现崩溃备份文件（app 自己写的）
        glob: { dir: "env:recovery", pattern: ".*", min: 1 }
  - name: 硬停机（模拟崩溃）
    do: restart
    expect:
      - shot: 重启后现场
      - label: 启动时发现残留崩溃备份并提示
        ax: { has: "崩溃备份" }
      - label: 提示给出「恢复内容」动作
        ax: { has: "恢复内容" }
      - label: 提示给出「丢弃备份」动作
        ax: { has: "丢弃备份" }
  - name: 点「恢复内容」
    do: click
    target: { role: AXButton, name: "恢复内容" }
    expect:
      - shot: 恢复内容之后
      - label: 崩溃前的未保存内容回到编辑器
        editor: { has: "CRASH-RECOVER-ME" }
      - label: 给出恢复反馈
        ax: { has: "已恢复未保存内容" }
---

说明：崩溃备份的触发口径是「dirty 且自动保存暂停（冲突/外部修改待决/目标丢失）」。本场景先制造
冲突待决使自动保存停手，等备份落进隔离的 `$XDG_CONFIG_HOME/lumir/recovery/`（glob 断言），再重启 app
复现「启动发现残留备份」。两个动作按钮（恢复内容/丢弃备份）都要在提示里出现；「丢弃备份」路径见 08d。

注意：备份文件是本套件在**真实流程**里产生的（不是手工塞的假数据），断言的是 app 自己写的产物。
