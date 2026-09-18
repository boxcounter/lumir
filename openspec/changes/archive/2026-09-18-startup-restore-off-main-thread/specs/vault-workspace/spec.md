## MODIFIED Requirements

### Requirement: last_vault 记忆与启动恢复

vault 实际打开成功后系统 SHALL 将 vault 绝对路径写入配置的 `last_vault` 字段（config.rs 既有字段，add-vault-workspace 起消费）；remap 候选短路返回（vault 未实际打开）时 MUST NOT 写入 `last_vault`。配置写入 SHALL 遵守 ADR 0002 §5 的配置即数据纪律（逐字段校验、非法值人话 warning）。启动时若 `last_vault` 存在且仍是合法目录，系统 SHALL 自动恢复打开该 vault；若路径不存在或不是目录，系统 SHALL 进入未打开状态并给出人话提示，MUST NOT 崩溃或静默卡死。启动恢复 SHALL 在主线程之外执行（时序与完成通知口径见「启动恢复的时序与可见性」），其成功结果与失败提示 MUST NOT 覆盖用户在恢复期间已成功打开的 vault。除异步化与结果让位两条外，本 requirement 的其余口径（写入条件、失效提示内容、无 vault 时的未打开状态）不变。

#### Scenario: 启动自动恢复

- **WHEN** 上次会话以 vault 打开状态退出，且该目录仍存在
- **THEN** 本次启动自动打开该 vault，文件树直接可用

#### Scenario: last_vault 失效

- **WHEN** `last_vault` 指向的目录已被删除或移动
- **THEN** 进入未打开空态，提示该路径不可用，用户可重新选择目录

#### Scenario: remap 候选短路不写 last_vault

- **WHEN** 打开路径触发 remap 候选短路返回（vault 未实际打开）
- **THEN** 配置的 `last_vault` 保持原值，不记忆该次未完成的打开

#### Scenario: 恢复结果不覆盖用户已打开的 vault

- **WHEN** 启动恢复仍在进行时，用户已成功打开了另一个 vault
- **THEN** 本次恢复产生的 vault 与失败提示被整体丢弃，当前 vault 保持用户刚打开的那一个

## ADDED Requirements

### Requirement: 启动恢复的时序与可见性

启动恢复（读取配置、校验 `last_vault` 路径、全量枚举与链接索引建立）SHALL 在 Tauri setup 的主线程之外执行；setup MUST NOT 同步等待其完成。`VaultStatus` SHALL 以 `restore_pending` 字段承载恢复进行态（`true` = 仍在进行；`false` = 终态：已打开 vault，或未打开且 `notice` 为可选人话提示）。前端在 `restore_pending` 为 `true` 时 SHALL 以未打开空态的布局呈现恢复中提示（文案见 `文案-Copy.md`），MUST NOT 将其呈现为「尚无 vault」的终态；恢复完成后 SHALL 无需用户操作自动进入该 vault。恢复流程的每一条结束路径（成功 / 无 `last_vault` / `last_vault` 失效 / 配置加载失败 / 打开 vault 失败）SHALL 使 `restore_pending` 转 `false`，并发出 `vault:restore_finished` 事件（无载荷，仅作唤醒信号）。前端 SHALL 以 `vault_current` 的返回值为权威状态、以该事件为唤醒信号：启动时 SHALL 先订阅该事件、再拉取一次状态，MUST NOT 依赖事件必然送达（webview 挂载晚于恢复完成时事件会丢失）。恢复进行期间文件树 pane 的「打开 vault」入口 SHALL 保持可用，用户此间的成功打开 SHALL 优先于本次恢复。`LUMIR_READY` 的发射位置与语义 SHALL 保持不变（事件循环可接管的标记）；恢复耗时 MUST NOT 计入该端点，也 MUST NOT 以「把该标记移到恢复之后」的方式让门禁覆盖恢复耗时。

#### Scenario: 大 vault 恢复不推迟首帧

- **WHEN** `last_vault` 指向一个全量枚举与索引建立需要数百毫秒的 vault
- **THEN** 窗口在恢复完成前即可绘制并可交互，界面先呈恢复中提示，恢复完成后无需用户操作自动进入该 vault

#### Scenario: 恢复期间用户另选 vault

- **WHEN** 恢复仍在进行时用户经「打开 vault」入口成功打开了另一个 vault
- **THEN** 本次恢复的结果被整体丢弃（含失败提示），界面保持用户刚打开的 vault；打开入口在恢复期间全程可用，MUST NOT 因恢复进行态被禁用

#### Scenario: 恢复完成早于前端订阅

- **WHEN** 恢复在 webview 挂载前已完成
- **THEN** 前端启动时的 `vault_current` 拉取直接得到已打开的 vault 且 `restore_pending` 为 `false`，事件丢失不影响终态

#### Scenario: 每一条结束路径都进入可见终态

- **WHEN** 配置加载失败 / `last_vault` 路径已失效 / 打开 vault 失败
- **THEN** `restore_pending` 转 `false` 并发出 `vault:restore_finished`，界面进入未打开空态并显示与既有实现一致的人话提示，用户可重新选择目录

#### Scenario: 无 last_vault 的启动

- **WHEN** 配置中没有 `last_vault`
- **THEN** 恢复流程立即结束（`restore_pending` 转 `false`，不产生失败提示），界面呈未打开空态与打开入口

#### Scenario: ready 端点是「事件循环可接管」

- **WHEN** 冷启动测量读取 `LUMIR_READY` 行
- **THEN** 出现在恢复任务启动之前，读数不含 `last_vault` 恢复耗时（本 change MUST NOT 改变该行位置）
