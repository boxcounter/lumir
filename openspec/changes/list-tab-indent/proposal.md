# Proposal: 列表项 TAB / SHIFT+TAB 缩进——统一键位层新增两条 editor 命令

- Change ID: list-tab-indent
- 日期: 2026-09-25
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 原话：「光标在正文列表中时，TAB 增加缩进、SHIFT+TAB 减少缩进。」

现状里这个键位是**未定义行为**：统一键位表（`src/keys.ts:293` 的 `KEY_BINDINGS`，唯一真源）
没有 `Tab` / `Shift-Tab` 两条 token，CM 侧也没有装 `indentWithTab` 或 defaultKeymap
（全仓 grep 零命中）——TAB 因此落到原生路径 = webview 焦点遍历，把焦点移出编辑器
（contentDOM 带 `tabindex="0"`，`src/editor.ts:1353`）。这与 Emacs keybinding PKM 的定位
（ADR 0006）不符：列表是 PKM 的高频结构，而调整层级目前只能手敲行首空格——且列表标记
在渲染态是常隐的（`src/preview/lists.ts:360`），光标根本到不了行首空白区，手动缩进连
落点都没有。

流程：本提案走「先出稿再裁决」（Alex 流程裁决），实现待节点 1 通过后开始。

## What Changes

1. **两条新命令 + 两条新绑定**（delta：`keymap-commands`）：`editor.list-indent`（TAB）与
   `editor.list-outdent`（SHIFT+TAB），scope `editor`（事件目标落在编辑器内容区内才生效，
   与全部编辑键同口径）。经统一键位表分发，[keys] 配置可重绑 / 解绑，describe-bindings
   面板自动收录——三者都是键位统一层（M131/M132/M133）的既有机制，本 change 零新机制。

2. **列表项缩进编辑行为**（delta：`keymap-commands`，行为规格与键位同一条 requirement，
   先例 = M132 的 kill/yank 行为也写在 keymap-commands）：光标（选区 head）归属的最近
   `ListItem` 连同其续行与子树**整体平移**——每层 2 空格，只动行首空白，有序列表源码
   编号不重排、任务标记不动（最小写回，ADR 0003 §3 铁律的编辑态推论）。整次平移是
   一次 dispatch、一步撤销（⌘Z 一次回到平移前）。渲染自动跟随：列表标记与悬挂缩进由
   `src/preview/lists.ts` 的既有组扫描按新语法树重算，本 change 不动渲染层。

3. **到顶与非列表的收口**：SHIFT+TAB 减到无缩进可减时再按 = 无操作（文档逐字节不变）；
   光标不在任何列表项内（普通段落、标题、表格、代码块内）时 TAB / SHIFT+TAB = 无操作。
   「命中即消费」是统一键位层既有纪律（keymap-commands spec「统一键位分发表」：
   命令无事可做同样吞掉，MUST NOT 放回原生路径），fallback 不写新的例外。

4. **真机验收场景**：新增 `scripts/acceptance/scenarios/43-list-tab-indent.md`，随实现
   同 PR（AGENTS.md：验收场景维护权归新功能 mission）。编号 43 按 tower registry 对账
   （36=live-theme-switch、37=heading-hierarchy-ramp、38=content-width-drag、
   39=product-version-display、40=table-fullscreen-view（M229）、41/42=M231；
   对账文本见 tasks.md §6）。

## 待 Alex 裁决

