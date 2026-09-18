# keymap-commands 增量规格

## MODIFIED Requirements

### Requirement: 统一键位分发表

全应用的键位绑定 SHALL 收敛为唯一一张 key → command 表（`src/keys.ts` 的 `KEY_BINDINGS`），每条绑定 SHALL 标注作用域与归属命令，并 SHALL 附一句来由说明（表即文档）。作用域取值只有两种：`global`（任意焦点都生效）与 `editor`（事件目标落在编辑器内容区内才生效，含其中的 widget）。绑定 SHALL 全平台无条件生效（表内不做平台门）：当前运行目标只有 macOS（Tauri 桌面），跨平台日期未定，无测试覆盖的平台分支只会成为死代码；迁移前的两处平台门因此消失且 SHALL 被如实记录——⌃N/P/F/B/E 原为 mac-only（`{ mac: "Ctrl-n" }`）现对全部平台生效（⌃N 在部分桌面环境是系统级「新建」惯例），`Mod-Enter` 迁为 `⌘Enter` 后非 mac 的 Ctrl-Enter 变体不再存在。将来引入跨平台目标时 SHALL 重新引入平台门（给 ⌃ 系绑定加平台维度，或把 ⌃N 一类让回系统惯例）。命令实现 SHALL 按归属留在各自模块（编辑器侧命令在 `src/editor.ts`，文档与链接命令在装配层 `src/main.ts`），并 SHALL 由装配处注入分发器。

分发 SHALL 只有一条路径：一个挂在 window 上的 keydown 分发器。MUST NOT 存在并列的键位旁路——编辑器 keymap、`domEventHandlers`、裸 window 监听各注册一份同一物理组合，是同一组合多处漂移的成因（⌘A/⌃A 曾都当全选、⌘S/⌃S 曾都当保存）。每条绑定 SHALL 有归属命令；每条命令 SHALL 要么至少有一条绑定，要么登记在默认不绑键清单里（`src/keys.ts` 的 `KEYLESS_COMMAND_IDS`）——两者皆不占的命令即孤儿命令，SHALL 由装配期校验拦下。这份清单是「默认不绑键」的**显式出口**，不是判据的放松：清单项 MUST NOT 同时出现在 `KEY_BINDINGS` 里（否则清单在说谎），清单 MUST NOT 含 `COMMAND_IDS` 之外的 id，且「有实现但既不绑键也没登记」的命令 MUST NOT 通过校验——M131 要消灭的正是「命令实现了但没人绑」那种静默状态，本版把它的反面（有意的默认不绑键）变成要签字的决定。归一化后重复的绑定 SHALL 在装配期直接失败（MUST NOT 让后注册者静默覆盖前者，也 MUST NOT 让缺实现的绑定静默失效）。

分发器 SHALL 对已经消费的事件让路（`defaultPrevented` 直接返回且不改 chord 状态），SHALL 在输入法组合期（`isComposing` 或 keyCode 229）不接管，并 SHALL 在命中绑定时吞掉默认行为——命令本身无事可做时同样吞掉（例如撤销栈为空时的 ⌘Z），MUST NOT 把按键放回原生 contenteditable 路径。

#### Scenario: 表的不变量

- **WHEN** 装配应用（构造分发器并注入命令实现）
- **THEN** 表内无重复绑定、每条绑定都有归属命令与来由、清单里没有孤儿命令（每条命令都有绑定或已在默认不绑键清单里登记），装配不抛错

#### Scenario: 默认不绑键的命令是显式登记

- **WHEN** 对账 `COMMAND_IDS`、`KEY_BINDINGS` 与 `KEYLESS_COMMAND_IDS` 三者
- **THEN** 每条命令恰好满足「有绑定」或「在清单里」之一；清单里没有 `COMMAND_IDS` 之外的 id；清单与绑定表无交集（同一命令不会既声明默认不绑键又带着默认绑定）；把这两类对账任一处破坏，校验即失败（判据 MUST NOT 退化成「只要没崩就算过」）

