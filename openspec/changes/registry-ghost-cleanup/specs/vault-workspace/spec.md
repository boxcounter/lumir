## MODIFIED Requirements

### Requirement: vault 注册表与显式重映射

系统 SHALL 为每个打开过的 vault 维护稳定 id，`~/.config/lumir/workspaces/` 注册表承载 id 到当前 vault 路径的映射。打开 vault 时若目标路径已注册，系统 SHALL 直接打开，MUST NOT 因注册表中存在路径已失效的其他 vault 而拦停或提示 remap。仅当目标路径未注册且注册表中存在未归档的失效注册项时，系统 SHALL 将其作为疑似移动候选向用户提示；重映射 MUST 经显式 `vault_remap` 完成，MUST NOT 静默断联或静默改绑。候选清单 SHALL 按稳定 id 排序（原 thread 最近活跃度排序随 Thread 特性删除而移除）。注册表项的写入 SHALL 采用临时文件 + rename 原子替换。

失效注册项（幽灵项）SHALL 由枚举/打开链路惰性治理，注册项 MUST NOT 被硬删除。系统 SHALL 在首次观测到某注册项路径失效时记录该时刻；路径失效持续超过宽限期（初始值 24 小时，可随实测调整）后 SHALL 打上归档标记。宽限期内的失效项 SHALL 仍作为 remap 候选（首次观测必出候选，宽限期只决定候选继续出现的时长，保留「移动 vault 后重新打开」的恢复入口）；已归档项 MUST NOT 出现在 remap 候选清单中。已归档项的路径重新出现（外置卷重新挂载、目录被还原）时，系统 SHALL 在同一注册项上清除治理标记并保留其稳定 id，MUST NOT 新建注册项；显式重映射或重新注册同一 id SHALL 同样复位治理标记。治理 SHALL 幂等：状态收敛后重复执行不产生写操作。

#### Scenario: 已注册路径直接打开

- **WHEN** 注册表中存在路径已失效的 vault，而本次打开的目标路径已在注册表中
- **THEN** 系统直接打开目标 vault，不提示 remap 候选

#### Scenario: 疑似移动提示

- **WHEN** 打开 vault 的目标路径未注册，且注册表中存在失效未归档的其他 vault
- **THEN** 系统提示发现可能已移动的 vault，请用户确认重映射

#### Scenario: 显式重映射

- **WHEN** 用户确认某失效注册项对应当前打开的 vault
- **THEN** `vault_remap` 将该稳定 id 绑定到新路径并更新 `last_vault`，注册表不再静默断联

#### Scenario: 宽限期内的失效项仍是移动候选

- **WHEN** 某注册项路径刚被观测到失效，且失效时长未超过宽限期
- **THEN** 该注册项仍作为 remap 候选出现，并记录本次失效时刻

#### Scenario: 幽灵项超宽限期后归档

- **WHEN** 某注册项路径失效持续超过宽限期，用户再次打开未注册目录
- **THEN** 该注册项被标记归档（注册项文件保留），不再作为 remap 候选出现，remap 门不因它拦停打开

#### Scenario: 归档项路径恢复后身份复位

- **WHEN** 已归档注册项的路径重新出现（如外置卷重新挂载）
- **THEN** 系统在同一注册项上清除治理标记，稳定 id 保留，不新建注册项

#### Scenario: 治理幂等收敛

- **WHEN** 注册表状态已收敛（无跃迁）时重复执行治理
- **THEN** 注册项内容不再变化，不产生重复写
