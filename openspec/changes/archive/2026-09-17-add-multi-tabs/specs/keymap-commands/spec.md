# keymap-commands 增量规格

## ADDED Requirements

### Requirement: 标签命令族——关闭 / 循环切换 / 序号直达

系统 SHALL 提供标签命令族，命令 id SHALL 为 `tab.close`、`tab.next`、`tab.prev` 与
`tab.goto-1` … `tab.goto-9`（九条各一个 id：命令层没有参数通道，序号只能落在 id 上，
这样 `[keys]` 配置重绑与键位面板都能如实显示「⌘3 → tab.goto-3」）。作用域一律 SHALL 为
`global`（标签是窗口级对象，焦点在文件树 / 搜索框 / 大纲浮层里时同样要能切，与 ⌘F / ⌘⇧O
同一理由），实现 SHALL 落在装配层（`src/main.ts`），能力（会话与切换）SHALL 在
`src/editor.ts`。

默认绑定 SHALL 为：`⌘W` → `tab.close`、`⌃⇥` → `tab.next`、`⌃⇧⇥` → `tab.prev`、
`⌘1`…`⌘9` → `tab.goto-1` … `tab.goto-9`。全部 SHALL 进 `KEY_BINDINGS` 与
`GLOBAL_COMMAND_IDS`，因此 `[keys]` 配置 SHALL 能像其余命令一样对它们重绑或解绑，
`app.describe-bindings` 面板 SHALL 自动列出它们（面板渲染的是生效表与 `COMMAND_IDS`）；
每条绑定的 `doc` 字段 SHALL 写明取该键的来由与作用域理由。

序号越界（标签数少于序号）SHALL 为无操作——MUST NOT 退化为「跳到最后一个」这类隐式兜底。
`⌃⇥` / `⌃⇧⇥` 在标签数少于 2 时 SHALL 为无操作。

#### Scenario: 表的不变量在新增绑定后仍成立

- **WHEN** 装配应用（构造分发器并注入命令实现）
- **THEN** 新增绑定后表内仍无重复绑定、每条绑定都有归属命令与来由、清单里没有孤儿命令，装配不抛错

#### Scenario: 序号直达与循环切换在边界上不越界

- **WHEN** 打开的标签数少于按下的序号（如只有 2 个标签时按 ⌘5），或标签数少于 2 时按 ⌃⇥
- **THEN** 前台标签不变，不出现任何隐式兜底跳转

#### Scenario: 键位冲突核对的留痕

- **WHEN** 新增绑定前核对与既有绑定及原生菜单 accelerator 的冲突
- **THEN** 核对结论 SHALL 记在绑定的 `doc` 字段与 change 的 proposal 里，逐键给出三条独立来源（表内 / 原生菜单 accelerator / 系统级）的结论；`⌘W` 的冲突与处置（在 `src-tauri/src/lib.rs` 让出该键）SHALL 一并留痕

### Requirement: ⌘W 归标签——原生菜单关闭项让出该加速键

macOS 原生 `Menu::default()` 在 File 与 Window 两个子菜单里的**预置** Close 项自带 `⌘W`
key equivalent，菜单键等价在 NSApplication 分发阶段就被截获，webview 的 keydown 收不到该键。
系统 SHALL 在 `src-tauri/src/lib.rs` 把这两个预置项换成**不带加速键**的自定义菜单项（按 M131
让出 `⌘Z` / `⇧⌘Z` 的同一先例），点击经 `app:menu_command` 交回前端，由前端映射到 `tab.close`
命令——菜单与键盘 SHALL 走同一个命令实现，MUST NOT 产生第二套关闭逻辑。

菜单里的关闭项 SHALL 保留（只是不再有加速键）。`⌘W` 的语义 SHALL 为「关闭当前标签」，
MUST NOT 关窗；零标签时 `⌘W` SHALL 为无操作。退出仍走 `⌘Q`（有 dirty 守卫）与窗口红灯按钮。

菜单手术的**结构性假设** SHALL 在替换前校验（子菜单存在、末位项确为预置 Close、文案匹配），
校验失败时 SHALL 保留默认菜单不改动并打 stderr 警告——MUST NOT 在结构变化时盲目删项。

#### Scenario: 结构假设不成立时不动菜单

- **WHEN** 默认菜单里找不到 File / Window 子菜单，或其末位项不是文案为 `Close` 的预置项
- **THEN** 该子菜单不被改动、打一条 stderr 警告，其余两处菜单改造（退出守卫 / 撤销重做）照常进行

#### Scenario: 菜单事件的转发载荷

- **WHEN** 菜单里任意一个自定义关闭项被点击
- **THEN** 经 `app:menu_command` 发出的载荷 SHALL 是平台术语 `close`（不是前端命令 id），File 与 Window 两处映射到同一个载荷；前端把它映射到 `tab.close`
