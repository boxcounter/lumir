## ADDED Requirements

### Requirement: 键位面板的查找：文本查询、按键捕获与详情

应用 SHALL 在键位面板内提供一个带显式标签的文本输入框，空查询 SHALL 呈现全部命令。文本查询 SHALL
匹配命令的**人类标签（中文列与英文列都参与匹配）**、搜索别名与命令 id，匹配语义 SHALL 复用
`src/list-filter.ts` 的大小写折叠**子串**判定（MUST NOT 重排、打分或高亮）；维护者来由（绑定的
`doc` / `docKey` 文本）MUST NOT 进入主搜索语料，只在行详情里出现。查询结果为空时 SHALL 给出空态，
说明当前查询与下一步，并提供清除查询与进入按键捕获的出口。

面板 SHALL 提供显式的按键捕获模式：用户按下组合键后，系统 SHALL 用键位层同一套 token 归一化口径
（`keyToken` / `normalizeKey`，含 Alt 组合按 `event.code` 判定）得到 token，并定位到生效表中归一化后
相等的绑定；捕获结果 SHALL 显示该命令、作用域与 `when` 条件。**被捕获的按键 MUST NOT 执行任何命令**
（不移动光标、不修改文档、不切换主题、不打开其他面板）。捕获等待态 SHALL 由 `Escape` 或取消按钮退出；
该状态下 `⌃G` SHALL 作为待查询的键被捕获而 MUST NOT 关闭面板（否则 `⌃G` 无法被反查）。进入捕获时
作用域筛选 SHALL 重置为「全部」，以免当前筛选藏掉被查询键的归属。无绑定的 token SHALL 给「没有命令
使用这个键位」的空态。

每条命令 SHALL 只占列表中的一行：同一命令的多条生效键 SHALL 合并显示在该行的键位区；行 SHALL 显示
人类标签、作用域徽标与（有 `when` 时）条件短徽标。行详情 SHALL 就地展开（一次只开一个），承载来由、
原始 token、命令 id、作用域说明与 `when` 全文；详情 MUST NOT 引入第二个滚动容器。未绑定命令的详情
SHALL 说清成因并给出 `[keys]` 配置绑定方法。详情里的来由 MUST NOT 参与主搜索语料。

面板的键盘模型 SHALL 完整可用：打开时焦点落在查询输入框；`↑` / `↓` 与 `⌃P` / `⌃N` 移动活动行；
`Enter` / `Space` 展开或收起活动行详情；`Tab` / `Shift+Tab` 在输入框、捕获按钮、作用域选中项与结果列表
之间循环（空态动作钮可见时追加），MUST NOT 让焦点逃出面板；`PageUp` / `PageDown` SHALL 真正滚动列表
（不是只移动焦点）；列表焦点下 `Home` / `End` 落到第一 / 最后一行、`←` / `→` 折叠或展开活动行所在组。
`Escape` SHALL 分层：捕获等待 → 取消捕获；已捕获 → 清除捕获；查询非空 → 清查询；否则关闭面板。
`⌃G` SHALL 关闭面板（捕获等待态除外，见上）。输入法组合期间 MUST NOT 刷新结果，组合结束后 SHALL 补一次；
关闭面板后 SHALL 经既有的焦点交还路径回到编辑器。

计数 SHALL 随状态变化：空查询显示命令总数与组数，查询显示命中数 / 总数，捕获显示被捕获键与命中数；
计数更新 SHOULD 对屏幕阅读器去抖。空态 SHALL 按查询无命中、捕获无绑定、作用域无命令三种成因分别给
标题与下一步，MUST NOT 复用一句笼统的「没有结果」。

#### Scenario: 知道命令找键（where-is）

- **WHEN** 面板打开、焦点在查询框，用户键入命令标签中的一段（如「大纲」）
- **THEN** 结果只剩包含该标签的命令行（目标命令恰一行），该行的键位区显示全部生效键的字形（如 `⇧⌘O`），
  目标行出现在列表视口内且无需滚动；查询不匹配任何维护者来由里的词（如 `M447`）——那些输入给零命中

#### Scenario: 知道键找命令（describe-key）

- **WHEN** 用户点击「捕获按键」后在面板内按下 `⌃⌥S`；随后按 `Esc` 取消捕获
- **THEN** 捕获态显示字形 `⌃⌥S` 并只剩使用该 token 的命令（如 `editor.focus-block-scroll`），该行显示
  作用域与条件短徽标，详情显示 `when` 全文；文档内容与光标逐字节不变，主题与其他面板状态不变；
  `Esc` 只取消捕获，面板保持打开

#### Scenario: 捕获的键不执行命令（反向判据）

