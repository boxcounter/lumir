# multi-tabs Specification

## Purpose

定义多标签会话的落地口径：每个文档 pane 一个 `EditorView` + 每标签独立 `EditorState`（切换经 `view.setState`，撤销史/语法树/选区随标签留存），标签栏的显示与形态、打开语义（树上的单击 = 当前标签就地打开、⌘-点击 = 新标签并保留当前标签，双击 / 其它修饰键同单击；文档内链接跟随不新开、另存为与恢复备份就地替换前台标签）、按标签隔离的 dirty 判定与保存粒度、文件树高亮联动与空态。由 change `add-multi-tabs` 归档并入（2026-09-17，实现 M149），并由 change `remember-reading-position` 归档并入（2026-09-24，实现 M194——打开文档时按 vault 恢复上次阅读位置）；change `preview-tab-removal` 归档并入（2026-09-28，实现 M254）后，预览 / 固定标签的二元性整条退场，承载条由「打开语义」接替。由 change `pane-system-split-view` 归档并入的增量（2026-10-05，实现 M315–M322）：标签条按 pane 各自承载（双 pane 时标题栏标签区左右分区、槽宽随分隔条），⌘S / 保存粒度、树高亮、打开落点、dirty 守卫全部改以「活跃 pane 的前台标签」与「全部 pane 的全部标签」为口径，每个文档 pane 各建一个 `EditorView`。

## Requirements

### Requirement: 单 EditorView + 每标签留存 EditorState

系统 SHALL 为**每个文档 pane**创建一个 `EditorView`（v1 上限二，见 `pane-layout` 的
「pane 容器模型」），并为**每个 pane 内打开的每个标签**留存一份独立的 `EditorState`。
切换标签 SHALL 通过该 pane 的 `view.setState(该标签的 state)` 完成——MUST NOT 重建
`EditorView`，MUST NOT 在切换时重新解析文档。

因为撤销史（CM `history()`）、语法树、选区、搜索查询与模式配置都是 `EditorState` 的字段，
切走再切回时它们 SHALL 原样回来：撤销栈 MUST NOT 被清空，语法树 MUST NOT 被重新解析。
两个 pane 的 `EditorState` 各自独立，MUST NOT 共享。

标签顺序 SHALL 等于打开顺序（per pane）。每个标签 SHALL 逐标签持有：文档路径、dirty 判定基准
（cleanDoc）、dirty 标记、离开时的滚动位置。

滚动位置 MUST 单独逐标签存取——它不在 `EditorState` 里（只存在于 `scrollDOM`），
因此切换标签 MUST NOT 继承上一篇的滚动位置。标签跨 pane 移动时滚动位置随标签迁移
（见 `pane-layout` 的「会话所有权」）。

#### Scenario: 切走再切回保留撤销史

- **WHEN** 在某 pane 的标签 A 里连续输入若干文本后切到同 pane 的标签 B，再切回 A，然后按 ⌘Z
- **THEN** 输入被逐次撤回（撤销栈仍是 A 自己的那一条），而不是无事发生

#### Scenario: 切走再切回恢复滚动位置

- **WHEN** 在某 pane 的标签 A 里滚到文档中部，切到同 pane 的标签 B（B 停在篇首），再切回 A
- **THEN** A 的滚动位置回到离开时的位置，B 的滚动位置不受影响

#### Scenario: 装载不进撤销史

- **WHEN** 在同一标签内打开另一份文档（文档内链接跟随 / 另存为新文件 / 恢复崩溃备份，见「打开语义」）
- **THEN** ⌘Z MUST NOT 把上一篇的内容撤回来（装载事务带 `addToHistory(false)`，口径与 M131 一致）

#### Scenario: 两个 pane 的撤销史各自独立

- **WHEN** 双 pane，A 的 `a.md` 里输入一段文字，B 的 `b.md` 里也输入一段文字，随后在 B 里连按 ⌘Z
- **THEN** 只有 B 的 `b.md` 逐次回退，A 的 `a.md` 内容与撤销栈不受影响（per-pane 的
  EditorState 独立，活跃 pane 切换 MUST NOT 串撤销史）

### Requirement: 标签栏的显示与形态

系统 SHALL 按 **pane** 各自承载标签条：每个文档 pane 拥有自己的标签条（显示该 pane 的标签
子列表），标签子列表的并集等于该 vault 打开的全部标签。**单 pane 常态下标签条 SHALL 维持
pane 化之前的呈现位置与几何逐像素不变**（位于标题栏内）；双 pane 时标题栏的标签区 SHALL
左右分区为两槽——左槽承载左 pane 的标签条、右槽承载右 pane 的标签条，两槽宽度比例 SHALL
跟随分隔条位置（与 `pane_split_ratio` 同源），顶部恒为一条横带（MUST NOT 出现第二条横带）。
双 pane 时标题栏右簇 SHALL 同步退让（产品标识块退 modeline、harness 开关钮隐藏；定义见
`ui-design-system` 的「应用骨架布局」），单 pane 全量在场。标签 MUST NOT 出现在其所属 pane
之外的标签条上。

显示判据 SHALL 为「该 pane 至少有一个文件已打开」：单 pane 且一个标签时也 SHALL 显示
（它承载 dirty 点与位置上下文）；某 pane 没有任何带路径的会话时该 pane 的标签条区域
SHALL 呈该 pane 的空态（见 `pane-layout` 的空 pane 口径）；全部 pane 都没有会话时标签区
SHALL 隐藏，标题栏只剩 traffic 灯区与动作钮。

每个标签 SHALL 显示：文件名（vault 相对路径的 basename，读屏名带上该标签自己的未保存状态）、
激活态高亮（per pane：各 pane 恰有一个激活标签）、逐标签的 dirty 点、逐标签的关闭按钮。
标签标题的形态 SHALL 只由「在所属 pane 内是不是前台」决定——MUST NOT 存在表示「预览 /
临时」的第二种标题形态。标签的悬停提示 SHALL 给出完整的 vault 相对路径。标签形态 SHALL 取
design tokens：高 29px、max-width 230px、圆角 7px；激活标签 SHALL 是全界面唯一带投影的元素
（`--shadow-pop`，per pane 各一个），eink 主题下投影退场、改 1.4px 实心黑描边（eink 降级
规则 ⑦⑧）。

标签溢出时 SHALL 用横向滚动承载；本版 MUST NOT 做拖拽排序。split view 已由本 change 提供
（per-pane 标签条是 split view 的承载形态），该禁令就此解除；MUST NOT 做标签预览浮层。

#### Scenario: 单标签也显示

- **WHEN** vault 已装载且只打开了一个文件（单 pane）
- **THEN** 标签区可见于标题栏内（位置与几何与 pane 化之前逐像素一致），该标签为激活态
  （带投影或 eink 描边）

#### Scenario: 空态隐藏且不占行高

- **WHEN** 没有任何文件被打开（单 pane、空标签列表）
- **THEN** 标签区隐藏，标题栏只剩 traffic 灯区与动作钮；编辑器正文区的高度不因标签有无而变化
  （标签位于标题栏内，标题栏高度恒定）

