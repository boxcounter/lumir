---
id: "236-keybindings-capture"
item: 236
title: 键位速查——按键捕获（Home → 真实 when 绑定、被捕获的键不执行命令、⌃G 例外、无绑定空态）
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: 建立编辑器焦点并记录文档基线
    do: clickEditor
    dy: 6
    expect:
      - label: 文档已装载（正向锚点）
        editor: { has: "纯文本基线" }
  - name: 记录文档基线
    do: recordEditor
    as: beforeCapture
    expect:
      - label: 基线非空
        editor: { has: "纯文本基线" }

  - name: 注入前把窗口带到前台
    do: focusWindow

  - name: 正向对照：面板关闭时 ⇧⌘T 真的切主题（light → dark）
    do: key
    key: "cmd+shift+t"
    expect:
      - label: 主题从 light 切到 dark（键真的执行了命令）
        ax: { has: "主题：dark（点击切换）" }
      - label: 反向：light 不再是指示钮文案
        ax: { not: "主题：light（点击切换）" }
      - shot: 面板外-shift-cmd-t-切主题

  - name: 等主题写回落盘（切换是异步写回，先等磁盘事实）
    do: waitForFile
    waitForFile:
      path: "env:config.json"
      has: '"theme": "dark"'
    timeoutMs: 10000
  - name: 记录主题写回后的配置基线（面板打开期间 AX 读不到 modeline，改用磁盘事实作判据）
    do: record
    as: themeDark
    file: "env:config.json"

  - name: ⌘/ 打开键位速查
    do: key
    key: "cmd+/"
    expect:
      - label: 面板打开
        ax: { has: "键位速查（生效中）" }

  - name: 点「捕获按键」进入等待态
    do: click
    target: { any: "捕获按键" }
    expect:
      - label: 等待态提示在场
        ax: { has: "按下组合键…（Esc 取消）" }
      - shot: 捕获等待态

  - name: 按下 Home
    do: key
    key: home
    expect:
      - label: 已捕获 Home
        ax: { has: "已捕获" }
      - label: 定位到真实带 when 的绑定 editor.widget-scroll-home
        ax: { has: "块滚动到开头" }
      - label: 行内条件短徽标来自 whenShortKey
        ax: { has: "仅块滚动" }
      - label: 作用于编辑器作用域
        ax: { has: "编辑器" }
      - label: 捕获计数
        ax: { has: "按键 Home · 命中 1" }
      - shot: 捕获-Home

  - name: Esc 只清除捕获，面板保持打开
    do: key
    key: escape
    expect:
      - label: 面板仍在
        ax: { has: "键位速查（生效中）" }
      - label: 捕获态已清（回到全量计数）
        ax: { has: "71 条命令 · 11 组" }
      - shot: 清除捕获后

  - name: 等待态 ⌃G 被当作待查询的键（唯一例外：不关闭面板）
    do: click
    target: { any: "捕获按键" }
    expect:
      - label: 再次进入等待态
        ax: { has: "按下组合键…（Esc 取消）" }
  - name: 按 ⌃G
    do: key
    key: "ctrl+g"
    expect:
      - label: 面板没被 ⌃G 关掉（否则 ⌃G 永远无法反查）
        ax: { has: "键位速查（生效中）" }
      - label: 捕获结果是 keyboard-quit（取消选择）
        ax: { has: "取消选择" }
      - shot: 捕获-ctrl-g
  - name: Esc 清除捕获
    do: key
    key: escape
    expect:
      - label: 回到全量
        ax: { has: "71 条命令 · 11 组" }

  - name: 无绑定的键给空态（F12 不在键位表里）
    do: click
    target: { any: "捕获按键" }
    expect:
      - label: 等待态
        ax: { has: "按下组合键…（Esc 取消）" }
  - name: 按 F12
    do: key
    key: f12
    expect:
      - label: 无绑定空态
        ax: { has: "没有命令使用这个键位" }
      - shot: 捕获-F12-空态

  - name: 反向判据：已捕获态按 ⇧⌘T，主题不得再变
    do: key
    key: escape
    expect:
      - label: 清掉 F12 捕获
        ax: { has: "71 条命令 · 11 组" }
  - name: 进入捕获并按下 ⇧⌘T
    do: click
    target: { any: "捕获按键" }
    expect:
      - label: 等待态
        ax: { has: "按下组合键…（Esc 取消）" }
  - name: 按下 ⇧⌘T
    do: key
    key: "cmd+shift+t"
    expect:
      - label: 被捕获的键不执行命令：主题配置没有被再次写回（面板打开期间 modeline 不在 AX 树里，判据取磁盘事实）
        file: { path: "env:config.json", unchangedSince: themeDark, mtimeUnchangedSince: themeDark }
      - label: 捕获结果展示该键的字形
        ax: { has: "⇧⌘T" }
      - shot: 捕获-shift-cmd-t-不切主题

  - name: Esc 清捕获、再 Esc 关闭
    do: key
    key: escape
    expect:
      - label: 清捕获后面板仍在
        ax: { has: "键位速查（生效中）" }
  - name: 关闭面板
    do: key
    key: escape
    expect:
      - label: 面板关闭
        ax: { not: "键位速查（生效中）" }
      - label: 捕获全程文档逐字节不变
        editor: { unchangedSince: beforeCapture }
      - label: 关闭后读 modeline：主题仍是 dark（被捕获的 ⇧⌘T 从未执行）
        ax: { has: "主题：dark（点击切换）" }
      - label: 反向：eink 未出现
        ax: { not: "主题：eink（点击切换）" }
      - shot: 关闭后

  - name: "[keys] 解绑 app.describe-bindings 后 ⌘/ 不再打开面板"
    do: configWrite
    keys: { "Cmd-/": null }
    expect:
      - label: 解绑写入隔离配置（配置即数据）
        file: { path: "env:config.json", has: '"Cmd-/"' }
  - name: 按已解绑的 ⌘/
    do: focusWindow
    expect:
      - label: 编辑器仍可读（正向锚点）
        editor: { has: "纯文本基线" }
  - name: 注入 ⌘/
    do: key
    key: "cmd+/"
    expect:
      - label: 解绑后 ⌘/ 不再打开面板
        ax: { not: "键位速查（生效中）" }
      - shot: 解绑后-cmd-slash-无面板
