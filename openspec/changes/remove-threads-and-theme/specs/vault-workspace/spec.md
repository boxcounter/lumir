## ADDED Requirements

### Requirement: vault 注册表与显式重映射

系统 SHALL 为每个打开过的 vault 维护稳定 id，`~/.config/lumir/workspaces/` 注册表承载 id 到当前 vault 路径的映射。打开 vault 时若注册表中存在路径已失效的其他 vault，系统 SHALL 将其作为疑似移动候选向用户提示；重映射 MUST 经显式 `vault_remap` 完成，MUST NOT 静默断联或静默改绑。候选清单 SHALL 按稳定 id 排序（原 thread 最近活跃度排序随 Thread 特性删除而移除）。

#### Scenario: 疑似移动提示

- **WHEN** 打开 vault 时注册表中存在路径已失效的其他 vault
- **THEN** 系统提示发现可能已移动的 vault，请用户确认重映射

#### Scenario: 显式重映射

- **WHEN** 用户确认某失效注册项对应当前打开的 vault
- **THEN** `vault_remap` 将该稳定 id 绑定到新路径并更新 `last_vault`，注册表不再静默断联
