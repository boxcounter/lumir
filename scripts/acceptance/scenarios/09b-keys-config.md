---
id: "09b-keys-config"
item: 9
title: "「keys」配置实操——重绑与解绑"
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
config:
  keys: { "Cmd-s": null, "Ctrl-s": "document.save" }
steps:
  - name: 解绑 ⌘S 后按 ⌘S
    do: clickEditor
    dy: 6
    expect:
      - label: 隔离配置已生效（配置写入环境）
        file: { path: env:config.json, exists: true }
  - name: 输入可识别内容并尝试 ⌘S
    do: type
    text: "KEYSCFG"
    expect:
      - label: 输入已进入编辑器
        editor: { has: "KEYSCFG" }
  - name: 按 ⌘S（已解绑）
    do: key
    key: "cmd+s"
    expect:
      - shot: cmd-s-解绑后
      - label: 解绑后 ⌘S 不触发保存（无「已保存」toast）
        ax: { not: "已保存" }
  - name: 改用 ⌃S（重绑到 document.save）
    do: key
    key: "ctrl+s"
    expect:
      - shot: ctrl-s-重绑后
      - label: 重绑后 ⌃S 触发保存
        ax: { has: "/已保存|已自动保存/" }
---

说明：配置走隔离的 `XDG_CONFIG_HOME`，绝不动用户的 `~/.config/lumir`；`keys` 表的形状校验在
`src-tauri/src/config.rs`，命令 id 合法性由前端键位层判定（未知命令只进 console，无 UI 出口，
backlog 记录在案）。注意：解绑 ⌃ 系键后 macOS 原生文本系统可能接手（如 ⌃K →
`deleteToEndOfLine:`）——这是「解绑 ≠ 关闭能力」的已知口径，本场景只验 ⌘S/⌃S 这一对。
