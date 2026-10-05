# multi-tabs Specification

## Purpose

定义多标签会话的落地口径：每个文档 pane 一个 `EditorView` + 每标签独立 `EditorState`（切换经 `view.setState`，撤销史/语法树/选区随标签留存），标签栏的显示与形态、打开语义（树上的单击 / 双击 / ⌘-点击各开一个标签、文档内链接跟随不新开、另存为与恢复备份就地替换前台标签）、按标签隔离的 dirty 判定与保存粒度、文件树高亮联动与空态。由 change `add-multi-tabs` 归档并入（2026-09-17，实现 M149），并由 change `remember-reading-position` 归档并入（2026-09-24，实现 M194——打开文档时按 vault 恢复上次阅读位置）；change `preview-tab-removal` 归档并入（2026-09-28，实现 M254）后，预览 / 固定标签的二元性整条退场，承载条由「打开语义」接替。由 change `pane-system-split-view` 归档并入的增量（2026-10-05，实现 M315–M322）：标签条按 pane 各自承载（双 pane 时标题栏标签区左右分区、槽宽随分隔条），⌘S / 保存粒度、树高亮、打开落点、dirty 守卫全部改以「活跃 pane 的前台标签」与「全部 pane 的全部标签」为口径，每个文档 pane 各建一个 `EditorView`。

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

### Requirement: 未命名文档的 dirty 守卫

前台是**未命名文档**（没有文件路径，内容只活在内存里）且有未保存修改时，打开任何文件 SHALL
被拦下并给出人话提示（沿用 M130 的守卫与文案：这类内容没有落盘基准，「请先保存」是一条走
不通的建议，提示 SHALL 指向撤销修改这条真正的出口）。

前台是有文件路径的标签时，打开另一个文件 MUST NOT 被 dirty 拦下——它开成（或复用）标签，
修改留在原标签上。这是本能力相对 M101/M130 的语义变化，SHALL 记在 proposal 的「语义变化」里。

切换 vault 的守卫 SHALL 用「任一标签有未保存修改」作判据（切 vault 会把全部标签一起作废）。
拦下时的人话提示 SHALL 点名**当前** vault 与它有未保存修改的标签数——MUST NOT 点名切换目标
（未保存修改属于当前 vault），也 MUST NOT 逐个列出脏标签（哪些标签脏由标签栏逐标签的 dirty
点承担）；出口口径（保存并切换 / 放弃修改并切换 / 取消）见 `vault-workspace` 的「vault 切换与
整窗上下文替换」，本 capability 不再自带一句无动作的提示。

#### Scenario: 未命名文档 dirty 时打开文件被拦下

- **WHEN** vault 已装载但未打开任何文件，在编辑器里键入内容，再单击文件树里的文件
- **THEN** 不切换；给出指向「撤销修改」的提示，编辑器内容与 masthead 都保持不变

#### Scenario: 有文件路径的标签 dirty 时不拦

- **WHEN** 打开 A 并编辑（A 变 dirty），再单击文件树里的 B
- **THEN** B 被打开，A 的标签保留且仍带 dirty 点；不出现任何「无法切换」的拦截提示

#### Scenario: 任一标签 dirty 即拦下切换 vault

- **WHEN** 有两个标签且其中**非前台**那个有未保存修改，触发切换 vault
- **THEN** 切换被拦下，提示点名当前 vault 与它有未保存修改的标签数（1 个）并给出三条出口；
  MUST NOT 因为脏标签不在前台而放行，MUST NOT 点名切换目标

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

一份文档被**装载**到标签时（单击 / 双击 / ⌘-点击文件树、文档内链接跟随、装载后按 vault 的标签列表
恢复标签），系统 SHALL 在当前 vault 的已存阅读位置里查该文档：命中时视口 SHALL 恢复到该位置——该位置
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

### Requirement: 打开语义

打开文件的落点 SHALL 按意图区分，且目标 pane SHALL 是**活跃 pane**：

- **单击 / 双击 / ⌘-点击文件树**：在活跃 pane 打开一个**标签**（MUST NOT 顶掉任何已打开的
  标签）——文件已经打开时执行「移动标签」（见 `pane-layout` 的「会话所有权」：标签带状态迁到
  活跃 pane 并激活），否则在活跃 pane 新开一个。三者是同一条落点。
- **文档内链接跟随**（⌘-点击文档内的链接 / ⌘⏎）：当前标签跟随换文档，MUST NOT 新开标签；
  目标文件已在某处打开时，移动其标签到活跃 pane 并激活（标签总数不变），当前标签保留。
- **另存为新文件 / 恢复崩溃备份**：就地替换**活跃 pane 的前台**标签（内容是「当前这份文档
  换个落点」）。
- **按 vault 恢复标签列表**：按 `vault-workspace` 持久化的 pane 布局恢复，逐 pane 逐个文件
  各开一个标签（见「按 vault 持久化 pane 布局」）。

文件树打开的落点 SHALL 复用「还没有文件的空文档」（冷启动示例文档 / 关掉最后一个标签后的
空文档）：它承载的是「还没有打开任何文件」这个状态本身、不是一个标签，就地落在它上面
MUST NOT 在会话列表里留下第二个不可见的空会话；它不干净时（有真实修改）MUST NOT 复用它
（那份内容没有落盘基准，就地替换等于丢弃草稿）。

