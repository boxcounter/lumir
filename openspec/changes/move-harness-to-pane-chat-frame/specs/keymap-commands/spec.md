# keymap-commands Specification Delta

## MODIFIED Requirements

### Requirement: 对话面板唤起命令（harness.toggle）

harness 对话面板的唤起 / 收起 SHALL 由统一键位表分发一条全局命令：`harness.toggle`（**在旁侧 pane 打开 / 收起 harness**——无第二 pane 时自动分栏、默认宽度比 harness:文档 pane = 1:2；已有第二 pane 时其文档标签并入另一 pane 后换位；行为定义见 `harness` 的「对话面板」、`pane-layout` 的「harness pane」与 `ui-design-system` 的「应用骨架布局」）。它 SHALL 进 `NON_TAB_GLOBAL_COMMAND_IDS`（作用域因此机械派生为 `global`——焦点在左栏 / 搜索框 / 浮层里时同样要能唤起；面板打开时焦点在面板输入框里，不在 contentDOM 内，再按 SHALL 能收起），MUST NOT 取 `editor.` 前缀（本仓 `editor.` 前缀 = 编辑器作用域命令，前缀与作用域 MUST NOT 互相打脸）。命令实现 SHALL 落在装配层（`src/main.ts`），并与标题栏的面板 toggle 钮共用同一条 toggle 路径。

默认键位 SHALL 是 `⌘⇧A`（语义取「A = Agent」；⌘ 系归 mac 惯例），绑定 SHALL 有一条来由说明——`docKey` 指向文案表 D345，文本本身归文案表。键位占用 SHALL 由三条独立来源核实并写进 D345 正文：① 表内（`src/keys.ts` 即真源，⌘⇧ 系现有 `Cmd-Shift-z`（重做）、`Cmd-Shift-o`（`toc.toggle`）、`Cmd-Shift-T`（`view.theme-cycle`）、`Cmd-Shift-L`（`view.language-cycle`）四条，`⌘⇧A` 不在其中）；② 原生菜单 accelerator 集合（muda 预置项，清单见 `src/keys.ts` 文件头 M149 段）不含 ⌘⇧A；③ 系统级（macOS 不预置 ⌘⇧A，Finder 的「应用程序」快捷键只在 Finder 窗口作用域）。该命令默认有绑定，因此 `KEYLESS_COMMAND_IDS` SHALL 保持不变（MUST NOT 把它登记为「默认不绑键」）。

绑定写法 SHALL 与运行期事件 token 同源（`Cmd-Shift-A`），且 SHALL 是单段、无空白——用户可用 `[keys]` 重绑 / 解绑（MUST NOT 采用含空白的多段 chord 作默认键位，那会让用户无法重绑）。

#### Scenario: 默认键位命中

- **WHEN** 焦点在编辑器内按 `⌘⇧A`
- **THEN** harness 在旁侧 pane 打开或收起（无第二 pane 时自动分栏），经统一分发器执行

#### Scenario: 焦点不在编辑器内同样命中

- **WHEN** 焦点在左栏文件树（或键位面板 / 搜索框 / 浮层 / 面板输入框）上按 `⌘⇧A`
- **THEN** 面板同样唤起 / 收起（作用域为 `global` 的绑定与焦点无关）

#### Scenario: 可重绑与解绑

- **WHEN** 在 `[keys]` 里把 `⌘⇧A` 重绑到别的键、或把 `harness.toggle` 解绑
- **THEN** 重绑后新键生效、原键不再触发切换；解绑后该命令在键位面板里显示为未绑定并给出成因说明（既有面板口径）；标题栏的面板 toggle 钮仍然可用（它是另一条同源入口）

#### Scenario: 无孤儿命令对账不变

- **WHEN** 对账 `COMMAND_IDS` / `KEY_BINDINGS` / `KEYLESS_COMMAND_IDS` 三者
- **THEN** `harness.toggle` 有默认绑定、不在默认不绑键清单里；三项对账的判据不放松
