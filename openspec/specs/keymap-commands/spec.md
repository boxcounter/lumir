# keymap-commands Specification

## Purpose
全应用键位的单一事实来源与分发合同：唯一一张 key → command 表（`src/keys.ts`）驱动所有编辑、文档与 widget 焦点键，口径为「⌘ 系归 macOS 惯例、⌃ 系归 Emacs 惯例」，覆盖移动 / 扩选 / 删除 / kill-yank / 撤销与配置层（`[keys]` 重绑与解绑）。由 change `toc-popover-emacs-keys-and-max-height` 归档并入的增量（2026-09-18，实现 M160）：`大纲开关——⌘⇧O 与 toc.toggle` 的浮层就地键枚举由三个（`↑↓` / `Enter` / `Esc`）扩为五个（新增 `⌃N` / `⌃P`），并写明这两键不进本表的理由。由 change `typography-and-zoom` 归档并入的增量（2026-09-24，实现 M195）：字号步进命令 `view.text-scale-up` / `-down` / `-reset` 与其默认键位（`⌘=` / `⌘−` / `⌘0`，全局面作用域）。

## Requirements

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

### Requirement: ⌘ 与 ⌃ 分离

键位 token SHALL 逐修饰键记录（Cmd / Ctrl / Alt / Shift），MUST NOT 把 ⌘（metaKey）与 ⌃（ctrlKey）合并为同一修饰。⌘ 系绑定 SHALL 遵循 macOS 惯例，⌃ 系 SHALL 遵循 Emacs 惯例。归一化 SHALL 与运行期事件同源：表内写法与事件 token 走同一归一化函数，修饰前缀顺序与大小写无关。两类字符陷阱 SHALL 有明确口径：US 布局上需 Shift 才能打出的符号（如 `_`）按「Shift 已隐含在字符里」归一（⌃_ 在 mac 键盘上物理是 ⌃⇧-，表内写 `Ctrl-_` 即可匹配）；含 Alt 的组合 SHALL 按物理键（`KeyboardEvent.code`）判定——macOS 的 Alt 层会替换字符（⌥⇧- 给的是 `—`、⌥a 给的是 `å`），`e.key` 判别不了用户按的键，⌃⌥_ 这类别名因此以物理键名入表（`Ctrl-Alt-Minus`）。纯修饰键 SHALL NOT 参与键位判定。

绑定裁决：`⌘A` = 全选（D2）；`⌃A` = 行首（D2，Emacs `C-a`，与 ⌃E 行尾对称）；`⌘S` = 保存唯一键（D3）；`⌃S` SHALL 解绑（预留给 isearch），MUST NOT 触发保存。

#### Scenario: ⌃A 到行首、⌘A 全选

- **WHEN** 光标停在某正文行中段，按下 ⌃A
- **THEN** 光标折叠到该行行首（不形成选区、不全选）；随后按下 ⌘A 才选中整篇文档

#### Scenario: ⌘S 与 ⌃S

- **WHEN** 文档 dirty 时按下 ⌃S，再按下 ⌘S
- **THEN** ⌃S 不产生任何写入、dirty 不变、无保存反馈；⌘S 走保存链路落盘并清除 dirty

### Requirement: 编辑器光标命令的硬化底座

所有光标移动命令 SHALL 建在既有 widget 硬化原语上：caret 与滚动按可见侧取 assoc、`scrollIntoView` 传 SelectionRange 而非裸位置、坐标测量退化时回退、跨块级原子 widget 时钳制落点。MUST NOT 换用 CM stock 光标命令，也 MUST NOT 把按键留给原生 contenteditable 路径（M103 垂直移动、M110/M111 水平移动、M113/M118 表格与公式边界的缺陷族同根因）。键位来源变更（从 CM keymap 迁入统一表）MUST NOT 改变既有移动语义。

行首命令 SHALL 与行尾命令对称：同取文本行边界（硬边界，段落语义，不受软换行截断），落点紧贴隐藏 replace（表格管道符、块级公式边界）时按可见侧测量，避免揭示滚动把整窗内容拉偏。两个方向共用同一个**落点硬化判据**（见下一条 requirement 的「可停靠」）：落点必须是 caret 有位置的地方。两者的**边界单位**在 grid 表格 row 内不同——⌃E 的边界单位是当前 cell（cell 是表格里的编辑原子单位，与 ⌃D/⌃H/⌃K/⌃T 的「不跨隐藏管道符」纪律同源），⌃A 仍是文本行边界（行的可见行首即首 cell 内容起点，本身就可停靠，无需改口径）。

#### Scenario: 既有 6 键行为不变

- **WHEN** 在表格围绕的文档中用 ⌃N/⌃P/⌃F/⌃B/⌃E 与 ArrowUp/ArrowDown 移动光标
- **THEN** 落点、跨表格路由、列位保持与滚动揭示与迁移前逐场景一致（既有视觉场景全绿、零基线更新）。M168 对 grid 表格 cell 内 ⌃E 落点的修订（见下一条 requirement）是这条「不变」之外的显式契约变更，其余键与本场景逐条照旧

#### Scenario: ⌃A 落点在隐藏内容邻接位

- **WHEN** 光标在 grid 表格行内，按下 ⌃A
- **THEN** 光标落在该表格行的可见行首（行内第一个可测量位置：隐藏管道符零宽，视觉位置即首 cell 起点），坐标不退化且不出现整窗内容下挫。M168 后此口径不变：行的可见行首本身可停靠，不需要并入 ⌃E 的 cell 级边界单位

### Requirement: 表格 cell 内的行尾落点与「可停靠」判据

**可停靠（dockable）**：位置 `p` 可停靠当且仅当 `coordsAtPos(p, 1)` 既非 null 也非全零 rect。取前侧（+1）不是随意选择：光标回读后 `assoc` 归 0，caret 的绘制与后续测量都按 `assoc || 1` 取侧，因此**前侧可测**才等于「这里画得出光标」。隐藏 replace（表格管道符、标题尾部标记）在 DOM 里是 `display:none` 元素，其左缘位置的 DOM 选区解析退化为行元素级位置，浏览器随后把 caret 画到下一条被绘制的行上——**M168 报告的缺陷现场**：⌃E 落在这里时「光标进入下面一行的 cell」（真实桌面实测：原生 caret 矩形 0×0，落到下一 row 的 cell 上）。M118 修的是同一族缺陷的另一半：当时的回退判据看的是**后侧**（`assoc -1`），而 caret 画在前侧，隐藏管道符边界因此被判成「可停靠」、落点停在无 caret 的边界位上，缺陷漏了下来。