#### Scenario: dirty 与预览态在标签上可见

- **WHEN** 某标签有未保存修改
- **THEN** 该标签显示 dirty 点，其读屏名包含「（未保存）」；同一时刻标签栏上 MUST NOT 出现
  第二种标题字形（「预览态」形态已随预览机制退场，本 scenario 名保留自 M149，断言收敛成上面
  这条否定式）

#### Scenario: 双 pane 时标题栏标签区左右分区

- **WHEN** 双 pane，A 开着 `a.md`、`b.md`（前台 a），B 开着 `c.md`
- **THEN** 标题栏标签区呈左右两槽：左槽显示 a、b 两条（a 激活），右槽显示 c 一条（c 激活）；
  两槽宽度比例与分隔条一致，顶部恒为一条横带；`c.md` MUST NOT 出现在左槽；收起 pane 后
  标签区回到单 pane 形态（位置与几何与常态逐像素一致）

### Requirement: 保存粒度按标签隔离

dirty 判定基准、磁盘 revision（CAS 基准）、在途保存标记、崩溃备份的 debounce
定时器 SHALL 一律**按标签的文档路径**键控（跨全部 pane 同一张键空间，同一文档路径同一时刻
至多一个标签——见 `pane-layout` 的「会话所有权」）。MUST NOT 存在跨标签共享的单值。

`⌘S` SHALL 只保存**活跃 pane 的前台**标签。崩溃备份的 debounce SHALL 逐标签独立：切标签
MUST NOT 把待写的定时器带到新文档上（否则会把 A 的备份挂到 B 的路径上，属静默错位）；
活跃 pane 切换 MUST NOT 改变各标签备份 debounce 的归属。本 change 之前这里的约束对象是
自动保存的 debounce 定时器与暂停原因集合（`paused`）；自动保存整条移除后，**同一条不变量
（定时器按路径键控、不跨标签共享）落在崩溃备份的 debounce 上**——它现在是 dirty 内容唯一
的定时写入者，错位的代价从「写错文件」变成「恢复时给出错路径的内容」。

外部变更的处置 SHALL 对**全部 pane 的全部**打开的文档生效，MUST NOT 只查活跃 pane 的前台
那一个（双 pane 下后台 pane 的后台标签被外部修改会漏报）。每条保存侧提示 SHALL 点名它说的
是哪一份文档。

关闭有未保存修改的标签 SHALL 先给确认，三个出口：保存并关闭 / 放弃修改并关闭 / 取消。保存
未闭环（冲突 / 写失败 / 无落盘基准）时 MUST NOT 关闭该标签；「放弃修改并关闭」SHALL 同时清除
该路径的崩溃备份（备份随 dirty 生命周期，见 `fs-io` 的「崩溃备份与恢复入口」）。收起 pane
（`pane.close`）不经此确认——标签是移动而非关闭（见 `pane-layout` 的「pane 命令族」）。

后端退出守卫（`DirtyState`）的镜像 SHALL 取「**全部 pane 的全部**标签有未保存修改」的并集
——MUST NOT 只看活跃 pane 的前台标签，否则其他 pane 里的修改在退出时会被静默放行。

#### Scenario: ⌘S 只存前台标签

- **WHEN** 双 pane：A 的前台 `a.md` 与 B 的前台 `b.md` 都有未保存修改，活跃 pane 是 A，按 ⌘S
- **THEN** `a.md` 落盘并清 dirty；`b.md` 仍带 dirty 点、B 的文档仍为未保存

#### Scenario: 切换标签不把自动保存带到新文档

- **WHEN** 在某 pane 的 A 里输入后立刻切到同 pane 的 B（A 的崩溃备份 debounce 尚未到期），
  随后不再输入
- **THEN** 备份目录里出现的是 A 的路径与 A 的内容（A 仍 dirty），B 的路径不会多出一份
  属于 A 的备份；两个标签在 vault 内的磁盘文件都不被改写（scenario 名保留自 M149：约束对象
  已由自动保存 debounce 换成崩溃备份 debounce，不变量同一条【定时器按路径键控】）

#### Scenario: 后台标签的外部变更也被处置

- **WHEN** 双 pane，A 前台 `a.md`、B 前台 `b.md`（均干净），活跃 pane 是 A，B 的 `b.md` 被外部修改
- **THEN** `b.md` 自动重载并给出点名 `b.md` 的提示；MUST NOT 因为它在活跃 pane 之外而漏报

#### Scenario: 关闭 dirty 标签先确认

- **WHEN** 关闭一个有未保存修改的标签（任一 pane）
- **THEN** 出现带三个动作的确认（保存并关闭 / 放弃修改并关闭 / 取消）；选「保存并关闭」时先落盘再关闭，保存失败则不关闭

#### Scenario: 退出守卫取全体标签的并集

- **WHEN** 双 pane，只有非活跃 pane 里的一个标签有未保存修改，前端镜像给后端的 dirty 值
- **THEN** 镜像值为 true（退出会被拦下并给出提示）

### Requirement: 文件树联动与空态

文件树的高亮 SHALL 跟随**活跃 pane 的前台**标签的文件；没有打开任何文件（包括关掉最后一个
标签）时 SHALL 清空高亮，modeline 的文件名 SHALL 显示「无当前文件」。活跃 pane 切换或
活跃 pane 内切换标签时，高亮 SHALL 在同一帧内移到新目标的行上，原行不再高亮。
`syncActiveDocument` 是「活跃 pane 的前台标签 ⇄ chrome」的唯一同步点，MUST NOT 存在第二个
同步通道。

**定位请求是这条规则的一个显式例外**（Alex 2026-10-01 裁决维持）：收到「在树中定位路径」
（`file-tree` 的同名 requirement；入口是标签菜单的 Reveal in File Tree）时，高亮 SHALL 改为跟随
**被定位的那一行**——用户此刻点名要看的是那个文件，留着他刚才的标签高亮会让「滚到哪儿去了」失去
落点。这条例外 SHALL 在下一次前台文档变化时结束：`syncActiveDocument` 那一拍把
当前行按活跃 pane 的前台标签重写（其实现见 `src/main.ts`，本 capability 只要求那条重写存在且生效）。

#### Scenario: 切换标签时树高亮跟随

- **WHEN** 活跃 pane 里有标签 A 与 B 分别指向不同文件，从 A 切到 B
- **THEN** 文件树的高亮移到 B 对应的那一行，A 的行不再高亮

#### Scenario: 活跃 pane 切换时高亮同帧换源

- **WHEN** 双 pane（A 前台 `a.md`、B 前台 `b.md`），焦点从 A 的 contentDOM 移到 B 的 contentDOM
- **THEN** 文件树高亮同帧从 `a.md` 的行移到 `b.md` 的行，modeline 同帧切到 `b.md`

#### Scenario: 定位到非前台标签的文件时高亮跟随被定位的那一行

- **WHEN** 前台是标签 A，对指向另一个文件的标签 B 执行定位
- **THEN** 树的高亮落在 B 的那一行（A 的行不再高亮）；此后切换前台标签时高亮按活跃 pane 的前台标签重写

#### Scenario: 关掉最后一个标签回空态

