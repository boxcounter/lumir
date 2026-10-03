# ui-design-system 增量规格

> 起草注记（非规格正文）：一条 MODIFIED（「应用骨架布局」），改动面 = 正文栏泛化为 pane
> 容器（ADR 0008 Decision 1 的 Phase 1 部分）。scenario 名保留 living spec 原状；dock 列
> Phase 1 不动（harness 归位 pane 是 Phase 2）。pane 容器的行为定义见 `pane-layout`。

## MODIFIED Requirements

### Requirement: 应用骨架布局

应用骨架 SHALL 为：标题栏 42px（全宽，左缘 traffic 灯区宽 236 与侧栏对齐，标签位于标题栏内——
单 pane 常态；双 pane 时标签条随各 pane 位于 pane 顶部，见 `multi-tabs` 的「标签栏的显示与
形态」，**右端为产品标识块**——见「产品名与版本号常显」）/ 主行（侧栏 236px + **内容区
（pane 容器）** + **右栏 dock**）/ modeline 25px（全宽）。内容区 SHALL 是 pane 容器
（v1 上限两个横向 pane，见 `pane-layout` 的「pane 容器模型」）：未分栏时它承载单个文档 pane，
**几何与 pane 化之前的正文栏逐像素一致**；分栏时两个 pane 以分隔条相隔，分隔条是容器级
hairline 元素（`--border` 档，平铺表面不吃 elevation），其位置可拖拽调整（拖拽重排实时生效，
松手后位置经会话持久化通道落盘，per-vault，见 `vault-workspace` 的「按 vault 持久化 pane
布局」）。右栏 dock SHALL 承载 harness 对话面板（Phase 1 不变：收起时零像素，展开时宽
`--layout-dock-w`，与内容区之间以 hairline 分隔）；Phase 2 harness 归位 pane 后 dock 列移除，
届时本条随 Phase 2 change 修订。标题栏右侧动作钮区填入面板 toggle 钮（**排在产品标识块左侧**，
尺寸吃既有 `--layout-tb-btn-w/h` token）。

旧 masthead SHALL 移除，其信息迁移：vault 名 → 侧栏头（切换器入口形态不变）；当前文件路径 →
modeline 左侧；当前位置指示 → modeline（toc 语义不变，只迁承载面）；行数 / 语法 / 编码 →
modeline 右侧（只读派生自**活跃 pane 的前台**编辑器状态，MUST NOT 为此引入全文档遍历或新状态
源，ADR 0002 §6）。macOS 标题栏 SHALL 为 overlay 形态（traffic 灯保持原生绘制，标题文字隐藏，
栏区可拖拽）。

#### Scenario: 骨架几何与信息落位

- **WHEN** 打开任意 md 文件（单 pane 常态）
- **THEN** 侧栏宽 236、标题栏高 42、modeline 高 25、正文列按既有阅读宽口径居中、dock 列在面板
  收起时零像素；内容区、标签区、modeline 与 pane 化之前**逐像素一致**；modeline 左侧显示当前
  文件的 vault 相对路径，右侧显示语法 / 行数 / 编码

#### Scenario: 分栏后的容器几何

- **WHEN** 执行 `pane.split`（双 pane）
- **THEN** 内容区内出现两个横向 pane，各占容器约一半（默认 0.5），以一条 hairline 分隔条相隔；
  侧栏 236px、标题栏 42px、modeline 25px、dock 列均不受影响；拖拽分隔条至 0.7 后两 pane 宽度
  按新比例重排（实时），松手后位置被持久化

#### Scenario: dock 展开与收起

- **WHEN** 经标题栏 toggle 钮或命令唤起 / 收起 harness 面板
- **THEN** dock 列在 `0px` 与 `--layout-dock-w` 之间切换，内容区（pane 容器）随之伸缩，切换
  不改变正文阅读宽居中的既有口径；分栏态下 dock 展开时两个 pane 同步收窄

#### Scenario: 空态的标题栏

- **WHEN** 没有任何文件打开（单 pane、空标签列表）
- **THEN** 标题栏为 traffic 灯区 + 动作钮区（harness toggle）+ 右端产品标识块（标签区隐藏），
  modeline 与侧栏骨架不变；pane 容器呈空态（无分隔条、无 pane 内标签条）