- **WHEN** 面板关闭时按 `⌃⌥S`（该键确实执行其命令）；再打开面板进入捕获态并按同一 `⌃⌥S`；再对
  全局键 `⇧⌘T` 重复一次（面板关闭时切主题、捕获时不切）
- **THEN** 面板关闭时两次都观察到命令效果；捕获态下都没有任何命令效果（文档、主题、其他面板状态不变），
  证明捕获路径真的消费了按键，而不是「反正不生效」

#### Scenario: 来由不进主搜索语料

- **WHEN** 在查询框输入只出现在维护者来由里的字符串（如 mission 编号 `M447` 或「已删除」），
  再输入命令标签里的「删除」
- **THEN** 前者零命中并显示查询空态；后者只命中标签/别名含「删除」的命令，MUST NOT 命中来由里写了
  「已删除」的 `toc.toggle`

#### Scenario: 键盘全程与焦点不逃出

- **WHEN** 只用键盘：`⌘/` 打开面板 → 输入查询 → `↓` → `Enter` 展开详情 → `Tab` 循环 → `PageDown`
  → `End` / `Home` → `Esc` 清查询 → `Esc` 关闭
- **THEN** 每一步焦点都留在面板内；`Tab` 的四停顺序为输入框 → 捕获按钮 → 作用域选中项 → 结果列表；
  `PageDown` 改变列表的 `scrollTop`；`Esc` 先清查询、再关闭；关闭后焦点回到编辑器；全程不触发任何
  键位命令

#### Scenario: 输入法组合期不刷新

- **WHEN** 查询框里用输入法输入中文（组合进行中），组合结束后确认候选
- **THEN** 组合期间结果列表不随中间串刷新；`compositionend` 后按最终查询串刷新一次

### Requirement: 键位面板的非自指入口

应用 SHALL 在原生菜单的 Help 子菜单提供一项 `Keyboard Shortcuts`，点击后经既有
`app:menu_command` 事件与**同一条** `app.describe-bindings` 命令层打开键位面板；MUST NOT 为它另开
分发路径、第二个面板实例或第二套开关逻辑。该菜单项 MUST NOT 设置 accelerator：菜单键等价会在
NSApplication 分发阶段截获物理键，既会让 `⌘/` 的 `[keys]` 重绑变成假开关，也会形成「一个 token 两条
分发映射」。菜单项文案 SHALL 取上屏列锁定的英文（与 macOS 原生 File / Edit / Help 菜单项一致）。
`app.describe-bindings` 被 `[keys]` 重绑或解绑后，菜单项 SHALL 仍能打开面板——菜单入口不依赖任何
具体键位；面板打开态再点菜单项 SHALL 收起（与命令的 toggle 语义一致）。

#### Scenario: 菜单入口打开面板

- **WHEN** 用户在 Help 菜单点击 `Keyboard Shortcuts`
- **THEN** 键位面板打开，焦点进入查询输入框；菜单收起；面板与按 `⌘/` 打开的是同一个实例、同一份生效表

#### Scenario: [keys] 重绑 / 解绑不影响菜单入口

- **WHEN** 用 `[keys]` 把 `app.describe-bindings` 重绑到另一组合，或把它解绑（值写 `null`），再点击菜单项
- **THEN** 菜单项仍打开面板；重绑后的新键同样能切换面板；解绑后原 `⌘/` 不再打开面板，但菜单入口不受影响

#### Scenario: 菜单项不带加速键

- **WHEN** 检查 Help 菜单项与键位表
- **THEN** 菜单项不显示也不注册 accelerator；`⌘/` 仍只由 `KEY_BINDINGS` 里的 `app.describe-bindings`
  一条绑定承担，菜单项没有在表外新增同一物理键的分发映射

### Requirement: 命令元数据与键位字形的单一来源

每条 `COMMAND_IDS` 中的命令 SHALL 恰有一个中英双列的人类标签，标签 SHALL 住文案表
（`文案-Copy.md` + `src/copy-data.ts`）并可由 `t()` 取值；MUST NOT 在面板、快捷键表或第二份映射表里
另写一份标签字面量。新增命令漏写标签时，单测 SHALL 在引入该命令的改动里报红（键集对账）。
搜索别名 MAY 按命令提供，别名只用于查询、MUST NOT 上屏，且 MUST NOT 含空白或空串。

作用域的中英文案与一句解释 SHALL 各只有一份来源（`scopeOfCommand` 决定档位，文案表决定措辞）；
带命中条件（`when`）的绑定 SHALL 同时提供可本地化的条件说明键（`whenKey`），且 `when` 与 `whenKey`
MUST 同生同灭——单测 SHALL 对默认键位表逐条对账。面板 MUST NOT 读取函数体的字符串或另写条件描述。

