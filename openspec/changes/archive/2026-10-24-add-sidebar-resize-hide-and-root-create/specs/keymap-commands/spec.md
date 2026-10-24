# keymap-commands 增量规格

> 起草注记（非规格正文）：本 delta 一条 ADDED，基线是 living spec
> [openspec/specs/keymap-commands/spec.md](../../../../../specs/keymap-commands/spec.md)。新增一条有默认
> 绑定的全局命令（侧栏开关），形态与「字号步进命令与默认键位」同构：命令 id 进
> `NON_TAB_GLOBAL_COMMAND_IDS`、默认键位单段无空白、可经 `[keys]` 重绑 / 解绑、键位占用三条独立
> 来源核实。几何与焦点语义在 `ui-design-system` 的「应用骨架布局」，本增量只锁定**键位层**的合同。

## ADDED Requirements

### Requirement: 侧栏开关命令与默认键位

侧栏的收起与展开 SHALL 由统一键位表分发**同一条**命令 `view.toggle-sidebar`（一次按下 = 切换当前
状态：可见则收起、收起则展开），MUST NOT 拆成「显示」「隐藏」两条命令。该命令 SHALL 进
`NON_TAB_GLOBAL_COMMAND_IDS`（作用域因此机械派生为 `global`——焦点在编辑器、文件树、搜索框、浮层
或 harness composer 内时同样命中），MUST NOT 取 `editor.` 前缀。命令实现 SHALL 落在装配层，收起 /
展开的几何与焦点语义见 `ui-design-system` 的「应用骨架布局」（本增量不重复定义）。

默认键位 SHALL 是 `⌘B`。该命令有默认绑定，因此 SHALL NOT 登记进 `KEYLESS_COMMAND_IDS`；绑定 SHALL
附来由说明（表即文档）。键位占用 SHALL 由三条独立来源核实并写进实现说明：① 表内（`src/keys.ts`
即真源，现表无 `Cmd-b`；`Ctrl-b` 是 `editor.cursor-backward`，作用域 `text`，与 ⌘ 系不构成同一物理
组合）；② 原生菜单 accelerator 集合（`Menu::default()` 的预置项里唯一被截获的 ⌘ 系项是 `CloseWindow`
的 ⌘W，自建项只有 ⌘Q）；③ 系统级（macOS 不给 ⌘B 预置系统菜单项）。

绑定写法 SHALL 与运行期事件 token 同源（`Cmd-b`：单段、无空白，无 Alt，因此按字符判定即可，
MUST NOT 写成需要物理键判定的形态），用户 SHALL 能用 `[keys]` 重绑 / 解绑；重绑后原键 MUST NOT
再触发切换，解绑后键位面板 SHALL 显示该命令未绑定并给出成因说明。

#### Scenario: 默认键位在任意焦点下往返切换

- **WHEN** 侧栏可见时按 ⌘B（焦点分别在编辑器、文件树条目、harness composer 内各测一次）
- **THEN** 侧栏收起；再按一次 ⌘B 侧栏展开并回到收起前的宽度——三处焦点下行为一致（`global` 作用域）

#### Scenario: 可重绑与解绑

- **WHEN** 在 `[keys]` 里把 `view.toggle-sidebar` 重绑到另一组合，或把它解绑
- **THEN** 重绑后新组合生效、⌘B 不再切换；解绑后 ⌘B 无操作，键位面板里该命令显示未绑定并给出成因
  说明

#### Scenario: 不产生第二条分发通路

- **WHEN** 检查键位表与装配层
- **THEN** 侧栏切换只经 `view.toggle-sidebar` 一条命令分发；MUST NOT 存在裸 window 监听、原生菜单项
  或 Tauri 预置开关承担同一动作（同一物理键只有一条绑定是表的不变量）
