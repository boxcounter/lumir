## MODIFIED Requirements

### Requirement: CM composer 的 Emacs 文本导航族

composer 的 Emacs 文本导航族 SHALL 经统一键位表 `text` 作用域分发，并适配到 CM EditorView / EditorState；MUST NOT 再由旧块模型或浏览器原生 contenteditable caret 决定。键位覆盖不变：⌃F/B、⌃A/E、⌃N/P、⌃D/H、⌥D/⌥⌫、⌃K/Y、⌃T、扩选六键与按词扩选；族外键位路径不变。

所有命令只作用于纯文本。字符与视觉行移动、逻辑行首尾和扩选 SHALL 用 CM 移动原语；扩选 anchor 不动。字素簇 / 词边界 SHALL 复用编辑器共享扫描核；⌃D/H 与**折叠光标上的无修饰物理 Backspace** 删除一个字素簇或选区（同一份 `clusterBackward` 步长），⌥D/⌥⌫ 按词 kill，⌃K kill 到逻辑行尾（在行尾则杀行界），⌃Y 插入共享 kill 槽，⌃T 转置相邻字素簇。kill 槽继续跨编辑器 / composer 共用，内容不含附件。任何文本命令 MUST NOT 添加、移除或重排附件。

物理 Backspace SHALL 由 composer 的 `beforeinput` 闸门接管：只认 `deleteContentBackward` 的折叠 caret，按同一份 `clusterBackward` 删一个整字素簇，一次删除 = 一条 history 步（一次 undo 复原）。修饰键变体（`deleteWordBackward` / `deleteHardLineBackward` / `deleteSoftLineBackward`）、IME 组合期、只读会话与非空选区 MUST NOT 被本闸门改变；MUST NOT 在 composer 侧复制第二份字素判定表。

#### Scenario: 文本移动、扩选与删除不触附件

- **WHEN** tray 有附件，用户在多行 / 软折行文本中执行移动、扩选、字符 / 词删除和转置
- **THEN** 文本与 selection 按 CM / 共享词法语义变化，导航不产编辑 undo；附件 field 逐字段不变

#### Scenario: 物理 Backspace 与 ⌃H 同一步长

- **GIVEN** composer 文档为 `A مَ B`、`x👍🏽y` 或 `xe\u0301\u0323y`，caret 在簇之后且无选区
- **WHEN** 按一次无修饰 Backspace
- **THEN** 文档分别变为 `A  B`、`xy`、`xy`——base 与全部附标 / 修饰符一起删除，MUST NOT 只剩码点后缀
- **AND** 同一次按压的 `editor.delete-char-backward`（⌃H）结果逐字节相同；一次 undo 复原；附件 field 不变

#### Scenario: kill-yank 跨面共用

- **WHEN** 在编辑器 kill 一段多行文本后到 composer yank，再反向操作
- **THEN** 两侧使用同一 kill 槽与连续 kill 合并规则，多行文本进入当前文本选区，附件不成为 kill 内容
