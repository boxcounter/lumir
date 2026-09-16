---
id: "search-02-binding"
item: 10
title: 搜索键位可重绑（config.json 的 keys 表）
fixtures: [search-probe.md]
open: search-probe.md
marker: "NEEDLE"
config:
  keys: { "Cmd-f": null, "Cmd-g": "app.search-open" }
steps:
  - name: 解绑 ⌘F 后按 ⌘F 不应打开搜索
    do: clickEditor
    dy: 6
    expect:
      - label: 隔离配置已生效（配置写入环境）
        file: { path: env:config.json, exists: true }
      - label: 文档已装载
        editor: { has: "NEEDLE" }
  - name: 按 ⌘F（已被配置解绑）
    do: key
    key: "cmd+f"
    expect:
      - label: 解绑后 ⌘F 不打开搜索 panel
        ax: { not: "上一个" }
      - shot: cmd-f-解绑后
  - name: 按 ⌘G（配置重绑到 app.search-open）
    do: key
    key: "cmd+g"
    expect:
      - label: 重绑后 ⌘G 打开搜索 panel
        ax: { has: "上一个" }
      - shot: cmd-g-重绑后
  - name: Esc 关闭搜索 panel
    do: key
    key: "escape"
    expect:
      - label: 搜索 panel 已关闭
        ax: { not: "上一个" }
  - name: ⌘/ 打开键位面板（确认重绑后键位表本身仍是完整可读的）
    do: key
    key: "cmd+/"
    expect:
      - label: 键位面板已打开
        ax: { has: "键位（生效中）" }
      - label: 面板列出首屏分组（生效表照常渲染）
        ax: { has: "移动与选择" }
      - shot: 键位面板
---

说明：这条覆盖「⌘F 可经 `config.json` 的 `[keys]` 重绑」：解绑后 ⌘F 不响应，重绑到 ⌘G 后响应，
走的都是 keys.ts 的统一键位层（`applyKeyOverrides` 的产物）。配置走隔离的 `XDG_CONFIG_HOME`
（`config:` front-matter 由套件写成隔离 config.json 并重启 app），绝不动用户的 `~/.config/lumir`。

**「describe-bindings 面板里能看到这条绑定」为什么不在这里断言**：键位面板的可滚区域在真机 AX
里只暴露首屏（实测 AX dump 被 `fanout_cap` 截断在「移动与选择」组），而 `app.search-open` 归在
最后一组「全局」——套件没有滚动动作，断言它必然假 FAIL。这条改由 chromium 侧
`tests/visual/scenes/m133-describe-bindings.spec.ts` 覆盖：它遍历 `COMMAND_IDS` 断言每个命令的行
都可见，而 `app.search-open` 已进 `COMMAND_IDS`；本场景只负责真机上的**重绑语义**。
