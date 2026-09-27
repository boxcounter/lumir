# keymap-commands 增量规格

## ADDED Requirements

### Requirement: 界面语言切换命令（view.language-cycle）

界面语言切换 SHALL 由统一键位表分发一条全局命令：`view.language-cycle`（在 `zh` / `en` 两档之间切换，行为定义见 `ui-language` 的「运行期语言切换与单一施加点」与「语言切换入口与指示钮」）。它 SHALL 进 `NON_TAB_GLOBAL_COMMAND_IDS`（作用域因此机械派生为 `global`——焦点在左栏 / 搜索框 / 浮层 / 面板里时同样命中），MUST NOT 取 `editor.` 前缀（本仓 `editor.` 前缀 = 编辑器作用域命令，前缀与作用域 MUST NOT 互相打脸）。命令实现 SHALL 落在装配层（`src/main.ts`），并与 modeline 的语言指示钮共用同一条实现路径。

默认键位 SHALL 是 `⌘⇧L`（语义取「L = Language」；⌘ 系归 mac 惯例），绑定 SHALL 附来由说明（表即文档）。键位占用 SHALL 由三条独立来源核实并写进实现说明：① 表内（`src/keys.ts` 即真源，⌘⇧ 系现有 `Cmd-Shift-z`（重做）、`Cmd-Shift-o`（`toc.toggle`）与 `Cmd-Shift-T`（`view.theme-cycle`）三条，`Cmd-Shift-L` 不在其中）；② 原生菜单 accelerator 集合（muda 预置项 = ⌘C / ⌘X / ⌘V / ⌘Z / ⇧⌘Z / ⌘A / ⌘M / ⌃⌘F / ⌘H / ⌥⌘H / ⌘W / ⌘Q，不含 ⌘⇧L）；③ 系统级（⌘⇧L 不是 macOS 预置菜单键）。该命令默认有绑定，因此 `KEYLESS_COMMAND_IDS` SHALL 保持不变（MUST NOT 把它登记为「默认不绑键」）。

绑定写法 SHALL 与运行期事件 token 同源（`Cmd-Shift-L`），且 SHALL 是单段、无空白——用户可用 `[keys]` 重绑 / 解绑（MUST NOT 采用含空白的多段 chord 作默认键位，那会让用户无法重绑）。

#### Scenario: 默认键位命中

- **WHEN** 焦点在编辑器内按 `⌘⇧L`
- **THEN** 语言在 `zh` / `en` 之间切换，经统一分发器执行，行为与 `ui-language` 的「运行期语言切换与单一施加点」一致

#### Scenario: 焦点不在编辑器内同样命中

- **WHEN** 焦点在左栏文件树（或键位面板 / 搜索框 / 浮层）上按 `⌘⇧L`
- **THEN** 语言同样切换（作用域为 `global` 的绑定与焦点无关）

#### Scenario: 可重绑与解绑

- **WHEN** 在 `[keys]` 里把 `⌘⇧L` 重绑到别的键、或把 `view.language-cycle` 解绑
- **THEN** 重绑后新键生效、原键不再触发切换；解绑后该命令在键位面板里显示为未绑定并给出成因说明（既有面板口径）；modeline 的语言指示钮仍然可用（它是另一条同源入口）

#### Scenario: 无孤儿命令对账不变

- **WHEN** 对账 `COMMAND_IDS` / `KEY_BINDINGS` / `KEYLESS_COMMAND_IDS` 三者
- **THEN** 新命令有默认绑定、不在默认不绑键清单里；清单内容除新增这一条外与新增前一致（三项对账的判据不放松）
