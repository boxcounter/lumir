# ui-design-system 增量规格

> 起草注记（非规格正文）：本 delta 一条 MODIFIED，基线是 living spec
> [openspec/specs/ui-design-system/spec.md](../../../../specs/ui-design-system/spec.md)。改动面：骨架的
> 侧栏从「写死 236px」改为「默认 236px + 可拖拽调宽 + 可经 ⌘B 收起/展开」；标题栏 traffic 区宽存活读
> 同一 token，收起时回到最小宽。其余几何（标题栏 42 / modeline 25 / 内容区 pane 容器）逐字不变。
> 宽度区间、收起态持久化与恢复通道等取值见 [design.md](../../design.md) §4 的 D1–D6。

## MODIFIED Requirements

### Requirement: 应用骨架布局

应用骨架 SHALL 为：标题栏 42px（全宽，左缘 traffic 灯区宽**恒等于侧栏当前宽度**并与侧栏对齐，**产品标识块位于 traffic 灯区内、系统按钮旁**——见「产品名与版本号常显」；标签位于标题栏内——单 pane 常态；双 pane 时标签区左右分区为两槽，左槽 = 左 pane 标签、右槽 = 右 pane 标签，槽宽比例随分隔条，见 `multi-tabs` 的「标签栏的显示与形态」）/ 主行（侧栏 + **内容区（pane 容器）**）/ modeline 25px（全宽）。**右栏 dock 列随本 change 移除**（harness 归位 pane，`--layout-dock-w` 与 `.dock-open` 机制一并清扫）。内容区 SHALL 是 pane 容器（v1 上限两个横向 pane，见 `pane-layout` 的「pane 容器模型」与「harness pane」）：未分栏时它承载单个文档 pane，**几何与 pane 化之前的正文栏逐像素一致**；分栏时两个 pane 以分隔条相隔，分隔条是容器级 hairline 元素（`--border` 档，平铺表面不吃 elevation），其位置可拖拽调整（拖拽重排实时生效，松手后位置经会话持久化通道落盘，per-vault，见 `vault-workspace` 的「按 vault 持久化 pane 布局」）。

**侧栏宽度与收起**（change add-sidebar-resize-hide-and-root-create）：侧栏宽度 SHALL 是**可调**的——出厂默认 236px，用户 SHALL 能经侧栏与内容区之间的分隔条拖拽调整，合法区间 `[180, 480]`，窗口过窄时 SHALL 按窗口宽度的四成再钳一次（显示口径，不影响落盘值）。拖拽 SHALL 实时重排（rAF 合并，拖拽期 MUST NOT 产生 IPC），松手且值有变化时 SHALL 经既有合并写通道持久化（配置键 `ui.sidebar_width`），写失败 SHALL 只提示、MUST NOT 回滚运行期宽度。侧栏右缘与标题栏 traffic 区 SHALL 继续像素对齐（两者读同一宽度真源，MUST NOT 各存一份宽度）。

侧栏 SHALL 可收起与展开，且**同一命令往返**（`view.toggle-sidebar`，默认 ⌘B，见 `keymap-commands`）：收起时侧栏列宽 SHALL 归 0、侧栏内容不显示（树模型与展开态 MUST NOT 被销毁或重建）、标题栏 traffic 区 SHALL 回到「原生交通灯 + 产品标识块」的最小宽（MUST NOT 留出 236px 空位）；展开时 SHALL 回到收起前的宽度。收起 SHALL 先收掉左栏内的在手交互（右键菜单关闭、进行中的行内重命名 / 新建按取消处理），焦点在左栏内时 SHALL 先把焦点交还活跃文档 pane——MUST NOT 留下焦点在不可见元素上的状态。收起状态 MUST NOT 跨启动持久化（每次启动显示侧栏）。

**标题栏 harness 段**：harness 在场时，标题栏的标签区之后 SHALL 出现 harness 段（会话名下拉 + 新建会话钮，行为见 `harness` 的「会话边界」），与标签段同构；段宽 SHALL 与 pane 实际宽度像素对齐（实现机制：分栏态标题栏弹性区与内容区容器同宽——padding 归零 / toggle 隐藏 / spinner 绝对定位——标签槽与 harness 段挂同一份 splitRatio 分宽；这是几何构造的对齐，MUST NOT 用与 pane 宽度脱节的固定比例近似）。标题栏右端动作钮区保留 harness toggle 钮（尺寸吃既有 `--layout-tb-btn-w/h` token，与 `harness.toggle` 命令同一路径）。双 pane（含 harness pane 在场）时标题栏右簇 SHALL 退让——harness 开关钮隐藏（`⌘⇧A` 照走）；产品标识块已在最左，不再是退让对象；单 pane 且无 harness 时右簇全量在场、逐像素不变（chrome 只在空间紧张时退让）。