**⌃E 在 grid 表格 row 内的落点**：SHALL 是**当前 cell 内容区**（表格模型给出的 slot，去掉尾部对齐空白）内**最右的可停靠位置**；按字素簇回退（不拆代理对与组合序列），回退下界是该 cell 内容的左缘。MUST NOT 越过隐藏管道符落到同 row 的其它 cell，MUST NOT 落到相邻 row（起点落在 cell 右边界位、按下方 M185 归属口径顺延到下一 cell 的情形除外——那种起点的可见 caret 本就在下一 cell）。不是整个表格行的行尾（那是末 cell），也不是文本行行尾（那里是隐藏管道符边界）。

**⌃E 的 cell 归属（M185）**：落点所属的「当前 cell」SHALL 按 caret 的**可见位置**判定。cell 内容区包含 caret 时归属该 cell；caret 停在 cell 右边界位（slot 的 `to`，即紧随其后的隐藏管道符左缘）且**已越过本 cell 内容右缘**（本 cell 有尾部对齐空白）时，SHALL 归属同一 row 的**下一 cell**——该边界位的原生 caret 矩形退化为 0×0（M185 chromium 实测：`coordsAtPos(pos, ±1)` 两侧都退化、DOM 选区矩形 0×0），浏览器把它画在管道符之后第一个被绘制的内容上，即下一 cell 内容的左缘，用户看到的光标在下一 cell 里。**不变量**：⌃E MUST NOT 因归属判定把光标跨 cell 往回送——停在 cell i 右边界位时，本 cell 的内容右缘在起点**之前**（已越过它），按本 cell 解析会先倒退一格再跨回 cell i（M185 缺陷现场：⌃E→⌃F→⌃E 的第二次 ⌃E「回到刚才那个 cell 的尾部」）。以下三种形态 SHALL NOT 顺延，各自保持本条款既有的落点口径（落点仍是归属 cell 内容内的最右可停靠位）：① 本 cell 内容紧贴管道符（无尾部对齐空白，右边界位本身就是内容右缘）；② 下一 cell 无内容（空 cell / 短行补空列——它的内容右缘不存在，唯一候选位不可停靠，顺延会把落点送进 M168 的缺陷现场）；③ 本 cell 是 row 的末 cell（右侧是尾管道 / 行尾，跨 row 归属被上一条 MUST NOT 禁止）。

**已知边界（如实记录，缺陷在案）**：cell 内容紧贴管道符（`|alpha|tax|` 这类无对齐空白的表）时，cell 内容右缘本身即管道符左缘、不可停靠，而它左侧没有可跳过的对齐空白——此时落点是该 cell 内容内最右的可停靠位，即内容右缘**左侧一个字素簇**的位置。**操作后果要说清**：这一形态下 ⌃E 后的插入点不在内容右缘，接着打字会落在末字素之前（用户可以看见，可撤销）；换来的是 caret 在该形态下也有位置（不再被画到下一 row 的 cell 上）。表格行里带对齐空白的形态在用户 vault 实测占 3445/3825，紧贴形态 380/3825。根因是隐藏管道符用 `display:none` 承载（整个「隐藏 replace 邻接位测量退化」缺陷族的共同结构，M110/M111/M113/M118/M132 同源），修它要动装饰层 DOM 结构，不在本条款范围内。

#### Scenario: cell 内 ⌃E 落在当前 cell 的内容右缘

- **WHEN** 光标停在 grid 表格某一行的非末尾 cell 内（该 cell 内容两侧有对齐空白），按下 ⌃E
- **THEN** 光标落在该 cell 内容的右缘位置（去掉尾部对齐空白后的末端），MUST NOT 跳到同 row 的末 cell、MUST NOT 落到相邻 row；原生 caret 有可视位置（矩形高度非 0），且落在出发的那个 cell 内

#### Scenario: cell 内 ⌃E→⌃F→⌃E 的第二次 ⌃E 留在下一个 cell

- **WHEN** 光标在 grid 表格某 cell 内（该 cell 有尾部对齐空白，右侧还有内容非空的 cell）：按 ⌃E 落在该 cell 内容右缘，再按 ⌃F（落点是紧随其后的隐藏管道符左缘，即该 cell 的右边界位），再按 ⌃E
- **THEN** 第二次 ⌃E 的落点是**下一个 cell** 内容区内的最右可停靠位（该 cell 内容右缘，或紧贴管道符形态下的次右可停靠位）；MUST NOT 回到前一个 cell 的尾部；落点归属下一个 cell（原生 caret 矩形高度非 0，可停靠）

#### Scenario: 边界位归属不回退：空 cell / 短行补空列 / 末 cell 三种形态

- **WHEN** 对 下一 cell 为空 cell × 下一 cell 为零宽补空列 × 本 cell 为 row 末 cell 三种形态，各自把光标停在 cell 右边界位后按 ⌃E
- **THEN** 光标不跨回上一个 cell、不落到相邻 row：落点回到**本 cell** 内容右缘（末 cell 形态下光标从边界位退回一个位置，仍是本 cell 内容区内可停靠的右缘），文档逐字节不变

#### Scenario: ⌃E 取 cell 内最右可停靠位，重复按不漂移

- **WHEN** 在 cell 内按下 ⌃E，再按一次
- **THEN** 第一次落点到该 cell 内容右缘之间不存在可停靠位置（即已取最右）；第二次落点与第一次相同

#### Scenario: 表格形态矩阵下的 ⌃E 落点

- **WHEN** 对 列数 × 是否有对齐空白 × 是否有收尾管道符 × 是否短行补空列 的形态矩阵逐格按 ⌃E
- **THEN** 每一形态都满足：仍在该行、落点在该 cell 内容区内、caret 有可视位置且归属该 cell、重复按不漂移；各形态下 `EditorState.doc` 逐字节不变

### Requirement: 撤销与重做

编辑器 SHALL 提供撤销与重做能力，撤销栈由 CM 的 history 扩展持有（线性双栈 `done` / `undone`，暂不提供 Emacs 链式 undo）。绑定：`⌘Z` = 撤销、`⌘⇧Z` = 重做、`⌃/` = 撤销（Emacs 规范绑定）、`⌃_` = 撤销（Emacs 别名）、`⌃⌥_` = 重做（Emacs 系别名）。同一命令 SHALL 既是键盘路径也是菜单路径的落点。