**同一个文件已经打开时一律不产生第二个标签**——这条对全部意图、全部 pane 成立：同 pane 内
是切到既有标签，跨 pane 是移动标签。

文档内链接的 ⌘-点击语义 MUST NOT 因本能力改变（M144/M145 口径原样保留）；新的 ⌘-点击手势
只加在文件树上，且与单击同义。

#### Scenario: 单击树文件开一个标签

- **WHEN** 活跃 pane 的标签栏里已有 A，单击树里的 B
- **THEN** 活跃 pane 新开一个指向 B 的标签并激活它；A 的标签保留（位置不变，仍可切回）

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

### Requirement: 标签的关闭操作

标签栏 SHALL 为每个标签提供右键菜单（`role=menu` 浮层，读屏名 D148），四项按固定顺序：
**Reveal in File Tree / Close / Close Other Tabs / Close Tabs to the Right**。四项的
**上屏文案 SHALL 一律取英文原文、不随界面语言变**：三条关闭项是 M257 裁决（原中文措辞留在
`文案-Copy.md` 备查），定位项是 Alex 2026-10-01 的裁决「菜单内语言统一」（其需求原话
「在左栏中定位到此文件」留在中文列作沿革备查）——`zh` 界面下整条菜单因此都是英文
（MUST NOT 回落中文列）。读屏名 D148「标签操作」不随这两条裁决改语言。

**定位项 SHALL 排在首位**：标签菜单没有分隔线（本 change 不引入分隔线），顺序因此是唯一的分组表达
方式——非破坏性项在前、三条关闭路径仍是尾部连续的一块，与文件树条目菜单「非破坏性项在破坏性项之前」
（`tree-menu.ts` 的项集里 `reveal` 排在 `trash` 之前）同一方向。默认游标（首项）因此落在定位项上。

定位项 SHALL 作用于**指针落在的那一条标签**的文件路径：调文件树的「在树中定位路径」（见 `file-tree`
的同名 requirement），MUST NOT 改变前台标签、MUST NOT 打开或关闭任何标签。路径不在当前树模型里时
（文件已被外部删除 / vault 变过）SHALL 是空动作，MUST NOT 报错、也 MUST NOT 给提示。

菜单 SHALL 支持 ↑↓ 与 ⌃N⌃P 等价的游标移动、Enter 触发、Esc 与外部点击关闭；打开时 SHALL 持焦点
（游标落在首项），关闭时 SHALL 把焦点归还触发它的那一个标签；菜单非模态，其余按键照走原生路径。

三条关闭项的落点 SHALL 是**右键落在的那一个标签**：

- Close：该标签；
- Close Other Tabs：除该标签以外的全部标签（本版 MUST NOT 保留任何标签——不存在「固定标签」这一分类）；
- Close Tabs to the Right：标签栏里排在该标签**右侧**的全部标签（锚点由指针位置决定，MUST NOT 取当前前台标签）。

右键 MUST NOT 改变前台标签，也 MUST NOT 触发打开——右键只决定菜单作用于哪一条。

关闭路径命中**有未保存修改**的标签时 SHALL 复用既有的关标签确认（保存并关闭 / 放弃修改并关闭 / 取消，
与 ⌘W、× 按钮同一条确认流），MUST NOT 新造确认界面。批量路径（Close Other Tabs / Close Tabs to the
Right）SHALL 逐个提交关闭：同一时刻 MUST NOT 出现两条确认浮条；用户取消、放弃出口之外的关闭失败、或
直接点掉确认浮条时 SHALL 停手，尚未处理的标签 MUST NOT 被关闭（MUST NOT 因为「用户已经在批量动作里
点过一次」就静默丢弃它们的修改）。没有可关的标签时三项 SHALL 是空动作（不报错、不提示）。

#### Scenario: 右键标签弹出菜单且不改上下文

- **WHEN** 标签栏里有三个标签、前台是第二个，右键第一个标签
- **THEN** 菜单出现，含「Reveal in File Tree / Close / Close Other Tabs / Close Tabs to the Right」
  四项且顺序如上；前台仍是第二个标签（右键不改上下文），标签总数不变

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

#### Scenario: 脏标签先确认

- **WHEN** Close Tabs to the Right 的目标里有未保存修改的标签
- **THEN** 出现既有的三出口确认（保存并关闭 / 放弃修改并关闭 / 取消），其间不出现第二条确认浮条；选「保存并关闭」时先落盘再关，保存未闭环则该标签不关、批量动作停手

#### Scenario: 取消即停手

- **WHEN** 上一步的确认里选「取消」（或直接点掉浮条）
- **THEN** 该标签与它右侧尚未处理的标签都还在，MUST NOT 出现任何静默关闭

#### Scenario: 键盘打开与关闭

- **WHEN** 菜单打开后按 ↓ 或 ⌃N，再按 Enter
- **THEN** 游标移到第二项（Close）并执行它；按 Esc 时菜单收起、不执行任何动作，焦点回到产生菜单的那个标签