#### Scenario: editor 作用域不越界

- **WHEN** 焦点不在编辑器内（例如焦点在页面其它区域）时按下 editor 作用域的键（如 ⌃A）
- **THEN** 编辑器状态（选区与文档）保持不变，该按键不由本层接管

#### Scenario: global 作用域不受焦点影响

- **WHEN** 焦点不在编辑器内时按下 ⌘S
- **THEN** 保存照常按保存链路执行（作用域为 global 的绑定与焦点无关）

#### Scenario: widget 焦点委托同一命令层

- **WHEN** 焦点落在编辑器内的 widget（表格滚动容器）上时按下 editor 作用域的键（如 ⌃A）
- **THEN** 命令经同一分发器执行、作用于 CM 的当前选区；widget 自己的焦点作用域键（Escape / Home / End / 左右方向键）同样经统一键位表分发（绑定以 `when` 条件限定在 widget 焦点时命中，不满足则不消费事件）

### Requirement: 轨道 D 的 widget 滚动键纳入统一键位表

块级横滚容器（livePreview 的 grid 表格 widget、以及围栏 / 缩进代码块的横滚容器，`tabindex=0`）的
焦点作用域键——`←`、`→`、`Home`、`End`、`Escape`——SHALL 由统一键位表分发，MUST NOT 在
`livePreview.ts` 保留并列的 keydown 手柄（同一物理组合两处各写一份即 M131 要消灭的旁路形态）。

这些物理键在文本编辑中另有语义（原生 caret / 行首尾 / 取消），故绑定 SHALL 带**命中条件**；条件
不满足时 SHALL NOT 消费事件（不 `preventDefault`），文本编辑中的同名键 SHALL 照旧走原生路径。
命中条件 SHALL 表达「容器自身持有这次按键的焦点」，且 SHALL 只此一处实现、由所有块级横滚容器共用
（判据的 class 集合与 `closest(...)` 判定 SHALL 单一来源于 `src/keys.ts`）：新增一种容器时 MUST NOT
各写一份判定——同语义两处真源正是归档后会漂移的那种缺口。命令 SHALL 接收触发事件以定位事件目标，
MUST NOT 依赖全局焦点猜测。行为 SHALL 与迁移前一致：左右各 120px 步进、`Home` 横向回最左、`End`
横向到最右、`Escape` 把焦点交还编辑器。

本 requirement 取代 change `keymap-unify` 增量中「widget 自己的焦点作用域键（Escape / Home / End /
左右方向键）仍由该 widget 现有手柄先消费，本层对已消费事件让路」一句——该句描述的是收编前的分工，
已不再成立，归档时已按本 requirement 修订（原句见
`openspec/changes/archive/2026-09-13-keymap-unify`）。本 change 修订本 requirement 的两种情形：其一，
容器从「表格滚动容器」泛化为「块级横滚容器」，把围栏 / 缩进代码块新引入的横滚容器纳入同一判据
（该容器由 `editor-live-preview` 的「折行渲染与代码块横滚容器」要求产生，命令侧不再各写一份）；
其二，命中条件的语义由「事件目标落在容器内」明确为「容器自身持有焦点」——后者才能把光标落在块内
文本时的方向键留给 caret 路径，与前一条 requirement 的「文本中的方向键不受影响」自洽。

#### Scenario: 容器焦点内的滚动键

- **WHEN** 焦点落在超宽表格的滚动容器上，依次按下 `→` 与 `End`
- **THEN** 容器横向滚动 120px、随后滚到最右（右缘覆盖表格自然宽）；按 `Home` 回到最左；按 `Escape`
  后焦点回到编辑器内容区

#### Scenario: 代码块容器与表格容器同判据同行为

- **WHEN** 默认折行口径下打开含超长代码行的 Markdown，用 `Tab` 把焦点移入代码块横滚容器，依次按下
  `→`、`End`、`Home`、`Escape`