- **WHEN** 依次关闭活跃 pane 的所有标签
- **THEN** 标签区隐藏（单 pane）、modeline 显示「无当前文件」、文件树无高亮；此后单击树里的
  文件开一个标签（开在活跃 pane）

### Requirement: 打开文档时恢复上次阅读位置

一份文档被**装载**到标签时（单击 / 双击 / ⌘-点击文件树、快速打开、文档内链接跟随、装载后按 vault 的
标签列表恢复标签），系统 SHALL 在当前 vault 的已存阅读位置里查该文档：命中时视口 SHALL 恢复到该位置——该位置
所在的**行**停在视口内的同一相对偏移，MUST NOT 停在篇首。没有历史（该文档从未被读过 / 条目已被清理 /
存储不可读）时 SHALL 从篇首开始，且 MUST NOT 给出任何提示：恢复位置是便利而不是承诺，一次失败不该
打扰阅读。

恢复 SHALL 只施加于**新装载**。命中「同一个文件已经打开的标签」时 SHALL 只切到既有标签并保留该标签
**应用运行期内**的位置（切标签的既有语义），MUST NOT 用盘上的位置改变读者的视口。

本能力的适用面 SHALL 覆盖 md 与 code 两种模式（位置锚与模式无关），MUST NOT 只对其中一种生效。

恢复 SHALL 与 ADR 0003 §3 的铁律一致：MUST NOT 写进文档内容、MUST NOT 在 vault 目录里产生文件、
MUST NOT 改变磁盘文件的字节。存储的位置是篇首时 SHALL 按篇首呈现，MUST NOT 让页首的内边距被顶出画。
恢复 SHALL NOT 阻塞首帧与界面可交互性，也 MUST NOT 在打开 1MB Markdown < 100ms 与 keypress-to-paint
< 16ms 两条阈值对应的路径上新增解析或文档遍历（ADR 0002 §6）；位置的持久化通道见 `vault-workspace`
的「按 vault 持久化阅读位置」。

**vault 外只读会话**（`quick-open` 的 D2 倾向侧）MUST NOT 记录阅读位置、也 MUST NOT 尝试恢复：
它的键不是 vault 相对路径，`vault-workspace` 的「按 vault 持久化阅读位置」本就在写入与读取两侧丢弃
绝对路径键——本 capability 据此显式认定它没有阅读位置，MUST NOT 为它新增例外或另一套键空间。

已知边界（如实记录）：恢复的是「文档位置锚 + 相对视口偏移」而不是像素；文档含异步加载的图片时，恢复
发生在图片字节到达之前，落点可能随内容高度变化而偏，由编辑器的滚动锚定把参照行维持在视口顶（实测口径
与未验证项见 change 的 design §7）。文件在两次会话之间被外部改写、或已被改名 / 移动时，位置不保证
仍然贴切——本能力不做内容比对，也不追踪改名。

#### Scenario: 重新打开一份读了一半的文档

- **WHEN** 在一个 vault 里打开某文档、滚动到中部，随后关闭该标签（或关闭应用）再次打开同一份文档
- **THEN** 视口回到上次离开的位置：顶部可见行与离开时相同，MUST NOT 停在篇首

#### Scenario: 已打开的标签不被盘上的位置拽走

- **WHEN** 文档 A 已在某个标签里打开并滚到中部，用户再次「打开」A（单击文件树 / 从别处跟随链接到 A）
- **THEN** 只切到既有标签，A 的视口停在原处——MUST NOT 跳回盘上记录的位置，也 MUST NOT 跳回篇首

#### Scenario: 没有历史时从篇首开始且无提示

- **WHEN** 打开一份从未打开过的文档（或该文档的阅读位置条目已被清理 / 存储不可读）
- **THEN** 从篇首开始，且不出现任何提示

#### Scenario: 篇首位置按篇首呈现

- **WHEN** 上次离开时该文档停在篇首，本次重新打开它
- **THEN** 视口呈现篇首：正文顶部的内容与内边距与初次打开一致，MUST NOT 出现「顶部留白被顶出画」

#### Scenario: code 模式同样恢复

- **WHEN** 打开一份非 md 文本文件、滚到中部后关闭标签，再次打开同一文件
- **THEN** 视口同样回到上次离开的位置（本能力不因模式而失效）

#### Scenario: 快速打开同样恢复阅读位置

- **WHEN** 一份 vault 内文档上次读到中部后被关闭，用户用快速打开再次打开它
- **THEN** 视口回到上次离开的位置（与文件树点击同一条恢复路径），MUST NOT 停在篇首

#### Scenario: 外部只读标签不记也不恢复位置

- **WHEN** 打开一个 vault 外只读标签并滚动到中部，随后关闭它、再次用快速打开打开同一文件
- **THEN** 视口从篇首开始；配置目录的阅读位置文件里不出现该绝对路径的条目

### Requirement: 打开语义

打开文件的落点 SHALL 按意图区分，且目标 pane SHALL 是**活跃 pane**：

- **单击文件树（含双击 / 其它修饰键）**：在活跃 pane 的**当前标签**就地打开该文件——当前标签
  跟随换文档，MUST NOT 新开标签。浏览器式语义：左栏点击是「在当前页签里打开」。当前标签是
  「还没有文件的空文档」时按下面「复用空文档」条款处理；文件已经打开时执行「移动标签」（见
  `pane-layout` 的「会话所有权」），MUST NOT 产生第二个标签。
  **例外（不丢未保存修改）**：当前标签有未保存修改时，单击 SHALL 退回「新开一个标签」——原
  标签连同其修改原样保留，MUST NOT 就地替换、MUST NOT 弹出拦截提示（「打开另一个文件不丢
  修改」是既有口径）；当前标签是图片会话时同理（见下条）。
- **⌘-点击文件树**：在活跃 pane **新开一个标签**并激活，当前标签 MUST 原样保留——它的文档
  内容、未保存状态与位置都不变（浏览器式「在新页签打开」）。文件已经打开时同单击一样执行
  「移动标签」，MUST NOT 产生第二个标签。
- **双击 / 其它修饰键**：与单击同义（双击是两次单击），MUST NOT 另立落点。
- **图片文件 / 二进制**：沿用既有落点（图片经 `openImage` 新建图片标签、二进制给既有提示）——
  文本会话不能改判成图片会话，本 capability 的「当前标签」意图 MUST NOT 被扩张成会话换轨。
  反向同理：**当前标签是图片会话**时，普通点击文本文件 SHALL 退回「新开一个标签」（图片会话
  不能改判成文本会话，就地替换只会留下图片前台 + 空正文的假象）；⌘-点击的落点不变。
- **快速打开**（`app.quick-open` 选中候选或直开一个路径）：在活跃 pane 打开一个**标签**，
  已打开时执行「移动标签」；它的解析与输入面见 `quick-open`，本 capability 只认它的落点。
  MUST NOT 就地替换前台标签（那是**单击文件树**与文档内链接跟随的语义）。
- **文档内链接跟随**（⌘-点击文档内的链接 / ⌘⏎）：当前标签跟随换文档，MUST NOT 新开标签；
  目标文件已在某处打开时，移动其标签到活跃 pane 并激活（标签总数不变），当前标签保留。
