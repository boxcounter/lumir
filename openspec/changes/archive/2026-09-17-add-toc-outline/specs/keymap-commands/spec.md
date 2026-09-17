# keymap-commands 增量规格

## ADDED Requirements

### Requirement: 大纲开关——⌘⇧O 与 toc.toggle

系统 SHALL 提供命令 `toc.toggle` 承担「展开 / 收起大纲浮层」，命令 id SHALL 为 `toc.toggle`，
作用域 SHALL 为 `global`，默认绑定 SHALL 为 `⌘⇧O`，实现 SHALL 落在装配层（`src/main.ts`），能力与
浮层本体 SHALL 在 `src/toc.ts`。

该命令 SHALL 进 `KEY_BINDINGS` 与 `GLOBAL_COMMAND_IDS`，因此 `[keys]` 配置 SHALL 能像其余命令
一样对它重绑或解绑，`app.describe-bindings` 面板 SHALL 自动列出它（面板渲染的是生效表与
`COMMAND_IDS`，新增命令不需要改面板代码）；其 `doc` 字段 SHALL 写明取 `⌘⇧O` 的来由与作用域理由。

作用域取 `global` 而非 `editor` 的理由 SHALL 记录在绑定来由里：浮层打开时焦点在浮层内（不在编辑器
内容区内），`editor` 作用域会让「已打开时再按同一个键收起」失效；空标题文档也要能在任意焦点下走到
提示。注册前 SHALL 核对该组合与既有绑定及原生菜单零冲突：表内 `⌘⇧` 系当前只有 `⇧⌘Z`（重做），
macOS 原生菜单的 accelerator 集合里 `⌘⇧` 系同样只有 `⇧⌘Z`。

浮层自己的导航键（`↑↓` / `Enter` / `Esc`）SHALL NOT 进本表：表的不变量是「一个 token 一条绑定」，
而这些 token 已被 `editor` 作用域占用（`↑↓` 归 `editor.cursor-up/down`、`Esc` 归
`editor.widget-escape`（带 `when` 条件））。浮层内就地消费 + 阻止默认行为，使 window 上的分发器对
已消费事件让路——不构成同一物理键的第二条分发映射。

#### Scenario: 表的不变量在新增绑定后仍成立

- **WHEN** 装配应用（构造分发器并注入命令实现）
- **THEN** 新增绑定后表内仍无重复绑定、每条绑定都有归属命令与来由、清单里没有孤儿命令，装配不抛错

#### Scenario: 零冲突的核对留痕

- **WHEN** 查阅 `KEY_BINDINGS` 里 `toc.toggle` 那一条
- **THEN** `doc` 字段写明：作用域取 `global` 的理由、与既有 `⌘⇧` 系绑定（`⇧⌘Z`）的零冲突结论，以及
  原生菜单 accelerator 集合同样只有 `⇧⌘Z` 这一核对结果

#### Scenario: 面板与配置都能看到它

- **WHEN** 按 `⌘/` 打开键位面板；另一轮用 `[keys]` 把 `⌘⇧O` 重绑为 `⌃J` 后按 `⌘/`；再一轮用
  `[keys]` 把 `⌘⇧O` 解绑（值写 `null`）后按 `⌘/`
- **THEN** 第一轮面板里有 `⌘⇧O → toc.toggle` 一行（含来由）；第二轮该命令对应的键位显示为 `⌃J`；
  第三轮 `toc.toggle` 仍被列出并标注「未绑定」——命令不因重绑 / 解绑从视野里消失