文档装载事务（打开文件、外部重载、vault 复位产生的整篇替换）SHALL NOT 进入撤销史，且 SHALL 使被替换掉的旧撤销事件失效——撤销 MUST NOT 跨文档把上一个文档的内容搬进当前文档。撤销 / 重做产生的文档变化 SHALL 与保存链路保持一致：dirty SHALL 仍以「当前文本与已保存基线比较」判定，因此撤销回到已保存内容时 dirty SHALL 收窄为 false；撤销 / 重做 SHALL 照常参与自动保存 debounce 与 dirty 守卫。

#### Scenario: 撤销回到已保存内容

- **WHEN** 打开一个已保存文件，输入若干字符使文档 dirty，然后按下 ⌘Z
- **THEN** 文档回到打开时的内容，dirty 收窄为 false（masthead 未保存标记与后端 dirty 镜像一并复位）

#### Scenario: Emacs 别名与重做

- **WHEN** 输入后依次按下 ⌃/（撤销）、⌃⌥_（重做）
- **THEN** 文档先回到输入前，再恢复到输入后；⌃_ 与 ⌘⇧Z 同样分别产生撤销与重做

#### Scenario: 撤销不跨文档

- **WHEN** 在文件 A 中编辑并保存后切换到文件 B，然后按下 ⌘Z（或 ⌘⇧Z）
- **THEN** 文件 B 的内容保持不变，不出现文件 A 的内容被"撤"进 B 的情况

#### Scenario: 只读模式下撤销无事发生

- **WHEN** 当前文档以只读 code 模式打开（M130 方向 A）时按下 ⌘Z
- **THEN** 文档内容不变（只读保证不因撤销能力而放宽）

### Requirement: 菜单与命令层一致

macOS 原生菜单 MUST NOT 提供第二套撤销：Edit 子菜单 MUST NOT 保留直连原生 responder chain 撤销栈的预置 Undo/Redo 项（Lumir 的文档由编辑器内核持有，撤销栈只有一份）。菜单的撤销 / 重做入口 SHALL 经事件交回前端同一命令层执行，MUST NOT 自带 accelerator——⌘Z / ⌘⇧Z SHALL 留给 webview 的 keydown 路径由统一键位层接管，使键盘与菜单两条路进同一个命令实现。

菜单改造 SHALL 对 tauri 默认菜单结构做校验：结构假设不成立时 SHALL 保持默认菜单不改动并留下可诊断的告警，MUST NOT 静默产生半改造的菜单（例如改了撤销项却丢掉退出守卫）。

#### Scenario: 菜单不占 ⌘Z

- **WHEN** 应用启动完成（macOS）
- **THEN** Edit 子菜单的撤销 / 重做项为自定义项且不带 accelerator；⌘Z / ⌘⇧Z 由统一键位层处理，菜单点击经事件通道落到同一命令实现

#### Scenario: 结构假设不成立时的降级

- **WHEN** tauri 升级改动了默认菜单结构（app 子菜单、Edit 子菜单或预置项文案不匹配）
- **THEN** 对应改造整体跳过、保留默认菜单，并输出告警；退出守卫与撤销项之间不出现互相覆盖

### Requirement: Emacs 编辑键（档 1 与档 2）

编辑器 SHALL 提供下列 Emacs 编辑命令，且全部经统一键位表（M131 的 `KEY_BINDINGS` + 分发器）分发：`⌃V` / `⌥V` 视口翻屏、`⌃L` 居中（recenter）、`⌃D` 前删、`⌃H` 后删、`⌃T` 转置、`⌥D` 前删词、`⌥⌫` 后删词、`⌃K` kill 行、`⌃Y` yank、`⌃G` keyboard-quit。MUST NOT 换用 CM stock 命令，MUST NOT 把这些键留给原生 contenteditable 路径（M103/M110/M111/M113/M118 缺陷族同根因：原生 caret 与滚动在 widget / 隐藏 replace 边界上不可控）。

命令 SHALL 建在既有硬化原语上：落点按可见侧取 assoc、`scrollIntoView` 传 SelectionRange 而非裸位置、坐标测量退化时回退可见侧、跨块级原子 widget 时钳制落点。命令 MUST NOT 把揭示滚动做成整窗内容偏移（隐藏 replace 邻接位的退化测量是同一缺陷族的机制）。

编辑命令在只读模式（非 md 打开的文件为只读 code，M130 方向 A）SHALL 一律不动文档，MUST NOT 因新增编辑能力而放宽只读保证。

删除 / 转置命令 SHALL 以字素簇为步长（不拆开代理对与组合序列）。`⌃K` SHALL 遵循 Emacs C-k 的两段语义：光标在行内时 kill 到行尾；光标已在行尾时 kill 掉换行（两行合并）。`⌃D` / `⌃H` / `⌥D` / `⌥⌫` SHALL 在有选区时删除整个选区。`⌃T` SHALL 转置光标两侧字素并把光标移到两者之后；光标在行尾时 SHALL 转置前两个字素且光标原地。`⌃G` SHALL 撤下进行中的选择（折叠为光标，点不回退），MUST NOT 改动文档。`⌃V` / `⌥V` SHALL 只滚动视口（翻一屏减去两行）且不移动光标。`⌃L` SHALL 把光标行滚到视口居中（本版不做 Emacs 的居中 / 页首 / 页尾三段循环）。

#### Scenario: 字符删除与转置

- **WHEN** 光标停在 `abcdef` 的 `b` 与 `c` 之间，依次按下 `⌃D`、`⌃H`
- **THEN** 文档先变为 `abdef`（删掉 `c`）、再变为 `adef`（删掉光标前的 `b`）；随后选中一段再按 `⌃D`，该选区被删除

#### Scenario: 词删除

- **WHEN** 光标停在 `alpha beta gamma end` 的 `beta` 中间按下 `⌥D`，再在空格处按下 `⌥D`，再在 `gamma` 前按下 `⌥⌫`
- **THEN** 依次得到 `alpha be gamma end`（杀到词尾）、`alpha gamma end`（跳过非词字符并杀掉下一个词）、`gamma end`（杀回词首）

#### Scenario: 转置

- **WHEN** 光标停在 `abcd` 的 `b` 与 `c` 之间按下 `⌃T`，随后把光标移到行尾再按 `⌃T`
- **THEN** 文档先变为 `acbd` 且光标落在 `c` 之后（位置 3），再变为 `acdb` 且光标停在行尾

#### Scenario: 翻屏与 recenter