- **另存为新文件 / 恢复崩溃备份**：就地替换**活跃 pane 的前台**标签（内容是「当前这份文档
  换个落点」）。
- **按 vault 恢复标签列表**：按 `vault-workspace` 持久化的 pane 布局恢复，逐 pane 逐个文件
  各开一个标签（见「按 vault 持久化 pane 布局」）。

文件树点击与快速打开的落点 SHALL 复用「还没有文件的空文档」（冷启动示例文档 / 关掉最后一个标签后的
空文档）：它承载的是「还没有打开任何文件」这个状态本身、不是一个标签，就地落在它上面
MUST NOT 在会话列表里留下第二个不可见的空会话；它不干净时（有真实修改）MUST NOT 复用它
（那份内容没有落盘基准，就地替换等于丢弃草稿）。

**同一个文件已经打开时一律不产生第二个标签**——这条对全部意图、全部 pane 成立：同 pane 内
是切到既有标签，跨 pane 是移动标签。快速打开的外部只读标签同样遵守这一条（去重按绝对路径的
字符串相等判定）。

**vault 外只读标签**（`quick-open` 的 D2 倾向侧）是本 capability 里唯一一种「不随 vault 持久化、
不参与保存与监听」的标签：它恒为结构性只读，不产生 dirty；切换 vault 时随整窗上下文替换一并作废，
MUST NOT 跨 vault 保留，也 MUST NOT 阻止切换（它不 dirty、没有可丢的修改）。它的其他边界（不入
标签持久化、不参与 watch、不参与链接解析）分别由 `vault-workspace`、`fs-io` 与 `quick-open` 自己
的 requirement 认领，本 capability 不重复定义。

文档内链接的 ⌘-点击语义 MUST NOT 因本能力改变（M144/M145 口径原样保留）：文档内的 ⌘-点击
仍是链接跟随（当前标签换文档），与文件树的 ⌘-点击（新标签）是**两个手势面**，MUST NOT 互相
沿用或混同。

#### Scenario: 单击树文件开一个标签

- **WHEN** 活跃 pane 的标签栏里已有 A，单击树里的 B
- **THEN** A 标签就地变成指向 B 的文档并激活；标签总数不变，编辑器上屏 B 的内容，
  A 的原内容与标签位置不再保留（当前标签被就地替换）

#### Scenario: 未保存修改不被普通点击替换

- **WHEN** 当前标签有未保存修改，用户普通点击文件树里的另一个文件
- **THEN** 新开一个标签打开该文件；原标签仍在且其未保存内容 / dirty 标记不变，不出现拦截提示

#### Scenario: ⌘-点击树文件新开标签并保留当前标签

- **WHEN** 活跃 pane 的前台标签是 A（含未保存修改），⌘-点击树里的 B
- **THEN** 活跃 pane 新开一个指向 B 的标签并激活；A 的标签原样保留——文档内容、未保存状态
  与标签位置都不变，切回 A 时内容与 dirty 标记仍在

#### Scenario: 双击与其它修饰键不另立落点

- **WHEN** 活跃 pane 的标签栏里已有 A，双击树里的 B（或按住 Shift / Alt / Ctrl 单击 B）
- **THEN** 与单击同义：在当前标签就地打开 B，标签总数不变，MUST NOT 新开标签

#### Scenario: 重复打开同一个文件

- **WHEN** 对已经打开的同一个文件再次执行打开（单击 / 双击 / ⌘-点击任一形态），目标文件在
  **另一个** pane 的标签里
- **THEN** 执行移动标签：标签带其 EditorState 与滚动位置迁到活跃 pane 并激活；标签总数不变，
  源 pane 不再有该标签（变空时保持在场），MUST NOT 新开第二个、MUST NOT 复制标签

#### Scenario: 空态打开第一个文件

- **WHEN** vault 已装载但没有打开任何文件，单击树里的 A
- **THEN** 标签栏出现一个指向 A 的标签；此后关掉它回到空态、再单击树里的 B，标签栏仍只有一个指向 B 的标签（复用空文档，MUST NOT 让空会话堆积）

#### Scenario: 链接跟随不新开标签

- **WHEN** 在活跃 pane 的文档 A 里 ⌘-点击一个指向 B 的链接（B 未打开）
- **THEN** 当前标签就地变成 B，标签总数不变；随后 ⌘-点击一个指向已在另一 pane 打开的 C 的链接
- **THEN** C 的标签移动到活跃 pane 并激活（带状态），原标签保留，标签总数不变

#### Scenario: 标签标题字形与激活态一致

- **WHEN** 任意顺序在两个 pane 里打开若干文件
- **THEN** 所有标签标题的字体形态相同（只有各 pane 内前台那一条额外带激活态底色 / 投影），
  MUST NOT 出现斜体标题

#### Scenario: 快速打开用同一条落点

- **WHEN** 活跃 pane 的标签栏里已有 A，用户用快速打开打开未打开的 B；随后用快速打开再次打开 B
- **THEN** 第一次新开一个指向 B 的标签并激活（A 保留）；第二次切到既有的 B 标签（或在另一个 pane
  时移动并激活），标签总数不变、MUST NOT 出现第二个 B 标签、MUST NOT 顶掉 A

#### Scenario: 外部只读标签不阻止切换 vault

- **WHEN** 前台是一个 vault 外只读标签，用户切换到另一个 vault
- **THEN** 切换不被拦下（该标签不 dirty），外部标签随整窗上下文替换一并作废，MUST NOT 在新 vault
  里保留或恢复

### Requirement: 标签的关闭操作

标签栏 SHALL 为每个标签提供右键菜单（`role=menu` 浮层，读屏名 D148），五项按固定顺序：
**Reveal in File Tree / Close / Close Other Tabs / Close Tabs to the Right / Close All Tabs**。
五项的**上屏文案 SHALL 一律取英文原文、不随界面语言变**：三条关闭项是 M257 裁决（原中文措辞留
在 `文案-Copy.md` 备查），定位项是 Alex 2026-10-01 的裁决「菜单内语言统一」（其需求原话
「在左栏中定位到此文件」留在中文列作沿革备查），关闭全部项（D946）沿用同一口径——`zh`
界面下整条菜单因此都是英文（MUST NOT 回落中文列）。读屏名 D148「标签操作」不随这些裁决改语言。

**定位项 SHALL 排在首位**：标签菜单没有分隔线（本 change 不引入分隔线），顺序因此是唯一的分组表达
方式——非破坏性项在前、四条关闭路径仍是尾部连续的一块，与文件树条目菜单「非破坏性项在破坏性项之前」
（`tree-menu.ts` 的项集里 `reveal` 排在 `trash` 之前）同一方向。默认游标（首项）因此落在定位项上。

定位项 SHALL 作用于**指针落在的那一条标签**的文件路径：调文件树的「在树中定位路径」（见 `file-tree`
的同名 requirement），MUST NOT 改变前台标签、MUST NOT 打开或关闭任何标签。路径不在当前树模型里时
（文件已被外部删除 / vault 变过）SHALL 是空动作，MUST NOT 报错、也 MUST NOT 给提示。

