# tab-strip-context-menu 增量规格

## ADDED Requirements

### Requirement: 标签的关闭操作

标签栏 SHALL 为每个标签提供右键菜单（`role=menu` 浮层，读屏名 D148），三项按固定顺序：**Close / Close Other Tabs / Close Tabs to the Right**（D149–D151）。三项的**上屏文案取英文原文**（M257 裁决「上屏」；原中文措辞留在 `文案-Copy.md` 备查。读屏名 D148「标签操作」不随本裁决改语言）。菜单 SHALL 支持 ↑↓ 与 ⌃N⌃P 等价的游标移动、Enter 触发、Esc 与外部点击关闭；打开时 SHALL 持焦点（游标落在首项），关闭时 SHALL 把焦点归还触发它的那一个标签；菜单非模态，其余按键照走原生路径。

三项的落点 SHALL 是**右键落在的那一个标签**：

- Close：该标签；
- Close Other Tabs：除该标签以外的全部标签（本版 MUST NOT 保留任何标签——不存在「固定标签」这一分类）；
- Close Tabs to the Right：标签栏里排在该标签**右侧**的全部标签（锚点由指针位置决定，MUST NOT 取当前前台标签）。

右键 MUST NOT 改变前台标签，也 MUST NOT 触发打开——右键只决定菜单作用于哪一条。

关闭路径命中**有未保存修改**的标签时 SHALL 复用既有的关标签确认（保存并关闭 / 放弃修改并关闭 / 取消，与 ⌘W、× 按钮同一条确认流），MUST NOT 新造确认界面。批量路径（Close Other Tabs / Close Tabs to the Right）SHALL 逐个提交关闭：同一时刻 MUST NOT 出现两条确认浮条；用户取消、放弃出口之外的关闭失败、或直接点掉确认浮条时 SHALL 停手，尚未处理的标签 MUST NOT 被关闭（MUST NOT 因为「用户已经在批量动作里点过一次」就静默丢弃它们的修改）。没有可关的标签时三项 SHALL 是空动作（不报错、不提示）。

#### Scenario: 右键标签弹出菜单且不改上下文

- **WHEN** 标签栏里有三个标签、前台是第二个，右键第一个标签
- **THEN** 菜单出现，含「Close / Close Other Tabs / Close Tabs to the Right」三项且顺序如上；前台仍是第二个标签（右键不改上下文），标签总数不变

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
- **THEN** 游标移到第二项并执行 Close Other Tabs；按 Esc 时菜单收起、不执行任何动作，焦点回到产生菜单的那个标签
