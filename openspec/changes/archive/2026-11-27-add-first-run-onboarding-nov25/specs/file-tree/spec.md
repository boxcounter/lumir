# file-tree 增量规格

> 起草注记（非规格正文）：本 delta 只改「未打开 vault 空态」一条 requirement 的作用域与对应
> Scenario，并新增一个首启 Scenario。整条 requirement 的其余正文与既有 Scenario 逐字保留
> （MODIFIED 是整块替换）。

## MODIFIED Requirements

### Requirement: 未打开 vault 空态

非首启且无打开的 vault 时，文件树 pane SHALL 显示空态与"打开 vault"入口；触发入口 SHALL 调 `vault_open`。`last_vault` 恢复失败时 SHALL 在空态上展示对应人话提示。真正首次启动（启动快照 `last_vault === null`）MUST NOT 呈现本空态——由启动态的首启模式承接（见 `app-startup` 与 `first-run-onboarding`）；启动态首启模式期间文件树 pane 对辅助技术隐藏且不可交互。

#### Scenario: 空态打开入口

- **WHEN** 应用启动且无可用 `last_vault`，且不是真正首次启动（例如 `last_vault` 已失效）
- **THEN** 文件树 pane 显示空态与打开入口，点击入口弹出目录选择器

#### Scenario: 首启不呈现树空态

- **WHEN** 真正首次启动（启动快照 `last_vault === null`）且当前没有打开的 vault
- **THEN** 启动态首启模式在场，唯一「添加 vault」主操作可用；文件树 pane MUST NOT 显示 D5 / D6 空态，也 MUST NOT 出现在辅助技术树里
