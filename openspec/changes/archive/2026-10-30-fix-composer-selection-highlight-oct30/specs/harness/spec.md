## MODIFIED Requirements

### Requirement: composer 的全选（⌘A，M627）

焦点在 composer 内时按下 `⌘A` SHALL 选中 composer 的**全部块**——段落块的全部文本与原子卡片
（引用卡片 / 消息摘录卡片 / 图片卡片）整体在内，MUST NOT 只选当前段落、MUST NOT 把选区扩到
composer 之外（编辑器 / transcript 不被波及）。命令 SHALL 经统一键位表的 `text` 作用域分发
（`editor.select-all` 与编辑器内容面共用同一条绑定，装配层按事件目标分派），MUST NOT 依赖引擎
原生的 selectAll：混排 contenteditable 里的原生 selectAll 选不到全文（Alex 2026-10-23 报告的
形态；Edit 菜单的预置 Select All 因此让出 `⌘A` 加速键，见 keymap-commands 的「⌘A 归文本面」）。
全选后的删除 / 键入 SHALL 走既有选区路径（删除整段选区、键入替换整段选区），MUST NOT 留下半截
卡片或裸节点。视图层契约与证伪口径见 `docs/specs/harness-composer.md` 的 HC6。

全选及任意非折叠选区的**可见性** SHALL 由模型选区驱动的自绘高亮补足，不得完全依赖引擎原生
`::selection`：每个被完整选中的卡片与段落 MUST 有可见高亮，局部文本选区继续保留原生文本高亮；
高亮 MUST NOT 越出 composer，且 MUST NOT 改变 DOM 选区端点、块结构或可访问语义。选区折叠、移出
composer、失焦或结构编辑使原选区失效后，自绘高亮 MUST 同步清除，不得残留。

#### Scenario: 有卡片时全选覆盖全文

- **WHEN** composer 里有一张引用卡片、卡片后一行问题段落，焦点在 composer 内按 `⌘A`
- **THEN** 选区覆盖卡片与段落的全部内容（摘录原文与问题文本都在选区里），编辑器与 transcript
  的选区 / 内容不受影响

#### Scenario: 全选后键入替换整段内容

- **WHEN** composer 里有两段文本，按 `⌘A` 后键入一个字符
- **THEN** composer 只剩该字符（整段被替换，而不是在光标处插入）；随后的撤销恢复全选前的块序列

#### Scenario: 不可编辑卡片在首位时全选仍逐块可见

- **WHEN** composer 的首个顶层块是不可编辑卡片，后续为任意段落或卡片，焦点在 composer 内按 `⌘A`
- **THEN** 每个顶层块的矩形内都出现可见高亮，composer 外不出现该高亮，DOM 选区端点仍是
  `(composer,0) → (composer,块数)`，Backspace 删除全部块

#### Scenario: 折叠或改块后无高亮残留

- **WHEN** 已显示自绘选区高亮的 composer 发生选区折叠、选区移出、失焦或结构编辑
- **THEN** 失效选区对应的自绘高亮在同一同步周期内清除，不在任何旧块或新块上残留
