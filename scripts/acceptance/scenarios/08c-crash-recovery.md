---
id: "08c-crash-recovery"
item: 8
title: 崩溃恢复——启动提示双动作与「恢复内容」
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: 制造「dirty 且不按 ⌘S」的现场（崩溃备份有自己的触发，见正文）
    do: clickEditor
    dy: 6
  - name: 输入待恢复内容
    do: type
    text: "CRASH-RECOVER-ME"
    expect:
      - label: 输入已进入编辑器
        editor: { has: "CRASH-RECOVER-ME" }
  - name: 等崩溃备份自己的 debounce 到期（停止输入满 2s + 裕量）
    do: sleep
    ms: 4000
    expect:
      - shot: 备份现场
      - label: 隔离配置目录下出现崩溃备份文件（app 自己写的）
        glob: { dir: "env:recovery", pattern: ".*", min: 1 }
      - label: 前提成立：vault 内的文件没被改写（写盘只由 ⌘S 触发，备份 ≠ 保存）
        file: { path: plain.md, not: "CRASH-RECOVER-ME" }
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
      - label: 恢复后仍是未保存态（内容只在内存里，写盘归用户的 ⌘S）
        ax: { has: "（未保存）" }
  - name: 按 ⌘S 落盘恢复出来的内容（⌘S 发两次换一次丢键的容错）
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对「恢复 → 保存」闭环（本场景是崩溃链路唯一的端到端场景）
    do: sleep
    ms: 1200
    expect:
      - label: 磁盘文件含恢复出来的内容（编辑器缓冲与磁盘一致）
        file: { path: plain.md, has: "CRASH-RECOVER-ME" }
      - label: 保存成功 ⇒ 该路径的崩溃备份被清除（下次启动不再追问）
        glob: { dir: "env:recovery", pattern: ".*", exact: 0 }
      - label: dirty 收窄
        ax: { not: "（未保存）" }
---

说明：崩溃备份的触发口径（M278，change `remove-autosave`）是**自有 debounce**——dirty 之后停止
输入满一个窗口（2s）就写一份，不再依附自动保存的失败分支（自动保存已整条移除）。本场景因此不再需要
「造冲突让自动保存停手」那一步：键入后等满窗口，备份落进隔离的 `$XDG_CONFIG_HOME/lumir/recovery/`
（glob 断言 + 「vault 内文件未被改写」的反向对照），再重启 app 复现「启动发现残留备份」。两个动作
按钮（恢复内容/丢弃备份）都要在提示里出现；「丢弃备份」路径见 08d。

注意：备份文件是本套件在**真实流程**里产生的（不是手工塞的假数据），断言的是 app 自己写的产物。

**末段三步是「不静默丢失未保存内容」的端到端闭环**（M278 tasks §7.7 的链路，agent 在真机上跑）：
编辑 → 不按 `⌘S` → 等备份 debounce → 强杀（`restart`）→ 重启 → 「恢复内容」→ `⌘S` → 磁盘内容与
恢复内容一致、备份清空。链路里**没有任何一步依赖自动保存**（它已整条移除），写盘只发生在用户按下
`⌘S` 的那一刻——这正是本 change 要保住的那条不变量。
