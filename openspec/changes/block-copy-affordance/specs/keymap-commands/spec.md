# keymap-commands 增量规格

## ADDED Requirements

### Requirement: 块级复制命令——block.copy

系统 SHALL 提供命令 `block.copy` 承担「复制 caret 所在的块（表格或代码块）的内容到剪贴板」，
命令 id SHALL 为 `block.copy`，作用域 SHALL 为 `editor`，**默认不绑键**并 SHALL 登记进默认不绑键清单
（`src/keys.ts` 的 `KEYLESS_COMMAND_IDS`）——「默认不占键位」是要签字的决定：用户按需经 `[keys]` 绑定
（M180 折行开关 / M240 表格全屏同一先例）。

作用域取 `editor` 而非 `global`：与 `table.toggle-fullscreen` 取 `global` 的理由不同——那条命令要在
遮罩持焦（焦点不在编辑器内容区）时仍能关闭，复制没有第二种焦点状态，且命中判据本身要求 caret 在编辑器里，
故 MUST NOT 放权到 `global`。

命令 SHALL 带命中条件：caret 落在一张**当前渲染为 grid** 的 pipe table 内，或落在一个围栏 / 缩进代码块内时
命中；命中条件不满足时 SHALL NOT 消费事件（不 `preventDefault`），同名按键在别处照旧走原生路径。
条件 SHALL 由命令级门（`KeymapContext.commandGate`）承担——理由与 `table.toggle-fullscreen` 逐条相同
（绑定层的 `when` 拿不到编辑器状态，`[keys]` 覆盖产出的绑定也没有 `when` 字段）。
两条判据 SHALL 都取自语法树与表格模型（MUST NOT 读 DOM），复制内容口径 SHALL 与触发钮逐字相同
（表格 = 源码切片含表头分隔行；代码块 = 纯内容不含围栏行与语法缩进）。

该命令 SHALL 进 `COMMAND_IDS`，因此 `[keys]` 配置 SHALL 能像其余命令一样对它绑定 / 重绑 / 解绑，
`app.describe-bindings` 面板 SHALL 自动列出它——默认不绑键时该行显示「未绑定」并说清成因与下一步
（既有 D66 口径），MUST NOT 让命令从视野里消失。

#### Scenario: 表的不变量在新命令登记后仍成立

- **WHEN** 装配应用（构造分发器并注入命令实现），并对账 `COMMAND_IDS`、`KEY_BINDINGS` 与
  `KEYLESS_COMMAND_IDS` 三者
- **THEN** 表内无重复绑定、每条命令恰好满足「有绑定」或「在默认不绑键清单里」之一、清单里没有
  `COMMAND_IDS` 之外的 id、清单与绑定表无交集，装配不抛错

#### Scenario: 命中条件不满足时不消费事件，且不复制任何东西

- **WHEN** caret 在普通段落里执行该命令对应的键位（同一会话里此前已成功复制过一次块）
- **THEN** 事件不被消费（原样留给原生路径）、文档与选区不变、剪贴板保持上一次的内容、
  不出现成功 toast；随后在同一份文档的表格内执行同一键位，剪贴板变为该表的源码——
  后一步是前一步的反面证据，保证前一步的「无变化」不是「键没送到」的同义反复

#### Scenario: 默认不绑键时面板与配置都能看到它

- **WHEN** 不在任何 `[keys]` 覆盖下按 `⌘/` 打开键位面板；另一轮用 `[keys]` 给 `block.copy`
  绑一个组合后再按 `⌘/`
- **THEN** 第一轮面板里有该命令一行、键位列显示「未绑定」并注明「默认不占键位，可经 `[keys]` 绑定」；
  第二轮该命令对应的键位显示为新绑定，且绑定后在命中条件满足时真的复制成功（剪贴板变化 + 成功 toast）
