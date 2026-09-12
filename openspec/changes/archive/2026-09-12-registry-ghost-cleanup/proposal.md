# Proposal: 注册表幽灵项归档治理与保存临时文件磁盘清理

- Change ID: registry-ghost-cleanup
- 日期: 2026-09-12
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

两处已实证的存量积垢，都是「惰性残留持续累积」问题，Alex 已把这两项列为可推进的工程项（原话：「"可立项的工程项"和"纯卫生"可以推进了」）。

1. **注册表幽灵项**：vault 注册表（`~/.config/lumir/workspaces/`）只增不减。冒烟实证当前存在两个失效注册项 `vault-60196-1`、`vault-64466-1`（注册路径已消失），它们仍被当作 remap 候选，每次打开未注册目录都会弹出指向幽灵路径的浮条。M121 的 `vault-gate-fix` 只修掉了「幽灵项拦停已注册 vault」，并明确把注册项清理语义列入 Non-goals 另案（`openspec/changes/archive/2026-09-12-vault-gate-fix/proposal.md` 的 Non-goals 第 1 条）。

2. **保存临时文件 ghost 占磁盘**：`document_save` 的原子写入临时文件（`.{文件名}.lumir-{pid}`）在进程崩溃后残留。M124 的 `save-and-watch-recovery` 让 ghost 从文件树与 watch 事件流消失（忽略集模式），但忽略只是「看不见」——`src-tauri/src/fs_io.rs` 的 `is_ignored` 不删除任何文件，ghost 仍在 vault 磁盘上隐形累积，累积量与崩溃次数成正比。

两处治理都必须避开同一个坑：不能硬删。注销一个暂时未挂载的外置卷上的 vault，会让卷重新挂载后身份丢失；用户可见的删除动作也会让「vault 去哪了」变成不可解释的状态。因此注册表侧取归档标记，tmp 侧取年龄阈值。

## What Changes

1. **失效注册项惰性归档**：枚举/打开链路顺带治理——路径首次被观测到失效时记下时刻；失效持续超过宽限期（初始 24 小时，可随实测调整）后打上归档标记。注册项文件 MUST NOT 被删除，归档只是标记。
2. **归档项退出 remap 候选**：已归档的失效项不再进入 remap 候选，幽灵项不再污染浮条；宽限期内的失效项仍是候选，保留「移动 vault 后重新打开」的 remap 恢复入口（首次观测必出候选，宽限期只决定候选继续出现的时长）。
3. **路径恢复即复位**：归档项的路径重新出现（外置卷重新挂载、目录被还原）时，在同一注册项上清除治理标记并保留其稳定 id，不新建注册项。写入按 `vault_remap` 重映射或再次打开即归零。
4. **治理幂等**：治理只在状态跃迁时写盘，状态收敛后重复执行不产生写。
5. **超龄 ghost tmp 惰性清除**：vault 枚举路径上，删除 mtime 早于年龄阈值（初始 24 小时，可随实测调整）的 `.lumir-` 临时文件；未超龄的临时文件（在途保存，生命周期毫秒级）与不匹配该模式的合法点文件（如 `.hidden.conf`）MUST NOT 被清除，符号链接不动。清除失败 MUST NOT 让枚举失败。

## Non-goals

- 不做注册项硬删除：归档是标记，注册项文件保留（这是「不误删外置卷上的合法 vault」的落地方式）。
- 不改 `src-tauri/src/commands.rs` 的任何签名与调用：触发点限制在 `workspaces.rs` / `fs_io.rs` 内部的惰性治理。
- 不改前端 remap 浮条文案与交互（`src/` 不在本 change 范围）。
- 不引入后台定时清理线程或独立清理命令：只在既有的枚举/打开路径上惰性执行。
- 不改 `fs-io` 既有忽略集语义：ghost 仍然不进文件树与 watch 事件流。
- 不触碰用户真实配置目录 `~/.config/lumir/`：测试一律用临时目录。

## Impact

- 影响的 specs：`vault-workspace`（MODIFIED「vault 注册表与显式重映射」）、`fs-io`（ADDED「保存临时文件 ghost 的磁盘治理」）。
- 影响的代码：`src-tauri/src/workspaces.rs`（注册项落盘结构、惰性治理、候选过滤）、`src-tauri/src/fs_io.rs`（ghost tmp 年龄判定与枚举路径清除）、`src-tauri/tests/workspace_scenarios.rs`（治理回归用例）。
- 关联约束：ADR 0002 §5 配置即数据纪律（治理写盘沿用 tmp + rename 原子替换）；ADR 0002 §6 性能合同（tmp 治理复用枚举既有的目录遍历，不新增全量扫描；注册表治理只多读一次条目数为个位数的注册表目录）。新增持久化字段不进 webview 契约（ts-rs `skip`），`src/bindings/` 不变。

## 评审节点记录

- 节点 1（提案评审）：两个治理项的立项目标与取舍（归档而非硬删、年龄阈值、触发点限内部惰性路径）随本批 mission 于 2026-09-12 获 Alex 批准（原话「"可立项的工程项"和"纯卫生"可以推进了」），视为节点 1 通过。
