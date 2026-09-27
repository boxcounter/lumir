# keymap-commands 增量规格

## ADDED Requirements

### Requirement: 表格全屏查看命令——table.toggle-fullscreen

系统 SHALL 提供命令 `table.toggle-fullscreen` 承担「打开 / 关闭当前表格的全屏遮罩」，命令 id SHALL 为
`table.toggle-fullscreen`，作用域 SHALL 为 `global`，**默认不绑键**并 SHALL 登记进默认不绑键清单
（`src/keys.ts` 的 `KEYLESS_COMMAND_IDS`）——「默认不占键位」是要签字的决定：本版没有证据表明它是
高频动作，用户按需经 `[keys]` 绑定（M180 折行开关先例）。实现 SHALL 落在装配层（`src/main.ts`），
遮罩能力本体 SHALL 在自己的模块（`src/table-fullscreen.ts`）。

命令 SHALL 带命中条件（`when`）：遮罩已打开时命中（此时命令 = 关闭，toggle）；否则 caret 落在一张
当前渲染为 grid 的表内、或该表的滚动容器持有焦点时命中（打开）。命中条件不满足时 SHALL NOT 消费
事件（不 `preventDefault`），同名按键在别处照旧走原生路径。条件 SHALL 由**命令级门**
（`KeymapContext.commandGate`，`src/keys.ts`）承担：绑定层的 `when` 只拿得到事件、拿不到编辑器
状态（「caret 在不在某张渲染为 grid 的表内」需要 EditorState），而 `[keys]` 覆盖产出的绑定也没有
`when` 字段（`applyKeyOverrides` 只换「键 → 命令」的对应）——条件是命令实现方的判定位，键位层只
留一个可选的钩子。作用域取 `global` 而非 `editor` 的理由
SHALL 记录在绑定来由里：遮罩打开时焦点在遮罩内（不在编辑器内容区内），`editor` 作用域会让
「再执行一次同一命令关闭」失效（`toc.toggle` 同款理由）。

该命令 SHALL 进 `COMMAND_IDS` 与 `GLOBAL_COMMAND_IDS`，因此 `[keys]` 配置 SHALL 能像其余命令一样
对它绑定 / 重绑 / 解绑，`app.describe-bindings` 面板 SHALL 自动列出它——默认不绑键时该行显示
「未绑定」并说清成因与下一步（既有 D66 口径：默认不占键位 → 可用 `[keys]` 绑定），MUST NOT 让
命令从视野里消失。

遮罩自己的就地键（`Esc` 关闭、`Tab` 留驻）SHALL NOT 进本表：表的不变量是「一个 token 一条绑定」，
`Esc` 已被 `editor.widget-escape`（带 `when` 条件）占用；遮罩内就地消费 + 阻止默认行为，使 window
上的分发器对已消费事件让路——不构成同一物理键的第二条分发映射。

#### Scenario: 表的不变量在新命令登记后仍成立

- **WHEN** 装配应用（构造分发器并注入命令实现），并对账 `COMMAND_IDS`、`KEY_BINDINGS` 与
  `KEYLESS_COMMAND_IDS` 三者
- **THEN** 表内无重复绑定、每条命令恰好满足「有绑定」或「在默认不绑键清单里」之一、清单里没有
  `COMMAND_IDS` 之外的 id、清单与绑定表无交集，装配不抛错

#### Scenario: 默认不绑键时面板与配置都能看到它

- **WHEN** 不在任何 `[keys]` 覆盖下按 `⌘/` 打开键位面板；另一轮用 `[keys]` 给
  `table.toggle-fullscreen` 绑一个组合后再按 `⌘/`
- **THEN** 第一轮面板里有该命令一行、键位列显示「未绑定」并注明「默认不占键位，可经 `[keys]`
  绑定」；第二轮该命令对应的键位显示为新绑定，且绑定后命令在表内命中条件满足时生效

#### Scenario: 命中条件不满足时不消费事件

- **WHEN** caret 在表外（普通段落）时执行该命令对应的键位
- **THEN** 事件不被消费（原样留给原生路径），文档与选区不变，遮罩不出现