token 到人类字形的转换 SHALL 只有一处实现，且 SHALL 复用键位层的 token 归一化口径。修饰键字形顺序
SHALL 取 `⌃⌥⇧⌘`（Control / Option / Shift / Command）；需要 Shift 才能打出的字符（如 `}`、`<`、`_`、
`+`）SHALL 反解为物理键并补 `⇧`（`Cmd-}` → `⇧⌘]`、`Cmd-<` → `⇧⌘,`、`Ctrl-_` → `⌃⇧-`），MUST NOT
把原始 token 或未反解的字符直接显示给人。字形的单测 SHALL 覆盖全部默认绑定 token，并断言输出不含
`Cmd-` / `Ctrl-` / `Alt-` / `Shift-` / `Key` / `Digit` 等 token 字面（防止泄漏）。

#### Scenario: 标签覆盖门禁

- **WHEN** 运行命令元数据单测
- **THEN** `COMMAND_META` 的键集与 `COMMAND_IDS` 逐项相等（无漏写、无幻影）；每个标签键在文案表里存在，
  中文与英文列都非空，带模板参数的标签能完整渲染；任一条件不满足即红

#### Scenario: 字形矩阵

- **WHEN** 对 `Ctrl-Alt-KeyS` / `Shift-Cmd-o` / `Cmd-}` / `Cmd-{` / `Cmd->` / `Cmd-<` / `Ctrl-_` /
  `Cmd-+` / `Cmd-=` / `Alt-Backspace` / `Ctrl-Shift-Tab` 调用字形转换
- **THEN** 依次得到 `⌃⌥S` / `⇧⌘O` / `⇧⌘]` / `⇧⌘[` / `⇧⌘.` / `⇧⌘,` / `⌃⇧-` / `⇧⌘=` / `⌘=` / `⌥⌫` /
  `⌃⇧⇥`；对全部默认绑定 token 的转换结果不含 token 字面

#### Scenario: whenKey 不变量

- **WHEN** 对默认 `KEY_BINDINGS` 逐条检查
- **THEN** 每条带 `when` 的绑定都有 `whenKey`，每条带 `whenKey` 的绑定都有 `when`；面板显示的条件的
  全文与短徽标都来自文案表，MUST NOT 来自函数体或第二份字面量表

## MODIFIED Requirements

### Requirement: 键位查看面板（app.describe-bindings）

应用 SHALL 提供命令 `app.describe-bindings`，作用域 `global`，默认绑定 `⌘/`，实现落在装配层（`src/main.ts`）。该命令 SHALL 进 `KEY_BINDINGS` 与 `GLOBAL_COMMAND_IDS`，因此 `[keys]` 配置 SHALL 能像其余命令一样对它重绑或解绑；其 `doc` 字段 SHALL 写明 `⌘/` 的来由（macOS 的「帮助」菜单 accelerator 实为 `⇧⌘?`＝`Cmd-?`，该键在本应用的原生菜单下会先被系统 Help 菜单截获，故取 `⌘/`；Emacs 的 `C-h b` 不可用——`⌃H` 已被后删字符占用）。

面板 SHALL 列出**生效中**的键位表——即分发器真正在用的那份（默认表经 `applyKeyOverrides` 处理后的产物），MUST NOT 只渲染静态默认表。面板 SHALL 以**命令**为行单位：每条命令一行，同一命令的多条生效键 SHALL 合并显示在该行的键位区，MUST NOT 因多键而拆成多行；每行 SHALL 显示该命令的人类标签、键位字形、作用域徽标与（有 `when` 时）条件短徽标。维护者来由、原始 token 与命令 id SHALL 移入该行的详情，MUST NOT 占据速查行。MUST NOT 出现「命令从视野里消失」的静默遗漏。

面板 SHALL 按功能族分组渲染（移动与选择 / 扩选 / 删除 / kill-yank / 翻屏 / 撤销 / 列表缩进 / 块 / widget / 标签 / 全局 / 其他），组序 SHALL 沿用既有分组表；组头 SHALL 可折叠，默认展开，查询时匹配组 SHALL 自动展开。**有命令实现但当前无任何键位指向它**（被 `[keys]` 解绑、或该命令默认不绑键）时，该命令 SHALL 仍被列出一行并标注「未绑定」，且该行 SHALL 说清**成因与下一步**——「默认不占键位」与「已被配置解绑」两种成因都要能被读到，并指明可用 `[keys]` 配置绑定；MUST NOT 让用户只能猜「这个命令是不是坏了」。解绑或默认不绑键 MUST NOT 让命令从视野里消失。分组是呈现层概念，MUST NOT 改变作用域语义（作用域仍由命令归属决定）。

（本 requirement 由 change `improve-keybindings-lookup-oct24` 重写：行单位由「一条绑定一行」改为「一条命令一行」，分组枚举与实现对齐为 11 组 + 兜底「其他」；归档后以本块为准。）