| # | 裁决点 | 选项 | 推荐 | 理由 |
|---|---|---|---|---|
| D1 | TAB / SHIFT+TAB 键位归属 | a. 绑给列表缩进（editor 作用域）；b. 保留原生焦点遍历；c. 绑别的键 | **a** | Alex 原话点名 TAB；冲突核对零冲突（表内无 `Tab`/`Shift-Tab` token——`Ctrl-Tab`/`Ctrl-Shift-Tab` 是标签切换，归一化后不同 token；应用无补全扩展、CM 未装 indentWithTab）。代价：编辑器内 TAB 的原生焦点遍历被接管——这是唯一真实的行为牺牲，需知情接受；原生焦点遍历本就不是本应用的导航范式（Emacs keybinding PKM），且「焦点跳出编辑器」在列表编辑中途发生是缺陷而非能力 |
| D2 | 缩进写回口径 | a. 每层 2 空格、只动行首空白、编号不重排；b. 每层 4 空格；c. 缩进后重排有序列表源码编号 | **a** | 2 空格是仓内 fixture 与真实 vault 的既有惯例（`tests/visual/scenes/paragraph.spec.ts:7`、`markdown-parser.spec.ts:29`），也是 lists.ts 显示口径的假定（`src/preview/lists.ts:289` 每层 +2 单元）；「不重排源码编号」遵守最小写回——显示编号本就由渲染层按组序算（`src/preview/lists.ts:211-213`），源码字面 `1. 1. 1.` 渲染照常正确，重排只会制造无谓 diff（ADR 0003 §3：兼容是读取侧义务，不是写入侧权利） |
| D3 | SHIFT+TAB 到顶后的行为 | a. 无操作；b. 把列表项提升为普通段落 | **a** | 到顶即「无缩进可减」，文档不动是最少惊讶；提升为段落改变文档结构（删掉标记），超出「减少缩进」的字面承诺，Obsidian 亦无此行为 |
| D4 | 非列表上下文 TAB 的 fallback | a. 无操作（吞掉）；b. 放回原生焦点遍历；c. 插入 2 空格 / tab 字符 | **a** | b 会把「编辑器内 TAB」切成两种语义（列表内缩进、列表外跳焦点），同一物理键两种结果正是 M131 要消灭的漂移；c 违反最小写回精神且制造不可见空白 diff。a 与键位层「命中即消费」纪律一致；code 模式文件本就只读（M130），代码块内 TAB 缩进 v0 不做（见 Non-goals） |
| D5 | 非空选区时 TAB 的作用范围 | a. 只作用 head 所在项；b. 选区触及的全部列表项批量平移 | **a** | v0 收敛到 Alex 原话的光标场景；批量平移涉及选区重映射与跨项对齐的边界判定，验证面翻倍，需要时作为后续 change 单独立项 |

## Non-goals

- 不做代码块内的 TAB 缩进（围栏 / 缩进代码块内 TAB = 无操作）；不做非列表行的
  TAB 插入空白。
- 不做选区批量缩进（D5 推荐项）；不做 SHIFT+TAB 到顶后的「提升为段落」（D3）。
- 不动列表渲染层（标记 glyph、复合编号、悬挂缩进的显示口径全部是 lists.ts 既有机制，
  编辑后自动重算）。
- 不做任务标记的点击切换（task marker 当前是纯渲染，`src/preview/lists.ts:58-64`，
  无任何交互）——本 change 只保证缩进写回不动任务标记。
- 不引入多段 chord、不新增配置项、不改 `[keys]` 的校验口径。

## Impact

- 影响的 specs：`keymap-commands`（ADDED 一条 requirement，行为与键位同条）
- 影响的代码/系统（实现期）：`src/keys.ts`（2 个命令 id + 2 条绑定 + doc）、
  `src/editor.ts`（命令实现：语法树归属判定 + 最小编辑 dispatch）、
  `tests/unit/`（缩进纯函数单测 + 键位表不变量既有断言继续绿）、
  `scripts/acceptance/scenarios/43-list-tab-indent.md`（真机场景）
- 关联约束：ADR 0003 §3 铁律（写回复口径 D2 按它的编辑态推论设计）；ADR 0002 §6
  性能合同（一次 dispatch 的语法树查询 + 行级编辑，远低于 keypress-to-paint <16ms）；
  ADR 0006（Emacs keybinding 定位，D1 的理由来源）
- 与活跃 change 的关系：无交集（其余活跃 change 均不碰键位表与列表编辑）。