菜单 SHALL 支持 ↑↓ 与 ⌃N⌃P 等价的游标移动、Enter 触发、Esc 与外部点击关闭；打开时 SHALL 持焦点
（游标落在首项），关闭时 SHALL 把焦点归还触发它的那一个标签；菜单非模态，其余按键照走原生路径。

Close / Close Other Tabs / Close Tabs to the Right 三条的锚点 SHALL 是**右键落在的那一个标签**；
Close All Tabs 的关闭范围不是锚点而是**整个 pane 的标签组**：

- Close：该标签；
- Close Other Tabs：除该标签以外的全部标签（本版 MUST NOT 保留任何标签——不存在「固定标签」这一分类）；
- Close Tabs to the Right：标签栏里排在该标签**右侧**的全部标签（锚点由指针位置决定，MUST NOT 取当前前台标签）；
- Close All Tabs：**右键所在 pane 的标签条上的全部标签**（含右键那一条；双 pane 时另一个 pane 的
  标签 MUST NOT 受影响）——范围由实例边界决定，不由右键落在哪一条决定。

右键 MUST NOT 改变前台标签，也 MUST NOT 触发打开——右键只决定菜单作用于哪一条。

关闭路径命中**有未保存修改**的标签时 SHALL 复用既有的关标签确认（保存并关闭 / 放弃修改并关闭 / 取消，
与 ⌘W、× 按钮同一条确认流），MUST NOT 新造确认界面。批量路径（Close Other Tabs / Close Tabs to the
Right / Close All Tabs）SHALL 逐个提交关闭：同一时刻 MUST NOT 出现两条确认浮条；用户取消、放弃出口
之外的关闭失败、或直接点掉确认浮条时 SHALL 停手，尚未处理的标签 MUST NOT 被关闭（MUST NOT 因为
「用户已经在批量动作里点过一次」就静默丢弃它们的修改）；已经成功关闭的标签 MUST NOT 回滚。没有
可关的标签时四项 SHALL 是空动作（不报错、不提示）。

Close All Tabs 全部关完之后，该 pane MUST NOT 留下任何标签，前台 SHALL 回到空工作区
（modeline「无当前文件」、单 pane 时标签区隐藏；空工作区的正文不是焦点落点）。

Close All Tabs 的批量收尾（全部关完**或**中途停手）SHALL 归还一次焦点：确认浮条的动作钮在
答复那一刻随浮条从 DOM 移除，焦点 MUST NOT 留在 `body`。落点按该 pane 的当前前台分三种：该 pane
还有带路径标签 ⇒ 焦点 SHALL 交给前台标签的编辑器正文；该 pane 已无带路径标签（空工作区）⇒
焦点 SHALL 交给该 pane 的命名静态 region；前台是图片会话（编辑器是哨兵只读面）⇒ 焦点
SHALL 交给那一条标签的按钮。焦点 MUST NOT 跨到另一个 pane。
保存冲突与写失败的提示是非模态浮条，**既有合同是不夺焦**（与 ⌘S 触发的同一条提示一致）——
停手时它们保持可见，焦点仍按上一句归还该 pane 的入口，MUST NOT 声称已删除的浮条或它的按钮持焦。

vault 外只读会话与图片会话沿用 `closeTab` 的既有语义（恒无未保存内容，直接关闭、不弹确认）。

#### Scenario: 右键标签弹出菜单且不改上下文

- **WHEN** 标签栏里有三个标签、前台是第二个，右键第一个标签
- **THEN** 菜单出现，含「Reveal in File Tree / Close / Close Other Tabs / Close Tabs to the Right /
  Close All Tabs」五项且顺序如上；前台仍是第二个标签（右键不改上下文），标签总数不变

#### Scenario: 定位项把标签的文件在左栏里显现出来

- **WHEN** 前台是标签 A，标签 B 指向 `a/b/c.md`（树里 `a`、`b` 折叠），右键 B 并选 Reveal in File Tree
  定位项
- **THEN** 树展开 `a`、`b` 并列出 `a/b/c.md`，该行滚进可视区且成为当前行；前台仍是 A，标签总数不变

#### Scenario: 关闭右键那一个标签

- **WHEN** 有三个标签，右键中间那一个并选 Close
- **THEN** 只关掉它，其余两个标签按原顺序留下；被关掉的不是前台标签时，前台标签不变

#### Scenario: 关闭其他标签（Close Other Tabs）

- **WHEN** 有三个标签，右键第一个并选 Close Other Tabs
- **THEN** 只剩第一个标签（它成为前台；右键时它并不在前台也可以）

#### Scenario: 关闭右侧标签（Close Tabs to the Right）

- **WHEN** 有四个标签，右键第二个并选 Close Tabs to the Right
- **THEN** 前两个标签留下；第三个、第四个被关掉；前台若是第三个，则前台落到留下的标签上

#### Scenario: 关闭全部标签（全 clean）

- **WHEN** 某 pane 有三个干净标签，右键其中任意一条并选 Close All Tabs
- **THEN** 三条全部关闭（包括右键那一条），该 pane 回到空工作区：modeline 显示「无当前文件」、
  单 pane 时标签区隐藏、标题栏与正文区的位置不因关完标签而移动；焦点落在该 pane 的静态 region，
  MUST NOT 落在正文或 `body`

#### Scenario: 关闭全部标签：多个 dirty 逐个确认，取消即停手

- **WHEN** 某 pane 有三个标签，第二条与第三条有未保存修改，右键第一条（干净）并选 Close All Tabs，
  随后在第一条脏标签的确认里选「取消」
- **THEN** 第一条（干净）已经关闭且不回滚；第二条与第三条都还在，脏内容不动；同一时刻只有一条确认浮条；
  焦点回到当前前台（有带路径标签时是正文，全关完后是空工作区的静态 region），MUST NOT 留在 `body`，
  因为答复用的按钮已随浮条移除

#### Scenario: 关闭全部标签：保存与放弃之后继续到关完

- **WHEN** 上一步的现场里重新执行 Close All Tabs，对第一条脏标签选「放弃修改并关闭」，对下一条脏标签
  选「保存并关闭」
- **THEN** 放弃的标签不写盘、保存的标签落盘后才关闭；批量逐条继续到全部关闭；重新执行时不会被
  「用户已经答过一次」放行而静默丢弃后面的修改

#### Scenario: 关闭全部标签：保存未闭环停手（冲突 / 写失败）

- **WHEN** Close All Tabs 在某个脏标签的确认里选「保存并关闭」，而保存报冲突（或写失败）
- **THEN** 该标签不关、批量停手；冲突 / 失败提示在场（既有非模态浮条），脏内容仍在内存；
  焦点回到前台标签的编辑器正文，MUST NOT 留在 `body`；后续标签不被处理

#### Scenario: 关闭全部标签：只读外部会话与图片会话不弹确认

- **WHEN** 某 pane 有普通标签、vault 外只读标签与图片标签，执行 Close All Tabs
- **THEN** 三类标签都直接关闭，不出现「有未保存修改」的确认（它们恒无未保存内容）

