# Proposal: 修复 remap 门拦截已注册 vault 并收紧 last_vault 写入时机

- Change ID: vault-gate-fix
- 日期: 2026-09-12
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

冒烟实证（2026-09-12，Alex 已批准本批方案，原话「我没有异议」）：注册表存在路径已失效的注册项（幽灵项，实证为 vault-60196-1 / vault-64466-1）时，每次启动打开已注册的 vault 都被 remap 浮条拦下，须手动点「作为新 vault 打开」绕过；浮条文案「尚未注册为 vault」在已注册场景属误报。根因：打开链路的 remap 候选收集只检查「其他注册项的路径是否失效」，不检查目标路径自身是否已注册——候选非空即短路，与目标注册状态无关。且 remap 候选短路返回被上层当作打开成功，写入了 `last_vault`。这是存量 bug（remove-threads-and-theme 归档 tasks 的冒烟记录已发现该问题），非 Thread 删除引入。

## What Changes

1. **已注册路径直接打开**：打开 vault 时先只读核对目标路径是否已在注册表；已注册则直接打开，注册表中其他失效项（幽灵项）不再拦停、不再提示 remap。
2. **remap 门收窄**：仅当目标路径未注册且注册表中存在失效注册项时，才短路返回 remap 候选待用户显式确认。
3. **last_vault 记忆语义修正**：remap 候选短路返回（vault 未实际打开）时不再写入 `last_vault`；仅实际打开成功才记忆。启动恢复（restore_last_vault）走同一打开公共路径，自动受益：启动打开已注册 vault 不再被拦。

## Non-goals

- 不清理/归档注册表中的幽灵项（注册项删除语义另案）。
- 不改前端 remap 浮条文案与交互（src/ 不在本 change 范围）；后端修复后已注册场景不再触发该浮条，残余文案问题另案处理。
- 不改 remap 候选的排序规则（按稳定 id）与 `vault_remap` 显式重映射流程。
- 不引入跨进程注册表并发写控制（进程内串行假设不变）。

## Impact

- 影响的 specs：`vault-workspace`（MODIFIED「vault 注册表与显式重映射」「last_vault 记忆与启动恢复」）。
- 影响的代码：`src-tauri/src/workspaces.rs`（只读注册查询 `is_registered`、门判定 `remap_gate`、`vault_register` 原子写入、`vault_id` 签名去遗留参数）、`src-tauri/src/commands.rs`（`open_vault` 判定顺序、`vault_open` / `vault_open_path` 写 `last_vault` 时机）、`src-tauri/tests/workspace_scenarios.rs`（回归用例）。
- 关联约束：ADR 0002 §5 配置即数据纪律（注册表写入与既有配置写入一致采用 tmp + rename 原子替换）；ADR 0002 §6 性能合同不受影响（remap 门判定是打开链路既有的一次注册表目录读取）。

## 评审节点记录

- 节点 1（提案评审）：修复方案随本批 mission 于 2026-09-12 获 Alex 批准（原话「我没有异议」），视为节点 1 通过。