- **THEN** 与表格容器完全同形的结果：横向滚动 120px、滚到最右、回到最左，`Escape` 把焦点交还编辑器
  内容区；全程文档内容逐字节不变。MUST NOT 出现「容器焦点了但方向键无反应」的第三种状态

#### Scenario: 文本中的方向键不受影响

- **WHEN** 焦点在编辑器文本中（不在块级横滚容器里）按下 `←`
- **THEN** 光标按原生路径左移一个字符（绑定条件不满足，事件未被消费）

#### Scenario: 光标落在块内文本时方向键仍归 caret

- **WHEN** 在 md 模式里把光标点进代码块的源码文本（焦点在编辑器内容区，容器未成为活动元素），按 `←`
- **THEN** 光标按原生路径移动，容器不横向滚动、事件未被消费；命令的命中条件 MUST NOT 把「光标在某
  容器内的文本里」误读成「该容器持有焦点」

### Requirement: 键位查看面板（app.describe-bindings）

应用 SHALL 提供命令 `app.describe-bindings`，作用域 `global`，默认绑定 `⌘/`，实现落在装配层（`src/main.ts`）。该命令 SHALL 进 `KEY_BINDINGS` 与 `GLOBAL_COMMAND_IDS`，因此 `[keys]` 配置 SHALL 能像其余命令一样对它重绑或解绑；其 `doc` 字段 SHALL 写明 `⌘/` 的来由（macOS 的「帮助」菜单 accelerator 实为 `⇧⌘?`＝`Cmd-?`，该键在本应用的原生菜单下会先被系统 Help 菜单截获，故取 `⌘/`；Emacs 的 `C-h b` 不可用——`⌃H` 已被后删字符占用）。

面板 SHALL 列出**生效中**的键位表——即分发器真正在用的那份（默认表经 `applyKeyOverrides` 处理后的产物），MUST NOT 只渲染静态默认表。每条绑定 SHALL 显示键位写法与该绑定的来由（`doc`）；MUST NOT 出现「表里有绑定但面板看不见」的静默遗漏。

面板 SHALL 按功能族分组渲染（移动与选择 / 扩选 / 删除 / kill-yank / 翻屏 / 撤销 / widget / 标签 / 全局）。**有命令实现但当前无任何键位指向它**（被 `[keys]` 解绑、或该命令默认不绑键）时，该命令 SHALL 仍被列出并标注「未绑定」，且该行 SHALL 说清**成因与下一步**——「默认不占键位」与「已被配置解绑」两种成因都要能被读到，并指明可用 `[keys]` 配置绑定；MUST NOT 让用户只能猜「这个命令是不是坏了」。解绑或默认不绑键 MUST NOT 让命令从视野里消失。分组是呈现层概念，MUST NOT 改变作用域语义（作用域仍由命令归属决定）。

（复原说明：本条正文的分组枚举补入「标签」组。living spec 的枚举停留在 8 组，与实现
（`src/bindings-panel.ts:31-45`，9 组且「其他」为兜底）及门禁场景（`m133` 冻结 9 个标题）不一致；
这是本 requirement 被 MODIFIED 时的对齐，不是本 change 引入的行为变更。）

面板 SHALL 打开即见、关掉即走：`⌘/` 打开（打开态再按即关）；`Escape`、`⌃G` 与点击遮罩三条路径 SHALL 均可关闭；关闭后焦点 SHALL 交还编辑器。面板打开期间 SHALL 接管焦点，编辑器作用域的键 MUST NOT 穿透到文档（不改文档内容、不移动光标）。`Tab` / `⇧Tab` SHALL 留在面板内（面板无可聚焦子元素，放行会让焦点落进编辑器内容区——那之后穿透保证即失效）。