#### Scenario: 关闭全部标签：作用域是右键所在的 pane

- **WHEN** 双 pane，左 pane 有标签 A、B，右 pane 有标签 C、D，右键右 pane 的 C 并选 Close All Tabs
- **THEN** 只关闭 C、D；A、B 原样保留；右 pane 回到空工作区，焦点落在右 pane 的静态 region
  （MUST NOT 跨到左 pane 的正文或标签）

#### Scenario: 脏标签先确认

- **WHEN** Close Tabs to the Right 的目标里有未保存修改的标签
- **THEN** 出现既有的三出口确认（保存并关闭 / 放弃修改并关闭 / 取消），其间不出现第二条确认浮条；选「保存并关闭」时先落盘再关，保存未闭环则该标签不关、批量动作停手

#### Scenario: 取消即停手

- **WHEN** 上一步的确认里选「取消」（或直接点掉浮条）
- **THEN** 该标签与它右侧尚未处理的标签都还在，MUST NOT 出现任何静默关闭

#### Scenario: 键盘打开与关闭

- **WHEN** 菜单打开后按 ↓ 或 ⌃N，再按 Enter
- **THEN** 游标移到第二项（Close）并执行它；按 Esc 时菜单收起、不执行任何动作，焦点回到产生菜单的那个标签

### Requirement: vault 外只读标签的可见标记

vault 外只读标签（`session.external`）的可见标记 SHALL 是一枚小型锁形图标，MUST NOT 用文字后缀
（如「· 只读」）：图标取既有细线 SVG 工艺（10×10、`currentColor`、1.3px 描边），带 `aria-hidden`，
排在文件名之前；可见标签文字 SHALL 只有文件名。只读语义对读屏用户 SHALL 由按钮的可访问名承担
（`{名称}（vault 外只读）`），MUST NOT 依赖图标传达——图形不会自动进入可访问名。判据 SHALL 是
`session.external`：vault 内标签 MUST NOT 出现该图标。图标 MUST NOT 引入新 token / 色值 / 字号
（颜色取既有 `--text-2`，三主题由 token 体系覆盖）。

#### Scenario: 只读标签的可见标记

- **WHEN** 通过快速打开打开一个 vault 外绝对路径
- **THEN** 该标签可见文字只有文件名，文件名前有一枚 `aria-hidden` 的锁形图标；按钮的可访问名仍是 `{名称}（vault 外只读）`，悬停提示仍是完整绝对路径

#### Scenario: vault 内标签没有该图标

- **WHEN** 打开一个 vault 内文件
- **THEN** 它的标签不出现锁形图标（负向对照：判据不是「所有标签」）

### Requirement: 标签的短暂导航高亮

当一次**路径导航**动作（harness 路径链接，含工具卡片，见 `harness` 的「输出中的 vault 路径
可点击」）命中**已经打开**的标签时（目标文件已是前台文档，或位于同 pane 的后台标签），该标签
SHALL 获得一次**短暂导航高亮**（下称「闪烁」）：在既有标签外观上叠一层选中档底色，约 1.4 秒后
自动消退。闪烁是「你点的那条路径在这里」的定位反馈，MUST NOT 被理解为激活态——闪烁期间该标签
的激活态、dirty 点、关闭按钮与读屏名均不变。它 MUST NOT 构成第二种标题形态：标题字形、字重、
文字色与读屏名均不变，只有底色层变化（与「标签栏的显示与形态」的「形态只由前台决定」不冲突，
因为它不是标题形态）。

闪烁 SHALL 按**会话对象**记账，MUST NOT 只在 DOM 节点上挂一个 class 了事：标签栏全量重建时，
若重建后的标签仍属于同一个被闪烁的会话，该 class SHALL 被重新施加；会话关闭、关 pane 或双
pane 收拢导致标签栏销毁时 SHALL 立即清理计时器与状态。标签栏实例 SHALL 暴露销毁入口
（`TabsHandle.dispose()`），由 pane 装配层在销毁编辑器之前调用（或登记进宿主的退订表），
MUST NOT 依赖「DOM 没了自然就好了」；计时回调若发现槽已卸载，MUST 先清空闪烁状态与计时器
再返回，MUST NOT 留下指向已销毁节点的状态。同一入口再次命中同一标签 SHALL 重置消退计时，MUST NOT 叠加第二层
高亮或留下残影；闪烁中途命中另一个标签 SHALL 把高亮整块换到新标签（同一时刻至多一个标签闪烁）。

闪烁 MUST NOT 改变标签的几何（宽高、内边距、字号、字重、圆角、位置），MUST NOT 触发重排或
滚动；它只是底色层的瞬态变化。闪烁期间 MUST NOT 把该标签拍进视觉基线——验收截图须等它消退后
再拍（或显式等待 1.4 秒 + 一帧）。

视觉取值 SHALL 走 token 层：底色取 `--sel-band`（三主题各自现行值），MUST NOT 新造色值；
`--sel` 在 light 主题下与激活标签的 `--content-bg` 过近，MUST NOT 用作本高亮的底色。eink 下
同样取 `--sel-band`（现行值 `#b9b9b9`）；文字色保持该标签原值（不因闪烁改写），不新增色值或
描边。样式声明
SHALL 排在 `.tab.is-active` 与 `.tab:hover` 之后（同特异性、后声明者胜），使指针停在标签上时
闪烁仍可见。

闪烁时长 SHALL 复用仓内既有的导航反馈常量（`NAVIGATION_HIGHLIGHT_MS`，1400ms），MUST NOT
新造第三个时长值；它与编辑器行高亮的消退窗口同长，两者同时发生时同拍消退。

#### Scenario: 已打开标签闪烁一次后消退

- **WHEN** 一次导航命中一个已经打开的标签
- **THEN** 该标签立刻带上闪烁态（底色为 `--sel-band` 的计算值），约 1.4 秒后闪烁态消退，标签
  回到原来的外观；激活态、dirty 点与读屏名全程不变

#### Scenario: 重复命中重置计时

- **WHEN** 闪烁尚未消退时再次命中同一标签
- **THEN** 消退计时从这次命中重新起算，只保留一层高亮；约 1.4 秒后只消退一次，不残留

#### Scenario: 全量重建不丢闪烁态

- **WHEN** 闪烁期间标签栏因其它原因全量重建（如另一个标签的 dirty 变化触发重绘）
- **THEN** 被闪烁的会话对应的新标签仍带闪烁态，消退计时继续有效；MUST NOT 因 DOM 重建而提前
  消失或永久残留

#### Scenario: 切换与关闭立即清理

- **WHEN** 闪烁期间用户关闭该会话，或标签栏整体卸载
- **THEN** 闪烁态与计时器立即清理；不出现指向已销毁节点的回调，不把闪烁带到别的标签上

#### Scenario: 闪烁中收 pane

- **WHEN** 双 pane 下右 pane 的标签正在闪烁，用户收起该 pane
- **THEN** 该 pane 的 `TabsHandle.dispose()` 被调用，闪烁状态与计时器立即清空；不留残留
  class、不产生指向已销毁节点的回调；左 pane 的标签外观不受影响