---

# 键位速查：按键捕获（change improve-keybindings-lookup-oct24）

## 这个场景验什么

1. **describe-key**：点「捕获按键」→ 按 `Home` → 定位到真实带 `when` 的
   `editor.widget-scroll-home`（标签「块滚动到开头」、短徽标「仅块滚动」、作用域「编辑器」）。
2. **被捕获的键不执行命令**（反向判据）：面板外按 `⇧⌘T` 主题真的切到 dark；捕获态按同一个键，
   主题仍是 dark、没有切到 eink。这条判据有区分度——只有「捕获路径真的消费了按键」才成立。
3. **等待态 ⌃G 例外**：⌃G 在这个状态下被当作待查询的键（否则永远无法反查），面板不关；
   捕获结果是 `editor.keyboard-quit`（取消选择）。
4. **无绑定空态**：F12 不在表里 → 「没有命令使用这个键位」。
5. **文档逐字节不变**：捕获全程不移动光标、不修改文档（关闭后与基线比较）。

## 已知边界（如实登记）

- **`Home` 的正面执行面未验**：块级横滚容器持焦时 `Home` 真的滚动容器，但 WKWebView 的 AX 输出
  不暴露容器的 `scrollLeft`，套件没有可机判的读数。捕获态的「键确实到达面板」由本场景的映射与
  计数判据证明；「面板外同键真的执行」用 `⇧⌘T` 这条同机制、可读副作用（主题 + modeline 文案）作
  代表，不把 Home 的滚动面写成已验。
- **菜单入口与 `[keys]` 重绑后的菜单路径未验**：macOS 菜单栏在 AX 通道点不到（14-tabs / 45 同
  口径）。本场景只验「解绑 ⌘/ 后键位路径失效」（前半条），菜单手术由 Rust 单测 + 视觉场景的
  `fireMenuCommand` 覆盖。
- 捕获结果的行密度 / 字形观感归 Alex dogfood；`shot` 只作证据。
