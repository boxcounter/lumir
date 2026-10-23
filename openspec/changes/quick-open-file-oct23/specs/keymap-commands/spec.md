# keymap-commands 增量规格

> 起草注记（非规格正文）：本 delta 一条 ADDED，基线是 living spec
> [openspec/specs/keymap-commands/spec.md](../../../../specs/keymap-commands/spec.md)。新增一条**有
> 默认绑定**的全局命令（快速打开），形态与「侧栏开关命令与默认键位」「界面语言切换命令」同构：
> 命令 id 进 `NON_TAB_GLOBAL_COMMAND_IDS`、默认键位单段无空白、可经 `[keys]` 重绑 / 解绑、键位
> 占用三条独立来源核实。输入面与解析语义在 `quick-open` capability，本增量只锁定**键位层**的合同。

## ADDED Requirements

### Requirement: 快速打开命令与默认键位

按路径快速打开文件 SHALL 由统一键位表分发**同一条**全局命令 `app.quick-open`（能力与输入面见
`quick-open` 的「快速打开的唤起与输入面」），MUST NOT 拆成「打开输入面」「打开文件」两条命令，
也 MUST NOT 存在第二条唤起通路（裸 window 监听、编辑器 keymap、原生菜单项）。该命令 SHALL 进
`NON_TAB_GLOBAL_COMMAND_IDS`（作用域因此机械派生为 `global`——焦点在编辑器、文件树、搜索框、
浮层或 harness composer 内时同样命中），MUST NOT 取 `editor.` 前缀。命令实现 SHALL 落在装配层。

默认键位 SHALL 是 `⌘P`。该命令有默认绑定，因此 SHALL NOT 登记进 `KEYLESS_COMMAND_IDS`；绑定
SHALL 附来由说明（表即文档）。键位占用 SHALL 由三条独立来源核实并写进实现说明：① 表内
（`src/keys.ts` 即真源，现表无 `Cmd-p`；`⌘O` 已归 `vault.switcher`、`⌘F` 已归 `app.search-open`、
`⌘⇧O` 已归 `toc.toggle`）；② 原生菜单 accelerator 集合（tauri 2.12.4 的 `Menu::default()` 在
macOS 上 File 子菜单只有 `CloseWindow`，muda 0.20.0 的预置加速键表里没有 `KeyP`；本应用自建菜单项
只有 `⌘Q`）；③ 系统级 / webview 层（macOS 不把 ⌘P 预置为系统菜单键；打印是应用自建的菜单项，本
应用没有打印能力）——第 ③ 条的 webview 层结论 SHALL 由真机按键断言复核，MUST NOT 只凭推理落章。

绑定写法 SHALL 与运行期事件 token 同源（`Cmd-p`：单段、无空白、无 Alt，按字符判定即可），用户
SHALL 能用 `[keys]` 重绑 / 解绑；重绑后原键 MUST NOT 再唤起，解绑后键位面板 SHALL 显示该命令未
绑定并给出成因说明。MUST NOT 采用含空白的多段 chord 作默认键位（那会让用户无法重绑——`[keys]`
的覆盖层至今拒绝多段 chord，见本 capability「键位配置覆盖」与「界面语言切换命令」的同款判词）。

输入面自己的键（`Enter` / `Escape` / `⌃G` / `↑` / `↓` / `⌃N` / `⌃P`）MUST NOT 进 `KEY_BINDINGS`：
表内一个 token 只能有一条绑定，且输入框持焦时事件目标在浮层里（不在编辑器内容区内），`editor` /
`text` 作用域的绑定不命中；这些键由输入面就地消费，两处不构成同一物理键的第二条分发路径。
`⌘P` 本身是 chord，分发器的可编辑宿主守卫只拦无修饰键的打字键，因此输入面打开期间再按 `⌘P`
仍会到达命令层——命令实现 SHALL 把这一态处理成「收起输入面」。

#### Scenario: 默认键位在三处焦点下命中

- **WHEN** 焦点分别在编辑器内容区、文件树条目、harness composer 内各按一次 `⌘P`
- **THEN** 三处都打开快速打开的输入面（`global` 作用域与焦点无关）；输入面打开时再按一次
  `⌘P` 收起

#### Scenario: 可重绑与解绑

- **WHEN** 在 `[keys]` 里把 `app.quick-open` 重绑到另一组合，或把它解绑
- **THEN** 重绑后新组合生效、`⌘P` 不再唤起；解绑后 `⌘P` 无操作，键位面板里该命令显示未绑定并
  给出成因说明

#### Scenario: 三项对账不放松

- **WHEN** 对账 `COMMAND_IDS` / `KEY_BINDINGS` / `KEYLESS_COMMAND_IDS` 三者
- **THEN** 新命令有默认绑定、不在默认不绑键清单里；清单内容除既有条目外与新增前一致（无孤儿
  命令、清单与绑定表无交集）

#### Scenario: 无第二条分发通路

- **WHEN** 检查键位表与装配层
- **THEN** 快速打开只经 `app.quick-open` 一条命令分发；MUST NOT 存在裸 window 监听、原生菜单项或
  Tauri 预置项承担同一动作
