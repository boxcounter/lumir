# keymap-commands 增量规格

## ADDED Requirements

### Requirement: 列表项缩进键（TAB / SHIFT+TAB）

编辑器 SHALL 提供列表项缩进命令 `editor.list-indent` 与 `editor.list-outdent`，默认绑定
`Tab` 与 `Shift-Tab`，scope `editor`，经统一键位表分发（命令 id 入 `COMMAND_IDS`，
绑定入 `KEY_BINDINGS` 并附来由；[keys] 配置可重绑 / 解绑，describe-bindings 面板渲染
生效表时自动收录）。编辑器内 TAB 的原生焦点遍历 SHALL 被接管（D1 裁决的知情代价）；
`Ctrl-Tab` / `Ctrl-Shift-Tab` 的标签切换绑定归一化后是与 `Tab` / `Shift-Tab` 不同的
token，两者 MUST 互不干扰。

光标（选区 head）归属的判定 SHALL 走语法树：取 head 所在行经 `resolveInner` 向上归最近的
`ListItem`（光标在子项行时归属子项）。命中列表项时，TAB SHALL 把该 `ListItem` 节点覆盖的
全部行（首行、续行、子列表行）整体平移一层：**一层的步长 SHALL 由语法树导出**——等于该层
标记的内容列宽（marker 宽度 + 其后空格数：`- ` → 2、`1. ` → 3、`10. ` → 4），MUST NOT 写成
固定 2 空格（固定 2 空格在有序列表上不构成嵌套，缩进会退化成不可见的空白 diff）；写入侧
MUST NOT 出现 tab 字符；引用块内的列表，插入 / 删除点 SHALL 在最内层 `>` 前缀之后。
SHIFT+TAB 对称地把该节点平移回**其祖先列表项所处的缩进层**（同样按语法树取，不是机械减
固定值）：每行 SHALL 移除不超过该层步长的前导空白（不足时移除该行全部前导空白；行首 tab
按一层读取宽容处理）。

写回 SHALL 遵守最小写回（ADR 0003 §3 铁律的编辑态推论）：一次平移的 changes MUST 只含
行首空白区间与**有序列表项序号的区间**——有序列表的源码字面编号 SHALL 按新归属重排为规范
序号（D2c 裁决）：**受影响的分组**= 被平移项的原分组（它离开的兄弟序列）与它平移后落入的
分组（缩进时新建的子分组），两组内的全部有序项 SHALL 改写为该组内 1 起递增的序号（原组中
位置前移的兄弟项因此一并改写）；不在上述两处分组内的有序项（含被平移项子树内部的子分组）
MUST NOT 改写。任务标记 `[ ]` / `[x]` 与列表标记字符 MUST NOT 改写，列表之外的任何行
MUST NOT 触及。一次 TAB / SHIFT+TAB SHALL 是单次 dispatch（带 `userEvent`），⌘Z 一次
撤销 SHALL 还原整次平移。

收口行为：列表项已在顶层（行首无空白可减）时 SHIFT+TAB SHALL 无操作；head 归属的列表项
**没有上一同级项**（它是所在列表的第一项）时 TAB SHALL 无操作——没有可嵌套的父项，写入
只会留下不可见的空白 diff；head 不在任何 `ListItem` 内（普通段落、标题、表格、空行、
围栏 / 缩进代码块内）时 TAB 与 SHIFT+TAB SHALL 无操作；非空选区 SHALL 按 head 所在项处理
（批量缩进不在本版）。「无操作」= 命令不 dispatch：文档逐字节不变、不进撤销栈、dirty 不变、
焦点不跳出编辑器——「命中即消费」沿用「统一键位分发表」的既有纪律，MUST NOT 把按键放回
原生路径。只读模式（非 md 文件）下两条命令 SHALL 一律不动文档。

#### Scenario: 列表项内 TAB 增加缩进

- **WHEN** 光标在 `- a`（顶层无序项，含续行或子项）的正文内按下 TAB
- **THEN** 该项节点覆盖的每一行行首各增加一层步长的空格（`- ` 的步长为 2，得 `  - a`；
  续行与子项同步平移），光标随编辑映射保持在同一项内，文档其余部分逐字节不变

#### Scenario: SHIFT+TAB 减少缩进并在顶层无操作

- **WHEN** 光标在 `  - a`（一层嵌套项）内按下 SHIFT+TAB，随后再按一次 SHIFT+TAB
- **THEN** 第一次后该项回到顶层（`- a`）；第二次该项已无任何行首空白，文档逐字节不变、
  撤销栈不增长、焦点留在编辑器内

#### Scenario: 有序列表缩进后按新归属重排源码编号