#### Scenario: 闪烁不改变几何

- **WHEN** 对比闪烁前后的标签矩形（宽、高、位置）与文字样式
- **THEN** 全部逐值不变；只有底色变化，不触发重排或标签栏滚动

#### Scenario: eink 下的闪烁可辨

- **WHEN** eink 主题下触发一次标签闪烁
- **THEN** 标签底色为 `--sel-band`（eink 现行值 `#b9b9b9`）、文字色保持标签原值，闪烁可辨；
  不新增色值或描边

### Requirement: 保存全部（document.save-all）

系统 SHALL 提供统一的「保存全部」命令 `document.save-all`，它保存**全部 pane 的全部**脏标签，
并在保存之后完成一组**可判定的落盘屏障**：

1. 全部脏标签逐条保存（一条失败不打断其余；任一未闭环即整体失败）；
2. 标签会话 SHALL 真实落盘（不只是排期防抖写）；写失败 SHALL 使整体失败；
3. 阅读位置 SHALL 真实落盘（无待写内容视为成功）；写失败 SHALL 使整体失败；
4. 屏障期间出现新的未保存修改 SHALL 使整体失败（不得对一个已经又变脏的界面报成功）；
5. 后端退出守卫的 dirty 镜像 SHALL 以一次 awaited 往返同步为「无脏标签」；同步失败 SHALL 使整体
   失败。

系统 SHALL 维护一份**追加式**的保存全部状态日志（`save-all-log s<seq>:g<代次>:<状态> …`，视觉
隐藏、AX 可达）：每次命令调用 SHALL 追加带单调 seq 的记录，真正开始的保存全部 SHALL 追加 `running`
并以新代次标记，终态 SHALL 追加 `ok` 或 `failed`，并发被拒的触发 SHALL 追加 `busy`（同一代次）。

只有上述五步全部成功，系统 SHALL 追加 `ok` 并给出正向终态（D1049）；任一步失败 SHALL 追加
`failed` 并给出失败终态（D1050），MUST NOT 清除任何标签的 dirty、MUST NOT 以「没有错误提示」
「界面上的 dirty 点消失」或任何缺失读数冒充成功。外部自动化 SHALL 只接受「触发后第一条新记录为
running，且随后出现**同代次** ok」作为本次操作成功；无归属的更高代 ok、同一代次的旧 ok、以及被
其它代次 ok 覆盖的 busy / failed MUST NOT 放行。

标签会话与阅读位置的真实落盘结果 SHALL 由后端可判定地报告（磁盘写失败 MUST NOT 以成功回包，
普通调用方的降级与 warning 语义保持不变）。屏障在后端 dirty 镜像同步的 await 返回后 SHALL 再查一次
dirty；出现新 dirty 时 SHALL 先把镜像恢复为 true 再走失败终态，MUST NOT 用 false 覆盖新 dirty。
并发 / 重复触发 SHALL 采用单飞：第二次触发 MUST NOT 开启新代次或复用前一次的成功信号。

该命令 SHALL 经统一命令层执行并**默认不绑键**（登记在无默认键位清单）；原生 File → Save All
菜单项 SHALL 指向同一命令实现，MUST NOT 自带 accelerator（菜单键等价会截走 webview 的键位分发），
MUST NOT 另开第二条保存链路。图片标签与 vault 外只读标签没有保存落点，SHALL 被视作空操作。

既有 `⌘S` 的粒度不变：它 SHALL 只保存活跃 pane 的前台标签。

#### Scenario: 多标签一次保存全部

- **WHEN** 两个标签都带未保存修改，用户执行 `document.save-all`（命令或 File → Save All）
- **THEN** 两个标签都落盘并清除 dirty，出现正向完成终态；磁盘上两份文件都含各自的修改

#### Scenario: 屏障任一步失败不报成功

- **WHEN** 保存全部时任一标签写盘失败，或标签会话 / 阅读位置 flush 写失败，或屏障期间又产生新的
  未保存修改
- **THEN** 出现失败终态且不出现完成终态；仍然脏的标签保持 dirty，MUST NOT 被当作已保存

#### Scenario: 旧的完成信号不放行

- **WHEN** 上一次保存全部的成功提示仍在场，用户产生新的未保存修改后再次执行保存全部
- **THEN** 只有「本次触发第一条新记录为 running 且随后同代次 ok」才算成功；直接出现的更高代
  旧 ok、同一代次的旧 ok、被别代 ok 覆盖的 busy / failed、缺日志 / 空树 / 超时一律判失败

#### Scenario: 正向完成终态是唯一成功判据

- **WHEN** 自动化通道（验收的安装版暂停）需要在退出前确认「保存全部真的完成」
- **THEN** 它等待完成终态的**节点级精确出现**；AX 空树、AX 读失败、超时、或同一句话只出现在文档
  正文里，一律判失败，不得据此退出应用

### Requirement: 退出前的保存全部确认

有未保存修改时，后端退出守卫拦截 ⌘Q / 关窗后，前端 SHALL 显示**居中的模态弹框**作为唯一可见
出口，MUST NOT 只用瞬时 / 自消隐的 toast。弹框 SHALL 说明存在未保存修改，并只提供两条动作：
「保存全部并退出」（主按钮）与「取消」（次按钮）；MUST NOT 提供「丢弃修改」或任何等义的
第三条退出口。

「保存全部并退出」SHALL 复用既有的保存全部屏障（与 `document.save-all` 同一实现）：保存全部
脏标签、标签会话真实 flush、阅读位置真实 flush、后端 dirty 镜像 awaited 同步，并在同步后复查
dirty。只有屏障报告全部成功且本地复查无新 dirty 时，才 SHALL 请求退出；保存失败 / 冲突 /
出现新 dirty 时 MUST NOT 退出，弹框与现场 SHALL 保持，错误 SHALL 可见，MUST NOT 自动重试。

退出 SHALL 经后端命令执行，该命令 MUST 在退出前复核 dirty 镜像为 false；镜像仍为 true 时 MUST
拒绝退出并返回稳定错误码。前端 MUST NOT 通过合成键盘事件、Apple Event 或信号量绕过该守卫。

「取消」SHALL 只关闭弹框，MUST NOT 退出、MUST NOT 保存或丢弃任何内容。正常干净退出 MUST NOT
出现弹框。

弹框 SHALL 满足：初始焦点落在弹框动作上；Tab / Shift+Tab 在弹框内循环；Escape 等同「取消」；
打开期间背景置 `inert`；关闭后焦点还原到打开前的元素。连续收到退出拦截通知时 MUST NOT 叠出
多个弹框或触发重复退出；保存 / 退出进行中收到的取消意图 MUST 被忽略。

#### Scenario: 未保存时退出出现居中弹框

- **WHEN** 任一标签有未保存修改，用户按 ⌘Q（或点关闭窗口）
- **THEN** 应用不退出，出现居中的模态弹框，说明存在未保存修改，只有「保存全部并退出」与
  「取消」两个动作；不出现「丢弃修改」；背景不可交互，焦点在弹框内

#### Scenario: 保存全部并退出

