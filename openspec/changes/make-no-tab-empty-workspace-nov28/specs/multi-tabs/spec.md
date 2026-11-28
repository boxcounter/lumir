# multi-tabs 增量规格

> 起草注记（非规格正文）：本 change 后无 Tab 是空工作区，没有可编辑的无路径文档。旧的
> 「未命名文档的 dirty 守卫」整条移除（改名 / 合并通道 = REMOVED + ADDED），由下面的
> 「无 Tab 空工作区与 dirty 判定」承接；「标签的关闭操作」只改交还焦点的落点。有路径 dirty 的
> 保护与 vault 切换守卫逐字保留。机制见 [design.md](../../design.md)。

## REMOVED Requirements

### Requirement: 未命名文档的 dirty 守卫

整条移除，由下面的「无 Tab 空工作区与 dirty 判定」承接：本 change 后无路径会话结构性只读，
既不可能 dirty，也没有保存落点；「未命名文档 dirty 时打开文件被拦下」的场景与 D230 的无路径分支
一起失去对象。有路径 dirty 不拦、vault 切换取全体并集两条语义原样保留。

## ADDED Requirements

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

## MODIFIED Requirements

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
焦点 SHALL 交给空工作区的主操作「打开笔记…」；前台是图片会话（编辑器是哨兵只读面）⇒ 焦点
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
  单 pane 时标签区隐藏、标题栏与正文区的位置不因关完标签而移动；焦点落在「打开笔记…」，MUST NOT
  落在正文或 `body`

#### Scenario: 关闭全部标签：多个 dirty 逐个确认，取消即停手

- **WHEN** 某 pane 有三个标签，第二条与第三条有未保存修改，右键第一条（干净）并选 Close All Tabs，
  随后在第一条脏标签的确认里选「取消」
- **THEN** 第一条（干净）已经关闭且不回滚；第二条与第三条都还在，脏内容不动；同一时刻只有一条确认浮条；
  焦点回到当前前台（有带路径标签时是正文，全关完后是空工作区主操作），MUST NOT 留在 `body`，
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
- **THEN** 只关闭 C、D；A、B 原样保留；右 pane 回到空工作区，焦点落在右 pane 的「打开笔记…」
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