面板 SHALL 打开即见、关掉即走：按 `app.describe-bindings` 的当前生效键（默认 `⌘/`）打开（打开态再按即关）；`Escape`、`⌃G` 与点击遮罩三条路径 SHALL 均可关闭；关闭后焦点 SHALL 交还编辑器。面板打开期间焦点 SHALL 落在查询输入框，编辑器作用域的键 MUST NOT 穿透到文档（不改文档内容、不移动光标）。`Tab` / `⇧Tab` SHALL 在面板控件之间循环并留在面板内——输入框、捕获按钮、作用域选中项与结果列表；空态动作钮可见时追加在末尾；放行 `Tab` 会让焦点落进编辑器内容区，那之后穿透保证即失效。

面板的关闭键（`Escape` / `⌃G`）SHALL 由面板在模态遮罩上就地消费，MUST NOT 为同一物理组合在统一键位表之外注册**第二条分发绑定**：表的不变量是「一个 token 一条绑定」，这两个 token 已被占用（`Escape` 归 `editor.widget-escape`（带 `when` 条件）、`⌃G` 归 `editor.keyboard-quit`），面板打开时那两条绑定因作用域与条件均不命中——就地消费与表内分发互斥，不构成同一物理组合的两份分发映射。关闭键的匹配 SHALL 复用键位层的 token 归一化口径（`keyToken`），MUST NOT 另写一套匹配。**捕获等待态是唯一例外**：`⌃G` SHALL 作为待查询的键被捕获而 MUST NOT 关闭面板，该状态只由 `Escape` 或取消按钮退出；已捕获态与其余状态 `⌃G` 照常关闭。本版 SHALL NOT 为这两个键改动「一个 token 一条绑定」的装配期不变量。

视觉 SHALL 沿用既有遮罩、面板壳、680px 宽度与三主题样式变量，MUST NOT 引入新的色值、字号、圆角或动效语言；行模型、分组头与详情是呈现层重排，MUST NOT 削弱调试信息（原始 token / 命令 id / 来由全部保留在详情），也 MUST NOT 新增第二个滚动容器。

#### Scenario: 打开面板看到生效表

- **WHEN** 不在任何 `[keys]` 覆盖下打开应用，按 `⌘/`
- **THEN** 面板可见并按功能族分组列出全部命令（每命令一行；多键合并到键位区，键位区显示字形）；每条命令恰出现一次；面板行数 SHALL 等于 `COMMAND_IDS` 的条数（默认不绑键的命令同样成行，键位区显示「未绑定」），MUST NOT 出现「命令从视野里消失」的静默遗漏

#### Scenario: 未绑定行说清成因与下一步

- **WHEN** 不在任何 `[keys]` 覆盖下按 `⌘/`，读默认不绑键命令（如 `view.toggle-line-wrap`）那一行；
  再用 `[keys]` 把 `document.save` 解绑（值写 `null`）后重开面板，读该行
- **THEN** 两行都标注「未绑定」，说明文本都能读出成因（前者是「默认不占键位」，后者是「已被配置
  解绑」）并指明可用 `[keys]` 配置绑定；两行 MUST NOT 只给一个「未绑定」字样而让人猜原因

#### Scenario: 配置重绑 / 解绑后按生效表渲染

- **WHEN** 配置 `{"keys": {"Ctrl-j": "editor.undo"}}` 后按 `⌘/`；或配置 `{"keys": {"Cmd-s": null}}` 后按 `⌘/`
- **THEN** 前者在 `editor.undo` 一行的键位区看到 `⌃J` 与默认的 `⌘Z` 并列（来由移入详情，显示「用户配置重绑」），命令仍只有一行；后者 `document.save` 仍被列出、标注「未绑定」，其余命令行数不变

#### Scenario: 面板打开期间编辑键不穿透

- **WHEN** 光标停在文档中，按 `⌘/` 打开面板，随后依次按 `⌃D`（后删）、`⌃K`（kill 行）、`⌃A`（行首）、`⌃⇧F`（扩选）、`Tab` 并在查询框输入若干字符
- **THEN** 文档内容逐字节不变、光标位置不变、焦点仍在面板内（面板持有焦点，`editor` 作用域不命中；`Tab` 只在面板控件之间循环，不把焦点送出面板）；按 `Escape` 先清查询、再按 `Escape`（或按 `⌃G`）关闭后焦点回到编辑器，再按 `⌃D` 恢复删除字符

#### Scenario: 三条关闭路径

- **WHEN** 面板打开时按 `Escape`（查询已清空）；再次打开后按 `⌃G`；再次打开后点击遮罩（面板之外的区域）
- **THEN** 三种操作都关闭面板；点击面板本体不关闭；面板打开态再按 `app.describe-bindings` 的当前生效键（未重绑时即 `⌘/`）也关闭