面板的关闭键（`Escape` / `⌃G`）SHALL 由面板在模态遮罩上就地消费，MUST NOT 为同一物理组合在统一键位表之外注册**第二条分发绑定**：表的不变量是「一个 token 一条绑定」，这两个 token 已被占用（`Escape` 归 `editor.widget-escape`（带 `when` 条件）、`⌃G` 归 `editor.keyboard-quit`），面板打开时那两条绑定因作用域与条件均不命中——就地消费与表内分发互斥，不构成同一物理组合的两份分发映射。关闭键的匹配 SHALL 复用键位层的 token 归一化口径（`keyToken`），MUST NOT 另写一套匹配。本版 SHALL NOT 为这两个键改动「一个 token 一条绑定」的装配期不变量。

视觉 SHALL 沿用既有排版基线与样式变量（占位实现），MUST NOT 引入新视觉语言。

#### Scenario: 打开面板看到生效表

- **WHEN** 不在任何 `[keys]` 覆盖下打开应用，按 `⌘/`
- **THEN** 面板可见并按功能族分组列出全部键位（逐绑定一行，键位写法 + 来由），每条有实现且有绑定的命令都出现在面板里；面板行数 SHALL 等于生效绑定条数加上默认不绑键的命令数（后者的键位列显示「未绑定」），MUST NOT 出现「命令从视野里消失」的静默遗漏

#### Scenario: 未绑定行说清成因与下一步

- **WHEN** 不在任何 `[keys]` 覆盖下按 `⌘/`，读默认不绑键命令（如 `view.toggle-line-wrap`）那一行；
  再用 `[keys]` 把 `document.save` 解绑（值写 `null`）后重开面板，读该行
- **THEN** 两行都标注「未绑定」，说明文本都能读出成因（前者是「默认不占键位」，后者是「已被配置
  解绑」）并指明可用 `[keys]` 配置绑定；两行 MUST NOT 只给一个「未绑定」字样而让人猜原因

#### Scenario: 配置重绑 / 解绑后按生效表渲染

- **WHEN** 配置 `{"keys": {"Ctrl-j": "editor.undo"}}` 后按 `⌘/`；或配置 `{"keys": {"Cmd-s": null}}` 后按 `⌘/`
- **THEN** 前者面板里出现 `⌃J → editor.undo` 这一行（带「用户配置重绑」来由），默认的 `⌘Z` 仍在；后者 `document.save` 仍被列出、标注「未绑定」，其余行数不变

#### Scenario: 面板打开期间编辑键不穿透

- **WHEN** 光标停在文档中，按 `⌘/` 打开面板，随后依次按 `⌃D`（后删）、`⌃K`（kill 行）、`⌃A`（行首）、`⌃⇧F`（扩选）、`Tab` 并输入若干字符
- **THEN** 文档内容逐字节不变、光标位置不变、焦点仍在面板内（面板持有焦点，`editor` 作用域不命中；`Tab` 不把焦点送出面板）；按 `Escape` 关闭后焦点回到编辑器，再按 `⌃D` 恢复删除字符

#### Scenario: 三条关闭路径

- **WHEN** 面板打开时按 `Escape`；再次打开后按 `⌃G`；再次打开后点击遮罩（面板之外的区域）
- **THEN** 三种操作都关闭面板；点击面板本体不关闭；面板打开态再按 `⌘/` 也关闭

## ADDED Requirements

### Requirement: 折行开关命令（view.toggle-line-wrap / view.toggle-code-block-wrap）

系统 SHALL 提供两条命令承担「翻转折行开关」：`view.toggle-line-wrap` 与 `view.toggle-code-block-wrap`。
两条命令的作用域 SHALL 为 `global`，实现 SHALL 落在装配层（`src/main.ts`），折行的能力与状态归属 SHALL 在
`src/editor.ts`；翻转的语义与作用面 SHALL 按 `editor-live-preview` 的「折行开关的瞬态口径」与「折行口径与
配置来源」两条 requirement（当前标签页的瞬态覆盖、立即生效、不落盘、不持久化）。

两条命令 SHALL 默认**不绑键**，并 SHALL 登记进默认不绑键清单（`src/keys.ts` 的 `KEYLESS_COMMAND_IDS`，见
「统一键位分发表」）。它们 MUST NOT 出现在 `KEY_BINDINGS` 里——本版不为折行占用任何物理键位。`[keys]` 配置
SHALL 能像其余命令一样把它们绑上键：两条 id 都在 `COMMAND_IDS` 里，故不会走到「未知命令」的拒绝路径；
`Keymap.attach` 的校验是「绑定 → 有实现」，绑定后即生效。

