# ui-design-system 增量规格

> 起草注记（非规格正文）：一条 MODIFIED，基线是 living spec
> [openspec/specs/ui-design-system/spec.md](../../../../specs/ui-design-system/spec.md) 的
> 「应用骨架布局」。改动面：dock 预留列从零像素接入 harness 面板，标题栏动作钮槽位填入面板 toggle。
> 面板自身的样式纪律（token 消费、不吃 elevation、eink 降级）在 harness spec「对话面板」条款。
> （M303 实现期校勘：living spec 的「正文列 664」已被 content-width-drag 批在实现里改为
> 760 起可拖拽，living spec 尚未跟进——本条 delta 不再钉死数值，改述「既有口径」，避免把
> 过期数字写回规格。）

## MODIFIED Requirements

### Requirement: 应用骨架布局

应用骨架 SHALL 为：标题栏 42px（全宽，左缘 traffic 灯区宽 236 与侧栏对齐，标签位于标题栏内，
**右端为产品标识块**——见「产品名与版本号常显」）/
主行（侧栏 236px + 正文栏 + **右栏 dock**）/ modeline 25px（全宽）。右栏 dock SHALL 承载 harness
对话面板：收起时零像素（行为与原预留位一致），展开时宽 `--layout-dock-w`（新 token），
与正文栏之间以 hairline 分隔（平铺面板，不吃 elevation）。标题栏右侧动作钮区填入面板 toggle 钮
（**排在产品标识块左侧**，尺寸吃既有 `--layout-tb-btn-w/h` token）。

旧 masthead SHALL 移除，其信息迁移：vault 名 → 侧栏头（切换器入口形态不变）；当前文件路径 →
modeline 左侧；当前位置指示 → modeline（toc 语义不变，只迁承载面）；行数 / 语法 / 编码 →
modeline 右侧（只读派生自既有编辑器状态，MUST NOT 为此引入全文档遍历或新状态源，ADR 0002 §6）。
macOS 标题栏 SHALL 为 overlay 形态（traffic 灯保持原生绘制，标题文字隐藏，栏区可拖拽）。

#### Scenario: 骨架几何与信息落位

- **WHEN** 打开任意 md 文件
- **THEN** 侧栏宽 236、标题栏高 42、modeline 高 25、正文列按既有阅读宽口径居中、dock 列在面板收起时零像素；
  modeline 左侧显示当前文件的 vault 相对路径，右侧显示语法 / 行数 / 编码；masthead 不存在

#### Scenario: dock 展开与收起

- **WHEN** 经标题栏 toggle 钮或命令唤起 / 收起 harness 面板
- **THEN** dock 列在 `0px` 与 `--layout-dock-w` 之间切换，正文列随之伸缩，切换不改变正文阅读宽居中的既有口径

#### Scenario: 空态的标题栏

- **WHEN** 没有打开任何文件
- **THEN** 标题栏为 traffic 灯区 + 动作钮区（harness toggle）+ 右端产品标识块（标签区隐藏），
  modeline 与侧栏骨架不变
