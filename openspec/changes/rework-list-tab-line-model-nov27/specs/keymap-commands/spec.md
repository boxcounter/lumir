# keymap-commands 增量规格

## REMOVED Requirements

### Requirement: 列表项缩进键（TAB / SHIFT+TAB）

整条移除，并由下面的新 requirement「列表行缩进键（TAB / SHIFT+TAB）」承接：旧条把操作对象
定义为 `ListItem` 节点及其子树（TAB 平移整项、SHIFT+TAB 平移回祖先层、有序列表按新归属重排源码
编号），其全部 scenario（「列表项内 TAB 增加缩进」「SHIFT+TAB 减少缩进并在顶层无操作」「有序列表
缩进后按新归属重排源码编号」「有序列表缩进后原分组的兄弟项一并重排」「没有上一同级项时 TAB 无操作」
「非列表上下文无操作」「撤销一次还原整次平移」「只读模式下缩进键不动文档」）随模型一并废止；命令 id
（`editor.list-indent` / `editor.list-outdent`）与默认绑定保持不变。改名的通道是「整条移除 + 新增
承接条」——OpenSpec 的 MODIFIED 块不允许改 scenario 名（先例：change
`vault-and-session-removal` 的「失效 vault 的处置」）。

## MODIFIED Requirements

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

**焦点入口（M474 起）**：编辑器内容区里的 `Tab` 已被列表缩进命令 `editor.list-indent` 接管
（见本 spec 的「列表行缩进键（TAB / SHIFT+TAB）」requirement，Alex 裁决 D1a）⇒ 从编辑器按 `Tab`
走原生焦点遍历这条入口不再存在。M474 因此新增**有默认绑定**的编辑器命令 `editor.focus-block-scroll`
（`⌃⌥S`）：它把焦点交给**当前光标所在块的块级横滚容器**（表格容器与围栏 / 缩进代码块的横滚容器同
判据）；光标不在任何块内、或所在块没有容器（`editor.code_block_wrap = true` 的折行档）时 SHALL 静默
无操作——不报错、不动文档。命令 SHALL 由统一键位表分发（与五条滚动键同一条通路），MUST NOT 另加
`keydown` 路径。容器本身仍是 `tabindex=0`、键位分发与命中条件**均不变**；场景 21 实测 `AXPress`
点容器节点（`role=region` → AXGroup）不改变焦点（`focused=AXTextArea`，证据
`test-results/acceptance/2026-09-26-m239-21/21-wrap-default/`），AX 里该节点既无 bbox 也无
`AXPress` 动作，故点选不构成入口——焦点入口只由本键提供。

M795 的一次改判只落在 `←` / `→` 上（理由与证据见下面「文本中的方向键走硬化水平移动」scenario）：
这两条不再以 `when` 直接绑 widget 滚动命令，而是绑水平移动命令、由命令实现按同一判据
（`isWidgetKeyTarget`）分派容器滚动；`Escape` / `Home` / `End` 的绑定形态与会话一字不动。

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
  后焦点回到编辑器内容区。`←` / `→` 的绑定指向水平移动命令（M795），容器滚动是这条命令在
  「容器自身持焦」时的焦点分支——可观察行为与收编时（`editor.widget-scroll-left/right` 直接绑在
  `←` / `→` 上）逐值相同，MUST NOT 出现「容器焦点了但方向键无反应」的第三种状态

#### Scenario: 代码块容器与表格容器同判据同行为

- **WHEN** 默认折行口径下打开含超长代码行的 Markdown，把光标放进该代码块、按 `⌃⌥S`
  （`editor.focus-block-scroll`）把焦点交给代码块横滚容器，依次按下 `→`、`End`、`Home`、`Escape`
- **THEN** 与表格容器完全同形的结果：横向滚动 120px、滚到最右、回到最左，`Escape` 把焦点交还编辑器
  内容区；全程文档内容逐字节不变。MUST NOT 出现「容器焦点了但方向键无反应」的第三种状态

#### Scenario: 文本中的方向键走硬化水平移动

- **WHEN** 焦点在编辑器文本中（不在块级横滚容器里）按下 `←` / `→`
- **THEN** 光标由统一表的水平移动命令（与 `⌃B` / `⌃F` 同一条实现）移动一个**字素簇**，事件被本层消费、
  MUST NOT 留给原生 contenteditable 路径。可见行为与 `⌃B` / `⌃F` 逐条相同：隐藏的 inline 源码区间
  （列表 marker、续行缩进）是**一个原子步**，可见行首按 `→` 一次到正文起点、再一次前移一个字素簇，
  反向对称（合同的条款见 `docs/specs/editor-caret.md` 的 C6 与 `docs/specs/lists.md` 的 L5）。
  M795（Alex 2026-10-29 报告）改判：原「按原生路径左移一个字符（事件未被消费）」不再成立——原生路径
  在不可编辑 inline widget 两侧各有一个 `cm-widgetBuffer` 停止位，从行首进正文要按两次，且 `⌃F` 与 `→`
  的可见行为不一致；「事件是否走原生路径」不是需要保留的产品语义，可观察行为才是。