- **WHEN** 在长文档中按下 `⌃V`（再按 `⌥V`），或在光标行不在视口中央时按下 `⌃L`
- **THEN** `⌃V` / `⌥V` 只把视口前后翻一屏且光标位置不变；`⌃L` 把光标行滚到视口中部附近（`scrollIntoView` 的 `y:"center"` 口径，与 wikilink 锚点跳转同款）

#### Scenario: 只读模式下的编辑键

- **WHEN** 以只读 code 模式（非 md 文件）打开文档，按下 `⌃D` / `⌃H` / `⌃K` / `⌃Y` / `⌃T` / `⌥D` / `⌥⌫`
- **THEN** 文档内容与之前逐字节相同（只读保证不因编辑键而放宽）

### Requirement: kill 与 yank（单槽）

编辑器 SHALL 维护**单一** kill 槽：连续同向 kill 相接（上一次 kill 结束后的光标位置就是本次 kill 的起点）时 SHALL 合并进同一槽（Emacs 的连续 kill 合并口径，`⌃K ⌃K` 先杀行内容再杀换行即一次合并），否则 SHALL 覆盖该槽。`⌃Y` SHALL 把槽内容插入光标处（有选区时替换选区）并把光标落在插入内容之后；槽为空时 SHALL 什么都不做。本版 MUST NOT 提供多槽 kill ring。

#### Scenario: 连续 kill 合并后 yank 还原

- **WHEN** 在 `one\ntwo\nthree` 的行首依次按下 `⌃K`、`⌃K`、`⌃Y`
- **THEN** 前两次 kill 把 `one` 与随后的换行合并进同一槽（文档变为 `two\nthree`），`⌃Y` 插回 `one\n`，文档恢复原状且光标落在插入内容之后

#### Scenario: 后向连续 kill 同样合并

- **WHEN** 在 `alpha beta gamma end` 的 `gamma` 之后依次按下 `⌥⌫`、`⌥⌫`、`⌃Y`
- **THEN** 两次后向 kill 合并进同一槽（后杀的词在前、先杀的词在后），`⌃Y` 一次插回即恢复原文档——后向的相接端是本次 kill 的右端（= 上次 kill 后的光标位置），相接判定 MUST NOT 只对前向成立

#### Scenario: 在文档末尾 yank 长槽内容

- **WHEN** 槽内容比光标之后的剩余文档更长（例如先 `⌃K` 杀掉一整行、撤销回原状、再把光标移到文档末尾按下 `⌃Y`）
- **THEN** 槽内容完整插入（文档长度增加槽内容长度），光标落在插入内容之后；MUST NOT 因插入目标位置越出**当前**文档长度而静默失败（实现不得在插入前的文档上测量插入后的光标坐标）

### Requirement: 表格 cell 的删除边界

删除 / 转置 / kill 命令 SHALL 把删除起点与步长钳制在光标所在 grid 表格 cell 的可见内容区间内，MUST NOT 删除隐藏管道符——隐藏管道符是零宽 replace 且承担表格结构，跨过去删除即破坏表格（M129 survey 实证：表格随即降级为原始 Markdown 呈现）。非矩形 / 降级表按原始 Markdown 渲染（管道符可见），不参与钳制。

光标落在表格行内但不在 cell 内容区（管道符区：cell 间隙、行首尾）时，命令 SHALL 不动文档（前进方向可钳到最近的 cell 内容起点，但 MUST NOT 越过管道符）。

#### Scenario: cell 内 kill 到 cell 尾

- **WHEN** 光标在 grid 表格某 cell 内容中按下 `⌃K`
- **THEN** 只 kill 到该 cell 的可见内容右缘，行内管道符一个不少，表格仍以 grid 呈现

#### Scenario: cell 边界不删管道符

- **WHEN** 光标停在末 cell 内容右缘（其后即隐藏管道符）按下 `⌃D` 或 `⌃K`；或光标停在行首管道符与首个 cell 之间按下 `⌃H`
- **THEN** 文档逐字节不变；在 cell 内部按 `⌃H` 只可能吃掉 cell 内的对齐空白，MUST NOT 删除行首管道符

### Requirement: shift-extend 扩选

编辑器 SHALL 提供保持 anchor、只移动 head 的扩选命令：`⌃⇧F` / `⌃⇧B`（字符）、`⌃⇧N` / `⌃⇧P`（逐行）、`⌃⇧A` / `⌃⇧E`（行首 / 行尾）、`⌥⇧F` / `⌥⇧B`（词）。落点 SHALL 复用对应移动命令的硬化落点（数学原子跨入钳制、跨块级原子 widget 钳制、表格行路由与 cell 吸附、隐藏 replace 退化回退），MUST NOT 另写一套移动数学。扩选 SHALL 揭示滚动（`scrollIntoView` 传 SelectionRange）。本版 MUST NOT 引入 mark mode：选区仍只有 anchor / head 两端。

本版已知限制 SHALL 如实记录：M131 定下的 token 口径对含 Alt 的组合只按物理键（`KeyboardEvent.code`）判定、忽略 Shift，故 `⌥⇧F/B` 与 `⌥F/B` 归一到同一 token。绑定 `Alt-KeyF` / `Alt-KeyB` 之后，bare `⌥F` / `⌥B` 也会触发按词扩选；且本版 MUST NOT 再绑 bare `⌥F` / `⌥B` 的单词移动（会与扩选绑定归一到同一 token，装配期以重复绑定失败）。要让二者分开，须先修订 token 口径（含 Alt 的组合纳入 Shift 判定；同时把 `⌃⌥_` 重做别名拆成 `Ctrl-Alt-Minus` 与 `Ctrl-Alt-Shift-Minus` 两条绑定，以同时容纳真机形状与不带 shiftKey 的合成事件），属后续 change 的范围。

#### Scenario: 各方向扩选端点

- **WHEN** 在 `alpha beta gamma` 中，光标停在 `beta` 词首依次按下 `⌃⇧F`、`⌃⇧E`、`⌃⇧A`、`⌃⇧B`、`⌃⇧N`、`⌃⇧P`、`⌥⇧F`、`⌥⇧B`
- **THEN** anchor 保持不变、head 依次落到：词首 +1 字符、行尾、行首、词首 −1 字符、下一行、上一行、`beta` 词尾、`gamma` 词首

#### Scenario: 扩选跨表格行

- **WHEN** 光标在 grid 表格行内按下 `⌃⇧N`
- **THEN** head 落到下一表格行的可停靠位置（与 `⌃N` 同一路由与吸附口径），anchor 仍留在原处

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

