## ADDED Requirements

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