#### Scenario: 光标落在块内文本时方向键仍归 caret

- **WHEN** 在 md 模式里把光标点进代码块的源码文本（焦点在编辑器内容区，容器未成为活动元素），按 `←`
- **THEN** 光标由水平移动命令前移一个字素簇，容器不横向滚动；命令的命中条件 MUST NOT 把「光标在某
  容器内的文本里」误读成「该容器持有焦点」

## ADDED Requirements

### Requirement: 列表行缩进键（TAB / SHIFT+TAB）

编辑器 SHALL 提供列表缩进命令 `editor.list-indent` 与 `editor.list-outdent`，默认绑定
`Tab` 与 `Shift-Tab`，scope `editor`，经统一键位表分发（命令 id 入 `COMMAND_IDS`，
绑定入 `KEY_BINDINGS` 并附来由；[keys] 配置可重绑 / 解绑，describe-bindings 面板渲染
生效表时自动收录）。编辑器内 TAB 的原生焦点遍历 SHALL 被接管（D1 裁决的知情代价）；
`Ctrl-Tab` / `Ctrl-Shift-Tab` 的标签切换绑定归一化后是与 `Tab` / `Shift-Tab` 不同的
token，两者 MUST 互不干扰。

**操作对象 SHALL 是行，不是列表项或子树**。命令 SHALL 把 `state.selection` 的全部 range
展开为行集：空选区取 head 所在行；非空选区取与选区相交的每一行，其中起始位置恰等于选区
终点的行（选区尾落在行首）MUST NOT 计入；多 range 取并集、按文档序去重。命令 MUST NOT 以
`main.head` 所在列表项代替选区，也 MUST NOT 改写任何不在行集内的行。行集内每行 SHALL 独立
判定归宿：取行首结构前缀（引用标记之后）位置向上 `resolveInner`，先命中
`FencedCode` / `CodeBlock` / `Table` / `HTMLBlock` 的行 MUST NOT 写；未命中 `ListItem` 的行
（普通段落、标题、引用正文）MUST NOT 写。命中 `ListItem` 的行按其在该项中的位置取步长：

- **项首行**：TAB 的插入量 = 上一同级项的内容列（marker 列 + marker 宽 + 其后空格）− 本行
  marker 列；没有上一同级项或插入量 ≤ 0 时该行 MUST NOT 写。SHIFT+TAB 的删除量 = 本行 marker
  列 − 最近祖先项的 marker 列（无祖先项时目标列为 0），再按本行可删空白取小。
- **项内续行**：插入 / 删除量 = 所属项的内容列宽（marker 宽 + 其后空格），删除时同样按本行
  可删空白取小。

插入点 SHALL 在行首结构前缀之后（`>` 链与其后空白之后）；删除 MUST NOT 越过最内层 `>` 之后的
强制分隔空白，MUST NOT 触及 marker / 正文的第一个非空白字符。写入侧 MUST NOT 出现 tab 字符
（读侧一个 tab 记一个删除单位）；纯空白行 MUST NOT 写（不留下行尾空白）。

写回 SHALL 遵守最小写回（ADR 0003 §3 铁律的编辑态推论）：一次命令的 changes MUST 只含行首
空白区间；列表标记字符、任务标记与**有序列表源码编号 MUST NOT 改写**（本 change 切断 M239 的
D2c 分组重排：行模型下重排会改动未选中的行，违反「未触及行逐字节不动」）。有序列表的显示
编号由渲染层按组序计算、不读源码字面数字，源码编号缩进后与显示不一致是本模型接受并记录的
代价。一次 TAB / SHIFT+TAB SHALL 是单次 dispatch（带 `userEvent`），MUST NOT 显式重设选区
（由 change mapping 平移）；⌘Z 一次撤销 SHALL 还原整次编辑。

收口行为：行集内没有任何可写行（首项 TAB、顶层项 SHIFT+TAB、非列表行、代码块 / 表格 / HTML
块内、纯空白行）时命令 SHALL 不 dispatch——文档逐字节不变、不进撤销栈、dirty 不变、焦点不
跳出编辑器（「命中即消费」沿用「统一键位分发表」的既有纪律，MUST NOT 把按键放回原生路径）。
只读模式（非 md 文件）下两条命令 SHALL 一律不动文档；键位层与 IME 组合态的既有边界 MUST NOT
改变。

