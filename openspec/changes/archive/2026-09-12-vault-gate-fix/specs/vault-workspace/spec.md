## MODIFIED Requirements

### Requirement: vault 注册表与显式重映射

系统 SHALL 为每个打开过的 vault 维护稳定 id，`~/.config/lumir/workspaces/` 注册表承载 id 到当前 vault 路径的映射。打开 vault 时若目标路径已注册，系统 SHALL 直接打开，MUST NOT 因注册表中存在路径已失效的其他 vault 而拦停或提示 remap。仅当目标路径未注册且注册表中存在路径已失效的其他 vault 时，系统 SHALL 将其作为疑似移动候选向用户提示；重映射 MUST 经显式 `vault_remap` 完成，MUST NOT 静默断联或静默改绑。候选清单 SHALL 按稳定 id 排序（原 thread 最近活跃度排序随 Thread 特性删除而移除）。注册表项的写入 SHALL 采用临时文件 + rename 原子替换。

#### Scenario: 已注册路径直接打开

- **WHEN** 注册表中存在路径已失效的 vault，而本次打开的目标路径已在注册表中
- **THEN** 系统直接打开目标 vault，不提示 remap 候选

#### Scenario: 疑似移动提示

- **WHEN** 打开 vault 的目标路径未注册，且注册表中存在路径已失效的其他 vault
- **THEN** 系统提示发现可能已移动的 vault，请用户确认重映射

#### Scenario: 显式重映射

- **WHEN** 用户确认某失效注册项对应当前打开的 vault
- **THEN** `vault_remap` 将该稳定 id 绑定到新路径并更新 `last_vault`，注册表不再静默断联

### Requirement: last_vault 记忆与启动恢复

vault 实际打开成功后系统 SHALL 将 vault 绝对路径写入配置的 `last_vault` 字段（config.rs 既有字段，add-vault-workspace 起消费）；remap 候选短路返回（vault 未实际打开）时 MUST NOT 写入 `last_vault`。配置写入 SHALL 遵守 ADR 0002 §5 的配置即数据纪律（逐字段校验、非法值人话 warning）。启动时若 `last_vault` 存在且仍是合法目录，系统 SHALL 自动恢复打开该 vault；若路径不存在或不是目录，系统 SHALL 进入未打开状态并给出人话提示，MUST NOT 崩溃或静默卡死。

#### Scenario: 启动自动恢复

- **WHEN** 上次会话以 vault 打开状态退出，且该目录仍存在
- **THEN** 本次启动自动打开该 vault，文件树直接可用

#### Scenario: last_vault 失效

- **WHEN** `last_vault` 指向的目录已被删除或移动
- **THEN** 进入未打开空态，提示该路径不可用，用户可重新选择目录

#### Scenario: remap 候选短路不写 last_vault

- **WHEN** 打开路径触发 remap 候选短路返回（vault 未实际打开）
- **THEN** 配置的 `last_vault` 保持原值，不记忆该次未完成的打开