作用域取 `global` 而非 `editor` 的理由 SHALL 记录在实现处（命令记录的注释）与 `doc` 语义里：命令作用于当前
标签页的显示属性（窗口级对象，与 `tab.*`、`toc.toggle` 同族），焦点在文件树 / 搜索框 / 浮层里时同样应能
切换。命令 id 前缀因此取 `view.` 而不是 `editor.`——本仓的既有约定是 `editor.` 前缀属于编辑器作用域命令
（作用域由命令清单派生，`applyKeyOverrides` 只认清单不认前缀），前缀与作用域 MUST NOT 互相矛盾。由此带来
的边界 SHALL 如实记录：`global` 作用域意味着模态面板 / 浮层持有焦点时这两条命令同样命中——这不与「面板
打开期间编辑键不穿透」的保证冲突，那条保证针对会改文档的 `editor` 命令，而这两条只改显示状态、MUST NOT
碰文档（对应 scenario 见 `editor-live-preview` 的「折行开关的瞬态口径」）。

本项目没有「按命令 id 取 doc」的通用通道：`doc` 只存在于**绑定**对象上（`KeyBinding.doc`，
`src/keys.ts:187-202`），默认不绑键的命令因此在 `KEY_BINDINGS` 里没有可读的 doc。面板对未绑定行显示的是
面板自带的通用说明串（`src/bindings-panel.ts:93-103`），故本 requirement MUST NOT 依赖「命令的 doc 字段」
来让未绑定行自解释，而是要求该通用串覆盖「默认不占键位」这一成因（见「键位查看面板」）。两条命令 SHALL
落进既有「全局」分组，MUST NOT 新增分组（分组标题是文案交付物；不新增分组即不动既有分组标题条目）。

已知边界（如实记录）：未配置 `[keys]` 时这两条命令没有可触发路径——本仓键位层不支持多段 chord（含空白的
键位被拒），也没有 Emacs `M-x` 那样的通用命令入口，而 Lumir 现在还没有 `M-x`。因此本 requirement 的验收面
是「能绑上并真的生效」，而「不配置也能用到」不在本版范围内。另：本版不为翻转提供 toast 播报或常驻指示
（理由与替代落点见 change `line-wrap-options` 的 proposal 与 design），因此验收断言 MUST NOT 依赖任何
提示文本，只能看文档呈现与配置文件的字节。

#### Scenario: 装配期对账不因新增命令而失效

- **WHEN** 装配应用（构造分发器并注入命令实现）
- **THEN** 表内仍无重复绑定、每条绑定都有归属命令与来由；两条折行命令在默认不绑键清单里、不在绑定表里；
  清单无幻影 id、与绑定表无交集；装配不抛错

#### Scenario: 配置绑定后真的能触发

- **WHEN** 配置 `{"keys": {"Ctrl-j": "view.toggle-line-wrap"}}` 后启动应用（⌃J 是默认表里的空位），在打开的
  文件上按下该键
- **THEN** 触发的是折行翻转——不出「未知命令」warning、不是无反应：当前标签页的折行呈现立即变化
  （文件级与代码块级各按自己的口径，见 `editor-live-preview` 的「折行渲染与代码块横滚容器」）；
  MUST NOT 依赖 toast 或指示文本判断（本版没有它们）

#### Scenario: 面板列出两条命令并标注未绑定

- **WHEN** 不在任何 `[keys]` 覆盖下按 `⌘/` 打开键位面板
- **THEN** 「全局」分组里出现 `view.toggle-line-wrap` 与 `view.toggle-code-block-wrap` 两行，键位列显示
  「未绑定」，说明列能读出成因（默认不占键位、可用 `[keys]` 绑定）；面板不新增分组
