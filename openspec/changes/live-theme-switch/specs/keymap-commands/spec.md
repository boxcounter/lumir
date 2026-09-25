## ADDED Requirements

### Requirement: 主题切换命令（view.theme-cycle）

主题切换 SHALL 由统一键位表分发一条全局命令：`view.theme-cycle`（循环 light → dark → eink →
light，行为定义见 `ui-design-system` 的「三主题与主题选择」）。它 SHALL 进
`NON_TAB_GLOBAL_COMMAND_IDS`（作用域因此机械派生为 `global`——焦点在左栏 / 搜索框 / 浮层 /
面板里时同样命中），MUST NOT 取 `editor.` 前缀（本仓 `editor.` 前缀 = 编辑器作用域命令，
前缀与作用域 MUST NOT 互相打脸）。命令实现 SHALL 落在装配层（`src/main.ts`）。

默认键位 SHALL 是 `⌘⇧T`（语义取「T = Theme」；⌘ 系归 mac 惯例），绑定 SHALL 附来由说明
（表即文档）。键位占用 SHALL 由三条独立来源核实并写进实现说明：① 表内（`src/keys.ts` 即
真源，⌘⇧ 系现有 ⇧⌘Z（重做）与 ⇧⌘O（toc.toggle）两条，⌘⇧T 不在其中）；② 原生菜单 accelerator 集合（muda 的预置项 = ⌘C / ⌘X /
⌘V / ⌘Z / ⇧⌘Z / ⌘A / ⌘M / ⌃⌘F / ⌘H / ⌥⌘H / ⌘W / ⌘Q，不含 ⌘⇧T）；③ 系统级（⌘⇧T 不是
macOS 的预置菜单键；浏览器「重开标签页」语义不适用于本应用）。该命令默认有绑定，因此
`KEYLESS_COMMAND_IDS` SHALL 保持不变（MUST NOT 把它登记为「默认不绑键」）。

绑定写法 SHALL 与运行期事件 token 同源（`Cmd-Shift-T`），且 SHALL 是单段、无空白——用户可
用 `[keys]` 重绑 / 解绑（MUST NOT 采用含空白的多段 chord 作默认键位，那会让用户无法重绑）。

#### Scenario: 默认键位命中

- **WHEN** 焦点在编辑器内按 `⌘⇧T`
- **THEN** 主题按 light → dark → eink 循环切到下一档，经统一分发器执行，行为与
  `ui-design-system` 的「运行期切换即时生效」一致

#### Scenario: 焦点不在编辑器内同样命中

- **WHEN** 焦点在左栏文件树（或键位面板 / 搜索框）上按 `⌘⇧T`
- **THEN** 主题同样切换一档（作用域为 `global` 的绑定与焦点无关）

#### Scenario: 可重绑与解绑

- **WHEN** 在 `[keys]` 里把 `⌘⇧T` 重绑到别的键、或把 `view.theme-cycle` 解绑
- **THEN** 重绑后新键生效、原键不再触发切换；解绑后该命令在键位面板里显示为未绑定并给出
  成因说明（既有面板口径）

#### Scenario: 无孤儿命令对账不变

- **WHEN** 对账 `COMMAND_IDS` / `KEY_BINDINGS` / `KEYLESS_COMMAND_IDS` 三者
- **THEN** 新命令有默认绑定、不在默认不绑键清单里；清单内容与新增前一致（三项对账的判据
  不放松）
