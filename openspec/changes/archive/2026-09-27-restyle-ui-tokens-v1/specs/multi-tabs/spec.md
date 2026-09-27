## MODIFIED Requirements

### Requirement: 标签栏的显示与形态

系统 SHALL 在**标题栏内**显示标签区（标签不再占据编辑器列顶部的独立行；标题栏几何见
ui-design-system「应用骨架布局」）。显示判据 SHALL 为「至少一个文件已打开」：
一个标签时也 SHALL 显示（它承载 dirty 点与位置上下文），没有任何带路径的会话时标签区
SHALL 隐藏；隐藏时标题栏只剩 traffic 灯区与动作钮。

每个标签 SHALL 显示：文件名（vault 相对路径的 basename，读屏名带上该标签自己的未保存状态）、
激活态高亮、逐标签的 dirty 点、逐标签的关闭按钮；预览（临时）标签的标题 SHALL 为斜体。
标签的悬停提示 SHALL 给出完整的 vault 相对路径（同名文件分散在不同目录时要能分辨）。
标签形态 SHALL 取 design tokens：高 29px、max-width 230px、圆角 7px；激活标签 SHALL 是全
界面唯一带投影的元素（`--shadow-pop`，表达「它连着正文」），eink 主题下投影退场、改 1.4px
实心黑描边（eink 降级规则 ⑦⑧）。

标签溢出时 SHALL 用横向滚动承载；本版 MUST NOT 做拖拽排序、MUST NOT 做 split view、
MUST NOT 做标签预览浮层。

#### Scenario: 单标签也显示

- **WHEN** vault 已装载且只打开了一个文件
- **THEN** 标签区可见于标题栏内，该标签为激活态（带投影或 eink 描边）

#### Scenario: 空态隐藏且不占行高

- **WHEN** 没有打开任何文件（vault 未装载或已装载但未打开文件）
- **THEN** 标签区隐藏，标题栏只剩 traffic 灯区与动作钮；编辑器正文区的高度不因标签有无而变化（标签位于标题栏内，标题栏高度恒定）

#### Scenario: dirty 与预览态在标签上可见

- **WHEN** 某标签有未保存修改
- **THEN** 该标签显示 dirty 点，其读屏名包含「（未保存）」；预览标签的标题为斜体
