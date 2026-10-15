# ui-design-system Specification Delta

> 起草注记（非规格正文）：本 requirement 里「默认宽度比 harness:文档 pane = 1:2」是
> `pane-layout` 的「harness pane」之处定义的默认值的复述，随本 change（Alex 2026-10-10 裁决）
> 一并改值并指向 canonical 定义处；其余正文与场景逐字不动（骨架几何、dock 移除、退让口径均不变）。

## MODIFIED Requirements

### Requirement: 应用骨架布局

应用骨架 SHALL 为：标题栏 42px（全宽，左缘 traffic 灯区宽 236 与侧栏对齐，**产品标识块位于 traffic 灯区内、系统按钮旁**——见「产品名与版本号常显」；标签位于标题栏内——单 pane 常态；双 pane 时标签区左右分区为两槽，左槽 = 左 pane 标签、右槽 = 右 pane 标签，槽宽比例随分隔条，见 `multi-tabs` 的「标签栏的显示与形态」）/ 主行（侧栏 236px + **内容区（pane 容器）**）/ modeline 25px（全宽）。**右栏 dock 列随本 change 移除**（harness 归位 pane，`--layout-dock-w` 与 `.dock-open` 机制一并清扫）。内容区 SHALL 是 pane 容器（v1 上限两个横向 pane，见 `pane-layout` 的「pane 容器模型」与「harness pane」）：未分栏时它承载单个文档 pane，**几何与 pane 化之前的正文栏逐像素一致**；分栏时两个 pane 以分隔条相隔，分隔条是容器级 hairline 元素（`--border` 档，平铺表面不吃 elevation），其位置可拖拽调整（拖拽重排实时生效，松手后位置经会话持久化通道落盘，per-vault，见 `vault-workspace` 的「按 vault 持久化 pane 布局」）。

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
