## ADDED Requirements

### Requirement: 字号步进命令与默认键位

字号步进 SHALL 由统一键位表分发三条全局命令：`view.text-scale-up`、`view.text-scale-down`、
`view.text-scale-reset`。三者 SHALL 进 `NON_TAB_GLOBAL_COMMAND_IDS`（作用域因此机械派生为 `global`——
焦点在左栏 / 搜索框 / 浮层 / 面板里时同样命中），MUST NOT 取 `editor.` 前缀（本仓 `editor.` 前缀 =
编辑器作用域命令，前缀与作用域 MUST NOT 互相打脸）。命令实现 SHALL 落在装配层，能力（运行期字号真源
与施加）SHALL 落在编辑器模块。

默认键位 SHALL 是 mac 惯例的一组：`⌘=` 与 `⌘+`（同一物理键的两种字符形态）→ `view.text-scale-up`、
`⌘−` → `view.text-scale-down`、`⌘0` → `view.text-scale-reset`。四条绑定 SHALL 各自附来由说明（表即
文档）；同一命令有多条绑定是表内既有形态（撤销命令既有两条别名），不构成冲突。三条命令默认都有绑定，
因此 `KEYLESS_COMMAND_IDS` SHALL 保持不变（MUST NOT 把它们登记为「默认不绑键」）。

键位占用 SHALL 由三条独立来源核实并写进实现说明：① 表内（`src/keys.ts` 即真源，无 `Cmd-=` /
`Cmd-+` / `Cmd--` / `Cmd-0`）；② 原生菜单 accelerator 集合（muda 的预置项 = ⌘C / ⌘X / ⌘V / ⌘Z / ⇧⌘Z /
⌘A / ⌘M / ⌃⌘F / ⌘H / ⌥⌘H / ⌘W / ⌘Q，不含这三个键）；③ 系统级（三者不是 macOS 的预置菜单键）。

**键位通路唯一性**：MUST NOT 启用 Tauri 的 webview 缩放热键（`zoom_hotkeys_enabled`）——它在表外
自注册一条 keydown 通路、接管同一批键（`⌘=` / `⌘+` / `⌘−` / `⌘0`），且不出现在生效表与键位面板里、
不可由 `[keys]` 重绑。任何整体缩放能力（若将来立项）SHALL 经统一键位表的命令实现，MUST NOT 走该开关。

绑定写法 SHALL 与运行期事件 token 同源，并 SHALL 有单测钉住静默失配风险：减号键的 token 形态是
`Cmd--`（MUST NOT 写 `Cmd-Minus`——只有含 Alt 的组合才按物理键判定，写错形态不会报错、只会永远不命中）；
`⌘⇧=` 在真机上的字符形态归一到 `Cmd-+`。四条绑定 SHALL 都是单段、无空白，因此用户可用 `[keys]`
重绑 / 解绑（MUST NOT 采用含空白的多段 chord 作默认键位——那会让用户无法重绑）。

#### Scenario: 默认键位命中

- **WHEN** 焦点在编辑器内按 `⌘=`（或 `⌘+`）、按 `⌘−`、按 `⌘0`
- **THEN** 分别触发放大一档、缩小一档、回到配置字号——三条命令经统一分发器执行，行为与
  `typography` 的「字号步进的运行期口径」逐条一致

#### Scenario: 焦点不在编辑器内同样命中

- **WHEN** 焦点在左栏文件树（或键位面板 / 搜索框）上按 `⌘=`
- **THEN** 字号同样放大一档（作用域为 `global` 的绑定与焦点无关）

#### Scenario: 可重绑与解绑

- **WHEN** 在 `[keys]` 里把 `⌘=` 重绑到别的键、或把 `⌘0` 解绑
- **THEN** 重绑后新键生效、原键不再触发放大；解绑后该命令在键位面板里显示为未绑定并给出成因说明
  （既有面板口径），其余两条命令不受影响

#### Scenario: 键位通路唯一

- **WHEN** 在默认配置下检查生效表与运行期按键通路
- **THEN** `⌘=` / `⌘+` / `⌘−` / `⌘0` 各只有一条归属（统一键位表），页面上不存在第二处消费同一批键的
  监听（Tauri 的 webview 缩放热键未启用）；键位面板如实列出这四条绑定

#### Scenario: 无孤儿命令对账不变

- **WHEN** 对账 `COMMAND_IDS` / `KEY_BINDINGS` / `KEYLESS_COMMAND_IDS` 三者
- **THEN** 三条新命令都有默认绑定、不在默认不绑键清单里；清单内容与新增前一致（三项对账的判据不放松）
