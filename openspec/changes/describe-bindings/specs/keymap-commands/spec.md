# keymap-commands 增量规格

## ADDED Requirements

### Requirement: 键位查看面板（app.describe-bindings）

应用 SHALL 提供命令 `app.describe-bindings`，作用域 `global`，默认绑定 `⌘/`，实现落在装配层（`src/main.ts`）。该命令 SHALL 进 `KEY_BINDINGS` 与 `GLOBAL_COMMAND_IDS`，因此 `[keys]` 配置 SHALL 能像其余命令一样对它重绑或解绑；其 `doc` 字段 SHALL 写明 `⌘/` 的来由（macOS 的「帮助」菜单 accelerator 实为 `⇧⌘?`＝`Cmd-?`，该键在本应用的原生菜单下会先被系统 Help 菜单截获，故取 `⌘/`；Emacs 的 `C-h b` 不可用——`⌃H` 已被后删字符占用）。

面板 SHALL 列出**生效中**的键位表——即分发器真正在用的那份（默认表经 `applyKeyOverrides` 处理后的产物），MUST NOT 只渲染静态默认表。每条绑定 SHALL 显示键位写法与该绑定的来由（`doc`）；MUST NOT 出现「表里有绑定但面板看不见」的静默遗漏。

面板 SHALL 按功能族分组渲染（移动与选择 / 扩选 / 删除 / kill-yank / 翻屏 / 撤销 / widget / 全局）。**有命令实现但当前无任何键位指向它**（被 `[keys]` 解绑）时，该命令 SHALL 仍被列出并标注「未绑定」——解绑 MUST NOT 让命令从视野里消失。分组是呈现层概念，MUST NOT 改变作用域语义（作用域仍由命令归属决定）。

面板 SHALL 打开即见、关掉即走：`⌘/` 打开（打开态再按即关）；`Escape`、`⌃G` 与点击遮罩三条路径 SHALL 均可关闭；关闭后焦点 SHALL 交还编辑器。面板打开期间 SHALL 接管焦点，编辑器作用域的键 MUST NOT 穿透到文档（不改文档内容、不移动光标）。`Tab` / `⇧Tab` SHALL 留在面板内（面板无可聚焦子元素，放行会让焦点落进编辑器内容区——那之后穿透保证即失效）。

面板的关闭键（`Escape` / `⌃G`）SHALL 由面板就地消费，MUST NOT 在统一键位表之外注册**与表内绑定相同的物理组合**：表的不变量是「一个 token 一条绑定」，这两个 token 已被占用（`Escape` 归 `editor.widget-escape`（带 `when` 条件）、`⌃G` 归 `editor.keyboard-quit`），面板打开时那两条绑定因作用域与条件均不命中。关闭键的匹配 SHALL 复用键位层的 token 归一化口径（`keyToken`），MUST NOT 另写一套匹配。本版 SHALL NOT 为这两个键改动「一个 token 一条绑定」的装配期不变量。

视觉 SHALL 沿用既有排版基线与样式变量（占位实现），MUST NOT 引入新视觉语言。

#### Scenario: 打开面板看到生效表

- **WHEN** 不在任何 `[keys]` 覆盖下打开应用，按 `⌘/`
- **THEN** 面板可见并按功能族分组列出全部键位（逐绑定一行，键位写法 + 来由），每条有实现且有绑定的命令都出现在面板里；编辑器里的绑定条数与默认表一致，无「未绑定」行

#### Scenario: 配置重绑 / 解绑后按生效表渲染

- **WHEN** 配置 `{"keys": {"Ctrl-j": "editor.undo"}}` 后按 `⌘/`；或配置 `{"keys": {"Cmd-s": null}}` 后按 `⌘/`
- **THEN** 前者面板里出现 `⌃J → editor.undo` 这一行（带「用户配置重绑」来由），默认的 `⌘Z` 仍在；后者 `document.save` 仍被列出、标注「未绑定」，其余行数不变

#### Scenario: 面板打开期间编辑键不穿透

- **WHEN** 光标停在文档中，按 `⌘/` 打开面板，随后依次按 `⌃D`（后删）、`⌃K`（kill 行）、`⌃A`（行首）、`⌃⇧F`（扩选）、`Tab` 并输入若干字符
- **THEN** 文档内容逐字节不变、光标位置不变、焦点仍在面板内（面板持有焦点，`editor` 作用域不命中；`Tab` 不把焦点送出面板）；按 `Escape` 关闭后焦点回到编辑器，再按 `⌃D` 恢复删除字符

#### Scenario: 三条关闭路径

- **WHEN** 面板打开时按 `Escape`；再次打开后按 `⌃G`；再次打开后点击遮罩（面板之外的区域）
- **THEN** 三种操作都关闭面板；点击面板本体不关闭；面板打开态再按 `⌘/` 也关闭
