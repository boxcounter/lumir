# keymap-commands 增量规格

> 起草注记（非规格正文）：本 delta 只加一个入口命令。设置面板本身的形态、内容与写通道归
> `settings` capability，本 delta 不重复定义。

## ADDED Requirements

### Requirement: 设置面板入口（app.settings-open）

应用 SHALL 提供命令 `app.settings-open`，作用域 `global`，默认绑定 `⌘,`。该命令 SHALL 进
`KEY_BINDINGS` 与 `GLOBAL_COMMAND_IDS`，因此 `[keys]` 配置 SHALL 能像其余命令一样对它重绑或
解绑；其 `doc` 字段 SHALL 写明默认键位的来由与冲突核对。键位占用 SHALL 由三条独立来源核实并
写进实现说明：① 表内（`src/keys.ts` 为真源，现表无 `Cmd-,`；`Ctrl-,` 亦未占用，二者是不同
token）；② 原生菜单 accelerator 集合（tauri `Menu::default()` 的 app 子菜单只含 About /
Services / Hide / HideOthers / ShowAll / Quit，无 Preferences 项；自建项只有 `CmdOrCtrl+Q`）；
③ 系统级（`⌘,` 是 macOS 的「设置」约定键，不是被系统菜单预占的组合）。

命令实现 SHALL 落在装配层（`src/main.ts`），打开 / 关闭同一个设置面板（打开态再触发即关闭，
与 `app.describe-bindings` 同一条开合语义）。

应用菜单 SHALL 增加「设置…」项，点击 SHALL 经既有 `MENU_COMMAND_EVENT` 交回前端同一命令层
执行。该菜单项 MUST NOT 自带 accelerator：菜单若占 `⌘,`，`[keys]` 重绑之后原键仍会经菜单
触发，等于第二套键位——与 Undo / Redo 菜单项让出 `⌘Z` 同一条纪律。菜单结构假设不成立时
SHALL 整体跳过该项并留下可诊断的告警，MUST NOT 静默产生半改造的菜单。

面板的关闭键（`Escape`）SHALL 由面板在模态遮罩上就地消费，MUST NOT 为同一物理组合在统一
键位表之外注册第二条分发绑定（与键位查看面板同一纪律）。

#### Scenario: 默认键位开合

- **WHEN** 设置面板关闭时按 `⌘,`，再按一次 `⌘,`
- **THEN** 第一次打开面板，第二次关闭面板；关闭后焦点回到打开前的元素

#### Scenario: 可重绑与解绑

- **WHEN** 在 `[keys]` 里把 `app.settings-open` 重绑到另一组合，或把它解绑
- **THEN** 重绑后新组合生效、`⌘,` 不再打开设置；解绑后 `⌘,` 无操作，键位面板（`⌘/`）里该
  命令显示「未绑定」并给出成因；菜单项仍在，点击照常打开面板（菜单不承担键位语义）

#### Scenario: 菜单与命令层同源

- **WHEN** 点击应用菜单「设置…」
- **THEN** 打开同一个设置面板（与 `⌘,` 同一命令实现）；菜单项本身没有 accelerator，
  `[keys]` 重绑后菜单点击行为不变、原键不再触发

#### Scenario: 菜单结构变化时降级

- **WHEN** tauri 升级后 app 子菜单结构不再匹配既有假设
- **THEN** 「设置…」项整体跳过、菜单保持默认结构，并输出可诊断告警；`⌘,` 与命令仍可用
