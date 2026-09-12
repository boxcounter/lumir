# vault-workspace Specification

## Purpose

定义 vault 的打开与记忆：经系统目录选择器打开单个 vault、写入 `last_vault` 并在启动时自动恢复。M1 出口（只读浏览真实 vault，ADR 0004 §1）的承载面之一。由 change `add-vault-workspace` 归档并入（2026-09-05，实现 M18 + M20 接线；真实 vault 出口验收由 Alex 人肉执行，见归档 tasks.md 5.2 标注）。

## Requirements

### Requirement: vault 打开

系统 SHALL 提供 `vault_open` command 调系统目录选择器打开一个目录作为 vault；用户取消选择 SHALL NOT 产生错误状态。打开成功 SHALL 触发一次全量枚举（见 fs-io「全类型递归枚举」）并启动 watch（见 fs-io「watch 增量事件流」）。同一时刻 SHALL 只有一个打开的 vault；再次打开 SHALL 替换当前 vault 并停止对旧 vault 的监听。

#### Scenario: 目录选择器取消

- **WHEN** 用户在目录选择器中取消
- **THEN** 当前 vault 状态不变，无错误提示

#### Scenario: 重复打开替换当前 vault

- **WHEN** vault A 已打开，用户通过 `vault_open` 打开 vault B
- **THEN** vault A 的 watch 停止，vault B 完成全量枚举并成为当前 vault

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