### Requirement: 键位配置覆盖（[keys]）

配置 SHALL 支持 `keys` 表：键位写法 → 命令 id，值为 `null` 表示解绑，实现单键重绑与解绑。覆盖 SHALL 只替换「键 → 命令」的对应；作用域 SHALL 由命令归属决定（编辑器组命令 → `editor`，其余 → `global`），MUST NOT 允许配置指定作用域。缺 `keys` 字段或字段为空 SHALL 落回默认键位表。

命令 id 的合法性 SHALL 由前端键位层判定（命令清单的单一来源是 `src/keys.ts` 的 `COMMAND_IDS`；Rust 侧 MUST NOT 复制该清单——两份并列清单必然漂移，是 M131 的整个动因）：未知命令 SHALL 产生人话 warning、忽略该条覆盖、保留默认绑定，MUST NOT 抛错或阻止应用启动。

非法键位 SHALL 被忽略并 warning：键位为空、或含空白（多段 chord，本版不支持）。配置 warning SHALL 记入 `ConfigSnapshot.warnings` 或前端 console（沿用既有口径：本 change 不新增 UI 面）。

配置的解析与测试 MUST NOT 读写真实的 `~/.config/lumir/`：Rust 侧单元测试一律用临时路径，前端场景用桩注入配置。

#### Scenario: 单键重绑生效

- **WHEN** 配置 `{"keys": {"Ctrl-s": "document.save"}}`（把 D3 预留的 ⌃S 接上保存）后启动应用，编辑文档并按下 `⌃S`
- **THEN** 执行保存链路：落盘内容为当前缓冲、dirty 清除、出现保存成功提示；未配置时 `⌃S` 不保存

#### Scenario: 解绑生效

- **WHEN** 配置 `{"keys": {"Cmd-s": null}}` 后启动应用，编辑文档并按下 `⌘S`
- **THEN** 不产生保存链路的任何动作（无写入、无保存提示、dirty 保持）；该键落回原生路径

解绑的语义边界 SHALL 如实记录：解绑只解除**本应用**的绑定，不保证该键"I 不再做这件事"——macOS 文本系统自带一批 Emacs 惯例键位（自证阶段实测：`⌃K` 解绑后，按 `⌃K` 仍由原生 `deleteToEndOfLine:` 杀掉行内容），故解绑 `⌃` 系键的实际效果可能是「交给系统文本系统」。要真正禁用某能力，须把该键重绑到别的命令。

#### Scenario: 未知命令不崩

- **WHEN** 配置 `{"keys": {"Ctrl-j": "editor.nope"}}` 后启动应用
- **THEN** 应用照常启动并可编辑；console 出现含 `editor.nope` 的 warning；该条覆盖被忽略，默认键位表照常分发（`⌘S` 仍保存）

#### Scenario: 多段 chord 被拒绝

- **WHEN** 配置里的键位含空白（如 `"Ctrl-x u"`）
- **THEN** 该项被忽略并产生 warning 提示本版不支持多段 chord；其余配置项照常生效

### Requirement: 鼠标路径的 ⌘ / ⌃ 拆分

`⌘`-Click SHALL 跟随光标处（点击位置）的**链接**——wikilink、外链、相对路径 md 与 vault 内资产都算——命中链接时阻止选区落点并激活链接；`⌃`-Click SHALL NOT 被当作链接激活——`⌃`-Click 在 macOS 是系统级次级点击（右键等价手势），MUST 让回系统；裸点击 SHALL 不拦截（链接文本可正常落点编辑）。该拆分与 D1 的键盘拆分同源：`⌘` 系归 mac 惯例、`⌃` 系归 Emacs / 系统手势。

需要 vault 上下文的类别（wikilink 与 vault 内路径类链接——解析基准是当前文件）在没有打开中的 md 文件时 `⌘`-Click 不跟随；外链与纯锚点不需要 vault 上下文，`⌘`-Click 照常生效。

#### Scenario: ⌃-Click 不跳转、⌘-Click 跳转

- **WHEN** 在含 `[[target]]` 的文档里先 `⌃`-Click 该链接，再 `⌘`-Click 该链接
- **THEN** 第一次不跳转（仍在原文件、无提示，选区正常落点）；第二次跟随链接打开目标文件

#### Scenario: 无 vault 上下文时外链仍可开

- **WHEN** 没有打开中的 md 文件（无 vault 上下文），在文档里 `⌘`-Click 一条外链
- **THEN** 外链照常交给系统默认应用打开（外链打开不依赖 vault 上下文）

### Requirement: IPC 与事件通道单一入口

前端所有 `invoke` 调用与后端事件订阅 SHALL 经 `src/ipc.ts` 进出；MUST NOT 在装配层或其它模块直连 `listen`。崩溃备份链路的 `recovery_*` 封装与菜单命令事件（`app:menu_command`）SHALL 属 `src/ipc.ts`（M127 / M131 遗留的两处例外在本次收编）。模块划分调整 MUST NOT 改变任何调用语义：菜单项的撤销 / 重做仍落到统一命令层的同一实现。

#### Scenario: 菜单点击落到同一命令层

- **WHEN** 后端发出 `app:menu_command` 事件（原生菜单的撤销项被点击），此前刚输入过文字
- **THEN** 文档回退到输入前的内容——与按 `⌘Z` 走的是同一个 `editor.undo` 实现

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

浮层自己的导航键（`↑↓` / `⌃N` / `⌃P` / `Enter` / `Esc`）SHALL NOT 进本表：表的不变量是「一个
token 一条绑定」，而其中 `↑↓` / `⌃N` / `⌃P` 已被 `editor.cursor-up/down` 占用、`Esc` 已被
`editor.widget-escape`（带 `when` 条件）占用——同 token 的第二条绑定会被分发器构造期的重复绑定
检查直接拒绝。浮层内就地消费 + 阻止默认行为，使 window 上的分发器对已消费事件让路——不构成同一
物理键的第二条分发映射。

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

### Requirement: 标签命令族——关闭 / 循环切换 / 序号直达

系统 SHALL 提供标签命令族，命令 id SHALL 为 `tab.close`、`tab.next`、`tab.prev` 与
`tab.goto-1` … `tab.goto-9`（九条各一个 id：命令层没有参数通道，序号只能落在 id 上，
这样 `[keys]` 配置重绑与键位面板都能如实显示「⌘3 → tab.goto-3」）。作用域一律 SHALL 为
`global`（标签是窗口级对象，焦点在文件树 / 搜索框 / 大纲浮层里时同样要能切，与 ⌘F / ⌘⇧O
同一理由），实现 SHALL 落在装配层（`src/main.ts`），能力（会话与切换）SHALL 在
`src/editor.ts`。