#### Scenario: 多行选区的 SHIFT+TAB 逐行凸排

- **WHEN** 在 `- a\n  - b\n    - c\n  - d` 上把光标移到第 2 行行首，向下扩选到第 4 行行尾
  后按 SHIFT+TAB
- **THEN** 三行各按归属项的结构步长删前导空白，得 `- a\n- b\n  - c\n- d`：`b` 与 `d` 各
  凸回顶层、`c` 凸一层仍留在 `b` 之下；未选中的第 1 行 `- a` 逐字节不变

#### Scenario: 反向选区得到同一行集与同一结果

- **WHEN** 在同一文档上把光标移到第 4 行行尾、向上扩选到第 2 行行首后按 SHIFT+TAB
- **THEN** 结果与正向扩选逐字节相同（行集由归一后的 `from` / `to` 导出，anchor 方向不影响）

#### Scenario: 选区尾落在行首不计入

- **WHEN** 从第 2 行行首选到第 4 行行首（终点恰在第 4 行第 1 列）后按 SHIFT+TAB
- **THEN** 只有第 2、3 行被处理，第 4 行逐字节不变

#### Scenario: TAB 只缩进选中行、不带子树

- **WHEN** 在 `- a\n- b\n  - b1` 的第 2 行（`- b`）内按 TAB（第 3 行 `  - b1` 未被选中）
- **THEN** 源码变为 `- a\n  - b\n  - b1`——只有 `b` 这一行增加了 2 空格；未选中的子项 `b1`
  逐字节不变（它因此变成 `b` 的同级项，这是「不带子树」的直接后果）

#### Scenario: 有序列表缩进不改写源码编号

- **WHEN** 光标在 `1. x\n2. y` 的第 2 行按 TAB
- **THEN** 源码变为 `1. x\n   2. y`（3 空格 = 上一同级项 `1. ` 的内容列），`2.` 保持原字面
  编号；MUST NOT 出现 `   1. y` 这类按新归属重排的改写，未选中的 `1. x` 逐字节不变

#### Scenario: 有序列表多行凸排不改写未选行编号

- **WHEN** 在 `1. a\n   1. x\n2. b` 上选中第 2 行（`   1. x`）按 SHIFT+TAB
- **THEN** 源码变为 `1. a\n1. x\n2. b`——`x` 凸回顶层，`a` 与未选中的 `b` 的源码编号逐字节
  不变（`b` 不因 `x` 离开而重排为 `2.` 之外的值）

#### Scenario: 首项 TAB 无操作，其余选中行照常

- **WHEN** 选中 `- a\n- b` 的两行后按 TAB
- **THEN** 第一项 `- a` 无嵌套目标而逐字节不变，`- b` 变为 `  - b`（并入 `a` 之下）；若只把
  光标放在 `- a` 一行上按 TAB，则文档逐字节不变、不进撤销栈

#### Scenario: 引用内列表的缩进落在引用标记之后

- **WHEN** 光标在 `> - a` 的列表行内按下 TAB，随后按 SHIFT+TAB
- **THEN** 先得 `>   - a`（一层步长的空格加在最内层 `>` 与其分隔空白之后），再回到 `> - a`；
  引用结构（`>` 与其后一个分隔空格）全程逐字节不动

#### Scenario: 混合列表 / 非列表选区只处理列表行

- **WHEN** 选区同时触及一段普通段落与一段列表行后按 TAB
- **THEN** 列表行按各自步长缩进，段落行逐字节不变；光标单独落在段落 / 标题 / 引用正文上时
  两条命令都不 dispatch（文档、撤销栈、dirty、焦点均不变）

#### Scenario: 代码块与纯空白行不写

- **WHEN** 选区同时触及列表行、一个围栏代码块内的行与一个纯空白行后按 TAB
- **THEN** 只有列表行增加空白；代码块行与纯空白行逐字节不变（空白行不产生行尾空格）

#### Scenario: 撤销一次还原整次编辑

- **WHEN** 对多行选区按下 TAB（或 SHIFT+TAB），随后按下 ⌘Z
- **THEN** 一次撤销即还原整次编辑（所有被触及行回到按键前），文档与按键前逐字节相同

#### Scenario: 只读模式下缩进键不动文档

- **WHEN** 以只读 code 模式打开含列表形态文本的非 md 文件，按下 TAB / SHIFT+TAB
- **THEN** 文档内容与之前逐字节相同（只读保证不因命令的模型调整而放宽）
