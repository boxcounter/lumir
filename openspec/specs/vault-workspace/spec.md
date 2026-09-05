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

打开 vault 成功后系统 SHALL 将 vault 绝对路径写入配置的 `last_vault` 字段（config.rs 既有字段，本 change 开始消费）；配置写入 SHALL 遵守 ADR 0002 §5 的配置即数据纪律（逐字段校验、非法值人话 warning）。启动时若 `last_vault` 存在且仍是合法目录，系统 SHALL 自动恢复打开该 vault；若路径不存在或不是目录，系统 SHALL 进入未打开状态并给出人话提示，MUST NOT 崩溃或静默卡死。

#### Scenario: 启动自动恢复

- **WHEN** 上次会话以 vault 打开状态退出，且该目录仍存在
- **THEN** 本次启动自动打开该 vault，文件树直接可用

#### Scenario: last_vault 失效

- **WHEN** `last_vault` 指向的目录已被删除或移动
- **THEN** 进入未打开空态，提示该路径不可用，用户可重新选择目录