默认绑定 SHALL 为：`⌘W` → `tab.close`、`⌃⇥` → `tab.next`、`⌃⇧⇥` → `tab.prev`、
`⌘1`…`⌘9` → `tab.goto-1` … `tab.goto-9`。全部 SHALL 进 `KEY_BINDINGS` 与
`GLOBAL_COMMAND_IDS`，因此 `[keys]` 配置 SHALL 能像其余命令一样对它们重绑或解绑，
`app.describe-bindings` 面板 SHALL 自动列出它们（面板渲染的是生效表与 `COMMAND_IDS`）；
每条绑定的 `doc` 字段 SHALL 写明取该键的来由与作用域理由。

序号越界（标签数少于序号）SHALL 为无操作——MUST NOT 退化为「跳到最后一个」这类隐式兜底。
`⌃⇥` / `⌃⇧⇥` 在标签数少于 2 时 SHALL 为无操作。

#### Scenario: 表的不变量在新增绑定后仍成立

- **WHEN** 装配应用（构造分发器并注入命令实现）
- **THEN** 新增绑定后表内仍无重复绑定、每条绑定都有归属命令与来由、清单里没有孤儿命令，装配不抛错

#### Scenario: 序号直达与循环切换在边界上不越界

- **WHEN** 打开的标签数少于按下的序号（如只有 2 个标签时按 ⌘5），或标签数少于 2 时按 ⌃⇥
- **THEN** 前台标签不变，不出现任何隐式兜底跳转

#### Scenario: 键位冲突核对的留痕

- **WHEN** 新增绑定前核对与既有绑定及原生菜单 accelerator 的冲突
- **THEN** 核对结论 SHALL 记在绑定的 `doc` 字段与 change 的 proposal 里，逐键给出三条独立来源（表内 / 原生菜单 accelerator / 系统级）的结论；`⌘W` 的冲突与处置（在 `src-tauri/src/lib.rs` 让出该键）SHALL 一并留痕

### Requirement: ⌘W 归标签——原生菜单关闭项让出该加速键

macOS 原生 `Menu::default()` 在 File 与 Window 两个子菜单里的**预置** Close 项自带 `⌘W`
key equivalent，菜单键等价在 NSApplication 分发阶段就被截获，webview 的 keydown 收不到该键。
系统 SHALL 在 `src-tauri/src/lib.rs` 把这两个预置项换成**不带加速键**的自定义菜单项（按 M131
让出 `⌘Z` / `⇧⌘Z` 的同一先例），点击经 `app:menu_command` 交回前端，由前端映射到 `tab.close`
命令——菜单与键盘 SHALL 走同一个命令实现，MUST NOT 产生第二套关闭逻辑。

菜单里的关闭项 SHALL 保留（只是不再有加速键）。`⌘W` 的语义 SHALL 为「关闭当前标签」，
MUST NOT 关窗；零标签时 `⌘W` SHALL 为无操作。退出仍走 `⌘Q`（有 dirty 守卫）与窗口红灯按钮。

菜单手术的**结构性假设** SHALL 在替换前校验（子菜单存在、末位项确为预置 Close、文案匹配），
校验失败时 SHALL 保留默认菜单不改动并打 stderr 警告——MUST NOT 在结构变化时盲目删项。

#### Scenario: 结构假设不成立时不动菜单

- **WHEN** 默认菜单里找不到 File / Window 子菜单，或其末位项不是文案为 `Close` 的预置项
- **THEN** 该子菜单不被改动、打一条 stderr 警告，其余两处菜单改造（退出守卫 / 撤销重做）照常进行

#### Scenario: 菜单事件的转发载荷

- **WHEN** 菜单里任意一个自定义关闭项被点击
- **THEN** 经 `app:menu_command` 发出的载荷 SHALL 是平台术语 `close`（不是前端命令 id），File 与 Window 两处映射到同一个载荷；前端把它映射到 `tab.close`

### Requirement: 链接跟随——⌘⏎ 与 ⌘-Click 同一命令

系统 SHALL 提供一个链接跟随命令承担「激活光标/点击处的链接」，命令 id SHALL 为 `link.follow`，作用域 SHALL 为 `global`，默认绑定 SHALL 为 `⌘⏎`。该 id 取代 `wikilink.follow`（命令跟随的已经是**链接**这件事本身，不再只管 wikilink；旧 id 不再使用，`[keys]` 配置里引用旧 id 会按既有口径产生未知命令 warning 并忽略该条）。⌘-Click SHALL 走同一条命令实现——鼠标路径就地判定（键位表只管键盘），MUST NOT 衍生第二套跟随逻辑。

跟随 SHALL 按键盘路径的当前选区（head）或鼠标路径的点击位置判定，按链接类别分流（分类口径见 `editor-live-preview` 的链接形态矩阵）：

1. **wikilink**：SHALL 走既有跳转链路（Rust `link_graph` 解析 → 打开目标文件 → 锚点定位），MUST NOT 新建第二套解析或打开路径。未解析（`unresolved`）时 SHALL 只给提示，MUST NOT 创建文件——自动创建是作者没做过的动作，提示里既有的「创建并打开」显式入口不变。
2. **外链**：SHALL 交给系统默认应用打开（见下）。
3. **应用内笔记**（相对路径 md）：SHALL 按**相对当前文件所在目录**的路径语义解析（`./` `..` 归一、以 `/` 开头按 vault 根相对、`#fragment` 忽略）后走与 wikilink 同一条「打开一篇笔记」链路（同一 `openFile`），MUST NOT 新建第二套打开路径。MUST NOT 复用 wikilink 的名称匹配语义（`[x](note.md)` 与 `[[note]]` 可能指向不同文件）。解析不到时 SHALL 只给「链接目标不存在」提示，MUST NOT 创建文件、MUST NOT 跳转。
4. **vault 内资产**（非 md 文件 / 目录）：SHALL 交给系统默认应用打开；目标 MUST 先经 vault 内路径校验（拒绝绝对路径、`..` 穿越与符号链接逃逸，且目标必须存在），校验不通过 SHALL 拒绝并给提示，MUST NOT 交给系统。
5. **纯锚点**：SHALL 给出「暂不支持锚点跳转」提示，MUST NOT 做文档内滚动跳转（当前没有锚点→行号的文档内链路，不做半个实现）。
6. **不可用形态**（白名单外 scheme）：SHALL 无操作——不产生任何打开请求、不移动选区、不给提示；该形态在渲染层就是原文，没有"看起来能开"的外观，因此无操作与外观自洽。光标不在链接上时同样无操作。