旧 masthead SHALL 移除，其信息迁移：vault 名 → 侧栏头（切换器入口形态不变）；当前文件路径 → modeline 左侧；当前位置指示 → modeline（toc 语义不变，只迁承载面）；行数 / 语法 / 编码 → modeline 右侧（只读派生自**活跃 pane 的前台**编辑器状态，MUST NOT 为此引入全文档遍历或新状态源，ADR 0002 §6）。macOS 标题栏 SHALL 为 overlay 形态（traffic 灯保持原生绘制，标题文字隐藏，栏区可拖拽）。

#### Scenario: 骨架几何与信息落位

- **WHEN** 打开任意 md 文件（单 pane 常态、无 harness）
- **THEN** 侧栏宽 236、标题栏高 42、modeline 高 25、正文列按既有阅读宽口径居中、**无 dock 列**；内容区、标签区、modeline 与 pane 化之前**逐像素一致**；modeline 左侧显示当前文件的 vault 相对路径，右侧显示语法 / 行数 / 编码

#### Scenario: 分栏后的容器几何

- **WHEN** 执行 `pane.split`（双 pane）
- **THEN** 内容区内出现两个横向 pane，各占容器约一半（默认 0.5），以一条 hairline 分隔条相隔；侧栏 236px、标题栏 42px、modeline 25px 均不受影响；标题栏标签区同步左右分区为两槽（槽宽比例与分隔条一致），右簇退让（harness 开关钮隐藏），顶部恒为一条横带；拖拽分隔条至 0.7 后两 pane 宽度与两槽宽度按新比例重排（实时），松手后位置被持久化

#### Scenario: harness 的打开与收起

- **WHEN** 经标题栏 toggle 钮或 `harness.toggle` 命令唤起 / 收起 harness 面板
- **THEN** harness 在旁侧 pane 打开（无第二 pane 时自动分栏，默认宽度比 harness:文档 pane = **1:1**，canonical 定义见 `pane-layout` 的「harness pane」）或收起回到单 pane；切换不改变正文阅读宽居中的既有口径；harness 在场时标题栏出现 harness 段且段缘与 pane 分隔条对齐

#### Scenario: dock 展开与收起

- **WHEN** 检查应用骨架（本 change 落地后）
- **THEN** 右栏 dock 列不复存在——`--layout-dock-w` 与 `.dock-open` 机制已随本 change 移除；原 dock 承载的 harness 面板改在旁侧 pane 打开（见「harness 的打开与收起」）

#### Scenario: 空态的标题栏

- **WHEN** 没有任何文件打开（单 pane、空标签列表）
- **THEN** 标题栏为 traffic 灯区（含产品标识块）+ 右端动作钮区（harness toggle）（标签区隐藏），modeline 与侧栏骨架不变；pane 容器呈空态（无分隔条、无第二 pane）


#### Scenario: 拖拽分隔条调整侧栏宽度

- **WHEN** 用户在侧栏与内容区之间的分隔条上按下并向右拖动 80px
- **THEN** 侧栏实时变宽（拖拽过程逐帧跟随），标题栏 traffic 区宽度同步跟随；松手后新宽度经配置写通道
  落盘一次；正文区左缘随之右移，pane 容器内部几何（标签条、正文栏）按既有口径重排

#### Scenario: 宽度在重启后保持

- **WHEN** 把侧栏拖到 320px 并落盘成功，随后退出并重新启动应用
- **THEN** 启动后的侧栏宽度为 320px（配置值即启动真源）；越界或类型不符的配置值按 `ui.content_width`
  同口径回落默认 236 并给配置 warning

#### Scenario: ⌘B 收起与展开侧栏

- **WHEN** 用户按 ⌘B（焦点可在编辑器、文件树或 harness composer 内）
- **THEN** 侧栏收起：侧栏列宽为 0、侧栏内容不可见、标题栏 traffic 区回到「交通灯 + 产品标识块」的最小宽、
  正文左缘贴窗口左缘；再按一次 ⌘B，侧栏展开并回到收起前的宽度与展开态；两次切换都不重建树模型

#### Scenario: 收起时收掉在手交互并留住焦点

- **WHEN** 用户在文件树里正在行内重命名某条目（或右键菜单开着）时按 ⌘B
- **THEN** 该次重命名按取消处理（磁盘与树都不出现半截改动）、菜单关闭；焦点交还活跃文档 pane 的编辑器，
  随即键入的字符落在文档里而不是不可见元素上
