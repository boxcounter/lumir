# Proposal: 键位查看面板（app.describe-bindings，⌘/）

- Change ID: describe-bindings
- 日期: 2026-09-13
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

键位收敛成一张表（M131）并接上 `[keys]` 配置覆盖（M132）之后，表里有 40+ 条绑定、三条撤销键、若干同名物理键靠 `when` 条件分流；再加一层可重绑 / 解绑的配置，**「这个键现在归谁」已经不能靠翻源码回答**——生效表是「默认表经 `applyKeyOverrides` 处理后的产物」，默认表本身答不了配置过的问题。

Alex 的原话：「我想看一下 keybinding 列表时，怎么看？」「先做一个简单的。」

本 change 的定位因此是 **dogfood 期的自用查看器**：刻意简单，不是 UX 重设计的一部分，视觉从简。它只回答一个问题——**现在生效的键位是哪些、归谁、为什么是这个键**。左栏（tree / shell）的键盘支持与全产品焦点模型不在这里，记入 UX 重做会话。

## What Changes

1. **新命令 `app.describe-bindings`**（`global` 作用域，实现在装配层 `main.ts`），默认键 **`⌘/`**，进 `KEY_BINDINGS` 与 `GLOBAL_COMMAND_IDS`，因此 `[keys]` 可重绑 / 解绑。`⌘/` 的来由写在该条绑定的 `doc` 字段（表即文档），要点：macOS 的「帮助」菜单 accelerator 实为 `⇧⌘?`（`Cmd-?`，Apple 官方快捷键表列出 "Shift–Command–Question mark (?)：Open the Help menu"，信源 <https://support.apple.com/en-us/102650>），而本应用的原生菜单里有题为 `Help` 的子菜单（tauri 2.11.5 的 `Menu::default()` 建 `HELP_SUBMENU_ID`，`src/menu/menu.rs`；macOS 会把标题匹配 "Help" 的子菜单认作应用帮助菜单，`src/menu/submenu.rs` 的 `set_as_help_menu_for_nsapp` 文档注释），故 `⇧⌘?` 会先被系统 Help 菜单截获、到不了 webview，取 `⌘/` 这一简化形态；Emacs 的 `C-h b`（`describe-bindings`）不可用——`⌃H` 已被后删字符占用（macOS 文本系统的退格键位）。`[keys]` 可把该命令换到别的键或解绑，故键位偏好不锁死。
2. **面板列「生效中」的键位**：数据源是分发器真正在用的那份表（`applyKeyOverrides` 的产物），不是静态默认表；按功能分组（移动与选择 / 扩选 / 删除 / kill-yank / 翻屏 / 撤销 / widget / 全局），每条显示键位写法 + 该绑定的来由（`doc`）。
3. **没有键位指向的命令照样列出**：有实现但当前无任何绑定（被 `[keys]` 解绑）的命令 SHALL 标注「未绑定」——否则解绑之后该命令就从视野里消失，与「查看器」的目的相反。
4. **打开即见、关掉即走**：`⌘/` 切换（打开态再按即关）；`Escape`、`⌃G`、点击遮罩三条路径关闭；关闭后焦点交还编辑器。面板打开期间**编辑器作用域的键不得穿透到文档**（面板接管焦点，`editor` 作用域天然不命中——这条以场景验证，不靠假设）。
5. **视觉从简**：沿用现有排版基线与 CSS 变量，不引入新视觉语言（theme 重做前的占位实现，`style.css` 最小增量）。
6. **文案入册**：面板新增的用户可见文案（标题、分组标题、未绑定标注与行说明、关闭提示）按编号追加进 `文案-Copy.md`（D63–D67）。

## Non-goals

- **不做键位编辑 / 搜索 / 过滤**：面板是只读查看器。改键仍走 `~/.config/lumir` 的 `[keys]` 配置（ADR 0002 §5：配置即数据、人可读可改），本 change MUST NOT 新增第二套键位写入路径。
- **不做左栏（tree / shell）的键盘导航与全产品焦点模型**：那是 UX 重做会话的范围（左栏目前零键盘支持，本 change 不碰）。
- **不做视觉语言 / 主题**：面板是占位实现，不进入「极致美」的视觉迭代；不新增字体、图标、动效。
- **不做配置 warning 的 UI 出口**：`[keys]` 的非法项 warning 仍走 console（M132 已定的口径），本 change 不扩面。
- **不改键位分发语义**：不新增作用域、不改 token 口径、不改「一个 token 一条绑定」的装配期不变量。
- **不做多段 chord 的展示**：表内当前没有多段 chord，面板不需要为它做 UI。

## Impact

- 影响的 specs：`keymap-commands`（ADDED 一条 requirement：键位查看面板）。
- 影响的代码：`src/keys.ts`（命令 id 与 `⌘/` 绑定）、`src/main.ts`（命令实现、面板装配、`applyKeyConfig` 记录生效表）、`src/style.css`（面板样式）、`tests/visual/scenes/m133-describe-bindings.spec.ts`（新场景 + 新基线）、`文案-Copy.md`（D63–D67）。
- **面板自己的关闭键（`Escape` / `⌃G`）不进 `KEY_BINDINGS`**（如实记录）：统一表的装配期不变量是「一个 token 一条绑定」（重复即抛），而这两个 token 已被占用——`Escape` 归 `editor.widget-escape`（带 `when` 条件）、`⌃G` 归 `editor.keyboard-quit`。表里再加一条会在装配期失败。面板打开时焦点在遮罩上，上述两条绑定因作用域（`editor`）与 `when` 条件都不会命中，因此不存在「同一物理键两处各写一份、改一处漏一处」的漂移——这正是 M131 要消灭的形态。监听只挂在遮罩元素上（隐藏时收不到事件），关闭动作回到同一条命令实现；`Escape` / `⌃G` 的匹配复用 `keys.ts` 的 `keyToken`（与表内绑定同一归一化口径），不另写一套匹配。若将来要让这两个键进表，须先改「一个 token 一条绑定」的不变量（属后续 change 的范围）。
- **已知限制（如实记录）**：
  - 面板渲染的是**打开那一刻**的生效表；`[keys]` 覆盖在启动期装配完成后不再变化，故面板不会显示陈旧数据，但也不做「配置热改后自动刷新」。
  - 面板打开期间 `global` 作用域的键照常生效（例如 `⌘S` 仍保存、`⌘/` 关闭面板）——被要求不穿透的是 `editor` 作用域（编辑文档的键），这一点由场景断言。
  - `⌘/` 不是 macOS 的系统级全局快捷键（Apple 快捷键表里 `⌘/` 只在 Finder 内表示显示 / 隐藏状态栏）；系统「帮助」菜单的 accelerator 是 `⇧⌘?`（`Cmd-?`），本 change 不用它，理由见 What Changes 第 1 条。
- 关联约束：ADR 0001 §4（chorded 非 modal 键位框架）、ADR 0002 §5（配置即数据）、ADR 0006（Emacs 键位 PKM 定位）、M131 的统一分发与表不变量、M132 的 `[keys]` 覆盖口径。