外链打开的 scheme 白名单（`http` / `https` / `mailto`，大小写不敏感）SHALL 在 Rust 侧校验并作为**打开许可**的唯一权威判定：前端可以按同一白名单决定"是否渲染成外链、是否发起打开请求"这类呈现层判断，但 MUST NOT 以自身判断代替校验；scheme 不在白名单内、或目标还原后含空白 / 控制字符时，后端 SHALL 拒绝并返回 `open_url_rejected` 错误信封（前端按人话 toast 展示），MUST NOT 交给系统打开。

vault 内资产的路径校验同理 MUST 在 Rust 侧（`link_open_path`）：前端只把「在哪个文件里、目标原文是什么」递过去，MUST NOT 自行拼绝对路径，也 MUST NOT 以自身判断代替校验。

打开链路 SHALL 只有一条：webview MUST NOT 被授予 `opener` 插件的任何直接调用权限（capabilities MUST NOT 新增 `opener:*` 条目），唯一入口是本仓的 `open_external_url`（外链）与 `link_open_path`（vault 内资产）两个 command；插件自身注入的「点击 `<a target=_blank>` 直接开浏览器」脚本 SHALL 关闭——那是绕开校验的第二条打开路径。

链接激活 SHALL 落下 `link_open` 诊断事件（`LogEventName` 成员），字段 SHALL 只有 `category`（链接类别：`external` / `internal-md` / `asset` / `anchor` / `blocked-scheme`）、`outcome`（`opened` / `unresolved` / `unsupported` / `rejected` / `failed`）与 `scheme`（可选，仅外链路径上有值：归一后的协议名，白名单外与无 scheme 归 `other`）。系统打开类（`external` / `asset`）由 Rust 侧记录（判定与调用都在那一侧），其余类别由前端记录（分类只在前端）。URL / 目标原文与文档内容 MUST NOT 写入日志——那是文档内容，`logging` 的隐私边界（负载里没有文档正文与键入内容）优先于排查便利。

#### Scenario: ⌘⏎ 打开光标处的外链

- **WHEN** 光标落在 `[示例站点](https://example.invalid/site)` 的显示文本内，按下 `⌘⏎`
- **THEN** 系统默认应用打开 `https://example.invalid/site`；诊断日志出现 `link_open`（`category=external`、`scheme=https`、`outcome=opened`），日志中没有该 URL 原文

#### Scenario: ⌘-Click 与 ⌘⏎ 同一路径

- **WHEN** 在 `[写邮件](mailto:someone@example.invalid)` 上 `⌘-Click`，随后在 `[包裹形式](<https://example.invalid/wrapped>)` 上把光标移入并按下 `⌘⏎`
- **THEN** 两次打开的目标分别是 `mailto:someone@example.invalid` 与 `https://example.invalid/wrapped`（尖括号包裹形式开的是里面的目标），走的是同一条命令实现

#### Scenario: 相对路径 md 跳进 vault 内的笔记

- **WHEN** 在 `notes/index.md` 里对 `[指南](../docs/guide.md)` 按下 `⌘⏎`，且 vault 里有 `docs/guide.md`
- **THEN** 编辑器切到 `docs/guide.md` 的内容（与 wikilink 跳转同一条打开链路）；诊断日志出现 `link_open`（`category=internal-md`、`outcome=opened`）

#### Scenario: 相对路径 md 解析不到

- **WHEN** 在 `[不存在的笔记](missing.md)` 上按下 `⌘⏎`，且 vault 里没有 `missing.md`
- **THEN** 弹出「链接目标不存在：missing.md」提示，跳到 `missing.md` 的动作 MUST NOT 发生，vault 里 MUST NOT 出现新文件（一键创建是 wikilink 的显式动作）；诊断日志出现 `category=internal-md`、`outcome=unresolved`

#### Scenario: vault 内非 md 资产交系统默认应用

- **WHEN** 对 `[说明书](docs/manual.pdf)` 按下 `⌘⏎`，且 vault 里有 `docs/manual.pdf`
- **THEN** 系统默认应用打开该文件；诊断日志出现 `category=asset`、`outcome=opened`

#### Scenario: 资产目标越出 vault 被拒

- **WHEN** 对 `[越界](../outside.pdf)` 按下 `⌘⏎`（归一后越出 vault 根）
- **THEN** 后端拒绝并返回 `link_path_rejected` 错误信封，前端 toast 展示「打不开这个目标：…——它不在 vault 内」；MUST NOT 有任何文件被系统打开

#### Scenario: 纯锚点只给提示

- **WHEN** 对 `[去标题](#小节)` 按下 `⌘⏎`
- **THEN** 弹出「暂不支持锚点跳转」提示；文档不做滚动跳转、选区与文档内容都不变

#### Scenario: wikilink 两态

- **WHEN** 光标落在一条已解析的 `[[note]]` 上按下 `⌘⏎`；随后落在一条未创建的 `[[missing]]` 上按下 `⌘⏎`
- **THEN** 前者打开 `note.md` 并按锚点定位（既有链路，行为不变）；后者只弹出未创建提示，vault 里 MUST NOT 出现新文件——除非作者在提示里点了「创建并打开」

#### Scenario: 非白名单 scheme 被拒

- **WHEN** 光标落在 `[别开我](javascript:alert(1))` 上按下 `⌘⏎`
- **THEN** 不产生任何打开请求、不弹提示（该形态在渲染层就是原文，跟随命令判定为"不可用形态"）；即使前端判断失误把非法目标递到后端，`open_external_url` 也 SHALL 独立拒绝并返回 `open_url_rejected`

#### Scenario: 光标不在链接上无操作

- **WHEN** 光标停在普通正文里按下 `⌘⏎`
- **THEN** 不打开任何 URL、不弹提示、文档与选区都不变

### Requirement: 折行开关命令（view.toggle-line-wrap / view.toggle-code-block-wrap）

系统 SHALL 提供两条命令承担「翻转折行开关」：`view.toggle-line-wrap` 与 `view.toggle-code-block-wrap`。
两条命令的作用域 SHALL 为 `global`，实现 SHALL 落在装配层（`src/main.ts`），折行的能力与状态归属 SHALL 在
`src/editor.ts`；翻转的语义与作用面 SHALL 按 `editor-live-preview` 的「折行开关的瞬态口径」与「折行口径与
配置来源」两条 requirement（应用运行期的瞬态口径、立即生效、全体会话一致、不落盘、不持久化）。