- **WHEN** 光标在 `1. x\n2. y` 的 `2. y` 项内按下 TAB
- **THEN** 源码变为 `1. x\n   1. y`——`2. y` 成为 `1. x` 的子项（步长 = `1. ` 的内容列宽 3），
  其源码编号按新归属重排为所在分组的规范序号 `1.`；再按一次 SHIFT+TAB 凸回顶层后源码恢复
  `1. x\n2. y`（编号重排回原分组的规范序号 `2.`）。任务标记 `[ ]` / `[x]` 与标记字符
  全程逐字节不动

#### Scenario: 有序列表缩进后原分组的兄弟项一并重排

- **WHEN** 光标在 `1. a\n2. b\n3. c\n4. d` 的 `3. c` 项内按下 TAB
- **THEN** 源码变为 `1. a\n2. b\n   1. c\n3. d`——被平移项在新分组内重排为 `1.`，原分组中
  位置前移的 `4. d` 一并重排为 `3. d`（两组各自按 1 起递增的规范序号收口）

#### Scenario: 没有上一同级项时 TAB 无操作

- **WHEN** 光标在 `- a\n- b` 的第一项 `- a` 内按下 TAB
- **THEN** 文档逐字节不变、不进撤销栈、dirty 不变、焦点不跳出编辑器（没有可嵌套的父项，
  写入只会留下不可见的空白 diff）

#### Scenario: 引用内列表的缩进落在引用标记之后

- **WHEN** 光标在 `> - a` 的列表项内按下 TAB
- **THEN** 源码变为 `>   - a`（一层步长的空格加在最内层 `>` 前缀之后），引用结构不变

#### Scenario: 非列表上下文无操作

- **WHEN** 光标在普通段落 / 标题 / 表格行 / 围栏代码块内按下 TAB 或 SHIFT+TAB
- **THEN** 文档逐字节不变、不进撤销栈、dirty 不变、焦点不跳出编辑器（不插入空白、
  不走原生焦点遍历）

#### Scenario: 撤销一次还原整次平移

- **WHEN** 对含续行与子项的列表项按下 TAB，随后按下 ⌘Z
- **THEN** 一次撤销即还原整次平移（所有行回到平移前），文档与平移前逐字节相同

#### Scenario: 只读模式下缩进键不动文档

- **WHEN** 以只读 code 模式打开含列表形态文本的非 md 文件，按下 TAB / SHIFT+TAB
- **THEN** 文档内容与之前逐字节相同（只读保证不因新增命令而放宽）

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

**焦点入口（本 change 后的实测状态，如实记录）**：编辑器内容区里的 `Tab` 已被列表缩进命令
`editor.list-indent` 接管（见本 change 的「列表项缩进键（TAB / SHIFT+TAB）」requirement，Alex 裁决
D1a）⇒ 从编辑器按 `Tab` 走原生焦点遍历这条**唯一**入口不再存在。容器本身仍是 `tabindex=0`、
键位分发与命中条件**均不变**，但**当前没有任何真机验通的路径**把焦点送进容器：场景 21 实测
`AXPress` 点容器节点（`role=region` → AXGroup）不改变焦点（`focused=AXTextArea`，证据
`test-results/acceptance/2026-09-26-m239-21/21-wrap-default/`），AX 里该节点既无 bbox 也无
`AXPress` 动作。因此本 requirement 与场景 MUST NOT 再以「用 `Tab` 移入容器」为前提；恢复焦点入口的
候选（新键 / 新命令，或确认容器的可点区域）记在 `docs/backlog.md`，由后续 change 处置。

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

- **WHEN** 默认折行口径下打开含超长代码行的 Markdown，**用鼠标点击**代码块横滚容器把焦点移入（编辑器内 `Tab` 已归列表缩进命令，不再是入口），依次按下 `→`、`End`、`Home`、`Escape`
- **THEN** 与表格容器完全同形的结果：横向滚动 120px、滚到最右、回到最左，`Escape` 把焦点交还编辑器
  内容区；全程文档内容逐字节不变。MUST NOT 出现「容器焦点了但方向键无反应」的第三种状态

#### Scenario: 文本中的方向键不受影响

- **WHEN** 焦点在编辑器文本中（不在块级横滚容器里）按下 `←`
- **THEN** 光标按原生路径左移一个字符（绑定条件不满足，事件未被消费）

#### Scenario: 光标落在块内文本时方向键仍归 caret

- **WHEN** 在 md 模式里把光标点进代码块的源码文本（焦点在编辑器内容区，容器未成为活动元素），按 `←`
- **THEN** 光标按原生路径移动，容器不横向滚动、事件未被消费；命令的命中条件 MUST NOT 把「光标在某
  容器内的文本里」误读成「该容器持有焦点」
