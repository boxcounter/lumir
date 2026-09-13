# keymap-commands Specification

## Purpose
全应用键位的单一事实来源与分发合同：唯一一张 key → command 表（`src/keys.ts`）驱动所有编辑、文档与 widget 焦点键，口径为「⌘ 系归 macOS 惯例、⌃ 系归 Emacs 惯例」，覆盖移动 / 扩选 / 删除 / kill-yank / 撤销与配置层（`[keys]` 重绑与解绑）。

## Requirements

### Requirement: 统一键位分发表

全应用的键位绑定 SHALL 收敛为唯一一张 key → command 表（`src/keys.ts` 的 `KEY_BINDINGS`），每条绑定 SHALL 标注作用域与归属命令，并 SHALL 附一句来由说明（表即文档）。作用域取值只有两种：`global`（任意焦点都生效）与 `editor`（事件目标落在编辑器内容区内才生效，含其中的 widget）。绑定 SHALL 全平台无条件生效（表内不做平台门）：当前运行目标只有 macOS（Tauri 桌面），跨平台日期未定，无测试覆盖的平台分支只会成为死代码；迁移前的两处平台门因此消失且 SHALL 被如实记录——⌃N/P/F/B/E 原为 mac-only（`{ mac: "Ctrl-n" }`）现对全部平台生效（⌃N 在部分桌面环境是系统级「新建」惯例），`Mod-Enter` 迁为 `⌘Enter` 后非 mac 的 Ctrl-Enter 变体不再存在。将来引入跨平台目标时 SHALL 重新引入平台门（给 ⌃ 系绑定加平台维度，或把 ⌃N 一类让回系统惯例）。命令实现 SHALL 按归属留在各自模块（编辑器侧命令在 `src/editor.ts`，文档与链接命令在装配层 `src/main.ts`），并 SHALL 由装配处注入分发器。

分发 SHALL 只有一条路径：一个挂在 window 上的 keydown 分发器。MUST NOT 存在并列的键位旁路——编辑器 keymap、`domEventHandlers`、裸 window 监听各注册一份同一物理组合，是同一组合多处漂移的成因（⌘A/⌃A 曾都当全选、⌘S/⌃S 曾都当保存）。表内的每条命令 SHALL 至少有一条绑定，每条绑定 SHALL 有归属命令；归一化后重复的绑定 SHALL 在装配期直接失败（MUST NOT 让后注册者静默覆盖前者，也 MUST NOT 让缺实现的绑定静默失效）。

分发器 SHALL 对已经消费的事件让路（`defaultPrevented` 直接返回且不改 chord 状态），SHALL 在输入法组合期（`isComposing` 或 keyCode 229）不接管，并 SHALL 在命中绑定时吞掉默认行为——命令本身无事可做时同样吞掉（例如撤销栈为空时的 ⌘Z），MUST NOT 把按键放回原生 contenteditable 路径。

#### Scenario: 表的不变量

- **WHEN** 装配应用（构造分发器并注入命令实现）
- **THEN** 表内无重复绑定、每条绑定都有归属命令与来由、清单里没有孤儿命令，装配不抛错

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

行首命令 SHALL 与行尾命令对称：同取文本行边界（硬边界，段落语义，不受软换行截断），落点紧贴隐藏 replace（表格管道符、块级公式边界）时按可见侧测量，避免揭示滚动把整窗内容拉偏。

#### Scenario: 既有 6 键行为不变

- **WHEN** 在表格围绕的文档中用 ⌃N/⌃P/⌃F/⌃B/⌃E 与 ArrowUp/ArrowDown 移动光标
- **THEN** 落点、跨表格路由、列位保持与滚动揭示与迁移前逐场景一致（既有视觉场景全绿、零基线更新）

#### Scenario: ⌃A 落点在隐藏内容邻接位

- **WHEN** 光标在 grid 表格行内，按下 ⌃A
- **THEN** 光标落在该表格行的可见行首（行内第一个可测量位置：隐藏管道符零宽，视觉位置即首 cell 起点），坐标不退化且不出现整窗内容下挫

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

表格滚动容器（livePreview 的 grid 表格 widget，`tabindex=0`）的焦点作用域键——`←`、`→`、`Home`、`End`、`Escape`——SHALL 由统一键位表分发，MUST NOT 在 `livePreview.ts` 保留并列的 keydown 手柄（同一物理组合两处各写一份即 M131 要消灭的旁路形态）。

这些物理键在文本编辑中另有语义（原生 caret / 行首尾 / 取消），故绑定 SHALL 带**命中条件**（事件目标落在该容器内才命中）；条件不满足时 SHALL NOT 消费事件（不 `preventDefault`），文本编辑中的同名键 SHALL 照旧走原生路径。命令 SHALL 接收触发事件以定位事件目标，MUST NOT 依赖全局焦点猜测。行为 SHALL 与迁移前一致：左右各 120px 步进、`Home` 横向回最左、`End` 横向到最右、`Escape` 把焦点交还编辑器。

本 requirement 取代 change `keymap-unify` 增量中「widget 自己的焦点作用域键（Escape / Home / End / 左右方向键）仍由该 widget 现有手柄先消费，本层对已消费事件让路」一句——该句描述的是收编前的分工，已不再成立，归档时已按本 requirement 修订（原句见 `openspec/changes/archive/2026-09-13-keymap-unify`）。

#### Scenario: 容器焦点内的滚动键

- **WHEN** 焦点落在超宽表格的滚动容器上，依次按下 `→` 与 `End`
- **THEN** 容器横向滚动 120px、随后滚到最右（右缘覆盖表格自然宽）；按 `Home` 回到最左；按 `Escape` 后焦点回到编辑器内容区

#### Scenario: 文本中的方向键不受影响

- **WHEN** 焦点在编辑器文本中（不在表格滚动容器里）按下 `←`
- **THEN** 光标按原生路径左移一个字符（绑定条件不满足，事件未被消费）

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

`⌘`-Click SHALL 跟随 wikilink（命中链接 span 时阻止选区落点并激活链接）；`⌃`-Click SHALL NOT 被当作链接激活——`⌃`-Click 在 macOS 是系统级次级点击（右键等价手势），MUST 让回系统；裸点击 SHALL 不拦截（链接文本可正常落点编辑）。该拆分与 D1 的键盘拆分同源：`⌘` 系归 mac 惯例、`⌃` 系归 Emacs / 系统手势。

#### Scenario: ⌃-Click 不跳转、⌘-Click 跳转

- **WHEN** 在含 `[[target]]` 的文档里先 `⌃`-Click 该链接，再 `⌘`-Click 该链接
- **THEN** 第一次不跳转（仍在原文件、无提示，选区正常落点）；第二次跟随链接打开目标文件

### Requirement: IPC 与事件通道单一入口

前端所有 `invoke` 调用与后端事件订阅 SHALL 经 `src/ipc.ts` 进出；MUST NOT 在装配层或其它模块直连 `listen`。崩溃备份链路的 `recovery_*` 封装与菜单命令事件（`app:menu_command`）SHALL 属 `src/ipc.ts`（M127 / M131 遗留的两处例外在本次收编）。模块划分调整 MUST NOT 改变任何调用语义：菜单项的撤销 / 重做仍落到统一命令层的同一实现。

#### Scenario: 菜单点击落到同一命令层

- **WHEN** 后端发出 `app:menu_command` 事件（原生菜单的撤销项被点击），此前刚输入过文字
- **THEN** 文档回退到输入前的内容——与按 `⌘Z` 走的是同一个 `editor.undo` 实现
