# vault-workspace 增量规格

> 起草注记（非规格正文）：本 delta 只改「vault 切换器入口与列表浮层」一条 requirement 的
> D5 / D6 作用域与一个 Scenario，并新增一个首启 Scenario。整条 requirement 的其余正文与全部
> 既有 Scenario 逐字保留（MODIFIED 是整块替换，不能只写改动段）。

## MODIFIED Requirements

### Requirement: vault 切换器入口与列表浮层

已装载 vault 时，左栏文件树头部 SHALL 提供常驻的 vault 切换器入口；只有一个 vault 时入口 SHALL 同样出现（隐藏它会让「再加一个 vault」在界面上无处可去）。入口形态 SHALL 为方案 A——vault 名称本身即入口、带 caret 提示，现状的「切换」文字按钮退场（备选 B 的形态与翻转落点见 design §7）。未装载 vault 时（含启动恢复进行中）MUST NOT 出现列表入口。非首启的空态沿用既有 D5 / D6 文案与入口；真正首次启动由启动态的首启模式承接（见 `app-startup` 的「启动态的上屏与撤下」与 `first-run-onboarding` 的「首启判定与作用域」），MUST NOT 呈现 D5 / D6 树空态。恢复中态的「打开 vault」入口保持可用（口径见 `startup-restore-off-main-thread` 的「启动恢复的时序与可见性」）。浮层 SHALL 与大纲浮层同一手法：绝对定位、不占任何常驻行高、切换完成即消失；SHALL 以列表语义暴露当前项；宽度允许溢出左栏（与大纲浮层同口径）。系统 SHALL 提供「打开 vault 切换器」命令，其默认键位 SHALL 为 `Cmd-o`；浮层内 ↑↓ 选择、Enter 切换、Esc 关闭（与大纲浮层 D86 同口径）。浮层的打开与关闭 MUST NOT 改变右栏正文的阅读位置（编辑器滚动位置）：滚动位置属于读者而不属于焦点，收起浮层并把焦点交还编辑器时 MUST NOT 让视口移动——尤其是光标停在别处时（用户顺着读、光标留在原处是常态）。

#### Scenario: 单 vault 时入口仍在

- **WHEN** 注册表中只有一个 vault 且它是当前 vault
- **THEN** 切换器入口仍出现，列表里有一项 + 一条「新增 vault…」

#### Scenario: 未装载时无列表入口

- **WHEN** 尚未装载任何 vault（非首启的空态 / 启动恢复进行中）
- **THEN** 文件树区呈空态：说明文案 + 「打开 vault」入口，MUST NOT 出现 vault 列表入口

#### Scenario: 首启由启动态首启模式承接

- **WHEN** 真正首次启动（启动快照 `last_vault === null`）且当前没有打开的 vault
- **THEN** 启动态首启模式在场，唯一「添加 vault」主操作可用；MUST NOT 呈现文件树 D5 / D6 空态，MUST NOT 出现 vault 列表入口

#### Scenario: 浮层不占常驻空间

- **WHEN** 用户打开切换器浮层，随后切换或按 Esc 关闭
- **THEN** 关闭后左栏布局与浮层打开前逐像素一致（浮层不改变任何常驻元素的位置）

#### Scenario: 键位打开并键盘操作

- **WHEN** 焦点在编辑器或文件树里，按 `Cmd-o`
- **THEN** 切换器浮层打开；↑↓ 移动选中项、Enter 切换、Esc 关闭，不产生其它副作用

#### Scenario: 打开与关闭浮层不改阅读位置

- **WHEN** 用户顺着长文档读（用 ⌃V / 触控板滚视口，光标仍停在原处），打开切换器浮层后再按 Esc 收起
- **THEN** 浮层收起、焦点回到编辑器，正文仍停在原来的阅读位置，MUST NOT 跳回光标所在的篇首