两条命令 SHALL 默认**不绑键**，并 SHALL 登记进默认不绑键清单（`src/keys.ts` 的 `KEYLESS_COMMAND_IDS`，见
「统一键位分发表」）。它们 MUST NOT 出现在 `KEY_BINDINGS` 里——本版不为折行占用任何物理键位。`[keys]` 配置
SHALL 能像其余命令一样把它们绑上键：两条 id 都在 `COMMAND_IDS` 里，故不会走到「未知命令」的拒绝路径；
`Keymap.attach` 的校验是「绑定 → 有实现」，绑定后即生效。

作用域取 `global` 而非 `editor` 的理由 SHALL 记录在实现处（命令记录的注释）与 `doc` 语义里：命令作用于
应用运行期的显示口径（窗口级对象，与 `tab.*`、`toc.toggle` 同族），焦点在文件树 / 搜索框 / 浮层里时同样应能
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
- **THEN** 触发的是折行翻转——不出「未知命令」warning、不是无反应：折行呈现立即变化（**全部标签页**
  同步，含当时不在前台的那些；文件级与代码块级各按自己的口径，见 `editor-live-preview` 的「折行渲染与
  代码块横滚容器」）；MUST NOT 依赖 toast 或指示文本判断（本版没有它们）

#### Scenario: 面板列出两条命令并标注未绑定

- **WHEN** 不在任何 `[keys]` 覆盖下按 `⌘/` 打开键位面板
- **THEN** 「全局」分组里出现 `view.toggle-line-wrap` 与 `view.toggle-code-block-wrap` 两行，键位列显示
  「未绑定」，说明列能读出成因（默认不占键位、可用 `[keys]` 绑定）；面板不新增分组

### Requirement: 字号步进命令与默认键位

字号步进 SHALL 由统一键位表分发三条全局命令：`view.text-scale-up`、`view.text-scale-down`、
`view.text-scale-reset`。三者 SHALL 进 `NON_TAB_GLOBAL_COMMAND_IDS`（作用域因此机械派生为 `global`——
焦点在左栏 / 搜索框 / 浮层 / 面板里时同样命中），MUST NOT 取 `editor.` 前缀（本仓 `editor.` 前缀 =
编辑器作用域命令，前缀与作用域 MUST NOT 互相打脸）。命令实现 SHALL 落在装配层，能力（运行期字号真源
与施加）SHALL 落在编辑器模块。

默认键位 SHALL 是 mac 惯例的一组：`⌘=` 与 `⌘+`（同一物理键的两种字符形态）→ `view.text-scale-up`、
`⌘−` → `view.text-scale-down`、`⌘0` → `view.text-scale-reset`。四条绑定 SHALL 各自附来由说明（表即
文档）；同一命令有多条绑定是表内既有形态（撤销命令既有两条别名），不构成冲突。三条命令默认都有绑定，
因此 `KEYLESS_COMMAND_IDS` SHALL 保持不变（MUST NOT 把它们登记为「默认不绑键」）。

键位占用 SHALL 由三条独立来源核实并写进实现说明：① 表内（`src/keys.ts` 即真源，无 `Cmd-=` /
`Cmd-+` / `Cmd--` / `Cmd-0`）；② 原生菜单 accelerator 集合（muda 的预置项 = ⌘C / ⌘X / ⌘V / ⌘Z / ⇧⌘Z /
⌘A / ⌘M / ⌃⌘F / ⌘H / ⌥⌘H / ⌘W / ⌘Q，不含这三个键）；③ 系统级（三者不是 macOS 的预置菜单键）。

**键位通路唯一性**：MUST NOT 启用 Tauri 的 webview 缩放热键（`zoom_hotkeys_enabled`）——它在表外
自注册一条 keydown 通路、接管同一批键（`⌘=` / `⌘+` / `⌘−` / `⌘0`），且不出现在生效表与键位面板里、
不可由 `[keys]` 重绑。任何整体缩放能力（若将来立项）SHALL 经统一键位表的命令实现，MUST NOT 走该开关。

绑定写法 SHALL 与运行期事件 token 同源，并 SHALL 有单测钉住静默失配风险：减号键的 token 形态是
`Cmd--`（MUST NOT 写 `Cmd-Minus`——只有含 Alt 的组合才按物理键判定，写错形态不会报错、只会永远不命中）；
`⌘⇧=` 在真机上的字符形态归一到 `Cmd-+`。四条绑定 SHALL 都是单段、无空白，因此用户可用 `[keys]`
重绑 / 解绑（MUST NOT 采用含空白的多段 chord 作默认键位——那会让用户无法重绑）。

#### Scenario: 默认键位命中

- **WHEN** 焦点在编辑器内按 `⌘=`（或 `⌘+`）、按 `⌘−`、按 `⌘0`
- **THEN** 分别触发放大一档、缩小一档、回到配置字号——三条命令经统一分发器执行，行为与
  `typography` 的「字号步进的运行期口径」逐条一致

#### Scenario: 焦点不在编辑器内同样命中

- **WHEN** 焦点在左栏文件树（或键位面板 / 搜索框）上按 `⌘=`
- **THEN** 字号同样放大一档（作用域为 `global` 的绑定与焦点无关）

#### Scenario: 可重绑与解绑

- **WHEN** 在 `[keys]` 里把 `⌘=` 重绑到别的键、或把 `⌘0` 解绑
- **THEN** 重绑后新键生效、原键不再触发放大；解绑后该命令在键位面板里显示为未绑定并给出成因说明
  （既有面板口径），其余两条命令不受影响

#### Scenario: 键位通路唯一

- **WHEN** 在默认配置下检查生效表与运行期按键通路
- **THEN** `⌘=` / `⌘+` / `⌘−` / `⌘0` 各只有一条归属（统一键位表），页面上不存在第二处消费同一批键的
  监听（Tauri 的 webview 缩放热键未启用）；键位面板如实列出这四条绑定

#### Scenario: 无孤儿命令对账不变

- **WHEN** 对账 `COMMAND_IDS` / `KEY_BINDINGS` / `KEYLESS_COMMAND_IDS` 三者
- **THEN** 三条新命令都有默认绑定、不在默认不绑键清单里；清单内容与新增前一致（三项对账的判据不放松）
