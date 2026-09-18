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

### Requirement: 键位查看面板（app.describe-bindings）

应用 SHALL 提供命令 `app.describe-bindings`，作用域 `global`，默认绑定 `⌘/`，实现落在装配层（`src/main.ts`）。该命令 SHALL 进 `KEY_BINDINGS` 与 `GLOBAL_COMMAND_IDS`，因此 `[keys]` 配置 SHALL 能像其余命令一样对它重绑或解绑；其 `doc` 字段 SHALL 写明 `⌘/` 的来由（macOS 的「帮助」菜单 accelerator 实为 `⇧⌘?`＝`Cmd-?`，该键在本应用的原生菜单下会先被系统 Help 菜单截获，故取 `⌘/`；Emacs 的 `C-h b` 不可用——`⌃H` 已被后删字符占用）。

面板 SHALL 列出**生效中**的键位表——即分发器真正在用的那份（默认表经 `applyKeyOverrides` 处理后的产物），MUST NOT 只渲染静态默认表。每条绑定 SHALL 显示键位写法与该绑定的来由（`doc`）；MUST NOT 出现「表里有绑定但面板看不见」的静默遗漏。

面板 SHALL 按功能族分组渲染（移动与选择 / 扩选 / 删除 / kill-yank / 翻屏 / 撤销 / widget / 标签 / 全局）。**有命令实现但当前无任何键位指向它**（被 `[keys]` 解绑、或该命令默认不绑键）时，该命令 SHALL 仍被列出并标注「未绑定」——解绑或默认不绑键 MUST NOT 让命令从视野里消失。分组是呈现层概念，MUST NOT 改变作用域语义（作用域仍由命令归属决定）。

面板 SHALL 打开即见、关掉即走：`⌘/` 打开（打开态再按即关）；`Escape`、`⌃G` 与点击遮罩三条路径 SHALL 均可关闭；关闭后焦点 SHALL 交还编辑器。面板打开期间 SHALL 接管焦点，编辑器作用域的键 MUST NOT 穿透到文档（不改文档内容、不移动光标）。`Tab` / `⇧Tab` SHALL 留在面板内（面板无可聚焦子元素，放行会让焦点落进编辑器内容区——那之后穿透保证即失效）。

面板的关闭键（`Escape` / `⌃G`）SHALL 由面板在模态遮罩上就地消费，MUST NOT 为同一物理组合在统一键位表之外注册**第二条分发绑定**：表的不变量是「一个 token 一条绑定」，这两个 token 已被占用（`Escape` 归 `editor.widget-escape`（带 `when` 条件）、`⌃G` 归 `editor.keyboard-quit`），面板打开时那两条绑定因作用域与条件均不命中——就地消费与表内分发互斥，不构成同一物理组合的两份分发映射。关闭键的匹配 SHALL 复用键位层的 token 归一化口径（`keyToken`），MUST NOT 另写一套匹配。本版 SHALL NOT 为这两个键改动「一个 token 一条绑定」的装配期不变量。

视觉 SHALL 沿用既有排版基线与样式变量（占位实现），MUST NOT 引入新视觉语言。

#### Scenario: 打开面板看到生效表

- **WHEN** 不在任何 `[keys]` 覆盖下打开应用，按 `⌘/`
- **THEN** 面板可见并按功能族分组列出全部键位（逐绑定一行，键位写法 + 来由），每条有实现且有绑定的命令都出现在面板里；面板行数 SHALL 等于生效绑定条数加上默认不绑键的命令数（后者的键位列显示「未绑定」），MUST NOT 出现「命令从视野里消失」的静默遗漏

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

作用域取 `global` 而非 `editor` 的理由 SHALL 记录在 `doc` 字段里：命令作用于当前标签页的显示属性（窗口级
对象，与 `tab.*`、`toc.toggle` 同族），焦点在文件树 / 搜索框 / 浮层里时同样应能切换。命令 id 前缀因此取
`view.` 而不是 `editor.`——本仓的既有约定是 `editor.` 前缀属于编辑器作用域命令（作用域由命令清单派生，
`applyKeyOverrides` 只认清单不认前缀），前缀与作用域 MUST NOT 互相矛盾。

两条命令的 `doc` 字段 SHALL 写明「默认不绑键、经 `[keys]` 配置绑定后可用」，使键位面板里的「未绑定」行
能自解释。它们 SHALL 落进既有「全局」分组，MUST NOT 新增分组（分组标题是文案交付物；不新增分组即不动
既有分组标题条目）。

已知边界（如实记录）：未配置 `[keys]` 时这两条命令没有可触发路径——本仓键位层不支持多段 chord（含空白的
键位被拒），也没有 Emacs `M-x` 那样的通用命令入口，而 Lumir 现在还没有 `M-x`。因此本 requirement 的验收面
是「能绑上并真的生效」，而「不配置也能用到」不在本版范围内。

#### Scenario: 装配期对账不因新增命令而失效

- **WHEN** 装配应用（构造分发器并注入命令实现）
- **THEN** 表内仍无重复绑定、每条绑定都有归属命令与来由；两条折行命令在默认不绑键清单里、不在绑定表里；
  清单无幻影 id、与绑定表无交集；装配不抛错

#### Scenario: 配置绑定后真的能触发

- **WHEN** 配置 `{"keys": {"Ctrl-j": "view.toggle-line-wrap"}}` 后启动应用（⌃J 是默认表里的空位），在打开的
  文件上按下该键
- **THEN** 触发的是折行翻转——不出「未知命令」warning、不是无反应：当前标签页的折行呈现立即变化并给出
  瞬态反馈

#### Scenario: 面板列出两条命令并标注未绑定

- **WHEN** 不在任何 `[keys]` 覆盖下按 `⌘/` 打开键位面板
- **THEN** 「全局」分组里出现 `view.toggle-line-wrap` 与 `view.toggle-code-block-wrap` 两行，键位列显示
  「未绑定」，来由列写明「默认不绑键、经 `[keys]` 配置绑定后可用」；面板不新增分组