- **WHEN** 弹框内点「保存全部并退出」，保存屏障全部成功且没有新 dirty
- **THEN** 全部脏标签内容落盘、标签会话与阅读位置完成 flush，随后经受控后端命令退出；
  退出命令执行前复核 dirty 镜像为 false

#### Scenario: 保存失败保持弹框与现场

- **WHEN** 弹框内点「保存全部并退出」，保存冲突 / 写失败 / flush 失败 / 同步后出现新 dirty
- **THEN** 不退出；弹框仍在，错误可见，未保存内容仍在编辑器内；MUST NOT 自动重试

#### Scenario: 取消与 Escape 只关闭弹框

- **WHEN** 弹框内点「取消」，或焦点在弹框内按 Escape
- **THEN** 弹框关闭、焦点回到打开前的元素；应用不退出，文档内容与磁盘文件逐字节不变

#### Scenario: 连续退出拦截不叠弹

- **WHEN** 弹框已打开时再次按 ⌘Q / 再次收到退出拦截通知
- **THEN** 仍然只有一个弹框，不新建第二个弹框，也不产生重复的退出请求

#### Scenario: 保存期间新 dirty 不退出

- **WHEN** 「保存全部并退出」执行期间用户继续编辑，或保存完成后、退出命令到达前出现新的未保存修改
- **THEN** 不退出；弹框保持并给出可见错误；MUST NOT 以旧的保存成功结果放行退出

#### Scenario: 后端复核拒绝退出

- **WHEN** 前端请求退出时后端 dirty 镜像仍为 true
- **THEN** 后端拒绝退出并返回稳定错误码，应用不退出；该拒绝 MUST NOT 被前端当作成功

#### Scenario: 干净退出不出现弹框

- **WHEN** 没有任何未保存修改，用户按 ⌘Q
- **THEN** 应用正常退出，MUST NOT 出现退出确认弹框

### Requirement: 按住 Command 的标签序号提示

系统 SHALL 在用户按住左或右 Command 期间，于当前活跃文档 pane 的标签条上按可见标签顺序叠加序号 `1`…`9`。序号 SHALL 与该 pane 的 `⌘1`…`⌘9` 直达顺序一致；第 10 个及之后的标签 MUST NOT 显示直达序号，系统 MUST NOT 因此新增 `⌘0` 或其他标签动作。非活跃 pane MUST NOT 同时显示序号。

序号 SHALL 是绝对定位的瞬态视觉装饰，带 `aria-hidden="true"` 且不接收指针事件。显示或隐藏序号 MUST NOT 改变任何标签的宽度、tabstrip 的滚动位置、正文布局或文档内容，也 MUST NOT 改变标签与关闭钮的既有可访问名、焦点和点击语义。

松开 Command、窗口失焦、页面进入隐藏状态或标签实例销毁时，系统 SHALL 立即撤下序号并清理对应监听与状态。按住期间切换标签、开关 pane、增减标签或重绘标签栏后，序号 SHALL 按最新活跃 pane 与标签顺序保持正确；双 Meta 与重复事件不得造成粘住或重复动作。

#### Scenario: 按住显示、松开撤下且保持几何不变

- **WHEN** 当前 pane 有一至九个可见标签，用户按住左或右 Command，随后松开
- **THEN** 按住期间第 N 个标签仅显示序号 N，松开后所有序号消失；显示前后各标签宽度、tabstrip 滚动位置和正文布局逐值不变，标签读屏名不变

#### Scenario: 第十个标签起无直达序号

- **WHEN** 当前 pane 有超过九个可见标签并按住 Command
- **THEN** 仅前九个标签依次显示 `1`…`9`，第十个及之后不显示序号，且 `⌘0` 不产生标签切换

#### Scenario: 失焦、隐藏与销毁清理

- **WHEN** 序号显示期间窗口 blur、页面进入 hidden 或标签实例 dispose
- **THEN** 序号立即消失；实例销毁后后续键盘事件不得复活序号或产生额外标签动作

#### Scenario: 按住期间切换 pane 与标签集合

- **WHEN** 双文档 pane 中按住 Command，再切换活跃 pane、开关 pane 或增减标签
- **THEN** 仅最新活跃 pane 按最新可见标签顺序显示序号，另一 pane 不显示；关闭动态 pane 后其监听与状态一并销毁

#### Scenario: Harness 持焦时仍显示命令目标文档 pane

- **WHEN** 文档 pane 有可见标签，Harness composer 持焦后按住 Command，或按住 Command 后打开 Harness
- **THEN** 序号继续显示在既有 `⌘1–9` 实际作用的文档 pane；切换标签与开关 Harness 不改变既有焦点语义

### Requirement: 无 Tab 空工作区与 dirty 判定

没有带路径标签时，该 pane 的前台是**空工作区**：MUST NOT 可编辑、MUST NOT 产生未保存修改，
也没有保存落点。打开文件 SHALL 就地复用无路径占位会话（MUST NOT 让空会话堆积），复用后该会话
按新路径恢复可编辑。

前台是**有文件路径的标签**时，打开另一个文件 MUST NOT 被 dirty 拦下——它开成（或复用）标签，
修改留在原标签上。这是本能力相对 M101/M130 的语义变化，SHALL 记在 proposal 的「语义变化」里。

切换 vault 的守卫 SHALL 用「任一标签有未保存修改」作判据（切 vault 会把全部标签一起作废）。
拦下时的人话提示 SHALL 点名**当前** vault 与它有未保存修改的标签数——MUST NOT 点名切换目标
（未保存修改属于当前 vault），也 MUST NOT 逐个列出脏标签（哪些标签脏由标签栏逐标签的 dirty
点承担）；出口口径（保存并切换 / 放弃修改并切换 / 取消）见 `vault-workspace` 的「vault 切换与
整窗上下文替换」，本 capability 不再自带一句无动作的提示。

#### Scenario: 空工作区没有 dirty，打开文件不被拦截

- **WHEN** 没有打开任何文件，在空工作区里按键（含可编辑文本、粘贴与输入法合成），再单击文件树里的文件
- **THEN** 空工作区内容不变、不出现未保存修改；文件正常打开，不出现任何「无法切换」的拦截提示

#### Scenario: 有文件路径的标签 dirty 时不拦

- **WHEN** 打开 A 并编辑（A 变 dirty），再单击文件树里的 B
- **THEN** B 被打开，A 的标签保留且仍带 dirty 点；不出现任何「无法切换」的拦截提示

#### Scenario: 任一标签 dirty 即拦下切换 vault

- **WHEN** 有两个标签且其中**非前台**那个有未保存修改，触发切换 vault
- **THEN** 切换被拦下，提示点名当前 vault 与它有未保存修改的标签数（1 个）并给出三条出口；
  MUST NOT 因为脏标签不在前台而放行，MUST NOT 点名切换目标

#### Scenario: 关闭最后一个标签后不产生可保存内容

- **WHEN** 单 pane 的最后一个干净标签被关闭
- **THEN** 前台回到空工作区：modeline 显示「无当前文件」，`⌘S` 无提示、无写入；编辑器不是焦点
  落点，也不存在随后的「未命名文档 dirty」状态
