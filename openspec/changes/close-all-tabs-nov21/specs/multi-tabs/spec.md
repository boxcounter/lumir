# multi-tabs 增量规格

> 起草注记（非规格正文）：本 change 只改「标签的关闭操作」一条——菜单追加第五项
> Close All Tabs，写清关闭范围（右键所在 pane 的标签条）、逐个确认与停手语义、以及全关完
> 之后的空态与焦点落点。MODIFIED 条基于当前 living spec
> （`openspec/specs/multi-tabs/spec.md`）的原文整块复制后改，未改动的段落逐字保留。

## MODIFIED Requirements

### Requirement: 标签的关闭操作

标签栏 SHALL 为每个标签提供右键菜单（`role=menu` 浮层，读屏名 D148），五项按固定顺序：
**Reveal in File Tree / Close / Close Other Tabs / Close Tabs to the Right / Close All Tabs**。
五项的**上屏文案 SHALL 一律取英文原文、不随界面语言变**：三条关闭项是 M257 裁决（原中文措辞留
在 `文案-Copy.md` 备查），定位项是 Alex 2026-10-01 的裁决「菜单内语言统一」（其需求原话
「在左栏中定位到此文件」留在中文列作沿革备查），关闭全部项（D943）沿用同一口径——`zh`
界面下整条菜单因此都是英文（MUST NOT 回落中文列）。读屏名 D148「标签操作」不随这些裁决改语言。

**定位项 SHALL 排在首位**：标签菜单没有分隔线（本 change 不引入分隔线），顺序因此是唯一的分组表达
方式——非破坏性项在前、四条关闭路径仍是尾部连续的一块，与文件树条目菜单「非破坏性项在破坏性项之前」
（`tree-menu.ts` 的项集里 `reveal` 排在 `trash` 之前）同一方向。默认游标（首项）因此落在定位项上。

定位项 SHALL 作用于**指针落在的那一条标签**的文件路径：调文件树的「在树中定位路径」（见 `file-tree`
的同名 requirement），MUST NOT 改变前台标签、MUST NOT 打开或关闭任何标签。路径不在当前树模型里时
（文件已被外部删除 / vault 变过）SHALL 是空动作，MUST NOT 报错、也 MUST NOT 给提示。

菜单 SHALL 支持 ↑↓ 与 ⌃N⌃P 等价的游标移动、Enter 触发、Esc 与外部点击关闭；打开时 SHALL 持焦点
（游标落在首项），关闭时 SHALL 把焦点归还触发它的那一个标签；菜单非模态，其余按键照走原生路径。

四条关闭项的落点 SHALL 是**右键落在的那一个标签**：

- Close：该标签；
- Close Other Tabs：除该标签以外的全部标签（本版 MUST NOT 保留任何标签——不存在「固定标签」这一分类）；
- Close Tabs to the Right：标签栏里排在该标签**右侧**的全部标签（锚点由指针位置决定，MUST NOT 取当前前台标签）；
- Close All Tabs：**右键所在 pane 的标签条上的全部标签**（含右键那一条；双 pane 时另一个 pane 的
  标签 MUST NOT 受影响）。

右键 MUST NOT 改变前台标签，也 MUST NOT 触发打开——右键只决定菜单作用于哪一条。

关闭路径命中**有未保存修改**的标签时 SHALL 复用既有的关标签确认（保存并关闭 / 放弃修改并关闭 / 取消，
与 ⌘W、× 按钮同一条确认流），MUST NOT 新造确认界面。批量路径（Close Other Tabs / Close Tabs to the
Right / Close All Tabs）SHALL 逐个提交关闭：同一时刻 MUST NOT 出现两条确认浮条；用户取消、放弃出口
之外的关闭失败、或直接点掉确认浮条时 SHALL 停手，尚未处理的标签 MUST NOT 被关闭（MUST NOT 因为
「用户已经在批量动作里点过一次」就静默丢弃它们的修改）；已经成功关闭的标签 MUST NOT 回滚。没有
可关的标签时四项 SHALL 是空动作（不报错、不提示）。

Close All Tabs 全部关完之后，该 pane MUST NOT 留下任何标签，前台 SHALL 回到未命名空文档
（modeline「无当前文件」、单 pane 时标签区隐藏）；焦点 SHALL 交给该 pane 的编辑器正文，
MUST NOT 留在 `body` 或已隐藏的菜单上。中途停手时焦点 MUST NOT 被抢走（留在用户刚答复的确认浮条上）。
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
- **THEN** 三条全部关闭（包括右键那一条），该 pane 回到空态：modeline 显示「无当前文件」、
  单 pane 时标签区隐藏、标题栏与正文区的位置不因关完标签而移动；焦点落在编辑器正文

#### Scenario: 关闭全部标签：多个 dirty 逐个确认，取消即停手

- **WHEN** 某 pane 有三个标签，第二条与第三条有未保存修改，右键第一条（干净）并选 Close All Tabs，
  随后在第一条脏标签的确认里选「取消」
- **THEN** 第一条（干净）已经关闭且不回滚；第二条与第三条都还在，脏内容不动；同一时刻只有一条确认浮条

#### Scenario: 关闭全部标签：保存与放弃之后继续到关完

- **WHEN** 上一步的现场里重新执行 Close All Tabs，对第一条脏标签选「放弃修改并关闭」，对下一条脏标签
  选「保存并关闭」
- **THEN** 放弃的标签不写盘、保存的标签落盘后才关闭；批量逐条继续到全部关闭；重新执行时不会被
  「用户已经答过一次」放行而静默丢弃后面的修改

#### Scenario: 关闭全部标签：只读外部会话与图片会话不弹确认

- **WHEN** 某 pane 有普通标签、vault 外只读标签与图片标签，执行 Close All Tabs
- **THEN** 三类标签都直接关闭，不出现「有未保存修改」的确认（它们恒无未保存内容）

#### Scenario: 关闭全部标签：作用域是右键所在的 pane

- **WHEN** 双 pane，左 pane 有标签 A、B，右 pane 有标签 C、D，右键右 pane 的 C 并选 Close All Tabs
- **THEN** 只关闭 C、D；A、B 原样保留；右 pane 回到空态，焦点落在右 pane 的编辑器正文

#### Scenario: 脏标签先确认

- **WHEN** Close Tabs to the Right 的目标里有未保存修改的标签
- **THEN** 出现既有的三出口确认（保存并关闭 / 放弃修改并关闭 / 取消），其间不出现第二条确认浮条；选「保存并关闭」时先落盘再关，保存未闭环则该标签不关、批量动作停手

#### Scenario: 取消即停手

- **WHEN** 上一步的确认里选「取消」（或直接点掉浮条）
- **THEN** 该标签与它右侧尚未处理的标签都还在，MUST NOT 出现任何静默关闭

#### Scenario: 键盘打开与关闭

- **WHEN** 菜单打开后按 ↓ 或 ⌃N，再按 Enter
- **THEN** 游标移到第二项（Close）并执行它；按 Esc 时菜单收起、不执行任何动作，焦点回到产生菜单的那个标签
