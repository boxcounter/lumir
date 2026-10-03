# multi-tabs 增量规格

> 起草注记（非规格正文）：五条 MODIFIED，把「全局唯一前台会话」的口径改为「per-pane +
> 活跃 pane」。每条的 scenario 名保留 living spec 原状（OpenSpec 的 MODIFIED 块不改
> scenario 名），新增断言写进既有 scenario 正文或新增 scenario。pane / 活跃 pane / 移动
> 标签的定义见 `pane-layout`。

## MODIFIED Requirements

### Requirement: 单 EditorView + 每标签留存 EditorState

系统 SHALL 为**每个文档 pane** 创建一个 `EditorView`（v1 上限二，见 `pane-layout` 的
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

#### Scenario: 切换标签时树高亮跟随

- **WHEN** 活跃 pane 里有标签 A 与 B 分别指向不同文件，从 A 切到 B
- **THEN** 文件树的高亮移到 B 对应的那一行，A 的行不再高亮

#### Scenario: 关掉最后一个标签回空态

- **WHEN** 依次关闭活跃 pane 的所有标签
- **THEN** 标签区隐藏（单 pane）、modeline 显示「无当前文件」、文件树无高亮；此后单击树里的
  文件开一个标签（开在活跃 pane）

#### Scenario: 活跃 pane 切换时高亮同帧换源

- **WHEN** 双 pane（A 前台 `a.md`、B 前台 `b.md`），焦点从 A 的 contentDOM 移到 B 的 contentDOM
- **THEN** 文件树高亮同帧从 `a.md` 的行移到 `b.md` 的行，modeline 同帧切到 `b.md`

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
- **THEN** 标签栏出现一个指向 A 的标签；此后关掉它回到空态、再单击树里的 B，标签栏仍只有一个
  指向 B 的标签（复用空文档，MUST NOT 让空会话堆积）

#### Scenario: 链接跟随不新开标签

- **WHEN** 在活跃 pane 的文档 A 里 ⌘-点击一个指向 B 的链接（B 未打开）
- **THEN** 当前标签就地变成 B，标签总数不变；随后 ⌘-点击一个指向已在另一 pane 打开的 C 的链接
- **THEN** C 的标签移动到活跃 pane 并激活（带状态），原标签保留，标签总数不变

#### Scenario: 标签标题字形与激活态一致

- **WHEN** 任意顺序在两个 pane 里打开若干文件
- **THEN** 所有标签标题的字体形态相同（只有各 pane 内前台那一条额外带激活态底色 / 投影），
  MUST NOT 出现斜体标题
