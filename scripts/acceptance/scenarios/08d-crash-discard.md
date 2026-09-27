---
id: "08d-crash-discard"
item: 8
title: 崩溃恢复——「丢弃备份」动作
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: 制造崩溃备份现场
    do: clickEditor
    dy: 6
  - name: 输入会被丢弃的内容
    do: type
    text: "CRASH-DISCARD-ME"
    expect:
      - label: 输入已生效
        editor: { has: "CRASH-DISCARD-ME" }
  - name: 等崩溃备份自己的 debounce 到期（停止输入满 2s + 裕量）
    do: sleep
    ms: 4000
    expect:
      - label: 崩溃备份已落盘
        glob: { dir: "env:recovery", pattern: ".*", min: 1 }
      - label: 前提成立：vault 内的文件没被改写（写盘只由 ⌘S 触发，备份 ≠ 保存）
        file: { path: plain.md, not: "CRASH-DISCARD-ME" }
  - name: 硬停机后重启
    do: restart
    expect:
      - shot: 重启后现场
      - label: 提示含「丢弃备份」动作
        ax: { has: "丢弃备份" }
  - name: 点「丢弃备份」
    do: click
    target: { role: AXButton, name: "丢弃备份" }
    expect:
      - shot: 丢弃备份之后
      - label: 给出丢弃反馈
        ax: { has: "已丢弃崩溃备份" }
      - label: 崩溃内容未被恢复进编辑器
        editor: { not: "CRASH-DISCARD-ME" }
---

说明：与 08c 同一现场生成路径（dirty 后等崩溃备份自己的 debounce 到期），只换动作——验证「丢弃
备份」确实丢弃（反馈文案 + 内容没进编辑器），而不是与「恢复内容」共用一条实现。两条动作分开成场景，
避免一个场景里连续两次重启把现场搞混。
